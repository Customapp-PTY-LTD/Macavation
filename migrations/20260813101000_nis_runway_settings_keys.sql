-- Document the two dashboard_targets metric keys that drive the raw-material runway forecast.
--
-- No DDL and no seed rows, deliberately. get_nis_runway_forecast reads its depletion rate from
-- these keys, and the existing Dashboard Targets admin grid already renders metric_key as a
-- free-text input (WebPortal/modules/dashboard-targets/js/dashboard-targets_grid.js:102), so both
-- are editable today with no UI change and no new write RPC -- upsert_dashboard_target already
-- exists with write-RBAC scoped to super_user/admin/General Manager/Production Manager/Oil Plant
-- Manager (20260602110000_dashboard_targets.sql:152-170).
--
-- WHY NOTHING IS SEEDED: the rate is a judgement about which month's cracking capture is
-- trustworthy, and no migration can make that judgement. On production today May 2026 looks like
-- the right basis (52% of its day-rows carry tonnage, giving 2,333 kg/day) while June 2026 would
-- give 420 kg/day off 25% capture -- but that is a fact about current data quality, not a default
-- worth freezing into the schema. With neither key set, the forecast card shows the stock level and
-- prompts for a basis month, which is the correct first-run state.
--
--   nis_rate_basis_month       YYYYMM as a number, e.g. 202605. The rate is recomputed live as
--                              (total kg cracked that month / calendar days in that month), so it
--                              improves automatically as that month's capture improves.
--
--   nis_crack_rate_kg_per_day  A flat kg-per-CALENDAR-day figure typed by a human. Overrides
--                              nis_rate_basis_month, so the data can always be overruled outright.
--
-- Both use period_type 'daily' and division 'kernel'. 'daily' is used even for the basis month
-- because the table's period_type CHECK (20260602110000_dashboard_targets.sql:11) is a fixed list
-- and altering a constraint to carry a label would be a worse trade than a slightly loose one.

COMMENT ON TABLE public.dashboard_targets IS
  'Editable KPI targets and forecast assumptions, keyed by metric_key and effective-dated via '
  'effective_from. Read with get_dashboard_targets(), written with upsert_dashboard_target(). '
  'Beyond KPI targets this also carries the raw-material runway assumptions consumed by '
  'get_nis_runway_forecast: nis_rate_basis_month (YYYYMM of the month whose cracking throughput '
  'sets the depletion rate, recomputed live) and nis_crack_rate_kg_per_day (a flat kg per calendar '
  'day typed by a human, which overrides the basis month). Neither is seeded: with both absent the '
  'forecast deliberately declines to project and asks the user to choose a basis month, because '
  'cracking capture is too sparse for an automatic average to be meaningful. See '
  'docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md.';

NOTIFY pgrst, 'reload schema';
