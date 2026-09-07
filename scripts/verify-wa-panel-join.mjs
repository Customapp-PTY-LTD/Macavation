#!/usr/bin/env node
/**
 * wa-panel-join:verify — regression guard for "add a recipient from the panel, and let one join by
 * messaging the number":
 *   WebPortal/modules/sales-reports/html/report_list.html   (Add person modal, Staff control,
 *                                                             banner text)
 *   WebPortal/modules/sales-reports/js/report_list_grid.js  (Add person / Staff / Remove wiring)
 *   WebPortal/js/data-functions.js                          (setReportRecipientStaff wrapper)
 *   supabase/functions/whatsapp-inbound/index.ts            (tryJoinReportsFlow, the WhatsApp-side
 *                                                             join keyword and daily/weekly/monthly
 *                                                             follow-up)
 *
 * Follows the same `.ts` discipline as verify-wa-optout.mjs / verify-wa-my-reports.mjs /
 * verify-wa-plumbing.mjs for the edge-function half: `.ts` type annotations are not valid JS, so
 * this script never evaluates whatsapp-inbound/index.ts — it asserts textually against the real
 * source, and every failure names the file to fix. For the WebPortal/ JS/HTML half it follows
 * verify-ui-standard.mjs's general approach — textual assertion against real markup, not a
 * DOM-evaluation framework this repo does not have (report_list_grid.js is not a bare, vm-safe
 * module the way report-whatsapp-send.js is — it references jQuery/dataFunctions/Swal at
 * function-call time, not module-evaluation time).
 *
 * Pure fs reads, node:assert-free hand-rolled harness (same shape as the sibling verifiers), no
 * dependency, no network — test:fleet must stay hermetic.
 *
 * WHAT ASSERTION 5 SPECIFICALLY GUARDS: contract 4's "joining states intent, it does not choose" —
 * a new roster row created by the join keyword must be left with EVERY subscription kind off. The
 * single easiest way for a later "simplify this" pass to silently break that promise is to
 * auto-subscribe a new joiner to Daily right after creating them, reasoning that "they typed
 * reports, so they clearly want the report" — this assertion exists specifically to catch that.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const REL_HTML = 'WebPortal/modules/sales-reports/html/report_list.html';
const REL_GRID_JS = 'WebPortal/modules/sales-reports/js/report_list_grid.js';
const REL_DATA_FUNCTIONS = 'WebPortal/js/data-functions.js';

/** Normalise CRLF before any comparison — same reason as the sibling verifiers. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

const inboundSrc = readFile(REL_INBOUND);
const htmlSrc = readFile(REL_HTML);
const gridSrc = readFile(REL_GRID_JS);
const dataFunctionsSrc = readFile(REL_DATA_FUNCTIONS);

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
function fail(msg) {
  throw new Error(msg);
}

/**
 * Walks from `declaration`'s first `{` to the matching close brace — the isolateByBraceDepth idiom
 * from verify-wa-optout.mjs / verify-wa-my-reports.mjs, copied here (not imported: these verifiers
 * are deliberately standalone, dependency-free scripts) because it is the only isolation idiom in
 * this repo that is safe for a function or block containing NESTED braces (object literals, nested
 * if/try blocks).
 */
function isolateByBraceDepth(source, relPath, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    fail(
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
  fail(`${relPath}: ${JSON.stringify(declaration)} body is not brace-balanced — cannot verify it.`);
}

// ================================================================================================
// 1. report_list_grid.js calls upsert_report_recipient — via the existing dataFunctions.
//    upsertReportRecipient wrapper, the convention this file already uses everywhere else in this
//    module (setReportSubscription, setReportRecipientActive are both called the same way).
// ================================================================================================

check('report_list_grid.js calls upsert_report_recipient via dataFunctions.upsertReportRecipient', () => {
  if (!gridSrc.includes('dataFunctions.upsertReportRecipient(')) {
    fail(
      `${REL_GRID_JS}: expected a call to "dataFunctions.upsertReportRecipient(" — the wrapper this ` +
        `file's own sibling calls (setReportSubscription, setReportRecipientActive) already use, ` +
        `defined in ${REL_DATA_FUNCTIONS}.`
    );
  }
});

check('data-functions.js still defines upsertReportRecipient calling upsert_report_recipient', () => {
  if (!/upsertReportRecipient:\s*async function/.test(dataFunctionsSrc)) {
    fail(`${REL_DATA_FUNCTIONS}: expected "upsertReportRecipient: async function" to still exist.`);
  }
  if (!dataFunctionsSrc.includes("callFunction('upsert_report_recipient'")) {
    fail(`${REL_DATA_FUNCTIONS}: upsertReportRecipient must call the 'upsert_report_recipient' RPC.`);
  }
});

// ================================================================================================
// 2. report_list.html contains an "Add person" control.
// ================================================================================================

check('report_list.html has an "Add person" control (id + visible text)', () => {
  if (!/id="addReportRecipientBtn"/.test(htmlSrc)) {
    fail(`${REL_HTML}: expected a control with id="addReportRecipientBtn".`);
  }
  if (!/id="addReportRecipientBtn"[^>]*>[\s\S]{0,200}?Add person/i.test(htmlSrc)) {
    fail(`${REL_HTML}: expected the addReportRecipientBtn control's visible text to read "Add person".`);
  }
  if (!/id="addReportRecipientModal"/.test(htmlSrc)) {
    fail(`${REL_HTML}: expected an "Add person" modal with id="addReportRecipientModal".`);
  }
});

check('report_list_grid.js wires #addReportRecipientBtn to open the Add person modal', () => {
  if (!/#addReportRecipientBtn['"]/.test(gridSrc)) {
    fail(`${REL_GRID_JS}: expected a binding on "#addReportRecipientBtn".`);
  }
});

// ================================================================================================
// 3. A "Staff" control exists and is wired to set_report_recipient_staff.
// ================================================================================================

check('report_list.html / report_list_grid.js render a Staff control per row', () => {
  const staffInHtmlOrJs = htmlSrc.includes('js-report-staff') || gridSrc.includes('js-report-staff');
  if (!staffInHtmlOrJs) {
    fail(
      `${REL_HTML} / ${REL_GRID_JS}: expected a "js-report-staff" control (row-level Staff toggle) ` +
        `in the rendered markup.`
    );
  }
  if (!/js-report-staff[\s\S]{0,200}?Staff|Staff[\s\S]{0,50}?js-report-staff/.test(gridSrc)) {
    fail(`${REL_GRID_JS}: expected the js-report-staff control to be labelled "Staff".`);
  }
});

check('report_list_grid.js wires the Staff control to dataFunctions.setReportRecipientStaff', () => {
  if (!gridSrc.includes('.js-report-staff')) {
    fail(`${REL_GRID_JS}: expected a delegated binding on ".js-report-staff".`);
  }
  if (!gridSrc.includes('dataFunctions.setReportRecipientStaff(')) {
    fail(`${REL_GRID_JS}: expected a call to "dataFunctions.setReportRecipientStaff(".`);
  }
});

check('data-functions.js defines setReportRecipientStaff calling set_report_recipient_staff', () => {
  if (!/setReportRecipientStaff:\s*async function/.test(dataFunctionsSrc)) {
    fail(
      `${REL_DATA_FUNCTIONS}: expected "setReportRecipientStaff: async function" — no wrapper for ` +
        `set_report_recipient_staff existed before this plan despite the RPC being granted since 25 August.`
    );
  }
  if (!dataFunctionsSrc.includes("callFunction('set_report_recipient_staff'")) {
    fail(
      `${REL_DATA_FUNCTIONS}: setReportRecipientStaff must call the 'set_report_recipient_staff' RPC.`
    );
  }
});

// ================================================================================================
// 4. whatsapp-inbound/index.ts contains the join keyword path, reachable from the unenrolled
//    branch inside processCommandForMessage. Isolates that function by brace depth FIRST (rather
//    than a whole-file indexOf) because an earlier sibling plan was blocked for exactly this
//    unsoundness — outcome/command strings can appear more than once across the file, in comments
//    or in unrelated functions defined earlier in the file.
// ================================================================================================

check(
  'the join-flow call sits inside processCommandForMessage, after staff resolution is attempted and before the not_enrolled fallback',
  () => {
    const fnBody = isolateByBraceDepth(inboundSrc, REL_INBOUND, 'async function processCommandForMessage');

    // Isolation sanity check first, same reasoning as verify-wa-optout.mjs's own: 'not_enrolled'
    // appears more than once across the whole file (tryConfirmEnrolment's failure path, plus this
    // function's own fallback) — a bare file-wide indexOf could never reliably prove order.
    const notEnrolledCount = (fnBody.match(/outcome: 'not_enrolled'/g) || []).length;
    if (notEnrolledCount !== 1) {
      fail(
        `${REL_INBOUND}: expected exactly 1 occurrence of "outcome: 'not_enrolled'" inside ` +
          `processCommandForMessage's isolated body, found ${notEnrolledCount}. The isolation ` +
          `boundary may have drifted — do not loosen this check, fix what changed.`
      );
    }

    const resolveIdx = fnBody.indexOf("sb.rpc('whatsapp_resolve_staff_user'");
    const joinFlowIdx = fnBody.indexOf('tryJoinReportsFlow(');
    const codeCheckIdx = fnBody.indexOf('tryConfirmEnrolment(');
    const notEnrolledIdx = fnBody.indexOf("outcome: 'not_enrolled'");

    if (resolveIdx === -1) {
      fail(`${REL_INBOUND}: processCommandForMessage no longer calls whatsapp_resolve_staff_user.`);
    }
    if (joinFlowIdx === -1) {
      fail(
        `${REL_INBOUND}: processCommandForMessage does not call tryJoinReportsFlow(. The join keyword ` +
          `path must be reachable from the unenrolled branch.`
      );
    }
    if (codeCheckIdx === -1) {
      fail(`${REL_INBOUND}: processCommandForMessage no longer calls tryConfirmEnrolment(.`);
    }
    // The unenrolled branch (resolveIdx) must come first, then the join flow must sit alongside the
    // existing 6-digit-code check and strictly before the final silent-fallback log — this is what
    // proves it is reachable FROM the unenrolled branch rather than dead code elsewhere in the file.
    if (!(resolveIdx < codeCheckIdx && codeCheckIdx < joinFlowIdx && joinFlowIdx < notEnrolledIdx)) {
      fail(
        `${REL_INBOUND}: expected source order inside processCommandForMessage to be ` +
          `whatsapp_resolve_staff_user < tryConfirmEnrolment(...) < tryJoinReportsFlow(...) < ` +
          `outcome: 'not_enrolled' (found at ${resolveIdx}, ${codeCheckIdx}, ${joinFlowIdx}, ` +
          `${notEnrolledIdx}). This script never executes .ts, so source order is what proves the ` +
          `join keyword sits in the unenrolled branch, after the 6-digit-code check, before the ` +
          `silent not_enrolled fallback.`
      );
    }
  }
);

check('tryJoinReportsFlow checks the "reports" keyword and resolves via report_recipient_by_inbound_phone', () => {
  const fnBody = isolateByBraceDepth(inboundSrc, REL_INBOUND, 'async function tryJoinReportsFlow');
  // Source-text search for the literal regex pattern \breports\b (word-boundary "reports"), not a
  // live regex test against fnBody — this asserts the CODE contains that pattern, not that fnBody's
  // own source text happens to contain the word "reports" (which it trivially does, everywhere).
  if (!fnBody.includes('\\breports\\b')) {
    fail(`${REL_INBOUND}: tryJoinReportsFlow must test for the word "reports" with a \\breports\\b word-boundary regex.`);
  }
  if (!fnBody.includes("rpc('report_recipient_by_inbound_phone'")) {
    fail(`${REL_INBOUND}: tryJoinReportsFlow must call report_recipient_by_inbound_phone.`);
  }
  if (!fnBody.includes("rpc('upsert_report_recipient'")) {
    fail(`${REL_INBOUND}: tryJoinReportsFlow must call upsert_report_recipient to create the roster row.`);
  }
  if (!fnBody.includes("rpc('set_report_subscription_by_phone'")) {
    fail(
      `${REL_INBOUND}: tryJoinReportsFlow must call set_report_subscription_by_phone for the ` +
        `daily/weekly/monthly follow-up choice.`
    );
  }
});

check('tryJoinReportsFlow never touches is_staff', () => {
  const fnBody = isolateByBraceDepth(inboundSrc, REL_INBOUND, 'async function tryJoinReportsFlow');
  if (/is_staff/.test(fnBody)) {
    fail(
      `${REL_INBOUND}: tryJoinReportsFlow must not reference is_staff at all (contract 5) — becoming ` +
        `staff is a separate, portal-admin or enrolment-code action.`
    );
  }
});

// ================================================================================================
// 5. The join path's new roster row is created with EVERY subscription kind left off — the
//    upsert_report_recipient call must NOT be followed, in the same code block, by a
//    set_report_subscription_by_phone call with p_is_active: true. See this file's header comment
//    for why this is the assertion most likely to be silently "improved" away.
// ================================================================================================

check(
  'upsert_report_recipient in the join-create branch is not followed by an auto-subscribing set_report_subscription_by_phone call in the same block',
  () => {
    const fnBody = isolateByBraceDepth(inboundSrc, REL_INBOUND, 'async function tryJoinReportsFlow');
    const createBlock = isolateByBraceDepth(fnBody, REL_INBOUND, 'if (!alreadyOnRoster) {');
    if (!createBlock.includes("rpc('upsert_report_recipient'")) {
      fail(
        `${REL_INBOUND}: expected the "if (!alreadyOnRoster) {" block to contain the ` +
          `upsert_report_recipient call that creates the new roster row.`
      );
    }
    if (createBlock.includes('set_report_subscription_by_phone')) {
      fail(
        `${REL_INBOUND}: the roster-row-creation block ("if (!alreadyOnRoster) { ... }") must not ` +
          `also call set_report_subscription_by_phone — contract 4 requires the new row to be left ` +
          `with EVERY subscription kind off ("joining states intent, it does not choose"). A call to ` +
          `set_report_subscription_by_phone belongs only in the separate daily/weekly/monthly ` +
          `follow-up branch, gated on the person already being on the roster.`
      );
    }
  }
);

// ================================================================================================
// 6. report_list.html's banner no longer asserts recipients are added "not here".
// ================================================================================================

check('report_list.html banner no longer claims recipients are only added by enrolling on WhatsApp', () => {
  const oldClaim = 'People are added to this list by enrolling on WhatsApp, not here.';
  if (htmlSrc.includes(oldClaim)) {
    fail(
      `${REL_HTML}: still contains the old banner sentence ${JSON.stringify(oldClaim)}. Both ways in ` +
        `now exist (Add person here, or joining by WhatsApp) — the banner must describe both.`
    );
  }
  if (!/Add person/.test(htmlSrc)) {
    fail(`${REL_HTML}: expected the banner (or a nearby control) to mention "Add person".`);
  }
});

// ---- report -------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nwa-panel-join:verify FAILED — ${failures.length} of ${failures.length + passCount} checks\n`);
  for (const f of failures) {
    console.error(`  ✗ ${f.description}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}
console.log(`wa-panel-join:verify passed — ${passCount} checks.`);
