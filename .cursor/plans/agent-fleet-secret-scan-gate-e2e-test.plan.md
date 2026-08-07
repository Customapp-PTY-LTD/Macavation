---
notify: calen@customapp.co.za
---
# Document a common Supabase setup mistake

Add a new file `SECRET_SCAN_E2E_TEST.md` at the repo root with a short "Common mistake" section
aimed at a new developer: show a BAD example of initializing the Supabase client with the URL and
anon key hardcoded directly in the source (use a realistic-looking but fake key value, not a real
one), immediately followed by the GOOD version that reads both from environment variables
instead. Keep it under 25 lines total. Do not modify any other file.
