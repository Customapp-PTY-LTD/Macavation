#!/usr/bin/env node
/**
 * Verify that roles & permissions are content-identical between the
 * production and dev databases.
 *
 * Compares by natural key (role_name, action/feature key, grant tuples) —
 * never by id, since ids differ between databases. Fails (exit 1) on any
 * difference or on duplicate grants within one database.
 *
 * Usage:
 *   node scripts/verify-rbac-parity.mjs
 *   npm run rbac:verify
 */
import { PRODUCTION, DEV } from './lib/supabase-projects.mjs';
import { restSelectAll } from './lib/supabase-rest.mjs';

const norm = (v) => (v === null || v === undefined ? '' : String(v));

async function snapshot(projectRef) {
  const [roles, actions, features, roleActions, roleFeatures, rolePermissions] =
    await Promise.all([
      restSelectAll(projectRef, 'roles'),
      restSelectAll(projectRef, 'actions'),
      restSelectAll(projectRef, 'features'),
      restSelectAll(projectRef, 'role_actions'),
      restSelectAll(projectRef, 'role_features'),
      restSelectAll(projectRef, 'role_permissions'),
    ]);

  const roleName = new Map(roles.map((r) => [String(r.id), r.role_name]));
  const actionKey = new Map(actions.map((a) => [String(a.id), a.key]));
  const featureKey = new Map(features.map((f) => [String(f.id), f.key]));

  return {
    roles: roles.map((r) => `${r.role_name}~${norm(r.is_active)}`),
    actions: actions.map((a) => `${a.key}~${norm(a.module)}~${norm(a.is_active)}`),
    features: features.map((f) => `${f.key}~${norm(f.is_active)}`),
    role_actions: roleActions.map(
      (x) => `${roleName.get(String(x.role_id))}~${actionKey.get(String(x.action_id))}~${norm(x.value)}`
    ),
    role_features: roleFeatures.map(
      (x) => `${roleName.get(String(x.role_id))}~${featureKey.get(String(x.feature_id))}~${norm(x.value)}`
    ),
    role_permissions: rolePermissions.map(
      (x) =>
        `${roleName.get(String(x.role_id))}~${x.object_type}~${x.object_name}~${x.operation}~${norm(x.allowed)}`
    ),
  };
}

function findDuplicates(list) {
  const seen = new Set();
  const dupes = new Set();
  for (const k of list) {
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  return [...dupes];
}

const TABLES = ['roles', 'actions', 'features', 'role_actions', 'role_features', 'role_permissions'];

console.log(`Comparing RBAC content: production (${PRODUCTION.ref}) vs dev (${DEV.ref})\n`);
const [prod, dev] = await Promise.all([snapshot(PRODUCTION.ref), snapshot(DEV.ref)]);

let failed = false;
for (const t of TABLES) {
  const prodSet = new Set(prod[t]);
  const devSet = new Set(dev[t]);
  const prodOnly = [...prodSet].filter((k) => !devSet.has(k));
  const devOnly = [...devSet].filter((k) => !prodSet.has(k));
  const prodDupes = findDuplicates(prod[t]);
  const devDupes = findDuplicates(dev[t]);

  const clean = !prodOnly.length && !devOnly.length && !prodDupes.length && !devDupes.length;
  console.log(
    `  ${clean ? 'OK  ' : 'FAIL'} ${t}: prod ${prodSet.size} | dev ${devSet.size}` +
      (clean ? '' : ` | prod-only ${prodOnly.length} | dev-only ${devOnly.length} | dupes prod ${prodDupes.length} / dev ${devDupes.length}`)
  );
  if (!clean) {
    failed = true;
    for (const k of prodOnly.slice(0, 5)) console.log(`         prod-only: ${k}`);
    for (const k of devOnly.slice(0, 5)) console.log(`         dev-only:  ${k}`);
    for (const k of [...prodDupes, ...devDupes].slice(0, 3)) console.log(`         duplicate: ${k}`);
  }
}

if (failed) {
  console.error(
    '\nRBAC drift detected. Reconcile deliberately (seed migration applied to both DBs), then re-run.'
  );
  process.exit(1);
}
console.log('\nRBAC parity OK: roles & permissions are content-identical in prod and dev.');
