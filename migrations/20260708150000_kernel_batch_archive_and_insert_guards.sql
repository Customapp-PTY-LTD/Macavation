-- Kernel batch archive on delete + active-only duplicate guards on insert.
-- Policy: archive is audit/history only; batch numbers may be reused after soft delete.
-- Only active kernel + active batch rows block duplicate human batch numbers.

-- ============================================================
-- 1. Archive table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.kernel_batch_archive (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_number varchar(100) NOT NULL,
    batch_uuid uuid NOT NULL,
    kernel_id uuid NOT NULL,
    status varchar(50) NULL,
    grower_name varchar(255) NULL,
    supplier_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL,
    received_date date NULL,
    deactivation_type varchar(20) NOT NULL,
    deactivated_at timestamptz NOT NULL DEFAULT now(),
    deactivated_by uuid NULL,
    snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT kernel_batch_archive_deactivation_type_check CHECK (
        deactivation_type IN ('soft_delete', 'permanent_delete')
    )
);

COMMENT ON TABLE public.kernel_batch_archive IS
    'Historical record of deleted kernel batches. Audit only; does not block batch number reuse.';
COMMENT ON COLUMN public.kernel_batch_archive.batch_number IS
    'Original human-readable batch id at time of deletion.';

CREATE INDEX IF NOT EXISTS idx_kernel_batch_archive_batch_number
    ON public.kernel_batch_archive(batch_number);
CREATE INDEX IF NOT EXISTS idx_kernel_batch_archive_deactivated_at
    ON public.kernel_batch_archive(deactivated_at DESC);

GRANT SELECT ON TABLE public.kernel_batch_archive TO authenticated;
GRANT SELECT ON TABLE public.kernel_batch_archive TO service_role;

-- ============================================================
-- 2. Helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.kernel_batch_number_in_use_active(p_batch_number varchar)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.batches b
        JOIN public.kernel k ON k.batch_id = b.id
        WHERE b.batch_type = 'kernel'
          AND b.is_active = true
          AND k.is_active = true
          AND b.batch_id = NULLIF(trim(COALESCE(p_batch_number, '')), '')
    );
$$;

COMMENT ON FUNCTION public.kernel_batch_number_in_use_active(varchar) IS
    'True when an active kernel batch already uses this human batch number.';

CREATE OR REPLACE FUNCTION public._archive_kernel_batch(
    p_kernel_id uuid,
    p_deactivation_type varchar
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row RECORD;
BEGIN
    SELECT
        k.id AS kernel_id,
        k.batch_id AS batch_uuid,
        b.batch_id AS batch_number,
        k.status,
        k.grower_name,
        k.supplier_id,
        k.received_date,
        k.wet_nis_received_kg,
        k.actual_wet_nis_kg,
        k.production_finished_at,
        k.packing_data,
        k.job_card_data,
        k.qa_data,
        k.intake_data,
        k.cracking_data,
        k.washing_data,
        k.sorting_data,
        k.dispatch_data,
        k.jobcard_approved,
        k.created_at,
        k.updated_at
    INTO v_row
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id
      AND b.batch_type = 'kernel';

    IF v_row.kernel_id IS NULL THEN
        RETURN;
    END IF;

    INSERT INTO public.kernel_batch_archive (
        batch_number,
        batch_uuid,
        kernel_id,
        status,
        grower_name,
        supplier_id,
        received_date,
        deactivation_type,
        snapshot
    )
    VALUES (
        v_row.batch_number,
        v_row.batch_uuid,
        v_row.kernel_id,
        v_row.status,
        v_row.grower_name,
        v_row.supplier_id,
        v_row.received_date,
        p_deactivation_type,
        jsonb_build_object(
            'wet_nis_received_kg', v_row.wet_nis_received_kg,
            'actual_wet_nis_kg', v_row.actual_wet_nis_kg,
            'production_finished_at', v_row.production_finished_at,
            'jobcard_approved', v_row.jobcard_approved,
            'packing_data', v_row.packing_data,
            'job_card_data', v_row.job_card_data,
            'qa_data', v_row.qa_data,
            'intake_data', v_row.intake_data,
            'cracking_data', v_row.cracking_data,
            'washing_data', v_row.washing_data,
            'sorting_data', v_row.sorting_data,
            'dispatch_data', v_row.dispatch_data,
            'kernel_created_at', v_row.created_at,
            'kernel_updated_at', v_row.updated_at
        )
    );
END;
$$;

-- ============================================================
-- 3. Backfill existing inactive kernels (best effort)
-- ============================================================
INSERT INTO public.kernel_batch_archive (
    batch_number,
    batch_uuid,
    kernel_id,
    status,
    grower_name,
    supplier_id,
    received_date,
    deactivation_type,
    deactivated_at,
    snapshot
)
SELECT
    b.batch_id,
    b.id,
    k.id,
    k.status,
    k.grower_name,
    k.supplier_id,
    k.received_date,
    'soft_delete',
    COALESCE(k.updated_at, now()),
    jsonb_build_object(
        'note', 'Backfilled from pre-archive inactive batch; original human number lost if batch_id is _inactive_*',
        'stored_batch_id', b.batch_id,
        'wet_nis_received_kg', k.wet_nis_received_kg,
        'packing_data', k.packing_data,
        'job_card_data', k.job_card_data,
        'qa_data', k.qa_data,
        'production_finished_at', k.production_finished_at
    )
FROM public.kernel k
JOIN public.batches b ON b.id = k.batch_id
WHERE NOT k.is_active
  AND b.batch_type = 'kernel'
  AND NOT EXISTS (
      SELECT 1 FROM public.kernel_batch_archive a WHERE a.kernel_id = k.id
  );

-- ============================================================
-- 4. Delete functions — write archive first
-- ============================================================
CREATE OR REPLACE FUNCTION public.deactivate_kernel_batch(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_uuid uuid;
BEGIN
    SELECT k.batch_id INTO v_batch_uuid
    FROM public.kernel k
    WHERE k.id = p_kernel_id;

    IF v_batch_uuid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    PERFORM public._archive_kernel_batch(p_kernel_id, 'soft_delete');

    UPDATE public.batches b
    SET
        is_active = false,
        batch_id = CASE
            WHEN b.batch_id LIKE '\_inactive\_%' ESCAPE '\' THEN b.batch_id
            ELSE '_inactive_' || replace(b.id::text, '-', '')
        END,
        updated_at = NOW()
    WHERE b.id = v_batch_uuid
      AND b.batch_type = 'kernel';

    UPDATE public.kernel
    SET is_active = false,
        updated_at = NOW()
    WHERE id = p_kernel_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.deactivate_kernel_batch(uuid) IS
    'Soft delete: archives batch, sets kernel.is_active false, retires batches row with _inactive_<uuid> batch_id so the human number can be reused.';

CREATE OR REPLACE FUNCTION public.delete_kernel_batch_permanent(p_kernel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_id uuid;
    v_bn       text;
    r          RECORD;
    v_new_lines jsonb;
    v_deleted  integer;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel id is required');
    END IF;

    SELECT k.batch_id, b.batch_id
    INTO v_batch_id, v_bn
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.id = p_kernel_id;

    IF v_batch_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.batches WHERE id = v_batch_id AND batch_type = 'kernel') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not a kernel batch');
    END IF;

    PERFORM public._archive_kernel_batch(p_kernel_id, 'permanent_delete');

    UPDATE public.silo
    SET kernel_id = NULL,
        status = CASE WHEN oil_batch_id IS NULL THEN 'empty' ELSE status END,
        updated_at = NOW()
    WHERE kernel_id = p_kernel_id;

    FOR r IN
        SELECT o.id, o.lines
        FROM public.kernel_dispatch_orders o
        WHERE EXISTS (
            SELECT 1
            FROM jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) AS e
            WHERE NULLIF(trim(e ->> 'kernel_id'), '') = p_kernel_id::text
        )
    LOOP
        SELECT COALESCE(
            (SELECT jsonb_agg(e)
             FROM jsonb_array_elements(COALESCE(r.lines, '[]'::jsonb)) AS e
             WHERE NULLIF(trim(e ->> 'kernel_id'), '') IS NULL
                OR NULLIF(trim(e ->> 'kernel_id'), '') <> p_kernel_id::text),
            '[]'::jsonb
        )
        INTO v_new_lines;

        IF v_new_lines IS NULL
           OR v_new_lines = '[]'::jsonb
           OR jsonb_array_length(v_new_lines) = 0
        THEN
            DELETE FROM public.kernel_dispatch_orders WHERE id = r.id;
        ELSE
            UPDATE public.kernel_dispatch_orders
            SET lines = v_new_lines, updated_at = NOW()
            WHERE id = r.id;
        END IF;
    END LOOP;

    DELETE FROM public.batches
    WHERE id = v_batch_id AND batch_type = 'kernel';

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch could not be deleted');
    END IF;

    RETURN jsonb_build_object('success', true, 'batch_number', v_bn);
END;
$$;

COMMENT ON FUNCTION public.delete_kernel_batch_permanent(uuid) IS
    'Hard delete: archives batch, removes kernel batch header (batches + kernel CASCADE), clears silos, strips dispatch lines. Irreversible.';

-- ============================================================
-- 5. Insert guards — active-only duplicate checks
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_batch(
    p_batch_id   varchar DEFAULT NULL,
    p_batch_type varchar DEFAULT 'oil',
    p_is_active  boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_uuid   uuid;
    v_batch_id_out varchar;
    v_today        date := CURRENT_DATE;
    v_type         varchar;
BEGIN
    v_type := COALESCE(NULLIF(trim(p_batch_type), ''), 'oil');

    IF p_batch_id IS NOT NULL THEN
        IF v_type = 'kernel' THEN
            SELECT b.id INTO v_batch_uuid
            FROM public.batches b
            JOIN public.kernel k ON k.batch_id = b.id
            WHERE b.batch_id = p_batch_id
              AND b.batch_type = 'kernel'
              AND b.is_active = true
              AND k.is_active = true;

            IF v_batch_uuid IS NOT NULL THEN
                UPDATE public.batches
                SET is_active  = p_is_active,
                    updated_at = NOW()
                WHERE id = v_batch_uuid;
                RETURN jsonb_build_object('success', true, 'id', v_batch_uuid, 'batch_id', p_batch_id);
            END IF;

            IF public.kernel_batch_number_in_use_active(p_batch_id) THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'That batch number is already in use by an active batch'
                );
            END IF;
        ELSE
            SELECT id INTO v_batch_uuid
            FROM public.batches
            WHERE batch_id = p_batch_id;

            IF v_batch_uuid IS NOT NULL THEN
                UPDATE public.batches
                SET is_active  = p_is_active,
                    updated_at = NOW()
                WHERE id = v_batch_uuid;
                RETURN jsonb_build_object('success', true, 'id', v_batch_uuid, 'batch_id', p_batch_id);
            END IF;
        END IF;

        v_batch_id_out := p_batch_id;
    END IF;

    IF v_batch_id_out IS NULL THEN
        v_batch_id_out :=
            upper(v_type) || '-' ||
            to_char(v_today, 'YYYY-MM') || '-' ||
            lpad(
                (1 + COALESCE(
                    (SELECT COUNT(*) FROM public.batches
                     WHERE batch_id LIKE upper(v_type) || '-' || to_char(v_today, 'YYYY-MM') || '-%'
                       AND is_active = true),
                    0
                ))::text,
                3, '0'
            );
    END IF;

    IF v_type = 'kernel' AND public.kernel_batch_number_in_use_active(v_batch_id_out) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'That batch number is already in use by an active batch'
        );
    END IF;

    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (v_batch_id_out, v_type, p_is_active)
    RETURNING id INTO v_batch_uuid;

    RETURN jsonb_build_object('success', true, 'id', v_batch_uuid, 'batch_id', v_batch_id_out);

EXCEPTION
    WHEN unique_violation THEN
        IF v_type = 'kernel' THEN
            RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists');
        END IF;
        SELECT id INTO v_batch_uuid FROM public.batches WHERE batch_id = v_batch_id_out;
        RETURN jsonb_build_object('success', true, 'id', v_batch_uuid, 'batch_id', v_batch_id_out);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_kernel_batch(
    p_batch_number          varchar DEFAULT NULL,
    p_received_date         date DEFAULT NULL,
    p_wet_nis_received_kg   numeric  DEFAULT NULL,
    p_supplier_id           uuid     DEFAULT NULL,
    p_grower_name           varchar  DEFAULT NULL,
    p_initial_status        varchar  DEFAULT 'production'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_number varchar;
    v_batch_id     uuid;
    v_kernel_id    uuid;
    v_year         int;
    v_status       varchar;
BEGIN
    v_status := COALESCE(NULLIF(trim(p_initial_status), ''), 'production');
    IF v_status NOT IN ('intake', 'receiving', 'production', 'qa', 'complete') THEN
        v_status := 'production';
    END IF;

    v_batch_number := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF v_batch_number IS NULL THEN
        v_year := EXTRACT(YEAR FROM COALESCE(p_received_date, CURRENT_DATE))::int;
        v_batch_number := public.get_next_batch_number(p_supplier_id, v_year);
    END IF;

    IF public.kernel_batch_number_in_use_active(v_batch_number) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'That batch number is already in use by an active batch'
        );
    END IF;

    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (v_batch_number, 'kernel', true)
    RETURNING id INTO v_batch_id;

    INSERT INTO public.kernel (
        batch_id, supplier_id, grower_name, status,
        received_date, wet_nis_received_kg, is_active
    )
    VALUES (
        v_batch_id, p_supplier_id, p_grower_name, v_status,
        p_received_date, p_wet_nis_received_kg, true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_kernel_id,
        'batch_id', v_batch_id,
        'batch_number', v_batch_number
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists');
END;
$$;

CREATE OR REPLACE FUNCTION public.import_historical_kernel_batch(
    p_batch_number character varying,
    p_grower_name character varying DEFAULT NULL,
    p_supplier_id uuid DEFAULT NULL,
    p_received_date date DEFAULT NULL,
    p_production_finished_at timestamptz DEFAULT NULL,
    p_wet_nis_received_kg numeric DEFAULT NULL,
    p_sk_sp_qty numeric DEFAULT 0,
    p_sk_0_qty numeric DEFAULT 0,
    p_sk_1_qty numeric DEFAULT 0,
    p_sk_1s_qty numeric DEFAULT 0,
    p_sk_4l_qty numeric DEFAULT 0,
    p_sk_5_qty numeric DEFAULT 0,
    p_sk_6_qty numeric DEFAULT 0,
    p_bt_78_qty numeric DEFAULT 0,
    p_bt_high_qty numeric DEFAULT 0,
    p_bt_low_qty numeric DEFAULT 0,
    p_best_before_date date DEFAULT NULL,
    p_ffa numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
    v_batch_id  uuid;
    v_kernel_id uuid;
    v_packing   jsonb;
    v_job_card  jsonb;
    v_qa        jsonb;
    v_fin       timestamptz;
BEGIN
    p_batch_number := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF p_batch_number IS NULL OR p_batch_number = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    IF public.kernel_batch_number_in_use_active(p_batch_number) THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'That batch number is already in use by an active batch'
        );
    END IF;

    v_fin := COALESCE(
        p_production_finished_at,
        (p_received_date::timestamp AT TIME ZONE 'UTC') + time '12:00:00',
        NOW()
    );

    v_packing := jsonb_build_array(
        jsonb_build_object(
            'date', COALESCE(p_received_date::text, to_char(current_date, 'YYYY-MM-DD')),
            'sk_sp_qty',   COALESCE(p_sk_sp_qty, 0),
            'sk_0_qty',    COALESCE(p_sk_0_qty, 0),
            'sk_1_qty',    COALESCE(p_sk_1_qty, 0),
            'sk_1s_qty',   COALESCE(p_sk_1s_qty, 0),
            'sk_4l_qty',   COALESCE(p_sk_4l_qty, 0),
            'sk_5_qty',    COALESCE(p_sk_5_qty, 0),
            'sk_6_qty',    COALESCE(p_sk_6_qty, 0),
            'bt_78_qty',   COALESCE(p_bt_78_qty, 0),
            'bt_high_qty', COALESCE(p_bt_high_qty, 0),
            'bt_low_qty',  COALESCE(p_bt_low_qty, 0)
        )
    );

    v_job_card := CASE WHEN p_best_before_date IS NOT NULL
        THEN jsonb_build_object('best_before_date', p_best_before_date::text)
        ELSE '{}'::jsonb END;

    v_qa := CASE WHEN p_ffa IS NOT NULL
        THEN jsonb_build_object('ffa_result', p_ffa::text)
        ELSE '{}'::jsonb END;

    INSERT INTO public.batches (batch_id, batch_type, is_active)
    VALUES (p_batch_number, 'kernel', true)
    RETURNING id INTO v_batch_id;

    INSERT INTO public.kernel (
        batch_id, supplier_id, grower_name, status,
        received_date, wet_nis_received_kg, production_finished_at,
        packing_data, job_card_data, qa_data, is_active
    )
    VALUES (
        v_batch_id, p_supplier_id, p_grower_name, 'complete',
        p_received_date, p_wet_nis_received_kg, v_fin,
        v_packing, v_job_card, v_qa, true
    )
    RETURNING id INTO v_kernel_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_kernel_id,
        'batch_id', v_batch_id,
        'batch_number', p_batch_number
    );
EXCEPTION
    WHEN unique_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number already exists: ' || p_batch_number);
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_kernel_stock_batch_info(
    p_kernel_id uuid,
    p_batch_number varchar,
    p_grower_name varchar DEFAULT NULL,
    p_received_date date DEFAULT NULL,
    p_wet_nis_received_kg numeric DEFAULT NULL,
    p_best_before_date date DEFAULT NULL,
    p_ffa numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch_uuid uuid;
    v_new_bn text;
BEGIN
    IF p_kernel_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch is required');
    END IF;

    SELECT k.batch_id INTO v_batch_uuid
    FROM public.kernel k
    WHERE k.id = p_kernel_id AND k.is_active = true;

    IF v_batch_uuid IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    v_new_bn := NULLIF(trim(COALESCE(p_batch_number, '')), '');
    IF v_new_bn IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Batch number is required');
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.batches b
        JOIN public.kernel k ON k.batch_id = b.id
        WHERE b.batch_id = v_new_bn
          AND b.id <> v_batch_uuid
          AND b.batch_type = 'kernel'
          AND b.is_active = true
          AND k.is_active = true
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'That batch number is already in use');
    END IF;

    UPDATE public.batches
    SET batch_id = v_new_bn,
        updated_at = now()
    WHERE id = v_batch_uuid;

    UPDATE public.kernel k
    SET
        grower_name = NULLIF(trim(COALESCE(p_grower_name, '')), ''),
        received_date = p_received_date,
        wet_nis_received_kg = p_wet_nis_received_kg,
        job_card_data = CASE
            WHEN p_best_before_date IS NOT NULL THEN
                COALESCE(k.job_card_data, '{}'::jsonb) || jsonb_build_object('best_before_date', p_best_before_date::text)
            ELSE k.job_card_data
        END,
        qa_data = CASE
            WHEN p_ffa IS NOT NULL THEN
                COALESCE(k.qa_data, '{}'::jsonb) || jsonb_build_object('ffa_result', p_ffa::numeric)
            ELSE k.qa_data
        END,
        updated_at = now()
    WHERE k.id = p_kernel_id AND k.is_active = true;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kernel batch not found or inactive');
    END IF;

    RETURN jsonb_build_object('success', true, 'kernel_id', p_kernel_id);
END;
$$;

-- ============================================================
-- 6. Read path — active batch header + archive listing
-- ============================================================
DROP FUNCTION IF EXISTS public.get_kernel_batches(varchar, varchar, integer, integer);

CREATE OR REPLACE FUNCTION public.get_kernel_batches(
    p_status varchar DEFAULT NULL,
    p_search varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_id uuid,
    batch_number varchar,
    grower_name varchar,
    supplier_id uuid,
    status varchar,
    received_date date,
    wet_nis_received_kg numeric,
    actual_wet_nis_kg numeric,
    weight_difference_kg numeric,
    production_finished_at timestamptz,
    is_active boolean,
    has_receiving_checklist boolean,
    has_ziplock_sample boolean,
    has_5kg_sample boolean,
    has_job_card boolean,
    has_jobcard_approved boolean,
    has_qa boolean,
    has_dispatch boolean,
    production_day_count integer,
    yield_by_style jsonb,
    remaining_by_style jsonb,
    yield_by_style_cartons jsonb,
    remaining_by_style_cartons jsonb,
    ffa numeric,
    best_before_date date,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        k.id, k.batch_id, b.batch_id AS batch_number, k.grower_name, k.supplier_id, k.status::varchar,
        k.received_date, k.wet_nis_received_kg, k.actual_wet_nis_kg,
        CASE WHEN k.wet_nis_received_kg IS NOT NULL AND k.actual_wet_nis_kg IS NOT NULL THEN k.wet_nis_received_kg - k.actual_wet_nis_kg ELSE NULL END,
        k.production_finished_at, k.is_active,
        (k.intake_data -> 'receiving_checklist' IS NOT NULL AND k.intake_data -> 'receiving_checklist' != '{}'::jsonb AND k.intake_data -> 'receiving_checklist' != 'null'::jsonb) AS has_receiving_checklist,
        (k.intake_data #>> '{ziplock_sample,completed_at}' IS NOT NULL) AS has_ziplock_sample,
        (k.intake_data #>> '{five_kg_sample,completed_at}' IS NOT NULL) AS has_5kg_sample,
        (k.job_card_data IS NOT NULL AND k.job_card_data != '{}'::jsonb AND k.job_card_data != 'null'::jsonb) AS has_job_card,
        COALESCE(k.jobcard_approved, false) AS has_jobcard_approved,
        (k.qa_data IS NOT NULL AND k.qa_data != '{}'::jsonb AND k.qa_data != 'null'::jsonb) AS has_qa,
        EXISTS (SELECT 1 FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id) AS has_dispatch,
        GREATEST(jsonb_array_length(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.washing_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.sorting_data, 'null'::jsonb), '[]'::jsonb)), jsonb_array_length(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)))::integer AS production_day_count,

        CASE WHEN COALESCE(k.jobcard_approved, false) AND public.kernel_job_card_has_stock_quantities(k.job_card_data)
            THEN public.kernel_yield_kg_from_job_card(k.job_card_data)
            ELSE (
                SELECT jsonb_build_object('SP', COALESCE(SUM(NULLIF(e ->> 'sk_sp_qty', '')::numeric), 0), '0', COALESCE(SUM(NULLIF(e ->> 'sk_0_qty', '')::numeric), 0), '1', COALESCE(SUM(NULLIF(e ->> 'sk_1_qty', '')::numeric), 0), '1S', COALESCE(SUM(NULLIF(e ->> 'sk_1s_qty', '')::numeric), 0), '4L', COALESCE(SUM(NULLIF(e ->> 'sk_4l_qty', '')::numeric), 0), '5', COALESCE(SUM(NULLIF(e ->> 'sk_5_qty', '')::numeric), 0), '6', COALESCE(SUM(NULLIF(e ->> 'sk_6_qty', '')::numeric), 0), '7/8', COALESCE(SUM(NULLIF(e ->> 'bt_78_qty', '')::numeric), 0), 'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_qty','')::numeric), 0), 'Butter Low Oil', COALESCE(SUM(NULLIF(e ->> 'bt_low_qty', '')::numeric), 0))
                FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) e
            )
        END AS yield_by_style,

        CASE WHEN COALESCE(k.jobcard_approved, false) AND public.kernel_job_card_has_stock_quantities(k.job_card_data)
            THEN (
                SELECT jsonb_build_object(
                    'SP', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'SP')::numeric, 0) - COALESCE(d.sp, 0)),
                    '0', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '0')::numeric, 0) - COALESCE(d.s0, 0)),
                    '1', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '1')::numeric, 0) - COALESCE(d.s1, 0)),
                    '1S', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '1S')::numeric, 0) - COALESCE(d.s1s, 0)),
                    '4L', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '4L')::numeric, 0) - COALESCE(d.s4l, 0)),
                    '5', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '5')::numeric, 0) - COALESCE(d.s5, 0)),
                    '6', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '6')::numeric, 0) - COALESCE(d.s6, 0)),
                    '7/8', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> '7/8')::numeric, 0) - COALESCE(d.s78, 0)),
                    'Butter High Oil', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'Butter High Oil')::numeric, 0) - COALESCE(d.bh, 0)),
                    'Butter Low Oil', GREATEST(0, COALESCE((public.kernel_yield_kg_from_job_card(k.job_card_data) ->> 'Butter Low Oil')::numeric, 0) - COALESCE(d.bl, 0))
                )
                FROM (
                    SELECT
                        COALESCE(SUM(CASE WHEN le ->> 'style' = 'SP' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS sp,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '0' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s0,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '1' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s1,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '1S' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s1s,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '4L' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s4l,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '5' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s5,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '6' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s6,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = '7/8' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS s78,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter High Oil' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS bh,
                        COALESCE(SUM(CASE WHEN le ->> 'style' = 'Butter Low Oil' THEN NULLIF(le ->> 'quantity_kg', '')::numeric ELSE 0 END), 0) AS bl
                    FROM kernel_dispatch_orders o
                    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines, '[]'::jsonb)) le
                    WHERE NULLIF(le ->> 'kernel_id', '')::uuid = k.id
                ) d
            )
            ELSE (
                SELECT jsonb_build_object('SP', GREATEST(0, COALESCE(y.sp,0)-COALESCE(d.sp,0)), '0', GREATEST(0, COALESCE(y.s0,0)-COALESCE(d.s0,0)), '1', GREATEST(0, COALESCE(y.s1,0)-COALESCE(d.s1,0)), '1S', GREATEST(0, COALESCE(y.s1s,0)-COALESCE(d.s1s,0)), '4L', GREATEST(0, COALESCE(y.s4l,0)-COALESCE(d.s4l,0)), '5', GREATEST(0, COALESCE(y.s5,0)-COALESCE(d.s5,0)), '6', GREATEST(0, COALESCE(y.s6,0)-COALESCE(d.s6,0)), '7/8', GREATEST(0, COALESCE(y.s78,0)-COALESCE(d.s78,0)), 'Butter High Oil', GREATEST(0, COALESCE(y.bh,0)-COALESCE(d.bh,0)), 'Butter Low Oil', GREATEST(0, COALESCE(y.bl,0)-COALESCE(d.bl,0)))
                FROM (SELECT COALESCE(SUM(NULLIF(e->>'sk_sp_qty','')::numeric),0) AS sp, COALESCE(SUM(NULLIF(e->>'sk_0_qty','')::numeric),0) AS s0, COALESCE(SUM(NULLIF(e->>'sk_1_qty','')::numeric),0) AS s1, COALESCE(SUM(NULLIF(e->>'sk_1s_qty','')::numeric),0) AS s1s, COALESCE(SUM(NULLIF(e->>'sk_4l_qty','')::numeric),0) AS s4l, COALESCE(SUM(NULLIF(e->>'sk_5_qty','')::numeric),0) AS s5, COALESCE(SUM(NULLIF(e->>'sk_6_qty','')::numeric),0) AS s6, COALESCE(SUM(NULLIF(e->>'bt_78_qty','')::numeric),0) AS s78, COALESCE(SUM(NULLIF(e->>'bt_high_qty','')::numeric),0) AS bh, COALESCE(SUM(NULLIF(e->>'bt_low_qty','')::numeric),0) AS bl FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data,'null'::jsonb),'[]'::jsonb)) e) y
                CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS sp, COALESCE(SUM(CASE WHEN le->>'style'='0' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s0, COALESCE(SUM(CASE WHEN le->>'style'='1' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s1, COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s1s, COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s4l, COALESCE(SUM(CASE WHEN le->>'style'='5' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s5, COALESCE(SUM(CASE WHEN le->>'style'='6' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s6, COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS s78, COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS bh, COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN NULLIF(le->>'quantity_kg','')::numeric ELSE 0 END),0) AS bl FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE NULLIF(le->>'kernel_id','')::uuid = k.id) d
            )
        END AS remaining_by_style,

        CASE WHEN COALESCE(k.jobcard_approved, false) AND public.kernel_job_card_has_stock_quantities(k.job_card_data)
            THEN public.kernel_yield_cartons_from_job_card(k.job_card_data)
            ELSE (
                SELECT jsonb_build_object('SP', COALESCE(SUM(NULLIF(e ->> 'sk_sp_cartons', '')::numeric), 0), '0', COALESCE(SUM(NULLIF(e ->> 'sk_0_cartons', '')::numeric), 0), '1', COALESCE(SUM(NULLIF(e ->> 'sk_1_cartons', '')::numeric), 0), '1S', COALESCE(SUM(NULLIF(e ->> 'sk_1s_cartons', '')::numeric), 0), '4L', COALESCE(SUM(NULLIF(e ->> 'sk_4l_cartons', '')::numeric), 0), '5', COALESCE(SUM(NULLIF(e ->> 'sk_5_cartons', '')::numeric), 0), '6', COALESCE(SUM(NULLIF(e ->> 'sk_6_cartons', '')::numeric), 0), '7/8', COALESCE(SUM(NULLIF(e ->> 'bt_78_cartons', '')::numeric), 0), 'Butter High Oil', COALESCE(SUM(NULLIF(e ->> 'bt_high_cartons','')::numeric), 0), 'Butter Low Oil', COALESCE(SUM(NULLIF(e ->> 'bt_low_cartons', '')::numeric), 0))
                FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) e
            )
        END AS yield_by_style_cartons,

        CASE WHEN COALESCE(k.jobcard_approved, false) AND public.kernel_job_card_has_stock_quantities(k.job_card_data)
            THEN (
                SELECT jsonb_build_object(
                    'SP', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'SP')::numeric, 0) - COALESCE(dc.sp, 0)),
                    '0', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '0')::numeric, 0) - COALESCE(dc.s0, 0)),
                    '1', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '1')::numeric, 0) - COALESCE(dc.s1, 0)),
                    '1S', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '1S')::numeric, 0) - COALESCE(dc.s1s, 0)),
                    '4L', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '4L')::numeric, 0) - COALESCE(dc.s4l, 0)),
                    '5', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '5')::numeric, 0) - COALESCE(dc.s5, 0)),
                    '6', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '6')::numeric, 0) - COALESCE(dc.s6, 0)),
                    '7/8', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> '7/8')::numeric, 0) - COALESCE(dc.s78, 0)),
                    'Butter High Oil', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'Butter High Oil')::numeric, 0) - COALESCE(dc.bh, 0)),
                    'Butter Low Oil', GREATEST(0, COALESCE((public.kernel_yield_cartons_from_job_card(k.job_card_data) ->> 'Butter Low Oil')::numeric, 0) - COALESCE(dc.bl, 0))
                )
                FROM (
                    SELECT
                        COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS sp,
                        COALESCE(SUM(CASE WHEN le->>'style'='0' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s0,
                        COALESCE(SUM(CASE WHEN le->>'style'='1' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1,
                        COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1s,
                        COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s4l,
                        COALESCE(SUM(CASE WHEN le->>'style'='5' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s5,
                        COALESCE(SUM(CASE WHEN le->>'style'='6' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s6,
                        COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s78,
                        COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bh,
                        COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bl
                    FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE NULLIF(le->>'kernel_id','')::uuid = k.id
                ) dc
            )
            ELSE (
                SELECT jsonb_build_object('SP', GREATEST(0, COALESCE(yc.sp,0)-COALESCE(dc.sp,0)), '0', GREATEST(0, COALESCE(yc.s0,0)-COALESCE(dc.s0,0)), '1', GREATEST(0, COALESCE(yc.s1,0)-COALESCE(dc.s1,0)), '1S', GREATEST(0, COALESCE(yc.s1s,0)-COALESCE(dc.s1s,0)), '4L', GREATEST(0, COALESCE(yc.s4l,0)-COALESCE(dc.s4l,0)), '5', GREATEST(0, COALESCE(yc.s5,0)-COALESCE(dc.s5,0)), '6', GREATEST(0, COALESCE(yc.s6,0)-COALESCE(dc.s6,0)), '7/8', GREATEST(0, COALESCE(yc.s78,0)-COALESCE(dc.s78,0)), 'Butter High Oil', GREATEST(0, COALESCE(yc.bh,0)-COALESCE(dc.bh,0)), 'Butter Low Oil', GREATEST(0, COALESCE(yc.bl,0)-COALESCE(dc.bl,0)))
                FROM (SELECT COALESCE(SUM(NULLIF(e->>'sk_sp_cartons','')::numeric),0) AS sp, COALESCE(SUM(NULLIF(e->>'sk_0_cartons','')::numeric),0) AS s0, COALESCE(SUM(NULLIF(e->>'sk_1_cartons','')::numeric),0) AS s1, COALESCE(SUM(NULLIF(e->>'sk_1s_cartons','')::numeric),0) AS s1s, COALESCE(SUM(NULLIF(e->>'sk_4l_cartons','')::numeric),0) AS s4l, COALESCE(SUM(NULLIF(e->>'sk_5_cartons','')::numeric),0) AS s5, COALESCE(SUM(NULLIF(e->>'sk_6_cartons','')::numeric),0) AS s6, COALESCE(SUM(NULLIF(e->>'bt_78_cartons','')::numeric),0) AS s78, COALESCE(SUM(NULLIF(e->>'bt_high_cartons','')::numeric),0) AS bh, COALESCE(SUM(NULLIF(e->>'bt_low_cartons','')::numeric),0) AS bl FROM jsonb_array_elements(COALESCE(NULLIF(k.packing_data,'null'::jsonb),'[]'::jsonb)) e) yc
                CROSS JOIN LATERAL (SELECT COALESCE(SUM(CASE WHEN le->>'style'='SP' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS sp, COALESCE(SUM(CASE WHEN le->>'style'='0' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s0, COALESCE(SUM(CASE WHEN le->>'style'='1' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1, COALESCE(SUM(CASE WHEN le->>'style'='1S' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s1s, COALESCE(SUM(CASE WHEN le->>'style'='4L' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s4l, COALESCE(SUM(CASE WHEN le->>'style'='5' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s5, COALESCE(SUM(CASE WHEN le->>'style'='6' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s6, COALESCE(SUM(CASE WHEN le->>'style'='7/8' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS s78, COALESCE(SUM(CASE WHEN le->>'style'='Butter High Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bh, COALESCE(SUM(CASE WHEN le->>'style'='Butter Low Oil' THEN COALESCE(NULLIF(le->>'cartons','')::numeric,(NULLIF(le->>'quantity_kg','')::numeric)/11.34) ELSE 0 END),0) AS bl FROM kernel_dispatch_orders o CROSS JOIN LATERAL jsonb_array_elements(COALESCE(o.lines,'[]'::jsonb)) le WHERE NULLIF(le->>'kernel_id','')::uuid = k.id) dc
            )
        END AS remaining_by_style_cartons,

        COALESCE((NULLIF(k.qa_data->>'ffa_result', ''))::numeric, (NULLIF(k.qa_data->>'ffa', ''))::numeric) AS ffa,
        COALESCE((NULLIF(k.job_card_data->>'best_before_date', ''))::date, ((NULLIF(k.job_card_data->>'packing_completion_date', ''))::date + interval '18 months')::date) AS best_before_date,
        k.created_at, k.updated_at
    FROM public.kernel k
    JOIN public.batches b ON b.id = k.batch_id
    WHERE k.is_active = true
      AND b.is_active = true
      AND (p_status IS NULL OR k.status = p_status OR k.status = ANY(string_to_array(p_status, ',')))
      AND (p_search IS NULL OR b.batch_id ILIKE '%' || p_search || '%' OR k.grower_name ILIKE '%' || p_search || '%')
    ORDER BY k.received_date DESC NULLS LAST, b.batch_id DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_kernel_batch_archive(
    p_search varchar DEFAULT NULL,
    p_limit integer DEFAULT 100,
    p_offset integer DEFAULT 0
)
RETURNS TABLE (
    id uuid,
    batch_number varchar,
    batch_uuid uuid,
    kernel_id uuid,
    status varchar,
    grower_name varchar,
    supplier_id uuid,
    received_date date,
    deactivation_type varchar,
    deactivated_at timestamptz,
    snapshot jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        a.id,
        a.batch_number,
        a.batch_uuid,
        a.kernel_id,
        a.status,
        a.grower_name,
        a.supplier_id,
        a.received_date,
        a.deactivation_type,
        a.deactivated_at,
        a.snapshot
    FROM public.kernel_batch_archive a
    WHERE p_search IS NULL
       OR a.batch_number ILIKE '%' || p_search || '%'
       OR a.grower_name ILIKE '%' || p_search || '%'
    ORDER BY a.deactivated_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$$;

COMMENT ON FUNCTION public.get_kernel_batch_archive(varchar, integer, integer) IS
    'List archived (deleted) kernel batches newest first. Audit/support use.';

-- ============================================================
-- 7. RBAC
-- ============================================================
GRANT EXECUTE ON FUNCTION public.kernel_batch_number_in_use_active(varchar) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_batch_archive(varchar, integer, integer) TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'get_kernel_batch_archive',
        'kernel_batch_number_in_use_active'
    ];
BEGIN
    FOREACH v_fn IN ARRAY v_fns
    LOOP
        FOR v_role_id IN SELECT id FROM public.roles LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';
