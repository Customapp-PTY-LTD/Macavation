/**
 * Supabase Edge Function: send daily digest via WhatsApp, through Control Room's meta-proxy.
 * Deploy: supabase functions deploy send-daily-digest-whatsapp
 * Cron: 5 6 * * * — 06:05 SAST daily (after email digest)
 *
 * Secrets: SUPABASE_SERVICE_ROLE_KEY, CONTROL_ROOM_FORWARD_SECRET, CONTROL_ROOM_CHANNEL_SLUG
 * Docs: https://control-room.customapp.co.za/docs/product-integration.md
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const CONTROL_ROOM_BASE_URL = 'https://ejnncypummmvyojhovme.supabase.co/functions/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function formatWhatsAppText(digest: Record<string, unknown>): string {
  const ks = (digest.kernel_stats as Record<string, unknown>) || {};
  const oil = (digest.oil_stats as Record<string, unknown>) || {};
  const alerts = (digest.open_alerts as unknown[]) || [];
  const proc = (digest.procurement_today as Record<string, unknown>) || {};
  const runway = (digest.runway as Record<string, unknown>) || {};
  const ext = (digest.extended_kpis as Record<string, unknown>) || {};
  const pvt = (digest.produced_vs_target as Record<string, unknown>) || {};
  const lines = [
    `Macavation daily digest · ${digest.date || 'today'}`,
    '',
    `Kernel: ${ks.kg_cracked_today ?? '—'} kg cracked today, ${ks.kg_packed_week ?? '—'} kg packed this week`,
    `Oil: ${oil.litres_today ?? '—'} L today, ${oil.litres_week ?? '—'} L this week`,
    `Recovery: ${ext.sound_kernel_recovery_pct ?? '—'}% · Yield: ${ext.oil_yield_pct ?? '—'}%`,
    `Runway: ${runway.weeks_cover ?? '—'} wks · SOH ${ext.kernel_soh_kg ?? '—'} kg`,
    `Target variance: ${pvt.variance_kg ?? '—'} kg`,
    `Alerts: ${alerts.length} open`,
    `Procurement today: ${proc.deliveries_today ?? 0} deliveries, ${Math.round(Number(proc.predicted_kg_today) || 0)} kg`,
    '',
    'Full detail in the portal dashboard.',
  ];
  return lines.join('\n');
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const forwardSecret = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET');
  const channelSlug = Deno.env.get('CONTROL_ROOM_CHANNEL_SLUG');
  if (!forwardSecret || !channelSlug) {
    return new Response(JSON.stringify({
      success: false,
      error: 'CONTROL_ROOM_FORWARD_SECRET and CONTROL_ROOM_CHANNEL_SLUG required',
    }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: digest, error: digestErr } = await supabase.rpc('get_daily_digest');
    if (digestErr) throw digestErr;

    const text = formatWhatsAppText(digest as Record<string, unknown>);

    const { data: subs, error: subsErr } = await supabase
      .from('scheduled_reports')
      .select('id, phone, email')
      .eq('is_active', true)
      .eq('channel', 'whatsapp');
    if (subsErr) throw subsErr;

    let sent = 0;
    for (const sub of subs || []) {
      const raw = (sub.phone || sub.email || '').trim();
      if (!raw) continue;
      const to = normalizePhone(raw);

      const requestBody = JSON.stringify({
        action: 'send_message',
        channelSlug,
        to,
        type: 'text',
        content: { text },
      });

      const res = await fetch(`${CONTROL_ROOM_BASE_URL}/meta-proxy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Control-Room-Signature': await signBody(forwardSecret, requestBody),
        },
        body: requestBody,
      });

      if (!res.ok) {
        console.error('WhatsApp failed for', to, await res.text());
        continue;
      }

      const result = await res.json();
      if (!result.ok) {
        console.error('WhatsApp failed for', to, result.error);
        continue;
      }

      await supabase.rpc('mark_scheduled_report_sent', { p_id: sub.id });
      sent += 1;
    }

    return new Response(JSON.stringify({ success: true, sent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
