#!/usr/bin/env node
/**
 * Apply a migration SQL file to PRODUCTION — deliberately, with guards.
 * This is the only sanctioned way to change the production schema.
 *
 * Guards:
 *   1. Requires CONFIRM_PROD=YES in the environment (no accidental runs).
 *   2. Refuses any migration not already recorded on the DEV ledger —
 *      everything must be applied and tested on dev first (npm run db:apply).
 *   3. Re-links the CLI back to dev afterwards, even on failure.
 *   4. Runs audit.attach_all() after applying so new tables get owner
 *      columns + audit triggers on prod too.
 *
 * Usage:
 *   CONFIRM_PROD=YES npm run db:apply-prod -- migrations/<file>.sql
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCTION, DEV } from './lib/supabase-projects.mjs';
import { runLinkedQuery } from './lib/run-supabase-query.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function fail(msg) {
  console.error(`\nERROR: ${msg}`);
  process.exit(1);
}

function linkTo(ref, label) {
  const result = spawnSync('supabase', ['link', '--project-ref', ref], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`supabase link to ${label} (${ref}) failed: ${result.stderr || result.stdout}`);
  }
  console.log(`CLI linked to ${label} (${ref}).`);
}

function currentLinkedRef() {
  const p = path.join(root, 'supabase', '.temp', 'project-ref');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
}

const arg = process.argv[2];
if (!arg || arg === '-h' || arg === '--help') {
  console.log('Usage: CONFIRM_PROD=YES npm run db:apply-prod -- migrations/<file>.sql');
  process.exit(arg ? 0 : 1);
}

if (process.env.CONFIRM_PROD !== 'YES') {
  fail(
    'This applies SQL to PRODUCTION. If you mean it, run:\n' +
      `  CONFIRM_PROD=YES npm run db:apply-prod -- ${arg}`
  );
}

const sqlPath = path.resolve(root, arg);
if (!fs.existsSync(sqlPath)) fail(`Migration file not found: ${sqlPath}`);
if (!sqlPath.toLowerCase().endsWith('.sql')) fail(`Refusing non-.sql file: ${sqlPath}`);

const base = path.basename(sqlPath);
const meta = base.match(/^(\d+)_(.+)\.sql$/i);
if (!meta) fail(`Migration filename must match VERSION_name.sql: ${base}`);
const [, version, name] = meta;

// Guard 2: must already be applied to dev.
if (currentLinkedRef() !== DEV.ref) {
  fail(`CLI must start linked to dev (${DEV.ref}). Run: supabase link --project-ref ${DEV.ref}`);
}
const devLedger = runLinkedQuery(
  `SELECT count(*)::int AS n FROM supabase_migrations.schema_migrations WHERE version = '${version}'`,
  root
);
const devHasIt = Array.isArray(devLedger?.rows) && devLedger.rows[0]?.n > 0;
if (!devHasIt) {
  fail(
    `Migration ${version} is not recorded on the DEV ledger.\n` +
      `Apply and test it on dev first: npm run db:apply -- ${arg}`
  );
}
console.log(`Dev ledger has ${version} — OK to promote.`);

let exitCode = 0;
try {
  linkTo(PRODUCTION.ref, 'PRODUCTION');

  console.log(`Applying to PRODUCTION: ${path.relative(root, sqlPath)}`);
  const result = spawnSync('supabase', ['db', 'query', '--linked', '--file', sqlPath], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`migration failed with exit code ${result.status}`);

  runLinkedQuery(
    `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
     VALUES ('${version}', '${name.replace(/'/g, "''")}', ARRAY[]::text[])
     ON CONFLICT (version) DO NOTHING`,
    root
  );
  console.log(`Recorded on PRODUCTION ledger: ${version} / ${name}`);

  runLinkedQuery(
    "do $$ begin if exists (select 1 from pg_namespace where nspname = 'audit') then perform audit.attach_all(); end if; end $$;",
    root
  );
  console.log('audit.attach_all() ran on production.');
} catch (err) {
  console.error(`\nPRODUCTION apply failed: ${err.message}`);
  exitCode = 1;
} finally {
  try {
    linkTo(DEV.ref, 'dev');
  } catch (err) {
    console.error(
      `CRITICAL: could not re-link CLI to dev — do it now: supabase link --project-ref ${DEV.ref}`
    );
    exitCode = 1;
  }
}
process.exit(exitCode);
