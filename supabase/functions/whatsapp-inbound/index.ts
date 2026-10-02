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
 * - MENU TAPS dispatch too: a type:'interactive' list_reply/button_reply, and the type:'button'
 *   shape Meta uses for a quick-reply tap on an approved template, are dispatched on their REPLY
 *   ID (`menu:<action>`, via buildReplyId/parseReplyId in _shared/wa-send.ts) — never on the row's
 *   display title, so rewording a label cannot break a menu and a handset cannot pick a command
 *   by sending text that happens to match one. Every other non-text type still returns early.
 * - The menu itself is role-filtered on the SAME public.features keys as the portal sidebar
 *   (get_role_features_for_role), and every item is READ-ONLY, rendered from get_daily_digest().
 *   A tap is re-checked against the role's current features before anything is rendered: the id
 *   is a request, not an authorisation. See "The menu" section below.
 * - Enrolment REQUIRES supabase/functions/whatsapp-enrol-staff — the function that mints a code
 *   via whatsapp_start_enrolment and texts it to the handset. Until that existed nothing in the
 *   repo called whatsapp_start_enrolment, so no number could become enrolled and none of the
 *   dispatch below was reachable by anyone.
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
 * - A "Mark resolved" tap on the macavation_alert PUSH template (sent unprompted by
 *   send-alert-whatsapp, not requested via this menu) dispatches on an ALERT_NS reply id carrying a
 *   truncated alert reference, resolved back to a real alert by resolve_dashboard_alert_by_ref and
 *   staged through the SAME commandAck function ACK <n> uses — see ALERT_NS/ALERT_ACK_ACTION and
 *   dispatchAlertAck below.
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
  buildReplyId,
  parseReplyId,
  sendButtons,
  sendFlow,
  sendList,
  toWaPhone,
  type WaFlowRow,
} from '../_shared/wa-send.ts';
import { MAX_LIST_ROWS, MAX_LIST_TITLE, truncate } from '../_shared/wa-limits.ts';
import { classifyMessage } from '../_shared/wa-inbound.ts';

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
//
// AS OF THE MENU, BOTH PATHS ARE LIVE IN THIS FILE, exactly as the paragraph above prescribes:
// every TEXT reply still goes through the local sendWhatsappText, and the one interactive send
// (the list menu, in commandMenu) goes through sendList from _shared/wa-send.ts. That is not an
// oversight to tidy up by collapsing them — sendWhatsappText addresses the recipient as Meta
// delivered it (bare digits) while the shared module documents '+' -form input via toWaPhone, and
// the shared senders read CONTROL_ROOM_* at module scope. Leave the split alone.
// ============================================================================

const CONTROL_ROOM_BASE_URL = 'https://dev-control-room-supabase.customapp.co.za/functions/v1';

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
// Command dispatch — HELP, the generic YES/NO confirm-cancel flow, the menu, and the typed verbs.
// A write command is added by registering an entry in STAGED_COMMAND_HANDLERS below (keyed on the
// pending command's `command` value) and, separately, a verb in COMMAND_HANDLERS (keyed on what the
// user types) — not by restructuring this. ACK/ACK_ALERT is the worked example.
// ============================================================================

interface CommandContext {
  sb: SupabaseClient;
  phone: string;
  wamid: string;
  rawBody: string;
  userId: string;
  roleId: string | null;
  displayName: string;
  /**
   * Set ONLY for a menu tap (interactive list_reply / button_reply, and a quick-reply tap on a
   * template, which Meta delivers as type:'button' rather than 'interactive'). It is the reply
   * ID — a stable `menu:<action>` string built by buildReplyId — never the row's display text.
   *
   * Dispatching on the title would mean rewording a row silently broke it, and would let a
   * handset choose the command by sending arbitrary text that happened to match a label. When
   * this is set, rawBody carries the same id for the audit log, not the visible title.
   */
  replyId?: string | null;
}

interface CommandResult {
  outcome: 'ok' | 'unknown_command' | 'denied' | 'error';
  reply: string | null;
  command: string | null;
  detail?: string | null;
}

// ============================================================================
// The menu — what an enrolled staff member sees after they are identified.
//
// EVERY DIGEST-BACKED ITEM IS READ-ONLY. Each of those renders from get_daily_digest(), the same
// RPC the 17:00 digest sends (send-daily-digest-whatsapp/index.ts:82), so none of them need the
// YES/NO staging flow. The one exception is "My reports" (see MenuItem.subMenu and the settings
// branch below it in this file): it is the member's OWN settings, writes directly for four of its
// five rows, and stages the fifth ("Stop everything") through the SAME whatsapp_stage_pending_command
// flow a future write command would use.
//
// GATED ON THE SAME FEATURE KEYS AS THE PORTAL SIDEBAR, WITH ONE EXCEPTION. `feature` is a
// public.features.key, read per role via get_role_features_for_role — the same mechanism
// menuFilter uses in the browser. So a role sees on WhatsApp exactly the business-data areas it
// can already open in the portal, and there is no second, drifting permission model to maintain. A
// role with none of these features enabled gets told so rather than shown an empty list. "My
// reports" is the one item with `feature: null` — it is the member's own settings, not a
// business-data view, so it is visible to every enrolled staff member regardless of role.
//
// KEY CONVENTION, FIXED: 0 is always "back" and 99 is always "main menu", on every step. Never
// introduce another key for either, and never use the legacy 9. This menu is one level deep, so
// both land on the main menu; the handlers exist so the convention holds the moment a second
// level is added.
//
// NUMBERS WORK TOO. A row title is display text and must never be dispatched on — taps come back
// as a reply id (`menu:<action>`, built and parsed by buildReplyId/parseReplyId in
// _shared/wa-send.ts), and typed input is matched on the item's POSITION in this same
// role-filtered list. That is what makes the plain-text fallback below usable rather than
// decorative: whether the handset renders the list or not, "3" means the third row it was shown.
// ============================================================================

interface MenuItem {
  /** Reply-id action segment. Must satisfy buildReplyId's segment rule: [a-z0-9][a-z0-9_-]{0,23} */
  action: string;
  /** Row title. Capped at MAX_LIST_TITLE (24) by buildListBody, which THROWS rather than truncating. */
  title: string;
  /**
   * public.features.key that must be 'true' for this role, or `null` for an item that is the
   * member's OWN settings rather than a business-data view — visible to every enrolled staff
   * member regardless of role. `null` is a deliberate special case (see visibleItems below), not a
   * placeholder: a fake feature key here would make the item disappear for any role nobody
   * remembered to grant it to.
   */
  feature: string | null;
  /**
   * Renders from the shared get_daily_digest() payload. Exactly one of `render`, `resolve` or
   * `subMenu` must be set. `canAct` is the result of the item's own `needsAction` check (false
   * when it declares none) — passed in rather than looked up here so `render` stays synchronous
   * and pure.
   */
  render?: (digest: Any, canAct?: boolean) => string;
  /**
   * For an item whose answer depends on WHO is asking rather than on the shared digest. The digest
   * is never fetched for a `resolve` item, so a broken digest cannot make this item report a
   * failure that has nothing to do with it.
   */
  resolve?: (ctx: CommandContext) => Promise<string>;
  /**
   * For an item that opens its OWN interactive sub-list rather than rendering text — it sends its
   * own message via sendList (exactly like commandMenu itself) and returns `reply: null`, so
   * renderMenuItem must return whatever this yields directly rather than wrapping it.
   */
  subMenu?: (ctx: CommandContext) => Promise<CommandResult>;
  /**
   * Optional action key whose grant this item's wording depends on (NOT its visibility — that is
   * `feature`). Resolved by renderMenuItem and handed to `render` as `canAct`.
   */
  needsAction?: string;
}

/**
 * A figure, or an em dash when there ISN'T one.
 *
 * The null/empty-string guard is the whole job and must not be dropped: `Number(null)` and
 * `Number('')` are both 0, and 0 is finite, so a Number.isFinite check ALONE reports a missing
 * figure as a real zero. get_daily_digest() returns genuine nulls today — runway.weeks_cover and
 * produced_vs_target.target_kg are both null on the dev dataset — and "Cover: 0,0 weeks" is a
 * materially different (and wrong) statement from "cover not calculable".
 *
 * en-ZA to match the portal's own 22 toLocaleString call sites, so a figure read on WhatsApp is
 * punctuated the same way as the same figure on the dashboard.
 */
function num(v: unknown, dp = 0): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-ZA', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** A percentage, or an em dash when absent. Same null trap as num — see there. */
function pct(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—';
}

/**
 * How many alerts the open-alerts view lists before it says "…and N more". ACK <n> is a position in
 * THAT list, so this is also the largest number ACK will accept.
 */
const ALERT_LIST_MAX = 10;

/**
 * public.has_action(user, action_key) — the server-side action gate.
 *
 * FAILS CLOSED on any error, including the RPC being absent: this function runs as service_role,
 * which bypasses RLS, so a failed authorization check must never read as "allowed".
 *
 * Called directly rather than through any array-normalising helper because has_action returns a
 * bare boolean, not a TABLE — the same reasoning recorded at
 * send-report-whatsapp/index.ts:126-140, which is the precedent this follows.
 */
async function hasAction(sb: SupabaseClient, userId: string, actionKey: string): Promise<boolean> {
  try {
    const { data, error } = await sb.rpc('has_action', {
      p_user_id: userId,
      p_action_key: actionKey,
    });
    if (error) {
      console.error(`[whatsapp-inbound] has_action(${actionKey}) failed:`, error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error(`[whatsapp-inbound] has_action(${actionKey}) threw:`, e);
    return false;
  }
}

/** A date, or an em dash when there isn't one. Same null trap as num — see there. */
function shortDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The open-alerts view. PURE — no client, no I/O — so verify-wa-staff-menu can re-declare and test
 * it. Numbered because ACK <n> resolves by position in THIS list.
 *
 * `canAck` is public.has_action(user, 'alerts.resolve'), resolved by the caller. The ACK line is
 * withheld when false so nobody is invited to use a command they cannot run; withholding the line
 * is presentation only — commandAck re-checks the same key server-side.
 */
function formatOpenAlerts(d: Any, canAck: boolean): string {
  const alerts: Any[] = Array.isArray(d?.open_alerts) ? d.open_alerts : [];
  if (alerts.length === 0) return '*Open alerts*\n\nNothing open. ✅';
  // Cap the transcript, not the count: the number is the fact that matters, and a WhatsApp
  // message listing 40 alerts is unreadable.
  const shown = alerts.slice(0, ALERT_LIST_MAX);
  const lines = shown.map(
    (a, i) => `${i + 1}. ${String(a?.title ?? 'Untitled')} (${String(a?.severity ?? '—')})`
  );
  const more = alerts.length > shown.length ? `\n\n…and ${alerts.length - shown.length} more.` : '';
  const ack = canAck ? '\n\nReply ACK <number> to acknowledge one.' : '';
  return `*Open alerts · ${alerts.length}*\n\n${lines.join('\n')}${more}${ack}`;
}

/**
 * The latest-report reply. PURE. `url` is null when there is nothing to link to.
 *
 * Built ONLY from what get_latest_published_report_for_phone actually returns —
 * { found, period_label, published_at, link_code, expires_at }
 * (migrations/20260825092000_report_link_codes.sql:231-237). There is no report name and no
 * publisher in that payload, so this must not claim either. The link lifetime is read from
 * expires_at rather than restated, so changing the TTL at :225 cannot leave this message lying.
 */
function formatLatestReportReply(res: Any, displayName: string, url: string | null): string {
  if (res === 'error' || (res && res.found !== true && res.error)) {
    return (
      `*Latest report*\n\n` +
      `Sorry ${displayName}, I could not fetch your report just now. Please try again shortly.`
    );
  }
  if (!res || res.found !== true || !url) {
    return (
      `*Latest report*\n\n` +
      `There is no published report on your number yet. Once one is sent to you, you can fetch ` +
      `it here.`
    );
  }
  return (
    `*Latest report*\n\n` +
    `${String(res.period_label ?? 'Latest period')}\n` +
    `Published ${shortDate(res.published_at)}\n\n` +
    `Open the full report:\n${url}\n\n` +
    `This link works until ${shortDate(res.expires_at)}.`
  );
}

/**
 * The short-link URL for a report code.
 *
 * The host comes from SUPABASE_URL at runtime — NEVER a hardcoded domain. A literal host would send
 * production users to dev or vice versa and no check in this repo would catch it. `r` accepts
 * /r/<code> or ?c=<code> (supabase/functions/r/index.ts:3-4); the path form is used here.
 * Returns null when SUPABASE_URL is unset, so the caller sends the not-found reply rather than a
 * malformed link.
 */
function buildReportUrl(linkCode: unknown): string | null {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
  const code = String(linkCode ?? '').trim();
  if (!base || !code) return null;
  return `${base}/functions/v1/r/${encodeURIComponent(code)}`;
}

/**
 * A markdown table wrapping ONE menu item's render() output — reused verbatim from MENU_ITEMS
 * below rather than re-derived, so the Flow screen and the plain-text WhatsApp reply for the same
 * item can never disagree. render() already returns WhatsApp markdown (*bold*, not #/|), which
 * renders correctly enough inside a Flow's RichText for this frozen-at-send-time spike — a
 * cleaner Flow-specific renderer is future work, not required for this first version.
 */
function flowDetailMarkdown(title: string, rendered: string): string {
  return `# ${title}\n\n${rendered}\n\nAs of ${statsAsOfSAST()}`;
}

/** Same "As of {time}" stamp shopaholic-whatsapp's admin-stats Flow uses, SAST, since a Flow
 * bubble (unlike a text message) never expires and could be tapped long after the numbers went
 * stale. */
function statsAsOfSAST(): string {
  const sast = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return `${sast.toISOString().slice(0, 16).replace('T', ' ')} SAST`;
}

/**
 * Builds the Flow rows for the six digest-backed MENU_ITEMS (production, stock, yield, alerts,
 * intake, digest) — one row per item, each opening the Flow's DETAIL screen with that item's own
 * render() output. Reused verbatim by commandMenu's Flow-first branch below, so the Flow screen
 * and the plain-text degrade for the same item can never disagree.
 *
 * FROZEN AT SEND TIME, not live: every row's figures are baked into the Flow launch payload from
 * the ONE `digest` passed in, never re-fetched while the member is browsing the Flow's screens.
 * Opening the Flow at 22:00 still shows whatever get_daily_digest() returned when it was sent,
 * same staleness the plain-text menu already has. A live, re-fetch-per-screen version needs
 * Meta's `data_exchange` Flow mode, which needs a working encryption handshake AND a Control Room
 * routing path this repo does not have yet — see .cursor/plans/wa-flow-data-exchange-spike.md.
 */
function addContactFlowRow(): WaFlowRow {
  return {
    id: 'addcontact',
    'main-content': { title: 'Add contact', metadata: 'Add a supplier or customer' },
    'on-click-action': {
      name: 'navigate',
      next: { type: 'screen', name: WA_FLOW_ADD_CONTACT_SCREEN_ID },
      payload: {},
    },
  };
}

function buildDigestFlowRows(items: MenuItem[], digest: Any): WaFlowRow[] {
  return items.map((item) => {
    const rendered = item.render!(digest, false);
    // metadata: a short one-line preview under the row title — first non-empty line after the
    // render()'s own leading "*Title*" heading, truncated defensively (Meta's own metadata field
    // has a real length cap this repo has not needed to measure yet, since every existing render()
    // output is already short).
    const lines = rendered.split('\n').filter((l) => l.trim().length > 0);
    const preview = (lines[1] ?? lines[0] ?? '').replace(/^\*|\*$/g, '').slice(0, 80);
    return {
      id: item.action,
      'main-content': { title: item.title, metadata: preview },
      'on-click-action': {
        name: 'navigate',
        next: { type: 'screen', name: 'DETAIL' },
        payload: { body_markdown: flowDetailMarkdown(item.title, rendered) },
      },
    };
  });
}

const MENU_ITEMS: MenuItem[] = [
  {
    action: 'production',
    title: 'Production today',
    feature: 'dashboard',
    render: (d) => {
      const ks = d?.kernel_stats ?? {};
      const oil = d?.oil_stats ?? {};
      return (
        `*Production · ${d?.date ?? 'today'}*\n\n` +
        `Kernel cracked: ${num(ks.kg_cracked_today)} kg today, ${num(ks.kg_cracked_week)} kg this week\n` +
        `Kernel packed: ${num(ks.kg_packed_today)} kg today, ${num(ks.kg_packed_week)} kg this week\n` +
        `Oil: ${num(oil.litres_today)} L today, ${num(oil.litres_week)} L this week\n` +
        `Batches in production: ${num(ks.batches_in_production)}`
      );
    },
  },
  {
    action: 'stock',
    title: 'Stock & runway',
    feature: 'stock-management-kernel',
    render: (d) => {
      const ext = d?.extended_kpis ?? {};
      const runway = d?.runway ?? {};
      const weeks = runway.weeks_cover;
      const nisRunOut = d?.nis_runway?.final_depletion_date;
      return (
        `*Stock & runway*\n\n` +
        `Kernel on hand: ${num(ext.kernel_soh_kg, 2)} kg\n` +
        `Oil finished: ${num(ext.oil_finished_soh_kg, 2)} kg\n` +
        `Oil raw material: ${num(ext.oil_rm_soh_kg, 2)} kg\n` +
        `Weekly demand: ${num(runway.weekly_demand_kg, 2)} kg\n` +
        `Cover: ${weeks == null ? 'not calculable — no demand recorded' : `${num(weeks, 1)} weeks`}\n` +
        `NIS cover: ${nisRunOut == null ? 'not calculable — no crack rate configured' : `runs out ${shortDate(nisRunOut)}`}`
      );
    },
  },
  {
    action: 'yield',
    title: 'Recovery & yield',
    feature: 'dashboard',
    render: (d) => {
      const ext = d?.extended_kpis ?? {};
      const pvt = d?.produced_vs_target ?? {};
      const variance = pvt.variance_kg;
      return (
        `*Recovery & yield*\n\n` +
        `Sound kernel recovery: ${pct(ext.sound_kernel_recovery_pct)}\n` +
        `Oil yield: ${pct(ext.oil_yield_pct)}\n` +
        `This month: ${num(ext.production_kg_this_month)} kg (last month ${num(ext.production_kg_last_month)} kg)\n` +
        `Against target: ${
          variance == null
            ? 'no target set for this period'
            : `${num(variance)} kg vs ${num(pvt.target_kg)} kg`
        }`
      );
    },
  },
  {
    action: 'alerts',
    title: 'Open alerts',
    feature: 'dashboard',
    needsAction: 'alerts.resolve',
    render: (d, canAct) => formatOpenAlerts(d, canAct === true),
  },
  {
    action: 'intake',
    title: 'Intake today',
    feature: 'grower-intake-grid',
    render: (d) => {
      const proc = d?.procurement_today ?? {};
      return (
        `*Intake today*\n\n` +
        `Deliveries: ${num(proc.deliveries_today)}\n` +
        `Predicted: ${num(proc.predicted_kg_today)} kg`
      );
    },
  },
  {
    action: 'digest',
    title: 'Full daily digest',
    feature: 'dashboard',
    render: (d) => {
      const ks = d?.kernel_stats ?? {};
      const oil = d?.oil_stats ?? {};
      const ext = d?.extended_kpis ?? {};
      const runway = d?.runway ?? {};
      const pvt = d?.produced_vs_target ?? {};
      const proc = d?.procurement_today ?? {};
      const alerts: Any[] = Array.isArray(d?.open_alerts) ? d.open_alerts : [];
      return (
        `*Macavation daily digest · ${d?.date ?? 'today'}*\n\n` +
        `Kernel: ${num(ks.kg_cracked_today)} kg cracked today, ${num(ks.kg_packed_week)} kg packed this week\n` +
        `Oil: ${num(oil.litres_today)} L today, ${num(oil.litres_week)} L this week\n` +
        `Recovery: ${pct(ext.sound_kernel_recovery_pct)} · Yield: ${pct(ext.oil_yield_pct)}\n` +
        `Kernel on hand: ${num(ext.kernel_soh_kg, 2)} kg\n` +
        `Cover: ${runway.weeks_cover == null ? '—' : `${num(runway.weeks_cover, 1)} wks`}\n` +
        `NIS cover: ${d?.nis_runway?.final_depletion_date == null ? '—' : shortDate(d.nis_runway.final_depletion_date)}\n` +
        `Against target: ${pvt.variance_kg == null ? '—' : `${num(pvt.variance_kg)} kg`}\n` +
        `Open alerts: ${alerts.length}\n` +
        `Intake today: ${num(proc.deliveries_today)} deliveries, ${num(proc.predicted_kg_today)} kg`
      );
    },
  },
  {
    // The ONLY item that resolves per-user rather than rendering from the shared digest: the answer
    // depends on the asking number, which the digest knows nothing about. Feature key is
    // scheduled-reports-grid — the existing key governing report delivery to people; there is no
    // plainer 'reports' key seeded in this repo.
    //
    // DO NOT delete that feature row. The Scheduled Reports portal SCREEN was removed in
    // migrations/20260904100000_targets_module_consolidation.sql, but the KEY was deliberately
    // kept and renamed to "Report delivery (WhatsApp)" precisely because this item gates on it.
    // visibleItems() below filters on featureKeys.has(i.feature), so removing the row would drop
    // "Latest report" from every member's menu with nothing to say why.
    //
    // The real access control is not this feature key. get_latest_published_report_for_phone
    // filters to reports ALREADY SENT to the asking number
    // (migrations/20260825092000_report_link_codes.sql:211-219), so a member can only ever retrieve
    // something that was sent to them in the first place.
    action: 'report',
    title: 'Latest report',
    feature: 'scheduled-reports-grid',
    resolve: async (ctx) => {
      let row: Any;
      try {
        const { data, error } = await ctx.sb.rpc('get_latest_published_report_for_phone', {
          p_phone: ctx.phone,
        });
        if (error) {
          if (isMissingRpc(error)) {
            console.error(
              '[whatsapp-inbound] get_latest_published_report_for_phone is missing — migration 20260825092000 not applied.'
            );
          } else {
            console.error(
              '[whatsapp-inbound] get_latest_published_report_for_phone failed:',
              error.message
            );
          }
          return formatLatestReportReply('error', ctx.displayName, null);
        }
        row = Array.isArray(data) ? data[0] : data;
      } catch (e) {
        console.error('[whatsapp-inbound] get_latest_published_report_for_phone threw:', e);
        return formatLatestReportReply('error', ctx.displayName, null);
      }
      // Never log the minted link or the code — same rule as send-report-whatsapp's
      // "never log the signed URL".
      const url = row?.found === true ? buildReportUrl(row.link_code) : null;
      return formatLatestReportReply(row, ctx.displayName, url);
    },
  },
  {
    // The one item with NO feature gate (see MenuItem.feature) — this is the member's OWN
    // settings, not a business-data view, so it must stay visible to every enrolled staff member
    // regardless of role. visibleItems() below special-cases feature === null for exactly this.
    action: 'settings',
    title: 'My reports',
    feature: null,
    subMenu: commandMySettings,
  },
  {
    // Gated on crm-grid — the same feature key that gates the portal's CRM/Contacts grid — so a
    // role that cannot see Contacts in the portal cannot create one from WhatsApp either. Placed
    // last. startAddContact is defined further down (after commandHelp); function declarations
    // hoist, so referencing it here, above its own definition, is safe.
    action: 'addcontact',
    title: 'Add contact',
    feature: 'crm-grid',
    subMenu: startAddContact,
  },
];

/**
 * Feature keys enabled for this role, as public.features.key strings.
 *
 * Reads whatsapp_role_feature_keys, NOT the portal's get_role_features_for_role. The portal one
 * carries `AND (portal_actor_is_super_user() OR r.role_name <> 'super_user')`, and this function
 * runs on the service-role key with no portal session — so that guard was false here and a
 * super_user's 32 grants came back as 0 rows, denying the menu to the one role that should see all
 * of it. See migrations/20260907120000_whatsapp_role_feature_keys.sql for the measurement. Do not
 * "simplify" this back to the portal RPC.
 *
 * Returns an EMPTY SET on any failure — a missing RPC, an error, a role with nothing enabled. The
 * caller then shows no items and says so. Failing to an empty menu rather than a full one is
 * deliberate: an unreadable permission table must never widen what somebody can read over
 * WhatsApp.
 */
async function loadFeatureKeys(sb: SupabaseClient, roleId: string | null): Promise<Set<string>> {
  if (!roleId) return new Set();
  try {
    const { data, error } = await sb.rpc('whatsapp_role_feature_keys', { p_role_id: roleId });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] whatsapp_role_feature_keys is missing — migration ' +
            '20260907120000 not applied. Cannot build the menu.'
        );
      } else {
        console.error('[whatsapp-inbound] whatsapp_role_feature_keys failed:', error.message);
      }
      return new Set();
    }
    const rows: Any[] = Array.isArray(data) ? data : data ? [data] : [];
    const keys = new Set<string>();
    for (const r of rows) {
      if (String(r?.value ?? '') === 'true' && r?.feature_key) keys.add(String(r.feature_key));
    }
    return keys;
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_role_feature_keys threw:', e);
    return new Set();
  }
}

/** The items this role may see, in MENU_ITEMS order. Position in THIS array is the typed number. */
function visibleItems(featureKeys: Set<string>): MenuItem[] {
  // MAX_LIST_ROWS is Meta's cap for one list and buildListBody throws above it. MENU_ITEMS is
  // well under it today; the slice means adding a seventh, eighth… item can never turn a menu
  // send into a thrown error for a role that happens to have everything enabled.
  //
  // feature === null is the special case for an item with no gate at all (My reports today) — it
  // is never filtered out, regardless of what the role's features are.
  return MENU_ITEMS.filter((i) => i.feature === null || featureKeys.has(i.feature)).slice(0, MAX_LIST_ROWS);
}

const MENU_NS = 'menu';

/**
 * The `menu:` action that means "send me the Reports list now" — the quick-reply button
 * commandMenu sends alongside the Flow, in place of the old unconditional follow-up list. This is
 * not a MENU_ITEMS entry: it has no row of its own on any menu, no feature gate, and no
 * render/resolve/subMenu — renderMenuItem special-cases it before the MENU_ITEMS lookup, exactly
 * like SETTINGS_NS/ALERT_NS are handled as sibling namespaces rather than fake rows.
 */
const REPORTS_BUTTON_ACTION = 'reports';

/**
 * Meta's real Flow id for supabase/flows/daily-report-menu.flow.json, once published — this
 * repo cannot publish a Flow itself (draft-only via Control Room's create_flow/update_flow_json;
 * publish_flow requires access this repo's Control Room key does not have as of 2026-09-21).
 * Until this is set, the "Full report" menu item degrades to the existing plain-text digest
 * reply — same degrade-on-missing-id pattern as shopaholic-whatsapp's ADMIN_STATS_FLOW_ID.
 */
const WA_DAILY_REPORT_FLOW_ID = Deno.env.get('WA_DAILY_REPORT_FLOW_ID') ?? '';
const WA_DAILY_REPORT_FLOW_ENTRY_SCREEN_ID = 'REPORT_MENU';

/**
 * Turns on the "Add contact" row in the menu Flow (it opens the Flow's ADD_CONTACT form screen).
 * Separate from WA_DAILY_REPORT_FLOW_ID on purpose: a Flow already published in Meta from an OLDER
 * copy of supabase/flows/daily-report-menu.flow.json has no ADD_CONTACT screen, and a row that
 * navigates to a missing screen fails inside WhatsApp, where we cannot see it. Set this to 'true'
 * only once the published Flow includes ADD_CONTACT. With it off, the native-list menu's "Add
 * contact" row and the typed /contact still work exactly as before.
 */
const WA_FLOW_ADD_CONTACT_ENABLED = Deno.env.get('WA_FLOW_ADD_CONTACT_ENABLED') === 'true';
const WA_FLOW_ADD_CONTACT_SCREEN_ID = 'ADD_CONTACT';

/**
 * Reply-id namespace for a WhatsApp PUSH template's per-alert button — currently only "Mark
 * resolved" on the macavation_alert template (send-alert-whatsapp/index.ts). Not a MENU_NS tap:
 * this arrives on an alert PUSH the member did not request, not a menu they opened, and it carries
 * a third segment (the alert reference) MENU_NS taps never have. See ALERT_ACK_ACTION's own
 * comment below for the reference-encoding reason.
 */
const ALERT_NS = 'alert';

/**
 * The only action ALERT_NS carries today. Its `arg` is the first 24 lowercase-hex characters of
 * the alert id with dashes stripped — never the raw uuid: buildReplyId's REPLY_SEGMENT_RE caps
 * every segment at 24 characters, and a uuid is 32-36. resolve_dashboard_alert_by_ref
 * (migrations/20260910100000_alert_whatsapp_push.sql) resolves that prefix back to one open
 * alert; see that migration's header for the full reasoning and the (vanishingly unlikely)
 * ambiguous-match case.
 */
const ALERT_ACK_ACTION = 'ack';

function menuBodyText(displayName: string): string {
  return `Hi ${displayName}. What would you like to see?`;
}

/** Plain-text rendering of the same role-filtered list, used when the interactive send fails. */
function menuFallbackText(displayName: string, items: MenuItem[]): string {
  const lines = items.map((item, i) => `${i + 1}. ${item.title}`);
  return (
    `${menuBodyText(displayName)}\n\n` +
    `${lines.join('\n')}\n\n` +
    `Reply with a number. 99 brings this menu back at any time.`
  );
}

/** The id of the one quick-reply button every menu-item reply carries. Matches the "menu" key in
 * TEMPLATE_BUTTON_ROUTES below, so this button and the daily report template's own "Menu" button
 * dispatch through the exact same route. */
const MENU_BUTTON_ID = 'menu';

/**
 * Sends `bodyText` with a single "Menu" quick-reply button in place of the old "Reply 99 for the
 * menu." text line, falling back to that text (appended, unchanged) if the interactive send is
 * rejected — same fallback shape commandMenu uses for the list send above.
 *
 * Returns `reply: null` on success BECAUSE IT HAS ALREADY SENT — see commandMenu's own comment on
 * why a handler that sends its own interactive message must not also return reply text.
 */
async function sendWithMenuButton(
  ctx: CommandContext,
  bodyText: string,
  command: string
): Promise<CommandResult> {
  const result = await sendButtons(toWaPhone(ctx.phone), bodyText, [
    { id: MENU_BUTTON_ID, title: 'Menu' },
  ]);

  if (!result.ok) {
    console.error(`[whatsapp-inbound] menu-item button send failed, falling back to text: ${result.error}`);
    return { outcome: 'ok', reply: `${bodyText}\n\nReply 99 for the menu.`, command, detail: 'button send failed; text fallback' };
  }

  return { outcome: 'ok', reply: null, command };
}

/**
 * Sends the main menu as an interactive list, falling back to numbered text if the list send is
 * rejected.
 *
 * Returns `reply: null` in the success case BECAUSE IT HAS ALREADY SENT: processCommandForMessage
 * only sends `result.reply` when it is non-null, so a handler that sends its own interactive
 * message must return null or the member would receive the menu twice. The fallback path returns
 * text and lets the caller send it in the usual way.
 */
async function sendMenuAsList(ctx: CommandContext, items: MenuItem[], detail?: string): Promise<CommandResult> {
  const rows = items.map((item) => ({ id: buildReplyId(MENU_NS, item.action), title: item.title }));

  const result = await sendList(toWaPhone(ctx.phone), menuBodyText(ctx.displayName), 'Choose', [
    { title: 'Macavation', rows },
  ]);

  if (!result.ok) {
    console.error(`[whatsapp-inbound] menu list send failed, falling back to text: ${result.error}`);
    return {
      outcome: 'ok',
      reply: menuFallbackText(ctx.displayName, items),
      command: 'MENU',
      detail: 'list send failed; text fallback',
    };
  }

  return { outcome: 'ok', reply: null, command: 'MENU', detail };
}

/**
 * The items commandMenu cannot put in the Flow — no `.render`, so no digest-backed content.
 *
 * 'addcontact' deliberately stays IN this set (not excluded), same as 'settings' above it: both
 * are `subMenu` items with no `.render`, so both already ride the same "Reports" follow-up
 * button/list as "My reports" on the WA_DAILY_REPORT_FLOW_ID-set path. Excluding 'addcontact'
 * here would make it vanish from the menu entirely whenever that Flow id is set and the digest
 * fetch succeeds (today it is unset — see WA_DAILY_REPORT_FLOW_ID's own comment — so this branch
 * is dormant, but the function must stay correct for when it is not). The "Reports for {name}:"
 * wording already stretches to cover 'settings' (delivery settings, not a report) today, so
 * 'addcontact' joining it is the same pre-existing trade-off, not a new one.
 */
function followUpItemsOf(items: MenuItem[]): MenuItem[] {
  return items.filter((i) => !i.render);
}

/**
 * Text fallback for sendReportsFollowUpList, when the list send itself is rejected. Deliberately
 * NOT menuFallbackText: that numbers items by their position in the FULL visible menu (matching
 * renderMenuPosition's `items[position - 1]` indexing), but `items` here is the follow-up subset —
 * numbering it 1., 2., … would print numbers that resolve to the WRONG items if replied to.
 *
 * Does not tell the member to type an item's name: only single-word titles have a COMMAND_HANDLERS
 * shortcut (`REPORT` for the "Latest report" item; "My reports" has none), so a name-based
 * instruction would be true for one item and false for the other. 99 (commandMenu, which resends
 * this same Reports button) is the only reply this can honestly promise works for both.
 */
function reportsFallbackText(displayName: string, items: MenuItem[]): string {
  const names = items.map((i) => i.title).join(' or ');
  return `Hi ${displayName}, here are your report options: ${names}. Reply 99 to try again.`;
}

/**
 * Sends "Latest report" / "My reports" as their own native list, on request. Used both by
 * commandMenu (when offered via the Reports button) and by the REPORTS_BUTTON_ACTION handler
 * below (when the member actually taps it). Kept separate from sendMenuAsList's body/button text
 * so the two sends never look identical in the chat — the Flow's own trigger message already
 * used the "Choose" button label.
 */
async function sendReportsFollowUpList(ctx: CommandContext, items: MenuItem[]): Promise<CommandResult> {
  const rows = items.map((item) => ({ id: buildReplyId(MENU_NS, item.action), title: item.title }));
  const result = await sendList(
    toWaPhone(ctx.phone),
    `Reports for ${ctx.displayName}:`,
    'Open',
    [{ title: 'Macavation', rows }]
  );

  if (!result.ok) {
    console.error(`[whatsapp-inbound] sendReportsFollowUpList: list send failed: ${result.error}`);
    return {
      outcome: 'ok',
      reply: reportsFallbackText(ctx.displayName, items),
      command: 'MENU',
      detail: 'reports list send failed; text fallback',
    };
  }

  return { outcome: 'ok', reply: null, command: 'MENU' };
}

/**
 * The main menu entry point. When WA_DAILY_REPORT_FLOW_ID is set, sends the six digest-backed
 * items (production, stock, yield, alerts, intake, digest) as ONE tap-through Flow — replacing
 * the old arrangement where those six were plain-text list rows AND a separate "Full report" row
 * re-listed them again as a Flow. "Latest report" and "My reports" are not digest-render()-backed
 * (one calls a per-phone RPC, the other opens its own sub-list) and cannot be Flow rows, so they
 * are offered via a single "Reports" quick-reply button sent right after the Flow — tapping it is
 * what actually triggers sendReportsFollowUpList, via REPORTS_BUTTON_ACTION below. This used to be
 * an unconditional follow-up list sent to every member on every MENU open regardless of whether
 * they wanted it; that surprised members with a second message they never asked for, so it is now
 * opt-in, exactly like tapping "Choose" is what the Flow itself already required.
 *
 * Falls back to the plain native list (today's unchanged behaviour, all items in one list) when
 * WA_DAILY_REPORT_FLOW_ID is unset, the digest fetch fails, or the Flow send itself fails — so a
 * broken Flow can never leave a member with no menu at all.
 */
async function commandMenu(ctx: CommandContext): Promise<CommandResult> {
  const featureKeys = await loadFeatureKeys(ctx.sb, ctx.roleId);
  const items = visibleItems(featureKeys);

  if (items.length === 0) {
    return {
      outcome: 'denied',
      reply:
        `Hi ${ctx.displayName}, your role does not have access to any of the WhatsApp reports ` +
        `yet. Ask an administrator to enable the areas you need in the portal.`,
      command: 'MENU',
      detail: 'no features enabled for role',
    };
  }

  const digestItems = items.filter((i) => i.render);
  const followUpItems = followUpItemsOf(items);

  if (!WA_DAILY_REPORT_FLOW_ID || digestItems.length === 0) {
    return sendMenuAsList(ctx, items, 'WA_DAILY_REPORT_FLOW_ID not set; native list');
  }

  let digest: Any;
  try {
    const { data, error } = await ctx.sb.rpc('get_daily_digest');
    if (error) throw error;
    digest = Array.isArray(data) ? data[0] : data;
  } catch (e) {
    console.error('[whatsapp-inbound] commandMenu: get_daily_digest failed, falling back to native list:', e);
    return sendMenuAsList(ctx, items, 'get_daily_digest failed; native list');
  }

  if (!digest) {
    return sendMenuAsList(ctx, items, 'empty digest; native list');
  }

  const rows = buildDigestFlowRows(digestItems, digest);
  // Same crm-grid gate as the native-list "Add contact" row and startAddContact. Showing the row
  // is presentation only: handleAddContactFlowSubmit re-checks crm-grid when the form comes back.
  if (WA_FLOW_ADD_CONTACT_ENABLED && featureKeys.has('crm-grid')) {
    rows.push(addContactFlowRow());
  }
  const flowResult = await sendFlow(
    toWaPhone(ctx.phone),
    menuBodyText(ctx.displayName),
    WA_DAILY_REPORT_FLOW_ID,
    WA_DAILY_REPORT_FLOW_ENTRY_SCREEN_ID,
    'Choose',
    crypto.randomUUID(),
    rows
  );

  if (!flowResult.ok) {
    console.error(`[whatsapp-inbound] commandMenu: Flow send failed, falling back to native list: ${flowResult.error}`);
    return sendMenuAsList(ctx, items, 'Flow send failed; native list');
  }

  if (followUpItems.length === 0) {
    return { outcome: 'ok', reply: null, command: 'MENU' };
  }

  // Latest report / My reports: not Flow-representable. Offered as a button, not sent
  // automatically — a failure here is reported on its own, since the Flow itself already sent
  // successfully above and must never be duplicated by a fallback that re-sends the full list.
  const buttonResult = await sendButtons(toWaPhone(ctx.phone), 'Need your latest report or your delivery settings?', [
    { id: buildReplyId(MENU_NS, REPORTS_BUTTON_ACTION), title: 'Reports' },
  ]);

  if (!buttonResult.ok) {
    console.error(`[whatsapp-inbound] commandMenu: Reports button send failed: ${buttonResult.error}`);
    return {
      outcome: 'ok',
      reply: `${menuFallbackText(ctx.displayName, followUpItems)}`,
      command: 'MENU',
      detail: 'Reports button send failed; text fallback',
    };
  }

  return { outcome: 'ok', reply: null, command: 'MENU' };
}

/**
 * Renders one menu item, re-checking the role's features FIRST.
 *
 * The re-check is not redundant. A reply id is whatever the handset sends back — a member can tap
 * a row from a menu sent before their role changed, or send a saved id by hand — so the tap is a
 * request, never an authorisation. Anything not in the role's CURRENT visible set is refused here.
 */
async function renderMenuItem(ctx: CommandContext, action: string): Promise<CommandResult> {
  const featureKeys = await loadFeatureKeys(ctx.sb, ctx.roleId);
  const visible = visibleItems(featureKeys);

  // Not a MENU_ITEMS row — the "Reports" button commandMenu sends alongside the Flow. Re-derive
  // followUpItems from the CURRENT visible set, same re-check reasoning as the rest of this
  // function: a member can tap a button from a menu sent before their role changed.
  if (action === REPORTS_BUTTON_ACTION) {
    const followUpItems = followUpItemsOf(visible);
    if (followUpItems.length === 0) {
      return {
        outcome: 'denied',
        reply: `Sorry ${ctx.displayName}, that option is not available to you. Reply 99 for the menu.`,
        command: 'MENU:REPORTS',
        detail: 'no follow-up items in current visible set',
      };
    }
    return sendReportsFollowUpList(ctx, followUpItems);
  }

  const item = visible.find((i) => i.action === action);

  if (!item) {
    return {
      outcome: 'denied',
      reply:
        `Sorry ${ctx.displayName}, that option is not available to you. Reply 99 for the menu.`,
      command: `MENU:${action.toUpperCase()}`,
      detail: 'action not in role visible set',
    };
  }

  // A `subMenu` item sends its OWN interactive message (a second list) and returns whatever that
  // yields — including `reply: null` on success — directly, exactly like commandMenu itself.
  // Never routed through render/resolve.
  if (item.subMenu) {
    return item.subMenu(ctx);
  }

  // A `resolve` item answers from its own per-user source. The digest is NOT fetched for it — a
  // broken digest must not make "latest report" reply "could not read the figures", which is a
  // different feature failing.
  if (item.resolve) {
    try {
      return await sendWithMenuButton(ctx, await item.resolve(ctx), `MENU:${action.toUpperCase()}`);
    } catch (e) {
      console.error(`[whatsapp-inbound] resolve failed for ${action}:`, e);
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not fetch that just now. Please try again shortly.`,
        command: `MENU:${action.toUpperCase()}`,
        detail: String(e),
      };
    }
  }

  let digest: Any;
  try {
    const { data, error } = await ctx.sb.rpc('get_daily_digest');
    if (error) throw error;
    digest = Array.isArray(data) ? data[0] : data;
  } catch (e) {
    console.error('[whatsapp-inbound] get_daily_digest failed:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not read the figures just now. Please try again shortly.`,
      command: `MENU:${action.toUpperCase()}`,
      detail: String(e),
    };
  }

  if (!digest) {
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, there are no figures available right now.`,
      command: `MENU:${action.toUpperCase()}`,
      detail: 'empty digest',
    };
  }

  // An item may declare an action key its WORDING depends on (not its visibility — that is
  // `feature`, already checked above). Resolved here so `render` stays synchronous and pure.
  const canAct = item.needsAction ? await hasAction(ctx.sb, ctx.userId, item.needsAction) : false;

  return await sendWithMenuButton(ctx, item.render!(digest, canAct), `MENU:${action.toUpperCase()}`);
}

/** A typed number: position in the role's own visible list. 0 and 99 never reach here. */
async function renderMenuPosition(ctx: CommandContext, position: number): Promise<CommandResult> {
  const featureKeys = await loadFeatureKeys(ctx.sb, ctx.roleId);
  const items = visibleItems(featureKeys);
  const item = items[position - 1];

  if (!item) {
    return {
      outcome: 'unknown_command',
      reply:
        `Sorry ${ctx.displayName}, there is no option ${position}. Reply 99 for the menu.`,
      command: `MENU#${position}`,
      detail: 'position out of range',
    };
  }

  return renderMenuItem(ctx, item.action);
}

// ============================================================================
// "My reports" — the settings branch (docs/mockups/whatsapp-flow-spec.html section 5).
//
// The one place in the whole menu where a member changes something rather than just reading a
// figure. Reached ONLY via the top-level "My reports" item (feature: null, see MENU_ITEMS above)
// — its own reply-id namespace (SETTINGS_NS) keeps its five rows distinct from MENU_NS taps.
//
// Daily / Weekly / Monthly toggle and Pause are IMMEDIATE, no confirm: changing what lands on your
// own phone is instantly reversible and obviously yours (wa-flow-spec.html section 5's own
// reasoning). Stop everything is the one exception — tapped from a menu, not typed, so it is
// staged through the SAME YES/NO machinery STAGED_COMMAND_HANDLERS already provides (contract 4:
// a mis-tap in a list of five rows is plausible in a way that typing five letters is not), and
// calls the identical report_set_opt_out RPC wa-flow-02's typed STOP already calls — one RPC, two
// entry points, only one of which confirms.
//
// No new RPC anywhere below: report_recipient_by_inbound_phone and report_subscription_json
// (both already existing and already granted to service_role) are the whole read path, and
// set_report_subscription_by_phone / report_set_opt_out are the whole write path.
// ============================================================================

const SETTINGS_NS = 'rpt';

const REPORT_KINDS = ['daily', 'weekly', 'monthly'] as const;
type ReportKind = (typeof REPORT_KINDS)[number];

const REPORT_KIND_LABEL: Record<ReportKind, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

type SubscriptionState = { subscribed: boolean; mutedUntil: string | null };

/**
 * Resolves the asking number to a report_recipients row, exactly as commandResume already does
 * (report_recipient_by_inbound_phone takes the BARE inbound phone — ctx.phone — and normalises
 * internally via chat_normalize_phone; no second lookup or local normalisation is needed here,
 * same as every other caller of this RPC in this file).
 */
type RecipientLookup =
  | { ok: true; found: true; recipientId: string }
  | { ok: true; found: false }
  | { ok: false; reply: string; detail: string };

async function resolveReportRecipient(ctx: CommandContext): Promise<RecipientLookup> {
  try {
    const { data, error } = await ctx.sb.rpc('report_recipient_by_inbound_phone', {
      p_phone: ctx.phone,
    });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] report_recipient_by_inbound_phone is missing — migration 20260825090000 not applied.'
        );
      }
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.found !== true) {
      return { ok: true, found: false };
    }
    return { ok: true, found: true, recipientId: String(row.recipient_id) };
  } catch (e) {
    console.error('[whatsapp-inbound] report_recipient_by_inbound_phone failed for settings:', e);
    return {
      ok: false,
      reply: `Sorry ${ctx.displayName}, I could not check that just now. Please try again shortly.`,
      detail: String(e),
    };
  }
}

/**
 * Reads { subscribed, muted_until } for one report_kind via the existing report_subscription_json
 * RPC — already granted to anon/authenticated/service_role
 * (migrations/20260825090000_report_subscriptions_and_staff.sql:393), so this is a READ PATH REUSE,
 * not a new RPC. Throws on any failure; callers decide how to degrade rather than this function
 * guessing at a default that could misreport somebody's real subscription state.
 */
async function readSubscriptionState(
  sb: SupabaseClient,
  recipientId: string,
  kind: ReportKind
): Promise<SubscriptionState> {
  const { data, error } = await sb.rpc('report_subscription_json', {
    p_recipient_id: recipientId,
    p_report_kind: kind,
  });
  if (error) {
    if (isMissingRpc(error)) {
      console.error(
        '[whatsapp-inbound] report_subscription_json is missing — migration 20260825090000 not applied.'
      );
    }
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { subscribed: row?.subscribed === true, mutedUntil: row?.muted_until ?? null };
}

async function readAllSubscriptionStates(
  sb: SupabaseClient,
  recipientId: string
): Promise<Record<ReportKind, SubscriptionState>> {
  const [daily, weekly, monthly] = await Promise.all(
    REPORT_KINDS.map((kind) => readSubscriptionState(sb, recipientId, kind))
  );
  return { daily, weekly, monthly };
}

function notOnDistributionListReply(displayName: string): string {
  return (
    `Hi ${displayName}, you are not currently on a report distribution list, so there is nothing ` +
    `to change here. Ask an administrator to add your number if you should be receiving reports.`
  );
}

function settingsRowTitle(kind: ReportKind, subscribed: boolean): string {
  return truncate(`${REPORT_KIND_LABEL[kind]} — ${subscribed ? 'on' : 'off'}`, MAX_LIST_TITLE);
}

/**
 * The top-level "My reports" item's `subMenu` — sends the settings list, reading fresh state on
 * every open exactly as contract 2 requires (a row's title is never stale).
 */
async function commandMySettings(ctx: CommandContext): Promise<CommandResult> {
  const lookup = await resolveReportRecipient(ctx);
  if (!lookup.ok) {
    return { outcome: 'error', reply: lookup.reply, command: 'MENU:SETTINGS', detail: lookup.detail };
  }
  if (!lookup.found) {
    return { outcome: 'ok', reply: notOnDistributionListReply(ctx.displayName), command: 'MENU:SETTINGS' };
  }

  let states: Record<ReportKind, SubscriptionState>;
  try {
    states = await readAllSubscriptionStates(ctx.sb, lookup.recipientId);
  } catch (e) {
    console.error('[whatsapp-inbound] reading subscription state failed for MENU:SETTINGS:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not read your current settings just now. Please try again shortly.`,
      command: 'MENU:SETTINGS',
      detail: String(e),
    };
  }

  const toggleRows = REPORT_KINDS.map((kind) => ({
    id: buildReplyId(SETTINGS_NS, kind),
    title: settingsRowTitle(kind, states[kind].subscribed),
  }));
  const quietenRows = [
    { id: buildReplyId(SETTINGS_NS, 'pause'), title: truncate('Pause for a week', MAX_LIST_TITLE) },
    { id: buildReplyId(SETTINGS_NS, 'stopall'), title: truncate('Stop everything', MAX_LIST_TITLE) },
  ];

  const bodyText = `Hi ${ctx.displayName}. Here's what you're getting. Tap one to change it.`;
  const result = await sendList(toWaPhone(ctx.phone), bodyText, 'Choose', [
    { title: 'My reports', rows: toggleRows },
    { title: 'Quieten things down', rows: quietenRows },
  ]);

  if (!result.ok) {
    console.error(`[whatsapp-inbound] settings list send failed, falling back to text: ${result.error}`);
    return {
      outcome: 'ok',
      reply:
        `Hi ${ctx.displayName}, here is what you're currently getting:\n\n` +
        `Daily: ${states.daily.subscribed ? 'on' : 'off'}\n` +
        `Weekly: ${states.weekly.subscribed ? 'on' : 'off'}\n` +
        `Monthly: ${states.monthly.subscribed ? 'on' : 'off'}\n\n` +
        `I could not show the tappable menu just now — please try again shortly to change anything. ` +
        `Reply 99 for the main menu.`,
      command: 'MENU:SETTINGS',
      detail: 'list send failed; text fallback',
    };
  }

  // Already sent — see commandMenu's own comment on why this must return reply: null.
  return { outcome: 'ok', reply: null, command: 'MENU:SETTINGS' };
}

/**
 * States the FULL current set after a toggle (contract 5) — never just what changed. Only the
 * report kinds still ON besides the one just toggled are named; anything not named is off, which
 * is exactly what "Daily is now off. You are still getting Weekly and Monthly." (the brief's own
 * example) communicates.
 */
function reportStateSentence(
  changedKind: ReportKind,
  turnedOn: boolean,
  after: Record<ReportKind, boolean>
): string {
  const others = REPORT_KINDS.filter((k) => k !== changedKind && after[k]).map((k) => REPORT_KIND_LABEL[k]);
  const label = REPORT_KIND_LABEL[changedKind];
  let sentence = `${label} is now ${turnedOn ? 'on' : 'off'}.`;
  if (others.length === 0) {
    sentence += turnedOn
      ? ' Nothing else is switched on right now.'
      : ' You are not getting any other reports right now.';
  } else {
    const joined =
      others.length === 1 ? others[0] : `${others.slice(0, -1).join(', ')} and ${others[others.length - 1]}`;
    sentence += turnedOn ? ` You are also getting ${joined}.` : ` You are still getting ${joined}.`;
  }
  return sentence;
}

/** Daily, Weekly or Monthly row tap — immediate flip, no confirm (contract 3). */
async function commandToggleReportKind(ctx: CommandContext, kind: ReportKind): Promise<CommandResult> {
  const cmdTag = `MENU:SETTINGS:${kind.toUpperCase()}`;
  const lookup = await resolveReportRecipient(ctx);
  if (!lookup.ok) {
    return { outcome: 'error', reply: lookup.reply, command: cmdTag, detail: lookup.detail };
  }
  if (!lookup.found) {
    return { outcome: 'ok', reply: notOnDistributionListReply(ctx.displayName), command: cmdTag };
  }

  let before: boolean;
  try {
    before = (await readSubscriptionState(ctx.sb, lookup.recipientId, kind)).subscribed;
  } catch (e) {
    console.error(`[whatsapp-inbound] reading ${kind} subscription state failed:`, e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not read your current settings just now. Please try again shortly.`,
      command: cmdTag,
      detail: String(e),
    };
  }

  const turnedOn = !before;
  try {
    const { data, error } = await ctx.sb.rpc('set_report_subscription_by_phone', {
      p_phone: ctx.phone,
      p_report_kind: kind,
      p_is_active: turnedOn,
      p_muted_until: null,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.ok !== true) {
      throw new Error(result?.error || 'set_report_subscription_by_phone returned ok=false');
    }
  } catch (e) {
    console.error(`[whatsapp-inbound] set_report_subscription_by_phone(${kind}) failed:`, e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not save that just now. Please try again shortly.`,
      command: cmdTag,
      detail: String(e),
    };
  }

  // Contract 5: read all three rows FRESH after the write rather than assuming the write did what
  // was asked — the full current set is stated from what the database now says, not from memory.
  try {
    const after = await readAllSubscriptionStates(ctx.sb, lookup.recipientId);
    const afterBooleans: Record<ReportKind, boolean> = {
      daily: after.daily.subscribed,
      weekly: after.weekly.subscribed,
      monthly: after.monthly.subscribed,
    };
    return { outcome: 'ok', reply: reportStateSentence(kind, turnedOn, afterBooleans), command: cmdTag };
  } catch (e) {
    console.error('[whatsapp-inbound] re-reading subscription state after toggle failed:', e);
    // The write itself already succeeded — say so, even without the full-set confirmation.
    return {
      outcome: 'ok',
      reply: `${REPORT_KIND_LABEL[kind]} is now ${turnedOn ? 'on' : 'off'}, ${ctx.displayName}.`,
      command: cmdTag,
      detail: 'post-write read failed',
    };
  }
}

/**
 * "Pause for a week" — immediate, no confirm (contract 4). Scoped to the DAILY subscription only,
 * matching commandResume's own deliberately narrow scope (its comment above: "Extending RESUME to
 * weekly/monthly ... a later plan's job") — pausing a kind that typed RESUME cannot lift early
 * would be a pause with no matching early-release path. p_muted_until is report_sast_today() + 7,
 * read via the same RPC report_daily_recipients' own pause clause is built on, not computed from
 * this process's local clock.
 */
async function commandPauseDaily(ctx: CommandContext): Promise<CommandResult> {
  const cmdTag = 'MENU:SETTINGS:PAUSE';
  const lookup = await resolveReportRecipient(ctx);
  if (!lookup.ok) {
    return { outcome: 'error', reply: lookup.reply, command: cmdTag, detail: lookup.detail };
  }
  if (!lookup.found) {
    return { outcome: 'ok', reply: notOnDistributionListReply(ctx.displayName), command: cmdTag };
  }

  let dailyState: SubscriptionState;
  try {
    dailyState = await readSubscriptionState(ctx.sb, lookup.recipientId, 'daily');
  } catch (e) {
    console.error('[whatsapp-inbound] reading daily subscription state failed for PAUSE:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not read your current settings just now. Please try again shortly.`,
      command: cmdTag,
      detail: String(e),
    };
  }

  if (!dailyState.subscribed) {
    return {
      outcome: 'ok',
      reply: `You are not currently getting the daily report, ${ctx.displayName}, so there is nothing to pause. Reply 99 for the menu.`,
      command: cmdTag,
    };
  }

  let pauseUntil: string | null = null;
  try {
    const { data, error } = await ctx.sb.rpc('report_sast_today');
    if (error) throw error;
    const todayStr = String(data ?? '');
    const d = new Date(`${todayStr}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() + 7);
      pauseUntil = d.toISOString().slice(0, 10);
    }
  } catch (e) {
    console.error('[whatsapp-inbound] report_sast_today failed for PAUSE:', e);
  }

  if (!pauseUntil) {
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
      command: cmdTag,
      detail: 'report_sast_today unavailable',
    };
  }

  try {
    const { data, error } = await ctx.sb.rpc('set_report_subscription_by_phone', {
      p_phone: ctx.phone,
      p_report_kind: 'daily',
      p_is_active: true,
      p_muted_until: pauseUntil,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.ok !== true) {
      throw new Error(result?.error || 'set_report_subscription_by_phone returned ok=false');
    }
  } catch (e) {
    console.error('[whatsapp-inbound] set_report_subscription_by_phone(daily pause) failed:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
      command: cmdTag,
      detail: String(e),
    };
  }

  return {
    outcome: 'ok',
    reply: `Paused until ${shortDate(pauseUntil)}, ${ctx.displayName}. Send RESUME any time to lift it sooner.`,
    command: cmdTag,
  };
}

/**
 * "Stop everything" — the one row that DOES confirm (contract 4). Tapped from a menu, not typed,
 * so a mis-tap in a list of five rows is plausible in a way that typing five letters is not. Stages
 * through the SAME whatsapp_stage_pending_command / YES machinery ACK already uses; the staged
 * command name below MUST match the STAGED_COMMAND_HANDLERS key exactly (STOP_ALL_REPORTS).
 */
async function commandSettingsStopAll(ctx: CommandContext): Promise<CommandResult> {
  const cmdTag = 'MENU:SETTINGS:STOPALL';
  const summary = 'Stop everything — no more report messages until you ask again';
  try {
    const { error } = await ctx.sb.rpc('whatsapp_stage_pending_command', {
      p_phone: ctx.phone,
      p_user_id: ctx.userId,
      p_command: 'STOP_ALL_REPORTS',
      p_payload: {},
      p_summary: summary,
    });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] whatsapp_stage_pending_command is missing — migration 20260815130000 not applied.'
        );
      } else {
        console.error('[whatsapp-inbound] whatsapp_stage_pending_command failed:', error.message);
      }
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
        command: cmdTag,
        detail: error.message,
      };
    }
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_stage_pending_command threw:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
      command: cmdTag,
      detail: String(e),
    };
  }

  return { outcome: 'ok', reply: `${summary}?\n\nReply YES to confirm, or NO to cancel.`, command: cmdTag };
}

/** Dispatches one of the five settings-sub-list reply ids (SETTINGS_NS taps only). */
async function dispatchSettingsAction(ctx: CommandContext, action: string): Promise<CommandResult> {
  switch (action) {
    case 'daily':
    case 'weekly':
    case 'monthly':
      return commandToggleReportKind(ctx, action);
    case 'pause':
      return commandPauseDaily(ctx);
    case 'stopall':
      return commandSettingsStopAll(ctx);
    default:
      return {
        outcome: 'unknown_command',
        reply: `Sorry ${ctx.displayName}, that option is no longer available. Reply 99 for the menu.`,
        command: 'MENU:SETTINGS',
        detail: `unrecognised settings action: ${action}`,
      };
  }
}

const HELP_COMMAND_LIST =
  'MENU (or 99) — show the menu of reports\n' +
  'HELP — show this message\n' +
  'CONTACT — add a new CRM contact\n' +
  'YES (or Y, CONFIRM) — confirm a pending request\n' +
  'NO (or N, CANCEL) — cancel a pending request\n' +
  'STOP — stop report messages (START undoes this)\n' +
  'RESUME — lift a paused daily report';

function helpReplyText(displayName: string): string {
  // Plain text, WhatsApp-friendly: short lines, no markdown table, no link — no screen in this
  // portal is deep-linkable (the router never reads the URL), so a link could only ever land
  // on the app root and would be worse than useless.
  return (
    `Hi ${displayName}. Here is what I can do right now:\n\n` +
    `${HELP_COMMAND_LIST}\n\n` +
    `The menu shows only the areas your role can already open in the portal.\n\n` +
    `Some requests write data — those ask you to confirm what was understood before anything is ` +
    `saved. Reply YES to go ahead or NO to cancel.\n\n` +
    `More commands are coming. Text HELP any time to see the current list.`
  );
}

async function commandHelp(ctx: CommandContext): Promise<CommandResult> {
  return { outcome: 'ok', reply: helpReplyText(ctx.displayName), command: 'HELP' };
}

// ============================================================================
// /contact — add a CRM contact via guided questions (type, company, contact person, mobile,
// email), gated on the SAME crm-grid feature key the portal's Contacts screen uses, with a
// YES/NO confirm-before-save step matching every other write this router already does.
//
// Reached three ways: typing CONTACT / ADDCONTACT / NEWCONTACT / "ADD CONTACT", tapping the "Add
// contact" row on the main menu (MENU_ITEMS, above), or sending a shared WhatsApp contact card
// (processCommandForMessage's type:'contacts' branch) — all three funnel into startAddContact.
//
// STATE MACHINE: the draft lives in whatsapp_pending_commands (migrations/20260815130000) as
// command ADD_CONTACT_DRAFT, with an explicit `step` field as the single source of truth for
// "what are we asking next" — never inferred from which fields happen to be null, so a prefilled
// field (from a shared contact card) and a not-yet-answered field are unambiguous even though
// both are represented the same way (null) until filled. nextAddContactStep walks
// ADD_CONTACT_STEP_ORDER looking for the first still-empty field; this ONE function drives both
// the normal typed flow (every field starts null, so it always lands on 'type' first) and the
// card-prefill flow (some fields already filled before the first question is even asked) with no
// special-casing for either caller — contact_type can never be prefilled from a card, so 'type'
// is always asked first either way.
//
// Once every field is filled, the draft is re-staged as ADD_CONTACT (a DIFFERENT command name)
// and the member is asked to confirm — at that point the EXISTING YES/NO machinery
// (commandYes/STAGED_COMMAND_HANDLERS) takes over with no changes needed here: routeAddContactDraft
// (below) only ever intercepts a message when the peeked pending command is still
// ADD_CONTACT_DRAFT, so once it becomes ADD_CONTACT a typed YES falls straight through to
// commandYes exactly as every other staged write already does.
// ============================================================================

/**
 * Reply-id namespace for the /contact "type" step's list taps (CONTACT_NS:<type>). Carries the
 * contact_type enum value directly as the action segment — every value in CONTACT_TYPES below is
 * well under buildReplyId's 24-character REPLY_SEGMENT_RE cap, so there is no need for a second,
 * invented short code that would have to be kept in step with the real enum by hand.
 */
const CONTACT_NS = 'contact';

/**
 * The five contact_type values the portal's "Add contact" modal offers, in the same order
 * (WebPortal/modules/modals/modal-crm-contact/html/modal_crm_contact.html:43-47), checked against
 * contacts_contact_type_check
 * (migrations/20260342000001_contacts_oil_ingredient_oil_protein_customer_types.sql). Legacy
 * values ('customer', 'supplier', 'both') are valid in the database but not offered by the modal
 * and are not offered here either — this flow creates NEW contacts the same way the modal does.
 */
const CONTACT_TYPES: { key: string; label: string }[] = [
  { key: 'nis_supplier', label: 'NIS Supplier' },
  { key: 'oil_processor', label: 'Oil Processor' },
  { key: 'oil_ingredient_supplier', label: 'Oil Ingredient Supplier' },
  { key: 'oil_protein_customer', label: 'Oil & Protein Customer' },
  { key: 'kernel_customer', label: 'Kernel Customer' },
];

/** The fields a /contact draft collects — exactly what create_contact_simple is called with. */
interface AddContactDraftFields {
  contact_type: string | null;
  company_name: string | null;
  primary_contact_name: string | null;
  primary_contact_mobile: string | null;
  primary_contact_email: string | null;
}

const ADD_CONTACT_STEP_ORDER = ['type', 'company', 'person', 'mobile', 'email'] as const;
type AddContactStep = (typeof ADD_CONTACT_STEP_ORDER)[number] | 'done';

/** Stored verbatim in whatsapp_pending_commands.payload for command ADD_CONTACT_DRAFT. */
interface AddContactDraftPayload extends AddContactDraftFields {
  step: AddContactStep;
}

const ADD_CONTACT_STEP_FIELD: Record<(typeof ADD_CONTACT_STEP_ORDER)[number], keyof AddContactDraftFields> = {
  type: 'contact_type',
  company: 'company_name',
  person: 'primary_contact_name',
  mobile: 'primary_contact_mobile',
  email: 'primary_contact_email',
};

/**
 * Walks forward through ADD_CONTACT_STEP_ORDER starting at (and including) `from`, returning the
 * first step whose field in `fields` is still null/blank, or 'done' once every field from `from`
 * onward is filled. PURE — no client, no I/O — so verify-wa-add-contact can re-declare and test
 * it. See this section's header comment for why one function serves both the typed flow and the
 * card-prefill flow.
 */
function nextAddContactStep(fields: AddContactDraftFields, from: AddContactStep): AddContactStep {
  const startIndex = from === 'done' ? ADD_CONTACT_STEP_ORDER.length : ADD_CONTACT_STEP_ORDER.indexOf(from);
  for (let i = Math.max(startIndex, 0); i < ADD_CONTACT_STEP_ORDER.length; i++) {
    const step = ADD_CONTACT_STEP_ORDER[i];
    const value = fields[ADD_CONTACT_STEP_FIELD[step]];
    if (value === null || value === undefined || String(value).trim() === '') return step;
  }
  return 'done';
}

/**
 * Resolves a typed answer to the 'type' step into a contact_type key: a bare digit 1-5 (position
 * in CONTACT_TYPES, same convention as the main menu's numbered fallback), the enum key itself
 * (case-insensitive), or the display label (case-insensitive). Returns null for anything else —
 * PURE, no I/O, re-declared and tested by verify-wa-add-contact.
 */
function contactTypeFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[1-5]$/.test(trimmed)) {
    return CONTACT_TYPES[Number(trimmed) - 1]?.key ?? null;
  }
  const lowerKey = trimmed.toLowerCase().replace(/\s+/g, '_');
  const byKey = CONTACT_TYPES.find((t) => t.key === lowerKey);
  if (byKey) return byKey.key;
  const lowerLabel = trimmed.toLowerCase();
  const byLabel = CONTACT_TYPES.find((t) => t.label.toLowerCase() === lowerLabel);
  return byLabel ? byLabel.key : null;
}

function contactTypeLabel(key: string | null): string {
  if (!key) return '—';
  return CONTACT_TYPES.find((t) => t.key === key)?.label ?? key;
}

/**
 * An explicit, case-insensitive "nothing to say here" answer for an OPTIONAL step (person,
 * mobile, email — never type or company, both of which create_contact_simple itself requires).
 * PURE, re-declared and tested by verify-wa-add-contact.
 */
function isSkipAnswer(input: string): boolean {
  const normalised = input.trim().toLowerCase();
  return normalised === 'skip' || normalised === '-' || normalised === 'none' || normalised === 'n/a';
}

/** Matches create_contact_simple's own guard (btrim(p_company_name) = '') plus a length cap matching company_name varchar(255). */
function validateCompanyName(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: 'Company name cannot be empty. What is the company name?' };
  }
  if (trimmed.length > 255) {
    return { ok: false, error: 'That company name is too long (max 255 characters). What is the company name?' };
  }
  return { ok: true, value: trimmed };
}

/**
 * Normalises a typed mobile number: strips spaces/dashes/parentheses, keeps a leading '+', and
 * requires 7-15 remaining digits (E.164's own bounds) — permissive about format (this is a free
 * -text WhatsApp reply, not a web form), strict about plausibility. Matches
 * primary_contact_mobile varchar(20): the longest value this can produce is a '+' plus 15 digits
 * = 16 characters, well under the column's cap.
 */
function normaliseMobile(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const stripped = input.trim().replace(/[\s()-]/g, '');
  const hasPlus = stripped.startsWith('+');
  const digits = hasPlus ? stripped.slice(1) : stripped;
  if (!/^\d{7,15}$/.test(digits)) {
    return {
      ok: false,
      error: "That doesn't look like a mobile number. Please reply with a mobile number, or SKIP.",
    };
  }
  return { ok: true, value: hasPlus ? `+${digits}` : digits };
}

const ADD_CONTACT_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches primary_contact_email varchar(255). */
function validateEmail(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!ADD_CONTACT_EMAIL_RE.test(trimmed)) {
    return {
      ok: false,
      error: "That doesn't look like an email address. Please reply with an email address, or SKIP.",
    };
  }
  if (trimmed.length > 255) {
    return {
      ok: false,
      error: 'That email address is too long (max 255 characters). Please reply with an email address, or SKIP.',
    };
  }
  return { ok: true, value: trimmed };
}

/** The exact confirm-screen text — also what gets staged as ADD_CONTACT's `summary`. */
function buildAddContactSummary(fields: AddContactDraftFields): string {
  const lines = [
    `Type: ${contactTypeLabel(fields.contact_type)}`,
    `Company: ${fields.company_name ?? '—'}`,
    `Contact person: ${fields.primary_contact_name ?? '—'}`,
    `Mobile: ${fields.primary_contact_mobile ?? '—'}`,
    `Email: ${fields.primary_contact_email ?? '—'}`,
  ];
  return `New contact:\n\n${lines.join('\n')}`;
}

/**
 * Pulls raw strings off one WhatsApp shared-contact-card object (Meta's `contacts[]` message
 * shape: contact.org.company, contact.name.formatted_name, contact.phones[0].phone/wa_id,
 * contact.emails[0].email). Returns raw, UNVALIDATED strings (or null) — the caller
 * (startAddContact, via sanitisePrefill*) runs each through the SAME validators the typed flow
 * uses before accepting any of them as a prefill, so a malformed or missing card field can only
 * ever result in that step being asked for normally, never a bad value reaching the confirm
 * screen. PURE, re-declared and tested by verify-wa-add-contact.
 */
function extractSharedContact(contact: Any): {
  company_name: string | null;
  primary_contact_name: string | null;
  primary_contact_mobile: string | null;
  primary_contact_email: string | null;
} {
  const name = contact?.name?.formatted_name;
  const company = contact?.org?.company;
  const phone = contact?.phones?.[0]?.phone ?? contact?.phones?.[0]?.wa_id;
  const email = contact?.emails?.[0]?.email;
  return {
    company_name: typeof company === 'string' && company.trim() ? company.trim() : null,
    primary_contact_name: typeof name === 'string' && name.trim() ? name.trim() : null,
    primary_contact_mobile: typeof phone === 'string' && phone.trim() ? phone.trim() : null,
    primary_contact_email: typeof email === 'string' && email.trim() ? email.trim() : null,
  };
}

function sanitisePrefillCompany(v: string | null): string | null {
  if (!v) return null;
  const r = validateCompanyName(v);
  return r.ok ? r.value : null;
}

function sanitisePrefillName(v: string | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed && trimmed.length <= 255 ? trimmed : null;
}

function sanitisePrefillMobile(v: string | null): string | null {
  if (!v) return null;
  const r = normaliseMobile(v);
  return r.ok ? r.value : null;
}

function sanitisePrefillEmail(v: string | null): string | null {
  if (!v) return null;
  const r = validateEmail(v);
  return r.ok ? r.value : null;
}

/**
 * Read-only check for a live ADD_CONTACT_DRAFT via whatsapp_peek_pending_command
 * (migrations/20261001120000). Returns null on anything that is not EXACTLY a live
 * ADD_CONTACT_DRAFT with a recognised `step` — a missing RPC, an RPC error, nothing pending, or a
 * pending command of a DIFFERENT name (e.g. the member already answered every question and it is
 * now staged as ADD_CONTACT) all degrade to the same "no draft to route to" answer, which is
 * exactly what lets routeAddContactDraft fall through to normal dispatch in every one of those
 * cases.
 */
async function peekAddContactDraft(ctx: CommandContext): Promise<AddContactDraftPayload | null> {
  try {
    const { data, error } = await ctx.sb.rpc('whatsapp_peek_pending_command', {
      p_phone: ctx.phone,
      p_user_id: ctx.userId,
    });
    if (error) {
      if (!isMissingRpc(error)) {
        console.error('[whatsapp-inbound] whatsapp_peek_pending_command failed:', error.message);
      }
      return null;
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.success !== 1) return null;
    if (String(row.command || '').toUpperCase() !== 'ADD_CONTACT_DRAFT') return null;
    const payload = row.payload as Any;
    if (!payload || typeof payload !== 'object') return null;
    const step = String(payload.step ?? '');
    if (!(ADD_CONTACT_STEP_ORDER as readonly string[]).includes(step)) return null;
    return {
      step: step as AddContactStep,
      contact_type: payload.contact_type ?? null,
      company_name: payload.company_name ?? null,
      primary_contact_name: payload.primary_contact_name ?? null,
      primary_contact_mobile: payload.primary_contact_mobile ?? null,
      primary_contact_email: payload.primary_contact_email ?? null,
    };
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_peek_pending_command threw:', e);
    return null;
  }
}

/** Clears whatever draft is pending, swallowing any error — used on CANCEL/0/99/MENU mid-draft. */
async function clearAddContactDraft(ctx: CommandContext): Promise<void> {
  try {
    const { error } = await ctx.sb.rpc('whatsapp_clear_pending_command', {
      p_phone: ctx.phone,
      p_user_id: ctx.userId,
    });
    if (error && !isMissingRpc(error)) {
      console.error('[whatsapp-inbound] whatsapp_clear_pending_command failed for ADD_CONTACT_DRAFT:', error.message);
    }
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_clear_pending_command threw for ADD_CONTACT_DRAFT:', e);
  }
}

function addContactStepPromptText(step: 'company' | 'person' | 'mobile' | 'email'): string {
  switch (step) {
    case 'company':
      return 'What is the company name?';
    case 'person':
      return 'Who is the contact person? (Reply SKIP if none.)';
    case 'mobile':
      return "What is their mobile number? (Reply SKIP if you don't have one.)";
    case 'email':
      return "What is their email address? (Reply SKIP if you don't have one.)";
  }
}

/** Sends whatever `step` asks for, prefixed with an optional note (an invalid-answer message or a duplicate-company heads-up). */
async function sendAddContactStepPrompt(
  ctx: CommandContext,
  step: AddContactStep,
  note: string | null
): Promise<CommandResult> {
  if (step === 'type') {
    const rows = CONTACT_TYPES.map((t) => ({
      id: buildReplyId(CONTACT_NS, t.key),
      title: truncate(t.label, MAX_LIST_TITLE),
    }));
    const bodyText = `${note ? `${note}\n\n` : ''}Hi ${ctx.displayName}, let's add a contact. What type of contact is this?`;
    const result = await sendList(toWaPhone(ctx.phone), bodyText, 'Choose', [{ title: 'Contact type', rows }]);
    if (!result.ok) {
      console.error(`[whatsapp-inbound] /contact type list send failed, falling back to text: ${result.error}`);
      const lines = CONTACT_TYPES.map((t, i) => `${i + 1}. ${t.label}`);
      return {
        outcome: 'ok',
        reply: `${bodyText}\n\n${lines.join('\n')}\n\nReply with a number.`,
        command: 'ADDCONTACT',
        detail: 'type list send failed; text fallback',
      };
    }
    return { outcome: 'ok', reply: null, command: 'ADDCONTACT' };
  }

  if (step === 'done') {
    // Defensive only — stageAddContactDraft redirects to stageAddContactConfirm the moment
    // nextAddContactStep returns 'done' and never calls this function with step: 'done'.
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, something went wrong with that draft. Please start again with /contact.`,
      command: 'ADDCONTACT',
      detail: 'sendAddContactStepPrompt called with step=done',
    };
  }

  const prompt = addContactStepPromptText(step);
  return { outcome: 'ok', reply: note ? `${note}\n\n${prompt}` : prompt, command: 'ADDCONTACT' };
}

/**
 * Stages `fields` as ADD_CONTACT_DRAFT at whatever step nextAddContactStep lands on from `from`,
 * then sends that step's question — or, once every field is filled, hands off to
 * stageAddContactConfirm. Shared by startAddContact (first stage) and advanceAddContactDraft
 * (every subsequent answer) so there is exactly one place a draft is ever written and exactly one
 * place the next question is chosen.
 */
async function stageAddContactDraft(
  ctx: CommandContext,
  fields: AddContactDraftFields,
  from: AddContactStep,
  note: string | null
): Promise<CommandResult> {
  const step = nextAddContactStep(fields, from);

  if (step === 'done') {
    return stageAddContactConfirm(ctx, fields);
  }

  const payload: AddContactDraftPayload = { ...fields, step };

  try {
    const { error } = await ctx.sb.rpc('whatsapp_stage_pending_command', {
      p_phone: ctx.phone,
      p_user_id: ctx.userId,
      p_command: 'ADD_CONTACT_DRAFT',
      p_payload: payload,
      p_summary: `/contact draft — ${step} step`,
    });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] whatsapp_stage_pending_command is missing — migration 20260815130000 not applied.'
        );
      } else {
        console.error('[whatsapp-inbound] whatsapp_stage_pending_command failed for ADD_CONTACT_DRAFT:', error.message);
      }
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not continue that just now. Please try again shortly.`,
        command: 'ADDCONTACT',
        detail: error.message,
      };
    }
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_stage_pending_command threw for ADD_CONTACT_DRAFT:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not continue that just now. Please try again shortly.`,
      command: 'ADDCONTACT',
      detail: String(e),
    };
  }

  return sendAddContactStepPrompt(ctx, step, note);
}

/** Every field filled — stage the final confirm (command ADD_CONTACT) and ask for YES/NO. */
async function stageAddContactConfirm(ctx: CommandContext, fields: AddContactDraftFields): Promise<CommandResult> {
  const summary = buildAddContactSummary(fields);

  try {
    const { error } = await ctx.sb.rpc('whatsapp_stage_pending_command', {
      p_phone: ctx.phone,
      p_user_id: ctx.userId,
      p_command: 'ADD_CONTACT',
      p_payload: fields,
      p_summary: summary,
    });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] whatsapp_stage_pending_command is missing — migration 20260815130000 not applied.'
        );
      } else {
        console.error('[whatsapp-inbound] whatsapp_stage_pending_command failed for ADD_CONTACT:', error.message);
      }
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
        command: 'ADDCONTACT',
        detail: error.message,
      };
    }
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_stage_pending_command threw for ADD_CONTACT:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
      command: 'ADDCONTACT',
      detail: String(e),
    };
  }

  return { outcome: 'ok', reply: `${summary}\n\nReply YES to confirm, or NO to cancel.`, command: 'ADDCONTACT' };
}

/**
 * Processes one typed answer (or, from dispatchContactTypeTap, a resolved contact_type key)
 * against the draft's current step: validates it, and either re-asks the SAME step (invalid
 * answer, via sendAddContactStepPrompt with an error note) or re-stages via stageAddContactDraft
 * and asks the NEXT one. The company step's duplicate-company check runs HERE, once, only when
 * the company name is actively answered this way — never for a value that arrived prefilled from
 * a shared contact card and was therefore skipped by nextAddContactStep, which never calls this
 * function for a step it is skipping.
 */
async function advanceAddContactDraft(
  ctx: CommandContext,
  draft: AddContactDraftPayload,
  rawAnswer: string
): Promise<CommandResult> {
  const fields: AddContactDraftFields = {
    contact_type: draft.contact_type,
    company_name: draft.company_name,
    primary_contact_name: draft.primary_contact_name,
    primary_contact_mobile: draft.primary_contact_mobile,
    primary_contact_email: draft.primary_contact_email,
  };

  switch (draft.step) {
    case 'type': {
      const key = contactTypeFromInput(rawAnswer);
      if (!key) {
        return sendAddContactStepPrompt(
          ctx,
          'type',
          "Sorry, I didn't understand that. Please choose from the list, or reply with a number 1-5."
        );
      }
      fields.contact_type = key;
      return stageAddContactDraft(ctx, fields, 'company', null);
    }
    case 'company': {
      const result = validateCompanyName(rawAnswer);
      if (!result.ok) {
        return sendAddContactStepPrompt(ctx, 'company', result.error);
      }
      fields.company_name = result.value;

      let note: string | null = null;
      try {
        const { data, error } = await ctx.sb.rpc('whatsapp_find_contacts_by_company', {
          p_company_name: result.value,
        });
        if (error) {
          if (!isMissingRpc(error)) {
            console.error('[whatsapp-inbound] whatsapp_find_contacts_by_company failed:', error.message);
          }
        } else {
          const rows: Any[] = Array.isArray(data) ? data : data ? [data] : [];
          if (rows.length > 0) {
            note =
              rows.length === 1
                ? 'Heads up: a contact already exists with this company name. Continuing anyway.'
                : `Heads up: ${rows.length} contacts already exist with this company name. Continuing anyway.`;
          }
        }
      } catch (e) {
        console.error('[whatsapp-inbound] whatsapp_find_contacts_by_company threw:', e);
      }

      return stageAddContactDraft(ctx, fields, 'person', note);
    }
    case 'person': {
      if (isSkipAnswer(rawAnswer)) {
        fields.primary_contact_name = null;
        return stageAddContactDraft(ctx, fields, 'mobile', null);
      }
      const trimmed = rawAnswer.trim();
      if (!trimmed) {
        return sendAddContactStepPrompt(ctx, 'person', "Please reply with the contact person's name, or SKIP.");
      }
      if (trimmed.length > 255) {
        return sendAddContactStepPrompt(
          ctx,
          'person',
          'That name is too long (max 255 characters). Please try again, or SKIP.'
        );
      }
      fields.primary_contact_name = trimmed;
      return stageAddContactDraft(ctx, fields, 'mobile', null);
    }
    case 'mobile': {
      if (isSkipAnswer(rawAnswer)) {
        fields.primary_contact_mobile = null;
        return stageAddContactDraft(ctx, fields, 'email', null);
      }
      const result = normaliseMobile(rawAnswer);
      if (!result.ok) {
        return sendAddContactStepPrompt(ctx, 'mobile', result.error);
      }
      fields.primary_contact_mobile = result.value;
      return stageAddContactDraft(ctx, fields, 'email', null);
    }
    case 'email': {
      if (isSkipAnswer(rawAnswer)) {
        fields.primary_contact_email = null;
        return stageAddContactDraft(ctx, fields, 'done', null);
      }
      const result = validateEmail(rawAnswer);
      if (!result.ok) {
        return sendAddContactStepPrompt(ctx, 'email', result.error);
      }
      fields.primary_contact_email = result.value;
      return stageAddContactDraft(ctx, fields, 'done', null);
    }
    default:
      // 'done' should never reach here — a live ADD_CONTACT_DRAFT always has a step before
      // 'done' (stageAddContactDraft hands off to stageAddContactConfirm the instant
      // nextAddContactStep returns 'done' and never re-stages a draft with step: 'done').
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, that request has expired. Please start again with /contact.`,
        command: 'ADDCONTACT',
        detail: `unexpected draft step: ${draft.step}`,
      };
  }
}

/**
 * Dispatches a CONTACT_NS reply-id tap (the /contact type step's list) — `key` is the
 * contact_type value carried directly as the reply id's action segment. Peeks for a live
 * ADD_CONTACT_DRAFT at step 'type' first: a tap on an expired list, or one sent before the draft
 * had already moved on (e.g. re-delivered), must not silently overwrite or skip ahead of whatever
 * the draft is actually waiting on.
 */
async function dispatchContactTypeTap(ctx: CommandContext, key: string): Promise<CommandResult> {
  const peeked = await peekAddContactDraft(ctx);
  if (!peeked || peeked.step !== 'type') {
    return {
      outcome: 'unknown_command',
      reply: `Sorry ${ctx.displayName}, that contact form has expired. Reply CONTACT to start again.`,
      command: 'ADDCONTACT',
      detail: 'no live ADD_CONTACT_DRAFT at step type',
    };
  }
  return advanceAddContactDraft(ctx, peeked, key);
}

/**
 * Called from handleCommand BEFORE the HELP/verb lookup, for every TYPED (non-tap) message from
 * an enrolled member. Peeks for a live ADD_CONTACT_DRAFT; when there is NOT one, returns null so
 * the caller falls through to normal dispatch UNCHANGED — this is what lets YES keep working once
 * the draft is finalised and re-staged as ADD_CONTACT (a different `command` value: commandYes
 * looks the staged command up by name, so it reaches STAGED_COMMAND_HANDLERS.ADD_CONTACT with no
 * special-casing needed here).
 *
 * When there IS a live draft: CANCEL/NO/N clears it; 0/99/MENU clears it AND opens the menu
 * (leaving a half-filled draft in place would otherwise block the member from reaching anything
 * else); HELP answers without disturbing the draft. Anything else is treated as the answer to the
 * draft's current step.
 */
async function routeAddContactDraft(ctx: CommandContext): Promise<CommandResult | null> {
  const peeked = await peekAddContactDraft(ctx);
  if (!peeked) return null;

  const collapsed = ctx.rawBody.trim().replace(/\s+/g, ' ').replace(/^\//, '');
  const verb = (collapsed.split(' ')[0] || '').toUpperCase();

  if (verb === 'CANCEL' || verb === 'NO' || verb === 'N') {
    await clearAddContactDraft(ctx);
    return { outcome: 'ok', reply: `OK ${ctx.displayName}, cancelled — nothing was saved.`, command: 'ADDCONTACT' };
  }

  if (verb === '0' || verb === '99' || verb === 'MENU') {
    await clearAddContactDraft(ctx);
    return commandMenu(ctx);
  }

  if (verb === 'HELP') {
    return commandHelp(ctx);
  }

  return advanceAddContactDraft(ctx, peeked, ctx.rawBody);
}

/**
 * The top-level entry point for /contact: typed CONTACT/ADDCONTACT/NEWCONTACT/"ADD CONTACT", the
 * "Add contact" menu row (MENU_ITEMS' subMenu), and a shared contact card
 * (processCommandForMessage's type:'contacts' branch, which passes `prefill`).
 *
 * Checks the crm-grid feature first — the SAME key the portal's Contacts screen is gated on (see
 * MENU_ITEMS' `feature` convention) — then checks the new RPCs exist (degrade, do not 500):
 * whatsapp_peek_pending_command is called as an existence PROXY for the whole migration, since
 * both new RPCs ship together in migrations/20261001120000_whatsapp_add_contact_support.sql.
 *
 * `prefill`, when given, is run through the SAME validators the typed flow itself uses
 * (sanitisePrefillCompany/Name/Mobile/Email, each wrapping validateCompanyName/normaliseMobile/
 * validateEmail) before being accepted — an invalid or unparseable value from a card is silently
 * DROPPED rather than stored, so that step is simply asked for normally instead of a bad value
 * ever reaching the confirm screen.
 */
async function startAddContact(
  ctx: CommandContext,
  prefill?: {
    company_name?: string | null;
    primary_contact_name?: string | null;
    primary_contact_mobile?: string | null;
    primary_contact_email?: string | null;
  }
): Promise<CommandResult> {
  const featureKeys = await loadFeatureKeys(ctx.sb, ctx.roleId);
  if (!featureKeys.has('crm-grid')) {
    return {
      outcome: 'denied',
      reply: `Sorry ${ctx.displayName}, adding contacts is not on your access. Reply 99 for the menu.`,
      command: 'ADDCONTACT',
    };
  }

  const peek = await ctx.sb.rpc('whatsapp_peek_pending_command', { p_phone: ctx.phone, p_user_id: ctx.userId });
  if (peek.error && isMissingRpc(peek.error)) {
    console.error(
      '[whatsapp-inbound] whatsapp_peek_pending_command is missing — migration 20261001120000 not applied.'
    );
    return {
      outcome: 'error',
      reply: `Adding contacts on WhatsApp is not switched on yet, ${ctx.displayName}. Please use the portal for now.`,
      command: 'ADDCONTACT',
      detail: 'migration 20261001120000 not applied',
    };
  }

  const fields: AddContactDraftFields = {
    contact_type: null,
    company_name: sanitisePrefillCompany(prefill?.company_name ?? null),
    primary_contact_name: sanitisePrefillName(prefill?.primary_contact_name ?? null),
    primary_contact_mobile: sanitisePrefillMobile(prefill?.primary_contact_mobile ?? null),
    primary_contact_email: sanitisePrefillEmail(prefill?.primary_contact_email ?? null),
  };

  return stageAddContactDraft(ctx, fields, 'type', null);
}

/**
 * One text field off a submitted Flow form, trimmed. A field the member left empty can come back
 * as an empty string, as a missing key, or (by some accounts of Meta's behaviour, unconfirmed
 * here) as the unsubstituted `${form.x}` binding itself, so all three read as empty. PURE.
 */
function flowFieldString(v: unknown): string {
  if (typeof v !== 'string') return '';
  const trimmed = v.trim();
  return trimmed.startsWith('${') ? '' : trimmed;
}

/**
 * Validates the ADD_CONTACT Flow screen's submission with the SAME rules as the typed /contact
 * steps. The Flow's own `required` flags run on the handset and are not trusted: every field is
 * re-checked here. Returns every problem at once, so the member can fix them in one go. PURE,
 * re-declared and tested by verify-wa-add-contact.
 */
function parseAddContactFlowSubmission(
  response: Record<string, unknown>
): { ok: true; fields: AddContactDraftFields } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const typeRaw = flowFieldString(response.contact_type);
  const contactType = CONTACT_TYPES.some((t) => t.key === typeRaw) ? typeRaw : null;
  if (!contactType) errors.push('Choose a contact type.');

  const company = validateCompanyName(flowFieldString(response.company_name));
  if (!company.ok) errors.push('Company name is required (max 255 characters).');

  const personRaw = flowFieldString(response.contact_name);
  if (personRaw.length > 255) errors.push('Contact person is too long (max 255 characters).');

  const mobileRaw = flowFieldString(response.mobile);
  const mobile = mobileRaw ? normaliseMobile(mobileRaw) : null;
  if (mobile && !mobile.ok) errors.push("Mobile doesn't look like a phone number.");

  const emailRaw = flowFieldString(response.email);
  const email = emailRaw ? validateEmail(emailRaw) : null;
  if (email && !email.ok) errors.push("Email doesn't look like an email address.");

  if (errors.length > 0 || !company.ok) return { ok: false, errors };

  return {
    ok: true,
    fields: {
      contact_type: contactType,
      company_name: company.value,
      primary_contact_name: personRaw || null,
      primary_contact_mobile: mobile && mobile.ok ? mobile.value : null,
      primary_contact_email: email && email.ok ? email.value : null,
    },
  };
}

/**
 * A submitted WhatsApp Flow form (processCommandForMessage's nfm_reply branch). Only the menu
 * Flow's ADD_CONTACT screen means anything here. Every other submission, including the DETAIL
 * screen's own "Close" button (payload `{ flow: 'daily_report_menu' }`), is logged and gets NO
 * reply: closing a report must never produce a message.
 *
 * A valid add-contact form goes to the same place the typed flow ends up: stageAddContactConfirm
 * stages ADD_CONTACT and asks for YES, and the ADD_CONTACT staged handler does the write. There
 * is one write path, not two. The flow_token is not an authorisation; the enrolled sender is.
 */
async function handleAddContactFlowSubmit(
  ctx: CommandContext,
  response: Record<string, unknown>
): Promise<CommandResult> {
  if (response.form !== 'add_contact') {
    return {
      outcome: 'ok',
      reply: null,
      command: 'FLOW',
      detail: `flow submission ignored (form=${String(response.form ?? response.flow ?? 'none').slice(0, 40)})`,
    };
  }

  const featureKeys = await loadFeatureKeys(ctx.sb, ctx.roleId);
  if (!featureKeys.has('crm-grid')) {
    return {
      outcome: 'denied',
      reply: `Sorry ${ctx.displayName}, adding contacts is not on your access. Reply 99 for the menu.`,
      command: 'ADDCONTACT:FLOW',
    };
  }

  const parsed = parseAddContactFlowSubmission(response);
  if (!parsed.ok) {
    return {
      outcome: 'ok',
      reply:
        `Sorry ${ctx.displayName}, that contact was not saved:\n\n` +
        parsed.errors.map((e) => `• ${e}`).join('\n') +
        `\n\nSend /contact to try again.`,
      command: 'ADDCONTACT:FLOW',
      detail: 'invalid form submission',
    };
  }

  let note: string | null = null;
  try {
    const { data, error } = await ctx.sb.rpc('whatsapp_find_contacts_by_company', {
      p_company_name: parsed.fields.company_name,
    });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] whatsapp_find_contacts_by_company is missing — migration 20261001120000 not applied.'
        );
        return {
          outcome: 'error',
          reply: `Adding contacts on WhatsApp is not switched on yet, ${ctx.displayName}. Please use the portal for now.`,
          command: 'ADDCONTACT:FLOW',
          detail: 'migration 20261001120000 not applied',
        };
      }
      console.error('[whatsapp-inbound] whatsapp_find_contacts_by_company failed:', error.message);
    } else {
      const rows: Any[] = Array.isArray(data) ? data : data ? [data] : [];
      if (rows.length > 0) {
        note =
          rows.length === 1
            ? 'Heads up: a contact already exists with this company name.'
            : `Heads up: ${rows.length} contacts already exist with this company name.`;
      }
    }
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_find_contacts_by_company threw:', e);
  }

  const result = await stageAddContactConfirm(ctx, parsed.fields);
  const tagged = { ...result, command: 'ADDCONTACT:FLOW' };
  if (note && result.outcome === 'ok' && result.reply) {
    return { ...tagged, reply: `${note}\n\n${result.reply}` };
  }
  return tagged;
}

// ============================================================================
// Staged-command handlers — dispatched by YES on whatever was staged via
// whatsapp_stage_pending_command, keyed on its `command` value.
//
// A handler here runs only after the member has replied YES, which can be minutes after staging —
// so it re-checks its own permission rather than trusting the check made at staging time. Add a
// new write command by registering a handler here AND the verb that stages it in COMMAND_HANDLERS.
// ============================================================================

interface StagedCommand {
  command: string;
  payload: Any;
  summary: string;
}

const STAGED_COMMAND_HANDLERS: Record<
  string,
  (ctx: CommandContext, staged: StagedCommand) => Promise<CommandResult>
> = {
  /**
   * ACK_ALERT — staged by commandAck, applied when the member replies YES.
   *
   * The permission is re-checked HERE as well as in commandAck. A staged command can be confirmed
   * minutes later and a role can change in between; the check at staging time is not the one that
   * authorises the write.
   */
  ACK_ALERT: async (ctx, staged) => {
    const alertId = String(staged.payload?.alertId ?? '');
    const title = String(staged.payload?.title ?? 'that alert');

    if (!alertId) {
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I lost track of which alert that was. Please open the alerts list again.`,
        command: 'ACK_ALERT',
        detail: 'staged payload missing alertId',
      };
    }

    if (!(await hasAction(ctx.sb, ctx.userId, 'alerts.resolve'))) {
      return {
        outcome: 'denied',
        reply: `Sorry ${ctx.displayName}, closing alerts is not on your access.`,
        command: 'ACK_ALERT',
      };
    }

    let row: Any;
    try {
      const { data, error } = await ctx.sb.rpc('resolve_dashboard_alert', {
        p_alert_id: alertId,
        p_note: `Acknowledged over WhatsApp by ${ctx.displayName}`,
      });
      if (error) {
        if (isMissingRpc(error)) {
          console.error(
            '[whatsapp-inbound] resolve_dashboard_alert is missing — migration 20260706100000 not applied.'
          );
        } else {
          console.error('[whatsapp-inbound] resolve_dashboard_alert failed:', error.message);
        }
        return {
          outcome: 'error',
          reply: `Sorry ${ctx.displayName}, I could not close that just now. Please try again shortly.`,
          command: 'ACK_ALERT',
          detail: error.message,
        };
      }
      row = Array.isArray(data) ? data[0] : data;
    } catch (e) {
      console.error('[whatsapp-inbound] resolve_dashboard_alert threw:', e);
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not close that just now. Please try again shortly.`,
        command: 'ACK_ALERT',
        detail: String(e),
      };
    }

    // resolve_dashboard_alert updates only WHERE status = 'active' and reports
    // { success: false, error: 'Alert not found or already resolved' } when it matched no row
    // (migrations/20260706100000_phase2_implementation_complete.sql:12-30). That is a normal
    // outcome, not a failure.
    if (row?.success !== true) {
      return {
        outcome: 'ok',
        reply: `That one is already closed, ${ctx.displayName}.`,
        command: 'ACK_ALERT',
      };
    }

    return {
      outcome: 'ok',
      reply: `Noted, ${ctx.displayName}. "${title}" is marked acknowledged in the portal.`,
      command: 'ACK_ALERT',
    };
  },

  /**
   * STOP_ALL_REPORTS — staged by commandSettingsStopAll (the "My reports" menu's "Stop everything"
   * row), applied when the member replies YES. Calls the SAME report_set_opt_out RPC wa-flow-02's
   * typed STOP calls directly (handleOptOutVerbs, above) — one RPC, two entry points, and this is
   * the only one of the two that confirms first.
   */
  STOP_ALL_REPORTS: async (ctx) => {
    try {
      const { data, error } = await ctx.sb.rpc('report_set_opt_out', {
        p_phone: ctx.phone,
        p_opted_out: true,
      });
      if (error) {
        if (isMissingRpc(error)) {
          console.error(
            '[whatsapp-inbound] report_set_opt_out is missing — migration 20260907130000 not applied.'
          );
        }
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.ok !== true) {
        throw new Error(row?.error || 'report_set_opt_out returned ok=false');
      }
    } catch (e) {
      console.error('[whatsapp-inbound] report_set_opt_out failed for staged stop-everything:', e);
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not record that just now. Please try again shortly.`,
        command: 'STOP_ALL_REPORTS',
        detail: String(e),
      };
    }

    return {
      outcome: 'ok',
      reply:
        'You will not receive any further report messages from Macavation. ' +
        'Text START if you want to allow them again.',
      command: 'STOP_ALL_REPORTS',
    };
  },

  /**
   * ADD_CONTACT — staged by stageAddContactConfirm once every /contact draft step is filled,
   * applied when the member replies YES. Re-checks crm-grid HERE too, same reasoning as every
   * other handler in this map: a draft can be confirmed minutes after it was finished and a
   * role can change in between.
   */
  ADD_CONTACT: async (ctx, staged) => {
    const featureKeys = await loadFeatureKeys(ctx.sb, ctx.roleId);
    if (!featureKeys.has('crm-grid')) {
      return {
        outcome: 'denied',
        reply: `Sorry ${ctx.displayName}, adding contacts is not on your access.`,
        command: 'ADD_CONTACT',
      };
    }

    const payload = staged.payload as Any;
    const contactType = String(payload?.contact_type ?? '');
    const companyName = String(payload?.company_name ?? '');
    if (!contactType || !companyName) {
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I lost track of that draft. Please start again with /contact.`,
        command: 'ADD_CONTACT',
        detail: 'staged payload missing contact_type or company_name',
      };
    }

    try {
      const { data, error } = await ctx.sb.rpc('create_contact_simple', {
        p_contact_type: contactType,
        p_company_name: companyName,
        p_primary_contact_name: payload?.primary_contact_name ?? null,
        p_primary_contact_mobile: payload?.primary_contact_mobile ?? null,
        p_primary_contact_email: payload?.primary_contact_email ?? null,
      });
      if (error) {
        if (isMissingRpc(error)) {
          console.error(
            '[whatsapp-inbound] create_contact_simple is missing — migration 20260818090200 not applied.'
          );
        } else {
          console.error('[whatsapp-inbound] create_contact_simple failed:', error.message);
        }
        return {
          outcome: 'error',
          reply: `Sorry ${ctx.displayName}, I could not save that just now. Please try again shortly.`,
          command: 'ADD_CONTACT',
          detail: error.message,
        };
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.success !== true) {
        return {
          outcome: 'error',
          reply: `Sorry ${ctx.displayName}, I could not save that: ${row?.error ?? 'unknown error'}.`,
          command: 'ADD_CONTACT',
          detail: row?.error ?? null,
        };
      }
    } catch (e) {
      console.error('[whatsapp-inbound] create_contact_simple threw:', e);
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not save that just now. Please try again shortly.`,
        command: 'ADD_CONTACT',
        detail: String(e),
      };
    }

    return {
      outcome: 'ok',
      reply: `Saved, ${ctx.displayName}. "${companyName}" has been added to Contacts.`,
      command: 'ADD_CONTACT',
    };
  },
};

/**
 * YES / Y / CONFIRM — takes (fetches-and-deletes) whatever is staged for this phone+user and
 * applies it via STAGED_COMMAND_HANDLERS. With nothing pending, or an RPC failure, replies
 * accordingly rather than throwing; a staged command with no registered handler replies that the
 * request has expired.
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

/**
 * ACK <n> — stage the acknowledgement of the nth open alert, awaiting YES. Also the SAME staging
 * step a "Mark resolved" button tap on the macavation_alert push template uses — see `resolved`
 * below.
 *
 * <n> is a position in the list the member was just shown, which comes from get_daily_digest()'s
 * open_alerts (ordered created_at DESC, LIMIT 25). This re-reads that SAME source rather than
 * querying dashboard_alerts directly, so there is only ever one definition of "open alerts".
 *
 * There is deliberately NO stored copy of the list. The alerts view renders synchronously with no
 * client and could not stage one, and there is no read-without-delete RPC to read it back with —
 * whatsapp_take_pending_command fetches AND deletes in one statement, by design. What makes this
 * safe instead is the confirmation step: it names the alert, so if the list shifted between the
 * listing and the ACK the member sees a title they did not expect and replies NO.
 *
 * `resolved` lets a caller that already knows WHICH alert (a button tap, which carries a resolved
 * alert id/title rather than a list position) skip straight to the permission check and staging
 * below, without a fake "ACK <n>" body to parse. dispatchAlertAck (below) is the only other caller,
 * and calls this SAME function — not a second, parallel staging body — so there is exactly one
 * place ACK_ALERT is ever staged from, and a tap can never reach whatsapp_stage_pending_command
 * without the alerts.resolve re-check every typed ACK <n> already gets. `command` only changes
 * what is logged/returned as the audit command name; the check-then-stage logic itself never
 * branches on it.
 */
async function commandAck(
  ctx: CommandContext,
  resolved?: { alertId: string; title: string },
  command = 'ACK'
): Promise<CommandResult> {
  let alertId: string;
  let title: string;

  if (resolved) {
    alertId = resolved.alertId;
    title = resolved.title;
  } else {
    const parts = ctx.rawBody.trim().replace(/\s+/g, ' ').split(' ');
    const raw = parts[1] ?? '';
    const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;

    if (!Number.isInteger(n) || n < 1 || n > ALERT_LIST_MAX) {
      return {
        outcome: 'unknown_command',
        reply:
          `Reply ACK followed by the number of the alert, for example ACK 2. ` +
          `Reply 99 for the menu to see the list again.`,
        command,
      };
    }

    let alerts: Any[] = [];
    try {
      const { data, error } = await ctx.sb.rpc('get_daily_digest');
      if (error) throw error;
      const digest = Array.isArray(data) ? data[0] : data;
      alerts = Array.isArray(digest?.open_alerts) ? digest.open_alerts : [];
    } catch (e) {
      console.error('[whatsapp-inbound] get_daily_digest failed for ACK:', e);
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not read the alerts just now. Please try again shortly.`,
        command,
        detail: String(e),
      };
    }

    const chosen = alerts[n - 1];
    const resolvedId = chosen?.id ? String(chosen.id) : '';
    if (!resolvedId) {
      return {
        outcome: 'ok',
        reply: `There is no alert ${n} open right now, ${ctx.displayName}. Reply 99 for the menu to see the current list.`,
        command,
      };
    }

    alertId = resolvedId;
    title = String(chosen?.title ?? 'Untitled');
  }

  if (!(await hasAction(ctx.sb, ctx.userId, 'alerts.resolve'))) {
    return {
      outcome: 'denied',
      reply: `Sorry ${ctx.displayName}, closing alerts is not on your access. Speak to an administrator if you need it.`,
      command,
    };
  }

  const summary = `Acknowledge "${title}"`;

  try {
    const { error } = await ctx.sb.rpc('whatsapp_stage_pending_command', {
      p_phone: ctx.phone,
      p_user_id: ctx.userId,
      p_command: 'ACK_ALERT',
      p_payload: { alertId, title },
      p_summary: summary,
    });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] whatsapp_stage_pending_command is missing — migration 20260815130000 not applied.'
        );
      } else {
        console.error('[whatsapp-inbound] whatsapp_stage_pending_command failed:', error.message);
      }
      return {
        outcome: 'error',
        reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
        command,
        detail: error.message,
      };
    }
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_stage_pending_command threw:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
      command,
      detail: String(e),
    };
  }

  return {
    outcome: 'ok',
    reply: `${summary}?\n\nReply YES to confirm, or NO to cancel.`,
    command,
  };
}

/**
 * Dispatches an ALERT_NS reply-id tap — currently only "Mark resolved" on the macavation_alert
 * push template. `ref` is the truncated alert reference the reply id carries (see ALERT_ACK_ACTION
 * above); resolve_dashboard_alert_by_ref resolves it back to a real, currently-open alert. Anything
 * other than exactly one match — the alert closed already, or (vanishingly unlikely) a colliding
 * prefix — is treated as a stale tap, same posture as an unrecognised reply id elsewhere in this
 * file. A resolved match is staged through commandAck's `resolved` parameter — the SAME function
 * (and the SAME inline permission-check-then-stage body) the typed "ACK <n>" path calls, not a
 * second, parallel staging function.
 */
async function dispatchAlertAck(ctx: CommandContext, ref: string): Promise<CommandResult> {
  let rows: Any[] = [];
  try {
    const { data, error } = await ctx.sb.rpc('resolve_dashboard_alert_by_ref', { p_ref: ref });
    if (error) throw error;
    rows = Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[whatsapp-inbound] resolve_dashboard_alert_by_ref failed:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not read that alert just now. Please try again shortly.`,
      command: 'ALERT_ACK_TAP',
      detail: String(e),
    };
  }

  if (rows.length !== 1) {
    return {
      outcome: 'unknown_command',
      reply: `Sorry ${ctx.displayName}, that alert is no longer open. Reply 99 for the menu to see the current list.`,
      command: 'ALERT_ACK_TAP',
      detail: `resolve_dashboard_alert_by_ref returned ${rows.length} row(s) for ref ${ref}`,
    };
  }

  const alertId = String(rows[0].id);
  const title = String(rows[0].alert_title ?? 'Untitled');
  return commandAck(ctx, { alertId, title }, 'ALERT_ACK_TAP');
}

/**
 * RESUME — clears a PAUSED daily subscription and nothing else. Post-gate (an enrolled staff
 * member only — the bot's only identity path is whatsapp_resolve_staff_user; STOP/START are the
 * exception because they need no identity, see handleOptOutVerbs above).
 *
 * Deliberately narrow: weekly/monthly pause state is not readable anywhere in this checkout
 * (report_recipient_by_inbound_phone returns only subscribed_daily and the daily muted_until,
 * migrations/20260825090000_report_subscriptions_and_staff.sql:303-327), and the only write RPC
 * available, set_report_subscription_by_phone, CREATES a subscription it does not find
 * (INSERT ... ON CONFLICT DO UPDATE SET is_active = true, :367-374). Calling it for a kind the
 * person never subscribed to — or for a row an administrator switched off — would sign them up or
 * re-enable consent they never gave. So this NEVER calls it unless subscribed_daily is already
 * true AND muted_until is already set (checked below, in that order, before the call site).
 * Extending RESUME to weekly/monthly needs a read RPC that does not exist yet — a later plan's job.
 *
 * No date arithmetic here: if muted_until is non-null, it is cleared and the reply says the pause
 * was lifted — true whether or not it had already expired. public.report_sast_today() is this
 * repo's only "today" and report_daily_recipients already applies it; a JS-side comparison here
 * would be a second, drifting answer.
 */
async function commandResume(ctx: CommandContext): Promise<CommandResult> {
  let row: Any;
  try {
    const { data, error } = await ctx.sb.rpc('report_recipient_by_inbound_phone', { p_phone: ctx.phone });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] report_recipient_by_inbound_phone is missing — migration 20260825090000 not applied.'
        );
        return {
          outcome: 'error',
          reply: `Sorry ${ctx.displayName}, I could not check that just now.`,
          command: 'RESUME',
          detail: 'rpc missing',
        };
      }
      throw error;
    }
    row = Array.isArray(data) ? data[0] : data;
  } catch (e) {
    console.error('[whatsapp-inbound] report_recipient_by_inbound_phone failed for RESUME:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not check that just now.`,
      command: 'RESUME',
      detail: String(e),
    };
  }

  if (!row || row.found !== true) {
    // report_recipient_by_inbound_phone filters is_active, so an admin-deactivated roster row
    // lands here too — correct: there is nothing this verb can safely do for such a row.
    return {
      outcome: 'ok',
      reply: `There is no pause on this number, ${ctx.displayName}.`,
      command: 'RESUME',
    };
  }

  if (row.subscribed_daily !== true || row.muted_until === null || row.muted_until === undefined) {
    return {
      outcome: 'ok',
      reply: `Nothing is paused on this number, ${ctx.displayName}.`,
      command: 'RESUME',
    };
  }

  try {
    const { data, error } = await ctx.sb.rpc('set_report_subscription_by_phone', {
      p_phone: ctx.phone,
      p_report_kind: 'daily',
      p_is_active: true,
      p_muted_until: null,
    });
    if (error) throw error;
    const result = Array.isArray(data) ? data[0] : data;
    if (!result || result.ok !== true) {
      throw new Error(result?.error || 'set_report_subscription_by_phone returned ok=false');
    }
  } catch (e) {
    console.error('[whatsapp-inbound] set_report_subscription_by_phone failed for RESUME:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not lift that pause just now. Please try again shortly.`,
      command: 'RESUME',
      detail: String(e),
    };
  }

  return {
    outcome: 'ok',
    reply: `The pause on your daily report has been lifted, ${ctx.displayName}.`,
    command: 'RESUME',
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
  // Typed shortcuts to menu items, for members who would rather type than tap. Each one goes
  // through renderMenuItem, so the role's CURRENT feature set is re-checked exactly as for a tap
  // — typing a shortcut for an item outside the role's current visible set gets exactly the same
  // "not available to you" reply a stale tap would, never the figures themselves.
  REPORT: (ctx) => renderMenuItem(ctx, 'report'),
  PRODUCTION: (ctx) => renderMenuItem(ctx, 'production'),
  STOCK: (ctx) => renderMenuItem(ctx, 'stock'),
  YIELD: (ctx) => renderMenuItem(ctx, 'yield'),
  ALERTS: (ctx) => renderMenuItem(ctx, 'alerts'),
  INTAKE: (ctx) => renderMenuItem(ctx, 'intake'),
  DIGEST: (ctx) => renderMenuItem(ctx, 'digest'),
  // /contact, /addcontact, /newcontact — same renderMenuItem shortcut shape as the shortcuts just
  // above: re-checks crm-grid via the role's CURRENT visible set (renderMenuItem), then dispatches
  // to the 'addcontact' MENU_ITEMS row's subMenu (startAddContact), exactly like a tap on that row.
  CONTACT: (ctx) => renderMenuItem(ctx, 'addcontact'),
  ADDCONTACT: (ctx) => renderMenuItem(ctx, 'addcontact'),
  NEWCONTACT: (ctx) => renderMenuItem(ctx, 'addcontact'),
  // ADD <contact|contacts> — "ADD" alone collides with no existing single-word verb, but a bare
  // ADD is ambiguous (add what?), so this only starts the flow when the SECOND word is literally
  // "contact"/"contacts"; anything else (including a bare "ADD") falls through to the menu, same
  // as any other unrecognised text (handleCommand's own final fallback).
  ADD: (ctx) => {
    const rest = ctx.rawBody
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^\//, '')
      .split(' ')
      .slice(1)
      .join(' ')
      .toLowerCase();
    if (rest === 'contact' || rest === 'contacts') {
      return renderMenuItem(ctx, 'addcontact');
    }
    return commandMenu(ctx);
  },
  // ACK <n> — stages an alert acknowledgement, applied by YES.
  ACK: commandAck,
  // RESUME — lifts a paused daily report subscription. Post-gate: STOP is the pre-gate opt-out
  // path (handleOptOutVerbs, above processCommandForMessage) and is deliberately NOT registered
  // here — a COMMAND_HANDLERS.STOP entry would be unreachable dead code, since CommandContext does
  // not exist before whatsapp_resolve_staff_user succeeds.
  RESUME: commandResume,
  // The menu, plus the greetings somebody actually opens a chat with.
  MENU: commandMenu,
  HI: commandMenu,
  HELLO: commandMenu,
  START: commandMenu,
  // 0 = back, 99 = main menu — the fixed convention, on every step, for every instance. This
  // menu is one level deep so both reach the same place; they are registered separately so the
  // convention already holds when a second level is added. The legacy 9 is deliberately absent.
  '0': commandMenu,
  '99': commandMenu,
};

/**
 * The two quick-reply buttons declared on the daily report template
 * (scripts/wa-template-daily-production.mjs), keyed by the button label trimmed and lowercased.
 *
 * Keyed on the LABEL, not on a `menu:<action>` reply id, because a tap on a template quick-reply
 * arrives as type:'button' and _shared/wa-inbound.ts sets replyId = button.payload when a payload
 * is present, else button.text. This checkout has never sent a template with buttons and cannot
 * verify whether Meta supplies a payload here, so the label is the only value certainly available.
 * This is still a match on ctx.replyId — the id — and never on the display text the member saw;
 * nothing in this file reads that.
 *
 * If Meta does supply a payload that is not the label, neither key matches and the tap falls
 * through to the stale-menu reply below, unchanged. Both routes re-check the role, so a match can
 * never grant more than the menu would.
 */
const TEMPLATE_BUTTON_ROUTES: Record<
  string,
  { command: string; run: (ctx: CommandContext) => Promise<CommandResult> }
> = {
  'view report': { command: 'TPL:VIEW_REPORT', run: (ctx) => renderMenuItem(ctx, 'report') },
  menu: { command: 'TPL:MENU', run: commandMenu },
};

/**
 * Parses a tap or a typed verb and dispatches.
 *
 * Order matters and is deliberate:
 *   1. A menu TAP (ctx.replyId) wins outright — it is a stable id, not free text.
 *   2. HELP is the only word that still short-circuits to the help text.
 *   3. An empty body or "?" opens the MENU. This is the change from the store-only era, when
 *      both fell through to HELP: a member who says "Hi" wants to be shown what they can do,
 *      not read a list of verbs to type.
 *   4. A registered verb (including '0' and '99').
 *   5. A bare one- or two-digit number = a position in the role's own visible menu, which is
 *      what makes the plain-text menu fallback work.
 *   6. Anything else opens the MENU too — the router no longer answers an unrecognised verb with
 *      a list of words to type (see the return commandMenu(ctx) at the end of this function).
 */
async function handleCommand(ctx: CommandContext): Promise<CommandResult> {
  if (ctx.replyId) {
    const parsed = parseReplyId(ctx.replyId);
    if (parsed && parsed.ns === MENU_NS) {
      return renderMenuItem(ctx, parsed.action);
    }
    if (parsed && parsed.ns === SETTINGS_NS) {
      return dispatchSettingsAction(ctx, parsed.action);
    }
    if (parsed && parsed.ns === ALERT_NS && parsed.action === ALERT_ACK_ACTION && parsed.arg) {
      return dispatchAlertAck(ctx, parsed.arg);
    }
    // A tap on the /contact flow's "type" step list — the only step sent as taps rather than
    // free text. See dispatchContactTypeTap's own comment for why this re-peeks the draft rather
    // than trusting the tap alone.
    if (parsed && parsed.ns === CONTACT_NS) {
      return dispatchContactTypeTap(ctx, parsed.action);
    }
    // A template quick-reply tap. hasOwnProperty for the same reason as the COMMAND_HANDLERS
    // lookup below: the key is text off a public WhatsApp line and this is a plain object.
    const templateKey = ctx.replyId.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(TEMPLATE_BUTTON_ROUTES, templateKey)) {
      const route = TEMPLATE_BUTTON_ROUTES[templateKey];
      const result = await route.run(ctx);
      // Only `command` is overridden: `outcome` must stay one of the five values
      // whatsapp_command_log_outcome_check allows, and `reply: null` must survive — commandMenu
      // has already sent its own list.
      return { ...result, command: route.command };
    }
    // A well-formed id from another namespace, or an id this build does not know: treat it as a
    // stale menu rather than an error, since the commonest cause is a tap on a menu sent by an
    // older deployment.
    return {
      outcome: 'unknown_command',
      reply:
        `Sorry ${ctx.displayName}, that option is no longer available. Reply 99 for the menu.`,
      command: 'MENU',
      detail: `unrecognised reply id: ${ctx.replyId}`,
    };
  }

  // A live /contact draft claims every FREE-TEXT message (never a tap — those are handled above)
  // ahead of every other branch below, including the bare-digit menu-position shortcut and the
  // "unmatched text opens the menu" fallback: while a draft is mid-flow, a typed company name, a
  // digit standing in for a type tap, or a bare "menu"/"cancel" must all be read as answers to or
  // escapes from the DRAFT, never as ordinary menu input. Returns null (falls through to the
  // normal dispatch below, unchanged) whenever there is no live ADD_CONTACT_DRAFT for this
  // phone+user — see routeAddContactDraft's own comment for the full set of escapes it handles.
  const draftResult = await routeAddContactDraft(ctx);
  if (draftResult) {
    return draftResult;
  }

  // A leading '/' is optional sugar over the same bare-word commands below ('/stock' and 'stock'
  // reach the identical handler) — stripped here, once, so COMMAND_HANDLERS never needs a second,
  // slash-prefixed copy of every key.
  const collapsed = ctx.rawBody.trim().replace(/\s+/g, ' ').replace(/^\//, '');
  const verb = (collapsed.split(' ')[0] || '').toUpperCase();

  if (verb === 'HELP') {
    return commandHelp(ctx);
  }

  if (!collapsed || collapsed === '?') {
    return commandMenu(ctx);
  }

  // hasOwnProperty, not a bare lookup: COMMAND_HANDLERS is a plain object, so a bare
  // COMMAND_HANDLERS[verb] also finds Object.prototype members and would call one as though it
  // were a handler. Uppercasing `verb` happens to make that unreachable today (no prototype
  // member is spelled in capitals), but that is an accident of casing, not a guard — this is the
  // guard. `verb` is attacker-controlled text off a public WhatsApp line.
  if (Object.prototype.hasOwnProperty.call(COMMAND_HANDLERS, verb)) {
    return COMMAND_HANDLERS[verb](ctx);
  }

  if (/^\d{1,2}$/.test(verb)) {
    return renderMenuPosition(ctx, Number(verb));
  }

  // Anything unmatched opens the menu instead of listing verbs to type
  // (docs/mockups/whatsapp-flow-spec.html section 11 "What to build, in order", step 4 "The
  // settings branch": "Unrecognised words open the menu instead of listing verbs" — bundled there
  // with this same plan's My reports/pause/stop/resume work). HELP above is unaffected — it
  // remains its own explicit branch and still shows the verb list.
  return commandMenu(ctx);
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
 * The join keyword — "reports" from an unenrolled number — and the daily/weekly/monthly follow-up
 * that lets that number choose what to receive. This is the WhatsApp-side half of "add a
 * recipient from the panel, and let one join by messaging the number": the panel's own banner
 * (WebPortal/modules/sales-reports/html/report_list.html) tells people to do exactly this.
 *
 * A DELIBERATE, NARROW exception to tryConfirmEnrolment's "total silence for an unenrolled
 * number" rule, immediately above — read that function's comment first. That silence exists
 * because replying to a wrong 6-digit GUESS would confirm this endpoint is live to a stranger who
 * may only be guessing. "reports" is not a guess at a secret: it is someone explicitly asking to
 * join a WhatsApp report list, in response to instructions the portal itself now gives. A future
 * reader must not "fix" this back to silence — the silence rule was never meant to cover it.
 *
 * A small, self-contained, LINEAR state machine — deliberately NOT folded into COMMAND_HANDLERS /
 * STAGED_COMMAND_HANDLERS below. There is no ambiguity here to stage a YES/NO confirmation for,
 * and this population can never reach that machinery anyway: CommandContext requires an
 * already-resolved userId/roleId, and this number is never resolved by
 * whatsapp_resolve_staff_user (report_recipients has no relationship to staff enrolment at all).
 *
 * is_staff: never touched here (contract 5). report_recipients.is_staff defaults to false
 * (migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:83), and neither
 * upsert_report_recipient nor set_report_subscription_by_phone ever writes it. Becoming staff is a
 * separate, portal-admin action (set_report_recipient_staff) or the existing WhatsApp staff
 * enrolment code flow (tryConfirmEnrolment, above) — out of scope here.
 *
 * Confirmed before writing this: report_daily_recipients()'s WHERE clause
 * (migrations/20260907130000_report_opt_out.sql:239-242) is `rr.is_active AND rs.is_active AND
 * rr.opted_out_at IS NULL AND (muted_until ...)` — no is_staff condition anywhere in it. A non-staff
 * recipient already receives reports today, so gating this join flow on staff enrolment would
 * wrongly exclude exactly the population (external report recipients who will never have a portal
 * login) this feature exists to serve.
 *
 * "Joining states intent, it does not choose" (contract 4): the upsert_report_recipient call below
 * never touches report_subscriptions — that function only ever writes report_recipients (see its
 * body). The new row is left with every subscription kind off until the person separately types
 * daily / weekly / monthly, each its own call to set_report_subscription_by_phone.
 *
 * Deviation from the brief's literal wording, recorded here because it is load-bearing: the brief
 * describes the create call as `upsert_report_recipient(display_name=null, ...)`, but
 * upsert_report_recipient itself rejects a null/blank display name (`IF v_name IS NULL THEN RETURN
 * QUERY SELECT 0, 'A display name is required.'` —
 * migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:219-222) — a null would
 * make every join silently fail with success=0. This follows the exact precedent
 * report_set_opt_out already set for the identical problem (migrations/20260907130000_report_opt_out.sql:128-131):
 * use the canonical phone number as a placeholder display name until the person is known by a real
 * name (e.g. once an admin edits them from the panel).
 *
 * Returns true when this message has been fully handled (whether or not a reply was sent) — the
 * caller must return immediately either way, exactly like tryConfirmEnrolment. Returns false only
 * for "not this flow", so the caller falls through to the existing silent not_enrolled logging.
 */
async function tryJoinReportsFlow(
  sb: SupabaseClient,
  from: string,
  wamid: string,
  rawBody: string,
  trimmedBody: string
): Promise<boolean> {
  const lower = trimmedBody.toLowerCase();

  // Step 2: "daily" / "weekly" / "monthly" — the follow-up choice after joining.
  //
  // Deliberately gated on report_recipient_by_inbound_phone returning found=true — i.e. this
  // number is ALREADY a known, active report_recipients row. Without that gate, any stranger who
  // happened to text the common English word "daily" for an unrelated reason would be silently
  // subscribed to a confidential report. The real join population always reaches this state via
  // "reports" (below) first, which is what creates that roster row — so this gate excludes nobody
  // this flow is meant to serve.
  if ((REPORT_KINDS as readonly string[]).includes(lower)) {
    const kind = lower as ReportKind;
    let lookup: Any;
    try {
      const { data, error } = await sb.rpc('report_recipient_by_inbound_phone', { p_phone: from });
      if (error) {
        if (isMissingRpc(error)) {
          console.error(
            '[whatsapp-inbound] report_recipient_by_inbound_phone is missing — migration 20260825090000 not applied.'
          );
        }
        throw error;
      }
      lookup = Array.isArray(data) ? data[0] : data;
    } catch (e) {
      console.error(`[whatsapp-inbound] join-flow lookup failed wamid=${wamid}:`, e);
      return false;
    }

    if (!lookup || lookup.found !== true) {
      // Not on the roster — silence, for the same reason tryConfirmEnrolment stays silent on a
      // wrong code: this may just be a stranger who typed a common word, and there is nothing here
      // worth confirming a bot is listening for.
      return false;
    }

    try {
      const { data, error } = await sb.rpc('set_report_subscription_by_phone', {
        p_phone: from,
        p_report_kind: kind,
        p_is_active: true,
        p_muted_until: null,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data;
      if (!result || result.ok !== true) {
        throw new Error(result?.error || 'set_report_subscription_by_phone returned ok=false');
      }
      await logCommand(sb, {
        phone: from,
        userId: null,
        wamid,
        rawBody,
        command: 'JOIN_REPORTS_CHOOSE',
        outcome: 'ok',
        detail: kind,
      });
      const reply =
        `You're now getting the ${REPORT_KIND_LABEL[kind]} report. Reply with another of daily, ` +
        `weekly or monthly any time to add it, or STOP to opt out of everything.`;
      const sent = await sendWhatsappText(from, reply);
      if (!sent) console.error(`[whatsapp-inbound] join-flow choose reply failed wamid=${wamid}`);
    } catch (e) {
      console.error(`[whatsapp-inbound] join-flow choose failed wamid=${wamid}:`, e);
      await logCommand(sb, {
        phone: from,
        userId: null,
        wamid,
        rawBody,
        command: 'JOIN_REPORTS_CHOOSE',
        outcome: 'error',
        detail: String(e),
      });
      const sent = await sendWhatsappText(from, 'I could not save that just now. Please try again shortly.');
      if (!sent) console.error(`[whatsapp-inbound] join-flow choose failure reply failed wamid=${wamid}`);
    }
    return true;
  }

  // Step 1: the join keyword itself — "reports", case-insensitive, alone or inside a short phrase.
  if (!/\breports\b/i.test(rawBody)) {
    return false;
  }

  let alreadyOnRoster = false;
  try {
    const { data, error } = await sb.rpc('report_recipient_by_inbound_phone', { p_phone: from });
    if (error) {
      if (isMissingRpc(error)) {
        console.error(
          '[whatsapp-inbound] report_recipient_by_inbound_phone is missing — migration 20260825090000 not applied.'
        );
      }
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    alreadyOnRoster = !!(row && row.found === true);
  } catch (e) {
    console.error(`[whatsapp-inbound] join-flow lookup failed wamid=${wamid}:`, e);
    await logCommand(sb, {
      phone: from,
      userId: null,
      wamid,
      rawBody,
      command: 'JOIN_REPORTS',
      outcome: 'error',
      detail: String(e),
    });
    const sent = await sendWhatsappText(from, 'I could not check that just now. Please try again shortly.');
    if (!sent) console.error(`[whatsapp-inbound] join-flow lookup failure reply failed wamid=${wamid}`);
    return true;
  }

  if (!alreadyOnRoster) {
    // create with EVERY subscription kind left off — see this function's comment above on
    // "joining states intent". source: 'whatsapp_chat' records how this row came to exist, exactly
    // as the CHECK constraint's other values (crm_contact, manual) already record other sources.
    try {
      const { data, error } = await sb.rpc('upsert_report_recipient', {
        p_display_name: toWaPhone(from),
        p_phone: from,
        p_source: 'whatsapp_chat',
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || Number(row.success) !== 1) {
        throw new Error(row?.error || 'upsert_report_recipient returned success=0');
      }
    } catch (e) {
      console.error(`[whatsapp-inbound] join-flow create failed wamid=${wamid}:`, e);
      await logCommand(sb, {
        phone: from,
        userId: null,
        wamid,
        rawBody,
        command: 'JOIN_REPORTS',
        outcome: 'error',
        detail: String(e),
      });
      const sent = await sendWhatsappText(from, 'I could not save that just now. Please try again shortly.');
      if (!sent) console.error(`[whatsapp-inbound] join-flow create failure reply failed wamid=${wamid}`);
      return true;
    }
  }

  await logCommand(sb, {
    phone: from,
    userId: null,
    wamid,
    rawBody,
    command: 'JOIN_REPORTS',
    outcome: 'ok',
    detail: alreadyOnRoster ? 'already on roster' : 'created',
  });
  const reply =
    "You're on the list for Macavation's reports. Reply daily, weekly or monthly to choose which " +
    "one(s) you'd like — you can pick more than one, any time.";
  const sent = await sendWhatsappText(from, reply);
  if (!sent) console.error(`[whatsapp-inbound] join-flow confirmation reply failed wamid=${wamid}`);
  return true;
}

/**
 * The pre-gate opt-out interceptor — STOP and START, honoured from ANY number, enrolled or not,
 * on the roster or not, mid-confirmation or not. Runs BEFORE whatsapp_resolve_staff_user, so it
 * cannot use CommandContext (that interface requires userId/roleId/displayName, which only exist
 * after resolution succeeds) — hence plain arguments here instead.
 *
 * Returns true when it has handled the message (and already sent a reply) — the caller must
 * return immediately without falling into the resolution/menu path. Returns false to fall through
 * to the existing behaviour UNCHANGED, which is what keeps START: commandMenu (COMMAND_HANDLERS,
 * below) working for everybody who is not opted out — this function must never reword or remove
 * that binding.
 *
 * A menu TAP (replyId set) is never handled here — that is a later plan's staged "Stop
 * everything" sheet, not this typed path.
 *
 * See migrations/20260907130000_report_opt_out.sql for report_set_opt_out /
 * report_opt_out_status and the schema facts (display_name NOT NULL; the is_active-filtered
 * resolution trap) they work around.
 */
async function handleOptOutVerbs(
  sb: SupabaseClient,
  from: string,
  wamid: string,
  rawBody: string,
  replyId: string | null
): Promise<boolean> {
  if (replyId) return false;

  const collapsed = rawBody.trim().replace(/\s+/g, ' ');
  const verb = (collapsed.split(' ')[0] || '').toUpperCase();

  if (verb === 'STOP') {
    // A typed STOP takes effect immediately, with no confirmation step — Meta requires opt-out to
    // be frictionless, and a person typing STOP has already decided. Reversal (START) is one word.
    try {
      const { data, error } = await sb.rpc('report_set_opt_out', { p_phone: from, p_opted_out: true });
      if (error) {
        if (isMissingRpc(error)) {
          console.error(
            '[whatsapp-inbound] report_set_opt_out is missing — migration 20260907130000 not applied.'
          );
        }
        throw error;
      }
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.ok !== true) {
        throw new Error(row?.error || 'report_set_opt_out returned ok=false');
      }
      await logCommand(sb, { phone: from, userId: null, wamid, rawBody, command: 'STOP', outcome: 'ok' });
      // Scoped to what this plan actually gates — reports — never "any further messages": alerts
      // and staff-menu replies are untouched by this plan and must not be promised silent by it.
      // Does not promise re-subscription: clearing opted_out_at does not create a subscription.
      const reply =
        'You will not receive any further report messages from Macavation. ' +
        'Text START if you want to allow them again.';
      const sent = await sendWhatsappText(from, reply);
      if (!sent) console.error(`[whatsapp-inbound] STOP confirmation reply failed wamid=${wamid}`);
    } catch (e) {
      console.error(`[whatsapp-inbound] STOP handling failed wamid=${wamid}:`, e);
      await logCommand(sb, {
        phone: from,
        userId: null,
        wamid,
        rawBody,
        command: 'STOP',
        outcome: 'error',
        detail: String(e),
      });
      // Never reply as though it succeeded.
      const sent = await sendWhatsappText(
        from,
        'I could not record that just now. Please reply STOP again shortly.'
      );
      if (!sent) console.error(`[whatsapp-inbound] STOP failure reply failed wamid=${wamid}`);
    }
    return true;
  }

  if (verb === 'START') {
    let status: Any;
    try {
      const { data, error } = await sb.rpc('report_opt_out_status', { p_phone: from });
      if (error) {
        if (isMissingRpc(error)) {
          console.error(
            '[whatsapp-inbound] report_opt_out_status is missing — migration 20260907130000 not applied.'
          );
          // Deliberate: fall through so the existing greeting keeps working when the opt-out read
          // is unavailable, rather than answering nothing.
          return false;
        }
        throw error;
      }
      status = Array.isArray(data) ? data[0] : data;
    } catch (e) {
      console.error(`[whatsapp-inbound] START opt-out check failed wamid=${wamid}:`, e);
      await logCommand(sb, {
        phone: from,
        userId: null,
        wamid,
        rawBody,
        command: 'START',
        outcome: 'error',
        detail: String(e),
      });
      return false;
    }

    if (!status || status.opted_out !== true) {
      // Not opted out (including found === false): fall through so START: commandMenu keeps its
      // existing meaning — this is what leaves the greeting intact for everybody else.
      return false;
    }

    try {
      const { data, error } = await sb.rpc('report_set_opt_out', { p_phone: from, p_opted_out: false });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row || row.ok !== true) {
        throw new Error(row?.error || 'report_set_opt_out returned ok=false');
      }
      await logCommand(sb, { phone: from, userId: null, wamid, rawBody, command: 'START', outcome: 'ok' });
      const reply =
        'Your opt-out has been removed. If somebody has you on a report list, those messages can resume.';
      const sent = await sendWhatsappText(from, reply);
      if (!sent) console.error(`[whatsapp-inbound] START confirmation reply failed wamid=${wamid}`);
    } catch (e) {
      console.error(`[whatsapp-inbound] START clear failed wamid=${wamid}:`, e);
      await logCommand(sb, {
        phone: from,
        userId: null,
        wamid,
        rawBody,
        command: 'START',
        outcome: 'error',
        detail: String(e),
      });
      const sent = await sendWhatsappText(
        from,
        'I could not record that just now. Please reply START again shortly.'
      );
      if (!sent) console.error(`[whatsapp-inbound] START failure reply failed wamid=${wamid}`);
    }
    return true;
  }

  return false;
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
  const type = String(msg?.type ?? '');

  let rawBody: string;
  let replyId: string | null = null;
  let flowResponse: Record<string, unknown> | null = null;

  if (type === 'text') {
    // Read straight from the message rather than through classifyMessage: that classifier treats
    // an empty text body as 'unsupported', and an empty body has always reached the dispatcher
    // here (handleCommand answers it). Routing text through it would silently drop that case.
    rawBody = String(msg?.text?.body ?? '');
  } else if (type === 'interactive' || type === 'button') {
    // A menu tap. classifyMessage owns the reply-id extraction for both shapes — a real
    // interactive list_reply/button_reply, and the type:'button' form Meta uses for a quick-reply
    // tap on an approved template. It returns the id, not the display title, which is the whole
    // point: see CommandContext.replyId.
    const classified = classifyMessage(msg, undefined);
    if (classified.kind === 'flow_reply') {
      // A submitted Flow form. Dispatched by handleAddContactFlowSubmit below, never as a verb or
      // a tap. The audit log gets a placeholder, never the form's name/phone/email fields.
      flowResponse = classified.response;
      rawBody = '[flow submission]';
    } else if (classified.kind === 'button_reply' || classified.kind === 'list_reply') {
      replyId = classified.replyId;
      // The audit log records the id that was dispatched on, not the label the member saw.
      rawBody = classified.replyId;
    } else {
      return;
    }
  } else if (type === 'contacts') {
    // A shared WhatsApp contact card — routed to the /contact draft as a PREFILL, not treated as
    // a verb. rawBody is the same placeholder bodyForMessage already used for the outer webhook
    // log (line ~170 above); the audit log below records that placeholder, never the card's own
    // (potentially sensitive) name/phone/email fields.
    rawBody = bodyForMessage(msg);
  } else {
    // Images, location, reactions and anything else already store a placeholder body via
    // bodyForMessage; never try to command off one.
    return;
  }

  try {
    // Checked before the enrolment gate and before any pending-command handling — the only thing
    // an unenrolled number may do besides send an enrolment code. See handleOptOutVerbs's own
    // comment for why this cannot use CommandContext.
    if (await handleOptOutVerbs(sb, from, wamid, rawBody, replyId)) {
      return;
    }

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
      // TEXT ONLY. A tap cannot be an enrolment code, and an unenrolled number has no menu to
      // have tapped in the first place — guarding on replyId keeps that impossible rather than
      // merely unlikely.
      const trimmedBody = rawBody.trim();
      if (!replyId && /^\d{6}$/.test(trimmedBody)) {
        await tryConfirmEnrolment(sb, from, wamid, rawBody, trimmedBody);
        return;
      }

      // Second, narrow exception to the silence rule: the WhatsApp report join flow. TEXT ONLY,
      // same reasoning as the enrolment-code check above — a menu tap cannot express "reports" or
      // "daily"/"weekly"/"monthly" as free text. See tryJoinReportsFlow's own comment for why this
      // one replies where tryConfirmEnrolment stays silent; do not "fix" this back to silence.
      if (!replyId && (await tryJoinReportsFlow(sb, from, wamid, rawBody, trimmedBody))) {
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
      replyId,
    };

    // A shared contact card never goes through handleCommand's tap/verb parsing — there is no
    // verb and no reply id, only card fields to offer as a prefill. extractSharedContact pulls
    // the raw fields; startAddContact re-validates every one of them (sanitisePrefill*) before
    // accepting any as a prefill, same as every other path into the draft.
    const result =
      type === 'contacts'
        ? await startAddContact(ctx, extractSharedContact(msg?.contacts?.[0]))
        : flowResponse
          ? await handleAddContactFlowSubmit(ctx, flowResponse)
          : await handleCommand(ctx);

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

        // --- delivery receipts for report_deliveries (migrations/20260910090000_report_delivery_receipts.sql) ---
        // Same statuses[] entry, a second write against a different table. Deliberately non-fatal
        // and never sets schemaMissing/breaks the outer loops: this table's receipts are a separate
        // feature from the shared inbox handled above, and a wamid belonging to a chat_messages row
        // (or to neither table) is expected here, not an error — report_record_delivery_status
        // itself returns success with updated:false for "no matching row", so reaching the error
        // branch below means a real RPC-level fault, not a routine no-match.
        const { error: reportStatusError } = await sb.rpc('report_record_delivery_status', {
          p_wamid: wamid,
          p_status: status,
        });

        if (reportStatusError) {
          if (isMissingRpc(reportStatusError)) {
            console.error(
              '[whatsapp-inbound] report_record_delivery_status is missing — migration 20260910090000 not applied.'
            );
          } else {
            console.error(
              `[whatsapp-inbound] report_record_delivery_status failed wamid=${wamid} status=${status}:`,
              reportStatusError.message
            );
          }
        }
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
