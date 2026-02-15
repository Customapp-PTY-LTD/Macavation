# Oil & Protein Produce Tracking (Day-of-Work Model)

On the oil and protein side, produce is tracked differently from the kernel side:

1. **Produce coming in** is given a **batch** (Supplier Intake → `supplier_intake_batches` with `batch_number`).
2. The batch is **sent to production** and **linked to a particular day of work** (`oil_production_sheets` = one record per production date/shift).
3. **Oil containers produced** (e.g. oil stock lots) are **linked to the same day of work**.

## Traceability

To find **what produce went into a particular batch of oil**:

1. Look at which **day of work** (production sheet) that oil was produced on.
2. That day’s production sheet lists (or links) the **intake batches** used that day.
3. Those batches are the **produce** that went in.

So: **Oil container → Production day → Batches used that day → Produce.**

## Database

- **`supplier_intake_batches`**
  - `production_day_id` → `oil_production_sheets.id`
  - When a batch is “added to production”, it is linked to a production sheet (day) and `status` is set to `added_to_production`.

- **`oil_production_sheets`**
  - One row per production day (e.g. date + shift).
  - Represents the “day of work”.

- **`oil_stock_lots`** (when used)
  - Can store `oil_production_sheet_id` so each lot/container is linked to the day it was produced.

## Functions

- **`update_supplier_intake_batch_production_day(p_batch_id, p_production_sheet_id)`**  
  Links an intake batch to a production day and sets its status to `added_to_production`.

- **`get_supplier_intake_batches_by_production_day(p_production_sheet_id)`**  
  Returns all intake batches linked to that production day (for “batches used this day” and traceability).

## Frontend (data-functions.js)

- `dataFunctions.updateSupplierIntakeBatchProductionDay(batchId, productionSheetId)`  
  Link a batch to a production day.

- `dataFunctions.getSupplierIntakeBatchesByProductionDay(productionSheetId)`  
  Get batches used on a given production day.
