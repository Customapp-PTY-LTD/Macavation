/**
 * Modal: New oil batch (Supplier Intake). Step 1: upsert batch; Step 2: upsert oil with intake_data.
 * Parent calls show(); modal owns init, show, clearForm, save.
 * Follows company standards: IIFE returning single object, arrow methods, initHandlers, init at end.
 */
var _modalSupplierOilBatch = (function () {
    'use strict';

    var CONTAINER_ID = 'supplierOilBatchModal';
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };

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

    function initFlatpickrInModal() {
        var container = document.getElementById(CONTAINER_ID);
        if (!container || typeof flatpickr === 'undefined') return;
        var inputs = container.querySelectorAll('.flatpickr-date');
        inputs.forEach(function (el) {
            if (el._flatpickr) return;
            flatpickr(el, FLATPICKR_DDMMYYYY);
        });
    }

    function getRadioValue(name) {
        var el = document.querySelector('input[name="' + name + '"]:checked');
        if (!el) return null;
        return el.value === 'true';
    }

    function getDateValue(el) {
        if (!el || !el.value) return null;
        var val = (el.value || '').trim();
        return toISO(val) || (val.indexOf('-') === 4 ? val : null);
    }

    function getIntakeDataFromForm() {
        var supplierEl = document.getElementById('oilIntakeSupplier');
        var supplierName = (supplierEl && supplierEl.options[supplierEl.selectedIndex]) ? supplierEl.options[supplierEl.selectedIndex].text : '';
        if (!supplierName && supplierEl && supplierEl.value) supplierName = supplierEl.value;

        var item = {
            reference_po_number: (document.getElementById('oilIntakeItemRef') && document.getElementById('oilIntakeItemRef').value) ? document.getElementById('oilIntakeItemRef').value.trim() : '',
            description: (document.getElementById('oilIntakeItemDescription') && document.getElementById('oilIntakeItemDescription').value) ? document.getElementById('oilIntakeItemDescription').value.trim() : '',
            batch: (document.getElementById('oilIntakeItemBatch') && document.getElementById('oilIntakeItemBatch').value) ? document.getElementById('oilIntakeItemBatch').value.trim() : '',
            quantity: parseFloat((document.getElementById('oilIntakeItemQuantity') && document.getElementById('oilIntakeItemQuantity').value) ? document.getElementById('oilIntakeItemQuantity').value : 0, 10) || 0
        };
        var carton = document.getElementById('oilIntakeItemCartonBags');
        if (carton && carton.value) item.carton_bulk_bags = carton.value.trim();
        var mfg = document.getElementById('oilIntakeItemMfgDate');
        var bb = document.getElementById('oilIntakeItemBestBefore');
        if (mfg) item.manufactured_date = getDateValue(mfg) || undefined;
        if (bb) item.best_before_date = getDateValue(bb) || undefined;

        var dateEl = document.getElementById('oilIntakeDateReceived');
        var intakeData = {
            date_received: getDateValue(dateEl) || new Date().toISOString().split('T')[0],
            delivery_note_reference: (document.getElementById('oilIntakeDeliveryNoteRef') && document.getElementById('oilIntakeDeliveryNoteRef').value) ? document.getElementById('oilIntakeDeliveryNoteRef').value.trim() : '',
            supplier: supplierName || '',
            items: [item],
            vehicle_checks: {
                is_clean: getRadioValue('oilIntakeVehicleClean') === true,
                is_enclosed: getRadioValue('oilIntakeVehicleEnclosed') === true,
                no_hazards: getRadioValue('oilIntakeNoHazards') === true,
                no_pest: getRadioValue('oilIntakeNoPest') === true,
                pallets_good_condition: getRadioValue('oilIntakePalletsGood') === true,
                raw_materials_good_condition: getRadioValue('oilIntakeRawMaterialsGood') === true
            }
        };
        var detailsEl = document.getElementById('oilIntakeSupplierDetails');
        if (detailsEl && detailsEl.value) intakeData.supplier_details = detailsEl.value.trim();
        return intakeData;
    }

    return {
        init: () => {
            const scope = _modalSupplierOilBatch;
            scope.initHandlers();
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', () => scope.clearForm());
                $(modalEl).on('shown.bs.modal', () => initFlatpickrInModal());
            }
        },

        initHandlers: () => {
            const scope = _modalSupplierOilBatch;
            var saveBtn = document.getElementById('supplierOilBatchSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', (e) => { e.preventDefault(); scope.save(); });
        },

        show: () => {
            const scope = _modalSupplierOilBatch;
            scope.clearForm();
            var todayISO = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('oilIntakeDateReceived');
            if (dateEl) dateEl.value = fromISO(todayISO);

            (function loadSuppliers() {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return;
                dataFunctions.getContacts().then(function (contacts) {
                    var sel = document.getElementById('oilIntakeSupplier');
                    if (!sel) return;
                    var html = '<option value="">Select supplier</option>';
                    if (contacts && Array.isArray(contacts)) {
                        contacts.forEach(function (c) {
                            var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                            html += '<option value="' + (c.id || '') + '">' + name + '</option>';
                        });
                    }
                    sel.innerHTML = html;
                }).catch(function (e) { console.error('Error loading contacts:', e); });
            })();

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        clearForm: () => {
            var form = document.getElementById('supplierOilBatchForm');
            if (form) form.reset();
            var dateEl = document.getElementById('oilIntakeDateReceived');
            if (dateEl) dateEl.value = fromISO(new Date().toISOString().split('T')[0]);
        },

        save: async () => {
            const scope = _modalSupplierOilBatch;
            var form = document.getElementById('supplierOilBatchForm');
            if (!form || !form.checkValidity()) {
                form.reportValidity();
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.upsertBatch || !dataFunctions.upsertOilBatch) {
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Data functions not available.' });
                return;
            }

            try {
                var batchRes = await dataFunctions.upsertBatch({ batch_type: 'oil' });
                var resolved = batchRes && (batchRes.data !== undefined ? batchRes.data : batchRes);
                if (!resolved || resolved.success === false) {
                    throw new Error(resolved && resolved.error ? resolved.error : 'Failed to create batch');
                }
                var batchId = resolved.batch_id;
                var intakeData = getIntakeDataFromForm();

                var oilRes = await dataFunctions.upsertOilBatch({
                    batch_id: batchId,
                    status: 'intake',
                    production_date: intakeData.date_received || null,
                    intake_data: intakeData
                });
                var oilResolved = oilRes && (oilRes.data !== undefined ? oilRes.data : oilRes);
                if (!oilResolved || oilResolved.success === false) {
                    throw new Error(oilResolved && oilResolved.error ? oilResolved.error : 'Failed to save intake data');
                }

                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Oil batch created: ' + batchId, timer: 2500, showConfirmButton: false });
                var modalEl = document.getElementById(CONTAINER_ID);
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('hide');
                if (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.loadBatches) _supplierIntakeGrid.loadBatches(true);
            } catch (e) {
                console.error('[Supplier Oil Batch] save failed:', e);
                var msg = e.message || 'Failed to save';
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: msg });
            }
        }
    };
}());
_modalSupplierOilBatch.init();
