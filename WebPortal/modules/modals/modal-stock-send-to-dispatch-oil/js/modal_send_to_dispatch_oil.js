/**
 * Modal: Send to Dispatch (Oil & Protein).
 * Step 1: Buyer + delivery date.
 * Step 2: Oil (letrerage / litres) and protein (kg) in separate tables. Basket stores oil as L + kg equivalent for API.
 */
var _modal_stock_send_to_dispatch_oil = (function () {
    'use strict';

    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var _dispatchOilLines = [];
    var _pendingDetails = null;

    /** Same rule as Stock (Oil) grid — protein powder vs oil streams. */
    function isProteinPowderLot(l) {
        if (!l) return false;
        var bn = (l.batch_number && String(l.batch_number)) || '';
        if (bn.indexOf('PP-') === 0) return true;
        var g = (l.grade && String(l.grade).toLowerCase().trim()) || '';
        if (g === 'protein powder' || g.indexOf('protein powder') === 0) return true;
        return false;
    }

    function parseNum(v) {
        if (v == null || v === '') return NaN;
        return parseFloat(String(v).replace(',', '.'));
    }

    function getAvailableKg(lot) {
        var kg = lot.kilograms != null && lot.kilograms !== '' ? parseFloat(lot.kilograms) : NaN;
        return !isNaN(kg) && kg > 0 ? kg : 0;
    }

    /** Prefer stock volume (L); if missing, infer from kg using same 0.92 factor as oil production send-to-stock. */
    function getAvailableLitres(lot) {
        var v = lot.volume != null && lot.volume !== '' ? parseFloat(lot.volume) : NaN;
        if (!isNaN(v) && v > 0) return v;
        var kg = getAvailableKg(lot);
        if (kg > 0) return Math.round((kg / 0.92) * 1000) / 1000;
        return 0;
    }

    /** kg equivalent for a litre amount (full or partial oil line). */
    function litresToKgEquivalent(litres, lot) {
        var L = parseFloat(litres) || 0;
        var availL = getAvailableLitres(lot);
        var availKg = getAvailableKg(lot);
        if (L <= 0) return 0;
        if (availL > 0 && availKg > 0) return Math.round(L * (availKg / availL) * 100) / 100;
        return Math.round(L * 0.92 * 100) / 100;
    }

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

    /** CRM contacts that can buy oil & protein (not NIS growers or kernel-only customers). */
    var OIL_DISPATCH_BUYER_CONTACT_TYPES = ['customer', 'both'];

    function filterContactsForOilBuyers(contacts, selectedId) {
        if (!contacts || !Array.isArray(contacts)) return [];
        var allowed = function (c) {
            var t = (c.contact_type || '').trim();
            return OIL_DISPATCH_BUYER_CONTACT_TYPES.indexOf(t) >= 0;
        };
        var list = contacts.filter(allowed);
        if (selectedId) {
            var sel = contacts.find(function (c) { return String(c.id) === String(selectedId); });
            if (sel && !allowed(sel)) list.push(sel);
        }
        list.sort(function (a, b) {
            var na = (a.company_name || a.trading_name || a.primary_contact_name || '').toLowerCase();
            var nb = (b.company_name || b.trading_name || b.primary_contact_name || '').toLowerCase();
            return na.localeCompare(nb);
        });
        return list;
    }

    function extractNewContactId(res) {
        if (!res) return null;
        if (res.id) return res.id;
        if (res.contact_id) return res.contact_id;
        if (res.data && res.data.id) return res.data.id;
        if (Array.isArray(res.inserted_ids) && res.inserted_ids.length) return res.inserted_ids[0];
        if (res.result && res.result.id) return res.result.id;
        if (res.success !== false && res.p_id) return res.p_id;
        return null;
    }

    function populateBuyerContacts(selectedId) {
        var buyerSelect = document.getElementById('dispatchOilBuyerContact');
        if (!buyerSelect) return;
        buyerSelect.innerHTML = '<option value="">— Select contact —</option>';
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return;
        dataFunctions.getContacts(null, true).then(function (raw) {
            var contacts = Array.isArray(raw) ? raw : (raw && raw.get_contacts ? raw.get_contacts : (raw && raw.data ? raw.data : []));
            if (!Array.isArray(contacts)) return;
            var forDropdown = filterContactsForOilBuyers(contacts, selectedId);
            forDropdown.forEach(function (c) {
                var name = c.company_name || c.trading_name || c.primary_contact_name || c.id;
                if (!name) return;
                var opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = name;
                opt.setAttribute('data-buyer-name', name);
                buyerSelect.appendChild(opt);
            });
            if (selectedId) buyerSelect.value = String(selectedId);
        }).catch(function () {});
    }

    function hideOilNewBuyerForm() {
        var formEl = document.getElementById('dispatchOilNewBuyerForm');
        var errEl = document.getElementById('dispatchOilNewBuyerError');
        if (formEl) formEl.style.display = 'none';
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    }

    function showOilNewBuyerForm() {
        var formEl = document.getElementById('dispatchOilNewBuyerForm');
        var errEl = document.getElementById('dispatchOilNewBuyerError');
        ['dispatchOilNewBuyerName', 'dispatchOilNewBuyerPerson', 'dispatchOilNewBuyerProvince', 'dispatchOilNewBuyerArea', 'dispatchOilNewBuyerNotes'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
        var typeEl = document.getElementById('dispatchOilNewBuyerContactType');
        if (typeEl) typeEl.value = 'customer';
        if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
        if (formEl) {
            formEl.style.display = '';
            var nameEl = document.getElementById('dispatchOilNewBuyerName');
            if (nameEl) setTimeout(function () { nameEl.focus(); }, 50);
        }
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
            $(document).off('click.dispatchOilModal', '#dispatchOilAddBuyerBtn').on('click.dispatchOilModal', '#dispatchOilAddBuyerBtn', function (e) {
                e.preventDefault();
                var formEl = document.getElementById('dispatchOilNewBuyerForm');
                if (formEl && formEl.style.display === 'none') showOilNewBuyerForm();
                else hideOilNewBuyerForm();
            });
            $(document).off('click.dispatchOilModal', '#dispatchOilNewBuyerSubmitBtn').on('click.dispatchOilModal', '#dispatchOilNewBuyerSubmitBtn', function (e) {
                e.preventDefault();
                api.submitOilNewBuyerForm();
            });
            $(document).off('click.dispatchOilModal', '#dispatchOilNewBuyerCancelBtn').on('click.dispatchOilModal', '#dispatchOilNewBuyerCancelBtn', function (e) {
                e.preventDefault();
                hideOilNewBuyerForm();
            });
            $(document).off('input.dispatchOilModalValid', '#sendToDispatchOilModal .is-invalid').on('input.dispatchOilModalValid', '#sendToDispatchOilModal .is-invalid', function () {
                $(this).removeClass('is-invalid');
            });
            $(document).off('click.dispatchOilAdd', '#sendToDispatchOilModal .js-dispatch-oil-add-btn').on('click.dispatchOilAdd', '#sendToDispatchOilModal .js-dispatch-oil-add-btn', function (e) {
                e.preventDefault();
                var lotId = $(this).data('lot-id');
                var lineKind = $(this).data('line-kind') === 'oil' ? 'oil' : 'protein';
                var input = document.getElementById('dispatchOilQty_' + lotId);
                var lots = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.oilLotsAvailableForStockView)
                    ? _stockManagementGrid.oilLotsAvailableForStockView()
                    : ((typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.oilLots) ? _stockManagementGrid.oilLots : []);
                var lot = lots.find(function (l) { return String(l.id) === String(lotId); });
                if (!lotId || !lot) return;

                if (lineKind === 'protein') {
                    api._addProteinLine(lot, input);
                } else {
                    api._addOilLine(lot, input);
                }
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

        _addProteinLine: function (lot, input) {
            var available = getAvailableKg(lot);
            if (available <= 0) return;
            var rawVal = input && input.value != null && String(input.value).trim() !== '' ? parseNum(input.value) : NaN;
            var qty = !isNaN(rawVal) && rawVal > 0 ? rawVal : available;
            if (qty > available) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Invalid quantity', 'Qty cannot exceed available ' + available + ' kg for this lot.', 'warning');
                return;
            }
            var style = (lot.product_description || lot.product_code || '').trim() || '—';
            var batchNumber = (lot.batch_number || '').toString();
            var lotId = lot.id;
            var existing = _dispatchOilLines.find(function (l) { return String(l.oil_lot_id) === String(lotId) && l.line_kind === 'protein'; });
            if (existing) {
                var newQty = (parseFloat(existing.quantity_kg) || 0) + qty;
                if (newQty > available) newQty = available;
                existing.quantity_kg = Math.round(newQty * 100) / 100;
            } else {
                _dispatchOilLines.push({
                    line_kind: 'protein',
                    oil_lot_id: lot.id,
                    batch_number: batchNumber,
                    style: style,
                    quantity_kg: Math.round(qty * 100) / 100
                });
            }
            var inBasketAfter = _dispatchOilLines.find(function (l) { return String(l.oil_lot_id) === String(lotId) && l.line_kind === 'protein'; });
            var qAfter = inBasketAfter ? (parseFloat(inBasketAfter.quantity_kg) || 0) : 0;
            var rem = Math.max(0, Math.round((available - qAfter) * 100) / 100);
            if (input) input.value = rem > 0 ? String(rem) : '';
        },

        _addOilLine: function (lot, input) {
            var availableL = getAvailableLitres(lot);
            if (availableL <= 0) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('No letrerage', 'This lot has no volume (L) on file. Update the stock line or check intake.', 'warning');
                return;
            }
            var rawVal = input && input.value != null && String(input.value).trim() !== '' ? parseNum(input.value) : NaN;
            var qtyL = !isNaN(rawVal) && rawVal > 0 ? rawVal : availableL;
            if (qtyL > availableL) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Invalid quantity', 'Letrerage cannot exceed available ' + availableL + ' L for this lot.', 'warning');
                return;
            }
            var style = (lot.product_description || lot.product_code || '').trim() || '—';
            var batchNumber = (lot.batch_number || '').toString();
            var lotId = lot.id;
            var kgEq = litresToKgEquivalent(qtyL, lot);
            var existing = _dispatchOilLines.find(function (l) { return String(l.oil_lot_id) === String(lotId) && l.line_kind === 'oil'; });
            if (existing) {
                var newL = (parseFloat(existing.quantity_litres) || 0) + qtyL;
                if (newL > availableL) newL = availableL;
                existing.quantity_litres = Math.round(newL * 1000) / 1000;
                existing.quantity_kg = litresToKgEquivalent(existing.quantity_litres, lot);
            } else {
                _dispatchOilLines.push({
                    line_kind: 'oil',
                    oil_lot_id: lot.id,
                    batch_number: batchNumber,
                    style: style,
                    quantity_litres: Math.round(qtyL * 1000) / 1000,
                    quantity_kg: kgEq
                });
            }
            var inBasketAfter = _dispatchOilLines.find(function (l) { return String(l.oil_lot_id) === String(lotId) && l.line_kind === 'oil'; });
            var lAfter = inBasketAfter ? (parseFloat(inBasketAfter.quantity_litres) || 0) : 0;
            var rem = Math.max(0, Math.round((availableL - lAfter) * 1000) / 1000);
            if (input) input.value = rem > 0 ? String(rem) : '';
        },

        showStep1: function () {
            hideOilNewBuyerForm();
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
            var lots = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.oilLotsAvailableForStockView)
                ? _stockManagementGrid.oilLotsAvailableForStockView()
                : ((typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.oilLots) ? _stockManagementGrid.oilLots : []);
            var bodyOil = document.getElementById('dispatchOilStreamOilBody');
            var bodyProt = document.getElementById('dispatchOilStreamProteinBody');
            if (!bodyOil || !bodyProt) return;
            bodyOil.innerHTML = '';
            bodyProt.innerHTML = '';
            var oilLots = lots.filter(function (l) { return !isProteinPowderLot(l); });
            var protLots = lots.filter(function (l) { return isProteinPowderLot(l); });

            if (oilLots.length === 0) {
                bodyOil.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No oil lots in stock list.</td></tr>';
            } else {
                oilLots.forEach(function (lot) { api._appendOilRow(bodyOil, lot); });
            }
            if (protLots.length === 0) {
                bodyProt.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No protein powder lots in stock list.</td></tr>';
            } else {
                protLots.forEach(function (lot) { api._appendProteinRow(bodyProt, lot); });
            }
        },

        _appendOilRow: function (body, lot) {
            var availableL = getAvailableLitres(lot);
            var displayL = availableL > 0 ? availableL.toFixed(2) : '0.00';
            var batchNum = (lot.batch_number || '—').toString().replace(/"/g, '&quot;');
            var inBasket = _dispatchOilLines.find(function (l) { return String(l.oil_lot_id) === String(lot.id) && l.line_kind === 'oil'; });
            var basketL = inBasket ? (parseFloat(inBasket.quantity_litres) || 0) : 0;
            var isFullLot = availableL > 0 && Math.abs(basketL - availableL) < 0.0001;
            var remaining = Math.max(0, Math.round((availableL - basketL) * 1000) / 1000);
            var qtyCell;
            var actionCell;
            var escId = String(lot.id).replace(/"/g, '&quot;');
            if (isFullLot && basketL > 0) {
                qtyCell = '<td class="text-end"><span class="text-success small fw-semibold">Full batch</span><br><span class="text-muted small">' + basketL.toFixed(2) + ' L</span></td>';
                actionCell = '<td><span class="badge bg-light text-success border border-success">In basket</span> ' +
                    '<button type="button" class="btn btn-sm btn-link text-danger p-0 js-dispatch-oil-basket-remove" data-lot-id="' + escId + '">Remove</button></td>';
            } else {
                var defaultVal = remaining > 0 ? remaining.toFixed(2) : (availableL > 0 ? availableL.toFixed(2) : '');
                qtyCell = '<td class="text-end"><input type="number" step="any" min="0" class="form-control form-control-sm d-inline-block text-end" style="width:110px" id="dispatchOilQty_' + lot.id + '" value="' + defaultVal + '" placeholder="' + (availableL > 0 ? availableL.toFixed(2) : '0') + '" title="Letrerage to dispatch (L)"></td>';
                actionCell = '<td><button type="button" class="btn btn-sm btn-outline-primary js-dispatch-oil-add-btn" data-lot-id="' + lot.id + '" data-line-kind="oil">Add</button>' +
                    (basketL > 0 ? ' <span class="text-success small">(' + basketL.toFixed(2) + ' L)</span>' : '') + '</td>';
            }
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (lot.location_code || '') + '</td>' +
                '<td><span class="badge bg-secondary">' + batchNum + '</span></td>' +
                '<td>' + (lot.product_description || lot.product_code || '—') + '</td>' +
                '<td class="text-end">' + (lot.grade || '') + '</td>' +
                '<td class="text-end">' + displayL + '</td>' +
                qtyCell + actionCell;
            body.appendChild(tr);
        },

        _appendProteinRow: function (body, lot) {
            var available = getAvailableKg(lot);
            var displayKg = available > 0 ? available.toFixed(2) : '0.00';
            var batchNum = (lot.batch_number || '—').toString().replace(/"/g, '&quot;');
            var inBasket = _dispatchOilLines.find(function (l) { return String(l.oil_lot_id) === String(lot.id) && l.line_kind === 'protein'; });
            var basketQty = inBasket ? (parseFloat(inBasket.quantity_kg) || 0) : 0;
            var isFullLot = available > 0 && Math.abs(basketQty - available) < 0.0001;
            var remaining = Math.max(0, Math.round((available - basketQty) * 100) / 100);
            var qtyCell;
            var actionCell;
            var escId = String(lot.id).replace(/"/g, '&quot;');
            if (isFullLot && basketQty > 0) {
                qtyCell = '<td class="text-end"><span class="text-success small fw-semibold">Full batch</span><br><span class="text-muted small">' + basketQty.toFixed(2) + ' kg</span></td>';
                actionCell = '<td><span class="badge bg-light text-success border border-success">In basket</span> ' +
                    '<button type="button" class="btn btn-sm btn-link text-danger p-0 js-dispatch-oil-basket-remove" data-lot-id="' + escId + '">Remove</button></td>';
            } else {
                var defaultVal = remaining > 0 ? remaining.toFixed(2) : (available > 0 ? available.toFixed(2) : '');
                qtyCell = '<td class="text-end"><input type="number" step="any" min="0" class="form-control form-control-sm d-inline-block text-end" style="width:110px" id="dispatchOilQty_' + lot.id + '" value="' + defaultVal + '" placeholder="' + (available > 0 ? available.toFixed(2) : '0') + '" title="kg to dispatch"></td>';
                actionCell = '<td><button type="button" class="btn btn-sm btn-outline-primary js-dispatch-oil-add-btn" data-lot-id="' + lot.id + '" data-line-kind="protein">Add</button>' +
                    (basketQty > 0 ? ' <span class="text-success small">(' + basketQty.toFixed(2) + ' kg)</span>' : '') + '</td>';
            }
            var tr = document.createElement('tr');
            tr.innerHTML = '<td>' + (lot.location_code || '') + '</td>' +
                '<td><span class="badge bg-secondary">' + batchNum + '</span></td>' +
                '<td>' + (lot.product_description || lot.product_code || '—') + '</td>' +
                '<td class="text-end">' + (lot.grade || '') + '</td>' +
                '<td class="text-end">' + displayKg + '</td>' +
                qtyCell + actionCell;
            body.appendChild(tr);
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
            var sumOilL = 0;
            var sumProtKg = 0;
            var html = '';
            _dispatchOilLines.forEach(function (line) {
                var lotId = (line.oil_lot_id !== undefined && line.oil_lot_id !== null) ? String(line.oil_lot_id).replace(/"/g, '&quot;') : '';
                var qtyDisp;
                if (line.line_kind === 'oil') {
                    var ltr = parseFloat(line.quantity_litres) || 0;
                    sumOilL += ltr;
                    qtyDisp = ltr.toFixed(2) + ' L';
                } else {
                    var kg = parseFloat(line.quantity_kg) || 0;
                    sumProtKg += kg;
                    qtyDisp = kg.toFixed(2) + ' kg';
                }
                html += '<tr><td><span class="badge bg-primary">' + (line.batch_number || '—') + '</span></td>' +
                    '<td>' + (line.style !== undefined && line.style !== null ? String(line.style).replace(/</g, '&lt;') : '—') + '</td>' +
                    '<td class="text-end">' + qtyDisp + '</td>' +
                    '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger js-dispatch-oil-basket-remove" title="Remove" data-lot-id="' + lotId + '"><i class="fas fa-times"></i></button></td></tr>';
            });
            basketBody.innerHTML = html;
            if (basketTotal) {
                var parts = [];
                if (sumOilL > 0) parts.push('Oil ' + sumOilL.toFixed(1) + ' L');
                if (sumProtKg > 0) parts.push('Protein ' + sumProtKg.toFixed(1) + ' kg');
                basketTotal.textContent = parts.length ? parts.join(' · ') : '—';
            }
        },

        submitOilNewBuyerForm: function () {
            var nameEl = document.getElementById('dispatchOilNewBuyerName');
            var errEl = document.getElementById('dispatchOilNewBuyerError');
            var typeEl = document.getElementById('dispatchOilNewBuyerContactType');
            var companyName = nameEl && nameEl.value ? nameEl.value.trim() : '';
            if (!companyName) {
                if (errEl) { errEl.textContent = 'Company name is required.'; errEl.style.display = 'block'; }
                if (nameEl) nameEl.focus();
                return;
            }
            if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
            var contactType = (typeEl && typeEl.value) ? typeEl.value.trim() : 'customer';
            if (OIL_DISPATCH_BUYER_CONTACT_TYPES.indexOf(contactType) < 0) contactType = 'customer';
            var data = {
                company_name: companyName,
                contact_type: contactType,
                physical_province: (document.getElementById('dispatchOilNewBuyerProvince') && document.getElementById('dispatchOilNewBuyerProvince').value) ? document.getElementById('dispatchOilNewBuyerProvince').value.trim() : null,
                physical_city: (document.getElementById('dispatchOilNewBuyerArea') && document.getElementById('dispatchOilNewBuyerArea').value) ? document.getElementById('dispatchOilNewBuyerArea').value.trim() : null,
                primary_contact_name: (document.getElementById('dispatchOilNewBuyerPerson') && document.getElementById('dispatchOilNewBuyerPerson').value) ? document.getElementById('dispatchOilNewBuyerPerson').value.trim() : null,
                notes: (document.getElementById('dispatchOilNewBuyerNotes') && document.getElementById('dispatchOilNewBuyerNotes').value) ? document.getElementById('dispatchOilNewBuyerNotes').value.trim() : null
            };
            api.doCreateOilBuyer(data);
        },

        doCreateOilBuyer: function (data) {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createContact) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Create contact not available.', 'error');
                return;
            }
            var submitBtn = document.getElementById('dispatchOilNewBuyerSubmitBtn');
            if (submitBtn) submitBtn.disabled = true;
            var payload = {
                contact_type: data.contact_type || 'customer',
                company_name: data.company_name,
                physical_province: data.physical_province || null,
                physical_city: data.physical_city || null,
                primary_contact_name: data.primary_contact_name || null,
                notes: data.notes || null,
                status: 'active'
            };
            dataFunctions.createContact(payload).then(function (res) {
                if (res && res.success === false) {
                    throw new Error(res.error || res.message || 'Failed to create contact');
                }
                var id = extractNewContactId(res);
                if (!id) {
                    throw new Error((res && (res.error || res.message)) || 'No id returned');
                }
                populateBuyerContacts(id);
                var buyerSelect = document.getElementById('dispatchOilBuyerContact');
                var buyerInput = document.getElementById('dispatchOilBuyer');
                if (buyerSelect) buyerSelect.value = String(id);
                if (buyerInput) {
                    buyerInput.value = data.company_name;
                    buyerInput.classList.remove('is-invalid');
                }
                hideOilNewBuyerForm();
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire({ icon: 'success', title: 'Buyer added', text: data.company_name, timer: 1800, showConfirmButton: false });
                }
            }).catch(function (e) {
                var msg = e && e.message ? e.message : 'Failed to add buyer.';
                var errEl = document.getElementById('dispatchOilNewBuyerError');
                if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
                else if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', msg, 'error');
            }).finally(function () {
                if (submitBtn) submitBtn.disabled = false;
            });
        },

        show: function () {
            _dispatchOilLines = [];
            _pendingDetails = null;
            hideOilNewBuyerForm();
            api.showStep1();
            var buyerInput = document.getElementById('dispatchOilBuyer');
            var deliveryInput = document.getElementById('dispatchOilDeliveryDate');
            if (buyerInput) { buyerInput.value = ''; buyerInput.classList.remove('is-invalid'); }
            if (deliveryInput && deliveryInput._flatpickr) {
                deliveryInput._flatpickr.setDate(new Date());
            } else if (deliveryInput) {
                deliveryInput.value = '';
                deliveryInput.classList.remove('is-invalid');
            }
            populateBuyerContacts(null);
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
                var row = {
                    batch_number: l.batch_number || null,
                    style: l.style || null,
                    oil_batch_id: l.oil_lot_id != null ? l.oil_lot_id : null
                };
                if (l.line_kind === 'oil') {
                    row.quantity_litres = l.quantity_litres != null ? l.quantity_litres : null;
                    row.quantity_kg = l.quantity_kg != null ? l.quantity_kg : null;
                } else {
                    row.quantity_kg = l.quantity_kg != null ? l.quantity_kg : null;
                }
                return row;
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
                    if (typeof HandoffDialog !== 'undefined' && HandoffDialog.showSendToDispatch) {
                        HandoffDialog.showSendToDispatch('oil', (_pendingDetails && _pendingDetails.buyer_name) || '');
                    } else if (typeof Swal !== 'undefined' && Swal.fire) {
                        Swal.fire({ icon: 'success', title: 'Order created', text: 'Oil dispatch order has been created. You can view it under Oil & Protein Dispatch.', timer: 3000, showConfirmButton: true });
                    }
                    var modalEl = document.getElementById('sendToDispatchOilModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#sendToDispatchOilModal').modal('hide');
                    }
                    if (typeof _oilDispatchGrid !== 'undefined' && _oilDispatchGrid.loadOrders) _oilDispatchGrid.loadOrders(true);
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadOilLotsAndSummary) {
                        try { _stockManagementGrid.loadOilLotsAndSummary(true); } catch (x) { /* ignore */ }
                    }
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
