#!/usr/bin/env node
/**
 * Copy public schema data from Macavation production → UAT via PostgREST + service_role.
 * No Docker or direct Postgres required (IPv4-safe on Windows).
 *
 * Usage:
 *   node scripts/copy-prod-data-to-uat.mjs
 *   node scripts/copy-prod-data-to-uat.mjs --dry-run
 *   npm run db:copy-prod-to-uat
 *
 * UAT should be empty (or use --truncate to clear via REST first).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCTION, UAT } from './lib/supabase-projects.mjs';
import {
  restSelectAll,
  restInsertBatch,
  fetchServiceRoleKey,
  fetchUatTableColumns,
  filterRowForTarget,
} from './lib/supabase-rest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const INSERT_BATCH = 100;
const dryRun = process.argv.includes('--dry-run');
const truncateFirst = process.argv.includes('--truncate');
const fromArg = process.argv.find((a) => a.startsWith('--from='));
const fromTable = fromArg ? fromArg.split('=')[1] : null;

/** FK-safe insert order (public schema). */
const TABLE_ORDER = [
  'action_conflicts', 'actions', 'batches', 'certifications', 'compliance_rules',
  'roles', 'users', 'contacts', 'dashboard_alerts', 'dashboard_targets',
  'document_categories', 'documents', 'downstream_impacts', 'due_items', 'features',
  'identity_providers', 'kernel', 'kernel_dispatch_orders', 'kernel_intake_procurement',
  'kernel_production_forecast', 'linked_records', 'metric_values', 'notifications',
  'notification_reads', 'oil', 'oil_bin', 'shift', 'oil_bin_batch', 'oil_dispatch_orders',
  'oil_production_forecast', 'oil_production_sheets', 'oil_production_mixes', 'oil_stock_lots',
  'predictive_insights', 'product', 'production_batches', 'protein_bin_batch',
  'sample_submissions', 'quality_tests', 'raw_material_issued', 'receiving_checklists',
  'received_items', 'recent_activity', 'role_actions', 'role_features', 'role_permissions',
  'scheduled_reports', 'silo', 'stock_accuracy_snapshot', 'stock_alert_rules', 'stock_items',
  'stock_takes', 'stock_take_items', 'supplier_intake_batches', 'test_scenarios',
  'test_instances', 'test_runs', 'watching_items', 'workflow_tasks',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function restDeleteAll(projectRef, table) {
  const baseUrl = projectRef === PRODUCTION.ref ? PRODUCTION.apiUrl : UAT.apiUrl;
  const key = fetchServiceRoleKey(projectRef);
  const res = await fetch(
    `${baseUrl}/rest/v1/${encodeURIComponent(table)}?id=not.is.null`,
    {
      method: 'DELETE',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'return=minimal',
      },
    }
  );
  if (res.status === 404) return;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST delete ${table}@${projectRef} failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

function normalizeRow(table, row) {
  const out = { ...row };
  if (table === 'kernel' && (out.silos === null || out.silos === undefined)) {
    out.silos = [];
  }
  if (table === 'silo' && (out.created_at === null || out.created_at === undefined)) {
    out.created_at = out.updated_at || new Date().toISOString();
  }
  return out;
}

async function copyTable(table) {
  const uatColumns = await fetchUatTableColumns(table);
  if (!uatColumns) {
    console.log(`  skip ${table} (not in UAT API schema)`);
    return { table, rows: 0, skipped: 'no_uat_schema' };
  }

  const rows = (await restSelectAll(PRODUCTION.ref, table))
    .map((r) => normalizeRow(table, r))
    .map((r) => filterRowForTarget(uatColumns, r));
  if (!rows.length) {
    console.log(`  skip ${table} (empty)`);
    return { table, rows: 0 };
  }

  console.log(`  copy ${table} (${rows.length} rows)`);
  if (dryRun) return { table, rows: rows.length };

  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    await restInsertBatch(UAT.ref, table, batch);
    await sleep(100);
  }

  return { table, rows: rows.length };
}

async function main() {
  console.log(`Source: ${PRODUCTION.name} (${PRODUCTION.ref})`);
  console.log(`Target: ${UAT.name} (${UAT.ref})`);
  if (dryRun) console.log('DRY RUN — no writes to UAT');

  if (truncateFirst && !dryRun) {
    console.log('Clearing UAT tables (reverse order)...');
    for (const table of [...TABLE_ORDER].reverse()) {
      try {
        await restDeleteAll(UAT.ref, table);
      } catch (err) {
        console.warn(`  warn truncate ${table}: ${err.message}`);
      }
    }
  }

  const tableList = fromTable
    ? TABLE_ORDER.slice(TABLE_ORDER.indexOf(fromTable))
    : TABLE_ORDER;
  if (fromTable && tableList.length === TABLE_ORDER.length) {
    throw new Error(`Unknown --from table: ${fromTable}`);
  }

  const results = [];
  for (const table of tableList) {
    try {
      results.push(await copyTable(table));
    } catch (err) {
      console.error(`  FAILED ${table}: ${err.message}`);
      throw err;
    }
  }

  const totalRows = results.reduce((sum, r) => sum + r.rows, 0);
  console.log(`Done. ${totalRows} rows ${dryRun ? 'would be copied' : 'copied'}.`);

  const logPath = path.join(root, 'scripts', 'prod_to_uat_copy_results.json');
  fs.writeFileSync(
    logPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        dryRun,
        truncateFirst,
        source: PRODUCTION.ref,
        target: UAT.ref,
        totalRows,
        tables: results,
      },
      null,
      2
    ) + '\n',
    'utf8'
  );
  console.log(`Log: ${path.relative(root, logPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
