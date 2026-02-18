# How to Implement Dropdowns in Tables (Standalone Guide)

This document explains how to implement **action dropdowns inside table cells** so they open correctly, are not clipped by the table, and stay above other content. It is written to be **fully independent**: you can follow it in any project without reference to other modules.

---

## The problem

Tables (especially inside scrollable containers or libraries like GridJS) often use `overflow: auto` or `overflow: hidden`. That causes:

1. **Clipping** – The dropdown menu is cut off by the table or its wrapper.
2. **Low z-index** – The menu appears behind other elements (modals, headers, other tables).
3. **Wrong stacking context** – `position: absolute` dropdowns are positioned relative to a scrolling container instead of the viewport.

To fix this you can use either:

- **Approach A:** A **single dropdown element** mounted on `document.body`, positioned with `position: fixed` and `getBoundingClientRect()`, so it is never clipped.
- **Approach B:** **In-cell dropdown markup** (e.g. Bootstrap-style) with CSS that forces `overflow: visible` and a high `z-index` on the table and dropdown so the menu is not clipped and appears on top.

---

## Approach A: Body-mounted dropdown (recommended when clipping is severe)

One shared dropdown is created in JavaScript, appended to `document.body`, and shown/hidden and repositioned when the user clicks an action button in a row. The dropdown is never inside the table DOM, so overflow and stacking context issues are avoided.

### 1. HTML: table container and action button

- Give the table (or its wrapper) an ID so you can scope clicks, e.g. `id="myTable"`.
- In the Actions column, render a **single button** per row (e.g. an “Actions” or “⋮” button). Do **not** render the menu HTML inside the cell.
- Put the **row identifier** on the button so the dropdown knows which row was clicked, e.g. `data-row-id="YOUR_ROW_ID"`.

Example for a generic HTML table:

```html
<table id="myTable">
  <thead><tr><th>Name</th><th>Actions</th></tr></thead>
  <tbody>
    <tr>
      <td>Item 1</td>
      <td>
        <button type="button" class="btn btn-sm dropdown-toggle" data-row-id="row-001">
          <span class="fas fa-ellipsis-v"></span>
        </button>
      </td>
    </tr>
  </tbody>
</table>
```

Example for **GridJS** – in the column formatter, use `row.cells[0].data` (or the index of your ID column) and pass it into the button:

```javascript
{
  name: 'Actions',
  formatter: (_, row) => {
    const rowId = row.cells[0].data;  // Use the column index that holds the unique ID
    return gridjs.html(`
      <button type="button" class="btn btn-sm dropdown-toggle" data-row-id="${rowId}">
        <span class="fas fa-ellipsis-v"></span>
      </button>
    `);
  }
}
```

### 2. CSS: optional table overflow (only if you still want visible overflow)

If you use other in-table UI that must not be clipped, you can force the table area to allow overflow (optional for Approach A, since the dropdown is outside the table):

```css
#myTable .gridjs-wrapper,
#myTable .gridjs-container,
#myTable .gridjs-table,
#myTable tbody,
#myTable tr,
#myTable td {
  overflow: visible !important;
}
```

### 3. JavaScript: create and position the shared dropdown

- Create **one** dropdown element (e.g. a `<div>` with a class like `custom-dropdown-menu`).
- Style it so it behaves like a floating panel:
  - `position: fixed`
  - `z-index` very high (e.g. `2147483647`) so it appears above modals and other UI
  - `display: none` by default; switch to `display: block` when showing
- Append it to `document.body` (not inside the table).
- When the user clicks a button that is inside the table and has `data-row-id`:
  - Read `data-row-id` from the clicked button.
  - Get the button’s position with `button.getBoundingClientRect()`.
  - Set the dropdown’s `style.left` and `style.top` (e.g. below the button: `top = rect.bottom + 5`, `left = rect.left`).
  - Optionally nudge if it would go off-screen (e.g. flip above the button or shift left).
  - Set dropdown `display = 'block'`.
  - Attach click handlers to the dropdown’s action links, using the stored `data-row-id` (e.g. call `onSummary(rowId)` or `onDelete(rowId)`). In each handler, set `dropdown.style.display = 'none'` after the action.
- When the user clicks **outside** the dropdown (and not on an action button), hide the dropdown (`display = 'none'`).
- On `window` `scroll` and `resize`, hide the dropdown so it doesn’t stay in the wrong place.

Minimal full example (vanilla JS, no GridJS):

```html
<div id="myTableContainer">
  <table id="myTable">...</table>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
  let dropdownEl = null;

  function getDropdown() {
    if (dropdownEl) return dropdownEl;
    dropdownEl = document.createElement('div');
    dropdownEl.className = 'custom-dropdown-menu';
    dropdownEl.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'background: white',
      'border: 1px solid rgba(0,0,0,0.15)',
      'border-radius: 6px',
      'box-shadow: 0 10px 30px rgba(0,0,0,0.2)',
      'min-width: 140px',
      'padding: 8px 0',
      'display: none',
      'font-size: 14px',
      'pointer-events: auto'
    ].join('; ');
    dropdownEl.innerHTML = [
      '<a href="#" class="dropdown-item-action" data-action="summary">Summary</a>',
      '<a href="#" class="dropdown-item-action" data-action="delete">Delete</a>'
    ].join('');
    document.body.appendChild(dropdownEl);
    return dropdownEl;
  }

  document.addEventListener('click', function(e) {
    const button = e.target.closest('button.dropdown-toggle');
    if (button && button.closest('#myTable')) {
      e.preventDefault();
      e.stopPropagation();
      const rowId = button.getAttribute('data-row-id');
      const dropdown = getDropdown();
      const rect = button.getBoundingClientRect();
      let top = rect.bottom + 5;
      let left = rect.left;
      if (left + 140 > window.innerWidth) left = rect.right - 140;
      if (top + 120 > window.innerHeight) top = rect.top - 120;
      left = Math.max(10, left);
      top = Math.max(10, top);
      dropdown.style.left = left + 'px';
      dropdown.style.top = top + 'px';
      dropdown.style.display = 'block';

      dropdown.querySelectorAll('.dropdown-item-action').forEach(link => {
        link.onclick = function(ev) {
          ev.preventDefault();
          dropdown.style.display = 'none';
          const action = this.getAttribute('data-action');
          if (action === 'summary') yourSummaryHandler(rowId);
          if (action === 'delete') yourDeleteHandler(rowId);
        };
      });
    } else {
      const open = document.querySelector('.custom-dropdown-menu');
      if (open) open.style.display = 'none';
    }
  });

  window.addEventListener('scroll', function() {
    const open = document.querySelector('.custom-dropdown-menu');
    if (open) open.style.display = 'none';
  });
  window.addEventListener('resize', function() {
    const open = document.querySelector('.custom-dropdown-menu');
    if (open) open.style.display = 'none';
  });
});
</script>
```

Replace `yourSummaryHandler(rowId)` and `yourDeleteHandler(rowId)` with your own logic (e.g. open a modal, call an API, refresh the table).

---

## Approach B: In-cell dropdown (Bootstrap-style)

The dropdown markup (button + menu) lives **inside** the table cell. To avoid clipping and z-index issues you must:

1. Force **overflow: visible** on the table, its wrapper, and every ancestor that could clip (including GridJS wrappers and card bodies).
2. Give the dropdown menu a **high z-index** and ensure the dropdown container has **position: relative** (or similar) so the menu positions correctly.

### 1. HTML / column structure

- Each row’s Actions cell contains:
  - A wrapper: `<div class="dropdown position-static">` (Bootstrap) or equivalent. `position-static` can help with stacking; you can use `position: relative` in CSS if needed.
  - A trigger: `<button class="btn btn-sm dropdown-toggle" ... data-bs-toggle="dropdown" ...>`.
  - The menu: `<ul class="dropdown-menu dropdown-menu-end">` with `<li><a class="dropdown-item" ...>...</a></li>`.

- **Row context:** Because the menu is inside the row, you can pass the row ID into each action via `onclick`, e.g. `onclick="window.MyApp.onSummary('${rowId}')"`. For GridJS, get the row ID in the formatter from `row.cells[index].data` and inject it into the string.

GridJS example:

```javascript
{
  name: 'Actions',
  formatter: (_, row) => {
    const rowId = row.cells[0].data;
    return gridjs.html(`
      <div class="dropdown position-static">
        <button class="btn btn-sm btn-secondary dropdown-toggle" type="button"
                data-bs-toggle="dropdown" data-bs-auto-close="true" aria-expanded="false">
          <span class="fas fa-ellipsis-v"></span>
        </button>
        <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="dropdown-${rowId}">
          <li><a class="dropdown-item" href="javascript:void(0);" onclick="window.MyApp.onSummary('${rowId}')">Summary</a></li>
          <li><a class="dropdown-item" href="javascript:void(0);" onclick="window.MyApp.onEdit('${rowId}')">Edit</a></li>
          <li><hr class="dropdown-divider"></li>
          <li><a class="dropdown-item text-danger" href="javascript:void(0);" onclick="window.MyApp.onDelete('${rowId}')">Delete</a></li>
        </ul>
      </div>
    `);
  }
}
```

Expose your handlers on a global (e.g. `window.MyApp`) or ensure the `onclick` strings reference a global that exists at click time.

### 2. CSS: overflow and z-index

Apply these rules so the in-cell dropdown is not clipped and appears on top. Adjust the selector to match your table container (e.g. `#myTable` or the GridJS container ID).

```css
/* Allow table and all grid parts to show overflow (no clipping) */
#myTable .gridjs-wrapper {
  overflow: visible !important;
}
#myTable .gridjs-container {
  overflow: visible !important;
}
#myTable .gridjs-table {
  overflow: visible !important;
}
#myTable tbody,
#myTable tr,
#myTable td {
  overflow: visible !important;
}

/* Optional: horizontal scroll only, vertical visible */
.gridjs-wrapper {
  overflow-x: auto;
  overflow-y: visible !important;
}

/* Dropdown menu above other content */
#myTable .dropdown-menu {
  z-index: 1060 !important;
  position: absolute !important;
}
#myTable .dropdown {
  position: relative !important;
}

/* Prevent card/body from clipping */
#myTable.card-body,
.card-body:has(#myTable) {
  overflow: visible !important;
}
```

If you are **not** using GridJS, target your table wrapper and the same elements (e.g. `#myTable`, `#myTable tbody`, `#myTable tr`, `#myTable td`) with `overflow: visible !important`, and keep the same `.dropdown-menu` and `.dropdown` z-index and position rules.

### 3. Table container in the page

- Wrap the table in a container that does **not** clip: avoid `overflow: hidden` on the card or the div that wraps the table. Use `overflow: visible` as above if needed.
- In HTML you can hint that the area should allow overflow, e.g. `<div id="myTable" style="overflow: visible;">` so the dropdown can extend outside the table.

---

## Checklist (either approach)

- [ ] **Row identity** – Each action knows which row it belongs to (e.g. via `data-row-id` on the button in A, or via `onclick="...('${rowId}')"` in B).
- [ ] **Single dropdown (A)** – One dropdown in `document.body`, positioned with `getBoundingClientRect()` and `position: fixed`, and hidden on outside click, scroll, and resize.
- [ ] **Overflow (B)** – All table-related wrappers and cells use `overflow: visible` so the menu is not clipped.
- [ ] **z-index** – Dropdown menu has a high enough `z-index` (e.g. 1060 for Bootstrap, or 2147483647 for the body-mounted dropdown) so it appears above the table and modals.
- [ ] **Handlers** – Action handlers are defined on a global or otherwise reachable object so inline `onclick` (B) or programmatic handlers (A) can call them.

---

## Summary

- **Approach A (body-mounted):** One dropdown, created in JS, appended to `document.body`, positioned with `position: fixed` and `getBoundingClientRect()`. Row context comes from `data-row-id` (or similar) on the button. No dependency on table overflow. Best when the table is inside scrollable or overflow-hidden containers.
- **Approach B (in-cell):** Standard dropdown markup in each row; row ID passed in `onclick`. Requires `overflow: visible` and a high `z-index` on the table and dropdown so the menu is not clipped and appears on top. Simpler markup and works well when you can control the table wrapper’s overflow.

Use A when you cannot reliably control overflow (e.g. complex GridJS or nested scroll); use B when you can and prefer to keep everything in the cell.
