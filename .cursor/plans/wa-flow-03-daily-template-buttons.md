---
depends_on: wa-flow-02-optout-and-pause.md
---

# WhatsApp: put quick-reply buttons on the daily report template, and answer the taps

## Context

The daily report template is the only way Macavation can reach a handset that has not replied in
24 hours. As written it delivers the figures and then dead-ends: the recipient has the numbers but
no way forward except knowing to type something.

A quick-reply button fixes that, and it is worth more than convenience. **A tap counts as the
recipient replying**, which opens Meta's 24-hour service window — and everything sent inside that
window is free-form and free. So one button turns a one-way notification into the entrance to the
whole menu, at no extra send cost. This is the single highest-leverage change in the WhatsApp work.

`scripts/submit-whatsapp-template.mjs` currently records the opposite decision, in a comment at
about `:50`: *"No buttons, deliberately. The sender passes only a body component…"*. That was a
reasonable call when the goal was to get one template approved quickly. This plan reverses it
**before** the template is ever submitted, so it costs nothing: the template does not exist at
Meta at all yet (verified against the live Control Room channel on 2026-09-07 — the channel holds
one template, `macavation_staff_welcome_template`, status `draft`, `metaTemplateId` null). Adding
buttons after approval would mean a second approval round.

## Read this first — what is already here, and where to read it

Locate every symbol **by name** (grep for it) and read it before writing against it. Line numbers
are hints, not assertions. Do not "fix" this plan's line numbers as a deliverable.

### The template definition — `scripts/submit-whatsapp-template.mjs`

A hand-run Node script, ~191 lines, committed but called by nothing. Read its header before you
touch it: it records the **two-project trap** (submission goes to Control Room's new project
`warfvygsmibtsmboktqu`, runtime sending to the old devtools project `ejnncypummmvyojhovme`; both
accept the same `crk_` key; `templates-api`'s own bundled doc prints the wrong ref). Do not change
`BASE`.

- `TEMPLATE` — the object at about `:55`, with `name: 'macavation_daily_production'`,
  `language`, `category: 'UTILITY'`, and `body` at about `:58`.
- The comment at about `:40` states the seven body variables are **FIXED by the sender**.
- The comment at about `:50` is the no-buttons decision this plan reverses. Replace it with a
  comment saying why buttons are now there — do not just delete it.
- A dry-run path renders the body with the `{{n}}` placeholders substituted (about `:166`). Keep
  that working.

### The sender — `supabase/functions/send-daily-production-report/index.ts`

- `TEMPLATE_NAME = 'macavation_daily_production'` at about `:56`. **Do not rename the template.**
- `buildTemplateParams(report)` at about `:123` returns exactly seven sanitised strings in a fixed
  order: date label, `cracked_kg`, `sk_packed_kg`, `wholes_pct`, `nis_kg`, `wtd_cracked_kg`,
  `wtd_target_kg`.
- `formatFigure` at about `:94` returns the literal string `'not captured'` for
  null/undefined/non-numeric — **never `'0'`** for an uncaptured figure. Do not change this. A zero
  and a missing figure are materially different statements.
- `sanitizeParam` at about `:114` deliberately avoids `\s`, because in JavaScript `\s` matches
  U+00A0 and that would destroy the non-breaking thousands separator `formatFigure` inserts. Do not
  "simplify" it to `\s`.
- The send is `sendTemplate(phone, TEMPLATE_NAME, 'en', [bodyComponent])` at about `:348`, where
  `bodyComponent` is built at about `:274`.

### The senders and their caps — `supabase/functions/_shared/wa-send.ts`

- `sendTemplate(to, templateName, languageCode, components?)` at about `:377`.
- `buildTemplateBody` at about `:170` produces `{name, language:{code}, components?}` and
  **throws** if a url-button parameter looks like a full URL.
- The gateway passes a `template` object through to Meta **unchanged**. Your builder must emit
  Meta's exact shape; nothing downstream will correct it.
- `supabase/functions/_shared/wa-limits.ts` — `MAX_BUTTON_CTA = 20`, `MAX_BUTTONS = 3`. These are
  enforced as **reject** thresholds, not silent truncation. A label over 20 characters throws.

### How a tap on a template button arrives — `supabase/functions/_shared/wa-inbound.ts`

This is the part that is easy to get wrong, and the repo already documents it at about `:107-118`
and `:159-171`:

> *"A tap on a quick-reply button attached to an APPROVED TEMPLATE arrives as `type:'button'`, not
> `interactive`."*

So there are three distinct button paths, and the template one is the third:

| Arrives as | Read from |
|---|---|
| `type:'interactive'`, `interactive.type==='button_reply'` | `interactive.button_reply.{id,title}` |
| `type:'interactive'`, `interactive.type==='list_reply'` | `interactive.list_reply.{id,title}` |
| **`type:'button'`** (template quick-reply) | `msg.button.text` / `msg.button.payload` |

`classifyMessage` already handles all three and maps the template variant to the same
`button_reply` kind, with `replyId = payload ?? text`. **It also notes that `.payload` must not be
assumed present.** That note is the reason for contract 3 below.

### The bot's dispatch — `supabase/functions/whatsapp-inbound/index.ts`

- `handleCommand` — a reply-id tap wins outright over free text. Find it by name.
- `buildReplyId(ns, action, arg?)` / `parseReplyId` in `_shared/wa-send.ts` at about `:205-232`.
  Segments must match `/^[a-z0-9][a-z0-9_-]{0,23}$/`. `parseReplyId` never throws; it returns null.
- `MENU_NS = 'menu'`, and `renderMenuItem(ctx, action)` renders one item by its action string.
- The existing menu actions include `report` (Latest report) and the menu itself.
- An unrecognised but well-formed reply id is already treated as a **stale menu**, not an error.

## An unconfirmed contract you must resolve from the code, not from this plan

**Whether Meta requires a `button` component in the outbound message for a quick-reply button's
payload to come back.** This checkout has never sent a template with buttons, so nothing here
proves it either way, and I am not asserting it.

What the repo *does* prove is that `.payload` may be absent on the inbound side — `wa-inbound.ts`
says so explicitly and codes `payload ?? text` for that reason.

Therefore: **dispatch on the button TEXT, not the payload** (contract 3). That is correct whether
or not a payload is supplied, so the ambiguity cannot bite. Do not add a button component to the
outbound send in order to set a payload — that would be building against an unverified contract.
If you find something in this checkout that settles the question, say so in your report; do not
change the design on the strength of memory or of general knowledge about Meta's API.

## FIXED contracts

1. **The template keeps its name and its seven body parameters, in the same order.**
   `macavation_daily_production`, `UTILITY`. This plan adds buttons and changes nothing else about
   it. `buildTemplateParams` is not to be touched.

2. **Two buttons, in this order, with exactly these labels:**

   | Order | Label | Characters |
   |---|---|---|
   | 1 | `View report` | 11 |
   | 2 | `Menu` | 4 |

   Both well inside the 20-character cap. Two, not three — a third would be noise on a daily
   notification, and `Menu` already reaches everything else.

3. **The bot dispatches on the button's TEXT, matched case-insensitively after trimming**, not on a
   payload. See the unconfirmed-contract section above for why. The two labels in contract 2 are
   therefore a shared constant between the template definition and the bot, and deliverable 3's
   verifier exists to stop them drifting apart.

4. **`View report` maps to the existing `report` menu action.** Do not write a second
   report-rendering path. `renderMenuItem(ctx, 'report')` already returns the latest report
   delivered to that number, gated on the `scheduled-reports-grid` feature.

5. **`Menu` maps to the existing menu handler.** Same handler as `MENU`/`99`, not a copy of it.

6. **Role gating still applies to the tap.** A tap is not a bypass: if the recipient's role cannot
   see `Latest report`, tapping `View report` must give them the same answer the menu would — not
   the report. `renderMenuItem` already enforces this; route through it rather than around it.

7. **The outbound send is unchanged.** Still `sendTemplate(phone, TEMPLATE_NAME, 'en',
   [bodyComponent])` with the one body component. No button component (contract 3, and the
   unconfirmed-contract section).

8. **Do not submit the template.** Impossible from here — the script needs a `crk_` key from
   `.env` and network access to Control Room, and this environment has neither. Authoring the
   definition is the deliverable; a human runs `--submit`.

## Deliverables

### 1. `scripts/submit-whatsapp-template.mjs` — add the buttons

- Add a `buttons` array to `TEMPLATE` describing two `QUICK_REPLY` buttons with the labels from
  contract 2. Match the shape `templates-api` expects — read how `TEMPLATE.body` is currently
  passed in the POST at about `:93` and follow the same convention for the new field. If the
  script's own request shape does not obviously accommodate buttons, say so in your report rather
  than inventing a field name: an unverified field is worse than a flagged gap.
- Replace the no-buttons comment at about `:50` with a short comment recording why buttons are
  there now: a tap opens the 24-hour window, so everything after it is free-form and free.
- Keep the dry-run rendering working, and extend it to print the button labels so
  `node scripts/submit-whatsapp-template.mjs` (no flags) shows the complete template a human is
  about to submit.
- Export the two labels as a named constant from this file so deliverable 3 can assert against the
  real value rather than a copy. If exporting from this script is awkward, put the constant in a
  small shared module both sides import, and say which you chose and why.

### 2. `supabase/functions/whatsapp-inbound/index.ts` — answer the taps

- Where a `button_reply` kind arrives whose `replyId` does not parse as a `menu:` reply id, match
  it against the two template button labels (contract 3) before falling through to the
  stale-menu reply. Order matters: a well-formed `menu:` id must still win.
- `View report` routes to `renderMenuItem(ctx, 'report')`; `Menu` routes to the menu handler.
- Log both through `whatsapp_log_command` with a `command` value that makes the source obvious in
  `whatsapp_command_log` — a human reading that table should be able to tell a template tap from a
  typed word.
- A tap from an **unenrolled** number stays silent, exactly as today. A template can only have
  reached a roster number, but that is not the same as an enrolled staff number, and the existing
  silence path is correct.

### 3. Verifier — `scripts/verify-wa-template-buttons.mjs`

Registered in `package.json` as `wa-template-buttons:verify`, appended to the **end** of the
`test:fleet` chain. Same `.ts` discipline as `scripts/verify-wa-plumbing.mjs` and
`scripts/verify-wa-role-features.mjs`: never evaluate a `.ts` file, assert textually, name the file
to fix in every message. Pure `fs` reads, no dependency, no network.

The point of this verifier is the drift that would silently break the button: a label changed in
one place and not the other. Assert at least:

1. The template definition declares exactly two quick-reply buttons.
2. Their labels are exactly the strings in contract 2, in that order.
3. Each label is at most `MAX_BUTTON_CTA` characters — read the number from
   `_shared/wa-limits.ts` rather than hardcoding 20, so a change to the cap is caught here.
4. **Every label the template declares is matched somewhere in the bot's dispatch**, and every
   label the bot dispatches on is declared by the template. Both directions — a one-way check
   passes while the button is dead.
5. `TEMPLATE_NAME` in `send-daily-production-report/index.ts` still equals the `name` in the
   template definition. These are two files that must agree and nothing currently checks it.
6. `buildTemplateParams` still returns seven entries, and `formatFigure` still contains
   `'not captured'` — contract 1, and the regression that would quietly turn a missing figure into
   a zero on every recipient's phone.
7. `sanitizeParam` still does not use `\s`, with a comment explaining the U+00A0 reason.

**Prove the verifier bites.** For at least assertions 2 and 4, change a label in one file only,
run the verifier, confirm it fails, restore, confirm it passes. Report what you broke and what the
failure message said.

## Verify before finishing

1. `npm run test:fleet` — the whole chain green, including the new verifier. This is the merge gate.
2. `npm run wa-template-buttons:verify` on its own.
3. `node scripts/submit-whatsapp-template.mjs` with **no flags** — the dry run. It must print the
   full template including both buttons and must not attempt any network call. If it throws
   because no `.env` exists, that is a finding worth reporting: the dry run should not need a key.
4. `npm run wa-staff-menu:verify` and `npm run wa-plumbing:verify` — both read the bot and both
   will notice if you disturbed something this plan did not ask you to change.
5. Re-read your dispatch change and confirm a well-formed `menu:` reply id still takes precedence
   over the label match. Getting that order wrong would break every existing menu tap, and no
   existing verifier covers it — so state in your report how you confirmed it.

## Out of scope — do not do these

- **Submitting the template to Meta.** Contract 8. A human runs `--submit`.
- **Renaming the template or changing its body parameters.** Contract 1.
- **Weekly and monthly templates.** wa-flow-04 adds those, following this one's shape.
- **The alert template.** wa-flow-09.
- **Adding a button component to the outbound send.** See the unconfirmed-contract section.
- **Deploying anything.** No CI deploys edge functions in this repo; a human does it. Note in your
  report that `send-daily-production-report` is written but **not currently deployed**, so this
  change does not take effect on merge.
