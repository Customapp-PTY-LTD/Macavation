/**
 * Sales & Production Data — page controller.
 *
 * Follows the company module pattern (IIFE assigned to a var, init()/destroy(), namespaced
 * events) per BluePrint/javascript-jquery-rules.md, modelled on
 * WebPortal/modules/sales-reports/js/report_list_grid.js — including its firstRpcRow/
 * isQueuedOffline/pickerDateToIso helpers and its init()-calls-destroy()-first, namespaced-event,
 * .text()-only-for-DB-values discipline. Two things that reference are NOT copied here because
 * this page needs them to differ:
 *   - Tabs are switched manually (a plain click handler that swaps #salesDataTabContent's markup),
 *     not Bootstrap's automatic data-bs-toggle="tab" plumbing — flushAutoSave() must complete
 *     (an async round trip) before the pane is replaced, and Bootstrap's own tab-shown event
 *     fires synchronously with no way to await first.
 *   - The date engine adds exactly one function, shiftIsoDateByOneDay (in sales-data-row-grid.js),
 *     for prev/next; every other period boundary is resolved server-side only (report_normalise_
 *     period_start / report_period_end / get_report_current_period) — this file never computes a
 *     period's start or end itself.
 *
 * Every database/user value reaches the DOM only via .text()/.val() or a helper already verified
 * to escape its own output (MacStatus.pill, macLoadingRow, macEmptyRow, macEmptyState) — never
 * .html()/innerHTML/string concatenation into markup.
 */
var _salesDataGrid = function () {
    'use strict';

    var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    var AUTOSAVE_DEBOUNCE_MS = 900;

    // Local dd/mm/yyyy <-> Flatpickr config, matching the existing repo idiom
    // (WebPortal/modules/modals/modal-stock-receiving-checklist/js/modal_receiving_checklist.js:9-17).
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };

    // Used only if get_data_datasets() is missing/errors, so the one dataset this plan actually
    // builds still renders rather than leaving the whole shell blank.
    var FALLBACK_DATASETS = [
        { dataset_key: 'production_daily', label: 'Production (daily)', supports_reseed: true }
    ];

    var state = {
        periodType: 'weekly',
        start: null,
        end: null,
        label: '',
        datasets: [],
        activeDatasetKey: null,
        productionRows: [],
        dirtyDates: {},
        invalidDates: {},
        saveTimer: null,
        reloadTimer: null,
        driftRows: [],

        // Kernel sales ledger. Its date range is seeded from the page period the first time the tab
        // is opened and whenever the period changes, but is then independently widenable — a week
        // of a 277-line ledger is about two rows, which is not how Pete reads his sales.
        ksFrom: null,
        ksTo: null,
        ksRows: [],
        ksDirty: {},
        ksNewSeq: 0,
        ksLookups: { customer_id: [], style_code: [] },
        ksLookupsLoaded: false
    };

    // ------------------------------------------------------------------
    // Shared helpers.
    // ------------------------------------------------------------------

    function firstRpcRow(result) {
        return Array.isArray(result) ? (result[0] || null) : (result && typeof result === 'object' ? result : null);
    }

    function isQueuedOffline(result) {
        return !!(result && result.offline === true && result.queued === true);
    }

    function canEdit() {
        return typeof hasAction === 'function' && hasAction('reports.data.edit');
    }

    // Local dd/mm/yyyy -> yyyy-mm-dd by string split only. No Date arithmetic, no UTC conversion —
    // matches WebPortal/modules/sales-reports/js/report_list_grid.js:58-65 exactly.
    function pickerDateToIso(dateStr) {
        var s = String(dateStr == null ? '' : dateStr).trim();
        if (ISO_DATE_RE.test(s)) return s;
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return null;
        var p = s.split('/');
        return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0');
    }

    function isoToPicker(iso) {
        var s = String(iso == null ? '' : iso).trim();
        if (!ISO_DATE_RE.test(s)) return '';
        var p = s.split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function setSaveStatus(text, isError) {
        var $el = $('#salesDataSaveStatus');
        $el.text(text || '\u00a0');
        $el.toggleClass('text-danger', !!isError);
    }

    function datasetLabel(key) {
        var match = null;
        state.datasets.forEach(function (d) {
            if (d && d.dataset_key === key) match = d;
        });
        return (match && match.label) ? match.label : String(key || '');
    }

    // ------------------------------------------------------------------
    // Tab strip — one <li> per row from get_data_datasets() (or the fallback).
    // ------------------------------------------------------------------

    function renderTabStrip() {
        var $strip = $('#salesDataTabStrip');
        $strip.empty();
        state.datasets.forEach(function (d) {
            var key = d && d.dataset_key ? String(d.dataset_key) : '';
            if (!key) return;
            var $li = $('<li>', { 'class': 'nav-item' });
            var $a = $('<a>', { 'class': 'nav-link js-sales-data-tab', href: '#' })
                .attr('data-dataset-key', key)
                .text(d.label || key);
            if (key === state.activeDatasetKey) $a.addClass('active');
            $li.append($a);
            $strip.append($li);
        });
    }

    function setTabStripActive(key) {
        $('#salesDataTabStrip .js-sales-data-tab').each(function () {
            $(this).toggleClass('active', $(this).attr('data-dataset-key') === key);
        });
    }

    function ensureActiveDataset() {
        var keys = state.datasets.map(function (d) { return d && d.dataset_key; });
        if (state.activeDatasetKey && keys.indexOf(state.activeDatasetKey) !== -1) return;
        state.activeDatasetKey = keys.indexOf('production_daily') !== -1 ? 'production_daily' : (keys[0] || null);
    }

    // ------------------------------------------------------------------
    // Production-daily pane.
    // ------------------------------------------------------------------

    function buildProductionTableShell($content) {
        var def = SalesDataColumnDefs.get('production_daily');
        $content.empty();
        if (!def) {
            $content.html(macEmptyState('fa-database', 'Production data is not available',
                'The column definitions for this dataset are missing.'));
            return;
        }
        var $wrap = $('<div>', { 'class': 'table-responsive' });
        var $table = $('<table>', { 'class': 'table table-sm align-middle mb-0' });
        var $trh = $('<tr>');
        $trh.append($('<th>').text('Date'));
        def.columns.forEach(function (col) {
            $trh.append($('<th>').text(col.label));
        });
        $table.append($('<thead>').append($trh));
        $table.append($('<tbody>', { id: 'salesDataProductionBody' }));
        $table.append($('<tfoot>', { id: 'salesDataProductionTotals' }));
        $wrap.append($table);
        $content.append($wrap);
    }

    function productionColCount() {
        var def = SalesDataColumnDefs.get('production_daily');
        return 1 + ((def && Array.isArray(def.columns)) ? def.columns.length : 0);
    }

    // True while the caret is inside the grid. A full re-render under a live caret moves focus and
    // throws away whatever was typed during the save round trip, so every re-render defers to this.
    function productionGridHasFocus() {
        var el = document.activeElement;
        return !!(el && $(el).closest('#salesDataProductionBody').length);
    }

    // Totals are recomputed from the DOM on every keystroke, not only after a save — the
    // reconciliation check this page exists for (a month's Cracked must total Pete's own figure) is
    // read off the <tfoot> while the figures are still being typed.
    function recomputeTotalsFromDom() {
        var def = SalesDataColumnDefs.get('production_daily');
        if (!def) return;
        var rows = [];
        $('#salesDataProductionBody tr[data-date]').each(function () {
            rows.push(SalesDataRowGrid.collectRowPayload(def, this));
        });
        SalesDataRowGrid.renderTotalsRow($('#salesDataProductionTotals'), def, rows);
    }

    // A save that lands while Pete is still typing must not re-render under him. Retry on a timer
    // until the grid is idle, so the seeded/drift accents still refresh — just not mid-keystroke.
    function reloadProductionWhenIdle() {
        if (state.reloadTimer) clearTimeout(state.reloadTimer);
        state.reloadTimer = setTimeout(function () {
            state.reloadTimer = null;
            if (hasPendingEdits() || productionGridHasFocus()) {
                reloadProductionWhenIdle();
                return;
            }
            loadProductionData(true);
        }, 1500);
    }

    function loadProductionData(forceRefresh) {
        if (!state.start || !state.end) return Promise.resolve();
        var $tbody = $('#salesDataProductionBody');
        $tbody.html(macLoadingRow(productionColCount(), 'Loading production data\u2026'));
        return dataFunctions.getDataProductionDaily(state.start, state.end, 400, 0, null, !!forceRefresh)
            .then(function (result) {
                var rows = Array.isArray(result) ? result : (result ? [result] : []);
                state.productionRows = rows;
                state.dirtyDates = {};
                state.invalidDates = {};
                var def = SalesDataColumnDefs.get('production_daily');
                SalesDataRowGrid.renderRows($tbody, def, rows, canEdit());
                SalesDataRowGrid.renderTotalsRow($('#salesDataProductionTotals'), def, rows);
                setSaveStatus('\u00a0');
                return loadDrift(forceRefresh);
            })
            .catch(function (err) {
                // Missing RPC (migration not applied to this database) must not white-screen the
                // module — render the empty state rather than leaving a spinner running.
                console.warn('[sales-data] getDataProductionDaily failed', err);
                state.productionRows = [];
                $tbody.html('<tr><td colspan="' + productionColCount() + '">' +
                    macEmptyState('fa-database', 'Production data is not available yet',
                        'The data-page migrations have not been applied to this database.') +
                    '</td></tr>');
            });
    }

    // ------------------------------------------------------------------
    // Autosave — a dirty row's whole payload is collected synchronously from the DOM (never from
    // a cached copy of what was typed), then sent as one array to upsert_data_production_daily_rows.
    // A row missing cracked_kg/sk_packed_kg is EXCLUDED from the payload (never sent as 0 or
    // omitted-meaning-default) and stays marked dirty until both are filled in.
    // ------------------------------------------------------------------

    function scheduleAutoSave() {
        if (state.saveTimer) clearTimeout(state.saveTimer);
        state.saveTimer = setTimeout(function () {
            state.saveTimer = null;
            flushAutoSave();
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    // Dispatches to whichever tab is open. appRouter calls this on routeTo and promptOnFormExit, so
    // it must cover every editable tab or a part-typed row is silently lost on navigation.
    function flushAutoSave() {
        if (state.saveTimer) {
            clearTimeout(state.saveTimer);
            state.saveTimer = null;
        }
        if (state.activeDatasetKey === 'production_daily') return flushProductionAutoSave();
        if (state.activeDatasetKey === 'kernel_sales_lines') return flushKernelSalesAutoSave();
        return Promise.resolve();
    }

    function flushProductionAutoSave() {
        var dirtyDates = Object.keys(state.dirtyDates);
        if (!dirtyDates.length) return Promise.resolve();
        var def = SalesDataColumnDefs.get('production_daily');
        if (!def) return Promise.resolve();

        var payload = [];
        var pendingInvalid = [];
        dirtyDates.forEach(function (date) {
            var $tr = $('#salesDataProductionBody tr[data-date="' + date + '"]');
            if (!$tr.length) return;
            var row = SalesDataRowGrid.collectRowPayload(def, $tr);
            if (row.cracked_kg === null || row.sk_packed_kg === null) {
                pendingInvalid.push(date);
                return;
            }
            payload.push(row);
        });

        state.invalidDates = {};
        pendingInvalid.forEach(function (d) { state.invalidDates[d] = true; });

        if (!payload.length) {
            if (pendingInvalid.length) {
                setSaveStatus('Cracked and Packed are required before a row can be saved.', true);
            }
            return Promise.resolve();
        }

        var savedDates = payload.map(function (r) { return r[def.dateColumn]; });
        setSaveStatus('Saving\u2026');
        return dataFunctions.upsertDataProductionDailyRows(payload)
            .then(function (result) {
                handleSaveResult(result, savedDates, pendingInvalid);
            })
            .catch(function (err) {
                console.warn('[sales-data] upsertDataProductionDailyRows failed', err);
                setSaveStatus('Could not save \u2014 this feature may not be available on this database yet.', true);
            });
    }

    function handleSaveResult(result, savedDates, pendingInvalid) {
        if (isQueuedOffline(result)) {
            savedDates.forEach(function (d) { delete state.dirtyDates[d]; });
            setSaveStatus('Offline \u2014 changes queued and will save when the connection returns.');
            return;
        }
        var row = firstRpcRow(result);
        if (row && Number(row.success) === 1) {
            savedDates.forEach(function (d) { delete state.dirtyDates[d]; });
            if (pendingInvalid && pendingInvalid.length) {
                setSaveStatus('Saved. ' + pendingInvalid.length + ' row(s) still need Cracked and Packed before they can save.', true);
            } else {
                setSaveStatus('Saved.');
            }
            if (hasPendingEdits() || productionGridHasFocus()) {
                reloadProductionWhenIdle();
            } else {
                loadProductionData(true);
            }
        } else {
            var msg = (row && row.error) ? row.error : 'Could not save the changes.';
            setSaveStatus(msg, true);
        }
    }

    function hasPendingEdits() {
        return Object.keys(state.dirtyDates).length > 0 || Object.keys(state.ksDirty).length > 0;
    }

    // ------------------------------------------------------------------
    // Kernel sales ledger pane.
    // ------------------------------------------------------------------

    function fyRangeFor(iso) {
        return SalesDataRowGrid.fyRangeFor(iso);
    }

    function ksDef() {
        return SalesDataColumnDefs.get('kernel_sales_lines');
    }

    function ksColCount() {
        var def = ksDef();
        return 1 + ((def && Array.isArray(def.columns)) ? def.columns.length : 0);
    }

    // Every <tr> needs a stable handle for the dirty set. Saved rows use their uuid; a row the user
    // just added has none until it comes back from the server, so it gets a local key that lives
    // only on the DOM node.
    function ksRowKey($tr) {
        var id = $tr.attr('data-row-id');
        if (id) return id;
        var local = $tr.attr('data-local-key');
        if (!local) {
            state.ksNewSeq += 1;
            local = 'new-' + state.ksNewSeq;
            $tr.attr('data-local-key', local);
        }
        return local;
    }

    function ksFindRow(key) {
        var $byId = $('#salesDataKernelSalesBody tr[data-row-id="' + key + '"]');
        if ($byId.length) return $byId;
        return $('#salesDataKernelSalesBody tr[data-local-key="' + key + '"]');
    }

    function loadKernelSalesLookups() {
        if (state.ksLookupsLoaded) return Promise.resolve();
        return Promise.all([
            dataFunctions.getContacts().catch(function (err) {
                console.warn('[sales-data] getContacts failed', err);
                return [];
            }),
            dataFunctions.getKernelStyles().catch(function (err) {
                console.warn('[sales-data] getKernelStyles failed', err);
                return [];
            })
        ]).then(function (results) {
            var contacts = Array.isArray(results[0]) ? results[0] : [];
            var styles = Array.isArray(results[1]) ? results[1] : [];
            state.ksLookups.customer_id = contacts.map(function (c) {
                return {
                    value: c && (c.id || c.contact_id),
                    label: (c && (c.company_name || c.name || c.contact_name || c.email)) || '(unnamed)'
                };
            }).filter(function (o) { return o.value; });
            state.ksLookups.style_code = styles.map(function (s) {
                return { value: s && s.style_code, label: (s && (s.label || s.style_code)) || '' };
            }).filter(function (o) { return o.value; });
            state.ksLookupsLoaded = true;
        });
    }

    function buildKernelSalesShell($content) {
        var def = ksDef();
        $content.empty();
        if (!def) {
            $content.html(macEmptyState('fa-database', 'Kernel sales is not available',
                'The column definitions for this dataset are missing.'));
            return;
        }

        var $bar = $('<div>', { 'class': 'row g-2 align-items-end mb-3' });
        var $fromCol = $('<div>', { 'class': 'col-auto' });
        $fromCol.append($('<label>', { 'class': 'form-label', 'for': 'salesDataKsFrom' }).text('From'));
        $fromCol.append($('<input>', { type: 'text', id: 'salesDataKsFrom', 'class': 'form-control form-control-sm flatpickr-date', autocomplete: 'off' }));
        var $toCol = $('<div>', { 'class': 'col-auto' });
        $toCol.append($('<label>', { 'class': 'form-label', 'for': 'salesDataKsTo' }).text('To'));
        $toCol.append($('<input>', { type: 'text', id: 'salesDataKsTo', 'class': 'form-control form-control-sm flatpickr-date', autocomplete: 'off' }));
        var $applyCol = $('<div>', { 'class': 'col-auto' });
        $applyCol.append($('<label>', { 'class': 'form-label d-block' }).html('&nbsp;'));
        $applyCol.append($('<button>', { type: 'button', 'class': 'btn btn-sm btn-outline-secondary', id: 'salesDataKsApply' }).text('Apply'));
        var $sumCol = $('<div>', { 'class': 'col' });
        $sumCol.append($('<div>', { 'class': 'text-muted small', id: 'salesDataKsSummary' }).html('&nbsp;'));
        var $addCol = $('<div>', { 'class': 'col-auto' });
        $addCol.append($('<label>', { 'class': 'form-label d-block' }).html('&nbsp;'));
        var $addBtn = $('<button>', { type: 'button', 'class': 'btn btn-sm btn-primary', id: 'salesDataKsAdd' })
            .attr('data-action-perm', 'reports.data.edit')
            .prop('disabled', !canEdit())
            .text('Add line');
        $addCol.append($addBtn);
        $bar.append($fromCol).append($toCol).append($applyCol).append($sumCol).append($addCol);
        $content.append($bar);

        var $wrap = $('<div>', { 'class': 'table-responsive' });
        var $table = $('<table>', { 'class': 'table table-sm align-middle mb-0' });
        var $trh = $('<tr>');
        $trh.append($('<th>').text(''));
        def.columns.forEach(function (col) {
            $trh.append($('<th>').text(col.label));
        });
        $trh.append($('<th>').text(''));
        $table.append($('<thead>').append($trh));
        $table.append($('<tbody>', { id: 'salesDataKernelSalesBody' }));
        $table.append($('<tfoot>', { id: 'salesDataKernelSalesTotals' }));
        $wrap.append($table);
        $content.append($wrap);

        // Seed the range to the financial year, not the page period. A ledger of 277 lines over two
        // years has roughly two rows in any given week, so seeding from a weekly period opens the
        // tab on an empty grid — which reads as "the tab is broken" rather than "no sales that week".
        // The FY is the unit Pete actually reconciles in; he can narrow it from here.
        if (!state.ksFrom || !state.ksTo) {
            var fy = fyRangeFor(state.start);
            state.ksFrom = fy ? fy.from : state.start;
            state.ksTo = fy ? fy.to : state.end;
        }
        $('#salesDataKsFrom').val(isoToPicker(state.ksFrom));
        $('#salesDataKsTo').val(isoToPicker(state.ksTo));
        [document.getElementById('salesDataKsFrom'), document.getElementById('salesDataKsTo')].forEach(function (el) {
            if (el && typeof flatpickr !== 'undefined' && !el._flatpickr) flatpickr(el, FLATPICKR_DDMMYYYY);
        });
    }

    // The delete control lives in a trailing cell that the column registry does not describe, so it
    // is appended per row here rather than inside the generic engine.
    function ksDecorateRow($tr) {
        var $cell = $('<td>', { 'class': 'text-end' });
        if (canEdit()) {
            $cell.append($('<button>', {
                type: 'button',
                'class': 'btn btn-sm btn-outline-danger js-sales-data-ks-delete',
                title: 'Delete line'
            }).append($('<i>', { 'class': 'fas fa-trash' })));
        }
        $tr.append($cell);
        return $tr;
    }

    function ksRenderTotals(rows) {
        var def = ksDef();
        var $foot = $('#salesDataKernelSalesTotals');
        $foot.empty();
        var totals = SalesDataRowGrid.totalsFor(def, rows);
        var $tr = $('<tr>');
        $tr.append($('<th>').text('Total'));
        def.columns.forEach(function (col) {
            var $th = $('<th>');
            if (col.totalable) $th.text(SalesDataRowGrid.formatKg(totals[col.key]));
            $tr.append($th);
        });
        $tr.append($('<th>').text(''));
        $foot.append($tr);
        $('#salesDataKsSummary').text(rows.length + ' line' + (rows.length === 1 ? '' : 's') +
            ' · ' + SalesDataRowGrid.formatKg(totals.vat_excl_zar) + ' excl · ' +
            SalesDataRowGrid.formatKg(totals.vat_incl_zar) + ' incl');
    }

    // Recomputes the totals row from what is currently typed, so the figures Pete reconciles against
    // stay live rather than only refreshing after a save.
    function ksRecomputeTotalsFromDom() {
        var def = ksDef();
        if (!def) return;
        var rows = [];
        $('#salesDataKernelSalesBody tr').each(function () {
            if ($(this).find('[data-field]').length) rows.push(SalesDataRowGrid.collectRowPayload(def, this));
        });
        ksRenderTotals(rows);
    }

    function loadKernelSalesData(forceRefresh) {
        var def = ksDef();
        if (!def) return Promise.resolve();
        var $tbody = $('#salesDataKernelSalesBody');
        $tbody.html(macLoadingRow(ksColCount(), 'Loading kernel sales…'));
        return loadKernelSalesLookups().then(function () {
            return dataFunctions.getDataKernelSalesLines(state.ksFrom, state.ksTo, 500, 0, null, !!forceRefresh);
        }).then(function (result) {
            var rows = Array.isArray(result) ? result : (result ? [result] : []);
            state.ksRows = rows;
            state.ksDirty = {};
            SalesDataRowGrid.renderRows($tbody, def, rows, canEdit(), state.ksLookups);
            $tbody.find('tr').each(function () {
                if ($(this).find('[data-field]').length) ksDecorateRow($(this));
            });
            ksRenderTotals(rows);
            setSaveStatus(' ');
        }).catch(function (err) {
            console.warn('[sales-data] getDataKernelSalesLines failed', err);
            state.ksRows = [];
            $tbody.html('<tr><td colspan="' + ksColCount() + '">' +
                macEmptyState('fa-database', 'Kernel sales is not available yet',
                    'The data-page migrations have not been applied to this database.') +
                '</td></tr>');
        });
    }

    function flushKernelSalesAutoSave() {
        var keys = Object.keys(state.ksDirty);
        if (!keys.length) return Promise.resolve();
        var def = ksDef();
        if (!def) return Promise.resolve();

        var payload = [];
        var savedKeys = [];
        var pendingInvalid = 0;
        keys.forEach(function (key) {
            var $tr = ksFindRow(key);
            if (!$tr.length) return;
            var row = SalesDataRowGrid.collectRowPayload(def, $tr);
            // An insert with no sale_date is silently dropped by the RPC's WHERE clause, so hold the
            // row back and leave it dirty rather than reporting a save that wrote nothing.
            if (!row.sale_date) {
                pendingInvalid += 1;
                return;
            }
            payload.push(row);
            savedKeys.push(key);
        });

        if (!payload.length) {
            if (pendingInvalid) setSaveStatus('A date is required before a line can be saved.', true);
            return Promise.resolve();
        }

        setSaveStatus('Saving…');
        return dataFunctions.upsertDataKernelSalesLines(payload)
            .then(function (result) {
                if (isQueuedOffline(result)) {
                    savedKeys.forEach(function (k) { delete state.ksDirty[k]; });
                    setSaveStatus('Offline — changes queued and will save when the connection returns.');
                    return;
                }
                var row = firstRpcRow(result);
                if (row && Number(row.success) === 1) {
                    savedKeys.forEach(function (k) { delete state.ksDirty[k]; });
                    setSaveStatus(pendingInvalid
                        ? 'Saved. ' + pendingInvalid + ' line(s) still need a date.'
                        : 'Saved.', !!pendingInvalid);
                    // A reload is the only way a new row learns its server-assigned id, so unlike the
                    // production pane this cannot be deferred indefinitely — but it still waits until
                    // the caret is out of the grid.
                    ksReloadWhenIdle();
                } else {
                    setSaveStatus((row && row.error) ? row.error : 'Could not save the changes.', true);
                }
            })
            .catch(function (err) {
                console.warn('[sales-data] upsertDataKernelSalesLines failed', err);
                setSaveStatus('Could not save — this feature may not be available on this database yet.', true);
            });
    }

    function ksGridHasFocus() {
        var el = document.activeElement;
        return !!(el && $(el).closest('#salesDataKernelSalesBody').length);
    }

    function ksReloadWhenIdle() {
        if (state.reloadTimer) clearTimeout(state.reloadTimer);
        state.reloadTimer = setTimeout(function () {
            state.reloadTimer = null;
            if (Object.keys(state.ksDirty).length || ksGridHasFocus()) {
                ksReloadWhenIdle();
                return;
            }
            loadKernelSalesData(true);
        }, 1500);
    }

    function ksAddLine() {
        if (!canEdit()) return;
        var def = ksDef();
        if (!def) return;
        var seed = {};
        seed[def.dateColumn] = state.ksFrom || state.start || '';
        var $tr = SalesDataRowGrid.addBlankRow($('#salesDataKernelSalesBody'), def, true, state.ksLookups, seed);
        ksDecorateRow($tr);
        var key = ksRowKey($tr);
        state.ksDirty[key] = true;
        setSaveStatus('Unsaved changes…');
        $tr.find('[data-field="' + def.dateColumn + '"]').trigger('focus');
    }

    function ksDeleteLine($tr) {
        if (!canEdit()) return;
        var id = $tr.attr('data-row-id');
        if (!id) {
            // Never saved — nothing on the server to remove.
            delete state.ksDirty[ksRowKey($tr)];
            $tr.remove();
            ksRecomputeTotalsFromDom();
            return;
        }
        Swal.fire({
            icon: 'warning',
            title: 'Delete this line?',
            text: 'The sales line is removed permanently.',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#d33',
            cancelButtonColor: '#6c757d'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            return dataFunctions.deleteDataKernelSalesLine(id).then(function (res) {
                if (isQueuedOffline(res)) {
                    setSaveStatus('Offline — the delete is queued.');
                    return;
                }
                var row = firstRpcRow(res);
                if (row && Number(row.success) === 1) {
                    delete state.ksDirty[id];
                    loadKernelSalesData(true);
                } else {
                    Swal.fire({ icon: 'error', title: 'Could not delete', text: (row && row.error) || 'The line was not removed.' });
                }
            }).catch(function (err) {
                console.warn('[sales-data] deleteDataKernelSalesLine failed', err);
                Swal.fire({ icon: 'error', title: 'Could not delete', text: 'This feature is not available yet on this database.' });
            });
        });
    }

    function ksApplyRange() {
        var from = pickerDateToIso($('#salesDataKsFrom').val());
        var to = pickerDateToIso($('#salesDataKsTo').val());
        if (!from || !to) {
            setSaveStatus('Enter both dates as dd/mm/yyyy.', true);
            return;
        }
        if (from > to) {
            // Plain string comparison is safe and correct for yyyy-mm-dd, and keeps this file free of
            // Date arithmetic as its header comment requires.
            setSaveStatus('From must not be after To.', true);
            return;
        }
        flushAutoSave().then(function () {
            state.ksFrom = from;
            state.ksTo = to;
            return loadKernelSalesData(true);
        });
    }

    // ------------------------------------------------------------------
    // Drift badge + modal.
    // ------------------------------------------------------------------

    function loadDrift(forceRefresh) {
        if (!state.start || !state.end) return Promise.resolve();
        return dataFunctions.getDataProductionDailyDrift(state.start, state.end, 200, 0, null, !!forceRefresh)
            .then(function (result) {
                var rows = Array.isArray(result) ? result : (result ? [result] : []);
                state.driftRows = rows;
                // Counted with countSeededDrift, never the RPC's own total_count — a never-seeded
                // day comes back as "drift" from IS DISTINCT FROM against a NULL system value,
                // which is not real drift.
                $('#salesDataDriftCount').text(String(SalesDataRowGrid.countSeededDrift(rows)));
            })
            .catch(function (err) {
                console.warn('[sales-data] getDataProductionDailyDrift failed', err);
                state.driftRows = [];
                $('#salesDataDriftCount').text('0');
            });
    }

    function renderDriftModal() {
        var $tbody = $('#salesDataDriftTableBody');
        $tbody.empty();
        var seeded = state.driftRows.filter(function (r) {
            return r && r.stored_system !== null && r.stored_system !== undefined;
        });
        if (!seeded.length) {
            $tbody.html(macEmptyRow(5, 'No drift for this period.'));
            return;
        }
        seeded.forEach(function (r) {
            var $tr = $('<tr>');
            $tr.append($('<td>').text(String(r.production_date == null ? '' : r.production_date).slice(0, 10)));
            $tr.append($('<td>').text(String(r.field_name == null ? '' : r.field_name)));
            $tr.append($('<td>').text(SalesDataRowGrid.formatKg(r.stored_system)));
            $tr.append($('<td>').text(SalesDataRowGrid.formatKg(r.live_system)));
            $tr.append($('<td>').text(SalesDataRowGrid.formatKg(r.delta)));
            $tbody.append($tr);
        });
    }

    function openDriftModal() {
        renderDriftModal();
        var modalEl = document.getElementById('salesDataDriftModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        } else if (typeof $ !== 'undefined' && $.fn.modal) {
            $('#salesDataDriftModal').modal('show');
        }
    }

    // ------------------------------------------------------------------
    // Refresh from factory (reseed).
    // ------------------------------------------------------------------

    function handleReseed() {
        if (!canEdit() || !state.start || !state.end) return;
        Swal.fire({
            icon: 'question',
            title: 'Refresh from factory?',
            text: 'This re-pulls Cracked and Packed from the factory system for every day in this ' +
                'period that is missing a row. It will not change any figure you have already entered.',
            showCancelButton: true,
            confirmButtonText: 'Refresh',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#6c757d'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            return flushAutoSave().then(function () {
                return dataFunctions.reseedDataProductionDaily(state.start, state.end);
            }).then(function (reseedResult) {
                if (isQueuedOffline(reseedResult)) {
                    Swal.fire({ icon: 'info', title: 'Queued', text: 'You are offline. The refresh will run when the connection returns.' });
                    return;
                }
                var row = firstRpcRow(reseedResult);
                if (row && Number(row.success) === 1) {
                    loadProductionData(true);
                } else {
                    var msg = (row && row.error) ? row.error : 'Could not refresh from the factory.';
                    Swal.fire({ icon: 'error', title: 'Could not refresh', text: msg });
                }
            }).catch(function (err) {
                console.warn('[sales-data] reseedDataProductionDaily failed', err);
                Swal.fire({ icon: 'error', title: 'Could not refresh', text: 'This feature is not available yet on this database.' });
            });
        });
    }

    // ------------------------------------------------------------------
    // Tab switching — manual, so it can await flushAutoSave() before swapping the pane.
    // ------------------------------------------------------------------

    function renderTabContent(key, forceReload) {
        var $content = $('#salesDataTabContent');
        if (key === 'production_daily') {
            buildProductionTableShell($content);
            return loadProductionData(!!forceReload);
        }
        if (key === 'kernel_sales_lines') {
            buildKernelSalesShell($content);
            return loadKernelSalesData(!!forceReload);
        }
        $content.html(macEmptyState('fa-table', datasetLabel(key) + ' is not built yet',
            'This dataset will be added in a later release.'));
        return Promise.resolve();
    }

    function switchTab(key, forceReload) {
        if (!key) return Promise.resolve();
        return flushAutoSave().then(function () {
            state.activeDatasetKey = key;
            setTabStripActive(key);
            syncHeaderControls(key);
            return renderTabContent(key, forceReload);
        });
    }

    // Drift and "Refresh from factory" are meaningful only for a dataset with a factory mirror.
    // Kernel sales has no *_system columns and the catalog records supports_reseed = false, so both
    // controls are hidden there rather than left visible and inert.
    function syncHeaderControls(key) {
        var def = SalesDataColumnDefs.get(key);
        var seedable = !!(def && def.supportsReseed);
        $('#salesDataReseedBtn').toggleClass('d-none', !seedable);
        $('#salesDataDriftBtn').toggleClass('d-none', !seedable);
    }

    // ------------------------------------------------------------------
    // Period resolution — every boundary comes from the server; the only date arithmetic done
    // here is shiftIsoDateByOneDay, used solely to pick an ANCHOR date for prev/next (the server
    // then snaps that anchor to the real period it belongs to).
    // ------------------------------------------------------------------

    function periodLabelFor(periodType, start, end) {
        return (periodType === 'monthly' ? 'Month of ' : 'Week of ') + start + ' \u2013 ' + end;
    }

    function applyPeriod(start, end, label) {
        state.start = start;
        state.end = end;
        state.label = label || periodLabelFor(state.periodType, start, end);
        $('#salesDataPeriodLabel').text(state.label);
        var el = document.getElementById('salesDataPeriodDate');
        if (el) {
            var ddmmyyyy = isoToPicker(start);
            if (el._flatpickr) el._flatpickr.setDate(ddmmyyyy, false, 'd/m/Y');
            else el.value = ddmmyyyy;
        }
        if (canEdit()) $('#salesDataReseedBtn').prop('disabled', false);
        // Changing the page period reseeds the ledger to that period's financial year. Pete can
        // narrow it again afterwards; this only decides where he starts from.
        var fyRange = fyRangeFor(start);
        state.ksFrom = fyRange ? fyRange.from : start;
        state.ksTo = fyRange ? fyRange.to : end;
    }

    function resolvePeriodFromCurrent() {
        return dataFunctions.getReportCurrentPeriod(state.periodType).then(function (result) {
            var row = firstRpcRow(result);
            if (!row || !row.period_start || !row.period_end) {
                throw new Error('get_report_current_period returned no row for "' + state.periodType + '"');
            }
            applyPeriod(String(row.period_start).slice(0, 10), String(row.period_end).slice(0, 10), row.period_label || '');
        });
    }

    function resolvePeriodFromDate(iso) {
        return dataFunctions.getReportPeriodStart(state.periodType, iso).then(function (startResult) {
            var start = SalesDataRowGrid.scalarIsoDate(startResult);
            if (!start) throw new Error('report_normalise_period_start returned no usable date');
            return dataFunctions.getReportPeriodEnd(state.periodType, start).then(function (endResult) {
                var end = SalesDataRowGrid.scalarIsoDate(endResult);
                if (!end) throw new Error('report_period_end returned no usable date');
                applyPeriod(start, end, periodLabelFor(state.periodType, start, end));
            });
        });
    }

    // Renders the exact-required-text empty state and disables the reseed button — this is a
    // deployment state (the period-resolution RPCs are missing), not a data state, and must be
    // visibly distinguishable from "no rows for this period" in the console too.
    function handlePeriodResolutionFailure(err) {
        console.warn('[sales-data] period resolution failed', err);
        state.start = null;
        state.end = null;
        $('#salesDataPeriodLabel').text('Could not resolve the reporting period.');
        $('#salesDataReseedBtn').prop('disabled', true);
        $('#salesDataTabContent').html(macEmptyState('fa-calendar-times', 'Reporting period is not available yet',
            'The report-builder migrations have not been applied to this database.'));
    }

    function goToPreviousPeriod() {
        if (!state.start) return;
        var anchor = SalesDataRowGrid.shiftIsoDateByOneDay(state.start, -1);
        if (!anchor) return;
        flushAutoSave()
            .then(function () { return resolvePeriodFromDate(anchor); })
            .then(function () { return switchTab(state.activeDatasetKey, true); })
            .catch(handlePeriodResolutionFailure);
    }

    function goToNextPeriod() {
        if (!state.end) return;
        var anchor = SalesDataRowGrid.shiftIsoDateByOneDay(state.end, 1);
        if (!anchor) return;
        flushAutoSave()
            .then(function () { return resolvePeriodFromDate(anchor); })
            .then(function () { return switchTab(state.activeDatasetKey, true); })
            .catch(handlePeriodResolutionFailure);
    }

    function onPeriodTypeChanged() {
        state.periodType = $('input[name="salesDataPeriodType"]:checked').val() || 'weekly';
        flushAutoSave()
            .then(function () { return resolvePeriodFromCurrent(); })
            .then(function () { return switchTab(state.activeDatasetKey, true); })
            .catch(handlePeriodResolutionFailure);
    }

    function onPeriodDateChanged() {
        var el = document.getElementById('salesDataPeriodDate');
        var iso = pickerDateToIso(el ? el.value : '');
        if (!iso) return;
        flushAutoSave()
            .then(function () { return resolvePeriodFromDate(iso); })
            .then(function () { return switchTab(state.activeDatasetKey, true); })
            .catch(handlePeriodResolutionFailure);
    }

    // ------------------------------------------------------------------
    // Dataset catalogue.
    // ------------------------------------------------------------------

    function loadDatasetsList() {
        return dataFunctions.getDataDatasets().then(function (result) {
            var rows = Array.isArray(result) ? result : (result ? [result] : []);
            state.datasets = rows.length ? rows : FALLBACK_DATASETS.slice();
        }).catch(function (err) {
            console.warn('[sales-data] getDataDatasets failed', err);
            state.datasets = FALLBACK_DATASETS.slice();
        });
    }

    // ------------------------------------------------------------------
    // Event wiring — every binding namespaced ".salesData"; destroy() removes them all.
    // ------------------------------------------------------------------

    function initFlatpickr() {
        var el = document.getElementById('salesDataPeriodDate');
        if (!el || typeof flatpickr === 'undefined' || el._flatpickr) return;
        flatpickr(el, FLATPICKR_DDMMYYYY);
    }

    function bindEvents() {
        $(document).on('change.salesData', 'input[name="salesDataPeriodType"]', onPeriodTypeChanged);
        $(document).on('change.salesData', '#salesDataPeriodDate', onPeriodDateChanged);
        $(document).on('click.salesData', '#salesDataPeriodPrev', function () { goToPreviousPeriod(); });
        $(document).on('click.salesData', '#salesDataPeriodNext', function () { goToNextPeriod(); });
        $(document).on('click.salesData', '.js-sales-data-tab', function (e) {
            e.preventDefault();
            var key = $(this).attr('data-dataset-key');
            if (!key || key === state.activeDatasetKey) return;
            switchTab(key, false);
        });
        $(document).on('input.salesData change.salesData', '#salesDataProductionBody .js-sales-data-input', function () {
            if (!canEdit()) return;
            var $tr = $(this).closest('tr');
            var date = $tr.attr('data-date');
            if (!date) return;
            state.dirtyDates[date] = true;
            setSaveStatus('Unsaved changes\u2026');
            recomputeTotalsFromDom();
            scheduleAutoSave();
        });
        $(document).on('click.salesData', '#salesDataReseedBtn', function () { handleReseed(); });
        $(document).on('click.salesData', '#salesDataDriftBtn', function () { openDriftModal(); });

        // Kernel sales ledger.
        $(document).on('input.salesData change.salesData', '#salesDataKernelSalesBody .js-sales-data-input', function () {
            if (!canEdit()) return;
            var $tr = $(this).closest('tr');
            if (!$tr.find('[data-field]').length) return;
            var def = ksDef();
            var field = $(this).attr('data-field');

            // Money is derived from quantity x price ONLY when one of those two changes, and never on
            // load — 3 of the 277 backfilled rows do not satisfy excl = qty x price, and those stored
            // figures are authoritative. Pete can still overtype any of the three afterwards.
            // Picking a contact keeps the free-text name in step with it, so the two never disagree.
            // Clearing the dropdown deliberately leaves the name alone — that is the shape 63 of the
            // backfilled rows already have (a name Pete typed, no contact it resolved to).
            if (field === 'customer_id') {
                var picked = $(this).val();
                if (picked) {
                    var match = null;
                    state.ksLookups.customer_id.forEach(function (o) {
                        if (String(o.value) === String(picked)) match = o;
                    });
                    if (match) $tr.find('[data-field="customer_name"]').val(match.label);
                }
            }

            if (def && def.derivedMoney && (field === 'quantity_kg' || field === 'price_per_kg')) {
                var current = SalesDataRowGrid.collectRowPayload(def, $tr);
                var money = SalesDataRowGrid.recomputeMoney(current);
                if (money) {
                    Object.keys(money).forEach(function (k) {
                        $tr.find('[data-field="' + k + '"]').val(String(money[k]));
                    });
                }
            }

            state.ksDirty[ksRowKey($tr)] = true;
            setSaveStatus('Unsaved changes…');
            ksRecomputeTotalsFromDom();
            scheduleAutoSave();
        });
        $(document).on('click.salesData', '#salesDataKsAdd', function () { ksAddLine(); });
        $(document).on('click.salesData', '#salesDataKsApply', function () { ksApplyRange(); });
        $(document).on('click.salesData', '.js-sales-data-ks-delete', function () {
            ksDeleteLine($(this).closest('tr'));
        });
    }

    return {
        init: function () {
            _salesDataGrid.destroy();
            state.periodType = 'weekly';
            state.start = null;
            state.end = null;
            state.label = '';
            state.datasets = [];
            state.activeDatasetKey = null;
            state.productionRows = [];
            state.dirtyDates = {};
            state.invalidDates = {};
            state.driftRows = [];
            state.ksFrom = null;
            state.ksTo = null;
            state.ksRows = [];
            state.ksDirty = {};
            state.ksNewSeq = 0;
            state.ksLookups = { customer_id: [], style_code: [] };
            state.ksLookupsLoaded = false;
            $('#salesDataPeriodWeekly').prop('checked', true);
            setSaveStatus('\u00a0');
            bindEvents();
            initFlatpickr();
            loadDatasetsList().then(function () {
                renderTabStrip();
                ensureActiveDataset();
                return resolvePeriodFromCurrent();
            }).then(function () {
                return switchTab(state.activeDatasetKey, false);
            }).catch(handlePeriodResolutionFailure);
        },

        destroy: function () {
            if (state.saveTimer) {
                clearTimeout(state.saveTimer);
                state.saveTimer = null;
            }
            // The idle-reload retry re-arms itself, so it must be cleared here or it keeps firing
            // against a DOM that belongs to whichever module loaded next.
            if (state.reloadTimer) {
                clearTimeout(state.reloadTimer);
                state.reloadTimer = null;
            }
            $(document).off('.salesData');
        },

        // Synchronously collects any dirty row from the DOM and sends it, so a caller (tab switch,
        // period change, router's promptOnFormExit/routeTo) can await it before navigating away.
        flushAutoSave: flushAutoSave,

        hasPendingEdits: hasPendingEdits
    };
}();

function initializeSalesDataGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _salesDataGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}
