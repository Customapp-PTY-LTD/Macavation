-- Clarify "batch number already exists" for oil bin batches:
-- 1) Another bin still in production (delete via trash before reusing the name).
-- 2) An earlier run was completed (Send to stock) — row stays for traceability; use a new number.
-- 3) An active oil row still uses this batch_id (e.g. orphaned after manual DB edits).

CREATE OR REPLACE FUNCTION public.start_oil_bin_batch(
    p_batch_number varchar,
    p_start_date   date    DEFAULT NULL,
    p_stream       varchar DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
    v_id           uuid;
    v_date         date := COALESCE(p_start_date, CURRENT_DATE);
    v_bn           varchar;
    v_shift        uuid;
    v_stream       varchar;
    v_existing     RECORD;
BEGIN
    v_bn := trim(COALESCE(p_batch_number, ''));
    IF v_bn = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'batch_number is required');
    END IF;

    v_stream := lower(trim(COALESCE(p_stream, '')));
    IF v_stream = '' THEN
        v_stream := NULL;
    ELSIF v_stream NOT IN ('food_grade', 'cosmetic') THEN
        RETURN jsonb_build_object('success', false, 'error', 'oil_stream must be food_grade or cosmetic');
    END IF;

    SELECT obb.id, obb.status, obb.oil_id
    INTO v_existing
    FROM public.oil_bin_batch obb
    WHERE obb.batch_number = v_bn
    ORDER BY obb.created_at DESC NULLS LAST
    LIMIT 1;

    IF FOUND THEN
        IF COALESCE(v_existing.status, '') = 'in_production' AND v_existing.oil_id IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',
                'This batch number is already used by an oil bin batch that is still in production. On Oil Production, delete that bin batch first (trash icon — only available before Send to stock), then try again.'
            );
        END IF;
        RETURN jsonb_build_object(
            'success', false,
            'error',
            format(
                'This batch number was already used for an oil bin run (current status: %s). After Send to stock the record stays in the system for traceability, so the name cannot be reused here. Use a different batch number for a new run (for example add ''-2'' or a suffix).',
                COALESCE(v_existing.status, 'unknown')
            )
        );
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.oil o
        WHERE o.batch_id = v_bn
          AND o.is_active IS TRUE
    ) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error',
            'This batch number is already linked to an active oil batch (finished goods / stock). Choose a different batch number, or ask an admin if the old oil record should be deactivated.'
        );
    END IF;

    BEGIN
        INSERT INTO public.oil_bin_batch (batch_number, start_date, status, oil_stream)
        VALUES (v_bn, v_date, 'in_production', v_stream)
        RETURNING id INTO v_id;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN jsonb_build_object(
                'success', false,
                'error',
                'Batch number already exists: ' || v_bn || '. If another user just created it, refresh the page. Otherwise pick a different batch number.'
            );
    END;

    SELECT s.id
    INTO v_shift
    FROM public.shift s
    WHERE s.shift_date = v_date
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
    LIMIT 1;

    IF v_shift IS NOT NULL THEN
        UPDATE public.oil_bin_batch
        SET shift_id = v_shift,
            raw_ingredient_audit = public.get_oil_production_raw_ingredients_snapshot(),
            updated_at = NOW()
        WHERE id = v_id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_id,
        'batch_number', v_bn,
        'start_date', v_date,
        'oil_stream', v_stream,
        'shift_linked', v_shift IS NOT NULL
    );
END;
$func$;

COMMENT ON FUNCTION public.start_oil_bin_batch(varchar, date, varchar) IS
  'Start an oil bin batch with a manual batch number. Duplicate names are blocked while a row exists (including completed runs after Send to stock).';

NOTIFY pgrst, 'reload schema';
