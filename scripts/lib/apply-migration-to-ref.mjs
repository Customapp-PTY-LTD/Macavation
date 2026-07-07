/**
 * Apply a migration SQL file to a specific Supabase project ref via CLI.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { assertAllowedProjectRef } from './supabase-projects.mjs';
import { runLinkedQuery } from './run-supabase-query.mjs';

export function parseMigrationMeta(sqlPath) {
  const base = path.basename(sqlPath);
  const m = base.match(/^(\d+)_(.+)\.sql$/i);
  if (!m) {
    throw new Error(`Migration filename must match VERSION_name.sql: ${base}`);
  }
  return { version: m[1], name: m[2] };
}

export function verifyCliLinkedToRef(repoRoot, expectedRef) {
  assertAllowedProjectRef(expectedRef);
  const linkedPath = path.join(repoRoot, 'supabase', '.temp', 'linked-project.json');
  if (!fs.existsSync(linkedPath)) {
    throw new Error(
      `Supabase CLI is not linked. Run: supabase link --project-ref ${expectedRef}`
    );
  }
  const linked = JSON.parse(fs.readFileSync(linkedPath, 'utf8'));
  if (linked.ref !== expectedRef) {
    throw new Error(
      `CLI linked to ${linked.ref}, expected ${expectedRef}. Run: supabase link --project-ref ${expectedRef}`
    );
  }
}

export function recordMigration(repoRoot, version, name) {
  const sql = `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('${version}', '${name.replace(/'/g, "''")}', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING`;
  runLinkedQuery(sql, repoRoot);
}

export function applyMigrationFile(repoRoot, sqlPath, projectRef) {
  assertAllowedProjectRef(projectRef);
  verifyCliLinkedToRef(repoRoot, projectRef);

  const absPath = path.resolve(repoRoot, sqlPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Migration file not found: ${absPath}`);
  }
  if (!absPath.toLowerCase().endsWith('.sql')) {
    throw new Error(`Refusing non-.sql file: ${absPath}`);
  }

  const { version, name } = parseMigrationMeta(absPath);
  console.log(`Applying to ${projectRef}: ${path.relative(repoRoot, absPath)}`);

  const result = spawnSync(
    'supabase',
    ['db', 'query', '--linked', '--file', absPath],
    { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' }
  );

  if (result.status !== 0) {
    throw new Error(`Migration failed with exit code ${result.status ?? 1}`);
  }

  recordMigration(repoRoot, version, name);
  console.log(`Recorded schema_migrations: ${version} / ${name}`);
  return { version, name };
}
