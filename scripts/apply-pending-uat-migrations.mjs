#!/usr/bin/env node
/**
 * Apply repo migrations that are not yet on UAT (linked project in supabase/remote.toml).
 *
 * Usage:
 *   node scripts/apply-pending-uat-migrations.mjs
 *   node scripts/apply-pending-uat-migrations.mjs --limit 10
 *   npm run db:apply-pending-uat
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readExpectedRemoteRef, verifyCliLinkedProject } from './lib/macavation-supabase.mjs';
import { runLinkedQuery } from './lib/run-supabase-query.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SKIP_FILES = new Set([
  '20260347000001_clear_oil_protein_module_data.sql',
]);

/** Apply before chronological pending (schema foundations). */
const PRIORITY_FIRST = [
  '20260108000014_fix_contact_function_parameter_order.sql',
  '20260225000000_consolidate_kernel_to_batches_and_kernel.sql',
  '20260226000004_create_oil_table_and_migrate.sql',
  '20260226000006_replace_oil_with_new_schema.sql',
  '20260226000007_create_oil_schema_sps.sql',
  '20260226000009_create_upsert_batch.sql',
  '20260302000002_create_features_rpc_functions.sql',
  '20260303000001_fix_get_role_features_add_feature_id.sql',
  '20260316000001_add_batch_journey_feature.sql',
  '20260322000001_oil_bin_batch_production.sql',
];

function parseArgs() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limitFlag = process.argv.indexOf('--limit');
  let limit = null;
  if (limitArg) limit = parseInt(limitArg.split('=')[1], 10);
  else if (limitFlag >= 0 && process.argv[limitFlag + 1]) {
    limit = parseInt(process.argv[limitFlag + 1], 10);
  }
  return {
    limit: Number.isFinite(limit) ? limit : null,
    continueOnError: process.argv.includes('--continue-on-error'),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function listPending(appliedNames) {
  const migDir = path.join(root, 'migrations');
  const pending = [];
  for (const f of fs.readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort()) {
    if (SKIP_FILES.has(f)) continue;
    const m = f.match(/^(\d+)_(.+)\.sql$/);
    if (!m) continue;
    if (!appliedNames.has(m[2])) pending.push(f);
  }
  return pending;
}

const { limit, continueOnError } = parseArgs();
const expectedRef = readExpectedRemoteRef(root);
verifyCliLinkedProject(root, expectedRef);

const appliedRows = runLinkedQuery('SELECT name FROM supabase_migrations.schema_migrations', root).rows;
const appliedNames = new Set(appliedRows.map((r) => r.name));
let pending = listPending(appliedNames);

const prioritySet = new Set(PRIORITY_FIRST);
const priority = PRIORITY_FIRST.filter((f) => pending.includes(f));
const rest = pending.filter((f) => !prioritySet.has(f));
pending = [...priority, ...rest];

if (limit != null) pending = pending.slice(0, limit);

const resultsPath = path.join(__dirname, 'uat_migration_apply_results.json');
let prior = [];
if (fs.existsSync(resultsPath)) {
  try {
    prior = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  } catch {
    prior = [];
  }
}

console.log(`UAT (${expectedRef}): applying ${pending.length} pending migration(s)...`);

const results = [...prior];

for (const file of pending) {
  const rel = `migrations/${file}`;
  console.log(`\nApplying ${rel}...`);
  const result = spawnSync('node', ['scripts/apply-migration.mjs', rel], {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const ok = result.status === 0;
  const entry = {
    file,
    status: ok ? 'ok' : 'failed',
    at: new Date().toISOString(),
    error: ok ? null : (result.stderr || result.stdout || '').slice(0, 500),
  };
  results.push(entry);
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
  if (!ok) {
    console.error(entry.error);
    if (!continueOnError) {
      console.error('Stopping after first failure. Re-run with --continue-on-error to skip failures.');
      process.exit(1);
    }
    console.error('Continuing (--continue-on-error)...');
  }
  await sleep(1500);
}

const remaining = listPending(
  new Set(
    runLinkedQuery('SELECT name FROM supabase_migrations.schema_migrations', root).rows.map((r) => r.name)
  )
);

console.log(`\nDone. Remaining pending on UAT: ${remaining.length}`);
if (remaining.length) {
  console.log(`Next: ${remaining[0]}`);
}
