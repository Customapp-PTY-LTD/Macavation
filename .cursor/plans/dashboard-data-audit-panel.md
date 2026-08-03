# Add the dashboard data audit panel for admins

## Why

`get_dashboard_data_audit()` exists (`migrations/20260602090000_dashboard_data_audit.sql`) and its
JavaScript wrapper exists (`WebPortal/js/data-functions.js` line 1517), but nothing in the portal
calls it. The RPC's whole purpose is to show the raw source counts sitting behind the dashboard
numbers, so someone can tell whether a dashboard figure is wrong or whether the underlying data is
wrong.

Phase 2's plan document lists this as an optional Epic 6 task,
"`get_dashboard_data_audit` diagnostic UI for post-import validation". It becomes genuinely useful
when Pete's historical data is loaded, because it is the fastest way to confirm an import landed.

## Read these first

- `migrations/20260602090000_dashboard_data_audit.sql` — the RPC. Read it all so you know every
  metric it returns. Do not change it.
- `WebPortal/js/data-functions.js` line 1517 — `getDashboardDataAudit`. **Read the whole function
  body**, including its `catch`. Its behaviour is not what you would assume; see below.
- `WebPortal/modules/dashboard/html/dashboard_unified.html` — the live dashboard markup.
- `WebPortal/modules/dashboard/js/executive_dashboard.js` — how this dashboard loads and renders.

## Traps in this area — read before writing anything

These have each been verified in the current tree. Getting any of them wrong produces a change that
merges and deploys while doing nothing, or doing something visible to the wrong people.

**1. There is a decoy markup file.**
`WebPortal/modules/dashboard/html/executive_dashboard.html` is a 37-line dead stub that still says
"Chart will be displayed here". It is not rendered. **Do not touch it.** The live markup is
`WebPortal/modules/dashboard/html/dashboard_unified.html` (691 lines), which route `dashboard` loads
per `appRouteConfig.json`.

**2. That file serves three different dashboards.** It is partitioned by `data-access` wrappers —
`data-access="default"`, `data-access="pallandium-integrator"` and `data-access="executive"` — which
`dashboard.js` shows and hides by role. **The panel must go inside the `data-access="executive"`
block, after the last widget in it.** Placed outside, it leaks onto dashboards it does not belong on.

**3. `data-dashboard-widget` will make your panel disappear.** Any element carrying that attribute is
hidden unless its id appears in the user's visible-widget list. New ids are in nobody's list, the
role defaults are hardcoded, and the Customize modal only offers ids present in
`DASHBOARD_WIDGET_LABELS`. A new panel copying that pattern would be permanently invisible with no
way to switch it on. **Do not put `data-dashboard-widget` on this panel.** It is a diagnostic, not a
dashboard widget.

**4. `data-action-perm` is only swept once.** The router runs `actionAccess.apply` a single time,
shortly after module load, over `#content-area`. Markup injected later is never swept, so the
attribute is inert on anything you render dynamically. **Therefore:** the panel's outer shell —
carrying the attribute — must be in the static section HTML, and any control you render dynamically
must call `hasAction()` inline at render time, which is what the existing dashboard code does.

**5. The wrapper never throws.** `getDashboardDataAudit` catches everything, logs a warning and
returns `[]`. So "the call failed" and "there is no data" are indistinguishable through it. Do not
write an error branch that cannot run — see the single message specified below.

## Fixed contracts — do not invent alternatives

- Call **`dataFunctions.getDashboardDataAudit()`**. Do not add a wrapper, do not call `callFunction`
  directly, and do not change the wrapper's error handling.
- Each returned row has exactly: `metric` (text), `source` (text), `value` (number), `detail`
  (object or null).
- Gate the panel on the action key **`admin.users.manage`**. That is a real key in the actions
  catalogue. **`admin.view` does not exist — do not use it, and do not create a key or write a
  migration.** Note the gate is cosmetic: the RPC is granted to every role, so this hides the panel
  rather than protecting the data. That is acceptable for a read-only diagnostic.
- The panel is **read-only**. No control on it writes anything.
- **Collapsed by default**, loading its data only when first expanded. It must not add a database
  call to every dashboard load. Reuse the existing `mac-section-collapse-card` pattern.

## What to build

1. A collapsible panel titled **Data audit**, in `dashboard_unified.html`, inside the
   `data-access="executive"` block, after the last widget in that block. The shell carries
   `data-action-perm="admin.users.manage"` and **no** `data-dashboard-widget`.
2. On first expand, call the wrapper and render the rows in a plain table: **Metric**, **Source**,
   **Value**. Group rows by `source` with a subheading per group — the RPC returns several sources
   in one flat list.
3. Format `metric` for humans: `kernel_in_production` becomes `Kernel in production`. Keep the raw
   key as a `title` tooltip so it can be traced back to the RPC.
4. When `detail` is not null, show it as inert escaped preformatted JSON in an indented row beneath
   its metric. Never render it as markup and never through a markdown renderer.
5. A small **Refresh** link inside the panel re-runs the call.
6. **One empty-state message, not two.** When the call returns an empty array, show exactly:
   `No audit data returned. If this environment has not had migration 20260602090000 applied, that
   is the likely reason.` This covers both real emptiness and a swallowed failure, which is all the
   wrapper can tell you. Do not add a separate error branch.
7. Escape every value before it reaches the DOM.

## Do not

- Do not change the database, write a migration, or alter the RPC.
- Do not touch `executive_dashboard.html` (the dead stub).
- Do not touch any existing widget, KPI or chart.
- Do not add a charting library, a dependency or a package.json entry.
- Do not load on page load. Lazy, on first expand, only.
- Do not add screenshots.

## Style rules that will be checked

`WebPortal/` has an enforced design standard (`scripts/verify-ui-standard.mjs`, see
`docs/design/DESIGN_SYSTEM.md`):

- **No raw hex colours** — use `--mac-*` tokens. Only `#fff` and `#000` are exempt.
- **No Bootstrap Icons** (`bi-`). Use Font Awesome (`fas`/`far`).
- **No `btn-success`** — `btn-primary` is the filled green button.
- **No gradients.**
- Define no new CSS custom properties outside `design-tokens.css`.

Reuse existing dashboard styles rather than writing new CSS wherever you can.

**About the checker's current state, so you are not tempted to "fix" it:** running
`node scripts/verify-ui-standard.mjs` today reports **65 violations**, and **4 of them are in
`dashboard_unified.html` itself** — Bootstrap Icons at lines 19, 92, 124 and 484. They pre-date this
work and are being handled separately. **Leave them exactly as they are.** Correcting them is out of
scope, would contradict "do not touch existing widgets", and would make this diff unreviewable. The
bar for this plan is that the total stays at **65** — you add none.

## Help page

Add a short entry to `WebPortal/help/user-manual.html` explaining what the panel is for: checking
that dashboard numbers match their underlying source data, particularly after a historical import.
Match the surrounding tone and markup. You may add a matching topic to `WebPortal/help/index.html`.
**Do not run `scripts/apply_user_guide_help_links.mjs`** — it rewrites links across many files.

## How this will be verified

- `npm run test:fleet` passes.
- `node scripts/verify-ui-standard.mjs` still reports **65** violations — no more, and the four in
  `dashboard_unified.html` untouched.
- The diff shows: the panel inside the `data-access="executive"` block of `dashboard_unified.html`,
  the `admin.users.manage` gate on a statically-rendered shell, no `data-dashboard-widget`, the lazy
  first-expand load, and the single empty-state message.
- The diff does not touch `executive_dashboard.html`.

## Size

Small to medium — one panel, one loader, one renderer, one help paragraph. Well inside a single run.
