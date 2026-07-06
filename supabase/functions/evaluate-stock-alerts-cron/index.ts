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

    const { data: kernels } = await supabase
      .from('kernel')
      .select('remaining_by_style')
      .eq('is_active', true)
      .in('status', ['complete', 'in_finished_stock']);

    const totals: Record<string, number> = {};
    STYLE_KEYS.forEach((k) => { totals[k] = 0; });
    for (const k of kernels || []) {
      const rem = (k.remaining_by_style || {}) as Record<string, number>;
      STYLE_KEYS.forEach((sk) => {
        totals[sk] += Number(rem[sk]) || 0;
      });
    }
    STYLE_KEYS.forEach((sk) => {
      observations.push({ product_type: 'kernel', style: sk, qty: totals[sk] });
    });

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
