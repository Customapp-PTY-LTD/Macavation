/**
 * Modal: Grower Intake Receiving Checklist (with batch linking).
 * Parent calls show(batchId) or show(batchId, checklistId) for edit.
 * Uses container id: growerReceivingChecklistModal.
 * Date inputs use Flatpickr (dd/mm/yyyy); API expects ISO (yyyy-mm-dd).
 */
var _modal_grower_receiving_checklist = (function () {
    'use strict';

    var CONTAINER_ID = 'growerReceivingChecklistModal';
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

    return {
        init: () => {
            const scope = _modal_grower_receiving_checklist;
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_grower_receiving_checklist;
            var saveBtn = document.getElementById('growerSaveReceivingChecklistBtn');
            if (saveBtn) saveBtn.addEventListener('click', (e) => { e.preventDefault(); scope.save(); });
            var addRowBtn = document.getElementById('growerAddReceivedItemRow');
            if (addRowBtn) addRowBtn.addEventListener('click', () => scope.addReceivedItemRow());
            $(document).on('click', '.growerRemoveItemRow', function () { $(this).closest('tr').remove(); });
            $(document).on('change', '#' + CONTAINER_ID + ' select[name="growerDescription"]', function () {
                var val = $(this).val();
                var titleText = val === 'NIS' ? 'Harvested Date' : val === 'Kernel' ? 'Manufactured Date' : 'Manufactured Date or Harvested Date';
                $(this).closest('tr').find('input[name="growerManufacturedDate"]').attr('title', titleText);
            });
            var container = document.getElementById(CONTAINER_ID);
            if (container && typeof $ !== 'undefined') {
                $(container).on('shown.bs.modal', () => initFlatpickrInModal());
                $(container).on('hidden.bs.modal', () => scope.clearForm());
            }
        },

        show: async (batchId, checklistId) => {
            const scope = _modal_grower_receiving_checklist;
            var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');
            if (batchIdEl) batchIdEl.value = batchId || '';

            var labelEl = document.getElementById('growerReceivingChecklistModalLabel');
            if (labelEl) labelEl.textContent = 'Receiving Checklist';

            scope.clearForm();
            if (batchIdEl) batchIdEl.value = batchId || '';

            var receivingIdEl = document.getElementById('growerReceivingId');
            if (receivingIdEl) receivingIdEl.value = '';

            var todayISO = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('growerDateReceived');
            if (dateEl) dateEl.value = fromISO(todayISO);

            var supplierIdEl = document.getElementById('growerReceivingChecklistSupplierId');
            if (supplierIdEl) supplierIdEl.value = '';
            if (batchId && typeof dataFunctions !== 'undefined' && dataFunctions.getProductionBatches) {
                try {
                    var batches = await dataFunctions.getProductionBatches(null, false, { batch_type: 'kernel' });
                    var batch = (batches || []).find(function (b) { return b.id === batchId; });
                    if (batch && batch.supplier_id && supplierIdEl) supplierIdEl.value = batch.supplier_id;
                } catch (err) {
                    console.error('Error loading batch for supplier:', err);
                }
            }

            if (checklistId) {
                try {
                    var raw = await dataFunctions.getReceivingChecklist(checklistId);
                    var payload = (raw && (raw.checklist || raw.received_items !== undefined)) ? raw : (raw && raw.data) ? raw.data : raw;
                    if (payload) scope.loadIntoForm(payload);
                } catch (e) {
                    console.error('Error loading receiving checklist for edit:', e);
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Could not load checklist: ' + (e.message || e) });
                    return;
                }
            }

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        loadIntoForm: (payload) => {
            const scope = _modal_grower_receiving_checklist;
            if (typeof $ === 'undefined' || !payload) return;
            var checklist = payload.checklist || payload;
            var items = payload.received_items || [];
            if (!checklist) return;

            document.getElementById('growerReceivingId').value = checklist.id || '';
            document.getElementById('growerDateReceived').value = fromISO(checklist.date_received || '');
            document.getElementById('growerDeliveryNoteRef').value = checklist.delivery_note_ref || '';
            var supplierIdEl = document.getElementById('growerReceivingChecklistSupplierId');
            if (supplierIdEl) supplierIdEl.value = checklist.supplier_id || '';
            $('input[name="growerVehicleClean"][value="' + (checklist.vehicle_clean || '') + '"]').prop('checked', true);
            $('input[name="growerVehicleEnclosed"][value="' + (checklist.vehicle_enclosed || '') + '"]').prop('checked', true);
            $('input[name="growerHazardSubstances"][value="' + (checklist.hazard_substances || '') + '"]').prop('checked', true);
            $('input[name="growerPestInfestations"][value="' + (checklist.pest_infestations || '') + '"]').prop('checked', true);
            $('input[name="growerPalletsCondition"][value="' + (checklist.pallets_condition || '') + '"]').prop('checked', true);
            $('input[name="growerRawMaterialsCondition"][value="' + (checklist.raw_materials_condition || '') + '"]').prop('checked', true);
            document.getElementById('growerReceivingComments').value = checklist.comments || '';

            var tbody = $('#growerReceivedItemsTableBody');
            tbody.find('tr:not(:first)').remove();
            var firstRow = tbody.find('tr:first');
            firstRow.find('select[name="growerDescription"]').val('');
            firstRow.find('input[name="growerQuantity"]').val('');
            firstRow.find('input[name="growerManufacturedDate"]').val('');

            if (Array.isArray(items) && items.length) {
                items.forEach(function (it, i) {
                    if (i === 0) {
                        firstRow.find('select[name="growerDescription"]').val(it.description || '');
                        firstRow.find('input[name="growerQuantity"]').val(it.quantity_kg != null ? it.quantity_kg : '');
                        firstRow.find('input[name="growerManufacturedDate"]').val(fromISO(it.manufactured_date || ''));
                        var titleText = it.description === 'NIS' ? 'Harvested Date' : it.description === 'Kernel' ? 'Manufactured Date' : 'Manufactured Date or Harvested Date';
                        firstRow.find('input[name="growerManufacturedDate"]').attr('title', titleText);
                    } else {
                        scope.appendReceivedItemRow(it.description || '', it.quantity_kg != null ? it.quantity_kg : '', fromISO(it.manufactured_date || ''));
                    }
                });
            }
        },

        clearForm: () => {
            if (typeof $ === 'undefined') return;
            var form = document.getElementById('growerReceivingChecklistForm');
            if (form) form.reset();
            document.getElementById('growerReceivingId').value = '';
            var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');
            if (batchIdEl) batchIdEl.value = '';
            var supplierIdEl = document.getElementById('growerReceivingChecklistSupplierId');
            if (supplierIdEl) supplierIdEl.value = '';
            $('#growerReceivedItemsTableBody tr:not(:first)').remove();
            $('#growerReceivedItemsTableBody tr:first select[name="growerDescription"]').val('');
            $('#growerReceivedItemsTableBody tr:first input').val('');
        },

        addReceivedItemRow: () => {
            const scope = _modal_grower_receiving_checklist;
            if (typeof $ === 'undefined' || typeof Swal === 'undefined') return;
            var todayPlaceholder = getTodayPlaceholder();
            var lastRow = $('#growerReceivedItemsTableBody tr:last');
            var lastDescription = lastRow.length ? (lastRow.find('select[name="growerDescription"]').val() || '') : '';
            var lastDate = lastRow.length ? (lastRow.find('input[name="growerManufacturedDate"]').val() || '') : '';
            Swal.fire({
                title: 'Add Bag',
                html: '<label class="form-label">Weight (Kgs)</label><input id="growerAddBagWeight" type="number" step="0.01" class="form-control mb-2" placeholder="Weight (Kgs)">' +
                    '<label class="form-label">Description</label><select id="growerAddBagDescription" class="form-select mb-2"><option value="">Select</option><option value="NIS">NIS</option><option value="Kernel">Kernel</option></select>' +
                    '<label id="growerAddBagDateLabel" class="form-label">Harvested Date</label><input id="growerAddBagDate" type="text" class="form-control flatpickr-date" placeholder="' + todayPlaceholder + '">',
                showCancelButton: true,
                confirmButtonText: 'Add',
                focusConfirm: false,
                preConfirm: () => {
                    var weightEl = document.getElementById('growerAddBagWeight');
                    var descEl = document.getElementById('growerAddBagDescription');
                    var dateEl = document.getElementById('growerAddBagDate');
                    var weight = weightEl ? weightEl.value : '';
                    var desc = descEl ? descEl.value : '';
                    var dateVal = dateEl ? dateEl.value : '';
                    if (!weight || !desc) {
                        Swal.showValidationMessage('Please enter Weight (Kgs) and select Description.');
                        return false;
                    }
                    return { weight: weight, description: desc, date: dateVal };
                },
                didOpen: () => {
                    /* Deactivate Bootstrap 5 modal focus trap so user can click/type in SweetAlert Weight field */
                    var modalEl = document.getElementById(CONTAINER_ID);
                    if (modalEl && typeof bootstrap !== 'undefined') {
                        var modalInst = bootstrap.Modal.getInstance(modalEl);
                        if (modalInst && modalInst._focustrap) modalInst._focustrap.deactivate();
                    }
                    var descEl = document.getElementById('growerAddBagDescription');
                    var labelEl = document.getElementById('growerAddBagDateLabel');
                    var dateEl = document.getElementById('growerAddBagDate');
                    var weightEl = document.getElementById('growerAddBagWeight');
                    if (descEl) {
                        descEl.value = lastDescription || '';
                        if (labelEl) labelEl.textContent = lastDescription === 'NIS' ? 'Harvested Date' : lastDescription === 'Kernel' ? 'Manufactured Date' : 'Date';
                    }
                    if (dateEl) dateEl.value = lastDate || '';
                    if (descEl && labelEl) {
                        descEl.addEventListener('change', function () {
                            labelEl.textContent = this.value === 'NIS' ? 'Harvested Date' : this.value === 'Kernel' ? 'Manufactured Date' : 'Date';
                        });
                    }
                    if (dateEl && typeof flatpickr !== 'undefined' && !dateEl._flatpickr) flatpickr(dateEl, FLATPICKR_DDMMYYYY);
                    if (weightEl) setTimeout(function () { weightEl.focus(); }, 100);
                }
            }).then(function (result) {
                /* Reactivate Bootstrap 5 modal focus trap after Add Bag dialog closes */
                var modalEl = document.getElementById(CONTAINER_ID);
                if (modalEl && typeof bootstrap !== 'undefined') {
                    var modalInst = bootstrap.Modal.getInstance(modalEl);
                    if (modalInst && modalInst._focustrap) modalInst._focustrap.activate();
                }
                if (result && result.isConfirmed && result.value) {
                    scope.appendReceivedItemRow(result.value.description, result.value.weight, result.value.date);
                }
            });
        },

        appendReceivedItemRow: (description, quantityKg, dateStr) => {
            if (typeof $ === 'undefined') return;
            var todayPlaceholder = getTodayPlaceholder();
            var descSelected = description === 'NIS' ? ' selected' : '';
            var kernelSelected = description === 'Kernel' ? ' selected' : '';
            var titleText = description === 'NIS' ? 'Harvested Date' : description === 'Kernel' ? 'Manufactured Date' : 'Manufactured Date or Harvested Date';
            var newRow = '<tr><td class="align-middle"><select class="form-select form-select-sm" name="growerDescription"><option value="">Select</option><option value="NIS"' + descSelected + '>NIS</option><option value="Kernel"' + kernelSelected + '>Kernel</option></select></td><td class="align-middle"><input type="number" class="form-control form-control-sm" name="growerQuantity" step="0.01" value="' + (quantityKg ? String(quantityKg).replace(/"/g, '&quot;') : '') + '"></td><td class="align-middle"><input type="text" class="form-control form-control-sm flatpickr-date" name="growerManufacturedDate" placeholder="' + todayPlaceholder + '" value="' + (dateStr ? String(dateStr).replace(/"/g, '&quot;') : '') + '" title="' + titleText.replace(/"/g, '&quot;') + '"></td><td class="align-middle"><button type="button" class="btn btn-sm btn-danger growerRemoveItemRow"><i class="fas fa-times"></i></button></td></tr>';
            var $row = $(newRow).appendTo('#growerReceivedItemsTableBody');
            $row.find('.flatpickr-date').each(function () {
                if (typeof flatpickr !== 'undefined' && !this._flatpickr) flatpickr(this, FLATPICKR_DDMMYYYY);
            });
        },

        hide: () => {
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') {
                var inst = bootstrap.Modal.getInstance(modalEl);
                if (inst) inst.hide();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#' + CONTAINER_ID).modal('hide');
            }
        },

        save: async () => {
            const scope = _modal_grower_receiving_checklist;
            try {
                if (typeof dataFunctions === 'undefined') return;

                var form = document.getElementById('growerReceivingChecklistForm');
                if (form && !form.checkValidity()) {
                    form.reportValidity();
                    return;
                }

                var receivedItems = [];
                $('#growerReceivedItemsTableBody tr').each(function () {
                    var $row = $(this);
                    var desc = $row.find('select[name="growerDescription"]').val() || $row.find('input[name="growerDescription"]').val();
                    var qty = $row.find('input[name="growerQuantity"]').val();
                    if (desc || qty) {
                        receivedItems.push({
                            description: desc || null,
                            quantity_kg: qty ? parseFloat(qty) : null,
                            manufactured_date: toISO($row.find('input[name="growerManufacturedDate"]').val()) || null
                        });
                    }
                });

                var dateReceivedVal = $('#growerDateReceived').val();
                var supplierIdVal = $('#growerReceivingChecklistSupplierId').val();
                var receivingData = {
                    p_date_received: toISO(dateReceivedVal) || dateReceivedVal,
                    p_delivery_note_ref: $('#growerDeliveryNoteRef').val(),
                    p_supplier_id: supplierIdVal || null,
                    p_vehicle_clean: $('input[name="growerVehicleClean"]:checked').val() || null,
                    p_vehicle_enclosed: $('input[name="growerVehicleEnclosed"]:checked').val() || null,
                    p_hazard_substances: $('input[name="growerHazardSubstances"]:checked').val() || null,
                    p_pest_infestations: $('input[name="growerPestInfestations"]:checked').val() || null,
                    p_pallets_condition: $('input[name="growerPalletsCondition"]:checked').val() || null,
                    p_raw_materials_condition: $('input[name="growerRawMaterialsCondition"]:checked').val() || null,
                    p_comments: $('#growerReceivingComments').val() || null,
                    p_received_items: receivedItems
                };

                var receivingId = $('#growerReceivingId').val();
                var result = receivingId
                    ? await dataFunctions.callFunction('update_receiving_checklist', {
                        p_receiving_id: receivingId,
                        p_date_received: receivingData.p_date_received,
                        p_delivery_note_ref: receivingData.p_delivery_note_ref,
                        p_supplier_id: receivingData.p_supplier_id,
                        p_vehicle_clean: receivingData.p_vehicle_clean,
                        p_vehicle_enclosed: receivingData.p_vehicle_enclosed,
                        p_hazard_substances: receivingData.p_hazard_substances,
                        p_pest_infestations: receivingData.p_pest_infestations,
                        p_pallets_condition: receivingData.p_pallets_condition,
                        p_raw_materials_condition: receivingData.p_raw_materials_condition,
                        p_comments: receivingData.p_comments,
                        p_received_items: receivingData.p_received_items
                    })
                    : await dataFunctions.callFunction('create_receiving_checklist', receivingData);

                if (result && result.success !== false) {
                    if (dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('receiving_checklists');
                        dataFunctions.clearCachePattern('stock_items');
                        dataFunctions.clearCachePattern('production_batches');
                    }

                    var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');
                    var batchId = batchIdEl && batchIdEl.value ? batchIdEl.value.trim() : null;
                    var newId = result.id || result.receiving_id || (result.data && (result.data.id || result.data.receiving_id)) || (result.create_receiving_checklist && (result.create_receiving_checklist.id || result.create_receiving_checklist.receiving_id)) || (result.result && (result.result.id || result.result.receiving_id));

                    if (batchId && newId && !receivingId) {
                        try {
                            await dataFunctions.updateProductionBatch(batchId, { receiving_checklist_id: newId });
                            if (batchIdEl) batchIdEl.value = '';
                        } catch (e) {
                            console.error('[Grower Receiving Checklist] Link checklist to batch failed', e);
                            var msg = 'Receiving checklist was saved but could not be linked to the batch.';
                            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Checklist saved', text: msg, timer: 5000, showConfirmButton: true });
                        }
                    } else if (batchId && !receivingId && !newId) {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Checklist saved, tick not updated', text: 'The checklist was saved but the batch link failed (no id in API response).', timer: 5000, showConfirmButton: true });
                    }

                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: receivingId ? 'Receiving checklist updated.' : 'Receiving checklist created.', timer: 2000, showConfirmButton: false });
                    if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.loadIntakeBatches) _growerIntakeGrid.loadIntakeBatches(true);
                    scope.hide();
                } else {
                    throw new Error(result && (result.error || result.message)) || 'Failed to save';
                }
            } catch (error) {
                console.error('Error saving receiving checklist:', error);
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save: ' + (error.message || error) });
            }
        }
    };
})();
_modal_grower_receiving_checklist.init();
