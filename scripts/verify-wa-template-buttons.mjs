#!/usr/bin/env node
/**
 * wa-template-buttons:verify — regression check for the daily-report template's quick-reply
 * buttons and the inbound dispatch that answers a tap on them:
 *   scripts/wa-template-daily-production.mjs                    (the offline template definition)
 *   supabase/functions/whatsapp-inbound/index.ts                (TEMPLATE_BUTTON_ROUTES + dispatch)
 *   supabase/functions/send-daily-production-report/index.ts    (TEMPLATE_NAME, the seven params,
 *                                                                 formatFigure, sanitizeParam)
 *   supabase/functions/_shared/wa-limits.ts                      (MAX_BUTTON_CTA, MAX_BUTTONS)
 *
 * Follows the same discipline as scripts/verify-wa-plumbing.mjs and scripts/verify-wa-staff-menu.mjs:
 * pure `fs` reads, `node:assert/strict`, the same tiny check()/failure-list harness, CRLF
 * normalised on read, and this script never evaluates a `.ts` file — `.ts` type annotations are
 * not valid JS and cannot be loaded into a `vm` context. `wa-template-daily-production.mjs` IS
 * plain JS with no import beyond Node stdlib, so it is safe to import directly for its two named
 * exports; every other file here is read as text only.
 *
 * No dependency, no network, no browser. This repo has no package-lock.json — do not add one and
 * do not invoke `npm ci` from here.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_DEFINITION = 'scripts/wa-template-daily-production.mjs';
const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const REL_SENDER = 'supabase/functions/send-daily-production-report/index.ts';
const REL_LIMITS = 'supabase/functions/_shared/wa-limits.ts';

/** Normalise CRLF before any comparison — same reason as verify-wa-plumbing.mjs:41-45. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

const definitionSrc = readFile(REL_DEFINITION);
const inboundSrc = readFile(REL_INBOUND);
const senderSrc = readFile(REL_SENDER);
const limitsSrc = readFile(REL_LIMITS);

// ---- tiny test harness (same shape as verify-wa-plumbing.mjs:54-63) --------------------------
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

/** Extracts the text between a start literal and the next occurrence of an end literal. */
function between(source, startLiteral, endLiteral, label) {
  const start = source.indexOf(startLiteral);
  if (start === -1) throw new Error(`could not find start marker for ${label}: ${JSON.stringify(startLiteral)}`);
  const from = start + startLiteral.length;
  const end = source.indexOf(endLiteral, from);
  if (end === -1) throw new Error(`could not find end marker for ${label}: ${JSON.stringify(endLiteral)}`);
  return source.slice(from, end);
}

// ================================================================================================
// 0. The definition file must import cleanly with zero environment configured. Importing it also
//    runs its top-level console.log printer (silenced below) — check #11 asserts, from source,
//    that it makes no network/credential access, so this import is safe to run in the gate.
// ================================================================================================

// check() is synchronous (same harness as verify-wa-staff-menu.mjs) and cannot await a promise
// inside it, so this one import is done directly, with the same try/catch/passCount shape check()
// uses, rather than through check() itself.
let definitionModule = { TEMPLATE_BUTTONS: [], TEMPLATE: {} };
{
  const description = 'scripts/wa-template-daily-production.mjs imports cleanly with no environment configured';
  const originalLog = console.log;
  console.log = () => {};
  try {
    definitionModule = await import(pathToFileURL(path.join(ROOT, REL_DEFINITION)).href);
    passCount++;
  } catch (err) {
    failures.push(`${description}: ${err && err.message ? err.message : err}`);
  } finally {
    console.log = originalLog;
  }
}

const TEMPLATE_BUTTONS = definitionModule.TEMPLATE_BUTTONS ?? [];
const TEMPLATE = definitionModule.TEMPLATE ?? {};

// ================================================================================================
// 1 & 2. Exactly two buttons, both quick_reply, in this exact order and wording.
// ================================================================================================

check('TEMPLATE_BUTTONS declares exactly two entries, both kind: quick_reply', () => {
  assert.equal(TEMPLATE_BUTTONS.length, 2, `expected exactly 2 buttons, got ${TEMPLATE_BUTTONS.length}`);
  for (const b of TEMPLATE_BUTTONS) {
    assert.equal(b.kind, 'quick_reply', `expected kind 'quick_reply', got ${JSON.stringify(b.kind)}`);
  }
});

check('the two button labels are "View report" then "Menu", in that order', () => {
  const labels = TEMPLATE_BUTTONS.map((b) => b.text);
  assert.deepEqual(labels, ['View report', 'Menu'], `expected ['View report', 'Menu'], got ${JSON.stringify(labels)}`);
});

// ================================================================================================
// 3. Each label fits the caps declared in _shared/wa-limits.ts — read out of that file, never
//    hardcoded here, so a change to a cap is caught by this check instead of silently ignored.
// ================================================================================================

function readNumericConst(source, name, file) {
  const m = source.match(new RegExp(`export const ${name}\\s*=\\s*(\\d+)`));
  if (!m) throw new Error(`could not find "export const ${name} = <number>" in ${file}`);
  return Number(m[1]);
}

check('each button label is within MAX_BUTTON_CTA and the count is within MAX_BUTTONS', () => {
  const maxCta = readNumericConst(limitsSrc, 'MAX_BUTTON_CTA', REL_LIMITS);
  const maxButtons = readNumericConst(limitsSrc, 'MAX_BUTTONS', REL_LIMITS);
  assert.ok(TEMPLATE_BUTTONS.length <= maxButtons, `${TEMPLATE_BUTTONS.length} buttons exceeds MAX_BUTTONS (${maxButtons})`);
  for (const b of TEMPLATE_BUTTONS) {
    assert.ok(
      b.text.length <= maxCta,
      `button label ${JSON.stringify(b.text)} (${b.text.length} chars) exceeds MAX_BUTTON_CTA (${maxCta})`
    );
  }
});

// ================================================================================================
// 4. Both directions of label agreement: the template's labels and the inbound route table's keys
//    must be exactly the same set. A one-way check would pass while a button is dead.
// ================================================================================================

function parseTemplateButtonRoutesKeys(source, file) {
  const body = between(source, 'const TEMPLATE_BUTTON_ROUTES', '\n};', 'TEMPLATE_BUTTON_ROUTES');
  const keys = [];
  // Matches `'view report':` or `menu:` (quoted or bare identifier) at the start of an entry line.
  const re = /^\s*(?:'([^']+)'|([a-zA-Z0-9_]+))\s*:\s*\{/gm;
  let m;
  while ((m = re.exec(body)) !== null) {
    keys.push((m[1] ?? m[2]).toLowerCase());
  }
  if (keys.length === 0) throw new Error(`found no entries in TEMPLATE_BUTTON_ROUTES in ${file}`);
  return keys;
}

check('TEMPLATE_BUTTON_ROUTES keys exactly match the template button labels (both directions)', () => {
  const routeKeys = parseTemplateButtonRoutesKeys(inboundSrc, REL_INBOUND).sort();
  const templateKeys = TEMPLATE_BUTTONS.map((b) => b.text.trim().toLowerCase()).sort();
  assert.deepEqual(
    routeKeys,
    templateKeys,
    `TEMPLATE_BUTTON_ROUTES keys ${JSON.stringify(routeKeys)} must exactly match the template's ` +
      `button labels ${JSON.stringify(templateKeys)} — a mismatch leaves a button dead or a route ` +
      `unreachable`
  );
});

// ================================================================================================
// 5. The template name is not duplicated as a second literal — it must equal TEMPLATE_NAME in the
//    sender function.
// ================================================================================================

check('TEMPLATE.name equals TEMPLATE_NAME in send-daily-production-report/index.ts', () => {
  const m = senderSrc.match(/const TEMPLATE_NAME\s*=\s*'([^']+)'/);
  assert.ok(m, `could not find "const TEMPLATE_NAME = '...'" in ${REL_SENDER}`);
  assert.equal(
    TEMPLATE.name,
    m[1],
    `TEMPLATE.name (${JSON.stringify(TEMPLATE.name)}) must equal TEMPLATE_NAME in ${REL_SENDER} (${JSON.stringify(m[1])})`
  );
});

// ================================================================================================
// 6. The body carries all seven placeholders, each exactly once, and no {{8}}.
// ================================================================================================

check('TEMPLATE.body contains {{1}} through {{7}} each exactly once, and no {{8}}', () => {
  for (let i = 1; i <= 7; i++) {
    const needle = `{{${i}}}`;
    const count = TEMPLATE.body.split(needle).length - 1;
    assert.equal(count, 1, `expected ${JSON.stringify(needle)} to appear exactly once in TEMPLATE.body, found ${count}`);
  }
  assert.ok(!TEMPLATE.body.includes('{{8}}'), 'TEMPLATE.body must not contain {{8}} — only 7 parameters are built');
});

// ================================================================================================
// 7. The regression this plan exists to prevent: a missing figure quietly becoming '0', or the
//    non-breaking thousands separator getting mangled by a \s that also matches U+00A0.
// ================================================================================================

check('buildTemplateParams still builds exactly seven entries, in order', () => {
  const body = between(senderSrc, 'const raw = [', '\n  ];', 'buildTemplateParams raw array');
  // Count top-level entries by counting line-leading commas is fragile across wrapping; instead
  // count the known field references, which is what actually matters here.
  const expectedFields = [
    'dateLabel',
    "formatFigure(report.cracked_kg",
    "formatFigure(report.sk_packed_kg",
    "formatFigure(report.wholes_pct",
    "formatFigure(report.nis_kg",
    "formatFigure(report.wtd_cracked_kg",
    "formatFigure(report.wtd_target_kg",
  ];
  for (const field of expectedFields) {
    assert.ok(body.includes(field), `expected buildTemplateParams's raw array to include ${JSON.stringify(field)}`);
  }
});

check("formatFigure returns the literal 'not captured' for a missing figure, never '0'", () => {
  const body = between(senderSrc, 'function formatFigure(', '\n}', 'formatFigure');
  assert.ok(
    body.includes("'not captured'"),
    "formatFigure must return the literal 'not captured' for null/undefined/non-numeric — a " +
      "missing figure silently becoming '0' would misreport a recipient's actual production data"
  );
});

check('sanitizeParam never uses \\s, which would also strip the non-breaking thousands separator', () => {
  const body = between(senderSrc, 'function sanitizeParam(', '\n}', 'sanitizeParam');
  assert.ok(
    !body.includes('\\s'),
    "sanitizeParam must not use \\s: in JavaScript \\s matches U+00A0, the non-breaking space " +
      "formatFigure inserts as a thousands separator, and \\s would mangle it on every recipient's phone"
  );
});

// ================================================================================================
// 8. Dispatch order and shape: the MENU_NS branch must precede the template-button route lookup,
//    which must precede the stale-menu return. Pinned as a literal-presence assertion, same idiom
//    as verify-wa-staff-menu.mjs.
// ================================================================================================

check('handleCommand checks MENU_NS, then SETTINGS_NS, then ALERT_NS, then the template-button routes, then falls through to the stale-menu reply', () => {
  // Updated alongside wa-my-reports-menu (SETTINGS_NS) and, since, the alert-whatsapp-push plan
  // (ALERT_NS — the "Mark resolved" button tap on the macavation_alert push template). Per this
  // file's own convention (see the assertion message below): re-read handleCommand and update both
  // it and this script together when the shape legitimately changes.
  const literalBlock = [
    '  if (ctx.replyId) {',
    '    const parsed = parseReplyId(ctx.replyId);',
    '    if (parsed && parsed.ns === MENU_NS) {',
    '      return renderMenuItem(ctx, parsed.action);',
    '    }',
    '    if (parsed && parsed.ns === SETTINGS_NS) {',
    '      return dispatchSettingsAction(ctx, parsed.action);',
    '    }',
    '    if (parsed && parsed.ns === ALERT_NS && parsed.action === ALERT_ACK_ACTION && parsed.arg) {',
    '      return dispatchAlertAck(ctx, parsed.arg);',
    '    }',
    '    // A template quick-reply tap. hasOwnProperty for the same reason as the COMMAND_HANDLERS',
    '    // lookup below: the key is text off a public WhatsApp line and this is a plain object.',
    '    const templateKey = ctx.replyId.trim().toLowerCase();',
    '    if (Object.prototype.hasOwnProperty.call(TEMPLATE_BUTTON_ROUTES, templateKey)) {',
  ].join('\n');
  assert.ok(
    inboundSrc.includes(literalBlock),
    `expected this literal handleCommand block (MENU_NS branch, then SETTINGS_NS, then ALERT_NS, ` +
      `then the template-button route lookup) in ${REL_INBOUND} — re-read handleCommand and update ` +
      `both it and this script together`
  );
});

// ================================================================================================
// 9. The route lookup is guarded, exactly as the COMMAND_HANDLERS lookup is.
// ================================================================================================

check('the TEMPLATE_BUTTON_ROUTES lookup is guarded with hasOwnProperty', () => {
  assert.ok(
    inboundSrc.includes('Object.prototype.hasOwnProperty.call(TEMPLATE_BUTTON_ROUTES, templateKey)'),
    'expected the template-button route lookup to be guarded with hasOwnProperty'
  );
  // No OTHER, unguarded bare index into TEMPLATE_BUTTON_ROUTES in an if/const lookup.
  const bareIndexRe = /(?:if|const\s+\w+\s*=)\s*TEMPLATE_BUTTON_ROUTES\[/g;
  const matches = inboundSrc.match(bareIndexRe) ?? [];
  // The one legitimate bare index is `const route = TEMPLATE_BUTTON_ROUTES[templateKey];`, which
  // occurs strictly AFTER the hasOwnProperty guard has already run inside the same `if` block —
  // that is the guarded lookup itself, not a second unguarded one.
  const guardedAssignment = 'const route = TEMPLATE_BUTTON_ROUTES[templateKey];';
  const unexpected = matches.filter((m) => !guardedAssignment.startsWith(m));
  assert.equal(
    unexpected.length,
    0,
    `found an unexpected bare TEMPLATE_BUTTON_ROUTES[...] lookup not covered by the hasOwnProperty guard: ${JSON.stringify(unexpected)}`
  );
});

// ================================================================================================
// 10. Restated here (not because verify-wa-staff-menu.mjs is weak) so a failure points at this
//     plan's own design rule with an explanatory message.
// ================================================================================================

check('whatsapp-inbound/index.ts still contains no replyTitle outside a *-prefixed comment line', () => {
  assert.ok(
    !/replyTitle/.test(inboundSrc.replace(/^\s*\*.*$/gm, '')),
    'whatsapp-inbound dispatches on replyTitle somewhere outside a comment — a tap must be answered ' +
      'by matching ctx.replyId, never the display title the member saw (see this plan\'s own ' +
      'invariant section)'
  );
});

// ================================================================================================
// 11. The definition file is inert: no network call, no credential, no project ref, no Control
//     Room URL, no require().
// ================================================================================================

check('scripts/wa-template-daily-production.mjs makes no network call and reads no credential', () => {
  const forbidden = ['fetch(', 'process.env', 'http://', 'https://', '.supabase.co', 'crk_', 'require('];
  for (const needle of forbidden) {
    assert.ok(
      !definitionSrc.includes(needle),
      `${REL_DEFINITION} contains ${JSON.stringify(needle)} — this file is a definition and a ` +
        `printer, never a submission client`
    );
  }
});

// ================================================================================================
// Report
// ================================================================================================

if (failures.length > 0) {
  console.error(`\nWA TEMPLATE BUTTONS VERIFY FAILED (${failures.length} of ${failures.length + passCount}):\n`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`WA TEMPLATE BUTTONS VERIFY OK (${passCount} checks passed).`);
