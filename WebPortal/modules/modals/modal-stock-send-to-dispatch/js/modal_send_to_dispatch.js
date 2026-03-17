/**
 * Modal: Send to Dispatch.
 * Step 1: Enter buyer + delivery date.
 * Step 2: Shopping cart — browse kernel batches by style, pick quantities, then send.
 */
var _modal_stock_send_to_dispatch = (function () {
    'use strict';

    var STYLE_KEYS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var KG_PER_CARTON = 11.34;
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
            // Create new buyer (inline form – no SweetAlert to avoid focus/aria-hidden issues)
            $(document).off('click.dispatchModal', '#dispatchAddBuyerBtn').on('click.dispatchModal', '#dispatchAddBuyerBtn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                api.showAddBuyerForm();
            });
            $(document).off('click.dispatchModal', '#dispatchNewBuyerSubmitBtn').on('click.dispatchModal', '#dispatchNewBuyerSubmitBtn', function (e) {
                e.preventDefault();
                api.submitNewBuyerForm();
            });
            $(document).off('click.dispatchModal', '#dispatchNewBuyerCancelBtn').on('click.dispatchModal', '#dispatchNewBuyerCancelBtn', function (e) {
                e.preventDefault();
                api.hideAddBuyerForm();
            });
            // Clear invalid highlights on input
            $(document).off('input.dispatchModalValid', '#sendToDispatchModal .is-invalid').on('input.dispatchModalValid', '#sendToDispatchModal .is-invalid', function () {
                $(this).removeClass('is-invalid');
            });

            // Qty pick from shopping table (use attr for style so "0" is not treated as falsy)
            $(document).off('click.dispatchShop', '#sendToDispatchModal .js-modal-dispatch-qty-pick').on('click.dispatchShop', '#sendToDispatchModal .js-modal-dispatch-qty-pick', function (e) {
                e.preventDefault();
                var batchId = String($(this).data('batch-id') || '');
                var style = $(this).attr('data-style');
                style = (style == null || style === '') ? '' : String(style);
                var cartons = parseInt($(this).data('quantity'), 10);
                if (!batchId || style === '' || isNaN(cartons)) return;
                var batches = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.kernelFinishedBatches) ? _stockManagementGrid.kernelFinishedBatches : [];
                var batch = batches.find(function (b) { return b.id === batchId; });
                var batchNum = batch ? (batch.batch_number || batchId) : batchId;
                var idx = _dispatchLines.findIndex(function (l) { return l.kernel_id === batchId && String(l.style) === style; });
                if (cartons <= 0) {
                    if (idx >= 0) _dispatchLines.splice(idx, 1);
                } else {
                    var quantity_kg = Math.round(cartons * KG_PER_CARTON * 100) / 100;
                    var line = { kernel_id: batchId, batch_number: batchNum, style: style, quantity_kg: quantity_kg, cartons: cartons };
                    if (idx >= 0) _dispatchLines[idx] = line; else _dispatchLines.push(line);
                }
                api.renderShoppingTable();
                api.renderBasket();
            });

            // "Other…" custom cartons (use attr for style so "0" is not treated as falsy)
            $(document).off('click.dispatchShopOther', '#sendToDispatchModal .js-modal-dispatch-qty-other').on('click.dispatchShopOther', '#sendToDispatchModal .js-modal-dispatch-qty-other', function (e) {
                e.preventDefault();
                var batchId = String($(this).data('batch-id') || '');
                var style = $(this).attr('data-style');
                style = (style == null || style === '') ? '' : String(style);
                var maxCartons = parseInt($(this).data('max-qty'), 10) || 0;
                if (!batchId || style === '' || maxCartons <= 0) return;
                var batches = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.kernelFinishedBatches) ? _stockManagementGrid.kernelFinishedBatches : [];
                var batch = batches.find(function (b) { return b.id === batchId; });
                var batchNum = batch ? (batch.batch_number || batchId) : batchId;
                Swal.fire({
                    title: 'Enter cartons',
                    html: '<label class="form-label">Cartons (max ' + maxCartons + ')</label><input type="number" id="dispatchModalOtherQtyInput" class="form-control" min="1" max="' + maxCartons + '" value="1" step="1">',
                    showCancelButton: true,
                    confirmButtonText: 'Add',
                    focusConfirm: false,
                    preConfirm: function () {
                        var input = document.getElementById('dispatchModalOtherQtyInput');
                        var num = input ? parseInt(input.value, 10) : NaN;
                        if (isNaN(num) || num <= 0 || num > maxCartons) {
                            Swal.showValidationMessage('Please enter a value between 1 and ' + maxCartons + '.');
                            return false;
                        }
                        return num;
                    }
                }).then(function (result) {
                    if (result && result.isConfirmed && typeof result.value === 'number') {
                        var cartons = result.value;
                        var quantity_kg = Math.round(cartons * KG_PER_CARTON * 100) / 100;
                        var idx = _dispatchLines.findIndex(function (l) { return l.kernel_id === batchId && String(l.style) === style; });
                        var line = { kernel_id: batchId, batch_number: batchNum, style: style, quantity_kg: quantity_kg, cartons: cartons };
                        if (idx >= 0) _dispatchLines[idx] = line; else _dispatchLines.push(line);
                        api.renderShoppingTable();
                        api.renderBasket();
                    }
                });
            });

            // Remove from basket (use attr for style so "0" is not treated as falsy)
            $(document).off('click.dispatchBasketRemove', '#dispatchModalBasketBody .js-modal-basket-remove').on('click.dispatchBasketRemove', '#dispatchModalBasketBody .js-modal-basket-remove', function (e) {
                e.preventDefault();
                var batchId = String($(this).data('batch-id') || '');
                var style = $(this).attr('data-style');
                style = (style == null || style === '') ? '' : String(style);
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
                var cells = (b.remaining_by_style_cartons && typeof b.remaining_by_style_cartons === 'object') ? b.remaining_by_style_cartons : null;
                if (cells == null) cells = (b.yield_by_style_cartons && typeof b.yield_by_style_cartons === 'object') ? b.yield_by_style_cartons : {};
                var batchId = b.id || '';
                var batchNum = (b.batch_number || '').toString().replace(/"/g, '&quot;');
                var tr = document.createElement('tr');
                var html = '<td><span class="badge bg-secondary">' + batchNum + '</span></td>';
                STYLE_KEYS.forEach(function (k) {
                    var val = cells[k] != null ? cells[k] : 0;
                    if (typeof val === 'number') totals[k] += val;
                    var cartonsAvail = (typeof val === 'number' && val > 0) ? Math.floor(val) : 0;
                    var displayVal = (cartonsAvail > 0) ? cartonsAvail : '—';
                    var selectedLine = _dispatchLines.find(function (l) { return l.kernel_id === batchId && String(l.style) === k; });
                    if (cartonsAvail > 0) {
                        var cellId = 'dshop_' + (batchId + '_' + k).replace(/[^a-zA-Z0-9_-]/g, '_');
                        var maxOpt = Math.min(cartonsAvail, MAX_DROPDOWN_OPTIONS - 1);
                        var menuItems = '<li><a class="dropdown-item js-modal-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="0">0 (clear)</a></li>';
                        for (var n = 1; n <= maxOpt; n++) {
                            menuItems += '<li><a class="dropdown-item js-modal-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="' + n + '">' + n + '</a></li>';
                        }
                        if (cartonsAvail > maxOpt) {
                            menuItems += '<li><a class="dropdown-item js-modal-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="' + cartonsAvail + '">' + cartonsAvail + ' (max)</a></li>';
                        }
                        menuItems += '<li><hr class="dropdown-divider"></li><li><a class="dropdown-item js-modal-dispatch-qty-other" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-max-qty="' + cartonsAvail + '">Other…</a></li>';
                        var btnClass = selectedLine ? 'btn-success' : 'btn-outline-secondary';
                        var btnLabel = selectedLine ? ((selectedLine.cartons != null ? selectedLine.cartons : selectedLine.quantity_kg) + ' / ' + displayVal) : displayVal;
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
                var cartons = line.cartons != null ? line.cartons : 0;
                var qtyKg = (cartons > 0 || line.cartons === 0) ? (Math.round(cartons * KG_PER_CARTON * 100) / 100) : (parseFloat(line.quantity_kg) || 0);
                totalKg += qtyKg;
                var styleAttr = (line.style !== undefined && line.style !== null) ? String(line.style).replace(/"/g, '&quot;') : '';
                html += '<tr><td><span class="badge bg-primary">' + (line.batch_number || '—') + '</span></td>' +
                    '<td>' + (line.style !== undefined && line.style !== null ? line.style : '—') + '</td>' +
                    '<td class="text-end">' + cartons + ' ct · ' + qtyKg.toFixed(2) + ' kg</td>' +
                    '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger js-modal-basket-remove" title="Remove" data-batch-id="' + (line.kernel_id || '') + '" data-style="' + styleAttr + '"><i class="fas fa-times"></i></button></td></tr>';
            });
            basketBody.innerHTML = html;
            if (basketTotal) basketTotal.textContent = 'Total: ' + totalKg.toFixed(1) + ' kg';
        },

        populateBuyerDropdown: function () {
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            if (!buyerSelect) return;
            buyerSelect.innerHTML = '<option value="">— Select buyer —</option>';
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return;
            dataFunctions.getContacts(null, true).then(function (raw) {
                var contacts = Array.isArray(raw) ? raw : (raw && raw.get_contacts ? raw.get_contacts : (raw && raw.data ? raw.data : []));
                if (!Array.isArray(contacts)) return;
                var kernelCustomers = contacts.filter(function (c) { return c.contact_type === 'kernel_customer'; });
                kernelCustomers.forEach(function (c) {
                    var name = c.company_name || c.trading_name || c.primary_contact_name || c.id;
                    if (!name) return;
                    var opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = name;
                    opt.setAttribute('data-buyer-name', name);
                    buyerSelect.appendChild(opt);
                });
            }).catch(function () {});
        },

        showAddBuyerForm: function () {
            var formEl = document.getElementById('dispatchNewBuyerForm');
            var nameEl = document.getElementById('dispatchNewBuyerName');
            var errEl = document.getElementById('dispatchNewBuyerError');
            ['dispatchNewBuyerName', 'dispatchNewBuyerProvince', 'dispatchNewBuyerArea', 'dispatchNewBuyerContact', 'dispatchNewBuyerNotes'].forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });
            if (formEl) formEl.style.display = '';
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
            if (nameEl) setTimeout(function () { nameEl.focus(); }, 50);
        },

        hideAddBuyerForm: function () {
            var formEl = document.getElementById('dispatchNewBuyerForm');
            var errEl = document.getElementById('dispatchNewBuyerError');
            if (formEl) formEl.style.display = 'none';
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        },

        submitNewBuyerForm: function () {
            var nameEl = document.getElementById('dispatchNewBuyerName');
            var errEl = document.getElementById('dispatchNewBuyerError');
            var companyName = nameEl && nameEl.value ? nameEl.value.trim() : '';
            if (!companyName) {
                if (errEl) { errEl.textContent = 'Company name is required.'; errEl.style.display = 'block'; }
                if (nameEl) nameEl.focus();
                return;
            }
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
            var data = {
                company_name: companyName,
                physical_province: (document.getElementById('dispatchNewBuyerProvince') && document.getElementById('dispatchNewBuyerProvince').value) ? document.getElementById('dispatchNewBuyerProvince').value.trim() : null,
                physical_city: (document.getElementById('dispatchNewBuyerArea') && document.getElementById('dispatchNewBuyerArea').value) ? document.getElementById('dispatchNewBuyerArea').value.trim() : null,
                primary_contact_name: (document.getElementById('dispatchNewBuyerContact') && document.getElementById('dispatchNewBuyerContact').value) ? document.getElementById('dispatchNewBuyerContact').value.trim() : null,
                notes: (document.getElementById('dispatchNewBuyerNotes') && document.getElementById('dispatchNewBuyerNotes').value) ? document.getElementById('dispatchNewBuyerNotes').value.trim() : null
            };
            api.doCreateBuyer(data);
        },

        doCreateBuyer: function (data) {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createContact) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create contact not available.', 'error');
                return;
            }
            var payload = {
                contact_type: 'kernel_customer',
                company_name: data.company_name,
                physical_province: data.physical_province || null,
                physical_city: data.physical_city || null,
                primary_contact_name: data.primary_contact_name || null,
                notes: data.notes || null,
                status: 'active'
            };
            dataFunctions.createContact(payload).then(function (res) {
                var id = (res && res.id) || (res && res.data && res.data.id);
                if (id) {
                    api.populateBuyerDropdown();
                    var buyerSelect = document.getElementById('dispatchBuyerContact');
                    var buyerInput = document.getElementById('dispatchBuyer');
                    if (buyerSelect) buyerSelect.value = id;
                    if (buyerInput) {
                        buyerInput.value = data.company_name;
                        buyerInput.classList.remove('is-invalid');
                    }
                    api.hideAddBuyerForm();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Buyer added', timer: 1500, showConfirmButton: false });
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (res && res.error) || 'Failed to add buyer', 'error');
                }
            }).catch(function (e) {
                var msg = e && e.message ? e.message : 'Failed to add buyer.';
                if (e && (e.status === 404 || (typeof e.status === 'number' && e.status >= 400))) {
                    msg = 'Could not create buyer. The server returned an error (' + (e.status || '') + '). Check that the backend proxy and create-contact (or contacts table) are configured.';
                }
                if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
            });
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
            api.populateBuyerDropdown();
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
                return { kernel_id: l.kernel_id, batch_number: l.batch_number, style: l.style, cartons: l.cartons };
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
