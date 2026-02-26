/**
 * Modal: Create kernel batch (Grower Intake).
 * Parent calls show(); modal owns init, show, clearForm, save.
 * Uses container id: createKernelBatchModal
 */
var _modal_grower_create_kernel_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'createKernelBatchModal';

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveCreateKernelBatchBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
        },

        show: async function () {
            var today = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('intakeBatchReceivedDate');
            if (dateEl) dateEl.value = today;

            var numberEl = document.getElementById('intakeBatchNumber');
            if (numberEl) {
                var d = new Date();
                numberEl.value = 'KERNEL-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-001';
            }

            var wetEl = document.getElementById('intakeBatchWetNis');
            if (wetEl) wetEl.value = '';

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getContacts) {
                    var contacts = await dataFunctions.getContacts();
                    var sel = document.getElementById('intakeBatchGrower');
                    if (sel) {
                        var html = '<option value="">Select (optional)</option>';
                        if (contacts && contacts.length) {
                            contacts.forEach(function (c) {
                                var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                                html += '<option value="' + c.id + '">' + name + '</option>';
                            });
                        }
                        sel.innerHTML = html;
                    }
                }
            } catch (e) {
                console.error('Error loading contacts:', e);
            }

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
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
