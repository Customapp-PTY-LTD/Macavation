-- =============================================================================
-- Kernel style prices (Pete, 26 Oct 2026). A price per kg per kernel style, dated
-- (effective_from) so a dispatch keeps the price of its day. Optional per-customer
-- prices override the list price for that customer. The pricing mode
-- ('single' | 'per_customer' | 'per_dispatch') lives in kernel_pipeline_settings
-- key 'kernel_pricing'.
--
-- Prices are only SHOWN to holders of action 'kernel_prices.view' (UI-side, like
-- every other portal gate: RPCs run with the anon key).
-- Down: DROP the RPCs and helper functions; DROP TABLE kernel_style_prices.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.kernel_style_prices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    style_code      text NOT NULL REFERENCES public.kernel_style_registry(style_code) ON UPDATE CASCADE ON DELETE RESTRICT,
    customer_id     uuid REFERENCES public.contacts(id) ON DELETE CASCADE,
    price_per_kg    numeric(12,4) NOT NULL CHECK (price_per_kg >= 0),
    effective_from  date NOT NULL,
    created_by      uuid,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_kernel_style_prices_style_customer_date
    ON public.kernel_style_prices (style_code, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from);
CREATE INDEX IF NOT EXISTS idx_kernel_style_prices_customer_id ON public.kernel_style_prices(customer_id);

ALTER TABLE public.kernel_style_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.kernel_style_prices FROM anon, authenticated;

-- Dispatch lines and stock history name the butter styles in full; the registry uses codes.
CREATE OR REPLACE FUNCTION public.kernel_style_code_from_dispatch(p_style text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE p_style
        WHEN 'Butter High Oil' THEN 'BHO'
        WHEN 'Butter Low Oil'  THEN 'BLO'
        ELSE p_style
    END;
$$;

-- Price of a style for a customer on a date: the customer's own price if one is
-- in force, otherwise the list price. NULL when no price has been set.
CREATE OR REPLACE FUNCTION public.kernel_style_price_on(p_style_code text, p_customer_id uuid, p_on date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT price_per_kg
    FROM public.kernel_style_prices
    WHERE style_code = public.kernel_style_code_from_dispatch(p_style_code)
      AND effective_from <= COALESCE(p_on, (now() AT TIME ZONE 'Africa/Johannesburg')::date)
      AND (customer_id IS NULL OR customer_id = p_customer_id)
    ORDER BY (customer_id IS NOT NULL) DESC, effective_from DESC, created_at DESC
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_kernel_style_prices(p_customer_id uuid DEFAULT NULL, p_as_of date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_on      date := COALESCE(p_as_of, (now() AT TIME ZONE 'Africa/Johannesburg')::date);
    v_mode    text := COALESCE((SELECT value #>> '{}' FROM public.kernel_pipeline_settings WHERE key = 'kernel_pricing'), 'single');
    v_styles  jsonb;
    v_history jsonb;
    v_custs   jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'style_code', r.style_code,
               'label', r.label,
               'list_price', lp.price_per_kg,
               'list_from', lp.effective_from,
               'list_changed_by', public.stock_history_user_label(lp.created_by),
               'list_changed_at', lp.created_at,
               'customer_price', cp.price_per_kg,
               'customer_from', cp.effective_from
           ) ORDER BY r.display_order, r.style_code), '[]'::jsonb)
    INTO v_styles
    FROM public.kernel_style_registry r
    LEFT JOIN LATERAL (
        SELECT price_per_kg, effective_from, created_by, created_at FROM public.kernel_style_prices s
        WHERE s.style_code = r.style_code AND s.customer_id IS NULL AND s.effective_from <= v_on
        ORDER BY s.effective_from DESC, s.created_at DESC LIMIT 1
    ) lp ON true
    LEFT JOIN LATERAL (
        SELECT price_per_kg, effective_from FROM public.kernel_style_prices s
        WHERE p_customer_id IS NOT NULL AND s.style_code = r.style_code AND s.customer_id = p_customer_id
          AND s.effective_from <= v_on
        ORDER BY s.effective_from DESC, s.created_at DESC LIMIT 1
    ) cp ON true
    WHERE r.is_active;

    SELECT COALESCE(jsonb_agg(h ORDER BY (h->>'effective_from')::date DESC, h->>'customer_name' NULLS FIRST), '[]'::jsonb)
    INTO v_history
    FROM (
        SELECT jsonb_build_object(
                   'effective_from', s.effective_from,
                   'customer_id', s.customer_id,
                   'customer_name', COALESCE(c.company_name, c.trading_name),
                   'styles_changed', COUNT(*),
                   'changed_by', public.stock_history_user_label((array_agg(s.created_by ORDER BY s.created_at DESC))[1]),
                   'changed_at', MAX(s.created_at),
                   'is_future', s.effective_from > v_on,
                   'prices', jsonb_agg(jsonb_build_object('style_code', s.style_code, 'price_per_kg', s.price_per_kg) ORDER BY s.style_code)
               ) AS h
        FROM public.kernel_style_prices s
        LEFT JOIN public.contacts c ON c.id = s.customer_id
        GROUP BY s.effective_from, s.customer_id, c.company_name, c.trading_name
        ORDER BY s.effective_from DESC
        LIMIT 60
    ) x;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', c.id,
               'name', COALESCE(NULLIF(trim(c.company_name), ''), c.trading_name, c.primary_contact_name),
               'has_prices', EXISTS (SELECT 1 FROM public.kernel_style_prices s WHERE s.customer_id = c.id))
               ORDER BY COALESCE(NULLIF(trim(c.company_name), ''), c.trading_name, c.primary_contact_name)), '[]'::jsonb)
    INTO v_custs
    FROM (SELECT * FROM public.contacts WHERE contact_type IN ('kernel_customer', 'customer', 'both') LIMIT 500) c;

    RETURN jsonb_build_object(
        'success', true,
        'mode', v_mode,
        'as_of', v_on,
        'customer_id', p_customer_id,
        'kg_per_carton', 11.34,
        'styles', v_styles,
        'history', v_history,
        'customers', v_custs
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.save_kernel_style_prices(
    p_effective_from date,
    p_prices         jsonb,
    p_customer_id    uuid DEFAULT NULL,
    p_actor_user_id  uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_item  jsonb;
    v_code  text;
    v_price numeric;
    v_n     integer := 0;
BEGIN
    IF p_effective_from IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose the date the new prices apply from.');
    END IF;
    IF p_prices IS NULL OR jsonb_typeof(p_prices) <> 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'No prices to save.');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_prices) LOOP
        v_code := public.kernel_style_code_from_dispatch(v_item->>'style_code');
        IF (v_item->>'price_per_kg') IS NULL OR trim(v_item->>'price_per_kg') = '' THEN
            CONTINUE;
        END IF;
        v_price := (v_item->>'price_per_kg')::numeric;
        IF v_price < 0 THEN
            RETURN jsonb_build_object('success', false, 'error', 'Prices cannot be negative.');
        END IF;
        IF NOT EXISTS (SELECT 1 FROM public.kernel_style_registry WHERE style_code = v_code) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unknown style: ' || COALESCE(v_code, '?'));
        END IF;
        INSERT INTO public.kernel_style_prices (style_code, customer_id, price_per_kg, effective_from, created_by)
        VALUES (v_code, p_customer_id, ROUND(v_price, 4), p_effective_from, p_actor_user_id)
        ON CONFLICT (style_code, COALESCE(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from)
        DO UPDATE SET price_per_kg = EXCLUDED.price_per_kg, created_by = EXCLUDED.created_by, created_at = now();
        v_n := v_n + 1;
    END LOOP;

    IF v_n = 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter at least one price.');
    END IF;
    RETURN jsonb_build_object('success', true, 'saved', v_n);
EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'Prices must be numbers, e.g. 145.50.');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_kernel_pricing_mode(p_mode text, p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_mode IS NULL OR p_mode NOT IN ('single', 'per_customer', 'per_dispatch') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown pricing mode.');
    END IF;
    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at, updated_by)
    VALUES ('kernel_pricing', to_jsonb(p_mode), now(), p_actor_user_id)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by;
    RETURN jsonb_build_object('success', true, 'mode', p_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION public.kernel_style_code_from_dispatch(text) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.kernel_style_price_on(text, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_kernel_style_prices(uuid, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_kernel_style_prices(date, jsonb, uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_kernel_pricing_mode(text, uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
