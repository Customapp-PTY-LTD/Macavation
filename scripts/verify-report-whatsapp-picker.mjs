#!/usr/bin/env node
/**
 * verify-report-whatsapp-picker — regression check for the pure helper functions inside
 * WebPortal/modules/sales-reports/js/report-whatsapp-send.js (the "Send via WhatsApp" dialog's
 * recipient-picker logic).
 *
 * That file's header comment states it has no DOM/global reference at module-evaluation time —
 * only inside function bodies — specifically so it can be loaded into a bare `vm` context here,
 * exactly like scripts/verify-report-rendering.mjs does for report-pdf-builder.js. No browser, no
 * login, no network, no deployed app.
 *
 * Coverage (see report-whatsapp-send.js for the function each of these corresponds to):
 *   1. _normalizeKey: five differently-formatted accepted inputs all normalise to the same
 *      '+27821234567' key; three inputs with no digits at all normalise to a falsy value.
 *   2. _buildCandidateLists: a saved recipient and a CRM contact sharing one phone number
 *      dedupe to the saved entry only, and the CRM duplicate is not double-counted as skipped.
 *   3. _buildCandidateLists: a CRM row with neither primary_contact_mobile nor
 *      primary_contact_phone is excluded and IS counted in skippedCount.
 *   4. _buildCandidateLists: an inbox row with success: 0 is excluded and is NOT counted in
 *      skippedCount (a permission signal, not a missing-number signal).
 *   5. _pruneSelection: a selected key absent from the freshly-loaded lists is dropped; a
 *      selected key still present is retained AND its candidate object reference is refreshed to
 *      the new one (so a newly-assigned recipientId is picked up). Also covers a 'resend' group
 *      candidate (the 4th group added for report-whatsapp-history.js re-sends) surviving the same
 *      way as saved/inbox/crm.
 *   6. _buildSendRecipients: a candidate with a recipientId produces a `recipient_id` field; one
 *      without omits the field entirely; `phone` is always the original (non-normalised) string.
 *   7. _summarizeSend: reads sent/failed off the response (never `success`), and picks
 *      'success' | 'danger' | 'warning' tone correctly, including the case success:true with
 *      failed > 0 and sent === 0 (must never be reported as 'success').
 *   8. _buildResendGroup: a preselected phone that already matches a saved/inbox/crm candidate
 *      produces NO resend candidate (avoids a duplicate row) but its key IS returned in
 *      selectedKeys so it still gets ticked; a preselected phone matching no source produces a
 *      'manual'-sourced resend candidate using the original phone string, falling back to the
 *      phone for displayName when the entry carries none; an unusable phone (no digits) is
 *      excluded and counted in skippedCount; two preselect entries for the same number dedupe to
 *      one candidate.
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
  const mod = ctx.window.ReportWhatsappSend;
  if (!mod || typeof mod._normalizeKey !== 'function') {
    throw new Error('window.ReportWhatsappSend was not defined after loading ' + MODULE_PATH);
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

// ---- test cases ---------------------------------------------------------------------------------

const mod = loadModule();

// 1. _normalizeKey — accept cases all fold to the same key; reject cases (no digits) are falsy.
const ACCEPTED_INPUTS = [
  '0821234567',
  '27821234567',
  '+27 82 123 4567',
  '082-123-4567',
  '821234567',
];
for (const input of ACCEPTED_INPUTS) {
  check(`_normalizeKey(${JSON.stringify(input)}) normalises to +27821234567`, () => {
    assertEqual(mod._normalizeKey(input), '+27821234567', 'normalised key');
  });
}
const REJECTED_INPUTS = ['', null, 'abc'];
for (const input of REJECTED_INPUTS) {
  check(`_normalizeKey(${JSON.stringify(input)}) is falsy (no digits present)`, () => {
    assertFalsy(mod._normalizeKey(input), 'normalizeKey result');
  });
}

// 2. _buildCandidateLists — a saved recipient wins a phone-number collision with a CRM contact;
//    the CRM duplicate is dropped WITHOUT being double-counted as skipped.
check('saved recipient wins a dedup collision against a CRM contact on the same number', () => {
  const saved = [{ id: 'r1', phone: '0821234567', display_name: 'Saved Name' }];
  const crm = [{ id: 'c1', company_name: 'CRM Name', primary_contact_mobile: '0821234567' }];
  const built = mod._buildCandidateLists(saved, [], crm);
  assertEqual(built.saved.length, 1, 'one saved candidate');
  assertEqual(built.crm.length, 0, 'CRM duplicate dropped');
  assertEqual(built.saved[0].displayName, 'Saved Name', 'saved entry wins, not overwritten by CRM');
  assertEqual(built.skippedCount, 0, 'a dedup collision is not a skip');
});

// 3. _buildCandidateLists — a CRM row with no usable phone is excluded AND counted as skipped.
check('CRM row with neither primary_contact_mobile nor primary_contact_phone is skipped', () => {
  const crm = [{ id: 'c2', company_name: 'No Phone Co' }];
  const built = mod._buildCandidateLists([], [], crm);
  assertEqual(built.crm.length, 0, 'no CRM candidate produced');
  assertEqual(built.skippedCount, 1, 'counted as skipped');
});

// 4. _buildCandidateLists — an inbox row with success: 0 is excluded and NOT counted as skipped.
check('inbox row with success: 0 is excluded and not counted as skipped', () => {
  const inbox = [{ success: 0, external_phone: '0821234567', conversation_id: 'conv-1' }];
  const built = mod._buildCandidateLists([], inbox, []);
  assertEqual(built.inbox.length, 0, 'no-access inbox row produces no candidate');
  assertEqual(built.skippedCount, 0, 'a no-access signal is not a skip');
});

// 5. _pruneSelection — drops an absent key, retains a present key with a refreshed object.
check('_pruneSelection drops absent keys and refreshes the object for retained keys', () => {
  const staleSavedCandidate = { key: '+27821234567', displayName: 'Old', recipientId: null };
  const staleInboxCandidate = { key: '+27829999999', displayName: 'Gone' };
  const selected = {
    '+27821234567': staleSavedCandidate,
    '+27829999999': staleInboxCandidate,
  };
  const freshSavedCandidate = { key: '+27821234567', displayName: 'Old', recipientId: 'r99' };
  const lists = {
    saved: [freshSavedCandidate],
    inbox: [],
    crm: [],
  };
  const pruned = mod._pruneSelection(selected, lists);
  assertEqual(Object.keys(pruned), ['+27821234567'], 'only the still-present key survives');
  assertTrue(pruned['+27821234567'] === freshSavedCandidate, 'retained candidate object is refreshed to the new one');
});

check('_pruneSelection retains a resend-group candidate the same way as saved/inbox/crm', () => {
  const staleResendCandidate = { key: '+27825555555', displayName: 'Old Resend', recipientId: null };
  const staleGoneCandidate = { key: '+27829999999', displayName: 'Gone' };
  const selected = {
    '+27825555555': staleResendCandidate,
    '+27829999999': staleGoneCandidate,
  };
  const freshResendCandidate = { key: '+27825555555', displayName: 'Old Resend', recipientId: 'r77' };
  const lists = { saved: [], inbox: [], crm: [], resend: [freshResendCandidate] };
  const pruned = mod._pruneSelection(selected, lists);
  assertEqual(Object.keys(pruned), ['+27825555555'], 'only the resend-group key present in lists.resend survives');
  assertTrue(pruned['+27825555555'] === freshResendCandidate, 'retained resend candidate object is refreshed to the new one');
});

// 6. _buildSendRecipients — recipient_id present only when the candidate has one; phone is the
//    original (non-normalised) string, never the dedup key.
check('_buildSendRecipients includes recipient_id only when present, and uses the original phone', () => {
  const candidates = {
    '+27821234567': { key: '+27821234567', phone: '082 123 4567', displayName: 'Has Id', recipientId: 'r1' },
    '+27829999999': { key: '+27829999999', phone: '082 999 9999', displayName: 'No Id', recipientId: null },
  };
  const rows = mod._buildSendRecipients(candidates);
  assertEqual(rows.length, 2, 'two rows built');
  const withId = rows.find((r) => r.display_name === 'Has Id');
  const withoutId = rows.find((r) => r.display_name === 'No Id');
  assertTrue(withId, 'row for candidate with a recipientId exists');
  assertTrue(withoutId, 'row for candidate without a recipientId exists');
  assertEqual(withId.recipient_id, 'r1', 'recipient_id carried through');
  assertEqual(withId.phone, '082 123 4567', 'original phone string preserved, not the normalised key');
  assertFalsy(Object.prototype.hasOwnProperty.call(withoutId, 'recipient_id'), 'recipient_id must be omitted, not null, when absent');
});

// 7. _summarizeSend — reads sent/failed (never `success`), picks the correct tone in all three
//    outcomes, including the "200 OK but everything failed" edge case.
check('_summarizeSend: sent > 0, failed === 0 -> success tone', () => {
  const summary = mod._summarizeSend({ success: true, sent: 3, failed: 0 });
  assertEqual(summary.tone, 'success', 'tone');
  assertEqual(summary.sent, 3, 'sent');
  assertEqual(summary.failed, 0, 'failed');
});

check('_summarizeSend: success: true but failed > 0 and sent === 0 -> danger tone, never success', () => {
  const summary = mod._summarizeSend({ success: true, sent: 0, failed: 2 });
  assertEqual(summary.tone, 'danger', 'tone must not be success when nothing actually sent');
  assertEqual(summary.sent, 0, 'sent');
  assertEqual(summary.failed, 2, 'failed');
});

check('_summarizeSend: sent > 0 and failed > 0 -> warning tone (partial failure)', () => {
  const summary = mod._summarizeSend({ success: true, sent: 2, failed: 1 });
  assertEqual(summary.tone, 'warning', 'partial failure tone');
});

// 8. _buildResendGroup — turns report-whatsapp-history.js's preselect entries into the 4th
//    ('resend') candidate group: a number already present in saved/inbox/crm produces no
//    duplicate resend candidate (but its key still comes back in selectedKeys so it gets ticked);
//    a number matching no source becomes a 'manual'-sourced resend candidate using the ORIGINAL
//    phone string, falling back to the phone for displayName when the entry carries none; an
//    unusable phone is excluded and counted in skippedCount; two preselect entries for the same
//    number dedupe to one candidate.
check('_buildResendGroup: a preselected number already in saved produces no duplicate, but its key is selected', () => {
  const lists = {
    saved: [{ key: '+27821234567', phone: '0821234567', displayName: 'Already Saved', source: 'saved' }],
    inbox: [],
    crm: [],
  };
  const built = mod._buildResendGroup([{ phone: '0821234567', displayName: 'From History', recipientId: 'r1' }], lists);
  assertEqual(built.resend.length, 0, 'no duplicate resend candidate for a number already covered by another group');
  assertEqual(built.selectedKeys, ['+27821234567'], 'the key is still returned so the existing candidate gets ticked');
  assertEqual(built.skippedCount, 0, 'a dedup collision is not a skip');
});

check('_buildResendGroup: a preselected number in no source becomes a manual resend candidate using the original phone', () => {
  const lists = { saved: [], inbox: [], crm: [] };
  const built = mod._buildResendGroup([{ phone: '082 999 9999', displayName: null, recipientId: 'r2' }], lists);
  assertEqual(built.resend.length, 1, 'one resend candidate built');
  assertEqual(built.resend[0].phone, '082 999 9999', 'original phone string preserved, not the normalised key');
  assertEqual(built.resend[0].source, 'manual', 'source tagged manual');
  assertEqual(built.resend[0].displayName, '082 999 9999', 'displayName falls back to the phone when the entry carries none');
  assertEqual(built.resend[0].recipientId, 'r2', 'recipientId carried through');
  assertEqual(built.selectedKeys, ['+27829999999'], 'key returned for auto-selection');
});

check('_buildResendGroup: an unusable phone (no digits) is excluded and counted in skippedCount', () => {
  const lists = { saved: [], inbox: [], crm: [] };
  const built = mod._buildResendGroup([{ phone: 'abc', displayName: 'No Digits' }], lists);
  assertEqual(built.resend.length, 0, 'no resend candidate for an unusable phone');
  assertEqual(built.selectedKeys, [], 'no key selected for an unusable phone');
  assertEqual(built.skippedCount, 1, 'counted as skipped');
});

check('_buildResendGroup: two preselect entries for the same number dedupe to one candidate', () => {
  const lists = { saved: [], inbox: [], crm: [] };
  const built = mod._buildResendGroup([
    { phone: '0821234567', displayName: 'First', recipientId: 'r1' },
    { phone: '+27 82 123 4567', displayName: 'Second', recipientId: 'r1' },
  ], lists);
  assertEqual(built.resend.length, 1, 'duplicate preselect entries for the same number produce one candidate');
  assertEqual(built.selectedKeys, ['+27821234567'], 'one key selected, not two');
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
