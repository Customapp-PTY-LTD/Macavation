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
  'modal-admin-add-role': 'add role, create new role, new role dialog, role name and description',
  'modal-admin-add-user': 'add user, create new user, temporary password, assign primary role',
  'modal-batch-history': 'batch history, audit history of status changes, batch audit trail',
  'batch-journey-grid': 'batch journey, find a batch, track a batch, where is my batch, cross-batch search',
  'modal-batch-summary': 'batch summary, consolidated batch metadata, batch weights and moisture',
  'crm-kernel-customers': 'kernel customers, CRM kernel customers, kernel dispatch contacts',
  'crm-nis-suppliers': 'NIS suppliers, numbered supplier list, grower supplier contacts',
  'crm-oil-protein-customers': 'oil and protein customers, oil customers, protein customers',
  'crm-oil-ingredient-suppliers': 'oil ingredient suppliers, raw material suppliers',
  'crm-oil-processors': 'oil processors, oil processor contacts',
  'modal-crm-contact': 'add contact, edit CRM contact, new contact dialog',
  'dashboard-overview': 'dashboard overview, home dashboard, landing page after sign in, summary cards',
  'report-targets-grid': 'targets, monthly targets, weekly targets, set a target, dashboard targets, report targets',
  'data-import-grid': 'data import, import Excel, upload template, download template, map columns',
  'document-management-grid': 'document management, upload document, document categories',
  'modal-end-sample': 'end sample, close out sample, final disposition, retest',
  'modal-end-sample-view': 'view ended sample, read-only sample review',
  'executive-dashboard': 'executive dashboard, KPI reporting, generate report, customize widgets',
  'modal-feature': 'add feature, edit feature key, feature description',
  'features-grid': 'features catalogue, feature keys, application features',
  'financial-management-grid': 'financial management, new invoice, record payment, invoices',
  'modal-grower-create-kernel-batch': 'create kernel batch, grower create kernel batch, wet NIS details',
  'grower-intake-grid': 'grower intake, receive grower intake, receiving checklist, release to production',
  'modal-grower-link-sample-to-batch': 'link sample to batch, lab sample result',
  'modal-grower-receiving-checklist': 'receiving checklist, stage 1 checklist, grower receiving checklist',
  'modal-import-oil-lots': 'import oil lots, oil lots from Excel, bulk import oil lots',
  'modal-job-card-view': 'job card view, read-only job card',
  'modal-kernel-dispatch': 'create dispatch basket, kernel dispatch basket header',
  'kernel-dispatch-grid': 'kernel dispatch, dispatch kernel stock, dispatch basket, find basket, undo dispatch',
  'modal-kernel-dispatch-edit': 'kernel dispatch edit',
  'modal-kernel-dispatch-form': 'kernel dispatch form, inspection paperwork, vehicle seal weight checks',
  'modal-kernel-job-card': 'kernel job card, job card styles yields equipment',
  'kernel-production-grid': 'kernel production, start kernel production, job cards, production stages, production calendar',
  'kernel-production-forecast-grid': 'kernel production forecast',
  'material-journey-dashboard': 'material journey, material movement tracking',
  'messaging-compose-grid': 'messaging compose, compose message',
  'my-day': 'my day, my tasks, landing view after sign in, assigned shortcuts',
  'modal-oil-bulk-add-stock': 'oil bulk add stock, bulk add oil stock',
  'modal-oil-dispatch': 'create oil dispatch basket, oil protein dispatch header',
  'oil-dispatch-grid': 'oil dispatch, oil protein dispatch, dispatch oil lots, oil warehouse dispatch',
  'modal-oil-dispatch-form': 'oil dispatch form, oil inspection paperwork, oil despatch paperwork',
  'modal-oil-lot': 'oil lot, create oil lot, edit oil lot, best-before quantity location',
  'oil-production-grid': 'oil production, production sheet, food grade oil, protein powder, cosmetic oil, extraction',
  'oil-production-forecast-grid': 'oil production forecast',
  'modal-oil-production-sheet': 'oil production sheet, food grade oil protein powder cosmetic oil run, yields losses product splits',
  'palladium-integration-grid': 'palladium integration, ERP integration, sync status, sync now',
  'modal-production-stages': 'advance production stages, edit production stages',
  'modal-production-stages-view': 'production stage history, stage timestamps',
  'quality-assurance-grid': 'quality assurance, new quality test, food safety, pass fail conditional',
  'modal-quality-test': 'log quality test, quality test result',
  'modal-raw-material-issued': 'raw material issued, issue raw material to production',
  'modal-receiving-checklist': 'receiving checklist for incoming goods, goods receipt checklist, delivery checklist',
  'modal-role': 'add role inline, edit role dialog',
  'modal-role-feature': 'tie feature to role, role feature toggle',
  'role-features-grid': 'role features, toggle feature flags per role, feature rollout by role',
  'modal-role-permission': 'map role to database object, role permission dialog',
  'role-permissions-grid': 'role permissions, database permissions per role, grant least privilege',
  'roles-grid': 'define a role, list of roles, add role, named roles',
  'sales-forecasting-grid': 'sales forecasting, new forecast, demand forecast',
  'modal-send-to-dispatch': 'send to dispatch, kernel send to dispatch',
  'modal-send-to-dispatch-oil': 'send to dispatch oil, oil lots to dispatch',
  'stock-alert-rules-grid': 'stock alert rules',
  'stock-management-grid': 'stock management, adjust stock, stock take, warehouse stock, kernel batch journey by style',
  'stock-history': 'stock on hand history, stock trend chart, executive dashboard stock chart',
  'modal-stock-take': 'stock take, stock adjustment, count physical stock',
  'supplier-intake-grid': 'supplier intake, receiver checklist, supplier oil batch, oil intake',
  'modal-supplier-intake-adjust-stock': 'supplier intake adjust stock',
  'modal-supplier-oil-batch': 'edit supplier oil batch, supplier oil batch header',
  'modal-supplier-receiver-checklist': 'receiver checklist, new supplier oil delivery',
  'supply-chain-flow': 'supply chain flow, process flow diagram, kernel and oil stream overview',
  'modal-user': 'edit user profile, reset password, deactivate user',
  'admin-users-permissions': 'user and access people, accounts and role filter',
  'admin-roles-management': 'customize a role, sidebar module access per role, database function permissions per role',
  'admin-system-configuration': 'system configuration, environment configuration, integration settings',
  'admin-feedback-issues': 'feedback and issues, report a bug, log a defect, new feedback, feature request',
  'users-grid': 'users, add user, create user, password reset, deactivate user',
  'portal-guide': 'portal guide, Mac assistant, idle mac, mac mascot',
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
