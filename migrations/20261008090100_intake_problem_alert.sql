-- Intake problem alert.
--
-- Why: the Receiving Checklist already records "vehicle not clean" and "pests found" with a
-- written action, but nobody is told. This raises ONE critical dashboard alert per delivery
-- when either answer is bad. The existing 5-minute pg_cron push (20260910100000_alert_whatsapp_push.sql)
-- sends every active critical alert to WhatsApp, so no change to the push is needed.
--
-- Comment text is read from kernel.intake_data.receiving_checklist.item_comments[<check key>]
-- (written by upsert_kernel_checklist, 20261006090100). Checks other than vehicle_clean and
-- pest_infestations do not alert.
-- The trigger never raises: a checklist save must not fail because of the alert.

-- 1. Allow alert_type 'intake_problem' (look up the existing, possibly auto-named, CHECK).
DO $do$
DECLARE
    v_name text;
BEGIN
    FOR v_name IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'public.dashboard_alerts'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%alert_type%'
    LOOP
        EXECUTE format('ALTER TABLE public.dashboard_alerts DROP CONSTRAINT %I', v_name);
    END LOOP;

    ALTER TABLE public.dashboard_alerts
        ADD CONSTRAINT dashboard_alerts_alert_type_check
        CHECK (alert_type IN ('quality_hold','delay','bottleneck','expiry_warning','stock_low','approval_pending','intake_problem'));
END $do$;

-- 2. Raise (or refresh) the alert for one delivery.
CREATE OR REPLACE FUNCTION public.raise_intake_problem_alert(p_kernel_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_chk       jsonb;
    v_batch     varchar;
    v_lines     text[] := ARRAY[]::text[];
    v_comment   text;
    v_title     text;
    v_message   text;
    v_existing  uuid;
BEGIN
    SELECT k.intake_data -> 'receiving_checklist', b.batch_id
    INTO   v_chk, v_batch
    FROM   public.kernel k
    LEFT JOIN public.batches b ON b.id = k.batch_id
    WHERE  k.id = p_kernel_id;

    IF v_chk IS NULL THEN RETURN; END IF;

    IF COALESCE(v_chk ->> 'vehicle_clean', '') ILIKE 'no' THEN
        v_comment := NULLIF(trim(COALESCE(v_chk -> 'item_comments' ->> 'vehicle_clean', '')), '');
        v_lines := v_lines || trim('Vehicle not clean. ' || COALESCE(v_comment, ''));
    END IF;
    IF COALESCE(v_chk ->> 'pest_infestations', '') ILIKE 'yes' THEN
        v_comment := NULLIF(trim(COALESCE(v_chk -> 'item_comments' ->> 'pest_infestations', '')), '');
        v_lines := v_lines || trim('Pests found. ' || COALESCE(v_comment, ''));
    END IF;

    IF array_length(v_lines, 1) IS NULL THEN RETURN; END IF;

    v_message := array_to_string(v_lines, ' ');
    v_title   := 'Intake problem · Batch ' || COALESCE(v_batch, '');

    SELECT id INTO v_existing
    FROM   public.dashboard_alerts
    WHERE  alert_type = 'intake_problem' AND entity_id = p_kernel_id AND status = 'active'
    ORDER  BY created_at DESC
    LIMIT  1;

    IF v_existing IS NOT NULL THEN
        UPDATE public.dashboard_alerts
        SET alert_title = v_title, alert_message = v_message
        WHERE id = v_existing;
    ELSE
        INSERT INTO public.dashboard_alerts
            (alert_number, alert_type, severity, entity_type, entity_id, batch_number, alert_title, alert_message, status)
        VALUES (
            'ALT-' || to_char(now() AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
            'intake_problem', 'critical', 'kernel', p_kernel_id, v_batch, v_title, v_message, 'active'
        );
    END IF;
END;
$$;

-- 3. Trigger: run it when the checklist changes. Never raises.
CREATE OR REPLACE FUNCTION public.trg_kernel_intake_problem_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    BEGIN
        PERFORM public.raise_intake_problem_alert(NEW.id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'raise_intake_problem_alert failed for kernel %: %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$;

-- Only the trigger calls these; nobody may call them through the API.
REVOKE ALL ON FUNCTION public.raise_intake_problem_alert(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_kernel_intake_problem_alert() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS kernel_intake_problem_alert ON public.kernel;
CREATE TRIGGER kernel_intake_problem_alert
    AFTER UPDATE ON public.kernel
    FOR EACH ROW
    WHEN ((NEW.intake_data -> 'receiving_checklist') IS DISTINCT FROM (OLD.intake_data -> 'receiving_checklist'))
    EXECUTE FUNCTION public.trg_kernel_intake_problem_alert();

-- 4. Self-check.
DO $do$
BEGIN
    IF to_regprocedure('public.raise_intake_problem_alert(uuid)') IS NULL THEN
        RAISE EXCEPTION 'raise_intake_problem_alert missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'kernel_intake_problem_alert'
                   AND tgrelid = 'public.kernel'::regclass AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'kernel_intake_problem_alert trigger missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_alerts_alert_type_check'
                   AND conrelid = 'public.dashboard_alerts'::regclass
                   AND pg_get_constraintdef(oid) ILIKE '%intake_problem%') THEN
        RAISE EXCEPTION 'dashboard_alerts_alert_type_check does not allow intake_problem';
    END IF;
END $do$;

NOTIFY pgrst, 'reload schema';
