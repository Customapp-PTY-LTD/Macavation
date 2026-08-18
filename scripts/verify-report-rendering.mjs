#!/usr/bin/env node
/**
 * verify-report-rendering — regression check for
 * WebPortal/modules/sales-reports/js/report-pdf-builder.js.
 *
 * That file turns a `get_report_instance` payload into a pdfmake document-definition object. It
 * has no reference to the DOM, any global rendering library, or any UI framework helper at
 * evaluation time (see its own header comment), so it can be loaded into a bare `vm` context and
 * exercised with plain object fixtures — no browser, no login, no network, no deployed app.
 *
 * This script is deliberately hermetic, matching the other scripts/verify-*.mjs checks wired into
 * `npm run test:fleet` (see package.json's "//test:fleet" comment): every fixture below is a
 * literal object declared in this file. Nothing here reads a database, calls a network endpoint,
 * or reaches outside this repo.
 *
 * Coverage (see the file being tested for the line each of these corresponds to):
 *   1. Each of the four line types in LINE_COLUMN_DEFS produces a table whose header row labels
 *      match that type's column labels, in order.
 *   2. The totals row sums exactly the keys listed in TOTALLED_KEYS and leaves every other numeric
 *      column ("price per kg", "exchange rate") blank, with "Total" in the first cell.
 *   3. A tracking_table section derives its two financial-year column headers from the row
 *      payload's own fy_prior/fy_current values, not from anything computed by the renderer.
 *   4. variance_pct: null renders as an empty string, never "0%".
 *   5. An unrecognised line_type degrades to a row-count message instead of throwing.
 *   6. An empty line_table section renders the "No rows for this period." placeholder.
 *   7. status: 'draft' sets docDefinition.watermark.text to 'DRAFT'; status: 'published' has no
 *      watermark property at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const BUILDER_PATH = path.join(
  REPO_ROOT,
  'WebPortal',
  'modules',
  'sales-reports',
  'js',
  'report-pdf-builder.js'
);

function loadBuilder() {
  const source = fs.readFileSync(BUILDER_PATH, 'utf8');
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  new vm.Script(source, { filename: BUILDER_PATH }).runInContext(ctx);
  const builder = ctx.window.ReportPdfBuilder;
  if (!builder || typeof builder.buildReportDocDefinition !== 'function') {
    throw new Error(
      'window.ReportPdfBuilder.buildReportDocDefinition was not defined after loading ' +
        BUILDER_PATH
    );
  }
  return builder.buildReportDocDefinition;
}

// ---- fixtures ---------------------------------------------------------------------------------

function makeReport(sections, overrides) {
  return Object.assign(
    {
      template_name: 'Test Report',
      period_label: 'Test Period',
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      version: 1,
      status: 'published',
      executive_summary: '',
      sections,
    },
    overrides || {}
  );
}

function makeSection(fields) {
  return Object.assign(
    {
      label: 'Test Section',
      is_enabled: true,
      display_order: 1,
      commentary: '',
    },
    fields
  );
}

// Finds the first content item carrying a pdfmake `table` definition. Every fixture in this
// script uses exactly one section per report, so the first table found is that section's own.
function findFirstTable(docDefinition) {
  const item = (docDefinition.content || []).find((c) => c && c.table);
  if (!item) {
    throw new Error('no content item with a `table` property was found in docDefinition.content');
  }
  return item.table;
}

function cellText(cell) {
  if (cell && typeof cell === 'object') return cell.text;
  return cell;
}

function headerLabels(table) {
  return table.body[0].map(cellText);
}

// ---- tiny test harness --------------------------------------------------------------------------

const failures = [];
let passCount = 0;

function check(description, fn) {
  try {
    fn();
    passCount++;
  } catch (err) {
    failures.push(`${description}: ${err && err.message ? err.message : err}`);
  }
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || 'values differ'} — expected ${e}, got ${a}`);
  }
}

function assertTrue(value, msg) {
  if (!value) {
    throw new Error(msg || 'expected a truthy value');
  }
}

// ---- test cases ---------------------------------------------------------------------------------

const buildReportDocDefinition = loadBuilder();

// 1. Each of the four LINE_COLUMN_DEFS line types renders its header labels in order.
const LINE_TYPE_FIXTURES = {
  kernel_sales_line: {
    labels: ['Date', 'Customer', 'Invoice', 'Style', 'Description', 'Cartons', 'Qty kg', 'Price/kg', 'Value excl VAT'],
    payload: {
      sale_date: '2026-01-05',
      customer_name: 'Acme Foods',
      invoice_number: 'INV-1',
      style_code: 'K1',
      description: 'Kernel style 1',
      cartons: 10,
      quantity_kg: 250,
      price_per_kg: 55.5,
      vat_excl_zar: 13875,
    },
  },
  oil_sales_line: {
    labels: ['Date', 'Customer', 'Invoice', 'Product', 'Description', 'Qty kg', 'Price/kg', 'Value excl VAT'],
    payload: {
      sale_date: '2026-01-06',
      customer_name: 'Oil Buyer Ltd',
      invoice_number: 'INV-2',
      product_line: 'Refined oil',
      description: 'Bulk refined',
      quantity_kg: 500,
      price_per_kg: 40,
      vat_excl_zar: 20000,
    },
  },
  oil_export_line: {
    labels: ['Date', 'Customer', 'Country', 'Document', 'Product', 'Terms', 'Qty kg', 'Price $/kg', 'Value $', 'Rate', 'Value R'],
    payload: {
      export_date: '2026-01-07',
      customer_name: 'Export Co',
      location_country: 'Kenya',
      document_number: 'DOC-1',
      product_class: 'Crude oil',
      incoterm: 'FOB',
      weight_kg: 1000,
      price_per_kg_usd: 2,
      usd_debit: 2000,
      usd_zar_rate: 18.5,
      rand_value: 37000,
    },
  },
  kernel_sales_style_line: {
    labels: ['Style', 'Cartons', 'Qty kg', 'Price/kg', 'Value excl VAT'],
    payload: {
      style_label: 'Whole kernels',
      cartons: 20,
      quantity_kg: 400,
      price_per_kg: 60,
      vat_excl_zar: 24000,
    },
  },
};

for (const [lineType, fixture] of Object.entries(LINE_TYPE_FIXTURES)) {
  check(`line type "${lineType}" renders its own column labels in order`, () => {
    const report = makeReport([
      makeSection({
        render_kind: 'line_table',
        lines: [{ line_type: lineType, payload: fixture.payload }],
      }),
    ]);
    const doc = buildReportDocDefinition(report, {});
    const table = findFirstTable(doc);
    assertEqual(headerLabels(table), fixture.labels, 'header row labels');
  });
}

// 2. Totals row honours TOTALLED_KEYS, leaves non-totalled numeric columns blank, and labels the
//    row "Total". Exercised against kernel_sales_line (covers quantity_kg, vat_excl_zar, cartons,
//    and the non-totalled price_per_kg) and oil_export_line (covers weight_kg, usd_debit,
//    rand_value, and the non-totalled usd_zar_rate) so every key named in the plan is checked.
check('totals row sums quantity_kg, vat_excl_zar and cartons; leaves price_per_kg blank', () => {
  const report = makeReport([
    makeSection({
      render_kind: 'line_table',
      lines: [
        {
          line_type: 'kernel_sales_line',
          payload: {
            sale_date: '2026-01-01',
            customer_name: 'A',
            invoice_number: 'INV-A',
            style_code: 'K1',
            description: 'd',
            cartons: 2,
            quantity_kg: 10,
            price_per_kg: 5,
            vat_excl_zar: 100,
          },
        },
        {
          line_type: 'kernel_sales_line',
          payload: {
            sale_date: '2026-01-02',
            customer_name: 'B',
            invoice_number: 'INV-B',
            style_code: 'K2',
            description: 'd',
            cartons: 3,
            quantity_kg: 20,
            price_per_kg: 6,
            vat_excl_zar: 200,
          },
        },
      ],
    }),
  ]);
  const doc = buildReportDocDefinition(report, {});
  const table = findFirstTable(doc);
  const totalsRow = table.body[table.body.length - 1].map(cellText);
  // columns: Date, Customer, Invoice, Style, Description, Cartons, Qty kg, Price/kg, Value excl VAT
  assertEqual(totalsRow[0], 'Total', 'first cell of totals row');
  assertEqual(totalsRow[5], '5.00', 'cartons total (2 + 3)');
  assertEqual(totalsRow[6], '30.00', 'quantity_kg total (10 + 20)');
  assertEqual(totalsRow[7], '', 'price_per_kg must NOT be totalled');
  assertEqual(totalsRow[8], '300.00', 'vat_excl_zar total (100 + 200)');
});

check('totals row sums weight_kg, usd_debit and rand_value; leaves usd_zar_rate blank', () => {
  const report = makeReport([
    makeSection({
      render_kind: 'line_table',
      lines: [
        {
          line_type: 'oil_export_line',
          payload: {
            export_date: '2026-01-01',
            customer_name: 'A',
            location_country: 'Kenya',
            document_number: 'D1',
            product_class: 'Crude',
            incoterm: 'FOB',
            weight_kg: 10,
            price_per_kg_usd: 1,
            usd_debit: 100,
            usd_zar_rate: 18,
            rand_value: 1800,
          },
        },
        {
          line_type: 'oil_export_line',
          payload: {
            export_date: '2026-01-02',
            customer_name: 'B',
            location_country: 'Kenya',
            document_number: 'D2',
            product_class: 'Crude',
            incoterm: 'FOB',
            weight_kg: 20,
            price_per_kg_usd: 2,
            usd_debit: 200,
            usd_zar_rate: 19,
            rand_value: 2000,
          },
        },
      ],
    }),
  ]);
  const doc = buildReportDocDefinition(report, {});
  const table = findFirstTable(doc);
  const totalsRow = table.body[table.body.length - 1].map(cellText);
  // columns: Date, Customer, Country, Document, Product, Terms, Qty kg, Price $/kg, Value $, Rate, Value R
  assertEqual(totalsRow[0], 'Total', 'first cell of totals row');
  assertEqual(totalsRow[6], '30.00', 'weight_kg total (10 + 20)');
  assertEqual(totalsRow[7], '', 'price_per_kg_usd must NOT be totalled');
  assertEqual(totalsRow[8], '300.00', 'usd_debit total (100 + 200)');
  assertEqual(totalsRow[9], '', 'usd_zar_rate must NOT be totalled');
  assertEqual(totalsRow[10], '3,800.00', 'rand_value total (1800 + 2000)');
});

// 3. Tracking table derives its two FY column headers from the row payload's own fy_prior /
//    fy_current values, and renders a 4-column table.
check('tracking table derives FY column headers from the row payload, not the renderer', () => {
  const report = makeReport([
    makeSection({
      render_kind: 'tracking_table',
      lines: [
        {
          line_type: 'tracking_line',
          payload: {
            fy_prior: 2026,
            fy_current: 2027,
            row_kind: 'month',
            label: 'Apr',
            prior_value: 100,
            current_value: 110,
            variance_pct: 0.1,
          },
        },
      ],
    }),
  ]);
  const doc = buildReportDocDefinition(report, {});
  const table = findFirstTable(doc);
  assertEqual(headerLabels(table).length, 4, 'tracking table must have exactly 4 columns');
  assertEqual(headerLabels(table), ['Month', 'FYE 2026', 'FYE 2027', 'Variance'], 'FY headers');
});

// 4. variance_pct: null renders as an empty string, never "0%".
check('variance_pct: null renders as an empty string, not "0%"', () => {
  const report = makeReport([
    makeSection({
      render_kind: 'tracking_table',
      lines: [
        {
          line_type: 'tracking_line',
          payload: {
            fy_prior: 2026,
            fy_current: 2027,
            row_kind: 'month',
            label: 'May',
            prior_value: 0,
            current_value: 50,
            variance_pct: null,
          },
        },
      ],
    }),
  ]);
  const doc = buildReportDocDefinition(report, {});
  const table = findFirstTable(doc);
  const dataRow = table.body[1].map(cellText);
  assertEqual(dataRow[3], '', 'variance_pct: null must render as an empty string, never 0%');
});

// 5. An unrecognised line_type degrades to a row-count message rather than throwing.
check('unrecognised line_type degrades to a row-count message instead of throwing', () => {
  const report = makeReport([
    makeSection({
      render_kind: 'line_table',
      lines: [
        { line_type: 'mystery_line', payload: {} },
        { line_type: 'mystery_line', payload: {} },
        { line_type: 'mystery_line', payload: {} },
      ],
    }),
  ]);
  let doc;
  assertTrue(
    (() => {
      doc = buildReportDocDefinition(report, {});
      return true;
    })(),
    'buildReportDocDefinition must not throw on an unrecognised line_type'
  );
  const table = findFirstTable(doc);
  const flatText = table.body.map((row) => row.map(cellText).join(' ')).join(' | ');
  assertTrue(
    flatText.includes('3 rows are not shown in this PDF.'),
    `expected a row-count message mentioning 3 rows, got: ${flatText}`
  );
});

// 6. An empty line_table section renders the "No rows for this period." placeholder.
check('empty line_table section renders the "No rows for this period." placeholder', () => {
  const report = makeReport([
    makeSection({
      render_kind: 'line_table',
      lines: [],
    }),
  ]);
  const doc = buildReportDocDefinition(report, {});
  const table = findFirstTable(doc);
  const flatText = table.body.map((row) => row.map(cellText).join(' ')).join(' | ');
  assertTrue(
    flatText.includes('No rows for this period.'),
    `expected the empty-table placeholder, got: ${flatText}`
  );
});

// 7. status: 'draft' sets a DRAFT watermark; status: 'published' has no watermark property.
check("status: 'draft' sets docDefinition.watermark.text to 'DRAFT'", () => {
  const report = makeReport(
    [makeSection({ render_kind: 'line_table', lines: [] })],
    { status: 'draft' }
  );
  const doc = buildReportDocDefinition(report, {});
  assertTrue(doc.watermark, 'draft report must have a watermark');
  assertEqual(doc.watermark.text, 'DRAFT', 'watermark text');
});

check("status: 'published' has no watermark property", () => {
  const report = makeReport(
    [makeSection({ render_kind: 'line_table', lines: [] })],
    { status: 'published' }
  );
  const doc = buildReportDocDefinition(report, {});
  assertTrue(
    !Object.prototype.hasOwnProperty.call(doc, 'watermark'),
    'published report must not carry a watermark property at all'
  );
});

// ---- report -------------------------------------------------------------------------------------

if (failures.length) {
  console.error(`\nREPORT RENDERING VIOLATIONS (${failures.length}):\n`);
  for (const f of failures) {
    console.error('  ' + f);
  }
  console.error(`\n${passCount} passed, ${failures.length} failed.`);
  process.exit(1);
}

console.log(`REPORT RENDERING OK (${passCount} checks passed against report-pdf-builder.js).`);
