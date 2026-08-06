---
depends_on: oil-sheet-ai-01-database.md
---

# AI production-sheet ingestion — the extraction edge function

## Context

`oil-sheet-ai-01-database.md` created the tables and RPCs that hold an uploaded production sheet and
its extracted contents. This plan authors the piece in the middle: a Deno edge function
`extract-oil-sheet` that receives a base64 image of a handwritten GMP production sheet, sends it to
Claude, validates what comes back, and writes the result through those RPCs.

The two forms in scope are **MP02-9 Rev3** (food grade) and **MP02-12 REV 04** (cosmetic oil). Both
are single-page, densely handwritten, and photocopied — this is a hard extraction problem, which is
why the whole flow ends in a mandatory human review screen (`oil-sheet-ai-04-review-and-confirm.md`).

**You cannot deploy edge functions.** No Supabase credential and no network path exists in this
environment. Author the files only; a human deploys with
`supabase functions deploy extract-oil-sheet --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`.
Do not attempt to deploy, and do not treat "not deployed" as a failure.

**The RPCs this function calls do not exist in the database yet** when this plan merges — a human
applies plan 01's migration out of band. That is fine: nothing invokes this function until plan 03
ships a UI for it. Do not add a fallback that writes to some other table.

## The template to copy

`supabase/functions/portal-assistant/index.ts` is the existing Anthropic integration in this repo and
the model for everything below. Read it first. Reuse, do not reinvent:

- **CORS block** — `portal-assistant/index.ts:45-50`. It already lists `x-portal-session` in
  `Access-Control-Allow-Headers`, in both casings. Copy it verbatim.
- **`jsonResponse` helper** — `:55-60`. Every response, including every error path, must go through
  it so CORS headers are never dropped. A function that throws before setting CORS shows up in the
  browser as an opaque "CORS policy" error that looks nothing like the real fault.
- **Service client** — `makeServiceClient()` at `:62-66`, reading `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` from the runtime.
- **Session auth** — `validateSession()` at `:152-176`. It reads the `X-Portal-Session` header and
  calls the `assistant_validate_session` RPC, returning `{userId, roleName, email}` or an error, and
  **fails closed**: an empty result is a 401. Reuse this function as-is. Portal login tokens are not
  Supabase Auth JWTs (`WebPortal/js/data-functions.js:496-497`), so this is the only session check
  that works here. Do not invent a new one and do not rely on `verify_jwt`.
- **Anthropic call** — `callAnthropic()` at `:195-234`: `fetch("https://api.anthropic.com/v1/messages")`
  with `x-api-key` and `anthropic-version: 2023-06-01`, returning a discriminated
  `{ok, body, statusCode, error}` rather than throwing.
- **Cost estimation** — `MODEL_PRICING` / `modelTier` / `estimateCostCents` at `:238-257`.
- **API key** — `Deno.env.get("ASSISTANT_AI_API_KEY") ?? Deno.env.get("ANTHROPIC_API_KEY")`, the same
  order `portal-assistant` uses.
- **`config.toml`** — `portal-assistant/config.toml:8-9` sets `verify_jwt = false` for its function.
  Ship the equivalent for `extract-oil-sheet`; auth is the `X-Portal-Session` check, not the gateway.

## Work

### 1. `supabase/functions/extract-oil-sheet/config.toml`

```toml
[functions.extract-oil-sheet]
verify_jwt = false
```

### 2. `supabase/functions/extract-oil-sheet/index.ts`

Open with a doc-comment header in the house style (see `portal-assistant/index.ts:1-39` and
`send-password-reset/index.ts:1-8`) naming the deploy command, the actions, the auth mechanism and
every environment variable read.

#### Request contract

`POST` only; `OPTIONS` short-circuits to the CORS preflight response.

```jsonc
{
  "action": "extract_oil_sheet",
  "sheet_type": "food_grade_oil",        // or "cosmetic_oil"
  "base64": "<downscaled JPEG, no data: prefix>",
  "media_type": "image/jpeg",            // or image/png, application/pdf
  "file_name": "MP02-9-2025-08-04.jpg",
  "s3_file_id": "…",                     // pointer from the browser's archival upload; may be null
  "preview_image": "data:image/jpeg;base64,…"
}
```

Reject with 400 if `sheet_type` or `base64` is missing. Reject with 413 if the decoded base64 exceeds
8 MB.

#### Flow

1. `validateSession()` → 401 on failure. Keep `userId` for the log row.
2. `get_oil_sheet_ai_config(sheet_type)`. If there is no active row, return 400
   `"No active AI config for sheet type: <x>"`.
3. `create_oil_sheet_extraction(...)` → the extraction id. Return this id to the caller
   **immediately in the final response**, not before — the browser waits for the whole call.
4. Build the Anthropic request (below) and send it, with retry.
5. Parse the response, validate it, and call either `save_oil_sheet_extraction_result` or
   `fail_oil_sheet_extraction`.
6. `log_oil_sheet_extraction(...)` on **both** paths — success and failure — with tokens, cost and
   elapsed ms.
7. Return `{ success, extraction_id, status, confidence, validation_flags, extracted_data }`.

#### The Anthropic request body — read this carefully

```ts
const body = {
  model: config.model,                       // seeded as "claude-opus-5"
  max_tokens: config.max_tokens,             // seeded 16000
  output_config: { effort: config.effort },  // seeded "high"
  messages: [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: config.extraction_prompt },
    ],
  }],
};
```

> **External-API contract — not verifiable from inside this checkout.** The only Anthropic call in
> this repo is `portal-assistant/index.ts:195-234`, and it runs `claude-sonnet-4-6` with no
> `temperature`, no `output_config` and no `thinking` key. The four constraints below are properties
> of `claude-opus-5` specifically, taken from Anthropic's model documentation — nothing in this
> checkout exercises them, so treat them as **unconfirmed until a human deploys and runs one real
> extraction**. They are cheap to get wrong safely: each one, if mistaken, surfaces as an HTTP 400
> whose message names the offending field, and the fix is a one-line edit plus a redeploy. Write the
> request builder so that adding or removing one of these keys is a single localised change, and make
> sure the Anthropic error body reaches `oil_sheet_extraction_log.error_message` verbatim so the
> first failure is self-diagnosing.

Four things will break this if got wrong:

- **Never send `temperature`, `top_p` or `top_k`.** `claude-opus-5` rejects sampling parameters with
  HTTP 400. Plan 01 deliberately omits the column; do not add the field with a literal either.
- **Never send `thinking: { type: "disabled" }`.** Thinking is on by default on this model, and
  disabling it can leak `<thinking>` tags into the visible text. Omit the `thinking` key entirely.
- **`type: "image"` for JPEG/PNG, `type: "document"` for `application/pdf`.** The content-block type
  must match the media type; sending a PDF as an image is a 400.
- `max_tokens` on this model caps thinking *plus* response text together. Do not lower the seeded
  16000 to "save cost" — a truncated response fails JSON parsing and wastes the whole call.

#### Retry

Wrap the Anthropic call in up to 3 attempts with exponential backoff (roughly 1s, 2s, 4s, with a
little jitter) on HTTP 429 and any 5xx, and on a network-level failure. Do not retry 400 or 401 —
those are our bug or our key, and retrying just triples the latency before the same error. Cap total
time at ~120s and return a clear timeout error beyond that.

#### Parsing the response

Claude sometimes wraps JSON in markdown fences or a sentence of prose. Port the robust parser from
`Libra-Portal/supabase/functions/_shared/parse-anthropic-json.ts` into this function as a local
helper — it is 25 lines and reproducing it avoids a shared-file dependency:

1. Trim, strip a leading ` ```json ` / ` ``` ` and a trailing ` ``` `.
2. Slice from the first `{` to the last `}`.
3. `JSON.parse`.
4. Assert the result is a non-null object and not an array.

On failure: `fail_oil_sheet_extraction` with the parse error, log with `status='error'`, return 502.
Include the first 500 characters of the raw text in the logged `error_message` so the failure is
diagnosable without re-running the extraction.

Also check `stop_reason`: `"max_tokens"` means the response was truncated — report that as its own
error message ("Response truncated — raise max_tokens for this sheet type") rather than a generic
JSON parse failure, because the fix is different.

#### Deterministic validation → `validation_flags`

The model's `confidence` is self-reported and uncalibrated. Two mechanical checks catch more real
errors than it does. Both append objects of the shape
`{ "field": "totals.raw_material_in_kg", "severity": "warning", "message": "…" }` to a
`validation_flags` array. Neither ever rejects the extraction — they annotate it for the reviewer.

**Arithmetic cross-check.** Both sheets carry handwritten column totals. Sum the extracted values
and compare against the total the model read, flagging any difference greater than
`max(0.05, 0.5% of the total)` — the tolerance absorbs the operator's own rounding without hiding a
misread digit.

- `food_grade_oil`: `Σ raw_material_in[].value_kg` vs `totals.raw_material_in_kg`; same for
  `oil_out` and `cake_out`.
- `cosmetic_oil`: `recipe` and `total_quantities` are independent figures, not a sum of `mixes` —
  **do not cross-check them against each other.** What you can check is that
  `oil_from_press.filter_kg + oil_from_press.hydraulic_kg` is consistent with the numbers parsed out
  of `oil_from_press.raw_text`, and that every `mixes[].mix_number` is unique and within 1–75.

**Batch-number plausibility.** Traceability joins on exact string equality —
`migrations/20260339000001_get_oil_batch_ingredients_detail.sql` matches `oil_bin_batch.batch_number`
and `oil.batch_id` with `=`, and batch numbers are unvalidated free text
(`migrations/20260345000001_manual_oil_protein_batch_numbers.sql:1-2`). A `BFG60.25.07.08` misread as
`BFG6O.25.07.08` therefore breaks the chain silently. For each batch number in the extraction
(`start_oil_bn`, `ibc*_bn`, `raw_material_batches[]`, `raw_material_traceability[].batch_no`,
`ibcs[].oil_bn`):

- If it matches an existing `oil.batch_id` or `oil_bin_batch.batch_number` exactly, no flag.
- If it does not match exactly but a case-insensitive comparison, or one with `O`↔`0` and `I`↔`1`
  substituted, does match — flag it as `severity: "warning"` naming the near-match. Do **not**
  auto-correct; the reviewer decides.
- If nothing is close, no flag. A genuinely new batch number is normal.

Add a small `SECURITY DEFINER` helper RPC for the lookup if plan 01 did not provide one; otherwise
do a single `select` of candidate batch numbers through the service client and match in TypeScript.
Prefer the latter — it is one round trip and needs no new migration.

## Security invariants

- `validateSession()` fails closed. An empty RPC result is 401, an RPC error is 503. Never continue
  on a session you could not validate.
- The service-role key is used only inside this function. Never echo it, never return it, never log
  it.
- Never log the API key or the full base64 payload.
- Do not trust `sheet_type` from the request as a table or column name — it is only ever an argument
  to `get_oil_sheet_ai_config`.
- Every `return` goes through `jsonResponse` so CORS headers survive the error paths.

## Verify before finishing

- `deno check supabase/functions/extract-oil-sheet/index.ts` if Deno is available in this
  environment; if it is not, say so rather than claiming it passed.
- `npm run test:fleet` passes. (It is hermetic and does not touch `supabase/functions/`, so this only
  proves nothing else broke.)
- Re-read the file and confirm by grep: no `temperature`, no `top_p`, no `top_k`, no `"thinking"`
  key anywhere; `jsonResponse` is used on every return path including the catch block; the retry
  loop excludes 400 and 401.
- Confirm the RPC names used here match plan 01's exactly — `create_oil_sheet_extraction`,
  `save_oil_sheet_extraction_result`, `fail_oil_sheet_extraction`, `log_oil_sheet_extraction`,
  `get_oil_sheet_ai_config`. A typo here is invisible until a human deploys and uploads a sheet.

You cannot call Anthropic or Supabase from here, so do not attempt a live extraction test.
