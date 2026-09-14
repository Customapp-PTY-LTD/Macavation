-- Targets module consolidation — Dashboard Targets + Report Targets become one screen.
--
-- Context: the portal had two target screens keeping two disjoint metric namespaces.
-- dashboard_targets is effective-dated ("what applies right now") and cannot express a target
-- per month; report_period_targets already can. So the report-side shape survives and the
-- dashboard's metrics move into it. The two screens become one, named "Targets".
--
-- Deliberately NOT done here:
--   * report_metrics.label is NOT changed. That column is the printed report line
--     (WebPortal/modules/sales-reports/js/report-metric-line.js:63) and its wording comes from
--     Pete's report. The Targets screen gets its own admin_label instead, so renaming a screen
--     label can never alter a client-facing document.
--   * dashboard_targets is NOT dropped. get_nis_runway_forecast still reads two settings rows
--     from it (nis_crack_rate_kg_per_day, nis_rate_basis_month) which are settings, not targets.
--     Dropping the table is a later migration, once those have moved.
--   * total_production_kg is not migrated anywhere. It is superseded by kernel_nis_cracking_kg
--     and kernel_sk_packing_kg, which already exist and are already resolved from production
--     data. The dashboard is repointed at those two in the same change as this migration.

-- ============================================================================
-- 1. admin_label — the name shown on the Targets screen, distinct from the report line
-- ============================================================================

ALTER TABLE public.report_metrics
    ADD COLUMN IF NOT EXISTS admin_label text NULL;

COMMENT ON COLUMN public.report_metrics.admin_label IS
    'Name shown on the Targets admin screen. NULL falls back to label. Kept separate from label '
    'because label is the printed report line - renaming one must never silently rename the other.';

UPDATE public.report_metrics SET admin_label = v.admin_label
FROM (VALUES
    ('kernel_nis_cracking_kg',       'NIS cracked'),
    ('kernel_sk_packing_kg',         'Sound kernel packed'),
    ('nis_procured_kg',              'NIS procured'),
    ('oil_ev_produced_kg',           'Extra virgin oil produced'),
    ('oil_cosmetic_produced_kg',     'Cosmetic oil produced'),
    ('oil_bgrade_produced_kg',       'B-grade oil produced'),
    ('oil_protein_produced_kg',      'Protein produced'),
    ('oil_filter_fines_produced_kg', 'Filter fines produced'),
    ('oil_cake_produced_kg',         'Cake produced'),
    ('kernel_sales_excl_vat_zar',    'Kernel sales, excluding VAT'),
    ('oil_sales_excl_vat_zar',       'Oil sales, excluding VAT'),
    ('oil_sales_extra_virgin_zar',   'Extra virgin sales'),
    ('oil_sales_crude_cosmetic_zar', 'Crude and cosmetic sales'),
    ('oil_sales_protein_zar',        'Protein sales'),
    ('oil_sales_cake_zar',           'Cake sales')
) AS v(metric_key, admin_label)
WHERE public.report_metrics.metric_key = v.metric_key;

-- ============================================================================
-- 2. performance section — carries the dashboard percentages, never printed
--
-- A report instance's sections come from report_template_sections
-- (create_report_instance, migrations/20260817100000_report_instances_and_targets.sql:452),
-- and its metric rows are joined to those enabled sections (:459-468). A section that no
-- template references therefore produces no report line, while its metrics still take targets.
-- This section is deliberately left out of every template.
-- ============================================================================

INSERT INTO public.report_sections (section_key, label, description, render_kind, period_types)
VALUES (
    'performance',
    'Performance',
    'Recovery, yield and quality percentages. Targets only - no template includes this section, '
    'so it never appears on a generated report.',
    'metric_table',
    ARRAY['weekly', 'monthly']
)
ON CONFLICT (section_key) DO UPDATE SET
    label = EXCLUDED.label,
    description = EXCLUDED.description,
    updated_at = now();

-- source_kind 'manual' because nothing resolves these from production data today; the dashboard
-- computes its own actuals in JS. They exist here so report_period_targets.metric_key (FK) can
-- hold their targets.
INSERT INTO public.report_metrics
    (metric_key, label, admin_label, section_key, division, unit, aggregation, source_kind,
     source_args, period_types, has_target, display_order)
VALUES
    ('sound_kernel_recovery_pct', 'Sound Kernel Recovery', 'Sound kernel recovery',
        'performance', 'kernel', 'pct', 'as_at_period_end', 'manual', '{}'::jsonb,
        ARRAY['weekly', 'monthly'], true, 10),
    ('oil_yield_pct', 'Oil Yield', 'Oil yield',
        'performance', 'oil', 'pct', 'as_at_period_end', 'manual', '{}'::jsonb,
        ARRAY['weekly', 'monthly'], true, 20),
    ('quality_pass_rate', 'Quality Pass Rate', 'Quality pass rate',
        'performance', 'all', 'pct', 'as_at_period_end', 'manual', '{}'::jsonb,
        ARRAY['weekly', 'monthly'], true, 30)
ON CONFLICT (metric_key) DO UPDATE SET
    admin_label = EXCLUDED.admin_label,
    section_key = EXCLUDED.section_key,
    unit = EXCLUDED.unit,
    updated_at = now();

-- ============================================================================
-- 3. get_report_targets_grid — a whole financial year in one call
--
-- The old screen loaded one period at a time. The grid needs every period in the FY at once,
-- so this returns metric x period, with the target and the same period one year earlier.
--
-- prior_value prefers a real recorded actual over a hand-entered one:
--   'actual' - from the newest published report instance for that period
--   'manual' - from report_manual_period_baselines
--   NULL     - nothing recorded; the screen makes the cell editable and a save writes a manual row
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_report_targets_grid(
    p_period_type text,
    p_fy          integer
)
RETURNS TABLE (
    metric_key     text,
    admin_label    text,
    report_label   text,
    section_key    text,
    section_label  text,
    unit           text,
    division       text,
    display_order  integer,
    period_start        date,
    period_index        integer,
    period_label        text,
    target_value        numeric,
    notes               text,
    prior_period_start  date,
    prior_value         numeric,
    prior_source        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH bounds AS (
        SELECT MAKE_DATE(p_fy - 1, 4, 1) AS fy_start,
               MAKE_DATE(p_fy, 3, 31)    AS fy_end
    ),
    periods AS (
        SELECT public.report_normalise_period_start(p_period_type, d::date) AS period_start
        FROM bounds b,
             GENERATE_SERIES(b.fy_start, b.fy_end, CASE WHEN p_period_type = 'weekly'
                                                        THEN INTERVAL '1 week'
                                                        ELSE INTERVAL '1 month' END) AS d
        WHERE p_period_type IN ('weekly', 'monthly')
        GROUP BY 1
    ),
    grid AS (
        SELECT m.metric_key, m.admin_label, m.label, m.section_key, m.unit, m.division,
               m.display_order, p.period_start,
               -- "The same period a year ago". For monthly that is the same month number, but a
               -- weekly period is identified by its Monday, and a calendar year earlier is not a
               -- Monday - it would never match a stored period_start. 52 weeks back preserves the
               -- weekday, so the join can actually hit.
               CASE WHEN p_period_type = 'weekly'
                    THEN (p.period_start - 364)
                    ELSE (p.period_start - INTERVAL '1 year')::date
               END AS prior_start
        FROM public.report_metrics m
        CROSS JOIN periods p
        WHERE m.is_active
          AND m.has_target
          AND p_period_type = ANY (m.period_types)
          AND p.period_start IS NOT NULL
    ),
    prior_actual AS (
        -- Newest published instance wins; a superseded one must not shadow it.
        SELECT DISTINCT ON (ri.period_start, v.metric_key)
               ri.period_start, v.metric_key,
               COALESCE(v.entered_value, v.system_value) AS achieved
        FROM public.report_instances ri
        JOIN public.report_instance_metric_values v ON v.report_instance_id = ri.id
        WHERE ri.period_type = p_period_type
          AND ri.status = 'published'
          AND COALESCE(v.entered_value, v.system_value) IS NOT NULL
        ORDER BY ri.period_start, v.metric_key, ri.version DESC, ri.published_at DESC
    )
    SELECT g.metric_key,
           COALESCE(g.admin_label, g.label)                          AS admin_label,
           g.label                                                   AS report_label,
           g.section_key,
           s.label                                                   AS section_label,
           g.unit,
           g.division,
           g.display_order,
           g.period_start,
           CASE WHEN p_period_type = 'monthly'
                THEN public.report_fy_month_index(g.period_start)
                ELSE (ROW_NUMBER() OVER (PARTITION BY g.metric_key
                                         ORDER BY g.period_start))::integer
           END                                                       AS period_index,
           public.report_period_label(p_period_type, g.period_start) AS period_label,
           t.target_value,
           t.notes,
           g.prior_start                                             AS prior_period_start,
           COALESCE(pa.achieved, mb.achieved_value)                  AS prior_value,
           CASE WHEN pa.achieved IS NOT NULL THEN 'actual'
                WHEN mb.achieved_value IS NOT NULL THEN 'manual'
                ELSE NULL END                                        AS prior_source
    FROM grid g
    JOIN public.report_sections s ON s.section_key = g.section_key
    LEFT JOIN public.report_period_targets t
           ON t.metric_key = g.metric_key
          AND t.period_type = p_period_type
          AND t.period_start = g.period_start
    LEFT JOIN prior_actual pa
           ON pa.metric_key = g.metric_key
          AND pa.period_start = g.prior_start
    LEFT JOIN public.report_manual_period_baselines mb
           ON mb.metric_key = g.metric_key
          AND mb.period_type = p_period_type
          AND mb.period_start = g.prior_start
    ORDER BY s.section_key, g.display_order, g.metric_key, g.period_start;
$$;

COMMENT ON FUNCTION public.get_report_targets_grid(text, integer) IS
    'Every targetable metric across every period of financial year p_fy, with that period''s '
    'target and the same period one year earlier. prior_source says where the earlier figure '
    'came from: a published report instance (actual), a hand-entered baseline (manual), or '
    'nothing (NULL), which is what makes the cell editable on the Targets screen.';

REVOKE ALL ON FUNCTION public.get_report_targets_grid(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_report_targets_grid(text, integer)
    TO anon, authenticated, service_role;

-- ============================================================================
-- 4. Feature rename + the union of both screens' roles
--
-- The route key report-targets-grid is deliberately REUSED rather than replaced. A new key would
-- be invisible to everyone, super_user included, until this migration is applied AND each user
-- re-logs in (menu-filter.js:41-42 - role features are the single source of truth, with no
-- admin-sees-all fallback). Reusing it means the screen keeps working under its old name in the
-- window between the code deploying and this migration being applied.
-- ============================================================================

UPDATE public.features
SET name = 'Targets',
    description = 'Set monthly and weekly targets for production, sales and performance metrics',
    updated_at = now()
WHERE key = 'report-targets-grid';

-- Union of who could reach either screen before: Report Targets had super_user, admin,
-- Sales Exec, Palladium Manager; Dashboard Targets had super_user, admin, General Manager,
-- Production Manager, Oil Plant Manager. Nobody loses access.
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.features WHERE key = 'report-targets-grid') f
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager',
                      'General Manager', 'Production Manager', 'Oil Plant Manager')
ON CONFLICT (role_id, feature_id) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE key = 'reports.target.edit') a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager',
                      'General Manager', 'Production Manager', 'Oil Plant Manager')
ON CONFLICT (role_id, action_id) DO NOTHING;

-- ============================================================================
-- 5. Retire the Dashboard Targets menu entry
--
-- The dashboard_targets TABLE stays (see header). Only the menu feature goes, so the old screen
-- stops being reachable.
-- ============================================================================

DELETE FROM public.role_features
WHERE feature_id IN (SELECT id FROM public.features WHERE key = 'dashboard-targets-grid');

DELETE FROM public.features
WHERE key = 'dashboard-targets-grid';

-- ============================================================================
-- 6. scheduled-reports-grid: the SCREEN goes, the FEATURE KEY stays
--
-- Do NOT delete this feature. The portal screen is gone (route, nav entry and module files all
-- removed), but the key outlived it: supabase/functions/whatsapp-inbound/index.ts:652 gates the
-- "Latest report" WhatsApp menu item on it, and that menu is filtered by
-- get_role_features_for_role exactly like the portal sidebar (index.ts:722 -
-- MENU_ITEMS.filter(i => featureKeys.has(i.feature))). Dropping the row silently removes
-- "Latest report" from every member's WhatsApp menu.
--
-- A features row with no matching route is harmless in the portal: menu-filter.js only unhides
-- sidebar elements that carry a data-route, and no such element exists for this key any more.
-- So the key is kept and renamed to describe the job it actually still does.
-- ============================================================================

UPDATE public.features
SET name = 'Report delivery (WhatsApp)',
    description = 'Can request the latest published report over WhatsApp. '
                  'The Scheduled Reports portal screen this key was created for has been removed; '
                  'the key now governs the whatsapp-inbound "Latest report" menu item only.',
    updated_at = now()
WHERE key = 'scheduled-reports-grid';

NOTIFY pgrst, 'reload schema';
