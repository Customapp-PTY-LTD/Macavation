# WhatsApp reports — shared send/parse plumbing for buttons, lists and templates

## Context

Macavation is adding a daily production report that sends itself at 17:00 SAST, and follow-up
answers driven by **tappable WhatsApp buttons and list menus** rather than typed command words.

Every WhatsApp send in this repo currently builds its own payload inline and sends `type: 'text'`
only. There are four near-identical copies of the same signing and phone-normalising code
(`send-whatsapp-message`, `send-daily-digest-whatsapp`, `send-report-whatsapp`, `whatsapp-inbound`),
kept byte-identical by `scripts/verify-report-whatsapp-parity.mjs`. Four more functions are about to
need buttons, lists and templates. This plan creates the shared module they will all import, so the
next four plans do not each invent their own.

**The payload shapes below are confirmed, not guessed.** They were read out of Control Room's
deployed `meta-proxy` source (its `shapeMetaContent(type, content)` function), which reshapes
`content` per `type` and then builds
`{ messaging_product, recipient_type: 'individual', to, type, [type]: metaContent }`. Do not
"correct" them against Meta's public docs — where the two disagree, the proxy is what actually runs.

**Do not modify the four existing functions.** They keep their own inline copies and their parity
verifier keeps passing. This plan only *adds* modules for new code to use. Migrating the old four is
deliberately out of scope.

**You cannot deploy edge functions, reach a database, or reach another repository.** Author files
only. Everything here is pure TypeScript plus one Node verifier — no network, no DB, no deploy.

## Read first

| File | Why |
|---|---|
| `supabase/functions/send-report-whatsapp/index.ts:33`, `:148-153`, `:434-440` | the live send: base URL, `normalizePhone`, HMAC signing, `{action,channelSlug,to,type,content}` body, `{ok,wamid,error}` response |
| `supabase/functions/whatsapp-inbound/index.ts:52`, `:101-111`, `:118-158`, `:195-236` | inbound: bare-digit `from`, `timingSafeEqual`, message-body extraction, the duplicated sender |
| `scripts/verify-report-whatsapp-parity.mjs` | the existing parity gate — understand it so you do not break it |
| `scripts/verify-report-whatsapp-payload.mjs:46-52` | asserts literal regex source text in `send-report-whatsapp`; that file must stay untouched |
| `BluePrint/secrets-management-rules.md` | how secrets are read in this repo |

## Work

### 1. `supabase/functions/_shared/wa-limits.ts`

Meta's hard caps. A send that violates one is rejected outright, so callers truncate *before*
sending rather than discovering it from a failure.

```ts
export const MAX_LIST_TITLE = 24      // characters in one list row title
export const MAX_LIST_SECTION = 24    // characters in a list section title
export const MAX_BUTTON_CTA = 20      // characters in a button label
export const MAX_BUTTONS = 3          // quick-reply buttons per interactive message
export const MAX_LIST_ROWS = 10       // total rows across all sections of one list
```

Plus two helpers:

- `truncate(s: string, max: number): string` — returns `s` unchanged when `s.length <= max`;
  otherwise `s.slice(0, max - 1) + '…'`. When `max <= 1`, return `s.slice(0, max)`.
- `paginateRows<T>(rows: T[], maxRows: number, moreLabel?: string): { page: T[]; hasMore: boolean }`
  — when `rows.length <= maxRows` return `{page: rows, hasMore: false}`. Otherwise, if `moreLabel`
  was supplied reserve one slot (`page` is `maxRows - 1` long) so the caller can append its own
  "show more" row; without `moreLabel` cap hard at `maxRows`. `hasMore` reports the overflow either
  way.

### 2. `supabase/functions/_shared/wa-send.ts`

Doc-comment header in the house style (`send-report-whatsapp/index.ts:1-32`) naming every
environment variable read and stating that the payload shapes were verified against `meta-proxy`.

Environment, read once at module scope:

```ts
const CONTROL_ROOM_URL = Deno.env.get('CONTROL_ROOM_URL')
  ?? 'https://ejnncypummmvyojhovme.supabase.co/functions/v1/meta-proxy'
const FORWARD_SECRET = Deno.env.get('CONTROL_ROOM_FORWARD_SECRET') ?? ''
const CHANNEL_SLUG   = Deno.env.get('CONTROL_ROOM_CHANNEL_SLUG') ?? ''
```

⚠ **Two facts about these that cost other projects a day each — put both in the header comment:**

- That default URL is the **devtools** project and is **correct**. Control Room split into two
  Supabase projects on 2026-08-17: message sending deliberately stayed on the old project
  (`ejnncypummmvyojhovme`), while template *submission* moved to the new one. Both projects have
  both APIs deployed and both look healthy, so pointing this at the newer ref silently breaks
  sending. Do not "fix" it.
- `CONTROL_ROOM_CHANNEL_SLUG` is the channel's **WebhookSlug** (`macavation-9349`), **not** its
  ChannelCode (`macavation`). The wrong one 404s every outbound send while inbound routing looks
  perfectly healthy.

**Pure body builders** — no network, exported individually so the verifier can unit-test them:

```ts
buildTextBody(to, body)            // type:'text',     content:{ body }
buildButtonsBody(to, bodyText, buttons)   // buttons: {id,title}[]
buildListBody(to, bodyText, buttonLabel, sections)
buildTemplateBody(to, templateName, languageCode, components?)
```

Exact `content` shapes:

- text → `{ body }`
- interactive buttons → `type: 'interactive'`, `content:`
  `{ type:'button', body:{text}, action:{ buttons: [{ type:'reply', reply:{ id, title } }] } }`
- interactive list → `type: 'interactive'`, `content:`
  `{ type:'list', body:{text}, action:{ button: buttonLabel, sections } }`
  where each section is `{ title, rows: [{ id, title }] }`
- template → `type: 'template'`, `content:` `{ name, language:{ code }, components? }`, and
  `components` omitted entirely when empty. Component shape:
  `{ type:'header'|'body'|'button', sub_type?:'url'|'quick_reply', index?, parameters:[{type:'text',text}] }`

All four wrap to `{ action:'send_message', channelSlug: CHANNEL_SLUG, to, type, content }`.

**Validation, throwing a `WaSendError` before any network call:**

- `buildButtonsBody` — reject more than `MAX_BUTTONS`; reject any `title` longer than
  `MAX_BUTTON_CTA`. Do not silently truncate a button label: a clipped label changes what the
  recipient is agreeing to.
- `buildListBody` — reject more than `MAX_LIST_ROWS` rows in total across sections; reject any row
  or section `title` over 24 characters.
- A template **URL-button parameter must be only the suffix that replaces `{{1}}`** in the
  template's base URL (e.g. `wk34-2026`), never a full URL. Reject a parameter matching
  `/^https?:\/\//i` on a `sub_type: 'url'` component with a message saying to pass only the suffix.
  Passing a full URL is Meta error 100/2388052; `meta-proxy` rejects it too, but failing here skips
  the round trip.

**Phone handling — read this carefully, it is the easiest thing to get wrong.**

`toWaPhone(phone: string): string` converts an **already-international** number to E.164 by
stripping non-digits and prefixing `+`. It is for inbound Meta `from` values (bare international
digits) and for numbers already stored in `+27…` form.

⚠ **It is NOT a South African normaliser and must never be used as one.** A local `0821234567`
becomes `+0821234567`, which is not a phone number. Local-format numbers are canonicalised to
`+27…` by the database (`report_normalize_wa_phone`, `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:46`)
before they ever reach this module, and every recipient list is keyed on that. State this in the
function's doc comment. Do **not** re-implement SA normalisation here, and do **not** touch the
four existing `normalizePhone` copies or their parity verifier.

**Signing and posting:**

- `hmacSha256Hex(secret, body)` — exported for the verifier.
- `sendViaControlRoom(payload)` — private. `JSON.stringify` the payload **once**, sign that exact
  string, POST it with `X-Control-Room-Signature: sha256=<hex>`. Signing a re-serialised copy is a
  silent 401.
- Return `{ ok: boolean; wamid: string | null; error: string | null }`. **Return a result, do not
  throw on a gateway failure** — callers write a per-recipient audit row and must record the
  gateway's own words verbatim. Throw only for missing configuration or a validation error.
- If `FORWARD_SECRET` or `CHANNEL_SLUG` is empty, return
  `{ ok:false, wamid:null, error:'Control Room is not configured' }` rather than attempting a send.

Then the thin senders, each `builder` + `sendViaControlRoom`: `sendText`, `sendButtons`, `sendList`,
`sendTemplate`.

### 3. `supabase/functions/_shared/wa-inbound.ts`

`verifyControlRoomSignature(rawBody, signatureHeader, secret): Promise<boolean>` — returns `false`
(never throws) for a missing/malformed header, empty secret, or mismatch. Compare with the existing
constant-time helper (`whatsapp-inbound/index.ts:101-111`). Callers must verify **before parsing the
body at all**.

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

Read `entry[0].changes[0].value`; the message is `value.messages[0]`. With no message, return
`{kind:'status'}` if `value.statuses` is a non-empty array, else `{kind:'unsupported'}`. Require
`from`, `id` and `type` to all be strings or return `unsupported`. `senderName` comes from
`value.contacts[0].profile.name`, sanitised: first whitespace-delimited word, newlines stripped,
capped at 20 chars, and **discarded unless it contains at least one letter** — a display name is
free text the user chose and can be emoji-only.

Three inbound shapes map onto the type above:

| Meta shape | Becomes |
|---|---|
| `type:'text'`, `msg.text.body` | `kind:'text'` |
| `type:'interactive'`, `msg.interactive.type === 'button_reply'`, `.button_reply.{id,title}` | `kind:'button_reply'` |
| `type:'interactive'`, `msg.interactive.type === 'list_reply'`, `.list_reply.{id,title}` | `kind:'list_reply'` |

⚠ **And a fourth that is easy to miss and is load-bearing for this whole feature.** Tapping a
quick-reply button on an **approved template** does not arrive as `interactive` at all — it arrives
as `type: 'button'` with `msg.button.payload` and `msg.button.text`. Map it to the **same**
`kind:'button_reply'`, with `replyId = msg.button.payload` and `replyTitle = msg.button.text`.
Without this branch every tap on the daily report's buttons is silently ignored. Put a comment
saying so, because it looks like dead code next to the `interactive` branch.

Wrap the whole body in try/catch returning `{kind:'unsupported'}` and `console.error` the reason.

### 4. `scripts/verify-wa-plumbing.mjs`

Pure Node, no network, no DB, no browser — it runs in the merge gate. Follow the shape of
`scripts/verify-report-whatsapp-picker.mjs`, which already loads a module in a bare `vm` context.
These are `.ts` files, so strip the type annotations the same way that verifier handles its target,
or assert against the file's source text where evaluating is impractical. Assert:

1. `wa-send.ts` contains the devtools base URL `ejnncypummmvyojhovme` **and** a comment saying it is
   deliberate — a future reader must not "upgrade" it.
2. The four builders produce exactly the documented `type` and `content` shapes, including that
   `components` is absent (not `[]`) when no components are passed.
3. A 4th button, a 21-character button label, an 11th list row, and a 25-character row title each
   throw.
4. A `sub_type:'url'` component whose parameter is `https://example.com/x` throws; one whose
   parameter is `wk34-2026` does not.
5. `toWaPhone('27821234567')` and `toWaPhone('+27 82 123 4567')` both give `+27821234567`, and
   `wa-send.ts` carries the comment warning it is not an SA normaliser.
6. `extractMessage` returns `button_reply` for **both** an `interactive.button_reply` payload and a
   `type:'button'` template-tap payload, `list_reply` for a list payload, `status` for a `statuses`
   payload, and `unsupported` for `{}`.
7. An emoji-only `profile.name` yields `senderName === undefined`.

Register it in `package.json` as `wa-plumbing:verify` and append it to the end of the `test:fleet`
chain. Leave every existing entry in that chain untouched and in place.

## Out of scope

No migrations, no SQL, no RBAC rows — those are handled outside the fleet. No changes to the four
existing WhatsApp functions. No new templates submitted. Nothing calls these modules yet; the next
plans do.

## Verification

- `npm run wa-plumbing:verify` passes.
- `npm run test:fleet` passes end to end, with the pre-existing checks still present.
- `grep -c "normalizePhone" supabase/functions/*/index.ts` is unchanged from before your edit, and
  `npm run report-whatsapp-parity:verify` still passes — proof the existing four were left alone.

**If `report-whatsapp-parity:verify` reports 3 violations on a Windows checkout, check line endings
before believing it** — CRLF produces a false failure there. Confirm with `git ls-files --eol` on the
files it names.
