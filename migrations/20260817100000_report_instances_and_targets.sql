-- Report builder — per-period targets, report instances, and the report lifecycle.
--
-- Depends on 20260817090000 (period helpers, section/template/metric registry).
--
-- Three decisions are enforced structurally here rather than left to the UI:
--
--  1. FREEZE ON PUBLISH. Directors receive a PDF. Production capture is corrected retroactively in
--     this business (job-card approval rewrites kernel.packing_data after the fact), so a report
--     that recomputed on every open would silently stop matching the PDF that was sent. Publishing
--     locks every child row via trigger; a correction is a new version through
--     supersede_report_instance, never an edit.
--
--  2. AN OVERRIDE REQUIRES A REASON. Enforced by CHECK constraint, not just by the form.
--     docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md §0.4 records that cracking capture is
--     unreliable in both directions, so overrides are expected to be common — which is exactly why
--     the reason must be structural.
--
--  3. ONE LIVE REPORT PER PERIOD. A partial unique index makes the duplicate-week defect in Pete's
--     spreadsheet ("September - Week 4" and "October - Week 1" both covering 29 Sep - 5 Oct 2025)
--     impossible to reproduce.
--
-- Convention (matching 20260812100000 and 20260816090000): SECURITY DEFINER, SET search_path =
-- public, RLS enabled with service_role-only direct table access; browser calls arrive as role
-- anon. Every list RPC is LIMIT-capped per BluePrint/supabase-database-rules.md §6.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260817100000_report_instances_and_targets.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

-- ============================================================================
-- 1. report_period_targets — the target that applied to one specific period.
--
-- NOT an extension of dashboard_targets. That table is effective-dated ("latest effective_from
-- wins"), which answers "what is the target right now" for a live dashboard tile. It cannot express
-- "the target that applied to the week of 3 Nov", and it cannot be filled in retroactively for a
-- period that has already closed without disturbing every later period. Pete edits targets per
-- period, and a mid-year change (his sound-kernel packing target moved from 3626.2 to 4375 kg
-- partway through the year) must not rewrite history.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_period_targets (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_key   text NOT NULL REFERENCES public.report_metrics (metric_key) ON DELETE CASCADE,
    period_type  text NOT NULL,
    period_start date NOT NULL,
    target_value numeric(18, 4) NOT NULL DEFAULT 0,
    notes        text NULL,
    set_by       uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_period_targets_unique UNIQUE (metric_key, period_type, period_start),
    CONSTRAINT report_period_targets_period_type_check CHECK (period_type IN ('weekly', 'monthly')),
    CONSTRAINT report_period_targets_value_check CHECK (target_value >= 0)
);

COMMENT ON TABLE public.report_period_targets IS
    'Target for one metric in one specific period. period_start is always the canonical period '
    'start (Monday, or the 1st) — writers must pass it through report_normalise_period_start.';

ALTER TABLE public.report_period_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_period_targets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_period_targets TO service_role;

CREATE INDEX IF NOT EXISTS ix_report_period_targets_period
    ON public.report_period_targets (period_type, period_start);
CREATE INDEX IF NOT EXISTS ix_report_period_targets_metric
    ON public.report_period_targets (metric_key);
CREATE INDEX IF NOT EXISTS ix_report_period_targets_set_by
    ON public.report_period_targets (set_by);

DROP TRIGGER IF EXISTS trg_report_period_targets_updated_at ON public.report_period_targets;
CREATE TRIGGER trg_report_period_targets_updated_at
    BEFORE UPDATE ON public.report_period_targets
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

-- ============================================================================
-- 2. report_manual_period_baselines — hand-entered prior-period actuals.
--
-- The user chose to start fresh with no historical backfill, but to keep the option of filling in
-- earlier months by hand so the financial-year-versus-prior-year tracking tables populate over
-- time. Deliberately separate from an override: a baseline belongs to no report instance and has
-- no system value to differ from, so folding it into report_instance_metric_values would mean a
-- nullable instance FK and a permanently ambiguous "was this ever a real report" question.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_manual_period_baselines (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_key     text NOT NULL REFERENCES public.report_metrics (metric_key) ON DELETE CASCADE,
    period_type    text NOT NULL,
    period_start   date NOT NULL,
    achieved_value numeric(18, 4) NOT NULL,
    notes          text NULL,
    set_by         uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_manual_baselines_unique UNIQUE (metric_key, period_type, period_start),
    CONSTRAINT report_manual_baselines_period_type_check CHECK (period_type IN ('weekly', 'monthly'))
);

COMMENT ON TABLE public.report_manual_period_baselines IS
    'Hand-entered actuals for periods that predate the report builder, so year-on-year tracking '
    'tables have a comparison series. Not a report, and not an override.';

ALTER TABLE public.report_manual_period_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_manual_period_baselines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_manual_period_baselines TO service_role;

CREATE INDEX IF NOT EXISTS ix_report_manual_baselines_period
    ON public.report_manual_period_baselines (period_type, period_start);
CREATE INDEX IF NOT EXISTS ix_report_manual_baselines_metric
    ON public.report_manual_period_baselines (metric_key);
CREATE INDEX IF NOT EXISTS ix_report_manual_baselines_set_by
    ON public.report_manual_period_baselines (set_by);

DROP TRIGGER IF EXISTS trg_report_manual_baselines_updated_at ON public.report_manual_period_baselines;
CREATE TRIGGER trg_report_manual_baselines_updated_at
    BEFORE UPDATE ON public.report_manual_period_baselines
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

-- ============================================================================
-- 3. report_instances and children.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_instances (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id        uuid NOT NULL REFERENCES public.report_templates (id) ON DELETE RESTRICT,
    period_type        text NOT NULL,
    period_start       date NOT NULL,
    period_end         date NOT NULL,
    fy                 integer NOT NULL,
    fy_month_index     integer NULL,
    version            integer NOT NULL DEFAULT 1,
    supersedes_id      uuid NULL REFERENCES public.report_instances (id) ON DELETE SET NULL,
    status             text NOT NULL DEFAULT 'draft',
    executive_summary  text NULL,
    generated_by       uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    generated_at       timestamptz NOT NULL DEFAULT now(),
    published_by       uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    published_at       timestamptz NULL,
    supersede_reason   text NULL,
    pdf_storage_bucket text NULL,
    pdf_storage_path   text NULL,
    pdf_sha256         text NULL,
    content_sha256     text NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_instances_period_type_check CHECK (period_type IN ('weekly', 'monthly')),
    CONSTRAINT report_instances_status_check CHECK (status IN ('draft', 'published', 'superseded')),
    CONSTRAINT report_instances_version_check CHECK (version >= 1),
    CONSTRAINT report_instances_published_fields_check
        CHECK (status <> 'published' OR (published_at IS NOT NULL AND content_sha256 IS NOT NULL))
);

COMMENT ON TABLE public.report_instances IS
    'One weekly or monthly report. period_start is the canonical period start: the Monday for a '
    'weekly report, the 1st for a monthly one. A published instance is immutable — corrections '
    'create a new version via supersede_report_instance.';
COMMENT ON COLUMN public.report_instances.content_sha256 IS
    'Hash of the get_report_instance payload at publish time. Tamper-evidence independent of the '
    'PDF file, so it can be shown that the stored figures are the ones that were issued.';
COMMENT ON COLUMN public.report_instances.fy_month_index IS
    'April = 1 ... March = 12. NULL for weekly reports, which are not month-indexed.';

ALTER TABLE public.report_instances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_instances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_instances TO service_role;

-- One live (non-superseded) report per template per period. This is the duplicate-week guard.
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_instances_live_period
    ON public.report_instances (template_id, period_start)
    WHERE status <> 'superseded';

CREATE INDEX IF NOT EXISTS ix_report_instances_period
    ON public.report_instances (period_type, period_start DESC);
CREATE INDEX IF NOT EXISTS ix_report_instances_status
    ON public.report_instances (status);
CREATE INDEX IF NOT EXISTS ix_report_instances_template
    ON public.report_instances (template_id);
CREATE INDEX IF NOT EXISTS ix_report_instances_fy
    ON public.report_instances (fy, fy_month_index);
CREATE INDEX IF NOT EXISTS ix_report_instances_supersedes
    ON public.report_instances (supersedes_id);
CREATE INDEX IF NOT EXISTS ix_report_instances_generated_by
    ON public.report_instances (generated_by);
CREATE INDEX IF NOT EXISTS ix_report_instances_published_by
    ON public.report_instances (published_by);

DROP TRIGGER IF EXISTS trg_report_instances_updated_at ON public.report_instances;
CREATE TRIGGER trg_report_instances_updated_at
    BEFORE UPDATE ON public.report_instances
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.report_instance_sections (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_instance_id uuid NOT NULL REFERENCES public.report_instances (id) ON DELETE CASCADE,
    section_key        text NOT NULL REFERENCES public.report_sections (section_key) ON DELETE RESTRICT,
    is_enabled         boolean NOT NULL DEFAULT true,
    display_order      integer NOT NULL DEFAULT 0,
    commentary         text NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_instance_sections_unique UNIQUE (report_instance_id, section_key)
);

COMMENT ON TABLE public.report_instance_sections IS
    'Which sections this report shows, in what order, plus Pete''s per-section commentary.';

ALTER TABLE public.report_instance_sections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_instance_sections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_instance_sections TO service_role;

CREATE INDEX IF NOT EXISTS ix_report_instance_sections_instance
    ON public.report_instance_sections (report_instance_id, display_order);
CREATE INDEX IF NOT EXISTS ix_report_instance_sections_section
    ON public.report_instance_sections (section_key);

DROP TRIGGER IF EXISTS trg_report_instance_sections_updated_at ON public.report_instance_sections;
CREATE TRIGGER trg_report_instance_sections_updated_at
    BEFORE UPDATE ON public.report_instance_sections
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.report_instance_metric_values (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_instance_id uuid NOT NULL REFERENCES public.report_instances (id) ON DELETE CASCADE,
    metric_key         text NOT NULL REFERENCES public.report_metrics (metric_key) ON DELETE RESTRICT,
    section_key        text NOT NULL REFERENCES public.report_sections (section_key) ON DELETE RESTRICT,
    display_order      integer NOT NULL DEFAULT 0,
    system_value       numeric(18, 4) NULL,
    target_value       numeric(18, 4) NULL,
    entered_value      numeric(18, 4) NULL,
    override_reason    text NULL,
    overridden_by      uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    overridden_at      timestamptz NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_instance_metric_values_unique UNIQUE (report_instance_id, metric_key),
    CONSTRAINT report_metric_override_needs_reason
        CHECK (entered_value IS NULL
               OR (override_reason IS NOT NULL AND length(TRIM(override_reason)) > 0))
);

COMMENT ON TABLE public.report_instance_metric_values IS
    'One row per metric per report. system_value is what the database computed, entered_value is '
    'what Pete typed, target_value is the period target. All three are kept so the variance is '
    'visible rather than resolved away.';
COMMENT ON COLUMN public.report_instance_metric_values.system_value IS
    'NULL means the database has no figure at all for this metric — rendered differently from a '
    'genuine zero. Every oil metric is NULL until the oil module is actually used in production.';
COMMENT ON COLUMN public.report_instance_metric_values.override_reason IS
    'Required whenever entered_value is set. Held as a real column rather than relying on '
    'audit.audit_log, which is revoked from anon and authenticated and so cannot be displayed.';

ALTER TABLE public.report_instance_metric_values ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_instance_metric_values FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_instance_metric_values TO service_role;

CREATE INDEX IF NOT EXISTS ix_report_instance_metric_values_instance
    ON public.report_instance_metric_values (report_instance_id, section_key, display_order);
CREATE INDEX IF NOT EXISTS ix_report_instance_metric_values_metric
    ON public.report_instance_metric_values (metric_key);
CREATE INDEX IF NOT EXISTS ix_report_instance_metric_values_section
    ON public.report_instance_metric_values (section_key);
CREATE INDEX IF NOT EXISTS ix_report_instance_metric_values_overridden_by
    ON public.report_instance_metric_values (overridden_by);

DROP TRIGGER IF EXISTS trg_report_instance_metric_values_updated_at ON public.report_instance_metric_values;
CREATE TRIGGER trg_report_instance_metric_values_updated_at
    BEFORE UPDATE ON public.report_instance_metric_values
    FOR EACH ROW EXECUTE FUNCTION public.report_touch_updated_at();

CREATE TABLE IF NOT EXISTS public.report_instance_lines (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_instance_id uuid NOT NULL REFERENCES public.report_instances (id) ON DELETE CASCADE,
    section_key        text NOT NULL REFERENCES public.report_sections (section_key) ON DELETE RESTRICT,
    line_type          text NOT NULL,
    sort_index         integer NOT NULL DEFAULT 0,
    ref_table          text NULL,
    ref_id             uuid NULL,
    payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.report_instance_lines IS
    'Tabular section content frozen into the report: sales lines, stock-on-hand breakdowns, the '
    'procurement pipeline, the forward planning grid. JSONB payload per row, mirroring the '
    'kernel.cracking_data / packing_data convention already used in this schema.';

ALTER TABLE public.report_instance_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_instance_lines FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_instance_lines TO service_role;

CREATE INDEX IF NOT EXISTS ix_report_instance_lines_instance
    ON public.report_instance_lines (report_instance_id, section_key, sort_index);
CREATE INDEX IF NOT EXISTS ix_report_instance_lines_section
    ON public.report_instance_lines (section_key);

-- ============================================================================
-- 4. Freeze trigger — a published report is immutable.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_instance_child_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_instance_id uuid := COALESCE(NEW.report_instance_id, OLD.report_instance_id);
    v_status      text;
BEGIN
    SELECT status INTO v_status FROM public.report_instances WHERE id = v_instance_id;

    IF v_status IN ('published', 'superseded') THEN
        RAISE EXCEPTION
            'Report % is % and cannot be changed. Use supersede_report_instance to issue a new version.',
            v_instance_id, v_status
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.report_instance_child_lock() IS
    'Blocks any write to a published or superseded report''s children. Internal trigger: granted '
    'to no role.';

DROP TRIGGER IF EXISTS trg_lock_report_metric_values ON public.report_instance_metric_values;
CREATE TRIGGER trg_lock_report_metric_values
    BEFORE INSERT OR UPDATE OR DELETE ON public.report_instance_metric_values
    FOR EACH ROW EXECUTE FUNCTION public.report_instance_child_lock();

DROP TRIGGER IF EXISTS trg_lock_report_instance_sections ON public.report_instance_sections;
CREATE TRIGGER trg_lock_report_instance_sections
    BEFORE INSERT OR UPDATE OR DELETE ON public.report_instance_sections
    FOR EACH ROW EXECUTE FUNCTION public.report_instance_child_lock();

DROP TRIGGER IF EXISTS trg_lock_report_instance_lines ON public.report_instance_lines;
CREATE TRIGGER trg_lock_report_instance_lines
    BEFORE INSERT OR UPDATE OR DELETE ON public.report_instance_lines
    FOR EACH ROW EXECUTE FUNCTION public.report_instance_child_lock();

-- ============================================================================
-- 5. resolve_report_metric_value — STUB.
--
-- Deliberately a stub returning NULL for every metric. The real resolvers land in a later
-- migration alongside the corrected kernel date filtering. Shipping the stub now means
-- create_report_instance works from day one and every metric simply reads "no system data", which
-- is the honest state and exactly what the override flow is designed for — rather than the whole
-- feature being unusable until the resolvers exist. Replacing this function later needs no change
-- to any caller.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_report_metric_value(
    p_metric_key   text,
    p_period_start date,
    p_period_end   date
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_metric public.report_metrics%ROWTYPE;
BEGIN
    SELECT * INTO v_metric FROM public.report_metrics WHERE metric_key = p_metric_key;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown report metric_key: %', p_metric_key USING ERRCODE = 'no_data_found';
    END IF;

    -- No source_kind is wired yet. NULL means "the database has no figure", never a fabricated 0.
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.resolve_report_metric_value(text, date, date) IS
    'Computes a metric from live data for a period. STUB as of 20260817100000 — returns NULL for '
    'every metric until the resolver migration lands. NULL always means "no system figure", it is '
    'never a substitute for a real zero.';

-- ============================================================================
-- 6. Lifecycle RPCs.
-- ============================================================================

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

    -- Carry the previous period's executive summary forward so Pete edits rather than retypes.
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

    -- Sections, from the template defaults.
    INSERT INTO public.report_instance_sections
        (report_instance_id, section_key, is_enabled, display_order)
    SELECT v_id, ts.section_key, ts.default_enabled, ts.display_order
    FROM public.report_template_sections ts
    JOIN public.report_sections s ON s.section_key = ts.section_key
    WHERE ts.template_id = p_template_id AND s.is_active;

    -- Metric rows, with the live figure and the period target resolved now.
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

    RETURN QUERY SELECT 1, NULL::text, v_id;
END;
$$;

COMMENT ON FUNCTION public.create_report_instance(uuid, date, uuid) IS
    'Creates a draft report for the period containing p_period_date. The date is snapped to the '
    'canonical period start, so any day in the week or month produces the same report. Refuses if '
    'a live report already exists for that period.';

CREATE OR REPLACE FUNCTION public.refresh_report_instance(
    p_report_instance_id uuid
)
RETURNS TABLE (success integer, error text, metrics_refreshed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_instance public.report_instances%ROWTYPE;
    v_count    integer := 0;
BEGIN
    SELECT * INTO v_instance FROM public.report_instances WHERE id = p_report_instance_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Report not found.', 0;
        RETURN;
    END IF;
    IF v_instance.status <> 'draft' THEN
        RETURN QUERY SELECT 0, 'Only a draft report can be refreshed.', 0;
        RETURN;
    END IF;

    -- system_value and target_value are recomputed; entered_value, override_reason and the
    -- override attribution are deliberately left untouched.
    UPDATE public.report_instance_metric_values v
    SET system_value = public.resolve_report_metric_value(
                           v.metric_key, v_instance.period_start, v_instance.period_end),
        target_value = t.target_value
    FROM public.report_metrics m
    LEFT JOIN public.report_period_targets t
      ON t.metric_key = m.metric_key
     AND t.period_type = v_instance.period_type
     AND t.period_start = v_instance.period_start
    WHERE v.report_instance_id = p_report_instance_id
      AND m.metric_key = v.metric_key;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count;
END;
$$;

COMMENT ON FUNCTION public.refresh_report_instance(uuid) IS
    'Re-reads live figures and period targets into a DRAFT report. Overrides and their reasons are '
    'preserved.';

CREATE OR REPLACE FUNCTION public.override_report_metric_value(
    p_report_instance_id uuid,
    p_metric_key         text,
    p_entered_value      numeric,
    p_reason             text,
    p_actor_user_id      uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_reason text := NULLIF(TRIM(COALESCE(p_reason, '')), '');
    v_status text;
BEGIN
    SELECT status INTO v_status FROM public.report_instances WHERE id = p_report_instance_id;
    IF v_status IS NULL THEN
        RETURN QUERY SELECT 0, 'Report not found.';
        RETURN;
    END IF;
    IF v_status <> 'draft' THEN
        RETURN QUERY SELECT 0, 'Only a draft report can be edited.';
        RETURN;
    END IF;
    IF p_entered_value IS NULL THEN
        RETURN QUERY SELECT 0, 'A value is required. Use clear_report_metric_override to revert.';
        RETURN;
    END IF;
    IF v_reason IS NULL THEN
        RETURN QUERY SELECT 0, 'A reason is required when overriding a figure.';
        RETURN;
    END IF;

    UPDATE public.report_instance_metric_values
    SET entered_value   = p_entered_value,
        override_reason = v_reason,
        overridden_by   = p_actor_user_id,
        overridden_at   = now()
    WHERE report_instance_id = p_report_instance_id
      AND metric_key = p_metric_key;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'That metric is not part of this report.';
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.override_report_metric_value(uuid, text, numeric, text, uuid) IS
    'Sets Pete''s entered figure for one metric. The reason is mandatory and is also enforced by '
    'the report_metric_override_needs_reason CHECK constraint.';

CREATE OR REPLACE FUNCTION public.clear_report_metric_override(
    p_report_instance_id uuid,
    p_metric_key         text
)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM public.report_instances WHERE id = p_report_instance_id;
    IF v_status IS NULL THEN
        RETURN QUERY SELECT 0, 'Report not found.';
        RETURN;
    END IF;
    IF v_status <> 'draft' THEN
        RETURN QUERY SELECT 0, 'Only a draft report can be edited.';
        RETURN;
    END IF;

    UPDATE public.report_instance_metric_values
    SET entered_value   = NULL,
        override_reason = NULL,
        overridden_by   = NULL,
        overridden_at   = NULL
    WHERE report_instance_id = p_report_instance_id
      AND metric_key = p_metric_key;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'That metric is not part of this report.';
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.clear_report_metric_override(uuid, text) IS
    'Reverts a metric to its system value, clearing the entered figure and its reason.';

CREATE OR REPLACE FUNCTION public.set_report_section_state(
    p_report_instance_id uuid,
    p_section_key        text,
    p_is_enabled         boolean DEFAULT NULL,
    p_commentary         text DEFAULT NULL
)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM public.report_instances WHERE id = p_report_instance_id;
    IF v_status IS NULL THEN
        RETURN QUERY SELECT 0, 'Report not found.';
        RETURN;
    END IF;
    IF v_status <> 'draft' THEN
        RETURN QUERY SELECT 0, 'Only a draft report can be edited.';
        RETURN;
    END IF;

    UPDATE public.report_instance_sections
    SET is_enabled = COALESCE(p_is_enabled, is_enabled),
        commentary = COALESCE(p_commentary, commentary)
    WHERE report_instance_id = p_report_instance_id
      AND section_key = p_section_key;

    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'That section is not part of this report.';
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.set_report_section_state(uuid, text, boolean, text) IS
    'Toggles a section on or off and/or sets its commentary. NULL leaves the existing value alone.';

CREATE OR REPLACE FUNCTION public.set_report_executive_summary(
    p_report_instance_id uuid,
    p_summary            text
)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM public.report_instances WHERE id = p_report_instance_id;
    IF v_status IS NULL THEN
        RETURN QUERY SELECT 0, 'Report not found.';
        RETURN;
    END IF;
    IF v_status <> 'draft' THEN
        RETURN QUERY SELECT 0, 'Only a draft report can be edited.';
        RETURN;
    END IF;

    UPDATE public.report_instances
    SET executive_summary = p_summary
    WHERE id = p_report_instance_id;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.set_report_executive_summary(uuid, text) IS
    'Sets the report-level executive summary on a draft report.';

-- ============================================================================
-- 7. get_report_instance — the single payload the editor, preview and PDF all render from.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_report_instance(p_report_instance_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_instance public.report_instances%ROWTYPE;
    v_result   jsonb;
BEGIN
    SELECT * INTO v_instance FROM public.report_instances WHERE id = p_report_instance_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'id',                v_instance.id,
        'template_id',       v_instance.template_id,
        'template_name',     (SELECT name FROM public.report_templates WHERE id = v_instance.template_id),
        'period_type',       v_instance.period_type,
        'period_start',      v_instance.period_start,
        'period_end',        v_instance.period_end,
        'period_label',      public.report_period_label(v_instance.period_type, v_instance.period_start),
        'fy',                v_instance.fy,
        'fy_month_index',    v_instance.fy_month_index,
        'version',           v_instance.version,
        'status',            v_instance.status,
        'executive_summary', v_instance.executive_summary,
        'generated_at',      v_instance.generated_at,
        'published_at',      v_instance.published_at,
        'supersede_reason',  v_instance.supersede_reason,
        'pdf_storage_path',  v_instance.pdf_storage_path,
        'content_sha256',    v_instance.content_sha256,
        'sections',          COALESCE(sections.arr, '[]'::jsonb)
    )
    INTO v_result
    FROM (
        SELECT jsonb_agg(sec ORDER BY sec ->> 'display_order') AS arr
        FROM (
            SELECT jsonb_build_object(
                       'section_key',   ris.section_key,
                       'label',         s.label,
                       'render_kind',   s.render_kind,
                       'is_enabled',    ris.is_enabled,
                       'display_order', LPAD(ris.display_order::text, 6, '0'),
                       'commentary',    ris.commentary,
                       'metrics',       COALESCE((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'metric_key',      v.metric_key,
                                      'label',           m.label,
                                      'unit',            m.unit,
                                      'division',        m.division,
                                      'has_target',      m.has_target,
                                      'system_value',    v.system_value,
                                      'target_value',    v.target_value,
                                      'entered_value',   v.entered_value,
                                      'effective_value', COALESCE(v.entered_value, v.system_value),
                                      'is_overridden',   v.entered_value IS NOT NULL,
                                      'override_reason', v.override_reason,
                                      'overridden_at',   v.overridden_at,
                                      'overridden_by_name', public.stock_history_user_label(v.overridden_by)
                                  ) ORDER BY v.display_order, v.metric_key)
                           FROM public.report_instance_metric_values v
                           JOIN public.report_metrics m ON m.metric_key = v.metric_key
                           WHERE v.report_instance_id = ris.report_instance_id
                             AND v.section_key = ris.section_key
                       ), '[]'::jsonb),
                       'lines',         COALESCE((
                           SELECT jsonb_agg(jsonb_build_object(
                                      'line_type',  l.line_type,
                                      'sort_index', l.sort_index,
                                      'payload',    l.payload
                                  ) ORDER BY l.sort_index, l.id)
                           FROM public.report_instance_lines l
                           WHERE l.report_instance_id = ris.report_instance_id
                             AND l.section_key = ris.section_key
                       ), '[]'::jsonb)
                   ) AS sec
            FROM public.report_instance_sections ris
            JOIN public.report_sections s ON s.section_key = ris.section_key
            WHERE ris.report_instance_id = p_report_instance_id
        ) inner_sections
    ) sections;

    RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_report_instance(uuid) IS
    'Complete report payload in one round trip: header, sections in order, each section''s metrics '
    '(system, entered, effective, target) and frozen line rows. Consumed by the editor, the '
    'preview and the PDF builder so none of the three can disagree with the others.';

-- ============================================================================
-- 8. Publish and supersede.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.publish_report_instance(
    p_report_instance_id uuid,
    p_actor_user_id      uuid DEFAULT NULL,
    p_pdf_storage_bucket text DEFAULT NULL,
    p_pdf_storage_path   text DEFAULT NULL,
    p_pdf_sha256         text DEFAULT NULL
)
RETURNS TABLE (success integer, error text, content_sha256 text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status  text;
    v_payload jsonb;
    v_hash    text;
BEGIN
    SELECT status INTO v_status FROM public.report_instances WHERE id = p_report_instance_id;
    IF v_status IS NULL THEN
        RETURN QUERY SELECT 0, 'Report not found.', NULL::text;
        RETURN;
    END IF;
    IF v_status <> 'draft' THEN
        RETURN QUERY SELECT 0, format('Report is already %s.', v_status), NULL::text;
        RETURN;
    END IF;

    v_payload := public.get_report_instance(p_report_instance_id);
    v_hash := encode(extensions.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

    UPDATE public.report_instances
    SET status             = 'published',
        published_by       = p_actor_user_id,
        published_at       = now(),
        content_sha256     = v_hash,
        pdf_storage_bucket = COALESCE(p_pdf_storage_bucket, pdf_storage_bucket),
        pdf_storage_path   = COALESCE(p_pdf_storage_path, pdf_storage_path),
        pdf_sha256         = COALESCE(p_pdf_sha256, pdf_sha256)
    WHERE id = p_report_instance_id;

    RETURN QUERY SELECT 1, NULL::text, v_hash;
END;
$$;

COMMENT ON FUNCTION public.publish_report_instance(uuid, uuid, text, text, text) IS
    'Freezes a draft report. After this the child rows are immutable by trigger, and '
    'content_sha256 records exactly what was issued.';

CREATE OR REPLACE FUNCTION public.supersede_report_instance(
    p_report_instance_id uuid,
    p_reason             text,
    p_actor_user_id      uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, new_report_instance_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old    public.report_instances%ROWTYPE;
    v_reason text := NULLIF(TRIM(COALESCE(p_reason, '')), '');
    v_new_id uuid;
BEGIN
    SELECT * INTO v_old FROM public.report_instances WHERE id = p_report_instance_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'Report not found.', NULL::uuid;
        RETURN;
    END IF;
    IF v_old.status <> 'published' THEN
        RETURN QUERY SELECT 0, 'Only a published report can be superseded.', NULL::uuid;
        RETURN;
    END IF;
    IF v_reason IS NULL THEN
        RETURN QUERY SELECT 0, 'A reason is required when re-issuing a published report.', NULL::uuid;
        RETURN;
    END IF;

    -- Retire the old version FIRST: uq_report_instances_live_period allows only one
    -- non-superseded row per template and period, so the new version cannot be inserted until the
    -- old one steps aside.
    UPDATE public.report_instances
    SET status = 'superseded', supersede_reason = v_reason
    WHERE id = p_report_instance_id;

    INSERT INTO public.report_instances
        (template_id, period_type, period_start, period_end, fy, fy_month_index, version,
         supersedes_id, status, executive_summary, generated_by)
    VALUES
        (v_old.template_id, v_old.period_type, v_old.period_start, v_old.period_end, v_old.fy,
         v_old.fy_month_index, v_old.version + 1, v_old.id, 'draft', v_old.executive_summary,
         p_actor_user_id)
    RETURNING id INTO v_new_id;

    -- Copy the previous version's sections, then its figures, so the new draft opens as a faithful
    -- copy of what was issued rather than a blank report.
    INSERT INTO public.report_instance_sections
        (report_instance_id, section_key, is_enabled, display_order, commentary)
    SELECT v_new_id, section_key, is_enabled, display_order, commentary
    FROM public.report_instance_sections
    WHERE report_instance_id = v_old.id;

    INSERT INTO public.report_instance_metric_values
        (report_instance_id, metric_key, section_key, display_order, system_value, target_value,
         entered_value, override_reason, overridden_by, overridden_at)
    SELECT v_new_id, metric_key, section_key, display_order, system_value, target_value,
           entered_value, override_reason, overridden_by, overridden_at
    FROM public.report_instance_metric_values
    WHERE report_instance_id = v_old.id;

    INSERT INTO public.report_instance_lines
        (report_instance_id, section_key, line_type, sort_index, ref_table, ref_id, payload)
    SELECT v_new_id, section_key, line_type, sort_index, ref_table, ref_id, payload
    FROM public.report_instance_lines
    WHERE report_instance_id = v_old.id;

    RETURN QUERY SELECT 1, NULL::text, v_new_id;
END;
$$;

COMMENT ON FUNCTION public.supersede_report_instance(uuid, text, uuid) IS
    'Retires a published report and opens a new draft version copied from it. The original row, '
    'its figures and its PDF pointer are never modified.';

CREATE OR REPLACE FUNCTION public.delete_report_instance(p_report_instance_id uuid)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status text;
BEGIN
    SELECT status INTO v_status FROM public.report_instances WHERE id = p_report_instance_id;
    IF v_status IS NULL THEN
        RETURN QUERY SELECT 0, 'Report not found.';
        RETURN;
    END IF;
    IF v_status <> 'draft' THEN
        RETURN QUERY SELECT 0, 'Only a draft report can be deleted. Published reports are kept.';
        RETURN;
    END IF;

    DELETE FROM public.report_instances WHERE id = p_report_instance_id;
    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.delete_report_instance(uuid) IS
    'Deletes a DRAFT report and its children by cascade. Published and superseded reports are '
    'never deletable — they are the record of what directors received.';

-- ============================================================================
-- 9. List and target/baseline RPCs. All LIMIT-capped.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_report_instances(
    p_period_type text DEFAULT NULL,
    p_status      text DEFAULT NULL,
    p_limit       integer DEFAULT 50,
    p_offset      integer DEFAULT 0
)
RETURNS TABLE (
    id               uuid,
    template_id      uuid,
    template_name    text,
    period_type      text,
    period_start     date,
    period_end       date,
    period_label     text,
    fy               integer,
    version          integer,
    status           text,
    section_count    integer,
    override_count   integer,
    metric_count     integer,
    generated_at     timestamptz,
    published_at     timestamptz,
    pdf_storage_path text,
    total_count      bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    WITH filtered AS (
        SELECT ri.*
        FROM public.report_instances ri
        WHERE (p_period_type IS NULL OR ri.period_type = p_period_type)
          AND (p_status IS NULL OR ri.status = p_status)
    ),
    counted AS (SELECT count(*) AS n FROM filtered)
    SELECT f.id,
           f.template_id,
           t.name,
           f.period_type,
           f.period_start,
           f.period_end,
           public.report_period_label(f.period_type, f.period_start),
           f.fy,
           f.version,
           f.status,
           (SELECT count(*)::integer FROM public.report_instance_sections s
             WHERE s.report_instance_id = f.id AND s.is_enabled),
           (SELECT count(*)::integer FROM public.report_instance_metric_values v
             WHERE v.report_instance_id = f.id AND v.entered_value IS NOT NULL),
           (SELECT count(*)::integer FROM public.report_instance_metric_values v
             WHERE v.report_instance_id = f.id),
           f.generated_at,
           f.published_at,
           f.pdf_storage_path,
           c.n
    FROM filtered f
    JOIN public.report_templates t ON t.id = f.template_id
    CROSS JOIN counted c
    ORDER BY f.period_start DESC, f.version DESC
    LIMIT LEAST(COALESCE(p_limit, 50), 100) OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.list_report_instances(text, text, integer, integer) IS
    'Paged report list. override_count over metric_count is the headline health signal: a section '
    'that stays fully overridden means the underlying capture is not improving. p_limit is capped '
    'at 100; total_count is repeated on every row for pagination.';

CREATE OR REPLACE FUNCTION public.get_report_period_targets(
    p_period_type  text,
    p_period_start date
)
RETURNS TABLE (
    metric_key    text,
    label         text,
    section_key   text,
    unit          text,
    target_value  numeric,
    notes         text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT m.metric_key, m.label, m.section_key, m.unit, t.target_value, t.notes
    FROM public.report_metrics m
    LEFT JOIN public.report_period_targets t
      ON t.metric_key = m.metric_key
     AND t.period_type = p_period_type
     AND t.period_start = public.report_normalise_period_start(p_period_type, p_period_start)
    WHERE m.is_active
      AND m.has_target
      AND p_period_type = ANY (m.period_types)
    ORDER BY m.section_key, m.display_order, m.metric_key
    LIMIT 300;
$$;

COMMENT ON FUNCTION public.get_report_period_targets(text, date) IS
    'Every targetable metric for a period type, with that period''s target where one is set. '
    'Returns a row per metric even when no target exists, so the editor shows the gaps.';

CREATE OR REPLACE FUNCTION public.upsert_report_period_target(
    p_metric_key    text,
    p_period_type   text,
    p_period_date   date,
    p_target_value  numeric,
    p_notes         text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start date;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.report_metrics WHERE metric_key = p_metric_key AND is_active) THEN
        RETURN QUERY SELECT 0, 'Unknown or inactive metric.';
        RETURN;
    END IF;
    IF COALESCE(p_period_type, '') NOT IN ('weekly', 'monthly') THEN
        RETURN QUERY SELECT 0, 'Period type must be weekly or monthly.';
        RETURN;
    END IF;
    IF p_target_value IS NULL OR p_target_value < 0 THEN
        RETURN QUERY SELECT 0, 'Target must be zero or greater.';
        RETURN;
    END IF;

    v_start := public.report_normalise_period_start(p_period_type, p_period_date);
    IF v_start IS NULL THEN
        RETURN QUERY SELECT 0, 'A valid period date is required.';
        RETURN;
    END IF;

    INSERT INTO public.report_period_targets
        (metric_key, period_type, period_start, target_value, notes, set_by)
    VALUES (p_metric_key, p_period_type, v_start, p_target_value, p_notes, p_actor_user_id)
    ON CONFLICT (metric_key, period_type, period_start) DO UPDATE
        SET target_value = EXCLUDED.target_value,
            notes        = EXCLUDED.notes,
            set_by       = EXCLUDED.set_by;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.upsert_report_period_target(text, text, date, numeric, text, uuid) IS
    'Sets one metric''s target for the period containing p_period_date. Does not touch any other '
    'period — a target change part-way through the year cannot rewrite history.';

CREATE OR REPLACE FUNCTION public.copy_report_period_targets(
    p_period_type    text,
    p_from_period    date,
    p_to_period      date,
    p_actor_user_id  uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text, targets_copied integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_from  date;
    v_to    date;
    v_count integer := 0;
BEGIN
    IF COALESCE(p_period_type, '') NOT IN ('weekly', 'monthly') THEN
        RETURN QUERY SELECT 0, 'Period type must be weekly or monthly.', 0;
        RETURN;
    END IF;

    v_from := public.report_normalise_period_start(p_period_type, p_from_period);
    v_to   := public.report_normalise_period_start(p_period_type, p_to_period);

    IF v_from IS NULL OR v_to IS NULL THEN
        RETURN QUERY SELECT 0, 'Both a source and a destination period date are required.', 0;
        RETURN;
    END IF;
    IF v_from = v_to THEN
        RETURN QUERY SELECT 0, 'Source and destination periods are the same.', 0;
        RETURN;
    END IF;

    INSERT INTO public.report_period_targets
        (metric_key, period_type, period_start, target_value, notes, set_by)
    SELECT t.metric_key, t.period_type, v_to, t.target_value, t.notes, p_actor_user_id
    FROM public.report_period_targets t
    WHERE t.period_type = p_period_type AND t.period_start = v_from
    ON CONFLICT (metric_key, period_type, period_start) DO UPDATE
        SET target_value = EXCLUDED.target_value,
            notes        = EXCLUDED.notes,
            set_by       = EXCLUDED.set_by;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN QUERY SELECT 1, NULL::text, v_count;
END;
$$;

COMMENT ON FUNCTION public.copy_report_period_targets(text, date, date, uuid) IS
    'Copies every target from one period to another. Most targets barely move period to period, so '
    'this is the normal way to set them.';

CREATE OR REPLACE FUNCTION public.get_report_manual_baselines(
    p_period_type text,
    p_fy          integer
)
RETURNS TABLE (
    metric_key     text,
    label          text,
    period_start   date,
    achieved_value numeric,
    notes          text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.metric_key, m.label, b.period_start, b.achieved_value, b.notes
    FROM public.report_manual_period_baselines b
    JOIN public.report_metrics m ON m.metric_key = b.metric_key
    WHERE b.period_type = p_period_type
      AND public.report_fy_of_date(b.period_start) = p_fy
    ORDER BY b.period_start, m.section_key, m.display_order
    LIMIT 500;
$$;

COMMENT ON FUNCTION public.get_report_manual_baselines(text, integer) IS
    'Hand-entered prior-period actuals for one financial year. Capped at 500 rows.';

CREATE OR REPLACE FUNCTION public.upsert_report_manual_baseline(
    p_metric_key     text,
    p_period_type    text,
    p_period_date    date,
    p_achieved_value numeric,
    p_notes          text DEFAULT NULL,
    p_actor_user_id  uuid DEFAULT NULL
)
RETURNS TABLE (success integer, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_start date;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.report_metrics WHERE metric_key = p_metric_key AND is_active) THEN
        RETURN QUERY SELECT 0, 'Unknown or inactive metric.';
        RETURN;
    END IF;
    IF COALESCE(p_period_type, '') NOT IN ('weekly', 'monthly') THEN
        RETURN QUERY SELECT 0, 'Period type must be weekly or monthly.';
        RETURN;
    END IF;
    IF p_achieved_value IS NULL THEN
        RETURN QUERY SELECT 0, 'An achieved value is required.';
        RETURN;
    END IF;

    v_start := public.report_normalise_period_start(p_period_type, p_period_date);
    IF v_start IS NULL THEN
        RETURN QUERY SELECT 0, 'A valid period date is required.';
        RETURN;
    END IF;

    INSERT INTO public.report_manual_period_baselines
        (metric_key, period_type, period_start, achieved_value, notes, set_by)
    VALUES (p_metric_key, p_period_type, v_start, p_achieved_value, p_notes, p_actor_user_id)
    ON CONFLICT (metric_key, period_type, period_start) DO UPDATE
        SET achieved_value = EXCLUDED.achieved_value,
            notes          = EXCLUDED.notes,
            set_by         = EXCLUDED.set_by;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

COMMENT ON FUNCTION public.upsert_report_manual_baseline(text, text, date, numeric, text, uuid) IS
    'Records a hand-entered actual for a period that predates the report builder.';

-- ============================================================================
-- 10. RBAC.
--
-- Read functions to every role (precedent: get_stock_edit_history, 20260816090000). Write
-- functions only to the roles that own reporting: Sales Exec (Pete), Palladium Manager (Joslyn),
-- admin and super_user. Deliberately NOT looped over every role and deliberately absent from
-- migrations/20260218000001_grant_all_data_functions_to_all_roles.sql — CLAUDE.md records that
-- pattern as the cause of the current permission drift.
--
-- GRANT ... TO anon is required, not a weakening: WebPortal/js/data-functions.js calls every RPC
-- with the anon key because the portal login token is not a Supabase Auth JWT. The user id passed
-- to these functions is for attribution only and is NOT an authorisation check — the browser holds
-- the public anon key and could pass any uuid, the same caveat recorded in
-- migrations/20260815110000_generic_has_action_gate.sql. Menu and button gating is enforced
-- client-side through features/role_features and actions/role_actions.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.resolve_report_metric_value(text, date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_instance(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_report_instances(text, text, integer, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_period_targets(text, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_report_manual_baselines(text, integer) TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_report_instance(uuid, date, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_report_instance(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.override_report_metric_value(uuid, text, numeric, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_report_metric_override(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_report_section_state(uuid, text, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_report_executive_summary(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_report_instance(uuid, uuid, text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.supersede_report_instance(uuid, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_report_instance(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_report_period_target(text, text, date, numeric, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.copy_report_period_targets(text, date, date, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_report_manual_baseline(text, text, date, numeric, text, uuid) TO anon, authenticated, service_role;

DO $$
DECLARE
    v_role record;
    v_fn   text;
BEGIN
    FOR v_role IN SELECT id, role_name FROM public.roles LOOP
        FOREACH v_fn IN ARRAY ARRAY[
            'resolve_report_metric_value', 'get_report_instance', 'list_report_instances',
            'get_report_period_targets', 'get_report_manual_baselines'
        ] LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role.id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;

        IF v_role.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager') THEN
            FOREACH v_fn IN ARRAY ARRAY[
                'create_report_instance', 'refresh_report_instance', 'override_report_metric_value',
                'clear_report_metric_override', 'set_report_section_state',
                'set_report_executive_summary', 'publish_report_instance',
                'supersede_report_instance', 'delete_report_instance',
                'upsert_report_period_target', 'copy_report_period_targets',
                'upsert_report_manual_baseline'
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
