# AI production-sheet ingestion — the database layer

## Context

Factory operators fill in paper GMP production sheets every shift. Two real forms are in use:
**MP02-9 Rev3** (Macadamia Food Grade Production sheet) and **MP02-12 REV 04** (Macadamia Cosmetic
Oil Production Sheet). The factory manager will photograph each sheet, upload it once, have Claude
read it, then review and correct the values before anything is committed.

This plan authors **only the SQL**: the tables holding an extraction job and its result, the
tunable AI config, the usage log and spend cap, the RPCs, and the RBAC rows. Three sibling plans
build the rest — `oil-sheet-ai-02-edge-function.md`, `oil-sheet-ai-03-upload-and-list.md`,
`oil-sheet-ai-04-review-and-confirm.md`.

**You cannot apply migrations.** No database credential and no network path to a database exists in
this environment. Author the file only; a human applies it with
`npm run db:apply -- migrations/<file>.sql`. Do not try to connect to Postgres, and do not treat
"unapplied" as a failure.

> **This is a revision of a plan the review gate blocked** (run `a017ba40`). Five findings, all
> upheld. The corrections are folded in below and each is marked **[was blocked]** so you can see
> why the constraint is there. Do not "simplify" any of them back out.

## The security model — read this first

**[was blocked — finding 1]** Postgres grants `EXECUTE` to `PUBLIC` by default on `CREATE FUNCTION`,
and PostgREST exposes that to `anon`. The anon key in this app is a **shipped public credential**
(`WebPortal/js/macavation-supabase.js:16` is the production project's anon JWT, committed to the
repo). A `SECURITY DEFINER` function with no explicit `REVOKE` is therefore callable by anyone on
the internet, and **RLS does not help** — it neither gates `EXECUTE` nor applies inside a definer's
body. The first version of this plan relied on an RLS statement and would have shipped an
unauthenticated write path into `public.shift.shift_tracking`, the GMP production record.

So, for all nine functions:

- **`service_role` only.** Follow `migrations/20260815130000_whatsapp_pending_commands.sql:236-253`
  exactly — its own section header reads *"GRANTS — service_role only. Never anon, never
  authenticated, never PUBLIC."* Per function, with the full argument-type signature:

  ```sql
  REVOKE ALL   ON FUNCTION public.<fn>(<argtypes>) FROM PUBLIC;
  REVOKE ALL   ON FUNCTION public.<fn>(<argtypes>) FROM anon;
  REVOKE ALL   ON FUNCTION public.<fn>(<argtypes>) FROM authenticated;
  GRANT EXECUTE ON FUNCTION public.<fn>(<argtypes>) TO service_role;
  ```

  The same convention appears in `20260815120000`, `20260815110000` and `20260722130000`.

- **The browser never calls these RPCs.** Every UI call goes through the `extract-oil-sheet` edge
  function, which validates the portal session fail-closed and then talks to the database with the
  service-role key. This is a deliberate departure from the usual browser→PostgREST path in
  `WebPortal/js/data-functions.js:499-518`, which authenticates as `anon`. Plans 02 and 03 are
  written to match.

- **No `role_permissions` rows for these functions.** That table gates the PostgREST path, which is
  now closed to them, so rows would be inert and misleading. Authorization happens in the edge
  function against the `role_name` returned by `assistant_validate_session`. This deliberately
  deviates from `docs/RBAC_NEW_FUNCTION_CHECKLIST.md`; the reason is the paragraph above. Say so in
  a SQL comment so the next reader does not "fix" it.

## Verified facts this plan builds on

Check each against the file named before relying on it.

- Migrations live in repo-root **`migrations/`**, not `supabase/migrations/` (empty). Apply command
  at `supabase/config.toml:3`.
- Filenames must satisfy `npm run migrations:verify` (`scripts/verify-migration-prefixes.mjs:4-10`):
  14-digit UTC prefix, `_`, snake_case name, `.sql`; unique prefix; no subdirectories. Part of
  `npm run test:fleet`, and there is no baseline escape hatch (`:27-30`). The highest existing prefix
  is `20260815130000` — pick something later.
- `public.shift` is defined at `migrations/20260226000006_replace_oil_with_new_schema.sql:29-48`.
  `shift_date` is `NOT NULL`; the only index on it is the **non-unique** `idx_shift_date` (`:47`).
  There is no unique constraint on `shift_date`, so duplicate rows for one day are possible.
- Production sheets are appended to `shift_tracking → production_sheets[<sheet_type>][]` —
  `WebPortal/modules/oil-production/js/oil_production_grid.js:706-717`. Sheet types at `:468` and
  `:509-558`.
- `public.actions` / `public.role_actions` at `migrations/20260602100000_create_actions_tables.sql:11`,
  `:29`, with the oil exemplar INSERT at `:59`.
- `public.features` at `migrations/20260302000001_create_features_tables.sql:6-14`; the
  `role_features` seed pattern at `migrations/20260302000003_seed_features.sql:70-95`.
- The `{success: true} / {success: false, error}` return convention: use a **live** exemplar such as
  the functions in `migrations/20260815130000_whatsapp_pending_commands.sql`. **[was blocked —
  smaller issue]** Do *not* cite `upsert_oil_production`; it is dropped at
  `migrations/20260226000006_replace_oil_with_new_schema.sql:17`.
- The existing AI plumbing to model on — see the next section.

## The near-duplicate to model on

**[was blocked — finding 5]** `migrations/20260716160000_portal_assistant_chat.sql` already contains
this repo's AI plumbing. Build the new tables to mirror it rather than inventing a parallel shape:

| Existing | Line | Mirror it with |
|---|---|---|
| `assistant_client.assistant_model text DEFAULT 'claude-sonnet-4-6'` | `:34` | `oil_sheet_ai_config.model` — same default |
| `assistant_usage_log` (`model`, `input_tokens`, `output_tokens`, `cost_cents`, `latency_ms`, `http_status`, `success`, `error_message`) | `:169` | `oil_sheet_extraction_log` — same column names and types |
| `assistant_record_usage` | `:884` | `log_oil_sheet_extraction` |
| **`assistant_budget`** (`client_guid`, `period_start`, `budget_cents`, `spent_cents`, PK on the pair) | `:152` | `oil_sheet_ai_budget` — same shape, keyed on `period_start` alone (single tenant) |
| **`assistant_check_budget`** | `:832` | `check_oil_sheet_ai_budget` |

The budget gate is not optional. This feature sends a large image plus a large schema prompt on
every upload; without a cap, a stuck retry loop or a bulk backfill can run up real spend unnoticed.

## Work

Author exactly one file: `migrations/<YYYYMMDDHHMMSS>_oil_sheet_ai_extraction.sql`.

### 1. `public.oil_sheet_ai_config`

Create this **first** — `oil_sheet_extraction.sheet_type` references it.

| column | type | notes |
|---|---|---|
| `sheet_type` | `varchar(40) PRIMARY KEY` | |
| `label` | `varchar(120) NOT NULL` | e.g. `Food Grade (MP02-9)` |
| `model` | `varchar(80) NOT NULL DEFAULT 'claude-sonnet-4-6'` | |
| `single_pass` | `boolean NOT NULL DEFAULT true` | |
| `vision_prompt` | `text` | read only when `single_pass = false` |
| `extraction_prompt` | `text NOT NULL` | |
| `max_tokens` | `integer NOT NULL DEFAULT 8192` | |
| `is_active` | `boolean NOT NULL DEFAULT true` | |
| `updated_by` | `uuid` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

**[was blocked — finding 4]** Three unverifiable claims about the Anthropic API were removed:

- The seeded model is **`claude-sonnet-4-6`**, the only model ID this repo demonstrably uses
  (`supabase/functions/portal-assistant/index.ts:96`). The previous draft seeded `claude-opus-5`,
  which appears nowhere in this checkout and could not be verified from it — if wrong, the whole
  feature would have failed on every call until a human ran a manual `UPDATE`. Upgrading later is
  one `UPDATE oil_sheet_ai_config SET model = '<id>'`, which is why this is a config row.
- **There is no `temperature` column and no assertion about temperature.** The earlier draft
  claimed `claude-opus-5` rejects `temperature` with HTTP 400 and recorded that as the schema's
  justification. It is unverifiable here, and the only working Anthropic call in this repo *does*
  send `temperature: 0.2` (`portal-assistant/index.ts:692`). Plan 02 sends the same value; no column
  is needed because nothing varies it per sheet type.
- **There is no `effort` column.** The earlier draft said it "maps to `output_config.effort`". No
  such field appears anywhere in this repo's Anthropic call. Omitted rather than guessed.

### 2. `public.oil_sheet_extraction`

| column | type | notes |
|---|---|---|
| `id` | `uuid PK DEFAULT gen_random_uuid()` | |
| `sheet_type` | `varchar(40) NOT NULL REFERENCES public.oil_sheet_ai_config(sheet_type)` | an FK, not a CHECK — it enforces validity *and* stays extensible by inserting a config row |
| `status` | `varchar(20) NOT NULL DEFAULT 'extracting' CHECK (status IN ('extracting','extracted','failed','confirmed'))` | |
| `production_date` | `date` | null until extracted |
| `file_name` | `varchar(255)` | |
| `s3_file_id` | `varchar(255)` | |
| `preview_image` | `text` | downscaled JPEG as a `data:` URL |
| `extracted_data` | `jsonb` | |
| `reviewed_data` | `jsonb` | |
| `validation_flags` | `jsonb NOT NULL DEFAULT '[]'::jsonb` | |
| `confidence` | `numeric(3,2)` | |
| `error_message` | `text` | |
| `shift_id` | `uuid REFERENCES public.shift(id)` | set on confirm |
| `uploaded_by`, `reviewed_by` | `uuid` | |
| `reviewed_at` | `timestamptz` | |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

Indexes on `status`, `production_date`, `created_at DESC`.

`preview_image` holds ~300 KB–1 MB of base64 per row. That is a deliberate tradeoff against
`BluePrint/supabase-database-rules.md`'s "large JSON updated frequently" guidance: this project has
**no Supabase Storage buckets** (verified — zero hits for `storage.from(`, `/storage/v1/object`,
`createSignedUrl`), and portal tokens are not Supabase Auth JWTs
(`WebPortal/js/data-functions.js:496-497`), so a bucket would need an `anon`-insert policy. The
column is written once and never updated. Do not add a bucket in this plan.

### 3. `public.oil_sheet_extraction_log` and `public.oil_sheet_ai_budget`

`oil_sheet_extraction_log` mirrors `assistant_usage_log` (`20260716160000:169`): `id`,
`extraction_id uuid REFERENCES public.oil_sheet_extraction(id) ON DELETE CASCADE`, `sheet_type`,
`model`, `input_tokens`, `output_tokens`, `cost_cents int`, `latency_ms int`, `http_status int`,
`success boolean NOT NULL DEFAULT true`, `error_message text`, `user_id uuid`,
`created_at timestamptz NOT NULL DEFAULT now()`. Index on `created_at DESC`.

`oil_sheet_ai_budget` mirrors `assistant_budget` (`:152`) minus the tenant column:
`period_start date PRIMARY KEY`, `budget_cents int NOT NULL`, `spent_cents int NOT NULL DEFAULT 0`,
`updated_at timestamptz NOT NULL DEFAULT now()`. Seed the current month with a conservative default
(2000 cents) using the `date_trunc('month', now())::date` + `ON CONFLICT DO NOTHING` pattern at
`:161-166`.

### 4. `updated_at` triggers

**[was blocked — standards finding]** Both mutable tables declare `updated_at` with a default and
nothing that advances it. Add one `BEFORE UPDATE` trigger function
(`NEW.updated_at := now(); RETURN NEW;`) and attach it to `oil_sheet_extraction`,
`oil_sheet_ai_config` and `oil_sheet_ai_budget`. Reuse an existing trigger function if one already
exists in `migrations/` — grep for `set_updated_at` or `handle_updated_at` first and prefer it.

### 5. Seed `oil_sheet_ai_config`

Three rows; `protein_powder` with `is_active = false` and a placeholder prompt, because the app has
a form for it but no sample sheet was supplied and a real schema would be guesswork. Say that in a
SQL comment.

Both active prompts end with **"Return ONLY the JSON object. No markdown, no code fences, no
explanation."** and carry these rules: numbers numeric with no units or separators;
`production_date` as `YYYY-MM-DD` (the sheets are written `DD/MM/YYYY`); batch numbers exactly as
written including spaces, dots and case; blank cells become `null`, never a guess and never a value
carried over from a neighbouring row; where a cell holds an arithmetic expression return both the
literal text and the computed value; set `confidence` 0–1 and list the least-certain field paths in
`low_confidence_fields`.

**`food_grade_oil` (MP02-9 Rev3):**

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

The prompt must state: **the four columns of the main table have different row counts and are not
aligned row-for-row** — 14 raw-material weights against 9 oil-out values and 1 cake-out value is a
normal real sheet. Return each column at the length actually present; do not pad, truncate, or
invent a row to make the lists match.

**`cosmetic_oil` (MP02-12 REV 04):**

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

The prompt must state: the mix grid is **three side-by-side column groups** covering mixes 1–25,
26–50 and 51–75. Read it group by group, not left-to-right across the page, and return only mixes
that carry data.

> **Both forms are a revision ahead of the in-app forms — record this as a SQL comment.**
> **[was blocked — smaller issue]** The in-app cosmetic form is MP5.2.3 Rev 06
> (`oil_production_grid.js:557`) and the in-app food-grade form is MP5.2.3.1 Rev 04 (`:525`). Neither
> matches the paper in use, and the cosmetic one cannot represent the REV 04 mix grid at all. The
> schemas above follow the paper. `shift_tracking` is free-form jsonb so it stores them fine; the
> consequence — for **both** sheet types, not just cosmetic — is that the older in-app forms will not
> render these sheets back.

### 6. RPCs

All `SECURITY DEFINER`, `SET search_path = public`, returning `jsonb` in the `{success: …}` shape,
and all `service_role`-only per the security model above.

| function | purpose |
|---|---|
| `create_oil_sheet_extraction(p_sheet_type, p_file_name, p_s3_file_id, p_preview_image, p_uploaded_by)` | insert with `status='extracting'`, return the id |
| `save_oil_sheet_extraction_result(p_id, p_extracted_data, p_confidence, p_validation_flags, p_production_date)` | set `status='extracted'` |
| `fail_oil_sheet_extraction(p_id, p_error_message)` | set `status='failed'` |
| `log_oil_sheet_extraction(...)` | append to the log **and** add `cost_cents` to `oil_sheet_ai_budget.spent_cents` for the current period |
| `check_oil_sheet_ai_budget(p_estimated_cost_cents)` | mirror `assistant_check_budget` (`20260716160000:832`) |
| `get_oil_sheet_ai_config(p_sheet_type)` | one active config row |
| `get_oil_sheet_extractions(p_status, p_sheet_type, p_limit, p_offset)` | list |
| `get_oil_sheet_extraction_by_id(p_id)` | full row incl. `preview_image` |
| `update_oil_sheet_extraction_review(p_id, p_reviewed_data, p_reviewed_by)` | save edits, status unchanged |
| `confirm_oil_sheet_extraction(p_id, p_reviewed_data, p_reviewed_by)` | see below |

**[was blocked — standards finding]** `get_oil_sheet_extractions` must cap the page size —
`LIMIT LEAST(COALESCE(p_limit, 50), 100)` — and must **not** select `preview_image`, which would add
megabytes per row.

**[was blocked — finding 2] Every `UPDATE` and `DELETE` in this file must carry an explicit `WHERE`
clause naming the primary key.** Write `UPDATE public.oil_sheet_extraction SET … WHERE id = p_id;`
and `UPDATE public.shift SET … WHERE id = v_shift_id;`. An unqualified `UPDATE public.shift SET
shift_tracking = …` rewrites every shift row in the factory's history. There is no reviewer between
this plan and production, so state it rather than assume it.

#### `confirm_oil_sheet_extraction` — the one with real logic

**[was blocked — finding 3]** The earlier draft claimed this design meant "two managers confirming
sheets for the same day cannot lose each other's entry", then described a read followed by a
separate write. Under `READ COMMITTED` that is precisely a lost update. It is also racy on the
shift-row lookup, because `shift.shift_date` has no unique constraint (`20260226000006:47` is a
plain index). The corrected sequence:

1. `SELECT … INTO v_ext FROM public.oil_sheet_extraction WHERE id = p_id FOR UPDATE;`
   Not found → `{success:false, error:'Extraction not found'}`.
   Already `confirmed` → `{success:false, error:'Already confirmed'}`. This makes double-submit safe.
2. `v_date := COALESCE(p_production_date_override, v_ext.production_date);` If it is **null**, return
   `{success:false, error:'Production date is required before confirming'}`. `shift.shift_date` is
   `NOT NULL`, and `oil_sheet_extraction.production_date` is nullable — do not invent a date, and do
   not default to `now()`.
3. Serialise on the date before touching `shift`:
   `PERFORM pg_advisory_xact_lock(hashtext('oil_sheet_confirm:' || v_date::text));`
   This needs no schema change and no new unique index — which matters, because this environment
   cannot check whether duplicate `shift_date` rows already exist in production.
4. Resolve the shift row **deterministically**, since duplicates are possible:
   `SELECT id INTO v_shift_id FROM public.shift WHERE shift_date = v_date ORDER BY created_at, id LIMIT 1 FOR UPDATE;`
   If none, `INSERT INTO public.shift (shift_date, shift_supervisor) VALUES (v_date, …) RETURNING id INTO v_shift_id;`
5. Append in a **single self-referencing UPDATE** — do not read into a variable and write it back:
   ```sql
   UPDATE public.shift
      SET shift_tracking = jsonb_set(
              COALESCE(shift_tracking, '{}'::jsonb),
              ARRAY['production_sheets', v_ext.sheet_type],
              COALESCE(shift_tracking -> 'production_sheets' -> v_ext.sheet_type, '[]'::jsonb)
                  || jsonb_build_array(p_reviewed_data),
              true)
    WHERE id = v_shift_id;
   ```
   Append, never replace — a shift can legitimately carry more than one sheet of a type, which is
   what `oil_production_grid.js:706-717` does.
6. `UPDATE public.oil_sheet_extraction SET status='confirmed', reviewed_data=p_reviewed_data,
   reviewed_by=p_reviewed_by, reviewed_at=now(), shift_id=v_shift_id WHERE id = p_id;`
7. Return `{success:true, shift_id, extraction_id}`.

### 7. RBAC — the two layers that still apply

The third layer, `role_permissions`, does not apply here; see the security model above.

**(a) Route visibility — `features` / `role_features`.** Insert a `public.features` row with key
`oil-sheet-ai-grid` (the route key fixed by plan 03 — it must match exactly), then grant it with the
`DO $$ … FOREACH … ON CONFLICT DO NOTHING` pattern at `migrations/20260302000003_seed_features.sql:70-95`.

**(b) Button gating — `actions` / `role_actions`.** Two keys following
`migrations/20260602100000_create_actions_tables.sql:59`: `oil.sheet.ai_upload` and
`oil.sheet.ai_review`.

**Grant both layers to:** `super_user`, `admin`, `General Manager`, `QA Supervisor`,
`Oil Plant Manager`, `Office Administrator`. **[was blocked — smaller issue]** These are *not* the
complete set of roles with oil access — `PWA Production` also holds `oil-production-grid`
(`WebPortal/js/role-menu-config.js:130`) and is deliberately excluded here, because uploading and
confirming GMP records is a manager action, not a line-operator one. `Factory Manager` is
kernel-only (`:35-47`) and is also excluded. Do not widen this list; `CLAUDE.md:38-39` records that
granting new functions to every role is how this repo's permission layers drifted apart.

Finish with `NOTIFY pgrst, 'reload schema';`.

## Verify before finishing

- `npm run migrations:verify` passes, and `npm run test:fleet` passes end to end.
- `ls migrations/ | sort | tail -3` — confirm your prefix is later than `20260815130000` and unique.
- Grep the finished file and confirm each of these:
  - every `CREATE FUNCTION` has a matching `REVOKE ALL … FROM PUBLIC`, `FROM anon`,
    `FROM authenticated` and `GRANT EXECUTE … TO service_role` — count them; nine functions means
    nine of each;
  - no `GRANT … TO anon` and no `GRANT … TO authenticated` anywhere;
  - every `UPDATE` and `DELETE` has a `WHERE`;
  - no `temperature`, `effort` or `output_config` column or comment;
  - no occurrence of `claude-opus-5`;
  - `LEAST(` appears in `get_oil_sheet_extractions`;
  - the file ends with `NOTIFY pgrst, 'reload schema';`.

You cannot execute the SQL, so do not claim behavioural verification. Correctness of the DDL is
established by reading it.
