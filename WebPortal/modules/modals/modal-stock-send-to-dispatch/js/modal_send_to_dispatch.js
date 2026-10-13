/**
 * Modal: Send to Dispatch.
 * Step 1: Pick customer + planned collection and delivery dates.
 * Step 2: Shopping cart — browse kernel batches by style, pick quantities, then send.
 */
var _modal_stock_send_to_dispatch = (function () {
    'use strict';

    var STYLE_KEYS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var KG_PER_CARTON = 11.34;
    /** Prefer kernel.id for dispatch line JSON (must match get_kernel_production_history / p_kernel_id). */
    function kernelRpcIdFromBatch(b) {
        if (!b) return '';
        if (b.kernel_id != null && b.kernel_id !== '') return String(b.kernel_id);
        if (b.KernelId != null && b.KernelId !== '') return String(b.KernelId);
        if (b.id != null && b.id !== '') return String(b.id);
        if (b.Id != null && b.Id !== '') return String(b.Id);
        return '';
    }
    function findKernelBatchByRpcId(batches, rpcId) {
        var id = String(rpcId || '');
        if (!id || !batches || !batches.length) return null;
        for (var i = 0; i < batches.length; i++) {
            if (kernelRpcIdFromBatch(batches[i]) === id) return batches[i];
        }
        return null;
    }
    var _dispatchLines = [];
    var _pendingDetails = null;
    var DEFAULT_BB_BANDS = { green: 12, yellow: 6 };
    var _bbBands = DEFAULT_BB_BANDS;

    function cartonLabel(n) {
        return n + (n === 1 ? ' Carton' : ' Cartons');
    }
    /** The single note under a carton input: 'of N' (empty), '= x kg' (entered) or 'max N' (over). */
    function setQtyNote(el, kind, text) {
        el.className = 'small text-center js-dispatch-qty-kg ' + (kind === 'over' ? 'text-danger fw-semibold' : (kind === 'kg' ? 'text-primary fw-semibold' : 'text-muted'));
        el.textContent = text;
    }
    function cartonsToKg(n) {
        return Math.round(n * KG_PER_CARTON * 100) / 100;
    }
    /** Date or date string -> 'YYYY-MM-DD' (local parts for Date objects), '' when unusable. */
    function toISODate(v) {
        if (!v) return '';
        if (v instanceof Date) {
            if (isNaN(v.getTime())) return '';
            return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
        }
        var t = String(v).split('T')[0];
        return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
    }
    /** Resolves true when real bands were loaded (defaults are used otherwise). */
    function loadBands() {
        if (typeof _common === 'undefined' || !_common.loadKernelPipelineConfig) return Promise.resolve(false);
        return _common.loadKernelPipelineConfig(false).then(function (cfg) {
            var b = cfg && cfg.settings && cfg.settings.best_before_bands;
            _bbBands = b || DEFAULT_BB_BANDS;
            return !!b;
        }).catch(function () { return false; });
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
            // Create new customer (inline form – no SweetAlert to avoid focus/aria-hidden issues)
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
            $(document).off('input.dispatchModalValid', '#sendToDispatchStep1 .is-invalid').on('input.dispatchModalValid', '#sendToDispatchStep1 .is-invalid', function () {
                $(this).removeClass('is-invalid');
            });
            $(document).off('change.dispatchModalValid', '#dispatchBuyerContact').on('change.dispatchModalValid', '#dispatchBuyerContact', function () {
                $(this).removeClass('is-invalid');
            });

            // Carton entry: integer inputs, updated in place (no table re-render, so focus is never stolen while typing)
            $(document).off('input.dispatchQty change.dispatchQty', '#sendToDispatchModal .js-dispatch-qty-input').on('input.dispatchQty change.dispatchQty', '#sendToDispatchModal .js-dispatch-qty-input', function () {
                api.onQtyInput(this);
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
                    ['dispatchCollectionDate', 'dispatchDeliveryDate'].forEach(function (id) {
                        var el = document.getElementById(id);
                        if (el && !el._flatpickr && typeof flatpickr !== 'undefined') {
                            flatpickr(el, FLATPICKR_DDMMYYYY);
                        }
                        if (el && el._flatpickr) {
                            el._flatpickr.setDate(new Date());
                        }
                    });
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
            $('#sendToDispatchTitleText').text('Send to Dispatch');
            $('#sendToDispatchStepLabel').text('Step 1 of 2');
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
            $('#sendToDispatchTitleText').text('Select Stock');
            $('#sendToDispatchStepLabel').text('Step 2 of 2');
            var d = details || _pendingDetails || {};
            var buyerLabelEl = document.getElementById('sendToDispatchStep2BuyerLabel');
            var collectionLabelEl = document.getElementById('sendToDispatchStep2CollectionLabel');
            var deliveryLabelEl = document.getElementById('sendToDispatchStep2DeliveryLabel');
            if (buyerLabelEl) buyerLabelEl.textContent = d.buyer_name || '—';
            if (collectionLabelEl) collectionLabelEl.textContent = (d.planned_collection_date ? deliveryDateFromISO(d.planned_collection_date) : '') || '—';
            if (deliveryLabelEl) deliveryLabelEl.textContent = (d.delivery_date ? deliveryDateFromISO(d.delivery_date) : '') || '—';
            api.renderShoppingTable();
            api.renderBasket();
            // Bands may still be loading: re-render once they arrive, unless the user is already typing in the table.
            loadBands().then(function (changed) {
                var active = document.activeElement;
                var typing = active && active.classList && active.classList.contains('js-dispatch-qty-input');
                if (changed && !typing) api.renderShoppingTable();
            });
        },

        renderShoppingTable: function () {
            var source = (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.kernelFinishedBatches) ? _stockManagementGrid.kernelFinishedBatches : [];
            // Order a COPY (oldest best-before first, undated last): the source array is shared with the Stock grid.
            var batches = source.slice().sort(function (a, b) {
                var da = toISODate(a && a.best_before_date), db = toISODate(b && b.best_before_date);
                if (da === db) return 0;
                if (!da) return 1;
                if (!db) return -1;
                return da < db ? -1 : 1;
            });
            var body = document.getElementById('dispatchShoppingBody');
            var totalsRow = document.getElementById('dispatchShoppingTotalsRow');
            if (!body) return;
            body.innerHTML = '';
            var totals = {};
            STYLE_KEYS.forEach(function (k) { totals[k] = 0; });
            if (batches.length === 0) {
                var emptyTr = document.createElement('tr');
                var emptyTd = document.createElement('td');
                emptyTd.colSpan = 13;
                emptyTd.className = 'text-center text-muted py-3';
                emptyTd.textContent = 'No stock available.';
                emptyTr.appendChild(emptyTd);
                body.appendChild(emptyTr);
                return;
            }
            batches.forEach(function (b) {
                var cells = (b.remaining_by_style_cartons && typeof b.remaining_by_style_cartons === 'object') ? b.remaining_by_style_cartons : null;
                if (cells == null) cells = (b.yield_by_style_cartons && typeof b.yield_by_style_cartons === 'object') ? b.yield_by_style_cartons : {};
                var batchId = kernelRpcIdFromBatch(b);
                var tr = document.createElement('tr');

                var tdBatch = document.createElement('td');
                tdBatch.className = 'fw-semibold';
                tdBatch.textContent = (b.batch_number || '').toString();
                tr.appendChild(tdBatch);

                var bbISO = toISODate(b.best_before_date);
                var tdBB = document.createElement('td');
                tdBB.className = 'text-nowrap';
                tdBB.textContent = bbISO ? deliveryDateFromISO(bbISO) : '—';
                tr.appendChild(tdBB);
                var tdTL = document.createElement('td');
                tdTL.className = 'text-nowrap';
                var tu = (bbISO && typeof _common !== 'undefined' && _common.timeUntil) ? _common.timeUntil(bbISO) : null;
                if (tu) {
                    var tlCls = _common.bestBeforeBandClass(tu, _bbBands);
                    if (tlCls) {
                        var tlBadge = document.createElement('span');
                        tlBadge.className = 'badge bg-' + tlCls + (tlCls === 'warning' ? ' text-dark' : '');
                        tlBadge.textContent = tu.label;
                        tdTL.appendChild(tlBadge);
                    } else {
                        tdTL.textContent = tu.label;
                    }
                } else {
                    tdTL.textContent = '—';
                }
                tr.appendChild(tdTL);

                STYLE_KEYS.forEach(function (k) {
                    var val = cells[k] != null ? cells[k] : 0;
                    if (typeof val === 'number') totals[k] += val;
                    var cartonsAvail = (typeof val === 'number' && val > 0) ? Math.floor(val) : 0;
                    var td = document.createElement('td');
                    if (cartonsAvail <= 0) {
                        td.className = 'text-end text-muted';
                        td.textContent = '—';
                        tr.appendChild(td);
                        return;
                    }
                    td.className = 'kernel-qty-cell';
                    var selectedLine = _dispatchLines.find(function (l) { return l.kernel_id === batchId && String(l.style) === k; });
                    var input = document.createElement('input');
                    input.type = 'number';
                    input.className = 'form-control form-control-sm text-end js-dispatch-qty-input';
                    input.min = '0';
                    input.max = String(cartonsAvail);
                    input.step = '1';
                    input.placeholder = '0';
                    input.setAttribute('inputmode', 'numeric');
                    input.setAttribute('aria-label', 'Cartons of style ' + k + ', batch ' + (b.batch_number || '') + ' (max ' + cartonsAvail + ')');
                    input.setAttribute('data-batch-id', batchId);
                    input.setAttribute('data-style', k);
                    input.setAttribute('data-max-qty', String(cartonsAvail));
                    input.setAttribute('data-batch-number', (b.batch_number || '').toString());
                    if (selectedLine && selectedLine.cartons > 0) input.value = String(selectedLine.cartons);
                    var fb = document.createElement('div');
                    fb.className = 'invalid-feedback small text-end';
                    var kg = document.createElement('div');
                    kg.className = 'js-dispatch-qty-kg';
                    if (selectedLine && selectedLine.cartons > 0) setQtyNote(kg, 'kg', '= ' + cartonsToKg(selectedLine.cartons).toFixed(2) + ' kg');
                    else setQtyNote(kg, 'avail', 'of ' + cartonsAvail);
                    td.appendChild(input);
                    td.appendChild(fb);
                    td.appendChild(kg);
                    tr.appendChild(td);
                });
                body.appendChild(tr);
            });
            if (totalsRow) {
                totalsRow.querySelectorAll('td[data-style]').forEach(function (td) {
                    var k = td.getAttribute('data-style');
                    td.textContent = (totals[k] != null && totals[k] > 0) ? totals[k] : '—';
                });
            }
        },

        /** Handle typing in a carton input: validate, flag over-max, update line + basket without re-rendering the table. */
        onQtyInput: function (inputEl) {
            var batchId = inputEl.getAttribute('data-batch-id') || '';
            var style = inputEl.getAttribute('data-style');
            style = (style == null) ? '' : String(style);
            var maxCartons = parseInt(inputEl.getAttribute('data-max-qty'), 10) || 0;
            var batchNum = inputEl.getAttribute('data-batch-number') || batchId;
            var raw = (inputEl.value || '').trim();
            var cell = inputEl.closest('td');
            var fb = cell ? cell.querySelector('.invalid-feedback') : null;
            var kgEl = cell ? cell.querySelector('.js-dispatch-qty-kg') : null;
            var idx = _dispatchLines.findIndex(function (l) { return l.kernel_id === batchId && String(l.style) === style; });
            var msg = '';
            var over = false;
            var cartons = 0;
            if (raw !== '') {
                if (!/^\d+$/.test(raw)) {
                    msg = 'Whole cartons only (no decimals or negatives).';
                } else {
                    cartons = parseInt(raw, 10);
                    if (cartons > maxCartons) over = true;
                }
            }
            if (msg || over) {
                inputEl.classList.add('is-invalid');
                if (fb) fb.textContent = msg;
                if (kgEl) {
                    if (over) setQtyNote(kgEl, 'over', 'max ' + maxCartons);
                    else setQtyNote(kgEl, 'avail', 'of ' + maxCartons);
                }
                // An invalid entry is not part of the order until it is corrected.
                if (idx >= 0) _dispatchLines.splice(idx, 1);
            } else {
                inputEl.classList.remove('is-invalid');
                if (fb) fb.textContent = '';
                if (cartons <= 0) {
                    if (idx >= 0) _dispatchLines.splice(idx, 1);
                    if (kgEl) setQtyNote(kgEl, 'avail', 'of ' + maxCartons);
                } else {
                    var line = { kernel_id: batchId, batch_number: batchNum, style: style, quantity_kg: cartonsToKg(cartons), cartons: cartons };
                    if (idx >= 0) _dispatchLines[idx] = line; else _dispatchLines.push(line);
                    if (kgEl) setQtyNote(kgEl, 'kg', '= ' + cartonsToKg(cartons).toFixed(2) + ' kg');
                }
            }
            api.renderBasket();
        },

        renderBasket: function () {
            var basketEl = document.getElementById('dispatchModalBasket');
            var basketBody = document.getElementById('dispatchModalBasketBody');
            var basketTotal = document.getElementById('dispatchModalBasketTotal');
            var sendBtn = document.getElementById('dispatchModalSendBtn');
            if (!basketBody) return;
            var hasInvalid = !!document.querySelector('#dispatchShoppingBody .js-dispatch-qty-input.is-invalid');
            basketBody.innerHTML = '';
            if (_dispatchLines.length === 0) {
                if (basketEl) basketEl.style.display = 'none';
                if (sendBtn) sendBtn.disabled = true;
                if (basketTotal) basketTotal.textContent = '0 Cartons · 0.00 kg';
                return;
            }
            if (basketEl) basketEl.style.display = '';
            if (sendBtn) sendBtn.disabled = hasInvalid;
            var totalKg = 0;
            var totalCartons = 0;
            _dispatchLines.forEach(function (line) {
                var cartons = line.cartons != null ? line.cartons : 0;
                var qtyKg = cartonsToKg(cartons);
                totalKg += qtyKg;
                totalCartons += cartons;
                var tr = document.createElement('tr');
                var tdB = document.createElement('td');
                tdB.className = 'fw-semibold';
                tdB.textContent = line.batch_number || '—';
                var tdS = document.createElement('td');
                tdS.textContent = (line.style !== undefined && line.style !== null) ? line.style : '—';
                var tdQ = document.createElement('td');
                tdQ.className = 'text-end';
                tdQ.textContent = cartonLabel(cartons) + ' · ' + qtyKg.toFixed(2) + ' kg';
                var tdX = document.createElement('td');
                tdX.className = 'text-end';
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-sm btn-outline-danger js-modal-basket-remove';
                btn.title = 'Remove';
                btn.setAttribute('data-batch-id', line.kernel_id || '');
                btn.setAttribute('data-style', (line.style !== undefined && line.style !== null) ? String(line.style) : '');
                var ico = document.createElement('i');
                ico.className = 'fas fa-times';
                btn.appendChild(ico);
                tdX.appendChild(btn);
                tr.appendChild(tdB);
                tr.appendChild(tdS);
                tr.appendChild(tdQ);
                tr.appendChild(tdX);
                basketBody.appendChild(tr);
            });
            if (basketTotal) basketTotal.textContent = cartonLabel(totalCartons) + ' · ' + totalKg.toFixed(2) + ' kg';
        },

        populateBuyerDropdown: function () {
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            if (!buyerSelect) return Promise.resolve();
            buyerSelect.innerHTML = '<option value="">— Select customer —</option>';
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getContacts) return Promise.resolve();
            return dataFunctions.getContacts(null, true).then(function (raw) {
                var contacts = Array.isArray(raw) ? raw : (raw && raw.get_contacts ? raw.get_contacts : (raw && raw.data ? raw.data : []));
                if (!Array.isArray(contacts)) return;
                var kernelCustomers = contacts.filter(function (c) { return c.contact_type === 'kernel_customer'; });
                kernelCustomers.forEach(function (c) {
                    // Dispatch buyer_name: company name, falling back to trading name
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
                    api.hideAddBuyerForm();
                    api.populateBuyerDropdown().then(function () {
                        var buyerSelect = document.getElementById('dispatchBuyerContact');
                        if (!buyerSelect) return;
                        if (!Array.prototype.some.call(buyerSelect.options, function (o) { return o.value === String(id); })) {
                            // Contact list did not return the new row yet: add it so the selection is not lost.
                            var opt = document.createElement('option');
                            opt.value = id;
                            opt.textContent = data.company_name;
                            opt.setAttribute('data-buyer-name', data.company_name);
                            buyerSelect.appendChild(opt);
                        }
                        buyerSelect.value = id;
                        buyerSelect.classList.remove('is-invalid');
                    });
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Customer added', timer: 1500, showConfirmButton: false });
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (res && res.error) || 'Failed to add customer', 'error');
                }
            }).catch(function (e) {
                var msg = e && e.message ? e.message : 'Failed to add customer.';
                if (e && (e.status === 404 || (typeof e.status === 'number' && e.status >= 400))) {
                    msg = 'Could not create customer. The server returned an error (' + (e.status || '') + '). Check that the backend proxy and create-contact (or contacts table) are configured.';
                }
                if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
            });
        },

        show: function () {
            _dispatchLines = [];
            _pendingDetails = null;
            api.showStep1();
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            if (buyerSelect) buyerSelect.classList.remove('is-invalid');
            ['dispatchCollectionDate', 'dispatchDeliveryDate'].forEach(function (id) {
                var el = document.getElementById(id);
                if (!el) return;
                el.classList.remove('is-invalid');
                if (el._flatpickr) el._flatpickr.setDate(new Date()); else el.value = '';
            });
            api.populateBuyerDropdown();
            loadBands();
            var modalEl = document.getElementById('sendToDispatchModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#sendToDispatchModal').modal('show');
            }
        },

        onNextSelectBoxes: function () {
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            var collectionInput = document.getElementById('dispatchCollectionDate');
            var deliveryInput = document.getElementById('dispatchDeliveryDate');
            function warn(msg) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', msg, 'warning');
            }
            var opt = (buyerSelect && buyerSelect.value) ? buyerSelect.options[buyerSelect.selectedIndex] : null;
            var buyerName = opt ? ((opt.getAttribute('data-buyer-name') || opt.textContent || '').trim() || null) : null;
            if (!buyerName) {
                if (buyerSelect) buyerSelect.classList.add('is-invalid');
                warn('Please select a customer.');
                return;
            }
            var collectionDisplay = collectionInput && collectionInput.value ? collectionInput.value.trim() : null;
            var collectionISO = collectionDisplay ? deliveryDateToISO(collectionDisplay) : null;
            if (!collectionISO) {
                if (collectionInput) collectionInput.classList.add('is-invalid');
                warn('Please select the planned collection date.');
                return;
            }
            var deliveryDisplay = deliveryInput && deliveryInput.value ? deliveryInput.value.trim() : null;
            var deliveryDateISO = deliveryDisplay ? deliveryDateToISO(deliveryDisplay) : null;
            if (!deliveryDateISO) {
                if (deliveryInput) deliveryInput.classList.add('is-invalid');
                warn('Please select the planned delivery date.');
                return;
            }
            // ISO dates compare correctly as strings
            if (deliveryDateISO < collectionISO) {
                if (deliveryInput) deliveryInput.classList.add('is-invalid');
                warn('The planned delivery date cannot be before the planned collection date.');
                return;
            }
            _pendingDetails = {
                buyer_name: buyerName,
                buyer_contact_id: buyerSelect.value,
                planned_collection_date: collectionISO,
                delivery_date: deliveryDateISO
            };
            api.showStep2(_pendingDetails);
        },

        onSend: function () {
            if (!_pendingDetails || !_pendingDetails.buyer_name) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Customer details missing. Please go back and select a customer.', 'error');
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
                planned_collection_date: _pendingDetails.planned_collection_date,
                delivery_date: _pendingDetails.delivery_date,
                lines: lines
            }).then(function (result) {
                if (result && result.success !== false) {
                    var batchLabel = (lines[0] && lines[0].batch_number) ? lines[0].batch_number : '';
                    if (typeof HandoffDialog !== 'undefined' && HandoffDialog.showSendToDispatch) {
                        HandoffDialog.showSendToDispatch('kernel', batchLabel);
                    } else if (typeof Swal !== 'undefined' && Swal.fire) {
                        Swal.fire({ icon: 'success', title: 'Dispatched', text: 'Dispatch order created successfully.', timer: 2000, showConfirmButton: false });
                    }
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
