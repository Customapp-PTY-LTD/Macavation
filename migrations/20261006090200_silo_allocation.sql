-- Silo Allocation (Mike Potgieter feedback item 2, 5 Oct 2026; decisions D10, H1).
--
-- A released batch's delivery bags (kernel.intake_data.delivery.bags, numbered by "No.") are
-- allocated to one of the silos in public.silos, up to each silo's capacity. Staff press
-- "Open silo" when cracking from it starts and "Silo complete" when it is empty; the run records
-- the volume and duration so the portal can show kg cracked per hour and per day.
--
-- This is a new design. The physical-silo feature removed on 14 Jul 2026
-- (20260714100701_remove_silo_integration.sql) allocated whole batches and is not restored.

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.silo_runs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    silo_number   integer NOT NULL REFERENCES public.silos(silo_number) ON DELETE RESTRICT,
    opened_at     timestamptz NOT NULL DEFAULT now(),
    closed_at     timestamptz NULL,
    volume_kg     numeric NULL,
    batch_numbers text NULL,
    opened_by     uuid NULL,
    closed_by     uuid NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_silo_runs_one_open ON public.silo_runs (silo_number) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_silo_runs_closed_at ON public.silo_runs (closed_at DESC);

CREATE TABLE IF NOT EXISTS public.silo_allocations (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kernel_id     uuid NOT NULL REFERENCES public.kernel(id) ON DELETE CASCADE,
    bag_no        integer NOT NULL CHECK (bag_no > 0),
    silo_number   integer NOT NULL REFERENCES public.silos(silo_number) ON DELETE RESTRICT,
    weight_kg     numeric NOT NULL CHECK (weight_kg >= 0),
    status        text NOT NULL DEFAULT 'in_silo' CHECK (status IN ('in_silo', 'cracked', 'removed')),
    run_id        uuid NULL REFERENCES public.silo_runs(id) ON DELETE SET NULL,
    allocated_at  timestamptz NOT NULL DEFAULT now(),
    allocated_by  uuid NULL,
    updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_silo_allocations_live_bag
    ON public.silo_allocations (kernel_id, bag_no) WHERE status <> 'removed';
CREATE INDEX IF NOT EXISTS idx_silo_allocations_silo_status ON public.silo_allocations (silo_number, status);

REVOKE ALL ON TABLE public.silo_runs, public.silo_allocations FROM anon, authenticated;

-- ============================================================================
-- 2. READS
-- ============================================================================

-- Every silo with its capacity, current contents (bags still in_silo, grouped by batch) and any
-- open run.
CREATE OR REPLACE FUNCTION public.get_silo_overview()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'silos', COALESCE(jsonb_agg(x ORDER BY (x ->> 'silo_number')::int), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'silo_number', s.silo_number,
            'capacity_kg', s.capacity_kg,
            'is_active',   s.is_active,
            'filled_kg',   COALESCE((SELECT sum(a.weight_kg) FROM public.silo_allocations a
                                     WHERE a.silo_number = s.silo_number AND a.status = 'in_silo'), 0),
            'contents',    COALESCE((
                SELECT jsonb_agg(jsonb_build_object('kernel_id', g.kernel_id, 'batch_number', g.batch_number,
                                                    'kg', g.kg, 'bags', g.bags) ORDER BY g.first_at)
                FROM (
                    SELECT a.kernel_id, b.batch_id AS batch_number, sum(a.weight_kg) AS kg,
                           jsonb_agg(a.bag_no ORDER BY a.bag_no) AS bags, min(a.allocated_at) AS first_at
                    FROM public.silo_allocations a
                    JOIN public.kernel k ON k.id = a.kernel_id
                    JOIN public.batches b ON b.id = k.batch_id
                    WHERE a.silo_number = s.silo_number AND a.status = 'in_silo'
                    GROUP BY a.kernel_id, b.batch_id
                ) g), '[]'::jsonb),
            'open_run',    (SELECT jsonb_build_object('id', r.id, 'opened_at', r.opened_at)
                            FROM public.silo_runs r WHERE r.silo_number = s.silo_number AND r.closed_at IS NULL)
        ) AS x
        FROM public.silos s
        WHERE s.is_active
    ) t;
$$;

-- Released batches that have delivery bags, with each bag's allocation (if any).
CREATE OR REPLACE FUNCTION public.get_silo_allocation_batches()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'batches', COALESCE(jsonb_agg(x ORDER BY x ->> 'received_date' DESC, x ->> 'batch_number'), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'kernel_id',     k.id,
            'batch_number',  b.batch_id,
            'grower_name',   k.grower_name,
            'received_date', k.received_date,
            'bags', COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                    'no',          (bag ->> 'no')::int,
                    'description', bag ->> 'description',
                    'weight_kg',   (bag ->> 'weight_kg')::numeric,
                    'silo_number', a.silo_number,
                    'status',      a.status) ORDER BY (bag ->> 'no')::int)
                FROM jsonb_array_elements(k.intake_data #> '{delivery,bags}') bag
                LEFT JOIN public.silo_allocations a
                       ON a.kernel_id = k.id AND a.bag_no = (bag ->> 'no')::int AND a.status <> 'removed'
            ), '[]'::jsonb)
        ) AS x
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE k.is_active
          AND k.status = 'production'
          AND jsonb_typeof(k.intake_data #> '{delivery,bags}') = 'array'
          AND jsonb_array_length(k.intake_data #> '{delivery,bags}') > 0
    ) t;
$$;

CREATE OR REPLACE FUNCTION public.get_silo_runs(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'runs', COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id, 'silo_number', r.silo_number, 'opened_at', r.opened_at, 'closed_at', r.closed_at,
        'volume_kg', r.volume_kg, 'batch_numbers', r.batch_numbers,
        'minutes', round(extract(epoch FROM (r.closed_at - r.opened_at)) / 60.0, 1),
        'kg_per_hour', CASE WHEN r.closed_at > r.opened_at
                            THEN round(r.volume_kg / (extract(epoch FROM (r.closed_at - r.opened_at)) / 3600.0), 2) END
    ) ORDER BY r.closed_at DESC), '[]'::jsonb))
    FROM (SELECT * FROM public.silo_runs WHERE closed_at IS NOT NULL
          ORDER BY closed_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))) r;
$$;

-- ============================================================================
-- 3. WRITES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.allocate_bags_to_silo(p_kernel_id uuid, p_bag_nos integer[], p_silo_number integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_cap     numeric;
    v_filled  numeric;
    v_add     numeric;
    v_found   integer;
    v_taken   integer;
BEGIN
    IF p_bag_nos IS NULL OR cardinality(p_bag_nos) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tick at least one bag.');
    END IF;

    SELECT capacity_kg INTO v_cap FROM public.silos WHERE silo_number = p_silo_number AND is_active FOR UPDATE;
    IF v_cap IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Silo not found');
    END IF;

    SELECT count(*), COALESCE(sum((bag ->> 'weight_kg')::numeric), 0)
    INTO v_found, v_add
    FROM public.kernel k, jsonb_array_elements(k.intake_data #> '{delivery,bags}') bag
    WHERE k.id = p_kernel_id AND k.is_active AND (bag ->> 'no')::int = ANY (p_bag_nos);

    IF v_found <> cardinality(p_bag_nos) THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more bags were not found on this delivery.');
    END IF;

    SELECT count(*) INTO v_taken FROM public.silo_allocations
    WHERE kernel_id = p_kernel_id AND bag_no = ANY (p_bag_nos) AND status <> 'removed';
    IF v_taken > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more of those bags is already in a silo.');
    END IF;

    SELECT COALESCE(sum(weight_kg), 0) INTO v_filled
    FROM public.silo_allocations WHERE silo_number = p_silo_number AND status = 'in_silo';

    IF v_filled + v_add > v_cap THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Silo %s has %s kg free. The selected bags weigh %s kg. Choose fewer bags or another silo.',
                   p_silo_number, to_char(GREATEST(v_cap - v_filled, 0), 'FM999,999,990.00'), to_char(v_add, 'FM999,999,990.00')),
            'free_kg', GREATEST(v_cap - v_filled, 0), 'selected_kg', v_add);
    END IF;

    INSERT INTO public.silo_allocations (kernel_id, bag_no, silo_number, weight_kg)
    SELECT p_kernel_id, (bag ->> 'no')::int, p_silo_number, (bag ->> 'weight_kg')::numeric
    FROM public.kernel k, jsonb_array_elements(k.intake_data #> '{delivery,bags}') bag
    WHERE k.id = p_kernel_id AND (bag ->> 'no')::int = ANY (p_bag_nos);

    RETURN jsonb_build_object('success', true, 'allocated', cardinality(p_bag_nos), 'kg', v_add);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Undo an allocation that has not been cracked yet.
CREATE OR REPLACE FUNCTION public.unallocate_silo_bag(p_kernel_id uuid, p_bag_no integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.silo_allocations SET status = 'removed', updated_at = now()
    WHERE kernel_id = p_kernel_id AND bag_no = p_bag_no AND status = 'in_silo';
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That bag is not waiting in a silo.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.open_silo(p_silo_number integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.silo_allocations WHERE silo_number = p_silo_number AND status = 'in_silo') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is empty. Allocate bags to it first.');
    END IF;
    INSERT INTO public.silo_runs (silo_number) VALUES (p_silo_number) RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'run_id', v_id);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'This silo is already open.');
END;
$$;

-- Close the open run: everything in the silo is marked cracked and the run records its volume.
CREATE OR REPLACE FUNCTION public.close_silo(p_silo_number integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run     public.silo_runs%ROWTYPE;
    v_kg      numeric;
    v_batches text;
BEGIN
    SELECT * INTO v_run FROM public.silo_runs WHERE silo_number = p_silo_number AND closed_at IS NULL FOR UPDATE;
    IF v_run.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is not open.');
    END IF;

    SELECT COALESCE(sum(a.weight_kg), 0), string_agg(DISTINCT b.batch_id, ', ')
    INTO v_kg, v_batches
    FROM public.silo_allocations a
    JOIN public.kernel k ON k.id = a.kernel_id
    JOIN public.batches b ON b.id = k.batch_id
    WHERE a.silo_number = p_silo_number AND a.status = 'in_silo';

    UPDATE public.silo_allocations SET status = 'cracked', run_id = v_run.id, updated_at = now()
    WHERE silo_number = p_silo_number AND status = 'in_silo';

    UPDATE public.silo_runs SET closed_at = now(), volume_kg = v_kg, batch_numbers = v_batches
    WHERE id = v_run.id;

    RETURN jsonb_build_object('success', true, 'run_id', v_run.id, 'volume_kg', v_kg,
        'minutes', round(extract(epoch FROM (now() - v_run.opened_at)) / 60.0, 1),
        'kg_per_hour', CASE WHEN now() > v_run.opened_at
                            THEN round(v_kg / (extract(epoch FROM (now() - v_run.opened_at)) / 3600.0), 2) END);
END;
$$;

NOTIFY pgrst, 'reload schema';
