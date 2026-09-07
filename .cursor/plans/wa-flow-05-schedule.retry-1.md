---
depends_on: wa-flow-04-weekly-monthly-senders.md
retry_of: 7a3ce52a-26e4-4fc7-a32d-ed8505ddbb56
---

# WhatsApp: put the daily, weekly and monthly senders on a schedule

## Context

`send-daily-production-report` and `send-period-report` both exist as edge functions a human can
call by hand. Nothing calls either automatically. Every "sends at 06:00" / "sends at 17:00" line
in this codebase — including this plan's own predecessors — describes an intention, not a fact.
`evaluate-stock-alerts-cron/index.ts:4-6` states this explicitly about itself, after correcting an
earlier version of its own comment that falsely claimed a schedule existed:

> *"NOT SCHEDULED, despite the name. This header used to claim 'Cron: 0 7,12,17 * * * SAST'. No
> such schedule was ever created."*

This plan is what makes the claim true for the report senders specifically.

## What is verifiable from this checkout, and what is not — read this before writing the header comment

Verifiable from the files in this checkout, and safe to state as fact in the migration header:

- `migrations/20260901120000_auto_seed_production_daily_cron.sql` is the **only** file in this repo
  that calls `cron.schedule` (grep `cron.schedule` — every other hit is prose in an edge-function
  comment). It schedules exactly two jobs: `reseed-production-daily-hourly` (`5 * * * *`) and
  `reseed-production-daily-nightly` (`20 23 * * *`), both at `:268-278`.
- `net.http_post` appears nowhere in `migrations/`. The only occurrence in the repo is an example
  in `BluePrint/supabase-database-rules.md:448`.
- Both senders read `SUPABASE_URL` from the Deno runtime env
  (`send-daily-production-report/index.ts:68`, `send-period-report/index.ts:73`). That is not
  reachable from SQL, and there is no SQL-visible per-environment config table in this repo.
- The same migration files are applied to prod as to dev: `npm run db:apply-prod`
  (`scripts/apply-migration-prod.mjs`) and `npm run db:apply-pending-prod`
  (`scripts/apply-pending-prod-migrations.mjs`, which links `--project-ref sofanhfpxifgdtooefzq`).

**NOT verifiable from this checkout — do not write any of it into the migration, the verifier, or
your report as a settled measurement.** You have no database or network access. Specifically, do
**not** state that `pg_net`, `pg_cron` or `supabase_vault` are enabled, do **not** state their
versions, do **not** state that a Vault secret exists, and do **not** state how many rows
`cron.job` currently holds. A previous version of this plan asserted all of those as "confirmed
live on dev on 2026-09-07"; even if that was true of dev at that moment it is unverifiable here and
says nothing about prod. Everything in that category becomes either (a) an idempotent statement in
the migration, or (b) an **apply-time guard that raises with a message naming the missing
pre-step** — never a claim in a comment.

## Read this first — what is already here, and where to read it

### The scheduling precedent — `migrations/20260901120000_auto_seed_production_daily_cron.sql`

Read the whole file. Its reasoning transfers even though the mechanism (SQL function vs. HTTP call)
differs:

- `CREATE EXTENSION IF NOT EXISTS pg_cron;` at `:71` — an idempotent extension line inside the
  migration is this repo's established way of not depending on an unverified per-environment
  measurement. Do the same for `pg_net` (contract 6).
- A **named SQL wrapper function**, not inline SQL in `cron.schedule`'s command string, "so the
  cron command string is short enough to read in `cron.job`" (`:200-203`). Follow this: one
  wrapper per job.
- The wrapper is `SECURITY DEFINER` with `SET search_path = public` (`:214-215`) **and is locked
  down immediately after** (`:252-253`):
  `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated;` then
  `GRANT EXECUTE ON FUNCTION ... TO service_role;`. This is not optional decoration — see
  contract 2.
- `cron.schedule(jobname, schedule, command)` upserts on `jobname`, so re-running the migration
  rewrites the job rather than stacking duplicates. Useful, but pick a stable jobname first time.
- Times are **UTC**; SAST is UTC+2, with no daylight saving.
- Its final verification `DO` block (`:390-428`) uses `RAISE EXCEPTION` freely so a partial apply
  fails loudly instead of reporting a false success. Mirror that shape (contract 7).

### The SQL style the verifier depends on — `migrations/20260908090000_period_report_senders.sql`

This is wa-flow-04's migration and it is already on this branch. Its functions are declared
`CREATE OR REPLACE FUNCTION public.<name>(<args>)` ... `AS $fn$ ... $fn$;` (`:65-73`, `:110-113`,
`:153-156`) and its REVOKE/GRANT pairs are at `:177-184`. Your new wrapper functions **must** use
the literal `$fn$` dollar-quote tag in exactly that form, because deliverable 2 isolates each
function body with the `isolateSqlFunction` idiom, which searches for `AS $fn$` and the closing
`$fn$;`. The cron precedent uses `AS $$` instead — do **not** copy that part of it, or your own
verifier cannot scope its assertions and will fail.

### The two functions being scheduled

- `supabase/functions/send-daily-production-report/index.ts`
  - Auth: `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`, constant-time compared, before any
    body parsing (`:155-162`).
  - With an **empty body** it resolves the date from `report_sast_today()` (`:183-194`) — i.e.
    **today** in SAST.
  - It then calls `reseed_data_production_daily` for that one date itself (`:196-213`), so it
    refreshes its own figures and has **no ordering dependency on the nightly reseed cron job**.
  - It returns `{skipped:'no_production'}` and sends nothing unless `has_production` is true
    (`:224-226`), and `has_production` is `(cracked > 0 OR packed > 0)` **for that same date**
    (`migrations/20260825091000_daily_production_report.sql:330`).
  - Its own header documents it as the **17:00 SAST** report with intended cron `0 15 * * *`
    (`:2,6`), and `20260825091000_daily_production_report.sql:7,290` says the same.
  - Consequence, and the reason this plan's daily time changed: at 06:00 SAST the current SAST day
    has had no factory capture, so a `0 4 * * *` job with body `{}` would skip essentially every
    morning, silently. See contract 1.
- `supabase/functions/send-period-report/index.ts`
  - Same constant-time service-key gate (`:146-153`).
  - Reads `body?.p_kind` (`:167`) through `normalisePeriodKind`, which accepts only
    `week|weekly|month|monthly` and 400s otherwise (`:84-89`, `:168-170`).
  - Resolves `latest_published_instance(p_period_type)` and returns
    `{skipped:'no_published_instance'}` when there is none (`:172-186`) — a normal state, not an
    error. It does **not** call any reseed, so its dependency is a published report instance, not
    same-day factory capture. This is why weekly/monthly keep the 06:00 SAST slot.

### Times

`report_sast_today()` (`migrations/20260825090000_report_subscriptions_and_staff.sql:49`) returns
`(current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date`. SAST is UTC+2 year-round. For every
time this plan schedules, adding 2 hours does not cross midnight, so the SAST calendar day (and
day-of-week, and day-of-month) is the same as the UTC one:

- `15:00 UTC` → `17:00 SAST`, same day.
- `04:00 UTC` → `06:00 SAST`, same day; `0 4 * * 1` is Monday in both, `0 4 1 * *` is the 1st in
  both.

Work this arithmetic out explicitly in the migration's comment, the way the existing migration
states its own at `:258-262`.

## FIXED contracts

1. **Three cron jobs, three fixed times, all UTC:**

   | Job | Schedule (UTC) | SAST | Calls | Body |
   |---|---|---|---|---|
   | `send-daily-whatsapp-report` | `0 15 * * *` | 17:00 daily | `send-daily-production-report` | `{}` |
   | `send-weekly-whatsapp-report` | `0 4 * * 1` | 06:00 Monday | `send-period-report` | `{"p_kind":"weekly"}` |
   | `send-monthly-whatsapp-report` | `0 4 1 * *` | 06:00 on the 1st | `send-period-report` | `{"p_kind":"monthly"}` |

   The daily is **`0 15 * * *`, not `0 4 * * *`**. Reason, which must be stated in the migration
   comment: with body `{}` the sender reports on the current SAST day and refuses to send unless
   that day already has cracking or packing captured (`index.ts:183-194`, `:224-226`,
   `20260825091000_daily_production_report.sql:330`), so a 06:00 SAST send would skip almost every
   day. `0 15 * * *` is also the schedule the function's own header already documents (`index.ts:6`),
   so the code and the schedule now agree instead of contradicting each other. Do not "restore" an
   06:00 daily, and do not try to fix this by inventing a `date` body field instead.

2. **Access control on every new `public` function is mandatory and is part of this deliverable.**
   Each of the three wrappers is `SECURITY DEFINER` with `SET search_path = public`, and each is
   followed immediately by, verbatim (with its own signature):

   ```sql
   REVOKE ALL ON FUNCTION public.cron_send_daily_report() FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON FUNCTION public.cron_send_daily_report() TO service_role;
   ```

   Why this is load-bearing rather than boilerplate: Postgres grants `EXECUTE` to `PUBLIC` by
   default and PostgREST exposes `public`-schema functions to `anon`; this repo's anon keys for both
   projects are committed in source (`WebPortal/js/macavation-supabase.js:16,22`, cited by
   `send-daily-production-report/index.ts:14`). These wrappers fetch the service-role key from Vault
   and post it as a bearer token, so an unrestricted definer wrapper is a one-RPC bypass of the
   constant-time service-key gate at `send-daily-production-report/index.ts:155-162` — i.e. anyone
   holding the committed anon key could fire real WhatsApp broadcasts to real subscribers. Same
   pattern the two existing precedents already use
   (`20260901120000:252-253`, `20260908090000:177-184`). Deliverable 2 asserts these lines exist.

3. **Each job is a named SQL wrapper function** in `public`, named exactly:
   `public.cron_send_daily_report()`, `public.cron_send_weekly_report()`,
   `public.cron_send_monthly_report()` — all zero-argument, mirroring `cron_reseed_production_daily`'s
   naming. These three names are the only things that appear in `cron.schedule`'s command string;
   never inline SQL there. Use these exact names in the migration, in the REVOKE/GRANT lines, in the
   `COMMENT ON FUNCTION` lines, in the migration's own verification block and in deliverable 2 — no
   variants, no aliases.

   Write the three wrappers as three **self-contained** functions (each doing its own Vault lookups,
   its own guards and its own `net.http_post`). Do not factor out a shared helper: three uniform
   bodies keep every assertion in deliverable 2 applicable to every wrapper.

4. **The target URL is resolved per-database from Vault, never written into the file.**
   Each wrapper reads two secrets from `vault.decrypted_secrets`, both by exact name:

   - `wa_cron_service_role_key` — the service-role key for **this** database.
   - `wa_cron_functions_base_url` — the edge-function base URL for **this** database, e.g. the
     value `https://<project-ref>.supabase.co/functions/v1` with no trailing slash.

   ```sql
   SELECT decrypted_secret INTO v_key
   FROM vault.decrypted_secrets WHERE name = 'wa_cron_service_role_key';
   SELECT decrypted_secret INTO v_base
   FROM vault.decrypted_secrets WHERE name = 'wa_cron_functions_base_url';
   ```

   Why a Vault secret and not a literal: this exact file is applied to prod as well as dev
   (`npm run db:apply-prod`, `scripts/apply-pending-prod-migrations.mjs`), and nothing in SQL can
   read the runtime `SUPABASE_URL` the senders themselves use
   (`send-daily-production-report/index.ts:68`, `send-period-report/index.ts:73`). A hardcoded ref
   would mean the **prod** database's cron posting to the **dev** project's sender. Vault is
   per-database, so each environment resolves its own value from the one committed file. There is no
   SQL-visible environment-config table in this repo to use instead.

   The migration must contain **no** project-ref-shaped literal and **no** literal Supabase URL.
   Where the header comment needs to show the shape, write the placeholder
   `https://<project-ref>.supabase.co/functions/v1` — the angle-bracket placeholder is what keeps it
   past deliverable 2's assertion 6.

   Seeding either secret is a **human pre-step in each environment** and is out of scope: the
   migration must not create, insert or update a Vault secret, and must not create a second secret
   under a different name.

5. **Guards: raise on what is synchronously knowable, never on the async HTTP result.**
   Inside each wrapper, before the post:

   - If `v_key` is NULL or empty → `RAISE EXCEPTION` naming `wa_cron_service_role_key` and saying a
     human must seed it in this database's Vault.
   - If `v_base` is NULL or empty → `RAISE EXCEPTION` naming `wa_cron_functions_base_url`, same.
   - If `v_base` does not start with `https://` → `RAISE EXCEPTION`.

   These are the failures that would otherwise be silent: a missing secret yields
   `Authorization: Bearer ` and a 401 nobody sees. Raising here is what puts them in
   `cron.job_run_details`.

   `net.http_post` itself is **async** — it returns a request id, not a response — so the wrapper
   **must not** attempt to inspect the HTTP outcome, must not read `net._http_response`, and must
   not raise on the send's result. Capture the returned id into a `bigint` and `RAISE NOTICE` it, so
   `cron.job_run_details` at least records that the wrapper ran and dispatched. State in the comment
   that failure visibility for the send itself is pg_net's `net._http_response` table and the edge
   function's own logs, not `cron.job_run_details`. Do not claim otherwise, and do not write an
   error-handling branch on a result that is not known yet.

   Build the call with **named arguments only**, so argument order cannot be wrong, and
   schema-qualify everything (`net.http_post`, `vault.decrypted_secrets`, `public.*`) since
   `search_path` is pinned to `public`:

   ```sql
   SELECT net.http_post(
       url     := rtrim(v_base, '/') || '/send-daily-production-report',
       headers := jsonb_build_object(
                      'Content-Type', 'application/json',
                      'Authorization', 'Bearer ' || v_key),
       body    := '{}'::jsonb
   ) INTO v_request_id;
   ```

   If the installed `pg_net` exposes a different signature, that is an apply-time failure for a
   human to resolve — do not work around it by inlining a URL or a key literal.

6. **Extension and Vault availability are handled in the migration, not asserted in a comment.**
   Include `CREATE EXTENSION IF NOT EXISTS pg_net;` (idempotent, exactly the mechanism
   `20260901120000:71` uses for `pg_cron`). Do **not** add a `CREATE EXTENSION` for `pg_cron` — it
   is already created by that migration — and do not create `supabase_vault`. Then guard, in the
   migration's verification block (contract 7), that the objects this migration needs actually
   resolve, raising a message that names the missing pre-step:

   - `net.http_post` exists:
     `EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.proname = 'http_post' AND n.nspname = 'net')`
     — use this existence form rather than `to_regprocedure`, so you are not guessing pg_net's exact
     argument list.
   - `to_regclass('vault.decrypted_secrets') IS NOT NULL`.

   Do not query Vault for the secrets' presence in a `DO` block that would fail the whole apply on a
   database where a human has not yet seeded them — the per-run guards in contract 5 are where that
   surfaces.

7. **This migration does not touch `reseed-production-daily-hourly` or
   `reseed-production-daily-nightly`.** It only adds the three new jobs. The migration's final
   verification `DO` block (modelled on `20260901120000:390-428`, `RAISE EXCEPTION` on failure) must
   assert: the three wrapper functions exist (`to_regprocedure('public.cron_send_daily_report()')`
   etc.), the three new jobnames are present and `active` in `cron.job`, the two existing reseed
   jobnames are **still** present and `active`, and the contract-6 availability checks above. It is
   fine and expected for this block to mention the two reseed jobnames — deliverable 2's jobname
   assertions are scoped to `cron.schedule(` call arguments, not to the whole file.

8. **No retry logic.** If a `net.http_post` fails or the edge function errors, the job simply did
   not send that period. State plainly as a known limitation:
   - the daily's own `daily_report_already_sent(p_date)` keys on `report_kind = 'daily'`,
     `report_date`, `status = 'sent'`
     (`migrations/20260825091000_daily_production_report.sql:279-287`), and the period sender's
     `period_report_already_sent` keys on the instance — so a failed run cannot cause a duplicate
     send, but the next scheduled run is a full day/week/month later and is **not** a retry;
   - a daily that skips because the factory captured nothing (`skipped:'no_production'`) and a
     weekly/monthly that skips because nothing is published
     (`skipped:'no_published_instance'`, `send-period-report/index.ts:182-186`) are both silent
     no-ops by design.
   Do not build a retry mechanism this plan was not asked for.

## Deliverables

### 1. Migration — `migrations/20260909090000_whatsapp_report_schedule.sql`

Before writing it, confirm `20260909090000` is still strictly greater than every existing prefix in
`migrations/` (the highest on this branch is `20260908090000_period_report_senders.sql`) and unique;
if not, pick a later valid 14-digit UTC timestamp. Must satisfy
`scripts/verify-migration-prefixes.mjs` (14-digit real UTC timestamp, unique, `.sql` only).
The filename suffix must be exactly `_whatsapp_report_schedule.sql` and must **not** end in
`_period_report_senders.sql` — `scripts/verify-wa-period-reports.mjs:40-56` fails if it finds more
than one file with that suffix.

Contents, in order:

- Header comment in this repo's style: what is missing today (stated as the checkout-verifiable
  fact from the section above — `20260901120000...` is the only file that calls `cron.schedule`, and
  it schedules two reseed jobs, neither of them a report send), what this adds, the UTC/SAST
  arithmetic worked out explicitly for all three times, **why the daily is 17:00 SAST and not 06:00**
  (contract 1), the two required human Vault pre-steps named by secret name (contract 4), the
  `net.http_post` async limitation (contract 5), the no-retry limitation (contract 8), and an
  explicit **OUT OF SCOPE: applying this migration** line. No "confirmed live", no extension
  versions, no `cron.job` row counts, no measurement you cannot reproduce from this checkout.
- `CREATE EXTENSION IF NOT EXISTS pg_net;` (contract 6).
- The three wrapper functions per contracts 3, 4 and 5, each declared
  `CREATE OR REPLACE FUNCTION public.cron_send_<kind>_report()` ... `RETURNS void`
  `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$ ... $fn$;` (the `$fn$` tag is
  required — see the style note above), each with a `COMMENT ON FUNCTION`.
- The REVOKE/GRANT pair for each of the three, verbatim per contract 2.
- Three `cron.schedule(...)` calls per contract 1's table, each with a `$cron$SELECT
  public.cron_send_<kind>_report();$cron$` command string.
- The verification `DO` block per contract 7.
- `NOTIFY pgrst, 'reload schema';` at the end, matching `20260901120000:430`.

### 2. Verifier — `scripts/verify-wa-report-schedule.mjs`

Registered in `package.json` as `"wa-report-schedule:verify": "node scripts/verify-wa-report-schedule.mjs"`
and **appended to the end** of the existing `test:fleet` chain with ` && npm run
wa-report-schedule:verify`. Do not reorder, rewrite or drop any existing entry in `test:fleet`, and
do not touch the `"//test:fleet"` documentation line above it.

Model it on `scripts/verify-wa-period-reports.mjs`: pure `fs` reads, no network, no browser, no
dependency, CRLF normalised on read, the same tiny `check()` / `fail()` / `failures` harness, its own
copies of `isolateSqlFunction` and `escapeRe` (this repo copies these helpers between verifiers
rather than importing a shared module), and a `findScheduleMigration()` that locates the single
`*_whatsapp_report_schedule.sql` in `migrations/` by suffix — failing if there are zero or more than
one — rather than hardcoding the timestamp. Do not add a `package-lock.json` and do not invoke
`npm ci` from the script.

Say in the script's own header comment that this cannot run against a live database, so it verifies
the **migration file's shape** only and proves nothing about whether the schedule actually fires —
the same candour `scripts/verify-migration-prefixes.mjs:12-31` shows about its own limits.

Assertions:

1. Exactly three `cron.schedule(` calls in the migration, whose first single-quoted argument is, as
   a set, exactly `send-daily-whatsapp-report`, `send-weekly-whatsapp-report`,
   `send-monthly-whatsapp-report`, paired with the cron expressions `0 15 * * *`, `0 4 * * 1`,
   `0 4 1 * *` respectively (contract 1). Assert the daily is `0 15 * * *` with a failure message
   explaining why `0 4 * * *` is wrong.
2. No `cron.schedule(` call names `reseed-production-daily-hourly` or
   `reseed-production-daily-nightly` (contract 7). **Scope this to the extracted `cron.schedule(`
   arguments, not the whole file** — the migration's verification block legitimately mentions both
   names.
3. Each `cron.schedule(` command string names exactly one of the three wrapper functions and
   contains no other SQL verb (no inline `net.http_post`, no `INSERT`, no `SELECT` other than the
   single `SELECT public.cron_send_<kind>_report();`).
4. For each of `public.cron_send_daily_report()`, `public.cron_send_weekly_report()`,
   `public.cron_send_monthly_report()`, isolating the body with `isolateSqlFunction` on the
   declaration `CREATE OR REPLACE FUNCTION public.cron_send_<kind>_report()`:
   - the header (text before `AS $fn$`) matches `/SECURITY DEFINER/` and
     `/SET search_path\s*=\s*public/`;
   - the body contains `vault.decrypted_secrets`, `'wa_cron_service_role_key'`,
     `'wa_cron_functions_base_url'` and `net.http_post`;
   - the body contains at least one `RAISE EXCEPTION` mentioning each secret name (the contract-5
     guards) and at least one `RAISE NOTICE`;
   - the body does **not** contain `net._http_response` and does not contain `http_get` — i.e. it
     makes no attempt to read the async response synchronously (contract 5). This replaces any
     file-wide ban on `RAISE EXCEPTION`: the migration's own verification block and the wrappers'
     secret guards both use `RAISE EXCEPTION` deliberately, so a file-wide match would make this
     verifier fail against the very migration this plan requires.
   - the body's target path ends in the right slug: `send-daily-production-report` for the daily,
     `send-period-report` for the other two, and the weekly/monthly bodies contain
     `"p_kind"` with `weekly` / `monthly` respectively.
5. For each of the three signatures, the migration contains, verbatim,
   `REVOKE ALL ON FUNCTION public.cron_send_<kind>_report() FROM PUBLIC, anon, authenticated;` and
   `GRANT EXECUTE ON FUNCTION public.cron_send_<kind>_report() TO service_role;` (contract 2) —
   same assertion shape as `scripts/verify-wa-period-reports.mjs:413-421`.
6. The migration contains no per-environment literal: no match for
   `/https:\/\/[a-z0-9]{20}\.supabase\.co/`, and neither of the strings `nmdmddugxclpqrwylyfa` nor
   `sofanhfpxifgdtooefzq` anywhere in the file (contract 4). The placeholder
   `https://<project-ref>.supabase.co/functions/v1` in the header comment does not match this
   regex and is allowed.
7. No key-shaped literal in the migration: no match for `/eyJ[A-Za-z0-9_\-]{20,}/` (JWT-shaped) and
   no run of 40+ base64/hex characters inside a quoted literal. State in the comment that this is a
   heuristic, not a proof, and that a real secret scan is a human's job.
8. The migration contains `CREATE EXTENSION IF NOT EXISTS pg_net;` and does **not** contain
   `CREATE EXTENSION IF NOT EXISTS pg_cron` (contract 6), and contains the two contract-6
   availability guards (`nspname = 'net'` / `proname = 'http_post'`, and
   `to_regclass('vault.decrypted_secrets')`).
9. The migration contains no `INSERT INTO vault.` and no `vault.create_secret` /
   `vault.update_secret` — seeding a secret is a human pre-step, never this migration's job
   (contract 4).

## Verify before finishing

Everything here runs headless from this checkout with no network and no database:

1. `npm run wa-report-schedule:verify` alone — green.
2. `npm run migrations:verify` — green (new filename accepted, no new violation).
3. `npm run wa-period-reports:verify` — still green, confirming your new migration's filename did
   not collide with the `*_period_report_senders.sql` suffix that verifier matches on.
4. `npm run test:fleet` — green end to end, including the new verifier, and confirm by reading the
   script that every entry that was in the chain before is still in it.
5. Re-read the UTC/SAST arithmetic in your own migration comment against `report_sast_today()`'s
   definition and against contract 1's table, and confirm each of the three lines is right — this is
   the kind of off-by-one that gets written into a comment once and then repeated confidently.
6. Re-read your three wrapper bodies and confirm every identifier deliverable 2 asserts on is spelled
   exactly as contract 3 names it, including the two Vault secret names and the two function slugs.

## Out of scope — do not do these

- **Applying the migration.** A human does this, on dev first, then prod after sign-off.
- **Seeding or rotating either Vault secret** (`wa_cron_service_role_key`,
  `wa_cron_functions_base_url`), and **enabling any extension by hand**. Those are human pre-steps
  per environment; the migration's job is to guard for them and fail loudly, not to perform them.
- **Retry logic for a failed send.** Contract 8.
- **Changing either sender edge function.** The daily's `0 15 * * *` header comment (`index.ts:6`)
  already matches contract 1's daily schedule, so nothing there needs editing; do not rewrite either
  function's auth gate, date resolution or skip behaviour to suit the schedule.
- **Scheduling the alert push.** wa-flow-09 handles that on its own terms — do not fold it in here.
- **Changing `reseed-production-daily-hourly` or `reseed-production-daily-nightly`,** or editing
  `migrations/20260901120000_auto_seed_production_daily_cron.sql`. Contract 7.
- **Editing any file under `BluePrint/`.** If a convention document there looks stale next to the
  code (for example on hardcoded URLs versus the generated `WebPortal/js/macavation-supabase.js`),
  leave it alone and say so in your report; correcting a document is a separate, human-reviewed
  change.
- **Adding a `package-lock.json`** or any npm dependency.
