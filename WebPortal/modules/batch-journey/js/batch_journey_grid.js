var _batchJourneyGrid = (function () {
    'use strict';

    var scope = {
        batches: [],
        filteredBatches: [],
        oilBatches: [],
        filteredOilBatches: [],
        activeStream: 'kernel'
    };

    function getDisplayStatus(batch) {
        return typeof BatchStatus !== 'undefined'
            ? BatchStatus.getDisplayStatus(batch)
            : { value: 'gi-receiving', label: 'Receiving', bucket: 'grower' };
    }

    function getOilDisplayStatus(batch) {
        return typeof BatchStatus !== 'undefined'
            ? BatchStatus.getOilDisplayStatus(batch)
            : { value: 'oil-awaiting-test', label: 'Awaiting tests', bucket: 'intake' };
    }

    function statusFilterMatches(batch, filter) {
        if (typeof BatchStatus !== 'undefined') {
            return BatchStatus.statusFilterMatches(batch, filter);
        }
        return true;
    }

    function getMoistureValue(batch) {
        try {
            var intake = batch.intake_data;
            if (!intake) return null;
            if (typeof intake === 'string') intake = JSON.parse(intake);
            if (intake.ziplock_sample && intake.ziplock_sample.moisture_result != null) {
                return parseFloat(intake.ziplock_sample.moisture_result);
            }
            if (intake.five_kg_sample && intake.five_kg_sample.moisture_result != null) {
                return parseFloat(intake.five_kg_sample.moisture_result);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    function getTotalYield(batch) {
        var yield_data = batch.yield_by_style;
        if (!yield_data) return 0;
        if (typeof yield_data === 'string') {
            try { yield_data = JSON.parse(yield_data); } catch (e) { return 0; }
        }
        var total = 0;
        for (var key in yield_data) {
            total += parseFloat(yield_data[key]) || 0;
        }
        return total;
    }

    function formatNumber(val, decimals) {
        if (val == null || val === '' || isNaN(val)) return '-';
        return parseFloat(val).toLocaleString('en-ZA', {
            minimumFractionDigits: decimals || 0,
            maximumFractionDigits: decimals || 0
        });
    }

    function escapeHtml(s) {
        if (typeof BatchStatus !== 'undefined') return BatchStatus.escapeHtml(s);
        if (s == null) return '';
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function statusBadgeHtml(d) {
        return typeof BatchStatus !== 'undefined' ? BatchStatus.statusBadgeHtml(d) : escapeHtml(d.label || '');
    }

    function sortBatches(batches, sortBy) {
        var sorted = batches.slice();
        var statusOrder = typeof BatchStatus !== 'undefined' ? BatchStatus.STATUS_ORDER : [];
        switch (sortBy) {
            case 'newest':
                sorted.sort(function (a, b) {
                    return new Date(b.received_date || b.created_at || 0) - new Date(a.received_date || a.created_at || 0);
                });
                break;
            case 'oldest':
                sorted.sort(function (a, b) {
                    return new Date(a.received_date || a.created_at || 0) - new Date(b.received_date || b.created_at || 0);
                });
                break;
            case 'status':
                sorted.sort(function (a, b) {
                    function ord(x, getter) {
                        var i = statusOrder.indexOf(getter(x).value);
                        return i >= 0 ? i : 999;
                    }
                    return ord(a, getDisplayStatus) - ord(b, getDisplayStatus);
                });
                break;
            case 'grower':
                sorted.sort(function (a, b) {
                    return (a.grower_name || a.supplier_name || '').localeCompare(b.grower_name || b.supplier_name || '');
                });
                break;
            case 'weight':
                sorted.sort(function (a, b) {
                    return (parseFloat(b.wet_nis_received_kg || b.quantity_kg) || 0) - (parseFloat(a.wet_nis_received_kg || a.quantity_kg) || 0);
                });
                break;
            case 'moisture':
                sorted.sort(function (a, b) {
                    var ma = getMoistureValue(a);
                    var mb = getMoistureValue(b);
                    if (ma == null && mb == null) return 0;
                    if (ma == null) return 1;
                    if (mb == null) return -1;
                    return mb - ma;
                });
                break;
        }
        return sorted;
    }

    function openActionForKernelBatch(batch) {
        var d = getDisplayStatus(batch);
        var routeInfo = typeof BatchStatus !== 'undefined'
            ? BatchStatus.getKernelRouteForStatus(d)
            : { route: 'batch-journey', label: 'Open', searchInputId: 'bjSearchInput' };
        var label = batch.batch_number || batch.id || '';
        if (typeof HandoffDialog !== 'undefined') {
            HandoffDialog.navigateToRoute(routeInfo.route, label, routeInfo.searchInputId);
        } else if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
            _appRouter.routeTo(routeInfo.route);
        }
    }

    function openActionForOilBatch(batch) {
        var d = getOilDisplayStatus(batch);
        var routeInfo = typeof BatchStatus !== 'undefined'
            ? BatchStatus.getOilRouteForStatus(d)
            : { route: 'supplier-intake-grid', label: 'Open', searchInputId: 'searchSupplierIntakeInput' };
        var label = batch.batch_number || batch.id || '';
        if (typeof HandoffDialog !== 'undefined') {
            HandoffDialog.navigateToRoute(routeInfo.route, label, routeInfo.searchInputId);
        } else if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
            _appRouter.routeTo(routeInfo.route);
        }
    }

    function renderKernelTable() {
        var tbody = document.getElementById('bjTableBody');
        var countEl = document.getElementById('bjBatchCount');
        if (!tbody) return;

        if (!scope.filteredBatches.length) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">No batches found</td></tr>';
            if (countEl) countEl.textContent = '0 batches';
            return;
        }

        if (countEl) countEl.textContent = scope.filteredBatches.length + ' batch' + (scope.filteredBatches.length !== 1 ? 'es' : '');

        var html = '';
        for (var i = 0; i < scope.filteredBatches.length; i++) {
            var b = scope.filteredBatches[i];
            var displayStatus = getDisplayStatus(b);
            var moisture = getMoistureValue(b);
            var totalYield = getTotalYield(b);
            var receivedDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                ? (_common.formatDateDDMMYYYY(b.received_date) || '-')
                : '-';
            var kid = escapeHtml(b.id);
            var routeInfo = typeof BatchStatus !== 'undefined' ? BatchStatus.getKernelRouteForStatus(displayStatus) : { label: 'Open' };
            var ddSuffix = String(b.id || '').replace(/-/g, '');
            html += '<tr class="js-bj-row" data-batch-id="' + kid + '">'
                + '<td>' + (b.batch_number || '-') + '</td>'
                + '<td>' + (b.grower_name || '-') + '</td>'
                + '<td>' + statusBadgeHtml(displayStatus) + '</td>'
                + '<td>' + receivedDate + '</td>'
                + '<td class="text-end">' + formatNumber(b.wet_nis_received_kg) + '</td>'
                + '<td class="text-end">' + (moisture != null ? formatNumber(moisture, 1) + '%' : '-') + '</td>'
                + '<td class="text-end">' + (totalYield > 0 ? formatNumber(totalYield) : '-') + '</td>'
                + '<td class="text-end"><button type="button" class="btn btn-sm btn-primary js-bj-open-module" data-batch-id="' + kid + '" title="' + escapeHtml(routeInfo.label) + '">' + escapeHtml(routeInfo.label.replace(/^Open /, '')) + '</button></td>'
                + '<td class="bj-actions-col text-end">'
                + '<div class="dropdown">'
                + '<button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" id="bjEdit' + ddSuffix + '" data-bs-toggle="dropdown" data-bs-display="static" aria-expanded="false" aria-label="Edit batch">Edit</button>'
                + '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="bjEdit' + ddSuffix + '">'
                + '<li><a class="dropdown-item text-danger bj-delete-batch" href="#" data-kernel-id="' + kid + '"><i class="fas fa-trash-alt me-1"></i>Delete permanently</a></li>'
                + '</ul></div></td>'
                + '</tr>';
        }
        tbody.innerHTML = html;
    }

    function renderOilTable() {
        var tbody = document.getElementById('bjOilTableBody');
        var countEl = document.getElementById('bjOilBatchCount');
        if (!tbody) return;

        if (!scope.filteredOilBatches.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No oil batches found</td></tr>';
            if (countEl) countEl.textContent = '0 batches';
            return;
        }

        if (countEl) countEl.textContent = scope.filteredOilBatches.length + ' batch' + (scope.filteredOilBatches.length !== 1 ? 'es' : '');

        var html = '';
        for (var j = 0; j < scope.filteredOilBatches.length; j++) {
            var ob = scope.filteredOilBatches[j];
            var od = getOilDisplayStatus(ob);
            var received = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                ? (_common.formatDateDDMMYYYY(ob.date_received || ob.received_date) || '-')
                : '-';
            var oid = escapeHtml(ob.id);
            var oilRoute = typeof BatchStatus !== 'undefined' ? BatchStatus.getOilRouteForStatus(od) : { label: 'Open' };
            html += '<tr class="js-bj-oil-row" data-oil-id="' + oid + '">'
                + '<td>' + (ob.batch_number || '-') + '</td>'
                + '<td>' + (ob.supplier_name || ob.grower_name || '-') + '</td>'
                + '<td>' + statusBadgeHtml(od) + '</td>'
                + '<td>' + received + '</td>'
                + '<td class="text-end">' + formatNumber(ob.quantity_kg, 2) + '</td>'
                + '<td class="text-end"><button type="button" class="btn btn-sm btn-primary js-bj-oil-open-module" data-oil-id="' + oid + '">' + escapeHtml(oilRoute.label.replace(/^Open /, '')) + '</button></td>'
                + '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-secondary js-bj-oil-history" data-oil-id="' + oid + '" title="Batch history"><i class="fas fa-history"></i></button></td>'
                + '</tr>';
        }
        tbody.innerHTML = html;
    }

    function filterAndSort() {
        if (scope.activeStream === 'oil') {
            filterAndSortOil();
            return;
        }
        var search = (document.getElementById('bjSearchInput').value || '').toLowerCase().trim();
        var statusFilter = document.getElementById('bjStatusFilter').value;
        var sortBy = document.getElementById('bjSortBy').value;

        var filtered = scope.batches.filter(function (b) {
            if (!statusFilterMatches(b, statusFilter)) return false;
            if (search) {
                var haystack = ((b.batch_number || '') + ' ' + (b.grower_name || '')).toLowerCase();
                if (haystack.indexOf(search) === -1) return false;
            }
            return true;
        });

        scope.filteredBatches = sortBatches(filtered, sortBy);
        renderKernelTable();
    }

    function filterAndSortOil() {
        var searchEl = document.getElementById('bjOilSearchInput');
        var search = searchEl ? (searchEl.value || '').toLowerCase().trim() : '';
        var statusFilterEl = document.getElementById('bjOilStatusFilter');
        var statusFilter = statusFilterEl ? statusFilterEl.value : '';
        var sortEl = document.getElementById('bjOilSortBy');
        var sortBy = sortEl ? sortEl.value : 'newest';

        scope.filteredOilBatches = scope.oilBatches.filter(function (b) {
            if (statusFilter) {
                var d = getOilDisplayStatus(b);
                if (d.value !== statusFilter) return false;
            }
            if (search) {
                var hay = ((b.batch_number || '') + ' ' + (b.supplier_name || b.grower_name || '')).toLowerCase();
                if (hay.indexOf(search) === -1) return false;
            }
            return true;
        });
        scope.filteredOilBatches = sortBatches(scope.filteredOilBatches, sortBy);
        renderOilTable();
    }

    function setActiveStream(stream) {
        scope.activeStream = stream === 'oil' ? 'oil' : 'kernel';
        var kernelPanel = document.getElementById('bjKernelPanel');
        var oilPanel = document.getElementById('bjOilPanel');
        if (kernelPanel) kernelPanel.style.display = scope.activeStream === 'kernel' ? '' : 'none';
        if (oilPanel) oilPanel.style.display = scope.activeStream === 'oil' ? '' : 'none';
        document.querySelectorAll('#bjStreamTabs .nav-link').forEach(function (btn) {
            var s = btn.getAttribute('data-stream');
            btn.classList.toggle('active', s === scope.activeStream);
        });
        if (scope.activeStream === 'oil' && !scope.oilBatches.length) {
            loadOilBatches();
        } else if (scope.activeStream === 'oil') {
            filterAndSortOil();
        } else {
            filterAndSort();
        }
    }

    function bindEvents() {
        document.getElementById('bjSearchInput').addEventListener('input', filterAndSort);
        document.getElementById('bjStatusFilter').addEventListener('change', filterAndSort);
        document.getElementById('bjSortBy').addEventListener('change', filterAndSort);

        var oilSearch = document.getElementById('bjOilSearchInput');
        if (oilSearch) oilSearch.addEventListener('input', filterAndSortOil);
        var oilStatus = document.getElementById('bjOilStatusFilter');
        if (oilStatus) oilStatus.addEventListener('change', filterAndSortOil);
        var oilSort = document.getElementById('bjOilSortBy');
        if (oilSort) oilSort.addEventListener('change', filterAndSortOil);

        document.querySelectorAll('#bjStreamTabs .nav-link').forEach(function (btn) {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                setActiveStream(btn.getAttribute('data-stream'));
            });
        });

        $(document).on('click', '#bjTableBody tr.js-bj-row', function (e) {
            if ($(e.target).closest('button, .btn, .dropdown, a').length) return;
            var batchId = $(this).data('batch-id');
            if (batchId && typeof _modal_batch_history !== 'undefined' && _modal_batch_history.show) {
                _modal_batch_history.show(batchId);
            }
        });

        $(document).on('click', '#bjTableBody .js-bj-open-module', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var batchId = $(this).data('batch-id');
            var batch = scope.filteredBatches.find(function (b) { return String(b.id) === String(batchId); });
            if (batch) openActionForKernelBatch(batch);
        });

        $(document).on('click', '#bjOilTableBody .js-bj-oil-open-module', function (e) {
            e.preventDefault();
            var oilId = $(this).data('oil-id');
            var batch = scope.filteredOilBatches.find(function (b) { return String(b.id) === String(oilId); });
            if (batch) openActionForOilBatch(batch);
        });

        $(document).on('click', '#bjOilTableBody .js-bj-oil-history', function (e) {
            e.preventDefault();
            var oilId = $(this).data('oil-id');
            var batch = scope.filteredOilBatches.find(function (b) { return String(b.id) === String(oilId); });
            if (batch && typeof _modal_oil_batch_history !== 'undefined' && _modal_oil_batch_history.show) {
                _modal_oil_batch_history.show(batch);
            } else if (batch && typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'info',
                    title: batch.batch_number || 'Oil batch',
                    html: '<p class="mb-1"><strong>Status:</strong> ' + escapeHtml(getOilDisplayStatus(batch).label) + '</p>'
                        + '<p class="small text-muted mb-0">Use the Open button to continue this batch in the correct module.</p>'
                });
            }
        });

        $(document).on('click', '#bjTableBody .dropdown-toggle', function (e) {
            e.stopPropagation();
        });

        $(document).on('click', '#bjTableBody .bj-delete-batch', function (e) {
            e.preventDefault();
            e.stopPropagation();
            var kernelId = $(this).data('kernel-id');
            if (!kernelId) return;
            var row = $(this).closest('tr.js-bj-row');
            var label = (row.find('td').first().text() || 'This batch').trim();
            if (typeof Swal === 'undefined') {
                if (!window.confirm('Permanently delete batch ' + label + '? This cannot be undone.')) return;
                scope.runPermanentDelete(kernelId, label);
                return;
            }
            Swal.fire({
                title: 'Delete batch permanently?',
                html: '<p class="mb-0">Batch <strong>' + escapeHtml(label) + '</strong> will be removed from the database (kernel record, batch header, silo assignment, and dispatch lines for this batch). This cannot be undone.</p>',
                icon: 'warning',
                showCancelButton: true,
                focusCancel: true,
                confirmButtonText: 'Yes, delete forever',
                confirmButtonColor: '#dc3545',
                cancelButtonText: 'Cancel'
            }).then(function (res) {
                if (res && res.isConfirmed) scope.runPermanentDelete(kernelId, label);
            });
        });
    }

    scope.runPermanentDelete = function (kernelId, label) {
        if (typeof _dataFunctions === 'undefined' || !_dataFunctions.deleteKernelBatchPermanent) {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Delete is not available. Refresh the page or apply the latest database migration.', 'error');
            else window.alert('Delete is not available.');
            return;
        }
        _dataFunctions.deleteKernelBatchPermanent(kernelId).then(function (result) {
            if (!result || result.success === false) {
                throw new Error((result && result.error) || 'Delete failed');
            }
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'Batch deleted',
                    text: (label || 'Batch') + ' was permanently removed.',
                    timer: 2200,
                    showConfirmButton: false
                });
            }
            loadBatches();
        }).catch(function (err) {
            console.error('Batch Journey: permanent delete failed', err);
            var msg = (err && err.message) ? err.message : 'Delete failed';
            if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
            else window.alert(msg);
        });
    };

    function loadBatches() {
        if (typeof _dataFunctions === 'undefined') return;

        _dataFunctions.getKernelBatches(null, false, {
            status: null,
            limit: 500
        }).then(function (data) {
            scope.batches = data || [];
            filterAndSort();
        }).catch(function (err) {
            console.error('Batch Journey: failed to load batches', err);
            document.getElementById('bjTableBody').innerHTML =
                '<tr><td colspan="9" class="text-center text-danger py-4">Failed to load batches</td></tr>';
        });
    }

    function loadOilBatches() {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilBatches) {
            var tbody = document.getElementById('bjOilTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Oil batch list is not available.</td></tr>';
            return;
        }
        dataFunctions.getOilBatches({ limit: 500 }, null, false).then(function (rows) {
            scope.oilBatches = rows || [];
            filterAndSortOil();
        }).catch(function (err) {
            console.error('Batch Journey: failed to load oil batches', err);
            var tbody = document.getElementById('bjOilTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">Failed to load oil batches</td></tr>';
        });
    }

    return {
        init: function () {
            if (typeof BatchStatus !== 'undefined') BatchStatus.applyModuleSubtitle('batch-journey');
            if (typeof HandoffDialog !== 'undefined') HandoffDialog.applyPendingSearchForRoute('batch-journey');
            bindEvents();
            loadBatches();

            if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                _appRouter.loadContent({
                    routeName: 'batch-history-modal',
                    elementSelector: '#batchHistoryModal'
                });
            }
        }
    };
})();

/** Lightweight oil batch history (Find a batch → Oil tab). */
var _modal_oil_batch_history = {
    show: function (batch) {
        if (!batch || typeof Swal === 'undefined') return;
        var d = typeof BatchStatus !== 'undefined' ? BatchStatus.getOilDisplayStatus(batch) : { label: batch.status || '—' };
        var routeInfo = typeof BatchStatus !== 'undefined' ? BatchStatus.getOilRouteForStatus(d) : null;
        var html = '<dl class="text-start small mb-0">'
            + '<dt>Batch</dt><dd>' + (typeof BatchStatus !== 'undefined' ? BatchStatus.escapeHtml(batch.batch_number || '—') : (batch.batch_number || '—')) + '</dd>'
            + '<dt>Supplier</dt><dd>' + (batch.supplier_name || batch.grower_name || '—') + '</dd>'
            + '<dt>Status</dt><dd>' + d.label + '</dd>'
            + '<dt>Quantity (kg)</dt><dd>' + (batch.quantity_kg != null ? batch.quantity_kg : '—') + '</dd>'
            + '</dl>';
        Swal.fire({
            title: 'Oil batch history',
            html: html,
            icon: 'info',
            showCancelButton: !!routeInfo,
            confirmButtonText: routeInfo ? routeInfo.label : 'OK',
            cancelButtonText: 'Close'
        }).then(function (res) {
            if (res && res.isConfirmed && routeInfo && typeof HandoffDialog !== 'undefined') {
                HandoffDialog.navigateToRoute(routeInfo.route, batch.batch_number || '', routeInfo.searchInputId);
            }
        });
    }
};
