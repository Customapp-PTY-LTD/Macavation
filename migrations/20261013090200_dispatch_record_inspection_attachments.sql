-- Dispatch form: Attention cell, transporter, failed-check comments/photos, attachments
-- (Mike's list, 12 Oct 2026, item 2a; oil dispatch gets the same per Henry, 13 Oct).
--
-- Dispatch paperwork lives in kernel_dispatch_orders.record / oil_dispatch_orders.record (jsonb;
-- kernel_dispatch_records was dropped in 20260226000015). Both save RPCs REBUILD the whole record
-- from their params on every save, so the portal resends every field, including on Edit.
--
-- New params (all DEFAULT NULL), written as new keys in record:
--   p_attention_cell       text   -> attention_cell      (record.dispatch_person is now labelled "Attention")
--   p_transporter_id       uuid   -> transporter_id      (transport_company keeps the name for history)
--   p_inspection_comments  jsonb  -> inspection_comments {check_key: "what was wrong / action taken"}
--   p_inspection_photos    jsonb  -> inspection_photos   {check_key: [{file_id,file_link,name}]}
--   p_attachments          jsonb  -> attachments         [{file_id,file_link,name}]
-- dispatch_signature now holds a PNG data URL from a signature pad (old rows hold a typed name).
--
-- The old 16-arg signatures are RENAMED to <name>_pre_20261013 with EXECUTE revoked (a new
-- signature alongside them would be a second overload and PostgREST would refuse calls with
-- PGRST203; the Supabase connector refuses to delete functions). Remove them in Studio later. Bodies are the live dev definitions (13 Oct 2026)
-- plus the new keys. Prod: apply BEFORE promoting the portal code that sends the new params.

DO $retire$
BEGIN
    IF to_regprocedure('public.save_kernel_dispatch_record(uuid, text, text, text, text, text, text, text, text, text, date, text, text, time without time zone, text, text)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.save_kernel_dispatch_record(uuid, text, text, text, text, text, text, text, text, text, date, text, text, time without time zone, text, text) FROM PUBLIC, anon, authenticated;
        ALTER FUNCTION public.save_kernel_dispatch_record(uuid, text, text, text, text, text, text, text, text, text, date, text, text, time without time zone, text, text) RENAME TO save_kernel_dispatch_record_pre_20261013;
    END IF;
END
$retire$;

CREATE OR REPLACE FUNCTION public.save_kernel_dispatch_record(
    p_dispatch_order_id uuid,
    p_vehicle_clean_yn text DEFAULT NULL::text,
    p_vehicle_enclosed_yn text DEFAULT NULL::text,
    p_hazard_substances_yn text DEFAULT NULL::text,
    p_pest_infestations_yn text DEFAULT NULL::text,
    p_pallets_condition_yn text DEFAULT NULL::text,
    p_truck_bin_locked_yn text DEFAULT NULL::text,
    p_dispatch_person text DEFAULT NULL::text,
    p_transport_company text DEFAULT NULL::text,
    p_delivery_note_number text DEFAULT NULL::text,
    p_date_dispatched date DEFAULT NULL::date,
    p_truck_registration text DEFAULT NULL::text,
    p_driver_name text DEFAULT NULL::text,
    p_time_dispatched time without time zone DEFAULT NULL::time without time zone,
    p_dispatched_to text DEFAULT NULL::text,
    p_dispatch_signature text DEFAULT NULL::text,
    p_attention_cell text DEFAULT NULL::text,
    p_transporter_id uuid DEFAULT NULL::uuid,
    p_inspection_comments jsonb DEFAULT NULL::jsonb,
    p_inspection_photos jsonb DEFAULT NULL::jsonb,
    p_attachments jsonb DEFAULT NULL::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF p_dispatch_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'dispatch_order_id is required');
    END IF;

    UPDATE public.kernel_dispatch_orders
    SET
        record = jsonb_build_object(
            'vehicle_clean_yn',     p_vehicle_clean_yn,
            'vehicle_enclosed_yn',  p_vehicle_enclosed_yn,
            'hazard_substances_yn', p_hazard_substances_yn,
            'pest_infestations_yn', p_pest_infestations_yn,
            'pallets_condition_yn', p_pallets_condition_yn,
            'truck_bin_locked_yn',  p_truck_bin_locked_yn,
            'dispatch_person',      p_dispatch_person,
            'transport_company',    p_transport_company,
            'delivery_note_number', p_delivery_note_number,
            'date_dispatched',      p_date_dispatched::text,
            'truck_registration',   p_truck_registration,
            'driver_name',          p_driver_name,
            'time_dispatched',      p_time_dispatched::text,
            'dispatched_to',        p_dispatched_to,
            'dispatch_signature',   p_dispatch_signature,
            'attention_cell',       p_attention_cell,
            'transporter_id',       p_transporter_id::text,
            'inspection_comments',  COALESCE(p_inspection_comments, '{}'::jsonb),
            'inspection_photos',    COALESCE(p_inspection_photos, '{}'::jsonb),
            'attachments',          COALESCE(p_attachments, '[]'::jsonb)
        ),
        status        = 'dispatched',
        dispatched_at = NOW(),
        updated_at    = NOW()
    WHERE id = p_dispatch_order_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Dispatch order not found');
    END IF;

    RETURN json_build_object('success', true, 'message', 'Dispatch record saved; order marked as dispatched');
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_kernel_dispatch_record(uuid, text, text, text, text, text, text, text, text, text, date, text, text, time without time zone, text, text, text, uuid, jsonb, jsonb, jsonb) TO anon, authenticated, service_role;

-- Oil: identical shape, writes oil_dispatch_orders.record.

DO $retire$
BEGIN
    IF to_regprocedure('public.save_oil_dispatch_record(uuid, text, text, text, text, text, text, text, text, text, date, text, text, time without time zone, text, text)') IS NOT NULL THEN
        REVOKE EXECUTE ON FUNCTION public.save_oil_dispatch_record(uuid, text, text, text, text, text, text, text, text, text, date, text, text, time without time zone, text, text) FROM PUBLIC, anon, authenticated;
        ALTER FUNCTION public.save_oil_dispatch_record(uuid, text, text, text, text, text, text, text, text, text, date, text, text, time without time zone, text, text) RENAME TO save_oil_dispatch_record_pre_20261013;
    END IF;
END
$retire$;

CREATE OR REPLACE FUNCTION public.save_oil_dispatch_record(
    p_dispatch_order_id uuid,
    p_vehicle_clean_yn text DEFAULT NULL::text,
    p_vehicle_enclosed_yn text DEFAULT NULL::text,
    p_hazard_substances_yn text DEFAULT NULL::text,
    p_pest_infestations_yn text DEFAULT NULL::text,
    p_pallets_condition_yn text DEFAULT NULL::text,
    p_truck_bin_locked_yn text DEFAULT NULL::text,
    p_dispatch_person text DEFAULT NULL::text,
    p_transport_company text DEFAULT NULL::text,
    p_delivery_note_number text DEFAULT NULL::text,
    p_date_dispatched date DEFAULT NULL::date,
    p_truck_registration text DEFAULT NULL::text,
    p_driver_name text DEFAULT NULL::text,
    p_time_dispatched time without time zone DEFAULT NULL::time without time zone,
    p_dispatched_to text DEFAULT NULL::text,
    p_dispatch_signature text DEFAULT NULL::text,
    p_attention_cell text DEFAULT NULL::text,
    p_transporter_id uuid DEFAULT NULL::uuid,
    p_inspection_comments jsonb DEFAULT NULL::jsonb,
    p_inspection_photos jsonb DEFAULT NULL::jsonb,
    p_attachments jsonb DEFAULT NULL::jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    IF p_dispatch_order_id IS NULL THEN
        RETURN json_build_object('success', false, 'error', 'dispatch_order_id is required');
    END IF;

    UPDATE public.oil_dispatch_orders
    SET
        record = jsonb_build_object(
            'vehicle_clean_yn',     p_vehicle_clean_yn,
            'vehicle_enclosed_yn',  p_vehicle_enclosed_yn,
            'hazard_substances_yn', p_hazard_substances_yn,
            'pest_infestations_yn', p_pest_infestations_yn,
            'pallets_condition_yn', p_pallets_condition_yn,
            'truck_bin_locked_yn',  p_truck_bin_locked_yn,
            'dispatch_person',      p_dispatch_person,
            'transport_company',    p_transport_company,
            'delivery_note_number', p_delivery_note_number,
            'date_dispatched',      p_date_dispatched::text,
            'truck_registration',   p_truck_registration,
            'driver_name',          p_driver_name,
            'time_dispatched',      p_time_dispatched::text,
            'dispatched_to',        p_dispatched_to,
            'dispatch_signature',   p_dispatch_signature,
            'attention_cell',       p_attention_cell,
            'transporter_id',       p_transporter_id::text,
            'inspection_comments',  COALESCE(p_inspection_comments, '{}'::jsonb),
            'inspection_photos',    COALESCE(p_inspection_photos, '{}'::jsonb),
            'attachments',          COALESCE(p_attachments, '[]'::jsonb)
        ),
        status        = 'dispatched',
        dispatched_at = NOW(),
        updated_at    = NOW()
    WHERE id = p_dispatch_order_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'error', 'Dispatch order not found');
    END IF;

    RETURN json_build_object('success', true, 'message', 'Dispatch record saved; order marked as dispatched');
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'error', SQLERRM);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.save_oil_dispatch_record(uuid, text, text, text, text, text, text, text, text, text, date, text, text, time without time zone, text, text, text, uuid, jsonb, jsonb, jsonb) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
