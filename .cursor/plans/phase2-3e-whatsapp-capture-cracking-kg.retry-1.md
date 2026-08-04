---
depends_on: phase2-3d-whatsapp-confirm-cancel-flow.md
retry_of: ee1341e0-27e8-4a5e-b05c-8ad55a774d7c
---

# Capture kg cracked from WhatsApp

## Context

This is the command the whole WhatsApp chain exists for: a staff member on the factory floor sends the
day's cracked tonnage from their phone, confirms it, and it lands on the batch's production sheet.

Everything it needs is now in place — verified phone identity (`whatsapp_resolve_staff_user`), a
server-side action gate (`has_action`), a router with an audit log, and a confirm/cancel step.

### Where the number actually goes — verified

Production data lives on `public.kernel` as four JSONB arrays: `cracking_data`, `washing_data`,
`sorting_data`, `packing_data`. Each is an array of **day entries keyed by a `date` field**.

`public.upsert_kernel_production(p_kernel_id uuid, p_day_index integer, p_cracking_data jsonb, p_washing_data jsonb, p_sorting_data jsonb, p_packing_data jsonb, p_finish_production boolean, p_job_card_data jsonb)`
— latest definition at `migrations/20260519120000_job_card_stock_gated_on_approval.sql:86-140`.

**Read this description carefully; an earlier draft of this plan got it wrong and that error was the
main reason the plan was rejected.** For `cracking_data` the RPC does the following:

- It rejects a payload with no `date` (`:132-134`).
- `v_keep_entry := (p_cracking_data - 'date') <> '{}'` (`:136`). If the payload is *only* a date, a
  matching existing entry is **deleted** (`:143-144`) — so the payload must always carry at least one
  non-date key.
- When an entry with the same `date` **string** exists, it does
  `v_cracking := jsonb_set(v_cracking, ARRAY[v_i::text], p_cracking_data)` (`:142`). This **replaces the
  entire day element**. It does **not** merge keys. Every key present on the stored entry and absent
  from the payload is destroyed.
- When no entry has that date string, the payload is **appended** (`:150-152`).
- Date comparison is a plain string comparison of `->> 'date'` (`:140`). Two spellings of the same day
  produce **two entries** for that day.
- It flips `status` from `intake`/`receiving` to `production` when the payload has any non-date key
  (`:244-246`). It does **not** refuse a batch in `qa`, `dispatch` or `complete`.

Two further details:

- **`p_day_index` is dead.** It appears only in the signature (`:88`) and nowhere in the body — the merge
  is purely date-keyed. Pass `NULL`.
- **The kg field is `endqty1`.** `public.kernel_day_kg(jsonb)`
  (`migrations/20260813093000_kernel_day_kg_prefer_endqty1.sql:57-61`) coalesces
  `endqty1 → totalqty → total_qty → 0`. That **field precedence** was settled deliberately by that
  migration and is not to be revisited here. The *semantics* of `endqty1` are **not** settled: the
  investigation doc records at `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md:232-237` that the
  code is silent on what "End Qty" means and that the question "needs operator-level confirmation, not
  a code inference". Do not restate a meaning for `endqty1` as fact in any comment you write (see
  "Claims you must not make" below).

**What the portal form writes into a cracking day entry.** `getProductionStagesSectionData('crack')`
(`WebPortal/modules/modals/modal-production-stages/js/modal_production_stages.js:568-587`) collects
**every** `#ps_crack_*` input into the entry — `startqty1`, `silo1`, `totalqty`, the `total_07/10/13`
slot totals, the `wholes_*` fields, `shell_total`, `shell_carryover`, `shell_fines`, times — and
`enrichProductionStageCalculations` adds `total_output` and `cracking_percentage` (`:100-107`), which the
batch-detail renderer displays (`:1210-1214`, `:1248-1249`, `:1265`, `:1278-1279`). Dates are stored ISO
`YYYY-MM-DD` via `toISO` (`:7-11`), though display code defensively strips a `T` suffix (`:1079`), so
legacy entries may not be byte-for-byte ISO.

**Consequence, and the core constraint of this plan:** a WhatsApp capture must be a
**read-modify-write** of the existing day entry. Writing a fresh five-key payload over a form-entered
day would erase the operator's silo, start, shell and yield figures irreversibly and invisibly.

**A batch number is not a kernel id.** Staff will type something like `Bn 44 26 42`. The mapping is
`public.kernel k JOIN public.batches b ON b.id = k.batch_id`, where `b.batch_id` is the human-readable
number surfaced as `batch_number` by `get_kernel_batches`
(`migrations/20260225000002_create_get_kernel_batches.sql:45`, `:148`).

### Why this is the riskiest thing in the chain

`kernel_day_kg` is read by the dashboard's kg-cracked tiles, Production Trends, the raw-material runway
forecast, the kernel mass balance and the daily digest. A wrong number moves all of them at once, and a
duplicated day entry double-counts because those consumers sum across the array.

Existing cracking data has known quality problems, recorded in
`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`. **Those figures are labelled in the doc itself as
reported and unverified** (`:253-259`), and nothing in this checkout can confirm them. Treat them as
motivation for caution, not as facts to quote. Adding a second capture path into that dataset needs five
safeguards, all specified below: **authorise**, **dry-run before confirm**, **preserve everything already
on the day**, **never silently overwrite a figure**, and **stamp provenance**.

### Claims you must not make

Do not assert any of the following as settled fact in migration comments, function comments, code
comments, replies or commit messages, and do not add them to any doc:

- what `endqty1` means physically (input-side vs output-side, "what the operator types as throughput",
  "start minus silo");
- that `totalqty` is blank *because of* silo carry-over;
- any specific tonnage, row count or percentage from the investigation doc (e.g. 75/120, 39,853,
  3 of 44, uplift figures) as a verified number.

Where you must refer to them, attribute them: "reported, unverified — see
`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`". Correcting or re-scoping the wording of that
doc, or of the comment on `kernel_day_kg`, is a separate human-reviewed action and is **out of scope**
for this plan.

## Scope

**In:** one RPC that captures a day's cracked kg for a batch, and the `CRACK` command wired through the
existing confirm step.

**Out:** every other figure — packed kg, washing, sorting, waste, silo readings. `CRACK` sets exactly
one field on the day entry. Widening it is a separate decision.

**Out:** editing or deleting an already-captured figure over WhatsApp. See the conflict rule.

**Out:** applying the migration or deploying the function.

**Out:** changing `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`, the `kernel_day_kg` comment, or
any other document.

## Work

### 1. `migrations/20260815140000_whatsapp_capture_cracking_kg.sql`

**`public.whatsapp_resolve_kernel_batch(p_batch_number text) RETURNS jsonb`** — `SECURITY DEFINER`,
`service_role` only.

- Match on `b.batch_id`, mirroring the join at `get_kernel_batches`
  (`20260225000002_create_get_kernel_batches.sql:148`), with `k.is_active = true`.
- Compare **whitespace-insensitively and case-insensitively**, because `Bn 44 26 42`, `bn44 26 42` and
  `BN442642` are the same batch to a person typing on a phone: compare
  `upper(regexp_replace(b.batch_id, '\s', '', 'g'))` against the same transform of the input.
- Return the `kernel_id`, the canonical `batch_number`, and `status`.
- **Return a distinct result for "more than one match"** rather than picking one. Ambiguity must reach
  the user, never be resolved by a `LIMIT 1`.

**`public.whatsapp_capture_cracking_kg(p_user_id uuid, p_batch_number text, p_kg numeric, p_date date, p_confirmed boolean DEFAULT false) RETURNS jsonb`**
— `SECURITY DEFINER`, `service_role` only. This is the whole safety envelope, in order:

1. **Authorise.** `IF NOT public.has_action(p_user_id, 'kernel.production_stages.edit') THEN` return a
   `denied` result. That key is already seeded
   (`20260602100000_create_actions_tables.sql:52`) and is the one the production-stages UI gates on. Do
   **not** seed a new key, and do **not** add a `super_user`/`admin` bypass — if those roles should hold
   it, that belongs in `role_actions` as data.

2. **Validate the number.** Reject `p_kg` that is null, not positive, or above a ceiling of
   **50,000 kg**. State in the comment that the ceiling is an **arbitrary typo guard chosen to be far
   above any plausible single day, not a business limit and not derived from any verified figure**. Do
   not justify it with numbers from the investigation doc. Reject a `p_date` that is null or in the
   future (compare against `CURRENT_DATE`).

3. **Resolve the batch.** Not found → a `not_found` result naming what was typed. Ambiguous → an
   `ambiguous` result. Neither writes anything.

4. **Guard the batch state.** `public.kernel.status` is constrained to
   `intake | receiving | production | qa | dispatch | complete`
   (`20260225000000_consolidate_kernel_to_batches_and_kernel.sql:48-50`). Write **only** when the
   resolved status is one of `intake`, `receiving`, `production`. For **any other value** — including
   `qa`, `dispatch`, `complete` and any legacy value not in the constraint list — return a
   `batch_closed` result naming the status and write nothing; a closed batch's mass balance must not
   move over WhatsApp. Note in the comment that `upsert_kernel_production:244-246` will advance an
   `intake`/`receiving` batch to `production`, and that this is the accepted, intended effect.

5. **Pin the date string.** Render the target date once as
   `v_date_iso := to_char(p_date, 'YYYY-MM-DD')` and use that single value for the lookup, the payload
   and the reply. Do **not** use a bare `p_date::text` anywhere — that depends on the `DateStyle` GUC,
   and `upsert_kernel_production` compares the date as a raw string (`:140`), so a different spelling
   appends a second entry for the same day and every dashboard that sums `kernel_day_kg` double-counts
   it.

6. **Locate the existing day entry, and refuse anything ambiguous.** Scan `cracking_data` for the entry
   for that day:
   - An entry is an **exact match** when `entry ->> 'date' = v_date_iso`.
   - An entry is a **loose match** when `btrim(split_part(entry ->> 'date', 'T', 1)) = v_date_iso` but it
     is not an exact match (legacy or timestamped spellings).
   - If there is a loose match and no exact match, return a `date_format_mismatch` result carrying the
     stored raw date string and **write nothing** — writing would append a duplicate day rather than
     update the existing one. Tell the user to use the portal for that day. Same treatment if more than
     one entry matches loosely or exactly: return `date_format_mismatch` (or a `duplicate_day` outcome
     with the same non-writable handling) and write nothing.
   - Otherwise there is at most one exact match; call it `v_existing` (`'{}'::jsonb` when absent).

7. **Refuse to overwrite an existing figure.** If `NULLIF(TRIM(v_existing ->> 'endqty1'), '')` is not
   null, return a `conflict` result carrying the existing value and **write nothing**.
   **This check does not depend on `p_confirmed` and must run identically on both calls.** The form and
   WhatsApp can both write the same day, and silently replacing a figure an operator typed on the sheet
   is the worst outcome available. A conflict is reported, never resolved automatically. `p_confirmed` is
   **not** an override and must never be used to skip this branch. Do not add a WhatsApp override path —
   changing an existing figure stays a portal action, where the full sheet is visible.

8. **Stop here when this is a dry run.**
   `IF p_confirmed IS NOT TRUE THEN RETURN <would_write result>; END IF;`
   A call with `p_confirmed = false` **performs no write of any kind** — no `UPDATE`, no call to
   `upsert_kernel_production`, no status change. It runs steps 1-7 and reports what *would* happen. This
   early return must be the only path by which the write below is skipped, and the write below must be
   unreachable when `p_confirmed` is not true. Put a comment on this line saying exactly that.

9. **Build the payload as a read-modify-write.** Take a row lock first so the read and the write cannot
   straddle a concurrent form save:
   `PERFORM 1 FROM public.kernel WHERE id = v_kernel_id AND is_active = true FOR UPDATE;`
   (this is a lock only — it is not a write to `public.kernel`, and it holds for the duration of the
   transaction, including the `upsert_kernel_production` call). Then:

   ```
   v_payload := v_existing || jsonb_build_object(
       'date',        v_date_iso,
       'endqty1',     <kg as text>,
       'source',      'whatsapp',
       'captured_by', p_user_id,
       'captured_at', <now() as text>
   );
   ```

   **Every key already on `v_existing` must survive into `v_payload`.** This is mandatory, because
   `upsert_kernel_production` replaces the whole day element (`:142`) rather than merging: without the
   `v_existing ||` base, a WhatsApp capture would wipe `startqty1`, `silo1`, `totalqty`, the slot and
   `wholes_*` totals, `shell_*`, `total_output` and `cracking_percentage` for that date. Say that in the
   function comment. Do not compute, re-derive or blank any of those keys — copy them through untouched.

   `v_payload` always contains non-date keys, so the delete branch at `:143-144` is never reached; note
   that in the comment as the reason `endqty1` must never be built as an empty string.

   Write `endqty1` as a **string**, matching how the form's values are stored — `kernel_day_kg` does
   `NULLIF(TRIM(p_elem ->> 'endqty1'), '')::numeric`, so it parses text.

   **The three provenance keys are not optional.** `kernel_day_kg` reads only `endqty1`, so they are
   inert to every existing consumer, but they make WhatsApp-captured rows identifiable — a capture that
   adds only `endqty1` to an otherwise empty day cannot be told apart from a data-entry error by any
   downstream check. Note that consequence in the function comment, without asserting anything about
   what `endqty1` means or quoting figures from the investigation doc.

10. **Write** via
    `public.upsert_kernel_production(p_kernel_id := v_kernel_id, p_day_index := NULL, p_cracking_data := v_payload)`
    and pass **no other stage argument** — leave `p_washing_data`, `p_sorting_data`, `p_packing_data`,
    `p_finish_production` and `p_job_card_data` at their defaults. Do not write to `public.kernel`
    directly — that RPC owns the merge, the status transitions and the job-card gating, and bypassing it
    would skip all three. There must be **exactly one** call site of `upsert_kernel_production` in the
    file. If it returns `success = false`, return that message as a non-writable `error` result rather
    than raising.

11. **Return** a result carrying the canonical batch number, the date string, the kg written and the
    outcome, so the router can compose an accurate reply without re-querying. Use distinct outcome
    values, at least: `denied`, `invalid_kg`, `invalid_date`, `not_found`, `ambiguous`, `batch_closed`,
    `date_format_mismatch`, `conflict`, `would_write`, `written`, `error`. `would_write` and `written`
    must be distinguishable — `would_write` means nothing was saved.

Every branch returns a structured `jsonb` with an explicit outcome — never raise. A raised exception in
the webhook path costs the message.

Grant both functions to `service_role` only, with the same
`REVOKE ALL … FROM PUBLIC, anon, authenticated` treatment and the same reasoning comment as the rest of
the WhatsApp chain. Follow `docs/RBAC_NEW_FUNCTION_CHECKLIST.md`; grant to no portal role. End with
`NOTIFY pgrst, 'reload schema';`.

### 2. `supabase/functions/whatsapp-inbound/index.ts`

Add one verb and register one staged handler. Do not restructure the router: the existing comments at
`:281-286` and `:327-333` say a new command is added by one entry in `COMMAND_HANDLERS` (`:445-453`) and
one in `STAGED_COMMAND_HANDLERS` (`:341-344`).

**`CRACK <batch> <kg> [date]`** — e.g. `CRACK Bn 44 26 42 6900`. Parsing has to cope with batch numbers
containing spaces, so parse from the **end**, not the start: the last token is the kg (or the last two
are kg and an ISO date), and everything between the verb and that is the batch number. Accept
`2026-08-15` as an optional trailing ISO date; default to today. Accept a kg written with thousands
separators or decimals (`6900`, `6,900`, `6900.5`) by stripping separators before parsing. Send the date
to the RPC as a `YYYY-MM-DD` string.

Flow:

1. Call `whatsapp_capture_cracking_kg` with `p_confirmed := false` — a **dry run** that performs all the
   validation and returns what *would* happen **without writing anything**.
2. Treat **every** outcome other than `would_write` as non-writable (`denied`, `invalid_kg`,
   `invalid_date`, `not_found`, `ambiguous`, `batch_closed`, `date_format_mismatch`, `conflict`,
   `error`): reply with that specific reason and stage nothing. Log the audit row with `denied` for an
   authorisation refusal and `error` for the rest — `ok | unknown_command | not_enrolled | denied |
   error` are the only values the CHECK constraint allows
   (`20260815120000_whatsapp_command_log.sql:33-34`; `CommandOutcome` at `index.ts:242`), so do not
   invent new ones. Unrecognised or missing outcomes fall into the same non-writable bucket — never
   default to staging.
3. On `would_write`, `whatsapp_stage_pending_command` with command `CRACK`, the resolved payload
   (kernel-resolving inputs: canonical batch number, ISO date string, kg), and a `summary` that is the
   **exact sentence sent to the user** — canonical batch number, date, and the number with thousands
   separators, e.g.
   `Log 6,900 kg cracked on batch Bn 44 26 42 for 2026-08-15? Reply YES or NO.` Echoing the *canonical*
   batch number is what catches a mistyped batch.
4. Register `CRACK` in the `STAGED_COMMAND_HANDLERS` map the previous plan left empty. On `YES`,
   `whatsapp_take_pending_command` returns the payload; call `whatsapp_capture_cracking_kg` again with
   `p_confirmed := true` and reply with the confirmed result. The confirm reply must be driven by the
   second call's outcome: only `written` may be reported as saved; a `conflict`, `denied` or
   `batch_closed` at confirm time must be reported as *not* saved, with the reason.

Re-running the full RPC on confirm — rather than trusting the staged payload — is deliberate: the
authorisation, batch-state and conflict checks are re-evaluated at write time, so a permission revoked
or a figure entered on the form during those ten minutes is still caught. This only holds because the
conflict check in step 7 ignores `p_confirmed`.

Add `CRACK` to `HELP_COMMAND_LIST` (`index.ts:305-308`) with one example line. Keep the missing-RPC
degradation (`isMissingRpc`) from the earlier plans.

## Guardrails

- **You cannot apply the migration or deploy the function.** Author both; a human applies with
  `npm run db:apply -- migrations/<file>.sql` and deploys with
  `supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`.
- **`p_confirmed := false` writes nothing.** The dry run must not reach `upsert_kernel_production`.
- **`p_confirmed` is not an override.** The conflict check, the authorisation check and the batch-state
  check run on both calls, with identical effect.
- **Never write without a confirmation.** `p_confirmed := true` may only ever be reached from the `YES`
  path.
- **Never overwrite an existing `endqty1`.** No override verb, no force flag, no "replace" keyword.
- **Never drop a key the operator entered.** The payload is `existing_entry || {…}`; nothing already on
  the day entry may be removed, blanked or recomputed.
- **Never append a second entry for a day that already exists in another date spelling.** Refuse instead.
- **Do not write to `public.kernel` directly.** Go through `upsert_kernel_production`. (A
  `SELECT … FOR UPDATE` row lock is not a write and is permitted.)
- **Do not modify `upsert_kernel_production`, `kernel_day_kg`, or any existing migration.**
  Forward-only. In particular do not "improve" `kernel_day_kg` to read a new field — its coalesce order
  was settled by a documented decision.
- **Do not seed a new action key.** Use `kernel.production_stages.edit`.
- **Do not add a role-name bypass.**
- **Do not widen scope to packed kg, washing, sorting or waste**, and do not touch
  `p_job_card_data`, `p_finish_production`, or the other three stage arrays.
- **Do not grant either new function to `anon` or `authenticated`.**
- **Do not assert unverified claims** — see "Claims you must not make". No figure from the investigation
  doc appears as a fact, and no statement of what `endqty1` physically means appears anywhere you write.
- **Do not edit any file under `docs/`.**
- Never make the webhook return non-2xx; never dispatch from `value.statuses[]`.
- No new dependency; nothing under `WebPortal/`; `send-whatsapp-message` untouched.

## Acceptance criteria

1. One new migration, `migrations/20260815140000_whatsapp_capture_cracking_kg.sql`, defining
   `whatsapp_resolve_kernel_batch` and `whatsapp_capture_cracking_kg`, both `SECURITY DEFINER`.
2. **Grep-checkable:** both are granted `TO service_role`; the file contains no `GRANT` of either to
   `anon`, `authenticated` or `PUBLIC`.
3. `whatsapp_capture_cracking_kg` calls `public.has_action(p_user_id, 'kernel.production_stages.edit')`
   and returns a denied outcome when false. The file contains no new `INSERT INTO public.actions`.
4. **Grep-checkable:** the file contains no occurrence of `super_user` — no role-name bypass.
5. It writes only via `upsert_kernel_production`, at **exactly one** call site. **Grep-checkable:** the
   file contains no `UPDATE public.kernel` and no `INSERT INTO public.kernel`.
6. The payload includes `"source"`, `"captured_by"` and `"captured_at"` alongside `date` and `endqty1`,
   and `endqty1` is written as a string.
7. It sets **only** `endqty1` among the tonnage fields, and preserves everything else: the payload is
   built as `<existing entry> || jsonb_build_object(…)`, and the file assigns **no new value** to
   `startqty1`, `silo1`, `totalqty`, `total_output` or `cracking_percentage` (they may only pass through
   from the existing entry). **Grep-checkable:** the only stage argument passed to
   `upsert_kernel_production` is `p_cracking_data`; no `p_washing_data`, `p_sorting_data`,
   `p_packing_data`, `p_finish_production` or `p_job_card_data` argument is supplied.
8. The conflict branch triggers whenever the exact-match entry for that date has a non-blank `endqty1`,
   **regardless of `p_confirmed`**, and returns the existing value without writing.
9. **Grep-checkable:** `p_confirmed` is used only (a) in the signature and (b) in the single early-return
   guard `IF p_confirmed IS NOT TRUE THEN RETURN …`. It appears in no other condition — in particular not
   in the conflict, authorisation or batch-state conditions.
10. A call with `p_confirmed = false` reaches no write path: the `upsert_kernel_production` call site and
    the `FOR UPDATE` lock are both after the early return, and the returned outcome is `would_write`,
    distinct from `written`.
11. `whatsapp_resolve_kernel_batch` compares whitespace- and case-insensitively, and returns a distinct
    ambiguous outcome instead of using `LIMIT 1`. **Grep-checkable:** no `LIMIT 1` in its body.
12. `p_kg` is rejected when null, non-positive, or above 50,000; a null or future `p_date` is rejected.
13. **Grep-checkable:** the date used for lookup, payload and reply comes from
    `to_char(p_date, 'YYYY-MM-DD')`; the file contains no `p_date::text`.
14. A day entry whose stored `date` matches the target day only loosely (e.g. `2026-08-15T00:00:00`, or a
    non-ISO spelling), or more than one matching entry, produces a non-writable outcome carrying the
    stored raw date string — never an append and never a write.
15. Writes are permitted only when the resolved `kernel.status` is `intake`, `receiving` or `production`;
    every other value (`qa`, `dispatch`, `complete`, or anything unexpected) returns a non-writable
    outcome naming the status.
16. Every branch returns `jsonb`; no `RAISE EXCEPTION` in either function.
17. In the edge function: `CRACK` parses the kg from the **end** of the message so batch numbers with
    spaces work, and `CRACK Bn 44 26 42 6900` resolves batch `Bn 44 26 42` with 6900 kg.
18. The edge function stages **only** on outcome `would_write`; every other outcome, including an
    unrecognised one, replies with the reason and stages nothing.
19. The confirm path calls `whatsapp_capture_cracking_kg` a **second** time with `p_confirmed := true`
    rather than writing from the staged payload, and reports "saved" only for outcome `written`.
20. `p_confirmed := true` appears in exactly one place — the `YES` handler.
21. The staged summary contains the canonical batch number returned by the resolver, not the raw text the
    user typed.
22. No new `whatsapp_command_log.outcome` value is used beyond `ok`, `unknown_command`, `not_enrolled`,
    `denied`, `error`.
23. **Grep-checkable:** neither changed file contains `75 of 120`, `39,853`, `114.7`, `80,955`, or a
    statement that `endqty1` is what the operator types / is an input-side or output-side measure. Any
    reference to the investigation doc is marked as reported and unverified.
24. Exactly two files change — the new migration and `supabase/functions/whatsapp-inbound/index.ts`. No
    existing migration modified, nothing under `docs/` or `WebPortal/` modified, no new dependency.
    `npm run test:fleet` passes, including `migrations:verify`.
