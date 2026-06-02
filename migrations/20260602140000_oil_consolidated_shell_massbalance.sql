-- Sprint 3: Oil consolidated batches + lab attachment, shell waste as stock,
-- oil batch search, and a kernel mass-balance report.

-- ============================================================
-- 1. Oil consolidated batches (group sheets/bins; attach lab results)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.oil_consolidated_batch (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consolidated_number text NOT NULL UNIQUE,
    grade text NULL,
    total_oil_litre numeric NOT NULL DEFAULT 0,
    lab_test_doc_ref text NULL,            -- document-management ref or URL
    lab_test_notes text NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'released')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.oil_consolidated_batch_member (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consolidated_id uuid NOT NULL REFERENCES public.oil_consolidated_batch(id) ON DELETE CASCADE,
    oil_id uuid NOT NULL REFERENCES public.oil(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consolidated_id, oil_id)
);

CREATE INDEX IF NOT EXISTS idx_ocb_status ON public.oil_consolidated_batch (status);
CREATE INDEX IF NOT EXISTS idx_ocbm_consolidated ON public.oil_consolidated_batch_member (consolidated_id);
CREATE INDEX IF NOT EXISTS idx_ocbm_oil ON public.oil_consolidated_batch_member (oil_id);

REVOKE ALL ON TABLE public.oil_consolidated_batch FROM PUBLIC;
REVOKE ALL ON TABLE public.oil_consolidated_batch_member FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oil_consolidated_batch TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oil_consolidated_batch_member TO service_role;

-- List consolidated batches with member counts and summed litres.
CREATE OR REPLACE FUNCTION public.get_oil_consolidated_batches()
RETURNS TABLE (
    id uuid,
    consolidated_number text,
    grade text,
    total_oil_litre numeric,
    member_count bigint,
    members_litre numeric,
    lab_test_doc_ref text,
    lab_test_notes text,
    status text,
    created_at timestamptz,
    updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT
        c.id, c.consolidated_number, c.grade, c.total_oil_litre,
        count(m.id)::bigint AS member_count,
        COALESCE(SUM(o.total_oil_litre), 0)::numeric AS members_litre,
        c.lab_test_doc_ref, c.lab_test_notes, c.status, c.created_at, c.updated_at
    FROM public.oil_consolidated_batch c
    LEFT JOIN public.oil_consolidated_batch_member m ON m.consolidated_id = c.id
    LEFT JOIN public.oil o ON o.id = m.oil_id
    GROUP BY c.id
    ORDER BY c.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.upsert_oil_consolidated_batch(
    p_id uuid,
    p_consolidated_number text,
    p_grade text,
    p_lab_test_doc_ref text,
    p_lab_test_notes text,
    p_status text
)
RETURNS SETOF public.oil_consolidated_batch
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_num text := trim(coalesce(p_consolidated_number, ''));
    v_status text := lower(trim(coalesce(p_status, 'open')));
    v_id uuid;
BEGIN
    IF v_num = '' THEN RAISE EXCEPTION 'consolidated_number is required'; END IF;
    IF v_status NOT IN ('open', 'closed', 'released') THEN v_status := 'open'; END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.oil_consolidated_batch (consolidated_number, grade, lab_test_doc_ref, lab_test_notes, status)
        VALUES (v_num, NULLIF(trim(coalesce(p_grade, '')), ''), NULLIF(trim(coalesce(p_lab_test_doc_ref, '')), ''),
                NULLIF(trim(coalesce(p_lab_test_notes, '')), ''), v_status)
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.oil_consolidated_batch
        SET consolidated_number = v_num,
            grade = NULLIF(trim(coalesce(p_grade, '')), ''),
            lab_test_doc_ref = NULLIF(trim(coalesce(p_lab_test_doc_ref, '')), ''),
            lab_test_notes = NULLIF(trim(coalesce(p_lab_test_notes, '')), ''),
            status = v_status,
            updated_at = now()
        WHERE id = p_id;
        v_id := p_id;
    END IF;

    RETURN QUERY SELECT * FROM public.oil_consolidated_batch WHERE id = v_id;
END;
$$;

-- Add an oil sheet to a consolidated batch and refresh its total litres.
CREATE OR REPLACE FUNCTION public.add_oil_consolidated_member(p_consolidated_id uuid, p_oil_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.oil_consolidated_batch_member (consolidated_id, oil_id)
    VALUES (p_consolidated_id, p_oil_id)
    ON CONFLICT (consolidated_id, oil_id) DO NOTHING;

    UPDATE public.oil_consolidated_batch c
    SET total_oil_litre = (
        SELECT COALESCE(SUM(o.total_oil_litre), 0)
        FROM public.oil_consolidated_batch_member m
        JOIN public.oil o ON o.id = m.oil_id
        WHERE m.consolidated_id = c.id
    ), updated_at = now()
    WHERE c.id = p_consolidated_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_oil_consolidated_member(p_consolidated_id uuid, p_oil_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    DELETE FROM public.oil_consolidated_batch_member
    WHERE consolidated_id = p_consolidated_id AND oil_id = p_oil_id;

    UPDATE public.oil_consolidated_batch c
    SET total_oil_litre = (
        SELECT COALESCE(SUM(o.total_oil_litre), 0)
        FROM public.oil_consolidated_batch_member m
        JOIN public.oil o ON o.id = m.oil_id
        WHERE m.consolidated_id = c.id
    ), updated_at = now()
    WHERE c.id = p_consolidated_id;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_oil_consolidated_batch(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
    DELETE FROM public.oil_consolidated_batch WHERE id = p_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

-- ============================================================
-- 2. Oil batch search (search/filter for the oil grid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_oil_batches(
    p_search text DEFAULT NULL,
    p_from date DEFAULT NULL,
    p_to date DEFAULT NULL,
    p_status text DEFAULT NULL
)
RETURNS TABLE (
    id uuid,
    batch_id uuid,
    production_date date,
    shift varchar,
    product_name varchar,
    status varchar,
    total_oil_litre numeric,
    created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT o.id, o.batch_id, o.production_date, o.shift, o.product_name, o.status, o.total_oil_litre, o.created_at
    FROM public.oil o
    JOIN public.batches b ON b.id = o.batch_id
    WHERE o.is_active = true
      AND (p_status IS NULL OR p_status = '' OR o.status = p_status)
      AND (p_from IS NULL OR o.production_date >= p_from)
      AND (p_to IS NULL OR o.production_date <= p_to)
      AND (
          p_search IS NULL OR trim(p_search) = ''
          OR b.batch_number ILIKE '%' || p_search || '%'
          OR COALESCE(o.product_name, '') ILIKE '%' || p_search || '%'
          OR COALESCE(o.shift, '') ILIKE '%' || p_search || '%'
      )
    ORDER BY o.production_date DESC NULLS LAST, o.created_at DESC;
$$;

-- ============================================================
-- 3. Shell waste as a sellable stock product
-- ============================================================
CREATE TABLE IF NOT EXISTS public.shell_stock_lot (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_number text NOT NULL UNIQUE,
    source_batch_number text NULL,
    quantity_kg numeric NOT NULL DEFAULT 0 CHECK (quantity_kg >= 0),
    status text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock', 'dispatched', 'written_off')),
    notes text NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shell_stock_status ON public.shell_stock_lot (status);

REVOKE ALL ON TABLE public.shell_stock_lot FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.shell_stock_lot TO service_role;

CREATE OR REPLACE FUNCTION public.get_shell_stock_lots()
RETURNS SETOF public.shell_stock_lot
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT * FROM public.shell_stock_lot ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.upsert_shell_stock_lot(
    p_id uuid,
    p_lot_number text,
    p_source_batch_number text,
    p_quantity_kg numeric,
    p_status text,
    p_notes text
)
RETURNS SETOF public.shell_stock_lot
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_lot text := trim(coalesce(p_lot_number, ''));
    v_status text := lower(trim(coalesce(p_status, 'in_stock')));
    v_id uuid;
BEGIN
    IF v_lot = '' THEN
        v_lot := 'SHELL-' || to_char(now(), 'YYYYMMDDHH24MISS');
    END IF;
    IF v_status NOT IN ('in_stock', 'dispatched', 'written_off') THEN v_status := 'in_stock'; END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.shell_stock_lot (lot_number, source_batch_number, quantity_kg, status, notes)
        VALUES (v_lot, NULLIF(trim(coalesce(p_source_batch_number, '')), ''), GREATEST(0, coalesce(p_quantity_kg, 0)),
                v_status, NULLIF(trim(coalesce(p_notes, '')), ''))
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.shell_stock_lot
        SET lot_number = v_lot,
            source_batch_number = NULLIF(trim(coalesce(p_source_batch_number, '')), ''),
            quantity_kg = GREATEST(0, coalesce(p_quantity_kg, 0)),
            status = v_status,
            notes = NULLIF(trim(coalesce(p_notes, '')), ''),
            updated_at = now()
        WHERE id = p_id;
        v_id := p_id;
    END IF;
    RETURN QUERY SELECT * FROM public.shell_stock_lot WHERE id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_shell_stock_lot(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
    DELETE FROM public.shell_stock_lot WHERE id = p_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n > 0;
END;
$$;

-- ============================================================
-- 4. Kernel mass-balance report (intake/cracked vs packed, balance %)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_kernel_mass_balance(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
    cracked_kg numeric,
    packed_kg numeric,
    balance_kg numeric,
    balance_pct numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from date := COALESCE(p_from, current_date - interval '30 days');
    v_to date := COALESCE(p_to, current_date);
    v_cracked numeric;
    v_packed numeric;
BEGIN
    SELECT COALESCE(SUM(
        COALESCE(NULLIF(TRIM(elem->>'totalqty'), '')::numeric, NULLIF(TRIM(elem->>'total_qty'), '')::numeric, 0)
    ), 0) INTO v_cracked
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.cracking_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND (CASE
            WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
            WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
            ELSE NULL END) BETWEEN v_from AND v_to;

    SELECT COALESCE(SUM(
        COALESCE(NULLIF(TRIM(elem->>'totals_qty'), '')::numeric, 0)
    ), 0) INTO v_packed
    FROM public.kernel k,
         jsonb_array_elements(COALESCE(NULLIF(k.packing_data, 'null'::jsonb), '[]'::jsonb)) AS elem
    WHERE k.is_active = true
      AND (CASE
            WHEN (elem->>'date') ~ '^\d{4}-\d{2}-\d{2}' THEN (elem->>'date')::date
            WHEN (elem->>'date') ~ '^\d{1,2}/\d{1,2}/\d{4}$' THEN to_date(elem->>'date', 'DD/MM/YYYY')
            ELSE NULL END) BETWEEN v_from AND v_to;

    RETURN QUERY SELECT
        v_cracked,
        v_packed,
        (v_cracked - v_packed),
        CASE WHEN v_cracked > 0 THEN round((v_packed / v_cracked) * 100, 2) ELSE 0 END;
END;
$$;

-- ============================================================
-- 5. Grants + RBAC for all new RPCs
-- ============================================================
GRANT EXECUTE ON FUNCTION public.get_oil_consolidated_batches() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_oil_consolidated_batch(uuid, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_oil_consolidated_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.remove_oil_consolidated_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_oil_consolidated_batch(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_oil_batches(text, date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_shell_stock_lots() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_shell_stock_lot(uuid, text, text, numeric, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_shell_stock_lot(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_kernel_mass_balance(date, date) TO authenticated, service_role;

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_fns text[] := ARRAY[
        'get_oil_consolidated_batches', 'upsert_oil_consolidated_batch',
        'add_oil_consolidated_member', 'remove_oil_consolidated_member', 'delete_oil_consolidated_batch',
        'search_oil_batches', 'get_shell_stock_lots', 'upsert_shell_stock_lot', 'delete_shell_stock_lot',
        'get_kernel_mass_balance'
    ];
BEGIN
    FOR v_role_id IN SELECT id FROM public.roles LOOP
        FOREACH v_fn IN ARRAY v_fns LOOP
            INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
            VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

COMMENT ON TABLE public.oil_consolidated_batch IS 'Groups oil production sheets into a consolidated batch with shared lab results.';
COMMENT ON TABLE public.shell_stock_lot IS 'Shell waste tracked as a sellable stock product.';

NOTIFY pgrst, 'reload schema';
