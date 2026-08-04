---
retry_of: fb2192a6-2a10-4925-984a-2b6a82e84dd3
---

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
column anywhere on `public.users` (only `first_name`/`last_name` were added, `20260708130000:14-15`).
So a staff member texting the line today becomes an unattributed shared-inbox item, with no user and
therefore no role.

This plan adds a verified phone → user → role mapping. It is the first link in the chain and every
later WhatsApp stage depends on it.

**Identity must never be inferred from an unverified number.** The number Meta reports is trustworthy
as *a* number, but nothing stops someone claiming to be a colleague until we have tied that number to
a user deliberately, from a server-side path.

### Two facts about this repo that drive the design of this migration

1. **The browser always calls the database as `anon`.** `WebPortal/js/data-functions.js` sends every
   RPC to PostgREST with the anon key as bearer (`:667-672` passes `useAnonAuth: true`; `:508-510`
   selects `cfg.anonKey`; `:655-656` records that the AWS Lambda proxy is retired). There is no
   per-user database role. Therefore **any function granted to `anon` or `authenticated` is callable
   by anyone holding the public key that ships in the browser**, and any `p_user_id` /
   `p_requesting_user_id` argument such a caller passes is *client-asserted*, not authenticated.
   Consequence for this plan: a function that mints an identity-binding secret must not be reachable
   from the browser at all. All three functions here are `service_role` only.
2. **`role_permissions` is not a runtime control.** It was enforced by the retired Lambda proxy
   (`20260813090000_whatsapp_inbound_shared_inbox.sql:586-587` calls it "largely vestigial,
   Lambda-proxy-era"; `docs/RBAC_NEW_FUNCTION_CHECKLIST.md` describes a Lambda-side flow). We still
   seed it for convention, but it must never be described in this migration as the thing that
   restricts who may enrol a phone.

### The precedent to mirror

`migrations/20260708150000_password_management.sql:47-79` establishes this repo's pattern for a
short-lived server-side secret:

- a dedicated table with the token as primary key and an `expires_at timestamptz NOT NULL` (`:48-52`)
- `ENABLE ROW LEVEL SECURITY`, then `REVOKE ALL ON … FROM anon, authenticated` (`:57-58`)
- a `SECURITY DEFINER` creator function documented "server-side only … NEVER expose this to the
  browser" (`:61-63`)
- the secret generated with `encode(gen_random_bytes(32), 'hex')` (`:79`) — a CSPRNG, not `random()`

Follow that shape, including the CSPRNG. The one deliberate difference: an enrolment code has to be
typed into WhatsApp by a person, so it is short and numeric. Compensate for the smaller keyspace with
a short expiry and an attempt limit, both specified below — and still derive the digits from
`gen_random_bytes`, never from `random()`.

## Scope

**In:** the phone columns on `public.users`, an enrolment-code table, and three RPCs — start, confirm,
resolve. All three are `service_role` only.

**Out:** the inbound webhook is **not** modified. It still calls `chat_ingest_inbound_whatsapp` exactly
as today, so behaviour is unchanged until a later plan wires the resolver in. This plan is additive
schema plus functions with no caller.

**Out:** the admin UI to trigger enrolment (separate plan), the command router (separate plan), and any
change to `chat_ingest_inbound_whatsapp`.

**Out — and this is a change from the first draft of this plan: no `WebPortal/` change at all.** No
`data-functions.js` wrapper, no `index.html` cache-bust bump. A browser wrapper is only useful if the
function is granted to `anon` (see fact 1 above), which for this function is exactly the hole we are
avoiding. Portal-initiated enrolment lands in the later plan that also adds the edge function which
delivers the code to the handset; that plan owns the wrapper and the cache-bust bump.

**Out: delivering the code to the target handset.** No edge function is added or modified here, so
nothing in this plan sends the code anywhere. `whatsapp_start_enrolment` returns the code to its
`service_role` caller and records who requested it; the delivery step (and the "we texted your own
handset, so possession is proven" property that depends on it) belongs to the later plan. The
migration header must say this in plain words rather than claim possession is already proven.

**Out:** applying the migration — see Guardrails.

## Work

### 1. `migrations/20260815100000_staff_whatsapp_identity.sql`

Everything below in one forward-only migration. Prefix `20260815100000` is unused, is a valid UTC
timestamp, and is later than the newest migration (`20260814090000_fix_chat_send_message_ambiguity.sql`).

**Header comment.** State: (a) canonical phone form is bare digits, matching
`20260813090000:20-25`; (b) all three functions are `service_role` only because the browser calls
PostgREST as `anon`; (c) nothing in this migration delivers the enrolment code to a handset — that is a
later plan — so a code produced here is only as trustworthy as the server-side caller that requested
it; (d) `role_permissions` seeds below are convention only and are not the access control.

**Columns on `public.users`:**

```sql
ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS whatsapp_phone text,
    ADD COLUMN IF NOT EXISTS whatsapp_phone_verified_at timestamptz;
```

Then:

- A **partial unique index on `whatsapp_phone` where it is not null**, so one number can never map to
  two users, while unenrolled users (NULL) are unaffected:
  `CREATE UNIQUE INDEX IF NOT EXISTS ux_users_whatsapp_phone ON public.users (whatsapp_phone) WHERE whatsapp_phone IS NOT NULL;`
- Store **canonical bare digits** (`27…`), the same form the webhook receives. Reuse the existing
  `public.chat_normalize_phone(text)` from `20260813090000:72` — do not write a second normaliser. A
  number is only ever compared in canonical form.
- Column comments stating that `whatsapp_phone` is canonical bare digits and that a row is only
  trusted for command authorisation when `whatsapp_phone_verified_at IS NOT NULL`.

**Enrolment code table:**

```sql
CREATE TABLE IF NOT EXISTS public.whatsapp_enrolment_codes (
    phone                 text PRIMARY KEY,
    user_id               uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    requested_by_user_id  uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
    code                  text NOT NULL,
    attempts              integer NOT NULL DEFAULT 0,
    expires_at            timestamptz NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_enrolment_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_enrolment_codes FROM PUBLIC, anon, authenticated;
```

`phone` as primary key means starting a second enrolment for the same number replaces the pending one
rather than leaving two live codes. `requested_by_user_id` records who initiated the binding, so an
enrolment can be audited and, later, notified.

**All three functions below are `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions`.**
Pinning `search_path` on a definer function is the repo's existing idiom — see
`20260813090000:75, 98, 119, 161` and `20260708150000:65, 92` — and it is required here because these
functions call `gen_random_bytes` from `extensions`. Do not create any definer function in this
migration without an explicit `SET search_path`.

**`whatsapp_start_enrolment(p_requesting_user_id uuid, p_user_id uuid, p_phone text) RETURNS jsonb`**

- **Authorisation inside the function, first, before anything else.** Reject unless
  `p_requesting_user_id` is a non-NULL, `is_active IS TRUE` user whose role holds the
  `admin.users.manage` action. Implement the check with the same shape as
  `public.chat_has_whatsapp_inbox_access` (`20260813090000:116-137`): join
  `public.users → public.role_actions → public.actions` on `a.key = 'admin.users.manage'` with
  `COALESCE(ra.value, '') = 'true'`. That action key exists and is seeded to `super_user`/`admin` only
  (`20260602100000_create_actions_tables.sql:60, 67-86`). Either inline the EXISTS or add a small
  `SECURITY DEFINER STABLE` helper in this migration; if you add a helper, it also gets
  `SET search_path = public, extensions` and it is **not** granted to `anon` or `authenticated`.
- Comment plainly that this in-function check is defence-in-depth for a server-side caller and is
  **not** a substitute for the `service_role`-only grant, because `p_requesting_user_id` is supplied by
  the caller and cannot be authenticated by the database.
- Reject unless `p_user_id` is a non-NULL, `is_active IS TRUE` user.
- Normalise `p_phone` via `chat_normalize_phone`; reject anything that does not normalise to at least
  10 digits.
- Fail with a clear error if the normalised number is already on a *different* user's row with
  `whatsapp_phone_verified_at IS NOT NULL`.
- Generate a **6-digit numeric code from a CSPRNG**, never `random()`. Draw the bytes once into a
  variable and derive the digits, e.g.:
  ```sql
  v_bytes := gen_random_bytes(4);
  v_code  := lpad((
        (get_byte(v_bytes, 0)::bigint * 16777216
       + get_byte(v_bytes, 1)::bigint * 65536
       + get_byte(v_bytes, 2)::bigint * 256
       + get_byte(v_bytes, 3)::bigint) % 1000000)::text, 6, '0');
  ```
- Upsert into `whatsapp_enrolment_codes` (`ON CONFLICT (phone) DO UPDATE`) with
  `expires_at = now() + interval '15 minutes'`, `attempts = 0`, `created_at = now()`,
  `requested_by_user_id = p_requesting_user_id`.
- Return `jsonb_build_object('success', 1, 'code', v_code, 'expires_at', …)`.
- Comment it **server-side only — never expose this function or its code to the browser**, mirroring the
  password-reset wording, and note that the code must be delivered to the *target user's* handset by
  the later delivery plan, not read out by the initiator.

**`whatsapp_confirm_enrolment(p_phone text, p_code text) RETURNS jsonb`** — called by the webhook under
`service_role` in a later plan.

- Normalise the phone. Look up the pending row (`WHERE phone = v_phone`).
- Reject when: no row, `expires_at < now()`, or `attempts >= 5`. On a wrong code, **increment
  `attempts` and return failure** — that attempt limit is what makes a 6-digit code safe. The
  increment must be explicitly scoped:
  `UPDATE public.whatsapp_enrolment_codes SET attempts = attempts + 1 WHERE phone = v_phone;`
- **Re-check before writing** that no *other* user already holds this number with
  `whatsapp_phone_verified_at IS NOT NULL` (state can change between start and confirm). Return a
  clean failure if so — do not let the partial unique index raise.
- On success:
  - `UPDATE public.users SET whatsapp_phone = v_phone, whatsapp_phone_verified_at = now() WHERE id = v_row.user_id;`
    — the `WHERE id = …` is mandatory.
  - `DELETE FROM public.whatsapp_enrolment_codes WHERE phone = v_phone;` — the `WHERE phone = …` is
    mandatory. A bare `DELETE FROM public.whatsapp_enrolment_codes` would wipe every pending
    enrolment and must not appear in this file.
- Wrap the write in `EXCEPTION WHEN unique_violation THEN` returning a clear failure jsonb, so a race
  against `ux_users_whatsapp_phone` surfaces as a normal error rather than an unhandled exception.
- Return `success` plus the `user_id` and the user's display name (`first_name`/`last_name`; there is
  no `username` column) so the webhook can reply by name.
- Compare the code with plain equality on a trimmed value. Do not attempt a timing-safe comparison —
  the attempt counter is the control, and PL/pgSQL has no primitive for it.

**`whatsapp_resolve_staff_user(p_phone text) RETURNS jsonb`** — the function every later stage depends
on.

- Normalise the phone, then return the matching **active, verified** user:
  `WHERE u.whatsapp_phone = v_phone AND u.whatsapp_phone_verified_at IS NOT NULL AND u.is_active IS TRUE`.
- Return `user_id`, `role_id`, and the display name; return a clear "not enrolled" result otherwise.
- **Never** return a user whose `whatsapp_phone_verified_at` is NULL.

**Grants — this part is load-bearing and applies to ALL THREE functions.** Every function created in
this migration (including any authorisation helper) is `service_role` only:

```sql
REVOKE ALL ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.whatsapp_start_enrolment(uuid, uuid, text) TO service_role;
```

Same three REVOKEs plus the single `service_role` GRANT for
`whatsapp_confirm_enrolment(text, text)` and `whatsapp_resolve_staff_user(text)` (the loop form at
`20260813090000:638-652` is a fine template). The reason must not be softened: the browser calls RPCs
as `anon`, so anything granted to `anon` is callable by anyone holding the public key that ships in the
browser — a resolver reachable from `anon` turns a phone number into a user id and role for any caller,
and a starter reachable from `anon` lets any caller mint a code bound to any `user_id`.

**`role_permissions` seed.** Seed `role_permissions` rows for the three function names for the
`super_user` and `admin` roles only (resolve role ids by `role_name`, `ON CONFLICT DO NOTHING`),
directly above a comment stating that this layer is the vestigial Lambda-proxy-era RBAC table
(`20260813090000:586-587`), is not enforced now that the portal calls PostgREST directly, and is **not**
what restricts these functions — the `service_role`-only grant is. Do **not** seed all roles; CLAUDE.md
records the all-roles pattern as the cause of the current permission drift. Do **not** edit
`migrations/20260218000001_grant_all_data_functions_to_all_roles.sql`: `docs/RBAC_NEW_FUNCTION_CHECKLIST.md`
"Place 2" asks for that edit, but it is an already-applied migration and this repo is forward-only. If
you think the checklist needs updating, say so in the PR description; do not change the doc in this
change.

End with `NOTIFY pgrst, 'reload schema';`.

### 2. No portal work

Do not add a `data-functions.js` wrapper. Do not bump any `?v=` in `WebPortal/index.html`. Do not touch
any file under `WebPortal/`. Both belong to the later plan that adds the delivery edge function and the
admin screen; adding them now would either be dead code or pressure to grant `anon`.

## Guardrails

- **You cannot apply this migration.** No database credential and no network path to a database exists
  in this environment. Author the file; a human applies it with
  `npm run db:apply -- migrations/<file>.sql`. Do not try to connect to Postgres, and do not treat
  "unapplied" as a failure.
- **`dev` auto-deploys on merge, before a human applies the migration.** Because this change touches no
  `WebPortal/` file and no edge function, no screen can change behaviour either way — keep it that way.
- **Do not grant any function created here to `anon` or `authenticated`** under any circumstance, and do
  not grant to `PUBLIC`.
- **Every `SECURITY DEFINER` function in this file must carry `SET search_path = public, extensions`.**
- **No `random()` anywhere in this file.** Codes come from `gen_random_bytes`.
- **Every `UPDATE` and `DELETE` in this file must have an explicit `WHERE`.**
- **Forward-only.** Do not edit `20260813090000_whatsapp_inbound_shared_inbox.sql`,
  `20260812100000_crm_whatsapp_module.sql`, `20260218000001_grant_all_data_functions_to_all_roles.sql`,
  or any other applied migration.
- **Do not modify `supabase/functions/whatsapp-inbound/index.ts`** or any other edge function.
- **Do not modify `chat_ingest_inbound_whatsapp`.** Its CRM-contact resolution stays exactly as is;
  staff identity is a parallel concept, not a replacement.
- Do not add an npm dependency; do not create a `package-lock.json`; do not weaken `npm run test:fleet`
  or any script it calls, and do not add entries to `scripts/migration-prefix-baseline.json`.
- Do not add a `users.username` reference anywhere — that column was dropped and
  `npm run username:verify` gates against it.
- No UI. No new module, no new screen, no JS change.
- If `npm run test:fleet` fails on something this change did not touch (for example `ui:verify`
  reporting violations in CSS files unrelated to this work), **do not "fix" the unrelated files and do
  not weaken the gate** — report the failure and its file:line list in the PR description and stop.

## Acceptance criteria

1. Exactly one new migration, `migrations/20260815100000_staff_whatsapp_identity.sql`. No other file in
   the repo is added or changed.
2. It adds `users.whatsapp_phone` and `users.whatsapp_phone_verified_at` (spelled `timestamptz`), plus
   a **partial** unique index on `whatsapp_phone` where not null.
3. It creates `whatsapp_enrolment_codes` with `phone` as primary key, `user_id`,
   `requested_by_user_id`, an `attempts` column, `expires_at`, `ENABLE ROW LEVEL SECURITY`, and
   `REVOKE ALL … FROM PUBLIC, anon, authenticated`.
4. Three functions exist: `whatsapp_start_enrolment(uuid, uuid, text)`,
   `whatsapp_confirm_enrolment(text, text)`, `whatsapp_resolve_staff_user(text)`.
5. **Grep-checkable, all three (plus any helper added here):** each has `GRANT EXECUTE ON FUNCTION …`
   **only** `TO service_role`, and the file contains **no** `GRANT` of any function it creates to `anon`,
   `authenticated` or `PUBLIC`. `grep -n "TO anon\|TO authenticated\|TO PUBLIC" ` on the new file returns
   nothing.
6. **Grep-checkable:** every `CREATE OR REPLACE FUNCTION` / `CREATE FUNCTION` in the file is followed by
   `SECURITY DEFINER` and `SET search_path = public, extensions`; the count of `SET search_path` is at
   least the count of functions created.
7. `whatsapp_start_enrolment` takes `p_requesting_user_id` as its first parameter and refuses unless
   that user is active and holds the `admin.users.manage` action via `role_actions`/`actions`; it also
   refuses an inactive or non-existent `p_user_id`.
8. **Grep-checkable:** the file contains `gen_random_bytes` and contains no `random()`.
9. `whatsapp_resolve_staff_user` filters on both `whatsapp_phone_verified_at IS NOT NULL` and
   `is_active IS TRUE`.
10. `whatsapp_confirm_enrolment` increments `attempts` on a wrong code and refuses at 5; its user
    `UPDATE` is scoped `WHERE id = …`; its code `DELETE` is scoped `WHERE phone = …`; it re-checks that
    the number is not already verified on another user; and it handles `unique_violation` by returning a
    failure result. **Grep-checkable:** no unqualified `DELETE FROM public.whatsapp_enrolment_codes;`.
11. The migration calls `public.chat_normalize_phone` and **defines no second phone normaliser** —
    `grep -c "chat_normalize_phone"` is at least 1 and there is no new `CREATE FUNCTION` containing
    `regexp_replace` on a phone.
12. The migration header states that no delivery path for the code exists in this plan and that
    `role_permissions` is not the access control; the `role_permissions` seed covers only `super_user`
    and `admin` and carries that comment.
13. The migration ends with `NOTIFY pgrst, 'reload schema';`.
14. No edge function is modified. No existing migration is modified. No file under `WebPortal/` is
    modified. No `users.username` reference. No new entry in `scripts/migration-prefix-baseline.json`.
15. `npm run test:fleet` passes, including `ui:verify` and `migrations:verify` — so the new migration's
    filename prefix must be unique and a valid 14-digit UTC timestamp, and the `migrations/` directory
    must still contain nothing but `.sql` files at its top level. If `ui:verify` fails only on files
    this change did not touch, follow the Guardrails: report, do not fix, do not weaken.
