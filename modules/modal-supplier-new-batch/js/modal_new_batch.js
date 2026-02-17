/**
 * Modal: New batch of product (Supplier Intake). Parent calls show(); modal owns init, show, clearForm, save.
 */
var _modal_supplier_new_batch = (function () {
    'use strict';

    function getRadioValue(name) {
        var el = document.querySelector('input[name="' + name + '"]:checked');
        return el ? el.value : null;
    }

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveNewBatchProductBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('newBatchProductModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: async function () {
            api.clearForm();
            var today = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('newBatchDateReceived');
            if (dateEl) dateEl.value = today;

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getContacts) {
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
                }
            } catch (e) { console.error('Error loading contacts:', e); }

            var modalEl = document.getElementById('newBatchProductModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#newBatchProductModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('newBatchProductForm');
            if (form) form.reset();
            var cartonEl = document.getElementById('newBatchCartonBags');
            if (cartonEl) cartonEl.value = '1';
            var today = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('newBatchDateReceived');
            if (dateEl) dateEl.value = today;
        },

        save: async function () {
            var form = document.getElementById('newBatchProductForm');
            if (!form || !form.checkValidity()) {
                form.reportValidity();
                return;
            }
            var supplierEl = document.getElementById('newBatchSupplier');
            var supplierId = supplierEl && supplierEl.value ? supplierEl.value : null;
            var supplierDetails = null;
            if (supplierEl && supplierEl.options[supplierEl.selectedIndex]) supplierDetails = supplierEl.options[supplierEl.selectedIndex].text || null;

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
                if (typeof dataFunctions === 'undefined' || !dataFunctions.createSupplierIntakeBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Data functions not available.' });
                    return;
                }
                var result = await dataFunctions.createSupplierIntakeBatch(data);
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Batch added to supplier intake.', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('newBatchProductModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#newBatchProductModal').modal('hide');
                    if (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.loadBatches) _supplierIntakeGrid.loadBatches(true);
                } else {
                    var errMsg = (result && (result.error || result.message)) ? (result.error || result.message) : 'Failed to save';
                    if (result && result.details) errMsg += ' ' + (typeof result.details === 'string' ? result.details : JSON.stringify(result.details));
                    throw new Error(errMsg);
                }
            } catch (e) {
                console.error('[Supplier Intake] save new batch failed:', e);
                var displayMsg = e.message || 'Failed to save batch';
                if (e.responseText) displayMsg += ' (' + String(e.responseText).substring(0, 200) + ')';
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: displayMsg });
            }
        }
    };
    return api;
})();
