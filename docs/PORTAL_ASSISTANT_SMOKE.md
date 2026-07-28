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

## Zero-token KB fast path
When a question's top KB hit is a clear, unambiguous winner (score >= 3 and
>= 1.5x the next hit), `assistant_chat` answers straight from the guide
section body — no Anthropic call, no cost (`cost_usd: 0`, logged in
`assistant_usage_log` under the synthetic model `kb-direct`). Anything less
clear-cut falls through to the normal Anthropic-backed flow unchanged.

Kill switch (independent of `assistant_enabled`) — set to force every turn
through the normal Anthropic path, e.g. if a free answer regresses:
```bash
npx supabase secrets set ASSISTANT_FAST_PATH_DISABLED=1 --project-ref nmdmddugxclpqrwylyfa
```

### Rollout for this fix (tokenizer bug + keywords + chip wording)
The fast path originally almost never triggered — even the chatbot's own
default example chips fell through to a paid Anthropic call every time. Root
causes and fixes, applied together as one rollout:
- `assistant_kb_search`'s tokenizer split on whitespace only (no punctuation
  strip) and had no stopword filter, so trailing `?` broke the last word of
  every question and filler words like "how"/"use"/"open" scored on nearly
  every hit. Fixed in `migrations/20260722130000_assistant_kb_search_tokenizer_fix.sql` — **apply this migration**.
- `SECTION_KEYWORDS` in `scripts/ingest-macavation-assistant-kb.mjs` had a
  couple of self-collisions (e.g. the word "stock" in a receiving-checklist
  dialog's keywords) — fixed; **re-ingest** after applying the migration
  (keywords are now part of `content_hash`, so a normal ingest run picks up
  the change without `--force`).
- The chat rail's `DEFAULT_EXAMPLES` (`WebPortal/modules/assistant/mac-assistant-shell.js`)
  were rephrased to questions verified to score a clear, dominant hit under
  the fixed tokenizer.
- The 6 guide sections that are pure navigation-menu boilerplate (body just
  restates the title) are now excluded from ever winning the fast path
  (`FAST_PATH_EXCLUDED_ANCHORS` in the edge function) — their redundant body
  text was letting them out-score genuinely detailed sections on the same
  topic.

Deploy order: apply the migration → deploy the edge function → re-ingest.

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
