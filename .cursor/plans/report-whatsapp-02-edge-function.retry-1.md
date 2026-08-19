---
notify: henry@customapp.co.za
retry_of: 141387b1-7424-4422-b178-b2f499cedc86
---

# Report WhatsApp distribution, part 2 — the `send-report-whatsapp` edge function

## Context

Sending a published Sales & Production report to selected WhatsApp numbers needs one server-side
step: file the report's PDF somewhere private, mint a time-limited signed link to it, and send that
link as a WhatsApp message to each chosen number, logging every attempt.

It has to be server-side, and it has to be an edge function, for a reason worth stating up front:
**the portal browser holds no Supabase auth JWT.** It authenticates every call with the publishable
key plus a custom session token in an `X-Portal-Session` header (see `sendWhatsappMessageNow` in
`WebPortal/js/data-functions.js`, around lines 5863-5881). So `auth.uid()` is always NULL for portal
traffic, and Supabase Storage RLS cannot be used to scope an upload to a user. The `report-pdfs`
bucket is therefore private with **no policy at all**, reachable only by the service-role key —
which must never be in the browser. Everything in this function exists to be the one place that
holds it.

This plan **cannot deploy and cannot apply a migration**: the fleet has no Supabase credentials and
no network path to any project. Both applying the migration and deploying the function are **human
steps** (exact commands in "Handover", below). Say so in the report rather than implying anything is
live.

## CORRECTION TO THE PREVIOUS DRAFT OF THIS PLAN — read this first

An earlier draft of this plan asserted that its whole database foundation already existed in this
checkout and had been applied to dev. **That was false, and you must not act on it.** Verify this
yourself before writing anything else, and record the result in the report:

```
ls migrations/20260822*                                            # -> no such files
grep -rn "begin_report_delivery\|complete_report_delivery\|record_report_pdf_storage\|report-pdfs" . 
grep -rn "reports\.report\.send" .
```

All of these return nothing. There is no delivery-log table, no `report-pdfs` bucket, no
`reports.report.send` action row, and none of the three RPCs. **Do not invent them silently and do
not assume any of them exist at runtime.** This plan now authors that foundation itself, as
Deliverable A, and the edge function is written against the SQL you author here — that SQL, not any
prose in this plan, is the contract.

Line numbers quoted anywhere below are approximate pointers into files that do exist. **Open the
file and read the surrounding block; never copy from a line number alone.** If a quoted line number
does not contain what this plan says it does, trust the file and note the discrepancy in the report.

## Grounding — what actually exists in this checkout (verify each before use)

- `supabase/functions/send-whatsapp-message/index.ts` (159 lines) — the send primitive to model on.
  Contains `CONTROL_ROOM_BASE_URL`, `corsHeaders` (including `x-portal-session, X-Portal-Session`),
  `makeServiceClient()`, the `rpc()` helper, `validateSession()`, `normalizePhone()`, `signBody()`,
  the 503 when `CONTROL_ROOM_FORWARD_SECRET`/`CONTROL_ROOM_CHANNEL_SLUG` are unset, the request body
  shape `{ action: 'send_message', channelSlug, to, type: 'text', content: { text } }`, and the
  `!res.ok || !result.ok` → 502 check with `result.wamid` as the message id.
- `supabase/functions/whatsapp-inbound/index.ts` — the comment block at ~:174-186 says TEXT ONLY,
  and says do not add a service-role bypass to `send-whatsapp-message`.
- `supabase/functions/send-daily-digest-whatsapp/index.ts:18-40` — `formatWhatsAppText`, the message
  formatting style to copy.
- `migrations/20260716160000_portal_assistant_chat.sql` (~:271-274) — `assistant_validate_session`
  returns `(user_id uuid, role_name text, email text)`.
- `migrations/20260815110000_generic_has_action_gate.sql:42-68` — **`public.has_action(p_user_id
  uuid, p_action_key text) RETURNS boolean`**, `SECURITY DEFINER`, granted to `service_role` only
  (:88-89). Read its header comment at :34-40 in full before writing the gate in this function.
- `migrations/20260817100000_report_instances_and_targets.sql` — `public.report_instances` already
  has `status` (CHECK in `draft|published|superseded`), `published_at`, `executive_summary`,
  `pdf_storage_bucket`, `pdf_storage_path`, `pdf_sha256`, `content_sha256` (:124-152), RLS enabled
  with `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and `GRANT ... TO service_role` (:164-166).
  `get_report_instance(uuid)` returns a JSONB payload including `period_label`, `status`,
  `executive_summary`, `published_at` (:722-741) and **returns NULL when the id is unknown**.
- `migrations/20260817110000_report_builder_rbac.sql` — the seeding convention for
  `public.actions` / `public.role_actions` (`actions.module` is NOT NULL and must be supplied;
  `role_actions.value` is TEXT and the literal `'true'` is used, never a boolean).
- `migrations/20260817090000_report_builder_foundations.sql:30-41` —
  `public.report_touch_updated_at()`, the trigger function the report tables use for `updated_at`.
- `package.json` — `test:fleet` at :28 and the `"//test:fleet"` comment at :27 requiring it stay
  "FAST and HERMETIC: pure Node stdlib, no browser, no login, no network, no deployed app."

**Message type is `text`, and only `text`.** The meta-proxy contract for anything other than plain
text is unconfirmed from this repo (`whatsapp-inbound/index.ts` ~:174-186). This function sends
`type: 'text'` carrying a link. **Do not attempt a document/attachment send.**

**Supabase Storage from Deno** — `sb.storage.from(bucket).upload(path, body, opts)` and
`sb.storage.from(bucket).createSignedUrl(path, expiresInSeconds)`. This is the FIRST use of Storage
anywhere in this project; `grep -rn "storage.from(\|createSignedUrl\|/storage/v1/object" WebPortal/ supabase/functions/`
returns nothing, so there is **no in-repo precedent to copy**. Treat both call shapes as taken from
the library's documented API, not from this checkout, mark them as such in a code comment, and
handle their `{ data, error }` results explicitly.

## Deliverables — FOUR files, not one

This plan creates three new files and edits one. All four are required; do not drop any of them.

1. `migrations/20260822090000_report_whatsapp_delivery_log.sql` — new (Deliverable A)
2. `supabase/functions/send-report-whatsapp/index.ts` — new (Deliverable B)
3. `scripts/verify-report-whatsapp-payload.mjs` — new (Deliverable C)
4. `package.json` — edited, to wire Deliverable C into `test:fleet` (Deliverable C)

---

## Deliverable A — `migrations/20260822090000_report_whatsapp_delivery_log.sql`

Author the file; **do not attempt to apply it**. Filename prefix `20260822090000` is a valid UTC
timestamp and is unused in `migrations/` — keep it, or pick another valid unused 14-digit UTC
prefix, because `npm run migrations:verify` (part of `test:fleet`) fails on an invalid or duplicate
prefix and on any non-`.sql` file or subdirectory in `migrations/`.

Open with a header comment covering: what this adds, that it is NOT applied by this plan, the apply
commands, and the grant rationale below.

### A1. Delivery log table

```sql
CREATE TABLE IF NOT EXISTS public.report_whatsapp_deliveries (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_instance_id  uuid NOT NULL REFERENCES public.report_instances (id) ON DELETE CASCADE,
    recipient_id        uuid NULL,          -- no FK: the recipients table is a separate plan
    phone               text NOT NULL,
    display_name        text NULL,
    message_body        text NULL,
    pdf_storage_bucket  text NULL,
    pdf_storage_path    text NULL,
    link_expires_at     timestamptz NULL,
    status              text NOT NULL DEFAULT 'pending',
    external_message_id text NULL,
    error               text NULL,
    sent_by             uuid NULL REFERENCES public.users (id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_whatsapp_deliveries_status_check
        CHECK (status IN ('pending', 'sent', 'failed'))
);
```

- `recipient_id` is deliberately **not** a foreign key and this migration does **not** create a
  recipients table — say so in a column comment. A recipients table is a separate plan; adding a FK
  to a table that does not exist would fail to apply.
- Follow `report_instances` (:164-166) exactly for access control:
  `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;`,
  `REVOKE ALL ON public.report_whatsapp_deliveries FROM PUBLIC, anon, authenticated;`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_whatsapp_deliveries TO service_role;`
  **No policies** — the table is reachable only through the service-role key.
- Indexes on `report_instance_id`, `status`, and `sent_by`.
- `updated_at` trigger reusing `public.report_touch_updated_at()`, same shape as
  `trg_report_instances_updated_at` (:188-191).

### A2. The three RPCs

Declare each `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, matching the style of
`publish_report_instance` (:804-815), and each returning the repo's `(success integer, error text, ...)`
result shape rather than raising:

```sql
begin_report_delivery(p_report_instance_id uuid, p_phone text, p_display_name text DEFAULT NULL,
                      p_recipient_id uuid DEFAULT NULL, p_message_body text DEFAULT NULL,
                      p_pdf_storage_bucket text DEFAULT NULL, p_pdf_storage_path text DEFAULT NULL,
                      p_link_expires_at timestamptz DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
  RETURNS TABLE (success integer, error text, id uuid)

complete_report_delivery(p_delivery_id uuid, p_status text,
                         p_external_message_id text DEFAULT NULL, p_error text DEFAULT NULL)
  RETURNS TABLE (success integer, error text)

record_report_pdf_storage(p_report_instance_id uuid, p_bucket text, p_path text,
                          p_sha256 text DEFAULT NULL)
  RETURNS TABLE (success integer, error text)
```

Behaviour:
- `begin_report_delivery` inserts one row with `status = 'pending'` and returns its id. If
  `p_report_instance_id` does not exist, or the instance's `status <> 'published'`, return
  `(0, '<reason>', NULL)` — the publish gate belongs in the database as well as in the function.
  Blank/NULL `p_phone` returns `(0, 'Phone is required.', NULL)`.
- `complete_report_delivery` rejects any `p_status` other than `'sent'` or `'failed'` with
  `(0, ...)`, and updates only a row currently in `'pending'`. Store `p_error` verbatim; do not
  parse, classify or truncate it.
- `record_report_pdf_storage` sets `pdf_storage_bucket`, `pdf_storage_path`, `pdf_sha256` on the
  instance. It must **never** change `status`, `published_at` or `content_sha256`.

### A3. Grants — service_role ONLY (this is the security control, state it in the file)

```sql
REVOKE ALL ON FUNCTION public.begin_report_delivery(uuid, text, text, uuid, text, text, text, timestamptz, uuid)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_report_delivery(...) TO service_role;
-- same REVOKE + GRANT pair for complete_report_delivery and record_report_pdf_storage
```

**Do NOT follow the `GRANT ... TO anon, authenticated, service_role` pattern used for the report
read/write RPCs at `migrations/20260817100000_report_instances_and_targets.sql:1260-1277.`** That
pattern exists because the browser calls those RPCs with the publishable key; these three are called
only by the edge function holding the service-role key. Granting them to `anon` would let anyone
holding the shipped publishable key forge or overwrite delivery-log rows and rewrite an instance's
PDF pointer. Follow instead `migrations/20260815110000_generic_has_action_gate.sql:88-89`, and put
that reasoning in a comment.

**Add no `role_permissions` rows for these three functions**, for the same reason
`20260815110000_generic_has_action_gate.sql:81-86` adds none: they are not callable from the portal.
Do not follow `docs/RBAC_GUIDE.md`'s grant-to-every-role pattern.

### A4. The `reports.report.send` action row

Seed it exactly as `migrations/20260817110000_report_builder_rbac.sql:82-103` does:

```sql
INSERT INTO public.actions (key, module, label, description)
VALUES ('reports.report.send', 'Sales Reporting', 'Send Report on WhatsApp',
        'Send a published report to WhatsApp recipients')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_actions (role_id, action_id, value)
SELECT r.id, a.id, 'true'
FROM public.roles r
CROSS JOIN (SELECT id FROM public.actions WHERE key = 'reports.report.send') a
WHERE r.role_name IN ('super_user', 'admin', 'Sales Exec', 'Palladium Manager')
ON CONFLICT (role_id, action_id) DO NOTHING;
```

The literal `'true'` is mandatory: `role_actions.value` is TEXT, and `has_action` tests
`COALESCE(ra.value, '') = 'true'`, so a NULL or absent value **denies**. Do not loop over every
role — `CLAUDE.md:38-39` records that as the cause of this repo's permission drift.

### A5. Storage bucket `report-pdfs`

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('report-pdfs', 'report-pdfs', false, 26214400, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
```

Comment this block honestly: **there is no in-repo precedent for creating a bucket in a migration**
(`grep -rn "storage.buckets" migrations/` returns nothing; the only mention anywhere is a commented
example in `supabase/config.toml`), so this statement is taken from Supabase's documented
`storage.buckets` schema, not from this checkout. Record in the same comment, and in the report,
that if applying it fails on privileges the human must instead create the bucket in the dashboard as
**private**, `file_size_limit` 26214400, `allowed_mime_types` `application/pdf`, and **with no
storage policies** — a policy would be pointless here because portal traffic has no `auth.uid()`.

End the file with `NOTIFY pgrst, 'reload schema';`.

---

## Deliverable B — `supabase/functions/send-report-whatsapp/index.ts`

Open it with the same header-comment style as its two siblings: what it does, the deploy command,
the secrets it needs, the auth convention, the Control Room docs URL, **and an explicit line saying
it requires `migrations/20260822090000_report_whatsapp_delivery_log.sql` to have been applied
first.**

### Request

`POST` with headers `Authorization: Bearer <anonKey>`, `apikey`, `X-Portal-Session`, and a JSON body:

```json
{
  "report_instance_id": "<uuid>",
  "pdf_base64": "<base64, no data: prefix>",
  "filename": "Macavation-August-2026.pdf",
  "recipients": [ { "recipient_id": "<uuid|null>", "phone": "0821234567", "display_name": "Pete" } ]
}
```

### Sequence

1. `OPTIONS` → `'ok'` with `corsHeaders`, exactly as the sibling does.
2. `validateSession` — **copy it verbatim from `send-whatsapp-message/index.ts` (~:46-63), including
   its fail-closed behaviour** (empty result = 401, RPC exception = 503). It returns
   `{ userId }` and **discards `role_name`. Do not change it, and do not write any code in this
   function that reads `role_name` from it.** On failure return its status and message unchanged.
3. **Authorise the action server-side with the gate this repo already has.** The UI gates the
   button, but a caller holding a valid session could POST directly.

   ```ts
   const gate = await rpc(sb, 'has_action', {
     p_user_id: sessionOrErr.userId,
     p_action_key: 'reports.report.send',
   });
   const allowed = gate?.[0]?.has_action === true || gate?.[0] === true;
   if (!allowed) return 403;
   ```

   Constraints, all mandatory:
   - **Use `public.has_action(p_user_id, p_action_key)`** (`migrations/20260815110000_generic_has_action_gate.sql:42-68`).
     Do **not** hand-roll an inline `role_actions`/`actions`/`roles` join. `has_action` already
     encodes NULL-denies (`COALESCE(ra.value, '') = 'true'`), the `users.is_active` check, and
     fail-closed-on-bad-input.
   - **No always-allowed-role bypass. Do not special-case `super_user`, `admin` or any other role
     name here.** `CLAUDE.md:34-39` scopes the always-allowed shortcut to the *button* layer
     (`WebPortal/js/action-access.js`, whose own header at :7-9 calls it a UI "defensive fallback"),
     and `20260815110000_generic_has_action_gate.sql:34-40` forbids mirroring it server-side in
     terms. Those roles reach this endpoint through the `role_actions` row seeded in A4.
   - `p_user_id` comes from the validated session **only** — never from the request body.
   - Because `rpc()` throws on error, wrap this call in try/catch and treat a throw as **503, deny**
     (an unavailable gate is not an allow). An `allowed === false` is **403**. Never fall through.
4. Validate the body and **fail before touching storage**:
   - `report_instance_id` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` → else 400.
   - `recipients` is a non-empty array, at most **25** entries → else 400. State the cap in the
     response message so the UI can show it.
   - `filename` matches the module-level constant
     `const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.pdf$/;`
     This is an allowlist, not a truthiness check: the value comes from the browser and is used to
     build a storage object path, so anything containing `/`, `\`, `..`, a control character or a
     NUL must be rejected outright rather than sanitised. Trace this regex by hand against
     `../../etc/passwd`, `a/b.pdf`, `..pdf`, `report.pdf.exe` and `report.pdf` before you finish —
     the first four must be rejected, the last accepted.
   - `pdf_base64` matches the module-level constant `const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;`
     and decodes to **at least 1 KB and at most 20 MB**. Reject a `data:` prefix rather than
     stripping it. Decode with `Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))` inside a
     try/catch → 400 on failure.
   - The decoded bytes must begin with the PDF magic number `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`),
     checked by a module-level helper `function looksLikePdf(bytes: Uint8Array): boolean`. The
     bucket restricts `allowed_mime_types` to `application/pdf`, but that trusts a declared content
     type; this checks the actual bytes. → else 400.
   - **Each recipient's phone must pass a digit check before it is normalised.** Define
     `const PHONE_DIGITS_RE = /^\d{9,15}$/;` and test it against `String(phone).replace(/\D/g, '')`.
     This is not tidiness: `normalizePhone` (copied verbatim from the sibling) turns `''` or a
     non-numeric string into the bare country code `'+27'`, because its `!p.startsWith('27') &&
     p.length <= 11` branch prepends `27` to an empty digit string. In the sibling that is harmless
     — a single `to` guarded by an earlier truthiness check — but here it would send a confidential
     report link to a garbage number inside a loop. A recipient failing `PHONE_DIGITS_RE` is
     recorded in `results` with `status: 'failed'` and an explanatory `error`, and **is not sent
     and not passed to `begin_report_delivery`**. Do not modify `normalizePhone` itself.
5. Fetch the report with `get_report_instance(report_instance_id)`. Note the copied `rpc()` helper's
   own edge-case behaviour at this new call site: it returns `[]` when the RPC yields NULL and
   `[payload]` when it yields a JSONB object, so **`rows.length === 0` is the 404 branch** and
   `rows[0]` is the payload — do not test `rows[0] === null`. **If the payload's `status` is not
   `'published'` → 409** with a clear message. A draft must never leave the building: the PDF
   builder watermarks a draft, but nothing else stops it being sent, and once a number has it there
   is no recall. Treat `period_label`, `executive_summary` and `published_at` as possibly absent and
   code defensively.
6. **Upload once.** Compute `sha256` of the bytes with `crypto.subtle.digest('SHA-256', bytes)` →
   hex. Object path: `` `${report_instance_id}/${sha256.slice(0, 12)}-${filename}` `` —
   content-addressed, so re-sending the same report reuses one object and a changed report cannot
   overwrite the bytes an earlier recipient's link points at. Upload with
   `{ contentType: 'application/pdf', upsert: true }` (`upsert: true` makes a re-send of identical
   bytes idempotent rather than an error). On an upload error → 502 with the storage message; do not
   proceed to send. If the error indicates the bucket does not exist, say so in the message — that
   means Deliverable A has not been applied.
7. `record_report_pdf_storage(report_instance_id, 'report-pdfs', path, sha256)`. A failure here is
   **logged and non-fatal** — it records provenance; it must not stop a send that is otherwise
   ready. Say so in a comment.
8. `createSignedUrl(path, 60 * 60 * 24 * 30)` — 30 days. Compute `link_expires_at` as
   `new Date(Date.now() + 30 * 86400 * 1000).toISOString()`. On error → 502.
9. **Build the message text server-side, from the database payload — never from the request body.**
   The browser must not be able to choose what text goes to an arbitrary phone number. Model the
   formatting on `send-daily-digest-whatsapp/index.ts:18-40` (`formatWhatsAppText`) — plain lines
   joined with `\n`, an em-dash for a missing value, no Markdown:

   ```
   Macavation — <period_label> Sales & Production report
   Published <published_at as yyyy-mm-dd>

   <executive_summary, collapsed whitespace, truncated to 400 chars with an ellipsis>

   Full report (PDF, link valid 30 days):
   <signedUrl>
   ```

   If `executive_summary` is empty, omit that block and its blank line rather than sending a gap.
10. **For each recipient, in sequence** (not `Promise.all` — a partial failure must leave a coherent
    log, and the recipient cap keeps this fast enough):
    a. Compute `const to = normalizePhone(recipient.phone)` **only after** that recipient passed
       `PHONE_DIGITS_RE` in step 4.
    b. `begin_report_delivery(...)` with **that same normalised `to`** (so the log and the gateway
       agree on what was dialled), the display name, recipient id, the message body, `'report-pdfs'`,
       the path, `link_expires_at`, and the session's `userId`. If it returns `success = 0`, record
       the reason in the results array and **skip the send** — an unlogged send is exactly what the
       two-step log exists to prevent.
    c. POST to the meta-proxy, signed, `type: 'text'`.
    d. `complete_report_delivery(deliveryId, 'sent', wamid, null)` or
       `complete_report_delivery(deliveryId, 'failed', null, <the gateway's own message>)`.
       **Pass the gateway's error text through verbatim.** A WhatsApp send can fail for reasons the
       portal cannot anticipate — falling outside Meta's 24-hour customer-service window being the
       likeliest — and a generic "failed" hides the only actionable detail. This is unconfirmed from
       this checkout: nothing here has ever seen that gateway's rejection payload, so do not
       hard-code, parse or classify its shape. Store it and move on.
    e. One recipient's failure must never abort the loop. Wrap each iteration in try/catch.
11. Respond `200` with
    `{ success: true, sent, failed, pdf_storage_path, link_expires_at, results: [ { phone, display_name, status, external_message_id, error } ] }`.
    Return 200 even when every send failed — the request itself succeeded, and the per-recipient
    detail is in `results`. The UI (part 3) renders that list.

### Security invariants to state in the code, not infer

- **Never log `pdf_base64`, the decoded bytes, or the signed URL.** The signed URL is a bearer
  credential for a confidential document; a log line containing it is a leak that outlives the
  request. Log the object path and the byte length instead.
- **The service-role key never leaves this function.** No part of the response includes it, and the
  response never includes the signed URL either — the browser has no need for it, and part 3's plan
  does not ask for it.
- **Fail closed on every auth check**: an unvalidatable session is 401/503, an unavailable
  `has_action` is 503, a user without the action is 403. Never fall through to a send.
- **No role-name shortcut anywhere in this file.**
- **The filename allowlist is a security control, not tidiness** — it composes a storage path.
- **The phone digit check is a security control** — it stops `normalizePhone`'s `+27` fallback from
  addressing a confidential link to a bare country code.
- `type: 'text'` only, per `whatsapp-inbound/index.ts` ~:174-186.

---

## Deliverable C — `scripts/verify-report-whatsapp-payload.mjs` + `package.json`

A pure-Node unit check of the function's pure validators. Follow the established pattern of
`scripts/verify-ui-standard.mjs` / `scripts/verify-migration-prefixes.mjs`: pure `fs` + `assert`,
exit non-zero on failure, **no new dependency and no test framework** — `package.json:27` requires
`test:fleet` to stay "FAST and HERMETIC: pure Node stdlib, no browser, no login, no network, no
deployed app."

Read `supabase/functions/send-report-whatsapp/index.ts` as text, assert that the literals for
`FILENAME_RE`, `BASE64_RE` and `PHONE_DIGITS_RE` are present (fail with a clear message naming the
missing constant if a rename drifts them apart), then re-test the same three regexes in Node:

- `FILENAME_RE`: reject `../../etc/passwd`, `a/b.pdf`, `..pdf`, `report.pdf.exe`, `''`,
  `'x'.repeat(90) + '.pdf'`; accept `Macavation-August-2026.pdf`, `r.pdf`
- `BASE64_RE`: reject `'data:application/pdf;base64,AAAA'`, `'A A A'`, `'****'`; accept `'QUJDRA=='`
- `PHONE_DIGITS_RE` (applied to `String(v).replace(/\D/g, '')`): reject `''`, `'abc'`, `'+'`,
  `'12345'`; accept `'0821234567'`, `'+27 82 123 4567'`
- magic number: a `Uint8Array` starting `%PDF-` accepted; one starting `PK` rejected (re-implement
  the two-line byte check in the script; do not import from the `.ts`)

Also assert, as a cheap guard against the mistake this plan exists to correct, that
`migrations/20260822090000_report_whatsapp_delivery_log.sql` exists and contains the strings
`begin_report_delivery`, `complete_report_delivery`, `record_report_pdf_storage`,
`reports.report.send` and `report-pdfs`.

Wire it into `package.json` alongside the existing named verify scripts:

```json
"reportsend:verify": "node scripts/verify-report-whatsapp-payload.mjs",
```

and append `&& npm run reportsend:verify` to the end of the existing `test:fleet` chain. **Leave the
`"//test:fleet"` comment key at :27 unchanged**, and change nothing else in `package.json`.

Blast radius on existing checks, all of which must still pass unchanged: `migrations:verify` now
sees one more file (valid unique prefix required — see A); `verify-phase2-migrations.mjs` checks a
fixed list and is unaffected; `reports:verify`, `registry:verify`, `ui:verify`, `routing:verify` and
`username:verify` all read `WebPortal/` or fixed paths this plan does not touch. Do not edit any
existing script.

---

## Verify before finishing

Every check runs inside the checkout with no network, no browser and no Supabase project.

1. **Type-check the function**: `npx --yes deno@1.45.5 check supabase/functions/send-report-whatsapp/index.ts`.
   If Deno cannot be fetched in the run environment, say so plainly and fall back to check 2 —
   do NOT report a check as passing that you could not run.
2. `npm run reportsend:verify` passes.
3. `npm run test:fleet` passes with the new script included.
4. `grep -n "pdf_base64\|signedUrl\|signed_url" supabase/functions/send-report-whatsapp/index.ts`
   and confirm by inspection that no match sits inside a `console.log`/`console.error`/`console.warn`
   argument.
5. `grep -n "super_user\|admin\|role_name" supabase/functions/send-report-whatsapp/index.ts` returns
   **no match** — no role-name logic and no dependence on a field `validateSession` does not return.
6. `grep -n "GRANT" migrations/20260822090000_report_whatsapp_delivery_log.sql` — every function
   grant names `service_role` and nothing else; no `anon`, no `authenticated`.

## Handover — what a human must do (nothing here is done by this plan)

1. Apply the migration to dev/UAT (`nmdmddugxclpqrwylyfa`, per `.cursor/rules/supabase-dev-uat.mdc`
   and the same note in `migrations/20260817110000_report_builder_rbac.sql:26-28`):
   `npm run db:apply -- migrations/20260822090000_report_whatsapp_delivery_log.sql`
   — and, after sign-off, `npm run db:apply-prod` for the same file (prod `sofanhfpxifgdtooefzq`).
2. If the `storage.buckets` insert fails on privileges, create `report-pdfs` in the dashboard with
   the settings in A5.
3. Deploy: `npx supabase functions deploy send-report-whatsapp` against the linked project.
4. Set `CONTROL_ROOM_FORWARD_SECRET` and `CONTROL_ROOM_CHANNEL_SLUG` if not already set.
5. Users already logged in must sign out and back in to pick up the new `reports.report.send` action
   key (feature/action keys are cached at login).

## Out of scope

No UI. No change to `WebPortal/`. No change to the two existing WhatsApp edge functions — in
particular, do **not** add a service-role bypass to `send-whatsapp-message`; the comment in
`whatsapp-inbound/index.ts` (~:174-186) records that duplication as a deliberate trade-off. No
recipients table. No change to any existing migration or existing verify script. No document/
attachment send. No applying the migration and no deployment.

## Report

Under 30 lines: the four files created/edited; the result of the "CORRECTION" grep block proving
what did and did not already exist; the request/response contract as built; the RPC signatures as
authored; each verify result (explicitly including any check you could not run and why); and **a
prominent note that the migration is authored but NOT applied and the function authored but NOT
deployed**, with the exact apply/deploy commands and the secrets they need.
