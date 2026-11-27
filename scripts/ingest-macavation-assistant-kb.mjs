#!/usr/bin/env node
/**
 * Ingest WebPortal/help/index.html guide sections into the portal-assistant
 * knowledge base (assistant_kb_chunk), via the portal-assistant edge
 * function's assistant_kb_ingest action.
 *
 * Usage:
 *   node scripts/ingest-macavation-assistant-kb.mjs
 *   node scripts/ingest-macavation-assistant-kb.mjs --dry-run
 *
 * Required env vars (real run):
 *   SUPABASE_URL             - e.g. https://nmdmddugxclpqrwylyfa.supabase.co (UAT)
 *   ASSISTANT_INGEST_SECRET  - shared secret, must match the edge function's env var of the same name
 *   SUPABASE_ANON_KEY        - sent as Authorization/apikey headers (edge functions gateway)
 *
 * --dry-run only parses/chunks the guide and prints a summary — no env vars
 * or network calls required.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const GUIDE_PATH = path.join(root, 'WebPortal', 'help', 'index.html');
const SOURCE = 'macavation-user-guide';
const MAX_CHUNK_CHARS = 6000;
const BATCH_SIZE = 25;

// Curated keyword phrases per guide section_anchor, fed into
// assistant_kb_chunk.keywords (3x weight in assistant_kb_search's scoring —
// see migrations/20260716160000_portal_assistant_chat.sql). Phrases close to
// how a user would actually ask, not bare generic words, so that a section
// can score a clear, dominant hit for the portal-assistant zero-token fast
// path (see FAST_PATH_MIN_SCORE / FAST_PATH_DOMINANCE_RATIO in
// supabase/functions/portal-assistant/index.ts) without tying against
// unrelated sections. A handful of sections have no distinguishing body
// content (pure template boilerplate) — those get title-only phrases and are
// not expected to dominate; that's fine, ambiguous questions should fall
// through to the AI rather than guess.
const SECTION_KEYWORDS = {
  'modal-admin-add-role': 'add a role, create new role, Add role button, roles and modules, User & access, new role name and description',
  'modal-admin-add-user': 'add a user, add new user dialog, Add user button, create a user account, User & access People tab',
  'modal-batch-history': 'batch history, history of a batch, what happened to a batch, batch dispatch history, intake and production history, end sample history, view batch timeline',
  'batch-journey-grid': 'find a batch, batch journey, track a batch, where is my batch, search for a batch, batch status, archive a batch, edit batch details, restore an archived batch',
  'batch-journey-detail': 'batch page, open a batch, edit a batch, add a bag, remove a bag, spilled bag, wrong bag weight, change delivery note, edit intake samples, edit cartons',
  'modal-batch-summary': 'batch summary, batch totals, cracking yield, finish batch production, total packed, kernel cracked, how much was cracked',
  'crm-kernel-customers': 'kernel customers, CRM kernel customers, kernel dispatch contacts',
  'crm-nis-suppliers': 'NIS suppliers, numbered supplier list, grower supplier contacts',
  'crm-oil-protein-customers': 'oil and protein customers, oil customers, protein customers',
  'crm-oil-ingredient-suppliers': 'oil ingredient suppliers, raw material suppliers',
  'crm-oil-processors': 'oil processors, oil processor contacts',
  'modal-crm-contact': 'add a contact, edit a contact, add a supplier, supplier code NIS number, oil processor rates, Support CRM Contacts, deactivate a contact',
  'dashboard-overview': 'dashboard overview, home dashboard, landing page after sign in, summary cards',
  'report-targets-grid': 'targets, monthly targets, weekly targets, set a target, dashboard targets, report targets',
  'data-import-grid': 'data import, import Excel, upload template, download template, map columns',
  'document-management-grid': 'document management, upload document, document categories',
  'modal-end-sample': 'end sample, send to lab, save and send to lab, enter lab results, lab test PDF, external lab testing, internal micro, lab failed retest, positive release, reprocess or reject batch',
  'modal-end-sample-view': 'end sample view, view end sample, see lab results, PACKING (view), lab passed failed waiting, edit end sample',
  'executive-dashboard': 'executive dashboard, KPI reporting, generate report, customize widgets',
  'modal-feature': 'feature dialog, add a feature, feature key, which modules a role sees, Customize role',
  'features-grid': 'features catalogue, feature keys, application features',
  'financial-management-grid': 'financial management, new invoice, record payment, invoices',
  'modal-grower-create-kernel-batch': 'book in a truck, new delivery, create kernel batch, add a supplier, bag weights, estimated bags, supplier declared weight, delivery note reference, transporter, wrong batch number',
  'grower-intake-grid': 'receiving, grower intake, book in a truck, expected trucks, receiving checklist, take a sample, release to production, needs a decision, ready to crack, archive a batch, kernel intake',
  'grower-intake-bags': 'bags, move bags, storage areas, not placed yet, undo a bag move, where is a bag, bag in the wrong area, storage area full, recent moves',
  'modal-grower-link-sample-to-batch': 'batch sample, take a sample, ziplock sample, 5kg sample, moisture, peroxide value, free fatty acids, crack-out, float test, out of spec, wrong sample result',
  'modal-grower-receiving-checklist': 'receiving checklist, grower receiving checklist, vehicle clean, pests found, hazard substances, pallets condition, wrong checklist answer, checklist photos',
  'modal-import-oil-lots': 'import oil stock from excel, oil stock excel import, upload oil lots',
  'modal-job-card-view': 'job card view, read-only job card, view job card, job card view no longer used',
  'modal-kernel-dispatch': 'dispatch order view, dispatch basket header, create dispatch basket, kernel dispatch dialog no longer used, view sheet',
  'sales-hub': 'Sales page, sales module, where are sales, change prices, customer prices, confirm pricing, orders waiting for pricing, sales figures, sales this month, sales this year, sales by customer, sales by style, download sales CSV, add a customer',
  'kernel-dispatch-grid': 'Dispatch and Sales, kernel dispatch, five steps, waiting for picking, waiting for pricing, waiting for the truck, waiting for the invoice, undo truck loaded, undo invoice sent, confirm picking, confirm pricing, dispatch calendar',
  'modal-kernel-dispatch-edit': 'edit dispatch, edit dispatch order, change collection date, change buyer, wrong cartons on dispatch, send back to stock, cancel a dispatch, dispatch already dispatched',
  'modal-kernel-dispatch-form': 'truck sheet, truck loaded, inspection of vehicle, vehicle checks, driver name, truck registration, delivery note, sender signature, unlock dispatched basket, dispatch recorded by mistake',
  'modal-kernel-dispatch-approve': 'confirm picked, pick stock for dispatch, add substitute, confirm pricing, update pricing, price per kg, transport cost, send back to Thando, PO number, invoice number, invoice sent, mark invoice sent',
  'modal-kernel-job-card': 'job card, kernel job card, approve job card, Jobcard approved, save job card, job card cartons and kg, best before date, mass balance, wrong job card quantities, check the dates',
  'silo-allocation-grid': 'silo, silos, silo holding, allocate bags to a silo, wrong silo, undo bag in silo, amend silo, correct silo mistake, open silo, stop cracking, opened by mistake, undo this run, edit run times, cracking log, pre-sizer, re-weigh bag, real kg',
  'kernel-production-grid': 'Production, kernel production, start production, release to production, release to stock, approve job card, enter lab results, send for retest, reprocess a batch, reject a batch, archive a batch, production calendar, sheet to finish',
  'kernel-production-forecast-grid': 'Kernel forecast, kernel production forecast, add forecast line, customer demand, cartons per style, stock gap, short on stock, delete forecast line, fulfilled forecast',
  'material-journey-dashboard': 'material journey, material movement tracking',
  'messaging-compose-grid': 'send message, send a message to all users, broadcast message, in-app message, notification bell',
  'my-day': 'my day, my tasks, landing view after sign in, assigned shortcuts',
  'modal-oil-bulk-add-stock': 'add oil stock many batches, bulk add oil stock, add stock multiple batches, protein powder stock add',
  'modal-oil-dispatch': 'oil dispatch basket, view basket oil dispatch',
  'oil-dispatch-grid': '5. Dispatch and Sales oil, oil dispatch, oil and protein dispatch, ready to dispatch oil, dispatch an oil order, view sheet oil',
  'modal-oil-dispatch-form': 'oil dispatch form, oil truck inspection, vehicle inspection oil dispatch, save and dispatch oil, oil dispatch signature, transport company oil',
  'modal-oil-lot': 'oil stock lot, add lot single, edit oil lot, oil stock on hand lot, hold oil lot',
  'oil-production-grid': '3. Production oil, oil production, start oil bin, start protein batch, send to stock, test FFA, mark bag empty, link ingredients, oil cake, letrerage',
  'oil-production-forecast-grid': 'oil forecast, oil production forecast, oil and protein forecast, open demand vs stock, forecast line',
  'modal-oil-production-sheet': 'oil production sheet, old production sheet',
  'palladium-integration-grid': 'palladium integration, ERP integration, sync status, sync now',
  'modal-production-stages': 'Production dialog, production stages, add cracking run, edit run times, cracking runs, shell waste, washing, sorting, packing, finish batch production, batch summary, enter production for a day',
  'modal-production-stages-view': 'production stages view, view production days, production stage history, production view no longer used',
  'quality-assurance-grid': 'quality assurance, where is quality assurance, QA page removed, quality tests, food safety tests, where do I record a quality test',
  'modal-quality-test': 'quality test, sample test, official FFA, oil sample test FFA, record FFA on a bag, FFA not in spec oil',
  'modal-raw-material-issued': 'raw material issued, issue raw material, raw material stock issued, oil raw material issued dialog retired',
  'modal-receiving-checklist': 'incoming receiving checklist, old receiving checklist, goods receipt checklist, receiving checklist not used',
  'procurement-plan': 'procurement plan, plan a delivery, expected trucks, truck late, move truck date, cancel a truck, when will stock run out, working days, shutdown, opening stock',
  'company-calendar': 'Calendar, company calendar, public holidays, shutdown, working Saturday, half day, extra holiday, company date, event, expected deliveries, trucks coming, working days, next 60 days',
  'transporters': 'Transporters page, transport companies, transporter contacts, transporter documents, goods in transit insurance, GIT expiry, B-BBEE certificate, routes, route code, rate sheet, transport rates, rate per load, rate per km, valid from, valid to, renew a rate, cheapest rate, transport rate expiring',
  'intake-lab-results': 'intake lab results, moisture PV FFA, peroxide value, free fatty acids, within spec, marginal, overspec, lab result pass fail, mark reviewed, hold, reject, results to capture, overspec review',
  'kernel-pipeline-settings': 'kernel pipeline settings, sample spec limits, kg per crate, bag weighing, shelf life, best before months, daily target, lab days, silo capacity, storage area capacity, transport companies, kernel prices, stock alerts',
  'modal-role': 'edit a role, rename a role, switch a role off, Edit role button, Active Role, roles and modules',
  'modal-role-feature': 'role feature dialog, enable or disable a feature for a role, which modules a role sees, Customize role',
  'role-features-grid': 'role features, toggle feature flags per role, feature rollout by role',
  'modal-role-permission': 'role permission dialog, database permissions for a role, grant permission to a role, Customize role',
  'role-permissions-grid': 'role permissions, database permissions per role, grant least privilege',
  'roles-grid': 'define a role, list of roles, add role, named roles',
  'sales-forecasting-grid': 'sales forecasting, new forecast, demand forecast',
  'modal-send-to-dispatch': 'Send to Dispatch, send stock to dispatch, start a dispatch, new dispatch, select stock, add a new customer, collection date, customer details, wrong cartons dispatched',
  'modal-send-to-dispatch-oil': 'send to dispatch oil, create oil dispatch order, oil basket, protein powder dispatch, letrerage dispatch, add buyer oil',
  'stock-alert-rules-grid': 'stock alert rules, low stock alert, stock alerts tab, add alert rule, alert below, stock red flag, turn off an alert rule, why no stock alert',
  'stock-management-grid': 'Stock on Hand, kernel stock on hand, kernel stock by style, correct stock, adjust kernel stock, positive release stock, kernel at the lab, shell waste lots, archive a kernel batch, send batch back to production, stock movement',
  'stock-history': 'stock on hand history, stock trend chart, executive dashboard stock chart',
  'raw-material-runway': 'raw material runway, run out of nut-in-shell, when will we run out, depletion rate, runway forecast chart',
  'modal-stock-take': 'stock take, physical count, count stock, correct stock count, stock take dialog retired',
  'supplier-intake-grid': 'oil receiving, 1. Receiving oil, supplier intake, oil intake, log an oil delivery, new delivery oil, quick stock entry, remove an oil bag, oil and protein receiving',
  'modal-supplier-intake-adjust-stock': 'quick stock entry, adjust stock oil, add oil bags without checklist, oil stock count correction',
  'modal-supplier-oil-batch': 'supplier oil batch, old oil batch dialog, edit oil batch header',
  'modal-supplier-receiver-checklist': 'new delivery oil, oil truck checks, add oil bags, delivery note oil, upload consignment note, edit oil batch, edit batch oil, oil receiver checklist',
  'supply-chain-flow': 'supply chain flow, process flow diagram, kernel and oil stream overview',
  'modal-user': 'add a user, edit a user, reset a password, change someone\'s role, deactivate a user, enrol WhatsApp number, send enrolment code, User & access People tab',
  'admin-users-permissions': 'user and access people, accounts and role filter',
  'admin-roles-management': 'customize a role, sidebar module access per role, database function permissions per role',
  'admin-system-configuration': 'system configuration, environment configuration, integration settings',
  'admin-feedback-issues': 'feedback and issues, report a bug, log a defect, new feedback, feature request',
  'users-grid': 'users, add user, create user, password reset, deactivate user',
  'portal-guide': 'portal guide, Mac assistant, idle mac, mac mascot',
  'stock-management-oil-tab': 'oil stock on hand, protein powder stock, add oil lot, import oil stock from Excel, adjust oil stock, oil days left best before, Stock (Oil & Protein), bulk add oil stock',
  'kernel-dashboard': 'Kernel Dashboard, kernel dashboard procurement production stock sales, financial year quarter filter, production log cracked packed, nut in shell received per supplier, kernel on hand chart, kernel sales by style, top customers',
  'oil-dashboard': 'Oil Dashboard, oil dashboard procurement production stock sales, oil out litres, protein out kg, oil yield, oil and protein stock chart, local sales and exports, financial year quarter filter',
  'supplier-intake-bags': 'FFA result, record FFA, FFA for this delivery, out of spec FFA, accept or reject a bag, exec decision FFA, sample test oil bag, release to oil production, weight before production',
  'oil-raw-materials': '2. Raw Materials, oil raw materials, move bags to production, stock level critical, stock on hand on an earlier day, month-end count oil, daily recipe, weeks of stock, as at date oil stock',
  'oil-raw-materials-recon': 'supplier recon, supplier reconciliation oil, kg per supplier per month, check supplier invoices, our own material, export loads',
  'crm-whatsapp-grid': 'WhatsApp & Chat, WhatsApp inbox, send a WhatsApp message, start a new chat, internal chat with colleagues, Support CRM WhatsApp, unread messages',
  'amanda-dashboard': 'Pallandium Integrator Dashboard, Material Journey dashboard, material journey alerts, Palladium removed from menu, batch step out of 17',
};

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

function usage() {
  console.log(`Ingest the Macavation user guide into the portal-assistant knowledge base.

Usage:
  node scripts/ingest-macavation-assistant-kb.mjs [--dry-run]

Required env vars (real run only):
  SUPABASE_URL             e.g. https://nmdmddugxclpqrwylyfa.supabase.co (UAT — see supabase/projects.json)
  ASSISTANT_INGEST_SECRET  shared secret matching the portal-assistant edge function's env var
  SUPABASE_ANON_KEY        sent as Authorization/apikey headers to reach the edge function gateway
`);
}

if (args.includes('-h') || args.includes('--help')) {
  usage();
  process.exit(0);
}

// ── HTML extraction (regex-based; the guide is generated/hand-authored HTML
// with a consistent shape, not arbitrary markup — a full HTML parser is
// overkill here). ─────────────────────────────────────────────────────────

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsaquo;/g, '›')
    .replace(/&rarr;/g, '→')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSections(html) {
  const sectionRe = /<section\s+id="([^"]+)"\s+class="guide-section"\s+data-guide-id="[^"]*"[^>]*>([\s\S]*?)<\/section>/g;
  const sections = [];
  let m;
  while ((m = sectionRe.exec(html)) !== null) {
    const anchor = m[1];
    const inner = m[2];
    const h2Match = inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = h2Match ? stripTags(h2Match[1]) : anchor;
    const bodyHtml = h2Match ? inner.slice(h2Match.index + h2Match[0].length) : inner;
    const body = stripTags(bodyHtml);
    sections.push({ anchor, title, body });
  }
  return sections;
}

function chunkBody(body, maxChars) {
  if (body.length <= maxChars) return [body];
  const chunks = [];
  let rest = body;
  while (rest.length > maxChars) {
    // Prefer to break on a sentence/space boundary near the limit.
    let cut = rest.lastIndexOf('. ', maxChars);
    if (cut < maxChars * 0.5) cut = rest.lastIndexOf(' ', maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    chunks.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function buildChunks(sections) {
  const chunks = [];
  for (const section of sections) {
    const parts = chunkBody(section.body, MAX_CHUNK_CHARS);
    const keywords = SECTION_KEYWORDS[section.anchor] || null;
    parts.forEach((part, idx) => {
      const summary = part.slice(0, 200);
      // Keywords are part of the hash (not just title+body) so that editing
      // SECTION_KEYWORDS alone is enough to make assistant_kb_chunk_upsert
      // see changed content and update the row on the next normal run —
      // no --force needed.
      const contentHash = crypto
        .createHash('sha256')
        .update(`${section.title}\n${keywords || ''}\n${part}`)
        .digest('hex');
      chunks.push({
        source: SOURCE,
        section_anchor: section.anchor,
        chunk_index: idx,
        title: section.title,
        body: part,
        summary,
        keywords,
        permission_key: null,
        token_estimate: Math.ceil(part.length / 4),
        content_hash: contentHash,
      });
    });
  }
  return chunks;
}

function batches(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function postIngest(supabaseUrl, ingestSecret, anonKey, chunks, rebuildCatalog) {
  const url = `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/portal-assistant`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Key': ingestSecret,
      Authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      action: 'assistant_kb_ingest',
      chunks,
      rebuild_catalog: rebuildCatalog,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Ingest request failed (HTTP ${res.status}): ${JSON.stringify(json)}`);
  }
  return json;
}

async function main() {
  if (!fs.existsSync(GUIDE_PATH)) {
    console.error(`Guide not found: ${GUIDE_PATH}`);
    process.exit(1);
  }
  const html = fs.readFileSync(GUIDE_PATH, 'utf8');
  const sections = extractSections(html);
  if (!sections.length) {
    console.error('No <section class="guide-section" ...> blocks found — nothing to ingest.');
    process.exit(1);
  }
  const chunks = buildChunks(sections);

  console.log(`Parsed ${sections.length} guide sections into ${chunks.length} chunk(s).`);

  const sectionAnchors = new Set(sections.map((s) => s.anchor));
  const missingKeywords = sections.filter((s) => !SECTION_KEYWORDS[s.anchor]).map((s) => s.anchor);
  const staleKeywordEntries = Object.keys(SECTION_KEYWORDS).filter((a) => !sectionAnchors.has(a));
  if (missingKeywords.length) {
    console.warn(`No SECTION_KEYWORDS entry for ${missingKeywords.length} section(s): ${missingKeywords.join(', ')}`);
  }
  if (staleKeywordEntries.length) {
    console.warn(`SECTION_KEYWORDS has ${staleKeywordEntries.length} anchor(s) not found in the guide (typo or removed section?): ${staleKeywordEntries.join(', ')}`);
  }

  if (isDryRun) {
    console.log('--dry-run: not calling the edge function. Sample chunks:');
    for (const c of chunks.slice(0, 5)) {
      console.log(`  #${c.section_anchor} [${c.chunk_index}] "${c.title}" (${c.body.length} chars, keywords: ${c.keywords || '(none)'}, hash ${c.content_hash.slice(0, 12)}…)`);
    }
    if (chunks.length > 5) console.log(`  … and ${chunks.length - 5} more.`);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const ingestSecret = process.env.ASSISTANT_INGEST_SECRET;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const missing = ['SUPABASE_URL', 'ASSISTANT_INGEST_SECRET', 'SUPABASE_ANON_KEY'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing required env var(s): ${missing.join(', ')}`);
    usage();
    process.exit(1);
  }

  const chunkBatches = batches(chunks, BATCH_SIZE);
  let ingested = 0;
  for (let i = 0; i < chunkBatches.length; i++) {
    const isLast = i === chunkBatches.length - 1;
    console.log(`Ingesting batch ${i + 1}/${chunkBatches.length} (${chunkBatches[i].length} chunks)${isLast ? ' + catalog rebuild' : ''}…`);
    const result = await postIngest(supabaseUrl, ingestSecret, anonKey, chunkBatches[i], isLast);
    ingested += result.ingested ?? 0;
    if (!result.success) {
      console.warn(`  Batch ${i + 1} had failures:`, JSON.stringify(result.results?.filter((r) => Number(r.success) !== 1)));
    }
  }

  console.log(`Done. Ingested ${ingested}/${chunks.length} chunks.`);
}

main().catch((err) => {
  console.error('Ingest failed:', err.message || err);
  process.exit(1);
});
