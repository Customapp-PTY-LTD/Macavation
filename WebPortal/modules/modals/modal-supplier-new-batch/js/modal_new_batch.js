/**
 * Modal: New batch of product (Supplier Intake). Parent calls show() or show(batch) for edit.
 * Modal owns init, show, clearForm, save. Date inputs use Flatpickr (dd/mm/yyyy); API expects ISO (yyyy-mm-dd).
 */
var _modal_supplier_new_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'newBatchProductModal';
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var _editingOilId = null;

    function toISO(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return null;
        dateStr = dateStr.trim();
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(dateStr)) return dateStr.indexOf('-') === 4 ? dateStr : null;
        var parts = dateStr.split('/');
        return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
    }

    function fromISO(isoStr) {
        if (!isoStr) return '';
        var s = typeof isoStr === 'string' ? isoStr.trim() : String(isoStr);
        if (s.indexOf('T') >= 0) s = s.split('T')[0];
        var parts = s.split('-');
        if (parts.length !== 3) return s;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    function getTodayPlaceholder() {
        return fromISO(new Date().toISOString().split('T')[0]);
    }

    function initFlatpickrInModal() {
        var container = document.getElementById(CONTAINER_ID);
        if (!container || typeof flatpickr === 'undefined') return;
        var todayPlaceholder = getTodayPlaceholder();
        var inputs = container.querySelectorAll('.flatpickr-date');
        inputs.forEach(function (el) {
            if (!el.placeholder) el.placeholder = todayPlaceholder;
            if (el._flatpickr) return;
            flatpickr(el, FLATPICKR_DDMMYYYY);
        });
    }

    function getRadioValue(name) {
        var el = document.querySelector('input[name="' + name + '"]:checked');
        return el ? el.value : null;
    }

    function getDateValue(el) {
        if (!el || !el.value) return null;
        var val = el.value.trim();
        return toISO(val) || (val.indexOf('-') === 4 ? val : null);
    }

    function setRadioValue(name, value) {
        if (value === undefined || value === null) return;
        var normalized = (value === true || value === 'true' || value === 'Yes') ? 'Yes' : (value === false || value === 'false' || value === 'No' ? 'No' : String(value));
        var el = document.querySelector('input[name="' + name + '"][value="' + normalized + '"]');
        if (el) el.checked = true;
    }

    function setModalTitle(title) {
        var label = document.getElementById('newBatchProductModalLabel');
        if (label) label.textContent = title;
    }

    function prefillForm(batch) {
        if (!batch) return;
        var set = function (id, value) {
            var el = document.getElementById(id);
            if (el && value != null && value !== '') el.value = value;
        };
        set('newBatchProductType', batch.product_type || '');
        set('newBatchDateReceived', batch.date_received ? fromISO(String(batch.date_received).split('T')[0]) : '');
        set('newBatchDeliveryNoteRef', batch.delivery_note_ref || '');
        set('newBatchSupplier', batch.supplier_id || '');
        set('newBatchReference', batch.reference || '');
        set('newBatchDescription', batch.description || '');
        set('newBatchBatchNumber', batch.batch_number || '');
        set('newBatchCartonBags', batch.carton_bulk_bags != null ? String(batch.carton_bulk_bags) : '1');
        set('newBatchQuantityKg', batch.quantity_kg != null ? String(batch.quantity_kg) : '');
        set('newBatchManufacturedDate', batch.manufactured_date ? fromISO(String(batch.manufactured_date).split('T')[0]) : '');
        set('newBatchBestBeforeDate', batch.best_before_date ? fromISO(String(batch.best_before_date).split('T')[0]) : '');
        set('newBatchReceivingComments', batch.receiving_comments || '');
        setRadioValue('newBatchVehicleClean', batch.vehicle_clean);
        setRadioValue('newBatchVehicleEnclosed', batch.vehicle_enclosed);
        setRadioValue('newBatchHazardSubstances', batch.hazard_substances);
        setRadioValue('newBatchPestInfestations', batch.pest_infestations);
        setRadioValue('newBatchPalletsCondition', batch.pallets_condition);
        setRadioValue('newBatchRawMaterialsCondition', batch.raw_materials_condition);
    }

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveNewBatchProductBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
                $(modalEl).on('shown.bs.modal', function () { initFlatpickrInModal(); });
            }
        },

        show: async function (batch) {
            _editingOilId = (batch && batch.id) ? batch.id : null;
            api.clearForm(false);
            if (_editingOilId && batch) {
                setModalTitle('Edit batch');
                prefillForm(batch);
            } else {
                setModalTitle('New batch of product');
                var todayISO = new Date().toISOString().split('T')[0];
                var dateEl = document.getElementById('newBatchDateReceived');
                if (dateEl) dateEl.value = fromISO(todayISO);
            }

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getContacts) {
                    var contacts = await dataFunctions.getContacts();
                    var sel = document.getElementById('newBatchSupplier');
                    if (sel) {
                        var html = '<option value="">Select supplier</option>';
                        if (contacts && Array.isArray(contacts)) {
                            contacts.forEach(function (c) {
                                var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                                var selected = (batch && batch.supplier_id && String(c.id) === String(batch.supplier_id)) ? ' selected' : '';
                                html += '<option value="' + c.id + '"' + selected + '>' + name + '</option>';
                            });
                        }
                        sel.innerHTML = html;
                        if (batch && batch.supplier_id) sel.value = batch.supplier_id;
                    }
                }
            } catch (e) { console.error('Error loading contacts:', e); }

            var modalEl = document.getElementById('newBatchProductModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#newBatchProductModal').modal('show');
        },

        clearForm: function (resetEditState) {
            var form = document.getElementById('newBatchProductForm');
            if (form) form.reset();
            var cartonEl = document.getElementById('newBatchCartonBags');
            if (cartonEl) cartonEl.value = '1';
            var todayISO = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('newBatchDateReceived');
            if (dateEl) dateEl.value = fromISO(todayISO);
            if (resetEditState !== false) _editingOilId = null;
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

            var dateReceivedEl = document.getElementById('newBatchDateReceived');
            var manufacturedEl = document.getElementById('newBatchManufacturedDate');
            var bestBeforeEl = document.getElementById('newBatchBestBeforeDate');
            var data = {
                product_type: document.getElementById('newBatchProductType').value,
                date_received: getDateValue(dateReceivedEl) || (dateReceivedEl && dateReceivedEl.value ? dateReceivedEl.value : null),
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
                manufactured_date: getDateValue(manufacturedEl) || (manufacturedEl && manufacturedEl.value ? manufacturedEl.value : null),
                best_before_date: getDateValue(bestBeforeEl) || (bestBeforeEl && bestBeforeEl.value ? bestBeforeEl.value : null)
            };

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
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Data functions not available.' });
                        return;
                    }
                    result = await dataFunctions.createSupplierIntakeBatch(data);
                }
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({
                        icon: 'success',
                        title: 'Saved',
                        text: _editingOilId ? 'Batch updated.' : 'Batch added to supplier intake.',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    _editingOilId = null;
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
                console.error('[Supplier Intake] save batch failed:', e);
                var displayMsg = e.message || 'Failed to save batch';
                if (e.responseText) displayMsg += ' (' + String(e.responseText).substring(0, 200) + ')';
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: displayMsg });
            }
        }
    };
    return api;
})();
_modal_supplier_new_batch.init();
