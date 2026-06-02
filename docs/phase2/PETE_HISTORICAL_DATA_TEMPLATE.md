# Pete historical data — template and sign-off checklist

Phase 2 Epic 1 requires **~2 years of abbreviated historical data** from Pete before dashboards, forecasts, and stock accuracy metrics can be trusted.

**Related ClickUp:** Macavation → **Phase 2** list → Epic 1 → *Collect Pete abbreviated 2-year dataset*

**Related repo:** `migrations/20260403000001_import_historical_kernel_batch.sql`, `WebPortal/js/data-functions.js` (`importHistoricalKernelBatch`)

---

## Scope confirmation (Phase 2)

**In Phase 2 (Word doc + planning):**

- Data accuracy and historical load
- Action-level permissions (modules + buttons)
- Dashboards, targets, analytics
- Stock alerts and shell waste
- Grower intake / procurement / mass balance
- Oil module (search, consolidated batches, lab tests)
- Scheduled email/WhatsApp digest
- Internal messaging inbox

**Out of Phase 2 (Phase 2b / separate backlog):**

- Full CRM pipeline and quotations
- Digital GMP checklist forms (MP02-xx)
- Palladium ERP live integration
- Custom report builder / advanced analytics (proposal Phase 3)

---

## What we need from Pete

Provide **abbreviated** rows — one row per completed kernel batch (or monthly aggregates if batch-level detail is unavailable). Target period: **24 months** ending at go-live month.

### Kernel batches (required for import)

| Column | Required | Notes | Maps to import |
|--------|----------|-------|----------------|
| `batch_number` | Yes | Unique, e.g. `BATCH-2024-03-001` | `p_batch_number` |
| `grower_name` | Yes* | *Or supplier name if linked in CRM | `p_grower_name` |
| `received_date` | Yes | Date NIS received | `p_received_date` |
| `production_finished_at` | No | Defaults from received_date if omitted | `p_production_finished_at` |
| `wet_nis_received_kg` | Recommended | Intake weight | `p_wet_nis_received_kg` |
| `sk_sp_qty` … `sk_6_qty` | Yes | Sound kernel kg by style (cartons × 11.34 if Pete has cartons only) | `p_sk_*` |
| `bt_78_qty`, `bt_high_qty`, `bt_low_qty` | If applicable | Butter grade kg | `p_bt_*` |
| `best_before_date` | No | Job card / QA | `p_best_before_date` |
| `ffa` | No | QA FFA result | `p_ffa` |

**Style keys:** SP, 0, 1, 1S, 4L, 5, 6, 7/8 (as `bt_78`), Butter High Oil, Butter Low Oil.

### Oil stock (if available)

| Column | Required | Notes |
|--------|----------|-------|
| `product_type` | Yes | `oil` / `protein` / raw RM |
| `batch_or_lot_number` | Yes | |
| `quantity` | Yes | Litres (oil) or kg (RM/protein) |
| `as_at_date` | Yes | Snapshot date for SOH |
| `location` | No | Cold room / silo if known |

Reference seed pattern: `migrations/20260410120000_seed_oil_stock_soh_ye25_xlsx.sql`

### Procurement / intake schedule (optional for runway charts)

| Column | Required | Notes |
|--------|----------|-------|
| `scheduled_date` | Yes | |
| `grower_name` | Yes | |
| `predicted_weight_kg` | Yes | |
| `supplier_id` | No | Can match in CRM after import |

Maps to `kernel_intake_procurement` (`migrations/20260601090000_kernel_intake_procurement.sql`).

### Dispatch / sales summary (optional)

Monthly totals by product type and style are enough for trend validation if batch-level dispatch is not available.

---

## Delivery format

1. **Preferred:** Excel or CSV with sheets/tabs per section above.
2. **Naming:** `Macavation_Historical_YYYY-MM-DD.xlsx`
3. **Cartons vs kg:** If Pete supplies cartons, note column header; we convert at **11.34 kg/carton** for kernel styles.
4. **Gaps:** Mark missing months explicitly (empty sheet row or `N/A` column) — do not omit months silently.

---

## Import sign-off checklist

Complete with Pete and Josslyn (stock) / Mark (production) before closing Epic 1.

### Data receipt

- [ ] Pete confirmed **date range** covered (start month → end month)
- [ ] Kernel batch file received and opens without encoding issues
- [ ] Oil SOH snapshot received (or explicitly N/A with reason)
- [ ] Procurement history received (or explicitly N/A)

### Validation (CustomApp)

- [ ] Row count documented: ___ kernel batches, ___ oil lines
- [ ] No duplicate `batch_number` in file
- [ ] Style totals sum to plausible kg per batch (spot-check 5 batches)
- [ ] `import_historical_kernel_batch` dry-run on 3 sample rows in staging
- [ ] Full import run in staging; error log empty or exceptions resolved
- [ ] Stock grid SOH totals match Pete’s abbreviated totals ± agreed tolerance
- [ ] Dashboard kernel stats cross-check (Epic 1 *Live data audit*)

### Business sign-off

- [ ] **Pete:** “Abbreviated historical data is accurate enough for dashboard and trend use.”
- [ ] **Josslyn:** Stock on hand after import matches physical spot-check (sample styles)
- [ ] **Jon / Paul:** Approved to use imported history in production dashboard

### Sign-off record

| Role | Name | Date | Signature / email confirm |
|------|------|------|---------------------------|
| Sales / data owner | Pete | | |
| Stock admin | Josslyn | | |
| General manager | Jon | | |

---

## After sign-off

1. Run production import (kernel first, then oil if template extended).
2. Close ClickUp subtasks: *Collect Pete dataset*, *Kernel historical import runbook*, *Oil/raw historical import*.
3. Proceed to *Live data audit* and *Stock accuracy metric definition*.

---

## Open questions for Pete (first meeting)

1. Is batch-level detail available for the full 24 months, or monthly aggregates only?
2. Which oil products need historical SOH (finished oil, protein, raw RM)?
3. Are shell waste sales tracked separately today (for Epic 4)?
4. Any batches already in Macavation Phase 1 that must **not** be duplicated on import?
