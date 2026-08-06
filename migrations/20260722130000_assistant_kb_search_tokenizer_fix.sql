-- 20260722130000_assistant_kb_search_tokenizer_fix.sql
-- Fixes two real bugs in assistant_kb_search's query tokenizer that were
-- suppressing the portal-assistant zero-token KB fast path (see
-- FAST_PATH_MIN_SCORE / FAST_PATH_DOMINANCE_RATIO in
-- supabase/functions/portal-assistant/index.ts):
--
--   1. Tokens were split on whitespace only, so trailing punctuation stayed
--      glued to the last word of every query ("customer?", "hand?", "day?").
--      That word then matched nothing, silently dropping it from scoring —
--      and real how-to questions almost always end in "?".
--   2. No stopword filtering, so near-universal guide filler words ("how",
--      "use", "open", ...) that appear in almost every section's boilerplate
--      ("How to use this screen...") scored on every hit, flattening the
--      score gap between the right section and everything else.
--
-- Signature and return shape are unchanged; only the tokenizer inside the
-- function body changes. Same DROP + CREATE convention as
-- migrations/20260716160000_portal_assistant_chat.sql (this repo does not
-- use CREATE OR REPLACE for these).

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

    -- Split on whitespace, strip leading/trailing punctuation per token
    -- (fix #1), drop near-universal filler words (fix #2), keep terms >= 3
    -- chars, cap at 200 chars each.
    v_terms := ARRAY(
        SELECT DISTINCT left(t2, 200)
        FROM (
            SELECT regexp_replace(lower(trim(t)), '^[^a-z0-9]+|[^a-z0-9]+$', '', 'g') AS t2
            FROM unnest(string_to_array(
                regexp_replace(v_query, '[\t\r\n]+', ' ', 'g'), ' '
            )) AS t
        ) stripped
        WHERE length(t2) >= 3
          AND t2 <> ALL (ARRAY[
              'how', 'the', 'and', 'for', 'use', 'this', 'your', 'from',
              'when', 'with', 'are', 'you', 'can', 'get', 'set', 'not',
              'has', 'have', 'that', 'what', 'where', 'open'
          ])
    );
    -- Fallback: no terms survived (e.g. an all-stopword query) - use the
    -- whole query as one term rather than searching with nothing.
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

-- DROP FUNCTION removes previously granted privileges too - re-grant
-- service_role-only access exactly as migrations/20260716160000 did.
REVOKE ALL ON FUNCTION public.assistant_kb_search(text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assistant_kb_search(text, text, int) FROM anon;
REVOKE ALL ON FUNCTION public.assistant_kb_search(text, text, int) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assistant_kb_search(text, text, int) TO service_role;

NOTIFY pgrst, 'reload schema';
