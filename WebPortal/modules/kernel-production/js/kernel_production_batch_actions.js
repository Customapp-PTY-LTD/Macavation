/**
 * Kernel Production Batch Actions Module
 * Grid-only: release to stock, new batch modal + save. No modal controllers – batch history routes to _modal_batch_history.show() from grid.
 */
var _kernelProductionBatchActions = function () {
    'use strict';
    return {
        init: () => {
            const scope = _kernelProductionBatchActions;
            $(document).off('click.kernelNewBatch', '#saveNewBatchBtn').on('click.kernelNewBatch', '#saveNewBatchBtn', (e) => {
                e.preventDefault();
                scope.saveNewBatch();
            });
        },

        releaseBatchToStock: (batchId) => {
            if (!batchId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.completeKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Release function not available. Please refresh.', 'error');
                return;
            }
            var batch = (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch) ? _kernelProductionGrid.getBatch(batchId) : null;
            var batchLabel = batch ? (batch.batch_number || 'this batch') : 'this batch';
            Swal.fire({
                title: 'Release to stock?',
                html: 'Release <strong>' + batchLabel + '</strong> to kernel stock?<br><small class="text-muted">This will mark the batch as complete.</small>',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Release to stock',
                cancelButtonText: 'Cancel',
                confirmButtonColor: '#198754'
            }).then((res) => {
                if (!res.isConfirmed) return;
                dataFunctions.completeKernelBatch(batchId).then((result) => {
                    var inner = (result && result.complete_kernel_batch) ? result.complete_kernel_batch : result;
                    if (inner && inner.success === false) throw new Error(inner.error || 'Update failed');
                    Swal.fire({ icon: 'success', title: 'Released to stock', text: batchLabel + ' is now in kernel stock.', timer: 2000, showConfirmButton: false });
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                }).catch((e) => {
                    console.error(e);
                    Swal.fire('Error', e.message || 'Failed to release to stock', 'error');
                });
            });
        },

        deleteBatch: (batchId) => {
            if (!batchId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.deactivateKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Delete function not available. Please refresh.', 'error');
                return;
            }
            var batch = (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch) ? _kernelProductionGrid.getBatch(batchId) : null;
            var batchLabel = batch ? (batch.batch_number || 'this batch') : 'this batch';
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete "' + batchLabel + '"? This will remove it from production and intake. This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then((res) => {
                if (!res.isConfirmed) return;
                dataFunctions.deactivateKernelBatch(batchId).then((result) => {
                    var inner = (result && result.deactivate_kernel_batch) ? result.deactivate_kernel_batch : result;
                    if (inner && inner.success === false) throw new Error(inner.error || 'Delete failed');
                    Swal.fire({ icon: 'success', title: 'Batch deleted', text: batchLabel + ' has been removed.', timer: 2000, showConfirmButton: false });
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                }).catch((e) => {
                    console.error(e);
                    Swal.fire('Error', e.message || 'Failed to delete batch', 'error');
                });
            });
        },

        showNewBatchModal: () => {
            const scope = _kernelProductionBatchActions;
            $('#newBatchModalLabel').text('New Production Batch');
            $('#batchId').val('');
            scope.clearNewBatchForm();
            $('#batchReceivedDate').val(new Date().toISOString().split('T')[0]);
            var p = dataFunctions.getContacts && dataFunctions.getContacts();
            (p || Promise.resolve([])).then((contacts) => {
                var html = '<option value="">Select Supplier</option>';
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach((contact) => {
                        var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        html += '<option value="' + contact.id + '">' + name + '</option>';
                    });
                }
                $('#batchSupplier').html(html);
            }).then(() => {
                var y = new Date().getFullYear();
                var m = String(new Date().getMonth() + 1).padStart(2, '0');
                $('#batchNumber').val('BATCH-' + y + '-' + m + '-001');
                var modalEl = document.getElementById('newBatchModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
                else $('#newBatchModal').modal('show');
            });
        },

        clearNewBatchForm: () => {
            var form = document.getElementById('newBatchForm');
            if (form) form.reset();
            $('#batchId').val('');
        },

        saveNewBatch: () => {
            var form = document.getElementById('newBatchForm');
            if (!form || !form.checkValidity()) {
                if (form) form.reportValidity();
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create batch function not available. Please refresh.', 'error');
                return;
            }
            var getVal = (id) => $('#' + id).val() || null;
            var getFloat = (id) => { var v = $('#' + id).val(); return v ? parseFloat(v) : null; };
            var batchData = {
                batch_number:        getVal('batchNumber'),
                received_date:       getVal('batchReceivedDate'),
                wet_nis_received_kg: getFloat('batchWetNIS'),
                supplier_id:         getVal('batchSupplier') || null,
                grower_name:         getVal('batchGrowerName') || null
            };
            dataFunctions.createKernelBatch(batchData).then((result) => {
                var inner = (result && result.create_kernel_batch) ? result.create_kernel_batch : result;
                if (inner && inner.success === false) throw new Error(inner.error || 'Failed to create batch');
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: 'Production batch created successfully', timer: 2000, showConfirmButton: false });
                var modalEl = document.getElementById('newBatchModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else $('#newBatchModal').modal('hide');
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
            }).catch((e) => {
                console.error('[Kernel Production] saveNewBatch failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to create batch', 'error');
            });
        }
    };
}();
