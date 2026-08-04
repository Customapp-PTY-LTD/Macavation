// Proves the routing guarantee for the working tree it is run in: only
// macavation.customapp.org and macavation.customapp.co.za may resolve to
// the production database.
const fs = require('fs');
const path = require('path');
const ROOT = process.argv[2] || '.';

const PROD_REF = 'sofanhfpxifgdtooefzq', DEV_REF = 'nmdmddugxclpqrwylyfa';
const cases = [
  ['macavation.customapp.org', true],
  ['MACAVATION.customapp.org', true],
  ['macavation.customapp.co.za', true],
  ['MACAVATION.customapp.co.za', true],
  ['dev-macavation.customapp.co.za', false],
  ['macavation.customapp.co.za.evil.com', false],
  ['dev-macavation.customapp.org', false],
  ['uat-macavation.customapp.org', false],
  ['localhost', false],
  ['127.0.0.1', false],
  ['demo-macavation.customapp.org', false],
  ['staging-macavation.customapp.org', false],
  ['macavation.customapp.org.evil.com', false],
  ['some-brand-new-host.example.com', false],
  ['', false],
];

function extractGetEnv(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = src.match(/getEnvironment: \(\) => \{([\s\S]*?)\n        \},/);
  if (!m) throw new Error('getEnvironment not found in ' + file);
  return new Function('location', m[1]);
}

let checked = 0;
for (const rel of ['WebPortal/js/appRouter.js']) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const cfgFile = path.join(path.dirname(file), 'appRouteConfig.json');
  const es = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).environmentSettings;
  if ('uat' in es) throw new Error('uat key still present in ' + cfgFile);
  const fn = extractGetEnv(file);
  for (const [host, expectProd] of cases) {
    const env = fn({ hostname: host });
    const setting = es[env] || es.default;
    const isProd = setting.SupabaseUrl.includes(PROD_REF);
    if (!isProd && !setting.SupabaseUrl.includes(DEV_REF)) {
      throw new Error(`${rel}: ${host} -> unknown DB ${setting.SupabaseUrl}`);
    }
    if (isProd !== expectProd) {
      throw new Error(`${rel}: ${host} -> ${isProd ? 'PROD' : 'DEV'}, expected ${expectProd ? 'PROD' : 'DEV'}`);
    }
  }
  checked++;
  console.log(`OK (${cases.length} hosts): ${rel} + config`);
}
if (!checked) throw new Error('no appRouter files found');

const macFile = path.join(ROOT, 'WebPortal/js/macavation-supabase.js');
if (fs.existsSync(macFile)) {
  const src = fs.readFileSync(macFile, 'utf8');
  function load(host) {
    const g = { location: { hostname: host } };
    new Function('globalThis', 'location', src.replace(/typeof window !== 'undefined' \? window : globalThis/, 'globalThis'))(g, g.location);
    return g.MACAVATION_SUPABASE;
  }
  for (const [host, expectProd] of cases) {
    const ref = load(host).projectRef;
    if ((ref === PROD_REF) !== expectProd) throw new Error(`macavation-supabase.js: ${host} -> ${ref}`);
    if (ref !== PROD_REF && ref !== DEV_REF) throw new Error(`macavation-supabase.js: ${host} -> unknown ref ${ref}`);
  }
  console.log(`OK (${cases.length} hosts): WebPortal/js/macavation-supabase.js`);
}
console.log('ROUTING GUARANTEE HOLDS for this tree');
