-- Standalone RPC for linking raw ingredient (oil) rows to an oil_bin_batch.
-- PostgREST resolves functions by argument names; this avoids extending update_oil_bin_batch
-- (which may not be migrated on all environments) and "function not in schema cache" errors.

CREATE OR REPLACE FUNCTION public.set_oil_bin_batch_raw_ingredient_links(
    p_oil_bin_batch_id       uuid,
    p_raw_ingredient_audit   jsonb,
    p_ingredients            text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.oil_bin_batch
    SET raw_ingredient_audit = COALESCE(p_raw_ingredient_audit, '[]'::jsonb),
        ingredients = CASE
            WHEN p_ingredients IS NULL THEN ingredients
            ELSE p_ingredients
        END,
        updated_at = NOW()
    WHERE id = p_oil_bin_batch_id AND status = 'in_production';

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Oil bin batch not found or already sent to stock');
    END IF;

    RETURN jsonb_build_object('success', true);
END;
$$;

COMMENT ON FUNCTION public.set_oil_bin_batch_raw_ingredient_links(uuid, jsonb, text) IS
    'Links supplier raw batches (traceability JSON array) to an in-production oil bin; optional ingredients text for display.';

-- RBAC: see migrations/20260332000003_grant_set_oil_bin_ingredient_links_from_update_oil_bin.sql
-- (copy EXECUTE from update_oil_bin_batch — no separate “grant all roles” block)

NOTIFY pgrst, 'reload schema';
