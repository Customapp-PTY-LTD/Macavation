/**
 * Supabase Edge Function: send a published Sales & Production report's PDF to selected
 * WhatsApp numbers via Control Room's meta-proxy.
 * Deploy: supabase functions deploy send-report-whatsapp
 *
 * Called by WebPortal/js/data-functions.js's `sendReportWhatsapp` wrapper
 * (WebPortal/js/data-functions.js:6263-6335) — that is the live, already-merged caller;
 * the request/response shape here matches what it posts and reads.
 *
 * Secrets: CONTROL_ROOM_FORWARD_SECRET, CONTROL_ROOM_CHANNEL_SLUG
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by the runtime)
 * Docs: https://control-room.customapp.co.za/docs/product-integration.md
 *
 * Auth: X-Portal-Session header, same convention as send-whatsapp-message and
 * portal-assistant — validated via the service-role RPC assistant_validate_session,
 * failing closed (empty result = 401, RPC error = 503). Without this, anyone holding the
 * public anon key (which ships in the browser) could post an arbitrary report/recipient
 * combination and have this function send it.
 *
 * Authorization: public.has_action(user_id, 'reports.report.send') — a second,
 * server-side gate on top of the session check. See the "why has_action is called
 * directly" note beside hasAction() below: this is a boolean-returning RPC and is
 * deliberately NOT routed through the array-normalising rpc() helper used for the
 * TABLE-returning RPCs elsewhere in this file.
 *
 * The three RPCs this function calls — begin_report_delivery, complete_report_delivery,
 * record_report_pdf_storage — are granted to service_role only
 * (migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql section 7);
 * this function is the only caller a browser can ever reach.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const CONTROL_ROOM_BASE_URL = 'https://ejnncypummmvyojhovme.supabase.co/functions/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-portal-session, X-Portal-Session',
};

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

// ============================================================================
// Validation — the exact allowlists a poisoned request could otherwise abuse.
//
// (?![\s\S]) is used instead of a trailing `$` throughout: `$` (without the `m` flag) is
// documented in some regex flavours as also matching immediately before a single trailing
// newline, which would let a value like "report.pdf\n" slip through as if the newline were
// not there. (?![\s\S]) is a true end-of-input assertion — nothing, not even a line
// terminator, may follow — so it composes safely into a storage object path regardless.
// ============================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i;
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.pdf(?![\s\S])/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}(?![\s\S])/;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const MIN_PDF_BYTES = 1024; // 1 KB
const MAX_PDF_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_RECIPIENTS = 25;
const LINK_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function hasPdfMagic(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function makeServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

/** Normalises a TABLE-returning RPC's result into a plain row array. */
async function rpc(sb: SupabaseClient, fn: string, params: Record<string, unknown> = {}): Promise<AnyRow[]> {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  if (Array.isArray(data)) return data as AnyRow[];
  if (data && typeof data === 'object') return [data as AnyRow];
  return [];
}

async function validateSession(
  sb: SupabaseClient,
  token: string
): Promise<{ userId: string } | { error: string; status: number }> {
  if (!token) return { error: 'Authentication required.', status: 401 };

  let rows: AnyRow[];
  try {
    rows = await rpc(sb, 'assistant_validate_session', { p_token: token });
  } catch (e) {
    console.error('[send-report-whatsapp] session validation RPC failed:', e);
    return { error: 'Authentication unavailable. Please try again.', status: 503 };
  }

  // assistant_validate_session returns (user_id, role_name, email)
  // (migrations/20260716160000_portal_assistant_chat.sql:271-274). Only user_id is needed
  // here — has_action takes a user id, not a role name, deliberately (see its own header
  // comment: a server-side gate keyed on role name is exactly the coupling that lets the
  // button layer and the API layer drift apart).
  const row = rows?.[0] ?? null;
  if (!row || !row.user_id) {
    return { error: 'Invalid or expired session. Please sign in again.', status: 401 };
  }

  return { userId: String(row.user_id) };
}

/**
 * Calls public.has_action directly via sb.rpc rather than through the rpc() helper above.
 * has_action returns a bare boolean, never an array or an object, so rpc()'s
 * Array.isArray/typeof-object branches would BOTH fall through to `return []` for it —
 * for a granted caller (data === true) and a denied caller (data === false) alike. Routing
 * a boolean gate through an array-normalising helper would make "granted" and "denied"
 * indistinguishable, and the natural "empty means denied" reading would lock everyone out.
 */
async function hasAction(
  sb: SupabaseClient,
  userId: string,
  actionKey: string
): Promise<{ allowed: true } | { allowed: false; status: number; error: string }> {
  const { data, error } = await sb.rpc('has_action', { p_user_id: userId, p_action_key: actionKey });
  if (error) {
    console.error('[send-report-whatsapp] has_action RPC failed:', error.message);
    return { allowed: false, status: 503, error: 'Authorization check unavailable. Please try again.' };
  }
  if (data !== true) {
    return { allowed: false, status: 403, error: 'You do not have permission to send reports.' };
  }
  return { allowed: true };
}

// Character-for-character the same algorithm as send-whatsapp-message/index.ts:65-70 and
// send-daily-digest-whatsapp/index.ts:42-47 — a deliberate, documented duplication (see
// migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql section 1). This
// is used only to shape the outbound `to` field for the meta-proxy call; the phone actually
// persisted is whatever begin_report_delivery normalises server-side via
// public.report_normalize_wa_phone, which is the canonical implementation.
function normalizePhone(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '27' + p.slice(1);
  if (!p.startsWith('27') && p.length <= 11) p = '27' + p;
  return `+${p}`;
}

async function signBody(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds the WhatsApp message text server-side from the database payload — modelled on
 * formatWhatsAppText in send-daily-digest-whatsapp/index.ts:18-40 (plain lines, em-dash for
 * a missing value, no Markdown). The browser supplies no text: the caller must never be
 * able to choose what words go to an arbitrary phone number under this portal's name.
 */
function buildMessageText(payload: Record<string, unknown>, signedUrl: string): string {
  const periodLabel = typeof payload.period_label === 'string' && payload.period_label ? payload.period_label : '—';
  const publishedAt =
    typeof payload.published_at === 'string' && payload.published_at ? payload.published_at.slice(0, 10) : '—';
  const rawSummary = typeof payload.executive_summary === 'string' ? payload.executive_summary : '';
  const summary = rawSummary.replace(/\s+/g, ' ').trim();
  const truncatedSummary = summary.length > 400 ? summary.slice(0, 400) + '…' : summary;

  const lines = [`Macavation — ${periodLabel} Sales & Production report`, `Published ${publishedAt}`, ''];

  // Omit the summary block AND its blank line when the summary is empty, rather than
  // sending a gap.
  if (truncatedSummary) {
    lines.push(truncatedSummary, '');
  }

  lines.push('Full report (PDF, link valid 30 days):', signedUrl);

  return lines.join('\n');
}

type RecipientResult = {
  phone: string;
  display_name: string | null;
  status: 'sent' | 'failed';
  external_message_id: string | null;
  error: string | null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const sb = makeServiceClient();

  // ---- 1. Session ----------------------------------------------------------------------
  const sessionToken = (req.headers.get('x-portal-session') || '').trim();
  const sessionOrErr = await validateSession(sb, sessionToken);
  if ('error' in sessionOrErr) {
    return jsonResponse(sessionOrErr.status, { success: false, error: sessionOrErr.error });
  }
  const userId = sessionOrErr.userId;

  // ---- 2. Authorization ------------------------------------------------------------------
  const actionCheck = await hasAction(sb, userId, 'reports.report.send');
  if (!actionCheck.allowed) {
    return jsonResponse(actionCheck.status, { success: false, error: actionCheck.error });
  }

  // ---- 3. Control Room secrets -----------------------------------------------------------
  const forwardSecret = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET');
  const channelSlug = Deno.env.get('CONTROL_ROOM_CHANNEL_SLUG');
  if (!forwardSecret || !channelSlug) {
    return jsonResponse(503, {
      success: false,
      error: 'WhatsApp not yet connected — CONTROL_ROOM_FORWARD_SECRET and CONTROL_ROOM_CHANNEL_SLUG required',
    });
  }

  // ---- 4. Parse + validate the body, before touching storage -----------------------------
  let body: AnyRow;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(400, { success: false, error: 'Request body must be JSON.' });
  }

  const reportInstanceId = typeof body.report_instance_id === 'string' ? body.report_instance_id.trim() : '';
  const pdfBase64 = typeof body.pdf_base64 === 'string' ? body.pdf_base64 : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const recipients = Array.isArray(body.recipients) ? body.recipients : null;

  if (!UUID_RE.test(reportInstanceId)) {
    return jsonResponse(400, { success: false, error: 'report_instance_id must be a valid UUID.' });
  }

  if (!recipients || recipients.length === 0) {
    return jsonResponse(400, { success: false, error: 'recipients must be a non-empty array.' });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return jsonResponse(400, { success: false, error: `recipients must not exceed ${MAX_RECIPIENTS} entries.` });
  }
  for (const r of recipients) {
    if (!r || typeof r !== 'object' || typeof r.phone !== 'string' || !r.phone.trim()) {
      return jsonResponse(400, { success: false, error: 'Every recipient must have a non-empty phone.' });
    }
  }

  if (!FILENAME_RE.test(filename)) {
    return jsonResponse(400, {
      success: false,
      error: 'filename must be a plain "*.pdf" name with no path separators or control characters.',
    });
  }

  if (!BASE64_RE.test(pdfBase64)) {
    return jsonResponse(400, {
      success: false,
      error: 'pdf_base64 must be plain base64 with no "data:" prefix and no trailing characters.',
    });
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
  } catch {
    return jsonResponse(400, { success: false, error: 'pdf_base64 could not be decoded.' });
  }

  if (pdfBytes.length < MIN_PDF_BYTES || pdfBytes.length > MAX_PDF_BYTES) {
    return jsonResponse(400, {
      success: false,
      error: `Decoded PDF must be between ${MIN_PDF_BYTES} bytes and ${MAX_PDF_BYTES} bytes.`,
    });
  }

  // The bucket's allowed_mime_types trusts a declared content type; this checks the actual
  // bytes, since the request's declared type is not verifiable from here.
  if (!hasPdfMagic(pdfBytes)) {
    return jsonResponse(400, { success: false, error: 'Decoded content is not a PDF (missing %PDF- header).' });
  }

  // ---- 5. Load the report and enforce the publish gate -----------------------------------
  let reportPayload: AnyRow | null;
  try {
    const { data, error } = await sb.rpc('get_report_instance', { p_report_instance_id: reportInstanceId });
    if (error) throw new Error(error.message);
    // get_report_instance returns jsonb directly (NULL when the id does not exist) — this is
    // NOT a TABLE-returning RPC, so it is called directly rather than through rpc() above.
    reportPayload = (data as AnyRow) ?? null;
  } catch (e) {
    console.error('[send-report-whatsapp] get_report_instance failed:', e);
    return jsonResponse(503, { success: false, error: 'Could not load the report. Please try again.' });
  }

  if (!reportPayload) {
    return jsonResponse(404, { success: false, error: 'Report not found.' });
  }

  if (reportPayload.status !== 'published') {
    // A draft must never leave the building: the PDF builder watermarks a draft but nothing
    // else stops it being sent, and once a number has it there is no recall.
    return jsonResponse(409, { success: false, error: 'Only a published report can be sent.' });
  }

  // ---- 6. Upload the PDF once, content-addressed ------------------------------------------
  const sha256 = await sha256Hex(pdfBytes);
  const objectPath = `${reportInstanceId}/${sha256.slice(0, 12)}-${filename}`;

  // sb.storage's upload()/createSignedUrl() contract is not otherwise exercised anywhere in
  // this checkout (migrations/20260822090100_report_pdf_storage_bucket.sql — this is the
  // first use of Supabase Storage in this project). Followed here per the library's
  // documented API, not an in-repo precedent; both results are checked explicitly rather
  // than assumed to succeed.
  const { error: uploadError } = await sb.storage
    .from('report-pdfs')
    .upload(objectPath, pdfBytes, { contentType: 'application/pdf', upsert: true });

  if (uploadError) {
    console.error('[send-report-whatsapp] storage upload failed for', objectPath, uploadError.message);
    return jsonResponse(502, { success: false, error: 'Failed to store the report PDF.' });
  }

  // ---- 7. Record provenance — logged, non-fatal -------------------------------------------
  try {
    const { error: recordError } = await sb.rpc('record_report_pdf_storage', {
      p_report_instance_id: reportInstanceId,
      p_bucket: 'report-pdfs',
      p_path: objectPath,
      p_sha256: sha256,
    });
    if (recordError) {
      console.error('[send-report-whatsapp] record_report_pdf_storage failed (non-fatal):', recordError.message);
    }
  } catch (e) {
    console.error('[send-report-whatsapp] record_report_pdf_storage threw (non-fatal):', e);
  }

  // ---- 8. Signed URL -----------------------------------------------------------------------
  const { data: signedData, error: signedError } = await sb.storage
    .from('report-pdfs')
    .createSignedUrl(objectPath, LINK_TTL_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    console.error('[send-report-whatsapp] createSignedUrl failed for', objectPath, signedError?.message);
    return jsonResponse(502, { success: false, error: 'Failed to create a delivery link for the report PDF.' });
  }
  const signedUrl = signedData.signedUrl;
  const linkExpiresAt = new Date(Date.now() + LINK_TTL_SECONDS * 1000).toISOString();

  // ---- 9. Message text, built server-side --------------------------------------------------
  const messageText = buildMessageText(reportPayload, signedUrl);

  // ---- 10. Per-recipient send, in sequence -------------------------------------------------
  // Not Promise.all: a partial failure must leave a coherent log, and the recipient cap
  // above keeps a sequential loop fast enough.
  const results: RecipientResult[] = [];
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const phone = String(recipient.phone).trim();
    const displayName =
      recipient.display_name != null && String(recipient.display_name).trim()
        ? String(recipient.display_name).trim()
        : null;
    const recipientId =
      recipient.recipient_id != null && String(recipient.recipient_id).trim()
        ? String(recipient.recipient_id).trim()
        : null;

    try {
      const beginRows = await rpc(sb, 'begin_report_delivery', {
        p_report_instance_id: reportInstanceId,
        p_phone: phone,
        p_display_name: displayName,
        p_recipient_id: recipientId,
        // The message body — which contains the signed URL — IS persisted into
        // report_deliveries.message_body for as long as the row lives. That table is
        // REVOKE'd from PUBLIC, anon, authenticated and granted to service_role only
        // (migration section 3), so it is no more exposed than the report itself, and
        // knowing exactly what text went to a number is the point of an audit log. This is
        // not in tension with "never log the signed URL" below — a persisted, access-
        // controlled audit row is not a log line.
        p_message_body: messageText,
        p_pdf_storage_bucket: 'report-pdfs',
        p_pdf_storage_path: objectPath,
        p_link_expires_at: linkExpiresAt,
        p_actor_user_id: userId,
      });
      const beginRow = beginRows[0];

      if (!beginRow || beginRow.success !== 1) {
        // begin_report_delivery rejected this recipient (bad phone, report vanished mid-
        // request) — skip the send entirely. An unlogged send is exactly what the two-step
        // log exists to prevent.
        results.push({
          phone,
          display_name: displayName,
          status: 'failed',
          external_message_id: null,
          error: beginRow?.error || 'Could not start delivery.',
        });
        failed++;
        continue;
      }

      const deliveryId = beginRow.id;

      let sendOk: boolean;
      let wamid: string | null = null;
      let sendError: string | null = null;

      try {
        const requestBody = JSON.stringify({
          action: 'send_message',
          channelSlug,
          to: normalizePhone(phone),
          type: 'text',
          content: { text: messageText },
        });

        const res = await fetch(`${CONTROL_ROOM_BASE_URL}/meta-proxy`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Control-Room-Signature': await signBody(forwardSecret, requestBody),
          },
          body: requestBody,
        });

        const gatewayResult = await res.json();
        if (!res.ok || !gatewayResult.ok) {
          sendOk = false;
          // The gateway's own message is passed through verbatim — a send can fail for
          // reasons this checkout cannot anticipate (falling outside Meta's 24-hour
          // customer-service window being the likeliest), and nothing here has ever seen
          // that rejection payload, so it is not parsed or classified.
          sendError = String(gatewayResult.error || res.statusText || 'Send failed.');
        } else {
          sendOk = true;
          wamid = gatewayResult.wamid || null;
        }
      } catch (e) {
        sendOk = false;
        sendError = String((e as Error)?.message || e);
      }

      if (sendOk) {
        try {
          await rpc(sb, 'complete_report_delivery', {
            p_delivery_id: deliveryId,
            p_status: 'sent',
            p_external_message_id: wamid,
            p_error: null,
          });
        } catch (e) {
          console.error('[send-report-whatsapp] complete_report_delivery (sent) failed:', e);
        }
        results.push({ phone, display_name: displayName, status: 'sent', external_message_id: wamid, error: null });
        sent++;
      } else {
        try {
          await rpc(sb, 'complete_report_delivery', {
            p_delivery_id: deliveryId,
            p_status: 'failed',
            p_external_message_id: null,
            p_error: sendError,
          });
        } catch (e) {
          console.error('[send-report-whatsapp] complete_report_delivery (failed) failed:', e);
        }
        results.push({
          phone,
          display_name: displayName,
          status: 'failed',
          external_message_id: null,
          error: sendError,
        });
        failed++;
      }
    } catch (loopErr) {
      // One recipient's failure must never abort the loop.
      console.error('[send-report-whatsapp] unexpected error for recipient', phone, loopErr);
      results.push({
        phone,
        display_name: displayName,
        status: 'failed',
        external_message_id: null,
        error: String((loopErr as Error)?.message || loopErr),
      });
      failed++;
    }
  }

  // ---- 11. Respond --------------------------------------------------------------------------
  // 200 even when every send failed: the request itself succeeded, and the per-recipient
  // detail is in `results`. Never includes the signed URL or any service-role material —
  // the browser has no use for either, and the signed URL is a bearer credential for a
  // confidential document.
  return jsonResponse(200, {
    success: true,
    sent,
    failed,
    pdf_storage_path: objectPath,
    link_expires_at: linkExpiresAt,
    results,
  });
});
