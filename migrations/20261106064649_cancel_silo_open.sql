-- Undo a silo opened by mistake (Production team, 6 Nov 2026).
--
-- open_silo only inserts an open silo_runs row (closed_at IS NULL); no bags move and nothing is
-- counted until close_silo stamps closed_at. So cancelling = deleting that open row. The
-- silo_run_sync_cracking_sheets trigger fires on UPDATE of closed_at/opened_at only, so a delete
-- of an open run touches no cracking sheet. Closed runs are never touched here.

CREATE OR REPLACE FUNCTION public.cancel_silo_open(p_silo_number integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    DELETE FROM public.silo_runs
    WHERE silo_number = p_silo_number AND closed_at IS NULL
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is not open.');
    END IF;
    RETURN jsonb_build_object('success', true, 'run_id', v_id);
END;
$$;

-- Same people who can open a silo can cancel the opening.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id, 'function', 'cancel_silo_open', 'EXECUTE', true
FROM (SELECT DISTINCT role_id FROM public.role_permissions WHERE object_name = 'open_silo' AND allowed) rp
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = rp.role_id AND x.object_name = 'cancel_silo_open' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
