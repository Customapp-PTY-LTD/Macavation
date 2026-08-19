-- Private Supabase Storage bucket for published report PDFs.
--
-- This is the FIRST use of Supabase Storage in this project: as of this migration nothing in the
-- checkout reads or writes storage (no `.upload(`, no `/storage/v1/object`, no `createSignedUrl`
-- anywhere under WebPortal/ or supabase/functions/), and the dev database has zero rows in
-- storage.buckets. So there is no existing bucket convention to follow and none to break.
--
-- Why the bucket is PRIVATE and has no RLS policies at all
-- --------------------------------------------------------
-- A report PDF carries the company's sales and production figures. Two facts decide the access
-- model between them:
--
--   1. The portal browser does NOT hold a Supabase auth JWT. It authenticates every call with the
--      publishable/anon key plus a custom portal session token in an X-Portal-Session header
--      (WebPortal/js/data-functions.js:5867-5880, validated server-side by
--      assistant_validate_session — see supabase/functions/send-whatsapp-message/index.ts:44-63).
--      auth.uid() is therefore always NULL for portal traffic, so any storage RLS policy written
--      in terms of auth.uid() would deny everything, and any policy written for the `anon` role
--      would open the bucket to anyone holding the publishable key — which ships in the browser.
--
--   2. service_role bypasses RLS. Granting nothing to anon/authenticated and writing no policies
--      therefore yields exactly the intended rule: only server-side code holding the service-role
--      key can put a file in this bucket or read one out of it.
--
-- Recipients never touch storage directly. supabase/functions/send-report-whatsapp uploads the PDF
-- with the service-role key and hands out a time-limited SIGNED URL, which is what goes into the
-- WhatsApp message. The signature, not a bucket policy, is what makes the link work.
--
-- Idempotent: ON CONFLICT keeps a re-run from failing and keeps the limits authoritative.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'report-pdfs',
    'report-pdfs',
    false,
    26214400,                          -- 25 MiB; a generated report PDF is tens of KB
    ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public             = false,        -- never let a later change quietly make it public
    file_size_limit    = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types,
    updated_at         = now();

-- Deliberately NO policy on storage.objects for this bucket, and deliberately no blanket
-- REVOKE on storage.objects either. RLS on storage.objects is enabled by Supabase itself, and a
-- bucket with no policy is already closed to anon/authenticated. A blanket revoke would reach every
-- other bucket in the project as well — blast radius outside this feature, for no extra protection.

NOTIFY pgrst, 'reload schema';
