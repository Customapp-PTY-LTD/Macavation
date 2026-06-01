#!/usr/bin/env node
/**
 * Apply a migration SQL file to linked Macavation Supabase via CLI only.
 *
 * Usage:
 *   node scripts/apply-migration.mjs migrations/20260527140000_example.sql
 *   npm run db:apply -- migrations/20260527140000_example.sql
 *
 * Requires: supabase CLI logged in and linked to sofanhfpxifgdtooefzq
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PROJECT_REF,
  assertMacavationProject,
  readExpectedRemoteRef,
  verifyCliLinkedProject,
} from './lib/macavation-supabase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function usage() {
  console.log(`Apply a migration to Macavation (${PROJECT_REF}) via Supabase CLI.

Usage:
  node scripts/apply-migration.mjs <path-to.sql>

Examples:
  node scripts/apply-migration.mjs migrations/20260527140000_example.sql
  npm run db:apply -- migrations/20260527140000_example.sql

Before first use:
  supabase login
  supabase link --project-ref ${PROJECT_REF}
`);
}

const arg = process.argv[2];
if (!arg || arg === '-h' || arg === '--help') {
  usage();
  process.exit(arg ? 0 : 1);
}

assertMacavationProject();
const expectedRef = readExpectedRemoteRef(root);
verifyCliLinkedProject(root, expectedRef);

const sqlPath = path.resolve(root, arg);
if (!fs.existsSync(sqlPath)) {
  console.error(`Migration file not found: ${sqlPath}`);
  process.exit(1);
}
if (!sqlPath.toLowerCase().endsWith('.sql')) {
  console.error('Refusing non-.sql file:', sqlPath);
  process.exit(1);
}

console.log(`Applying to Macavation (${expectedRef}): ${path.relative(root, sqlPath)}`);

const result = spawnSync(
  'supabase',
  ['db', 'query', '--linked', '--file', sqlPath],
  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }
);

process.exit(result.status ?? 1);
