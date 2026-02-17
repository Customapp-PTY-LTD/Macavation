# Modal Pattern Instructions — BrokerPortal

This document describes how modals are wired in this project using **empty modal containers** in the parent HTML and the **app router** to inject a separate module’s HTML/JS into that container. The `modal_add_contact` module is the reference for the classic flow; **Kernel Production** is the reference for the **route-only** pattern (parent only routes to modals; no modal controllers in the parent).

---

## 1. Overview

- The **parent page** (e.g. contacts tab, kernel-production grid) owns an **empty** `<div>` that will act as the Bootstrap modal container.
- The modal’s **content and behaviour** live in their own **module** (own HTML + JS, registered in the app router). **The parent must not contain modal controllers**—only the modal module owns modal logic.
- When the parent initializes, it asks the app router to **load** that module’s HTML (and JS) **into** the modal container.
- When the user opens the modal, the parent **routes** to the modal: it calls the modal’s API (e.g. `init()`, `show(id)`) and the modal does the rest (binding, showing the Bootstrap modal, loading data, saving).

So: **container in parent HTML** + **route name** → **app router** loads the **modal module** into that container. **Parent only routes; modal does the rest.**

---

## 2. Reference: `modal_add_contact` Flow

### 2.1 Where the modal container lives

The modal **container** is a **placeholder** in the **parent** HTML. It is empty and has a `route-name` that matches a route in `appRouteConfig.json`.

**Example — `modules/client_details_page/html/contacts.html`:**

```html
<!-- Add Contact Modal Container -->
<div class="modal fade" data-bs-backdrop="static" data-bs-keyboard="false"
     id="modal_add_contact"
     role="dialog"
     route-name="modal_add_contact"
     tabindex="-1"
     aria-labelledby="addContactModalLabel"
     aria-hidden="true"></div>
```

- **Same ID as route name** here (`modal_add_contact`) for simplicity; the only requirement is that the **`route-name`** attribute matches the route key in `appRouteConfig.json`.
- The **content** of this div is empty. The app router will replace its contents with the modal module’s HTML and load the module’s JS.

### 2.2 Triggering the app router to load the modal module

The parent module’s JS must call `_appRouter.loadContent()` so that the modal route’s HTML (and JS) are loaded **into** that container. Two patterns are used in this project.

**Pattern A — Scan all modals with `route-name` (used in contacts, email, sms, etc.):**

```javascript
$('.modal[route-name]').each((index, el) => {
    const routeName = $(el).attr('route-name');
    const elementSelector = '#' + $(el).attr('id');
    _appRouter.loadContent({
        routeName,
        elementSelector
    });
});
```

- Runs once when the parent module initializes (e.g. when the Contacts tab is loaded).
- Every modal in the page that has a `route-name` gets its route loaded into the corresponding `#id` container.

**Pattern B — Explicit load for one modal (e.g. in expanded_contacts):**

```javascript
_appRouter.loadContent({
    elementSelector: '#modal_add_contact',
    routeName: 'modal_add_contact'
});
```

- Use when you want to load only this modal’s route, or when the modal is not in the same DOM scope as other modals.

In both cases, the **modal container** (in the parent HTML) **triggers** the app router to open its **own module**: the router injects that module’s HTML into the container and runs its JS.

### 2.3 Opening the modal from the parent

After content is loaded, the parent opens the modal by:

1. Calling the modal module’s `init()` (with any parameters the modal needs).
2. Showing the Bootstrap modal on the container element.

**Example — from `modules/client_details_page/js/contacts.js` and `modules/expanded_contacts/js/expanded_contacts.js`:**

```javascript
$('#btnAddContact').off('click').on('click', function () {
    _modal_add_contact_details.init();           // optional: init(); or init({ ... params })
    $('#modal_add_contact').modal('show');
});
```

Edit mode example (with params):

```javascript
_modal_add_contact_details.init({
    contactData: scope.contacts,
    contactGUID: selectedContactGUID
});
$('#modal_add_contact').modal('show');
```

So: **parent** owns the **button** and the **modal container**; **modal module** owns **content** and **logic**, and exposes **`init()`** for the parent to call before **`$('#…').modal('show')`**.

---

## 3. Route-only pattern: Kernel Production

For pages that open many modals (e.g. kernel-production), the **parent JS must not contain any modal controllers**. The parent’s only job is to **route** to the correct modal; the modal module owns all behaviour (init, show, load data, save, hide).

### 3.1 What lives where

| Responsibility | Parent (e.g. kernel-production) | Modal module |
|----------------|----------------------------------|--------------|
| Empty modal container in HTML | ✓ | — |
| Load modal route into container (`loadContent`) | ✓ | — |
| Call modal `init()` after modals loaded | ✓ (once) | — |
| Handle button/link click | ✓ (get `batchId` / `id` from DOM) | — |
| **Open modal** | ✓ Call e.g. `_modal_xyz.show(batchId)` | Modal’s `show()` does the rest |
| Modal logic (bind events, load data, save, hide) | **✗ Must not** | ✓ |

### 3.2 Parent JS: load modals, then init modals only

In the parent’s init, load every modal container by `route-name`, then call each modal’s `init()` (if it has one) so it can bind its own buttons. **Do not** put modal logic (e.g. “show job card for batch”, “save end sample”) in the parent.

```javascript
$('.modal[route-name]').each((index, el) => {
    const routeName = $(el).attr('route-name');
    const elementSelector = '#' + $(el).attr('id');
    if (routeName && elementSelector && _appRouter.loadContent) {
        loadPromises.push(_appRouter.loadContent({ routeName, elementSelector }));
    }
});
Promise.all(loadPromises).then(() => {
    if (typeof _modal_production_stages !== 'undefined' && _modal_production_stages.init) _modal_production_stages.init();
    if (typeof _modal_kernel_job_card !== 'undefined' && _modal_kernel_job_card.init) _modal_kernel_job_card.init();
    if (typeof _modal_end_sample !== 'undefined' && _modal_end_sample.init) _modal_end_sample.init();
    // ... other modal inits, and non-modal inits (e.g. batch actions for New Batch button)
});
```

### 3.3 Parent JS: opening a modal = route to the modal

When the user clicks “Job Card”, “End sample”, “Batch history”, etc., the parent only reads the context (e.g. `data-batch-id`, `data-job-card-id`) and calls the modal’s API. The modal shows itself and does all work.

```javascript
$(document).on('click', '.js-job-card-batch', function (e) {
    e.preventDefault();
    const batchId = $(this).data('batch-id');
    const jobCardId = $(this).data('job-card-id');
    if (jobCardId && typeof _modal_job_card_view !== 'undefined' && _modal_job_card_view.show) {
        _modal_job_card_view.show(jobCardId);
    } else if (batchId && typeof _modal_kernel_job_card !== 'undefined' && _modal_kernel_job_card.showJobCardModalForBatch) {
        _modal_kernel_job_card.showJobCardModalForBatch(batchId);
    }
});

$(document).on('click', '.js-end-sample-batch', function (e) {
    e.preventDefault();
    const batchId = $(this).data('batch-id');
    const packingSampleId = $(this).data('packing-sample-id');
    if (packingSampleId && typeof _modal_end_sample_view !== 'undefined' && _modal_end_sample_view.show) {
        _modal_end_sample_view.show(packingSampleId);
    } else if (batchId && typeof _modal_end_sample !== 'undefined' && _modal_end_sample.show) {
        _modal_end_sample.show(batchId);
    }
});

$(document).on('click', '.js-batch-history', function (e) {
    e.preventDefault();
    const batchId = $(this).data('batch-id');
    if (batchId && typeof _modal_batch_history !== 'undefined' && _modal_batch_history.show) {
        _modal_batch_history.show(batchId);
    }
});

$(document).on('click', '.js-production-batch', function (e) {
    e.preventDefault();
    const batchId = $(this).data('batch-id');
    if (batchId && typeof _modal_production_stages !== 'undefined' && _modal_production_stages.showProductionStagesModalForBatch) {
        _modal_production_stages.init(); // ensure bindings
        _modal_production_stages.showProductionStagesModalForBatch(batchId);
    }
});
```

### 3.4 Parent route config: no modal controller scripts

The parent route (e.g. `kernel-production-grid`) should **not** load JS files that only wrap or duplicate modal behaviour. Load only the parent’s own scripts (grid, stages, batch actions for non-modal behaviour). Modal scripts are loaded when the app router injects each modal’s route into its container.

**Example — `appRouteConfig.json` for kernel-production:**

```json
"kernel-production-grid": {
    "path": "kernel-production",
    "html": "html/kernel_production_grid.html",
    "js": [
        "js/kernel_production_grid.js",
        "js/kernel_production_batch_actions.js"
    ],
    "css": ["css/kernel_production_grid.css"]
}
```

No modal controller scripts in the parent route: no `kernel_production_job_card.js`, `kernel_production_end_sample.js`, or `kernel_production_stages.js`. Those behaviours live in the modal modules (`modal-kernel-job-card`, `modal-end-sample`, `modal-production-stages`, etc.); the router loads each modal’s HTML/JS when it injects that modal’s route into its container.

---

## 4. Steps to Add a New Modal (Checklist)

### 4.1 Create the modal module (content + behavior)

- **Folder:** e.g. `modules/my_modal/`.
- **HTML:** `html/my_modal.html`
  - Contains only the **inner** structure: typically a single root that is the **modal-dialog** (and its contents). Do **not** wrap this in an outer `<div class="modal">`; the parent already provides the `.modal` container.

**Example — `modules/modal_add_contact/html/modal_add_contact.html` starts with:**

```html
<div class="modal-dialog modal-dialog-centered modal-lg modal-dialog-scrollable" ...>
    <div class="modal-content">
        <div class="modal-header">...</div>
        <div class="modal-body">...</div>
        <div class="modal-footer">...</div>
    </div>
</div>
```

- **JS:** `js/my_modal.js`
  - Expose a global (e.g. `_my_modal`) with at least:
    - `init(params)` — called by the parent before showing; use for one-time setup, binding handlers, and pre-filling when opening (e.g. edit mode).
    - Use the **same id** for the modal container in `$('#modal_add_contact').modal('show')` / `$('#…').modal('hide')` so the parent and modal agree on the same DOM node.

### 4.2 Register the route

In **`js/appRouteConfig.json`**, add an entry whose key is the **route name** you will use in `route-name` and in `loadContent`:

```json
"my_modal": {
    "description": "My modal",
    "path": "my_modal",
    "html": "html/my_modal.html",
    "js": ["js/my_modal.js"],
    "css": []
}
```

- **path:** module folder path under `modules/`.
- **html / js:** paths relative to that folder. The router will load this HTML into the container and then load this JS.

### 4.3 Add the modal container in the parent HTML

In the HTML of the **page that will open the modal** (e.g. a tab or section that’s loaded into the main layout), add an **empty** modal container with a unique `id` and the same **route-name** as in `appRouteConfig.json`:

```html
<div class="modal fade" data-bs-backdrop="static" data-bs-keyboard="false"
     id="my_modal"
     role="dialog"
     route-name="my_modal"
     tabindex="-1"
     aria-labelledby="myModalLabel"
     aria-hidden="true"></div>
```

- The **app router** will inject the modal module’s HTML **inside** this div. So this div is the Bootstrap `.modal`; the injected content is the `.modal-dialog` and below.

### 4.4 Load the modal module into the container (parent JS)

In the **parent module’s** `init()` (or equivalent), ensure the router loads the modal route into that container. Either:

- Use **Pattern A** so this modal is picked up automatically:

  ```javascript
  $('.modal[route-name]').each((index, el) => {
      const routeName = $(el).attr('route-name');
      const elementSelector = '#' + $(el).attr('id');
      _appRouter.loadContent({ routeName, elementSelector });
  });
  ```

- Or use **Pattern B** for this modal only:

  ```javascript
  _appRouter.loadContent({
      elementSelector: '#my_modal',
      routeName: 'my_modal'
  });
  ```

So: **modal container in parent HTML** + **parent JS calling loadContent with that container and route name** = app router opens the modal’s **own module** inside the container.

### 4.5 Open the modal from the parent

Where you handle the button/link that should open the modal:

```javascript
$('#btnOpenMyModal').on('click', function () {
    if (typeof _my_modal !== 'undefined' && _my_modal.init) {
        _my_modal.init({ /* optional params */ });
    }
    $('#my_modal').modal('show');
});
```

Use the **same** `#id` you used for the container in the parent HTML.

### 4.6 Close the modal from inside the modal module

In the modal’s JS, use the same container id:

```javascript
$('#my_modal').modal('hide');
```

You can also clear form state in the modal before or after hide, as in `modal_add_contact` (e.g. `clearModal()` then `$('#modal_add_contact').modal('hide')`).

---

## 5. How `loadContent` Works (summary)

- **`_appRouter.loadContent({ routeName, elementSelector })`** (in `js/appRouter.js`):
  1. Looks up `routeName` in `_appRouter.routeConfig` (from `appRouteConfig.json`).
  2. Loads the route’s CSS (if any).
  3. Fetches the route’s HTML from `basePath/path/html`.
  4. Replaces `{basePath}` in the HTML with the resource path.
  5. Sets the content of `elementSelector` to that HTML: **`$(elementSelector).html(content)`**.
  6. Loads the route’s JS from `basePath/path/js`.
  7. Applies permissions after a short delay.

So the **modal container** (the element selected by `elementSelector`) is the **target** into which the **modal module** is loaded; the modal container in the HTML is what **triggers** the app router to load that module.

---

## 6. Important details

- **One container, one route:** Each modal container div should have a single `route-name`. The router injects one module’s HTML into that div.
- **Modal HTML = inner content only:** The module’s HTML should be the **modal-dialog** (and children). The outer **`.modal`** wrapper is the parent’s container div.
- **ID consistency:** The same id (e.g. `modal_add_contact`) must be used in: (1) parent HTML container, (2) parent’s `loadContent` (if using explicit selector), (3) parent’s `$('#…').modal('show')`, (4) modal JS’s `$('#…').modal('hide')` and any DOM queries inside the modal that assume they’re inside that container.
- **When content is loaded:** Modal HTML/JS are loaded when the parent runs `loadContent` (e.g. when the tab or page that contains the modal container is initialized). The modal’s script runs once when loaded; use `init()` for per-open setup.
- **No modal controllers in the parent:** For any page that opens modals, do **not** add JS in the parent that duplicates or “wraps” modal behaviour (e.g. “show job card”, “save end sample”). The parent should only: (1) load modal content via `loadContent`, (2) call the modal’s `init()` after load if needed, (3) on user action, call the modal’s API (e.g. `_modal_xyz.show(id)`). The modal module owns all logic. See **§3 Route-only pattern**.
- **Other modals in this project:** The same pattern is used for `addemail-modal`, `addsms-modal`, `modal_add_document`, `addwhatsapp-modal`, `quote-comparison-request-modal`, and the Kernel Production modals (`modal-production-stages`, `modal-kernel-job-card`, `modal-job-card-view`, `modal-end-sample`, `modal-end-sample-view`, `modal-batch-history`, `modal-batch-summary`, `modal-production-stages-view`). You can reuse the same approach for any new modal.

---

## 7. Quick reference: files involved for `modal_add_contact`

| Role | File |
|------|------|
| Route config | `js/appRouteConfig.json` → key `"modal_add_contact"` |
| Modal content (inner HTML) | `modules/modal_add_contact/html/modal_add_contact.html` |
| Modal logic | `modules/modal_add_contact/js/modal_add_contact.js` → `_modal_add_contact_details` |
| Container + trigger | Parent HTML, e.g. `modules/client_details_page/html/contacts.html` → `<div id="modal_add_contact" route-name="modal_add_contact">` |
| Load into container | Parent JS, e.g. `modules/client_details_page/js/contacts.js` → `$('.modal[route-name]').each(...)` or explicit `loadContent` |
| Open modal | Parent JS → `_modal_add_contact_details.init(); $('#modal_add_contact').modal('show');` |

### 7.1 Quick reference: Kernel Production (route-only)

| Role | File / action |
|------|----------------|
| Route config (parent) | `js/appRouteConfig.json` → `"kernel-production-grid"` — only `kernel_production_grid.js` and `kernel_production_batch_actions.js`; **no** modal controller scripts |
| Modal containers | `modules/kernel-production/html/kernel_production_grid.html` — empty `<div class="modal" route-name="…">` per modal (e.g. `production-stages-modal`, `kernel-job-card-modal`, `end-sample-modal`, `batch-history-modal`) |
| Load + init | `kernel_production_grid.js` → `$('.modal[route-name]').each(...)` then `Promise.all(loadPromises).then(() => { _modal_production_stages.init(); _modal_kernel_job_card.init(); _modal_end_sample.init(); _kernelProductionBatchActions.init(); })` |
| Open modal | Grid bindings call modal globals only: `_modal_production_stages.showProductionStagesModalForBatch(batchId)`, `_modal_job_card_view.show(jobCardId)`, `_modal_kernel_job_card.showJobCardModalForBatch(batchId)`, `_modal_end_sample.show(batchId)`, `_modal_end_sample_view.show(packingSampleId)`, `_modal_batch_history.show(batchId)` |
| Modal logic | Each modal owns its logic in its own module: `modules/modal-production-stages/js/`, `modules/modal-kernel-job-card/js/`, `modules/modal-end-sample/js/`, `modules/modal-batch-history/js/`, etc. **No** duplicate logic in `modules/kernel-production/js/`. |

### 7.2 Lessons learned (Kernel Production refactor)

- **One modal = one module.** Each modal (Production stages, Job card, End sample, Batch history, etc.) is a separate module under `modules/` with its own `html/`, `js/`, `css/`. The parent page does **not** have a matching “controller” file (e.g. we removed `kernel_production_stages.js` and moved its logic into `modules/modal-production-stages/js/modal_production_stages.js`).
- **Parent only routes.** The grid reads `data-batch-id` (or similar) from the clicked element and calls the modal’s API (e.g. `_modal_production_stages.showProductionStagesModalForBatch(batchId)`). The modal then loads data, fills the form, shows the Bootstrap modal, and handles save/close.
- **Modal script runs when its route is loaded.** When the router injects a modal’s HTML into its container, it also loads that modal’s JS. So `_modal_production_stages` exists after the production-stages modal route has been loaded. The parent calls each modal’s `init()` after `Promise.all(loadPromises)` so that bindings (e.g. Save button, day list clicks) are attached to the injected DOM.

Using this, you can mimic the way modals are used in this project: **modal container in the HTML** → **app router loads the modal’s own module into that container** → **parent routes to the modal** (calls `init()` and/or `show(id)`; modal does the rest). For pages with many modals, follow **§3 Route-only pattern**: parent JS must not contain modal controllers—only route to the modal’s global (e.g. `_modal_batch_history.show(batchId)`).
