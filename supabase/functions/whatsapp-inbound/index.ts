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
// Outbound reply — a small, deliberately duplicated send path.
//
// supabase/functions/send-whatsapp-message/index.ts cannot be reused here: it requires an
// X-Portal-Session header validated via assistant_validate_session and fails closed with no
// bypass, because without that check anyone holding the public anon key (which ships in the
// browser) could send WhatsApp messages through that channel. This webhook has no portal
// session — it is a server-to-server call authenticated by the Control Room HMAC — so it posts
// to Control Room's meta-proxy directly, signed the same way. Do not add a service-role bypass to
// send-whatsapp-message instead — this ~25-line duplication is the deliberate trade-off. The two
// payload shapes must stay in step by hand.
//
// ⚠ SUPERSEDED 2026-08-25 — the clause that used to stand here, "TEXT ONLY. Do not add an
// interactive/button send here (unconfirmed external contract)", no longer applies. The reason it
// existed was that nobody here had read the gateway. Somebody has now: meta-proxy's
// shapeMetaContent was read from the deployed source, and it forwards `template` as-is and
// `interactive` unchanged. The shapes are recorded, with their provenance, in the header of
// supabase/functions/_shared/wa-send.ts.
//
// So an interactive/button reply from this webhook is now allowed — but send it through
// _shared/wa-send.ts (`sendButtons`, `sendList`, `sendTemplate`), NOT by extending the local
// sendWhatsappText below into a second hand-rolled payload builder. The local function stays
// text-only on purpose: it is the deliberate duplication described above, and widening it would
// make a third place where the Control Room envelope has to be kept in step by hand.
// ============================================================================

const CONTROL_ROOM_BASE_URL = 'https://ejnncypummmvyojhovme.supabase.co/functions/v1';

/**
 * Sends a plain-text WhatsApp reply via Control Room's meta-proxy. Never throws — a failed
 * reply must never turn an already-ingested message into a function error. Returns whether the
 * send succeeded, purely for logging; callers must not retry.
 */
async function sendWhatsappText(toPhone: string, text: string): Promise<boolean> {
  const forwardSecret = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET');
  const channelSlug = Deno.env.get('CONTROL_ROOM_CHANNEL_SLUG');

  if (!forwardSecret || !channelSlug) {
    console.error(
      '[whatsapp-inbound] CONTROL_ROOM_CHANNEL_SLUG is not set — skipping reply (message is already ingested)'
    );
    return false;
  }

  const requestBody = JSON.stringify({
    action: 'send_message',
    channelSlug,
    to: toPhone,
    type: 'text',
    content: { text },
  });

  try {
    const res = await fetch(`${CONTROL_ROOM_BASE_URL}/meta-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Control-Room-Signature': `sha256=${await hmacHex(forwardSecret, requestBody)}`,
      },
      body: requestBody,
    });

    const result = await res.json().catch(() => ({} as Any));
    if (!res.ok || !(result as Any)?.ok) {
      console.error(
        `[whatsapp-inbound] reply send rejected: ${(result as Any)?.error || res.statusText}`
      );
      return false;
    }
    return true;
  } catch (e) {
    console.error('[whatsapp-inbound] reply send threw:', e);
    return false;
  }
}

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
    const sent = await sendWhatsappText(from, reply);
    if (!sent) console.error(`[whatsapp-inbound] enrolment confirmation reply failed wamid=${wamid}`);
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

/**
 * Runs once per inbound TEXT message, after it is already persisted. Never throws — any
 * unexpected error is caught, logged (console + audit row), and swallowed so the caller's 2xx
 * response is unaffected.
 */
async function processCommandForMessage(
  sb: SupabaseClient,
  msg: Any,
  from: string,
  wamid: string
): Promise<void> {
  if (String(msg?.type ?? '') !== 'text') {
    // Non-text messages already store a placeholder body; never try to command off one.
    return;
  }

  const rawBody = String(msg?.text?.body ?? '');

  try {
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
      // Unenrolled. The ONLY exception is a body that is exactly six digits — try it as an
      // enrolment code. Anything else is untouched: behaviour identical to before this plan.
      const trimmedBody = rawBody.trim();
      if (/^\d{6}$/.test(trimmedBody)) {
        await tryConfirmEnrolment(sb, from, wamid, rawBody, trimmedBody);
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
      const sent = await sendWhatsappText(from, result.reply);
      if (!sent) console.error(`[whatsapp-inbound] command reply send failed wamid=${wamid}`);
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
          await processCommandForMessage(sb, msg, from, wamid);
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
