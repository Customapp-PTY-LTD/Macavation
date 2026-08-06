# AI production-sheet ingestion — the database layer

## Context

Factory operators fill in paper GMP production sheets every shift. Two real forms are in use:
**MP02-9 Rev3** (Macadamia Food Grade Production sheet, issued 03.10.2024) and **MP02-12 REV 04**
(Macadamia Cosmetic Oil Production Sheet, issued 18/06/2025). The factory manager is going to
photograph each sheet, upload it once, and have Claude read it — then review and correct the values
before anything is committed.

This plan authors **only the SQL**: the tables that hold an extraction job and its result, the
admin-tunable AI config, the usage log, the RPCs the edge function and the UI will call, and the
RBAC rows. Three follow-up plans build on it:

- `oil-sheet-ai-02-edge-function.md` — the `extract-oil-sheet` edge function that calls Anthropic
- `oil-sheet-ai-03-upload-and-list.md` — the upload screen and extraction list
- `oil-sheet-ai-04-review-and-confirm.md` — the side-by-side review screen and the commit step

Nothing in this plan is user-visible, so it lands safely on its own.

**You cannot apply migrations.** No database credential and no network path to a database exists in
this environment. Author the file only; a human applies it with
`npm run db:apply -- migrations/<file>.sql`. Do not try to connect to Postgres, and do not treat
"unapplied" as a failure.

## Verified facts this plan builds on

Check each of these against the file named before relying on it.

- Migrations live in the repo-root **`migrations/`** directory, not `supabase/migrations/` (which is
  empty). `supabase/config.toml:1-3` records the apply command.
- Filenames must satisfy `npm run migrations:verify` (`scripts/verify-migration-prefixes.mjs:4-10`):
  a 14-digit UTC timestamp prefix, then `_`, then a snake_case name, then `.sql`; unique prefix; no
  subdirectories and no non-`.sql` files. This script is part of `npm run test:fleet`, so a bad
  filename blocks the merge. **There is no baseline-update escape hatch** — the script says so at
  lines 28-30.
- Production sheets are stored today in `public.shift.shift_tracking` (jsonb), under
  `production_sheets[<sheet_type>][]`. See `WebPortal/modules/oil-production/js/oil_production_grid.js:706-717`.
  The table is defined at `migrations/20260226000006_replace_oil_with_new_schema.sql:29-48`.
- The three sheet types the app already knows about are `food_grade_oil`, `protein_powder` and
  `cosmetic_oil` — `WebPortal/modules/oil-production/js/oil_production_grid.js:468` and `:509-558`.
- Batch numbers are **unvalidated free text**. `migrations/20260345000001_manual_oil_protein_batch_numbers.sql:1-2`
  states "Numbers are user-supplied only (no auto sequence)"; the only check is non-empty plus a
  unique constraint. Traceability reads join on exact string equality —
  `migrations/20260339000001_get_oil_batch_ingredients_detail.sql` matches
  `oil_bin_batch.batch_number` and `oil.batch_id` exactly.
- RBAC is three layers and they must move together (`CLAUDE.md:34-39`): `role_features` gates the
  route, `actions`/`role_actions` gates the buttons, `role_permissions` gates RPC EXECUTE.
- The `public.actions` / `public.role_actions` catalogue is created by
  `migrations/20260602100000_create_actions_tables.sql` (tables at `:11` and `:29`). The only oil
  action key seeded there today is `oil.consolidated.manage` at `:59` — copy that INSERT's shape.
- The `role_permissions` grant pattern to copy is the `DO $$ … INSERT INTO public.role_permissions …`
  block at `migrations/20260324000001_unify_oil_batch_number_format.sql:169-179`.

## Work

Author exactly one file: `migrations/<YYYYMMDDHHMMSS>_oil_sheet_ai_extraction.sql`. Pick a timestamp
later than every existing prefix in `migrations/`.

### 1. `public.oil_sheet_extraction`

One row per uploaded sheet.

| column | type | notes |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | |
| `sheet_type` | `varchar(40) NOT NULL` | `food_grade_oil` \| `protein_powder` \| `cosmetic_oil`. **No CHECK constraint** — the rest of the oil schema deliberately leaves status/type app-enforced (see `oil.status` at `20260226000006:106-146`), and a CHECK here would need a migration every time a form is added. |
| `status` | `varchar(20) NOT NULL DEFAULT 'extracting'` | `extracting` \| `extracted` \| `failed` \| `confirmed` |
| `production_date` | `date` | as read off the sheet; null until extracted |
| `file_name` | `varchar(255)` | original filename |
| `s3_file_id` | `varchar(255)` | pointer returned by the existing S3 upload helper |
| `preview_image` | `text` | downscaled JPEG as a `data:` URL, for the review viewer |
| `extracted_data` | `jsonb` | verbatim model output |
| `reviewed_data` | `jsonb` | the manager's corrected version; null until reviewed |
| `validation_flags` | `jsonb NOT NULL DEFAULT '[]'::jsonb` | deterministic checks, see plan 02 |
| `confidence` | `numeric(3,2)` | model self-report, 0.00–1.00 |
| `error_message` | `text` | populated when `status = 'failed'` |
| `shift_id` | `uuid REFERENCES public.shift(id)` | set on confirm |
| `uploaded_by` | `uuid` | |
| `reviewed_by` | `uuid` | |
| `reviewed_at` | `timestamptz` | |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Indexes on `status`, `production_date`, and `created_at DESC`.

`preview_image` holds a base64 data URL of a 2000px-long-edge JPEG — expect roughly 300 KB–1 MB of
text per row. That is deliberate: this project has **no Supabase Storage buckets at all** (verified
by grepping `storage.from(`, `/storage/v1/object`, `createSignedUrl` across the repo — zero hits),
and portal login tokens are not Supabase Auth JWTs (`WebPortal/js/data-functions.js:496-497`), so
the browser is `anon` to Supabase and a bucket would need an `anon`-insert policy. Storing the
preview inline avoids introducing that. Do not add a bucket in this plan.

### 2. `public.oil_sheet_ai_config`

One row per sheet type. This is the table that lets prompts and models be tuned with SQL instead of
a redeploy.

| column | type | notes |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | |
| `sheet_type` | `varchar(40) NOT NULL UNIQUE` | |
| `label` | `varchar(120) NOT NULL` | human-readable, e.g. `Food Grade (MP02-9)` |
| `model` | `varchar(80) NOT NULL DEFAULT 'claude-opus-5'` | |
| `single_pass` | `boolean NOT NULL DEFAULT true` | false = vision pass then structure pass |
| `vision_prompt` | `text` | only read when `single_pass = false` |
| `extraction_prompt` | `text NOT NULL` | the schema + rules; see below |
| `max_tokens` | `integer NOT NULL DEFAULT 16000` | |
| `effort` | `varchar(10) NOT NULL DEFAULT 'high'` | maps to `output_config.effort` |
| `is_active` | `boolean NOT NULL DEFAULT true` | |
| `updated_by` | `uuid` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

The `model` default is `claude-opus-5` because these are handwritten, photocopied, non-aligned forms —
the hardest extraction case there is, and worth starting at the top of the range before tuning down
on measured accuracy. Whether this organisation's Anthropic key can reach that model **cannot be
checked from this environment**; if it cannot, the fix is one `UPDATE oil_sheet_ai_config SET model =
'claude-sonnet-4-6'`, which is exactly why the model is a config row rather than a constant. Note
`claude-sonnet-4-6` is what `portal-assistant` already runs
(`supabase/functions/portal-assistant/index.ts:96`), so it is the known-good fallback.

> **There is deliberately no `temperature` column.** The model this is seeded with,
> `claude-opus-5`, **rejects `temperature` with HTTP 400** — sampling parameters were removed on
> that model family. A column here would invite the edge function to send one. If a future model
> needs it, add the column then.

### 3. `public.oil_sheet_extraction_log`

Append-only audit, one row per Anthropic call.

`id`, `extraction_id uuid REFERENCES public.oil_sheet_extraction(id) ON DELETE CASCADE`,
`sheet_type varchar(40)`, `model varchar(80)`, `input_tokens integer`, `output_tokens integer`,
`estimated_cost_usd numeric(10,6)`, `duration_ms integer`,
`status varchar(20) NOT NULL DEFAULT 'success'` (`success` | `error`), `error_message text`,
`user_id uuid`, `created_at timestamptz NOT NULL DEFAULT now()`. Index on `created_at DESC`.

### 4. Seed `oil_sheet_ai_config`

Three rows. `protein_powder` is seeded with `is_active = false` and a one-line placeholder prompt —
the app has a form for it but no sample sheet was supplied, so a real schema would be guesswork.
Say exactly that in a SQL comment.

The two active prompts each end with the literal instruction **"Return ONLY the JSON object. No
markdown, no code fences, no explanation."** and carry these rules:

- Every number must be numeric — no units, no thousands separators.
- `production_date` must be `YYYY-MM-DD`. The sheets are written `DD/MM/YYYY`.
- Batch numbers exactly as written, preserving spaces, dots and case.
- If a field is blank on the sheet, use `null` — never guess, never carry a value over from a
  neighbouring row.
- Where a cell holds an arithmetic expression (the food-grade sheet's weight column holds entries
  like `7.20+7.01`), return both the literal text and the computed value.
- Set `confidence` between 0 and 1, and list the field paths you were least sure of in
  `low_confidence_fields`.

**`food_grade_oil` — target schema** (MP02-9 Rev3):

```json
{
  "form_code": "MP02-9", "form_revision": "Rev3",
  "production_date": "YYYY-MM-DD", "shift": "string", "shift_supervisor": "string",
  "signature_present": true,
  "batch_number_product_produced": "string", "name_of_product": "string",
  "raw_material_used": "string",
  "start_oil_bn": "string", "start_oil_litre": 0,
  "ibc1_bn": "string", "ibc1_litre": 0,
  "ibc2_bn": "string", "ibc2_litre": 0,
  "ibc3_bn": "string", "ibc3_litre": 0,
  "raw_material_batches": ["string"],
  "raw_material_in": [{ "raw_text": "7.20+7.01", "value_kg": 14.21 }],
  "oil_out":         [{ "raw_text": "24.11",     "value_kg": 24.11 }],
  "cake_out":        [{ "raw_text": "27.66",     "value_kg": 27.66 }],
  "totals": { "raw_material_in_kg": 0, "oil_out_kg": 0, "cake_out_kg": 0 },
  "comments": "string",
  "waste": { "end_of_shift": null, "general_kg": null, "floor_kg": 0, "product_kg": 0 },
  "confidence": 0.0, "low_confidence_fields": ["string"]
}
```

The prompt must state explicitly: **the four columns of the main table have different row counts and
are not aligned row-for-row.** On a real sheet there may be 14 raw-material weights, 9 oil-out
values and 1 cake-out value. Return each column as its own list of the length actually present. Do
not pad, do not truncate, and do not invent a row just to make the lists the same length.

**`cosmetic_oil` — target schema** (MP02-12 REV 04):

```json
{
  "form_code": "MP02-12", "form_revision": "REV 04",
  "production_date": "YYYY-MM-DD", "shift": "string", "shift_supervisor": "string",
  "start_oil_bn": "string", "start_oil_litre": 0,
  "mixes": [{ "mix_number": 1, "crush": 25, "time": "18:07" }],
  "raw_material_traceability": [{ "description": "KERNEL DUST", "batch_no": "1.25.199" }],
  "ibcs": [{ "ibc": 1, "oil_bn": "B0.25.08.02", "literage": 700 }],
  "interruptions": [{ "count": 1, "start": null, "end": null }],
  "recipe":           { "oil_kernel": null, "cracker_dust": 0, "kernel_dust": 0, "crush": 0, "cake": 0 },
  "total_quantities": { "oil_kernel": null, "cracker_dust": 0, "kernel_dust": 0, "crush": 0, "cake": 0 },
  "notes": "string",
  "waste": { "general_kg": 0, "floor_kg": 0, "product_waste_raw": "string", "cake_kg": 0 },
  "oil_from_press": { "raw_text": "string", "filter_kg": 0, "hydraulic_kg": 0 },
  "confidence": 0.0, "low_confidence_fields": ["string"]
}
```

The prompt must state: the mix grid is laid out as **three side-by-side column groups** covering
mixes 1–25, 26–50 and 51–75. Read it column-group by column-group, not left-to-right across the
page, and return only the mixes that actually carry data.

> **Known limitation, record it as a SQL comment next to the seed.** The in-app cosmetic form
> (`WebPortal/modules/oil-production/js/oil_production_grid.js:544-558`) models a *different*
> revision — MP5.2.3 Rev 06, a 15-row time log with crude-kernel/kernel-dust/crush/cracker-dust/cake
> columns. It cannot represent the REV 04 mix grid. The schema above follows the paper sheet that is
> actually in use, and `shift_tracking` is free-form jsonb so it stores it fine; the consequence is
> that the older in-app form will not render a REV 04 sheet back.

### 5. RPCs

All `SECURITY DEFINER`, `SET search_path = public`, returning `jsonb` in the
`{ "success": true, ... }` / `{ "success": false, "error": "..." }` shape the rest of this codebase
uses (see `upsert_oil_production` in `migrations/20260226000005_create_oil_batch_sps.sql:108`).

| function | called by | purpose |
|---|---|---|
| `create_oil_sheet_extraction(p_sheet_type, p_file_name, p_s3_file_id, p_preview_image, p_uploaded_by)` | edge fn | insert with `status='extracting'`, return the new id |
| `save_oil_sheet_extraction_result(p_id, p_extracted_data, p_confidence, p_validation_flags, p_production_date)` | edge fn | set `status='extracted'` and the payload |
| `fail_oil_sheet_extraction(p_id, p_error_message)` | edge fn | set `status='failed'` |
| `log_oil_sheet_extraction(p_extraction_id, p_sheet_type, p_model, p_input_tokens, p_output_tokens, p_estimated_cost_usd, p_duration_ms, p_status, p_error_message, p_user_id)` | edge fn | append to the log |
| `get_oil_sheet_ai_config(p_sheet_type)` | edge fn | one active config row |
| `get_oil_sheet_extractions(p_status, p_sheet_type, p_limit, p_offset)` | UI | list. **Must not select `preview_image`** — it would blow the list payload up by megabytes. |
| `get_oil_sheet_extraction_by_id(p_id)` | UI | full row including `preview_image` |
| `update_oil_sheet_extraction_review(p_id, p_reviewed_data, p_reviewed_by)` | UI | save review edits without confirming |
| `confirm_oil_sheet_extraction(p_id, p_reviewed_data, p_reviewed_by)` | UI | see below |

`confirm_oil_sheet_extraction` is the only one with real logic:

1. Load the extraction; if `status = 'confirmed'` already, return
   `{success:false, error:'Already confirmed'}` — this makes double-submit safe.
2. Resolve the `shift` row for `production_date`: `SELECT … FROM public.shift WHERE shift_date = …`,
   insert one if absent.
3. Read its `shift_tracking`, defaulting to `'{}'::jsonb`. Ensure `production_sheets` is an object
   and `production_sheets[sheet_type]` is an array, then **append** `p_reviewed_data` to that array.
   Mirror `WebPortal/modules/oil-production/js/oil_production_grid.js:706-717` exactly — append,
   never replace, because a shift can legitimately have more than one sheet of a type.
4. Write `shift_tracking` back, set `shift_id`, `reviewed_by`, `reviewed_at = now()`,
   `status = 'confirmed'`, `reviewed_data = p_reviewed_data`.
5. Return `{success:true, shift_id, extraction_id}`.

Do this in SQL rather than by calling `upsert_shift` from the browser: it keeps the read-modify-write
of `shift_tracking` inside one statement, so two managers confirming sheets for the same day cannot
lose each other's entry.

### 6. RBAC

Three layers, all three seeded here. `CLAUDE.md:34-39` warns they must move together; the plan fails
its purpose if it seeds one and leaves the others.

**(a) Route visibility — `features` / `role_features`.** The sidebar and the router both gate on
`Session.get('featureKeys')`, which is loaded from `public.role_features`
(`WebPortal/js/role-menu-config.js:603-628`). Without a feature row the new screen is invisible to
everyone except `super_user` and `admin`, who are hard-coded to bypass the check.

Insert one `public.features` row — key `oil-sheet-ai-grid`, name "AI Production Sheet Ingestion"
(table at `migrations/20260302000001_create_features_tables.sql:6-14`) — then grant it to the roles
listed below using the `DO $$ … FOREACH … ON CONFLICT DO NOTHING` pattern at
`migrations/20260302000003_seed_features.sql:70-95`.

The route key `oil-sheet-ai-grid` is fixed by `oil-sheet-ai-03-upload-and-list.md`; it must match
exactly or the screen will never appear.

**(b) Button gating — `actions` / `role_actions`.** Two action keys, seeded into `public.actions` and
granted in `public.role_actions` following
`migrations/20260602100000_create_actions_tables.sql:59`:

- `oil.sheet.ai_upload` — "Upload a production sheet for AI extraction"
- `oil.sheet.ai_review` — "Review and confirm an extracted production sheet"

**(c) RPC execution — `role_permissions`.** EXECUTE grants for all nine RPCs, using the `DO $$` block
pattern at `migrations/20260324000001_unify_oil_batch_number_format.sql:169-179`.

**All three layers grant to these roles only:** `super_user`, `admin`, `General Manager`, `QA Supervisor`,
`Oil Plant Manager`, `Office Administrator`. These are the roles that hold oil-module access today
per `WebPortal/js/role-menu-config.js:99-110`. **Do not grant to every role.** `CLAUDE.md:38-39`
records that the "grant a new function to every role" pattern in `docs/RBAC_GUIDE.md` is exactly how
the permission layers drifted 186 grants out of step with 2 action keys. Note `Factory Manager` is
kernel-only (`role-menu-config.js:35-47`) and must not be granted.

Finish the migration with `NOTIFY pgrst, 'reload schema';`.

## Security invariants

- Every RPC is `SECURITY DEFINER` with `SET search_path = public` — no exceptions, and no
  unqualified table references inside them.
- No RPC may accept a role, permission or `is_active` flag as a parameter.
- `get_oil_sheet_extractions` must not return `preview_image`.
- Do not add RLS policies granting anything to `anon`. The two existing oil tables that enable RLS
  (`20260226000006:154-167`) grant `ALL` to `service_role` and `SELECT` to `authenticated` only.
  Follow that if you enable RLS at all; these tables are reached exclusively through
  `SECURITY DEFINER` RPCs, which is how `oil_bin_batch` already works
  (`migrations/20260322000001_oil_bin_batch_production.sql:27` enables RLS and creates no policies).

## Verify before finishing

- `npm run migrations:verify` passes — this proves the filename and the directory contents.
- `npm run test:fleet` passes end to end.
- Re-read the file and confirm: no `temperature` column anywhere; no `CREATE POLICY … TO anon`; every
  function is `SECURITY DEFINER`; the file ends with `NOTIFY pgrst, 'reload schema';`.
- Confirm the timestamp prefix you chose is greater than every existing prefix in `migrations/` and
  collides with none — `ls migrations/ | sort | tail -3`.

You cannot execute the SQL, so do not attempt to verify behaviour against a database. Correctness of
the DDL is established by reading it.
