-- Migration replays resurrected old function overloads that newer migrations had
-- replaced or explicitly dropped. PostgREST then fails with "Could not choose the
-- best candidate function" whenever the portal's named-arg subset matches both the
-- old overload and the new defaulted one (data-functions strips null params, so
-- subset-shaped calls are the norm). Re-drop each zombie; the surviving function
-- defaults every extra param, so all existing call shapes still resolve.

-- Reported error (Kernel Dispatch grid). Originally dropped in 20260526120000.
DROP FUNCTION IF EXISTS public.get_kernel_dispatch_orders(integer, integer);

-- Superseded by the 4-arg version (20260224110000).
DROP FUNCTION IF EXISTS public.get_production_batches();

-- Repo defines only the varchar version (20260220110000).
DROP FUNCTION IF EXISTS public.get_supplier_intake_batches(text);

-- Superseded by the 3-arg version with p_parent_id (20260610000001).
DROP FUNCTION IF EXISTS public.create_document_category_simple(character varying, text);

-- Superseded by the 28-arg crack-out version (20260224110000).
DROP FUNCTION IF EXISTS public.create_sample_submission_for_batch(uuid, boolean, numeric, boolean, numeric, boolean, numeric, numeric);

-- Originally dropped in 20260345000001 (manual batch numbers made p_batch_number required).
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(date);
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(character varying);
DROP FUNCTION IF EXISTS public.start_oil_bin_batch(date, character varying);

-- Originally dropped in 20260332000001 (p_raw_ingredient_audit added).
DROP FUNCTION IF EXISTS public.update_oil_bin_batch(uuid, character varying, character varying, numeric, numeric, character varying, jsonb);

-- Superseded by the 13-arg version with p_removed_pre_sizer_kg (20260304000001).
DROP FUNCTION IF EXISTS public.upsert_kernel_checklist(uuid, date, character varying, uuid, character varying, character varying, character varying, character varying, character varying, character varying, text, jsonb);

-- Left in place deliberately (param names are disjoint, so PostgREST never sees an
-- ambiguous call): create_kernel_packing_sample (13-arg p_-prefixed vs 14-arg),
-- create_role_feature_simple and update_role_feature_simple (uuid/varchar vs bigint forms).

NOTIFY pgrst, 'reload schema';
