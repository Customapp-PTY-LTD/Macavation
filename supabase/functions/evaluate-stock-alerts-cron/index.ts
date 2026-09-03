/**
 * Scheduled stock alert evaluation — aggregates SOH from DB and calls evaluate_stock_alerts.
 * Cron: 0 7,12,17 * * * SAST (supplement grid-triggered evaluation)
 *
 * Requires: SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STYLE_KEYS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];

// Mirrors WebPortal/js/kernel-style-tally.js:26,29 — the shared helper the Kernel Stock on Hand
// page and the Kernel Stock Report both use. If either changes there, change it here too, or the
// alert thresholds start disagreeing with the screen people look at.
const KG_PER_CARTON = 11.34;
const FINISHED_STATUSES = ['complete', 'in_finished_stock'];

// get_kernel_batches pages (p_limit defaults to 100). Alert evaluation must see EVERY finished
// batch — a partial read understates stock and raises false low-stock alerts, which is the exact
// failure this file is being fixed for.
const KERNEL_PAGE_SIZE = 500;
const KERNEL_MAX_PAGES = 40;

/** parseNum from kernel-style-tally.js: anything unparseable is 0, never NaN. */
function parseNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/**
 * styleMapFromBatch from kernel-style-tally.js:38-51 — the value may arrive as an object or as a
 * JSON string, and anything else is an empty map.
 */
function styleMap(v: unknown): Record<string, unknown> {
  if (v == null) return {};
  if (typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '' || s === 'null') return {};
    try {
      const p = JSON.parse(s);
      if (p && typeof p === 'object' && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch { /* ignore */ }
  }
  return {};
}

/**
 * Every kernel batch, paged. Throws on any RPC error rather than returning a short list — a
 * silently truncated read is what produced the false alerts in the first place.
 */
async function fetchAllKernelBatches(
  supabase: ReturnType<typeof createClient>
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let page = 0; page < KERNEL_MAX_PAGES; page++) {
    const { data, error } = await supabase.rpc('get_kernel_batches', {
      p_status: null,
      p_search: null,
      p_limit: KERNEL_PAGE_SIZE,
      p_offset: page * KERNEL_PAGE_SIZE,
    });
    if (error) throw new Error(`get_kernel_batches failed: ${error.message}`);
    const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
    all.push(...rows);
    if (rows.length < KERNEL_PAGE_SIZE) return all;
  }
  console.warn(
    `[evaluate-stock-alerts-cron] stopped paging kernel batches at ${KERNEL_MAX_PAGES} pages — totals may be incomplete.`
  );
  return all;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const observations: { product_type: string; style: string; qty: number }[] = [];

    // Kernel stock on hand, per style, in kg.
    //
    // Read through get_kernel_batches, NOT off the `kernel` table. `remaining_by_style` is not a
    // column on any table — it is computed per batch by public.get_batch_remaining_by_style and
    // returned by this RPC (migrations/20260730120000_fix_kernel_dispatch_stock_and_empty_basket.sql:93,:155).
    // Selecting it from `kernel` errored, the error was discarded, and every style totalled 0 —
    // which is at or below every rule's min_qty, so the evaluator raised a FALSE low-stock alert
    // for every active kernel rule, every run. That is what
    // migrations/20260728120000_deactivate_kernel_style_0_1_stock_alerts.sql was working around.
    //
    // The tally rule below mirrors WebPortal/js/kernel-style-tally.js exactly — the shared helper
    // the Kernel Stock on Hand page and the Kernel Stock Report both use — so the alert thresholds
    // and the screen can never disagree about what "on hand" means. Keep the two in step.
    const kernelBatches = await fetchAllKernelBatches(supabase);

    const totals: Record<string, number> = {};
    STYLE_KEYS.forEach((k) => { totals[k] = 0; });
    for (const b of kernelBatches) {
      if (!FINISHED_STATUSES.includes(String(b?.status ?? '').trim())) continue;
      const remKg = styleMap(b?.remaining_by_style);
      const remCartons = styleMap(b?.remaining_by_style_cartons);
      STYLE_KEYS.forEach((sk) => {
        // Prefer the figure actually captured in kg; fall back to the carton count converted at
        // KG_PER_CARTON. Same precedence as cellsForBatch(batch, 'kg') in kernel-style-tally.js.
        const kg = parseNum(remKg[sk]);
        const cartons = parseNum(remCartons[sk]);
        totals[sk] += kg > 0 ? kg : cartons > 0 ? cartons * KG_PER_CARTON : 0;
      });
    }
    if (kernelBatches.length === 0) {
      // Refuse to evaluate kernel rules against a zero we are not sure of. Reading no batches at
      // all is far more likely to be a failed read than a genuinely empty warehouse, and a zero
      // here raises a low-stock alert for EVERY active kernel rule — precisely the failure this
      // change exists to fix. Skipping the observation leaves existing alerts untouched.
      console.error(
        '[evaluate-stock-alerts-cron] get_kernel_batches returned no rows — skipping kernel observations rather than reporting 0 kg for every style.'
      );
    } else {
      STYLE_KEYS.forEach((sk) => {
        totals[sk] = Math.round(totals[sk] * 100) / 100;
        observations.push({ product_type: 'kernel', style: sk, qty: totals[sk] });
      });
    }

    const { data: oilLots } = await supabase.from('oil_stock_lots').select('kilograms, grade, stock_category, status');
    let oilKg = 0;
    let proteinKg = 0;
    let rmKg = 0;
    for (const l of oilLots || []) {
      const st = String(l.status || '').toLowerCase();
      if (st !== 'on_hand' && st !== 'hold') continue;
      const kg = Number(l.kilograms) || 0;
      const cat = String(l.stock_category || '').toLowerCase();
      const grade = String(l.grade || '').toLowerCase();
      if (cat === 'raw_material') rmKg += kg;
      else if (grade.includes('protein')) proteinKg += kg;
      else oilKg += kg;
    }
    observations.push({ product_type: 'oil', style: '*', qty: oilKg });
    observations.push({ product_type: 'protein', style: '*', qty: proteinKg });
    observations.push({ product_type: 'nis_raw', style: '*', qty: rmKg });

    const { data: shellLots } = await supabase.from('shell_stock_lot').select('quantity_kg, status');
    let shellKg = 0;
    for (const s of shellLots || []) {
      const st = String(s.status || 'in_stock').toLowerCase();
      if (st === 'dispatched' || st === 'written_off') continue;
      shellKg += Number(s.quantity_kg) || 0;
    }
    observations.push({ product_type: 'shell', style: '*', qty: shellKg });

    const { data: result, error } = await supabase.rpc('evaluate_stock_alerts', {
      p_observations: observations,
    });
    if (error) throw error;

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
