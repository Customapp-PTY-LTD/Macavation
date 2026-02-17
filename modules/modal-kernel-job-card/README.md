# Modal: Kernel Job Card

This module provides the **Kernel Production Job Card** modal (HTML, optional CSS, and a small JS bootstrap).

## Instructions / Source

- **Behaviour and logic** for this modal are implemented in the parent module:
  - `modules/kernel-production/js/kernel_production_job_card.js`
- The parent grid loads this modal’s HTML into the empty container via the app router, then calls `_kernelProductionJobCard.init()` (either from this module’s JS or from the grid after all modals are loaded).
- Container ID: `#kernelJobCardModal`. Route name: `kernel-job-card-modal`.

## Structure

- `html/` – Modal content only (modal-dialog and contents; outer `.modal` is the parent’s container).
- `css/` – Optional modal-specific styles.
- `js/` – Optional script that may call the kernel-production job card init when this modal is loaded.
