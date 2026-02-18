/**
 * Modal: Send to Dispatch. Parent (stock-management grid) calls show(); on "Next: Select boxes" validates,
 * calls _stockManagementGrid.enterDispatchSelectionMode(details) and hides.
 */
var _modal_stock_send_to_dispatch = (function () {
    'use strict';

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
        },

        show: function () {
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
                new bootstrap.Modal(modalEl).show();
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
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', 'Please enter the buyer name.', 'warning');
                return;
            }
            var deliveryDate = deliveryInput && deliveryInput.value ? deliveryInput.value : null;
            if (!deliveryDate) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Validation', 'Please select the delivery date.', 'warning');
                return;
            }
            var details = {
                buyer_name: buyerName,
                buyer_contact_id: (buyerSelect && buyerSelect.value) ? buyerSelect.value : null,
                delivery_date: deliveryDate
            };

            var modalEl = document.getElementById('sendToDispatchModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                var bsModal = bootstrap.Modal.getInstance(modalEl);
                if (bsModal) bsModal.hide();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#sendToDispatchModal').modal('hide');
            }

            if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.enterDispatchSelectionMode) {
                _stockManagementGrid.enterDispatchSelectionMode(details);
            }
        }
    };
    return api;
})();
