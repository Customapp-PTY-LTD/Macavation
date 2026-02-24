/**
 * Modal: Send to Dispatch. Step 1: Buyer + delivery date. Step 2: Select boxes by style (qty per style).
 * On Confirm selection: allocate to batches, set dispatchSelectedLines, enter selection mode, hide modal.
 */
var _modal_stock_send_to_dispatch = (function () {
    'use strict';

    var STYLE_KEYS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];

    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };

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

    function computeTotalsByStyle(batches) {
        var totals = {};
        STYLE_KEYS.forEach(function (k) { totals[k] = 0; });
        (batches || []).forEach(function (b) {
            // Prefer remaining_by_style (yield minus already dispatched) when present
            var cells = (b.remaining_by_style && typeof b.remaining_by_style === 'object') ? b.remaining_by_style : null;
            if (cells == null) cells = (b.yield_by_style && typeof b.yield_by_style === 'object') ? b.yield_by_style : {};
            STYLE_KEYS.forEach(function (k) {
                var val = cells[k] != null ? cells[k] : (b['yield_' + k] != null ? b['yield_' + k] : 0);
                if (typeof val === 'number') totals[k] += val;
            });
        });
        return totals;
    }

    function allocateLines(batches, requestedByStyle) {
        var lines = [];
        var batchesSorted = (batches || []).slice().sort(function (a, b) {
            var da = a.received_date || '';
            var db = b.received_date || '';
            if (da !== db) return String(da).localeCompare(String(db));
            return String(a.batch_number || '').localeCompare(String(b.batch_number || ''));
        });
        STYLE_KEYS.forEach(function (style) {
            var remaining = parseFloat(requestedByStyle[style]) || 0;
            if (remaining <= 0) return;
            batchesSorted.forEach(function (batch) {
                if (remaining <= 0) return;
                // Use remaining_by_style when present so we don't allocate more than (yield - already dispatched)
                var cells = (batch.remaining_by_style && typeof batch.remaining_by_style === 'object') ? batch.remaining_by_style : null;
                if (cells == null) cells = (batch.yield_by_style && typeof batch.yield_by_style === 'object') ? batch.yield_by_style : {};
                var available = cells[style] != null ? cells[style] : (batch['yield_' + style] != null ? batch['yield_' + style] : 0);
                if (typeof available !== 'number' || available <= 0) return;
                var take = Math.min(available, remaining);
                if (take > 0) {
                    lines.push({ production_batch_id: batch.id, style: style, quantity_kg: take });
                    remaining -= take;
                }
            });
        });
        return lines;
    }

    var api = {
        init: function () {
            var scope = api;
            var nextBtn = document.getElementById('dispatchModalSelectBoxesBtn');
            if (nextBtn) {
                nextBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.onNextSelectBoxes();
                });
            }
            var backBtn = document.getElementById('dispatchModalBackBtn');
            if (backBtn) {
                backBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.showStep1();
                });
            }
            var confirmBtn = document.getElementById('dispatchModalConfirmSelectionBtn');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.onConfirmSelection();
                });
            }
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            var buyerInput = document.getElementById('dispatchBuyer');
            if (buyerSelect && buyerInput) {
                buyerSelect.addEventListener('change', function () {
                    var sel = buyerSelect.options[buyerSelect.selectedIndex];
                    if (sel && sel.value && buyerInput) {
                        buyerInput.value = sel.getAttribute('data-buyer-name') || sel.textContent || '';
                    }
                });
            }
            document.addEventListener('input', function (e) {
                if (e.target && e.target.closest && e.target.closest('#sendToDispatchModal') && e.target.classList && e.target.classList.contains('is-invalid')) {
                    e.target.classList.remove('is-invalid');
                }
            });
            document.addEventListener('change', function (e) {
                if (e.target && e.target.closest && e.target.closest('#sendToDispatchModal') && e.target.classList && e.target.classList.contains('is-invalid')) {
                    e.target.classList.remove('is-invalid');
                }
            });
            if (typeof $ !== 'undefined') {
                $(document).on('shown.bs.modal', '#sendToDispatchModal', function () {
                    var container = document.getElementById('sendToDispatchModal');
                    var inputs = container ? container.querySelectorAll('.flatpickr-date') : [];
                    inputs.forEach(function (el) {
                        if (el._flatpickr) return;
                        if (typeof flatpickr !== 'undefined') {
                            flatpickr(el, FLATPICKR_DDMMYYYY);
                        }
                    });
                    var deliveryInput = document.getElementById('dispatchDeliveryDate');
                    if (deliveryInput && deliveryInput._flatpickr) {
                        deliveryInput._flatpickr.setDate(new Date());
                    }
                });
            }
        },

        clearInvalidHighlights: function () {
            var el = document.getElementById('dispatchBuyer');
            if (el) el.classList.remove('is-invalid');
            el = document.getElementById('dispatchDeliveryDate');
            if (el) el.classList.remove('is-invalid');
            document.querySelectorAll('#sendToDispatchModal .js-dispatch-qty').forEach(function (input) {
                input.classList.remove('is-invalid');
            });
        },

        highlightInvalidFields: function (opts) {
            api.clearInvalidHighlights();
            if (!opts) return;
            if (opts.step1Ids && Array.isArray(opts.step1Ids)) {
                opts.step1Ids.forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el) el.classList.add('is-invalid');
                });
            }
            if (opts.step2StyleKeys && Array.isArray(opts.step2StyleKeys)) {
                opts.step2StyleKeys.forEach(function (styleKey) {
                    var inputEl = document.querySelector('.js-dispatch-qty[data-style-key="' + styleKey.replace(/"/g, '\\"') + '"]');
                    if (inputEl) inputEl.classList.add('is-invalid');
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

            api.clearInvalidHighlights();
            var d = details || api._pendingDetails || {};
            var buyerLabelEl = document.getElementById('sendToDispatchStep2BuyerLabel');
            var deliveryLabelEl = document.getElementById('sendToDispatchStep2DeliveryLabel');
            if (buyerLabelEl) buyerLabelEl.textContent = d.buyer_name || '—';
            if (deliveryLabelEl) deliveryLabelEl.textContent = (d.delivery_date ? deliveryDateFromISO(d.delivery_date) : '') || '—';

            var scope = typeof _stockManagementGrid !== 'undefined' ? _stockManagementGrid : null;
            var lines = (scope && scope.dispatchSelectedLines) ? scope.dispatchSelectedLines : [];
            var reviewEl = document.getElementById('sendToDispatchStep2ReviewBody');
            if (reviewEl) {
                if (lines.length === 0) {
                    reviewEl.innerHTML = '<p class="text-muted small mb-0">No boxes in basket yet. Close this and click quantity cells in the Kernel Stock by style table to add boxes, then open Send to Dispatch again.</p>';
                } else {
                    var batches = scope && scope.kernelFinishedBatches ? scope.kernelFinishedBatches : [];
                    var batchMap = {};
                    batches.forEach(function (b) { batchMap[b.id] = b; });
                    var totalKg = 0;
                    var html = '<table class="table table-sm table-bordered mb-0"><thead class="table-light"><tr><th>Batch</th><th>Style</th><th class="text-end">Qty (kg)</th></tr></thead><tbody>';
                    lines.forEach(function (line) {
                        var batch = batchMap[line.production_batch_id || line.batch_id];
                        var batchNum = batch ? batch.batch_number : (line.production_batch_id || line.batch_id);
                        var qty = parseFloat(line.quantity_kg) || 0;
                        totalKg += qty;
                        html += '<tr><td>' + (batchNum || '—') + '</td><td>' + (line.style || '—') + '</td><td class="text-end">' + qty + '</td></tr>';
                    });
                    html += '</tbody></table><p class="small text-muted mt-2 mb-0">Total: ' + totalKg.toFixed(1) + ' kg</p>';
                    reviewEl.innerHTML = html;
                }
            }
        },

        show: function (selectedBatch) {
            api._selectedBatch = selectedBatch && typeof selectedBatch === 'object' ? selectedBatch : null;
            api.showStep1();
            api.clearInvalidHighlights();
            var batchSummary = document.getElementById('sendToDispatchStep1BatchSummary');
            var batchLabel = document.getElementById('sendToDispatchStep1BatchLabel');
            if (batchSummary && batchLabel) {
                if (api._selectedBatch && (api._selectedBatch.batch_number || api._selectedBatch.id)) {
                    batchLabel.textContent = api._selectedBatch.batch_number || api._selectedBatch.id;
                    batchSummary.style.display = '';
                } else {
                    batchSummary.style.display = 'none';
                }
            }
            var buyerInput = document.getElementById('dispatchBuyer');
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            var deliveryInput = document.getElementById('dispatchDeliveryDate');
            if (buyerInput) buyerInput.value = '';
            if (deliveryInput && deliveryInput._flatpickr) {
                deliveryInput._flatpickr.setDate(new Date());
            } else if (deliveryInput) {
                deliveryInput.value = '';
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
                var inst = bootstrap.Modal.getOrCreateInstance(modalEl);
                inst.show();
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
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Validation', 'Please enter the buyer name.', 'warning').then(function () {
                        api.highlightInvalidFields({ step1Ids: ['dispatchBuyer'] });
                    });
                }
                return;
            }
            var deliveryDisplay = deliveryInput && deliveryInput.value ? deliveryInput.value.trim() : null;
            var deliveryDateISO = deliveryDisplay ? deliveryDateToISO(deliveryDisplay) : null;
            if (!deliveryDateISO) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Validation', 'Please select the delivery date.', 'warning').then(function () {
                        api.highlightInvalidFields({ step1Ids: ['dispatchDeliveryDate'] });
                    });
                }
                return;
            }
            var details = {
                buyer_name: buyerName,
                buyer_contact_id: (buyerSelect && buyerSelect.value) ? buyerSelect.value : null,
                delivery_date: deliveryDateISO
            };

            var scope = typeof _stockManagementGrid !== 'undefined' ? _stockManagementGrid : null;
            if (scope) {
                scope.dispatchOrderDetails = details;
                if (scope.saveDispatchDraft) scope.saveDispatchDraft();
            }

            api._pendingDetails = details;
            api.showStep2(details);
        },

        getDetailsFromStep1Form: function () {
            var buyerInput = document.getElementById('dispatchBuyer');
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            var deliveryInput = document.getElementById('dispatchDeliveryDate');
            var buyerName = (buyerInput && buyerInput.value && buyerInput.value.trim()) ? buyerInput.value.trim() : null;
            var deliveryDisplay = deliveryInput && deliveryInput.value ? deliveryInput.value.trim() : null;
            var deliveryDateISO = deliveryDisplay ? deliveryDateToISO(deliveryDisplay) : null;
            if (!buyerName || !deliveryDateISO) return null;
            return {
                buyer_name: buyerName,
                buyer_contact_id: (buyerSelect && buyerSelect.value) ? buyerSelect.value : null,
                delivery_date: deliveryDateISO
            };
        },

        onConfirmSelection: function () {
            var details = api._pendingDetails;
            if (!details || !details.buyer_name) {
                details = api.getDetailsFromStep1Form();
            }
            var scope = typeof _stockManagementGrid !== 'undefined' ? _stockManagementGrid : null;
            if (scope && details && details.buyer_name) {
                scope.dispatchOrderDetails = details;
                if (scope.saveDispatchDraft) scope.saveDispatchDraft();
            }

            var modalEl = document.getElementById('sendToDispatchModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                var bsModal = bootstrap.Modal.getInstance(modalEl);
                if (bsModal) bsModal.hide();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#sendToDispatchModal').modal('hide');
            }
            api._pendingDetails = null;
        }
    };
    return api;
})();
_modal_stock_send_to_dispatch.init();
