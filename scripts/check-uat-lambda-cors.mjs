#!/usr/bin/env node
/**
 * Detect duplicate Access-Control-Allow-Origin on the UAT Lambda (breaks browser sign-in).
 *
 * Usage: npm run verify:uat-lambda-cors
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { UAT } from './lib/supabase-projects.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const base = String(UAT.lambdaProxyUrl || '').replace(/\/proxy\/function$/, '');
if (!base) {
  console.error('uat.lambdaProxyUrl is not set in supabase/projects.json');
  process.exit(1);
}

const url = `${base}/auth/login`;
const bodyPath = path.join(os.tmpdir(), 'macavation-cors-check.json');
fs.writeFileSync(bodyPath, JSON.stringify({ email: 'cors-check@example.com', password: 'wrong' }));

const curlBin = process.platform === 'win32' ? 'curl.exe' : 'curl';
const result = spawnSync(
  curlBin,
  [
    '-s',
    '-i',
    '-X',
    'POST',
    url,
    '-H',
    'Origin: http://127.0.0.1:3002',
    '-H',
    'Content-Type: application/json',
    '-d',
    `@${bodyPath}`,
  ],
  { encoding: 'utf8' }
);

fs.unlinkSync(bodyPath);

if (result.error || result.status !== 0) {
  console.error('curl failed:', result.error || result.stderr || result.stdout);
  process.exit(1);
}

const [headerBlock] = result.stdout.split(/\r?\n\r?\n/);
const statusLine = (headerBlock.match(/^HTTP\/[^\r\n]+/m) || [''])[0];
const originLines = headerBlock.match(/^access-control-allow-origin:.*$/gim) || [];

console.log(`POST ${url}`);
console.log(statusLine);
console.log(`access-control-allow-origin header lines: ${originLines.length}`);
originLines.forEach((line) => console.log(`  ${line}`));

if (originLines.length > 1) {
  console.error(
    '\nFAIL: Duplicate CORS headers. Disable Function URL CORS in AWS Lambda console\n' +
      '(Configuration → Function URL → Edit → uncheck CORS). See docs/setup/UAT_LAMBDA.md'
  );
  process.exit(1);
}

if (originLines.length === 0) {
  console.error('\nFAIL: No Access-Control-Allow-Origin — browser cross-origin calls will fail.');
  process.exit(1);
}

console.log('\nOK: Single Access-Control-Allow-Origin — browser sign-in should work.');
