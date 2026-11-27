-- ============================================================================
-- Company calendar (Mike's MacView, 27 Nov 2026).
--
-- WHY. Public holidays and shutdowns only existed as days typed by hand on the Procurement plan
-- (procurement_day_types), and the lab "working days" count (Kernel Pipeline Settings) said
-- "Public holidays are not taken out". MacView has one company calendar for all of it.
--
-- Henry's decisions (27 Nov 2026):
--   * ONE day list. The Calendar screen reads and writes procurement_day_types through the same
--     set_procurement_days RPC the Procurement plan uses. Nothing is copied or removed.
--     Kinds: Shutdown = 'shutdown', Working day = 'work', Half day = 'half',
--     Extra holiday / closed = 'holiday', Company date / event = 'default' + note (the note is the
--     title; the day's normal rule still applies). 'off' and 'nocrack' from the plan show as they are.
--   * Expected deliveries ARE the Procurement plan's planned trucks (kernel_intake_procurement).
--     This adds bags, transporter and planned collection date to them; they already link to the
--     delivery once booked in (batch_id).
--
-- What this adds:
--   sa_easter(year), sa_public_holidays(from, to)   South African public holidays, worked out:
--                       fixed dates, Good Friday and Family Day from Easter, and a holiday on a
--                       Sunday observed on the Monday. (Same rule as WebPortal/js/sa-holidays.js.)
--   company_calendar_days(from, to)  one row per day: working-day value, kind, label
--                       weekday 1, weekend 0, public holiday / shutdown / extra holiday / closed 0,
--                       working day 1, half day 0.5. A day typed on the calendar beats the rule.
--   company_working_days(from, to)   the sum, for anyone who needs "working days between"
--   get_company_calendar(from, to)   the Calendar screen: days + planned trucks
--   kernel_intake_procurement         bags, transporter_id, collection_date
--   set_procurement_truck_details(ids, bags, transporter, collection date)
--   get_procurement_plan               also returns those three per truck (same signature)
--   kernel_lab_days_elapsed / kernel_lab_due_on   'working' days now come from the company
--                       calendar, so public holidays and shutdowns are taken out of lab days
--   screen  feature 'company-calendar' (Home > Calendar) for every role
--   action  company_calendar.edit for super_user, admin and roles that can edit the procurement plan
--
-- Idempotent. Needs 20261028090100 (procurement plan), 20261111090000 (lab days) and
-- 20261127090000 (transporters columns are not needed, only the table, which is older).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Public holidays.
-- ----------------------------------------------------------------------------
-- Easter Sunday (Anonymous Gregorian algorithm).
CREATE OR REPLACE FUNCTION public.sa_easter(p_year integer)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
    a int := p_year % 19; b int := p_year / 100; c int := p_year % 100;
    d int; e int; f int; g int; h int; i int; k int; l int; m int; mon int; dy int;
BEGIN
    d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
    h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4;
    l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
    mon := (h + l - 7 * m + 114) / 31; dy := ((h + l - 7 * m + 114) % 31) + 1;
    RETURN make_date(p_year, mon, dy);
END;
$$;

CREATE OR REPLACE FUNCTION public.sa_public_holidays(p_from date, p_to date)
RETURNS TABLE (day date, name text)
LANGUAGE sql IMMUTABLE
AS $$
    WITH years AS (
        SELECT generate_series(extract(year FROM p_from)::int, extract(year FROM p_to)::int) AS y
    ), base AS (
        SELECT make_date(y, m, d) AS day, n AS name
        FROM years CROSS JOIN (VALUES
            (1, 1, 'New Year''s Day'), (3, 21, 'Human Rights Day'), (4, 27, 'Freedom Day'),
            (5, 1, 'Workers'' Day'), (6, 16, 'Youth Day'), (8, 9, 'National Women''s Day'),
            (9, 24, 'Heritage Day'), (12, 16, 'Day of Reconciliation'), (12, 25, 'Christmas Day'),
            (12, 26, 'Day of Goodwill')) AS f(m, d, n)
        UNION ALL SELECT public.sa_easter(y) - 2, 'Good Friday' FROM years
        UNION ALL SELECT public.sa_easter(y) + 1, 'Family Day' FROM years
    ), observed AS (
        SELECT day, name FROM base
        UNION ALL
        SELECT day + 1, name || ' (observed)' FROM base WHERE extract(isodow FROM day) = 7
    )
    SELECT day, name FROM observed WHERE day BETWEEN p_from AND p_to ORDER BY day;
$$;

-- ----------------------------------------------------------------------------
-- One row per day with its working-day value.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_calendar_days(p_from date, p_to date)
RETURNS TABLE (day date, value numeric, kind text, label text, day_type text, note text, holiday text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH days AS (
        SELECT g::date AS day FROM generate_series(p_from, LEAST(p_to, p_from + 800), interval '1 day') g
    ), hol AS (
        SELECT h.day, string_agg(h.name, ' / ') AS name FROM public.sa_public_holidays(p_from, p_to) h GROUP BY h.day
    )
    SELECT d.day,
           CASE
               WHEN t.day_type = 'work' THEN 1
               WHEN t.day_type = 'half' THEN 0.5
               WHEN t.day_type IN ('off', 'shutdown', 'holiday') THEN 0
               WHEN h.day IS NOT NULL THEN 0
               WHEN extract(isodow FROM d.day) >= 6 THEN 0
               ELSE 1
           END::numeric AS value,
           CASE
               WHEN t.day_type = 'work' THEN 'working_day'
               WHEN t.day_type = 'half' THEN 'half_day'
               WHEN t.day_type = 'off' THEN 'closed'
               WHEN t.day_type = 'shutdown' THEN 'shutdown'
               WHEN t.day_type = 'holiday' THEN 'company_holiday'
               WHEN t.day_type = 'nocrack' THEN 'no_cracking'
               WHEN h.day IS NOT NULL THEN 'public_holiday'
               WHEN extract(isodow FROM d.day) >= 6 THEN 'weekend'
               ELSE 'workday'
           END AS kind,
           COALESCE(NULLIF(btrim(t.note), ''), h.name,
               CASE t.day_type WHEN 'work' THEN 'Working day' WHEN 'half' THEN 'Half day' WHEN 'off' THEN 'Closed'
                               WHEN 'shutdown' THEN 'Shutdown' WHEN 'holiday' THEN 'Extra holiday'
                               WHEN 'nocrack' THEN 'No cracking' END) AS label,
           t.day_type, t.note, h.name AS holiday
    FROM days d
    LEFT JOIN hol h ON h.day = d.day
    LEFT JOIN public.procurement_day_types t ON t.day = d.day
    ORDER BY d.day;
$$;

-- Working days from p_from to p_to, both included (half days count 0.5).
CREATE OR REPLACE FUNCTION public.company_working_days(p_from date, p_to date)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(sum(value), 0) FROM public.company_calendar_days(p_from, p_to);
$$;

-- ----------------------------------------------------------------------------
-- Expected deliveries = planned trucks: bags, transporter, collection date.
-- ----------------------------------------------------------------------------
ALTER TABLE public.kernel_intake_procurement
    ADD COLUMN IF NOT EXISTS bags            integer,
    ADD COLUMN IF NOT EXISTS transporter_id  uuid REFERENCES public.transporters(id),
    ADD COLUMN IF NOT EXISTS collection_date date;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kip_bags_check') THEN
        ALTER TABLE public.kernel_intake_procurement ADD CONSTRAINT kip_bags_check CHECK (bags IS NULL OR bags > 0);
    END IF;
END $$;

-- Called right after save_procurement_delivery with the ids it returned (a repeated truck gets
-- the same details on every copy). Only trucks not yet received or cancelled change.
CREATE OR REPLACE FUNCTION public.set_procurement_truck_details(
    p_ids uuid[], p_bags integer, p_transporter_id uuid, p_collection_date date, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_n integer;
BEGIN
    IF p_bags IS NOT NULL AND p_bags < 1 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Bags must be 1 or more, or blank.');
    END IF;
    IF p_transporter_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.transporters WHERE id = p_transporter_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unknown transporter.');
    END IF;
    UPDATE public.kernel_intake_procurement
       SET bags = p_bags, transporter_id = p_transporter_id, collection_date = p_collection_date,
           updated_by = COALESCE(p_user_id, updated_by), updated_at = now()
     WHERE id = ANY (COALESCE(p_ids, '{}')) AND status NOT IN ('converted', 'cancelled');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'trucks', v_n);
END;
$$;

-- Same as 20261028090100 / later, plus bags, transporter and collection date per truck.
CREATE OR REPLACE FUNCTION public.get_procurement_plan(p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_today     date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
    v_from      date;
    v_to        date;
    v_settings  jsonb;
    v_fc        jsonb := '{}'::jsonb;
    v_pool      numeric;
    v_actual    numeric;
    v_actual_n  integer;
    v_deliv     jsonb;
    v_days      jsonb;
    v_growers   jsonb;
    v_areas     jsonb;
BEGIN
    v_from := COALESCE(p_from, v_today - 90);
    v_to   := COALESCE(p_to, v_today + 450);
    IF v_to < v_from OR v_to - v_from > 900 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a date range of up to 900 days.');
    END IF;

    v_settings := jsonb_build_object('planned_kg_per_day', 5000, 'opening_mode', 'system')
                  || COALESCE((SELECT value FROM public.kernel_pipeline_settings WHERE key = 'procurement_plan'), '{}'::jsonb);

    BEGIN
        v_fc := public.get_nis_runway_forecast(60, NULL, NULL, 1, false);
    EXCEPTION WHEN OTHERS THEN
        v_fc := '{}'::jsonb;
    END;
    v_pool := (v_fc->'meta'->>'pool_kg')::numeric;

    SELECT AVG(c), COUNT(*) INTO v_actual, v_actual_n
    FROM (
        SELECT (p->>'cracked_kg')::numeric AS c
        FROM jsonb_array_elements(COALESCE(v_fc->'points', '[]'::jsonb)) p
        WHERE COALESCE((p->>'is_forecast')::boolean, false) = false
          AND COALESCE((p->>'cracked_kg')::numeric, 0) > 0
        ORDER BY (p->>'d')::date DESC
        LIMIT 30
    ) x;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'id', p.id,
               'scheduled_date', p.scheduled_date,
               'supplier_id', p.supplier_id,
               'grower_name', p.grower_name,
               'grower', COALESCE(NULLIF(trim(p.grower_name), ''), c.company_name, c.trading_name, 'Grower'),
               'truck_label', p.truck_label,
               'predicted_weight_kg', p.predicted_weight_kg,
               'status', CASE WHEN p.status = 'converted' THEN 'received'
                              WHEN p.is_confirmed THEN 'confirmed' ELSE 'planned' END,
               'storage_area_code', p.storage_area_code,
               'note', p.note,
               'bags', p.bags,
               'transporter_id', p.transporter_id,
               'transporter_name', tr.name,
               'collection_date', p.collection_date,
               'batch_number', b.batch_id,
               'received_kg', COALESCE(k.actual_wet_nis_kg, k.wet_nis_received_kg),
               'received_date', k.received_date,
               'sort_index', p.sort_index
           ) ORDER BY p.scheduled_date, p.sort_index NULLS LAST, p.created_at), '[]'::jsonb)
    INTO v_deliv
    FROM public.kernel_intake_procurement p
    LEFT JOIN public.contacts c ON c.id = p.supplier_id
    LEFT JOIN public.transporters tr ON tr.id = p.transporter_id
    LEFT JOIN public.batches  b ON b.id = p.batch_id
    LEFT JOIN public.kernel   k ON k.batch_id = p.batch_id
    WHERE p.status <> 'cancelled'
      AND p.scheduled_date BETWEEN v_from AND v_to;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d.day, 'day_type', d.day_type,
               'kg_override', d.kg_override, 'note', d.note) ORDER BY d.day), '[]'::jsonb)
    INTO v_days
    FROM public.procurement_day_types d
    WHERE d.day BETWEEN v_from AND v_to
      AND d.day_type <> 'default';

    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) ORDER BY g.name), '[]'::jsonb)
    INTO v_growers
    FROM (
        SELECT c.id, COALESCE(NULLIF(trim(c.company_name), ''), c.trading_name, c.primary_contact_name) AS name
        FROM public.contacts c
        WHERE c.contact_type IN ('nis_supplier', 'supplier', 'both')
        LIMIT 500
    ) g
    WHERE g.name IS NOT NULL;

    SELECT COALESCE(jsonb_agg(jsonb_build_object('code', a.code, 'label', a.label) ORDER BY a.display_order), '[]'::jsonb)
    INTO v_areas
    FROM public.nis_storage_areas a WHERE a.is_active;

    RETURN jsonb_build_object(
        'success', true,
        'today', v_today,
        'from', v_from,
        'to', v_to,
        'settings', v_settings,
        'system_pool_kg', v_pool,
        'actual_kg_per_day', CASE WHEN v_actual_n >= 5 THEN ROUND(v_actual, 0) END,
        'actual_days_used', v_actual_n,
        'deliveries', v_deliv,
        'day_types', v_days,
        'growers', v_growers,
        'areas', v_areas,
        'transporters', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
                                  FROM public.transporters t WHERE t.is_active), '[]'::jsonb)
    );
END;
$function$;

-- ----------------------------------------------------------------------------
-- The Calendar screen.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_company_calendar(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_from date := COALESCE(p_from, public._sast_today() - 7);
    v_to   date := COALESCE(p_to, public._sast_today() + 60);
BEGIN
    IF v_to < v_from OR v_to - v_from > 400 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Choose a range of up to 400 days.');
    END IF;
    RETURN jsonb_build_object(
        'success', true,
        'today', public._sast_today(),
        'from', v_from, 'to', v_to,
        'days', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'day', c.day, 'value', c.value, 'kind', c.kind, 'label', c.label,
                    'day_type', c.day_type, 'note', c.note, 'holiday', c.holiday) ORDER BY c.day)
                FROM public.company_calendar_days(v_from, v_to) c), '[]'::jsonb),
        'deliveries', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'id', p.id, 'scheduled_date', p.scheduled_date, 'collection_date', p.collection_date,
                    'grower', COALESCE(NULLIF(trim(p.grower_name), ''), ct.company_name, ct.trading_name, 'Grower'),
                    'predicted_weight_kg', p.predicted_weight_kg, 'bags', p.bags,
                    'transporter_name', tr.name, 'truck_label', p.truck_label,
                    'confirmed', p.is_confirmed, 'note', p.note,
                    'status', CASE WHEN p.status = 'converted' THEN 'received' WHEN p.is_confirmed THEN 'confirmed' ELSE 'planned' END,
                    'batch_number', b.batch_id, 'kernel_id', k.id)
                    ORDER BY p.scheduled_date, p.sort_index NULLS LAST, p.created_at)
                FROM (SELECT * FROM public.kernel_intake_procurement
                      WHERE status <> 'cancelled' AND scheduled_date BETWEEN v_from AND v_to
                      ORDER BY scheduled_date LIMIT 1000) p
                LEFT JOIN public.contacts ct ON ct.id = p.supplier_id
                LEFT JOIN public.transporters tr ON tr.id = p.transporter_id
                LEFT JOIN public.batches b ON b.id = p.batch_id
                LEFT JOIN public.kernel k ON k.batch_id = p.batch_id), '[]'::jsonb)
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- Lab days: 'working' now means a company working day (holidays and shutdowns taken out;
-- a half day still counts as a day the lab can work). Calendar days are unchanged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.kernel_lab_days_elapsed(p_from date, p_count text)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE
        WHEN p_from IS NULL THEN NULL
        WHEN p_count = 'calendar' THEN GREATEST(0, ((now() AT TIME ZONE 'Africa/Johannesburg')::date - p_from))
        WHEN p_from >= (now() AT TIME ZONE 'Africa/Johannesburg')::date THEN 0
        ELSE (SELECT count(*)::int FROM public.company_calendar_days(p_from + 1, (now() AT TIME ZONE 'Africa/Johannesburg')::date) c
              WHERE c.value > 0)
    END;
$function$;

CREATE OR REPLACE FUNCTION public.kernel_lab_due_on(p_from date, p_days integer, p_count text)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT CASE
        WHEN p_from IS NULL OR p_days IS NULL OR p_days < 1 THEN NULL
        WHEN p_count = 'calendar' THEN p_from + p_days
        ELSE (SELECT c.day FROM public.company_calendar_days(p_from + 1, p_from + p_days * 2 + 40) c
              WHERE c.value > 0 ORDER BY c.day OFFSET p_days - 1 LIMIT 1)
    END;
$function$;

-- ----------------------------------------------------------------------------
-- Screen, action, grants.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active)
VALUES ('company-calendar', 'Calendar',
        'Company calendar: public holidays, shutdowns, working Saturdays, half days, company dates and expected deliveries.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r CROSS JOIN public.features f
WHERE f.key = 'company-calendar'
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

INSERT INTO public.actions (key, module, label, description) VALUES
    ('company_calendar.edit', 'Calendar', 'Add and remove calendar days',
     'Add or remove shutdowns, working Saturdays, half days, extra holidays and company dates on the company calendar')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT DISTINCT r.id, a.id, 'true'
FROM public.actions a
CROSS JOIN public.roles r
WHERE a.key = 'company_calendar.edit'
  AND (r.role_name IN ('super_user', 'admin')
       OR r.id IN (SELECT ra.role_id FROM public.role_actions ra JOIN public.actions a2 ON a2.id = ra.action_id
                   WHERE a2.key = 'procurement.plan.edit' AND ra.value::text IN ('true', '"true"')))
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

GRANT EXECUTE ON FUNCTION public.company_calendar_days(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sa_public_holidays(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.company_working_days(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_company_calendar(date, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_procurement_truck_details(uuid[], integer, uuid, date, uuid) TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY['get_company_calendar', 'company_working_days', 'sa_public_holidays']) AS fn
WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions x
                  WHERE x.role_id = r.id AND x.object_type = 'function' AND x.object_name = fn AND x.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', 'set_procurement_truck_details', 'EXECUTE', true
FROM public.role_permissions rp
WHERE rp.object_type = 'function' AND rp.object_name = 'save_procurement_delivery' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = 'set_procurement_truck_details' AND x.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
