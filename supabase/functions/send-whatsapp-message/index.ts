/**
 * Supabase Edge Function: send a single WhatsApp message via Meta Cloud API.
 * Deploy: supabase functions deploy send-whatsapp-message
 *
 * Stateless single-recipient send primitive, no DB access — the browser records
 * the result via chat_update_message_send_result after calling this.
 *
 * Secrets: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 *
 * Security note: reachable with the public anon key today — harmless because it
 * always 503s with no secrets configured. Before real Meta credentials are ever
 * wired, this needs a shared-secret or session check added.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function normalizePhone(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '27' + p.slice(1);
  if (!p.startsWith('27') && p.length <= 11) p = '27' + p;
  return p;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');

  if (!token || !phoneNumberId) {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'WhatsApp Business API not yet connected — WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID required',
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

    const normalizedTo = normalizePhone(to);

    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: { body },
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return new Response(
        JSON.stringify({ success: false, error: `Meta API rejected message: ${errorText}` }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const metaResponse = await res.json();
    const externalMessageId = metaResponse?.messages?.[0]?.id || null;

    return new Response(
      JSON.stringify({ success: true, external_message_id: externalMessageId }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, error: String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
