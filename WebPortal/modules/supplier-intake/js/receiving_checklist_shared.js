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
        $('#receivedItemsTableBody tr:not(:first)').remove();
        $('#receivedItemsTableBody tr:first input').val('');
        $('#receivedItemsTableBody tr:first input[name="cartonBags"]').val('1');
    }

    function addReceivedItemRow() {
        if (typeof $ === 'undefined') return;
        var newRow = '<tr><td><input type="text" class="form-control form-control-sm" name="reference"></td><td><input type="text" class="form-control form-control-sm" name="description"></td><td><input type="text" class="form-control form-control-sm" name="batch"></td><td><input type="number" class="form-control form-control-sm" name="cartonBags" value="1"></td><td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01"></td><td><input type="date" class="form-control form-control-sm" name="manufacturedDate"></td><td><input type="date" class="form-control form-control-sm" name="bestBeforeDate"></td><td><button type="button" class="btn btn-sm btn-danger removeItemRow"><i class="fas fa-times"></i></button></td></tr>';
        $('#receivedItemsTableBody').append(newRow);
    }

    async function showReceivingChecklistModal() {
        if (typeof $ === 'undefined') return;
        $('#receivingChecklistModalLabel').text('Incoming Receiving Checklist');
        $('#receivingId').val('');
        clearReceivingForm();
        $('#dateReceived').val(new Date().toISOString().split('T')[0]);
        try {
            var contacts = await dataFunctions.getContacts();
            // Oil & Protein intake: same as Receiver checklist — exclude kernel NIS / kernel_customer
            var oilTypes = ['supplier', 'both', 'oil_processor'];
            var list = (contacts && Array.isArray(contacts))
                ? contacts.filter(function (c) { return oilTypes.indexOf((c.contact_type || '').trim()) >= 0; })
                : [];
            list.sort(function (a, b) {
                var na = (a.company_name || a.trading_name || a.primary_contact_name || '').toLowerCase();
                var nb = (b.company_name || b.trading_name || b.primary_contact_name || '').toLowerCase();
                return na.localeCompare(nb);
            });
            var select = $('#supplierDetails');
            var html = '<option value="">Select Supplier</option>';
            list.forEach(function (c) {
                var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                html += '<option value="' + c.id + '">' + name + '</option>';
            });
            select.html(html);
        } catch (e) { console.error('Error loading suppliers:', e); }
        var el = document.getElementById('receivingChecklistModal');
        if (el && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(el).show();
        }
    }

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
                }
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: receivingId ? 'Receiving checklist updated.' : 'Receiving checklist created.', timer: 2000, showConfirmButton: false });
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
