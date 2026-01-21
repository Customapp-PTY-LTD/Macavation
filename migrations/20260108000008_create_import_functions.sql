-- Utility: Get columns for a public table
CREATE OR REPLACE FUNCTION public.get_table_columns(
    p_table_name text
)
RETURNS TABLE (
    column_name text,
    data_type text,
    is_nullable boolean,
    has_default boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
    RETURN QUERY
    SELECT
        c.column_name,
        c.data_type,
        (c.is_nullable = 'YES') AS is_nullable,
        (c.column_default IS NOT NULL) AS has_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = p_table_name
    ORDER BY c.ordinal_position;
END;
$function$;

-- Bulk import rows into a table using jsonb_populate_record
CREATE OR REPLACE FUNCTION public.import_table_rows(
    p_table_name text,
    p_rows jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
    v_row jsonb;
    v_sql text;
    v_count integer := 0;
BEGIN
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RETURN json_build_object('success', false, 'message', 'p_rows must be a JSON array');
    END IF;

    FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
    LOOP
        -- Build dynamic insert using jsonb_populate_record into the target table row type
        v_sql := format('INSERT INTO public.%I SELECT * FROM jsonb_populate_record(NULL::public.%I, $1)', p_table_name, p_table_name);
        EXECUTE v_sql USING v_row;
        v_count := v_count + 1;
    END LOOP;

    RETURN json_build_object('success', true, 'message', format('Imported %s rows into %s', v_count, p_table_name), 'count', v_count);
END;
$function$;
