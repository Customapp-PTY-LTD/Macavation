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

    var DATASETS = {
        production_daily: {
            datasetKey: 'production_daily',
            dateColumn: 'production_date',
            supportsReseed: true,
            columns: PRODUCTION_DAILY_COLUMNS
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
