# WebPortal UI Design Instructions

Reference module: **kernel-production** (`modules/kernel-production`). Use these patterns for layout, spacing, tables, and clickable rows so modules look and behave consistently.

## Brand colors

- **Primary green:** `#008950` — flat, no gradients. Used for `.btn-primary`, primary actions, links, and accents.
- Theme-specific colors (e.g. `--phoenix-primary`) may vary; prefer the flat green for consistent primary actions where appropriate.

---

## Border radius (buttons, modals, inputs)

Use the **same border radius** everywhere for a consistent look:

- **Token:** `var(--phoenix-border-radius)` (theme value, typically **5px**).
- **Buttons:** All `.btn` (except `.rounded-pill`) use this radius.
- **Modals:** `.modal-content` and its first `.modal-header` and `.modal-body` use this radius so the dialog has rounded corners (footer is often omitted; see Modals section).
- **Inputs:** `.form-control`, `.form-select`, `input`, `textarea`, `.input-group-text`, and floating labels use this radius so form fields match buttons and modals.

This is enforced in `WebPortal/css/main.css`. Do not override to `border-radius: 0` for modals or inputs unless a specific component (e.g. table action ellipsis button) intentionally uses square corners.

---

## Modals (universal)

Modal header and body styling is **global** in `WebPortal/css/main.css` and applies to all modals. Do not add per-modal CSS that overrides these.

**CSS variables (in `:root`):**
- `--macavation-pink: #FF005E` — brand pink for modal title and navbar accent.
- `--macavation-modal-body-bg: #F5F5F5` — body grey for modal content area.

**Modal header (`.modal-content .modal-header`):**
- **Background:** White (`#fff`).
- **Title text:** Macavation pink (`var(--macavation-pink)`), font `"Inter", var(--phoenix-font-brand)`, `font-weight: 700`, **capital letters** (`text-transform: uppercase`).
- **Layout:** Centered (`justify-content: center`, `text-align: center`). Close button remains absolutely positioned on the right.
- **Border:** None (`border: none`).
- **Shadow:** Same as main navbar — `0 1px 3px rgba(0, 0, 0, 0.08)` — so the header bar matches the app header.

**Modal body (`.modal-content .modal-body`):**
- **Background:** Body grey (`var(--macavation-modal-body-bg)`).
- **Text:** `var(--phoenix-text-color)` for readability.

**Footer and actions:**
- **Prefer no footer.** Put primary actions (Save, Submit, etc.) **inside the body** in a block with class **`.modal-body-actions`** at the bottom of the scrollable content (e.g. `d-flex flex-wrap align-items-center mt-4 pt-3 border-top gap-2`). Close via the header X only when there is no footer.
- **If a footer is used** (e.g. for Cancel + Save): Cancel uses red (`#dc3545`) on the left; primary button has no focus glow. These rules are in `main.css` under `.modal-content .modal-footer` and `.modal-content .modal-body .modal-body-actions`.

**Modal title copy:** Keep the `.modal-title` to **one or two words** (e.g. “Receiving Checklist”). Avoid long or contextual suffixes like “(edit)” or “(for this batch)” in the header; handle context in the body or leave the title short.

**Modals with tabs (e.g. Production Stages):** Use a file-paper tab look: tabs with gap between them, **no** bottom border radius on tab buttons (so the active tab meets the content), tab borders in macadamia cream brown (`#b8a078`). Action buttons live in `.modal-body-actions` **inside** the scrollable body so they scroll with the content. See `modules/modals/modal-production-stages/` for reference.

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
- **Between icon and label:** Use `me-1` on the icon so there is a small gap before the text. Prefer **regular (lined)** icons: `far` not `fas` (e.g. `<i class="far fa-chart-bar me-1"></i>Export`).
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
            <i class="far fa-times me-1"></i>Clear
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
        <i class="far fa-info-circle me-2"></i>No records found.
    </td>
</tr>
```

Use `py-4` for vertical padding so the empty state is easy to see.

---

## 8. Summary checklist

| Area              | Do |
|-------------------|----|
| Border radius     | Buttons, modals (`.modal-content`), and inputs (`.form-control`, `.form-select`) all use `var(--phoenix-border-radius)` (e.g. 5px) |
| Modals            | Universal in `main.css`: header white bg, pink title text, uppercase, centered, no border, navbar-matching shadow; body grey (`--macavation-modal-body-bg`); **no footer** — put actions in `.modal-body-actions` inside body; title 1–2 words; tab modals use file-paper look (macadamia border, no bottom radius on tabs) |
| Layout            | `.module-content` → header row (`pt-3 pb-2 mb-3 border-bottom`) → cards (`mb-3` / `mb-4`) |
| Buttons           | `btn-toolbar mb-2 mb-md-0 ms-auto`; icon + `me-1` + label; `btn-outline-secondary` / `btn-primary` |
| Filters           | Card with `row g-3`; button column with `d-flex align-items-end` |
| Table             | `table-responsive` → `table table-hover`; first column = identifier, last = Actions |
| Clickable row     | Row class (e.g. `js-batch-row`), `cursor: pointer`, first cell styled with primary color + underline on hover |
| Icons             | Use `far` (regular/lined) not `fas` (solid/filled) — e.g. `class="far fa-chart-bar"` |
| Actions           | One dropdown per row, centered; square 2rem icon button with `fa-ellipsis` |
| Empty state       | Full colspan row, `text-center text-muted py-4`, optional icon |

When in doubt, match **kernel-production** HTML and CSS in `modules/kernel-production` (especially `html/kernel_production_grid.html` and `css/kernel_production_grid.css`).
