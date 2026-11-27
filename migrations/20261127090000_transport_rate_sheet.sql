-- ============================================================================
-- Transport rate sheet and transporter documents (Mike's MacView, 27 Nov 2026).
--
-- WHY. The transport rate for a delivery is typed in by hand (My Day "Enter transport rate" task,
-- or the delivery on Find a batch). Nothing records what each transporter charges per route, how
-- long a quote is valid, or when a transporter's goods-in-transit insurance / B-BBEE certificate
-- runs out. MacView keeps all three; this brings them into the portal.
--
-- What this adds:
--   transporters        status, base, truck types, VAT no., two contacts, GIT insurer / cover /
--                       expiry, B-BBEE level / expiry, documents (files), notes.
--                       is_active stays (every existing picker reads it) and follows status:
--                       Inactive <-> is_active = false. No banking fields (ask Henry first).
--   transport_routes    unique code (HAZ-HOW, upper-cased), origin, destination (Howick), km, notes
--   transport_rates     transporter + route + rate per load (R excl. VAT) + valid from / to
--                       (blank to = open-ended). One rate per transporter + route + valid-from.
--   get_transport_sheet()                    everything the Transporters page and the rate pickers need
--   save_transporter / save_transport_route / save_transport_rate
--   set_transport_rate_from_route(...)       the delivery's rate WITH the route it was taken from.
--                       Not a second place to type a rate: it is the same My Day task / Find a batch
--                       box, which now also picks the route. It stores route + sheet rate on the
--                       delivery, insists on a reason when the cost differs from the sheet, then hands
--                       over to set_transport_rate (which closes the task as before).
--   tasks               transport_rate_expiring     rates expired or ending within 14 days, one task
--                                                   per transporter (a rate already replaced by a
--                                                   newer one for the same transporter + route is ignored)
--                       transporter_docs_expiring   GIT or B-BBEE expired or ending within 30 days
--                       Both are Role Features switches (task-<kind>), on for Procurement Lead and
--                       Palladium Manager. Checked on every change and daily at 05:35 SAST.
--   screen              feature 'transporters' (menu: Kernel > Transporters) for every role with
--                       Kernel Pipeline Settings, plus Palladium Manager (who enters the rates).
--   action              transport_rates.edit (buttons) for roles that can edit pipeline settings,
--                       plus Palladium Manager.
--
-- Idempotent. Needs 20261027130000 + 20261027140000 + 20261028120000 (task plumbing) first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Transporter details.
-- ----------------------------------------------------------------------------
ALTER TABLE public.transporters
    ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'active',
    ADD COLUMN IF NOT EXISTS base            text,
    ADD COLUMN IF NOT EXISTS truck_types     text,
    ADD COLUMN IF NOT EXISTS vat_no          text,
    ADD COLUMN IF NOT EXISTS contact_name    text,
    ADD COLUMN IF NOT EXISTS contact_cell    text,
    ADD COLUMN IF NOT EXISTS contact_email   text,
    ADD COLUMN IF NOT EXISTS contact2_name   text,
    ADD COLUMN IF NOT EXISTS contact2_cell   text,
    ADD COLUMN IF NOT EXISTS contact2_email  text,
    ADD COLUMN IF NOT EXISTS git_insurer     text,
    ADD COLUMN IF NOT EXISTS git_cover_zar   numeric(14,2),
    ADD COLUMN IF NOT EXISTS git_expiry      date,
    ADD COLUMN IF NOT EXISTS bbbee_level     text,
    ADD COLUMN IF NOT EXISTS bbbee_expiry    date,
    ADD COLUMN IF NOT EXISTS documents       jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS notes           text;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transporters_status_check') THEN
        ALTER TABLE public.transporters ADD CONSTRAINT transporters_status_check
            CHECK (status IN ('active', 'approved_not_used', 'on_hold', 'inactive'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transporters_git_cover_check') THEN
        ALTER TABLE public.transporters ADD CONSTRAINT transporters_git_cover_check
            CHECK (git_cover_zar IS NULL OR git_cover_zar >= 0);
    END IF;
END $$;

UPDATE public.transporters SET status = 'inactive' WHERE NOT is_active AND status <> 'inactive';

-- status and is_active move together, whichever one a screen changes (Kernel Pipeline Settings
-- still flips is_active; the Transporters page sets status).
CREATE OR REPLACE FUNCTION public._transporter_status_sync()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
        NEW.is_active := NEW.status <> 'inactive';
    ELSIF TG_OP = 'UPDATE' AND NEW.is_active IS DISTINCT FROM OLD.is_active THEN
        NEW.status := CASE WHEN NOT NEW.is_active THEN 'inactive'
                           WHEN NEW.status = 'inactive' THEN 'active' ELSE NEW.status END;
    ELSIF TG_OP = 'INSERT' THEN
        IF NOT COALESCE(NEW.is_active, true) THEN NEW.status := 'inactive'; END IF;
        NEW.is_active := NEW.status <> 'inactive';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER transporter_status_sync
    BEFORE INSERT OR UPDATE OF status, is_active ON public.transporters
    FOR EACH ROW EXECUTE FUNCTION public._transporter_status_sync();

-- ----------------------------------------------------------------------------
-- Routes and rates.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transport_routes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code         text NOT NULL CHECK (code = upper(btrim(code)) AND length(code) BETWEEN 1 AND 30),
    origin       text NOT NULL CHECK (length(btrim(origin)) > 0),
    destination  text NOT NULL DEFAULT 'Howick',
    km           numeric(8,1) CHECK (km IS NULL OR km > 0),
    notes        text,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_routes_code ON public.transport_routes (code);

CREATE TABLE IF NOT EXISTS public.transport_rates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    transporter_id  uuid NOT NULL REFERENCES public.transporters(id),
    route_id        uuid NOT NULL REFERENCES public.transport_routes(id),
    rate_zar        numeric(12,2) NOT NULL CHECK (rate_zar >= 0),
    valid_from      date NOT NULL,
    valid_to        date,
    notes           text,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    updated_by      uuid,
    CONSTRAINT transport_rates_dates_check CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
-- Mike: block a second rate for the same transporter + route + valid-from (removed rows don't count).
CREATE UNIQUE INDEX IF NOT EXISTS idx_transport_rates_unique_start
    ON public.transport_rates (transporter_id, route_id, valid_from) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_transport_rates_route ON public.transport_rates (route_id) WHERE is_active;

-- Only reached through the SECURITY DEFINER functions below (same as every portal table read by RPC).
ALTER TABLE public.transport_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transport_rates  ENABLE ROW LEVEL SECURITY;

-- A rate is Current on day d when valid_from <= d and (valid_to is blank or >= d).
CREATE OR REPLACE FUNCTION public._transport_rate_status(p_from date, p_to date, p_on date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE WHEN p_from > p_on THEN 'future'
                WHEN p_to IS NOT NULL AND p_to < p_on THEN 'expired'
                ELSE 'current' END;
$$;

-- ----------------------------------------------------------------------------
-- Read: the whole sheet (a few dozen rows; small on purpose, every list is LIMITed).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_transport_sheet()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    WITH d AS (SELECT public._sast_today() AS today),
    rates AS (
        SELECT r.*, t.name AS transporter_name, ro.code AS route_code, ro.km,
               public._transport_rate_status(r.valid_from, r.valid_to, (SELECT today FROM d)) AS rate_status
        FROM public.transport_rates r
        JOIN public.transporters t ON t.id = r.transporter_id
        JOIN public.transport_routes ro ON ro.id = r.route_id
        WHERE r.is_active
        ORDER BY t.name, ro.code, r.valid_from DESC
        LIMIT 2000
    )
    SELECT jsonb_build_object(
        'success', true,
        'today', (SELECT today FROM d),
        'transporters', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', t.id, 'name', t.name, 'is_active', t.is_active, 'status', t.status,
                'base', t.base, 'truck_types', t.truck_types, 'vat_no', t.vat_no,
                'contact_name', t.contact_name, 'contact_cell', t.contact_cell, 'contact_email', t.contact_email,
                'contact2_name', t.contact2_name, 'contact2_cell', t.contact2_cell, 'contact2_email', t.contact2_email,
                'git_insurer', t.git_insurer, 'git_cover_zar', t.git_cover_zar, 'git_expiry', t.git_expiry,
                'bbbee_level', t.bbbee_level, 'bbbee_expiry', t.bbbee_expiry,
                'documents', t.documents, 'notes', t.notes,
                'current_rates', (SELECT count(*) FROM rates x WHERE x.transporter_id = t.id AND x.rate_status = 'current'))
                ORDER BY t.is_active DESC, lower(t.name))
            FROM (SELECT * FROM public.transporters ORDER BY name LIMIT 500) t), '[]'::jsonb),
        'routes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', ro.id, 'code', ro.code, 'origin', ro.origin, 'destination', ro.destination,
                'km', ro.km, 'notes', ro.notes, 'is_active', ro.is_active,
                'current_rates', (SELECT count(*) FROM rates x WHERE x.route_id = ro.id AND x.rate_status = 'current'))
                ORDER BY ro.is_active DESC, ro.code)
            FROM (SELECT * FROM public.transport_routes ORDER BY code LIMIT 500) ro), '[]'::jsonb),
        'rates', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'id', x.id, 'transporter_id', x.transporter_id, 'transporter_name', x.transporter_name,
                'route_id', x.route_id, 'route_code', x.route_code, 'rate_zar', x.rate_zar,
                'valid_from', x.valid_from, 'valid_to', x.valid_to, 'notes', x.notes,
                'status', x.rate_status,
                'per_km', CASE WHEN x.km > 0 THEN round(x.rate_zar / x.km, 2) END))
                ORDER BY x.transporter_name, x.route_code, x.valid_from DESC)
            FROM rates x), '[]'::jsonb)
    );
$$;

-- ----------------------------------------------------------------------------
-- Writes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._blank_null(p text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT NULLIF(btrim(p), ''); $$;

-- p_data keys: name, status, base, truck_types, vat_no, contact_name, contact_cell, contact_email,
-- contact2_name, contact2_cell, contact2_email, git_insurer, git_cover_zar, git_expiry, bbbee_level,
-- bbbee_expiry, documents [{file_id, file_link, name}], notes. p_id null = add.
CREATE OR REPLACE FUNCTION public.save_transporter(p_id uuid, p_data jsonb, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id     uuid;
    v_name   text := public._blank_null(p_data ->> 'name');
    v_status text := COALESCE(public._blank_null(p_data ->> 'status'), 'active');
    v_docs   jsonb := COALESCE(p_data -> 'documents', '[]'::jsonb);
    v_cover  numeric;
BEGIN
    IF v_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the company name.');
    END IF;
    IF v_status NOT IN ('active', 'approved_not_used', 'on_hold', 'inactive') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pick a status.');
    END IF;
    IF jsonb_typeof(v_docs) <> 'array' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Documents must be a list.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.transporters
               WHERE lower(btrim(name)) = lower(v_name) AND id IS DISTINCT FROM p_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'There is already a transporter with that name.');
    END IF;
    BEGIN
        v_cover := NULLIF(p_data ->> 'git_cover_zar', '')::numeric;
    EXCEPTION WHEN others THEN
        RETURN jsonb_build_object('success', false, 'error', 'GIT cover per load must be a number.');
    END;

    IF p_id IS NULL THEN
        INSERT INTO public.transporters (name, status, created_by, updated_by)
        VALUES (v_name, v_status, p_user_id, p_user_id)
        RETURNING id INTO v_id;
    ELSE
        v_id := p_id;
        IF NOT EXISTS (SELECT 1 FROM public.transporters WHERE id = v_id) THEN
            RETURN jsonb_build_object('success', false, 'error', 'Transporter not found.');
        END IF;
    END IF;

    UPDATE public.transporters SET
        name = v_name, status = v_status,
        base = public._blank_null(p_data ->> 'base'),
        truck_types = public._blank_null(p_data ->> 'truck_types'),
        vat_no = public._blank_null(p_data ->> 'vat_no'),
        contact_name = public._blank_null(p_data ->> 'contact_name'),
        contact_cell = public._blank_null(p_data ->> 'contact_cell'),
        contact_email = public._blank_null(p_data ->> 'contact_email'),
        contact2_name = public._blank_null(p_data ->> 'contact2_name'),
        contact2_cell = public._blank_null(p_data ->> 'contact2_cell'),
        contact2_email = public._blank_null(p_data ->> 'contact2_email'),
        git_insurer = public._blank_null(p_data ->> 'git_insurer'),
        git_cover_zar = v_cover,
        git_expiry = NULLIF(p_data ->> 'git_expiry', '')::date,
        bbbee_level = public._blank_null(p_data ->> 'bbbee_level'),
        bbbee_expiry = NULLIF(p_data ->> 'bbbee_expiry', '')::date,
        documents = v_docs,
        notes = public._blank_null(p_data ->> 'notes'),
        updated_at = now(), updated_by = p_user_id
    WHERE id = v_id;

    RETURN jsonb_build_object('success', true, 'id', v_id);
EXCEPTION
    WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RETURN jsonb_build_object('success', false, 'error', 'Check the expiry dates.');
    WHEN check_violation THEN
        RETURN jsonb_build_object('success', false, 'error', 'GIT cover per load cannot be negative.');
END;
$$;

CREATE OR REPLACE FUNCTION public.save_transport_route(
    p_id uuid, p_code text, p_origin text, p_destination text, p_km numeric, p_notes text,
    p_is_active boolean DEFAULT true, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id   uuid;
    v_code text := upper(regexp_replace(btrim(COALESCE(p_code, '')), '\s+', '-', 'g'));
BEGIN
    IF v_code = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter a route code, e.g. HAZ-HOW.');
    END IF;
    IF length(v_code) > 30 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Keep the route code to 30 letters or fewer.');
    END IF;
    IF public._blank_null(p_origin) IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter where the route collects from.');
    END IF;
    IF p_km IS NOT NULL AND p_km <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Distance must be more than 0 km, or blank.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.transport_routes WHERE code = v_code AND id IS DISTINCT FROM p_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'That route code already exists.');
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.transport_routes (code, origin, destination, km, notes, is_active, created_by, updated_by)
        VALUES (v_code, btrim(p_origin), COALESCE(public._blank_null(p_destination), 'Howick'), p_km,
                public._blank_null(p_notes), COALESCE(p_is_active, true), p_user_id, p_user_id)
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.transport_routes SET
            code = v_code, origin = btrim(p_origin),
            destination = COALESCE(public._blank_null(p_destination), 'Howick'),
            km = p_km, notes = public._blank_null(p_notes), is_active = COALESCE(p_is_active, true),
            updated_at = now(), updated_by = p_user_id
        WHERE id = p_id RETURNING id INTO v_id;
        IF v_id IS NULL THEN
            RETURN jsonb_build_object('success', false, 'error', 'Route not found.');
        END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id, 'code', v_code);
END;
$$;

-- p_is_active = false removes the rate (kept for history).
CREATE OR REPLACE FUNCTION public.save_transport_rate(
    p_id uuid, p_transporter_id uuid, p_route_id uuid, p_rate_zar numeric,
    p_valid_from date, p_valid_to date, p_notes text,
    p_is_active boolean DEFAULT true, p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_id   uuid;
    v_from date := COALESCE(p_valid_from, public._sast_today());
BEGIN
    IF p_id IS NOT NULL AND p_is_active IS FALSE THEN
        UPDATE public.transport_rates SET is_active = false, updated_at = now(), updated_by = p_user_id
        WHERE id = p_id RETURNING id INTO v_id;
        IF v_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Rate not found.'); END IF;
        RETURN jsonb_build_object('success', true, 'id', v_id, 'removed', true);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.transporters WHERE id = p_transporter_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pick the transporter.');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.transport_routes WHERE id = p_route_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Pick the route.');
    END IF;
    IF p_rate_zar IS NULL OR p_rate_zar < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the rate per load (0 or more).');
    END IF;
    IF p_valid_to IS NOT NULL AND p_valid_to < v_from THEN
        RETURN jsonb_build_object('success', false, 'error', 'Valid to must be on or after valid from.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.transport_rates
               WHERE is_active AND transporter_id = p_transporter_id AND route_id = p_route_id
                 AND valid_from = v_from AND id IS DISTINCT FROM p_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'There is already a rate for this transporter and route from that date.');
    END IF;

    IF p_id IS NULL THEN
        INSERT INTO public.transport_rates (transporter_id, route_id, rate_zar, valid_from, valid_to, notes, created_by, updated_by)
        VALUES (p_transporter_id, p_route_id, round(p_rate_zar, 2), v_from, p_valid_to, public._blank_null(p_notes), p_user_id, p_user_id)
        RETURNING id INTO v_id;
    ELSE
        UPDATE public.transport_rates SET
            transporter_id = p_transporter_id, route_id = p_route_id, rate_zar = round(p_rate_zar, 2),
            valid_from = v_from, valid_to = p_valid_to, notes = public._blank_null(p_notes),
            is_active = true, updated_at = now(), updated_by = p_user_id
        WHERE id = p_id RETURNING id INTO v_id;
        IF v_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Rate not found.'); END IF;
    END IF;
    RETURN jsonb_build_object('success', true, 'id', v_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- The rate a delivery should get: transporter + route on the delivery's date.
-- Current rate (latest valid_from) wins; else the most recent expired one, flagged.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._transport_sheet_rate(p_transporter_id uuid, p_route_id uuid, p_on date)
RETURNS TABLE (rate_id uuid, rate_zar numeric, valid_to date, expired boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT r.id, r.rate_zar, r.valid_to,
           public._transport_rate_status(r.valid_from, r.valid_to, p_on) <> 'current'
    FROM public.transport_rates r
    WHERE r.is_active AND r.transporter_id = p_transporter_id AND r.route_id = p_route_id
      AND r.valid_from <= p_on
    ORDER BY (public._transport_rate_status(r.valid_from, r.valid_to, p_on) = 'current') DESC,
             r.valid_from DESC, r.valid_to DESC NULLS FIRST
    LIMIT 1;
$$;

-- Same arguments as set_transport_rate plus the route and, when the cost is not the sheet rate,
-- the reason. p_route_id null = no route (old behaviour, still allowed for a once-off trip).
CREATE OR REPLACE FUNCTION public.set_transport_rate_from_route(
    p_kernel_id uuid, p_rate_zar numeric, p_route_id uuid, p_override_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    k        public.kernel%ROWTYPE;
    ro       public.transport_routes%ROWTYPE;
    v_on     date;
    v_tid    uuid;
    v_sid    uuid;
    v_srate  numeric;
    v_sexp   boolean;
    v_reason text := public._blank_null(p_override_reason);
    v_tr     jsonb;
BEGIN
    SELECT * INTO k FROM public.kernel
    WHERE id = p_kernel_id AND is_active AND (intake_data #> '{delivery,transport}') IS NOT NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Delivery not found.');
    END IF;
    IF p_rate_zar IS NULL OR p_rate_zar < 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Enter the rate for the whole trip (0 or more).');
    END IF;

    v_tr := k.intake_data #> '{delivery,transport}';
    v_tr := v_tr - 'route_id' - 'route_code' - 'sheet_rate_id' - 'sheet_rate_zar' - 'sheet_rate_expired' - 'rate_override_reason';

    IF p_route_id IS NOT NULL THEN
        SELECT * INTO ro FROM public.transport_routes WHERE id = p_route_id;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('success', false, 'error', 'Route not found.');
        END IF;
        v_on := COALESCE(((k.intake_data #>> '{delivery,saved_at}')::timestamptz AT TIME ZONE 'Africa/Johannesburg')::date,
                         (k.created_at AT TIME ZONE 'Africa/Johannesburg')::date);
        v_tid := NULLIF(v_tr ->> 'transporter_id', '')::uuid;
        IF v_tid IS NOT NULL THEN
            SELECT x.rate_id, x.rate_zar, x.expired INTO v_sid, v_srate, v_sexp
            FROM public._transport_sheet_rate(v_tid, p_route_id, v_on) x;
        END IF;
        IF v_sid IS NOT NULL AND abs(round(p_rate_zar, 2) - v_srate) > 0.5 AND v_reason IS NULL THEN
            RETURN jsonb_build_object('success', false, 'needs_reason', true, 'sheet_rate_zar', v_srate,
                'error', 'This is not the rate on the rate sheet (R ' || to_char(v_srate, 'FM999G999G990D00') || '). Say why it is different.');
        END IF;
        v_tr := v_tr || jsonb_build_object('route_id', ro.id, 'route_code', ro.code);
        IF v_sid IS NOT NULL THEN
            v_tr := v_tr || jsonb_build_object('sheet_rate_id', v_sid, 'sheet_rate_zar', v_srate,
                                               'sheet_rate_expired', v_sexp);
        END IF;
        IF v_reason IS NOT NULL AND (v_sid IS NULL OR abs(round(p_rate_zar, 2) - v_srate) > 0.5) THEN
            v_tr := v_tr || jsonb_build_object('rate_override_reason', v_reason);
        END IF;
    END IF;

    UPDATE public.kernel
    SET intake_data = jsonb_set(intake_data, '{delivery,transport}', v_tr, true), updated_at = now()
    WHERE id = p_kernel_id;

    RETURN public.set_transport_rate(p_kernel_id, p_rate_zar);
END;
$$;

-- ----------------------------------------------------------------------------
-- My Day tasks: rates and documents running out.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active) VALUES
    ('task-transport-rate-expiring', 'Tasks: transport rates expiring',
     'Gets a My Day task when a transporter''s rates have expired or end within 14 days.', true),
    ('task-transporter-docs-expiring', 'Tasks: transporter documents expiring',
     'Gets a My Day task when a transporter''s goods-in-transit insurance or B-BBEE certificate has expired or ends within 30 days.', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

CREATE OR REPLACE FUNCTION public._fmt_day(p date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(p, 'FMDD Mon YYYY'); $$;

-- "expired 3 Nov 2026 (5 days ago)" / "expires today" / "expires 12 Dec 2026 (in 15 days)"
CREATE OR REPLACE FUNCTION public._expiry_words(p date, p_today date)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE
        WHEN p < p_today THEN 'expired ' || public._fmt_day(p) || ' (' || (p_today - p) || ' day' || CASE WHEN p_today - p = 1 THEN '' ELSE 's' END || ' ago)'
        WHEN p = p_today THEN 'expires today'
        ELSE 'expires ' || public._fmt_day(p) || ' (in ' || (p - p_today) || ' day' || CASE WHEN p - p_today = 1 THEN '' ELSE 's' END || ')'
    END;
$$;

CREATE OR REPLACE FUNCTION public.run_transport_task_checks()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_today date := public._sast_today();
    t       record;
    v_rates text;
    v_first date;
    v_docs  text[];
    v_rate_keys text[] := '{}';
    v_doc_keys  text[] := '{}';
BEGIN
    FOR t IN SELECT * FROM public.transporters WHERE status <> 'inactive' ORDER BY name LIMIT 500 LOOP
        -- Rates ending within 14 days, unless a newer rate for the same transporter + route takes over.
        SELECT string_agg(ro.code || ' ' || public._expiry_words(r.valid_to, v_today), ' · ' ORDER BY r.valid_to, ro.code),
               min(r.valid_to)
        INTO v_rates, v_first
        FROM public.transport_rates r
        JOIN public.transport_routes ro ON ro.id = r.route_id
        WHERE r.is_active AND r.transporter_id = t.id AND r.valid_to IS NOT NULL
          AND r.valid_to <= v_today + 14
          AND NOT EXISTS (
                SELECT 1 FROM public.transport_rates o
                WHERE o.is_active AND o.id <> r.id AND o.transporter_id = r.transporter_id AND o.route_id = r.route_id
                  AND o.valid_from > r.valid_from AND (o.valid_to IS NULL OR o.valid_to > r.valid_to));
        IF v_rates IS NOT NULL THEN
            PERFORM public._open_task('transport_rate_expiring', 'rates:' || t.id,
                t.name || ' · transport rates ' || CASE WHEN v_first < v_today THEN 'expired' ELSE 'ending' END,
                v_rates || '. Add the new rate on the Transporters page.',
                'transporter', t.id);
            v_rate_keys := v_rate_keys || ('rates:' || t.id);
        END IF;

        v_docs := '{}';
        IF t.git_expiry IS NOT NULL AND t.git_expiry <= v_today + 30 THEN
            v_docs := v_docs || ('Goods-in-transit insurance ' || public._expiry_words(t.git_expiry, v_today));
        END IF;
        IF t.bbbee_expiry IS NOT NULL AND t.bbbee_expiry <= v_today + 30 THEN
            v_docs := v_docs || ('B-BBEE certificate ' || public._expiry_words(t.bbbee_expiry, v_today));
        END IF;
        IF cardinality(v_docs) > 0 THEN
            PERFORM public._open_task('transporter_docs_expiring', 'docs:' || t.id,
                t.name || ' · documents to renew',
                array_to_string(v_docs, ' · ') || '. Upload the new one and update the date.',
                'transporter', t.id);
            v_doc_keys := v_doc_keys || ('docs:' || t.id);
        END IF;
    END LOOP;

    -- Close what no longer applies (renewed, replaced, or the transporter made inactive).
    UPDATE public.workflow_tasks
       SET status = 'completed', completed_at = now(), updated_at = now()
     WHERE status NOT IN ('completed', 'dismissed')
       AND ((kind = 'transport_rate_expiring' AND NOT (dedupe_key = ANY (v_rate_keys)))
         OR (kind = 'transporter_docs_expiring' AND NOT (dedupe_key = ANY (v_doc_keys))));

    RETURN jsonb_build_object('success', true, 'rate_tasks', cardinality(v_rate_keys), 'doc_tasks', cardinality(v_doc_keys));
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_transport_task_checks()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.run_transport_task_checks();
    RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER transport_rates_task_checks
    AFTER INSERT OR UPDATE ON public.transport_rates
    FOR EACH STATEMENT EXECUTE FUNCTION public._trg_transport_task_checks();

CREATE OR REPLACE TRIGGER transporters_task_checks
    AFTER INSERT OR UPDATE ON public.transporters
    FOR EACH STATEMENT EXECUTE FUNCTION public._trg_transport_task_checks();

CREATE OR REPLACE TRIGGER transport_routes_task_checks
    AFTER UPDATE ON public.transport_routes
    FOR EACH STATEMENT EXECUTE FUNCTION public._trg_transport_task_checks();

-- Daily, so "in 15 days" counts down and a date passing opens the task. 03:35 UTC = 05:35 SAST.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'transport-task-checks') THEN
        PERFORM cron.unschedule('transport-task-checks');
    END IF;
    PERFORM cron.schedule('transport-task-checks', '35 3 * * *', 'SELECT public.run_transport_task_checks()');
END $$;

-- Switches: Procurement Lead and whoever already enters transport rates (Palladium Manager).
INSERT INTO public.role_features (role_id, feature_id, value)
SELECT r.id, f.id, 'true'
FROM public.roles r
CROSS JOIN public.features f
WHERE f.key IN ('task-transport-rate-expiring', 'task-transporter-docs-expiring')
  AND (r.role_name = 'Procurement Lead'
       OR r.id IN (SELECT rf.role_id FROM public.role_features rf JOIN public.features f2 ON f2.id = rf.feature_id
                   WHERE f2.key = 'task-transport-rate' AND rf.value = 'true'))
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

-- ----------------------------------------------------------------------------
-- The Transporters screen and its edit action.
-- ----------------------------------------------------------------------------
INSERT INTO public.features (key, name, description, is_active)
VALUES ('transporters', 'Transporters',
        'Transport companies with their contacts and documents, collection routes, and the rate sheet (rate per load per route).', true)
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, is_active = true;

INSERT INTO public.role_features (role_id, feature_id, value)
SELECT DISTINCT r.id, f_new.id, 'true'
FROM public.roles r
CROSS JOIN public.features f_new
WHERE f_new.key = 'transporters'
  AND (r.role_name = 'Palladium Manager'
       OR r.id IN (SELECT rf.role_id FROM public.role_features rf JOIN public.features f ON f.id = rf.feature_id
                   WHERE f.key = 'kernel-pipeline-settings' AND rf.value::text IN ('true', '"true"')))
ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';

INSERT INTO public.actions (key, module, label, description) VALUES
    ('transport_rates.edit', 'Transporters', 'Edit transporters, routes and rates',
     'Add and change transporters (contacts, documents), collection routes and the rate per load')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT DISTINCT r.id, a.id, 'true'
FROM public.actions a
CROSS JOIN public.roles r
WHERE a.key = 'transport_rates.edit'
  AND (r.role_name IN ('super_user', 'admin', 'Palladium Manager')
       OR r.id IN (SELECT ra.role_id FROM public.role_actions ra JOIN public.actions a2 ON a2.id = ra.action_id
                   WHERE a2.key = 'kernel_settings.edit' AND ra.value::text IN ('true', '"true"')))
ON CONFLICT (role_id, action_id) DO UPDATE SET value = 'true';

-- ----------------------------------------------------------------------------
-- Grants.
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._transporter_status_sync() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._transport_sheet_rate(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.run_transport_task_checks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._trg_transport_task_checks() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_transport_sheet() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_transporter(uuid, jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_transport_route(uuid, text, text, text, numeric, text, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_transport_rate(uuid, uuid, uuid, numeric, date, date, text, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_transport_rate_from_route(uuid, numeric, uuid, text) TO anon, authenticated, service_role;

-- API layer: read for every role that can open the screen or enter a delivery rate;
-- writes only for roles that can already change transporters (upsert_transporter) or enter rates.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rp.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_permissions rp
CROSS JOIN unnest(ARRAY['get_transport_sheet', 'set_transport_rate_from_route']) AS fn
WHERE rp.object_type = 'function' AND rp.object_name = 'set_transport_rate' AND rp.operation = 'EXECUTE' AND rp.allowed
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = rp.role_id AND x.object_type = 'function' AND x.object_name = fn AND x.operation = 'EXECUTE');

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', fn, 'EXECUTE', true
FROM public.roles r
CROSS JOIN unnest(ARRAY['get_transport_sheet', 'save_transporter', 'save_transport_route', 'save_transport_rate']) AS fn
WHERE (r.role_name IN ('super_user', 'admin', 'Palladium Manager')
       OR r.id IN (SELECT rp.role_id FROM public.role_permissions rp
                   WHERE rp.object_type = 'function' AND rp.object_name = 'upsert_transporter' AND rp.operation = 'EXECUTE' AND rp.allowed))
  AND NOT EXISTS (SELECT 1 FROM public.role_permissions x
                   WHERE x.role_id = r.id AND x.object_type = 'function' AND x.object_name = fn AND x.operation = 'EXECUTE');

SELECT public.run_transport_task_checks();

NOTIFY pgrst, 'reload schema';
