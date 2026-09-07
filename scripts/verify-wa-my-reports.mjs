#!/usr/bin/env node
/**
 * wa-my-reports:verify — regression guard for the "My reports" settings menu and the
 * unrecognised-input-opens-the-menu change (docs/mockups/whatsapp-flow-spec.html sections 5 & 9):
 *   supabase/functions/whatsapp-inbound/index.ts   (MENU_ITEMS, handleCommand, the settings
 *                                                    branch, STAGED_COMMAND_HANDLERS)
 *
 * Follows the same `.ts` discipline as verify-wa-optout.mjs / verify-wa-staff-menu.mjs / verify-wa-
 * plumbing.mjs: `.ts` type annotations are not valid JS, so this script never evaluates a `.ts`
 * file — it asserts textually against the real source, and every failure names the file to fix.
 * Pure fs reads, node:assert, no dependency, no network — test:fleet must stay hermetic.
 *
 * WHAT THIS GUARDS, specifically the two contracts most likely to erode under a later
 * "simplify this" pass:
 *   - contract 1: an unrecognised typed word must open the menu, not list verbs to type. A future
 *     edit could silently reintroduce the old "I did not recognise" text, or add it back ALONGSIDE
 *     a commandMenu call (belt-and-braces that quietly un-fixes the behaviour for anyone reading
 *     the reply). Assertion 1 checks both the absence of the old text AND the presence of the new
 *     dispatch, scoped to the exact tail of handleCommand so the empty-body "opens the menu"
 *     branch (already true before this plan) cannot pass this check by accident.
 *   - contract 4: "Stop everything" is the one settings row that must stay staged behind a YES/NO
 *     confirm, because it is tapped from a menu (a mis-tap in a list of five rows is plausible) —
 *     the other four rows are immediate ON PURPOSE, and it is easy for someone matching that
 *     precedent to "simplify" Stop everything into the same immediate shape, silently removing the
 *     one confirm step Meta-facing opt-out safety depends on nowhere else being skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';

/** Normalise CRLF before any comparison — same reason as the sibling verifiers. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

const inboundSrc = readFile(REL_INBOUND);

// ---- tiny test harness (same shape as the sibling verifiers) --------------------------------
const failures = [];
let passCount = 0;
function check(description, fn) {
  try {
    fn();
    passCount++;
  } catch (e) {
    failures.push({ description, message: e && e.message ? e.message : String(e) });
  }
}

/**
 * Walks from `declaration`'s first `{` to the matching close brace — the isolateByBraceDepth idiom
 * from verify-wa-optout.mjs, copied here (not imported: these verifiers are deliberately
 * standalone, dependency-free scripts) because it is the only isolation idiom in this repo that is
 * safe for a function containing NESTED braces (object literals, nested if/try blocks).
 */
function isolateByBraceDepth(source, relPath, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    throw new Error(
      `${relPath}: could not find ${JSON.stringify(declaration)}. If it was renamed, update this ` +
        `verifier to match — do not delete the assertion.`
    );
  }
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${relPath}: ${JSON.stringify(declaration)} body is not brace-balanced — cannot verify it.`);
}

// ================================================================================================
// 1. Contract 1 — the unrecognised-verb fallback opens the menu instead of listing verbs.
//
// Scoped to the TAIL of handleCommand, strictly after the renderMenuPosition (digit) branch, so
// the pre-existing "empty body or '?' opens the menu" branch earlier in the same function cannot
// satisfy this check by accident — this assertion is worthless unless it can only pass because the
// FALLBACK specifically was fixed.
// ================================================================================================

check(
  'handleCommand: the final fallback (after the digit-position branch) opens the menu instead of building the old "I did not recognise" reply',
  () => {
    const body = isolateByBraceDepth(inboundSrc, REL_INBOUND, 'async function handleCommand(ctx: CommandContext)');

    const posIdx = body.indexOf('renderMenuPosition(ctx, Number(verb))');
    assert.ok(posIdx !== -1, `${REL_INBOUND}: expected handleCommand to still dispatch a bare digit via renderMenuPosition.`);

    const tail = body.slice(posIdx);

    // Matches the OLD reply's exact quoted shape (`I did not recognise "${verb}"`), not the bare
    // phrase "did not recognise" — a bare-phrase match would also trip on a legitimate comment
    // that happens to describe the old behaviour in passing (it did, once, during this very edit).
    assert.ok(
      !/I did not recognise "/.test(tail),
      `${REL_INBOUND}: the unrecognised-verb fallback (after the digit-position branch) still builds ` +
        `the old "I did not recognise" reply text. Contract 1 replaces that whole branch with a call ` +
        `to commandMenu(ctx) — reword-only "fixes" that leave the old text in place do not satisfy it.`
    );
    assert.ok(
      !/outcome:\s*'unknown_command'/.test(tail),
      `${REL_INBOUND}: the fallback tail still returns outcome: 'unknown_command' — the old ` +
        `list-of-verbs branch appears to still be present in some form.`
    );
    assert.ok(
      /return commandMenu\(ctx\);/.test(tail),
      `${REL_INBOUND}: expected the final fallback to "return commandMenu(ctx);" (or the equivalent ` +
        `menu-sending call) — absence of the old text alone does not prove the new dispatch exists.`
    );
  }
);

check('HELP remains its own explicit branch, unaffected by the fallback change (contract 1\'s carve-out)', () => {
  assert.ok(
    inboundSrc.includes("if (verb === 'HELP') {\n    return commandHelp(ctx);\n  }"),
    `${REL_INBOUND}: expected HELP to still short-circuit to commandHelp(ctx) as its own explicit ` +
      `branch — HELP must not have been folded into "opens the menu".`
  );
});

// ================================================================================================
// 2. MENU_ITEMS contains "My reports" with no feature gate.
// ================================================================================================

check('MENU_ITEMS contains a "My reports" entry with feature: null (no gate)', () => {
  const m = inboundSrc.match(
    /action:\s*'settings',\s*\n\s*title:\s*'([^']+)',\s*\n\s*feature:\s*(null|'[^']*')/
  );
  assert.ok(
    m,
    `${REL_INBOUND}: could not find a MENU_ITEMS entry shaped like ` +
      `"action: 'settings', title: '...', feature: null|'...'". If the action or field order ` +
      `changed, update this verifier to match — do not delete the assertion.`
  );
  assert.ok(
    /my reports/i.test(m[1]),
    `${REL_INBOUND}: expected the settings item's title to be "My reports" (or close), got ${JSON.stringify(m[1])}.`
  );
  assert.equal(
    m[2],
    'null',
    `${REL_INBOUND}: expected the settings item's feature to be exactly null (no gate at all) — ` +
      `got ${m[2]}. A real feature key here would make this item disappear for any role nobody ` +
      `remembered to grant it to, defeating the point of "My reports" being everybody's own settings.`
  );
});

// ================================================================================================
// 3. The five settings rows (contract 2's table) are all present in the settings branch's source.
// ================================================================================================

check('the settings sub-list source contains all five contract-2 rows', () => {
  const start = inboundSrc.indexOf("const SETTINGS_NS = 'rpt';");
  const end = inboundSrc.indexOf('async function dispatchSettingsAction');
  assert.ok(start !== -1, `${REL_INBOUND}: could not find the start of the settings branch (SETTINGS_NS).`);
  assert.ok(end !== -1, `${REL_INBOUND}: could not find dispatchSettingsAction — the settings branch may have moved.`);
  const section = inboundSrc.slice(start, inboundSrc.indexOf('\n}', end) + 2);

  const must = ["'daily'", "'weekly'", "'monthly'", "'Pause for a week'", "'Stop everything'"];
  for (const needle of must) {
    assert.ok(
      section.includes(needle),
      `${REL_INBOUND}: the settings branch no longer contains ${needle} — one of contract 2's five ` +
        `rows (Daily/Weekly/Monthly on-off, Pause for a week, Stop everything) appears to be missing.`
    );
  }
});

// ================================================================================================
// 4. Contract 4 — "Stop everything" is STAGED, not dispatched immediately. The regression this
//    guards against: someone "simplifying" it to match the other four rows' immediacy and silently
//    removing the one confirm step Meta-facing opt-out safety depends on nowhere else being
//    skipped.
// ================================================================================================

check('STOP_ALL_REPORTS is registered in STAGED_COMMAND_HANDLERS', () => {
  const mapBlock = isolateByBraceDepth(inboundSrc, REL_INBOUND, 'const STAGED_COMMAND_HANDLERS');
  assert.ok(
    /\bSTOP_ALL_REPORTS\s*:/.test(mapBlock),
    `${REL_INBOUND}: expected "STOP_ALL_REPORTS:" registered inside STAGED_COMMAND_HANDLERS — YES ` +
      `dispatches through that map, and this is what makes "Stop everything" a confirm-first action.`
  );
});

check(
  'the "Stop everything" tap handler stages the request rather than calling report_set_opt_out directly',
  () => {
    const body = isolateByBraceDepth(
      inboundSrc,
      REL_INBOUND,
      'async function commandSettingsStopAll(ctx: CommandContext)'
    );
    assert.ok(
      body.includes("rpc('whatsapp_stage_pending_command'"),
      `${REL_INBOUND}: commandSettingsStopAll must call whatsapp_stage_pending_command — tapping ` +
        `"Stop everything" must stage a confirm, not act immediately.`
    );
    assert.ok(
      !body.includes("rpc('report_set_opt_out'"),
      `${REL_INBOUND}: commandSettingsStopAll must NOT call report_set_opt_out directly — that is ` +
        `exactly the regression contract 4 forbids: "Stop everything" tapped from the menu must be ` +
        `staged behind a YES/NO confirm (see STOP_ALL_REPORTS in STAGED_COMMAND_HANDLERS), never ` +
        `applied on the tap itself the way Daily/Weekly/Monthly/Pause are.`
    );
  }
);

// ================================================================================================
// 5. The opposite regression (contract 3/4's other half) — Daily/Weekly/Monthly and Pause must
//    NEVER go through whatsapp_stage_pending_command. Confirmed via absence, not presence.
// ================================================================================================

check('commandToggleReportKind (Daily/Weekly/Monthly) never stages — it writes immediately', () => {
  const body = isolateByBraceDepth(
    inboundSrc,
    REL_INBOUND,
    'async function commandToggleReportKind(ctx: CommandContext, kind: ReportKind)'
  );
  assert.ok(
    !body.includes('whatsapp_stage_pending_command'),
    `${REL_INBOUND}: commandToggleReportKind must not call whatsapp_stage_pending_command — ` +
      `Daily/Weekly/Monthly toggle immediately, no confirm (contract 3).`
  );
  assert.ok(
    body.includes("rpc('set_report_subscription_by_phone'"),
    `${REL_INBOUND}: commandToggleReportKind must call set_report_subscription_by_phone.`
  );
});

check('commandPauseDaily ("Pause for a week") never stages — it writes immediately', () => {
  const body = isolateByBraceDepth(inboundSrc, REL_INBOUND, 'async function commandPauseDaily(ctx: CommandContext)');
  assert.ok(
    !body.includes('whatsapp_stage_pending_command'),
    `${REL_INBOUND}: commandPauseDaily must not call whatsapp_stage_pending_command — pausing is ` +
      `immediate, no confirm (contract 4).`
  );
  assert.ok(
    body.includes("rpc('set_report_subscription_by_phone'"),
    `${REL_INBOUND}: commandPauseDaily must call set_report_subscription_by_phone.`
  );
});

// ================================================================================================
// 6. Read path reuse — no new RPC. The settings branch may only call RPCs that already existed
//    before this plan (report_recipient_by_inbound_phone, report_subscription_json,
//    set_report_subscription_by_phone, report_set_opt_out, whatsapp_stage_pending_command).
// ================================================================================================

check('the settings branch reuses report_subscription_json rather than inventing a new read RPC', () => {
  const start = inboundSrc.indexOf("const SETTINGS_NS = 'rpt';");
  const end = inboundSrc.indexOf('async function dispatchSettingsAction');
  const section = inboundSrc.slice(start, end);
  assert.ok(
    section.includes("rpc('report_subscription_json'"),
    `${REL_INBOUND}: expected the settings branch's read path to call the existing ` +
      `report_subscription_json RPC rather than a new one.`
  );
});

// ---- report -------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nwa-my-reports:verify FAILED — ${failures.length} of ${failures.length + passCount} checks\n`);
  for (const f of failures) {
    console.error(`  ✗ ${f.description}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}
console.log(`wa-my-reports:verify passed — ${passCount} checks`);
