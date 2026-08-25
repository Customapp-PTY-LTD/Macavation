# WhatsApp reports — make the weekly/monthly send reach people who have not messaged

## ⚠ Read this first — why this plan is being re-issued, and what changed

An earlier version of this plan could not be built. The cause was not in the plan body below, which
is unchanged apart from the corrections noted here. Two things were in the way, **both now resolved
in code on `dev`**:

1. **`_shared/wa-send.ts` shipped with builders but no non-text sender.** The plumbing plan
   deliberately exported no `sendButtons` / `sendList` / `sendTemplate`, because the `meta-proxy`
   content shapes could not be verified from inside the checkout. It then wrote a verifier
   asserting those senders must *not* exist. That made every downstream plan unbuildable: adding a
   sender turned `npm run test:fleet` red.
2. **A stale in-code prohibition.** `whatsapp-inbound/index.ts` carried *"TEXT ONLY. Do not add an
   interactive/button send here (unconfirmed external contract)"*. That was correct when written,
   and an agent working inside the repo could only obey it — the fact needed to lift it did not
   exist anywhere in the repo.

Neither was a mistake by the agent. Both were the same structural problem: the work depended on a
fact obtainable only from outside the checkout. **That fact has now been obtained and committed**,
so nothing in this plan requires you to verify anything external.

The gateway source was read directly. `meta-proxy`'s `shapeMetaContent` forwards `template` as-is
and passes `interactive` through unchanged, so the existing builders were already emitting the right
shape. The three senders now exist, the verifier asserts they *do* exist, and the stale comment now
records that it is superseded and points at the confirmed contract. Read the header of
`supabase/functions/_shared/wa-send.ts` — the provenance is written down there.

**This plan depends on no other plan.** Everything it builds on is already merged into `dev`.

### The senders, exactly as they exist now

```ts
// supabase/functions/_shared/wa-send.ts
export async function sendText(to: string, text: string): Promise<WaSendResult>
export async function sendButtons(to: string, bodyText: string, buttons: WaButton[]): Promise<WaSendResult>
export async function sendList(to: string, bodyText: string, buttonLabel: string, sections: WaListSection[]): Promise<WaSendResult>
export async function sendTemplate(to: string, templateName: string, languageCode: string, components?: WaTemplateComponent[]): Promise<WaSendResult>

export type WaSendResult = { ok: boolean; wamid: string | null; error: string | null };
export type WaButton = { id: string; title: string };
export type WaListRow = { id: string; title: string };
export type WaListSection = { title: string; rows: WaListRow[] };
export type WaTemplateComponent = {
  type: 'header' | 'body' | 'button';
  sub_type?: 'url' | 'quick_reply';
  index?: number;
  parameters: { type: 'text'; text: string }[];
};
```

All four go through one private signing path, so there is exactly one `fetch` and one HMAC in the
file — keep it that way. Each **throws `WaSendError`** on a cap breach (more than 3 buttons, more
than 10 list rows, a button title over 20 characters, a list row or section title over 24, or a full
URL where a template url-button parameter belongs). A breach is a programming error: let it throw.
Do not catch it and send a truncated message instead.

Also available, and already used by the merged code — do not re-implement any of these:
`buildTextBody`, `buildButtonsBody`, `buildListBody`, `buildTemplateBody`, `buildReplyId`,
`parseReplyId`, `toWaPhone`, `hmacSha256Hex` (`_shared/wa-send.ts`); `MAX_BUTTONS`,
`MAX_BUTTON_CTA`, `MAX_LIST_ROWS`, `MAX_LIST_TITLE`, `MAX_LIST_SECTION`, `truncate`, `paginateRows`
(`_shared/wa-limits.ts`); `extractMessage`, `classifyMessage`, `verifyControlRoomSignature`,
`parseSignatureHeader`, `timingSafeEqual`, `sanitizeSenderName` (`_shared/wa-inbound.ts`).

**Why `sendTemplate` is not interchangeable with the other two.** Meta's 24-hour customer-service
window is real. `sendButtons` and `sendList` only reach somebody who has messaged in the last 24
hours — the gateway accepts the send and Meta then drops it, so it fails silently, which is the
worst possible failure mode. Only an approved template reaches a silent recipient. A button or list
tap *is* an inbound message and opens the window, which is why a template carrying buttons can
start a conversation that plain interactive sends then continue.

### What is yours to do, and what is not

| | |
|---|---|
| You **can** | author files, edit files, and run `npm run test:fleet` or any individual `npm run *:verify` |
| You **cannot** | apply a migration, reach a database, deploy a function, run Deno or typecheck TypeScript, use the network, read another repository, or drive a browser |

Three consequences, all of which have bitten this work already:

- **Every database object named below is already applied on `dev`.** Do not write a migration. Do
  not add a fallback that reads tables directly if an RPC looks missing — fail loudly with the
  Postgres error so whoever deploys finds out immediately.
- **Do not write a verification step you cannot run.** No "log in and check", no "deploy and send a
  test message", no "query the database to confirm". Those read as completed work when nothing was
  checked. State them as handover notes for a human instead, clearly separated.
- **If you find a genuine contradiction between this plan and the code, stop and say so in your
  report rather than narrowing scope silently.** The earlier run narrowed its own scope for a good
  reason and the result looked like a success, so the blockage was invisible until someone read the
  exports by hand. A plan that cannot be built as written is useful information; a quietly reduced
  deliverable is not.

## Context

Pete sends the weekly and monthly Sales & Production reports by hand from the report editor. That
stays exactly as it is. This plan fixes a real defect in how they are delivered.

**The defect.** Every send is free text. Meta only permits free text within 24 hours of the
recipient's own last inbound message. Pete's sends work today because he is sending into
conversations that are already live — but **a shareholder who has not messaged Macavation in three
weeks does not receive the report at all**. The function already half-knows this:
`send-report-whatsapp/index.ts:455-458` notes the likeliest gateway rejection is falling outside the
24-hour window. Nobody currently finds out which recipients that hit.

**The fix.** Decide per recipient. Inside the window, send exactly what is sent today. Outside it,
send an approved template with two buttons — `Read summary` (a quick reply, which opens the window so
Pete's full note can follow as ordinary text) and `Open report` (a URL button carrying a short code).
Record which path was used and surface it to Pete.

`_shared/wa-send.ts` is merged and exports `sendTemplate` — use it for the template path. Leave the
existing inline text sender in place for the text path so the parity verifier keeps passing.

**You cannot deploy or reach a database.** A human redeploys with
`supabase functions deploy send-report-whatsapp --project-ref nmdmddugxclpqrwylyfa`. The RPCs below
are already applied on `dev`, but you still cannot call them — treat the contracts here as settled.

⚠ **`scripts/verify-report-whatsapp-payload.mjs:46-52` asserts the literal source text of
`UUID_RE`, `FILENAME_RE` and `BASE64_RE` inside `send-report-whatsapp/index.ts`.** Do not touch,
reformat, or move those three regex declarations. Editing them fails the merge gate.

## Read first

| File | Why |
|---|---|
| `supabase/functions/send-report-whatsapp/index.ts` | the whole function; especially `:179-198` (`buildMessageText`), `:216-227` (session + `reports.report.send`), `:319-323` (published-only 409), `:327-361` (upload + signed URL), `:380-513` (the per-recipient loop) |
| `WebPortal/modules/sales-reports/js/report-whatsapp-history.js:306` | "Re-send all failed" selects `status ∈ {failed, pending}` |
| `scripts/verify-report-whatsapp-history.mjs` | the existing registered verifier you will extend |
| `WebPortal/modules/sales-reports/html/report_editor.html:50-78` | the Distribution card markup |

## What must not change

- **The published-only gate.** A draft must never leave the building; the 409 at `:319-323` stays.
- **Server-side text composition.** `buildMessageText` (`:179-198`) stays the only source of the
  words. The browser must never be able to choose what is sent to a phone number under Macavation's
  name — that is why the function composes the text rather than accepting it.
- **The two-phase audit.** `begin_report_delivery` before the gateway call, `complete_report_delivery`
  after, so a crash leaves a visible `pending` row rather than a lost attempt.
- **`MAX_RECIPIENTS = 25`** and the existing validation allowlist.
- **The three regexes named above.**

## ⚠ Correction — how this repo's RPCs actually return (read before writing any call)

An earlier revision of this plan stated these contracts wrongly. **These are the real ones,
read out of `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`.**

**Every RPC in this family returns an envelope, not a bare value, and never throws for a business
failure.** `RETURNS TABLE (success int, error text, …)`. Over PostgREST that arrives as an **array of
rows** — so read `data[0]`, check `success === 1`, and treat `error` as the message to surface or log.
A `success: 0` is a normal response with HTTP 200, not an exception. Code that only try/catches will
sail straight past a refusal.

## FIXED contracts — implement against these exactly

**`recipient_last_inbound_at(p_phone text) → timestamptz`** — the most recent inbound WhatsApp
message from that number, or `null` if never. Accepts `+27…`.

**`mint_report_link_code(p_report_instance_id uuid, p_ttl_days int) → text`** — returns a short
URL-safe code (`^[A-Za-z0-9_-]{8,64}$`) resolvable by `wa-reports-04-report-link-redirect.md`'s
endpoint. Calling it twice for the same report returns a **new** code; mint once per send, not once
per recipient.

**`begin_report_delivery(...)`** → `TABLE (success int, error text, id uuid)` — the existing function,
with four parameters appended. **Its real order and names are**
`p_report_instance_id, p_phone, p_display_name, p_recipient_id, p_message_body, p_pdf_storage_bucket,
p_pdf_storage_path, p_link_expires_at, p_actor_user_id` and then the new
`p_report_kind DEFAULT 'weekly', p_report_date DEFAULT NULL, p_message_kind DEFAULT 'text',
p_template_name DEFAULT NULL`.

**The existing call in this file already passes the first nine correctly — leave those exactly as they
are** and add only the new named arguments. Pass `p_report_kind` as `'weekly'` or `'monthly'` from the
report's period type, `p_report_date => null`, and `p_message_kind` as `'text'` or `'template'`.

**`complete_report_delivery(p_delivery_id uuid, p_status text, p_external_message_id text DEFAULT NULL, p_error text DEFAULT NULL, p_message_body text DEFAULT NULL)`**
→ `TABLE (success int, error text)`. Only `p_message_body` is new.

**`list_report_deliveries(p_report_instance_id uuid)`** → the existing
`TABLE (success, error, id, recipient_id, phone, display_name, channel, status, external_message_id,
delivery_error, sent_by, sent_by_name, created_at, completed_at, link_expires_at)`, now with
`message_kind` appended as a final column. ⚠ Note the delivery's own error arrives as
**`delivery_error`**, not `error` — `error` is the envelope's field. The existing verifier already
asserts these are not conflated; keep it that way.

## The template — shape fixed by Meta approval

`macavation_report_published`, language `en`. Three body parameters in this order:

| # | Value |
|---|---|
| 1 | period label, e.g. `Week ending 23 Aug 2026` |
| 2 | report name, e.g. `Sales & Production report` |
| 3 | published date, e.g. `24 Aug 2026` |

Two buttons, both baked into the approved template:

- button index `0` — quick reply `Read summary`, payload `READ_SUMMARY`. **Send no component for
  it**; a quick-reply button in a template needs no parameter.
- button index `1` — URL `Open report`, base URL ending `/r/{{1}}`. Send **one** component:
  `{ type:'button', sub_type:'url', index:'1', parameters:[{ type:'text', text: linkCode }] }`.

⚠ **The URL parameter is the bare code and nothing else.** Not a full URL, not a leading slash. Plan
01's builder throws on a value starting `http`, and Control Room rejects it too — this is Meta error
100/2388052 and it is the single most common mistake with template URL buttons.

Body parameters cannot contain a newline, a tab, or four or more consecutive spaces. All three above
are short single-line strings, so no flattening is needed — but do not add the executive summary to
them. **The summary is deliberately not in the template**: it is prose with line breaks, and it
arrives as ordinary text after the recipient taps `Read summary` (handled by
`wa-reports-03-inbound-buttons.md`, whose `READ_SUMMARY` handler is out of scope here).

## Work

### 1. `supabase/functions/send-report-whatsapp/index.ts`

Add a `WINDOW_HOURS = 24` constant with a comment explaining what it is and why it is not
configurable.

Before the per-recipient loop, mint the link code **once**:
`const linkCode = await rpc('mint_report_link_code', { p_report_instance_id, p_ttl_days: 30 })`.
Keep the existing storage upload and `record_report_pdf_storage` call exactly as they are — the
object still has to exist for the code to resolve to it.

Inside the loop, per recipient:

1. `recipient_last_inbound_at(phone)`.
2. `insideWindow = lastInbound !== null && (Date.now() - Date.parse(lastInbound)) < WINDOW_HOURS * 3600_000`.
3. `begin_report_delivery(..., p_message_kind: insideWindow ? 'text' : 'template', p_template_name: insideWindow ? null : 'macavation_report_published')`.
4. **Inside the window** — send exactly what is sent today, via the existing inline sender and
   existing `buildMessageText`. Do not alter the text path's wording or its signed-URL behaviour in
   this plan.
5. **Outside the window** — `sendTemplate(phone, 'macavation_report_published', 'en', components)`
   with the body component and the one URL-button component.
6. `complete_report_delivery(...)` with the gateway's error text **verbatim** on failure, and a
   plain-text rendering of what was actually sent as `p_message_body`.

If `recipient_last_inbound_at` itself errors, **treat it as outside the window** and send the
template. The template reaches people in both states; free text reaches only one. Failing to the
safer branch means a transient database error degrades to "everyone gets the fixed format", not
"nobody gets anything". Log it.

Extend the response's `results[]` with `message_kind` per recipient. Keep returning 200 with
`sent`/`failed` counts even when everything failed (`:516-527`).

### 2. `WebPortal/modules/sales-reports/js/report-whatsapp-history.js`

Add a **Sent as** column to the Distribution table, rendering `message_kind` as `Full note` for
`text` and `Fixed format` for `template`, and an em dash when absent (rows written before this
change). Pete needs this: a shareholder saying "I only got a short one" should be answerable at a
glance.

Do not change which rows "Re-send all failed" selects (`:306`, `status ∈ {failed, pending}`) — a
successful template send is not a failure needing a retry.

⚠ `WebPortal/js/appRouter.js` is **read-only for this plan** — another plan in this batch edits it,
so a change here would be a merge conflict. You are reading it only for the fact below.

⚠ `data-action-perm` is swept once over static markup (`WebPortal/js/appRouter.js:253-256`) and is
**inert on rows rendered afterwards**. This table is rendered dynamically, so if you gate anything new
in it, call `hasAction()` inline. Do not rely on the attribute.

### 3. `WebPortal/modules/sales-reports/html/report_editor.html`

Add the **Sent as** header cell to the Distribution card table so the column has a heading. Nothing
else on this page changes.

### 4. `scripts/verify-report-whatsapp-history.mjs`

Extend the existing (already-registered) verifier — do **not** add a new npm script, so
`package.json` is untouched by this plan. Add assertions that:

- `message_kind: 'text'` renders `Full note` and `'template'` renders `Fixed format`
- a row with `message_kind` absent renders the em dash and does not render `undefined`
- `pending` is still classified incomplete and the resend preselect still excludes `sent`
  (the existing assertions must keep passing)

## Out of scope

No migrations, no RBAC, no template submission, no deployment. No change to the text path's wording.
No `READ_SUMMARY` handler — that lives in plan 03. No change to the daily sender.

## Verification

- `npm run report-whatsapp-history:verify` passes with the new assertions.
- `npm run report-whatsapp-payload:verify` passes — proof the three regexes are untouched. Confirm
  with `git diff` that no line containing `UUID_RE`, `FILENAME_RE` or `BASE64_RE` appears in it.
- `npm run test:fleet` passes.
- `git diff --stat` shows `package.json` unchanged.
- Trace both branches and confirm each writes exactly one `begin_report_delivery` and one
  `complete_report_delivery`, and that the published-only 409 still precedes everything.
- Confirm the link code is minted once per send, not once per recipient.
- Confirm the URL-button parameter is the bare code, and that nothing prefixes it with a scheme or a
  slash.

State in your report that the function is authored but not redeployed, and that the RPCs and the
approved template are not yet in place — so on merge the template branch cannot succeed yet, and that
is expected.
