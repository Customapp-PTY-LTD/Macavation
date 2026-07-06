-- Re-grant functions whose signatures changed in phase2_implementation_complete.

GRANT EXECUTE ON FUNCTION public.upsert_scheduled_report(uuid, uuid, text, text, text, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_notification(text, text, text, text, text, uuid, uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_notifications(uuid, uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
