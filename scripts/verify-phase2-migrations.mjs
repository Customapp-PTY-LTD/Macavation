#!/usr/bin/env node
/**
 * Verify Phase 2 migration files exist in migrations/ (local repo check).
 * Does not connect to Supabase — use npm run db:apply for remote apply.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const REQUIRED = [
  '20260601090000_kernel_intake_procurement.sql',
  '20260602110000_dashboard_targets.sql',
  '20260602120000_dashboard_forecast_aggregates.sql',
  '20260602130000_stock_alerts_and_accuracy.sql',
  '20260602140000_oil_consolidated_shell_massbalance.sql',
  '20260602150000_notifications.sql',
  '20260602160000_scheduled_reports.sql',
  '20260629120000_phase2_portal_features.sql',
  '20260706100000_phase2_implementation_complete.sql',
  '20260403000001_import_historical_kernel_batch.sql',
];

let missing = 0;
for (const file of REQUIRED) {
  const path = join(ROOT, 'migrations', file);
  if (existsSync(path)) {
    console.log('OK  ', file);
  } else {
    console.error('MISS', file);
    missing++;
  }
}

if (missing) {
  console.error(`\n${missing} migration file(s) missing.`);
  process.exit(1);
}
console.log('\nPhase 2 migration files present. Apply with: npm run db:apply -- migrations/<file>.sql');
