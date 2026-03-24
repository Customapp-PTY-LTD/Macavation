-- Supplier Intake: only the first sample test records official FFA on the bag (oil.intake_data).
-- Subsequent attempts are rejected. Raw-ingredient snapshot includes this FFA for traceability.

CREATE OR REPLACE FUNCTION public.complete_supplier_intake_first_sample_ffa(
    p_oil_id     uuid,
    p_ffa_pct    numeric,
    p_updated_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row     RECORD;
    v_intake  jsonb;
    v_merged  jsonb;
BEGIN
    IF p_oil_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'p_oil_id is required');
    END IF;
    IF p_ffa_pct IS NULL OR p_ffa_pct < 0 OR p_ffa_pct > 100 THEN
        RETURN jsonb_build_object('success', false, 'error', 'FFA % must be between 0 and 100');
    END IF;

    SELECT id, intake_data, status
    INTO v_row
    FROM public.oil
    WHERE id = p_oil_id AND is_active = true;

    IF v_row.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil batch not found');
    END IF;

    v_intake := COALESCE(v_row.intake_data, '{}'::jsonb);
    IF v_intake ? 'supplier_intake_official_ffa_at' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Official supplier intake FFA is already recorded for this batch. Use Quality Assurance for any further tests.'
        );
    END IF;

    v_merged := v_intake || jsonb_build_object(
        'official_ffa', to_jsonb(p_ffa_pct),
        'ffa', to_jsonb(p_ffa_pct),
        'supplier_intake_official_ffa_at', to_jsonb(now())
    );

    UPDATE public.oil o
    SET intake_data = v_merged,
        status = 'release_ready',
        updated_by = COALESCE(p_updated_by, o.updated_by),
        updated_at = NOW()
    WHERE o.id = p_oil_id AND o.is_active = true;

    RETURN jsonb_build_object('success', true, 'id', p_oil_id);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_supplier_intake_first_sample_ffa(uuid, numeric, uuid) FROM PUBLIC;

COMMENT ON FUNCTION public.complete_supplier_intake_first_sample_ffa(uuid, numeric, uuid) IS
  'First Supplier Intake sample test only: stores official FFA on intake_data (official_ffa, ffa), sets supplier_intake_official_ffa_at, status release_ready. Rejects if already recorded.';

DO $$
DECLARE
    v_role_id uuid;
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.role_permissions
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'complete_supplier_intake_first_sample_ffa' AND operation = 'EXECUTE'
        ) THEN
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', 'complete_supplier_intake_first_sample_ffa', 'EXECUTE', true);
        ELSE
            UPDATE public.role_permissions SET allowed = true, updated_at = now()
            WHERE role_id = v_role_id AND object_type = 'function' AND object_name = 'complete_supplier_intake_first_sample_ffa' AND operation = 'EXECUTE';
        END IF;
    END LOOP;
END $$;

-- Include official / bag FFA on raw-ingredient snapshot (production floor)
CREATE OR REPLACE FUNCTION public.get_oil_production_raw_ingredients_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(obj ORDER BY sort_key), '[]'::jsonb)
    FROM (
        SELECT
            jsonb_build_object(
                'oil_id', o.id,
                'batch_id', o.batch_id,
                'quantity_kg', COALESCE(
                    NULLIF((o.intake_data->>'quantity_kg'), '')::numeric,
                    NULLIF((o.intake_data#>>'{items,0,quantity_kg}'), '')::numeric
                ),
                'ffa', CASE
                    WHEN (o.intake_data ? 'official_ffa')
                         AND jsonb_typeof(o.intake_data->'official_ffa') = 'number'
                    THEN (o.intake_data->'official_ffa')::text::numeric
                    WHEN NULLIF(trim(COALESCE(o.intake_data->>'official_ffa', '')), '') IS NOT NULL
                    THEN (NULLIF(trim(o.intake_data->>'official_ffa'), ''))::numeric
                    WHEN (o.intake_data ? 'ffa') AND jsonb_typeof(o.intake_data->'ffa') = 'number'
                    THEN (o.intake_data->'ffa')::text::numeric
                    WHEN NULLIF(trim(COALESCE(o.intake_data->>'ffa', '')), '') IS NOT NULL
                    THEN (NULLIF(trim(o.intake_data->>'ffa'), ''))::numeric
                    ELSE NULL
                END,
                'product_type', NULLIF(trim(COALESCE(
                    o.intake_data->>'product_type',
                    o.production_data->>'name_of_product',
                    ''
                )), ''),
                'supplier', NULLIF(trim(COALESCE(
                    o.intake_data->>'supplier',
                    o.intake_data->>'supplier_details',
                    ''
                )), '')
            ) AS obj,
            o.batch_id::text AS sort_key
        FROM public.oil o
        WHERE o.is_active = true
          AND o.status = 'production'
    ) s;
$$;
