# Two dashboard widgets are both called "Raw material runway" and mean different things

## Context

The executive dashboard now carries two runway widgets with near-identical names and genuinely different
meanings. From `WebPortal/modules/dashboard/js/executive_dashboard.js`:

```js
35:        execRunwayForecast: 'Raw material runway forecast (NIS)',
37:        execRunway: 'Raw material runway',
```

- **`execRunwayForecast`** is the newer chart, backed by `get_nis_runway_forecast`. It measures what its
  name says: kilograms of nut-in-shell not yet put into production, projected forward to run-out from a
  chosen depletion rate. This is genuinely raw-material runway.
- **`execRunway`** is the older KPI card, backed by `get_kernel_runway_summary` (loaded at
  `executive_dashboard.js:1473-1484`, rendering `#execRunwaySohKg`, `#execRunwayDemand`,
  `#execRunwayWeeks`, `#execRunwayMonths`). It measures **finished kernel product stock against open
  customer demand** — a sales-cover metric, not raw material at all.

So a leadership user reading the dashboard sees "Raw material runway forecast (NIS)" and "Raw material
runway" side by side and has no way to know the second one is about finished goods and customer orders.
Both numbers are useful; the labelling is what is wrong.

The older card's framing was flagged as an open question in the Phase 2 plan — whether to redefine it or
keep it. The newer chart answered the raw-material question directly, which means the old card no longer
needs to carry that name. **This plan renames, it does not redefine.** No calculation changes.

### The precedent for renaming a widget safely

Widget visibility is per-user: anything carrying `data-dashboard-widget` is hidden unless its id is in the
user's visible-widget list, role defaults are hardcoded, and the Customize modal only offers ids present in
`DASHBOARD_WIDGET_LABELS` (`CLAUDE.md`). So changing a widget **id** would silently hide it from everyone
who has already customised their dashboard.

There is a precedent for handling exactly that — `executive_dashboard.js:126`:

```js
var renamed = { execProcurementForecast: 'execRunwayForecast' };
```

a migration shim mapping an old saved key to its new name. Use it if you change an id.

**The simpler and safer route is to change only the label**, leaving `execRunway` as the id. Prefer that.
The user-facing problem is the label; the id is internal.

## Scope

**In:** the `execRunway` label, its card heading, and a short clarifying line so the two are
distinguishable.

**Out:** any change to `get_kernel_runway_summary`, `get_nis_runway_forecast`, or any figure either
produces. **Out:** removing or hiding either widget. **Out:** the forecast chart, its scrolling, its pinned
axis, or its depletion-rate modal — all recently reworked and not to be disturbed.

## Work

### 1. Rename the label

In `WebPortal/modules/dashboard/js/executive_dashboard.js`, change `execRunway`'s entry in the widget-label
map (`:37`) from `'Raw material runway'` to a name describing what it measures — **`'Finished stock cover
(vs open orders)'`** unless you find a term the surrounding code already uses for the same idea, in which
case prefer that for consistency and say so in the run summary.

Leave `execRunwayForecast`'s label at `:35` alone; it is accurate.

### 2. Rename the card heading to match

Find the `execRunway` card in `WebPortal/modules/dashboard/html/dashboard_unified.html` (the live markup —
it serves three dashboards partitioned by `data-access` wrappers) and update its visible heading to the
same wording. The label map and the heading must agree, or the Customize modal will name a widget the page
calls something else.

Add one short line of context inside the card — a `text-muted` sub-line in the style already used there —
stating that it compares finished kernel stock on hand against open customer demand. One sentence, no
tooltip machinery.

### 3. Do not change the id

Keep `execRunway` as the id, so no user's saved widget list is affected and no shim is needed. **If** you
have a concrete reason to change it, you must also add the id to the `renamed` map at `:126`, to
`DASHBOARD_WIDGET_LABELS`, and to the hardcoded role defaults — all three, per `CLAUDE.md` — and say so
explicitly. Renaming the label is the expected outcome.

## Guardrails

- **Do not alter any calculation.** No change to `get_kernel_runway_summary`, `get_nis_runway_forecast`, or
  any `.sql` file. This plan authors no migration.
- **Do not touch the forecast chart's rendering**: the 12px/day width, the `overflow-x` wrapper, the
  auto-scroll that places today about a third from the left, the sibling `runwayForecastAxis` canvas that
  paints the pinned y-axis, or the inline Chart.js marker plugin. Those landed across several recent fixes
  and are out of scope.
- **Do not add `data-dashboard-widget` to anything new**, and do not remove it from an existing element —
  removing it makes a widget permanently visible, ignoring every user's preferences.
- **Markup must stay inside its current `data-access` wrapper.** Content moved between blocks appears on the
  wrong dashboard.
- **Do not change `execRunway`'s id** unless you also update all three places named above.
- Do not introduce raw hex, a `linear-gradient`, Bootstrap Icons, or `btn-success` — `ui:verify` is part of
  `test:fleet` and fails on all four. Use `--mac-*` tokens and Font Awesome.
- Do not re-declare `escapeHtml`; the shared `_common.escapeHtml` exists.
- Exactly two files change. No `.sql`; nothing under `supabase/`; no new dependency.

## Acceptance criteria

1. Exactly two files change: `WebPortal/modules/dashboard/js/executive_dashboard.js` and
   `WebPortal/modules/dashboard/html/dashboard_unified.html`.
2. **Grep-checkable:** the string `'Raw material runway'` (the bare form, without `forecast`) no longer
   appears in `executive_dashboard.js`, and `execRunwayForecast: 'Raw material runway forecast (NIS)'` is
   unchanged.
3. The `execRunway` card heading in `dashboard_unified.html` matches its new label text exactly.
4. The card carries one added `text-muted` line explaining it compares finished kernel stock against open
   customer demand.
5. **Grep-checkable:** `execRunway` is still the widget id — `data-dashboard-widget="execRunway"` is present
   and unchanged; and `#execRunwaySohKg`, `#execRunwayDemand`, `#execRunwayWeeks`, `#execRunwayMonths` all
   still exist, so `loadRunwaySummary` at `:1473-1484` keeps working untouched.
6. `loadRunwaySummary` and `loadRunwayForecastChart` are functionally unmodified — `git diff` shows no
   change inside either beyond nothing at all.
7. No element gains or loses `data-dashboard-widget`, and no markup moves between `data-access` wrappers.
8. `npm run ui:verify` passes and `npm run test:fleet` passes.
9. No `.sql` file added or changed; nothing under `supabase/`; no new npm dependency.
