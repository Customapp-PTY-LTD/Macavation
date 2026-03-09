/**
 * Modal: Supplier Receiver checklist (create supplier intake batches from bags, or edit one batch).
 * Create: each row in the bags table becomes a batch. Edit: one batch's data is pre-filled for changes.
 */
var _modal_supplier_receiver_checklist = (function () {
    'use strict';

    var CONTAINER_ID = 'supplierReceiverChecklistModal';
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var _inited = false;
    var _editingBatchId = null;
    var _editingBatchStatus = null;

    function toISO(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return null;
        var s = String(dateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return null;
        var parts = s.split('/');
        return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
    }

    function fromISO(isoStr) {
        if (!isoStr) return '';
        var s = String(isoStr).trim().split('T')[0];
        var parts = s.split('-');
        if (parts.length !== 3) return s;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    function escapeHtml(t) {
        if (t == null) return '';
        var div = document.createElement('div');
        div.textContent = String(t);
        return div.innerHTML;
    }

    function initFlatpickrInModal() {
        var container = document.getElementById(CONTAINER_ID);
        if (!container || typeof flatpickr === 'undefined') return;
        container.querySelectorAll('.flatpickr-date').forEach(function (el) {
            if (el && !el._flatpickr) flatpickr(el, FLATPICKR_DDMMYYYY);
        });
    }

    function ensureAtLeastOneRow() {
        if (typeof $ === 'undefined') return;
        var rows = $('#srcItemsTableBody tr');
        if (!rows.length) {
            api.addItemRow();
        }
    }

    function getSupplierDetailsText() {
        var el = document.getElementById('srcSupplierDetails');
        if (!el) return null;
        var opt = el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;
        return opt && opt.text ? opt.text : null;
    }

    function setRadio(name, value) {
        if (value == null || value === '') return;
        var s = String(value);
        var inputs = document.querySelectorAll('input[name="' + name + '"]');
        inputs.forEach(function (inp) { inp.checked = (inp.value === s); });
    }

    function optionForProductType(selected) {
        var opts = [
            { v: '', l: 'Select product…' },
            { v: 'oil_kernel', l: 'Oil kernel' },
            { v: 'cracker_dust', l: 'Cracker dust' },
            { v: 'kernel_dust', l: 'Kernel dust' },
            { v: 'crush', l: 'Crush' },
            { v: 'cake', l: 'Cake' }
        ];
        var h = '';
        opts.forEach(function (o) {
            var isSel = (selected && String(o.v) === String(selected));
            h += '<option value="' + escapeHtml(o.v) + '"' + (isSel ? ' selected' : '') + '>' + escapeHtml(o.l) + '</option>';
        });
        return h;
    }

    function readRows() {
        var items = [];
        if (typeof $ === 'undefined') return items;

        $('#srcItemsTableBody tr').each(function () {
            var $row = $(this);
            var ref = ($row.find('[name="reference"]').val() || '').trim();
            var productType = ($row.find('[name="productType"]').val() || '').trim();
            var batch = ($row.find('[name="batch"]').val() || '').trim();
            var qtyRaw = ($row.find('[name="quantity"]').val() || '').trim();
            var mfgRaw = ($row.find('[name="manufacturedDate"]').val() || '').trim();
            var bbRaw = ($row.find('[name="bestBeforeDate"]').val() || '').trim();

            var hasAny = ref || productType || batch || qtyRaw || mfgRaw || bbRaw;
            if (!hasAny) return;

            items.push({
                reference: ref || null,
                product_type: productType || null,
                batch_number: batch || null,
                quantity_kg: qtyRaw ? parseFloat(qtyRaw) : null,
                manufactured_date: mfgRaw ? (toISO(mfgRaw) || mfgRaw) : null,
                best_before_date: bbRaw ? (toISO(bbRaw) || bbRaw) : null
            });
        });

        return items;
    }

    async function loadSuppliers(selectedId) {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return;
        try {
            var contacts = await dataFunctions.getContacts();
            var select = document.getElementById('srcSupplierDetails');
            if (!select) return;
            var html = '<option value="">Select supplier</option>';
            if (contacts && Array.isArray(contacts)) {
                contacts.forEach(function (c) {
                    var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                    var sel = selectedId && String(c.id) === String(selectedId) ? ' selected' : '';
                    html += '<option value="' + escapeHtml(c.id) + '"' + sel + '>' + escapeHtml(name) + '</option>';
                });
            }
            select.innerHTML = html;
        } catch (e) {
            console.error('[Receiver checklist] Failed to load suppliers', e);
        }
    }

    var api = {
        init: function () {
            if (_inited) return;
            _inited = true;
            var addBtn = document.getElementById('srcAddItemRow');
            if (addBtn) addBtn.addEventListener('click', function (e) { e.preventDefault(); api.addItemRow(); });
            var saveBtn = document.getElementById('srcCreateBatchesBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.createBatches(); });

            if (typeof $ !== 'undefined') {
                $(document).off('click.srcRemoveItemRow', '.srcRemoveItemRow').on('click.srcRemoveItemRow', '.srcRemoveItemRow', function (e) {
                    e.preventDefault();
                    $(this).closest('tr').remove();
                    ensureAtLeastOneRow();
                });
                $('#' + CONTAINER_ID).on('shown.bs.modal', function () { initFlatpickrInModal(); });
                $('#' + CONTAINER_ID).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: async function (editingBatch) {
            _editingBatchId = (editingBatch && editingBatch.id) ? editingBatch.id : null;
            _editingBatchStatus = (editingBatch && editingBatch.status) ? editingBatch.status : null;
            api.clearForm(false);

            var titleEl = document.getElementById('supplierReceiverChecklistModalLabel');
            var addBagBtn = document.getElementById('srcAddItemRow');
            var saveBtn = document.getElementById('srcCreateBatchesBtn');

            if (_editingBatchId && editingBatch) {
                if (titleEl) titleEl.textContent = 'Edit batch';
                if (addBagBtn) addBagBtn.style.display = 'none';
                if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Save changes';

                var dateEl = document.getElementById('srcDateReceived');
                var noteEl = document.getElementById('srcDeliveryNoteRef');
                var commentsEl = document.getElementById('srcReceivingComments');
                if (dateEl) dateEl.value = editingBatch.date_received ? fromISO(String(editingBatch.date_received).split('T')[0]) : '';
                if (noteEl) noteEl.value = (editingBatch.delivery_note_ref || '').toString();
                if (commentsEl) commentsEl.value = (editingBatch.receiving_comments || '').toString();

                setRadio('srcVehicleClean', editingBatch.vehicle_clean);
                setRadio('srcVehicleEnclosed', editingBatch.vehicle_enclosed);
                setRadio('srcHazardSubstances', editingBatch.hazard_substances);
                setRadio('srcPestInfestations', editingBatch.pest_infestations);
                setRadio('srcPalletsCondition', editingBatch.pallets_condition);
                setRadio('srcRawMaterialsCondition', editingBatch.raw_materials_condition);

                await loadSuppliers(editingBatch.supplier_id || null);

                if (typeof $ !== 'undefined') {
                    $('#srcItemsTableBody tr').remove();
                    var row = '<tr>' +
                        '<td><input type="text" class="form-control form-control-sm" name="reference" placeholder="Optional" value="' + escapeHtml((editingBatch.reference || '').toString()) + '"></td>' +
                        '<td><select class="form-select form-select-sm" name="productType" required>' +
                        optionForProductType(editingBatch.product_type || '') +
                        '</select></td>' +
                        '<td><input type="text" class="form-control form-control-sm" name="batch" placeholder="e.g. OIL-2026-03-001" value="' + escapeHtml((editingBatch.batch_number || '').toString()) + '"></td>' +
                        '<td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01" min="0.01" required value="' + (editingBatch.quantity_kg != null ? escapeHtml(String(editingBatch.quantity_kg)) : '') + '"></td>' +
                        '<td><input type="text" class="form-control form-control-sm flatpickr-date" name="manufacturedDate" placeholder="dd/mm/yyyy" value="' + (editingBatch.manufactured_date ? escapeHtml(fromISO(String(editingBatch.manufactured_date).split('T')[0])) : '') + '"></td>' +
                        '<td><input type="text" class="form-control form-control-sm flatpickr-date" name="bestBeforeDate" placeholder="dd/mm/yyyy" value="' + (editingBatch.best_before_date ? escapeHtml(fromISO(String(editingBatch.best_before_date).split('T')[0])) : '') + '"></td>' +
                        '<td><button type="button" class="btn btn-sm btn-danger srcRemoveItemRow" title="Remove"><i class="fas fa-times"></i></button></td></tr>';
                    $('#srcItemsTableBody').append(row);
                    initFlatpickrInModal();
                }
            } else {
                if (titleEl) titleEl.textContent = 'Receiver checklist';
                if (addBagBtn) addBagBtn.style.display = '';
                if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Create batches';

                var todayISO = new Date().toISOString().split('T')[0];
                var dateEl = document.getElementById('srcDateReceived');
                if (dateEl) dateEl.value = fromISO(todayISO);
                await loadSuppliers(null);
                ensureAtLeastOneRow();
            }

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        clearForm: function (resetRows) {
            resetRows = resetRows !== false;
            _editingBatchId = null;
            _editingBatchStatus = null;
            var form = document.getElementById('supplierReceiverChecklistForm');
            if (form) form.reset();
            if (typeof $ !== 'undefined' && resetRows) {
                $('#srcItemsTableBody tr:not(:first)').remove();
                var $first = $('#srcItemsTableBody tr:first');
                if ($first.length) {
                    $first.find('input').val('');
                    $first.find('select').val('');
                }
            }
            var titleEl = document.getElementById('supplierReceiverChecklistModalLabel');
            var addBagBtn = document.getElementById('srcAddItemRow');
            var saveBtn = document.getElementById('srcCreateBatchesBtn');
            if (titleEl) titleEl.textContent = 'Receiver checklist';
            if (addBagBtn) addBagBtn.style.display = '';
            if (saveBtn) saveBtn.innerHTML = '<i class="fas fa-save me-1"></i>Create batches';
            if (resetRows && typeof $ !== 'undefined') ensureAtLeastOneRow();
        },

        addItemRow: function () {
            if (typeof $ === 'undefined') return;
            var row = '<tr>' +
                '<td><input type="text" class="form-control form-control-sm" name="reference" placeholder="Optional"></td>' +
                '<td><select class="form-select form-select-sm" name="productType" required>' +
                '<option value="">Select product…</option>' +
                '<option value="oil_kernel">Oil kernel</option>' +
                '<option value="cracker_dust">Cracker dust</option>' +
                '<option value="kernel_dust">Kernel dust</option>' +
                '<option value="crush">Crush</option>' +
                '<option value="cake">Cake</option>' +
                '</select></td>' +
                '<td><input type="text" class="form-control form-control-sm" name="batch" placeholder="e.g. OIL-2026-03-001"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01" min="0.01" required></td>' +
                '<td><input type="text" class="form-control form-control-sm flatpickr-date" name="manufacturedDate" placeholder="dd/mm/yyyy"></td>' +
                '<td><input type="text" class="form-control form-control-sm flatpickr-date" name="bestBeforeDate" placeholder="dd/mm/yyyy"></td>' +
                '<td><button type="button" class="btn btn-sm btn-danger srcRemoveItemRow" title="Remove"><i class="fas fa-times"></i></button></td>' +
                '</tr>';
            var $row = $(row);
            $('#srcItemsTableBody').append($row);
            $row.find('.flatpickr-date').each(function () {
                if (typeof flatpickr !== 'undefined' && !this._flatpickr) flatpickr(this, FLATPICKR_DDMMYYYY);
            });
        },

        createBatches: async function () {
            var form = document.getElementById('supplierReceiverChecklistForm');
            if (!form || !form.checkValidity()) {
                if (form) form.reportValidity();
                return;
            }

            var dateReceivedRaw = (document.getElementById('srcDateReceived') && document.getElementById('srcDateReceived').value) || null;
            var dateReceived = dateReceivedRaw ? (toISO(dateReceivedRaw) || dateReceivedRaw) : null;
            var deliveryNoteRef = (document.getElementById('srcDeliveryNoteRef') && document.getElementById('srcDeliveryNoteRef').value) || null;
            var supplierId = (document.getElementById('srcSupplierDetails') && document.getElementById('srcSupplierDetails').value) || null;
            var supplierDetails = getSupplierDetailsText();

            var vehicle_clean = (document.querySelector('input[name="srcVehicleClean"]:checked') && document.querySelector('input[name="srcVehicleClean"]:checked').value) || null;
            var vehicle_enclosed = (document.querySelector('input[name="srcVehicleEnclosed"]:checked') && document.querySelector('input[name="srcVehicleEnclosed"]:checked').value) || null;
            var hazard_substances = (document.querySelector('input[name="srcHazardSubstances"]:checked') && document.querySelector('input[name="srcHazardSubstances"]:checked').value) || null;
            var pest_infestations = (document.querySelector('input[name="srcPestInfestations"]:checked') && document.querySelector('input[name="srcPestInfestations"]:checked').value) || null;
            var pallets_condition = (document.querySelector('input[name="srcPalletsCondition"]:checked') && document.querySelector('input[name="srcPalletsCondition"]:checked').value) || null;
            var raw_materials_condition = (document.querySelector('input[name="srcRawMaterialsCondition"]:checked') && document.querySelector('input[name="srcRawMaterialsCondition"]:checked').value) || null;
            var receiving_comments = (document.getElementById('srcReceivingComments') && document.getElementById('srcReceivingComments').value) || null;

            var rows = readRows();
            if (!rows.length) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Add at least one bag row to create batches.', 'info');
                return;
            }

            var invalid = rows.find(function (r) { return !r.product_type || !r.quantity_kg || r.quantity_kg <= 0; });
            if (invalid) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Each bag needs a product type and a quantity (kg).', 'error');
                return;
            }

            var createBtn = document.getElementById('srcCreateBatchesBtn');
            if (createBtn) createBtn.disabled = true;

            try {
                if (_editingBatchId) {
                    if (typeof dataFunctions === 'undefined' || !dataFunctions.updateSupplierIntakeBatch) {
                        if (typeof Swal !== 'undefined') Swal.fire('Error', 'Update function not available. Please refresh.', 'error');
                        return;
                    }
                    var r = rows[0];
                    var payload = {
                        batch_number: r.batch_number,
                        date_received: dateReceived,
                        delivery_note_ref: deliveryNoteRef,
                        supplier_id: supplierId,
                        supplier_details: supplierDetails,
                        product_type: r.product_type,
                        quantity_kg: r.quantity_kg,
                        manufactured_date: r.manufactured_date,
                        best_before_date: r.best_before_date,
                        reference: r.reference,
                        description: null,
                        vehicle_clean: vehicle_clean,
                        vehicle_enclosed: vehicle_enclosed,
                        hazard_substances: hazard_substances,
                        pest_infestations: pest_infestations,
                        pallets_condition: pallets_condition,
                        raw_materials_condition: raw_materials_condition,
                        receiving_comments: receiving_comments,
                        status: _editingBatchStatus || 'awaiting_test'
                    };
                    var res = await dataFunctions.updateSupplierIntakeBatch(_editingBatchId, payload);
                    if (res && res.success === false) {
                        throw new Error(res.error || res.message || 'Failed to update batch');
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Batch updated.', timer: 2500, showConfirmButton: false });
                } else {
                    if (typeof dataFunctions === 'undefined' || !dataFunctions.createSupplierIntakeBatch) {
                        if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create function not available. Please refresh.', 'error');
                        return;
                    }
                    var deliveryGroupId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (function () { var d = new Date().getTime(); return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = (d + Math.random() * 16) % 16 | 0; d = Math.floor(d / 16); return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }); })();
                    var created = 0;
                    for (var i = 0; i < rows.length; i++) {
                        var r = rows[i];
                        var payload = {
                            status: 'awaiting_test',
                            delivery_group_id: deliveryGroupId,
                            batch_number: r.batch_number,
                            date_received: dateReceived,
                            delivery_note_ref: deliveryNoteRef,
                            supplier_id: supplierId,
                            supplier_details: supplierDetails,
                            product_type: r.product_type,
                            quantity_kg: r.quantity_kg,
                            manufactured_date: r.manufactured_date,
                            best_before_date: r.best_before_date,
                            reference: r.reference,
                            description: null,
                            vehicle_clean: vehicle_clean,
                            vehicle_enclosed: vehicle_enclosed,
                            hazard_substances: hazard_substances,
                            pest_infestations: pest_infestations,
                            pallets_condition: pallets_condition,
                            raw_materials_condition: raw_materials_condition,
                            receiving_comments: receiving_comments
                        };
                        var res = await dataFunctions.createSupplierIntakeBatch(payload);
                        if (res && res.success === false) {
                            throw new Error(res.error || res.message || 'Failed to create batch');
                        }
                        created++;
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Created', text: created + ' batch(es) created and moved to Awaiting tests.', timer: 2500, showConfirmButton: false });
                }

                var modalEl = document.getElementById(CONTAINER_ID);
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('hide');

                if (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.loadBatches) {
                    await _supplierIntakeGrid.loadBatches(true);
                }
            } catch (e) {
                console.error('[Receiver checklist] save failed', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save.', 'error');
            } finally {
                if (createBtn) createBtn.disabled = false;
                _editingBatchId = null;
            }
        }
    };

    return api;
})();

_modal_supplier_receiver_checklist.init();

