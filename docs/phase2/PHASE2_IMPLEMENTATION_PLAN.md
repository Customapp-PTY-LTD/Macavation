# Macavation Phase 2 — Implementation Plan

## Re-baseline note (2026-07-27)

This document was originally written in commit `a592293` (2026-07-06) and last touched
2026-07-07. Development continued after that without the doc being updated, so several of its
claims drifted out of sync with the code in **both directions** — some items marked "remaining"
were already done, and at least one item marked "Implemented" (oil historical import RPC) was not.

This is a full re-baseline, not an incremental status update: every epic below was re-verified
against the current code. Calendar dates and the Gantt chart have been removed — there is no fixed
external deadline for Phase 2, so this is now a **prioritized, sequenced backlog with effort
estimates**, not a schedule. Companion docs (`BUSINESS_KICKOFF_CHECKLIST.md`,
`PROD_CUTOVER_CHECKLIST.md`, `UAT_ACCEPTANCE_CHECKLIST.md`, `UAT_VERIFICATION_CHECKLIST.md`,
`PETE_HISTORICAL_DATA_TEMPLATE.md`, `KERNEL_HISTORICAL_IMPORT_RUNBOOK.md`, and the HTML stakeholder
site) were **not** touched in this pass — treat them as due for their own follow-up review.

## Implementation status (re-verified 2026-07-27)

| Deliverable | Status |
|-------------|--------|
| Dashboard KPIs (recovery, yield, SOH, consolidated summary, oil forecast, SOH history) | Implemented |
| Stock alert resolve + auto-clear + `nis_raw` collection | Implemented in code |
| Stock alert scheduled evaluation (cron edge function) | Implemented in code; **no confirmed active schedule** in any environment — currently only re-evaluates when a stock screen is opened |
| Email daily digest (schema, RPC, edge function) | Implemented in code; not yet deployed/scheduled in production; recipient list not yet populated |
| WhatsApp daily digest (Meta Cloud API edge function) | **Fully implemented in code**, not a stub — blocked on Meta Business API account approval; admin UI has a stale "not live yet" banner that no longer matches the code |
| Mass balance (NIS-in vs cracked/packed) + procurement variance RPCs | Implemented in the database; **zero UI callers** anywhere — dead/unsurfaced |
| Shell auto-lot creation from production stages | Implemented (confirmed both in code and operationally — shell is already recorded on production sheets in the kernel pipeline) |
| Shell dispatch workflow | Only a bare status flip + free-text reference; not integrated with the real CRM/invoicing dispatch flow used by kernel and oil |
| Messaging — entity links (`link_route`/`link_params` on notifications) | Partial — schema supports it; picking/showing a linked batch, stock lot, or delivery in the compose/inbox UI is not confirmed wired end-to-end |
| Messaging — 1:1 direct chat (WhatsApp-style) | **Not built — new scope added this pass**, see Epic 3 |
| Oil batch search (date range + status filters) | Implemented (UI already wired — previous doc incorrectly listed this as remaining) |
| Permissions — action keys + admin UI (`actions`/`role_actions`) | Implemented for ~9 of ~30 modules (~20-25 keys); several modules (CRM, Financial Management, Sales Forecasting, Document Management, Palladium Integration, Supplier Intake, Oil Dispatch) have no action gating at all |
| Permissions — server-side (API/DB) enforcement of actions | **Not implemented.** A user can bypass a UI-denied action by calling the underlying RPC directly, since `role_actions` is never checked server-side |
| Oil historical import RPC | **Not implemented** — previous doc's "Implemented" claim was incorrect; only the kernel-side equivalent exists |
| Procurement CSV import script | Implemented; not yet used (no procurement history data loaded) |
| Oil consolidated batch — lab test attachment | Free-text reference field only, no real file upload |
| Shell lot movement history | DB table (`shell_stock_movement`) exists and is written to; no UI to view it |
| Pete 24-month historical data | Pending — **confirmed to arrive only after the rest of Phase 2 is built**, not in parallel |
| WhatsApp Meta Business API approval | Status unclear as of this doc's last update — needs a fresh check-in with Macavation IT |

---

**Audience:** Macavation leadership, Pete (data), CustomApp delivery team
**Capacity assumption:** 1 full-stack developer, ~5 days/week on Macavation
**Format:** prioritized backlog with effort estimates — no fixed dates; re-sequence freely as
priorities change
**Sign-off requirement:** Email **and** WhatsApp daily digest both live before Phase 2 close

---

## Executive summary

Phase 1 gave Macavation a working portal for kernel and oil operations. Phase 2 adds **planning
visibility, tighter controls, and smarter alerts** so the system guides daily decisions, not just
records them.

**Where this stands:** most epics are further along than the previous version of this document
credited — several "remaining work" items turned out to already be built. At the same time, a few
items previously marked "Implemented" were not, and one epic (in-app messaging) has picked up a
materially larger scope: the business now wants a 1:1 WhatsApp-style chat view added alongside the
existing broadcast/notification tool, not just entity-link enrichment. Net effect: total estimated
remaining effort is similar to before (~77–93 dev days vs. the prior ~58–72, the increase being
almost entirely the new chat scope), but the *shape* of the remaining work has changed a lot per
epic — several epics now need far less dev work than previously listed, and a handful of open
product decisions need answers before their estimates can be trusted (see "Open decisions" callouts
in each epic).

| Area | Built (re-verified) | Remaining focus |
|------|---------------------|------------------|
| Dashboard enhancements | ~90% | Trend deltas, targets/comparison UI for remaining KPIs, runway/stock-accuracy definition decisions |
| Stock alerts | ~85% | On-screen grid badge, confirm scheduled evaluation, seed remaining default thresholds |
| Daily reporting | ~70% | Deploy to production, populate recipients, WhatsApp still blocked on Business API approval |
| Historical data | ~30% | Oil import RPC/UI, Pete's dataset (arrives after core build) |
| Permissions | ~45% | Server-side enforcement (needs an architecture decision), extend coverage to ungated modules |
| In-app messaging | ~70% of original scope, **0% of new 1:1 chat scope** | Entity link wiring + net-new 1:1 chat feature |
| Grower intake / mass balance | ~70% | Wire already-built RPCs into a real procurement-workspace UI |
| Shell waste | ~65% | Dispatch/sales workflow, movement history UI, reconcile duplicate shell-quantity inputs |
| Oil module | ~85% | Real lab-document upload, wire up already-built remove/delete controls |

**Revised estimated remaining dev effort:** **~77–93 person-days**, plus business-side tasks (Pete
data, WhatsApp Meta approval, threshold/target workshops, role-permission matrix workshop). This is
an engineering-judgment estimate, not a quote — several epics have open decisions (flagged below)
that could move their numbers before work starts.

---

## Where to start

No fixed timeline — these are the highest-leverage first moves, not week-numbered commitments.

### Track A — Verify and deploy what exists (dev, ~3-4 days)

1. Confirm all Phase 2 migrations are actually applied on UAT/production (this could not be
   verified from a read-only repo pass — live Supabase access is needed):
   - `migrations/20260601090000_kernel_intake_procurement.sql`
   - `migrations/20260602110000_dashboard_targets.sql`
   - `migrations/20260602120000_dashboard_forecast_aggregates.sql`
   - `migrations/20260602130000_stock_alerts_and_accuracy.sql`
   - `migrations/20260602140000_oil_consolidated_shell_massbalance.sql`
   - `migrations/20260602150000_notifications.sql`
   - `migrations/20260602160000_scheduled_reports.sql`
   - `migrations/20260629120000_phase2_portal_features.sql`
   - `migrations/20260706100000_phase2_implementation_complete.sql`
   - `migrations/20260707150000_fix_kernel_soh_remaining_by_style.sql`
   - `migrations/20260713160000` / `20260713161000` (stock-on-hand history)
   - `migrations/20260714160000_replace_kernel_stock_on_hand_spreadsheet.sql`
2. Confirm whether `evaluate-stock-alerts-cron`, `send-daily-digest`, and
   `send-daily-digest-whatsapp` edge functions are deployed and actually scheduled anywhere (no
   `pg_cron`/scheduler config was found in the repo — scheduling appears to still require manual
   Supabase Dashboard setup).
3. Smoke-test: executive dashboard, stock alert rules, scheduled reports admin, messaging compose,
   admin action permissions, grower intake procurement calendar, oil consolidated batches.
4. Reconcile the Scheduled Reports admin UI's WhatsApp tab — it currently shows a "Live" badge next
   to a "not live yet" disabled banner, which no longer matches the code (the send function is
   fully built). Decide whether to fix this now or leave it disabled until Meta approval lands.
5. Document any gaps found during the smoke test → feeds the relevant epic's backlog.

### Track B — Business inputs needed (Macavation)

| Item | Owner | Action |
|------|-------|--------|
| Pete historical data | Pete | Confirmed to follow the rest of Phase 2, not run in parallel — kick off using `PETE_HISTORICAL_DATA_TEMPLATE.md` when ready |
| Alert thresholds | Josslyn + Mark | Define min kg per kernel style, oil RM, finished oil, shell — thresholds are configurable per material (already supported), just need values |
| Dashboard targets | Paul | Monthly targets, per product line (kernel/oil) — confirmed granularity; current schema already supports this |
| Report recipients | Paul | Email list first (per decision); WhatsApp numbers once the Business API is approved |
| WhatsApp Business API | Macavation IT | Needs a fresh status check-in — last known status was "pending," several weeks ago |
| Permission role matrix | Business + dev | Which of the 8 active roles may create/edit/approve/adjust-stock per module — needed before Epic 2's server-side enforcement can be scoped precisely |

### Track C — Email digest go-live (dev, ~2 days)

1. Deploy `supabase/functions/send-daily-digest/index.ts` to production.
2. Configure secrets: `RESEND_API_KEY`, `DIGEST_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`.
3. Set up the cron schedule (Supabase Dashboard, or a `pg_cron`/`pg_net` migration if
   infrastructure-as-code is preferred over manual dashboard config).
4. Add 1-2 test subscribers in Scheduled Reports admin; confirm delivery.

WhatsApp digest deployment is a separate, later track — code is ready, but gated on the Business
API approval (Track B).

---

## Epic breakdown

### Epic 1 — Historical data (2 years)

**Goal:** Trustworthy trend charts, runway, and stock accuracy backed by ~24 months of operational
history.

**Already built:**
- Kernel historical import RPC: `migrations/20260403000001_import_historical_kernel_batch.sql`
- CLI helper: `scripts/import-historical-kernel-from-csv.js`
- Portal import modal on the Kernel Stock screen
- Procurement CSV import script: `scripts/import-procurement-from-csv.js` (unused so far)
- One real historical dataset already loaded to production: `oil_stock_lots` seeded from a real
  Excel workbook (`migrations/20260410120000_seed_oil_stock_soh_ye25_xlsx.sql`, ~818 rows,
  2024-04→2025-12, patchy — several months missing entirely). This is oil-only and a one-off
  migration, not a repeatable import path.
- Runbook + sign-off checklist: `KERNEL_HISTORICAL_IMPORT_RUNBOOK.md`

**Remaining work:**

| Task | Est. |
|------|------|
| Build oil historical import RPC + portal UI (mirror the kernel pattern) | 4 days |
| Staging import + validation once Pete's kernel data arrives (duplicate check, spot-check) | 3 days |
| Production import (kernel) | 1 day |
| Procurement history import once data is available | 2 days |
| Shell waste historical import (only if Pete confirms it's tracked separately) | 1-2 days |
| Live data audit (`get_dashboard_data_audit`) + business sign-off | 2 days |

**Epic estimate:** ~13-14 dev days (excludes waiting on Pete's data, which is confirmed to be a
**trailing, non-blocking** track — build the oil import tooling and everything else now; the
kernel/oil production import + validation tasks above simply wait until data arrives).

**Success check:** Two years of history visible in the production trends chart; SOH totals match
Pete's figures within an agreed tolerance; sign-off table completed.

---

### Epic 2 — Advanced permissions

**Goal:** Control buttons and actions (create, edit, approve, adjust stock) per role — enforced in
UI **and** at the API/database layer.

**Already built:**
- Three real permission layers exist (documented in `docs/guides/ROLES_AND_PERMISSIONS_SYSTEM.md`
  and `BluePrint/RBAC_GUIDE.md`): (1) `role_permissions` — function/table-level execute grants,
  enforced server-side by an external Lambda proxy (`WebPortal/index_supabase.js` →
  `auth/rbacChecker.js`, which is **not part of this repository**); (2) `features`/`role_features` —
  module/screen visibility, the layer the original proposal calls "module visibility"; (3)
  `actions`/`role_actions` — button-level, with a frontend helper (`WebPortal/js/action-access.js`,
  `hasAction()`, `data-action-perm` attributes) and an admin UI inside User & Access → Roles &
  modules → Customize.
- ~20-25 action keys seeded across 4 migrations, wired into ~9 modules (Kernel Production, Stock,
  Oil Production, Grower Intake, Quality Assurance, Administration, Dashboard, Messaging, partial
  Kernel Dispatch).
- 8 confirmed active roles after a July 2026 cleanup migration: `super_user`, `admin`,
  `Shareholder`, `Sales Exec`, `Factory Manager`, `Production Manager`, `Palladium Manager`,
  `Quality Assurance`. `super_user`/`admin` are hard-coded to bypass every layer.

**Open decision — this changes the estimate below:** the `actions`/`role_actions` layer is
currently **UI-only** — there is no server-side check tying an action key to an RPC call, so a user
with `role_permissions` execute-grant on a function can call it directly and bypass a UI-denied
action. Closing this requires deciding **where** that check lives:
- Inside each Postgres SECURITY DEFINER function (fully controllable from this repo, but some
  functions like `upsert_kernel_job_card` currently bundle multiple actions — edit/approve/finalize
  — behind one function and would need splitting or an embedded per-action lookup), **or**
- In the external Lambda proxy (`auth/rbacChecker.js`) — not part of this repository; ownership and
  whether it's in scope for this project needs to be confirmed first.

**Remaining work:**

| Task | Est. |
|------|------|
| Audit all modules — catalogue every sensitive button/action (~35-45 keys total) | 2 days |
| Decide enforcement location (Postgres function vs. Lambda proxy) — architecture decision, not dev work | — |
| Migration: seed new action keys + default role grants per the confirmed role matrix | 1 day |
| Wire `data-action-perm` + `hasAction()` guards into the currently-ungated modules (CRM, Financial Management, Sales Forecasting, Document Management, Palladium Integration, Supplier Intake, Oil Dispatch) | 8 days |
| Add server-side per-action enforcement (estimate depends on the decision above; assumes in-Postgres) | 4 days |
| Role-by-role UAT walkthrough | 2 days |
| User guide update | 1 day |

**Epic estimate:** ~18 days (unchanged from the prior estimate, but now explicitly conditional on
the enforcement-location decision above — could shift materially if the Lambda path is chosen).

**Suggested module order:** Stock adjust → Kernel job card approve → Oil production → Grower
intake → Dispatch → Admin destructive ops.

---

### Epic 3 — In-app messaging

**Goal (original):** Internal messaging with read/unread indicators and links to operational
entities.

**Goal (added this pass):** A 1:1 WhatsApp-style conversation view, in addition to the existing
broadcast tool (not replacing it).

**Already built:**
- `notifications`/`notification_reads` tables, header inbox bell (`WebPortal/js/notifications.js`)
- Compose screen for broadcast/role/user notifications (`WebPortal/modules/messaging-compose/`)
- Auto-notification on new stock red-flag alerts
- User identity is already email/UUID-based system-wide (the `users.username` column was already
  dropped) — no phone-number concept exists or is needed anywhere in this system

**Sub-epic A — Entity links (original scope):**

| Task | Est. |
|------|------|
| Extend compose UI: optional link to batch / stock lot / procurement delivery (entity picker) | 2 days |
| Store `link_route` + `link_params` on notification; resolve on click → navigate to the right screen | 1.5 days |
| Show linked-entity badge in the inbox list | 0.5 day |
| User guide update | 0.5 day |

**Sub-epic A estimate:** 4-5 days.

**Sub-epic B — 1:1 direct chat (new scope):**

| Task | Est. |
|------|------|
| Schema: `conversations` + `messages` tables (sender/recipient by user id, timestamps, read state), RLS following the existing coarse read/write-via-RPC pattern | 1.5 days |
| RPCs: create/get conversation, send message, list conversations, mark read, unread counts | 2 days |
| Two-pane WhatsApp-style UI: conversation list (contacts shown by name + email) + message thread + composer | 3.5 days |
| "Start new chat" flow — pick a colleague from the existing user list (all users already have
  email addresses; no manual entry needed) | 1 day |
| Live-ish refresh: poll while a conversation is open (matching the existing notification bell's
  60s-poll pattern — no websockets needed) | 1 day |
| Read receipts / unread badges in the conversation list | 1 day |
| User guide update | 0.5 day |

**Sub-epic B estimate:** ~10.5 days.

**Epic estimate:** ~14.5-15.5 days total.

---

### Epic 4 — Stock red-flag alerts

**Goal:** Configurable thresholds for finished kernel and raw ingredient stock; visible on stock
screens and the dashboard.

**Already built (more than previously credited):**
- `stock_alert_rules` admin UI, configurable per product/style — matches the confirmed requirement
  that thresholds be configurable per material, not a single global number
- `evaluate_stock_alerts` RPC → `dashboard_alerts` → auto in-app notification trigger
- **Alert acknowledge/resolve UI, auto-clear on recovery, and `nis_raw` added to SOH collection are
  all already implemented** (the prior version of this doc listed these as remaining — they were
  already done in `migrations/20260706100000...` and `stock-alerts-shared.js`)
- Default thresholds seeded for kernel styles 0/1, oil, protein, and shell

**Open decision:** "raw ingredient stock" is ambiguous in the current system. It could mean the
already-wired `nis_raw`/oil-feedstock category inside `oil_stock_lots` (raw material consumed by
oil pressing), or an aggregate "wet nut-in-shell awaiting processing" pool from Grower Intake —
which doesn't exist as a countable stock level today (intake batches flow one-by-one rather than
sitting in a pool with a threshold). Needs a business answer before the remaining work below is
final.

**Remaining work:**

| Task | Est. |
|------|------|
| On-screen low-stock badge on the Kernel/Oil/Shell stock grids (today alerts only surface via dashboard + notification bell, not the grid row itself) | 1.5 days |
| Confirm/set up an actual active schedule for the stock-alert evaluation cron (code exists, no confirmed scheduler anywhere) | 1 day |
| Seed default thresholds for the remaining kernel styles (SP, 1S, 4L, 5, 6, 7/8, Butter High/Low) and for `nis_raw` | 0.5 day dev + business workshop |
| Resolve "raw ingredient stock" definition (open decision above) — may add scope if Grower Intake needs a new aggregate stock pool | — |

**Epic estimate:** ~3-4 days (down from the prior 5-6, since most of the epic turned out to already
be built) — plus unscoped work if the raw-ingredient decision requires a new aggregate pool in
Grower Intake.

---

### Epic 5 — Daily reporting (email + WhatsApp)

**Goal:** Scheduled summary of production, stock, alerts, and key variances for designated
recipients. **Confirmed sequencing: email goes live first; WhatsApp activates once the Meta
Business API account is approved.**

**Already built (more than previously credited):**
- `scheduled_reports` table + admin UI (`WebPortal/modules/scheduled-reports/`)
- `get_daily_digest()` RPC — already returns kernel stats, oil stats, open alerts, procurement
  today, runway, extended KPIs, and produced-vs-target variance (broader than the original digest
  content checklist required)
- Email edge function (`supabase/functions/send-daily-digest/index.ts`) via Resend
- **WhatsApp edge function is fully implemented** (`supabase/functions/send-daily-digest-whatsapp/index.ts`),
  a real Meta Cloud API integration — not a stub, contrary to the prior version of this doc

**Known issue to fix:** the Scheduled Reports admin UI's WhatsApp tab shows a "Live" badge next to a
"WhatsApp delivery is not live yet" disabled banner, even though an admin can already create a
working `channel='whatsapp'` subscription row through the Email tab's shared table — this is a
stale UI state, not a real technical blocker.

**Remaining work:**

| Task | Est. |
|------|------|
| Deploy email digest to production + confirm cron is actually scheduled | 1 day |
| Populate the recipient list (email first, per the confirmed decision) | 0.5 day business + 0.5 day dev |
| Reconcile the WhatsApp tab's stale "Live" badge / disabled-banner inconsistency | 1 day |
| Configure WhatsApp secrets + cron once the Meta Business API account is approved | 0.5 day (blocked on approval) |
| End-to-end test with the real Macavation recipient list | 1 day |
| User guide update | 0.5 day |

**Epic estimate:** ~4.5-5 days dev (down from the prior 10-11, since the WhatsApp send
implementation and digest content enrichment already exist) — **critical path risk unchanged:**
WhatsApp Meta approval status needs a fresh check-in; if it's still not moving, ship and sign off on
email alone per the business's confirmed email-first decision, and treat WhatsApp as a fast-follow.

---

### Epic 6 — Dashboard enhancements

**Goal:** Leadership uses the dashboard as their primary operational check.

**Already built (much more than previously credited)** — in
`WebPortal/modules/dashboard/js/executive_dashboard.js`:
- Production trends chart, procurement & forecast chart, raw-material-runway widget, produced-vs-
  target widget + generic targets admin (`dashboard-targets` module), stock accuracy chart, oil
  production trends chart, oil production **forecast** chart, consolidated-batch summary widget,
  and a stock-on-hand history chart (added in the most recent commit) — **all of the items the prior
  doc listed as remaining (recovery/yield KPIs, oil forecast chart, consolidated summary widget)
  are already built and wired.**

**Open decisions:**
- "Raw material runway" currently computes **finished kernel product stock vs. open customer
  demand** — not raw-material (NIS) depletion netted against production/procurement as the original
  requirement literally describes. Decide whether to redefine it or keep the current (still useful)
  finished-goods framing.
- "Stock accuracy" currently means "% of monthly SOH that was manually adjusted" (an inventory-
  correction rate), not a literal month-on-month change in total stock on hand. Decide which
  definition is wanted.
- "Forecast" charts today plot already-known scheduled deliveries and manually-entered open orders
  — not a statistical projection. Fine if that's the intent; net-new work if true predictive
  forecasting is wanted.

**Remaining work:**

| Task | Est. |
|------|------|
| Target rows + comparison UI for the remaining KPIs (sound kernel recovery, oil yield, months of cover, stock accuracy), at the confirmed monthly/per-division granularity | 2.5 days |
| Period-over-period trend deltas ("vs last month") on KPI cards | 2 days |
| Kernel-side consolidated-batch summary widget (today's widget only covers oil) | 1.5 days |
| Rework, if the runway/stock-accuracy redefinition decisions above call for it | not sized — depends on decision |
| User guide + screenshots after UI changes | 1.5 days |

**Epic estimate:** ~7.5-8.5 days baseline (down substantially from the prior 13-14, since most of
the epic is already built), plus unsized rework if either open decision calls for redefining an
existing metric.

**KPI definitions already in use (confirm these are still correct):**
- Sound kernel recovery = sound kernel kg out ÷ wet NIS kg in
- Oil yield = total oil litres ÷ raw RM kg consumed
- Months of cover = from `get_kernel_runway_summary` (see open decision above on what "raw material
  runway" should mean)

---

### Epic 7 — Shell waste tracking

**Goal:** Track shell waste as saleable stock — lots, movements, linkage to kernel production.

**Already built (auto-creation confirmed done, contrary to the prior doc):**
- `shell_stock_lot` + `shell_stock_movement` tables, manual CRUD on the Kernel Stock screen
- **Shell is auto-created as a stock lot directly from production stages** — per-bag weighing at
  the cracking stage feeds `autoCreateShellLotFromProduction` automatically. This was listed as
  remaining work in the prior version of this doc; it's already live, and matches how shell is
  actually recorded operationally on the kernel-pipeline production sheets.
- A stock alert rule type already exists for shell

**Known issues to fix while doing the remaining work:**
- Two disconnected shell-quantity inputs exist: the auto-fed cracking-stage weighing (feeds the
  stock lot) and a separate manual "Shell (kg)" waste field on the kernel job card (feeds only that
  card's own internal mass balance) — nothing reconciles them, risking drift or double-counting.
- Kernel-batch linkage on a shell lot is a free-text string match against a typed batch number, not
  a real foreign key — a typo could silently create a duplicate lot instead of incrementing the
  existing one.

**Remaining work:**

| Task | Est. |
|------|------|
| Dispatch/sales workflow: today it's a bare status flip + free-text reference; decide whether to build a proper `shell-dispatch` flow tied to CRM customers/invoicing (like kernel/oil dispatch) or keep it lightweight | 2-3 days (2 if lightweight; more if CRM-integrated) |
| Movement history view on a shell lot (the ledger is written to but has no UI) | 1.5 days |
| Reconcile the two disconnected shell-quantity inputs described above | 1.5 days |
| Upgrade kernel-batch linkage from free-text match to a real foreign key | 1 day |
| User guide update | 0.5 day |

**Epic estimate:** ~6.5-7.5 days (down from the prior 7-8, since auto-lot-creation is already done).

---

### Epic 8 — Grower intake: mass balance and procurement

**Goal:** Mass balance across the kernel stream; procurement workspace for planned vs. actual and
forecast alignment.

**Already built (including dead/unsurfaced backend work not previously credited):**
- Procurement calendar (month view, drag-reschedule, convert-to-batch) —
  `WebPortal/modules/grower-intake/`
- **A stream-level mass-balance RPC (`get_kernel_mass_balance`) and a procurement-variance RPC
  (`get_procurement_week_summary`) already exist and already compute planned-vs-actual figures —
  but have zero front-end callers anywhere.** This changes the nature of the remaining work: it's
  wiring already-built calculations into a real UI, not building the calculations from scratch.
- Per-batch mass balance already shown on the kernel job card (manual, not yet tied back to the
  originating intake batch's actual received weight)

**Known issue to fix while wiring the UI:** the existing `get_kernel_mass_balance` RPC's "actual
received" figure uses the grower-declared `wet_nis_received_kg`, not the more trustworthy
weighbridge-confirmed `actual_wet_nis_kg` already captured on the receiving checklist — switch to
the latter before shipping a procurement-variance UI built on it.

**Open decision, flagged as likely out of scope for this pass:** no purchase-order or grower-
contract/seasonal-commitment concept exists anywhere in the system. If "procurement workspace" is
meant to include commercial PO tracking (agreed price per kg, PO numbers, supplier acceptance,
AP/invoicing linkage), that's a much larger, separate scope — recommend treating it as a future/
optional epic rather than folding it into the estimate below.

**Remaining work:**

| Task | Est. |
|------|------|
| Build a procurement-workspace UI in Grower Intake surfacing the existing RPCs: planned vs. actual vs. variance, a this-week summary card | 2.5 days |
| Switch the "actual received" figure to `actual_wet_nis_kg` | 0.5 day |
| Bulk CSV import UI for historical procurement rows (script already exists) | 2 days |
| User guide update | 0.5 day |

**Epic estimate:** ~5.5 days (down from the prior 9, since the mass-balance/variance calculations
already exist — the remaining work is surfacing them, not building them).

---

### Epic 9 — Oil module

**Goal:** Faster batch search, consolidated batches with their own batch number, lab results
attachable to consolidated batches.

**Already built (search filters confirmed done, contrary to the prior doc):**
- `search_oil_batches` RPC + UI, **already including date-range and status filters** — the prior
  version of this doc listed "wire UI" for these as remaining; they're already wired
- `oil_consolidated_batch` + members + lab reference/notes fields, full CRUD in
  `WebPortal/modules/oil-production/`

**Remaining work:**

| Task | Est. |
|------|------|
| Real lab-test-result file upload on a consolidated batch (reuse the existing generic upload helper, `_common.uploadFile` — already used by document-management and the kernel QA "end sample" modal; this is a well-precedented task, not new infrastructure) | 2.5 days |
| Wire up the already-built-but-unused remove-member and delete-consolidated-batch controls in the UI | 1 day |
| Expose the existing `grade` field in the create/edit dialogs | 0.5 day |
| Grant the `oil.consolidated.manage` action to the appropriate non-admin roles (currently only admins can use this feature) | 0.5 day |
| Consolidated-batch release workflow polish (status transitions, stock linkage) | 1.5 days |
| DB index on `oil.batch_id` / search fields, only if a real performance issue is found at current data volumes | 0.5 day (contingent) |
| User guide update | 0.5 day |

**Epic estimate:** ~6.5-7 days (similar to the prior 6, since the search-filter work already done is
offset by the previously-unlisted UI-wiring and role-grant gaps found this pass).

---

## Recommended delivery order

Same grouping as before, adjusted for what's actually already built. No calendar dates — sequence
these as capacity allows.

### Phase 2a — Visibility · ~15-17.5 dev days

**Why first:** leadership gets immediate value; validates infrastructure before the data load.

1. Deploy + verify existing dashboard, alerts, scheduled reports in production
2. Stock alert polish (on-screen badge, confirm scheduled evaluation)
3. Dashboard KPI gaps (targets/comparison UI for remaining metrics, trend deltas)
4. Email digest go-live with real Macavation recipients
5. Business workshop: confirm alert thresholds and dashboard targets

**Milestone:** Paul uses the dashboard + email digest daily.

### Phase 2b — Kernel upstream · ~19-19.5 dev days

1. Procurement-workspace UI wiring the already-built mass-balance/variance RPCs
2. Shell waste dispatch workflow, movement history UI, dual-input reconciliation
3. Historical data import (oil RPC/UI now; kernel/oil/procurement data import once Pete delivers —
   confirmed to trail the rest of the build, not block it)
4. Re-validate runway and stock-accuracy charts once real historical data lands

**Milestone:** Grower intake procurement workspace live; shell dispatch/movement history usable.

### Phase 2c — Control · ~32.5-34 dev days

1. Permissions: module-coverage audit, decide server-side enforcement location, roll out to
   currently-ungated modules, add server-side checks
2. Messaging: entity deep links + the new 1:1 chat feature
3. Role-by-role UAT

**Milestone:** Non-admin users cannot perform unauthorized actions in the UI or via direct API
calls; colleagues can message each other 1:1 in a WhatsApp-style view.

### Phase 2d — Oil + close · ~6.5-7 dev days + WhatsApp (business-gated)

1. Oil module polish: lab document upload, release workflow, role grants
2. WhatsApp digest activation (as soon as Meta API approval lands — code is ready now)
3. Full UAT acceptance against success criteria
4. User guide, training session, production cutover

**Milestone:** Phase 2 sign-off — all success criteria met.

---

## Cross-cutting work (throughout)

| Item | Est. |
|------|------|
| User guide updates per epic (`WebPortal/help/index.html`, `user-manual.html`) | ~6 days total |
| Help-link script: `node scripts/apply_user_guide_help_links.mjs` (run after new screens ship) | 0.5 day |
| RBAC checklist for new RPCs: `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` | ongoing, per migration |
| End-to-end smoke test on critical paths before sign-off | 2 days |

---

## Business dependency register

| Dependency | Required by | Owner | Note |
|------------|-------------|-------|------|
| Pete's 24-month kernel batch file | Epic 1, dashboard validation | Pete | Confirmed to arrive **after** the core Phase 2 build, not in parallel — no longer a Week-1 blocker |
| Oil SOH snapshot (or explicit N/A) | Epic 1 | Pete | — |
| Alert threshold values | Epic 4 go-live | Josslyn, Mark | Thresholds are configurable per material; just need values |
| Dashboard target values | Epic 6 | Paul | Monthly, per product line (kernel/oil) — confirmed |
| Daily report recipient list | Epic 5 | Paul | Email first, per confirmed decision |
| WhatsApp Business API approved account | Epic 5 sign-off, Epic 5 WhatsApp channel | Macavation IT | Status unclear — needs a fresh check-in, not assumed still "in progress" from three weeks ago |
| Resend domain verification (if not already done) | Email digest | CustomApp / Macavation | — |
| Permission role matrix (who may do what, per role) | Epic 2 | Business + dev | Needed before server-side enforcement can be scoped precisely |
| Sign-off: Pete, Josslyn, Paul | Epic 1 close | All | After import |

---

## Success criteria mapping

| Criterion | How we verify |
|-----------|---------------|
| Leadership uses the dashboard / daily report as their primary operational check | Paul confirms daily use for 2 consecutive weeks post go-live |
| Red flags prevent stock-outs | Alert fires when SOH drops below threshold; notification received; alert clears when stock recovers |
| Oil consolidated batches in live use with lab results attached | At least 1 consolidation created in production with a real lab document attached |
| Two years of history visible in trend charts | Production trends chart shows a 24-month range with Pete's sign-off |
| Colleagues can message each other 1:1 (new) | At least one real 1:1 conversation used operationally post go-live |

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| WhatsApp Meta approval delayed or stalled | Blocks WhatsApp channel, not the rest of Phase 2 | Ship email-only per the confirmed decision; treat WhatsApp as a fast-follow once approved |
| Pete's data delayed or aggregate-only | Weak trend charts, delayed Epic 1 close | Already reframed as a trailing, non-blocking track — proceed with all other epics regardless |
| Permissions enforcement location undecided | Epic 2 estimate could shift materially | Resolve the Postgres-function-vs-Lambda-proxy decision before starting server-side enforcement work |
| Permissions misaligned (UI allows, API doesn't, or vice versa) | Security gap or false "access denied" | No epic close without a paired `role_actions` + server-side check per sensitive action |
| Metric definitions (raw material runway, stock accuracy, raw ingredient stock) left ambiguous | Wrong or confusing dashboard/alert numbers ship | Resolve each flagged "open decision" before building its dependent UI |
| Scope creep (CRM, GMP forms, procurement PO/contract tracking) | Timeline slip | Explicitly out of scope for this pass; procurement PO tracking flagged as a possible future epic |

---

## Effort summary (revised)

| Epic | Dev days (range) |
|------|-------------------|
| 1 Historical data | 13-14 (+ business wait, non-blocking) |
| 2 Permissions | 18 (conditional on the enforcement-location decision) |
| 3 Messaging (entity links + new 1:1 chat) | 14.5-15.5 |
| 4 Stock alerts | 3-4 |
| 5 Daily reporting | 4.5-5 |
| 6 Dashboard | 7.5-8.5 (+ unsized rework if metric redefinitions are chosen) |
| 7 Shell waste | 6.5-7.5 |
| 8 Grower intake | 5.5 |
| 9 Oil module | 6.5-7 |
| Cross-cutting | ~8.5 |
| **Total** | **~77-93 person-days** |

This is similar in magnitude to the prior estimate (58-72 days remaining, on top of ~30-35 days
already built) even though a lot more turned out to already be built, because the new 1:1 chat
scope (~10.5 days) accounts for most of the difference. Treat this as an engineering-judgment
estimate, not a fixed quote — several epics carry open decisions that could move their numbers.

---

## Immediate next steps

1. **Macavation:** confirm the permission role matrix (who gets adjust-stock, approve-job-card,
   etc. per role); get a fresh status check on the WhatsApp Business API application; confirm alert
   thresholds and dashboard target values with the relevant owners.
2. **Dev:** run the UAT/production migration verification + smoke test (Track A).
3. **Dev:** deploy the email digest with a test subscriber (Track C).
4. **Both:** resolve the flagged open decisions (permissions enforcement location, raw-ingredient-
   stock definition, runway/stock-accuracy definitions) before their dependent epics start, so
   estimates hold.
