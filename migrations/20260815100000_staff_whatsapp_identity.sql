-- Staff WhatsApp phone identity and enrolment (Phase 2).
--
-- WHY: the inbound webhook (supabase/functions/whatsapp-inbound/index.ts) already receives and
-- persists every WhatsApp message via chat_ingest_inbound_whatsapp, but that function only
-- resolves an inbound number against CRM CONTACTS (customers) — see
-- 20260813090000_whatsapp_inbound_shared_inbox.sql:208-221. There is no staff phone column
-- anywhere on public.users, so a staff member texting the shared line today becomes an
-- unattributed shared-inbox item: no user, therefore no role, therefore no command can ever be
-- authorised against it. This migration adds the missing link — a verified phone -> user -> role
-- mapping — so a later plan can wire a command router on top of it.
--
-- (a) CANONICAL PHONE FORM is bare digits, no '+', no spaces — e.g. '27714639643' — matching
--     20260813090000_whatsapp_inbound_shared_inbox.sql:20-25 exactly, so the same number
--     compares equal on both the CRM-contact path and this staff-identity path. Reuses the
--     existing public.chat_normalize_phone(text) helper; no second normaliser is defined here.
--
-- (b) ALL THREE FUNCTIONS BELOW ARE service_role ONLY. WebPortal/js/data-functions.js calls every
--     RPC as PostgREST role `anon` (useAnonAuth: true) — there is no per-user database role, so
--     any function granted to `anon` or `authenticated` is callable by ANYONE holding the public
--     anon key that ships in the browser, and any uuid argument such a caller passes (e.g.
--     p_user_id) is client-asserted, not authenticated. A resolver reachable from `anon` would
--     turn a bare phone number into a user id and role for any caller; a starter reachable from
--     `anon` would let any caller mint an enrolment code bound to any user_id. So none of the
--     three functions created here — whatsapp_start_enrolment, whatsapp_confirm_enrolment,
--     whatsapp_resolve_staff_user — nor the small helper below, is ever granted to `anon`,
--     `authenticated`, or `PUBLIC`.
--
-- (c) NOTHING IN THIS MIGRATION DELIVERS THE CODE TO A HANDSET. whatsapp_start_enrolment returns
--     the 6-digit code to its service_role caller and records who requested it
--     (requested_by_user_id); no edge function is added or modified here. A code minted by this
--     migration is therefore only as trustworthy as the server-side caller that requested it —
--     the "we texted your own handset, so possession is proven" property depends entirely on the
--     later plan that adds the delivery path, and is NOT established by this migration alone.
--
-- (d) role_permissions IS NOT THE ACCESS CONTROL. It is this repo's second, largely vestigial,
--     Lambda-proxy-era RBAC layer (20260813090000_whatsapp_inbound_shared_inbox.sql:586-587) —
--     the browser calls PostgREST directly now, so that table no longer gates anything at
--     runtime. It is seeded below, for convention only, for super_user and admin — NOT for every
--     role. CLAUDE.md records seeding a new function to every role as the exact pattern that
--     caused this repo's current permission drift; this migration does not repeat it.
--
-- OUT OF SCOPE (see the plan): the inbound webhook, chat_ingest_inbound_whatsapp, any WebPortal/
-- file, any edge function, and applying this migration (no database credential exists in the
-- authoring environment — a human runs `npm run db:apply -- migrations/<this file>.sql`).

-- ============================================================================
-- 1. SCHEMA — staff phone identity on public.users
-- ============================================================================

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS whatsapp_phone text,
    ADD COLUMN IF NOT EXISTS whatsapp_phone_verified_at timestamptz;

COMMENT ON COLUMN public.users.whatsapp_phone IS
    'Canonical bare-digit WhatsApp number (e.g. 27714639643 — same form as chat_normalize_phone / '
    'chat_conversations.external_phone), set only by whatsapp_confirm_enrolment. Never trust for '
    'identity unless whatsapp_phone_verified_at IS NOT NULL.';

COMMENT ON COLUMN public.users.whatsapp_phone_verified_at IS
    'Set the moment whatsapp_confirm_enrolment succeeds. A row is only trusted for WhatsApp '
    'command authorisation when this is NOT NULL — a NULL means the phone column, if set at all, '
    'is unverified and must not be used to resolve identity.';

-- Partial unique index: one number can never map to two users, but unenrolled users (NULL) are
-- entirely unaffected — most users will never enrol a phone.
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_whatsapp_phone
    ON public.users (whatsapp_phone)
    WHERE whatsapp_phone IS NOT NULL;

-- ============================================================================
-- 2. Enrolment codes — short-lived server-side secret, same shape as
--    password_reset_tokens (20260708150000_password_management.sql:47-58).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.whatsapp_enrolment_codes (
    phone                 text PRIMARY KEY,
    user_id               uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    requested_by_user_id  uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    code                  text NOT NULL,
    attempts              integer NOT NULL DEFAULT 0,
    expires_at            timestamptz NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.whatsapp_enrolment_codes IS
    'phone is the primary key: starting a second enrolment for the same number replaces the '
    'pending one rather than leaving two live codes. requested_by_user_id records who initiated '
    'the binding (audit trail) — it is the admin who ran whatsapp_start_enrolment, NOT '
    'necessarily the person the phone belongs to.';

ALTER TABLE public.whatsapp_enrolment_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_enrolment_codes FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. Authorisation helper for whatsapp_start_enrolment.
--    Shape mirrors chat_has_whatsapp_inbox_access
--    (20260813090000_whatsapp_inbound_shared_inbox.sql:116-137), but gates on the
--    admin.users.manage action (seeded to super_user/admin only —
--    20260602100000_create_actions_tables.sql:60, 67-86) rather than a messaging action.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_user_manages_users(p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_user_id IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.users u
        JOIN public.role_actions ra ON ra.role_id = u.role_id
        JOIN public.actions a ON a.id = ra.action_id
        WHERE u.id = p_user_id
          AND u.is_active IS TRUE
          AND a.key = 'admin.users.manage'
          AND COALESCE(ra.value, '') = 'true'
    );
END;
$$;

COMMENT ON FUNCTION public.whatsapp_user_manages_users(uuid) IS
    'Helper for whatsapp_start_enrolment only. NOT granted to anon/authenticated — see the '
    'header comment on why a client-asserted p_user_id cannot be treated as authenticated.';

-- ============================================================================
-- 4. whatsapp_start_enrolment — service_role only. Mints a short-lived numeric code
--    for a target user's phone, requested by an authorised initiator.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_start_enrolment(
    p_requesting_user_id uuid DEFAULT NULL,
    p_user_id            uuid DEFAULT NULL,
    p_phone              text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_phone  text;
    v_bytes  bytea;
    v_code   text;
BEGIN
    -- Defence-in-depth only: this in-function check cannot authenticate
    -- p_requesting_user_id (it is a value the caller supplies, not a verified session) — the
    -- real control is that this function is granted to service_role only (see header (b)).
    -- A server-side caller is expected to have already established that the true operator is
    -- an admin.users.manage holder before ever invoking this RPC.
    IF NOT public.whatsapp_user_manages_users(p_requesting_user_id) THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Requesting user is not authorised to manage users.');
    END IF;

    IF p_user_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = p_user_id AND is_active IS TRUE
    ) THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Target user not found or inactive.');
    END IF;

    v_phone := public.chat_normalize_phone(p_phone);
    IF v_phone IS NULL OR length(v_phone) < 10 THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Invalid phone number.');
    END IF;

    -- Refuse if this number is already verified on a DIFFERENT user.
    IF EXISTS (
        SELECT 1 FROM public.users
        WHERE whatsapp_phone = v_phone
          AND whatsapp_phone_verified_at IS NOT NULL
          AND id <> p_user_id
    ) THEN
        RETURN jsonb_build_object('success', 0, 'error', 'This number is already verified on a different user.');
    END IF;

    -- 6-digit numeric code from a CSPRNG (gen_random_bytes), never random().
    v_bytes := gen_random_bytes(4);
    v_code  := lpad((
          (get_byte(v_bytes, 0)::bigint * 16777216
         + get_byte(v_bytes, 1)::bigint * 65536
         + get_byte(v_bytes, 2)::bigint * 256
         + get_byte(v_bytes, 3)::bigint) % 1000000)::text, 6, '0');

    INSERT INTO public.whatsapp_enrolment_codes (
        phone, user_id, requested_by_user_id, code, attempts, expires_at, created_at
    )
    VALUES (
        v_phone, p_user_id, p_requesting_user_id, v_code, 0, now() + interval '15 minutes', now()
    )
    ON CONFLICT (phone) DO UPDATE
    SET user_id              = EXCLUDED.user_id,
        requested_by_user_id = EXCLUDED.requested_by_user_id,
        code                 = EXCLUDED.code,
        attempts              = 0,
        expires_at            = EXCLUDED.expires_at,
        created_at            = EXCLUDED.created_at;

    RETURN jsonb_build_object(
        'success', 1,
        'code', v_code,
        'expires_at', now() + interval '15 minutes'
    );
END;
$$;

COMMENT ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) IS
    'SERVER-SIDE ONLY — NEVER expose this function or its returned code to the browser. Returns '
    'the raw 6-digit code to its (service_role) caller; delivering that code to the TARGET '
    'user''s own handset is a later plan''s job, not this function''s. The initiator (who may be '
    'a different person than the target) must never simply read the code out.';

-- ============================================================================
-- 5. whatsapp_confirm_enrolment — service_role only. Called by the webhook (in a
--    later plan) once the target user texts the code back.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_confirm_enrolment(
    p_phone text DEFAULT NULL,
    p_code  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_phone text;
    v_code  text;
    v_row   record;
BEGIN
    v_phone := public.chat_normalize_phone(p_phone);
    v_code  := btrim(COALESCE(p_code, ''));

    IF v_phone IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Invalid phone number.');
    END IF;

    SELECT * INTO v_row
    FROM public.whatsapp_enrolment_codes
    WHERE phone = v_phone;

    IF v_row.phone IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'No pending enrolment for this number.');
    END IF;

    IF v_row.expires_at < now() THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Enrolment code has expired.');
    END IF;

    IF v_row.attempts >= 5 THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Too many attempts. Ask an admin to restart enrolment.');
    END IF;

    IF v_code = '' OR v_code <> v_row.code THEN
        UPDATE public.whatsapp_enrolment_codes
        SET attempts = attempts + 1
        WHERE phone = v_phone;

        RETURN jsonb_build_object('success', 0, 'error', 'Incorrect code.');
    END IF;

    -- Re-check before writing: state can change between start and confirm.
    IF EXISTS (
        SELECT 1 FROM public.users
        WHERE whatsapp_phone = v_phone
          AND whatsapp_phone_verified_at IS NOT NULL
          AND id <> v_row.user_id
    ) THEN
        RETURN jsonb_build_object('success', 0, 'error', 'This number is already verified on a different user.');
    END IF;

    BEGIN
        UPDATE public.users
        SET whatsapp_phone = v_phone,
            whatsapp_phone_verified_at = now()
        WHERE id = v_row.user_id;
    EXCEPTION WHEN unique_violation THEN
        RETURN jsonb_build_object('success', 0, 'error', 'This number was verified on another user moments ago.');
    END;

    DELETE FROM public.whatsapp_enrolment_codes WHERE phone = v_phone;

    RETURN (
        SELECT jsonb_build_object(
            'success', 1,
            'user_id', u.id,
            'display_name', COALESCE(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), u.email)
        )
        FROM public.users u
        WHERE u.id = v_row.user_id
    );
END;
$$;

COMMENT ON FUNCTION public.whatsapp_confirm_enrolment(text, text) IS
    'SERVER-SIDE ONLY (service_role) — called by the inbound webhook once wired up in a later '
    'plan, when the target user texts back the code they received.';

-- ============================================================================
-- 6. whatsapp_resolve_staff_user — service_role only. The lookup every later
--    WhatsApp-command stage depends on.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.whatsapp_resolve_staff_user(p_phone text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_phone text;
    v_row   record;
BEGIN
    v_phone := public.chat_normalize_phone(p_phone);
    IF v_phone IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Invalid phone number.');
    END IF;

    SELECT u.id AS user_id, u.role_id,
           COALESCE(btrim(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), u.email) AS display_name
    INTO v_row
    FROM public.users u
    WHERE u.whatsapp_phone = v_phone
      AND u.whatsapp_phone_verified_at IS NOT NULL
      AND u.is_active IS TRUE;

    IF v_row.user_id IS NULL THEN
        RETURN jsonb_build_object('success', 0, 'error', 'Number is not enrolled to any active staff user.');
    END IF;

    RETURN jsonb_build_object(
        'success', 1,
        'user_id', v_row.user_id,
        'role_id', v_row.role_id,
        'display_name', v_row.display_name
    );
END;
$$;

COMMENT ON FUNCTION public.whatsapp_resolve_staff_user(text) IS
    'SERVER-SIDE ONLY (service_role) — every later WhatsApp-command stage resolves the sender''s '
    'identity through this function. Never returns a user whose whatsapp_phone_verified_at is '
    'NULL.';

-- ============================================================================
-- 7. role_permissions seed — convention only, NOT the access control (see header (d)).
--    super_user and admin only — deliberately not every role.
-- ============================================================================

DO $$
DECLARE
    v_role_id uuid;
    v_fn text;
    v_role_name text;
    v_full_access_roles text[] := ARRAY['super_user', 'admin'];
    v_fns text[] := ARRAY[
        'whatsapp_start_enrolment', 'whatsapp_confirm_enrolment',
        'whatsapp_resolve_staff_user', 'whatsapp_user_manages_users'
    ];
BEGIN
    FOREACH v_role_name IN ARRAY v_full_access_roles
    LOOP
        SELECT id INTO v_role_id FROM public.roles WHERE role_name = v_role_name;
        IF v_role_id IS NOT NULL THEN
            FOREACH v_fn IN ARRAY v_fns
            LOOP
                INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
                VALUES (v_role_id, 'function', v_fn, 'EXECUTE', true)
                ON CONFLICT DO NOTHING;
            END LOOP;
        END IF;
    END LOOP;
END $$;

-- ============================================================================
-- 8. GRANTS — service_role only, for every function created in this migration.
--    Never anon, never authenticated, never PUBLIC. See header (b) for why.
-- ============================================================================

REVOKE ALL ON FUNCTION public.whatsapp_user_manages_users(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_user_manages_users(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_user_manages_users(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_user_manages_users(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_confirm_enrolment(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_confirm_enrolment(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_confirm_enrolment(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_confirm_enrolment(text, text) TO service_role;

REVOKE ALL ON FUNCTION public.whatsapp_resolve_staff_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_resolve_staff_user(text) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_resolve_staff_user(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_resolve_staff_user(text) TO service_role;

NOTIFY pgrst, 'reload schema';
