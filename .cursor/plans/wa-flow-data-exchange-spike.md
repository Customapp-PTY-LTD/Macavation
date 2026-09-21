# Spike: prove the WhatsApp Flow data_exchange encryption handshake works end-to-end

## Why

The team wants to turn the daily production report's WhatsApp menu (six sections: production,
stock, yield, alerts, intake, digest — `supabase/functions/whatsapp-inbound/index.ts:561-723`,
`MENU_ITEMS`) into a WhatsApp Flow that shows LIVE figures on every screen open, not figures frozen
at send time. Meta calls this a **data_exchange** Flow: on every screen open/navigation, Meta POSTs
an encrypted request to an endpoint this repo must host, and that endpoint must return an encrypted
response within the same HTTP call.

**Nothing in this repo, and nothing in the sibling repo `shopaholic-whatsapp` (the only other
Customapp product with a shipped WhatsApp Flow), implements this encryption handshake.**
Shopaholic's Flows (`supabase/flows/admin-stats.flow.json` there) are all the simpler
**navigate-only** kind — the entire screen tree and its data are baked into the button payload at
send time, no live server call, no encryption. This repo has zero RSA/AES Flow code today (grepped
for `encrypted_flow_data`, `encrypted_aes_key`, `initial_vector`, `createDecipheriv`,
`privateDecrypt` across `supabase/functions/` — no matches).

Building the full six-screen feature directly on top of an unproven encryption handshake risks a
class of failure that is invisible until Meta actually calls the endpoint: get the handshake wrong
and every Flow screen fails silently in front of real users, or (worse) the endpoint mishandles
cryptographic material. **This plan's only job is to prove the handshake itself works**, end to end,
against Meta's real infrastructure, before any of the six real screens are built. It intentionally
ships no user-visible feature.

## What "done" means

A new, minimal edge function that:
1. Generates or is given an RSA keypair, with the public key registered against Macavation's WABA.
2. Correctly answers Meta's **health-check ping** (Meta sends this automatically before allowing a
   data_exchange Flow to be published, and re-sends it periodically) — proving the round trip
   (decrypt request → encrypt response) works against Meta's real servers, not a local simulation.
3. Is wired to exactly one **throwaway draft Flow** (never published) via
   `set_flow_endpoint` so Meta has something to actually call.

No UI screens, no digest data, no production report changes. This is infrastructure-only.

## The exact contract (verified against Meta's own developer documentation, 2026-09-21 — cite this
section, do not restate the contract from training-data memory)

**Request body** (`POST` to your endpoint, `Content-Type: application/json`):
```json
{
  "encrypted_flow_data": "<base64>",
  "encrypted_aes_key": "<base64>",
  "initial_vector": "<base64>"
}
```

**Step 1 — unwrap the AES key.** Base64-decode `encrypted_aes_key`, then RSA-decrypt it with the
private key using **`RSA/ECB/OAEPWithSHA-256AndMGF1Padding`** (RSA-OAEP, SHA-256 hash, SHA-256 for
MGF1). The plaintext is a 128-bit (16-byte) AES key. In Deno/Node's `crypto.subtle`, this is
`RSA-OAEP` with `hash: 'SHA-256'` on an imported RSA private key — confirm the exact WebCrypto
incantation while building; do not assume MGF1's hash defaults to match without checking, Node/Deno
WebCrypto ties MGF1's hash to the key's declared hash.

**Step 2 — decrypt the flow data.** Base64-decode `encrypted_flow_data` and `initial_vector`. The
decoded flow-data bytes are ciphertext with a **16-byte (128-bit) GCM authentication tag appended to
the end** — split the last 16 bytes off as the tag before calling AES-GCM decrypt; the two cannot be
handed to a single `decrypt()` call as one blob without extracting the tag first (WebCrypto's
`AES-GCM` expects the tag appended at the *decrypt* side in Node/Deno, but VERIFY the exact call
signature your runtime's `crypto.subtle.decrypt` expects when building — some libraries want the tag
separate, some want it appended; Meta's own reference implementations differ across languages).
Decrypt with AES-128-GCM using the unwrapped key and the raw `initial_vector` bytes. The plaintext is
UTF-8 JSON:
```json
{
  "version": "3.0",
  "action": "ping" | "INIT" | "BACK" | "data_exchange",
  "screen": "<SCREEN_ID>",
  "data": { ... },
  "flow_token": "<token>"
}
```

**Step 3 — the health-check ping.** When decrypted `action` is `"ping"`, respond (before
encryption) with exactly:
```json
{ "data": { "status": "active" } }
```
This plan's only functional requirement is that THIS specific round trip succeeds against Meta's
real infrastructure — decrypt Meta's real ping, return this exact body, correctly encrypted.

**Step 4 — encrypt the response.** JSON-stringify the response body. Encrypt it with AES-128-GCM
using the SAME AES key from Step 1, but an **inverted IV**: flip every bit of the original
`initial_vector` bytes (XOR each byte with `0xFF`). Append the resulting 16-byte GCM tag to the
ciphertext, base64-encode the concatenated bytes, and return that base64 string as the raw HTTP
response body with **`Content-Type: text/plain`** (not `application/json` — Meta expects a bare
base64 string, not a JSON envelope, for a successful response).

**Error case.** If decryption fails for any reason (wrong key, malformed payload, tampered data),
respond with **HTTP status 421** and an empty body. Do not throw an unhandled exception that produces
a different status code — Meta treats 421 specifically as "your key rotated / re-fetch my public
key," a different signal than a generic 5xx.

**Source**: Meta's official WhatsApp Flows endpoint implementation guide,
`developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/implementingyourflowendpoint`,
fetched and quoted 2026-09-21. If Meta's live documentation has changed since, treat this plan's
quoted contract as what to verify against, not as ground truth to trust blindly — check the current
doc page if anything below fails against Meta's real ping.

## Read these first

- `supabase/functions/_shared/wa-inbound.ts:32-73` — this repo's existing crypto/signature pattern
  (`timingSafeEqual`, `hmacHex`, `verifyControlRoomSignature`). Not the same algorithm (that's HMAC,
  this is RSA+AES), but **match its shape**: pure functions with no module-scope side effects, so a
  Node verifier script can re-declare and test the crypto logic without loading the whole `.ts` file
  as a live Deno edge function. See `scripts/verify-wa-plumbing.mjs:786` for how that existing HMAC
  code gets tested from a plain Node script — follow the same testing pattern for the new RSA/AES
  code (a `scripts/verify-wa-flow-crypto.mjs`, testing the pure decrypt/encrypt functions against
  known-answer test vectors you construct yourself with Node's own `crypto` module, encrypting a
  fake "ping" payload the way Meta's docs describe and confirming your own decrypt function recovers
  it — this is the offline half of verification; the live half is the actual Meta ping in
  "How this will be verified" below).
- `supabase/functions/whatsapp-inbound/index.ts:1-30` — this repo's existing edge function header
  convention (deploy command comment, `verify_jwt` handling, secrets documented). Follow the same
  documentation style for the new function's header. Note: verify the CURRENT correct
  `--project-ref` for this repo before writing that comment — grep the repo for `sofanhfpxifgdtooefzq`
  vs. `nmdmddugxclpqrwylyfa` and cross-check against `supabase/config.toml`'s own header comment,
  since at least one existing edge function header in this repo has a stale/wrong ref in its deploy
  comment. Get this right in the new file rather than propagating the existing mistake.
- `supabase/flows/` in the sibling repo is NOT present here — this repo has no `supabase/flows/`
  directory yet. `mkdir` one.

## Fixed contracts — do not invent alternatives

- New edge function name: **`whatsapp-flow-data-exchange`**, under `supabase/functions/`.
- **`verify_jwt` must be disabled** for this function (same reasoning as `whatsapp-inbound`'s own
  header comment at line 7-9: Meta does not send a Supabase JWT; the request's own encryption IS the
  authentication — there is no separate signature header to check here, unlike Control Room's inbound
  webhook HMAC).
- The RSA private key must be read from an environment secret (e.g.
  `WA_FLOW_RSA_PRIVATE_KEY_PEM`), never committed to the repo, never logged, never included in any
  error message or RAISE/console.error call. Generate the keypair with a documented one-off command
  (e.g. `openssl genrsa -out flow_private.pem 2048` then extract the public key) — put the exact
  commands in the PR/commit description, not in a script that runs automatically, since key
  generation is a one-time human action, not something that should re-run on redeploy.
- This plan does NOT touch `whatsapp-inbound/index.ts`, `send-daily-production-report/index.ts`, or
  any MENU_ITEMS / digest logic. Zero screens, zero digest data, zero template changes. If you find
  yourself adding a screen definition or calling `get_daily_digest`, stop — that is out of scope for
  this plan.
- This plan does NOT register a public/live Flow. The Flow created via Control Room's `create_flow`
  MCP tool must stay in **draft** status. Do not call anything equivalent to "publish."

## What actually proves this works (cannot be verified from a diff alone — say so, do not fake it)

Unlike most of this repo's `test:fleet` gate, the core claim of this plan — "the encryption
handshake works against Meta's real infrastructure" — **cannot be verified by a static check
against the code alone.** A unit test with hand-built ciphertext proves your own decrypt/encrypt
round-trips against itself; it does NOT prove Meta's actual client library encrypts/expects things
in a way your code correctly interoperates with. The only real proof is Meta's own health-check
ping succeeding.

Do these in order:
1. Write the pure crypto functions (`unwrapAesKey`, `decryptFlowData`, `encryptFlowResponse`) and a
   Node-runnable verifier script that constructs a fake request the way Meta's docs describe
   (generate a real AES key, RSA-OAEP-encrypt it with the SAME keypair's public half, AES-GCM-encrypt
   a `{"version":"3.0","action":"ping"}` payload, submit it to your own decrypt function, confirm you
   get `action: "ping"` back out) and confirms your own encrypt function produces a payload Node's
   `crypto` can independently decrypt back to `{"data":{"status":"active"}}`. This is necessary but
   NOT sufficient — record it as "self-consistency proven," not "Meta interop proven."
2. Deploy the edge function to Macavation's live project (`sofanhfpxifgdtooefzq` — confirm this ref
   against `supabase/config.toml` before using it, per the note above).
3. Use the `control-room-macavation-9349` MCP's `create_flow` tool to create ONE throwaway draft Flow
   (name it something obviously disposable, e.g. `zz_spike_data_exchange_ping`), a minimal valid
   `update_flow_json` body (a single terminal screen is enough — this Flow is never opened by a real
   user), then `set_flow_endpoint` to point it at the new function.
4. Report back (do not silently mark this "done" if this step fails) whether Meta's own health-check
   ping against the live endpoint succeeded. Meta typically pings shortly after `set_flow_endpoint`
   and periodically after. If nothing has called the endpoint within a reasonable wait, say so
   explicitly rather than assuming success — check the edge function's own logs
   (`supabase functions logs` / the dashboard) for an inbound POST from Meta's infrastructure, not
   just "no errors were thrown," since "never called" and "called and succeeded" look identical from
   inside code that never ran.

## How this will be verified

- `npm run test:fleet` still passes (this plan adds a new independent verify script; it must not
  break any existing one).
- The new `scripts/verify-wa-flow-crypto.mjs` (or similarly named) passes, proving self-consistency
  per step 1 above.
- The PR/commit description states plainly, one way or the other: did Meta's real health-check ping
  against the live deployed endpoint succeed? Cite the actual log line/timestamp if yes. If the ping
  had not arrived by the time this plan's work concluded, say that explicitly — this is a legitimate
  outcome for a plan whose job is to find out, not a failure to hide.
- No changes to `whatsapp-inbound/index.ts`, `send-daily-production-report/index.ts`, or any
  `MENU_ITEMS`/digest code (grep the diff for these paths — if touched, that's out of scope creep).
- The created Flow (via `create_flow`) is left in draft status, never published.

## Do not

- Do not build any of the six report screens (production/stock/yield/alerts/intake/digest). That is
  explicitly future work, gated on this spike succeeding.
- Do not modify the daily production report template or its buttons.
- Do not publish the throwaway Flow.
- Do not commit the RSA private key anywhere, in any form, including a "for now, temporarily" comment.
- Do not assume Meta's contract is exactly as quoted above without checking — if the live ping fails
  against a byte-for-byte implementation of the quoted contract, that is valuable, reportable
  information (Meta's docs may have shifted since 2026-09-21), not a bug to silently work around with
  a guessed variant.

## Size

Small. One new edge function (crypto only, no business logic), one Node verifier script, one
throwaway draft Flow, one `set_flow_endpoint` call. No database changes, no existing-file changes
outside what's needed to add the new function. Well inside a single run.
