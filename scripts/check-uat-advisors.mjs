#!/usr/bin/env node
/**
 * Capture UAT database health signals (schema drift, RLS gaps) via Supabase CLI.
 * Mirrors common Supabase Dashboard advisor warnings.
 *
 * Usage:
 *   node scripts/check-uat-advisors.mjs
 *   npm run db:check-uat-advisors
 *
 * Requires: supabase link --project-ref nmdmddugxclpqrwylyfa
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { UAT } from './lib/supabase-projects.mjs';
import { readExpectedRemoteRef, verifyCliLinkedProject } from './lib/macavation-supabase.mjs';
import { runLinkedQuery } from './lib/run-supabase-query.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const expectedRef = readExpectedRemoteRef(root);
verifyCliLinkedProject(root, expectedRef);

const migDir = path.join(root, 'migrations');
const repoFiles = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

const appliedRows = runLinkedQuery(
  'SELECT name, version FROM supabase_migrations.schema_migrations ORDER BY version',
  root
).rows;
const appliedNames = new Set(appliedRows.map((r) => r.name));

const pending = [];
for (const f of repoFiles) {
  const m = f.match(/^(\d+)_(.+)\.sql$/);
  if (!m) continue;
  if (!appliedNames.has(m[2])) pending.push(f);
}

const tablesWithoutRls = runLinkedQuery(
  "SELECT t.tablename FROM pg_tables t JOIN pg_class c ON c.relname = t.tablename JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname WHERE t.schemaname = 'public' AND c.relrowsecurity = false AND c.relkind = 'r' ORDER BY t.tablename",
  root
).rows;

const report = {
  generatedAt: new Date().toISOString(),
  projectRef: UAT.ref,
  projectUrl: UAT.apiUrl,
  schema: {
    repoMigrationFiles: repoFiles.length,
    appliedOnUat: appliedRows.length,
    pendingOnUat: pending.length,
    firstPending: pending[0] || null,
    lastPending: pending[pending.length - 1] || null,
  },
  security: {
    publicTablesWithoutRls: tablesWithoutRls.length,
    tablesWithoutRls: tablesWithoutRls.map((r) => r.tablename),
  },
  likelyDashboardUnhealthyReasons: [],
};

if (pending.length > 0) {
  report.likelyDashboardUnhealthyReasons.push(
    `Schema drift: ${pending.length} repo migration(s) not applied on UAT (production/local Lambda may be ahead).`
  );
}
if (tablesWithoutRls.length > 0) {
  report.likelyDashboardUnhealthyReasons.push(
    `Security advisor: ${tablesWithoutRls.length} public table(s) without Row Level Security.`
  );
}
if (appliedRows.length < 100) {
  report.likelyDashboardUnhealthyReasons.push(
    'UAT has far fewer applied migrations than production — expect missing RPCs and RBAC errors when pointed at UAT.'
  );
}

const outPath = path.join(__dirname, 'uat_advisors_report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

console.log(`UAT advisors report → ${path.relative(root, outPath)}`);
console.log(`  Applied migrations: ${report.schema.appliedOnUat}`);
console.log(`  Pending migrations: ${report.schema.pendingOnUat}`);
console.log(`  Tables without RLS: ${report.security.publicTablesWithoutRls}`);
if (report.likelyDashboardUnhealthyReasons.length) {
  console.log('\nLikely dashboard "unhealthy" causes:');
  for (const reason of report.likelyDashboardUnhealthyReasons) {
    console.log(`  - ${reason}`);
  }
}
