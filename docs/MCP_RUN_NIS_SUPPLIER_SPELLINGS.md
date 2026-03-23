# MCP: apply NIS supplier official spellings (contacts + kernel)

Run this migration on Supabase so **contacts** (`nis_supplier`) and **kernel** `grower_name` match the official supplier list (e.g. Familie, Empirestate, Dougvale, Uluhlata, Sharwan Singh, Nombhaba, Nseze, Ropa Miller; Supplier #55 **Big 5 Mac**).

**File:** `migrations/20260341000001_kernel_nis_supplier_official_spellings.sql`

## Cursor MCP (Supabase)

Use **Supabase MCP** → **apply_migration** with:

- **name:** `kernel_nis_supplier_official_spellings`
- **query:** paste the full contents of `migrations/20260341000001_kernel_nis_supplier_official_spellings.sql`

Or run the same SQL in the Supabase SQL Editor.

**Rename Supplier #55 (if DB still has “Big Five Mac”):** `migrations/20260341000002_rename_big_five_mac_to_big_5_mac.sql` (name: `rename_big_five_mac_to_big_5_mac`).

Seeds in repo (`20260316000001`, `20260316000002`, `NIS_suppliers.json`, CRM order) are already aligned for new installs.
