-- create_report_instance must populate line tables too.
--
-- 20260819110000 added populate_report_instance_lines and wired it into refresh_report_instance,
-- but not into create_report_instance. Verified on dev: a freshly created July 2026 report had
-- correct metric figures and zero line rows until refresh was called manually. A user should not
-- have to press Refresh to see the sales lines on a report they just created.
--
-- Body is otherwise identical to 20260817100000's; the only change is the PERFORM at the end.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260819120000_create_report_instance_populates_lines.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

CREATE OR REPLACE FUNCTION public.create_report_instance(
    p_template_id    uuid,
    p_period_date    date,
    p_actor_user_id  uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, report_instance_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_template     public.report_templates%ROWTYPE;
    v_start        date;
    v_end          date;
    v_id           uuid;
    v_prev_summary text;
BEGIN
    SELECT * INTO v_template FROM public.report_templates WHERE id = p_template_id AND is_active;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Unknown or inactive report template.', NULL::uuid;
        RETURN;
    END IF;

    IF p_period_date IS NULL THEN
        RETURN QUERY SELECT 0, 'A date within the reporting period is required.', NULL::uuid;
        RETURN;
    END IF;

    v_start := public.report_normalise_period_start(v_template.period_type, p_period_date);
    v_end   := public.report_period_end(v_template.period_type, v_start);

    IF EXISTS (SELECT 1 FROM public.report_instances
               WHERE template_id = p_template_id AND period_start = v_start
                 AND status <> 'superseded') THEN
        RETURN QUERY SELECT 0,
            format('A %s report already exists for %s.',
                   v_template.period_type,
                   public.report_period_label(v_template.period_type, v_start)),
            NULL::uuid;
        RETURN;
    END IF;

    SELECT ri.executive_summary INTO v_prev_summary
    FROM public.report_instances ri
    WHERE ri.template_id = p_template_id
      AND ri.period_start < v_start
      AND ri.status <> 'superseded'
      AND ri.executive_summary IS NOT NULL
    ORDER BY ri.period_start DESC
    LIMIT 1;

    INSERT INTO public.report_instances
        (template_id, period_type, period_start, period_end, fy, fy_month_index,
         executive_summary, generated_by)
    VALUES
        (p_template_id, v_template.period_type, v_start, v_end,
         public.report_fy_of_date(v_start),
         CASE WHEN v_template.period_type = 'monthly'
              THEN public.report_fy_month_index(v_start) END,
         v_prev_summary, p_actor_user_id)
    RETURNING id INTO v_id;

    INSERT INTO public.report_instance_sections
        (report_instance_id, section_key, is_enabled, display_order)
    SELECT v_id, ts.section_key, ts.default_enabled, ts.display_order
    FROM public.report_template_sections ts
    JOIN public.report_sections s ON s.section_key = ts.section_key
    WHERE ts.template_id = p_template_id AND s.is_active;

    INSERT INTO public.report_instance_metric_values
        (report_instance_id, metric_key, section_key, display_order, system_value, target_value)
    SELECT v_id,
           m.metric_key,
           m.section_key,
           m.display_order,
           public.resolve_report_metric_value(m.metric_key, v_start, v_end),
           t.target_value
    FROM public.report_metrics m
    JOIN public.report_instance_sections ris
      ON ris.report_instance_id = v_id AND ris.section_key = m.section_key
    LEFT JOIN public.report_period_targets t
      ON t.metric_key = m.metric_key
     AND t.period_type = v_template.period_type
     AND t.period_start = v_start
    WHERE m.is_active
      AND v_template.period_type = ANY (m.period_types);

    -- The addition: freeze the data-page rows for every enabled line_table section, so a newly
    -- created report shows its sales lines and stock tables without needing a manual refresh.
    PERFORM public.populate_report_instance_lines(v_id);

    RETURN QUERY SELECT 1, NULL::text, v_id;
END;
$$;

COMMENT ON FUNCTION public.create_report_instance(uuid, date, uuid) IS
    'Creates a draft report for the period containing p_period_date. The date is snapped to the '
    'canonical period start, so any day in the week or month produces the same report. Resolves '
    'metric figures and freezes line-table rows from the data page. Refuses if a live report '
    'already exists for that period.';

NOTIFY pgrst, 'reload schema';
