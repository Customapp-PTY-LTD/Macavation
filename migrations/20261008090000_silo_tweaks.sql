-- Silo Allocation tweaks (Henry, 8 Oct 2026; mockups SiloAllocate / SiloColours / OpenSilo).
--
-- 1. Pre-sizer is captured per allocation, not at release. allocate_bags_to_silo now REQUIRES
--    p_removed_pre_sizer_kg (0 if none); it is spread over the selected bags in proportion to weight
--    and stored in silo_allocations.presizer_kg. A silo only ever holds the level
--    (bag kg - presizer kg). kernel.intake_data.removed_pre_sizer_kg is kept equal to the sum over the
--    batch's live allocations so the job card / batch history keep working. release_kernel_to_production
--    no longer requires a pre-sizer figure.
-- 2. A silo holds one batch at a time (guard in allocate_bags_to_silo).
-- 3. Finished batches (nothing waiting, nothing in a silo) drop off get_silo_allocation_batches, which
--    also reports waiting_count / in_silo_count.
-- 4. Start / stop times can be typed in: open_silo(p_opened_at), close_silo(p_opened_at, p_closed_at),
--    update_silo_run_times, record_silo_run (log a run after the fact). silo_runs.times_edited flags
--    any run whose times were hand-entered. get_batch_cracking_runs feeds the production sheet.
--
-- Superseded signatures are RENAMED to <name>_pre_20261008 (not removed) so PostgREST resolves exactly
-- one candidate: open_silo(integer), close_silo(integer, numeric), allocate_bags_to_silo(uuid, integer[], integer).
-- The FIFO cracking logic of close_silo (20261007090000) moves unchanged into _close_silo_run, apart
-- from taking the closing time as a parameter.

-- ============================================================================
-- 1. COLUMNS
-- ============================================================================

ALTER TABLE public.silo_allocations ADD COLUMN IF NOT EXISTS presizer_kg numeric NOT NULL DEFAULT 0;
ALTER TABLE public.silo_allocations ADD COLUMN IF NOT EXISTS allocation_group uuid NULL;
DO $do$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'silo_allocations_presizer_kg_check') THEN
        ALTER TABLE public.silo_allocations
            ADD CONSTRAINT silo_allocations_presizer_kg_check CHECK (presizer_kg >= 0 AND presizer_kg <= weight_kg);
    END IF;
END $do$;
CREATE INDEX IF NOT EXISTS idx_silo_allocations_group ON public.silo_allocations (kernel_id, allocation_group);

ALTER TABLE public.silo_runs ADD COLUMN IF NOT EXISTS times_edited boolean NOT NULL DEFAULT false;

-- ============================================================================
-- 2. INTERNAL HELPERS (not callable from the portal)
-- ============================================================================

-- Returns an error message, or NULL when the times are acceptable.
CREATE OR REPLACE FUNCTION public._silo_check_times(p_opened_at timestamptz, p_closed_at timestamptz)
RETURNS text
LANGUAGE sql STABLE SET search_path = public
AS $$
    SELECT CASE
        WHEN p_opened_at IS NOT NULL AND p_closed_at IS NOT NULL AND p_closed_at <= p_opened_at
            THEN 'The stop time must be after the start time.'
        WHEN (p_opened_at IS NOT NULL AND p_opened_at > now() + interval '5 minutes')
          OR (p_closed_at IS NOT NULL AND p_closed_at > now() + interval '5 minutes')
            THEN 'Times can''t be in the future.'
    END;
$$;

-- Keep kernel.intake_data.removed_pre_sizer_kg = sum of the batch's live allocations' presizer_kg.
CREATE OR REPLACE FUNCTION public._silo_sync_presizer(p_kernel_id uuid)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
    UPDATE public.kernel
    SET intake_data = COALESCE(intake_data, '{}'::jsonb) || jsonb_build_object('removed_pre_sizer_kg',
            COALESCE((SELECT sum(a.presizer_kg) FROM public.silo_allocations a
                      WHERE a.kernel_id = p_kernel_id AND a.status <> 'removed'), 0)),
        updated_at = now()
    WHERE id = p_kernel_id;
$$;

-- The FIFO close, unchanged from close_silo(integer, numeric) in 20261007090000 except that the closing
-- time is a parameter. Errors are returned as {success:false}; nothing has been written when it does.
CREATE OR REPLACE FUNCTION public._close_silo_run(p_run_id uuid, p_left_kg numeric, p_closed_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run      public.silo_runs%ROWTYPE;
    v_silo     integer;
    v_closed   timestamptz := COALESCE(p_closed_at, now());
    v_left     numeric := COALESCE(p_left_kg, 0);
    v_before   numeric;
    v_cracked  numeric;
    v_todo     numeric;
    v_take     numeric;
    v_batches  text;
    a          record;
BEGIN
    SELECT silo_number INTO v_silo FROM public.silo_runs WHERE id = p_run_id;
    IF v_silo IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is not open.');
    END IF;

    PERFORM 1 FROM public.silos WHERE silo_number = v_silo FOR UPDATE;

    SELECT * INTO v_run FROM public.silo_runs WHERE id = p_run_id AND closed_at IS NULL FOR UPDATE;
    IF v_run.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is not open.');
    END IF;

    SELECT COALESCE(sum(remaining_kg), 0) INTO v_before
    FROM public.silo_allocations WHERE silo_number = v_silo AND status = 'in_silo';

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
        WHERE silo_number = v_silo AND status = 'in_silo'
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
        WHERE silo_number = v_silo AND status = 'in_silo';
    END IF;

    SELECT string_agg(DISTINCT b.batch_id, ', ') INTO v_batches
    FROM public.silo_run_bags rb
    JOIN public.silo_allocations sa ON sa.id = rb.allocation_id
    JOIN public.kernel k ON k.id = sa.kernel_id
    JOIN public.batches b ON b.id = k.batch_id
    WHERE rb.run_id = v_run.id;

    UPDATE public.silo_runs
    SET closed_at = v_closed, volume_kg = v_cracked, left_kg = v_left, batch_numbers = v_batches
    WHERE id = v_run.id;

    RETURN jsonb_build_object('success', true, 'run_id', v_run.id, 'volume_kg', v_cracked, 'left_kg', v_left,
        'emptied', v_left = 0,
        'minutes', round(extract(epoch FROM (v_closed - v_run.opened_at)) / 60.0, 1),
        'kg_per_hour', CASE WHEN v_closed > v_run.opened_at
                            THEN round(v_cracked / (extract(epoch FROM (v_closed - v_run.opened_at)) / 3600.0), 2) END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public._silo_check_times(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._silo_sync_presizer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._close_silo_run(uuid, numeric, timestamptz) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. ALLOCATE / UNDO / TALLY
-- ============================================================================

DO $do$
BEGIN
    IF to_regprocedure('public.allocate_bags_to_silo(uuid, integer[], integer)') IS NOT NULL THEN
        ALTER FUNCTION public.allocate_bags_to_silo(uuid, integer[], integer) RENAME TO allocate_bags_to_silo_pre_20261008;
    END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.allocate_bags_to_silo(
    p_kernel_id            uuid,
    p_bag_nos              integer[],
    p_silo_number          integer,
    p_removed_pre_sizer_kg numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_cap      numeric;
    v_filled   numeric;
    v_add      numeric;
    v_found    integer;
    v_taken    integer;
    v_other    text;
    v_group    uuid := gen_random_uuid();
    v_left     numeric := p_removed_pre_sizer_kg;
    v_share    numeric;
    v_i        integer := 0;
    v_n        integer;
    r          record;
BEGIN
    IF p_bag_nos IS NULL OR cardinality(p_bag_nos) = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Tick at least one bag.');
    END IF;
    IF p_removed_pre_sizer_kg IS NULL OR p_removed_pre_sizer_kg < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the kg removed at the pre-sizer. Use 0 if none.');
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
    IF p_removed_pre_sizer_kg > v_add THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('The pre-sizer removed (%s kg) cannot be more than the selected bags weigh (%s kg).',
                   to_char(p_removed_pre_sizer_kg, 'FM999,999,990.00'), to_char(v_add, 'FM999,999,990.00')));
    END IF;

    SELECT count(*) INTO v_taken FROM public.silo_allocations
    WHERE kernel_id = p_kernel_id AND bag_no = ANY (p_bag_nos) AND status <> 'removed';
    IF v_taken > 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'One or more of those bags is already in a silo.');
    END IF;

    -- A silo holds one batch at a time.
    SELECT b.batch_id INTO v_other
    FROM public.silo_allocations a
    JOIN public.kernel k ON k.id = a.kernel_id
    JOIN public.batches b ON b.id = k.batch_id
    WHERE a.silo_number = p_silo_number AND a.status = 'in_silo' AND a.kernel_id <> p_kernel_id
    LIMIT 1;
    IF v_other IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Silo %s holds batch %s. A silo can only hold one batch at a time.', p_silo_number, v_other));
    END IF;

    SELECT COALESCE(sum(remaining_kg), 0) INTO v_filled
    FROM public.silo_allocations WHERE silo_number = p_silo_number AND status = 'in_silo';

    IF v_filled + (v_add - p_removed_pre_sizer_kg) > v_cap THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Silo %s has %s kg free. The selected bags weigh %s kg after the pre-sizer. Choose fewer bags or another silo.',
                   p_silo_number, to_char(GREATEST(v_cap - v_filled, 0), 'FM999,999,990.00'),
                   to_char(v_add - p_removed_pre_sizer_kg, 'FM999,999,990.00')),
            'free_kg', GREATEST(v_cap - v_filled, 0), 'selected_kg', v_add - p_removed_pre_sizer_kg);
    END IF;

    -- Spread the pre-sizer kg over the bags in proportion to weight (2 dp; the last bag takes the remainder).
    v_n := cardinality(p_bag_nos);
    FOR r IN
        SELECT (bag ->> 'no')::int AS no, (bag ->> 'weight_kg')::numeric AS w
        FROM public.kernel k, jsonb_array_elements(k.intake_data #> '{delivery,bags}') bag
        WHERE k.id = p_kernel_id AND (bag ->> 'no')::int = ANY (p_bag_nos)
        ORDER BY (bag ->> 'no')::int
    LOOP
        v_i := v_i + 1;
        IF v_i = v_n THEN
            v_share := v_left;
        ELSIF v_add > 0 THEN
            v_share := LEAST(round(p_removed_pre_sizer_kg * r.w / v_add, 2), r.w, v_left);
        ELSE
            v_share := 0;
        END IF;
        v_left := v_left - v_share;
        INSERT INTO public.silo_allocations (kernel_id, bag_no, silo_number, weight_kg, remaining_kg, presizer_kg, allocation_group)
        VALUES (p_kernel_id, r.no, p_silo_number, r.w, r.w - v_share, v_share, v_group);
    END LOOP;

    PERFORM public._silo_sync_presizer(p_kernel_id);

    RETURN jsonb_build_object('success', true, 'allocated', cardinality(p_bag_nos), 'kg', v_add,
        'removed_kg', p_removed_pre_sizer_kg, 'into_silo_kg', v_add - p_removed_pre_sizer_kg);
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
    WHERE kernel_id = p_kernel_id AND bag_no = p_bag_no AND status = 'in_silo'
      AND remaining_kg = weight_kg - presizer_kg;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'That bag is not waiting in a silo, or cracking from it has already started.');
    END IF;
    PERFORM public._silo_sync_presizer(p_kernel_id);
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Pre-sizer tally for one batch. Allocations made before 20261008 have no allocation_group; they are
-- grouped by (silo, minute).
CREATE OR REPLACE FUNCTION public.get_presizer_tally(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH al AS (
        SELECT a.*,
               COALESCE(a.allocation_group::text,
                        'legacy|' || a.silo_number::text || '|' || date_trunc('minute', a.allocated_at)::text) AS gkey
        FROM public.silo_allocations a
        WHERE a.kernel_id = p_kernel_id AND a.status <> 'removed'
    ), g AS (
        SELECT gkey,
               (array_agg(allocation_group))[1]  AS allocation_group,
               min(allocated_at)                 AS allocated_at,
               min(silo_number)                  AS silo_number,
               array_agg(bag_no ORDER BY bag_no) AS bag_nos,
               sum(weight_kg)                    AS bag_kg,
               sum(presizer_kg)                  AS removed_kg
        FROM al GROUP BY gkey
    )
    SELECT jsonb_build_object(
        'success', true,
        'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'allocation_group', g.allocation_group, 'allocated_at', g.allocated_at,
                    'silo_number', g.silo_number, 'bag_nos', to_jsonb(g.bag_nos),
                    'bag_kg', g.bag_kg, 'removed_kg', g.removed_kg) ORDER BY g.allocated_at) FROM g), '[]'::jsonb),
        'total_bag_kg', COALESCE((SELECT sum(bag_kg) FROM g), 0),
        'total_removed_kg', COALESCE((SELECT sum(removed_kg) FROM g), 0),
        'waiting_bag_nos', COALESCE((
            SELECT jsonb_agg((bag ->> 'no')::int ORDER BY (bag ->> 'no')::int)
            FROM public.kernel k,
                 jsonb_array_elements(CASE WHEN jsonb_typeof(k.intake_data #> '{delivery,bags}') = 'array'
                                           THEN k.intake_data #> '{delivery,bags}' ELSE '[]'::jsonb END) bag
            WHERE k.id = p_kernel_id
              AND NOT EXISTS (SELECT 1 FROM al WHERE al.bag_no = (bag ->> 'no')::int)), '[]'::jsonb)
    );
$$;

-- ============================================================================
-- 4. get_silo_allocation_batches — waiting / in_silo counts; finished batches drop off
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_silo_allocation_batches()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'batches', COALESCE(jsonb_agg(t.x ORDER BY t.x ->> 'received_date' DESC, t.x ->> 'batch_number'), '[]'::jsonb))
    FROM (
        SELECT jsonb_build_object(
            'kernel_id',      k.id,
            'batch_number',   b.batch_id,
            'grower_name',    k.grower_name,
            'received_date',  k.received_date,
            'waiting_count',  z.waiting,
            'in_silo_count',  z.in_silo,
            'bags',           z.bags
        ) AS x
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        CROSS JOIN LATERAL (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'no',          (bag ->> 'no')::int,
                       'description', bag ->> 'description',
                       'weight_kg',   (bag ->> 'weight_kg')::numeric,
                       'silo_number', a.silo_number,
                       'status',      a.status) ORDER BY (bag ->> 'no')::int), '[]'::jsonb) AS bags,
                   count(*) FILTER (WHERE a.id IS NULL)          AS waiting,
                   count(*) FILTER (WHERE a.status = 'in_silo')  AS in_silo
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(k.intake_data #> '{delivery,bags}') = 'array'
                                           THEN k.intake_data #> '{delivery,bags}' ELSE '[]'::jsonb END) bag
            LEFT JOIN public.silo_allocations a
                   ON a.kernel_id = k.id AND a.bag_no = (bag ->> 'no')::int AND a.status <> 'removed'
        ) z
        WHERE k.is_active
          AND k.status = 'production'
          AND jsonb_typeof(k.intake_data #> '{delivery,bags}') = 'array'
          AND jsonb_array_length(k.intake_data #> '{delivery,bags}') > 0
          AND (z.waiting > 0 OR z.in_silo > 0)
    ) t;
$$;

-- ============================================================================
-- 5. release_kernel_to_production — pre-sizer is optional now
-- ============================================================================

CREATE OR REPLACE FUNCTION public.release_kernel_to_production(
    p_kernel_id            uuid,
    p_removed_pre_sizer_kg numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_has_ziplock boolean;
    v_has_5kg     boolean;
    v_status      varchar;
BEGIN
    SELECT
        (intake_data #>> '{ziplock_sample,completed_at}') IS NOT NULL,
        (intake_data #>> '{five_kg_sample,completed_at}') IS NOT NULL,
        status
    INTO v_has_ziplock, v_has_5kg, v_status
    FROM public.kernel
    WHERE id = p_kernel_id
      AND is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel record not found or inactive');
    END IF;

    IF v_status NOT IN ('intake', 'receiving') THEN
        RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'already_released', true);
    END IF;

    IF NOT v_has_ziplock THEN
        RETURN jsonb_build_object('success', false, 'error', 'Ziplock sample not completed — save it before releasing.');
    END IF;

    IF NOT v_has_5kg THEN
        RETURN jsonb_build_object('success', false, 'error', '5kg sample not completed — save it before releasing.');
    END IF;

    IF p_removed_pre_sizer_kg IS NOT NULL AND p_removed_pre_sizer_kg < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Removed pre-sizer cannot be negative.');
    END IF;

    UPDATE public.kernel
    SET status      = 'production',
        intake_data = CASE WHEN p_removed_pre_sizer_kg IS NULL
                           THEN COALESCE(intake_data, '{}'::jsonb)
                           ELSE COALESCE(intake_data, '{}'::jsonb)
                                || jsonb_build_object('removed_pre_sizer_kg', p_removed_pre_sizer_kg,
                                                      'removed_pre_sizer_at', now())
                      END,
        updated_at  = NOW()
    WHERE id = p_kernel_id
      AND is_active = true;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id, 'removed_pre_sizer_kg', p_removed_pre_sizer_kg);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================================
-- 6. open_silo / close_silo with optional times
-- ============================================================================

DO $do$
BEGIN
    IF to_regprocedure('public.open_silo(integer)') IS NOT NULL THEN
        ALTER FUNCTION public.open_silo(integer) RENAME TO open_silo_pre_20261008;
    END IF;
    IF to_regprocedure('public.close_silo(integer, numeric)') IS NOT NULL THEN
        ALTER FUNCTION public.close_silo(integer, numeric) RENAME TO close_silo_pre_20261008;
    END IF;
END $do$;

CREATE OR REPLACE FUNCTION public.open_silo(p_silo_number integer, p_opened_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id  uuid;
    v_err text;
BEGIN
    v_err := public._silo_check_times(p_opened_at, NULL);
    IF v_err IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', v_err);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.silo_allocations WHERE silo_number = p_silo_number AND status = 'in_silo') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is empty. Allocate bags to it first.');
    END IF;
    INSERT INTO public.silo_runs (silo_number, opened_at, times_edited)
    VALUES (p_silo_number, COALESCE(p_opened_at, now()), p_opened_at IS NOT NULL)
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('success', true, 'run_id', v_id);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'This silo is already open.');
END;
$$;

CREATE OR REPLACE FUNCTION public.close_silo(
    p_silo_number integer,
    p_left_kg     numeric     DEFAULT 0,
    p_opened_at   timestamptz DEFAULT NULL,
    p_closed_at   timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_run    public.silo_runs%ROWTYPE;
    v_closed timestamptz := COALESCE(p_closed_at, now());
    v_err    text;
    v_res    jsonb;
BEGIN
    PERFORM 1 FROM public.silos WHERE silo_number = p_silo_number FOR UPDATE;

    SELECT * INTO v_run FROM public.silo_runs WHERE silo_number = p_silo_number AND closed_at IS NULL FOR UPDATE;
    IF v_run.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is not open.');
    END IF;

    v_err := public._silo_check_times(COALESCE(p_opened_at, v_run.opened_at), v_closed);
    IF v_err IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', v_err);
    END IF;

    IF p_opened_at IS NOT NULL THEN
        UPDATE public.silo_runs SET opened_at = p_opened_at, times_edited = true WHERE id = v_run.id;
    END IF;

    v_res := public._close_silo_run(v_run.id, p_left_kg, v_closed);

    IF COALESCE((v_res ->> 'success')::boolean, false) THEN
        IF p_closed_at IS NOT NULL THEN
            UPDATE public.silo_runs SET times_edited = true WHERE id = v_run.id;
        END IF;
    ELSIF p_opened_at IS NOT NULL THEN
        -- Nothing was closed: put the start time back.
        UPDATE public.silo_runs SET opened_at = v_run.opened_at, times_edited = v_run.times_edited WHERE id = v_run.id;
    END IF;
    RETURN v_res;
END;
$$;

-- ============================================================================
-- 7. Editing / logging runs after the fact
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_silo_run_times(p_run_id uuid, p_opened_at timestamptz, p_closed_at timestamptz)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_err text;
BEGIN
    IF p_opened_at IS NULL OR p_closed_at IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter both the start and the stop time.');
    END IF;
    v_err := public._silo_check_times(p_opened_at, p_closed_at);
    IF v_err IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', v_err);
    END IF;
    UPDATE public.silo_runs SET opened_at = p_opened_at, closed_at = p_closed_at, times_edited = true
    WHERE id = p_run_id AND closed_at IS NOT NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only a finished run can have its times edited.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- Log a cracking run after the fact (production sheet). The silo must not be open on the Silo Allocation screen.
CREATE OR REPLACE FUNCTION public.record_silo_run(
    p_silo_number integer,
    p_opened_at   timestamptz,
    p_closed_at   timestamptz,
    p_left_kg     numeric
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_err text;
    v_id  uuid;
    v_res jsonb;
BEGIN
    IF p_opened_at IS NULL OR p_closed_at IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter both the start and the stop time.');
    END IF;
    v_err := public._silo_check_times(p_opened_at, p_closed_at);
    IF v_err IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', v_err);
    END IF;

    PERFORM 1 FROM public.silos WHERE silo_number = p_silo_number AND is_active FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Silo not found');
    END IF;
    IF EXISTS (SELECT 1 FROM public.silo_runs WHERE silo_number = p_silo_number AND closed_at IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error',
            format('Silo %s is open on the Silo Allocation screen. Stop it there instead.', p_silo_number));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.silo_allocations WHERE silo_number = p_silo_number AND status = 'in_silo') THEN
        RETURN jsonb_build_object('success', false, 'error', 'This silo is empty. Allocate bags to it first.');
    END IF;

    INSERT INTO public.silo_runs (silo_number, opened_at, times_edited)
    VALUES (p_silo_number, p_opened_at, false) RETURNING id INTO v_id;

    v_res := public._close_silo_run(v_id, p_left_kg, p_closed_at);
    IF NOT COALESCE((v_res ->> 'success')::boolean, false) THEN
        DELETE FROM public.silo_runs WHERE id = v_id;   -- nothing was cracked
        RETURN v_res;
    END IF;
    RETURN v_res || jsonb_build_object('run_id', v_id);
END;
$$;

-- ============================================================================
-- 8. READS: get_silo_runs (+ times_edited), get_batch_cracking_runs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_silo_runs(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object('success', true, 'runs', COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id, 'silo_number', r.silo_number, 'opened_at', r.opened_at, 'closed_at', r.closed_at,
        'volume_kg', r.volume_kg, 'left_kg', r.left_kg, 'batch_numbers', r.batch_numbers,
        'times_edited', r.times_edited,
        'minutes', round(extract(epoch FROM (r.closed_at - r.opened_at)) / 60.0, 1),
        'kg_per_hour', CASE WHEN r.closed_at > r.opened_at
                            THEN round(r.volume_kg / (extract(epoch FROM (r.closed_at - r.opened_at)) / 3600.0), 2) END
    ) ORDER BY r.closed_at DESC), '[]'::jsonb))
    FROM (SELECT * FROM public.silo_runs WHERE closed_at IS NOT NULL
          ORDER BY closed_at DESC LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))) r;
$$;

-- Closed runs (South African calendar day of closing) that cracked bags of this batch.
CREATE OR REPLACE FUNCTION public.get_batch_cracking_runs(p_kernel_id uuid, p_date date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH q AS (
        SELECT r.id, r.silo_number, r.opened_at, r.closed_at, r.volume_kg, r.left_kg, r.times_edited,
               sum(rb.kg) AS batch_kg
        FROM public.silo_runs r
        JOIN public.silo_run_bags rb ON rb.run_id = r.id
        JOIN public.silo_allocations a ON a.id = rb.allocation_id AND a.kernel_id = p_kernel_id
        WHERE r.closed_at IS NOT NULL
          AND (r.closed_at AT TIME ZONE 'Africa/Johannesburg')::date = p_date
        GROUP BY r.id
    )
    SELECT jsonb_build_object(
        'success', true,
        'runs', COALESCE(jsonb_agg(jsonb_build_object(
            'run_id', q.id, 'silo_number', q.silo_number, 'opened_at', q.opened_at, 'closed_at', q.closed_at,
            'start_kg', COALESCE(q.volume_kg, 0) + COALESCE(q.left_kg, 0),
            'left_kg', COALESCE(q.left_kg, 0), 'volume_kg', COALESCE(q.volume_kg, 0),
            'batch_kg', q.batch_kg,
            'kg_per_hour', CASE WHEN q.closed_at > q.opened_at
                                THEN round(q.volume_kg / (extract(epoch FROM (q.closed_at - q.opened_at)) / 3600.0), 2) END,
            'times_edited', q.times_edited) ORDER BY q.opened_at), '[]'::jsonb),
        'total_batch_kg', COALESCE(sum(q.batch_kg), 0)
    )
    FROM q;
$$;

-- ============================================================================
-- 9. PERMISSIONS
-- ============================================================================

-- Roles that already hold open_silo.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id, 'function', fn, 'EXECUTE', true
FROM (SELECT DISTINCT role_id FROM public.role_permissions WHERE object_name = 'open_silo' AND allowed) rp
CROSS JOIN unnest(ARRAY[
    'allocate_bags_to_silo', 'unallocate_silo_bag', 'open_silo', 'close_silo',
    'get_silo_allocation_batches', 'get_silo_runs',
    'get_presizer_tally', 'update_silo_run_times', 'record_silo_run', 'get_batch_cracking_runs'
]) AS fn
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = rp.role_id AND x.object_name = fn AND x.operation = 'EXECUTE');

-- The production sheet saves through upsert_kernel_production (dataFunctions.upsertKernelProduction), so
-- its users need to read and log silo runs too.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id, 'function', fn, 'EXECUTE', true
FROM (SELECT DISTINCT role_id FROM public.role_permissions WHERE object_name = 'upsert_kernel_production' AND allowed) rp
CROSS JOIN unnest(ARRAY['get_batch_cracking_runs', 'record_silo_run']) AS fn
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = rp.role_id AND x.object_name = fn AND x.operation = 'EXECUTE');

-- ============================================================================
-- 10. SELF-CHECK
-- ============================================================================

DO $check$
DECLARE n integer; fn text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'silo_allocations' AND column_name = 'presizer_kg') THEN
        RAISE EXCEPTION 'silo_tweaks: silo_allocations.presizer_kg missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'silo_allocations' AND column_name = 'allocation_group') THEN
        RAISE EXCEPTION 'silo_tweaks: silo_allocations.allocation_group missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                   AND table_name = 'silo_runs' AND column_name = 'times_edited') THEN
        RAISE EXCEPTION 'silo_tweaks: silo_runs.times_edited missing';
    END IF;
    FOREACH fn IN ARRAY ARRAY['allocate_bags_to_silo', 'unallocate_silo_bag', 'open_silo', 'close_silo',
        'get_silo_allocation_batches', 'get_silo_runs', 'release_kernel_to_production',
        'get_presizer_tally', 'update_silo_run_times', 'record_silo_run', 'get_batch_cracking_runs',
        '_close_silo_run', '_silo_check_times', '_silo_sync_presizer']
    LOOP
        SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
        WHERE s.nspname = 'public' AND p.proname = fn;
        IF n <> 1 THEN
            RAISE EXCEPTION 'silo_tweaks: expected exactly one public.% but found %', fn, n;
        END IF;
    END LOOP;
    IF has_function_privilege('authenticated', 'public._close_silo_run(uuid, numeric, timestamptz)', 'EXECUTE') THEN
        RAISE EXCEPTION 'silo_tweaks: _close_silo_run must not be executable by authenticated';
    END IF;
END $check$;

NOTIFY pgrst, 'reload schema';
