#!/usr/bin/env node
/**
 * reports-tabs:verify - static checks on the Reports tabs migrations and data-functions wrappers.
 *
 * Hermetic: pure fs reads, no database, no network. It pins the conventions the three migrations
 * rely on (SECURITY DEFINER + fixed search_path + anon grant on every function, SAST dates only,
 * race-safe draft creation, the 400-day guard) and that the three portal wrappers exist.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');

const failures = [];
let passCount = 0;
function check(name, ok, detail) {
  if (ok) passCount++;
  else failures.push(`${name}${detail ? ': ' + detail : ''}`);
}

const FILES = {
  drafts: 'migrations/20261106180000_reports_auto_drafts.sql',
  order: 'migrations/20261106180100_reports_section_order.sql',
  figures: 'migrations/20261106180200_reports_all_figures.sql',
  v2: 'migrations/20261107090000_reports_v2_snapshot.sql',
};
const sql = {};
for (const [k, rel] of Object.entries(FILES)) {
  try {
    sql[k] = read(rel);
  } catch (e) {
    failures.push(`${rel}: cannot read (${e.message})`);
  }
}

// Strip -- comments so prose in headers cannot satisfy or trip a check.
const code = (s) => s.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

for (const k of ['drafts', 'figures', 'v2']) {
  if (!sql[k]) continue;
  const body = code(sql[k]);
  const rel = FILES[k];
  const fns = [...body.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?\bAS\s+\$/g)];
  check(`${rel}: defines functions`, fns.length > 0);
  for (const m of fns) {
    const name = m[1];
    const header = m[0];
    check(`${rel}: ${name} is SECURITY DEFINER`, /SECURITY DEFINER/.test(header));
    check(`${rel}: ${name} sets search_path = public`, /SET search_path = public/.test(header));
    const sig = m[2].split(',').map((p) => p.trim()).filter(Boolean)
      .map((p) => p.replace(/\s+DEFAULT\s+.*$/i, '').split(/\s+/).slice(1).join(' ')).join(', ');
    const grant = new RegExp(String.raw`GRANT EXECUTE ON FUNCTION public\.${name}\(${sig}\)\s+TO[^;]*\banon\b`);
    check(`${rel}: ${name} is granted to anon`, grant.test(body), `expected GRANT EXECUTE ON FUNCTION public.${name}(${sig}) TO anon, ...`);
  }
  check(`${rel}: uses report_sast_today()`, /report_sast_today\(\)/.test(body));
  check(`${rel}: never uses the bare UTC date function`, !/CURRENT_DATE/i.test(body));
}

if (sql.drafts) {
  const body = code(sql.drafts);
  check('drafts: EXCEPTION WHEN unique_violation in ensure_report_drafts', /EXCEPTION WHEN unique_violation/.test(body));
  check('drafts: pg_advisory_xact_lock present', /pg_advisory_xact_lock\(hashtext\('ensure_report_drafts'\)\)/.test(body));
  check('drafts: cron job ensure-report-drafts at 0 4 * * *', /cron\.schedule\('ensure-report-drafts', '0 4 \* \* \*'/.test(body));
  check('drafts: cron is unscheduled first (idempotent)', /cron\.unschedule/.test(body));
  check('drafts: cron guarded on pg_extension', /pg_extension WHERE extname = 'pg_cron'/.test(body));
  check('drafts: limit clamped to 1..60', /GREATEST\(1, LEAST\(COALESCE\(p_limit, 26\), 60\)\)/.test(body));
}

if (sql.order) {
  const body = code(sql.order);
  check('order: updates template sections', /UPDATE public\.report_template_sections/.test(body));
  check('order: updates only DRAFT instance sections', /UPDATE public\.report_instance_sections[\s\S]*ri\.status = 'draft'/.test(body));
}

if (sql.figures) {
  const body = code(sql.figures);
  check('figures: 400-day guard present', /p_to - p_from > 400/.test(body));
  check('figures: reports_live_from setting seeded idempotently', /'reports_live_from'[\s\S]*ON CONFLICT \(key\) DO NOTHING/.test(body));
  check('figures: headline totals use resolve_report_metric_value', (body.match(/resolve_report_metric_value\(/g) || []).length >= 8);
  check('figures: oil sales skip register-linked local lines', /export_register_id IS NULL/.test(body));
}

if (sql.v2) {
  const body = code(sql.v2);
  check('v2: ADD COLUMN IF NOT EXISTS report_snapshot', /ADD COLUMN IF NOT EXISTS report_snapshot jsonb/.test(body));
  check('v2: ADD COLUMN IF NOT EXISTS snapshot_sha256', /ADD COLUMN IF NOT EXISTS snapshot_sha256 text/.test(body));
  const pub = body.match(/CREATE OR REPLACE FUNCTION public\.publish_report_instance\([\s\S]*?\n\$\$;/);
  check('v2: redefines publish_report_instance', !!pub);
  if (pub) {
    check('v2: publish writes report_snapshot', /report_snapshot\s*=\s*v_snap/.test(pub[0]));
    check('v2: publish writes snapshot_sha256', /snapshot_sha256\s*=\s*encode\(sha256\(/.test(pub[0]));
    check('v2: publish has the figures refusal branch', /Figures could not be read: /.test(pub[0]) && /RETURN QUERY SELECT 0, 'Figures could not be read/.test(pub[0]));
  }
  for (const fn of ['_report_headlines', 'get_report_comparison', 'get_report_coming_up', 'report_build_snapshot', 'get_report_view']) {
    check(`v2: defines ${fn}`, new RegExp(String.raw`CREATE OR REPLACE FUNCTION public\.${fn}\(`).test(body));
  }
}

let dataFns = '';
try {
  dataFns = read('WebPortal/js/data-functions.js');
} catch (e) {
  failures.push(`WebPortal/js/data-functions.js: cannot read (${e.message})`);
}
for (const [wrapper, rpc] of [
  ['ensureReportDrafts', 'ensure_report_drafts'],
  ['listReportHistory', 'list_report_history'],
  ['getReportsAllFigures', 'get_reports_all_figures'],
  ['getReportView', 'get_report_view'],
]) {
  check(`data-functions: ${wrapper} exists`, new RegExp(String.raw`${wrapper}:\s*async function`).test(dataFns));
  check(`data-functions: ${wrapper} calls ${rpc}`, dataFns.includes(`'${rpc}'`));
}
check('data-functions: storeReportPdf wrapper is gone (no store_only mode on the edge function)', !/storeReportPdf/.test(dataFns));

// New-look PDF (Reports v2).
const JS_DIR = 'WebPortal/modules/sales-reports/js/';
const pdfJs = read(JS_DIR + 'report-figures-pdf.js');
const editorJs = read(JS_DIR + 'report_editor.js');
check('report-figures-pdf.js exposes build', /ReportFiguresPdf\s*=\s*\{[^}]*\bbuild\s*:/.test(pdfJs));
check('report-figures-pdf.js exposes ensureLib', /ReportFiguresPdf\s*=\s*\{[^}]*\bensureLib\s*:/.test(pdfJs));
check('report_editor.js uses view.pdfBase64 when embedded', /embedded\s*&&\s*embeddedView[\s\S]{0,200}pdfBase64/.test(editorJs) && /embeddedView\.pdfBase64\(\)/.test(editorJs));
for (const f of ['report_view.js', 'report_figures.js', 'report-figures-pdf.js']) {
  const txt = read(JS_DIR + f);
  check(`${f}: no .innerHTML = assignment`, !/\.innerHTML\s*=/.test(txt));
  check(`${f}: no .html( call`, !/\.html\(/.test(txt));
}
check('report-figures-pdf.js: no arrow glyphs', !/[▲▼]/.test(pdfJs));
check('data-functions: report_view_ cache is cleared alongside report_history_', (dataFns.match(/clearCachePattern\('report_view_'\)/g) || []).length >= 5);
check('data-functions: ensureReportDrafts clears report_history_ cache', /ensureReportDrafts[\s\S]{0,600}clearCachePattern\('report_history_'\)/.test(dataFns));

if (failures.length) {
  console.error(`reports-tabs:verify FAILED (${failures.length} problem(s), ${passCount} passed)`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`reports-tabs:verify PASS (${passCount} checks)`);
