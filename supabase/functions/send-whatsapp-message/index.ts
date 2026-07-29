/**
 * Supabase Edge Function: send single WhatsApp message via Cloud API.
 * Stateless single-recipient send primitive called per message from the browser.
 * Deploy: supabase functions deploy send-whatsapp-message
 *
 * Secrets: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID
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
    return new Response(JSON.stringify({
      success: false,
      error: 'WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID required',
    }), { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  try {
    const { to, body } = await req.json();

    if (!to || !body) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required fields: to, body',
      }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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

    const data = await res.json();

    if (!res.ok) {
      console.error('WhatsApp API failed:', data);
      return new Response(JSON.stringify({
        success: false,
        error: data.error?.message || 'WhatsApp API request failed',
      }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      success: true,
      external_message_id: data.messages?.[0]?.id || null,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({
      success: false,
      error: String(e),
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
