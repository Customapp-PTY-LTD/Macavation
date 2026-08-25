# WhatsApp reports — short-code report links

## Context

Today a published Sales & Production report is sent on WhatsApp as a **30-day signed Supabase Storage
URL pasted into the message body** (`supabase/functions/send-report-whatsapp/index.ts:62`,
`:359-361`). Two problems with that:

1. **It cannot be used on a template button.** A Meta template URL button has a base URL fixed at
   approval time and takes only the short suffix that replaces `{{1}}` — a long signed URL full of
   `/` and `?token=` cannot be that suffix. A published report needs to reach people who have not
   messaged recently, which means a template, which means a button, which means a short code.
2. **It is a working link to a confidential report sitting in a chat for a month**, forwardable, and
   impossible to withdraw. If a report is superseded the old link keeps working.

This plan authors a public redirect: a short code in the message, resolved at the moment of tapping,
which then issues a **short-lived** signed URL. The confidential link never sits anywhere. A code can
be revoked.

**You cannot deploy this or reach a database.** Author files only. A human deploys with
`supabase functions deploy r --project-ref nmdmddugxclpqrwylyfa --no-verify-jwt`. The
`--no-verify-jwt` is essential: this endpoint is opened from a phone's browser with no credential of
any kind, so a JWT check would break every link.

**The RPC below does not exist when this merges** and no message contains a code yet, so nothing
reaches this endpoint until a human applies the migration and deploys. Do not add a fallback path.

## Security — this is a public, unauthenticated endpoint

Read `migrations/20260822090100_report_pdf_storage_bucket.sql:8-27` first. The `report-pdfs` bucket
is **private with no RLS policy at all**: only `service_role` can read it. This function therefore
holds the service-role key and is the only way a browser reaches that bucket. Treat every input as
hostile.

- **The code is the only secret.** It must be long enough not to be guessable and must never be
  derived from anything predictable. Generation is the database's job (see the contract); this
  function only ever *reads* a code.
- **Never echo the code back** in a response body or an error message, and never log a full code —
  log at most its first 4 characters. A code in a log is a working credential.
- **Never return the storage path, bucket name, or signed URL in a body.** The only success response
  is a 302 whose `Location` is the signed URL.
- **Reject anything that is not a plausible code before touching the database**: match
  `/^[A-Za-z0-9_-]{8,64}$/` and 404 otherwise. This is also what stops path traversal reaching the
  storage call.
- **Give the same response for unknown, expired and revoked.** A distinguishable "expired" tells an
  attacker the code was real. Return one generic 404 page for all three; put the true reason in the
  server log only.
- **No CORS headers.** This is a top-level navigation, not an XHR. Adding `Access-Control-Allow-Origin`
  would let any site probe codes from a victim's browser.
- **Signed-URL lifetime: 300 seconds.** Long enough for a phone on a bad connection to start the
  download, short enough that a shoulder-surfed URL is worthless. Do not reuse the 30-day constant.

## FIXED contract — implement against this exactly

**`resolve_report_link_code(p_code text) → jsonb`**

```json
{
  "ok": true,
  "bucket": "report-pdfs",
  "path": "<report_instance_id>/<sha>-<filename>.pdf",
  "filename": "Macavation-Week-ending-23-Aug-2026.pdf"
}
```

On any failure: `{ "ok": false, "reason": "not_found" | "expired" | "revoked" }`. The RPC records the
hit itself — this function does not need to write anything.

`reason` is for the log only. All three produce the same 404 to the caller.

## Work

### 1. `supabase/functions/r/config.toml`

```toml
[functions.r]
verify_jwt = false
```

With a comment stating why: opened from a phone browser with no credential, so a JWT check would
break every link.

### 2. `supabase/functions/r/index.ts`

Doc-comment header in the house style (`send-report-whatsapp/index.ts:1-32`) naming the deploy
command including `--no-verify-jwt`, the env vars, the RPC, and — briefly — the security rules above,
so the next person to edit it does not undo them.

`GET` and `HEAD` only. `OPTIONS` → 405 with no CORS headers. Anything else → 405.

The code comes from the path: `/r/<code>` when routed through a rewrite, or the last non-empty path
segment of `new URL(req.url).pathname`. Handle both, since the deployed path is
`/functions/v1/r/<code>` unless a rewrite is configured. Also accept `?c=<code>` as a fallback.

Sequence:

1. Extract the code. Missing → 404 page.
2. Validate against `/^[A-Za-z0-9_-]{8,64}$/`. Fail → 404 page, log the length only, not the value.
3. Service client from `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
   (`send-report-whatsapp/index.ts:77-78`). Missing env → 503 and a log line; do not 404, since that
   would look like a bad code and send someone chasing the wrong thing.
4. `resolve_report_link_code(code)`. `ok:false` → 404 page; `console.warn` the reason and the code's
   first 4 characters.
5. `storage.from(bucket).createSignedUrl(path, 300, { download: filename })` so the phone saves it
   under a readable name instead of the hashed object key. Error → 502 page and a log.
6. **302** to the signed URL, with `Cache-Control: no-store, max-age=0` and
   `Referrer-Policy: no-referrer`. Both matter: a cached redirect would outlive the 300-second URL
   and break confusingly, and a referrer would leak the signed URL to whatever the PDF viewer loads.

### 3. The 404 page

A tiny self-contained HTML response, `Content-Type: text/html; charset=utf-8`, status 404, no
external assets. A person who taps a dead link should understand what happened, so write it for them,
not for a developer:

> **This report link is no longer available.**
> Links expire for security. Ask whoever sent it to share the report again.

Follow `WebPortal/` for tone. No stack trace, no code, no mention of storage, buckets or Supabase.
Reuse the same body for the 502 with wording that says to try again shortly.

## Out of scope

No migrations and no RPC authoring — handled outside the fleet. No change to
`send-report-whatsapp/index.ts`: making the send *use* a code is
`wa-reports-05-weekly-window-aware.md`. No template submission. No new `package.json` entry.

## Verification

Reason it through and state your findings — none of this can be run against a real database here:

- Trace an input of `../../secrets` and confirm the regex rejects it before any database or storage
  call is reached.
- Confirm no response body anywhere contains the code, the path, the bucket, or the signed URL.
  Grep your own diff for the response constructors and check each one.
- Confirm `not_found`, `expired` and `revoked` are byte-identical responses.
- Confirm the TTL constant is 300 and appears once.
- Confirm no `Access-Control-Allow-Origin` header is set on any path.
- Confirm `Cache-Control: no-store` is on the 302 specifically, not only on error responses.
- `npm run test:fleet` passes.

State in your report that the function is authored but not deployed, and that the RPC is not yet
applied.
