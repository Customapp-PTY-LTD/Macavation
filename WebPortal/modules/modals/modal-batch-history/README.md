# Modal: Batch History

Read-only batch audit: kernel dispatches, grower intake (checklist + samples), production days + job card, and end sample (QA). Opened from **Batch Journey** (row click) or **Kernel Production** (batch history control).

## Instructions / Source

- **Behaviour**: `js/modal_batch_history.js` (`_modal_batch_history.show`).
- **UI**: `html/modal_batch_history.html` — tabs **Dispatch**, **Intake**, **Production**, **End sample (QA)**; timeline panes per tab; status badge in the summary row.
- Container ID: `#batchHistoryModal`. Route name: `batch-history-modal`.
