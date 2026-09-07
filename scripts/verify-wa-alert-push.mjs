#!/usr/bin/env node
/**
 * wa-alert-push:verify — regression guard for the WhatsApp dashboard-alert push:
 * migrations/<ts>_alert_whatsapp_push.sql, supabase/functions/send-alert-whatsapp/index.ts, the
 * "Mark resolved" button-tap dispatch added to supabase/functions/whatsapp-inbound/index.ts, and
 * scripts/wa-template-alert-push.mjs.
 *
 * This CANNOT run against a live database — it has no network access and no database credential.
 * It verifies the MIGRATION FILE'S SHAPE and the .ts SOURCE TEXT only, same candour
 * scripts/verify-wa-report-schedule.mjs states about its own limits.
 *
 * Same discipline as every sibling verifier: pure `fs` reads, CRLF normalised on read, a tiny
 * check()/failures harness, no `.ts` file ever evaluated (structural/textual assertions only, per
 * scripts/verify-wa-plumbing.mjs's own header on why `.ts` is never loaded into a vm context), no
 * network, no database.
 *
 * No dependency, no package-lock.json (this repo has none — do not add one), no `npm ci` here.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** Normalise CRLF before any comparison — same reason as every sibling verifier. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

/** Locates the (single) new migration by suffix, rather than hard-coding its timestamp. */
function findAlertPushMigration() {
  const dir = path.join(ROOT, 'migrations');
  const matches = fs.readdirSync(dir).filter((f) => f.endsWith('_alert_whatsapp_push.sql'));
  if (matches.length === 0) {
    fail('migrations/: no file matching *_alert_whatsapp_push.sql found. This plan\'s migration is missing.');
  }
  if (matches.length > 1) {
    fail(`migrations/: expected exactly one *_alert_whatsapp_push.sql, found ${matches.length}: ${matches.join(', ')}.`);
  }
  return `migrations/${matches[0]}`;
}

const REL_MIGRATION = findAlertPushMigration();
const migrationSrc = readFile(REL_MIGRATION);

const REL_INBOUND = 'supabase/functions/whatsapp-inbound/index.ts';
const inboundSrc = readFile(REL_INBOUND);

const REL_SENDER = 'supabase/functions/send-alert-whatsapp/index.ts';
const senderSrc = readFile(REL_SENDER);

const REL_TEMPLATE = 'scripts/wa-template-alert-push.mjs';
const templateSrc = readFile(REL_TEMPLATE);

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
 * Isolates one `CREATE OR REPLACE FUNCTION ... AS $fn$ ... $fn$;` block from the migration file —
 * same `isolateSqlFunction` idiom as scripts/verify-wa-report-schedule.mjs.
 */
function isolateSqlFunction(source, relPath, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    fail(`${relPath}: could not find ${JSON.stringify(declaration)}.`);
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

/**
 * Isolates one top-level TS function's body out of whatsapp-inbound/index.ts — same heuristic
 * scripts/verify-wa-staff-menu.mjs already uses there (renderMenuItem, loadFeatureKeys): slice
 * from the declaration to the first "\n}\n" that follows it. Every top-level function in this file
 * closes its brace at column 0 followed by a blank line, so this never matches an indented nested
 * "}" inside the function body.
 */
function isolateTsFunction(source, relPath, declaration) {
  const start = source.indexOf(declaration);
  if (start === -1) {
    fail(`${relPath}: could not find ${JSON.stringify(declaration)}.`);
  }
  const fn = source.slice(start);
  const end = fn.indexOf('\n}\n');
  if (end === -1) {
    fail(`${relPath}: could not find the closing "\\n}\\n" after ${JSON.stringify(declaration)}.`);
  }
  return fn.slice(0, end);
}

const ALERT_PUSH_RECIPIENTS_DECL = 'CREATE OR REPLACE FUNCTION public.alert_push_recipients(p_alert_id uuid)';
const CRON_PUSH_DECL = 'CREATE OR REPLACE FUNCTION public.cron_push_dashboard_alerts()';

// ================================================================================================
// 1. alert_push_recipients applies the SAME opt-out gate every report selector obeys — never a
//    second, ungated send path.
// ================================================================================================

check('alert_push_recipients filters on rr.opted_out_at IS NULL', () => {
  const fn = isolateSqlFunction(migrationSrc, REL_MIGRATION, ALERT_PUSH_RECIPIENTS_DECL);
  assert.ok(
    fn.includes('rr.opted_out_at IS NULL'),
    'alert_push_recipients must filter on rr.opted_out_at IS NULL — the alert push must obey the ' +
      'same opt-out gate every report selector already obeys, not a second, ungated send path'
  );
});

// ================================================================================================
// 2. 'info' never appears as an eligible value anywhere the push path filters on severity.
// ================================================================================================

check("alert_push_recipients's severity comparison never treats 'info' as eligible", () => {
  const fn = isolateSqlFunction(migrationSrc, REL_MIGRATION, ALERT_PUSH_RECIPIENTS_DECL);
  assert.ok(
    !fn.includes("'info'"),
    'alert_push_recipients must never compare severity against \'info\' — an info-severity alert ' +
      'must never be eligible for a WhatsApp push, at any recipient floor'
  );
});

check("report_recipients.alert_severity_floor's own CHECK constraint never allows 'info' as a floor value", () => {
  const m = migrationSrc.match(/CHECK \(alert_severity_floor IN \(([^)]*)\)\)/);
  assert.ok(m, `${REL_MIGRATION}: could not find alert_severity_floor's CHECK constraint`);
  assert.ok(
    !m[1].includes("'info'"),
    `alert_severity_floor's CHECK must not allow 'info' as a floor value, found: ${m[1]}`
  );
});

// ================================================================================================
// 3. dashboard_alert_wa_pushes has a UNIQUE constraint spanning BOTH alert_id and recipient_id —
//    checked structurally, not by trusting a comment.
// ================================================================================================

check('dashboard_alert_wa_pushes has a UNIQUE constraint spanning alert_id AND recipient_id', () => {
  assert.ok(
    /UNIQUE\s*\(\s*alert_id\s*,\s*recipient_id\s*\)/.test(migrationSrc),
    `${REL_MIGRATION} must contain a UNIQUE (alert_id, recipient_id) constraint on ` +
      'dashboard_alert_wa_pushes — this is the dedupe contract: the same still-open alert must ' +
      'never be pushed twice to the same recipient'
  );
});

// ================================================================================================
// 4. THE MOST IMPORTANT GUARD IN THIS FILE. The "Mark resolved" button-tap dispatch must call the
//    IDENTICAL staging function commandAck (the typed "ACK <n>" path) calls — not a lookalike, not
//    a second staging body that could skip the alerts.resolve re-check. Neither name is hardcoded
//    here: both are extracted from the actual source, so a rename of BOTH call sites together still
//    passes (nothing to break), but a future edit that gives the button tap its OWN, differently-
//    named staging function fails loudly.
// ================================================================================================

check("COMMAND_HANDLERS registers the typed 'ACK' verb to a named function", () => {
  assert.ok(
    /\bACK:\s*(\w+),/.test(inboundSrc),
    `${REL_INBOUND}: could not find "ACK: <fnName>," inside COMMAND_HANDLERS`
  );
});

check(
  'the "Mark resolved" button-tap dispatch calls the IDENTICAL function the typed \'ACK\' verb ' +
    'resolves to — not a lookalike',
  () => {
    // The typed path: whatever function COMMAND_HANDLERS registers 'ACK' to. Not hardcoded as
    // "commandAck" — extracted from the actual registration, so a consistent rename of both sides
    // still passes and only a genuine divergence fails.
    const handlerMatch = inboundSrc.match(/\bACK:\s*(\w+),/);
    assert.ok(handlerMatch, `${REL_INBOUND}: could not find "ACK: <fnName>," inside COMMAND_HANDLERS`);
    const typedPathFnName = handlerMatch[1];

    // The handleCommand branch that routes an ALERT_NS reply id (the button tap) to its dispatch
    // function. Also not assumed by name — extracted from the actual routing line.
    const routeMatch = inboundSrc.match(
      /if \(parsed && parsed\.ns === ALERT_NS[^)]*\) \{\s*\n\s*return (\w+)\(ctx, parsed\.arg\);/
    );
    assert.ok(
      routeMatch,
      `${REL_INBOUND}: expected handleCommand to route an ALERT_NS reply id to a dispatch ` +
        `function called as "return <fnName>(ctx, parsed.arg);"`
    );
    const dispatchFnName = routeMatch[1];

    const dispatchFn = isolateTsFunction(
      inboundSrc,
      REL_INBOUND,
      `async function ${dispatchFnName}(ctx: CommandContext`
    );
    assert.ok(
      new RegExp(`return ${typedPathFnName}\\(ctx,`).test(dispatchFn),
      `${REL_INBOUND}: the button-tap dispatch function "${dispatchFnName}" must call the ` +
        `IDENTICAL function "${typedPathFnName}(" that the typed 'ACK' verb resolves to — it does ` +
        `not. A tap must never be able to reach a different staging path that might not re-check ` +
        `alerts.resolve the same way the typed path's staging step does (contract 7).`
    );
  }
);

// ================================================================================================
// 5. No RAISE EXCEPTION inside cron_push_dashboard_alerts() — same async-result limitation as
//    every wrapper in migrations/20260909090000_whatsapp_report_schedule.sql: net.http_post's own
//    result is never inspected or branched on.
// ================================================================================================

check('cron_push_dashboard_alerts contains no RAISE EXCEPTION', () => {
  const fn = isolateSqlFunction(migrationSrc, REL_MIGRATION, CRON_PUSH_DECL);
  assert.ok(
    !/RAISE EXCEPTION/.test(fn),
    'cron_push_dashboard_alerts must not RAISE EXCEPTION — every guard (missing secret, malformed ' +
      'base URL) must RAISE NOTICE and RETURN instead, since this job ticks every 5 minutes rather ' +
      'than once a day/week/month'
  );
});

check('cron_push_dashboard_alerts RAISE NOTICEs and never inspects the async HTTP response', () => {
  const fn = isolateSqlFunction(migrationSrc, REL_MIGRATION, CRON_PUSH_DECL);
  assert.ok(fn.includes('RAISE NOTICE'), 'cron_push_dashboard_alerts must contain at least one RAISE NOTICE');
  assert.ok(
    !fn.includes('net._http_response'),
    'cron_push_dashboard_alerts must not reference net._http_response — net.http_post is async and ' +
      'returns only a request id'
  );
  assert.ok(!fn.includes('http_get'), 'cron_push_dashboard_alerts must not call http_get');
});

// ================================================================================================
// 6. The new cron jobname does not collide with any of the five jobnames already in cron.job.
// ================================================================================================

check('the new cron jobname does not collide with any of the five pre-existing cron.job jobnames', () => {
  const existingJobnames = [
    'reseed-production-daily-hourly',
    'reseed-production-daily-nightly',
    'send-daily-whatsapp-report',
    'send-weekly-whatsapp-report',
    'send-monthly-whatsapp-report',
  ];
  const m = migrationSrc.match(/cron\.schedule\(\s*'([^']+)'/);
  assert.ok(m, `${REL_MIGRATION}: could not find a cron.schedule( call`);
  const newJobname = m[1];
  assert.ok(
    !existingJobnames.includes(newJobname),
    `new cron jobname "${newJobname}" collides with a pre-existing cron.job jobname`
  );
});

// ================================================================================================
// 7. scripts/wa-template-alert-push.mjs stays a hermetic descriptor — same forbidden list
//    scripts/verify-wa-period-reports.mjs runs on its own template descriptor, so this third
//    descriptor cannot quietly grow real submission capability the other two were deliberately
//    built without.
// ================================================================================================

check('scripts/wa-template-alert-push.mjs contains no fetch/env/credential/URL literal', () => {
  const forbidden = ['fetch(', 'process.env', 'http://', 'https://', '.supabase.co', 'crk_', 'require('];
  for (const needle of forbidden) {
    assert.ok(
      !templateSrc.includes(needle),
      `${REL_TEMPLATE} contains ${JSON.stringify(needle)} — this repo has no template-submission ` +
        `client and one must not be added here; this file is a definition and a printer only`
    );
  }
});

// ================================================================================================
// Extra coverage, matching the sibling verifiers' depth (not one of the 7 mandated assertions, but
// cheap and load-bearing).
// ================================================================================================

check('cron_push_dashboard_alerts reads the SAME two Vault secret names wa-flow-05 already seeded', () => {
  const fn = isolateSqlFunction(migrationSrc, REL_MIGRATION, CRON_PUSH_DECL);
  assert.ok(fn.includes("'wa_cron_service_role_key'"), 'must read the wa_cron_service_role_key secret');
  assert.ok(fn.includes("'wa_cron_functions_base_url'"), 'must read the wa_cron_functions_base_url secret');
});

check('dashboard_alert_wa_pushes is granted to service_role only, never anon/authenticated', () => {
  assert.ok(
    /REVOKE ALL ON public\.dashboard_alert_wa_pushes FROM PUBLIC, anon, authenticated;/.test(migrationSrc),
    'missing REVOKE ALL ... FROM PUBLIC, anon, authenticated for dashboard_alert_wa_pushes'
  );
  assert.ok(
    /GRANT SELECT, INSERT ON public\.dashboard_alert_wa_pushes TO service_role;/.test(migrationSrc),
    'missing GRANT SELECT, INSERT ... TO service_role for dashboard_alert_wa_pushes'
  );
});

check('send-alert-whatsapp sends via sendTemplate, never a hand-built payload', () => {
  assert.ok(senderSrc.includes("import { buildReplyId, sendTemplate,"), 'must import sendTemplate from ../_shared/wa-send.ts');
  assert.ok(senderSrc.includes('await sendTemplate(phone, TEMPLATE_NAME, '), 'must call sendTemplate(...) to send');
  assert.ok(!senderSrc.includes('await fetch('), 'must not hand-build a fetch() call to Control Room directly');
});

check('send-alert-whatsapp records a dashboard_alert_wa_pushes row only on a successful send', () => {
  assert.ok(
    senderSrc.includes("sb.from('dashboard_alert_wa_pushes').insert("),
    'must insert into dashboard_alert_wa_pushes on success'
  );
  const insertIdx = senderSrc.indexOf("sb.from('dashboard_alert_wa_pushes').insert(");
  const beforeInsert = senderSrc.slice(0, insertIdx);
  assert.ok(
    /if \(result\.ok\)\s*\{[\s\S]{0,400}$/.test(beforeInsert),
    'the dashboard_alert_wa_pushes insert must be gated behind "if (result.ok)" — never recorded for a failed send'
  );
});

// ---- report -------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nwa-alert-push:verify FAILED — ${failures.length} of ${failures.length + passCount} checks\n`);
  for (const f of failures) {
    console.error(`  ✗ ${f.description}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}
console.log(`wa-alert-push:verify passed — ${passCount} checks (migration: ${REL_MIGRATION})`);
