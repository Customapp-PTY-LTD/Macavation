---
depends_on: report-whatsapp-04b-delivery-history.md
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 5b — stop the six phone normalisers drifting apart

## Context

There are now **six** independent implementations of "turn a typed South African number into a
canonical WhatsApp address", in three languages, across three deployment units that cannot import
from one another. Nothing keeps them in step.

The consequence is specific. The unique index on `report_recipients` is built on the SQL version:

```sql
CREATE UNIQUE INDEX ... ON public.report_recipients (public.report_normalize_wa_phone(phone));
```

If a JS copy disagrees with it, `0821234567` and `+27821234567` become two recipients and one person
receives the same confidential report twice — or a de-duplication silently drops a recipient who then
never receives it and whose absence nobody notices.

Two artifacts already name this script by name, before it exists: the `COMMENT ON FUNCTION` for
`report_normalize_wa_phone`, and the header comment on `normalizeKey` at
`WebPortal/modules/sales-reports/js/report-whatsapp-send.js:52-56`. This plan writes it.

## Why this waits on 04b

`depends_on: report-whatsapp-04b-delivery-history.md`. Not an order dependency in the data sense —
a **shared-file** one. 04b is the last plan in this batch to edit `package.json`'s `test:fleet` line
(it adds `report-whatsapp-history:verify`). Two plans racing on the same line produce a real,
human-must-resolve merge conflict, because the fleet runs several plans concurrently from separate
snapshots and never auto-resolves. Waiting also means this script sees whatever 04b actually named
its files rather than guessing.

**Read what merged before writing.** 04b's file names and any new helper it exposes are facts to
check, not to assume from this plan's prose.

## The inventory — verified against this checkout, and corrected

An earlier draft of this plan listed four implementations and named
`supabase/functions/whatsapp-inbound/index.ts` as one of them. **That was wrong on both counts.**
`grep -c "function normalizePhone" supabase/functions/whatsapp-inbound/index.ts` returns **0** — that
function receives an already-normalised number and has no normaliser of its own. Verify this yourself
before writing; do not carry the old list forward.

The real inventory, each confirmed present:

| # | Location | Lang | Empty input | Format |
| - | -------- | ---- | ----------- | ------ |
| 1 | `supabase/functions/send-whatsapp-message/index.ts:65-70` `normalizePhone` | TS | `'+'` | `+27…` |
| 2 | `supabase/functions/send-daily-digest-whatsapp/index.ts:42-47` `normalizePhone` | TS | `'+'` | `+27…` |
| 3 | `supabase/functions/send-report-whatsapp/index.ts:148` `normalizePhone` | TS | `'+'` | `+27…` |
| 4 | `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql` `report_normalize_wa_phone` | PL/pgSQL | `NULL` | `+27…` |
| 5 | `migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92` `chat_normalize_phone` | PL/pgSQL | `NULL` | `27…` **no `+`** |
| 6 | `WebPortal/modules/sales-reports/js/report-whatsapp-send.js:58` `normalizeKey` | JS | `null` | `+27…` |

**A known non-normaliser that shares the giveaway idiom and must be allowlisted:**
`WebPortal/modules/crm-whatsapp/js/crm_whatsapp_contacts_tab.js:34` `formatPhone` — it uses
`replace(/\D/g, '')` but produces a **display** form (`+27 71 463 9643`, with spaces), not a canonical
key. A naive "grep for an unlisted copy" check would flag it as a seventh normaliser. List it
explicitly as a known exception, with that reason, so the check does not cry wolf.

### Two divergences that are deliberate. Assert them; do not "fix" them.

1. **Empty input: `'+'` vs `NULL`.** The TS trio returns `'+'` (`''.replace` yields `''`, no branch
   matches, `+` is prefixed). Implementations 4, 5 and 6 all return null explicitly. The null is
   correct where it matters: it keeps a blank number out of the unique index and lets
   `upsert_report_recipient` reject it with "A valid phone number is required."
   **Assert this difference exists**, so that someone later "unifying" them by making the SQL return
   `'+'` breaks the check loudly instead of quietly weakening a validation. Encode it as a named
   exception with the reason inline — not as a skipped case.
2. **`chat_normalize_phone` returns bare digits with no `'+'`.** That is right for its own callers
   (the shared WhatsApp inbox). Assert that for every non-empty input it equals the group-A result
   **minus the leading `+`** — which proves the *rule* is shared even though the *format* is not.
   03b's `normalizeKey` header (:52-56) already warns against mirroring this one; that warning is
   part of what this script protects.

### One structural note worth testing rather than reasoning about

The TS copies use two sequential `if`s; the SQL and JS copies use `IF / ELSE IF`. These are equivalent
here only because the first branch's output always starts `27` and so would fail the second condition
anyway. **Establish that by testing the truth table, not by asserting it in a comment.**

## Constraint: this script cannot execute the SQL

`package.json`'s own `//test:fleet` comment (:27) states the gate "Must stay FAST and HERMETIC: pure
Node stdlib, no browser, no login, no network, no deployed app," and warns by name against adding
`rbac:verify` or `audit:verify` (both call Supabase with a service-role key) or the Playwright suite.

So the SQL checks are **text assertions on the migration files**, and the shared truth table runs
against a Node re-implementation. Say that plainly in the script header: it proves the files in the
repo, not the functions in any database, and a database can drift from a file — only re-applying the
migration reconciles them. **Do not report a text comparison as a behavioural one.**

## Model to follow

Read both before writing:

- `scripts/verify-report-whatsapp-picker.mjs` — the closest model. It already solves loading a
  `window`-touching module into a bare `vm` context and has a `check(description, fn)` harness at :63.
  Its tests 1-2 at :105-115 already exercise `_normalizeKey`; this script must not duplicate them, it
  must compare that implementation against the other five.
- `scripts/verify-migration-prefixes.mjs` — pure `fs`, `file:line` violations, non-zero exit. Its
  header (:14-31) records that its baseline is **read-only at runtime**: "If this script reports a new
  failure, the correct response is to fix the filename that caused it — never to add another entry to
  the baseline." Adopt that stance: **no `--update` flag, no auto-heal.**

`node --test` is not used anywhere in this repo and no `*.test.mjs` exists under `WebPortal/`. Add no
test framework, no dependency, no devDependency. `node:assert` is sufficient. (`npm ci` fails here —
no `package-lock.json`, zero dependencies; CLAUDE.md records this.)

## Deliverable

`scripts/verify-report-whatsapp-parity.mjs`, plus one line in `package.json` wiring it into
`test:fleet` as `report-whatsapp-parity:verify`.

### What it checks

**1. Every listed implementation is present, and no unlisted one exists.** Hold the six-row inventory
above as an explicit list of `{ file, kind, identifier }`, plus the `formatPhone` allowlist entry. A
**missing** entry fails. So does an **unlisted** one: sweep every `.ts` under `supabase/functions/` and
every `.js` under `WebPortal/` for `replace(/\D/g` combined with a `'27'` literal, and every
`migrations/*.sql` for `regexp_replace` combined with `'27'`; fail on any hit in a file the list does
not name. A seventh copy appearing unannounced is exactly the failure mode this script exists to
catch, and a check that only looks where it is told would miss it.

**2. The three TypeScript copies are behaviourally identical.** They are plain functions with no
imports, so extract each and evaluate it with `new vm.Script(...)` in a bare context, then call it.
Compare behaviour across the truth table rather than comparing source text, so a reformatting passes
but a changed condition fails. If a site turns out not to be extractable that way, fall back to a
structural assertion on the source and **state in the report which sites were tested behaviourally
and which only textually.**

**3. The browser copy matches the TS trio on every non-empty input.** Load
`report-whatsapp-send.js` the way `verify-report-whatsapp-picker.mjs` does and call `_normalizeKey`.

**4. Both SQL bodies still contain their expected rules** (text assertions, labelled as such).
For `report_normalize_wa_phone`, isolate the body between its `$fn$` delimiters and assert all four:
the `regexp_replace(..., '\D', '', 'g')` strip, the `left(v_digits, 1) = '0'` branch substituting
`'27'`, the `left(v_digits, 2) <> '27' AND length(v_digits) <= 11` branch prefixing `'27'`, and the
`'+' ||` return. For `chat_normalize_phone`, assert the equivalent regex-operator forms (`~ '^0'`,
`NOT (... ~ '^27') AND length(...) <= 11`) and that its return has **no** `'+' ||`.

**5. The shared truth table**, run against the Node re-implementation and against implementations
1-3 and 6. Include the raw digit string in each failure message so a break is diagnosable:

| Input | Expected (group A) |
| ----- | ------------------ |
| `0821234567` | `+27821234567` |
| `27821234567` | `+27821234567` |
| `+27821234567` | `+27821234567` |
| `+27 82 123 4567` | `+27821234567` |
| `(082) 123-4567` | `+27821234567` |
| `821234567` | `+27821234567` |
| `0027821234567` | **trace it — see below** |

That last row is not a typo and must not be "corrected" to what a proper international parser would
produce. `0027821234567` strips to `0027821234567`, which starts with `0`, so the first branch
substitutes: `27` + `27821234567`. **Trace it by hand against each implementation before writing the
expectation down, and write down whatever the algorithm actually produces.** If your traced value
differs from what you expected, your trace is right and the expectation was wrong — fix it and say so
in the report. The row exists to pin the current behaviour of a genuinely surprising input and to
document in a comment that a `00`-prefixed international number is **not** handled correctly by any
of the six. That is a real limitation of the existing code, not something this plan changes.

**6. `chat_normalize_phone`'s bare-digit form**, asserted as `groupA.slice(1)` for every non-empty row.

**7. The empty-input divergence**, asserted as a named exception: `''` and `'   '` give `'+'` from
implementations 1-3, and null from 4, 5 and 6. Reason inline.

### What it must NOT do

- No network, no database, no browser, no deployed app — it runs on every fleet merge.
- No dependency, no test framework, no `node --test`.
- No `--update-baseline`, no auto-heal. A failure means fix the code, not the check.
- **It must not modify any of the six implementations.** Unifying them would need a shared module
  across three deployment units that cannot import from one another, and
  `supabase/functions/whatsapp-inbound/index.ts:175-185` already records this class of duplication as
  a deliberate, documented trade-off: "this ~25-line duplication is the deliberate trade-off. The two
  payload shapes must stay in step by hand." This script is what "by hand" becomes.

## Verify before finishing

1. `node scripts/verify-report-whatsapp-parity.mjs` exits 0 against the current tree.
2. **Prove the check can fail** — one that cannot is not a check. For each of these, make the edit,
   observe the failure, then revert it, and confirm a non-zero exit whose message names the file:
   - change `<= 11` to `<= 12` in one TypeScript copy
   - change `'27'` to `'26'` in `report_normalize_wa_phone`'s body
   - delete the `'+' ||` from `report_normalize_wa_phone`'s return
   - remove one listed implementation from the inventory list
   - add a scratch file containing a seventh `replace(/\D/g` + `'27'` copy
   Report all five outcomes. **Leave the tree clean** — `git status --porcelain` must show only the
   two intended changes when you finish.
3. Confirm `formatPhone` in `crm_whatsapp_contacts_tab.js` does **not** trigger the unlisted-copy
   check, and that removing it from the allowlist **does** trigger it. That proves the allowlist is
   load-bearing rather than decorative.
4. `npm run test:fleet` passes with the new script wired in. Report the measured time; this script
   should add well under a second.
5. `grep -n "fetch\|child_process\|spawn\|import(" scripts/verify-report-whatsapp-parity.mjs` —
   confirm nothing outside `node:fs` / `node:path` / `node:vm` / `node:assert` / `node:url`.

## Out of scope

Unifying the implementations. Any migration. Any UI. Fixing the `00`-prefix limitation — document it,
do not change behaviour. A plan that changes how numbers are parsed needs its own review, because it
would change what the unique index considers a duplicate for every row already in the table.

## Report

Under 25 lines: the corrected inventory as you verified it (including the `whatsapp-inbound` check
and the `formatPhone` allowlist), which sites were tested behaviourally vs textually, the final truth
table including any row you corrected by tracing, all five fail-when-it-should results, the
allowlist-is-load-bearing result, the measured runtime, and the `00`-prefix limitation stated as a
known gap.
