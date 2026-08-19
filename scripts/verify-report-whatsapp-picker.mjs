#!/usr/bin/env node
/**
 * verify-report-whatsapp-picker — regression check for the PURE helpers in
 * WebPortal/modules/sales-reports/js/report-whatsapp-send.js: _normalizeKey,
 * _buildCandidateLists and _summarizeSend.
 *
 * Modelled on scripts/verify-report-rendering.mjs (read first): the module under test has no
 * DOM/jQuery reference at evaluation time — only inside its function bodies, none of which this
 * script calls — so it loads cleanly into a bare `vm` context with `{ window: {}, console }` and
 * is exercised with plain object fixtures. No browser, no login, no network, no deployed app,
 * matching every other scripts/verify-*.mjs wired into `npm run test:fleet`.
 *
 * Coverage (see the plan this file was built from, and the file under test, for detail):
 *   1. _normalizeKey maps every common SA phone spelling to the same canonical '+27...' key,
 *      and returns a falsy value for empty/non-numeric input.
 *   2. _buildCandidateLists: a saved recipient wins a de-duplication collision against a CRM
 *      contact on the same normalised number — exactly one row survives, and it is the saved one.
 *   3. _buildCandidateLists: a CRM row with an empty primary_contact_mobile is excluded from the
 *      CRM list and counted in skippedCount, not silently dropped.
 *   4. _buildCandidateLists: an inbox row with success === 0 is excluded entirely (not counted
 *      as skipped — that is a distinct "no access" signal, not "no usable number").
 *   5. _summarizeSend: a results array of [{status:'sent'},{status:'failed'}] paired with
 *      sent: 1, failed: 1 produces a summary reading "1 sent / 1 failed"; and a response of
 *      { success: true, sent: 0, failed: 2 } is NOT presented with a 'success' tone.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const MODULE_PATH = path.join(
  REPO_ROOT,
  'WebPortal',
  'modules',
  'sales-reports',
  'js',
  'report-whatsapp-send.js'
);

function loadModule() {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  new vm.Script(source, { filename: MODULE_PATH }).runInContext(ctx);
  const mod = ctx.ReportWhatsappSend;
  if (!mod || typeof mod._normalizeKey !== 'function') {
    throw new Error(
      'ReportWhatsappSend._normalizeKey was not defined after loading ' + MODULE_PATH
    );
  }
  return mod;
}

// ---- tiny test harness ---------------------------------------------------------------------

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

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || 'values differ'} — expected ${e}, got ${a}`);
  }
}

function assertTrue(value, msg) {
  if (!value) {
    throw new Error(msg || 'expected a truthy value');
  }
}

function assertFalsy(value, msg) {
  if (value) {
    throw new Error(`${msg || 'expected a falsy value'} — got ${JSON.stringify(value)}`);
  }
}

// ---- test cases -----------------------------------------------------------------------------

const mod = loadModule();

// 1. _normalizeKey
check('_normalizeKey maps every common spelling of 0821234567 to +27821234567', () => {
  const spellings = ['0821234567', '27821234567', '+27 82 123 4567', '(082) 123-4567', '821234567'];
  for (const s of spellings) {
    assertEqual(mod._normalizeKey(s), '+27821234567', `spelling "${s}"`);
  }
});

check('_normalizeKey returns a falsy value for empty/non-numeric input', () => {
  for (const v of ['', '   ', 'abc']) {
    assertFalsy(mod._normalizeKey(v), `input "${v}"`);
  }
});

// 2. De-duplication: saved wins over a CRM contact on the same normalised number.
check('a saved recipient wins a de-dup collision against a CRM contact on the same number', () => {
  const lists = mod._buildCandidateLists({
    saved: [{ id: 'saved-1', display_name: 'Saved Sam', phone: '0821234567' }],
    inbox: [],
    crm: [{ id: 'crm-1', company_name: 'Acme', primary_contact_mobile: '+27821234567' }]
  });
  assertEqual(lists.saved.length, 1, 'exactly one saved row survives');
  assertEqual(lists.saved[0].source, 'saved', 'the surviving row is the saved one');
  assertEqual(lists.crm.length, 0, 'the CRM duplicate must not also render');
});

// 3. A CRM row with an empty mobile is excluded and counted as skipped.
check('a CRM row with an empty primary_contact_mobile is excluded and counted as skipped', () => {
  const lists = mod._buildCandidateLists({
    saved: [],
    inbox: [],
    crm: [
      { id: 'crm-1', company_name: 'No Number Ltd', primary_contact_mobile: '' },
      { id: 'crm-2', company_name: 'Has Number Ltd', primary_contact_mobile: '0821234567' }
    ]
  });
  assertEqual(lists.crm.length, 1, 'only the contact with a usable number renders');
  assertEqual(lists.crm[0].display_name, 'Has Number Ltd', 'the surviving row is the one with a number');
  assertEqual(lists.skippedCount, 1, 'the no-number contact is counted as skipped');
});

// 4. An inbox row with success === 0 is excluded (and not counted as "skipped").
check('an inbox row with success === 0 is excluded and not counted as skipped', () => {
  const lists = mod._buildCandidateLists({
    saved: [],
    inbox: [
      { success: 0, error: 'no access', external_phone: null, conversation_id: 'x' },
      { success: 1, external_phone: '0821234567', other_party_name: 'Real Contact', conversation_id: 'y' }
    ],
    crm: []
  });
  assertEqual(lists.inbox.length, 1, 'only the accessible row renders');
  assertEqual(lists.inbox[0].display_name, 'Real Contact', 'the surviving row is the accessible one');
  assertEqual(lists.skippedCount, 0, 'a success === 0 row is not a "no usable number" skip');
});

// 5. _summarizeSend
check('a results array of [sent, failed] with sent:1, failed:1 reads "1 sent / 1 failed"', () => {
  const summary = mod._summarizeSend({
    success: true,
    sent: 1,
    failed: 1,
    results: [{ status: 'sent' }, { status: 'failed' }]
  });
  assertEqual(summary.text, '1 sent / 1 failed', 'summary text');
});

check('{ success: true, sent: 0, failed: 2 } is NOT presented as a success', () => {
  const summary = mod._summarizeSend({ success: true, sent: 0, failed: 2 });
  assertTrue(summary.tone !== 'success', `tone must not be 'success', got "${summary.tone}"`);
});

// ---- report -------------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nREPORT WHATSAPP PICKER VIOLATIONS (${failures.length}):\n`);
  for (const f of failures) {
    console.error('  ' + f);
  }
  console.error(`\n${passCount} passed, ${failures.length} failed.`);
  process.exit(1);
}

console.log(`REPORT WHATSAPP PICKER OK (${passCount} checks passed against report-whatsapp-send.js).`);
