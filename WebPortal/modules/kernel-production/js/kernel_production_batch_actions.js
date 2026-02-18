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
            (dataFunctions.updateProductionBatch && dataFunctions.updateProductionBatch(batchId, { status: 'in_finished_stock', stage: 'finished_stock' })).then((result) => {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released', text: 'Batch is now in Kernel Stock.', timer: 2000, showConfirmButton: false });
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            }).catch((e) => {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release to stock', 'error');
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
            var getVal = (id) => $('#' + id).val() || null;
            var getFloat = (id) => { var v = $('#' + id).val(); return v ? parseFloat(v) : null; };
            var batchData = {
                p_batch_number: getVal('batchNumber'),
                p_received_date: getVal('batchReceivedDate'),
                p_wet_nis_received_kg: getFloat('batchWetNIS'),
                p_supplier_id: getVal('batchSupplier') || null,
                p_grower_name: getVal('batchGrowerName') || null,
                p_receiving_moisture_percentage: getFloat('batchReceivingMoisture') || null,
                p_start_date: getVal('batchStartDate') || null,
                p_estimated_completion_date: getVal('batchEstimatedCompletion') || null,
                p_batch_type: 'kernel',
                p_status: 'receiving',
                p_current_step: 1
            };
            (dataFunctions.createProductionBatch && dataFunctions.createProductionBatch(batchData)).then((result) => {
                if (result && result.success !== false) {
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) dataFunctions.clearCachePattern('production_batches');
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: 'Production batch created successfully', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('newBatchModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else $('#newBatchModal').modal('hide');
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Failed to create batch');
                }
            }).catch((e) => {
                console.error('[Kernel Production] saveNewBatch failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to create batch', 'error');
            });
        }
    };
}();
