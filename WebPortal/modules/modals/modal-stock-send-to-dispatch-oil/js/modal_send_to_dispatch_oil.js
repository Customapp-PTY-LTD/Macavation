/**
 * Modal: Send to Dispatch (Oil & Protein).
 * Step 1: Enter buyer + delivery date.
 * Step 2: Select oil lots, enter qty (kg) to send, add to basket; then send dispatch order.
 */
var _modal_stock_send_to_dispatch_oil = (function () {
    'use strict';

    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var _dispatchOilLines = [];
    var _pendingDetails = null;

    function deliveryDateToISO(displayStr) {
        if (!displayStr || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(displayStr.trim())) return null;
        var parts = displayStr.trim().split('/');
        return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
    }

    function deliveryDateFromISO(isoStr) {
        if (!isoStr) return '';
        var parts = String(isoStr).split('T')[0].split('-');
        if (parts.length !== 3) return isoStr;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    var api = {
        init: function () {
            $(document).off('click.dispatchOilModal', '#dispatchOilModalSelectLotsBtn').on('click.dispatchOilModal', '#dispatchOilModalSelectLotsBtn', function (e) {
                e.preventDefault();
                api.onNextSelectLots();
            });
            $(document).off('click.dispatchOilModal', '#dispatchOilModalBackBtn').on('click.dispatchOilModal', '#dispatchOilModalBackBtn', function (e) {
                e.preventDefault();
                api.showStep1();
            });
            $(document).off('click.dispatchOilModal', '#dispatchOilModalSendBtn').on('click.dispatchOilModal', '#dispatchOilModalSendBtn', function (e) {
                e.preventDefault();
                api.onSend();
            });
            $(document).off('change.dispatchOilModal', '#dispatchOilBuyerContact').on('change.dispatchOilModal', '#dispatchOilBuyerContact', function () {
                var sel = this.options[this.selectedIndex];
                var buyerInput = document.getElementById('dispatchOilBuyer');
                if (sel && sel.value && buyerInput) {
                    buyerInput.value = sel.getAttribute('data-buyer-name') || sel.textContent || '';
                    buyerInput.classList.remove('is-invalid');
                }
            });
            $(document).off('input.dispatchOilModalValid', '#sendToDispatchOilModal .is-invalid').on('input.dispatchOilModalValid', '#sendToDispatchOilModal .is-invalid', function () {
                $(this).removeClass('is-invalid');
            });
            $(document).off('click.dispatchOilAdd', '#sendToDispatchOilModal .js-dispatch-oil-add-btn').on('click.dispatchOilAdd', '#sendToDispatchOilModal .js-dispatch-oil-add-btn', function (e) {
                e.preventDefault();
                var lotId = $(this).data('lot-id');
                var input = document.getElementById('dispatchOilQty_' + lotId);
                var qty = input ? parseFloat(input.value) : NaN;
                if (!lotId || isNaN(qty) || qty <= 0) return;
                var lots = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.oilLots) ? _stockManagementGrid.oilLots : [];
                var lot = lots.find(function (l) { return String(l.id) === String(lotId); });
                if (!lot) return;
                var available = (lot.kilograms != null && lot.kilograms !== '') ? parseFloat(lot.kilograms) : 0;
                if (qty > available) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Invalid quantity', 'Qty cannot exceed available ' + available + ' kg for this lot.', 'warning');
                    return;
                }
                var style = (lot.product_description || lot.product_code || '').trim() || '—';
                var batchNumber = (lot.batch_number || '').toString();
                var existing = _dispatchOilLines.find(function (l) { return String(l.oil_lot_id) === String(lotId); });
                if (existing) {
                    var newQty = (parseFloat(existing.quantity_kg) || 0) + qty;
                    if (newQty > available) newQty = available;
                    existing.quantity_kg = Math.round(newQty * 100) / 100;
                } else {
                    _dispatchOilLines.push({
                        oil_lot_id: lot.id,
                        batch_number: batchNumber,
                        style: style,
                        quantity_kg: Math.round(qty * 100) / 100
                    });
                }
                if (input) input.value = '';
                api.renderOilLotsTable();
                api.renderBasket();
            });
            $(document).off('click.dispatchOilBasketRemove', '#sendToDispatchOilModal .js-dispatch-oil-basket-remove').on('click.dispatchOilBasketRemove', '#sendToDispatchOilModal .js-dispatch-oil-basket-remove', function (e) {
                e.preventDefault();
                var lotId = $(this).data('lot-id');
                _dispatchOilLines = _dispatchOilLines.filter(function (l) { return String(l.oil_lot_id) !== String(lotId); });
                api.renderOilLotsTable();
                api.renderBasket();
            });

            if (typeof $ !== 'undefined') {
                $(document).on('shown.bs.modal', '#sendToDispatchOilModal', function () {
                    var deliveryInput = document.getElementById('dispatchOilDeliveryDate');
                    if (deliveryInput && !deliveryInput._flatpickr && typeof flatpickr !== 'undefined') {
                        flatpickr(deliveryInput, FLATPICKR_DDMMYYYY);
                    }
                    if (deliveryInput && deliveryInput._flatpickr) {
                        deliveryInput._flatpickr.setDate(new Date());
                    }
                });
            }
        },

        showStep1: function () {
            var step1 = document.getElementById('sendToDispatchOilStep1');
            var step2 = document.getElementById('sendToDispatchOilStep2');
            var footer1 = document.getElementById('sendToDispatchOilStep1Footer');
            var footer2 = document.getElementById('sendToDispatchOilStep2Footer');
            if (step1) step1.style.display = '';
            if (step2) step2.style.display = 'none';
            if (footer1) footer1.style.display = '';
            if (footer2) footer2.style.display = 'none';
        },

        showStep2: function (details) {
            var step1 = document.getElementById('sendToDispatchOilStep1');
            var step2 = document.getElementById('sendToDispatchOilStep2');
            var footer1 = document.getElementById('sendToDispatchOilStep1Footer');
            var footer2 = document.getElementById('sendToDispatchOilStep2Footer');
            if (step1) step1.style.display = 'none';
            if (step2) step2.style.display = '';
            if (footer1) footer1.style.display = 'none';
            if (footer2) footer2.style.display = '';
            var d = details || _pendingDetails || {};
            var buyerLabelEl = document.getElementById('sendToDispatchOilStep2BuyerLabel');
            var deliveryLabelEl = document.getElementById('sendToDispatchOilStep2DeliveryLabel');
            if (buyerLabelEl) buyerLabelEl.textContent = d.buyer_name || '—';
            if (deliveryLabelEl) deliveryLabelEl.textContent = (d.delivery_date ? deliveryDateFromISO(d.delivery_date) : '') || '—';
            api.renderOilLotsTable();
            api.renderBasket();
        },

        renderOilLotsTable: function () {
            var lots = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.oilLots) ? _stockManagementGrid.oilLots : [];
            var body = document.getElementById('dispatchOilLotsTableBody');
            if (!body) return;
            body.innerHTML = '';
            if (lots.length === 0) {
                body.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No oil lots available. Load Stock (Oil &amp; Protein) and ensure lots are loaded.</td></tr>';
                return;
            }
            lots.forEach(function (lot) {
                var available = (lot.kilograms != null && lot.kilograms !== '') ? parseFloat(lot.kilograms) : 0;
                var displayKg = (available > 0) ? Number(lot.kilograms).toFixed(2) : '0.00';
                var product = (lot.product_description || lot.product_code || '—').toString().replace(/"/g, '&quot;');
                var batchNum = (lot.batch_number || '—').toString().replace(/"/g, '&quot;');
                var inBasket = _dispatchOilLines.find(function (l) { return String(l.oil_lot_id) === String(lot.id); });
                var basketQty = inBasket ? (inBasket.quantity_kg || 0) : 0;
                var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + (lot.location_code || '') + '</td>' +
                    '<td><span class="badge bg-secondary">' + batchNum + '</span></td>' +
                    '<td>' + (lot.product_description || lot.product_code || '—') + '</td>' +
                    '<td class="text-end">' + (lot.grade || '') + '</td>' +
                    '<td class="text-end">' + displayKg + '</td>' +
                    '<td class="text-end"><input type="number" step="0.01" min="0" max="' + available + '" class="form-control form-control-sm d-inline-block text-end" style="width:100px" id="dispatchOilQty_' + lot.id + '" placeholder="0"></td>' +
                    '<td><button type="button" class="btn btn-sm btn-outline-primary js-dispatch-oil-add-btn" data-lot-id="' + lot.id + '" title="Add to basket">Add</button>' +
                    (basketQty > 0 ? ' <span class="text-success small">(' + basketQty + ' kg in basket)</span>' : '') + '</td>';
                body.appendChild(tr);
            });
        },

        renderBasket: function () {
            var basketEl = document.getElementById('dispatchOilModalBasket');
            var basketBody = document.getElementById('dispatchOilModalBasketBody');
            var basketTotal = document.getElementById('dispatchOilModalBasketTotal');
            var sendBtn = document.getElementById('dispatchOilModalSendBtn');
            if (!basketBody) return;
            if (_dispatchOilLines.length === 0) {
                if (basketEl) basketEl.style.display = 'none';
                if (sendBtn) sendBtn.disabled = true;
                return;
            }
            if (basketEl) basketEl.style.display = '';
            if (sendBtn) sendBtn.disabled = false;
            var totalKg = 0;
            var html = '';
            _dispatchOilLines.forEach(function (line) {
                var qty = parseFloat(line.quantity_kg) || 0;
                totalKg += qty;
                var lotId = (line.oil_lot_id !== undefined && line.oil_lot_id !== null) ? String(line.oil_lot_id).replace(/"/g, '&quot;') : '';
                html += '<tr><td><span class="badge bg-primary">' + (line.batch_number || '—') + '</span></td>' +
                    '<td>' + (line.style !== undefined && line.style !== null ? String(line.style).replace(/</g, '&lt;') : '—') + '</td>' +
                    '<td class="text-end">' + qty.toFixed(2) + ' kg</td>' +
                    '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger js-dispatch-oil-basket-remove" title="Remove" data-lot-id="' + lotId + '"><i class="fas fa-times"></i></button></td></tr>';
            });
            basketBody.innerHTML = html;
            if (basketTotal) basketTotal.textContent = 'Total: ' + totalKg.toFixed(1) + ' kg';
        },

        show: function () {
            _dispatchOilLines = [];
            _pendingDetails = null;
            api.showStep1();
            var buyerInput = document.getElementById('dispatchOilBuyer');
            var buyerSelect = document.getElementById('dispatchOilBuyerContact');
            var deliveryInput = document.getElementById('dispatchOilDeliveryDate');
            if (buyerInput) { buyerInput.value = ''; buyerInput.classList.remove('is-invalid'); }
            if (deliveryInput && deliveryInput._flatpickr) {
                deliveryInput._flatpickr.setDate(new Date());
            } else if (deliveryInput) {
                deliveryInput.value = '';
                deliveryInput.classList.remove('is-invalid');
            }
            if (buyerSelect) {
                buyerSelect.innerHTML = '<option value="">— Select contact —</option>';
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getContacts) {
                    dataFunctions.getContacts(null, true).then(function (contacts) {
                        if (Array.isArray(contacts)) {
                            contacts.forEach(function (c) {
                                var name = c.company_name || c.trading_name || c.primary_contact_name || c.id;
                                if (!name) return;
                                var opt = document.createElement('option');
                                opt.value = c.id;
                                opt.textContent = name;
                                opt.setAttribute('data-buyer-name', name);
                                buyerSelect.appendChild(opt);
                            });
                        }
                    }).catch(function () {});
                }
            }
            var modalEl = document.getElementById('sendToDispatchOilModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#sendToDispatchOilModal').modal('show');
            }
        },

        onNextSelectLots: function () {
            var buyerInput = document.getElementById('dispatchOilBuyer');
            var buyerSelect = document.getElementById('dispatchOilBuyerContact');
            var deliveryInput = document.getElementById('dispatchOilDeliveryDate');
            var buyerName = (buyerInput && buyerInput.value && buyerInput.value.trim()) ? buyerInput.value.trim() : null;
            if (!buyerName) {
                if (buyerInput) buyerInput.classList.add('is-invalid');
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', 'Please enter the buyer name.', 'warning');
                return;
            }
            var deliveryDisplay = deliveryInput && deliveryInput.value ? deliveryInput.value.trim() : null;
            var deliveryDateISO = deliveryDisplay ? deliveryDateToISO(deliveryDisplay) : null;
            if (!deliveryDateISO) {
                if (deliveryInput) deliveryInput.classList.add('is-invalid');
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', 'Please select the delivery date.', 'warning');
                return;
            }
            _pendingDetails = {
                buyer_name: buyerName,
                buyer_contact_id: (buyerSelect && buyerSelect.value) ? buyerSelect.value : null,
                delivery_date: deliveryDateISO
            };
            api.showStep2(_pendingDetails);
        },

        onSend: function () {
            if (!_pendingDetails || !_pendingDetails.buyer_name) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Buyer details missing. Please go back and enter them.', 'error');
                return;
            }
            if (_dispatchOilLines.length === 0) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', 'Please add at least one lot to the basket.', 'warning');
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createOilDispatchOrder) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Dispatch function not available. Please refresh.', 'error');
                return;
            }
            var lines = _dispatchOilLines.map(function (l) {
                return {
                    batch_number: l.batch_number || null,
                    style: l.style || null,
                    quantity_kg: l.quantity_kg != null ? l.quantity_kg : null,
                    oil_batch_id: l.oil_lot_id != null ? l.oil_lot_id : null
                };
            });
            var sendBtn = document.getElementById('dispatchOilModalSendBtn');
            if (sendBtn) sendBtn.disabled = true;
            dataFunctions.createOilDispatchOrder({
                buyer_name: _pendingDetails.buyer_name,
                buyer_contact_id: _pendingDetails.buyer_contact_id || null,
                delivery_date: _pendingDetails.delivery_date,
                lines: lines
            }).then(function (result) {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined' && Swal.fire) {
                        Swal.fire({ icon: 'success', title: 'Order created', text: 'Oil dispatch order has been created. You can view it under Oil & Protein Dispatch.', timer: 3000, showConfirmButton: true });
                    }
                    var modalEl = document.getElementById('sendToDispatchOilModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#sendToDispatchOilModal').modal('hide');
                    }
                    if (typeof _oilDispatchGrid !== 'undefined' && _oilDispatchGrid.loadOrders) _oilDispatchGrid.loadOrders(true);
                } else {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', (result && (result.error || result.message)) || 'Failed to create order', 'error');
                    if (sendBtn) sendBtn.disabled = false;
                }
            }).catch(function (e) {
                console.error('[Send to Dispatch Oil] createOilDispatchOrder failed:', e);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', e.message || 'Failed to create dispatch order', 'error');
                if (sendBtn) sendBtn.disabled = false;
            });
        }
    };

    return api;
})();
