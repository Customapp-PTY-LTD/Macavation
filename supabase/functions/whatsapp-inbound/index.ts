/**
 * Supabase Edge Function: receive inbound WhatsApp messages and delivery receipts,
 * forwarded by Control Room from Meta.
 *
 * Deploy: supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt
 *
 * verify_jwt MUST BE DISABLED. Control Room sends no Supabase JWT — the
 * X-Control-Room-Signature HMAC over the raw body IS the authentication. With
 * verify_jwt on, every forward is rejected at the gateway before this code runs.
 *
 * Register in Control Room -> Channels -> macavation-9349 -> Overview -> Product
 * destination: project ref `nmdmddugxclpqrwylyfa` + function name `whatsapp-inbound`,
 * or the equivalent webhook URL override:
 *   https://nmdmddugxclpqrwylyfa.supabase.co/functions/v1/whatsapp-inbound
 * Until that is set, Control Room logs inbound events on its side and forwards nothing.
 *
 * Secrets: CONTROL_ROOM_FORWARD_SECRET (same secret that signs outbound sends — it
 * signs both directions), CONTROL_ROOM_CHANNEL_SLUG (required only to SEND a reply —
 * see "Command dispatch" below; if unset, replies are skipped but messages still ingest).
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by the runtime)
 * Docs: https://control-room.customapp.co.za/docs/product-integration.md
 *
 * Command dispatch (added after the original store-only version of this function):
 * - Every inbound TEXT message from a number resolved by whatsapp_resolve_staff_user to an
 *   enrolled, active staff user is parsed as a command, dispatched, and replied to.
 * - Unenrolled numbers are left exactly as before — untouched — with ONE exception: a body
 *   that is exactly six digits is tried against whatsapp_confirm_enrolment, since that is the
 *   only way a pending enrolment code ever gets consumed. Success or failure either way, no
 *   other behaviour changes for an unenrolled number, and a failed attempt gets NO reply
 *   (silence — see whatsapp-inbound's handleCommand comments for why).
 * - value.statuses[] (delivery receipts for messages WE sent) NEVER dispatch a command — our
 *   own replies generate statuses, and dispatching from a status would be an infinite loop.
 * - Every dispatch attempt — success, refusal, or error — writes one row to
 *   whatsapp_command_log via whatsapp_log_command (service_role only).
 * - Any of the three new RPCs (whatsapp_resolve_staff_user, whatsapp_confirm_enrolment,
 *   whatsapp_log_command) being missing means "migration not applied yet": ingest continues
 *   normally, no reply is sent, and the function still returns 2xx. The same degradation applies
 *   to the pending-command RPCs added alongside YES/NO below.
 * - Commands that WRITE stage themselves (whatsapp_stage_pending_command) instead of applying
 *   immediately, and are only applied once the sender replies YES (or Y / CONFIRM); NO (or N /
 *   CANCEL) discards the staged command instead. See STAGED_COMMAND_HANDLERS below — empty until
 *   a write command exists to register there.
 *
 * Control Room's contract:
 * - POSTs Meta's raw webhook envelope byte-for-byte: the whatsapp_business_account
 *   object, with entry[].changes[].value.messages[] for inbound messages,
 *   value.statuses[] for delivery receipts, value.contacts[0].profile.name for the
 *   sender's display name, and value.metadata.phone_number_id.
 * - Headers: X-Control-Room-Signature: sha256=<hex HMAC-SHA256 of the raw body>,
 *   X-Control-Room-Channel, X-Control-Room-Channel-Code,
 *   X-Control-Room-Phone-Number-ID, X-Control-Room-Signature-Verified: true.
 * - Inbound phone numbers are bare digits, no leading '+' (e.g. 27725755178).
 * - There is NO GET challenge — no hub.challenge handshake reaches us. POST only.
 * - There are NO RETRIES. Control Room always acks Meta 200 regardless of what we
 *   return; a non-2xx or timeout on our side is logged as failed and DROPPED FOREVER.
 *   So: persist first, log failures loudly with the wamid, and return 200 for anything
 *   that verifies but has nothing usable in it.
 * - Duplicates are possible; deduped on wamid by chat_ingest_inbound_whatsapp.
 * - Media is referenced by Meta id, not a URL, and the access token lives in Control
 *   Room — we cannot download bytes and do not try. Non-text messages store a
 *   placeholder body recording the type and media id.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  sendText,
  sendButtons,
  sendList,
  buildReplyId,
  parseReplyId,
  type WaButton,
  type WaListSection,
} from '../_shared/wa-send.ts';
import { classifyMessage, sanitizeSenderName } from '../_shared/wa-inbound.ts';
import { truncate, MAX_LIST_TITLE, MAX_LIST_SECTION, MAX_BUTTON_CTA } from '../_shared/wa-limits.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-control-room-signature, x-control-room-channel, x-control-room-channel-code, x-control-room-phone-number-id, x-control-room-signature-verified',
};

// deno-lint-ignore no-explicit-any
type Any = any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent, no early exit on the first differing byte. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Body text for a message of any Meta type. Text and captioned media use the real
 * text; everything else gets a placeholder recording the type and the media id, since
 * we cannot fetch media bytes.
 */
function bodyForMessage(msg: Any): string {
  const type = String(msg?.type || 'unknown');

  switch (type) {
    case 'text':
      return String(msg?.text?.body ?? '').trim() || '[empty text message]';
    case 'button':
      return String(msg?.button?.text ?? '').trim() || '[button reply]';
    case 'interactive': {
      const i = msg?.interactive || {};
      const title = i?.button_reply?.title ?? i?.list_reply?.title ?? '';
      return String(title).trim() || '[interactive reply]';
    }
    case 'reaction': {
      const emoji = String(msg?.reaction?.emoji ?? '').trim();
      return emoji ? `[reacted ${emoji}]` : '[reaction]';
    }
    case 'location': {
      const l = msg?.location || {};
      const name = String(l?.name ?? '').trim();
      const coords = [l?.latitude, l?.longitude].filter((v) => v != null).join(', ');
      return `[location${name ? ` ${name}` : ''}${coords ? ` (${coords})` : ''}]`;
    }
    case 'contacts':
      return '[shared contact card]';
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const media = msg?.[type] || {};
      const caption = String(media?.caption ?? '').trim();
      const filename = String(media?.filename ?? '').trim();
      const id = String(media?.id ?? '').trim();
      const label = `[${type}${filename ? ` ${filename}` : ''}${id ? ` id:${id}` : ''}]`;
      return caption ? `${label} ${caption}` : label;
    }
    default:
      return `[unsupported message type: ${type}]`;
  }
}

/** Meta timestamps are unix seconds as a string. */
function metaTimestampToIso(ts: unknown): string | null {
  const secs = Number(ts);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return new Date(secs * 1000).toISOString();
}

/** A missing RPC means the migration is not applied yet — degrade, do not 500. */
function isMissingRpc(err: Any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  return code === 'PGRST202' || /could not find the function|does not exist/i.test(msg);
}

// ============================================================================
// Outbound reply.
//
// Every reply this function sends goes through supabase/functions/_shared/wa-send.ts
// (`sendText`, `sendButtons`, `sendList`) — never a locally hand-rolled Control Room payload.
// That file is the single place the Control Room envelope, the HMAC signing, and Meta's
// interactive/list shapes are kept in step; duplicating any of that here would make a second
// place to get out of sync. See wa-send.ts:21-47 for the confirmed non-text send shapes and why
// this repo can now send buttons/lists/templates, not just text.
//
// supabase/functions/send-whatsapp-message/index.ts is still not reusable here: it requires an
// X-Portal-Session header validated via assistant_validate_session, and this webhook has no
// portal session — it is a server-to-server call authenticated only by the Control Room HMAC that
// wa-send.ts itself applies.
// ============================================================================

// ============================================================================
// Audit log — one row per dispatch attempt, refusals included.
// ============================================================================

type CommandOutcome = 'ok' | 'unknown_command' | 'not_enrolled' | 'denied' | 'error';

/** Swallows any error after logging — audit logging must never break message handling. */
async function logCommand(
  sb: SupabaseClient,
  fields: {
    phone: string;
    userId: string | null;
    wamid: string;
    rawBody: string;
    command: string | null;
    outcome: CommandOutcome;
    detail?: string | null;
  }
): Promise<void> {
  try {
    const { error } = await sb.rpc('whatsapp_log_command', {
      p_phone: fields.phone,
      p_user_id: fields.userId,
      p_wamid: fields.wamid,
      p_raw_body: fields.rawBody,
      p_command: fields.command,
      p_outcome: fields.outcome,
      p_detail: fields.detail ?? null,
    });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] whatsapp_log_command is missing — migration 20260815120000 not applied.'
        );
        return;
      }
      console.error('[whatsapp-inbound] audit log insert failed:', error.message);
    }
  } catch (e) {
    console.error('[whatsapp-inbound] audit log insert threw:', e);
  }
}

// ============================================================================
// Command dispatch — HELP plus the generic YES/NO confirm-cancel flow in this plan. No write
// command exists yet: the next plan adds one by adding an entry to STAGED_COMMAND_HANDLERS below
// (keyed on the pending command's `command` value) and, separately, a verb to COMMAND_HANDLERS
// (keyed on what the user types) — not by restructuring this.
// ============================================================================

interface CommandContext {
  sb: SupabaseClient;
  phone: string;
  wamid: string;
  rawBody: string;
  userId: string;
  roleId: string | null;
  displayName: string;
}

interface CommandResult {
  outcome: 'ok' | 'unknown_command' | 'denied' | 'error';
  reply: string | null;
  command: string | null;
  detail?: string | null;
}

const HELP_COMMAND_LIST =
  'HELP — show this message\n' +
  'YES (or Y, CONFIRM) — confirm a pending request\n' +
  'NO (or N, CANCEL) — cancel a pending request';

function helpReplyText(displayName: string): string {
  // Plain text, WhatsApp-friendly: short lines, no markdown table, no link — no screen in this
  // portal is deep-linkable (the router never reads the URL), so a link could only ever land
  // on the app root and would be worse than useless.
  return (
    `Hi ${displayName}. Here is what I can do right now:\n\n` +
    `${HELP_COMMAND_LIST}\n\n` +
    `Some requests write data — those ask you to confirm what was understood before anything is ` +
    `saved. Reply YES to go ahead or NO to cancel.\n\n` +
    `More commands are coming. Text HELP any time to see the current list.`
  );
}

async function commandHelp(ctx: CommandContext): Promise<CommandResult> {
  return { outcome: 'ok', reply: helpReplyText(ctx.displayName), command: 'HELP' };
}

// ============================================================================
// Staged-command handlers — dispatched by YES on whatever was staged via
// whatsapp_stage_pending_command, keyed on its `command` value. EMPTY in this plan: there is no
// write command yet to stage one in the first place. The next plan registers a real handler here
// (and, separately, the verb that stages it, in COMMAND_HANDLERS below) — this map is the only
// thing it needs to touch to do so.
// ============================================================================

interface StagedCommand {
  command: string;
  payload: Any;
  summary: string;
}

const STAGED_COMMAND_HANDLERS: Record<
  string,
  (ctx: CommandContext, staged: StagedCommand) => Promise<CommandResult>
> = {};

/**
 * YES / Y / CONFIRM — takes (fetches-and-deletes) whatever is staged for this phone+user and
 * applies it via STAGED_COMMAND_HANDLERS. With nothing pending, or an RPC failure, replies
 * accordingly rather than throwing; a staged command with no registered handler (the only
 * reachable case until the next plan) replies that the request has expired.
 */
async function commandYes(ctx: CommandContext): Promise<CommandResult> {
  let data: Any;
  let error: Any;
  try {
    const res = await ctx.sb.rpc('whatsapp_take_pending_command', {
      p_phone: ctx.phone,
      p_user_id: ctx.userId,
    });
    data = res.data;
    error = res.error;
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_take_pending_command threw:', e);
    return { outcome: 'error', reply: null, command: 'YES', detail: String(e) };
  }

  if (error) {
    if (isMissingRpc(error)) {
      console.error(
        '[whatsapp-inbound] whatsapp_take_pending_command is missing — migration 20260815130000 not applied.'
      );
      return { outcome: 'error', reply: null, command: 'YES', detail: 'rpc missing' };
    }
    console.error('[whatsapp-inbound] whatsapp_take_pending_command failed:', error.message);
    return { outcome: 'error', reply: null, command: 'YES', detail: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;

  if (!row || row.success !== 1) {
    return {
      outcome: 'ok',
      reply: `Hi ${ctx.displayName}, there is nothing waiting for confirmation.`,
      command: 'YES',
    };
  }

  const stagedCommand = String(row.command || '').toUpperCase();
  const handler = STAGED_COMMAND_HANDLERS[stagedCommand];
  if (!handler) {
    return {
      outcome: 'unknown_command',
      reply:
        `Sorry ${ctx.displayName}, that request has expired or is no longer supported — please ` +
        `send it again.`,
      command: 'YES',
      detail: stagedCommand || null,
    };
  }

  return handler(ctx, { command: stagedCommand, payload: row.payload, summary: String(row.summary || '') });
}

/**
 * NO / N / CANCEL — clears whatever is staged for this phone+user, if anything is still live.
 */
async function commandNo(ctx: CommandContext): Promise<CommandResult> {
  let data: Any;
  let error: Any;
  try {
    const res = await ctx.sb.rpc('whatsapp_clear_pending_command', {
      p_phone: ctx.phone,
      p_user_id: ctx.userId,
    });
    data = res.data;
    error = res.error;
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_clear_pending_command threw:', e);
    return { outcome: 'error', reply: null, command: 'NO', detail: String(e) };
  }

  if (error) {
    if (isMissingRpc(error)) {
      console.error(
        '[whatsapp-inbound] whatsapp_clear_pending_command is missing — migration 20260815130000 not applied.'
      );
      return { outcome: 'error', reply: null, command: 'NO', detail: 'rpc missing' };
    }
    console.error('[whatsapp-inbound] whatsapp_clear_pending_command failed:', error.message);
    return { outcome: 'error', reply: null, command: 'NO', detail: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const cleared = Number(row?.cleared || 0) > 0;

  return {
    outcome: 'ok',
    reply: cleared
      ? `OK ${ctx.displayName}, cancelled — nothing was saved.`
      : `Hi ${ctx.displayName}, there was nothing waiting for confirmation.`,
    command: 'NO',
  };
}

const COMMAND_HANDLERS: Record<string, (ctx: CommandContext) => Promise<CommandResult>> = {
  HELP: commandHelp,
  YES: commandYes,
  Y: commandYes,
  CONFIRM: commandYes,
  NO: commandNo,
  N: commandNo,
  CANCEL: commandNo,
};

/** Parses the verb and dispatches. HELP (also empty body and "?") always short-circuits. */
async function handleCommand(ctx: CommandContext): Promise<CommandResult> {
  const collapsed = ctx.rawBody.trim().replace(/\s+/g, ' ');
  const verb = (collapsed.split(' ')[0] || '').toUpperCase();

  if (!collapsed || collapsed === '?' || verb === 'HELP') {
    return commandHelp(ctx);
  }

  const handler = COMMAND_HANDLERS[verb];
  if (!handler) {
    const reply =
      `Sorry ${ctx.displayName}, I did not recognise "${verb}".\n\n` +
      `Here is what I can do right now:\n\n${HELP_COMMAND_LIST}\n\n` +
      `More commands are coming. Text HELP any time to see the current list.`;
    return { outcome: 'unknown_command', reply, command: verb || null };
  }

  return handler(ctx);
}

/**
 * The one thing an UNENROLLED number may do: consume a pending 6-digit enrolment code.
 * Silent on any failure — no pending code, expired, wrong code, attempts exhausted — because
 * replying "wrong code" to an arbitrary number that happens to have texted six digits both
 * confirms this endpoint is live and leaks that an enrolment is in progress. The person
 * enrolling is standing with the admin who issued the code and will simply not receive the
 * success message.
 */
async function tryConfirmEnrolment(
  sb: SupabaseClient,
  from: string,
  wamid: string,
  rawBody: string,
  code: string
): Promise<void> {
  let row: Any;
  try {
    const { data, error } = await sb.rpc('whatsapp_confirm_enrolment', { p_phone: from, p_code: code });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] whatsapp_confirm_enrolment is missing — migration 20260815100000 not applied.'
        );
        return;
      }
      throw error;
    }
    row = Array.isArray(data) ? data[0] : data;
  } catch (e) {
    console.error(`[whatsapp-inbound] enrolment confirmation threw wamid=${wamid}:`, e);
    await logCommand(sb, {
      phone: from,
      userId: null,
      wamid,
      rawBody,
      command: 'ENROL',
      outcome: 'error',
      detail: String(e),
    });
    return;
  }

  if (row && row.success === 1) {
    const displayName = String(row.display_name || 'there');
    await logCommand(sb, {
      phone: from,
      userId: row.user_id ?? null,
      wamid,
      rawBody,
      command: 'ENROL',
      outcome: 'ok',
      detail: null,
    });
    const reply =
      `Thanks ${displayName}, this number is now enrolled.\n\n` +
      `Text HELP any time to see what I can do.`;
    const sent = await sendText(from, reply);
    if (!sent.ok) {
      console.error(`[whatsapp-inbound] enrolment confirmation reply failed wamid=${wamid}: ${sent.error}`);
    }
    return;
  }

  // Failure — deliberately silent (see function comment).
  await logCommand(sb, {
    phone: from,
    userId: null,
    wamid,
    rawBody,
    command: 'ENROL',
    outcome: 'not_enrolled',
    detail: row?.error ?? 'confirmation failed',
  });
}

// ============================================================================
// Report actions — WhatsApp replies to Macavation's daily production report, reached either by
// tapping a button/list row on a message we sent (a template quick-reply tap or an interactive
// reply) or by typing a recognised word. This is a SECOND, separate audience from the staff
// command system above: it is gated by report_recipients.is_staff (a report-distribution
// authorisation flag), not by whatsapp_resolve_staff_user (portal login enrolment) — the two sets
// of phone numbers can overlap or not, and neither RPC is a fallback for the other.
// ============================================================================

/** The fixed, total set of report actions. Every reply-id and typed alias resolves to one of
 * these, or to none at all. */
type ReportAction =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'full'
  | 'stock'
  | 'alerts'
  | 'report'
  | 'menu'
  | 'mute7'
  | 'stop'
  | 'start'
  | 'help';

const REPORT_ACTIONS: readonly ReportAction[] = [
  'today',
  'yesterday',
  'week',
  'month',
  'full',
  'stock',
  'alerts',
  'report',
  'menu',
  'mute7',
  'stop',
  'start',
  'help',
];
const REPORT_ACTION_SET = new Set<string>(REPORT_ACTIONS);

function isReportAction(s: string): s is ReportAction {
  return REPORT_ACTION_SET.has(s);
}

// Two mutually exclusive, jointly exhaustive tiers. Every ReportAction is in exactly one.
const STAFF_ONLY_ACTIONS: ReadonlySet<ReportAction> = new Set<ReportAction>([
  'today',
  'yesterday',
  'week',
  'month',
  'full',
  'stock',
  'alerts',
]);
const ANY_RECIPIENT_ACTIONS: ReadonlySet<ReportAction> = new Set<ReportAction>([
  'menu',
  'help',
  'report',
  'mute7',
  'stop',
  'start',
]);

const REPLY_NS = 'mac';

/** Builds this file's own namespaced reply id for a report action, e.g. "mac:today". */
function waReplyId(action: ReportAction): string {
  return buildReplyId(REPLY_NS, action);
}

/** Resolves an inbound button/list reply id to a ReportAction. Null for anything not in the
 * "mac" namespace or not one of the 13 known actions — including another feature's reply id. */
function resolveAction(replyId: string): ReportAction | null {
  const parsed = parseReplyId(replyId);
  if (parsed && parsed.ns === REPLY_NS && isReportAction(parsed.action)) {
    return parsed.action;
  }
  return null;
}

/**
 * Legacy/template button payloads and typed synonyms, for anything that does not arrive as this
 * file's own "mac:<action>" reply id — a template's quick-reply button whose payload/text is a
 * plain word, or a person typing "STOP" instead of tapping. YES / Y / CONFIRM / NO / N / CANCEL
 * are deliberately absent: those verbs already dispatch through COMMAND_HANDLERS (commandYes /
 * commandNo) for the staff command system above, and aliasing them here would silently repurpose
 * an existing staged-command verb. HELP is also deliberately absent for the same reason — typed
 * "HELP" already short-circuits to commandHelp in handleCommand for a staff-resolved number, and
 * that existing reply must not change; a report recipient who is not portal staff still reaches
 * actionHelp by TAPPING the menu's Help row, which carries this file's own "mac:help" reply id
 * and is resolved via resolveAction above, not through this alias table.
 */
const LEGACY_REPLY_ALIASES: Record<string, ReportAction> = {
  MENU: 'menu',
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  WEEK: 'week',
  MONTH: 'month',
  FULL: 'full',
  STOCK: 'stock',
  ALERTS: 'alerts',
  REPORT: 'report',
  LATEST: 'report',
  MUTE: 'mute7',
  MUTE7: 'mute7',
  PAUSE: 'mute7',
  STOP: 'stop',
  UNSUBSCRIBE: 'stop',
  START: 'start',
  SUBSCRIBE: 'start',
  RESUME: 'start',
};

function normaliseAlias(s: string): string {
  return s.trim().toUpperCase();
}

/** Never throws. Null for anything not in LEGACY_REPLY_ALIASES, including an empty string. */
function lookupAlias(s: string): ReportAction | null {
  return LEGACY_REPLY_ALIASES[normaliseAlias(s)] ?? null;
}

interface ReportContext {
  sb: SupabaseClient;
  from: string;
  wamid: string;
  displayName: string;
  isStaff: boolean;
  userId: string | null;
  recipient: Any;
  getSastToday: () => Promise<string | null>;
}

interface ReportActionResult {
  outcome: CommandOutcome;
  command: string;
  detail?: string | null;
  /** Always non-empty. Doubles as the interactive body text when `buttons`/`list` is present. */
  reply: string;
  buttons?: WaButton[];
  list?: { buttonLabel: string; sections: WaListSection[] };
}

/**
 * Adds `days` (may be negative) to a 'YYYY-MM-DD' SAST date string. The only `new Date(` in this
 * file besides metaTimestampToIso — always anchored at an explicit UTC midnight on the SAST
 * calendar date already resolved via report_sast_today(), never a bare `new Date()` off the
 * container's own clock.
 */
function sastDatePlusDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Renders a production figure as free WhatsApp text: thousands separated by a REGULAR space.
 * Unlike send-daily-production-report/index.ts's formatFigure, this does not need a non-breaking
 * space — that file sends a TEMPLATE parameter later collapsed by its own sanitizeParam (which
 * would eat a run of regular spaces); this file sends free text via sendText/sendList, calls no
 * such sanitizer, and has nothing to survive. 'not captured' for null/undefined/non-numeric —
 * never '0' for an uncaptured figure.
 */
function formatFigureText(value: unknown, decimals = 0): string {
  if (value === null || value === undefined) return 'not captured';
  const num = Number(value);
  if (!Number.isFinite(num)) return 'not captured';
  const fixed = num.toFixed(decimals);
  const negative = fixed.startsWith('-');
  const abs = negative ? fixed.slice(1) : fixed;
  const [intPart, fracPart] = abs.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const combined = fracPart ? `${withThousands}.${fracPart}` : withThousands;
  return negative ? `-${combined}` : combined;
}

/** formatFigureText with 2 decimals and an 'R' prefix, for a Rand amount. */
function formatZar(value: unknown): string {
  const figure = formatFigureText(value, 2);
  return figure === 'not captured' ? figure : `R${figure}`;
}

/** Builds the WhatsApp list menu — a fuller staff menu, or a restricted subscriber-only menu. */
function buildMenuResult(displayName: string, isStaff: boolean): ReportActionResult {
  const sections: WaListSection[] = isStaff
    ? [
        {
          title: truncate('Today', MAX_LIST_SECTION),
          rows: [
            { id: waReplyId('today'), title: truncate("Today's production", MAX_LIST_TITLE) },
            { id: waReplyId('yesterday'), title: truncate('Yesterday', MAX_LIST_TITLE) },
          ],
        },
        {
          title: truncate('Period summary', MAX_LIST_SECTION),
          rows: [
            { id: waReplyId('week'), title: truncate('Week to date', MAX_LIST_TITLE) },
            { id: waReplyId('month'), title: truncate('Month to date', MAX_LIST_TITLE) },
            { id: waReplyId('full'), title: truncate('Full daily report', MAX_LIST_TITLE) },
          ],
        },
        {
          title: truncate('Status', MAX_LIST_SECTION),
          rows: [
            { id: waReplyId('stock'), title: truncate('Kernel stock', MAX_LIST_TITLE) },
            { id: waReplyId('alerts'), title: truncate('Open alerts', MAX_LIST_TITLE) },
          ],
        },
        {
          title: truncate('More', MAX_LIST_SECTION),
          rows: [
            { id: waReplyId('report'), title: truncate('Latest report link', MAX_LIST_TITLE) },
            { id: waReplyId('help'), title: truncate('Help', MAX_LIST_TITLE) },
          ],
        },
      ]
    : [
        {
          title: truncate('Reports', MAX_LIST_SECTION),
          rows: [{ id: waReplyId('report'), title: truncate('Latest report link', MAX_LIST_TITLE) }],
        },
        {
          title: truncate('Subscription', MAX_LIST_SECTION),
          rows: [
            { id: waReplyId('mute7'), title: truncate('Pause 7 days', MAX_LIST_TITLE) },
            { id: waReplyId('stop'), title: truncate('Stop reports', MAX_LIST_TITLE) },
          ],
        },
      ];

  return {
    outcome: 'ok',
    command: 'MENU',
    reply: `Hi ${displayName}, what would you like?`,
    list: { buttonLabel: truncate('Choose', MAX_BUTTON_CTA), sections },
  };
}

/**
 * The one place a ReportActionResult becomes exactly one outbound send, always preceded by
 * exactly one whatsapp_log_command row. Priority when more than one payload is present:
 * list > buttons > plain text. A send that throws (e.g. a caller-side cap violation) is caught
 * and logged here — it must never escape to processCommandForMessage's own backstop and must
 * never cause a second audit row.
 */
async function deliverActionResult(
  ctx: ReportContext,
  rawBody: string,
  result: ReportActionResult
): Promise<void> {
  await logCommand(ctx.sb, {
    phone: ctx.from,
    userId: ctx.userId,
    wamid: ctx.wamid,
    rawBody,
    command: result.command,
    outcome: result.outcome,
    detail: result.detail ?? null,
  });

  try {
    const sendResult = result.list
      ? await sendList(ctx.from, result.reply, result.list.buttonLabel, result.list.sections)
      : result.buttons && result.buttons.length > 0
        ? await sendButtons(ctx.from, result.reply, result.buttons)
        : await sendText(ctx.from, result.reply);

    if (!sendResult.ok) {
      console.error(
        `[whatsapp-inbound] report action reply send failed wamid=${ctx.wamid} command=${result.command}: ${sendResult.error}`
      );
    }
  } catch (e) {
    console.error(
      `[whatsapp-inbound] report action reply send threw wamid=${ctx.wamid} command=${result.command}:`,
      e
    );
  }
}

/** Shared by TODAY (headline only) / YESTERDAY / FULL (everything) — reads the one RPC both the
 * daily sender and this file rely on for the same date, so they cannot disagree about a figure. */
async function dailyFiguresResult(
  ctx: ReportContext,
  command: string,
  date: string,
  full: boolean
): Promise<ReportActionResult> {
  const { data, error } = await ctx.sb.rpc('get_daily_production_report', { p_date: date });
  if (error) {
    if (isMissingRpc(error)) {
      return {
        outcome: 'error',
        command,
        reply: `Sorry ${ctx.displayName}, that is not available yet. Please try again later.`,
        detail: 'rpc missing',
      };
    }
    console.error(`[whatsapp-inbound] get_daily_production_report failed for ${command}:`, error.message);
    return {
      outcome: 'error',
      command,
      reply: `Sorry ${ctx.displayName}, I could not load that report. Please try again shortly.`,
      detail: error.message,
    };
  }

  const report = (data ?? {}) as Any;
  if (report.has_production !== true) {
    return {
      outcome: 'ok',
      command,
      reply: `Hi ${ctx.displayName}, ${report.date_label || date} has no production captured yet.`,
    };
  }

  if (!full) {
    return {
      outcome: 'ok',
      command,
      reply:
        `Production for ${report.date_label}\n\n` +
        `Cracked: ${formatFigureText(report.cracked_kg)} kg\n` +
        `SK packed: ${formatFigureText(report.sk_packed_kg)} kg\n` +
        `Wholes: ${formatFigureText(report.wholes_pct, 1)}%`,
    };
  }

  return {
    outcome: 'ok',
    command,
    reply:
      `Full production report — ${report.date_label}\n\n` +
      `Cracked: ${formatFigureText(report.cracked_kg)} kg\n` +
      `SK packed: ${formatFigureText(report.sk_packed_kg)} kg\n` +
      `Wholes: ${formatFigureText(report.wholes_pct, 1)}%\n` +
      `NIS received: ${formatFigureText(report.nis_kg)} kg\n\n` +
      `Week to date (${report.week_label}): ${formatFigureText(report.wtd_cracked_kg)} kg` +
      (report.wtd_target_kg != null
        ? ` of ${formatFigureText(report.wtd_target_kg)} kg target`
        : ' (no target set)'),
  };
}

async function actionToday(ctx: ReportContext): Promise<ReportActionResult> {
  const today = await ctx.getSastToday();
  if (!today) {
    return {
      outcome: 'error',
      command: 'TODAY',
      reply: `Sorry ${ctx.displayName}, I could not work out today's date. Please try again shortly.`,
      detail: 'sast today unavailable',
    };
  }
  return dailyFiguresResult(ctx, 'TODAY', today, false);
}

async function actionYesterday(ctx: ReportContext): Promise<ReportActionResult> {
  const today = await ctx.getSastToday();
  if (!today) {
    return {
      outcome: 'error',
      command: 'YESTERDAY',
      reply: `Sorry ${ctx.displayName}, I could not work out today's date. Please try again shortly.`,
      detail: 'sast today unavailable',
    };
  }
  return dailyFiguresResult(ctx, 'YESTERDAY', sastDatePlusDays(today, -1), true);
}

async function actionFull(ctx: ReportContext): Promise<ReportActionResult> {
  const today = await ctx.getSastToday();
  if (!today) {
    return {
      outcome: 'error',
      command: 'FULL',
      reply: `Sorry ${ctx.displayName}, I could not work out today's date. Please try again shortly.`,
      detail: 'sast today unavailable',
    };
  }
  return dailyFiguresResult(ctx, 'FULL', today, true);
}

/** Shared by WEEK and MONTH. */
async function actionPeriod(ctx: ReportContext, kind: 'week' | 'month'): Promise<ReportActionResult> {
  const command = kind.toUpperCase();
  const { data, error } = await ctx.sb.rpc('get_period_production_summary', { p_kind: kind });
  if (error) {
    if (isMissingRpc(error)) {
      return {
        outcome: 'error',
        command,
        reply: `Sorry ${ctx.displayName}, that is not available yet. Please try again later.`,
        detail: 'rpc missing',
      };
    }
    console.error(`[whatsapp-inbound] get_period_production_summary failed for ${command}:`, error.message);
    return {
      outcome: 'error',
      command,
      reply: `Sorry ${ctx.displayName}, I could not load that summary. Please try again shortly.`,
      detail: error.message,
    };
  }

  const summary = (data ?? {}) as Any;
  if (summary.ok !== true) {
    return {
      outcome: 'error',
      command,
      reply: `Sorry ${ctx.displayName}, I could not load that summary.`,
      detail: summary.error ?? null,
    };
  }

  const targetPart =
    summary.target_kg != null
      ? ` of ${formatFigureText(summary.target_kg)} kg target` +
        (summary.pct_of_target != null ? ` (${formatFigureText(summary.pct_of_target, 1)}%)` : '')
      : ' (no target set)';

  return {
    outcome: 'ok',
    command,
    reply:
      `${summary.label} (${summary.range_label})\n\n` +
      `Cracked: ${formatFigureText(summary.cracked_kg)} kg${targetPart}\n` +
      `Days left: ${summary.days_left}\n\n` +
      `Kernel sales: ${formatZar(summary.kernel_sales_zar)}\n` +
      `Oil sales: ${formatZar(summary.oil_sales_zar)}`,
  };
}

async function actionStock(ctx: ReportContext): Promise<ReportActionResult> {
  const { data, error } = await ctx.sb.rpc('get_kernel_stock_summary');
  if (error) {
    if (isMissingRpc(error)) {
      return {
        outcome: 'error',
        command: 'STOCK',
        reply: `Sorry ${ctx.displayName}, that is not available yet. Please try again later.`,
        detail: 'rpc missing',
      };
    }
    console.error('[whatsapp-inbound] get_kernel_stock_summary failed:', error.message);
    return {
      outcome: 'error',
      command: 'STOCK',
      reply: `Sorry ${ctx.displayName}, I could not load kernel stock. Please try again shortly.`,
      detail: error.message,
    };
  }

  const summary = (data ?? {}) as Any;
  const lines: Any[] = Array.isArray(summary.lines) ? summary.lines : [];
  if (lines.length === 0) {
    return {
      outcome: 'ok',
      command: 'STOCK',
      reply: `Hi ${ctx.displayName}, ${summary.label || 'no kernel stock is available right now'}.`,
    };
  }

  const body = lines.map((l) => `${l.style}: ${formatFigureText(l.kg)} kg`).join('\n');
  return {
    outcome: 'ok',
    command: 'STOCK',
    reply:
      `${summary.label}${summary.as_of ? ` (as of ${summary.as_of})` : ''}\n\n${body}\n\n` +
      `Total: ${formatFigureText(summary.total_kg)} kg`,
  };
}

async function actionAlerts(ctx: ReportContext): Promise<ReportActionResult> {
  const { data, error } = await ctx.sb.rpc('get_open_alerts_summary');
  if (error) {
    if (isMissingRpc(error)) {
      return {
        outcome: 'error',
        command: 'ALERTS',
        reply: `Sorry ${ctx.displayName}, that is not available yet. Please try again later.`,
        detail: 'rpc missing',
      };
    }
    console.error('[whatsapp-inbound] get_open_alerts_summary failed:', error.message);
    return {
      outcome: 'error',
      command: 'ALERTS',
      reply: `Sorry ${ctx.displayName}, I could not load open alerts. Please try again shortly.`,
      detail: error.message,
    };
  }

  const summary = (data ?? {}) as Any;
  const count = Number(summary.count || 0);
  if (count === 0) {
    return { outcome: 'ok', command: 'ALERTS', reply: `Hi ${ctx.displayName}, there are no open alerts right now.` };
  }

  const lines: Any[] = Array.isArray(summary.lines) ? summary.lines : [];
  const distinctCount = Number(summary.distinct_count ?? lines.length);
  const body = lines
    .map(
      (l) =>
        `[${String(l.severity || '').toUpperCase()}] ${l.text}${l.occurrences > 1 ? ` (x${l.occurrences})` : ''}`
    )
    .join('\n');

  return {
    outcome: 'ok',
    command: 'ALERTS',
    reply:
      `${count} open alert${count === 1 ? '' : 's'}` +
      (distinctCount !== count ? ` (${distinctCount} distinct)` : '') +
      `:\n\n${body}` +
      (lines.length < distinctCount ? `\n\n…and more not shown here.` : ''),
  };
}

/**
 * REPORT — the most recently published weekly/monthly report this phone was actually SENT.
 * get_latest_published_report_for_phone WRITES on every successful call: it mints a fresh
 * report_link_codes row via mint_report_link_code (migrations/20260825092000_report_link_codes.sql:225),
 * a bearer credential good for 7 days. Called at most once per inbound message (only from here).
 * The returned link_code must never be logged — it goes ONLY into the reply text below, never into
 * `detail` (which whatsapp_log_command persists).
 */
async function actionReport(ctx: ReportContext): Promise<ReportActionResult> {
  const { data, error } = await ctx.sb.rpc('get_latest_published_report_for_phone', { p_phone: ctx.from });
  if (error) {
    if (isMissingRpc(error)) {
      return {
        outcome: 'error',
        command: 'REPORT',
        reply: `Sorry ${ctx.displayName}, that is not available yet. Please try again later.`,
        detail: 'rpc missing',
      };
    }
    console.error('[whatsapp-inbound] get_latest_published_report_for_phone failed:', error.message);
    return {
      outcome: 'error',
      command: 'REPORT',
      reply: `Sorry ${ctx.displayName}, I could not load your latest report. Please try again shortly.`,
      detail: error.message,
    };
  }

  const row = (data ?? {}) as Any;
  if (row.found !== true) {
    return {
      outcome: 'ok',
      command: 'REPORT',
      reply: `Hi ${ctx.displayName}, I could not find a report that was sent to this number yet.`,
      detail: row.error ?? null,
    };
  }

  const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  if (!supabaseUrl) {
    console.error('[whatsapp-inbound] SUPABASE_URL not set — cannot build report link');
    return {
      outcome: 'error',
      command: 'REPORT',
      reply: `Sorry ${ctx.displayName}, I could not build your report link. Please try again shortly.`,
      detail: 'SUPABASE_URL not set',
    };
  }

  const link = `${supabaseUrl}/functions/v1/r/${row.link_code}`;
  return {
    outcome: 'ok',
    command: 'REPORT',
    reply: `Hi ${ctx.displayName}, here is your ${row.period_label || 'latest'} report:\n${link}\n\nThis link expires soon — ask again if it stops working.`,
  };
}

async function actionMenu(ctx: ReportContext): Promise<ReportActionResult> {
  return buildMenuResult(ctx.displayName, ctx.isStaff);
}

async function actionMute7(ctx: ReportContext): Promise<ReportActionResult> {
  const today = await ctx.getSastToday();
  if (!today) {
    return {
      outcome: 'error',
      command: 'MUTE7',
      reply: `Sorry ${ctx.displayName}, I could not work out today's date. Please try again shortly.`,
      detail: 'sast today unavailable',
    };
  }
  const mutedUntil = sastDatePlusDays(today, 7);

  const { data, error } = await ctx.sb.rpc('set_report_subscription_by_phone', {
    p_phone: ctx.from,
    p_report_kind: 'daily',
    p_is_active: true,
    p_muted_until: mutedUntil,
  });
  if (error) {
    if (isMissingRpc(error)) {
      return {
        outcome: 'error',
        command: 'MUTE7',
        reply: `Sorry ${ctx.displayName}, that is not available yet. Please try again later.`,
        detail: 'rpc missing',
      };
    }
    console.error('[whatsapp-inbound] set_report_subscription_by_phone failed (mute7):', error.message);
    return {
      outcome: 'error',
      command: 'MUTE7',
      reply: `Sorry ${ctx.displayName}, I could not pause your reports. Please try again shortly.`,
      detail: error.message,
    };
  }

  const row = (data ?? {}) as Any;
  if (row.ok !== true) {
    return {
      outcome: 'error',
      command: 'MUTE7',
      reply: `Sorry ${ctx.displayName}, I could not pause your reports.`,
      detail: row.error ?? null,
    };
  }

  return {
    outcome: 'ok',
    command: 'MUTE7',
    reply: `OK ${ctx.displayName}, your daily report is paused until ${mutedUntil}. Text START any time to turn it back on sooner.`,
  };
}

async function actionStop(ctx: ReportContext): Promise<ReportActionResult> {
  const { data, error } = await ctx.sb.rpc('set_report_subscription_by_phone', {
    p_phone: ctx.from,
    p_report_kind: 'daily',
    p_is_active: false,
    p_muted_until: null,
  });
  if (error) {
    if (isMissingRpc(error)) {
      return {
        outcome: 'error',
        command: 'STOP',
        reply: `Sorry ${ctx.displayName}, that is not available yet. Please try again later.`,
        detail: 'rpc missing',
      };
    }
    console.error('[whatsapp-inbound] set_report_subscription_by_phone failed (stop):', error.message);
    return {
      outcome: 'error',
      command: 'STOP',
      reply: `Sorry ${ctx.displayName}, I could not stop your reports. Please try again shortly.`,
      detail: error.message,
    };
  }

  const row = (data ?? {}) as Any;
  if (row.ok !== true) {
    return {
      outcome: 'error',
      command: 'STOP',
      reply: `Sorry ${ctx.displayName}, I could not stop your reports.`,
      detail: row.error ?? null,
    };
  }

  return {
    outcome: 'ok',
    command: 'STOP',
    reply: `OK ${ctx.displayName}, your daily report is stopped. Text START any time to turn it back on.`,
  };
}

async function actionStart(ctx: ReportContext): Promise<ReportActionResult> {
  const { data, error } = await ctx.sb.rpc('set_report_subscription_by_phone', {
    p_phone: ctx.from,
    p_report_kind: 'daily',
    p_is_active: true,
    p_muted_until: null,
  });
  if (error) {
    if (isMissingRpc(error)) {
      return {
        outcome: 'error',
        command: 'START',
        reply: `Sorry ${ctx.displayName}, that is not available yet. Please try again later.`,
        detail: 'rpc missing',
      };
    }
    console.error('[whatsapp-inbound] set_report_subscription_by_phone failed (start):', error.message);
    return {
      outcome: 'error',
      command: 'START',
      reply: `Sorry ${ctx.displayName}, I could not turn your reports back on. Please try again shortly.`,
      detail: error.message,
    };
  }

  const row = (data ?? {}) as Any;
  if (row.ok !== true) {
    return {
      outcome: 'error',
      command: 'START',
      reply: `Sorry ${ctx.displayName}, I could not turn your reports back on.`,
      detail: row.error ?? null,
    };
  }

  return { outcome: 'ok', command: 'START', reply: `OK ${ctx.displayName}, your daily report is back on.` };
}

const REPORT_HELP_LIST_STAFF =
  'MENU — show the report menu\n' +
  'TODAY, YESTERDAY, WEEK, MONTH, FULL — production figures\n' +
  'STOCK — kernel stock on hand\n' +
  'ALERTS — open alerts\n' +
  'REPORT — link to your latest report\n' +
  'MUTE (or PAUSE) — pause your daily report for 7 days\n' +
  'STOP — stop your daily report\n' +
  'START — turn your daily report back on';

const REPORT_HELP_LIST_SUBSCRIBER =
  'MENU — show the report menu\n' +
  'REPORT — link to your latest report\n' +
  'MUTE (or PAUSE) — pause your daily report for 7 days\n' +
  'STOP — stop your daily report\n' +
  'START — turn your daily report back on';

async function actionHelp(ctx: ReportContext): Promise<ReportActionResult> {
  const list = ctx.isStaff ? REPORT_HELP_LIST_STAFF : REPORT_HELP_LIST_SUBSCRIBER;
  return {
    outcome: 'ok',
    command: 'HELP',
    reply: `Hi ${ctx.displayName}, here is what I can do:\n\n${list}\n\nText MENU any time for a tappable list.`,
  };
}

const ACTION_HANDLERS: Record<ReportAction, (ctx: ReportContext) => Promise<ReportActionResult>> = {
  today: actionToday,
  yesterday: actionYesterday,
  week: (ctx) => actionPeriod(ctx, 'week'),
  month: (ctx) => actionPeriod(ctx, 'month'),
  full: actionFull,
  stock: actionStock,
  alerts: actionAlerts,
  report: actionReport,
  menu: actionMenu,
  mute7: actionMute7,
  stop: actionStop,
  start: actionStart,
  help: actionHelp,
};

/**
 * Runs once per inbound message, after it is already persisted. Never throws — any unexpected
 * error is caught, logged (console + audit row), and swallowed so the caller's 2xx response is
 * unaffected.
 *
 * Dispatches EVERY message kind classifyMessage can return for an actual message (never
 * extractMessage, which reads only the envelope's first message and is the wrong tool for a
 * per-message loop): text, button_reply and list_reply. 'status' and 'unsupported' return
 * immediately — a status never reaches this function's caller in the first place (see the
 * messages[]-loop-only comment at the call site), and 'unsupported' has nothing to command off.
 */
async function processCommandForMessage(
  sb: SupabaseClient,
  msg: Any,
  from: string,
  wamid: string,
  senderName: string | undefined
): Promise<void> {
  const classified = classifyMessage(msg, senderName);
  if (classified.kind === 'status' || classified.kind === 'unsupported') {
    return;
  }

  const rawBody = classified.kind === 'text' ? classified.text : classified.replyId;

  // Memoizing closures: report_recipient_by_inbound_phone and report_sast_today are each called
  // AT MOST ONCE per inbound message, no matter how many places below want the same answer.
  let recipientFetched = false;
  let recipientCache: Any = null;
  const getRecipient = async (): Promise<Any> => {
    if (recipientFetched) return recipientCache;
    recipientFetched = true;
    try {
      const { data, error } = await sb.rpc('report_recipient_by_inbound_phone', { p_phone: from });
      if (error) {
        if (isMissingRpc(error)) {
          console.error(
            '[whatsapp-inbound] report_recipient_by_inbound_phone is missing — migration 20260825090000 not applied.'
          );
          return (recipientCache = null);
        }
        console.error('[whatsapp-inbound] report_recipient_by_inbound_phone failed:', error.message);
        return (recipientCache = null);
      }
      return (recipientCache = data ?? null);
    } catch (e) {
      console.error('[whatsapp-inbound] report_recipient_by_inbound_phone threw:', e);
      return (recipientCache = null);
    }
  };

  let sastFetched = false;
  let sastCache: string | null = null;
  const getSastToday = async (): Promise<string | null> => {
    if (sastFetched) return sastCache;
    sastFetched = true;
    try {
      const { data, error } = await sb.rpc('report_sast_today');
      if (error) {
        if (isMissingRpc(error)) {
          console.error('[whatsapp-inbound] report_sast_today is missing — migration 20260825090000 not applied.');
          return (sastCache = null);
        }
        console.error('[whatsapp-inbound] report_sast_today failed:', error.message);
        return (sastCache = null);
      }
      return (sastCache = typeof data === 'string' ? data : null);
    } catch (e) {
      console.error('[whatsapp-inbound] report_sast_today threw:', e);
      return (sastCache = null);
    }
  };

  /** Resolves the recipient row (if any), tier-checks, runs the handler, and makes exactly one
   * deliverActionResult call. Silent — no send, no audit row — when the phone is not a known
   * report recipient at all: mirrors the existing not_enrolled silence below, for the same
   * reason (an unsolicited reply to an arbitrary number is worse than nothing). */
  const dispatchAction = async (action: ReportAction): Promise<void> => {
    const recipient = await getRecipient();
    if (!recipient || recipient.found !== true) {
      return;
    }

    const isStaff = recipient.is_staff === true;
    const ctx: ReportContext = {
      sb,
      from,
      wamid,
      displayName: String(recipient.display_name || 'there'),
      isStaff,
      userId: recipient.user_id ?? null,
      recipient,
      getSastToday,
    };

    if (STAFF_ONLY_ACTIONS.has(action) && !isStaff) {
      await deliverActionResult(ctx, rawBody, {
        outcome: 'denied',
        command: action.toUpperCase(),
        reply: `Sorry ${ctx.displayName}, production figures are only available to staff numbers.`,
      });
      return;
    }

    let result: ReportActionResult;
    try {
      result = await ACTION_HANDLERS[action](ctx);
    } catch (e) {
      console.error(`[whatsapp-inbound] report action ${action} threw wamid=${wamid}:`, e);
      result = {
        outcome: 'error',
        command: action.toUpperCase(),
        reply: `Sorry ${ctx.displayName}, something went wrong with that request. Please try again shortly.`,
        detail: String(e),
      };
    }
    await deliverActionResult(ctx, rawBody, result);
  };

  try {
    if (classified.kind === 'button_reply' || classified.kind === 'list_reply') {
      const action = resolveAction(classified.replyId) ?? lookupAlias(classified.replyTitle) ?? lookupAlias(classified.replyId);
      if (action) {
        await dispatchAction(action);
      }
      // An unrecognised tap (neither this file's own reply id nor a known legacy alias) is
      // silently ignored — there is nothing sensible to reply to a stale or foreign payload.
      return;
    }

    // classified.kind === 'text' from here — the existing staff command system, unchanged, with
    // one insertion point per branch for the report-action alias check.
    let resolved: Any;
    try {
      const { data, error } = await sb.rpc('whatsapp_resolve_staff_user', { p_phone: from });
      if (error) {
        if (isMissingRpc(error)) {
          console.error(
            '[whatsapp-inbound] whatsapp_resolve_staff_user is missing — migration 20260815100000 not applied.'
          );
          return;
        }
        throw error;
      }
      resolved = Array.isArray(data) ? data[0] : data;
    } catch (e) {
      console.error(`[whatsapp-inbound] staff resolution failed wamid=${wamid}:`, e);
      await logCommand(sb, {
        phone: from,
        userId: null,
        wamid,
        rawBody,
        command: null,
        outcome: 'error',
        detail: String(e),
      });
      return;
    }

    if (!resolved || resolved.success !== 1) {
      // Unenrolled as portal staff. The ONLY exceptions are a body that is exactly six digits —
      // try it as an enrolment code — or a recognised report-action alias (e.g. "STOP"). Anything
      // else is untouched: behaviour identical to before this plan.
      const trimmedBody = rawBody.trim();
      if (/^\d{6}$/.test(trimmedBody)) {
        await tryConfirmEnrolment(sb, from, wamid, rawBody, trimmedBody);
        return;
      }

      const action = lookupAlias(trimmedBody);
      if (action) {
        await dispatchAction(action);
        return;
      }

      // The number may well be a customer — an unsolicited "you are not enrolled" would be
      // worse than silence. Log only; send nothing.
      await logCommand(sb, {
        phone: from,
        userId: null,
        wamid,
        rawBody,
        command: null,
        outcome: 'not_enrolled',
        detail: resolved?.error ?? 'not resolved',
      });
      return;
    }

    // Resolved as portal staff. A recognised report-action alias (e.g. "STOCK") is dispatched
    // through the report-action system instead of falling through to handleCommand — "HELP"
    // is not in the alias table, so it keeps reaching commandHelp exactly as before.
    const reportAction = lookupAlias(rawBody.trim());
    if (reportAction) {
      await dispatchAction(reportAction);
      return;
    }

    const ctx: CommandContext = {
      sb,
      phone: from,
      wamid,
      rawBody,
      userId: String(resolved.user_id),
      roleId: resolved.role_id != null ? String(resolved.role_id) : null,
      displayName: String(resolved.display_name || 'there'),
    };

    const result = await handleCommand(ctx);

    await logCommand(sb, {
      phone: from,
      userId: ctx.userId,
      wamid,
      rawBody,
      command: result.command,
      outcome: result.outcome,
      detail: result.detail ?? null,
    });

    if (result.reply) {
      const sent = await sendText(from, result.reply);
      if (!sent.ok) {
        console.error(`[whatsapp-inbound] command reply send failed wamid=${wamid}: ${sent.error}`);
      }
    }
  } catch (e) {
    // Backstop for anything unexpected above (e.g. a bug in a future command handler).
    // The function must still return 2xx — never let this escape to the caller.
    console.error(`[whatsapp-inbound] command handling failed wamid=${wamid}:`, e);
    await logCommand(sb, {
      phone: from,
      userId: null,
      wamid,
      rawBody,
      command: null,
      outcome: 'error',
      detail: String(e),
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // GET is a health check, not Meta's verification handshake — Control Room owns that
  // handshake and no hub.challenge reaches us. Answer 200 so anything validating that
  // this destination resolves (Control Room's own probe included) sees a live endpoint
  // rather than a 405 it could reasonably treat as unhealthy. Deliberately reports only
  // whether the forward secret is configured — never the secret, and no payload is
  // accepted or processed on this path.
  if (req.method === 'GET') {
    return json({
      success: true,
      function: 'whatsapp-inbound',
      ready: Boolean(Deno.env.get('CONTROL_ROOM_FORWARD_SECRET')),
      note: 'Signed POST forwards only; GET is a health check.',
    });
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed.' }, 405);
  }

  const forwardSecret = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET');
  if (!forwardSecret) {
    console.error('[whatsapp-inbound] CONTROL_ROOM_FORWARD_SECRET is not set — cannot verify forwards');
    return json(
      { success: false, error: 'WhatsApp not yet connected — CONTROL_ROOM_FORWARD_SECRET required' },
      503
    );
  }

  // Read the raw body ONCE and use this exact string for both signature verification
  // and JSON.parse. Parsing then re-stringifying before hashing breaks the HMAC.
  let raw: string;
  try {
    raw = await req.text();
  } catch (e) {
    console.error('[whatsapp-inbound] failed to read body:', e);
    return json({ success: false, error: 'Unreadable body.' }, 400);
  }

  const header = (req.headers.get('x-control-room-signature') || '').trim();
  if (!header) {
    console.warn('[whatsapp-inbound] rejected: missing X-Control-Room-Signature');
    return json({ success: false, error: 'Missing signature.' }, 401);
  }

  const provided = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;
  const expected = await hmacHex(forwardSecret, raw);
  if (!timingSafeEqual(provided.toLowerCase(), expected)) {
    console.warn('[whatsapp-inbound] rejected: signature mismatch');
    return json({ success: false, error: 'Invalid signature.' }, 401);
  }

  // Verified from here on. Everything below returns 2xx so Control Room does not
  // record a false failure — there are no retries, a false failure loses nothing but
  // pollutes their log, while a real persist failure is ours to shout about.
  let payload: Any;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error('[whatsapp-inbound] verified payload is not JSON:', e);
    return json({ success: true, ingested: 0, statuses: 0, note: 'unparseable payload' });
  }

  const sb = makeServiceClient();
  let ingested = 0;
  let deduped = 0;
  let statuses = 0;
  let failures = 0;
  let schemaMissing = false;

  const entries: Any[] = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes: Any[] = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value ?? {};

      // Profile name for the far end, when Meta included one.
      const contactsArr: Any[] = Array.isArray(value?.contacts) ? value.contacts : [];
      const profileByWaId = new Map<string, string>();
      for (const c of contactsArr) {
        const waId = String(c?.wa_id ?? '').trim();
        const name = String(c?.profile?.name ?? '').trim();
        if (waId && name) profileByWaId.set(waId, name);
      }
      const fallbackProfile = String(contactsArr[0]?.profile?.name ?? '').trim() || null;

      // --- inbound messages: persist first, everything else after ---
      const messages: Any[] = Array.isArray(value?.messages) ? value.messages : [];
      for (const msg of messages) {
        const wamid = String(msg?.id ?? '').trim();
        const from = String(msg?.from ?? '').trim();

        if (!wamid || !from) {
          console.warn('[whatsapp-inbound] skipping message with no id or from:', JSON.stringify(msg));
          continue;
        }

        const { data, error } = await sb.rpc('chat_ingest_inbound_whatsapp', {
          p_from_phone: from,
          p_wamid: wamid,
          p_body: bodyForMessage(msg),
          p_message_type: String(msg?.type ?? 'unknown'),
          p_profile_name: profileByWaId.get(from) ?? fallbackProfile,
          p_sent_at: metaTimestampToIso(msg?.timestamp),
        });

        if (error) {
          if (isMissingRpc(error)) {
            schemaMissing = true;
            console.error(
              `[whatsapp-inbound] chat_ingest_inbound_whatsapp is missing — migration 20260813090000 not applied. DROPPED wamid=${wamid} from=${from}`
            );
            break;
          }
          failures++;
          console.error(`[whatsapp-inbound] PERSIST FAILED wamid=${wamid} from=${from}:`, error.message);
          continue;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || row.success !== 1) {
          failures++;
          console.error(
            `[whatsapp-inbound] PERSIST REJECTED wamid=${wamid} from=${from}: ${row?.error ?? 'empty response'}`
          );
          continue;
        }

        if (row.deduped) {
          deduped++;
        } else {
          ingested++;

          // Command dispatch — only for a message actually ingested this call (a deduped
          // redelivery of the same wamid must not re-run a command), only here inside the
          // messages[] loop, and NEVER from the statuses[] loop below (our own replies
          // generate statuses, which would be an infinite loop).
          await processCommandForMessage(
            sb,
            msg,
            from,
            wamid,
            sanitizeSenderName(profileByWaId.get(from) ?? fallbackProfile)
          );
        }
      }

      if (schemaMissing) break;

      // --- delivery receipts for messages we sent ---
      const statusArr: Any[] = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const st of statusArr) {
        const wamid = String(st?.id ?? '').trim();
        const status = String(st?.status ?? '').trim();
        if (!wamid || !status) continue;

        const errText = Array.isArray(st?.errors) && st.errors.length
          ? String(st.errors[0]?.title ?? st.errors[0]?.message ?? '').trim() || null
          : null;

        const { error } = await sb.rpc('chat_record_whatsapp_status', {
          p_wamid: wamid,
          p_status: status,
          p_error: errText,
        });

        if (error) {
          if (isMissingRpc(error)) {
            schemaMissing = true;
            console.error(
              '[whatsapp-inbound] chat_record_whatsapp_status is missing — migration 20260813090000 not applied.'
            );
            break;
          }
          console.error(`[whatsapp-inbound] status update failed wamid=${wamid} status=${status}:`, error.message);
          continue;
        }

        statuses++;
      }

      if (schemaMissing) break;
    }

    if (schemaMissing) break;
  }

  if (schemaMissing) {
    // 200 on purpose: retrying would not help, and a 5xx loop just fills logs.
    return json({ success: true, ingested, deduped, statuses, note: 'schema not migrated yet' });
  }

  if (ingested || deduped || statuses || failures) {
    console.log(
      `[whatsapp-inbound] ingested=${ingested} deduped=${deduped} statuses=${statuses} failures=${failures}`
    );
  }

  return json({ success: failures === 0, ingested, deduped, statuses, failures });
});
