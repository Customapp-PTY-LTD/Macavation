---
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 2b — the `send-report-whatsapp` edge function

## Why this plan exists, and why it is smaller than the one it replaces

An earlier part 2 was blocked three times and hit the retry cap. The root cause was **not** the edge
function's logic. It was that its database foundation sat on an unmerged branch, so every agent
checking out `dev` correctly found nothing and the plan was progressively rewritten to author that
foundation itself — growing into a migration plus three `SECURITY DEFINER` functions plus the edge
function, under a table name (`report_whatsapp_deliveries`) and a migration prefix
(`20260822090000`) that both now collide with what actually landed.

**That foundation is now on `dev`**, in merge commit `b3e6b66` (PR #47), and applied to the dev
database. So this plan authors **one file and nothing else**. It writes no SQL. It creates no table.
It must not add a migration.

The three genuine defects the last review found are carried forward below — two as facts already
resolved in the merged SQL (stated so nobody "fixes" working code), one as a live constraint on the
code this plan does write.

## Verify the premise before writing anything

Run these and record the output in your report. A previous plan in this batch was blocked for
asserting a foundation existed when the checkout did not show it — do not repeat that, in either
direction:

```
ls migrations/20260822*
grep -n "begin_report_delivery\|complete_report_delivery\|record_report_pdf_storage" migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql
grep -n "report-pdfs" migrations/20260822090100_report_pdf_storage_bucket.sql
grep -n "reports\.report\.send" migrations/20260822090200_report_whatsapp_send_rbac.sql
grep -rn "has_action" migrations/20260815110000_generic_has_action_gate.sql
ls supabase/functions/                                      # -> no send-report-whatsapp yet
```

Every one except the last must return hits. If any does not, **stop and say so.**

## Grounding — verified against this checkout AND against the dev database

### The three RPCs this function calls (already applied — do not author them)

From `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`, section 5 and 6:

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

All three are `REVOKE`d from `PUBLIC, anon, authenticated` and granted to `service_role` only
(section 7), which is exactly why this function must exist and why the browser never calls them.

**Two review findings against the earlier plan are already resolved in this merged SQL. Both were
re-verified against the dev database on 2026-08-19, and neither is yours to change:**

1. **`complete_report_delivery` is row-scoped.** The earlier plan's prose said "updates only a row
   currently in `'pending'`" but the only literal `WHERE` it ever wrote was a table-wide
   `status = 'pending'`, which would have stamped one recipient's status over every pending row in
   the table. The merged function's actual clause, read back out of dev with
   `pg_get_functiondef`, is `WHERE id = p_delivery_id`. Do not add, widen or "improve" this — and do
   not author your own version of the function.
   *(Known and accepted limitation: it does not additionally require `status = 'pending'`, so a
   second completion call on the same delivery id would overwrite the first. Nothing in this design
   makes that call — part 4's re-send inserts NEW delivery rows rather than reusing one. Do not
   change the function to close it; note it if you touch this area.)*
2. **The published-report freeze trigger does not block `record_report_pdf_storage`.** Queried
   against dev's `pg_trigger`: the three `trg_lock_*` triggers are attached to
   `report_instance_lines`, `report_instance_metric_values` and `report_instance_sections` only.
   `report_instances` carries no lock trigger. So updating a **published** instance's PDF pointer is
   safe, and no workaround is needed. Do not add one.

### The authorisation gate — use the repo's own, and do NOT add a role bypass

`public.has_action(p_user_id uuid DEFAULT NULL, p_action_key text DEFAULT NULL) RETURNS boolean`,
`STABLE SECURITY DEFINER`, at `migrations/20260815110000_generic_has_action_gate.sql:42-47`. It
fails closed on null/blank input by returning `false` rather than throwing (:51-55), and it is
`REVOKE`d from `PUBLIC, anon, authenticated` and granted to `service_role` only (:88-89).

**Its header comment at :34-40 forbids exactly what the earlier plan asked for:**

> "Deliberately NO always-allowed-role bypass. The front-end button layer
> (WebPortal/js/action-access.js) hardcodes a couple of role names as always-allowed, and it is
> tempting to mirror that here. Do not: a server-side gate whose answer depends on role NAME rather
> than on a granted action is exactly the coupling that let the button layer and the API layer drift
> apart."

So: call `has_action(user_id, 'reports.report.send')` and honour its answer. **No hardcoded
`super_user`/`admin` bypass, and no hand-rolled `role_actions` join.** Those roles do not need a
bypass — `migrations/20260822090200_report_whatsapp_send_rbac.sql` grants them the action as data.
Verified against dev on 2026-08-19: `has_action` returns `true` for a real `super_user` and a real
`Sales Exec`, and `false` for an unknown user id, a null user id and a blank key.

**A trap in the sibling function's `rpc()` helper — this is the third carried-forward finding, and it
is live.** `supabase/functions/send-whatsapp-message/index.ts:38-44` normalises its result:

```ts
if (Array.isArray(data)) return data as AnyRow[];
if (data && typeof data === 'object') return [data as AnyRow];
return [];
```

`has_action` returns a bare **boolean**. `true` is neither an array nor an object, so that helper
returns `[]` — and `false` returns `[]` too. Routing this gate through that helper makes a granted
user and a denied user indistinguishable, and the natural "empty means denied" reading would lock
everyone out. **Call `sb.rpc('has_action', { p_user_id, p_action_key })` directly and read `data` as
a boolean, checking `error` separately.** Treat an RPC error as a 503, and `data !== true` as a 403.
Say in a comment why the shared helper is bypassed here.

### The send primitive to model on

`supabase/functions/send-whatsapp-message/index.ts` (159 lines). Copy its structure:

- `CONTROL_ROOM_BASE_URL = 'https://ejnncypummmvyojhovme.supabase.co/functions/v1'` (:23)
- `corsHeaders`, including `x-portal-session, X-Portal-Session` in allow-headers (:25-28)
- `makeServiceClient()` from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (:31-36)
- `validateSession()` calling `assistant_validate_session`, **failing closed** — empty result is a
  401, an RPC exception a 503 (:46-63). Its header comment (:12-19) explains that without this check
  anyone holding the publishable key could send WhatsApp messages.
  **`assistant_validate_session` returns `(user_id, role_name, email)`**
  (`migrations/20260716160000_portal_assistant_chat.sql:271-274`), and the sibling's
  `validateSession` currently discards `role_name`. You need only `user_id` — `has_action` takes the
  user id, not the role name.
- `normalizePhone()` (:64-69) and `signBody()` HMAC-SHA256 → `sha256=<hex>` (:71-83)
- The 503 when `CONTROL_ROOM_FORWARD_SECRET` / `CONTROL_ROOM_CHANNEL_SLUG` are unset (:100-111)
- Body shape `{ action: 'send_message', channelSlug, to, type: 'text', content: { text } }` (:123-129)
  and the `!res.ok || !result.ok` → 502 check with `result.wamid` as the message id (:141-152)

**Reusing `normalizePhone` at a new call site — check this rather than inheriting it.** It prefixes
`27` only when the digit string does not already start `27` **and** is 11 digits or fewer, so a
longer international number passes through with a bare `+`. That is the existing behaviour at three
existing call sites and this plan does not change it. But note the database's
`report_normalize_wa_phone` (same migration, section 1) implements the same rule with one deliberate
difference: **empty input yields SQL `NULL` where the JS yields `'+'`**. `begin_report_delivery`
rejects a `NULL` phone with "A valid phone number is required.", so an empty number is caught
server-side either way. Do not "unify" them.

**Message type is `text`, and only `text`.** `supabase/functions/whatsapp-inbound/index.ts:175-185`
states that the meta-proxy contract for anything other than plain text is **unconfirmed** from this
repo and tells you not to add a non-text send. Control Room's guide does list `document` but gives no
payload shape and says a non-text `content` "is passed through as-is, so it must already be a valid
Meta message object" — not enough to write against. **Send `type: 'text'` carrying a link. Do not
attempt a document/attachment send.** That is a separate, later plan gated on a live probe no agent
can run from this checkout.

### Storage — the first use of it anywhere in this project

`grep -rn "storage.from(\|createSignedUrl\|/storage/v1/object" WebPortal/ supabase/functions/`
returns nothing; `supabase/config.toml` has only a commented-out `# [storage.buckets.images]`. So
there is **no in-repo precedent to copy**. `sb.storage.from(bucket).upload(path, body, opts)` and
`sb.storage.from(bucket).createSignedUrl(path, expiresInSeconds)` come from the library's documented
API, not from this checkout — say so in a code comment, handle both `{ data, error }` results
explicitly, and assume nothing about success.

Bucket, from `migrations/20260822090100_report_pdf_storage_bucket.sql`: `report-pdfs`, `public =
false`, `allowed_mime_types = {application/pdf}`, `file_size_limit = 26214400`, and **no RLS policy
at all** — deliberately, because the portal browser holds no Supabase auth JWT so `auth.uid()` is
always NULL and a policy for `anon` would open the bucket to anyone holding the key that ships in the
browser. `service_role` bypasses RLS, which is precisely the intended access rule.

**`get_report_instance(uuid)`** returns the report payload as JSONB and **returns NULL when the id
does not exist** (`migrations/20260817100000_report_instances_and_targets.sql:717-720`) — so a
missing report is a NULL payload, not a thrown error. Its payload contains `pdf_storage_path` but
**not** `pdf_storage_bucket`; do not read a key that is not there. Confirm the top-level keys you
rely on (`period_label`, `status`, `published_at`, `executive_summary`) against that function's own
SQL before using them, and code defensively for any you cannot confirm.
Note it is already granted to `anon, authenticated, service_role` (same file, :1261) — pre-existing,
not this plan's doing, and not something to change here.

## Dependencies — pinned, per the plan-safety rule

- `https://esm.sh/@supabase/supabase-js@2.49.1` — the exact pin
  `supabase/functions/send-daily-digest-whatsapp/index.ts:9` already uses. (Note
  `send-whatsapp-message/index.ts:20` imports the unpinned `@supabase/supabase-js@2`; prefer the
  pinned form.)
- `deno@1.45.5` for the type-check, if the run environment can fetch it.

No other new dependency.

## The one new file

`supabase/functions/send-report-whatsapp/index.ts`. Header comment in the same style as its two
siblings: what it does, the deploy command, the secrets it needs, the auth convention, the Control
Room docs URL.

### Request

```json
{
  "report_instance_id": "<uuid>",
  "pdf_base64": "<base64, no data: prefix>",
  "filename": "Macavation-August-2026.pdf",
  "recipients": [ { "recipient_id": "<uuid|null>", "phone": "0821234567", "display_name": "Pete" } ]
}
```

This is exactly what the already-merged `dataFunctions.sendReportWhatsapp`
(`WebPortal/js/data-functions.js:6263-6335`) posts — read it and match it; it is the live caller.

### Sequence

1. `OPTIONS` → `'ok'` with `corsHeaders` (sibling :85-87).
2. `validateSession` → on failure return its status and message unchanged.
3. `has_action(user_id, 'reports.report.send')` via a direct `sb.rpc`, per the trap above.
   `data !== true` → **403, fail closed**. RPC `error` → 503.
4. Validate the body, failing **before** touching storage:
   - `report_instance_id` matches
     `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i` → else 400.
   - `recipients` a non-empty array, at most **25** entries → else 400, with the cap in the message.
   - `filename` matches **`/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.pdf(?![\s\S])/`**.
   - `pdf_base64` matches **`/^[A-Za-z0-9+/]+={0,2}(?![\s\S])/`**, and decodes to between 1 KB and
     20 MB. Reject a `data:` prefix rather than stripping it. Decode with
     `Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))` in a try/catch → 400 on failure.
   - Decoded bytes begin with `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`) → else 400. The bucket's
     `allowed_mime_types` trusts a declared content type; this checks the actual bytes.

   **`(?![\s\S])` instead of `$` is the third carried-forward finding and it is a security control,
   not tidiness.** In JavaScript `$` also matches immediately before a single trailing newline, so
   `/…\.pdf$/` **accepts** `"report.pdf\n"` — a control character — and the newline would be carried
   straight into the composed storage object path. `(?![\s\S])` is a true end-of-input assertion.
   Apply it to all three regexes, and **hand-trace each against its full case list before you finish**:
   - filename — reject: `../../etc/passwd`, `a/b.pdf`, `..pdf`, `report.pdf.exe`, `''`,
     `'x'.repeat(90) + '.pdf'`, **`'report.pdf\n'`**, **`'report.pdf\r'`**, `'report.pdf\r\n'`;
     accept: `Macavation-August-2026.pdf`, `r.pdf`
   - base64 — reject: `'data:application/pdf;base64,AAAA'`, `'A A A'`, `'****'`, `''`,
     **`'QUJDRA==\n'`**; accept: `'QUJDRA=='`
   - uuid — reject a trailing `\n` on an otherwise valid uuid; accept a bare valid uuid
5. `get_report_instance(report_instance_id)` → NULL payload means 404. **Status not `'published'` →
   409** with a clear message. A draft must never leave the building: the PDF builder watermarks a
   draft but nothing else stops it being sent, and once a number has it there is no recall.
6. **Upload once.** `sha256` of the bytes via `crypto.subtle.digest('SHA-256', bytes)` → hex. Path
   `` `${report_instance_id}/${sha256.slice(0, 12)}-${filename}` `` — content-addressed, so
   re-sending the same report reuses one object and a changed report cannot overwrite the bytes an
   earlier recipient's link points at. `{ contentType: 'application/pdf', upsert: true }`. Upload
   error → 502, and do not proceed to send.
7. `record_report_pdf_storage(report_instance_id, 'report-pdfs', path, sha256)`. A failure here is
   **logged and non-fatal** — it records provenance and must not stop a send that is otherwise
   ready. Comment that.
8. `createSignedUrl(path, 60 * 60 * 24 * 30)`. `link_expires_at =
   new Date(Date.now() + 30 * 86400 * 1000).toISOString()`. Error → 502.
9. **Build the message text server-side from the database payload — never from the request body.**
   The browser must not choose what text goes to an arbitrary number. Model the formatting on
   `supabase/functions/send-daily-digest-whatsapp/index.ts:18-40` (`formatWhatsAppText`): plain lines
   joined with `\n`, an em-dash for a missing value, no Markdown.

   ```
   Macavation — <period_label> Sales & Production report
   Published <published_at as yyyy-mm-dd>

   <executive_summary, whitespace collapsed, truncated to 400 chars with an ellipsis>

   Full report (PDF, link valid 30 days):
   <signedUrl>
   ```

   Omit the summary block **and its blank line** when the summary is empty, rather than sending a gap.
10. **For each recipient, in sequence** — not `Promise.all`; a partial failure must leave a coherent
    log, and the 25 cap keeps it fast enough:
    a. `begin_report_delivery(...)` with the normalised phone, display name, recipient id, message
       body, `'report-pdfs'`, the path, `link_expires_at`, and the session's `user_id`. `success = 0`
       → record the reason in `results` and **skip the send**. An unlogged send is what the two-step
       log exists to prevent.
    b. POST to the meta-proxy, signed, `type: 'text'`.
    c. `complete_report_delivery(delivery_id, 'sent', wamid, null)` or
       `complete_report_delivery(delivery_id, 'failed', null, <the gateway's own message>)`.
       **Pass the gateway's text through verbatim.** A send can fail for reasons the portal cannot
       anticipate — falling outside Meta's 24-hour customer-service window being the likeliest — and
       nothing in this checkout has ever seen that rejection payload, so do not hard-code, parse or
       classify its shape. Store it and move on.
       Use the identifier **`delivery_id`** for the value returned as `id` by `begin_report_delivery`,
       consistently, in every deliverable and every log line.
    d. One recipient's failure must never abort the loop. try/catch each iteration.
11. Respond **200** with
    `{ success: true, sent, failed, pdf_storage_path, link_expires_at, results: [ { phone, display_name, status, external_message_id, error } ] }`.
    200 even when every send failed — the request succeeded; the per-recipient detail is in `results`.
    The already-merged caller returns this body unchanged to the UI.

## Security invariants to state in the code, not infer

- **Never log `pdf_base64`, the decoded bytes, or the signed URL.** The signed URL is a bearer
  credential for a confidential document; a log line holding it outlives the request. Log the object
  path and the byte length.
- **The response never includes the signed URL or the service-role key.** The browser has no use for
  either.
- **The message body — which contains the signed URL — IS persisted**, into
  `report_deliveries.message_body`, for as long as the row lives. That is deliberate, not an
  oversight in tension with the rule above: the table is `REVOKE`d from `PUBLIC, anon, authenticated`
  and granted to `service_role` only (section 3 of the migration), so it is no more exposed than the
  report itself, and knowing exactly what text went to a number is the point of an audit log. State
  this reasoning in a comment next to the `p_message_body` argument so the two rules do not read as
  contradictory.
- **Fail closed on both auth checks**: unvalidatable session → 401/503; missing action → 403. Never
  fall through to a send.
- **The filename allowlist composes a storage path** — it is a security control.
- `type: 'text'` only.

## Verify before finishing

Hermetic unless stated:

1. `npx --yes deno@1.45.5 check supabase/functions/send-report-whatsapp/index.ts`. **This needs
   network.** If it cannot run, say so plainly and fall back to check 2 — do **not** report a check
   as passing that you could not run.
2. **A pure-Node unit check of the three validators**, as `scripts/verify-report-whatsapp-payload.mjs`
   wired into `test:fleet` in `package.json`. Follow `scripts/verify-ui-standard.mjs` /
   `scripts/verify-migration-prefixes.mjs`: pure `fs` + `node:assert`, non-zero exit on failure, no
   new dependency, no test framework — `package.json:27-28` requires `test:fleet` to stay "FAST and
   HERMETIC: pure Node stdlib, no browser, no login, no network, no deployed app". Read the regex
   literals out of the `.ts` source, assert they are present, then re-test them in Node against
   **every** case in step 4's list, newline cases included, plus the `%PDF-` magic-number check
   (`%PDF-` accepted, `PK` rejected).
   Note `scripts/verify-phase2-migrations.mjs` is a fixed list and is unaffected by a new migration —
   there is no migration here anyway.
3. `npm run test:fleet` passes with the new script wired in. Report the measured runtime.
4. `grep -n "GRANT\|REVOKE\|CREATE TABLE\|CREATE OR REPLACE FUNCTION" supabase/functions/send-report-whatsapp/index.ts migrations/`
   — confirm **this plan added no migration and no SQL DDL**. `git status --porcelain` must show only
   the new function file and `package.json` (plus the new verify script).
5. `grep -n "pdf_base64\|signedUrl\|signed_url" supabase/functions/send-report-whatsapp/index.ts` —
   confirm by inspection that no match sits inside a `console.log`/`error`/`warn` argument.
6. `grep -n "super_user\|role_name" supabase/functions/send-report-whatsapp/index.ts` — must return
   **nothing**, proving no role-name bypass was added.
7. `grep -n "rpc(sb, 'has_action'\|rpc(sb, \"has_action\"" supabase/functions/send-report-whatsapp/index.ts`
   — must return **nothing**, proving the boolean gate does not go through the array-normalising
   helper.

## Out of scope

Any migration or SQL — the foundation is merged and applied. Any change to `WebPortal/` — the caller
already exists. Any change to the two existing WhatsApp edge functions; in particular do **not** add
a service-role bypass to `send-whatsapp-message`, whose duplication is recorded as a deliberate
trade-off at `whatsapp-inbound/index.ts:175-185`. Any document/attachment send. **Deployment** — the
fleet has no Supabase credentials and no network path to any project.

One reviewer note is advisory and deliberately **not** a constraint here: `BluePrint/RBAC_GUIDE.md`
asks for a `role_permissions` row for every new function, but this repo has moved past that for
service-role-only functions (`migrations/20260815110000_generic_has_action_gate.sql:81-89` adds none
on purpose, and CLAUDE.md records grant-to-every-role as the cause of the current drift). This plan
adds no function anyway. Correcting that document is a separate, human-reviewed follow-up.

## Report

Under 30 lines: the premise-grep output, the file created, the request/response contract as built,
the hand-traced results for all three regexes including the newline cases, each verify result
(explicitly naming any check you could not run and why), and **a prominent note that the function is
authored but NOT deployed**, with the exact deploy command and the secrets it needs.
