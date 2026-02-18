# Modal: Production Stages

This module provides the **Production Stages** modal (Cracking, Washing, Sorting, Packing, Summary).

## Instructions / Source

- **Behaviour and logic** are implemented in:
  - `modules/kernel-production/js/kernel_production_stages.js`
- The parent grid loads this modal’s HTML into the container, then calls `_kernelProductionStages.init()` (from this module’s JS or from the grid after modals load).
- Container ID: `#productionStagesModal`. Route name: `production-stages-modal`.

## Structure

- `html/` – Modal content (modal-dialog and contents).
- `css/` – Optional styles.
- `js/` – Optional bootstrap that calls the stages init when this modal is loaded.
