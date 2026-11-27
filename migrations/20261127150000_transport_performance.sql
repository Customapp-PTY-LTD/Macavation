-- ============================================================================
-- Transporters > Performance & spend (Mike's MacView, 27 Nov 2026).
--
-- One read, get_transport_performance(from, to): every load in the period, built from data that
-- is already captured (same sources and cost rules as the monthly report's _report_transport_trips,
-- 20261118090000 / 20261118120000):
--   in  kernel  a grower delivery (kernel row): transporter, route (rate sheet, 20261127090000),
--               truck cost (rate_zar; R0 with no entry time = not entered), who paid, wet kg,
--               and the receiving checklist's vehicle checks
--   in  oil     a supplier delivery (oil bags grouped by delivery_group_id) with
--               oil_delivery_transport's transporter / cost and the bags' vehicle checks
--   out kernel / oil  dispatched orders that carry a transport payer (no route, no checks)
-- For an inbound load with a route, the cheapest rate on that route that was current on the load
-- date (any transporter) is returned, so the page can show "could have saved".
-- A failed vehicle check = vehicle not clean, not enclosed, hazardous substances, pests, or raw
-- materials in poor condition. ("Pallets in good condition: No" is not counted: it is also how
-- "no pallets" is captured.)
-- The page totals the loads itself and calls this twice (period + the period before).
-- Compare rates needs no new read: it is worked out from get_transport_sheet.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._vehicle_check_problems(p jsonb)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE WHEN p IS NULL OR jsonb_typeof(p) <> 'object' THEN NULL ELSE ARRAY_REMOVE(ARRAY[
        CASE WHEN p ->> 'vehicle_clean' ILIKE 'no' THEN 'Vehicle not clean' END,
        CASE WHEN p ->> 'vehicle_enclosed' ILIKE 'no' THEN 'Vehicle not enclosed' END,
        CASE WHEN p ->> 'hazard_substances' ILIKE 'yes' THEN 'Hazardous substances' END,
        CASE WHEN p ->> 'pest_infestations' ILIKE 'yes' THEN 'Pests found' END,
        CASE WHEN p ->> 'raw_materials_condition' ILIKE 'no' THEN 'Raw materials in poor condition' END
    ], NULL) END;
$$;

CREATE OR REPLACE FUNCTION public.get_transport_performance(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_loads jsonb;
BEGIN
    IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 800 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a period of up to 800 days.');
    END IF;

    WITH kin AS (
        SELECT 'in'::text AS direction, 'kernel'::text AS stream, k.received_date AS d,
               b.batch_id AS ref, k.grower_name AS who,
               NULLIF(k.intake_data #>> '{delivery,transport,transporter_id}', '')::uuid AS tid,
               NULLIF(btrim(k.intake_data #>> '{delivery,transport,transporter_name}'), '') AS tname,
               COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg) AS kg,
               CASE WHEN k.intake_data #>> '{delivery,transport,paid_by}' = 'supplier' THEN 'supplier' ELSE 'macavation' END AS payer,
               CASE WHEN k.intake_data #>> '{delivery,transport,paid_by}' = 'supplier' THEN NULL
                    WHEN (k.intake_data #>> '{delivery,transport,rate_zar}') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN NULL
                    WHEN (k.intake_data #>> '{delivery,transport,rate_entered_at}') IS NOT NULL
                         THEN (k.intake_data #>> '{delivery,transport,rate_zar}')::numeric
                    ELSE NULLIF((k.intake_data #>> '{delivery,transport,rate_zar}')::numeric, 0) END AS cost,
               NULLIF(k.intake_data #>> '{delivery,transport,route_id}', '')::uuid AS route_id,
               k.intake_data -> 'receiving_checklist' AS checks
        FROM public.kernel k
        LEFT JOIN public.batches b ON b.id = k.batch_id
        WHERE k.is_active AND (k.intake_data #> '{delivery,transport}') IS NOT NULL
          AND k.received_date BETWEEN p_from AND p_to
        LIMIT 5000
    ), oin AS (
        SELECT 'in'::text, 'oil'::text, g.d, NULL::text, g.who,
               t.transporter_id, NULLIF(btrim(t.transporter_name), ''), g.kg,
               COALESCE(t.transport_payer, 'macavation'),
               CASE WHEN t.transport_payer = 'supplier' THEN NULL ELSE t.cost_zar END,
               NULL::uuid, g.checks
        FROM (
            SELECT o.intake_data ->> 'delivery_group_id' AS gid,
                   min((o.intake_data ->> 'date_received')::date) AS d,
                   min(COALESCE(o.intake_data ->> 'supplier_name', o.intake_data ->> 'supplier')) AS who,
                   sum(CASE WHEN (o.intake_data ->> 'quantity_kg') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                            THEN (o.intake_data ->> 'quantity_kg')::numeric END) AS kg,
                   (array_agg(o.intake_data -> 'vehicle_checks') FILTER (WHERE jsonb_typeof(o.intake_data -> 'vehicle_checks') = 'object'))[1] AS checks
            FROM public.oil o
            WHERE COALESCE(o.is_active, true)
              AND (o.intake_data ->> 'delivery_group_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              AND (o.intake_data ->> 'date_received') ~ '^\d{4}-\d{2}-\d{2}'
              AND COALESCE((o.intake_data ->> 'from_adjust_stock')::boolean, false) = false
            GROUP BY 1
        ) g
        LEFT JOIN public.oil_delivery_transport t ON t.delivery_group_id = g.gid::uuid
        WHERE g.d BETWEEN p_from AND p_to
        LIMIT 5000
    ), outs AS (
        SELECT 'out'::text, x.stream, x.trip_date, NULL::text, NULL::text, NULL::uuid,
               NULLIF(x.transporter, 'Transporter not recorded'), x.kg, x.payer,
               CASE WHEN x.payer = 'customer' THEN NULL ELSE x.cost_zar END, NULL::uuid, NULL::jsonb
        FROM public._report_transport_trips(p_from, p_to) x
        WHERE x.direction = 'out'
        LIMIT 5000
    ), allx AS (
        SELECT * FROM kin UNION ALL SELECT * FROM oin UNION ALL SELECT * FROM outs
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'direction', a.direction, 'stream', a.stream, 'date', a.d, 'ref', a.ref, 'who', a.who,
               'transporter_id', COALESCE(tr.id, a.tid),
               'transporter', COALESCE(tr.name, a.tname),
               'kg', a.kg, 'payer', a.payer, 'cost', a.cost,
               'route_id', ro.id, 'route_code', ro.code, 'route_km', ro.km,
               'checked', public._vehicle_check_problems(a.checks) IS NOT NULL
                          AND (a.checks ? 'vehicle_clean' OR a.checks ? 'pest_infestations'),
               'problems', to_jsonb(COALESCE(public._vehicle_check_problems(a.checks), '{}')),
               'cheapest', ch.rate_zar, 'cheapest_transporter', ch.tname
           ) ORDER BY a.d), '[]'::jsonb)
    INTO v_loads
    FROM allx a
    LEFT JOIN public.transporters tr ON tr.id = a.tid
                                     OR (a.tid IS NULL AND a.tname IS NOT NULL AND lower(tr.name) = lower(a.tname))
    LEFT JOIN public.transport_routes ro ON ro.id = a.route_id
    LEFT JOIN LATERAL (
        SELECT r.rate_zar, t2.name AS tname
        FROM public.transport_rates r JOIN public.transporters t2 ON t2.id = r.transporter_id
        WHERE r.is_active AND r.route_id = a.route_id AND a.d IS NOT NULL
          AND r.valid_from <= a.d AND (r.valid_to IS NULL OR r.valid_to >= a.d)
        ORDER BY r.rate_zar LIMIT 1
    ) ch ON true;

    RETURN jsonb_build_object('success', true, 'from', p_from, 'to', p_to, 'loads', v_loads);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_transport_performance(date, date) TO anon, authenticated, service_role;

-- Same roles that can read the rate sheet.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', 'get_transport_performance', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'get_transport_sheet' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = 'get_transport_performance' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
