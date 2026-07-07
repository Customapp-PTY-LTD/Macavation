#!/usr/bin/env node
/**
 * Sync permission rows from UAT → production, keyed by role_name + feature/action keys.
 * Does not copy users or roles — maps by role_name and feature/action key.
 *
 * Usage:
 *   node scripts/sync-permissions-uat-to-prod.mjs --dry-run
 *   node scripts/sync-permissions-uat-to-prod.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PRODUCTION, UAT } from './lib/supabase-projects.mjs';
import { fetchServiceRoleKey, restSelectAll } from './lib/supabase-rest.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const resultsPath = path.join(__dirname, 'prod_permission_sync_results.json');

function indexBy(arr, keyFn) {
  const map = new Map();
  for (const row of arr) {
    map.set(keyFn(row), row);
  }
  return map;
}

async function restUpsert(projectRef, table, rows, onConflict) {
  if (!rows.length) return 0;
  const baseUrl = projectRef === PRODUCTION.ref ? PRODUCTION.apiUrl : UAT.apiUrl;
  const key = fetchServiceRoleKey(projectRef);
  const batchSize = 100;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const url = `${baseUrl}/rest/v1/${encodeURIComponent(table)}?on_conflict=${encodeURIComponent(onConflict)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`REST upsert ${table}@${projectRef} failed (${res.status}): ${text.slice(0, 500)}`);
    }
    upserted += batch.length;
  }
  return upserted;
}

async function main() {
  console.log(`Reading permissions from UAT (${UAT.ref})…`);

  const [uatRoles, prodRoles, uatFeatures, prodFeatures, uatActions, prodActions] = await Promise.all([
    restSelectAll(UAT.ref, 'roles'),
    restSelectAll(PRODUCTION.ref, 'roles'),
    restSelectAll(UAT.ref, 'features'),
    restSelectAll(PRODUCTION.ref, 'features'),
    restSelectAll(UAT.ref, 'actions'),
    restSelectAll(PRODUCTION.ref, 'actions'),
  ]);

  const prodRoleByName = indexBy(prodRoles, (r) => r.role_name);
  const prodFeatureByKey = indexBy(prodFeatures, (f) => f.key);
  const prodActionByKey = indexBy(prodActions, (a) => a.key);

  const uatRoleById = indexBy(uatRoles, (r) => r.id);
  const uatFeatureById = indexBy(uatFeatures, (f) => f.id);
  const uatActionById = indexBy(uatActions, (a) => a.id);

  const [uatRoleFeatures, uatRoleActions, uatRolePermissions] = await Promise.all([
    restSelectAll(UAT.ref, 'role_features'),
    restSelectAll(UAT.ref, 'role_actions'),
    restSelectAll(UAT.ref, 'role_permissions'),
  ]);

  const prodRoleFeatures = [];
  let skippedFeatures = 0;
  for (const rf of uatRoleFeatures) {
    const uatRole = uatRoleById.get(rf.role_id);
    const uatFeature = uatFeatureById.get(rf.feature_id);
    if (!uatRole || !uatFeature) {
      skippedFeatures++;
      continue;
    }
    const prodRole = prodRoleByName.get(uatRole.role_name);
    const prodFeature = prodFeatureByKey.get(uatFeature.key);
    if (!prodRole || !prodFeature) {
      skippedFeatures++;
      continue;
    }
    prodRoleFeatures.push({
      role_id: prodRole.id,
      feature_id: prodFeature.id,
      value: rf.value,
    });
  }

  const prodRoleActions = [];
  let skippedActions = 0;
  for (const ra of uatRoleActions) {
    const uatRole = uatRoleById.get(ra.role_id);
    const uatAction = uatActionById.get(ra.action_id);
    if (!uatRole || !uatAction) {
      skippedActions++;
      continue;
    }
    const prodRole = prodRoleByName.get(uatRole.role_name);
    const prodAction = prodActionByKey.get(uatAction.key);
    if (!prodRole || !prodAction) {
      skippedActions++;
      continue;
    }
    prodRoleActions.push({
      role_id: prodRole.id,
      action_id: prodAction.id,
      value: ra.value,
    });
  }

  const prodRolePermissionsByKey = new Map();
  let skippedPerms = 0;
  for (const rp of uatRolePermissions) {
    const uatRole = uatRoleById.get(rp.role_id);
    if (!uatRole) {
      skippedPerms++;
      continue;
    }
    const prodRole = prodRoleByName.get(uatRole.role_name);
    if (!prodRole) {
      skippedPerms++;
      continue;
    }
    const key = `${prodRole.id}\0${rp.object_type}\0${rp.object_name}\0${rp.operation}`;
    // UAT may have duplicate rows per key; prefer allowed=true when merging.
    const existing = prodRolePermissionsByKey.get(key);
    if (!existing || (rp.allowed && !existing.allowed)) {
      prodRolePermissionsByKey.set(key, {
        role_id: prodRole.id,
        object_type: rp.object_type,
        object_name: rp.object_name,
        operation: rp.operation,
        allowed: rp.allowed,
      });
    }
  }
  const prodRolePermissions = [...prodRolePermissionsByKey.values()];

  const summary = {
    at: new Date().toISOString(),
    dryRun,
    role_features: { mapped: prodRoleFeatures.length, skipped: skippedFeatures },
    role_actions: { mapped: prodRoleActions.length, skipped: skippedActions },
    role_permissions: { mapped: prodRolePermissions.length, skipped: skippedPerms },
  };

  console.log('Mapped rows:', JSON.stringify(summary, null, 2));

  if (dryRun) {
    fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
    console.log('Dry run — no writes. Results:', path.relative(process.cwd(), resultsPath));
    return;
  }

  console.log(`Writing to production (${PRODUCTION.ref})…`);
  summary.role_features.upserted = await restUpsert(
    PRODUCTION.ref,
    'role_features',
    prodRoleFeatures,
    'role_id,feature_id'
  );
  summary.role_actions.upserted = await restUpsert(
    PRODUCTION.ref,
    'role_actions',
    prodRoleActions,
    'role_id,action_id'
  );
  summary.role_permissions.upserted = await restUpsert(
    PRODUCTION.ref,
    'role_permissions',
    prodRolePermissions,
    'role_id,object_type,object_name,operation'
  );

  fs.writeFileSync(resultsPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  console.log('Permission sync complete. Users must log out and back in.');
  console.log('Results:', path.relative(process.cwd(), resultsPath));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
