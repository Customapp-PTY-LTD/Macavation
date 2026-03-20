-- Grant EXECUTE on set_oil_bin_batch_raw_ingredient_links for the same roles that already have
-- update_oil_bin_batch. Avoids a separate “all roles” grant and fixes Lambda 403 when only
-- update_oil_bin_batch was present.

INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT rp.role_id,
       'function',
       'set_oil_bin_batch_raw_ingredient_links',
       'EXECUTE',
       true
FROM public.role_permissions rp
WHERE rp.object_type = 'function'
  AND rp.object_name = 'update_oil_bin_batch'
  AND rp.operation = 'EXECUTE'
  AND COALESCE(rp.allowed, false) = true
  AND NOT EXISTS (
      SELECT 1
      FROM public.role_permissions x
      WHERE x.role_id = rp.role_id
        AND x.object_type = 'function'
        AND x.object_name = 'set_oil_bin_batch_raw_ingredient_links'
        AND x.operation = 'EXECUTE'
  );
