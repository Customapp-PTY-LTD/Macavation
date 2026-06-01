# Production Calendar — styling specification

This document describes how the **Production Calendar** in the Macavation Web Portal (Kernel Production module) is structured and styled. You can hand this to another design system or implementation team to reproduce the same look and behaviour.

**Source files in this repo**

- Styles: `WebPortal/modules/kernel-production/css/kernel_production_grid.css` (selectors prefixed with `.kp-production-calendar-`)
- Markup shell: `WebPortal/modules/kernel-production/html/kernel_production_grid.html`
- Grid cells and detail panel HTML: generated in `WebPortal/modules/kernel-production/js/kernel_production_grid.js` (`renderProductionCalendar`, `renderProductionCalendarDetail`)

**Single source of truth (maintenance)**

- **Shipped CSS** is authoritative for pixel-perfect parity: compare this document to [`WebPortal/modules/kernel-production/css/kernel_production_grid.css`](WebPortal/modules/kernel-production/css/kernel_production_grid.css) (search `kp-production-calendar`). After UI changes, if the spec and file disagree, **update this markdown to match the CSS file**.
- **Shipped behaviour** (month grid, indexing, selection, detail HTML): [`WebPortal/modules/kernel-production/js/kernel_production_grid.js`](WebPortal/modules/kernel-production/js/kernel_production_grid.js) — use your editor’s symbol search for the identifiers in the table below.
- **Portable static demo** (open in a browser; no portal): [`examples/kernel-production-calendar-reference.html`](examples/kernel-production-calendar-reference.html).

**External dependencies**

- **Bootstrap 5** and **Font Awesome** wrap the calendar in the real portal. For a breakdown and how to replace them in another stack, see [External frameworks and substitutions](#external-frameworks-and-substitutions) later in this document.
- **No third-party calendar library** (not FullCalendar): the month view is a 42-cell CSS grid built in application JavaScript.

---

## Layout overview

| Region | Role |
|--------|------|
| Card header | Collapsible title + month navigation (prev / label / next) |
| Card body | Hint text + two-column layout: **month grid** (left) + **detail panel** (right) |
| Weekday row | 7-column labels (Sun–Sat) |
| Day grid | 7×6 = 42 cells (leading/trailing days from adjacent months included) |
| Detail panel | Title + list of batch entries with stage pills |

**Responsive rule:** Below `992px` (`max-width: 991.98px`), the two-column layout stacks to a single column (`grid-template-columns: 1fr`).

---

## DOM structure (conceptual)

```
#kpProductionCalendarCard.card
  .card-header.bg-light [flex, wrap]
    button.kp-production-calendar-toggle [collapse trigger]
      h5 … Production Calendar … .kp-production-calendar-toggle-icon
    .kp-production-calendar-toolbar
      button#kpProductionCalendarPrevBtn.btn.btn-sm.btn-outline-secondary
      #kpProductionCalendarMonthLabel.kp-production-calendar-month
      button#kpProductionCalendarNextBtn.btn.btn-sm.btn-outline-secondary
  #kpProductionCalendarCollapse.collapse.show
    .card-body
      p.text-muted.small [hint copy]
      .kp-production-calendar-layout
        div
          .kp-production-calendar-weekdays
            div × 7  (Sun … Sat)
          #kpProductionCalendarGrid.kp-production-calendar-grid
            button.kp-production-calendar-day [+ optional state classes]
              .kp-production-calendar-daynum
              optional: .kp-production-calendar-count
        #kpProductionCalendarDetail.kp-production-calendar-detail
          .kp-production-calendar-detail-title
          .kp-production-calendar-detail-empty  OR  .kp-production-calendar-entry × N
```

**Day cell:** Implemented as `<button type="button">` with `data-iso="YYYY-MM-DD"` for accessibility and keyboard use.

---

## State classes on day cells

Applied in combination on `.kp-production-calendar-day`:

| Class | Meaning |
|-------|---------|
| *(base)* | In-month day, no production |
| `is-outside-month` | Cell belongs to previous/next month (greyed) |
| `has-production` | At least one batch has activity on that date (blue tint) |
| `is-active` | Currently selected day (strong blue border + ring) |

`has-production` and `is-active` can both apply; `is-outside-month` is mutually exclusive with “current month” in logic but still styled if combined.

---

## CSS reference (calendar-only)

Values below are the canonical rules as shipped.

### Toolbar & collapse affordance

```css
.kp-production-calendar-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.kp-production-calendar-toggle {
  color: inherit;
}

.kp-production-calendar-toggle:hover {
  color: inherit;
}

.kp-production-calendar-toggle-icon {
  font-size: 0.85rem;
  transition: transform 0.15s ease;
}

.kp-production-calendar-toggle[aria-expanded="false"] .kp-production-calendar-toggle-icon {
  transform: rotate(180deg);
}

.kp-production-calendar-month {
  min-width: 140px;
  text-align: center;
  font-weight: 600;
}
```

### Main layout (grid + detail)

```css
.kp-production-calendar-layout {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: 1rem;
  align-items: start;
}

@media (max-width: 991.98px) {
  .kp-production-calendar-layout {
    grid-template-columns: 1fr;
  }
}
```

### Weekday row and 7-column day grid

```css
.kp-production-calendar-weekdays,
.kp-production-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 0.5rem;
}

.kp-production-calendar-weekdays {
  margin-bottom: 0.5rem;
}

.kp-production-calendar-weekdays div {
  text-align: center;
  font-size: 0.8rem;
  font-weight: 600;
  color: #6c757d;
}
```

### Day cell

```css
.kp-production-calendar-day {
  min-height: 84px;
  border: 1px solid #dee2e6;
  border-radius: 0.5rem;
  background: #fff;
  padding: 0.5rem;
  text-align: left;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
}

.kp-production-calendar-day:hover {
  border-color: #9ec5fe;
}

.kp-production-calendar-day.is-outside-month {
  opacity: 0.45;
}

.kp-production-calendar-day.is-active {
  border-color: #0d6efd;
  box-shadow: 0 0 0 2px rgba(13, 110, 253, 0.15);
}

.kp-production-calendar-day.has-production {
  background: #e7f1ff;
  border-color: #9ec5fe;
}
```

### Day number and batch count pill

```css
.kp-production-calendar-daynum {
  font-weight: 600;
  color: #212529;
}

.kp-production-calendar-count {
  display: inline-block;
  margin-top: 0.4rem;
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
  background: #0d6efd;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 600;
}
```

### Empty grid placeholder (optional pattern)

```css
.kp-production-calendar-empty {
  grid-column: 1 / -1;
  padding: 1rem;
  text-align: center;
  color: #6c757d;
  border: 1px dashed #dee2e6;
  border-radius: 0.5rem;
}
```

### Detail panel

```css
.kp-production-calendar-detail {
  min-height: 300px;
  border: 1px solid #dee2e6;
  border-radius: 0.75rem;
  background: #fafbfc;
  padding: 1rem;
}

.kp-production-calendar-detail-title {
  font-size: 1rem;
  font-weight: 700;
  margin-bottom: 0.75rem;
}

.kp-production-calendar-detail-empty {
  color: #6c757d;
  font-size: 0.9rem;
}
```

### Detail entries and stage badges

```css
.kp-production-calendar-entry {
  border: 1px solid #dee2e6;
  border-radius: 0.6rem;
  background: #fff;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}

.kp-production-calendar-entry:last-child {
  margin-bottom: 0;
}

.kp-production-calendar-entry-head {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  align-items: start;
  margin-bottom: 0.5rem;
}

.kp-production-calendar-entry-batch {
  font-weight: 700;
  color: #212529;
}

.kp-production-calendar-entry-grower {
  color: #6c757d;
  font-size: 0.85rem;
}

.kp-production-calendar-stage-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.kp-production-calendar-stage {
  display: inline-flex;
  align-items: center;
  padding: 0.2rem 0.55rem;
  border-radius: 999px;
  background: #dbeafe;
  color: #0b5ed7;
  font-size: 0.75rem;
  font-weight: 600;
}
```

---

## Design tokens (extracted)

These align with **Bootstrap 5** palette naming where possible.

| Token | Hex / value | Usage |
|-------|----------------|--------|
| Border default | `#dee2e6` | Day cells, detail border, entry cards |
| Muted text | `#6c757d` | Weekday headers, grower line, empty states |
| Body text | `#212529` | Day numbers, batch titles |
| Primary / blue | `#0d6efd` | Active border, count pill background |
| Primary hover border | `#9ec5fe` | `has-production` border, day hover |
| Primary tint background | `#e7f1ff` | Days with production |
| Active ring | `rgba(13, 110, 253, 0.15)` | 2px spread shadow on selected day |
| Detail panel bg | `#fafbfc` | Side panel background |
| Stage pill bg | `#dbeafe` | Badge background |
| Stage pill text | `#0b5ed7` | Badge text (Bootstrap “blue-700” tone) |

**Radii:** day cells `0.5rem`, detail panel `0.75rem`, entries `0.6rem`, pills `999px` (fully rounded).

**Spacing:** layout gap `1rem`; grid gap `0.5rem`; day padding `0.5rem`; detail padding `1rem`.

---

## Interaction notes (for parity)

- Month label is plain text (e.g. formatted month + year).
- Prev/next clears the selected date and re-renders; selection may jump to the first day in the new month that has production (implementation detail in JS).
- Clicking a day sets it active and refreshes the detail list.
- User-facing copy in the UI describes “blue” days for production activity; the actual highlight is **light blue background** (`#e7f1ff`) plus **blue border**, with a **solid blue pill** for batch count.

---

## JavaScript and data model (behaviour parity)

Implement the same behaviour in another stack by mirroring these symbols in **`WebPortal/modules/kernel-production/js/kernel_production_grid.js`** (line numbers drift; search by name).

| Symbol | Purpose |
|--------|---------|
| `PRODUCTION_STAGE_LABELS` | Maps JSON keys to labels: `cracking_data` → Cracking, `washing_data` → Washing, `sorting_data` → Sorting, `packing_data` → Packing |
| `hasMeaningfulStageData` | Returns false for objects that only have a `date` (or booleans false / empty strings) — same idea as “ignore placeholder rows” |
| `isoFromDate` / `parseIsoDate` | Calendar `Date` at local midnight ↔ strict `YYYY-MM-DD` string |
| `formatMonthYear` / `formatDisplayDate` | Locale month label in header; long date in detail title |
| `buildBatchProductionCalendarEntries(batch, detail)` | For one batch + its merged `detail`, produce sorted array of `{ date, batchId, batchNumber, growerName, stages[] }` (one object per date that has meaningful stage rows) |
| `buildProductionCalendarIndex(batches)` | `Record<iso, entry[]>` merging all batches’ `_productionCalendarEntries`; each ISO’s array sorted by `batchNumber` string |
| `shiftProductionCalendarMonth` | Move `productionCalendarMonth` by ±1 month (always day 1); set `selectedProductionCalendarDate` to `null` then re-render |
| `renderProductionCalendar` | Writes 42 day buttons into `#kpProductionCalendarGrid`, updates month label, assigns default selection when null |
| `renderProductionCalendarDetail` | Writes `#kpProductionCalendarDetail` inner HTML from `productionCalendarEntriesByDate` |

### `buildBatchProductionCalendarEntries` (logic)

1. Initialise empty map `byDate` keyed by ISO date string.
2. For each key in `PRODUCTION_STAGE_LABELS`, read `detail[key]` as an array of stage rows.
3. For each row: take `entry.date`, normalize to ISO date with `String(date).split('T')[0]`; if missing or `hasMeaningfulStageData(entry)` is false, skip.
4. For that ISO, ensure a bucket `{ date, batchId, batchNumber, growerName, stages: [] }`; push the human stage label if not already in `stages`.
5. Return `Object.keys(byDate).sort().map(iso => { sort stages; return bucket })`.

### `buildProductionCalendarIndex` (logic)

1. Start with `{}`.
2. For each batch in the filtered list, for each element of `batch._productionCalendarEntries`, append the entry to `index[entry.date]` (array).
3. For each ISO key in `index`, sort the array: `(a, b) => String(a.batchNumber).localeCompare(String(b.batchNumber))`.

### `renderProductionCalendar` (42-cell grid)

1. Normalise `productionCalendarMonth` to the first day of that month at local time.
2. Build `index = buildProductionCalendarIndex(filteredBatches)` and store on the controller as `productionCalendarEntriesByDate`.
3. **Default selection** when `selectedProductionCalendarDate` is null: `monthPrefix = "${year}-${MM}"` (MM zero-padded); `firstMatch` = first string in `Object.keys(index).sort()` where the key starts with `monthPrefix + '-'`; set selection to `firstMatch` or leave unset.
4. **First cell date (Sunday-aligned week):** `firstCellDate = new Date(year, monthIndex, 1 - monthDate.getDay())` (JavaScript `getDay()`: 0 = Sunday).
5. Loop `i` from 0 to 41: `cellDate` = calendar date `firstCellDate + i` days; `iso = isoFromDate(cellDate)`.
6. Classes on `<button type="button" class="kp-production-calendar-day" data-iso="…">`: append `is-outside-month` if `cellDate.getMonth() !== monthDate.getMonth()`; append `has-production` if `index[iso].length > 0`; append `is-active` if `iso === selectedProductionCalendarDate`.
7. Inside button: always `.kp-production-calendar-daynum` with `cellDate.getDate()`; if has entries, append `.kp-production-calendar-count` with copy `N batch` or `N batches`.
8. Call `renderProductionCalendarDetail(selectedProductionCalendarDate)`.

### `renderProductionCalendarDetail` (right pane)

- **No ISO:** title “No day selected” + `.kp-production-calendar-detail-empty` hint (see live copy in HTML).
- **ISO with empty array:** title uses `formatDisplayDate(iso)` + empty line “No saved production activity for this day.”
- **Else:** title + for each entry a `.kp-production-calendar-entry` block: `.kp-production-calendar-entry-head` with `.kp-production-calendar-entry-batch` and `.kp-production-calendar-entry-grower`, then `.kp-production-calendar-stage-badges` containing one `.kp-production-calendar-stage` span per stage string. Escape all user-derived text when emitting HTML.

---

## External frameworks and substitutions

### Bootstrap 5 (shell only)

Calendar **chrome** uses Bootstrap’s card, buttons, collapse, and utilities. The **look of day cells and the detail panel** comes only from `.kp-production-calendar-*` rules above.

| Pattern (examples) | Role | If you have no Bootstrap |
|----------------------|------|---------------------------|
| `card`, `card-header`, `card-body`, `bg-light` | Outer container | Single bordered box: `border: 1px solid #dee2e6; border-radius: 0.375rem; overflow: hidden` |
| `btn btn-sm btn-outline-secondary` | Prev / next | Small neutral outline button (see Bootstrap 5 source for exact padding/font-size) or match visually with `1px` border and `0.25rem 0.5rem` padding |
| `collapse` / `collapse.show` | Collapsible section | `<details open>` / `<summary>` or your framework’s disclosure component |
| `text-muted`, `small`, spacing utilities | Hint line under header | Use `#6c757d` and `0.875rem` from the token table |

Pin **Bootstrap 5.x** in the other solution if you import Bootstrap for the fastest visual match to the rest of the portal.

### Font Awesome (`fas`)

Icons used on this widget: `fa-calendar-alt`, `fa-chevron-up` (collapse), `fa-chevron-left`, `fa-chevron-right`. Replacements:

- **Inline SVG** (recommended for design systems): single-path icons at `1em` / `0.875rem`.
- **Another icon font** (Bootstrap Icons, Material Symbols): swap class names only; keep spacing (`me-2`, `ms-2`) equivalent in margin.
- **Unicode / emoji (quick mockups):** e.g. `‹` `›` for prev/next; calendar pictograph varies by OS — fine for internal tools, not for brand parity.

---

## Licence / scope

This markdown is a **design and markup reference** derived from the Macavation project. The other system is responsible for its own component logic, data binding, and accessibility review.
