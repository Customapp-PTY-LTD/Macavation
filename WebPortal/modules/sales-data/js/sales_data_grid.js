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
        driftRows: []
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

    function flushAutoSave() {
        if (state.saveTimer) {
            clearTimeout(state.saveTimer);
            state.saveTimer = null;
        }
        if (state.activeDatasetKey !== 'production_daily') return Promise.resolve();
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
        return Object.keys(state.dirtyDates).length > 0;
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
        $content.html(macEmptyState('fa-table', datasetLabel(key) + ' is not built yet',
            'This dataset will be added in a later release.'));
        return Promise.resolve();
    }

    function switchTab(key, forceReload) {
        if (!key) return Promise.resolve();
        return flushAutoSave().then(function () {
            state.activeDatasetKey = key;
            setTabStripActive(key);
            return renderTabContent(key, forceReload);
        });
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
