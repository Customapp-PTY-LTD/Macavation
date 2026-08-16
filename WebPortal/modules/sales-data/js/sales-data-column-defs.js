/**
 * Sales & Production Data — column definition registry.
 *
 * A pure data registry: no DOM, no `document`/`$` reference at evaluation time (same convention as
 * WebPortal/modules/sales-reports/js/report-metric-line.js), so this file can be evaluated with
 * plain `vm.Script` and no browser. The generic row-grid engine (sales-data-row-grid.js) is driven
 * entirely by whatever `get(datasetKey)` returns here — it never references a dataset by name.
 *
 * Only `production_daily` is defined in this plan. Every other dataset tab renders an empty state
 * until a later plan adds its column definition here.
 */
(function (w) {
    'use strict';

    // Columns that carry a system/live twin (migrations/20260819090000_data_page_production_daily.sql).
    var PRODUCTION_DAILY_COLUMNS = [
        {
            key: 'cracked_kg',
            label: 'Cracked',
            type: 'number',
            step: '0.01',
            hasSystemTwin: true,
            nullable: false,
            totalable: true
        },
        {
            key: 'sk_packed_kg',
            label: 'Packed',
            type: 'number',
            step: '0.01',
            hasSystemTwin: true,
            nullable: false,
            totalable: true
        },
        {
            key: 'wholes_pct',
            label: 'Wholes %',
            type: 'number',
            step: '0.001',
            hasSystemTwin: false,
            nullable: true,
            totalable: false
        },
        {
            key: 'uncracks_pct',
            label: 'Uncracks %',
            type: 'number',
            step: '0.001',
            hasSystemTwin: false,
            nullable: true,
            totalable: false
        },
        {
            key: 'oil_kernel_kg',
            label: 'Oil kernel',
            type: 'number',
            step: '0.01',
            hasSystemTwin: false,
            nullable: true,
            totalable: true
        },
        {
            key: 'cracker_dust_kg',
            label: 'Cracker dust',
            type: 'number',
            step: '0.01',
            hasSystemTwin: false,
            nullable: true,
            totalable: true
        },
        {
            key: 'shell_fines_kg',
            label: 'Shell fines',
            type: 'number',
            step: '0.01',
            hasSystemTwin: false,
            nullable: true,
            totalable: true
        },
        {
            key: 'compost_kg',
            label: 'Compost',
            type: 'number',
            step: '0.01',
            hasSystemTwin: false,
            nullable: true,
            totalable: true
        },
        {
            key: 'shell_kg',
            label: 'Shell',
            type: 'number',
            step: '0.01',
            hasSystemTwin: false,
            nullable: true,
            totalable: true
        },
        {
            key: 'notes',
            label: 'Notes',
            type: 'text',
            step: null,
            hasSystemTwin: false,
            nullable: true,
            totalable: false
        }
    ];

    // Kernel sales is a LEDGER: many rows per date, keyed on a uuid, rows added and removed by hand.
    // No column has a _system twin — data_kernel_sales_lines has no *_system columns at all and the
    // dataset catalog records supports_reseed = false, so there is nothing to seed from.
    //
    // Customer is two columns on purpose, because the data genuinely is: all 277 backfilled rows
    // carry a customer_name, but only 214 resolved to a contacts row. The lookup writes
    // customer_id; the text column keeps the name Pete's spreadsheet actually had.
    var KERNEL_SALES_COLUMNS = [
        { key: 'sale_date', label: 'Date', type: 'date', step: null, hasSystemTwin: false, nullable: false, totalable: false },
        {
            key: 'customer_id', label: 'Customer', type: 'lookup', step: null,
            hasSystemTwin: false, nullable: true, totalable: false,
            // Shows the stored name when the row never resolved to a contact.
            unmatchedFrom: 'customer_name', blankLabel: '— none —'
        },
        { key: 'customer_name', label: 'Customer name', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'invoice_number', label: 'Invoice', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'item_code', label: 'Item code', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        {
            key: 'style_code', label: 'Style', type: 'lookup', step: null,
            hasSystemTwin: false, nullable: true, totalable: false, blankLabel: '— none —'
        },
        { key: 'description', label: 'Description', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'cartons', label: 'Cartons', type: 'number', step: '0.01', hasSystemTwin: false, nullable: true, totalable: true },
        { key: 'quantity_kg', label: 'Kg', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        // numeric(12,4) in the database — a step of '0.01' here would silently round away the 3rd
        // and 4th decimals, because parseNullableNumber rounds to the scale the step implies.
        { key: 'price_per_kg', label: 'Price/kg', type: 'number', step: '0.0001', hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'vat_excl_zar', label: 'Excl VAT', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        { key: 'vat_zar', label: 'VAT', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        { key: 'vat_incl_zar', label: 'Incl VAT', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        { key: 'notes', label: 'Notes', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false }
    ];

    // The six values data_oil_sales_lines_product_check allows. Anything outside this list is
    // rejected by the database, so the column is a fixed <select> rather than free text.
    // Labels are ours; the values must match the CHECK constraint exactly.
    var OIL_PRODUCT_LINES = [
        { value: 'extra_virgin', label: 'Extra Virgin' },
        { value: 'protein', label: 'Protein' },
        { value: 'crude_cosmetic', label: 'Crude / Cosmetic' },
        { value: 'cake', label: 'Cake' },
        { value: 'filter_fines', label: 'Filter Fines' },
        { value: 'other', label: 'Other' }
    ];

    // Oil & protein sales — the same ledger shape as kernel sales, with product_line (a fixed
    // enum) in place of style_code (a registry lookup). Same two-column customer treatment, and for
    // the same reason: all 33 backfilled rows carry a customer_name, only 8 resolved to a contact.
    var OIL_SALES_COLUMNS = [
        { key: 'sale_date', label: 'Date', type: 'date', step: null, hasSystemTwin: false, nullable: false, totalable: false },
        {
            key: 'customer_id', label: 'Customer', type: 'lookup', step: null,
            hasSystemTwin: false, nullable: true, totalable: false,
            unmatchedFrom: 'customer_name', blankLabel: '— none —'
        },
        { key: 'customer_name', label: 'Customer name', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'invoice_number', label: 'Invoice', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'item_code', label: 'Item code', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        {
            key: 'product_line', label: 'Product', type: 'select', step: null,
            hasSystemTwin: false, nullable: true, totalable: false,
            options: OIL_PRODUCT_LINES, blankLabel: '— none —'
        },
        { key: 'description', label: 'Description', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'cartons', label: 'Cartons', type: 'number', step: '0.01', hasSystemTwin: false, nullable: true, totalable: true },
        { key: 'quantity_kg', label: 'Kg', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        // numeric(12,4), same as kernel sales — a step of '0.01' would round away two decimals.
        { key: 'price_per_kg', label: 'Price/kg', type: 'number', step: '0.0001', hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'vat_excl_zar', label: 'Excl VAT', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        { key: 'vat_zar', label: 'VAT', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        { key: 'vat_incl_zar', label: 'Incl VAT', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        { key: 'notes', label: 'Notes', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false }
    ];

    var DATASETS = {
        production_daily: {
            datasetKey: 'production_daily',
            dateColumn: 'production_date',
            supportsReseed: true,
            columns: PRODUCTION_DAILY_COLUMNS
        },
        kernel_sales_lines: {
            datasetKey: 'kernel_sales_lines',
            label: 'Kernel Sales',
            dateColumn: 'sale_date',
            idColumn: 'id',
            allowAddRemove: true,
            supportsReseed: false,
            emptyText: 'No kernel sales lines in this date range.',
            // dataFunctions wrapper names — the ledger pane resolves these by name, so a dataset is
            // added to the page as registry data rather than as another branch in the controller.
            rpc: {
                get: 'getDataKernelSalesLines',
                upsert: 'upsertDataKernelSalesLines',
                del: 'deleteDataKernelSalesLine'
            },
            // Which lookup column is fed by which reference list; the controller loads these once.
            lookups: { customer_id: 'contacts', style_code: 'kernel_styles' },
            // Recomputed from quantity x price when either changes — never on load.
            derivedMoney: true,
            moneyColumns: { excl: 'vat_excl_zar', incl: 'vat_incl_zar' },
            columns: KERNEL_SALES_COLUMNS
        },
        oil_sales_lines: {
            datasetKey: 'oil_sales_lines',
            label: 'Oil & Protein Sales',
            dateColumn: 'sale_date',
            idColumn: 'id',
            allowAddRemove: true,
            supportsReseed: false,
            emptyText: 'No oil or protein sales lines in this date range.',
            rpc: {
                get: 'getDataOilSalesLines',
                upsert: 'upsertDataOilSalesLines',
                del: 'deleteDataOilSalesLine'
            },
            // product_line is a fixed CHECK-constrained list, not a lookup table, so it carries its
            // options inline — only the customer column needs a reference list.
            lookups: { customer_id: 'contacts' },
            derivedMoney: true,
            moneyColumns: { excl: 'vat_excl_zar', incl: 'vat_incl_zar' },
            columns: OIL_SALES_COLUMNS
        }
    };

    function safeKey(key) {
        var s = String(key == null ? '' : key);
        if (s === '__proto__' || s === 'constructor' || s === 'prototype') return null;
        return s;
    }

    function get(datasetKey) {
        var k = safeKey(datasetKey);
        if (!k) return null;
        return Object.prototype.hasOwnProperty.call(DATASETS, k) ? DATASETS[k] : null;
    }

    function keys() {
        return Object.keys(DATASETS);
    }

    w.SalesDataColumnDefs = {
        get: get,
        keys: keys
    };
})(typeof window !== 'undefined' ? window : this);
