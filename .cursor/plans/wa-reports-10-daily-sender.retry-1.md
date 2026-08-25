---
retry_of: a6a02193-1c70-469e-9f44-ce8ca0ecb4ac
---

# WhatsApp reports — the 17:00 daily production sender

## ⚠ Read this first — what is already true in the repo

Everything this plan builds on is already merged on `dev`. In particular:

1. **`supabase/functions/_shared/wa-send.ts` exports the non-text senders.** `sendText` (line 331),
   `sendButtons` (344), `sendList` (354), `sendTemplate` (376), with `WaSendResult` at line 286.
   `scripts/verify-wa-plumbing.mjs:821-829` asserts they exist and that there is exactly one
   `await fetch(` and exactly four `return sendViaControlRoom(body);` in that file.
2. **The stale "TEXT ONLY / unconfirmed external contract" prohibition is superseded.** The
   provenance is recorded in the `wa-send.ts` header (`CONFIRMED FROM SOURCE 2026-08-25`):
   `meta-proxy`'s `shapeMetaContent` forwards `template` as-is and passes `interactive` through
   unchanged.

**This plan depends on no other plan.** It authors exactly two new files and edits nothing else.

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

All four go through one private signing path. **Do not edit `_shared/wa-send.ts`,
`_shared/wa-limits.ts`, `_shared/wa-inbound.ts`, or any existing edge function.** `verify-wa-plumbing.mjs`
asserts substrings and exact occurrence counts in those files; touching them turns
`npm run test:fleet` red for reasons that have nothing to do with this deliverable.

`sendTemplate` throws `WaSendError` only for a url-button parameter that is a full URL
(`wa-send.ts:169-198`). This function sends a **body component only**, so that path is unreachable
here — but the per-recipient `try` still catches it, as it catches everything else.

Also available and already merged — do not re-implement any of these: `buildTextBody`,
`buildButtonsBody`, `buildListBody`, `buildTemplateBody`, `buildReplyId`, `parseReplyId`,
`toWaPhone`, `hmacSha256Hex` (`_shared/wa-send.ts`); `MAX_BUTTONS`, `MAX_BUTTON_CTA`,
`MAX_LIST_ROWS`, `MAX_LIST_TITLE`, `MAX_LIST_SECTION`, `truncate`, `paginateRows`
(`_shared/wa-limits.ts`); `extractMessage`, `classifyMessage`, `verifyControlRoomSignature`,
`parseSignatureHeader`, `timingSafeEqual`, `sanitizeSenderName` (`_shared/wa-inbound.ts`).

**Why `sendTemplate` and not `sendButtons`/`sendList`.** Meta's 24-hour customer-service window is
real: interactive sends only reach somebody who has messaged in the last 24 hours — the gateway
accepts them and Meta then drops them, silently. Only an approved template reaches a silent
recipient, which is what an unprompted 17:00 daily is.

### What is yours to do, and what is not

| | |
|---|---|
| You **can** | author files, edit the files this plan names, and run `npm run test:fleet` or any individual `npm run *:verify` |
| You **cannot** | apply a migration, reach a database, deploy a function, run Deno or typecheck TypeScript, use the network, read another repository, or drive a browser |

Consequences:

- **Every database object named below is already applied on `dev`.** Do not write a migration. Do
  not add a fallback that reads tables directly if an RPC looks missing — fail loudly.
- **Do not write a verification step you cannot run.** No "log in and check", no "deploy and send a
  test message", no "query the database to confirm". State those as handover notes for a human, in
  the clearly-labelled section at the end.
- **If you find a genuine contradiction between this plan and the code, stop and say so in your
  report rather than narrowing scope silently.** Contract details in this plan are quoted with file
  and line; if a quote does not match what you read, the code wins — report the mismatch and
  implement against the code.

## Context

Macavation's daily production figures must go out on WhatsApp every afternoon at 17:00 SAST with
nobody in the loop. This plan authors the edge function that does it:
`send-daily-production-report`.

An unprompted WhatsApp message cannot be free text, so the daily goes out as an **approved message
template**, `macavation_daily_production`, carrying seven body parameters and three quick-reply
buttons baked into the approved template. The template is submitted for Meta's approval outside the
fleet; this function only *sends* it, via `sendTemplate`, which uses the ordinary `send_message`
action and needs no credential beyond the forward secret every other send already uses.

**Use `sendTemplate` from `../_shared/wa-send.ts`. Do not build the Control Room payload inline** —
one owner for the envelope and the HMAC is the whole point.

**You cannot deploy this, apply a migration, or reach a database.** Author files only. A human
deploys with
`supabase functions deploy send-daily-production-report --project-ref nmdmddugxclpqrwylyfa`.

## Security — the access gate is part of the deliverable, not an afterthought

`verify_jwt = true` verifies only that the request carries **a** valid project JWT. It does **not**
prove the caller holds the service-role key. This repo commits its anon-key JWTs in source:
`WebPortal/js/macavation-supabase.js:16` (prod) and `:22` (dev). Anyone who reads the site's
JavaScript therefore holds a token that satisfies `verify_jwt`.

That matters because this function runs as **service-role**, and it reads two RPCs the database
deliberately revokes from `anon`/`authenticated`:

- `get_daily_production_report` — `REVOKE` at
  `migrations/20260825091000_daily_production_report.sql:540`, `GRANT ... TO service_role` at `:547`.
- `report_daily_recipients` — `REVOKE` at
  `migrations/20260825090000_report_subscriptions_and_staff.sql:398`, `GRANT ... TO service_role`
  at `:401`.

Without a real gate, `{"dry_run": true}` hands an anonymous caller the production figures **and the
confidential recipient roster**, `{"force": true}` lets them fire unlimited billable template sends
to that roster, and `{"date": "..."}` lets them choose which day's figures get broadcast.

**Mandatory gate — implement exactly this, do not substitute an alternative and do not add a second
one:**

- Read the bearer token: `(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()`.
- Read the expected value: `(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim()`.
- **If either is empty, return 401 — never treat an empty secret or an empty header as a match.**
  This guard is not optional: `timingSafeEqual` (`_shared/wa-inbound.ts:32-42`) computes
  `diff = ab.length ^ bb.length` and returns `true` for two empty strings, so an unset env var would
  otherwise open the endpoint to a caller sending an empty bearer.
- Only when both are non-empty, compare with `timingSafeEqual(provided, expected)` imported from
  `../_shared/wa-inbound.ts`. Mismatch → 401 `{ success: false, error: 'Service key required.' }`.
- Run this gate **before** parsing the body, before any RPC, and before any send — i.e. immediately
  after the `OPTIONS` short-circuit and the method check.
- Never log, echo or include the bearer token, the service-role key, or any Control Room secret in
  a response body or a `console` call.
- Never hardcode any key literal in the source (`BluePrint/secrets-management-rules.md`): both
  values come from the request header and `Deno.env` respectively.

Model: `portal-assistant/index.ts:180-186` (`hasIngestServiceKey`) for the header-shaped
shared-secret gate, and `send-report-whatsapp/index.ts:14-24` for why a gate is required at all —
that header comment states the same threat in this repo's own words.

## RPC return shapes — read this before writing any call

There is **no** blanket rule here. Some of these RPCs return an envelope table and some return a
bare value. Handle each exactly as listed:

| RPC | Returns | How to read it |
|---|---|---|
| `report_sast_today()` | `date` (`20260825090000_...sql:49-55`) | `data` is a `'YYYY-MM-DD'` string. No envelope. |
| `reseed_data_production_daily(...)` | `TABLE (success integer, error text, rows_reseeded integer)` (`20260819090000_data_page_production_daily.sql:228-233`) | **Envelope.** Read `rows[0]`, require `success === 1`. |
| `get_daily_production_report(p_date)` | `jsonb` (`20260825091000_...sql:293-294`) | A single JSON object. No envelope, no `data[0]`. |
| `report_daily_recipients()` | `TABLE (recipient_id, display_name, phone, is_staff)` (`20260825090000_...sql:260-266`) | An array of rows with **no** `success`/`error` columns. Empty array = nobody subscribed. |
| `daily_report_already_sent(p_date)` | `boolean` (`20260825091000_...sql:279-280`) | A bare boolean. No envelope. |
| `begin_report_delivery(...)` | `TABLE (success int, error text, id uuid)` (`20260825091000_...sql:114-129`) | **Envelope.** |
| `complete_report_delivery(...)` | `TABLE (success int, error text)` (`20260825091000_...sql:183-190`) | **Envelope.** |

Write **one** array-normalising helper, modelled on `send-report-whatsapp/index.ts:83-89`:

```ts
async function rpcRows(sb: SupabaseClient, fn: string, params: Record<string, unknown> = {}): Promise<AnyRow[]> {
  const { data, error } = await sb.rpc(fn, params);
  if (error) throw new Error(`[rpc:${fn}] ${error.message}`);
  if (Array.isArray(data)) return data as AnyRow[];
  if (data && typeof data === 'object') return [data as AnyRow];
  return [];
}
```

**`rpcRows` is for the four TABLE-returning RPCs only** — `reseed_data_production_daily`,
`report_daily_recipients`, `begin_report_delivery`, `complete_report_delivery`. Call
`report_sast_today`, `get_daily_production_report` and `daily_report_already_sent` through
`sb.rpc(...)` directly and read `data` as-is. Routing a bare boolean through `rpcRows` collapses
`true` and `false` to the same `[]` — the exact trap documented at
`send-report-whatsapp/index.ts:118-125` for `has_action`. Do not repeat it.

An envelope `success: 0` arrives as an ordinary **HTTP 200**. Code that only `try`/`catch`es sails
straight past a refusal. Check `rows[0]?.success !== 1` explicitly everywhere the table above says
"Envelope".

## FIXED contracts — implement against these exactly

Sources: `migrations/20260825091000_daily_production_report.sql` (begin/complete/
`get_daily_production_report`/`daily_report_already_sent`),
`migrations/20260825090000_report_subscriptions_and_staff.sql` (`report_sast_today`,
`report_daily_recipients`), `migrations/20260819090000_data_page_production_daily.sql`
(`reseed_data_production_daily`). The older 9-argument `begin_report_delivery` in
`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql` is **superseded** — it is
dropped and recreated at `20260825091000_...sql:111-129`. Do not implement against the 9-argument
form.

**`report_sast_today() → date`** — today in `Africa/Johannesburg`.

**`reseed_data_production_daily(p_date_from date, p_date_to date, p_actor_user_id uuid DEFAULT NULL)`**
→ `TABLE (success integer, error text, rows_reseeded integer)`
(`20260819090000_data_page_production_daily.sql:228-233`). Refreshes the factory mirror columns
only; never overwrites a hand-entered figure (`:266-271`).

⚠ **Call it with exactly these parameter names.** PostgREST dispatches by named argument, so
`{ p_from, p_to, p_actor }` resolves to no function (PGRST202) and the daily would 502 forever.
`p_actor_user_id` is a **uuid** column value — pass `null`. **Never pass a string such as
`'daily_report_job'`**; there is no text actor parameter on this function. The live browser caller
`WebPortal/js/data-functions.js:6527-6533` uses the same three names.

**`get_daily_production_report(p_date date default null) → jsonb`**

```json
{
  "report_date": "2026-08-27",
  "date_label": "Thu 27 Aug 2026",
  "has_production": true,
  "refreshed_at": "2026-08-27T14:58:11+00:00",
  "cracked_kg": 12480.00,
  "sk_packed_kg": 4210.00,
  "wholes_pct": 62.4,
  "nis_kg": 18000.00,
  "week_start": "2026-08-24",
  "week_label": "Mon 24 Aug to Thu 27 Aug",
  "wtd_cracked_kg": 48600.00,
  "wtd_target_kg": 60000.00
}
```

Any numeric field may be `null` (a null is a genuinely uncaptured figure, never a zero).
`has_production` is the authoritative "was there a working day" flag (`20260825091000_...sql:330`) —
trust it rather than re-deriving it from the numbers.

**`report_daily_recipients() → setof (recipient_id uuid, display_name text, phone text, is_staff boolean)`**
— active daily subscribers who are not muted. `phone` is `report_normalize_wa_phone(rr.phone)`
(`20260825090000_...sql:269`), i.e. already `+27…`.

⚠ `report_normalize_wa_phone` **returns NULL** for a stored value with no digits
(`20260822090000_...sql:52-56`), so a returned `phone` may be `null`. Handle that explicitly — see
the loop rules below.

**`daily_report_already_sent(p_date date) → boolean`** — true when a `sent` daily delivery row
already exists for that date.

**`begin_report_delivery(p_report_instance_id uuid, p_phone text, p_display_name text DEFAULT NULL, p_recipient_id uuid DEFAULT NULL, p_message_body text DEFAULT NULL, p_pdf_storage_bucket text DEFAULT NULL, p_pdf_storage_path text DEFAULT NULL, p_link_expires_at timestamptz DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL, p_report_kind text DEFAULT 'weekly', p_report_date date DEFAULT NULL, p_message_kind text DEFAULT 'text', p_template_name text DEFAULT NULL)`**
→ `TABLE (success int, error text, id uuid)`. Note the parameter order and names — `p_phone` is
second, and the actor is `p_actor_user_id`, not `p_sent_by`.

For the daily send pass: `p_report_instance_id: null`, `p_report_kind: 'daily'`,
`p_report_date: <the resolved date>`, `p_message_kind: 'template'`,
`p_template_name: TEMPLATE_NAME`, `p_actor_user_id: null`. Take the delivery id from
`rows[0].id` **after** checking `rows[0].success === 1`.

⚠ `p_report_instance_id` is required for `weekly`/`monthly` and returns
`success: 0, error: 'p_report_instance_id is required.'` when null; the daily kind is relaxed at
`20260825091000_...sql:148-161`. If you ever see that error for a `'daily'` call, the migration has
not been applied — surface it, do not work around it.

**`complete_report_delivery(p_delivery_id uuid, p_status text, p_external_message_id text DEFAULT NULL, p_error text DEFAULT NULL, p_message_body text DEFAULT NULL)`**
→ `TABLE (success int, error text)`. `p_status` is `'sent'` or `'failed'`. The gateway's own message
goes in `p_error` **verbatim**.

## The template — its shape is fixed by Meta approval

`macavation_daily_production`, language `en`. Define it once as
`const TEMPLATE_NAME = 'macavation_daily_production';` and use that identifier for both
`p_template_name` and the `sendTemplate` argument. Seven body parameters, **in this order**:

| # | Value | From |
|---|---|---|
| 1 | date label | `date_label` |
| 2 | cracked kg | `cracked_kg` |
| 3 | kernel packed kg | `sk_packed_kg` |
| 4 | wholes percent | `wholes_pct` |
| 5 | NIS received kg | `nis_kg` |
| 6 | week-to-date cracked kg | `wtd_cracked_kg` |
| 7 | week-to-date target kg | `wtd_target_kg` |

Three quick-reply buttons are baked into the approved template and need **no** component
parameters — send only the `body` component. Their payloads (`WEEK_TO_DATE`, `FULL_BREAKDOWN`,
`MENU`) are handled by a different plan.

**Formatting rules that are not negotiable.** A template body parameter may not contain a newline, a
tab, or four or more consecutive spaces. So each parameter is a single short string:

- one numeric helper, `formatFigure(value: unknown, decimals = 0): string`, used for parameters
  2-7 (`decimals = 1` for `wholes_pct`, `0` for the rest)
- thousands separated by a **non-breaking space** (`'\u00A0'`), not a regular space
- no trailing `kg` (the template's own text carries the unit)
- `null`, `undefined`, or any value where `Number.isFinite(Number(value))` is false → the literal
  string `not captured`. Never `null`, never `0`
- one sanitiser, `sanitizeParam(s: string): string`, applied last to **all seven** parameters
  (including parameter 1, `date_label`)

⚠ `sanitizeParam` must **not** use `\s`. In JavaScript `\s` matches U+00A0, so `replace(/\s+/g, ' ')`
would destroy the non-breaking thousands separator `formatFigure` just inserted. Implement it with
explicit characters only, e.g. `s.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()` — the
`{2,}` class contains a literal space, never `\s`.

## Work

### 1. `supabase/functions/send-daily-production-report/config.toml`

```toml
[functions.send-daily-production-report]
verify_jwt = true
```

Comment it accurately, and **only** with what this checkout shows:

- `verify_jwt = true` is defence in depth. It proves the caller presented *some* valid project JWT;
  it does **not** prove the caller holds the service-role key, because this repo's anon-key JWTs are
  committed at `WebPortal/js/macavation-supabase.js:16,22`. The real gate is the service-role bearer
  check in `index.ts` (see the Security section above).
- Do **not** write any comment claiming this endpoint is service-role-only *because of*
  `verify_jwt`, and do **not** claim what other WhatsApp functions are configured as — this repo
  contains per-function `config.toml` files only for `r/` and `portal-assistant/`, and
  `supabase/config.toml` contains no `[functions.*]` table at all, so every other function's setting
  lives in platform state this checkout cannot see. Note in the comment that this file may be
  documentary depending on how the function is deployed, which is a further reason the in-code gate
  is the control that matters.

### 2. `supabase/functions/send-daily-production-report/index.ts`

Doc-comment header in the house style (`send-report-whatsapp/index.ts:1-32`) naming: the deploy
command; the intended schedule (`0 15 * * *` UTC = 17:00 SAST — SAST has no daylight saving, so a
fixed offset is safe year-round); the auth gate and what it does and does not prove; every RPC
called with its return shape; and every env var read (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, plus the `CONTROL_ROOM_*` vars read inside `_shared/wa-send.ts`).

Imports, pinned to what the sibling functions already use — do not pick a different version or CDN:

```ts
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import { sendTemplate, type WaTemplateComponent } from '../_shared/wa-send.ts';
import { timingSafeEqual } from '../_shared/wa-inbound.ts';
```

`POST` only; `OPTIONS` short-circuits to the preflight response; anything else 405. Service client
from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, exactly as `send-report-whatsapp/index.ts:76-80`.

Request body, all optional: `{ date?: 'YYYY-MM-DD', dry_run?: boolean, force?: boolean }`.

Sequence:

0. **Auth gate** (see the Security section) — before body parsing, before any RPC. 401 on failure.
1. **Resolve the date.** `date` if given (validate against `/^\d{4}-\d{2}-\d{2}$/` and 400 otherwise),
   else `report_sast_today()` read as a bare string. Never `new Date()` — the container is UTC and a
   late-evening run would file against the wrong day.
2. **Refresh from the factory**:
   `rpcRows(sb, 'reseed_data_production_daily', { p_date_from: d, p_date_to: d, p_actor_user_id: null })`.
   Return **502** if the call throws *or* if `rows[0]?.success !== 1` (surface `rows[0]?.error`).
   Sending yesterday's snapshot as though it were today's is worse than sending nothing.
3. **Read the figures**: `sb.rpc('get_daily_production_report', { p_date: d })`, `data` is the object.
4. **Suppress guard.** If `has_production` is false, send nothing and return 200 with
   `{ skipped: 'no_production', date: d }`. No Sunday message, no public-holiday message, no "0 kg".
   **`force` never bypasses this guard.**
5. **Idempotency guard.** Unless `force === true`, if `sb.rpc('daily_report_already_sent', { p_date: d })`
   returns `true`, return 200 with `{ skipped: 'already_sent', date: d }`.
6. **Recipients**: `rpcRows(sb, 'report_daily_recipients')`. Empty array → 200 with
   `{ skipped: 'no_recipients', date: d }`. Cap at 25 and, if the list is longer, `console.warn` the
   number dropped — a silently truncated recipient list reads as a successful send.
7. **Compose the parameters once**: `const params = buildTemplateParams(report);` returning the seven
   sanitised strings in the documented order. Both the `dry_run` response and the send loop use this
   same array — do not compose them twice.
8. **`dry_run === true`** → return 200 with the resolved date, `params` in order, and the recipient
   list (display name and phone), **having sent nothing and having written no delivery row**. This is
   how a human proves the message before it is ever scheduled.
9. **Send, one recipient at a time, sequentially** (not `Promise.all` — a burst looks like spam to
   Meta and makes a partial failure hard to read). The body component:

   ```ts
   const bodyComponent: WaTemplateComponent = {
     type: 'body',
     parameters: params.map((text) => ({ type: 'text' as const, text })),
   };
   ```

   Per recipient, inside a `try`/`catch` that can never abort the loop (model:
   `send-report-whatsapp/index.ts:376-513`):
   - If `phone` is null, undefined or blank, push a `failed` result with
     `error: 'Recipient has no usable phone number.'`, **write no delivery row**, and `continue`.
     `report_daily_recipients` can return a null phone (see the contract note above).
   - Pass `phone` through **verbatim** to both `begin_report_delivery` and `sendTemplate`. It is
     already canonical `+27…`. **Do not** write a `normalizePhone` copy, and do not call `toWaPhone`
     (it throws `WaSendError` on digit-free input, `wa-send.ts:261-267`) — see the blast-radius note
     below for why a new normaliser copy also breaks the test suite.
   - `begin_report_delivery(...)` → if `rows[0]?.success !== 1`, push a `failed` result carrying
     `rows[0]?.error || 'Could not start delivery.'`, **write no `complete_report_delivery`** (there
     is no delivery id to complete), and `continue`. This mirrors
     `send-report-whatsapp/index.ts:412-425`.
   - Otherwise `const deliveryId = rows[0].id;` then
     `const result = await sendTemplate(phone, TEMPLATE_NAME, 'en', [bodyComponent]);`
   - Then exactly one `complete_report_delivery(deliveryId, result.ok ? 'sent' : 'failed', result.wamid, result.error, renderedBodyText)`.
     `renderedBodyText` is a plain-text audit rendering of what was sent, built from `params`; it is
     **never** passed to `sendTemplate` and is not subject to the template parameter rules.
   - If `complete_report_delivery` throws or returns `success !== 1`, `console.error`/`console.warn`
     it and carry on — a failed audit write must not abort the loop or flip the send's own outcome.
10. **Response**: 200 with
    `{ date, sent, failed, results: [{ phone, display_name, status, external_message_id, error }] }`.

Return **200 even when every send failed**, matching `send-report-whatsapp/index.ts:515-527`, and put
the truth in `sent`/`failed`. The 401 (auth), 400 (bad `date`) and 502 (reseed) paths above are the
only non-200s.

Identifier discipline: `TEMPLATE_NAME`, `rpcRows`, `formatFigure`, `sanitizeParam`,
`buildTemplateParams`, `bodyComponent`, `renderedBodyText`, `deliveryId`. Use exactly these names
wherever this plan refers to them; do not introduce a second name for the same thing.

## Out of scope

No migrations, no RBAC changes, no scheduling, no template submission, no deployment — all handled
outside the fleet. No changes to `whatsapp-inbound` (the buttons are a separate plan). No changes to
`_shared/wa-send.ts`, `_shared/wa-limits.ts`, `_shared/wa-inbound.ts`, `send-report-whatsapp`,
`send-daily-digest-whatsapp`, `send-whatsapp-message`, or any `WebPortal/` file. No new verifier
registered in `package.json`. No new secret invented for the auth gate — the gate uses the
already-provisioned `SUPABASE_SERVICE_ROLE_KEY`.

## Blast radius on the existing test suite — read before writing the loop

`npm run test:fleet` (`package.json:33`) runs `report-whatsapp-parity:verify` among others.
`scripts/verify-report-whatsapp-parity.mjs:326-346` walks every `.ts` under `supabase/functions/` and
every `.js` under `WebPortal/`, collects files containing **both** `replace(/\D/g` and `27`, and
asserts the set is **exactly 6** and `deepEqual` to its INVENTORY + SWEEP_ALLOWLIST. If the new
`index.ts` contains the substring `replace(/\D/g`, that check fails on both the count and the
deepEqual. So: **do not copy `normalizePhone` from `send-report-whatsapp/index.ts:148-153` or from
any other file, and do not write any digit-stripping regex of that form in the new file.** The
phone from `report_daily_recipients` is already canonical; that is the whole reason no normaliser is
needed here.

Also: leave `_shared/*` untouched (`verify-wa-plumbing.mjs` asserts exact substrings and occurrence
counts there), and do not use the word `username` anywhere in the new files
(`scripts/verify-no-username.mjs` walks `supabase/functions/**`).

## Verification (things you can actually do from the fleet)

Verify by inspection and reasoning, and state each finding explicitly in your report:

- The auth gate runs before body parsing and before every RPC; an empty `Authorization` header and an
  empty `SUPABASE_SERVICE_ROLE_KEY` each produce 401 **before** `timingSafeEqual` is reached; no
  branch of `dry_run`, `force` or `date` is reachable without passing it.
- The `reseed_data_production_daily` call uses `p_date_from` / `p_date_to` / `p_actor_user_id`, passes
  `null` for the actor, and checks `rows[0].success === 1` — not just the thrown-error path.
- Each RPC is read according to the shape table: `rpcRows` is used for the four TABLE-returning RPCs
  only, and `report_sast_today` / `get_daily_production_report` / `daily_report_already_sent` are read
  directly from `data`.
- The seven parameters are built in the documented order; each is a single line with no tab and no run
  of four or more regular spaces; `sanitizeParam` nowhere uses `\s`, so the U+00A0 separator survives.
- A `null` figure renders `not captured`, and nowhere renders `0` for a null.
- Both guards return before any send, and `force` bypasses only the idempotency guard — never the
  `has_production` one.
- `dry_run` cannot reach `sendTemplate` and writes no delivery row. Trace the path and confirm it.
- The per-recipient loop cannot be aborted by a single failure, and: **every recipient that obtains a
  delivery id writes exactly one `complete_report_delivery`; a recipient skipped for a missing phone,
  or refused by `begin_report_delivery` (`success !== 1`), writes none and is counted in `failed` with
  the refusal message.** State which branch produces which.
- The new `index.ts` contains no `replace(/\D/g`, and no file outside
  `supabase/functions/send-daily-production-report/` was modified.
- `npm run test:fleet` passes.

## Handover notes for a human (not work of yours, and not to be reported as done)

- Deploy: `supabase functions deploy send-daily-production-report --project-ref nmdmddugxclpqrwylyfa`.
- Confirm the invoker sends `Authorization: Bearer <service-role key>`; the anon key will be rejected
  with 401 by design.
- Before putting it on a timer, POST `{"dry_run": true}` with the service-role key and confirm the
  seven parameters read correctly.
- Then schedule `0 15 * * *` UTC (17:00 SAST).
- Meta's approval of `macavation_daily_production` is tracked outside this repo.

The migrations named in this plan are already applied and the template approval is somebody else's
task — do not describe either as outstanding work of yours. Report the function as **authored but not
deployed and not scheduled**.
