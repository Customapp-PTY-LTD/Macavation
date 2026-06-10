#!/usr/bin/env node
/**
 * Verify which Supabase project the Web Portal uses for direct REST vs Lambda proxy.
 * Localhost (dev env) points SupabaseUrl at UAT, but Lambda still serves production data
 * until uat.lambdaProxyUrl is configured in supabase/projects.json.
 *
 * Usage:
 *   node scripts/verify-portal-data-routing.mjs
 *   npm run verify:portal-routing
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCTION, UAT } from './lib/supabase-projects.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const routeConfigPath = path.join(root, 'WebPortal/js/appRouteConfig.json');
const routeConfig = JSON.parse(fs.readFileSync(routeConfigPath, 'utf8'));

const PROD_LAMBDA =
  PRODUCTION.lambdaProxyUrl ||
  'https://rzrx6ntfejvb6lxpmt4ywruvt40mjjuo.lambda-url.af-south-1.on.aws/proxy/function';
const UAT_LAMBDA = (UAT.lambdaProxyUrl || '').trim() || PROD_LAMBDA;
const PROD_LAMBDA_HOST = PROD_LAMBDA.replace(/^https?:\/\//, '').split('/')[0];

function refFromUrl(url) {
  const m = String(url || '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return m ? m[1] : null;
}

function checkEnv(name, settings) {
  const supabaseRef = refFromUrl(settings.SupabaseUrl);
  const lambdaHost = (settings.LambdaProxyUrl || '').replace(/^https?:\/\//, '').split('/')[0];
  const directDb = supabaseRef === UAT.ref ? 'UAT' : supabaseRef === PRODUCTION.ref ? 'production' : 'unknown';
  const usesProdLambda = settings.LambdaProxyUrl === PROD_LAMBDA || !UAT.lambdaProxyUrl;
  const lambdaDb = usesProdLambda
    ? 'production (shared Lambda SUPABASE_URL)'
    : settings.LambdaProxyUrl === UAT_LAMBDA
      ? 'UAT (dedicated Lambda SUPABASE_URL)'
      : settings.LambdaProxyUrl
        ? 'custom Lambda (verify AWS SUPABASE_URL env)'
        : 'not set';

  return {
    env: name,
    supabaseUrl: settings.SupabaseUrl,
    directRestTarget: directDb,
    lambdaProxyUrl: settings.LambdaProxyUrl || '(missing)',
    lambdaDataTarget: lambdaDb,
    localhostUsesThis: ['default', 'dev', 'uat'].includes(name),
  };
}

const rows = Object.entries(routeConfig.environmentSettings || {}).map(([name, s]) =>
  checkEnv(name, s)
);

console.log('Web Portal data routing verification\n');
console.log('Canonical projects:');
console.log(`  UAT:        ${UAT.ref} (${UAT.apiUrl})`);
console.log(`  Production: ${PRODUCTION.ref} (${PRODUCTION.apiUrl})`);
console.log('');

for (const row of rows) {
  console.log(`Environment: ${row.env}${row.localhostUsesThis ? '  ← localhost / 127.0.0.1' : ''}`);
  console.log(`  SupabaseUrl (direct PostgREST): ${row.supabaseUrl}`);
  console.log(`  Direct REST reads/writes:       ${row.directRestTarget}`);
  console.log(`  LambdaProxyUrl:                 ${row.lambdaProxyUrl}`);
  console.log(`  Auth + callFunction data:       ${row.lambdaDataTarget}`);
  console.log('');
}

const dev = rows.find((r) => r.env === 'dev');
const mismatch =
  dev &&
  dev.directRestTarget === 'UAT' &&
  dev.lambdaDataTarget.startsWith('production');

console.log('Summary');
if (mismatch) {
  console.log(
    '  MISMATCH: localhost dev env uses UAT for direct REST but production for Lambda (login + most modules).'
  );
  console.log('  This is why Supabase UAT table data differs from what you see on http://127.0.0.1.');
} else {
  console.log('  Dev environment routing is consistent (or UAT Lambda is configured).');
}

const devLambdaHost = (dev?.lambdaProxyUrl || '')
  .replace(/^https?:\/\//, '')
  .replace(/\/proxy\/function$/, '')
  .split('/')[0];

console.log('');
console.log('Browser verification (DevTools → Network):');
console.log('  1. Open http://127.0.0.1:3002/WebPortal/index.html and sign in');
console.log(`  2. Expect POST to ${devLambdaHost}/auth/login (${dev?.lambdaDataTarget || 'dev Lambda'})`);
console.log(`  3. Expect POST to ${devLambdaHost}/proxy/function (${dev?.lambdaDataTarget || 'dev Lambda'})`);
console.log(`  4. Occasional POST to ${UAT.ref}.supabase.co/rest/v1/rpc/... (kernel direct fallback only)`);
console.log('');
console.log('Console check after app loads:');
console.log('  _appRouter.getEnvironment()  // "dev" on 127.0.0.1');
console.log('  _appRouter.SupabaseUrl       // UAT URL');
console.log('  dataFunctions.proxyUrl       // Lambda URL');

process.exit(mismatch ? 0 : 0);
