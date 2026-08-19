#!/usr/bin/env node
/**
 * verify-report-whatsapp-picker — regression check for
 * WebPortal/modules/sales-reports/js/report-whatsapp-send.js.
 *
 * That file's own header states it touches nothing but `w` at evaluation time — no DOM, no
 * jQuery, no dataFunctions reference outside a function body — so it can be loaded into a bare
 * `node:vm` context with a `window` object and nothing else. Loading it that way here is not just
 * a convenience: it IS the enforcement of that evaluation-time constraint, exactly as
 * scripts/verify-report-rendering.mjs enforces the same constraint on report-pdf-builder.js.
 *
 * This script is deliberately hermetic, matching every other scripts/verify-*.mjs check wired
 * into `npm run test:fleet` (see package.json's "//test:fleet" comment): every fixture below is a
 * literal object declared in this file. Nothing here reads a database, calls a network endpoint,
 * or reaches outside this repo.
 *
 * Coverage (see the file being tested for the logic each of these corresponds to):
 *   1. normalizePhoneKey mirrors public.chat_normalize_phone exactly: '0821234567',
 *      '27821234567', '+27 82 123 4567' and '821234567' all normalise to '27821234567' (digits
 *      only, no '+'); '', 'abc', null and undefined all normalise to null.
 *   2. mergeRecipientCandidates de-duplicates an inbox row and a CRM row on the same normalised
 *      number into exactly one row, and the inbox row wins.
 *   3. A CRM row with both phone fields empty is excluded from `rows` and counted in `skipped`.
 *   4. A CRM row with a blank mobile but a usable phone is included, using that phone.
 *   5. An inbox row with success === 0 is excluded and is NOT counted as skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const TARGET_PATH = path.join(
  REPO_ROOT,
  'WebPortal',
  'modules',
  'sales-reports',
  'js',
  'report-whatsapp-send.js'
);

function loadModule() {
  const source = fs.readFileSync(TARGET_PATH, 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  new vm.Script(source, { filename: TARGET_PATH }).runInContext(ctx);
  const mod = ctx.window.ReportWhatsappSend;
  if (!mod || typeof mod.normalizePhoneKey !== 'function' || typeof mod.mergeRecipientCandidates !== 'function') {
    throw new Error(
      'window.ReportWhatsappSend.normalizePhoneKey/mergeRecipientCandidates were not defined ' +
        'after loading ' + TARGET_PATH + ' in a bare vm context (no document, no jQuery)'
    );
  }
  return mod;
}

// ---- tiny test harness --------------------------------------------------------------------------

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

// ---- fixtures -------------------------------------------------------------------------------

function makeInboxRow(fields) {
  return Object.assign(
    {
      success: 1,
      error: null,
      conversation_id: 'conv-1',
      conversation_type: 'whatsapp_contact',
      contact_id: null,
      external_phone: '27821234567',
      profile_name: 'A Profile',
      other_party_name: 'Inbox Person',
      last_message_at: null,
      last_message_body: null,
      last_message_direction: null,
      unread_count: 0
    },
    fields
  );
}

function makeCrmRow(fields) {
  return Object.assign(
    {
      id: 'crm-1',
      contact_type: 'customer',
      company_name: 'CRM Company',
      primary_contact_name: 'CRM Contact',
      primary_contact_phone: null,
      primary_contact_mobile: null
    },
    fields
  );
}

// ---- test cases -----------------------------------------------------------------------------

const mod = loadModule();

// 1. normalizePhoneKey mirrors chat_normalize_phone.
check("normalizePhoneKey('0821234567') === '27821234567'", () => {
  assertEqual(mod.normalizePhoneKey('0821234567'), '27821234567');
});
check("normalizePhoneKey('27821234567') === '27821234567'", () => {
  assertEqual(mod.normalizePhoneKey('27821234567'), '27821234567');
});
check("normalizePhoneKey('+27 82 123 4567') === '27821234567'", () => {
  assertEqual(mod.normalizePhoneKey('+27 82 123 4567'), '27821234567');
});
check("normalizePhoneKey('821234567') === '27821234567'", () => {
  assertEqual(mod.normalizePhoneKey('821234567'), '27821234567');
});
check("normalizePhoneKey('') === null", () => {
  assertEqual(mod.normalizePhoneKey(''), null);
});
check("normalizePhoneKey('abc') === null", () => {
  assertEqual(mod.normalizePhoneKey('abc'), null);
});
check('normalizePhoneKey(null) === null', () => {
  assertEqual(mod.normalizePhoneKey(null), null);
});
check('normalizePhoneKey(undefined) === null', () => {
  assertEqual(mod.normalizePhoneKey(undefined), null);
});

// 2. Inbox row and CRM row on the same normalised number merge into exactly one row; inbox wins.
check('inbox row and CRM row on the same number merge into exactly one row, and it is the inbox one', () => {
  const inboxRows = [makeInboxRow({ external_phone: '0821234567', other_party_name: 'Inbox Wins' })];
  const crmRows = [makeCrmRow({ primary_contact_mobile: '+27 82 123 4567', company_name: 'Should Be Dropped' })];
  const result = mod.mergeRecipientCandidates(inboxRows, crmRows);
  assertEqual(result.rows.length, 1, 'exactly one merged row');
  assertEqual(result.rows[0].source, 'inbox', 'the surviving row must be the inbox one');
  assertEqual(result.rows[0].label, 'Inbox Wins', 'label must come from the inbox row');
});

// 3. A CRM row with both phone fields empty is excluded and counted as skipped.
check('a CRM row with no usable phone is excluded from rows and counted in skipped', () => {
  const crmRows = [makeCrmRow({ primary_contact_mobile: '', primary_contact_phone: '' })];
  const result = mod.mergeRecipientCandidates([], crmRows);
  assertEqual(result.rows.length, 0, 'no rows produced');
  assertEqual(result.skipped, 1, 'counted as skipped');
});

// 4. A CRM row with a blank mobile but a usable phone is included, using that phone.
check('a CRM row with a blank mobile but a usable phone is included, using that phone', () => {
  const crmRows = [makeCrmRow({ primary_contact_mobile: '', primary_contact_phone: '0731234567' })];
  const result = mod.mergeRecipientCandidates([], crmRows);
  assertEqual(result.rows.length, 1, 'one row produced');
  assertEqual(result.rows[0].phone, '0731234567', 'phone must be the value the source gave, unnormalised');
  assertEqual(result.skipped, 0, 'not counted as skipped');
});

// 5. An inbox row with success === 0 is excluded and is NOT counted as skipped.
check('an inbox row with success === 0 is excluded and not counted as skipped', () => {
  const inboxRows = [makeInboxRow({ success: 0, error: 'no access' })];
  const result = mod.mergeRecipientCandidates(inboxRows, []);
  assertEqual(result.rows.length, 0, 'no rows produced');
  assertEqual(result.skipped, 0, 'a failed-RPC-row shape is not a "no usable number" skip');
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
