-- Report builder (Phase 1 of the Sales Exec reporting feature) — foundations.
--
-- Replaces "Macavation Weekly and Monthly Reports.xlsx" (63 sheets) with an in-app report builder.
-- This migration lays the config layer only: financial-year/period helpers, a configurable kernel
-- style registry, and the section/template/metric registry that makes report content data-driven
-- instead of hardcoded. Report instances, targets and the metric resolvers arrive in later
-- migrations (20260817100000+).
--
-- Convention (matching 20260812100000 and 20260816090000): SECURITY DEFINER, SET search_path =
-- public, RLS enabled with service_role-only direct table access; every browser call goes through
-- an RPC as role anon, because WebPortal/js/data-functions.js calls callSupabaseRpc with the anon
-- key whenever the portal token is not a Supabase Auth JWT — which it never is. Granting to
-- authenticated alone would break the feature for real logged-in users.
--
-- Every list RPC below is LIMIT-capped per BluePrint/supabase-database-rules.md §6 ("ALL queries
-- use LIMIT — never select unbounded rows").
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260817090000_report_builder_foundations.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 0. Shared updated_at trigger for this feature's mutable config tables.
--
-- BluePrint/supabase-database-rules.md §5 asks for updated_at triggers on mutable tables. No
-- repo-wide one is attached today (updated_at is set by hand inside each RPC), so this feature
-- brings its own rather than relying on every future writer remembering.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.report_touch_updated_at() IS
    'BEFORE UPDATE trigger for the report-builder config tables. Internal: granted to no role.';

-- ============================================================================
-- 1. Financial-year and period helpers.
--
-- Macavation runs an April-March financial year: "FYE 2027" = 1 Apr 2026 - 31 Mar 2027. Nothing
-- like this existed anywhere in the codebase before this migration.
--
-- A WEEKLY report is identified by its Monday, never by a week number. Pete's spreadsheet numbered
-- weeks per calendar month and produced real collisions ("September - Week 4" and "October - Week 1"
-- both cover 29 Sep - 5 Oct 2025). Anchoring on the Monday date makes that class of duplicate
-- structurally impossible. A MONTHLY report is identified by the first of its month.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_fy_of_date(p_date date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT EXTRACT(YEAR FROM p_date)::integer
           + CASE WHEN EXTRACT(MONTH FROM p_date) >= 4 THEN 1 ELSE 0 END;
$$;

COMMENT ON FUNCTION public.report_fy_of_date(date) IS
    'Financial year ending, for an April-March FY. Aug 2026 -> 2027 (FYE 2027 = Apr 2026-Mar 2027).';

CREATE OR REPLACE FUNCTION public.report_fy_month_index(p_date date)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
    -- April = 1 ... March = 12.
    SELECT ((EXTRACT(MONTH FROM p_date)::integer + 8) % 12) + 1;
$$;

COMMENT ON FUNCTION public.report_fy_month_index(date) IS
    'Position of the month within the April-March financial year. April = 1, March = 12.';

CREATE OR REPLACE FUNCTION public.report_week_start(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
    -- ISO day-of-week: Monday = 1. Subtracting (isodow - 1) days always lands on that week's Monday.
    SELECT (p_date - (EXTRACT(ISODOW FROM p_date)::integer - 1))::date;
$$;

COMMENT ON FUNCTION public.report_week_start(date) IS
    'The Monday of the week containing p_date. A weekly report is identified by this value.';

CREATE OR REPLACE FUNCTION public.report_normalise_period_start(p_period_type text, p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
               WHEN p_period_type = 'weekly'  THEN public.report_week_start(p_date)
               WHEN p_period_type = 'monthly' THEN DATE_TRUNC('month', p_date)::date
               ELSE NULL
           END;
$$;

COMMENT ON FUNCTION public.report_normalise_period_start(text, date) IS
    'Snaps any date to its canonical period start: the Monday (weekly) or the 1st (monthly). '
    'Returns NULL for an unknown period type so callers fail loudly rather than silently.';

CREATE OR REPLACE FUNCTION public.report_period_end(p_period_type text, p_period_start date)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
               WHEN p_period_type = 'weekly'  THEN (p_period_start + 6)::date
               WHEN p_period_type = 'monthly' THEN (DATE_TRUNC('month', p_period_start)
                                                    + INTERVAL '1 month - 1 day')::date
               ELSE NULL
           END;
$$;

COMMENT ON FUNCTION public.report_period_end(text, date) IS
    'Inclusive last day of the period. Weekly = Monday + 6 (Sunday); monthly = month end.';

CREATE OR REPLACE FUNCTION public.report_period_label(p_period_type text, p_period_start date)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
               WHEN p_period_type = 'weekly' THEN
                   'Week of ' || TO_CHAR(p_period_start, 'DD Mon YYYY')
               WHEN p_period_type = 'monthly' THEN
                   TO_CHAR(p_period_start, 'Month YYYY')
                   || ' (FYE ' || public.report_fy_of_date(p_period_start) || ')'
               ELSE NULL
           END;
$$;

COMMENT ON FUNCTION public.report_period_label(text, date) IS
    'Human label for a period. Generated, never typed — Pete''s workbook had a monthly sheet '
    'titled "November" whose own start/end dates were 1-31 October; a derived label cannot drift '
    'from the dates it describes.';

CREATE OR REPLACE FUNCTION public.get_report_current_period(p_period_type text)
RETURNS TABLE (
    period_type    text,
    period_start   date,
    period_end     date,
    fy             integer,
    fy_month_index integer,
    period_label   text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p_period_type,
           s.period_start,
           public.report_period_end(p_period_type, s.period_start),
           public.report_fy_of_date(s.period_start),
           public.report_fy_month_index(s.period_start),
           public.report_period_label(p_period_type, s.period_start)
    FROM (SELECT public.report_normalise_period_start(p_period_type, CURRENT_DATE) AS period_start) s
    WHERE s.period_start IS NOT NULL;
$$;

COMMENT ON FUNCTION public.get_report_current_period(text) IS
    'The period containing today, for p_period_type in (weekly, monthly). Returns no rows for an '
    'unknown period type.';

-- ============================================================================
-- 2. kernel_style_registry — configurable kernel style/grade reference data.
--
-- Why a table and not a hardcoded list: Pete's report uses SP, 1S, 4L, 5M, 5, 6, 7/8, BHO, BLO.
-- kernel_packing_yield_by_style (20260707150000) instead knows SP, 0, 1, 1S, 4L, 5, 6, 7/8,
-- Butter High Oil, Butter Low Oil. "5M" appears nowhere in the schema and "0"/"1" appear nowhere
-- in Pete's report. Seeding either list as gospel would silently drop a style from every report,
-- so the mapping is data that a user can correct without a migration.
--
-- packing_field is the key inside kernel.packing_data[] that carries this style's kg. It is NULL
-- for a style the packing capture cannot currently produce (5M today) — such a style still renders
-- in the report, as a row the resolver reports NULL for, rather than vanishing.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kernel_style_registry (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    style_code     text NOT NULL,
    label          text NOT NULL,
    packing_field  text NULL,
    cartons_field  text NULL,
    category       text NOT NULL DEFAULT 'sound_kernel',
    display_order  integer NOT NULL DEFAULT 0,
    is_active      boolean NOT NULL DEFAULT true,
    notes          text NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT kernel_style_registry_style_code_key UNIQUE (style_code),
    CONSTRAINT kernel_style_registry_style_code_check
        CHECK (length(TRIM(style_code)) BETWEEN 1 AND 20),
    CONSTRAINT kernel_style_registry_category_check
        CHECK (category IN ('sound_kernel', 'butter', 'other'))
);

COMMENT ON TABLE public.kernel_style_registry IS
    'Configurable kernel style/grade reference data for the report builder. Reconciles the styles '
    'Pete reports on with the keys kernel.packing_data actually stores. Adding a style is a row, '
    'not a migration.';
COMMENT ON COLUMN public.kernel_style_registry.packing_field IS
    'Key inside a kernel.packing_data[] element holding this style''s kg (e.g. sk_4l_qty). NULL '
    'means production cannot currently capture this style — UNVERIFIED whether such a style is a '
    'real grade or a labelling variant; confirm with Pete and the factory before relying on it.';
COMMENT ON COLUMN public.kernel_style_registry.cartons_field IS
    'Matching carton-count key inside kernel.packing_data[] (e.g. sk_4l_cartons). NULL if none.';

ALTER TABLE public.kernel_style_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kernel_style_registry FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kernel_style_registry TO service_role;

CREATE INDEX IF NOT EXISTS ix_kernel_style_registry_active_order
    ON public.kernel_style_registry (is_active, display_order);

DROP TRIGGER IF EXISTS trg_kernel_style_registry_updated_at ON public.kernel_style_registry;
CREATE TRIGGER trg_kernel_style_registry_updated_at
    BEFORE UPDATE ON public.kernel_style_registry
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

-- Seed: the UNION of both lists, so nothing is hidden and the mismatch is visible in the report.
-- packing_field values are the keys confirmed present in kernel.packing_data on both projects
-- (see kernel_packing_yield_by_style, migrations/20260707150000_fix_kernel_soh_remaining_by_style.sql).
INSERT INTO public.kernel_style_registry
    (style_code, label, packing_field, cartons_field, category, display_order, notes)
VALUES
    ('SP',  'Style SP',              'sk_sp_qty',  'sk_sp_cartons',  'sound_kernel', 10, NULL),
    ('0',   'Style 0',               'sk_0_qty',   'sk_0_cartons',   'sound_kernel', 20,
        'In packing capture but absent from Pete''s report — confirm whether still produced.'),
    ('1',   'Style 1',               'sk_1_qty',   'sk_1_cartons',   'sound_kernel', 30,
        'In packing capture but absent from Pete''s report — confirm whether still produced.'),
    ('1S',  'Style 1 Small',         'sk_1s_qty',  'sk_1s_cartons',  'sound_kernel', 40, NULL),
    ('4L',  'Style 4 Large',         'sk_4l_qty',  'sk_4l_cartons',  'sound_kernel', 50, NULL),
    ('5',   'Style 5',               'sk_5_qty',   'sk_5_cartons',   'sound_kernel', 60, NULL),
    ('5M',  'Style 5 Medium',        NULL,         NULL,             'sound_kernel', 65,
        'UNVERIFIED: reported by Pete but has no packing_data field. Confirm with the factory '
        'whether 5M is a distinct grade needing capture, or a labelling variant of 5.'),
    ('6',   'Style 6',               'sk_6_qty',   'sk_6_cartons',   'sound_kernel', 70, NULL),
    ('7/8', 'Style 7/8',             'bt_78_qty',  'bt_78_cartons',  'butter',       80, NULL),
    ('BHO', 'Butter High Oil',       'bt_high_qty','bt_high_cartons','butter',       90, NULL),
    ('BLO', 'Butter Low Oil',        'bt_low_qty', 'bt_low_cartons', 'butter',      100, NULL)
ON CONFLICT (style_code) DO NOTHING;

-- ============================================================================
-- 3. report_sections — the superset catalogue of every section Pete's workbook has ever carried.
--
-- The user's decision is one standard template with per-section toggles, so this list is the
-- superset and a report switches sections on/off rather than each report having its own shape.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_sections (
    section_key   text PRIMARY KEY,
    label         text NOT NULL,
    description   text NULL,
    render_kind   text NOT NULL,
    period_types  text[] NOT NULL DEFAULT ARRAY['weekly', 'monthly'],
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_sections_render_kind_check
        CHECK (render_kind IN ('metric_table', 'line_table', 'tracking_table'))
);

COMMENT ON TABLE public.report_sections IS
    'Catalogue of report sections. render_kind drives how the UI and PDF draw it: metric_table = '
    'Description/System/Entered/Target/Achieved% rows; line_table = tabular data rows (sales '
    'lines, stock-on-hand breakdowns); tracking_table = the FY-vs-FY cumulative comparison.';

ALTER TABLE public.report_sections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_sections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_sections TO service_role;

DROP TRIGGER IF EXISTS trg_report_sections_updated_at ON public.report_sections;
CREATE TRIGGER trg_report_sections_updated_at
    BEFORE UPDATE ON public.report_sections
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

INSERT INTO public.report_sections (section_key, label, description, render_kind, period_types)
VALUES
    ('kernel_production', 'Kernel Processing', 'Nut in shell cracking and sound kernel packing',
        'metric_table', ARRAY['weekly', 'monthly']),
    ('oil_production', 'Oil Processing', 'Cosmetic oil, EVMO, B-grade, protein, filter fines, cake',
        'metric_table', ARRAY['weekly', 'monthly']),
    ('kernel_sales', 'Kernel Sales', 'Kernel sales value against target',
        'metric_table', ARRAY['weekly', 'monthly']),
    ('oil_sales', 'Oil & Protein Sales', 'Oil and protein sales value against target',
        'metric_table', ARRAY['weekly', 'monthly']),
    ('kernel_sales_lines', 'Kernel Sales Lines', 'Individual kernel sales for the period',
        'line_table', ARRAY['weekly', 'monthly']),
    ('oil_sales_lines', 'Oil & Protein Sales Lines', 'Individual oil/protein sales for the period',
        'line_table', ARRAY['weekly', 'monthly']),
    ('kernel_soh', 'Kernel Stock on Hand', 'Kernel stock on hand by style',
        'line_table', ARRAY['weekly', 'monthly']),
    ('oil_soh', 'Oil & Protein Stock on Hand', 'Crude, extra virgin, protein and filter fines',
        'line_table', ARRAY['weekly', 'monthly']),
    ('rm_soh', 'Raw Material Stock on Hand', 'Raw material stock with weeks of cover',
        'line_table', ARRAY['weekly', 'monthly']),
    ('nis_soh', 'Nut in Shell Stock on Hand', 'Uncracked nut in shell by supplier',
        'line_table', ARRAY['weekly', 'monthly']),
    ('upcoming_sales', 'Upcoming Sales', 'Committed orders by customer and style',
        'line_table', ARRAY['weekly', 'monthly']),
    ('nis_procurement_pipeline', 'Nut in Shell Procurement Pipeline',
        'Scheduled incoming deliveries by supplier', 'line_table', ARRAY['weekly', 'monthly']),
    ('forward_month_grid', 'Forward Month Planning',
        'Stock, forecast production, orders and surplus/deficit by style',
        'line_table', ARRAY['weekly']),
    ('nis_procured', 'Nut in Shell Procured', 'Nut in shell procured against target',
        'metric_table', ARRAY['monthly']),
    ('nis_procurement_tracking', 'Nut in Shell Procurement Tracking',
        'Cumulative procurement, financial year against prior financial year',
        'tracking_table', ARRAY['monthly']),
    ('sound_kernel_recovery_tracking', 'Sound Kernel Recovery Tracking',
        'Cumulative sound kernel recovery, financial year against prior financial year',
        'tracking_table', ARRAY['monthly']),
    ('kernel_sales_tracking', 'Kernel Sales Tracking',
        'Cumulative kernel sales, financial year against prior financial year',
        'tracking_table', ARRAY['monthly']),
    ('kernel_sales_by_style', 'Kernel Sales by Style', 'Value, price per kg and quantity by style',
        'line_table', ARRAY['monthly']),
    ('kernel_stock_report', 'Kernel Stock Report', 'Stock, cost price and book value by style',
        'line_table', ARRAY['monthly']),
    ('rm_stock_report', 'Raw Material Stock Report', 'Raw material stock and value',
        'line_table', ARRAY['monthly']),
    ('oil_stock_report', 'Oil Stock Report', 'Oil and protein stock and value',
        'line_table', ARRAY['monthly']),
    ('oil_sales_by_line', 'Oil & Protein Sales by Product Line',
        'Protein, extra virgin, crude cosmetic and cake against target',
        'metric_table', ARRAY['monthly'])
ON CONFLICT (section_key) DO NOTHING;

-- ============================================================================
-- 4. report_templates + report_template_sections — the two standard templates.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_templates (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL,
    name         text NOT NULL,
    period_type  text NOT NULL,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_templates_code_key UNIQUE (code),
    CONSTRAINT report_templates_period_type_check CHECK (period_type IN ('weekly', 'monthly'))
);

COMMENT ON TABLE public.report_templates IS
    'Report templates. One standard template per period type; a report toggles sections on or off '
    'rather than choosing between template variants.';

ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_templates TO service_role;

DROP TRIGGER IF EXISTS trg_report_templates_updated_at ON public.report_templates;
CREATE TRIGGER trg_report_templates_updated_at
    BEFORE UPDATE ON public.report_templates
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

INSERT INTO public.report_templates (code, name, period_type)
VALUES
    ('standard_weekly',  'Macavation Weekly Report',  'weekly'),
    ('standard_monthly', 'Macavation Monthly Report', 'monthly')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.report_template_sections (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     uuid NOT NULL REFERENCES public.report_templates (id) ON DELETE CASCADE,
    section_key     text NOT NULL REFERENCES public.report_sections (section_key) ON DELETE RESTRICT,
    display_order   integer NOT NULL DEFAULT 0,
    default_enabled boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_template_sections_unique UNIQUE (template_id, section_key)
);

COMMENT ON TABLE public.report_template_sections IS
    'Which sections a template offers, in what order, and whether each starts switched on.';

ALTER TABLE public.report_template_sections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_template_sections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_template_sections TO service_role;

CREATE INDEX IF NOT EXISTS ix_report_template_sections_template
    ON public.report_template_sections (template_id, display_order);
CREATE INDEX IF NOT EXISTS ix_report_template_sections_section
    ON public.report_template_sections (section_key);

-- Every section whose period_types contains the template's period type, ordered as the catalogue
-- lists them. Production and sales default on; the heavier planning sections default off so a new
-- report opens short and Pete switches on what that week needs.
INSERT INTO public.report_template_sections (template_id, section_key, display_order, default_enabled)
SELECT t.id,
       s.section_key,
       (ROW_NUMBER() OVER (PARTITION BY t.id ORDER BY s.section_key))::integer * 10,
       s.section_key NOT IN ('forward_month_grid', 'kernel_stock_report', 'rm_stock_report',
                             'oil_stock_report')
FROM public.report_templates t
JOIN public.report_sections s ON t.period_type = ANY (s.period_types)
WHERE s.is_active
ON CONFLICT (template_id, section_key) DO NOTHING;

-- ============================================================================
-- 5. report_metrics — the metric registry.
--
-- source_kind is a small fixed vocabulary that a human writes SQL for exactly once (in the
-- resolver migration). Everything parametric — which style, which oil stream, which product line —
-- is source_args data. Adding a new metric of an existing kind is therefore one INSERT, with no
-- migration and no code deploy.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_metrics (
    metric_key    text PRIMARY KEY,
    label         text NOT NULL,
    section_key   text NOT NULL REFERENCES public.report_sections (section_key) ON DELETE RESTRICT,
    division      text NOT NULL,
    unit          text NOT NULL,
    aggregation   text NOT NULL DEFAULT 'sum_over_period',
    source_kind   text NOT NULL,
    source_args   jsonb NOT NULL DEFAULT '{}'::jsonb,
    period_types  text[] NOT NULL DEFAULT ARRAY['weekly', 'monthly'],
    has_target    boolean NOT NULL DEFAULT true,
    display_order integer NOT NULL DEFAULT 0,
    is_active     boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_metrics_division_check
        CHECK (division IN ('kernel', 'oil', 'finance', 'all')),
    CONSTRAINT report_metrics_unit_check
        CHECK (unit IN ('kg', 'mt', 'l', 'pct', 'zar', 'usd', 'cartons', 'count')),
    CONSTRAINT report_metrics_aggregation_check
        CHECK (aggregation IN ('sum_over_period', 'as_at_period_end', 'count_over_period')),
    CONSTRAINT report_metrics_source_kind_check
        CHECK (source_kind IN ('kernel_cracking_kg', 'kernel_packing_kg_total',
                               'kernel_packing_kg_by_style', 'kernel_nis_procured_kg',
                               'oil_produced_by_stream', 'sales_kernel_sum', 'sales_oil_sum',
                               'sales_oil_by_product', 'manual'))
);

COMMENT ON TABLE public.report_metrics IS
    'Registry of the Description/Achieved/Target rows a report can show. Tabular content (sales '
    'lines, stock breakdowns) is not modelled here — those are report_instance_lines.';
COMMENT ON COLUMN public.report_metrics.source_kind IS
    'Which resolver branch computes this metric. Adding a new KIND needs a migration; adding a new '
    'metric of an existing kind does not.';
COMMENT ON COLUMN public.report_metrics.aggregation IS
    'sum_over_period totals the period. as_at_period_end is a stock level, which is only knowable '
    'as at now — a published report freezes it precisely because it cannot be recomputed later.';

ALTER TABLE public.report_metrics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_metrics FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_metrics TO service_role;

CREATE INDEX IF NOT EXISTS ix_report_metrics_section
    ON public.report_metrics (section_key, display_order);

DROP TRIGGER IF EXISTS trg_report_metrics_updated_at ON public.report_metrics;
CREATE TRIGGER trg_report_metrics_updated_at
    BEFORE UPDATE ON public.report_metrics
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

-- Seed: exactly the Achieved/Target rows Pete's workbook carries.
--
-- NOTE on kernel_nis_cracking_kg: kernel_day_kg (20260813093000) prefers cracking_data.endqty1,
-- which docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md §0.1 establishes is an INPUT-side
-- quantity — nut fed through the cracker, not kernel out. That is the correct meaning for "Nut in
-- Shell Cracking". The same document §0.4 records that the underlying capture is unreliable in
-- both directions, which is why every figure in this feature is overridable with a reason.
INSERT INTO public.report_metrics
    (metric_key, label, section_key, division, unit, aggregation, source_kind, source_args,
     period_types, display_order)
VALUES
    ('kernel_nis_cracking_kg', 'Nut in Shell Cracking', 'kernel_production', 'kernel', 'kg',
        'sum_over_period', 'kernel_cracking_kg', '{}'::jsonb, ARRAY['weekly', 'monthly'], 10),
    ('kernel_sk_packing_kg', 'Sound Kernel Packing', 'kernel_production', 'kernel', 'kg',
        'sum_over_period', 'kernel_packing_kg_total', '{}'::jsonb, ARRAY['weekly', 'monthly'], 20),

    ('oil_cosmetic_produced_kg', 'Cosmetic Oil Produced', 'oil_production', 'oil', 'kg',
        'sum_over_period', 'oil_produced_by_stream', '{"stream": "cosmetic"}'::jsonb,
        ARRAY['weekly', 'monthly'], 10),
    ('oil_ev_produced_kg', 'EV Oil Produced', 'oil_production', 'oil', 'kg',
        'sum_over_period', 'oil_produced_by_stream', '{"stream": "extra_virgin"}'::jsonb,
        ARRAY['weekly', 'monthly'], 20),
    ('oil_bgrade_produced_kg', 'B-grade Produced', 'oil_production', 'oil', 'kg',
        'sum_over_period', 'oil_produced_by_stream', '{"stream": "b_grade"}'::jsonb,
        ARRAY['weekly', 'monthly'], 30),
    ('oil_protein_produced_kg', 'Protein Produced', 'oil_production', 'oil', 'kg',
        'sum_over_period', 'oil_produced_by_stream', '{"stream": "protein"}'::jsonb,
        ARRAY['weekly', 'monthly'], 40),
    ('oil_filter_fines_produced_kg', 'Filter Fines Produced', 'oil_production', 'oil', 'kg',
        'sum_over_period', 'oil_produced_by_stream', '{"stream": "filter_fines"}'::jsonb,
        ARRAY['weekly', 'monthly'], 50),
    ('oil_cake_produced_kg', 'Cake Produced', 'oil_production', 'oil', 'kg',
        'sum_over_period', 'oil_produced_by_stream', '{"stream": "cake"}'::jsonb,
        ARRAY['weekly', 'monthly'], 60),

    ('kernel_sales_excl_vat_zar', 'Sales (Excl VAT)', 'kernel_sales', 'finance', 'zar',
        'sum_over_period', 'sales_kernel_sum', '{}'::jsonb, ARRAY['weekly', 'monthly'], 10),
    ('oil_sales_excl_vat_zar', 'Sales (Excl VAT)', 'oil_sales', 'finance', 'zar',
        'sum_over_period', 'sales_oil_sum', '{}'::jsonb, ARRAY['weekly', 'monthly'], 10),

    ('nis_procured_kg', 'Nut in Shell Procured', 'nis_procured', 'kernel', 'kg',
        'sum_over_period', 'kernel_nis_procured_kg', '{}'::jsonb, ARRAY['monthly'], 10),

    ('oil_sales_protein_zar', 'Protein + Crispies', 'oil_sales_by_line', 'finance', 'zar',
        'sum_over_period', 'sales_oil_by_product', '{"product": "protein"}'::jsonb,
        ARRAY['monthly'], 10),
    ('oil_sales_extra_virgin_zar', 'Extra Virgin Oil', 'oil_sales_by_line', 'finance', 'zar',
        'sum_over_period', 'sales_oil_by_product', '{"product": "extra_virgin"}'::jsonb,
        ARRAY['monthly'], 20),
    ('oil_sales_crude_cosmetic_zar', 'Crude Cosmetic Oil', 'oil_sales_by_line', 'finance', 'zar',
        'sum_over_period', 'sales_oil_by_product', '{"product": "crude_cosmetic"}'::jsonb,
        ARRAY['monthly'], 30),
    ('oil_sales_cake_zar', 'Cake', 'oil_sales_by_line', 'finance', 'zar',
        'sum_over_period', 'sales_oil_by_product', '{"product": "cake"}'::jsonb,
        ARRAY['monthly'], 40)
ON CONFLICT (metric_key) DO NOTHING;

-- ============================================================================
-- 6. Read RPCs. Every one is LIMIT-capped.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kernel_styles(p_include_inactive boolean DEFAULT false)
RETURNS TABLE (
    id            uuid,
    style_code    text,
    label         text,
    packing_field text,
    cartons_field text,
    category      text,
    display_order integer,
    is_active     boolean,
    notes         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT k.id, k.style_code, k.label, k.packing_field, k.cartons_field, k.category,
           k.display_order, k.is_active, k.notes
    FROM public.kernel_style_registry k
    WHERE COALESCE(p_include_inactive, false) OR k.is_active
    ORDER BY k.display_order, k.style_code
    LIMIT 200;
$$;

COMMENT ON FUNCTION public.get_kernel_styles(boolean) IS
    'Kernel style reference data for the report builder and stock screens. Capped at 200 rows.';

CREATE OR REPLACE FUNCTION public.get_report_sections(p_period_type text DEFAULT NULL)
RETURNS TABLE (
    section_key  text,
    label        text,
    description  text,
    render_kind  text,
    period_types text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT s.section_key, s.label, s.description, s.render_kind, s.period_types
    FROM public.report_sections s
    WHERE s.is_active
      AND (p_period_type IS NULL OR p_period_type = ANY (s.period_types))
    ORDER BY s.section_key
    LIMIT 200;
$$;

COMMENT ON FUNCTION public.get_report_sections(text) IS
    'Report section catalogue, optionally filtered to one period type. Capped at 200 rows.';

CREATE OR REPLACE FUNCTION public.get_report_templates(p_period_type text DEFAULT NULL)
RETURNS TABLE (
    id           uuid,
    code         text,
    name         text,
    period_type  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT t.id, t.code, t.name, t.period_type
    FROM public.report_templates t
    WHERE t.is_active
      AND (p_period_type IS NULL OR t.period_type = p_period_type)
    ORDER BY t.period_type
    LIMIT 50;
$$;

COMMENT ON FUNCTION public.get_report_templates(text) IS
    'Active report templates, optionally filtered to one period type. Capped at 50 rows.';

CREATE OR REPLACE FUNCTION public.get_report_metrics(p_section_key text DEFAULT NULL,
                                                     p_period_type text DEFAULT NULL)
RETURNS TABLE (
    metric_key    text,
    label         text,
    section_key   text,
    division      text,
    unit          text,
    aggregation   text,
    source_kind   text,
    source_args   jsonb,
    has_target    boolean,
    display_order integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT m.metric_key, m.label, m.section_key, m.division, m.unit, m.aggregation,
           m.source_kind, m.source_args, m.has_target, m.display_order
    FROM public.report_metrics m
    WHERE m.is_active
      AND (p_section_key IS NULL OR m.section_key = p_section_key)
      AND (p_period_type IS NULL OR p_period_type = ANY (m.period_types))
    ORDER BY m.section_key, m.display_order, m.metric_key
    LIMIT 300;
$$;

COMMENT ON FUNCTION public.get_report_metrics(text, text) IS
    'Metric registry, optionally filtered by section and/or period type. Capped at 300 rows.';

CREATE OR REPLACE FUNCTION public.get_report_template_sections(p_template_id uuid)
RETURNS TABLE (
    section_key     text,
    label           text,
    description     text,
    render_kind     text,
    display_order   integer,
    default_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ts.section_key, s.label, s.description, s.render_kind, ts.display_order,
           ts.default_enabled
    FROM public.report_template_sections ts
    JOIN public.report_sections s ON s.section_key = ts.section_key
    WHERE ts.template_id = p_template_id
      AND s.is_active
    ORDER BY ts.display_order, ts.section_key
    LIMIT 200;
$$;

COMMENT ON FUNCTION public.get_report_template_sections(uuid) IS
    'Sections offered by a template, in display order, with their default on/off state. Capped at '
    '200 rows.';

-- ============================================================================
-- 7. Style maintenance RPC — the user asked for styles to be addable without a migration.
--
-- Write path, so it is scoped to the roles that own reporting rather than granted to every role.
-- The caller's user id is accepted for attribution only; it is NOT an authorisation check (the
-- browser holds the public anon key and could pass any uuid — the same caveat recorded in
-- migrations/20260815110000_generic_has_action_gate.sql). Menu and button gating is enforced
-- client-side by features/role_features and actions/role_actions.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_kernel_style(
    p_style_code    text,
    p_label         text,
    p_packing_field text DEFAULT NULL,
    p_cartons_field text DEFAULT NULL,
    p_category      text DEFAULT 'sound_kernel',
    p_display_order integer DEFAULT 0,
    p_is_active     boolean DEFAULT true,
    p_notes         text DEFAULT NULL
)
RETURNS TABLE (success integer, error text, style_code text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code text := NULLIF(TRIM(COALESCE(p_style_code, '')), '');
    v_label text := NULLIF(TRIM(COALESCE(p_label, '')), '');
BEGIN
    IF v_code IS NULL OR length(v_code) > 20 THEN
        RETURN QUERY SELECT 0, 'Style code is required and must be 20 characters or fewer.', NULL::text;
        RETURN;
    END IF;
    IF v_label IS NULL THEN
        RETURN QUERY SELECT 0, 'Label is required.', NULL::text;
        RETURN;
    END IF;
    IF COALESCE(p_category, '') NOT IN ('sound_kernel', 'butter', 'other') THEN
        RETURN QUERY SELECT 0, 'Category must be sound_kernel, butter or other.', NULL::text;
        RETURN;
    END IF;

    INSERT INTO public.kernel_style_registry
        (style_code, label, packing_field, cartons_field, category, display_order, is_active, notes)
    VALUES
        (v_code, v_label, NULLIF(TRIM(COALESCE(p_packing_field, '')), ''),
         NULLIF(TRIM(COALESCE(p_cartons_field, '')), ''), p_category,
         COALESCE(p_display_order, 0), COALESCE(p_is_active, true), p_notes)
    ON CONFLICT (style_code) DO UPDATE
        SET label         = EXCLUDED.label,
            packing_field = EXCLUDED.packing_field,
            cartons_field = EXCLUDED.cartons_field,
            category      = EXCLUDED.category,
            display_order = EXCLUDED.display_order,
            is_active     = EXCLUDED.is_active,
            notes         = EXCLUDED.notes;

    RETURN QUERY SELECT 1, NULL::text, v_code;
END;
$$;

COMMENT ON FUNCTION public.upsert_kernel_style(text, text, text, text, text, integer, boolean, text) IS
    'Adds or updates a kernel style. Lets the 5M question be settled as data rather than a '
    'migration. Returns (success, error, style_code).';

-- ============================================================================
-- 8. RBAC.
--
-- Read-only functions are granted to every role, matching the precedent set by
-- get_stock_edit_history (20260816090000). The single write function is scoped to the roles that
-- own reporting — Sales Exec (Pete) and Palladium Manager (Joslyn), plus admin and super_user —
-- deliberately NOT looped over every role, which CLAUDE.md records as the cause of the current
-- permission drift. These functions are also deliberately absent from
-- migrations/20260218000001_grant_all_data_functions_to_all_roles.sql for the same reason.
--
-- GRANT ... TO anon is required, not a weakening: data-functions.js calls every RPC with the anon
-- key because the portal login token is not a Supabase Auth JWT.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.report_fy_of_date(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_fy_month_index(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_week_start(date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_normalise_period_start(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_period_end(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_period_label(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_current_period(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_styles(boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_sections(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_templates(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_metrics(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_template_sections(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_kernel_style(text, text, text, text, text, integer, boolean, text) TO anon, authenticated, service_role;

-- role_permissions rows: read functions to every role, the write function only to the reporting
-- roles. The table is vestigial (its consumer, the Lambda proxy, is retired) but
-- scripts/verify-rbac-parity.mjs compares dev against prod, so both projects must match.
DO $$
DECLARE
    v_role record;
    v_read_fn text;
BEGIN
    FOR v_role IN SELECT id, role_name FROM public.roles LOOP
        FOREACH v_read_fn IN ARRAY ARRAY[
            'get_report_current_period', 'get_kernel_styles', 'get_report_sections',
            'get_report_templates', 'get_report_metrics', 'get_report_template_sections'
        ] LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', v_read_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;

        IF v_role.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager') THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', 'upsert_kernel_style', 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
