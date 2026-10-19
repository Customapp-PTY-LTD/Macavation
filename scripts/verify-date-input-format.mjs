#!/usr/bin/env node
/**
 * date-input:verify — no portal code hands flatpickr a date string without saying what format it is in.
 *
 * Why this exists. flatpickr parses a date STRING with the picker's own dateFormat unless a format is
 * passed. Every portal picker uses 'd/m/Y', so setDate('2026-09-29', false) read day 20, month 6, no year
 * (so the current one) and showed 20/06/2026. The Kernel Production Job Card did exactly that on every
 * reopen, for Received, Start and Completion, and a save then wrote 20/06/2026 over the right dates
 * (fixed in PRs #119/#120, Oct 2026). defaultDate / minDate / maxDate strings are parsed the same way.
 *
 * Rules, applied to every .js and .html under WebPortal/ (vendored and minified files excluded):
 *   1. A flatpickr setDate(...) call either passes a Date (`new Date(...)`) or passes the format as its
 *      third argument: setDate(iso, false, 'Y-m-d') / setDate(ddmmyyyy, false, 'd/m/Y').
 *      Date.prototype.setDate(x.getDate() + n) is recognised and skipped.
 *   2. defaultDate / minDate / maxDate are a `new Date(...)`, 'today', or null.
 *   A line (or the line above it) carrying `date-format-ok: <reason>` is exempt, for a case a human has
 *   checked by hand.
 *
 * It also pins the job card's save-time date guard (modal_kernel_job_card.js): a saved date that changed
 * without the user editing it is restored on autosave and must be confirmed on an explicit save.
 *
 * No dependency, no test framework. node:assert is sufficient.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PORTAL = path.join(ROOT, 'WebPortal');
const REL_JOB_CARD = 'WebPortal/modules/modals/modal-kernel-job-card/js/modal_kernel_job_card.js';

// Normalise line endings — a Windows checkout returns CRLF.
function read(abs) {
  return fs.readFileSync(abs, 'utf8').split('\r\n').join('\n');
}

const failures = [];
let passCount = 0;
function check(name, fn) {
  try {
    fn();
    passCount++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'vendor' || entry.name === 'lib') continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (/\.(js|html)$/.test(entry.name) && !/\.min\.js$/.test(entry.name)) out.push(abs);
  }
  return out;
}

/** Split the argument list that starts just after `open` (the index past '('), respecting nesting and strings. */
function readArgs(src, open) {
  const args = [];
  let depth = 0;
  let cur = '';
  let quote = null;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      cur += ch;
      if (ch === '\\') { cur += src[++i] || ''; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) {
        if (cur.trim()) args.push(cur.trim());
        return args;
      }
      depth--;
    }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  return args;
}

function lineAt(src, idx) {
  return src.slice(0, idx).split('\n').length;
}

function exempt(lines, lineNo) {
  const here = lines[lineNo - 1] || '';
  const above = lines[lineNo - 2] || '';
  return /date-format-ok:/.test(here) || /date-format-ok:/.test(above);
}

/** Returns a list of "line N: reason" problems for one source text. */
export function scanSource(src) {
  const problems = [];
  const lines = src.split('\n');

  const setDateRe = /\.setDate\(/g;
  let m;
  while ((m = setDateRe.exec(src))) {
    const lineNo = lineAt(src, m.index);
    const text = (lines[lineNo - 1] || '').trim();
    if (/^(\/\/|\*)/.test(text) || exempt(lines, lineNo)) continue;
    const args = readArgs(src, m.index + m[0].length);
    if (!args.length) continue;
    if (/\.getDate\(\)/.test(args[0])) continue; // Date.prototype.setDate(n)
    if (/^new Date\(/.test(args[0])) continue;
    if (args.length >= 3) continue;
    problems.push(`line ${lineNo}: setDate(${args.join(', ')}) passes no format — add 'Y-m-d' or 'd/m/Y' as the third argument`);
  }

  const optRe = /\b(defaultDate|minDate|maxDate)\s*[:=]\s*/g;
  while ((m = optRe.exec(src))) {
    const lineNo = lineAt(src, m.index);
    const text = (lines[lineNo - 1] || '').trim();
    if (/^(\/\/|\*)/.test(text) || exempt(lines, lineNo)) continue;
    const rest = src.slice(m.index + m[0].length);
    if (/^(new Date\(|'today'|"today"|null\b)/.test(rest)) continue;
    problems.push(`line ${lineNo}: ${m[1]} is not a Date — flatpickr parses a string with the picker's d/m/Y format`);
  }
  return problems;
}

// ================================================================================================
// 1. The scanner catches the real regression (so the rule cannot be hollowed out unnoticed)
// ================================================================================================

check('scanner flags the original job card bug', () => {
  const buggy = [
    "if (/^\\d{4}-\\d{2}-\\d{2}/.test(str)) el._flatpickr.setDate(str.split('T')[0], false);",
    'if (iso) opts.defaultDate = iso;'
  ].join('\n');
  assert.equal(scanSource(buggy).length, 2, scanSource(buggy).join('; '));
});

check('scanner passes the fixed forms and native Date.setDate', () => {
  const ok = [
    "el._flatpickr.setDate(str.split('T')[0], false, 'Y-m-d');",
    "fp.setDate(v, false, 'd/m/Y');",
    'el._flatpickr.setDate(new Date());',
    'tomorrow.setDate(tomorrow.getDate() + 1);',
    "var o = { defaultDate: 'today', minDate: null };"
  ].join('\n');
  assert.deepEqual(scanSource(ok), []);
});

// ================================================================================================
// 2. The portal itself
// ================================================================================================

const files = walk(PORTAL, []);
check('portal files were found', () => assert.ok(files.length > 50, `only ${files.length} files under WebPortal/`));

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const problems = scanSource(read(abs));
  check(`${rel} sets dates with an explicit format`, () => assert.deepEqual(problems, []));
}

// ================================================================================================
// 3. The job card's save-time date guard stays wired
// ================================================================================================

const jobCard = read(path.join(ROOT, REL_JOB_CARD));
const saveRun = jobCard.slice(jobCard.indexOf('doSaveJobCardRun: (silent, approve) => {'));

check('job card snapshots saved dates from job_card_data', () => {
  assert.match(jobCard, /_jobCardSavedDates = \{\s*jobCardReceivedDate: jobCardToISO\(jc\.received_date\)/);
});

check('job card marks a date as edited only on a user change event', () => {
  assert.match(jobCard, /on\('change\.jobCardDateGuard', '#jobCardReceivedDate, #jobCardPackingStartDate, #jobCardPackingCompletionDate'/);
});

check('save checks for date drift before building the payload', () => {
  const drift = saveRun.indexOf('_jobCardDateDrift()');
  const build = saveRun.indexOf('_buildJobCardPayload()');
  assert.ok(drift > 0 && build > 0 && drift < build, 'the drift check must run before _buildJobCardPayload');
});

check('autosave restores drifted dates; explicit save asks', () => {
  assert.match(saveRun, /if \(silent\) \{[\s\S]*?_restoreSavedJobCardDates\(drift\)[\s\S]*?\} else \{[\s\S]*?_confirmJobCardDateDrift\(drift/);
});

check('clearing the form resets the guard', () => {
  assert.match(jobCard, /_jobCardSavedDates = null;\s*_jobCardTouchedDates = \{\};/);
});

// ================================================================================================

if (failures.length) {
  console.error(`date-input:verify — ${failures.length} failed, ${passCount} passed`);
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}
console.log(`date-input:verify — ${passCount} checks passed`);
