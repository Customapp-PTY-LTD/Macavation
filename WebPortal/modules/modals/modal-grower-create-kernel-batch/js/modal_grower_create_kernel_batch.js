/**
 * Modal: Create kernel batch (Grower Intake).
 * Parent calls show(); modal owns init, show, clearForm, save.
 * Uses container id: createKernelBatchModal
 */
var _modal_grower_create_kernel_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'createKernelBatchModal';

    var SUPPLIER_TYPES = ['nis_supplier', 'supplier', 'both'];

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveCreateKernelBatchBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var addSupplierBtn = document.getElementById('intakeAddSupplierBtn');
            if (addSupplierBtn) addSupplierBtn.addEventListener('click', function (e) { e.preventDefault(); api.showAddSupplierForm(); });
            var dateEl = document.getElementById('intakeBatchReceivedDate');
            if (dateEl) {
                dateEl.removeEventListener('change', api._onDateOrGrowerChange);
                dateEl.addEventListener('change', api._onDateOrGrowerChange);
            }
        },

        populateSupplierDropdown: function () {
            var sel = document.getElementById('intakeBatchGrower');
            if (!sel) return;
            sel.innerHTML = '<option value="">Select (optional)</option>';
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return;
            dataFunctions.getContacts(null, true).then(function (raw) {
                var contacts = Array.isArray(raw) ? raw : (raw && raw.get_contacts ? raw.get_contacts : (raw && raw.data ? raw.data : []));
                if (!Array.isArray(contacts)) return;
                var suppliers = contacts.filter(function (c) {
                    var t = (c.contact_type || '').trim();
                    return SUPPLIER_TYPES.indexOf(t) >= 0;
                });
                var opts = '<option value="">Select (optional)</option>';
                suppliers.forEach(function (c) {
                    var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                    var code = c.supplier_number != null ? ' (' + c.supplier_number + ')' : '';
                    opts += '<option value="' + c.id + '">' + name + code + '</option>';
                });
                sel.innerHTML = opts;
                sel.removeEventListener('change', api._onDateOrGrowerChange);
                sel.addEventListener('change', api._onDateOrGrowerChange);
            }).catch(function (e) { console.error('Error loading suppliers:', e); });
        },

        showAddSupplierForm: function () {
            var apiRef = api;
            if (typeof Swal === 'undefined') {
                var name = window.prompt('Supplier company name:');
                var codeStr = window.prompt('Supplier code (number for batch naming, e.g. 1-99):');
                if (name && name.trim() && codeStr != null && codeStr.trim() !== '') {
                    var code = parseInt(codeStr.trim(), 10);
                    if (!isNaN(code) && code >= 0) apiRef.doCreateSupplier({ company_name: name.trim(), supplier_number: code });
                }
                return;
            }
            Swal.fire({
                title: 'Add new supplier',
                html:
                    '<label class="form-label text-start d-block">Company name <span class="text-danger">*</span></label>' +
                    '<input type="text" id="intakeNewSupplierName" class="form-control mb-2" placeholder="e.g. Farm Name (Pty) Ltd" required>' +
                    '<label class="form-label text-start d-block">Supplier code <span class="text-danger">*</span></label>' +
                    '<input type="number" id="intakeNewSupplierCode" class="form-control mb-2" min="0" max="99" placeholder="e.g. 1 (used in batch number: Bn 01 26 01)" required>' +
                    '<small class="text-muted d-block mb-2">This number appears in the batch name (Bn [code] [year] [seq]). Use a unique number per supplier.</small>' +
                    '<label class="form-label text-start d-block">Province</label>' +
                    '<input type="text" id="intakeNewSupplierProvince" class="form-control mb-2" placeholder="e.g. Limpopo">' +
                    '<label class="form-label text-start d-block">Area / City</label>' +
                    '<input type="text" id="intakeNewSupplierArea" class="form-control mb-2" placeholder="e.g. Tzaneen">' +
                    '<label class="form-label text-start d-block">Contact name</label>' +
                    '<input type="text" id="intakeNewSupplierContact" class="form-control mb-2" placeholder="Contact person">' +
                    '<label class="form-label text-start d-block">Notes</label>' +
                    '<input type="text" id="intakeNewSupplierNotes" class="form-control" placeholder="Optional">',
                showCancelButton: true,
                confirmButtonText: 'Add supplier',
                focusConfirm: false,
                preConfirm: function () {
                    var nameEl = document.getElementById('intakeNewSupplierName');
                    var codeEl = document.getElementById('intakeNewSupplierCode');
                    var name = nameEl && nameEl.value ? nameEl.value.trim() : '';
                    var codeVal = codeEl && codeEl.value !== '' ? parseInt(codeEl.value, 10) : NaN;
                    if (!name) {
                        Swal.showValidationMessage('Company name is required');
                        return false;
                    }
                    if (isNaN(codeVal) || codeVal < 0) {
                        Swal.showValidationMessage('Supplier code must be a number (0–99) used for batch naming');
                        return false;
                    }
                    return {
                        company_name: name,
                        supplier_number: codeVal,
                        physical_province: (document.getElementById('intakeNewSupplierProvince') && document.getElementById('intakeNewSupplierProvince').value) ? document.getElementById('intakeNewSupplierProvince').value.trim() : null,
                        physical_city: (document.getElementById('intakeNewSupplierArea') && document.getElementById('intakeNewSupplierArea').value) ? document.getElementById('intakeNewSupplierArea').value.trim() : null,
                        primary_contact_name: (document.getElementById('intakeNewSupplierContact') && document.getElementById('intakeNewSupplierContact').value) ? document.getElementById('intakeNewSupplierContact').value.trim() : null,
                        notes: (document.getElementById('intakeNewSupplierNotes') && document.getElementById('intakeNewSupplierNotes').value) ? document.getElementById('intakeNewSupplierNotes').value.trim() : null
                    };
                }
            }).then(function (result) {
                if (result && result.isConfirmed && result.value) apiRef.doCreateSupplier(result.value);
            });
        },

        doCreateSupplier: function (data) {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createContact) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create contact not available.', 'error');
                return;
            }
            var payload = {
                contact_type: 'nis_supplier',
                company_name: data.company_name,
                supplier_number: data.supplier_number,
                physical_province: data.physical_province || null,
                physical_city: data.physical_city || null,
                primary_contact_name: data.primary_contact_name || null,
                notes: data.notes || null,
                status: 'active'
            };
            dataFunctions.createContact(payload).then(function (res) {
                var id = (res && res.id) || (res && res.data && res.data.id);
                if (id) {
                    api.populateSupplierDropdown();
                    var sel = document.getElementById('intakeBatchGrower');
                    if (sel) sel.value = id;
                    api._onDateOrGrowerChange();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Supplier added', timer: 1500, showConfirmButton: false });
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (res && res.error) || 'Failed to add supplier', 'error');
                }
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to add supplier', 'error');
            });
        },

        show: async function () {
            var today = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('intakeBatchReceivedDate');
            if (dateEl) {
                dateEl.value = today;
                dateEl.removeEventListener('change', api._onDateOrGrowerChange);
                dateEl.addEventListener('change', api._onDateOrGrowerChange);
            }

            var numberEl = document.getElementById('intakeBatchNumber');
            if (numberEl) numberEl.value = '';
            numberEl && numberEl.setAttribute('placeholder', 'Select supplier for Bn format (e.g. Bn 01 26 01)');

            var wetEl = document.getElementById('intakeBatchWetNis');
            if (wetEl) wetEl.value = '';

            api.populateSupplierDropdown();

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        _onDateOrGrowerChange: function () {
            var sel = document.getElementById('intakeBatchGrower');
            var numberEl = document.getElementById('intakeBatchNumber');
            if (!sel || !numberEl || typeof dataFunctions === 'undefined' || !dataFunctions.getNextBatchNumber) return;
            var supplierId = (sel.value || '').trim() || null;
            if (!supplierId) {
                numberEl.value = '';
                numberEl.setAttribute('placeholder', 'Select supplier for Bn format (e.g. Bn 01 26 01)');
                numberEl.removeAttribute('readonly');
                return;
            }
            numberEl.value = '';
            numberEl.setAttribute('placeholder', 'Loading…');
            numberEl.setAttribute('readonly', 'readonly');
            var dateEl = document.getElementById('intakeBatchReceivedDate');
            var year = dateEl && dateEl.value ? new Date(dateEl.value + 'T12:00:00').getFullYear() : new Date().getFullYear();
            dataFunctions.getNextBatchNumber(supplierId, year).then(function (nextId) {
                var val = (nextId != null && typeof nextId === 'string') ? nextId : (nextId != null ? String(nextId) : '');
                numberEl.value = val;
                numberEl.setAttribute('placeholder', val ? '' : 'Will assign on save');
                if (val) numberEl.setAttribute('readonly', 'readonly'); else numberEl.removeAttribute('readonly');
            }).catch(function (err) {
                console.error('getNextBatchNumber failed:', err);
                numberEl.value = '';
                numberEl.setAttribute('placeholder', 'Select supplier for Bn format (e.g. Bn 01 26 01)');
                numberEl.removeAttribute('readonly');
            });
        },

        save: async function () {
            var form = document.getElementById('createKernelBatchForm');
            if (!form || !form.checkValidity()) {
                form.reportValidity();
                return;
            }

            var batchNumber = document.getElementById('intakeBatchNumber') && document.getElementById('intakeBatchNumber').value;
            var receivedDate = document.getElementById('intakeBatchReceivedDate') && document.getElementById('intakeBatchReceivedDate').value;
            var wetNis = parseFloat(document.getElementById('intakeBatchWetNis') && document.getElementById('intakeBatchWetNis').value, 10);
            var supplierEl = document.getElementById('intakeBatchGrower');
            var supplierId = supplierEl && supplierEl.value ? supplierEl.value : null;
            var growerName = null;
            if (supplierEl && supplierEl.selectedIndex >= 0) {
                var opt = supplierEl.options[supplierEl.selectedIndex];
                if (opt && opt.text) growerName = opt.text.trim();
            }
            if (growerName === '' || growerName === 'Select (optional)') growerName = null;

            if (!batchNumber || !receivedDate || !wetNis || wetNis <= 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch number, received date and wet NIS (kg) are required.', 'error');
                return;
            }

            try {
                // Step 1: create row in batches (uses form batch number as human-readable id)
                var batchResult = await dataFunctions.upsertBatch({
                    batch_id:   batchNumber,
                    batch_type: 'kernel'
                });
                if (!batchResult || !batchResult.success || !batchResult.id) {
                    throw new Error(batchResult && batchResult.error ? batchResult.error : 'Failed to create batch record');
                }

                // Step 2: create row in kernel (status = intake)
                var kernelResult = await dataFunctions.initializeKernelForBatch({
                    batch_uuid:           batchResult.id,
                    supplier_id:          supplierId   || null,
                    grower_name:          growerName   || null,
                    received_date:        receivedDate || null,
                    wet_nis_received_kg:  isNaN(wetNis) ? null : wetNis
                });
                if (!kernelResult || !kernelResult.success) {
                    throw new Error(kernelResult && kernelResult.error ? kernelResult.error : 'Failed to initialize kernel record');
                }

                var modalEl = document.getElementById(CONTAINER_ID);
                if (modalEl && typeof bootstrap !== 'undefined') {
                    var inst = bootstrap.Modal.getInstance(modalEl);
                    if (inst) inst.hide();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#' + CONTAINER_ID).modal('hide');
                }

                if (typeof Swal !== 'undefined') Swal.fire({
                    icon: 'success',
                    title: 'Batch created',
                    text: 'Kernel batch is in intake. Complete Stage 1 steps then move to raw stock when ready.',
                    timer: 2500,
                    showConfirmButton: false
                });

                if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.loadIntakeBatches) {
                    await _growerIntakeGrid.loadIntakeBatches(true);
                }
            } catch (e) {
                console.error(e);
                var msg = e.message || '';
                var isRbacDenied = msg.indexOf('operation EXECUTE is not allowed') >= 0 || msg.indexOf('Access denied') >= 0;
                if (typeof Swal !== 'undefined') {
                    if (isRbacDenied) {
                        Swal.fire({
                            icon: 'error',
                            title: 'Permission denied',
                            html: 'Creating a batch was blocked by the server. <strong>Ask an admin</strong> to either set the Lambda env <code>SUPABASE_URL</code> to the project where permissions were granted, or run the EXECUTE grants on the database the server uses. See <strong>BluePrint/RBAC_GUIDE.md</strong> or <strong>LAMBDA_ENV_REQUIRED.md</strong>.'
                        });
                    } else {
                        Swal.fire('Error', msg || 'Failed to create batch', 'error');
                    }
                }
            }
        }
    };
    return api;
})();
_modal_grower_create_kernel_batch.init();
