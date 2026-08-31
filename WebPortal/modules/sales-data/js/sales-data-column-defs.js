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

    // The four values data_oil_export_register_class_check allows. Note this is a DIFFERENT list
    // from OIL_PRODUCT_LINES above — the export register classes by 'evmo'/'crude', the sales
    // ledger by 'extra_virgin'/'crude_cosmetic'. They are not interchangeable and must not be
    // merged into one list.
    var OIL_EXPORT_CLASSES = [
        { value: 'evmo', label: 'EVMO' },
        { value: 'crude', label: 'Crude' },
        { value: 'protein', label: 'Protein' },
        { value: 'other', label: 'Other' }
    ];

    // Oil export register — a ledger like the sales tabs, but denominated in USD with a rand
    // conversion, and keyed on export_date rather than sale_date. It carries no VAT columns at all,
    // so nothing here is derived: see the registry entry below for why.
    var OIL_EXPORT_COLUMNS = [
        { key: 'export_date', label: 'Date', type: 'date', step: null, hasSystemTwin: false, nullable: false, totalable: false },
        {
            key: 'customer_id', label: 'Customer', type: 'lookup', step: null,
            hasSystemTwin: false, nullable: true, totalable: false,
            unmatchedFrom: 'customer_name', blankLabel: '— none —'
        },
        { key: 'customer_name', label: 'Customer name', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'location_country', label: 'Country', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'document_number', label: 'Document', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'reference', label: 'Reference', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        {
            key: 'product_class', label: 'Class', type: 'select', step: null,
            hasSystemTwin: false, nullable: true, totalable: false,
            options: OIL_EXPORT_CLASSES, blankLabel: '— none —'
        },
        // Incoterm has no CHECK constraint in the database, so it stays free text rather than a
        // select that would reject a term the register legitimately uses.
        { key: 'incoterm', label: 'Incoterm', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'weight_kg', label: 'Weight kg', type: 'number', step: '0.01', hasSystemTwin: false, nullable: true, totalable: true },
        // numeric(12,4)
        { key: 'price_per_kg_usd', label: 'USD/kg', type: 'number', step: '0.0001', hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'usd_debit', label: 'USD', type: 'number', step: '0.01', hasSystemTwin: false, nullable: true, totalable: true },
        { key: 'load_count', label: 'Loads', type: 'number', step: '0.01', hasSystemTwin: false, nullable: true, totalable: true },
        // numeric(10,4) — the exchange rate needs all four decimals.
        { key: 'usd_zar_rate', label: 'USD/ZAR', type: 'number', step: '0.0001', hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'rand_value', label: 'ZAR', type: 'number', step: '0.01', hasSystemTwin: false, nullable: true, totalable: true },
        { key: 'notes', label: 'Notes', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false }
    ];

    // Nut-in-shell intake — a ledger, but the only one with a factory mirror. moisture/PV/FFA carry
    // *_system twins refreshed by reseed_data_nis_intake; SKR and USKR do not, because the crack-out
    // sample is not trustworthy as a source (one batch records 5000g sound kernel in a 5kg sample).
    //
    // received_date is NULLABLE here, unlike sale_date and export_date. get_data_nis_intake returns
    // dateless rows regardless of the range filter, deliberately, so an incomplete row cannot hide
    // from whoever has to fix it — hence requiresDate: false on the registry entry below.
    var NIS_INTAKE_COLUMNS = [
        { key: 'received_date', label: 'Received', type: 'date', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        {
            key: 'supplier_id', label: 'Supplier', type: 'lookup', step: null,
            hasSystemTwin: false, nullable: true, totalable: false,
            unmatchedFrom: 'supplier_name', blankLabel: '— none —'
        },
        { key: 'supplier_name', label: 'Supplier name', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        // `integer` in the database, not numeric — decimals: 0 keeps a typed "12.34" from reaching
        // an ::integer cast and failing the whole save.
        { key: 'supplier_number', label: 'Supplier no.', type: 'number', step: '1', decimals: 0, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'job_number', label: 'Job', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'batch_number', label: 'Batch', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'nis_kg', label: 'NIS kg', type: 'number', step: '0.01', hasSystemTwin: false, nullable: false, totalable: true },
        // The three seedable lab results, all numeric(_,4).
        { key: 'moisture_pct', label: 'Moisture %', type: 'number', step: '0.0001', hasSystemTwin: true, nullable: true, totalable: false },
        { key: 'pv', label: 'PV', type: 'number', step: '0.0001', hasSystemTwin: true, nullable: true, totalable: false },
        { key: 'ffa_pct', label: 'FFA %', type: 'number', step: '0.0001', hasSystemTwin: true, nullable: true, totalable: false },
        // Hand-entered only — no system twin, deliberately.
        { key: 'sample_skr_pct', label: 'SKR %', type: 'number', step: '0.0001', hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'sample_uskr_pct', label: 'USKR %', type: 'number', step: '0.0001', hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'status_note', label: 'Status', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false },
        { key: 'notes', label: 'Notes', type: 'text', step: null, hasSystemTwin: false, nullable: true, totalable: false }
    ];

    var DATASETS = {
        production_daily: {
            datasetKey: 'production_daily',
            label: 'Production (daily)',
            dateColumn: 'production_date',
            supportsReseed: true,
            // Re-seed and drift are independent capabilities. This dataset has both: its read RPC
            // returns cracked_kg_live / sk_packed_kg_live, so a live comparison is possible.
            rpc: { reseed: 'reseedDataProductionDaily' },
            supportsDrift: true,
            reseedPrompt: 'This re-pulls Cracked and Packed from the factory system for every day ' +
                'in this period that is missing a row.',
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
            summaryColumns: [{ key: 'vat_excl_zar', label: 'excl' }, { key: 'vat_incl_zar', label: 'incl' }],
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
            summaryColumns: [{ key: 'vat_excl_zar', label: 'excl' }, { key: 'vat_incl_zar', label: 'incl' }],
            columns: OIL_SALES_COLUMNS
        },
        oil_export_register: {
            datasetKey: 'oil_export_register',
            label: 'Oil Export Register',
            dateColumn: 'export_date',
            idColumn: 'id',
            allowAddRemove: true,
            supportsReseed: false,
            emptyText: 'No export register rows in this date range.',
            rpc: {
                get: 'getDataOilExportRegister',
                upsert: 'upsertDataOilExportRegister',
                // Note the suffix: this RPC is delete_data_oil_export_register_ROW, not _line.
                del: 'deleteDataOilExportRegisterRow'
            },
            lookups: { customer_id: 'contacts' },
            // NOT derived. usd_debit = weight x USD/kg and rand_value = usd_debit x rate is the
            // obvious reading of these column names, but data_oil_export_register is empty on every
            // database, so that arithmetic cannot be checked against a single real row. Deriving it
            // on a guess would overwrite figures Pete typed from his own register. Turn this on once
            // the YE2027 register is loaded and the convention can actually be verified.
            derivedMoney: false,
            summaryColumns: [
                { key: 'weight_kg', label: 'kg' },
                { key: 'usd_debit', label: 'USD' },
                { key: 'rand_value', label: 'ZAR' }
            ],
            columns: OIL_EXPORT_COLUMNS
        },
        nis_intake: {
            datasetKey: 'nis_intake',
            label: 'Nut in Shell Intake',
            dateColumn: 'received_date',
            idColumn: 'id',
            allowAddRemove: true,
            supportsReseed: true,
            // Re-seed yes, drift no: reseed_data_nis_intake exists, but get_data_nis_intake returns
            // no _live columns, so there is nothing to compare a mirror against. Showing a Drift
            // button here would open a modal that can only ever be empty.
            supportsDrift: false,
            reseedPrompt: 'This re-pulls moisture, PV and FFA from batch capture for intake rows ' +
                'linked to a batch. It creates no rows.',
            // received_date is nullable and the insert has no date guard — see NIS_INTAKE_COLUMNS.
            requiresDate: false,
            emptyText: 'No intake rows in this date range.',
            rpc: {
                get: 'getDataNisIntake',
                upsert: 'upsertDataNisIntakeRows',
                del: 'deleteDataNisIntakeRow',
                reseed: 'reseedDataNisIntake'
            },
            lookups: { supplier_id: 'contacts' },
            derivedMoney: false,
            summaryColumns: [{ key: 'nis_kg', label: 'kg' }],
            columns: NIS_INTAKE_COLUMNS
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
