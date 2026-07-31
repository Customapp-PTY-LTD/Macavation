/**
 * Supabase Edge Function: send a single WhatsApp message via Control Room's meta-proxy.
 * Deploy: supabase functions deploy send-whatsapp-message
 *
 * Stateless single-recipient send primitive, no DB access — the browser records
 * the result via chat_update_message_send_result after calling this.
 *
 * Secrets: CONTROL_ROOM_FORWARD_SECRET, CONTROL_ROOM_CHANNEL_SLUG
 * Docs: https://control-room.customapp.co.za/docs/product-integration.md
 *
 * Security note: reachable with the public anon key today, same as before this
 * function was wired to a real send path — there is no session/permission check
 * (see portal-assistant's X-Portal-Session pattern for a candidate approach).
 * Once CONTROL_ROOM_FORWARD_SECRET is actually set, anyone holding the anon key
 * can send WhatsApp messages through this channel. Close this gap before setting
 * real secrets in production.
 */

const CONTROL_ROOM_BASE_URL = 'https://ejnncypummmvyojhovme.supabase.co/functions/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    return new Response(
      JSON.stringify({
        success: false,
        error: 'WhatsApp not yet connected — CONTROL_ROOM_FORWARD_SECRET and CONTROL_ROOM_CHANNEL_SLUG required',
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const { to, body } = await req.json();

    if (!to || !body) {
      return new Response(
        JSON.stringify({ success: false, error: 'to and body are required.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const requestBody = JSON.stringify({
      action: 'send_message',
      channelSlug,
      to: normalizePhone(to),
      type: 'text',
      content: { text: body },
    });

    const res = await fetch(`${CONTROL_ROOM_BASE_URL}/meta-proxy`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Control-Room-Signature': await signBody(forwardSecret, requestBody),
      },
      body: requestBody,
    });

    const result = await res.json();

    if (!res.ok || !result.ok) {
      return new Response(
        JSON.stringify({ success: false, error: `Control Room rejected message: ${result.error || res.statusText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, external_message_id: result.wamid || null }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
