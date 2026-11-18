/**
 * Modal: Oil Dispatch Form – Inspection of Vehicle + Dispatch details.
 * Opened from Oil Dispatch grid for Dispatch and View sheet (basket + saved record).
 */
var _modal_oil_dispatch_form = (function () {
    'use strict';

    var currentOrderId = null;
    var readOnlyMode = false;
    var _flatpickrInstance = null;
    var orderWasDispatched = false;
    var dsp = DispatchFormShared.create({ prefix: 'oilDsp', folder: 'Macavation/OilDispatch' });

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
        return _common.escapeHtml(s);
    }

    /** Fill a text input only when it is currently empty. */
    function fillIfEmpty(id, val) {
        var $el = $('#' + id);
        if (val && !String($el.val() || '').trim()) { $el.val(val); return true; }
        return false;
    }

    /** The "Filled from the customer record" / "Fills in once ..." hints under the prefilled fields. */
    function showPrefillHints(person, cell, to) {
        $('#oilDispatchPersonHint').toggleClass('d-none', !person);
        $('#oilDispatchCellHint').toggleClass('d-none', !cell);
        $('#oilDispatchDispatchedToHint').toggleClass('d-none', !to);
    }

    /** Loads the transporter list and (for an open order) pre-fills Attention / Cell / Dispatched to from the customer contact. Never rejects. */
    function loadExtras(order, ro) {
        var contactP = (!ro && order) ? dsp.loadCustomerContact(order.buyer_contact_id) : Promise.resolve(null);
        return Promise.all([dsp.loadTransporters(), contactP]).then(function (r) {
            var c = r[1];
            if (ro || !order) return;
            var filledPerson = false, filledTo = false;
            if (c) {
                filledPerson = fillIfEmpty('oilDispatchPerson', c.name);
                fillIfEmpty('oilDispatchCell', c.cell);
                filledTo = fillIfEmpty('oilDispatchDispatchedTo', c.company);
            }
            filledTo = fillIfEmpty('oilDispatchDispatchedTo', order.buyer_name) || filledTo;
            showPrefillHints(filledPerson, !String($('#oilDispatchCell').val() || '').trim(), filledTo);
        }).catch(function (e) { console.warn('[Dispatch form] extras failed', e); });
    }

    // ---- Transport cost (oil_dispatch_orders.transport_payer / transport_cost_zar), read by the monthly
    // report. Stays editable after dispatch because the transporter's invoice often comes later. ----
    // Tickbox "Customer pays transport": ticked = no cost needed (payer 'customer'); unticked = Macavation pays.
    function syncTransportCostField() {
        var customer = $('#oilDispatchCustomerPays').is(':checked');
        var $cost = $('#oilDispatchTransportCost');
        if (customer) $cost.val('');
        $cost.prop('disabled', customer);
    }

    /** { payer, cost, error } from the form; error is a sentence when the entry cannot be saved. */
    function readTransportCost() {
        var customer = $('#oilDispatchCustomerPays').is(':checked');
        var raw = customer ? '' : String($('#oilDispatchTransportCost').val() || '').trim();
        var cost = raw === '' ? null : Number(raw);
        if (raw !== '' && (!isFinite(cost) || cost < 0)) return { error: 'Transport cost must be a Rand amount of 0 or more, or left blank.' };
        return { payer: customer ? 'customer' : 'macavation', cost: cost, error: null };
    }

    function loadTransportCost(orderId) {
        if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.getOilDispatchTransport) return Promise.resolve();
        return dataFunctions.getOilDispatchTransport(orderId).then(function (t) {
            if (String(currentOrderId) !== String(orderId)) return;
            t = t || {};
            $('#oilDispatchCustomerPays').prop('checked', t.transport_payer === 'customer');
            $('#oilDispatchTransportCost').val(t.transport_cost_zar != null ? Number(t.transport_cost_zar).toFixed(2) : '');
            syncTransportCostField();
        }).catch(function (e) { console.warn('[Oil Dispatch Form] transport cost not loaded', e); });
    }

    /** Resolves to an error sentence, or null when saved / nothing to save. Never rejects. */
    function saveTransportCost(orderId, tc) {
        if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.setOilDispatchTransport) return Promise.resolve(null);
        return dataFunctions.setOilDispatchTransport(orderId, tc.payer, tc.cost).then(function (res) {
            return res && res.success === false ? (res.error || 'Transport cost was not saved.') : null;
        }).catch(function (e) {
            console.error('[Oil Dispatch Form] transport cost save failed', e);
            return (e && e.message) || 'Transport cost was not saved.';
        });
    }

    return {
        init: () => {
            const scope = _modal_oil_dispatch_form;
            var modalEl = document.getElementById('oilDispatchFormModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                modalEl.addEventListener('shown.bs.modal', function () {
                    dsp.initSignature();
                    var input = document.getElementById('oilDispatchDateDispatched');
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
            dsp.init();
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_oil_dispatch_form;
            $('#oilDispatchFormSubmitBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.submit();
            });
            $('#oilDispatchCustomerPays').off('change').on('change', syncTransportCostField);
            // After dispatch the form is read-only except transport cost, which saves on its own.
            $('#oilDispatchTransportSaveBtn').off('click').on('click', function (e) {
                e.preventDefault();
                var tc = readTransportCost();
                if (tc.error) { if (typeof Swal !== 'undefined') Swal.fire('Check the transport cost', tc.error, 'warning'); return; }
                var $btn = $(this).prop('disabled', true);
                saveTransportCost(currentOrderId, tc).then(function (err) {
                    $btn.prop('disabled', false);
                    if (typeof Swal === 'undefined') return;
                    if (err) Swal.fire('Not saved', err, 'error');
                    else Swal.fire({ icon: 'success', title: 'Saved', text: 'Transport cost saved.', timer: 1800, showConfirmButton: false });
                });
            });
        },

        show: (orderId) => {
            const scope = _modal_oil_dispatch_form;
            currentOrderId = orderId;
            scope.clearForm();

            $('#oilDispatchFormOrderId').val(orderId || '');

            if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.getOilDispatchOrder) {
                scope.renderBasketLines([], null);
                var dateInputA = document.getElementById('oilDispatchDateDispatched');
                if (dateInputA) dateInputA.value = formatDateForDisplay(new Date());
                readOnlyMode = false;
                scope.setFormReadOnly(false);
                dsp.setReadOnly(false);
                dsp.loadTransporters();
                scope.openModal();
                return;
            }

            dataFunctions.getOilDispatchOrder(orderId).then(function (data) {
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
                    var dateInputB = document.getElementById('oilDispatchDateDispatched');
                    if (dateInputB) dateInputB.value = formatDateForDisplay(new Date());
                }

                orderWasDispatched = ro;
                return Promise.all([loadExtras(data && data.order ? data.order : null, ro), loadTransportCost(orderId)]).then(function () {
                    scope.setFormReadOnly(ro);
                    dsp.setReadOnly(ro);
                    scope.openModal();
                });
            }).catch(function (e) {
                console.warn('[Oil Dispatch Form] Could not load order', e);
                readOnlyMode = false;
                scope.renderBasketLines([], null);
                var dateInputC = document.getElementById('oilDispatchDateDispatched');
                if (dateInputC) dateInputC.value = formatDateForDisplay(new Date());
                scope.setFormReadOnly(false);
                dsp.setReadOnly(false);
                dsp.loadTransporters();
                scope.openModal();
            });
        },

        renderBasketLines: (lines, order) => {
            var tbody = document.getElementById('oilDispatchFormBasketBody');
            var meta = document.getElementById('oilDispatchFormOrderMeta');
            if (meta) {
                if (order) {
                    var col = formatDateForDisplay(order.planned_collection_date);
                    var del = formatDateForDisplay(order.delivery_date);
                    var parts = [order.buyer_name || '—'];
                    if (col) parts.push('collect ' + col);
                    if (del) parts.push('deliver ' + del);
                    meta.textContent = parts.join(' · ');
                } else {
                    meta.textContent = '';
                }
            }
            if (!tbody) return;
            tbody.innerHTML = '';
            lines = Array.isArray(lines) ? lines : [];
            if (!lines.length) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No lines on this order.</td></tr>';
                return;
            }
            lines.forEach(function (line) {
                var tr = document.createElement('tr');
                var qtyL = line.quantity_litres != null ? Number(line.quantity_litres) : null;
                var qtyKg = line.quantity_kg != null ? Number(line.quantity_kg) : null;
                var qtyDisplay;
                if (qtyL != null && !isNaN(qtyL) && qtyL > 0) {
                    qtyDisplay = qtyL.toFixed(2) + ' L';
                    if (qtyKg != null && !isNaN(qtyKg)) qtyDisplay += ' <span class="text-muted small">(≈ ' + _common.formatKg(qtyKg) + ' kg)</span>';
                } else if (line.cartons != null && line.cartons >= 0) {
                    qtyDisplay = '<strong>' + DispatchFormShared.cartonLabel(line.cartons) + '</strong> · ' + (qtyKg != null ? _common.formatKg(qtyKg) : '—') + ' kg';
                } else {
                    qtyDisplay = qtyKg != null ? _common.formatKg(qtyKg) + ' kg' : '—';
                }
                var productLabel = line.style || line.product_name || '—';
                tr.innerHTML = '<td>' + escapeHtml(line.batch_number || '—') + '</td><td>' + escapeHtml(productLabel) + '</td><td class="text-end">' + qtyDisplay + '</td>';
                tbody.appendChild(tr);
            });
        },

        applyDispatchRecord: (record, order) => {
            record = record || {};
            dsp.setInspection(record);

            $('#oilDispatchPerson').val(record.dispatch_person || '');
            $('#oilDispatchCell').val(record.attention_cell || '');
            dsp.setTransporter(record.transport_company || '', record.transporter_id || null);
            $('#oilDispatchDeliveryNote').val(record.delivery_note_number || '');
            var dateInput = document.getElementById('oilDispatchDateDispatched');
            if (dateInput) {
                if (record.date_dispatched) {
                    dateInput.value = formatDateForDisplayFromISO(record.date_dispatched);
                } else {
                    dateInput.value = formatDateForDisplay(new Date());
                }
            }
            $('#oilDispatchTruckReg').val(record.truck_registration || '');
            $('#oilDispatchDriverName').val(record.driver_name || '');
            var tm = record.time_dispatched;
            if (tm != null && String(tm).trim()) {
                var t = String(tm).trim();
                $('#oilDispatchTime').val(t.length >= 5 && t.indexOf(':') >= 0 ? t.substring(0, 5) : t);
            } else {
                $('#oilDispatchTime').val('');
            }
            // Empty here is filled from the customer contact (or the buyer name) by loadExtras().
            $('#oilDispatchDispatchedTo').val(record.dispatched_to || '');
            dsp.setSignature(record.dispatch_signature || '');
            dsp.setAttachments(record.attachments);
        },

        setFormReadOnly: (ro) => {
            var form = document.getElementById('oilDispatchFormForm');
            if (form) {
                $(form).find('input, textarea, select').each(function () {
                    if (this.id === 'oilDispatchFormOrderId') return;
                    if ($(this).hasClass('js-transport-cost')) return;   // transport cost stays editable after dispatch
                    $(this).prop('disabled', !!ro);
                });
            }
            $('#oilDispatchTransportSaveBtn').toggleClass('d-none', !ro);
            $('#oilDispatchFormSubmitBtn').toggleClass('d-none', !!ro);
            var cancel = document.getElementById('oilDispatchFormCancelBtn');
            if (cancel) cancel.textContent = ro ? 'Close' : 'Cancel';
            var title = document.getElementById('oilDispatchFormModalLabel');
            if (title) title.textContent = ro ? 'Inspection of Vehicle & Dispatch (dispatched)' : 'Inspection of Vehicle & Dispatch';
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
            const scope = _modal_oil_dispatch_form;
            scope.setFormReadOnly(false);
            readOnlyMode = false;
            var meta = document.getElementById('oilDispatchFormOrderMeta');
            if (meta) meta.textContent = '';
            var tbody = document.getElementById('oilDispatchFormBasketBody');
            if (tbody) tbody.innerHTML = '';

            dsp.reset();
            showPrefillHints(false, false, false);
            var ids = ['oilDispatchPerson', 'oilDispatchCell', 'oilDispatchDeliveryNote', 'oilDispatchDateDispatched', 'oilDispatchTruckReg', 'oilDispatchDriverName', 'oilDispatchTime', 'oilDispatchDispatchedTo', 'oilDispatchFormOrderId', 'oilDispatchTransportCost'];
            ids.forEach(function (id) {
                $('#' + id).val('');
            });
            $('#oilDispatchCustomerPays').prop('checked', false);
            syncTransportCostField();
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
            if (readOnlyMode) return;

            var orderId = $('#oilDispatchFormOrderId').val();
            if (!orderId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Order not found', 'error');
                return;
            }

            if (dsp.isUploading()) {
                if (typeof Swal !== 'undefined') Swal.fire('Please wait', 'A file is still uploading. Try again in a moment.', 'info');
                return;
            }
            var problems = dsp.validateInspection(!orderWasDispatched);
            if (problems.length) {
                if (typeof Swal !== 'undefined') Swal.fire('Check the inspection', problems[0] + (problems.length > 1 ? ' (and ' + (problems.length - 1) + ' more)' : ''), 'warning');
                return;
            }
            var tc = readTransportCost();
            if (tc.error) {
                if (typeof Swal !== 'undefined') Swal.fire('Check the transport cost', tc.error, 'warning');
                return;
            }
            var insp = dsp.getInspection();
            var transport = dsp.getTransporter();
            var attachments = dsp.getAttachments();

            var payload = {
                dispatch_order_id: orderId,
                vehicle_clean_yn: insp.answers.vehicle_clean_yn,
                vehicle_enclosed_yn: insp.answers.vehicle_enclosed_yn,
                hazard_substances_yn: insp.answers.hazard_substances_yn,
                pest_infestations_yn: insp.answers.pest_infestations_yn,
                pallets_condition_yn: insp.answers.pallets_condition_yn,
                truck_bin_locked_yn: insp.answers.truck_bin_locked_yn,
                dispatch_person: ($('#oilDispatchPerson').val() || '').trim() || null,
                attention_cell: ($('#oilDispatchCell').val() || '').trim() || null,
                transport_company: transport.name,
                transporter_id: transport.id,
                delivery_note_number: ($('#oilDispatchDeliveryNote').val() || '').trim() || null,
                date_dispatched: scope.getDateISO(),
                truck_registration: ($('#oilDispatchTruckReg').val() || '').trim() || null,
                driver_name: ($('#oilDispatchDriverName').val() || '').trim() || null,
                time_dispatched: ($('#oilDispatchTime').val() || '').trim() || null,
                dispatched_to: ($('#oilDispatchDispatchedTo').val() || '').trim() || null,
                dispatch_signature: dsp.getSignature(),
                inspection_comments: insp.comments,
                inspection_photos: insp.photos,
                attachments: attachments
            };

            if (typeof dataFunctions === 'undefined' || !dataFunctions.saveOilDispatchRecord) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Save not available', 'error');
                return;
            }

            dataFunctions.saveOilDispatchRecord(payload).then(function (result) {
                if (!(result && result.success !== false)) return result;
                // Save the transport cost after the dispatch so a cost problem never blocks dispatching.
                return saveTransportCost(orderId, tc).then(function (trErr) {
                    if (trErr && typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'warning', title: 'Dispatched, but not the transport cost', text: trErr + ' Open the order again to enter it.' });
                        result.__transportWarned = true;
                    }
                    return result;
                });
            }).then(function (result) {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined' && !result.__transportWarned) Swal.fire({ icon: 'success', title: 'Dispatched', text: 'Dispatch record saved. Order marked as dispatched.', timer: 2000, showConfirmButton: false });
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
