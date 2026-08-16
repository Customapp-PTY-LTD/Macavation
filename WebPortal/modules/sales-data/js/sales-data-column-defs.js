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

    var DATASETS = {
        production_daily: {
            datasetKey: 'production_daily',
            dateColumn: 'production_date',
            supportsReseed: true,
            columns: PRODUCTION_DAILY_COLUMNS
        },
        kernel_sales_lines: {
            datasetKey: 'kernel_sales_lines',
            dateColumn: 'sale_date',
            idColumn: 'id',
            allowAddRemove: true,
            supportsReseed: false,
            emptyText: 'No kernel sales lines in this date range.',
            // Which lookup column is fed by which reference list; the controller loads these once.
            lookups: { customer_id: 'contacts', style_code: 'kernel_styles' },
            // Recomputed from quantity x price when either changes — never on load.
            derivedMoney: true,
            columns: KERNEL_SALES_COLUMNS
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
