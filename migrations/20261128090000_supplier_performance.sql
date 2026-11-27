-- ============================================================================
-- Suppliers > performance and map (Mike's MacView, round 3, 27 Nov 2026).
--
-- WHY. CRM keeps the supplier contact list and the kernel dashboard has one "kg by supplier"
-- chart, but nothing ranks suppliers by what they delivered and its quality, or shows where they
-- farm. MacView has both. This builds on the CRM list (contacts); it does NOT add a second list.
--
-- Where deliveries come from (verified on the dev DB 27 Nov 2026):
--   data_nis_intake   Pete's procurement ledger (Data page). The ONLY place SKR / USKR are kept
--                     (hand-entered, see 20260819130000). Moisture too.
--   kernel            live Grower Intake deliveries. Moisture from the ziplock sample.
--   The two overlap: some live deliveries were also loaded from Pete's sheet. They are matched by
--   batch number with spaces, dots and case ignored ("BN 64.26.64" = "Bn 64 26 64"). When both
--   have the delivery, the ledger row wins (it carries SKR/USKR) and the live moisture fills a
--   blank ledger moisture. A live delivery not on the ledger is added. Nothing is counted twice.
--   oil_raw_receipts  oil raw materials received (supplier by name), shown as a second ranking.
--
-- Supplier matching: supplier_id when set, else the ledger's supplier number, else the name with
-- (Pty) Ltd / CC / punctuation ignored. A delivery that matches no contact keeps its own name and
-- is shown with "not on the list".
--
-- What this adds:
--   contacts.latitude / longitude   a GPS pin per contact (optional; the map falls back to the town)
--   _sup_norm(text), _batch_norm(text)   name / batch number matching keys
--   get_supplier_performance(from, to)   every delivery in the period + the supplier directory
--   set_contact_location(id, lat, lng)   save or clear a supplier's pin
--   screen  feature 'suppliers' (every role: kg and quality only, no rand values)
--   action  suppliers.location.edit for super_user, admin and roles that can edit CRM contacts
--
-- Idempotent. Needs 20260819130000 (data_nis_intake) and the oil raw receipts table.
-- ============================================================================

ALTER TABLE public.contacts
    ADD COLUMN IF NOT EXISTS latitude  numeric(9,6),
    ADD COLUMN IF NOT EXISTS longitude numeric(9,6);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_latlng_check') THEN
        ALTER TABLE public.contacts ADD CONSTRAINT contacts_latlng_check CHECK (
            (latitude IS NULL AND longitude IS NULL)
            OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180));
    END IF;
END $$;

CREATE OR REPLACE FUNCTION public._sup_norm(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT NULLIF(regexp_replace(
               regexp_replace(lower(coalesce(p, '')), '\(pty\)|\mpty\M|\mltd\M|\mcc\M|\mtrading\M|\mestates?\M', '', 'g'),
               '[^a-z0-9]', '', 'g'), '');
$$;

CREATE OR REPLACE FUNCTION public._batch_norm(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT NULLIF(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

-- ----------------------------------------------------------------------------
-- One read for the Suppliers screen. The page calls it for the period and the period before
-- (trend tiles), and once with a long range for a supplier's full history.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_supplier_performance(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_deliveries jsonb;
    v_oil jsonb;
    v_dir jsonb;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 4000 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a period of up to 10 years.');
    END IF;

    WITH sup AS (
        SELECT c.id, c.supplier_number, public._sup_norm(coalesce(nullif(c.trading_name, ''), c.company_name)) AS n1,
               public._sup_norm(c.company_name) AS n2
        FROM public.contacts c
        WHERE c.deleted_at IS NULL
          AND c.contact_type IN ('nis_supplier', 'supplier', 'both', 'oil_processor', 'oil_ingredient_supplier')
    ), live AS (
        SELECT k.id, public._batch_norm(b.batch_id) AS bn, b.batch_id AS batch, k.received_date AS d,
               k.supplier_id, k.grower_name,
               COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg) AS kg,
               CASE WHEN (k.intake_data #>> '{ziplock_sample,moisture_result}') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                    THEN (k.intake_data #>> '{ziplock_sample,moisture_result}')::numeric END AS moist
        FROM public.kernel k
        JOIN public.batches b ON b.id = k.batch_id
        WHERE COALESCE(k.is_active, true) AND k.received_date BETWEEN p_from AND p_to
    ), ledger AS (
        SELECT d.id, public._batch_norm(d.batch_number) AS bn, d.batch_number AS batch, d.received_date AS d,
               d.supplier_id, d.supplier_number, d.supplier_name, d.nis_kg AS kg,
               COALESCE(d.moisture_pct, d.moisture_pct_system) AS moist,
               d.sample_skr_pct AS skr, d.sample_uskr_pct AS uskr
        FROM public.data_nis_intake d
        WHERE d.received_date BETWEEN p_from AND p_to
    ), rows_ AS (
        SELECT 'ledger'::text AS src, l.batch, l.d, l.kg, l.skr, l.uskr,
               COALESCE(l.moist, (SELECT lv.moist FROM live lv WHERE lv.bn = l.bn AND lv.moist IS NOT NULL LIMIT 1)) AS moist,
               COALESCE(l.supplier_id,
                        (SELECT s.id FROM sup s WHERE l.supplier_number IS NOT NULL AND s.supplier_number = l.supplier_number LIMIT 1),
                        (SELECT s.id FROM sup s WHERE public._sup_norm(l.supplier_name) IN (s.n1, s.n2) LIMIT 1)) AS sid,
               l.supplier_name AS raw_name
        FROM ledger l
        UNION ALL
        SELECT 'intake', lv.batch, lv.d, lv.kg, NULL, NULL, lv.moist,
               COALESCE(lv.supplier_id,
                        (SELECT s.id FROM sup s WHERE public._sup_norm(lv.grower_name) IN (s.n1, s.n2) LIMIT 1)),
               lv.grower_name
        FROM live lv
        WHERE lv.bn IS NULL OR NOT EXISTS (SELECT 1 FROM ledger l WHERE l.bn = lv.bn)
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'src', r.src, 'batch', r.batch, 'date', r.d, 'kg', r.kg, 'skr', r.skr, 'uskr', r.uskr,
               'moisture', r.moist, 'supplier_id', r.sid, 'name', NULLIF(btrim(r.raw_name), ''))
             ORDER BY r.d DESC, r.batch), '[]'::jsonb)
    INTO v_deliveries
    FROM rows_ r;

    WITH sup AS (
        SELECT c.id, public._sup_norm(coalesce(nullif(c.trading_name, ''), c.company_name)) AS n1, public._sup_norm(c.company_name) AS n2
        FROM public.contacts c
        WHERE c.deleted_at IS NULL
          AND c.contact_type IN ('nis_supplier', 'supplier', 'both', 'oil_processor', 'oil_ingredient_supplier')
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'date', o.received_date, 'name', NULLIF(btrim(o.supplier_name), ''), 'own', COALESCE(o.is_own_material, false),
               'supplier_id', (SELECT s.id FROM sup s WHERE public._sup_norm(o.supplier_name) IN (s.n1, s.n2) LIMIT 1),
               'kernel_kg', COALESCE(o.crude_kernel_kg, 0) + COALESCE(o.food_grade_kernel_kg, 0),
               'kernel_dust_kg', COALESCE(o.kernel_dust_kg, 0), 'cracker_dust_kg', COALESCE(o.cracker_dust_kg, 0))
             ORDER BY o.received_date DESC), '[]'::jsonb)
    INTO v_oil
    FROM public.oil_raw_receipts o
    WHERE o.voided_at IS NULL AND o.received_date BETWEEN p_from AND p_to;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', c.id, 'type', c.contact_type, 'number', c.supplier_number,
               'name', coalesce(nullif(c.trading_name, ''), c.company_name), 'company_name', c.company_name,
               'status', c.status, 'contact', c.primary_contact_name,
               'phone', coalesce(nullif(c.primary_contact_mobile, ''), c.primary_contact_phone),
               'email', c.primary_contact_email,
               'area', c.physical_area, 'city', c.physical_city, 'province', c.physical_province, 'country', c.physical_country,
               'lat', c.latitude, 'lng', c.longitude, 'notes', c.notes)
             ORDER BY c.supplier_number NULLS LAST, c.company_name), '[]'::jsonb)
    INTO v_dir
    FROM public.contacts c
    WHERE c.deleted_at IS NULL
      AND c.contact_type IN ('nis_supplier', 'supplier', 'both', 'oil_processor', 'oil_ingredient_supplier');

    RETURN jsonb_build_object('success', true, 'from', p_from, 'to', p_to,
                              'deliveries', v_deliveries, 'oil', v_oil, 'suppliers', v_dir);
END;
$$;

-- Save or clear a supplier's (or customer's) map pin. Both null = clear.
CREATE OR REPLACE FUNCTION public.set_contact_location(p_contact_id uuid, p_lat numeric, p_lng numeric)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF (p_lat IS NULL) <> (p_lng IS NULL) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Give both latitude and longitude, or neither.');
    END IF;
    IF p_lat IS NOT NULL AND (p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180) THEN
        RETURN jsonb_build_object('success', false, 'error', 'That is not a valid map position.');
    END IF;
    UPDATE public.contacts SET latitude = round(p_lat, 6), longitude = round(p_lng, 6), updated_at = now()
    WHERE id = p_contact_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Contact not found.');
    END IF;
    RETURN jsonb_build_object('success', true);
END;
$$;

-- ----------------------------------------------------------------------------
-- Screen, action, grants.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active)
VALUES ('suppliers', 'Suppliers',
        'Supplier performance: ranking by kg delivered and quality (SKR, USKR, moisture), oil raws received, and a map of where suppliers farm.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE f.key = 'suppliers'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

INSERT INTO public.actions (key, module, label, description) VALUES
    ('suppliers.location.edit', 'Suppliers', 'Set supplier and customer map pins',
     'Add, move or clear the GPS pin of a supplier or customer on the maps')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT DISTINCT r.id, a.id, 'true'
FROM public.actions a
CROSS JOIN public.roles r
WHERE a.key = 'suppliers.location.edit'
  AND r.role_name IN ('super_user', 'admin', 'Procurement Lead', 'Sales Exec')
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

GRANT EXECUTE ON FUNCTION public.get_supplier_performance(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_contact_location(uuid, numeric, numeric) TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', 'get_supplier_performance', 'EXECUTE', true
FROM public.roles r
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = r.id AND x.object_type = 'function' AND x.object_name = 'get_supplier_performance' AND x.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', 'set_contact_location', 'EXECUTE', true
FROM public.roles r
WHERE r.role_name IN ('super_user', 'admin', 'Procurement Lead', 'Sales Exec')
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = r.id AND x.object_type = 'function' AND x.object_name = 'set_contact_location' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
