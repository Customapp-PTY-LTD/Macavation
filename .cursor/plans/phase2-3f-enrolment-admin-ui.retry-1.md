---
depends_on: phase2-3a-staff-whatsapp-phone-identity.md
retry_of: ef754e7c-c8da-4f4d-8c70-fa67501a8aa0
---

# Record the staff-WhatsApp enrolment gap (portal enrolment is not yet buildable)

## Context

The intent behind this task was to add a portal control that enrols a staff member's WhatsApp phone.
Reading the code in this checkout shows that control cannot be built without either an SQL privilege
change or a new server-side caller, both of which are out of scope here and one of which is actively
dangerous. Everything below is verifiable in this checkout — no live database, network, or Meta API
access is required or assumed.

What exists:

- `migrations/20260815100000_staff_whatsapp_identity.sql` adds `public.users.whatsapp_phone` and
  `whatsapp_phone_verified_at` (`:50-52`), the `public.whatsapp_enrolment_codes` table (`:75-83`),
  and three functions: `whatsapp_start_enrolment(p_requesting_user_id uuid, p_user_id uuid,
  p_phone text)` (`:134-138`), `whatsapp_confirm_enrolment(p_phone text, p_code text)` (`:219-222`)
  and `whatsapp_resolve_staff_user(p_phone text)` (`:305`).
- That migration's grants block (`:380-398`) REVOKEs EXECUTE from `PUBLIC`, `anon` and
  `authenticated` for all four functions it creates and GRANTs only to `service_role`.

Why a portal screen cannot call it today:

- Every portal RPC is sent with the anon key: `dataFunctions.callFunction` delegates to
  `callSupabaseRpc(..., { useAnonAuth: true, ... })` (`WebPortal/js/data-functions.js:667-672`), and
  `callSupabaseRpc` documents why ("portal login JWT is not a Supabase Auth token",
  `:495-498`, bearer selection `:508-510`). A browser call to `whatsapp_start_enrolment` therefore
  arrives as `anon`, which has no EXECUTE.
- Even with EXECUTE, `whatsapp_start_enrolment` returns
  `{"success":0,"error":"Requesting user is not authorised to manage users."}` unless
  `p_requesting_user_id` is an active `admin.users.manage` holder (`:153-155`, helper `:102-123`),
  and that argument is client-asserted — the migration header states this explicitly (`:17-26`), as
  does the in-function comment (`:148-152`).
- The function's COMMENT reads "SERVER-SIDE ONLY — NEVER expose this function or its returned code
  to the browser" (`:208-212`).
- There is no browser wrapper to build on: grep for `enrolment`/`enrollment`/`startWhatsapp`
  (case-insensitive) across `WebPortal/` returns zero matches.

Why the state display cannot be built either:

- `get_users()` returns `id, email, first_name, last_name, role, role_id, role_name, is_active,
  created_at, updated_at` and nothing else
  (`migrations/20260708130000_users_first_last_name_replace_username.sql:103-117`); it is the only
  definition of that function in `migrations/`, and `dataFunctions.getUsers`
  (`WebPortal/js/data-functions.js:748-756`) is what the users grid consumes
  (`WebPortal/modules/users/js/users_grid.js:104`). Neither `whatsapp_phone` nor
  `whatsapp_phone_verified_at` is available to the browser.
- The pending-code state lives in `whatsapp_enrolment_codes`, which has RLS enabled and
  `REVOKE ALL ON public.whatsapp_enrolment_codes FROM PUBLIC, anon, authenticated`
  (`migrations/20260815100000_staff_whatsapp_identity.sql:91-92`). The browser can never read it.

Consequence: this plan's deliverable is **narrowed** from a working screen to an honest, verifiable
record of the gap. Do not attempt the screen. Do not attempt to "unblock" it by granting EXECUTE to
`anon`/`authenticated`: because `p_requesting_user_id` is client-asserted, that grant would let
anyone holding the public anon key that ships in the browser mint an enrolment code binding any phone
to any staff `user_id`, including a super_user.

## Scope

**In:** one new markdown investigation record under `docs/phase2/` that states what exists, what
blocks a portal enrolment screen, what a future plan would need, and that the work remains open.

**Out:** any change under `WebPortal/` — no new column, field, dialog, action, wrapper or state
display. The screen described in the previous version of this plan is deferred, not delivered.

**Out:** any change under `supabase/`, any `.sql` file, and any migration. In particular no GRANT of
`whatsapp_start_enrolment`, `whatsapp_confirm_enrolment`, `whatsapp_resolve_staff_user` or
`whatsapp_user_manages_users` to `anon`, `authenticated` or `PUBLIC`.

**Out:** wiring `whatsapp_confirm_enrolment` into the webhook — the router plans own the webhook, and
a concurrent edit here would conflict.

**Out:** help-page / user-manual edits. `.cursor/rules/user-guide-update.mdc` triggers on a change to
"what users see or do" in the Web Portal; this plan changes nothing users see or do, and adding a
help section describing an enrolment flow that no portal control offers and whose confirmation step is
not wired would document a feature that does not exist. `WebPortal/help/index.html` and
`WebPortal/help/user-manual.html` must not be modified by this plan.

**Out:** unenrolling or editing a number, sending the code by WhatsApp, and any bulk enrolment.

## Work

### 1. Add `docs/phase2/STAFF_WHATSAPP_ENROLMENT_PORTAL_STATUS.md`

One new file. No other file in the repo may be modified (including `docs/README.md`, whose
subdirectory file-count table states it "is not enforced by anything" — leave it alone rather than
grow this diff).

Follow the house style of `docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md`: a title, an
explicit **Status** line at the top, then numbered sections. Required content:

1. **Status line, first thing in the file.** It must say the portal enrolment control is **OPEN — not
   implemented**, and that this document records an investigation only. It must not describe the
   enrolment flow as available, working, or partially shipped.
2. **What exists today**, with `file:line` citations for each item — the two `public.users` columns,
   the `whatsapp_enrolment_codes` table, the three functions with their *actual* signatures
   (`whatsapp_start_enrolment` takes **three** arguments: `p_requesting_user_id`, `p_user_id`,
   `p_phone`), and the `service_role`-only grants.
3. **Why the portal cannot call these functions**, citing: the grants block; the anon-key transport in
   `WebPortal/js/data-functions.js`; the client-asserted nature of `p_requesting_user_id`; and the
   function COMMENT that forbids browser exposure. State plainly that no browser wrapper exists
   (grep for `enrolment`/`startWhatsapp` under `WebPortal/` returns nothing) and that none is added
   here.
4. **Why per-user enrolment state cannot be displayed**, citing the `get_users()` column list and the
   `whatsapp_enrolment_codes` REVOKE/RLS lines. Do not propose a raw `/rest/v1/users?select=...`
   fetch as a workaround — no browser file in this repo uses that pattern, and the table's own
   columns are still gated by the RPC layer the portal actually uses.
5. **The privilege change that must NOT be made, and why.** Record that granting EXECUTE on any of
   these functions to `anon`/`authenticated` would allow anyone holding the public anon key to mint an
   enrolment code binding an arbitrary phone to an arbitrary staff `user_id` (super_user included),
   because the requesting-user id is a client-supplied value rather than an authenticated session.
   Frame this as the rejected option, not as an option pending a decision.
6. **Prerequisites for a future plan** — written as prerequisites and open questions for humans, not
   as a chosen design or an approval:
   - a `service_role`-side caller that establishes the operator's `admin.users.manage` rights without
     trusting a client-asserted uuid, and that never returns the raw code to a browser. Note that no
     edge function in this repo currently references any of the three functions (grep across
     `supabase/` returns no matches), so this does not exist yet and its design needs human review.
   - a browser-safe read path for enrolment state (for example extending `get_users()` or adding a
     narrowly-scoped read RPC that exposes verified-state but never the code) — an SQL change, hence
     a separate, reviewed plan.
   - the confirmation half: `whatsapp_confirm_enrolment` is only reachable once the inbound webhook is
     wired, which `phase2-3c-whatsapp-command-router.md` owns. Until that lands and its migration is
     applied, issuing a code could not complete an enrolment even if a code could be issued.
7. **Code-delivery constraint, stated only as far as this checkout proves it.** Every WhatsApp send in
   this repo is `type: 'text'` (`supabase/functions/send-whatsapp-message/index.ts:127`) and a grep
   for `template` across `supabase/functions/` finds no template send. Record that as "no function in
   this repo sends a template today". Do **not** assert what Meta's messaging window permits, what
   Control Room's `meta-proxy` supports, or that any out-of-band code hand-off is approved policy —
   none of that is checkable from this checkout. Mark the delivery mechanism as an open question.

**Accuracy constraints for the whole document, non-negotiable:**

- Every factual claim about this repo carries a `file:line` citation that resolves in this checkout.
  Verify each citation by reading the file before writing it; do not copy line numbers from this plan
  without checking them.
- No claim that depends on a live database, a deployed environment, message volumes, dates of
  deployment, or an external API. If something cannot be checked by reading this repo, either omit it
  or label it explicitly as unverified and open.
- No "resolved", "done", "shipped", or "safe to expose" language anywhere in the file.
- Do not restate the historical premise that a `startWhatsappEnrolment` wrapper or a two-argument
  `whatsapp_start_enrolment(p_user_id, p_phone)` exists; both are false and repeating them is what
  produced this dead end.

## Guardrails

- **No file under `WebPortal/` is modified or added.** No wrapper in `WebPortal/js/data-functions.js`;
  no edit to `WebPortal/modules/users/**`; no edit to `WebPortal/help/**`.
- **No file under `supabase/` is modified or added**, and **no `.sql` file is added or changed** —
  including no migration, no GRANT, no REVOKE.
- **Do not add a wrapper for `whatsapp_start_enrolment`, `whatsapp_confirm_enrolment` or
  `whatsapp_resolve_staff_user`.** All are `service_role` only by design; a browser wrapper would be
  dead code inviting someone to grant them to `anon`.
- **Do not write, print, log or store any enrolment code**, and do not add anything that could
  produce one.
- Do not run `scripts/apply_user_guide_help_links.mjs`; it rewrites many files and would bury this
  diff.
- Do not modify `CLAUDE.md`, `docs/README.md`, `package.json`, or any `scripts/*.mjs`.
- No new npm dependency; no `package-lock.json` (`npm ci` does not work in this repo — use
  `npm run <script>`).
- The design/UI bans (`ui:verify`: raw hex, `linear-gradient`, Bootstrap Icons, `btn-success`,
  `.badge` `min-width`, module `td/th` padding) are not expected to be reachable by a markdown-only
  change — `scripts/verify-ui-standard.mjs` walks `WebPortal/` for `.css`, `.html` and `.js` only
  (`:24`, `:42`, `:60-61`) — but do not introduce any of them anywhere.

## Acceptance criteria

1. **Grep-checkable:** `git diff --stat` lists exactly one added file,
   `docs/phase2/STAFF_WHATSAPP_ENROLMENT_PORTAL_STATUS.md`, and nothing else.
2. **Grep-checkable:** no file under `WebPortal/` appears in the diff — in particular none under
   `WebPortal/modules/users/`, `WebPortal/js/data-functions.js`, or `WebPortal/help/`.
3. **Grep-checkable:** no file under `supabase/` appears in the diff, and no `.sql` file is added or
   changed.
4. **Grep-checkable:** the diff contains no `GRANT` or `REVOKE` statement and no occurrence of
   `startWhatsappEnrolment`, and adds no function wrapper for `whatsapp_start_enrolment`,
   `whatsapp_confirm_enrolment` or `whatsapp_resolve_staff_user`.
5. The new document's first Status line states the portal enrolment control is OPEN / not
   implemented, and the document nowhere describes the enrolment flow as available or complete.
6. The document records the correct three-argument signature of `whatsapp_start_enrolment` and the
   `service_role`-only grants, each with a citation that resolves in this checkout.
7. The document records both display blockers — `get_users()` returning no WhatsApp columns, and
   `whatsapp_enrolment_codes` being RLS-enabled and revoked from `anon`/`authenticated` — with
   resolving citations.
8. The document records the anon-grant option as rejected, with the takeover reasoning, and does not
   present it as a pending choice.
9. The document lists the prerequisites for a future portal enrolment screen (a `service_role`-side
   caller, a browser-safe read path for verified state, and the webhook confirmation half) as open
   items requiring separate reviewed plans.
10. Every `file:line` citation in the document resolves to the content it claims, and no claim rests
    on data outside this checkout (no live-database figures, no external API behaviour asserted as
    fact).
11. `npm run ui:verify` passes, and `npm run test:fleet` passes.
12. No new npm dependency; no `package-lock.json`.
