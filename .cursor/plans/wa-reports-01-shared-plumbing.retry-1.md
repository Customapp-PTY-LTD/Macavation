---
retry_of: 134a9bcb-4a8d-4c42-b70b-0a946e721034
---

# WhatsApp reports — shared send/parse plumbing for buttons, lists and templates

## Context

Macavation is adding a daily production report that sends itself at 17:00 SAST, and follow-up
answers driven by **tappable WhatsApp buttons and list menus** rather than typed command words.

Every WhatsApp send in this repo currently builds its own payload inline and sends `type: 'text'`
only. Four functions (`send-whatsapp-message`, `send-daily-digest-whatsapp`, `send-report-whatsapp`,
`whatsapp-inbound`) each carry their own inline signing and request-body code. Four more functions
are about to need buttons, lists and templates. This plan creates the shared module they will all
import, so the next four plans do not each invent their own.

**What `scripts/verify-report-whatsapp-parity.mjs` actually is — read this before you assume
anything about it.** Its header and body (re-read them; do not trust this summary alone) show it
enforces **seven** phone-normalisation implementations across **three** deployment units (edge
functions, SQL migrations, browser JS). It keeps only the **three TypeScript** copies
byte-identical (`TS_NORMALIZER_LITERAL`), checks the SQL copies by text assertion, and runs the
browser copy behaviourally. It checks **phone normalisation only — not signing**. It explicitly
records that `supabase/functions/whatsapp-inbound/index.ts` is **NOT** a normaliser. It also runs a
**sweep** (`verify-report-whatsapp-parity.mjs:311-331`) over **every `.ts` under
`supabase/functions/` recursively — `_shared/` included** — flagging any file containing both
`replace(/\D/g` and `27`, and asserting the candidate list is exactly 5 files. Section 5 below tells
you exactly how to keep that gate green; do not improvise here.

**Do not modify the four existing functions.** They keep their own inline copies. This plan only
*adds* modules for new code to use. Migrating the old four is deliberately out of scope.

### What is verified, and what is not — this determines the scope of this plan

**VERIFIED from code in this checkout (treat as settled):**

- The outbound request body posted to Control Room's `meta-proxy` is
  `{ action: 'send_message', channelSlug, to, type: 'text', content: { text: <string> } }`.
  The `content` key is **`text`**, not `body`. This holds at **all four** call sites — confirm each
  yourself before writing a line: `send-whatsapp-message/index.ts:128`,
  `send-daily-digest-whatsapp/index.ts:105`, `send-report-whatsapp/index.ts:439`,
  `whatsapp-inbound/index.ts:211`.
- The signature header is `X-Control-Room-Signature: sha256=<lowercase hex HMAC-SHA256 of the
  exact posted body string>` (`send-report-whatsapp/index.ts:155-166` and `:446`;
  `whatsapp-inbound/index.ts:88-98` and `:219`).
- The gateway response is read as `{ ok, wamid, error }` (`send-report-whatsapp/index.ts:451-462`).
- The inbound envelope is Meta's raw webhook: `entry[].changes[].value.messages[]`,
  `value.statuses[]`, `value.contacts[0].profile.name`, `value.metadata.phone_number_id`, and
  inbound phone numbers arrive as **bare digits with no leading `+`**
  (`whatsapp-inbound/index.ts:44-58`, `:743-753`, `:810`).
- Inbound message variants this repo already handles:
  `type:'text'` → `msg.text.body`; `type:'button'` → `msg.button.text`; `type:'interactive'` →
  `msg.interactive.button_reply.title` / `msg.interactive.list_reply.title`
  (`whatsapp-inbound/index.ts:118-158`). The `type:'button'` variant is real and is how a
  quick-reply tap on an **approved template** arrives — it is not `interactive`.

**NOT VERIFIABLE from this checkout (must never be written down as settled fact):**

- The `content` shapes for `type:'interactive'` (buttons, lists) and `type:'template'`. Nothing in
  this repo sends them, and you cannot reach the `meta-proxy` source, a database, or the network.
  `whatsapp-inbound/index.ts:182-185` carries a standing in-code decision on exactly this point:
  *"TEXT ONLY. Do not add an interactive/button send here (unconfirmed external contract)."*
- Which Control Room Supabase project is the correct one, and whether
  `CONTROL_ROOM_CHANNEL_SLUG` should hold a WebhookSlug or a ChannelCode. This checkout contains
  both wordings (`whatsapp-inbound/index.ts:11`, `docs/phase2/PROD_CUTOVER_CHECKLIST.md:100`) and
  no way to decide between them.
- Meta's own hard caps (3 buttons, 10 rows, 20/24-character titles). They are used here as
  **conservative reject thresholds**, so being wrong-but-stricter fails loudly at build time
  instead of silently on the wire.

**Consequence for scope (this is the deliberate narrowing versus the earlier draft):** the
non-text `content` shapes ship as **pure builder functions plus a written-down open question**, and
**no non-text sender function is created**. `sendText` is the only function in this plan that
performs a network call. The next plan adds `sendButtons` / `sendList` / `sendTemplate` once
someone with Control Room access has confirmed the shapes. Building the pure builders now is safe;
putting an unconfirmed shape on the wire is what this repo already forbids.

**You cannot deploy edge functions, run Deno, reach a database, or reach another repository.**
Author files only. The only thing you can execute to check your work is `npm run test:fleet` and
the individual `npm run *:verify` scripts. Do not write any "verify this by …" step that needs a
browser, a login, a deploy, or a network call.

**No new dependencies.** Nothing is added to `package.json` except two script entries (section 6).
The new verifier imports only `node:` builtins, exactly like the existing ones.

## Read first

| File | Why |
|---|---|
| `supabase/functions/send-report-whatsapp/index.ts:33`, `:148-166`, `:434-462` | the live send: base URL constant, `normalizePhone`, `signBody`, the `{action,channelSlug,to,type,content:{text}}` body, the `{ok,wamid,error}` response |
| `supabase/functions/whatsapp-inbound/index.ts:44-58`, `:88-111`, `:118-158`, `:174-236`, `:740-812` | inbound envelope contract, `hmacHex`, `timingSafeEqual`, per-type body extraction, the TEXT-ONLY decision comment, the real envelope walk |
| `scripts/verify-report-whatsapp-parity.mjs` — **entire file**, especially the header, `SWEEP_ALLOWLIST` (`:194-204`), the sweep check (`:311-331`) and the `SWEEP_ALLOWLIST[0]` check (`:355-361`) | the gate you must keep green; section 5 edits it in exactly one place |
| `scripts/verify-report-whatsapp-payload.mjs:12-19` and `:42-65` | the repo's documented pattern for testing `.ts`: assert exact literal source text, then re-declare an identical copy to run cases against. This is the pattern section 6 uses. |
| `scripts/verify-report-whatsapp-picker.mjs:55-99` | the `check()` harness shape only. **Its target is a plain `.js` browser module and it strips nothing** — do not copy a "TS-stripping" technique from it, there isn't one. |
| `scripts/verify-no-username.mjs:40-47` | scans every new `.ts` under `supabase/functions/` for the lowercase token `username` |
| `package.json:31-32` | the `"//test:fleet"` contract: pure Node stdlib, no browser, no login, no network, no deployed app |
| `BluePrint/secrets-management-rules.md` | how secrets are read in this repo |

## Work

### 1. `supabase/functions/_shared/wa-limits.ts`

Conservative caps. A send that violates one is rejected by the gateway, so callers reject or
truncate *before* sending. The header comment must state plainly that these mirror Meta's
documented caps, that this checkout contains no way to verify them, and that they are therefore
enforced as **reject** thresholds rather than silent truncation.

```ts
export const MAX_LIST_TITLE = 24      // characters in one list row title
export const MAX_LIST_SECTION = 24    // characters in a list section title
export const MAX_BUTTON_CTA = 20      // characters in a button label
export const MAX_BUTTONS = 3          // quick-reply buttons per interactive message
export const MAX_LIST_ROWS = 10       // total rows across all sections of one list
export const MAX_REPLY_ID = 74        // this repo's own convention: three 24-char segments + two ':'
```

`MAX_REPLY_ID` is **this repo's self-imposed cap**, not a Meta figure: `24 + 1 + 24 + 1 + 24 = 74`,
deliberately far below any external limit. Say exactly that in the comment.

Plus two helpers:

- `truncate(s: string, max: number): string` — returns `s` unchanged when `s.length <= max`;
  otherwise `s.slice(0, max - 1) + '…'`. When `max <= 1`, return `s.slice(0, max)`.
- `paginateRows<T>(rows: T[], maxRows: number, moreLabel?: string): { page: T[]; hasMore: boolean }`
  — when `rows.length <= maxRows` return `{ page: rows, hasMore: false }`. Otherwise, if
  `moreLabel` was supplied **and** `maxRows > 1`, reserve one slot (`page` is `maxRows - 1` long)
  so the caller can append its own "show more" row. If `moreLabel` was not supplied, **or**
  reserving would leave zero rows (`maxRows <= 1`), cap hard at `maxRows`. `hasMore` reports the
  overflow either way. `page` is never empty when `rows` is non-empty and `maxRows >= 1`.

Constraint: this file must **not** contain the substring `replace(/\D/g` (see section 5).

### 2. `supabase/functions/_shared/wa-send.ts`

Doc-comment header in the house style (`send-report-whatsapp/index.ts:1-32`) naming every
environment variable read. The header must contain, in these words or close to them:

- **A VERIFIED block** listing the text `content: { text }` shape and the four file:line call sites
  it was read from, plus the `sha256=<hex>` header and the `{ok,wamid,error}` response.
- **An OPEN QUESTION block**, marked `UNCONFIRMED`, stating that the `interactive` and `template`
  `content` shapes below were **not** verified against `meta-proxy` (that source is not reachable
  from this repo), that they are the shapes this repo currently proposes, and that they must be
  confirmed by someone with Control Room access before any caller sends a non-text type. Reference
  the standing decision at `whatsapp-inbound/index.ts:182-185`.
- **Do not** write "verified against meta-proxy", or any dated story about Control Room projects
  splitting, or any claim about WebhookSlug vs ChannelCode, into this file. None of that is
  checkable here.

Environment, read once at module scope:

```ts
const CONTROL_ROOM_BASE_URL = Deno.env.get('CONTROL_ROOM_BASE_URL')
  ?? 'https://ejnncypummmvyojhovme.supabase.co/functions/v1'
const CONTROL_ROOM_URL = `${CONTROL_ROOM_BASE_URL}/meta-proxy`
const FORWARD_SECRET = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET') ?? ''
const CHANNEL_SLUG   = Deno.env.get('CONTROL_ROOM_CHANNEL_SLUG') ?? ''
```

Header note beside it, stating only what is checkable: *the fallback URL is byte-identical to the
literal already hardcoded at `send-report-whatsapp/index.ts:33` and `whatsapp-inbound/index.ts:188`;
if any of the three changes, all three change together. This checkout contains no evidence about
which Control Room project is correct — do not change it on the basis of anything other than a
confirmed instruction from someone with Control Room access.* The env override exists so the value
can be rotated by configuration rather than by a code change. `FORWARD_SECRET` and `CHANNEL_SLUG`
are read from the environment only and must never appear as literals anywhere in this repo,
including in comments, examples or test fixtures.

**Pure body builders.** Each takes only its arguments — **no module-scope value, no env, no
network** — so the verifier can re-declare an identical copy and run it (section 6). Each returns a
`WaMessageBody = { to: string; type: string; content: unknown }`:

```ts
buildTextBody(to, text)                            // type:'text'
buildButtonsBody(to, bodyText, buttons)            // buttons: {id,title}[]   UNCONFIRMED shape
buildListBody(to, bodyText, buttonLabel, sections) //                          UNCONFIRMED shape
buildTemplateBody(to, templateName, languageCode, components?) //              UNCONFIRMED shape
```

Exact `content` shapes:

- text → `{ text }` — **`text`, not `body`.** This is the one shape verified against this repo's
  own four senders. Do not "improve" it.
- interactive buttons → `type: 'interactive'`, `content:`
  `{ type:'button', body:{text}, action:{ buttons: [{ type:'reply', reply:{ id, title } }] } }`
- interactive list → `type: 'interactive'`, `content:`
  `{ type:'list', body:{text}, action:{ button: buttonLabel, sections } }`
  where each section is `{ title, rows: [{ id, title }] }`
- template → `type: 'template'`, `content:` `{ name, language:{ code }, components? }`, with
  `components` **omitted entirely** (key absent, not `[]`) when empty. Component shape:
  `{ type:'header'|'body'|'button', sub_type?:'url'|'quick_reply', index?, parameters:[{type:'text',text}] }`

The three non-text builders must each carry an inline `// UNCONFIRMED external contract` comment
immediately above them.

**Validation, throwing `WaSendError` (a small exported `class WaSendError extends Error`):**

- `buildTextBody` — reject an empty/whitespace-only `text`.
- `buildButtonsBody` — reject more than `MAX_BUTTONS` buttons; reject any `title` longer than
  `MAX_BUTTON_CTA`; reject an empty button list. Do **not** silently truncate a button label: a
  clipped label changes what the recipient is agreeing to.
- `buildListBody` — reject more than `MAX_LIST_ROWS` rows in total across all sections; reject any
  row `title` longer than `MAX_LIST_TITLE`; reject any section `title` longer than
  `MAX_LIST_SECTION`; reject an empty section list.
- `buildTemplateBody` — a template **URL-button parameter must be only the suffix that replaces
  `{{1}}`** in the template's base URL (e.g. `wk34-2026`), never a full URL. Reject a parameter
  matching `/^https?:\/\//i` on a `sub_type: 'url'` component, with a message saying to pass only
  the suffix.

**Reply-id convention** — the whole point of this module is that the next four plans do not each
invent one, so it is defined here and only here:

- `buildReplyId(ns: string, action: string, arg?: string): string` — joins the given segments with
  `':'`. Every segment must match `/^[a-z0-9][a-z0-9_-]{0,23}$/` or it throws `WaSendError`; the
  result must be at most `MAX_REPLY_ID` characters. Example: `buildReplyId('rpt','confirm','wk34-2026')`
  → `'rpt:confirm:wk34-2026'`.
- `parseReplyId(id: string): { ns: string; action: string; arg?: string } | null` — **never
  throws**; returns `null` for anything that is not 2 or 3 valid segments joined by `':'`.
  `parseReplyId(buildReplyId(a,b,c))` round-trips.

`wa-inbound.ts` does **not** import either of these — it returns the raw `replyId` string and the
caller parses it. Keep the dependency one-way.

**Phone handling — read this carefully, it is the easiest thing to get wrong.**

```ts
// This file is deliberately a sweep candidate for scripts/verify-report-whatsapp-parity.mjs:
// it contains `replace(/\D/g` and the substring `27`, and is listed in that script's
// SWEEP_ALLOWLIST. If either substring is ever removed from this file, that gate fails on the
// allowlist/deepEqual mismatch. Change both together or not at all.
```

`toWaPhone(phone: string): string` converts an **already-international** number to E.164 by
stripping non-digits with exactly `.replace(/\D/g, '')` and prefixing `'+'`. It is for inbound Meta
`from` values (bare international digits) and for numbers already stored in `+27…` form.

- ⚠ **It is NOT a South African normaliser and must never be used as one.** A local `0821234567`
  becomes `+0821234567`, which is not a phone number. Local-format numbers are canonicalised to
  `+27…` by the database (`report_normalize_wa_phone`,
  `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:46`) before they ever
  reach this module, and every recipient list is keyed on that. State this in the function's doc
  comment. Do **not** re-implement SA normalisation here, and do **not** touch the existing
  `normalizePhone` copies or the truth table in the parity verifier.
- ⚠ **Do not reproduce the unguarded fallback of the existing three TS copies.** Those are
  documented in `verify-report-whatsapp-parity.mjs:39-47` as having a known open defect: an empty
  or digit-free input normalises to the plausible-looking address `'+27'` and is handed to the
  gateway. `toWaPhone` is a **new** call site with no such history, so it **throws `WaSendError`
  when the stripped digit string is empty** rather than returning `'+'` or `'+27'`. This is not a
  fix to the existing three — they are untouched — it is a new function declining to inherit their
  defect.

**Signing and posting:**

- `hmacSha256Hex(secret: string, body: string): Promise<string>` — exported for the verifier;
  returns bare lowercase hex, matching `whatsapp-inbound/index.ts:88-98`.
- `sendViaControlRoom(body: WaMessageBody)` — **private**. Composes
  `{ action: 'send_message', channelSlug: CHANNEL_SLUG, to: body.to, type: body.type, content: body.content }`,
  `JSON.stringify`s it **once**, signs that exact string, and POSTs that exact string with
  `X-Control-Room-Signature: sha256=<hex>`. Signing a re-serialised copy is a silent 401.
- Returns `{ ok: boolean; wamid: string | null; error: string | null }`. **Return a result, do not
  throw on a gateway failure** — callers write a per-recipient audit row and must record the
  gateway's own words verbatim. Throw only for missing configuration or a validation error.
- If `FORWARD_SECRET` or `CHANNEL_SLUG` is empty, return
  `{ ok:false, wamid:null, error:'Control Room is not configured' }` without attempting a send.
- Never log, echo or include `FORWARD_SECRET`, the computed signature, or the request body in any
  `console` call or in the returned `error` string.

**The only exported sender is `sendText(to: string, text: string)`** = `buildTextBody` +
`sendViaControlRoom`. Do **not** add `sendButtons`, `sendList` or `sendTemplate` in this plan — see
the scope note in Context. Leave a short comment at the end of the file saying so and naming what
must be confirmed first.

Constraint: this file must not contain the lowercase token `username` (`verify-no-username.mjs`).

### 3. `supabase/functions/_shared/wa-inbound.ts`

Structured as small **pure** helpers plus one thin async wrapper, so the verifier can re-declare
and test the pure parts (section 6).

- `parseSignatureHeader(header: unknown): string | null` — **pure, never throws.** Returns the
  lowercase hex digest from a `sha256=<hex>` header, or `null` for a missing, non-string,
  wrong-prefix, empty or non-hex value.
- `timingSafeEqual(a: string, b: string): boolean` — **pure**, length-independent, no early exit.
  Model on `whatsapp-inbound/index.ts:101-111`.
- `verifyControlRoomSignature(rawBody: string, signatureHeader: unknown, secret: string): Promise<boolean>`
  — returns `false` (never throws) for a missing/malformed header, an empty secret, or a mismatch.
  Uses `parseSignatureHeader` + `hmacSha256Hex`-equivalent + `timingSafeEqual`. Its doc comment
  must state: **callers verify before parsing the body at all.**

`extractMessage(payload: unknown): ExtractedMessage` — normalises Control Room's forwarded raw Meta
webhook. Never throws; anything unrecognised classifies rather than erroring, because the webhook
must always return 2xx once the signature checks out.

```ts
export type ExtractedMessage =
  | { kind:'text';         from:string; id:string; text:string;        senderName?:string }
  | { kind:'button_reply'; from:string; id:string; replyId:string; replyTitle:string; senderName?:string }
  | { kind:'list_reply';   from:string; id:string; replyId:string; replyTitle:string; senderName?:string }
  | { kind:'status' }        // delivery/read receipts — classify and ignore
  | { kind:'unsupported' }   // images, unknown types, unparseable
```

Split into three pinned, testable pieces — use exactly these names, they are referenced by
section 6:

- `sanitizeSenderName(raw: unknown): string | undefined` — **pure.** Takes
  `value.contacts[0].profile.name`. Returns the first whitespace-delimited word with newlines
  stripped, capped at 20 chars, and **`undefined` unless the result contains at least one letter**
  (`/\p{L}/u`) — a display name is free text the user chose and can be emoji-only. Returns
  `undefined` for a non-string, empty or whitespace-only input.
- `classifyMessage(msg: unknown, senderName: string | undefined): ExtractedMessage` — **pure.**
  Requires `from`, `id` and `type` to all be non-empty strings, else returns
  `{ kind:'unsupported' }`. Then:

  | Meta shape | Becomes |
  |---|---|
  | `type:'text'`, `msg.text.body` a non-empty string | `kind:'text'` |
  | `type:'interactive'`, `msg.interactive.type === 'button_reply'`, `.button_reply.{id,title}` | `kind:'button_reply'` |
  | `type:'interactive'`, `msg.interactive.type === 'list_reply'`, `.list_reply.{id,title}` | `kind:'list_reply'` |
  | `type:'button'` (see below) | `kind:'button_reply'` |
  | anything else | `kind:'unsupported'` |

  ⚠ **The `type:'button'` branch is load-bearing and easy to mistake for dead code.** Tapping a
  quick-reply button on an **approved template** does not arrive as `interactive` at all — it
  arrives as `type: 'button'`. This repo already handles that variant at
  `whatsapp-inbound/index.ts:124-125`, reading `msg.button.text`. Map it to the **same**
  `kind:'button_reply'`, with `replyTitle = msg.button.text` and
  `replyId = msg.button.payload` **when `payload` is a non-empty string, otherwise falling back to
  `msg.button.text`** — this checkout only ever reads `.text`, so `.payload` must not be treated as
  guaranteed. If neither is a non-empty string, return `{ kind:'unsupported' }`. Put a comment
  saying exactly why this branch exists, because it looks redundant next to the `interactive` one.

- `extractMessage(payload)` — reads `entry[0].changes[0].value`; the message is `value.messages[0]`.
  Computes `senderName` via `sanitizeSenderName(value?.contacts?.[0]?.profile?.name)` and delegates
  to `classifyMessage`. With no message, returns `{kind:'status'}` if `value.statuses` is a
  non-empty array, else `{kind:'unsupported'}`. The whole body is wrapped in try/catch returning
  `{kind:'unsupported'}` and `console.error`-ing the reason (the reason only — never the payload).

Constraints: this file must **not** contain the substring `replace(/\D/g` (section 5), and must not
contain the lowercase token `username`.

### 4. Do **not** modify the four existing WhatsApp functions

`send-whatsapp-message/index.ts`, `send-daily-digest-whatsapp/index.ts`,
`send-report-whatsapp/index.ts` and `whatsapp-inbound/index.ts` are untouched by this plan — not
one byte. In particular `scripts/verify-report-whatsapp-payload.mjs` asserts literal regex source
text inside `send-report-whatsapp/index.ts`, and the parity verifier asserts
`TS_NORMALIZER_LITERAL` inside three of them.

### 5. One narrow, additive edit to `scripts/verify-report-whatsapp-parity.mjs`

Adding `_shared/wa-send.ts` makes it a **sixth** JS/TS sweep candidate (it contains
`replace(/\D/g` and `27`), which fails `verify-report-whatsapp-parity.mjs:325` (`assert.equal(
relCandidates.length, 5, …)`) and the `deepEqual` immediately after. The honest, in-repo-precedented
fix — the same mechanism already used for the allowlisted display formatter — is to record the new
file as a known non-canonical hit. Make **exactly** these four changes and nothing else:

1. **Append** (never prepend — `verify-report-whatsapp-parity.mjs:355-361` reads
   `SWEEP_ALLOWLIST[0]` and asserts it is the `formatPhone` file) a second entry to
   `SWEEP_ALLOWLIST`:

   ```js
   {
     file: 'supabase/functions/_shared/wa-send.ts',
     identifier: 'toWaPhone',
     reason:
       "E.164 formatter for ALREADY-INTERNATIONAL numbers — strips non-digits and prefixes '+', " +
       'applies NONE of the three SA rules (no leading-0 substitution, no 27-prefix) and throws on ' +
       'empty input instead of returning the unguarded \'+27\'; uses the same replace(/\\D/g idiom ' +
       "and mentions '+27' in its doc comment, but is not one of the seven",
   }
   ```

2. Change the hardcoded `5` in the JS/TS sweep count assertion (`:325`) to `6`, and update that
   assertion's message text from `expected 5 JS/TS candidates` to `expected 6 JS/TS candidates`.
3. Update the header prose at `:57-60` so it says the JS/TS sweep matches exactly **6** files on
   this tree — rows 1, 2, 3, 6, the allowlisted `crm_whatsapp_contacts_tab.js`, and the allowlisted
   `_shared/wa-send.ts` — and reword the `SWEEP_ALLOWLIST` comment at `:194-195` from "The one
   known non-canonical hit" to cover two entries.
4. Nothing else. Do **not** add a row to `INVENTORY` (`toWaPhone` is not one of the seven
   normalisers — it applies none of the three rules). Do **not** touch `TS_NORMALIZER_LITERAL`, the
   three TS copies, `canonicalPlus`, `expectedFor`, `TRUTH_TABLE_INPUTS`, the pinned cells, the SQL
   assertions, the SQL count of `3`, the `SWEEP_ALLOWLIST[0]` check, or the closing
   "7 implementations" log line.

**Coupling to respect:** because `expectedFiles` is derived from `INVENTORY` + `SWEEP_ALLOWLIST`,
the allowlist entry only balances if `wa-send.ts` really is a sweep candidate. `toWaPhone` must
therefore be written with exactly `.replace(/\D/g, '')` and the file must retain a `+27` mention in
its doc comment. Section 2 requires both, and requires an in-file comment recording the coupling.

This is the only loosening permitted anywhere in this plan. The parity script's header is explicit
that a failure means fix the code, never loosen the script — one documented allowlist append for a
function that is provably not a normaliser is the documented mechanism, not a baseline reset. Do
not suppress, skip, weaken or delete any other assertion in any verifier.

### 6. `scripts/verify-wa-plumbing.mjs`

Pure Node, `node:` builtins only, no network, no DB, no browser, no transpiler, no new dependency —
it runs in the merge gate (`package.json:31`).

**How to test `.ts` here — this is fixed, do not improvise.** `.ts` type annotations are not valid
JS and **cannot** be loaded into a `vm` context; the repo states this in
`verify-report-whatsapp-payload.mjs:12-19` and in the parity script's "Models followed" note. Do
**not** copy a TS-stripping technique from `verify-report-whatsapp-picker.mjs` — that script's
target is a plain `.js` browser module and it strips nothing. Do **not** hand-roll a regex
TS-stripper and do **not** add a transpiler. Use the repo's documented `.ts` pattern
(`verify-report-whatsapp-payload.mjs`):

> **assert the EXACT function source block is still present verbatim in the `.ts` file, then
> re-declare an identical plain-JS copy inside this script and run every behavioural case against
> that copy.** If a future edit changes the `.ts`, the presence assertion fails loudly and names
> what to update. Silent drift is impossible; only a caught one.

This also removes the `Deno.env.get` problem entirely: no `.ts` file is ever evaluated, so
module-scope `Deno` is never touched and **no Deno shim is needed anywhere in this script**.

Decision rule, so no judgement call is left open: **every pure function listed below gets both a
literal-presence assertion and a re-declared-copy behavioural test. Anything that is not pure
(`sendViaControlRoom`, `sendText`, `verifyControlRoomSignature`, the module-scope env constants)
gets a literal/substring assertion only.** There is no third category.

Use the `check()` harness shape from `verify-report-whatsapp-picker.mjs:72-79`, and resolve paths
from `fileURLToPath(import.meta.url)` like the existing scripts — never a hardcoded absolute path
and never a value copied from another script's environment.

Assert:

1. **Base-URL drift, without writing the URL into this script.** Read
   `supabase/functions/send-report-whatsapp/index.ts`, extract the value from
   `const CONTROL_ROOM_BASE_URL = '<value>';` with a regex, and assert `wa-send.ts` contains that
   same `<value>` as its fallback. (Deriving it means this script does not itself hardcode or
   entrench the URL; it only proves the copies agree.)
2. `wa-send.ts` contains `content: { text` and does **not** contain `content: { body`, and
   `buildTextBody`'s copy returns exactly `{ to, type: 'text', content: { text } }`.
3. The four builders' copies produce exactly the documented `type` and `content` shapes, including
   that `components` is **absent** (`!('components' in content)`), not `[]`, when no components are
   passed.
4. A 4th button, a 21-character button label, an 11th list row (across two sections), a
   25-character row title and a 25-character section title each throw `WaSendError`.
5. A `sub_type:'url'` component whose parameter is `https://example.com/x` throws; one whose
   parameter is `wk34-2026` does not.
6. `toWaPhone('27821234567')` and `toWaPhone('+27 82 123 4567')` both give `'+27821234567'`;
   `toWaPhone('')` and `toWaPhone('abc')` both **throw** (they must not yield `'+'` or `'+27'`);
   and `wa-send.ts` carries both the "not an SA normaliser" warning and the
   `SWEEP_ALLOWLIST`-coupling comment.
7. `buildReplyId('rpt','confirm','wk34-2026') === 'rpt:confirm:wk34-2026'`; `parseReplyId` round-trips
   it; `buildReplyId('RPT','x')` and a 25-character segment each throw; `parseReplyId('nonsense')`,
   `parseReplyId('a:b:c:d')` and `parseReplyId('')` each return `null` without throwing.
8. `truncate('abcdef', 6) === 'abcdef'`; `truncate('abcdef', 4) === 'abc…'`;
   `truncate('abcdef', 1) === 'a'`; `truncate('abcdef', 0) === ''`.
9. `paginateRows([1,2], 5)` → `{page:[1,2], hasMore:false}`; `paginateRows([1,2,3], 2)` →
   `page.length === 2`, `hasMore === true`; `paginateRows([1,2,3], 2, 'More')` → `page.length === 1`,
   `hasMore === true`; `paginateRows([1,2,3], 1, 'More')` → `page.length === 1` (never 0),
   `hasMore === true`.
10. `classifyMessage` / `extractMessage` return `button_reply` for **both** an
    `interactive.button_reply` payload **and** a `type:'button'` template-tap payload (once with
    `button.payload` present, once with only `button.text` — the second must still yield a
    `button_reply` with `replyId === replyTitle === button.text`), `list_reply` for a list payload,
    `text` for a text payload, `status` for a `statuses`-only payload, and `unsupported` for `{}`,
    for `null`, for a payload missing `id`, and for `type:'image'`.
11. `sanitizeSenderName('😀😀') === undefined`; `sanitizeSenderName('Thabo Mokoena') === 'Thabo'`;
    `sanitizeSenderName('  ') === undefined`; `sanitizeSenderName(42) === undefined`; a 30-character
    single word is capped at 20.
12. `parseSignatureHeader('sha256=ab12')` → `'ab12'`; `parseSignatureHeader('ab12')`,
    `parseSignatureHeader('sha256=')`, `parseSignatureHeader('sha256=zz')`,
    `parseSignatureHeader(null)` and `parseSignatureHeader(undefined)` each → `null` without
    throwing. `timingSafeEqual('abc','abc')` is `true`; `('abc','abd')` and `('abc','abcd')` are
    `false`.
13. **Unconfirmed-contract markers are present:** `wa-send.ts` contains an `UNCONFIRMED` marker in
    its header, and `wa-send.ts` does **not** contain the strings `sendButtons`, `sendList` or
    `sendTemplate` as exported function declarations (this plan ships builders only).
14. Every literal source block this script re-declares is asserted present verbatim in its `.ts`
    file first, with a failure message naming the file and telling the reader to update both
    together.

Failure output: file-level messages and a non-zero exit, like the existing verifiers. **No
`--update-baseline`, no auto-heal, no skip flag.**

### 7. `package.json`

- Add `"wa-plumbing:verify": "node scripts/verify-wa-plumbing.mjs"` immediately after the existing
  `"report-whatsapp-parity:verify"` entry.
- Append ` && npm run wa-plumbing:verify` to the **end** of the `test:fleet` chain. Leave every
  existing entry in that chain untouched, in place and in the same order, and do not edit the
  `"//test:fleet"` comment.

## Out of scope

No migrations, no SQL, no RBAC rows — those are handled outside the fleet. No changes to the four
existing WhatsApp functions. No new templates submitted. No `sendButtons` / `sendList` /
`sendTemplate` senders (deferred until the `interactive`/`template` shapes are confirmed by
someone with Control Room access). No changes to `scripts/verify-report-whatsapp-parity.mjs` beyond
the four listed in section 5. No changes to any other verifier. No WebPortal or user-guide changes.
Nothing calls these modules yet; the next plans do.

## Verification

Everything below is runnable headless in CI with no network, no login and no deploy. Nothing else
is claimed as verified.

- `npm run wa-plumbing:verify` passes.
- `npm run report-whatsapp-parity:verify` passes **with** the section-5 allowlist append — the JS/TS
  sweep now reports 6 candidates and matches `INVENTORY` + `SWEEP_ALLOWLIST`.
- `npm run report-whatsapp-payload:verify`, `npm run report-whatsapp-picker:verify`,
  `npm run report-whatsapp-history:verify` and `npm run username:verify` all still pass.
- `npm run test:fleet` passes end to end, with every pre-existing check still present in the chain
  and `wa-plumbing:verify` appended last.
- `git diff --stat` shows changes limited to: three new files under `supabase/functions/_shared/`,
  one new file under `scripts/`, the four listed edits to
  `scripts/verify-report-whatsapp-parity.mjs`, and the two `package.json` script edits.
- `grep -c "normalizePhone" supabase/functions/*/index.ts` is unchanged from before your edit.

**If any gate fails, it is a real failure.** Fix the code. Do not attribute a failure to line
endings, to the checkout platform, or to any other environmental cause, and do not weaken,
baseline or skip an assertion to get to green.
