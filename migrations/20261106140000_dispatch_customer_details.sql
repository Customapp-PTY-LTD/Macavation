-- ============================================================================
-- Edit a customer's details from Send to Dispatch (Henry, 6 Nov 2026).
--
-- The Customer details card under the customer picker gets an Edit button. update_contact_simple
-- can't do this: it has no street address or VAT number, and its COALESCE never clears a wrong
-- value. This sets exactly the fields the card shows, from a form that starts filled with the
-- current values, so an emptied box clears that field.
-- Customers only (contact_type kernel_customer / customer / both).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_dispatch_customer_details(
    p_contact_id uuid,
    p_contact_person text DEFAULT NULL,
    p_mobile text DEFAULT NULL,
    p_email text DEFAULT NULL,
    p_address_line1 text DEFAULT NULL,
    p_area text DEFAULT NULL,
    p_city text DEFAULT NULL,
    p_province text DEFAULT NULL,
    p_postal_code text DEFAULT NULL,
    p_vat_number text DEFAULT NULL,
    p_actor_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_type  text;
    v_email text := NULLIF(trim(COALESCE(p_email, '')), '');
BEGIN
    SELECT contact_type INTO v_type FROM public.contacts WHERE id = p_contact_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Customer not found.');
    END IF;
    IF v_type NOT IN ('kernel_customer', 'customer', 'both') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Only customer details can be changed here.');
    END IF;
    IF v_email IS NOT NULL AND v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
        RETURN jsonb_build_object('success', false, 'error', 'That email address does not look right.');
    END IF;

    UPDATE public.contacts
       SET primary_contact_name   = left(NULLIF(trim(COALESCE(p_contact_person, '')), ''), 200),
           primary_contact_mobile = left(NULLIF(trim(COALESCE(p_mobile, '')), ''), 50),
           primary_contact_email  = left(v_email, 200),
           physical_address_line1 = left(NULLIF(trim(COALESCE(p_address_line1, '')), ''), 300),
           physical_area          = left(NULLIF(trim(COALESCE(p_area, '')), ''), 200),
           physical_city          = left(NULLIF(trim(COALESCE(p_city, '')), ''), 200),
           physical_province      = left(NULLIF(trim(COALESCE(p_province, '')), ''), 100),
           physical_postal_code   = left(NULLIF(trim(COALESCE(p_postal_code, '')), ''), 20),
           vat_number             = left(NULLIF(trim(COALESCE(p_vat_number, '')), ''), 50),
           updated_at = now(),
           updated_by = COALESCE(p_actor_user_id, updated_by)
     WHERE id = p_contact_id;

    RETURN jsonb_build_object('success', true, 'contact', (
        SELECT jsonb_build_object(
            'id', c.id, 'contact_type', c.contact_type, 'company_name', c.company_name, 'trading_name', c.trading_name,
            'primary_contact_name', c.primary_contact_name, 'primary_contact_mobile', c.primary_contact_mobile,
            'primary_contact_phone', c.primary_contact_phone, 'primary_contact_email', c.primary_contact_email,
            'physical_address_line1', c.physical_address_line1, 'physical_address_line2', c.physical_address_line2,
            'physical_area', c.physical_area, 'physical_city', c.physical_city, 'physical_province', c.physical_province,
            'physical_postal_code', c.physical_postal_code, 'vat_number', c.vat_number,
            'secondary_contact_name', c.secondary_contact_name, 'secondary_contact_mobile', c.secondary_contact_mobile,
            'secondary_contact_phone', c.secondary_contact_phone)
        FROM public.contacts c WHERE c.id = p_contact_id));
END;
$$;

-- Function permissions (bookkeeping; RPCs are SECURITY DEFINER + anon). NOT EXISTS: no unique key.
INSERT INTO public.role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT DISTINCT r.id, 'function', 'update_dispatch_customer_details', 'EXECUTE', true
FROM public.roles r
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Procurement Lead', 'Palladium Manager')
  AND NOT EXISTS (
      SELECT 1 FROM public.role_permissions rp
      WHERE rp.role_id = r.id AND rp.object_type = 'function'
        AND rp.object_name = 'update_dispatch_customer_details' AND rp.operation = 'EXECUTE');

NOTIFY pgrst, 'reload schema';
