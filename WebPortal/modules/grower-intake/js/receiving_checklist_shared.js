/**
 * Incoming Receiving Checklist - shared logic for Grower Intake and Supplier Intake.
 * Same format as previously on Stock; used on intake pages only.
 */
(function () {
    function forceCloseModal(modalId) {
        var el = document.getElementById(modalId);
        if (!el) return;
        el.classList.remove('show');
        el.style.display = 'none';
        el.setAttribute('aria-hidden', 'true');
        document.querySelectorAll('.modal-backdrop').forEach(function (b) { b.remove(); });
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
        document.body.style.paddingRight = '';
    }

    function clearReceivingForm() {
        if (typeof $ === 'undefined') return;
        $('#receivingChecklistForm')[0].reset();
        $('#receivingId').val('');
        var batchIdEl = document.getElementById('receivingChecklistBatchId');
        if (batchIdEl) batchIdEl.value = '';
        $('#receivedItemsTableBody tr:not(:first)').remove();
        $('#receivedItemsTableBody tr:first input').val('');
        $('#receivedItemsTableBody tr:first input[name="cartonBags"]').val('1');
    }

    function addReceivedItemRow() {
        if (typeof $ === 'undefined') return;
        var newRow = '<tr><td><input type="text" class="form-control form-control-sm" name="reference"></td><td><input type="text" class="form-control form-control-sm" name="description"></td><td><input type="text" class="form-control form-control-sm" name="batch"></td><td><input type="number" class="form-control form-control-sm" name="cartonBags" value="1"></td><td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01"></td><td><input type="date" class="form-control form-control-sm" name="manufacturedDate"></td><td><input type="date" class="form-control form-control-sm" name="bestBeforeDate"></td><td><button type="button" class="btn btn-sm btn-danger removeItemRow"><i class="fas fa-times"></i></button></td></tr>';
        $('#receivedItemsTableBody').append(newRow);
    }

    async function showReceivingChecklistModal(forBatch) {
        if (typeof $ === 'undefined') return;
        var batchIdEl = document.getElementById('receivingChecklistBatchId');
        var forThisBatch = forBatch || (batchIdEl && batchIdEl.value && batchIdEl.value.trim());
        $('#receivingChecklistModalLabel').text(forThisBatch ? 'Incoming Receiving checklist (for this batch)' : 'Incoming Receiving Checklist');
        $('#receivingId').val('');
        if (!forThisBatch) {
            clearReceivingForm();
        } else {
            $('#receivingChecklistForm')[0].reset();
            $('#receivingId').val('');
            $('#receivedItemsTableBody tr:not(:first)').remove();
            $('#receivedItemsTableBody tr:first input').val('');
            $('#receivedItemsTableBody tr:first input[name="cartonBags"]').val('1');
            $('#dateReceived').val(new Date().toISOString().split('T')[0]);
        }
        $('#dateReceived').val(new Date().toISOString().split('T')[0]);
        try {
            var contacts = await dataFunctions.getContacts();
            var select = $('#supplierDetails');
            var html = '<option value="">Select Supplier</option>';
            if (contacts && Array.isArray(contacts)) {
                contacts.forEach(function (c) {
                    var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                    html += '<option value="' + c.id + '">' + name + '</option>';
                });
            }
            select.html(html);
        } catch (e) { console.error('Error loading suppliers:', e); }
        var el = document.getElementById('receivingChecklistModal');
        if (el && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(el).show();
        }
    }
    window.showReceivingChecklistModal = showReceivingChecklistModal;

    function loadReceivingChecklistIntoForm(payload) {
        if (typeof $ === 'undefined' || !payload) return;
        var checklist = payload.checklist || payload;
        var items = payload.received_items || [];
        if (!checklist) return;
        $('#receivingId').val(checklist.id || '');
        $('#dateReceived').val(checklist.date_received || '');
        $('#deliveryNoteRef').val(checklist.delivery_note_ref || '');
        $('#supplierDetails').val(checklist.supplier_id || '');
        $('input[name="vehicleClean"][value="' + (checklist.vehicle_clean || '') + '"]').prop('checked', true);
        $('input[name="vehicleEnclosed"][value="' + (checklist.vehicle_enclosed || '') + '"]').prop('checked', true);
        $('input[name="hazardSubstances"][value="' + (checklist.hazard_substances || '') + '"]').prop('checked', true);
        $('input[name="pestInfestations"][value="' + (checklist.pest_infestations || '') + '"]').prop('checked', true);
        $('input[name="palletsCondition"][value="' + (checklist.pallets_condition || '') + '"]').prop('checked', true);
        $('input[name="rawMaterialsCondition"][value="' + (checklist.raw_materials_condition || '') + '"]').prop('checked', true);
        $('#receivingComments').val(checklist.comments || '');
        $('#receivedItemsTableBody tr:not(:first)').remove();
        var firstRow = $('#receivedItemsTableBody tr:first');
        firstRow.find('input[name="reference"]').val('');
        firstRow.find('input[name="description"]').val('');
        firstRow.find('input[name="batch"]').val('');
        firstRow.find('input[name="cartonBags"]').val('1');
        firstRow.find('input[name="quantity"]').val('');
        firstRow.find('input[name="manufacturedDate"]').val('');
        firstRow.find('input[name="bestBeforeDate"]').val('');
        if (Array.isArray(items) && items.length) {
            items.forEach(function (it, i) {
                if (i === 0) {
                    firstRow.find('input[name="reference"]').val(it.reference || '');
                    firstRow.find('input[name="description"]').val(it.description || '');
                    firstRow.find('input[name="batch"]').val(it.batch || '');
                    firstRow.find('input[name="cartonBags"]').val(it.carton_bags != null ? it.carton_bags : 1);
                    firstRow.find('input[name="quantity"]').val(it.quantity_kg != null ? it.quantity_kg : '');
                    firstRow.find('input[name="manufacturedDate"]').val(it.manufactured_date || '');
                    firstRow.find('input[name="bestBeforeDate"]').val(it.best_before_date || '');
                } else {
                    addReceivedItemRow();
                    var row = $('#receivedItemsTableBody tr').eq(i);
                    row.find('input[name="reference"]').val(it.reference || '');
                    row.find('input[name="description"]').val(it.description || '');
                    row.find('input[name="batch"]').val(it.batch || '');
                    row.find('input[name="cartonBags"]').val(it.carton_bags != null ? it.carton_bags : 1);
                    row.find('input[name="quantity"]').val(it.quantity_kg != null ? it.quantity_kg : '');
                    row.find('input[name="manufacturedDate"]').val(it.manufactured_date || '');
                    row.find('input[name="bestBeforeDate"]').val(it.best_before_date || '');
                }
            });
        }
    }

    async function showReceivingChecklistModalForEdit(checklistId, batchId) {
        if (typeof $ === 'undefined' || !checklistId) return;
        var batchIdEl = document.getElementById('receivingChecklistBatchId');
        if (batchIdEl) batchIdEl.value = batchId || '';
        $('#receivingChecklistModalLabel').text('Incoming Receiving Checklist (edit)');
        try {
            var contacts = await dataFunctions.getContacts();
            var select = $('#supplierDetails');
            var html = '<option value="">Select Supplier</option>';
            if (contacts && Array.isArray(contacts)) {
                contacts.forEach(function (c) {
                    var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                    html += '<option value="' + c.id + '">' + name + '</option>';
                });
            }
            select.html(html);
            var raw = await dataFunctions.getReceivingChecklist(checklistId);
            var payload = (raw && (raw.checklist || raw.received_items !== undefined)) ? raw : (raw && raw.data) ? raw.data : raw;
            if (payload) loadReceivingChecklistIntoForm(payload);
            var el = document.getElementById('receivingChecklistModal');
            if (el && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(el).show();
            }
        } catch (e) {
            console.error('Error loading receiving checklist for edit:', e);
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Could not load checklist: ' + (e.message || e) });
        }
    }
    window.showReceivingChecklistModalForEdit = showReceivingChecklistModalForEdit;

    function closeReceivingChecklistModal() {
        var el = document.getElementById('receivingChecklistModal');
        if (!el) return;
        try {
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(el).hide();
            if (typeof $ !== 'undefined' && $.fn.modal) $('#receivingChecklistModal').modal('hide');
            setTimeout(function () {
                if (el.classList.contains('show')) forceCloseModal('receivingChecklistModal');
            }, 80);
        } catch (e) { forceCloseModal('receivingChecklistModal'); }
    }

    async function saveReceivingChecklist() {
        if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined') return;
        try {
            var form = $('#receivingChecklistForm')[0];
            if (!form.checkValidity()) { form.reportValidity(); return; }
            var receivedItems = [];
            $('#receivedItemsTableBody tr').each(function () {
                var $row = $(this);
                var ref = $row.find('input[name="reference"]').val();
                var desc = $row.find('input[name="description"]').val();
                var batch = $row.find('input[name="batch"]').val();
                var qty = $row.find('input[name="quantity"]').val();
                if (ref || desc || batch || qty) {
                    receivedItems.push({
                        reference: ref || null,
                        description: desc || null,
                        batch: batch || null,
                        carton_bags: $row.find('input[name="cartonBags"]').val() ? parseInt($row.find('input[name="cartonBags"]').val(), 10) : null,
                        quantity_kg: qty ? parseFloat(qty) : null,
                        manufactured_date: $row.find('input[name="manufacturedDate"]').val() || null,
                        best_before_date: $row.find('input[name="bestBeforeDate"]').val() || null
                    });
                }
            });
            var receivingData = {
                p_date_received: $('#dateReceived').val(),
                p_delivery_note_ref: $('#deliveryNoteRef').val(),
                p_supplier_id: $('#supplierDetails').val(),
                p_vehicle_clean: $('input[name="vehicleClean"]:checked').val() || null,
                p_vehicle_enclosed: $('input[name="vehicleEnclosed"]:checked').val() || null,
                p_hazard_substances: $('input[name="hazardSubstances"]:checked').val() || null,
                p_pest_infestations: $('input[name="pestInfestations"]:checked').val() || null,
                p_pallets_condition: $('input[name="palletsCondition"]:checked').val() || null,
                p_raw_materials_condition: $('input[name="rawMaterialsCondition"]:checked').val() || null,
                p_comments: $('#receivingComments').val() || null,
                p_received_items: receivedItems
            };
            var receivingId = $('#receivingId').val();
            var result = receivingId
                ? await dataFunctions.callFunction('update_receiving_checklist', { p_receiving_id: receivingId, p_date_received: receivingData.p_date_received, p_delivery_note_ref: receivingData.p_delivery_note_ref, p_supplier_id: receivingData.p_supplier_id, p_vehicle_clean: receivingData.p_vehicle_clean, p_vehicle_enclosed: receivingData.p_vehicle_enclosed, p_hazard_substances: receivingData.p_hazard_substances, p_pest_infestations: receivingData.p_pest_infestations, p_pallets_condition: receivingData.p_pallets_condition, p_raw_materials_condition: receivingData.p_raw_materials_condition, p_comments: receivingData.p_comments, p_received_items: receivingData.p_received_items })
                : await dataFunctions.callFunction('create_receiving_checklist', receivingData);
            if (result && result.success !== false) {
                if (dataFunctions.clearCachePattern) {
                    dataFunctions.clearCachePattern('receiving_checklists');
                    dataFunctions.clearCachePattern('stock_items');
                    dataFunctions.clearCachePattern('production_batches');
                }
                var batchIdEl = document.getElementById('receivingChecklistBatchId');
                var batchId = batchIdEl && batchIdEl.value ? batchIdEl.value.trim() : null;
                var newId = result.id || result.receiving_id || (result.data && (result.data.id || result.data.receiving_id)) || (result.create_receiving_checklist && (result.create_receiving_checklist.id || result.create_receiving_checklist.receiving_id)) || (result.result && (result.result.id || result.result.receiving_id)) || (Array.isArray(result) && result[0] && (result[0].id || result[0].receiving_id));
                if (!newId && result.data && typeof result.data === 'object') {
                    newId = result.data.id || result.data.receiving_id;
                }
                if (typeof result.body === 'string') {
                    try {
                        var parsed = JSON.parse(result.body);
                        newId = newId || (parsed && (parsed.id || parsed.receiving_id || (parsed.data && (parsed.data.id || parsed.data.receiving_id))));
                    } catch (e) { /* ignore */ }
                }
                if (batchId && newId && !receivingId) {
                    try {
                        console.log('[Receiving checklist] Linking checklist', newId, 'to batch', batchId);
                        await dataFunctions.updateProductionBatch(batchId, { receiving_checklist_id: newId });
                        console.log('[Receiving checklist] Batch updated successfully');
                        if (batchIdEl) batchIdEl.value = '';
                        if (typeof growerIntakeGrid !== 'undefined' && growerIntakeGrid.loadIntakeBatches) growerIntakeGrid.loadIntakeBatches(true);
                    } catch (e) {
                        console.error('[Receiving checklist] Link checklist to batch failed', e);
                        var msg = 'Receiving checklist was saved but could not be linked to the batch.';
                        if (e && (e.message || '').toLowerCase().indexOf('forbidden') >= 0 || (e.status === 403)) {
                            msg = 'Checklist saved but permission denied when linking to batch. Your role may need EXECUTE on update_production_batch (see BluePrint/RBAC_GUIDE.md).';
                        }
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Checklist saved', text: msg, timer: 5000, showConfirmButton: true });
                    }
                } else if (!batchId && !receivingId) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: 'Checklist saved', text: 'To get the tick on a batch, open the checklist by clicking the empty box next to that batch row, then save.', timer: 5000, showConfirmButton: true });
                } else if (batchId && !receivingId && !newId) {
                    console.warn('[Receiving checklist] Saved but id missing in response – cannot link to batch. Full response:', JSON.stringify(result));
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'warning', title: 'Checklist saved, tick not updated', text: 'The checklist was saved but the batch link failed (no id in API response). Open the browser console (F12) and look for "[Receiving checklist]" to see the response shape. The API must return { success: true, id: "<uuid>" } from create_receiving_checklist.', timer: 8000, showConfirmButton: true });
                }
                if (batchIdEl) batchIdEl.value = '';
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: receivingId ? 'Receiving checklist updated.' : 'Receiving checklist created.', timer: 2000, showConfirmButton: false });
                if (typeof growerIntakeGrid !== 'undefined' && growerIntakeGrid.loadIntakeBatches) growerIntakeGrid.loadIntakeBatches(true);
                closeReceivingChecklistModal();
            } else {
                throw new Error(result && (result.error || result.message)) || 'Failed to save';
            }
        } catch (error) {
            console.error('Error saving receiving checklist:', error);
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save: ' + (error.message || error) });
        }
    }

    function init() {
        $(document).on('click', '#receivingChecklistBtn', function (e) { e.preventDefault(); showReceivingChecklistModal(); });
        $(document).on('click', '#saveReceivingChecklistBtn', function (e) { e.preventDefault(); saveReceivingChecklist(); });
        $(document).on('click', '#addReceivedItemRow', function (e) { e.preventDefault(); addReceivedItemRow(); });
        $(document).on('click', '.removeItemRow', function (e) { e.preventDefault(); $(this).closest('tr').remove(); });
        $(document).on('hidden.bs.modal', '#receivingChecklistModal', clearReceivingForm);
        var modal = document.getElementById('receivingChecklistModal');
        if (modal) {
            var closeBtn = modal.querySelector('.modal-header .btn-close');
            var cancelBtn = modal.querySelector('.modal-footer button[data-bs-dismiss="modal"]');
            if (closeBtn) closeBtn.addEventListener('click', closeReceivingChecklistModal);
            if (cancelBtn) cancelBtn.addEventListener('click', closeReceivingChecklistModal);
        }
    }

    if (typeof $ !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
        else init();
    }
})();
