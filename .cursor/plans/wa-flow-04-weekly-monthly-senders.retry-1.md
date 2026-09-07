---
depends_on: wa-flow-03-daily-template-buttons.md
retry_of: ee36f266-67d4-49de-85a5-4faead4d8809
---

# WhatsApp: send the weekly and monthly reports, the way the daily one already does

## Context

The distribution panel (`WebPortal/modules/sales-reports/html/report_list.html`) has Daily, Weekly
and Monthly columns. Only Daily is ever read by anything: the only two selectors over
`report_subscriptions` in this repo hard-code `rs.report_kind = 'daily'`
(`migrations/20260825090000_report_subscriptions_and_staff.sql:272` and `:309`, and the
post-wa-flow-02 version at `migrations/20260907130000_report_opt_out.sql:238`), while
`set_report_subscription` happily accepts `'weekly'` and `'monthly'`
(`20260825090000:195-213`). Ticking those two columns therefore writes a row nothing reads. This
plan is what makes them true.

`send-daily-production-report/index.ts` is the working model: auth, read the figures, check nothing
was already sent, select recipients, build template parameters, send one at a time, record
delivery. This plan follows that shape for a **published report instance** instead of a daily
figure snapshot, because that is what weekly and monthly are in this schema
(`report_instances.status` CHECK `draft|published|superseded`, `published_at`,
`20260817100000_report_instances_and_targets.sql:124-152`).

This plan depends on wa-flow-03 (merged) because it reuses the button-tap dispatch that plan added
rather than inventing a second one: the weekly and monthly templates carry the same two quick-reply
buttons as the daily, and a tap on either already lands in the same place a daily tap does.

### Source-of-truth note — read this before you write anything

Two classes of source the earlier draft of this plan cited **do not exist in this checkout**, and
nothing in this plan may be justified by them:

- There is **no** `docs/mockups/whatsapp-flow-spec.html` and **no**
  `docs/mockups/whatsapp-integration.html` (`docs/mockups/` holds only
  `whatsapp-staff-commands.html`). No requirement in this plan comes from a mockup or a spec
  document. If you find yourself needing one, the requirement is missing from this plan — stop and
  report it rather than inventing it.
- There is **no** `scripts/submit-whatsapp-template.mjs`, no `BASE` constant, no `--submit` flag
  and **no template-submission client of any kind** in this repo. See deliverable 2.

Every other structural claim below was checked against this checkout by name and is safe to build
on. Line numbers are hints; locate symbols by name.

## Read this first — what is already here, and where to read it

### The model to copy — `supabase/functions/send-daily-production-report/index.ts`

Read the whole file (397 lines) before writing anything. In particular:

- **Auth gate, `:155-162`** — the `authorization` header, `Bearer ` stripped, compared with
  `timingSafeEqual` (imported from `../_shared/wa-inbound.ts`) against
  `SUPABASE_SERVICE_ROLE_KEY`; an empty header or an empty env var is always rejected. Copy this
  verbatim in shape. Its per-function `config.toml` says why `verify_jwt = true` is not the real
  gate — read that file too (`supabase/functions/send-daily-production-report/config.toml`).
- **`rpcRows` at `:80-86` and its header comment at `:73-79`** — this helper is ONLY for
  TABLE-returning RPCs. A bare boolean or a bare scalar collapses `true` and `false` to the same
  `[]`. This is load-bearing for contract 6 below.
- **`formatFigure` `:94-106`, `sanitizeParam` `:114-116`, `buildTemplateParams` `:123-137`** — the
  parameter-building pattern. `sanitizeParam` deliberately never uses `\s`; read the comment for
  why.
- **The ordering `:243-289`** — recipients (`:246`), the `no_recipients` early return (`:251`), the
  `MAX_RECIPIENTS = 25` cap and warn-and-slice (`:254-259`), params built once (`:262`), `dry_run`
  short-circuit returning `params` **and** `recipients` (`:265-271`), then the send.
- **The send loop `:295+`** — a null phone from the selector handled explicitly (`:296-315`),
  `begin_report_delivery` → `sendTemplate` → `complete_report_delivery` per recipient, sequential,
  one recipient's failure non-fatal.
- **`renderedBodyText` `:281-289`** — the plain-text audit rendering passed to
  `complete_report_delivery`'s `p_message_body`, never to `sendTemplate`.

### The report instance — `migrations/20260817100000_report_instances_and_targets.sql`

- `report_instances` at `:124-152`: `period_type` CHECK(`weekly`/`monthly`), `period_start`,
  `period_end`, `status` CHECK(`draft`/`published`/`superseded`), `published_at`, `content_sha256`,
  `version`, `supersedes_id`. The CHECK `status <> 'published' OR (published_at IS NOT NULL AND
  content_sha256 IS NOT NULL)` means a published row is never missing those two.
- `get_report_instance(p_report_instance_id uuid) RETURNS jsonb` at `:706-793`. The header keys this
  plan uses are `period_label`, `published_at`, `period_type`, `status` — plus `sections`,
  `executive_summary` and the rest, which this plan does **not** put into a template parameter.
- `report_period_label(p_period_type, p_period_start)` at
  `20260817090000_report_builder_foundations.sql:124-137`. **For monthly it uses
  `TO_CHAR(period_start, 'Month YYYY')`, and `'Month'` is blank-padded to 9 characters** — a May
  label is literally `May      2027 (FYE 2027)`, a six-space run. This is why contract 4's
  sanitisation is mandatory, not cosmetic.
- **There is no existing "latest published instance for this period_type" selector.** Checked by
  name across every migration: `get_report_current_period` (`20260817090000:144-165`) computes what
  the *current* period's dates are and nothing else; `get_latest_published_report_for_phone`
  (`20260825092000_report_link_codes.sql:198-239`) finds the latest instance **delivered to a given
  phone**. Neither answers this plan's question. The "newest published instance wins" ordering
  idiom to model on is `20260904100000_targets_module_consolidation.sql:168-177`
  (`ri.status = 'published'`, `ORDER BY … ri.version DESC, ri.published_at DESC`).

### The recipient selector this plan needs — does not exist yet

`report_daily_recipients()` in its current, post-wa-flow-02 form is
`migrations/20260907130000_report_opt_out.sql:226-244`. Read those 19 lines; the new function is a
parameterised sibling of exactly that body. `scripts/verify-wa-optout.mjs:171-194` asserts the
daily one still contains `rr.opted_out_at IS NULL`, `rs.muted_until IS NULL`,
`public.report_sast_today()`, `rr.is_active`, `rs.is_active` and `ORDER BY rr.display_name` — so
modifying it in any way risks breaking a merged gate.

### The text-rendering pattern — `supabase/functions/send-report-whatsapp/index.ts`

- `buildMessageText(payload, signedUrl)` at `:194-213` builds the body **entirely server-side** from
  a `get_report_instance`-shaped payload: period label, `published_at.slice(0, 10)`, a collapsed and
  truncated executive summary, then the link. Read it for the convention (server-side, em dash for a
  missing value, no Markdown) before writing this plan's parameter builder.
- **Do not copy its `rawSummary.replace(/\s+/g, ' ')` into a template-parameter path** — `\s` in
  JavaScript matches U+00A0, which is exactly what `sanitizeParam` exists to protect.
- **Do not copy its `p_link_expires_at: linkExpiresAt`** (`:441`, `:481`, `:524`). That value exists
  because that function sends a signed PDF URL. This plan's send carries no link, so
  `p_link_expires_at` is `null`.
- `send-report-whatsapp` is the *manual*, session-gated, `has_action(user,'reports.report.send')`
  free-text path. **Do not touch it.**

### The template descriptor — what wa-flow-03 actually left

`scripts/wa-template-daily-production.mjs` (63 lines — read all of it). It is an **inert, offline
descriptor**: it exports `TEMPLATE_BUTTONS` (`[{ kind: 'quick_reply', text: 'View report' },
{ kind: 'quick_reply', text: 'Menu' }]`) and `TEMPLATE`
(`{ name: 'macavation_daily_production', language: 'en', category: 'UTILITY', body: […].join('\n'),
buttons: TEMPLATE_BUTTONS }`), then prints them from module top level. Its own header states it is
**not** a submission client and that this repo has none. `npm run wa-template-daily-production:print`
runs it.

`scripts/verify-wa-template-buttons.mjs` is a merged gate over that file. Two of its checks bound
this plan:

- It asserts that file contains **none** of `fetch(`, `process.env`, `http://`, `https://`,
  `.supabase.co`, `crk_`, `require(`.
- It asserts the key set of `TEMPLATE_BUTTON_ROUTES` in `whatsapp-inbound/index.ts` matches the
  lower-cased daily button labels **in both directions**. Adding a key there breaks it.

### The bot's button dispatch — already correct, change nothing

`whatsapp-inbound/index.ts:1366-1372` defines
`TEMPLATE_BUTTON_ROUTES = { 'view report': … renderMenuItem(ctx, 'report'), menu: commandMenu }`,
matched at `:1395-1397` on `ctx.replyId.trim().toLowerCase()`. `renderMenuItem(ctx,'report')` calls
`get_latest_published_report_for_phone(p_phone)`, which returns the latest published instance
**already delivered to that number**, regardless of period type. Because both new templates reuse
the two daily labels character-for-character, a tap on a weekly or monthly `View report` already
routes correctly with **zero** changes to `whatsapp-inbound/index.ts`. Confirm this by reading it
and say so in your report; do not add a second matching block and do not add a route key.

### Shared plumbing — import only, never edit

`supabase/functions/_shared/wa-send.ts` exports
`sendTemplate(to: string, templateName: string, languageCode: string, components?:
WaTemplateComponent[])` (`:377-385`) and `type WaTemplateComponent` (`:83-88`).
`scripts/verify-wa-plumbing.mjs` pins blocks of `wa-send.ts`, `wa-limits.ts` and `wa-inbound.ts`
**verbatim**. Import from them; edit none of them.

## FIXED contracts

1. **One new edge function, `send-period-report`, handling both weekly and monthly** — not two.
   It takes `p_kind` and normalises it the way `get_period_production_summary` already does
   (`migrations/20260825091000_daily_production_report.sql:348-367`: `lower(TRIM(...))`, then
   `week|weekly → weekly`, `month|monthly → monthly`). Do not invent a third spelling. Anything else
   — including `'daily'`, `''` and `null` — is a `400` before any RPC is called. The normalised
   value is held in a single variable named `kind` and every downstream call uses that variable.

2. **The trigger is "a published instance for the current-or-previous period that has not been sent
   yet," not a bare calendar date.** A weekly or monthly report published after its own period has
   ended must still send. Concretely: `latest_published_instance` must **not** call
   `get_report_current_period` and must not pin to the period containing today —
   `get_report_current_period('monthly')` on 2 October returns October, so the September instance
   (whose `period_start` is 1 September) would never be selected and the monthly send would silently
   never happen. See deliverable 1 for the exact predicate. A period with no published instance
   sends nothing, returns `200`, and is **not** an error — that is the normal state early in a
   period.

3. **Two new templates, one per kind: `macavation_weekly_report`, `macavation_monthly_report`** —
   `UTILITY` category, `en` language, and the same two quick-reply buttons as the daily, same order,
   same labels (`View report`, `Menu`). They are declared as **inert offline descriptors** in the
   shape of `scripts/wa-template-daily-production.mjs`. **This repo has no Meta submission client and
   this plan does not create one:** no `fetch`, no Graph API URL or version, no credential read, no
   `--submit` flag, no `process.env`, no project ref, no Control Room URL in the new descriptor file.
   A human submits templates to Meta outside this repo.

4. **Body parameters come from `get_report_instance`, rendered server-side, never from the browser,
   and the wording is fixed by this plan — the agent authors none of it.** Exactly two parameters per
   template, in this order: `{{1}}` = `period_label`, `{{2}}` = `published_at` truncated to
   `YYYY-MM-DD` (`String(payload.published_at).slice(0, 10)`, the same treatment as
   `buildMessageText`'s `:197`). Both go through a `sanitizeParam` copied from the daily sender
   (`:114-116`) — no `\s` anywhere in it — because a monthly `period_label` contains a blank-padded
   run of spaces (see the `report_period_label` note above). If either parameter is empty after
   sanitising, the function sends **nothing** and returns `200 { sent: 0, skipped:
   'incomplete_payload' }`; it must never send a template with an empty parameter and must never
   substitute an invented placeholder.

5. **Recipients: a new `report_recipients_for_kind(p_kind text)` RPC**, `SECURITY DEFINER`,
   `SET search_path = public`, `service_role` only — the parameterised sibling of
   `report_daily_recipients()` as it stands at `20260907130000_report_opt_out.sql:226-244`: same
   `rr.is_active`, `rs.is_active`, `rr.opted_out_at IS NULL`, same `muted_until` clause, same
   `public.report_normalize_wa_phone(rr.phone)` projection, same `ORDER BY rr.display_name`,
   parameterised on `report_kind`. It accepts only `weekly`/`monthly` (after contract 1's
   normalisation); **anything else, including `'daily'`, must yield zero rows — never an exception
   and never a `COALESCE(..., 'daily')`-style fallback onto the daily roster.** Do **not** rewrite
   `report_daily_recipients()` to delegate to it: that is a refactor of a function three other
   things depend on, it is not needed here, and `scripts/verify-wa-optout.mjs:171-194` asserts its
   current body. Leave it byte-identical and say so in your report.

6. **Idempotency is per report instance, keyed on the automatic template path only.** A published
   instance can be superseded and republished, producing a **new** instance id, which is a fresh,
   sendable key by design. `period_report_already_sent(p_report_instance_id uuid) RETURNS boolean`
   must be `EXISTS(... report_deliveries d WHERE d.report_instance_id = p_report_instance_id AND
   d.status = 'sent' AND d.message_kind = 'template')`. The `message_kind = 'template'` clause is
   required: `send-report-whatsapp` calls `begin_report_delivery` without `p_report_kind` or
   `p_message_kind` (`index.ts:509-526`), so its manual rows default to `weekly`/`text`
   (`20260825091000:124-127`) — without that clause, one manual send of a report to one person would
   suppress the automatic broadcast to everyone, and a manually-sent monthly would be mis-stamped
   `weekly` on top. `report_deliveries.report_instance_id` is already carried, and a non-daily row
   cannot exist without it (`report_deliveries_instance_required_check`, `20260825091000:87-88` —
   note the file, the earlier draft of this plan cited the wrong one).

7. **Both new scalar RPCs are read directly from `data`, never through `rpcRows`.**
   `latest_published_instance` returns a bare `uuid` and `period_report_already_sent` a bare
   `boolean`; `rpcRows` (`send-daily-production-report/index.ts:80-86`, and its own comment at
   `:73-79`) turns either into `[]`, which would silently disable the idempotency guard and make the
   selector look empty forever. Use `const { data, error } = await sb.rpc(...)` for both, exactly as
   the daily sender does for `daily_report_already_sent` (`:230`) and `report_sast_today` (`:188`).
   Use `rpcRows` only for the TABLE-returning RPCs (`report_recipients_for_kind`,
   `begin_report_delivery`, `complete_report_delivery`).

8. **`dry_run` is required and must be reachable with an empty roster.** It returns the resolved
   instance id, the template name, the rendered parameters and the recipient list; it sends nothing
   and writes no delivery row. Its short-circuit sits **after** the `report_recipients_for_kind`
   call (so the list it promises actually exists) and **before** the `no_recipients` early return —
   a deliberate, commented divergence from the daily sender's `:251` / `:265` order, because
   weekly/monthly subscription rows have never been read by anything, so the roster is likely empty
   until a human ticks the panel, and proving the wording before it goes out must not depend on that.

9. **Every new RPC is `service_role` only.** `REVOKE ALL ON FUNCTION <sig> FROM PUBLIC, anon,
   authenticated;` then `GRANT EXECUTE ON FUNCTION <sig> TO service_role;`, matching
   `migrations/20260825090000_report_subscriptions_and_staff.sql:398-403` and
   `20260907130000_report_opt_out.sql:251-254` exactly. All three are `SECURITY DEFINER` with
   `SET search_path = public`.

10. **No new dependency, and nothing that needs a network or a database.** This repo has no
    `package-lock.json`; do not run `npm ci`, do not add a package, do not add a transpiler.
    `test:fleet` is hermetic (see `package.json`'s own `//test:fleet` note) — every assertion this
    plan adds is a pure `fs` read. Never assert a live row count, a Meta approval state, or anything
    else this checkout cannot show.

## Deliverables

### 1. Migration — `migrations/<14-digit-UTC-timestamp>_period_report_senders.sql`

Timestamp later than `20260907130000`. Must satisfy `scripts/verify-migration-prefixes.mjs` (14
digits, a real UTC timestamp, unique, `.sql` only, no new baseline entry).

Header comment must state, in this order:

- What is missing today, **stated only as this checkout can prove it**: the only selectors over
  `report_subscriptions` filter `rs.report_kind = 'daily'`
  (`20260825090000:272`, `:309`, `20260907130000:238`), while `set_report_subscription`
  (`20260825090000:187-213`) accepts `weekly` and `monthly` — so those two ticks are written and
  never read. **Do not write any row count, date-stamped measurement, or "nothing to break"
  claim:** this file cannot be checked against a database from here.
- What this adds, and the chosen return type of `latest_published_instance` and why (below).
- An explicit `OUT OF SCOPE: applying this migration` line.
- That the file is idempotent to re-run (`CREATE OR REPLACE`, no destructive DDL).

Functions, exactly these three names and signatures:

- `public.report_recipients_for_kind(p_kind text) RETURNS TABLE (recipient_id uuid, display_name
  text, phone text, is_staff boolean)` — `LANGUAGE sql STABLE SECURITY DEFINER SET search_path =
  public`. Body is `report_daily_recipients()`'s body (`20260907130000:235-243`) with the join
  predicate changed from `rs.report_kind = 'daily'` to `rs.report_kind = <normalised p_kind>`, where
  the normalisation is inline and maps only `week|weekly → 'weekly'` and `month|monthly →
  'monthly'`, everything else (including `daily`, `''`, `NULL`) to `NULL` so the join matches
  nothing. No `LIMIT` (the daily sibling has none; the cap lives in the sender, per deliverable 3),
  no `ORDER BY` change, and **no inline phone normaliser** — call
  `public.report_normalize_wa_phone(rr.phone)` like the sibling does. (A hand-written
  `regexp_replace(..., '\D', '', 'g')` alongside a `'27'` literal in this file would be flagged by
  `scripts/verify-report-whatsapp-parity.mjs`'s SQL sweep as an unknown copy of the phone
  normaliser and fail `test:fleet`.)

- `public.latest_published_instance(p_period_type text) RETURNS uuid` — **uuid, not jsonb**; the
  caller needs only the key and reads everything else through `get_report_instance`, and a bare
  uuid keeps the read path identical to `daily_report_already_sent`'s. `LANGUAGE sql STABLE
  SECURITY DEFINER SET search_path = public`. Returns the newest published instance for that
  period type whose `period_start` is either the current period's start or the immediately
  preceding period's start; `NULL` when there is none. Both boundaries come from existing helpers —
  do not recompute calendar arithmetic and **do not call `get_report_current_period`** (contract 2):

  ```sql
  WITH bounds AS (
      SELECT k.kind,
             public.report_normalise_period_start(k.kind, public.report_sast_today()) AS cur
      FROM (SELECT CASE lower(TRIM(COALESCE(p_period_type, '')))
                        WHEN 'week'    THEN 'weekly'
                        WHEN 'weekly'  THEN 'weekly'
                        WHEN 'month'   THEN 'monthly'
                        WHEN 'monthly' THEN 'monthly'
                        ELSE NULL
                   END AS kind) k
  )
  SELECT ri.id
  FROM public.report_instances ri, bounds b
  WHERE b.kind IS NOT NULL
    AND ri.period_type = b.kind
    AND ri.status = 'published'
    AND ri.period_start IN (b.cur, public.report_normalise_period_start(b.kind, b.cur - 1))
  ORDER BY ri.period_start DESC, ri.version DESC, ri.published_at DESC NULLS LAST
  LIMIT 1;
  ```

  `report_normalise_period_start(kind, cur - 1)` is the previous period's start for both kinds
  (weekly: the Sunday before the current Monday snaps back to `cur - 7`; monthly: the last day of
  the previous month snaps back to its 1st) — verify that against
  `20260817090000:92-102` before relying on it. The two-period window is the whole staleness bound:
  a report published late for the period just ended still sends, a months-old backlog instance does
  not fire an unprompted broadcast. Comment that reasoning in the function header.

- `public.period_report_already_sent(p_report_instance_id uuid) RETURNS boolean` — per contract 6,
  modelled on `daily_report_already_sent` (`20260825091000:279-287`), `LANGUAGE sql STABLE SECURITY
  DEFINER SET search_path = public`. Returns `false`, never `NULL`, for a NULL argument.

Then the grants per contract 9 (all three signatures spelled out), and `NOTIFY pgrst, 'reload
schema';` as the last statement.

### 2. `scripts/wa-template-period-reports.mjs` — the two new descriptors

A **new** file, not an edit of the daily one. Same inert shape and same header discipline as
`scripts/wa-template-daily-production.mjs`: no network, no `process.env`, no credential, no
`https://`, no `.supabase.co`, no project ref, no `require(`, no submission logic, no `--submit`.
Its header must state (as the daily's does) that it is a descriptor only, that this repo has no
submission client, and that whether Meta has approved these templates is not knowable from this
checkout.

Exports, exactly these names:

```js
export const PERIOD_TEMPLATE_BUTTONS = [
  { kind: 'quick_reply', text: 'View report' },
  { kind: 'quick_reply', text: 'Menu' },
];

export const TEMPLATE_WEEKLY = {
  name: 'macavation_weekly_report',
  language: 'en',
  category: 'UTILITY',
  body: [
    'Macavation weekly report — {{1}}',
    'Published {{2}}',
    'Tap "View report" for your link, or "Menu" for other options.',
  ].join('\n'),
  buttons: PERIOD_TEMPLATE_BUTTONS,
};

export const TEMPLATE_MONTHLY = {
  name: 'macavation_monthly_report',
  language: 'en',
  category: 'UTILITY',
  body: [
    'Macavation monthly report — {{1}}',
    'Published {{2}}',
    'Tap "View report" for your link, or "Menu" for other options.',
  ].join('\n'),
  buttons: PERIOD_TEMPLATE_BUTTONS,
};
```

The two labels are duplicated from the daily descriptor deliberately rather than imported (importing
it would execute its top-level printer as a side effect); deliverable 4 asserts deep equality
against `TEMPLATE_BUTTONS` from `scripts/wa-template-daily-production.mjs`, so they cannot drift
silently. Each body begins and ends with literal text and uses `{{1}}` and `{{2}}` exactly once
each — that is this plan's fixed choice, not an asserted Meta rule; do not add, remove or reorder a
placeholder, and do not add a third.

Add a top-level printer in the same style as the daily descriptor's `:43-63`, printing both
templates. Register it as `"wa-template-period-reports:print": "node
scripts/wa-template-period-reports.mjs"` in `package.json`.

**Do not modify `scripts/wa-template-daily-production.mjs`** (its `TEMPLATE`, `TEMPLATE_BUTTONS`,
body or printer) and **do not modify `whatsapp-inbound/index.ts`** — both are pinned by
`scripts/verify-wa-template-buttons.mjs`, whose route-key check compares
`TEMPLATE_BUTTON_ROUTES`'s keys against the daily labels in both directions.

### 3. New edge function — `supabase/functions/send-period-report/index.ts`

Modelled directly on `send-daily-production-report/index.ts`'s structure, ordering and error
handling. Named things, defined once and referenced by these exact names:
`TEMPLATE_WEEKLY_NAME = 'macavation_weekly_report'`,
`TEMPLATE_MONTHLY_NAME = 'macavation_monthly_report'`, `MAX_RECIPIENTS = 25`,
`normalisePeriodKind()`, `sanitizeParam()`, `buildPeriodTemplateParams()`, `rpcRows()`, and the
locals `kind`, `dryRun`, `instanceId`, `payload`, `params`, `recipients`, `templateName`,
`renderedBodyText`.

Steps, in this order:

1. `OPTIONS` → `ok`; non-`POST` → `405`. Then the auth gate, identical in shape to the daily's
   `:155-162` (`timingSafeEqual` from `../_shared/wa-inbound.ts`, both sides checked non-empty).
2. Parse the body as JSON (`400` on malformed). `const dryRun = body?.dry_run === true;`
   `const kind = normalisePeriodKind(body?.p_kind);` — `normalisePeriodKind` implements contract 1's
   mapping and returns `null` for anything else, which is a `400` with a message naming the two
   accepted values. There is **no** `force` flag (see Out of scope).
3. `latest_published_instance(kind)`, read directly from `data` per contract 7. `null` → `200 { sent:
   0, skipped: 'no_published_instance', kind }` and a `console.log` (not `console.error`) — this is a
   normal outcome, not a failure. An RPC error → `502`.
4. `period_report_already_sent(instanceId)`, read directly from `data` per contract 7. `true` →
   `200 { sent: 0, skipped: 'already_sent', kind, report_instance_id: instanceId }`.
5. `get_report_instance(instanceId)` (single jsonb, read directly from `data`). Null/empty payload →
   `502`. Then `params = buildPeriodTemplateParams(payload)` — exactly the two parameters of
   contract 4, each passed through `sanitizeParam`. If either is empty → `200 { sent: 0, skipped:
   'incomplete_payload', … }`. No figures are sent, so no `formatFigure` is needed and none should
   be copied in; if a later plan adds a numeric parameter it must bring the daily's
   never-`'0'`-for-missing discipline with it.
   `templateName = kind === 'weekly' ? TEMPLATE_WEEKLY_NAME : TEMPLATE_MONTHLY_NAME;`
6. `report_recipients_for_kind({ p_kind: kind })` via `rpcRows` (`502` on throw).
7. `dry_run` short-circuit per contract 8 — **before** the `no_recipients` return, with a comment
   saying why it diverges from the daily's order. Returns `{ kind, report_instance_id: instanceId,
   template_name: templateName, params, recipients: recipients.map((r) => ({ display_name:
   r.display_name ?? null, phone: r.phone ?? null })) }`.
8. `recipients.length === 0` → `200 { sent: 0, skipped: 'no_recipients', kind, report_instance_id }`.
   Then the `MAX_RECIPIENTS` warn-and-slice, identical to the daily's `:254-259`.
9. Sequential per-recipient send, same non-fatal error handling as the daily's `:295+` — one
   recipient's failure must not abort the loop — and the same explicit null-phone handling, because
   this selector projects through `report_normalize_wa_phone` too and can return `NULL`. Per
   recipient: `begin_report_delivery` with `p_report_instance_id: instanceId`, `p_phone: phone`,
   `p_display_name: displayName`, `p_recipient_id: recipient.recipient_id ?? null`,
   `p_message_body: renderedBodyText`, `p_pdf_storage_bucket: null`, `p_pdf_storage_path: null`,
   **`p_link_expires_at: null`** (there is no link in this send — do not reuse
   `send-report-whatsapp`'s expiry value or default), `p_actor_user_id: null`,
   `p_report_kind: kind`, `p_report_date: null`, `p_message_kind: 'template'`,
   `p_template_name: templateName` — then
   `sendTemplate(phone, templateName, 'en', [bodyComponent])`, then `complete_report_delivery`.
   `p_message_kind: 'template'` is what makes contract 6's idempotency key work; it must be passed
   explicitly and never left to `begin_report_delivery`'s `'text'`/`'weekly'` defaults
   (`20260825091000:124-127`).
   `renderedBodyText` is the plain-text audit rendering, built from the same `params` array with the
   descriptor's wording (`Macavation ${kind} report — ${params[0]}` / `Published ${params[1]}`),
   joined with `\n`, and is never passed to `sendTemplate`.
10. Response: `{ success: true, kind, report_instance_id, template_name, sent, failed, results }`,
    same shape as the daily's.

Contains **no phone normaliser**: no `replace(/\D/g`, no `normalizePhone`. The phone from
`report_recipients_for_kind` goes straight through, exactly as in the daily sender.
`scripts/verify-report-whatsapp-parity.mjs` sweeps every `.ts` under `supabase/functions/` for that
idiom and fails on an unlisted copy.

Also add `supabase/functions/send-period-report/config.toml` with
`[functions.send-period-report]` / `verify_jwt = true`, and a header modelled on the daily
function's `config.toml` — keep its reasoning (verify_jwt is defence in depth only; the in-code
service-role check is the real gate) and **override its environment-specific state**: no cron/17:00
schedule claim (nothing is scheduled here), no claim that this function is deployed, and where a
project ref is mentioned at all use the committed dev/UAT ref from `supabase/remote.toml`
(`nmdmddugxclpqrwylyfa`), never the production ref.

### 4. Verifier — `scripts/verify-wa-period-reports.mjs`

Registered as `"wa-period-reports:verify": "node scripts/verify-wa-period-reports.mjs"` and appended
to the **end** of `test:fleet`. Same `.ts` discipline as the sibling verifiers
(`verify-wa-optout.mjs`, `verify-wa-plumbing.mjs`): pure `fs` reads, textual assertions, never
evaluate a `.ts` file, no dependency, no network, CRLF normalised on read, the `check()` harness and
the `isolateSqlFunction` `$fn$` idiom from `verify-wa-optout.mjs:122-139`, and every failure names
the file to fix. Locate the new migration by suffix (`*_period_report_senders.sql`) with the
exactly-one guard from `verify-wa-optout.mjs:46-62`, not by hard-coded timestamp. When importing the
two descriptor files, silence `console.log` around the import (they print at top level) and restore
it afterwards.

Assert at least:

1. `supabase/functions/send-period-report/index.ts` exists and references both `'weekly'` and
   `'monthly'`.
2. It calls `report_recipients_for_kind` and **never** mentions `report_daily_recipients` — this
   function must not silently start reading the daily roster.
3. It calls `period_report_already_sent`, and that call's index in the source is **before** the
   first `sendTemplate(` call.
4. It calls `latest_published_instance`, and neither that name nor `period_report_already_sent`
   appears in an `rpcRows(` call (contract 7) — assert the absence of the substrings
   `rpcRows(sb, 'latest_published_instance'` and `rpcRows(sb, 'period_report_already_sent'`, and the
   presence of a direct `sb.rpc('latest_published_instance'` / `sb.rpc('period_report_already_sent'`.
5. It supports `dry_run` (the same flag name the daily sender uses), the `dryRun` return block's
   index is **after** the `report_recipients_for_kind` call and **before** both the
   `'no_recipients'` literal and the first `sendTemplate(`, and that block's text mentions both
   `params` and `recipients`.
6. `TEMPLATE_WEEKLY.name` and `TEMPLATE_MONTHLY.name` from `scripts/wa-template-period-reports.mjs`
   each appear in `send-period-report/index.ts` as the value of `TEMPLATE_WEEKLY_NAME` /
   `TEMPLATE_MONTHLY_NAME` respectively (parse `const TEMPLATE_WEEKLY_NAME = '…';` out of the
   source and compare) — the wa-flow-03 drift risk, repeated for two more names.
7. `PERIOD_TEMPLATE_BUTTONS` deep-equals `TEMPLATE_BUTTONS` imported from
   `scripts/wa-template-daily-production.mjs`, and `TEMPLATE_WEEKLY.buttons` and
   `TEMPLATE_MONTHLY.buttons` each deep-equal `PERIOD_TEMPLATE_BUTTONS` — labels and order read from
   the daily file, never hard-coded here, so a later change to the daily labels is caught everywhere
   at once.
8. `scripts/wa-template-period-reports.mjs` is inert: it contains none of `fetch(`, `process.env`,
   `http://`, `https://`, `.supabase.co`, `crk_`, `require(` — the same needle list
   `scripts/verify-wa-template-buttons.mjs` applies to the daily descriptor. The failure message must
   say that this repo has no template-submission client and that one must not be added here.
9. Each new template `body` contains `{{1}}` and `{{2}}` exactly once each and does not contain
   `{{3}}`; and `buildPeriodTemplateParams` in the sender references `period_label` and
   `published_at` and nothing else in its raw array (assert the isolated function body contains both
   and does not contain `executive_summary` or `sections`).
10. The sender's `sanitizeParam` contains no `\s` (contract 4), and the sender contains no
    `replace(/\D/g` (no eighth phone normaliser).
11. Each of the three new RPCs is `SECURITY DEFINER`, pins `SET search_path = public`, and has both
    `REVOKE ALL ON FUNCTION <sig> FROM PUBLIC, anon, authenticated;` and `GRANT EXECUTE ON FUNCTION
    <sig> TO service_role;` — the shape of `verify-wa-optout.mjs:200-231`, with the exact signatures
    `public.report_recipients_for_kind(text)`, `public.latest_published_instance(text)`,
    `public.period_report_already_sent(uuid)`.
12. `latest_published_instance`'s isolated body does **not** contain `get_report_current_period`,
    and does contain `report_normalise_period_start`, `report_sast_today` and `ri.status =
    'published'` (contract 2's fix, asserted where it can regress).
13. `period_report_already_sent`'s isolated body contains `report_instance_id`, `d.status = 'sent'`
    and `d.message_kind = 'template'` (contract 6).
14. `report_recipients_for_kind`'s isolated body contains `rr.opted_out_at IS NULL`,
    `rs.muted_until IS NULL`, `public.report_sast_today()`, `rr.is_active`, `rs.is_active`,
    `public.report_normalize_wa_phone`, `ORDER BY rr.display_name`, and does **not** contain the
    literal `'daily'`.
15. `whatsapp-inbound/index.ts` still contains exactly the two `TEMPLATE_BUTTON_ROUTES` keys
    `'view report'` and `menu` and no third — this plan adds no route, and adding one would break
    `verify-wa-template-buttons.mjs`.

**Prove the verifier bites** on assertions 2, 4 and one grant assertion (11): break each, run it,
see red, restore it, see green. Report exactly what you broke and what the failure said.

## Verify before finishing

All of these run offline in this checkout; nothing here needs a database, a deploy or a network.

1. `npm run test:fleet` — green, including the new verifier.
2. `npm run wa-period-reports:verify` alone.
3. `npm run migrations:verify`.
4. `npm run wa-template-period-reports:print` — prints both descriptors with zero environment
   configured.
5. `npm run report-whatsapp-parity:verify`, `npm run wa-plumbing:verify`, `npm run wa-optout:verify`
   and the wa-flow-03 template-button verifier — none should be affected by this plan. A failure in
   any of them means something was touched that should not have been (a phone normaliser in the new
   `.ts`, an edited `_shared/` file, an edited `report_daily_recipients()`, an edited daily
   descriptor, or a new `TEMPLATE_BUTTON_ROUTES` key).
6. Confirm in your report, by quoting the diff, that `report_daily_recipients()`,
   `scripts/wa-template-daily-production.mjs`, `supabase/functions/whatsapp-inbound/index.ts`,
   `supabase/functions/send-report-whatsapp/index.ts` and everything under
   `supabase/functions/_shared/` are **unmodified**.
7. Confirm in your report that the migration header contains no row count, no date-stamped
   measurement and no claim about Meta approval, and that it carries the
   `OUT OF SCOPE: applying this migration` line.

## Out of scope — do not do these

- **Applying the migration or deploying the new function.** A human does both, on dev first.
- **Creating any Meta template-submission client, `--submit` flag, Graph API call, or anything that
  reads a credential or names a network endpoint.** This repo has none and this plan adds none.
- **Scheduling anything.** wa-flow-05.
- **The distribution panel UI.** wa-flow-07/08.
- **A `force` flag on `send-period-report`.** Republishing produces a new instance id, which is a
  fresh, sendable key by design; there is nothing for `force` to bypass.
- **Rewriting `report_daily_recipients()` to delegate to the new generic function.** Contract 5.
- **Editing `scripts/wa-template-daily-production.mjs`, `whatsapp-inbound/index.ts`, or anything
  under `supabase/functions/_shared/`.**
- **Touching `send-report-whatsapp/index.ts`.** That is the manual send path and is untouched here.
- **Putting the executive summary, any section text, or any production figure into the new template
  parameters.** Contract 4 fixes the two parameters.
- **Correcting the stale citation in any other file, or the "always use LIMIT" guidance in
  `BluePrint/supabase-database-rules.md`.** Both are separate, human-reviewed follow-ups.
