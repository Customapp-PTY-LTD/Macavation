# Macavation Phase 2 — Scope, Schedule, Delivered and Outstanding Work

**Issued:** 2026-08-18 · **Author:** CustomApp delivery (Henry) · **Audience:** Macavation leadership (Paul, Pete, Josslyn, Mark), CustomApp delivery

**This document supersedes `PHASE2_IMPLEMENTATION_PLAN.md`** for scope, status and scheduling. That
plan's per-epic "Remaining work" tables describe the pre-July state and list work that is already
built — `CLAUDE.md` already flags it as stale. Everything below was re-verified against the `dev`
branch, the migration set, and the live production database on 2026-08-18.

---

## 1. Where Phase 2 actually stands

Phase 2 is roughly **two thirds built and almost none of it is in production yet.** That is the
single most important fact in this document.

| | Evidence (verified 2026-08-18) |
|---|---|
| Work done since Phase 2 opened | **213 commits and 95 migrations** since 1 June 2026 |
| `dev` branch | Auto-deploys to `dev-macavation.customapp.co.za`; carries the full Phase 2 build |
| `demo` and `prod` branches | Both stopped at 2026-08-13 — **41 commits behind `dev`** |
| Production database | Migrations applied through `20260818090400`; **20 report-builder / data-page migrations not applied** |
| `pg_cron` on production | **Not installed** — nothing is scheduled: no daily digest, no stock-alert evaluation |
| Daily digest subscribers on production | **0** — the email digest has never sent to a real recipient |
| Dashboard targets on production | 4 rows |
| Open (unresolved) stock alerts on production | 40 |
| Action permission keys / role grants | 27 keys, 95 grants — all **UI-only**, no server-side enforcement |
| Local `dev` checkout | 3 commits ahead of `origin/dev` (today's PDF-export work), not yet pushed |

The gap between "built" and "in Macavation's hands" is now the critical path, not the feature
backlog.

---

## 2. What is already delivered

Each count is the number of items delivered against the total for that workstream — every one of
them is spelled out either in the list below it or in §5. Everything here was verified in the code
or the database on 2026-08-18.

**Overall: 70 of 126 items delivered.**

| # | Workstream | Items done | Days left |
|---|---|---|---|
| 0 | Production cutover | 0 of 7 | 3 |
| 1 | Historical data | 7 of 10 | 7–8 |
| 2 | Advanced permissions | 6 of 12 | 17 |
| 3 | Messaging and chat | 8 of 11 | 4–5 |
| 4 | Stock red-flag alerts | 6 of 11 | 3–4 |
| 5 | Daily reporting | 4 of 9 | 4 |
| 6 | Dashboard | 8 of 12 | 6–7 |
| 7 | Shell waste | 4 of 8 | 7 |
| 8 | Grower intake and procurement | 4 of 7 | 4–5 |
| 9 | Oil module | 5 of 10 | 6–7 |
| 10 | Sales &amp; Production Report *(added scope)* | 10 of 17 | 19 |
| — | Cross-cutting (guides, UAT, training) | 0 of 4 | 11 |
| — | Platform and carry-over fixes | 8 of 8 | — |

A count treats a half-day item the same as an eight-day one, so read it alongside the days-left
column, which carries the weight.

### 2.1 Historical data

- Kernel historical import: database function, CLI helper and a portal import modal on Kernel Stock
- Procurement CSV import script
- Oil stock-on-hand seeded from a real workbook — about 818 rows covering Apr 2024 to Dec 2025
- **Nut-in-shell procurement history loaded and reconciled** — 1,201,217 kg, matching the workbook's
  own grand total, with 11 of 12 FYE 2026 months exact
- **Kernel sales history loaded** — 278 lines, tracking Pete's sheet to within two cents across
  FYE 2026
- Oil export register seeded
- Import runbook and sign-off checklist written

### 2.2 Advanced permissions

- Three permission layers live: API-level execute grants, module and screen visibility, and
  button-level actions
- Admin UI for all three — Roles &amp; modules, with per-role Customize and role-scoped editing
- 27 action keys wired across roughly 9 modules, with 95 role grants
- 8 active roles after the July cleanup: super user, admin, Shareholder, Sales Exec, Factory Manager,
  Production Manager, Palladium Manager, Quality Assurance
- Direct anonymous table access revoked at the database
- `has_action()` server-side gate written — the primitive for enforcement, not yet called

### 2.3 Messaging and chat

- Notifications with read tracking, and the header inbox bell
- Compose screen for broadcast, per-role and per-user messages
- **Entity links** — attach a batch, stock lot or delivery; the inbox shows a badge and resolves the
  link to the right screen
- Automatic notification when a new stock red flag is raised
- **Internal 1:1 staff chat** — conversations, messages, participants and read state, with
  participant-based privacy
- **WhatsApp outbound send** through CustomApp's Control Room gateway
- **WhatsApp inbound shared team inbox** on +27 71 463 9643 — profile names, duplicate-safe ingest,
  visible to any user holding the WhatsApp action
- Staff WhatsApp number enrolment, inbound command handling, and a command log

### 2.4 Stock red-flag alerts

- Alert rules admin UI, configurable per product and style
- Evaluation function feeding the dashboard alert list and raising an in-app notification
- Acknowledge and resolve, with automatic clearing when stock recovers
- Raw nut-in-shell included in stock-on-hand collection
- Default thresholds seeded for kernel styles 0 and 1, oil, protein and shell
- Scheduled evaluation function written (not yet scheduled — see §5.5)

### 2.5 Daily reporting

- Scheduled Reports table and admin module
- Digest content function returning kernel stats, oil stats, open alerts, procurement today, runway,
  extended KPIs and produced-versus-target — broader than the original content checklist
- Email delivery function (Resend)
- WhatsApp delivery function (Control Room) — **the Meta Business API blocker is gone**

### 2.6 Dashboard

- Three role-partitioned dashboards (default, Palladium integrator, executive)
- Six live charts: production trends, oil production trends, oil production forecast, raw-material
  runway forecast, stock accuracy, and stock-on-hand history
- Produced-versus-target widget with a generic targets admin module
- Procurement and forecast chart
- Consolidated-batch summary widget (oil)
- Executive KPIs and active-batch counts
- Nut-in-shell runway forecast including full-depletion projection
- Recovery and yield KPIs — sound kernel recovery, oil yield, months of cover

### 2.7 Shell waste

- Shell stock lots and a movement ledger, with manual CRUD on the Kernel Stock screen
- **Shell lots created automatically from production** — per-bag weighing at the cracking stage feeds
  the stock lot, matching how shell is recorded operationally
- A shell alert rule type
- Shell and production tab on the data page

### 2.8 Grower intake and procurement

- Procurement calendar with month view, drag-to-reschedule and convert-to-batch
- Stream-level mass balance and weekly procurement variance calculations (built, not yet surfaced)
- Per-batch mass balance on the kernel job card
- Nut-in-shell intake dataset and tab, with procurement tracking backfilled

### 2.9 Oil module

- Oil batch search with date-range and status filters
- Consolidated batches with members, lab reference and notes, and full CRUD
- Oil bins, streams, shift segments, FFA tests and raw-ingredient links
- Oil batch header editing; raw-ingredient suppliers visible from Find a Batch
- Oil export register channel and seed data

### 2.10 Sales &amp; Production Report *(added scope)*

- **Report engine foundations** — 23 registered sections, a 50-entry metric registry, weekly and
  monthly templates, and period helpers
- **Report instances with targets** — draft lifecycle, immutability once issued, content hashing for
  tamper-evidence, and publish/supersede functions on the database side
- Permissions migration and grants, including Sales Exec and Palladium Manager
- **Report list and report editor** — per-section enable/disable, commentary, metric overrides,
  refresh figures, and template sync for sections registered after a draft was created
- **Data page** — five editable datasets (daily production, kernel sales, oil and protein sales, oil
  export register, nut-in-shell intake) with autosave, drift detection against the live system, and
  financial-year defaults
- Resolvers that read only the data page, so a report figure has one traceable source
- Kernel Stock Report section — per-style tally plus the stock-on-hand history chart, with a
  cartons/kg switch
- Three tracking tables — nut-in-shell procurement, sound kernel recovery and kernel sales — each
  financial year against the prior year
- Kernel sales by style, with item-code mapping held as correctable data rather than in code
- **PDF export** with a draft watermark, using a lazily loaded renderer

### 2.11 Platform and Phase 1 carry-over fixes

- Application tree consolidated — `WebPortal/` is now the only tree; duplicate and dead files removed
- Automated build gate: hermetic test suite, UI standard verifier, migration prefix and registry
  checks — a new violation blocks a merge
- Agent Fleet delivery pipeline with plan submission rules and a pre-flight gate
- CRM contact saving fixed; contact functions now persist every live column
- Batch editing from Find a Batch, for kernel and oil
- One grower dropdown instead of a dropdown plus a free-text twin
- Stock-on-hand history now records who changed stock and when
- Kernel cracking-kg helpers, so one definition of cracked weight feeds every screen

---

## 3. Scope of the remainder

Ten workstreams. Workstream 10 is the addition; the rest are the original epics, re-scoped to what is
genuinely left.

| # | Workstream | Remaining | Notes |
|---|---|---|---|
| 0 | **Production cutover** | 3 d | 41 commits, 20 migrations, `pg_cron`, edge functions and secrets |
| 1 | Historical data | 7–8 d | Oil import path; Pete's batch-level 24 months; data audit sign-off |
| 2 | Advanced permissions | 17 d | Server-side enforcement plus 7 ungated modules — **largest single item** |
| 3 | Messaging and chat | 4–5 d | Polish, UAT, and one security fix (see §6) |
| 4 | Stock red-flag alerts | 3–4 d | Grid badges, live schedule, remaining thresholds, triage the 40 open alerts |
| 5 | Daily reporting | 4 d | Deploy, schedule, recipients; the WhatsApp channel is now unblocked |
| 6 | Dashboard completion | 6–7 d | Targets and deltas for the remaining KPIs, kernel consolidated widget |
| 7 | Shell waste | 7 d | Dispatch workflow, movement history UI, reconcile duplicate inputs |
| 8 | Grower intake and procurement | 4–5 d | Surface the mass-balance and variance calculations that already exist |
| 9 | Oil module | 6–7 d | Lab document upload, release workflow, role grants |
| 10 | **Sales & Production Report** *(added scope)* | 19 d | 9 report sections still have no data source; publish workflow; oil dataset |
| — | Cross-cutting (guides, UAT, training) | 11 d | The user guide is about 6 d of that |

**Total remaining: ~90 developer-days.** At the documented capacity of one full-stack developer at
five days a week, that is **about 18 working weeks**. The schedule below compresses it to 17 by
running business-gated items alongside build work.

**Explicitly out of scope for Phase 2** — candidates for Phase 3: purchase-order and grower-contract
tracking, full Palladium integration (IBTs, GRVs, stock movements), silo automation, pricing and
grower-statistics automation, GMP forms, and predictive (statistical) forecasting.

---

## 4. Schedule

Capacity assumption: **one full-stack developer, five days a week**, starting 2026-08-18. Business
inputs (§7) are assumed to land on the dates shown; each slip moves its dependent milestone.

**There is deliberately no fixed sign-off date.** The sprint dates below are planning dates that
sequence the work and give the near-term milestones something to hold to, not a commitment to finish
on a particular day. Several estimates still carry open decisions — permissions most of all — and a
close date quoted before those are answered would be a guess presented as a promise.

| Sprint | Dates | Focus | Exit milestone |
|---|---|---|---|
| **S0** | Tue 18 Aug – Fri 21 Aug | Land the in-flight report work: push today's PDF-export commits, publish/supersede workflow, automated render checks | A report can be issued, not just drafted |
| **S1** | Mon 24 Aug – Fri 4 Sep | Report completion: the 9 sections that still read "Not available yet", the oil-production dataset, Pete's review of the July and August reports | **Pete signs off the monthly report** |
| **S2** | Mon 7 Sep – Fri 18 Sep | **Go-live**: promote `dev` → `demo` → `prod`, apply 20 migrations, install `pg_cron`, deploy and schedule the email and WhatsApp digests, stock-alert schedule and grid badges, thresholds and targets workshop | **Leadership go-live — dashboard, digest and alerts live in production** |
| **S3** | Mon 21 Sep – Fri 2 Oct | Kernel upstream: procurement workspace UI, shell waste dispatch, movement history, reconcile the two shell inputs | Procurement workspace and shell dispatch usable |
| **S4** | Mon 5 Oct – Fri 16 Oct | Oil module (lab upload, release workflow, role grants) and historical data (oil import path, Pete's 24-month kernel load, data audit) | **Full operational scope live; two years of history in the charts** |
| **S5** | Mon 19 Oct – Fri 13 Nov *(4 weeks)* | Permissions: module audit, role matrix workshop, enforcement-location decision, roll out to the 7 ungated modules, server-side enforcement, role-by-role UAT | **A denied button cannot be bypassed via the API** |
| **S6** | Mon 16 Nov – Fri 27 Nov | Dashboard completion, messaging polish, security hardening | Dashboard KPI set complete |
| **S7** | From Mon 30 Nov | Close-out: user guide, training session, full UAT against the success criteria, final production cutover | **Phase 2 sign-off — no fixed date** |

### Client-facing milestone dates

| Date | Milestone |
|---|---|
| **Fri 4 September 2026** | Monthly Sales & Production report signed off by Pete |
| **Fri 18 September 2026** | Leadership go-live: dashboard, daily digest and stock alerts running in production |
| **Fri 16 October 2026** | Full operational scope in production, including two years of history |
| **Fri 13 November 2026** | Permissions enforced end to end |
| **Not fixed** | **Phase 2 sign-off** — when the remaining work and UAT are complete. On current capacity close-out starts around the end of November; we will set a date once S5 (permissions) is scoped against the confirmed role matrix |

---

## 5. Outstanding work, in detail

Everything below was verified against the code, the migrations, or the production database today.

### 5.1 Production cutover — blocks everything else (3 d)

The build is three weeks ahead of anything Macavation can see. Nothing else in this plan reaches a
user until this lands.

- [ ] Push the 3 local commits and merge to `origin/dev`
- [ ] Promote `dev` → `demo` (41 commits) and validate there. Note that demo shares the dev database,
      so demo proves the **code**, never the production schema — the schema is only ever proved on
      production itself
- [ ] Promote `demo` → `prod`
- [ ] Apply the 20 outstanding migrations (`20260817090000` through `20260821170000`) **one file at a
      time**. They are written idempotently, but the bulk apply path re-stamps its own version and can
      replay a file, so each one is applied and verified individually
- [ ] Install `pg_cron`. Without it nothing is scheduled at all — both the digest and the stock-alert
      evaluation are cron-driven
- [ ] Deploy five edge functions: `send-daily-digest`, `send-daily-digest-whatsapp`,
      `evaluate-stock-alerts-cron`, `send-whatsapp-message`, `whatsapp-inbound`
- [ ] Configure four production secrets: `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`,
      `CONTROL_ROOM_CHANNEL_SLUG`, `CONTROL_ROOM_FORWARD_SECRET`
- [ ] Re-point Control Room's `macavation-9349` channel from the dev project to production. Until
      that changes, inbound WhatsApp messages land in dev and production's inbox stays empty

**Done when:** a report opens on production, the digest sends on schedule without intervention, and
an inbound WhatsApp message reaches the production inbox.

### 5.2 Sales & Production Report (19 d)

The engine works and the July report reconciles to Pete's sheet. What is left is the half of his
workbook that has no data source behind it, plus the lifecycle that turns a draft into an issued
document.

**Publish and supersede — 1.5 d.** The database functions exist and are granted to every role;
nothing in the portal calls them. Four consequences today: every PDF carries a DRAFT watermark, the
content hash that makes a report tamper-evident is never computed, the immutability trigger that
protects an issued report never engages, and there is no way to correct a report once it has gone
out. Needs two buttons, enabling driven by the report's own status, a confirmation that states
plainly that publishing freezes the figures and cannot be undone, and a supersede flow that collects
a reason and lands the user on the resulting new draft. *(Plan written, ready to build.)*

**Automated render checks — 1 d.** Four line types and the whole tracking-table renderer have no test
at all, and the next planned change refactors exactly that code. The check covers: column headers per
line type; totals that sum quantities and values but must never sum a unit price or an exchange rate;
a null variance rendering blank rather than `0%`, which would falsely claim two years were equal; an
unrecognised line type degrading instead of throwing; and the draft watermark appearing only on
drafts. *(Plan written, ready to build.)*

**Nine sections still read "Not available yet" — about 8 d.** Grouped by what each one needs:

| Section | What would feed it | Effort |
|---|---|---|
| Kernel Stock on Hand | The per-style tally already written for the Kernel Stock Report — promote it to a shared line source | Small |
| Oil & Protein Stock on Hand | `get_oil_stock_lots`, which already backs the stock screen | Small |
| Raw Material Stock on Hand | Oil feedstock lots; the weeks-of-cover calculation already exists | Small |
| Nut-in-Shell Stock on Hand | **Needs a definition first.** Uncracked NIS is intake minus cracked, and no such pool is tracked as a stock level today | Medium |
| Upcoming Sales | Committed kernel and oil dispatch orders, by customer and style | Medium |
| NIS Procurement Pipeline | `get_kernel_intake_procurements` and `get_procurement_forecast_by_week` | Small |
| Forward Month Planning | Combines stock, forecast production, orders and surplus/deficit by style — all three forecast functions exist | Large |
| Kernel, Raw Material and Oil **Stock Reports** | **Blocked — see below** | — |

**The three Stock Report sections are blocked on a business input, not on development.** Each is
specified as *stock, cost price and book value*. There is **no cost price, unit cost or book value
anywhere in the system** — not in kernel stock, not in oil stock lots, nowhere. These sections cannot
be built until Macavation supplies a valuation source, whether that is Palladium or Pete's finance
sheet. The Kernel Stock Report currently shipped shows the per-style tally and the stock-on-hand
history chart instead, which is the useful half of it.

**Six oil-production metrics render blank — about 3 d.** The Oil Processing table draws with six
empty rows: Cosmetic Oil Produced, EV Oil Produced, B-grade Produced, Protein Produced, Filter Fines
Produced and Cake Produced. There is no oil production dataset on the data page, and inventing a
source would be worse than an honest blank. Needs a data-page dataset mirroring daily production,
then a resolver pointing the six metrics at it.

**PDF archive — 2 d.** The generated PDF is downloaded, not kept. The storage columns exist on the
report and are deliberately left empty. An issued report should hold the exact file that was issued.

**Weekly template validation — 2 d.** Only the monthly template has been run against a real sheet.
The weekly template includes the Forward Month grid, one of the sections above.

**March FYE 2026 ruling — Pete, no development.** His sheet claims 138,371.50 kg where both source
sheets hold four deliveries totalling 18,434.50 kg. The figure is within R0.50 of his own May figure,
so it reads as a formula error rather than 119,937 kg of unrecorded nut. Nothing gets built here; it
needs his answer before sign-off.

### 5.3 Permissions (17 d) — the biggest remaining block

The button layer and the API layer disagree, and the API layer is the one that decides.

**Server-side enforcement.** `has_action()` was written this month and has zero callers. A hidden
button does not prevent the operation: six of the eight roles hold a couple of action keys but 186 or
more API grants each, so anyone who can reach the underlying operation can run it. Closing this is
the whole point of the epic.

**The architecture decision comes first, and it moves the estimate.** Either:

- **In the database functions** — fully controllable from this repository, but some functions bundle
  several actions behind one entry point (edit, approve and finalise a job card all go through the
  same call), so those need splitting or an embedded per-action lookup; or
- **In the external Lambda proxy** — `auth/rbacChecker.js`, which is not part of this repository.
  Ownership and whether it is in scope have to be confirmed before this path can be costed.

**Seven modules have no action gating at all.** What matters in each:

| Module | Operations that need gating |
|---|---|
| CRM | Creating and editing customer and supplier records |
| Document Management | Uploading and deleting documents and categories |
| Supplier Intake | Receiving weights — the figures that feed mass balance |
| Oil Dispatch | Creating a dispatch, which deducts stock |
| Palladium Integration | Stock movement export |
| Financial Management | All of it |
| Sales Forecasting | Creating and editing forecasts |

**Also outstanding:** cataloguing the full action set (27 keys today, 35–45 expected); the role matrix
workshop, which has to happen before grants can be seeded; and a role-by-role UAT — logging in as each
of the eight roles and confirming both layers agree.

**Done when:** every sensitive action has a paired grant and server-side check, and a denied user gets
the same answer from the button and from the API.

### 5.4 Daily reporting (4 d)

- [ ] **Deploy and schedule the email digest.** The content is already broader than the original
      checklist — kernel stats, oil stats, open alerts, procurement today, runway, extended KPIs and
      produced-versus-target. It has simply never run on a schedule against a real recipient
- [ ] **Populate the recipient list.** Zero subscribers on production today; Paul supplies the list
      and it goes in through the Scheduled Reports admin screen
- [ ] **Activate the WhatsApp digest.** The send path is already live for chat, so this is
      configuration rather than build — numbers, secrets and a schedule
- [ ] **Fix the Scheduled Reports screen**, which shows a "Live" badge next to a "WhatsApp delivery is
      not live yet" disabled banner. Neither statement matches the code any more
- [ ] End-to-end test against the real list, including at least one WhatsApp recipient

**Done when:** Paul receives the digest for five consecutive working days without anyone intervening.

### 5.5 Stock alerts (3–4 d)

- [ ] **Get the evaluation onto a schedule.** Nothing runs it today — alerts refresh only when
      somebody opens a stock screen, so an overnight stock-out is found by whoever happens to open
      that screen next
- [ ] **Low-stock badge on the grids.** Alerts surface on the dashboard and the notification bell but
      never on the stock row itself, which is where somebody working the screen would look
- [ ] **Seed the remaining thresholds** — kernel styles SP, 1S, 4L, 5, 6, 7/8, Butter High and Low,
      plus raw nut-in-shell. The mechanism is configurable per material already; only the values are
      missing, and they come from Josslyn and Mark
- [ ] **Triage the 40 open alerts on production.** A digest that opens with 40 stale red flags teaches
      people to ignore it. This is a business review, not a code change
- [ ] **Open decision:** what "raw ingredient stock" means. It could be the oil feedstock category that
      already exists and is already wired, or an aggregate wet nut-in-shell awaiting-processing pool —
      which does not exist as a countable level today, because intake batches flow one by one rather
      than sitting in a pool. The second reading is new scope

### 5.6 Shell waste (7 d)

- [ ] **Dispatch and sales workflow.** Today it is a status flip plus a free-text reference, with no
      link to a customer or an invoice. Decide between lightweight (2 d) and integrated with CRM and
      invoicing the way kernel and oil dispatch are (3 d)
- [ ] **Movement history view.** The ledger has been written to since the feature shipped and has
      never been displayed anywhere
- [ ] **Reconcile the two shell inputs.** Per-bag weighing at the cracking stage feeds the stock lot;
      a separate manual "Shell (kg)" field on the kernel job card feeds only that card's own mass
      balance. Nothing reconciles them, so the two can drift, or the same shell can be counted twice
- [ ] **Replace free-text batch linkage with a real key.** A shell lot links to its kernel batch by
      matching a typed batch number, so a typo silently creates a duplicate lot instead of adding to
      the existing one

### 5.7 Grower intake and procurement (4–5 d)

- [ ] **Build the procurement workspace.** Planned versus actual versus variance, plus a this-week
      summary card. Both calculations already run in the database and neither has ever been displayed —
      this is surfacing work, not modelling work
- [ ] **Switch "actual received" to the weighbridge figure.** The calculation currently uses the
      grower-declared weight; the weighbridge-confirmed weight is already captured on the receiving
      checklist and is the trustworthy one. Do this before building a variance screen on top of it
- [ ] Bulk import screen for historical procurement rows — the script already exists
- [ ] **Flagged as out of scope:** no purchase-order or grower-contract concept exists anywhere in the
      system. If "procurement workspace" is meant to include agreed price per kg, PO numbers, supplier
      acceptance or invoicing linkage, that is a separate and much larger piece of work

### 5.8 Oil module (6–7 d)

- [ ] **Real lab-document upload on a consolidated batch.** Today the lab result is a free-text
      reference, so the actual certificate is not attached to anything. Reuses the upload helper
      already used by document management and the kernel QA end-sample modal — a well-precedented
      task, not new infrastructure
- [ ] **Wire up the remove-member and delete-consolidated-batch operations.** Both are built and
      granted; neither is reachable from any control in the UI
- [ ] Expose the grade field in the create and edit dialogs — it exists on the record and is not shown
- [ ] **Grant consolidated-batch management beyond admins.** Only admins can use the feature today,
      which means the QA and production people who actually consolidate cannot
- [ ] Release workflow polish — status transitions and stock linkage

### 5.9 Historical data (7–8 d)

- [ ] **Oil historical import.** Mirror the kernel pattern: import function, CLI helper, portal modal.
      The only oil history today came from a one-off seed migration off a workbook, and it is patchy —
      several months are missing entirely
- [ ] **Pete's batch-level 24 months.** Staging import, duplicate check, spot-check, then the
      production import. Worth noting what is already covered: nut-in-shell procurement and kernel
      sales history are loaded and reconciled through the data page. What is still missing is
      batch-level kernel production
- [ ] Live data audit, then sign-off from Pete, Josslyn and Paul

### 5.10 Dashboard (6–7 d)

- [ ] **Targets for the four KPIs that have none** — sound kernel recovery, oil yield, months of cover
      and stock accuracy. The targets admin and the comparison widget both exist and work; these four
      have no target rows behind them and so show a number with nothing to judge it against
- [ ] **Period-over-period deltas across the KPI cards.** Production has a "vs last month" delta; the
      rest do not, so a card shows a value with no direction
- [ ] Kernel-side consolidated-batch summary widget — oil has one, kernel does not
- [ ] **Two definition decisions that could cause rework.** "Raw material runway" currently measures
      finished kernel stock against open customer demand, not raw-material depletion netted against
      production and procurement. "Stock accuracy" currently measures the share of monthly stock that
      was manually adjusted — an inventory-correction rate, not month-on-month change. Both are useful
      as they stand, but neither is what the original requirement literally describes

### 5.11 Messaging (4–5 d)

- [ ] **Operational UAT.** Zero conversations on production — nobody has used 1:1 chat or the WhatsApp
      shared inbox in anger yet, so nothing about either is proven in real use
- [ ] **Security fix.** The WhatsApp operations take the user id as a caller-supplied parameter, and
      the browser calls them as an anonymous role, so the public key is enough to act as another user.
      Identity must be derived server-side from the verified phone number instead
- [ ] User guide and training for both

### 5.12 Cross-cutting (11 d)

- [ ] User guide updates across every new screen, then run the help-link script (~6 d)
- [ ] Full UAT against the Phase 2 success criteria (2 d)
- [ ] Training session (1 d)
- [ ] Final production cutover and sign-off (2 d)

---

## 6. Risks

| Risk | Impact | Handling |
|---|---|---|
| **Everything built since 13 August is production-untested** — 41 commits and 20 migrations land in one go | A bad cutover lands on live operations | Promote through `demo` first and validate there; apply migrations one file at a time |
| **Anon-key RPC exposure.** The browser calls RPCs as `anon`, and the WhatsApp RPCs take the user id as a caller-supplied parameter, so anyone holding the public key can pass an arbitrary UUID | A real security hole, already documented in migration `20260815110000` | Derive the user id server-side before those RPCs trust it; fold into §5.11 |
| **The permissions estimate is conditional** on the Postgres-versus-Lambda decision | Could move S5 materially | Decide before S5 opens, by 9 October |
| **Pete's batch-level 24-month data has not arrived** | Delays the historical-data close, not the build | Already sequenced last, in S4; everything else proceeds regardless |
| **Report scope was added mid-phase** and is about 19 days | Adds roughly four weeks to the close | Flagged for an explicit decision — see §8 |
| **40 unresolved production alerts** | If people already ignore alerts, go-live changes nothing | Triage before the digest goes live, not after |

---

## 7. What we need from Macavation, and by when

| Input | Owner | Needed by | Blocks |
|---|---|---|---|
| Ruling on the March FYE 2026 procurement figure | Pete | Fri 28 Aug | Report sign-off (S1) |
| **Stock valuation source — cost price and book value per style** | Pete / finance | Fri 28 Aug | The three Stock Report sections, which cannot be built without it |
| Sign-off on the July and August monthly reports | Pete | Fri 4 Sep | S1 exit |
| Daily digest recipient list — email addresses and WhatsApp numbers | Paul | Fri 11 Sep | Go-live (S2) |
| Alert threshold values per material | Josslyn and Mark | Fri 11 Sep | Go-live (S2) |
| Monthly dashboard targets per product line | Paul | Fri 11 Sep | Go-live (S2) |
| Decision: what "raw ingredient stock" means for alerts | Business | Fri 11 Sep | S2 |
| Decisions: definitions of "raw material runway" and "stock accuracy" | Paul | Fri 2 Oct | S6 |
| Permission role matrix — who may create, edit, approve and adjust stock, per role | Business and CustomApp | Fri 9 Oct | S5, the largest workstream |
| Pete's batch-level 24-month kernel dataset | Pete | Fri 2 Oct | S4 |
| Ownership of `auth/rbacChecker.js` — is the Lambda proxy in scope? | CustomApp and Macavation | Fri 9 Oct | The S5 estimate |

---

## 8. Decisions requested

1. **Confirm the Sales & Production Report sits inside Phase 2.** It is about 19 days of work that
   was not in the original Phase 2 proposal. Keeping it in adds roughly four weeks to the close;
   moving it to its own phase takes those four weeks back.
2. **Approve the 18 September go-live.** It puts three weeks of production-untested work in front of
   users at once. The alternative is a slower staged rollout, which pushes every later milestone.
3. **Choose the permissions enforcement location** — Postgres functions or the Lambda proxy — before
   9 October. It is the one open decision that can move the schedule by weeks.

---

## 9. Success criteria

| Criterion | Verification |
|---|---|
| Leadership uses the dashboard and daily report as their primary operational check | Paul confirms daily use for two consecutive weeks after go-live |
| Red flags prevent stock-outs | An alert fires below threshold, is received, and clears on recovery |
| Oil consolidated batches in live use with lab results attached | At least one consolidation in production with a real lab document |
| Two years of history visible in trend charts | A 24-month range in the production trends chart, signed off by Pete |
| Colleagues can message each other 1:1 | At least one real 1:1 conversation used operationally |
| The monthly Sales & Production report is produced from the portal | Pete issues a published, non-draft report for a full month |
