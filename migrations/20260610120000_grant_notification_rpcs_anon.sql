-- Notifications inbox: allow PostgREST anon fallback when Lambda RBAC denies EXECUTE.
-- Matches document-management / kernel module pattern in WebPortal data-functions.js.

GRANT EXECUTE ON FUNCTION public.get_my_notifications(uuid, uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_unread_notification_count(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(uuid, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid, uuid) TO anon;
