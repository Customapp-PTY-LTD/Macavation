-- Pete's data page — sales datasets: kernel sales lines, oil/protein sales lines, and the bulk
-- oil export register.
--
-- Depends on 20260819090000 (data_datasets catalog, report_touch_updated_at, the captured-row
-- convention).
--
-- No operational source exists for any of these — there is no sales, invoice or order table
-- anywhere in this schema. So none of these tables carries a <field>_system twin: every figure is
-- entered or backfilled, and data_source has no 'system_seeded' option. That asymmetry against
-- data_production_daily is deliberate and is the schema stating honestly which datasets the
-- factory can actually supply.
--
-- The local oil sales tab (data_oil_sales_lines) and the bulk export register
-- (data_oil_export_register) are two DIFFERENT sales channels covering different customers,
-- currencies and units. They must never be merged or de-duplicated against each other.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260819100000_data_page_sales.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. data_kernel_sales_lines
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_kernel_sales_lines (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_date          date NOT NULL,
    customer_id        uuid NULL REFERENCES public.contacts (id) ON DELETE SET NULL,
    customer_name      text NOT NULL DEFAULT '',
    invoice_number     text NULL,
    item_code          text NULL,
    style_code         text NULL REFERENCES public.kernel_style_registry (style_code) ON DELETE SET NULL,
    description        text NULL,
    cartons            numeric(12, 2) NULL,
    quantity_kg        numeric(14, 2) NOT NULL DEFAULT 0,
    price_per_kg       numeric(12, 4) NULL,
    vat_excl_zar       numeric(14, 2) NOT NULL DEFAULT 0,
    vat_zar            numeric(14, 2) NOT NULL DEFAULT 0,
    vat_incl_zar       numeric(14, 2) NOT NULL DEFAULT 0,
    data_source        text NOT NULL DEFAULT 'manual',
    edited_by          uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    edited_at          timestamptz NULL,
    edit_reason        text NULL,
    data_quality_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
    notes              text NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT data_kernel_sales_lines_source_check CHECK (data_source IN ('manual', 'backfill', 'imported')),
    CONSTRAINT data_kernel_sales_lines_qty_check     CHECK (quantity_kg >= 0),
    CONSTRAINT data_kernel_sales_lines_cartons_check CHECK (cartons IS NULL OR cartons >= 0),
    CONSTRAINT data_kernel_sales_lines_price_check   CHECK (price_per_kg IS NULL OR price_per_kg >= 0)
);

COMMENT ON TABLE public.data_kernel_sales_lines IS
    'Kernel sales invoice lines — the Sales Exec''s working record and the source the kernel sales '
    'figures in the weekly and monthly reports read from. No operational source exists, so there '
    'is no system twin: every row is entered, backfilled or imported.';
COMMENT ON COLUMN public.data_kernel_sales_lines.customer_name IS
    'Raw name as captured. Kept alongside customer_id because contacts lag reality and an unmatched '
    'name must not be silently lost during backfill.';
COMMENT ON COLUMN public.data_kernel_sales_lines.style_code IS
    'Set at entry time from the style registry, never inferred by matching free-text item codes — '
    'a wrong value here silently breaks the kernel-sales-by-style report section.';

ALTER TABLE public.data_kernel_sales_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_kernel_sales_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_kernel_sales_lines TO service_role;

CREATE INDEX IF NOT EXISTS ix_data_kernel_sales_lines_date ON public.data_kernel_sales_lines (sale_date DESC);
CREATE INDEX IF NOT EXISTS ix_data_kernel_sales_lines_customer ON public.data_kernel_sales_lines (customer_id);
CREATE INDEX IF NOT EXISTS ix_data_kernel_sales_lines_style ON public.data_kernel_sales_lines (style_code);
CREATE INDEX IF NOT EXISTS ix_data_kernel_sales_lines_invoice ON public.data_kernel_sales_lines (invoice_number);
CREATE INDEX IF NOT EXISTS ix_data_kernel_sales_lines_edited_by ON public.data_kernel_sales_lines (edited_by);

-- Natural key for idempotent backfill and re-import. Invoice numbers repeat across the lines of one
-- invoice, so item and quantity distinguish them. Partial: rows with no invoice number are
-- hand-entered and may legitimately repeat.
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_kernel_sales_lines_natural
    ON public.data_kernel_sales_lines (invoice_number, COALESCE(item_code, ''), quantity_kg, sale_date)
    WHERE invoice_number IS NOT NULL;

DROP TRIGGER IF EXISTS trg_data_kernel_sales_lines_updated_at ON public.data_kernel_sales_lines;
CREATE TRIGGER trg_data_kernel_sales_lines_updated_at
    BEFORE UPDATE ON public.data_kernel_sales_lines
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

-- ============================================================================
-- 2. data_oil_sales_lines — local oil and protein sales.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_oil_sales_lines (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sale_date          date NOT NULL,
    customer_id        uuid NULL REFERENCES public.contacts (id) ON DELETE SET NULL,
    customer_name      text NOT NULL DEFAULT '',
    invoice_number     text NULL,
    item_code          text NULL,
    product_line       text NULL,
    description        text NULL,
    cartons            numeric(12, 2) NULL,
    quantity_kg        numeric(14, 2) NOT NULL DEFAULT 0,
    price_per_kg       numeric(12, 4) NULL,
    vat_excl_zar       numeric(14, 2) NOT NULL DEFAULT 0,
    vat_zar            numeric(14, 2) NOT NULL DEFAULT 0,
    vat_incl_zar       numeric(14, 2) NOT NULL DEFAULT 0,
    data_source        text NOT NULL DEFAULT 'manual',
    edited_by          uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    edited_at          timestamptz NULL,
    edit_reason        text NULL,
    data_quality_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
    notes              text NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT data_oil_sales_lines_source_check CHECK (data_source IN ('manual', 'backfill', 'imported')),
    CONSTRAINT data_oil_sales_lines_qty_check    CHECK (quantity_kg >= 0),
    CONSTRAINT data_oil_sales_lines_product_check
        CHECK (product_line IS NULL OR product_line IN
               ('protein', 'extra_virgin', 'crude_cosmetic', 'cake', 'filter_fines', 'other'))
);

COMMENT ON TABLE public.data_oil_sales_lines IS
    'Local oil and protein sales lines. product_line drives the monthly report''s oil-sales-by-'
    'product-line section. Distinct from data_oil_export_register, which is the bulk export '
    'channel — the two must never be merged or de-duplicated against each other.';

ALTER TABLE public.data_oil_sales_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_oil_sales_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_oil_sales_lines TO service_role;

CREATE INDEX IF NOT EXISTS ix_data_oil_sales_lines_date ON public.data_oil_sales_lines (sale_date DESC);
CREATE INDEX IF NOT EXISTS ix_data_oil_sales_lines_customer ON public.data_oil_sales_lines (customer_id);
CREATE INDEX IF NOT EXISTS ix_data_oil_sales_lines_product ON public.data_oil_sales_lines (product_line);
CREATE INDEX IF NOT EXISTS ix_data_oil_sales_lines_edited_by ON public.data_oil_sales_lines (edited_by);

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_oil_sales_lines_natural
    ON public.data_oil_sales_lines (invoice_number, COALESCE(item_code, ''), quantity_kg, sale_date)
    WHERE invoice_number IS NOT NULL;

DROP TRIGGER IF EXISTS trg_data_oil_sales_lines_updated_at ON public.data_oil_sales_lines;
CREATE TRIGGER trg_data_oil_sales_lines_updated_at
    BEFORE UPDATE ON public.data_oil_sales_lines
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

-- ============================================================================
-- 3. data_oil_export_register — bulk export sales, USD-denominated.
--
-- The first FX-bearing table in this schema. Deliberately narrow: a rate per invoice, as Pete's
-- own register records it, not a general multi-currency system.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_oil_export_register (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    export_date        date NOT NULL,
    customer_id        uuid NULL REFERENCES public.contacts (id) ON DELETE SET NULL,
    customer_name      text NOT NULL DEFAULT '',
    location_country   text NULL,
    document_number    text NULL,
    reference          text NULL,
    product_class      text NULL,
    price_per_kg_usd   numeric(12, 4) NULL,
    incoterm           text NULL,
    weight_kg          numeric(14, 2) NULL,
    usd_debit          numeric(16, 2) NULL,
    load_count         numeric(8, 2) NULL,
    usd_zar_rate       numeric(10, 4) NULL,
    rand_value         numeric(16, 2) NULL,
    data_source        text NOT NULL DEFAULT 'manual',
    edited_by          uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    edited_at          timestamptz NULL,
    edit_reason        text NULL,
    data_quality_flags text[] NOT NULL DEFAULT ARRAY[]::text[],
    notes              text NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT data_oil_export_register_source_check CHECK (data_source IN ('manual', 'backfill', 'imported')),
    CONSTRAINT data_oil_export_register_class_check
        CHECK (product_class IS NULL OR product_class IN ('crude', 'evmo', 'protein', 'other')),
    CONSTRAINT data_oil_export_register_rate_check CHECK (usd_zar_rate IS NULL OR usd_zar_rate > 0)
);

COMMENT ON TABLE public.data_oil_export_register IS
    'Bulk oil export invoices in USD with the rand conversion Pete records per invoice. A separate '
    'sales channel from data_oil_sales_lines, not a subset of it.';
COMMENT ON COLUMN public.data_oil_export_register.usd_zar_rate IS
    'The rate applied to this invoice, as recorded on the register. Deliberately per-row rather '
    'than a shared FX table: this is how the business actually records it, and a shared daily-rate '
    'table would not reproduce the figures already reported to directors.';

ALTER TABLE public.data_oil_export_register ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_oil_export_register FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_oil_export_register TO service_role;

CREATE INDEX IF NOT EXISTS ix_data_oil_export_register_date ON public.data_oil_export_register (export_date DESC);
CREATE INDEX IF NOT EXISTS ix_data_oil_export_register_customer ON public.data_oil_export_register (customer_id);
CREATE INDEX IF NOT EXISTS ix_data_oil_export_register_edited_by ON public.data_oil_export_register (edited_by);

CREATE UNIQUE INDEX IF NOT EXISTS uq_data_oil_export_register_document
    ON public.data_oil_export_register (document_number)
    WHERE document_number IS NOT NULL;

DROP TRIGGER IF EXISTS trg_data_oil_export_register_updated_at ON public.data_oil_export_register;
CREATE TRIGGER trg_data_oil_export_register_updated_at
    BEFORE UPDATE ON public.data_oil_export_register
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

-- ============================================================================
-- 4. Catalog rows.
-- ============================================================================

INSERT INTO public.data_datasets
    (dataset_key, label, description, table_name, period_column, period_kind,
     report_section_key, supports_reseed, display_order)
VALUES
    ('kernel_sales_lines', 'Kernel Sales',
     'Kernel sales invoice lines. Filtered by date rather than scoped to one period — an invoice '
     'belongs to its own date, not to a reporting week.',
     'data_kernel_sales_lines', 'sale_date', 'date_range', 'kernel_sales_lines', false, 20),
    ('oil_sales_lines', 'Oil & Protein Sales',
     'Local oil and protein sales lines, by product line.',
     'data_oil_sales_lines', 'sale_date', 'date_range', 'oil_sales_lines', false, 30),
    ('oil_export_register', 'Oil Export Register',
     'Bulk export invoices in USD with the rand conversion recorded per invoice.',
     'data_oil_export_register', 'export_date', 'date_range', NULL, false, 40)
ON CONFLICT (dataset_key) DO NOTHING;

-- ============================================================================
-- 5. RPCs. Every list is LIMIT-capped per BluePrint/supabase-database-rules.md §6.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_data_kernel_sales_lines(
    p_date_from date DEFAULT NULL,
    p_date_to   date DEFAULT NULL,
    p_limit     integer DEFAULT 100,
    p_offset    integer DEFAULT 0
)
RETURNS TABLE (
    id uuid, sale_date date, customer_id uuid, customer_name text, invoice_number text,
    item_code text, style_code text, description text, cartons numeric, quantity_kg numeric,
    price_per_kg numeric, vat_excl_zar numeric, vat_zar numeric, vat_incl_zar numeric,
    data_source text, edited_by_name text, edited_at timestamptz,
    data_quality_flags text[], notes text, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH filtered AS (
        SELECT s.* FROM public.data_kernel_sales_lines s
        WHERE (p_date_from IS NULL OR s.sale_date >= p_date_from)
          AND (p_date_to   IS NULL OR s.sale_date <= p_date_to)
    ), counted AS (SELECT count(*) AS n FROM filtered)
    SELECT f.id, f.sale_date, f.customer_id, f.customer_name, f.invoice_number, f.item_code,
           f.style_code, f.description, f.cartons, f.quantity_kg, f.price_per_kg,
           f.vat_excl_zar, f.vat_zar, f.vat_incl_zar, f.data_source,
           public.stock_history_user_label(f.edited_by), f.edited_at,
           f.data_quality_flags, f.notes, c.n
    FROM filtered f CROSS JOIN counted c
    ORDER BY f.sale_date DESC, f.invoice_number, f.id
    LIMIT LEAST(COALESCE(p_limit, 100), 500) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_data_kernel_sales_lines(date, date, integer, integer) IS
    'Paged kernel sales lines for a date range. p_limit capped at 500; total_count repeats per row.';

CREATE OR REPLACE FUNCTION public.upsert_data_kernel_sales_lines(
    p_rows jsonb, p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, rows_written integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0; v_ins integer := 0;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RETURN QUERY SELECT 0, 'p_rows must be a JSON array.', 0;
        RETURN;
    END IF;

    -- Rows carrying an id are updates; rows without are inserts.
    UPDATE public.data_kernel_sales_lines t
    SET sale_date      = COALESCE(NULLIF(r ->> 'sale_date', '')::date, t.sale_date),
        customer_id    = NULLIF(r ->> 'customer_id', '')::uuid,
        customer_name  = COALESCE(r ->> 'customer_name', t.customer_name),
        invoice_number = NULLIF(r ->> 'invoice_number', ''),
        item_code      = NULLIF(r ->> 'item_code', ''),
        style_code     = NULLIF(r ->> 'style_code', ''),
        description    = NULLIF(r ->> 'description', ''),
        cartons        = NULLIF(r ->> 'cartons', '')::numeric,
        quantity_kg    = COALESCE(NULLIF(r ->> 'quantity_kg', '')::numeric, 0),
        price_per_kg   = NULLIF(r ->> 'price_per_kg', '')::numeric,
        vat_excl_zar   = COALESCE(NULLIF(r ->> 'vat_excl_zar', '')::numeric, 0),
        vat_zar        = COALESCE(NULLIF(r ->> 'vat_zar', '')::numeric, 0),
        vat_incl_zar   = COALESCE(NULLIF(r ->> 'vat_incl_zar', '')::numeric, 0),
        notes          = NULLIF(r ->> 'notes', ''),
        edited_by      = p_actor_user_id,
        edited_at      = now(),
        data_source    = 'manual'
    FROM jsonb_array_elements(p_rows) r
    WHERE t.id = NULLIF(r ->> 'id', '')::uuid;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.data_kernel_sales_lines
        (sale_date, customer_id, customer_name, invoice_number, item_code, style_code, description,
         cartons, quantity_kg, price_per_kg, vat_excl_zar, vat_zar, vat_incl_zar, notes,
         data_source, edited_by, edited_at)
    SELECT NULLIF(r ->> 'sale_date', '')::date,
           NULLIF(r ->> 'customer_id', '')::uuid,
           COALESCE(r ->> 'customer_name', ''),
           NULLIF(r ->> 'invoice_number', ''),
           NULLIF(r ->> 'item_code', ''),
           NULLIF(r ->> 'style_code', ''),
           NULLIF(r ->> 'description', ''),
           NULLIF(r ->> 'cartons', '')::numeric,
           COALESCE(NULLIF(r ->> 'quantity_kg', '')::numeric, 0),
           NULLIF(r ->> 'price_per_kg', '')::numeric,
           COALESCE(NULLIF(r ->> 'vat_excl_zar', '')::numeric, 0),
           COALESCE(NULLIF(r ->> 'vat_zar', '')::numeric, 0),
           COALESCE(NULLIF(r ->> 'vat_incl_zar', '')::numeric, 0),
           NULLIF(r ->> 'notes', ''),
           'manual', p_actor_user_id, now()
    FROM jsonb_array_elements(p_rows) r
    WHERE NULLIF(r ->> 'id', '') IS NULL
      AND NULLIF(r ->> 'sale_date', '') IS NOT NULL;

    GET DIAGNOSTICS v_ins = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count + v_ins;
END;
$$;

COMMENT ON FUNCTION public.upsert_data_kernel_sales_lines(jsonb, uuid) IS
    'Bulk save of kernel sales lines in one round trip. Rows carrying an id are updated, rows '
    'without are inserted. Follows the p_rows jsonb-array convention — the client passes the array '
    'itself, never a JSON string.';

CREATE OR REPLACE FUNCTION public.delete_data_kernel_sales_line(p_id uuid)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    DELETE FROM public.data_kernel_sales_lines WHERE id = p_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 0, 'No such sales line.'; RETURN; END IF;
    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_data_oil_sales_lines(
    p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL,
    p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid, sale_date date, customer_id uuid, customer_name text, invoice_number text,
    item_code text, product_line text, description text, cartons numeric, quantity_kg numeric,
    price_per_kg numeric, vat_excl_zar numeric, vat_zar numeric, vat_incl_zar numeric,
    data_source text, edited_by_name text, edited_at timestamptz,
    data_quality_flags text[], notes text, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH filtered AS (
        SELECT s.* FROM public.data_oil_sales_lines s
        WHERE (p_date_from IS NULL OR s.sale_date >= p_date_from)
          AND (p_date_to   IS NULL OR s.sale_date <= p_date_to)
    ), counted AS (SELECT count(*) AS n FROM filtered)
    SELECT f.id, f.sale_date, f.customer_id, f.customer_name, f.invoice_number, f.item_code,
           f.product_line, f.description, f.cartons, f.quantity_kg, f.price_per_kg,
           f.vat_excl_zar, f.vat_zar, f.vat_incl_zar, f.data_source,
           public.stock_history_user_label(f.edited_by), f.edited_at,
           f.data_quality_flags, f.notes, c.n
    FROM filtered f CROSS JOIN counted c
    ORDER BY f.sale_date DESC, f.invoice_number, f.id
    LIMIT LEAST(COALESCE(p_limit, 100), 500) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.upsert_data_oil_sales_lines(
    p_rows jsonb, p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, rows_written integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0; v_ins integer := 0;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RETURN QUERY SELECT 0, 'p_rows must be a JSON array.', 0; RETURN;
    END IF;

    UPDATE public.data_oil_sales_lines t
    SET sale_date      = COALESCE(NULLIF(r ->> 'sale_date', '')::date, t.sale_date),
        customer_id    = NULLIF(r ->> 'customer_id', '')::uuid,
        customer_name  = COALESCE(r ->> 'customer_name', t.customer_name),
        invoice_number = NULLIF(r ->> 'invoice_number', ''),
        item_code      = NULLIF(r ->> 'item_code', ''),
        product_line   = NULLIF(r ->> 'product_line', ''),
        description    = NULLIF(r ->> 'description', ''),
        cartons        = NULLIF(r ->> 'cartons', '')::numeric,
        quantity_kg    = COALESCE(NULLIF(r ->> 'quantity_kg', '')::numeric, 0),
        price_per_kg   = NULLIF(r ->> 'price_per_kg', '')::numeric,
        vat_excl_zar   = COALESCE(NULLIF(r ->> 'vat_excl_zar', '')::numeric, 0),
        vat_zar        = COALESCE(NULLIF(r ->> 'vat_zar', '')::numeric, 0),
        vat_incl_zar   = COALESCE(NULLIF(r ->> 'vat_incl_zar', '')::numeric, 0),
        notes          = NULLIF(r ->> 'notes', ''),
        edited_by      = p_actor_user_id, edited_at = now(), data_source = 'manual'
    FROM jsonb_array_elements(p_rows) r
    WHERE t.id = NULLIF(r ->> 'id', '')::uuid;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.data_oil_sales_lines
        (sale_date, customer_id, customer_name, invoice_number, item_code, product_line,
         description, cartons, quantity_kg, price_per_kg, vat_excl_zar, vat_zar, vat_incl_zar,
         notes, data_source, edited_by, edited_at)
    SELECT NULLIF(r ->> 'sale_date', '')::date, NULLIF(r ->> 'customer_id', '')::uuid,
           COALESCE(r ->> 'customer_name', ''), NULLIF(r ->> 'invoice_number', ''),
           NULLIF(r ->> 'item_code', ''), NULLIF(r ->> 'product_line', ''),
           NULLIF(r ->> 'description', ''), NULLIF(r ->> 'cartons', '')::numeric,
           COALESCE(NULLIF(r ->> 'quantity_kg', '')::numeric, 0),
           NULLIF(r ->> 'price_per_kg', '')::numeric,
           COALESCE(NULLIF(r ->> 'vat_excl_zar', '')::numeric, 0),
           COALESCE(NULLIF(r ->> 'vat_zar', '')::numeric, 0),
           COALESCE(NULLIF(r ->> 'vat_incl_zar', '')::numeric, 0),
           NULLIF(r ->> 'notes', ''), 'manual', p_actor_user_id, now()
    FROM jsonb_array_elements(p_rows) r
    WHERE NULLIF(r ->> 'id', '') IS NULL AND NULLIF(r ->> 'sale_date', '') IS NOT NULL;

    GET DIAGNOSTICS v_ins = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count + v_ins;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_data_oil_sales_line(p_id uuid)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    DELETE FROM public.data_oil_sales_lines WHERE id = p_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 0, 'No such sales line.'; RETURN; END IF;
    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_data_oil_export_register(
    p_date_from date DEFAULT NULL, p_date_to date DEFAULT NULL,
    p_limit integer DEFAULT 100, p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid, export_date date, customer_id uuid, customer_name text, location_country text,
    document_number text, reference text, product_class text, price_per_kg_usd numeric,
    incoterm text, weight_kg numeric, usd_debit numeric, load_count numeric,
    usd_zar_rate numeric, rand_value numeric, data_source text, edited_by_name text,
    edited_at timestamptz, data_quality_flags text[], notes text, total_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH filtered AS (
        SELECT e.* FROM public.data_oil_export_register e
        WHERE (p_date_from IS NULL OR e.export_date >= p_date_from)
          AND (p_date_to   IS NULL OR e.export_date <= p_date_to)
    ), counted AS (SELECT count(*) AS n FROM filtered)
    SELECT f.id, f.export_date, f.customer_id, f.customer_name, f.location_country,
           f.document_number, f.reference, f.product_class, f.price_per_kg_usd, f.incoterm,
           f.weight_kg, f.usd_debit, f.load_count, f.usd_zar_rate, f.rand_value, f.data_source,
           public.stock_history_user_label(f.edited_by), f.edited_at,
           f.data_quality_flags, f.notes, c.n
    FROM filtered f CROSS JOIN counted c
    ORDER BY f.export_date DESC, f.document_number, f.id
    LIMIT LEAST(COALESCE(p_limit, 100), 500) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

CREATE OR REPLACE FUNCTION public.upsert_data_oil_export_register(
    p_rows jsonb, p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, rows_written integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer := 0; v_ins integer := 0;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RETURN QUERY SELECT 0, 'p_rows must be a JSON array.', 0; RETURN;
    END IF;

    UPDATE public.data_oil_export_register t
    SET export_date      = COALESCE(NULLIF(r ->> 'export_date', '')::date, t.export_date),
        customer_id      = NULLIF(r ->> 'customer_id', '')::uuid,
        customer_name    = COALESCE(r ->> 'customer_name', t.customer_name),
        location_country = NULLIF(r ->> 'location_country', ''),
        document_number  = NULLIF(r ->> 'document_number', ''),
        reference        = NULLIF(r ->> 'reference', ''),
        product_class    = NULLIF(r ->> 'product_class', ''),
        price_per_kg_usd = NULLIF(r ->> 'price_per_kg_usd', '')::numeric,
        incoterm         = NULLIF(r ->> 'incoterm', ''),
        weight_kg        = NULLIF(r ->> 'weight_kg', '')::numeric,
        usd_debit        = NULLIF(r ->> 'usd_debit', '')::numeric,
        load_count       = NULLIF(r ->> 'load_count', '')::numeric,
        usd_zar_rate     = NULLIF(r ->> 'usd_zar_rate', '')::numeric,
        rand_value       = NULLIF(r ->> 'rand_value', '')::numeric,
        notes            = NULLIF(r ->> 'notes', ''),
        edited_by = p_actor_user_id, edited_at = now(), data_source = 'manual'
    FROM jsonb_array_elements(p_rows) r
    WHERE t.id = NULLIF(r ->> 'id', '')::uuid;
    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.data_oil_export_register
        (export_date, customer_id, customer_name, location_country, document_number, reference,
         product_class, price_per_kg_usd, incoterm, weight_kg, usd_debit, load_count,
         usd_zar_rate, rand_value, notes, data_source, edited_by, edited_at)
    SELECT NULLIF(r ->> 'export_date', '')::date, NULLIF(r ->> 'customer_id', '')::uuid,
           COALESCE(r ->> 'customer_name', ''), NULLIF(r ->> 'location_country', ''),
           NULLIF(r ->> 'document_number', ''), NULLIF(r ->> 'reference', ''),
           NULLIF(r ->> 'product_class', ''), NULLIF(r ->> 'price_per_kg_usd', '')::numeric,
           NULLIF(r ->> 'incoterm', ''), NULLIF(r ->> 'weight_kg', '')::numeric,
           NULLIF(r ->> 'usd_debit', '')::numeric, NULLIF(r ->> 'load_count', '')::numeric,
           NULLIF(r ->> 'usd_zar_rate', '')::numeric, NULLIF(r ->> 'rand_value', '')::numeric,
           NULLIF(r ->> 'notes', ''), 'manual', p_actor_user_id, now()
    FROM jsonb_array_elements(p_rows) r
    WHERE NULLIF(r ->> 'id', '') IS NULL AND NULLIF(r ->> 'export_date', '') IS NOT NULL;

    GET DIAGNOSTICS v_ins = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count + v_ins;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_data_oil_export_register_row(p_id uuid)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    DELETE FROM public.data_oil_export_register WHERE id = p_id;
    IF NOT FOUND THEN RETURN QUERY SELECT 0, 'No such export row.'; RETURN; END IF;
    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- ============================================================================
-- 6. RBAC — reads to every role, writes to the reporting roles only.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.get_data_kernel_sales_lines(date, date, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_oil_sales_lines(date, date, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_oil_export_register(date, date, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_data_kernel_sales_lines(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_data_oil_sales_lines(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_data_oil_export_register(jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_data_kernel_sales_line(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_data_oil_sales_line(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_data_oil_export_register_row(uuid) TO anon, authenticated, service_role;

DO $$
DECLARE v_role record; v_fn text;
BEGIN
    FOR v_role IN SELECT id, role_name FROM public.roles LOOP
        FOREACH v_fn IN ARRAY ARRAY[
            'get_data_kernel_sales_lines', 'get_data_oil_sales_lines', 'get_data_oil_export_register'
        ] LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true) ON CONFLICT DO NOTHING;
        END LOOP;
        IF v_role.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager') THEN
            FOREACH v_fn IN ARRAY ARRAY[
                'upsert_data_kernel_sales_lines', 'upsert_data_oil_sales_lines',
                'upsert_data_oil_export_register', 'delete_data_kernel_sales_line',
                'delete_data_oil_sales_line', 'delete_data_oil_export_register_row'
            ] LOOP
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true) ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
