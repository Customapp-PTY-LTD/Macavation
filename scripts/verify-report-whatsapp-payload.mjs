#!/usr/bin/env node
/**
 * report-whatsapp-payload:verify — hand-traces the three request-validation regexes and the
 * %PDF- magic-number check inside supabase/functions/send-report-whatsapp/index.ts.
 *
 * These are security controls (the filename allowlist composes a storage object path; the
 * base64 and uuid allowlists gate what reaches atob() / a database lookup), so they are
 * checked here rather than only at deploy/runtime — this repo's test:fleet gate must stay
 * pure Node stdlib with no browser, no login, no network (package.json's own "//test:fleet"
 * comment), so this cannot invoke Deno or spin up the function itself.
 *
 * How this stays honest instead of drifting from the real source: parsing an arbitrary JS
 * regex literal back out of source text is itself a parsing problem (e.g. an unescaped `/`
 * is legal inside a `[...]` character class, as BASE64_RE below has), so this script does not
 * attempt it. Instead it asserts the EXACT literal source text is still present verbatim in
 * the .ts file, and separately re-declares an identical copy to run every test case against.
 * If a future edit changes the literal in the .ts file, the presence assertion fails loudly
 * and tells whoever changed it to update the copy here too — silent drift is not possible,
 * only a caught one.
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'supabase/functions/send-report-whatsapp/index.ts');

function fail(msg) {
  console.error(`REPORT WHATSAPP PAYLOAD VERIFY FAILED: ${msg}`);
  process.exit(1);
}

let source;
try {
  source = fs.readFileSync(SOURCE_PATH, 'utf8');
} catch (err) {
  fail(`cannot read ${SOURCE_PATH}: ${err.message}`);
}

// ----------------------------------------------------------------------------------------
// 1. Presence — the exact literal source text must still be in the file.
// ----------------------------------------------------------------------------------------

const EXPECTED_LITERALS = {
  UUID_RE:
    "const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\\s\\S])/i;",
  FILENAME_RE: "const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\\.pdf(?![\\s\\S])/;",
  BASE64_RE: "const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}(?![\\s\\S])/;",
};

let missing = 0;
for (const [name, literal] of Object.entries(EXPECTED_LITERALS)) {
  if (!source.includes(literal)) {
    console.error(`  missing/changed literal for ${name}: expected to find exactly:\n    ${literal}`);
    missing++;
  }
}
if (missing) {
  fail(
    `${missing} regex literal(s) in send-report-whatsapp/index.ts no longer match what this script tests. ` +
      'Update EXPECTED_LITERALS (and the hand-traced test cases below) to match the new source.'
  );
}

// Also confirm the %PDF- magic-number constant is unchanged.
const PDF_MAGIC_LITERAL = 'const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"';
if (!source.includes(PDF_MAGIC_LITERAL)) {
  fail(`PDF_MAGIC constant no longer matches expected literal:\n    ${PDF_MAGIC_LITERAL}`);
}

// ----------------------------------------------------------------------------------------
// 2. Re-test — an identical copy of each literal, run against every required case.
// ----------------------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i;
const FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.pdf(?![\s\S])/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}(?![\s\S])/;
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function hasPdfMagic(bytes) {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

let checked = 0;
function expectReject(re, value, label) {
  checked++;
  assert.equal(re.test(value), false, `${label}: expected REJECT for ${JSON.stringify(value)}`);
}
function expectAccept(re, value, label) {
  checked++;
  assert.equal(re.test(value), true, `${label}: expected ACCEPT for ${JSON.stringify(value)}`);
}

// --- filename --------------------------------------------------------------------------
const filenameRejects = [
  '../../etc/passwd',
  'a/b.pdf',
  '..pdf',
  'report.pdf.exe',
  '',
  'x'.repeat(90) + '.pdf',
  'report.pdf\n',
  'report.pdf\r',
  'report.pdf\r\n',
];
for (const v of filenameRejects) expectReject(FILENAME_RE, v, 'FILENAME_RE');
for (const v of ['Macavation-August-2026.pdf', 'r.pdf']) expectAccept(FILENAME_RE, v, 'FILENAME_RE');

// --- base64 -----------------------------------------------------------------------------
const base64Rejects = ['data:application/pdf;base64,AAAA', 'A A A', '****', '', 'QUJDRA==\n'];
for (const v of base64Rejects) expectReject(BASE64_RE, v, 'BASE64_RE');
expectAccept(BASE64_RE, 'QUJDRA==', 'BASE64_RE');

// --- uuid ---------------------------------------------------------------------------------
const VALID_UUID = '123e4567-e89b-12d3-a456-426614174000';
expectReject(UUID_RE, VALID_UUID + '\n', 'UUID_RE');
expectAccept(UUID_RE, VALID_UUID, 'UUID_RE');

// --- %PDF- magic number ---------------------------------------------------------------------
checked++;
assert.equal(hasPdfMagic(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00])), true, '%PDF- must be accepted');
checked++;
assert.equal(hasPdfMagic(Uint8Array.from([0x50, 0x4b, 0x03, 0x04])), false, 'PK (zip) must be rejected');

console.log(`REPORT WHATSAPP PAYLOAD VERIFY OK (${checked} cases, 3 regex literals + PDF_MAGIC confirmed present).`);
