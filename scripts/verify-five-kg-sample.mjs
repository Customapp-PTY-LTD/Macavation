#!/usr/bin/env node
/**
 * five-kg-sample:verify — the 5 kg sample's final Sound / Unsound Kernel moves the sinkers into Unsound.
 *
 * Why this exists. Until Nov 2026 the portal reported the crack-out's pre-float Sound Kernel as the
 * final figure, skipping the step that strips the sinkers (butter grade) out of Sound and adds them to
 * Unsound. QA's workbook gives one sample worked both ways; the "Correct" table is asserted here:
 *   inputs  SK pre-float 850, shell 3000, floating wet 777, sinking wet 111, breakdown 5..45 (225)
 *   final   SK 743.75 g (18.25%), USK 331.25 g (8.13%), shell 3000 g (73.62%), total 4075 g
 *
 * It also pins that the entry modal, the batch page and batch history all use WebPortal/js/five-kg-sample.js
 * rather than a second copy of the sum, and that index.html loads it.
 *
 * No dependency, no test framework. node:assert is sufficient.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');

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

const sandbox = {};
new vm.Script(read('WebPortal/js/five-kg-sample.js')).runInNewContext(sandbox);
const F = sandbox.FiveKgSample;
const near = (a, b, msg) => assert.ok(a != null && Math.abs(a - b) < 0.005, `${msg}: expected ${b}, got ${a}`);

const workbook = {
  sound_kernel_g: 850,
  shell_g: 3000,
  floating_g: 777,
  sinking_g: 111,
  unsound: {
    germination_g: 5, late_stinkbug_g: 10, early_stinkbug_g: 15, dark_centre_g: 20, mould_g: 25,
    rotten_g: 30, immature_split_g: 35, shrivelled_g: 40, nut_borer_g: 45
  }
};

check('workbook "Correct" table', () => {
  const r = F.calc(workbook);
  near(r.unsound_kernel_g, 225, 'crack-out unsound = breakdown total');
  near(r.crack_out_total_g, 4075, 'crack-out total');
  near(r.wet_total_g, 888, 'total wet');
  near(r.water_g, 38, 'water weight');
  near(r.water_pct, 4.47, 'water %');
  near(r.floating_dry_g, 743.75, 'floating dry');
  near(r.sinking_dry_g, 106.25, 'sinking dry');
  near(r.final_sound_kernel_g, 743.75, 'final SK');
  near(r.final_unsound_kernel_g, 331.25, 'final USK');
  near(r.final_total_g, 4075, 'final total');
  near(r.final_sound_kernel_pct, 18.25, 'final SK %');
  near(r.final_unsound_kernel_pct, 8.13, 'final USK %');
  near(r.final_shell_pct, 73.62, 'final shell %');
});

check('saved-sample shape gives the same answer', () => {
  const r = F.fromSaved({
    crack_out: { sound_kernel_g: 850, unsound_kernel_g: 225, shell_g: 3000 },
    float_test: { floating_g: 777, sinking_g: 111 },
    unsound: workbook.unsound
  });
  near(r.final_sound_kernel_pct, 18.25, 'final SK %');
  near(r.final_unsound_kernel_pct, 8.13, 'final USK %');
});

check('no float test yet: no final figures, nothing invented', () => {
  const r = F.calc({ ...workbook, floating_g: null, sinking_g: null });
  assert.equal(r.final_sound_kernel_g, null);
  assert.equal(r.final_unsound_kernel_g, null);
  assert.equal(r.water_g, null);
  near(r.unsound_kernel_g, 225, 'crack-out unsound still shown');
});

check('half-filled float test: no split until both weights are in', () => {
  const r = F.calc({ ...workbook, floating_g: null, sinking_g: 111 });
  assert.equal(r.final_sound_kernel_g, null, 'final SK waits for floating weight');
  assert.equal(r.sinking_dry_g, null, 'sinkers wait for floating weight');
  near(F.calc({ ...workbook, floating_g: 888, sinking_g: 0 }).final_sound_kernel_g, 850, 'no sinkers (0 typed) is valid');
});

check('wet below pre-float is flagged (all the kernel goes in the bath)', () => {
  assert.equal(F.calc(workbook).wet_below_prefloat, false);
  assert.equal(F.calc({ ...workbook, floating_g: 700, sinking_g: 100 }).wet_below_prefloat, true);
});

check('sample screen shows percentages to 2 decimals, like the workbook', () => {
  const js = read('WebPortal/modules/modals/modal-grower-link-sample-to-batch/js/modal_grower_link_sample_to_batch.js');
  assert.match(js, /\(part \/ whole \* 100\)\.toFixed\(2\)/, 'fmtPct uses 2 decimals');
  assert.doesNotMatch(js, /toFixed\(1\)/, 'no 1-decimal percentages left');
});

check('older sample with no breakdown keeps its typed unsound weight', () => {
  const r = F.fromSaved({ crack_out: { sound_kernel_g: 850, unsound_kernel_g: 200, shell_g: 3000 }, float_test: {}, unsound: {} });
  near(r.unsound_kernel_g, 200, 'legacy unsound');
});

check('screens use the shared calculation', () => {
  assert.match(read('WebPortal/index.html'), /<script src="js\/five-kg-sample\.js\?v=[^"]+"><\/script>/, 'index.html loads five-kg-sample.js');
  for (const rel of [
    'WebPortal/modules/modals/modal-grower-link-sample-to-batch/js/modal_grower_link_sample_to_batch.js',
    'WebPortal/modules/batch-journey/js/batch_journey_detail.js',
    'WebPortal/modules/modals/modal-batch-history/js/modal_batch_history.js'
  ]) {
    assert.match(read(rel), /FiveKgSample\.(calc|fromSaved)\(/, `${rel} calls FiveKgSample`);
  }
});

check('crack-out Unsound Kernel is calculated, not typed', () => {
  const html = read('WebPortal/modules/modals/modal-grower-link-sample-to-batch/html/modal_grower_link_sample_to_batch.html');
  const m = html.match(/<input[^>]*id="sampleUnsoundKernelG"[^>]*>/);
  assert.ok(m, 'sampleUnsoundKernelG input exists');
  assert.match(m[0], /readonly/, 'sampleUnsoundKernelG is readonly');
  assert.match(html, /id="sampleFinalSoundKernelG"/, 'Final Sample Results table present');
});

if (failures.length) {
  console.error(`five-kg-sample:verify FAILED (${failures.length} of ${failures.length + passCount}):`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`five-kg-sample:verify OK (${passCount} checks)`);
