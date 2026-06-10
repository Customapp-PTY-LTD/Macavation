#!/usr/bin/env node

/**

 * Apply a migration SQL file to linked Macavation Supabase via CLI only.

 * Records the migration in supabase_migrations.schema_migrations when successful.

 *

 * Usage:

 *   node scripts/apply-migration.mjs migrations/20260527140000_example.sql

 *   npm run db:apply -- migrations/20260527140000_example.sql

 *

 * Requires: supabase CLI logged in and linked to the project in supabase/remote.toml (UAT on dev branch)

 */

import { spawnSync } from 'child_process';

import fs from 'fs';

import path from 'path';

import { fileURLToPath } from 'url';

import {

  PROJECT_REF,

  assertAllowedProjectRef,

  readExpectedRemoteRef,

  verifyCliLinkedProject,

} from './lib/macavation-supabase.mjs';

import { runLinkedQuery } from './lib/run-supabase-query.mjs';



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



function parseMigrationMeta(sqlPath) {

  const base = path.basename(sqlPath);

  const m = base.match(/^(\d+)_(.+)\.sql$/i);

  if (!m) {

    throw new Error(`Migration filename must match VERSION_name.sql: ${base}`);

  }

  return { version: m[1], name: m[2] };

}



function recordMigration(version, name) {

  const sql = `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)

VALUES ('${version}', '${name.replace(/'/g, "''")}', ARRAY[]::text[])

ON CONFLICT (version) DO NOTHING`;

  runLinkedQuery(sql, root);

}



const arg = process.argv[2];

if (!arg || arg === '-h' || arg === '--help') {

  usage();

  process.exit(arg ? 0 : 1);

}



assertAllowedProjectRef(PROJECT_REF);

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



const { version, name } = parseMigrationMeta(sqlPath);



console.log(`Applying to Macavation (${expectedRef}): ${path.relative(root, sqlPath)}`);



const result = spawnSync(

  'supabase',

  ['db', 'query', '--linked', '--file', sqlPath],

  { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }

);



if (result.status !== 0) {

  process.exit(result.status ?? 1);

}



try {

  recordMigration(version, name);

  console.log(`Recorded schema_migrations: ${version} / ${name}`);

} catch (err) {

  console.error('Migration SQL ran but failed to record in schema_migrations:', err.message);

  process.exit(1);

}



process.exit(0);


