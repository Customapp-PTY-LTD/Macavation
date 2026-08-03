/**
 * Supabase Edge Function: send a single WhatsApp message via Control Room's meta-proxy.
 * Deploy: supabase functions deploy send-whatsapp-message
 *
 * Stateless single-recipient send primitive, no DB access beyond validating the
 * caller's session — the browser records the result via
 * chat_update_message_send_result after calling this.
 *
 * Secrets: CONTROL_ROOM_FORWARD_SECRET, CONTROL_ROOM_CHANNEL_SLUG
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by the runtime)
 * Docs: https://control-room.customapp.co.za/docs/product-integration.md
 *
 * Auth: X-Portal-Session header carries the same raw token minted at login
 * (auth_login_email / auth-google), same convention as portal-assistant.
 * Validated via the service-role RPC assistant_validate_session - fail closed
 * (empty result = 401). Without this, anyone holding the public anon key
 * (which ships in the browser) could send WhatsApp messages through this
 * channel once the Control Room secrets were live.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CONTROL_ROOM_BASE_URL = 'https://ejnncypummmvyojhovme.supabase.co/functions/v1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-portal-session, X-Portal-Session',
};

// deno-lint-ignore no-explicit-any
type AnyRow = Record<string, any>;

function makeServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(url, key);
}

async function rpc(sb: SupabaseClient, fn: string, params: Record<string, unknown> = {}): Promise<AnyRow[]> {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  if (Array.isArray(data)) return data as AnyRow[];
  if (data && typeof data === 'object') return [data as AnyRow];
  return [];
}

async function validateSession(sb: SupabaseClient, token: string): Promise<{ userId: string } | { error: string; status: number }> {
  if (!token) return { error: 'Authentication required.', status: 401 };

  let rows: AnyRow[];
  try {
    rows = await rpc(sb, 'assistant_validate_session', { p_token: token });
  } catch (e) {
    console.error('[send-whatsapp-message] session validation RPC failed:', e);
    return { error: 'Authentication unavailable. Please try again.', status: 503 };
  }

  const row = rows?.[0] ?? null;
  if (!row || !row.user_id) {
    return { error: 'Invalid or expired session. Please sign in again.', status: 401 };
  }

  return { userId: String(row.user_id) };
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

  const sb = makeServiceClient();
  const sessionToken = (req.headers.get('x-portal-session') || '').trim();
  const sessionOrErr = await validateSession(sb, sessionToken);
  if ('error' in sessionOrErr) {
    return new Response(
      JSON.stringify({ success: false, error: sessionOrErr.error }),
      { status: sessionOrErr.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
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
