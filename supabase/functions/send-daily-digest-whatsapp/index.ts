/**
 * Supabase Edge Function: send daily digest via WhatsApp, through Control Room's meta-proxy.
 * Deploy: supabase functions deploy send-daily-digest-whatsapp
 *
 * NOT SCHEDULED. This header used to claim "Cron: 5 6 * * *". No such schedule exists anywhere
 * in this repo — no cron.schedule, no pg_cron job, no workflow invokes it. Nothing has ever been
 * sent from here. Its Scheduled Reports screen was removed in
 * migrations/20260904100000_targets_module_consolidation.sql.
 *
 * The live WhatsApp report path is report_subscriptions + send-daily-production-report.
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

/**
 * Detects "the RPC does not exist yet" — a migration not applied to this environment — so the
 * opt-out check below can fail OPEN for a not-yet-applied gate instead of refusing every
 * recipient. Identical detection logic to isMissingRpc in
 * supabase/functions/whatsapp-inbound/index.ts:184-188, re-declared here rather than imported:
 * this file does not import from send-report-whatsapp or whatsapp-inbound, and neither of those
 * exports it — a third independent copy of an eleven-line check across three files that cannot
 * see each other is the correct outcome here, not a smell to refactor away.
 */
function isMissingRpcError(err: unknown): boolean {
  const anyErr = err as { code?: unknown; message?: unknown } | null | undefined;
  const code = String(anyErr?.code ?? '');
  const msg = String(anyErr?.message ?? '');
  return code === 'PGRST202' || /could not find the function|does not exist/i.test(msg);
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

      // Opt-out gate (deliverable 3b). This sender reads scheduled_reports directly, entirely
      // outside report_recipients / report_daily_recipients' own gate — it is NOT scheduled
      // anywhere in this repo today (see header), but it exists, is deployed, and can be invoked
      // by hand, so the STOP reply's promise ("no further report messages") is false for as long
      // as this sender can send unchecked. `to` is already normalised; report_opt_out_status
      // normalises again internally via chat_normalize_phone, which is idempotent on its own
      // '27...'-shaped output (migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92),
      // so calling it twice with different input shapes here is harmless.
      let optOut: { opted_out?: boolean } | null = null;
      try {
        const { data: optOutData, error: optOutErr } = await supabase.rpc('report_opt_out_status', {
          p_phone: to,
        });
        if (optOutErr) throw optOutErr;
        optOut = (Array.isArray(optOutData) ? optOutData[0] : optOutData) ?? null;
      } catch (e) {
        if (isMissingRpcError(e)) {
          // Fail OPEN: this migration is not yet applied to every environment. console.error
          // names it so this is loud, not silent; sending proceeds for this recipient.
          console.error(
            '[send-daily-digest-whatsapp] report_opt_out_status is missing — migration ' +
              '20260907130000_report_opt_out not applied. Sending without an opt-out check for',
            to
          );
          optOut = null;
        } else {
          // Fail CLOSED: the gate could not answer — do not send. No delivery-row pair exists for
          // this sender today (unlike send-report-whatsapp); a console.error and a skip is the
          // whole of it.
          console.error('[send-daily-digest-whatsapp] report_opt_out_status check failed for', to, e);
          continue;
        }
      }

      if (optOut?.opted_out === true) {
        // Opted out — do not send, and do not mark it sent (it was not).
        console.error('[send-daily-digest-whatsapp] skipping opted-out recipient', to);
        continue;
      }

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
