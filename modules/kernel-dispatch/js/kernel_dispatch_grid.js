/**
 * Kernel Dispatch - INV from KERNEL R YES → KERNEL CUSTOMERS → DEBTORS.
 * Lists batches in_finished_stock and marks them dispatched.
 */
var _kernelDispatchGrid = function () {
    return {
        batches: [],
        dispatchBatchId: null,
        init: function () {
            var scope = this;
            $('#kernelDispatchRefreshBtn').on('click', function () { scope.loadBatches(true); });
            $('#confirmDispatchBtn').on('click', function () { scope.confirmDispatch(); });
            $(document).on('click', '.js-dispatch-batch', function () {
                var id = $(this).data('batch-id');
                if (id) scope.showDispatchModal(id);
            });
            this.loadBatches();
        },
        loadBatches: async function (forceRefresh) {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getProductionBatches) {
                    this.batches = [];
                    this.render();
                    return;
                }
                var all = await dataFunctions.getProductionBatches(null, forceRefresh, { batch_type: 'kernel' });
                all = all || [];
                this.batches = all.filter(function (b) { return b.status === 'in_finished_stock'; });
                this.render();
            } catch (e) {
                console.error('[Kernel Dispatch] loadBatches failed:', e);
                this.batches = [];
                this.render();
            }
        },
        render: function () {
            var tbody = $('#kernelDispatchTableBody');
            tbody.empty();
            if (!this.batches.length) {
                tbody.html('<tr><td colspan="5" class="text-center text-muted py-4">No batches ready to dispatch. Complete production (step 17) to move batches to finished stock.</td></tr>');
                return;
            }
            this.batches.forEach(function (b) {
                tbody.append('<tr><td>' + (b.batch_number || '') + '</td><td>' + (b.grower_name || '') + '</td><td>' + (b.received_date || '') + '</td><td>' + (b.wet_nis_received_kg || '') + '</td><td><button type="button" class="btn btn-sm btn-success js-dispatch-batch" data-batch-id="' + b.id + '"><i class="fas fa-truck me-1"></i>Dispatch</button></td></tr>');
            });
        },
        showDispatchModal: function (batchId) {
            this.dispatchBatchId = batchId;
            $('#dispatchBatchRef').val('');
            var modal = document.getElementById('kernelDispatchModal');
            if (modal && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                new bootstrap.Modal(modal).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#kernelDispatchModal').modal('show');
            }
        },
        confirmDispatch: async function () {
            var batchId = this.dispatchBatchId;
            if (!batchId) return;
            try {
                var result = await dataFunctions.updateProductionBatch(batchId, { status: 'dispatched', stage: 'dispatched' });
                if (result && result.success !== false) {
                    if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modal = bootstrap.Modal.getInstance(document.getElementById('kernelDispatchModal'));
                        if (modal) modal.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#kernelDispatchModal').modal('hide');
                    }
                    this.dispatchBatchId = null;
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Dispatched', text: 'Batch marked as dispatched.', timer: 2000, showConfirmButton: false });
                    this.loadBatches(true);
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
var kernelDispatchGrid = _kernelDispatchGrid;
function initializeKernelDispatchGrid() {
    if (typeof kernelDispatchGrid !== 'undefined') kernelDispatchGrid.init();
}
