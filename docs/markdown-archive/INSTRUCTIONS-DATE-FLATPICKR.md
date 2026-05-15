# Flatpickr Date Inputs: Instructions for JS Files

This document provides instructions for implementing Flatpickr date pickers across the application, enforcing a consistent **dd/mm/yyyy** display and input format.

---

## Table of contents

1. [Overview](#1-overview)
2. [Dependencies](#2-dependencies)
3. [HTML markup](#3-html-markup)
4. [Static date inputs (in HTML)](#4-static-date-inputs-in-html)
5. [Dynamic date inputs (created in JS)](#5-dynamic-date-inputs-created-in-js)
6. [Standard Flatpickr config (dd/mm/yyyy)](#6-standard-flatpickr-config-ddmmyyyy)
7. [Getting and setting values](#7-getting-and-setting-values)
8. [API format: ISO vs display](#8-api-format-iso-vs-display)
9. [Checklist when adding/modifying date inputs](#9-checklist-when-addingmodifying-date-inputs)

---

## 1. Overview

- **Problem:** Native `type="date"` inputs use browser locale and format (often mm/dd/yyyy in some regions). The app requires a consistent **dd/mm/yyyy** format.
- **Solution:** Use [Flatpickr](https://flatpickr.js.org/) to replace native date inputs with a unified date picker and enforce dd/mm/yyyy display.

---

## 2. Dependencies

Add these to the page that hosts date inputs (typically `index.html` or `WebPortal/index.html`):

### 2.1 CSS (in `<head>`)

```html
<link href="https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css" rel="stylesheet">
```

### 2.2 JS (before closing `</body>`)

```html
<script src="https://cdn.jsdelivr.net/npm/flatpickr"></script>
```

---

## 3. HTML markup

Use `type="text"` for Flatpickr targets. Avoid `type="date"`.

**Before (native date):**
```html
<input type="date" class="form-control" id="dispatchDeliveryDate" required>
```

**After (Flatpickr target):**
```html
<input type="text" class="form-control flatpickr-date" id="dispatchDeliveryDate" data-input required>
```

- Add class `flatpickr-date` (or a custom class) so JS can target all date inputs.
- `data-input` is optional but helps identify date fields if needed.

---

## 4. Static date inputs (in HTML)

For inputs that exist in the loaded HTML when the module initialises:

```javascript
// In the module's JS init (e.g. after modal load or grid load)
if (typeof flatpickr !== 'undefined') {
    flatpickr('.flatpickr-date', {
        dateFormat: 'd/m/Y',
        allowInput: false,
        disableMobile: true
    });
}
```

Or for a single element by ID:

```javascript
flatpickr('#dispatchDeliveryDate', {
    dateFormat: 'd/m/Y',
    allowInput: false,
    disableMobile: true
});
```

---

## 5. Dynamic date inputs (created in JS)

When rows or modals add date inputs dynamically, initialise Flatpickr on the new elements after appending to the DOM.

### 5.1 After inserting a single row

```javascript
var newRow = '<tr>...<td><input type="text" class="form-control form-control-sm flatpickr-date" name="manufacturedDate"></td>...</tr>';
var $row = $(newRow).appendTo('#tableBody');
// Initialise Flatpickr on the new row's date inputs
$row.find('.flatpickr-date').each(function () {
    if (typeof flatpickr !== 'undefined') {
        flatpickr(this, { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true });
    }
});
```

### 5.2 After cloning or duplicating rows

```javascript
var $cloned = $templateRow.clone();
$cloned.find('.flatpickr-date').each(function () {
    if (typeof flatpickr !== 'undefined') {
        flatpickr(this, { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true });
    }
});
$cloned.appendTo('#tableBody');
```

### 5.3 After opening a modal

```javascript
$('#myModal').on('shown.bs.modal', function () {
    var container = document.getElementById('myModal');
    var inputs = container ? container.querySelectorAll('.flatpickr-date') : [];
    inputs.forEach(function (el) {
        if (typeof flatpickr !== 'undefined') {
            flatpickr(el, { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true });
        }
    });
});
```

---

## 6. Standard Flatpickr config (dd/mm/yyyy)

Use this config object consistently:

```javascript
var FLATPICKR_DDMMYYYY = {
    dateFormat: 'd/m/Y',
    allowInput: false,
    disableMobile: true
};
```

- **dateFormat: 'd/m/Y'** — Display format dd/mm/yyyy.
- **allowInput: false** — Forces picker-only input (avoids manual typing that could break format).
- **disableMobile: true** — Avoids native mobile date UI overriding Flatpickr.

---

## 7. Getting and setting values

### 7.1 Getting the value

Flatpickr stores the value in the underlying `<input>`. The displayed value is in `d/m/Y` format. For API/backend, convert to ISO if required:

```javascript
var input = document.getElementById('dispatchDeliveryDate');
var displayValue = input ? input.value : '';  // e.g. "18/02/2025"

// Convert dd/mm/yyyy to ISO (yyyy-mm-dd) for APIs
function toISO(dateStr) {
    if (!dateStr || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return null;
    var parts = dateStr.split('/');
    return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
}
var isoValue = toISO(displayValue);  // "2025-02-18"
```

### 7.2 Setting the value

If the backend returns ISO (yyyy-mm-dd), convert to dd/mm/yyyy for display:

```javascript
function fromISO(isoStr) {
    if (!isoStr) return '';
    var parts = isoStr.split('-');
    if (parts.length !== 3) return isoStr;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
}
input.value = fromISO('2025-02-18');  // "18/02/2025"
```

For Flatpickr instances, you can use `setDate()`:

```javascript
var fp = document.getElementById('dispatchDeliveryDate')._flatpickr;
if (fp) fp.setDate('2025-02-18');  // Flatpickr accepts ISO and formats to d/m/Y
```

---

## 8. API format: ISO vs display

| Context       | Format     | Example    |
|---------------|------------|------------|
| Display (UI)  | dd/mm/yyyy | 18/02/2025 |
| Backend/API   | yyyy-mm-dd | 2025-02-18 |

When reading from inputs to send to API: convert `dd/mm/yyyy` → `yyyy-mm-dd`.

When populating inputs from API: convert `yyyy-mm-dd` → `dd/mm/yyyy` or use `fp.setDate(isoStr)`.

---

## 9. Checklist when adding/modifying date inputs

1. [ ] Ensure Flatpickr CSS and JS are loaded on the page.
2. [ ] Use `type="text"` and class `flatpickr-date` (or equivalent) on the input.
3. [ ] Use `dateFormat: 'd/m/Y'` in all Flatpickr configs.
4. [ ] Initialise Flatpickr on static inputs in the module init.
5. [ ] Initialise Flatpickr on dynamic inputs after they are added to the DOM.
6. [ ] When sending to API: convert dd/mm/yyyy → yyyy-mm-dd if required.
7. [ ] When loading from API: convert yyyy-mm-dd → dd/mm/yyyy or use `setDate(isoStr)`.
