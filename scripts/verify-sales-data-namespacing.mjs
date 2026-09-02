#!/usr/bin/env node
/**
 * Guard against the bug that broke the Sales & Production Data page on dev AND prod:
 *
 *   sales_data_grid.js:906  var fyRange = fyRangeFor(start);
 *   -> Uncaught ReferenceError: fyRangeFor is not defined
 *
 * fyRangeFor is defined inside sales-data-row-grid.js's IIFE and reaches sales_data_grid.js only
 * as SalesDataRowGrid.fyRangeFor (which is how line 478 of the same file already called it). One
 * unqualified call was enough to break the entire page: applyPeriod() runs during boot, so the
 * ReferenceError rejected the boot chain into handlePeriodResolutionFailure(), which blanked the
 * tab body and re-disabled "Refresh from factory". The page had therefore NEVER rendered - and
 * because the failure surfaced as "Could not load the reporting period", it read as a database or
 * migration problem and sent the investigation to the wrong layer entirely.
 *
 * Nothing else in the fleet gate would have caught it: ui:verify checks styling, the migration
 * verifiers check SQL, and there is no browser in test:fleet (deliberately - see
 * .claude/rules/fleet-test-gate.md). This script closes that specific hole textually.
 *
 * What it enforces: inside WebPortal/modules/sales-data/, any identifier that is exported by a
 * sibling namespace (SalesDataRowGrid / SalesDataColumnDefs) must be called through that namespace
 * unless the calling file defines it itself.
 */

import fs from 'fs';
import path from 'path';

const MODULE_DIR = path.join('WebPortal', 'modules', 'sales-data', 'js');

// Files that define a `w.<Namespace> = { ... }` export block, and the global they attach to.
const PROVIDERS = [
    { file: 'sales-data-row-grid.js', namespace: 'SalesDataRowGrid' },
    { file: 'sales-data-column-defs.js', namespace: 'SalesDataColumnDefs' },
];

// Strip comments and string literals so a name mentioned in prose or inside a message is never
// reported as a call. Order matters: block comments first, then line comments, then strings.
function stripNonCode(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
        .replace(/'(?:\\.|[^'\\])*'/g, "''")
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

/** Names on the right-hand side of `w.<Namespace> = { a: a, b: b };` */
function exportedNames(src, namespace) {
    const start = src.indexOf(`w.${namespace} = {`);
    if (start === -1) return null;
    const open = src.indexOf('{', start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
        }
    }
    if (end === -1) return null;
    const names = new Set();
    for (const m of src.slice(open, end).matchAll(/([A-Za-z_$][\w$]*)\s*:/g)) {
        names.add(m[1]);
    }
    return names;
}

/** True when `file` declares `name` itself, so a bare call is legitimately local. */
function definesLocally(code, name) {
    const n = name.replace(/[$]/g, '\\$');
    return new RegExp(
        `(?:function\\s+${n}\\s*\\(|(?:var|let|const)\\s+${n}\\s*=)`
    ).test(code);
}

const errors = [];
const providerNames = new Map();

for (const { file, namespace } of PROVIDERS) {
    const full = path.join(MODULE_DIR, file);
    if (!fs.existsSync(full)) {
        errors.push(`${full}: expected provider file is missing.`);
        continue;
    }
    const names = exportedNames(fs.readFileSync(full, 'utf8'), namespace);
    if (!names || names.size === 0) {
        errors.push(`${full}: could not find the "w.${namespace} = { ... }" export block.`);
        continue;
    }
    providerNames.set(namespace, names);
}

if (providerNames.size === PROVIDERS.length) {
    const files = fs.readdirSync(MODULE_DIR).filter((f) => f.endsWith('.js'));
    for (const file of files) {
        const providerFor = PROVIDERS.find((p) => p.file === file);
        const full = path.join(MODULE_DIR, file);
        const raw = fs.readFileSync(full, 'utf8');
        const code = stripNonCode(raw);
        const lines = code.split(/\r?\n/);

        for (const [namespace, names] of providerNames) {
            // A provider may call its own helpers bare - that is the whole point of its IIFE.
            if (providerFor && providerFor.namespace === namespace) continue;

            for (const name of names) {
                if (definesLocally(code, name)) continue;
                const n = name.replace(/[$]/g, '\\$');
                // A call to `name(` where the preceding char is not `.` (so not already namespaced)
                // and not part of a longer identifier.
                const re = new RegExp(`(^|[^.\\w$])${n}\\s*\\(`);
                lines.forEach((line, i) => {
                    if (re.test(line)) {
                        errors.push(
                            `${full}:${i + 1}: "${name}" is exported by ${namespace} but called ` +
                            `bare. Use ${namespace}.${name}(...) - a bare call throws ` +
                            `ReferenceError at runtime.\n      ${line.trim()}`
                        );
                    }
                });
            }
        }
    }
}

if (errors.length) {
    console.error('SALES DATA NAMESPACING FAILED:\n');
    for (const e of errors) console.error('  - ' + e);
    console.error(
        `\n${errors.length} problem(s). These are runtime ReferenceErrors, not style issues: ` +
        'applyPeriod() runs during page boot, so one of them blanks the whole page.'
    );
    process.exit(1);
}

const total = [...providerNames.values()].reduce((n, s) => n + s.size, 0);
console.log(
    `SALES DATA NAMESPACING OK (${total} exported names across ` +
    `${providerNames.size} namespaces checked against every file in ${MODULE_DIR}).`
);
