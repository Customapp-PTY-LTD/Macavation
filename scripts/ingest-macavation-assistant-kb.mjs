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
    parts.forEach((part, idx) => {
      const summary = part.slice(0, 200);
      const contentHash = crypto
        .createHash('sha256')
        .update(`${section.title}\n${part}`)
        .digest('hex');
      chunks.push({
        source: SOURCE,
        section_anchor: section.anchor,
        chunk_index: idx,
        title: section.title,
        body: part,
        summary,
        keywords: null,
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

  if (isDryRun) {
    console.log('--dry-run: not calling the edge function. Sample chunks:');
    for (const c of chunks.slice(0, 5)) {
      console.log(`  #${c.section_anchor} [${c.chunk_index}] "${c.title}" (${c.body.length} chars, hash ${c.content_hash.slice(0, 12)}…)`);
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
