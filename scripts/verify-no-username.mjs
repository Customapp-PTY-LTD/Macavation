#!/usr/bin/env node
/**
 * username:verify — proves the dropped users.username column has not crept back
 * into runtime code (same enforcement-as-code philosophy as ui:verify /
 * routing:verify / rbac:verify).
 *
 * Background: public.users.username was removed in favour of first_name /
 * last_name (migrations 20260708130000 + 20260709120000). The live database is
 * clean, but two runtime layers reference columns the DB *can't* police:
 *   - the browser portal (WebPortal/**), and
 *   - Supabase Edge Functions (supabase/functions/**),
 * which is exactly where drift caused live 500s (auth-google) after the drop.
 *
 * This check fails, with file:line, if the token `username` reappears in those
 * layers. The user-facing display helpers are camelCase ("getUserName",
 * "updateUserNameDisplay") and do NOT contain the lowercase token, so the match
 * is case-sensitive to avoid flagging them.
 *
 * Scope note: migrations/ are immutable history (older ones legitimately read
 * username before the rewrite/drop) so they are out of scope; everything else
 * that runs — the portal, edge functions, AND the Playwright suite — is guarded.
 *
 * Two match modes avoid false positives:
 *   - 'word'    : any lowercase `username` token. Used for runtime code (WebPortal
 *                 + edge functions), which is currently zero and where the word
 *                 only appears as the dropped column — this is what catches a
 *                 SQL/PostgREST select-string like the auth-google 500.
 *   - 'pattern' : only the dangerous forms `.username`, `#username`, 'username',
 *                 `username:`. Used for tests so explanatory prose and the
 *                 migration filename don't trip it, while real reintroductions
 *                 (selectors, property access, fixtures) still fail.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const WORD = /username/;                                          // case-sensitive bare token
const PATTERN = /\.username\b|#username\b|['"`]username['"`]|\busername\s*:/i;

// Every layer that runs. Add here if new runtime/test code appears.
const SCAN = [
  { dir: path.join(ROOT, 'WebPortal'), exts: ['.js', '.html'], skip: new Set(['node_modules', 'assets', 'help']), mode: 'word' },
  { dir: path.join(ROOT, 'supabase', 'functions'), exts: ['.ts'], skip: new Set(['node_modules']), mode: 'word' },
  { dir: path.join(ROOT, 'Playwright Tests'), exts: ['.ts', '.js', '.mjs'], skip: new Set(['node_modules', 'test-results', 'playwright-report']), mode: 'pattern' },
];

function walk(dir, exts, skip, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skip.has(entry.name)) walk(path.join(dir, entry.name), exts, skip, out);
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const violations = [];
for (const { dir, exts, skip, mode } of SCAN) {
  const rule = mode === 'pattern' ? PATTERN : WORD;
  for (const file of walk(dir, exts, skip)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (rule.test(line)) {
        violations.push(`${path.relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 100)}`);
      }
    });
  }
}

if (violations.length) {
  console.error(`USERNAME DRIFT (${violations.length}) — public.users.username was dropped; use first_name / last_name:\n`);
  for (const v of violations) console.error('  ' + v);
  console.error('\nRuntime code must not read the removed column. See migrations/20260709120000_drop_users_username_column.sql');
  process.exit(1);
}
console.log('NO USERNAME DRIFT — portal, edge functions and Playwright suite are free of the dropped users.username column.');
