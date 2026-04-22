/**
 * Stock (Oil & Protein) — add many on-hand lots at once (same workflow idea as Supplier Intake Adjust stock).
 */
var _modal_stock_oil_bulk_add = (function () {
    'use strict';

    var CONTAINER_ID = 'oilBulkAddStockModal';
    var _inited = false;
    /** Bulk add from this screen is always finished on-hand at 850 (no location field in UI). */
    var DEFAULT_LOCATION_CODE = '850';
    var DEFAULT_STOCK_CATEGORY = 'finished_good';

    function rowTemplate() {
        return (
            '<tr>' +
            '<td><input type="text" class="form-control form-control-sm" name="obaBatch" maxlength="120" placeholder="e.g. BFGO 25.06.01"></td>' +
            '<td><input type="text" class="form-control form-control-sm" name="obaGrade" maxlength="120" placeholder="e.g. Extra Virgin"></td>' +
            '<td><input type="number" class="form-control form-control-sm" name="obaKg" step="0.01" min="0" placeholder="0"></td>' +
            '<td><input type="number" class="form-control form-control-sm" name="obaFfa" step="0.01" min="0" placeholder="Optional"></td>' +
            '<td><input type="date" class="form-control form-control-sm" name="obaBb"></td>' +
            '<td><input type="text" class="form-control form-control-sm" name="obaPd" maxlength="200" placeholder="Optional"></td>' +
            '<td><button type="button" class="btn btn-sm btn-danger obaRemoveRow" title="Remove"><i class="fas fa-times"></i></button></td>' +
            '</tr>'
        );
    }

    function readHeader() {
        var line = (document.getElementById('obaProductLine') && document.getElementById('obaProductLine').value) || 'oil';
        return {
            location: DEFAULT_LOCATION_CODE,
            stock_category: DEFAULT_STOCK_CATEGORY,
            status: 'on_hand',
            product_line: line === 'protein_powder' ? 'protein_powder' : 'oil'
        };
    }

    /**
     * Stock grid treats a lot as protein when grade starts with "Protein powder" (or batch PP-…).
     * If user picked Protein powder but left grade blank or typed a non-protein grade, normalize.
     */
    function gradeForProteinLine(inputGrade) {
        var g = (inputGrade && String(inputGrade).trim()) || '';
        var low = g.toLowerCase();
        if (!low) return 'Protein powder';
        if (low === 'protein powder' || low.indexOf('protein powder') === 0) return g;
        return 'Protein powder (' + g + ')';
    }

    function productDescriptionForProteinLine(inputPd, gradeAfter) {
        var p = (inputPd && String(inputPd).trim()) || '';
        var low = p.toLowerCase();
        if (!low) return gradeAfter || 'Protein powder';
        if (low.indexOf('protein') !== -1) return p;
        return (gradeAfter || 'Protein powder') + (p ? ' — ' + p : '');
    }

    function readRows() {
        var rows = [];
        if (typeof $ === 'undefined') return rows;
        $('#obaLotsTableBody tr').each(function () {
            var $r = $(this);
            var batch = ($r.find('[name="obaBatch"]').val() || '').trim();
            var grade = ($r.find('[name="obaGrade"]').val() || '').trim();
            var kgRaw = ($r.find('[name="obaKg"]').val() || '').trim();
            var ffaRaw = ($r.find('[name="obaFfa"]').val() || '').trim();
            var bb = ($r.find('[name="obaBb"]').val() || '').trim();
            var pd = ($r.find('[name="obaPd"]').val() || '').trim();
            if (!batch) return;
            var kg = kgRaw === '' ? NaN : parseFloat(kgRaw);
            rows.push({
                batch_number: batch,
                grade: grade || null,
                kilograms: kg,
                ffa: ffaRaw === '' ? null : parseFloat(ffaRaw),
                bb_date: bb || null,
                product_description: pd || null
            });
        });
        return rows;
    }

    var api = {
        init: function () {
            if (_inited) return;
            _inited = true;
            var addBtn = document.getElementById('obaAddRowBtn');
            if (addBtn) addBtn.addEventListener('click', function (e) { e.preventDefault(); api.addRow(); });
            var saveBtn = document.getElementById('obaSaveBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });

            if (typeof $ !== 'undefined') {
                $(document).off('click.obaRemoveRow', '.obaRemoveRow').on('click.obaRemoveRow', '.obaRemoveRow', function (e) {
                    e.preventDefault();
                    var $tbody = $('#obaLotsTableBody');
                    if ($tbody.find('tr').length <= 1) return;
                    $(this).closest('tr').remove();
                });
            }
        },

        resetForm: function () {
            var pl = document.getElementById('obaProductLine');
            if (pl) pl.value = 'oil';
            if (typeof $ !== 'undefined') {
                $('#obaLotsTableBody').empty().append(rowTemplate());
            }
        },

        addRow: function () {
            if (typeof $ === 'undefined') return;
            $('#obaLotsTableBody').append(rowTemplate());
        },

        show: function () {
            api.resetForm();
            var tbody = document.getElementById('obaLotsTableBody');
            if (tbody && !tbody.querySelector('tr')) api.addRow();
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#' + CONTAINER_ID).modal('show');
            }
        },

        save: async function () {
            var h = readHeader();

            var bagRows = readRows();
            if (!bagRows.length) {
                if (typeof Swal !== 'undefined') Swal.fire('Required', 'Add at least one row with a batch number.', 'warning');
                return;
            }

            for (var j = 0; j < bagRows.length; j++) {
                var r = bagRows[j];
                if (!r.batch_number) {
                    if (typeof Swal !== 'undefined') Swal.fire('Required', 'Row ' + (j + 1) + ': batch number is required.', 'warning');
                    return;
                }
                if (r.kilograms == null || isNaN(r.kilograms) || r.kilograms <= 0) {
                    if (typeof Swal !== 'undefined') Swal.fire('Required', 'Row ' + (j + 1) + ': enter kilograms greater than 0.', 'warning');
                    return;
                }
                if (r.ffa != null && isNaN(r.ffa)) {
                    if (typeof Swal !== 'undefined') Swal.fire('Validation', 'Row ' + (j + 1) + ': FFA must be a number.', 'warning');
                    return;
                }
            }

            var df = typeof _dataFunctions !== 'undefined' ? _dataFunctions : (typeof dataFunctions !== 'undefined' ? dataFunctions : null);
            if (!df || typeof df.createOilStockLot !== 'function') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Save is not available. Refresh the page.', 'error');
                return;
            }

            var saveBtn = document.getElementById('obaSaveBtn');
            if (saveBtn) saveBtn.disabled = true;
            try {
                var created = 0;
                for (var i = 0; i < bagRows.length; i++) {
                    var br = bagRows[i];
                    var gradeVal = br.grade;
                    var pdVal = br.product_description;
                    if (h.product_line === 'protein_powder') {
                        gradeVal = gradeForProteinLine(gradeVal);
                        pdVal = productDescriptionForProteinLine(pdVal, gradeVal);
                    }
                    var payload = {
                        p_location_code: h.location,
                        p_stock_category: h.stock_category,
                        p_kilograms: br.kilograms,
                        p_status: h.status,
                        p_counterparty_type: null,
                        p_counterparty_name: null,
                        p_po_reference: null,
                        p_batch_number: br.batch_number,
                        p_product_code: null,
                        p_product_description: pdVal,
                        p_grade: gradeVal,
                        p_ffa: br.ffa,
                        p_coa_status: null,
                        p_units: null,
                        p_volume: null,
                        p_delivery_date: null,
                        p_manufacture_date: null,
                        p_bb_date: br.bb_date,
                        p_notes: null
                    };
                    var result = await df.createOilStockLot(payload, null);
                    if (!result || result.success === false) {
                        var msg = (result && (result.error || result.message)) ? (result.error || result.message) : 'Failed to create lot';
                        throw new Error('Row ' + (i + 1) + ' (' + br.batch_number + '): ' + msg);
                    }
                    created++;
                }
                var modalEl = document.getElementById(CONTAINER_ID);
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getInstance(modalEl).hide();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#' + CONTAINER_ID).modal('hide');
                }
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire({ icon: 'success', title: 'Stock added', text: created + ' lot(s) created.', timer: 2200, showConfirmButton: false });
                }
                if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadOilLotsAndSummary) {
                    await _stockManagementGrid.loadOilLotsAndSummary(true);
                }
            } catch (e) {
                console.error('[Oil bulk add stock]', e);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', e.message || 'Save failed', 'error');
                else alert(e.message || 'Save failed');
            } finally {
                if (saveBtn) saveBtn.disabled = false;
            }
        }
    };

    return api;
}());

_modal_stock_oil_bulk_add.init();
