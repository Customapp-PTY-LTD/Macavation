---
retry_of: 6dfe2549-a243-4dcb-9f42-23937ecda7e8
---

# WhatsApp: put quick-reply buttons on the daily report template, and answer the taps

**No `depends_on` needed.** The opt-out schema and code this plan once waited on are already on the
base branch: `migrations/20260907130000_report_opt_out.sql` and `handleOptOutVerbs` in
`supabase/functions/whatsapp-inbound/index.ts` (which returns `false` immediately when `replyId` is
set, so a tap never enters the opt-out path). Nothing left to wait for.

## Context

The daily report template is the only way Macavation can reach a handset that has not replied in
24 hours. As written it delivers the figures and then dead-ends: the recipient has the numbers but
no way forward except knowing to type something. A quick-reply button gives them a way forward — one
tap into the existing menu instead of a typed word.

**Do not restate Meta's service-window or billing mechanics as established fact anywhere in the code,
comments, or the new files.** This checkout has no Meta account, no network access and no test send,
so "a tap opens the 24-hour window and everything after it is free" is not verifiable here. It is
the motivation for doing this work; it is not a fact this plan may write into a permanent artifact,
and no assertion in this plan depends on it.

## Fact-check that reshaped this plan — read before anything else

An earlier draft of this plan instructed an edit to `scripts/submit-whatsapp-template.mjs`, citing a
`TEMPLATE` object, a POST, a `crk_` key, a Control Room base URL and a project ref
`warfvygsmibtsmboktqu`. **None of that exists in this repo.** Verified at the base branch:

- `scripts/submit-whatsapp-template.mjs` is absent (`Glob scripts/*.mjs` lists 32 files; it is not
  one of them). `package.json` has no submission script.
- `grep` finds no `templates-api`, no `crk_`, no `warfvygsmibtsmboktqu`, no `QUICK_REPLY` anywhere.
- The only project refs that do appear are `nmdmddugxclpqrwylyfa` (the deploy target named in
  `send-daily-production-report/index.ts:5` and `whatsapp-inbound/index.ts:5`) and
  `ejnncypummmvyojhovme` (`CONTROL_ROOM_BASE_URL`, `whatsapp-inbound/index.ts`).
- `macavation_daily_production` appears only at `send-daily-production-report/index.ts:3,56`.

Therefore **this plan does not edit, recreate or emulate a submission client.** Deliverable 1
authors an offline, data-only template *definition* instead. Hard constraints, non-negotiable:

- **No network call, no credential, no project ref, no Supabase/Control Room URL, no `.env` read,
  no `process.env`, no `fetch(` in any file this plan creates or edits.** Two independent reasons
  in this repo: `BluePrint/secrets-management-rules.md` forbids any credential literal in committed
  source, and `scripts/check-supabase-project.mjs` (run by `.github/workflows/supabase-project-guard.yml`
  on every PR) scans `scripts/` for project refs and URLs.
- If you conclude the deliverable cannot be completed without inventing an external contract,
  **stop and report the gap**. An invented API shape is worse than a flagged gap.

## Read this first — what is already here, and where to read it

Locate every symbol **by name** (grep for it) and read it before writing against it. Line numbers
are hints, not assertions. Do not "fix" this plan's line numbers as a deliverable.

### The sender — `supabase/functions/send-daily-production-report/index.ts`

- `TEMPLATE_NAME = 'macavation_daily_production'` (:56). **Do not rename the template.**
- `buildTemplateParams(report)` (:123) returns exactly seven sanitised strings in a fixed order:
  date label, `cracked_kg`, `sk_packed_kg`, `wholes_pct`, `nis_kg`, `wtd_cracked_kg`,
  `wtd_target_kg`. **Not to be touched.**
- `formatFigure` (:94) returns the literal string `'not captured'` for null/undefined/non-numeric —
  **never `'0'`**. Do not change this.
- `sanitizeParam` (:114) deliberately avoids `\s`, because in JavaScript `\s` matches U+00A0 and
  that would destroy the non-breaking thousands separator `formatFigure` inserts. Do not
  "simplify" it.
- `renderedBodyText` (:281-289) is the plain-text audit rendering of what was sent, and is the
  **only in-repo source for the template's body wording**. Deliverable 1 derives the body from it.
- The send is `sendTemplate(phone, TEMPLATE_NAME, 'en', [bodyComponent])` (:348), `bodyComponent`
  built at :274 with `type: 'body'` only. Language code `'en'`.

### The senders and their caps — `supabase/functions/_shared/wa-send.ts`

- `sendTemplate(to, templateName, languageCode, components?)` (:377); `buildTemplateBody` (:170)
  passes `{name, language:{code}, components?}` through and throws only for a url-button parameter
  that looks like a full URL. `WaTemplateComponent` (:83) has `sub_type?: 'url' | 'quick_reply'` —
  that is the SEND-side component type, not a template-creation button spec.
- `buildReplyId`/`parseReplyId` (:205-232). Segments must match `/^[a-z0-9][a-z0-9_-]{0,23}$/`;
  `parseReplyId` never throws, returns `null` for anything that is not 2 or 3 valid segments.
  Note: neither `View report` nor `Menu` can ever be a reply id (space, capitals, single segment).
- `supabase/functions/_shared/wa-limits.ts` — `MAX_BUTTON_CTA = 20`, `MAX_BUTTONS = 3`, enforced as
  reject thresholds. That file's own header states these mirror Meta's documented caps and cannot
  be verified from this checkout; treat them as this repo's thresholds, not as Meta facts.

### How a tap on a template button arrives — `supabase/functions/_shared/wa-inbound.ts`

`classifyMessage` (:120-174) maps three shapes to reply kinds:

| Arrives as | `replyId` is |
|---|---|
| `type:'interactive'`, `interactive.type==='button_reply'` | `interactive.button_reply.id` |
| `type:'interactive'`, `interactive.type==='list_reply'` | `interactive.list_reply.id` |
| **`type:'button'`** (template quick-reply, :161-171) | `button.payload` when non-empty, **else `button.text` — unchanged casing** |

`scripts/verify-wa-plumbing.mjs:1085` pins that fallback behaviourally (`r.replyId === 'Yes'` for a
text-only template button). Do not modify `wa-inbound.ts`.

### The bot's dispatch — `supabase/functions/whatsapp-inbound/index.ts`

- `handleCommand` (:1364): `if (ctx.replyId)` runs first; a `parseReplyId` result whose `ns` is
  `MENU_NS` goes to `renderMenuItem(ctx, parsed.action)`; any other well-formed or unknown id
  returns the stale-menu reply ("that option is no longer available. Reply 99 for the menu.").
- `MENU_NS = 'menu'` (:741); `commandMenu` (:766) returns `reply: null` on success **because it has
  already sent the interactive list**; `renderMenuItem` (:807) reloads the role's feature keys and
  refuses anything outside the role's current visible set, returning `command: 'MENU:<ACTION>'`.
- `COMMAND_HANDLERS` (:1321) includes `REPORT: (ctx) => renderMenuItem(ctx, 'report')` and
  `MENU/HI/HELLO/START/0/99: commandMenu`. Its lookup is guarded with
  `Object.prototype.hasOwnProperty.call(COMMAND_HANDLERS, verb)` (:1398) because the key is
  attacker-controlled text off a public WhatsApp line.
- `processCommandForMessage` (:1640) accepts `type === 'interactive' || type === 'button'`, keeps
  **only** `classified.replyId` (`replyId = classified.replyId; rawBody = classified.replyId`,
  :1665-1667), and the unenrolled path (:1709-1732) stays silent, with the 6-digit enrolment branch
  guarded on `!replyId`. **Do not change any of those lines.**
- `logCommand` → `whatsapp_log_command`. `migrations/20260815120000_whatsapp_command_log.sql`:
  `command` is free `text`, but `outcome` carries
  `whatsapp_command_log_outcome_check CHECK (outcome IN ('ok','unknown_command','not_enrolled','denied','error'))`.

### The invariant this plan must respect, and the gate that enforces it

`whatsapp-inbound/index.ts:26-30` states taps dispatch on the reply ID, "never on the row's display
title", and `scripts/verify-wa-staff-menu.mjs:111-121` — **inside `test:fleet`, the merge gate** —
enforces it:

```js
assert.ok(!/replyTitle/.test(inboundSrc.replace(/^\s*\*.*$/gm, '')), '…titles are display text and must never select a command');
```

Consequences you must design around:

1. **Never plumb the classified display title into `processCommandForMessage`, `CommandContext` or
   `handleCommand`.** Not as a field, not as a local.
2. **Never write the identifier `replyTitle` into `whatsapp-inbound/index.ts` at all** — not even in
   a comment. That regex strips only lines whose first non-space character is `*`, so a `//` comment
   mentioning it turns the gate red. Say "the display title" in prose instead.
3. **Never edit `scripts/verify-wa-staff-menu.mjs`** (or any existing verifier) to make room for
   this change. Weakening a gate assertion is out of scope; see `.claude/rules/fleet-test-gate.md`
   on hollowing out the gate.

## The unconfirmed contract, and how this plan survives it either way

**Whether Meta returns `button.payload` for a quick-reply tap on an approved template, and what it
contains, is not verifiable from this checkout.** Nothing here proves it either way; do not settle
it from memory or general knowledge of Meta's API.

What the repo does prove: `replyId = payload ?? text` (`wa-inbound.ts:169`), so **the label is the
value that is certainly available**, and `replyId` is the only value the dispatcher may read.

So the design is: **match `ctx.replyId`, trimmed and lowercased, against the declared button labels
(contract 3).** This is still an ID match, not a display-title match — it reads `ctx.replyId` only.
Both outcomes are stated honestly and both are acceptable:

- Payload absent, or payload equal to the label → the route matches and the tap is answered.
- Payload present and different from the label → **no match, and the tap falls through to the
  existing, unchanged stale-menu reply.** Degraded, not broken, and not silent: the member is told
  to reply 99 and `whatsapp_command_log` records the unrecognised id in `detail`. This is the
  accepted failure mode; do not add a `button` component to the outbound send to force a payload
  (that would be building against the unverified contract), and do not guess a payload string.
- The same `payload ?? text` fallback at the other two call sites is unaffected: an interactive
  `button_reply`/`list_reply` id is always a `menu:<action>` string built by `buildReplyId`, so it
  takes the `parseReplyId` branch and never reaches the label match.
- A false positive on the label match grants nothing: `View report` routes through `renderMenuItem`,
  which reloads the role's features, and `Menu` routes through `commandMenu`, which role-filters the
  list. Neither is a write. Report in your final write-up which of these two paths you exercised in
  reasoning and that you did not add a button component.

## FIXED contracts

1. **The template keeps its name and its seven body parameters, in the same order.**
   `macavation_daily_production`, category `UTILITY`, language `en`. `buildTemplateParams`,
   `formatFigure` and `sanitizeParam` are not to be touched.

2. **Two buttons, in this order, with exactly these labels:**

   | Order | Label | Characters |
   |---|---|---|
   | 1 | `View report` | 11 |
   | 2 | `Menu` | 4 |

   Both well inside `MAX_BUTTON_CTA`, and two is within `MAX_BUTTONS`. Two, not three — `Menu`
   already reaches everything else.

3. **The bot dispatches on `ctx.replyId`, trimmed and lowercased, compared against those labels.**
   Never on the display title (see the invariant section). Never on a guessed payload.

4. **`View report` maps to the existing `report` menu action** via `renderMenuItem(ctx, 'report')`.
   No second report-rendering path.

5. **`Menu` maps to `commandMenu`** — the same function `MENU`/`99` use, not a copy.

6. **Role gating still applies to the tap.** Route through `renderMenuItem`/`commandMenu`, never
   around them. Both already reload the role's features.

7. **The outbound send is unchanged.** Still `sendTemplate(phone, TEMPLATE_NAME, 'en',
   [bodyComponent])` with the one body component. No `button` component.

8. **The audit row may override `command` only.** `outcome` must remain whatever the routed handler
   returned — the five values in `whatsapp_command_log_outcome_check` are the only legal ones — and
   `reply: null` must survive (`commandMenu` has already sent its list; overwriting it would send the
   menu twice).

9. **No submission, and no submission client.** Authoring the definition is the deliverable. A human
   submits the template to Meta outside this repo. See the fact-check section for the hard
   no-network / no-credential / no-project-ref constraints.

## Deliverables

### 1. `scripts/wa-template-daily-production.mjs` — the template definition, offline

A **new** file: data plus a printer. No network, no credentials, no imports beyond Node stdlib
(ideally none at all). Nothing in the repo imports it; the verifier reads it as **text**.

Declare exactly these two named exports, with these names, since deliverable 3 parses them:

```js
export const TEMPLATE_BUTTONS = [
  { kind: 'quick_reply', text: 'View report' },
  { kind: 'quick_reply', text: 'Menu' },
];

export const TEMPLATE = {
  name: 'macavation_daily_production',
  language: 'en',
  category: 'UTILITY',
  body: [
    'Daily production report for {{1}}',
    'Cracked: {{2}} kg',
    'SK packed: {{3}} kg',
    'Wholes: {{4}}%',
    'NIS received: {{5}} kg',
    'WTD cracked: {{6}} kg',
    'WTD target: {{7}} kg',
  ].join('\n'),
  buttons: TEMPLATE_BUTTONS,
};
```

- The body wording above is **derived from `send-daily-production-report/index.ts:281-289**
  (`renderedBodyText`), with `{{1}}`…`{{7}}` standing in for `params[0]`…`params[6]` in
  `buildTemplateParams`'s fixed order. Record that derivation in a comment naming the file and the
  function, so the next reader can re-check it. Seven placeholders, each exactly once, no `{{8}}`.
- `TEMPLATE_BUTTONS` is a **repo-local descriptor, not a Meta creation payload.** State that in the
  file's header comment: the exact JSON shape Meta's template-creation API wants is not verifiable
  from this checkout, and mapping this descriptor onto it is the submitting human's step. Do not
  invent a wire field name.
- The header comment must also say what this file is **not**: not a submission client, no network
  call, no Control Room URL, no project ref, no API key. Do not state or imply the template's
  approval/submission status at Meta as fact — this checkout cannot see it.
- **Printer:** running `node scripts/wa-template-daily-production.mjs` prints the complete
  definition a human is about to submit — name, language, category, the body with its `{{n}}`
  placeholders, and both button labels in order — then exits 0. Print at module top level (nothing
  imports this file). It must succeed with no environment configured at all.
- Register it in `package.json` as `"wa-template-daily-production:print": "node scripts/wa-template-daily-production.mjs"`.
  **Do not** add it to `test:fleet` (the gate runs assertions, not printers).
- Do **not** try to export the labels for deliverable 3 to import: deliverable 3 evaluates nothing,
  and no module can be imported by both a Node `.mjs` and a Deno edge function. The two copies of
  the labels are deliberate; the verifier is the only thing that links them.

### 2. `supabase/functions/whatsapp-inbound/index.ts` — answer the taps

Add one route table immediately after `COMMAND_HANDLERS` (both `renderMenuItem` and `commandMenu`
are hoisted `async function` declarations, so referencing them here is safe):

```ts
/**
 * The two quick-reply buttons declared on the daily report template
 * (scripts/wa-template-daily-production.mjs), keyed by the button label trimmed and lowercased.
 *
 * Keyed on the LABEL, not on a `menu:<action>` reply id, because a tap on a template quick-reply
 * arrives as type:'button' and _shared/wa-inbound.ts sets replyId = button.payload when a payload
 * is present, else button.text. This checkout has never sent a template with buttons and cannot
 * verify whether Meta supplies a payload here, so the label is the only value certainly available.
 * This is still a match on ctx.replyId — the id — and never on the display text the member saw;
 * nothing in this file reads that.
 *
 * If Meta does supply a payload that is not the label, neither key matches and the tap falls
 * through to the stale-menu reply below, unchanged. Both routes re-check the role, so a match can
 * never grant more than the menu would.
 */
const TEMPLATE_BUTTON_ROUTES: Record<
  string,
  { command: string; run: (ctx: CommandContext) => Promise<CommandResult> }
> = {
  'view report': { command: 'TPL:VIEW_REPORT', run: (ctx) => renderMenuItem(ctx, 'report') },
  menu: { command: 'TPL:MENU', run: commandMenu },
};
```

Then, inside `handleCommand`'s existing `if (ctx.replyId)` block, insert the lookup **between** the
`MENU_NS` branch and the stale-menu return, leaving both of those exactly as they are:

```ts
  if (ctx.replyId) {
    const parsed = parseReplyId(ctx.replyId);
    if (parsed && parsed.ns === MENU_NS) {
      return renderMenuItem(ctx, parsed.action);
    }
    // A template quick-reply tap. hasOwnProperty for the same reason as the COMMAND_HANDLERS
    // lookup below: the key is text off a public WhatsApp line and this is a plain object.
    const templateKey = ctx.replyId.trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(TEMPLATE_BUTTON_ROUTES, templateKey)) {
      const route = TEMPLATE_BUTTON_ROUTES[templateKey];
      const result = await route.run(ctx);
      // Only `command` is overridden: `outcome` must stay one of the five values
      // whatsapp_command_log_outcome_check allows, and `reply: null` must survive — commandMenu
      // has already sent its own list.
      return { ...result, command: route.command };
    }
    // …existing stale-menu return, unchanged…
  }
```

- Order is load-bearing: a well-formed `menu:` id must still win outright. Deliverable 3 asserts the
  order textually, so it is checked by the gate rather than by eye.
- `TPL:VIEW_REPORT` / `TPL:MENU` are the `command` values a human reads in
  `whatsapp_command_log`; they are distinguishable at a glance from a typed `REPORT`/`MENU` and from
  a list tap's `MENU:REPORT`. `raw_body` continues to carry `classified.replyId` — for a template tap
  that is the label as the handset sent it. Do not change the `rawBody = classified.replyId` line.
- An unenrolled number stays **silent**, exactly as today: do not touch the `:1709-1732` path or the
  `!replyId` guard on the 6-digit enrolment branch.
- Add nothing containing `replace(/\D/g` to any file under `supabase/functions/`:
  `scripts/verify-report-whatsapp-parity.mjs` sweeps that tree for that idiom and asserts an exact
  candidate count.

### 3. Verifier — `scripts/verify-wa-template-buttons.mjs`

Registered in `package.json` as `wa-template-buttons:verify` and appended to the **end** of the
`test:fleet` chain. Same discipline as `scripts/verify-wa-plumbing.mjs` and
`scripts/verify-wa-staff-menu.mjs`: pure `fs` reads, `node:assert/strict`, the same tiny
`check()`/failure-list harness, CRLF normalised on read, **never evaluate a `.ts` file**, and every
failure message names the file to fix. No dependency, no network, no browser — `package.json`'s own
`//test:fleet` note requires the gate stay hermetic, and this repo has no `package-lock.json`, so do
not add a dependency or invoke `npm ci`.

Files read: `scripts/wa-template-daily-production.mjs`,
`supabase/functions/whatsapp-inbound/index.ts`,
`supabase/functions/send-daily-production-report/index.ts`,
`supabase/functions/_shared/wa-limits.ts`.

Assert at least:

1. The definition file declares exactly two entries in `TEMPLATE_BUTTONS` (parse the block between
   `const TEMPLATE_BUTTONS = [` and the following `];`, collect `text: '…'` in order), each with
   `kind: 'quick_reply'`.
2. Those labels are exactly `View report` then `Menu`, in that order.
3. Each label is at most `MAX_BUTTON_CTA` characters and the count is at most `MAX_BUTTONS` — both
   read out of `_shared/wa-limits.ts` with a regex, never hardcoded, so a change to a cap is caught
   here.
4. **Both directions of label agreement.** Parse the keys of `TEMPLATE_BUTTON_ROUTES` out of
   `whatsapp-inbound/index.ts` and assert the set of `label.trim().toLowerCase()` from the template
   equals the set of route keys exactly. A one-way check passes while a button is dead.
5. `TEMPLATE.name` in the definition file equals `TEMPLATE_NAME` in
   `send-daily-production-report/index.ts` (parse both; do not hardcode the string twice).
6. `TEMPLATE.body` contains `{{1}}`…`{{7}}` each exactly once and no `{{8}}` — contract 1's seven
   parameters.
7. `buildTemplateParams` still builds seven entries (parse its `const raw = [` … `];` block and
   count), `formatFigure` still contains the literal `'not captured'`, and `sanitizeParam`'s body
   contains no `\s` — the regression that would quietly turn a missing figure into a zero, or a
   non-breaking separator into a mangled one, on every recipient's phone. Include the U+00A0 reason
   in the failure message.
8. **Dispatch order and shape**, as a literal-presence assertion (the `assertPresent` idiom): the
   `if (ctx.replyId) { … }` block from deliverable 2 appears verbatim in
   `whatsapp-inbound/index.ts`, which pins that the `MENU_NS` branch precedes the route lookup and
   that the stale-menu return still follows it. Failure message: re-read
   `whatsapp-inbound/index.ts`'s `handleCommand` and update both it and this script together.
9. The route lookup is guarded:
   `Object.prototype.hasOwnProperty.call(TEMPLATE_BUTTON_ROUTES,` is present, and
   `TEMPLATE_BUTTON_ROUTES[` never appears as a bare unguarded index in an `if`/`const` lookup other
   than the guarded one.
10. `whatsapp-inbound/index.ts` still contains no `replyTitle` outside a `*`-prefixed comment line —
    restated here, not because `verify-wa-staff-menu.mjs` is weak, but so a failure points at this
    plan's own design rule with an explanatory message.
11. **The definition file is inert:** it contains none of `fetch(`, `process.env`, `http://`,
    `https://`, `.supabase.co`, `crk_`, or `require(`. Failure message: this file is a definition and
    a printer, never a submission client.

**Prove the verifier bites.** For assertions 2, 4 and 8: make one minimal change (a relabelled
button in one file only; a reordered dispatch), run `node scripts/verify-wa-template-buttons.mjs`,
confirm it fails, restore, confirm it passes. Report what you broke and the exact failure message.

## Verify before finishing

1. `npm run test:fleet` — the whole chain green, including the new verifier. This is the merge gate.
   Do not run `npm ci` (this repo has no root `package-lock.json` and no dependencies).
2. `npm run wa-template-buttons:verify` on its own.
3. `npm run wa-template-daily-production:print` — prints name, language, category, the seven-
   placeholder body and both button labels, attempts no network call, and exits 0 with no
   environment configured. If it needs any env var or key, that is a defect in deliverable 1: fix it.
4. `npm run wa-staff-menu:verify`, `npm run wa-plumbing:verify` and `npm run wa-optout:verify` — all
   three read the inbound function and will notice anything disturbed that this plan did not ask you
   to change. In particular `wa-staff-menu:verify` covers the no-display-title invariant,
   `rawBody = classified.replyId`, and the `!replyId` guard on the enrolment branch.
5. State in your report: that the `menu:` branch still precedes the label match (naming assertion 8
   as the mechanical proof, not an eye check); that no `button` component was added to the outbound
   send; that no existing verifier was edited; and that `scripts/submit-whatsapp-template.mjs` does
   not exist at the base branch, which is why the definition lives in the new file.
6. Note in your report that no workflow in `.github/workflows/` deploys edge functions (the only one
   there is `supabase-project-guard.yml`), so a human must deploy
   `send-daily-production-report`/`whatsapp-inbound` for this change to take effect — and that a
   human must submit the template to Meta before any button can appear on a handset. Do not assert
   the current deployment or approval state of either; this checkout cannot see it.

## Out of scope — do not do these

- **Submitting the template to Meta**, or creating anything that could: no submission client, no
  Control Room base URL, no project ref, no `crk_`-style key, no `.env` read, no `fetch`.
- **Renaming the template or changing its body parameters.** Contract 1.
- **Editing `_shared/wa-inbound.ts`, `_shared/wa-send.ts` or `_shared/wa-limits.ts`.**
- **Editing `scripts/verify-wa-staff-menu.mjs` or any other existing verifier**, or relaxing any
  existing assertion.
- **Plumbing the classified display title anywhere**, or writing that identifier into
  `whatsapp-inbound/index.ts`.
- **Adding a `button` component to the outbound send**, or guessing a payload string.
- **Weekly and monthly templates** (wa-flow-04) and **the alert template** (wa-flow-09).
- **Deploying anything.**
- **Editing `BluePrint/` or any convention document**, and rewriting this plan's line-number hints
  as a deliverable.
