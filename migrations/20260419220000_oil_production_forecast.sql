-- Oil & protein production forecast: customer demand lines by stream (food grade / cosmetic / protein),
-- compared to on-hand oil_stock_lots (kg) from Stock (Oil & Protein), same pattern as kernel_production_forecast.

CREATE TABLE IF NOT EXISTS public.oil_production_forecast (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_label text NOT NULL DEFAULT '',
    order_summary text,
    stream_code text NOT NULL,
    quantity_kg numeric(14, 2) NOT NULL DEFAULT 0 CHECK (quantity_kg >= 0),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'fulfilled', 'cancelled')),
    due_date date,
    notes text,
    sort_index integer,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_oil_production_forecast_stream ON public.oil_production_forecast (stream_code);
CREATE INDEX IF NOT EXISTS idx_oil_production_forecast_status ON public.oil_production_forecast (status);

REVOKE ALL ON TABLE public.oil_production_forecast FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oil_production_forecast TO service_role;

CREATE OR REPLACE FUNCTION public.get_oil_production_forecasts()
RETURNS SETOF public.oil_production_forecast
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT *
    FROM public.oil_production_forecast
    ORDER BY sort_index NULLS LAST, created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.upsert_oil_production_forecast(
    p_id uuid,
    p_customer_label text,
    p_order_summary text,
    p_stream_code text,
    p_quantity_kg numeric,
    p_status text,
    p_due_date date,
    p_notes text,
    p_sort_index integer
)
RETURNS SETOF public.oil_production_forecast
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_allowed text[] := ARRAY['food_grade', 'cosmetic', 'protein'];
    v_stream text := lower(trim(coalesce(p_stream_code, '')));
    v_status text := lower(trim(coalesce(p_status, 'open')));
    v_qty numeric := coalesce(p_quantity_kg, 0);
    v_id uuid;
BEGIN
    IF v_stream = '' OR NOT (v_stream = ANY (v_allowed)) THEN
        RAISE EXCEPTION 'Invalid stream_code';
    END IF;
    IF v_status NOT IN ('open', 'in_progress', 'fulfilled', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid status';
    END IF;
    IF v_qty < 0 THEN
        RAISE EXCEPTION 'quantity_kg must be >= 0';
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.oil_production_forecast (
            customer_label, order_summary, stream_code, quantity_kg,
            status, due_date, notes, sort_index, created_at, updated_at
        )
        VALUES (
            coalesce(p_customer_label, ''),
            nullif(trim(coalesce(p_order_summary, '')), ''),
            v_stream,
            v_qty,
            v_status,
            p_due_date,
            nullif(trim(coalesce(p_notes, '')), ''),
            p_sort_index,
            now(),
            now()
        )
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.oil_production_forecast
        SET
            customer_label = coalesce(p_customer_label, ''),
            order_summary = nullif(trim(coalesce(p_order_summary, '')), ''),
            stream_code = v_stream,
            quantity_kg = v_qty,
            status = v_status,
            due_date = p_due_date,
            notes = nullif(trim(coalesce(p_notes, '')), ''),
            sort_index = p_sort_index,
            updated_at = now()
        WHERE id = p_id;
        v_id := p_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Forecast not found: %', p_id;
        END IF;
    END IF;

    RETURN QUERY
    SELECT * FROM public.oil_production_forecast WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_oil_production_forecast(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    n integer;
BEGIN
    DELETE FROM public.oil_production_forecast WHERE id = p_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_oil_production_forecasts() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_oil_production_forecast(uuid, text, text, text, numeric, text, date, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_oil_production_forecast(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.oil_production_forecast IS 'Planned oil & protein demand by stream (kg). UI compares open lines to get_oil_stock_lots on_hand totals.';

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'get_oil_production_forecasts',
        'upsert_oil_production_forecast',
        'delete_oil_production_forecast'
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
                SET allowed = true
                WHERE role_id = v_role_id AND object_type = 'function' AND object_name = v_fn AND operation = 'EXECUTE';
            END IF;
        END LOOP;
    END LOOP;
END $$;

INSERT INTO public.features (key, name, description)
VALUES (
    'oil-production-forecast-grid',
    'Oil Production Forecast',
    'Record forecasted oil & protein demand by stream; compare open lines to stock on hand (kg).'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN public.features f
WHERE f.key = 'oil-production-forecast-grid'
  AND r.role_name IN (
      'super_user', 'admin',
      'General Manager', 'Production Manager',
      'QA Supervisor', 'Oil Plant Manager', 'Office Administrator'
  )
ON CONFLICT (role_id, feature_id) DO NOTHING;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT DISTINCT rf.role_id, f_new.id, 'true'
FROM public.features f_new
CROSS JOIN public.role_features rf
JOIN public.features f_k ON f_k.id = rf.feature_id
WHERE f_new.key = 'oil-production-forecast-grid'
  AND f_k.key IN ('oil-production-grid', 'stock-management-oil', 'supplier-intake-grid')
ON CONFLICT (role_id, feature_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
