-- Procurement calendar: track scheduled grower deliveries before they become kernel batches.
-- Entries are created on the calendar, rescheduled by drag-and-drop, and converted to
-- kernel batches when dragged into the Receiving lane of Grower Intake.

CREATE TABLE IF NOT EXISTS public.kernel_intake_procurement (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scheduled_date date NOT NULL,
    supplier_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
    grower_name text NULL,
    predicted_weight_kg numeric NOT NULL CHECK (predicted_weight_kg > 0),
    status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'converted', 'cancelled')),
    batch_id uuid NULL REFERENCES public.batches(id) ON DELETE SET NULL,
    sort_index integer NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.kernel_intake_procurement IS 'Scheduled grower deliveries visible on the Grower Intake procurement calendar. Converted to kernel batches when moved to Receiving.';
COMMENT ON COLUMN public.kernel_intake_procurement.grower_name IS 'Free-text override; displayed instead of supplier name when set.';
COMMENT ON COLUMN public.kernel_intake_procurement.status IS 'scheduled = on calendar; converted = became a batch; cancelled = removed.';
COMMENT ON COLUMN public.kernel_intake_procurement.batch_id IS 'Set when status = converted; links to the resulting kernel batch.';

CREATE INDEX IF NOT EXISTS idx_kip_scheduled_date ON public.kernel_intake_procurement (scheduled_date);
CREATE INDEX IF NOT EXISTS idx_kip_status ON public.kernel_intake_procurement (status);

REVOKE ALL ON TABLE public.kernel_intake_procurement FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.kernel_intake_procurement TO service_role;

-- -------------------------------------------------------
-- get_kernel_intake_procurements
-- Returns scheduled entries in the requested date range.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_kernel_intake_procurements(
    p_from date,
    p_to   date
)
RETURNS TABLE (
    id                 uuid,
    scheduled_date     date,
    supplier_id        uuid,
    grower_name        text,
    predicted_weight_kg numeric,
    status             text,
    batch_id           uuid,
    sort_index         integer,
    created_at         timestamptz,
    updated_at         timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        id,
        scheduled_date,
        supplier_id,
        grower_name,
        predicted_weight_kg,
        status,
        batch_id,
        sort_index,
        created_at,
        updated_at
    FROM public.kernel_intake_procurement
    WHERE status = 'scheduled'
      AND scheduled_date >= coalesce(p_from, '1900-01-01')
      AND scheduled_date <= coalesce(p_to, '2999-12-31')
    ORDER BY scheduled_date, sort_index NULLS LAST, created_at;
$$;

-- -------------------------------------------------------
-- upsert_kernel_intake_procurement
-- Create or update a procurement entry (reschedule by
-- passing a new p_scheduled_date on an existing p_id).
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_kernel_intake_procurement(
    p_id                  uuid,
    p_scheduled_date      date,
    p_supplier_id         uuid,
    p_grower_name         text,
    p_predicted_weight_kg numeric,
    p_sort_index          integer
)
RETURNS TABLE (
    id                 uuid,
    scheduled_date     date,
    supplier_id        uuid,
    grower_name        text,
    predicted_weight_kg numeric,
    status             text,
    batch_id           uuid,
    sort_index         integer,
    created_at         timestamptz,
    updated_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_predicted_weight_kg IS NULL OR p_predicted_weight_kg <= 0 THEN
        RAISE EXCEPTION 'predicted_weight_kg must be greater than 0';
    END IF;
    IF p_scheduled_date IS NULL THEN
        RAISE EXCEPTION 'scheduled_date is required';
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.kernel_intake_procurement (
            scheduled_date, supplier_id, grower_name,
            predicted_weight_kg, sort_index, created_at, updated_at
        )
        VALUES (
            p_scheduled_date,
            p_supplier_id,
            nullif(trim(coalesce(p_grower_name, '')), ''),
            p_predicted_weight_kg,
            p_sort_index,
            now(), now()
        )
        RETURNING kernel_intake_procurement.id INTO v_id;
    ELSE
        UPDATE public.kernel_intake_procurement
        SET
            scheduled_date      = p_scheduled_date,
            supplier_id         = p_supplier_id,
            grower_name         = nullif(trim(coalesce(p_grower_name, '')), ''),
            predicted_weight_kg = p_predicted_weight_kg,
            sort_index          = p_sort_index,
            updated_at          = now()
        WHERE id = p_id AND status = 'scheduled';
        v_id := p_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Procurement entry not found or already converted/cancelled: %', p_id;
        END IF;
    END IF;

    RETURN QUERY
    SELECT
        k.id, k.scheduled_date, k.supplier_id, k.grower_name,
        k.predicted_weight_kg, k.status, k.batch_id, k.sort_index,
        k.created_at, k.updated_at
    FROM public.kernel_intake_procurement k
    WHERE k.id = v_id;
END;
$$;

-- -------------------------------------------------------
-- convert_kernel_intake_procurement
-- Mark a procurement as converted when the user drags it
-- to the Receiving lane and creates the kernel batch.
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.convert_kernel_intake_procurement(
    p_id       uuid,
    p_batch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer;
BEGIN
    UPDATE public.kernel_intake_procurement
    SET status = 'converted', batch_id = p_batch_id, updated_at = now()
    WHERE id = p_id AND status = 'scheduled';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

-- -------------------------------------------------------
-- delete_kernel_intake_procurement
-- Hard-delete a scheduled procurement (calendar UI delete).
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_kernel_intake_procurement(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer;
BEGIN
    DELETE FROM public.kernel_intake_procurement WHERE id = p_id AND status = 'scheduled';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

-- Authenticated / service_role grants
GRANT EXECUTE ON FUNCTION public.get_kernel_intake_procurements(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_kernel_intake_procurement(uuid, date, uuid, text, numeric, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.convert_kernel_intake_procurement(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_kernel_intake_procurement(uuid) TO authenticated, service_role;

-- RBAC: grant to all portal roles (matches pattern in 20260331000009_...)
DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'get_kernel_intake_procurements',
        'upsert_kernel_intake_procurement',
        'convert_kernel_intake_procurement',
        'delete_kernel_intake_procurement'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles
    LOOP
        FOREACH v_fn IN ARRAY v_fns
        LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.role_permissions
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE'
            ) THEN
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true);
            ELSE
                UPDATE public.role_permissions
                SET allowed = true, updated_at = now()
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE';
            END IF;
        END LOOP;
    END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
