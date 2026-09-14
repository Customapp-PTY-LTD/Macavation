/**
 * Supabase Edge Function: the automatic weekly/monthly WhatsApp broadcast, sent unprompted to
 * every active weekly/monthly subscriber via the approved WhatsApp template
 * `macavation_weekly_report` or `macavation_monthly_report`, mirroring the shape of
 * send-daily-production-report/index.ts but for a published report_instances row instead of a
 * daily figure snapshot.
 *
 * Deploy: supabase functions deploy send-period-report --project-ref nmdmddugxclpqrwylyfa
 * Nothing is scheduled for this function in this repo (see wa-flow-05) and it is not deployed by
 * anything in this checkout — a human deploys and, separately, schedules it.
 *
 * Auth gate — what it does and does not prove. Same shape and same reasoning as
 * send-daily-production-report/index.ts's own header: verify_jwt in this function's own
 * config.toml proves only that the caller holds SOME valid project JWT — this repo's anon-key
 * JWTs are committed in source (WebPortal/js/macavation-supabase.js:16,22), so that alone is not
 * a real gate. The actual control, implemented below: the request's `Authorization: Bearer
 * <token>` is compared, in constant time, against SUPABASE_SERVICE_ROLE_KEY. An empty header or
 * an empty env var is ALWAYS treated as a non-match and rejected with 401 — never as a match —
 * because timingSafeEqual('', '') would otherwise be true. This runs before any body parsing and
 * before any RPC or send.
 *
 * RPCs called, and how each return shape is read:
 *   - latest_published_instance(p_period_type)   -> uuid (bare scalar) or null. Read directly
 *       from `data`, NEVER through rpcRows — rpcRows collapses a bare scalar to [] regardless of
 *       value, which would make the resolver look permanently empty.
 *   - period_report_already_sent(p_report_instance_id) -> boolean (bare scalar). Read directly
 *       from `data`, same reason as above.
 *   - get_report_instance(p_report_instance_id)   -> jsonb (a single object). Read directly, no
 *       envelope, no rows[0].
 *   - report_recipients_for_kind(p_kind)          -> TABLE(recipient_id, display_name, phone,
 *       is_staff). Plain row array, no success/error columns — via rpcRows.
 *   - begin_report_delivery(...)                  -> TABLE(success, error, id). Envelope — via
 *       rpcRows.
 *   - complete_report_delivery(...)               -> TABLE(success, error). Envelope — via
 *       rpcRows.
 *
 * Env vars read: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided by the runtime and
 * used for the service client + the auth gate), plus CONTROL_ROOM_BASE_URL / _FORWARD_SECRET /
 * _CHANNEL_SLUG, which are read inside ../_shared/wa-send.ts, not here.
 *
 * Sends via sendTemplate from ../_shared/wa-send.ts (never a hand-built Control Room payload) —
 * an approved template is the only send that can reach a recipient who has not messaged in the
 * last 24 hours, which is the normal case for an unprompted weekly/monthly broadcast.
 *
 * No phone normaliser lives in this file: report_recipients_for_kind already projects through
 * public.report_normalize_wa_phone, and the phone it returns is passed straight through, the same
 * pattern the daily sender uses with its own recipient selector.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTemplate, type WaTemplateComponent } from '../_shared/wa-send.ts';
import { timingSafeEqual } from '../_shared/wa-inbound.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

const TEMPLATE_WEEKLY_NAME = 'macavation_weekly_report';
const TEMPLATE_MONTHLY_NAME = 'macavation_monthly_report';
const MAX_RECIPIENTS = 25;

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
 * Normalises the requested period kind the same way get_period_production_summary does
 * (migrations/20260825091000_daily_production_report.sql:348-367): lower-cased, trimmed, then
 * week|weekly -> weekly, month|monthly -> monthly. Anything else — including 'daily', '' and
 * null/undefined — returns null so the caller can 400 rather than guessing.
 */
function normalisePeriodKind(input: unknown): 'weekly' | 'monthly' | null {
  const v = typeof input === 'string' ? input.trim().toLowerCase() : '';
  if (v === 'week' || v === 'weekly') return 'weekly';
  if (v === 'month' || v === 'monthly') return 'monthly';
  return null;
}

/**
 * Normalises a TABLE-returning RPC's result into a plain row array. For the TABLE-returning RPCs
 * ONLY (report_recipients_for_kind, begin_report_delivery, complete_report_delivery) —
 * latest_published_instance and period_report_already_sent are read directly from `data` and must
 * never be routed through this, because a bare uuid/boolean would collapse to the same [].
 */
async function rpcRows(sb: SupabaseClient, fn: string, params: Record<string, unknown> = {}): Promise<AnyRow[]> {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  if (Array.isArray(data)) return data as AnyRow[];
  if (data && typeof data === 'object') return [data as AnyRow];
  return [];
}

/**
 * Meta rejects a template body parameter containing a newline, a tab, or a run of 4+ regular
 * spaces. Deliberately does NOT use `\s` anywhere: in JavaScript `\s` matches U+00A0, and a
 * monthly period_label (report_period_label, migrations/20260817090000_report_builder_
 * foundations.sql:124-137) contains TO_CHAR(..., 'Month YYYY'), whose 'Month' token is
 * blank-padded to 9 characters — a real run of regular spaces this function must collapse, not an
 * NBSP this function must preserve.
 */
function sanitizeParam(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Builds the two sanitised template body parameters, in the fixed order both templates were
 * defined with: {{1}} = period_label, {{2}} = published_at truncated to YYYY-MM-DD (the same
 * treatment send-report-whatsapp/index.ts's buildMessageText gives it at its own :197). Called
 * exactly once per request — both the dry_run response and the send loop read this same array.
 * No production figure is read or sent here; only period_label and published_at are referenced.
 */
function buildPeriodTemplateParams(payload: AnyRow): string[] {
  const periodLabel = typeof payload.period_label === 'string' ? payload.period_label : '';
  const publishedAt = typeof payload.published_at === 'string' ? payload.published_at.slice(0, 10) : '';
  return [periodLabel, publishedAt].map(sanitizeParam);
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
  // Never treat an empty header or an empty configured secret as a match: timingSafeEqual('','')
  // is true, so both sides must be checked non-empty first.
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

  const dryRun = body?.dry_run === true;
  const kind = normalisePeriodKind(body?.p_kind);
  if (!kind) {
    return jsonResponse(400, { success: false, error: "p_kind must be 'weekly' or 'monthly'." });
  }

  // ---- 1. Resolve the latest sendable published instance for this period type ---------------
  // Read directly from `data` — never through rpcRows (see its own header comment).
  const { data: instanceIdData, error: instanceIdError } = await sb.rpc('latest_published_instance', {
    p_period_type: kind,
  });
  if (instanceIdError) {
    console.error('[send-period-report] latest_published_instance failed:', instanceIdError.message);
    return jsonResponse(502, { success: false, error: 'Could not resolve the latest published instance.' });
  }
  const instanceId = (instanceIdData ?? null) as string | null;
  if (!instanceId) {
    // A period with no published instance is the normal state early in a period, not an error.
    console.log(`[send-period-report] no published ${kind} instance to send.`);
    return jsonResponse(200, { sent: 0, skipped: 'no_published_instance', kind });
  }

  // ---- 2. Idempotency guard -------------------------------------------------------------------
  const { data: alreadySentData, error: alreadySentError } = await sb.rpc('period_report_already_sent', {
    p_report_instance_id: instanceId,
  });
  if (alreadySentError) {
    console.error('[send-period-report] period_report_already_sent failed:', alreadySentError.message);
    return jsonResponse(502, { success: false, error: 'Could not check whether this instance was already sent.' });
  }
  if (alreadySentData === true) {
    return jsonResponse(200, { sent: 0, skipped: 'already_sent', kind, report_instance_id: instanceId });
  }

  // ---- 3. Load the instance and build the two template parameters ---------------------------
  const { data: instanceData, error: instanceError } = await sb.rpc('get_report_instance', {
    p_report_instance_id: instanceId,
  });
  if (instanceError) {
    console.error('[send-period-report] get_report_instance failed:', instanceError.message);
    return jsonResponse(502, { success: false, error: 'Could not load the report instance.' });
  }
  const payload = (instanceData ?? null) as AnyRow | null;
  if (!payload || typeof payload !== 'object') {
    return jsonResponse(502, { success: false, error: 'get_report_instance returned no payload.' });
  }

  const params = buildPeriodTemplateParams(payload);
  if (!params[0] || !params[1]) {
    return jsonResponse(200, {
      sent: 0,
      skipped: 'incomplete_payload',
      kind,
      report_instance_id: instanceId,
    });
  }

  const templateName = kind === 'weekly' ? TEMPLATE_WEEKLY_NAME : TEMPLATE_MONTHLY_NAME;

  // ---- 4. Recipients ----------------------------------------------------------------------------
  let recipients: AnyRow[];
  try {
    recipients = await rpcRows(sb, 'report_recipients_for_kind', { p_kind: kind });
  } catch (e) {
    console.error('[send-period-report] report_recipients_for_kind threw:', e);
    return jsonResponse(502, { success: false, error: 'Could not load the recipient list.' });
  }

  // ---- 5. dry_run — sits BEFORE the no_recipients return, unlike the daily sender's ordering.
  // Weekly/monthly subscription rows have never been read by anything until this plan, so the
  // roster is likely empty until a human ticks the distribution panel; proving the wording before
  // anything goes out must not depend on a non-empty roster already existing. Sends nothing,
  // writes no delivery row.
  if (dryRun) {
    return jsonResponse(200, {
      kind,
      report_instance_id: instanceId,
      template_name: templateName,
      params,
      recipients: recipients.map((r) => ({ display_name: r.display_name ?? null, phone: r.phone ?? null })),
    });
  }

  if (recipients.length === 0) {
    return jsonResponse(200, { sent: 0, skipped: 'no_recipients', kind, report_instance_id: instanceId });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    console.warn(
      `[send-period-report] dropping ${recipients.length - MAX_RECIPIENTS} recipient(s) beyond the ${MAX_RECIPIENTS} cap.`
    );
    recipients = recipients.slice(0, MAX_RECIPIENTS);
  }

  // ---- 6. Send, one recipient at a time, sequentially ------------------------------------------------
  const bodyComponent: WaTemplateComponent = {
    type: 'body',
    parameters: params.map((text) => ({ type: 'text' as const, text })),
  };

  // Plain-text audit rendering of what was sent. Never passed to sendTemplate — the template
  // parameter rules (no newline, no run of 4+ spaces) apply only to `params`/`bodyComponent`.
  const renderedBodyText = [`Macavation ${kind} report — ${params[0]}`, `Published ${params[1]}`].join('\n');

  const results: RecipientResult[] = [];
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    // report_recipients_for_kind can return a null phone (report_normalize_wa_phone returns NULL
    // for a digit-free stored value) — handled explicitly, never passed on anywhere.
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

      const beginRows = await rpcRows(sb, 'begin_report_delivery', {
        p_report_instance_id: instanceId,
        p_phone: phone,
        p_display_name: displayName,
        p_recipient_id: recipient.recipient_id ?? null,
        p_message_body: renderedBodyText,
        p_pdf_storage_bucket: null,
        p_pdf_storage_path: null,
        p_link_expires_at: null,
        p_actor_user_id: null,
        p_report_kind: kind,
        p_report_date: null,
        p_message_kind: 'template',
        p_template_name: templateName,
      });
      const beginRow = beginRows[0];

      if (!beginRow || beginRow.success !== 1) {
        // No delivery id was ever created — there is nothing to complete_report_delivery.
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
      const result = await sendTemplate(phone, templateName, 'en', [bodyComponent]);

      try {
        const completeRows = await rpcRows(sb, 'complete_report_delivery', {
          p_delivery_id: deliveryId,
          p_status: result.ok ? 'sent' : 'failed',
          p_external_message_id: result.wamid,
          p_error: result.error,
          p_message_body: renderedBodyText,
        });
        if (completeRows[0]?.success !== 1) {
          console.warn(
            '[send-period-report] complete_report_delivery reported failure (non-fatal):',
            completeRows[0]?.error
          );
        }
      } catch (e) {
        // A failed audit write must not abort the loop or flip the send's own outcome.
        console.error('[send-period-report] complete_report_delivery threw (non-fatal):', e);
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
      console.error('[send-period-report] unexpected error for recipient', phone, loopErr);
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

  // ---- 7. Respond — 200 even when every send failed --------------------------------------------
  return jsonResponse(200, {
    success: true,
    kind,
    report_instance_id: instanceId,
    template_name: templateName,
    sent,
    failed,
    results,
  });
});
