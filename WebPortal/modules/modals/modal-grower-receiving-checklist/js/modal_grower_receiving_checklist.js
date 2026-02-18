/**
 * Modal: Grower Intake Receiving Checklist (with batch linking).
 * Parent calls show(batchId) or show(batchId, checklistId) for edit.
 * Uses container id: growerReceivingChecklistModal
 */
var _modal_grower_receiving_checklist = (function () {
    'use strict';

    var CONTAINER_ID = 'growerReceivingChecklistModal';

    var api = {
        init: function () {
            var scope = api;
            var saveBtn = document.getElementById('growerSaveReceivingChecklistBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); scope.save(); });
            var addRowBtn = document.getElementById('growerAddReceivedItemRow');
            if (addRowBtn) addRowBtn.addEventListener('click', function () { scope.addReceivedItemRow(); });
            $(document).on('click', '.growerRemoveItemRow', function () { $(this).closest('tr').remove(); });
            var container = document.getElementById(CONTAINER_ID);
            if (container && typeof $ !== 'undefined') {
                $(container).on('hidden.bs.modal', function () { scope.clearForm(); });
            }
        },

        show: async function (batchId, checklistId) {
            var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');
            if (batchIdEl) batchIdEl.value = batchId || '';

            var labelEl = document.getElementById('growerReceivingChecklistModalLabel');
            if (labelEl) {
                labelEl.textContent = checklistId ? 'Incoming Receiving Checklist (edit)' : (batchId ? 'Incoming Receiving checklist (for this batch)' : 'Incoming Receiving Checklist');
            }

            api.clearForm();
            if (batchIdEl) batchIdEl.value = batchId || '';

            var receivingIdEl = document.getElementById('growerReceivingId');
            if (receivingIdEl) receivingIdEl.value = '';

            var today = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('growerDateReceived');
            if (dateEl) dateEl.value = today;

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getContacts) {
                    var contacts = await dataFunctions.getContacts();
                    var select = document.getElementById('growerSupplierDetails');
                    if (select) {
                        var html = '<option value="">Select Supplier</option>';
                        if (contacts && Array.isArray(contacts)) {
                            contacts.forEach(function (c) {
                                var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                                html += '<option value="' + c.id + '">' + name + '</option>';
                            });
                        }
                        select.innerHTML = html;
                    }
                }
            } catch (err) {
                console.error('Error loading suppliers:', err);
            }

            if (checklistId) {
                try {
                    var raw = await dataFunctions.getReceivingChecklist(checklistId);
                    var payload = (raw && (raw.checklist || raw.received_items !== undefined)) ? raw : (raw && raw.data) ? raw.data : raw;
                    if (payload) api.loadIntoForm(payload);
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

        loadIntoForm: function (payload) {
            if (typeof $ === 'undefined' || !payload) return;
            var checklist = payload.checklist || payload;
            var items = payload.received_items || [];
            if (!checklist) return;

            document.getElementById('growerReceivingId').value = checklist.id || '';
            document.getElementById('growerDateReceived').value = checklist.date_received || '';
            document.getElementById('growerDeliveryNoteRef').value = checklist.delivery_note_ref || '';
            document.getElementById('growerSupplierDetails').value = checklist.supplier_id || '';
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
            firstRow.find('input[name="growerReference"]').val('');
            firstRow.find('input[name="growerDescription"]').val('');
            firstRow.find('input[name="growerBatch"]').val('');
            firstRow.find('input[name="growerCartonBags"]').val('1');
            firstRow.find('input[name="growerQuantity"]').val('');
            firstRow.find('input[name="growerManufacturedDate"]').val('');
            firstRow.find('input[name="growerBestBeforeDate"]').val('');

            if (Array.isArray(items) && items.length) {
                items.forEach(function (it, i) {
                    if (i === 0) {
                        firstRow.find('input[name="growerReference"]').val(it.reference || '');
                        firstRow.find('input[name="growerDescription"]').val(it.description || '');
                        firstRow.find('input[name="growerBatch"]').val(it.batch || '');
                        firstRow.find('input[name="growerCartonBags"]').val(it.carton_bags != null ? it.carton_bags : 1);
                        firstRow.find('input[name="growerQuantity"]').val(it.quantity_kg != null ? it.quantity_kg : '');
                        firstRow.find('input[name="growerManufacturedDate"]').val(it.manufactured_date || '');
                        firstRow.find('input[name="growerBestBeforeDate"]').val(it.best_before_date || '');
                    } else {
                        api.addReceivedItemRow();
                        var row = $('#growerReceivedItemsTableBody tr').eq(i);
                        row.find('input[name="growerReference"]').val(it.reference || '');
                        row.find('input[name="growerDescription"]').val(it.description || '');
                        row.find('input[name="growerBatch"]').val(it.batch || '');
                        row.find('input[name="growerCartonBags"]').val(it.carton_bags != null ? it.carton_bags : 1);
                        row.find('input[name="growerQuantity"]').val(it.quantity_kg != null ? it.quantity_kg : '');
                        row.find('input[name="growerManufacturedDate"]').val(it.manufactured_date || '');
                        row.find('input[name="growerBestBeforeDate"]').val(it.best_before_date || '');
                    }
                });
            }
        },

        clearForm: function () {
            if (typeof $ === 'undefined') return;
            var form = document.getElementById('growerReceivingChecklistForm');
            if (form) form.reset();
            document.getElementById('growerReceivingId').value = '';
            var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');
            if (batchIdEl) batchIdEl.value = '';
            $('#growerReceivedItemsTableBody tr:not(:first)').remove();
            $('#growerReceivedItemsTableBody tr:first input').val('');
            $('#growerReceivedItemsTableBody tr:first input[name="growerCartonBags"]').val('1');
        },

        addReceivedItemRow: function () {
            if (typeof $ === 'undefined') return;
            var newRow = '<tr><td><input type="text" class="form-control form-control-sm" name="growerReference"></td><td><input type="text" class="form-control form-control-sm" name="growerDescription"></td><td><input type="text" class="form-control form-control-sm" name="growerBatch"></td><td><input type="number" class="form-control form-control-sm" name="growerCartonBags" value="1"></td><td><input type="number" class="form-control form-control-sm" name="growerQuantity" step="0.01"></td><td><input type="date" class="form-control form-control-sm" name="growerManufacturedDate"></td><td><input type="date" class="form-control form-control-sm" name="growerBestBeforeDate"></td><td><button type="button" class="btn btn-sm btn-danger growerRemoveItemRow"><i class="fas fa-times"></i></button></td></tr>';
            $('#growerReceivedItemsTableBody').append(newRow);
        },

        hide: function () {
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') {
                var inst = bootstrap.Modal.getInstance(modalEl);
                if (inst) inst.hide();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#' + CONTAINER_ID).modal('hide');
            }
        },

        save: async function () {
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
                    var ref = $row.find('input[name="growerReference"]').val();
                    var desc = $row.find('input[name="growerDescription"]').val();
                    var batch = $row.find('input[name="growerBatch"]').val();
                    var qty = $row.find('input[name="growerQuantity"]').val();
                    if (ref || desc || batch || qty) {
                        receivedItems.push({
                            reference: ref || null,
                            description: desc || null,
                            batch: batch || null,
                            carton_bags: $row.find('input[name="growerCartonBags"]').val() ? parseInt($row.find('input[name="growerCartonBags"]').val(), 10) : null,
                            quantity_kg: qty ? parseFloat(qty) : null,
                            manufactured_date: $row.find('input[name="growerManufacturedDate"]').val() || null,
                            best_before_date: $row.find('input[name="growerBestBeforeDate"]').val() || null
                        });
                    }
                });

                var receivingData = {
                    p_date_received: $('#growerDateReceived').val(),
                    p_delivery_note_ref: $('#growerDeliveryNoteRef').val(),
                    p_supplier_id: $('#growerSupplierDetails').val(),
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
                    api.hide();
                } else {
                    throw new Error(result && (result.error || result.message)) || 'Failed to save';
                }
            } catch (error) {
                console.error('Error saving receiving checklist:', error);
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save: ' + (error.message || error) });
            }
        }
    };
    return api;
})();
