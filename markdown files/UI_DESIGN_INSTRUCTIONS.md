# WebPortal UI Design Instructions

Reference module: **kernel-production** (`modules/kernel-production`). Use these patterns for layout, spacing, tables, and clickable rows so modules look and behave consistently.

## Brand colors

- **Primary green:** `#008950` — flat, no gradients. Used for `.btn-primary`, primary actions, links, and accents.
- Theme-specific colors (e.g. `--phoenix-primary`) may vary; prefer the flat green for consistent primary actions where appropriate.

---

## 1. Page structure

- Wrap all module content in a single **`.module-content`** container.
- Use a **header row** for title and primary actions, then **cards** for filters and main content.

```html
<div class="module-content">
    <div class="d-flex justify-content-between flex-wrap flex-md-nowrap align-items-center pt-3 pb-2 mb-3 border-bottom">
        <h1 class="h2">Page Title</h1>
        <div class="btn-toolbar mb-2 mb-md-0 ms-auto">
            <!-- primary actions here -->
        </div>
    </div>
    <!-- cards for filters, tables, etc. -->
</div>
```

- **Title:** `h1` with class `h2` for consistent size.
- **Spacing:** `pt-3 pb-2 mb-3` on the header row; `border-bottom` to separate from content.

---

## 2. Button spacing and toolbar

- **Toolbar:** Use `btn-toolbar` with `mb-2 mb-md-0 ms-auto` so buttons sit on the right and have consistent bottom margin.
- **Between icon and label:** Use `me-1` on the icon so there is a small gap before the text (e.g. `<i class="fas fa-download me-1"></i>Export`).
- **Button styles:** Prefer `btn btn-outline-secondary` for secondary actions (e.g. Export, Clear) and `btn btn-primary` or `btn btn-sm btn-primary` for primary actions (e.g. Create).
- **Filter row:** Use `row g-3` for the filter row so all form groups (search, selects, buttons) have even spacing. For a button that should align with inputs, put it in a column with `d-flex align-items-end` so the button baseline lines up with the last line of the inputs.

Example filter row:

```html
<div class="row g-3">
    <div class="col-md-4">
        <label for="searchInput" class="form-label">Search</label>
        <input type="text" class="form-control" id="searchInput" placeholder="...">
    </div>
    <div class="col-md-3">
        <label for="filterStatus" class="form-label">Status</label>
        <select class="form-select" id="filterStatus">...</select>
    </div>
    <div class="col-md-2 d-flex align-items-end">
        <button type="button" class="btn btn-outline-secondary w-100" id="clearFiltersBtn">
            <i class="fas fa-times me-1"></i>Clear
        </button>
    </div>
</div>
```

---

## 3. Cards and sections

- **Filters / search:** One card with `mb-3`, `card-body`, and the filter `row g-3` inside.
- **Main table:** A separate card with `mb-4`, `card-body`, then the table (see below). Using `mb-4` gives a clear visual separation between the main content and anything below.
- **Card headers with actions:** Use `card-header bg-light d-flex justify-content-between align-items-center`, with the action button on the right (e.g. "Create kernel batch" with `btn btn-sm btn-primary`).

---

## 4. Table structure

- Wrap the table in **`table-responsive`** so it scrolls horizontally on small screens.
- Use **`table table-hover`** on the `<table>` for default Bootstrap styling and row hover. Use **`table-sm`** only when you need a denser table (e.g. many columns or compact lists).
- **Header:** No top border and bold headers:

  ```css
  #yourTable th { border-top: none; font-weight: 600; }
  ```

- **Column order:** Put the main identifier (e.g. batch number, name) in the **first column**. That column is styled as the primary click target (see below). Put **Actions** in the **last column**.

---

## 5. Clickable rows and “clickable” first column

- **Row class:** Add a stable class to each data row for styling and JS (e.g. `js-batch-row`). Attach the row ID in a data attribute (e.g. `data-batch-id`) so click handlers can resolve the record.
- **Cursor:** Make the whole row look clickable with `cursor: pointer` on the row class.
- **First column as primary link:** Style the **first cell** so it looks like the main clickable label (link-like), without using an `<a>` in the markup:

  ```css
  #yourTable tbody tr.js-batch-row { cursor: pointer; }

  /* First column looks clickable */
  #yourTable .js-batch-row td:first-child {
      color: var(--phoenix-primary);
      font-weight: 500;
  }

  #yourTable .js-batch-row:hover td:first-child {
      text-decoration: underline;
  }
  ```

- **Click handling:** Bind a single click handler to the row (e.g. `#batchesTableBody tr.js-batch-row`). Ignore clicks on the actions column so dropdowns and buttons work:

  ```javascript
  $(document).on('click', '#yourTableBody tr.js-batch-row', function (e) {
      if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
      const id = $(this).data('batch-id'); // or equivalent
      // open detail view / modal
  });
  ```

Result: the first column reads as the primary link, the whole row is clickable, and the actions column stays usable.

---

## 6. Actions column

- **Alignment:** Center the actions cell:

  ```css
  #yourTable td:last-child { text-align: center; }
  ```

- **Single actions control:** Prefer one **dropdown** per row with an ellipsis icon (`fa-ellipsis`) rather than multiple separate buttons.
- **Dropdown button:** Small, square, icon-only:

  ```css
  #yourTable td:last-child .dropdown .btn {
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

- Use `btn btn-sm btn-outline-secondary` for the trigger; use `dropdown-menu dropdown-menu-end` for the menu. Menu items can be `<a class="dropdown-item" href="#" data-...>` or disabled `<span class="dropdown-item text-muted">...</span>`.

---

## 7. Empty and no-results states

- **No data:** One row, full colspan, centered, muted text and optional icon (e.g. “No production batches. Release batches from Grower Intake.”).
- **No results (filtered):** Same layout, different message (e.g. “No batches match your search.”).

Example:

```html
<tr>
    <td colspan="6" class="text-center text-muted py-4">
        <i class="fas fa-info-circle me-2"></i>No records found.
    </td>
</tr>
```

Use `py-4` for vertical padding so the empty state is easy to see.

---

## 8. Summary checklist

| Area              | Do |
|-------------------|----|
| Layout            | `.module-content` → header row (`pt-3 pb-2 mb-3 border-bottom`) → cards (`mb-3` / `mb-4`) |
| Buttons           | `btn-toolbar mb-2 mb-md-0 ms-auto`; icon + `me-1` + label; `btn-outline-secondary` / `btn-primary` |
| Filters           | Card with `row g-3`; button column with `d-flex align-items-end` |
| Table             | `table-responsive` → `table table-hover`; first column = identifier, last = Actions |
| Clickable row     | Row class (e.g. `js-batch-row`), `cursor: pointer`, first cell styled with primary color + underline on hover |
| Actions           | One dropdown per row, centered; square 2rem icon button with `fa-ellipsis` |
| Empty state       | Full colspan row, `text-center text-muted py-4`, optional icon |

When in doubt, match **kernel-production** HTML and CSS in `modules/kernel-production` (especially `html/kernel_production_grid.html` and `css/kernel_production_grid.css`).
