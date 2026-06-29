# Kernel historical import — runbook

Phase 2 Epic: load ~2 years of abbreviated operational data from Pete before dashboard KPIs and runway metrics are signed off.

**Related:** [`PETE_HISTORICAL_DATA_TEMPLATE.md`](PETE_HISTORICAL_DATA_TEMPLATE.md) · migration `20260403000001_import_historical_kernel_batch.sql`

---

## Prerequisites

1. Pete CSV/Excel using columns in the template (one row per completed kernel batch).
2. UAT migration applied: `npm run db:apply -- migrations/20260403000001_import_historical_kernel_batch.sql`
3. CRM contacts include grower/supplier names referenced in Pete rows (or names will be stored as text on import).

---

## Import steps (portal)

1. Sign in to the Web Portal on UAT as a user with **Stock** access.
2. Open **Kernel pipeline → Stock on hand** (or route `stock-management-kernel`).
3. Enable **Adjust Stock** if adding batches that are not yet visible on the By style grid.
4. Click **Import historical kernel data** (toolbar).
5. For each Pete row:
   - Enter or select batch number, grower/supplier, received date, style quantities (kg or cartons × 11.34).
   - Submit — the RPC creates a completed batch in finished stock without running production stages.
6. After bulk import, open **Find a batch** and spot-check 5–10 batches against Pete source.

---

## Bulk import (CLI)

For large files, generate SQL or call the RPC in a loop:

```bash
node scripts/import-historical-kernel-from-csv.js path/to/pete-kernel-batches.csv
```

Review output before applying to UAT. Never run against production unless explicitly requested.

---

## Sign-off checklist

- [ ] Pete template columns confirmed with Macavation / Pete
- [ ] Kernel batches imported (target: 24 months)
- [ ] Spot-check: batch numbers, style totals, grower names
- [ ] `get_dashboard_data_audit` (or executive dashboard trends) shows expected volume
- [ ] Optional: oil SOH snapshot import (see `20260410120000_seed_oil_stock_soh_ye25_xlsx.sql` pattern)
- [ ] Optional: procurement schedule rows in Grower Intake calendar

---

## Oil and procurement (optional)

| Data | Status | Notes |
|------|--------|-------|
| Oil SOH snapshot | Manual seed or stock Adjust | No `import_historical_oil_*` RPC yet — use Stock oil Adjust or seed migration pattern |
| Procurement history | Grower Intake calendar | Add rows manually or extend CSV script to `kernel_intake_procurement` |

---

## Troubleshooting

| Issue | Action |
|-------|--------|
| Import button missing | Check role has Stock feature; apply stock migrations on UAT |
| Duplicate batch number | RPC rejects or updates depending on migration version — use unique Pete batch numbers |
| Dashboard trends flat | Historical batches need `production_finished_at` / received dates in import range |
| Runway shows null | Ensure kernel production forecast grid has open demand rows |

---

## After import

1. Run live data audit: Admin or `getDashboardDataAudit()` diagnostic.
2. Label executive dashboard widgets **provisional** until Macavation sign-off.
3. Capture Playwright user-guide screenshots if stock import UI changed.
