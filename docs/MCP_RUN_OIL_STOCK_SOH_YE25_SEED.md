# Seed oil stock from YE'25 SOH Excel (`20260410120000_seed_oil_stock_soh_ye25_xlsx.sql`)

## What it does

One-time (re-runnable) load of **`public.oil_stock_lots`** from **Macadamia Oil SOH and Production Figures YE'25 (12).xlsx**:

| Source sheet | Location | Category | Status | Notes |
|--------------|----------|----------|--------|--------|
| **FG SOH - 850** | 850 | `finished_good` | `on_hand` | Batch-level finished oil (EV, crude cosmetic, etc.) |
| **Sold** | 850 | `sold` | `sold` | Historical dispatched lines (customer, PO ref, dates where present) |
| **RM SOH - 801** | 801 | `raw_material` | `on_hand` | Supplier breakdown under each ZRN* product (no batch # in pivot) |
| **PROTEIN POWDER SOH** | 850 | `finished_good` | `on_hand` | Two SOH lines; grade `Protein powder (A grade)` so the Stock UI routes to the protein table |

**Not imported** (no batch-level stock rows): **YE'25 Production**, **YE'26 Production**, **Forecast**, pivot-only blocks.

**Idempotency:** deletes rows where `notes = 'SOH YE25 xlsx seed v1'`, then inserts. Re-applying clears and reloads only those seeded rows.

## Apply with Supabase MCP

1. Run migration SQL via **`apply_migration`** (or SQL Editor), file:

   `migrations/20260410120000_seed_oil_stock_soh_ye25_xlsx.sql`

2. No new functions or tables; **PostgREST reload is optional** (data-only).

3. Confirm in the app: **Stock (Oil)** — oil vs protein tables and weekly/overview as usual.

## Regenerating from an updated workbook

On a machine with **Microsoft Excel** installed:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\generate_oil_soh_ye25_migration.ps1" -XlsxPath "C:\path\to\workbook.xlsx"
```

Default `-XlsxPath` is `%USERPROFILE%\Downloads\Macadamia Oil SOH and Production Figures YE'25 (12).xlsx`.
