/**
 * Supabase Edge Function: send daily digest emails to scheduled_reports subscribers.
 * Deploy: supabase functions deploy send-daily-digest
 *
 * NOT SCHEDULED. This header used to claim "Cron (Dashboard): 0 6 * * *". No such schedule was
 * ever created — there is no cron.schedule, no pg_cron job and no workflow anywhere in this repo
 * that invokes it, and RESEND_API_KEY was never configured either. Nothing has ever been sent
 * from here. The Scheduled Reports screen that fed it was removed in
 * migrations/20260904100000_targets_module_consolidation.sql; the scheduled_reports TABLE is
 * left in place only because scripts/sync-config-uat-to-prod.mjs and copy-prod-data-to-uat.mjs
 * still name it.
 *
 * The live path for report delivery is report_subscriptions + send-daily-production-report.
 *
 * Requires secrets: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (or SMTP_*)
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function renderDigestHtml(digest: Record<string, unknown>): string {
  const ks = (digest.kernel_stats as Record<string, unknown>) || {};
  const oil = (digest.oil_stats as Record<string, unknown>) || {};
  const alerts = (digest.open_alerts as unknown[]) || [];
  const proc = (digest.procurement_today as Record<string, unknown>) || {};
  const runway = (digest.runway as Record<string, unknown>) || {};
  const ext = (digest.extended_kpis as Record<string, unknown>) || {};
  const pvt = (digest.produced_vs_target as Record<string, unknown>) || {};
  const alertLines = alerts.slice(0, 10).map((a: Record<string, unknown>) =>
    `<li><strong>${a.title || a.severity}</strong> — ${a.type || ''}</li>`
  ).join('');
  return `<!DOCTYPE html><html><body style="font-family:sans-serif">
<h2>Macavation daily digest</h2>
<p>Date: ${digest.date || ''}</p>
<h3>Kernel production</h3>
<ul>
<li>Batches in production: ${ks.batches_in_production ?? '—'}</li>
<li>Kg cracked today: ${ks.kg_cracked_today ?? '—'}</li>
<li>Kg packed this week: ${ks.kg_packed_week ?? '—'}</li>
</ul>
<h3>Oil production</h3>
<ul>
<li>Litres today: ${oil.litres_today ?? '—'}</li>
<li>Litres this week: ${oil.litres_week ?? '—'}</li>
</ul>
<h3>KPIs</h3>
<ul>
<li>Sound kernel recovery: ${ext.sound_kernel_recovery_pct ?? '—'}%</li>
<li>Oil yield: ${ext.oil_yield_pct ?? '—'}%</li>
<li>Kernel SOH: ${ext.kernel_soh_kg ?? '—'} kg</li>
<li>Runway cover: ${runway.weeks_cover ?? '—'} weeks (${runway.months_cover ?? '—'} months)</li>
<li>Produced vs target: ${pvt.actual_kg ?? '—'} / ${pvt.target_kg ?? '—'} kg (variance ${pvt.variance_kg ?? '—'})</li>
</ul>
<h3>Open alerts (${alerts.length})</h3>
<ul>${alertLines || '<li>None</li>'}</ul>
<h3>Procurement today</h3>
<ul>
<li>Deliveries scheduled: ${proc.deliveries_today ?? 0}</li>
<li>Predicted kg: ${proc.predicted_kg_today ?? 0}</li>
</ul>
<p style="color:#666;font-size:12px">Generated ${digest.generated_at || ''}</p>
</body></html>`;
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

    const { data: digest, error: digestErr } = await supabase.rpc('get_daily_digest');
    if (digestErr) throw digestErr;

    const { data: subs, error: subsErr } = await supabase
      .from('scheduled_reports')
      .select('id, email')
      .eq('is_active', true)
      .eq('channel', 'email')
      .not('email', 'is', null);
    if (subsErr) throw subsErr;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('DIGEST_FROM_EMAIL') ?? 'reports@macavation.co.za';
    let sent = 0;

    for (const sub of subs || []) {
      const email = sub.email?.trim();
      if (!email) continue;

      if (resendKey) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [email],
            subject: `Macavation daily digest — ${digest.date || 'today'}`,
            html: renderDigestHtml(digest),
          }),
        });
        if (!res.ok) {
          console.error('Resend failed for', email, await res.text());
          continue;
        }
      } else {
        console.log('[digest preview]', email, JSON.stringify(digest).slice(0, 200));
      }

      await supabase.rpc('mark_scheduled_report_sent', { p_id: sub.id });
      sent += 1;
    }

    return new Response(JSON.stringify({ success: true, sent, subscribers: (subs || []).length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
