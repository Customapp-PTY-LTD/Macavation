/**
 * Modal: Kernel Dispatch – confirm dispatch for a batch (INV to customer).
 * Parent (kernel-dispatch grid) only loads this route into the container and calls show(batchId).
 */
var _modal_kernel_dispatch = function () {
    'use strict';

    var dispatchBatchId = null;

    return {
        init: () => {
            const scope = _modal_kernel_dispatch;
            var btn = document.getElementById('confirmDispatchBtn');
            if (btn) {
                btn.removeEventListener('click', scope._boundConfirm);
                scope._boundConfirm = function () { scope.confirmDispatch(); };
                btn.addEventListener('click', scope._boundConfirm);
            }
        },

        show: (batchId) => {
            const scope = _modal_kernel_dispatch;
            dispatchBatchId = batchId;
            var refInput = document.getElementById('dispatchBatchRef');
            if (refInput) refInput.value = '';
            var modalEl = document.getElementById('kernelDispatchModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#kernelDispatchModal').modal('show');
            }
        },

        confirmDispatch: async () => {
            const scope = _modal_kernel_dispatch;
            var batchId = dispatchBatchId;
            if (!batchId) return;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.updateProductionBatch) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Update not available', 'error');
                    return;
                }
                var result = await dataFunctions.updateProductionBatch(batchId, { status: 'dispatched', stage: 'dispatched' });
                if (result && result.success !== false) {
                    var modalEl = document.getElementById('kernelDispatchModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modal = bootstrap.Modal.getInstance(modalEl);
                        if (modal) modal.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#kernelDispatchModal').modal('hide');
                    }
                    dispatchBatchId = null;
                    if (typeof Swal !== 'undefined' && Swal.fire) {
                        Swal.fire({ icon: 'success', title: 'Dispatched', text: 'Batch marked as dispatched.', timer: 2000, showConfirmButton: false });
                    }
                    if (typeof _kernelDispatchGrid !== 'undefined' && _kernelDispatchGrid.loadBatches) {
                        await _kernelDispatchGrid.loadBatches(true);
                    }
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Error', e.message || 'Failed to dispatch', 'error');
                }
            }
        }
    };
}();
