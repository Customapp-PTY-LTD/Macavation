-- Report builder — grant the report LIST screen to the two roles that own reporting.
--
-- 20260817110000 seeded the 'sales-report-editor' feature and the reports.report.* action keys, but
-- deliberately did not touch role_features for 'sales-forecasting-grid'. That was the right call at
-- the time: the key still belonged to the old Sales Forecasting stub, and silently changing who can
-- see an existing screen is not something an RBAC-additions migration should do on its own.
--
-- It is now wrong to leave it. That key no longer points at the stub — 20260817110000's sibling UI
-- work repointed it at the report LIST (WebPortal/js/appRouteConfig.json), and the module it used to
-- serve has been deleted. Verified on dev before writing this file: only 'admin' and 'super_user'
-- hold the key, so Sales Exec (Pete) and Palladium Manager (Joslyn) — the two people the feature was
-- built for — cannot see the menu item at all, and therefore cannot reach the editor either, since
-- the list is the only route to it.
--
-- This migration grants the LIST to exactly those two roles. It does not widen access for anyone
-- else, does not revoke from anyone, and does not touch any other feature key. Roles absent from a
-- given database are skipped rather than raising, so the same file applies cleanly to dev and prod.
--
-- role_features.value is text, not boolean — 'true' is the string. Comparing it to a boolean raises
-- "operator does not exist: text = boolean".
--
-- Note for whoever applies this: featureKeys are cached in the browser session at login, so an
-- affected user must sign out and back in before the menu item appears.
--
-- OUT OF SCOPE: applying this migration. A human runs
--   npm run db:apply -- migrations/20260817120000_grant_report_list_to_reporting_roles.sql   (dev nmdmddugxclpqrwylyfa)
-- and, after sign-off, npm run db:apply-prod for the same file (prod sofanhfpxifgdtooefzq).

DO $$
DECLARE
    v_feature_id bigint;
    v_role       record;
    v_granted    integer := 0;
BEGIN
    SELECT id INTO v_feature_id FROM public.features WHERE key = 'sales-forecasting-grid';

    IF v_feature_id IS NULL THEN
        RAISE NOTICE 'Feature key sales-forecasting-grid not present; nothing to grant.';
        RETURN;
    END IF;

    FOR v_role IN
        SELECT id, role_name FROM public.roles
        WHERE role_name IN ('Sales Exec', 'Palladium Manager')
    LOOP
        INSERT INTO public.role_features (role_id, feature_id, value)
        VALUES (v_role.id, v_feature_id, 'true')
        ON CONFLICT (role_id, feature_id) DO UPDATE SET value = 'true';
        v_granted := v_granted + 1;
    END LOOP;

    RAISE NOTICE 'Granted sales-forecasting-grid (report list) to % reporting role(s).', v_granted;
END;
$$;

NOTIFY pgrst, 'reload schema';
