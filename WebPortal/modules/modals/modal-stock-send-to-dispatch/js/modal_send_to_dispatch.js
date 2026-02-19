/**
 * Modal: Send to Dispatch. Step 1: Buyer + delivery date. Step 2: Select boxes by style (qty per style).
 * On Confirm selection: allocate to batches, set dispatchSelectedLines, enter selection mode, hide modal.
 */
var _modal_stock_send_to_dispatch = (function () {
    'use strict';

    var STYLE_KEYS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];

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

        showStep2: function (totalsByStyle) {
            var step1 = document.getElementById('sendToDispatchStep1');
            var step2 = document.getElementById('sendToDispatchStep2');
            var footer1 = document.getElementById('sendToDispatchStep1Footer');
            var footer2 = document.getElementById('sendToDispatchStep2Footer');
            if (step1) step1.style.display = 'none';
            if (step2) step2.style.display = '';
            if (footer1) footer1.style.display = 'none';
            if (footer2) footer2.style.display = '';

            api._step2TotalsByStyle = totalsByStyle || {};
            api.clearInvalidHighlights();
            STYLE_KEYS.forEach(function (styleKey) {
                var availableEl = document.querySelector('.dispatch-available[data-style-key="' + styleKey.replace(/"/g, '\\"') + '"]');
                var inputEl = document.querySelector('.js-dispatch-qty[data-style-key="' + styleKey.replace(/"/g, '\\"') + '"]');
                var available = totalsByStyle[styleKey] != null ? totalsByStyle[styleKey] : 0;
                if (availableEl) {
                    availableEl.textContent = available;
                }
                if (inputEl) {
                    inputEl.value = '';
                    inputEl.max = available;
                    inputEl.placeholder = '0';
                }
            });
        },

        show: function () {
            api.showStep1();
            api.clearInvalidHighlights();
            var buyerInput = document.getElementById('dispatchBuyer');
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            var deliveryInput = document.getElementById('dispatchDeliveryDate');
            if (buyerInput) buyerInput.value = '';
            if (deliveryInput) {
                var today = new Date().toISOString().split('T')[0];
                deliveryInput.value = today;
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
            var deliveryDate = deliveryInput && deliveryInput.value ? deliveryInput.value : null;
            if (!deliveryDate) {
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
                delivery_date: deliveryDate
            };

            var scope = typeof _stockManagementGrid !== 'undefined' ? _stockManagementGrid : null;
            var batches = scope && scope.kernelFinishedBatches ? scope.kernelFinishedBatches : [];
            var totalsByStyle = computeTotalsByStyle(batches);
            var totalAvailable = 0;
            STYLE_KEYS.forEach(function (k) { totalAvailable += totalsByStyle[k] || 0; });
            if (totalAvailable <= 0) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Info', 'No kernel stock available. Release batches to stock from Kernel Production first.', 'info');
                }
                return;
            }

            api._pendingDetails = details;
            api.showStep2(totalsByStyle);
        },

        getDetailsFromStep1Form: function () {
            var buyerInput = document.getElementById('dispatchBuyer');
            var buyerSelect = document.getElementById('dispatchBuyerContact');
            var deliveryInput = document.getElementById('dispatchDeliveryDate');
            var buyerName = (buyerInput && buyerInput.value && buyerInput.value.trim()) ? buyerInput.value.trim() : null;
            var deliveryDate = deliveryInput && deliveryInput.value ? deliveryInput.value : null;
            if (!buyerName || !deliveryDate) return null;
            return {
                buyer_name: buyerName,
                buyer_contact_id: (buyerSelect && buyerSelect.value) ? buyerSelect.value : null,
                delivery_date: deliveryDate
            };
        },

        onConfirmSelection: function () {
            var requestedByStyle = {};
            var hasAny = false;
            STYLE_KEYS.forEach(function (styleKey) {
                var inputEl = document.querySelector('.js-dispatch-qty[data-style-key="' + styleKey.replace(/"/g, '\\"') + '"]');
                var val = inputEl ? parseFloat(inputEl.value) : 0;
                if (isNaN(val) || val < 0) val = 0;
                requestedByStyle[styleKey] = val;
                if (val > 0) hasAny = true;
            });
            if (!hasAny) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Validation', 'Please enter at least one quantity to dispatch.', 'warning').then(function () {
                        api.highlightInvalidFields({ step2StyleKeys: STYLE_KEYS });
                    });
                }
                return;
            }

            var totalsByStyle = api._step2TotalsByStyle || {};
            var overLimit = [];
            var overLimitStyleKeys = [];
            STYLE_KEYS.forEach(function (styleKey) {
                var requested = requestedByStyle[styleKey] || 0;
                var available = totalsByStyle[styleKey] != null ? totalsByStyle[styleKey] : 0;
                if (requested > available) {
                    overLimit.push(styleKey + ' (requested ' + requested + ' kg, available ' + available + ' kg)');
                    overLimitStyleKeys.push(styleKey);
                }
            });
            if (overLimit.length > 0) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Validation', 'Quantity exceeds available for: ' + overLimit.join('; ') + '. Please reduce the amount(s).', 'warning').then(function () {
                        api.highlightInvalidFields({ step2StyleKeys: overLimitStyleKeys });
                    });
                }
                return;
            }

            var details = api._pendingDetails;
            if (!details || !details.buyer_name) {
                details = api.getDetailsFromStep1Form();
            }
            if (!details || !details.buyer_name) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Validation', 'Dispatch details missing. Please click Back and re-enter buyer and delivery date in Step 1.', 'warning').then(function () {
                        api.showStep1();
                        api.highlightInvalidFields({ step1Ids: ['dispatchBuyer', 'dispatchDeliveryDate'] });
                    });
                } else {
                    api.showStep1();
                }
                return;
            }

            var scope = typeof _stockManagementGrid !== 'undefined' ? _stockManagementGrid : null;
            var batches = scope && scope.kernelFinishedBatches ? scope.kernelFinishedBatches : [];
            var lines = allocateLines(batches, requestedByStyle);
            if (lines.length === 0) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Validation', 'Could not allocate quantities to stock. Check that requested amounts do not exceed available.', 'warning').then(function () {
                        api.highlightInvalidFields({ step2StyleKeys: STYLE_KEYS });
                    });
                }
                return;
            }

            if (scope.enterDispatchSelectionMode) {
                scope.enterDispatchSelectionMode(details);
            }
            scope.dispatchSelectedLines = lines;
            scope.renderDispatchSelectedList && scope.renderDispatchSelectedList();
            var summary = document.getElementById('dispatchSelectedSummary');
            if (summary) summary.style.display = lines.length > 0 ? '' : 'none';

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
