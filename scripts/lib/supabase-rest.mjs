/**
 * PostgREST helpers using service_role keys from Supabase CLI (no DB password required).
 */
import { spawnSync } from 'child_process';
import { PRODUCTION, UAT } from './supabase-projects.mjs';

const URL_BY_REF = {
  [PRODUCTION.ref]: PRODUCTION.apiUrl,
  [UAT.ref]: UAT.apiUrl,
};

function parseApiKeys(stdout) {
  const keys = JSON.parse(stdout);
  const service = keys.find((k) => k.name === 'service_role' && k.type === 'legacy');
  if (!service?.api_key) {
    throw new Error('service_role key not found in CLI api-keys output');
  }
  return service.api_key;
}

export function fetchServiceRoleKey(projectRef) {
  const result = spawnSync(
    'npx',
    ['--yes', 'supabase@latest', 'projects', 'api-keys', '--project-ref', projectRef, '-o', 'json'],
    { encoding: 'utf8', shell: process.platform === 'win32' }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `Failed to fetch API keys for ${projectRef}`);
  }
  return parseApiKeys(result.stdout);
}

export async function restSelectAll(projectRef, table, { batchSize = 500 } = {}) {
  const baseUrl = URL_BY_REF[projectRef];
  const key = fetchServiceRoleKey(projectRef);
  const rows = [];
  let offset = 0;

  while (true) {
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?select=*`;
    const res = await fetch(url, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + batchSize - 1}`,
      },
    });
    if (res.status === 404) {
      return [];
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`REST select ${table}@${projectRef} failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < batchSize) break;
    offset += batchSize;
  }

  return rows;
}

let uatOpenApiCache = null;

export async function fetchUatTableColumns(table) {
  if (!uatOpenApiCache) {
    const key = fetchServiceRoleKey(UAT.ref);
    const res = await fetch(`${UAT.apiUrl}/rest/v1/`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/openapi+json',
      },
    });
    if (!res.ok) {
      throw new Error(`Failed to load UAT OpenAPI schema (${res.status})`);
    }
    uatOpenApiCache = await res.json();
  }

  const def =
    uatOpenApiCache?.definitions?.[table] ||
    uatOpenApiCache?.components?.schemas?.[table];
  if (!def?.properties) return null;
  return new Set(Object.keys(def.properties));
}

export function filterRowForTarget(columns, row) {
  if (!columns) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (columns.has(key)) out[key] = value;
  }
  return out;
}

export async function restInsertBatch(projectRef, table, records) {
  if (!records.length) return;
  const baseUrl = URL_BY_REF[projectRef];
  const key = fetchServiceRoleKey(projectRef);
  const res = await fetch(`${baseUrl}/rest/v1/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(records),
  });
  if (res.status === 404) {
    throw new Error(`Table ${table} is not exposed in PostgREST on ${projectRef}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST insert ${table}@${projectRef} failed (${res.status}): ${text.slice(0, 500)}`);
  }
}
