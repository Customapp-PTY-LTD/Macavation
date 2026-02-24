/**
 * Modal: Kernel Dispatch – view dispatch order (basket) or confirm single batch.
 * Grid calls showOrder(orderId) to show basket (order + styles/lines).
 */
var _modal_kernel_dispatch = (function () {
    'use strict';

    var dispatchBatchId = null;

    var formatDate = function (v) {
        if (!v) return '';
        if (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) return _common.formatDateDDMMYYYY(v);
        var d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return '';
        var day = String(d.getDate()).padStart(2, '0');
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var year = d.getFullYear();
        return day + '/' + month + '/' + year;
    };

    return {
        init: () => {
            const scope = _modal_kernel_dispatch;
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_kernel_dispatch;
            $('#confirmDispatchBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.confirmDispatch();
            });
        },

        showOrder: async (orderId) => {
            const scope = _modal_kernel_dispatch;
            var viewBasket = document.getElementById('kernelDispatchViewBasket');
            var confirmBatch = document.getElementById('kernelDispatchConfirmBatch');
            var titleEl = document.getElementById('kernelDispatchModalLabel');
            if (viewBasket) viewBasket.style.display = 'none';
            if (confirmBatch) confirmBatch.style.display = 'none';
            if (titleEl) titleEl.textContent = 'Dispatch order';

            if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.getKernelDispatchOrder) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Cannot load order', 'error');
                return;
            }
            try {
                var data = await dataFunctions.getKernelDispatchOrder(orderId);
                if (!data || !data.order) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Order not found', 'error');
                    return;
                }
                var order = data.order;
                var lines = Array.isArray(data.lines) ? data.lines : [];

                var buyerEl = document.getElementById('kernelDispatchOrderBuyer');
                var deliveryEl = document.getElementById('kernelDispatchOrderDelivery');
                var statusEl = document.getElementById('kernelDispatchOrderStatus');
                var tbody = document.getElementById('kernelDispatchOrderLinesBody');
                if (buyerEl) buyerEl.textContent = order.buyer_name || '—';
                if (deliveryEl) deliveryEl.textContent = formatDate(order.delivery_date);
                if (statusEl) statusEl.textContent = order.status || '—';
                if (tbody) {
                    tbody.innerHTML = '';
                    lines.forEach(function (line) {
                        var tr = document.createElement('tr');
                        tr.innerHTML = '<td>' + (line.batch_number || '—') + '</td><td>' + (line.style || '—') + '</td><td class="text-end">' + (line.quantity_kg != null ? Number(line.quantity_kg) : '—') + '</td>';
                        tbody.appendChild(tr);
                    });
                }
                if (viewBasket) viewBasket.style.display = 'block';
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', e.message || 'Failed to load order', 'error');
                return;
            }

            var modalEl = document.getElementById('kernelDispatchModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#kernelDispatchModal').modal('show');
            }
        },

        show: (batchId) => {
            const scope = _modal_kernel_dispatch;
            dispatchBatchId = batchId;
            var viewBasket = document.getElementById('kernelDispatchViewBasket');
            var confirmBatch = document.getElementById('kernelDispatchConfirmBatch');
            var titleEl = document.getElementById('kernelDispatchModalLabel');
            if (viewBasket) viewBasket.style.display = 'none';
            if (confirmBatch) confirmBatch.style.display = 'block';
            if (titleEl) titleEl.textContent = 'Dispatch batch';
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
                    if (typeof _kernelDispatchGrid !== 'undefined' && _kernelDispatchGrid.loadOrders) {
                        await _kernelDispatchGrid.loadOrders(true);
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
}());
_modal_kernel_dispatch.init();
