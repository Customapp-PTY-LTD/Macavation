#!/usr/bin/env node
/**
 * Verifies the WhatsApp Flow data_exchange crypto contract two ways:
 *
 *   1. STATIC — the deployed .ts source actually uses the algorithm identifiers Meta's contract
 *      requires (RSA-OAEP/SHA-256, AES-GCM, the IV-flip, HTTP 421 on failure) — catches someone
 *      quietly changing an algorithm string without re-reading the contract.
 *   2. BEHAVIOURAL (self-consistency) — a plain-JS re-declaration of the same pure functions
 *      (Node's webcrypto implements the same WebCrypto spec Deno's crypto.subtle does), run
 *      against a hand-built request shaped exactly like Meta's real ping, proving the round trip
 *      works. This is NOT proof Meta's own client interoperates with this code — only that this
 *      code is internally consistent. See .cursor/plans/wa-flow-data-exchange-spike.md's "What
 *      actually proves this works" section: the only real proof is Meta's live health-check ping
 *      succeeding against the deployed endpoint, which this script cannot exercise.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { webcrypto as crypto } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const CRYPTO_MODULE_PATH = path.join(ROOT, 'supabase/functions/_shared/wa-flow-crypto.ts');
const ENDPOINT_PATH = path.join(ROOT, 'supabase/functions/whatsapp-flow-data-exchange/index.ts');

function readFile(p) {
  if (!fs.existsSync(p)) {
    console.error(`MISSING FILE: ${p}`);
    process.exit(1);
  }
  return fs.readFileSync(p, 'utf8');
}

const cryptoSrc = readFile(CRYPTO_MODULE_PATH);
const endpointSrc = readFile(ENDPOINT_PATH);

const failures = [];
function check(label, cond) {
  if (!cond) failures.push(label);
}

// ---- 1. Static checks against the real .ts source ------------------------------------------

check(
  'wa-flow-crypto.ts uses RSA-OAEP for the AES key unwrap',
  /name:\s*'RSA-OAEP'/.test(cryptoSrc)
);
check(
  'wa-flow-crypto.ts declares SHA-256 for the RSA-OAEP hash',
  /hash:\s*'SHA-256'/.test(cryptoSrc)
);
check(
  'wa-flow-crypto.ts uses AES-GCM for the flow-data decrypt/encrypt',
  /name:\s*'AES-GCM'/.test(cryptoSrc)
);
check(
  'wa-flow-crypto.ts flips the IV by XOR 0xff (Meta\'s response-IV contract)',
  /0xff/.test(cryptoSrc)
);
check(
  'whatsapp-flow-data-exchange/index.ts returns HTTP 421 on decrypt failure',
  /status:\s*421/.test(endpointSrc)
);
check(
  'whatsapp-flow-data-exchange/index.ts responds text/plain, not application/json, on success',
  /'Content-Type':\s*'text\/plain'/.test(endpointSrc)
);
check(
  'whatsapp-flow-data-exchange/index.ts answers the ping action with {data:{status:"active"}}',
  /status:\s*'active'/.test(endpointSrc)
);

// ---- 2. Behavioural self-consistency, plain-JS re-declaration of the pure functions ---------
// Deliberately re-implemented here rather than imported, matching the pattern wa-inbound.ts's own
// header describes for its pure functions — a Node script can't `import` Deno-flavoured .ts
// directly, so the logic is re-declared and checked for behavioural agreement with known-answer
// vectors instead.

function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}
function flipIv(ivB64) {
  const iv = base64ToBytes(ivB64);
  const flipped = new Uint8Array(iv.length);
  for (let i = 0; i < iv.length; i++) flipped[i] = iv[i] ^ 0xff;
  return flipped;
}

async function runBehaviouralCheck() {
  // Simulate what Meta's client does: generate an RSA keypair (stand-in for the one actually
  // registered with Meta), a random AES-128 key, RSA-OAEP-wrap the AES key, AES-GCM-encrypt a
  // real ping payload with a random IV — then feed that through THIS endpoint's exact logic.
  const rsaKeyPair = await crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt']
  );

  const aesKeyBytes = crypto.getRandomValues(new Uint8Array(16));
  const aesKeyForWrap = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, true, ['encrypt']);
  const rawAesKeyExport = await crypto.subtle.exportKey('raw', aesKeyForWrap);
  const encryptedAesKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, rsaKeyPair.publicKey, rawAesKeyExport);

  const iv = crypto.getRandomValues(new Uint8Array(12));
  // Meta's own AES key, kept separate from the endpoint's unwrapped copy below — usable for both
  // directions since this stand-in plays both "Meta encrypts the request" and, later, "Meta
  // decrypts the response" to prove interop from Meta's side too.
  const metaAesKey = await crypto.subtle.importKey('raw', aesKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const pingPayload = new TextEncoder().encode(JSON.stringify({ version: '3.0', action: 'ping' }));
  const encryptedFlowData = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, metaAesKey, pingPayload);

  const requestBody = {
    encrypted_flow_data: bytesToBase64(new Uint8Array(encryptedFlowData)),
    encrypted_aes_key: bytesToBase64(new Uint8Array(encryptedAesKey)),
    initial_vector: bytesToBase64(iv),
  };

  // ---- Endpoint-side logic, re-declared to match _shared/wa-flow-crypto.ts exactly ----
  const unwrapped = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rsaKeyPair.privateKey, base64ToBytes(requestBody.encrypted_aes_key));
  const unwrappedAesKey = await crypto.subtle.importKey('raw', unwrapped, { name: 'AES-GCM' }, false, ['decrypt', 'encrypt']);

  const decryptedBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(requestBody.initial_vector) },
    unwrappedAesKey,
    base64ToBytes(requestBody.encrypted_flow_data)
  );
  const decrypted = JSON.parse(new TextDecoder().decode(decryptedBytes));

  check('behavioural: decrypted request has action "ping"', decrypted.action === 'ping');

  const responseBody = { data: { status: 'active' } };
  const flippedIv = flipIv(requestBody.initial_vector);
  const responsePlaintext = new TextEncoder().encode(JSON.stringify(responseBody));
  const encryptedResponse = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: flippedIv }, unwrappedAesKey, responsePlaintext);
  const encryptedResponseB64 = bytesToBase64(new Uint8Array(encryptedResponse));

  // ---- Confirm a THIRD party (Meta, stood in for here) could decrypt the response ----
  // using the flipped IV independently derived from the ORIGINAL iv it sent.
  const metaSideFlippedIv = flipIv(requestBody.initial_vector);
  const metaSideDecrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: metaSideFlippedIv },
    metaAesKey,
    base64ToBytes(encryptedResponseB64)
  );
  const metaSideParsed = JSON.parse(new TextDecoder().decode(metaSideDecrypted));

  check(
    'behavioural: response round-trips back to {data:{status:"active"}} using the independently-flipped IV',
    metaSideParsed?.data?.status === 'active'
  );
}

await runBehaviouralCheck();

if (failures.length > 0) {
  console.error(`WA FLOW CRYPTO VERIFY FAILED (${failures.length}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log(
  `WA FLOW CRYPTO VERIFY OK (7 checks passed: 7 static + behavioural self-consistency). ` +
    `Reminder: this proves internal consistency only, NOT Meta interop — see the plan's ` +
    `"What actually proves this works" section for the live-ping check this cannot replace.`
);
