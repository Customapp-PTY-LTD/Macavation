-- Fill everything from a file (Data health): one workbook, several pages, one Undo.
--
-- Builds on 20261015090000_data_page_import_batches.sql. A whole-workbook import still writes one
-- data_import_batches row per page (so each page's edit history and the per-batch undo keep working),
-- and ties them together with import_group_id:
--   * import_data_pages        - saves every page through import_data_page_rows in ONE transaction:
--                                if any page fails, nothing from the file is saved
--   * undo_data_import_group   - undoes every batch in the group (undo_data_import_batch per batch)
--   * get_data_import_batches  - now also returns import_group_id, so Recent imports can show one
--                                line per file (the return type changes, so the old version is
--                                renamed to get_data_import_batches_pre_20261015 and recreated)
--
-- Accepted exposure: same as the functions beside them - SECURITY DEFINER and granted to anon,
-- because every portal RPC runs with the anon key (WebPortal/js/data-functions.js, useAnonAuth).
--
-- Down (documented, not run):
--   DROP FUNCTION public.import_data_pages(text, jsonb, uuid);
--   DROP FUNCTION public.undo_data_import_group(uuid, uuid);
--   DROP FUNCTION public.get_data_import_batches(text, integer);
--   ALTER FUNCTION public.get_data_import_batches_pre_20261015(text, integer) RENAME TO get_data_import_batches;
--   and re-grant it as in 20261015090000 section 7;
--   ALTER TABLE public.data_import_batches DROP COLUMN import_group_id;

-- ============================================================================
-- 1. Group column
-- ============================================================================

ALTER TABLE public.data_import_batches ADD COLUMN IF NOT EXISTS import_group_id uuid;

CREATE INDEX IF NOT EXISTS ix_data_import_batches_group
    ON public.data_import_batches (import_group_id) WHERE import_group_id IS NOT NULL;

-- ============================================================================
-- 2. import_data_pages
-- ============================================================================
-- p_pages: [{"dataset_key": "nis_intake", "rows": [...]}, ...] - at most one entry per page.
-- Each page goes through import_data_page_rows unchanged (same validation, natural-key clash check,
-- data_source = 'imported', oil twin linking). A page that comes back success = 0 raises, and the
-- surrounding block rolls back every page already written, so the file is all-or-nothing.

CREATE OR REPLACE FUNCTION public.import_data_pages(
    p_file_name     text,
    p_pages         jsonb,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE(success integer, error text, group_id uuid, batches jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group uuid := gen_random_uuid();
    v_page  jsonb;
    v_key   text;
    v_res   record;
    v_out   jsonb := '[]'::jsonb;
    v_label text;
BEGIN
    IF p_pages IS NULL OR jsonb_typeof(p_pages) <> 'array' OR jsonb_array_length(p_pages) = 0 THEN
        RETURN QUERY SELECT 0, 'Nothing was sent to save.', NULL::uuid, '[]'::jsonb; RETURN;
    END IF;
    IF jsonb_array_length(p_pages) > 4 THEN
        RETURN QUERY SELECT 0, 'A file can fill at most four pages.', NULL::uuid, '[]'::jsonb; RETURN;
    END IF;
    IF (SELECT count(DISTINCT p ->> 'dataset_key') FROM jsonb_array_elements(p_pages) p) <> jsonb_array_length(p_pages) THEN
        RETURN QUERY SELECT 0, 'Each page may appear only once.', NULL::uuid, '[]'::jsonb; RETURN;
    END IF;

    BEGIN
        FOR v_page IN SELECT value FROM jsonb_array_elements(p_pages) LOOP
            v_key := v_page ->> 'dataset_key';
            v_label := CASE v_key
                WHEN 'nis_intake' THEN 'Nut in Shell Intake'
                WHEN 'kernel_sales_lines' THEN 'Kernel Sales'
                WHEN 'oil_sales_lines' THEN 'Oil & Protein Sales'
                WHEN 'oil_export_register' THEN 'Oil Export Register'
                ELSE coalesce(v_key, 'A page') END;

            SELECT * INTO v_res
            FROM public.import_data_page_rows(v_key, p_file_name, 'spreadsheet', v_page -> 'rows', p_actor_user_id);

            IF v_res.success IS DISTINCT FROM 1 THEN
                RAISE EXCEPTION USING ERRCODE = 'P0001',
                    MESSAGE = v_label || ': ' || replace(coalesce(v_res.error, 'could not be saved.'), ' Nothing was saved.', '');
            END IF;

            UPDATE public.data_import_batches b SET import_group_id = v_group WHERE b.id = v_res.batch_id;

            v_out := v_out || jsonb_build_array(jsonb_build_object(
                'dataset_key', v_key, 'batch_id', v_res.batch_id,
                'rows_written', v_res.rows_written, 'twins_linked', v_res.twins_linked));
        END LOOP;
    EXCEPTION
        WHEN raise_exception THEN
            RETURN QUERY SELECT 0, SQLERRM || ' Nothing from this file was saved.', NULL::uuid, '[]'::jsonb;
            RETURN;
    END;

    RETURN QUERY SELECT 1, NULL::text, v_group, v_out;
END;
$$;

-- ============================================================================
-- 3. undo_data_import_group
-- ============================================================================

CREATE OR REPLACE FUNCTION public.undo_data_import_group(p_group_id uuid, p_actor_user_id uuid DEFAULT NULL)
RETURNS TABLE(success integer, error text, rows_deleted integer, rows_kept integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id   uuid;
    v_res  record;
    v_del  integer := 0;
    v_kept integer := 0;
    v_any  boolean := false;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.data_import_batches b WHERE b.import_group_id = p_group_id) THEN
        RETURN QUERY SELECT 0, 'That import was not found.', 0, 0; RETURN;
    END IF;

    FOR v_id IN
        SELECT b.id FROM public.data_import_batches b
        WHERE b.import_group_id = p_group_id AND b.undone_at IS NULL
        ORDER BY b.created_at
    LOOP
        v_any := true;
        SELECT * INTO v_res FROM public.undo_data_import_batch(v_id, p_actor_user_id);
        IF v_res.success = 1 THEN
            v_del := v_del + coalesce(v_res.rows_deleted, 0);
            v_kept := v_kept + coalesce(v_res.rows_kept, 0);
        END IF;
    END LOOP;

    IF NOT v_any THEN
        RETURN QUERY SELECT 0, 'That import has already been undone.', 0, 0; RETURN;
    END IF;
    RETURN QUERY SELECT 1, NULL::text, v_del, v_kept;
END;
$$;

-- ============================================================================
-- 4. get_data_import_batches, now with import_group_id
-- ============================================================================

-- The return type changes, so the old version is renamed out of the way (and revoked) rather than
-- dropped: nothing is destroyed, and the rename is reversible. It can be removed in a later
-- migration once this one is on every database.
DO $$
BEGIN
    IF to_regprocedure('public.get_data_import_batches(text, integer)') IS NOT NULL
       AND NOT EXISTS (
           SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname = 'get_data_import_batches'
             AND pg_get_function_result(p.oid) LIKE '%import_group_id%') THEN
        ALTER FUNCTION public.get_data_import_batches(text, integer) RENAME TO get_data_import_batches_pre_20261015;
        REVOKE ALL ON FUNCTION public.get_data_import_batches_pre_20261015(text, integer) FROM PUBLIC, anon, authenticated;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_data_import_batches(p_dataset_key text DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, dataset_key text, file_name text, source_kind text, row_count integer,
              total_qty numeric, twins_linked integer, created_by uuid, created_by_name text,
              created_at timestamptz, undone_at timestamptz, rows_kept_on_undo integer,
              import_group_id uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.id, b.dataset_key, b.file_name, b.source_kind, b.row_count, b.total_qty, b.twins_linked,
           b.created_by, public.stock_history_user_label(b.created_by), b.created_at, b.undone_at,
           b.rows_kept_on_undo, b.import_group_id
    FROM public.data_import_batches b
    WHERE p_dataset_key IS NULL OR b.dataset_key = p_dataset_key
    ORDER BY b.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

-- ============================================================================
-- 5. Grants
-- ============================================================================

REVOKE ALL ON FUNCTION public.import_data_pages(text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_data_import_group(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_data_import_batches(text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.import_data_pages(text, jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_data_import_group(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_import_batches(text, integer) TO anon, authenticated, service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key = 'sales-data-grid'
CROSS JOIN unnest(ARRAY['import_data_pages', 'undo_data_import_group']) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
