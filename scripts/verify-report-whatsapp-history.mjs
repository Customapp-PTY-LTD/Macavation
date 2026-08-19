#!/usr/bin/env node
/**
 * verify-report-whatsapp-history — regression check for the pure helper functions inside
 * WebPortal/modules/sales-reports/js/report-whatsapp-history.js (the "who got this report"
 * delivery-history panel and its re-send preselect builder).
 *
 * Modelled directly on scripts/verify-report-whatsapp-picker.mjs, which already solves loading a
 * window-touching module into a bare `vm` context with zero DOM/global evaluation-time reference.
 * No browser, no login, no network, no deployed app.
 *
 * Coverage (see report-whatsapp-history.js for the function each of these corresponds to):
 *   1. _buildHistoryRow: a 'failed' row surfaces delivery_error verbatim; a row with `error` set
 *      but `delivery_error` null surfaces NO failure text — list_report_deliveries returns both
 *      columns and conflating them is the exact hazard this check exists to catch.
 *   2. _buildHistoryRow: a 'pending' row is classified as incomplete (not sent), carries the
 *      may-already-have-arrived wording, and is neither a failure nor a success.
 *   3. _buildHistoryRow: display_name: null falls back to the phone; sent_by_name: null renders
 *      as absent (the caller substitutes the em-dash placeholder), never the string "null".
 *   4. _buildHistoryRow: completed_at: null falls back to created_at.
 *   5. _buildResendPreselect: turns 'failed' and 'pending' rows into
 *      { phone, displayName, recipientId } using the ORIGINAL phone string, excludes every 'sent'
 *      row, excludes a row with an empty/null phone, and maps a null recipient_id to null.
 *   6. The module loads in a bare vm context with only { window: {}, console } — i.e. it has no
 *      evaluation-time DOM/global reference.
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
  'report-whatsapp-history.js'
);

function loadModule() {
  const source = fs.readFileSync(MODULE_PATH, 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  new vm.Script(source, { filename: MODULE_PATH }).runInContext(ctx);
  const mod = ctx.window.ReportWhatsappHistory;
  if (!mod || typeof mod._buildHistoryRow !== 'function' || typeof mod._buildResendPreselect !== 'function') {
    throw new Error('window.ReportWhatsappHistory was not defined after loading ' + MODULE_PATH);
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

// 1. _buildHistoryRow — delivery_error surfaces verbatim on a failed row; `error` alone (the
//    RPC-level fault column, always null for a row actually returned) never substitutes for it.
check('_buildHistoryRow: failed row surfaces delivery_error verbatim', () => {
  const row = mod._buildHistoryRow({
    id: 'd1', status: 'failed', phone: '+27821234567', display_name: 'Pete',
    delivery_error: 'Outside the 24-hour customer-service window.', error: null,
  });
  assertTrue(row.isFailed, 'row classified as failed');
  assertEqual(row.failureText, 'Outside the 24-hour customer-service window.', 'delivery_error surfaced verbatim');
});

check('_buildHistoryRow: `error` set but delivery_error null surfaces NO failure text', () => {
  const row = mod._buildHistoryRow({
    id: 'd2', status: 'failed', phone: '+27821234567', display_name: 'Pete',
    delivery_error: null, error: 'some RPC-level fault text',
  });
  assertTrue(row.isFailed, 'row still classified as failed');
  assertFalsy(row.failureText, 'failureText must be falsy — `error` must never substitute for delivery_error');
});

// 2. _buildHistoryRow — a pending row is an incomplete send, not a success, and carries the
//    may-already-have-arrived wording.
check('_buildHistoryRow: pending row is incomplete, not sent, carries may-already-arrived wording', () => {
  const row = mod._buildHistoryRow({
    id: 'd3', status: 'pending', phone: '+27821234567', display_name: 'Pete',
  });
  assertTrue(row.isPending, 'row classified as pending');
  assertFalsy(row.isSent, 'a pending row is never classified as sent');
  assertFalsy(row.isFailed, 'a pending row is never classified as failed');
  assertTrue(typeof row.pendingNote === 'string' && row.pendingNote.length > 0, 'pendingNote present');
  assertTrue(/may deliver a second copy/i.test(row.pendingNote), 'wording warns a re-send may duplicate an already-arrived message');
});

// 3. _buildHistoryRow — display_name falls back to phone; sent_by_name null renders as absent
//    (never the literal string "null" — the caller substitutes the em-dash placeholder).
check('_buildHistoryRow: display_name: null falls back to phone', () => {
  const row = mod._buildHistoryRow({
    id: 'd4', status: 'sent', phone: '+27821234567', display_name: null,
  });
  assertEqual(row.displayName, '+27821234567', 'displayName falls back to phone');
});

check('_buildHistoryRow: sent_by_name: null is absent, never the string "null"', () => {
  const row = mod._buildHistoryRow({
    id: 'd5', status: 'sent', phone: '+27821234567', display_name: 'Pete', sent_by_name: null,
  });
  assertEqual(row.sentByName, null, 'sentByName is null, not the string "null"');
  assertTrue(String(row.sentByName) !== 'null' || row.sentByName === null, 'never rendered as the literal word null');
});

// 4. _buildHistoryRow — completed_at falls back to created_at.
check('_buildHistoryRow: completed_at: null falls back to created_at', () => {
  const row = mod._buildHistoryRow({
    id: 'd6', status: 'sent', phone: '+27821234567', display_name: 'Pete',
    completed_at: null, created_at: '2026-08-22T09:00:00Z',
  });
  assertEqual(row.when, '2026-08-22T09:00:00Z', 'when falls back to created_at');
});

check('_buildHistoryRow: completed_at present is preferred over created_at', () => {
  const row = mod._buildHistoryRow({
    id: 'd7', status: 'sent', phone: '+27821234567', display_name: 'Pete',
    completed_at: '2026-08-22T10:00:00Z', created_at: '2026-08-22T09:00:00Z',
  });
  assertEqual(row.when, '2026-08-22T10:00:00Z', 'when prefers completed_at');
});

// 5. _buildResendPreselect — operates on the RAW list_report_deliveries rows (the same snake_case
//    shape listReportDeliveries returns, post Array.isArray normalisation), NOT on
//    _buildHistoryRow's camelCase render shape — a historyRow's displayName has already been
//    resolved with a phone-number fallback for display, which would stop a genuinely-null
//    display_name from ever reaching the send module. Failed/pending rows become preselect
//    entries using the ORIGINAL phone string; sent rows and empty-phone rows are excluded;
//    recipient_id maps through (null stays null).
check('_buildResendPreselect: excludes sent rows, includes failed/pending, uses original phone', () => {
  const rows = [
    { id: 'd1', status: 'sent', phone: '082 123 4567', display_name: 'A', recipient_id: 'r1' },
    { id: 'd2', status: 'failed', phone: '082 999 9999', display_name: 'B', recipient_id: 'r2', delivery_error: 'boom' },
    { id: 'd3', status: 'pending', phone: '082 555 5555', display_name: null, recipient_id: null },
  ];
  const preselect = mod._buildResendPreselect(rows);
  assertEqual(preselect.length, 2, 'sent row excluded, failed + pending included');
  const byPhone = {};
  preselect.forEach((p) => { byPhone[p.phone] = p; });
  assertTrue(byPhone['082 999 9999'], 'failed row present under its ORIGINAL phone string');
  assertEqual(byPhone['082 999 9999'].recipientId, 'r2', 'recipientId carried through');
  assertTrue(byPhone['082 555 5555'], 'pending row present under its ORIGINAL phone string');
  assertEqual(byPhone['082 555 5555'].recipientId, null, 'null recipient_id maps to null, not undefined');
  assertEqual(byPhone['082 555 5555'].displayName, null, 'a genuinely-null display_name passes through unchanged, unresolved');
  assertFalsy(byPhone['082 123 4567'], 'sent row must never appear in the preselect list');
});

check('_buildResendPreselect: a row with an empty/null phone is excluded', () => {
  const rows = [
    { id: 'd1', status: 'failed', phone: '', display_name: 'No phone' },
    { id: 'd2', status: 'failed', phone: null, display_name: 'Also no phone' },
  ];
  const preselect = mod._buildResendPreselect(rows);
  assertEqual(preselect.length, 0, 'both empty/null-phone rows excluded');
});

// 6. The module loads in a bare vm context with only { window: {}, console } — already exercised
//    by loadModule() above; a throw there would have failed every check. Assert it explicitly too.
check('module loads into a bare vm context with no evaluation-time DOM/global reference', () => {
  assertTrue(typeof mod.init === 'function', 'init exposed');
  assertTrue(typeof mod.destroy === 'function', 'destroy exposed');
  assertTrue(typeof mod.setResendHandler === 'function', 'setResendHandler exposed');
  assertTrue(typeof mod.load === 'function', 'load exposed');
});

// ---- report -------------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nREPORT WHATSAPP HISTORY VIOLATIONS (${failures.length}):\n`);
  for (const f of failures) {
    console.error('  ' + f);
  }
  console.error(`\n${passCount} passed, ${failures.length} failed.`);
  process.exit(1);
}

console.log(`REPORT WHATSAPP HISTORY OK (${passCount} checks passed against report-whatsapp-history.js).`);
