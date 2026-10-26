# Security Rules

## Overview

These rules exist so security problems are **prevented while the code is being written**, not
found weeks later by a scanner. Most of them come from findings of the security scans run on one
of our live products in September-October 2026; the rest come from problems hit while fixing
those findings. Each one was cheap to get right on the day the code was written and expensive to
fix afterwards.

Read the matching section **before** you plan or write code that:

- adds, upgrades or removes a library (npm package, vendored script, CDN tag) - section 1, 2
- handles a key, token, password or login - section 3
- adds or changes a server endpoint (Lambda, Function URL, edge function, API route) - section 4, 10
- verifies who a user is, or what they may access, on the server - section 4
- encrypts or decrypts anything - section 5
- makes an outbound HTTP call from the server, or follows a URL a user supplied - section 6
- writes HTML into the page, sends messages between windows, or stores generated HTML - section 2, 7
- runs a regex a user or admin typed - section 8
- decides which environment (dev / uat / prod) the code is running in - section 9
- changes the site's hosting headers or what gets published to the site - section 9
- logs, or returns error messages, from server code - section 10
- uploads a file that will be shared by a public link - section 11
- silences a scanner finding or accepts a risk - section 12

The same trigger list appears in `.claude/rules/security-rules.md` and
`.cursor/rules/security-rules.mdc`. **Change all three lists together.**

### Scope - read this first

- **These rules apply to code you write or change.** If existing code you did not touch breaks
  a rule, **report it** in your summary - do not refactor it as part of an unrelated change.
  Some existing exceptions are known and deliberate, and a "fix" without the surrounding rollout
  can take a working system down.
- **Authentication, token, encryption and environment changes need an ordered rollout** (for
  example: frontend first, then server configuration). Plan the order; never flip them in one
  step.
- **Where this file and an older example in another BluePrint doc disagree, this file wins.**
  Known cases:
  - token storage - `10_STEP_BLUEPRINT.md` 3.1 stores the token in `localStorage`, while
    `javascript-jquery-rules.md` "Sensitive Data Handling" says to use httpOnly cookies. Follow
    section 3 here.
  - security headers - `10_STEP_BLUEPRINT.md` 7.4 and the `<meta>` tag CSP in
    `BEST_PRACTICES.md` "Content Security Policy (CSP)". Follow section 9 here.

This file sits alongside the other BluePrint docs and does not repeat them:

| Topic | Where the rule lives |
|---|---|
| Never write a key, token or password as a literal in any committed file | `secrets-management-rules.md` |
| Escaping user content before it reaches the page (`.text()`, `textContent`) | `javascript-jquery-rules.md` - "XSS (Cross-Site Scripting) Prevention" |
| Which Lambda runtime to use | the Agent Fleet Lambda runtime rule (`.claude/rules/lambda-runtime.md`, `.cursor/rules/lambda-runtime.mdc`), installed when a repo is onboarded to Agent Fleet |
| Database access control (RLS, grants) | `supabase-database-rules.md` |

---

## 1. Adding, upgrading or removing a library

**Check for known vulnerabilities before you add or upgrade a library - not after.**

- Before you add or upgrade a package, look the exact version up on [osv.dev](https://osv.dev);
  after `npm install`, run `npm audit` before committing. Pick a version with **no** open high or
  critical advisories.
- **`npm audit` cannot see vendored files** (`vendors/`, this stack's default). For a vendored
  library, look up its exact version on [osv.dev](https://osv.dev), or run
  `npx retire --path vendors`.
- When you upgrade to fix an advisory, **re-check the new version too.** A patch release can fix
  some advisories and leave others. *Real case: a JSON query library was upgraded to close three
  critical code-execution advisories, and the new version still carried a fourth that needed one
  more patch release.*
- **Do not add deprecated or unmaintained libraries**, even if a tutorial uses them. Known ones:
  - `request` - deprecated, will never get security fixes. Use Node's built-in `http`/`https`
    or `fetch` - but read section 6 first: `fetch` follows redirects by itself unless you stop it.
  - `axios` 0.x (often pulled in by older helpers such as `easy-soap-request`) - many advisories.
    Use a current `axios` major, or the built-ins.
  - `moment` - legacy; old versions carry high-severity CVEs. Use the built-in `Date`/`Intl`, or
    a maintained date library.
- **Remove libraries nothing uses.** An unused library still ships, still loads, and still shows
  up as a vulnerability. Before removing, search the code *and* any code stored in the database.
- **Load each library once, at one version.** A page fragment must never re-load a library the
  main page already loads. *Real case: 19 tags in page fragments loaded an older copy of a
  spreadsheet library than the main page, silently downgrading it every time a user navigated.*
- **Prove the upgrade actually ships.** After a security upgrade, check that the built
  artifact (the Lambda zip, the bundle) contains the new version - ideally with a build step that
  fails if it does not. *Real case: a Lambda build copied `node_modules` from the previous
  deployment, so a security upgrade would not have shipped; it was caught before merge and the
  build gained a verify step.*
- **Prefer committing lockfiles.** If a repo deliberately ignores them, raise it rather than
  force-adding one.
- **Read the release notes of a major upgrade** for two things that bite later:
  - a **licence change** (one editor library moved to GPL-or-paid at a major version and opens
    read-only without a licence key);
  - a **minimum runtime** (a SOAP library's new major needed a newer Node.js than the function
    ran on).
- **Never overwrite a built-in browser or Node method** (for example `String.prototype.replaceAll`).
  If you need a polyfill, only add it when the native method is missing. *Real case: a custom
  `replaceAll` override was harmless for years, then broke every toolbar label the day a library
  upgrade started calling the native method.*

## 2. Third-party scripts and styles

- **Vendor the library locally** in `vendors/` (pinned version, with a note of where it came
  from). Do not add new CDN tags. Never hand-edit a vendored file: upgrading means replacing it
  with the new upstream release, and removing an unused one is allowed.
- **If a page already loads from a CDN (inherited code), until it is vendored:**
  - **Pin the exact version.** Never `@latest`, never a floating major such as `bootstrap@5`.
  - **Add `integrity` and `crossorigin="anonymous"`** (Subresource Integrity), so the browser
    refuses a file that has been tampered with.
  - **Never invent the hash.** Copy the CDN's published SRI value, or compute it from the exact
    file: `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A` (prefix the result
    with `sha384-`). A wrong hash makes the browser refuse the file and breaks the page.
  - Check the CDN sends `Access-Control-Allow-Origin` (SRI needs it), then **load the page and
    confirm the file loaded**.
  - The one accepted exception is Google Fonts CSS, which is generated per browser and cannot
    carry a fixed hash.
- **Self-host** anything served from an unmaintained mirror or a personal GitHub Pages site.
- **If code or an AI generates HTML, enforce the pins in code, not in the prompt.** A prompt that
  asks a model for pinned tags is a request, not a guarantee - rewrite the tags deterministically
  after generation. Generated HTML that was **already stored** (for example in the database) is
  not fixed by changing the generator; plan its update separately.
- **A new external source also needs the site's Content-Security-Policy updated** (section 9), or
  the browser will block it.

## 3. Keys and tokens - what the browser may hold

`secrets-management-rules.md` covers *literals in source*. These rules cover what is still
unsafe **even when nothing is hardcoded**:

- **Anything the browser holds, every user can read.** A shared service secret (an SMS gateway
  token, a queue key, a service-to-service key, a Supabase `service_role` key) must never be sent
  to, stored in, or sent from browser JavaScript - even if it is loaded at runtime rather than
  hardcoded. The server looks it up itself. *Real case: an SMS queue token was served in public
  JavaScript, where anyone viewing the page source could read it.*
- **"Committed file" includes everything in git**: docs, plan files, setup notes, test helpers,
  comments in ignore files, and AI tool settings such as `.claude/settings.local.json` permission
  rules. Each of these has leaked a real credential in our repos. `.claude/settings.local.json`
  and `.env*` files belong in `.gitignore`.
- **No fallback passwords in tests.** If a test needs a password, read it from an environment
  variable and fail with a clear message when it is missing.
- **A leaked key is fixed by revoking or rotating it, not by deleting the line.** Git history
  keeps the old value forever. Deleting the line only hides it from you.
- **Keep the user's token in one place: the repo's single auth service** (the session holder of
  the project's stack: the Supabase client's own session, the OASIS session, or for a
  direct-Lambda project the `authService` from `10_STEP_BLUEPRINT.md` 3.1). Do not add new
  storage keys, globals or copies of it. Moving tokens to httpOnly cookies is a planned migration of server and client together,
  never done in passing.
- **Send a user's token only to services that are its intended audience**, matched by an exact
  configured URL. Never to a third party, never in a URL, never in logs.

## 4. Verifying who the user is, and what they may access (server side)

- **Decoding a token is not verifying it.** A server must check the token's signature with the
  issuer's key before trusting any claim in it, and check the issuer (`iss`), audience (`aud`)
  and expiry (`exp`). *Real case: a set of functions decoded tokens without verifying them, so a
  hand-made token passed as any user.*
- **Pin the algorithm to the key type** (for example an EC key only accepts `ES256`). Never let
  the token's own header choose the algorithm.
- **Prefer public-key tokens (ES256/RS256)** where services verify tokens someone else issues: a
  verifier holding only the public key cannot mint tokens. Reject short shared-secret keys.
- **Supabase:** server code checks the user with `auth.getUser()` (or `getClaims()`), never by
  trusting `getSession()` or decoding the JWT by hand. Do not deploy edge functions with
  `--no-verify-jwt` unless the function verifies the caller itself.
- **Take identity from the verified token only** - never from a user id, email or tenant id in
  the request body or query string.
- **Check what the caller may access on every call** - including calls that take no parameters.
  *Real case: access rules were only checked while reading a call's parameters, so a procedure
  with no parameters skipped every rule.*
- **Compare secrets in constant time** (`crypto.timingSafeEqual`, after checking both values are
  the same byte length), never with `===`.
- **New checks fail closed.** If the secret or key a check needs is not configured, the endpoint
  refuses every request. (For an *existing* check that fails open, report it - turning it closed
  needs an environment check first, see Scope.)

## 5. Encryption

- **Never use `crypto.createCipher` / `crypto.createDecipher`.** They derive the key with MD5,
  and they no longer exist in current Node.js versions - code using them crashes on a runtime
  upgrade. Use `crypto.createCipheriv` / `createDecipheriv` with a real key.
- **Prefer AES-256-GCM:**
  - a fresh random 12-byte IV for every encryption, never reused with the same key;
  - when decrypting, check the input is long enough to hold IV + ciphertext + tag before slicing
    it, set `authTagLength: 16` explicitly, and call `setAuthTag()` before `final()`;
  - treat an error from `final()` as tampering - reject the data, never ignore the error.
- **Keys and passphrases come from configuration**, never from source (see
  `secrets-management-rules.md`).
- If old data must stay readable, isolate a byte-compatible replacement (the same key/IV
  derivation, rebuilt on `createDecipheriv`) in one small, tested module behind an explicit
  setting, switched on as part of the ordered rollout (see Scope) so existing data keeps
  decrypting. It must not call `createCipher`/`createDecipher`, which no longer exist.

## 6. Outbound HTTP calls and user-supplied URLs (server side)

- **If the server attaches a credential it holds** (an API key, an `Authorization` header) to an
  outbound call, **the destination must come from server configuration the caller cannot
  change.** A public attacker-owned host passes every "is it a public address" check and still
  receives the secret. *Real case: a gateway let the caller override the URL of a call that the
  server then sent with its own credential; the existing check only blocked private
  addresses.*
- **Validate the destination before the first request *and on every redirect hop*.** Checking
  only the first URL lets a redirect send the server to an internal address (SSRF). With
  `fetch`, that means `redirect: 'manual'` and checking each `Location` yourself; with
  `http`/`https`, you write the redirect loop.
- **Drop `Authorization`, `Cookie` and `Proxy-Authorization` when a redirect changes the
  hostname.** Refuse a redirect from `https` to `http`.
- **One overall timeout for the whole call**, including redirects.
- **Never put full URLs, request bodies or credentials in error messages or logs** (section 10).
- **A URL a user supplied** (a logo, a webhook, an image) is fetched only after checking that the
  address it **resolves to** is public: block loopback, private, link-local (including
  `169.254.169.254`), `0.0.0.0`, and their IPv6 and IPv4-mapped forms (such as
  `::ffff:127.0.0.1`). Check the resolved IP, not the hostname text, **connect to the IP you
  checked** (a second lookup can return a different address), and re-check on every redirect
  hop.

## 7. Writing HTML and talking between windows (browser)

- Escape every dynamic value before it reaches an HTML sink - see `javascript-jquery-rules.md`.
  Sinks include `innerHTML`, `insertAdjacentHTML`, `document.write()`, and jQuery's `.html()`,
  `.append()`, `.prepend()`, `.after()`, `.before()`, `.replaceWith()` and `$(htmlString)` when
  given a string. This applies to values from our own database too, not just what the user
  typed: lookup values and names are editable data.
- **Never put a dynamic value into `href`/`src` without checking its scheme** - a
  `javascript:` URL runs code when clicked.
- **`postMessage` always names the exact target origin** (for example `window.location.origin`),
  never `'*'`.
- **Every `message` listener checks `event.origin`** and ignores anything from an origin it does
  not expect.

## 8. Patterns (regular expressions) that users or admins configure

If users or admins can type a regex that the server then runs (email rules, keyword filters):

- **Use a linear-time regex engine** (RE2, for example the `re2` npm package). That is the real
  protection: some patterns, such as `(a+)+$`, hang the ordinary engine on about 30 characters,
  so capping the input length does not stop them.
- Without such an engine, run the match where it can be stopped (a worker thread with a
  timeout).
- Rejecting obviously dangerous patterns (nested quantifiers, overlapping alternations inside a
  repeat, backreferences, very long patterns) and capping the text a pattern runs against both
  help, but neither is enough on its own.
- **A missing or rejected pattern matches nothing** - never everything.

## 9. Environments, publishing and hosting

- **Preview and branch-deploy hosts must map to dev explicitly** (for example
  `pr-<n>.<appId>.amplifyapp.com`). *Real case: every pull-request preview site was detected as
  "prod" and ran unreviewed code against production data.*
- **A new environment detector lists the prod hostnames explicitly and defaults to dev.** Before
  changing the default of an **existing** detector, list every real prod hostname and pin them in
  a test - flipping the default alone points production at dev.
- **Dev never points at production resources** (databases, buckets, gateways). Check the
  environment config of every new function and page.
- **Retiring a service means removing the endpoint itself** (delete the Function URL or route, or
  put authentication on it). Deleting the config entry is not enough - the URL is still in git
  history.
- **Publish only runtime files.** The hosting build publishes an allowlist of what the site needs
  (the root HTML pages, `js/`, `css/`, `modules/`, `vendors/`, `assets/`, plus any other folder
  the site loads at runtime) - never the whole repository. Never publish `BluePrint/`, `sql/`,
  `lambda/`, `scripts/`, `tests/`, `Playwright Tests/`, `.claude/`, `.cursor/`, `CLAUDE.md`,
  `README.md`, `amplify.yml` or `package.json`, and never `docs/` as a whole folder - allowlist
  only the single files the app links to (for example a user-guide PDF). Make the build fail if a forbidden
  path reaches the output, and load the site after changing the list. *Real case: a scan
  downloaded `package.json` from the live site - the build was publishing the whole repository,
  including `CLAUDE.md`, `sql/` and internal docs.*
- **Baseline hosting headers**, sent as real HTTP headers (Amplify `customHttp.yml` or
  equivalent) - **never as a `<meta>` tag**, where some directives are ignored:

  | Header | Baseline |
  |---|---|
  | `Strict-Transport-Security` | `max-age=31536000`, set only after confirming every host redirects http to https. Start short (one day) and raise it after a clean week. **No `includeSubDomains` or `preload`** until every subdomain is confirmed HTTPS-only. |
  | `Content-Security-Policy` | Enforced, not report-only. Run it report-only first and sweep every page for violations, then enforce. Always include `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, and `form-action 'self'` plus any origin a form posts or redirects to (a payment gateway, a login provider) - a page-load sweep does not catch these, because the violation only fires on submit. jQuery/Phoenix-style pages with inline handlers still need `'unsafe-inline'` (and `'unsafe-eval'` if anything evaluates code at runtime - code stored in the database, template compilers); removing those is a separate project - a "strict" policy added in passing will blank the app. Keep the whole value under the CDN's header length limit (about 1,783 characters on Amplify/CloudFront) by collapsing hosts into wildcards. |
  | `X-Frame-Options` | `SAMEORIGIN` - unless the site is meant to be embedded by another site; then list those origins in the CSP's `frame-ancestors` and drop `X-Frame-Options` (it has no report-only mode, so it breaks embedding the moment it ships). |
  | `X-Content-Type-Options` | `nosniff` |
  | `Referrer-Policy` | `strict-origin-when-cross-origin` |
  | `Permissions-Policy` | Switch off every browser feature the site does not use (camera, microphone, geolocation, payment, usb). A new feature that needs one changes this header first. |

  Do not add `X-XSS-Protection`; modern browsers ignore it and the CSP replaces it.

## 10. Logging and error messages (server side)

- **Log by allow-list.** Log key names, counts, ids and outcomes - never request bodies,
  headers, SQL text, configuration values, upstream responses, session data or parameter values.
  *Real case: a gateway logged every request body, header, SQL string and upstream response on
  every call.*
- **Unexpected failures return a generic message plus a request id.** Internal errors (database
  driver, parse errors, stack traces) stay in the logs. A validation error the caller can fix may
  say what to fix, but never echo the submitted value - a parse error message can echo it, so
  never pass one through verbatim.

## 11. Files shared by a public link

- **Every uploaded file gets its own random, unguessable name** - at least 122 random bits from
  a secure source (`crypto.randomUUID()`, or 16 bytes from `crypto.getRandomValues()`; never
  `Math.random()` or a timestamp). Never one fixed name per document type, and never a name built from ids. *Real
  case: generated documents were uploaded to one fixed name per type, so every send overwrote
  the last and an older client link opened another client's document.*
- **Public links expire** where the platform allows it (for example a pre-signed URL with a
  lifetime of days, not a permanent public-read object). A pre-signed URL dies when the
  credentials that signed it expire (a Lambda role's last hours, not days); for links that must
  last days, hand out a link to your own endpoint that checks it and issues a fresh short-lived
  pre-signed URL on each click.

## 12. When a finding cannot be fixed yet

Sometimes a fix is genuinely not possible yet (no patched version exists, a key cannot be rotated
until a system is retired). Then:

- Accept the risk **in writing**: what it is, why it cannot be fixed now, who decided, and a
  **review date**.
- Silence a scanner finding by its **exact fingerprint or code hash** wherever possible. Exclude
  a whole folder only for code that is never deployed, with the reason written down. Never
  silence a whole rule or file just because it is noisy.
- Check that the suppression key is actually unique - if every finding produces the same hash,
  one suppression silently hides all of them.
- Never paste the secret itself into the note that accepts it.

---

## Quick reference checklist

Run through this before you finish a change:

- [ ] Any new or upgraded library was checked for known vulnerabilities **at the exact version
  used** (vendored files included), and is not deprecated or unmaintained
- [ ] No unused library was added; no library is loaded twice or at two versions
- [ ] The built artifact was checked to contain the upgraded version
- [ ] No built-in method (`String.prototype.*`, `Array.prototype.*`, ...) is overwritten
- [ ] New third-party code is vendored; any inherited CDN tag is pinned with a **real**
  `integrity` hash + `crossorigin="anonymous"`, and the page was loaded to confirm it works
- [ ] No shared service secret is sent to, stored in, or sent from the browser
- [ ] No credential in docs, plans, test helpers, comments or AI tool settings; no fallback
  passwords in tests
- [ ] The token stays in the repo's single auth service, and goes only to its intended audience
- [ ] Tokens are verified (signature, algorithm pinned, `iss`/`aud`/`exp`), not just decoded;
  identity comes from the verified token only; access is checked on every call
- [ ] Secret comparisons are constant-time; a new check fails closed when its secret is missing
- [ ] No `createCipher`/`createDecipher`; AES-GCM uses a fresh IV, checks length, sets
  `authTagLength`, and rejects data when `final()` throws
- [ ] A call carrying a server credential goes only to a configured destination; other outbound
  calls re-validate the resolved IP on every redirect and drop auth headers when the host changes
- [ ] Dynamic values are escaped before any HTML sink, including jQuery string sinks;
  `href`/`src` schemes are checked; `postMessage` names an exact origin and listeners check
  `event.origin`
- [ ] User-configured regexes run on a linear-time engine or a killable worker; a missing
  pattern matches nothing
- [ ] Preview hosts map to dev; dev never points at prod resources
- [ ] Only runtime files are published; headers are real HTTP headers matching the baseline;
  any new external source or form target is in the CSP
- [ ] Server logs are allow-listed; callers get a generic error plus a request id
- [ ] Publicly linked files have random, unguessable names and expiring links
- [ ] Existing violations found along the way are reported, not silently refactored
- [ ] Anything left unfixed is written down with a reason, an owner and a review date
