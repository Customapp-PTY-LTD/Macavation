#!/usr/bin/env node
/**
 * verify-price-gate.mjs — keeps the "See costs and prices" gate on the functions that return rand
 * values (migration 20261128170000_role_price_gate.sql, MacView round 3).
 *
 * Each gated function was renamed to <name>__all and a gate with the original name now calls it,
 * blanking money fields for roles without the switch. A later migration that redefines the
 * original name with a full body would silently remove the gate. This check fails any migration
 * after the gate that defines one of these names without calling portal_actor_sees_prices().
 * (Change <name>__all instead; it is not callable from the browser.)
 *
 * Pure fs, no network. Part of npm run test:fleet.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const DIR = path.join(ROOT, 'migrations');
const GATE = '20261128170000_role_price_gate.sql';
const GATED = [
  'get_kernel_style_prices', 'get_kernel_dashboard_sales', 'get_kernel_dashboard_dispatch_sales',
  'get_transport_performance', 'get_report_transport', 'get_kernel_dispatch_returns',
  'get_data_kernel_sales_lines', 'get_data_oil_sales_lines', 'get_data_oil_export_register',
  // new screens built with the gate inside them
  'get_customer_performance', 'get_kernel_stock_prices', 'get_shell_overview',
];

const problems = [];
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
if (!files.includes(GATE)) problems.push(`missing ${GATE}`);

for (const f of files) {
  if (f < GATE.slice(0, 14)) continue;
  const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
  for (const fn of GATED) {
    const re = new RegExp(`FUNCTION\\s+(public\\.)?${fn}\\s*\\(`, 'i');
    if (!re.test(sql)) continue;
    // Each definition of the name must sit in a file that also calls the check.
    if (!/portal_actor_sees_prices\s*\(/.test(sql)) {
      problems.push(`${f}: redefines ${fn} without portal_actor_sees_prices(). Change ${fn}__all instead, or keep the check.`);
    }
  }
}

if (problems.length) {
  console.error('price-gate:verify FAILED');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
console.log(`price-gate:verify OK (${GATED.length} gated functions checked across migrations from ${GATE.slice(0, 14)})`);
