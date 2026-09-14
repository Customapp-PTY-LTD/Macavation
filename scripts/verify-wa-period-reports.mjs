#!/usr/bin/env node
/**
 * wa-period-reports:verify — regression guard for the weekly/monthly automatic WhatsApp senders:
 *   migrations/<ts>_period_report_senders.sql               (the three new RPCs)
 *   supabase/functions/send-period-report/index.ts           (the new edge function)
 *   scripts/wa-template-period-reports.mjs                   (the two new offline descriptors)
 *
 * Follows the same discipline as scripts/verify-wa-optout.mjs and
 * scripts/verify-wa-template-buttons.mjs: pure `fs` reads, a tiny check()/failures harness,
 * CRLF normalised on read, this script never evaluates a `.ts` file (`.ts` type annotations are
 * not valid JS), and the `isolateSqlFunction` `$fn$`-tag idiom for isolating one PL/pgSQL/SQL
 * function body out of a migration file. `scripts/wa-template-period-reports.mjs` and
 * `scripts/wa-template-daily-production.mjs` are both plain JS with no import beyond Node stdlib,
 * so both are safe to import directly for their named exports; every other file here is read as
 * text only.
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

const REL_MIGRATIONS_DIR = 'migrations';
const REL_SENDER = 'supabase/functions/send-period-report/index.ts';
const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const REL_PERIOD_DESCRIPTOR = 'scripts/wa-template-period-reports.mjs';
const REL_DAILY_DESCRIPTOR = 'scripts/wa-template-daily-production.mjs';

/** Normalise CRLF before any comparison — same reason as verify-wa-plumbing.mjs. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

/** Locates the (single) new migration by suffix, rather than hard-coding its timestamp. */
function findPeriodReportMigration() {
  const dir = path.join(ROOT, REL_MIGRATIONS_DIR);
  const matches = fs.readdirSync(dir).filter((f) => f.endsWith('_period_report_senders.sql'));
  if (matches.length === 0) {
    fail(
      `${REL_MIGRATIONS_DIR}/: no file matching *_period_report_senders.sql found. This plan's ` +
        `migration is missing.`
    );
  }
  if (matches.length > 1) {
    fail(
      `${REL_MIGRATIONS_DIR}/: expected exactly one *_period_report_senders.sql, found ` +
        `${matches.length}: ${matches.join(', ')}.`
    );
  }
  return `${REL_MIGRATIONS_DIR}/${matches[0]}`;
}

const REL_MIGRATION = findPeriodReportMigration();

const migrationSrc = readFile(REL_MIGRATION);
const senderSrc = readFile(REL_SENDER);
const inboundSrc = readFile(REL_INBOUND);
const periodDescriptorSrc = readFile(REL_PERIOD_DESCRIPTOR);

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
 * Isolates one `CREATE OR REPLACE FUNCTION ... AS $fn$ ... $fn$;` block from a migration file —
 * copied from scripts/verify-wa-optout.mjs's own `isolateSqlFunction`, same reasoning: PL/pgSQL
 * and SQL function bodies use BEGIN/END, not curly braces, and every function in this repo's
 * migrations uses the literal `$fn$` dollar-quote tag.
 */
function isolateSqlFunction(source, relPath, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    fail(
      `${relPath}: could not find ${JSON.stringify(declaration)}. If it was renamed, update this ` +
        `verifier to match — do not delete the assertion.`
    );
  }
  const bodyStart = source.indexOf('AS $fn$', start);
  if (bodyStart === -1) {
    fail(`${relPath}: could not find "AS $fn$" after ${JSON.stringify(declaration)}.`);
  }
  const bodyEnd = source.indexOf('$fn$;', bodyStart + 'AS $fn$'.length);
  if (bodyEnd === -1) {
    fail(`${relPath}: could not find the closing "$fn$;" after ${JSON.stringify(declaration)}.`);
  }
  return source.slice(start, bodyEnd + '$fn$;'.length);
}

/** Extracts the text between a start literal and the next occurrence of an end literal. */
function between(source, startLiteral, endLiteral, label) {
  const start = source.indexOf(startLiteral);
  if (start === -1) fail(`could not find start marker for ${label}: ${JSON.stringify(startLiteral)}`);
  const from = start + startLiteral.length;
  const end = source.indexOf(endLiteral, from);
  if (end === -1) fail(`could not find end marker for ${label}: ${JSON.stringify(endLiteral)}`);
  return source.slice(from, end);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ================================================================================================
// 0. Import both descriptor modules cleanly, with console.log silenced (each prints at module top
//    level). Safe: both are plain JS with no import beyond Node stdlib (checked textually below).
// ================================================================================================

let periodModule = { PERIOD_TEMPLATE_BUTTONS: [], TEMPLATE_WEEKLY: {}, TEMPLATE_MONTHLY: {} };
{
  const description = `${REL_PERIOD_DESCRIPTOR} imports cleanly with no environment configured`;
  const originalLog = console.log;
  console.log = () => {};
  try {
    periodModule = await import(pathToFileURL(path.join(ROOT, REL_PERIOD_DESCRIPTOR)).href);
    passCount++;
  } catch (err) {
    failures.push({ description, message: err && err.message ? err.message : String(err) });
  } finally {
    console.log = originalLog;
  }
}

let dailyModule = { TEMPLATE_BUTTONS: [] };
{
  const description = `${REL_DAILY_DESCRIPTOR} imports cleanly with no environment configured`;
  const originalLog = console.log;
  console.log = () => {};
  try {
    dailyModule = await import(pathToFileURL(path.join(ROOT, REL_DAILY_DESCRIPTOR)).href);
    passCount++;
  } catch (err) {
    failures.push({ description, message: err && err.message ? err.message : String(err) });
  } finally {
    console.log = originalLog;
  }
}

const PERIOD_TEMPLATE_BUTTONS = periodModule.PERIOD_TEMPLATE_BUTTONS ?? [];
const TEMPLATE_WEEKLY = periodModule.TEMPLATE_WEEKLY ?? {};
const TEMPLATE_MONTHLY = periodModule.TEMPLATE_MONTHLY ?? {};
const DAILY_TEMPLATE_BUTTONS = dailyModule.TEMPLATE_BUTTONS ?? [];

// ================================================================================================
// 1. The sender exists and references both period kinds.
// ================================================================================================

check("send-period-report/index.ts references both 'weekly' and 'monthly'", () => {
  assert.ok(senderSrc.includes("'weekly'"), `${REL_SENDER} must reference 'weekly'`);
  assert.ok(senderSrc.includes("'monthly'"), `${REL_SENDER} must reference 'monthly'`);
});

// ================================================================================================
// 2. It calls report_recipients_for_kind and NEVER report_daily_recipients — this function must
//    not silently start reading the daily roster.
// ================================================================================================

check('send-period-report/index.ts calls report_recipients_for_kind and never report_daily_recipients', () => {
  assert.ok(
    senderSrc.includes('report_recipients_for_kind'),
    `${REL_SENDER} must call report_recipients_for_kind`
  );
  assert.ok(
    !senderSrc.includes('report_daily_recipients'),
    `${REL_SENDER} must not reference report_daily_recipients — weekly/monthly must use their own ` +
      `roster, never the daily one`
  );
});

// ================================================================================================
// 3. period_report_already_sent is called, and BEFORE the first sendTemplate( call.
// ================================================================================================

check('period_report_already_sent is called before the first sendTemplate( call', () => {
  const idempIdx = senderSrc.indexOf('period_report_already_sent');
  const sendIdx = senderSrc.indexOf('sendTemplate(');
  assert.ok(idempIdx !== -1, `${REL_SENDER} must call period_report_already_sent`);
  assert.ok(sendIdx !== -1, `${REL_SENDER} must call sendTemplate(`);
  assert.ok(
    idempIdx < sendIdx,
    `period_report_already_sent (index ${idempIdx}) must be checked before the first sendTemplate( ` +
      `call (index ${sendIdx}) — otherwise an already-sent instance could be sent again`
  );
});

// ================================================================================================
// 4. Both new scalar RPCs are read directly from `data`, never through the TABLE-returning
//    rpcRows helper — a bare uuid/boolean would collapse to [] through rpcRows.
// ================================================================================================

check("latest_published_instance and period_report_already_sent are never routed through rpcRows(", () => {
  const forbidden = [
    "rpcRows(sb, 'latest_published_instance'",
    "rpcRows(sb, 'period_report_already_sent'",
  ];
  for (const needle of forbidden) {
    assert.ok(
      !senderSrc.includes(needle),
      `${REL_SENDER} must not contain ${JSON.stringify(needle)} — these are bare-scalar RPCs; ` +
        `rpcRows collapses both true and false (and any uuid) to the same [], silently disabling ` +
        `the idempotency guard`
    );
  }
});

check("latest_published_instance and period_report_already_sent are called directly via sb.rpc(", () => {
  assert.ok(
    senderSrc.includes("sb.rpc('latest_published_instance'"),
    `${REL_SENDER} must call sb.rpc('latest_published_instance', ...) directly`
  );
  assert.ok(
    senderSrc.includes("sb.rpc('period_report_already_sent'"),
    `${REL_SENDER} must call sb.rpc('period_report_already_sent', ...) directly`
  );
});

// ================================================================================================
// 5. dry_run support: the flag is named `dry_run`, the dryRun return block sits after the
//    report_recipients_for_kind call and before both the 'no_recipients' literal and the first
//    sendTemplate( call, and its text mentions both params and recipients.
// ================================================================================================

check("dry_run is supported and its return block is correctly ordered", () => {
  assert.ok(senderSrc.includes('dry_run'), `${REL_SENDER} must reference the dry_run flag`);
  const recipientsIdx = senderSrc.indexOf('report_recipients_for_kind');
  const noRecipientsIdx = senderSrc.indexOf("'no_recipients'");
  const sendIdx = senderSrc.indexOf('sendTemplate(');
  const dryRunBlockIdx = senderSrc.indexOf('if (dryRun)');
  assert.ok(recipientsIdx !== -1, `${REL_SENDER} must call report_recipients_for_kind`);
  assert.ok(noRecipientsIdx !== -1, `${REL_SENDER} must contain the literal 'no_recipients'`);
  assert.ok(sendIdx !== -1, `${REL_SENDER} must call sendTemplate(`);
  assert.ok(dryRunBlockIdx !== -1, `${REL_SENDER} must contain an "if (dryRun)" block`);
  assert.ok(
    dryRunBlockIdx > recipientsIdx,
    `the dry_run return block (index ${dryRunBlockIdx}) must come AFTER report_recipients_for_kind ` +
      `is called (index ${recipientsIdx}) — dry_run must prove the roster it promises actually exists`
  );
  assert.ok(
    dryRunBlockIdx < noRecipientsIdx,
    `the dry_run return block (index ${dryRunBlockIdx}) must come BEFORE the 'no_recipients' ` +
      `literal (index ${noRecipientsIdx}) — dry_run must be reachable even with an empty roster`
  );
  assert.ok(
    dryRunBlockIdx < sendIdx,
    `the dry_run return block (index ${dryRunBlockIdx}) must come BEFORE the first sendTemplate( ` +
      `call (index ${sendIdx})`
  );
  const dryRunBlock = between(senderSrc, 'if (dryRun) {', '\n  }', 'the dry_run block');
  assert.ok(dryRunBlock.includes('params'), `the dry_run return block must mention params`);
  assert.ok(dryRunBlock.includes('recipients'), `the dry_run return block must mention recipients`);
});

// ================================================================================================
// 6. TEMPLATE_WEEKLY_NAME / TEMPLATE_MONTHLY_NAME in the sender match the descriptor names —
//    the wa-flow-03 drift risk, repeated for two more names.
// ================================================================================================

check('TEMPLATE_WEEKLY_NAME in the sender equals TEMPLATE_WEEKLY.name in the descriptor', () => {
  const m = senderSrc.match(/const TEMPLATE_WEEKLY_NAME\s*=\s*'([^']+)'/);
  assert.ok(m, `could not find "const TEMPLATE_WEEKLY_NAME = '...'" in ${REL_SENDER}`);
  assert.equal(
    TEMPLATE_WEEKLY.name,
    m[1],
    `TEMPLATE_WEEKLY.name (${JSON.stringify(TEMPLATE_WEEKLY.name)}) must equal TEMPLATE_WEEKLY_NAME ` +
      `in ${REL_SENDER} (${JSON.stringify(m[1])})`
  );
});

check('TEMPLATE_MONTHLY_NAME in the sender equals TEMPLATE_MONTHLY.name in the descriptor', () => {
  const m = senderSrc.match(/const TEMPLATE_MONTHLY_NAME\s*=\s*'([^']+)'/);
  assert.ok(m, `could not find "const TEMPLATE_MONTHLY_NAME = '...'" in ${REL_SENDER}`);
  assert.equal(
    TEMPLATE_MONTHLY.name,
    m[1],
    `TEMPLATE_MONTHLY.name (${JSON.stringify(TEMPLATE_MONTHLY.name)}) must equal TEMPLATE_MONTHLY_NAME ` +
      `in ${REL_SENDER} (${JSON.stringify(m[1])})`
  );
});

// ================================================================================================
// 7. Button labels/order are read from the daily descriptor, never hard-coded here — a later
//    change to the daily labels is caught everywhere at once.
// ================================================================================================

check('PERIOD_TEMPLATE_BUTTONS deep-equals the daily descriptor TEMPLATE_BUTTONS', () => {
  assert.deepEqual(
    PERIOD_TEMPLATE_BUTTONS,
    DAILY_TEMPLATE_BUTTONS,
    `${REL_PERIOD_DESCRIPTOR}'s PERIOD_TEMPLATE_BUTTONS must deep-equal ${REL_DAILY_DESCRIPTOR}'s ` +
      `TEMPLATE_BUTTONS`
  );
});

check('TEMPLATE_WEEKLY.buttons and TEMPLATE_MONTHLY.buttons both deep-equal PERIOD_TEMPLATE_BUTTONS', () => {
  assert.deepEqual(TEMPLATE_WEEKLY.buttons, PERIOD_TEMPLATE_BUTTONS, 'TEMPLATE_WEEKLY.buttons mismatch');
  assert.deepEqual(TEMPLATE_MONTHLY.buttons, PERIOD_TEMPLATE_BUTTONS, 'TEMPLATE_MONTHLY.buttons mismatch');
});

// ================================================================================================
// 8. The period descriptor is inert: no network call, no credential, no submission logic.
// ================================================================================================

check(`${REL_PERIOD_DESCRIPTOR} makes no network call and reads no credential`, () => {
  const forbidden = ['fetch(', 'process.env', 'http://', 'https://', '.supabase.co', 'crk_', 'require('];
  for (const needle of forbidden) {
    assert.ok(
      !periodDescriptorSrc.includes(needle),
      `${REL_PERIOD_DESCRIPTOR} contains ${JSON.stringify(needle)} — this repo has no template-` +
        `submission client and one must not be added here; this file is a definition and a printer only`
    );
  }
});

// ================================================================================================
// 9. Each new template body carries {{1}} and {{2}} exactly once each, and no {{3}} — and
//    buildPeriodTemplateParams references only period_label and published_at.
// ================================================================================================

for (const [label, tpl] of [
  ['TEMPLATE_WEEKLY', TEMPLATE_WEEKLY],
  ['TEMPLATE_MONTHLY', TEMPLATE_MONTHLY],
]) {
  check(`${label}.body contains {{1}} and {{2}} each exactly once, and no {{3}}`, () => {
    for (let i = 1; i <= 2; i++) {
      const needle = `{{${i}}}`;
      const count = (tpl.body ?? '').split(needle).length - 1;
      assert.equal(count, 1, `expected ${JSON.stringify(needle)} to appear exactly once in ${label}.body, found ${count}`);
    }
    assert.ok(!(tpl.body ?? '').includes('{{3}}'), `${label}.body must not contain {{3}} — only 2 parameters are built`);
  });
}

check('buildPeriodTemplateParams references period_label and published_at, and nothing else', () => {
  const body = between(senderSrc, 'function buildPeriodTemplateParams(', '\n}', 'buildPeriodTemplateParams');
  assert.ok(body.includes('period_label'), 'buildPeriodTemplateParams must reference payload.period_label');
  assert.ok(body.includes('published_at'), 'buildPeriodTemplateParams must reference payload.published_at');
  assert.ok(
    !body.includes('executive_summary'),
    'buildPeriodTemplateParams must not reference executive_summary — contract 4 fixes the two ' +
      'parameters to period_label and published_at only'
  );
  assert.ok(
    !body.includes('sections'),
    'buildPeriodTemplateParams must not reference sections — contract 4 fixes the two parameters ' +
      'to period_label and published_at only'
  );
});

// ================================================================================================
// 10. sanitizeParam contains no \s (a monthly period_label is blank-padded), and the sender
//     contains no hand-written phone normaliser (an eighth copy would trip
//     verify-report-whatsapp-parity.mjs's sweep).
// ================================================================================================

check('sanitizeParam in the sender never uses \\s', () => {
  const body = between(senderSrc, 'function sanitizeParam(', '\n}', 'sanitizeParam');
  assert.ok(
    !body.includes('\\s'),
    'sanitizeParam must not use \\s — a monthly period_label (report_period_label\'s TO_CHAR(..., ' +
      "'Month YYYY')) is blank-padded to 9 characters, a real run of regular spaces this function " +
      'must collapse via explicit characters only'
  );
});

check('send-period-report/index.ts contains no hand-written phone normaliser', () => {
  assert.ok(
    !senderSrc.includes('replace(/\\D/g'),
    `${REL_SENDER} must not contain a hand-written phone normaliser — the phone from ` +
      `report_recipients_for_kind is already normalised and must be passed straight through`
  );
});

// ================================================================================================
// 11. Each of the three new RPCs is SECURITY DEFINER, pins search_path, and is service_role only.
// ================================================================================================

for (const [fnDecl, fnSig] of [
  [
    'CREATE OR REPLACE FUNCTION public.report_recipients_for_kind(p_kind text)',
    'public.report_recipients_for_kind(text)',
  ],
  [
    'CREATE OR REPLACE FUNCTION public.latest_published_instance(p_period_type text)',
    'public.latest_published_instance(text)',
  ],
  [
    'CREATE OR REPLACE FUNCTION public.period_report_already_sent(p_report_instance_id uuid)',
    'public.period_report_already_sent(uuid)',
  ],
]) {
  check(`${fnSig} is SECURITY DEFINER with a pinned search_path`, () => {
    const fnBlock = isolateSqlFunction(migrationSrc, REL_MIGRATION, fnDecl);
    const header = fnBlock.slice(0, fnBlock.indexOf('AS $fn$'));
    assert.ok(/SECURITY DEFINER/.test(header), `${fnSig} must be SECURITY DEFINER.`);
    assert.ok(/SET search_path\s*=\s*public/.test(header), `${fnSig} must pin SET search_path = public.`);
  });

  check(`${fnSig} is granted to service_role and NOT to anon/authenticated`, () => {
    const revokeRe = new RegExp(`REVOKE ALL ON FUNCTION ${escapeRe(fnSig)} FROM PUBLIC, anon, authenticated;`);
    const grantRe = new RegExp(`GRANT EXECUTE ON FUNCTION ${escapeRe(fnSig)} TO service_role;`);
    assert.ok(
      revokeRe.test(migrationSrc),
      `${REL_MIGRATION}: missing "REVOKE ALL ON FUNCTION ${fnSig} FROM PUBLIC, anon, authenticated;"`
    );
    assert.ok(grantRe.test(migrationSrc), `${REL_MIGRATION}: missing "GRANT EXECUTE ON FUNCTION ${fnSig} TO service_role;"`);
  });
}

// ================================================================================================
// 12. latest_published_instance does NOT call get_report_current_period (contract 2's fix), and
//     does use the two-period-window building blocks.
// ================================================================================================

check(
  'latest_published_instance does not call get_report_current_period, and uses report_normalise_period_start / report_sast_today / status = published',
  () => {
    const body = isolateSqlFunction(
      migrationSrc,
      REL_MIGRATION,
      'CREATE OR REPLACE FUNCTION public.latest_published_instance(p_period_type text)'
    );
    assert.ok(
      !body.includes('get_report_current_period'),
      "latest_published_instance must not call get_report_current_period — that function resolves " +
        "the period containing TODAY, and pinning to it would miss an instance published after its " +
        "own period ended (the normal case near a period boundary)"
    );
    for (const needle of ['report_normalise_period_start', 'report_sast_today', "ri.status = 'published'"]) {
      assert.ok(body.includes(needle), `latest_published_instance must contain ${JSON.stringify(needle)}`);
    }
  }
);

// ================================================================================================
// 13. period_report_already_sent keys on report_instance_id, status = sent, AND
//     message_kind = template (contract 6).
// ================================================================================================

check('period_report_already_sent checks report_instance_id, sent status, and message_kind = template', () => {
  const body = isolateSqlFunction(
    migrationSrc,
    REL_MIGRATION,
    'CREATE OR REPLACE FUNCTION public.period_report_already_sent(p_report_instance_id uuid)'
  );
  for (const needle of ['report_instance_id', "d.status = 'sent'", "d.message_kind = 'template'"]) {
    assert.ok(body.includes(needle), `period_report_already_sent must contain ${JSON.stringify(needle)}`);
  }
});

// ================================================================================================
// 14. report_recipients_for_kind keeps every clause report_daily_recipients has, minus the
//     literal 'daily'.
// ================================================================================================

check(
  "report_recipients_for_kind keeps the opt-out/pause/active/phone-normalisation/ordering clauses and never hardcodes 'daily'",
  () => {
    const body = isolateSqlFunction(
      migrationSrc,
      REL_MIGRATION,
      'CREATE OR REPLACE FUNCTION public.report_recipients_for_kind(p_kind text)'
    );
    const must = [
      'rr.opted_out_at IS NULL',
      'rs.muted_until IS NULL',
      'public.report_sast_today()',
      'rr.is_active',
      'rs.is_active',
      'public.report_normalize_wa_phone',
      'ORDER BY rr.display_name',
    ];
    for (const needle of must) {
      assert.ok(body.includes(needle), `report_recipients_for_kind must contain ${JSON.stringify(needle)}`);
    }
    assert.ok(
      !body.includes("'daily'"),
      "report_recipients_for_kind must not contain the literal 'daily' — it must never fall back " +
        "onto the daily roster"
    );
  }
);

// ================================================================================================
// 15. whatsapp-inbound/index.ts still contains exactly the two TEMPLATE_BUTTON_ROUTES keys this
//     plan relies on, and no third — this plan adds no route.
// ================================================================================================

check("whatsapp-inbound/index.ts's TEMPLATE_BUTTON_ROUTES has exactly the keys 'view report' and menu", () => {
  const body = between(inboundSrc, 'const TEMPLATE_BUTTON_ROUTES', '\n};', 'TEMPLATE_BUTTON_ROUTES');
  const re = /^\s*(?:'([^']+)'|([a-zA-Z0-9_]+))\s*:\s*\{/gm;
  const keys = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    keys.push((m[1] ?? m[2]).toLowerCase());
  }
  assert.deepEqual(
    keys.sort(),
    ['menu', 'view report'].sort(),
    `expected TEMPLATE_BUTTON_ROUTES to have exactly the keys 'view report' and 'menu', found ${JSON.stringify(keys)} — ` +
      `this plan adds no new route; a weekly/monthly button tap reuses the existing daily route`
  );
});

// ---- report -------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nwa-period-reports:verify FAILED — ${failures.length} of ${failures.length + passCount} checks\n`);
  for (const f of failures) {
    console.error(`  ✗ ${f.description}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}
console.log(`wa-period-reports:verify passed — ${passCount} checks (migration: ${REL_MIGRATION})`);
