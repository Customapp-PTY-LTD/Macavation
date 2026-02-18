/**
 * Supplier Intake - Oil & Protein. Add new batch of product (oil kernel, cracker dust, kernel dust, crush, cake).
 * Batches sit in supplier intake until added to a production day.
 * Modals: New batch (new-batch-modal), Receiving checklist (receiving-checklist-modal). Parent only routes; modals own logic.
 */
(function () {
    var batches = [];

    function productTypeLabel(value) {
        var map = { oil_kernel: 'Oil kernel', cracker_dust: 'Cracker dust', kernel_dust: 'Kernel dust', crush: 'Crush', cake: 'Cake' };
        return map[value] || value || '—';
    }

    function formatDate(d) {
        if (!d) return '—';
        var s = typeof d === 'string' ? d : (d.toISOString ? d.toISOString() : String(d));
        return s.split('T')[0];
    }

    async function loadBatches(forceRefresh) {
        var tbody = document.getElementById('supplierIntakeBatchesTableBody');
        if (!tbody) return;
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">Loading…</td></tr>';
        try {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getSupplierIntakeBatches) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">Data functions not available.</td></tr>';
                return;
            }
            batches = await dataFunctions.getSupplierIntakeBatches('supplier_intake', null, forceRefresh) || [];
            if (!Array.isArray(batches)) batches = [];
        } catch (e) {
            console.error('[Supplier Intake] loadBatches failed:', e);
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-danger py-3">Failed to load batches.</td></tr>';
            return;
        }
        if (batches.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted py-3">No batches in supplier intake. Click <strong>Add new batch of product</strong> to add one.</td></tr>';
            return;
        }
        var rows = batches.map(function (b) {
            var supplier = b.supplier_details || (b.supplier_id ? '—' : '—');
            if (!supplier && b.supplier_id) supplier = '—';
            var mfgBb = [formatDate(b.manufactured_date), formatDate(b.best_before_date)].filter(Boolean).join(' / ') || '—';
            return '<tr><td>' + productTypeLabel(b.product_type) + '</td><td>' + formatDate(b.date_received) + '</td><td>' + (b.delivery_note_ref || '—') + '</td><td>' + (supplier || '—') + '</td><td>' + (b.batch_number || '—') + '</td><td>' + (b.quantity_kg != null ? b.quantity_kg : '—') + '</td><td>' + mfgBb + '</td><td><span class="badge bg-info">' + (b.status || 'supplier_intake') + '</span></td></tr>';
        });
        tbody.innerHTML = rows.join('');
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

    window._supplierIntakeGrid = { loadBatches: loadBatches };
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
