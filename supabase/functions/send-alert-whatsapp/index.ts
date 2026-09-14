/**
 * Supabase Edge Function: push ONE dashboard alert to the WhatsApp recipients who asked for it,
 * via the approved template `macavation_alert`. Called by
 * public.cron_push_dashboard_alerts() (migrations/20260910100000_alert_whatsapp_push.sql), which
 * polls every 5 minutes and posts one request per still-open, cap-eligible alert — see that
 * migration's header for why this is a poll rather than a trigger on dashboard_alerts.
 *
 * Deploy: supabase functions deploy send-alert-whatsapp --project-ref nmdmddugxclpqrwylyfa
 *
 * Auth gate — modelled exactly on send-daily-production-report/index.ts:9-19. The request's
 * `Authorization: Bearer <token>` is compared, in constant time, against
 * SUPABASE_SERVICE_ROLE_KEY. An empty header or an empty env var is ALWAYS treated as a
 * non-match, never as a match (timingSafeEqual('','') would otherwise be true). This runs before
 * any body parsing, any RPC, and any send.
 *
 * RPCs called:
 *   - get_dashboard_alert_for_push(p_alert_id) -> jsonb (single object). Read directly, no
 *     envelope, no rows[0] — same convention as get_daily_production_report
 *     (send-daily-production-report/index.ts:27-28).
 *   - alert_push_recipients(p_alert_id) -> TABLE(recipient_id, phone, display_name). Plain row
 *     array, no success/error columns — already applies the severity floor, the opt-out gate, the
 *     per-(alert,recipient) dedupe and the per-recipient daily cap (see the migration).
 *
 * Env vars read: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided by the runtime),
 * plus CONTROL_ROOM_BASE_URL / _FORWARD_SECRET / _CHANNEL_SLUG, read inside
 * ../_shared/wa-send.ts, not here.
 *
 * Sends via sendTemplate from ../_shared/wa-send.ts, one recipient at a time, sequentially — never
 * a hand-built Control Room payload. An approved template is the only send that can reach a
 * recipient who has not messaged in the last 24 hours, which is the normal case for an unprompted
 * alert push.
 *
 * The "Mark resolved" button's dynamic payload. The template is approved with two quick-reply
 * buttons (scripts/wa-template-alert-push.mjs): "Mark resolved" (index 0) and "Menu" (index 1).
 * "Menu" needs no per-send override — it dispatches through the SAME TEMPLATE_BUTTON_ROUTES.menu
 * entry the daily/period report templates' own "Menu" button already uses
 * (whatsapp-inbound/index.ts). "Mark resolved" DOES need a per-alert override: Meta's dynamic
 * quick-reply-button parameter is `{ type: 'payload', payload: '<string>' }`, distinct from the
 * `{ type: 'text', text: '<string>' }` shape ../_shared/wa-send.ts's WaTemplateComponent type
 * models today (that type has only ever needed to carry a url-button's dynamic suffix so far — see
 * its own header). Rather than widen that shared, byte-for-byte-literal-checked type (wa-plumbing:
 * verify asserts wa-send.ts's exported functions verbatim; widening the type risks nothing there,
 * but there is no need to touch a file another verifier scrutinises this closely for one local
 * button), the payload component is built as a plain object and cast through WaTemplateComponent
 * here. buildTemplateBody (wa-send.ts) only ever assigns `content.components = components`
 * verbatim — the cast has no runtime effect, only a compile-time one.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { buildReplyId, sendTemplate, type WaTemplateComponent } from '../_shared/wa-send.ts';
import { timingSafeEqual } from '../_shared/wa-inbound.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

const TEMPLATE_NAME = 'macavation_alert';
const MAX_RECIPIENTS = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALERT_REPLY_NS = 'alert';
const ALERT_REPLY_ACK_ACTION = 'ack';

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

/**
 * Normalises a TABLE-returning RPC's result into a plain row array. For alert_push_recipients
 * ONLY — get_dashboard_alert_for_push is a bare jsonb object and must be read directly (see the
 * header): routing it through this would collapse a real single-object result the same way a bare
 * boolean would, per send-daily-production-report/index.ts:73-78's own rpcRows warning.
 */
async function rpcRows(sb: SupabaseClient, fn: string, params: Record<string, unknown> = {}): Promise<AnyRow[]> {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  if (Array.isArray(data)) return data as AnyRow[];
  if (data && typeof data === 'object') return [data as AnyRow];
  return [];
}

/** Same rule as send-daily-production-report/index.ts:114-116 — see there for why. */
function sanitizeParam(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Builds the three sanitised template body parameters, in the fixed order
 * scripts/wa-template-alert-push.mjs's body was approved with: {{1}} severity label, {{2}} alert
 * title, {{3}} a one-line detail from alert_message.
 */
function buildAlertTemplateParams(alert: AnyRow): string[] {
  const severityLabel = alert.severity === 'critical' ? 'Critical' : 'Warning';
  const title =
    typeof alert.alert_title === 'string' && alert.alert_title.trim()
      ? alert.alert_title.trim()
      : 'Untitled alert';
  const detail =
    typeof alert.alert_message === 'string' && alert.alert_message.trim()
      ? alert.alert_message.trim()
      : 'No further detail captured.';
  return [severityLabel, title, detail].map(sanitizeParam);
}

/**
 * The first 24 lowercase-hex characters of the alert id with its dashes stripped — see the
 * migration's "WHY A REPLY-ID CANNOT CARRY THE RAW ALERT ID" for why a raw uuid cannot be a
 * buildReplyId arg segment (REPLY_SEGMENT_RE caps every segment at 24 characters) and why a
 * 24-character hex prefix is resolved back to one alert by resolve_dashboard_alert_by_ref.
 */
function alertReplyRef(alertId: string): string {
  return alertId.replace(/-/g, '').toLowerCase().slice(0, 24);
}

type RecipientResult = {
  phone: string | null;
  display_name: string | null;
  status: 'sent' | 'failed';
  external_message_id: string | null;
  error: string | null;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse(405, { success: false, error: 'Method not allowed.' });
  }

  // ---- Auth gate — before any body parsing, any RPC, any send -----------------------------
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const expected = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();
  if (!provided || !expected || !timingSafeEqual(provided, expected)) {
    return jsonResponse(401, { success: false, error: 'Service key required.' });
  }

  const sb = makeServiceClient();

  // ---- Parse the body -----------------------------------------------------------------------
  let body: AnyRow = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return jsonResponse(400, { success: false, error: 'Request body must be JSON.' });
  }

  const alertId = typeof body?.alert_id === 'string' ? body.alert_id.trim() : '';
  if (!alertId || !UUID_RE.test(alertId)) {
    return jsonResponse(400, { success: false, error: 'alert_id must be a uuid.' });
  }

  // ---- 1. Load the alert ----------------------------------------------------------------------
  const { data: alertData, error: alertError } = await sb.rpc('get_dashboard_alert_for_push', {
    p_alert_id: alertId,
  });
  if (alertError) {
    console.error('[send-alert-whatsapp] get_dashboard_alert_for_push failed:', alertError.message);
    return jsonResponse(502, { success: false, error: 'Could not load the alert.' });
  }
  const alert = (alertData ?? {}) as AnyRow;

  // ---- 2. Suppress guard — an alert that is no longer active is not this run's job ------------
  if (!alert || alert.status !== 'active') {
    return jsonResponse(200, { skipped: 'alert_not_active', alert_id: alertId });
  }

  // ---- 3. Recipients — already severity-floor / opt-out / dedupe / cap filtered ----------------
  let recipients: AnyRow[];
  try {
    recipients = await rpcRows(sb, 'alert_push_recipients', { p_alert_id: alertId });
  } catch (e) {
    console.error('[send-alert-whatsapp] alert_push_recipients threw:', e);
    return jsonResponse(502, { success: false, error: 'Could not load the alert recipient list.' });
  }
  if (recipients.length === 0) {
    return jsonResponse(200, { skipped: 'no_recipients', alert_id: alertId });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    console.warn(
      `[send-alert-whatsapp] dropping ${recipients.length - MAX_RECIPIENTS} recipient(s) beyond the ${MAX_RECIPIENTS} cap.`
    );
    recipients = recipients.slice(0, MAX_RECIPIENTS);
  }

  // ---- 4. Compose the body params + the per-alert button payload once --------------------------
  const params = buildAlertTemplateParams(alert);
  const bodyComponent: WaTemplateComponent = {
    type: 'body',
    parameters: params.map((text) => ({ type: 'text' as const, text })),
  };

  const replyId = buildReplyId(ALERT_REPLY_NS, ALERT_REPLY_ACK_ACTION, alertReplyRef(alertId));
  // Meta's dynamic quick-reply payload parameter is `{ type: 'payload', payload }`, not
  // `{ type: 'text', text }` — see the file header for why this is cast rather than modelled
  // directly in WaTemplateComponent's shared type.
  const markResolvedButtonComponent = {
    type: 'button',
    sub_type: 'quick_reply',
    index: 0,
    parameters: [{ type: 'payload', payload: replyId }],
  } as unknown as WaTemplateComponent;

  const components: WaTemplateComponent[] = [bodyComponent, markResolvedButtonComponent];

  // ---- 5. Send, one recipient at a time, sequentially ------------------------------------------
  const results: RecipientResult[] = [];
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    const phone = typeof recipient.phone === 'string' ? recipient.phone : null;
    const displayName =
      recipient.display_name != null && String(recipient.display_name).trim()
        ? String(recipient.display_name).trim()
        : null;

    try {
      if (!phone || !phone.trim()) {
        results.push({
          phone: null,
          display_name: displayName,
          status: 'failed',
          external_message_id: null,
          error: 'Recipient has no usable phone number.',
        });
        failed++;
        continue;
      }

      const result = await sendTemplate(phone, TEMPLATE_NAME, 'en', components);

      if (result.ok) {
        // Record the send — non-fatal on failure, matching complete_report_delivery's own
        // non-fatal handling in send-daily-production-report/index.ts:350-367: a failed audit
        // write must not abort the loop or flip the send's own outcome.
        try {
          const { error: insertError } = await sb.from('dashboard_alert_wa_pushes').insert({
            alert_id: alertId,
            recipient_id: recipient.recipient_id,
            external_message_id: result.wamid,
          });
          if (insertError) {
            console.warn(
              '[send-alert-whatsapp] dashboard_alert_wa_pushes insert failed (non-fatal):',
              insertError.message
            );
          }
        } catch (e) {
          console.error('[send-alert-whatsapp] dashboard_alert_wa_pushes insert threw (non-fatal):', e);
        }
      }

      results.push({
        phone,
        display_name: displayName,
        status: result.ok ? 'sent' : 'failed',
        external_message_id: result.wamid,
        error: result.error,
      });
      if (result.ok) {
        sent++;
      } else {
        failed++;
      }
    } catch (loopErr) {
      // One recipient's failure must never abort the loop.
      console.error('[send-alert-whatsapp] unexpected error for recipient', phone, loopErr);
      results.push({
        phone: phone || null,
        display_name: displayName,
        status: 'failed',
        external_message_id: null,
        error: String((loopErr as Error)?.message || loopErr),
      });
      failed++;
    }
  }

  // ---- 6. Respond — 200 even when every send failed --------------------------------------------
  return jsonResponse(200, { alert_id: alertId, sent, failed, results });
});
