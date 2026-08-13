# Report builder — data-functions transport fix and report RPC wrappers

## Context

This is the first of four small plans replacing `report-builder-01-list-and-editor.md`, which was
blocked twice for being too large. It changes exactly one file:
`WebPortal/js/data-functions.js`. **No UI, no routes, no migration.**

Two things happen here, in this order: a transport bug is fixed, then the report RPC wrappers are
added on top of it. Nothing else in this plan series can be written correctly until both exist.

The report-builder RPCs this wraps are defined in `migrations/20260817090000_report_builder_foundations.sql`
and `migrations/20260817100000_report_instances_and_targets.sql`, both present in this checkout.
**Whether those migrations have been applied to any database cannot be verified from this checkout —
do not state or assume that they have.** The wrappers must therefore tolerate the RPC being absent
(see "Missing RPCs" below).

## The bug being fixed

`buildPostgrestRpcBody` (`WebPortal/js/data-functions.js:497-512`) removes any param whose value is
`null`, `undefined` or `''` before the body is serialised, unless the caller passes
`preserveNullParams` (which preserves `null` only, never `''`).

PostgREST resolves a function overload from the exact set of parameter *names* in the body. So a
stripped param that has **no DEFAULT** produces a thrown
`"Could not find the function public.<name>(...) in the schema cache"` error rather than a normal
result. Two concrete consequences for the report screens built in later plans:

- `set_report_section_state` does `COALESCE(p_commentary, commentary)`. Sending `''` to clear a
  commentary strips the param, so the old text silently stays — in a director-facing report.
- `set_report_executive_summary` declares `p_summary` with **no DEFAULT**. Sending `''` or `null`
  strips it, leaving only `p_report_instance_id`, and the call throws the schema-cache error.

Fix it once in the transport rather than working around it per call site.

## Blast radius — check before editing

`buildPostgrestRpcBody` has exactly three references in the repo: the definition at
`data-functions.js:497`, `tryKernelRpcSupabaseFallback` at `:521` (passes no options), and
`callSupabaseRpc` at `:602`. No test asserts on it. **Confirm this with
`grep -rn "buildPostgrestRpcBody" WebPortal/` before editing** — if the count differs from three,
stop and report rather than proceeding.

Default behaviour must be **byte-for-byte unchanged** for every existing caller. The new behaviour
is opt-in only.

## Deliverable 1 — the transport flag

```js
// buildPostgrestRpcBody (~line 497). New: preserveEmptyStrings. '' is otherwise stripped, which
// makes it impossible to clear a text column through an RPC that COALESCEs NULL onto the old value.
buildPostgrestRpcBody: function (params, options) {
    const out = {};
    if (!params || typeof params !== 'object') return out;
    const preserveNulls = !!(options && options.preserveNulls);
    const preserveEmptyStrings = !!(options && options.preserveEmptyStrings);
    Object.keys(params).forEach(function (key) {
        const val = params[key];
        if (preserveNulls && val === null) { out[key] = null; return; }
        if (preserveEmptyStrings && val === '') { out[key] = ''; return; }
        if (val !== null && val !== undefined && val !== '') { out[key] = val; }
    });
    return out;
}
```

Thread it through both layers, keeping these exact names — public option `preserveEmptyParams`,
internal option `preserveEmptyStrings`, mirroring the existing `preserveNullParams`/`preserveNulls`
pair:

- `callSupabaseRpc` (~line 602):
  `scope.buildPostgrestRpcBody(params, { preserveNulls: options.preserveNullParams === true, preserveEmptyStrings: options.preserveEmptyParams === true })`
- `callFunction` (~line 745):
  `{ useAnonAuth: true, preserveNullParams: options.preserveNullParams === true, preserveEmptyParams: options.preserveEmptyParams === true }`

`undefined` must still be stripped in every case — that is what "leave this field unchanged" relies
on in `set_report_section_state`.

Iterating with `Object.keys(...)` (rather than `for…in`) is deliberate: it does not walk the
prototype chain, so a crafted `__proto__` key cannot reach the request body.

## Deliverable 2 — the report wrappers

Add exactly these eleven, using these names verbatim. Later plans in this series reference them by
name, so a rename here silently breaks them:

`getReportTemplates`, `getReportCurrentPeriod`, `listReportInstances`, `createReportInstance`,
`getReportInstance`, `overrideReportMetricValue`, `clearReportMetricOverride`,
`setReportSectionState`, `setReportExecutiveSummary`, `refreshReportInstance`,
`deleteReportInstance`.

**Do not remove `getSalesForecasts` in this plan.** `WebPortal/modules/sales-forecasting/js/sales_forecasting_grid.js:46`
still calls it, and because the call is `dataFunctions.getSalesForecasts().catch(...)`, removing the
wrapper throws a synchronous `TypeError` that the `.catch()` does **not** intercept — it would break
the currently-working screen. Its removal belongs with the module deletion, in a later plan.

Follow the existing `callFunction(...)` style, using `upsertDashboardTarget`
(`data-functions.js:1655-1674`) as the model, including its `preserveNullParams` comment and its
`clearCachePattern` call.

RPC parameter names must match exactly, including the `p_` prefix. Parameters with **no DEFAULT**
must always be sent:

| Wrapper | RPC | Params (defaults as declared) |
|---|---|---|
| `getReportTemplates` | `get_report_templates` | `p_period_type` (DEFAULT NULL) |
| `getReportCurrentPeriod` | `get_report_current_period` | `p_period_type` (**no default**) |
| `listReportInstances` | `list_report_instances` | `p_period_type`, `p_status`, `p_limit` (50), `p_offset` (0) |
| `createReportInstance` | `create_report_instance` | `p_template_id`, `p_period_date` (**no defaults**), `p_actor_user_id` (DEFAULT NULL) |
| `getReportInstance` | `get_report_instance` | `p_report_instance_id` |
| `overrideReportMetricValue` | `override_report_metric_value` | `p_report_instance_id`, `p_metric_key`, `p_entered_value`, `p_reason` (**no defaults**), `p_actor_user_id` (DEFAULT NULL) |
| `clearReportMetricOverride` | `clear_report_metric_override` | `p_report_instance_id`, `p_metric_key` |
| `setReportSectionState` | `set_report_section_state` | `p_report_instance_id`, `p_section_key`, `p_is_enabled` (DEFAULT NULL), `p_commentary` (DEFAULT NULL) |
| `setReportExecutiveSummary` | `set_report_executive_summary` | `p_report_instance_id`, `p_summary` (**no default**) |
| `refreshReportInstance` | `refresh_report_instance` | `p_report_instance_id` |
| `deleteReportInstance` | `delete_report_instance` | `p_report_instance_id` |

Rules:

- **Reads** (`getReportTemplates`, `getReportCurrentPeriod`, `listReportInstances`,
  `getReportInstance`) pass an **explicit** `cacheKey` prefixed `report_list_` for
  `listReportInstances` or `report_instance_` for `getReportInstance`, with
  `cacheTtl: this.cache.ttl.dynamic`, and honour a `forceRefresh` argument. The explicit key is
  mandatory: the default key is `functionName_JSON(params)`, which the invalidation patterns below
  would not match.
- **Writes** (all seven others) pass `useCache: false` and, after a successful call, invalidate both
  cache families via `clearCachePattern('report_instance_')` and `clearCachePattern('report_list_')`.
  Without this the editor shows stale figures immediately after an override.
- `setReportSectionState` — and only this wrapper — passes `preserveEmptyParams: true`, so a
  cleared commentary reaches the server as `''`. It must also send `p_is_enabled` as `undefined`
  (not `null`) when only the commentary is being changed, so that param is stripped and the
  server's `COALESCE(p_is_enabled, is_enabled)` leaves the toggle alone.
- `setReportExecutiveSummary` must always send `p_summary`, converting `null`/`undefined` to `''`
  before the call, and pass `preserveEmptyParams: true`. `p_summary` has no DEFAULT, so a stripped
  param throws.

## Missing RPCs must not throw uncaught

If a report RPC is absent from the target database, `callFunction` throws. Each wrapper should let
the error propagate (callers in later plans wrap in `try/catch` and render an empty state) but must
**not** swallow it into a fake success value — a wrapper returning `[]` on failure would make a
missing migration look like "no reports yet". Add a one-line comment to that effect on the read
wrappers so a future editor does not add a `.catch(() => [])`.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes. It is exactly
   `routing:verify && username:verify && verify-phase2-migrations && ui:verify && migrations:verify && registry:verify`.
2. `grep -c "buildPostgrestRpcBody" WebPortal/js/data-functions.js` returns `3` — unchanged from
   before the edit.
3. `grep -n "preserveEmptyStrings\|preserveEmptyParams" WebPortal/js/data-functions.js` shows the
   flag present in `buildPostgrestRpcBody`, `callSupabaseRpc` and `callFunction`, and used by
   exactly two wrappers: `setReportSectionState` and `setReportExecutiveSummary`.
4. `grep -c "getSalesForecasts" WebPortal/js/data-functions.js` returns `1` — the stub is still
   there and untouched.
5. All eleven wrapper names are present:
   `for n in getReportTemplates getReportCurrentPeriod listReportInstances createReportInstance getReportInstance overrideReportMetricValue clearReportMetricOverride setReportSectionState setReportExecutiveSummary refreshReportInstance deleteReportInstance; do grep -q "$n" WebPortal/js/data-functions.js || echo "MISSING $n"; done`
   prints nothing.
6. A pure unit check of the transport function, run with `node` and no network. Extract or copy
   `buildPostgrestRpcBody`'s body into a scratch script and assert all four cases:
   - `{a: 1, b: null, c: '', d: undefined}` with no options → `{a: 1}`
   - same with `{preserveNulls: true}` → `{a: 1, b: null}`
   - same with `{preserveEmptyStrings: true}` → `{a: 1, c: ''}`
   - same with both → `{a: 1, b: null, c: ''}`
   `d` must be absent in every case. Delete the scratch script before finishing.
7. `grep -rn "useCache: false" WebPortal/js/data-functions.js | grep -ci report` returns `7` — one
   per write wrapper.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job.

## Out of scope

Any UI, any route, any sidebar change, any migration, deleting the `sales-forecasting` module,
removing `getSalesForecasts`, and applying anything to a database. Do not edit any Playwright spec,
`WebPortal/help/*`, `docs/**`, or `permission-module-map.js`.
