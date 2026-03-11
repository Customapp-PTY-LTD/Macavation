# Fix Executive Dashboard stats (most showing 0) via Supabase MCP

When **get_dashboard_production_stats** or its tables (oil_production_sheets, quality_tests, production_batches) are missing, the Executive Dashboard shows zeros for Awaiting test, Release ready, In intake, Oil, Quality, Dispatch, On hold. This doc fixes that and wires **Total Production (kg)** from kernel data.

Run against the **same Supabase project** your app uses.

---

## Option A: Supabase MCP (recommended)

Run **two steps** with the MCP **execute_sql** tool.

### Step 1 – Harden get_dashboard_production_stats (optional tables no longer break it)

Run the full contents of **migrations/20260328000001_dashboard_production_stats_defensive.sql**.  
That migration replaces the function so that:

- **Kernel** stats (awaiting test, release ready, completed this week, in intake) always run.
- **Dispatch** (dispatch this week, dispatch pending) always run if `kernel_dispatch_orders` exists.
- **Oil**, **quality_tests**, **production_batches** are wrapped in exception handlers: if the table is missing, that metric returns 0 and the rest still return.

After this, pipeline and dispatch stats will show real numbers from `kernel` and `kernel_dispatch_orders`; oil/quality/on-hold show 0 until those tables exist.

### Step 2 – Total Production (kg) from kernel packing data

Run **migrations/20260328000002_executive_kpis_total_production_kg.sql**.  
This updates **get_executive_kpis** so **total_production_kg** = sum of packed kg from all `kernel.packing_data` entries (same logic as dashboard packed stats). Total Sales and Quality Pass Rate stay 0 until wired to sales/quality data.

---

## Option B: Supabase SQL Editor

Run in order:

1. **migrations/20260328000001_dashboard_production_stats_defensive.sql**
2. **migrations/20260328000002_executive_kpis_total_production_kg.sql**

---

## What will show data after this

| Stat | Source | Notes |
|------|--------|--------|
| Total Production (kg) | kernel.packing_data | Sum of packed kg (Step 2). |
| Active Batches | kernel count | Already fixed (get_executive_kpis). |
| Kernel batches in production | get_dashboard_kernel_stats | Already working. |
| Kg cracked/packed today/week | get_dashboard_kernel_stats | Already working. |
| Awaiting test, Release ready, Completed this week, In intake | kernel | From get_dashboard_production_stats (Step 1). |
| Dispatch this week, Dispatch pending | kernel_dispatch_orders | From get_dashboard_production_stats (Step 1). |
| Oil, Quality, On hold | optional tables | 0 until oil_production_sheets, quality_tests, production_batches exist and are populated. |
| Total Sales (ZAR), Quality Pass Rate (top card) | not wired | Remain 0 until you add sales/quality sources to get_executive_kpis. |

---

## See also

- **docs/MCP_RUN_EXECUTIVE_KPIS_ACTIVE_BATCHES.md** – Active Batches card.
- **docs/MCP_RUN_DASHBOARD_KERNEL_STATS.md** – Kernel batches in production card.
- **docs/MCP_RUN_KERNEL_BATCH_NAMING.md** – kernel_dispatch_orders (required for dispatch stats).
