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

        // Per-ledger-dataset: { from, to, rows, dirty, newSeq }. Keyed by dataset_key so switching
        // tabs and back keeps each ledger's own date range and unsaved edits.
        ledgers: {},
        // Reference lists shared across ledgers, fetched at most once per session.
        lookupSources: { contacts: [], kernel_styles: [] },
        lookupsLoaded: {}
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
        if (ledgerDef()) return flushLedgerAutoSave();
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
        if (Object.keys(state.dirtyDates).length > 0) return true;
        return Object.keys(state.ledgers).some(function (k) {
            return Object.keys(state.ledgers[k].dirty).length > 0;
        });
    }

    // ------------------------------------------------------------------
    // Ledger pane — shared by every id-keyed dataset (kernel sales, oil sales, and the tabs still
    // to come). Nothing here names a dataset: the column registry supplies the columns, which
    // dataFunctions wrappers to call, which reference lists feed its dropdowns, and whether its
    // money columns are derived. Adding a ledger tab is a registry entry plus three wrappers.
    //
    // Only one ledger is on screen at a time — switchTab replaces #salesDataTabContent outright —
    // so the pane uses fixed element ids rather than per-dataset ones. Each dataset keeps its own
    // date range and dirty set in state.ledgers, so switching tabs and back does not lose them.
    // ------------------------------------------------------------------

    function ledgerDef(key) {
        var def = SalesDataColumnDefs.get(key || state.activeDatasetKey);
        return (def && def.idColumn) ? def : null;
    }

    function ledgerState(key) {
        if (!state.ledgers[key]) {
            state.ledgers[key] = { from: null, to: null, rows: [], dirty: {}, newSeq: 0 };
        }
        return state.ledgers[key];
    }

    function ledgerColCount(def) {
        // Columns, plus the leading flag cell, plus the trailing delete cell.
        return 2 + ((def && Array.isArray(def.columns)) ? def.columns.length : 0);
    }

    // Every <tr> needs a stable handle for the dirty set. Saved rows use their uuid; a row the user
    // just added has none until it comes back from the server, so it gets a local key that lives
    // only on the DOM node.
    function ledgerRowKey($tr, ls) {
        var id = $tr.attr('data-row-id');
        if (id) return id;
        var local = $tr.attr('data-local-key');
        if (!local) {
            ls.newSeq += 1;
            local = 'new-' + ls.newSeq;
            $tr.attr('data-local-key', local);
        }
        return local;
    }

    function ledgerFindRow(key) {
        var $byId = $('#salesDataLedgerBody tr[data-row-id="' + key + '"]');
        if ($byId.length) return $byId;
        return $('#salesDataLedgerBody tr[data-local-key="' + key + '"]');
    }

    // Reference lists are shared across datasets and fetched at most once per session.
    function loadLookupSources(def) {
        var wanted = [];
        Object.keys((def && def.lookups) || {}).forEach(function (colKey) {
            var src = def.lookups[colKey];
            if (wanted.indexOf(src) === -1 && !state.lookupsLoaded[src]) wanted.push(src);
        });
        if (!wanted.length) return Promise.resolve();

        return Promise.all(wanted.map(function (src) {
            if (src === 'contacts') {
                return dataFunctions.getContacts().then(function (rows) {
                    state.lookupSources.contacts = (Array.isArray(rows) ? rows : []).map(function (c) {
                        return {
                            value: c && (c.id || c.contact_id),
                            label: (c && (c.company_name || c.name || c.contact_name || c.email)) || '(unnamed)'
                        };
                    }).filter(function (o) { return o.value; });
                    state.lookupsLoaded.contacts = true;
                }).catch(function (err) {
                    console.warn('[sales-data] getContacts failed', err);
                });
            }
            if (src === 'kernel_styles') {
                return dataFunctions.getKernelStyles().then(function (rows) {
                    state.lookupSources.kernel_styles = (Array.isArray(rows) ? rows : []).map(function (s) {
                        return { value: s && s.style_code, label: (s && (s.label || s.style_code)) || '' };
                    }).filter(function (o) { return o.value; });
                    state.lookupsLoaded.kernel_styles = true;
                }).catch(function (err) {
                    console.warn('[sales-data] getKernelStyles failed', err);
                });
            }
            console.warn('[sales-data] unknown lookup source', src);
            return Promise.resolve();
        }));
    }

    // Maps the dataset's lookup columns onto the loaded reference lists, in the shape buildRow wants.
    function lookupsFor(def) {
        var out = {};
        Object.keys((def && def.lookups) || {}).forEach(function (colKey) {
            out[colKey] = state.lookupSources[def.lookups[colKey]] || [];
        });
        return out;
    }

    // Resolves a dataFunctions wrapper named by the registry, so a typo or an un-deployed wrapper
    // surfaces as an empty state rather than a TypeError halfway through rendering.
    function ledgerRpc(def, which) {
        var name = def && def.rpc && def.rpc[which];
        return (name && typeof dataFunctions[name] === 'function') ? name : null;
    }

    function buildLedgerShell($content, def) {
        var ls = ledgerState(def.datasetKey);
        $content.empty();

        var $bar = $('<div>', { 'class': 'row g-2 align-items-end mb-3' });
        var $fromCol = $('<div>', { 'class': 'col-auto' });
        $fromCol.append($('<label>', { 'class': 'form-label', 'for': 'salesDataLedgerFrom' }).text('From'));
        $fromCol.append($('<input>', { type: 'text', id: 'salesDataLedgerFrom', 'class': 'form-control form-control-sm flatpickr-date', autocomplete: 'off' }));
        var $toCol = $('<div>', { 'class': 'col-auto' });
        $toCol.append($('<label>', { 'class': 'form-label', 'for': 'salesDataLedgerTo' }).text('To'));
        $toCol.append($('<input>', { type: 'text', id: 'salesDataLedgerTo', 'class': 'form-control form-control-sm flatpickr-date', autocomplete: 'off' }));
        var $applyCol = $('<div>', { 'class': 'col-auto' });
        $applyCol.append($('<label>', { 'class': 'form-label d-block' }).html('&nbsp;'));
        $applyCol.append($('<button>', { type: 'button', 'class': 'btn btn-sm btn-outline-secondary', id: 'salesDataLedgerApply' }).text('Apply'));
        var $sumCol = $('<div>', { 'class': 'col' });
        $sumCol.append($('<div>', { 'class': 'text-muted small', id: 'salesDataLedgerSummary' }).html('&nbsp;'));
        var $addCol = $('<div>', { 'class': 'col-auto' });
        $addCol.append($('<label>', { 'class': 'form-label d-block' }).html('&nbsp;'));
        $addCol.append($('<button>', { type: 'button', 'class': 'btn btn-sm btn-primary', id: 'salesDataLedgerAdd' })
            .attr('data-action-perm', 'reports.data.edit')
            .prop('disabled', !canEdit())
            .text('Add line'));
        $bar.append($fromCol).append($toCol).append($applyCol).append($sumCol).append($addCol);
        $content.append($bar);

        var $wrap = $('<div>', { 'class': 'table-responsive' });
        var $table = $('<table>', { 'class': 'table table-sm align-middle mb-0' });
        var $trh = $('<tr>');
        $trh.append($('<th>').text(''));
        def.columns.forEach(function (col) { $trh.append($('<th>').text(col.label)); });
        $trh.append($('<th>').text(''));
        $table.append($('<thead>').append($trh));
        $table.append($('<tbody>', { id: 'salesDataLedgerBody' }));
        $table.append($('<tfoot>', { id: 'salesDataLedgerTotals' }));
        $wrap.append($table);
        $content.append($wrap);

        // Seed the range to the financial year, not the page period. A ledger spanning years has
        // roughly no rows in any given week, so seeding from a weekly period opens the tab on an
        // empty grid — which reads as "the tab is broken" rather than "no sales that week". The FY
        // is the unit Pete reconciles in; he can narrow it from here.
        if (!ls.from || !ls.to) {
            var fy = SalesDataRowGrid.fyRangeFor(state.start);
            ls.from = fy ? fy.from : state.start;
            ls.to = fy ? fy.to : state.end;
        }
        $('#salesDataLedgerFrom').val(isoToPicker(ls.from));
        $('#salesDataLedgerTo').val(isoToPicker(ls.to));
        [document.getElementById('salesDataLedgerFrom'), document.getElementById('salesDataLedgerTo')].forEach(function (el) {
            if (el && typeof flatpickr !== 'undefined' && !el._flatpickr) flatpickr(el, FLATPICKR_DDMMYYYY);
        });
    }

    // The delete control lives in a trailing cell the column registry does not describe, so it is
    // appended per row here rather than inside the generic engine.
    function ledgerDecorateRow($tr) {
        var $cell = $('<td>', { 'class': 'text-end' });
        if (canEdit()) {
            $cell.append($('<button>', {
                type: 'button',
                'class': 'btn btn-sm btn-outline-danger js-sales-data-ledger-delete',
                title: 'Delete line'
            }).append($('<i>', { 'class': 'fas fa-trash' })));
        }
        $tr.append($cell);
        return $tr;
    }

    function ledgerRenderTotals(def, rows) {
        var $foot = $('#salesDataLedgerTotals');
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

        var summary = rows.length + ' line' + (rows.length === 1 ? '' : 's');
        // Which totals headline the summary is per dataset — the sales ledgers lead with VAT
        // exclusive/inclusive, the export register with kilograms, USD and rands.
        (def.summaryColumns || []).forEach(function (s) {
            summary += ' · ' + SalesDataRowGrid.formatKg(totals[s.key]) + ' ' + s.label;
        });
        $('#salesDataLedgerSummary').text(summary);
    }

    // Recomputes the totals from what is currently typed, so the figures Pete reconciles against
    // stay live rather than only refreshing after a save.
    function ledgerRecomputeTotalsFromDom() {
        var def = ledgerDef();
        if (!def) return;
        var rows = [];
        $('#salesDataLedgerBody tr').each(function () {
            if ($(this).find('[data-field]').length) rows.push(SalesDataRowGrid.collectRowPayload(def, this));
        });
        ledgerRenderTotals(def, rows);
    }

    function loadLedgerData(def, forceRefresh) {
        var ls = ledgerState(def.datasetKey);
        var $tbody = $('#salesDataLedgerBody');
        var getter = ledgerRpc(def, 'get');
        if (!getter) {
            $tbody.html('<tr><td colspan="' + ledgerColCount(def) + '">' +
                macEmptyState('fa-database', def.label || 'This dataset', 'It is not available in this build.') +
                '</td></tr>');
            return Promise.resolve();
        }
        $tbody.html(macLoadingRow(ledgerColCount(def), 'Loading…'));
        return loadLookupSources(def).then(function () {
            return dataFunctions[getter](ls.from, ls.to, 500, 0, null, !!forceRefresh);
        }).then(function (result) {
            var rows = Array.isArray(result) ? result : (result ? [result] : []);
            ls.rows = rows;
            ls.dirty = {};
            SalesDataRowGrid.renderRows($tbody, def, rows, canEdit(), lookupsFor(def));
            $tbody.find('tr').each(function () {
                if ($(this).find('[data-field]').length) ledgerDecorateRow($(this));
            });
            ledgerRenderTotals(def, rows);
            setSaveStatus(' ');
        }).catch(function (err) {
            console.warn('[sales-data] ' + getter + ' failed', err);
            ls.rows = [];
            $tbody.html('<tr><td colspan="' + ledgerColCount(def) + '">' +
                macEmptyState('fa-database', (def.label || 'This dataset') + ' is not available yet',
                    'The data-page migrations have not been applied to this database.') +
                '</td></tr>');
        });
    }

    function flushLedgerAutoSave() {
        var def = ledgerDef();
        if (!def) return Promise.resolve();
        var ls = ledgerState(def.datasetKey);
        var keys = Object.keys(ls.dirty);
        if (!keys.length) return Promise.resolve();
        var saver = ledgerRpc(def, 'upsert');
        if (!saver) return Promise.resolve();

        var payload = [];
        var savedKeys = [];
        var pendingInvalid = 0;
        keys.forEach(function (key) {
            var $tr = ledgerFindRow(key);
            if (!$tr.length) return;
            var row = SalesDataRowGrid.collectRowPayload(def, $tr);
            // For the sales ledgers an insert with no date is silently dropped by the RPC's WHERE
            // clause, so the row is held back and left dirty rather than reporting a save that
            // wrote nothing. NIS intake is the exception: received_date is nullable there, its
            // insert has no such guard, and get_data_nis_intake deliberately returns dateless rows
            // regardless of the filter so an incomplete one cannot hide from whoever must fix it.
            // Blocking the save would make those three rows uneditable.
            if (def.requiresDate !== false && !row[def.dateColumn]) {
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
        return dataFunctions[saver](payload)
            .then(function (result) {
                if (isQueuedOffline(result)) {
                    savedKeys.forEach(function (k) { delete ls.dirty[k]; });
                    setSaveStatus('Offline — changes queued and will save when the connection returns.');
                    return;
                }
                var row = firstRpcRow(result);
                if (row && Number(row.success) === 1) {
                    savedKeys.forEach(function (k) { delete ls.dirty[k]; });
                    setSaveStatus(pendingInvalid
                        ? 'Saved. ' + pendingInvalid + ' line(s) still need a date.'
                        : 'Saved.', !!pendingInvalid);
                    // A reload is the only way a new row learns its server-assigned id, but it still
                    // waits until the caret is out of the grid.
                    ledgerReloadWhenIdle(def);
                } else {
                    setSaveStatus((row && row.error) ? row.error : 'Could not save the changes.', true);
                }
            })
            .catch(function (err) {
                console.warn('[sales-data] ' + saver + ' failed', err);
                setSaveStatus('Could not save — this feature may not be available on this database yet.', true);
            });
    }

    function ledgerGridHasFocus() {
        var el = document.activeElement;
        return !!(el && $(el).closest('#salesDataLedgerBody').length);
    }

    function ledgerReloadWhenIdle(def) {
        if (state.reloadTimer) clearTimeout(state.reloadTimer);
        state.reloadTimer = setTimeout(function () {
            state.reloadTimer = null;
            var ls = ledgerState(def.datasetKey);
            if (Object.keys(ls.dirty).length || ledgerGridHasFocus()) {
                ledgerReloadWhenIdle(def);
                return;
            }
            loadLedgerData(def, true);
        }, 1500);
    }

    function ledgerAddLine() {
        if (!canEdit()) return;
        var def = ledgerDef();
        if (!def) return;
        var ls = ledgerState(def.datasetKey);
        var seed = {};
        seed[def.dateColumn] = ls.from || state.start || '';
        var $tr = SalesDataRowGrid.addBlankRow($('#salesDataLedgerBody'), def, true, lookupsFor(def), seed);
        ledgerDecorateRow($tr);
        ls.dirty[ledgerRowKey($tr, ls)] = true;
        setSaveStatus('Unsaved changes…');
        $tr.find('[data-field="' + def.dateColumn + '"]').trigger('focus');
    }

    function ledgerDeleteLine($tr) {
        if (!canEdit()) return;
        var def = ledgerDef();
        if (!def) return;
        var ls = ledgerState(def.datasetKey);
        var id = $tr.attr('data-row-id');
        if (!id) {
            // Never saved — nothing on the server to remove.
            delete ls.dirty[ledgerRowKey($tr, ls)];
            $tr.remove();
            ledgerRecomputeTotalsFromDom();
            return;
        }
        var remover = ledgerRpc(def, 'del');
        if (!remover) return;
        Swal.fire({
            icon: 'warning',
            title: 'Delete this line?',
            text: 'The line is removed permanently.',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#d33',
            cancelButtonColor: '#6c757d'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            return dataFunctions[remover](id).then(function (res) {
                if (isQueuedOffline(res)) {
                    setSaveStatus('Offline — the delete is queued.');
                    return;
                }
                var row = firstRpcRow(res);
                if (row && Number(row.success) === 1) {
                    delete ls.dirty[id];
                    loadLedgerData(def, true);
                } else {
                    Swal.fire({ icon: 'error', title: 'Could not delete', text: (row && row.error) || 'The line was not removed.' });
                }
            }).catch(function (err) {
                console.warn('[sales-data] ' + remover + ' failed', err);
                Swal.fire({ icon: 'error', title: 'Could not delete', text: 'This feature is not available yet on this database.' });
            });
        });
    }

    function ledgerApplyRange() {
        var def = ledgerDef();
        if (!def) return;
        var ls = ledgerState(def.datasetKey);
        var from = pickerDateToIso($('#salesDataLedgerFrom').val());
        var to = pickerDateToIso($('#salesDataLedgerTo').val());
        if (!from || !to) {
            setSaveStatus('Enter both dates as dd/mm/yyyy.', true);
            return;
        }
        // Plain string comparison is correct for yyyy-mm-dd and keeps this file free of Date
        // arithmetic, as its header comment requires.
        if (from > to) {
            setSaveStatus('From must not be after To.', true);
            return;
        }
        flushAutoSave().then(function () {
            ls.from = from;
            ls.to = to;
            return loadLedgerData(def, true);
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

    // Re-seed refreshes the *_system mirror columns only, never the effective figures — that single
    // rule is the whole mechanism behind "keep Pete's value, flag the drift". Which RPC to call, and
    // which date range to send, both come from the registry: a period-scoped dataset re-seeds the
    // selected period, a ledger re-seeds its own From/To range.
    function handleReseed() {
        var def = SalesDataColumnDefs.get(state.activeDatasetKey);
        var fn = def && def.rpc && def.rpc.reseed;
        if (!canEdit() || !fn || typeof dataFunctions[fn] !== 'function') return;

        var ledger = SalesDataRowGrid.isLedger(def);
        var ls = ledger ? ledgerState(def.datasetKey) : null;
        var from = ledger ? ls.from : state.start;
        var to = ledger ? ls.to : state.end;
        if (!from || !to) return;

        Swal.fire({
            icon: 'question',
            title: 'Refresh from factory?',
            text: (def.reseedPrompt || 'This re-pulls the factory figures for this range.') +
                ' It will not change any figure you have already entered.',
            showCancelButton: true,
            confirmButtonText: 'Refresh',
            cancelButtonText: 'Cancel',
            confirmButtonColor: '#3085d6',
            cancelButtonColor: '#6c757d'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            return flushAutoSave().then(function () {
                return dataFunctions[fn](from, to);
            }).then(function (reseedResult) {
                if (isQueuedOffline(reseedResult)) {
                    Swal.fire({ icon: 'info', title: 'Queued', text: 'You are offline. The refresh will run when the connection returns.' });
                    return;
                }
                var row = firstRpcRow(reseedResult);
                if (row && Number(row.success) === 1) {
                    if (ledger) loadLedgerData(def, true);
                    else loadProductionData(true);
                } else {
                    var msg = (row && row.error) ? row.error : 'Could not refresh from the factory.';
                    Swal.fire({ icon: 'error', title: 'Could not refresh', text: msg });
                }
            }).catch(function (err) {
                console.warn('[sales-data] ' + fn + ' failed', err);
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
        var lDef = ledgerDef(key);
        if (lDef) {
            buildLedgerShell($content, lDef);
            return loadLedgerData(lDef, !!forceReload);
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

    // The two header controls are independent capabilities, not one. NIS intake can be re-seeded
    // (reseed_data_nis_intake) but has no drift RPC at all — get_data_nis_intake returns no _live
    // columns to compare against — so it shows "Refresh from factory" and hides Drift. A dataset
    // with neither, like the sales ledgers, hides both rather than leaving them visible and inert.
    function syncHeaderControls(key) {
        var def = SalesDataColumnDefs.get(key);
        var canReseed = !!(def && def.rpc && def.rpc.reseed &&
            typeof dataFunctions[def.rpc.reseed] === 'function');
        $('#salesDataReseedBtn').toggleClass('d-none', !canReseed);
        $('#salesDataDriftBtn').toggleClass('d-none', !(def && def.supportsDrift));
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
        // SalesDataRowGrid.fyRangeFor, not a bare fyRangeFor — it is defined inside
        // sales-data-row-grid.js's IIFE and reaches this file only through that namespace, exactly
        // as line 478 already calls it. Unqualified, it threw ReferenceError on EVERY page load:
        // applyPeriod runs during boot, so the rejection landed in handlePeriodResolutionFailure,
        // which blanked the tab and re-disabled "Refresh from factory" — the page never worked.
        var fyRange = SalesDataRowGrid.fyRangeFor(start);
        Object.keys(state.ledgers).forEach(function (k) {
            state.ledgers[k].from = fyRange ? fyRange.from : start;
            state.ledgers[k].to = fyRange ? fyRange.to : end;
        });
    }

    // The "answered, but with nothing usable" throws in both resolvers below are shown to the user
    // verbatim by failureHint, so they say what happened in plain words AND name the RPC. This case
    // is real, not defensive: the resolver returns an empty set with HTTP 200 — not an error — for
    // any period type it does not recognise, which is indistinguishable from a missing migration
    // unless the message spells it out.
    //
    // forceRefresh matters on a retry: callFunction caches any non-error response for its TTL, and
    // an empty result IS a non-error response — so a period that came back empty would be served
    // from the same cached emptiness for the next minute and the retry would "fail" without ever
    // reaching the server.
    function resolvePeriodFromCurrent(forceRefresh) {
        return dataFunctions.getReportCurrentPeriod(state.periodType, null, !!forceRefresh).then(function (result) {
            var row = firstRpcRow(result);
            if (!row || !row.period_start || !row.period_end) {
                throw new Error('The server answered but sent back no ' + state.periodType
                    + ' reporting period (get_report_current_period).');
            }
            applyPeriod(String(row.period_start).slice(0, 10), String(row.period_end).slice(0, 10), row.period_label || '');
        });
    }

    function resolvePeriodFromDate(iso) {
        return dataFunctions.getReportPeriodStart(state.periodType, iso).then(function (startResult) {
            var start = SalesDataRowGrid.scalarIsoDate(startResult);
            if (!start) {
                throw new Error('The server could not work out where the ' + state.periodType
                    + ' period containing ' + iso + ' starts (report_normalise_period_start).');
            }
            return dataFunctions.getReportPeriodEnd(state.periodType, start).then(function (endResult) {
                var end = SalesDataRowGrid.scalarIsoDate(endResult);
                if (!end) {
                    throw new Error('The server could not work out where the ' + state.periodType
                        + ' period starting ' + start + ' ends (report_period_end).');
                }
                applyPeriod(start, end, periodLabelFor(state.periodType, start, end));
            });
        });
    }

    // PostgREST's PGRST202 ("could not find the function ... in the schema cache") is the ONLY
    // error that really means this database has not had the migrations applied. Everything else —
    // a dropped request, a 5xx, a period type the resolver does not recognise — is a runtime
    // failure. Reporting those as a deployment problem is not a cosmetic wording issue: it sent a
    // transient failure on the dev site down a "promote the migrations to prod" investigation
    // while the migrations were already present on the database being used.
    function isMissingRpcError(err) {
        var msg = err && err.message ? String(err.message) : '';
        return /PGRST202|schema cache|Could not find the function/i.test(msg);
    }

    // What actually broke, in a form Pete can read out over the phone. macEmptyState escapes its
    // arguments, so an error string is safe to pass straight through.
    function failureHint(err) {
        var msg = err && err.message ? String(err.message).trim() : '';
        return msg || 'The server did not say why. Try again, and check your connection.';
    }

    // A retry affordance belongs on a transient failure specifically: an unapplied migration will
    // not fix itself, but a schema-cache miss or a dropped request usually clears on the next try.
    function retryButtonHtml() {
        return '<div class="text-center pb-3">'
            + '<button type="button" class="btn btn-sm btn-outline-secondary js-sales-data-retry">'
            + '<i class="fas fa-sync-alt me-1"></i>Try again</button></div>';
    }

    // Period resolution failed. The two genuinely different causes get two genuinely different
    // messages, and the console line names which branch was taken so the next person does not have
    // to reverse-engineer it from the DOM.
    function handlePeriodResolutionFailure(err) {
        state.start = null;
        state.end = null;
        $('#salesDataPeriodLabel').text('Could not resolve the reporting period.');
        $('#salesDataReseedBtn').prop('disabled', true);
        if (isMissingRpcError(err)) {
            console.warn('[sales-data] period resolution failed — RPC missing on this database', err);
            $('#salesDataTabContent').html(macEmptyState('fa-calendar-times', 'Reporting period is not available yet',
                'The report-builder migrations have not been applied to this database.'));
            return;
        }
        console.warn('[sales-data] period resolution failed — runtime error, NOT a missing migration', err);
        $('#salesDataTabContent').html(
            macEmptyState('fa-exclamation-triangle', 'Could not load the reporting period', failureHint(err))
            + retryButtonHtml());
    }

    // Rendering the active tab is a separate failure from resolving the period: the period has
    // already been applied by the time this runs, so blaming it — or the migrations — is always
    // wrong. Only the tab body is replaced, leaving the period controls live so Pete can change
    // period or switch tabs instead of being stuck on a dead page.
    function handleTabRenderFailure(err) {
        console.warn('[sales-data] tab render failed', err);
        $('#salesDataTabContent').html(
            macEmptyState('fa-exclamation-triangle',
                'Could not open ' + datasetLabel(state.activeDatasetKey), failureHint(err))
            + retryButtonHtml());
    }

    // Period-change entry points share one shape: resolve the period, then render the tab. The two
    // steps are caught SEPARATELY — .then(onFulfilled, onRejected) means the rejection handler sees
    // only what happened before it, and switchTab's own failure is caught by its own handler.
    // flushAutoSave never rejects (both flush paths catch and report through setSaveStatus), so a
    // save problem cannot surface here wearing a period error's clothes.
    function resolveThenRender(resolveStep) {
        return flushAutoSave()
            .then(resolveStep)
            .then(function () {
                return switchTab(state.activeDatasetKey, true).catch(handleTabRenderFailure);
            }, handlePeriodResolutionFailure);
    }

    function goToPreviousPeriod() {
        if (!state.start) return;
        var anchor = SalesDataRowGrid.shiftIsoDateByOneDay(state.start, -1);
        if (!anchor) return;
        resolveThenRender(function () { return resolvePeriodFromDate(anchor); });
    }

    function goToNextPeriod() {
        if (!state.end) return;
        var anchor = SalesDataRowGrid.shiftIsoDateByOneDay(state.end, 1);
        if (!anchor) return;
        resolveThenRender(function () { return resolvePeriodFromDate(anchor); });
    }

    function onPeriodTypeChanged() {
        state.periodType = $('input[name="salesDataPeriodType"]:checked').val() || 'weekly';
        resolveThenRender(function () { return resolvePeriodFromCurrent(); });
    }

    function onPeriodDateChanged() {
        var el = document.getElementById('salesDataPeriodDate');
        var iso = pickerDateToIso(el ? el.value : '');
        if (!iso) return;
        resolveThenRender(function () { return resolvePeriodFromDate(iso); });
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

        // Ledger tabs (kernel sales, oil sales, and any later id-keyed dataset).
        $(document).on('input.salesData change.salesData', '#salesDataLedgerBody .js-sales-data-input', function () {
            if (!canEdit()) return;
            var $tr = $(this).closest('tr');
            if (!$tr.find('[data-field]').length) return;
            var def = ledgerDef();
            if (!def) return;
            var ls = ledgerState(def.datasetKey);
            var field = $(this).attr('data-field');

            // Picking a contact keeps the paired free-text name in step with it, so the two never
            // disagree. The pairing is the column's own `unmatchedFrom`, so this works for the sales
            // ledgers' customer_id/customer_name and NIS intake's supplier_id/supplier_name alike.
            // Clearing the dropdown deliberately leaves the name alone — that is the shape most of
            // the backfilled rows already have (a name Pete typed, no contact it resolved to).
            var col = null;
            def.columns.forEach(function (c) { if (c.key === field) col = c; });
            if (col && col.type === 'lookup' && col.unmatchedFrom) {
                var picked = $(this).val();
                if (picked) {
                    var match = null;
                    (state.lookupSources[def.lookups[field]] || []).forEach(function (o) {
                        if (String(o.value) === String(picked)) match = o;
                    });
                    if (match) $tr.find('[data-field="' + col.unmatchedFrom + '"]').val(match.label);
                }
            }

            // Money is derived from quantity x price ONLY when one of those two changes, and never
            // on load — a handful of backfilled rows do not satisfy excl = qty x price, and those
            // stored figures are authoritative. Pete can still overtype any of the three afterwards.
            if (def.derivedMoney && (field === 'quantity_kg' || field === 'price_per_kg')) {
                var money = SalesDataRowGrid.recomputeMoney(SalesDataRowGrid.collectRowPayload(def, $tr));
                if (money) {
                    Object.keys(money).forEach(function (k) {
                        $tr.find('[data-field="' + k + '"]').val(String(money[k]));
                    });
                }
            }

            ls.dirty[ledgerRowKey($tr, ls)] = true;
            setSaveStatus('Unsaved changes…');
            ledgerRecomputeTotalsFromDom();
            scheduleAutoSave();
        });
        $(document).on('click.salesData', '#salesDataLedgerAdd', function () { ledgerAddLine(); });
        $(document).on('click.salesData', '#salesDataLedgerApply', function () { ledgerApplyRange(); });
        $(document).on('click.salesData', '.js-sales-data-ledger-delete', function () {
            ledgerDeleteLine($(this).closest('tr'));
        });
        // Retry re-runs the boot chain rather than only the step that failed: whichever step it was,
        // the period may still be unresolved. It resolves from CURRENT rather than from the date in
        // the picker because a failed boot never populated that picker.
        $(document).on('click.salesData', '.js-sales-data-retry', function () {
            $('#salesDataTabContent').html(macEmptyState('fa-spinner fa-spin', 'Trying again…', ''));
            resolveThenRender(function () { return resolvePeriodFromCurrent(true); });
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
            state.ledgers = {};
            state.lookupSources = { contacts: [], kernel_styles: [] };
            state.lookupsLoaded = {};
            $('#salesDataPeriodWeekly').prop('checked', true);
            setSaveStatus('\u00a0');
            bindEvents();
            initFlatpickr();
            // Boot in two separately-caught steps. The old single .catch() covered the tab render
            // as well, so ANY failure on this page — a dropped request, a bad row, a slow network —
            // was reported to the user as "the report-builder migrations have not been applied",
            // which is a claim about the deployment that was usually false.
            loadDatasetsList().then(function () {
                renderTabStrip();
                ensureActiveDataset();
                return resolvePeriodFromCurrent();
            }).then(function () {
                return switchTab(state.activeDatasetKey, false).catch(handleTabRenderFailure);
            }, handlePeriodResolutionFailure);
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
