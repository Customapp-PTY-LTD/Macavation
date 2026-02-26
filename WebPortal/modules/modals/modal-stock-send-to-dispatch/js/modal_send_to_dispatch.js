/**
 * Modal: Send to Dispatch.
 * Step 1: Enter buyer + delivery date.
 * Step 2: Shopping cart — browse kernel batches by style, pick quantities, then send.
 */
var _modal_stock_send_to_dispatch = (function () {
    'use strict';

    var STYLE_KEYS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var _dispatchLines = [];
    var _pendingDetails = null;
    var MAX_DROPDOWN_OPTIONS = 51;

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
            // Step 1 → 2
            $(document).off('click.dispatchModal', '#dispatchModalSelectBoxesBtn').on('click.dispatchModal', '#dispatchModalSelectBoxesBtn', function (e) {
                e.preventDefault();
                api.onNextSelectBoxes();
            });
            // Step 2 → back
            $(document).off('click.dispatchModal', '#dispatchModalBackBtn').on('click.dispatchModal', '#dispatchModalBackBtn', function (e) {
                e.preventDefault();
                api.showStep1();
            });
            // Send dispatch order
            $(document).off('click.dispatchModal', '#dispatchModalSendBtn').on('click.dispatchModal', '#dispatchModalSendBtn', function (e) {
                e.preventDefault();
                api.onSend();
            });
            // Buyer contact → autofill buyer name
            $(document).off('change.dispatchModal', '#dispatchBuyerContact').on('change.dispatchModal', '#dispatchBuyerContact', function () {
                var sel = this.options[this.selectedIndex];
                var buyerInput = document.getElementById('dispatchBuyer');
                if (sel && sel.value && buyerInput) {
                    buyerInput.value = sel.getAttribute('data-buyer-name') || sel.textContent || '';
                    buyerInput.classList.remove('is-invalid');
                }
            });
            // Clear invalid highlights on input
            $(document).off('input.dispatchModalValid', '#sendToDispatchModal .is-invalid').on('input.dispatchModalValid', '#sendToDispatchModal .is-invalid', function () {
                $(this).removeClass('is-invalid');
            });

            // Qty pick from shopping table
            $(document).off('click.dispatchShop', '#sendToDispatchModal .js-modal-dispatch-qty-pick').on('click.dispatchShop', '#sendToDispatchModal .js-modal-dispatch-qty-pick', function (e) {
                e.preventDefault();
                var batchId = String($(this).data('batch-id') || '');
                var style = String($(this).data('style') || '');
                var qty = parseInt($(this).data('quantity'), 10);
                if (!batchId || style === '' || isNaN(qty)) return;
                var batches = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.kernelFinishedBatches) ? _stockManagementGrid.kernelFinishedBatches : [];
                var batch = batches.find(function (b) { return b.id === batchId; });
                var batchNum = batch ? (batch.batch_number || batchId) : batchId;
                var idx = _dispatchLines.findIndex(function (l) { return l.kernel_id === batchId && String(l.style) === style; });
                if (qty <= 0) {
                    if (idx >= 0) _dispatchLines.splice(idx, 1);
                } else {
                    var line = { kernel_id: batchId, batch_number: batchNum, style: style, quantity_kg: qty };
                    if (idx >= 0) _dispatchLines[idx] = line; else _dispatchLines.push(line);
                }
                api.renderShoppingTable();
                api.renderBasket();
            });

            // "Other…" custom qty
            $(document).off('click.dispatchShopOther', '#sendToDispatchModal .js-modal-dispatch-qty-other').on('click.dispatchShopOther', '#sendToDispatchModal .js-modal-dispatch-qty-other', function (e) {
                e.preventDefault();
                var batchId = String($(this).data('batch-id') || '');
                var style = String($(this).data('style') || '');
                var maxQty = parseFloat($(this).data('max-qty')) || 0;
                if (!batchId || style === '' || maxQty <= 0) return;
                var batches = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.kernelFinishedBatches) ? _stockManagementGrid.kernelFinishedBatches : [];
                var batch = batches.find(function (b) { return b.id === batchId; });
                var batchNum = batch ? (batch.batch_number || batchId) : batchId;
                Swal.fire({
                    title: 'Enter quantity',
                    html: '<label class="form-label">Amount in kg (max ' + maxQty + ')</label><input type="number" id="dispatchModalOtherQtyInput" class="form-control" min="0.1" max="' + maxQty + '" value="1" step="0.1">',
                    showCancelButton: true,
                    confirmButtonText: 'Add',
                    focusConfirm: false,
                    preConfirm: function () {
                        var input = document.getElementById('dispatchModalOtherQtyInput');
                        var num = input ? parseFloat(input.value) : NaN;
                        if (isNaN(num) || num <= 0 || num > maxQty) {
                            Swal.showValidationMessage('Please enter a value between 0.1 and ' + maxQty + '.');
                            return false;
                        }
                        return num;
                    }
                }).then(function (result) {
                    if (result && result.isConfirmed && typeof result.value === 'number') {
                        var idx = _dispatchLines.findIndex(function (l) { return l.kernel_id === batchId && String(l.style) === style; });
                        var line = { kernel_id: batchId, batch_number: batchNum, style: style, quantity_kg: result.value };
                        if (idx >= 0) _dispatchLines[idx] = line; else _dispatchLines.push(line);
                        api.renderShoppingTable();
                        api.renderBasket();
                    }
                });
            });

            // Remove from basket
            $(document).off('click.dispatchBasketRemove', '#dispatchModalBasketBody .js-modal-basket-remove').on('click.dispatchBasketRemove', '#dispatchModalBasketBody .js-modal-basket-remove', function (e) {
                e.preventDefault();
                var batchId = String($(this).data('batch-id') || '');
                var style = String($(this).data('style') || '');
                var idx = _dispatchLines.findIndex(function (l) { return l.kernel_id === batchId && String(l.style) === style; });
                if (idx >= 0) _dispatchLines.splice(idx, 1);
                api.renderShoppingTable();
                api.renderBasket();
            });

            // Flatpickr init when modal opens
            if (typeof $ !== 'undefined') {
                $(document).on('shown.bs.modal', '#sendToDispatchModal', function () {
                    var deliveryInput = document.getElementById('dispatchDeliveryDate');
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
            var step1 = document.getElementById('sendToDispatchStep1');
            var step2 = document.getElementById('sendToDispatchStep2');
            var footer1 = document.getElementById('sendToDispatchStep1Footer');
            var footer2 = document.getElementById('sendToDispatchStep2Footer');
            if (step1) step1.style.display = '';
            if (step2) step2.style.display = 'none';
            if (footer1) footer1.style.display = '';
            if (footer2) footer2.style.display = 'none';
        },

        showStep2: function (details) {
            var step1 = document.getElementById('sendToDispatchStep1');
            var step2 = document.getElementById('sendToDispatchStep2');
            var footer1 = document.getElementById('sendToDispatchStep1Footer');
            var footer2 = document.getElementById('sendToDispatchStep2Footer');
            if (step1) step1.style.display = 'none';
            if (step2) step2.style.display = '';
            if (footer1) footer1.style.display = 'none';
            if (footer2) footer2.style.display = '';
            var d = details || _pendingDetails || {};
            var buyerLabelEl = document.getElementById('sendToDispatchStep2BuyerLabel');
            var deliveryLabelEl = document.getElementById('sendToDispatchStep2DeliveryLabel');
            if (buyerLabelEl) buyerLabelEl.textContent = d.buyer_name || '—';
            if (deliveryLabelEl) deliveryLabelEl.textContent = (d.delivery_date ? deliveryDateFromISO(d.delivery_date) : '') || '—';
            api.renderShoppingTable();
            api.renderBasket();
        },

        renderShoppingTable: function () {
            var batches = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.kernelFinishedBatches) ? _stockManagementGrid.kernelFinishedBatches : [];
            var body = document.getElementById('dispatchShoppingBody');
            var totalsRow = document.getElementById('dispatchShoppingTotalsRow');
            if (!body) return;
            body.innerHTML = '';
            var totals = {};
            STYLE_KEYS.forEach(function (k) { totals[k] = 0; });
            if (batches.length === 0) {
                body.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-3">No stock available.</td></tr>';
                return;
            }
            batches.forEach(function (b) {
                var cells = (b.remaining_by_style && typeof b.remaining_by_style === 'object') ? b.remaining_by_style : null;
                if (cells == null) cells = (b.yield_by_style && typeof b.yield_by_style === 'object') ? b.yield_by_style : {};
                var batchId = b.id || '';
                var batchNum = (b.batch_number || '').toString().replace(/"/g, '&quot;');
                var tr = document.createElement('tr');
                var html = '<td><span class="badge bg-secondary">' + batchNum + '</span></td>';
                STYLE_KEYS.forEach(function (k) {
                    var val = cells[k] != null ? cells[k] : (b['yield_' + k] != null ? b['yield_' + k] : 0);
                    if (typeof val === 'number') totals[k] += val;
                    var qty = (typeof val === 'number' && val > 0) ? val : 0;
                    var displayVal = (qty > 0) ? qty : '—';
                    var selectedLine = _dispatchLines.find(function (l) { return l.kernel_id === batchId && String(l.style) === k; });
                    if (qty > 0) {
                        var cellId = 'dshop_' + (batchId + '_' + k).replace(/[^a-zA-Z0-9_-]/g, '_');
                        var maxOpt = Math.min(Math.floor(qty), MAX_DROPDOWN_OPTIONS - 1);
                        var menuItems = '<li><a class="dropdown-item js-modal-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="0">0 (clear)</a></li>';
                        for (var n = 1; n <= maxOpt; n++) {
                            menuItems += '<li><a class="dropdown-item js-modal-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="' + n + '">' + n + '</a></li>';
                        }
                        if (Math.floor(qty) > maxOpt) {
                            menuItems += '<li><a class="dropdown-item js-modal-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="' + Math.floor(qty) + '">' + Math.floor(qty) + ' (max)</a></li>';
                        }
                        menuItems += '<li><hr class="dropdown-divider"></li><li><a class="dropdown-item js-modal-dispatch-qty-other" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-max-qty="' + qty + '">Other…</a></li>';
                        var btnClass = selectedLine ? 'btn-success' : 'btn-outline-secondary';
                        var btnLabel = selectedLine ? (selectedLine.quantity_kg + ' / ' + displayVal) : displayVal;
                        html += '<td class="text-end kernel-qty-cell"><div class="dropdown">' +
                            '<button class="btn btn-sm ' + btnClass + ' py-0 px-1" type="button" id="' + cellId + '" data-bs-toggle="dropdown" aria-expanded="false">' + btnLabel + '</button>' +
                            '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="' + cellId + '">' + menuItems + '</ul></div></td>';
                    } else {
                        html += '<td class="text-end text-muted">—</td>';
                    }
                });
                tr.innerHTML = html;
                body.appendChild(tr);
            });
            if (totalsRow) {
                totalsRow.querySelectorAll('td[data-style]').forEach(function (td) {
                    var k = td.getAttribute('data-style');
                    td.textContent = (totals[k] != null && totals[k] > 0) ? totals[k] : '—';
                });
            }
        },

        renderBasket: function () {
            var basketEl = document.getElementById('dispatchModalBasket');
            var basketBody = document.getElementById('dispatchModalBasketBody');
            var basketTotal = document.getElementById('dispatchModalBasketTotal');
            var sendBtn = document.getElementById('dispatchModalSendBtn');
            if (!basketBody) return;
            if (_dispatchLines.length === 0) {
                if (basketEl) basketEl.style.display = 'none';
                if (sendBtn) sendBtn.disabled = true;
                return;
            }
            if (basketEl) basketEl.style.display = '';
            if (sendBtn) sendBtn.disabled = false;
            var totalKg = 0;
            var html = '';
            _dispatchLines.forEach(function (line) {
                var qty = parseFloat(line.quantity_kg) || 0;
                totalKg += qty;
                var styleAttr = (line.style || '').replace(/"/g, '&quot;');
                html += '<tr><td><span class="badge bg-primary">' + (line.batch_number || '—') + '</span></td>' +
                    '<td>' + (line.style || '—') + '</td>' +
                    '<td class="text-end">' + qty + '</td>' +
                    '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger js-modal-basket-remove" title="Remove" data-batch-id="' + (line.kernel_id || '') + '" data-style="' + styleAttr + '"><i class="fas fa-times"></i></button></td></tr>';
            });
            basketBody.innerHTML = html;
            if (basketTotal) basketTotal.textContent = 'Total: ' + totalKg.toFixed(1) + ' kg';
        },

        show: function () {
            _dispatchLines = [];
            _pendingDetails = null;
            api.showStep1();
            var buyerInput = document.getElementById('dispatchBuyer');
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            var deliveryInput = document.getElementById('dispatchDeliveryDate');
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
            var modalEl = document.getElementById('sendToDispatchModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#sendToDispatchModal').modal('show');
            }
        },

        onNextSelectBoxes: function () {
            var buyerInput = document.getElementById('dispatchBuyer');
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            var deliveryInput = document.getElementById('dispatchDeliveryDate');
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
            if (_dispatchLines.length === 0) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', 'Please select at least one item to dispatch.', 'warning');
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createKernelDispatchOrder) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Dispatch function not available. Please refresh.', 'error');
                return;
            }
            var lines = _dispatchLines.map(function (l) {
                return { kernel_id: l.kernel_id, batch_number: l.batch_number, style: l.style, quantity_kg: l.quantity_kg };
            });
            var sendBtn = document.getElementById('dispatchModalSendBtn');
            if (sendBtn) sendBtn.disabled = true;
            dataFunctions.createKernelDispatchOrder({
                buyer_name: _pendingDetails.buyer_name,
                buyer_contact_id: _pendingDetails.buyer_contact_id || null,
                delivery_date: _pendingDetails.delivery_date,
                lines: lines
            }).then(function (result) {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'success', title: 'Dispatched', text: 'Dispatch order created successfully.', timer: 2000, showConfirmButton: false });
                    _dispatchLines = [];
                    _pendingDetails = null;
                    var modalEl = document.getElementById('sendToDispatchModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var inst = bootstrap.Modal.getInstance(modalEl);
                        if (inst) inst.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#sendToDispatchModal').modal('hide');
                    }
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadKernelBatches) {
                        setTimeout(function () { _stockManagementGrid.loadKernelBatches(true); }, 300);
                    }
                } else {
                    throw new Error(result && result.error ? result.error : 'Failed to create dispatch order');
                }
            }).catch(function (e) {
                console.error('[Dispatch Modal] onSend failed:', e);
                if (sendBtn) sendBtn.disabled = false;
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', e.message || 'Failed to create dispatch order', 'error');
            });
        }
    };

    return api;
})();
_modal_stock_send_to_dispatch.init();
