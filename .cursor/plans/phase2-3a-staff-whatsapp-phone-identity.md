# Staff WhatsApp phone identity and enrolment

## Context

Phase 2's main goal is that staff can act on the system from WhatsApp on their own phone. Everything
needed to send and receive is already built and live — but there is **no way to tell who a message is
from**, and that is the blocker for every command that follows.

**What exists.** `supabase/functions/whatsapp-inbound/index.ts` receives Meta's webhook forwarded by
Control Room, verifies an HMAC over the raw body (`:195-206`), and persists each message via
`chat_ingest_inbound_whatsapp`. The line `+27 71 463 9643` is connected on channel `macavation-9349`.
Phone numbers arrive as bare digits, no `+` (`:30`).

**The gap.** `chat_ingest_inbound_whatsapp` resolves an inbound number against **CRM contacts** —
customers — and deliberately leaves `contact_id` NULL when there are zero or ambiguous matches
(`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:210-221`). There is no staff phone
column anywhere: a grep for a `phone`/`mobile`/`cell` column on `public.users` across all 292
migrations returns nothing. So a staff member texting the line today becomes an unattributed
shared-inbox item, with no user and therefore no role.

This plan adds a verified phone → user → role mapping. It is the first link in the chain and every
later WhatsApp stage depends on it.

**Identity must never be inferred from an unverified number.** Enrolment is portal-initiated and
confirmed from the handset, so possession of the phone is proven before it can act. The number Meta
reports is trustworthy as *a* number, but nothing stops someone claiming to be a colleague until we
have tied that number to a user deliberately.

### The precedent to mirror

`migrations/20260708150000_password_management.sql:47-79` already establishes this repo's pattern for
a short-lived server-side secret:

- a dedicated table with the token as primary key and an `expires_at timestamptz NOT NULL` (`:48-52`)
- `ENABLE ROW LEVEL SECURITY`, then `REVOKE ALL ON … FROM anon, authenticated` (`:57-58`)
- a `SECURITY DEFINER` creator function documented "server-side only … NEVER expose this to the
  browser" (`:61-63`)

Follow that shape. The one deliberate difference: a password-reset token is
`encode(gen_random_bytes(32), 'hex')` because it travels in a URL, whereas an enrolment code has to be
typed into WhatsApp by a person — so it is short and numeric. Compensate for the smaller keyspace with
a short expiry and an attempt limit, both specified below.

## Scope

**In:** the phone columns on `public.users`, an enrolment-code table, and three RPCs — start, confirm,
resolve.

**Out:** the inbound webhook is **not** modified. It still calls `chat_ingest_inbound_whatsapp` exactly
as today, so behaviour is unchanged until a later plan wires the resolver in. This plan is additive
schema plus functions with no caller.

**Out:** the admin UI to trigger enrolment (separate plan), the command router (separate plan), and any
change to `chat_ingest_inbound_whatsapp`.

**Out:** applying the migration — see Guardrails.

## Work

### 1. `migrations/20260815100000_staff_whatsapp_identity.sql`

Everything below in one forward-only migration.

**Columns on `public.users`:**

```sql
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS whatsapp_phone text,
    ADD COLUMN IF NOT EXISTS whatsapp_phone_verified_at timestamptz;
```

Then:

- A **unique index on `whatsapp_phone` where it is not null**, so one number can never map to two
  users. A partial unique index, not a constraint, so unenrolled users (NULL) are unaffected:
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_whatsapp_phone ON public.users (whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;`
- Store **canonical bare digits** (`27…`), the same form the webhook receives. Reuse the existing
  `public.chat_normalize_phone(text)` from
  `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72` — do not write a second
  normaliser. A number is only ever compared in canonical form.
- Column comments stating that `whatsapp_phone` is canonical bare digits and that a row is only
  trusted for command authorisation when `whatsapp_phone_verified_at IS NOT NULL`.

**Enrolment code table:**

```sql
CREATE TABLE IF NOT EXISTS public.whatsapp_enrolment_codes (
    phone        text PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    code         text NOT NULL,
    attempts     integer NOT NULL DEFAULT 0,
    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_enrolment_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_enrolment_codes FROM anon, authenticated;
```

`phone` as primary key means starting a second enrolment for the same number replaces the pending one
rather than leaving two live codes.

**`whatsapp_start_enrolment(p_user_id uuid, p_phone text) RETURNS jsonb`** — `SECURITY DEFINER`.

- Normalise `p_phone` via `chat_normalize_phone`; reject anything that does not normalise to at least
  10 digits.
- Fail with a clear error if the normalised number is already on a *different* user's verified row.
- Generate a **6-digit numeric code**: `lpad((floor(random() * 1000000))::int::text, 6, '0')`.
- Upsert into `whatsapp_enrolment_codes` with `expires_at = now() + interval '15 minutes'` and
  `attempts = 0`.
- Return `jsonb_build_object('success', 1, 'code', v_code, 'expires_at', …)`.
- Comment it **server-side only — never expose the code to the browser of a different user**, mirroring
  the password-reset wording. The code is delivered to the handset, which is what proves possession.

**`whatsapp_confirm_enrolment(p_phone text, p_code text) RETURNS jsonb`** — `SECURITY DEFINER`, called
by the webhook under service_role.

- Normalise the phone. Look up the pending row.
- Reject when: no row, `expires_at < now()`, or `attempts >= 5`. On a wrong code, **increment
  `attempts` and return failure** — that attempt limit is what makes a 6-digit code safe.
- On success: set `users.whatsapp_phone` and `whatsapp_phone_verified_at = now()` for the row's
  `user_id`, then **delete the code row**.
- Return `success` plus the `user_id` and the user's display name so the webhook can reply by name.
- Compare the code with a plain equality on a normalised (trimmed) value. Do not attempt a
  timing-safe comparison here — the attempt counter is the control, and PL/pgSQL has no primitive for
  it.

**`whatsapp_resolve_staff_user(p_phone text) RETURNS jsonb`** — `SECURITY DEFINER`, the function every
later stage depends on.

- Normalise the phone, then return the matching **active, verified** user:
  `WHERE u.whatsapp_phone = v_phone AND u.whatsapp_phone_verified_at IS NOT NULL AND u.is_active IS TRUE`.
- Return `user_id`, `role_id`, and the display name; return a clear "not enrolled" result otherwise.
- **Never** return a user whose `whatsapp_phone_verified_at` is NULL.

**Grants — this part is load-bearing.** `whatsapp_confirm_enrolment` and
`whatsapp_resolve_staff_user` must be **`service_role` only**:

```sql
REVOKE ALL ON FUNCTION public.whatsapp_confirm_enrolment(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_confirm_enrolment(text, text) TO service_role;
```

Same for `whatsapp_resolve_staff_user(text)`. The reason is specific and must not be softened: the
browser calls RPCs as `anon` (`WebPortal/js/data-functions.js` hardcodes `useAnonAuth: true`, noted at
`migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:28-29`), so **anything granted to `anon`
is callable by anyone holding the public key that ships in the browser.** A resolver reachable from
`anon` would turn a phone number into a user id and role for any caller.

`whatsapp_start_enrolment` is called from the admin UI, so it may be granted to `authenticated`; add
the `role_permissions` seed row for it following `docs/RBAC_NEW_FUNCTION_CHECKLIST.md`. Grant it to
`super_user` and `admin` only — not to every role. The pattern in `docs/RBAC_GUIDE.md` that grants a
new function to every role is the documented cause of the current permission drift (`CLAUDE.md`), so do
not follow it here.

End with `NOTIFY pgrst, 'reload schema';`.

### 2. `WebPortal/js/data-functions.js` — one wrapper

Add `startWhatsappEnrolment(userId, phone)` calling `whatsapp_start_enrolment`, following the shape of
the wrappers already in that file. **Add no wrapper for the other two functions** — they are
service_role only and a browser wrapper for them would be dead code that invites someone to grant them
to `anon` later to "fix" it.

Bump the `data-functions.js` cache-bust in `WebPortal/index.html` (the `?v=` on its `<script src>`).
This repo has shipped commits whose only purpose was that bump, because a merged change behind a stale
cache key reaches nobody.

## Guardrails

- **You cannot apply this migration.** No database credential and no network path to a database exists
  in this environment. Author the file; a human applies it with
  `npm run db:apply -- migrations/<file>.sql`. Do not try to connect to Postgres, and do not treat
  "unapplied" as a failure.
- **`dev` auto-deploys on merge, before a human applies the migration.** The single wrapper added above
  must therefore fail soft: a `PGRST202` / "could not find the function" response must surface as a
  normal error, never an unhandled exception. Nothing in the portal calls it yet, so no screen may
  change behaviour either way.
- **Forward-only.** Do not edit `20260813090000_whatsapp_inbound_shared_inbox.sql`,
  `20260812100000_crm_whatsapp_module.sql`, or any other applied migration.
- **Do not modify `supabase/functions/whatsapp-inbound/index.ts`** or any other edge function. A later
  plan wires the resolver in.
- **Do not modify `chat_ingest_inbound_whatsapp`.** Its CRM-contact resolution stays exactly as is;
  staff identity is a parallel concept, not a replacement.
- **Do not grant `whatsapp_confirm_enrolment` or `whatsapp_resolve_staff_user` to `anon` or
  `authenticated`** under any circumstance.
- Do not add an npm dependency; do not create a `package-lock.json`; do not weaken `npm run test:fleet`.
- Do not add a `users.username` reference anywhere — that column was dropped and
  `npm run username:verify` gates against it.
- No UI beyond the one wrapper. No new module, no new screen.

## Acceptance criteria

1. Exactly one new migration, `migrations/20260815100000_staff_whatsapp_identity.sql`.
2. It adds `users.whatsapp_phone` and `users.whatsapp_phone_verified_at` (spelled `timestamptz`), plus
   a **partial** unique index on `whatsapp_phone` where not null.
3. It creates `whatsapp_enrolment_codes` with `phone` as primary key, an `attempts` column,
   `expires_at`, `ENABLE ROW LEVEL SECURITY`, and `REVOKE ALL … FROM anon, authenticated`.
4. Three functions exist: `whatsapp_start_enrolment`, `whatsapp_confirm_enrolment`,
   `whatsapp_resolve_staff_user`.
5. **Grep-checkable:** the migration contains `GRANT EXECUTE ON FUNCTION public.whatsapp_confirm_enrolment`
   and `…whatsapp_resolve_staff_user` **only** with `TO service_role`, and contains no `GRANT` of either
   to `anon` or `authenticated`.
6. `whatsapp_resolve_staff_user` filters on both `whatsapp_phone_verified_at IS NOT NULL` and
   `is_active IS TRUE`.
7. `whatsapp_confirm_enrolment` increments `attempts` on a wrong code and refuses at 5, and deletes the
   code row on success.
8. The migration calls `public.chat_normalize_phone` and **defines no second phone normaliser** —
   `grep -c "chat_normalize_phone"` is at least 1 and there is no new `CREATE FUNCTION` containing
   `regexp_replace` on a phone.
9. `data-functions.js` gains exactly one new wrapper, `startWhatsappEnrolment`, and no wrapper for the
   two service-role functions.
10. `WebPortal/index.html`'s `data-functions.js` `?v=` value has changed.
11. The migration ends with `NOTIFY pgrst, 'reload schema';` and seeds `role_permissions` for
    `whatsapp_start_enrolment` for `super_user`/`admin` only.
12. No edge function is modified. No existing migration is modified. No `users.username` reference.
13. `npm run test:fleet` passes, including `ui:verify` and `migrations:verify` — so the new migration's
    filename prefix must be unique and a valid timestamp.
