# Portal Guide (Mac) — enable & smoke notes

## Already done on UAT (`nmdmddugxclpqrwylyfa`)
- Migration `20260716160000_portal_assistant_chat.sql` applied
- Edge `portal-assistant` deployed
- KB ingested from `WebPortal/help/index.html` (77 sections, source `macavation-user-guide`)
- `ASSISTANT_INGEST_SECRET` set (rotate if you need to re-ingest and lost the value)

## Enable for soak
```sql
UPDATE public.assistant_client
SET assistant_enabled = 1, updated_at = now()
WHERE singleton;
```

## Anthropic key (required for real answers)
```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref nmdmddugxclpqrwylyfa
# or ASSISTANT_AI_API_KEY
```

## Re-ingest guide after help edits
```bash
# set ASSISTANT_INGEST_SECRET to match edge secret
set SUPABASE_URL=https://nmdmddugxclpqrwylyfa.supabase.co
set SUPABASE_ANON_KEY=...
set ASSISTANT_INGEST_SECRET=...
node scripts/ingest-macavation-assistant-kb.mjs
```

## UI
- FAB + rail in `WebPortal/index.html`
- Scripts: `modules/assistant/mac-assistant-*.js`
- Face: `WebPortal/img/mac.svg`
- Citations open `help/index.html#anchor`
- Prefs: `mac_assistant_rail_w`

## Sign-in note
Existing sessions minted **before** the migration will not have `assistant_sessions` rows. Users must **sign out and sign in again** once so `auth_login_email` / `auth-google` persist the token hash.
