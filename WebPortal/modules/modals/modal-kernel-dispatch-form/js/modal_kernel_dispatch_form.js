/**
 * Modal: Kernel Dispatch Form – Inspection of Vehicle + Dispatch details.
 * Opened from Kernel Dispatch grid for Dispatch and View sheet (basket + saved record).
 */
var _modal_kernel_dispatch_form = (function () {
    'use strict';

    var currentOrderId = null;
    var readOnlyMode = false;
    var _flatpickrInstance = null;

    /** Display date dd/mm/yyyy; use _common.formatDateDDMMYYYY when available (company standard). */
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

    /** ISO date string or Date → dd/mm/yyyy for flatpickr text input. */
    function formatDateForDisplayFromISO(s) {
        if (!s) return '';
        var str = String(s).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
            return formatDateForDisplay(new Date(str.substring(0, 10) + 'T12:00:00'));
        }
        return formatDateForDisplay(s);
    }

    function setRadioByValue(name, val) {
        if (val == null || val === '') return;
        var $inputs = $('input[name="' + name + '"]');
        $inputs.prop('checked', false);
        $inputs.filter(function () { return $(this).val() === String(val); }).prop('checked', true);
    }

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    return {
        init: () => {
            const scope = _modal_kernel_dispatch_form;
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
                    scope.setFormReadOnly(false);
                    readOnlyMode = false;
                });
            }
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_kernel_dispatch_form;
            $('#kernelDispatchFormSubmitBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.submit();
            });
            $('#kernelDispatchFormEditDispatchedBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.revertToAwaitingDispatch();
            });
        },

        show: (orderId) => {
            const scope = _modal_kernel_dispatch_form;
            currentOrderId = orderId;
            scope.clearForm();

            $('#kernelDispatchFormOrderId').val(orderId || '');

            if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.getKernelDispatchOrder) {
                scope.renderBasketLines([], null);
                var dateInputA = document.getElementById('dispatchDateDispatched');
                if (dateInputA) dateInputA.value = formatDateForDisplay(new Date());
                readOnlyMode = false;
                scope.setFormReadOnly(false);
                scope.openModal();
                return;
            }

            dataFunctions.getKernelDispatchOrder(orderId).then(function (data) {
                var ro = !!(data && data.order && data.order.status === 'dispatched');
                readOnlyMode = ro;

                var lines = data && Array.isArray(data.lines) ? data.lines : [];
                scope.renderBasketLines(lines, data && data.order ? data.order : null);

                if (data && data.order) {
                    var rec = data.order.record;
                    if (rec != null && typeof rec === 'string') {
                        try { rec = JSON.parse(rec); } catch (e) { rec = null; }
                    }
                    scope.applyDispatchRecord(rec || {}, data.order);
                } else {
                    var dateInputB = document.getElementById('dispatchDateDispatched');
                    if (dateInputB) dateInputB.value = formatDateForDisplay(new Date());
                }

                scope.setFormReadOnly(ro);
                scope.openModal();
            }).catch(function (e) {
                console.warn('[Kernel Dispatch Form] Could not load order', e);
                readOnlyMode = false;
                scope.renderBasketLines([], null);
                var dateInputC = document.getElementById('dispatchDateDispatched');
                if (dateInputC) dateInputC.value = formatDateForDisplay(new Date());
                scope.setFormReadOnly(false);
                scope.openModal();
            });
        },

        renderBasketLines: (lines, order) => {
            var tbody = document.getElementById('kernelDispatchFormBasketBody');
            var meta = document.getElementById('kernelDispatchFormOrderMeta');
            if (meta) {
                if (order) {
                    var del = formatDateForDisplay(order.delivery_date);
                    var parts = [order.buyer_name || '—'];
                    if (del) parts.push('Delivery ' + del);
                    if (order.status) parts.push(order.status);
                    meta.textContent = parts.join(' · ');
                } else {
                    meta.textContent = '';
                }
            }
            if (!tbody) return;
            tbody.innerHTML = '';
            lines = Array.isArray(lines) ? lines : [];
            var kgPerCarton = 11.34;
            if (!lines.length) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No lines on this order.</td></tr>';
                return;
            }
            lines.forEach(function (line) {
                var tr = document.createElement('tr');
                var qtyKg = (line.cartons != null && line.cartons >= 0)
                    ? (Math.round(line.cartons * kgPerCarton * 100) / 100)
                    : (line.quantity_kg != null ? Number(line.quantity_kg) : null);
                var qtyDisplay = (line.cartons != null && line.cartons >= 0)
                    ? (line.cartons + ' ct · ' + (qtyKg != null ? qtyKg : '—') + ' kg')
                    : (qtyKg != null ? qtyKg + ' kg' : '—');
                tr.innerHTML = '<td>' + escapeHtml(line.batch_number || '—') + '</td><td>' + escapeHtml(line.style || '—') + '</td><td class="text-end">' + qtyDisplay + '</td>';
                tbody.appendChild(tr);
            });
        },

        applyDispatchRecord: (record, order) => {
            record = record || {};
            setRadioByValue('vehicleClean', record.vehicle_clean_yn);
            setRadioByValue('vehicleEnclosed', record.vehicle_enclosed_yn);
            setRadioByValue('hazardSubstances', record.hazard_substances_yn);
            setRadioByValue('pestInfestations', record.pest_infestations_yn);
            setRadioByValue('palletsCondition', record.pallets_condition_yn);
            setRadioByValue('truckBinLocked', record.truck_bin_locked_yn);

            $('#dispatchPerson').val(record.dispatch_person || '');
            $('#dispatchTransportCompany').val(record.transport_company || '');
            $('#dispatchDeliveryNote').val(record.delivery_note_number || '');
            var dateInput = document.getElementById('dispatchDateDispatched');
            if (dateInput) {
                if (record.date_dispatched) {
                    dateInput.value = formatDateForDisplayFromISO(record.date_dispatched);
                } else {
                    dateInput.value = formatDateForDisplay(new Date());
                }
            }
            $('#dispatchTruckReg').val(record.truck_registration || '');
            $('#dispatchDriverName').val(record.driver_name || '');
            var tm = record.time_dispatched;
            if (tm != null && String(tm).trim()) {
                var t = String(tm).trim();
                $('#dispatchTime').val(t.length >= 5 && t.indexOf(':') >= 0 ? t.substring(0, 5) : t);
            } else {
                $('#dispatchTime').val('');
            }
            $('#dispatchDispatchedTo').val(record.dispatched_to || order.buyer_name || '');
            $('#dispatchSignature').val(record.dispatch_signature || '');
        },

        setFormReadOnly: (ro) => {
            var form = document.getElementById('kernelDispatchFormForm');
            if (form) {
                $(form).find('input, textarea, select').each(function () {
                    if (this.id === 'kernelDispatchFormOrderId') return;
                    $(this).prop('disabled', !!ro);
                });
            }
            $('#kernelDispatchFormSubmitBtn').toggleClass('d-none', !!ro);
            $('#kernelDispatchFormEditDispatchedBtn').toggleClass('d-none', !ro);
            var cancel = document.getElementById('kernelDispatchFormCancelBtn');
            if (cancel) cancel.textContent = ro ? 'Close' : 'Cancel';
            var title = document.getElementById('kernelDispatchFormModalLabel');
            if (title) title.textContent = ro ? 'Inspection of Vehicle & Dispatch (dispatched)' : 'Inspection of Vehicle & Dispatch';
        },

        openModal: () => {
            var modalEl = document.getElementById('kernelDispatchFormModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#kernelDispatchFormModal').modal('show');
            }
        },

        clearForm: () => {
            const scope = _modal_kernel_dispatch_form;
            scope.setFormReadOnly(false);
            readOnlyMode = false;
            var meta = document.getElementById('kernelDispatchFormOrderMeta');
            if (meta) meta.textContent = '';
            var tbody = document.getElementById('kernelDispatchFormBasketBody');
            if (tbody) tbody.innerHTML = '';

            var names = ['vehicleClean', 'vehicleEnclosed', 'hazardSubstances', 'pestInfestations', 'palletsCondition', 'truckBinLocked'];
            names.forEach(function (name) {
                $('input[name="' + name + '"]').prop('checked', false);
            });
            var ids = ['dispatchPerson', 'dispatchTransportCompany', 'dispatchDeliveryNote', 'dispatchDateDispatched', 'dispatchTruckReg', 'dispatchDriverName', 'dispatchTime', 'dispatchDispatchedTo', 'dispatchSignature', 'kernelDispatchFormOrderId'];
            ids.forEach(function (id) {
                $('#' + id).val('');
            });
        },

        getDateISO: () => {
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
                if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
                    return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
                }
            }
            return null;
        },

        submit: () => {
            const scope = _modal_kernel_dispatch_form;
            if (readOnlyMode) return;

            var orderId = $('#kernelDispatchFormOrderId').val();
            if (!orderId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Order not found', 'error');
                return;
            }

            var vehicleClean = $('input[name="vehicleClean"]:checked');
            var vehicleEnclosed = $('input[name="vehicleEnclosed"]:checked');
            var hazardSubstances = $('input[name="hazardSubstances"]:checked');
            var pestInfestations = $('input[name="pestInfestations"]:checked');
            var palletsCondition = $('input[name="palletsCondition"]:checked');
            var truckBinLocked = $('input[name="truckBinLocked"]:checked');

            var payload = {
                dispatch_order_id: orderId,
                vehicle_clean_yn: vehicleClean.length ? vehicleClean.val() : null,
                vehicle_enclosed_yn: vehicleEnclosed.length ? vehicleEnclosed.val() : null,
                hazard_substances_yn: hazardSubstances.length ? hazardSubstances.val() : null,
                pest_infestations_yn: pestInfestations.length ? pestInfestations.val() : null,
                pallets_condition_yn: palletsCondition.length ? palletsCondition.val() : null,
                truck_bin_locked_yn: truckBinLocked.length ? truckBinLocked.val() : null,
                dispatch_person: ($('#dispatchPerson').val() || '').trim() || null,
                transport_company: ($('#dispatchTransportCompany').val() || '').trim() || null,
                delivery_note_number: ($('#dispatchDeliveryNote').val() || '').trim() || null,
                date_dispatched: scope.getDateISO(),
                truck_registration: ($('#dispatchTruckReg').val() || '').trim() || null,
                driver_name: ($('#dispatchDriverName').val() || '').trim() || null,
                time_dispatched: ($('#dispatchTime').val() || '').trim() || null,
                dispatched_to: ($('#dispatchDispatchedTo').val() || '').trim() || null,
                dispatch_signature: ($('#dispatchSignature').val() || '').trim() || null
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
        },

        revertToAwaitingDispatch: () => {
            const scope = _modal_kernel_dispatch_form;
            if (!readOnlyMode) return;
            var orderId = $('#kernelDispatchFormOrderId').val();
            if (!orderId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Order not found', 'error');
                return;
            }
            if (typeof dataFunctions === 'undefined' || !dataFunctions.revertKernelDispatchOrder) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Revert is not available', 'error');
                return;
            }
            var runRevert = function () {
                dataFunctions.revertKernelDispatchOrder(orderId).then(function (result) {
                    if (result && result.success !== false) {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Basket unlocked for editing', text: (result && result.message) ? result.message : '', timer: 2200, showConfirmButton: false });
                        return dataFunctions.getKernelDispatchOrder(orderId);
                    }
                    throw new Error(result && result.error ? result.error : 'Revert failed');
                }).then(function (data) {
                    readOnlyMode = false;
                    var lines = data && Array.isArray(data.lines) ? data.lines : [];
                    var order = data && data.order ? data.order : null;
                    scope.renderBasketLines(lines, order);
                    scope.applyDispatchRecord({}, order || {});
                    scope.setFormReadOnly(false);
                    if (typeof _kernelDispatchGrid !== 'undefined' && _kernelDispatchGrid.loadOrders) _kernelDispatchGrid.loadOrders(true);
                }).catch(function (e) {
                    console.error(e);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to revert dispatch', 'error');
                });
            };
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Edit dispatched basket?',
                    html: 'This unlocks the basket for editing: it moves back to <strong>Ready to dispatch</strong> and clears saved inspection and dispatch paperwork. Use when dispatch was recorded in error.',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, unlock for editing',
                    cancelButtonText: 'Cancel',
                    focusCancel: true
                }).then(function (res) { if (res.isConfirmed) runRevert(); });
            } else if (window.confirm('Unlock this basket for editing? Saved dispatch paperwork will be cleared.')) {
                runRevert();
            }
        }
    };
}());
_modal_kernel_dispatch_form.init();
