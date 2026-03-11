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
    /** Received Items DATE: open calendar only on click (not on focus), so validation bubble can show without opening calendar */
    var FLATPICKR_RECEIVED_ITEMS_DATE = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true, clickOpens: false };

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
            var isReceivedItemsDate = el.getAttribute('name') === 'growerManufacturedDate' || el.closest('#growerReceivedItemsTableBody');
            if (isReceivedItemsDate) {
                var fp = flatpickr(el, FLATPICKR_RECEIVED_ITEMS_DATE);
                el.addEventListener('click', function () { fp.open(); });
            } else {
                flatpickr(el, FLATPICKR_DDMMYYYY);
            }
        });
    }

    function initReceivedItemsDatePicker(dateInput) {
        if (!dateInput || dateInput._flatpickr || typeof flatpickr === 'undefined') return;
        if (!dateInput.placeholder) dateInput.placeholder = getTodayPlaceholder();
        var fp = flatpickr(dateInput, FLATPICKR_RECEIVED_ITEMS_DATE);
        dateInput.addEventListener('click', function () { fp.open(); });
    }

    var RECEIVED_ITEM_DATE_INVALID_MSG = 'Please fill in this field.';

    function clearReceivedItemsDateValidation() {
        $('#growerReceivedItemsTableBody input[name="growerManufacturedDate"]').each(function () {
            if (this.setCustomValidity) this.setCustomValidity('');
            var next = this.nextElementSibling;
            if (next && next.getAttribute && next.getAttribute('data-received-date-invalid')) {
                next.remove();
            }
        });
    }

    function showReceivedItemDateInvalid(dateInput) {
        if (!dateInput) return;
        clearReceivedItemsDateValidation();
        if (dateInput.setCustomValidity) dateInput.setCustomValidity(RECEIVED_ITEM_DATE_INVALID_MSG);
        var existing = dateInput.nextElementSibling;
        if (existing && existing.getAttribute('data-received-date-invalid')) return;
        var div = document.createElement('div');
        div.className = 'validation-bubble';
        div.setAttribute('data-received-date-invalid', '1');
        var icon = document.createElement('span');
        icon.className = 'validation-bubble-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '!';
        var text = document.createElement('span');
        text.className = 'validation-bubble-text';
        text.textContent = RECEIVED_ITEM_DATE_INVALID_MSG;
        div.appendChild(icon);
        div.appendChild(text);
        dateInput.parentNode.insertBefore(div, dateInput.nextSibling);
        dateInput.focus();
        if (dateInput.scrollIntoView) dateInput.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
            $(document).on('click', '.growerRemoveItemRow', function () { $(this).closest('tr').remove(); scope.updateWeightTally(); });
            $(document).on('input change', '#growerReceivedItemsTableBody .grower-bag-weight', function () { scope.updateWeightTally(); });
            $(document).on('input change', '#growerRemovedPreSizerKg', function () { scope.updateWeightTally(); });
            $(document).on('change', '#' + CONTAINER_ID + ' select[name="growerDescription"]', function () {
                var val = $(this).val();
                var titleText = val === 'NIS' ? 'Harvested Date' : val === 'Kernel' ? 'Manufactured Date' : 'Manufactured Date or Harvested Date';
                $(this).closest('tr').find('input[name="growerManufacturedDate"]').attr('title', titleText);
            });
            // Clear validation state when user fills the Received Items date (so message and is-invalid go away)
            $(document).on('input change', '#growerReceivedItemsTableBody input[name="growerManufacturedDate"]', function () {
                if (this.setCustomValidity) this.setCustomValidity('');
                var next = this.nextElementSibling;
                if (next && next.getAttribute && next.getAttribute('data-received-date-invalid')) next.remove();
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

            // Load kernel record to get supplier + any existing checklist data
            if (batchId && typeof dataFunctions !== 'undefined' && dataFunctions.getKernelBatchDetail) {
                try {
                    var kernelDetail = await dataFunctions.getKernelBatchDetail(batchId);
                    var kd = kernelDetail && (kernelDetail.data || kernelDetail);
                    if (kd && kd.supplier_id && supplierIdEl) supplierIdEl.value = kd.supplier_id;
                    var existingChecklist = kd && kd.intake_data && kd.intake_data.receiving_checklist;
                    if (existingChecklist && existingChecklist.completed_at) {
                        scope.loadIntoForm({ checklist: existingChecklist, received_items: existingChecklist.received_items || [] });
                    }
                } catch (err) {
                    console.error('Error loading kernel detail for checklist:', err);
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

            var removedEl = document.getElementById('growerRemovedPreSizerKg');
            if (removedEl) {
                var removedVal = checklist.removed_pre_sizer_kg ?? checklist.removedPreSizerKg;
                removedEl.value = (removedVal != null && removedVal !== '') ? String(removedVal) : '';
            }

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
            scope.updateWeightTally();
        },

        clearForm: () => {
            const scope = _modal_grower_receiving_checklist;
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
            var removedEl = document.getElementById('growerRemovedPreSizerKg');
            if (removedEl) removedEl.value = '';
            clearReceivedItemsDateValidation();
            scope.updateWeightTally();
        },

        addReceivedItemRow: () => {
            const scope = _modal_grower_receiving_checklist;
            if (typeof $ === 'undefined') return;
            // Copy description and date from last row as defaults
            var lastRow = $('#growerReceivedItemsTableBody tr:last');
            var lastDescription = lastRow.length ? (lastRow.find('select[name="growerDescription"]').val() || '') : '';
            var lastDate = lastRow.length ? (lastRow.find('input[name="growerManufacturedDate"]').val() || '') : '';
            scope.appendReceivedItemRow(lastDescription, '', lastDate);
        },

        appendReceivedItemRow: (description, quantityKg, dateStr) => {
            const scope = _modal_grower_receiving_checklist;
            if (typeof $ === 'undefined') return;
            var todayPlaceholder = getTodayPlaceholder();
            var descSelected = description === 'NIS' ? ' selected' : '';
            var kernelSelected = description === 'Kernel' ? ' selected' : '';
            var titleText = description === 'NIS' ? 'Harvested Date' : description === 'Kernel' ? 'Manufactured Date' : 'Manufactured Date or Harvested Date';
            var newRow = '<tr><td class="align-middle"><select class="form-select form-select-sm" name="growerDescription"><option value="">Select</option><option value="NIS"' + descSelected + '>NIS</option><option value="Kernel"' + kernelSelected + '>Kernel</option></select></td><td class="align-middle"><input type="number" class="form-control form-control-sm grower-bag-weight" name="growerQuantity" step="0.01" value="' + (quantityKg ? String(quantityKg).replace(/"/g, '&quot;') : '') + '"></td><td class="align-middle"><input type="text" class="form-control form-control-sm flatpickr-date" name="growerManufacturedDate" placeholder="' + todayPlaceholder + '" value="' + (dateStr ? String(dateStr).replace(/"/g, '&quot;') : '') + '" title="' + titleText.replace(/"/g, '&quot;') + '"></td><td class="align-middle"><button type="button" class="btn btn-sm btn-danger growerRemoveItemRow"><i class="fas fa-times"></i></button></td></tr>';
            var $row = $(newRow).appendTo('#growerReceivedItemsTableBody');
            $row.find('.flatpickr-date').each(function () {
                initReceivedItemsDatePicker(this);
            });
            // Focus the new weight input
            var weightInput = $row.find('.grower-bag-weight')[0];
            if (weightInput) setTimeout(function () { weightInput.focus(); }, 50);
            scope.updateWeightTally();
        },

        updateWeightTally: () => {
            var total = 0;
            $('#growerReceivedItemsTableBody .grower-bag-weight').each(function () {
                var val = parseFloat(this.value);
                if (!isNaN(val)) total += val;
            });
            var totalEl = document.getElementById('growerTotalWeightKg');
            if (totalEl) totalEl.textContent = total.toFixed(2);

            var removedPreSizerEl = document.getElementById('growerRemovedPreSizerKg');
            var removed = (removedPreSizerEl && removedPreSizerEl.value !== '') ? parseFloat(removedPreSizerEl.value) : 0;
            if (isNaN(removed)) removed = 0;
            var balanceIn = total - removed;
            var balanceEl = document.getElementById('growerBalanceInKg');
            if (balanceEl) balanceEl.textContent = balanceIn.toFixed(2);
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

        /**
         * Validate mandatory fields in section order (all except Comments).
         * Returns { valid: boolean, message: string, failedSection: number }.
         * failedSection is 1–4 so caller can show Swal (1,3) or browser tooltip (2,4).
         */
        validateBeforeSave: () => {
            if (typeof $ === 'undefined') return { valid: true };

            // 1. Vehicle & Receiving Checks — all Yes/No mandatory → show validation (Swal)
            var vehicleClean = $('input[name="growerVehicleClean"]:checked').val();
            var vehicleEnclosed = $('input[name="growerVehicleEnclosed"]:checked').val();
            var hazardSubstances = $('input[name="growerHazardSubstances"]:checked').val();
            var pestInfestations = $('input[name="growerPestInfestations"]:checked').val();
            var palletsCondition = $('input[name="growerPalletsCondition"]:checked').val();
            var rawMaterialsCondition = $('input[name="growerRawMaterialsCondition"]:checked').val();

            if (!vehicleClean || !vehicleEnclosed || !hazardSubstances || !pestInfestations || !palletsCondition || !rawMaterialsCondition) {
                return { valid: false, message: 'Please answer all Vehicle & Receiving Checks (Yes/No).', failedSection: 1 };
            }

            // 2. Receiving Information — Date Received and Delivery Note Ref → show browser tooltip
            var dateReceived = ($('#growerDateReceived').val() || '').trim();
            var deliveryNoteRef = ($('#growerDeliveryNoteRef').val() || '').trim();
            if (!dateReceived) return { valid: false, message: 'Please enter Date Received.', failedSection: 2 };
            if (!deliveryNoteRef) return { valid: false, message: 'Please enter Delivery Note Reference/Number.', failedSection: 2 };

            // 3. Received Items — at least one row; no partial rows → show validation (Swal)
            var hasCompleteRow = false;
            var rowError = null;
            $('#growerReceivedItemsTableBody tr').each(function () {
                var $row = $(this);
                var desc = ($row.find('select[name="growerDescription"]').val() || '').trim();
                var qty = ($row.find('input[name="growerQuantity"]').val() || '').trim();
                var dateVal = ($row.find('input[name="growerManufacturedDate"]').val() || '').trim();
                if (desc || qty || dateVal) {
                    if (!desc || !qty || !dateVal) {
                        rowError = 'Please complete each received item row: Description, Weight and Date are required.';
                        return false;
                    }
                    var num = parseFloat(qty);
                    if (isNaN(num) || num <= 0) {
                        rowError = 'Please enter a valid Weight (kg) for each received item.';
                        return false;
                    }
                    hasCompleteRow = true;
                }
            });
            if (rowError) return { valid: false, message: rowError, failedSection: 3 };
            if (!hasCompleteRow) {
                return { valid: false, message: 'Please add at least one received item with Description, Weight and Date.', failedSection: 3 };
            }

            // 4. Removed pre-sizer (kg) — mandatory → show browser tooltip
            var removedVal = ($('#growerRemovedPreSizerKg').val() || '').trim();
            if (removedVal === '') return { valid: false, message: 'Please enter Removed pre-sizer (kg). Use 0 if none.', failedSection: 4 };
            var removedNum = parseFloat(removedVal);
            if (isNaN(removedNum) || removedNum < 0) {
                return { valid: false, message: 'Please enter a valid Removed pre-sizer (kg) (0 or positive number).', failedSection: 4 };
            }

            return { valid: true };
        },

        save: async () => {
            const scope = _modal_grower_receiving_checklist;
            try {
                if (typeof dataFunctions === 'undefined') return;

                // Validate in section order on Save only: section 1 & 3 → Swal or date bubble; section 2 & 4 → browser tooltip
                var validation = scope.validateBeforeSave();
                if (!validation.valid) {
                    var form = document.getElementById('growerReceivingChecklistForm');
                    if ((validation.failedSection === 2 || validation.failedSection === 4) && form) {
                        form.reportValidity(); // show browser tooltip on the empty required field for that section
                    } else if (validation.failedSection === 3 && validation.message && validation.message.indexOf('complete each received item row') !== -1) {
                        // Only show date bubble when Description AND Weight are filled but Date is missing; otherwise show Swal
                        var $dateMissingRow = $('#growerReceivedItemsTableBody tr').filter(function () {
                            var $row = $(this);
                            var desc = ($row.find('select[name="growerDescription"]').val() || '').trim();
                            var qty = ($row.find('input[name="growerQuantity"]').val() || '').trim();
                            var dateVal = ($row.find('input[name="growerManufacturedDate"]').val() || '').trim();
                            return desc && qty && !dateVal;
                        }).first();
                        var dateInput = $dateMissingRow.find('input[name="growerManufacturedDate"]')[0];
                        if (dateInput) {
                            showReceivedItemDateInvalid(dateInput);
                        } else {
                            if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', validation.message, 'warning');
                        }
                    } else {
                        if (typeof Swal !== 'undefined' && Swal.fire) {
                            Swal.fire('Validation', validation.message, 'warning');
                        }
                    }
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
                    p_received_items: receivedItems,
                    p_removed_pre_sizer_kg: (function () {
                        var v = $('#growerRemovedPreSizerKg').val();
                        if (v === '' || v == null) return null;
                        var n = parseFloat(v);
                        return isNaN(n) ? null : n;
                    })()
                };

                var batchIdEl = document.getElementById('growerReceivingChecklistBatchId');
                var kernelId = batchIdEl && batchIdEl.value ? batchIdEl.value.trim() : null;
                if (!kernelId) throw new Error('No kernel record linked — cannot save checklist');

                var result = await dataFunctions.upsertKernelChecklist({
                    kernel_id:               kernelId,
                    date_received:           receivingData.p_date_received,
                    delivery_note_ref:       receivingData.p_delivery_note_ref,
                    supplier_id:             receivingData.p_supplier_id,
                    vehicle_clean:           receivingData.p_vehicle_clean,
                    vehicle_enclosed:        receivingData.p_vehicle_enclosed,
                    hazard_substances:       receivingData.p_hazard_substances,
                    pest_infestations:       receivingData.p_pest_infestations,
                    pallets_condition:       receivingData.p_pallets_condition,
                    raw_materials_condition: receivingData.p_raw_materials_condition,
                    comments:               receivingData.p_comments,
                    received_items:         receivingData.p_received_items,
                    removed_pre_sizer_kg:   receivingData.p_removed_pre_sizer_kg
                });

                if (result && result.success !== false) {
                    if (batchIdEl) batchIdEl.value = '';
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Receiving checklist saved.', timer: 2000, showConfirmButton: false });
                    if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.loadIntakeBatches) await _growerIntakeGrid.loadIntakeBatches(true);
                    scope.hide();
                } else {
                    throw new Error((result && (result.error || result.message)) || 'Failed to save');
                }
            } catch (error) {
                console.error('Error saving receiving checklist:', error);
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save: ' + (error.message || error) });
            }
        }
    };
})();
_modal_grower_receiving_checklist.init();
