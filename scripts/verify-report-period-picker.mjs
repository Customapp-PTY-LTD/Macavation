#!/usr/bin/env node
/**
 * report-period-picker:verify — proves WebPortal/js/report-period-picker.js still agrees with the
 * database's own period functions, and that no report screen has gone back to a day calendar.
 *
 * Why this check exists: MacPeriodPicker deliberately reimplements three SQL functions in JS so a
 * dropdown can be built without a round trip per option —
 *   report_week_start, report_normalise_period_start, report_period_end
 *   (migrations/20260817090000_report_builder_foundations.sql:80-120)
 * Duplicated logic drifts silently, and a drift here files a target or a report against the wrong
 * week with no error anywhere. The EXPECTED table below is not hand-written: it is the verbatim
 * output of those functions on the dev database (nmdmddugxclpqrwylyfa), captured 2026-09-02 by
 *
 *   SELECT d::text, public.report_week_start(d)::text,
 *          public.report_normalise_period_start('monthly', d)::text,
 *          public.report_period_end('weekly',  public.report_week_start(d))::text,
 *          public.report_period_end('monthly', public.report_normalise_period_start('monthly', d))::text
 *   FROM (VALUES (...)) AS v(d);
 *
 * Hermetic on purpose (per the test:fleet contract in package.json): pure fs + Function, no
 * network, no browser, no database. Re-capture the table with the query above if the SQL ever
 * changes — and if you do, the two must be changed together or this check is meaningless.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PICKER = path.join(ROOT, 'WebPortal', 'js', 'report-period-picker.js');

// input, week_start, month_start, week_end, month_end — straight from the dev database.
const EXPECTED = [
  ['2026-01-15', '2026-01-12', '2026-01-01', '2026-01-18', '2026-01-31'],
  ['2026-02-15', '2026-02-09', '2026-02-01', '2026-02-15', '2026-02-28'],
  ['2026-04-10', '2026-04-06', '2026-04-01', '2026-04-12', '2026-04-30'],
  ['2026-08-17', '2026-08-17', '2026-08-01', '2026-08-23', '2026-08-31'],
  ['2026-08-31', '2026-08-31', '2026-08-01', '2026-09-06', '2026-08-31'],
  ['2026-09-01', '2026-08-31', '2026-09-01', '2026-09-06', '2026-09-30'],
  ['2026-09-06', '2026-08-31', '2026-09-01', '2026-09-06', '2026-09-30'],
  ['2026-09-07', '2026-09-07', '2026-09-01', '2026-09-13', '2026-09-30'],
  ['2026-12-31', '2026-12-28', '2026-12-01', '2027-01-03', '2026-12-31'],
  ['2027-01-06', '2027-01-04', '2027-01-01', '2027-01-10', '2027-01-31'],
  ['2028-02-15', '2028-02-14', '2028-02-01', '2028-02-20', '2028-02-29'],
];

// report_period_label's own output for the same dev database, same capture. The weekly form must
// match character for character: the dropdown and the created report have to read the same.
const EXPECTED_WEEKLY_LABEL = { '2026-08-31': 'Week of 31 Aug 2026', '2026-09-07': 'Week of 7 Sep 2026' };

// Every screen that files against a period. A day-by-day calendar on any of these is the exact
// defect this module removed: the database snaps the day away, so the field asked for precision
// nothing used and confirmed nothing back.
const PERIOD_FIELDS = [
  { html: 'WebPortal/modules/sales-reports/html/report_list.html', select: 'newReportPeriod' },
  { html: 'WebPortal/modules/report-targets/html/report_targets_grid.html', select: 'targetsPeriod' },
  { html: 'WebPortal/modules/report-targets/html/report_targets_grid.html', select: 'addBaselinePeriod' },
  { html: 'WebPortal/modules/sales-data/html/sales_data_grid.html', select: 'salesDataPeriod' },
];

// Retired ids. Any of these coming back means a screen was reverted to a day picker.
const RETIRED_FIELDS = [
  'newReportPeriodDate', 'targetsPeriodDate', 'addBaselinePeriodDate',
  'salesDataPeriodDate', 'copyTargetsFromDate',
];

const failures = [];
let checks = 0;

function check(ok, message) {
  checks++;
  if (!ok) failures.push(message);
}

function loadPicker() {
  const src = fs.readFileSync(PICKER, 'utf8');
  const sandbox = {};
  // The file resolves its own global via `typeof window !== 'undefined' ? window : this`, so hand
  // it a window rather than trying to pass a receiver.
  const fn = new Function('window', src + '\nreturn window.MacPeriodPicker;');
  const api = fn(sandbox);
  if (!api) throw new Error('report-period-picker.js did not export MacPeriodPicker');
  return api;
}

const P = loadPicker();

// 1. Parity with the database's period functions.
for (const [input, weekStart, monthStart, weekEnd, monthEnd] of EXPECTED) {
  check(P.normalise('weekly', input) === weekStart,
    `normalise('weekly','${input}') = ${P.normalise('weekly', input)}, database says ${weekStart}`);
  check(P.normalise('monthly', input) === monthStart,
    `normalise('monthly','${input}') = ${P.normalise('monthly', input)}, database says ${monthStart}`);
  check(P.periodEnd('weekly', input) === weekEnd,
    `periodEnd('weekly','${input}') = ${P.periodEnd('weekly', input)}, database says ${weekEnd}`);
  check(P.periodEnd('monthly', input) === monthEnd,
    `periodEnd('monthly','${input}') = ${P.periodEnd('monthly', input)}, database says ${monthEnd}`);
}

// 2. An unknown period type must return null, mirroring report_normalise_period_start's NULL —
//    a silent fallback to weekly would file 'daily' work against a week.
for (const badType of ['daily', 'annual', '', null, undefined]) {
  check(P.normalise(badType, '2026-08-17') === null,
    `normalise(${JSON.stringify(badType)}, ...) must be null, got ${P.normalise(badType, '2026-08-17')}`);
}
check(P.normalise('monthly', 'not-a-date') === null, 'normalise must reject a non-ISO date');
check(P.normalise('monthly', '17/08/2026') === null, 'normalise must reject dd/mm/yyyy');

// 3. Weekly labels match report_period_label character for character.
for (const [iso, label] of Object.entries(EXPECTED_WEEKLY_LABEL)) {
  check(P.label('weekly', iso) === label,
    `label('weekly','${iso}') = "${P.label('weekly', iso)}", database says "${label}"`);
}

// 4. The FY suffix must NOT be duplicated in JS — report_period_label owns it, and a second copy
//    of report_fy_of_date here would be a second thing to keep true.
check(!/FYE/.test(P.label('monthly', '2026-08-01')),
  `monthly label must not carry the FY suffix, got "${P.label('monthly', '2026-08-01')}"`);
check(P.label('monthly', '2026-08-17') === 'August 2026',
  `monthly label should be the plain month, got "${P.label('monthly', '2026-08-17')}"`);

// 5. periodStarts: newest first, no gaps, nothing past the anchor. "Nothing past the anchor" is
//    what closes the old calendar's any-date-any-year hole.
const weeks = P.periodStarts('weekly', '2026-09-02', 5);
check(weeks.length === 5, `periodStarts should honour count, got ${weeks.length}`);
check(weeks[0] === '2026-08-31', `newest week first, got ${weeks[0]}`);
check(weeks.join(',') === '2026-08-31,2026-08-24,2026-08-17,2026-08-10,2026-08-03',
  `weeks must step back exactly 7 days, got ${weeks.join(',')}`);
const months = P.periodStarts('monthly', '2026-01-15', 3);
check(months.join(',') === '2026-01-01,2025-12-01,2025-11-01',
  `months must step back across a year boundary, got ${months.join(',')}`);
check(P.periodStarts('daily', '2026-09-02', 5).length === 0,
  'periodStarts must be empty for an unknown period type');
for (const list of [weeks, months]) {
  for (const iso of list) {
    check(/^\d{4}-\d{2}-\d{2}$/.test(iso), `every period start must be ISO, got ${iso}`);
  }
}

// 5b. periodsBack / ensureIso. Sales & Production Data walks backwards with prev/next past the
//     default window; the list must EXTEND to reach the period, keeping the newer ones listed, or
//     the screen becomes a one-way trip with no way forward in the dropdown.
check(P.periodsBack('weekly', '2026-08-31', '2026-08-31') === 0, 'periodsBack: the anchor itself is 0');
check(P.periodsBack('weekly', '2026-08-31', '2026-08-26') === 1, 'periodsBack must snap before counting');
check(P.periodsBack('monthly', '2026-09-01', '2025-09-01') === 12, 'periodsBack: twelve months');
check(P.periodsBack('weekly', '2026-08-31', '2026-09-07') === -1, 'a future period is unreachable, not 0');
check(P.periodsBack('daily', '2026-08-31', '2026-08-24') === -1, 'unknown type is unreachable');
check(P.periodsBack('weekly', '2026-08-31', '1990-01-01') === -1,
  'a target beyond the bound must return -1, never loop');

const fakeSelect = () => ({
  childNodes: [], _v: '',
  get firstChild() { return this.childNodes[0] || null; },
  appendChild(n) { this.childNodes.push(n); return n; },
  removeChild(n) { this.childNodes = this.childNodes.filter((c) => c !== n); return n; },
  get options() { return this.childNodes; },
  set value(v) { this._v = this.childNodes.some((o) => o.value === v) ? v : ''; },
  get value() { return this._v; },
});
globalThis.document = {
  createElement: () => ({
    _a: {}, textContent: '', disabled: false,
    setAttribute(k, v) { this._a[k] = String(v); },
    get value() { return this._a.value; },
  }),
};
const far = fakeSelect();
P.fill(far, { periodType: 'weekly', anchorIso: '2026-08-31', ensureIso: '2025-11-24', selectedIso: '2025-11-24' });
const farVals = far.options.map((o) => o.value);
check(farVals[0] === '2026-08-31', 'ensureIso must extend the list, not re-anchor it');
check(farVals.includes('2025-11-24'), 'ensureIso must reach the requested period');
check(far.value === '2025-11-24', 'the requested period must end up selected');
const future = fakeSelect();
P.fill(future, { periodType: 'weekly', anchorIso: '2026-08-31', ensureIso: '2027-01-04' });
check(future.options.length === 26, 'a future ensureIso must leave the default window alone');
check(future.options[0].value === '2026-08-31', 'a future ensureIso must not move the anchor');

// 6. rangeText names the real boundaries, including the straddle cases.
check(P.rangeText('monthly', '2026-08-01') === '1 – 31 August 2026',
  `monthly range, got "${P.rangeText('monthly', '2026-08-01')}"`);
check(P.rangeText('weekly', '2026-08-31') === '31 Aug – 6 Sep 2026',
  `week straddling a month, got "${P.rangeText('weekly', '2026-08-31')}"`);
check(P.rangeText('weekly', '2026-12-28') === '28 Dec 2026 – 3 Jan 2027',
  `week straddling a year, got "${P.rangeText('weekly', '2026-12-28')}"`);

// 7. No local-time conversion anywhere: a browser east or west of SAST must not shift a boundary.
//    getMonth/getDate/getFullYear are permitted in todayAnchor alone — that is the documented
//    fallback for an unreachable get_report_current_period, and is the browser's date by design.
//    Checks 7 and 8 read the file with comments stripped: this module's own prose names the very
//    patterns being banned, and matching that prose would fail the check on its documentation.
const src = fs.readFileSync(PICKER, 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const todayAnchorBody = (code.match(/function todayAnchor\([\s\S]*?\n {4}\}/) || [''])[0];
const outsideFallback = code.replace(todayAnchorBody, '');
for (const banned of ['getMonth()', 'getDate()', 'getFullYear()', 'getDay()', 'setDate(', 'setMonth(']) {
  check(!outsideFallback.includes(banned),
    `${banned} outside todayAnchor is a local-time conversion — use the getUTC*/setUTC* form`);
}
check(todayAnchorBody.length > 0, 'todayAnchor must exist as the documented fallback anchor');
// The UTC forms must actually be the ones in use, or the ban above passes on a file that does no
// date arithmetic at all.
for (const required of ['getUTCDay()', 'setUTCDate(', 'Date.UTC(']) {
  check(code.includes(required), `${required} should be how the arithmetic is done`);
}

// 8. Options are built as text, never as markup.
check(!/innerHTML/.test(code), 'report-period-picker.js must never use innerHTML');
check(/textContent/.test(code), 'option labels must be set with textContent');

// 9. Every period screen offers a period <select>, and no retired day-picker id has returned.
for (const { html, select } of PERIOD_FIELDS) {
  const full = path.join(ROOT, html);
  check(fs.existsSync(full), `${html} is missing`);
  if (!fs.existsSync(full)) continue;
  const markup = fs.readFileSync(full, 'utf8');
  check(new RegExp(`<select[^>]*id="${select}"`).test(markup),
    `${html} must offer <select id="${select}"> — a period, not a date`);
}
const jsAndHtml = [
  'WebPortal/modules/sales-reports/html/report_list.html',
  'WebPortal/modules/sales-reports/js/report_list_grid.js',
  'WebPortal/modules/report-targets/html/report_targets_grid.html',
  'WebPortal/modules/report-targets/js/report_targets_grid.js',
  'WebPortal/modules/sales-data/html/sales_data_grid.html',
  'WebPortal/modules/sales-data/js/sales_data_grid.js',
];
for (const rel of jsAndHtml) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const retired of RETIRED_FIELDS) {
    check(!text.includes(retired),
      `${rel} still references ${retired} — that day picker was replaced by a period select`);
  }
}

// 10. The picker must be loaded before any module that uses it (it is a plain global, and the
//     router injects module JS after boot, so a missing tag here is a ReferenceError on the page).
const indexHtml = fs.readFileSync(path.join(ROOT, 'WebPortal', 'index.html'), 'utf8');
check(/<script src="js\/report-period-picker\.js/.test(indexHtml),
  'index.html must load js/report-period-picker.js');

if (failures.length) {
  console.error(`REPORT PERIOD PICKER FAILED (${failures.length} of ${checks} checks)\n`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`REPORT PERIOD PICKER OK (${checks} checks: JS matches the dev database's period functions, 5 period fields, no local-time arithmetic).`);
