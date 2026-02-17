# Modal: Batch Summary

This module provides the **Batch Summary** modal (tallied from all days).

## Instructions / Source

- **Behaviour and logic** (opening, loading data) are in:
  - `modules/kernel-production/js/kernel_production_stages.js` (e.g. `showBatchSummary()`).
- Container ID: `#batchSummaryModal`. Route name: `batch-summary-modal`.
- This module supplies HTML (and optional CSS/JS). The parent/stages module opens and populates it.

## Structure

- `html/` – Modal content.
- `css/` – Optional styles.
- `js/` – Optional; no init required (opened from Production Stages modal).
