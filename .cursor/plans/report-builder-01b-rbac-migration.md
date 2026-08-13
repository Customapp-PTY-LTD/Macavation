# Report builder — RBAC migration file (feature and action rows)

## Context

Second of four small plans replacing `report-builder-01-list-and-editor.md`, which was blocked twice
for being too large. This one authors **a single new SQL migration file** and changes nothing else.
No JavaScript, no HTML, no route registration.

It has no dependency on the other three and can run alongside them: it touches only `migrations/`,
so it cannot conflict with the plans that edit `WebPortal/`.

The report-builder tables and RPCs are defined in
`migrations/20260817090000_report_builder_foundations.sql` and
`migrations/20260817100000_report_instances_and_targets.sql`, both in this checkout. Those files
already carry their own `GRANT EXECUTE` and `role_permissions` blocks — **this migration adds only
the menu-visibility and button-permission rows**, and must not re-grant any function.

**You cannot apply this migration.** The fleet has no database credentials and no network path to a
database. Author the file only. Do not state or assume that this or any sibling migration has been
applied to any database.

## Repo facts, verified in the named files

- The idiom to follow is `migrations/20260812100000_crm_whatsapp_module.sql` — this repo's most
  recent example of seeding `features` / `role_features` / `actions` / `role_actions`. Read its
  seeding block and mirror its shape, including `ON CONFLICT ... DO NOTHING`.
- `role_features.value` and `role_actions.value` are **`text`, not `boolean`** — insert the string
  `'true'`. Comparing them to a boolean raises
  `operator does not exist: text = boolean`.
- `features.id` and `actions.id` are `bigint`; `roles.id` is `uuid`. Write the DO block so it does
  not depend on either being a particular width.
- Migration filenames must be `<14-digit-UTC-timestamp>_<snake_case_name>.sql`, unique across the
  folder — enforced by `npm run migrations:verify` (`scripts/verify-migration-prefixes.mjs`).
  **Pick a prefix later than every file currently in `migrations/`** — check with
  `ls migrations/ | sort | tail -3` at write time rather than assuming a value, because other plans
  may have landed migrations since this one was drafted.

## What to seed

**One feature row:**

| key | name | description |
|---|---|---|
| `sales-report-editor` | Report Editor | Open, edit and override figures on a weekly or monthly report |

There is deliberately **no new feature row for the report list**. The list reuses the existing
`sales-forecasting-grid` key, which is already seeded
(`migrations/20260302000003_seed_features.sql:45-49,118-127`). Do not modify that row's grants —
which roles currently hold it cannot be read from this checkout, and changing it would silently
alter who can see an existing screen.

**Five action rows**, module `Sales Reporting`:

| key | label |
|---|---|
| `reports.report.create` | Create Report |
| `reports.report.edit` | Edit Report |
| `reports.report.delete` | Delete Report |
| `reports.report.publish` | Publish Report |
| `reports.report.generate` | Generate Report PDF |

The last two are not used by any screen yet — the publish and PDF work lands in a later plan. They
are seeded here so this feature needs exactly one RBAC migration rather than three. An action key
with no `data-action-perm` referencing it is inert: `WebPortal/js/action-access.js` is default-deny
and simply never consults it.

**Grant the feature row and all five action rows to exactly these four roles**, matched by
`roles.role_name`:

`super_user`, `admin`, `Sales Exec`, `Palladium Manager`

Sales Exec and Palladium Manager are the two people who own this reporting between them, and both
need full rights. Do **not** loop over every role, and do **not** add anything to
`migrations/20260218000001_grant_all_data_functions_to_all_roles.sql` — `CLAUDE.md:34-39` records
that "grant to every role" pattern as the direct cause of this repo's current permission drift.

A role name that does not exist in a given database must be skipped silently rather than raising —
select the roles by name and iterate what comes back, so the same file applies cleanly to both
projects.

## Header comment

Open the file with a comment block in the style of the two sibling report-builder migrations,
stating:

- what it seeds and why the list screen reuses an existing feature key rather than adding one;
- that the report **list** exposes metadata and counts only — `list_report_instances`
  (`migrations/20260817100000_report_instances_and_targets.sql`) returns `period_*`, `fy`,
  `version`, `status`, `section_count`, `override_count`, `metric_count`, timestamps,
  `pdf_storage_path` and `total_count`, and **no metric figures** — while every figure comes from
  `get_report_instance`, reachable only from the editor route behind the new `sales-report-editor`
  feature key;
- that applying it is out of scope for the run that authored it, naming the two commands a human
  runs (`npm run db:apply -- migrations/<file>.sql` for dev, then `npm run db:apply-prod` for prod
  after sign-off), matching the header convention already used in
  `migrations/20260817090000_report_builder_foundations.sql`.

End the file with `NOTIFY pgrst, 'reload schema';`, as every sibling migration does.

## Known consequence to record, not to fix

Until a human applies this file, the editor route is gated off for every non-admin role:
`WebPortal/js/appRouter.js:137-155` runs `roleMenuConfig.hasAccess(routeName)` for any route loaded
into `#content-area`, and `WebPortal/js/role-menu-config.js:603-628` treats
`Session.get('featureKeys')` as authoritative for non-admin roles. `featureKeys` and `actionKeys`
are cached at login, so a user must sign out and back in after it is applied. Note this in the
header comment. Handling it in the UI belongs to the plan that builds the list screen; do not write
any JavaScript here.

## Verification — all runnable inside the checkout, no browser, no login, no network

1. `npm run test:fleet` passes — `migrations:verify` is the relevant gate here and fails on a
   duplicate or malformed timestamp prefix.
2. `ls migrations/ | sort | tail -1` is the new file — i.e. its prefix really is the latest.
3. `grep -c "role_features" <new file>` and `grep -c "role_actions" <new file>` are both at least 1,
   and `grep -n "'true'" <new file>` shows the text literal (not a bare `true`) used for both
   `value` columns.
4. `grep -n "grant_all_data_functions_to_all_roles\|GRANT EXECUTE" <new file>` returns nothing —
   this migration must not grant any function.
5. `grep -n "sales-forecasting-grid" <new file>` returns nothing, or appears only inside a comment —
   the existing feature row must not be modified.
6. `grep -c "NOTIFY pgrst" <new file>` returns `1`.
7. `git diff --name-only` lists exactly one file, under `migrations/`.

**Do not add a verify step that needs a browser, a logged-in session, a screenshot, a database, or
the deployed demo site**, and do not attempt to run any `db:apply*` script — there are no
credentials.

## Out of scope

Any JavaScript, HTML or CSS. Any route registration. Applying the migration. Modifying the
`sales-forecasting-grid` feature row or any existing role's grants. Editing any Playwright spec,
`WebPortal/help/*`, `docs/**`, or `permission-module-map.js`.
