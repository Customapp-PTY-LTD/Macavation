#!/usr/bin/env node
/**
 * wa-report-schedule:verify — regression guard for the daily/weekly/monthly WhatsApp report-send
 * cron schedule added by migrations/<ts>_whatsapp_report_schedule.sql.
 *
 * This CANNOT run against a live database — it has no network access and no database credential.
 * It verifies the MIGRATION FILE'S SHAPE only: that the three cron jobs, the three wrapper
 * functions, their access-control grants and their guards are textually present and correctly
 * formed. It proves nothing about whether pg_cron/pg_net/supabase_vault are actually enabled on
 * any real database, whether either Vault secret has been seeded, or whether the schedule
 * actually fires — the same candour scripts/verify-migration-prefixes.mjs shows about its own
 * limits (see that script's own header).
 *
 * Follows the same discipline as scripts/verify-wa-period-reports.mjs: pure `fs` reads, a tiny
 * check()/failures harness, CRLF normalised on read, and its own copy of the `isolateSqlFunction`
 * `$fn$`-tag idiom for isolating one PL/pgSQL function body out of the migration file.
 *
 * No dependency, no network, no browser. This repo has no package-lock.json — do not add one and
 * do not invoke `npm ci` from here.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const REL_MIGRATIONS_DIR = 'migrations';

/** Normalise CRLF before any comparison — same reason as verify-wa-period-reports.mjs. */
function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n');
}

/** Locates the (single) new migration by suffix, rather than hard-coding its timestamp. */
function findScheduleMigration() {
  const dir = path.join(ROOT, REL_MIGRATIONS_DIR);
  const matches = fs.readdirSync(dir).filter((f) => f.endsWith('_whatsapp_report_schedule.sql'));
  if (matches.length === 0) {
    fail(
      `${REL_MIGRATIONS_DIR}/: no file matching *_whatsapp_report_schedule.sql found. This plan's ` +
        `migration is missing.`
    );
  }
  if (matches.length > 1) {
    fail(
      `${REL_MIGRATIONS_DIR}/: expected exactly one *_whatsapp_report_schedule.sql, found ` +
        `${matches.length}: ${matches.join(', ')}.`
    );
  }
  return `${REL_MIGRATIONS_DIR}/${matches[0]}`;
}

const REL_MIGRATION = findScheduleMigration();
const migrationSrc = readFile(REL_MIGRATION);

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
 * copied from scripts/verify-wa-period-reports.mjs's own `isolateSqlFunction`, same reasoning:
 * PL/pgSQL function bodies use BEGIN/END, not curly braces, and every function in this repo's
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

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ================================================================================================
// 1. Exactly three cron.schedule( calls, matched by this migration's own known dollar-quoted-
//    command-string shape. Captures jobname, cron expression and command string in one pass.
// ================================================================================================

const CRON_SCHEDULE_RE = /cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*\$cron\$([\s\S]*?)\$cron\$\s*\)/g;

function extractCronSchedules(source) {
  const out = [];
  let m;
  while ((m = CRON_SCHEDULE_RE.exec(source)) !== null) {
    out.push({ jobname: m[1], schedule: m[2], command: m[3] });
  }
  return out;
}

const cronSchedules = extractCronSchedules(migrationSrc);

check('exactly three cron.schedule( calls are present', () => {
  assert.equal(
    cronSchedules.length,
    3,
    `expected exactly 3 cron.schedule( calls, found ${cronSchedules.length} in ${REL_MIGRATION}`
  );
});

check(
  'the three cron.schedule( jobnames and cron expressions are exactly the required set',
  () => {
    const expected = {
      'send-daily-whatsapp-report': '0 15 * * *',
      'send-weekly-whatsapp-report': '0 4 * * 1',
      'send-monthly-whatsapp-report': '0 4 1 * *',
    };
    const foundNames = cronSchedules.map((j) => j.jobname).sort();
    assert.deepEqual(
      foundNames,
      Object.keys(expected).sort(),
      `expected jobnames ${JSON.stringify(Object.keys(expected).sort())}, found ${JSON.stringify(foundNames)}`
    );
    for (const job of cronSchedules) {
      assert.equal(
        job.schedule,
        expected[job.jobname],
        `job "${job.jobname}" must have schedule "${expected[job.jobname]}", found "${job.schedule}"`
      );
    }
  }
);

check(
  'the daily job is scheduled at 0 15 * * * (17:00 SAST), not 0 4 * * * (06:00 SAST)',
  () => {
    const daily = cronSchedules.find((j) => j.jobname === 'send-daily-whatsapp-report');
    assert.ok(daily, 'send-daily-whatsapp-report job not found');
    assert.equal(
      daily.schedule,
      '0 15 * * *',
      `send-daily-whatsapp-report must be scheduled "0 15 * * *" (17:00 SAST). A 06:00 SAST ` +
        `("0 4 * * *") send would run before the current SAST day has any production captured, so ` +
        `send-daily-production-report's has_production guard (index.ts:224-226) would skip almost ` +
        `every morning silently. Found: "${daily.schedule}"`
    );
  }
);

// ================================================================================================
// 2. No cron.schedule( call names either pre-existing reseed job — scoped to the extracted
//    jobnames only, since the migration's own verification block legitimately mentions both.
// ================================================================================================

check(
  'no cron.schedule( call names reseed-production-daily-hourly or reseed-production-daily-nightly',
  () => {
    const forbidden = ['reseed-production-daily-hourly', 'reseed-production-daily-nightly'];
    const foundNames = cronSchedules.map((j) => j.jobname);
    for (const name of forbidden) {
      assert.ok(
        !foundNames.includes(name),
        `a cron.schedule( call in ${REL_MIGRATION} names "${name}" — this migration must not ` +
          `re-schedule either pre-existing reseed job`
      );
    }
  }
);

// ================================================================================================
// 3. Each cron.schedule( command string names exactly one wrapper function and no other SQL verb.
// ================================================================================================

check(
  'each cron.schedule( command string calls exactly one wrapper function and nothing else',
  () => {
    const wrapperByJob = {
      'send-daily-whatsapp-report': 'public.cron_send_daily_report()',
      'send-weekly-whatsapp-report': 'public.cron_send_weekly_report()',
      'send-monthly-whatsapp-report': 'public.cron_send_monthly_report()',
    };
    const otherVerbs = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|CALL)\b/i;
    for (const job of cronSchedules) {
      const expectedWrapper = wrapperByJob[job.jobname];
      if (!expectedWrapper) continue; // covered by the jobname-set assertion above
      const trimmed = job.command.trim();
      assert.equal(
        trimmed,
        `SELECT ${expectedWrapper};`,
        `job "${job.jobname}"'s command string must be exactly "SELECT ${expectedWrapper};", found ` +
          `${JSON.stringify(trimmed)} — no inline net.http_post, no other SQL verb`
      );
      assert.ok(
        !otherVerbs.test(trimmed.replace(/^SELECT\s+/i, '')),
        `job "${job.jobname}"'s command string must contain no SQL verb other than the single SELECT`
      );
    }
  }
);

// ================================================================================================
// 4. Each of the three wrapper functions: SECURITY DEFINER + pinned search_path, references the
//    Vault secrets and net.http_post, raises on each missing secret, notices the request id, never
//    inspects the async response, and posts to the right edge-function slug with the right body.
// ================================================================================================

const WRAPPERS = [
  {
    decl: 'CREATE OR REPLACE FUNCTION public.cron_send_daily_report()',
    sig: 'public.cron_send_daily_report()',
    targetSlug: 'send-daily-production-report',
    bodyMustContain: [],
  },
  {
    decl: 'CREATE OR REPLACE FUNCTION public.cron_send_weekly_report()',
    sig: 'public.cron_send_weekly_report()',
    targetSlug: 'send-period-report',
    bodyMustContain: ['"p_kind"', 'weekly'],
  },
  {
    decl: 'CREATE OR REPLACE FUNCTION public.cron_send_monthly_report()',
    sig: 'public.cron_send_monthly_report()',
    targetSlug: 'send-period-report',
    bodyMustContain: ['"p_kind"', 'monthly'],
  },
];

for (const w of WRAPPERS) {
  check(`${w.sig} is SECURITY DEFINER with a pinned search_path`, () => {
    const fnBlock = isolateSqlFunction(migrationSrc, REL_MIGRATION, w.decl);
    const header = fnBlock.slice(0, fnBlock.indexOf('AS $fn$'));
    assert.ok(/SECURITY DEFINER/.test(header), `${w.sig} must be SECURITY DEFINER.`);
    assert.ok(/SET search_path\s*=\s*public/.test(header), `${w.sig} must pin SET search_path = public.`);
  });

  check(`${w.sig} reads both Vault secrets and calls net.http_post`, () => {
    const fnBlock = isolateSqlFunction(migrationSrc, REL_MIGRATION, w.decl);
    for (const needle of [
      'vault.decrypted_secrets',
      "'wa_cron_service_role_key'",
      "'wa_cron_functions_base_url'",
      'net.http_post',
    ]) {
      assert.ok(fnBlock.includes(needle), `${w.sig} must contain ${JSON.stringify(needle)}`);
    }
  });

  check(`${w.sig} raises on each missing secret and notices the dispatched request id`, () => {
    const fnBlock = isolateSqlFunction(migrationSrc, REL_MIGRATION, w.decl);
    const raiseExceptions = fnBlock.match(/RAISE EXCEPTION/g) || [];
    assert.ok(raiseExceptions.length >= 1, `${w.sig} must contain at least one RAISE EXCEPTION`);
    assert.ok(
      /RAISE EXCEPTION[^;]*wa_cron_service_role_key/s.test(fnBlock),
      `${w.sig} must RAISE EXCEPTION mentioning wa_cron_service_role_key when that secret is missing`
    );
    assert.ok(
      /RAISE EXCEPTION[^;]*wa_cron_functions_base_url/s.test(fnBlock),
      `${w.sig} must RAISE EXCEPTION mentioning wa_cron_functions_base_url when that secret is missing`
    );
    assert.ok(fnBlock.includes('RAISE NOTICE'), `${w.sig} must contain at least one RAISE NOTICE`);
  });

  check(`${w.sig} never inspects the async HTTP response`, () => {
    const fnBlock = isolateSqlFunction(migrationSrc, REL_MIGRATION, w.decl);
    assert.ok(
      !fnBlock.includes('net._http_response'),
      `${w.sig} must not reference net._http_response — net.http_post is async and returns only a ` +
        `request id; the send outcome is not available synchronously`
    );
    assert.ok(
      !fnBlock.includes('http_get'),
      `${w.sig} must not call http_get — it has no reason to read anything back synchronously`
    );
  });

  check(`${w.sig} posts to the correct edge-function slug`, () => {
    const fnBlock = isolateSqlFunction(migrationSrc, REL_MIGRATION, w.decl);
    assert.ok(
      fnBlock.includes(`/${w.targetSlug}'`) || fnBlock.includes(`/${w.targetSlug}"`),
      `${w.sig} must post to a URL ending in /${w.targetSlug}`
    );
    for (const needle of w.bodyMustContain) {
      assert.ok(fnBlock.includes(needle), `${w.sig} must contain ${JSON.stringify(needle)} in its request body`);
    }
  });
}

check('cron_send_weekly_report and cron_send_monthly_report each carry the right p_kind value', () => {
  const weekly = isolateSqlFunction(
    migrationSrc,
    REL_MIGRATION,
    'CREATE OR REPLACE FUNCTION public.cron_send_weekly_report()'
  );
  const monthly = isolateSqlFunction(
    migrationSrc,
    REL_MIGRATION,
    'CREATE OR REPLACE FUNCTION public.cron_send_monthly_report()'
  );
  assert.ok(weekly.includes('"p_kind":"weekly"'), 'cron_send_weekly_report must post {"p_kind":"weekly"}');
  assert.ok(
    monthly.includes('"p_kind":"monthly"'),
    'cron_send_monthly_report must post {"p_kind":"monthly"}'
  );
});

// ================================================================================================
// 5. REVOKE/GRANT pairs, verbatim, for each of the three wrappers.
// ================================================================================================

for (const w of WRAPPERS) {
  check(`${w.sig} is granted to service_role and NOT to anon/authenticated`, () => {
    const revokeRe = new RegExp(`REVOKE ALL ON FUNCTION ${escapeRe(w.sig)} FROM PUBLIC, anon, authenticated;`);
    const grantRe = new RegExp(`GRANT EXECUTE ON FUNCTION ${escapeRe(w.sig)} TO service_role;`);
    assert.ok(
      revokeRe.test(migrationSrc),
      `${REL_MIGRATION}: missing "REVOKE ALL ON FUNCTION ${w.sig} FROM PUBLIC, anon, authenticated;"`
    );
    assert.ok(
      grantRe.test(migrationSrc),
      `${REL_MIGRATION}: missing "GRANT EXECUTE ON FUNCTION ${w.sig} TO service_role;"`
    );
  });
}

// ================================================================================================
// 6. No per-environment literal: no bare <20-char>.supabase.co URL, and neither known project ref
//    anywhere in the file. The angle-bracket placeholder is explicitly allowed and does not match.
// ================================================================================================

check('the migration contains no literal Supabase project URL', () => {
  assert.ok(
    !/https:\/\/[a-z0-9]{20}\.supabase\.co/.test(migrationSrc),
    `${REL_MIGRATION} must not contain a literal https://<20-char-ref>.supabase.co URL — use the ` +
      `https://<project-ref>.supabase.co/functions/v1 placeholder instead`
  );
});

check('the migration contains no known project-ref literal', () => {
  for (const ref of ['nmdmddugxclpqrwylyfa', 'sofanhfpxifgdtooefzq']) {
    assert.ok(!migrationSrc.includes(ref), `${REL_MIGRATION} must not contain the project ref "${ref}"`);
  }
});

// ================================================================================================
// 7. No key-shaped literal. Heuristic only, not a proof — a real secret scan is a human's job.
// ================================================================================================

check('the migration contains no JWT-shaped literal', () => {
  assert.ok(
    !/eyJ[A-Za-z0-9_-]{20,}/.test(migrationSrc),
    `${REL_MIGRATION} must not contain a JWT-shaped literal (this is a heuristic, not a proof)`
  );
});

check('the migration contains no long base64/hex run inside a quoted literal', () => {
  // Scan SQL code lines only, not `--` comment lines — an English comment ("here's", "today's")
  // is full of apostrophes that are not SQL string delimiters, and pairing them up across
  // multiple comment lines would produce huge false-positive "literals" spanning prose.
  const codeOnly = migrationSrc
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  const quoted = codeOnly.match(/'[^'\n]*'/g) || [];
  for (const q of quoted) {
    assert.ok(
      !/[A-Za-z0-9+/=]{40,}/.test(q),
      `${REL_MIGRATION} contains a quoted literal with a 40+ character base64/hex-shaped run: ${q} ` +
        `(this is a heuristic, not a proof)`
    );
  }
});

// ================================================================================================
// 8. pg_net is created, pg_cron is NOT (re-)created here, and both contract-6 availability guards
//    are present.
// ================================================================================================

check('the migration creates pg_net and does not (re-)create pg_cron', () => {
  assert.ok(
    migrationSrc.includes('CREATE EXTENSION IF NOT EXISTS pg_net;'),
    `${REL_MIGRATION} must contain "CREATE EXTENSION IF NOT EXISTS pg_net;"`
  );
  assert.ok(
    !migrationSrc.includes('CREATE EXTENSION IF NOT EXISTS pg_cron'),
    `${REL_MIGRATION} must not (re-)create pg_cron — that extension is already created by ` +
      `migrations/20260901120000_auto_seed_production_daily_cron.sql`
  );
});

check('the migration guards for net.http_post and vault.decrypted_secrets availability', () => {
  assert.ok(
    /nspname\s*=\s*'net'/.test(migrationSrc) && /proname\s*=\s*'http_post'/.test(migrationSrc),
    `${REL_MIGRATION} must guard for net.http_post's existence via pg_proc/pg_namespace ` +
      `(nspname = 'net', proname = 'http_post')`
  );
  assert.ok(
    migrationSrc.includes("to_regclass('vault.decrypted_secrets')"),
    `${REL_MIGRATION} must guard with to_regclass('vault.decrypted_secrets')`
  );
});

// ================================================================================================
// 9. Seeding a Vault secret is a human pre-step, never this migration's job.
// ================================================================================================

check('the migration never seeds or writes to vault.* itself', () => {
  assert.ok(!migrationSrc.includes('INSERT INTO vault.'), `${REL_MIGRATION} must not INSERT INTO vault.*`);
  assert.ok(!migrationSrc.includes('vault.create_secret'), `${REL_MIGRATION} must not call vault.create_secret`);
  assert.ok(!migrationSrc.includes('vault.update_secret'), `${REL_MIGRATION} must not call vault.update_secret`);
});

// ---- report -------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nwa-report-schedule:verify FAILED — ${failures.length} of ${failures.length + passCount} checks\n`);
  for (const f of failures) {
    console.error(`  ✗ ${f.description}`);
    console.error(`    ${f.message}\n`);
  }
  process.exit(1);
}
console.log(`wa-report-schedule:verify passed — ${passCount} checks (migration: ${REL_MIGRATION})`);
