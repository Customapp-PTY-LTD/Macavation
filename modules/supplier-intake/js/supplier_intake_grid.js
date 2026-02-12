/**
 * Supplier Intake - Oil & Protein. Add new batch of product (oil kernel, cracker dust, kernel dust, crush, cake).
 * Batches sit in supplier intake until added to a production day.
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

    function clearNewBatchForm() {
        var form = document.getElementById('newBatchProductForm');
        if (form) form.reset();
        document.getElementById('newBatchCartonBags').value = '1';
        var today = new Date().toISOString().split('T')[0];
        var dateEl = document.getElementById('newBatchDateReceived');
        if (dateEl) dateEl.value = today;
    }

    async function openNewBatchModal() {
        clearNewBatchForm();
        var today = new Date().toISOString().split('T')[0];
        var dateEl = document.getElementById('newBatchDateReceived');
        if (dateEl) dateEl.value = today;
        try {
            var contacts = await dataFunctions.getContacts();
            var sel = document.getElementById('newBatchSupplier');
            if (sel) {
                var html = '<option value="">Select supplier</option>';
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach(function (c) {
                        var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                        html += '<option value="' + c.id + '">' + name + '</option>';
                    });
                }
                sel.innerHTML = html;
            }
        } catch (e) { console.error('Error loading contacts:', e); }
        var modalEl = document.getElementById('newBatchProductModal');
        if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        } else if (typeof $ !== 'undefined' && $.fn.modal) {
            $('#newBatchProductModal').modal('show');
        }
    }

    function getRadioValue(name) {
        var el = document.querySelector('input[name="' + name + '"]:checked');
        return el ? el.value : null;
    }

    async function saveNewBatch() {
        var form = document.getElementById('newBatchProductForm');
        if (!form || !form.checkValidity()) {
            form.reportValidity();
            return;
        }
        var supplierEl = document.getElementById('newBatchSupplier');
        var supplierId = supplierEl && supplierEl.value ? supplierEl.value : null;
        var supplierDetails = null;
        if (supplierEl && supplierEl.options[supplierEl.selectedIndex]) {
            supplierDetails = supplierEl.options[supplierEl.selectedIndex].text || null;
        }
        var data = {
            product_type: document.getElementById('newBatchProductType').value,
            date_received: document.getElementById('newBatchDateReceived').value,
            delivery_note_ref: document.getElementById('newBatchDeliveryNoteRef').value || null,
            supplier_id: supplierId || null,
            supplier_details: supplierDetails || null,
            vehicle_clean: getRadioValue('newBatchVehicleClean'),
            vehicle_enclosed: getRadioValue('newBatchVehicleEnclosed'),
            hazard_substances: getRadioValue('newBatchHazardSubstances'),
            pest_infestations: getRadioValue('newBatchPestInfestations'),
            pallets_condition: getRadioValue('newBatchPalletsCondition'),
            raw_materials_condition: getRadioValue('newBatchRawMaterialsCondition'),
            receiving_comments: document.getElementById('newBatchReceivingComments').value || null,
            reference: document.getElementById('newBatchReference').value || null,
            description: document.getElementById('newBatchDescription').value || null,
            batch_number: document.getElementById('newBatchBatchNumber').value || null,
            carton_bulk_bags: parseInt(document.getElementById('newBatchCartonBags').value, 10) || 1,
            quantity_kg: parseFloat(document.getElementById('newBatchQuantityKg').value, 10) || null,
            manufactured_date: document.getElementById('newBatchManufacturedDate').value || null,
            best_before_date: document.getElementById('newBatchBestBeforeDate').value || null
        };
        try {
            var result = await dataFunctions.createSupplierIntakeBatch(data);
            if (result && result.success !== false) {
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Batch added to supplier intake.', timer: 2000, showConfirmButton: false });
                var modalEl = document.getElementById('newBatchProductModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#newBatchProductModal').modal('hide');
                }
                loadBatches(true);
            } else {
                var errMsg = (result && (result.error || result.message)) ? (result.error || result.message) : 'Failed to save';
                if (result && result.details) errMsg += ' ' + (typeof result.details === 'string' ? result.details : JSON.stringify(result.details));
                throw new Error(errMsg);
            }
        } catch (e) {
            console.error('[Supplier Intake] saveNewBatch failed:', e);
            var displayMsg = e.message || 'Failed to save batch';
            if (e.responseText) displayMsg += ' (' + String(e.responseText).substring(0, 200) + ')';
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: displayMsg });
        }
    }

    function setupEventListeners() {
        var addBtn = document.getElementById('addNewBatchProductBtn');
        if (addBtn) {
            addBtn.addEventListener('click', function (e) { e.preventDefault(); openNewBatchModal(); });
        }
        if (typeof $ !== 'undefined') {
            $(document).on('click', '#addNewBatchProductBtn', function (e) { e.preventDefault(); openNewBatchModal(); });
            $(document).on('click', '#refreshSupplierIntakeBtn', function (e) { e.preventDefault(); loadBatches(true); });
            $(document).on('click', '#saveNewBatchProductBtn', function (e) { e.preventDefault(); saveNewBatch(); });
            $(document).on('hidden.bs.modal', '#newBatchProductModal', clearNewBatchForm);
        }
        var refreshBtn = document.getElementById('refreshSupplierIntakeBtn');
        if (refreshBtn) refreshBtn.addEventListener('click', function (e) { e.preventDefault(); loadBatches(true); });
        var saveBtn = document.getElementById('saveNewBatchProductBtn');
        if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); saveNewBatch(); });
    }

    function init() {
        console.log('[Supplier Intake] Initializing grid');
        setupEventListeners();
        loadBatches(false);
    }

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
