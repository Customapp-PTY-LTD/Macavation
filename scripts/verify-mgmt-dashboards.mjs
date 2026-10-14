#!/usr/bin/env node
/**
 * Hermetic checks for the Kernel / Oil dashboards and the Data health tab
 * (migrations/20261014120000_kernel_oil_dashboards_data_health.sql). No DB, no browser.
 *
 * Guards the things that broke or nearly broke when this was designed:
 *  - GRANT must include anon: every portal RPC runs with the anon key, so an authenticated-only
 *    grant makes every section say "not available yet" forever.
 *  - Menu items need class="nav-item d-none" or menu-filter.js never hides them from other roles.
 *  - The three hand-versioned scripts must carry the same ?v=, or a stale data-functions.js lacks
 *    the new wrappers.
 *  - No innerHTML assignment and no colour literals in the new JS.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

// 1. Migration
const MIG = 'migrations/20261014120000_kernel_oil_dashboards_data_health.sql';
check(fs.existsSync(path.join(ROOT, MIG)), `${MIG} is missing`);
if (fs.existsSync(path.join(ROOT, MIG))) {
    const sql = read(MIG);
    const fns = {
        get_kernel_dashboard_procurement: '(date, date)',
        get_kernel_dashboard_production: '(date, date)',
        get_kernel_dashboard_sales: '(date, date, text)',
        get_oil_dashboard: '(date, date)',
        get_data_health: '(date, date)'
    };
    for (const [fn, sig] of Object.entries(fns)) {
        const def = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS jsonb[\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public`);
        check(def.test(sql), `${fn}: missing, or not SECURITY DEFINER with SET search_path = public`);
        const grant = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\${sig.replace(/\)$/, '\\)')} TO ([^;]+);`);
        const g = sql.match(grant);
        check(g && /\banon\b/.test(g[1]), `${fn}${sig}: GRANT EXECUTE must include anon`);
        check(sql.includes(`REVOKE ALL ON FUNCTION public.${fn}${sig} FROM PUBLIC`), `${fn}${sig}: REVOKE ALL ... FROM PUBLIC missing`);
    }
    check(/get_kernel_dashboard_sales\(p_from date, p_to date, p_style text DEFAULT NULL\)/.test(sql), 'get_kernel_dashboard_sales must take p_style text DEFAULT NULL');
    check(sql.includes("NOTIFY pgrst, 'reload schema'"), 'migration must end with NOTIFY pgrst');
    check(/role_permissions[\s\S]*NOT EXISTS/.test(sql), 'role_permissions inserts must use NOT EXISTS (no unique key)');
}

// 2. Routes and menu
const routeCfg = JSON.parse(read('WebPortal/js/appRouteConfig.json'));
const routes = routeCfg.routes || routeCfg;
const findRoute = (key) => {
    const stack = [routeCfg];
    while (stack.length) {
        const o = stack.pop();
        if (o && typeof o === 'object') {
            if (Object.prototype.hasOwnProperty.call(o, key) && o[key] && o[key].html) return o[key];
            Object.values(o).forEach((v) => stack.push(v));
        }
    }
    return null;
};
const indexHtml = read('WebPortal/index.html');
const router = read('WebPortal/js/appRouter.js');
const menuCfg = read('WebPortal/js/role-menu-config.js');
for (const key of ['kernel-dashboard', 'oil-dashboard']) {
    const r = findRoute(key);
    check(!!r, `appRouteConfig.json: route ${key} missing`);
    if (r) {
        for (const f of [r.html, ...(r.js || []), ...(r.css || [])]) {
            const p = path.join(ROOT, 'WebPortal', 'modules', r.path, f);
            check(fs.existsSync(p), `${key}: ${path.relative(ROOT, p)} does not exist`);
        }
    }
    check(router.includes(`'${key}': () =>`), `appRouter.js: handler for ${key} missing`);
    check(indexHtml.includes(`<li class="nav-item d-none" data-route="${key}">`), `index.html: ${key} sidebar item must be <li class="nav-item d-none" data-route="${key}">`);
    check(menuCfg.includes(`'${key}': {`) && menuCfg.includes(`'${key}',`), `role-menu-config.js: ${key} needs a menuStructure and a portalModuleOrder entry`);
}
const salesData = findRoute('sales-data-grid');
check(salesData && (salesData.js || []).indexOf('js/data-health-panel.js') !== -1 &&
    salesData.js.indexOf('js/data-health-panel.js') < salesData.js.indexOf('js/sales_data_grid.js'),
    'sales-data-grid must load js/data-health-panel.js before js/sales_data_grid.js');

// 3. Wrappers
const df = read('WebPortal/js/data-functions.js');
for (const w of ['getKernelDashboardProcurement', 'getKernelDashboardProduction', 'getKernelDashboardSales', 'getOilDashboard', 'getDataHealth']) {
    check(new RegExp(`\\b${w}: async function`).test(df), `data-functions.js: ${w} missing`);
}

// 4. Cache-busters agree
const v = (file) => (indexHtml.match(new RegExp(`js/${file.replace('.', '\\.')}\\?v=([^"]+)"`)) || [])[1];
const vs = ['data-functions.js', 'role-menu-config.js', 'appRouter.js'].map(v);
check(vs.every(Boolean) && new Set(vs).size === 1, `index.html: ?v= on data-functions.js, role-menu-config.js and appRouter.js must match (got ${vs.join(', ')})`);

// 5. New JS: no innerHTML assignment, no colour literals
const newJs = [
    'WebPortal/modules/management-dashboard/js/mgmt_dashboard_common.js',
    'WebPortal/modules/management-dashboard/js/kernel_dashboard.js',
    'WebPortal/modules/management-dashboard/js/oil_dashboard.js',
    'WebPortal/modules/sales-data/js/data-health-panel.js'
];
for (const f of newJs) {
    const src = read(f);
    check(!/\.innerHTML\s*=/.test(src), `${f}: assigns innerHTML - use textContent`);
    check(!/\.html\(/.test(src), `${f}: uses .html() - use .text()`);
    check(!/['"`][^'"`\n]*#[0-9a-fA-F]{3,8}\b[^'"`\n]*['"`]/.test(src), `${f}: hex colour literal - read a --mac-* token`);
    check(!/rgba?\(\s*\d/.test(src), `${f}: rgb()/rgba() literal - read a --mac-*-rgb token`);
}

if (failures.length) {
    console.error('verify-mgmt-dashboards: FAIL');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
}
console.log('verify-mgmt-dashboards: OK (dashboards, data health, routes, grants, cache-busters)');
