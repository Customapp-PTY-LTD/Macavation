/**
 * Supabase Edge Function: WhatsApp Flow "data_exchange" endpoint — SPIKE ONLY.
 *
 * This function's ONLY job is to prove the Meta Flow encryption handshake works end to end
 * against Meta's real infrastructure. It answers Meta's health-check ping (action:'ping') and
 * nothing else — no screens, no digest data, no production-report logic. See
 * .cursor/plans/wa-flow-data-exchange-spike.md for the full spike scope and why this is
 * deliberately minimal.
 *
 * Deploy: supabase functions deploy whatsapp-flow-data-exchange --project-ref sofanhfpxifgdtooefzq --no-verify-jwt
 * (confirmed against supabase/config.toml, not copied from another function's header — at least
 * one existing function in this repo has a stale project ref in its own deploy comment.)
 *
 * verify_jwt MUST BE DISABLED. Meta sends no Supabase JWT — the request's own RSA/AES encryption
 * IS the authentication (only someone holding the matching RSA private key can have produced a
 * request this function can decrypt). Unlike whatsapp-inbound's Control Room HMAC signature,
 * there is no separate signature header to check here.
 *
 * Secrets required:
 *   WA_FLOW_RSA_PRIVATE_KEY_PEM — PKCS8 PEM, generated one-off via:
 *     openssl genrsa -out flow_private.pem 2048
 *     openssl pkcs8 -topk8 -nocrypt -in flow_private.pem -out flow_private_pkcs8.pem
 *     openssl rsa -in flow_private.pem -pubout -out flow_public.pem
 *   Set via: supabase secrets set WA_FLOW_RSA_PRIVATE_KEY_PEM="$(cat flow_private_pkcs8.pem)" --project-ref sofanhfpxifgdtooefzq
 *   The PUBLIC key (flow_public.pem) is what gets registered against the WABA/Flow in Meta
 *   Business Manager or via Control Room, NOT committed here, NOT logged, NOT included in any
 *   error message — see the crypto module's own contract notes for why a decrypt failure must
 *   report only "decrypt failed", never key material or intermediate values.
 *
 * Response contract (Meta's, not invented here — see _shared/wa-flow-crypto.ts's header for the
 * source): a successful decrypt+respond returns the encrypted response as a bare base64 string,
 * Content-Type text/plain — NOT a JSON envelope. A decrypt failure returns HTTP 421 with an empty
 * body — NOT a generic 4xx/5xx; Meta treats 421 specifically as "re-fetch my public key."
 */

import {
  decryptFlowData,
  encryptFlowResponse,
  importFlowPrivateKey,
  unwrapAesKey,
  WaFlowCryptoError,
} from '../_shared/wa-flow-crypto.ts';

const PRIVATE_KEY_PEM = Deno.env.get('WA_FLOW_RSA_PRIVATE_KEY_PEM') ?? '';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  if (!PRIVATE_KEY_PEM) {
    console.error('[whatsapp-flow-data-exchange] WA_FLOW_RSA_PRIVATE_KEY_PEM is not set.');
    return new Response(null, { status: 421 });
  }

  let body: { encrypted_flow_data?: string; encrypted_aes_key?: string; initial_vector?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 421 });
  }

  const { encrypted_flow_data, encrypted_aes_key, initial_vector } = body;
  if (!encrypted_flow_data || !encrypted_aes_key || !initial_vector) {
    return new Response(null, { status: 421 });
  }

  try {
    const privateKey = await importFlowPrivateKey(PRIVATE_KEY_PEM);
    const aesKey = await unwrapAesKey(encrypted_aes_key, privateKey);
    const decrypted = await decryptFlowData(encrypted_flow_data, initial_vector, aesKey);

    console.log(`[whatsapp-flow-data-exchange] decrypted action: ${decrypted.action}`);

    // This spike answers ONLY the health-check ping. Any other action (INIT/BACK/data_exchange —
    // i.e. a real screen open, which would only happen if this endpoint were wired to a real,
    // published Flow, which it deliberately is not) gets a generic error screen rather than
    // silently succeeding with made-up data.
    const responseBody =
      decrypted.action === 'ping'
        ? { data: { status: 'active' } }
        : {
            error_msg: 'This is a spike endpoint that only answers the health-check ping.',
          };

    const encryptedResponseB64 = await encryptFlowResponse(responseBody, aesKey, initial_vector);
    return new Response(encryptedResponseB64, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    });
  } catch (e) {
    if (e instanceof WaFlowCryptoError) {
      console.error(`[whatsapp-flow-data-exchange] decrypt/encrypt failed: ${e.message}`);
    } else {
      console.error('[whatsapp-flow-data-exchange] unexpected error:', e);
    }
    return new Response(null, { status: 421 });
  }
});
