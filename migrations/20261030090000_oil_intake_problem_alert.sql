-- Oil intake problem alert.
--
-- Why: the oil New delivery screen now asks the same "what was wrong and what action was taken?"
-- question as the nut-in-shell Receiving Checklist, but only kernel raised an alert
-- (20261008090100_intake_problem_alert.sql). This raises ONE critical dashboard alert per oil
-- DELIVERY when the vehicle was not clean or pests were found. Every bag on a delivery is its own
-- oil row carrying the same checks, so the alert is keyed on intake_data.delivery_group_id
-- (entity_type 'oil_delivery'); a row without a group falls back to its own id.
-- The existing 5-minute pg_cron push sends every active critical alert to WhatsApp.
--
-- Checks are read from oil.intake_data (vehicle_clean / pest_infestations) and the comments from
-- oil.intake_data.item_comments[<check key>] (written by the oil New delivery modal).
-- The trigger never raises: a delivery save must not fail because of the alert.

-- 1. Raise (or refresh) the alert for the delivery one oil row belongs to.
CREATE OR REPLACE FUNCTION public.raise_oil_intake_problem_alert(p_oil_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_data      jsonb;
    v_batch     varchar;
    v_group     uuid;
    v_lines     text[] := ARRAY[]::text[];
    v_comment   text;
    v_supplier  text;
    v_title     text;
    v_message   text;
    v_existing  uuid;
BEGIN
    SELECT o.intake_data, o.batch_id
    INTO   v_data, v_batch
    FROM   public.oil o
    WHERE  o.id = p_oil_id;

    IF v_data IS NULL THEN RETURN; END IF;

    BEGIN
        v_group := NULLIF(v_data ->> 'delivery_group_id', '')::uuid;
    EXCEPTION WHEN OTHERS THEN
        v_group := NULL;
    END;
    v_group := COALESCE(v_group, p_oil_id);

    IF COALESCE(v_data ->> 'vehicle_clean', '') ILIKE 'no' THEN
        v_comment := NULLIF(trim(COALESCE(v_data -> 'item_comments' ->> 'vehicle_clean', '')), '');
        v_lines := v_lines || trim('Vehicle not clean. ' || COALESCE(v_comment, ''));
    END IF;
    IF COALESCE(v_data ->> 'pest_infestations', '') ILIKE 'yes' THEN
        v_comment := NULLIF(trim(COALESCE(v_data -> 'item_comments' ->> 'pest_infestations', '')), '');
        v_lines := v_lines || trim('Pests found. ' || COALESCE(v_comment, ''));
    END IF;

    IF array_length(v_lines, 1) IS NULL THEN RETURN; END IF;

    v_supplier := NULLIF(trim(COALESCE(v_data ->> 'supplier', v_data ->> 'supplier_details', '')), '');
    v_message := array_to_string(v_lines, ' ');
    v_title   := 'Oil intake problem · '
                 || COALESCE('DN ' || NULLIF(trim(COALESCE(v_data ->> 'delivery_note_ref', '')), ''), 'Batch ' || COALESCE(v_batch, ''))
                 || COALESCE(' · ' || v_supplier, '');

    SELECT id INTO v_existing
    FROM   public.dashboard_alerts
    WHERE  alert_type = 'intake_problem' AND entity_type = 'oil_delivery' AND entity_id = v_group AND status = 'active'
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
            'intake_problem', 'critical', 'oil_delivery', v_group, v_batch, v_title, v_message, 'active'
        );
    END IF;
END;
$$;

-- 2. Trigger: run it when an oil row is created or its checks / comments change. Never raises.
CREATE OR REPLACE FUNCTION public.trg_oil_intake_problem_alert()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND (NEW.intake_data -> 'vehicle_clean') IS NOT DISTINCT FROM (OLD.intake_data -> 'vehicle_clean')
       AND (NEW.intake_data -> 'pest_infestations') IS NOT DISTINCT FROM (OLD.intake_data -> 'pest_infestations')
       AND (NEW.intake_data -> 'item_comments') IS NOT DISTINCT FROM (OLD.intake_data -> 'item_comments') THEN
        RETURN NEW;
    END IF;
    BEGIN
        PERFORM public.raise_oil_intake_problem_alert(NEW.id);
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'raise_oil_intake_problem_alert failed for oil %: %', NEW.id, SQLERRM;
    END;
    RETURN NEW;
END;
$$;

-- Only the trigger calls these; nobody may call them through the API.
REVOKE ALL ON FUNCTION public.raise_oil_intake_problem_alert(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_oil_intake_problem_alert() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE TRIGGER oil_intake_problem_alert
    AFTER INSERT OR UPDATE ON public.oil
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_oil_intake_problem_alert();

-- 3. Self-check.
DO $do$
BEGIN
    IF to_regprocedure('public.raise_oil_intake_problem_alert(uuid)') IS NULL THEN
        RAISE EXCEPTION 'raise_oil_intake_problem_alert missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'oil_intake_problem_alert'
                   AND tgrelid = 'public.oil'::regclass AND NOT tgisinternal) THEN
        RAISE EXCEPTION 'oil_intake_problem_alert trigger missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dashboard_alerts_alert_type_check'
                   AND conrelid = 'public.dashboard_alerts'::regclass
                   AND pg_get_constraintdef(oid) ILIKE '%intake_problem%') THEN
        RAISE EXCEPTION 'dashboard_alerts_alert_type_check does not allow intake_problem (apply 20261008090100 first)';
    END IF;
END $do$;

NOTIFY pgrst, 'reload schema';
