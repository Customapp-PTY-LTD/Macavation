/**
 * Oil & protein production forecast: demand lines vs on-hand stock (kg), same pattern as kernel production forecast.
 */
var _oilProductionForecastGrid = function () {
    'use strict';

    var OIL_STREAM_CODES = ['food_grade', 'cosmetic', 'protein'];
    var OIL_STREAM_LABELS = {
        food_grade: 'Food grade oil',
        cosmetic: 'Cosmetic oil',
        protein: 'Protein powder'
    };

    function parseNum(val) {
        if (val == null || val === '') return 0;
        var n = typeof val === 'number' ? val : parseFloat(val);
        return isNaN(n) ? 0 : n;
    }

    /**
     * Bucket stock lots into forecast streams (matches grade / product text from Stock grid).
     */
    function streamCodeFromLot(lot) {
        var pd = String(lot && lot.product_description ? lot.product_description : '').toLowerCase();
        var gr = String(lot && lot.grade ? lot.grade : '').toLowerCase();
        if (pd.indexOf('protein') >= 0 || gr.indexOf('protein') >= 0) return 'protein';
        if (gr.indexOf('cosmetic') >= 0) return 'cosmetic';
        if (gr.indexOf('food grade') >= 0 || gr.indexOf('food_grade') >= 0) return 'food_grade';
        if ((lot.stock_category || '').toLowerCase() === 'finished_good') return 'food_grade';
        if ((lot.stock_category || '').toLowerCase() === 'raw_material') return 'food_grade';
        return 'food_grade';
    }

    function kgOnHandFromLot(lot) {
        var kg = parseNum(lot.kilograms);
        if (kg > 0) return kg;
        return parseNum(lot.volume);
    }

    function aggregateSohByStream(lots) {
        var totals = { food_grade: 0, cosmetic: 0, protein: 0 };
        if (!Array.isArray(lots)) return totals;
        lots.forEach(function (l) {
            var key = streamCodeFromLot(l);
            if (totals[key] == null) return;
            totals[key] += kgOnHandFromLot(l);
        });
        return totals;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return _common.escapeHtml(s);
    }

    function streamLabel(code) {
        return OIL_STREAM_LABELS[code] || code;
    }

    function statusBadgeClass(status) {
        switch (status) {
            case 'fulfilled': return 'bg-success';
            case 'cancelled': return 'bg-secondary';
            case 'in_progress': return 'bg-warning text-dark';
            default: return 'bg-primary';
        }
    }

    function isOpenStatus(status) {
        return status === 'open' || status === 'in_progress';
    }

    return {
        forecasts: [],
        sohByStream: {},
        editModal: null,

        init: function () {
            var scope = _oilProductionForecastGrid;
            if (typeof $ === 'undefined') {
                console.warn('[Oil Forecast] jQuery not loaded');
                return;
            }
            scope.bindEvents();
            if (typeof bootstrap !== 'undefined' && document.getElementById('oilForecastEditModal')) {
                scope.editModal = new bootstrap.Modal(document.getElementById('oilForecastEditModal'));
            }
            scope.refreshAll();
        },

        bindEvents: function () {
            var scope = _oilProductionForecastGrid;
            $('#oilForecastRefreshBtn').off('click').on('click', function () {
                scope.refreshAll(true);
            });
            $('#oilForecastAddBtn').off('click').on('click', function () {
                scope.openEditModal(null);
            });
            $('#oilForecastSaveBtn').off('click').on('click', function () {
                scope.saveFromModal();
            });
        },

        refreshAll: function (forceRefresh) {
            var scope = _oilProductionForecastGrid;
            var df = typeof _dataFunctions !== 'undefined' ? _dataFunctions : (typeof dataFunctions !== 'undefined' ? dataFunctions : null);
            if (!df || typeof df.getOilProductionForecasts !== 'function' || typeof df.getOilStockLots !== 'function') {
                scope.showError('Data layer not ready. Reload the page.');
                return;
            }
            Promise.all([
                df.getOilProductionForecasts(null, forceRefresh === true),
                df.getOilStockLots({ status: 'on_hand', limit: 1000, offset: 0 }, null, forceRefresh === true)
            ]).then(function (results) {
                scope.forecasts = results[0] || [];
                scope.sohByStream = aggregateSohByStream(results[1] || []);
                scope.renderByStream();
                scope.renderLines();
            }).catch(function (err) {
                console.error('[Oil Forecast] load failed', err);
                scope.showError(err && err.message ? err.message : 'Failed to load forecasts or stock.');
            });
        },

        openEditModal: function (row) {
            var scope = _oilProductionForecastGrid;
            document.getElementById('oilForecastEditId').value = row && row.id ? row.id : '';
            document.getElementById('oilForecastCustomer').value = row && row.customer_label ? row.customer_label : '';
            document.getElementById('oilForecastOrderSummary').value = row && row.order_summary ? row.order_summary : '';
            var sc = row && row.stream_code ? row.stream_code : 'food_grade';
            document.getElementById('oilForecastStream').value = OIL_STREAM_CODES.indexOf(sc) >= 0 ? sc : 'food_grade';
            document.getElementById('oilForecastQty').value = row && row.quantity_kg != null ? row.quantity_kg : 0;
            document.getElementById('oilForecastStatus').value = row && row.status ? row.status : 'open';
            document.getElementById('oilForecastDue').value = row && row.due_date ? String(row.due_date).slice(0, 10) : '';
            document.getElementById('oilForecastNotes').value = row && row.notes ? row.notes : '';
            document.getElementById('oilForecastSort').value = row && row.sort_index != null ? row.sort_index : '';
            document.getElementById('oilForecastEditModalLabel').textContent = row && row.id ? 'Edit forecast line' : 'New forecast line';
            if (scope.editModal) scope.editModal.show();
        },

        saveFromModal: function () {
            var scope = _oilProductionForecastGrid;
            var df = typeof _dataFunctions !== 'undefined' ? _dataFunctions : dataFunctions;
            var idVal = document.getElementById('oilForecastEditId').value.trim();
            var payload = {
                id: idVal || null,
                customer_label: document.getElementById('oilForecastCustomer').value,
                order_summary: document.getElementById('oilForecastOrderSummary').value,
                stream_code: document.getElementById('oilForecastStream').value,
                quantity_kg: parseNum(document.getElementById('oilForecastQty').value),
                status: document.getElementById('oilForecastStatus').value,
                due_date: document.getElementById('oilForecastDue').value || null,
                notes: document.getElementById('oilForecastNotes').value,
                sort_index: (function () {
                    var s = document.getElementById('oilForecastSort').value.trim();
                    if (s === '') return null;
                    var n = parseInt(s, 10);
                    return isNaN(n) ? null : n;
                })()
            };
            df.upsertOilProductionForecast(payload, null).then(function () {
                if (scope.editModal) scope.editModal.hide();
                scope.refreshAll(true);
            }).catch(function (err) {
                console.error('[Oil Forecast] save failed', err);
                scope.showError(err && err.message ? err.message : 'Save failed.');
            });
        },

        deleteRow: function (id) {
            var scope = _oilProductionForecastGrid;
            var df = typeof _dataFunctions !== 'undefined' ? _dataFunctions : dataFunctions;
            var run = function () {
                df.deleteOilProductionForecast(id, null).then(function () {
                    scope.refreshAll(true);
                }).catch(function (err) {
                    console.error('[Oil Forecast] delete failed', err);
                    scope.showError(err && err.message ? err.message : 'Delete failed.');
                });
            };
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Delete this line?',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Delete'
                }).then(function (r) { if (r.isConfirmed) run(); });
            } else if (window.confirm('Delete this forecast line?')) {
                run();
            }
        },

        aggregateOpenDemandByStream: function () {
            var totals = { food_grade: 0, cosmetic: 0, protein: 0 };
            (this.forecasts || []).forEach(function (f) {
                if (!f || !isOpenStatus(f.status)) return;
                var st = f.stream_code;
                if (!st || totals[st] == null) return;
                totals[st] += parseNum(f.quantity_kg);
            });
            return totals;
        },

        renderByStream: function () {
            var scope = _oilProductionForecastGrid;
            var tbody = document.getElementById('oilForecastByStreamBody');
            if (!tbody) return;
            var demand = scope.aggregateOpenDemandByStream();
            tbody.innerHTML = '';
            var any = false;
            OIL_STREAM_CODES.forEach(function (k) {
                var d = parseNum(demand[k]);
                var soh = parseNum(scope.sohByStream[k]);
                if (d <= 0 && soh <= 0) return;
                any = true;
                var gap = Math.round((d - soh) * 100) / 100;
                var gapClass = gap > 0 ? 'text-danger fw-semibold' : (gap < 0 ? 'text-success' : '');
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + escapeHtml(streamLabel(k)) + '</td>' +
                    '<td class="text-end">' + escapeHtml(String(d)) + '</td>' +
                    '<td class="text-end">' + escapeHtml(String(soh)) + '</td>' +
                    '<td class="text-end ' + gapClass + '">' + escapeHtml(String(gap)) + '</td>';
                tbody.appendChild(tr);
            });
            if (!any) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No open forecast lines and no on-hand stock for these streams (or stock is zero).</td></tr>';
            }
        },

        renderLines: function () {
            var scope = _oilProductionForecastGrid;
            var tbody = document.getElementById('oilForecastLinesBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (!scope.forecasts.length) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No forecast lines yet. Click <strong>Add line</strong>.</td></tr>';
                return;
            }
            scope.forecasts.forEach(function (f) {
                var key = f.stream_code && OIL_STREAM_CODES.indexOf(f.stream_code) >= 0 ? f.stream_code : 'food_grade';
                var soh = parseNum(scope.sohByStream[key]);
                var tr = document.createElement('tr');
                var due = f.due_date ? String(f.due_date).slice(0, 10) : '—';
                tr.innerHTML =
                    '<td>' + escapeHtml(f.customer_label) + '</td>' +
                    '<td>' + escapeHtml(f.order_summary || '') + '</td>' +
                    '<td>' + escapeHtml(streamLabel(f.stream_code)) + '</td>' +
                    '<td class="text-end">' + escapeHtml(String(parseNum(f.quantity_kg))) + '</td>' +
                    '<td class="text-end" title="Total kg for this stream in on-hand lots (not reserved to this line)">' + escapeHtml(String(soh)) + '</td>' +
                    '<td>' + escapeHtml(due) + '</td>' +
                    '<td><span class="badge ' + statusBadgeClass(f.status) + '">' + escapeHtml(f.status || '') + '</span></td>' +
                    '<td class="small text-muted">' + escapeHtml(f.notes || '') + '</td>' +
                    '<td class="mac-table-actions-col">' + MacTableActions.render({
                        id: 'ofActions' + f.id,
                        items: [
                            { label: 'Edit', attrs: { 'data-act': 'edit', 'data-id': f.id } },
                            { label: 'Delete', danger: true, attrs: { 'data-act': 'del', 'data-id': f.id } }
                        ]
                    }) + '</td>';
                tbody.appendChild(tr);
            });
            $(tbody).find('[data-act="edit"]').on('click', function (e) {
                e.preventDefault();
                var id = $(this).data('id');
                var row = scope.forecasts.filter(function (x) { return x.id === id; })[0];
                if (row) scope.openEditModal(row);
            });
            $(tbody).find('[data-act="del"]').on('click', function (e) {
                e.preventDefault();
                scope.deleteRow($(this).data('id'));
            });
            MacTableActions.init(document.getElementById('oilForecastLinesTable'));
        },

        showError: function (message) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                alert(message);
            }
        }
    };
}();

window.oilProductionForecastGrid = _oilProductionForecastGrid;

function initializeOilProductionForecastGrid() {
    if (typeof _oilProductionForecastGrid === 'undefined') {
        console.error('[Oil Forecast] module missing');
        return;
    }
    if (typeof $ !== 'undefined') {
        $(document).ready(function () { _oilProductionForecastGrid.init(); });
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { _oilProductionForecastGrid.init(); });
    } else {
        _oilProductionForecastGrid.init();
    }
}
