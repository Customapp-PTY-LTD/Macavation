#!/usr/bin/env node
/**
 * Guardrail: fail if active repo files target FruitLive or another non-Macavation Supabase project.
 *
 * Usage:
 *   node scripts/check-supabase-project.mjs
 *   npm run db:check-project
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  REQUIRED_PROJECT_REF,
  assertMacavationSupabaseUrl,
  readExpectedRemoteRef,
} from './lib/macavation-supabase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SCAN_DIRS = [
  'WebPortal/js',
  'WebPortal',
  'scripts',
  'migrations',
  '.cursor',
  'js',
  'supabase',
];

const SCAN_FILES = [
  'qa-data-seeder.html',
  'test-scenarios-viewer.html',
];

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.tmp_mig',
  'test-results',
]);

const SKIP_FILE_PATTERNS = [
  /[\\/]_results\.json$/i,
  /[\\/]seq_\d+_results\.json$/i,
  /[\\/]final_apply_results\.json$/i,
  /[\\/]batch_\d+_seed_results\.json$/i,
  /[\\/]node_modules[\\/]/i,
  /[\\/]\.tmp_mig[\\/]/i,
];

const REQUIRED_FILES = [
  'WebPortal/js/appRouteConfig.json',
  'WebPortal/js/macavation-supabase.js',
  'js/appRouteConfig.json',
  '.cursor/mcp.json',
  'supabase/remote.toml',
];

const GUARD_FILES = new Set([
  'scripts/lib/macavation-supabase.mjs',
  'scripts/check-supabase-project.mjs',
  'WebPortal/js/macavation-supabase.js',
  '.cursor/rules/supabase-macavation-only.mdc',
]);

let errors = [];

function shouldSkipFile(filePath) {
  return SKIP_FILE_PATTERNS.some((re) => re.test(filePath));
}

function isBlockedSupabaseUsage(line) {
  const patterns = [
    /project_ref\s*[:=]\s*["']iwxmuemrfopajwvqdiae["']/i,
    /PROJECT_REF\s*=\s*["']iwxmuemrfopajwvqdiae["']/i,
    /SupabaseUrl["']\s*:\s*["']https:\/\/iwxmuemrfopajwvqdiae\.supabase\.co/i,
    /supabaseUrl\s*:\s*["']https:\/\/iwxmuemrfopajwvqdiae\.supabase\.co/i,
    /https:\/\/iwxmuemrfopajwvqdiae\.supabase\.co/i,
  ];
  return patterns.some((re) => re.test(line));
}

function scanFile(absPath) {
  const rel = path.relative(root, absPath).replace(/\\/g, '/');
  if (shouldSkipFile(rel)) return;
  if (GUARD_FILES.has(rel)) return;

  const ext = path.extname(absPath).toLowerCase();
  const textExtensions = new Set([
    '.js', '.mjs', '.json', '.html', '.md', '.mdc', '.sql', '.toml', '.ts', '.css',
  ]);
  if (!textExtensions.has(ext)) return;

  const content = fs.readFileSync(absPath, 'utf8');
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (isBlockedSupabaseUsage(line)) {
      errors.push(`${rel}:${index + 1}: blocked FruitLive Supabase target`);
    }
  });
}

function walkDir(absDir) {
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.cursor') continue;
    const absPath = path.join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      walkDir(absPath);
    } else if (entry.isFile()) {
      scanFile(absPath);
    }
  }
}

function verifyRequiredFilesContainMacavation() {
  for (const rel of REQUIRED_FILES) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) {
      errors.push(`Missing required file: ${rel}`);
      continue;
    }
    const content = fs.readFileSync(abs, 'utf8');
    if (!content.includes(REQUIRED_PROJECT_REF)) {
      errors.push(`${rel}: must contain Macavation project ref ${REQUIRED_PROJECT_REF}`);
    }
  }
}

function verifyRemoteToml() {
  try {
    const ref = readExpectedRemoteRef(root);
    if (ref !== REQUIRED_PROJECT_REF) {
      errors.push(`supabase/remote.toml: expected ${REQUIRED_PROJECT_REF}, got ${ref}`);
    }
  } catch (err) {
    errors.push(String(err.message || err));
  }
}

function verifyAppRouteConfigUrls() {
  for (const rel of ['WebPortal/js/appRouteConfig.json', 'js/appRouteConfig.json']) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const settings = json.environmentSettings || {};
    for (const [env, cfg] of Object.entries(settings)) {
      try {
        assertMacavationSupabaseUrl(cfg.SupabaseUrl);
      } catch (err) {
        errors.push(`${rel} (${env}): ${err.message}`);
      }
    }
  }
}

for (const dir of SCAN_DIRS) {
  walkDir(path.join(root, dir));
}
for (const rel of SCAN_FILES) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) scanFile(abs);
}

verifyRequiredFilesContainMacavation();
verifyRemoteToml();
verifyAppRouteConfigUrls();

if (errors.length) {
  console.error('Supabase project guard failed:\n');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(`Supabase project guard OK (Macavation / ${REQUIRED_PROJECT_REF}).`);
