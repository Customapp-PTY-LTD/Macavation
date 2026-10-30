/**
 * Supplier Intake — quick adjust stock: multiple bags without receiving checklist.
 * Required: supplier name, batch # and manufactured date per row.
 * Best before is auto-calculated as manufactured date + 18 months.
 */
var _modal_supplier_intake_adjust_stock = (function () {
    'use strict';

    var CONTAINER_ID = 'supplierIntakeAdjustStockModal';
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var _inited = false;

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

    /**
     * Shift an ISO date by months with day clamping (e.g. 31st -> last day of target month).
     */
    function shiftIsoDateByMonths(isoDate, monthDelta) {
        if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) return null;
        var parts = String(isoDate).split('-');
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        var d = parseInt(parts[2], 10);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return null;

        var monthIndex = (m - 1) + monthDelta;
        var targetYear = y + Math.floor(monthIndex / 12);
        var targetMonth = ((monthIndex % 12) + 12) % 12;
        var lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
        var targetDay = Math.min(d, lastDay);
        var out = new Date(Date.UTC(targetYear, targetMonth, targetDay));
        return out.toISOString().split('T')[0];
    }

    function calculateBestBeforeIso(manufacturedIso) {
        return shiftIsoDateByMonths(manufacturedIso, 18);
    }

    function escapeAttr(v) {
        if (v == null) return '';
        return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function nextSequentialBatch(baseBatch, step) {
        var raw = (baseBatch || '').trim();
        if (!raw) return '';
        var m = raw.match(/^(.*?)(\d+)$/);
        if (m) {
            var prefix = m[1];
            var n = parseInt(m[2], 10);
            if (!isNaN(n)) {
                var next = String(n + step);
                var width = m[2].length;
                if (next.length < width) next = next.padStart(width, '0');
                return prefix + next;
            }
        }
        return raw + '.' + String(step + 1);
    }

    /** New rows copy the LAST row's description, batch and date (never weight or FFA), so adding twice keeps numbering batches on. */
    function readLastRowSeed() {
        if (typeof $ === 'undefined') return null;
        var $row = $('#siaBagsTableBody tr:last');
        if (!$row.length) return null;
        return {
            batch: ($row.find('[name="siaBatch"]').val() || '').trim(),
            productType: ($row.find('[name="siaProductType"]').val() || '').trim() || 'oil_kernel:crude',
            manufacturedDate: ($row.find('[name="siaManufacturedDate"]').val() || '').trim()
        };
    }

    /** Typed "Add [n] bag(s)" count; anything odd falls back to 1, capped at 500. */
    function readAddCount() {
        var el = document.getElementById('siaAddBagCount');
        var n = parseInt(el && el.value, 10);
        if (isNaN(n) || n <= 0) n = 1;
        if (n > 500) n = 500;
        if (el) el.value = '1';
        return n;
    }

    function fmtKg(v) {
        if (typeof _common !== 'undefined' && _common.formatKg) return _common.formatKg(v);
        return Number(v || 0).toFixed(2);
    }

    /** No. column and the weighed total / bag count footer, same as the NIS delivery. */
    function refreshBagTotals() {
        if (typeof $ === 'undefined') return;
        var total = 0;
        var count = 0;
        $('#siaBagsTableBody tr').each(function (i) {
            $(this).find('.siaBagNo').text(String(i + 1));
            var kg = parseFloat($(this).find('[name="siaWeight"]').val());
            if (!isNaN(kg) && kg > 0) { total += kg; count += 1; }
        });
        $('#siaBagCount').text(String(count));
        $('#siaBagTotal').text(fmtKg(total) || '0.00');
    }

    function initFlatpickrInModal() {
        var container = document.getElementById(CONTAINER_ID);
        if (!container || typeof flatpickr === 'undefined') return;
        container.querySelectorAll('.flatpickr-date').forEach(function (el) {
            if (el && !el._flatpickr) flatpickr(el, FLATPICKR_DDMMYYYY);
        });
    }

    function ensureAtLeastOneRow() {
        var tbody = document.getElementById('siaBagsTableBody');
        if (!tbody || tbody.querySelector('tr')) return;
        api.addRow();
    }

    function rowTemplate(seed) {
        seed = seed || {};
        return (
            '<tr>' +
            '<td><strong class="siaBagNo"></strong></td>' +
            '<td><select class="form-select form-select-sm" name="siaProductType" aria-label="Description">' +
            '<option value="oil_kernel:crude"' + ((seed.productType || 'oil_kernel:crude') === 'oil_kernel:crude' ? ' selected' : '') + '>Oil kernel (crude grade)</option>' +
            '<option value="oil_kernel:food_grade"' + ((seed.productType || '') === 'oil_kernel:food_grade' ? ' selected' : '') + '>Oil kernel (food grade)</option>' +
            '<option value="cracker_dust"' + ((seed.productType || '') === 'cracker_dust' ? ' selected' : '') + '>Cracker dust</option>' +
            '<option value="kernel_dust"' + ((seed.productType || '') === 'kernel_dust' ? ' selected' : '') + '>Kernel dust</option>' +
            '<option value="crush"' + ((seed.productType || '') === 'crush' ? ' selected' : '') + '>Crush</option>' +
            '<option value="cake"' + ((seed.productType || '') === 'cake' ? ' selected' : '') + '>Cake</option>' +
            '</select></td>' +
            '<td><input type="text" class="form-control form-control-sm" name="siaBatch" maxlength="120" placeholder="e.g. OIL-2026-03-001" value="' + escapeAttr(seed.batch || '') + '"></td>' +
            '<td><input type="number" class="form-control form-control-sm" name="siaWeight" step="0.01" min="0" aria-label="Weight kg" style="text-align:right" value="' + escapeAttr(seed.weight || '') + '"></td>' +
            '<td><input type="number" class="form-control form-control-sm" name="siaFfa" step="0.01" min="0" placeholder="Optional" aria-label="FFA percent" style="text-align:right" value="' + escapeAttr(seed.ffa || '') + '"></td>' +
            '<td><input type="text" class="form-control form-control-sm flatpickr-date" name="siaManufacturedDate" placeholder="dd/mm/yyyy" required value="' + escapeAttr(seed.manufacturedDate || '') + '"></td>' +
            '<td><button type="button" class="btn btn-sm btn-outline-secondary siaRemoveRow" title="Remove" aria-label="Remove bag">\u2715</button></td>' +
            '</tr>'
        );
    }

    var api = {
        init: function () {
            if (_inited) return;
            _inited = true;
            var addBtn = document.getElementById('siaAddRowBtn');
            if (addBtn) addBtn.addEventListener('click', function (e) {
                e.preventDefault();
                api.addRows(readAddCount());
            });
            var addCountEl = document.getElementById('siaAddBagCount');
            if (addCountEl) addCountEl.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                api.addRows(readAddCount());
            });
            var saveBtn = document.getElementById('siaSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });

            if (typeof $ !== 'undefined') {
                $(document).off('click.siaRemoveRow', '.siaRemoveRow').on('click.siaRemoveRow', '.siaRemoveRow', function (e) {
                    e.preventDefault();
                    var $tbody = $('#siaBagsTableBody');
                    if ($tbody.find('tr').length <= 1) return;
                    $(this).closest('tr').remove();
                    refreshBagTotals();
                });
                $(document).off('input.siaBagWeight', '#siaBagsTableBody [name="siaWeight"]').on('input.siaBagWeight', '#siaBagsTableBody [name="siaWeight"]', function () {
                    refreshBagTotals();
                });
                $('#' + CONTAINER_ID).on('shown.bs.modal', function () { initFlatpickrInModal(); });
                $('#' + CONTAINER_ID).on('hidden.bs.modal', function () { api.resetForm(); });
            }
        },

        resetForm: function () {
            var nameEl = document.getElementById('siaSupplierName');
            var noteEl = document.getElementById('siaDeliveryNote');
            if (nameEl) nameEl.value = '';
            if (noteEl) noteEl.value = '';
            if (typeof $ !== 'undefined') {
                $('#siaBagsTableBody').empty().append(rowTemplate());
            }
            refreshBagTotals();
            var todayISO = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('siaDateReceived');
            if (dateEl) dateEl.value = fromISO(todayISO);
            initFlatpickrInModal();
        },

        addRow: function (seed) {
            if (typeof $ === 'undefined') return;
            var $row = $(rowTemplate(seed));
            $('#siaBagsTableBody').append($row);
            $row.find('.flatpickr-date').each(function () {
                if (typeof flatpickr !== 'undefined' && !this._flatpickr) flatpickr(this, FLATPICKR_DDMMYYYY);
            });
            refreshBagTotals();
            return $row;
        },

        addRows: function (count) {
            if (typeof $ === 'undefined' || !count || count <= 0) return;
            var seed = readLastRowSeed() || {};
            var $first = null;
            for (var i = 1; i <= count; i++) {
                var $row = api.addRow({
                    batch: nextSequentialBatch(seed.batch || '', i),
                    productType: seed.productType || 'oil_kernel:crude',
                    manufacturedDate: seed.manufacturedDate || ''
                });
                if (!$first) $first = $row;
            }
            if ($first) $first.find('[name="siaWeight"]').trigger('focus');
        },

        show: function () {
            api.resetForm();
            ensureAtLeastOneRow();
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#' + CONTAINER_ID).modal('show');
            }
            setTimeout(initFlatpickrInModal, 50);
        },

        readRows: function () {
            var rows = [];
            if (typeof $ === 'undefined') return rows;
            $('#siaBagsTableBody tr').each(function (i) {
                var $r = $(this);
                var batch = ($r.find('[name="siaBatch"]').val() || '').trim();
                var productParts = (($r.find('[name="siaProductType"]').val() || '').trim() || 'oil_kernel:crude').split(':');
                var productType = productParts[0];
                var grade = productParts[1] || null;
                var wRaw = ($r.find('[name="siaWeight"]').val() || '').trim();
                var ffaRaw = ($r.find('[name="siaFfa"]').val() || '').trim();
                var mfgRaw = ($r.find('[name="siaManufacturedDate"]').val() || '').trim();
                // A row with no weight is not a bag (spare rows from "+ Add"), same as New delivery.
                var qty = wRaw === '' ? NaN : parseFloat(wRaw);
                if (isNaN(qty) || qty <= 0) return;
                var ffa = ffaRaw === '' ? null : parseFloat(ffaRaw);
                if (ffa != null && isNaN(ffa)) ffa = null;
                var manufacturedIso = mfgRaw ? (toISO(mfgRaw) || mfgRaw) : null;
                var bestBeforeIso = manufacturedIso ? calculateBestBeforeIso(manufacturedIso) : null;
                rows.push({
                    no: i + 1,
                    batch_number: batch || null,
                    product_type: productType,
                    grade: grade,
                    quantity_kg: qty,
                    ffa: ffa,
                    manufactured_date: manufacturedIso,
                    best_before_date: bestBeforeIso
                });
            });
            return rows;
        },

        save: async function () {
            var supplierName = (document.getElementById('siaSupplierName') && document.getElementById('siaSupplierName').value || '').trim();
            if (!supplierName) {
                if (typeof Swal !== 'undefined') Swal.fire('Required', 'Enter the supplier name.', 'warning');
                else alert('Enter the supplier name.');
                return;
            }
            var dateRaw = (document.getElementById('siaDateReceived') && document.getElementById('siaDateReceived').value) || '';
            var dateReceived = dateRaw ? (toISO(dateRaw) || dateRaw) : new Date().toISOString().split('T')[0];
            var deliveryNote = (document.getElementById('siaDeliveryNote') && document.getElementById('siaDeliveryNote').value || '').trim() || null;

            var bagRows = api.readRows();
            if (!bagRows.length) {
                if (typeof Swal !== 'undefined') Swal.fire('Required', 'Enter the weight of at least one bag.', 'warning');
                return;
            }
            var missingBatch = bagRows.find(function (r) { return !r.batch_number; });
            if (missingBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Required', 'Bag ' + missingBatch.no + ': enter a batch number.', 'warning');
                return;
            }
            var missingManufactured = bagRows.find(function (r) { return !r.manufactured_date; });
            if (missingManufactured) {
                if (typeof Swal !== 'undefined') Swal.fire('Required', 'Bag ' + missingManufactured.no + ': enter a manufactured date. Best before is worked out automatically (+18 months).', 'warning');
                return;
            }

            var df = typeof _dataFunctions !== 'undefined' ? _dataFunctions : (typeof dataFunctions !== 'undefined' ? dataFunctions : null);
            if (!df || typeof df.createSupplierIntakeBatch !== 'function') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Save is not available. Refresh the page.', 'error');
                return;
            }

            var deliveryGroupId = typeof crypto !== 'undefined' && crypto.randomUUID
                ? crypto.randomUUID()
                : (function () {
                    var d = new Date().getTime();
                    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
                        var r = (d + Math.random() * 16) % 16 | 0;
                        d = Math.floor(d / 16);
                        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
                    });
                })();

            var saveBtn = document.getElementById('siaSaveBtn');
            if (saveBtn) saveBtn.disabled = true;
            try {
                var created = 0;
                for (var i = 0; i < bagRows.length; i++) {
                    var br = bagRows[i];
                    var ffaNum = br.ffa != null && String(br.ffa).trim() !== '' ? parseFloat(br.ffa) : NaN;
                    var hasFfa = !isNaN(ffaNum);
                    var payload = {
                        status: hasFfa ? 'release_ready' : 'awaiting_test',
                        delivery_group_id: deliveryGroupId,
                        batch_number: br.batch_number,
                        date_received: dateReceived,
                        delivery_note_ref: deliveryNote,
                        supplier_id: null,
                        supplier_details: supplierName,
                        product_type: br.product_type,
                        grade: br.grade,
                        quantity_kg: br.quantity_kg,
                        manufactured_date: br.manufactured_date,
                        best_before_date: br.best_before_date,
                        reference: null,
                        description: null,
                        receiving_comments: 'Adjust stock (no receiving checklist)',
                        vehicle_clean: null,
                        vehicle_enclosed: null,
                        hazard_substances: null,
                        pest_infestations: null,
                        pallets_condition: null,
                        raw_materials_condition: null,
                        adjust_stock_ffa: hasFfa ? ffaNum : null,
                        from_adjust_stock: true
                    };
                    var res = await df.createSupplierIntakeBatch(payload, null);
                    if (res && res.success === false) {
                        throw new Error(res.error || res.message || 'Failed to create batch');
                    }
                    created++;
                }
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'success', title: 'Saved', text: created + ' batch(es) added.', timer: 2500, showConfirmButton: false });
                }
                var modalEl = document.getElementById(CONTAINER_ID);
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#' + CONTAINER_ID).modal('hide');
                }
                if (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.loadBatches) {
                    await _supplierIntakeGrid.loadBatches(true);
                }
            } catch (e) {
                console.error('[Adjust stock] save failed', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', (e && e.message) ? e.message : 'Save failed.', 'error');
            } finally {
                if (saveBtn) saveBtn.disabled = false;
            }
        }
    };

    return api;
})();

function initializeSupplierIntakeAdjustStockModal() {
    if (typeof _modal_supplier_intake_adjust_stock !== 'undefined' && _modal_supplier_intake_adjust_stock.init) {
        _modal_supplier_intake_adjust_stock.init();
    }
}
