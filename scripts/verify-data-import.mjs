#!/usr/bin/env node
/**
 * Hermetic checks for "Fill gaps from a file" on the Data health tab
 * (migrations/20261015090000_data_page_import_batches.sql, supabase/functions/read-import-file,
 * WebPortal/modules/sales-data/js/data-import-wizard.js). No DB, no browser, no network.
 *
 * Guards what would silently break it:
 *  - an import RPC that writes 'manual' (the batch could then never be undone or told apart)
 *  - a GRANT without anon (every portal RPC runs with the anon key)
 *  - the AI function losing its session or permission check, or its refusal handling
 *  - an API key or innerHTML in browser code
 *  - the wizard script loading after the panel that calls it
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

// 1. Migration
const MIG = 'migrations/20261015090000_data_page_import_batches.sql';
check(exists(MIG), `${MIG} is missing`);
if (exists(MIG)) {
    const sql = read(MIG);
    const fns = {
        import_data_page_rows: '(text, text, text, jsonb, uuid)',
        undo_data_import_batch: '(uuid, uuid)',
        get_data_import_batches: '(text, integer)'
    };
    for (const [fn, sig] of Object.entries(fns)) {
        check(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public`).test(sql),
            `${fn}: must be SECURITY DEFINER with SET search_path = public`);
        const g = sql.match(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\${sig.replace(')', '\\)')} TO ([^;]+);`));
        check(g && /\banon\b/.test(g[1]), `${fn}${sig}: GRANT EXECUTE must include anon`);
        check(sql.includes(`REVOKE ALL ON FUNCTION public.${fn}${sig} FROM PUBLIC`), `${fn}${sig}: REVOKE ALL ... FROM PUBLIC missing`);
    }
    check(/GRANT EXECUTE ON FUNCTION public\.data_import_role_can_edit\(text\) TO service_role;/.test(sql),
        'data_import_role_can_edit must be granted to service_role only');
    check(/REVOKE ALL ON public\.data_import_batches FROM anon, authenticated/.test(sql), 'data_import_batches must be revoked from anon and authenticated');
    for (const t of ['data_nis_intake', 'data_kernel_sales_lines', 'data_oil_sales_lines', 'data_oil_export_register']) {
        check(new RegExp(`ALTER TABLE public\\.${t}\\s+ADD COLUMN IF NOT EXISTS import_batch_id`).test(sql), `${t}: import_batch_id column missing`);
        check(new RegExp(`INSERT INTO public\\.${t}[\\s\\S]*?'imported'`).test(sql), `${t}: import must insert data_source = 'imported'`);
    }
    const importFn = (sql.match(/FUNCTION public\.import_data_page_rows[\s\S]*?\n\$\$;/) || [''])[0];
    check(importFn && !/'manual'/.test(importFn), "import_data_page_rows must never write 'manual'");
    check(/WHEN unique_violation/.test(importFn), 'import_data_page_rows must turn a unique_violation into a plain message');
    check(/export_twin_auto_linked/.test(importFn), 'import_data_page_rows must link oil export twins');
    check(/data_source = 'imported'/.test(sql.match(/FUNCTION public\.undo_data_import_batch[\s\S]*?\n\$\$;/)?.[0] || ''),
        "undo_data_import_batch must only remove rows that are still 'imported'");
    check(sql.includes("NOTIFY pgrst, 'reload schema'"), 'migration must end with NOTIFY pgrst');
}

// 1b. Fill everything: groups (migrations/20261015120000_data_import_groups.sql)
const MIG2 = 'migrations/20261015120000_data_import_groups.sql';
check(exists(MIG2), `${MIG2} is missing`);
if (exists(MIG2)) {
    const sql = read(MIG2);
    const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
    const fns = {
        import_data_pages: '(text, jsonb, uuid)',
        undo_data_import_group: '(uuid, uuid)',
        get_data_import_batches: '(text, integer)'
    };
    for (const [fn, sig] of Object.entries(fns)) {
        check(new RegExp(`FUNCTION public\\.${fn}\\([\\s\\S]*?SECURITY DEFINER[\\s\\S]*?SET search_path = public`).test(code),
            `${fn}: must be SECURITY DEFINER with SET search_path = public`);
        const g = code.match(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\${sig.replace(')', '\\)')} TO ([^;]+);`));
        check(g && /\banon\b/.test(g[1]), `${fn}${sig}: GRANT EXECUTE must include anon`);
        check(code.includes(`REVOKE ALL ON FUNCTION public.${fn}${sig} FROM PUBLIC`), `${fn}${sig}: REVOKE ALL ... FROM PUBLIC missing`);
    }
    const importAll = (code.match(/FUNCTION public\.import_data_pages[\s\S]*?\n\$\$;/) || [''])[0];
    check(/import_data_page_rows\(/.test(importAll), 'import_data_pages must save each page through import_data_page_rows');
    check(/RAISE EXCEPTION/.test(importAll) && /WHEN raise_exception/.test(importAll),
        'import_data_pages must roll every page back when one fails (raise inside a caught block)');
    check(!/INSERT INTO public\.data_(nis|kernel|oil)/.test(importAll), 'import_data_pages must not insert ledger rows itself');
    check(/undo_data_import_batch\(/.test((code.match(/FUNCTION public\.undo_data_import_group[\s\S]*?\n\$\$;/) || [''])[0]),
        'undo_data_import_group must undo through undo_data_import_batch');
    check(/import_group_id uuid\)/.test(code), 'get_data_import_batches must return import_group_id');
    check(!/\bDROP\s+FUNCTION\b/i.test(code), `${MIG2}: rename the old function rather than DROP it`);
    check(code.includes("NOTIFY pgrst, 'reload schema'"), `${MIG2}: must end with NOTIFY pgrst`);
}

// 2. Edge function
const FN = 'supabase/functions/read-import-file/index.ts';
check(exists(FN), `${FN} is missing`);
if (exists(FN)) {
    const ts = read(FN);
    check(ts.includes('assistant_validate_session'), 'read-import-file must validate the portal session');
    check(ts.includes('data_import_role_can_edit'), 'read-import-file must check the reports.data.edit permission');
    check(ts.includes('"claude-opus-5-5"'), 'read-import-file must use claude-opus-5-5');
    check(/stop_reason === "refusal"/.test(ts), 'read-import-file must handle a refusal before reading content');
    check(!/\.(from|insert|update|upsert|delete)\(/.test(ts.replace(/sb\.rpc\(/g, '')), 'read-import-file must not write to the database');
    check(/verify_jwt\s*=\s*false/.test(read('supabase/functions/read-import-file/config.toml')), 'read-import-file/config.toml must set verify_jwt = false');
    check(/action === "identify_sheets"/.test(ts) && /handleIdentifySheets/.test(ts), 'read-import-file must handle identify_sheets');
    const ident = (ts.match(/async function handleIdentifySheets[\s\S]*?\r?\n}\r?\n/) || [''])[0];
    check(/cleanSheets\(body\.sheets\)/.test(ident), 'identify_sheets must send only cleaned headings and sample rows (cleanSheets)');
    check(/MAX_SAMPLE_ROWS\s*=\s*5\b/.test(ts), 'read-import-file must cap sample rows at 5');
}

// 3. Browser code
const JS = [
    'WebPortal/modules/sales-data/js/data-import-wizard.js',
    'WebPortal/modules/sales-data/js/data-health-panel.js',
    'WebPortal/modules/sales-data/js/data-import-all-wizard.js'
];
for (const f of JS) {
    check(exists(f), `${f} is missing`);
    if (!exists(f)) continue;
    const src = read(f);
    check(!/\.innerHTML\s*=/.test(src), `${f}: assigns innerHTML - use textContent`);
    check(!/\.html\(/.test(src), `${f}: uses .html() - use .text()`);
    check(!/['"`][^'"`\n]*#[0-9a-fA-F]{3,8}\b[^'"`\n]*['"`]/.test(src), `${f}: hex colour literal`);
    check(!/rgba?\(\s*\d/.test(src), `${f}: rgb()/rgba() literal`);
}
const wiz = exists(JS[0]) ? read(JS[0]) : '';
check(/importDataPageRows/.test(wiz) && !/upsertData\w+\(/.test(wiz), 'the wizard must save through importDataPageRows, never the upsert wrappers');
check(/invalidateLedgers/.test(wiz) && /flushAutoSave/.test(wiz), 'the wizard must flush pending edits and invalidate ledgers around a write');

const all = exists(JS[2]) ? read(JS[2]) : '';
check(/importDataPages\(/.test(all) && !/upsertData\w+\(|importDataPageRows\(/.test(all),
    'Fill everything must save through importDataPages only (one transaction, one Undo)');
check(/DataImportWizard\.engine/.test(all) && /withState\(/.test(all) && /\.classify\(\)/.test(all),
    'Fill everything must check rows with the one-page wizard\'s engine (classify), not a copy of it');
check(/flushGrid\(\)/.test(all) && /invalidateLedgers/.test(all), 'Fill everything must flush pending edits and invalidate ledgers around a write');
check(/withState: function/.test(wiz) && /finally[\s\S]{0,40}S = saved/.test(wiz), 'DataImportWizard.engine.withState must restore the wizard state in finally');

const df = read('WebPortal/js/data-functions.js');
for (const w of ['importDataPageRows', 'undoDataImportBatch', 'getDataImportBatches', 'readImportFile', 'importDataPages', 'undoDataImportGroup']) {
    check(new RegExp(`\\b${w}: async function`).test(df), `data-functions.js: ${w} missing`);
}
check(/invalidateLedgers: function/.test(read('WebPortal/modules/sales-data/js/sales_data_grid.js')), 'sales_data_grid.js must export invalidateLedgers');

// No Anthropic key anywhere in browser code.
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
for (const f of walk(path.join(ROOT, 'WebPortal')).filter((f) => /\.(js|html)$/.test(f))) {
    const src = fs.readFileSync(f, 'utf8');
    if (/sk-ant-|ANTHROPIC_API_KEY|ASSISTANT_AI_API_KEY/.test(src)) failures.push(`${path.relative(ROOT, f)}: mentions an Anthropic key`);
}

// 4. Route order: the panel calls the wizard, so the wizard must load first.
const cfg = read('WebPortal/js/appRouteConfig.json');
const block = (cfg.match(/"sales-data-grid"\s*:\s*\{[\s\S]*?\]/) || [''])[0];
const iw = block.indexOf('js/data-import-wizard.js'), ia = block.indexOf('js/data-import-all-wizard.js'), ip = block.indexOf('js/data-health-panel.js');
check(iw !== -1 && ip !== -1 && iw < ip, 'sales-data-grid must load js/data-import-wizard.js before js/data-health-panel.js');
check(ia !== -1 && iw < ia && ia < ip, 'sales-data-grid must load js/data-import-all-wizard.js after the one-page wizard and before the panel');

if (failures.length) {
    console.error('verify-data-import: FAIL');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
}
console.log('verify-data-import: OK (migration, AI function auth, browser safety, route order)');
