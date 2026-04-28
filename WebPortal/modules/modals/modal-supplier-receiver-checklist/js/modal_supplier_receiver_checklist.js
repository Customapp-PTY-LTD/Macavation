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
    /** Snapshot of grid batch while editing — preserves official FFA fields not on the form. */
    var _editingBatchSnapshot = null;

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
            var bbRaw = ($row.find('[name="bestBeforeDate"]').val() || '').trim();

            var hasAny = ref || productType || batch || qtyRaw || bbRaw;
            if (!hasAny) return;

            items.push({
                reference: ref || null,
                product_type: productType || null,
                batch_number: batch || null,
                quantity_kg: qtyRaw ? parseFloat(qtyRaw) : null,
                manufactured_date: null,
                best_before_date: bbRaw ? (toISO(bbRaw) || bbRaw) : null
            });
        });

        return items;
    }

    /**
     * Oil & Protein supplier intake: only CRM contacts used for oil-side supply chain.
     * Excludes kernel NIS growers (nis_supplier) and kernel customers (kernel_customer).
     * Matches CRM tabs: Suppliers, Oil Processors — not "NIS Suppliers".
     */
    var OIL_INTAKE_SUPPLIER_CONTACT_TYPES = ['supplier', 'both', 'oil_processor', 'oil_ingredient_supplier'];

    function filterContactsForOilIntake(contacts, selectedId) {
        if (!contacts || !Array.isArray(contacts)) return [];
        var allowed = function (c) {
            var t = (c.contact_type || '').trim();
            return OIL_INTAKE_SUPPLIER_CONTACT_TYPES.indexOf(t) >= 0;
        };
        var list = contacts.filter(allowed);
        if (selectedId) {
            var sel = contacts.find(function (c) { return String(c.id) === String(selectedId); });
            if (sel && !allowed(sel)) {
                list.push(sel);
            }
        }
        list.sort(function (a, b) {
            var na = (a.company_name || a.trading_name || a.primary_contact_name || '').toLowerCase();
            var nb = (b.company_name || b.trading_name || b.primary_contact_name || '').toLowerCase();
            return na.localeCompare(nb);
        });
        return list;
    }

    async function loadSuppliers(selectedId) {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return;
        try {
            var contacts = await dataFunctions.getContacts(null, true);
            var forDropdown = filterContactsForOilIntake(contacts, selectedId);
            var select = document.getElementById('srcSupplierDetails');
            if (!select) return;
            var html = '<option value="">Select supplier</option>';
            forDropdown.forEach(function (c) {
                var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                var sel = selectedId && String(c.id) === String(selectedId) ? ' selected' : '';
                html += '<option value="' + escapeHtml(c.id) + '"' + sel + '>' + escapeHtml(name) + '</option>';
            });
            select.innerHTML = html;
        } catch (e) {
            console.error('[Receiver checklist] Failed to load suppliers', e);
        }
    }

    function hideNewSupplierPanel() {
        var panel = document.getElementById('srcNewSupplierPanel');
        var err = document.getElementById('srcNewSupplierError');
        var addBtn = document.getElementById('srcAddSupplierBtn');
        if (panel) panel.style.display = 'none';
        if (err) { err.style.display = 'none'; err.textContent = ''; }
        if (addBtn) addBtn.setAttribute('aria-expanded', 'false');
    }

    function showNewSupplierPanel() {
        var panel = document.getElementById('srcNewSupplierPanel');
        var companyEl = document.getElementById('srcNewSupplierCompany');
        var personEl = document.getElementById('srcNewSupplierPerson');
        var typeEl = document.getElementById('srcNewSupplierContactType');
        var err = document.getElementById('srcNewSupplierError');
        if (companyEl) companyEl.value = '';
        if (personEl) personEl.value = '';
        if (typeEl) typeEl.value = 'supplier';
        if (err) { err.style.display = 'none'; err.textContent = ''; }
        if (panel) {
            panel.style.display = '';
            setTimeout(function () { if (companyEl) companyEl.focus(); }, 100);
        }
        var addBtn = document.getElementById('srcAddSupplierBtn');
        if (addBtn) addBtn.setAttribute('aria-expanded', 'true');
    }

    function extractNewContactId(res) {
        if (!res) return null;
        if (res.id) return res.id;
        if (res.contact_id) return res.contact_id;
        if (res.data && res.data.id) return res.data.id;
        if (Array.isArray(res.inserted_ids) && res.inserted_ids.length) return res.inserted_ids[0];
        if (res.result && res.result.id) return res.result.id;
        if (res.success !== false && res.p_id) return res.p_id;
        return null;
    }

    var api = {
        init: function () {
            if (_inited) return;
            _inited = true;
            if (typeof $ !== 'undefined') {
                $(document).off('click.srcAddItemRow', '#srcAddItemRow').on('click.srcAddItemRow', '#srcAddItemRow', function (e) {
                    e.preventDefault();
                    api.addItemRow();
                });
                $(document).off('click.srcCreateBatchesBtn', '#srcCreateBatchesBtn').on('click.srcCreateBatchesBtn', '#srcCreateBatchesBtn', function (e) {
                    e.preventDefault();
                    api.createBatches();
                });
                $(document).off('click.srcAddSupplierBtn', '#srcAddSupplierBtn').on('click.srcAddSupplierBtn', '#srcAddSupplierBtn', function (e) {
                    e.preventDefault();
                    var panel = document.getElementById('srcNewSupplierPanel');
                    if (panel && panel.style.display === 'none') showNewSupplierPanel();
                    else hideNewSupplierPanel();
                });
                $(document).off('click.srcNewSupplierSaveBtn', '#srcNewSupplierSaveBtn').on('click.srcNewSupplierSaveBtn', '#srcNewSupplierSaveBtn', function (e) {
                    e.preventDefault();
                    api.saveNewSupplier();
                });
                $(document).off('click.srcNewSupplierCancelBtn', '#srcNewSupplierCancelBtn').on('click.srcNewSupplierCancelBtn', '#srcNewSupplierCancelBtn', function (e) {
                    e.preventDefault();
                    hideNewSupplierPanel();
                });
                $(document).off('click.srcRemoveItemRow', '.srcRemoveItemRow').on('click.srcRemoveItemRow', '.srcRemoveItemRow', function (e) {
                    e.preventDefault();
                    $(this).closest('tr').remove();
                    ensureAtLeastOneRow();
                });
                $(document).off('shown.bs.modal.srcSupplierReceiver', '#' + CONTAINER_ID).on('shown.bs.modal.srcSupplierReceiver', '#' + CONTAINER_ID, function () {
                    initFlatpickrInModal();
                });
                $(document).off('hidden.bs.modal.srcSupplierReceiver', '#' + CONTAINER_ID).on('hidden.bs.modal.srcSupplierReceiver', '#' + CONTAINER_ID, function () {
                    api.clearForm();
                });
            }
        },

        show: async function (editingBatch) {
            api.clearForm(false);
            if (editingBatch && editingBatch.id) {
                _editingBatchId = editingBatch.id;
                _editingBatchStatus = editingBatch.status || null;
                _editingBatchSnapshot = editingBatch;
            } else {
                _editingBatchId = null;
                _editingBatchStatus = null;
                _editingBatchSnapshot = null;
            }
            hideNewSupplierPanel();

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
                        '<td><input type="text" class="form-control form-control-sm" name="batch" required placeholder="Required — e.g. OIL-2026-03-001" value="' + escapeHtml((editingBatch.batch_number || '').toString()) + '"></td>' +
                        '<td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01" min="0.01" required value="' + (editingBatch.quantity_kg != null ? escapeHtml(String(editingBatch.quantity_kg)) : '') + '"></td>' +
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
            if (resetRows) {
                _editingBatchId = null;
                _editingBatchStatus = null;
                _editingBatchSnapshot = null;
            }
            hideNewSupplierPanel();
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

        saveNewSupplier: async function () {
            var companyEl = document.getElementById('srcNewSupplierCompany');
            var personEl = document.getElementById('srcNewSupplierPerson');
            var typeEl = document.getElementById('srcNewSupplierContactType');
            var errEl = document.getElementById('srcNewSupplierError');
            var company = companyEl && companyEl.value ? companyEl.value.trim() : '';
            if (!company) {
                if (errEl) { errEl.textContent = 'Enter a company name.'; errEl.style.display = ''; }
                if (companyEl) companyEl.focus();
                return;
            }
            var contactType = (typeEl && typeEl.value) ? typeEl.value.trim() : 'supplier';
            if (OIL_INTAKE_SUPPLIER_CONTACT_TYPES.indexOf(contactType) < 0) contactType = 'supplier';

            if (typeof dataFunctions === 'undefined' || !dataFunctions.createContact) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Cannot create contacts. Refresh the page.', 'error');
                return;
            }

            var saveBtn = document.getElementById('srcNewSupplierSaveBtn');
            if (saveBtn) saveBtn.disabled = true;
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

            try {
                var payload = {
                    contact_type: contactType,
                    company_name: company,
                    primary_contact_name: (personEl && personEl.value) ? personEl.value.trim() : null,
                    status: 'active'
                };
                var res = await dataFunctions.createContact(payload);
                if (res && res.success === false) {
                    throw new Error(res.error || res.message || 'Could not create contact');
                }
                var newId = extractNewContactId(res);
                if (!newId) {
                    throw new Error((res && (res.error || res.message)) || 'No id returned from server');
                }
                hideNewSupplierPanel();
                await loadSuppliers(newId);
                var sel = document.getElementById('srcSupplierDetails');
                if (sel) sel.value = String(newId);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'success', title: 'Supplier added', text: company, timer: 1800, showConfirmButton: false });
                }
            } catch (err) {
                console.error('[Receiver checklist] saveNewSupplier', err);
                var msg = (err && err.message) ? err.message : String(err);
                if (errEl) { errEl.textContent = msg; errEl.style.display = ''; }
                else if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
            } finally {
                if (saveBtn) saveBtn.disabled = false;
            }
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
                '<td><input type="text" class="form-control form-control-sm" name="batch" required placeholder="Required — e.g. OIL-2026-03-001"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01" min="0.01" required></td>' +
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
            var missingBatch = rows.find(function (r) { return !r.batch_number || !String(r.batch_number).trim(); });
            if (missingBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Enter a batch number for each bag row (not auto-generated).', 'error');
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
                    if (_editingBatchSnapshot && _editingBatchSnapshot.official_ffa != null && _editingBatchSnapshot.official_ffa !== '') {
                        payload.official_ffa = _editingBatchSnapshot.official_ffa;
                        payload.ffa = _editingBatchSnapshot.official_ffa;
                    }
                    if (_editingBatchSnapshot && _editingBatchSnapshot.supplier_intake_official_ffa_at) {
                        payload.supplier_intake_official_ffa_at = _editingBatchSnapshot.supplier_intake_official_ffa_at;
                    }
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
                _editingBatchSnapshot = null;
            }
        }
    };

    return api;
})();

_modal_supplier_receiver_checklist.init();

