/**
 * Pure encryption/decryption for a WhatsApp Flow "data_exchange" endpoint.
 *
 * Contract verified against Meta's own WhatsApp Flows endpoint implementation guide,
 * developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint,
 * fetched 2026-09-21 — cite that page if any of the below is ever in doubt, do not trust this
 * comment blindly if a live request behaves differently than described here.
 *
 * Two WebCrypto behaviours this file relies on, EMPIRICALLY CONFIRMED (Node's webcrypto, which
 * implements the same spec Deno's `crypto.subtle` does — see scripts/verify-wa-flow-crypto.mjs
 * for the runnable proof) rather than assumed from docs, because Meta's own reference
 * implementations differ across languages on exactly this point:
 *   1. `crypto.subtle.decrypt('AES-GCM', key, iv, ciphertext)` expects the 16-byte GCM
 *      authentication tag APPENDED to the end of `ciphertext` — the same buffer
 *      `encrypted_flow_data` decodes to. No manual tag-splitting is needed or correct here.
 *   2. `crypto.subtle.encrypt('AES-GCM', ...)` already returns ciphertext with the tag appended,
 *      in the same "tag at the end" shape Meta's response format expects. No manual
 *      tag-concatenation step is needed on the encrypt side either.
 * Do not "fix" either direction by manually slicing/concatenating a tag — that would double up on
 * work WebCrypto already does, in the correct place, for both directions.
 *
 * Structured as pure functions (no module-scope secrets, no network) so
 * scripts/verify-wa-flow-crypto.mjs can construct a real Meta-shaped payload with Node's own
 * `crypto.subtle` and round-trip it through these exact functions — the offline half of proving
 * this works. The online half — Meta's real infrastructure actually calling the deployed
 * endpoint — is a separate, live check; see the deployed function's own header.
 */

export class WaFlowCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaFlowCryptoError';
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Strips PEM armor/whitespace and returns the raw DER bytes, for `crypto.subtle.importKey('pkcs8', ...)`. */
function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  if (!body) {
    throw new WaFlowCryptoError('pemToDer: input has no base64 body after stripping PEM armor.');
  }
  return base64ToBytes(body);
}

/**
 * Imports a PKCS8 PEM-encoded RSA private key for RSA-OAEP-SHA256 unwrap. Call once per request
 * (or cache at module scope in the caller if this proves too slow — not done here, so this file
 * stays pure and side-effect-free).
 */
export async function importFlowPrivateKey(pkcs8Pem: string): Promise<CryptoKey> {
  const der = pemToDer(pkcs8Pem);
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      der,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt']
    );
  } catch (e) {
    throw new WaFlowCryptoError(`importFlowPrivateKey: failed to import PKCS8 private key: ${e}`);
  }
}

/**
 * Unwraps the 128-bit AES key from `encrypted_aes_key` using the imported RSA private key.
 * RSA/ECB/OAEPWithSHA-256AndMGF1Padding — WebCrypto's RSA-OAEP with hash:'SHA-256' ties both the
 * OAEP hash and MGF1's hash to the key's declared hash, matching Meta's contract exactly.
 */
export async function unwrapAesKey(
  encryptedAesKeyB64: string,
  privateKey: CryptoKey
): Promise<CryptoKey> {
  const wrapped = base64ToBytes(encryptedAesKeyB64);
  let raw: ArrayBuffer;
  try {
    raw = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, wrapped);
  } catch (e) {
    throw new WaFlowCryptoError(`unwrapAesKey: RSA-OAEP decrypt failed: ${e}`);
  }
  return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt', 'encrypt']);
}

/**
 * Decrypts `encrypted_flow_data` with the unwrapped AES key and `initial_vector`. Returns the
 * parsed JSON body Meta sent (ping / INIT / BACK / data_exchange — see the header comment for the
 * shape). Throws WaFlowCryptoError on any failure — the caller must map that to HTTP 421 per
 * Meta's contract, never a different status code.
 */
export async function decryptFlowData(
  encryptedFlowDataB64: string,
  ivB64: string,
  aesKey: CryptoKey
): Promise<Record<string, unknown>> {
  const ciphertextAndTag = base64ToBytes(encryptedFlowDataB64);
  const iv = base64ToBytes(ivB64);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertextAndTag);
  } catch (e) {
    throw new WaFlowCryptoError(`decryptFlowData: AES-GCM decrypt failed: ${e}`);
  }
  const text = new TextDecoder().decode(plaintext);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new WaFlowCryptoError(`decryptFlowData: decrypted payload is not valid JSON: ${e}`);
  }
}

/**
 * Flips every bit of the request IV (XOR each byte with 0xFF), per Meta's contract for the
 * response encryption IV — NOT the same IV used to decrypt the request.
 */
export function flipIv(ivB64: string): Uint8Array {
  const iv = base64ToBytes(ivB64);
  const flipped = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i++) flipped[i] = iv[i] ^ 0xff;
  return flipped;
}

/**
 * Encrypts the response body with the SAME AES key from the request and the flipped IV, returning
 * the base64 string to send as the raw `text/plain` HTTP response body (never wrapped in JSON).
 */
export async function encryptFlowResponse(
  responseBody: Record<string, unknown>,
  aesKey: CryptoKey,
  requestIvB64: string
): Promise<string> {
  const flippedIv = flipIv(requestIvB64);
  const plaintext = new TextEncoder().encode(JSON.stringify(responseBody));
  const ciphertextAndTag = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: flippedIv },
    aesKey,
    plaintext
  );
  return bytesToBase64(new Uint8Array(ciphertextAndTag));
}
