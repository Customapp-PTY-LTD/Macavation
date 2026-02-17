# Module UI Patterns

Reusable UI patterns for app modules. Use this guide when building or updating data grids, tables, and action menus so behaviour and styling stay consistent.

---

## 1. Actions column (dropdown trigger)

Use a **three-dots (ellipsis) button** only—no label, no caret.

- **Icon:** Horizontal ellipsis `fa-ellipsis` (⋯). Do not use `fa-ellipsis-v` or "Actions" text.
- **Button:** Square, same width and height (e.g. `2rem × 2rem`), sharp corners (`border-radius: 0`).
- **Alignment:** Center the button in the Actions column.
- **Accessibility:** Keep `aria-label="Actions"` (or similar) on the button.
- **Dropdown:** Use `data-bs-toggle="dropdown"`; omit the `dropdown-toggle` class so Bootstrap does not add the caret.

### Example (HTML/JS output)

```html
<div class="dropdown">
  <button class="btn btn-sm btn-outline-secondary" type="button" id="rowActions{id}"
    data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions">
    <i class="fas fa-ellipsis"></i>
  </button>
  <ul class="dropdown-menu dropdown-menu-end" aria-labelledby="rowActions{id}">
    <!-- items -->
  </ul>
</div>
```

### Example (CSS – scoped to your table)

```css
#yourTableId td:last-child {
  text-align: center;
}

#yourTableId td:last-child .dropdown {
  display: inline-block;
}

#yourTableId td:last-child .dropdown .btn {
  width: 2rem;
  height: 2rem;
  min-width: 2rem;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0;
}
```

---

## 2. Clickable rows and “primary” column

When the **whole row** is clickable, make the first (or primary) column look clickable so users notice.

- **Primary column:** Use theme primary colour and medium font weight.
- **Hover:** Underline the primary column text on row hover.

### Example (CSS)

```css
#yourTableId tbody tr.js-row { cursor: pointer; }

#yourTableId .js-row td:first-child {
  color: var(--phoenix-primary);
  font-weight: 500;
}

#yourTableId .js-row:hover td:first-child {
  text-decoration: underline;
}
```

Use a stable row class (e.g. `js-row` or `js-{module}-row`) so the same row is used for both click handling and this styling.

---

## 3. Dates in tables

Show dates in **dd/mm/yyyy** for display.

- **Use:** `_common.formatDateDDMMYYYY(value)` from `js/common.js`.
- **Fallback:** If `_common` is not available, use a safe fallback (e.g. ISO date string or `'N/A'`).

### Example (JS)

```javascript
const displayDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
  ? (_common.formatDateDDMMYYYY(row.received_date) || 'N/A')
  : (row.received_date ? /* your fallback format */ : 'N/A');
```

Use the same pattern for any date column (received date, due date, created at, etc.).

---

## 4. Dropdown menu contents

- **Keep menus focused:** Only include actions that belong on that screen. Remove or relocate rarely used items (e.g. “History” moved to row click or another place).
- **Order:** Put the main action first, then secondary actions, then destructive or “release” style actions last if needed.
- **Sharp corners:** Dropdowns use global sharp styling; no extra radius in module CSS unless needed for a one-off.

---

## 5. Quick checklist for a new/updated module grid

- [ ] Actions column: ellipsis-only button, square, sharp corners, center-aligned.
- [ ] No “Actions” text and no caret on the dropdown trigger.
- [ ] If the row is clickable: primary column styled as link (primary colour, underline on hover).
- [ ] All date columns use `_common.formatDateDDMMYYYY` for dd/mm/yyyy.
- [ ] Dropdown menu only includes actions that belong there; no redundant items.
- [ ] Table and thead use global sharp corners (no extra `border-radius` in module CSS).

---

## Reference: Kernel Production

The **Kernel Production Workflow** module implements these patterns:

- **Actions:** `fa-ellipsis`, square button, center-aligned (`modules/kernel-production/css/kernel_production_grid.css`, `js/kernel_production_grid.js`).
- **Batch number:** Primary colour + underline on hover (`kernel_production_grid.css`).
- **Received date:** `_common.formatDateDDMMYYYY` in `kernel_production_grid.js`.
- **Dropdown:** Production, End sample, Job Card, Release to stock (no History in menu).

Use it as the reference when applying these patterns to other modules.
