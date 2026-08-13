-- Report builder — fix blank-padding in the monthly period label.
--
-- 20260817090000 built the monthly label with TO_CHAR(p_period_start, 'Month'), and Postgres pads
-- that pattern to a fixed 9 characters: "August    2026 (FYE 2027)". The label is drawn straight
-- onto the report and its PDF, so the padding is visible to directors. FM prefixes suppress it.
--
-- Verified on dev before this fix: SELECT public.report_period_label('monthly','2026-08-01')
-- returned 'August    2026 (FYE 2027)'.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260817090100_fix_report_period_label_padding.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

CREATE OR REPLACE FUNCTION public.report_period_label(p_period_type text, p_period_start date)
RETURNS text
LANGUAGE sql
STABLE
AS $$
    SELECT CASE
               WHEN p_period_type = 'weekly' THEN
                   'Week of ' || TO_CHAR(p_period_start, 'FMDD Mon YYYY')
               WHEN p_period_type = 'monthly' THEN
                   TO_CHAR(p_period_start, 'FMMonth YYYY')
                   || ' (FYE ' || public.report_fy_of_date(p_period_start) || ')'
               ELSE NULL
           END;
$$;

COMMENT ON FUNCTION public.report_period_label(text, date) IS
    'Human label for a period. Generated, never typed — Pete''s workbook had a monthly sheet '
    'titled "November" whose own start/end dates were 1-31 October; a derived label cannot drift '
    'from the dates it describes. FM prefixes suppress Postgres'' fixed-width blank padding.';

-- Grant is re-stated because CREATE OR REPLACE on an existing function preserves privileges, but
-- re-stating costs nothing and keeps this file self-contained if it is ever applied to a project
-- where 20260817090000 landed differently.
GRANT EXECUTE ON FUNCTION public.report_period_label(text, date) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
