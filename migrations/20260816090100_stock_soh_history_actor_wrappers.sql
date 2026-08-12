-- Actor-carrying overloads for the stock RPCs the portal calls.
--
-- Companion to 20260816090000. The triggers there capture WHAT changed and WHEN with no help
-- from the caller; these wrappers supply the missing WHO.
--
-- WHY OVERLOADS RATHER THAN EDITING THE ORIGINALS: adding a parameter changes a function's
-- signature, so "just add p_user_id" means DROP + recreate with the full original body — for
-- create_oil_stock_lot_simple (20 parameters) and create_kernel_dispatch_order (whose body was
-- last corrected in 20260730120000 for three separate stock bugs) that is a large, regression-
-- prone rewrite for a logging change. Each wrapper below is two statements and never touches the
-- original, which stays the single implementation.
--
-- WHY p_actor_user_id HAS NO DEFAULT: PostgREST resolves an overload by matching the argument
-- NAMES in the request body. If the actor parameter were defaulted, a call that omitted it would
-- match BOTH the original and the wrapper and PostgREST would fail the request with PGRST203
-- ("could not choose the best candidate function") — silently breaking dispatch and adjustments
-- for any caller that had not been updated. Required, the split is clean and total:
--   body includes p_actor_user_id -> only the wrapper can accept it   -> wrapper
--   body omits it                -> the wrapper's required arg is unmet -> original
-- So this migration is backwards compatible: every existing caller keeps working unchanged.
--
-- Postgres requires that parameters without defaults precede those with defaults, so
-- p_actor_user_id sits immediately after the last REQUIRED parameter of each function rather
-- than at the end. Position is irrelevant to PostgREST, which passes arguments by name.
--
-- The wrappers are SECURITY DEFINER because stock_history_set_actor is deliberately not granted
-- to anon (see 20260816090000 §3) and every portal RPC arrives as anon.
--
-- RBAC: no new role_permissions rows. The Lambda RBAC layer keys on object_name, and an overload
-- shares its name with the original — so each wrapper is already exactly as permitted as the
-- function it wraps, with no chance of the two drifting apart. This is the one case where the
-- "grant to every role" pattern CLAUDE.md warns about is not merely unnecessary but wrong.
--
-- OUT OF SCOPE: applying this migration. Apply 20260816090000 FIRST — these wrappers call
-- stock_history_set_actor, which that migration creates.

-- ============================================================================
-- 1. Adjusted stock — manual kernel corrections.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.adjust_kernel_stock_on_hand(
    p_kernel_id      uuid,
    p_style          character varying,
    p_actor_user_id  uuid,
    p_qty_delta      numeric DEFAULT 0,
    p_cartons_delta  numeric DEFAULT 0,
    p_reason         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.adjust_kernel_stock_on_hand(p_kernel_id, p_style, p_qty_delta, p_cartons_delta, p_reason);
END;
$$;

-- ============================================================================
-- 2. Dispatches out — kernel and oil.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_kernel_dispatch_order(
    p_buyer_name       text,
    p_delivery_date    date,
    p_lines            jsonb,
    p_actor_user_id    uuid,
    p_buyer_contact_id uuid DEFAULT NULL,
    p_best_before_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.create_kernel_dispatch_order(p_buyer_name, p_delivery_date, p_lines, p_buyer_contact_id, p_best_before_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.create_oil_dispatch_order(
    p_buyer_name       text,
    p_delivery_date    date,
    p_lines            jsonb,
    p_actor_user_id    uuid,
    p_buyer_contact_id uuid DEFAULT NULL,
    p_best_before_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.create_oil_dispatch_order(p_buyer_name, p_delivery_date, p_lines, p_buyer_contact_id, p_best_before_date);
END;
$$;

-- ============================================================================
-- 3. Stock in / adjustments — oil & protein lots.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_oil_stock_lot_simple(
    p_location_code           character varying,
    p_stock_category          character varying,
    p_kilograms               numeric,
    p_actor_user_id           uuid,
    p_status                  character varying DEFAULT 'on_hand'::character varying,
    p_counterparty_type       character varying DEFAULT NULL,
    p_counterparty_name       text DEFAULT NULL,
    p_counterparty_contact_id uuid DEFAULT NULL,
    p_po_reference            character varying DEFAULT NULL,
    p_batch_number            character varying DEFAULT NULL,
    p_product_code            character varying DEFAULT NULL,
    p_product_description     text DEFAULT NULL,
    p_grade                   character varying DEFAULT NULL,
    p_ffa                     numeric DEFAULT NULL,
    p_coa_status              character varying DEFAULT NULL,
    p_units                   integer DEFAULT NULL,
    p_volume                  numeric DEFAULT NULL,
    p_delivery_date           date DEFAULT NULL,
    p_manufacture_date        date DEFAULT NULL,
    p_bb_date                 date DEFAULT NULL,
    p_notes                   text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.create_oil_stock_lot_simple(
        p_location_code, p_stock_category, p_kilograms, p_status, p_counterparty_type,
        p_counterparty_name, p_counterparty_contact_id, p_po_reference, p_batch_number,
        p_product_code, p_product_description, p_grade, p_ffa, p_coa_status, p_units,
        p_volume, p_delivery_date, p_manufacture_date, p_bb_date, p_notes);
END;
$$;

CREATE OR REPLACE FUNCTION public.update_oil_stock_lot_simple(
    p_id                      uuid,
    p_actor_user_id           uuid,
    p_location_code           character varying DEFAULT NULL,
    p_stock_category          character varying DEFAULT NULL,
    p_kilograms               numeric DEFAULT NULL,
    p_status                  character varying DEFAULT NULL,
    p_counterparty_type       character varying DEFAULT NULL,
    p_counterparty_name       text DEFAULT NULL,
    p_counterparty_contact_id uuid DEFAULT NULL,
    p_po_reference            character varying DEFAULT NULL,
    p_batch_number            character varying DEFAULT NULL,
    p_product_code            character varying DEFAULT NULL,
    p_product_description     text DEFAULT NULL,
    p_grade                   character varying DEFAULT NULL,
    p_ffa                     numeric DEFAULT NULL,
    p_coa_status              character varying DEFAULT NULL,
    p_units                   integer DEFAULT NULL,
    p_volume                  numeric DEFAULT NULL,
    p_delivery_date           date DEFAULT NULL,
    p_manufacture_date        date DEFAULT NULL,
    p_bb_date                 date DEFAULT NULL,
    p_notes                   text DEFAULT NULL,
    p_is_active               boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.update_oil_stock_lot_simple(
        p_id, p_location_code, p_stock_category, p_kilograms, p_status, p_counterparty_type,
        p_counterparty_name, p_counterparty_contact_id, p_po_reference, p_batch_number,
        p_product_code, p_product_description, p_grade, p_ffa, p_coa_status, p_units,
        p_volume, p_delivery_date, p_manufacture_date, p_bb_date, p_notes, p_is_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.deactivate_oil_stock_lot(
    p_id            uuid,
    p_actor_user_id uuid
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.deactivate_oil_stock_lot(p_id);
END;
$$;

-- ============================================================================
-- 4. Shell waste lots.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_shell_stock_lot(
    p_id                  uuid,
    p_lot_number          text,
    p_source_batch_number text,
    p_quantity_kg         numeric,
    p_status              text,
    p_notes               text,
    p_actor_user_id       uuid
)
RETURNS SETOF public.shell_stock_lot
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN QUERY SELECT * FROM public.upsert_shell_stock_lot(
        p_id, p_lot_number, p_source_batch_number, p_quantity_kg, p_status, p_notes);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_shell_stock_lot(
    p_id            uuid,
    p_actor_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.delete_shell_stock_lot(p_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_shell_stock_lot(
    p_lot_id        uuid,
    p_actor_user_id uuid,
    p_customer_ref  text DEFAULT NULL,
    p_notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.dispatch_shell_stock_lot(p_lot_id, p_customer_ref, p_notes);
END;
$$;

-- ============================================================================
-- 5. Stock in — kernel released to stock, and historical imports.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_kernel_batch(
    p_kernel_id     uuid,
    p_actor_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.complete_kernel_batch(p_kernel_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_historical_kernel_batch(
    p_batch_number           character varying,
    p_actor_user_id          uuid,
    p_grower_name            character varying DEFAULT NULL,
    p_supplier_id            uuid DEFAULT NULL,
    p_received_date          date DEFAULT NULL,
    p_production_finished_at timestamp with time zone DEFAULT NULL,
    p_wet_nis_received_kg    numeric DEFAULT NULL,
    p_sk_sp_qty              numeric DEFAULT 0,
    p_sk_0_qty               numeric DEFAULT 0,
    p_sk_1_qty               numeric DEFAULT 0,
    p_sk_1s_qty              numeric DEFAULT 0,
    p_sk_4l_qty              numeric DEFAULT 0,
    p_sk_5_qty               numeric DEFAULT 0,
    p_sk_6_qty               numeric DEFAULT 0,
    p_bt_78_qty              numeric DEFAULT 0,
    p_bt_high_qty            numeric DEFAULT 0,
    p_bt_low_qty             numeric DEFAULT 0,
    p_best_before_date       date DEFAULT NULL,
    p_ffa                    numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    PERFORM public.stock_history_set_actor(p_actor_user_id);
    RETURN public.import_historical_kernel_batch(
        p_batch_number, p_grower_name, p_supplier_id, p_received_date, p_production_finished_at,
        p_wet_nis_received_kg, p_sk_sp_qty, p_sk_0_qty, p_sk_1_qty, p_sk_1s_qty, p_sk_4l_qty,
        p_sk_5_qty, p_sk_6_qty, p_bt_78_qty, p_bt_high_qty, p_bt_low_qty, p_best_before_date, p_ffa);
END;
$$;

-- ============================================================================
-- 6. Grants — each wrapper mirrors the reach of the function it wraps (all of these are
-- portal-callable today, i.e. reachable as anon through PostgREST).
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.adjust_kernel_stock_on_hand(uuid, character varying, uuid, numeric, numeric, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_kernel_dispatch_order(text, date, jsonb, uuid, uuid, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_oil_dispatch_order(text, date, jsonb, uuid, uuid, date) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_oil_stock_lot_simple(character varying, character varying, numeric, uuid, character varying, character varying, text, uuid, character varying, character varying, character varying, text, character varying, numeric, character varying, integer, numeric, date, date, date, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_oil_stock_lot_simple(uuid, uuid, character varying, character varying, numeric, character varying, character varying, text, uuid, character varying, character varying, character varying, text, character varying, numeric, character varying, integer, numeric, date, date, date, text, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.deactivate_oil_stock_lot(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.upsert_shell_stock_lot(uuid, text, text, numeric, text, text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_shell_stock_lot(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dispatch_shell_stock_lot(uuid, uuid, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_kernel_batch(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_historical_kernel_batch(character varying, uuid, character varying, uuid, date, timestamp with time zone, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, date, numeric) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
