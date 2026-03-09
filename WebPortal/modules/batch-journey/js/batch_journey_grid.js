var _batchJourneyGrid = (function () {
    'use strict';

    var scope = {
        batches: [],
        filteredBatches: []
    };

    // Status order for "By Status" sort
    var STATUS_ORDER = ['intake', 'receiving', 'production', 'qa', 'dispatch', 'complete'];

    function getMoistureValue(batch) {
        try {
            var intake = batch.intake_data;
            if (!intake) return null;
            if (typeof intake === 'string') intake = JSON.parse(intake);
            // Check ziplock_sample first, then five_kg_sample
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

    function sortBatches(batches, sortBy) {
        var sorted = batches.slice();
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
                    return STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
                });
                break;
            case 'grower':
                sorted.sort(function (a, b) {
                    return (a.grower_name || '').localeCompare(b.grower_name || '');
                });
                break;
            case 'weight':
                sorted.sort(function (a, b) {
                    return (parseFloat(b.wet_nis_received_kg) || 0) - (parseFloat(a.wet_nis_received_kg) || 0);
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

    function filterAndSort() {
        var search = (document.getElementById('bjSearchInput').value || '').toLowerCase().trim();
        var statusFilter = document.getElementById('bjStatusFilter').value;
        var sortBy = document.getElementById('bjSortBy').value;

        var filtered = scope.batches.filter(function (b) {
            if (statusFilter && b.status !== statusFilter) return false;
            if (search) {
                var haystack = ((b.batch_number || '') + ' ' + (b.grower_name || '')).toLowerCase();
                if (haystack.indexOf(search) === -1) return false;
            }
            return true;
        });

        scope.filteredBatches = sortBatches(filtered, sortBy);
        renderTable();
    }

    function renderTable() {
        var tbody = document.getElementById('bjTableBody');
        var countEl = document.getElementById('bjBatchCount');

        if (!scope.filteredBatches.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No batches found</td></tr>';
            countEl.textContent = '0 batches';
            return;
        }

        countEl.textContent = scope.filteredBatches.length + ' batch' + (scope.filteredBatches.length !== 1 ? 'es' : '');

        var html = '';
        for (var i = 0; i < scope.filteredBatches.length; i++) {
            var b = scope.filteredBatches[i];
            var moisture = getMoistureValue(b);
            var totalYield = getTotalYield(b);
            var receivedDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                ? (_common.formatDateDDMMYYYY(b.received_date) || '-')
                : '-';

            html += '<tr class="js-bj-row" data-batch-id="' + b.id + '">'
                + '<td>' + (b.batch_number || '-') + '</td>'
                + '<td>' + (b.grower_name || '-') + '</td>'
                + '<td><span class="bj-status bj-status-' + (b.status || 'intake') + '">' + (b.status || '-') + '</span></td>'
                + '<td>' + receivedDate + '</td>'
                + '<td class="text-end">' + formatNumber(b.wet_nis_received_kg) + '</td>'
                + '<td class="text-end">' + (moisture != null ? formatNumber(moisture, 1) + '%' : '-') + '</td>'
                + '<td class="text-end">' + (totalYield > 0 ? formatNumber(totalYield) : '-') + '</td>'
                + '</tr>';
        }
        tbody.innerHTML = html;
    }

    function bindEvents() {
        document.getElementById('bjSearchInput').addEventListener('input', filterAndSort);
        document.getElementById('bjStatusFilter').addEventListener('change', filterAndSort);
        document.getElementById('bjSortBy').addEventListener('change', filterAndSort);

        // Row click -> batch history modal
        $(document).on('click', '#bjTableBody tr.js-bj-row', function (e) {
            if ($(e.target).closest('button, .btn, .dropdown').length) return;
            var batchId = $(this).data('batch-id');
            if (batchId && typeof _modal_batch_history !== 'undefined' && _modal_batch_history.show) {
                _modal_batch_history.show(batchId);
            }
        });
    }

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
                '<tr><td colspan="7" class="text-center text-danger py-4">Failed to load batches</td></tr>';
        });
    }

    return {
        init: function () {
            bindEvents();
            loadBatches();

            // Load batch history modal
            if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                _appRouter.loadContent({
                    routeName: 'batch-history-modal',
                    elementSelector: '#bjBatchHistoryContainer'
                });
            }
        }
    };
})();
