-- Centralise the cracking-kg coalesce and cracking-date parsing expressions that are duplicated,
-- byte-for-byte, across get_dashboard_kernel_stats() (twice), get_production_trends_daily()
-- (twice, plus the same CASE again in its GROUP BY) and get_kernel_mass_balance() (once).
-- These two helpers give that duplication exactly one home so that when the open kg-cracked
-- field question (see docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md) is eventually decided
-- by a human, the change is one line in one function instead of four hand-edits.
--
-- IMPORTANT: this migration does NOT change what is computed. Each helper body below is the
-- exact expression already live today (compare kernel_day_kg against
-- migrations/20260343000001_dashboard_kernel_batches_status_production_only.sql:31-36 and
-- migrations/20260706100000_phase2_implementation_complete.sql:337; compare kernel_day_date
-- against migrations/20260343000001_...sql:45-49). Same coalesce arms, same order
-- (totalqty, then total_qty, then 0). No other field is referenced anywhere in this file.
--
-- These are internal helpers: only ever called from SECURITY DEFINER functions, never exposed
-- as client RPCs. STABLE, not IMMUTABLE — to_date() and text::date depend on the DateStyle GUC,
-- so IMMUTABLE would risk poisoned cached plans.

CREATE OR REPLACE FUNCTION public.kernel_day_kg(p_elem jsonb)
RETURNS numeric
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
      NULLIF(TRIM(p_elem ->> 'totalqty'), '')::numeric,
      NULLIF(TRIM(p_elem ->> 'total_qty'), '')::numeric,
      0)::numeric;
$$;

COMMENT ON FUNCTION public.kernel_day_kg(jsonb) IS
  'Kg cracked for one cracking_data day-entry. Reproduces, unchanged, the historical expression '
  'coalesce(totalqty, total_qty, 0) used by get_dashboard_kernel_stats(), '
  'get_production_trends_daily() and get_kernel_mass_balance(). Whether a different manually '
  'captured field on the cracking form should take precedence over totalqty/total_qty here is an '
  'OPEN QUESTION, pending sign-off from the production team — see '
  'docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md. This function does not assert that any '
  'one field is authoritative; it only centralises the current, unchanged behaviour so the '
  'decision (whenever it is made) is a one-line change here instead of four hand-edits across '
  'the call sites.';

CREATE OR REPLACE FUNCTION public.kernel_day_date(p_elem jsonb)
RETURNS date
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = pg_catalog, public
AS $$
  SELECT CASE
      WHEN (p_elem ->> 'date') ~ '^\d{4}-\d{2}-\d{2}'      THEN (p_elem ->> 'date')::date
      WHEN (p_elem ->> 'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(p_elem ->> 'date', 'DD/MM/YYYY')
      ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.kernel_day_date(jsonb) IS
  'Parses the date key of one cracking_data / packing_data day-entry, accepting YYYY-MM-DD or '
  'DD/MM/YYYY, exactly as the inline CASE previously duplicated in '
  'get_dashboard_kernel_stats(), get_production_trends_daily() and formerly inlined in '
  'get_kernel_mass_balance(). No behaviour change.';

-- RBAC rows for repo consistency, even though these are internal-only helpers never called
-- directly from the client (no GRANT is required for that reason).
DO $$
DECLARE
    v_role_id record;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'kernel_day_kg', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role_id.id, 'function', 'kernel_day_date', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
