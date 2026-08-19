---
depends_on: report-whatsapp-02-edge-function.md, report-whatsapp-04-delivery-history.md
notify: henry@customapp.co.za
---

# Report WhatsApp distribution, part 5 — stop the four phone normalisers drifting apart

## Context

There are now **four** independent implementations of the same rule for turning a typed South
African number into a canonical WhatsApp address, in three languages, in three deployment units:

| # | Where | Language | Deployed as |
| - | ----- | -------- | ----------- |
| 1 | `supabase/functions/send-whatsapp-message/index.ts:64-69` (`normalizePhone`) | TypeScript | edge function |
| 2 | `supabase/functions/send-daily-digest-whatsapp/index.ts` (`normalizePhone`) | TypeScript | edge function |
| 3 | `supabase/functions/whatsapp-inbound/index.ts` | TypeScript | edge function |
| 4 | `public.report_normalize_wa_phone` in `migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql` | PL/pgSQL | database |

Part 2 adds a fifth inside `send-report-whatsapp`, and part 3 adds a sixth in the browser (used only
as a de-duplication comparison key).

Nothing keeps them in step, and the consequences are specific and bad. The **unique index** on
`report_recipients` is built on the SQL version:
`CREATE UNIQUE INDEX ... ON public.report_recipients (public.report_normalize_wa_phone(phone))`. If a
JS copy ever disagrees with it, `0821234567` and `+27821234567` become two recipients, and one person
receives the same confidential report twice — or, worse, a de-duplication that silently drops a
recipient who then never receives it and whose absence nobody notices.

Both the SQL function's own `COMMENT` and part 1's plan already name this script as the thing that
holds them together. This plan writes it.

## Why this waits on parts 2 and 4

`depends_on: report-whatsapp-02-edge-function.md, report-whatsapp-04-delivery-history.md`.

- Part 2 creates `supabase/functions/send-report-whatsapp/index.ts`, which this script reads. Without
  it, the check fails on a missing file.
- Part 4 is the last plan in the batch to edit `package.json`'s `test:fleet` line. Parts 2, 3 and 4
  each add a `scripts/verify-*.mjs` to it, so a fourth plan racing them on the same line would
  conflict. Waiting also means this script can see whatever those three actually named their files
  rather than guessing.

Because it waits on the whole batch, **this plan must read what actually merged before it writes
anything.** Part 2's and part 3's file names, helper names and regex literals are what this script
asserts against, and this plan states them as expectations, not as facts.

## Grounding — verified against this checkout

**The algorithm, copied from `supabase/functions/send-whatsapp-message/index.ts:64-69`:**

```ts
function normalizePhone(phone: string): string {
  let p = phone.replace(/\D/g, '');
  if (p.startsWith('0')) p = '27' + p.slice(1);
  if (!p.startsWith('27') && p.length <= 11) p = '27' + p;
  return `+${p}`;
}
```

**One difference from the SQL is real and is not a bug** — do not "fix" it. The JS version returns
`'+'` for an empty input (`''.replace` → `''`, no branch matches, `+` prefixed). The SQL version
returns `NULL` for an empty input, explicitly:

```sql
IF v_digits = '' THEN
    RETURN NULL;
END IF;
```

That divergence is deliberate: `NULL` keeps a blank number out of the unique index and lets
`upsert_report_recipient` reject it with "A valid phone number is required." The harness must
**assert this difference exists**, so that someone later "unifying" the two by making SQL return
`'+'` breaks the check loudly instead of quietly weakening a validation. Encode it as a known,
named exception with that reason written next to it — not as a skipped case.

**A second real difference**: the JS uses two sequential `if`s, so `0` + a long number that starts
`0` gets `27` substituted and then, being longer than 11, is not re-prefixed. The SQL uses
`IF / ELSIF`, which is equivalent here *because* the first branch's output always starts `27` and so
would fail the second condition anyway. Confirm that equivalence by testing, not by reasoning about
it in a comment — the test table below is what actually establishes it.

**The established pattern for a check like this** is a `scripts/verify-*.mjs` wired into
`npm run test:fleet`. `package.json:26` states the constraint explicitly: `test:fleet`
"Must stay FAST and HERMETIC: pure Node stdlib, no browser, no login, no network, no deployed app."
It warns by name against adding `rbac:verify` or `audit:verify` (both call Supabase with a
service-role key) or the Playwright suite. **This script therefore cannot execute the SQL.** It
compares source text, and re-implements the algorithm in Node to test the shared cases. Say that
plainly in the script's header rather than implying it proves the database's behaviour.

Model the script on the two existing hermetic checks, and read both before writing:

- `scripts/verify-report-rendering.mjs` — loads a module into a bare `vm` context
  (`{ window: {}, console }`, :47-50) and asserts against literal fixtures. Its header (:1-28)
  documents exactly what it covers and why it is hermetic; match that voice.
- `scripts/verify-migration-prefixes.mjs` — pure `fs`, reports `file:line` violations, exits
  non-zero, and its header (:14-31) records that its baseline file is **read-only at runtime**: "If
  this script reports a new failure, the correct response is to fix the filename that caused it —
  never to add another entry to the baseline." Adopt the same stance here: there is no
  `--update` flag, and no auto-heal.

**`node --test` is not used anywhere in this repo** and no `*.test.mjs` file exists under
`WebPortal/`. Add no test framework, no dependency, no devDependency. Node's built-in `assert` is
sufficient. (`npm ci` fails in this repo — there is no `package-lock.json` and zero dependencies;
CLAUDE.md records this.)

## Deliverable

One new file, `scripts/verify-report-whatsapp-parity.mjs`, plus one line in `package.json` adding it
to `test:fleet`.

### What it checks

**1. Every known implementation is present and accounted for.** Maintain an explicit list of
`{ file, kind, identifier }` for the six sites named in the Context table above plus the two added
by parts 2 and 3. For each, read the file and locate the implementation. A **missing** site fails.
So does an **unlisted** one: grep every `.ts` under `supabase/functions/` and every `.js` under
`WebPortal/` for the giveaway pattern (a `replace(/\D/g` combined with a `'27'` literal, and the SQL
equivalent `regexp_replace` with `'\D'`) and fail if a match sits in a file the list does not name.
A seventh copy appearing unannounced is precisely the failure mode this script exists to catch, and a
check that only looks where it is told would miss it.

**2. The three existing TypeScript copies are byte-identical in behaviour.** Extract each
`normalizePhone` body, normalise whitespace, and assert all three match one another exactly. They are
plain functions with no imports, so they can be evaluated with `new vm.Script(...)` in a bare context
and called — do that rather than comparing strings alone, so a reformatting does not fail the check
but a changed condition does. If a site turns out not to be extractable that way (part 2's may be an
inner helper or differently shaped — read what merged), fall back to a structural assertion on the
source text and **say in the report which sites were behaviourally tested and which only textually**.
Do not report a textual comparison as a behavioural one.

**3. The SQL body still contains the four expected rules.** Read
`migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql`, isolate the
`report_normalize_wa_phone` body between its `$fn$` delimiters, and assert the presence of all four:
the `regexp_replace(..., '\D', '', 'g')` strip, the `left(v_digits, 1) = '0'` branch substituting
`'27'`, the `left(v_digits, 2) <> '27' AND length(v_digits) <= 11` branch prefixing `'27'`, and the
`'+' ||` return. This is a text assertion and must be described as one: it proves the file in the
repo, not the function in any database. Note in the header that a database can drift from the file
and that only re-applying the migration reconciles them.

**4. A shared truth table, run against the Node re-implementation, that every site must satisfy.**
Assert the expected output for each, and include the raw digits so a failure message is diagnosable:

| Input | Expected |
| ----- | -------- |
| `0821234567` | `+27821234567` |
| `27821234567` | `+27821234567` |
| `+27821234567` | `+27821234567` |
| `+27 82 123 4567` | `+27821234567` |
| `(082) 123-4567` | `+27821234567` |
| `821234567` | `+27821234567` |
| `0027821234567` | `+27027821234567` |

That last row is not a typo and must not be "corrected". `0027821234567` strips to
`0027821234567`, starts with `0`, so becomes `2727821234567`… **trace it by hand against the real
algorithm before writing the expectation down, and write down whatever the algorithm actually
produces, not what a correct international parser would produce.** If your traced value differs from
the row above, the row above is wrong and yours is right — fix the table and say so in the report.
The point of including it is to pin the current behaviour of a genuinely surprising input, and to
document in a comment that a `00`-prefixed international number is **not** handled correctly by any
of the four implementations. That is a real limitation of the existing code, not something this plan
changes.

**5. The documented SQL-vs-JS divergence, asserted as an exception.** Empty string and
whitespace-only input: JS yields `'+'`, SQL yields `NULL`. Assert both, with the reason inline.

### What it must NOT do

- **No network, no database, no browser, no deployed app** — it runs in the fleet's own test gate on
  every merge.
- **No dependency, no test framework, no `node --test`.**
- **No `--update-baseline` and no auto-heal.** A failure means fix the code, not the check.
- **It must not modify any of the implementations.** This plan adds a check; it does not unify the
  copies. Unifying them would mean a shared module across three deployment units that cannot import
  from one another (two edge functions, a database and a browser bundle), and
  `supabase/functions/whatsapp-inbound/index.ts:175-185` already records this class of duplication as
  a deliberate, documented trade-off: "this ~25-line duplication is the deliberate trade-off. The two
  payload shapes must stay in step by hand." This script is what "by hand" becomes.

## Verify before finishing

1. `node scripts/verify-report-whatsapp-parity.mjs` exits 0 against the current tree.
2. **Prove the check actually fails when it should** — a check that cannot fail is not a check. For
   each of these, make the edit in a scratch copy (or make it, observe the failure, and revert it),
   and confirm a non-zero exit with a message that names the file:
   - change `<= 11` to `<= 12` in one of the TypeScript copies
   - change `'27'` to `'26'` in the SQL body
   - delete one of the listed implementations
   - add a new file containing a seventh `replace(/\D/g` + `'27'` copy
   Report all four outcomes. **Leave the tree clean** — `git status --porcelain` must show only the
   two intended changes when you finish.
3. `npm run test:fleet` passes with the new script wired in, and the script adds well under a second.
   Report the measured time.
4. Confirm the script contains no `fetch`, no `child_process`, no `require` of anything outside
   `node:fs` / `node:path` / `node:vm` / `node:assert` / `node:url`:
   `grep -n "fetch\|child_process\|spawn\|import(" scripts/verify-report-whatsapp-parity.mjs`.

## Out of scope

Unifying the implementations. Any migration. Any UI. Fixing the `00`-prefix limitation — document it,
do not change behaviour; a plan that changes how numbers are parsed needs its own review, because it
would change what the unique index considers a duplicate for every row already in the table.

## Report

Under 25 lines: the sites the script covers and which were tested behaviourally vs textually, the
final truth table (including any row you corrected by tracing), all four fail-when-it-should results,
the measured runtime, and the `00`-prefix limitation stated as a known gap.
