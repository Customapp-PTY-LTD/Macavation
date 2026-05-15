# Macavation `public.oil` Table — Field Reference

This document describes **all columns** in the `public.oil` table on the Macavation Supabase project, as returned by the Supabase MCP. It explains what each field accepts and what typically goes there.

**Source:** Supabase MCP `list_tables` (verbose) for project Macavation  
**RLS:** Enabled  
**Row count (at time of snapshot):** 4  
**Primary key:** `id`  
**Unique constraint:** `batch_id`  
**FK:** `public.silo.oil_batch_id` → `public.oil.id`

---

## Scalar columns

| Column | Type | Nullable | Default | What it accepts / What goes there |
|--------|------|----------|---------|-----------------------------------|
| **id** | `uuid` | No | `gen_random_uuid()` | Primary key. One UUID per oil batch; auto-generated. |
| **batch_id** | `character varying` | No | — | **Unique** human-readable batch identifier (e.g. `OIL-2026-03-001`). Used in grids and as the main reference. No FK to `batches`; this is a standalone string. |
| **production_date** | `date` | Yes | — | Date of production. Any valid `date`; can be `NULL`. |
| **status** | `character varying` | Yes | — | Workflow stage. Typical values: `intake`, `awaiting_test` (default for new batches from Supplier Intake), `production`, `stock`, `dispatch`, `complete`. No DB CHECK in live schema; app controls allowed values. |
| **total_oil_litre** | `numeric` | Yes | — | Total oil volume in litres (e.g. sum of IBC litres). Used for quick grid display. |
| **is_active** | `boolean` | Yes | `true` | Soft-delete flag. `false` = hidden from normal lists. |
| **created_by** | `uuid` | Yes | — | User who created the row (e.g. `auth.users.id` or `users.id`). Set by `upsert_oil_batch` when provided. |
| **created_at** | `timestamp with time zone` | Yes | `now()` | Row creation timestamp. |
| **updated_by** | `uuid` | Yes | — | User who last updated the row. |
| **updated_at** | `timestamp with time zone` | Yes | `now()` | Last update timestamp. |
| **silos** | `integer[]` (ARRAY) | Yes | — | **Comment in DB:** "Silo numbers (1-12) where this batch was placed when sent to production." Array of small integers, e.g. `{1, 3, 5}`. |

---

## Stage completion timestamps

| Column | Type | Nullable | What it accepts / What goes there |
|--------|------|----------|-----------------------------------|
| **intake_completed_at** | `timestamp with time zone` | Yes | When the intake/receiving stage was completed. |
| **production_completed_at** | `timestamp with time zone` | Yes | When production was completed. |
| **stock_completed_at** | `timestamp with time zone` | Yes | When the batch was put to stock. |
| **dispatch_completed_at** | `timestamp with time zone` | Yes | When dispatch was completed. |

---

## JSONB columns

All four are nullable. Structures are defined in **`docs/markdown-archive/jsonb-oil-structure-guide.md`**. Summary:

| Column | What it accepts / What goes there |
|--------|-----------------------------------|
| **intake_data** | Supplier intake: `date_received`, `delivery_note_reference`, `supplier`, `items[]` (PO ref, description, batch, quantity, dates), `vehicle_checks` (booleans), optional `available_batch_numbers[]`. |
| **production_data** | Production details: `batch_number_product_produced`, `name_of_product`, `oil_bins[]`, `oil_bin_details[]`, `raw_materials[]`, `recipe`, `waste`, `gmp_checklist`, optional `protein_details`. Also `shift_supervisor`, `shift` for display in `get_oil_batches`. |
| **stock_data** | Stock and QA: `location`, `bin_location`, `quantity_available`, `reserved`, `qa_tests` (ffa, moisture, peroxide, lab results, sign-offs, PDF URL), optional `sensory_evaluation`. |
| **dispatch_data** | Dispatch: `orders[]` with `order_id`, `customer`, `dispatch_date`, and `lines[]` of `style` and `quantity_kg`. |

---

## Indexes (from migrations)

- Unique index on `batch_id`
- Index on `status`
- Index on `production_date`
- Index on `is_active`

---

## Summary

- **19 columns** total: 11 scalars (including `silos`), 4 stage timestamps, 4 JSONB blobs.
- **Identifiers:** `id` (PK), `batch_id` (unique business key).
- **Workflow:** `status` + the four `*_completed_at` timestamps.
- **Flexible data:** `intake_data`, `production_data`, `stock_data`, `dispatch_data` hold stage-specific payloads; see the JSONB guide for full shapes.
- **Audit:** `created_by`, `created_at`, `updated_by`, `updated_at`.
- **Optional:** `silos` (integer array) for silo assignment when sent to production.

For full JSONB field-level definitions, see **`docs/markdown-archive/jsonb-oil-structure-guide.md`**.
