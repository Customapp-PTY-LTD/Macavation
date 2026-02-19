/**
 * Supplier Intake - Oil & Protein. Add new batch of product (oil kernel, cracker dust, kernel dust, crush, cake).
 * Batches sit in supplier intake until added to a production day.
 * UI follows UI_DESIGN_INSTRUCTIONS.md. Modals: New batch (new-batch-modal), Receiving checklist (receiving-checklist-modal).
 */
(function () {
    var batches = [];
    var filteredBatches = [];

    function escapeHtml(text) {
        if (text == null || text === '') return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function productTypeLabel(value) {
        var map = { oil_kernel: 'Oil kernel', cracker_dust: 'Cracker dust', kernel_dust: 'Kernel dust', crush: 'Crush', cake: 'Cake' };
        return map[value] || value || '—';
    }

    function formatDate(d) {
        if (!d) return '—';
        var s = typeof d === 'string' ? d : (d.toISOString ? d.toISOString() : String(d));
        return s.split('T')[0];
    }

    function renderBatches() {
        var tbody = document.getElementById('supplierIntakeBatchesTableBody');
        if (!tbody) return;
        var list = filteredBatches.length >= 0 ? filteredBatches : batches;
        if (!list || list.length === 0) {
            var msg = batches.length === 0
                ? 'No batches in supplier intake. Click Add new batch of product to add one.'
                : 'No batches match your search.';
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>' + escapeHtml(msg) + '</td></tr>';
            return;
        }
        var rows = list.map(function (b) {
            var supplier = b.supplier_details || (b.supplier_id ? '—' : '—');
            if (!supplier && b.supplier_id) supplier = '—';
            var mfgBb = [formatDate(b.manufactured_date), formatDate(b.best_before_date)].filter(Boolean).join(' / ') || '—';
            var bid = escapeHtml(String(b.id != null ? b.id : b.batch_number || ''));
            var actionsCell = '<div class="dropdown">' +
                '<button class="btn btn-sm btn-outline-secondary" type="button" id="supplierIntakeActions' + bid + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="supplierIntakeActions' + bid + '">' +
                '<a class="dropdown-item js-supplier-intake-view" href="#" data-batch-id="' + bid + '">View</a>' +
                '</ul></div>';
            return '<tr class="js-supplier-intake-row" data-batch-id="' + bid + '">' +
                '<td>' + escapeHtml(b.batch_number || '—') + '</td>' +
                '<td>' + escapeHtml(productTypeLabel(b.product_type)) + '</td>' +
                '<td>' + escapeHtml(formatDate(b.date_received)) + '</td>' +
                '<td>' + escapeHtml(b.delivery_note_ref || '—') + '</td>' +
                '<td>' + escapeHtml(supplier || '—') + '</td>' +
                '<td>' + (b.quantity_kg != null ? escapeHtml(String(b.quantity_kg)) : '—') + '</td>' +
                '<td>' + escapeHtml(mfgBb) + '</td>' +
                '<td><span class="badge bg-info">' + escapeHtml(b.status || 'supplier_intake') + '</span></td>' +
                '<td>' + actionsCell + '</td></tr>';
        });
        tbody.innerHTML = rows.join('');
    }

    function filterBatches() {
        var searchEl = document.getElementById('searchSupplierIntakeInput');
        var term = (searchEl ? (searchEl.value || '').toLowerCase() : '') || '';
        filteredBatches = batches.filter(function (b) {
            if (!term) return true;
            var supplier = (b.supplier_details || '').toString().toLowerCase();
            var batchNum = (b.batch_number || '').toString().toLowerCase();
            var delivery = (b.delivery_note_ref || '').toString().toLowerCase();
            var product = (b.product_type || '').toString().toLowerCase();
            return batchNum.indexOf(term) >= 0 || supplier.indexOf(term) >= 0 || delivery.indexOf(term) >= 0 || product.indexOf(term) >= 0;
        });
        renderBatches();
    }

    async function loadBatches(forceRefresh) {
        var tbody = document.getElementById('supplierIntakeBatchesTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>Loading…</td></tr>';
        try {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getSupplierIntakeBatches) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>Data functions not available.</td></tr>';
                return;
            }
            batches = await dataFunctions.getSupplierIntakeBatches('supplier_intake', null, forceRefresh) || [];
            if (!Array.isArray(batches)) batches = [];
            filteredBatches = batches;
            filterBatches();
        } catch (e) {
            console.error('[Supplier Intake] loadBatches failed:', e);
            tbody.innerHTML = '<tr><td colspan="9" class="text-center text-danger py-4">Failed to load batches.</td></tr>';
        }
    }

    function setupEventListeners() {
        var addBtn = document.getElementById('addNewBatchProductBtn');
        if (addBtn) {
            addBtn.addEventListener('click', function (e) {
                e.preventDefault();
                if (typeof _modal_supplier_new_batch !== 'undefined' && _modal_supplier_new_batch.show) _modal_supplier_new_batch.show();
            });
        }
        var receivingBtn = document.getElementById('receivingChecklistBtn');
        if (receivingBtn) {
            receivingBtn.addEventListener('click', function (e) {
                e.preventDefault();
                if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.show) _modal_stock_receiving_checklist.show();
            });
        }
        var refreshBtn = document.getElementById('refreshSupplierIntakeBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', function (e) { e.preventDefault(); loadBatches(true); });

        var clearBtn = document.getElementById('clearSupplierIntakeFiltersBtn');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                var searchEl = document.getElementById('searchSupplierIntakeInput');
                if (searchEl) searchEl.value = '';
                filterBatches();
            });
        }
        var searchEl = document.getElementById('searchSupplierIntakeInput');
        if (searchEl) {
            searchEl.addEventListener('input', filterBatches);
        }

        if (typeof $ !== 'undefined') {
            $(document).on('click', '#addNewBatchProductBtn', function (e) {
                e.preventDefault();
                if (typeof _modal_supplier_new_batch !== 'undefined' && _modal_supplier_new_batch.show) _modal_supplier_new_batch.show();
            });
            $(document).on('click', '#receivingChecklistBtn', function (e) {
                e.preventDefault();
                if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.show) _modal_stock_receiving_checklist.show();
            });
            $(document).on('click', '#refreshSupplierIntakeBtn', function (e) { e.preventDefault(); loadBatches(true); });
            $(document).on('click', '#clearSupplierIntakeFiltersBtn', function () {
                var el = document.getElementById('searchSupplierIntakeInput');
                if (el) el.value = '';
                filterBatches();
            });
            $(document).on('input', '#searchSupplierIntakeInput', filterBatches);
            $(document).on('click', '#supplierIntakeBatchesTableBody tr.js-supplier-intake-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                var batchId = $(this).data('batch-id');
                if (batchId && typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Info', 'Batch details view will be implemented here.', 'info');
                }
            });
            $(document).on('click', '.js-supplier-intake-view', function (e) {
                e.preventDefault();
                var batchId = $(this).data('batch-id');
                if (batchId && typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Info', 'Batch details view will be implemented here.', 'info');
                }
            });
        }
    }

    async function init() {
        console.log('[Supplier Intake] Initializing grid');
        var modalContainers = document.querySelectorAll('.modal[route-name]');
        var loadPromises = [];
        modalContainers.forEach(function (el) {
            var routeName = el.getAttribute('route-name');
            if (routeName && el.id && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + el.id }));
            }
        });
        try {
            if (loadPromises.length) await Promise.all(loadPromises);
        } catch (e) {
            console.warn('[Supplier Intake] One or more modal loads failed:', e);
        }
        if (typeof _modal_supplier_new_batch !== 'undefined' && _modal_supplier_new_batch.init) _modal_supplier_new_batch.init();
        if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.init) _modal_stock_receiving_checklist.init();
        setupEventListeners();
        loadBatches(false);
    }

    window._supplierIntakeGrid = { loadBatches: loadBatches, filterBatches: filterBatches };
    window.initializeSupplierIntakeGrid = function () {
        init();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            if (document.getElementById('addNewBatchProductBtn')) init();
        });
    } else if (document.getElementById('addNewBatchProductBtn')) {
        init();
    }
})();
