#!/usr/bin/env node
/**
 * kernel-stock-alert:verify — pins the kernel stock figure the alert evaluator sees to the same
 * definition the Kernel Stock on Hand screen shows.
 *
 * Why this exists. evaluate-stock-alerts-cron used to read
 * `from('kernel').select('remaining_by_style')`. There is no such column on any table —
 * `remaining_by_style` is computed per batch by public.get_batch_remaining_by_style and returned by
 * the get_kernel_batches RPC. PostgREST errored, the error was discarded, every style totalled 0,
 * and 0 is at or below every rule's min_qty — so the evaluator raised a FALSE low-stock alert for
 * every active kernel rule on every run. migrations/20260728120000_deactivate_kernel_style_0_1_
 * stock_alerts.sql was written to silence two of them.
 *
 * Two things must therefore stay true, and this script asserts both:
 *   1. The cron never goes back to reading remaining_by_style off a table.
 *   2. Its tally constants and precedence match WebPortal/js/kernel-style-tally.js, the shared
 *      helper the stock page and the Kernel Stock Report both use.
 *
 * `.ts` discipline is the repo's documented one (see scripts/verify-wa-plumbing.mjs:6-14): this
 * script never evaluates a `.ts` file. Constants are read out of both sources and compared;
 * behaviour is checked against a re-declared plain-JS copy of the precedence rule.
 *
 * No dependency, no test framework. node:assert is sufficient.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_CRON = 'supabase/functions/evaluate-stock-alerts-cron/index.ts';
const REL_TALLY = 'WebPortal/js/kernel-style-tally.js';

// Normalise line endings before any comparison — a Windows checkout returns CRLF and every
// multi-line assertion would otherwise fail for a reason unrelated to the code under test.
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

const cronSrc = read(REL_CRON);
const tallySrc = read(REL_TALLY);

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

// ================================================================================================
// 1. The regression itself
// ================================================================================================

check('the cron does NOT read remaining_by_style off a table', () => {
  assert.ok(
    !/\.from\(\s*['"]kernel['"]\s*\)/.test(cronSrc),
    'evaluate-stock-alerts-cron is selecting from the `kernel` table again. `remaining_by_style` ' +
      'is not a column there — it is computed by get_batch_remaining_by_style and returned by the ' +
      'get_kernel_batches RPC. Reading it from the table silently yields 0 kg for every style, ' +
      'which raises a false low-stock alert for every active kernel rule.'
  );
});

check('the cron reads kernel stock through get_kernel_batches', () => {
  assert.ok(
    cronSrc.includes("rpc('get_kernel_batches'"),
    'kernel stock must come from the get_kernel_batches RPC'
  );
});

check('a failed or empty kernel read does not become an observation of zero', () => {
  assert.ok(
    /kernelBatches\.length === 0/.test(cronSrc),
    'the cron must skip kernel observations when it reads no batches — reporting 0 kg raises a ' +
      'low-stock alert for every active kernel rule, and an empty read is far more likely to be a ' +
      'failed read than an empty warehouse'
  );
  assert.ok(
    /throw new Error\(`get_kernel_batches failed/.test(cronSrc),
    'an RPC error must throw so the run fails loudly, not silently total zero'
  );
});

check('the status filter is DERIVED from FINISHED_STATUSES, not written out twice', () => {
  assert.ok(
    /p_status: FINISHED_STATUSES\.join\(','\)/.test(cronSrc),
    "p_status must be built from FINISHED_STATUSES so the SQL filter and the JS guard cannot " +
      'drift apart. get_kernel_batches matches it with ' +
      "k.status = ANY(string_to_array(p_status, ',')) — a hand-written list here would silently " +
      'diverge from the shared tally the stock screen uses.'
  );
});

check('the kernel read is paged — a truncated read understates stock', () => {
  assert.ok(/p_offset:/.test(cronSrc), 'must page with p_offset');
  const m = cronSrc.match(/const KERNEL_PAGE_SIZE = (\d+);/);
  assert.ok(m, 'KERNEL_PAGE_SIZE not found');
  assert.ok(
    Number(m[1]) > 100,
    `page size ${m[1]} is not above get_kernel_batches' own p_limit default of 100`
  );
});

// ================================================================================================
// 2. Parity with the shared tally the screen uses
// ================================================================================================

function constFrom(src, re, label) {
  const m = src.match(re);
  assert.ok(m, `could not read ${label}`);
  return m[1];
}

check('KG_PER_CARTON matches kernel-style-tally.js', () => {
  const cron = constFrom(cronSrc, /const KG_PER_CARTON = ([\d.]+);/, `KG_PER_CARTON in ${REL_CRON}`);
  const tally = constFrom(tallySrc, /var KG_PER_CARTON = ([\d.]+);/, `KG_PER_CARTON in ${REL_TALLY}`);
  assert.equal(
    cron,
    tally,
    `the alert evaluator converts cartons at ${cron} kg but the stock screen uses ${tally} — the ` +
      `thresholds and the screen would disagree about what is on hand`
  );
});

check('FINISHED_STATUSES matches kernel-style-tally.js', () => {
  const cron = constFrom(
    cronSrc,
    /const FINISHED_STATUSES = (\[[^\]]*\]);/,
    `FINISHED_STATUSES in ${REL_CRON}`
  );
  const tally = constFrom(
    tallySrc,
    /var FINISHED_STATUSES = (\[[^\]]*\]);/,
    `FINISHED_STATUSES in ${REL_TALLY}`
  );
  assert.deepEqual(
    JSON.parse(cron.replace(/'/g, '"')),
    JSON.parse(tally.replace(/'/g, '"')),
    'the alert evaluator and the stock screen must agree on which batches still hold stock'
  );
});

check('STYLE_KEYS matches KERNEL_STYLES in kernel-style-tally.js', () => {
  const cron = constFrom(cronSrc, /const STYLE_KEYS = (\[[^\]]*\]);/, `STYLE_KEYS in ${REL_CRON}`);
  const tally = constFrom(
    tallySrc,
    /var KERNEL_STYLES = (\[[^\]]*\]);/,
    `KERNEL_STYLES in ${REL_TALLY}`
  );
  assert.deepEqual(
    JSON.parse(cron.replace(/'/g, '"')),
    JSON.parse(tally.replace(/'/g, '"')),
    'a style present in one list and not the other is either never evaluated or never displayed'
  );
});

// ================================================================================================
// 3. The precedence rule, behaviourally
// ================================================================================================

check('the cron applies the kg-then-cartons precedence', () => {
  assert.ok(
    /kg > 0 \? kg : cartons > 0 \? cartons \* KG_PER_CARTON : 0/.test(cronSrc),
    'the per-style figure must prefer recorded kg and fall back to cartons × KG_PER_CARTON, ' +
      "matching cellsForBatch(batch, 'kg') in kernel-style-tally.js"
  );
});

// Identical plain-JS copy of the precedence asserted above.
const KG_PER_CARTON_COPY = Number(constFrom(tallySrc, /var KG_PER_CARTON = ([\d.]+);/, 'kg/carton'));
function styleKgCopy(kg, cartons) {
  const k = Number.isFinite(kg) ? kg : 0;
  const c = Number.isFinite(cartons) ? cartons : 0;
  return k > 0 ? k : c > 0 ? c * KG_PER_CARTON_COPY : 0;
}

check('recorded kg wins over a carton count', () => {
  assert.equal(styleKgCopy(500, 10), 500);
});

check('cartons convert only when no kg was recorded', () => {
  assert.equal(styleKgCopy(0, 10), 10 * KG_PER_CARTON_COPY);
});

check('nothing recorded is zero, not NaN', () => {
  assert.equal(styleKgCopy(0, 0), 0);
  assert.equal(styleKgCopy(NaN, NaN), 0);
});

// ================================================================================================
// Report
// ================================================================================================

if (failures.length > 0) {
  console.error(
    `\nKERNEL STOCK ALERT SOURCE FAILED (${failures.length} of ${failures.length + passCount}):\n`
  );
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`KERNEL STOCK ALERT SOURCE OK (${passCount} checks passed).`);
