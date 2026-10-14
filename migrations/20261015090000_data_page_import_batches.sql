-- Fill gaps from a file: import batches for the four ledger data pages (Data health tab).
--
-- The existing upsert_data_* RPCs hard-code data_source = 'manual' on insert and update, so an
-- import cannot go through them and still be told apart. This adds:
--   * data_import_batches - one row per import, so a whole file can be undone in one go
--   * import_batch_id on the four ledgers (data_nis_intake, data_kernel_sales_lines,
--     data_oil_sales_lines, data_oil_export_register)
--   * import_data_page_rows   - insert-only, data_source = 'imported', one transaction per file
--   * undo_data_import_batch  - deletes the batch's rows that are still 'imported'; a row someone has
--                               since edited is 'manual' again (the upserts set it) and is kept
--   * get_data_import_batches - the "Recent imports" list
--   * data_import_role_can_edit - used by the read-import-file edge function (service role only)
--
-- Accepted exposure: like the upsert_data_* / delete_data_* functions beside them, import and undo
-- are SECURITY DEFINER and granted to anon, because every portal RPC runs with the anon key
-- (WebPortal/js/data-functions.js, useAnonAuth). role_permissions rows below are bookkeeping.

-- ============================================================================
-- 1. Batches
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.data_import_batches (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_key       text NOT NULL CHECK (dataset_key IN ('nis_intake', 'kernel_sales_lines', 'oil_sales_lines', 'oil_export_register')),
    file_name         text NOT NULL,
    source_kind       text NOT NULL CHECK (source_kind IN ('spreadsheet', 'document')),
    row_count         integer NOT NULL,
    total_qty         numeric NOT NULL DEFAULT 0,
    twins_linked      integer NOT NULL DEFAULT 0,
    created_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    undone_at         timestamptz,
    undone_by         uuid,
    rows_kept_on_undo integer
);

CREATE INDEX IF NOT EXISTS ix_data_import_batches_created ON public.data_import_batches (created_at DESC);

ALTER TABLE public.data_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.data_import_batches FROM anon, authenticated;

-- ============================================================================
-- 2. Batch column on the four ledgers
-- ============================================================================

ALTER TABLE public.data_nis_intake
    ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.data_import_batches (id) ON DELETE SET NULL;
ALTER TABLE public.data_kernel_sales_lines
    ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.data_import_batches (id) ON DELETE SET NULL;
ALTER TABLE public.data_oil_sales_lines
    ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.data_import_batches (id) ON DELETE SET NULL;
ALTER TABLE public.data_oil_export_register
    ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES public.data_import_batches (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_data_nis_intake_import_batch ON public.data_nis_intake (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_data_kernel_sales_lines_import_batch ON public.data_kernel_sales_lines (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_data_oil_sales_lines_import_batch ON public.data_oil_sales_lines (import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_data_oil_export_register_import_batch ON public.data_oil_export_register (import_batch_id) WHERE import_batch_id IS NOT NULL;

-- ============================================================================
-- 3. import_data_page_rows
-- ============================================================================
-- Insert-only. Column lists are the upsert_data_* INSERT lists plus data_source = 'imported',
-- import_batch_id and edit_reason. Natural keys (the unique indexes) are checked first, against the
-- table and within the file, so a clash comes back as a plain sentence rather than aborting with a
-- raw Postgres error; the INSERT is still wrapped in case a constraint is hit anyway.

CREATE OR REPLACE FUNCTION public.import_data_page_rows(
    p_dataset_key   text,
    p_file_name     text,
    p_source_kind   text,
    p_rows          jsonb,
    p_actor_user_id uuid DEFAULT NULL
)
RETURNS TABLE(success integer, error text, batch_id uuid, rows_written integer, twins_linked integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_batch    uuid;
    v_n        integer;
    v_written  integer := 0;
    v_twins    integer := 0;
    v_total    numeric := 0;
    v_clash    text;
    v_reason   text;
    v_date_key text;
BEGIN
    IF p_dataset_key NOT IN ('nis_intake', 'kernel_sales_lines', 'oil_sales_lines', 'oil_export_register') THEN
        RETURN QUERY SELECT 0, 'This page cannot be imported into.', NULL::uuid, 0, 0; RETURN;
    END IF;
    IF p_source_kind NOT IN ('spreadsheet', 'document') THEN
        RETURN QUERY SELECT 0, 'Unknown file type.', NULL::uuid, 0, 0; RETURN;
    END IF;
    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RETURN QUERY SELECT 0, 'No rows were sent.', NULL::uuid, 0, 0; RETURN;
    END IF;
    v_n := jsonb_array_length(p_rows);
    IF v_n = 0 OR v_n > 2000 THEN
        RETURN QUERY SELECT 0, 'An import must have between 1 and 2000 rows.', NULL::uuid, 0, 0; RETURN;
    END IF;
    IF coalesce(trim(p_file_name), '') = '' THEN
        RETURN QUERY SELECT 0, 'The file name is missing.', NULL::uuid, 0, 0; RETURN;
    END IF;
    v_reason := left('Imported from ' || trim(p_file_name), 300);

    v_date_key := CASE p_dataset_key
        WHEN 'nis_intake' THEN 'received_date'
        WHEN 'oil_export_register' THEN 'export_date'
        ELSE 'sale_date' END;

    -- Every row needs its date; quantities must not be negative.
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE NULLIF(r ->> v_date_key, '') IS NULL) THEN
        RETURN QUERY SELECT 0, 'Every row needs a date.', NULL::uuid, 0, 0; RETURN;
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_rows) r
        WHERE COALESCE(NULLIF(r ->> 'nis_kg', '')::numeric, NULLIF(r ->> 'quantity_kg', '')::numeric,
                       NULLIF(r ->> 'weight_kg', '')::numeric, 0) < 0
    ) THEN
        RETURN QUERY SELECT 0, 'A quantity cannot be negative.', NULL::uuid, 0, 0; RETURN;
    END IF;

    -- Natural-key clashes, against the table and within the file.
    IF p_dataset_key = 'nis_intake' THEN
        WITH f AS (
            SELECT NULLIF(r ->> 'batch_number', '') AS b, NULLIF(r ->> 'received_date', '')::date AS d,
                   COALESCE(NULLIF(r ->> 'nis_kg', '')::numeric, 0) AS kg
            FROM jsonb_array_elements(p_rows) r
        ), clash AS (
            SELECT DISTINCT f.d, f.b FROM f
            WHERE f.b IS NOT NULL AND (
                EXISTS (SELECT 1 FROM public.data_nis_intake t WHERE t.batch_number = f.b AND t.received_date = f.d AND t.nis_kg = f.kg)
                OR (SELECT count(*) FROM f f2 WHERE f2.b = f.b AND f2.d = f.d AND f2.kg = f.kg) > 1)
        )
        SELECT string_agg(to_char(d, 'DD Mon') || ' ' || b, ', ') INTO v_clash FROM (SELECT * FROM clash LIMIT 5) x;
    ELSIF p_dataset_key IN ('kernel_sales_lines', 'oil_sales_lines') THEN
        WITH f AS (
            SELECT NULLIF(r ->> 'invoice_number', '') AS inv, COALESCE(NULLIF(r ->> 'item_code', ''), '') AS item,
                   COALESCE(NULLIF(r ->> 'quantity_kg', '')::numeric, 0) AS kg, NULLIF(r ->> 'sale_date', '')::date AS d
            FROM jsonb_array_elements(p_rows) r
        ), clash AS (
            SELECT DISTINCT f.d, f.inv FROM f
            WHERE f.inv IS NOT NULL AND (
                (p_dataset_key = 'kernel_sales_lines' AND EXISTS (SELECT 1 FROM public.data_kernel_sales_lines t
                    WHERE t.invoice_number = f.inv AND COALESCE(t.item_code, '') = f.item AND t.quantity_kg = f.kg AND t.sale_date = f.d))
                OR (p_dataset_key = 'oil_sales_lines' AND EXISTS (SELECT 1 FROM public.data_oil_sales_lines t
                    WHERE t.invoice_number = f.inv AND COALESCE(t.item_code, '') = f.item AND t.quantity_kg = f.kg AND t.sale_date = f.d))
                OR (SELECT count(*) FROM f f2 WHERE f2.inv = f.inv AND f2.item = f.item AND f2.kg = f.kg AND f2.d = f.d) > 1)
        )
        SELECT string_agg(to_char(d, 'DD Mon') || ' invoice ' || inv, ', ') INTO v_clash FROM (SELECT * FROM clash LIMIT 5) x;
    ELSE
        WITH f AS (
            SELECT NULLIF(r ->> 'document_number', '') AS doc FROM jsonb_array_elements(p_rows) r
        ), clash AS (
            SELECT DISTINCT f.doc FROM f
            WHERE f.doc IS NOT NULL AND (
                EXISTS (SELECT 1 FROM public.data_oil_export_register t WHERE t.document_number = f.doc)
                OR (SELECT count(*) FROM f f2 WHERE f2.doc = f.doc) > 1)
        )
        SELECT string_agg('document ' || doc, ', ') INTO v_clash FROM (SELECT * FROM clash LIMIT 5) x;
    END IF;
    IF v_clash IS NOT NULL THEN
        RETURN QUERY SELECT 0, 'These rows are already in the system (or twice in the file): ' || v_clash
            || '. Untick them and try again.', NULL::uuid, 0, 0;
        RETURN;
    END IF;

    BEGIN
        INSERT INTO public.data_import_batches (dataset_key, file_name, source_kind, row_count, created_by)
        VALUES (p_dataset_key, left(trim(p_file_name), 300), p_source_kind, v_n, p_actor_user_id)
        RETURNING id INTO v_batch;

        IF p_dataset_key = 'nis_intake' THEN
            INSERT INTO public.data_nis_intake
                (received_date, supplier_id, supplier_name, supplier_number, job_number, batch_number,
                 nis_kg, moisture_pct, pv, ffa_pct, sample_skr_pct, sample_uskr_pct, status_note, notes,
                 data_source, edited_by, edited_at, edit_reason, import_batch_id)
            SELECT NULLIF(r ->> 'received_date', '')::date, NULLIF(r ->> 'supplier_id', '')::uuid,
                   COALESCE(r ->> 'supplier_name', ''), NULLIF(r ->> 'supplier_number', '')::integer,
                   NULLIF(r ->> 'job_number', ''), NULLIF(r ->> 'batch_number', ''),
                   COALESCE(NULLIF(r ->> 'nis_kg', '')::numeric, 0),
                   NULLIF(r ->> 'moisture_pct', '')::numeric, NULLIF(r ->> 'pv', '')::numeric,
                   NULLIF(r ->> 'ffa_pct', '')::numeric, NULLIF(r ->> 'sample_skr_pct', '')::numeric,
                   NULLIF(r ->> 'sample_uskr_pct', '')::numeric, NULLIF(r ->> 'status_note', ''),
                   NULLIF(r ->> 'notes', ''), 'imported', p_actor_user_id, now(), v_reason, v_batch
            FROM jsonb_array_elements(p_rows) r;
            GET DIAGNOSTICS v_written = ROW_COUNT;
            SELECT COALESCE(sum(nis_kg), 0) INTO v_total FROM public.data_nis_intake WHERE import_batch_id = v_batch;

        ELSIF p_dataset_key = 'kernel_sales_lines' THEN
            INSERT INTO public.data_kernel_sales_lines
                (sale_date, customer_id, customer_name, invoice_number, item_code, style_code, description,
                 cartons, quantity_kg, price_per_kg, vat_excl_zar, vat_zar, vat_incl_zar, notes,
                 data_source, edited_by, edited_at, edit_reason, import_batch_id)
            SELECT NULLIF(r ->> 'sale_date', '')::date, NULLIF(r ->> 'customer_id', '')::uuid,
                   COALESCE(r ->> 'customer_name', ''), NULLIF(r ->> 'invoice_number', ''),
                   NULLIF(r ->> 'item_code', ''), NULLIF(r ->> 'style_code', ''), NULLIF(r ->> 'description', ''),
                   NULLIF(r ->> 'cartons', '')::numeric, COALESCE(NULLIF(r ->> 'quantity_kg', '')::numeric, 0),
                   NULLIF(r ->> 'price_per_kg', '')::numeric, COALESCE(NULLIF(r ->> 'vat_excl_zar', '')::numeric, 0),
                   COALESCE(NULLIF(r ->> 'vat_zar', '')::numeric, 0), COALESCE(NULLIF(r ->> 'vat_incl_zar', '')::numeric, 0),
                   NULLIF(r ->> 'notes', ''), 'imported', p_actor_user_id, now(), v_reason, v_batch
            FROM jsonb_array_elements(p_rows) r;
            GET DIAGNOSTICS v_written = ROW_COUNT;
            SELECT COALESCE(sum(quantity_kg), 0) INTO v_total FROM public.data_kernel_sales_lines WHERE import_batch_id = v_batch;

        ELSIF p_dataset_key = 'oil_sales_lines' THEN
            INSERT INTO public.data_oil_sales_lines
                (sale_date, customer_id, customer_name, invoice_number, item_code, product_line,
                 description, cartons, quantity_kg, price_per_kg, vat_excl_zar, vat_zar, vat_incl_zar,
                 notes, data_source, edited_by, edited_at, edit_reason, import_batch_id)
            SELECT NULLIF(r ->> 'sale_date', '')::date, NULLIF(r ->> 'customer_id', '')::uuid,
                   COALESCE(r ->> 'customer_name', ''), NULLIF(r ->> 'invoice_number', ''),
                   NULLIF(r ->> 'item_code', ''), NULLIF(r ->> 'product_line', ''),
                   NULLIF(r ->> 'description', ''), NULLIF(r ->> 'cartons', '')::numeric,
                   COALESCE(NULLIF(r ->> 'quantity_kg', '')::numeric, 0), NULLIF(r ->> 'price_per_kg', '')::numeric,
                   COALESCE(NULLIF(r ->> 'vat_excl_zar', '')::numeric, 0), COALESCE(NULLIF(r ->> 'vat_zar', '')::numeric, 0),
                   COALESCE(NULLIF(r ->> 'vat_incl_zar', '')::numeric, 0),
                   NULLIF(r ->> 'notes', ''), 'imported', p_actor_user_id, now(), v_reason, v_batch
            FROM jsonb_array_elements(p_rows) r;
            GET DIAGNOSTICS v_written = ROW_COUNT;
            SELECT COALESCE(sum(quantity_kg), 0) INTO v_total FROM public.data_oil_sales_lines WHERE import_batch_id = v_batch;

        ELSE
            INSERT INTO public.data_oil_export_register
                (export_date, customer_id, customer_name, location_country, document_number, reference,
                 product_class, price_per_kg_usd, incoterm, weight_kg, usd_debit, load_count,
                 usd_zar_rate, rand_value, notes, data_source, edited_by, edited_at, edit_reason, import_batch_id)
            SELECT NULLIF(r ->> 'export_date', '')::date, NULLIF(r ->> 'customer_id', '')::uuid,
                   COALESCE(r ->> 'customer_name', ''), NULLIF(r ->> 'location_country', ''),
                   NULLIF(r ->> 'document_number', ''), NULLIF(r ->> 'reference', ''),
                   NULLIF(r ->> 'product_class', ''), NULLIF(r ->> 'price_per_kg_usd', '')::numeric,
                   NULLIF(r ->> 'incoterm', ''), NULLIF(r ->> 'weight_kg', '')::numeric,
                   NULLIF(r ->> 'usd_debit', '')::numeric, NULLIF(r ->> 'load_count', '')::numeric,
                   NULLIF(r ->> 'usd_zar_rate', '')::numeric, NULLIF(r ->> 'rand_value', '')::numeric,
                   NULLIF(r ->> 'notes', ''), 'imported', p_actor_user_id, now(), v_reason, v_batch
            FROM jsonb_array_elements(p_rows) r;
            GET DIAGNOSTICS v_written = ROW_COUNT;
            SELECT COALESCE(sum(weight_kg), 0) INTO v_total FROM public.data_oil_export_register WHERE import_batch_id = v_batch;
        END IF;

        -- Oil export twins: a local bulk line and a register row for the same container must not both
        -- count as revenue. Same rule as 20260821110000 section 2 (exactly one candidate each side,
        -- >= 1000 kg, weight within 0.51 kg, dates within 10 days), restricted to rows this batch added.
        IF p_dataset_key IN ('oil_sales_lines', 'oil_export_register') THEN
            WITH candidate AS (
                SELECT s.id AS local_id, e.id AS register_id,
                       COUNT(*) OVER (PARTITION BY s.id) AS matches_for_local,
                       COUNT(*) OVER (PARTITION BY e.id) AS matches_for_register
                FROM public.data_oil_sales_lines s
                JOIN public.data_oil_export_register e
                  ON e.weight_kg IS NOT NULL
                 AND s.quantity_kg IS NOT NULL
                 AND ABS(e.weight_kg - s.quantity_kg) < 0.51
                 AND e.export_date IS NOT NULL
                 AND ABS(e.export_date - s.sale_date) <= 10
                WHERE s.quantity_kg >= 1000
                  AND s.export_register_id IS NULL
                  AND NOT EXISTS (SELECT 1 FROM public.data_oil_sales_lines s2 WHERE s2.export_register_id = e.id)
            )
            UPDATE public.data_oil_sales_lines s
               SET export_register_id = c.register_id,
                   data_quality_flags = CASE
                       WHEN 'export_twin_auto_linked' = ANY (s.data_quality_flags) THEN s.data_quality_flags
                       ELSE s.data_quality_flags || 'export_twin_auto_linked'::text END
              FROM candidate c
             WHERE s.id = c.local_id
               AND c.matches_for_local = 1
               AND c.matches_for_register = 1
               AND (s.import_batch_id = v_batch
                    OR EXISTS (SELECT 1 FROM public.data_oil_export_register e2 WHERE e2.id = c.register_id AND e2.import_batch_id = v_batch));
            GET DIAGNOSTICS v_twins = ROW_COUNT;
        END IF;

        UPDATE public.data_import_batches b
           SET row_count = v_written, total_qty = v_total, twins_linked = v_twins
         WHERE b.id = v_batch;
    EXCEPTION
        WHEN unique_violation THEN
            RETURN QUERY SELECT 0, 'Some rows are already in the system. Nothing was saved; untick the duplicates and try again.', NULL::uuid, 0, 0; RETURN;
        WHEN foreign_key_violation THEN
            RETURN QUERY SELECT 0, 'A supplier, customer or style in the file does not exist in the portal. Nothing was saved.', NULL::uuid, 0, 0; RETURN;
        WHEN check_violation THEN
            RETURN QUERY SELECT 0, 'A value in the file is not one the page allows (for example a product line). Nothing was saved.', NULL::uuid, 0, 0; RETURN;
        WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range THEN
            RETURN QUERY SELECT 0, 'A date or number in the file could not be read. Nothing was saved.', NULL::uuid, 0, 0; RETURN;
    END;

    RETURN QUERY SELECT 1, NULL::text, v_batch, v_written, v_twins;
END;
$$;

-- ============================================================================
-- 4. undo_data_import_batch
-- ============================================================================

CREATE OR REPLACE FUNCTION public.undo_data_import_batch(p_batch_id uuid, p_actor_user_id uuid DEFAULT NULL)
RETURNS TABLE(success integer, error text, rows_deleted integer, rows_kept integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_b    public.data_import_batches%ROWTYPE;
    v_del  integer := 0;
    v_kept integer := 0;
BEGIN
    SELECT * INTO v_b FROM public.data_import_batches WHERE id = p_batch_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0, 'That import was not found.', 0, 0; RETURN;
    END IF;
    IF v_b.undone_at IS NOT NULL THEN
        RETURN QUERY SELECT 0, 'That import has already been undone.', 0, 0; RETURN;
    END IF;

    IF v_b.dataset_key = 'nis_intake' THEN
        DELETE FROM public.data_nis_intake WHERE import_batch_id = p_batch_id AND data_source = 'imported';
        GET DIAGNOSTICS v_del = ROW_COUNT;
        UPDATE public.data_nis_intake SET import_batch_id = NULL WHERE import_batch_id = p_batch_id;
        GET DIAGNOSTICS v_kept = ROW_COUNT;
    ELSIF v_b.dataset_key = 'kernel_sales_lines' THEN
        DELETE FROM public.data_kernel_sales_lines WHERE import_batch_id = p_batch_id AND data_source = 'imported';
        GET DIAGNOSTICS v_del = ROW_COUNT;
        UPDATE public.data_kernel_sales_lines SET import_batch_id = NULL WHERE import_batch_id = p_batch_id;
        GET DIAGNOSTICS v_kept = ROW_COUNT;
    ELSIF v_b.dataset_key = 'oil_sales_lines' THEN
        DELETE FROM public.data_oil_sales_lines WHERE import_batch_id = p_batch_id AND data_source = 'imported';
        GET DIAGNOSTICS v_del = ROW_COUNT;
        UPDATE public.data_oil_sales_lines SET import_batch_id = NULL WHERE import_batch_id = p_batch_id;
        GET DIAGNOSTICS v_kept = ROW_COUNT;
    ELSE
        -- A local oil line linked to a register row this batch added loses that link with it.
        UPDATE public.data_oil_sales_lines s
           SET export_register_id = NULL,
               data_quality_flags = array_remove(s.data_quality_flags, 'export_twin_auto_linked')
         WHERE s.export_register_id IN (SELECT id FROM public.data_oil_export_register
                                        WHERE import_batch_id = p_batch_id AND data_source = 'imported');
        DELETE FROM public.data_oil_export_register WHERE import_batch_id = p_batch_id AND data_source = 'imported';
        GET DIAGNOSTICS v_del = ROW_COUNT;
        UPDATE public.data_oil_export_register SET import_batch_id = NULL WHERE import_batch_id = p_batch_id;
        GET DIAGNOSTICS v_kept = ROW_COUNT;
    END IF;

    UPDATE public.data_import_batches
       SET undone_at = now(), undone_by = p_actor_user_id, rows_kept_on_undo = v_kept
     WHERE id = p_batch_id;

    RETURN QUERY SELECT 1, NULL::text, v_del, v_kept;
END;
$$;

-- ============================================================================
-- 5. get_data_import_batches
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_data_import_batches(p_dataset_key text DEFAULT NULL, p_limit integer DEFAULT 20)
RETURNS TABLE(id uuid, dataset_key text, file_name text, source_kind text, row_count integer,
              total_qty numeric, twins_linked integer, created_by uuid, created_by_name text,
              created_at timestamptz, undone_at timestamptz, rows_kept_on_undo integer)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT b.id, b.dataset_key, b.file_name, b.source_kind, b.row_count, b.total_qty, b.twins_linked,
           b.created_by, public.stock_history_user_label(b.created_by), b.created_at, b.undone_at,
           b.rows_kept_on_undo
    FROM public.data_import_batches b
    WHERE p_dataset_key IS NULL OR b.dataset_key = p_dataset_key
    ORDER BY b.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
$$;

-- ============================================================================
-- 6. data_import_role_can_edit - for the read-import-file edge function only
-- ============================================================================
-- AI reading costs money per call, so the edge function only serves roles that may edit data pages
-- (the reports.data.edit action). Granted to service_role only.

CREATE OR REPLACE FUNCTION public.data_import_role_can_edit(p_role_name text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce(p_role_name, '') IN ('super_user', 'admin')
        OR EXISTS (
            SELECT 1
            FROM public.role_actions ra
            JOIN public.actions a ON a.id = ra.action_id AND a.key = 'reports.data.edit'
            JOIN public.roles r ON r.id = ra.role_id
            WHERE r.role_name = p_role_name AND ra.value = 'true');
$$;

-- ============================================================================
-- 7. Grants
-- ============================================================================

REVOKE ALL ON FUNCTION public.import_data_page_rows(text, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.undo_data_import_batch(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_data_import_batches(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.data_import_role_can_edit(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.import_data_page_rows(text, text, text, jsonb, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.undo_data_import_batch(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_data_import_batches(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.data_import_role_can_edit(text) TO service_role;

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT rf.role_id, 'function', fn, 'EXECUTE', true
FROM public.role_features rf
JOIN public.features f ON f.id = rf.feature_id AND f.key = 'sales-data-grid'
CROSS JOIN unnest(ARRAY['import_data_page_rows', 'undo_data_import_batch', 'get_data_import_batches']) AS fn
WHERE rf.value = 'true'
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = rf.role_id AND rp.object_type = 'function'
        AND rp.object_name = fn AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
