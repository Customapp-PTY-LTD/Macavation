-- Silo Allocation: allow a silo to be filled past its capacity (Mike, 27 Oct 2026).
--
-- Staff sometimes put slightly more than the silo's rated capacity (4,000 kg) into it. The
-- allocate call used to refuse that; now it accepts it and the Silo Allocation screen shows the
-- silo as Full with its real percentage (e.g. 103%). Only the capacity refusal is removed - every
-- other check (bags exist, not already in a silo, one batch per silo, pre-sizer kg) is unchanged.
-- The silo row is still locked FOR UPDATE so two allocations to one silo stay serialised.

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

    -- No capacity refusal: a silo may go over 100% (see header).

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
