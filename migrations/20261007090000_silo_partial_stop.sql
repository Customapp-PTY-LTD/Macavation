-- Silo Allocation: stop cracking without emptying the silo (Henry, 7 Oct 2026).
--
-- Before: close_silo marked EVERYTHING in the silo cracked, so a silo could only be closed when
-- empty. A silo holds ~4 t and is often cracked over several shifts.
-- Now: close_silo(p_silo_number, p_left_kg) records volume = (what was in the silo) − p_left_kg.
-- The cracked kg are taken from the bags oldest-first (first in, first out — nuts feed out of
-- the bottom), so a bag can be partly cracked; whatever is left stays in the silo for the next
-- run. p_left_kg = 0 (the "Silo is empty" shortcut) behaves like the old close.
--
-- silo_allocations.remaining_kg   kg of that bag still in the silo (weight_kg until cracking starts)
-- silo_runs.left_kg               what was left in the silo when the run stopped
-- silo_run_bags                   which bag gave how many kg to which run (batch traceability)
--
-- The superseded close_silo(integer) is RENAMED to close_silo_pre_20261007 (not removed) so
-- PostgREST resolves exactly one close_silo.

-- ============================================================================
-- 1. COLUMNS / TABLE
-- ============================================================================

ALTER TABLE public.silo_allocations ADD COLUMN IF NOT EXISTS remaining_kg numeric;
UPDATE public.silo_allocations
SET remaining_kg = CASE WHEN status = 'in_silo' THEN weight_kg ELSE 0 END
WHERE remaining_kg IS NULL;
ALTER TABLE public.silo_allocations ALTER COLUMN remaining_kg SET NOT NULL;
ALTER TABLE public.silo_allocations ALTER COLUMN remaining_kg SET DEFAULT 0;
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'silo_allocations_remaining_kg_check') THEN
        ALTER TABLE public.silo_allocations
            ADD CONSTRAINT silo_allocations_remaining_kg_check CHECK (remaining_kg >= 0 AND remaining_kg <= weight_kg);
    END IF;
END $do$;

ALTER TABLE public.silo_runs ADD COLUMN IF NOT EXISTS left_kg numeric NULL;

CREATE TABLE IF NOT EXISTS public.silo_run_bags (
    run_id         uuid NOT NULL REFERENCES public.silo_runs(id) ON DELETE CASCADE,
    allocation_id  uuid NOT NULL REFERENCES public.silo_allocations(id) ON DELETE CASCADE,
    kg             numeric NOT NULL CHECK (kg > 0),
    PRIMARY KEY (run_id, allocation_id)
);
REVOKE ALL ON TABLE public.silo_run_bags FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 2. READS / ALLOCATE / UNDO — use remaining_kg as the silo level
-- ============================================================================

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
            'filled_kg',   COALESCE((SELECT sum(a.remaining_kg) FROM public.silo_allocations a
                                     WHERE a.silo_number = s.silo_number AND a.status = 'in_silo'), 0),
            'contents',    COALESCE((
                SELECT jsonb_agg(jsonb_build_object('kernel_id', g.kernel_id, 'batch_number', g.batch_number,
                                                    'kg', g.kg, 'bags', g.bags) ORDER BY g.first_at)
                FROM (
                    SELECT a.kernel_id, b.batch_id AS batch_number, sum(a.remaining_kg) AS kg,
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

CREATE OR REPLACE FUNCTION public.get_silo_runs(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'runs', COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id, 'silo_number', r.silo_number, 'opened_at', r.opened_at, 'closed_at', r.closed_at,
        'volume_kg', r.volume_kg, 'left_kg', r.left_kg, 'batch_numbers', r.batch_numbers,
        'minutes', round(extract(epoch FROM (r.closed_at - r.opened_at)) / 60.0, 1),
        'kg_per_hour', CASE WHEN r.closed_at > r.opened_at
                            THEN round(r.volume_kg / (extract(epoch FROM (r.closed_at - r.opened_at)) / 3600.0), 2) END
    ) ORDER BY r.closed_at DESC), '[]'::jsonb))
    FROM (SELECT * FROM public.silo_runs WHERE closed_at IS NOT NULL
          ORDER BY closed_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))) r;
$$;

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

    SELECT COALESCE(sum(remaining_kg), 0) INTO v_filled
    FROM public.silo_allocations WHERE silo_number = p_silo_number AND status = 'in_silo';

    IF v_filled + v_add > v_cap THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Silo %s has %s kg free. The selected bags weigh %s kg. Choose fewer bags or another silo.',
                   p_silo_number, to_char(GREATEST(v_cap - v_filled, 0), 'FM999,999,990.00'), to_char(v_add, 'FM999,999,990.00')),
            'free_kg', GREATEST(v_cap - v_filled, 0), 'selected_kg', v_add);
    END IF;

    INSERT INTO public.silo_allocations (kernel_id, bag_no, silo_number, weight_kg, remaining_kg)
    SELECT p_kernel_id, (bag ->> 'no')::int, p_silo_number, (bag ->> 'weight_kg')::numeric, (bag ->> 'weight_kg')::numeric
    FROM public.kernel k, jsonb_array_elements(k.intake_data #> '{delivery,bags}') bag
    WHERE k.id = p_kernel_id AND (bag ->> 'no')::int = ANY (p_bag_nos);

    RETURN jsonb_build_object('success', true, 'allocated', cardinality(p_bag_nos), 'kg', v_add);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Undo only while the bag is untouched (no kg cracked from it yet).
CREATE OR REPLACE FUNCTION public.unallocate_silo_bag(p_kernel_id uuid, p_bag_no integer)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.silo_allocations SET status = 'removed', remaining_kg = 0, updated_at = now()
    WHERE kernel_id = p_kernel_id AND bag_no = p_bag_no AND status = 'in_silo' AND remaining_kg = weight_kg;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That bag is not waiting in a silo, or cracking from it has already started.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- 3. close_silo(p_silo_number, p_left_kg) — stop cracking, partial or empty
-- ============================================================================

DO $do$
BEGIN
    IF to_regprocedure('public.close_silo(integer)') IS NOT NULL THEN
        ALTER FUNCTION public.close_silo(integer) RENAME TO close_silo_pre_20261007;
    END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.close_silo(p_silo_number integer, p_left_kg numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run      public.silo_runs%ROWTYPE;
    v_left     numeric := COALESCE(p_left_kg, 0);
    v_before   numeric;
    v_cracked  numeric;
    v_todo     numeric;
    v_take     numeric;
    v_batches  text;
    a          record;
BEGIN
    PERFORM 1 FROM public.silos WHERE silo_number = p_silo_number FOR UPDATE;

    SELECT * INTO v_run FROM public.silo_runs WHERE silo_number = p_silo_number AND closed_at IS NULL FOR UPDATE;
    IF v_run.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is not open.');
    END IF;

    SELECT COALESCE(sum(remaining_kg), 0) INTO v_before
    FROM public.silo_allocations WHERE silo_number = p_silo_number AND status = 'in_silo';

    IF v_left < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kg left in the silo cannot be negative.');
    END IF;
    IF v_left > v_before THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Kg left (%s) cannot be more than the silo held when this run started (%s kg).',
                   to_char(v_left, 'FM999,999,990.00'), to_char(v_before, 'FM999,999,990.00')),
            'in_silo_kg', v_before);
    END IF;

    v_cracked := v_before - v_left;
    v_todo := v_cracked;

    -- First in, first out: oldest allocation (then lowest bag number) is cracked first.
    FOR a IN
        SELECT id, remaining_kg FROM public.silo_allocations
        WHERE silo_number = p_silo_number AND status = 'in_silo'
        ORDER BY allocated_at, kernel_id, bag_no
        FOR UPDATE
    LOOP
        EXIT WHEN v_todo <= 0;
        v_take := LEAST(a.remaining_kg, v_todo);
        IF v_take > 0 THEN
            INSERT INTO public.silo_run_bags (run_id, allocation_id, kg) VALUES (v_run.id, a.id, v_take);
            UPDATE public.silo_allocations
            SET remaining_kg = remaining_kg - v_take,
                status       = CASE WHEN remaining_kg - v_take <= 0 THEN 'cracked' ELSE status END,
                run_id       = v_run.id,
                updated_at   = now()
            WHERE id = a.id;
            v_todo := v_todo - v_take;
        END IF;
    END LOOP;

    -- "Silo is empty": anything left (rounding) is cracked too.
    IF v_left = 0 THEN
        UPDATE public.silo_allocations SET remaining_kg = 0, status = 'cracked', run_id = v_run.id, updated_at = now()
        WHERE silo_number = p_silo_number AND status = 'in_silo';
    END IF;

    SELECT string_agg(DISTINCT b.batch_id, ', ') INTO v_batches
    FROM public.silo_run_bags rb
    JOIN public.silo_allocations sa ON sa.id = rb.allocation_id
    JOIN public.kernel k ON k.id = sa.kernel_id
    JOIN public.batches b ON b.id = k.batch_id
    WHERE rb.run_id = v_run.id;

    UPDATE public.silo_runs
    SET closed_at = now(), volume_kg = v_cracked, left_kg = v_left, batch_numbers = v_batches
    WHERE id = v_run.id;

    RETURN jsonb_build_object('success', true, 'run_id', v_run.id, 'volume_kg', v_cracked, 'left_kg', v_left,
        'emptied', v_left = 0,
        'minutes', round(extract(epoch FROM (now() - v_run.opened_at)) / 60.0, 1),
        'kg_per_hour', CASE WHEN now() > v_run.opened_at
                            THEN round(v_cracked / (extract(epoch FROM (now() - v_run.opened_at)) / 3600.0), 2) END);
END;
$$;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id, 'function', 'close_silo', 'EXECUTE', true
FROM (SELECT DISTINCT role_id FROM public.role_permissions WHERE object_name = 'open_silo' AND allowed) rp
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = rp.role_id AND x.object_name = 'close_silo' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
