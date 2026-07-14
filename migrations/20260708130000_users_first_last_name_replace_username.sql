-- Users get real first_name / last_name (Title Case), replacing username in the
-- portal's user CRUD + auth path. Names are title-cased in the DB so they render
-- correctly everywhere ("this is not Instagram" — no usernames).
--
-- DEV-ONLY step of a larger change. DEFERRED to the later formal migration:
--   * DROP COLUMN public.users.username
--   * rewrite the report functions that still read username
--     (get_contacts, get_documents, get_oil_batch_by_id, get_raw_material_issued)
--   * verify_password
-- The username column is left in place (unused by the functions below) so those
-- reports keep working until they are migrated.

-- 1. Columns -----------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_name  text;

-- 2. Backfill from existing username (best-effort split), Title Cased --------
UPDATE public.users
SET first_name = COALESCE(first_name,
        initcap(nullif(split_part(btrim(coalesce(username, '')), ' ', 1), ''))),
    last_name  = COALESCE(last_name,
        initcap(nullif(btrim(substr(btrim(coalesce(username, '')),
              length(split_part(btrim(coalesce(username, '')), ' ', 1)) + 1)), '')))
WHERE username IS NOT NULL AND btrim(username) <> '';

-- 3. create_user_simple: first/last instead of username, stored Title Case ---
DROP FUNCTION IF EXISTS public.create_user_simple(text, text, uuid, text);
CREATE OR REPLACE FUNCTION public.create_user_simple(
    p_email      text,
    p_first_name text DEFAULT NULL,
    p_last_name  text DEFAULT NULL,
    p_role_id    uuid DEFAULT NULL,
    p_password   text DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_id uuid;
    v_role_name varchar;
    v_password_hash text;
BEGIN
    IF p_role_id IS NOT NULL THEN
        SELECT role_name INTO v_role_name FROM public.roles WHERE id = p_role_id;
    END IF;
    IF p_password IS NOT NULL AND p_password <> '' THEN
        v_password_hash := crypt(p_password, gen_salt('bf'));
    END IF;

    INSERT INTO public.users (email, first_name, last_name, role_id, role, password_hash)
    VALUES (
        p_email,
        initcap(nullif(btrim(p_first_name), '')),
        initcap(nullif(btrim(p_last_name), '')),
        p_role_id, v_role_name, v_password_hash
    )
    RETURNING id INTO v_id;

    RETURN json_build_object('success', true, 'id', v_id, 'message', 'User created successfully');
END;
$$;

-- 4. update_user_simple: first/last instead of username ----------------------
DROP FUNCTION IF EXISTS public.update_user_simple(uuid, text, text, uuid, boolean, text);
CREATE OR REPLACE FUNCTION public.update_user_simple(
    p_user_id    uuid,
    p_email      text    DEFAULT NULL,
    p_first_name text    DEFAULT NULL,
    p_last_name  text    DEFAULT NULL,
    p_role_id    uuid    DEFAULT NULL,
    p_is_active  boolean DEFAULT NULL,
    p_password   text    DEFAULT NULL
) RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
    v_role_name varchar;
    v_password_hash text;
BEGIN
    IF p_role_id IS NOT NULL THEN
        SELECT role_name INTO v_role_name FROM public.roles WHERE id = p_role_id;
    END IF;
    IF p_password IS NOT NULL AND p_password <> '' THEN
        v_password_hash := crypt(p_password, gen_salt('bf'));
    END IF;

    UPDATE public.users
    SET email         = COALESCE(p_email, email),
        first_name    = COALESCE(initcap(nullif(btrim(p_first_name), '')), first_name),
        last_name     = COALESCE(initcap(nullif(btrim(p_last_name), '')), last_name),
        role_id       = COALESCE(p_role_id, role_id),
        role          = COALESCE(v_role_name, role),
        is_active     = COALESCE(p_is_active, is_active),
        password_hash = COALESCE(v_password_hash, password_hash),
        updated_at    = now()
    WHERE id = p_user_id;

    RETURN json_build_object('success', true, 'id', p_user_id, 'message', 'User updated successfully');
END;
$$;

-- 5. get_users / get_user_by_id: return first_name/last_name (no username) ----
DROP FUNCTION IF EXISTS public.get_users();
CREATE OR REPLACE FUNCTION public.get_users()
RETURNS TABLE(id uuid, email text, first_name text, last_name text, role text,
              role_id uuid, role_name character varying, is_active boolean,
              created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.role_id,
           r.role_name, u.is_active, u.created_at, u.updated_at
    FROM public.users u
    LEFT JOIN public.roles r ON u.role_id = r.id
    ORDER BY u.created_at DESC;
END;
$$;

DROP FUNCTION IF EXISTS public.get_user_by_id(uuid);
CREATE OR REPLACE FUNCTION public.get_user_by_id(p_id uuid)
RETURNS TABLE(id uuid, email text, first_name text, last_name text, role text,
              role_id uuid, role_name character varying, is_active boolean,
              created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.role_id,
           r.role_name, u.is_active, u.created_at, u.updated_at
    FROM public.users u
    LEFT JOIN public.roles r ON u.role_id = r.id
    WHERE u.id = p_id;
END;
$$;

-- 6. auth_login_email: return first_name/last_name in the user object --------
CREATE OR REPLACE FUNCTION public.auth_login_email(p_email text, p_password text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $$
declare
  u record;
begin
  if coalesce(trim(p_email), '') = '' or coalesce(p_password, '') = '' then
    return json_build_object('success', false, 'message', 'Email and password are required.');
  end if;

  select usr.id, usr.email, usr.first_name, usr.last_name, usr.role, usr.role_id,
         r.role_name, usr.is_active, usr.password_hash
    into u
  from public.users usr
  left join public.roles r on r.id = usr.role_id
  where lower(usr.email) = lower(trim(p_email))
  limit 1;

  if u.id is null
     or u.password_hash is null
     or u.password_hash <> crypt(p_password, u.password_hash) then
    return json_build_object('success', false, 'message', 'Invalid email or password.');
  end if;

  if u.is_active is distinct from true then
    return json_build_object('success', false, 'message', 'This account is inactive.');
  end if;

  return json_build_object(
    'success', true,
    'token', encode(gen_random_bytes(24), 'hex'),
    'user', json_build_object(
      'id', u.id,
      'email', u.email,
      'first_name', u.first_name,
      'last_name', u.last_name,
      'role', u.role,
      'role_id', u.role_id,
      'role_name', u.role_name,
      'is_active', u.is_active
    )
  );
end;
$$;

-- 7. Re-grant EXECUTE (dropped functions lose grants) ------------------------
GRANT EXECUTE ON FUNCTION public.create_user_simple(text, text, text, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_user_simple(uuid, text, text, text, uuid, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_users() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_by_id(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.auth_login_email(text, text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
