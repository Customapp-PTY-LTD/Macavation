-- Fix get_kernel_batch_archive: last function reading the dropped users.username
-- column (missed by the initial scan). Use first/last name instead. DEV-only.

CREATE OR REPLACE FUNCTION public.get_kernel_batch_archive(p_search character varying DEFAULT NULL::character varying, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, batch_number character varying, batch_uuid uuid, kernel_id uuid, status character varying, grower_name character varying, supplier_id uuid, received_date date, deactivation_type character varying, deactivated_at timestamp with time zone, deactivated_by uuid, deactivated_by_name text, can_restore boolean, number_in_use boolean, snapshot jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT
        a.id,
        a.batch_number,
        a.batch_uuid,
        a.kernel_id,
        a.status,
        a.grower_name,
        a.supplier_id,
        a.received_date,
        a.deactivation_type,
        a.deactivated_at,
        a.deactivated_by,
        COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
            NULLIF(trim(u.email), ''),
            'Unknown user'
        ) AS deactivated_by_name,
        (
            a.deactivation_type = 'soft_delete'
            AND EXISTS (
                SELECT 1 FROM public.kernel k
                WHERE k.id = a.kernel_id AND NOT k.is_active
            )
        ) AS can_restore,
        public.kernel_batch_number_in_use_active(a.batch_number) AS number_in_use,
        a.snapshot
    FROM public.kernel_batch_archive a
    LEFT JOIN public.users u ON u.id = a.deactivated_by
    WHERE (
        p_search IS NULL
        OR a.batch_number ILIKE '%' || p_search || '%'
        OR a.grower_name ILIKE '%' || p_search || '%'
        OR COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''), u.email, '') ILIKE '%' || p_search || '%'
    )
    ORDER BY a.deactivated_at DESC
    LIMIT GREATEST(COALESCE(p_limit, 100), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
$function$;

NOTIFY pgrst, 'reload schema';
