---
depends_on: report-whatsapp-04b-delivery-history.md
notify: henry@customapp.co.za
retry_of: c556270b-7d41-45f6-9ee4-f86cb7a9e871
---

# Report WhatsApp distribution, part 5b — stop the seven phone normalisers drifting apart

## Context

There are **seven** independent implementations of "turn a typed South African number into a
canonical WhatsApp address", in three languages, across three deployment units that cannot import
from one another. Nothing keeps them in step.

The consequence is specific. The unique index on `report_recipients` is built on the SQL version
(`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:93-94`):

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_recipients_phone_norm
    ON public.report_recipients (public.report_normalize_wa_phone(phone));
```

If a JS copy disagrees with it, `0821234567` and `+27821234567` become two recipients and one person
receives the same confidential report twice — or a de-duplication silently drops a recipient who then
never receives it and whose absence nobody notices.

Two artifacts already name this script by name, before it exists: the `COMMENT ON FUNCTION` for
`report_normalize_wa_phone` (`…20260822090000…sql:68-69`), and the header comment on `normalizeKey`
at `WebPortal/modules/sales-reports/js/report-whatsapp-send.js:61-65`. This plan writes it.

## Why this waits on 04b

`depends_on: report-whatsapp-04b-delivery-history.md`. Not an order dependency in the data sense —
a **shared-file** one. 04b is the last plan in this batch to edit `package.json`'s `test:fleet` line
(it adds `report-whatsapp-history:verify`). Two plans racing on the same line produce a real,
human-must-resolve merge conflict, because the fleet runs several plans concurrently from separate
snapshots and never auto-resolves.

**Read what merged before writing.** 04b has landed on the base branch:
`report-whatsapp-history:verify` is present at `package.json:28` and in the `test:fleet` chain at
`:31`, and `scripts/verify-report-whatsapp-history.mjs` exists. Confirm that yourself before editing
`package.json`; append your entry to the end of the existing chain, do not reorder it.

## The inventory — SEVEN implementations, all re-verified against this checkout

Two earlier drafts of this plan got this list wrong. Do not carry any earlier list forward; the list
below is the one to encode, and you must re-confirm every row by reading the file before writing the
script.

Corrections already applied here, stated so you do not "restore" them:

- `supabase/functions/whatsapp-inbound/index.ts` is **not** a normaliser. It has zero
  `replace(/\D/g` hits; it receives an already-normalised number. (The comment at
  `…20260822090000…sql:32-33` claims otherwise — that comment is stale. Correcting it is **out of
  scope** for this plan; do not edit any migration.)
- An earlier draft listed only six implementations and missed the inline one in
  `chat_start_contact_conversation`. It is row 7 below. `…20260813090000…sql:70-71` points straight
  at it: `chat_normalize_phone` "Mirrors the inline normalisation in Part 1's
  `chat_start_contact_conversation` exactly".

| # | Location | Lang | Empty/no-digit input | Format | Group |
| - | -------- | ---- | -------------------- | ------ | ----- |
| 1 | `supabase/functions/send-whatsapp-message/index.ts:65-70` `normalizePhone` | TS | `'+27'` (no guard) | `+27…` | `GROUP_PLUS_UNGUARDED` |
| 2 | `supabase/functions/send-daily-digest-whatsapp/index.ts:42-47` `normalizePhone` | TS | `'+27'` (no guard) | `+27…` | `GROUP_PLUS_UNGUARDED` |
| 3 | `supabase/functions/send-report-whatsapp/index.ts:148-153` `normalizePhone` | TS | `'+27'` (no guard) | `+27…` | `GROUP_PLUS_UNGUARDED` |
| 4 | `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:46-66` `report_normalize_wa_phone` | PL/pgSQL | `NULL` (explicit guard :54-56) | `+27…` | `GROUP_PLUS_GUARDED` |
| 5 | `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92` `chat_normalize_phone` | PL/pgSQL | `NULL` (explicit guard :81-83) | `27…` **no `+`** | `GROUP_BARE_GUARDED` |
| 6 | `WebPortal/modules/sales-reports/js/report-whatsapp-send.js:66-75` `normalizeKey` | JS | `null` (explicit guard :68) | `+27…` | `GROUP_PLUS_GUARDED` |
| 7 | `migrations/20260812100000_crm_whatsapp_module.sql:198-205`, inline in `chat_start_contact_conversation` (created at :159, body `$$` at :171-235) | PL/pgSQL | **no guard at all** | `27…` **no `+`** | `GROUP_BARE_UNGUARDED` |

Row 7's value is written into `chat_conversations.external_phone` at `:217-218` and returned as
`resolved_phone` at `:233`.

**A known non-normaliser that shares the giveaway idiom and must be allowlisted:**
`WebPortal/modules/crm-whatsapp/js/crm_whatsapp_contacts_tab.js:33-41` `formatPhone` — it uses
`replace(/\D/g, '')` but produces a **display** form (`+27 71 463 9643`, with spaces), not a
canonical key. Under the sweep rule defined below it *is* a candidate hit, so it must be an explicit
allowlist entry with that reason inline.

### The four groups, and what is deliberate vs what is a defect

Every implementation applies the **same three rules** — strip non-digits; leading `0` → `27`; no
leading `27` and `length <= 11` → prefix `27`. They differ on exactly two axes, and those two axes
are what the script asserts:

1. **`'+'` prefix or bare digits.** Rows 5 and 7 return bare digits. That is right for their own
   callers (the shared WhatsApp inbox / CRM conversation lookup). Assert that for every input where
   they produce a value, it equals the `+`-prefixed result **minus the leading `+`** — which proves
   the *rule* is shared even though the *format* is not. Row 6's header comment (:61-65) already
   warns against mirroring the bare-digit form into the report path; that warning is part of what
   this script protects.
2. **Empty / no-digit input.** Rows 4, 5 and 6 guard explicitly and return NULL/null. Rows 1-3 and 7
   do **not** guard, and the second rule then fires on the empty string: rows 1-3 return **`'+27'`**
   and row 7 produces **`'27'`**.

**Read this part carefully — an earlier draft of this plan stated it wrongly and would have made the
script assert a value the code does not produce.** For rows 1-3, `''.replace(/\D/g,'')` is `''`;
`''.startsWith('0')` is false so the first `if` does not fire; but `!''.startsWith('27')` is **true**
and `''.length <= 11` is **true**, so `p` becomes `'27'` and the function returns `` `+${p}` `` =
**`'+27'`**. Not `'+'`. Assert `'+27'`. If your own trace disagrees with this paragraph, trust your
trace of the code and say so in the report.

This is **not** a benign, deliberate divergence, and the script must not describe it as one. It is an
open defect: a blank or digit-free string becomes the plausible-looking address `+27` and is handed
to the meta-proxy. Verified reachability, per call site — state it this precisely and no more
broadly:

- `send-whatsapp-message/index.ts:126` — **reachable.** The `if (!to || !body)` guard at :116 blocks
  `''` but not `'   '` and not `'abc'`.
- `send-daily-digest-whatsapp/index.ts:98` — **reachable.** `if (!raw) continue;` at :97 blocks
  blank-after-trim, but `raw` is `(sub.phone || sub.email || '').trim()`, so an email address (no
  digits) reaches `normalizePhone` and yields `'+27'`.
- `send-report-whatsapp/index.ts:437` — **not reachable for digit-free input.** `begin_report_delivery`
  computes `report_normalize_wa_phone(p_phone)` at `…20260822090000…sql:313`, rejects NULL at
  `:329-332`, and the function skips the send entirely at `index.ts:412-421`.

Record that as a **known open defect, unfixed by this plan**, in the script header and in the report.
Do not word it as intentional, do not "document it as the design", and do not change any of the
seven implementations (see out of scope). Fixing it needs its own plan, because a guard added to
rows 1-3 changes what those three edge functions send.

### One structural note worth testing rather than reasoning about

Rows 1-3, 5 and 7 use two **sequential** `if`/`IF` statements; rows 4 and 6 use `IF/ELSIF` /
`else if`. These are equivalent for every digit-bearing input because the first branch's output
always starts `27`, so the second condition is false anyway. **Establish that by running the truth
table, not by asserting it in a comment.** The only place the structures diverge is empty input, and
there the difference is the guard (axis 2), not the branch shape.

## Constraint: this script cannot execute the SQL

`package.json`'s own `//test:fleet` comment (**:30**) states the gate "Must stay FAST and HERMETIC:
pure Node stdlib, no browser, no login, no network, no deployed app," and warns by name against
adding `rbac:verify` or `audit:verify` (both call Supabase with a service-role key) or the Playwright
suite.

So the SQL checks (rows 4, 5, 7) are **text assertions on the migration files**, and the shared truth
table runs against a Node reference implementation plus the two loadable JS/TS-side copies. Say that
plainly in the script header: it proves the files in the repo, not the functions in any database, and
a database can drift from a file — only re-applying the migration reconciles them. **Do not report a
text comparison as a behavioural one.**

## Models to follow

Read all three before writing:

- `scripts/verify-report-whatsapp-payload.mjs` — **the closest model for the TypeScript side.** Its
  header (:12-19) records the pattern: assert the **exact literal source text** is still present in
  the `.ts` file, and separately **re-declare an identical copy** in the script to run test cases
  against, so drift is caught loudly rather than silently. Use exactly this pattern for rows 1-3.
- `scripts/verify-report-whatsapp-picker.mjs` — the model for loading a `window`-touching browser
  module into a bare `vm` context (`loadModule()` at :55-65) and for the `check(description, fn)`
  harness at **:72**. Its tests 1 at :105-123 already exercise `_normalizeKey` on five accepted
  inputs and three digit-free ones; this script must not restate those as its own coverage — its job
  is to compare that implementation against the other six.
- `scripts/verify-migration-prefixes.mjs` — pure `fs`, `file:line` violations, non-zero exit. Its
  header (:27-30) records that its baseline is read-only at runtime: "If this script reports a new
  failure, the correct response is to fix the filename that caused it — never to add another entry to
  the baseline." Adopt that stance: **no `--update` flag, no auto-heal.**

**Do not try to evaluate the TypeScript sources in a `vm`.** `function normalizePhone(phone: string): string {`
is not valid JavaScript — `new vm.Script(...)` throws a `SyntaxError` on the type annotations. That
is why rows 1-3 use the exact-literal + re-declared-copy pattern above and not extraction. Row 6 *is*
plain JS and *is* loaded via `vm`, exactly as `verify-report-whatsapp-picker.mjs` does.

`node --test` is not used anywhere in this repo and no `*.test.mjs` exists under `WebPortal/`. Add no
test framework, no dependency, no devDependency. `node:assert` is sufficient. (`npm ci` fails here —
no `package-lock.json`, zero dependencies; `CLAUDE.md:45` records this. Run `npm run test:fleet`
directly.)

## Deliverable

`scripts/verify-report-whatsapp-parity.mjs`, plus one line in `package.json` wiring it into
`test:fleet` as `report-whatsapp-parity:verify` (appended to the end of the existing chain at :31,
with the script entry added after `report-whatsapp-history:verify` at :28). Change nothing else in
`package.json` — in particular do not touch the `//test:fleet` comment or reorder existing steps.

### Named things this script defines, used consistently below

Define each of these once, near the top, and refer to them by exactly these names everywhere else in
the script. Every identifier named in a later check must be one defined here.

- `digitsOf(raw)` — `String(raw == null ? '' : raw).replace(/\D/g, '')`.
- `canonicalPlus(raw)` — the Node reference implementation of the **unguarded, `+`-prefixed** rule,
  character-for-character the algorithm of rows 1-3:
  ```js
  function canonicalPlus(raw) {
    let p = digitsOf(raw);
    if (p.startsWith('0')) p = '27' + p.slice(1);
    if (!p.startsWith('27') && p.length <= 11) p = '27' + p;
    return '+' + p;
  }
  ```
- Group constants, spelled exactly: `GROUP_PLUS_UNGUARDED`, `GROUP_PLUS_GUARDED`,
  `GROUP_BARE_GUARDED`, `GROUP_BARE_UNGUARDED`.
- `expectedFor(group, raw)` — the single source of every expectation:
  ```js
  function expectedFor(group, raw) {
    const empty = digitsOf(raw) === '';
    if (group === GROUP_PLUS_UNGUARDED) return canonicalPlus(raw);
    if (group === GROUP_BARE_UNGUARDED) return canonicalPlus(raw).slice(1);
    if (group === GROUP_PLUS_GUARDED)   return empty ? null : canonicalPlus(raw);
    if (group === GROUP_BARE_GUARDED)   return empty ? null : canonicalPlus(raw).slice(1);
    throw new Error('unknown group: ' + group);
  }
  ```
  **The `empty` short-circuit is load-bearing and must come before any `canonicalPlus` call for the
  guarded groups.** `canonicalPlus` deliberately reproduces the *unguarded* behaviour (`'' → '+27'`);
  reusing it unqualified to derive a guarded group's empty-input expectation would assert `'+27'` /
  `'27'` where the code returns NULL/null. Do not collapse these four branches into a shared
  fallback.
- `INVENTORY` — the seven `{ n, file, kind, identifier, group, lines }` rows from the table above.
- `SWEEP_ALLOWLIST` — the single `crm_whatsapp_contacts_tab.js` / `formatPhone` entry, with its
  reason inline.
- `TS_NORMALIZER_LITERAL` — the exact source block of rows 1-3 (see check 2).
- `isolateDollarBody(source, anchor, tag)` — see check 4.
- `check(description, fn)` — harness modelled on `verify-report-whatsapp-picker.mjs:72`.

### What it checks

**1. Every listed implementation is present, and no unlisted one exists.** Hold `INVENTORY` plus
`SWEEP_ALLOWLIST` as explicit lists. A **missing** entry fails (assert the identifier's defining text
is present in its named file). So does an **unlisted** one. The sweep rules must be spelled out in
code and in the header, because a vague rule is the difference between a load-bearing check and a
decorative one:

- **JS/TS candidate:** any `.ts` under `supabase/functions/` or any `.js` under `WebPortal/` whose
  text contains the substring `replace(/\D/g` **and** contains the two-character sequence `27`
  anywhere. On the current tree this matches exactly five files: rows 1, 2, 3, 6 and the allowlisted
  `crm_whatsapp_contacts_tab.js`. (The two-character rule, not a quoted `'27'` rule, is deliberate:
  `formatPhone` has no quoted `'27'` literal — only `/^27\d{9}$/` and `'+27 '` — so a quoted-literal
  rule would never flag it and the allowlist entry would be decorative.)
- **SQL candidate:** any `migrations/*.sql` whose text contains the substring `'\D', '', 'g'`
  **and** contains `'27'`. On the current tree this matches exactly three files: `…20260812100000…`
  (row 7), `…20260813090000…` (row 5), `…20260822090000…` (row 4). Assert that count is 3 as a
  self-check, so a future migration adding a normaliser trips it.
- Fail on any candidate hit in a file that neither `INVENTORY` nor `SWEEP_ALLOWLIST` names, printing
  `file:line`.
- State the sweep's **blind spot** in the header, honestly: a normaliser written with a different
  digit-stripping idiom (a character-class other than `\D`, a loop) is not caught. The sweep catches
  copies of the idiom actually used here, not all conceivable normalisers.

**2. The three TypeScript copies are byte-identical to each other and to the Node reference.** Assert
`TS_NORMALIZER_LITERAL` — the exact five-line block, verbatim from `send-whatsapp-message/index.ts:65-70`:

```
function normalizePhone(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '27' + p.slice(1);
  if (!p.startsWith('27') && p.length <= 11) p = '27' + p;
  return `+${p}`;
}
```

— is present verbatim in all three files. Confirm the literal against the files before hard-coding
it; if it differs by even whitespace, use what the files actually contain and note the correction in
the report. On failure, the message must name the file and say: update all three copies **and** this
script's literal. This is a **textual** identity check, deliberately stricter than behavioural — a
reformatting of one copy fails loudly rather than passing silently. That trade-off is the one
`verify-report-whatsapp-payload.mjs:12-19` already made in this repo for the same reason; state it in
the header. The behavioural half is that `canonicalPlus` re-declares the same algorithm and is run
against the truth table in check 5.

**3. The browser copy (row 6) matches on every truth-table input.** Load `report-whatsapp-send.js`
the way `verify-report-whatsapp-picker.mjs:55-65` does and call `_normalizeKey`, asserting
`expectedFor(GROUP_PLUS_GUARDED, input)` for every row — including `null` for the digit-free rows.

**4. All three SQL bodies still contain their expected rules** (text assertions, labelled as such in
every message).

Isolation is where a text check most easily passes for the wrong reason, so implement one helper and
guard it:

```js
// anchor: the exact CREATE … text; tag: '$fn$' or '$$'
function isolateDollarBody(source, anchor, tag) { … }
```
It must: find `anchor`; find the first occurrence of `tag` at or after the anchor; take the body up
to the **next** occurrence of `tag`; and then **self-check** the slice — non-empty, and containing
none of `CREATE OR REPLACE FUNCTION`, `CREATE FUNCTION`, `ALTER TABLE`, or the name of any other
function in that file. If the self-check fails, exit non-zero with an explicit "body isolation
failed" message. Never fall back to a whole-file search.

- **Row 4**, anchor `CREATE OR REPLACE FUNCTION public.report_normalize_wa_phone(`, tag `$fn$`.
  Assert: `regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')`; the empty guard
  `IF v_digits = ''` with `RETURN NULL;`; `left(v_digits, 1) = '0'` substituting
  `'27' || substr(v_digits, 2)`; `ELSIF left(v_digits, 2) <> '27' AND length(v_digits) <= 11`
  prefixing `'27' || v_digits`; and `RETURN '+' || v_digits;`.
- **Row 5**, anchor `CREATE OR REPLACE FUNCTION public.chat_normalize_phone(`, tag `$$`. The anchor
  matters: this file also contains a `DO $$ … END $$;` block at :58-63 **before** it and
  `chat_format_phone` at :95-111 **after** it, and `chat_format_phone` does `RETURN '+' || v` — a
  naive `$$` split would either spuriously fail or silently invert the next assertion. Assert:
  `regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g')`; the empty guard `IF v_phone = ''` with
  `RETURN NULL;`; `v_phone ~ '^0'` → `'27' || substring(v_phone from 2)`;
  `NOT (v_phone ~ '^27') AND length(v_phone) <= 11` → `'27' || v_phone`; `RETURN v_phone;`; that the
  isolated body contains **no** `'+' ||`; and that it contains **no** `ELSIF` (sequential-`IF` form).
- **Row 7**, anchor `CREATE FUNCTION public.chat_start_contact_conversation(`, tag `$$`. Note this
  file has an earlier function whose body also ends `$$;` at :155, so anchoring on the `CREATE` text
  is required. Assert: `regexp_replace(v_raw_phone, '\D', '', 'g')`; `v_phone ~ '^0'` →
  `'27' || substring(v_phone from 2)`; `NOT (v_phone ~ '^27') AND length(v_phone) <= 11` →
  `'27' || v_phone`; that the block contains **no** `'+' ||`; and — the row's distinguishing
  property — that it contains **no** `IF v_phone = ''` empty guard, so a future edit that adds or
  removes one is caught. Also assert the isolated body contains `external_phone` (the sink at
  :217-218), so the isolation is demonstrably the right function.

**5. The shared truth table**, run against `canonicalPlus` (rows 1-3's algorithm) and against row 6
via `_normalizeKey`, with every expectation produced by `expectedFor`. Include the raw digit string
(`digitsOf(input)`) in each failure message so a break is diagnosable.

| Input | `GROUP_PLUS_UNGUARDED` (1-3) | `GROUP_PLUS_GUARDED` (4, 6) | `GROUP_BARE_GUARDED` (5) | `GROUP_BARE_UNGUARDED` (7) |
| ----- | ---------------------------- | --------------------------- | ------------------------ | -------------------------- |
| `0821234567` | `+27821234567` | `+27821234567` | `27821234567` | `27821234567` |
| `27821234567` | `+27821234567` | `+27821234567` | `27821234567` | `27821234567` |
| `+27821234567` | `+27821234567` | `+27821234567` | `27821234567` | `27821234567` |
| `+27 82 123 4567` | `+27821234567` | `+27821234567` | `27821234567` | `27821234567` |
| `(082) 123-4567` | `+27821234567` | `+27821234567` | `27821234567` | `27821234567` |
| `821234567` | `+27821234567` | `+27821234567` | `27821234567` | `27821234567` |
| `0027821234567` | `+27027821234567` | `+27027821234567` | `27027821234567` | `27027821234567` |
| `''` | `+27` | `null` | `null` | `27` |
| `'   '` | `+27` | `null` | `null` | `27` |
| `'abc'` | `+27` | `null` | `null` | `27` |

The `0027821234567` row is not a typo and must not be "corrected" to what a proper international
parser would produce. It strips to `0027821234567`, which starts with `0`, so the first branch
substitutes `'27'` for **only the first character**: `'27' + '027821234567'` = `27027821234567`.
(An earlier draft of this plan wrote `27` + `27821234567` here; that was wrong — the substitution is
`p.slice(1)` / `substr(v_digits, 2)`, dropping one zero, not two characters.) **Trace it by hand
against each implementation before writing it down, and write down whatever the algorithm actually
produces; if your traced value differs from this table, trust your trace and say so in the report.**
The row pins the current behaviour of a genuinely surprising input, and the script must carry a
comment recording that a `00`-prefixed international number is **not** handled correctly by any of
the seven. That is a real limitation of the existing code, not something this plan changes.

**6. The bare-digit forms of rows 5 and 7** are asserted through `expectedFor` — i.e. equal to the
`+`-prefixed result minus the leading `+` — for every row where they produce a value, which is what
proves the rule is shared while the format differs. Because rows 5 and 7 are SQL, this is asserted
against the Node derivation and paired with check 4's text assertions; label it as such in the report
and do not present it as having executed any SQL.

**7. The empty/no-digit divergence**, asserted with the corrected values and the correct
characterisation:
- rows 1-3 → `'+27'` (assert this exact string; it is **not** `'+'`),
- rows 4, 5, 6 → NULL/null via their explicit guards,
- row 7 → no guard at all (asserted textually in check 4).

The inline comment must say: the guarded behaviour is correct and load-bearing — it keeps a blank
number out `of idx_report_recipients_phone_norm` and lets `upsert_report_recipient`
(`…20260822090000…sql:224-227`) reject it with "A valid phone number is required." The **unguarded**
behaviour of rows 1-3 is a **known open defect, not a design decision**: a digit-free string becomes
`+27` and is sent to the meta-proxy, reachable at `send-whatsapp-message/index.ts:126` and
`send-daily-digest-whatsapp/index.ts:98`, and **not** reachable at `send-report-whatsapp/index.ts:437`
because `begin_report_delivery` rejects a NULL normalisation first
(`…20260822090000…sql:313`, `:329-332`; skip path at `index.ts:412-421`). This plan does not fix it;
the assertion exists so that a future fix is a deliberate, visible change to this script rather than
a silent one.

### What it must NOT do

- No network, no database, no browser, no deployed app — it runs on every fleet merge.
- No dependency, no test framework, no `node --test`.
- No `--update-baseline`, no auto-heal. A failure means fix the code, not the check.
- No change to any of the seven implementations, and **no change to any migration file** — not even a
  comment. Unifying the implementations would need a shared module across three deployment units that
  cannot import from one another, and `supabase/functions/whatsapp-inbound/index.ts:175-185` already
  records this class of duplication as a deliberate, documented trade-off: "this ~25-line duplication
  is the deliberate trade-off. The two payload shapes must stay in step by hand." This script is what
  "by hand" becomes.
- No edit to `package.json` beyond the two lines described under Deliverable; do not weaken, reorder
  or shorten the existing `test:fleet` chain.

## Verify before finishing

1. `node scripts/verify-report-whatsapp-parity.mjs` exits 0 against the current tree. If it does not,
   the fault is in the script or in this plan's expectations — investigate and report which, and do
   not "fix" it by narrowing a sweep or deleting an assertion.
2. **Prove the check can fail** — one that cannot is not a check. For each of these, make the edit,
   observe the failure, then revert it, and confirm a non-zero exit whose message names the file:
   - change `<= 11` to `<= 12` in one TypeScript copy
   - change `'27'` to `'26'` in `report_normalize_wa_phone`'s body
   - delete the `'+' ||` from `report_normalize_wa_phone`'s return
   - add an `IF v_phone = '' THEN RETURN; END IF;` guard into row 7's inline block (proves the
     no-guard assertion is live)
   - remove one listed implementation from `INVENTORY`
   - add a scratch file containing an eighth `replace(/\D/g` + `27` copy
   Report all six outcomes. **Leave the tree clean** — `git status --porcelain` must show only the
   two intended changes when you finish.
3. Confirm `formatPhone` in `crm_whatsapp_contacts_tab.js` does **not** trigger the unlisted-copy
   check, and that removing it from `SWEEP_ALLOWLIST` **does** trigger it. Under the two-character
   `27` rule above it must trigger; if it does not, your sweep rule is stricter than specified — fix
   the rule, do not delete the allowlist entry.
4. Confirm the isolation self-check is live: temporarily point row 5's anchor at
   `chat_format_phone` instead and confirm the run fails (rather than quietly asserting against the
   wrong body), then revert.
5. `npm run test:fleet` passes with the new script wired in — run it directly, not via `npm ci`.
   Report the measured time; this script should add well under a second.
6. `grep -n "fetch\|child_process\|spawn\|import(" scripts/verify-report-whatsapp-parity.mjs` —
   confirm nothing outside `node:fs` / `node:path` / `node:vm` / `node:assert` / `node:url`.

## Out of scope

Unifying the implementations. Any migration edit, including correcting the stale claim at
`…20260822090000…sql:32-33` that `whatsapp-inbound/index.ts` holds a copy. Any UI. Adding an
empty-input guard to rows 1-3 (record it as a known open defect; do not change behaviour). Fixing the
`00`-prefix limitation — document it, do not change behaviour. A plan that changes how numbers are
parsed needs its own review, because it would change what the unique index considers a duplicate for
every row already in the table.

## Report

Under 25 lines: the seven-row inventory as you verified it (including the `whatsapp-inbound`
non-normaliser and the `formatPhone` allowlist), the exact sweep rules you implemented and the
candidate counts they produced (expected: 5 JS/TS, 3 SQL), which rows were checked behaviourally vs
textually, the final truth table including any cell you corrected by tracing, all six
fail-when-it-should results, the allowlist-is-load-bearing result, the isolation-self-check result,
the measured runtime, and the two known gaps stated as gaps: the `+27`-for-digit-free defect (with
the two reachable call sites and the one that is not) and the `00`-prefix limitation.
