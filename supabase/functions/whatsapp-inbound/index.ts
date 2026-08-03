/**
 * Supabase Edge Function: receive inbound WhatsApp messages and delivery receipts,
 * forwarded by Control Room from Meta.
 *
 * Deploy: supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt
 *
 * verify_jwt MUST BE DISABLED. Control Room sends no Supabase JWT — the
 * X-Control-Room-Signature HMAC over the raw body IS the authentication. With
 * verify_jwt on, every forward is rejected at the gateway before this code runs.
 *
 * Register in Control Room -> Channels -> macavation-9349 -> Overview -> Product
 * destination: project ref `nmdmddugxclpqrwylyfa` + function name `whatsapp-inbound`,
 * or the equivalent webhook URL override:
 *   https://nmdmddugxclpqrwylyfa.supabase.co/functions/v1/whatsapp-inbound
 * Until that is set, Control Room logs inbound events on its side and forwards nothing.
 *
 * Secrets: CONTROL_ROOM_FORWARD_SECRET (same secret that signs outbound sends — it
 * signs both directions)
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto-provided by the runtime)
 * Docs: https://control-room.customapp.co.za/docs/product-integration.md
 *
 * Control Room's contract:
 * - POSTs Meta's raw webhook envelope byte-for-byte: the whatsapp_business_account
 *   object, with entry[].changes[].value.messages[] for inbound messages,
 *   value.statuses[] for delivery receipts, value.contacts[0].profile.name for the
 *   sender's display name, and value.metadata.phone_number_id.
 * - Headers: X-Control-Room-Signature: sha256=<hex HMAC-SHA256 of the raw body>,
 *   X-Control-Room-Channel, X-Control-Room-Channel-Code,
 *   X-Control-Room-Phone-Number-ID, X-Control-Room-Signature-Verified: true.
 * - Inbound phone numbers are bare digits, no leading '+' (e.g. 27725755178).
 * - There is NO GET challenge — no hub.challenge handshake reaches us. POST only.
 * - There are NO RETRIES. Control Room always acks Meta 200 regardless of what we
 *   return; a non-2xx or timeout on our side is logged as failed and DROPPED FOREVER.
 *   So: persist first, log failures loudly with the wamid, and return 200 for anything
 *   that verifies but has nothing usable in it.
 * - Duplicates are possible; deduped on wamid by chat_ingest_inbound_whatsapp.
 * - Media is referenced by Meta id, not a URL, and the access token lives in Control
 *   Room — we cannot download bytes and do not try. Non-text messages store a
 *   placeholder body recording the type and media id.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-control-room-signature, x-control-room-channel, x-control-room-channel-code, x-control-room-phone-number-id, x-control-room-signature-verified',
};

// deno-lint-ignore no-explicit-any
type Any = any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function makeServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
}

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent, no early exit on the first differing byte. */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Body text for a message of any Meta type. Text and captioned media use the real
 * text; everything else gets a placeholder recording the type and the media id, since
 * we cannot fetch media bytes.
 */
function bodyForMessage(msg: Any): string {
  const type = String(msg?.type || 'unknown');

  switch (type) {
    case 'text':
      return String(msg?.text?.body ?? '').trim() || '[empty text message]';
    case 'button':
      return String(msg?.button?.text ?? '').trim() || '[button reply]';
    case 'interactive': {
      const i = msg?.interactive || {};
      const title = i?.button_reply?.title ?? i?.list_reply?.title ?? '';
      return String(title).trim() || '[interactive reply]';
    }
    case 'reaction': {
      const emoji = String(msg?.reaction?.emoji ?? '').trim();
      return emoji ? `[reacted ${emoji}]` : '[reaction]';
    }
    case 'location': {
      const l = msg?.location || {};
      const name = String(l?.name ?? '').trim();
      const coords = [l?.latitude, l?.longitude].filter((v) => v != null).join(', ');
      return `[location${name ? ` ${name}` : ''}${coords ? ` (${coords})` : ''}]`;
    }
    case 'contacts':
      return '[shared contact card]';
    case 'image':
    case 'video':
    case 'audio':
    case 'document':
    case 'sticker': {
      const media = msg?.[type] || {};
      const caption = String(media?.caption ?? '').trim();
      const filename = String(media?.filename ?? '').trim();
      const id = String(media?.id ?? '').trim();
      const label = `[${type}${filename ? ` ${filename}` : ''}${id ? ` id:${id}` : ''}]`;
      return caption ? `${label} ${caption}` : label;
    }
    default:
      return `[unsupported message type: ${type}]`;
  }
}

/** Meta timestamps are unix seconds as a string. */
function metaTimestampToIso(ts: unknown): string | null {
  const secs = Number(ts);
  if (!Number.isFinite(secs) || secs <= 0) return null;
  return new Date(secs * 1000).toISOString();
}

/** A missing RPC means the migration is not applied yet — degrade, do not 500. */
function isMissingRpc(err: Any): boolean {
  const code = String(err?.code ?? '');
  const msg = String(err?.message ?? '');
  return code === 'PGRST202' || /could not find the function|does not exist/i.test(msg);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // GET is a health check, not Meta's verification handshake — Control Room owns that
  // handshake and no hub.challenge reaches us. Answer 200 so anything validating that
  // this destination resolves (Control Room's own probe included) sees a live endpoint
  // rather than a 405 it could reasonably treat as unhealthy. Deliberately reports only
  // whether the forward secret is configured — never the secret, and no payload is
  // accepted or processed on this path.
  if (req.method === 'GET') {
    return json({
      success: true,
      function: 'whatsapp-inbound',
      ready: Boolean(Deno.env.get('CONTROL_ROOM_FORWARD_SECRET')),
      note: 'Signed POST forwards only; GET is a health check.',
    });
  }

  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed.' }, 405);
  }

  const forwardSecret = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET');
  if (!forwardSecret) {
    console.error('[whatsapp-inbound] CONTROL_ROOM_FORWARD_SECRET is not set — cannot verify forwards');
    return json(
      { success: false, error: 'WhatsApp not yet connected — CONTROL_ROOM_FORWARD_SECRET required' },
      503
    );
  }

  // Read the raw body ONCE and use this exact string for both signature verification
  // and JSON.parse. Parsing then re-stringifying before hashing breaks the HMAC.
  let raw: string;
  try {
    raw = await req.text();
  } catch (e) {
    console.error('[whatsapp-inbound] failed to read body:', e);
    return json({ success: false, error: 'Unreadable body.' }, 400);
  }

  const header = (req.headers.get('x-control-room-signature') || '').trim();
  if (!header) {
    console.warn('[whatsapp-inbound] rejected: missing X-Control-Room-Signature');
    return json({ success: false, error: 'Missing signature.' }, 401);
  }

  const provided = header.startsWith('sha256=') ? header.slice('sha256='.length) : header;
  const expected = await hmacHex(forwardSecret, raw);
  if (!timingSafeEqual(provided.toLowerCase(), expected)) {
    console.warn('[whatsapp-inbound] rejected: signature mismatch');
    return json({ success: false, error: 'Invalid signature.' }, 401);
  }

  // Verified from here on. Everything below returns 2xx so Control Room does not
  // record a false failure — there are no retries, a false failure loses nothing but
  // pollutes their log, while a real persist failure is ours to shout about.
  let payload: Any;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    console.error('[whatsapp-inbound] verified payload is not JSON:', e);
    return json({ success: true, ingested: 0, statuses: 0, note: 'unparseable payload' });
  }

  const sb = makeServiceClient();
  let ingested = 0;
  let deduped = 0;
  let statuses = 0;
  let failures = 0;
  let schemaMissing = false;

  const entries: Any[] = Array.isArray(payload?.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes: Any[] = Array.isArray(entry?.changes) ? entry.changes : [];

    for (const change of changes) {
      const value = change?.value ?? {};

      // Profile name for the far end, when Meta included one.
      const contactsArr: Any[] = Array.isArray(value?.contacts) ? value.contacts : [];
      const profileByWaId = new Map<string, string>();
      for (const c of contactsArr) {
        const waId = String(c?.wa_id ?? '').trim();
        const name = String(c?.profile?.name ?? '').trim();
        if (waId && name) profileByWaId.set(waId, name);
      }
      const fallbackProfile = String(contactsArr[0]?.profile?.name ?? '').trim() || null;

      // --- inbound messages: persist first, everything else after ---
      const messages: Any[] = Array.isArray(value?.messages) ? value.messages : [];
      for (const msg of messages) {
        const wamid = String(msg?.id ?? '').trim();
        const from = String(msg?.from ?? '').trim();

        if (!wamid || !from) {
          console.warn('[whatsapp-inbound] skipping message with no id or from:', JSON.stringify(msg));
          continue;
        }

        const { data, error } = await sb.rpc('chat_ingest_inbound_whatsapp', {
          p_from_phone: from,
          p_wamid: wamid,
          p_body: bodyForMessage(msg),
          p_message_type: String(msg?.type ?? 'unknown'),
          p_profile_name: profileByWaId.get(from) ?? fallbackProfile,
          p_sent_at: metaTimestampToIso(msg?.timestamp),
        });

        if (error) {
          if (isMissingRpc(error)) {
            schemaMissing = true;
            console.error(
              `[whatsapp-inbound] chat_ingest_inbound_whatsapp is missing — migration 20260813090000 not applied. DROPPED wamid=${wamid} from=${from}`
            );
            break;
          }
          failures++;
          console.error(`[whatsapp-inbound] PERSIST FAILED wamid=${wamid} from=${from}:`, error.message);
          continue;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || row.success !== 1) {
          failures++;
          console.error(
            `[whatsapp-inbound] PERSIST REJECTED wamid=${wamid} from=${from}: ${row?.error ?? 'empty response'}`
          );
          continue;
        }

        if (row.deduped) deduped++;
        else ingested++;
      }

      if (schemaMissing) break;

      // --- delivery receipts for messages we sent ---
      const statusArr: Any[] = Array.isArray(value?.statuses) ? value.statuses : [];
      for (const st of statusArr) {
        const wamid = String(st?.id ?? '').trim();
        const status = String(st?.status ?? '').trim();
        if (!wamid || !status) continue;

        const errText = Array.isArray(st?.errors) && st.errors.length
          ? String(st.errors[0]?.title ?? st.errors[0]?.message ?? '').trim() || null
          : null;

        const { error } = await sb.rpc('chat_record_whatsapp_status', {
          p_wamid: wamid,
          p_status: status,
          p_error: errText,
        });

        if (error) {
          if (isMissingRpc(error)) {
            schemaMissing = true;
            console.error(
              '[whatsapp-inbound] chat_record_whatsapp_status is missing — migration 20260813090000 not applied.'
            );
            break;
          }
          console.error(`[whatsapp-inbound] status update failed wamid=${wamid} status=${status}:`, error.message);
          continue;
        }

        statuses++;
      }

      if (schemaMissing) break;
    }

    if (schemaMissing) break;
  }

  if (schemaMissing) {
    // 200 on purpose: retrying would not help, and a 5xx loop just fills logs.
    return json({ success: true, ingested, deduped, statuses, note: 'schema not migrated yet' });
  }

  if (ingested || deduped || statuses || failures) {
    console.log(
      `[whatsapp-inbound] ingested=${ingested} deduped=${deduped} statuses=${statuses} failures=${failures}`
    );
  }

  return json({ success: failures === 0, ingested, deduped, statuses, failures });
});
