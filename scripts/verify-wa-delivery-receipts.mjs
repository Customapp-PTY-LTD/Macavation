#!/usr/bin/env node
/**
 * wa-delivery-receipts:verify — regression guard for "show delivery receipts on the panel, and a
 * 'Test send to me' button":
 *   migrations/20260910090000_report_delivery_receipts.sql   (widened CHECK, status_updated_at,
 *                                                              report_record_delivery_status,
 *                                                              list_report_deliveries extended)
 *   migrations/20260825091000_daily_production_report.sql    (daily_report_already_sent —
 *                                                              must stay untouched by the widened
 *                                                              enum)
 *   migrations/20260908090000_period_report_senders.sql      (period_report_already_sent — same)
 *   supabase/functions/whatsapp-inbound/index.ts              (statuses[] loop — extended to also
 *                                                              call report_record_delivery_status)
 *   WebPortal/modules/sales-reports/js/report-whatsapp-history.js  (receipt indicator)
 *   WebPortal/modules/sales-reports/html/report_editor.html        ("Test send to me" control)
 *   WebPortal/modules/sales-reports/js/report_editor.js             (its handler)
 *
 * Follows the same `.ts`-is-never-evaluated discipline as verify-wa-panel-join.mjs /
 * verify-wa-optout.mjs for the edge-function half: whatsapp-inbound/index.ts is TypeScript, so
 * this script never evaluates it — every assertion against it is textual, against the real
 * source, and every failure names the file to fix. Pure fs reads, hand-rolled harness (no
 * dependency), no network — test:fleet must stay hermetic.
 *
 * WHAT ASSERTIONS 5 AND 5a SPECIFICALLY GUARD: this plan widens report_deliveries' status enum to
 * add 'delivered' and 'read'. The single easiest way for a later "simplify this" pass to silently
 * break idempotency is to notice daily_report_already_sent / period_report_already_sent only check
 * `status = 'sent'` and "helpfully" widen that to `status IN ('sent','delivered','read')` — which
 * looks harmless but is NOT: period_report_already_sent's `message_kind = 'template'` clause exists
 * specifically so a manual send sharing a report_instance_id cannot suppress the automatic
 * broadcast (migrations/20260908090000_period_report_senders.sql:165-170), and widening either
 * function is explicitly out of scope for this plan (see the new migration's own header comment on
 * the known trade-off this leaves). These assertions read the CURRENT, real definitions of both
 * functions — not memory of what they used to say.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_MIGRATION = 'migrations/20260910090000_report_delivery_receipts.sql';
const REL_DAILY_MIGRATION = 'migrations/20260825091000_daily_production_report.sql';
const REL_PERIOD_MIGRATION = 'migrations/20260908090000_period_report_senders.sql';
const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const REL_HISTORY_JS = 'WebPortal/modules/sales-reports/js/report-whatsapp-history.js';
const REL_EDITOR_HTML = 'WebPortal/modules/sales-reports/html/report_editor.html';
const REL_EDITOR_JS = 'WebPortal/modules/sales-reports/js/report_editor.js';

/** Normalise CRLF before any comparison — same reason as the sibling verifiers. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

const migrationSrc = readFile(REL_MIGRATION);
const dailyMigrationSrc = readFile(REL_DAILY_MIGRATION);
const periodMigrationSrc = readFile(REL_PERIOD_MIGRATION);
const inboundSrc = readFile(REL_INBOUND);
const historySrc = readFile(REL_HISTORY_JS);
const editorHtmlSrc = readFile(REL_EDITOR_HTML);
const editorJsSrc = readFile(REL_EDITOR_JS);

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
 * Walks from `declaration`'s first `(` or `{` to the matching close — copied from
 * verify-wa-panel-join.mjs's isolateByBraceDepth idiom (not imported: these verifiers are
 * deliberately standalone). Used here to isolate one CREATE FUNCTION body out of a whole
 * migration file, or one JS function body, so a check can never accidentally match a comment or a
 * different function that happens to share a substring.
 */
function isolateByBraceDepth(source, relPath, declaration, openChar, closeChar) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    fail(
      `${relPath}: could not find ${JSON.stringify(declaration)}. If it was renamed, update this ` +
        `verifier to match — do not delete the assertion.`
    );
  }
  const open = source.indexOf(openChar, start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  fail(`${relPath}: ${JSON.stringify(declaration)} body is not balanced — cannot verify it.`);
}

/** Slices from `declaration` up to the next top-level statement keyword, or EOF. Simpler and more
 *  robust than brace-matching for PL/pgSQL bodies, which use dollar-quoting ($fn$/$$) rather than
 *  braces — copied from the same "slice to next CREATE/REVOKE/GRANT" idiom several sibling
 *  migrations' own verifiers already rely on for SQL bodies. */
function sliceSqlBlock(source, relPath, declaration, stopMarkers) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    fail(`${relPath}: could not find ${JSON.stringify(declaration)}.`);
  }
  let end = source.length;
  for (const marker of stopMarkers) {
    const idx = source.indexOf(marker, start + declaration.length);
    if (idx !== -1 && idx < end) end = idx;
  }
  return source.slice(start, end);
}

// ================================================================================================
// 1. report_deliveries_status_check includes 'delivered' and 'read' IN ADDITION TO the original
//    three — not replacing them. This is the assertion the brief asks to be proven to bite: broken
//    and re-fixed below, with the exact failure message quoted in the final report.
// ================================================================================================

check("the new migration's report_deliveries_status_check keeps all five values, additive only", () => {
  const block = sliceSqlBlock(migrationSrc, REL_MIGRATION, 'ADD CONSTRAINT report_deliveries_status_check', [
    ';',
  ]);
  const required = ['pending', 'sent', 'failed', 'delivered', 'read'];
  for (const value of required) {
    if (!block.includes(`'${value}'`)) {
      fail(
        `${REL_MIGRATION}: report_deliveries_status_check must still include '${value}' — found ` +
          `block: ${JSON.stringify(block)}`
      );
    }
  }
  if (!migrationSrc.includes('DROP CONSTRAINT IF EXISTS report_deliveries_status_check')) {
    fail(`${REL_MIGRATION}: expected the widen to use DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT (house pattern).`);
  }
});

// ================================================================================================
// 2. report_record_delivery_status is SECURITY DEFINER, pins search_path, and is service_role only.
// ================================================================================================

check('report_record_delivery_status is SECURITY DEFINER with a pinned search_path', () => {
  const decl = migrationSrc.indexOf('CREATE OR REPLACE FUNCTION public.report_record_delivery_status');
  if (decl === -1) fail(`${REL_MIGRATION}: report_record_delivery_status is not defined.`);
  const header = migrationSrc.slice(decl, migrationSrc.indexOf('AS $fn$', decl));
  if (!/SECURITY DEFINER/.test(header)) {
    fail(`${REL_MIGRATION}: report_record_delivery_status must be SECURITY DEFINER.`);
  }
  if (!/SET search_path\s*=\s*public\b/.test(header)) {
    fail(`${REL_MIGRATION}: report_record_delivery_status must pin SET search_path = public.`);
  }
});

check('report_record_delivery_status is granted to service_role only', () => {
  if (!migrationSrc.includes('REVOKE ALL ON FUNCTION public.report_record_delivery_status(text, text) FROM PUBLIC, anon, authenticated')) {
    fail(`${REL_MIGRATION}: expected report_record_delivery_status revoked from PUBLIC, anon, authenticated.`);
  }
  if (!migrationSrc.includes('GRANT EXECUTE ON FUNCTION public.report_record_delivery_status(text, text) TO service_role')) {
    fail(`${REL_MIGRATION}: expected report_record_delivery_status granted to service_role.`);
  }
  // Negative check: it must never ALSO be granted to anon/authenticated anywhere in this file.
  const grantLines = migrationSrc
    .split('\n')
    .filter((l) => l.includes('report_record_delivery_status') && /GRANT EXECUTE/.test(l));
  for (const line of grantLines) {
    if (/\banon\b|\bauthenticated\b/.test(line) && !/REVOKE/.test(line)) {
      fail(`${REL_MIGRATION}: report_record_delivery_status must never be granted to anon/authenticated: "${line.trim()}"`);
    }
  }
});

// ================================================================================================
// 3. list_report_deliveries's definition in the new migration returns status_updated_at.
// ================================================================================================

check("list_report_deliveries's RETURNS TABLE in the new migration includes status_updated_at", () => {
  const block = sliceSqlBlock(migrationSrc, REL_MIGRATION, 'CREATE OR REPLACE FUNCTION public.list_report_deliveries', [
    'LANGUAGE plpgsql',
  ]);
  if (!/status_updated_at\s+timestamptz/.test(block)) {
    fail(`${REL_MIGRATION}: list_report_deliveries's RETURNS TABLE must declare status_updated_at timestamptz.`);
  }
});

check('list_report_deliveries actually SELECTs d.status_updated_at, not just declares it', () => {
  const fnBody = sliceSqlBlock(
    migrationSrc,
    REL_MIGRATION,
    'CREATE OR REPLACE FUNCTION public.list_report_deliveries',
    ['\nGRANT EXECUTE ON FUNCTION public.list_report_deliveries']
  );
  if (!fnBody.includes('d.status_updated_at')) {
    fail(`${REL_MIGRATION}: list_report_deliveries's body must SELECT d.status_updated_at.`);
  }
});

// ================================================================================================
// 4. whatsapp-inbound/index.ts's status loop calls BOTH chat_record_whatsapp_status AND
//    report_record_delivery_status. Isolated to the statuses[] loop specifically (not just
//    anywhere in the file), the same way verify-wa-panel-join.mjs isolates
//    processCommandForMessage, so a future edit that moves the call elsewhere still gets caught.
// ================================================================================================

check(
  'the statuses[] loop in whatsapp-inbound/index.ts calls chat_record_whatsapp_status and report_record_delivery_status, both inside the same for loop',
  () => {
    const loopStart = inboundSrc.indexOf('for (const st of statusArr)');
    if (loopStart === -1) {
      fail(`${REL_INBOUND}: could not find "for (const st of statusArr)" — has the statuses[] loop been renamed?`);
    }
    // Isolate the loop body by brace depth so a match cannot leak into code after the loop.
    const open = inboundSrc.indexOf('{', loopStart);
    let depth = 0;
    let loopBody = null;
    for (let i = open; i < inboundSrc.length; i++) {
      const c = inboundSrc[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          loopBody = inboundSrc.slice(loopStart, i + 1);
          break;
        }
      }
    }
    if (!loopBody) fail(`${REL_INBOUND}: the statuses[] loop body is not brace-balanced — cannot verify it.`);

    if (!loopBody.includes("sb.rpc('chat_record_whatsapp_status'")) {
      fail(`${REL_INBOUND}: the statuses[] loop no longer calls chat_record_whatsapp_status.`);
    }
    if (!loopBody.includes("sb.rpc('report_record_delivery_status'")) {
      fail(
        `${REL_INBOUND}: the statuses[] loop does not call report_record_delivery_status. This is the ` +
          `regression this check exists to catch — a future "clean up this loop" edit could easily ` +
          `remove what looks like a redundant second RPC call for the same status entry.`
      );
    }
    // p_wamid / p_status must be passed through, not hard-coded or dropped.
    if (!/report_record_delivery_status'\s*,\s*\{[\s\S]{0,120}?p_wamid:\s*wamid[\s\S]{0,120}?p_status:\s*status/.test(loopBody)) {
      fail(`${REL_INBOUND}: report_record_delivery_status must be called with { p_wamid: wamid, p_status: status }.`);
    }
  }
);

check('the report_record_delivery_status call is non-fatal — never sets schemaMissing, never re-breaks the outer loops over its own error', () => {
  const callIdx = inboundSrc.indexOf("sb.rpc('report_record_delivery_status'");
  if (callIdx === -1) fail(`${REL_INBOUND}: report_record_delivery_status call not found.`);
  // Look at the next ~40 lines of error-handling immediately following the call.
  const followingBlock = inboundSrc.slice(callIdx, callIdx + 1200);
  const errorHandlingEnd = followingBlock.indexOf('\n      }\n    }');
  const errorHandling = errorHandlingEnd === -1 ? followingBlock : followingBlock.slice(0, errorHandlingEnd);
  if (/schemaMissing\s*=\s*true/.test(errorHandling)) {
    fail(
      `${REL_INBOUND}: report_record_delivery_status's own error handling must never set ` +
        `schemaMissing = true — a missing migration for this NEW feature must not abort the ` +
        `pre-existing chat status handling for the rest of this batch.`
    );
  }
});

// ================================================================================================
// 5. daily_report_already_sent still keys on d.status = 'sent' — untouched by the widened enum.
//    Read fresh from migrations/20260825091000_daily_production_report.sql, not from memory.
// ================================================================================================

check("daily_report_already_sent (in its OWN migration file) still contains d.status = 'sent'", () => {
  const fnSrc = sliceSqlBlock(
    dailyMigrationSrc,
    REL_DAILY_MIGRATION,
    'CREATE OR REPLACE FUNCTION public.daily_report_already_sent',
    ['\n\n-- ====']
  );
  if (!fnSrc.includes("d.status = 'sent'")) {
    fail(
      `${REL_DAILY_MIGRATION}: daily_report_already_sent no longer contains "d.status = 'sent'". ` +
        `This plan's widened status enum (delivered/read) must NEVER be used to redefine what ` +
        `"already sent" means for the daily sender — see the new migration's header comment for ` +
        `why. Found instead: ${JSON.stringify(fnSrc.slice(0, 400))}`
    );
  }
  // And it must not have grown a widened IN(...) clause instead.
  if (/d\.status\s+IN\s*\(/i.test(fnSrc)) {
    fail(
      `${REL_DAILY_MIGRATION}: daily_report_already_sent must not check "d.status IN (...)" — it ` +
        `must key on status = 'sent' specifically, not on any status considered "successful".`
    );
  }
});

// ================================================================================================
// 5a. period_report_already_sent still keys on BOTH d.status = 'sent' AND
//     d.message_kind = 'template'. Read fresh from migrations/20260908090000_period_report_senders.sql.
// ================================================================================================

check(
  "period_report_already_sent (in its OWN migration file) still contains d.status = 'sent' AND d.message_kind = 'template'",
  () => {
    const fnSrc = sliceSqlBlock(
      periodMigrationSrc,
      REL_PERIOD_MIGRATION,
      'CREATE OR REPLACE FUNCTION public.period_report_already_sent',
      ['\n\nCOMMENT ON FUNCTION public.period_report_already_sent']
    );
    if (!fnSrc.includes("d.status = 'sent'")) {
      fail(
        `${REL_PERIOD_MIGRATION}: period_report_already_sent no longer contains "d.status = 'sent'". ` +
          `Found instead: ${JSON.stringify(fnSrc.slice(0, 400))}`
      );
    }
    if (!fnSrc.includes("d.message_kind = 'template'")) {
      fail(
        `${REL_PERIOD_MIGRATION}: period_report_already_sent no longer contains ` +
          `"d.message_kind = 'template'". This clause is NOT incidental — without it a manual send ` +
          `sharing the same report_instance_id would suppress the automatic broadcast to everyone ` +
          `else. This plan's widened status enum must not be the change that quietly drops it. ` +
          `Found instead: ${JSON.stringify(fnSrc.slice(0, 400))}`
      );
    }
    if (/d\.status\s+IN\s*\(/i.test(fnSrc)) {
      fail(`${REL_PERIOD_MIGRATION}: period_report_already_sent must not widen to "d.status IN (...)".`);
    }
  }
);

// ================================================================================================
// 6. A "Test send to me" control exists and its handler references the same send path
//    (dataFunctions.sendReportWhatsapp) an existing normal send already uses.
// ================================================================================================

check('report_editor.html has a "Test send to me" control', () => {
  if (!/id="reportEditorTestSendBtn"/.test(editorHtmlSrc)) {
    fail(`${REL_EDITOR_HTML}: expected a control with id="reportEditorTestSendBtn".`);
  }
  if (!/id="reportEditorTestSendBtn"[^>]*>[\s\S]{0,200}?Test send to me/i.test(editorHtmlSrc)) {
    fail(`${REL_EDITOR_HTML}: expected the reportEditorTestSendBtn control's visible text to read "Test send to me".`);
  }
});

check('report_editor.js wires #reportEditorTestSendBtn to a handler', () => {
  if (!/#reportEditorTestSendBtn['"]/.test(editorJsSrc)) {
    fail(`${REL_EDITOR_JS}: expected a binding on "#reportEditorTestSendBtn".`);
  }
  if (!editorJsSrc.includes('function handleTestSendToMe')) {
    fail(`${REL_EDITOR_JS}: expected a handleTestSendToMe function.`);
  }
});

check(
  'handleTestSendToMe calls dataFunctions.sendReportWhatsapp — the SAME wrapper "Send via WhatsApp" already uses — not a second, parallel call',
  () => {
    const fnBody = isolateByBraceDepth(editorJsSrc, REL_EDITOR_JS, 'function handleTestSendToMe', '{', '}');
    if (!fnBody.includes('dataFunctions.sendReportWhatsapp(')) {
      fail(
        `${REL_EDITOR_JS}: handleTestSendToMe must call dataFunctions.sendReportWhatsapp(...) — the ` +
          `same wrapper report-whatsapp-send.js's callSendEndpoint already calls. A new edge-function ` +
          `fetch or a differently-named RPC here would be a second, parallel send path (forbidden by ` +
          `contract 3).`
      );
    }
    // Must send to exactly the caller's own resolved number, via a `recipients` array — not the
    // full multi-source picker.
    if (!/recipients:\s*\[\s*\{\s*phone:\s*phone/.test(fnBody)) {
      fail(
        `${REL_EDITOR_JS}: handleTestSendToMe must call sendReportWhatsapp with recipients: [{ phone: ` +
          `<the caller's own number>, ... }] — a single fixed recipient, not the multi-select picker.`
      );
    }
  }
);

check('data-functions.js still defines sendReportWhatsapp calling the send-report-whatsapp edge function (unchanged contract)', () => {
  const dataFunctionsSrc = readFile('WebPortal/js/data-functions.js');
  if (!/sendReportWhatsapp:\s*async function/.test(dataFunctionsSrc)) {
    fail('WebPortal/js/data-functions.js: expected "sendReportWhatsapp: async function" to still exist.');
  }
  if (!dataFunctionsSrc.includes('/functions/v1/send-report-whatsapp')) {
    fail('WebPortal/js/data-functions.js: sendReportWhatsapp must still post to /functions/v1/send-report-whatsapp.');
  }
});

// ================================================================================================
// 7. Bonus coverage — the receipt indicator itself (report-whatsapp-history.js), and the button is
//    disabled-with-explanation when no phone is available (contract 3's "must not fail silently").
// ================================================================================================

check('report-whatsapp-history.js renders a receipt indicator for delivered/read using status_updated_at', () => {
  if (!historySrc.includes('isDelivered') || !historySrc.includes('isRead')) {
    fail(`${REL_HISTORY_JS}: expected isDelivered/isRead classification in _buildHistoryRow.`);
  }
  if (!historySrc.includes('statusUpdatedAt')) {
    fail(`${REL_HISTORY_JS}: expected _buildHistoryRow to surface status_updated_at (as statusUpdatedAt).`);
  }
  if (!historySrc.includes('historyRow.isDelivered') || !historySrc.includes('historyRow.isRead')) {
    fail(`${REL_HISTORY_JS}: expected buildRow to branch on historyRow.isDelivered / historyRow.isRead.`);
  }
});

check('a delivered/read row is never offered a Re-send control (isSent covers all three success states)', () => {
  if (!/isSent:\s*status === 'sent' \|\| isDelivered \|\| isRead/.test(historySrc)) {
    fail(
      `${REL_HISTORY_JS}: expected isSent to cover 'sent', 'delivered' and 'read' — otherwise a ` +
        `delivered/read row would show a "Re-send" button next to an already-successful delivery.`
    );
  }
});

check('report_editor.js disables Test send to me with an explanation when no phone is resolved (contract 3)', () => {
  if (!editorJsSrc.includes('function updateTestSendButtonState')) {
    fail(`${REL_EDITOR_JS}: expected an updateTestSendButtonState function.`);
  }
  const fnBody = isolateByBraceDepth(editorJsSrc, REL_EDITOR_JS, 'function updateTestSendButtonState', '{', '}');
  if (!/disabled['"]?,\s*true/.test(fnBody) || !fnBody.includes("attr('title'")) {
    fail(
      `${REL_EDITOR_JS}: updateTestSendButtonState must disable the button AND set an explanatory ` +
        `title when no phone is available — not silently leave it clickable to fail on submit.`
    );
  }
});

// ---- report -------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nwa-delivery-receipts:verify FAILED — ${failures.length} of ${failures.length + passCount} checks\n`);
  for (const f of failures) {
    console.error(`  ✗ ${f.description}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}
console.log(`wa-delivery-receipts:verify passed — ${passCount} checks.`);
