/**
 * Oil Production: raw ingredients in production, person on duty form, oil bin batches.
 * Raw ingredients = oil batches with status 'production' (released from Supplier Intake).
 * Finished (emptied) = status 'raw_empty' after user marks bag empty in production.
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

    var GMP_CHECK_SHEET_ROWS = [
        { num: 1, action: 'Check that cleaning has been done correctly', detail: 'Check according to cleaning schedule. Pass = ✓ Fail = x', type: 'pass_fail_4', labels: ['Food grade division', 'Boot room', 'Oil press room', 'Non-food grade division'] },
        { num: 2, action: 'Check the daily processing temperatures', detail: 'Check temperatures of processing room. Pass = ✓ Fail = x', type: 'temperatures', items: [{ name: 'First oil press screw', spec: '80-95' }, { name: 'Second oil press screw', spec: '110-125' }, { name: 'Food grade line', spec: '115-135' }, { name: 'KEK', spec: '60-75' }] },
        { num: 3, action: 'Check product in progress', detail: 'No product on floor, no containers left open.', type: 'pass_fail' },
        { num: 4, action: 'Verify accuracy of final product scale', detail: 'Tolerance: 0.100kg', type: 'scale_3' },
        { num: 5, action: 'Consumable utensil daily check', detail: 'Check for broken utensils or metal/plastic chips.', type: 'broken_3', labels: ['Stanley Knives', 'Cleaning Equipment', 'Scoops'] },
        { num: 6, action: 'Check belts and machinery', detail: 'Complete maintenance job card if not in good repair.', type: 'pass_fail' },
        { num: 7, action: 'Check production sheets', detail: 'Daily production sheets completed correctly.', type: 'pass_fail' },
        { num: 8, action: 'Check glass and hard plastics', detail: 'Check for cracks and chips — refer to register.', type: 'pass_fail' },
        { num: 9, action: 'Hand washing', detail: 'According to Hand Hygiene Policy.', type: 'pass_fail' },
        { num: 10, action: 'Pallets', detail: 'Clean, not broken; stacked neatly.', type: 'pass_fail' },
        { num: 11, action: 'Rare earth magnet checks', detail: 'Magnets cleaned, all metal removed.', type: 'magnet_4', times: ['07h00', '12h00', '14h00', '17h30'] },
        { num: 12, action: 'Identification of product in the factory', detail: 'All product identifiable (name, dates, batch number, supplier).', type: 'comment' },
        { num: 13, action: 'Protective clothing', detail: 'Staff wearing correct PPE, hair nets (new daily), boots, beard/wrist guards.', type: 'pass_fail' },
        { num: 14, action: 'Cleaning of protective clothing', detail: 'Non-disposable washed at least twice a week.', type: 'pass_fail' },
        { num: 15, action: 'Factory protocol', detail: 'No cell-phones, watches, jewellery, unapproved items, nail varnish.', type: 'pass_fail' },
        { num: 16, action: 'Personal hygiene check', detail: 'Nails clean and clipped; illnesses reported.', type: 'pass_fail' },
        { num: 17, action: 'Footbath sanitiser check', detail: 'Fill at 7am, replace after lunch 12.30pm. Pass = ✓ Fail = x', type: 'magnet_4', times: ['07h00', '12h30'] },
        { num: 18, action: 'Open cuts on hands', detail: 'Check staff hands for any open cuts.', type: 'pass_fail' },
        { num: 19, action: 'Check filters for build-up', detail: 'Cleared and cleaned according to cleaning schedule.', type: 'pass_fail' }
    ];

    function normalizeOilBinBatches(raw) {
        if (Array.isArray(raw)) return raw;
        if (raw && raw.get_oil_bin_batches && Array.isArray(raw.get_oil_bin_batches)) return raw.get_oil_bin_batches;
        if (raw && raw.data && Array.isArray(raw.data)) return raw.data;
        return [];
    }

    /** Lambda / drivers may return camelCase or nested JSON strings for audit fields */
    function normalizeOilBinBatchRow(b) {
        if (!b || typeof b !== 'object') return b;
        var audit = b.raw_ingredient_audit != null ? b.raw_ingredient_audit : b.rawIngredientAudit;
        if (typeof audit === 'string') {
            try {
                audit = JSON.parse(audit);
            } catch (e) {
                audit = [];
            }
        }
        return {
            id: b.id,
            batch_number: b.batch_number != null ? b.batch_number : b.batchNumber,
            shifts: b.shifts,
            ingredients: b.ingredients,
            start_date: b.start_date != null ? b.start_date : b.startDate,
            letrerage: b.letrerage,
            ffa: b.ffa,
            status: b.status,
            oil_id: b.oil_id != null ? b.oil_id : b.oilId,
            created_at: b.created_at != null ? b.created_at : b.createdAt,
            shift_id: b.shift_id != null ? b.shift_id : b.shiftId,
            raw_ingredient_audit: audit,
            duty_shift_date: b.duty_shift_date != null ? b.duty_shift_date : b.dutyShiftDate,
            duty_shift_supervisor: b.duty_shift_supervisor != null ? b.duty_shift_supervisor : b.dutyShiftSupervisor,
            duty_shift_name: b.duty_shift_name != null ? b.duty_shift_name : b.dutyShiftName
        };
    }

    function resolveUpsertShiftResult(result) {
        var r = result && (result.data !== undefined ? result.data : result);
        if (Array.isArray(r) && r.length) r = r[0];
        if (r && typeof r === 'string') {
            try {
                r = JSON.parse(r);
            } catch (e) {
                r = result;
            }
        }
        return r && typeof r === 'object' ? r : {};
    }

    return {
        rawIngredients: [],
        rawIngredientsFinished: [],
        oilBinBatches: [],
        /** Full list (all statuses) for View data modal; main grid uses only in_production */
        oilBinBatchesReport: null,
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
            $('#opViewDataBtn').off('click').on('click', function () { scope.showViewDataModal(); });
            $('#opSaveDutyOnlyLink').off('click').on('click', function (e) {
                e.preventDefault();
                scope.savePersonOnDuty();
            });
            $('#opDutyDate').on('change', function () {
                scope.loadShiftForSelectedDate(true);
            });
            $('#opGmpCheckSheetBtn').off('click').on('click', function () { scope.showGmpCheckSheetModal(); });
            $('input[name="opGmpSubmitMode"]').on('change', function () {
                var upload = $('#opGmpModeUpload').is(':checked');
                $('#opGmpFormSection').toggle(!upload);
                $('#opGmpUploadSection').toggle(upload);
                $('#opGmpUploadOnlyFields').toggle(upload);
            });
            $('#opGmpSubmitBtn').off('click').on('click', function () { scope.submitGmpCheckSheet(); });
            $(document).on('click', '.op-production-sheet-btn', function () {
                var type = $(this).data('sheet-type');
                if (type) scope.showProductionSheetModal(type);
            });
            $('input[name="opProdSheetMode"]').on('change', function () {
                var upload = $('#opProdSheetModeUpload').is(':checked');
                $('#opProdSheetFormSection').toggle(!upload);
                $('#opProdSheetUploadSection').toggle(upload);
            });
            $('#opProdSheetSubmitBtn').off('click').on('click', function () { scope.submitProductionSheet(); });
            $('#opStartOilBinBtn').off('click').on('click', function () { scope.startOilBin(); });
            $(document).on('click', '.op-send-oil-bin-to-stock', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-bin-batch-id');
                if (id) scope.sendOilBinBatchToStock(id);
            });
            $(document).on('click', '.op-edit-oil-bin-batch', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-bin-batch-id');
                if (id) scope.showEditOilBinBatchModal(id);
            });
            $(document).on('click', '.op-oil-bin-audit-btn', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-bin-batch-id');
                if (id) scope.showOilBinBatchAuditModal(id);
            });
            $('#opEditOilBinBatchSaveBtn').off('click').on('click', function () { scope.saveEditOilBinBatch(); });
            $(document).on('click', '.op-production-data-btn', function (e) {
                e.preventDefault();
                var oilId = $(this).data('oil-id');
                if (oilId) scope.showProductionDataModal(oilId);
            });
            $('#opPdAddRawMaterialRow').off('click').on('click', function () { scope.addProductionDataRawMaterialRow(); });
            $('#opPdAddOilBinDetailRow').off('click').on('click', function () { scope.addProductionDataOilBinDetailRow(); });
            $('#opProductionDataSaveBtn').off('click').on('click', function () { scope.saveProductionData(); });
            $('#opToggleFinishedRawBtn').off('click').on('click', function () {
                var wrap = document.getElementById('opFinishedRawIngredientsWrap');
                var btn = this;
                if (!wrap) return;
                var show = wrap.classList.contains('d-none');
                wrap.classList.toggle('d-none', !show);
                btn.setAttribute('aria-expanded', show ? 'true' : 'false');
                var ch = btn.querySelector('.op-finished-raw-chevron');
                if (ch) {
                    ch.classList.remove('fa-chevron-down', 'fa-chevron-up');
                    ch.classList.add(show ? 'fa-chevron-up' : 'fa-chevron-down');
                }
            });
            $(document).on('click', '.op-raw-empty-btn', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-id');
                if (id) scope.confirmMarkRawIngredientEmpty(id);
            });
        },

        showProductionSheetModal: function (sheetType) {
            var scope = _oilProductionGrid;
            var titles = { food_grade_oil: 'Macadamia Food Grade Production sheet (MP5.2.3.1 Rev 04)', protein_powder: 'Macadamia Food Grade Production sheet for Protein Powder (MP5.2.3.5 Rev 01)', cosmetic_oil: 'Macadamia Cosmetic Oil Production Sheet (MP5.2.3 Rev 06)' };
            var el = document.getElementById('opProductionSheetModalLabel');
            if (el) el.textContent = titles[sheetType] || 'Production sheet';
            var typeEl = document.getElementById('opProductionSheetType');
            if (typeEl) typeEl.value = sheetType;
            scope.buildProductionSheetForm(sheetType);
            $('#opProdSheetModeForm').prop('checked', true);
            $('#opProdSheetFormSection').show();
            $('#opProdSheetUploadSection').hide();
            $('#opProdSheetFileInput').val('');
            $('#opProdSheetUploadStatus').text('');
            var personEl = document.getElementById('opPersonOnDuty');
            var firstDate = document.querySelector('#opProdSheetFormBody [name="op_ps_date"]');
            if (firstDate) firstDate.value = fromISO(new Date().toISOString().split('T')[0]);
            var firstSupervisor = document.querySelector('#opProdSheetFormBody [name="op_ps_shift_supervisor"]');
            if (firstSupervisor && personEl && personEl.value) firstSupervisor.value = personEl.value;
            var modalEl = document.getElementById('opProductionSheetModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            setTimeout(function () {
                document.querySelectorAll('#opProdSheetFormBody .flatpickr-date').forEach(function (el) {
                    if (el && typeof flatpickr !== 'undefined' && !el._flatpickr) flatpickr(el, FLATPICKR_OPTS);
                });
            }, 100);
        },

        buildProductionSheetForm: function (sheetType) {
            var body = document.getElementById('opProdSheetFormBody');
            if (!body) return;
            var html = '';
            function fieldRow(label, name, type, labelClass, inputClass) {
                type = type || 'text';
                labelClass = labelClass || '';
                inputClass = inputClass || '';
                var cls = type === 'number' ? 'form-control op-ps-num' : 'form-control';
                if (inputClass) cls = cls + ' ' + inputClass;
                var inp = '<input type="' + (type === 'number' ? 'number' : 'text') + '" class="' + cls + '" name="' + name + '" step="' + (type === 'number' ? '0.01' : '') + '">';
                return '<div class="op-ps-field-row"><span class="op-ps-label ' + labelClass + '">' + escapeHtml(label) + '</span>' + inp + '</div>';
            }
            function section(title, content) {
                return '<div class="op-ps-section"><div class="op-ps-section-title">' + escapeHtml(title) + '</div>' + content + '</div>';
            }
            if (sheetType === 'food_grade_oil') {
                html += '<div class="op-ps-paper">';
                html += '<div class="op-ps-doc-title">Macadamia Food Grade Production sheet</div>';
                html +=                 section('Shift and supervisory details',
                    fieldRow('Date', 'op_ps_date', 'text', '', 'flatpickr-date') + fieldRow('Shift', 'op_ps_shift') + fieldRow('Shift supervisor', 'op_ps_shift_supervisor') + fieldRow('Signature', 'op_ps_signature'));
                html += section('Product and batch information',
                    fieldRow('Batch Number of Product Produced', 'op_ps_batch_product', 'text', 'wide') +
                    fieldRow('Name of product produced', 'op_ps_name_product', 'text', 'wide') +
                    fieldRow('Start Oil BN (Litre)', 'op_ps_start_oil_bn', 'number') +
                    fieldRow('IBC 1 BN (Litre)', 'op_ps_ibc1', 'number') +
                    fieldRow('IBC 2 BN (Litre)', 'op_ps_ibc2', 'number') +
                    fieldRow('IBC 3 BN (Litre)', 'op_ps_ibc3', 'number'));
                html += section('Main production data',
                    '<div class="op-ps-table-wrap"><table class="table table-sm op-ps-table"><thead><tr><th>Batch number of Raw material used</th><th>Weight of Raw material in (kg)</th><th>Weight of Oil out (kg)</th><th>Weight of Cake out (kg)</th></tr></thead><tbody id="opProdSheetTableFoodGrade"></tbody></table></div><button type="button" class="btn btn-sm btn-outline-secondary op-ps-add-row" data-sheet="food_grade_oil">Add row</button>');
                html += section('Comments', '<textarea class="form-control" name="op_ps_comments" rows="2" placeholder="Comments"></textarea>');
                html += section('Waste at end of shift', fieldRow('General waste (kg)', 'op_ps_waste_general', 'number') + fieldRow('Floor waste (kg)', 'op_ps_waste_floor', 'number') + fieldRow('Product waste (kg)', 'op_ps_waste_product', 'number'));
                html += '<div class="op-ps-doc-ref">MP5.2.3.1 Rev 04 &nbsp; Date issued: 09.12.2025</div>';
                html += '</div>';
            } else if (sheetType === 'protein_powder') {
                html += '<div class="op-ps-paper">';
                html += '<div class="op-ps-doc-title">Macadamia Food Grade Production sheet for Protein Powder</div>';
                html +=                 section('Shift and supervisory details',
                    fieldRow('Date', 'op_ps_date', 'text', '', 'flatpickr-date') + fieldRow('Shift', 'op_ps_shift') + fieldRow('Press', 'op_ps_press') + fieldRow('Shift supervisor', 'op_ps_shift_supervisor') + fieldRow('Signature', 'op_ps_signature'));
                html += section('Product and batch information',
                    fieldRow('Batch Number of Product Produced', 'op_ps_batch_product', 'text', 'wide') +
                    fieldRow('Batch number and Name of Oil produced', 'op_ps_batch_name_oil', 'text', 'wide') +
                    fieldRow('Name of product produced', 'op_ps_name_product', 'text', 'wide'));
                html += section('Run details',
                    fieldRow('Start time', 'op_ps_start_time') + fieldRow('End time', 'op_ps_end_time') + fieldRow('Temperature', 'op_ps_temperature', 'number') + fieldRow('Speed for infeed', 'op_ps_speed_infeed') + fieldRow('Speed for Press', 'op_ps_speed_press'));
                html += section('Main production data',
                    '<div class="op-ps-table-wrap"><table class="table table-sm op-ps-table"><thead><tr><th>Batch number of Raw material used</th><th>Weight of Raw material in (kg)</th><th>Weight of cake out (kg)</th><th>Total weight of Protein Powder hammermilled (kg)</th></tr></thead><tbody id="opProdSheetTableProtein"></tbody></table></div><button type="button" class="btn btn-sm btn-outline-secondary op-ps-add-row" data-sheet="protein_powder">Add row</button>');
                html += section('Comments', '<textarea class="form-control" name="op_ps_comments" rows="2" placeholder="Comments"></textarea>');
                html += section('Waste at end of shift', fieldRow('General waste (kg)', 'op_ps_waste_general', 'number') + fieldRow('Floor waste (kg)', 'op_ps_waste_floor', 'number') + fieldRow('Product waste (kg)', 'op_ps_waste_product', 'number'));
                html += '<div class="op-ps-doc-ref">MP5.2.3.5 Rev 01</div>';
                html += '</div>';
            } else if (sheetType === 'cosmetic_oil') {
                html += '<div class="op-ps-paper">';
                html += '<div class="op-ps-doc-title">Macadamia Cosmetic Oil Production Sheet</div>';
                html +=                 section('Shift and supervisory details',
                    fieldRow('Date', 'op_ps_date', 'text', '', 'flatpickr-date') + fieldRow('Shift', 'op_ps_shift') + fieldRow('Shift Supervisor', 'op_ps_shift_supervisor') + fieldRow('Signature', 'op_ps_signature') + fieldRow('Start Oil BN', 'op_ps_start_oil_bn'));
                html += section('Production log (time, quantities kg)',
                    '<div class="op-ps-table-wrap"><table class="table table-sm op-ps-table"><thead><tr><th>No.</th><th>Time</th><th>Crude kernel</th><th>Kernel dust</th><th>Crush</th><th>Cracker dust</th><th>Cake</th><th>Raw Material Traceability – Description</th><th>Batch #</th></tr></thead><tbody id="opProdSheetTableCosmetic"></tbody></table></div><button type="button" class="btn btn-sm btn-outline-secondary op-ps-add-row" data-sheet="cosmetic_oil">Add row</button>');
                html += section('Totals and oil',
                    fieldRow('IBC 1 (Litre)', 'op_ps_ibc1', 'number') + fieldRow('IBC 2 (Litre)', 'op_ps_ibc2', 'number') + fieldRow('IBC 3 (Litre)', 'op_ps_ibc3', 'number') + fieldRow('Oil BN', 'op_ps_oil_bn') + fieldRow('Literage', 'op_ps_literage', 'number'));
                html += section('Interruptions', fieldRow('1 Start', 'op_ps_int1_start') + fieldRow('1 End', 'op_ps_int1_end') + fieldRow('2 Start', 'op_ps_int2_start') + fieldRow('2 End', 'op_ps_int2_end'));
                html += section('Recipe &amp; Quantity (kg)', fieldRow('Oil Kernel', 'op_ps_recipe_oil_kernel', 'number') + fieldRow('Cracker Dust', 'op_ps_recipe_cracker_dust', 'number') + fieldRow('Kernel dust', 'op_ps_recipe_kernel_dust', 'number') + fieldRow('Crush', 'op_ps_recipe_crush', 'number') + fieldRow('Cake', 'op_ps_recipe_cake', 'number'));
                html += section('Notes', '<textarea class="form-control" name="op_ps_notes" rows="2" placeholder="Notes"></textarea>');
                html += section('Waste totals', fieldRow('General waste total (kg)', 'op_ps_waste_general', 'number') + fieldRow('Floor waste total (kg)', 'op_ps_waste_floor', 'number') + fieldRow('Total product waste (kg)', 'op_ps_waste_product', 'number') + fieldRow('Oil from filter (kg)', 'op_ps_oil_from_filter', 'number') + fieldRow('Hydraulic press total (kg)', 'op_ps_hydraulic_press', 'number'));
                html += '<div class="op-ps-doc-ref">MP5.2.3 Rev 06</div>';
                html += '</div>';
            }
            body.innerHTML = html;
            _oilProductionGrid.renderProductionSheetTableRows(sheetType);
            $(document).off('click', '.op-ps-add-row').on('click', '.op-ps-add-row', function () {
                var s = $(this).data('sheet');
                if (s) _oilProductionGrid.addProductionSheetTableRow(s);
            });
        },

        renderProductionSheetTableRows: function (sheetType) {
            var tbl = document.getElementById('opProdSheetTableFoodGrade') || document.getElementById('opProdSheetTableProtein') || document.getElementById('opProdSheetTableCosmetic');
            if (!tbl) return;
            tbl.innerHTML = '';
            var n = sheetType === 'cosmetic_oil' ? 15 : 10;
            for (var i = 0; i < n; i++) _oilProductionGrid.addProductionSheetTableRow(sheetType, false);
        },

        addProductionSheetTableRow: function (sheetType, animate) {
            var tableId = sheetType === 'food_grade_oil' ? 'opProdSheetTableFoodGrade' : sheetType === 'protein_powder' ? 'opProdSheetTableProtein' : 'opProdSheetTableCosmetic';
            var tbl = document.getElementById(tableId);
            if (!tbl) return;
            var idx = tbl.querySelectorAll('tr').length;
            var html = '';
            if (sheetType === 'food_grade_oil') {
                html = '<tr><td><input type="text" class="form-control form-control-sm" name="op_ps_raw_batch"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_raw_weight_in" step="0.01"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_oil_out" step="0.01"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_cake_out" step="0.01"></td></tr>';
            } else if (sheetType === 'protein_powder') {
                html = '<tr><td><input type="text" class="form-control form-control-sm" name="op_ps_raw_batch"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_raw_weight_in" step="0.01"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_cake_out" step="0.01"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_protein_powder" step="0.01"></td></tr>';
            } else {
                html = '<tr><td>' + (idx + 1) + '</td><td><input type="text" class="form-control form-control-sm" name="op_ps_time" placeholder="Time"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_crude_kernel" step="0.01"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_kernel_dust" step="0.01"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_crush" step="0.01"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_cracker_dust" step="0.01"></td><td><input type="number" class="form-control form-control-sm op-ps-num" name="op_ps_cake" step="0.01"></td><td><input type="text" class="form-control form-control-sm" name="op_ps_desc"></td><td><input type="text" class="form-control form-control-sm" name="op_ps_batch"></td></tr>';
            }
            tbl.insertAdjacentHTML('beforeend', html);
        },

        collectProductionSheetData: function (sheetType) {
            var data = { sheet_type: sheetType, submitted_at: new Date().toISOString() };
            var form = document.getElementById('opProdSheetFormBody');
            if (!form) return data;
            var tbody = form.querySelector('table tbody');
            var inputs = form.querySelectorAll('input[name], textarea[name]');
            inputs.forEach(function (inp) {
                if (tbody && tbody.contains(inp)) return;
                var n = inp.getAttribute('name');
                if (!n || n.startsWith('op_ps_') === false) return;
                var v = inp.value != null ? inp.value.trim() : '';
                if (inp.type === 'number') data[n] = v === '' ? null : parseFloat(v);
                else data[n] = v || null;
            });
            var tableRows = [];
            if (tbody) {
                tbody.querySelectorAll('tr').forEach(function (tr) {
                    var row = {};
                    tr.querySelectorAll('input').forEach(function (inp) {
                        var name = inp.getAttribute('name');
                        if (name) row[name] = inp.type === 'number' ? (inp.value ? parseFloat(inp.value) : null) : (inp.value || '').trim() || null;
                    });
                    if (Object.keys(row).length) tableRows.push(row);
                });
            }
            data.table_rows = tableRows;
            return data;
        },

        submitProductionSheet: async function () {
            var scope = _oilProductionGrid;
            var sheetType = document.getElementById('opProductionSheetType') && document.getElementById('opProductionSheetType').value;
            if (!sheetType) return;
            var uploadMode = $('#opProdSheetModeUpload').is(':checked');
            var dateEl = document.getElementById('opDutyDate');
            var iso = toISO((uploadMode ? '' : (document.querySelector('#opProdSheetFormBody [name="op_ps_date"]') && document.querySelector('#opProdSheetFormBody [name="op_ps_date"]').value)) || (dateEl && dateEl.value));
            if (!iso) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please select a date.', 'warning');
                return;
            }
            var gmpData = null;
            if (uploadMode) {
                var fileInput = document.getElementById('opProdSheetFileInput');
                if (!fileInput || !fileInput.files || !fileInput.files[0]) {
                    if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please select a file to upload.', 'warning');
                    return;
                }
                var file = fileInput.files[0];
                $('#opProdSheetUploadStatus').text('Uploading…');
                var uploadResult = typeof _common !== 'undefined' && _common.uploadFile ? await _common.uploadFile({ file: file, resourceFolder: 'Macavation/OilProductionSheets', fileId: 'prod_' + sheetType + '_' + iso }) : null;
                $('#opProdSheetUploadStatus').text('');
                if (!uploadResult || !uploadResult.Success) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (uploadResult && uploadResult.LastErrorDescription) || 'Upload failed', 'error');
                    return;
                }
                gmpData = { uploaded: true, file_name: file.name, file_id: (uploadResult.Data && uploadResult.Data[0]) ? (uploadResult.Data[0].fileId || uploadResult.Data[0].key) : null, sheet_type: sheetType, date: iso, submitted_at: new Date().toISOString() };
            } else {
                gmpData = scope.collectProductionSheetData(sheetType);
                gmpData.date = iso;
            }
            var tracking = (scope.currentShift && scope.currentShift.shift_tracking && typeof scope.currentShift.shift_tracking === 'object') ? Object.assign({}, scope.currentShift.shift_tracking) : {};
            if (!tracking.production_sheets || typeof tracking.production_sheets !== 'object') tracking.production_sheets = {};
            tracking.production_sheets[sheetType] = gmpData;
            var payload = {
                shift_id: scope.currentShift && scope.currentShift.id ? scope.currentShift.id : null,
                shift_date: iso,
                shift_supervisor: document.getElementById('opPersonOnDuty') ? document.getElementById('opPersonOnDuty').value : '',
                shift_name: document.getElementById('opShiftName') ? document.getElementById('opShiftName').value : '',
                shift_tracking: tracking
            };
            try {
                var result = await dataFunctions.upsertShift(payload);
                var resolved = resolveUpsertShiftResult(result);
                var ok = resolved && resolved.success !== false && !resolved.error;
                if (ok) {
                    var newId = resolved.id || null;
                    if (newId) {
                        scope.currentShift = Object.assign({}, scope.currentShift || {}, {
                            id: newId,
                            shift_date: iso,
                            shift_supervisor: payload.shift_supervisor || null,
                            shift_name: payload.shift_name || null,
                            shift_tracking: tracking
                        });
                    } else if (scope.currentShift) {
                        scope.currentShift.shift_tracking = tracking;
                    }
                    if (newId && typeof dataFunctions.syncOilProductionDutyAudit === 'function') {
                        try {
                            await dataFunctions.syncOilProductionDutyAudit(newId);
                            scope.loadOilBinBatches(true);
                        } catch (auditErr) {
                            console.error('[Oil Production] submitProductionSheet syncOilProductionDutyAudit:', auditErr);
                        }
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Production sheet saved.', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('opProductionSheetModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getInstance(modalEl).hide();
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (resolved && (resolved.error || resolved.message)) || (result && (result.error || result.message)) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] submitProductionSheet:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
            }
        },

        showGmpCheckSheetModal: function () {
            var scope = _oilProductionGrid;
            var dateEl = document.getElementById('opDutyDate');
            var personEl = document.getElementById('opPersonOnDuty');
            var gmpDate = document.getElementById('opGmpDate');
            var gmpCheckedBy = document.getElementById('opGmpCheckedBy');
            var gmpUploadDate = document.getElementById('opGmpUploadDate');
            var gmpUploadCheckedBy = document.getElementById('opGmpUploadCheckedBy');
            if (gmpDate) gmpDate.value = dateEl && dateEl.value ? dateEl.value : fromISO(new Date().toISOString().split('T')[0]);
            if (gmpCheckedBy) gmpCheckedBy.value = personEl && personEl.value ? personEl.value : '';
            if (gmpUploadDate) gmpUploadDate.value = dateEl && dateEl.value ? dateEl.value : fromISO(new Date().toISOString().split('T')[0]);
            if (gmpUploadCheckedBy) gmpUploadCheckedBy.value = personEl && personEl.value ? personEl.value : '';
            if (!document.getElementById('opGmpFormRows').innerHTML.trim()) scope.buildGmpFormRows();
            var gmp = scope.currentShift && scope.currentShift.shift_tracking && scope.currentShift.shift_tracking.gmp_check_sheet;
            if (gmp) scope.populateGmpForm(gmp);
            else scope.clearGmpForm();
            $('#opGmpModeForm').prop('checked', true);
            $('#opGmpFormSection').show();
            $('#opGmpUploadSection, #opGmpUploadOnlyFields').hide();
            $('#opGmpFileInput').val('');
            $('#opGmpUploadStatus').text('');
            var modalEl = document.getElementById('opGmpCheckSheetModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            setTimeout(function () {
                [document.getElementById('opGmpDate'), document.getElementById('opGmpUploadDate')].forEach(function (el) {
                    if (el && typeof flatpickr !== 'undefined' && !el._flatpickr) flatpickr(el, FLATPICKR_OPTS);
                });
            }, 100);
        },

        buildGmpFormRows: function () {
            var container = document.getElementById('opGmpFormRows');
            if (!container) return;
            var html = '';
            GMP_CHECK_SHEET_ROWS.forEach(function (r) {
                html += '<div class="card mb-2 op-gmp-row" data-row="' + r.num + '">';
                html += '<div class="card-body py-2">';
                html += '<div class="row align-items-start">';
                html += '<div class="col-md-4 small">';
                html += '<strong>#' + r.num + ' ' + escapeHtml(r.action) + '</strong><br><span class="text-muted">' + escapeHtml(r.detail) + '</span>';
                html += '</div><div class="col-md-8">';
                if (r.type === 'pass_fail_4' && r.labels) {
                    r.labels.forEach(function (lbl, i) {
                        html += '<div class="form-check form-check-inline"><input class="form-check-input op-gmp-pf" type="radio" name="op_gmp_r' + r.num + '_' + i + '" id="op_gmp_r' + r.num + '_' + i + '_pass" value="pass"><label class="form-check-label" for="op_gmp_r' + r.num + '_' + i + '_pass">✓</label></div>';
                        html += '<div class="form-check form-check-inline"><input class="form-check-input op-gmp-pf" type="radio" name="op_gmp_r' + r.num + '_' + i + '" value="fail"><label class="form-check-label">✗</label></div> ' + escapeHtml(lbl) + '<br>';
                    });
                } else if (r.type === 'temperatures' && r.items) {
                    r.items.forEach(function (item, i) {
                        html += '<div class="input-group input-group-sm mb-1"><span class="input-group-text" style="min-width:180px">' + escapeHtml(item.name) + ' (' + escapeHtml(item.spec) + ' °C)</span>';
                        html += '<input type="number" class="form-control op-gmp-temp-actual" placeholder="Actual °C" data-row="' + r.num + '" data-idx="' + i + '">';
                        html += '<div class="form-check form-check-inline ms-2"><input class="form-check-input op-gmp-temp-pf" type="radio" name="op_gmp_temp_' + r.num + '_' + i + '" value="pass"> ✓</div>';
                        html += '<div class="form-check form-check-inline"><input class="form-check-input op-gmp-temp-pf" type="radio" name="op_gmp_temp_' + r.num + '_' + i + '" value="fail"> ✗</div></div>';
                    });
                } else if (r.type === 'scale_3') {
                    for (var s = 1; s <= 3; s++) {
                        html += '<div class="input-group input-group-sm mb-1"><span class="input-group-text">Scale ' + s + '</span><input type="text" class="form-control op-gmp-scale-actual" placeholder="Actual" data-row="' + r.num + '" data-scale="' + s + '">';
                        html += '<div class="form-check form-check-inline ms-2"><input class="form-check-input op-gmp-scale-pf" type="radio" name="op_gmp_scale_' + r.num + '_' + s + '" value="pass"> ✓</div>';
                        html += '<div class="form-check form-check-inline"><input class="form-check-input op-gmp-scale-pf" type="radio" name="op_gmp_scale_' + r.num + '_' + s + '" value="fail"> ✗</div></div>';
                    }
                } else if (r.type === 'broken_3' && r.labels) {
                    r.labels.forEach(function (lbl, i) {
                        html += '<div class="input-group input-group-sm mb-1"><span class="input-group-text" style="min-width:140px">' + escapeHtml(lbl) + '</span>';
                        html += '<input type="text" class="form-control op-gmp-broken" placeholder="Broken" data-row="' + r.num + '" data-idx="' + i + '">';
                        html += '<input type="text" class="form-control op-gmp-replaced" placeholder="Replaced" data-row="' + r.num + '" data-idx="' + i + '"></div>';
                    });
                } else if (r.type === 'magnet_4' && r.times) {
                    r.times.forEach(function (t, i) {
                        html += '<div class="form-check form-check-inline"><input class="form-check-input op-gmp-magnet" type="radio" name="op_gmp_mag_' + r.num + '_' + i + '" value="pass"> ' + t + ' Pass</div>';
                        html += '<div class="form-check form-check-inline"><input class="form-check-input op-gmp-magnet" type="radio" name="op_gmp_mag_' + r.num + '_' + i + '" value="fail"> Fail</div> ';
                    });
                    html += '<br>';
                } else if (r.type === 'pass_fail') {
                    html += '<div class="form-check form-check-inline"><input class="form-check-input op-gmp-pf-single" type="radio" name="op_gmp_r' + r.num + '" value="pass"> Pass ✓</div>';
                    html += '<div class="form-check form-check-inline"><input class="form-check-input op-gmp-pf-single" type="radio" name="op_gmp_r' + r.num + '" value="fail"> Fail ✗</div>';
                } else if (r.type === 'comment') {
                    html += '<input type="text" class="form-control form-control-sm op-gmp-comment" placeholder="Details / comments" data-row="' + r.num + '">';
                }
                html += '</div></div></div>';
            });
            container.innerHTML = html;
        },

        populateGmpForm: function (gmp) {
            if (!gmp || gmp.uploaded) return;
            var setVal = function (id, v) { var el = document.getElementById(id); if (el && v != null) el.value = v; };
            setVal('opGmpDate', gmp.date || '');
            setVal('opGmpCheckedBy', gmp.checked_by || '');
            setVal('opGmpComments', gmp.comments || '');
            if (gmp.rows) {
                Object.keys(gmp.rows).forEach(function (key) {
                    var rowData = gmp.rows[key];
                    var rowEl = document.querySelector('.op-gmp-row[data-row="' + key + '"]');
                    if (!rowEl) return;
                    if (rowData.pass_fail_4) rowData.pass_fail_4.forEach(function (v, i) { var r = rowEl.querySelector('input[name="op_gmp_r' + key + '_' + i + '"][value="' + v + '"]'); if (r) r.checked = true; });
                    if (rowData.pass_fail != null) { var r = rowEl.querySelector('input[name="op_gmp_r' + key + '"][value="' + rowData.pass_fail + '"]'); if (r) r.checked = true; }
                    if (rowData.comment) { var c = rowEl.querySelector('.op-gmp-comment'); if (c) c.value = rowData.comment; }
                });
            }
        },

        clearGmpForm: function () {
            $('#opGmpFormRows input, #opGmpFormRows textarea').val('');
            $('#opGmpFormRows input[type="radio"]').prop('checked', false);
            $('#opGmpComments').val('');
        },

        collectGmpFormData: function () {
            var data = { version: 'MP5.2.1 Rev 03', date: $('#opGmpDate').val() || '', checked_by: $('#opGmpCheckedBy').val() || '', comments: $('#opGmpComments').val() || '', rows: {} };
            GMP_CHECK_SHEET_ROWS.forEach(function (r) {
                var rowData = {};
                if (r.type === 'pass_fail_4' && r.labels) {
                    rowData.pass_fail_4 = r.labels.map(function (_, i) {
                        var radio = document.querySelector('input[name="op_gmp_r' + r.num + '_' + i + '"]:checked');
                        return radio ? radio.value : null;
                    });
                } else if (r.type === 'temperatures' && r.items) {
                    rowData.temps = r.items.map(function (_, i) {
                        var act = document.querySelector('.op-gmp-row[data-row="' + r.num + '"] .op-gmp-temp-actual[data-idx="' + i + '"]');
                        var pf = document.querySelector('input[name="op_gmp_temp_' + r.num + '_' + i + '"]:checked');
                        return { actual: act ? act.value : null, pass_fail: pf ? pf.value : null };
                    });
                } else if (r.type === 'scale_3') {
                    rowData.scales = [1, 2, 3].map(function (s) {
                        var act = document.querySelector('.op-gmp-row[data-row="' + r.num + '"] .op-gmp-scale-actual[data-scale="' + s + '"]');
                        var pf = document.querySelector('input[name="op_gmp_scale_' + r.num + '_' + s + '"]:checked');
                        return { actual: act ? act.value : null, pass_fail: pf ? pf.value : null };
                    });
                } else if (r.type === 'broken_3' && r.labels) {
                    rowData.items = r.labels.map(function (_, i) {
                        var broken = document.querySelector('.op-gmp-row[data-row="' + r.num + '"] .op-gmp-broken[data-idx="' + i + '"]');
                        var repl = document.querySelector('.op-gmp-row[data-row="' + r.num + '"] .op-gmp-replaced[data-idx="' + i + '"]');
                        return { broken: broken ? broken.value : null, replaced: repl ? repl.value : null };
                    });
                } else if (r.type === 'magnet_4' && r.times) {
                    rowData.times = r.times.map(function (_, i) {
                        var pf = document.querySelector('input[name="op_gmp_mag_' + r.num + '_' + i + '"]:checked');
                        return pf ? pf.value : null;
                    });
                } else if (r.type === 'pass_fail') {
                    var pf = document.querySelector('.op-gmp-row[data-row="' + r.num + '"] input[name="op_gmp_r' + r.num + '"]:checked');
                    rowData.pass_fail = pf ? pf.value : null;
                } else if (r.type === 'comment') {
                    var c = document.querySelector('.op-gmp-row[data-row="' + r.num + '"] .op-gmp-comment');
                    rowData.comment = c ? c.value : null;
                }
                data.rows[r.num] = rowData;
            });
            data.submitted_at = new Date().toISOString();
            return data;
        },

        submitGmpCheckSheet: async function () {
            var scope = _oilProductionGrid;
            var uploadMode = $('#opGmpModeUpload').is(':checked');
            var dateEl = document.getElementById('opDutyDate');
            var iso = toISO((uploadMode ? $('#opGmpUploadDate').val() : $('#opGmpDate').val()) || (dateEl && dateEl.value));
            if (!iso) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please select a date.', 'warning');
                return;
            }
            var checkedBy = uploadMode ? ($('#opGmpUploadCheckedBy').val() || '').trim() : ($('#opGmpCheckedBy').val() || '').trim();
            var gmpData = null;
            if (uploadMode) {
                var fileInput = document.getElementById('opGmpFileInput');
                if (!fileInput || !fileInput.files || !fileInput.files[0]) {
                    if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please select a file to upload.', 'warning');
                    return;
                }
                var file = fileInput.files[0];
                $('#opGmpUploadStatus').text('Uploading…');
                var uploadResult = null;
                if (typeof _common !== 'undefined' && _common.uploadFile) {
                    uploadResult = await _common.uploadFile({ file: file, resourceFolder: 'Macavation/OilGMP', fileId: 'gmp_' + iso + '_' + (checkedBy || 'duty') });
                }
                $('#opGmpUploadStatus').text('');
                if (!uploadResult || !uploadResult.Success) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (uploadResult && uploadResult.LastErrorDescription) || 'Upload failed', 'error');
                    return;
                }
                gmpData = { uploaded: true, file_name: file.name, file_id: (uploadResult.Data && uploadResult.Data[0]) ? (uploadResult.Data[0].fileId || uploadResult.Data[0].key) : null, date: iso, checked_by: checkedBy || null, comments: ($('#opGmpUploadComments').val() || '').trim() || null, submitted_at: new Date().toISOString() };
            } else {
                gmpData = scope.collectGmpFormData();
                gmpData.date = iso;
                gmpData.checked_by = checkedBy || null;
            }
            var tracking = (scope.currentShift && scope.currentShift.shift_tracking && typeof scope.currentShift.shift_tracking === 'object') ? Object.assign({}, scope.currentShift.shift_tracking) : {};
            tracking.gmp_check_sheet = gmpData;
            var payload = {
                shift_id: scope.currentShift && scope.currentShift.id ? scope.currentShift.id : null,
                shift_date: iso,
                shift_supervisor: document.getElementById('opPersonOnDuty') ? document.getElementById('opPersonOnDuty').value : '',
                shift_name: document.getElementById('opShiftName') ? document.getElementById('opShiftName').value : '',
                shift_tracking: tracking
            };
            try {
                var result = await dataFunctions.upsertShift(payload);
                var resolved = resolveUpsertShiftResult(result);
                var ok = resolved && resolved.success !== false && !resolved.error;
                if (ok) {
                    var newId = resolved.id || null;
                    var personEl = document.getElementById('opPersonOnDuty');
                    var shiftNameEl = document.getElementById('opShiftName');
                    if (newId) {
                        scope.currentShift = Object.assign({}, scope.currentShift || {}, {
                            id: newId,
                            shift_date: iso,
                            shift_supervisor: (personEl && personEl.value && personEl.value.trim()) || null,
                            shift_name: (shiftNameEl && shiftNameEl.value && shiftNameEl.value.trim()) || null,
                            shift_tracking: tracking
                        });
                    } else if (scope.currentShift) {
                        scope.currentShift.shift_tracking = tracking;
                    }
                    var auditMsg = 'GMP Check Sheet saved.';
                    if (newId && typeof dataFunctions.syncOilProductionDutyAudit === 'function') {
                        try {
                            var audit = await dataFunctions.syncOilProductionDutyAudit(newId);
                            var ar = resolveUpsertShiftResult(audit);
                            if (ar && ar.success !== false && ar.linked_bin_batches != null) {
                                auditMsg += ' Linked ' + ar.linked_bin_batches + ' oil bin batch(es); ' + (ar.raw_ingredient_count != null ? ar.raw_ingredient_count : 0) + ' raw ingredient row(s).';
                            }
                            scope.loadOilBinBatches(true);
                        } catch (auditErr) {
                            console.error('[Oil Production] submitGmpCheckSheet syncOilProductionDutyAudit:', auditErr);
                            auditMsg += ' (Duty link to oil bins failed — try “save duty only” or check permissions.)';
                        }
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: auditMsg, timer: 4000, showConfirmButton: false });
                    var modalEl = document.getElementById('opGmpCheckSheetModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getInstance(modalEl).hide();
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (resolved && (resolved.error || resolved.message)) || (result && (result.error || result.message)) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] submitGmpCheckSheet:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
            }
        },

        loadAll: function (forceRefresh) {
            var scope = _oilProductionGrid;
            scope.loadRawIngredients(forceRefresh);
            scope.loadFinishedRawIngredients(forceRefresh);
            scope.loadShiftForSelectedDate(forceRefresh);
            scope.loadOilBinBatches(forceRefresh);
        },

        confirmMarkRawIngredientEmpty: function (oilId) {
            var scope = _oilProductionGrid;
            var row = (scope.rawIngredients || []).find(function (o) { return String(o.id) === String(oilId); });
            var label = row && row.batch_id ? row.batch_id : oilId;
            var run = function () {
                scope.markRawIngredientEmpty(oilId);
            };
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Mark bag empty?',
                    html: 'Batch <strong>' + escapeHtml(String(label)) + '</strong> will move to <strong>Finished (emptied) raw batches</strong>.',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, empty',
                    cancelButtonText: 'Cancel'
                }).then(function (r) { if (r.isConfirmed) run(); });
            } else if (window.confirm('Mark batch ' + label + ' as empty?')) {
                run();
            }
        },

        markRawIngredientEmpty: async function (oilId) {
            var scope = _oilProductionGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.markOilRawIngredientEmpty) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'This action is not available.', 'error');
                    return;
                }
                var result = await dataFunctions.markOilRawIngredientEmpty(oilId);
                var ok = result && result.success !== false && !result.error;
                if (ok) {
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'success', title: 'Marked empty', text: 'Batch moved to finished list.', timer: 2000, showConfirmButton: false });
                    }
                    scope.loadRawIngredients(true);
                    scope.loadFinishedRawIngredients(true);
                } else {
                    var msg = (result && (result.error || result.message)) || 'Could not mark empty.';
                    if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
                }
            } catch (e) {
                console.error('[Oil Production] markRawIngredientEmpty:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Request failed', 'error');
            }
        },

        showViewDataModal: async function () {
            var scope = _oilProductionGrid;
            var body = document.getElementById('opViewDataModalBody');
            var modalEl = document.getElementById('opViewDataModal');
            if (!body || !modalEl) return;
            body.innerHTML = '<p class="text-muted mb-0">Loading…</p>';
            if (typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            try {
                await scope.loadOilBinBatchesReport(true);
            } catch (e) {
                console.warn('[Oil Production] loadOilBinBatchesReport:', e);
            }
            scope.loadAll(true);
            await new Promise(function (resolve) { setTimeout(resolve, 750); });
            body.innerHTML = scope.buildViewDataHtml();
        },

        buildViewDataHtml: function () {
            var scope = _oilProductionGrid;
            var raw = scope.rawIngredients || [];
            var rawFin = scope.rawIngredientsFinished || [];
            var batches = scope.oilBinBatchesReport != null ? scope.oilBinBatchesReport : (scope.oilBinBatches || []);
            var shift = scope.currentShift;
            var html = '';

            function section(title, icon, content) {
                return '<div class="card mb-3"><div class="card-header bg-light py-2"><h6 class="mb-0">' + (icon ? '<i class="' + icon + ' me-2"></i>' : '') + escapeHtml(title) + '</h6></div><div class="card-body p-2">' + content + '</div></div>';
            }

            html += section('Shift (selected date)', 'fas fa-user-clock', (function () {
                if (!shift) return '<p class="text-muted small mb-0">No shift recorded for the selected date.</p>';
                var d = shift.shift_date ? fromISO(String(shift.shift_date).split('T')[0]) : '—';
                var tr = '<p class="mb-1"><strong>Date:</strong> ' + escapeHtml(d) + '</p>';
                tr += '<p class="mb-1"><strong>Person on duty:</strong> ' + escapeHtml(shift.shift_supervisor || '—') + '</p>';
                tr += '<p class="mb-0"><strong>Shift name:</strong> ' + escapeHtml(shift.shift_name || '—') + '</p>';
                if (shift.shift_tracking && (shift.shift_tracking.gmp_check_sheet || (shift.shift_tracking.production_sheets && Object.keys(shift.shift_tracking.production_sheets).length))) {
                    tr += '<p class="mb-0 mt-2 small text-muted">GMP / production sheets recorded for this shift.</p>';
                }
                return tr;
            })());

            html += section('Raw ingredients in production', 'fas fa-boxes', (function () {
                if (!raw.length) return '<p class="text-muted small mb-0">No raw ingredients in production.</p>';
                var intake = function (o) { return (o && o.intake_data) || {}; };
                var productLabel = function (o) {
                    var i = intake(o);
                    var pt = i.product_type || (o.name_of_product && String(o.name_of_product));
                    return pt ? String(pt).replace(/_/g, ' ') : '—';
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
                var tbl = '<div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead><tr><th>Batch #</th><th>Product type</th><th>Quantity (kg)</th><th>Date received</th></tr></thead><tbody>';
                raw.forEach(function (o) {
                    tbl += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + (qty(o) != null ? qty(o) : '—') + '</td><td>' + escapeHtml(dateReceived(o)) + '</td></tr>';
                });
                tbl += '</tbody></table></div>';
                return tbl;
            })());

            html += section('Finished (emptied) raw batches', 'fas fa-check-circle', (function () {
                if (!rawFin.length) return '<p class="text-muted small mb-0">No emptied raw batches yet.</p>';
                var intake = function (o) { return (o && o.intake_data) || {}; };
                var productLabel = function (o) {
                    var i = intake(o);
                    var pt = i.product_type || (o.name_of_product && String(o.name_of_product));
                    return pt ? String(pt).replace(/_/g, ' ') : '—';
                };
                var qty = function (o) {
                    var i = intake(o);
                    return i.quantity_kg != null ? i.quantity_kg : (i.items && i.items[0] && i.items[0].quantity_kg);
                };
                var emptiedAt = function (o) {
                    var i = intake(o);
                    var t = i.raw_emptied_at;
                    if (!t) return '—';
                    try {
                        return new Date(t).toLocaleString();
                    } catch (e) {
                        return String(t);
                    }
                };
                var tbl = '<div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead><tr><th>Batch #</th><th>Product type</th><th>Qty (kg)</th><th>Emptied at</th></tr></thead><tbody>';
                rawFin.forEach(function (o) {
                    tbl += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + (qty(o) != null ? qty(o) : '—') + '</td><td>' + escapeHtml(emptiedAt(o)) + '</td></tr>';
                });
                tbl += '</tbody></table></div>';
                return tbl;
            })());

            html += section(scope.oilBinBatchesReport != null ? 'Oil bin batches (all)' : 'Oil bin batches (production)', 'fas fa-flask', (function () {
                if (!batches.length) return '<p class="text-muted small mb-0">No oil bin batches yet.</p>';
                var tbl = '<div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead><tr><th>Batch number</th><th>Shifts</th><th>Ingredients</th><th>Start date</th><th>Letrerage</th><th>FFA</th><th>Status</th><th>Duty (audit)</th></tr></thead><tbody>';
                batches.forEach(function (b) {
                    var startDate = b.start_date ? (typeof b.start_date === 'string' ? b.start_date.split('T')[0] : b.start_date) : '—';
                    var dutyAudit = b.duty_shift_supervisor ? escapeHtml(b.duty_shift_supervisor) : (b.shift_id ? '<span class="text-muted">Linked</span>' : '—');
                    tbl += '<tr><td>' + escapeHtml(b.batch_number || '—') + '</td><td>' + escapeHtml(b.shifts || '—') + '</td><td>' + escapeHtml(b.ingredients || '—') + '</td><td>' + escapeHtml(startDate) + '</td><td>' + (b.letrerage != null ? b.letrerage : '—') + '</td><td>' + (b.ffa != null ? b.ffa : '—') + '</td><td>' + escapeHtml(b.status || '—') + '</td><td>' + dutyAudit + '</td></tr>';
                });
                tbl += '</tbody></table></div>';
                return tbl;
            })());

            return html || '<p class="text-muted mb-0">No data to display. Use Refresh on the main page and try again.</p>';
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

                var html = '<div class="table-responsive"><table class="table table-sm table-hover mb-0 op-raw-ingredients-table"><thead><tr><th>Batch #</th><th>Product type</th><th>Quantity (kg)</th><th>Date received</th><th class="text-end">Action</th></tr></thead><tbody>';
                rows.forEach(function (o) {
                    html += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + (qty(o) != null ? qty(o) : '—') + '</td><td>' + escapeHtml(dateReceived(o)) + '</td><td class="text-end"><button type="button" class="btn btn-sm btn-outline-secondary op-raw-empty-btn" data-oil-id="' + escapeHtml(o.id) + '" title="Bag finished in press">Empty</button></td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
            } catch (e) {
                console.error('[Oil Production] loadRawIngredients:', e);
                el.innerHTML = '<p class="text-danger mb-0">Failed to load raw ingredients.</p>';
            }
        },

        loadFinishedRawIngredients: async function (forceRefresh) {
            var el = document.getElementById('opFinishedRawIngredientsList');
            if (!el) return;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilBatches) {
                    el.innerHTML = '<p class="text-muted small mb-0">Data not available.</p>';
                    return;
                }
                var raw = await dataFunctions.getOilBatches({ status: 'raw_empty', limit: 200 }, null, !!forceRefresh);
                var rows = normalizeOilBatches(raw);
                _oilProductionGrid.rawIngredientsFinished = rows || [];

                if (!rows || rows.length === 0) {
                    el.innerHTML = '<p class="text-muted small mb-0">No finished (emptied) batches yet.</p>';
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
                var emptiedAt = function (o) {
                    var i = intake(o);
                    var t = i.raw_emptied_at;
                    if (!t) return '—';
                    try {
                        return new Date(t).toLocaleString();
                    } catch (e) {
                        return String(t);
                    }
                };

                var html = '<div class="table-responsive"><table class="table table-sm table-hover mb-0 op-raw-ingredients-table op-finished-raw-table"><thead><tr><th>Batch #</th><th>Product type</th><th>Quantity (kg)</th><th>Emptied at</th></tr></thead><tbody>';
                rows.forEach(function (o) {
                    html += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + (qty(o) != null ? qty(o) : '—') + '</td><td>' + escapeHtml(emptiedAt(o)) + '</td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
            } catch (e) {
                console.error('[Oil Production] loadFinishedRawIngredients:', e);
                el.innerHTML = '<p class="text-danger small mb-0">Failed to load finished batches.</p>';
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
                var resolved = resolveUpsertShiftResult(result);
                var ok = resolved && resolved.success !== false && !resolved.error;
                if (ok) {
                    var newShiftId = resolved && resolved.id ? resolved.id : null;
                    if (newShiftId) {
                        _oilProductionGrid.currentShift = Object.assign({}, _oilProductionGrid.currentShift || {}, {
                            id: newShiftId,
                            shift_date: iso,
                            shift_supervisor: (personEl.value && personEl.value.trim()) || null,
                            shift_name: (shiftNameEl.value && shiftNameEl.value.trim()) || null
                        });
                    }
                    var auditMsg = 'Person on duty saved.';
                    if (newShiftId && typeof dataFunctions.syncOilProductionDutyAudit === 'function') {
                        try {
                            var audit = await dataFunctions.syncOilProductionDutyAudit(newShiftId);
                            var ar = resolveUpsertShiftResult(audit);
                            if (ar && ar.success !== false && ar.linked_bin_batches != null) {
                                auditMsg += ' Linked ' + ar.linked_bin_batches + ' oil bin batch(es); ' + (ar.raw_ingredient_count != null ? ar.raw_ingredient_count : 0) + ' raw ingredient row(s) recorded.';
                            }
                            scope.loadOilBinBatches(true);
                        } catch (auditErr) {
                            console.error('[Oil Production] syncOilProductionDutyAudit:', auditErr);
                            auditMsg += ' (Could not link to oil bin batches — try again or check permissions.)';
                        }
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: auditMsg, timer: 3500, showConfirmButton: false });
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (resolved && (resolved.error || resolved.message)) || (result && (result.error || result.message)) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] savePersonOnDuty:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
            }
        },

        loadOilBinBatchesReport: async function (forceRefresh) {
            var scope = _oilProductionGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilBinBatches) {
                    scope.oilBinBatchesReport = [];
                    return;
                }
                var rawAll = await dataFunctions.getOilBinBatches({ limit: 200 }, null, !!forceRefresh);
                scope.oilBinBatchesReport = normalizeOilBinBatches(rawAll).map(normalizeOilBinBatchRow) || [];
            } catch (e) {
                console.error('[Oil Production] loadOilBinBatchesReport:', e);
                _oilProductionGrid.oilBinBatchesReport = [];
            }
        },

        loadOilBinBatches: async function (forceRefresh) {
            var el = document.getElementById('opOilBinBatchesList');
            if (!el) return;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilBinBatches) {
                    el.innerHTML = '<p class="text-muted mb-0">Data not available.</p>';
                    return;
                }
                var raw = await dataFunctions.getOilBinBatches({ limit: 100, status: 'in_production' }, null, !!forceRefresh);
                var rows = normalizeOilBinBatches(raw).map(normalizeOilBinBatchRow);
                _oilProductionGrid.oilBinBatches = rows || [];

                if (!rows || rows.length === 0) {
                    el.innerHTML = '<p class="text-muted mb-0">No oil bin batches yet. Click <strong>Start oil bin</strong> to create one.</p>';
                    return;
                }

                var html = '<div class="table-responsive"><table class="table table-sm table-hover mb-0 op-oil-bin-batches-table"><thead><tr><th>Batch number</th><th>Shifts</th><th>Ingredients</th><th>Start date</th><th>Letrerage</th><th>FFA</th><th class="text-end">Actions</th></tr></thead><tbody>';
                rows.forEach(function (b) {
                    var startDate = b.start_date ? (typeof b.start_date === 'string' ? b.start_date.split('T')[0] : b.start_date) : '—';
                    var actions = '';
                    var auditBtn = '<button type="button" class="btn btn-sm btn-outline-info op-oil-bin-audit-btn" data-oil-bin-batch-id="' + escapeHtml(b.id) + '" title="Duty &amp; raw ingredients audit"><i class="fas fa-clipboard-list"></i></button>';
                    if (b.status === 'in_production') {
                        actions += '<div class="d-flex flex-wrap gap-1 justify-content-end">' + auditBtn + '<button type="button" class="btn btn-sm btn-outline-secondary op-edit-oil-bin-batch" data-oil-bin-batch-id="' + escapeHtml(b.id) + '" title="Edit"><i class="fas fa-edit"></i></button>';
                        actions += '<button type="button" class="btn btn-sm btn-outline-primary op-send-oil-bin-to-stock" data-oil-bin-batch-id="' + escapeHtml(b.id) + '">Send to stock</button></div>';
                    } else {
                        if (b.oil_id) {
                            actions = '<div class="d-flex flex-wrap gap-1 justify-content-end">' + auditBtn + '<span class="text-muted small align-self-center me-1">Sent</span><button type="button" class="btn btn-sm btn-outline-secondary op-production-data-btn" data-oil-id="' + escapeHtml(b.oil_id) + '" title="Edit production data">Production data</button></div>';
                        } else {
                            actions = '<div class="d-flex flex-wrap gap-1 justify-content-end">' + auditBtn + '<span class="text-muted small align-self-center">Sent</span></div>';
                        }
                    }
                    html += '<tr><td>' + escapeHtml(b.batch_number || '—') + '</td><td>' + escapeHtml(b.shifts || '—') + '</td><td>' + escapeHtml(b.ingredients || '—') + '</td><td>' + escapeHtml(startDate) + '</td><td>' + (b.letrerage != null ? b.letrerage : '—') + '</td><td>' + (b.ffa != null ? b.ffa : '—') + '</td><td class="text-end">' + actions + '</td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
            } catch (e) {
                console.error('[Oil Production] loadOilBinBatches:', e);
                el.innerHTML = '<p class="text-danger mb-0">Failed to load oil bin batches.</p>';
            }
        },

        startOilBin: async function () {
            var scope = _oilProductionGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.startOilBinBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.startOilBinBatch(null, null);
                if (result && result.success && result.batch_number) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Oil bin started', text: 'Batch ' + result.batch_number + ' created.', timer: 2500, showConfirmButton: false });
                    scope.loadOilBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Failed to start oil bin', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] startOilBin:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to start oil bin', 'error');
            }
        },

        sendOilBinBatchToStock: async function (oilBinBatchId) {
            var scope = _oilProductionGrid;
            if (typeof Swal !== 'undefined') {
                var confirmed = await Swal.fire({
                    title: 'Send to stock?',
                    html: 'This will push the oil bin batch to stock.',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Send to stock'
                });
                if (!confirmed || !confirmed.isConfirmed) return;
            }
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.sendOilBinBatchToStock) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.sendOilBinBatchToStock(oilBinBatchId, null);
                if (result && result.success) {
                    var bn = result.batch_number || (result.data && result.data.batch_number);
                    var msg = (bn ? 'Batch ' + bn + ' ' : '') + 'removed from production and added to Stock Management (Oil stream, location 801).';
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadOilLotsAndSummary) {
                        try { await _stockManagementGrid.loadOilLotsAndSummary(true); } catch (x) { /* ignore */ }
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Sent to stock', text: msg, timer: 3500, showConfirmButton: false });
                    scope.loadOilBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Failed to send to stock', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] sendOilBinBatchToStock:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to send to stock', 'error');
            }
        },

        showOilBinBatchAuditModal: async function (oilBinBatchId) {
            var scope = _oilProductionGrid;
            var bid = oilBinBatchId != null ? String(oilBinBatchId) : '';
            var batch = (scope.oilBinBatches || []).find(function (b) { return b && String(b.id) === bid; });
            if (typeof dataFunctions !== 'undefined' && dataFunctions.getOilBinBatches) {
                try {
                    var freshRaw = await dataFunctions.getOilBinBatches({ limit: 150 }, null, true);
                    var freshRows = normalizeOilBinBatches(freshRaw).map(normalizeOilBinBatchRow);
                    var found = freshRows.find(function (b) { return b && String(b.id) === bid; });
                    if (found) {
                        batch = found;
                        var idx = (scope.oilBinBatches || []).findIndex(function (b) { return b && String(b.id) === bid; });
                        if (idx >= 0) scope.oilBinBatches[idx] = found;
                    }
                } catch (err) {
                    console.warn('[Oil Production] showOilBinBatchAuditModal refresh:', err);
                }
            }
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Not found', 'Refresh the list and try again.', 'info');
                return;
            }
            var numEl = document.getElementById('opAuditOilBinBatchNumber');
            if (numEl) numEl.textContent = batch.batch_number || '—';

            var dutyEl = document.getElementById('opAuditDutySection');
            var hasDuty = !!(batch.shift_id || batch.duty_shift_date);
            if (dutyEl) {
                if (hasDuty) {
                    var dRaw = batch.duty_shift_date;
                    var dStr = dRaw ? (typeof dRaw === 'string' ? dRaw.split('T')[0] : dRaw) : '—';
                    if (dStr && typeof dStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dStr)) dStr = fromISO(dStr);
                    dutyEl.innerHTML =
                        '<dl class="row small mb-0">' +
                        '<dt class="col-sm-4">Duty date</dt><dd class="col-sm-8">' + escapeHtml(String(dStr || '—')) + '</dd>' +
                        '<dt class="col-sm-4">Person on duty</dt><dd class="col-sm-8">' + escapeHtml(batch.duty_shift_supervisor || '—') + '</dd>' +
                        '<dt class="col-sm-4">Shift name</dt><dd class="col-sm-8">' + escapeHtml(batch.duty_shift_name || '—') + '</dd>' +
                        '<dt class="col-sm-4">Shift record ID</dt><dd class="col-sm-8"><code class="small text-break">' + escapeHtml(String(batch.shift_id || '—')) + '</code></dd>' +
                        '</dl>';
                } else {
                    dutyEl.innerHTML = '<p class="text-muted small mb-0">No shift linked yet. Save <strong>Person on duty</strong> for this batch\'s start date while it is still in production, or create the duty record before <strong>Start oil bin</strong> so the new batch auto-links.</p>';
                }
            }

            var ing = batch.raw_ingredient_audit;
            var list = [];
            if (Array.isArray(ing)) list = ing;
            else if (ing && typeof ing === 'string') {
                try {
                    var parsed = JSON.parse(ing);
                    list = Array.isArray(parsed) ? parsed : [];
                } catch (e) { list = []; }
            }

            var sec = document.getElementById('opAuditIngredientsSection');
            if (sec) {
                if (!list.length) {
                    sec.innerHTML = '<p class="text-muted small mb-0">No raw ingredient snapshot stored for this batch yet.</p>';
                } else {
                    var tbl = '<div class="table-responsive"><table class="table table-sm table-bordered mb-0"><thead><tr><th>Batch #</th><th>Product type</th><th>Qty (kg)</th><th>Raw oil row ID</th></tr></thead><tbody>';
                    list.forEach(function (row) {
                        var pt = row.product_type ? String(row.product_type).replace(/_/g, ' ') : '—';
                        tbl += '<tr><td>' + escapeHtml(row.batch_id || '—') + '</td><td>' + escapeHtml(pt) + '</td><td>' + (row.quantity_kg != null ? row.quantity_kg : '—') + '</td><td><code class="small text-break">' + escapeHtml(String(row.oil_id || '—')) + '</code></td></tr>';
                    });
                    tbl += '</tbody></table></div>';
                    sec.innerHTML = tbl;
                }
            }

            var modalEl = document.getElementById('opOilBinAuditModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
        },

        showEditOilBinBatchModal: function (oilBinBatchId) {
            var scope = _oilProductionGrid;
            var batch = (scope.oilBinBatches || []).find(function (b) { return b.id === oilBinBatchId; });
            if (!batch) return;
            document.getElementById('opEditOilBinBatchId').value = batch.id || '';
            document.getElementById('opEditOilBinBatchNumber').textContent = batch.batch_number || '—';
            document.getElementById('opEditOilBinShifts').value = batch.shifts || '';
            document.getElementById('opEditOilBinIngredients').value = batch.ingredients || '';
            document.getElementById('opEditOilBinLetrerage').value = batch.letrerage != null ? batch.letrerage : '';
            document.getElementById('opEditOilBinFfa').value = batch.ffa != null ? batch.ffa : '';
            var modalEl = document.getElementById('opEditOilBinBatchModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
        },

        saveEditOilBinBatch: async function () {
            var scope = _oilProductionGrid;
            var idEl = document.getElementById('opEditOilBinBatchId');
            var id = idEl && idEl.value ? idEl.value.trim() : null;
            if (!id) return;
            var shifts = (document.getElementById('opEditOilBinShifts') && document.getElementById('opEditOilBinShifts').value) || '';
            var ingredients = (document.getElementById('opEditOilBinIngredients') && document.getElementById('opEditOilBinIngredients').value) || '';
            var letrerageRaw = document.getElementById('opEditOilBinLetrerage') && document.getElementById('opEditOilBinLetrerage').value;
            var ffaRaw = document.getElementById('opEditOilBinFfa') && document.getElementById('opEditOilBinFfa').value;
            var letrerage = letrerageRaw === '' || letrerageRaw === null ? null : parseFloat(letrerageRaw);
            var ffa = ffaRaw === '' || ffaRaw === null ? null : parseFloat(ffaRaw);
            if (isNaN(letrerage)) letrerage = null;
            if (isNaN(ffa)) ffa = null;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.updateOilBinBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                return;
                }
                var result = await dataFunctions.updateOilBinBatch({ id: id, shifts: shifts, ingredients: ingredients, letrerage: letrerage, ffa: ffa }, null);
                if (result && result.success) {
                    var modalEl = document.getElementById('opEditOilBinBatchModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Oil bin batch updated.', timer: 2000, showConfirmButton: false });
                    scope.loadOilBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Update failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] saveEditOilBinBatch:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Update failed', 'error');
            }
        },

        showProductionDataModal: async function (oilId) {
            var scope = _oilProductionGrid;
            var row = (scope.rawIngredients || []).find(function (o) { return o.id === oilId; });
            if (!row && typeof dataFunctions !== 'undefined' && dataFunctions.getOilBatchById) {
                try { row = await dataFunctions.getOilBatchById(oilId, null); } catch (e) { console.error('[Oil Production] getOilBatchById:', e); }
            }
            document.getElementById('opProductionDataOilId').value = oilId || '';
            document.getElementById('opProductionDataBatchNumber').textContent = (row && row.batch_id) ? row.batch_id : (oilId ? 'Loading…' : '—');
            scope.loadProductionDataFormFromRow(row || {});
            var modalEl = document.getElementById('opProductionDataModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            if (!row && oilId && typeof dataFunctions !== 'undefined' && dataFunctions.getOilBatchById) {
                try {
                    row = await dataFunctions.getOilBatchById(oilId, null);
                    document.getElementById('opProductionDataBatchNumber').textContent = (row && row.batch_id) ? row.batch_id : oilId;
                    scope.loadProductionDataFormFromRow(row || {});
                } catch (e) { console.error('[Oil Production] getOilBatchById:', e); }
            }
        },

        loadProductionDataFormFromRow: function (row) {
            var pd = (row.production_data && typeof row.production_data === 'object') ? row.production_data : {};
            var batchProduced = pd.batch_number_product_produced || row.batch_id || '';
            document.getElementById('opPdBatchProduced').value = batchProduced;
            document.getElementById('opPdNameOfProduct').value = pd.name_of_product || row.name_of_product || '';
            document.getElementById('opPdShiftSupervisor').value = pd.shift_supervisor || row.shift_supervisor || '';
            document.getElementById('opPdShift').value = pd.shift || row.shift || '';
            var rmLines = Array.isArray(pd.raw_materials) ? pd.raw_materials : [];
            var rmLinesEmpty = rmLines.length === 0;
            if (rmLinesEmpty) rmLines = [{}];
            var tbody = document.getElementById('opPdRawMaterialsBody');
            if (tbody) {
                tbody.innerHTML = '';
                rmLines.forEach(function (rm) {
                    tbody.appendChild(_oilProductionGrid.makeRawMaterialRow(rm.batch_number || '', rm.weight_raw_in != null ? rm.weight_raw_in : '', rm.weight_oil_out != null ? rm.weight_oil_out : '', rm.weight_cake_out != null ? rm.weight_cake_out : ''));
                });
            }
            var binLines = Array.isArray(pd.oil_bin_details) ? pd.oil_bin_details : [];
            var binLinesEmpty = binLines.length === 0;
            if (binLinesEmpty) binLines = [{}];
            var binBody = document.getElementById('opPdOilBinDetailsBody');
            if (binBody) {
                binBody.innerHTML = '';
                binLines.forEach(function (b) {
                    binBody.appendChild(_oilProductionGrid.makeOilBinDetailRow(b.ibc_bn || '', b.literage != null ? b.literage : '', b.start_time || '', b.end_time || ''));
                });
            }
            var waste = pd.waste && typeof pd.waste === 'object' ? pd.waste : {};
            document.getElementById('opPdWasteGeneral').value = waste.general_waste != null ? waste.general_waste : '';
            document.getElementById('opPdWasteFloor').value = waste.floor_waste != null ? waste.floor_waste : '';
            document.getElementById('opPdWasteProduct').value = waste.product_waste != null ? waste.product_waste : '';
        },

        makeRawMaterialRow: function (batchNumber, weightIn, oilOut, cakeOut) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td><input type="text" class="form-control form-control-sm op-pd-rm-batch" placeholder="e.g. OIL-2026-03-001"></td>' +
                '<td><input type="number" class="form-control form-control-sm op-pd-rm-weight-in" step="0.01" placeholder="0"></td>' +
                '<td><input type="number" class="form-control form-control-sm op-pd-rm-oil-out" step="0.01" placeholder="0"></td>' +
                '<td><input type="number" class="form-control form-control-sm op-pd-rm-cake-out" step="0.01" placeholder="0"></td>' +
                '<td><button type="button" class="btn btn-sm btn-danger op-pd-remove-row" title="Remove"><i class="fas fa-times"></i></button></td>';
            tr.querySelector('.op-pd-rm-batch').value = batchNumber;
            tr.querySelector('.op-pd-rm-weight-in').value = weightIn;
            tr.querySelector('.op-pd-rm-oil-out').value = oilOut;
            tr.querySelector('.op-pd-rm-cake-out').value = cakeOut;
            tr.querySelector('.op-pd-remove-row').addEventListener('click', function () { tr.remove(); });
            return tr;
        },

        makeOilBinDetailRow: function (ibcBn, literage, startTime, endTime) {
            var tr = document.createElement('tr');
            tr.innerHTML = '<td><input type="text" class="form-control form-control-sm op-pd-bin-ibc" placeholder="IBC 1"></td>' +
                '<td><input type="number" class="form-control form-control-sm op-pd-bin-literage" step="0.01" placeholder="0"></td>' +
                '<td><input type="text" class="form-control form-control-sm op-pd-bin-start" placeholder="08:00"></td>' +
                '<td><input type="text" class="form-control form-control-sm op-pd-bin-end" placeholder="16:00"></td>' +
                '<td><button type="button" class="btn btn-sm btn-danger op-pd-remove-row" title="Remove"><i class="fas fa-times"></i></button></td>';
            tr.querySelector('.op-pd-bin-ibc').value = ibcBn;
            tr.querySelector('.op-pd-bin-literage').value = literage;
            tr.querySelector('.op-pd-bin-start').value = startTime;
            tr.querySelector('.op-pd-bin-end').value = endTime;
            tr.querySelector('.op-pd-remove-row').addEventListener('click', function () { tr.remove(); });
            return tr;
        },

        addProductionDataRawMaterialRow: function () {
            var tbody = document.getElementById('opPdRawMaterialsBody');
            if (tbody) tbody.appendChild(_oilProductionGrid.makeRawMaterialRow('', '', '', ''));
        },

        addProductionDataOilBinDetailRow: function () {
            var binBody = document.getElementById('opPdOilBinDetailsBody');
            if (binBody) binBody.appendChild(_oilProductionGrid.makeOilBinDetailRow('', '', '', ''));
        },

        collectProductionDataForm: function () {
            var pd = {};
            pd.batch_number_product_produced = (document.getElementById('opPdBatchProduced') && document.getElementById('opPdBatchProduced').value) ? document.getElementById('opPdBatchProduced').value.trim() : '';
            pd.name_of_product = (document.getElementById('opPdNameOfProduct') && document.getElementById('opPdNameOfProduct').value) ? document.getElementById('opPdNameOfProduct').value.trim() : '';
            pd.shift_supervisor = (document.getElementById('opPdShiftSupervisor') && document.getElementById('opPdShiftSupervisor').value) ? document.getElementById('opPdShiftSupervisor').value.trim() : '';
            pd.shift = (document.getElementById('opPdShift') && document.getElementById('opPdShift').value) ? document.getElementById('opPdShift').value.trim() : '';
            var rmLines = [];
            document.querySelectorAll('#opPdRawMaterialsBody tr').forEach(function (tr) {
                var batch = tr.querySelector('.op-pd-rm-batch') && tr.querySelector('.op-pd-rm-batch').value ? tr.querySelector('.op-pd-rm-batch').value.trim() : '';
                var wIn = tr.querySelector('.op-pd-rm-weight-in') && tr.querySelector('.op-pd-rm-weight-in').value;
                var oOut = tr.querySelector('.op-pd-rm-oil-out') && tr.querySelector('.op-pd-rm-oil-out').value;
                var cOut = tr.querySelector('.op-pd-rm-cake-out') && tr.querySelector('.op-pd-rm-cake-out').value;
                if (batch || wIn || oOut || cOut) rmLines.push({ batch_number: batch, weight_raw_in: wIn ? parseFloat(wIn) : null, weight_oil_out: oOut ? parseFloat(oOut) : null, weight_cake_out: cOut ? parseFloat(cOut) : null });
            });
            pd.raw_materials = rmLines;
            var binLines = [];
            document.querySelectorAll('#opPdOilBinDetailsBody tr').forEach(function (tr) {
                var ibc = tr.querySelector('.op-pd-bin-ibc') && tr.querySelector('.op-pd-bin-ibc').value ? tr.querySelector('.op-pd-bin-ibc').value.trim() : '';
                var lit = tr.querySelector('.op-pd-bin-literage') && tr.querySelector('.op-pd-bin-literage').value;
                var st = tr.querySelector('.op-pd-bin-start') && tr.querySelector('.op-pd-bin-start').value ? tr.querySelector('.op-pd-bin-start').value.trim() : '';
                var en = tr.querySelector('.op-pd-bin-end') && tr.querySelector('.op-pd-bin-end').value ? tr.querySelector('.op-pd-bin-end').value.trim() : '';
                if (ibc || lit || st || en) binLines.push({ ibc_bn: ibc, literage: lit ? parseFloat(lit) : null, start_time: st || null, end_time: en || null });
            });
            pd.oil_bin_details = binLines;
            var wg = document.getElementById('opPdWasteGeneral') && document.getElementById('opPdWasteGeneral').value;
            var wf = document.getElementById('opPdWasteFloor') && document.getElementById('opPdWasteFloor').value;
            var wp = document.getElementById('opPdWasteProduct') && document.getElementById('opPdWasteProduct').value;
            pd.waste = { general_waste: wg ? parseFloat(wg) : null, floor_waste: wf ? parseFloat(wf) : null, product_waste: wp ? parseFloat(wp) : null };
            return pd;
        },

        saveProductionData: async function () {
            var scope = _oilProductionGrid;
            var oilIdEl = document.getElementById('opProductionDataOilId');
            var oilId = oilIdEl && oilIdEl.value ? oilIdEl.value.trim() : null;
            if (!oilId) return;
            var formPd = scope.collectProductionDataForm();
            var currentRow = (scope.rawIngredients || []).find(function (o) { return o.id === oilId; });
            if (!currentRow && typeof dataFunctions !== 'undefined' && dataFunctions.getOilBatchById) {
                try { currentRow = await dataFunctions.getOilBatchById(oilId, null); } catch (e) { }
            }
            var existingPd = (currentRow && currentRow.production_data && typeof currentRow.production_data === 'object') ? currentRow.production_data : {};
            var mergedPd = Object.assign({}, existingPd, formPd);
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.upsertOilBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.upsertOilBatch({ oil_id: oilId, production_data: mergedPd }, null);
                if (result && result.success !== false && !result.error) {
                    var modalEl = document.getElementById('opProductionDataModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Production data updated.', timer: 2000, showConfirmButton: false });
                    scope.loadRawIngredients(true);
                    scope.loadOilBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] saveProductionData:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
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
