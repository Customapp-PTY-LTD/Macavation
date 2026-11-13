#!/usr/bin/env node
/**
 * verify-help-guide.mjs - checks WebPortal/help/index.html, the user guide that the
 * Portal Guide chat answers from (loaded into assistant_kb_chunk by
 * scripts/ingest-macavation-assistant-kb.mjs).
 *
 * Checks:
 *  1. Section ids are unique.
 *  2. Every section's text fits in one knowledge-base chunk (MAX_SECTION_CHARS), so the
 *     chat sees the whole section, never half of it.
 *  3. Every section has a SECTION_KEYWORDS entry in the ingest script (search weighting).
 *  4. No section still holds the old generated placeholder text, except the ids listed in
 *     PENDING_PLACEHOLDER. The guide rewrite (Nov 2026) removes ids from that list as it goes.
 *  5. Every sidebar screen (route: '...' in WebPortal/js/role-menu-config.js) has a section,
 *     either with the same id or via ROUTE_ALIASES, except the routes in PENDING_ROUTES.
 *     The rewrite removes routes from that list as it writes their sections.
 *
 * When you finish a section, DELETE its id from the pending list. Never add to the
 * pending lists to get a new section past this check - write the section instead.
 *
 * Run: npm run help-guide:verify
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const GUIDE = path.join(root, 'WebPortal', 'help', 'index.html');
const INGEST = path.join(root, 'scripts', 'ingest-macavation-assistant-kb.mjs');
const MENU = path.join(root, 'WebPortal', 'js', 'role-menu-config.js');

// The ingest script splits a section into chunks of 6000 chars; stay under it with room to spare.
const MAX_SECTION_CHARS = 5800;

// The text the July 2026 generator put in every section it had no real content for.
const PLACEHOLDER_PHRASES = [
    'Dialog opened from the related module',
    'Available from the navigation menu when your role includes access',
];

// Sections that still hold placeholder text. Remove an id once its section is rewritten.
const PENDING_PLACEHOLDER = new Set([
    // kernel production, quality and dispatch
    'modal-end-sample', 'modal-end-sample-view', 'modal-job-card-view', 'modal-kernel-dispatch',
    'modal-kernel-dispatch-edit', 'modal-kernel-dispatch-form', 'modal-kernel-job-card',
    'kernel-production-forecast-grid', 'modal-production-stages', 'modal-production-stages-view',
    'modal-quality-test', 'modal-send-to-dispatch',
    // stock
    'stock-alert-rules-grid', 'modal-stock-take', 'modal-raw-material-issued',
    // oil
    'modal-import-oil-lots', 'modal-oil-bulk-add-stock', 'modal-oil-dispatch', 'modal-oil-dispatch-form',
    'modal-oil-lot', 'oil-production-forecast-grid', 'modal-oil-production-sheet',
    'modal-send-to-dispatch-oil', 'modal-supplier-intake-adjust-stock', 'modal-supplier-oil-batch',
    'modal-supplier-receiver-checklist',
    // admin, CRM and messaging
    'modal-admin-add-role', 'modal-admin-add-user', 'modal-crm-contact', 'modal-feature',
    'messaging-compose-grid', 'modal-role', 'modal-role-feature', 'modal-role-permission', 'modal-user',
]);

// Sidebar routes whose screen is described by a section with a different id.
const ROUTE_ALIASES = {
    'nis-storage': 'silo-allocation-grid',          // the menu item forwards to Silo Holding
    'stock-management-kernel': 'stock-management-grid',
    'stock-management-oil': 'stock-management-grid',
    'admin-grid': 'admin-users-permissions',
    'dashboard': 'dashboard-overview',
    'batch-journey': 'batch-journey-grid',
    'crm-grid': 'crm-kernel-customers',
};

// Sidebar routes with no section yet. Remove a route once its section exists (id = the route).
const PENDING_ROUTES = new Set([
    'kernel-dashboard',
    'oil-dashboard', 'oil-raw-materials',
    'crm-whatsapp-grid', 'amanda-dashboard',
]);

const failures = [];
const fail = (msg) => failures.push(msg);

function stripTags(html) {
    return html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

const guide = fs.readFileSync(GUIDE, 'utf8');
const sectionRe = /<section\s+id="([^"]+)"\s+class="guide-section"[^>]*>([\s\S]*?)<\/section>/g;
const sections = new Map();
let m;
while ((m = sectionRe.exec(guide)) !== null) {
    if (sections.has(m[1])) fail(`Section id "${m[1]}" appears more than once.`);
    sections.set(m[1], stripTags(m[2]));
}
if (sections.size < 50) fail(`Only ${sections.size} sections found - the section markup has changed or the file is damaged.`);

const ingest = fs.readFileSync(INGEST, 'utf8');
const kwBlock = (ingest.match(/const SECTION_KEYWORDS = \{([\s\S]*?)\n\};/) || [])[1] || '';
const keyworded = new Set([...kwBlock.matchAll(/^\s*'([^']+)':/gm)].map((x) => x[1]));
if (!keyworded.size) fail('Could not read SECTION_KEYWORDS from the ingest script.');

for (const [id, text] of sections) {
    if (text.length > MAX_SECTION_CHARS) {
        fail(`Section "${id}" is ${text.length} chars of text; keep it under ${MAX_SECTION_CHARS} so it stays one chunk.`);
    }
    if (!keyworded.has(id)) fail(`Section "${id}" has no SECTION_KEYWORDS entry in scripts/ingest-macavation-assistant-kb.mjs.`);
    const placeholder = PLACEHOLDER_PHRASES.some((p) => text.includes(p));
    if (placeholder && !PENDING_PLACEHOLDER.has(id)) fail(`Section "${id}" still has placeholder text.`);
    if (!placeholder && PENDING_PLACEHOLDER.has(id)) {
        fail(`Section "${id}" has been rewritten - delete it from PENDING_PLACEHOLDER in this script.`);
    }
}
for (const id of PENDING_PLACEHOLDER) {
    if (!sections.has(id)) fail(`PENDING_PLACEHOLDER names "${id}", which is not a section in the guide.`);
}

const menu = fs.readFileSync(MENU, 'utf8');
const routes = new Set([...menu.matchAll(/route:\s*'([a-z0-9-]+)'/g)].map((x) => x[1]));
if (routes.size < 20) fail(`Only ${routes.size} sidebar routes found in role-menu-config.js - the format has changed.`);
for (const route of routes) {
    const id = ROUTE_ALIASES[route] || route;
    const has = sections.has(id);
    if (!has && !PENDING_ROUTES.has(route)) fail(`Sidebar screen "${route}" has no section "${id}" in the guide.`);
    if (has && PENDING_ROUTES.has(route)) fail(`Sidebar screen "${route}" now has a section - delete it from PENDING_ROUTES.`);
}
for (const r of PENDING_ROUTES) {
    if (!routes.has(r)) fail(`PENDING_ROUTES names "${r}", which is not a sidebar route.`);
}

if (failures.length) {
    console.error('help-guide:verify FAILED');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
}
console.log(`help-guide:verify OK (${sections.size} sections, ${routes.size} sidebar screens; ` +
    `${PENDING_PLACEHOLDER.size} placeholder sections and ${PENDING_ROUTES.size} screens still to write)`);
