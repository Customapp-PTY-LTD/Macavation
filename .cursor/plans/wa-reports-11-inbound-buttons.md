# WhatsApp reports — answer button taps and the list menu

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

The daily production report arrives with three tappable buttons, and the third opens a nine-row list
menu. This plan makes those taps do something. Today a reply to Macavation's WhatsApp gets silence:
`COMMAND_HANDLERS` in `supabase/functions/whatsapp-inbound/index.ts:445-453` holds only `HELP`,
`YES` and `NO`, and `STAGED_COMMAND_HANDLERS` (`:341-344`) is an empty map.

**Why buttons rather than typed words.** A tap is one action with no spelling to get wrong, and — the
part that matters technically — **a tap is an inbound message, which opens Meta's 24-hour window**.
So every answer this plan sends is ordinary free text. No template, no approval, no restriction on
wording. That is the whole reason the design works.

`_shared/wa-inbound.ts` (`extractMessage`) and `_shared/wa-send.ts` (`sendText`, `sendButtons`,
`sendList`) are merged on `dev`. **Use them.** Note especially that
`extractMessage` folds a template quick-reply tap (`type:'button'`, payload in `msg.button.payload`)
into the same `kind:'button_reply'` as an interactive button tap — so one handler covers both.

**Everything here is read-only.** No handler writes production data, edits a report, or sends
anything to a third party. The only writes are a recipient's own subscription state (pause/stop). A
handset is too easy to pick up for anything more, and that limit is deliberate — do not add a
"capture today's figures" command even if it looks like an obvious next step.

**You cannot deploy or reach a database.** Author files only. A human redeploys with
`supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`.
The `--no-verify-jwt` matters — this function authenticates by HMAC, not JWT.

**The RPCs below do not exist yet** when this merges; a human applies those migrations out of band.
Nothing reaches these handlers until that is done and the function is redeployed. Do not add
fallbacks.

## Read first

| File | Why |
|---|---|
| `supabase/functions/whatsapp-inbound/index.ts:242-658` | the existing router — extend it, do not rewrite it |
| `:445-453` | `COMMAND_HANDLERS`, where the new entries go |
| `:258-266` | `whatsapp_log_command` is already called on **every** attempt including refusals — you get the audit trail for free |
| `:570` | `whatsapp_resolve_staff_user` — the existing staff lookup |
| `:596-602`, `:484-547` | enrolment-code path; leave it working |
| `:799-803` | commands never dispatch from `statuses[]` — an infinite-loop guard. Keep it. |
| `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72` | `chat_normalize_phone` returns **bare digits**, no `+` |
| `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:46` | `report_normalize_wa_phone` returns **`+27…`** |

## The phone-format trap — read before writing any lookup

Two normalisers coexist in this system and they disagree by design:

- inbound resolution uses `chat_normalize_phone` → **bare digits** (`27821234567`)
- the recipient roster is keyed on `report_normalize_wa_phone` → **`+27…`** (`+27821234567`)

A lookup that passes the inbound `from` straight to a roster query **matches nobody, silently**. It
will look like the person is not on the list. Use the bridging RPC below, which canonicalises before
matching, and do not hand-roll the conversion.

## FIXED contracts — implement against these exactly

**`report_recipient_by_inbound_phone(p_phone text) → jsonb`** — accepts any format including bare
inbound digits.

```json
{
  "found": true, "recipient_id": "…", "display_name": "Pete", "phone": "+27821234567",
  "is_staff": true, "user_id": "…", "subscribed_daily": true, "muted_until": null
}
```

`{"found": false}` when the number is on no list.

**`set_report_subscription_by_phone(p_phone text, p_report_kind text, p_is_active boolean, p_muted_until date) → jsonb`**
→ `{"ok": true, "display_name": "Pete"}`. Used for pause and stop.

**Read RPCs, each returning `jsonb`:**

| RPC | Returns |
|---|---|
| `get_daily_production_report(p_date date default null)` | as specified in plan 02 |
| `get_period_production_summary(p_kind text)` | `p_kind` is `'week'` or `'month'`; `{ label, cracked_kg, target_kg, pct_of_target, days_left, kernel_sales_zar, oil_sales_zar }` |
| `get_kernel_stock_summary()` | `{ label, lines: [{ style, kg }], total_kg }` |
| `get_open_alerts_summary()` | `{ count, lines: [{ severity, text }] }` |
| `get_latest_published_report_for_phone(p_phone text)` | `{ found, period_label, published_at, link_code }` |

## Work

All changes are inside `supabase/functions/whatsapp-inbound/index.ts`. Replace its inline
`sendWhatsappText` (`:195-236`) with `sendText` from `_shared/wa-send.ts`, and route inbound parsing
through `extractMessage` from `_shared/wa-inbound.ts`, keeping the existing HMAC check, the `wamid`
dedupe and the `statuses[]` guard exactly as they are.

### 1. Dispatch on the normalised message kind

- `kind:'button_reply'` and `kind:'list_reply'` → look up `replyId` in a new `ACTION_HANDLERS` map.
- `kind:'text'` → keep the existing uppercase-word path, and additionally map a small set of typed
  words onto the same handlers, so somebody who prefers typing is not blocked: `TODAY`/`FIGURES` →
  `TODAY`, `WEEK` → `WEEK_TO_DATE`, `MONTH` → `MONTH_TO_DATE`, `STOCK`, `ALERTS`, `REPORT`, `MENU`,
  `STOP`, `START`, and `MUTE <n>`. Keep `HELP`, `YES` and `NO` working.
- `kind:'status'` and `kind:'unsupported'` → ignore, return 2xx.

### 2. The action handlers

Action ids are the button payloads and list row ids. These strings are **fixed** — the template's
buttons were approved with them and cannot change without re-approval:

| Action id | Source | Behaviour |
|---|---|---|
| `WEEK_TO_DATE` | daily template button, menu row | `get_period_production_summary('week')` |
| `FULL_BREAKDOWN` | daily template button | `get_daily_production_report(null)` — every captured line |
| `MENU` | daily template button, follow-up button | send the list menu (below) |
| `TODAY` | menu row | `get_daily_production_report(null)` — headline figures |
| `YESTERDAY` | menu row | same, for `report_sast_today() - 1` |
| `MONTH_TO_DATE` | menu row | `get_period_production_summary('month')` |
| `STOCK` | menu row | `get_kernel_stock_summary()` |
| `ALERTS` | menu row | `get_open_alerts_summary()` |
| `REPORT` | menu row | `get_latest_published_report_for_phone(phone)` |
| `MUTE_7` | menu row | `set_report_subscription_by_phone(phone,'daily',true,<today+7>)` |
| `STOP` | menu row | `set_report_subscription_by_phone(phone,'daily',false,null)` |
| `START` | typed only | re-activate |
| `HELP` | existing | short text plus a `MENU` button |

### 3. Authorisation — two tiers, deny by default

Resolve the caller **once** per inbound message with `report_recipient_by_inbound_phone`.

- **Staff only** (`is_staff === true`): `TODAY`, `YESTERDAY`, `WEEK_TO_DATE`, `MONTH_TO_DATE`,
  `FULL_BREAKDOWN`, `STOCK`, `ALERTS`. A non-staff recipient gets a courteous decline — *"Those
  figures are not available on this number."* — **not** a silent drop and not the figures.
- **Anyone `found`**: `MENU`, `HELP`, `REPORT`, `MUTE_7`, `STOP`, `START`.
- **`found: false`**: leave the existing behaviour for unenrolled numbers untouched, including the
  bare six-digit enrolment-code path at `:596-602`. Do not start answering strangers.

`REPORT` has one extra rule: it re-sends a link **only** where `get_latest_published_report_for_phone`
reports `found: true`, which is true only for a report that phone already received. It never grants
access to something they were not sent. If `found` is false, say the report is not available for that
number.

### 4. The list menu

`sendList(phone, 'What would you like?', 'Macavation menu', sections)` with four sections and nine
rows, in this order:

| Section | Rows (`id` → `title`) |
|---|---|
| Production | `TODAY` → Today's production · `YESTERDAY` → Yesterday · `WEEK_TO_DATE` → Week to date · `MONTH_TO_DATE` → Month to date |
| Stock and alerts | `STOCK` → Kernel stock on hand · `ALERTS` → Open alerts |
| Reports | `REPORT` → Latest report link |
| These messages | `MUTE_7` → Pause for 7 days · `STOP` → Stop daily messages |

Every title is within Meta's 24-character cap and nine rows is within the 10-row cap — plan 01's
builder throws if either is breached, so do not add your own truncation. **Build the menu for a
non-staff recipient too, but omit the Production and Stock sections**, leaving Reports and These
messages. Showing somebody a menu whose every row then refuses them is worse than a shorter menu.

### 5. Follow-up buttons on each answer

Every figures answer ends with `sendButtons` carrying at most three: a sensible next step, then
`MENU`. For example the `WEEK_TO_DATE` answer offers `MONTH_TO_DATE`, `STOCK`, `MENU`. Labels are 20
characters maximum. Two sends per answer (text then buttons) is acceptable — or one `sendButtons`
whose body text *is* the answer, which is neater; either is fine, but be consistent.

### 6. Message formatting

Answers are free text, so real line breaks are allowed and encouraged — unlike the template. Keep
each answer under about 12 lines. Thousands separated, one decimal on percentages, `not captured` for
a null figure, never `0` for a null. Currency as `R 1 240 500`.

## Out of scope

No migrations, no RBAC, no deployment. No write commands of any kind beyond the recipient's own
pause/stop. No WhatsApp Flows. No new verifier in `package.json` — plan 01's covers the message
shapes; this plan's own correctness is verified by inspection below.

## Verification

- Every action id in `ACTION_HANDLERS` matches the fixed table above, character for character.
  A typo here is invisible at build time and dead on a handset.
- The staff gate is deny-by-default: trace a `found:false` and an `is_staff:false` caller through
  each of the seven staff actions and confirm neither reaches a figure.
- No handler writes production data. Grep your own diff for the write RPCs used elsewhere in this
  repo (`upsert_`, `override_`, `set_report_section`, `publish_`) and confirm none appear.
- `extractMessage`'s `type:'button'` branch is what carries the template taps — confirm the router
  reaches `ACTION_HANDLERS` for that kind, not just for `interactive`.
- The `statuses[]` guard at `:799-803` and the `wamid` dedupe are still in place, so a delivery
  receipt can never dispatch a command.
- `npm run test:fleet` passes.

State in your report that the function is **authored but not redeployed**, and that the RPCs are not
yet applied.
