-- Macavation Portal Guide chatbot — backend (Phase 1: chat + feedback only).
--
-- Adapted from the Libra Portal assistant (20260714120000_portal_assistant_pg.sql),
-- itself ported from the Jacana 0356 MSSQL design. Deviations from Libra:
--   * Single-tenant: one `assistant_client` singleton row (Macavation) instead of
--     per-broker scoping. `client_guid` is carried as text on conversation/message/
--     budget/usage rows for forward-compatibility, but there is only one client.
--   * Sessions are portal-native: `assistant_sessions` keyed by sha256 token hash,
--     FK'd straight to public.users (no c360-style external identifier).
--   * Budget is a simple monthly cents ledger (`assistant_budget`), not the
--     Libra/Jacana smart_digitisation_ai_config integration.
--   * No escalation tables/functions and no admin UI in this phase — chat +
--     thumbs up/down feedback only, per product scope for this rollout.
--
-- Convention: SECURITY DEFINER, SET search_path = public, extensions; RETURNS
-- TABLE(success int, error text, ...) for multi-value RPCs, matching the rest
-- of this repo's migrations (see 20260708130000_users_first_last_name_replace_username.sql).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, ON CONFLICT
-- DO NOTHING seeds. Safe to re-run.

-- ============================================================================
-- 1. TABLES
-- ============================================================================

-- assistant_client: singleton config/flags row for the one Macavation client.
-- singleton boolean PK + CHECK(singleton) guarantees at most one row can ever
-- exist (a second row would need singleton = true, violating the PK).
CREATE TABLE IF NOT EXISTS public.assistant_client (
    singleton            boolean     NOT NULL DEFAULT true,
    client_guid          uuid        NOT NULL DEFAULT gen_random_uuid(),
    client_name          text        NOT NULL DEFAULT 'Macavation',
    assistant_enabled    int         NOT NULL DEFAULT 0,
    assistant_model      text        NULL DEFAULT 'claude-sonnet-4-6',
    default_budget_cents int         NOT NULL DEFAULT 5000,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT assistant_client_pkey PRIMARY KEY (singleton),
    CONSTRAINT ck_assistant_client_singleton CHECK (singleton),
    CONSTRAINT ck_assistant_client_enabled CHECK (assistant_enabled IN (0, 1)),
    CONSTRAINT uq_assistant_client_guid UNIQUE (client_guid)
);

-- Seed exactly one row with a freshly generated client_guid. Left disabled
-- (assistant_enabled = 0) per rollout constraints — see enablement SQL at the
-- bottom of this file.
INSERT INTO public.assistant_client (singleton, client_name)
VALUES (true, 'Macavation')
ON CONFLICT (singleton) DO NOTHING;

-- assistant_sessions: portal session token -> user, for the assistant edge to
-- authenticate requests without re-touching the Lambda-free auth path.
CREATE TABLE IF NOT EXISTS public.assistant_sessions (
    id           bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
    user_id      uuid        NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    token_hash   text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    revoked_at   timestamptz NULL,
    CONSTRAINT assistant_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT uq_assistant_sessions_token_hash UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS ix_assistant_sessions_user ON public.assistant_sessions (user_id);
CREATE INDEX IF NOT EXISTS ix_assistant_sessions_expires ON public.assistant_sessions (expires_at);

-- assistant_kb_chunk: ingested Macavation user-guide corpus. Idempotent
-- re-ingest is keyed on (source, section_anchor, chunk_index) + content_hash.
CREATE TABLE IF NOT EXISTS public.assistant_kb_chunk (
    chunk_id        bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
    source          text        NOT NULL DEFAULT 'macavation-user-guide',
    section_anchor  text        NOT NULL,
    chunk_index     int         NOT NULL DEFAULT 0,
    title           text        NOT NULL,
    body            text        NULL,
    summary         text        NULL,
    keywords        text        NULL,
    permission_key  text        NULL,
    token_estimate  int         NULL,
    content_hash    text        NOT NULL,
    ingested_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT assistant_kb_chunk_pkey PRIMARY KEY (chunk_id),
    CONSTRAINT uq_assistant_kb_chunk_source_anchor_idx UNIQUE (source, section_anchor, chunk_index)
);
CREATE INDEX IF NOT EXISTS ix_assistant_kb_chunk_anchor
    ON public.assistant_kb_chunk (section_anchor, chunk_index);

-- assistant_kb_meta: singleton Tier-0 catalog artifact (meta_id = 1).
CREATE TABLE IF NOT EXISTS public.assistant_kb_meta (
    meta_id         int         NOT NULL,
    catalog_text    text        NULL,
    catalog_version int         NOT NULL DEFAULT 0,
    guide_sha256    text        NULL,
    rebuilt_at      timestamptz NULL,
    CONSTRAINT assistant_kb_meta_pkey PRIMARY KEY (meta_id),
    CONSTRAINT ck_assistant_kb_meta_singleton CHECK (meta_id = 1)
);
INSERT INTO public.assistant_kb_meta (meta_id, catalog_text, catalog_version, guide_sha256, rebuilt_at)
VALUES (1, NULL, 0, NULL, NULL)
ON CONFLICT (meta_id) DO NOTHING;

-- assistant_conversation: one row per chat thread.
CREATE TABLE IF NOT EXISTS public.assistant_conversation (
    conversation_guid uuid        NOT NULL DEFAULT gen_random_uuid(),
    client_guid       text        NOT NULL,
    user_id           uuid        NULL REFERENCES public.users (id) ON DELETE SET NULL,
    title             text        NULL,
    status            text        NOT NULL DEFAULT 'active',
    started_at        timestamptz NOT NULL DEFAULT now(),
    last_message_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT assistant_conversation_pkey PRIMARY KEY (conversation_guid),
    CONSTRAINT ck_assistant_conversation_status CHECK (status IN ('active', 'closed'))
);
CREATE INDEX IF NOT EXISTS ix_assistant_conversation_owner
    ON public.assistant_conversation (client_guid, user_id, last_message_at DESC);

-- assistant_message: each chat turn (user / assistant).
CREATE TABLE IF NOT EXISTS public.assistant_message (
    message_id         bigint         GENERATED ALWAYS AS IDENTITY NOT NULL,
    conversation_guid   uuid           NOT NULL,
    client_guid         text           NOT NULL,
    role                text           NOT NULL,
    content             text           NULL,
    cited_anchors       text           NULL,
    cost_cents          numeric(10, 4) NULL,
    created_at          timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT assistant_message_pkey PRIMARY KEY (message_id),
    CONSTRAINT fk_assistant_message_conversation
        FOREIGN KEY (conversation_guid) REFERENCES public.assistant_conversation (conversation_guid),
    CONSTRAINT ck_assistant_message_role CHECK (role IN ('user', 'assistant'))
);
CREATE INDEX IF NOT EXISTS ix_assistant_message_conversation
    ON public.assistant_message (conversation_guid, message_id);

-- assistant_feedback: thumbs up/down on an assistant message.
CREATE TABLE IF NOT EXISTS public.assistant_feedback (
    feedback_id       bigint      GENERATED ALWAYS AS IDENTITY NOT NULL,
    message_id        bigint      NOT NULL,
    conversation_guid uuid        NULL,
    rating            text        NOT NULL,
    comment           text        NULL,
    user_id           uuid        NULL REFERENCES public.users (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT assistant_feedback_pkey PRIMARY KEY (feedback_id),
    CONSTRAINT fk_assistant_feedback_message
        FOREIGN KEY (message_id) REFERENCES public.assistant_message (message_id),
    CONSTRAINT ck_assistant_feedback_rating CHECK (rating IN ('up', 'down'))
);
CREATE INDEX IF NOT EXISTS ix_assistant_feedback_message ON public.assistant_feedback (message_id);

-- assistant_budget: monthly spend ledger per client (cents).
CREATE TABLE IF NOT EXISTS public.assistant_budget (
    client_guid  text        NOT NULL,
    period_start date        NOT NULL,
    budget_cents int         NOT NULL,
    spent_cents  int         NOT NULL DEFAULT 0,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT assistant_budget_pkey PRIMARY KEY (client_guid, period_start)
);

-- Seed the current month's budget row from the client's default budget.
INSERT INTO public.assistant_budget (client_guid, period_start, budget_cents, spent_cents)
SELECT c.client_guid::text, date_trunc('month', now())::date, c.default_budget_cents, 0
FROM public.assistant_client c
WHERE c.singleton
ON CONFLICT (client_guid, period_start) DO NOTHING;

-- assistant_usage_log: per-call AI usage/cost audit trail.
CREATE TABLE IF NOT EXISTS public.assistant_usage_log (
    usage_id      bigint         GENERATED ALWAYS AS IDENTITY NOT NULL,
    client_guid   text           NOT NULL,
    model         text           NULL,
    input_tokens  int            NOT NULL DEFAULT 0,
    output_tokens int            NOT NULL DEFAULT 0,
    cost_cents    numeric(10, 4) NOT NULL DEFAULT 0,
    latency_ms    int            NULL,
    http_status   int            NULL,
    success       boolean        NOT NULL DEFAULT true,
    error_message text           NULL,
    created_at    timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT assistant_usage_log_pkey PRIMARY KEY (usage_id)
);
CREATE INDEX IF NOT EXISTS ix_assistant_usage_log_client_date
    ON public.assistant_usage_log (client_guid, created_at);

-- ============================================================================
-- 2. RLS LOCKDOWN — service_role only on every assistant_* table.
-- ============================================================================

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'assistant_client', 'assistant_sessions',
        'assistant_kb_chunk', 'assistant_kb_meta',
        'assistant_conversation', 'assistant_message', 'assistant_feedback',
        'assistant_budget', 'assistant_usage_log'
    ]
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
        EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', t);
    END LOOP;
END;
$$;

-- ============================================================================
-- 3. SESSION FUNCTIONS
-- ============================================================================

-- assistant_current_client_guid: resolve the one Macavation client_guid.
-- Fails closed (raises) rather than ever operating without a configured client.
CREATE OR REPLACE FUNCTION public.assistant_current_client_guid()
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_guid uuid;
BEGIN
    SELECT client_guid INTO v_guid FROM public.assistant_client WHERE singleton LIMIT 1;
    IF v_guid IS NULL THEN
        RAISE EXCEPTION 'assistant_client is not configured (no client_guid found).';
    END IF;
    RETURN v_guid;
END;
$$;

-- assistant_session_upsert: mint/refresh a session row for a portal token.
-- Absolute 24h expiry from this call's created_at/last_seen_at (not sliding
-- at mint time — assistant_validate_session slides it on each validated use).
DROP FUNCTION IF EXISTS public.assistant_session_upsert(text, uuid);
CREATE FUNCTION public.assistant_session_upsert(
    p_token   text DEFAULT NULL,
    p_user_id uuid DEFAULT NULL
)
RETURNS TABLE (success int, error text, token_hash text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_token   text        := NULLIF(btrim(coalesce(p_token, '')), '');
    v_hash    text;
    v_expires timestamptz := now() + interval '24 hours';
BEGIN
    IF v_token IS NULL OR p_user_id IS NULL THEN
        RETURN QUERY SELECT 0, 'p_token and p_user_id are required.', NULL::text, NULL::timestamptz;
        RETURN;
    END IF;

    v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

    -- ON CONSTRAINT (not the column-list form) because this function's
    -- RETURNS TABLE also declares a token_hash OUT param, which otherwise
    -- makes the ON CONFLICT column reference ambiguous.
    INSERT INTO public.assistant_sessions (user_id, token_hash, created_at, last_seen_at, expires_at, revoked_at)
    VALUES (p_user_id, v_hash, now(), now(), v_expires, NULL)
    ON CONFLICT ON CONSTRAINT uq_assistant_sessions_token_hash DO UPDATE SET
        user_id      = EXCLUDED.user_id,
        last_seen_at = now(),
        expires_at   = v_expires,
        revoked_at   = NULL;

    RETURN QUERY SELECT 1, NULL::text, v_hash, v_expires;
END;
$$;

-- assistant_validate_session: fail-closed token lookup for the edge function.
-- Empty result set = invalid/expired/revoked/inactive-user (caller must treat
-- zero rows as 401). Slides expires_at by another 24h on every valid use.
DROP FUNCTION IF EXISTS public.assistant_validate_session(text);
CREATE FUNCTION public.assistant_validate_session(
    p_token text DEFAULT NULL
)
RETURNS TABLE (user_id uuid, role_name text, email text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_token text := NULLIF(btrim(coalesce(p_token, '')), '');
    v_hash  text;
BEGIN
    IF v_token IS NULL THEN
        RETURN;
    END IF;

    v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

    UPDATE public.assistant_sessions s
    SET last_seen_at = now(), expires_at = now() + interval '24 hours'
    WHERE s.token_hash = v_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now();

    RETURN QUERY
    SELECT u.id, r.role_name::text, u.email
    FROM public.assistant_sessions s
    JOIN public.users u ON u.id = s.user_id
    LEFT JOIN public.roles r ON r.id = u.role_id
    WHERE s.token_hash = v_hash
      AND s.revoked_at IS NULL
      AND s.expires_at > now()
      AND u.is_active IS TRUE;
END;
$$;

-- auth_logout: best-effort revoke of an assistant session by raw token.
-- Always reports success so it never reveals whether a session existed.
DROP FUNCTION IF EXISTS public.auth_logout(text);
CREATE FUNCTION public.auth_logout(
    p_token text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_token text := NULLIF(btrim(coalesce(p_token, '')), '');
    v_hash  text;
BEGIN
    IF v_token IS NULL THEN
        RETURN json_build_object('success', true);
    END IF;

    v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');

    UPDATE public.assistant_sessions
    SET revoked_at = now()
    WHERE token_hash = v_hash AND revoked_at IS NULL;

    RETURN json_build_object('success', true);
END;
$$;

-- ============================================================================
-- 4. KB FUNCTIONS
-- ============================================================================

-- assistant_kb_chunk_upsert: idempotent upsert keyed on (source, section_anchor, chunk_index).
DROP FUNCTION IF EXISTS public.assistant_kb_chunk_upsert(text, text, int, text, text, text, text, text, int, text, int);
CREATE FUNCTION public.assistant_kb_chunk_upsert(
    p_source         text DEFAULT 'macavation-user-guide',
    p_section_anchor text DEFAULT NULL,
    p_chunk_index    int  DEFAULT 0,
    p_title          text DEFAULT NULL,
    p_body           text DEFAULT NULL,
    p_summary        text DEFAULT NULL,
    p_keywords       text DEFAULT NULL,
    p_permission_key text DEFAULT NULL,
    p_token_estimate int  DEFAULT NULL,
    p_content_hash   text DEFAULT NULL,
    p_force          int  DEFAULT 0
)
RETURNS TABLE (
    success        int,
    error          text,
    chunk_id       bigint,
    section_anchor text,
    chunk_index    int,
    content_hash   text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_source text := NULLIF(btrim(coalesce(p_source, '')), '');
    v_anchor text := NULLIF(btrim(coalesce(p_section_anchor, '')), '');
    v_hash   text := NULLIF(btrim(coalesce(p_content_hash, '')), '');
    v_idx    int  := GREATEST(0, COALESCE(p_chunk_index, 0));
    v_force  int  := COALESCE(p_force, 0);
    v_title  text := coalesce(p_title, '');
BEGIN
    IF v_source IS NULL OR v_anchor IS NULL OR v_hash IS NULL THEN
        RETURN QUERY SELECT 0, 'p_source, p_section_anchor and p_content_hash are required.',
            NULL::bigint, NULL::text, NULL::int, NULL::text;
        RETURN;
    END IF;

    INSERT INTO public.assistant_kb_chunk AS t
        (source, section_anchor, chunk_index, title, body, summary, keywords,
         permission_key, token_estimate, content_hash, ingested_at)
    VALUES
        (v_source, v_anchor, v_idx, v_title, p_body, p_summary, p_keywords,
         p_permission_key, p_token_estimate, v_hash, now())
    ON CONFLICT ON CONSTRAINT uq_assistant_kb_chunk_source_anchor_idx DO UPDATE SET
        title           = EXCLUDED.title,
        body            = EXCLUDED.body,
        summary         = EXCLUDED.summary,
        keywords        = EXCLUDED.keywords,
        permission_key  = EXCLUDED.permission_key,
        token_estimate  = EXCLUDED.token_estimate,
        content_hash    = EXCLUDED.content_hash,
        ingested_at     = now()
    WHERE t.content_hash IS DISTINCT FROM EXCLUDED.content_hash OR v_force = 1;

    RETURN QUERY
    SELECT 1::int, NULL::text, c.chunk_id, c.section_anchor, c.chunk_index, c.content_hash
    FROM public.assistant_kb_chunk c
    WHERE c.source = v_source AND c.section_anchor = v_anchor AND c.chunk_index = v_idx;
END;
$$;

-- assistant_kb_chunk_get: fetch all sub-chunks for an anchor (used by kb_get_section tool).
DROP FUNCTION IF EXISTS public.assistant_kb_chunk_get(text, text);
CREATE FUNCTION public.assistant_kb_chunk_get(
    p_section_anchor text DEFAULT NULL,
    p_source         text DEFAULT NULL
)
RETURNS TABLE (
    success         int,
    error           text,
    chunk_id        bigint,
    source          text,
    section_anchor  text,
    chunk_index     int,
    title           text,
    body            text,
    summary         text,
    keywords        text,
    permission_key  text,
    token_estimate  int,
    ingested_at     timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_anchor text := NULLIF(btrim(coalesce(p_section_anchor, '')), '');
BEGIN
    IF v_anchor IS NULL THEN
        RETURN QUERY SELECT 0, 'p_section_anchor is required.',
            NULL::bigint, NULL::text, NULL::text, NULL::int, NULL::text, NULL::text,
            NULL::text, NULL::text, NULL::text, NULL::int, NULL::timestamptz;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 1, NULL::text,
        c.chunk_id, c.source, c.section_anchor, c.chunk_index,
        c.title, c.body, c.summary, c.keywords, c.permission_key,
        c.token_estimate, c.ingested_at
    FROM public.assistant_kb_chunk c
    WHERE c.section_anchor = v_anchor
      AND (p_source IS NULL OR p_source = '' OR c.source = p_source)
    ORDER BY c.chunk_index ASC, c.ingested_at DESC;
END;
$$;

-- assistant_kb_search: keyword search over ingested chunks (chunks only for v1;
-- no learned kb_entry table in this phase). p_client_guid is required for a
-- consistent calling convention but is not (yet) used to scope the single
-- global corpus.
DROP FUNCTION IF EXISTS public.assistant_kb_search(text, text, int);
CREATE FUNCTION public.assistant_kb_search(
    p_query       text DEFAULT NULL,
    p_client_guid text DEFAULT NULL,
    p_top_n       int  DEFAULT 6
)
RETURNS TABLE (
    success        int,
    error          text,
    section_anchor text,
    title          text,
    snippet        text,
    score          numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_client text   := NULLIF(btrim(coalesce(p_client_guid, '')), '');
    v_query  text   := btrim(coalesce(p_query, ''));
    v_top_n  int    := GREATEST(1, COALESCE(p_top_n, 6));
    v_terms  text[];
BEGIN
    IF v_query = '' THEN
        RETURN QUERY SELECT 0, 'p_query is required.', NULL::text, NULL::text, NULL::text, NULL::numeric;
        RETURN;
    END IF;
    IF v_client IS NULL THEN
        RETURN QUERY SELECT 0, 'p_client_guid is required.', NULL::text, NULL::text, NULL::text, NULL::numeric;
        RETURN;
    END IF;

    v_terms := ARRAY(
        SELECT DISTINCT left(lower(trim(t)), 200)
        FROM unnest(string_to_array(
            regexp_replace(v_query, '[\t\r\n]+', ' ', 'g'), ' '
        )) AS t
        WHERE length(trim(t)) >= 3
    );
    IF array_length(v_terms, 1) IS NULL THEN
        v_terms := ARRAY[left(lower(v_query), 200)];
    END IF;

    RETURN QUERY
    WITH chunk_scored AS (
        SELECT
            c.section_anchor, c.title, c.summary,
            SUM(
                CASE WHEN strpos(lower(coalesce(c.keywords, '')), t) > 0 THEN 3 ELSE 0 END +
                CASE WHEN strpos(lower(coalesce(c.title, '')), t) > 0 THEN 2 ELSE 0 END +
                CASE WHEN strpos(lower(coalesce(c.summary, '')), t) > 0 THEN 1 ELSE 0 END +
                CASE WHEN strpos(lower(left(coalesce(c.body, ''), 8000)), t) > 0 THEN 1 ELSE 0 END
            ) AS relevance
        FROM public.assistant_kb_chunk c
        CROSS JOIN unnest(v_terms) AS t
        GROUP BY c.section_anchor, c.title, c.summary
    )
    SELECT 1, NULL::text, cs.section_anchor, cs.title, cs.summary, cs.relevance::numeric
    FROM chunk_scored cs
    WHERE cs.relevance > 0
    ORDER BY cs.relevance DESC, cs.title ASC
    LIMIT v_top_n;
END;
$$;

-- assistant_kb_meta_get / assistant_kb_meta_put: Tier-0 catalog singleton (meta_id = 1).
DROP FUNCTION IF EXISTS public.assistant_kb_meta_get();
CREATE FUNCTION public.assistant_kb_meta_get()
RETURNS TABLE (
    success         int,
    error           text,
    meta_id         int,
    catalog_text    text,
    catalog_version int,
    guide_sha256    text,
    rebuilt_at      timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    RETURN QUERY
    SELECT 1, NULL::text, m.meta_id, m.catalog_text, m.catalog_version, m.guide_sha256, m.rebuilt_at
    FROM public.assistant_kb_meta m
    WHERE m.meta_id = 1;
END;
$$;

DROP FUNCTION IF EXISTS public.assistant_kb_meta_put(text, text, int);
CREATE FUNCTION public.assistant_kb_meta_put(
    p_catalog_text text DEFAULT NULL,
    p_guide_sha256 text DEFAULT NULL,
    p_bump_version int  DEFAULT 1
)
RETURNS TABLE (
    success         int,
    error           text,
    meta_id         int,
    catalog_version int,
    guide_sha256    text,
    rebuilt_at      timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
BEGIN
    -- ON CONSTRAINT (not the column-list form) because this function's
    -- RETURNS TABLE also declares a meta_id OUT param, which otherwise makes
    -- the ON CONFLICT column reference ambiguous.
    INSERT INTO public.assistant_kb_meta (meta_id, catalog_text, catalog_version, guide_sha256, rebuilt_at)
    VALUES (1, p_catalog_text, 1, p_guide_sha256, now())
    ON CONFLICT ON CONSTRAINT assistant_kb_meta_pkey DO UPDATE SET
        catalog_text    = COALESCE(EXCLUDED.catalog_text, assistant_kb_meta.catalog_text),
        guide_sha256    = COALESCE(EXCLUDED.guide_sha256, assistant_kb_meta.guide_sha256),
        catalog_version = CASE WHEN COALESCE(p_bump_version, 1) = 1
                               THEN assistant_kb_meta.catalog_version + 1
                               ELSE assistant_kb_meta.catalog_version END,
        rebuilt_at      = now();

    RETURN QUERY
    SELECT 1, NULL::text, m.meta_id, m.catalog_version, m.guide_sha256, m.rebuilt_at
    FROM public.assistant_kb_meta m WHERE m.meta_id = 1;
END;
$$;

-- ============================================================================
-- 5. CONVERSATION / MESSAGE / FEEDBACK FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS public.assistant_conversation_upsert(uuid, text, uuid, text, text);
CREATE FUNCTION public.assistant_conversation_upsert(
    p_conversation_guid uuid DEFAULT NULL,
    p_client_guid       text DEFAULT NULL,
    p_user_id           uuid DEFAULT NULL,
    p_title             text DEFAULT NULL,
    p_status            text DEFAULT NULL
)
RETURNS TABLE (
    success           int,
    error             text,
    conversation_guid uuid,
    client_guid       text,
    user_id           uuid,
    title             text,
    status            text,
    started_at        timestamptz,
    last_message_at   timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_client text := NULLIF(btrim(coalesce(p_client_guid, '')), '');
    v_guid   uuid := COALESCE(p_conversation_guid, gen_random_uuid());
BEGIN
    IF v_client IS NULL THEN
        RETURN QUERY SELECT 0, 'p_client_guid is required.',
            NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text,
            NULL::timestamptz, NULL::timestamptz;
        RETURN;
    END IF;

    -- Table aliases below are required, not stylistic: this function's
    -- RETURNS TABLE declares OUT params (conversation_guid, client_guid,
    -- title, status, ...) with the same names as assistant_conversation's
    -- columns, so bare column references in embedded SQL are ambiguous.
    IF p_conversation_guid IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.assistant_conversation ac
        WHERE ac.conversation_guid = p_conversation_guid AND ac.client_guid <> v_client
    ) THEN
        RETURN QUERY SELECT 0, 'Conversation not found for this client.',
            NULL::uuid, NULL::text, NULL::uuid, NULL::text, NULL::text,
            NULL::timestamptz, NULL::timestamptz;
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.assistant_conversation ac
        WHERE ac.conversation_guid = v_guid AND ac.client_guid = v_client
    ) THEN
        UPDATE public.assistant_conversation ac SET
            title           = COALESCE(p_title, ac.title),
            status          = COALESCE(p_status, ac.status),
            last_message_at = now()
        WHERE ac.conversation_guid = v_guid AND ac.client_guid = v_client;
    ELSE
        INSERT INTO public.assistant_conversation
            (conversation_guid, client_guid, user_id, title, status)
        VALUES
            (v_guid, v_client, p_user_id, p_title, COALESCE(p_status, 'active'));
    END IF;

    RETURN QUERY
    SELECT 1, NULL::text,
        c.conversation_guid, c.client_guid, c.user_id, c.title, c.status,
        c.started_at, c.last_message_at
    FROM public.assistant_conversation c
    WHERE c.conversation_guid = v_guid AND c.client_guid = v_client;
END;
$$;

DROP FUNCTION IF EXISTS public.assistant_message_insert(uuid, text, text, text, text, numeric);
CREATE FUNCTION public.assistant_message_insert(
    p_conversation_guid uuid           DEFAULT NULL,
    p_client_guid       text           DEFAULT NULL,
    p_role              text           DEFAULT NULL,
    p_content           text           DEFAULT NULL,
    p_cited_anchors     text           DEFAULT NULL,
    p_cost_cents        numeric(10, 4) DEFAULT NULL
)
RETURNS TABLE (success int, error text, message_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_client text := NULLIF(btrim(coalesce(p_client_guid, '')), '');
    v_mid    bigint;
BEGIN
    IF p_conversation_guid IS NULL THEN
        RETURN QUERY SELECT 0, 'p_conversation_guid is required.', NULL::bigint; RETURN;
    END IF;
    IF v_client IS NULL THEN
        RETURN QUERY SELECT 0, 'p_client_guid is required.', NULL::bigint; RETURN;
    END IF;
    IF p_role NOT IN ('user', 'assistant') THEN
        RETURN QUERY SELECT 0, 'p_role must be user or assistant.', NULL::bigint; RETURN;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.assistant_conversation
        WHERE conversation_guid = p_conversation_guid AND client_guid = v_client
    ) THEN
        RETURN QUERY SELECT 0, 'Conversation not found for this client.', NULL::bigint; RETURN;
    END IF;

    -- AS t + t.message_id: this function's RETURNS TABLE also declares a
    -- message_id OUT param, which would otherwise make a bare RETURNING
    -- message_id ambiguous.
    INSERT INTO public.assistant_message AS t
        (conversation_guid, client_guid, role, content, cited_anchors, cost_cents)
    VALUES
        (p_conversation_guid, v_client, p_role, p_content, p_cited_anchors, p_cost_cents)
    RETURNING t.message_id INTO v_mid;

    UPDATE public.assistant_conversation SET last_message_at = now()
    WHERE conversation_guid = p_conversation_guid AND client_guid = v_client;

    RETURN QUERY SELECT 1, NULL::text, v_mid;
END;
$$;

DROP FUNCTION IF EXISTS public.assistant_message_list(uuid, text, int);
CREATE FUNCTION public.assistant_message_list(
    p_conversation_guid uuid DEFAULT NULL,
    p_client_guid       text DEFAULT NULL,
    p_limit             int  DEFAULT 200
)
RETURNS TABLE (
    success           int,
    error             text,
    message_id        bigint,
    conversation_guid uuid,
    client_guid       text,
    role              text,
    content           text,
    cited_anchors     text,
    cost_cents        numeric,
    created_at        timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_client text := NULLIF(btrim(coalesce(p_client_guid, '')), '');
    v_limit  int  := GREATEST(1, COALESCE(p_limit, 200));
BEGIN
    IF p_conversation_guid IS NULL OR v_client IS NULL THEN
        RETURN QUERY SELECT 0, 'p_conversation_guid and p_client_guid are required.',
            NULL::bigint, NULL::uuid, NULL::text, NULL::text, NULL::text,
            NULL::text, NULL::numeric, NULL::timestamptz;
        RETURN;
    END IF;
    -- Aliased (ac.) because this function's RETURNS TABLE also declares
    -- conversation_guid/client_guid OUT params, which would otherwise make
    -- these bare references ambiguous.
    IF NOT EXISTS (
        SELECT 1 FROM public.assistant_conversation ac
        WHERE ac.conversation_guid = p_conversation_guid AND ac.client_guid = v_client
    ) THEN
        RETURN QUERY SELECT 0, 'Conversation not found for this client.',
            NULL::bigint, NULL::uuid, NULL::text, NULL::text, NULL::text,
            NULL::text, NULL::numeric, NULL::timestamptz;
        RETURN;
    END IF;

    RETURN QUERY
    SELECT 1, NULL::text,
        m.message_id, m.conversation_guid, m.client_guid, m.role,
        m.content, m.cited_anchors, m.cost_cents, m.created_at
    FROM public.assistant_message m
    WHERE m.conversation_guid = p_conversation_guid AND m.client_guid = v_client
    ORDER BY m.message_id ASC
    LIMIT v_limit;
END;
$$;

DROP FUNCTION IF EXISTS public.assistant_feedback_insert(bigint, text, text, text, uuid);
CREATE FUNCTION public.assistant_feedback_insert(
    p_message_id  bigint DEFAULT NULL,
    p_client_guid text   DEFAULT NULL,
    p_rating      text   DEFAULT NULL,
    p_comment     text   DEFAULT NULL,
    p_user_id     uuid   DEFAULT NULL
)
RETURNS TABLE (success int, error text, feedback_id bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_client    text := NULLIF(btrim(coalesce(p_client_guid, '')), '');
    v_conv_guid uuid;
    v_fid       bigint;
BEGIN
    IF p_message_id IS NULL OR v_client IS NULL THEN
        RETURN QUERY SELECT 0, 'p_message_id and p_client_guid are required.', NULL::bigint; RETURN;
    END IF;
    IF p_rating NOT IN ('up', 'down') THEN
        RETURN QUERY SELECT 0, 'p_rating must be up or down.', NULL::bigint; RETURN;
    END IF;

    SELECT m.conversation_guid INTO v_conv_guid
    FROM public.assistant_message m
    WHERE m.message_id = p_message_id AND m.client_guid = v_client;

    IF v_conv_guid IS NULL THEN
        RETURN QUERY SELECT 0, 'Message not found for this client.', NULL::bigint; RETURN;
    END IF;

    -- AS t + t.feedback_id: this function's RETURNS TABLE also declares a
    -- feedback_id OUT param, which would otherwise make a bare RETURNING
    -- feedback_id ambiguous.
    INSERT INTO public.assistant_feedback AS t
        (message_id, conversation_guid, rating, comment, user_id)
    VALUES
        (p_message_id, v_conv_guid, p_rating, p_comment, p_user_id)
    RETURNING t.feedback_id INTO v_fid;

    RETURN QUERY SELECT 1, NULL::text, v_fid;
END;
$$;

-- ============================================================================
-- 6. FLAGS / BUDGET FUNCTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS public.assistant_flags_get(text);
CREATE FUNCTION public.assistant_flags_get(
    p_client_guid text DEFAULT NULL
)
RETURNS TABLE (
    success              int,
    error                text,
    assistant_enabled    int,
    assistant_model      text,
    default_budget_cents int
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_client text := NULLIF(btrim(coalesce(p_client_guid, '')), '');
    v_row    public.assistant_client;
BEGIN
    IF v_client IS NULL THEN
        RETURN QUERY SELECT 0, 'p_client_guid is required.', NULL::int, NULL::text, NULL::int;
        RETURN;
    END IF;

    SELECT * INTO v_row FROM public.assistant_client c WHERE c.singleton AND c.client_guid::text = v_client;

    IF v_row.client_guid IS NULL THEN
        RETURN QUERY SELECT 0, 'Unknown client_guid.', NULL::int, NULL::text, NULL::int;
        RETURN;
    END IF;

    RETURN QUERY SELECT 1, NULL::text, v_row.assistant_enabled, v_row.assistant_model, v_row.default_budget_cents;
END;
$$;

-- assistant_check_budget: is there room in this calendar month's budget for
-- an estimated spend? Auto-creates the month's budget row from the client's
-- default_budget_cents on first call of a new month.
DROP FUNCTION IF EXISTS public.assistant_check_budget(int);
CREATE FUNCTION public.assistant_check_budget(
    p_estimated_cost_cents int DEFAULT 0
)
RETURNS TABLE (
    success         int,
    error           text,
    allowed         int,
    budget_cents    int,
    spent_cents     int,
    remaining_cents int,
    period_start    date
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_client  uuid;
    v_period  date := date_trunc('month', now())::date;
    v_default int;
    v_row     public.assistant_budget;
BEGIN
    BEGIN
        v_client := public.assistant_current_client_guid();
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 0, SQLERRM, 0, NULL::int, NULL::int, NULL::int, NULL::date;
        RETURN;
    END;

    SELECT default_budget_cents INTO v_default FROM public.assistant_client WHERE singleton;

    -- ON CONSTRAINT (not the column-list form) because this function's
    -- RETURNS TABLE declares an OUT parameter also named period_start,
    -- which otherwise makes the ON CONFLICT column reference ambiguous.
    INSERT INTO public.assistant_budget (client_guid, period_start, budget_cents, spent_cents)
    VALUES (v_client::text, v_period, COALESCE(v_default, 5000), 0)
    ON CONFLICT ON CONSTRAINT assistant_budget_pkey DO NOTHING;

    SELECT * INTO v_row FROM public.assistant_budget b
    WHERE b.client_guid = v_client::text AND b.period_start = v_period;

    RETURN QUERY SELECT
        1, NULL::text,
        CASE WHEN v_row.spent_cents + COALESCE(p_estimated_cost_cents, 0) <= v_row.budget_cents THEN 1 ELSE 0 END,
        v_row.budget_cents, v_row.spent_cents, v_row.budget_cents - v_row.spent_cents, v_period;
END;
$$;

-- assistant_record_usage: append a usage-log row and roll the cost into the
-- current month's assistant_budget.spent_cents.
DROP FUNCTION IF EXISTS public.assistant_record_usage(text, int, int, numeric, int, int, boolean, text);
CREATE FUNCTION public.assistant_record_usage(
    p_model         text    DEFAULT NULL,
    p_input_tokens  int     DEFAULT 0,
    p_output_tokens int     DEFAULT 0,
    p_cost_cents    numeric DEFAULT 0,
    p_latency_ms    int     DEFAULT NULL,
    p_http_status   int     DEFAULT NULL,
    p_success       boolean DEFAULT true,
    p_error_message text    DEFAULT NULL
)
RETURNS TABLE (success int, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_client uuid;
    v_period date := date_trunc('month', now())::date;
    v_default int;
BEGIN
    BEGIN
        v_client := public.assistant_current_client_guid();
    EXCEPTION WHEN OTHERS THEN
        RETURN QUERY SELECT 0, SQLERRM;
        RETURN;
    END;

    INSERT INTO public.assistant_usage_log (
        client_guid, model, input_tokens, output_tokens, cost_cents,
        latency_ms, http_status, success, error_message
    ) VALUES (
        v_client::text, p_model, COALESCE(p_input_tokens, 0), COALESCE(p_output_tokens, 0),
        COALESCE(p_cost_cents, 0), p_latency_ms, p_http_status, COALESCE(p_success, true), p_error_message
    );

    SELECT default_budget_cents INTO v_default FROM public.assistant_client WHERE singleton;

    INSERT INTO public.assistant_budget (client_guid, period_start, budget_cents, spent_cents)
    VALUES (v_client::text, v_period, COALESCE(v_default, 5000), 0)
    ON CONFLICT (client_guid, period_start) DO NOTHING;

    UPDATE public.assistant_budget
    SET spent_cents = spent_cents + CEIL(COALESCE(p_cost_cents, 0))::int,
        updated_at   = now()
    WHERE client_guid = v_client::text AND period_start = v_period;

    RETURN QUERY SELECT 1, NULL::text;
END;
$$;

-- ============================================================================
-- 7. auth_login_email — recreated to mint an assistant_sessions row alongside
--    the existing portal login token. Body otherwise unchanged from
--    20260708130000_users_first_last_name_replace_username.sql.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.auth_login_email(p_email text, p_password text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
declare
  u record;
  v_token text;
begin
  if coalesce(trim(p_email), '') = '' or coalesce(p_password, '') = '' then
    return json_build_object('success', false, 'message', 'Email and password are required.');
  end if;

  select usr.id, usr.email, usr.first_name, usr.last_name, usr.role, usr.role_id,
         r.role_name, usr.is_active, usr.password_hash
    into u
  from public.users usr
  left join public.roles r on r.id = usr.role_id
  where lower(usr.email) = lower(trim(p_email))
  limit 1;

  if u.id is null
     or u.password_hash is null
     or u.password_hash <> crypt(p_password, u.password_hash) then
    return json_build_object('success', false, 'message', 'Invalid email or password.');
  end if;

  if u.is_active is distinct from true then
    return json_build_object('success', false, 'message', 'This account is inactive.');
  end if;

  v_token := encode(gen_random_bytes(24), 'hex');

  -- Best-effort assistant session mint; never block sign-in on this.
  begin
    perform public.assistant_session_upsert(v_token, u.id);
  exception when others then
    raise warning 'assistant_session_upsert failed during auth_login_email: %', sqlerrm;
  end;

  return json_build_object(
    'success', true,
    'token', v_token,
    'user', json_build_object(
      'id', u.id,
      'email', u.email,
      'first_name', u.first_name,
      'last_name', u.last_name,
      'role', u.role,
      'role_id', u.role_id,
      'role_name', u.role_name,
      'is_active', u.is_active
    )
  );
end;
$$;

GRANT EXECUTE ON FUNCTION public.auth_login_email(text, text) TO anon, authenticated, service_role;

-- ============================================================================
-- 8. GRANTS
-- ============================================================================

-- anon + authenticated + service_role: logout only (safe — requires the raw
-- token and never reveals whether it matched anything).
REVOKE ALL ON FUNCTION public.auth_logout(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_logout(text) TO anon, authenticated, service_role;

-- service_role only: everything else the edge function calls.
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'assistant_current_client_guid()',
        'assistant_session_upsert(text,uuid)',
        'assistant_validate_session(text)',
        'assistant_kb_chunk_upsert(text,text,int,text,text,text,text,text,int,text,int)',
        'assistant_kb_chunk_get(text,text)',
        'assistant_kb_search(text,text,int)',
        'assistant_kb_meta_get()',
        'assistant_kb_meta_put(text,text,int)',
        'assistant_conversation_upsert(uuid,text,uuid,text,text)',
        'assistant_message_insert(uuid,text,text,text,text,numeric)',
        'assistant_message_list(uuid,text,int)',
        'assistant_feedback_insert(bigint,text,text,text,uuid)',
        'assistant_flags_get(text)',
        'assistant_check_budget(int)',
        'assistant_record_usage(text,int,int,numeric,int,int,boolean,text)'
    ]
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', fn);
        EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 9. ENABLEMENT (soak) — NOT run by this migration. Run by hand in Supabase
--    SQL editor (or via scripts/apply-migration.mjs with a follow-up file)
--    once the KB has been ingested and the edge function is deployed:
--
--      UPDATE public.assistant_client
--      SET assistant_enabled = 1, updated_at = now()
--      WHERE singleton;
--
--    To disable again:
--      UPDATE public.assistant_client
--      SET assistant_enabled = 0, updated_at = now()
--      WHERE singleton;
-- ============================================================================
