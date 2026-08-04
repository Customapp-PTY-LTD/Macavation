# One shared `escapeHtml`, replacing 35 hand-written copies

## Context

`escapeHtml` is independently defined in **35 files** under `WebPortal/` (excluding `help/`), and the
copies do not agree on what escaping means. This is security-adjacent code on 413 call sites, so 35
chances for one of them to be subtly wrong.

Measured across all 35 definitions:

| Shape | Count | Escapes `"` and `'`? |
|---|---|---|
| DOM trick — `temp.textContent = x; return temp.innerHTML` | 24 | **No** |
| `.replace()` chain | 10 | Yes |
| `.replace()` chain, quotes omitted | 1 | **No** |

So **25 of 35 do not escape quotes.** The DOM `textContent` → `innerHTML` serialisation escapes `&`,
`<` and `>` only; it leaves `"` and `'` untouched. Any of those 25 used to interpolate into an
**attribute value** — `<div title="${escapeHtml(x)}">` — does not prevent breaking out of the
attribute. Unifying on the strict form therefore closes real holes rather than merely tidying.

The definitions were clearly hand-typed rather than copied: parameter names vary five ways (`s`, `t`,
`str`, `text`, `type`), and 18 are private functions while 17 are object members.

Examples of each shape: `WebPortal/js/notifications.js:27` and
`WebPortal/modules/admin/js/admin_grid.js:10` (DOM trick);
`WebPortal/js/batch-status.js:152` and `WebPortal/modules/stock-management/js/stock_management_grid.js:63`
(replace chain, quotes escaped); `WebPortal/modules/crm-whatsapp/js/crm_whatsapp_contacts_tab.js`
(replace chain, quotes **not** escaped).

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

It does not escape quotes, so routing the 10 currently-strict call sites through it would be a
**regression**. This plan adds a new strict `_common.escapeHtml` beside it and leaves `sanitizeHtml`
exactly as it is, since other code may depend on its current behaviour.

## Scope

**In:** one new strict `_common.escapeHtml`; the 35 local definitions reduced to thin aliases; the
`common.js` cache-bust bumped.

**Out:** `showError` (19 copies), `showSuccess` (9), `formatDate` (11). Deferred deliberately —
`_common` exposes **two** date formatters (`formatDate` and `formatDateDDMMYYYY`) with different
output, so choosing which one each of the 11 call sites wants changes what users see on screen. That
is a display decision per call site, not a codemod, and it does not belong in the same diff as a
security fix.

**Out:** the 4 `renderPagination` copies — they likely differ behaviourally.

**Out:** changing any of the 413 call sites. See the delegation approach below.

## Work

### 1. `WebPortal/js/common.js` — add the strict escaper

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

Two details that matter and must not be "simplified":

- **`&` first.** Replacing it after `<` would double-escape the `&` in `&lt;`.
- **The null/undefined guard is required, not defensive padding.** The 24 DOM-trick copies return an
  empty string for `null` (assigning `null` to `textContent` yields `''`), whereas a bare
  `String(null)` yields the literal text `null`. Without the guard, 24 files would start rendering
  the word "null" in empty cells.

Escaping *more* than the previous implementation is safe in both contexts: in text content the
browser decodes `&quot;` and `&#39;` back to `"` and `'`, so nothing renders differently.

### 2. Replace each of the 35 local definitions with an alias

**Do not touch the 413 call sites.** Every call is the unqualified `escapeHtml(...)`; keep that name
in place and re-point it at the shared implementation. For a private-function definition:

```js
function escapeHtml(value) { return _common.escapeHtml(value); }
```

For an object-member definition, preserve the surrounding object and member syntax:

```js
    escapeHtml: (value) => _common.escapeHtml(value),
```

This keeps the diff to one hunk per file, leaves all call sites untouched, and still means exactly one
implementation exists.

Load order is already correct: `common.js` is loaded at `WebPortal/index.html:566`, ahead of the three
shared-layer files that define their own copy (`notifications.js:581`, `batch-status.js:586`,
`handoff-dialog.js:587`), and module scripts are loaded later still by the router. No guard for a
missing `_common` is needed — do not add one.

The 35 files, from `grep -rlE "(function escapeHtml|escapeHtml\s*[:=]\s*(\(|function))" WebPortal/ --include=*.js`
(excluding `WebPortal/help/`). Re-run that grep rather than working from a copied list; if it does not
return exactly 35 files, stop and report the discrepancy instead of guessing.

Highest-traffic files, for orientation: `stock_management_grid.js` (64 calls),
`oil_production_grid.js` (53), `admin_grid.js` (34), `document_management_grid.js` (30),
`crm_grid.js` (17).

### 3. Bump the `common.js` cache-bust

`WebPortal/index.html:566` currently reads `<script src="js/common.js?v=20260610a"></script>`. Change
the query value so browsers fetch the new file.

**This step is not optional.** This repo has shipped commits whose only purpose was bumping a
cache-bust so an already-merged fix would actually reach users — the `data-functions.js` bump exists
for exactly that reason. A behaviour change in `common.js` behind a stale cache key ships nothing.

Do not touch any other `<script src>` version string.

## Guardrails

- **Do not modify `_common.sanitizeHtml`.** Other code may rely on its current, quote-preserving
  behaviour. It stays byte-identical.
- **Do not change any of the 413 call sites.** No `escapeHtml(` → `_common.escapeHtml(` rewriting at
  call sites; the alias handles it.
- **Do not touch `showError`, `showSuccess`, `formatDate`, or `renderPagination`** anywhere.
- **Do not introduce a sanitiser library or any npm dependency.** This repo has zero dependencies and
  no lockfile by design; adding one breaks `npm ci` assumptions elsewhere.
- **Security invariant to preserve:** the point of this change is that output interpolated into markup
  is escaped. Do not "optimise" any call site by dropping the `escapeHtml(...)` wrapper, and do not
  convert any existing `.text()` usage into `.html()`/`innerHTML` while editing these files.
- Do not reformat or re-lint the 35 files. One hunk each; leave surrounding code alone.
- Do not delete a file. Do not add a `.sql` file.
- Do not modify `package.json`, and do not weaken `npm run test:fleet`.

## Acceptance criteria

1. `WebPortal/js/common.js` exposes `escapeHtml` on `_common`, escaping `&`, `<`, `>`, `"` and `'`,
   with `&` replaced first and a `null`/`undefined` guard returning `''`.
2. `_common.sanitizeHtml` is unchanged — `git diff` on `common.js` shows an addition only, no edit to
   lines 244-248.
3. `grep -rc "_common.escapeHtml" WebPortal/ --include=*.js` shows a match in all 35 previously-listed
   files plus `common.js`.
4. **No file contains a second implementation.** `grep -rE "textContent\s*=\s*.*;\s*return.*innerHTML" WebPortal/ --include=*.js`
   returns only `common.js`'s `sanitizeHtml`. `grep -rn "replace(/&/g" WebPortal/ --include=*.js`
   returns only `common.js`.
5. The total number of `escapeHtml(` call sites is unchanged at 413:
   `grep -rohE "escapeHtml\(" WebPortal/ --include=*.js | grep -v help/ | wc -l`.
6. `WebPortal/index.html` line 566's `js/common.js?v=` value differs from `20260610a`, and no other
   `<script src>` version string in the file has changed.
7. No new npm dependency; `package.json` byte-identical; no `package-lock.json` created.
8. No `.sql` file added, deleted or modified. No file deleted.
9. `npm run test:fleet` passes.
