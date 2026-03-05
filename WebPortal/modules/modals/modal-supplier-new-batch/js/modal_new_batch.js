/**
 * Modal: Create supplier intake batch (Oil & Protein). Mirrors Grower "Create kernel batch":
 * simple form (batch number, date, supplier, product type, quantity, delivery note).
 * Receiving checklist is a separate step; after create we offer "Open Receiving checklist".
 * Parent calls show() or show(batch) for edit.
 */
var _modal_supplier_new_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'newBatchProductModal';
    var _editingOilId = null;
    var _editingBatch = null; // full batch when editing, so we don't overwrite receiving checklist fields

    function setModalTitle(title) {
        var label = document.getElementById('newBatchProductModalLabel');
        if (label) label.textContent = title;
    }

    function setSaveButtonLabel(label) {
        var btn = document.getElementById('saveNewBatchProductBtn');
        if (btn) btn.innerHTML = (label.indexOf('<i') >= 0 ? label : '<i class="fas fa-save me-1"></i>' + label);
    }

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveNewBatchProductBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: async function (batch) {
            _editingOilId = (batch && batch.id) ? batch.id : null;
            _editingBatch = batch || null;
            api.clearForm(false);

            var numberEl = document.getElementById('newBatchBatchNumber');
            var dateEl = document.getElementById('newBatchDateReceived');
            var supplierEl = document.getElementById('newBatchSupplier');
            var productEl = document.getElementById('newBatchProductType');
            var qtyEl = document.getElementById('newBatchQuantityKg');
            var noteEl = document.getElementById('newBatchDeliveryNoteRef');

            if (_editingOilId && batch) {
                setModalTitle('Edit batch');
                setSaveButtonLabel('Save batch');
                if (numberEl) numberEl.value = (batch.batch_number || '').toString();
                if (dateEl) dateEl.value = batch.date_received ? String(batch.date_received).split('T')[0] : '';
                if (productEl) productEl.value = batch.product_type || '';
                if (qtyEl) qtyEl.value = batch.quantity_kg != null ? String(batch.quantity_kg) : '';
                if (noteEl) noteEl.value = (batch.delivery_note_ref || '').toString();
            } else {
                setModalTitle('Create batch');
                setSaveButtonLabel('Create batch');
                var d = new Date();
                if (numberEl) numberEl.value = 'OIL-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-001';
                if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
                if (productEl) productEl.value = '';
                if (qtyEl) qtyEl.value = '';
                if (noteEl) noteEl.value = '';
            }

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getContacts) {
                    var contacts = await dataFunctions.getContacts();
                    if (supplierEl) {
                        var html = '<option value="">Select (optional)</option>';
                        if (contacts && Array.isArray(contacts)) {
                            contacts.forEach(function (c) {
                                var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                                var selected = (batch && batch.supplier_id && String(c.id) === String(batch.supplier_id)) ? ' selected' : '';
                                html += '<option value="' + c.id + '"' + selected + '>' + name + '</option>';
                            });
                        }
                        supplierEl.innerHTML = html;
                        if (batch && batch.supplier_id) supplierEl.value = batch.supplier_id;
                    }
                }
            } catch (e) { console.error('Error loading contacts:', e); }

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        clearForm: function (resetEditState) {
            var form = document.getElementById('newBatchProductForm');
            if (form) form.reset();
            if (resetEditState !== false) {
                _editingOilId = null;
                _editingBatch = null;
            }
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

            var batchNumber = (document.getElementById('newBatchBatchNumber') && document.getElementById('newBatchBatchNumber').value) || null;
            var dateReceived = document.getElementById('newBatchDateReceived') && document.getElementById('newBatchDateReceived').value;
            var productType = document.getElementById('newBatchProductType') && document.getElementById('newBatchProductType').value;
            var quantityKg = parseFloat(document.getElementById('newBatchQuantityKg') && document.getElementById('newBatchQuantityKg').value, 10);
            var deliveryNoteRef = (document.getElementById('newBatchDeliveryNoteRef') && document.getElementById('newBatchDeliveryNoteRef').value) || null;

            if (!dateReceived || !productType || !quantityKg || quantityKg <= 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Received date, product type and quantity (kg) are required.', 'error');
                return;
            }

            var data = {
                batch_number: batchNumber || null,
                date_received: dateReceived,
                delivery_note_ref: deliveryNoteRef,
                supplier_id: supplierId || null,
                supplier_details: supplierDetails || null,
                product_type: productType,
                quantity_kg: quantityKg
            };

            if (_editingOilId && _editingBatch) {
                // Preserve receiving checklist fields so we don't overwrite them
                data.vehicle_clean = _editingBatch.vehicle_clean;
                data.vehicle_enclosed = _editingBatch.vehicle_enclosed;
                data.hazard_substances = _editingBatch.hazard_substances;
                data.pest_infestations = _editingBatch.pest_infestations;
                data.pallets_condition = _editingBatch.pallets_condition;
                data.raw_materials_condition = _editingBatch.raw_materials_condition;
                data.receiving_comments = _editingBatch.receiving_comments;
                data.reference = _editingBatch.reference;
                data.description = _editingBatch.description;
                data.carton_bulk_bags = _editingBatch.carton_bulk_bags != null ? _editingBatch.carton_bulk_bags : 1;
                data.manufactured_date = _editingBatch.manufactured_date;
                data.best_before_date = _editingBatch.best_before_date;
            }

            try {
                if (typeof dataFunctions === 'undefined') {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Data functions not available.' });
                    return;
                }
                var result;
                if (_editingOilId) {
                    if (!dataFunctions.updateSupplierIntakeBatch) {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Update not available.' });
                        return;
                    }
                    data.status = 'intake';
                    result = await dataFunctions.updateSupplierIntakeBatch(_editingOilId, data);
                } else {
                    if (!dataFunctions.createSupplierIntakeBatch) {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Create not available.' });
                        return;
                    }
                    result = await dataFunctions.createSupplierIntakeBatch(data);
                }

                var resolved = result && (result.data !== undefined ? result.data : result);
                if (resolved && resolved.success !== false) {
                    var wasEdit = !!_editingOilId;
                    var newId = (resolved && resolved.id) ? resolved.id : null;
                    _editingOilId = null;
                    _editingBatch = null;
                    var modalEl = document.getElementById(CONTAINER_ID);
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('hide');

                    if (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.loadBatches) await _supplierIntakeGrid.loadBatches(true);

                    if (wasEdit) {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Batch updated.', timer: 2000, showConfirmButton: false });
                    } else {
                        var createdBatchNumber = data.batch_number || (resolved && resolved.batch_id);
                        if (typeof Swal !== 'undefined') {
                            Swal.fire({
                                icon: 'success',
                                title: 'Batch created',
                                text: 'Batch is in intake. Complete the Receiving checklist for this batch, then release to Oil Production when ready.',
                                showDenyButton: true,
                                confirmButtonText: 'OK',
                                denyButtonText: 'Open Receiving checklist'
                            }).then(function (res) {
                                if (res.isDenied && typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.show) {
                                    var batch = (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.batches)
                                        ? _supplierIntakeGrid.batches.find(function (b) {
                                            return (newId && b.id && String(b.id) === String(newId)) ||
                                                (createdBatchNumber && b.batch_number && String(b.batch_number) === String(createdBatchNumber));
                                        })
                                        : (newId ? { id: newId } : null);
                                    _modal_stock_receiving_checklist.show(batch || (newId ? { id: newId } : null));
                                }
                            });
                        }
                    }
                } else {
                    var errMsg = (resolved && (resolved.error || resolved.message)) ? (resolved.error || resolved.message) : 'Failed to save';
                    throw new Error(errMsg);
                }
            } catch (e) {
                console.error('[Supplier Intake] save batch failed:', e);
                var displayMsg = e.message || 'Failed to save batch';
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: displayMsg });
            }
        }
    };
    return api;
})();
_modal_supplier_new_batch.init();
