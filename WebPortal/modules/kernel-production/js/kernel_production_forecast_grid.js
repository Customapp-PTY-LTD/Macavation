/**
 * Kernel production forecast: demand lines vs stock on hand (complete batches), same styles as kernel stock grid.
 */
var _kernelProductionForecastGrid = function () {
    'use strict';

    var KERNEL_STYLE_OPTIONS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];
    var KERNEL_KG_PER_CARTON = 11.34;

    function parseNum(val) {
        if (val == null || val === '') return 0;
        var n = typeof val === 'number' ? val : parseFloat(val);
        return isNaN(n) ? 0 : n;
    }

    function kernelStyleMapFromBatch(batch, prop) {
        var v = batch && batch[prop];
        if (v == null) return {};
        if (typeof v === 'object' && !Array.isArray(v)) return v;
        if (typeof v === 'string') {
            var s = v.trim();
            if (s === '' || s === 'null') return {};
            try {
                var p = JSON.parse(s);
                if (typeof p === 'object' && p !== null && !Array.isArray(p)) return p;
            } catch (e) { /* ignore */ }
        }
        return {};
    }

    function cartonsOnHandForBatchStyle(batch, styleKey) {
        var remKg = kernelStyleMapFromBatch(batch, 'remaining_by_style');
        var remCart = kernelStyleMapFromBatch(batch, 'remaining_by_style_cartons');
        var rk = parseNum(remKg[styleKey]);
        var rc = parseNum(remCart[styleKey]);
        if (rc > 0) return rc;
        if (rk > 0) return Math.round((rk / KERNEL_KG_PER_CARTON) * 100) / 100;
        return 0;
    }

    function aggregateSohByStyle(batches) {
        var totals = {};
        KERNEL_STYLE_OPTIONS.forEach(function (k) { totals[k] = 0; });
        if (!Array.isArray(batches)) return totals;
        batches.forEach(function (b) {
            KERNEL_STYLE_OPTIONS.forEach(function (k) {
                totals[k] += cartonsOnHandForBatchStyle(b, k);
            });
        });
        return totals;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
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
        sohByStyle: {},
        editModal: null,

        init: function () {
            var scope = _kernelProductionForecastGrid;
            if (typeof $ === 'undefined') {
                console.warn('[Kernel Forecast] jQuery not loaded');
                return;
            }
            scope.populateStyleSelect();
            scope.bindEvents();
            if (typeof bootstrap !== 'undefined' && document.getElementById('kernelForecastEditModal')) {
                scope.editModal = new bootstrap.Modal(document.getElementById('kernelForecastEditModal'));
            }
            scope.refreshAll();
        },

        populateStyleSelect: function () {
            var sel = document.getElementById('kernelForecastStyle');
            if (!sel) return;
            sel.innerHTML = '';
            KERNEL_STYLE_OPTIONS.forEach(function (k) {
                var opt = document.createElement('option');
                opt.value = k;
                opt.textContent = k;
                sel.appendChild(opt);
            });
        },

        bindEvents: function () {
            var scope = _kernelProductionForecastGrid;
            $('#kernelForecastRefreshBtn').off('click').on('click', function () {
                scope.refreshAll(true);
            });
            $('#kernelForecastAddBtn').off('click').on('click', function () {
                scope.openEditModal(null);
            });
            $('#kernelForecastSaveBtn').off('click').on('click', function () {
                scope.saveFromModal();
            });
        },

        refreshAll: function (forceRefresh) {
            var scope = _kernelProductionForecastGrid;
            var df = typeof _dataFunctions !== 'undefined' ? _dataFunctions : (typeof dataFunctions !== 'undefined' ? dataFunctions : null);
            if (!df || typeof df.getKernelProductionForecasts !== 'function' || typeof df.getKernelBatches !== 'function') {
                scope.showError('Data layer not ready. Reload the page.');
                return;
            }
            Promise.all([
                df.getKernelProductionForecasts(null, forceRefresh === true),
                df.getKernelBatches(null, forceRefresh === true, { status: 'complete' })
            ]).then(function (results) {
                scope.forecasts = results[0] || [];
                scope.sohByStyle = aggregateSohByStyle(results[1] || []);
                scope.renderByStyle();
                scope.renderLines();
            }).catch(function (err) {
                console.error('[Kernel Forecast] load failed', err);
                scope.showError(err && err.message ? err.message : 'Failed to load forecasts or stock.');
            });
        },

        openEditModal: function (row) {
            var scope = _kernelProductionForecastGrid;
            document.getElementById('kernelForecastEditId').value = row && row.id ? row.id : '';
            document.getElementById('kernelForecastCustomer').value = row && row.customer_label ? row.customer_label : '';
            document.getElementById('kernelForecastOrderSummary').value = row && row.order_summary ? row.order_summary : '';
            document.getElementById('kernelForecastStyle').value = (row && row.style_code && KERNEL_STYLE_OPTIONS.indexOf(row.style_code) >= 0) ? row.style_code : '4L';
            document.getElementById('kernelForecastQty').value = row && row.quantity_cartons != null ? row.quantity_cartons : 0;
            document.getElementById('kernelForecastStatus').value = row && row.status ? row.status : 'open';
            document.getElementById('kernelForecastDue').value = row && row.due_date ? String(row.due_date).slice(0, 10) : '';
            document.getElementById('kernelForecastNotes').value = row && row.notes ? row.notes : '';
            document.getElementById('kernelForecastSort').value = row && row.sort_index != null ? row.sort_index : '';
            document.getElementById('kernelForecastEditModalLabel').textContent = row && row.id ? 'Edit forecast line' : 'New forecast line';
            if (scope.editModal) scope.editModal.show();
        },

        saveFromModal: function () {
            var scope = _kernelProductionForecastGrid;
            var df = typeof _dataFunctions !== 'undefined' ? _dataFunctions : dataFunctions;
            var idVal = document.getElementById('kernelForecastEditId').value.trim();
            var payload = {
                id: idVal || null,
                customer_label: document.getElementById('kernelForecastCustomer').value,
                order_summary: document.getElementById('kernelForecastOrderSummary').value,
                style_code: document.getElementById('kernelForecastStyle').value,
                quantity_cartons: parseNum(document.getElementById('kernelForecastQty').value),
                status: document.getElementById('kernelForecastStatus').value,
                due_date: document.getElementById('kernelForecastDue').value || null,
                notes: document.getElementById('kernelForecastNotes').value,
                sort_index: (function () {
                    var s = document.getElementById('kernelForecastSort').value.trim();
                    if (s === '') return null;
                    var n = parseInt(s, 10);
                    return isNaN(n) ? null : n;
                })()
            };
            df.upsertKernelProductionForecast(payload, null).then(function () {
                if (scope.editModal) scope.editModal.hide();
                scope.refreshAll(true);
            }).catch(function (err) {
                console.error('[Kernel Forecast] save failed', err);
                scope.showError(err && err.message ? err.message : 'Save failed.');
            });
        },

        deleteRow: function (id) {
            var scope = _kernelProductionForecastGrid;
            var df = typeof _dataFunctions !== 'undefined' ? _dataFunctions : dataFunctions;
            var run = function () {
                df.deleteKernelProductionForecast(id, null).then(function () {
                    scope.refreshAll(true);
                }).catch(function (err) {
                    console.error('[Kernel Forecast] delete failed', err);
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

        aggregateOpenDemandByStyle: function () {
            var totals = {};
            KERNEL_STYLE_OPTIONS.forEach(function (k) { totals[k] = 0; });
            (this.forecasts || []).forEach(function (f) {
                if (!f || !isOpenStatus(f.status)) return;
                var st = f.style_code;
                if (!st || totals[st] == null) return;
                totals[st] += parseNum(f.quantity_cartons);
            });
            return totals;
        },

        renderByStyle: function () {
            var scope = _kernelProductionForecastGrid;
            var tbody = document.getElementById('kernelForecastByStyleBody');
            if (!tbody) return;
            var demand = scope.aggregateOpenDemandByStyle();
            tbody.innerHTML = '';
            var any = false;
            KERNEL_STYLE_OPTIONS.forEach(function (k) {
                var d = parseNum(demand[k]);
                var soh = parseNum(scope.sohByStyle[k]);
                if (d <= 0 && soh <= 0) return;
                any = true;
                var gap = Math.round((d - soh) * 100) / 100;
                var gapClass = gap > 0 ? 'text-danger fw-semibold' : (gap < 0 ? 'text-success' : '');
                var tr = document.createElement('tr');
                tr.innerHTML =
                    '<td>' + escapeHtml(k) + '</td>' +
                    '<td class="text-end">' + escapeHtml(String(d)) + '</td>' +
                    '<td class="text-end">' + escapeHtml(String(soh)) + '</td>' +
                    '<td class="text-end ' + gapClass + '">' + escapeHtml(String(gap)) + '</td>';
                tbody.appendChild(tr);
            });
            if (!any) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No open forecast lines and no stock rows for these styles (or stock is zero).</td></tr>';
            }
        },

        renderLines: function () {
            var scope = _kernelProductionForecastGrid;
            var tbody = document.getElementById('kernelForecastLinesBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            if (!scope.forecasts.length) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No forecast lines yet. Click <strong>Add line</strong>.</td></tr>';
                return;
            }
            scope.forecasts.forEach(function (f) {
                var soh = parseNum(scope.sohByStyle[f.style_code]);
                var tr = document.createElement('tr');
                var due = f.due_date ? String(f.due_date).slice(0, 10) : '—';
                tr.innerHTML =
                    '<td>' + escapeHtml(f.customer_label) + '</td>' +
                    '<td>' + escapeHtml(f.order_summary || '') + '</td>' +
                    '<td>' + escapeHtml(f.style_code) + '</td>' +
                    '<td class="text-end">' + escapeHtml(String(parseNum(f.quantity_cartons))) + '</td>' +
                    '<td class="text-end" title="Total cartons for this style in complete batches (not reserved to this line)">' + escapeHtml(String(soh)) + '</td>' +
                    '<td>' + escapeHtml(due) + '</td>' +
                    '<td><span class="badge ' + statusBadgeClass(f.status) + '">' + escapeHtml(f.status || '') + '</span></td>' +
                    '<td class="small text-muted">' + escapeHtml(f.notes || '') + '</td>' +
                    '<td class="text-nowrap">' +
                    '<button type="button" class="btn btn-sm btn-outline-primary me-1" data-act="edit" data-id="' + escapeHtml(f.id) + '">Edit</button>' +
                    '<button type="button" class="btn btn-sm btn-outline-danger" data-act="del" data-id="' + escapeHtml(f.id) + '">Delete</button>' +
                    '</td>';
                tbody.appendChild(tr);
            });
            $(tbody).find('button[data-act="edit"]').on('click', function () {
                var id = $(this).data('id');
                var row = scope.forecasts.filter(function (x) { return x.id === id; })[0];
                if (row) scope.openEditModal(row);
            });
            $(tbody).find('button[data-act="del"]').on('click', function () {
                scope.deleteRow($(this).data('id'));
            });
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

window.kernelProductionForecastGrid = _kernelProductionForecastGrid;

function initializeKernelProductionForecastGrid() {
    if (typeof _kernelProductionForecastGrid === 'undefined') {
        console.error('[Kernel Forecast] module missing');
        return;
    }
    if (typeof $ !== 'undefined') {
        $(document).ready(function () { _kernelProductionForecastGrid.init(); });
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { _kernelProductionForecastGrid.init(); });
    } else {
        _kernelProductionForecastGrid.init();
    }
}
