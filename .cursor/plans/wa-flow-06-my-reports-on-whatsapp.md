---
depends_on: wa-flow-05-schedule.md
---

# WhatsApp: a "My reports" menu item, and stop losing people to "I did not recognise that"

## Context

wa-flow-02 landed `STOP`, `START` and `RESUME` as typed words with no menu entry. That is enough
for someone who already knows the words. It is not enough for someone who does not — and today,
someone who types something the bot does not recognise is told so and given a list of verbs to
type, rather than being shown the menu. `docs/mockups/whatsapp-flow-spec.html` section 9 names
this as the one behaviour change worth making in the whole conversational design; this plan makes
it.

This also gives `report_subscriptions`' Daily/Weekly/Monthly ticks — and, after wa-flow-02, the
pause date — a way to be set from the phone itself, not only from the portal's distribution panel.
`set_report_subscription_by_phone` has existed since 25 August with zero callers; this is the
first thing to call it.

## Read this first

Locate every symbol **by name** and read it before writing against it.

### The menu — `supabase/functions/whatsapp-inbound/index.ts`

- `MENU_ITEMS: MenuItem[]` — an array of `{action, title, feature, render}`. Find it by name; every
  existing entry (`production`, `stock`, `yield`, `alerts`, `intake`, `digest`, `report`) is a
  model for the shape a new entry takes.
- `MenuItem.feature` names a `public.features.key` string that gates the item — the same gate the
  portal sidebar uses, via `loadFeatureKeys` (post-wa-flow-01, calling
  `whatsapp_role_feature_keys`).
- `visibleItems(featureKeys)` filters `MENU_ITEMS` to what the caller's role has, then
  `.slice(0, MAX_LIST_ROWS)`. **My reports must be visible to every enrolled staff member,
  regardless of role** — it is their own settings, not a business-data view. Read how the existing
  items express a feature gate, then decide how an item with no gate is expressed structurally
  (an empty/null `feature`, skipped in the `featureKeys.has(...)` filter) — do not invent a fake
  feature key that would need a `role_features` row to work, which would make the settings item
  disappear for a role nobody remembered to grant it to.
- `handleCommand` — the dispatch order, in its own comment: reply-id tap wins, then `HELP`, then
  empty/`?` → menu, then a registered verb, then a bare 1-2 digit number as a menu position, then
  the unrecognised-verb fallback. **This last branch is what changes.** Read the exact fallback
  reply text before touching it — it currently builds
  `` `Sorry ${ctx.displayName}, I did not recognise "${verb}".\n\n...` `` followed by
  `HELP_COMMAND_LIST` — that whole path is replaced by "call `commandMenu(ctx)`" per this plan's
  contract 1, not merely reworded.
- `buildReplyId(MENU_NS, item.action)` / `parseReplyId` — the reply-id convention list rows and
  buttons use. A new sub-menu inside "My reports" needs its own namespace or its own action
  prefixes; read `_shared/wa-send.ts:205-232` for the segment rule
  (`/^[a-z0-9][a-z0-9_-]{0,23}$/`) before choosing names.

### The subscription RPC — after wa-flow-02

`set_report_subscription_by_phone(p_phone, p_report_kind, p_is_active, p_muted_until)`, granted to
`service_role`. wa-flow-02 also adds `report_set_opt_out(p_phone, p_opted_out)`. Both take a bare
phone; both resolve through the inbound-to-roster bridge. Read wa-flow-02's finished migration for
their exact return shapes before writing calls against them — do not guess the envelope.

### The confirm pattern this plan deliberately does NOT use

`whatsapp_stage_pending_command` / `whatsapp_take_pending_command` / `whatsapp_clear_pending_command`
back the bot's `YES`/`NO` confirm flow (`STAGED_COMMAND_HANDLERS`, `commandYes`, `commandNo` in
`whatsapp-inbound/index.ts`). **Toggling your own subscription does not use this.** Read
`docs/mockups/whatsapp-flow-spec.html` section 5's stated reasoning before reproducing the confirm
pattern here by habit: changing what lands on your own phone is instantly reversible and obviously
yours, and making someone confirm turning off an email is the kind of friction that makes people
stop using a tool. The one exception is `STOP` **tapped from a menu row** (not typed) — see
contract 4.

## An unconfirmed detail — resolve it from the code, not from this plan

**Whether `whatsapp-inbound` currently has a way to know the enrolled user's OWN phone number in
the canonical `+27...` roster form**, as opposed to the bare-digit inbound form the webhook
delivers. The bot resolves staff identity via `whatsapp_resolve_staff_user(p_phone)`
(`phase2-3a`-era migration — find it by name), which takes the bare-digit form. wa-flow-02's new
RPCs also take a bare phone and do the roster-form conversion internally via
`report_recipient_by_inbound_phone`. **So passing the bare inbound `from` straight through should
work without a second lookup** — confirm this by reading wa-flow-02's finished RPCs before writing
this plan's calls, and say in your report whether you found anything that contradicts it. Do not
add a phone-normalisation step of your own; `scripts/verify-report-whatsapp-parity.mjs` exists
specifically to prevent a new one appearing.

## FIXED contracts

1. **Any input the router cannot otherwise place opens the menu instead of listing verbs.** The
   existing unrecognised-verb branch in `handleCommand` — the one building "I did not recognise…"
   — is replaced by a call to `commandMenu(ctx)` (or whatever the existing menu-sending function is
   named; find it by name, do not assume). `HELP` remains its own explicit command and is
   unaffected — `HELP` still shows the verb list; it is only the *unrecognised* path that changes.
   This is the single behaviour change wa-flow-spec.html names by example: `"stock please"` must
   now open the menu, where it currently returns a list of verbs to type.

2. **A new menu item, "My reports", with no feature gate** — visible to every enrolled staff
   member. Its action opens a **second list**, not a flat reply, containing:

   | Row | Toggles |
   |---|---|
   | Daily — on/off | `report_subscriptions` where `report_kind='daily'` |
   | Weekly — on/off | `report_subscriptions` where `report_kind='weekly'` |
   | Monthly — on/off | `report_subscriptions` where `report_kind='monthly'` |
   | Pause for a week | `p_muted_until` = today + 7 days (`report_sast_today() + 7`) |
   | Stop everything | `report_set_opt_out(phone, true)`, **staged with a confirm** — see contract 4 |

   Row titles must respect `MAX_LIST_TITLE` (24 chars) — read the constant from
   `_shared/wa-limits.ts`, do not hardcode 24. "Daily — on" and its siblings are examples; the
   actual title reflects the CURRENT state, read fresh on every open, exactly as
   `docs/mockups/whatsapp-flow-spec.html` section 5 shows.

3. **Toggling Daily, Weekly or Monthly is immediate, no confirm.** One tap,
   `set_report_subscription_by_phone(phone, kind, !current, NULL)`, a short reply naming what
   changed, done.

4. **"Pause for a week" is immediate, no confirm — "Stop everything" DOES confirm, because it was
   tapped in a menu, not typed.** This is the one asymmetry with wa-flow-02's typed `STOP`, and it
   is deliberate: a mis-tap in a list of five rows is plausible in a way that typing five letters
   is not. Route "Stop everything" through the **existing** staged-confirm machinery
   (`whatsapp_stage_pending_command` / the `YES`/`NO` handlers already in the file) rather than
   building a second confirm mechanism — register a new entry in `STAGED_COMMAND_HANDLERS` that
   calls the same `report_set_opt_out` RPC wa-flow-02's typed `STOP` calls. One RPC, two entry
   points, one of which confirms.

5. **The reply after any toggle states the FULL current set**, not just what changed — "Daily is
   now off. You are still getting Weekly and Monthly." Never leave someone to infer their overall
   state from a series of individual confirmations.

6. **No new phone normaliser, no new confirm framework, no new RPC beyond what wa-flow-02 already
   added.** This plan is wiring: a menu item, a sub-list, and calls into RPCs that already exist by
   the time this plan runs.

## Deliverables

### 1. `supabase/functions/whatsapp-inbound/index.ts`

- Replace the unrecognised-verb fallback per contract 1.
- Add the `settings` (or equivalently-named) entry to `MENU_ITEMS` per contract 2, with no
  `feature` gate.
- A settings sub-list renderer, following the same shape `commandMenu`/`renderMenuItem` already
  use for the top-level menu — read them before writing a second, divergent pattern.
- Dispatch for each of the five rows per contracts 3 and 4.
- Register the "Stop everything" staged command in `STAGED_COMMAND_HANDLERS`.
- Add `RESUME`/pause-related wording to `HELP_COMMAND_LIST` if wa-flow-02 has not already done so
  — check before duplicating.

### 2. Verifier — `scripts/verify-wa-my-reports.mjs`

Registered as `wa-my-reports:verify`, appended to the end of `test:fleet`. Same `.ts` discipline
as the sibling verifiers.

Assert at least:

1. The unrecognised-verb branch no longer builds the "I did not recognise" reply text and instead
   calls the menu function — assert this by absence of the old string **and** presence of a call
   to the menu-sending function in that code path, not just one or the other.
2. `HELP` is still handled as its own explicit branch (contract 1's carve-out) — `HELP` must not
   have been accidentally folded into "opens the menu."
3. `MENU_ITEMS` contains an entry with no `feature` value (or an explicitly-null one — match
   whatever form deliverable 1 actually used) whose title is "My reports" or close to it.
4. The five rows from contract 2's table are all present in the settings sub-list's source.
5. "Stop everything" is registered in `STAGED_COMMAND_HANDLERS`, not dispatched immediately —
   the regression this guards against is someone "simplifying" it to match the other four rows'
   immediacy and silently removing the one confirm step Meta-facing opt-out safety depends on
   nowhere else being skipped.
6. Daily/Weekly/Monthly and Pause are each dispatched **without** going through
   `whatsapp_stage_pending_command` — the opposite regression, confirmed via absence rather than
   presence, for the same reason wa-flow-06's contract 3 exists.

**Prove the verifier bites** on assertions 1 and 5 specifically — those are the two contracts most
likely to erode under a later "simplify this" pass. Break, run, see red, fix, see green, report
what you did.

## Verify before finishing

1. `npm run test:fleet` — green, including the new verifier.
2. `npm run wa-my-reports:verify` alone.
3. `npm run wa-staff-menu:verify` and `npm run wa-plumbing:verify` — neither should regress; if
   either does, something outside this plan's scope was touched.
4. Confirm `MAX_LIST_ROWS` still holds for the top-level menu with the new item added — count
   `MENU_ITEMS` after your change and compare against the constant in `_shared/wa-limits.ts`. If
   adding this item pushes the top-level list over the cap, say so in your report; do not silently
   drop an existing item to make room.

## Out of scope — do not do these

- **Alert severity preference on this settings sub-list.** wa-flow-09 owns the alert-side settings;
  do not add an "Alerts" row here pre-emptively — that plan will say where it belongs.
- **The portal-side distribution panel.** wa-flow-07/08.
- **Any new RPC.** Everything called here already exists once wa-flow-02 has merged.
- **Applying anything to a database or deploying the edge function.** As always, human steps.
