-- Pete's data page — nut-in-shell intake (procurement).
--
-- Depends on 20260819090000 (data_datasets, report_touch_updated_at, the captured-row convention).
--
-- Feeds the monthly report's "Nut in Shell Procured" metric, which has resolved to NULL since the
-- report builder shipped.
--
-- SEEDING, verified against the production database rather than assumed. kernel.intake_data does
-- carry lab results, but under FLAT keys, not the nested shape a design pass had guessed:
--     intake_data -> 'ziplock_sample' ->> 'moisture_result'   (e.g. "2.1")
--     intake_data -> 'ziplock_sample' ->> 'peroxide_result'
--     intake_data -> 'ziplock_sample' ->> 'ffa_result'
-- Those three are seeded. peroxide_result and ffa_result are frequently NULL in real rows, which is
-- exactly why they are nullable and why a blank must render as "no data", never as zero.
--
-- SKR/USKR are deliberately NOT seeded. intake_data -> 'five_kg_sample' -> 'crack_out' does hold
-- {sound_kernel_g, unsound_kernel_g, shell_g}, but the live data is not trustworthy: at least one
-- batch records sound_kernel_g = 5000 in a 5 kg sample with a NULL shell weight, i.e. 100% kernel
-- recovery, which is physically impossible. Deriving a recovery percentage from that would put a
-- fabricated figure in front of directors. Both columns are hand-entered until the capture is fixed
-- and the intended denominator is confirmed with QA.
--
-- DOUBLE-COUNTING: the kernel/batches tables already contain rows imported from this same
-- spreadsheet — batch numbers there match Pete's "Batch #" column verbatim. The backfill of this
-- table must therefore be fenced by batch number against batches.batch_id. That is a property of
-- the load, not of the schema, but source_batch_ref exists here to make the fence checkable after
-- the fact.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260819130000_data_page_nis_intake.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

CREATE TABLE IF NOT EXISTS public.data_nis_intake (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    received_date          date NULL,
    supplier_id            uuid NULL REFERENCES public.contacts (id) ON DELETE SET NULL,
    supplier_name          text NOT NULL DEFAULT '',
    supplier_number        integer NULL,
    job_number             text NULL,
    batch_number           text NULL,
    source_batch_ref       uuid NULL REFERENCES public.batches (id) ON DELETE SET NULL,

    nis_kg                 numeric(14, 2) NOT NULL DEFAULT 0,

    -- Seedable from kernel.intake_data.ziplock_sample (flat keys, verified).
    moisture_pct_system    numeric(8, 4) NULL,
    moisture_pct           numeric(8, 4) NULL,
    pv_system              numeric(10, 4) NULL,
    pv                     numeric(10, 4) NULL,
    ffa_pct_system         numeric(8, 4) NULL,
    ffa_pct                numeric(8, 4) NULL,

    -- Hand-entered: see the header note on why crack_out is not trustworthy as a source.
    sample_skr_pct         numeric(8, 4) NULL,
    sample_uskr_pct        numeric(8, 4) NULL,

    status_note            text NULL,
    data_source            text NOT NULL DEFAULT 'manual',
    seeded_at              timestamptz NULL,
    edited_by              uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    edited_at              timestamptz NULL,
    edit_reason            text NULL,
    data_quality_flags     text[] NOT NULL DEFAULT ARRAY[]::text[],
    notes                  text NULL,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT data_nis_intake_source_check CHECK (data_source IN ('system_seeded', 'manual', 'backfill', 'imported')),
    CONSTRAINT data_nis_intake_kg_check     CHECK (nis_kg >= 0),
    CONSTRAINT data_nis_intake_moisture_check CHECK (moisture_pct   IS NULL OR moisture_pct   BETWEEN 0 AND 100),
    CONSTRAINT data_nis_intake_ffa_check      CHECK (ffa_pct        IS NULL OR ffa_pct        BETWEEN 0 AND 100),
    CONSTRAINT data_nis_intake_skr_check      CHECK (sample_skr_pct IS NULL OR sample_skr_pct BETWEEN 0 AND 100),
    CONSTRAINT data_nis_intake_uskr_check     CHECK (sample_uskr_pct IS NULL OR sample_uskr_pct BETWEEN 0 AND 100)
);

COMMENT ON TABLE public.data_nis_intake IS
    'Nut-in-shell deliveries: the procurement side of the data page, and the source of the monthly '
    'report''s "Nut in Shell Procured" figure.';
COMMENT ON COLUMN public.data_nis_intake.received_date IS
    'Nullable on purpose: several rows in the historical spreadsheet carry real supplier, batch and '
    'weight data but no date. Those are loaded and flagged for a human to complete, not dropped.';
COMMENT ON COLUMN public.data_nis_intake.source_batch_ref IS
    'Set when this row corresponds to a batch already tracked in batches/kernel. Makes the '
    'anti-double-count fence auditable after a backfill rather than only at load time.';
COMMENT ON COLUMN public.data_nis_intake.sample_skr_pct IS
    'Hand-entered. NOT derived from five_kg_sample.crack_out: that data exists but is unreliable — '
    'at least one live batch records 5000 g of sound kernel in a 5 kg sample, i.e. 100% recovery.';
COMMENT ON COLUMN public.data_nis_intake.supplier_number IS
    'The spreadsheet''s "Supplier #". A hint only, never a key: the number restarts at 1 in the '
    'workbook''s inactive-supplier block, so it is not unique. Resolve suppliers by name.';

ALTER TABLE public.data_nis_intake ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_nis_intake FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_nis_intake TO service_role;

CREATE INDEX IF NOT EXISTS ix_data_nis_intake_date ON public.data_nis_intake (received_date DESC);
CREATE INDEX IF NOT EXISTS ix_data_nis_intake_supplier ON public.data_nis_intake (supplier_id);
CREATE INDEX IF NOT EXISTS ix_data_nis_intake_batch ON public.data_nis_intake (batch_number);
CREATE INDEX IF NOT EXISTS ix_data_nis_intake_source_batch ON public.data_nis_intake (source_batch_ref);
CREATE INDEX IF NOT EXISTS ix_data_nis_intake_edited_by ON public.data_nis_intake (edited_by);

-- Natural key for idempotent backfill. batch_number alone collides: the spreadsheet genuinely
-- records two separate deliveries under one batch label with different weights, so the weight and
-- date are part of the key.
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_nis_intake_natural
    ON public.data_nis_intake (batch_number, received_date, nis_kg)
    WHERE batch_number IS NOT NULL AND received_date IS NOT NULL;

DROP TRIGGER IF EXISTS trg_data_nis_intake_updated_at ON public.data_nis_intake;
CREATE TRIGGER trg_data_nis_intake_updated_at
    BEFORE UPDATE ON public.data_nis_intake
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

INSERT INTO public.data_datasets
    (dataset_key, label, description, table_name, period_column, period_kind,
     report_section_key, supports_reseed, display_order)
VALUES
    ('nis_intake', 'Nut in Shell Intake',
     'Nut-in-shell deliveries by supplier, with intake lab results. Moisture, PV and FFA are seeded '
     'from batch capture where it exists.',
     'data_nis_intake', 'received_date', 'date_range', 'nis_procured', true, 50)
ON CONFLICT (dataset_key) DO NOTHING;

-- ============================================================================
-- Seeding from live batch capture, using the verified flat key names.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reseed_data_nis_intake(
    p_date_from date, p_date_to date, p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, rows_reseeded integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
    IF p_date_from IS NULL OR p_date_to IS NULL THEN
        RETURN QUERY SELECT 0, 'A date range is required.', 0; RETURN;
    END IF;

    -- Refreshes the lab mirror on rows already linked to a batch. Never touches the effective
    -- columns, and never creates a row: an intake row is a business record, not a derived one.
    UPDATE public.data_nis_intake t
    SET moisture_pct_system = NULLIF(k.intake_data #>> '{ziplock_sample,moisture_result}', '')::numeric,
        pv_system           = NULLIF(k.intake_data #>> '{ziplock_sample,peroxide_result}', '')::numeric,
        ffa_pct_system      = NULLIF(k.intake_data #>> '{ziplock_sample,ffa_result}', '')::numeric,
        seeded_at           = now()
    FROM public.kernel k
    WHERE k.batch_id = t.source_batch_ref
      AND k.is_active
      AND t.received_date BETWEEN p_date_from AND p_date_to;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count;
END;
$$;

COMMENT ON FUNCTION public.reseed_data_nis_intake(date, date, uuid) IS
    'Refreshes moisture, PV and FFA from batch capture for intake rows linked to a batch. Writes '
    'the mirror columns only. Creates nothing — an intake row is a business record, not derived.';

-- ============================================================================
-- RPCs.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_data_nis_intake(
    p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL,
    p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid, received_date date, supplier_id uuid, supplier_name text, supplier_number integer,
    job_number text, batch_number text, nis_kg numeric,
    moisture_pct_system numeric, moisture_pct numeric, pv_system numeric, pv numeric,
    ffa_pct_system numeric, ffa_pct numeric, sample_skr_pct numeric, sample_uskr_pct numeric,
    status_note text, data_source text, edited_by_name text, edited_at timestamptz,
    data_quality_flags text[], notes text, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH filtered AS (
        SELECT i.* FROM public.data_nis_intake i
        WHERE (p_date_from IS NULL OR i.received_date >= p_date_from OR i.received_date IS NULL)
          AND (p_date_to   IS NULL OR i.received_date <= p_date_to   OR i.received_date IS NULL)
    ), counted AS (SELECT count(*) AS n FROM filtered)
    SELECT f.id, f.received_date, f.supplier_id, f.supplier_name, f.supplier_number,
           f.job_number, f.batch_number, f.nis_kg,
           f.moisture_pct_system, f.moisture_pct, f.pv_system, f.pv,
           f.ffa_pct_system, f.ffa_pct, f.sample_skr_pct, f.sample_uskr_pct,
           f.status_note, f.data_source,
           public.stock_history_user_label(f.edited_by), f.edited_at,
           f.data_quality_flags, f.notes, c.n
    FROM filtered f CROSS JOIN counted c
    ORDER BY f.received_date DESC NULLS LAST, f.batch_number, f.id
    LIMIT LEAST(COALESCE(p_limit, 100), 500) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_data_nis_intake(date, date, integer, integer) IS
    'Paged nut-in-shell intake. Rows with no received_date are always returned regardless of the '
    'range filter, so an incomplete row cannot hide from the person who needs to fix it.';

CREATE OR REPLACE FUNCTION public.upsert_data_nis_intake_rows(
    p_rows jsonb, p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, rows_written integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_upd integer := 0; v_ins integer := 0;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RETURN QUERY SELECT 0, 'p_rows must be a JSON array.', 0; RETURN;
    END IF;

    UPDATE public.data_nis_intake t
    SET received_date   = NULLIF(r ->> 'received_date', '')::date,
        supplier_id     = NULLIF(r ->> 'supplier_id', '')::uuid,
        supplier_name   = COALESCE(r ->> 'supplier_name', t.supplier_name),
        supplier_number = NULLIF(r ->> 'supplier_number', '')::integer,
        job_number      = NULLIF(r ->> 'job_number', ''),
        batch_number    = NULLIF(r ->> 'batch_number', ''),
        nis_kg          = COALESCE(NULLIF(r ->> 'nis_kg', '')::numeric, 0),
        moisture_pct    = NULLIF(r ->> 'moisture_pct', '')::numeric,
        pv              = NULLIF(r ->> 'pv', '')::numeric,
        ffa_pct         = NULLIF(r ->> 'ffa_pct', '')::numeric,
        sample_skr_pct  = NULLIF(r ->> 'sample_skr_pct', '')::numeric,
        sample_uskr_pct = NULLIF(r ->> 'sample_uskr_pct', '')::numeric,
        status_note     = NULLIF(r ->> 'status_note', ''),
        notes           = NULLIF(r ->> 'notes', ''),
        edit_reason     = COALESCE(NULLIF(r ->> 'edit_reason', ''), t.edit_reason),
        edited_by = p_actor_user_id, edited_at = now(), data_source = 'manual'
    FROM jsonb_array_elements(p_rows) r
    WHERE t.id = NULLIF(r ->> 'id', '')::uuid;
    GET DIAGNOSTICS v_upd = ROW_COUNT;

    INSERT INTO public.data_nis_intake
        (received_date, supplier_id, supplier_name, supplier_number, job_number, batch_number,
         nis_kg, moisture_pct, pv, ffa_pct, sample_skr_pct, sample_uskr_pct, status_note, notes,
         data_source, edited_by, edited_at)
    SELECT NULLIF(r ->> 'received_date', '')::date, NULLIF(r ->> 'supplier_id', '')::uuid,
           COALESCE(r ->> 'supplier_name', ''), NULLIF(r ->> 'supplier_number', '')::integer,
           NULLIF(r ->> 'job_number', ''), NULLIF(r ->> 'batch_number', ''),
           COALESCE(NULLIF(r ->> 'nis_kg', '')::numeric, 0),
           NULLIF(r ->> 'moisture_pct', '')::numeric, NULLIF(r ->> 'pv', '')::numeric,
           NULLIF(r ->> 'ffa_pct', '')::numeric, NULLIF(r ->> 'sample_skr_pct', '')::numeric,
           NULLIF(r ->> 'sample_uskr_pct', '')::numeric, NULLIF(r ->> 'status_note', ''),
           NULLIF(r ->> 'notes', ''), 'manual', p_actor_user_id, now()
    FROM jsonb_array_elements(p_rows) r
    WHERE NULLIF(r ->> 'id', '') IS NULL;
    GET DIAGNOSTICS v_ins = ROW_COUNT;

    RETURN QUERY SELECT 1, NULL::text, v_upd + v_ins;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_data_nis_intake_row(p_id uuid)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    DELETE FROM public.data_nis_intake WHERE id = p_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 0, 'No such intake row.'; RETURN; END IF;
    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- ============================================================================
-- Point the NIS-procured metric at this dataset.
-- ============================================================================

UPDATE public.report_metrics
SET source_kind = 'data_page_nis_procured_kg'
WHERE metric_key = 'nis_procured_kg';

CREATE OR REPLACE FUNCTION public.resolve_report_metric_value(
    p_metric_key text, p_period_start date, p_period_end date
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_metric public.report_metrics%ROWTYPE;
    v_result numeric;
BEGIN
    SELECT * INTO v_metric FROM public.report_metrics WHERE metric_key = p_metric_key;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown report metric_key: %', p_metric_key USING ERRCODE = 'no_data_found';
    END IF;

    CASE v_metric.source_kind
        WHEN 'data_page_production_cracking_kg' THEN
            SELECT SUM(d.cracked_kg) INTO v_result FROM public.data_production_daily d
            WHERE d.production_date BETWEEN p_period_start AND p_period_end;
        WHEN 'data_page_production_packing_kg' THEN
            SELECT SUM(d.sk_packed_kg) INTO v_result FROM public.data_production_daily d
            WHERE d.production_date BETWEEN p_period_start AND p_period_end;
        WHEN 'data_page_kernel_sales_sum' THEN
            SELECT SUM(s.vat_excl_zar) INTO v_result FROM public.data_kernel_sales_lines s
            WHERE s.sale_date BETWEEN p_period_start AND p_period_end;
        WHEN 'data_page_oil_sales_sum' THEN
            SELECT SUM(s.vat_excl_zar) INTO v_result FROM public.data_oil_sales_lines s
            WHERE s.sale_date BETWEEN p_period_start AND p_period_end;
        WHEN 'data_page_oil_sales_by_product' THEN
            SELECT SUM(s.vat_excl_zar) INTO v_result FROM public.data_oil_sales_lines s
            WHERE s.sale_date BETWEEN p_period_start AND p_period_end
              AND s.product_line = (v_metric.source_args ->> 'product');
        WHEN 'data_page_nis_procured_kg' THEN
            SELECT SUM(i.nis_kg) INTO v_result FROM public.data_nis_intake i
            WHERE i.received_date BETWEEN p_period_start AND p_period_end;
        ELSE
            v_result := NULL;
    END CASE;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.resolve_report_metric_value(text, date, date) IS
    'Computes a report metric for a period, reading exclusively from the data-page tables. Never '
    'reads kernel/oil directly. Returns NULL for metrics whose dataset does not exist yet.';

-- ============================================================================
-- RBAC.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_data_nis_intake(date, date, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_data_nis_intake_rows(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_data_nis_intake_row(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reseed_data_nis_intake(date, date, uuid) TO anon, authenticated, service_role;

DO $$
DECLARE v_role record; v_fn text;
BEGIN
    FOR v_role IN SELECT id, role_name FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role.id, 'function', 'get_data_nis_intake', 'EXECUTE', true) ON CONFLICT DO NOTHING;
        IF v_role.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager') THEN
            FOREACH v_fn IN ARRAY ARRAY[
                'upsert_data_nis_intake_rows', 'delete_data_nis_intake_row', 'reseed_data_nis_intake'
            ] LOOP
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true) ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
