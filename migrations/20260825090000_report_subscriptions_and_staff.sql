-- Report distribution — per-report subscriptions, a staff flag, and the RPCs behind the new screen.
--
-- Context. public.report_recipients (migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:75)
-- is a flat roster: one row per WhatsApp number, with no notion of WHICH report a person should
-- receive. Weekly/monthly sends work around that by having the operator pick numbers ad hoc inside
-- the send dialog every time. That cannot work for the new daily production report, which sends
-- itself at 17:00 with nobody present to pick anybody.
--
-- Two things are added:
--
--   1. public.report_subscriptions — a child row per (recipient, report_kind). A child table rather
--      than gets_daily/gets_weekly/gets_monthly columns, because a fourth report later would
--      otherwise mean another migration AND a change to every RPC signature. It also gives each
--      subscription its own muted_until, so somebody can pause the daily without being removed from
--      the monthly.
--
--   2. report_recipients.is_staff — decides whether the WhatsApp menu will hand that number
--      production figures. A shareholder receives the reports they are subscribed to and can stop
--      them, but asking the bot for today's tonnage is declined. This is a deliberate authorisation
--      boundary, not a display preference.
--
-- Deliberately NOT done here: no existing recipient is auto-subscribed to anything. The roster
-- currently holds numbers that were picked by hand for one-off weekly sends; silently converting
-- those into standing subscriptions would start sending people reports they never agreed to. The
-- new screen starts with every box unticked and Pete ticks them. The existing weekly/monthly picker
-- (list_report_recipients) is untouched and keeps working exactly as it does today.
--
-- public.scheduled_reports is NOT touched either — it still owns the separate email digest.
--
-- Idempotency. Every statement is re-runnable: this repo's MCP apply path stamps its own migration
-- version, so a file can legitimately be executed more than once.
--
-- Conventions followed: UUID PKs, TIMESTAMPTZ, snake_case, idx_<table>_<cols> index names,
-- REVOKE-then-grant table privileges, and SECURITY DEFINER RPCs with an explicit search_path.

-- ============================================================================
-- 0. report_sast_today — the app's own "today"
--
-- Defined here because report_daily_recipients below is LANGUAGE sql, whose body IS validated at
-- CREATE time: a forward reference to a function that does not exist yet fails the migration
-- outright rather than at first call.
--
-- Every dashboard function in this repo already uses AT TIME ZONE 'Africa/Johannesburg' (e.g.
-- migrations/20260310000001_dashboard_kernel_stats_sa_timezone.sql:22), but the report engine uses
-- bare CURRENT_DATE (migrations/20260817090000_report_builder_foundations.sql:166). On a UTC server
-- those disagree for the first two hours of every SAST day. This is the one canonical answer.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_sast_today()
RETURNS date
LANGUAGE sql STABLE
SET search_path = public
AS $fn$
    SELECT (current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date;
$fn$;

COMMENT ON FUNCTION public.report_sast_today() IS
    'Today in Africa/Johannesburg. The canonical "today" for every report; never use bare CURRENT_DATE, which is UTC on this server.';

GRANT EXECUTE ON FUNCTION public.report_sast_today() TO anon, authenticated, service_role;

-- ============================================================================
-- 1. report_recipients — the staff flag and an optional user link
-- ============================================================================

ALTER TABLE public.report_recipients
    ADD COLUMN IF NOT EXISTS is_staff boolean NOT NULL DEFAULT false;

ALTER TABLE public.report_recipients
    ADD COLUMN IF NOT EXISTS user_id uuid NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'report_recipients_user_id_fkey'
          AND conrelid = 'public.report_recipients'::regclass
    ) THEN
        ALTER TABLE public.report_recipients
            ADD CONSTRAINT report_recipients_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES public.users (id) ON DELETE SET NULL;
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_report_recipients_is_staff
    ON public.report_recipients (is_staff);

COMMENT ON COLUMN public.report_recipients.is_staff IS
    'True when this number may be given production figures over WhatsApp. Authorisation boundary, not a display preference — see report_recipient_by_inbound_phone.';
COMMENT ON COLUMN public.report_recipients.user_id IS
    'Optional link to the portal user behind this number. Informational; is_staff is what actually gates figures.';

-- ============================================================================
-- 2. public.report_subscriptions — which reports this recipient receives
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.report_subscriptions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id uuid NOT NULL REFERENCES public.report_recipients (id) ON DELETE CASCADE,
    report_kind  text NOT NULL CHECK (report_kind IN ('daily', 'weekly', 'monthly')),
    is_active    boolean NOT NULL DEFAULT true,
    -- Set by "Pause for 7 days" from the WhatsApp menu. A date, not a flag, so it expires by
    -- itself and nobody has to remember to switch somebody back on.
    muted_until  date NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    created_by   uuid NULL,
    updated_by   uuid NULL,
    CONSTRAINT report_subscriptions_unique UNIQUE (recipient_id, report_kind)
);

CREATE INDEX IF NOT EXISTS idx_report_subscriptions_recipient_id
    ON public.report_subscriptions (recipient_id);
CREATE INDEX IF NOT EXISTS idx_report_subscriptions_kind_active
    ON public.report_subscriptions (report_kind, is_active);

REVOKE ALL ON public.report_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_subscriptions TO service_role;

COMMENT ON TABLE public.report_subscriptions IS
    'One row per (report_recipient, report_kind). Reached only through the RPCs below; no direct anon/authenticated table privileges.';

-- Small helper, defined before its caller. Returns the documented
-- { subscribed, muted_until } object, and { subscribed: false, muted_until: null } when no
-- subscription row exists at all — the screen must render an unticked box, not a gap.
CREATE OR REPLACE FUNCTION public.report_subscription_json(
    p_recipient_id uuid,
    p_report_kind  text
)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT COALESCE(
        (SELECT jsonb_build_object('subscribed', rs.is_active, 'muted_until', rs.muted_until)
         FROM public.report_subscriptions rs
         WHERE rs.recipient_id = p_recipient_id AND rs.report_kind = p_report_kind),
        jsonb_build_object('subscribed', false, 'muted_until', NULL)
    );
$fn$;

-- ============================================================================
-- 3. RPC — the Report distribution screen's read
--
-- Returns jsonb rather than this family's usual TABLE(success, error, ...) envelope because the
-- payload is nested (three subscriptions per recipient) and a flat row set would force the browser
-- to re-group it. The shape is fixed by the plan the frontend is built against.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.list_report_distribution(
    p_include_inactive boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_rows jsonb;
BEGIN
    SELECT COALESCE(jsonb_agg(r ORDER BY r->>'display_name'), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT jsonb_build_object(
            'recipient_id',  rr.id,
            'display_name',  rr.display_name,
            'phone',         rr.phone,
            'source',        rr.source,
            'is_staff',      rr.is_staff,
            'is_active',     rr.is_active,
            'daily',         public.report_subscription_json(rr.id, 'daily'),
            'weekly',        public.report_subscription_json(rr.id, 'weekly'),
            'monthly',       public.report_subscription_json(rr.id, 'monthly')
        ) AS r
        FROM public.report_recipients rr
        WHERE p_include_inactive OR rr.is_active
    ) sub;

    RETURN jsonb_build_object('recipients', v_rows, 'error', NULL);
END;
$fn$;

-- ============================================================================
-- 4. RPCs — the screen's writes
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_report_subscription(
    p_recipient_id uuid,
    p_report_kind  text,
    p_is_active    boolean,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_kind text := lower(TRIM(COALESCE(p_report_kind, '')));
BEGIN
    IF p_recipient_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'p_recipient_id is required.');
    END IF;

    IF v_kind NOT IN ('daily', 'weekly', 'monthly') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'p_report_kind must be daily, weekly or monthly.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.report_recipients rr WHERE rr.id = p_recipient_id) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Recipient not found.');
    END IF;

    INSERT INTO public.report_subscriptions
        (recipient_id, report_kind, is_active, created_by, updated_by)
    VALUES
        (p_recipient_id, v_kind, COALESCE(p_is_active, false), p_actor_user_id, p_actor_user_id)
    ON CONFLICT (recipient_id, report_kind) DO UPDATE
        SET is_active  = COALESCE(p_is_active, false),
            -- Ticking a box back on clears any pause: an explicit choice by an operator beats a
            -- timer the recipient set from a handset.
            muted_until = CASE WHEN COALESCE(p_is_active, false) THEN NULL
                               ELSE report_subscriptions.muted_until END,
            updated_at  = now(),
            updated_by  = p_actor_user_id;

    RETURN jsonb_build_object('ok', true, 'error', NULL);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.set_report_recipient_staff(
    p_recipient_id  uuid,
    p_is_staff      boolean,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
    IF p_recipient_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'p_recipient_id is required.');
    END IF;

    UPDATE public.report_recipients
    SET is_staff   = COALESCE(p_is_staff, false),
        updated_at = now(),
        updated_by = p_actor_user_id
    WHERE id = p_recipient_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'Recipient not found.');
    END IF;

    RETURN jsonb_build_object('ok', true, 'error', NULL);
END;
$fn$;

-- ============================================================================
-- 5. RPC — who gets the daily, for the 17:00 sender
--
-- service_role only: it is read by supabase/functions/send-daily-production-report with the
-- service-role key, never from a browser.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_daily_recipients()
RETURNS TABLE (
    recipient_id uuid,
    display_name text,
    phone        text,
    is_staff     boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
    SELECT rr.id, rr.display_name, public.report_normalize_wa_phone(rr.phone), rr.is_staff
    FROM public.report_recipients rr
    JOIN public.report_subscriptions rs
      ON rs.recipient_id = rr.id AND rs.report_kind = 'daily'
    WHERE rr.is_active
      AND rs.is_active
      AND (rs.muted_until IS NULL OR rs.muted_until < public.report_sast_today())
    ORDER BY rr.display_name;
$fn$;

-- ============================================================================
-- 6. RPC — resolve an INBOUND number to a roster row
--
-- The trap this exists to close: inbound WhatsApp gives a bare-digit `from` (27821234567) via
-- chat_normalize_phone, while this roster is keyed on report_normalize_wa_phone (+27821234567).
-- Comparing the two forms directly matches nobody, silently, and it looks exactly like the person
-- not being on the list. Both normalisers run the same algorithm and differ only by the '+', so
-- comparison happens on chat_normalize_phone of BOTH sides.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.report_recipient_by_inbound_phone(
    p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_key text := public.chat_normalize_phone(p_phone);
    v_row record;
BEGIN
    IF v_key IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    SELECT rr.id, rr.display_name, rr.phone, rr.is_staff, rr.user_id,
           COALESCE(rs.is_active, false) AS subscribed_daily,
           rs.muted_until
    INTO v_row
    FROM public.report_recipients rr
    LEFT JOIN public.report_subscriptions rs
           ON rs.recipient_id = rr.id AND rs.report_kind = 'daily'
    WHERE public.chat_normalize_phone(rr.phone) = v_key
      AND rr.is_active
    LIMIT 1;

    IF v_row IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    RETURN jsonb_build_object(
        'found',            true,
        'recipient_id',     v_row.id,
        'display_name',     v_row.display_name,
        'phone',            public.report_normalize_wa_phone(v_row.phone),
        'is_staff',         v_row.is_staff,
        'user_id',          v_row.user_id,
        'subscribed_daily', v_row.subscribed_daily,
        'muted_until',      v_row.muted_until
    );
END;
$fn$;

-- ============================================================================
-- 7. RPC — stop / pause, driven from the WhatsApp menu
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_report_subscription_by_phone(
    p_phone       text,
    p_report_kind text,
    p_is_active   boolean,
    p_muted_until date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
    v_key  text := public.chat_normalize_phone(p_phone);
    v_kind text := lower(TRIM(COALESCE(p_report_kind, '')));
    v_recipient_id uuid;
    v_name text;
BEGIN
    IF v_key IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'A valid phone number is required.');
    END IF;

    IF v_kind NOT IN ('daily', 'weekly', 'monthly') THEN
        RETURN jsonb_build_object('ok', false, 'error', 'p_report_kind must be daily, weekly or monthly.');
    END IF;

    SELECT rr.id, rr.display_name INTO v_recipient_id, v_name
    FROM public.report_recipients rr
    WHERE public.chat_normalize_phone(rr.phone) = v_key AND rr.is_active
    LIMIT 1;

    IF v_recipient_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'This number is not on a distribution list.');
    END IF;

    INSERT INTO public.report_subscriptions
        (recipient_id, report_kind, is_active, muted_until)
    VALUES
        (v_recipient_id, v_kind, COALESCE(p_is_active, false), p_muted_until)
    ON CONFLICT (recipient_id, report_kind) DO UPDATE
        SET is_active   = COALESCE(p_is_active, false),
            muted_until = p_muted_until,
            updated_at  = now();

    RETURN jsonb_build_object('ok', true, 'error', NULL, 'display_name', v_name);
END;
$fn$;

-- ============================================================================
-- 8. Grants
--
-- The screen's read and writes go to anon/authenticated: the portal calls PostgREST with the
-- publishable key and its own session token, and the screen is gated by reports.recipient.manage
-- in the UI plus role_actions (see migrations/20260825093000_report_distribution_rbac.sql).
--
-- report_daily_recipients, report_recipient_by_inbound_phone and set_report_subscription_by_phone
-- are service_role ONLY. They are reached from edge functions with the service-role key. The last
-- two take a PHONE NUMBER as their only identifier — exposed to anon, they would let anyone on the
-- internet enumerate who is on a confidential distribution list, or unsubscribe somebody else.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.report_subscription_json(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_report_distribution(boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_report_subscription(uuid, text, boolean, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_report_recipient_staff(uuid, boolean, uuid) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.report_daily_recipients() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.report_recipient_by_inbound_phone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_report_subscription_by_phone(text, text, boolean, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.report_daily_recipients() TO service_role;
GRANT EXECUTE ON FUNCTION public.report_recipient_by_inbound_phone(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_report_subscription_by_phone(text, text, boolean, date) TO service_role;

-- ============================================================================
-- 9. RBAC
--
-- Deliberately none here. migrations/20260822090200_report_whatsapp_send_rbac.sql:17 records that
-- looping grants over every role is the direct cause of this repo's existing drift between
-- role_actions and role_permissions, and that same file adds no features row for a screen that does
-- not exist yet. The Report distribution screen's feature key and its actions land in
-- migrations/20260825093000_report_distribution_rbac.sql, applied once the screen is merged.
--
-- public.role_permissions is legacy and is NOT written here: nothing since
-- migrations/20260108000016 has added to it, and the modern path is actions + role_actions.
-- ============================================================================

NOTIFY pgrst, 'reload schema';
