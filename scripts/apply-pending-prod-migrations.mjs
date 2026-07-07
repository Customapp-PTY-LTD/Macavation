#!/usr/bin/env node
/**
 * Apply repo migrations not yet recorded on Macavation production.
 *
 * Usage:
 *   supabase link --project-ref sofanhfpxifgdtooefzq
 *   node scripts/apply-pending-prod-migrations.mjs
 *   node scripts/apply-pending-prod-migrations.mjs --only-phase2
 *
 * Re-link to UAT after: supabase link --project-ref nmdmddugxclpqrwylyfa
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCTION } from './lib/supabase-projects.mjs';
import { applyMigrationFile } from './lib/apply-migration-to-ref.mjs';
import { runLinkedQuery } from './lib/run-supabase-query.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const PROD_REF = PRODUCTION.ref;

const PHASE2_ONLY = [
  '20260629120000_phase2_portal_features.sql',
  '20260629140000_fix_kernel_runway_summary.sql',
  '20260706100000_phase2_implementation_complete.sql',
  '20260706110000_phase2_grants_fix.sql',
];

const onlyPhase2 = process.argv.includes('--only-phase2');
const continueOnError = process.argv.includes('--continue-on-error');
const resultsPath = path.join(__dirname, 'prod_migration_apply_results.json');

function listPending(appliedNames) {
  const migDir = path.join(root, 'migrations');
  let files = fs.readdirSync(migDir).filter((x) => x.endsWith('.sql')).sort();
  if (onlyPhase2) {
    files = files.filter((f) => PHASE2_ONLY.includes(f));
  }
  const pending = [];
  for (const f of files) {
    const m = f.match(/^(\d+)_(.+)\.sql$/);
    if (!m) continue;
    if (!appliedNames.has(m[2])) pending.push(`migrations/${f}`);
  }
  return pending;
}

const appliedRows = runLinkedQuery(
  'SELECT name FROM supabase_migrations.schema_migrations',
  root
).rows;
const appliedNames = new Set(appliedRows.map((r) => r.name));
const pending = listPending(appliedNames);

console.log(`Production (${PROD_REF}): ${pending.length} pending migration(s) to apply.`);

const results = [];
for (const rel of pending) {
  try {
    applyMigrationFile(root, rel, PROD_REF);
    results.push({ file: rel, status: 'ok', at: new Date().toISOString() });
  } catch (err) {
    const entry = {
      file: rel,
      status: 'failed',
      at: new Date().toISOString(),
      error: String(err.message || err).slice(0, 500),
    };
    results.push(entry);
    console.error(entry.error);
    if (!continueOnError) {
      fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
      process.exit(1);
    }
  }
}

fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2) + '\n', 'utf8');
console.log(`\nDone. Results: ${path.relative(root, resultsPath)}`);
