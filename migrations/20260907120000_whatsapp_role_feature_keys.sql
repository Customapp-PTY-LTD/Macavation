-- Let the WhatsApp bot read a super user's own feature grants.
--
-- THE FAULT, measured on dev (nmdmddugxclpqrwylyfa) on 2026-09-07. Every `Menu` sent from an
-- enrolled super user's handset is answered "your role does not have access to any of the
-- WhatsApp reports yet" and logged in whatsapp_command_log as
-- `outcome=denied, detail='no features enabled for role'` -- while that role has 32 feature rows
-- set to 'true'. Counted through the RPC the bot actually calls versus the table underneath it:
--
--     role                 via get_role_features_for_role   in role_features
--     admin                                            35                 35
--     Shareholder                                      17                 17
--     Sales Exec                                       15                 15
--     Production Manager                               13                 13
--     Quality Assurance                                13                 13
--     Palladium Manager                                12                 12
--     Factory Manager                                   8                  8
--     super_user                                        0                 32   <-- the fault
--
-- WHY. public.get_role_features_for_role carries this guard (read it in
-- 20260706100000_phase2_implementation_complete.sql and the migrations that have since replaced
-- it; the live definition was read with pg_get_functiondef before writing this):
--
--     WHERE rf.role_id = p_role_id
--       AND ( public.portal_actor_is_super_user() OR r.role_name <> 'super_user' )
--
-- That guard is CORRECT and must stay: it stops a merely-admin portal actor reading what a super
-- user is granted. But supabase/functions/whatsapp-inbound/index.ts:702 calls the same RPC with
-- the service-role key and no portal session, so portal_actor_is_super_user() is false and the
-- super_user branch is filtered out. The bot fails closed to an empty menu, which is the correct
-- behaviour for an unreadable permission table -- it is the READ that is wrong, not the failure.
--
-- Henry is currently the only enrolled number and holds the one role this breaks on, so the line
-- presents as completely broken while working correctly for every other role.
--
-- THE FIX, and why it is a new function rather than an edit to the old one. The portal-facing
-- get_role_features_for_role is left untouched -- amending its guard to admit the service role
-- would widen a function that anon and authenticated can both execute, to fix a caller that is
-- neither. Instead the bot gets its own reader, granted to service_role ONLY:
--
--   * No actor guard is needed here because there is no ambient actor to guard against. This
--     function is unreachable except with the service-role key, which only the edge runtime holds.
--   * It takes the role id the bot already resolved from a VERIFIED phone number via
--     whatsapp_resolve_staff_user (which requires whatsapp_phone_verified_at IS NOT NULL), so the
--     identity was established before this is ever called.
--   * It returns only rows already filtered to value = 'true' on an active feature, so the caller
--     cannot mistake a 'false' row for a grant.
--
-- OUT OF SCOPE: applying this migration. A human runs it against dev and, after sign-off, prod.
-- Nothing in this repo can reach a database.

CREATE OR REPLACE FUNCTION public.whatsapp_role_feature_keys(p_role_id uuid)
RETURNS TABLE (feature_key character varying, value text)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
    SELECT f.key AS feature_key, rf.value
    FROM public.role_features rf
    JOIN public.features f ON f.id = rf.feature_id
    WHERE rf.role_id = p_role_id
      AND rf.value = 'true'
      AND f.is_active
    ORDER BY f.key;
$function$;

COMMENT ON FUNCTION public.whatsapp_role_feature_keys(uuid) IS
'Feature keys granted to one role, for the WhatsApp bot. service_role only: the bot has no portal '
'session, so it cannot satisfy the portal_actor_is_super_user() guard on '
'get_role_features_for_role and was silently reading zero rows for super_user. Do not grant this '
'to anon or authenticated - the portal must keep using get_role_features_for_role, whose guard '
'stops a non-super-user actor reading a super user''s grants.';

REVOKE ALL ON FUNCTION public.whatsapp_role_feature_keys(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_role_feature_keys(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_role_feature_keys(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_role_feature_keys(uuid) TO service_role;
