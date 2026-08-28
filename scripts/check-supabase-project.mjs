#!/usr/bin/env node
/**
 * Guardrail: fail if repo files target FruitLive or an unknown Supabase project.
 * On the dev branch, linked/portal dev environments must use UAT (nmdmddugxclpqrwylyfa).
 *
 * Usage:
 *   node scripts/check-supabase-project.mjs
 *   npm run db:check-project
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  UAT,
  PRODUCTION,
  BLOCKED_PROJECT_REFS,
  assertAllowedSupabaseUrl,
  anonKeyMatchesProject,
} from './lib/supabase-projects.mjs';
import { readExpectedRemoteRef, verifyCliLinkedProject } from './lib/macavation-supabase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const SCAN_DIRS = [
  'WebPortal/js',
  'WebPortal',
  'scripts',
  'migrations',
  '.cursor',
  'supabase',
];

const SCAN_FILES = [];

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
  '.cursor/mcp.json',
  'supabase/remote.toml',
  'supabase/projects.json',
];

const GUARD_FILES = new Set([
  'scripts/lib/macavation-supabase.mjs',
  'scripts/lib/supabase-projects.mjs',
  'scripts/check-supabase-project.mjs',
  'WebPortal/js/macavation-supabase.js',
  'supabase/projects.json', // defines blockedRefs — the blocklist itself
  '.cursor/rules/supabase-macavation-only.mdc',
  '.cursor/rules/supabase-dev-uat.mdc',
]);

let errors = [];

function shouldSkipFile(filePath) {
  return SKIP_FILE_PATTERNS.some((re) => re.test(filePath));
}

function isBlockedSupabaseUsage(line) {
  // Any usage of a blocked project ref (FruitLive, the parked 'archive'
  // branch, ...) anywhere in the repo is an error — nothing may point at them.
  return BLOCKED_PROJECT_REFS.some((ref) => line.includes(ref));
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

function verifyRemoteToml() {
  try {
    const ref = readExpectedRemoteRef(root);
    if (ref !== UAT.ref) {
      errors.push(`supabase/remote.toml: on dev branch expected UAT ref ${UAT.ref}, got ${ref}`);
    }
  } catch (err) {
    errors.push(String(err.message || err));
  }
}

function verifyCliLink() {
  // Local-only check. The CLI records its link in supabase/.temp/project-ref,
  // which supabase/.gitignore excludes, so the file can never exist on a fresh
  // CI checkout and the workflow has no `supabase link` step. Asserting it in
  // CI made this guard fail on every run of every branch — including pushes to
  // prod — which is indistinguishable from having no guard at all. Skipping it
  // in CI keeps the checks that DO work there (blocked project refs,
  // remote.toml, MCP pin, anon keys, appRouteConfig URLs) meaningful.
  if (process.env.CI) {
    console.log('Supabase CLI link: skipped (CI has no local CLI link).');
    return;
  }
  try {
    verifyCliLinkedProject(root);
  } catch (err) {
    errors.push(`Supabase CLI link: ${err.message || err}`);
  }
}

function verifyMcpPin() {
  const mcpPath = path.join(root, '.cursor', 'mcp.json');
  if (!fs.existsSync(mcpPath)) return;
  const content = fs.readFileSync(mcpPath, 'utf8');
  if (!content.includes(UAT.ref)) {
    errors.push(`.cursor/mcp.json: must pin MCP to UAT project_ref=${UAT.ref}`);
  }
}

function verifyUatAnonKeyConfigured() {
  if (!UAT.anonKey || !anonKeyMatchesProject(UAT.anonKey, UAT.ref)) {
    errors.push(
      'supabase/projects.json: set uat.anonKey from Dashboard → Macavation UAT → Settings → API, then run npm run supabase:sync-portal'
    );
  }
}

function verifyAppRouteConfigUrls() {
  // Every environment except prod must use the dev database. ('uat' kept in
  // case an old config still carries the key.)
  const devEnvs = new Set(['default', 'dev', 'demo', 'uat']);
  for (const rel of ['WebPortal/js/appRouteConfig.json']) {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) continue;
    const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    const settings = json.environmentSettings || {};
    for (const [env, cfg] of Object.entries(settings)) {
      try {
        assertAllowedSupabaseUrl(cfg.SupabaseUrl);
      } catch (err) {
        errors.push(`${rel} (${env}): ${err.message}`);
      }
      if (devEnvs.has(env)) {
        if (!cfg.SupabaseUrl || !cfg.SupabaseUrl.includes(UAT.ref)) {
          errors.push(`${rel} (${env}): must use UAT URL ${UAT.apiUrl}`);
        }
        if (!cfg.SupabaseAnonKey || !anonKeyMatchesProject(cfg.SupabaseAnonKey, UAT.ref)) {
          errors.push(`${rel} (${env}): missing or invalid UAT anon key (run npm run supabase:sync-portal)`);
        }
      }
      if (env === 'prod' && cfg.SupabaseUrl && !cfg.SupabaseUrl.includes(PRODUCTION.ref)) {
        errors.push(`${rel} (prod): must keep production URL ${PRODUCTION.apiUrl}`);
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

verifyRemoteToml();
verifyCliLink();
verifyMcpPin();
verifyUatAnonKeyConfigured();
verifyAppRouteConfigUrls();

if (errors.length) {
  console.error('Supabase project guard failed:\n');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  process.exit(1);
}

console.log(
  `Supabase project guard OK (dev DB ${UAT.ref}; ` +
    `CLI link ${process.env.CI ? 'not checked in CI' : 'verified'}).`
);
