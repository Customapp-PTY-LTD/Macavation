---
depends_on: phase2-3d-whatsapp-confirm-cancel-flow.md
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
— latest definition at `migrations/20260519120000_job_card_stock_gated_on_approval.sql:86-140` — merges
a supplied stage payload into the matching date entry, replacing it, or appends when the date is new
(`:131-140`). It rejects a payload with no `date` (`:132-134`).

Two details worth knowing before using it:

- **`p_day_index` is dead.** It appears only in the signature (`:88`) and nowhere in the body — the merge
  is purely date-keyed. Pass `NULL`.
- **The kg field is `endqty1`.** `public.kernel_day_kg(jsonb)`
  (`migrations/20260813093000_kernel_day_kg_prefer_endqty1.sql:57-61`) coalesces
  `endqty1 → totalqty → total_qty → 0`, and that precedence was settled deliberately: `endqty1` is what
  the operator types as the day's throughput, and `totalqty` is left blank whenever there is silo
  carry-over.

**A batch number is not a kernel id.** Staff will type something like `Bn 44 26 42`. The mapping is
`public.kernel k JOIN public.batches b ON b.id = k.batch_id`, where `b.batch_id` is the human-readable
number surfaced as `batch_number` by `get_kernel_batches`
(`migrations/20260225000002_create_get_kernel_batches.sql:42`, `:147-149`).

### Why this is the riskiest thing in the chain

`kernel_day_kg` is read by the dashboard's kg-cracked tiles, Production Trends, the raw-material runway
forecast, the kernel mass balance and the daily digest. A wrong number moves all of them at once.

The existing data already has quality problems, recorded in
`docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`: **75 of 120 cracking day-rows carry no tonnage at
all** in any candidate field, one row records 39,853 kg against a 12,309 kg batch, and the identity
`startqty1 − silo1 = endqty1` fails on 3 of 44 testable rows. Adding a second capture path into that
dataset needs three safeguards, all specified below: **authorise**, **never silently overwrite**, and
**stamp provenance**.

## Scope

**In:** one RPC that captures a day's cracked kg for a batch, and the `CRACK` command wired through the
existing confirm step.

**Out:** every other figure — packed kg, washing, sorting, waste, silo readings. `CRACK` writes exactly
one field. Widening it is a separate decision.

**Out:** editing or deleting an already-captured figure over WhatsApp. See the conflict rule.

**Out:** applying the migration or deploying the function.

## Work

### 1. `migrations/20260815140000_whatsapp_capture_cracking_kg.sql`

**`public.whatsapp_resolve_kernel_batch(p_batch_number text) RETURNS jsonb`** — `SECURITY DEFINER`,
`service_role` only.

- Match on `b.batch_id`, mirroring the join at `get_kernel_batches`
  (`20260225000002_create_get_kernel_batches.sql:147-149`), with `k.is_active = true`.
- Compare **whitespace-insensitively and case-insensitively**, because `Bn 44 26 42`, `bn44 26 42` and
  `BN442642` are the same batch to a person typing on a phone: compare
  `upper(regexp_replace(b.batch_id, '\s', '', 'g'))` against the same transform of the input.
- Return the `kernel_id`, the canonical `batch_number`, and `status`.
- **Return a distinct result for "more than one match"** rather than picking one. Ambiguity must reach
  the user, never be resolved by a `LIMIT 1`.

**`public.whatsapp_capture_cracking_kg(p_user_id uuid, p_batch_number text, p_kg numeric, p_date date, p_confirmed boolean DEFAULT false) RETURNS jsonb`**
— `SECURITY DEFINER`, `service_role` only. This is the whole safety envelope, in order:

1. **Authorise.** `IF NOT public.has_action(p_user_id, 'kernel.production_stages.edit') THEN` return a
   `denied` result. That key is already seeded and is the one the production-stages UI gates on. Do
   **not** seed a new key, and do **not** add a `super_user`/`admin` bypass — if those roles should hold
   it, that belongs in `role_actions` as data.
2. **Validate the number.** Reject `p_kg` that is null, not positive, or above a sane ceiling. Use
   **50,000 kg** as the ceiling and state in the comment that it is a typo guard, not a business limit —
   the largest defensible day-row in the investigation doc is an order of magnitude below it, and the
   known-bad row is 39,853. Reject a `p_date` in the future.
3. **Resolve the batch.** Not found → a `not_found` result naming what was typed. Ambiguous → an
   `ambiguous` result. Neither writes anything.
4. **Refuse to overwrite.** Read the existing `cracking_data` entry for `p_date`. If it already has a
   non-blank `endqty1` **and** `p_confirmed` is false, return a `conflict` result carrying the existing
   value. **This is the most important rule in the plan:** the form and WhatsApp can both write the same
   day, and silently replacing a figure an operator typed on the sheet is the worst outcome available. A
   conflict is reported, never resolved automatically. Do not add a WhatsApp override path — changing an
   existing figure stays a portal action, where the full sheet is visible.
5. **Write** via `public.upsert_kernel_production(p_kernel_id := …, p_day_index := NULL, p_cracking_data := v_payload)`.
   Do not write to `public.kernel` directly — that RPC owns the merge, the status transitions and the
   job-card gating, and bypassing it would skip all three.

   The payload carries the date, the figure, and provenance:

   ```json
   {
     "date": "2026-08-15",
     "endqty1": "6900",
     "source": "whatsapp",
     "captured_by": "<user uuid>",
     "captured_at": "<timestamptz>"
   }
   ```

   **The three provenance keys are not optional.** `kernel_day_kg` reads only `endqty1`, so they are
   inert to every existing consumer, but they make WhatsApp-captured rows identifiable — which matters
   because a bare `endqty1` with no `startqty1`/`silo1` cannot satisfy the
   `startqty1 − silo1 = endqty1` identity that the investigation doc uses to spot bad rows. Without
   provenance these captures would be indistinguishable from data-entry errors. Note that consequence in
   the function comment.

   Write `endqty1` as a **string**, matching how the form's values are stored — `kernel_day_kg` does
   `NULLIF(TRIM(p_elem ->> 'endqty1'), '')::numeric`, so it parses text.

6. **Return** a result carrying the canonical batch number, the date, the kg written, and the outcome, so
   the router can compose an accurate reply without re-querying.

Every branch returns a structured `jsonb` with an explicit outcome — never raise. A raised exception in
the webhook path costs the message.

Grant both functions to `service_role` only, with the same
`REVOKE ALL … FROM PUBLIC, anon, authenticated` treatment and the same reasoning comment as the rest of
the WhatsApp chain. Follow `docs/RBAC_NEW_FUNCTION_CHECKLIST.md`; grant to no portal role. End with
`NOTIFY pgrst, 'reload schema';`.

### 2. `supabase/functions/whatsapp-inbound/index.ts`

Add one verb and register one staged handler.

**`CRACK <batch> <kg> [date]`** — e.g. `CRACK Bn 44 26 42 6900`. Parsing has to cope with batch numbers
containing spaces, so parse from the **end**, not the start: the last token is the kg (or the last two
are kg and an ISO date), and everything between the verb and that is the batch number. Accept `2026-08-15`
as an optional trailing ISO date; default to today. Accept a kg written with thousands separators or
decimals (`6900`, `6,900`, `6900.5`) by stripping separators before parsing.

Flow:

1. Call `whatsapp_capture_cracking_kg` with `p_confirmed := false` — a **dry run** that performs all the
   validation and returns what *would* happen without writing.
2. On any non-writable outcome (`denied`, `not_found`, `ambiguous`, `conflict`, validation failure) reply
   with that specific reason and stage nothing. Log the audit row with `denied` for an authorisation
   refusal and `error` for the rest — those are the only values the CHECK constraint allows, so do not
   invent new ones.
3. On a writable outcome, `whatsapp_stage_pending_command` with command `CRACK`, the resolved payload,
   and a `summary` that is the **exact sentence sent to the user** — canonical batch number, date, and
   the number with thousands separators, e.g.
   `Log 6,900 kg cracked on batch Bn 44 26 42 for 2026-08-15? Reply YES or NO.` Echoing the *canonical*
   batch number is what catches a mistyped batch.
4. Register `CRACK` in the staged-handler map the previous plan left empty. On `YES`,
   `whatsapp_take_pending_command` returns the payload; call `whatsapp_capture_cracking_kg` again with
   `p_confirmed := true` and reply with the confirmed result.

Re-running the full RPC on confirm — rather than trusting the staged payload — is deliberate: the
authorisation and conflict checks are re-evaluated at write time, so a permission revoked or a figure
entered on the form during those ten minutes is still caught.

Add `CRACK` to the `HELP` reply with one example line. Keep the missing-RPC degradation from the earlier
plans.

## Guardrails

- **You cannot apply the migration or deploy the function.** Author both; a human applies with
  `npm run db:apply -- migrations/<file>.sql` and deploys with
  `supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`.
- **Never write without a confirmation.** `p_confirmed := true` may only ever be reached from the `YES`
  path.
- **Never overwrite an existing `endqty1`.** No override verb, no force flag, no "replace" keyword.
- **Do not write to `public.kernel` directly.** Go through `upsert_kernel_production`.
- **Do not modify `upsert_kernel_production`, `kernel_day_kg`, or any existing migration.**
  Forward-only. In particular do not "improve" `kernel_day_kg` to read a new field — its coalesce order
  was settled by a documented decision.
- **Do not seed a new action key.** Use `kernel.production_stages.edit`.
- **Do not add a role-name bypass.**
- **Do not widen scope to packed kg, washing, sorting or waste**, and do not touch
  `p_job_card_data`, `p_finish_production`, or the other three stage arrays.
- **Do not grant either new function to `anon` or `authenticated`.**
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
5. It writes only via `upsert_kernel_production`. **Grep-checkable:** the file contains no
   `UPDATE public.kernel` and no `INSERT INTO public.kernel`.
6. The payload includes `"source"`, `"captured_by"` and `"captured_at"` alongside `date` and `endqty1`,
   and `endqty1` is written as a string.
7. It sets **only** `endqty1` — the file contains no `washing_data`, `sorting_data`, `packing_data`,
   `p_finish_production` or `p_job_card_data` assignment, and no `startqty1`/`silo1`/`totalqty` write.
8. The conflict branch triggers when an existing entry for that date has a non-blank `endqty1` and
   `p_confirmed` is false, and returns the existing value without writing.
9. `whatsapp_resolve_kernel_batch` compares whitespace- and case-insensitively, and returns a distinct
   ambiguous outcome instead of using `LIMIT 1`. **Grep-checkable:** no `LIMIT 1` in its body.
10. `p_kg` is rejected when null, non-positive, or above 50,000; a future `p_date` is rejected.
11. Every branch returns `jsonb`; no `RAISE EXCEPTION` in either function.
12. In the edge function: `CRACK` parses the kg from the **end** of the message so batch numbers with
    spaces work, and `CRACK Bn 44 26 42 6900` resolves batch `Bn 44 26 42` with 6900 kg.
13. The confirm path calls `whatsapp_capture_cracking_kg` a **second** time with `p_confirmed := true`
    rather than writing from the staged payload.
14. `p_confirmed := true` appears in exactly one place — the `YES` handler.
15. The staged summary contains the canonical batch number returned by the resolver, not the raw text the
    user typed.
16. No new `whatsapp_command_log.outcome` value is used beyond `ok`, `unknown_command`, `not_enrolled`,
    `denied`, `error`.
17. Exactly two files change. No existing migration modified. No new dependency. `npm run test:fleet`
    passes, including `migrations:verify`.
