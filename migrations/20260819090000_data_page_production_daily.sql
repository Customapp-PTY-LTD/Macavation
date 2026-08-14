-- Pete's data page — dataset catalog and the daily production dataset.
--
-- Context. The report builder (20260817090000 / 20260817100000) was designed with figures typed
-- into each report. That has changed: all of the Sales Exec's DATA now lives on a standing data
-- page, and the report becomes commentary over figures read from it. This is the first dataset.
--
-- Why purpose-built typed columns rather than a generic dataset/jsonb-rows engine: this schema has
-- already paid for the generic version once. public.kernel_day_kg() exists ONLY because totalqty,
-- total_qty and endqty1 coexisted untyped in one jsonb column, and
-- docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md records what untangling that cost. Typed
-- columns give per-column CHECK constraints, real foreign keys, and drift as a plain SQL predicate
-- instead of application-level diffing. report_instance_lines.payload jsonb is fine by contrast
-- because it is frozen once at publish; this data is continuously edited, filtered and compared.
--
-- The captured-row convention, used by every dataset in this series:
--   <field>_system  nullable  — the live ops figure as at the last seed. Written ONLY by re-seed.
--   <field>         NOT NULL  — the effective, report-facing figure. Seeded from _system, then
--                               freely editable. RE-SEED NEVER TOUCHES IT.
-- That single rule is the whole mechanism for "keep Pete's value, flag the drift". A field with no
-- ops source gets one column only — no fake system twin, so the schema states honestly which
-- figures the factory can actually supply.
--
-- Verified against prod before writing: kernel_packing_yield_by_style(jsonb_build_array(<day>))
-- returns a jsonb object of style_code -> kg (e.g. {"4L":294.84,"1S":11.34,...}), so a day's packed
-- total is the sum of its values.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260819090000_data_page_production_daily.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. data_datasets — metadata catalog driving the data page's tab strip.
--
-- Metadata only. It stores no values: each dataset's rows live in its own typed table, named here
-- so the UI can resolve a tab to its RPCs without hardcoding a list.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_datasets (
    dataset_key        text PRIMARY KEY,
    label              text NOT NULL,
    description        text NULL,
    table_name         text NOT NULL,
    period_column      text NULL,
    period_kind        text NOT NULL DEFAULT 'date_range',
    report_section_key text NULL REFERENCES public.report_sections (section_key) ON DELETE SET NULL,
    supports_reseed    boolean NOT NULL DEFAULT false,
    display_order      integer NOT NULL DEFAULT 0,
    is_active          boolean NOT NULL DEFAULT true,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT data_datasets_period_kind_check
        CHECK (period_kind IN ('date_range', 'period_snapshot', 'monthly_forecast', 'derived'))
);

COMMENT ON TABLE public.data_datasets IS
    'Catalog of the data page tabs. Metadata only — values live in each dataset''s own typed table. '
    'period_kind drives the period selector: date_range filters a date column, period_snapshot is '
    'keyed by (period_type, period_start), monthly_forecast is financial-year scoped, derived has '
    'no base table.';
COMMENT ON COLUMN public.data_datasets.supports_reseed IS
    'True only where a live operational source actually exists to seed from. False means every '
    'figure in this dataset is hand-entered, and the UI must not offer a re-seed action.';
COMMENT ON COLUMN public.data_datasets.report_section_key IS
    'Explicit link rather than a naming convention: one dataset can back two report sections at '
    'different projections (kernel SOH quantities vs the fuller stock report), and some datasets '
    'back a metric rather than a line table.';

ALTER TABLE public.data_datasets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_datasets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_datasets TO service_role;

CREATE INDEX IF NOT EXISTS ix_data_datasets_active_order
    ON public.data_datasets (is_active, display_order);

DROP TRIGGER IF EXISTS trg_data_datasets_updated_at ON public.data_datasets;
CREATE TRIGGER trg_data_datasets_updated_at
    BEFORE UPDATE ON public.data_datasets
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

-- ============================================================================
-- 2. data_production_daily — one row per calendar day.
--
-- Cracked and sound-kernel-packed are seedable from the factory's batch capture. The byproduct
-- columns have no operational source anywhere in this schema and are hand-entered, so they carry
-- no _system twin.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_production_daily (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    production_date     date NOT NULL,

    -- Seedable: kernel.cracking_data via kernel_day_kg()/kernel_day_date().
    cracked_kg_system   numeric(14, 2) NULL,
    cracked_kg          numeric(14, 2) NOT NULL DEFAULT 0,

    -- Seedable: kernel.packing_data via kernel_packing_yield_by_style().
    sk_packed_kg_system numeric(14, 2) NULL,
    sk_packed_kg        numeric(14, 2) NOT NULL DEFAULT 0,

    -- No operational source today — hand-entered.
    wholes_pct          numeric(6, 3) NULL,
    uncracks_pct        numeric(6, 3) NULL,
    oil_kernel_kg       numeric(14, 2) NULL,
    cracker_dust_kg     numeric(14, 2) NULL,
    shell_fines_kg      numeric(14, 2) NULL,
    compost_kg          numeric(14, 2) NULL,
    shell_kg            numeric(14, 2) NULL,

    data_source         text NOT NULL DEFAULT 'manual',
    seeded_at           timestamptz NULL,
    edited_by           uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    edited_at           timestamptz NULL,
    edit_reason         text NULL,
    data_quality_flags  text[] NOT NULL DEFAULT ARRAY[]::text[],
    notes               text NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT data_production_daily_date_key UNIQUE (production_date),
    CONSTRAINT data_production_daily_source_check
        CHECK (data_source IN ('system_seeded', 'manual', 'backfill')),
    CONSTRAINT data_production_daily_cracked_check      CHECK (cracked_kg >= 0),
    CONSTRAINT data_production_daily_packed_check       CHECK (sk_packed_kg >= 0),
    CONSTRAINT data_production_daily_wholes_check       CHECK (wholes_pct   IS NULL OR wholes_pct   BETWEEN 0 AND 100),
    CONSTRAINT data_production_daily_uncracks_check     CHECK (uncracks_pct IS NULL OR uncracks_pct BETWEEN 0 AND 100),
    CONSTRAINT data_production_daily_oil_kernel_check   CHECK (oil_kernel_kg   IS NULL OR oil_kernel_kg   >= 0),
    CONSTRAINT data_production_daily_cracker_dust_check CHECK (cracker_dust_kg IS NULL OR cracker_dust_kg >= 0),
    CONSTRAINT data_production_daily_shell_fines_check  CHECK (shell_fines_kg  IS NULL OR shell_fines_kg  >= 0),
    CONSTRAINT data_production_daily_compost_check      CHECK (compost_kg      IS NULL OR compost_kg      >= 0),
    CONSTRAINT data_production_daily_shell_check        CHECK (shell_kg        IS NULL OR shell_kg        >= 0)
);

COMMENT ON TABLE public.data_production_daily IS
    'Daily production figures for the data page — the Sales Exec''s working record, and the source '
    'the weekly and monthly reports read from. Cracked and packed are seeded from batch capture and '
    'correctable; byproducts are hand-entered.';
COMMENT ON COLUMN public.data_production_daily.cracked_kg IS
    'The effective, report-facing figure. Re-seeding never overwrites this — only cracked_kg_system.';
COMMENT ON COLUMN public.data_production_daily.cracked_kg_system IS
    'The factory figure as at the last seed. NULL means never seeded. Compare against a freshly '
    'computed value to detect drift.';
COMMENT ON COLUMN public.data_production_daily.data_quality_flags IS
    'Set by the historical backfill for rows it could not fully trust (e.g. a suspect date), so a '
    'questionable row is visible for review rather than silently dropped or silently corrected.';

ALTER TABLE public.data_production_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_production_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_production_daily TO service_role;

CREATE INDEX IF NOT EXISTS ix_data_production_daily_date
    ON public.data_production_daily (production_date DESC);
CREATE INDEX IF NOT EXISTS ix_data_production_daily_edited_by
    ON public.data_production_daily (edited_by);

DROP TRIGGER IF EXISTS trg_data_production_daily_updated_at ON public.data_production_daily;
CREATE TRIGGER trg_data_production_daily_updated_at
    BEFORE UPDATE ON public.data_production_daily
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

INSERT INTO public.data_datasets
    (dataset_key, label, description, table_name, period_column, period_kind,
     report_section_key, supports_reseed, display_order)
VALUES
    ('production_daily', 'Production (daily)',
     'Daily cracking, packing and byproducts. Cracked and packed are seeded from batch capture.',
     'data_production_daily', 'production_date', 'date_range',
     'kernel_production', true, 10)
ON CONFLICT (dataset_key) DO NOTHING;

-- ============================================================================
-- 3. Live-figure helpers — reuse the existing kernel helpers, never reimplement them.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.production_day_cracked_kg_live(p_date date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- Filters on the DAY-ENTRY's own date via kernel_day_date, not on the batch's received_date.
    -- get_kernel_mass_balance filters by received_date and its own comment concedes that is wrong:
    -- a batch received in June but cracked in July vanishes from a July call.
    SELECT COALESCE(SUM(public.kernel_day_kg(e)), 0)
    FROM public.kernel k
    CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) e
    WHERE k.is_active
      AND public.kernel_day_date(e) = p_date;
$$;

COMMENT ON FUNCTION public.production_day_cracked_kg_live(date) IS
    'Nut-in-shell cracked on one day, from live batch capture. kernel_day_kg prefers endqty1, which '
    'KG_CRACKED_UNDERCOUNT_INVESTIGATION.md §0.1 establishes is an input-side quantity — nut fed '
    'through the cracker — which is the correct meaning here. §0.4 of the same document records '
    'that the underlying capture is unreliable in both directions, which is precisely why the data '
    'page lets this figure be corrected.';

CREATE OR REPLACE FUNCTION public.production_day_sk_packed_kg_live(p_date date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    -- kernel_packing_yield_by_style returns a jsonb object of style_code -> kg for the day-elements
    -- it is given; the day's total is the sum of its values. Verified against prod.
    SELECT COALESCE(SUM(x.kg), 0)
    FROM public.kernel k
    CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) e
    CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(NULLIF(t.value, '')::numeric), 0) AS kg
        FROM jsonb_each_text(public.kernel_packing_yield_by_style(jsonb_build_array(e))) AS t(key, value)
    ) x
    WHERE k.is_active
      AND public.kernel_day_date(e) = p_date;
$$;

COMMENT ON FUNCTION public.production_day_sk_packed_kg_live(date) IS
    'Sound kernel packed on one day, summed across styles by reusing kernel_packing_yield_by_style '
    'unchanged rather than reimplementing its style-key mapping.';

-- ============================================================================
-- 4. Re-seed — writes the _system columns only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reseed_data_production_daily(
    p_date_from     date,
    p_date_to       date,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, rows_reseeded integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL THEN
        RETURN QUERY SELECT 0, 'A date range is required.', 0;
        RETURN;
    END IF;
    IF p_date_to < p_date_from THEN
        RETURN QUERY SELECT 0, 'The end date is before the start date.', 0;
        RETURN;
    END IF;
    IF (p_date_to - p_date_from) > 400 THEN
        RETURN QUERY SELECT 0, 'Re-seed a range of 400 days or fewer at a time.', 0;
        RETURN;
    END IF;

    INSERT INTO public.data_production_daily AS t
        (production_date, cracked_kg_system, cracked_kg,
         sk_packed_kg_system, sk_packed_kg, data_source, seeded_at, edited_by)
    SELECT d::date,
           public.production_day_cracked_kg_live(d::date),
           public.production_day_cracked_kg_live(d::date),
           public.production_day_sk_packed_kg_live(d::date),
           public.production_day_sk_packed_kg_live(d::date),
           'system_seeded',
           now(),
           p_actor_user_id
    FROM generate_series(p_date_from, p_date_to, interval '1 day') d
    ON CONFLICT (production_date) DO UPDATE
        -- The effective columns are deliberately absent from this SET list. An existing row keeps
        -- whatever figure the user put there; only the factory-side mirror is refreshed.
        SET cracked_kg_system   = EXCLUDED.cracked_kg_system,
            sk_packed_kg_system = EXCLUDED.sk_packed_kg_system,
            seeded_at           = now();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count;
END;
$$;

COMMENT ON FUNCTION public.reseed_data_production_daily(date, date, uuid) IS
    'Refreshes the factory-side mirror for a date range, creating missing days. Never overwrites an '
    'effective figure — that is what makes a correction durable against later batch edits.';

-- ============================================================================
-- 5. Read, write and drift RPCs. Every list is LIMIT-capped per
-- BluePrint/supabase-database-rules.md §6.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_data_production_daily(
    p_date_from date DEFAULT NULL,
    p_date_to   date DEFAULT NULL,
    p_limit     integer DEFAULT 100,
    p_offset    integer DEFAULT 0
)
RETURNS TABLE (
    id                  uuid,
    production_date     date,
    cracked_kg_system   numeric,
    cracked_kg          numeric,
    cracked_kg_live     numeric,
    sk_packed_kg_system numeric,
    sk_packed_kg        numeric,
    sk_packed_kg_live   numeric,
    wholes_pct          numeric,
    uncracks_pct        numeric,
    oil_kernel_kg       numeric,
    cracker_dust_kg     numeric,
    shell_fines_kg      numeric,
    compost_kg          numeric,
    shell_kg            numeric,
    data_source         text,
    edited_by_name      text,
    edited_at           timestamptz,
    edit_reason         text,
    data_quality_flags  text[],
    notes               text,
    total_count         bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH filtered AS (
        SELECT d.*
        FROM public.data_production_daily d
        WHERE (p_date_from IS NULL OR d.production_date >= p_date_from)
          AND (p_date_to   IS NULL OR d.production_date <= p_date_to)
    ),
    counted AS (SELECT count(*) AS n FROM filtered)
    SELECT f.id,
           f.production_date,
           f.cracked_kg_system,
           f.cracked_kg,
           public.production_day_cracked_kg_live(f.production_date),
           f.sk_packed_kg_system,
           f.sk_packed_kg,
           public.production_day_sk_packed_kg_live(f.production_date),
           f.wholes_pct, f.uncracks_pct, f.oil_kernel_kg, f.cracker_dust_kg,
           f.shell_fines_kg, f.compost_kg, f.shell_kg,
           f.data_source,
           public.stock_history_user_label(f.edited_by),
           f.edited_at,
           f.edit_reason,
           f.data_quality_flags,
           f.notes,
           c.n
    FROM filtered f CROSS JOIN counted c
    ORDER BY f.production_date DESC
    LIMIT LEAST(COALESCE(p_limit, 100), 400) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_data_production_daily(date, date, integer, integer) IS
    'Paged daily production. Returns the stored figure, the factory mirror as at last seed, and the '
    'live factory figure recomputed now — the UI shows drift by comparing the last two. p_limit is '
    'capped at 400 (a long month plus slack); total_count repeats on every row.';

CREATE OR REPLACE FUNCTION public.upsert_data_production_daily_rows(
    p_rows          jsonb,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, rows_written integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer := 0;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        -- The client must send the array itself, never JSON.stringify(rows): PostgREST already
        -- serialises the body, so a pre-stringified array arrives as a jsonb string.
        RETURN QUERY SELECT 0, 'p_rows must be a JSON array.', 0;
        RETURN;
    END IF;

    INSERT INTO public.data_production_daily AS t
        (production_date, cracked_kg, sk_packed_kg, wholes_pct, uncracks_pct, oil_kernel_kg,
         cracker_dust_kg, shell_fines_kg, compost_kg, shell_kg, notes, edit_reason,
         data_source, edited_by, edited_at)
    SELECT (r ->> 'production_date')::date,
           COALESCE(NULLIF(r ->> 'cracked_kg', '')::numeric, 0),
           COALESCE(NULLIF(r ->> 'sk_packed_kg', '')::numeric, 0),
           NULLIF(r ->> 'wholes_pct', '')::numeric,
           NULLIF(r ->> 'uncracks_pct', '')::numeric,
           NULLIF(r ->> 'oil_kernel_kg', '')::numeric,
           NULLIF(r ->> 'cracker_dust_kg', '')::numeric,
           NULLIF(r ->> 'shell_fines_kg', '')::numeric,
           NULLIF(r ->> 'compost_kg', '')::numeric,
           NULLIF(r ->> 'shell_kg', '')::numeric,
           NULLIF(r ->> 'notes', ''),
           NULLIF(r ->> 'edit_reason', ''),
           'manual',
           p_actor_user_id,
           now()
    FROM jsonb_array_elements(p_rows) r
    WHERE NULLIF(r ->> 'production_date', '') IS NOT NULL
    ON CONFLICT (production_date) DO UPDATE
        SET cracked_kg      = EXCLUDED.cracked_kg,
            sk_packed_kg    = EXCLUDED.sk_packed_kg,
            wholes_pct      = EXCLUDED.wholes_pct,
            uncracks_pct    = EXCLUDED.uncracks_pct,
            oil_kernel_kg   = EXCLUDED.oil_kernel_kg,
            cracker_dust_kg = EXCLUDED.cracker_dust_kg,
            shell_fines_kg  = EXCLUDED.shell_fines_kg,
            compost_kg      = EXCLUDED.compost_kg,
            shell_kg        = EXCLUDED.shell_kg,
            notes           = EXCLUDED.notes,
            edit_reason     = COALESCE(EXCLUDED.edit_reason, t.edit_reason),
            edited_by       = EXCLUDED.edited_by,
            edited_at       = now(),
            -- A backfilled or seeded row that a human then edits becomes 'manual'.
            data_source     = 'manual';

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count;
END;
$$;

COMMENT ON FUNCTION public.upsert_data_production_daily_rows(jsonb, uuid) IS
    'Bulk upsert of daily production rows, keyed on production_date. One round trip for a whole '
    'period, following the p_rows/p_lines jsonb-array convention used by import_table_rows and '
    'create_kernel_dispatch_order. Writes effective figures only; the factory mirror is untouched.';

CREATE OR REPLACE FUNCTION public.delete_data_production_daily_row(p_production_date date)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.data_production_daily WHERE production_date = p_production_date;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'No production row for that date.';
        RETURN;
    END IF;
    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.delete_data_production_daily_row(date) IS
    'Removes one day''s production row. Re-seeding will recreate it from batch capture.';

CREATE OR REPLACE FUNCTION public.get_data_production_daily_drift(
    p_date_from date DEFAULT NULL,
    p_date_to   date DEFAULT NULL,
    p_limit     integer DEFAULT 100,
    p_offset    integer DEFAULT 0
)
RETURNS TABLE (
    production_date date,
    field_name      text,
    stored_system   numeric,
    live_system     numeric,
    effective_value numeric,
    delta           numeric,
    total_count     bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH base AS (
        SELECT d.production_date,
               d.cracked_kg_system,
               d.cracked_kg,
               public.production_day_cracked_kg_live(d.production_date)   AS live_cracked,
               d.sk_packed_kg_system,
               d.sk_packed_kg,
               public.production_day_sk_packed_kg_live(d.production_date) AS live_packed
        FROM public.data_production_daily d
        WHERE (p_date_from IS NULL OR d.production_date >= p_date_from)
          AND (p_date_to   IS NULL OR d.production_date <= p_date_to)
    ),
    diffs AS (
        SELECT production_date, 'cracked_kg'::text AS field_name,
               cracked_kg_system AS stored_system, live_cracked AS live_system,
               cracked_kg AS effective_value,
               live_cracked - COALESCE(cracked_kg_system, 0) AS delta
        FROM base
        WHERE cracked_kg_system IS DISTINCT FROM live_cracked
        UNION ALL
        SELECT production_date, 'sk_packed_kg'::text,
               sk_packed_kg_system, live_packed, sk_packed_kg,
               live_packed - COALESCE(sk_packed_kg_system, 0)
        FROM base
        WHERE sk_packed_kg_system IS DISTINCT FROM live_packed
    ),
    counted AS (SELECT count(*) AS n FROM diffs)
    SELECT d.production_date, d.field_name, d.stored_system, d.live_system,
           d.effective_value, d.delta, c.n
    FROM diffs d CROSS JOIN counted c
    ORDER BY d.production_date DESC, d.field_name
    LIMIT LEAST(COALESCE(p_limit, 100), 200) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_data_production_daily_drift(date, date, integer, integer) IS
    'Days where the factory figure has moved since it was last seeded. Drift is computed on demand '
    'rather than stored as a flag, so it stays honest without a background job — this project has '
    'no pg_cron.';

CREATE OR REPLACE FUNCTION public.get_data_datasets()
RETURNS TABLE (
    dataset_key        text,
    label              text,
    description        text,
    table_name         text,
    period_column      text,
    period_kind        text,
    report_section_key text,
    supports_reseed    boolean,
    display_order      integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT d.dataset_key, d.label, d.description, d.table_name, d.period_column, d.period_kind,
           d.report_section_key, d.supports_reseed, d.display_order
    FROM public.data_datasets d
    WHERE d.is_active
    ORDER BY d.display_order, d.dataset_key
    LIMIT 100;
$$;

COMMENT ON FUNCTION public.get_data_datasets() IS
    'The data page tab catalog. Capped at 100 rows.';

-- ============================================================================
-- 6. RBAC.
--
-- Reads to every role (precedent: get_stock_edit_history, 20260816090000). Writes scoped to the
-- roles that own reporting — Sales Exec (Pete) and Palladium Manager (Joslyn), plus admin and
-- super_user — deliberately NOT looped over every role, which CLAUDE.md:34-39 records as the cause
-- of this repo's permission drift. Also deliberately absent from
-- migrations/20260218000001_grant_all_data_functions_to_all_roles.sql for the same reason.
--
-- GRANT ... TO anon is required, not a weakening: data-functions.js calls every RPC with the anon
-- key because the portal login token is not a Supabase Auth JWT. The actor id is for attribution
-- only and is not an authorisation check — same caveat as 20260815110000_generic_has_action_gate.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.production_day_cracked_kg_live(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_day_sk_packed_kg_live(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_datasets() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_production_daily(date, date, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_production_daily_drift(date, date, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_data_production_daily_rows(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_data_production_daily_row(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reseed_data_production_daily(date, date, uuid) TO anon, authenticated, service_role;

DO $$
DECLARE
    v_role record;
    v_fn   text;
BEGIN
    FOR v_role IN SELECT id, role_name FROM public.roles LOOP
        FOREACH v_fn IN ARRAY ARRAY[
            'get_data_datasets', 'get_data_production_daily', 'get_data_production_daily_drift',
            'production_day_cracked_kg_live', 'production_day_sk_packed_kg_live'
        ] LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;

        IF v_role.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager') THEN
            FOREACH v_fn IN ARRAY ARRAY[
                'upsert_data_production_daily_rows', 'delete_data_production_daily_row',
                'reseed_data_production_daily'
            ] LOOP
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
