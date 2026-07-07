#!/usr/bin/env node
/**
 * Verify audit housekeeping on both databases: every public table must have
 * owner columns (created_by/updated_by), the stamp trigger, and the audit
 * trigger; and the audit log must be receiving events.
 *
 * Fails (exit 1) if any table is uncovered on either database.
 *
 * Usage:
 *   node scripts/verify-audit-housekeeping.mjs
 *   npm run audit:verify
 */
import { PRODUCTION, DEV } from './lib/supabase-projects.mjs';
import { fetchServiceRoleKey } from './lib/supabase-rest.mjs';

async function coverage(project) {
  const key = fetchServiceRoleKey(project.ref);
  const res = await fetch(`${project.apiUrl}/rest/v1/rpc/audit_coverage`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!res.ok) {
    throw new Error(`${project.name}: audit_coverage() -> ${res.status} ${await res.text()}`);
  }
  return res.json();
}

let failed = false;
for (const project of [PRODUCTION, DEV]) {
  console.log(`\n=== ${project.name} (${project.ref}) ===`);
  let c;
  try {
    c = await coverage(project);
  } catch (err) {
    console.error(`  FAIL: ${err.message}`);
    failed = true;
    continue;
  }
  const gaps =
    c.missing_audit_trigger.length + c.missing_stamp_trigger.length + c.missing_owner_cols.length;
  console.log(`  tables: ${c.tables_total} | audit log rows: ${c.audit_log_rows}`);
  console.log(
    `  last 7 days: ${c.last_7d.events} events, ${c.last_7d.with_actor} with actor` +
      (c.last_7d.events ? ` (${Math.round((100 * c.last_7d.with_actor) / c.last_7d.events)}%)` : '')
  );
  if (gaps === 0) {
    console.log('  OK: every table has owner columns + stamp trigger + audit trigger.');
  } else {
    failed = true;
    if (c.missing_audit_trigger.length)
      console.error(`  FAIL missing audit trigger: ${c.missing_audit_trigger.join(', ')}`);
    if (c.missing_stamp_trigger.length)
      console.error(`  FAIL missing stamp trigger: ${c.missing_stamp_trigger.join(', ')}`);
    if (c.missing_owner_cols.length)
      console.error(`  FAIL missing owner columns: ${c.missing_owner_cols.join(', ')}`);
  }
}

if (failed) {
  console.error(
    '\nAudit housekeeping incomplete. Apply migrations/20260707130000_audit_ownership_housekeeping.sql to the failing database, or run: select audit.attach_all();'
  );
  process.exit(1);
}
console.log('\nAudit housekeeping OK on both databases.');
