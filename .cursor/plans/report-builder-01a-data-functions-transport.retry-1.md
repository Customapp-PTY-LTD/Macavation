---
retry_of: aa79585d-77ad-4e50-bd7e-f746e842dec6
---

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

- `set_report_section_state` does `COALESCE(p_commentary, commentary)`
  (`migrations/20260817100000_report_instances_and_targets.sql:651-655`). Sending `''` to clear a
  commentary strips the param, so the old text silently stays — in a director-facing report.
- `set_report_executive_summary` declares `p_summary text` with **no DEFAULT**
  (`…:669-672`). Sending `''` or `null` strips it, leaving only `p_report_instance_id`, and the call
  throws the schema-cache error.

Fix it once in the transport rather than working around it per call site.

## Blast radius — the real call-site inventory

`buildPostgrestRpcBody` has **four** references in this repo, all inside
`WebPortal/js/data-functions.js` (line numbers as of the base branch; they shift by the two lines
Deliverable 1 adds):

| Line | Site | Options passed today | Effect of Deliverable 1 |
|---|---|---|---|
| `:497` | the definition | — | edited (Deliverable 1) |
| `:521` | `tryKernelRpcSupabaseFallback` | **none** | none — both flags default false |
| `:602` | `callSupabaseRpc` | `{ preserveNulls: options.preserveNullParams === true }` | edited to thread the new flag; behaviour identical unless a caller opts in |
| `:4471` | `returnKernelFromStockToProduction` | **none** | none — both flags default false |

**`:4471` is the site the previous revision of this plan omitted, and it is the one that matters
most.** `returnKernelFromStockToProduction` does not use the helper as a transport step at all — it
uses it as a *null filter* and then branches on the filtered result:

```js
const params = scope.buildPostgrestRpcBody({           // :4471, no options
    p_batch_number: batchNumber || null,
    p_kernel_id: uuidRe.test(kid) ? kid : null
});
if (!params.p_batch_number && !params.p_kernel_id) {   // :4475
    throw new Error('Batch reference missing. Refresh Stock (Kernel) and try again.');
}
```

Hard constraints:

- **Do not edit, inline, reformat or re-point line `:4471` or its guard at `:4475`.** It is a live
  kernel-stock-return code path. Its guard is correct *only because* `null` values are still
  stripped when no options are passed — which Deliverable 1 preserves.
- **Do not "make a grep count match" by touching any existing call site.** No count in this plan is
  a reason to edit code; if a count disagrees, report the disagreement in the run summary and leave
  the code alone.
- The four-site count is informational, **not an abort gate**. Run
  `grep -n "buildPostgrestRpcBody" WebPortal/js/data-functions.js` before editing. If it shows the
  four sites above, proceed. If it shows additional sites, inspect each one and proceed as long as
  every additional site passes either no options object or an options object without
  `preserveEmptyParams`/`preserveEmptyStrings` (both flags then default to false, so behaviour is
  unchanged). Only stop and report if some site would actually change behaviour.

The same invariant must hold for the three `callSupabaseRpc` call sites, since that is the function
whose options object gains a key: `:519` (`tryKernelRpcSupabaseFallback`, `{ useAnonAuth: true }`),
`:741` (`callFunction`, `{ useAnonAuth: true, preserveNullParams: … }`), and `:2983`
(`upsertKernelIntakeProcurement`, `{ useAnonAuth: true, preserveNullParams: true }`). None of the
three passes `preserveEmptyParams`, so all three keep `preserveEmptyStrings === false`. Confirm all
three, not just the first.

No test asserts on `buildPostgrestRpcBody`; no script under `scripts/` reads it by name. Default
behaviour must be **byte-for-byte unchanged** for every existing caller. The new behaviour is
opt-in only.

## Deliverable 1 — the transport flag

```js
// buildPostgrestRpcBody (~line 497). New: preserveEmptyStrings. '' is otherwise stripped, which
// makes it impossible to clear a text column through an RPC that COALESCEs NULL onto the old value,
// and makes a no-DEFAULT text param vanish from the body entirely.
// Callers that pass no options (tryKernelRpcSupabaseFallback, returnKernelFromStockToProduction)
// keep the exact previous behaviour: null, undefined and '' are all stripped.
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

Keep the existing `Object.keys(...)` iteration exactly as it is — it is the shape already in the
file and this plan is not changing it. **Do not add a comment claiming `Object.keys` prevents
`__proto__` from reaching the request body; that reasoning is wrong** (`Object.keys` does return an
own `__proto__` key, e.g. from `JSON.parse`). Write no prototype-pollution claim of any kind here.

Thread the flag through both layers, keeping these exact names — public option
`preserveEmptyParams`, internal option `preserveEmptyStrings`, mirroring the existing
`preserveNullParams`/`preserveNulls` pair. The full chain, which later sections depend on:

1. a wrapper calls `callFunction(fn, params, token, { preserveEmptyParams: true, … })`;
2. `callFunction` (~line 745) forwards it under the **public** name:
   `{ useAnonAuth: true, preserveNullParams: options.preserveNullParams === true, preserveEmptyParams: options.preserveEmptyParams === true }`;
3. `callSupabaseRpc` (~line 602) translates public → internal at the build call:
   `scope.buildPostgrestRpcBody(params, { preserveNulls: options.preserveNullParams === true, preserveEmptyStrings: options.preserveEmptyParams === true })`.

`preserveEmptyStrings` must appear **only** inside `buildPostgrestRpcBody` and on that one build
call in `callSupabaseRpc`. Wrappers use `preserveEmptyParams` and never `preserveEmptyStrings`.

`undefined` must still be stripped in every case, with or without either flag — that is what "leave
this field unchanged" relies on in `set_report_section_state`.

**The flag is per-call, not per-param.** Once a call passes `preserveEmptyParams: true`, *every*
`''` in that params object is sent, including ids and keys. Any wrapper that sets the flag must
therefore validate its own required scalar arguments before building the body (see Deliverable 2).

Extend the existing explanatory comment block at `callFunction:732-740` with one sentence about
`preserveEmptyParams`; do not rewrite the existing `preserveNullParams` paragraph.

`scripts/verify-ui-standard.mjs` walks every `.js` file under `WebPortal/` (`:61`, `:123-139`), so
**no comment or string added by this plan may contain `btn-success`, `bi bi-`, `bootstrap-icons`, or
`var(--phoenix…)`/`var(--macadamia…)`/`var(--forest…)`/`var(--gold…)`** — those are `ui:verify`
violations even inside a JS comment.

## Deliverable 2 — the report wrappers

Add exactly these eleven, using these names verbatim. Later plans in this series reference them by
name, so a rename here silently breaks them:

`getReportTemplates`, `getReportCurrentPeriod`, `listReportInstances`, `createReportInstance`,
`getReportInstance`, `overrideReportMetricValue`, `clearReportMetricOverride`,
`setReportSectionState`, `setReportExecutiveSummary`, `refreshReportInstance`,
`deleteReportInstance`.

Add **no other new identifiers** — no shared guard helper, no shared cache-key builder. Write the
guards and the cache keys inline in each wrapper. (A shared helper introduced here would be
referenced by later plans under a name this plan never pinned down.)

**No new wrapper may call `buildPostgrestRpcBody` directly.** Wrappers build a plain object literal
and hand it to `callFunction`, which owns the body-building. Reusing the helper as a null-filter is
the `:4471` pattern and it must not spread.

**Do not remove `getSalesForecasts` in this plan.** It is a live one-line stub at
`data-functions.js:4316` returning `[]`, and `WebPortal/modules/sales-forecasting/js/sales_forecasting_grid.js:46`
calls it on a currently-shipping screen. (For the record: that caller wraps the call in
`try { … } catch (error)` at `:43-53` *and* attaches `.catch(function () { return []; })`, so
removing the stub would surface as a caught error banner rather than an unhandled crash — the
earlier claim that `.catch()` would miss a synchronous `TypeError` was wrong. Either way, changing a
working screen is out of scope; its removal belongs with the module deletion, in a later plan.)

Follow the existing `callFunction(...)` style, using `upsertDashboardTarget`
(`data-functions.js:1655-1674`) as the model for a **write** — specifically its params-literal shape
and its trailing `clearCachePattern` call — and `getOilStockLots` (`data-functions.js:4061-4077`) as
the model for a **paged/filtered read**. Two things about those models must be overridden rather
than copied:

- `upsertDashboardTarget` passes `preserveNullParams: true`. **None of the eleven wrappers passes
  `preserveNullParams`**; the guards below make it unnecessary. Do not copy that option or its
  comment verbatim — write a comment that describes what this wrapper actually does.
- `getDashboardTargets` (`:1626-1653`), immediately above the model write, swallows every error into
  `{ rows: [], map: {} }` with a "apply migration … if needed" warning. **Do not copy that pattern
  into any report wrapper** — see "Missing RPCs" below.

RPC parameter names must match exactly, including the `p_` prefix. Parameters with **no DEFAULT**
must always be sent:

| Wrapper | RPC | Params (defaults as declared) |
|---|---|---|
| `getReportTemplates` | `get_report_templates` | `p_period_type` (DEFAULT NULL) |
| `getReportCurrentPeriod` | `get_report_current_period` | `p_period_type` (**no default**) |
| `listReportInstances` | `list_report_instances` | `p_period_type` (NULL), `p_status` (NULL), `p_limit` (50), `p_offset` (0) |
| `createReportInstance` | `create_report_instance` | `p_template_id`, `p_period_date` (**no defaults**), `p_actor_user_id` (DEFAULT NULL) |
| `getReportInstance` | `get_report_instance` | `p_report_instance_id` |
| `overrideReportMetricValue` | `override_report_metric_value` | `p_report_instance_id`, `p_metric_key`, `p_entered_value`, `p_reason` (**no defaults**), `p_actor_user_id` (DEFAULT NULL) |
| `clearReportMetricOverride` | `clear_report_metric_override` | `p_report_instance_id`, `p_metric_key` |
| `setReportSectionState` | `set_report_section_state` | `p_report_instance_id`, `p_section_key`, `p_is_enabled` (DEFAULT NULL), `p_commentary` (DEFAULT NULL) |
| `setReportExecutiveSummary` | `set_report_executive_summary` | `p_report_instance_id`, `p_summary` (**no default**) |
| `refreshReportInstance` | `refresh_report_instance` | `p_report_instance_id` |
| `deleteReportInstance` | `delete_report_instance` | `p_report_instance_id` |

### Required-argument guards (this is what replaces `preserveNullParams`)

Every wrapper validates the no-DEFAULT params it owns **before** calling `callFunction`, and throws
a descriptive `Error` if one is missing, instead of issuing a call that would come back as a
schema-cache or uuid-cast error:

- any `reportInstanceId`, `templateId`, `periodDate`, `metricKey`, `sectionKey`, `periodType` that
  the table marks **no default**: trim to a string and throw when empty;
- `overrideReportMetricValue`: `p_entered_value` must be a finite number
  (`Number.isFinite(Number(v))`; note `0` is a legal value and is **not** stripped by the transport),
  and `p_reason` must be a non-empty trimmed string — it has no DEFAULT, so an empty reason would be
  stripped and the call would fail;
- `p_actor_user_id` (both wrappers that take it) is `this.getCurrentUserId() || undefined` — pass
  `undefined`, never `null`, so it is stripped and the RPC's `DEFAULT NULL` applies.

### Cache keys — fully specified, no wrapper left to guess

There are exactly two cache families, and `clearCachePattern` matches by substring
(`data-functions.js:129-135`), so these prefixes are what makes invalidation work:

| Wrapper | `cacheKey` (build it exactly like this) |
|---|---|
| `getReportTemplates` | `'report_list_templates_' + (params.p_period_type || 'all')` |
| `getReportCurrentPeriod` | `'report_list_current_period_' + params.p_period_type` |
| `listReportInstances` | `'report_list_' + (params.p_period_type || 'all') + '_' + (params.p_status || 'all') + '_' + params.p_limit + '_' + params.p_offset` |
| `getReportInstance` | `'report_instance_' + params.p_report_instance_id` |

The explicit key is mandatory: the default key is `functionName_JSON(params)`
(`callFunction:640`), which the invalidation patterns would not match. Every parameter that changes
the result set **must** be in the key — a constant `'report_list_'` would collide every
filter/page combination onto one entry for the 1-minute `dynamic` TTL, so switching status or paging
would render the previous filter's rows.

All four reads pass, mirroring `getOilStockLots:4071-4076`:

```js
{ cacheKey: <from the table>, useCache: true, cacheTtl: this.cache.ttl.dynamic, forceRefresh: !!forceRefresh }
```

`useCache: true` (not `useCache: !forceRefresh`) is deliberate: caching of the fresh response is
gated on `useCache` at `callFunction:749`, so `useCache: !forceRefresh` would fetch fresh data and
then fail to store it, making every subsequent load a fresh fetch too. `forceRefresh` alone already
bypasses the cache read at `:650`.

### Write rules

The seven writes are `createReportInstance`, `overrideReportMetricValue`,
`clearReportMetricOverride`, `setReportSectionState`, `setReportExecutiveSummary`,
`refreshReportInstance`, `deleteReportInstance`. Each one:

- passes `useCache: false`;
- after the call returns, invalidates both families with these two statements, written literally,
  one of each, in this order and with single quotes:

  ```js
  this.clearCachePattern('report_instance_');
  this.clearCachePattern('report_list_');
  ```

  Without this the editor shows stale figures immediately after an override.
- returns `callFunction`'s result unchanged. Note that `callFunction:659-696` queues writes when the
  browser is offline for any `functionName` containing `create`/`update`/`delete`/`deactivate` —
  which here is exactly `create_report_instance` and `delete_report_instance` — and returns
  `{ success: true, offline: true, queued: true }`. Add a one-line comment on those two wrappers
  recording that; do not add code that reinterprets or hides that envelope.

Two wrappers, and only these two, pass the new flag. Write it on its own line, exactly
`preserveEmptyParams: true,` so the verification count below is stable:

- `setReportSectionState` — so a cleared commentary reaches the server as `''`. It must send
  `p_is_enabled` as `undefined` (never `null`) when only the commentary is being changed, so the
  param is stripped and the server's `COALESCE(p_is_enabled, is_enabled)` leaves the toggle alone.
  Because the flag is per-call, `p_report_instance_id` and `p_section_key` must be guarded non-empty
  first, or an empty string would be sent as a uuid / section key.
- `setReportExecutiveSummary` — `p_summary` has no DEFAULT, so it must always be present:
  convert `null`/`undefined` to `''` before the call. `p_report_instance_id` must be guarded
  non-empty first, for the same per-call reason.

Reference sketches for those two (match these identifier names exactly; the other nine follow the
same shape):

```js
setReportSectionState: async function (reportInstanceId, sectionKey, changes = {}, token = null) {
    const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
    const key = (sectionKey != null ? String(sectionKey) : '').trim();
    if (!id) throw new Error('setReportSectionState: reportInstanceId is required.');
    if (!key) throw new Error('setReportSectionState: sectionKey is required.');
    const hasEnabled = changes.is_enabled === true || changes.is_enabled === false;
    const hasCommentary = typeof changes.commentary === 'string';
    if (!hasEnabled && !hasCommentary) throw new Error('setReportSectionState: nothing to change.');
    // undefined (never null) leaves the server-side COALESCE on the untouched field alone.
    // preserveEmptyParams is per-call, which is why id and key are validated above.
    const params = {
        p_report_instance_id: id,
        p_section_key: key,
        p_is_enabled: hasEnabled ? changes.is_enabled : undefined,
        p_commentary: hasCommentary ? changes.commentary : undefined
    };
    const result = await this.callFunction('set_report_section_state', params, token, {
        useCache: false,
        preserveEmptyParams: true
    });
    this.clearCachePattern('report_instance_');
    this.clearCachePattern('report_list_');
    return result;
},

setReportExecutiveSummary: async function (reportInstanceId, summary, token = null) {
    const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
    if (!id) throw new Error('setReportExecutiveSummary: reportInstanceId is required.');
    // p_summary has NO DEFAULT: it must be in the body every time, '' included.
    const params = {
        p_report_instance_id: id,
        p_summary: (summary == null) ? '' : String(summary)
    };
    const result = await this.callFunction('set_report_executive_summary', params, token, {
        useCache: false,
        preserveEmptyParams: true
    });
    this.clearCachePattern('report_instance_');
    this.clearCachePattern('report_list_');
    return result;
}
```

### Transport and security invariants the wrappers must not bypass

- Every wrapper goes through `this.callFunction(...)`. Do not call `fetch` directly, do not build a
  Supabase URL or embed a key, and do not call `callSupabaseRpc` directly. That path is what keeps
  `ensureConfigured()` (`:538`), the `assertMacavationSupabaseUrl(url)` check in
  `getSupabaseRestConfig` (`:560-562`) and the `X-User-Id` audit header (`:595-598`) in force.
- Do not log tokens, params containing ids, or response bodies beyond the `console.warn`/`log` style
  already present.
- This plan creates and modifies **no** SQL function; the report RPCs are pre-existing
  `SECURITY DEFINER … SET search_path = public` functions and are out of scope.

## Missing RPCs must not throw uncaught

If a report RPC is absent from the target database, `callFunction` throws. Each wrapper lets the
error propagate (callers in later plans wrap in `try/catch` and render an empty state) but must
**not** swallow it into a fake success value — a wrapper returning `[]` on failure would make a
missing migration look like "no reports yet". Add a one-line comment to that effect on each of the
four read wrappers so a future editor does not add a `.catch(() => [])` or copy the
`getDashboardTargets:1649-1652` catch-to-empty block.

## Verification — all runnable inside the checkout, no browser, no login, no network

Every count below was taken from this checkout; where a count is stated as "today", it is the
pre-edit value and it must not change.

1. `npm run test:fleet` passes. It is exactly (`package.json:27`)
   `npm run routing:verify && npm run username:verify && node scripts/verify-phase2-migrations.mjs && npm run ui:verify && npm run migrations:verify && npm run registry:verify`.
   `ui:verify` scans `WebPortal/js/data-functions.js`, so a banned string in a new comment will fail
   this step.
2. `grep -c "buildPostgrestRpcBody" WebPortal/js/data-functions.js` returns **4** — the same value
   as before the edit (definition, `tryKernelRpcSupabaseFallback`, `callSupabaseRpc`,
   `returnKernelFromStockToProduction`). `grep -n` output must still show one occurrence inside
   `returnKernelFromStockToProduction`, immediately above its
   `if (!params.p_batch_number && !params.p_kernel_id) throw` guard. If the count is not 4, report
   it — do not edit any call site to make it 4.
3. `git diff -- WebPortal/js/data-functions.js` shows **no change** to
   `returnKernelFromStockToProduction`, to `tryKernelRpcSupabaseFallback`, or to
   `upsertKernelIntakeProcurement`. `git status --porcelain` shows `WebPortal/js/data-functions.js`
   as the only modified path.
4. `grep -n "preserveEmptyStrings\|preserveEmptyParams" WebPortal/js/data-functions.js` and read the
   output: `preserveEmptyStrings` appears only inside `buildPostgrestRpcBody` and on the
   `buildPostgrestRpcBody(...)` call in `callSupabaseRpc`; `preserveEmptyParams` appears in
   `callSupabaseRpc`'s translation, in `callFunction`'s options object, and in exactly the two
   wrappers `setReportSectionState` and `setReportExecutiveSummary`. In addition,
   `grep -cF "preserveEmptyParams: true" WebPortal/js/data-functions.js` returns **2**.
5. `grep -c "getSalesForecasts" WebPortal/js/data-functions.js` returns **1** — the stub at `:4316`
   is still there and untouched.
6. All eleven wrapper names are present:
   `for n in getReportTemplates getReportCurrentPeriod listReportInstances createReportInstance getReportInstance overrideReportMetricValue clearReportMetricOverride setReportSectionState setReportExecutiveSummary refreshReportInstance deleteReportInstance; do grep -q "$n" WebPortal/js/data-functions.js || echo "MISSING $n"; done`
   prints nothing.
7. Write-side cache invalidation, one pair per write wrapper (both literals occur **0** times in
   `WebPortal/` today, so these counts are unambiguous):
   - `grep -cF "clearCachePattern('report_instance_')" WebPortal/js/data-functions.js` returns **7**
   - `grep -cF "clearCachePattern('report_list_')" WebPortal/js/data-functions.js` returns **7**

   Then read the seven write wrappers and confirm each one contains `useCache: false`. **Do not**
   assert anything about `grep -rn "useCache: false" … | grep -ci report`: that pipeline returns
   **1** in this checkout today (`:1938 get_scheduled_reports`) and its value depends on line
   wrapping, not on correctness. It is not a check.
8. Read-side cache keys: `grep -n "report_list_\|report_instance_" WebPortal/js/data-functions.js`
   and confirm `listReportInstances`' key concatenates all four of `p_period_type`, `p_status`,
   `p_limit`, `p_offset`, and that `getReportInstance`' key concatenates
   `p_report_instance_id`. A constant key on either is a failure.
9. A pure unit check of the transport function, run with `node`, no network, **outside the working
   tree** so nothing can be left behind or committed:
   `T=$(mktemp -d)` → write the scratch script to `$T/check.mjs` → copy `buildPostgrestRpcBody`'s
   post-edit body into it → `node $T/check.mjs` → `rm -rf "$T"`. Assert all four cases on
   `{a: 1, b: null, c: '', d: undefined}`:
   - no options → `{a: 1}`
   - `{preserveNulls: true}` → `{a: 1, b: null}`
   - `{preserveEmptyStrings: true}` → `{a: 1, c: ''}`
   - both → `{a: 1, b: null, c: ''}`

   `d` must be absent in every case. Also assert the no-options case for the exact object shape
   `returnKernelFromStockToProduction` passes — `{p_batch_number: null, p_kernel_id: null}` → `{}`,
   and `{p_batch_number: 'B-1', p_kernel_id: null}` → `{p_batch_number: 'B-1'}` — since that site's
   `throw` guard depends on it.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site.** Playwright here runs against `https://demo-macavation.customapp.org`
(`Playwright Tests/playwright.config.ts:30`) and cannot run inside the fleet job.

## Out of scope

Any UI, any route, any sidebar change, any migration, deleting the `sales-forecasting` module,
removing `getSalesForecasts`, editing `returnKernelFromStockToProduction` or any other existing
`buildPostgrestRpcBody`/`callSupabaseRpc` caller, and applying anything to a database. Do not edit
any Playwright spec, `WebPortal/help/*`, `docs/**`, or `permission-module-map.js`.
