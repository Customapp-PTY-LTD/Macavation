---
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 2 — the `send-report-whatsapp` edge function

## Context

Sending a published Sales & Production report to selected WhatsApp numbers needs one server-side
step: file the report's PDF somewhere private, mint a time-limited signed link to it, and send that
link as a WhatsApp message to each chosen number, logging every attempt.

It has to be server-side, and it has to be an edge function, for a reason worth stating up front:
**the portal browser holds no Supabase auth JWT.** It authenticates every call with the publishable
key plus a custom session token in an `X-Portal-Session` header
(`WebPortal/js/data-functions.js:5867-5880`). So `auth.uid()` is always NULL for portal traffic, and
Supabase Storage RLS cannot be used to scope an upload to a user. The `report-pdfs` bucket is
therefore private with **no policy at all**, reachable only by the service-role key — which must
never be in the browser. Everything in this function exists to be the one place that holds it.

This plan authors ONE new file and changes nothing else. It cannot deploy: the fleet has no Supabase
credentials and no network path to any project. **Deployment is a human step** —
`npx supabase functions deploy send-report-whatsapp` against the linked dev project, run by whoever
holds the credential, plus setting the two Control Room secrets if they are not already set. Say so
in the report rather than implying the function is live.

## Grounding — verified against this checkout and the dev database

**Everything this function calls already exists.** Applied to dev (`nmdmddugxclpqrwylyfa`) on
2026-08-19; the files are in this checkout and are the contract — read all three:

- `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`
- `migrations/20260822090100_report_pdf_storage_bucket.sql`
- `migrations/20260822090200_report_whatsapp_send_rbac.sql`

```
begin_report_delivery(p_report_instance_id uuid, p_phone text, p_display_name text DEFAULT NULL,
                      p_recipient_id uuid DEFAULT NULL, p_message_body text DEFAULT NULL,
                      p_pdf_storage_bucket text DEFAULT NULL, p_pdf_storage_path text DEFAULT NULL,
                      p_link_expires_at timestamptz DEFAULT NULL, p_actor_user_id uuid DEFAULT NULL)
  RETURNS TABLE (success int, error text, id uuid)

complete_report_delivery(p_delivery_id uuid, p_status text,
                         p_external_message_id text DEFAULT NULL, p_error text DEFAULT NULL)
  RETURNS TABLE (success int, error text)          -- p_status must be 'sent' or 'failed'

record_report_pdf_storage(p_report_instance_id uuid, p_bucket text, p_path text,
                          p_sha256 text DEFAULT NULL)
  RETURNS TABLE (success int, error text)
```

All three are granted to `service_role` ONLY (section 7 of the first migration). Bucket:
`report-pdfs`, private, `allowed_mime_types = {application/pdf}`, `file_size_limit = 26214400`.

**The send primitive to model on is `supabase/functions/send-whatsapp-message/index.ts`** (159
lines). Copy its structure, not a generic one:

- `CONTROL_ROOM_BASE_URL = 'https://ejnncypummmvyojhovme.supabase.co/functions/v1'` (:23)
- `corsHeaders`, including `x-portal-session, X-Portal-Session` in allow-headers (:25-28)
- `makeServiceClient()` from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (:31-36)
- `rpc()` helper that throws `[rpc:<fn>] <message>` (:38-44)
- `validateSession()` calling `assistant_validate_session` and **failing closed** — an empty result
  is a 401, an RPC exception is a 503 (:46-63). Reuse this verbatim; its own header comment
  (:12-19) explains that without it anyone holding the publishable key could send WhatsApp
  messages.
- `normalizePhone()` (:64-69) and `signBody()` HMAC-SHA256 → `sha256=<hex>` (:71-83)
- The 503 when `CONTROL_ROOM_FORWARD_SECRET` / `CONTROL_ROOM_CHANNEL_SLUG` are unset (:100-111)
- The request body shape `{ action: 'send_message', channelSlug, to, type: 'text', content: { text } }`
  (:123-129), and the `!res.ok || !result.ok` → 502 check with `result.wamid` as the message id
  (:141-152)

**`assistant_validate_session` returns `(user_id uuid, role_name text, email text)`** —
`migrations/20260716160000_portal_assistant_chat.sql:271-274`. So the caller's role name is
available from the session check itself; no extra lookup is needed to get it.

**Message type is `text`, and only `text`.** `supabase/functions/whatsapp-inbound/index.ts:175-185`
is explicit: the meta-proxy contract for anything other than plain text is **unconfirmed** from this
repo, and that comment tells you not to add a non-text send. Control Room's own integration guide
does list `document` among its accepted types but gives no payload shape for it and states that a
non-text `content` "is passed through as-is, so it must already be a valid Meta message object" —
which is not enough to write against. **This function sends `type: 'text'` carrying a link. Do not
attempt a document/attachment send.** Attaching the PDF directly is a separate, later plan that
depends on a live probe against Control Room, which no agent can run from this checkout.

**`get_report_instance(uuid)`** returns the report payload as JSONB —
`migrations/20260817100000_report_instances_and_targets.sql`, used at :831 inside
`publish_report_instance`. Read that file to confirm the top-level keys you rely on
(`period_label`, `status`, `executive_summary`) before using them, and if any is not present in the
function's own SQL, treat it as unconfirmed and code defensively rather than assuming it.

**Supabase Storage from Deno**: `supabase-js@2` exposes
`sb.storage.from(bucket).upload(path, body, opts)` and
`sb.storage.from(bucket).createSignedUrl(path, expiresInSeconds)`. This is the FIRST use of Storage
anywhere in this project — `grep -rn "storage.from(\|createSignedUrl\|/storage/v1/object" WebPortal/ supabase/functions/`
returns nothing — so there is no in-repo call site to cite and **no in-repo precedent to copy**.
Treat both call shapes as taken from the library's documented API, not from this checkout, and mark
them as such in a code comment. Handle their `{ data, error }` results explicitly; do not assume
success.

## The one new file

`supabase/functions/send-report-whatsapp/index.ts`. Open it with the same header-comment style as
its two siblings: what it does, the deploy command, the secrets it needs, the auth convention, and
the Control Room docs URL.

### Request

`POST` with headers `Authorization: Bearer <anonKey>`, `apikey`, `X-Portal-Session`, and a JSON
body:

```json
{
  "report_instance_id": "<uuid>",
  "pdf_base64": "<base64, no data: prefix>",
  "filename": "Macavation-August-2026.pdf",
  "recipients": [ { "recipient_id": "<uuid|null>", "phone": "0821234567", "display_name": "Pete" } ]
}
```

### Sequence

1. `OPTIONS` → `'ok'` with `corsHeaders`, exactly as the sibling does (:85-87).
2. `validateSession` → on failure return its status and message unchanged.
3. **Authorise the action server-side.** The UI gates the button, but a caller holding a valid
   session could POST directly, so the check must also exist here. With the service client, look up
   whether the session's `role_name` holds the `reports.report.send` action:

   ```sql
   -- shape only; implement as a supabase-js query or a small RPC-free select
   select 1
     from public.role_actions ra
     join public.actions a on a.id = ra.action_id
     join public.roles   r on r.id = ra.role_id
    where a.key = 'reports.report.send'
      and r.role_name = $1
      and coalesce(ra.value, 'true') = 'true'
   ```

   Allow unconditionally for `role_name` in (`super_user`, `admin`) — `WebPortal/js/action-access.js`
   already treats those two as always-allowed in code, and CLAUDE.md records that as the
   established rule, so diverging here would make the API stricter than the UI for those roles.
   Anything else with no matching row → **403, fail closed**. Note in a comment that
   `role_actions.value` is TEXT, not boolean (stated in
   `migrations/20260821180000_report_targets_module.sql`), so the comparison is against the string
   `'true'`.
4. Validate the body and **fail before touching storage**:
   - `report_instance_id` matches `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` → else 400.
   - `recipients` is a non-empty array, at most **25** entries → else 400. State the cap in the
     response message so the UI can show it.
   - `filename` matches `/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.pdf$/`. This is an allowlist, not a
     truthiness check: the value comes from the browser and is used to build a storage object path,
     so anything containing `/`, `\`, `..`, a control character or a NUL must be rejected outright
     rather than sanitised. Trace this regex by hand against `../../etc/passwd`,
     `a/b.pdf`, `..pdf`, `report.pdf.exe` and `report.pdf` before you finish — the first four must
     be rejected, the last accepted.
   - `pdf_base64` matches `/^[A-Za-z0-9+/]+={0,2}$/` and decodes to **at least 1 KB and at most 20 MB**.
     Reject a `data:` prefix rather than stripping it. Decode with
     `Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))` inside a try/catch → 400 on failure.
   - The decoded bytes must begin with the PDF magic number `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`).
     The bucket restricts `allowed_mime_types` to `application/pdf`, but that trusts a declared
     content type; this checks the actual bytes. → else 400.
5. Fetch the report with `get_report_instance(report_instance_id)`. If it is missing → 404. **If its
   status is not `'published'` → 409** with a clear message. A draft must never leave the building:
   the PDF builder watermarks a draft, but nothing else stops it being sent, and once a number has
   it there is no recall.
6. **Upload once.** Compute `sha256` of the bytes with
   `crypto.subtle.digest('SHA-256', bytes)` → hex. Object path:
   `` `${report_instance_id}/${sha256.slice(0, 12)}-${filename}` `` — content-addressed, so
   re-sending the same report reuses one object and a changed report cannot overwrite the bytes an
   earlier recipient's link points at. Upload with
   `{ contentType: 'application/pdf', upsert: true }` (`upsert: true` makes a re-send of identical
   bytes idempotent rather than an error). On an upload error → 502 with the storage message; do
   not proceed to send.
7. `record_report_pdf_storage(report_instance_id, 'report-pdfs', path, sha256)`. A failure here is
   **logged and non-fatal** — it records provenance; it must not stop a send that is otherwise
   ready. Say so in a comment.
8. `createSignedUrl(path, 60 * 60 * 24 * 30)` — 30 days. Compute `link_expires_at` as
   `new Date(Date.now() + 30 * 86400 * 1000).toISOString()`. On error → 502.
9. **Build the message text server-side, from the database payload — never from the request body.**
   The browser must not be able to choose what text goes to an arbitrary phone number. Model the
   formatting on `supabase/functions/send-daily-digest-whatsapp/index.ts:18-40` (`formatWhatsAppText`)
   — plain lines joined with `\n`, an em-dash for a missing value, no Markdown:

   ```
   Macavation — <period_label> Sales & Production report
   Published <published_at as yyyy-mm-dd>

   <executive_summary, collapsed whitespace, truncated to 400 chars with an ellipsis>

   Full report (PDF, link valid 30 days):
   <signedUrl>
   ```

   If `executive_summary` is empty, omit that block and its blank line rather than sending a gap.
10. **For each recipient, in sequence** (not `Promise.all` — a partial failure must leave a
    coherent log, and the recipient cap keeps this fast enough):
    a. `begin_report_delivery(...)` with the normalised phone, display name, recipient id, the
       message body, `'report-pdfs'`, the path, `link_expires_at`, and the session's `user_id`.
       If it returns `success = 0`, record the reason in the results array and **skip the send** —
       an unlogged send is exactly what the two-step log exists to prevent.
    b. POST to the meta-proxy, signed, `type: 'text'`.
    c. `complete_report_delivery(deliveryId, 'sent', wamid, null)` or
       `complete_report_delivery(deliveryId, 'failed', null, <the gateway's own message>)`.
       **Pass the gateway's error text through verbatim.** A WhatsApp send can fail for reasons the
       portal cannot anticipate — falling outside Meta's 24-hour customer-service window being the
       likeliest — and a generic "failed" hides the only actionable detail. This is unconfirmed from
       this checkout: nothing here has ever seen that gateway's rejection payload, so do not
       hard-code, parse or classify its shape. Store it and move on.
    d. One recipient's failure must never abort the loop. Wrap each iteration in try/catch.
11. Respond `200` with
    `{ success: true, sent, failed, pdf_storage_path, link_expires_at, results: [ { phone, display_name, status, external_message_id, error } ] }`.
    Return 200 even when every send failed — the request itself succeeded, and the per-recipient
    detail is in `results`. The UI (part 3) renders that list.

## Security invariants to state in the code, not infer

- **Never log `pdf_base64`, the decoded bytes, or the signed URL.** The signed URL is a bearer
  credential for a confidential document; a log line containing it is a leak that outlives the
  request. Log the object path and the byte length instead.
- **The service-role key never leaves this function.** No part of the response includes it, and the
  response never includes the signed URL either — the browser has no need for it, and part 3's
  plan does not ask for it.
- **Fail closed on both auth checks**: an unvalidatable session is 401/503, a role without the
  action is 403. Never fall through to a send.
- **The filename allowlist is a security control, not tidiness** — it composes a storage path.
- `type: 'text'` only, per `whatsapp-inbound/index.ts:175-185`.

## Verify before finishing

Every check runs inside the checkout with no network, no browser and no Supabase project:

1. **Type-check the function**: `npx --yes deno@1.45.5 check supabase/functions/send-report-whatsapp/index.ts`.
   If Deno cannot be fetched in the run environment, say so plainly and fall back to check 2 —
   do NOT report a check as passing that you could not run.
2. **A pure-Node unit check of the two pure validators**, written as
   `scripts/verify-report-whatsapp-payload.mjs` and wired into `npm run test:fleet` in
   `package.json`. Follow the established pattern of `scripts/verify-ui-standard.mjs` /
   `scripts/verify-migration-prefixes.mjs`: pure `fs` + `assert`, exit non-zero on failure, no new
   dependency and no test framework — `package.json:26` requires `test:fleet` to stay
   "FAST and HERMETIC: pure Node stdlib, no browser, no login, no network, no deployed app."
   Extract the `filename` and `pdf_base64` regexes from the `.ts` source by reading the file and
   asserting the literals are present, then re-test the same regexes in Node against these cases:
   - filename: reject `../../etc/passwd`, `a/b.pdf`, `..pdf`, `report.pdf.exe`, `''`,
     `'x'.repeat(90) + '.pdf'`; accept `Macavation-August-2026.pdf`, `r.pdf`
   - base64: reject `'data:application/pdf;base64,AAAA'`, `'A A A'`, `'****'`; accept `'QUJDRA=='`
   - magic number: a `Uint8Array` starting `%PDF-` accepted; one starting `PK` rejected
3. `npm run test:fleet` passes with the new script included.
4. `grep -n "pdf_base64\|signedUrl\|signed_url" supabase/functions/send-report-whatsapp/index.ts`
   and confirm by inspection that no match sits inside a `console.log`/`console.error`/`console.warn`
   argument.

## Out of scope

No UI. No change to `WebPortal/`. No change to the two existing WhatsApp edge functions — in
particular, do **not** add a service-role bypass to `send-whatsapp-message`; the comment at
`whatsapp-inbound/index.ts:175-185` records that duplication as a deliberate trade-off. No document/
attachment send. No deployment.

## Report

Under 30 lines: the file created, the request/response contract as built, each verify result
(explicitly including any check you could not run and why), and **a prominent note that the function
is authored but NOT deployed**, with the exact deploy command and the secrets it needs.
