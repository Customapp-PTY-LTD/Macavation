-- Bulk import (Data Import module, Import Oil Lots) never actually worked.
--
-- 20260108000008 built the insert as:
--     INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)
-- "SELECT *" supplies EVERY column of the table, so any column the JSON row omits is
-- passed explicitly as NULL and the column DEFAULT never applies. On contacts that means
-- id arrives NULL and every import dies with:
--     null value in column "id" of relation "contacts" violates not-null constraint
-- Any table whose primary key relies on a DEFAULT was affected.
--
-- Fix: name only the columns the row actually supplies, so omitted columns fall back to
-- their DEFAULT (id -> gen_random_uuid(), created_at -> now()). jsonb_populate_record is
-- still used, so JSON values keep being coerced to the real column types.
--
-- Also: reject keys that are not columns instead of silently dropping them. A mis-mapped
-- Excel column in the Data Import UI should fail loudly, not import partial rows.

CREATE OR REPLACE FUNCTION public.import_table_rows(
    p_table_name text,
    p_rows jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_row jsonb;
    v_sql text;
    v_count integer := 0;
    v_cols text;
    v_unknown text;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RETURN json_build_object('success', false, 'message', 'p_rows must be a JSON array');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = p_table_name
    ) THEN
        RETURN json_build_object('success', false, 'message', format('Unknown table: %s', p_table_name));
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        IF jsonb_typeof(v_row) <> 'object' THEN
            RETURN json_build_object('success', false, 'message', 'Each row in p_rows must be a JSON object');
        END IF;

        SELECT string_agg(k, ', ' ORDER BY k) INTO v_unknown
        FROM jsonb_object_keys(v_row) AS k
        WHERE NOT EXISTS (
            SELECT 1 FROM information_schema.columns c
            WHERE c.table_schema = 'public'
              AND c.table_name = p_table_name
              AND c.column_name = k
        );

        IF v_unknown IS NOT NULL THEN
            RETURN json_build_object(
                'success', false,
                'message', format('Unknown column(s) for %s: %s', p_table_name, v_unknown)
            );
        END IF;

        SELECT string_agg(quote_ident(k), ', ' ORDER BY k) INTO v_cols
        FROM jsonb_object_keys(v_row) AS k;

        -- An empty object carries nothing to insert; skip it rather than emitting
        -- "INSERT INTO t () SELECT", which is a syntax error.
        IF v_cols IS NULL THEN
            CONTINUE;
        END IF;

        v_sql := format(
            'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(NULL::public.%I, $1)',
            p_table_name, v_cols, v_cols, p_table_name
        );
        EXECUTE v_sql USING v_row;
        v_count := v_count + 1;
    END LOOP;

    RETURN json_build_object(
        'success', true,
        'message', format('Imported %s rows into %s', v_count, p_table_name),
        'count', v_count
    );
END;
$function$;

COMMENT ON FUNCTION public.import_table_rows(text, jsonb) IS
'Bulk-inserts a JSON array of row objects into a public table. Only keys present on each row are inserted, so omitted columns keep their DEFAULT. Unknown keys are rejected.';
