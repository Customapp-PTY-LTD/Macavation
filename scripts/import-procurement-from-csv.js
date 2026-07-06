#!/usr/bin/env node
/**
 * Bulk import historical procurement rows from CSV into kernel_intake_procurement.
 * CSV columns: scheduled_date, grower_name, predicted_weight_kg [, supplier_id]
 *
 * Usage: node scripts/import-procurement-from-csv.js path/to/procurement.csv
 * Output: SQL statements or RPC calls for review (does not auto-apply).
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/import-procurement-from-csv.js <csv-file>');
  process.exit(1);
}

const text = fs.readFileSync(path.resolve(file), 'utf8');
const lines = text.split(/\r?\n/).filter((l) => l.trim());
const header = lines[0].split(',').map((h) => h.trim().toLowerCase());

function col(row, name) {
  const i = header.indexOf(name);
  return i >= 0 ? (row[i] || '').trim() : '';
}

console.log('-- Generated procurement import SQL — review before applying');
console.log('-- RPC alternative: import_kernel_intake_procurement_row per row\n');

for (let n = 1; n < lines.length; n++) {
  const row = lines[n].split(',');
  const date = col(row, 'scheduled_date');
  const grower = col(row, 'grower_name').replace(/'/g, "''");
  const kg = col(row, 'predicted_weight_kg') || '0';
  const supplier = col(row, 'supplier_id');
  if (!date || !grower) continue;
  const sup = supplier ? `'${supplier}'::uuid` : 'NULL';
  console.log(
    `SELECT public.import_kernel_intake_procurement_row('${date}'::date, '${grower}', ${kg}, ${sup});`
  );
}
