#!/usr/bin/env node
/**
 * report-whatsapp-parity:verify — keeps the SEVEN independent "turn a typed SA number into a
 * canonical WhatsApp address" implementations in step, across three deployment units
 * (Supabase edge functions, Postgres migrations, browser JS) that cannot import from one
 * another. If a JS copy disagrees with the SQL copy the unique index
 * idx_report_recipients_phone_norm is built on
 * (migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:93-94), the same
 * person can end up as two recipients — or a real recipient can be silently dropped as a
 * "duplicate" of someone else.
 *
 * IMPORTANT — this proves the FILES in this repo agree with each other. It does not, and
 * cannot, run any SQL: package.json's own "//test:fleet" comment requires this gate stay pure
 * Node stdlib with no browser, no login, no network, no deployed app, so rows implemented in
 * Postgres (4, 5, 7 below) are checked with TEXT assertions against the migration source, never
 * executed. A database can drift from the file that created it (re-applying the migration is
 * what reconciles them) — this script cannot see that drift, only drift between files.
 *
 * THE SEVEN IMPLEMENTATIONS (re-verified against this checkout — do not trust an older list):
 *   1. supabase/functions/send-whatsapp-message/index.ts:65-70       normalizePhone       TS
 *   2. supabase/functions/send-daily-digest-whatsapp/index.ts:42-47  normalizePhone       TS
 *   3. supabase/functions/send-report-whatsapp/index.ts:148-153      normalizePhone       TS
 *   4. migrations/20260822090000_..._recipients_and_deliveries.sql   report_normalize_wa_phone  SQL
 *   5. migrations/20260813090000_whatsapp_inbound_shared_inbox.sql   chat_normalize_phone       SQL
 *   6. WebPortal/modules/sales-reports/js/report-whatsapp-send.js    normalizeKey (_normalizeKey) JS
 *   7. migrations/20260812100000_crm_whatsapp_module.sql             inline in
 *        chat_start_contact_conversation                                                  SQL
 *
 * supabase/functions/whatsapp-inbound/index.ts is NOT a normaliser (zero `replace(/\D/g` hits) —
 * it receives an already-normalised number. A comment in migration
 * 20260822090000 claims otherwise; that comment is stale and correcting it is out of scope here.
 *
 * All seven apply the SAME three rules — strip non-digits; leading '0' -> '27'; no leading '27'
 * and length <= 11 -> prefix '27' — and differ on exactly two axes:
 *   axis A: '+'-prefixed vs bare-digit output (rows 5 and 7 are bare; the rest are '+'-prefixed)
 *   axis B: whether empty/no-digit input is guarded (rows 4, 5, 6 return NULL/null; rows 1-3 and
 *           7 have NO guard and the second rule fires on the empty string)
 *
 * KNOWN OPEN DEFECT (not fixed here — see the plan this script was added by): rows 1-3 have no
 * empty-input guard, so a blank or digit-free "phone" normalises to the plausible-looking address
 * '+27' and is handed straight to the meta-proxy. Reachable at send-whatsapp-message/index.ts:126
 * (`if (!to || !body)` only blocks '', not whitespace/non-digit strings) and at
 * send-daily-digest-whatsapp/index.ts:98 (an email-only subscriber falls through with no digits at
 * all). NOT reachable at send-report-whatsapp/index.ts:437, because begin_report_delivery computes
 * report_normalize_wa_phone(p_phone) first (…20260822090000…sql:313) and rejects NULL
 * (:329-332), skipping the send entirely (index.ts:412-421). Do not "fix" this by changing any of
 * the seven — that is out of scope for this script and needs its own reviewed plan.
 *
 * KNOWN LIMITATION (also not fixed here): none of the seven implementations handle a leading
 * '00' international prefix correctly. '0027821234567' strips to '0027821234567', which starts
 * with a single '0', so the first rule substitutes '27' for only the FIRST character, producing
 * '27027821234567' — not the '27821234567' a real international parser would produce. This is
 * pinned in the truth table below as current behaviour, not corrected.
 *
 * SWEEP — how "is there an eighth copy nobody told this script about" is checked, and its
 * deliberate blind spot:
 *   - JS/TS candidate: any .ts under supabase/functions/, or any .js under WebPortal/, whose text
 *     contains the substring `replace(/\D/g` AND the two-character sequence `27` anywhere. On
 *     this tree that is exactly 5 files: rows 1, 2, 3, 6, and the allowlisted
 *     crm_whatsapp_contacts_tab.js (see SWEEP_ALLOWLIST below).
 *   - SQL candidate: any migrations/*.sql whose text contains the substring `'\D', '', 'g'` AND
 *     the substring `'27'`. On this tree that is exactly 3 files: rows 4, 5 and 7.
 *   - Blind spot, stated honestly: a normaliser written with a different digit-stripping idiom (a
 *     different character class than \D, a hand-rolled loop) is NOT caught. This sweep catches
 *     copies of the idiom actually used in this repo, not every conceivable normaliser.
 *
 * Models followed: scripts/verify-report-whatsapp-payload.mjs (exact-literal-presence +
 * re-declared-copy pattern for TypeScript, since `.ts` type annotations are not valid JS and
 * cannot be loaded into a vm context); scripts/verify-report-whatsapp-picker.mjs (vm-loading a
 * window-touching browser module, and the check() harness); scripts/verify-migration-prefixes.mjs
 * (pure fs, file:line violations, non-zero exit, NO --update-baseline / auto-heal — a failure here
 * means fix the code, never loosen this script).
 *
 * No dependency, no test framework, no node --test. node:assert is sufficient.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function fail(msg) {
  console.error(`REPORT WHATSAPP PARITY VERIFY FAILED: ${msg}`);
  process.exit(1);
}

function readFile(relPath) {
  const full = path.join(ROOT, relPath);
  try {
    return fs.readFileSync(full, 'utf8');
  } catch (err) {
    fail(`cannot read ${relPath}: ${err.message}`);
    return '';
  }
}

// ============================================================================================
// Named things, defined once, referenced by these exact names everywhere below.
// ============================================================================================

function digitsOf(raw) {
  return String(raw == null ? '' : raw).replace(/\D/g, '');
}

// The Node reference implementation of the UNGUARDED, '+'-prefixed rule — character-for-character
// the algorithm of rows 1-3 (send-whatsapp-message/index.ts:65-70 etc.).
function canonicalPlus(raw) {
  let p = digitsOf(raw);
  if (p.startsWith('0')) p = '27' + p.slice(1);
  if (!p.startsWith('27') && p.length <= 11) p = '27' + p;
  return '+' + p;
}

const GROUP_PLUS_UNGUARDED = 'GROUP_PLUS_UNGUARDED'; // rows 1, 2, 3
const GROUP_PLUS_GUARDED = 'GROUP_PLUS_GUARDED'; // rows 4, 6
const GROUP_BARE_GUARDED = 'GROUP_BARE_GUARDED'; // row 5
const GROUP_BARE_UNGUARDED = 'GROUP_BARE_UNGUARDED'; // row 7

// The single source of every expectation. The `empty` short-circuit MUST run before any
// canonicalPlus() call for the guarded groups: canonicalPlus deliberately reproduces the
// UNGUARDED behaviour ('' -> '+27'), so reusing it unqualified for a guarded group's empty-input
// case would assert '+27'/'27' where the guarded code actually returns NULL/null.
function expectedFor(group, raw) {
  const empty = digitsOf(raw) === '';
  if (group === GROUP_PLUS_UNGUARDED) return canonicalPlus(raw);
  if (group === GROUP_BARE_UNGUARDED) return canonicalPlus(raw).slice(1);
  if (group === GROUP_PLUS_GUARDED) return empty ? null : canonicalPlus(raw);
  if (group === GROUP_BARE_GUARDED) return empty ? null : canonicalPlus(raw).slice(1);
  throw new Error('unknown group: ' + group);
}

const INVENTORY = [
  {
    n: 1,
    file: 'supabase/functions/send-whatsapp-message/index.ts',
    kind: 'ts',
    identifier: 'normalizePhone',
    group: GROUP_PLUS_UNGUARDED,
    lines: '65-70',
  },
  {
    n: 2,
    file: 'supabase/functions/send-daily-digest-whatsapp/index.ts',
    kind: 'ts',
    identifier: 'normalizePhone',
    group: GROUP_PLUS_UNGUARDED,
    lines: '42-47',
  },
  {
    n: 3,
    file: 'supabase/functions/send-report-whatsapp/index.ts',
    kind: 'ts',
    identifier: 'normalizePhone',
    group: GROUP_PLUS_UNGUARDED,
    lines: '148-153',
  },
  {
    n: 4,
    file: 'migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql',
    kind: 'sql',
    identifier: 'report_normalize_wa_phone',
    group: GROUP_PLUS_GUARDED,
    lines: '46-66',
  },
  {
    n: 5,
    file: 'migrations/20260813090000_whatsapp_inbound_shared_inbox.sql',
    kind: 'sql',
    identifier: 'chat_normalize_phone',
    group: GROUP_BARE_GUARDED,
    lines: '72-92',
  },
  {
    n: 6,
    file: 'WebPortal/modules/sales-reports/js/report-whatsapp-send.js',
    kind: 'js',
    identifier: 'normalizeKey',
    group: GROUP_PLUS_GUARDED,
    lines: '66-75',
  },
  {
    n: 7,
    file: 'migrations/20260812100000_crm_whatsapp_module.sql',
    kind: 'sql',
    identifier: 'chat_start_contact_conversation (inline)',
    group: GROUP_BARE_UNGUARDED,
    lines: '198-205',
  },
];

// The one known non-canonical hit the sweep must not flag as an eighth copy: a DISPLAY formatter
// (produces '+27 71 463 9643', with spaces), not a dedup/canonicalisation key.
const SWEEP_ALLOWLIST = [
  {
    file: 'WebPortal/modules/crm-whatsapp/js/crm_whatsapp_contacts_tab.js',
    identifier: 'formatPhone',
    reason:
      "display formatter ('+27 71 463 9643', with spaces) — not a canonical dedup key, uses the " +
      'same replace(/\\D/g idiom and a bare "27" substring but is not one of the seven',
  },
];

// The exact five-line block of rows 1-3, verbatim from send-whatsapp-message/index.ts:65-70.
const TS_NORMALIZER_LITERAL = `function normalizePhone(phone: string): string {
  let p = phone.replace(/\\D/g, '');
  if (p.startsWith('0')) p = '27' + p.slice(1);
  if (!p.startsWith('27') && p.length <= 11) p = '27' + p;
  return \`+\${p}\`;
}`;

// Finds `anchor` in `source`, isolates the body between the first `tag` at/after the anchor and
// the NEXT occurrence of `tag`, then self-checks the slice is plausible before returning it. Never
// falls back to a whole-file search — a mis-anchored slice must fail loudly, not silently pass.
function isolateDollarBody(source, anchor, tag, label) {
  const anchorIdx = source.indexOf(anchor);
  if (anchorIdx === -1) {
    fail(`isolateDollarBody(${label}): anchor text not found: ${JSON.stringify(anchor)}`);
  }
  const openIdx = source.indexOf(tag, anchorIdx);
  if (openIdx === -1) {
    fail(`isolateDollarBody(${label}): opening tag "${tag}" not found after anchor`);
  }
  const bodyStart = openIdx + tag.length;
  const closeIdx = source.indexOf(tag, bodyStart);
  if (closeIdx === -1) {
    fail(`isolateDollarBody(${label}): closing tag "${tag}" not found after opening tag`);
  }
  const body = source.slice(bodyStart, closeIdx);

  // Self-check: non-empty, and does not itself contain the start of another function/statement
  // that would mean we sliced across a boundary instead of isolating the one function.
  const forbidden = ['CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION', 'ALTER TABLE'];
  if (body.trim() === '') {
    fail(`isolateDollarBody(${label}): body isolation failed — empty slice`);
  }
  for (const f of forbidden) {
    if (body.includes(f)) {
      fail(`isolateDollarBody(${label}): body isolation failed — slice still contains "${f}"`);
    }
  }
  return body;
}

// ---- tiny test harness (same shape as verify-report-whatsapp-picker.mjs:72) -------------------
const failures = [];
let passCount = 0;
function check(description, fn) {
  try {
    fn();
    passCount++;
  } catch (err) {
    failures.push(`${description}: ${err && err.message ? err.message : err}`);
  }
}

// ============================================================================================
// 1. Sweep — every listed implementation present; nothing unlisted.
// ============================================================================================

function walk(dir, exts) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walk(full, exts));
    } else if (exts.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

function relFromRoot(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function lineOfSubstring(source, substr) {
  const idx = source.indexOf(substr);
  if (idx === -1) return null;
  return source.slice(0, idx).split('\n').length;
}

check('every INVENTORY row is present at its named file', () => {
  for (const row of INVENTORY) {
    const source = readFile(row.file);
    // For rows with a plain identifier name, require the identifier text to appear.
    // Row 7 has a compound identifier label (inline function), checked separately below.
    if (row.n !== 7) {
      assert.ok(
        source.includes(row.identifier),
        `${row.file}: identifier "${row.identifier}" not found — row ${row.n} may have moved or been renamed`
      );
    } else {
      assert.ok(
        source.includes('chat_start_contact_conversation'),
        `${row.file}: chat_start_contact_conversation not found — row 7 may have moved or been renamed`
      );
    }
  }
});

check('sweep finds exactly the 5 expected JS/TS candidate files', () => {
  const tsFiles = walk(path.join(ROOT, 'supabase/functions'), ['.ts']);
  const jsFiles = walk(path.join(ROOT, 'WebPortal'), ['.js']);
  const candidates = [...tsFiles, ...jsFiles].filter((full) => {
    const src = fs.readFileSync(full, 'utf8');
    return src.includes('replace(/\\D/g') && src.includes('27');
  });
  const relCandidates = candidates.map(relFromRoot).sort();

  const expectedFiles = [
    ...INVENTORY.filter((r) => r.kind === 'ts' || r.kind === 'js').map((r) => r.file),
    ...SWEEP_ALLOWLIST.map((a) => a.file),
  ].sort();

  assert.equal(relCandidates.length, 5, `expected 5 JS/TS candidates, found ${relCandidates.length}: ${relCandidates.join(', ')}`);
  assert.deepEqual(
    relCandidates,
    expectedFiles,
    `JS/TS sweep candidates do not match INVENTORY + SWEEP_ALLOWLIST.\n  found:    ${relCandidates.join(', ')}\n  expected: ${expectedFiles.join(', ')}`
  );
});

check('sweep finds exactly the 3 expected SQL candidate files', () => {
  const migrationsDir = path.join(ROOT, 'migrations');
  const sqlFiles = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => path.join(migrationsDir, f));
  const candidates = sqlFiles.filter((full) => {
    const src = fs.readFileSync(full, 'utf8');
    return src.includes("'\\D', '', 'g'") && src.includes("'27'");
  });
  const relCandidates = candidates.map(relFromRoot).sort();

  const expectedFiles = INVENTORY.filter((r) => r.kind === 'sql').map((r) => r.file).sort();

  assert.equal(relCandidates.length, 3, `expected 3 SQL candidates, found ${relCandidates.length}: ${relCandidates.join(', ')}`);
  assert.deepEqual(
    relCandidates,
    expectedFiles,
    `SQL sweep candidates do not match INVENTORY.\n  found:    ${relCandidates.join(', ')}\n  expected: ${expectedFiles.join(', ')}`
  );
});

check('the allowlisted formatPhone is a candidate hit but is explicitly allowlisted, not a copy', () => {
  const entry = SWEEP_ALLOWLIST[0];
  const source = readFile(entry.file);
  assert.ok(source.includes('replace(/\\D/g'), `${entry.file}: expected to still contain the replace(/\\D/g idiom`);
  assert.ok(source.includes('27'), `${entry.file}: expected to still contain a "27" substring`);
  assert.ok(source.includes(entry.identifier), `${entry.file}: ${entry.identifier} not found`);
});

// ============================================================================================
// 2. The three TypeScript copies are byte-identical to each other and to the Node reference.
// ============================================================================================

const TS_ROWS = INVENTORY.filter((r) => r.kind === 'ts');
for (const row of TS_ROWS) {
  check(`${row.file}: normalizePhone matches the exact expected TS literal`, () => {
    const source = readFile(row.file);
    assert.ok(
      source.includes(TS_NORMALIZER_LITERAL),
      `${row.file}: normalizePhone no longer matches TS_NORMALIZER_LITERAL exactly. ` +
        `Update all three TS copies AND TS_NORMALIZER_LITERAL in this script together.`
    );
  });
}

// ============================================================================================
// 3. The browser copy (row 6) matches on every truth-table input.
// ============================================================================================

function loadRow6Module() {
  const row6 = INVENTORY.find((r) => r.n === 6);
  const modulePath = path.join(ROOT, row6.file);
  const source = fs.readFileSync(modulePath, 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  new vm.Script(source, { filename: modulePath }).runInContext(ctx);
  const mod = ctx.window.ReportWhatsappSend;
  if (!mod || typeof mod._normalizeKey !== 'function') {
    throw new Error('window.ReportWhatsappSend._normalizeKey was not defined after loading ' + modulePath);
  }
  return mod;
}

// ============================================================================================
// 4. All three SQL bodies still contain their expected rules (text assertions).
// ============================================================================================

check('row 4 (report_normalize_wa_phone) body matches the expected rule text', () => {
  const source = readFile('migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql');
  const body = isolateDollarBody(
    source,
    'CREATE OR REPLACE FUNCTION public.report_normalize_wa_phone(',
    '$fn$',
    'row4'
  );
  assert.ok(body.includes("regexp_replace(COALESCE(p_phone, ''), '\\D', '', 'g')"), 'row4: missing digit-strip line');
  assert.ok(body.includes('IF v_digits = \'\''), 'row4: missing empty guard condition');
  assert.ok(body.includes('RETURN NULL;'), 'row4: missing RETURN NULL; on empty guard');
  assert.ok(body.includes("'27' || substr(v_digits, 2)"), 'row4: missing leading-0 substitution');
  assert.ok(
    body.includes("ELSIF left(v_digits, 2) <> '27' AND length(v_digits) <= 11"),
    'row4: missing ELSIF prefix condition'
  );
  assert.ok(body.includes("v_digits := '27' || v_digits;"), 'row4: missing 27-prefix assignment');
  assert.ok(body.includes("RETURN '+' || v_digits;"), 'row4: missing +-prefixed return');
});

check('row 5 (chat_normalize_phone) body matches the expected rule text, bare-digit, guarded, sequential-IF', () => {
  const source = readFile('migrations/20260813090000_whatsapp_inbound_shared_inbox.sql');
  const body = isolateDollarBody(
    source,
    'CREATE OR REPLACE FUNCTION public.chat_normalize_phone(',
    '$$',
    'row5'
  );
  assert.ok(body.includes("regexp_replace(COALESCE(p_phone, ''), '\\D', '', 'g')"), 'row5: missing digit-strip line');
  assert.ok(body.includes("IF v_phone = ''"), 'row5: missing empty guard condition');
  assert.ok(body.includes('RETURN NULL;'), 'row5: missing RETURN NULL; on empty guard');
  assert.ok(body.includes("v_phone ~ '^0'"), 'row5: missing leading-0 regex condition');
  assert.ok(body.includes("'27' || substring(v_phone from 2)"), 'row5: missing leading-0 substitution');
  assert.ok(
    body.includes("NOT (v_phone ~ '^27') AND length(v_phone) <= 11"),
    'row5: missing 27-prefix condition'
  );
  assert.ok(body.includes("v_phone := '27' || v_phone;"), 'row5: missing 27-prefix assignment');
  assert.ok(body.includes('RETURN v_phone;'), 'row5: missing bare-digit return');
  assert.ok(!body.includes("'+' ||"), 'row5: body must NOT contain a +-prefix concatenation (bare-digit form)');
  assert.ok(!body.includes('ELSIF'), 'row5: body must use sequential IF, not ELSIF');
});

check('row 7 (chat_start_contact_conversation inline) body matches the expected rule text, bare-digit, unguarded', () => {
  const source = readFile('migrations/20260812100000_crm_whatsapp_module.sql');
  const body = isolateDollarBody(
    source,
    'CREATE FUNCTION public.chat_start_contact_conversation(',
    '$$',
    'row7'
  );
  assert.ok(body.includes("regexp_replace(v_raw_phone, '\\D', '', 'g')"), 'row7: missing digit-strip line');
  assert.ok(body.includes("v_phone ~ '^0'"), 'row7: missing leading-0 regex condition');
  assert.ok(body.includes("'27' || substring(v_phone from 2)"), 'row7: missing leading-0 substitution');
  assert.ok(
    body.includes("NOT (v_phone ~ '^27') AND length(v_phone) <= 11"),
    'row7: missing 27-prefix condition'
  );
  assert.ok(!body.includes("'+' ||"), 'row7: body must NOT contain a +-prefix concatenation (bare-digit form)');
  assert.ok(!body.includes("IF v_phone = ''"), 'row7: body must NOT contain an empty-input guard (unguarded)');
  assert.ok(body.includes('external_phone'), 'row7: expected sink "external_phone" not found — isolation may be wrong function');
});

// ============================================================================================
// 5. The shared truth table, run against canonicalPlus (rows 1-3) and row 6's _normalizeKey.
// ============================================================================================

const TRUTH_TABLE_INPUTS = [
  '0821234567',
  '27821234567',
  '+27821234567',
  '+27 82 123 4567',
  '(082) 123-4567',
  '821234567',
  '0027821234567',
  '',
  '   ',
  'abc',
];

const row6Mod = loadRow6Module();

for (const input of TRUTH_TABLE_INPUTS) {
  check(`GROUP_PLUS_UNGUARDED (rows 1-3 reference): canonicalPlus(${JSON.stringify(input)})`, () => {
    const expected = expectedFor(GROUP_PLUS_UNGUARDED, input);
    const actual = canonicalPlus(input);
    assert.equal(
      actual,
      expected,
      `input ${JSON.stringify(input)} (digits=${JSON.stringify(digitsOf(input))}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  });

  check(`GROUP_PLUS_GUARDED (row 6, _normalizeKey): normalizeKey(${JSON.stringify(input)})`, () => {
    const expected = expectedFor(GROUP_PLUS_GUARDED, input);
    const actual = row6Mod._normalizeKey(input);
    assert.equal(
      actual,
      expected,
      `input ${JSON.stringify(input)} (digits=${JSON.stringify(digitsOf(input))}): expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  });

  check(`GROUP_BARE_GUARDED (row 5 derivation): expectedFor consistency with row 4's +-prefixed value`, () => {
    const bare = expectedFor(GROUP_BARE_GUARDED, input);
    const plus = expectedFor(GROUP_PLUS_GUARDED, input);
    if (plus === null) {
      assert.equal(bare, null, `input ${JSON.stringify(input)}: guarded empty case must both be null`);
    } else {
      assert.equal(bare, plus.slice(1), `input ${JSON.stringify(input)}: bare form must equal +-form minus the leading '+'`);
    }
  });

  check(`GROUP_BARE_UNGUARDED (row 7 derivation): expectedFor consistency with rows 1-3's +-prefixed value`, () => {
    const bare = expectedFor(GROUP_BARE_UNGUARDED, input);
    const plus = expectedFor(GROUP_PLUS_UNGUARDED, input);
    assert.equal(bare, plus.slice(1), `input ${JSON.stringify(input)}: bare form must equal +-form minus the leading '+'`);
  });
}

// Pin the two genuinely surprising cells explicitly, so a change to either is a loud, deliberate
// diff to this script rather than something noticed only via the loop above.
check("pinned: '0027821234567' -> GROUP_PLUS_UNGUARDED '+27027821234567' (00-prefix limitation, not corrected)", () => {
  assert.equal(canonicalPlus('0027821234567'), '+27027821234567');
});
check("pinned: '' -> GROUP_PLUS_UNGUARDED '+27' (known open defect in rows 1-3, not '+')", () => {
  assert.equal(canonicalPlus(''), '+27');
});
check("pinned: '' -> GROUP_BARE_UNGUARDED '27' (row 7, no guard at all)", () => {
  assert.equal(expectedFor(GROUP_BARE_UNGUARDED, ''), '27');
});
check("pinned: '' -> GROUP_PLUS_GUARDED / GROUP_BARE_GUARDED both null (rows 4, 5, 6 guard correctly)", () => {
  assert.equal(expectedFor(GROUP_PLUS_GUARDED, ''), null);
  assert.equal(expectedFor(GROUP_BARE_GUARDED, ''), null);
});

// ============================================================================================
// Report
// ============================================================================================

if (failures.length) {
  console.error(`\nREPORT WHATSAPP PARITY VIOLATIONS (${failures.length}):\n`);
  for (const f of failures) {
    console.error('  ' + f);
  }
  console.error(`\n${passCount} passed, ${failures.length} failed.`);
  process.exit(1);
}

console.log(
  `REPORT WHATSAPP PARITY OK (${passCount} checks passed across 7 implementations: 3 TS textual, ` +
    '3 SQL textual, 1 JS behavioural, plus the shared canonicalPlus truth table).'
);
