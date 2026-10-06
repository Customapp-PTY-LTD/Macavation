-- Kernel Pipeline Settings (Mike Potgieter feedback, 5 Oct 2026; decisions D4, D6, D10, D14, H2).
--
-- One place for everything Macavation asked to be adjustable without a code change:
--   * kernel_pipeline_settings  key/value switches (bag_numbering = 'stable' | 'renumber')
--   * sample_spec_thresholds    green/yellow limits for the ziplock sample (moisture, PV, FFA)
--   * crate_weights             kg per crate for each production stage / crate type / sorting style
--   * transporters              transport companies for the New Delivery dropdown
--   * transport_types           Link, 18 Tonner, ... for the New Delivery dropdown
--   * silos                     the 12 physical silos and their capacity (kg)
--
-- Spec limits and crate weights are seeded EMPTY on purpose: Macavation has not supplied the real
-- figures yet. An empty limit means "no colour"; an empty crate weight means the kg field stays a
-- manual entry. Nothing in the UI may assume a value exists.
--
-- Access pattern (same as every portal RPC): SECURITY DEFINER functions called over PostgREST;
-- edits are gated in the UI by the action key kernel_settings.edit (migration 20261006090300).

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kernel_pipeline_settings (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid NULL
);

INSERT INTO public.kernel_pipeline_settings (key, value)
VALUES ('bag_numbering', '"stable"'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sample_spec_thresholds (
    test_key      text PRIMARY KEY CHECK (test_key IN ('moisture', 'pv', 'ffa')),
    label         text NOT NULL,
    direction     text NOT NULL DEFAULT 'max' CHECK (direction IN ('max', 'min')),
    green_limit   numeric NULL,
    yellow_limit  numeric NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    uuid NULL
);
COMMENT ON COLUMN public.sample_spec_thresholds.direction IS
  'max = lower is better (green when value <= green_limit, yellow when <= yellow_limit, else red); min = higher is better (mirror).';

INSERT INTO public.sample_spec_thresholds (test_key, label, direction) VALUES
    ('moisture', 'Moisture (%)', 'max'),
    ('pv',       'Peroxide Value (meqO₂/kg)', 'max'),
    ('ffa',      'Free Fatty Acids (%)', 'max')
ON CONFLICT (test_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.crate_weights (
    stage         text NOT NULL CHECK (stage IN ('washing', 'sorting')),
    crate_type    text NOT NULL,
    label         text NOT NULL,
    kg_per_crate  numeric NULL CHECK (kg_per_crate IS NULL OR kg_per_crate > 0),
    sort_order    integer NOT NULL DEFAULT 0,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    updated_by    uuid NULL,
    PRIMARY KEY (stage, crate_type)
);

INSERT INTO public.crate_weights (stage, crate_type, label, sort_order) VALUES
    ('washing', 'in',         'Crates in (wet kernel)',  10),
    ('washing', 'floater',    'Floater crate',           20),
    ('washing', 'sinker',     'Sinker crate',            30),
    ('sorting', 'floater_in', 'Floater crate in',        10),
    ('sorting', 'sinker_in',  'Sinker crate in',         20),
    ('sorting', 'butterlow',  'Butter low oil crate',    30),
    ('sorting', 'style_0',    'Style 0 crate',           40),
    ('sorting', 'style_1',    'Style 1 crate',           50),
    ('sorting', 'style_1S',   'Style 1S crate',          60),
    ('sorting', 'style_4L',   'Style 4L crate',          70),
    ('sorting', 'style_5',    'Style 5 crate',           80),
    ('sorting', 'style_6',    'Style 6 crate',           90),
    ('sorting', 'style_78',   'Style 7/8 crate',        100)
ON CONFLICT (stage, crate_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.transporters (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    updated_by  uuid NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transporters_name_lower ON public.transporters (lower(name));

CREATE TABLE IF NOT EXISTS public.transport_types (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    sort_order  integer NOT NULL DEFAULT 0,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_types_name_lower ON public.transport_types (lower(name));

INSERT INTO public.transport_types (name, sort_order) VALUES
    ('Link', 10), ('18 Tonner', 20), ('12 Tonner', 30), ('8 Tonner', 40), ('Per Pallet', 50)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.silos (
    silo_number  integer PRIMARY KEY CHECK (silo_number BETWEEN 1 AND 99),
    capacity_kg  numeric NOT NULL DEFAULT 4000 CHECK (capacity_kg > 0),
    is_active    boolean NOT NULL DEFAULT true,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid NULL
);

INSERT INTO public.silos (silo_number, capacity_kg)
SELECT g, 4000 FROM generate_series(1, 12) g
ON CONFLICT (silo_number) DO NOTHING;

REVOKE ALL ON TABLE public.kernel_pipeline_settings, public.sample_spec_thresholds, public.crate_weights,
    public.transporters, public.transport_types, public.silos FROM anon, authenticated;

-- ============================================================================
-- 2. READ — one call returns the whole configuration
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_kernel_pipeline_config()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT jsonb_build_object(
        'success', true,
        'settings', COALESCE((SELECT jsonb_object_agg(key, value) FROM public.kernel_pipeline_settings), '{}'::jsonb),
        'spec_thresholds', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'test_key', test_key, 'label', label, 'direction', direction,
                'green_limit', green_limit, 'yellow_limit', yellow_limit) ORDER BY
                CASE test_key WHEN 'moisture' THEN 1 WHEN 'pv' THEN 2 ELSE 3 END)
            FROM public.sample_spec_thresholds), '[]'::jsonb),
        'crate_weights', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'stage', stage, 'crate_type', crate_type, 'label', label, 'kg_per_crate', kg_per_crate)
                ORDER BY stage DESC, sort_order)
            FROM public.crate_weights), '[]'::jsonb),
        'transporters', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'is_active', is_active) ORDER BY lower(name))
            FROM public.transporters), '[]'::jsonb),
        'transport_types', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'is_active', is_active) ORDER BY sort_order, lower(name))
            FROM public.transport_types), '[]'::jsonb),
        'silos', COALESCE((SELECT jsonb_agg(jsonb_build_object('silo_number', silo_number, 'capacity_kg', capacity_kg, 'is_active', is_active) ORDER BY silo_number)
            FROM public.silos), '[]'::jsonb)
    );
$$;

-- ============================================================================
-- 3. WRITES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_kernel_pipeline_setting(p_key text, p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_key = 'bag_numbering' AND p_value NOT IN ('"stable"'::jsonb, '"renumber"'::jsonb) THEN
        RETURN jsonb_build_object('success', false, 'error', 'bag_numbering must be "stable" or "renumber"');
    ELSIF p_key IS DISTINCT FROM 'bag_numbering' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown setting: ' || COALESCE(p_key, 'null'));
    END IF;
    INSERT INTO public.kernel_pipeline_settings (key, value, updated_at)
    VALUES (p_key, p_value, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_sample_spec_threshold(
    p_test_key text, p_direction text, p_green_limit numeric, p_yellow_limit numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_direction NOT IN ('max', 'min') THEN
        RETURN jsonb_build_object('success', false, 'error', 'direction must be max or min');
    END IF;
    IF p_green_limit IS NOT NULL AND p_yellow_limit IS NOT NULL AND (
        (p_direction = 'max' AND p_yellow_limit < p_green_limit) OR
        (p_direction = 'min' AND p_yellow_limit > p_green_limit)) THEN
        RETURN jsonb_build_object('success', false, 'error',
            CASE WHEN p_direction = 'max' THEN 'The yellow limit must be the same as or higher than the green limit.'
                 ELSE 'The yellow limit must be the same as or lower than the green limit.' END);
    END IF;
    UPDATE public.sample_spec_thresholds
    SET direction = p_direction, green_limit = p_green_limit, yellow_limit = p_yellow_limit, updated_at = now()
    WHERE test_key = p_test_key;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown test: ' || COALESCE(p_test_key, 'null'));
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_crate_weight(p_stage text, p_crate_type text, p_kg_per_crate numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_kg_per_crate IS NOT NULL AND p_kg_per_crate <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Kg per crate must be more than 0, or left blank.');
    END IF;
    UPDATE public.crate_weights
    SET kg_per_crate = p_kg_per_crate, updated_at = now()
    WHERE stage = p_stage AND crate_type = p_crate_type;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown crate: ' || COALESCE(p_stage, '') || '/' || COALESCE(p_crate_type, ''));
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_transporter(p_name text, p_id uuid DEFAULT NULL, p_is_active boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_name text := trim(COALESCE(p_name, ''));
BEGIN
    IF v_name = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the transport company name.');
    END IF;
    IF p_id IS NULL THEN
        SELECT id INTO v_id FROM public.transporters WHERE lower(name) = lower(v_name);
        IF v_id IS NOT NULL THEN
            UPDATE public.transporters SET is_active = true, updated_at = now() WHERE id = v_id;
            RETURN jsonb_build_object('success', true, 'id', v_id, 'name', v_name, 'existing', true);
        END IF;
        INSERT INTO public.transporters (name) VALUES (v_name) RETURNING id INTO v_id;
    ELSE
        UPDATE public.transporters SET name = v_name, is_active = COALESCE(p_is_active, true), updated_at = now()
        WHERE id = p_id RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Transport company not found');
        END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'name', v_name);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'A transport company with that name already exists.');
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_transport_type(p_name text, p_id uuid DEFAULT NULL, p_is_active boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_id uuid; v_name text := trim(COALESCE(p_name, ''));
BEGIN
    IF v_name = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the transport type.');
    END IF;
    IF p_id IS NULL THEN
        INSERT INTO public.transport_types (name, sort_order)
        VALUES (v_name, COALESCE((SELECT max(sort_order) FROM public.transport_types), 0) + 10)
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.transport_types SET name = v_name, is_active = COALESCE(p_is_active, true), updated_at = now()
        WHERE id = p_id RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Transport type not found');
        END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'name', v_name);
EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'That transport type already exists.');
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_silo_capacity(p_silo_number integer, p_capacity_kg numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF p_capacity_kg IS NULL OR p_capacity_kg <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Silo capacity must be more than 0 kg.');
    END IF;
    UPDATE public.silos SET capacity_kg = p_capacity_kg, updated_at = now() WHERE silo_number = p_silo_number;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Silo not found');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

NOTIFY pgrst, 'reload schema';
