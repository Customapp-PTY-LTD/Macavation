-- =====================================================================
-- Direct (Lambda-free) email/password sign-in.
--
-- The portal calls this RPC straight through PostgREST with the anon
-- key. Password verification happens in-database against the bcrypt
-- hash in public.users.password_hash (same hashes create_user_simple
-- writes via crypt(p, gen_salt('bf'))).
--
-- The returned token is a client-side session marker only — PostgREST
-- authorization continues to ride on the anon key exactly as it did
-- for the direct-call fallback path before this change. It is NOT a
-- server-verified credential (the old Lambda token was only ever
-- checked by the Lambda itself).
-- =====================================================================

create or replace function public.auth_login_email(p_email text, p_password text)
returns json
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  u record;
begin
  if coalesce(trim(p_email), '') = '' or coalesce(p_password, '') = '' then
    return json_build_object('success', false, 'message', 'Email and password are required.');
  end if;

  select usr.id, usr.email, usr.username, usr.role, usr.role_id,
         r.role_name, usr.is_active, usr.password_hash
    into u
  from public.users usr
  left join public.roles r on r.id = usr.role_id
  where lower(usr.email) = lower(trim(p_email))
  limit 1;

  -- One message for every failure mode: never reveal whether the email
  -- exists or whether the account has a password set.
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
      'username', u.username,
      'role', u.role,
      'role_id', u.role_id,
      'role_name', u.role_name,
      'is_active', u.is_active
    )
  );
end;
$$;

revoke all on function public.auth_login_email(text, text) from public;
grant execute on function public.auth_login_email(text, text) to anon, authenticated, service_role;
