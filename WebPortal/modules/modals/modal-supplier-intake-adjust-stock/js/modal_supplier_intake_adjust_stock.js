/**
 * Supplier Intake — quick adjust stock: multiple bags without receiving checklist.
 * Required: supplier name, batch # per row. Optional: weight, FFA, best before, delivery note.
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

    function rowTemplate() {
        return (
            '<tr>' +
            '<td><input type="text" class="form-control form-control-sm" name="siaBatch" maxlength="120" placeholder="e.g. OIL-2026-03-001"></td>' +
            '<td><select class="form-select form-select-sm" name="siaProductType">' +
            '<option value="oil_kernel" selected>Oil kernel</option>' +
            '<option value="cracker_dust">Cracker dust</option>' +
            '<option value="kernel_dust">Kernel dust</option>' +
            '<option value="crush">Crush</option>' +
            '<option value="cake">Cake</option>' +
            '</select></td>' +
            '<td><input type="number" class="form-control form-control-sm" name="siaWeight" step="0.01" min="0" placeholder="Optional"></td>' +
            '<td><input type="number" class="form-control form-control-sm" name="siaFfa" step="0.01" min="0" placeholder="Optional"></td>' +
            '<td><input type="text" class="form-control form-control-sm flatpickr-date" name="siaBestBefore" placeholder="dd/mm/yyyy"></td>' +
            '<td><button type="button" class="btn btn-sm btn-danger siaRemoveRow" title="Remove"><i class="fas fa-times"></i></button></td>' +
            '</tr>'
        );
    }

    var api = {
        init: function () {
            if (_inited) return;
            _inited = true;
            var addBtn = document.getElementById('siaAddRowBtn');
            if (addBtn) addBtn.addEventListener('click', function (e) { e.preventDefault(); api.addRow(); });
            var saveBtn = document.getElementById('siaSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });

            if (typeof $ !== 'undefined') {
                $(document).off('click.siaRemoveRow', '.siaRemoveRow').on('click.siaRemoveRow', '.siaRemoveRow', function (e) {
                    e.preventDefault();
                    var $tbody = $('#siaBagsTableBody');
                    if ($tbody.find('tr').length <= 1) return;
                    $(this).closest('tr').remove();
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
            var todayISO = new Date().toISOString().split('T')[0];
            var dateEl = document.getElementById('siaDateReceived');
            if (dateEl) dateEl.value = fromISO(todayISO);
            initFlatpickrInModal();
        },

        addRow: function () {
            if (typeof $ === 'undefined') return;
            var $row = $(rowTemplate());
            $('#siaBagsTableBody').append($row);
            $row.find('.flatpickr-date').each(function () {
                if (typeof flatpickr !== 'undefined' && !this._flatpickr) flatpickr(this, FLATPICKR_DDMMYYYY);
            });
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
            $('#siaBagsTableBody tr').each(function () {
                var $r = $(this);
                var batch = ($r.find('[name="siaBatch"]').val() || '').trim();
                var productType = ($r.find('[name="siaProductType"]').val() || '').trim() || 'oil_kernel';
                var wRaw = ($r.find('[name="siaWeight"]').val() || '').trim();
                var ffaRaw = ($r.find('[name="siaFfa"]').val() || '').trim();
                var bbRaw = ($r.find('[name="siaBestBefore"]').val() || '').trim();
                if (!batch) return;
                var qty = wRaw === '' ? null : parseFloat(wRaw);
                if (qty != null && isNaN(qty)) qty = null;
                var ffa = ffaRaw === '' ? null : parseFloat(ffaRaw);
                if (ffa != null && isNaN(ffa)) ffa = null;
                rows.push({
                    batch_number: batch,
                    product_type: productType,
                    quantity_kg: qty,
                    ffa: ffa,
                    best_before_date: bbRaw ? (toISO(bbRaw) || bbRaw) : null
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
                if (typeof Swal !== 'undefined') Swal.fire('Required', 'Add at least one row with a batch number.', 'warning');
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
                        quantity_kg: br.quantity_kg,
                        manufactured_date: null,
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
