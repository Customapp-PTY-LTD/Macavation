---
retry_of: f2ad1448-a031-4b0b-8c22-65fda935205f
---

# One shared `escapeHtml`, replacing 35 hand-written copies

## Context

`escapeHtml` is independently defined in **35 files** under `WebPortal/` (excluding `help/`, which
contains zero occurrences), and the copies do not agree on what escaping means. This is
security-adjacent code on hundreds of call sites, so 35 chances for one of them to be subtly wrong.

**Verified state of the 35 definitions in this checkout** (do not restate any other numbers; these
were re-measured against the code):

| Shape | Count | Escapes `&` `<` `>` | Escapes `"` | Escapes `'` |
|---|---|---|---|---|
| DOM trick — `div.textContent = x; return div.innerHTML` | 25 | Yes | **No** | **No** |
| `.replace()` chain | 10 | Yes | Yes | **No** |

**No copy anywhere in `WebPortal/**/*.js` escapes the single quote.** There are zero matches for
`&#39;`, `&#x27;` or `replace(/'/g)` in `WebPortal/`. So the 25 DOM-trick copies used to interpolate
into a double-quoted **attribute value** — `<div title="${escapeHtml(x)}">` — do not prevent breaking
out of that attribute. Unifying on the strict form therefore closes real holes rather than merely
tidying.

Definition shapes, verified:

- 21 file-private definitions: 18 written `function escapeHtml(<param>) {` and 3 written
  `const escapeHtml = (text) => {` (`crm_whatsapp_internal_tab.js:14`,
  `crm_whatsapp_contacts_tab.js:28`, `kernel_production_grid.js:45`).
- 14 object-member definitions written `escapeHtml: (text) => {`. **Calls into these are qualified**
  (e.g. `scope.escapeHtml(...)` in `users_grid.js:135,180,190-192,208`), not unqualified. That is fine:
  the member stays where it is, so call sites do not change.

Parameter names vary (`s`, `t`, `str`, `text`, `v`), which is why each alias must keep its own file's
parameter name rather than being normalised.

Examples of each shape: `WebPortal/js/notifications.js:27` and
`WebPortal/modules/admin/js/admin_grid.js:10` (DOM trick);
`WebPortal/js/batch-status.js:152` and
`WebPortal/modules/stock-management/js/stock_management_grid.js:63` (replace chain).
`WebPortal/modules/batch-journey/js/batch_journey_grid.js:67` is a hybrid: it delegates to
`BatchStatus.escapeHtml(s)` when `BatchStatus` is defined (it is exposed at `batch-status.js:238`) and
falls back to its own replace chain otherwise.

### Why not reuse `_common.sanitizeHtml`

`WebPortal/js/common.js:244-248` already exposes `sanitizeHtml`, and it is tempting to point
everything at it. **Do not.** It is the DOM trick:

```js
sanitizeHtml: function (html) {
    const temp = document.createElement('div');
    temp.textContent = html;
    return temp.innerHTML;
},
```

It does not escape quotes, so routing the 10 currently-quote-escaping call sites through it would be a
**regression**. This plan adds a new strict `_common.escapeHtml` beside it and leaves `sanitizeHtml`
exactly as it is, since other code may depend on its current behaviour.

## Scope

**In:** one new strict `_common.escapeHtml`; the 35 local `escapeHtml` definitions in `WebPortal/`
reduced to thin, guard-preserving aliases; the `common.js` cache-bust bumped.

**Out:** `showError` (19 copies), `showSuccess` (9), `formatDate` (11). Deferred deliberately —
`_common` exposes **two** date formatters (`formatDate` and `formatDateDDMMYYYY`) with different
output, so choosing which one each of the 11 call sites wants changes what users see on screen. That
is a display decision per call site, not a codemod, and it does not belong in the same diff as a
security fix.

**Out:** the 4 `renderPagination` copies — they likely differ behaviourally.

**Out:** changing any call site. See the delegation approach below.

**Out — every other escaping helper or inline escape chain in the repo. These are NOT duplicate
implementations for the purposes of this plan and must be left byte-identical:**

- `WebPortal/js/table-actions.js:12`
- `WebPortal/js/mac-status.js:52`
- `WebPortal/js/ui-states.js:14`
- `WebPortal/modules/assistant/mac-assistant-shell.js:68` (`esc`)
- `WebPortal/modules/modals/modal-batch-history/js/modal_batch_history.js:18` (`historyEscapeHtml`)
- `WebPortal/modules/modals/modal-supplier-intake-adjust-stock/js/modal_supplier_intake_adjust_stock.js:56` (`escapeAttr`)
- `WebPortal/modules/modals/modal-supplier-receiver-checklist/js/modal_supplier_receiver_checklist.js:122` (`escapeAttr` — same file as an in-scope `escapeHtml` at :66; only :66 changes)
- the inline `.replace(/&/g, '&amp;')…` batch-number chain at `WebPortal/modules/supplier-intake/js/supplier_intake_grid.js:510` (same file as an in-scope `escapeHtml` at :88; only :88 changes)
- the inline chain at `WebPortal/modules/grower-intake/js/grower_intake_grid.js:392`
- `escapeHtml: escapeHtml` at `WebPortal/js/batch-status.js:238` (the public re-export — leave it)

**Out:** `modules/stock-management/js/stock_management_grid.js` **at the repo root** (outside
`WebPortal/`). A stray duplicate of the module file exists there. `WebPortal/index.html` and
`WebPortal/js/appRouter.js:780-808` resolve module scripts relative to `WebPortal/`, so the root copy
is not loaded by the portal. Do not edit it, do not delete it, and do not count it.

## Work

### 1. `WebPortal/js/common.js` — add the strict escaper

`_common` is a file-scope global (`var _common = {` at `common.js:4`, re-exported as
`window._common` at `:442`), so `_common.escapeHtml` is reachable from every later script.

Add to the `_common` object, immediately after `sanitizeHtml` (`:244-248`), keeping the file's
existing `function`-property style:

```js
    // Strict HTML escape for interpolation into markup, including attribute values.
    // Escapes all five characters: & < > " '. Prefer this over sanitizeHtml, which
    // uses textContent/innerHTML and therefore does NOT escape quotes — unsafe when
    // the result lands inside an attribute. Ampersand must be replaced first.
    escapeHtml: function (value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },
```

Details that must not be "simplified":

- **`&` first.** Replacing it after `<` would double-escape the `&` in `&lt;`.
- **The `null`/`undefined` guard stays**, but it is the *floor*, not the whole story — see step 2's
  guard-preservation rule, which is what actually keeps behaviour unchanged.

Escaping *more* characters than the previous implementations is safe in the contexts that exist here:
every verified call site interpolates into an HTML string (element text or a quoted attribute value),
and the parser decodes `&quot;`/`&#39;` back to `"`/`'`, so nothing renders differently. Note also
that escaping `'` does **not** make a JS-in-attribute context (e.g. `onclick="f('…')"`) safe, because
the HTML parser decodes `&#39;` back to `'` before the JS is parsed — it is no worse than today, but
do not treat any call site as newly safe on that basis, and do not remove any other escaping in
reliance on this change.

### 2. Replace each of the 35 local definitions with a guard-preserving alias

**Do not touch any call site.** Keep each definition's name, its declaration form (`function`,
`const … =>`, or object member), and its parameter name exactly as they are; replace only the escaping
body.

**Guard preservation is mandatory.** The existing copies do not all guard the same way, and the
differences are user-visible. Each alias must reproduce its own file's existing guard line(s)
**verbatim**, before delegating. Verified guard groups:

- `if (!text) return '';` — 12 files: `modal_role_permission.js:8`, `features_grid.js:239`,
  `roles_grid.js:274`, `modal_admin_add_user.js:42`, `modal_user.js:8`, `role-features_grid.js:397`,
  `quality_assurance_grid.js:160`, `modal_role_feature.js:8`, `users_grid.js:316`,
  `role-permissions_grid.js:299`, `palladium_integration_grid.js:107`, `my_day.js:66`.
  Dropping this would newly render `0`, `false` and `NaN` where `''` renders today.
- `if (text == null || typeof text !== 'string') return '';` — 2 files:
  `document_management_grid.js:11` (30 call sites) and `kernel_production_grid.js:46`.
  Dropping this would newly render numbers, dates and `[object Object]`, including into the
  navigation-carrying attribute built at `document_management_grid.js:333` and `:392`
  (`data-folder-navigate="' + escapeHtml(cat.id) + '"`).
- `if (text == null || text === '') return '';` — 5 files: `crm_whatsapp_internal_tab.js:15`,
  `crm_whatsapp_contacts_tab.js:29`, `oil_production_grid.js:2127`, `crm_grid.js:553`,
  `admin_grid.js:11`.
- `if (<param> == null) return '';` — the remaining 16 files.

Shapes, illustrated with the guard that happens to belong to that file:

Private `function` definition:

```js
    function escapeHtml(text) {
        if (!text) return '';
        return _common.escapeHtml(text);
    }
```

Private `const` arrow definition:

```js
    const escapeHtml = (text) => {
        if (text == null || typeof text !== 'string') return '';
        return _common.escapeHtml(text);
    };
```

Object-member definition (preserve the surrounding object, the member name and the trailing comma):

```js
        escapeHtml: (text) => {
            if (!text) return '';
            return _common.escapeHtml(text);
        },
```

`batch_journey_grid.js:67-71` keeps **both** of its existing pre-checks in order:

```js
    function escapeHtml(s) {
        if (typeof BatchStatus !== 'undefined') return BatchStatus.escapeHtml(s);
        if (s == null) return '';
        return _common.escapeHtml(s);
    }
```

This keeps the diff to one hunk per file, leaves all call sites untouched, and still means exactly one
escaping implementation exists.

Load order is already correct: `common.js` is loaded at `WebPortal/index.html:566`, ahead of the three
shared-layer files that define their own copy (`notifications.js:581`, `batch-status.js:586`,
`handoff-dialog.js:587`), and module scripts are injected later still by
`WebPortal/js/appRouter.js:780-808`. No guard for a missing `_common` is needed — do not add one.

Get the file list by re-running, **with the `WebPortal/` path scope**:

```
grep -rlE "(function escapeHtml|escapeHtml\s*[:=]\s*(\(|function))" WebPortal/ --include=*.js
```

It returns exactly 35 files today. **Run it scoped as written.** A repo-wide run returns 36 because of
the out-of-tree duplicate named in the Out list; that extra file is not in scope. If the scoped grep
does not return exactly 35 files, **stop and report the discrepancy instead of guessing.** The same
stop-and-report rule applies to every check in this plan: if any acceptance check cannot be satisfied
without editing a file outside the 35, stop and report rather than widening the diff.

Highest-traffic files, for orientation: `stock_management_grid.js` (64 `escapeHtml(` lines),
`oil_production_grid.js` (53), `admin_grid.js` (34), `document_management_grid.js` (30),
`crm_grid.js` (17).

### 3. Bump the `common.js` cache-bust

`WebPortal/index.html:566` currently reads `<script src="js/common.js?v=20260610a"></script>`. Change
the query value so browsers fetch the new file. A behaviour change in `common.js` behind a stale cache
key ships nothing, so this step is not optional.

Do not touch any other `<script src>` version string.

## Guardrails

- **Do not modify `_common.sanitizeHtml`.** Other code may rely on its current, quote-preserving
  behaviour. It stays byte-identical.
- **Do not change any call site.** No `escapeHtml(` → `_common.escapeHtml(` rewriting at call sites,
  and no changes to the qualified `scope.escapeHtml(...)` / `BatchStatus.escapeHtml(...)` calls; the
  aliases handle it.
- **Do not delete, edit, inline or "de-duplicate" any of the out-of-scope escaping helpers or inline
  escape chains listed under Scope → Out.** Those chains are live escaping on batch numbers and
  attribute values; removing one introduces XSS. They are expected to keep matching any
  `replace(/&/g` search after this change, and that is correct, not a leftover.
- **Do not normalise or drop any file's existing guard**, and do not rename parameters.
- **Do not touch the repo-root `modules/` tree.**
- **Do not touch `showError`, `showSuccess`, `formatDate`, or `renderPagination`** anywhere.
- **Do not introduce a sanitiser library or any npm dependency.** `package.json` has no dependency
  section and there is no lockfile, by design.
- **Security invariant to preserve:** output interpolated into markup stays escaped. Do not "optimise"
  any call site by dropping an `escapeHtml(...)` wrapper, and do not convert any existing `.text()`
  usage into `.html()`/`innerHTML` while editing these files.
- Do not reformat or re-lint the 35 files. One hunk each; leave surrounding code alone.
- Do not delete a file. Do not add a `.sql` file.
- Do not modify `package.json`, and do not weaken `npm run test:fleet`
  (`routing:verify && username:verify && verify-phase2-migrations`).

## Acceptance criteria

1. `WebPortal/js/common.js` exposes `escapeHtml` on `_common`, escaping `&`, `<`, `>`, `"` and `'`,
   with `&` replaced first and a `null`/`undefined` guard returning `''`.
2. `_common.sanitizeHtml` is unchanged — `git diff` on `common.js` shows an addition only, no edit to
   lines 244-248.
3. `grep -rl "_common\.escapeHtml(" WebPortal/ --include=*.js` returns exactly the 35 files from the
   scoped grep in step 2 — no more, no fewer.
4. **Each of the 35 definitions is now an alias, and no in-scope definition contains its own escaping
   logic.** Verify by reading each of the 35 edited hunks: the body is the file's original guard
   line(s) verbatim, then `return _common.escapeHtml(<param>);`, and it contains no
   `document.createElement`, no `textContent`, no `innerHTML` and no `.replace(/` inside the
   definition. (Do not attempt this with a single-line grep for `textContent … return … innerHTML`:
   those copies span lines and a line-based grep matches nothing, so such a check proves nothing.)
5. **The out-of-scope escaping code is untouched.** `git diff --name-only` includes none of:
   `WebPortal/js/table-actions.js`, `WebPortal/js/mac-status.js`, `WebPortal/js/ui-states.js`,
   `WebPortal/modules/assistant/mac-assistant-shell.js`,
   `WebPortal/modules/modals/modal-batch-history/js/modal_batch_history.js`,
   `WebPortal/modules/modals/modal-supplier-intake-adjust-stock/js/modal_supplier_intake_adjust_stock.js`,
   `WebPortal/modules/grower-intake/js/grower_intake_grid.js`, or anything under the repo-root
   `modules/` directory. In the two in-scope files that also contain out-of-scope code, `git diff`
   shows a single hunk each and leaves `escapeAttr` in
   `modal_supplier_receiver_checklist.js` and the inline chain in `supplier_intake_grid.js`
   byte-identical.
6. **Call-site count is preserved, measured against a baseline captured from this checkout — do not
   hardcode a figure.** Before editing, record:
   - `A = grep -rohE "escapeHtml\(" WebPortal --include=*.js | wc -l` (all occurrences, qualified and
     not; note `-oh` drops filenames, so any `| grep -v help/` filter is a no-op — it is also
     unnecessary, `WebPortal/help/` contains zero `escapeHtml` occurrences)
   - `B = grep -rohE "(^|[^A-Za-z0-9_.])escapeHtml\(" WebPortal --include=*.js | wc -l` (unqualified
     occurrences only)

   After editing: `B` is **unchanged**, and `A` equals baseline `A + 35` — exactly one new
   `_common.escapeHtml(` per aliased file. Any other delta means a call site moved; stop and report.
7. `WebPortal/index.html` line 566's `js/common.js?v=` value differs from `20260610a`, and no other
   `<script src>` version string in the file has changed.
8. No new npm dependency; `package.json` byte-identical; no `package-lock.json` created.
9. No `.sql` file added, deleted or modified. No file deleted.
10. `npm run test:fleet` passes.
