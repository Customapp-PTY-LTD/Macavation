---
depends_on: wa-reports-01-shared-plumbing.md
---
# WhatsApp reports — the Report distribution screen

## Context

Macavation needs one screen where Pete decides who receives which report. Today there are two
unrelated, half-built lists: `report_recipients` (weekly/monthly, picked ad hoc inside the send
dialog) and `scheduled_reports` (an older daily-digest subscription list that is completely empty and
has never sent anything). Neither lets somebody say "this shareholder gets the monthly only".

This plan builds **Report distribution**: one row per person, a tick per report kind, plus a Staff
flag that decides whether WhatsApp will hand that number production figures.

**Why this plan waits on plan 01.** Not for anything it needs from it — this screen uses none of
the WhatsApp plumbing. It waits because both plans append a verifier to `package.json`'s
`test:fleet` chain, and two plans editing the same shared file concurrently produce a real merge
conflict rather than a clean merge. Sequencing them is the fix.

`scheduled_reports` is **not** touched — it still owns the separate email digest. Do not try to merge
or migrate it.

**You cannot apply a migration or reach a database.** The RPCs below do not exist when this merges,
and unlike the edge-function plans **this screen is reachable in `dev` as soon as it lands**. So it
must **degrade gracefully**: if an RPC is missing or errors, show an empty grid with a plain message
("Report distribution is not available yet — the database update has not been applied."), not a
console error, not a spinner forever, and not a broken page. A human applies the migration and adds
the feature/action rows out of band.

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
