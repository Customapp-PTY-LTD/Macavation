/**
 * Modal: Oil Dispatch Form – Inspection of Vehicle + Dispatch details.
 * Opened from Oil Dispatch grid when user clicks Dispatch on an order. Mirrors modal_kernel_dispatch_form.
 */
var _modal_oil_dispatch_form = (function () {
    'use strict';

    var currentOrderId = null;
    var _flatpickrInstance = null;

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

    return {
        init: () => {
            const scope = _modal_oil_dispatch_form;
            var modalEl = document.getElementById('oilDispatchFormModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                modalEl.addEventListener('shown.bs.modal', function () {
                    var input = document.getElementById('oilDispatchDateDispatched');
                    if (input && typeof flatpickr !== 'undefined') {
                        if (_flatpickrInstance) _flatpickrInstance.destroy();
                        _flatpickrInstance = flatpickr(input, { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true });
                    }
                });
                modalEl.addEventListener('hidden.bs.modal', function () {
                    if (_flatpickrInstance) { _flatpickrInstance.destroy(); _flatpickrInstance = null; }
                });
            }
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_oil_dispatch_form;
            $('#oilDispatchFormSubmitBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.submit();
            });
        },

        show: (orderId) => {
            const scope = _modal_oil_dispatch_form;
            currentOrderId = orderId;
            scope.clearForm();

            $('#oilDispatchFormOrderId').val(orderId || '');

            if (orderId && typeof dataFunctions !== 'undefined' && dataFunctions.getOilDispatchOrder) {
                dataFunctions.getOilDispatchOrder(orderId).then(function (data) {
                    if (data && data.order) {
                        $('#oilDispatchDispatchedTo').val(data.order.buyer_name || '');
                        var dateInput = document.getElementById('oilDispatchDateDispatched');
                        if (dateInput) dateInput.value = formatDateForDisplay(new Date());
                    }
                    scope.openModal();
                }).catch(function (e) {
                    console.warn('[Oil Dispatch Form] Could not pre-fill order', e);
                    var dateInput = document.getElementById('oilDispatchDateDispatched');
                    if (dateInput) dateInput.value = formatDateForDisplay(new Date());
                    scope.openModal();
                });
            } else {
                var dateInput = document.getElementById('oilDispatchDateDispatched');
                if (dateInput) dateInput.value = formatDateForDisplay(new Date());
                scope.openModal();
            }
        },

        openModal: () => {
            var modalEl = document.getElementById('oilDispatchFormModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#oilDispatchFormModal').modal('show');
            }
        },

        clearForm: () => {
            var names = ['oilVehicleClean', 'oilVehicleEnclosed', 'oilHazardSubstances', 'oilPestInfestations', 'oilPalletsCondition', 'oilTruckBinLocked'];
            names.forEach(function (name) {
                $('input[name="' + name + '"]').prop('checked', false);
            });
            var ids = ['oilDispatchPerson', 'oilDispatchTransportCompany', 'oilDispatchDeliveryNote', 'oilDispatchDateDispatched', 'oilDispatchTruckReg', 'oilDispatchDriverName', 'oilDispatchTime', 'oilDispatchDispatchedTo', 'oilDispatchSignature', 'oilDispatchFormOrderId'];
            ids.forEach(function (id) {
                $('#' + id).val('');
            });
        },

        getDateISO: () => {
            var input = document.getElementById('oilDispatchDateDispatched');
            if (!input) return null;
            if (_flatpickrInstance && _flatpickrInstance.selectedDates && _flatpickrInstance.selectedDates.length > 0) {
                var d = _flatpickrInstance.selectedDates[0];
                return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            }
            var raw = (input.value || '').trim();
            if (!raw) return null;
            var parts = raw.split('/');
            if (parts.length === 3) {
                var day = parseInt(parts[0], 10);
                var month = parseInt(parts[1], 10);
                var year = parseInt(parts[2], 10);
                if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
                }
            }
            return null;
        },

        submit: () => {
            const scope = _modal_oil_dispatch_form;
            var orderId = $('#oilDispatchFormOrderId').val();
            if (!orderId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Order not found', 'error');
                return;
            }

            var vehicleClean = $('input[name="oilVehicleClean"]:checked');
            var vehicleEnclosed = $('input[name="oilVehicleEnclosed"]:checked');
            var hazardSubstances = $('input[name="oilHazardSubstances"]:checked');
            var pestInfestations = $('input[name="oilPestInfestations"]:checked');
            var palletsCondition = $('input[name="oilPalletsCondition"]:checked');
            var truckBinLocked = $('input[name="oilTruckBinLocked"]:checked');

            var payload = {
                dispatch_order_id: orderId,
                vehicle_clean_yn: vehicleClean.length ? vehicleClean.val() : null,
                vehicle_enclosed_yn: vehicleEnclosed.length ? vehicleEnclosed.val() : null,
                hazard_substances_yn: hazardSubstances.length ? hazardSubstances.val() : null,
                pest_infestations_yn: pestInfestations.length ? pestInfestations.val() : null,
                pallets_condition_yn: palletsCondition.length ? palletsCondition.val() : null,
                truck_bin_locked_yn: truckBinLocked.length ? truckBinLocked.val() : null,
                dispatch_person: ($('#oilDispatchPerson').val() || '').trim() || null,
                transport_company: ($('#oilDispatchTransportCompany').val() || '').trim() || null,
                delivery_note_number: ($('#oilDispatchDeliveryNote').val() || '').trim() || null,
                date_dispatched: scope.getDateISO(),
                truck_registration: ($('#oilDispatchTruckReg').val() || '').trim() || null,
                driver_name: ($('#oilDispatchDriverName').val() || '').trim() || null,
                time_dispatched: ($('#oilDispatchTime').val() || '').trim() || null,
                dispatched_to: ($('#oilDispatchDispatchedTo').val() || '').trim() || null,
                dispatch_signature: ($('#oilDispatchSignature').val() || '').trim() || null
            };

            if (typeof dataFunctions === 'undefined' || !dataFunctions.saveOilDispatchRecord) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Save not available', 'error');
                return;
            }

            dataFunctions.saveOilDispatchRecord(payload).then(function (result) {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Dispatched', text: 'Dispatch record saved. Order marked as dispatched.', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('oilDispatchFormModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modal = bootstrap.Modal.getInstance(modalEl);
                        if (modal) modal.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#oilDispatchFormModal').modal('hide');
                    }
                    currentOrderId = null;
                    if (typeof _oilDispatchGrid !== 'undefined' && _oilDispatchGrid.loadOrders) _oilDispatchGrid.loadOrders(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Save failed');
                }
            }).catch(function (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save dispatch record', 'error');
            });
        }
    };
}());
_modal_oil_dispatch_form.init();
