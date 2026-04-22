/**
 * Modal: edit kernel dispatch order (buyer, dates, line cartons) before dispatched.
 */
var _modal_kernel_dispatch_edit = (function () {
    'use strict';

    var _flatpickrDelivery = null;
    var _flatpickrBestBefore = null;

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function formatDateForDisplay(v) {
        if (!v) return '';
        if (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) return _common.formatDateDDMMYYYY(v);
        var d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return '';
        var day = String(d.getDate()).padStart(2, '0');
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var year = d.getFullYear();
        return day + '/' + month + '/' + year;
    }

    function parseLines(data) {
        var lines = data && data.lines;
        if (lines == null) return [];
        if (typeof lines === 'string') {
            try {
                lines = JSON.parse(lines);
            } catch (e) {
                return [];
            }
        }
        return Array.isArray(lines) ? lines : [];
    }

    function isoFromDdMmYyyy(displayStr) {
        if (!displayStr || typeof displayStr !== 'string') return null;
        var t = displayStr.trim();
        var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
        if (!m) return null;
        var d = parseInt(m[1], 10);
        var mo = parseInt(m[2], 10);
        var y = parseInt(m[3], 10);
        if (isNaN(d) || isNaN(mo) || isNaN(y)) return null;
        return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    }

    function destroyPickers() {
        if (_flatpickrDelivery) {
            _flatpickrDelivery.destroy();
            _flatpickrDelivery = null;
        }
        if (_flatpickrBestBefore) {
            _flatpickrBestBefore.destroy();
            _flatpickrBestBefore = null;
        }
    }

    return {
        init: function () {
            var $modal = $('#kernelDispatchEditModal');
            if (!$modal.length) return;

            $modal.off('shown.bs.modal.kdispatchEdit').on('shown.bs.modal.kdispatchEdit', function () {
                destroyPickers();
                var opts = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
                var del = document.getElementById('kernelDispatchEditDelivery');
                var bb = document.getElementById('kernelDispatchEditBestBefore');
                if (typeof flatpickr !== 'undefined') {
                    if (del) _flatpickrDelivery = flatpickr(del, opts);
                    if (bb) _flatpickrBestBefore = flatpickr(bb, opts);
                }
            });
            $modal.off('hidden.bs.modal.kdispatchEdit').on('hidden.bs.modal.kdispatchEdit', function () {
                destroyPickers();
            });

            $('#kernelDispatchEditSaveBtn').off('click.kernelDispatchEdit').on('click.kernelDispatchEdit', function (e) {
                e.preventDefault();
                _modal_kernel_dispatch_edit.submit();
            });
        },

        show: function (orderId) {
            if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.getKernelDispatchOrder) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Cannot load order', 'error');
                return;
            }
            $('#kernelDispatchEditOrderId').val(orderId);
            dataFunctions.getKernelDispatchOrder(orderId).then(function (data) {
                if (!data || !data.order) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Order not found', 'error');
                    return;
                }
                var order = data.order;
                var st = (order.status || '').toLowerCase();
                if (st === 'dispatched') {
                    if (typeof Swal !== 'undefined') Swal.fire('Info', 'This order has already been dispatched and cannot be edited.', 'info');
                    return;
                }
                $('#kernelDispatchEditBuyer').val(order.buyer_name || '');
                $('#kernelDispatchEditDelivery').val(formatDateForDisplay(order.delivery_date));
                $('#kernelDispatchEditBestBefore').val(formatDateForDisplay(order.best_before_date));

                var tbody = document.getElementById('kernelDispatchEditLinesBody');
                tbody.innerHTML = '';
                var lines = parseLines(data);
                lines.forEach(function (line) {
                    var kid = escapeHtml(line.kernel_id || '');
                    var bn = escapeHtml(line.batch_number || '—');
                    var stl = escapeHtml(line.style || '—');
                    var ct = line.cartons != null ? Number(line.cartons) : (line.quantity_kg != null ? Math.round(Number(line.quantity_kg) / 11.34) : 0);
                    if (isNaN(ct) || ct < 0) ct = 0;
                    var tr = document.createElement('tr');
                    tr.setAttribute('data-kernel-id', line.kernel_id || '');
                    tr.setAttribute('data-style', line.style || '');
                    tr.setAttribute('data-batch-number', line.batch_number || '');
                    tr.innerHTML = '<td>' + bn + '</td><td>' + stl + '</td><td class="text-end">' +
                        '<input type="number" class="form-control form-control-sm text-end js-kernel-dispatch-edit-cartons" min="0" step="1" value="' + ct + '">' +
                        '</td>';
                    tbody.appendChild(tr);
                });
                if (!lines.length) {
                    tbody.innerHTML = '<tr><td colspan="3" class="text-muted text-center py-2">No lines on this order.</td></tr>';
                }

                var modalEl = document.getElementById('kernelDispatchEditModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getOrCreateInstance(modalEl).show();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#kernelDispatchEditModal').modal('show');
                }
            }).catch(function (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', (e && e.message) || 'Failed to load order', 'error');
            });
        },

        submit: function () {
            var orderId = $('#kernelDispatchEditOrderId').val();
            if (!orderId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Order not found', 'error');
                return;
            }
            var buyer = ($('#kernelDispatchEditBuyer').val() || '').trim();
            if (!buyer) {
                if (typeof Swal !== 'undefined') Swal.fire('Validation', 'Buyer is required.', 'warning');
                return;
            }

            var deliveryIso = null;
            if (_flatpickrDelivery && _flatpickrDelivery.selectedDates && _flatpickrDelivery.selectedDates.length) {
                var d = _flatpickrDelivery.selectedDates[0];
                deliveryIso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            } else {
                deliveryIso = isoFromDdMmYyyy($('#kernelDispatchEditDelivery').val() || '');
            }
            if (!deliveryIso) {
                if (typeof Swal !== 'undefined') Swal.fire('Validation', 'Please set a valid delivery date.', 'warning');
                return;
            }

            var bestBeforeIso = null;
            if (_flatpickrBestBefore && _flatpickrBestBefore.selectedDates && _flatpickrBestBefore.selectedDates.length) {
                var b = _flatpickrBestBefore.selectedDates[0];
                bestBeforeIso = b.getFullYear() + '-' + String(b.getMonth() + 1).padStart(2, '0') + '-' + String(b.getDate()).padStart(2, '0');
            } else {
                var bbRaw = ($('#kernelDispatchEditBestBefore').val() || '').trim();
                if (bbRaw) bestBeforeIso = isoFromDdMmYyyy(bbRaw);
            }

            var lines = [];
            $('#kernelDispatchEditLinesBody tr').each(function () {
                var $tr = $(this);
                var kid = $tr.attr('data-kernel-id');
                if (!kid) return;
                var style = $tr.attr('data-style');
                var batchNumber = $tr.attr('data-batch-number');
                var inp = $tr.find('.js-kernel-dispatch-edit-cartons')[0];
                var n = inp ? parseInt(inp.value, 10) : 0;
                if (isNaN(n) || n < 0) n = 0;
                lines.push({
                    kernel_id: String(kid),
                    batch_number: batchNumber != null ? String(batchNumber) : '',
                    style: style != null ? String(style) : '',
                    cartons: n
                });
            });

            if (!lines.length) {
                if (typeof Swal !== 'undefined') Swal.fire('Validation', 'Order has no lines to save.', 'warning');
                return;
            }

            if (typeof dataFunctions === 'undefined' || !dataFunctions.updateKernelDispatchOrder) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Update is not available. Refresh the page after the latest deployment.', 'error');
                return;
            }

            dataFunctions.updateKernelDispatchOrder({
                order_id: orderId,
                buyer_name: buyer,
                delivery_date: deliveryIso,
                best_before_date: bestBeforeIso,
                lines: lines
            }).then(function (result) {
                if (result && result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
                    result = result.data;
                }
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Dispatch order updated.', timer: 1800, showConfirmButton: false });
                    var modalEl = document.getElementById('kernelDispatchEditModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var m = bootstrap.Modal.getInstance(modalEl);
                        if (m) m.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#kernelDispatchEditModal').modal('hide');
                    }
                    if (typeof _kernelDispatchGrid !== 'undefined' && _kernelDispatchGrid.loadOrders) {
                        _kernelDispatchGrid.loadOrders(true);
                    }
                } else {
                    throw new Error((result && result.error) || 'Update failed');
                }
            }).catch(function (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', (e && e.message) || 'Failed to save', 'error');
            });
        }
    };
})();
