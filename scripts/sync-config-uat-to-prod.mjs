#!/usr/bin/env node
/**
 * Sync operational config from UAT → production (dashboard targets, alert rules, scheduled reports).
 * Maps scheduled_reports by email + channel; replaces alert rules and targets with UAT values.
 *
 * Usage:
 *   node scripts/sync-config-uat-to-prod.mjs --dry-run
 *   node scripts/sync-config-uat-to-prod.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCTION, UAT } from './lib/supabase-projects.mjs';
import { fetchServiceRoleKey, restSelectAll } from './lib/supabase-rest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const resultsPath = path.join(__dirname, 'prod_config_sync_results.json');

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
    throw new Error(`DELETE ${table}@${projectRef} failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

async function restInsert(projectRef, table, rows) {
  if (!rows.length) return 0;
  const baseUrl = projectRef === PRODUCTION.ref ? PRODUCTION.apiUrl : UAT.apiUrl;
  const key = fetchServiceRoleKey(projectRef);
  const batchSize = 50;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const res = await fetch(`${baseUrl}/rest/v1/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`INSERT ${table}@${projectRef} failed (${res.status}): ${text.slice(0, 500)}`);
    }
    inserted += batch.length;
  }
  return inserted;
}

function stripIds(row, extra = []) {
  const out = { ...row };
  delete out.id;
  delete out.created_at;
  delete out.updated_at;
  for (const k of extra) delete out[k];
  return out;
}

async function main() {
  console.log(`Reading config from UAT (${UAT.ref})…`);

  const [targets, alertRules, reports] = await Promise.all([
    restSelectAll(UAT.ref, 'dashboard_targets'),
    restSelectAll(UAT.ref, 'stock_alert_rules'),
    restSelectAll(UAT.ref, 'scheduled_reports'),
  ]);

  const prodTargets = targets.map((r) => stripIds(r));
  const prodAlertRules = alertRules.map((r) => stripIds(r));
  const prodReports = reports.map((r) => stripIds(r, ['last_sent_at']));

  const summary = {
    at: new Date().toISOString(),
    dryRun,
    dashboard_targets: prodTargets.length,
    stock_alert_rules: prodAlertRules.length,
    scheduled_reports: prodReports.length,
  };

  console.log(JSON.stringify(summary, null, 2));

  if (dryRun) {
    fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    console.log('Dry run — no writes.');
    return;
  }

  console.log(`Replacing config on production (${PRODUCTION.ref})…`);
  await restDeleteAll(PRODUCTION.ref, 'dashboard_targets');
  await restDeleteAll(PRODUCTION.ref, 'stock_alert_rules');
  await restDeleteAll(PRODUCTION.ref, 'scheduled_reports');

  summary.dashboard_targets_inserted = await restInsert(PRODUCTION.ref, 'dashboard_targets', prodTargets);
  summary.stock_alert_rules_inserted = await restInsert(PRODUCTION.ref, 'stock_alert_rules', prodAlertRules);
  summary.scheduled_reports_inserted = await restInsert(PRODUCTION.ref, 'scheduled_reports', prodReports);

  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log('Config sync complete:', path.relative(process.cwd(), resultsPath));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
