-- Originally dropped release_kernel_to_production(uuid, integer[]) intending to keep the
-- single-argument overload. After 20260314000002_consolidate_release_kernel_to_production,
-- that was the ONLY signature — so the old DROP removed the function entirely on UAT.
-- No-op: restore is handled by 20260625120000_restore_release_kernel_to_production.sql.

SELECT 1;
