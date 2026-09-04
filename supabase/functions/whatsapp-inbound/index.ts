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
import { buildReplyId, parseReplyId, sendList, toWaPhone } from '../_shared/wa-send.ts';
import { MAX_LIST_ROWS } from '../_shared/wa-limits.ts';
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
// EVERY ITEM IS READ-ONLY. Each renders from get_daily_digest(), the same RPC the 17:00 digest
// sends (send-daily-digest-whatsapp/index.ts:82). Nothing here writes, so nothing here needs the
// YES/NO staging flow; a future write command still stages via whatsapp_stage_pending_command
// exactly as before and is unaffected by this menu.
//
// GATED ON THE SAME FEATURE KEYS AS THE PORTAL SIDEBAR. `feature` is a public.features.key, read
// per role via get_role_features_for_role — the same mechanism menuFilter uses in the browser. So
// a role sees on WhatsApp exactly the areas it can already open in the portal, and there is no
// second, drifting permission model to maintain. A role with none of these features enabled gets
// told so rather than shown an empty list.
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
  /** public.features.key that must be 'true' for this role. */
  feature: string;
  /**
   * Renders from the shared get_daily_digest() payload. Exactly one of `render` or `resolve` must
   * be set. `canAct` is the result of the item's own `needsAction` check (false when it declares
   * none) — passed in rather than looked up here so `render` stays synchronous and pure.
   */
  render?: (digest: Any, canAct?: boolean) => string;
  /**
   * For an item whose answer depends on WHO is asking rather than on the shared digest. The digest
   * is never fetched for a `resolve` item, so a broken digest cannot make this item report a
   * failure that has nothing to do with it.
   */
  resolve?: (ctx: CommandContext) => Promise<string>;
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
      return (
        `*Stock & runway*\n\n` +
        `Kernel on hand: ${num(ext.kernel_soh_kg, 2)} kg\n` +
        `Oil finished: ${num(ext.oil_finished_soh_kg, 2)} kg\n` +
        `Oil raw material: ${num(ext.oil_rm_soh_kg, 2)} kg\n` +
        `Weekly demand: ${num(runway.weekly_demand_kg, 2)} kg\n` +
        `Cover: ${weeks == null ? 'not calculable — no demand recorded' : `${num(weeks, 1)} weeks`}`
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
];

/**
 * Feature keys enabled for this role, as public.features.key strings.
 *
 * Returns an EMPTY SET on any failure — a missing RPC, an error, a role with nothing enabled. The
 * caller then shows no items and says so. Failing to an empty menu rather than a full one is
 * deliberate: an unreadable permission table must never widen what somebody can read over
 * WhatsApp.
 */
async function loadFeatureKeys(sb: SupabaseClient, roleId: string | null): Promise<Set<string>> {
  if (!roleId) return new Set();
  try {
    const { data, error } = await sb.rpc('get_role_features_for_role', { p_role_id: roleId });
    if (error) {
      if (isMissingRpc(error)) {
        console.error('[whatsapp-inbound] get_role_features_for_role is missing — cannot build the menu.');
      } else {
        console.error('[whatsapp-inbound] get_role_features_for_role failed:', error.message);
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
    console.error('[whatsapp-inbound] get_role_features_for_role threw:', e);
    return new Set();
  }
}

/** The items this role may see, in MENU_ITEMS order. Position in THIS array is the typed number. */
function visibleItems(featureKeys: Set<string>): MenuItem[] {
  // MAX_LIST_ROWS is Meta's cap for one list and buildListBody throws above it. MENU_ITEMS is
  // well under it today; the slice means adding a seventh, eighth… item can never turn a menu
  // send into a thrown error for a role that happens to have everything enabled.
  return MENU_ITEMS.filter((i) => featureKeys.has(i.feature)).slice(0, MAX_LIST_ROWS);
}

const MENU_NS = 'menu';

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

/**
 * Sends the main menu as an interactive list, falling back to numbered text if the list send is
 * rejected.
 *
 * Returns `reply: null` in the success case BECAUSE IT HAS ALREADY SENT: processCommandForMessage
 * only sends `result.reply` when it is non-null, so a handler that sends its own interactive
 * message must return null or the member would receive the menu twice. The fallback path returns
 * text and lets the caller send it in the usual way.
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
  const item = visibleItems(featureKeys).find((i) => i.action === action);

  if (!item) {
    return {
      outcome: 'denied',
      reply:
        `Sorry ${ctx.displayName}, that option is not available to you. Reply 99 for the menu.`,
      command: `MENU:${action.toUpperCase()}`,
      detail: 'action not in role visible set',
    };
  }

  // A `resolve` item answers from its own per-user source. The digest is NOT fetched for it — a
  // broken digest must not make "latest report" reply "could not read the figures", which is a
  // different feature failing.
  if (item.resolve) {
    try {
      return {
        outcome: 'ok',
        reply: `${await item.resolve(ctx)}\n\nReply 99 for the menu.`,
        command: `MENU:${action.toUpperCase()}`,
      };
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

  return {
    outcome: 'ok',
    reply: `${item.render!(digest, canAct)}\n\nReply 99 for the menu.`,
    command: `MENU:${action.toUpperCase()}`,
  };
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

const HELP_COMMAND_LIST =
  'MENU (or 99) — show the menu of reports\n' +
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
 * ACK <n> — stage the acknowledgement of the nth open alert, awaiting YES.
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
 */
async function commandAck(ctx: CommandContext): Promise<CommandResult> {
  const parts = ctx.rawBody.trim().replace(/\s+/g, ' ').split(' ');
  const raw = parts[1] ?? '';
  const n = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;

  if (!Number.isInteger(n) || n < 1 || n > ALERT_LIST_MAX) {
    return {
      outcome: 'unknown_command',
      reply:
        `Reply ACK followed by the number of the alert, for example ACK 2. ` +
        `Reply 99 for the menu to see the list again.`,
      command: 'ACK',
    };
  }

  if (!(await hasAction(ctx.sb, ctx.userId, 'alerts.resolve'))) {
    return {
      outcome: 'denied',
      reply: `Sorry ${ctx.displayName}, closing alerts is not on your access. Speak to an administrator if you need it.`,
      command: 'ACK',
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
      command: 'ACK',
      detail: String(e),
    };
  }

  const chosen = alerts[n - 1];
  const alertId = chosen?.id ? String(chosen.id) : '';
  if (!alertId) {
    return {
      outcome: 'ok',
      reply: `There is no alert ${n} open right now, ${ctx.displayName}. Reply 99 for the menu to see the current list.`,
      command: 'ACK',
    };
  }

  const title = String(chosen?.title ?? 'Untitled');
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
        command: 'ACK',
        detail: error.message,
      };
    }
  } catch (e) {
    console.error('[whatsapp-inbound] whatsapp_stage_pending_command threw:', e);
    return {
      outcome: 'error',
      reply: `Sorry ${ctx.displayName}, I could not set that up just now. Please try again shortly.`,
      command: 'ACK',
      detail: String(e),
    };
  }

  return {
    outcome: 'ok',
    reply: `${summary}?\n\nReply YES to confirm, or NO to cancel.`,
    command: 'ACK',
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
  // through renderMenuItem, so the role's CURRENT feature set is re-checked exactly as for a tap.
  REPORT: (ctx) => renderMenuItem(ctx, 'report'),
  // ACK <n> — stages an alert acknowledgement, applied by YES.
  ACK: commandAck,
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
 */
async function handleCommand(ctx: CommandContext): Promise<CommandResult> {
  if (ctx.replyId) {
    const parsed = parseReplyId(ctx.replyId);
    if (parsed && parsed.ns === MENU_NS) {
      return renderMenuItem(ctx, parsed.action);
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

  const collapsed = ctx.rawBody.trim().replace(/\s+/g, ' ');
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

  const reply =
    `Sorry ${ctx.displayName}, I did not recognise "${verb}".\n\n` +
    `Here is what I can do right now:\n\n${HELP_COMMAND_LIST}\n\n` +
    `More commands are coming. Text HELP any time to see the current list.`;
  return { outcome: 'unknown_command', reply, command: verb || null };
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
  const type = String(msg?.type ?? '');

  let rawBody: string;
  let replyId: string | null = null;

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
    if (classified.kind !== 'button_reply' && classified.kind !== 'list_reply') {
      return;
    }
    replyId = classified.replyId;
    // The audit log records the id that was dispatched on, not the label the member saw.
    rawBody = classified.replyId;
  } else {
    // Images, location, reactions and anything else already store a placeholder body via
    // bodyForMessage; never try to command off one.
    return;
  }

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
      // TEXT ONLY. A tap cannot be an enrolment code, and an unenrolled number has no menu to
      // have tapped in the first place — guarding on replyId keeps that impossible rather than
      // merely unlikely.
      const trimmedBody = rawBody.trim();
      if (!replyId && /^\d{6}$/.test(trimmedBody)) {
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
      replyId,
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
