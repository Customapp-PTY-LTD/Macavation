# Macavation Phase 2 — Completion Plan

**Issued:** 2026-08-21 · **Author:** CustomApp delivery (Henry) · **Audience:** Macavation leadership (Paul, Pete, Josslyn, Mark), CustomApp delivery

**Relationship to earlier documents.** `PHASE2_SCOPE_AND_SCHEDULE.md` (18 Aug) remains the reference
for *what is delivered* and *what each workstream still contains*. This document is the plan to
**finish** — it re-baselines the schedule from Monday 24 August, and it corrects the production
picture, which turned out to be materially worse than the 18 August document reported.
`PHASE2_IMPLEMENTATION_PLAN.md` (July) is stale and should not be used for status.

Everything below was re-verified on 2026-08-21 against the `dev` branch, the 331 migration files in
the repository, and the live production database.

---

## Scope at a glance

The nine numbered items are the scope agreed in the Phase 2 proposal, in the proposal's own order.
Item 10 was added mid-phase and was never in that document. Item 0 is delivery, not scope — but it is
why the last column reads the way it does.

**Read the last column first.** Roughly two thirds of Phase 2 is built. Almost none of it is in front
of a Macavation user. The gap between those two facts is the whole plan.

| # | Scope item | Built | Days left | Sprint | In production today |
|---|---|---|---|---|---|
| 1 | **Historical data** — two years of operational history | 7 / 10 | 7–8 | S4 | **Not live.** NIS procurement and kernel sales history are loaded and reconciled, but they live on the data page, which is not on production |
| 2 | **Advanced permissions** — buttons and actions per role, in UI *and* at the API | 6 / 12 | 17 | S5 | **Partly.** 27 keys and 95 grants are live, but UI-only — the API half is not enforced. Largest remaining block |
| 3 | **In-app messaging** — messaging, read/unread, links to batches and lots | 8 / 11 | 4.5 | S2, S6 | **Partly.** 1:1 chat schema is on production; the WhatsApp shared inbox is not, and no conversation has happened yet |
| 4 | **Stock red-flag alerts** — configurable thresholds on stock screens and dashboard | 6 / 11 | 3–4 | S2 | **Partly.** Rules and alerts exist — 46 sit unresolved — but nothing evaluates them on a schedule, so an overnight stock-out waits for whoever opens the screen |
| 5 | **Daily reporting** — scheduled WhatsApp and/or email summary | 4 / 9 | 4 | S2 | **Never sent.** Content function and both delivery paths are written; `pg_cron` is not installed and there are zero subscribers. The Meta approval blocker is gone |
| 6 | **Dashboard enhancements** — forecasts, runway, produced vs target, KPIs | 8 / 12 | 6–7 | S6 | **Partly.** Six charts and the KPI set are built; four KPIs have no target behind them. Two definitions still need Paul's ruling |
| 7 | **Shell waste tracking** — lots, movements, link to kernel production | 4 / 8 | 7 | S3 | **Partly.** Lots are created automatically from cracking. No dispatch workflow, and two separate shell inputs can drift apart |
| 8 | **Grower intake — mass balance & procurement** | 4 / 7 | 4–5 | S3 | **Partly.** Both calculations already run in the database and have never been displayed. Surfacing work, not modelling work |
| 9 | **Oil module** — search, consolidated batches, lab results | 5 / 10 | 6–7 | S4 | **Partly.** Search and consolidated batches work. Lab results are still free text, not a real document, and only admins can consolidate |
| 10 | **Sales & Production Report** *(added mid-phase — not in the proposal)* | 13 / 17 | 15 | S1 | **Not live.** No report or data-page table exists on production at all. A report can now be issued rather than only drafted — that landed this week |
| **0** | **Production cutover** *(delivery, not scope — and the critical path)* | 0 / 7 | 7 | S1–S2 | **Blocking.** 58 commits and 47 migrations behind. See §3 |

Counts treat a half-day item the same as an eight-day one — read them alongside the days column.

### Also delivered, outside the numbered scope

**Platform and Phase 1 carry-over fixes** are complete (8 of 8) — one consolidated application tree,
an automated build gate that blocks a merge on a new violation, CRM contact saving repaired, and one
grower dropdown instead of two. **Cross-cutting close-out** — user guide, full UAT, training, final
cutover — is 0 of 4 and 11 days, scheduled in S7.

### What is blocked on an answer rather than on development

| Item | Sits under | What is needed | From |
|---|---|---|---|
| The three **Stock Report** sections | Scope 10 | Cost price and book value exist nowhere in the system. Cannot be built until Macavation supplies a valuation source — Palladium or Pete's finance sheet | Pete / finance |
| **March FYE 2026** procurement figure | Scope 10 | Pete's sheet claims 138,371.50 kg against four deliveries totalling 18,434.50 kg. It reads as a formula error, but it needs his ruling before sign-off | Pete |
| What **"raw ingredient stock"** means | Scope 4 | Either the oil feedstock category already wired, or an aggregate wet nut-in-shell pool — which does not exist as a countable level today. The second reading is new scope | Business |
| Definitions of **runway** and **stock accuracy** | Scope 6 | Both are useful as built, but neither is what the proposal literally describes. Changing them later means rework | Paul |
| **Permission role matrix**, and where enforcement lives | Scope 2 | Who may create, edit, approve and adjust stock, per role — plus Postgres functions or the Lambda proxy. The one decision that can still move the schedule by weeks | Business & CustomApp |

Out of scope for Phase 2, and candidates for Phase 3: purchase-order and grower-contract tracking,
full Palladium integration, silo automation, pricing and grower-statistics automation, GMP forms, and
predictive forecasting. Mobile apps, ERP replacement, Phase 1 re-builds and new hardware integrations
were excluded in the original proposal.

---

## 1. The headline

Three things are true today, and the second one is new:

1. **The build is close to done.** Around two thirds of Phase 2 is written and working on `dev`.
2. **Production is further behind than we thought, and the migration ledger cannot be trusted to
   tell us how far.** The 18 August document said 20 migrations were outstanding. The real number
   is **47**, some of them from early July. Worse, we found *why* the ledger drifts: the scripts that
   record a migration key on one field and the scripts that check for pending ones compare a
   different field, so records are silently dropped. Several migrations the ledger calls "pending"
   are already in place, and at least one it calls "applied" is not.
3. **Nothing else on this plan matters until that is fixed.** The cutover is the critical path, it
   is 7 days rather than the 3 we costed, and it cannot be done by running a bulk script.

The rest of this plan is sequenced around that.

---

## 2. What changed since 18 August

### Delivered in the last three days (S0 closed)

| Item | Evidence |
|---|---|
| Publish and supersede workflow wired into the portal | `report_editor.js` calls `publish_report_instance` and `supersede_report_instance`, with a fail-closed `hasAction('reports.report.publish')` check |
| Automated report render checks | `npm run reports:verify` |
| Report distribution over WhatsApp — recipients, send dialog, delivery history, phone parity harness | 6 commits; migrations `20260822090000`–`20260822090200` |
| PDF export, and a storage bucket for the archive | `20260822090100_report_pdf_storage_bucket` |
| Kernel stock 24-month best-before from packing start | `20260822100000` |
| All local work pushed — `dev` and `origin/dev` are level | — |

**A report can now be issued, not just drafted.** That was the S0 exit milestone, and it is met.

### Corrections to the production picture

| The 18 Aug document said | Verified 21 Aug |
|---|---|
| 41 commits behind on `demo` / `prod` | **58 commits** behind (both branches, identical) |
| 20 migrations outstanding on production | **47 outstanding by name**, the oldest from 8 July |
| — | **The ledger is wrong in both directions** (see §3) |
| 40 open stock alerts | **46** |
| `pg_cron` not installed | Confirmed — still not installed |
| 0 digest subscribers | Confirmed — `scheduled_reports` is completely empty |
| 27 action keys, 95 grants, UI-only | Confirmed — against **2,012** API-level grants |
| — | **4 of 9 edge functions deployed.** Missing on production: `send-whatsapp-message`, `whatsapp-inbound`, `send-report-whatsapp`, `portal-assistant`, `send-password-reset` |
| — | No report-builder or data-page tables exist on production at all |

---

## 3. The production cutover, re-scoped — 7 days, not 3

This is the one section worth reading in full, because it is the difference between a clean go-live
and a bad weekend.

### Why the ledger cannot be trusted, and what actually causes it

The production migration ledger and the production schema disagree, and we found the mechanism.

Both apply scripts record a migration with `INSERT ... ON CONFLICT (version) DO NOTHING`
(`scripts/lib/apply-migration-to-ref.mjs:38`, `scripts/apply-migration-prod.mjs:104`). The unique key
is the **version**, the 14-digit timestamp. But the pending check compares the **name**, the part of
the filename after that timestamp (`scripts/apply-pending-prod-migrations.mjs:44`).

Those two keys do not agree, and the repository contains 20 pairs of files that share a version.
So when a migration runs whose version is already on the ledger, **the SQL executes and the ledger
row is silently discarded.** The work lands; the record of it does not. Run it a second time and it
lands again.

That single mechanism explains both directions of the drift we measured:

- **Under-reporting.** Five migrations the ledger calls pending are demonstrably already applied —
  `users.first_name` and `last_name` exist, `users.username` is gone, `get_stock_soh_history` exists,
  the issues-register tables exist, and the role cull has clearly run (8 roles remain).
- **Over-reporting.** Version `20260813090000` is stamped as applied, yet none of the three WhatsApp
  inbound shared-inbox tables exist on production. Something claimed that version; the inbox migration
  was not it.

**This is a repository defect, not just a production one.** Until the two keys agree, every future
cutover inherits the same problem. Fixing it is part of step 2 below.

### The pending list needs judging, not just running

Our first read of this was too alarmist, and the audit is what corrects it. Checked file by file:

- `20260709170000_cull_unused_roles_and_obsolete_users.sql` deletes by **named** email and role
  (lines 23–47), not in bulk. Production already shows 8 roles, so replaying it is almost certainly a
  zero-row no-op. It still gets confirmed before it is skipped, but it is not the live-data threat we
  first called it.
- `20260709120000_drop_users_username_column.sql` is idempotent by construction —
  `DROP COLUMN IF EXISTS` (line 213) and `CREATE OR REPLACE` throughout.
- `20260708130000_users_first_last_name_replace_username.sql` is the genuine problem, and it is a
  **blocker, not a data risk**: it reads `users.username` in 13 places, and that column no longer
  exists on production, so it fails loudly the moment it runs. It needs a production variant or a
  formal retirement before the run, or it stops the run dead.

**The audit has a blind spot we have to design around.** Twenty of the 47 pending migrations are
`fix_`, `update_`, `restore_` or `redeploy_` files that change the *body* of a function without
changing its name. Checking whether an object exists cannot tell us whether those landed. For that
class we compare the live function definition against the one in the file, rather than merely asking
whether the function is there.

### The seven steps

| Step | Days | Detail |
|---|---|---|
| **1. Object-level audit** | 2 | Stop asking the ledger. For each of the 47, check whether the objects it creates actually exist on production — and for the 20 body-changing ones, compare the live function definition against the file. Output: one line per migration, classified *already in place* / *safe to replay* / *needs a production variant* / *retire with reason*. A checked-in script, not a one-off. |
| **2. Fix the key and reconcile** | 1 | Make the apply scripts conflict on the same key the pending check uses, so the ledger stops losing rows. Then stamp the migrations proven already applied, and surface the `20260813090000` gap. |
| **3. Handle the exceptions** | 0.5 | Production variants for the files that cannot run as they stand — `20260708130000` at minimum. Nothing is skipped without a written reason. |
| **4. Promote the code** | 0.5 | `dev` → `demo`, validate there, `demo` → `prod`. Demo shares the dev database, so demo proves the **code** and never the production schema. |
| **5. Apply, one file at a time** | 1.5 | Each file applied and verified individually, results logged to `prod_migration_apply_results.json`. We do not use the bulk path. |
| **6. Platform** | 1 | Install `pg_cron`. Deploy the 5 missing edge functions — `whatsapp-inbound` **must** use `--no-verify-jwt`, or Control Room's forwards are rejected at the gateway and no inbound message ever arrives. Set the 4 secrets. Re-point Control Room's `macavation-9349` channel from dev to production. Schedule the three cron jobs. |
| **7. Permissions, config and verification** | 0.5 | The steps the cutover checklist already specifies and our first draft dropped: `db:sync-permissions-prod` and `db:sync-config-prod` (both dry-run first), `npm run verify:portal-routing`, confirm the production Lambda still points at `sofanhfpxifgdtooefzq`, then a one-user-per-role smoke test. **Every affected user must log out and back in** — `featureKeys` and `actionKeys` are cached in the session, so a permission sync changes nothing on screen until they do. |

**Done when:** a report opens on production, the digest sends on schedule with nobody touching it, an
inbound WhatsApp message reaches the production inbox, one user per role passes the smoke test with no
`403 RBAC_PERMISSION_DENIED`, and the audit script reports zero unexplained differences.

**A recommendation.** Start step 1 on **Monday 24 August**, in parallel with the report work — not in
September when the cutover sprint opens. The audit is desk work, it does not compete with the report
build, and it is the only way the 18 September go-live date survives contact with what we just found.

---

## 4. Schedule

Capacity assumption: **one full-stack developer, five days a week**, from Monday 24 August. Business
inputs (§6) are assumed to land on the dates shown; each slip moves its dependent milestone.

**Remaining effort: ~91 developer-days (range 91–97).** At five days a week that is **about 18 working
weeks**, running to roughly the end of December.

**And the schedule below is about two weeks short of that.** S1 to S6 are 14 calendar weeks — 70
developer-days — and S7 close-out is a further 11, giving 81 against the 91 we owe. That gap is real
and there is no honest way to sequence it away. Three options, in order of our preference:

1. **Move the Sales & Production Report out of Phase 2** (§8, decision 2). It is 15 days and it was
   never in the original proposal. This is the only option that closes the gap outright.
2. **Accept a two-week slip** on the final sign-off, holding every dated milestone above it.
3. **Add capacity** for S5, the permissions sprint, which is the largest single block.

We have not silently absorbed the gap into the sprints, because that is how a plan quietly becomes
late.

| Sprint | Dates | Focus | Exit milestone |
|---|---|---|---|
| **S1** | Mon 24 Aug – Fri 4 Sep | Report completion: the 9 sections reading "Not available yet", the oil-production dataset, PDF archive, weekly template validation. **In parallel: cutover steps 1–3** | **Pete signs off the monthly report**, and the production ledger is reconciled |
| **S2** | Mon 7 Sep – Fri 18 Sep | Go-live: cutover steps 4–7, digest deployed and scheduled, recipients loaded, stock-alert schedule and grid badges, thresholds and targets workshop, triage the 46 open alerts. **Plus the anon-key security fix, moved forward from S6** | **Leadership go-live — dashboard, digest and alerts live in production, with the WhatsApp RPCs closed** |
| **S3** | Mon 21 Sep – Fri 2 Oct | Kernel upstream: procurement workspace UI, weighbridge figure as "actual received", shell dispatch, movement history, reconcile the two shell inputs | Procurement workspace and shell dispatch in use |
| **S4** | Mon 5 Oct – Fri 16 Oct | Oil module (lab document upload, remove-member and delete controls, grade field, role grants, release polish) and historical data (oil import path, Pete's 24-month kernel load, data audit) | **Full operational scope live; two years of history in the charts** |
| **S5** | Mon 19 Oct – Fri 13 Nov *(4 weeks)* | Permissions: module audit, role matrix workshop, enforcement-location decision, the 7 ungated modules, server-side enforcement, role-by-role UAT | **A denied button cannot be bypassed via the API** |
| **S6** | Mon 16 Nov – Fri 27 Nov | Dashboard completion, messaging polish and operational UAT | Dashboard KPI set complete |
| **S7** | From Mon 30 Nov | Close-out: user guide, training, full UAT against the success criteria, final cutover | **Phase 2 sign-off** |

### Client-facing milestone dates

| Date | Milestone |
|---|---|
| **Fri 4 September 2026** | Monthly Sales & Production report signed off by Pete |
| **Fri 18 September 2026** | Leadership go-live — dashboard, daily digest and stock alerts running in production |
| **Fri 16 October 2026** | Full operational scope in production, including two years of history |
| **Fri 13 November 2026** | Permissions enforced end to end |
| **Not fixed** | **Phase 2 sign-off.** On current capacity close-out starts around the end of November. We will set a date once S5 is scoped against the confirmed role matrix — quoting one before the permissions decision is answered would be a guess presented as a promise |

---

## 5. Remaining work by workstream

Detail for each of these is in `PHASE2_SCOPE_AND_SCHEDULE.md` §5. Days are updated for what S0
delivered and for the re-scoped cutover.

| # | Workstream | Days | Sprint | The short version |
|---|---|---|---|---|
| 0 | **Production cutover** | 7 | S1–S2 | Audit, fix the ledger key, promote, platform, permissions sync and smoke test. §3 |
| 10 | Sales & Production Report | 15 | S1 | 9 sections with no data source, oil dataset, PDF archive, weekly template. Publish workflow now done |
| 5 | Daily reporting | 4 | S2 | Deploy, schedule, recipients. The Meta blocker is gone — this is configuration now |
| 4 | Stock red-flag alerts | 3–4 | S2 | Live schedule, grid badges, remaining thresholds, triage the 46 open alerts |
| 3a | **Anon-key security fix** | 1.5 | **S2** | Derive the user id server-side on the five WhatsApp RPCs. Moved forward — see §7 |
| 8 | Grower intake and procurement | 4–5 | S3 | Surface calculations that already run in the database. Switch to the weighbridge figure first |
| 7 | Shell waste | 7 | S3 | Dispatch workflow, movement history UI, reconcile the two shell inputs, replace free-text batch linkage |
| 9 | Oil module | 6–7 | S4 | Lab document upload, wire up built-but-unreachable controls, grants beyond admin |
| 1 | Historical data | 7–8 | S4 | Oil import path, Pete's batch-level 24 months, data audit sign-off |
| 2 | **Advanced permissions** | 17 | S5 | Server-side enforcement plus 7 ungated modules. Largest single item, and the estimate is conditional |
| 6 | Dashboard completion | 6–7 | S6 | Targets and deltas for the remaining KPIs, kernel consolidated widget, two definition decisions |
| 3b | Messaging and chat | 3 | S6 | Operational UAT, polish, user guide |
| — | Cross-cutting | 11 | S7 | User guide (~6 d), full UAT, training, final cutover |
| | **Total** | **91–97** | | Plan against **~91**; the range is the honest spread, not a hedge |

### The three items where the work is blocked on an answer, not on development

- **The three Stock Report sections** are specified as *stock, cost price and book value*. There is no
  cost price, unit cost or book value anywhere in the system. These cannot be built until Macavation
  supplies a valuation source — Palladium or Pete's finance sheet.
- **March FYE 2026 procurement.** Pete's sheet claims 138,371.50 kg where both source sheets hold four
  deliveries totalling 18,434.50 kg. It is within R0.50 of his own May figure, so it reads as a formula
  error rather than 119,937 kg of unrecorded nut. Needs his ruling before report sign-off.
- **What "raw ingredient stock" means for alerts.** Either the oil feedstock category that already
  exists and is already wired, or an aggregate wet nut-in-shell pool — which does not exist as a
  countable level today, because intake batches flow through one by one rather than sitting in a pool.
  The second reading is new scope.

---

## 6. What we need from Macavation, and by when

| Input | Owner | Needed by | Blocks |
|---|---|---|---|
| Ruling on the March FYE 2026 procurement figure | Pete | Fri 28 Aug | Report sign-off (S1) |
| **Stock valuation source — cost price and book value per style** | Pete / finance | Fri 28 Aug | Three Stock Report sections, which cannot be built without it |
| Sign-off on the July and August monthly reports | Pete | Fri 4 Sep | S1 exit |
| Daily digest recipient list — emails and WhatsApp numbers | Paul | Fri 11 Sep | Go-live (S2) |
| Alert threshold values per material | Josslyn and Mark | Fri 11 Sep | Go-live (S2) |
| Monthly dashboard targets per product line | Paul | Fri 11 Sep | Go-live (S2) |
| Decision: what "raw ingredient stock" means for alerts | Business | Fri 11 Sep | S2 |
| Review of the 46 open production alerts | Josslyn and Mark | Fri 11 Sep | Go-live — a digest opening with 46 stale flags teaches people to ignore it |
| Definitions of "raw material runway" and "stock accuracy" | Paul | Fri 2 Oct | S6 |
| Pete's batch-level 24-month kernel dataset | Pete | Fri 2 Oct | S4 |
| Permission role matrix — who may create, edit, approve, adjust stock, per role | Business and CustomApp | Fri 9 Oct | S5, the largest workstream |
| Ownership of `auth/rbacChecker.js` — is the Lambda proxy in scope? | CustomApp and Macavation | Fri 9 Oct | The S5 estimate |

---

## 7. Risks

| Risk | Impact | Handling |
|---|---|---|
| **The migration ledger loses rows by design** — the apply scripts conflict on `version`, the pending check compares `name`, and 20 file pairs share a version | Schema silently absent while the ledger says applied; a replay applies the same SQL twice | §3. Fix the key mismatch in the repository, then an object-level audit before anything is applied. No bulk path; no file skipped without a written reason |
| **Six weeks of work lands in one go** — 58 commits, 47 migrations | A bad cutover lands on live operations | Promote through `demo` first; apply one file at a time; audit completed before the sprint opens |
| **The audit cannot see body-only changes.** 20 of the 47 pending files rewrite a function without renaming it | An audit based on "does the object exist" would pass them wrongly | Compare the live function definition against the file, not just its presence. Built into §3 step 1 |
| **Anon-key RPC exposure.** The browser calls RPCs as `anon`, and five WhatsApp RPCs take the user id as a caller-supplied parameter, so the public key is enough to act as another user | A real hole, documented in `20260815110000`'s own header, which states closing it was out of scope there | **Fixed in S2, not S6.** These RPCs reach production the moment the cutover migrations land — the exposure starts at go-live, so a November fix would have left it open for two months. Moved forward and costed as workstream 3a |
| **Permissions: 27 UI action keys against 2,012 API grants** | A hidden button prevents nothing | S5. `has_action()` exists and has zero callers; the epic is about giving it callers |
| **The permissions estimate is conditional** on the Postgres-versus-Lambda decision | Could move S5 by weeks | Decide by 9 October, before S5 opens |
| **Report scope was added mid-phase** — about 15 days remaining on it | Adds around three weeks to the close | Flagged for an explicit decision — §8 |
| Pete's 24-month data has not arrived | Delays the historical close, not the build | Sequenced last, in S4; everything else proceeds regardless |

---

## 8. Decisions requested

1. **Authorise the cutover approach in §3** — fix the ledger key, audit at object level, and write
   production variants where a file cannot run as it stands, before anything is applied. The
   alternative, running the bulk script over 47 files, stops dead on the first one that reads a column
   production no longer has.
2. **Close the two-week capacity gap** (§4). Our recommendation is to move the Sales & Production
   Report into its own phase: it is 15 days, it was not in the original Phase 2 proposal, and it is the
   only option that closes the gap outright rather than absorbing it into a slip.
3. **Approve the 18 September go-live.** It puts six weeks of production-untested work in front of users
   at once. The alternative is a staged rollout, which pushes every later milestone.
4. **Choose the permissions enforcement location** — Postgres functions or the Lambda proxy — before
   9 October. It is the one open decision that can still move the schedule by weeks.
5. **Note, rather than decide: the anon-key fix has been moved into S2.** We are flagging it because it
   is a security change landing in the same sprint as go-live rather than being deferred, and because
   the alternative — shipping the WhatsApp RPCs in September and fixing them in November — is not one we
   are willing to recommend.

---

## 9. Definition of done

Phase 2 closes when every line below is true in **production**, not on `dev`.

| Criterion | Verification |
|---|---|
| Leadership uses the dashboard and daily report as their primary operational check | Paul confirms daily use for two consecutive weeks after go-live |
| Red flags prevent stock-outs | An alert fires below threshold, is received, and clears on recovery |
| Oil consolidated batches in live use with lab results attached | At least one consolidation in production with a real lab document |
| Two years of history visible in trend charts | A 24-month range in the production trends chart, signed off by Pete |
| Colleagues can message each other 1:1 | At least one real 1:1 conversation used operationally |
| The monthly Sales & Production report is produced from the portal | Pete issues a published, non-draft report for a full month |
| A denied button cannot be bypassed via the API | Role-by-role UAT: the button and the API give the same answer |
| The production schema matches the repository | The audit script from §3 reports zero unexplained differences |

---

## 10. The next five working days

| Day | Action | Owner |
|---|---|---|
| Mon 24 Aug | Start the object-level production audit (§3 step 1), including the function-definition comparison for the 20 body-only files | Dev |
| Mon 24 Aug | Start the 9 report sections — the four "Small" ones first, since their data sources already exist | Dev |
| Mon 24 Aug | Send Pete the March FYE 2026 query and the valuation-source request | Henry |
| Tue 25 Aug | Fix the `version`/`name` key mismatch in the apply scripts (§3 step 2) — it is a small change and every later step depends on it | Dev |
| Wed 26 Aug | Audit complete; circulate the classification of all 47 migrations | Dev |
| Thu 27 Aug | Ledger reconciled; production variant written for `20260708130000` and any sibling the audit finds | Dev |
| Fri 28 Aug | Pete's two answers due. Oil-production dataset started. **Decisions 1 and 2 (§8) needed from Paul** to keep S2 on its date | Pete / Paul / Dev |

---

*Verified 2026-08-21 against `dev` at `56b38c1`, 331 migration files, and production `sofanhfpxifgdtooefzq`.*
