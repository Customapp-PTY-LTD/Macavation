# Dropdowns in Tables: Reference Implementation (No Assumptions)

This document describes **only** what exists in the reference implementation (the flock module). Every ID, class name, global, script path, and code block is taken from that implementation. Nothing is assumed or generalized.

---

## Table of contents

1. [The problem the reference solves](#1-the-problem-the-reference-solves)
2. [Dependencies: exact list and load order](#2-dependencies-exact-list-and-load-order)
3. [Route and file paths](#3-route-and-file-paths)
4. [Reference symbols (IDs, classes, globals)](#4-reference-symbols-ids-classes-globals)
5. [Approach A: Body-mounted dropdown (exact code from reference)](#5-approach-a-body-mounted-dropdown-exact-code-from-reference)
6. [Approach B: In-cell dropdown (exact code from reference)](#6-approach-b-in-cell-dropdown-exact-code-from-reference)
7. [CSS: exact rules from reference](#7-css-exact-rules-from-reference)
8. [Row data and column indices in the reference](#8-row-data-and-column-indices-in-the-reference)
9. [Gotchas observed in the reference](#9-gotchas-observed-in-the-reference)
10. [What to change when adapting to another project](#10-what-to-change-when-adapting-to-another-project)

---

## 1. The problem the reference solves

In the reference, the table is rendered by GridJS inside a scrollable layout. Without the fixes below:

- The dropdown menu is clipped by the GridJS wrapper or card body (`overflow`).
- The menu can appear behind other UI (z-index).
- Absolute positioning can be wrong due to stacking context.

The reference uses two mechanisms:

- **Approach A (body-mounted):** A single dropdown element is created in JavaScript, appended to `document.body`, positioned with `position: fixed` and `getBoundingClientRect()`. It is never inside the table DOM.
- **Approach B (in-cell):** The dropdown markup (button + `<ul class="dropdown-menu">`) lives inside each table cell. Bootstrap and Popper handle open/close. CSS forces `overflow: visible` and a high z-index on the table and dropdown so the menu is not clipped.

The reference grid is built with **Approach B**. The same HTML file also contains the script for Approach A; the grid does not set `data-id` on `<tr>`, so the body-mounted script would read `row.dataset.id` as undefined and fall back to `'test-guid'` unless the row ID is provided another way (e.g. on the button as `data-row-id`).

---

## 2. Dependencies: exact list and load order

These are the scripts and styles that exist in the reference app’s main page (`index.html`) and that the flock module relies on. Order is as in the file.

### 2.1 Scripts (main page, head and body)

**Head (before body):**

- `vendors/imagesloaded/imagesloaded.pkgd.min.js`
- `vendors/simplebar/simplebar.min.js`
- `assets/js/config.js`
- `https://ilink-platform.customapp.org/resources/js/oasis.js`
- `https://cdn.jsdelivr.net/npm/sweetalert2@11`
- `https://cdn.jsdelivr.net/npm/handlebars@latest/dist/handlebars.js`
- `https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js`
- `js/handlebars-ext.js`
- `vendors/tinymce/tinymce.min.js`

**After theme CSS, before closing `</head>`:**

- `https://unpkg.com/gridjs/dist/gridjs.umd.js`

**Body (before closing `</body>`):**

- `vendors/dropzone/dropzone.min.js`
- `vendors/popper/popper.min.js`
- `vendors/bootstrap/bootstrap.min.js`
- `vendors/anchorjs/anchor.min.js`
- `vendors/is/is.min.js`
- `vendors/fontawesome/all.min.js`
- `vendors/lodash/lodash.min.js`
- `vendors/list.js/list.min.js`
- `vendors/feather-icons/feather.min.js`
- `vendors/dayjs/dayjs.min.js`
- `assets/js/phoenix.js`
- `vendors/echarts/echarts.min.js`
- `vendors/leaflet/leaflet.js`
- `vendors/leaflet.markercluster/leaflet.markercluster.js`
- (emoji-button and other scripts)
- `https://cdn.jsdelivr.net/npm/choices.js/public/assets/scripts/choices.min.js`
- `https://cdn.jsdelivr.net/npm/flatpickr`
- `https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js` (with integrity and fallback)
- `css/index.css`, `css/overrides.css`, `css/loaders.css`
- `js/appRouter.js`
- `js/common.js`
- `js/stepper-module.js`
- `js/json-table-module.js`
- `js/app.js`
- `js/index.js`
- `js/datafunctions.js`
- `modules/_shared/expand-module.js`

So: **Popper** loads before **Bootstrap**. **GridJS** loads in the head. **jQuery** loads before the app router and module scripts.

### 2.2 Stylesheets (main page)

- `css/index.css`
- `css/stepper-module.css`
- `css/json-table-module.css`
- `css/loaders.css`
- (Google Fonts)
- `vendors/simplebar/simplebar.min.css`
- `assets/css/theme-rtl.min.css` / `assets/css/theme.min.css`
- `assets/css/user-rtl.min.css` / `assets/css/user.min.css`
- `https://cdn.jsdelivr.net/npm/choices.js/public/assets/styles/choices.min.css`
- `https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css`
- `https://unpkg.com/gridjs/dist/theme/mermaid.min.css`
- `assets/css/custom.css`
- (leaflet, dropzone, upload.css, etc.)

Theme and GridJS theme provide Bootstrap-style dropdown and table styles.

### 2.3 Flock route: what is loaded when the route is opened

From `appRouteConfig.json` and the router:

- **basePath:** `modules`
- **Route key:** `flock`
- **path:** `flock` → resource path = `modules/flock`
- **html:** `html/flock.html` → `modules/flock/html/flock.html`
- **js:** `["js/flock.js"]` → `modules/flock/js/flock.js`
- **css:** `["css/flock.css"]` → `modules/flock/css/flock.css`

Load order in `loadContent`:

1. CSS: `modules/flock/css/flock.css`
2. HTML: fetch `modules/flock/html/flock.html`, then `$(elementSelector).html(content)` (content container from config: `#content-container`)
3. JS: `modules/flock/js/flock.js` via `$.getScript(resoucePath + '/' + scriptUrl)`

So when the user navigates to the flock route: flock CSS is loaded, then flock HTML (including the inline script) is injected into `#content-container`, then flock.js is loaded and runs. The inline script in the HTML runs when the HTML is inserted (inline scripts execute on parse). The flock.js script creates the GridJS table and assigns `window._flock`.

---

## 3. Route and file paths

- **Route name:** `flock`
- **HTML file:** `modules/flock/html/flock.html`
- **JS file:** `modules/flock/js/flock.js`
- **CSS file:** `modules/flock/css/flock.css`
- **Content container:** `#content-container` (from `appRouteConfig.json`)

---

## 4. Reference symbols (IDs, classes, globals)

These are the exact strings used in the reference. No placeholders.

| Kind | Value |
|------|--------|
| Table container ID | `flockTable` |
| Dropdown element class | `custom-dropdown-menu` |
| Global module object | `window._flock` |
| Global function (Approach A) | `window.showFlockDropdown(buttonElement, flockGUID)` |
| Method: show summary | `window._flock.showSummary(UniqueGUID)` |
| Method: edit | `window._flock.editFlock(UniqueGUID)` |
| Method: delete | `window._flock.deleteFlock(UniqueGUID)` |
| Button classes (Approach B) | `btn btn-sm btn-phoenix-secondary dropdown-toggle` |
| Selector used to detect trigger (Approach A) | `button.dropdown-toggle`, `button[data-bs-toggle="dropdown"]`, `.btn-action-large` |
| Scoping selector for “click in table” (Approach A) | `#flockTable` |
| CSS table selector | `#flockTable` (all dropdown/overflow rules use this) |

---

## 5. Approach A: Body-mounted dropdown (exact code from reference)

The reference implements this in an inline `<script>` at the top of `modules/flock/html/flock.html`. Two variants exist in the same file: (1) a `DOMContentLoaded` handler that creates one dropdown and uses event delegation; (2) a global `showFlockDropdown(buttonElement, flockGUID)` that creates/positions the same dropdown and assigns handlers. A separate `document.addEventListener('click', ...)` hides the dropdown when the click is outside the dropdown and not on a dropdown toggle.

### 5.1 DOMContentLoaded block (creates dropdown and delegates button clicks)

- **Table container ID:** `#flockTable`
- **Dropdown class:** `custom-dropdown-menu`
- **Row ID source:** `const row = button.closest('tr'); const flockGUID = row ? row.dataset.id || 'test-guid' : 'test-guid';`  
  So the reference reads from the `<tr>`’s `data-id`. GridJS does not set `data-id` on rows; the in-cell dropdown (Approach B) does not rely on this.
- **Numeric constants:** `min-width: 140px`, bottom edge check `top + 80`, right edge `left + 140`, margins `Math.max(10, left)` and `Math.max(10, top)`.
- **Dropdown content (first variant):** Two links: one with class `dropdown-item` (Summary), one with class `dropdown-item-delete` (Delete). Handlers call `window._flock.showSummary(flockGUID)` and `window._flock.deleteFlock(flockGUID)` after `confirm('Are you sure you want to delete this flock?')`.

Full inline script (first part) as in the reference:

```javascript
document.addEventListener('DOMContentLoaded', function() {
    let globalDropdown = null;

    function createGlobalDropdown() {
        if (globalDropdown) return globalDropdown;

        globalDropdown = document.createElement('div');
        globalDropdown.className = 'custom-dropdown-menu';
        globalDropdown.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            background: white;
            border: 1px solid rgba(0,0,0,0.15);
            border-radius: 6px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            min-width: 140px;
            padding: 8px 0;
            display: none;
            font-size: 14px;
            pointer-events: auto;
        `;

        globalDropdown.innerHTML = `
            <a href="#" class="dropdown-item" style="display:block;padding:8px 16px;text-decoration:none;color:#212529;">
                <i class="fas fa-chart-bar me-2"></i>Summary
            </a>
            <hr style="margin:4px 0;border-top:1px solid #eee;">
            <a href="#" class="dropdown-item-delete" style="display:block;padding:8px 16px;text-decoration:none;color:#dc3545;">
                <i class="fas fa-trash me-2"></i>Delete
            </a>
        `;

        document.body.appendChild(globalDropdown);

        globalDropdown.querySelectorAll('a').forEach(item => {
            item.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f8f9fa';
            });
            item.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent';
            });
        });

        return globalDropdown;
    }

    document.addEventListener('click', function(e) {
        const button = e.target.closest('button.dropdown-toggle') ||
                      e.target.closest('button[data-bs-toggle="dropdown"]') ||
                      e.target.closest('.btn-action-large');

        if (button && button.closest('#flockTable')) {
            e.preventDefault();
            e.stopPropagation();

            const dropdown = createGlobalDropdown();
            const rect = button.getBoundingClientRect();
            let top = rect.bottom + 5;
            let left = rect.left;

            if (left + 140 > window.innerWidth) {
                left = rect.right - 140;
            }
            if (top + 80 > window.innerHeight) {
                top = rect.top - 80;
            }
            left = Math.max(10, left);
            top = Math.max(10, top);

            dropdown.style.top = top + 'px';
            dropdown.style.left = left + 'px';
            dropdown.style.display = 'block';

            const row = button.closest('tr');
            const flockGUID = row ? row.dataset.id || 'test-guid' : 'test-guid';

            const summaryLink = dropdown.querySelector('.dropdown-item');
            const deleteLink = dropdown.querySelector('.dropdown-item-delete');

            summaryLink.onclick = function(e) {
                e.preventDefault();
                dropdown.style.display = 'none';
                if (window._flock && window._flock.showSummary) {
                    window._flock.showSummary(flockGUID);
                }
            };

            deleteLink.onclick = function(e) {
                e.preventDefault();
                dropdown.style.display = 'none';
                if (confirm('Are you sure you want to delete this flock?')) {
                    if (window._flock && window._flock.deleteFlock) {
                        window._flock.deleteFlock(flockGUID);
                    }
                }
            };
        } else {
            const dropdown = document.querySelector('.custom-dropdown-menu');
            if (dropdown) {
                dropdown.style.display = 'none';
            }
        }
    });

    window.addEventListener('scroll', function() {
        const dropdown = document.querySelector('.custom-dropdown-menu');
        if (dropdown) dropdown.style.display = 'none';
    });

    window.addEventListener('resize', function() {
        const dropdown = document.querySelector('.custom-dropdown-menu');
        if (dropdown) dropdown.style.display = 'none';
    });
});
```

### 5.2 Global `showFlockDropdown(buttonElement, flockGUID)`

- Same dropdown class and inline styles as above.
- **Dropdown content:** Three links: `dropdown-item-summary`, `dropdown-item-edit`, `dropdown-item-delete`. Handlers call `window._flock.showSummary(flockGUID)`, `window._flock.editFlock(flockGUID)`, `window._flock.deleteFlock(flockGUID)`. Delete uses `confirm('Are you sure you want to delete this flock?')`.
- **Positioning:** Same logic: `rect.bottom + 5`, `rect.left`, clamp right by `left + 140`, clamp bottom by `top + 80`, then `Math.max(10, left)` and `Math.max(10, top)`.

```javascript
window.showFlockDropdown = function(buttonElement, flockGUID) {
    const existingDropdown = document.querySelector('.custom-dropdown-menu');
    if (existingDropdown) {
        existingDropdown.style.display = 'none';
    }

    let globalDropdown = document.querySelector('.custom-dropdown-menu');
    if (!globalDropdown) {
        globalDropdown = document.createElement('div');
        globalDropdown.className = 'custom-dropdown-menu';
        globalDropdown.style.cssText = `
            position: fixed;
            z-index: 2147483647;
            background: white;
            border: 1px solid rgba(0,0,0,0.15);
            border-radius: 6px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            min-width: 140px;
            padding: 8px 0;
            display: none;
            font-size: 14px;
            pointer-events: auto;
        `;

        globalDropdown.innerHTML = `
            <a href="#" class="dropdown-item-summary" style="display:block;padding:8px 16px;text-decoration:none;color:#212529;">
                <i class="fas fa-chart-bar me-2"></i>Summary
            </a>
            <hr style="margin:4px 0;border-top:1px solid #eee;">
            <a href="#" class="dropdown-item-edit" style="display:block;padding:8px 16px;text-decoration:none;color:#212529;">
                <i class="fas fa-edit me-2"></i>Edit
            </a>
            <a href="#" class="dropdown-item-delete" style="display:block;padding:8px 16px;text-decoration:none;color:#dc3545;">
                <i class="fas fa-trash-alt me-2"></i>Delete
            </a>
        `;

        document.body.appendChild(globalDropdown);

        globalDropdown.querySelectorAll('a').forEach(item => {
            item.addEventListener('mouseenter', function() {
                this.style.backgroundColor = '#f8f9fa';
            });
            item.addEventListener('mouseleave', function() {
                this.style.backgroundColor = 'transparent';
            });
        });
    }

    const rect = buttonElement.getBoundingClientRect();
    let top = rect.bottom + 5;
    let left = rect.left;

    if (left + 140 > window.innerWidth) {
        left = rect.right - 140;
    }
    if (top + 80 > window.innerHeight) {
        top = rect.top - 80;
    }

    globalDropdown.style.top = top + 'px';
    globalDropdown.style.left = left + 'px';
    globalDropdown.style.display = 'block';

    const summaryLink = globalDropdown.querySelector('.dropdown-item-summary');
    const editLink = globalDropdown.querySelector('.dropdown-item-edit');
    const deleteLink = globalDropdown.querySelector('.dropdown-item-delete');

    summaryLink.onclick = function(e) {
        e.preventDefault();
        globalDropdown.style.display = 'none';
        if (window._flock && window._flock.showSummary) {
            window._flock.showSummary(flockGUID);
        }
    };

    editLink.onclick = function(e) {
        e.preventDefault();
        globalDropdown.style.display = 'none';
        if (window._flock && window._flock.editFlock) {
            window._flock.editFlock(flockGUID);
        }
    };

    deleteLink.onclick = function(e) {
        e.preventDefault();
        globalDropdown.style.display = 'none';
        if (confirm('Are you sure you want to delete this flock?')) {
            if (window._flock && window._flock.deleteFlock) {
                window._flock.deleteFlock(flockGUID);
            }
        }
    };
};
```

### 5.3 Click-outside to hide (second document listener)

```javascript
document.addEventListener('click', function(e) {
    const dropdown = document.querySelector('.custom-dropdown-menu');
    if (dropdown && dropdown.style.display === 'block') {
        if (!e.target.closest('.custom-dropdown-menu') && !e.target.closest('.dropdown-toggle')) {
            dropdown.style.display = 'none';
        }
    }
});
```

### 5.4 HTML container for the table (reference)

```html
<div id="flockTable" style="overflow: visible;">
    <!-- GridJS table will be rendered here -->
</div>
```

The grid is rendered with `scope.grid.render(document.getElementById('flockTable'));`.

---

## 6. Approach B: In-cell dropdown (exact code from reference)

The reference grid uses this. It is in `modules/flock/js/flock.js` in the `renderTable` function: one column has `name: 'Actions'` and a formatter that returns `gridjs.html(...)`.

### 6.1 Column definition

- **Row ID:** `const UniqueGUID = row.cells[0].data;`
- **Button id:** `id="${dropdownId}"` where `dropdownId = \`dropdown-${UniqueGUID}\``
- **Button:** `class="btn btn-sm btn-phoenix-secondary dropdown-toggle"`, `type="button"`, `data-bs-toggle="dropdown"`, `data-bs-auto-close="true"`, `data-bs-boundary="viewport"`, `aria-expanded="false"`
- **Menu:** `<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="${dropdownId}" style="position: absolute !important; z-index: 9999 !important;">`
- **Items:** Three `<li>` with `<a class="dropdown-item" href="javascript:void(0);" onclick="window._flock.showSummary('${UniqueGUID}')">` (Summary), same for `editFlock` (Edit), then `<li><hr class="dropdown-divider"></li>`, then Delete with `onclick="window._flock.deleteFlock('${UniqueGUID}')"` and `class="dropdown-item text-danger"`.
- **Wrapper:** `<div class="dropdown position-static">`

Exact formatter from the reference:

```javascript
{
    name: 'Actions',
    formatter: (_, row) => {
        const UniqueGUID = row.cells[0].data;
        const dropdownId = `dropdown-${UniqueGUID}`;

        return gridjs.html(`
            <div class="dropdown position-static">
                <button class="btn btn-sm btn-phoenix-secondary dropdown-toggle" type="button" id="${dropdownId}" data-bs-toggle="dropdown" data-bs-auto-close="true" data-bs-boundary="viewport" aria-expanded="false">
                    <span class="fas fa-ellipsis-v"></span>
                </button>
                <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="${dropdownId}" style="position: absolute !important; z-index: 9999 !important;">
                    <li>
                        <a class="dropdown-item" href="javascript:void(0);" onclick="window._flock.showSummary('${UniqueGUID}')">
                            <span class="fas fa-chart-bar me-2"></span>Summary
                        </a>
                    </li>
                    <li>
                        <a class="dropdown-item" href="javascript:void(0);" onclick="window._flock.editFlock('${UniqueGUID}')">
                            <span class="fas fa-edit me-2"></span>Edit
                        </a>
                    </li>
                    <li><hr class="dropdown-divider"></li>
                    <li>
                        <a class="dropdown-item text-danger" href="javascript:void(0);" onclick="window._flock.deleteFlock('${UniqueGUID}')">
                            <span class="fas fa-trash me-2"></span>Delete
                        </a>
                    </li>
                </ul>
            </div>
        `);
    }
}
```

---

## 7. CSS: exact rules from reference

All of these are in `modules/flock/css/flock.css`. The table container selector is `#flockTable`.

```css
/* Fix dropdown overflow in grid */
#flockTable .gridjs-wrapper {
    overflow: visible !important;
}

#flockTable .gridjs-container {
    overflow: visible !important;
}

#flockTable .gridjs-table {
    overflow: visible !important;
}

#flockTable tbody {
    overflow: visible !important;
}

#flockTable tr {
    overflow: visible !important;
}

#flockTable td {
    overflow: visible !important;
}

/* Fix for gridjs footer and pagination */
#flockTable .gridjs-footer {
    overflow: visible !important;
    z-index: 0;
}

#flockTable .gridjs-pagination {
    overflow: visible !important;
}

/* Ensure dropdown appears above other elements */
#flockTable .dropdown-menu {
    z-index: 1060 !important;
    position: absolute !important;
}

#flockTable .dropdown {
    position: relative !important;
}

/* Fix for gridjs scrollbar container */
.gridjs-wrapper {
    overflow-x: auto;
    overflow-y: visible !important;
}

/* Ensure card body doesn't clip dropdowns */
#flockTable.card-body,
.card-body {
    overflow: visible !important;
}
```

---

## 8. Row data and column indices in the reference

In `flock.js`, the grid is created with this column order and data mapping.

### 8.1 Columns array (order)

1. `id: 'UniqueGUID', name: 'ID', hidden: true`
2. `id: 'FarmName', name: 'Farm', sort: true, formatter: ...`
3. `id: 'HouseNumber', name: 'House', sort: true`
4. `id: 'StartDate', name: 'Start Date', sort: true, formatter: formatDateToDDMMYYYY`
5. `id: 'CullDate', name: 'Cull Date', sort: true, formatter: formatDateToDDMMYYYY`
6. `id: 'StandardName', name: 'Breed', sort: true, formatter: ...`
7. `id: 'InitialFemaleCount', name: 'Female Count', sort: true, formatter: ...`
8. `id: 'InitialMaleCount', name: 'Male Count', sort: true, formatter: ...`
9. `name: 'Status', formatter: (_, row) => { ... }` (uses `row.cells[0].data` to find flock and compute status)
10. `name: 'Actions', formatter: (_, row) => { ... }` (uses `row.cells[0].data` as `UniqueGUID`)

So `row.cells[0].data` is the value of the first column (UniqueGUID).

### 8.2 Data array (one row)

```javascript
data: data.map(item => [
    item.UniqueGUID,
    item.FarmName || '',
    item.HouseNumber || '',
    item.StartDate || '',
    item.CullDate || '',
    item.StandardName || '',
    item.InitialFemaleCount || 0,
    item.InitialMaleCount || 0
]),
```

There are 8 elements per row. The first is UniqueGUID. Status and Actions have no corresponding data slot; they use formatters only.

### 8.3 GridJS render call

```javascript
scope.grid.render(document.getElementById('flockTable'));
```

Before re-render, the reference does:

```javascript
if (scope.grid) {
    scope.grid.destroy();
}
```

---

## 9. Gotchas observed in the reference

1. **DOMContentLoaded and dynamic load:** The flock HTML is injected by the router after the initial page load. If the only init for the body-mounted dropdown is inside `DOMContentLoaded`, that event may have already fired. The reference still registers the listener; on first load it runs, on route load it may not. The grid itself is created in flock.js after the HTML is in the DOM, so the in-cell dropdown (Approach B) does not depend on DOMContentLoaded.

2. **Row ID in Approach A:** The body-mounted script gets the row ID from `row.dataset.id`. GridJS does not set `data-id` on `<tr>`. So for Approach A to work with the grid, the row would need `data-id` set by some other means, or the button could have `data-row-id` and the script could be changed to use `button.getAttribute('data-row-id')`.

3. **Two document click listeners:** The reference has two: one in the DOMContentLoaded block (open dropdown when button inside `#flockTable` is clicked, else hide) and one at the end of the script (hide when click is outside `.custom-dropdown-menu` and outside `.dropdown-toggle`). Both hide the same dropdown; they do not conflict but both run on every click.

4. **Re-render:** The reference destroys the previous grid with `scope.grid.destroy()` before creating a new one and calling `scope.grid.render(document.getElementById('flockTable'))`.

5. **Bootstrap/Popper:** Approach B uses Bootstrap dropdown; Popper is loaded before Bootstrap in index.html. If the in-cell dropdown does not open, the reference assumes Bootstrap and Popper are present and correct.

---

## 10. What to change when adapting to another project

The reference uses these exact symbols. In another project you would change:

- **Table container ID:** `flockTable` (in HTML, in JS `getElementById`, in CSS `#flockTable`, in the body-mounted script `button.closest('#flockTable')`).
- **Global object:** `window._flock` and its methods `showSummary`, `editFlock`, `deleteFlock`.
- **Global function (if using Approach A):** `window.showFlockDropdown`.
- **CSS selector:** Every rule that uses `#flockTable` (and the `.card-body` rule if you scope it).
- **Route/path:** Route name `flock`, path `flock`, files under `modules/flock/` (or your equivalent).
- **Data property names:** `UniqueGUID`, `FarmName`, `HouseNumber`, etc., and the same order in the `data` array and in `row.cells[index]`.

No other assumptions are made in this document; everything else is as in the reference implementation.
