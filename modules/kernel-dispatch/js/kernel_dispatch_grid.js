/**
 * Kernel Dispatch - INV from KERNEL R YES → KERNEL CUSTOMERS → DEBTORS.
 * Lists batches in_finished_stock and marks them dispatched.
 */
var _kernelDispatchGrid = function () {
    'use strict';

    return {
        batches: [],
        dispatchBatchId: null,
        _handlersBound: false,

        init: async () => {
            const scope = _kernelDispatchGrid;
            scope.initHandlers();
            await scope.loadBatches();
        },

        initHandlers: () => {
            const scope = _kernelDispatchGrid;
            $('#kernelDispatchRefreshBtn').off('click').on('click', () => scope.loadBatches(true));
            $('#confirmDispatchBtn').off('click').on('click', () => scope.confirmDispatch());
            if (!scope._handlersBound) {
                scope._handlersBound = true;
                $(document).on('click', '.js-dispatch-batch', function () {
                    const id = $(this).data('batch-id');
                    if (id) scope.showDispatchModal(id);
                });
            }
        },

        loadBatches: async (forceRefresh) => {
            const scope = _kernelDispatchGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getProductionBatches) {
                    scope.batches = [];
                    scope.render();
                    return;
                }
                let all = await dataFunctions.getProductionBatches(null, forceRefresh, { batch_type: 'kernel' });
                all = all || [];
                scope.batches = all.filter((b) => b.status === 'in_finished_stock');
                scope.render();
            } catch (e) {
                console.error('[Kernel Dispatch] loadBatches failed:', e);
                scope.batches = [];
                scope.render();
            }
        },

        render: () => {
            const scope = _kernelDispatchGrid;
            const tbody = $('#kernelDispatchTableBody');
            tbody.empty();
            if (!scope.batches.length) {
                tbody.html('<tr><td colspan="5" class="text-center text-muted py-4">No batches ready to dispatch. Complete production (step 17) to move batches to finished stock.</td></tr>');
                return;
            }
            const formatDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) ? _common.formatDateDDMMYYYY : (v) => v || '';
            scope.batches.forEach((b) => {
                const dateStr = formatDate(b.received_date) || (b.received_date || '');
                tbody.append('<tr><td>' + (b.batch_number || '') + '</td><td>' + (b.grower_name || '') + '</td><td>' + dateStr + '</td><td>' + (b.wet_nis_received_kg || '') + '</td><td><button type="button" class="btn btn-sm btn-success js-dispatch-batch" data-batch-id="' + b.id + '"><i class="fas fa-truck me-1"></i>Dispatch</button></td></tr>');
            });
        },

        showDispatchModal: (batchId) => {
            const scope = _kernelDispatchGrid;
            scope.dispatchBatchId = batchId;
            $('#dispatchBatchRef').val('');
            const modal = document.getElementById('kernelDispatchModal');
            if (modal && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                new bootstrap.Modal(modal).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#kernelDispatchModal').modal('show');
            }
        },

        confirmDispatch: async () => {
            const scope = _kernelDispatchGrid;
            const batchId = scope.dispatchBatchId;
            if (!batchId) return;
            try {
                const result = await dataFunctions.updateProductionBatch(batchId, { status: 'dispatched', stage: 'dispatched' });
                if (result && result.success !== false) {
                    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        const modalEl = document.getElementById('kernelDispatchModal');
                        const modal = modalEl && bootstrap.Modal.getInstance(modalEl);
                        if (modal) modal.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#kernelDispatchModal').modal('hide');
                    }
                    scope.dispatchBatchId = null;
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Dispatched', text: 'Batch marked as dispatched.', timer: 2000, showConfirmButton: false });
                    await scope.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to dispatch', 'error');
            }
        }
    };
}();

_kernelDispatchGrid.init();
