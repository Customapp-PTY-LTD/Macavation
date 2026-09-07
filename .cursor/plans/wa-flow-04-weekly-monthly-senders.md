---
depends_on: wa-flow-03-daily-template-buttons.md
---

# WhatsApp: send the weekly and monthly reports, the way the daily one already does

## Context

The distribution panel (`docs/mockups/whatsapp-integration.html` mockup of it; the real screen is
`WebPortal/modules/sales-reports/html/report_list.html`) has Daily, Weekly and Monthly columns.
Only Daily is ever read by anything — `report_daily_recipients()` filters on
`rs.report_kind = 'daily'` and nothing else in this codebase queries `report_subscriptions` for
`'weekly'` or `'monthly'`. Ticking those two columns currently changes a database row and nothing
else. This plan is what makes them true.

`send-daily-production-report/index.ts` is the working model: read the day's figures, check
nothing was already sent, select recipients, build template parameters, send one at a time, record
delivery. This plan follows that shape for a **published report instance** instead of a daily
figure snapshot, because that is what weekly and monthly actually are —
`docs/mockups/whatsapp-flow-spec.html` section 7 states the intended trigger as *"once the week's
report is published"*, not a bare calendar date.

This plan depends on wa-flow-03 because it reuses the button-tap dispatch that plan adds
(`View report` / `Menu`) rather than inventing a second one — the weekly and monthly templates get
the same two buttons, and a tap on either must land in the same place a daily tap does.

## Read this first — what is already here, and where to read it

Locate every symbol **by name** and read it before writing against it. Line numbers are hints.

### The model to copy — `supabase/functions/send-daily-production-report/index.ts`

Read the whole file before writing anything; it is 397 lines and every deliverable below has a
direct counterpart in it. In particular:

- The auth pattern: a service-role bearer, constant-time compared, at about `:155-162`. Its own
  header comment says `config.toml`'s `verify_jwt = true` is not the real gate — read that comment.
- `daily_report_already_sent(p_date)` — idempotency. Re-running the same day sends nothing.
- `report_daily_recipients()` — the recipient selector, already amended by wa-flow-02 to exclude
  `opted_out_at`. Read it after wa-flow-02 has merged, not before, because that plan changes it.
- `buildTemplateParams` / `formatFigure` / `sanitizeParam` — the parameter-building shape. Not
  reused directly (the weekly/monthly payload is different), but the **pattern** — never `'0'` for
  a missing figure, avoid `\s` near the non-breaking thousands separator — must be repeated.
- The send: `sendTemplate(phone, TEMPLATE_NAME, 'en', [bodyComponent])`, one recipient at a time,
  sequentially, with `begin_report_delivery` before and `complete_report_delivery` after each.
- `dry_run` support — a request that returns the params and recipient list without sending or
  writing a delivery row. Keep this pattern; it is how a human proves the wording before it goes
  out to fourteen people.

### The report instance — `migrations/20260817100000_report_instances_and_targets.sql`

- `report_instances` at `:124-152`. Columns that matter here: `period_type` CHECK(weekly/monthly),
  `period_start`, `period_end`, `status` CHECK(draft/published/superseded), `published_at`,
  `content_sha256`. A CHECK constraint enforces `status <> 'published' OR (published_at IS NOT
  NULL AND content_sha256 IS NOT NULL)` — a published row is never missing those two.
- `get_report_instance(p_report_instance_id uuid)` at `:706` — the whole report as one jsonb
  payload: header, sections, metrics, frozen lines. This is what the portal's report editor and
  `send-report-whatsapp` both consume. Read it fully before deciding what to pull from it.
- **There is no existing "latest published instance for this period_type" selector.** Checked by
  name across every migration before writing this plan — `get_report_current_period` (about
  `:144` in `20260817090000_report_builder_foundations.sql`) computes what the *current* period's
  dates are, it does not find a published instance. This plan adds the missing selector; it is not
  duplicating anything.

### The text-rendering pattern — `supabase/functions/send-report-whatsapp/index.ts`

- `buildMessageText(payload, signedUrl)` at about `:179` — builds the WhatsApp body **entirely
  server-side** from a `get_report_instance`-shaped payload: period label, published date, a
  truncated executive summary, then a link. Read this before writing the new function's body
  builder; do not invent a second convention for turning a report payload into words.
- This function sends **free text with a link**, gated on a portal session and
  `has_action(user,'reports.report.send')`. It is the *manual* send path, and it is explicitly not
  what this plan is extending — this plan is the *automatic*, template-based, unprompted path,
  same as the daily. Do not touch `send-report-whatsapp`.

### The recipient selector this plan needs — does not exist yet, follow this shape

`report_daily_recipients()` is hardcoded to `report_kind = 'daily'`. There is no equivalent for
weekly or monthly. Read wa-flow-02's finished migration (once merged) for the exact shape
`report_daily_recipients()` ends up in — including the `opted_out_at IS NULL` clause that plan
adds — and write a **parameterised sibling**, not a copy that will drift from it. See deliverable 1.

### The template — model on wa-flow-03's daily template

`scripts/submit-whatsapp-template.mjs`, after wa-flow-03, defines
`macavation_daily_production` with two quick-reply buttons, `View report` and `Menu`. This plan
adds two more template definitions to the same script, in the same shape, with the same two
buttons. Read wa-flow-03's finished script before writing these — do not diverge on button
wording or ordering; `docs/mockups/whatsapp-flow-spec.html`'s template table depends on all three
matching.

### The bot's button dispatch — after wa-flow-03

`whatsapp-inbound/index.ts` will, after wa-flow-03, dispatch a template button tap by matching its
text against `View report` / `Menu` and routing to `renderMenuItem(ctx, 'report')` /
the menu handler. **Read that dispatch before extending it** — this plan must not add a second,
parallel button-matching block. The existing `report` menu action already calls
`get_latest_published_report_for_phone(p_phone)`
(`migrations/20260825092000_report_link_codes.sql:198`), which finds the most recent report
**delivered to that number** regardless of period type. A tap on a weekly template's `View report`
and a tap on a monthly template's `View report` both correctly land on the same handler — the
handler already answers "the latest thing you were sent," which is exactly right here. No change
needed to the dispatch itself; confirm this in your report rather than assuming it.

## FIXED contracts

1. **One new edge function, `send-period-report`, handling both weekly and monthly** — not two
   functions. It takes `p_kind: 'weekly' | 'monthly'` the same way `get_period_production_summary`
   already does (`migrations/20260825091000_daily_production_report.sql:348`, which normalises
   `'week'`/`'weekly'` and `'month'`/`'monthly'`). Follow that same normalisation, do not invent a
   third spelling.

2. **The trigger is "a published instance exists for the current period that has not been sent
   yet," not a bare calendar date.** A weekly report published a day late must still send; a
   period with no published instance yet must send nothing and must not error — this is a normal,
   expected state early in the week, not a failure.

3. **Two new templates, one per kind: `macavation_weekly_report`, `macavation_monthly_report`.**
   Same two buttons as the daily, same order, same labels (`View report`, `Menu`) — wa-flow-03
   contract 2, repeated here for both. `UTILITY` category, `en` language, matching the daily
   template's shape in `scripts/submit-whatsapp-template.mjs`.

4. **Body parameters come from `get_report_instance`, rendered server-side, never from the
   browser.** Same principle `send-report-whatsapp`'s header comment states about
   `buildMessageText`: nobody outside the server chooses what words go to a phone number under
   this portal's name.

5. **Recipients: a new `report_recipients_for_kind(p_kind text)` RPC**, `SECURITY DEFINER`,
   `service_role` only, built as the parameterised sibling of the (post-wa-flow-02)
   `report_daily_recipients()` — same `is_active`, same subscription join, same
   `opted_out_at IS NULL`, same `muted_until` handling, parameterised on `report_kind` instead of
   hardcoded to `'daily'`. Do **not** rewrite `report_daily_recipients()` to call this new function
   as a special case in this plan — that is a refactor of a function three other things already
   depend on, and it is not needed to make weekly/monthly work. Leave it as-is and say so in your
   report.

6. **Idempotency is per report instance, not per calendar date.** A published instance can be
   superseded and republished (`report_instances.supersedes_id`); each **instance id** may be sent
   at most once. Follow `daily_report_already_sent`'s shape but key on
   `report_deliveries.report_instance_id`, which the table already carries
   (`report_deliveries_instance_required_check` at `migrations/20260822090000...:` requires it for
   any non-daily `report_kind`).

7. **`dry_run` is required**, same contract as the daily sender: returns the recipient list and the
   rendered parameters, sends nothing, writes no delivery row.

8. **Every new RPC is `service_role` only.** `REVOKE ALL ... FROM PUBLIC, anon, authenticated` then
   `GRANT EXECUTE ... TO service_role`, matching the pattern at
   `migrations/20260825090000_report_subscriptions_and_staff.sql:398-403`.

## Deliverables

### 1. Migration — `migrations/<14-digit-UTC-timestamp>_period_report_senders.sql`

Timestamp later than wa-flow-02's and wa-flow-03's migrations (if either added one — wa-flow-03 is
expected not to). Must satisfy `scripts/verify-migration-prefixes.mjs`.

- `report_recipients_for_kind(p_kind text) RETURNS TABLE(recipient_id uuid, display_name text,
  phone text, is_staff boolean)` — per contract 5.
- `latest_published_instance(p_period_type text) RETURNS uuid` (or jsonb — choose one and be
  consistent with how `send-period-report` will consume it; state your choice and why in the
  migration's header comment) — the current period's published instance, if any, else null/not
  found. "Current period" means the same period `get_report_current_period(p_period_type)` already
  computes; call that function rather than recomputing period boundaries.
- `period_report_already_sent(p_report_instance_id uuid) RETURNS boolean` — per contract 6.
- Grants per contract 8.
- `NOTIFY pgrst, 'reload schema';` at the end.
- Header comment: what is missing today (the two dead ticks, measured — 0 rows in
  `report_subscriptions` as of 2026-09-04, so there is nothing to break), what this adds, and an
  explicit **OUT OF SCOPE: applying this migration** line.

### 2. `scripts/submit-whatsapp-template.mjs` — two more template definitions

Following wa-flow-03's finished shape exactly: `TEMPLATE_WEEKLY` and `TEMPLATE_MONTHLY` (or an
array — match whatever structure wa-flow-03 leaves the daily one in), same two buttons, `UTILITY`
category. Extend the dry-run output to show all three. Do not touch the two-project-trap comment
or `BASE`.

### 3. New edge function — `supabase/functions/send-period-report/index.ts`

Modelled directly on `send-daily-production-report/index.ts`'s structure and ordering:

1. Auth — identical bearer-token pattern.
2. Parse `p_kind` from the request body, normalise per contract 1.
3. Call `latest_published_instance(kind)`. No instance → return success with `sent: 0` and a
   reason, per contract 2. **This must not be treated as an error** — log it as a normal outcome.
4. Call `period_report_already_sent(instance_id)`. Already sent → same "nothing to do" response.
5. Call `get_report_instance(instance_id)`. Build the template's body parameters from it —
   period label, published date, and whatever headline figures the template body needs (define the
   template body text as part of deliverable 2, matching what this step can actually populate; do
   not design a template body this step cannot fill). Apply the same never-'0'-for-missing
   discipline as `formatFigure`.
6. `dry_run` short-circuit, per contract 7.
7. Call `report_recipients_for_kind(kind)`.
8. Sequential per-recipient send: `begin_report_delivery` → `sendTemplate(phone, templateName,
   'en', [bodyComponent])` → `complete_report_delivery`, `report_kind` set to the period kind,
   `report_instance_id` set. Same non-fatal error handling as the daily sender — one recipient's
   failure must not abort the loop.

### 4. Verifier — `scripts/verify-wa-period-reports.mjs`

Registered as `wa-period-reports:verify`, appended to the end of `test:fleet`. Same `.ts`
discipline as the sibling verifiers: textual assertions, no evaluation of `.ts`, pure `fs` reads,
every failure names the file to fix.

Assert at least:

1. `send-period-report/index.ts` exists and references both `'weekly'` and `'monthly'`.
2. It calls `report_recipients_for_kind`, not `report_daily_recipients` — this function must never
   silently start reading the daily table.
3. It checks `period_report_already_sent` before sending.
4. It supports `dry_run` (search for the same flag name the daily sender uses).
5. The two new template names in `submit-whatsapp-template.mjs` match the two names
   `send-period-report/index.ts` sends — same drift risk as wa-flow-03's assertion 5, repeated for
   two more names.
6. Both new templates declare the same two button labels as the daily one — read the daily
   template's labels from the file rather than hardcoding them a second time here, so a later
   change to the daily labels is caught everywhere at once, not just in wa-flow-03's verifier.
7. The new RPCs are `service_role` only, same shape as wa-flow-02's assertion 2.

**Prove the verifier bites** on at least assertion 2 and one grant assertion: break it, run, see
red, fix it, see green. Report what you did.

## Verify before finishing

1. `npm run test:fleet` — green, including the new verifier.
2. `npm run wa-period-reports:verify` alone.
3. `npm run migrations:verify`.
4. `npm run report-whatsapp-parity:verify` and `npm run wa-plumbing:verify` — neither should be
   affected by this plan; a failure here means something was touched that should not have been.
5. Confirm in your report that `report_daily_recipients()` was **not** modified by this plan
   (contract 5) — that function belongs to wa-flow-02 and to the already-deployed daily sender,
   and this plan must leave it exactly as wa-flow-02 left it.

## Out of scope — do not do these

- **Applying the migration or deploying the new function.** A human does both, on dev first.
- **Scheduling anything.** wa-flow-05.
- **The distribution panel UI.** wa-flow-07/08.
- **Rewriting `report_daily_recipients()` to delegate to the new generic function.** Contract 5.
- **Submitting the two new templates to Meta.** A human runs `--submit`.
- **Touching `send-report-whatsapp/index.ts`.** That is the manual send path and is untouched by
  this plan.
