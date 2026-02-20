/**
 * Modal: Incoming Receiving Checklist. Parent calls show().
 */
var _modal_stock_receiving_checklist = (function () {
    'use strict';
    var api = {
        init: function () {
            var scope = api;
            var saveBtn = document.getElementById('saveReceivingChecklistBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); scope.saveReceivingChecklist(); });
            var addRowBtn = document.getElementById('addReceivedItemRow');
            if (addRowBtn) addRowBtn.addEventListener('click', function () { scope.addReceivedItemRow(); });
            $(document).on('click', '.removeItemRow', function () { $(this).closest('tr').remove(); });
        },

        show: async function () {
            if (typeof $ !== 'undefined') {
                $('#receivingChecklistModalLabel').text('Incoming Receiving Checklist');
                $('#receivingId').val('');
                api.clearReceivingForm();
                var today = new Date().toISOString().split('T')[0];
                $('#dateReceived').val(today);
            }

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getContacts) {
                    var contacts = await dataFunctions.getContacts();
                    var select = document.getElementById('supplierDetails');
                    if (select) {
                        var html = '<option value="">Select Supplier</option>';
                        if (contacts && Array.isArray(contacts)) {
                            contacts.forEach(function (contact) {
                                var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                                html += '<option value="' + contact.id + '">' + name + '</option>';
                            });
                        }
                        select.innerHTML = html;
                    }
                }
            } catch (err) {
                console.error('Error loading suppliers:', err);
            }

            var modalEl = document.getElementById('receivingChecklistModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#receivingChecklistModal').modal('show');
        },

        clearReceivingForm: function () {
            if (typeof $ === 'undefined') return;
            $('#receivingChecklistForm')[0].reset();
            $('#receivingId').val('');
            $('#receivedItemsTableBody tr:not(:first)').remove();
            $('#receivedItemsTableBody tr:first input').val('');
        },

        addReceivedItemRow: function () {
            if (typeof $ === 'undefined') return;
            var newRow = '<tr>' +
                '<td><input type="text" class="form-control form-control-sm" name="reference"></td>' +
                '<td><input type="text" class="form-control form-control-sm" name="description"></td>' +
                '<td><input type="text" class="form-control form-control-sm" name="batch"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01"></td>' +
                '<td><input type="date" class="form-control form-control-sm" name="manufacturedDate"></td>' +
                '<td><input type="date" class="form-control form-control-sm" name="bestBeforeDate"></td>' +
                '<td><button type="button" class="btn btn-sm btn-danger removeItemRow"><i class="fas fa-times"></i></button></td>' +
                '</tr>';
            $('#receivedItemsTableBody').append(newRow);
        },

        saveReceivingChecklist: async function () {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions) return;

                var form = document.getElementById('receivingChecklistForm');
                if (form && !form.checkValidity()) {
                    form.reportValidity();
                    return;
                }

                var receivedItems = [];
                if (typeof $ !== 'undefined') {
                    $('#receivedItemsTableBody tr').each(function () {
                        var reference = $(this).find('input[name="reference"]').val();
                        var description = $(this).find('input[name="description"]').val();
                        var batch = $(this).find('input[name="batch"]').val();
                        var quantity = $(this).find('input[name="quantity"]').val();
                        var manufacturedDate = $(this).find('input[name="manufacturedDate"]').val();
                        var bestBeforeDate = $(this).find('input[name="bestBeforeDate"]').val();
                        if (reference || description || batch || quantity) {
                            receivedItems.push({
                                reference: reference || null,
                                description: description || null,
                                batch: batch || null,
                                quantity_kg: quantity ? parseFloat(quantity) : null,
                                manufactured_date: manufacturedDate || null,
                                best_before_date: bestBeforeDate || null
                            });
                        }
                    });
                }

                var receivingData = {
                    p_date_received: document.getElementById('dateReceived') && document.getElementById('dateReceived').value,
                    p_delivery_note_ref: document.getElementById('deliveryNoteRef') && document.getElementById('deliveryNoteRef').value,
                    p_supplier_id: document.getElementById('supplierDetails') && document.getElementById('supplierDetails').value,
                    p_vehicle_clean: document.querySelector('input[name="vehicleClean"]:checked') && document.querySelector('input[name="vehicleClean"]:checked').value || null,
                    p_vehicle_enclosed: document.querySelector('input[name="vehicleEnclosed"]:checked') && document.querySelector('input[name="vehicleEnclosed"]:checked').value || null,
                    p_hazard_substances: document.querySelector('input[name="hazardSubstances"]:checked') && document.querySelector('input[name="hazardSubstances"]:checked').value || null,
                    p_pest_infestations: document.querySelector('input[name="pestInfestations"]:checked') && document.querySelector('input[name="pestInfestations"]:checked').value || null,
                    p_pallets_condition: document.querySelector('input[name="palletsCondition"]:checked') && document.querySelector('input[name="palletsCondition"]:checked').value || null,
                    p_raw_materials_condition: document.querySelector('input[name="rawMaterialsCondition"]:checked') && document.querySelector('input[name="rawMaterialsCondition"]:checked').value || null,
                    p_comments: document.getElementById('receivingComments') && document.getElementById('receivingComments').value || null,
                    p_received_items: JSON.stringify(receivedItems)
                };

                var receivingId = document.getElementById('receivingId') && document.getElementById('receivingId').value;
                var result;
                if (receivingId) {
                    var updateParams = { p_receiving_id: receivingId };
                    Object.keys(receivingData).forEach(function (k) { updateParams[k] = receivingData[k]; });
                    result = await dataFunctions.callFunction('update_receiving_checklist', updateParams);
                } else {
                    result = await dataFunctions.callFunction('create_receiving_checklist', receivingData);
                }

                if (result && result.success !== false) {
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('receiving_checklists');
                        dataFunctions.clearCachePattern('stock_items');
                    }
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'success', title: 'Success', text: receivingId ? 'Receiving checklist updated successfully' : 'Receiving checklist created successfully', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('receivingChecklistModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#receivingChecklistModal').modal('hide');
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadStockItems) await _stockManagementGrid.loadStockItems(true);
                } else {
                    throw new Error(result && (result.error || result.message) ? (result.error || result.message) : 'Failed to save receiving checklist');
                }
            } catch (error) {
                console.error('Error saving receiving checklist:', error);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save receiving checklist: ' + error.message });
            }
        }
    };
    return api;
})();
