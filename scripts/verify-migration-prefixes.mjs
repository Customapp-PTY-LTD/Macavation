#!/usr/bin/env node
/**
 * migrations:verify — proves migration filenames in the canonical `migrations/` directory
 * (see supabase/config.toml) follow the `<14-digit-UTC-timestamp>_<name>.sql` convention:
 *   1. Every .sql filename starts with a 14-digit prefix followed by `_`.
 *   2. That prefix parses as a real UTC timestamp (YYYYMMDDHHMMSS) — an impossible
 *      month/day/hour/minute/second is rejected.
 *   3. No two files share a prefix.
 *   4. The directory holds nothing but .sql files at its top level — no other
 *      extensions, no subdirectories.
 *
 * Grandfathering — pre-existing debt, not renamed on purpose.
 * -----------------------------------------------------------------------------
 * A batch of already-applied migrations in this repo violate rule 2 (the prefix was
 * used as an ad-hoc sequence counter and drifted past a real calendar date) and rule 3
 * (one duplicate prefix pair). Those files are NOT renamed — the filename an already-
 * applied migration was applied under is effectively part of the historical record,
 * and renaming it would make the repo disagree with the database about what ran.
 *
 * scripts/migration-prefix-baseline.json records exactly which violations are
 * grandfathered, keyed on the EXACT filename set for a duplicate-prefix group (not the
 * bare prefix) and on the exact filename for an invalid-date prefix. This means a new
 * file adopting an already-bad prefix — or a change to who shares a duplicate prefix —
 * is a FRESH violation and fails, even though the prefix itself is "known". Rules 1 and
 * 4 are never grandfathered.
 *
 * The baseline is read-only at runtime: this script never writes, extends or
 * regenerates it. There is no --update-baseline flag and no auto-heal path. If this
 * script reports a new failure, the correct response is to fix the filename that
 * caused it — never to add another entry to the baseline.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const targetArg = process.argv[2];
const TARGET_DIR = targetArg
  ? path.resolve(process.cwd(), targetArg)
  : path.join(REPO_ROOT, 'migrations');

const BASELINE_PATH = path.join(__dirname, 'migration-prefix-baseline.json');

function loadBaseline() {
  const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    duplicatePrefixes: parsed.duplicatePrefixes || {},
    invalidDatePrefixes: parsed.invalidDatePrefixes || {},
  };
}

function isValidUtcTimestamp(prefix) {
  // prefix is exactly 14 digits: YYYYMMDDHHMMSS
  const year = Number(prefix.slice(0, 4));
  const month = Number(prefix.slice(4, 6));
  const day = Number(prefix.slice(6, 8));
  const hour = Number(prefix.slice(8, 10));
  const minute = Number(prefix.slice(10, 12));
  const second = Number(prefix.slice(12, 14));

  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const d = new Date(ms);
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day &&
    d.getUTCHours() === hour &&
    d.getUTCMinutes() === minute &&
    d.getUTCSeconds() === second
  );
}

function sortedEqual(a, b) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

function run() {
  const baseline = loadBaseline();
  const violations = [];
  const warnings = [];

  let entries;
  try {
    entries = fs.readdirSync(TARGET_DIR, { withFileTypes: true });
  } catch (err) {
    console.error(`MIGRATION PREFIXES: cannot read directory ${TARGET_DIR}: ${err.message}`);
    process.exit(1);
  }

  const PREFIX_RE = /^(\d{14})_/;
  const sqlFiles = [];

  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      violations.push(`${name}: [rule-4] unexpected subdirectory in migrations directory`);
      continue;
    }
    if (!name.endsWith('.sql')) {
      violations.push(`${name}: [rule-4] non-.sql file in migrations directory`);
      continue;
    }

    const match = PREFIX_RE.exec(name);
    if (!match) {
      violations.push(`${name}: [rule-1] filename must start with a 14-digit prefix followed by "_"`);
      continue;
    }

    const prefix = match[1];
    sqlFiles.push({ name, prefix });

    if (!isValidUtcTimestamp(prefix)) {
      const grandfathered = (baseline.invalidDatePrefixes[prefix] || []).includes(name);
      if (grandfathered) {
        warnings.push(`${name}: [rule-2, grandfathered] prefix "${prefix}" is not a valid UTC timestamp`);
      } else {
        violations.push(`${name}: [rule-2] prefix "${prefix}" is not a valid UTC timestamp`);
      }
    }
  }

  // Rule 3: duplicate prefixes, grouped over files that at least parsed rule 1.
  const byPrefix = new Map();
  for (const f of sqlFiles) {
    if (!byPrefix.has(f.prefix)) byPrefix.set(f.prefix, []);
    byPrefix.get(f.prefix).push(f.name);
  }

  for (const [prefix, names] of byPrefix.entries()) {
    if (names.length < 2) continue;
    const recorded = baseline.duplicatePrefixes[prefix];
    const grandfathered = recorded && sortedEqual(recorded, names);
    if (grandfathered) {
      warnings.push(
        `prefix "${prefix}" [rule-3, grandfathered] shared by: ${[...names].sort().join(', ')}`
      );
    } else {
      violations.push(
        `prefix "${prefix}" [rule-3] shared by ${names.length} files (not an exact baseline match): ${[...names].sort().join(', ')}`
      );
    }
  }

  if (warnings.length) {
    console.warn(`MIGRATION PREFIXES: ${warnings.length} grandfathered warning(s):`);
    for (const w of warnings) console.warn('  ' + w);
  }

  if (violations.length) {
    console.error(`\nMIGRATION PREFIX VIOLATIONS (${violations.length}):\n`);
    for (const v of violations) console.error('  ' + v);
    console.error(
      '\nFix the filename that caused this — do not add an entry to scripts/migration-prefix-baseline.json.'
    );
    process.exit(1);
  }

  console.log(
    `MIGRATION PREFIXES OK (${sqlFiles.length} files, ${warnings.length} grandfathered).`
  );
}

run();
