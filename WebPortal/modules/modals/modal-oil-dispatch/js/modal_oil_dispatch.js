/**
 * Modal: Oil Dispatch – view dispatch order (basket). Grid calls showOrder(orderId) to show basket (order + lines).
 * Mirrors modal_kernel_dispatch with oil-specific IDs and getOilDispatchOrder.
 */
var _modal_oil_dispatch = (function () {
    'use strict';

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
            const scope = _modal_oil_dispatch;
            scope.initHandlers();
        },

        initHandlers: () => {},

        showOrder: async (orderId) => {
            const scope = _modal_oil_dispatch;
            var viewBasket = document.getElementById('oilDispatchViewBasket');
            var titleEl = document.getElementById('oilDispatchModalLabel');
            if (viewBasket) viewBasket.style.display = 'none';
            if (titleEl) titleEl.textContent = 'Oil dispatch order';

            if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.getOilDispatchOrder) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Cannot load order', 'error');
                return;
            }
            try {
                var data = await dataFunctions.getOilDispatchOrder(orderId);
                if (!data || !data.order) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Order not found', 'error');
                    return;
                }
                var order = data.order;
                var lines = Array.isArray(data.lines) ? data.lines : [];

                var buyerEl = document.getElementById('oilDispatchOrderBuyer');
                var deliveryEl = document.getElementById('oilDispatchOrderDelivery');
                var statusEl = document.getElementById('oilDispatchOrderStatus');
                var tbody = document.getElementById('oilDispatchOrderLinesBody');
                if (buyerEl) buyerEl.textContent = order.buyer_name || '—';
                if (deliveryEl) deliveryEl.textContent = formatDate(order.delivery_date);
                if (statusEl) statusEl.textContent = order.status || '—';
                if (tbody) {
                    tbody.innerHTML = '';
                    lines.forEach(function (line) {
                        var tr = document.createElement('tr');
                        var qtyKg = line.quantity_kg != null ? Number(line.quantity_kg) : null;
                        var qtyDisplay = (line.cartons != null && line.cartons >= 0)
                            ? (line.cartons + ' ct · ' + (qtyKg != null ? qtyKg : '—') + ' kg')
                            : (qtyKg != null ? qtyKg + ' kg' : '—');
                        tr.innerHTML = '<td>' + (line.batch_number || '—') + '</td><td>' + (line.style || '—') + '</td><td class="text-end">' + qtyDisplay + '</td>';
                        tbody.appendChild(tr);
                    });
                }
                if (viewBasket) viewBasket.style.display = 'block';
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', e.message || 'Failed to load order', 'error');
                return;
            }

            var modalEl = document.getElementById('oilDispatchModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#oilDispatchModal').modal('show');
            }
        },
    };
}());
_modal_oil_dispatch.init();
