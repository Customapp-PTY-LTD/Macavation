-- Give kernel sales lines their style, so "Kernel Sales by Style" is actually by style.
--
-- THE DEFECT
-- ----------
-- data_kernel_sales_lines.style_code is NULL on all 278 rows — the loader never populated it. The
-- kernel_sales_by_style section (wired up in 20260821090000) therefore aggregates everything into a
-- single "(unspecified)" row: the total is right, the breakdown is absent.
--
-- THE MAPPING IS EVIDENCE, NOT GUESSWORK
-- --------------------------------------
-- item_code is populated on 277 of the 278 rows, and it settles the three cases that description
-- text alone left ambiguous:
--
--   * Bare "Macadamia Style 4 Commercial" (53 rows) carries item_code ZRNMS4 — and so do the two
--     rows labelled "Macadamia Style 4L Commercial", plus the typo "Macadamia Syle 4 Commercial".
--     One item code, four spellings. ZRNMS4 -> 4L is therefore demonstrated by the data, not
--     inferred from the registry label.
--   * "Style 4S Commercial" carries a DISTINCT code, ZRNMS4S. It is a real separate style with no
--     registry entry, not a spelling of Style 4.
--   * "Style Fines Comm." carries ZRNMSF. Also real, also missing from the registry.
--
-- Two rows types are deliberately left NULL: ZRFOM1 (bulk food-grade oil) and ZRFPM1 (protein) are
-- not kernel styles at all, they simply appear on Pete's Sales (Kernel) sheet. Grouping them under
-- a kernel style would invent a fact. One row has neither item code nor description and also stays
-- NULL. All three render under the resolver's "(unspecified)" bucket, honestly.
--
-- WHY A REGISTRY COLUMN RATHER THAN A CASE EXPRESSION
-- ---------------------------------------------------
-- 20260817090000 established that the style list is configurable data precisely so a correction
-- does not need a migration. A hardcoded CASE mapping item codes to styles would undo that. The
-- mapping goes on kernel_style_registry.item_code, where a user can fix it, and the backfill is a
-- join against that column. A future load can use the same join instead of re-deriving anything.
--
-- report_lines_kernel_sales_by_style also gains a fallback to that join, so a newly loaded row that
-- arrives with a NULL style_code still groups correctly instead of silently landing in
-- "(unspecified)" until someone remembers to run a backfill.
--
-- Idempotent throughout. OUT OF SCOPE: applying it. A human runs
--   npm run db:apply -- migrations/20260821150000_kernel_sales_style_codes.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. The registry learns the ERP item code, and the two styles it was missing.
-- ============================================================================

ALTER TABLE public.kernel_style_registry
    ADD COLUMN IF NOT EXISTS item_code text NULL;

COMMENT ON COLUMN public.kernel_style_registry.item_code IS
    'The ERP/invoice item code that identifies this style on a sales line (e.g. ZRNMS4 for 4L). '
    'The bridge between data_kernel_sales_lines.item_code and a report style. Configurable data, '
    'not a hardcoded mapping, so a miscoded style is corrected without a migration.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_style_registry_item_code
    ON public.kernel_style_registry (item_code)
    WHERE item_code IS NOT NULL;

-- 4S and Fines are sold and invoiced but were absent from the registry. packing_field stays NULL:
-- the packing capture cannot produce either today, which 20260817090000 explicitly supports —
-- "such a style still renders in the report, as a row the resolver reports NULL for, rather than
-- vanishing".
INSERT INTO public.kernel_style_registry
    (style_code, label, packing_field, cartons_field, category, display_order, is_active, notes)
VALUES
    ('4S',    'Style 4 Small', NULL, NULL, 'sound_kernel', 55,  true,
     'Invoiced as ZRNMS4S. Added 20260821150000: present in sales, absent from the original registry.'),
    ('FINES', 'Style Fines',   NULL, NULL, 'other',        110, true,
     'Invoiced as ZRNMSF. Added 20260821150000: present in sales, absent from the original registry.')
ON CONFLICT (style_code) DO NOTHING;

UPDATE public.kernel_style_registry k
   SET item_code = v.item_code
  FROM (VALUES
            ('SP',    'ZRNMSSP'),
            ('1S',    'ZRNMS1S'),
            ('4L',    'ZRNMS4'),
            ('4S',    'ZRNMS4S'),
            ('5',     'ZRNMS5'),
            ('5M',    'ZRNMS5M'),
            ('6',     'ZRNMS6'),
            ('FINES', 'ZRNMSF'),
            ('BHO',   'ZRNMBGH'),
            ('BLO',   'ZRNMBGL')
       ) AS v(style_code, item_code)
 WHERE k.style_code = v.style_code
   AND k.item_code IS DISTINCT FROM v.item_code;

-- ============================================================================
-- 2. Backfill style_code on the sales lines.
--
-- Only rows that have no style yet are touched, so a human correction is never overwritten.
-- ============================================================================

UPDATE public.data_kernel_sales_lines s
   SET style_code = k.style_code
  FROM public.kernel_style_registry k
 WHERE s.style_code IS NULL
   AND s.item_code IS NOT NULL
   AND k.item_code = s.item_code;

-- ============================================================================
-- 3. Teach the resolver the same fallback.
--
-- Identical to 20260821090000 apart from COALESCE(s.style_code, k_item.style_code): a row loaded
-- without a style still groups under the right one via its item code.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_lines_kernel_sales_by_style(
    p_period_start date, p_period_end date
)
RETURNS TABLE (sort_index integer, payload jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH resolved AS (
        SELECT COALESCE(NULLIF(TRIM(s.style_code), ''), k_item.style_code) AS style_code,
               s.cartons, s.quantity_kg, s.vat_excl_zar
        FROM public.data_kernel_sales_lines s
        LEFT JOIN public.kernel_style_registry k_item
               ON k_item.item_code IS NOT NULL
              AND k_item.item_code = s.item_code
        WHERE s.sale_date BETWEEN p_period_start AND p_period_end
    ),
    agg AS (
        SELECT COALESCE(r.style_code, '(unspecified)') AS style_code,
               SUM(r.cartons)      AS cartons,
               SUM(r.quantity_kg)  AS quantity_kg,
               SUM(r.vat_excl_zar) AS vat_excl_zar
        FROM resolved r
        GROUP BY COALESCE(r.style_code, '(unspecified)')
    )
    SELECT (ROW_NUMBER() OVER (ORDER BY COALESCE(k.display_order, 9999), a.style_code))::integer,
           jsonb_build_object(
               'style_code',   a.style_code,
               'style_label',  COALESCE(k.label, a.style_code),
               'cartons',      a.cartons,
               'quantity_kg',  a.quantity_kg,
               'price_per_kg', CASE WHEN COALESCE(a.quantity_kg, 0) > 0
                                    THEN ROUND(a.vat_excl_zar / a.quantity_kg, 2)
                                    ELSE NULL END,
               'vat_excl_zar', a.vat_excl_zar)
    FROM agg a
    LEFT JOIN public.kernel_style_registry k ON k.style_code = a.style_code
    ORDER BY COALESCE(k.display_order, 9999), a.style_code
    LIMIT 100;
$$;

COMMENT ON FUNCTION public.report_lines_kernel_sales_by_style(date, date) IS
    'Kernel sales for the period aggregated by style, ordered by the style registry. Falls back to '
    'the registry''s item_code mapping when a line carries no style_code. price_per_kg is '
    'value/quantity (a weighted average), not the mean of the per-line price column. Non-kernel '
    'lines (bulk oil, protein) legitimately have no style and group under (unspecified).';

GRANT EXECUTE ON FUNCTION public.report_lines_kernel_sales_by_style(date, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
