# WhatsApp reports — the Report distribution screen

## Read this first — the plumbing this plan calls, and where to check it

An earlier version of this plan could not be built, for a reason that has since been fixed **in
code, on `dev`**. Everything below is a claim about **this checkout**, with the file and line to
read it at. Nothing here asks you to take an external system's behaviour on trust, and nothing here
is your deliverable — it is all already merged.

### 1. The four senders exist. Read them, then call them.

`supabase/functions/_shared/wa-send.ts` exports all four. Confirm by reading these lines before you
write a call — do not take the signatures from this plan alone:

| Export | Line |
|---|---|
| `sendText(to, text)` | `_shared/wa-send.ts:332` |
| `sendButtons(to, bodyText, buttons)` | `_shared/wa-send.ts:345` |
| `sendList(to, bodyText, buttonLabel, sections)` | `_shared/wa-send.ts:355` |
| `sendTemplate(to, templateName, languageCode, components?)` | `_shared/wa-send.ts:377` |

All four delegate to the one private `sendViaControlRoom` (`_shared/wa-send.ts:296`), which is the
only `fetch` and the only HMAC in the file. **Keep it that way** — do not add a second send path.

The exported types they take (`WaSendResult`, `WaButton`, `WaListRow`, `WaListSection`,
`WaTemplateComponent`) are declared at `_shared/wa-send.ts:78-88`. Read them there rather than
inferring the shapes.

Each **throws `WaSendError`** on a cap breach — more than 3 buttons, more than 10 list rows, a
button title over 20 characters, a list row or section title over 24, or a full URL where a template
url-button parameter belongs. The caps are named constants in `_shared/wa-limits.ts:14-18` and the
throwing checks are in the builders (`buildButtonsBody` at `_shared/wa-send.ts:102`, `buildListBody`
at `:129`, `buildTemplateBody` at `:170`). A breach is a programming error: let it throw. Do not
catch it and send a truncated message instead.

Also already present, and not to be re-implemented — read each before writing anything similar:
`buildTextBody`, `buildButtonsBody`, `buildListBody`, `buildTemplateBody`, `buildReplyId`,
`parseReplyId`, `toWaPhone`, `hmacSha256Hex` (`_shared/wa-send.ts`); `MAX_BUTTONS`,
`MAX_BUTTON_CTA`, `MAX_LIST_ROWS`, `MAX_LIST_TITLE`, `MAX_LIST_SECTION`, `truncate`, `paginateRows`
(`_shared/wa-limits.ts`); `extractMessage`, `classifyMessage`, `verifyControlRoomSignature`,
`parseSignatureHeader`, `timingSafeEqual`, `sanitizeSenderName` (`_shared/wa-inbound.ts`).

### 2. Why the earlier version could not be built

Two obstacles, both now cleared, both verifiable in this checkout:

1. **The senders did not exist.** The plumbing plan shipped the builders only, and its verifier
   asserted the three non-text senders must *not* exist. Adding one turned `npm run test:fleet`
   red, so every plan needing them was unbuildable. Those assertions are now inverted — read
   `scripts/verify-wa-plumbing.mjs:814` and `:821`, which now assert the senders **do** exist and
   that all four route through `sendViaControlRoom`.
2. **A prohibition in `whatsapp-inbound/index.ts`** read *"TEXT ONLY. Do not add an
   interactive/button send here (unconfirmed external contract)"*. It has been replaced by a
   `⚠ SUPERSEDED` note recording why, at `supabase/functions/whatsapp-inbound/index.ts:186-197`.
   Read it. It also states the constraint that survived: new non-text sends go through
   `_shared/wa-send.ts`, **not** by widening that file's local text-only `sendWhatsappText`.

### 3. The gateway contract, and the limit of what you can check

The non-text wire shapes were settled outside this checkout, by reading Control Room's deployed
`meta-proxy` source. **That is not something you can verify from here, and this plan does not ask
you to.** The claim, its provenance and its date are recorded in the repo, in the file that makes
the call, at **`supabase/functions/_shared/wa-send.ts:21-47`** — labelled `CONFIRMED FROM SOURCE
2026-08-25`, which is this repo's convention for marking exactly this class of claim (compare the
`VERIFIED` / provenance block immediately above it at `:10-19`).

What this means for you, precisely:

- **Correctness of the wire shape is not in your scope.** It is owned by `_shared/wa-send.ts` and
  is already committed. You call the senders; you do not re-derive, re-verify, restate, or re-label
  that contract.
- **Do not copy the contract into a new comment, doc or plan of your own** as though you had
  confirmed it. If you need to refer to it, cite `_shared/wa-send.ts:21-47`.
- **Do not hand-roll a payload** to work around it. If something about the contract looks wrong to
  you, that is a finding to report, not something to patch around (see §5).

### 4. What is yours to do, and what is not

| | |
|---|---|
| You **can** | author files, edit files, and run `npm run test:fleet` or any individual `npm run *:verify` |
| You **cannot** | apply a migration, reach a database, deploy a function, run Deno or typecheck TypeScript, use the network, read another repository, or drive a browser |

- **Every database object named below is already applied on `dev`.** Do not write a migration.
  You still cannot call these RPCs, so the contracts in this plan are what you build against. Do
  not add a fallback that reads tables directly if one looks missing — fail loudly with the
  Postgres error so whoever deploys finds out immediately.
- **Do not write a verification step you cannot run.** No "log in and check", no "deploy and send
  a test message", no assertion against a deployed environment or live data. Those read as
  completed work when nothing was checked. Anything needing a human belongs in your report as a
  handover note, clearly labelled as such.
- **`npm run test:fleet` is currently green in full** — including `report-whatsapp-parity`
  (54 checks) and `wa-plumbing` (85 checks), which both previously failed on a Windows checkout for
  a line-endings reason since fixed. So a red result from your change is a real failure. Do not
  dismiss one as a known artifact, and do not relax or delete an existing assertion to get to
  green — if an existing assertion genuinely must change, name it as an in-scope deliverable and
  say why.

### 5. If this plan is wrong, say so — do not quietly build less

The earlier run narrowed its own scope for a defensible reason, shipped the reduced version, and
encoded the narrowing as a test. It merged, and looked like a success. The blockage was invisible
until someone listed the module's exports by hand.

So: if you find a genuine contradiction between this plan and the code, **stop and report it**.
A plan that cannot be built as written is useful information. A quietly reduced deliverable that
passes its own gate is not.

## Context

Macavation needs one screen where Pete decides who receives which report. Today there are two
unrelated, half-built lists: `report_recipients` (weekly/monthly, picked ad hoc inside the send
dialog) and `scheduled_reports` (an older daily-digest subscription list that is completely empty and
has never sent anything). Neither lets somebody say "this shareholder gets the monthly only".

This plan builds **Report distribution**: one row per person, a tick per report kind, plus a Staff
flag that decides whether WhatsApp will hand that number production figures.

**This plan waits on nothing.** It was previously sequenced behind the plumbing plan — not for
anything it needed, but because both appended a verifier to `package.json`'s `test:fleet` chain, and
two concurrent edits to that one line are a real merge conflict. The plumbing plan is merged and its
entry is already in place, so that contention is gone. **You are the only plan in this batch that
touches `package.json`**; the other three are instructed not to. Append your entry to the end of the
`test:fleet` chain and change nothing else in that file.

`scheduled_reports` is **not** touched — it still owns the separate email digest. Do not try to merge
or migrate it.

**You cannot apply a migration or reach a database.** The RPCs below, the feature row and the action
grant are all already applied on `dev` — an earlier version of this plan said they were missing,
which is no longer true. You still cannot call them from here, so the contracts in this plan are
what you build against. Unlike the edge-function plans **this screen is reachable in `dev` as soon
as it lands**, and an older environment or a stale cache can still serve it without those RPCs, so
it
must **degrade gracefully**: if an RPC is missing or errors, show an empty grid with a plain message
("Report distribution is not available yet — the database update has not been applied."), not a
console error, not a spinner forever, and not a broken page.

**A new route will not appear in the sidebar until two separate things happen**: the `features` row is
applied for it, **and** the user logs out and back in (`Session.get('featureKeys')` is read at login).
`appRouter` bypasses the sidebar, so the page can be reached directly by route before that. Say this
in your report so nobody thinks the screen is broken.

## Read first

| File | Why |
|---|---|
| `WebPortal/modules/scheduled-reports/js/scheduled_reports_grid.js` | the closest existing module — copy its shape, its grid setup and its save/toggle pattern |
| `WebPortal/modules/scheduled-reports/html/scheduled_reports_grid.html` | matching markup conventions |
| `WebPortal/js/appRouteConfig.json` | `appRoutes` is an object keyed by route name; entries are `{description, path, html, js[], css[]}` with `basePath: "modules"` |
| `WebPortal/index.html:335-339` | the sidebar entry for Scheduled Reports — the new one goes beside it |
| `WebPortal/js/data-functions.js:6444-6538` | the house RPC-wrapper pattern to follow |
| `WebPortal/js/action-access.js` | `hasAction()` |
| `WebPortal/js/appRouter.js:137-155`, `:253-256` | feature gating, and the one-shot `data-action-perm` sweep |
| `BluePrint/javascript-jquery-rules.md`, `BluePrint/BEST_PRACTICES.md` | this repo's frontend rules — read before writing |
| `migrations/20260822090200_report_whatsapp_rbac.sql:23-28` | why dynamic rows must call `hasAction()` inline |

## ⚠ Correction — how this repo's RPCs actually return (read before writing any call)

An earlier revision of this plan stated these contracts wrongly. **These are the real ones,
read out of `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`.**

**Every RPC in this family returns an envelope, not a bare value, and never throws for a business
failure.** `RETURNS TABLE (success int, error text, …)`. Over PostgREST that arrives as an **array of
rows** — so read `data[0]`, check `success === 1`, and treat `error` as the message to surface or log.
A `success: 0` is a normal response with HTTP 200, not an exception. Code that only try/catches will
sail straight past a refusal.

## FIXED contracts — implement against these exactly

**`list_report_distribution(p_include_inactive boolean default false) → jsonb`**

```json
{
  "recipients": [
    {
      "recipient_id": "…",
      "display_name": "Pete",
      "phone": "+27821234567",
      "source": "manual",
      "is_staff": true,
      "is_active": true,
      "daily":   { "subscribed": true,  "muted_until": null },
      "weekly":  { "subscribed": true,  "muted_until": null },
      "monthly": { "subscribed": true,  "muted_until": null }
    }
  ]
}
```

**`set_report_subscription(p_recipient_id uuid, p_report_kind text, p_is_active boolean) → jsonb`**
→ `{ "ok": true }`. `p_report_kind` is `'daily'`, `'weekly'` or `'monthly'`.

**`set_report_recipient_staff(p_recipient_id uuid, p_is_staff boolean) → jsonb`** → `{ "ok": true }`.

**`upsert_report_recipient(p_display_name text, p_phone text, p_source text, p_contact_id uuid, p_conversation_id uuid, p_notes text, p_actor_user_id uuid)`**
→ `TABLE (success int, error text, id uuid)` — **already exists**
(`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:201`). Seven parameters, not
four. For a typed-in recipient pass `p_source => 'manual'` and null for `p_contact_id` /
`p_conversation_id`. Reuse it; do not write a second add-recipient path.

**`set_report_recipient_active(p_recipient_id uuid, p_is_active boolean, p_actor_user_id uuid)`**
→ `TABLE (success int, error text)` — already exists (`:265`). Three parameters.

**`list_report_recipients(p_include_inactive boolean)`** → also already exists (`:159`) and is what
`list_report_distribution` wraps. Do not call both.

Existing action keys to gate on — both already seeded
(`migrations/20260822090200_report_whatsapp_rbac.sql`): `reports.recipient.manage` for every write,
and the route's own feature key `report-distribution-grid` for visibility.

## Work

### 1. `WebPortal/modules/report-distribution/html/report_distribution_grid.html`

Follow `scheduled_reports_grid.html`. A toolbar with **Add recipient**
(`data-action-perm="reports.recipient.manage"`) and a **Show inactive** toggle, then the grid, then an
add-recipient modal (name, WhatsApp number, notes).

Columns: Name · WhatsApp number · Daily · Weekly · Monthly · Staff · Status.

The four tick columns are checkboxes. **Status** is derived text, not editable: `Active`, `Stopped`
when the recipient is inactive, or `Paused to 3 Sep` when any subscription carries a future
`muted_until`.

### 2. `WebPortal/modules/report-distribution/js/report_distribution_grid.js`

Follow `scheduled_reports_grid.js` exactly for module shape, grid construction and toast/error
handling. Behaviour:

- Load through the new wrapper; on error or a missing RPC, render the empty state described above.
- A checkbox change calls `set_report_subscription` (or `set_report_recipient_staff`) for that one
  cell, then reflects the saved state. **Revert the checkbox on failure and say so** — a tick that
  looks saved but is not means somebody silently stops receiving a report.
- **Every write is gated on `hasAction('reports.recipient.manage')`, checked inline in the row
  renderer.** `data-action-perm` is swept once over static markup and is inert on dynamically
  rendered rows, so relying on it here would leave live checkboxes for a user with no permission.
  Deny by default: if `hasAction` is unavailable, render the checkboxes disabled.
- Adding a recipient reuses `upsert_report_recipient`. The database enforces one row per normalised
  number, so a duplicate returns the existing recipient rather than creating a second — surface that
  as "already on the list" rather than as an error.
- Do not implement delete. Use `set_report_recipient_active(false)`, so somebody who stopped stays
  visible with their history intact.

### 3. `WebPortal/modules/report-distribution/css/report_distribution.css`

Only what the grid needs. Match `WebPortal/modules/sales-reports/css/sales_reports.css` for
conventions.

### 4. `WebPortal/js/data-functions.js`

Append wrappers following the pattern at `:6444-6538` — `listReportDistribution`,
`setReportSubscription`, `setReportRecipientStaff`. Reuse the existing `upsertReportRecipient` and
`setReportRecipientActive` wrappers if present; add them the same way only if they are not.

Do not alter any existing function in this file.

### 5. `WebPortal/js/appRouteConfig.json`

Add one entry to `appRoutes`:

```json
"report-distribution-grid": {
  "description": "Report Distribution",
  "path": "report-distribution",
  "html": "html/report_distribution_grid.html",
  "js": ["js/report_distribution_grid.js"],
  "css": ["css/report_distribution.css"]
}
```

### 6. `WebPortal/index.html`

Add a sidebar link beside the Scheduled Reports entry (`:335-339`), in the same **User & access**
group, titled **Report Distribution** with the subtitle *"Who receives the daily, weekly and monthly
reports"*. Match the surrounding markup exactly, including however that block carries its feature key.

### 7. `scripts/verify-report-distribution.mjs`

Pure Node, no network, no browser. Model it on `scripts/verify-report-whatsapp-picker.mjs`, which
already loads a portal JS module in a bare `vm`. Assert:

1. The route key `report-distribution-grid` exists in `appRouteConfig.json`, and its `html`, every
   `js` entry and every `css` entry resolve to files that exist on disk under
   `WebPortal/modules/report-distribution/`. (`npm run registry:verify` may already cover part of
   this — check, and do not duplicate what it asserts.)
2. Status derivation: active with no mute → `Active`; inactive → `Stopped`; a future `muted_until` →
   text containing `Paused`.
3. A payload where `list_report_distribution` throws renders the empty-state message and **not** the
   word `undefined`.
4. With `hasAction` returning false, the rendered row's checkboxes are disabled; with it absent
   entirely, they are also disabled (deny by default).
5. A recipient missing a `daily`/`weekly`/`monthly` key renders an unticked box rather than throwing.

Register it in `package.json` as `report-distribution:verify` and append to the end of `test:fleet`,
leaving every existing entry in place.

## Out of scope

No migrations, no `features`/`role_features`/`actions` rows, no RBAC seeding — all applied outside the
fleet. No change to the send dialog's own recipient picker
(`WebPortal/modules/sales-reports/js/report-whatsapp-send.js`), which keeps working as it does today.
No change to `scheduled_reports` or its screen.

## Verification

- `npm run report-distribution:verify` passes.
- `npm run test:fleet` passes with all pre-existing checks still present.
- `npm run registry:verify` and `npm run routing:verify` pass — the new route is wired correctly.
- `npm run ui:verify` passes.
- Read your own diff and confirm no write path is reachable without an inline `hasAction()` check.
- Confirm the module renders its empty state, not an exception, when the RPC is absent — trace it.

State in your report that the RPCs and the feature/action rows are **not yet applied**, so on merge
the screen shows its empty state, and that the sidebar link stays hidden until the feature row is
applied **and** the user re-logs in.
