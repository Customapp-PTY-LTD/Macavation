---
depends_on: wa-flow-04-weekly-monthly-senders.md
---

# WhatsApp: put the daily, weekly and monthly senders on a schedule

## Context

`send-daily-production-report`, and `send-period-report` from wa-flow-04, both exist as edge
functions a human can call by hand. Nothing calls either automatically. Every "sends at 06:00"
line in this codebase — including this plan's own predecessors — describes an intention, not a
fact. `evaluate-stock-alerts-cron/index.ts`'s header states this explicitly about itself, after
correcting an earlier version of its own comment that falsely claimed a schedule existed:

> *"NOT SCHEDULED, despite the name. This header used to claim 'Cron: 0 7,12,17 * * * SAST'. No
> such schedule was ever created."*

This plan is what makes the claim true for the report senders specifically.

## The `pg_net`/Vault pre-step — resolved, confirmed live, not a hypothetical

`migrations/20260901120000_auto_seed_production_daily_cron.sql` is the only prior use of
`pg_cron` in this repo, and it schedules a **plain SQL function in the same database** —
`cron_reseed_production_daily()`. There is no HTTP call in it. Scheduling an edge function — a
Deno HTTP endpoint, not a SQL function — needs `pg_net`'s `net.http_post` to reach it, which
nothing in this repo had done before this plan.

**Confirmed directly against the dev database (`nmdmddugxclpqrwylyfa`) on 2026-09-07, not assumed:**

```
extname          | extversion
-----------------+-----------
supabase_vault   | 0.3.1
pg_cron          | 1.6.4
pg_net           | 0.20.3   -- enabled as this plan's human pre-step, was not on before
```

Both extensions this plan needs are enabled. There is nothing left to check or enable before this
plan builds against them — the wrapper functions in deliverable 1 can call `net.http_post` and the
Vault-based secret lookup directly.

## Read this first — what is already here, and where to read it

### The model — `migrations/20260901120000_auto_seed_production_daily_cron.sql`

Read the whole file; it is the only precedent for scheduling anything in this repo and its
reasoning transfers even though the mechanism (SQL function vs. HTTP call) differs:

- `CREATE EXTENSION IF NOT EXISTS pg_cron;` — this is how `pg_cron` itself was enabled; `pg_net` is
  already enabled by the same mechanism as a pre-step for this plan (see above), so this migration
  does not repeat it.
- A **named SQL wrapper function**, not inline SQL in `cron.schedule`'s command string — "so the
  cron command string is short enough to read in `cron.job`, ... and a failure can `RAISE` so
  `cron.job_run_details` records it as failed instead of silently succeeding." Follow this same
  shape: one wrapper function per job, not a bare `net.http_post` call inline.
- `cron.schedule(jobname, schedule, command)` **upserts on `jobname`** in this project's pg_cron
  version (1.6.4, confirmed in that migration's own comment) — re-running the migration rewrites
  the job rather than stacking duplicates. Useful, but do not rely on it as a substitute for
  picking a stable jobname the first time.
- Times are **UTC**; SAST is UTC+2. The comment states this explicitly because it is easy to get
  backwards. `report_sast_today()` (`migrations/20260825090000_report_subscriptions_and_staff.sql:49`)
  returns `(current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date` — the canonical "today"
  for every report. **06:00 SAST is 04:00 UTC.** Do the arithmetic explicitly in the migration's
  comment; do not leave a reader to work it out.

### The two functions being scheduled

- `supabase/functions/send-daily-production-report/index.ts` — auth is a service-role bearer,
  constant-time compared (about `:155-162`). It must run **after** the nightly data rebuild.
- `supabase/functions/send-period-report/index.ts` (from wa-flow-04) — same auth pattern, takes
  `p_kind`.

### The nightly rebuild this must run after — `cron.job` today

```sql
reseed-production-daily-hourly    5 * * * *      SELECT public.cron_reseed_production_daily(7);
reseed-production-daily-nightly   20 23 * * *    SELECT public.cron_reseed_production_daily(14);
```

The nightly one finishes at `23:20 UTC` (`01:20 SAST`). The daily report must not fire before the
figures it reports on exist. Ordering the daily send at `04:00 UTC` gives roughly 2 hours 40
minutes of margin after the nightly reseed — state this arithmetic in the migration's comment, the
same way the existing migration states its own.

## FIXED contracts

1. **Three cron jobs, three fixed times, all UTC:**

   | Job | Schedule (UTC) | SAST | Calls |
   |---|---|---|---|
   | `send-daily-whatsapp-report` | `0 4 * * *` | 06:00 | `send-daily-production-report` |
   | `send-weekly-whatsapp-report` | `0 4 * * 1` | 06:00 Monday | `send-period-report` with `p_kind='weekly'` |
   | `send-monthly-whatsapp-report` | `0 4 1 * *` | 06:00 on the 1st | `send-period-report` with `p_kind='monthly'` |

2. **Each job is a named SQL wrapper function**, per the existing migration's own reasoning,
   calling `net.http_post` with:
   - the function's URL, built from the project ref and function slug — read how the existing
     edge functions construct their own base URL (if any do) rather than hardcoding a ref that
     could differ between dev and prod; if none do, the migration must accept the ref as
     something a human confirms per-environment, and the migration's comment must say so rather
     than silently hardcoding dev's ref into a file that will also be applied to prod.
   - `Authorization: Bearer <service-role key>`, retrieved via **Supabase Vault**
     (`vault.decrypted_secrets`), **never** written into the cron job's command string in
     cleartext — `cron.job` and `cron.job_run_details` are queryable and a literal key there is a
     credential leak. **The secret already exists in Vault under the name
     `wa_cron_service_role_key`** (stored directly against the dev database as this plan's human
     pre-step, alongside enabling `pg_net` — confirmed present via `SELECT name FROM
     vault.secrets`, its value was never read into this checkout or any file in it). Look it up by
     that exact name (`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name =
     'wa_cron_service_role_key'`) — do **not** create a second secret under a different name, and
     do not add a step that tries to create or seed this secret; it is already there.
   - a JSON body of `{}` (the daily) or `{"p_kind": "weekly"}` / `{"p_kind": "monthly"}`.
   - `net.http_post` is async — it returns a request id, not the response. The wrapper function
     cannot `RAISE` on the HTTP result the way `cron_reseed_production_daily` raises on a SQL
     error, because the result is not known synchronously. State this limitation explicitly in the
     migration's comment rather than writing an error-handling branch that cannot actually work —
     failure visibility for this job is `net._http_response` (pg_net's own response table) and the
     edge function's own logs, not `cron.job_run_details`. Do not claim otherwise.

3. **The wrapper functions live in `public`, follow the naming convention `cron_send_<kind>_report`**
   (mirroring `cron_reseed_production_daily`), and are the only things named in `cron.schedule`'s
   command string — never inline SQL there, per the existing migration's own rule.

4. **This migration does not touch `reseed-production-daily-hourly` or
   `reseed-production-daily-nightly`.** It only adds the three new jobs. Confirm in your report
   that the existing two rows in `cron.job` are unchanged by re-running this migration.

5. **No retry logic.** If a `net.http_post` fails or the edge function errors, the job simply did
   not send today. Given `daily_report_already_sent` / `period_report_already_sent` gate on "has
   this been sent," a failed run is safe to leave for the next scheduled run to notice was never
   sent and is NOT itself a retry — the next run is a full 24 hours (or a week, or a month) later.
   State this plainly as a known limitation rather than building a retry mechanism this plan was
   not asked for.

## Deliverables

### 1. Migration — `migrations/<14-digit-UTC-timestamp>_whatsapp_report_schedule.sql`

Timestamp later than wa-flow-04's. Must satisfy `scripts/verify-migration-prefixes.mjs`.

- No `CREATE EXTENSION` needed — `pg_net` and `supabase_vault` are both already enabled on dev
  (confirmed live, see above). Do not add one; it would be a no-op at best and a needless
  assumption at worst.
- Three wrapper functions per contract 3, each doing the Vault lookup (by the exact secret name
  above) and the `net.http_post` call, each with a `RAISE NOTICE` (not `RAISE EXCEPTION` — see
  contract 2's limitation) recording that the request was dispatched, so `cron.job_run_details` at
  least shows the wrapper ran.
- Three `cron.schedule(...)` calls per contract 1's table.
- A header comment in this repo's style: what is missing today (measured — `cron.job` holds
  exactly two rows, neither of them a report send), what this adds, the UTC/SAST arithmetic
  worked out explicitly, the `net.http_post` async limitation stated explicitly, and an explicit
  **OUT OF SCOPE: applying this migration** line. `pg_net`/Vault availability and the
  `wa_cron_service_role_key` secret are already confirmed and seeded (see above) — this migration
  is not blocked on them.

### 2. Verifier — `scripts/verify-wa-report-schedule.mjs`

Registered as `wa-report-schedule:verify`, appended to the end of `test:fleet`. Pure `fs` reads —
this cannot run against a live database, so it verifies the **migration file's shape**, not that
the schedule actually works. Say this limitation in the verifier's own header comment, the same
way `scripts/verify-migration-prefixes.mjs`'s header is candid about what it does and does not
prove.

Assert at least:

1. The migration contains three `cron.schedule(...)` calls with the exact jobnames and cron
   expressions from contract 1's table.
2. No `cron.schedule` call in the new migration reuses `reseed-production-daily-hourly` or
   `reseed-production-daily-nightly` as a jobname — contract 4, checked so a copy-paste error can
   never silently overwrite the existing reseed schedule.
3. No literal-looking secret (a long base64/hex string, or the literal substring `service_role`
   followed by an `=` or a colon and a quoted value) appears in the migration file — a cheap
   textual guard against the exact mistake contract 2 warns against. State in the verifier's
   comment that this is a heuristic, not a proof, and that a real secret scan is a human's job.
4. The migration does not contain `RAISE EXCEPTION` inside the new wrapper functions — contract
   2's limitation, checked so nobody "fixes" the wrapper into raising on an async result it cannot
   actually have yet.

## Verify before finishing

1. `npm run test:fleet` — green, including the new verifier.
2. `npm run wa-report-schedule:verify` alone.
3. `npm run migrations:verify`.
4. Re-read the UTC/SAST arithmetic in your own migration comment against
   `report_sast_today()`'s definition and confirm it is actually correct — this is the kind of
   off-by-one that is easy to get wrong once and then repeat confidently in a comment.
5. `pg_net`, `supabase_vault`, and the `wa_cron_service_role_key` secret are already confirmed
   present on dev (stated above) — nothing further to check or assume here.

## Out of scope — do not do these

- **Applying the migration.** As always, a human does this, on dev first. `pg_net`/Vault and the
  secret are already in place; only the migration itself remains to be applied.
- **Retry logic for a failed send.** Contract 5.
- **Scheduling the alert push.** wa-flow-09 handles that on its own terms — do not fold it in here.
- **Changing `reseed-production-daily-hourly` or `reseed-production-daily-nightly`.** Contract 4.
