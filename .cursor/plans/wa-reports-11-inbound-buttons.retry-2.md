---
retry_of: 63b077bd-6681-42e7-a4b4-f17316ca2c11
---

# WhatsApp reports — answer button taps and the list menu

## Read this first — the plumbing this plan calls, and where to check it

Everything below is a claim about **this checkout**, with the file and symbol to read it at. Nothing
here asks you to take an external system's behaviour on trust, and nothing here is your
deliverable — it is all already merged.

**Line numbers drift.** Locate every symbol below **by name** (grep for it) and re-read it before
you write a call against it. Where this plan gives a line number it is a hint, not an assertion; if
the symbol is not there, find it by name and carry on. Do not "fix" this plan's line numbers as a
deliverable.

### 1. The four senders exist. Read them, then call them.

`supabase/functions/_shared/wa-send.ts` exports all four. Confirm by reading them before you write a
call — do not take the signatures from this plan alone:

| Export | Approx. line |
|---|---|
| `sendText(to, text)` | `_shared/wa-send.ts:332` |
| `sendButtons(to, bodyText, buttons)` | `_shared/wa-send.ts:345` |
| `sendList(to, bodyText, buttonLabel, sections)` | `_shared/wa-send.ts:355` |
| `sendTemplate(to, templateName, languageCode, components?)` | `_shared/wa-send.ts:377` |

All four delegate to the one private `sendViaControlRoom` (`~:296`), which is the only `fetch` and
the only HMAC in the file. **Keep it that way** — do not add a second send path.

The exported types they take (`WaSendResult`, `WaButton`, `WaListRow`, `WaListSection`,
`WaTemplateComponent`) are declared at `_shared/wa-send.ts:78-88`. Read them there rather than
inferring the shapes. Note especially that **`WaSendResult` is `{ ok, wamid, error }` — an object,
always truthy.** See deliverable 0 below: this is a real trap.

Each **throws `WaSendError`** on a cap breach — more than 3 buttons, more than 10 list rows, a
button title over 20 characters, a list row or section title over 24, or a full URL where a template
url-button parameter belongs. The caps are named constants in `_shared/wa-limits.ts:14-18` and the
throwing checks are in the builders (`buildButtonsBody`, `buildListBody`, `buildTemplateBody`). A
breach is a programming error: do not catch it locally and send a truncated message instead. It is
still contained — see the 2xx rule in §4.

Note also, verified by reading them: `buildButtonsBody` and `buildListBody` do **not** validate that
`bodyText` is non-empty (only `buildTextBody` does). An empty body text would therefore reach the
gateway rather than throwing. Every send you make must carry a non-empty body string — this plan
states that as a constraint in deliverable 4.

Also already present, and not to be re-implemented — read each before writing anything similar:
`buildTextBody`, `buildButtonsBody`, `buildListBody`, `buildTemplateBody`, `buildReplyId`,
`parseReplyId`, `toWaPhone`, `hmacSha256Hex` (`_shared/wa-send.ts`); `MAX_BUTTONS`,
`MAX_BUTTON_CTA`, `MAX_LIST_ROWS`, `MAX_LIST_TITLE`, `MAX_LIST_SECTION`, `MAX_REPLY_ID`, `truncate`,
`paginateRows` (`_shared/wa-limits.ts`); `extractMessage`, `classifyMessage`,
`verifyControlRoomSignature`, `parseSignatureHeader`, `timingSafeEqual`, `sanitizeSenderName`
(`_shared/wa-inbound.ts`).

### 1b. The daily sender ALREADY EXISTS in this checkout — read it before you write a word about it

`supabase/functions/send-daily-production-report/index.ts` is present (~398 lines). Verified facts
about it, which you must not contradict in any comment, code or report you write:

- It declares `TEMPLATE_NAME = 'macavation_daily_production'` and sends via `sendTemplate(phone,
  TEMPLATE_NAME, 'en', [bodyComponent])`.
- The **only** component it passes is `{ type: 'body', parameters: [...7 text params...] }`. It
  attaches **no button components at all** (`sub_type: 'quick_reply'` appears nowhere in
  `supabase/functions/`).
- The string `macavation_daily_production` appears in exactly one file in this repo — that sender.
  **There is no template definition in this checkout**, so nothing here records whether the approved
  template carries quick-reply buttons, or what payloads they would send. Template button
  definitions live in Meta's template approval, which this checkout cannot see and you cannot reach.

Consequences, and they are binding:

- **Do not write, in code or in your report, that this function or this template does not exist.**
- **Do not edit `send-daily-production-report/index.ts`** — it is out of scope (see Out of scope).
- Whether a tap ever arrives at all is **not knowable from here**. Write nothing that asserts it
  does or does not. This plan builds the answering side either way; the typed-word path (§3B) works
  regardless of whether the template ever grows buttons.

### 2. Two inbound helpers exist and they are NOT interchangeable

Read `_shared/wa-inbound.ts` before writing a line of the router.

- **`classifyMessage(msg, senderName)`** (`~:120`) is a PURE, PER-MESSAGE classifier. It takes one
  element of `value.messages[]` and returns `text` / `button_reply` / `list_reply` / `unsupported`.
  It never returns `status`. **This is the helper this plan uses.**
- **`extractMessage(payload)`** (`~:182`) is a whole-envelope convenience wrapper that reads **only**
  `entry[0].changes[0].value` and **only** `messages[0]`, and collapses any receipt to a bare
  `{ kind: 'status' }` carrying no wamid and no status value. **Do not use it in this plan, at all.**

Why this matters, verified in `supabase/functions/whatsapp-inbound/index.ts` (find the symbols by
name; approximate lines given): the live handler loops **every** `entry` → `changes` → `messages`
(`~:748-817`) calling `chat_ingest_inbound_whatsapp` per message, and separately loops
`value.statuses[]` (`~:822-851`) calling `chat_record_whatsapp_status`. Routing that through
`extractMessage` would drop every message after the first in a batched webhook and stop recording
delivery receipts entirely. It would also destroy the dedupe: the only dedupe signal is
`row.deduped` from `chat_ingest_inbound_whatsapp` (`~:806`), which `extractMessage` has no access
to, and losing it means a redelivered wamid re-runs a write action such as pause or stop. The file
header (`:54-58`) records that Control Room **never retries** — anything dropped here is gone
forever.

### 3. The gateway contract, and the limit of what you can check

The non-text wire shapes were settled outside this checkout, by reading Control Room's deployed
`meta-proxy` source. **That is not something you can verify from here, and this plan does not ask
you to.** The claim, its provenance and its date are recorded in the file that makes the call, at
**`supabase/functions/_shared/wa-send.ts:21-47`** — labelled `CONFIRMED FROM SOURCE 2026-08-25`.

- **Correctness of the wire shape is not in your scope.** You call the senders; you do not
  re-derive, re-verify, restate, or re-label that contract.
- **Do not copy the contract into a new comment, doc or plan of your own.** If you need to refer to
  it, cite `_shared/wa-send.ts:21-47`.
- **Do not hand-roll a payload** to work around it. If something about the contract looks wrong,
  that is a finding to report, not something to patch around (see §6).
- The prohibition that used to sit in `whatsapp-inbound/index.ts` is now a `⚠ SUPERSEDED` note at
  `:186-197`. Read it. The constraint that survived: new non-text sends go through
  `_shared/wa-send.ts`, **not** by widening that file's local text-only `sendWhatsappText`.

### 4. What is yours to do, what is not, and the two invariants you may not break

| | |
|---|---|
| You **can** | author files, edit files, and run `npm run test:fleet` or any individual `npm run *:verify` |
| You **cannot** | apply a migration, reach a database, deploy a function, run Deno or typecheck TypeScript, use the network, read another repository, or drive a browser |

**Database objects — what is actually checkable from here.** The migration files defining every RPC
this plan calls are **committed in this checkout**: `migrations/20260825090000_report_subscriptions_and_staff.sql`
(`report_sast_today`, `report_recipient_by_inbound_phone`, `set_report_subscription_by_phone`),
`migrations/20260825091000_daily_production_report.sql` (`get_daily_production_report`,
`get_period_production_summary`, `get_kernel_stock_summary`, `get_open_alerts_summary`), and
`migrations/20260825092000_report_link_codes.sql` (`get_latest_published_report_for_phone`). Read
their bodies — the response shapes in §"FIXED contracts" below are transcribed from them.

**Whether those migrations have been APPLIED to any environment is not knowable from this
checkout, and this plan does not claim it either way.** Therefore:

- **Do not write a migration.** Do not edit those files.
- **Do not add a fallback that reads tables directly** if an RPC looks missing.
- **Do handle "RPC missing" the way this file already handles it everywhere else**: `isMissingRpc`
  (`whatsapp-inbound/index.ts:168-172`), a `console.error` naming the migration, no reply or a
  neutral "not available right now", and the outer 2xx unaffected. Every existing RPC call site in
  the file follows this pattern — copy it rather than inventing a new one.

**Invariant A — after the signature check, this function always returns 2xx.** Verified: every
return path after HMAC verification is `json(...)` with the default 200 (`~:736`, `~:861`, `~:870`);
only pre-verification paths return 400/401/405/503. The header (`:54-58`) and the schema-missing
return (`~:859-862`) both record why: a non-2xx is dropped forever by Control Room. Nothing you add
may throw out of `Deno.serve`. `processCommandForMessage`'s own try/catch backstop (`~:656-669`) is
what makes "let `WaSendError` throw" safe — it becomes a logged `error` outcome and a 200, not a
lost message. Keep that backstop wrapping everything you add.

**Invariant B — never dispatch a command from `statuses[]`, never from a deduped redelivery.**
The `statuses[]` loop must keep calling only `chat_record_whatsapp_status`, and command dispatch
must stay inside the `else` branch of `if (row.deduped)` in the messages loop (`~:806-816`).

**Do not write a verification step you cannot run.** No "log in and check", no "deploy and send a
test message", no assertion against a deployed environment or live data. Anything needing a human
belongs in your report as a clearly-labelled handover note.

**`npm run test:fleet` is currently green in full.** A red result from your change is a real
failure. Do not dismiss one, and do not relax or delete an existing assertion to get to green — if
an existing assertion genuinely must change, name it as an in-scope deliverable and say why.

### 5. Existing tests your change can break even though it does not mention them

- **`scripts/verify-report-whatsapp-parity.mjs`** sweeps every `.ts` under `supabase/functions/` and
  every `.js` under `WebPortal/` for files containing the substring `replace(/\D/g` **and** the
  substring `27`, and asserts there are **exactly 6** such files, deep-equal to a fixed list
  (`~:326-346`). `whatsapp-inbound/index.ts` already contains `27` (the example number in its
  header) but no digit-stripping idiom, which is why it is not on the list (see that script's
  `:29-31`). **So: never write `replace(/\D/g` into `whatsapp-inbound/index.ts`, and never add that
  file to `INVENTORY` or `SWEEP_ALLOWLIST`.** You have no reason to — every phone canonicalisation
  you need happens inside the RPCs.
- **`scripts/verify-wa-plumbing.mjs`** asserts `wa-send.ts` contains exactly 4 occurrences of
  `return sendViaControlRoom(body);` and exactly 1 `await fetch(` (`~:821-829`). Do not edit
  `wa-send.ts`. Verified for your reassurance: that script reads only `_shared/wa-limits.ts`,
  `_shared/wa-send.ts`, `_shared/wa-inbound.ts` and `send-report-whatsapp/index.ts` — it does **not**
  read `whatsapp-inbound/index.ts`, so deliverable 0's removals cannot trip it.

### 6. If this plan is wrong, say so — do not quietly build less

If you find a genuine contradiction between this plan and the code, **stop and report it**. A plan
that cannot be built as written is useful information. A quietly reduced deliverable that passes its
own gate is not.

## Context

The daily production report is sent by `send-daily-production-report/index.ts` as the approved
template `macavation_daily_production` (see §1b). **This plan builds the answering side: what
happens when a recipient replies to Macavation's WhatsApp**, whether that reply is a tap on a
quick-reply button, a tap on a list row this function itself sent, or a typed word.

Today such a reply gets silence: `COMMAND_HANDLERS` in
`supabase/functions/whatsapp-inbound/index.ts` (`~:457-465`) holds only `HELP`, `YES`, `Y`,
`CONFIRM`, `NO`, `N`, `CANCEL`, and `STAGED_COMMAND_HANDLERS` (`~:353-356`) is an empty map.

**What is NOT established, and must not be asserted anywhere in your diff or report:** whether the
approved template currently carries quick-reply buttons. The merged sender passes only a `body`
component, and no template definition exists in this repo, so a template tap may or may not ever
arrive. Treat the tap path as built-and-ready, not as known-live. The list menu this plan sends
(deliverable 6) *is* fully under this function's control — its rows are ids this function emits and
receives back — so the menu and the typed-word path work regardless.

**Why taps at all.** A tap is one action with no spelling to get wrong, and — the part that matters
technically — **a tap is an inbound message, which opens Meta's 24-hour window**. So every answer
this plan sends is ordinary free text or an interactive reply inside that window. No template, no
approval, no restriction on wording.

**What this feature writes — stated exactly, because "read-only" would be false.** Two writes
happen, both verified in the committed migrations:

1. `set_report_subscription_by_phone` — the recipient's own subscription state (pause/stop/start).
   It resolves one `recipient_id` from `chat_normalize_phone(p_phone)` and upserts one row via
   `ON CONFLICT (recipient_id, report_kind)`.
2. `get_latest_published_report_for_phone` — **despite the `get_` prefix, this RPC WRITES.** Its
   body (`migrations/20260825092000_report_link_codes.sql:225`) calls `mint_report_link_code(v_row.id,
   7, NULL)`, which `INSERT`s a new row into `report_link_codes` — a fresh 22-character bearer
   credential with a 7-day TTL — on **every** call. This is the RPC's designed behaviour (a fresh
   short-TTL code per request so an old chat message cannot be replayed into a working link), and it
   is correctly scoped: it only ever returns a report that phone already received as a `sent`
   delivery. It is still a credential mint, and this plan's `report` action triggers it, for any
   recipient, staff or not.

Constraints that follow from (2), all mandatory:

- Call `get_latest_published_report_for_phone` **at most once per inbound message**, only from the
  `report` action handler. Never call it to render a menu, never in a loop, never speculatively.
  One tap ⇒ at most one minted code.
- Never log the returned `link_code`, never put it in `logCommand`'s `detail`, never include it in
  any `console.*` call. It goes in the message body and nowhere else (`r/index.ts:23-40` records
  why).
- Say this plainly in the code comment you write above the `report` handler: that this RPC mints a
  new link-code row per call and is therefore not a read.

No handler writes production data, edits a report, or sends anything to a third party beyond the
WhatsApp reply itself. A handset is too easy to pick up for anything more — do not add a "capture
today's figures" command even if it looks like an obvious next step.

**You cannot deploy or reach a database.** Author files only. A human redeploys with
`supabase functions deploy whatsapp-inbound --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`
(the ref and the flag are copied from this file's own header at `:5-9`; `--no-verify-jwt` matters
because this function authenticates by HMAC, not JWT).

## Read first

| File / symbol | Why |
|---|---|
| `whatsapp-inbound/index.ts`, `Deno.serve` body | the existing router — **extend it, do not rewrite it** |
| `COMMAND_HANDLERS` (`~:457`) | where new typed verbs go |
| `logCommand` / `whatsapp_log_command` (`~:257`, called at every outcome) | already called on **every** attempt including refusals — you get the audit trail for free |
| `whatsapp_resolve_staff_user` call (`~:582`) | the existing staff lookup — a DIFFERENT roster from this plan's recipients |
| `tryConfirmEnrolment` (`~:496-559`) and its call site (`~:610-614`) | the six-digit enrolment path — leave it working |
| the messages loop and `if (row.deduped)` (`~:766-817`) | dedupe + dispatch point |
| the `statuses[]` loop (`~:822-851`) | delivery receipts — never dispatch from here |
| `isMissingRpc` (`~:168-172`) | the degradation pattern to copy |
| `send-daily-production-report/index.ts`, `formatFigure` (`~:94-106`) | the near-duplicate number formatter — model deliverable 9 on it, with the override in that deliverable |
| `supabase/functions/r/index.ts:106-117`, `:156-161` | how a report link code becomes a URL, and the "jsonb RPC returns an object, never an array" read pattern to model from |
| `migrations/20260813090000_…:72` | `chat_normalize_phone` returns **bare digits**, no `+` |
| `migrations/20260822090000_…:46` | `report_normalize_wa_phone` returns **`+27…`** |

## The phone-format trap — read before writing any lookup

Two normalisers coexist and disagree by design:

- inbound resolution uses `chat_normalize_phone` → **bare digits** (`27821234567`)
- the recipient roster is keyed on `report_normalize_wa_phone` → **`+27…`** (`+27821234567`)

A lookup that passes the inbound `from` straight to a roster query **matches nobody, silently**.
Use the bridging RPCs below, which canonicalise on `chat_normalize_phone` of both sides. **Do not
hand-roll the conversion** — besides being wrong, it would break the parity sweep (§5).

Pass the raw inbound `from` (bare digits, exactly as the existing loop computes it) to every RPC
that takes `p_phone`. Do not pre-format it.

## FIXED contracts — transcribed from the committed migrations, implement against these exactly

All of these return **`jsonb`**, i.e. a single object. `supabase-js` gives you that object directly
in `data` — **do not write `Array.isArray(data) ? data[0] : data` for these.** That idiom in the
existing file is for the `RETURNS TABLE` RPCs (`whatsapp_resolve_staff_user`, etc.); keep using it
there and only there. `supabase/functions/r/index.ts:156-161` is the in-repo example of the jsonb
read pattern.

**`report_sast_today() → date`** — `(current_timestamp AT TIME ZONE 'Africa/Johannesburg')::date`.
It is granted to `anon, authenticated, service_role` (`20260825090000:60`) — this function calls it
as service-role like every other RPC here; the wider grant changes nothing for you and is recorded
only so nobody "corrects" it. This is the ONLY source of "today" in this plan (see deliverable 5).

**`report_recipient_by_inbound_phone(p_phone text) → jsonb`**

```json
{ "found": true, "recipient_id": "…", "display_name": "Pete", "phone": "+27821234567",
  "is_staff": true, "user_id": "…", "subscribed_daily": true, "muted_until": null }
```
`{"found": false}` when the number is on no active list. `user_id` is a `public.users(id)`
reference (`report_recipients_user_id_fkey`, `20260825090000:79-81`) — the same table
`whatsapp_command_log.user_id` references (`20260815120000:26`), so it is safe to pass straight to
`logCommand`'s `userId`.

**`set_report_subscription_by_phone(p_phone, p_report_kind, p_is_active, p_muted_until) → jsonb`**
→ `{ "ok": true, "error": null, "display_name": "Pete" }`, or
`{ "ok": false, "error": "This number is not on a distribution list." }`. `p_report_kind` must be
`'daily'`. **`muted_until` is set to `p_muted_until` unconditionally on conflict**, so passing
`null` clears an existing mute.

**Read RPCs (all read-only EXCEPT the last — see Context):**

| RPC | Returns (exact keys) |
|---|---|
| `get_daily_production_report(p_date date default null)` | `report_date, date_label, has_production, refreshed_at, cracked_kg, sk_packed_kg, wholes_pct, nis_kg, week_start, week_label, wtd_cracked_kg, wtd_target_kg` — **a fixed 12-key object. There is no array of "lines".** Any figure may be `null`. |
| `get_period_production_summary(p_kind text)` | `ok, label, range_label, cracked_kg, target_kg, pct_of_target, days_left, kernel_sales_zar, oil_sales_zar`; `{ok:false, error}` if `p_kind` is not week/month. `pct_of_target` is `null` when no target is set. |
| `get_kernel_stock_summary()` | `ok, label, as_of, lines: [{style, kg}], total_kg` (zero-quantity styles already dropped; `total_kg` may be `null`) |
| `get_open_alerts_summary()` | `ok, count, distinct_count, lines: [{severity, text, occurrences}]` (at most 8 lines; `count` is the true total) |
| `get_latest_published_report_for_phone(p_phone text)` | `{found:true, period_label, published_at, link_code, expires_at}`, or `{found:false}` / `{found:false, error}`. **It returns a CODE, not a URL, and it MINTS that code — this call is a write (see Context).** |

## Work

All changes are inside `supabase/functions/whatsapp-inbound/index.ts`. No other file is edited.

### 0. Swap the local sender for `sendText` — fix BOTH call sites, and clean up what it orphans

Replace the inline `sendWhatsappText` (`~:207-248`) with `sendText` from `_shared/wa-send.ts`.

**`sendWhatsappText` returns `Promise<boolean>`; `sendText` returns `Promise<WaSendResult>` — an
object that is always truthy.** There are exactly two existing call sites, and both currently read
`const sent = await sendWhatsappText(...); if (!sent) console.error(...)`:

1. inside `tryConfirmEnrolment` (`~:544`) — the enrolment confirmation reply;
2. inside `processCommandForMessage` (`~:653`) — the command reply.

**Both must become `const sent = await sendText(...); if (!sent.ok) console.error(…)`** (keep each
existing log message and its `wamid=` suffix). Leaving either as `if (!sent)` turns its failure log
into dead code. Grep for every remaining `sendWhatsappText` reference and confirm zero remain.

**What the removal orphans, and what to do about each — verified:**

- `const CONTROL_ROOM_BASE_URL = '…'` (`~:200`) is referenced **only** inside `sendWhatsappText`.
  Delete it along with the function. Do **not** delete `hmacHex` (`~:88`): it is still used by the
  inbound signature check at `~:722`.
- The comment block at `~:174-198` ("a small, deliberately duplicated send path" + the
  `⚠ SUPERSEDED` note) describes a function that will no longer exist. Replace it with a short,
  accurate block (about 8 lines, no more) that says: outbound replies from this webhook now go
  through `_shared/wa-send.ts` only; `send-whatsapp-message/index.ts` still cannot be reused here
  because it requires an `X-Portal-Session` header validated via `assistant_validate_session` and
  this webhook has no portal session; and the local text-only sender it used to describe was
  removed by this change. **Do not restate the gateway wire contract there** (§3) — cite
  `_shared/wa-send.ts:21-47` if you need to point at it.
- `_shared/wa-send.ts` cites this file's now-removed lines as evidence for the text send shape
  (`:12-19`, `:49-54`, referencing `whatsapp-inbound/index.ts:188/:211/:219`). **Do not edit
  `wa-send.ts`** — record the now-stale cross-reference as a clearly-labelled handover note in your
  report instead.

Two behavioural notes, both verified, neither a regression:
- `sendText` reads `CONTROL_ROOM_FORWARD_SECRET` / `CONTROL_ROOM_CHANNEL_SLUG` at **module scope**
  and returns `{ok:false, error:'Control Room is not configured'}` when either is unset — it does
  not throw. The header's promise at `:18-19` ("if unset, replies are skipped but messages still
  ingest") therefore still holds.
- `buildTextBody` throws `WaSendError` on empty/whitespace text. Never call `sendText` with a
  possibly-empty string; every reply you build must be a non-empty string. The
  `processCommandForMessage` backstop contains a throw if one ever slips through (Invariant A).

Do **not** touch the HMAC verification, the raw-body-read-once rule, the entry/changes/messages
loops, the `chat_ingest_inbound_whatsapp` call, the dedupe branch, or the `statuses[]` loop.

### 1. Dispatch on a per-message classification

Keep the envelope loops exactly as they are. Inside the messages loop, where
`processCommandForMessage(sb, msg, from, wamid)` is already called (`~:815`), pass the profile name
the loop has already computed: `processCommandForMessage(sb, msg, from, wamid, sanitizeSenderName(profileByWaId.get(from) ?? fallbackProfile))`.
`profileByWaId` (a `Map<string,string>`) and `fallbackProfile` (`string | null`) are both defined in
the enclosing `change` scope (`~:756-762`) — verified. `sanitizeSenderName` returns `undefined` for
a null/non-string input, so this is safe as written.

Inside `processCommandForMessage`, replace the current `if (String(msg?.type ?? '') !== 'text') return;`
early exit with `const m = classifyMessage(msg, senderName);` and branch on `m.kind`:

- `'unsupported'` → return immediately, no reply, no log. (Identical to today's behaviour for a
  non-text message.)
- `'button_reply'` / `'list_reply'` → the **tap path** (§3A below). `classifyMessage` folds a
  template quick-reply tap (`type:'button'`, `msg.button.payload`, falling back to
  `msg.button.text`) into the same `button_reply` kind as an interactive tap, so one path covers
  both.
- `'text'` → the **typed path** (§3B below), which preserves today's behaviour exactly and only
  adds to it.

`classifyMessage` never returns `'status'` — receipts never reach this function. Do not write a
`'status'` branch here; the `statuses[]` loop already handles receipts and must stay untouched.

Set `rawBody` (used for `logCommand`) to `m.text` for a text message and to `m.replyId` for a tap.

### 2. One canonical action vocabulary — internal keys, wire ids, and inbound aliases

Read `buildReplyId` / `parseReplyId` / `REPLY_SEGMENT_RE` in `_shared/wa-send.ts` (`~:205-232`)
before writing this section.

**a. Internal keys.** Define one union type and use these exact strings everywhere in your diff:

```
type ReportAction =
  | 'today' | 'yesterday' | 'week' | 'month' | 'full'
  | 'stock' | 'alerts' | 'report' | 'menu' | 'mute7' | 'stop' | 'start' | 'help';
```

Thirteen keys. Every map, set and handler name below is keyed on exactly these strings.

**b. Ids this function EMITS.** Every list row id and every button id you send is built with
`waReplyId(action)`, defined as `buildReplyId('mac', action)` — producing `mac:today`,
`mac:yesterday`, `mac:week`, `mac:month`, `mac:full`, `mac:stock`, `mac:alerts`, `mac:report`,
`mac:menu`, `mac:mute7`, `mac:stop`, `mac:start`, `mac:help`. Each key satisfies
`REPLY_SEGMENT_RE = /^[a-z0-9][a-z0-9_-]{0,23}$/` and each id is well under `MAX_REPLY_ID` (74), so
`buildReplyId` never throws for them. Never emit a raw uppercase id.

**c. Ids this function RECEIVES.** `resolveAction(replyId: string): ReportAction | null`:

1. `const parsed = parseReplyId(replyId)`. If `parsed !== null && parsed.ns === 'mac'` and
   `parsed.action` is one of the thirteen keys, return it. (`parseReplyId` never throws; it returns
   `null` for anything that is not 2–3 valid lowercase segments.)
2. Otherwise return `lookupAlias(replyId)`.
3. Otherwise `null`.

`lookupAlias(raw: string): ReportAction | null` = `LEGACY_REPLY_ALIASES[normaliseAlias(raw)] ?? null`,
where `normaliseAlias(s) = s.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')`. (Note: this is
deliberately **not** the `replace(/\D/g` idiom — see §5. Do not "simplify" it into one.)

`LEGACY_REPLY_ALIASES`, keyed by `normaliseAlias` output:

`TODAY`→`today`, `FIGURES`→`today`, `YESTERDAY`→`yesterday`, `WEEK`→`week`, `WEEK_TO_DATE`→`week`,
`MONTH`→`month`, `MONTH_TO_DATE`→`month`, `FULL`→`full`, `BREAKDOWN`→`full`,
`FULL_BREAKDOWN`→`full`, `STOCK`→`stock`, `ALERTS`→`alerts`, `REPORT`→`report`, `MENU`→`menu`,
`MUTE`→`mute7`, `MUTE_7`→`mute7`, `PAUSE`→`mute7`, `STOP`→`stop`, `START`→`start`, `HELP`→`help`.

**Why the alias table exists — write this, and ONLY this, in the code comment above it (every clause
is checkable in this checkout):** the uppercase strings above are this repo's guess at what a
template quick-reply tap might carry. `send-daily-production-report/index.ts` sends
`macavation_daily_production` with a **body component only** — no button components — and no
template definition exists anywhere in this repo, so **this checkout cannot confirm whether the
approved template has quick-reply buttons at all, or what payloads they would send.** The table is a
best-effort compatibility layer, not a verified contract, and `classifyMessage` may hand you the
button's visible *text* rather than a payload, which `normaliseAlias` also folds in (e.g.
"Week to date" → `WEEK_TO_DATE`). The same table also serves the typed-word path (§3B), which works
regardless.

**Do not write a comment claiming these ids are approved, fixed, or in use, and do not write that
the sender or the template does not exist here** (§1b). In your handover report, state as an open
question that whoever owns the Meta template must confirm whether it carries quick-reply buttons and
what payloads they send, and that if buttons are added later they should carry
`buildReplyId('mac', …)` ids so the alias path stops being needed. Adding button components to
`send-daily-production-report/index.ts` is a separate plan and is out of scope here.

`LEGACY_REPLY_ALIASES` must contain **no** `YES` / `Y` / `CONFIRM` / `NO` / `N` / `CANCEL` key — those
belong to the existing staged-command flow and must not be shadowed.

**d. Unknown ids are never guessed.** A tap whose id resolves to `null` logs outcome
`unknown_command` with `detail: truncate(replyId, MAX_REPLY_ID)` (both imported from
`_shared/wa-limits.ts`) and replies with the menu (the caller is a known recipient by then). It must
not fall through to a figures handler. Build that reply as
`{ ...buildMenuResult(ctx), outcome: 'unknown_command', command: null, detail: truncate(replyId, MAX_REPLY_ID) }`
— `buildMenuResult` (deliverable 6) is safe at this second call site because it depends only on
`ctx.isStaff` and sends no RPC of its own.

### 3. Routing, tiers, and the paths that must not regress

Resolve the caller with `report_recipient_by_inbound_phone` **at most once per inbound message** —
hold it in a single local (e.g. `let recipient: Any | undefined` plus a `getRecipient()` closure
that calls the RPC on first use). Do not call it once per handler.

`getRecipient()` returns `null` on `{found:false}`, on an `isMissingRpc` error (log it, naming
`migrations/20260825090000_report_subscriptions_and_staff.sql`), and on any other RPC error (log it).
A `null` recipient never reaches a figures handler. **A `null` from `getRecipient()` must never
suppress an existing behaviour** — in the typed path it only means "no new action dispatch", and
control falls through to exactly what runs today.

**A. Tap path (`button_reply` / `list_reply`).**
1. `getRecipient()`; if `null` → `logCommand` with outcome `not_enrolled`, **send nothing**, return.
   (Do not start answering strangers, and do not touch the enrolment path from here.)
2. `resolveAction(m.replyId)`; `null` → §2d.
3. Tier check (below), then dispatch `ACTION_HANDLERS[action]` and hand its result to
   `deliverActionResult` (deliverable 4).

This path never calls `whatsapp_resolve_staff_user` and never calls `tryConfirmEnrolment`. It is
entirely new behaviour, so it cannot regress anything.

**B. Typed path (`text`) — today's flow first, additions second.** Keep the existing sequence
literally in this order:
1. `whatsapp_resolve_staff_user` (unchanged, including its `isMissingRpc` early return).
2. **If resolved:** before calling `handleCommand`, compute
   `const action = lookupAlias(collapsedBody)` (collapsed = `rawBody.trim().replace(/\s+/g, ' ')`,
   the same collapsing `handleCommand` already does). If `action !== null` **and** `getRecipient()`
   is non-null → tier check, dispatch, `deliverActionResult`, then return. Otherwise call
   `handleCommand(ctx)` exactly as today, with today's log-then-send tail. Because no alias key
   collides with `HELP`'s short-circuit siblings `YES`/`NO`, the staged-confirm flow is untouched;
   `HELP` for a caller who is also a recipient becomes the `help` action, which sends the existing
   help text plus a Menu button (§6).
   **Name preservation:** when this branch has already resolved a staff user, build
   `ReportContext.displayName` from `String(resolved.display_name || 'there')` — the same expression
   the existing `CommandContext` uses — so `helpReplyText(displayName)` still renders byte-identical
   text for that caller.
3. **If not resolved:** the six-digit enrolment check runs **first**, exactly as today
   (`/^\d{6}$/` → `tryConfirmEnrolment`, return). Only after that, and only before the existing
   "log `not_enrolled`, send nothing" step, try `lookupAlias(collapsedBody)`; if it returns an
   action **and** `getRecipient()` is non-null → tier check and dispatch. Otherwise fall through to
   the existing silent `not_enrolled` log, byte-for-byte unchanged.

**Tiers — deny by default. The single source of truth for the staff tier is
`recipient.is_staff === true` from `report_recipient_by_inbound_phone`, not
`whatsapp_resolve_staff_user`.** Compare with `=== true`; treat anything else as not staff.

- `STAFF_ONLY_ACTIONS = new Set<ReportAction>(['today','yesterday','week','month','full','stock','alerts'])` — 7 actions.
  A non-staff recipient gets a courteous decline — *"Those figures are not available on this
  number."* — logged with outcome `denied`. **Not** a silent drop and **not** the figures.
- `ANY_RECIPIENT_ACTIONS = new Set<ReportAction>(['menu','help','report','mute7','stop','start'])` — 6 actions.
- 7 + 6 = 13 = the full `ReportAction` union. Every action appears in exactly one set.

`report` has two rules, not one:
- It re-sends a link **only** where `get_latest_published_report_for_phone` returns `found: true`,
  which is true only for a report that phone already received. It never grants access to something
  they were not sent. On `found: false`, say the report is not available for that number.
- Every successful call **mints a new `report_link_codes` row** (Context). Exactly one such call per
  inbound message, from this handler only, and the returned `link_code` is never logged.

### 4. The action handlers — one context type, one result type, ONE send rule

**`ReportContext` — define it explicitly. It is NOT the existing `CommandContext` (`~:300-308`), and
neither type may absorb the other; `COMMAND_HANDLERS` keeps taking `CommandContext` and returning
`CommandResult`, unchanged.**

```ts
interface ReportContext {
  sb: SupabaseClient;
  from: string;        // the raw inbound phone, bare digits, exactly as the messages loop computed it
  wamid: string;
  displayName: string; // resolved staff display_name where §3B step 2 has one, else
                       // String(recipient.display_name || 'there')
  isStaff: boolean;    // recipient.is_staff === true, nothing else
  userId: string | null;   // recipient.user_id ?? null — a public.users(id), safe for logCommand
  recipient: Any;          // the jsonb object from report_recipient_by_inbound_phone
  getSastToday: () => Promise<string | null>;  // deliverable 5; null means "no date, do not proceed"
}
```

**`ReportActionResult` — what every handler returns.**

```ts
interface ReportActionResult {
  outcome: 'ok' | 'unknown_command' | 'denied' | 'error';
  command: string | null;          // the uppercased internal key, e.g. 'WEEK'
  detail?: string | null;
  reply: string | null;            // body text; null means send nothing
  buttons?: WaButton[];            // at most 3; ignored when `list` is set
  list?: { buttonLabel: string; sections: WaListSection[] };
}
```

**THE SEND RULE — exactly one rule, no handler may deviate.** An action handler **never calls a
sender itself**. It returns a `ReportActionResult`. One shared tail, `deliverActionResult(ctx,
result)`, does all of it, in this order:

1. `logCommand` once, with `phone: ctx.from`, `userId: ctx.userId`, `wamid: ctx.wamid`, the
   `rawBody` computed in §1, and `command` / `outcome` / `detail` from the result.
2. Then **at most one send**:
   - `result.list` set → `sendList(ctx.from, result.reply!, result.list.buttonLabel, result.list.sections)`
   - else `result.buttons` non-empty → `sendButtons(ctx.from, result.reply!, result.buttons)`
   - else `result.reply` non-empty → `sendText(ctx.from, result.reply)`
   - else send nothing.
3. Check `.ok` on the returned `WaSendResult` and `console.error` with a `wamid=` suffix on failure
   (same shape as the two existing call sites).

**Never two sends for one action.** When `list` or `buttons` is set, `reply` MUST be a non-empty
string — `buildButtonsBody`/`buildListBody` do not check that (§1), so it is your invariant.
`deliverActionResult` must therefore treat "`list`/`buttons` set with an empty `reply`" as a
programming error: send nothing and `console.error`, rather than posting an empty body.

`ACTION_HANDLERS: Record<ReportAction, (ctx: ReportContext) => Promise<ReportActionResult>>` — a
total map: every one of the thirteen keys has an entry, and TypeScript's `Record<ReportAction, …>`
is what makes a missing one a compile-time gap rather than a dead handset button.

| Action | RPC call | Answer |
|---|---|---|
| `today` | `get_daily_production_report(null)` | headline: `date_label`, `cracked_kg`, `sk_packed_kg`, `wtd_cracked_kg` vs `wtd_target_kg` |
| `yesterday` | `get_daily_production_report(<yesterday>)` — see deliverable 5 | same headline shape |
| `full` | `get_daily_production_report(null)` | **every key the RPC actually returns**: the headline plus `wholes_pct`, `nis_kg`, `week_label`, `refreshed_at` |
| `week` | `get_period_production_summary('week')` | `label`/`range_label`, `cracked_kg`, `target_kg`, `pct_of_target`, `days_left`, `kernel_sales_zar`, `oil_sales_zar` |
| `month` | `get_period_production_summary('month')` | same |
| `stock` | `get_kernel_stock_summary()` | `label`, `as_of`, up to the returned `lines`, `total_kg` |
| `alerts` | `get_open_alerts_summary()` | `count`, then each line as `severity` + `text` (+ `× occurrences` when > 1) |
| `report` | `get_latest_published_report_for_phone(ctx.from)` — **a write, see Context** | see deliverable 7 |
| `menu` | none | `buildMenuResult(ctx)` (deliverable 6) |
| `mute7` | `set_report_subscription_by_phone(ctx.from,'daily',true,<today+7>)` | see deliverable 5 |
| `stop` | `set_report_subscription_by_phone(ctx.from,'daily',false,null)` | "Daily messages stopped. Reply START to turn them back on." |
| `start` | `set_report_subscription_by_phone(ctx.from,'daily',true,null)` | "Daily messages are back on." (`null` clears any mute — verified in the RPC body) |
| `help` | none | existing `helpReplyText(ctx.displayName)` plus a Menu button (deliverable 6) |

**`today` vs `full` — the distinction is between key subsets of one 12-key object, nothing more.**
The RPC returns no lines and never has. Do not invent a per-line breakdown, do not query a table to
build one, and do not ship two identical answers.

Branch on `has_production`: when it is `false`, say the day's figures were not captured rather than
printing a row of zeros. Every `{ok:false, error}` or `{found:false}` result gets a plain
"not available right now" reply and an `error`/`ok` log outcome as appropriate — never a stack
trace, never the raw Postgres message, to the handset.

### 5. Dates come from Postgres, never from `new Date()`

`report_sast_today()` returns today in `Africa/Johannesburg`; the server clock is UTC, so a naive
`new Date()` is off by a day between 00:00 and 02:00 SAST — wrong figures on a read, and a
mute window off by one on a **write**.

- Add `sastDatePlusDays(base: string, n: number): string`: parse `base` (a `YYYY-MM-DD` string) as
  `new Date(`${base}T00:00:00Z`)`, add `n * 86400000`, return `toISOString().slice(0, 10)`. UTC
  throughout, so no host timezone can affect it.
- `ctx.getSastToday()` is the ONLY way to obtain `base`: a closure that calls the `report_sast_today`
  RPC at most once per inbound message, memoises the result, and is invoked only by the actions that
  need it (`yesterday`, `mute7`).
- **`getSastToday()` has NO fallback.** If the RPC fails, or returns anything that is not a
  `YYYY-MM-DD` string, it returns `null`; the calling handler must log it, return a
  "not available right now" reply with outcome `error`, and **not call the RPC that would have used
  the date**. In particular `mute7` must not write with a guessed date: no `new Date()` substitute,
  on either the read path or the write path. Do not give `getSastToday` a default value at any call
  site.
- `yesterday` → `get_daily_production_report(sastDatePlusDays(base, -1))`.
- `mute7` → `p_muted_until = sastDatePlusDays(base, 7)`. The subscription is treated as muted while
  `muted_until >= report_sast_today()` (see `report_daily_recipients` in
  `migrations/20260825090000_…:275`, which includes a recipient only when
  `muted_until IS NULL OR muted_until < report_sast_today()`), so the reply must state the boundary
  explicitly using the computed value — e.g. *"Paused. No daily messages up to and including
  <date>."* — rather than saying "for 7 days" and leaving the resume day ambiguous.
- Typed `MUTE` and `MUTE 7` both map to the fixed 7-day `mute7` action. **A typed `MUTE <n>` for
  arbitrary `n` is deliberately not supported** — one mute action, one duration, one handler
  signature.

### 6. The list menu and the help reply

`buildMenuResult(ctx: ReportContext): ReportActionResult` returns
`{ outcome: 'ok', command: 'MENU', reply: 'What would you like?', list: { buttonLabel: 'Macavation menu', sections } }`.
`deliverActionResult` turns that into the single `sendList` call. Row ids are `waReplyId(action)`.

Staff recipient (`ctx.isStaff === true`) — four sections, nine rows, in this order:

| Section | Rows (action → title) |
|---|---|
| Production | `today` → Today's production · `yesterday` → Yesterday · `week` → Week to date · `month` → Month to date |
| Stock and alerts | `stock` → Kernel stock on hand · `alerts` → Open alerts |
| Reports | `report` → Latest report link |
| These messages | `mute7` → Pause for 7 days · `stop` → Stop daily messages |

**Non-staff recipient: only the Reports and These messages sections** (three rows). Showing somebody
a menu whose every row then refuses them is worse than a shorter menu.

Every title above is within the 24-character cap and nine rows is within the 10-row cap, checked by
`buildListBody` against `_shared/wa-limits.ts:14-18`. **Do not add your own truncation** and do not
call `truncate` on these constants.

`help` returns `{ outcome:'ok', command:'HELP', reply: helpReplyText(ctx.displayName), buttons: [{ id: waReplyId('menu'), title: 'Menu' }] }`
— one `sendButtons`, per the send rule. If you add the new commands to the help text, edit the
existing `HELP_COMMAND_LIST` constant (`~:317`) **once** — it is already used both by
`helpReplyText` and by the unknown-verb reply (`~:480`); do not introduce a second list. For a
caller who is **not** a recipient (`getRecipient()` is `null`), the existing text-only help reply
via `commandHelp`/`handleCommand` must be unchanged — no Menu button pointing at a menu they cannot
use.

### 7. The report link

`get_latest_published_report_for_phone` returns `link_code`, not a URL, and minting that code is a
write (Context). Build the URL as `${Deno.env.get('SUPABASE_URL')}/functions/v1/r/${link_code}` —
verified against `supabase/functions/r/index.ts:112-117`, whose `extractCode` takes the last path
segment of exactly that shape. If `SUPABASE_URL` is empty, do not send a half-built link: reply
"not available right now" and log it.

**The code is a bearer credential.** Never log it, never put it in the `logCommand` `detail` field,
and never echo it anywhere but the message body itself (`r/index.ts:23-40` records why). Include
`period_label` and the human-readable `expires_at` in the reply so the recipient knows the link is
time-limited.

### 8. Follow-up buttons on each answer

Every figures answer returns `buttons` on its `ReportActionResult`: at most three — a sensible next
step, then `menu`. Ids are `waReplyId(action)`; labels are 20 characters maximum (e.g. `week` →
"Month to date" for `month`, "Kernel stock" for `stock`, "Menu" for `menu`). Because of the send
rule in deliverable 4, this is **one** `sendButtons` whose body text IS the answer — never a text
send followed by a button send. Check every label you write against `MAX_BUTTON_CTA` by counting
characters; `buildButtonsBody` throws rather than truncating.

### 9. Message formatting

Answers are free text, so real line breaks are allowed and encouraged. Keep each answer under about
12 lines. Thousands separated, one decimal on percentages, `not captured` for a null figure, never
`0` for a null. Currency as `R 1 240 500`.

**Model this on the existing near-duplicate, with one deliberate override.**
`send-daily-production-report/index.ts:94-106` already implements exactly these rules as
`formatFigure(value, decimals)` — same `'not captured'` string for null/undefined/non-numeric, same
`toFixed(decimals)`, same `replace(/\B(?=(\d{3})+(?!\d))/g, …)` thousands grouping. It is **not
exported** and lives in another function directory, so you cannot import it: write local helpers
`formatFigureText(value: unknown, decimals = 0): string` and `formatZar(value: unknown): string` in
`whatsapp-inbound/index.ts` following that logic.

**Override, do not copy blindly:** `formatFigure` inserts a NON-BREAKING space (`\u00A0`) as the
thousands separator solely because that file's `sanitizeParam` later collapses runs of regular
spaces in Meta **template parameters**. This plan sends free text and templates nothing, so that
constraint does not apply here — use a **regular space** (`' '`) and say why in a one-line comment.
Do not import, re-export, or edit `send-daily-production-report/index.ts`.

Neither helper may contain the substring `replace(/\D/g` (§5).

## Out of scope

No migrations, no RBAC, no deployment. No write commands of any kind beyond the recipient's own
pause/stop/start and the link-code mint that `get_latest_published_report_for_phone` performs
internally. No WhatsApp Flows. No template authoring, no edit to
`send-daily-production-report/index.ts` (including adding button components to its template send) —
this plan only answers replies. No new verifier, no edits to `_shared/wa-send.ts`,
`_shared/wa-inbound.ts`, `_shared/wa-limits.ts` or any `scripts/verify-*.mjs`, and **do not edit
`package.json` at all** — another plan in this batch edits it. Correcting the stale comment at
`scripts/verify-report-whatsapp-parity.mjs:29-31` about migration 20260822090000, and the stale
cross-references in `_shared/wa-send.ts:12-19,49-54` to lines this plan removes, are explicitly not
this plan's job — report them, do not fix them.

## Verification (all of it runnable from this checkout)

- **Naming sweep.** Grep your own diff for every identifier this plan names — `ReportAction`,
  `ReportContext`, `ReportActionResult`, `waReplyId`, `resolveAction`, `lookupAlias`,
  `normaliseAlias`, `LEGACY_REPLY_ALIASES`, `ACTION_HANDLERS`, `STAFF_ONLY_ACTIONS`,
  `ANY_RECIPIENT_ACTIONS`, `sastDatePlusDays`, `getSastToday`, `getRecipient`,
  `deliverActionResult`, `buildMenuResult`, `formatFigureText`, `formatZar` — and confirm each is
  defined once and referenced under exactly that spelling. Confirm the thirteen `ReportAction`
  strings are identical in the union, in `ACTION_HANDLERS`, in the two tier sets, and in every
  `waReplyId(...)` call. Confirm `CommandContext`/`CommandResult` are still used by
  `COMMAND_HANDLERS` and are not conflated with the two new types.
- **One send per action.** Grep the diff: no `ACTION_HANDLERS` entry calls `sendText`, `sendButtons`
  or `sendList` directly; every one of those three appears only inside `deliverActionResult` (plus
  the two pre-existing `sendText` call sites from deliverable 0). Trace each of the thirteen handlers
  and confirm none produces both a text send and a button send.
- **Non-empty body text.** Every `ReportActionResult` carrying `buttons` or `list` also carries a
  non-empty `reply`.
- **Tier totality.** 7 staff-only + 6 any-recipient = 13, no action in both sets, none in neither.
  Trace a `found:false` caller and an `is_staff:false` caller through each of the seven staff
  actions and confirm neither reaches a figure.
- **Write surface, stated correctly.** Grep the diff for `upsert_`, `override_`,
  `set_report_section`, `publish_` — none appear. Confirm exactly two writing RPCs are reachable:
  `set_report_subscription_by_phone`, and `get_latest_published_report_for_phone` (which mints a
  `report_link_codes` row). Confirm the latter is called from the `report` handler only, at most
  once per inbound message, and that `link_code` appears in no `console.*` call and in no
  `logCommand` argument.
- **No false claims in the diff.** Grep your diff for `send-daily-production-report` and for the
  word `template`: every occurrence must be consistent with §1b — the sender exists, it sends a body
  component only, and this checkout cannot confirm the approved template's buttons. No comment says
  that file or the template does not exist here.
- **`extractMessage` is not used.** Grep the diff: zero occurrences. `classifyMessage` is called
  once, per message, inside the existing messages loop.
- **The loops are intact.** The entry/changes/messages loops, the `chat_ingest_inbound_whatsapp`
  call, `if (row.deduped)`, and the whole `statuses[]` loop calling `chat_record_whatsapp_status`
  are unchanged. Command dispatch happens only in the non-deduped branch.
- **2xx.** No `throw` escapes `Deno.serve`; no new non-2xx return exists after the signature check;
  every new RPC call handles `isMissingRpc` without a table-reading fallback.
- **Send-result checks.** Zero `sendWhatsappText` references remain; both former call sites now test
  `.ok`; `CONTROL_ROOM_BASE_URL` no longer appears in this file; `hmacHex` is still defined and still
  used by the signature check.
- **No date fallback.** Grep the diff for `new Date(`: the only occurrence is inside
  `sastDatePlusDays`, on a `YYYY-MM-DD` string with an explicit `T00:00:00Z`. `mute7` and
  `yesterday` both abort when `getSastToday()` returns `null`.
- **Parity sweep.** `whatsapp-inbound/index.ts` still contains zero occurrences of `replace(/\D/g`.
- **Reply ids.** Every emitted id comes from `waReplyId`; no uppercase literal is ever sent as an id.
- **Template taps.** Confirm the tap path is reached for `classifyMessage`'s `type:'button'` branch,
  not only for `interactive`, and that a payload-less template tap (id falling back to the button
  text) still resolves through `lookupAlias`.
- `npm run test:fleet` passes in full.

State in your report that the function is **authored but not redeployed**; that the RPC migrations
are committed here but their applied state is unknown from this checkout; that the `report` action
mints a fresh 7-day link code per tap (by design of the RPC, correctly scoped to a report that phone
already received) so the feature is not read-only; and, as clearly-labelled handover notes, (a) that
whoever owns the Meta template must confirm whether `macavation_daily_production` carries
quick-reply buttons and what payloads they send — the merged sender attaches none, and
`LEGACY_REPLY_ALIASES` is the compatibility layer until that is known — and (b) that
`_shared/wa-send.ts:12-19,49-54` cites lines of `whatsapp-inbound/index.ts` that deliverable 0
removes, which a human should correct separately.
