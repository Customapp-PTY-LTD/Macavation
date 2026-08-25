/**
 * Supabase Edge Function: the 17:00 SAST daily production report, sent unprompted to every
 * active daily subscriber via the approved WhatsApp template `macavation_daily_production`.
 *
 * Deploy: supabase functions deploy send-daily-production-report --project-ref nmdmddugxclpqrwylyfa
 * Intended schedule (set up outside this repo): cron `0 15 * * *` UTC == 17:00 SAST. SAST
 * (Africa/Johannesburg) carries no daylight saving, so a fixed UTC offset is safe year-round.
 *
 * Auth gate — what it does and does not prove.
 *   This function runs as service-role and reads two RPCs deliberately revoked from
 *   anon/authenticated (get_daily_production_report, report_daily_recipients — see the REVOKE/
 *   GRANT statements in the migrations named below). verify_jwt in this function's own
 *   config.toml proves only that the caller holds SOME valid project JWT — this repo's anon-key
 *   JWTs are committed in source (WebPortal/js/macavation-supabase.js:16,22), so that alone is
 *   not a real gate. The actual control, implemented below: the request's `Authorization: Bearer
 *   <token>` is compared, in constant time, against SUPABASE_SERVICE_ROLE_KEY. An empty header or
 *   an empty env var is ALWAYS treated as a non-match and rejected with 401 — never as a match —
 *   because timingSafeEqual('', '') would otherwise be true. This runs before any body parsing
 *   and before any RPC or send.
 *
 * RPCs called, and how each return shape is read (see the plan this function was built from for
 * the full contract; summarised here for anyone reading only this file):
 *   - report_sast_today()                                   -> date (bare string). Read directly.
 *   - reseed_data_production_daily(p_date_from, p_date_to,
 *       p_actor_user_id)                                     -> TABLE(success, error,
 *       rows_reseeded). Envelope — rows[0].success === 1 required.
 *   - get_daily_production_report(p_date)                    -> jsonb (a single object). Read
 *       directly, no envelope, no rows[0].
 *   - daily_report_already_sent(p_date)                      -> boolean. Read directly.
 *   - report_daily_recipients()                              -> TABLE(recipient_id,
 *       display_name, phone, is_staff). Plain row array, no success/error columns.
 *   - begin_report_delivery(...)                             -> TABLE(success, error, id).
 *       Envelope.
 *   - complete_report_delivery(...)                          -> TABLE(success, error). Envelope.
 *
 * Env vars read: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both auto-provided by the runtime and
 * used for the service client + the auth gate), plus CONTROL_ROOM_BASE_URL / _FORWARD_SECRET /
 * _CHANNEL_SLUG, which are read inside ../_shared/wa-send.ts, not here.
 *
 * Sends via sendTemplate from ../_shared/wa-send.ts (never a hand-built Control Room payload) —
 * an approved template is the only send that can reach a recipient who has not messaged in the
 * last 24 hours, which is the normal case for an unprompted daily.
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

const TEMPLATE_NAME = 'macavation_daily_production';
const MAX_RECIPIENTS = 25;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
 * Normalises a TABLE-returning RPC's result into a plain row array. For the four TABLE-returning
 * RPCs ONLY (reseed_data_production_daily, report_daily_recipients, begin_report_delivery,
 * complete_report_delivery) — report_sast_today, get_daily_production_report and
 * daily_report_already_sent are read directly from `data` and must never be routed through this,
 * because a bare boolean/string would collapse both `true` and `false` to the same `[]`.
 */
async function rpcRows(sb: SupabaseClient, fn: string, params: Record<string, unknown> = {}): Promise<AnyRow[]> {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  if (Array.isArray(data)) return data as AnyRow[];
  if (data && typeof data === 'object') return [data as AnyRow];
  return [];
}

/**
 * Renders a production figure for a template body parameter: thousands separated by a
 * non-breaking space (so sanitizeParam's later collapse of runs of regular spaces cannot touch
 * it), no trailing unit (the template's own text carries "kg"/"%"), and the literal string
 * 'not captured' for null/undefined/non-numeric — never '0' for an uncaptured figure.
 */
function formatFigure(value: unknown, decimals = 0): string {
  if (value === null || value === undefined) return 'not captured';
  const num = Number(value);
  if (!Number.isFinite(num)) return 'not captured';

  const fixed = num.toFixed(decimals);
  const negative = fixed.startsWith('-');
  const abs = negative ? fixed.slice(1) : fixed;
  const [intPart, fracPart] = abs.split('.');
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const combined = fracPart ? `${withThousands}.${fracPart}` : withThousands;
  return negative ? `-${combined}` : combined;
}

/**
 * Meta rejects a template body parameter containing a newline, a tab, or a run of 4+ regular
 * spaces. Deliberately does NOT use `\s` anywhere: in JavaScript `\s` matches U+00A0, which would
 * destroy the non-breaking thousands separator formatFigure just inserted. Only explicit
 * characters are matched.
 */
function sanitizeParam(s: string): string {
  return s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * Builds the seven sanitised template body parameters, in the fixed order Meta approved the
 * template with. Called exactly once per request — both the dry_run response and the send loop
 * read this same array.
 */
function buildTemplateParams(report: AnyRow): string[] {
  const dateLabel =
    typeof report.date_label === 'string' && report.date_label.trim() ? report.date_label : 'not captured';

  const raw = [
    dateLabel,
    formatFigure(report.cracked_kg, 0),
    formatFigure(report.sk_packed_kg, 0),
    formatFigure(report.wholes_pct, 1),
    formatFigure(report.nis_kg, 0),
    formatFigure(report.wtd_cracked_kg, 0),
    formatFigure(report.wtd_target_kg, 0),
  ];
  return raw.map(sanitizeParam);
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

  // ---- Parse the body (all fields optional) ------------------------------------------------
  let body: AnyRow = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return jsonResponse(400, { success: false, error: 'Request body must be JSON.' });
  }

  const dryRun = body?.dry_run === true;
  const force = body?.force === true;
  const dateInput = typeof body?.date === 'string' ? body.date.trim() : '';

  if (dateInput && !DATE_RE.test(dateInput)) {
    return jsonResponse(400, { success: false, error: 'date must be in YYYY-MM-DD form.' });
  }

  // ---- 1. Resolve the date — never new Date(), the container is UTC -----------------------
  let d: string;
  if (dateInput) {
    d = dateInput;
  } else {
    const { data, error } = await sb.rpc('report_sast_today');
    if (error) {
      console.error('[send-daily-production-report] report_sast_today failed:', error.message);
      return jsonResponse(502, { success: false, error: "Could not resolve today's date." });
    }
    d = String(data);
  }

  // ---- 2. Refresh the factory mirror for this date ------------------------------------------
  let reseedRows: AnyRow[];
  try {
    reseedRows = await rpcRows(sb, 'reseed_data_production_daily', {
      p_date_from: d,
      p_date_to: d,
      p_actor_user_id: null,
    });
  } catch (e) {
    console.error('[send-daily-production-report] reseed_data_production_daily threw:', e);
    return jsonResponse(502, { success: false, error: 'Could not refresh production figures.' });
  }
  if (reseedRows[0]?.success !== 1) {
    return jsonResponse(502, {
      success: false,
      error: reseedRows[0]?.error || 'Could not refresh production figures.',
    });
  }

  // ---- 3. Read the figures --------------------------------------------------------------------
  const { data: reportData, error: reportError } = await sb.rpc('get_daily_production_report', { p_date: d });
  if (reportError) {
    console.error('[send-daily-production-report] get_daily_production_report failed:', reportError.message);
    return jsonResponse(502, { success: false, error: 'Could not load the daily production report.' });
  }
  const report = (reportData ?? {}) as AnyRow;

  // ---- 4. Suppress guard — never bypassed by `force` -------------------------------------------
  if (report.has_production !== true) {
    return jsonResponse(200, { skipped: 'no_production', date: d });
  }

  // ---- 5. Idempotency guard — `force` bypasses ONLY this guard --------------------------------
  if (!force) {
    const { data: alreadySent, error: alreadyErr } = await sb.rpc('daily_report_already_sent', { p_date: d });
    if (alreadyErr) {
      console.error('[send-daily-production-report] daily_report_already_sent failed:', alreadyErr.message);
      return jsonResponse(502, {
        success: false,
        error: "Could not check whether today's daily was already sent.",
      });
    }
    if (alreadySent === true) {
      return jsonResponse(200, { skipped: 'already_sent', date: d });
    }
  }

  // ---- 6. Recipients ----------------------------------------------------------------------------
  let recipients: AnyRow[];
  try {
    recipients = await rpcRows(sb, 'report_daily_recipients');
  } catch (e) {
    console.error('[send-daily-production-report] report_daily_recipients threw:', e);
    return jsonResponse(502, { success: false, error: 'Could not load the daily recipient list.' });
  }
  if (recipients.length === 0) {
    return jsonResponse(200, { skipped: 'no_recipients', date: d });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    console.warn(
      `[send-daily-production-report] dropping ${recipients.length - MAX_RECIPIENTS} recipient(s) beyond the ${MAX_RECIPIENTS} cap.`
    );
    recipients = recipients.slice(0, MAX_RECIPIENTS);
  }

  // ---- 7. Compose the seven parameters once ------------------------------------------------------
  const params = buildTemplateParams(report);

  // ---- 8. dry_run — sends nothing, writes no delivery row ------------------------------------------
  if (dryRun) {
    return jsonResponse(200, {
      date: d,
      params,
      recipients: recipients.map((r) => ({ display_name: r.display_name ?? null, phone: r.phone ?? null })),
    });
  }

  // ---- 9. Send, one recipient at a time, sequentially ------------------------------------------------
  const bodyComponent: WaTemplateComponent = {
    type: 'body',
    parameters: params.map((text) => ({ type: 'text' as const, text })),
  };

  // Plain-text audit rendering of what was sent. Never passed to sendTemplate — the template
  // parameter rules (no newline, no run of 4+ spaces) apply only to `params`/`bodyComponent`.
  const renderedBodyText = [
    `Daily production report for ${params[0]}`,
    `Cracked: ${params[1]} kg`,
    `SK packed: ${params[2]} kg`,
    `Wholes: ${params[3]}%`,
    `NIS received: ${params[4]} kg`,
    `WTD cracked: ${params[5]} kg`,
    `WTD target: ${params[6]} kg`,
  ].join('\n');

  const results: RecipientResult[] = [];
  let sent = 0;
  let failed = 0;

  for (const recipient of recipients) {
    // report_daily_recipients can return a null phone (report_normalize_wa_phone returns NULL
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
        p_report_instance_id: null,
        p_phone: phone,
        p_display_name: displayName,
        p_recipient_id: recipient.recipient_id ?? null,
        p_message_body: null,
        p_pdf_storage_bucket: null,
        p_pdf_storage_path: null,
        p_link_expires_at: null,
        p_actor_user_id: null,
        p_report_kind: 'daily',
        p_report_date: d,
        p_message_kind: 'template',
        p_template_name: TEMPLATE_NAME,
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
      const result = await sendTemplate(phone, TEMPLATE_NAME, 'en', [bodyComponent]);

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
            '[send-daily-production-report] complete_report_delivery reported failure (non-fatal):',
            completeRows[0]?.error
          );
        }
      } catch (e) {
        // A failed audit write must not abort the loop or flip the send's own outcome.
        console.error('[send-daily-production-report] complete_report_delivery threw (non-fatal):', e);
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
      console.error('[send-daily-production-report] unexpected error for recipient', phone, loopErr);
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

  // ---- 10. Respond — 200 even when every send failed --------------------------------------------
  return jsonResponse(200, { date: d, sent, failed, results });
});
