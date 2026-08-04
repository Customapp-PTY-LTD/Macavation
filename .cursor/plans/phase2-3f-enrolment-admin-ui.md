---
depends_on: phase2-3a-staff-whatsapp-phone-identity.md
---

# Enrol a staff phone from the portal

## Context

`whatsapp_start_enrolment(p_user_id, p_phone)` exists and `data-functions.js` has a
`startWhatsappEnrolment` wrapper, but nothing in the portal calls it — so no phone can actually be
enrolled. This plan adds the one screen control that makes the WhatsApp chain usable, plus the user-guide
entry.

### The enrolment flow, and why the code is not sent by WhatsApp

The obvious design — portal texts the code to the handset — runs into Meta's 24-hour customer-service
window. A message to a number that has never messaged us is business-initiated and needs an approved
template, and **no function in this repo has ever sent a template**: every send is
`type: 'text'` (`supabase/functions/send-whatsapp-message/index.ts:128`). Whether Control Room's
`meta-proxy` supports templates cannot be confirmed from this checkout, so the plan must not depend on it.

So the code travels **out of band**:

1. An admin opens the user in User & Access, enters the staff member's WhatsApp number, and clicks
   **Start WhatsApp enrolment**.
2. The portal shows the 6-digit code and its 15-minute expiry. The admin passes it to the person —
   in the room, or on a call.
3. The staff member sends the code to the Macavation WhatsApp line **from the handset being enrolled**.
   That inbound message is what proves possession, and because they messaged first, every later reply
   sits inside the 24-hour window with no template needed.

This is also why the confirm step lives in the webhook rather than the portal:
`phase2-3c-whatsapp-command-router.md` wires `whatsapp_confirm_enrolment` in, treating a six-digit
message from an unenrolled number as a confirmation attempt. **Until that plan has merged and its
migration is applied, issuing a code is as far as enrolment can get.** Say so in the UI — the screen must
not imply the person is enrolled when only the code has been issued. Show the verified state honestly
from `whatsapp_phone_verified_at`.

## Scope

**In:** the enrolment control and verified-state display in the users module; the help entry.

**Out:** wiring `whatsapp_confirm_enrolment` into the webhook — the router plans own the webhook, and a
concurrent edit here would conflict.

**Out:** unenrolling or editing a number, sending the code by WhatsApp, and any bulk enrolment.

## Work

### 1. `WebPortal/modules/users/` — the control

Add to the existing users screen, following whatever pattern that module already uses for a row action or
a detail panel — read `WebPortal/modules/users/js/users_grid.js` and match it rather than introducing a
new interaction style.

- A **WhatsApp** column or field showing, per user: the formatted number and a "verified" indicator when
  `whatsapp_phone_verified_at` is set, "code issued, awaiting reply" when only a pending code exists, or
  nothing when unenrolled. Use the existing `MacStatus` helper (`WebPortal/js/mac-status.js`) for the
  indicator rather than hand-rolling a badge, and do not set `min-width` on a `.badge` — `ui:verify`
  fails that.
- A **Start WhatsApp enrolment** action opening a small dialog: a phone input, and on submit a call to
  `dataFunctions.startWhatsappEnrolment(userId, phone)`. On success show the code, in large monospace
  text, with its expiry, and a line telling the admin to have the person send that code to the Macavation
  WhatsApp number from the phone being enrolled. On failure show the RPC's error message.

**Security invariants for this screen, non-negotiable:**

- **Render every dynamic value with `.text()`, never `.html()`/`innerHTML`.** Where the module builds
  markup as a string, escape with the shared `_common.escapeHtml` (added to
  `WebPortal/js/common.js` — it escapes `& < > " '`). Do not re-declare a local `escapeHtml`; a recent
  change collapsed 35 hand-written copies into that one, and adding a 36th undoes it.
- **Gate the action on `admin.users.manage`** — an already-seeded key that this module already uses. Call
  `hasAction('admin.users.manage')` **inline at render time**. Do **not** rely on a `data-action-perm`
  attribute: the router sweeps that attribute once over static markup shortly after module load, so it is
  **inert on dynamically rendered rows** (`CLAUDE.md`). This control is on a dynamic row.
- Treat the code as a **secret in transit**: show it in the dialog only, never write it into a table cell,
  a tooltip, a `console.log`, or the URL.

### 2. Help documentation

`.cursor/rules/user-guide-update.mdc` is `alwaysApply: true`, so a user-facing change carries its doc
update in the same task. Add a short section to `WebPortal/help/index.html` and
`WebPortal/help/user-manual.html` covering the three-step flow above, that the code expires in 15
minutes, that it must be sent from the phone being enrolled, and that five wrong attempts void it. State
plainly which WhatsApp commands exist — do not document commands that are not built.

Do not run `scripts/apply_user_guide_help_links.mjs`; it rewrites many files and would bury this diff.

## Guardrails

- **Do not modify `supabase/functions/whatsapp-inbound/index.ts`** or any edge function. The router plans
  own that file and run in the same batch.
- **Do not author or modify a migration.** `whatsapp_start_enrolment` already exists; this plan is UI plus
  docs. If it appears to be missing, it is because its migration is not applied yet — see the next point.
- **`dev` deploys on merge, before a human applies the prerequisite migration.** The screen must degrade
  gracefully: a `PGRST202` / "could not find the function" response must surface as a readable message
  ("WhatsApp enrolment is not available yet"), never an unhandled exception or a blank dialog. The users
  grid itself must keep working in that state — no throw during render.
- **Do not add a wrapper for `whatsapp_confirm_enrolment` or `whatsapp_resolve_staff_user`.** Both are
  `service_role` only by design; a browser wrapper would be dead code inviting someone to grant them to
  `anon`.
- **Do not display or store another user's code anywhere persistent.**
- **Do not add `data-dashboard-widget`** to anything — it hides elements permanently unless the id is
  registered in three separate places.
- Do not re-declare `escapeHtml`; do not introduce raw hex, a `linear-gradient`, Bootstrap Icons, or
  `btn-success` — `ui:verify` is now part of `npm run test:fleet` and fails on all four.
- No new npm dependency; no `package-lock.json`.

## Acceptance criteria

1. The users module shows per-user WhatsApp state distinguishing verified, code-issued, and unenrolled,
   and never claims a user is enrolled when only a code has been issued.
2. A **Start WhatsApp enrolment** action calls `dataFunctions.startWhatsappEnrolment` and displays the
   returned code plus expiry, with instructions to send it from the handset being enrolled.
3. The action is gated by an inline `hasAction('admin.users.manage')` call at render time.
   **Grep-checkable:** the new markup carries no `data-action-perm` attribute.
4. **Grep-checkable:** the touched files contain no new `function escapeHtml` or `escapeHtml:` definition;
   dynamic values go through `_common.escapeHtml` or `.text()`.
5. **Grep-checkable:** no `innerHTML =` is introduced for a value that came from the RPC response.
6. A missing RPC produces a readable message and the users grid still renders — no unhandled exception.
7. No file under `supabase/` is modified, and no `.sql` file is added or changed.
   `git diff --stat` lists neither.
8. No wrapper is added for `whatsapp_confirm_enrolment` or `whatsapp_resolve_staff_user`.
9. `WebPortal/help/index.html` and `WebPortal/help/user-manual.html` each gain a section describing the
   three-step flow, the 15-minute expiry, and the 5-attempt limit, and document only commands that exist.
10. `npm run ui:verify` passes, and `npm run test:fleet` passes.
11. No new npm dependency; no `package-lock.json`.
