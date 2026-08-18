-- Give existing drafts the sections and metrics that were added to their template after they were
-- created.
--
-- THE DEFECT
-- ----------
-- create_report_instance copies report_template_sections into report_instance_sections ONCE, at
-- creation. refresh_report_instance re-resolves figures and re-freezes line rows but never adds a
-- section. So a section registered later is invisible on every report that already exists — the
-- user's only route to it is deleting the draft and regenerating.
--
-- This bit immediately: 20260821100000 added oil_export_lines, which carries the bulk of oil
-- revenue, and the July 2026 draft does not show it. Verified by building that draft's PDF document
-- definition headlessly — 18 sections present, oil_export_lines absent.
--
-- It is not specific to that section. Any future section addition has the same problem, so the fix
-- is a reusable function rather than a one-off UPDATE.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- Only DRAFT instances are touched. A published report is immutable by trigger
-- (report_instance_child_lock) and must stay exactly as issued — adding a section to a report
-- already sent to directors would rewrite history, which is the whole point of the freeze.
--
-- A section a user deliberately switched OFF stays off: the sync only INSERTS rows that are absent,
-- and never flips is_enabled on a row that already exists. Same for commentary and overrides, which
-- are never touched.
--
-- Idempotent by construction — it inserts only what is missing, so running it twice is a no-op.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260821160000_sync_draft_sections_with_template.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

CREATE OR REPLACE FUNCTION public.sync_report_instance_with_template(p_report_instance_id uuid)
RETURNS TABLE (success integer, error text, sections_added integer, metrics_added integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_inst     public.report_instances%ROWTYPE;
    v_template public.report_templates%ROWTYPE;
    v_sections integer := 0;
    v_metrics  integer := 0;
BEGIN
    SELECT * INTO v_inst FROM public.report_instances WHERE id = p_report_instance_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Report not found.', 0, 0;
        RETURN;
    END IF;
    IF v_inst.status <> 'draft' THEN
        RETURN QUERY SELECT 0, 'Only a draft report can be synced.', 0, 0;
        RETURN;
    END IF;

    SELECT * INTO v_template FROM public.report_templates WHERE id = v_inst.template_id;

    -- Sections the template offers that this instance has never heard of.
    INSERT INTO public.report_instance_sections
        (report_instance_id, section_key, is_enabled, display_order)
    SELECT p_report_instance_id, ts.section_key, ts.default_enabled, ts.display_order
    FROM public.report_template_sections ts
    JOIN public.report_sections s ON s.section_key = ts.section_key
    WHERE ts.template_id = v_inst.template_id
      AND s.is_active
      AND NOT EXISTS (
          SELECT 1 FROM public.report_instance_sections ris
          WHERE ris.report_instance_id = p_report_instance_id
            AND ris.section_key = ts.section_key
      );
    GET DIAGNOSTICS v_sections = ROW_COUNT;

    -- Metric rows for any section this instance now has but has no values for. Covers both the
    -- sections just added and a metric registered against a section it already had.
    INSERT INTO public.report_instance_metric_values
        (report_instance_id, metric_key, section_key, display_order, system_value, target_value)
    SELECT p_report_instance_id,
           m.metric_key,
           m.section_key,
           m.display_order,
           public.resolve_report_metric_value(m.metric_key, v_inst.period_start, v_inst.period_end),
           t.target_value
    FROM public.report_metrics m
    JOIN public.report_instance_sections ris
      ON ris.report_instance_id = p_report_instance_id AND ris.section_key = m.section_key
    LEFT JOIN public.report_period_targets t
      ON t.metric_key = m.metric_key
     AND t.period_type = v_template.period_type
     AND t.period_start = v_inst.period_start
    WHERE m.is_active
      AND v_template.period_type = ANY (m.period_types)
      AND NOT EXISTS (
          SELECT 1 FROM public.report_instance_metric_values v
          WHERE v.report_instance_id = p_report_instance_id
            AND v.metric_key = m.metric_key
      );
    GET DIAGNOSTICS v_metrics = ROW_COUNT;

    -- Freeze line rows for whatever is now enabled, including any section just added.
    PERFORM public.populate_report_instance_lines(p_report_instance_id);

    RETURN QUERY SELECT 1, NULL::text, v_sections, v_metrics;
END;
$$;

COMMENT ON FUNCTION public.sync_report_instance_with_template(uuid) IS
    'Adds sections and metrics registered since a DRAFT was created, then repopulates its line '
    'rows. Never enables a section the user switched off, never touches commentary or overrides, '
    'and refuses any report that is not a draft.';

-- Bring every existing draft up to date.
DO $$
DECLARE v_id uuid;
BEGIN
    FOR v_id IN SELECT id FROM public.report_instances WHERE status = 'draft' LOOP
        PERFORM public.sync_report_instance_with_template(v_id);
    END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_report_instance_with_template(uuid) TO anon, authenticated, service_role;

DO $$
DECLARE v_role record;
BEGIN
    FOR v_role IN SELECT id FROM public.roles LOOP
        INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
        VALUES (v_role.id, 'function', 'sync_report_instance_with_template', 'EXECUTE', true)
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
