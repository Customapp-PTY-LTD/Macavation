# AI production-sheet ingestion — the extraction edge function

## Context

`oil-sheet-ai-01-database.md` creates the tables and RPCs that hold an uploaded GMP production sheet
and its extracted contents. This plan authors the piece in the middle: a Deno edge function
`extract-oil-sheet`.

The two forms in scope are **MP02-9 Rev3** (food grade) and **MP02-12 REV 04** (cosmetic oil). Both
are single-page, densely handwritten and photocopied, which is why the flow ends in a mandatory human
review screen (`oil-sheet-ai-04-review-and-confirm.md`).

**This function is the only way the browser reaches the new tables.** Plan 01's nine RPCs are
`service_role`-only: `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE … TO
service_role`, modelled on `migrations/20260815130000_whatsapp_pending_commands.sql:236-253`. That is
deliberate — the browser authenticates to PostgREST as `anon`
(`WebPortal/js/data-functions.js:499-518`) using a **publicly committed** anon key
(`WebPortal/js/macavation-supabase.js:16`), so an RPC reachable that way is reachable by anyone on
the internet. Since these RPCs write the GMP production record, they get a session-validated gateway
instead. **This function is that gateway**, which is why it carries read and write actions and not
just extraction.

**You cannot deploy edge functions.** No Supabase credential and no network path exists here. Author
the files only; a human deploys with
`supabase functions deploy extract-oil-sheet --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`.
Do not attempt to deploy, and do not treat "not deployed" as a failure.

**The RPCs do not exist in the database yet** when this merges — a human applies plan 01's migration
out of band. That is fine; nothing invokes this function until plan 03 ships a UI. Do not add a
fallback that writes somewhere else.

## The template to copy

`supabase/functions/portal-assistant/index.ts` is the existing Anthropic integration in this repo and
the model for everything below. Read it first, and reuse rather than reinvent:

| Piece | Where | Note |
|---|---|---|
| CORS block | `:45-50` | already lists `x-portal-session` in both casings — copy verbatim |
| `jsonResponse` | `:55-60` | every return goes through it, including errors |
| Service client | `:62-66` | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` |
| `rpc()` wrapper | `:68` | |
| `validateSession()` | `:152-176` | reads `X-Portal-Session`, calls `assistant_validate_session`, returns `{userId, roleName, email}`, **fails closed** |
| `callAnthropic()` | `:195-234` | returns `{ok, body, statusCode, error}` instead of throwing |
| Cost estimation | `:238-257` | `MODEL_PRICING` / `modelTier` / `estimateCostCents` |
| A real request body | `:689-695` | `{ model, max_tokens, temperature: 0.2, system, messages }` |
| API key | `:655` | `ASSISTANT_AI_API_KEY` ?? `ANTHROPIC_API_KEY` |
| `config.toml` | `portal-assistant/config.toml:8-9` | `verify_jwt = false` |

Portal login tokens are **not** Supabase Auth JWTs (`WebPortal/js/data-functions.js:496-497`), so
`validateSession()` is the only session check that works. Do not invent another, and do not rely on
`verify_jwt`.

## Work

### 1. `supabase/functions/extract-oil-sheet/config.toml`

```toml
[functions.extract-oil-sheet]
verify_jwt = false
```

### 2. `supabase/functions/extract-oil-sheet/index.ts`

Doc-comment header in the house style (`portal-assistant/index.ts:1-39`,
`send-password-reset/index.ts:1-8`) naming the deploy command, the actions, the auth mechanism and
every environment variable read.

`POST` only; `OPTIONS` short-circuits to the preflight response. Dispatch on `body.action`, the same
shape `portal-assistant` uses (`:132-136`).

#### Authorization — applies to every action

1. `validateSession()` → 401 on failure. Keep `userId` and `roleName`.
2. **Role allow-list, enforced here.** `roleName` must be one of `super_user`, `admin`,
   `General Manager`, `QA Supervisor`, `Oil Plant Manager`, `Office Administrator` — the same set
   plan 01 grants the feature and action keys to. Anything else → 403. This is the real
   authorization boundary; the browser-side `hasAction()` check in plans 03/04 is cosmetic and can
   be bypassed by anyone who can call this endpoint. Define the list as one `const` and check it in
   one place before the action switch.

#### Actions

| action | body | does |
|---|---|---|
| `extract_oil_sheet` | `sheet_type`, `base64`, `media_type`, `file_name`, `s3_file_id`, `preview_image` | the extraction flow below |
| `list_oil_sheets` | `status?`, `sheet_type?`, `limit?`, `offset?` | `get_oil_sheet_extractions` |
| `get_oil_sheet` | `id` | `get_oil_sheet_extraction_by_id` |
| `save_oil_sheet_review` | `id`, `reviewed_data` | `update_oil_sheet_extraction_review` |
| `confirm_oil_sheet` | `id`, `reviewed_data` | `confirm_oil_sheet_extraction` |

Pass `userId` from the validated session as `p_uploaded_by` / `p_reviewed_by`. **Never** take a user
id from the request body — that would let any caller attribute an action to someone else.

#### The extraction flow

1. Reject with 400 if `sheet_type` or `base64` is missing; 413 if the decoded base64 exceeds 8 MB.
2. `get_oil_sheet_ai_config(sheet_type)` → 400 if there is no active row.
3. `check_oil_sheet_ai_budget(estimated_cents)` (plan 01, mirroring `assistant_check_budget` at
   `migrations/20260716160000_portal_assistant_chat.sql:832`). If not allowed, return **402** with
   the remaining budget and do **not** call Anthropic. Estimate conservatively before the call; the
   real cost is recorded after.
4. `create_oil_sheet_extraction(...)` → the extraction id.
5. Build and send the Anthropic request, with retry.
6. Parse and validate; call `save_oil_sheet_extraction_result` or `fail_oil_sheet_extraction`.
7. `log_oil_sheet_extraction(...)` on **both** paths, with tokens, `cost_cents`, `latency_ms`,
   `http_status` and `success` — the same columns `assistant_usage_log` uses. Plan 01 makes this call
   also advance `oil_sheet_ai_budget.spent_cents`.
8. Return `{ success, extraction_id, status, confidence, validation_flags, extracted_data }`.

#### The Anthropic request body

Mirror the only working call in this repo (`portal-assistant/index.ts:689-695`) and vary only what
this feature needs:

```ts
const body = {
  model: config.model,          // seeded 'claude-sonnet-4-6' — same as portal-assistant:96
  max_tokens: config.max_tokens,
  temperature: 0.2,             // same literal as portal-assistant:692
  messages: [{
    role: "user",
    content: [
      { type: contentType, source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: config.extraction_prompt },
    ],
  }],
};
```

- `contentType` is `"image"` for JPEG/PNG and `"document"` for `application/pdf`. The block type must
  match the media type.
- **Send nothing else.** No `thinking`, no `output_config`, no `effort`, no `top_p`, no `top_k`. An
  earlier revision of this plan specified those and was blocked: none of them appear anywhere in this
  repo's Anthropic usage, so their behaviour cannot be verified from this checkout. If a future model
  needs them, add them in a plan that can cite a working call.
- `max_tokens` comes from config (seeded 8192). Do not lower it to save cost — a truncated response
  fails JSON parsing and wastes the whole call.

#### Retry

Up to 3 attempts with exponential backoff (~1s, 2s, 4s, with jitter) on HTTP 429, any 5xx, and
network-level failures. **Do not retry 400 or 401** — those are our bug or our key, and retrying just
triples the latency before the same error. Cap total wall time at ~120s.

#### Parsing the response

Claude sometimes wraps JSON in markdown fences or a sentence of prose. Implement a local helper
(about 25 lines — do not add a shared module, it would collide with sibling plans):

1. Trim; strip a leading ` ```json ` / ` ``` ` and a trailing ` ``` `.
2. Slice from the first `{` to the last `}`.
3. `JSON.parse`.
4. Assert the result is a non-null object and not an array.

On failure: `fail_oil_sheet_extraction`, log with `success = false`, return 502. Put the first 500
characters of the raw text into the logged `error_message` so the failure is diagnosable without
re-running the extraction. Also surface the Anthropic error body verbatim when the call itself fails
— the first real deployment is when any assumption about the API gets tested, and a self-diagnosing
log entry is the difference between a one-line fix and a re-investigation.

Check `stop_reason` separately: `"max_tokens"` means truncation, and the fix (raise `max_tokens` for
that sheet type) differs from a parse failure. Report it with its own message.

#### Deterministic validation → `validation_flags`

`confidence` is self-reported and uncalibrated. Two mechanical checks catch more real errors. Both
append `{ "field": "…", "severity": "warning", "message": "…" }` and **never reject** the extraction
— they annotate it for the reviewer.

**Arithmetic cross-check.** Both sheets carry handwritten column totals. Sum the extracted values and
compare, flagging a difference greater than `max(0.05, 0.5% of the total)` — the tolerance absorbs
the operator's own rounding without hiding a misread digit.

- `food_grade_oil`: `Σ raw_material_in[].value_kg` vs `totals.raw_material_in_kg`; likewise `oil_out`
  and `cake_out`.
- `cosmetic_oil`: `recipe` and `total_quantities` are independent figures, **not** a sum of `mixes` —
  do not cross-check them against each other. What you can check: that
  `oil_from_press.filter_kg + oil_from_press.hydraulic_kg` agrees with the numbers parsed out of
  `oil_from_press.raw_text`, and that every `mixes[].mix_number` is unique and within 1–75.

**Batch-number plausibility.** Traceability joins on exact string equality —
`migrations/20260339000001_get_oil_batch_ingredients_detail.sql` matches `oil_bin_batch.batch_number`
and `oil.batch_id` with `=` — and batch numbers are unvalidated free text
(`migrations/20260345000001_manual_oil_protein_batch_numbers.sql:1-2`). `BFG60.25.07.08` misread as
`BFG6O.25.07.08` therefore breaks the chain silently. For each batch number in the extraction
(`start_oil_bn`, `ibc*_bn`, `raw_material_batches[]`, `raw_material_traceability[].batch_no`,
`ibcs[].oil_bn`): exact match → no flag; no exact match but a case-insensitive or `O`↔`0` / `I`↔`1`
substituted comparison matches → flag naming the near-match, **without auto-correcting**; nothing
close → no flag, since a genuinely new batch number is normal.

Do the lookup with one `select` of candidate batch numbers through the service client and match in
TypeScript — one round trip, no new migration.

## Security invariants

- `validateSession()` fails closed: empty RPC result → 401, RPC error → 503. Never continue on a
  session you could not validate.
- The role allow-list is checked **before** the action switch, for every action including reads.
- `p_uploaded_by` / `p_reviewed_by` come from the validated session, never from the request body.
- The service-role key is used only inside this function — never echoed, returned or logged.
- Never log the API key or the full base64 payload.
- `sheet_type` from the request is only ever an argument to an RPC, never interpolated into SQL or
  used as a table or column name.
- Every `return` goes through `jsonResponse`, including the top-level catch, so CORS headers survive
  the error paths. A function that throws before setting them shows in the browser as an opaque
  "CORS policy" error that looks nothing like the real fault.

## Verify before finishing

- `deno check supabase/functions/extract-oil-sheet/index.ts` if Deno is available here; if it is
  not, say so rather than claiming it passed.
- `npm run test:fleet` passes (hermetic, does not touch `supabase/functions/`, so this only proves
  nothing else broke).
- Grep the finished file and confirm: no `output_config`, no `"thinking"`, no `top_p`, no `top_k`, no
  `claude-opus-5`; `jsonResponse` on every return path including the catch; the retry loop excludes
  400 and 401; the role allow-list is checked before the action switch.
- Confirm every RPC name matches plan 01 exactly: `create_oil_sheet_extraction`,
  `save_oil_sheet_extraction_result`, `fail_oil_sheet_extraction`, `log_oil_sheet_extraction`,
  `check_oil_sheet_ai_budget`, `get_oil_sheet_ai_config`, `get_oil_sheet_extractions`,
  `get_oil_sheet_extraction_by_id`, `update_oil_sheet_extraction_review`,
  `confirm_oil_sheet_extraction`. A typo is invisible until a human deploys and uploads a sheet.

You cannot call Anthropic or Supabase from here. Do not attempt a live extraction test.
