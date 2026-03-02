/**
 * Oil Production: raw ingredients in production, person on duty form, oil bins.
 * Raw ingredients = oil batches with status 'production' (released from Supplier Intake).
 */
var _oilProductionGrid = function () {
    'use strict';

    var FLATPICKR_OPTS = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };

    function toISO(dateStr) {
        if (!dateStr || typeof dateStr !== 'string') return null;
        var s = String(dateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return null;
        var parts = s.split('/');
        return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
    }

    function fromISO(isoStr) {
        if (!isoStr) return '';
        var s = String(isoStr).trim().split('T')[0];
        var parts = s.split('-');
        if (parts.length !== 3) return s;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    function normalizeOilBatches(raw) {
        if (Array.isArray(raw)) return raw;
        if (raw && raw.get_oil_batches && Array.isArray(raw.get_oil_batches)) return raw.get_oil_batches;
        if (raw && raw.data && Array.isArray(raw.data)) return raw.data;
        return [];
    }

    function normalizeShiftList(raw) {
        if (Array.isArray(raw)) return raw;
        if (raw && raw.get_shift_list && Array.isArray(raw.get_shift_list)) return raw.get_shift_list;
        if (raw && raw.data && Array.isArray(raw.data)) return raw.data;
        return [];
    }

    function normalizeOilBinList(raw) {
        if (Array.isArray(raw)) return raw;
        if (raw && raw.get_oil_bin_list && Array.isArray(raw.get_oil_bin_list)) return raw.get_oil_bin_list;
        if (raw && raw.data && Array.isArray(raw.data)) return raw.data;
        return [];
    }

    return {
        rawIngredients: [],
        oilBins: [],
        currentShift: null,

        init: function () {
            var scope = _oilProductionGrid;
            scope.bindEvents();
            var today = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('opDutyDate');
            if (dateEl) {
                dateEl.value = fromISO(today);
                if (typeof flatpickr !== 'undefined' && !dateEl._flatpickr) flatpickr(dateEl, FLATPICKR_OPTS);
            }
            scope.loadAll();
        },

        bindEvents: function () {
            var scope = _oilProductionGrid;
            $('#opRefreshBtn').off('click').on('click', function () { scope.loadAll(true); });
            $('#opSaveDutyBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.savePersonOnDuty();
            });
            $('#opDutyDate').on('change', function () {
                scope.loadShiftForSelectedDate(true);
            });
        },

        loadAll: function (forceRefresh) {
            var scope = _oilProductionGrid;
            scope.loadRawIngredients(forceRefresh);
            scope.loadShiftForSelectedDate(forceRefresh);
            scope.loadOilBins(forceRefresh);
        },

        loadRawIngredients: async function (forceRefresh) {
            var el = document.getElementById('opRawIngredientsList');
            if (!el) return;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilBatches) {
                    el.innerHTML = '<p class="text-muted mb-0">Data not available.</p>';
                    return;
                }
                var raw = await dataFunctions.getOilBatches({ status: 'production', limit: 200 }, null, !!forceRefresh);
                var rows = normalizeOilBatches(raw);
                _oilProductionGrid.rawIngredients = rows || [];

                if (!rows || rows.length === 0) {
                    el.innerHTML = '<p class="text-muted mb-0">No raw ingredients in production. Release batches from Supplier Intake.</p>';
                    return;
                }

                var intake = function (o) { return (o && o.intake_data) || {}; };
                var productLabel = function (o) {
                    var i = intake(o);
                    var pt = i.product_type || (o.name_of_product && String(o.name_of_product));
                    if (!pt) return '—';
                    return String(pt).replace(/_/g, ' ');
                };
                var qty = function (o) {
                    var i = intake(o);
                    return i.quantity_kg != null ? i.quantity_kg : (i.items && i.items[0] && i.items[0].quantity_kg);
                };
                var dateReceived = function (o) {
                    var i = intake(o);
                    var d = i.date_received || o.production_date;
                    return d ? fromISO(String(d).split('T')[0]) : '—';
                };

                var html = '<div class="table-responsive"><table class="table table-sm table-hover mb-0"><thead><tr><th>Batch #</th><th>Product type</th><th>Quantity (kg)</th><th>Date received</th></tr></thead><tbody>';
                rows.forEach(function (o) {
                    html += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + (qty(o) != null ? qty(o) : '—') + '</td><td>' + escapeHtml(dateReceived(o)) + '</td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
            } catch (e) {
                console.error('[Oil Production] loadRawIngredients:', e);
                el.innerHTML = '<p class="text-danger mb-0">Failed to load raw ingredients.</p>';
            }
        },

        loadShiftForSelectedDate: async function (forceRefresh) {
            var dateEl = document.getElementById('opDutyDate');
            var personEl = document.getElementById('opPersonOnDuty');
            var shiftNameEl = document.getElementById('opShiftName');
            if (!dateEl || !personEl || !shiftNameEl) return;

            var dateStr = dateEl.value && dateEl.value.trim();
            var iso = toISO(dateStr);
            if (!iso) {
                personEl.value = '';
                shiftNameEl.value = '';
                return;
            }

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getShiftList) {
                    personEl.value = '';
                    shiftNameEl.value = '';
                    return;
                }
                var raw = await dataFunctions.getShiftList({ date_from: iso, date_to: iso, limit: 1 }, null, !!forceRefresh);
                var list = normalizeShiftList(raw);
                var shift = list && list[0] ? list[0] : null;
                _oilProductionGrid.currentShift = shift;

                if (shift) {
                    personEl.value = shift.shift_supervisor || '';
                    shiftNameEl.value = shift.shift_name || '';
                } else {
                    personEl.value = '';
                    shiftNameEl.value = '';
                }
            } catch (e) {
                console.error('[Oil Production] loadShiftForSelectedDate:', e);
                personEl.value = '';
                shiftNameEl.value = '';
            }
        },

        savePersonOnDuty: async function () {
            var dateEl = document.getElementById('opDutyDate');
            var personEl = document.getElementById('opPersonOnDuty');
            var shiftNameEl = document.getElementById('opShiftName');
            if (!dateEl || !personEl) return;

            var iso = toISO(dateEl.value && dateEl.value.trim());
            if (!iso) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please select a date.', 'warning');
                return;
            }

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.upsertShift) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Save not available.', 'error');
                    return;
                }
                var payload = {
                    shift_id: _oilProductionGrid.currentShift && _oilProductionGrid.currentShift.id ? _oilProductionGrid.currentShift.id : null,
                    shift_date: iso,
                    shift_supervisor: (personEl.value && personEl.value.trim()) || null,
                    shift_name: (shiftNameEl.value && shiftNameEl.value.trim()) || null
                };
                var result = await dataFunctions.upsertShift(payload);
                var ok = result && (result.success !== false && !result.error);
                if (ok) {
                    _oilProductionGrid.currentShift = result && result.id ? { id: result.id } : _oilProductionGrid.currentShift;
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Person on duty saved.', timer: 2000, showConfirmButton: false });
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && (result.error || result.message)) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] savePersonOnDuty:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
            }
        },

        loadOilBins: async function (forceRefresh) {
            var el = document.getElementById('opOilBinsList');
            if (!el) return;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilBinList) {
                    el.innerHTML = '<p class="text-muted mb-0">Data not available.</p>';
                    return;
                }
                var raw = await dataFunctions.getOilBinList({ limit: 50 }, null, !!forceRefresh);
                var rows = normalizeOilBinList(raw);
                _oilProductionGrid.oilBins = rows || [];

                if (!rows || rows.length === 0) {
                    el.innerHTML = '<p class="text-muted mb-0">No oil bins defined.</p>';
                    return;
                }

                var html = '<div class="table-responsive"><table class="table table-sm table-hover mb-0"><thead><tr><th>Bin name</th><th>Start oil BN</th><th>Capacity (L)</th><th>Current level (L)</th></tr></thead><tbody>';
                rows.forEach(function (b) {
                    var bd = (b.bin_data && typeof b.bin_data === 'object') ? b.bin_data : {};
                    var cap = bd.capacity_litres != null ? bd.capacity_litres : '—';
                    var level = bd.current_level_litres != null ? bd.current_level_litres : '—';
                    html += '<tr><td>' + escapeHtml(b.bin_name || '—') + '</td><td>' + escapeHtml(b.start_oil_bn || '—') + '</td><td>' + cap + '</td><td>' + level + '</td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
            } catch (e) {
                console.error('[Oil Production] loadOilBins:', e);
                el.innerHTML = '<p class="text-danger mb-0">Failed to load oil bins.</p>';
            }
        }
    };

    function escapeHtml(text) {
        if (text == null || text === '') return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}();

window.initializeOilProductionGrid = function () {
    if (typeof _oilProductionGrid !== 'undefined' && _oilProductionGrid.init) {
        _oilProductionGrid.init();
    }
};
