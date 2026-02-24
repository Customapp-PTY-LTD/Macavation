/**
 * Modal: Kernel Dispatch Form – Inspection of Vehicle + Dispatch details.
 * Opened from Kernel Dispatch grid when user clicks Dispatch on an order.
 */
var _modal_kernel_dispatch_form = function () {
    'use strict';

    var currentOrderId = null;
    var _flatpickrInstance = null;

    var formatDateForDisplay = function (v) {
        if (!v) return '';
        var d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return '';
        var day = String(d.getDate()).padStart(2, '0');
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var year = d.getFullYear();
        return day + '/' + month + '/' + year;
    };

    var todayISO = function () {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    };

    return {
        init: function () {
            var scope = _modal_kernel_dispatch_form;
            var btn = document.getElementById('kernelDispatchFormSubmitBtn');
            if (btn) {
                btn.removeEventListener('click', scope._boundSubmit);
                scope._boundSubmit = function () { scope.submit(); };
                btn.addEventListener('click', scope._boundSubmit);
            }
            var modalEl = document.getElementById('kernelDispatchFormModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                modalEl.addEventListener('shown.bs.modal', function () {
                    var input = document.getElementById('dispatchDateDispatched');
                    if (input && typeof flatpickr !== 'undefined') {
                        if (_flatpickrInstance) _flatpickrInstance.destroy();
                        _flatpickrInstance = flatpickr(input, { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true });
                    }
                });
                modalEl.addEventListener('hidden.bs.modal', function () {
                    if (_flatpickrInstance) { _flatpickrInstance.destroy(); _flatpickrInstance = null; }
                });
            }
        },

        show: async function (orderId) {
            var scope = _modal_kernel_dispatch_form;
            currentOrderId = orderId;
            scope.clearForm();

            var orderIdEl = document.getElementById('kernelDispatchFormOrderId');
            if (orderIdEl) orderIdEl.value = orderId || '';

            if (orderId && typeof dataFunctions !== 'undefined' && dataFunctions.getKernelDispatchOrder) {
                try {
                    var data = await dataFunctions.getKernelDispatchOrder(orderId);
                    if (data && data.order) {
                        var to = document.getElementById('dispatchDispatchedTo');
                        if (to) to.value = data.order.buyer_name || '';
                        var dateInput = document.getElementById('dispatchDateDispatched');
                        if (dateInput) {
                            var defaultDate = new Date();
                            dateInput.value = formatDateForDisplay(defaultDate);
                        }
                    }
                } catch (e) { console.warn('[Kernel Dispatch Form] Could not pre-fill order', e); }
            } else {
                var dateInput = document.getElementById('dispatchDateDispatched');
                if (dateInput) dateInput.value = formatDateForDisplay(new Date());
            }

            var modalEl = document.getElementById('kernelDispatchFormModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#kernelDispatchFormModal').modal('show');
            }
        },

        clearForm: function () {
            var names = ['vehicleClean', 'vehicleEnclosed', 'hazardSubstances', 'pestInfestations', 'palletsCondition', 'truckBinLocked'];
            names.forEach(function (name) {
                var inputs = document.querySelectorAll('input[name="' + name + '"]');
                inputs.forEach(function (el) { el.checked = false; });
            });
            var ids = ['dispatchPerson', 'dispatchTransportCompany', 'dispatchDeliveryNote', 'dispatchDateDispatched', 'dispatchTruckReg', 'dispatchDriverName', 'dispatchTime', 'dispatchDispatchedTo', 'dispatchSignature'];
            ids.forEach(function (id) {
                var el = document.getElementById(id);
                if (el) el.value = '';
            });
        },

        getDateISO: function () {
            var input = document.getElementById('dispatchDateDispatched');
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
                if (!isNaN(day) && !isNaN(month) && !isNaN(year))
                    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
            }
            return null;
        },

        submit: function () {
            var scope = _modal_kernel_dispatch_form;
            var orderId = document.getElementById('kernelDispatchFormOrderId') && document.getElementById('kernelDispatchFormOrderId').value;
            if (!orderId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Order not found', 'error');
                return;
            }

            var vehicleClean = document.querySelector('input[name="vehicleClean"]:checked');
            var vehicleEnclosed = document.querySelector('input[name="vehicleEnclosed"]:checked');
            var hazardSubstances = document.querySelector('input[name="hazardSubstances"]:checked');
            var pestInfestations = document.querySelector('input[name="pestInfestations"]:checked');
            var palletsCondition = document.querySelector('input[name="palletsCondition"]:checked');
            var truckBinLocked = document.querySelector('input[name="truckBinLocked"]:checked');

            var payload = {
                dispatch_order_id: orderId,
                vehicle_clean_yn: vehicleClean ? vehicleClean.value : null,
                vehicle_enclosed_yn: vehicleEnclosed ? vehicleEnclosed.value : null,
                hazard_substances_yn: hazardSubstances ? hazardSubstances.value : null,
                pest_infestations_yn: pestInfestations ? pestInfestations.value : null,
                pallets_condition_yn: palletsCondition ? palletsCondition.value : null,
                truck_bin_locked_yn: truckBinLocked ? truckBinLocked.value : null,
                dispatch_person: (document.getElementById('dispatchPerson') && document.getElementById('dispatchPerson').value.trim()) || null,
                transport_company: (document.getElementById('dispatchTransportCompany') && document.getElementById('dispatchTransportCompany').value.trim()) || null,
                delivery_note_number: (document.getElementById('dispatchDeliveryNote') && document.getElementById('dispatchDeliveryNote').value.trim()) || null,
                date_dispatched: scope.getDateISO(),
                truck_registration: (document.getElementById('dispatchTruckReg') && document.getElementById('dispatchTruckReg').value.trim()) || null,
                driver_name: (document.getElementById('dispatchDriverName') && document.getElementById('dispatchDriverName').value.trim()) || null,
                time_dispatched: (document.getElementById('dispatchTime') && document.getElementById('dispatchTime').value.trim()) || null,
                dispatched_to: (document.getElementById('dispatchDispatchedTo') && document.getElementById('dispatchDispatchedTo').value.trim()) || null,
                dispatch_signature: (document.getElementById('dispatchSignature') && document.getElementById('dispatchSignature').value.trim()) || null
            };

            if (typeof dataFunctions === 'undefined' || !dataFunctions.saveKernelDispatchRecord) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Save not available', 'error');
                return;
            }

            dataFunctions.saveKernelDispatchRecord(payload).then(function (result) {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Dispatched', text: 'Dispatch record saved. Order marked as dispatched.', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('kernelDispatchFormModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modal = bootstrap.Modal.getInstance(modalEl);
                        if (modal) modal.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#kernelDispatchFormModal').modal('hide');
                    }
                    currentOrderId = null;
                    if (typeof _kernelDispatchGrid !== 'undefined' && _kernelDispatchGrid.loadOrders) _kernelDispatchGrid.loadOrders(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Save failed');
                }
            }).catch(function (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save dispatch record', 'error');
            });
        }
    };
}();
