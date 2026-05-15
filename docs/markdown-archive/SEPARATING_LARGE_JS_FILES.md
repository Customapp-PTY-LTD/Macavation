# How to Separate Large JavaScript Files

This guide describes how to split a large, monolithic JS file into smaller modules while keeping the same behaviour and following existing project patterns (e.g. hatchability-style modules).

---

## Basic Standards (All Module JS Files)

These apply to **every** module JS file. Not every file needs to be split; all should follow these conventions.

| Standard | Requirement |
|----------|-------------|
| **Module shape** | One IIFE that **returns a single object**. No loose global functions or separate `scope` object. |
| **Methods** | Use **arrow-function methods** on the returned object: `methodName: () => { ... }` or `methodName: (arg) => { ... }`. |
| **Global name** | One global variable per module, matching the file (e.g. `_adminGrid` for `admin_grid.js`). Use leading `_` for internal modules. |
| **Same-module calls** | In any method that calls another method on the same module, set `const scope = _moduleName` at the start, then call `scope.otherMethod()`. |
| **Cross-module calls** | Always guard: `if (typeof _otherModule !== 'undefined' && _otherModule.method) _otherModule.method();` |
| **Timing** | Prefer **async/await** and helpers (`delay(ms)`, `waitForElement(selector, maxMs)`) instead of raw `setTimeout` at call sites. |
| **Entry init** | The entry module owns page-level init (load data, bind events); it may call feature modules’ `init()` after. |
| **Init at end** | At the end of the module file, just call **`_moduleName.init();`**. No wrapper function, no checks. The script is loaded by the route; when it runs, init runs. Infrastructure handles load order. |
| **Button / form handlers** | Use an **`initHandlers`** method (or similar) that attaches click/submit handlers to the relevant buttons or forms by **id** or selector. Call `initHandlers` from `init` (after the DOM / tables / buttons are loaded). Do not rely on global functions or inline `onclick` in HTML; attach in JS. |
| **jQuery** | Use **jQuery** for DOM selection, event binding, and content updates where the project already uses it (e.g. `$('#id')`, `$(selector).on('click', ...)`, `.html()`, `.val()`). Keeps module code consistent with the rest of the app; use vanilla `document.getElementById` / `addEventListener` only when not mixing with jQuery in the same flow. |
| **Dates** | Display all dates in **dd/mm/yyyy** format (e.g. 17/02/2025). Use a small helper or consistent formatting so users see the same format everywhere. |

**Init-at-end example** (see `modules/amanda-dashboard/js/amanda_dashboard.js`):

```javascript
}();
_amandaDashboard.init();
```

**initHandlers example** (call from `init` after setupFormHandlers / when DOM is ready; see `modules/admin/js/admin_grid.js`):

```javascript
initHandlers: () => {
    const scope = _adminGrid;
    const userBtn = document.getElementById('addUserSubmitBtn');
    if (userBtn) userBtn.addEventListener('click', () => scope.submitUserForm());
    const roleBtn = document.getElementById('addRoleSubmitBtn');
    if (roleBtn) roleBtn.addEventListener('click', () => scope.submitRoleForm());
},
```

In HTML, use `id="addUserSubmitBtn"` (or similar) on the button instead of `onclick="submitUserForm()"`.

**Date formatting**: Use the shared helper in `js/common.js`. Display all dates in **dd/mm/yyyy** (e.g. 17/02/2025):

- **Reference**: `_common.formatDateDDMMYYYY(value)` — defined in `js/common.js`, available wherever common is loaded.
- **Usage**: `(typeof _common !== 'undefined' && _common.formatDateDDMMYYYY ? _common.formatDateDDMMYYYY(dateValue) : dateValue) || 'N/A'` for safe use in modules.
- **Example**: `_common.formatDateDDMMYYYY(trans.transaction_date)` in table cells, exports, etc.

When adding or refactoring module JS, apply these first. Splitting into multiple files is only required when the file is large or has multiple distinct features (see “When to Split” below).

---

## 1. When to Split

Consider splitting when a file:

- Is **800+ lines** (or whatever threshold your team uses)
- Handles **multiple distinct features** (e.g. grid, modals, actions)
- Is **hard to navigate** or has many unrelated responsibilities
- Would benefit from **parallel work** (different devs on different modules)

---

## 2. High-Level Approach

1. **Identify a single entry module** – the one that loads the main UI and wires top-level behaviour (e.g. table, filters, main buttons).
2. **Extract feature modules** – one file per major feature (e.g. “stages” modal, “job card” modal, “batch actions”).
3. **Entry module owns init** – it loads data, binds events, then calls `init()` on each feature module so load order is explicit and predictable.
4. **Cross-module calls** – entry and features call each other via **global module variables** (e.g. `_kernelProductionGrid`, `_kernelProductionStages`), with existence checks before calling.

---

## 3. File and Naming Conventions

- **Entry / main module**: e.g. `feature_grid.js` or `feature_main.js` – sets up the page and table, delegates actions to other modules.
- **Feature modules**: one file per feature, e.g. `feature_stages.js`, `feature_job_card.js`, `feature_batch_actions.js`.
- **Global variable per module**: one global, matching the file name (e.g. `_kernelProductionGrid`, `_kernelProductionStages`). Use a leading `_` if you use that convention for “internal” modules.
- **Folder structure**: keep all of a feature’s JS in one folder, e.g. `modules/<feature>/js/`.

---

## 4. Module Pattern (Match Existing Codebase)

Use the same pattern as existing modules (e.g. hatchability):

- **One IIFE** that **returns a single object** (no building a `scope` object and attaching methods to it).
- **Arrow-function methods** on that object: `methodName: () => { ... }` or `methodName: (arg) => { ... }`.
- **Same-module calls**: at the start of any method that calls another method on the same module, set `const scope = _moduleName`, then call `scope.otherMethod()` so the reference is stable (e.g. after minification or reassignment).

Example:

```javascript
var _myFeatureGrid = function () {
    'use strict';

    return {
        data: [],

        init: async () => {
            const scope = _myFeatureGrid;
            await scope.waitForReady();
            scope.bindEvents();
            scope.loadData();
            if (typeof _myFeatureModal !== 'undefined' && _myFeatureModal.init) _myFeatureModal.init();
        },

        bindEvents: () => {
            const scope = _myFeatureGrid;
            $('#btn').on('click', () => scope.openModal());
        },

        loadData: () => { /* ... */ },
        openModal: () => {
            if (typeof _myFeatureModal !== 'undefined' && _myFeatureModal.show) _myFeatureModal.show();
        },

        waitForReady: async () => { /* ... */ }
    };
}();
```

---

## 5. Load Order in Route Config

Scripts must load in **dependency order**. The **entry module** should be listed **first**; feature modules that the entry calls can follow in any order (as long as they’re all loaded before the entry’s `init` runs).

In `appRouteConfig.json` (paths relative to the module’s `basePath`):

```json
"my-feature": {
    "path": "my-feature",
    "html": "html/my_feature_grid.html",
    "js": [
        "js/my_feature_grid.js",
        "js/my_feature_modal_a.js",
        "js/my_feature_modal_b.js",
        "js/my_feature_actions.js"
    ]
}
```

The router typically loads these in order; the entry script’s `init()` runs after all scripts are loaded (e.g. when the route is shown), so all globals are defined when you call other modules’ `init()` or methods.

---

## 6. Initialization Flow

1. **Entry module** is the only one that should run “page-level” init (e.g. wait for DOM, bind main buttons, load table data).
2. Entry’s `init` should be **async** if it needs to wait for elements or data:
   - Use a small **`delay(ms)`** helper (e.g. promise that resolves after `ms` via `requestAnimationFrame` or similar) so you don’t rely on `setTimeout` at call sites.
   - Use **`waitForElement(selector, maxMs)`** that polls with `await delay(50)` until the element exists or timeout.
3. After the entry’s own setup, call each feature module’s `init()` if it exists:

   ```javascript
   if (typeof _myFeatureModal !== 'undefined' && _myFeatureModal.init) _myFeatureModal.init();
   ```

4. Feature modules’ `init()` should only set up their own UI (e.g. modal bindings); they don’t need to wait for the whole page again unless they have their own dependencies.

---

## 7. Cross-Module Communication

- **Entry → feature**: The entry binds events (e.g. button click, row click) and calls the feature’s public method:

  ```javascript
  $(document).on('click', '.js-open-modal', function () {
      const id = $(this).data('id');
      if (typeof _myFeatureModal !== 'undefined' && _myFeatureModal.show) _myFeatureModal.show(id);
  });
  ```

- **Feature → entry**: When a feature needs data or a refresh (e.g. after save), call back into the entry module:

  ```javascript
  if (typeof _myFeatureGrid !== 'undefined' && _myFeatureGrid.loadData) _myFeatureGrid.loadData();
  ```

- Always guard with `typeof _moduleName !== 'undefined'` and check for the method so nothing breaks if a script fails to load or load order changes.

---

## 8. Avoiding `setTimeout` in Split Modules

- Prefer **async/await** and small helpers instead of `setTimeout` at call sites:
  - **`delay(ms)`** – returns a Promise that resolves after `ms` (implement with `requestAnimationFrame` or similar if you want to avoid `setTimeout` entirely).
  - **`waitForElement(selector, maxMs)`** – async loop that `await delay(50)` until the element exists or `maxMs` is reached.
- **Debounce**: use a token-based async debounce (increment a token on each input, `await delay(300)`, then run the handler only if the token still matches) instead of `clearTimeout`/`setTimeout`.
- **DOM ready**: if the script runs before DOM ready, await it with `new Promise((resolve) => $(document).one('DOMContentLoaded', resolve))` (or similar), then run `init()`.

---

## 9. What Goes Where

| Responsibility              | Entry module              | Feature module              |
|----------------------------|---------------------------|-----------------------------|
| Load main table/list       | Yes                       | No                          |
| Main filters, search       | Yes                       | No                          |
| Top-level buttons          | Bind here, call feature   | Implement modal/action      |
| Modals / wizards           | No                        | Yes (one module per flow)   |
| Shared data (e.g. list)    | Optionally expose getters | Call entry to refresh       |
| Route init                 | Single `init()`           | Own `init()` for own UI     |

---

## 10. Checklist for a New Split

- [ ] Choose entry file and name (e.g. `*_grid.js` or `*_main.js`).
- [ ] List feature areas and create one JS file per area.
- [ ] Refactor each file to the standard module shape (IIFE, return object, arrow methods, `const scope = _moduleName` where needed).
- [ ] Add all scripts to `appRouteConfig.json` in order (entry first, then features).
- [ ] Entry `init()`: wait for DOM/elements (async), bind events, load data, then call each feature’s `init()`.
- [ ] Replace any `setTimeout` usage with `delay()` / `waitForElement()` and async/await.
- [ ] Use defensive checks when calling other modules (`typeof _module !== 'undefined' && _module.method`).
- [ ] Test: load route, click through each action, ensure modals and table updates still work.

Using this approach keeps large features maintainable and consistent with the rest of the codebase while avoiding brittle timing and scattered `setTimeout` calls.
