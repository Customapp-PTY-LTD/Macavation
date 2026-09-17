/**
 * Supabase Edge Function: the 17:00 SAST daily production push, sent unprompted to every active
 * daily subscriber via one of five approved WhatsApp templates, one per weekday
 * (`daily_production_template_monday` … `_friday` — see TEMPLATE_NAME_BY_WEEKDAY below). No
 * template exists for Saturday/Sunday, so the function skips outright on those days.
 *
 * Content mirrors the on-demand "Production today" menu reply exactly (see MENU_ITEMS' `production`
 * entry in whatsapp-inbound/index.ts) — same get_daily_digest() source, same four figures, so
 * what gets pushed unprompted at 17:00 is what a member would also see by tapping that menu item.
 * That on-demand reply is untouched by this file: it renders fresh from the same RPC on every tap,
 * independent of this push.
 *
 * Deploy: supabase functions deploy send-daily-production-report --project-ref nmdmddugxclpqrwylyfa
 * Intended schedule (set up outside this repo): cron `0 15 * * *` UTC == 17:00 SAST. SAST
 * (Africa/Johannesburg) carries no daylight saving, so a fixed UTC offset is safe year-round.
 *
 * Auth gate — what it does and does not prove.
 *   This function runs as service-role and reads RPCs deliberately revoked from
 *   anon/authenticated (report_daily_recipients — see the REVOKE/GRANT statements in the
 *   migrations named below). verify_jwt in this function's own config.toml proves only that the
 *   caller holds SOME valid project JWT — this repo's anon-key JWTs are committed in source
 *   (WebPortal/js/macavation-supabase.js:16,22), so that alone is not a real gate. The actual
 *   control, implemented below: the request's `Authorization: Bearer <token>` is compared, in
 *   constant time, against SUPABASE_SERVICE_ROLE_KEY. An empty header or an empty env var is
 *   ALWAYS treated as a non-match and rejected with 401 — never as a match — because
 *   timingSafeEqual('', '') would otherwise be true. This runs before any body parsing and before
 *   any RPC or send.
 *
 * RPCs called, and how each return shape is read (see the plan this function was built from for
 * the full contract; summarised here for anyone reading only this file):
 *   - report_sast_today()                                   -> date (bare string). Read directly.
 *   - get_daily_digest()                                     -> jsonb (a single object, carrying
 *       kernel_stats and oil_stats sub-objects — the same payload the on-demand "Production
 *       today" menu item reads). Read directly, no envelope, no rows[0].
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

const TEMPLATE_NAME_BY_WEEKDAY: Record<number, string> = {
  1: 'daily_production_template_monday',
  2: 'daily_production_template_tuesday',
  3: 'daily_production_template_wednesday',
  4: 'daily_production_template_thursday',
  5: 'daily_production_template_friday',
};
const MAX_RECIPIENTS = 25;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves the approved template name for a SAST calendar date string. Weekday is computed from
 * the date string itself, not "now" — a Y-M-D calendar date's weekday is unambiguous regardless
 * of timezone, so reading it via UTC components here does not reintroduce the "never new Date()
 * for today" problem this file otherwise avoids (report_sast_today() still owns "what day is it
 * now"). Returns null for Saturday/Sunday: no template exists for those days.
 */
function resolveTemplateName(dateStr: string): string | null {
  const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return TEMPLATE_NAME_BY_WEEKDAY[weekday] ?? null;
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

/**
 * Normalises a TABLE-returning RPC's result into a plain row array. For the three TABLE-returning
 * RPCs ONLY (report_daily_recipients, begin_report_delivery, complete_report_delivery) —
 * report_sast_today, get_daily_digest and daily_report_already_sent are read directly from `data`
 * and must never be routed through this, because a bare boolean/string would collapse both `true`
 * and `false` to the same `[]`.
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
 * Builds the eight sanitised template body parameters, in the fixed order Meta approved the
 * template with. Called exactly once per request — both the dry_run response and the send loop
 * read this same array. `digest` is get_daily_digest()'s payload; `kernel_stats` and `oil_stats`
 * are read straight off it, matching MENU_ITEMS' `production` render function in
 * whatsapp-inbound/index.ts exactly.
 */
function buildTemplateParams(digest: AnyRow, dateFallback: string): string[] {
  const ks = (digest.kernel_stats as AnyRow) ?? {};
  const oil = (digest.oil_stats as AnyRow) ?? {};
  const dateLabel = typeof digest.date === 'string' && digest.date.trim() ? digest.date : dateFallback;

  const raw = [
    dateLabel,
    formatFigure(ks.kg_cracked_today, 0),
    formatFigure(ks.kg_cracked_week, 0),
    formatFigure(ks.kg_packed_today, 0),
    formatFigure(ks.kg_packed_week, 0),
    formatFigure(oil.litres_today, 0),
    formatFigure(oil.litres_week, 0),
    formatFigure(ks.batches_in_production, 0),
  ];
  return raw.map(sanitizeParam);
}

/**
 * Whether there is genuinely nothing to report for today, mirroring the old report RPC's
 * has_production guard ("a silent day is better than '0 kg' every Sunday" — this repo's own
 * design note for this send). get_daily_digest()'s kernel_stats/oil_stats are COALESCE(...,0) —
 * a true zero and "nothing captured" are the same value here (see
 * migrations/20260914090000_dashboard_reads_data_production_daily.sql's own header) — so this
 * checks every figure the template shows, not just one, before staying silent.
 */
function hasNothingToReport(digest: AnyRow): boolean {
  const ks = (digest.kernel_stats as AnyRow) ?? {};
  const oil = (digest.oil_stats as AnyRow) ?? {};
  return (
    Number(ks.batches_in_production ?? 0) === 0 &&
    Number(ks.kg_cracked_today ?? 0) === 0 &&
    Number(ks.kg_packed_today ?? 0) === 0 &&
    Number(oil.litres_today ?? 0) === 0
  );
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

  // ---- 1.5 Weekday guard — no approved template for Saturday/Sunday, skip before any RPC work ---
  const templateName = resolveTemplateName(d);
  if (!templateName) {
    return jsonResponse(200, { skipped: 'weekend', date: d });
  }

  // ---- 2. Read today's digest — the same RPC the on-demand "Production today" menu item uses ----
  const { data: digestData, error: digestError } = await sb.rpc('get_daily_digest');
  if (digestError) {
    console.error('[send-daily-production-report] get_daily_digest failed:', digestError.message);
    return jsonResponse(502, { success: false, error: 'Could not load the daily digest.' });
  }
  const digest = (Array.isArray(digestData) ? digestData[0] : digestData) ?? {};

  // ---- 3. Suppress guard — never bypassed by `force` -------------------------------------------
  if (hasNothingToReport(digest)) {
    return jsonResponse(200, { skipped: 'no_production', date: d });
  }

  // ---- 4. Idempotency guard — `force` bypasses ONLY this guard --------------------------------
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

  // ---- 5. Recipients ----------------------------------------------------------------------------
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

  // ---- 6. Compose the eight parameters once ------------------------------------------------------
  const params = buildTemplateParams(digest, d);

  // ---- 7. dry_run — sends nothing, writes no delivery row ------------------------------------------
  if (dryRun) {
    return jsonResponse(200, {
      date: d,
      template: templateName,
      params,
      recipients: recipients.map((r) => ({ display_name: r.display_name ?? null, phone: r.phone ?? null })),
    });
  }

  // ---- 8. Send, one recipient at a time, sequentially ------------------------------------------------
  const bodyComponent: WaTemplateComponent = {
    type: 'body',
    parameters: params.map((text) => ({ type: 'text' as const, text })),
  };

  // Plain-text audit rendering of what was sent. Never passed to sendTemplate — the template
  // parameter rules (no newline, no run of 4+ spaces) apply only to `params`/`bodyComponent`.
  const renderedBodyText = [
    `Production · ${params[0]}`,
    `Kernel cracked: ${params[1]} kg today, ${params[2]} kg this week`,
    `Kernel packed: ${params[3]} kg today, ${params[4]} kg this week`,
    `Oil: ${params[5]} L today, ${params[6]} L this week`,
    `Batches in production: ${params[7]}`,
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

  // ---- 9. Respond — 200 even when every send failed --------------------------------------------
  return jsonResponse(200, { date: d, sent, failed, results });
});
