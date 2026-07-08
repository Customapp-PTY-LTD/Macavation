/**
 * Oil Production: raw ingredients in production, production sheets, oil bin batches.
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

    function normalizeOilBinBatches(raw) {
        if (Array.isArray(raw)) return raw;
        if (raw && raw.get_oil_bin_batches && Array.isArray(raw.get_oil_bin_batches)) return raw.get_oil_bin_batches;
        if (raw && raw.data && raw.data.get_oil_bin_batches && Array.isArray(raw.data.get_oil_bin_batches)) return raw.data.get_oil_bin_batches;
        if (raw && raw.data && Array.isArray(raw.data)) return raw.data;
        if (raw && raw.rows && Array.isArray(raw.rows)) return raw.rows;
        if (raw && raw.result && Array.isArray(raw.result)) return raw.result;
        if (raw && raw.records && Array.isArray(raw.records)) return raw.records;
        return [];
    }

    function normalizeProteinBinBatches(raw) {
        if (Array.isArray(raw)) return raw;
        if (raw && raw.get_protein_bin_batches && Array.isArray(raw.get_protein_bin_batches)) return raw.get_protein_bin_batches;
        if (raw && raw.data && raw.data.get_protein_bin_batches && Array.isArray(raw.data.get_protein_bin_batches)) return raw.data.get_protein_bin_batches;
        if (raw && raw.data && Array.isArray(raw.data)) return raw.data;
        if (raw && raw.rows && Array.isArray(raw.rows)) return raw.rows;
        if (raw && raw.result && Array.isArray(raw.result)) return raw.result;
        return [];
    }

    function normalizeProteinBinBatchRow(b) {
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
            start_date: b.start_date != null ? b.start_date : b.startDate,
            ingredients: b.ingredients,
            batch_weight_kg: b.batch_weight_kg != null ? b.batch_weight_kg : b.batchWeightKg,
            status: b.status,
            stock_lot_id: b.stock_lot_id != null ? b.stock_lot_id : b.stockLotId,
            raw_ingredient_audit: audit,
            created_at: b.created_at != null ? b.created_at : b.createdAt
        };
    }

    /** Grade column: Lambda may camelCase, duplicate as `grade`, or strip `oil_stream` */
    function pickOilStreamField(b) {
        if (!b || typeof b !== 'object') return null;
        var v = b.oil_stream != null ? b.oil_stream : b.oilStream;
        if (v == null || v === '') v = b.grade != null ? b.grade : b.Grade;
        if (v == null || v === '') v = b.product_line != null ? b.product_line : b.productLine;
        if (v != null && String(v).trim() !== '') return v;
        var k;
        for (k in b) {
            if (!Object.prototype.hasOwnProperty.call(b, k)) continue;
            if (/^oil_?stream$/i.test(k) && b[k] != null && String(b[k]).trim() !== '') return b[k];
        }
        return null;
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
            duty_shift_name: b.duty_shift_name != null ? b.duty_shift_name : b.dutyShiftName,
            oil_stream: pickOilStreamField(b),
            ffa_test_at: b.ffa_test_at != null ? b.ffa_test_at : b.ffaTestAt,
            ffa_test_pass: (function () {
                var p = b.ffa_test_pass !== undefined && b.ffa_test_pass !== null ? b.ffa_test_pass : b.ffaTestPass;
                if (p === true || p === false) return p;
                if (p === 'true' || p === 1) return true;
                if (p === 'false' || p === 0) return false;
                return null;
            })()
        };
    }

    function pickFfaTestAt(b) {
        return b && (b.ffa_test_at != null ? b.ffa_test_at : b.ffaTestAt);
    }

    function pickFfaTestPass(b) {
        if (!b) return null;
        if (b.ffa_test_pass === true || b.ffa_test_pass === false) return b.ffa_test_pass;
        if (b.ffaTestPass === true || b.ffaTestPass === false) return b.ffaTestPass;
        return null;
    }

    /** HTML snippet for FFA test column (status + optional button added in row builder) */
    function formatFfaTestStatusHtml(b) {
        var at = pickFfaTestAt(b);
        var pass = pickFfaTestPass(b);
        if (!at && pass == null) {
            return '<span class="text-muted small">Not tested</span>';
        }
        var d = '';
        try {
            if (at) d = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
        } catch (e) { d = ''; }
        var badge = pass === true ? '<span class="badge bg-success">Pass</span>' : pass === false ? '<span class="badge bg-danger">Fail</span>' : '<span class="badge bg-secondary">Recorded</span>';
        return '<div class="d-flex flex-column gap-1">' + badge + (d ? '<span class="text-muted small">' + escapeHtml(d) + '</span>' : '') + '</div>';
    }

    function formatOilStreamLabel(s) {
        if (!s) return '—';
        var v = String(s).toLowerCase();
        if (v === 'food_grade') return 'Food grade';
        if (v === 'cosmetic') return 'Cosmetic';
        return String(s);
    }

    /** Supplier name on raw ingredient bag (stored in oil.intake_data). */
    function supplierLabelFromOil(o) {
        if (!o || typeof o !== 'object') return '';
        var intake = o.intake_data || {};
        var s = intake.supplier || intake.supplier_details;
        return s ? String(s).trim() : '';
    }

    /** Official bag FFA from supplier intake (first sample test); mirrors oil.intake_data.official_ffa / ffa. */
    function officialBagFfaFromOil(o) {
        if (!o || typeof o !== 'object') return null;
        var intake = o.intake_data || {};
        if (typeof intake === 'string') {
            try { intake = JSON.parse(intake); } catch (e1) { intake = {}; }
        }
        var v = intake.official_ffa != null ? intake.official_ffa : intake.ffa;
        if (v == null || v === '') return null;
        var n = Number(v);
        return isNaN(n) ? null : n;
    }

    /** Intake JSON may be a string from some API shapes. */
    function parseIntakeJson(intake) {
        if (!intake || typeof intake !== 'object') return {};
        if (typeof intake === 'string') {
            try { return JSON.parse(intake); } catch (e) { return {}; }
        }
        return intake;
    }

    /** Receiving weight (first weigh at intake). After release to production, stored in weight_at_intake_for_comparison_kg. */
    function receivingKgFromIntake(intake) {
        intake = parseIntakeJson(intake);
        var w = intake.weight_at_intake_for_comparison_kg;
        if (w != null && w !== '' && !isNaN(Number(w))) return Number(w);
        var q = intake.quantity_kg != null ? intake.quantity_kg : (intake.items && intake.items[0] && intake.items[0].quantity_kg);
        return q != null && !isNaN(Number(q)) ? Number(q) : null;
    }

    /** Operational weight on the batch (second weigh = before production) once released; same as receiving until then. */
    function operationalKgFromIntake(intake) {
        intake = parseIntakeJson(intake);
        var q = intake.quantity_kg != null ? intake.quantity_kg : (intake.items && intake.items[0] && intake.items[0].quantity_kg);
        return q != null && !isNaN(Number(q)) ? Number(q) : null;
    }

    /** Primary cell: operational kg; sub-line when receiving (first weigh) differs. */
    function formatKgPairHtml(intake) {
        var op = operationalKgFromIntake(intake);
        var recv = receivingKgFromIntake(intake);
        if (op == null && recv == null) return '—';
        var line = op != null ? (escapeHtml(String(op)) + ' kg') : '—';
        if (recv != null && op != null && Math.abs(Number(recv) - Number(op)) > 0.0001) {
            line += '<span class="text-muted small d-block">Receiving: ' + escapeHtml(String(recv)) + ' kg</span>';
        }
        return line;
    }

    /** Same shape as DB get_oil_production_raw_ingredients_snapshot() for raw_ingredient_audit */
    function buildRawIngredientAuditEntry(o) {
        if (!o || typeof o !== 'object') return null;
        var intake = o.intake_data || {};
        var qty = operationalKgFromIntake(intake);
        var recv = receivingKgFromIntake(intake);
        var pt = intake.product_type || (o.name_of_product && String(o.name_of_product));
        var sup = supplierLabelFromOil(o);
        return {
            oil_id: o.id,
            batch_id: o.batch_id,
            quantity_kg: qty != null ? qty : null,
            weight_at_intake_for_comparison_kg: recv != null ? recv : null,
            product_type: pt ? String(pt).trim() : '',
            supplier: sup || null,
            ffa: officialBagFfaFromOil(o)
        };
    }

    function rawIngredientAuditCount(b) {
        var a = b && b.raw_ingredient_audit;
        if (!a) return 0;
        return Array.isArray(a) ? a.length : 0;
    }

    /**
     * Merge saved audit with current modal: keep entries for oils no longer in the production list;
     * for rows in production, use checked boxes only (fresh snapshot). Allows adding more links later.
     */
    function mergeRawIngredientAuditForBin(batch, rowsMap, checkedOilIdSet) {
        var productionIds = new Set(Object.keys(rowsMap));
        var out = [];
        var existing = batch && Array.isArray(batch.raw_ingredient_audit) ? batch.raw_ingredient_audit : [];
        existing.forEach(function (e) {
            var oid = e && (e.oil_id != null ? String(e.oil_id) : (e.oilId != null ? String(e.oilId) : ''));
            if (!oid) return;
            if (!productionIds.has(oid)) {
                out.push(e);
            }
        });
        checkedOilIdSet.forEach(function (oid) {
            var o = rowsMap[oid];
            if (!o) return;
            var entry = buildRawIngredientAuditEntry(o);
            if (entry) out.push(entry);
        });
        out.sort(function (a, b) {
            var ba = (a && a.batch_id != null ? String(a.batch_id) : '');
            var bb = (b && b.batch_id != null ? String(b.batch_id) : '');
            return ba.localeCompare(bb);
        });
        return out;
    }

    /** Read-only line for saved audit rows not on the current production floor (bag emptied, etc.). */
    function htmlForAuditOnlyIngredientRow(row) {
        if (!row || typeof row !== 'object') return '';
        var bid = row.batch_id != null ? String(row.batch_id) : '—';
        var sup = row.supplier ? String(row.supplier) : '';
        var pt = row.product_type ? String(row.product_type).replace(/_/g, ' ') : '—';
        var synthetic = {
            quantity_kg: row.quantity_kg,
            weight_at_intake_for_comparison_kg: row.weight_at_intake_for_comparison_kg
        };
        var line = '<strong>' + escapeHtml(bid) + '</strong>';
        if (sup) line += ' <span class="text-muted small">(' + escapeHtml(sup) + ')</span>';
        line += ' — ' + escapeHtml(pt);
        var ffa = row.ffa != null ? row.ffa : null;
        if (ffa != null && ffa !== '') line += ' <span class="text-muted">· FFA ' + escapeHtml(String(ffa)) + '%</span>';
        var wHtml = formatKgPairHtml(synthetic);
        if (wHtml !== '—') line += ' <span class="ms-1">' + wHtml + '</span>';
        return '<div class="py-1 border-bottom op-link-ing-audit-only mb-0 small">' + line + '</div>';
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

    function getProductionSheetEntriesForType(tracking, sheetType) {
        if (!tracking || typeof tracking !== 'object') return [];
        var prodSheets = tracking.production_sheets;
        if (!prodSheets || typeof prodSheets !== 'object') return [];
        var slot = prodSheets[sheetType];
        if (!slot) return [];
        if (Array.isArray(slot)) return slot;
        return [slot];
    }

    return {
        rawIngredients: [],
        rawIngredientsFinished: [],
        oilBinBatches: [],
        /** Full list (all statuses) for View data modal; main grid uses only in_production */
        oilBinBatchesReport: null,
        /** Map oil id string → raw oil row while Link ingredients modal is open */
        _linkIngredientsOilRows: {},
        proteinBinBatches: [],
        consolidatedBatches: [],
        oilSearchResults: [],
        _linkProteinIngredientsOilRows: {},
        currentProductionSheetDate: null,

        init: function () {
            var scope = _oilProductionGrid;
            scope.bindEvents();
            scope.loadAll();
        },

        bindEvents: function () {
            var scope = _oilProductionGrid;
            $('#opRefreshBtn').off('click').on('click', function () { scope.loadAll(true); });
            $('#opViewDataBtn').off('click').on('click', function () { scope.showViewDataModal(); });
            $(document).on('click', '.op-production-sheet-btn', function () {
                var type = $(this).data('sheet-type');
                if (type) scope.showProductionSheetModal(type, { sourceLabel: $(this).data('source-label') || null });
            });
            $('input[name="opProdSheetMode"]').on('change', function () {
                var upload = $('#opProdSheetModeUpload').is(':checked');
                $('#opProdSheetFormSection').toggle(!upload);
                $('#opProdSheetUploadSection').toggle(upload);
            });
            $('#opProdSheetSubmitBtn').off('click').on('click', function () { scope.submitProductionSheet(); });
            $(document).on('change', '#opProdSheetFormBody [name="op_ps_date"]', function () {
                var iso = toISO(this.value || '');
                if (iso) scope.refreshProductionSheetDateInfo(iso);
            });
            $('#opStartOilBinBtn').off('click').on('click', function () { scope.startOilBin(); });
            $('#opOilSearchBtn').off('click').on('click', function () { scope.runOilBatchSearch(); });
            $('#opOilSearchInput').off('keydown').on('keydown', function (e) { if (e.key === 'Enter') scope.runOilBatchSearch(); });
            $('#opCreateConsolidatedBtn').off('click').on('click', function () { scope.promptCreateConsolidatedBatch(); });
            $(document).on('click', '.op-edit-consolidated-btn', function () {
                var id = $(this).data('consolidated-id');
                var row = (scope.consolidatedBatches || []).find(function (c) { return String(c.id) === String(id); });
                if (row) scope.promptEditConsolidatedBatch(row);
            });
            $(document).on('click', '.op-add-member-search-btn', function () {
                var oilId = $(this).data('oil-id');
                var consolidatedId = $(this).data('consolidated-id');
                if (oilId && consolidatedId) scope.addConsolidatedMember(consolidatedId, oilId);
            });
            $(document).on('click', '.op-send-oil-bin-to-stock', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-bin-batch-id');
                if (id) scope.sendOilBinBatchToStock(id);
            });
            $(document).on('click', '.op-delete-oil-bin-batch', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-bin-batch-id');
                if (id) scope.deleteOilBinBatch(id);
            });
            $(document).on('click', '.op-edit-oil-bin-batch', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-bin-batch-id');
                if (id) scope.showEditOilBinBatchModal(id);
            });
            $('#opEditOilBinBatchSaveBtn').off('click').on('click', function () { scope.saveEditOilBinBatch(); });
            $(document).on('click', '.op-ffa-test-btn', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-bin-batch-id');
                if (id) scope.showFfaTestModal(id);
            });
            $('#opFfaTestSaveBtn').off('click').on('click', function () { scope.saveFfaTest(); });
            $('#opFfaTestPct, #opFfaTestMax').off('input').on('input', function () { scope.syncOpFfaTestPass(); });
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
            $(document).on('click', '.op-link-ingredients-btn', function (e) {
                e.preventDefault();
                var id = $(this).data('oil-bin-batch-id');
                if (id) scope.showLinkIngredientsModal(id);
            });
            $('#opLinkIngredientsSaveBtn').off('click').on('click', function () { scope.saveLinkIngredients(); });
            $('#opLinkIngredientsSelectAll').off('click').on('click', function () {
                document.querySelectorAll('#opLinkIngredientsList .op-link-ing-cb').forEach(function (c) { c.checked = true; });
            });
            $('#opLinkIngredientsClear').off('click').on('click', function () {
                document.querySelectorAll('#opLinkIngredientsList .op-link-ing-cb').forEach(function (c) { c.checked = false; });
            });
            $('#opStartProteinBinBtn').off('click').on('click', function () { scope.startProteinBin(); });
            $(document).on('click', '.op-link-protein-ingredients-btn', function (e) {
                e.preventDefault();
                var id = $(this).data('protein-bin-batch-id');
                if (id) scope.showLinkProteinIngredientsModal(id);
            });
            $('#opProteinLinkIngredientsSaveBtn').off('click').on('click', function () { scope.saveLinkProteinIngredients(); });
            $('#opProteinLinkIngredientsSelectAll').off('click').on('click', function () {
                document.querySelectorAll('#opProteinLinkIngredientsList .op-protein-link-ing-cb').forEach(function (c) { c.checked = true; });
            });
            $('#opProteinLinkIngredientsClear').off('click').on('click', function () {
                document.querySelectorAll('#opProteinLinkIngredientsList .op-protein-link-ing-cb').forEach(function (c) { c.checked = false; });
            });
            $(document).on('click', '.op-send-protein-bin-to-stock', function (e) {
                e.preventDefault();
                var id = $(this).data('protein-bin-batch-id');
                if (id) scope.sendProteinBinBatchToStock(id);
            });
        },

        showProductionSheetModal: function (sheetType, options) {
            var scope = _oilProductionGrid;
            options = options || {};
            var titles = { food_grade_oil: 'Macadamia Food Grade Production sheet (MP5.2.3.1 Rev 04)', protein_powder: 'Macadamia Food Grade Production sheet for Protein Powder (MP5.2.3.5 Rev 01)', cosmetic_oil: 'Macadamia Cosmetic Oil Production Sheet (MP5.2.3 Rev 06)' };
            var el = document.getElementById('opProductionSheetModalLabel');
            if (el) el.textContent = (titles[sheetType] || 'Production sheet').replace('Production sheet', 'Add Production Sheet');
            var typeEl = document.getElementById('opProductionSheetType');
            if (typeEl) typeEl.value = sheetType;
            scope.buildProductionSheetForm(sheetType);
            $('#opProdSheetModeForm').prop('checked', true);
            $('#opProdSheetFormSection').show();
            $('#opProdSheetUploadSection').hide();
            $('#opProdSheetFileInput').val('');
            $('#opProdSheetUploadStatus').text('');
            var firstDate = document.querySelector('#opProdSheetFormBody [name="op_ps_date"]');
            var todayIso = new Date().toISOString().split('T')[0];
            if (firstDate) firstDate.value = fromISO(todayIso);
            scope.currentProductionSheetDate = todayIso;
            scope.refreshProductionSheetDateInfo(todayIso, options.sourceLabel || null);
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
                html +=                 section('Date and supervisory details',
                    fieldRow('Date', 'op_ps_date', 'text', '', 'flatpickr-date') + fieldRow('Period', 'op_ps_shift') + fieldRow('Supervisor', 'op_ps_shift_supervisor') + fieldRow('Signature', 'op_ps_signature'));
                html += section('Product and batch information',
                    fieldRow('Batch Number of Product Produced', 'op_ps_batch_product', 'text', 'wide') +
                    fieldRow('Name of product produced', 'op_ps_name_product', 'text', 'wide') +
                    fieldRow('Start Oil BN (Litre)', 'op_ps_start_oil_bn', 'number') +
                    fieldRow('IBC 1 BN (Litre)', 'op_ps_ibc1', 'number') +
                    fieldRow('IBC 2 BN (Litre)', 'op_ps_ibc2', 'number') +
                    fieldRow('IBC 3 BN (Litre)', 'op_ps_ibc3', 'number'));
                html += section('Main production data',
                    '<div class="op-ps-table-wrap"><table class="table align-middle op-ps-table"><thead><tr><th>Batch number of Raw material used</th><th>Weight of Raw material in (kg)</th><th>Weight of Oil out (kg)</th><th>Weight of Cake out (kg)</th></tr></thead><tbody id="opProdSheetTableFoodGrade"></tbody></table></div><button type="button" class="btn btn-sm btn-outline-secondary op-ps-add-row" data-sheet="food_grade_oil">Add row</button>');
                html += section('Comments', '<textarea class="form-control" name="op_ps_comments" rows="2" placeholder="Comments"></textarea>');
                html += section('Waste at end of run', fieldRow('General waste (kg)', 'op_ps_waste_general', 'number') + fieldRow('Floor waste (kg)', 'op_ps_waste_floor', 'number') + fieldRow('Product waste (kg)', 'op_ps_waste_product', 'number'));
                html += '<div class="op-ps-doc-ref">MP5.2.3.1 Rev 04 &nbsp; Date issued: 09.12.2025</div>';
                html += '</div>';
            } else if (sheetType === 'protein_powder') {
                html += '<div class="op-ps-paper">';
                html += '<div class="op-ps-doc-title">Macadamia Food Grade Production sheet for Protein Powder</div>';
                html +=                 section('Date and supervisory details',
                    fieldRow('Date', 'op_ps_date', 'text', '', 'flatpickr-date') + fieldRow('Period', 'op_ps_shift') + fieldRow('Press', 'op_ps_press') + fieldRow('Supervisor', 'op_ps_shift_supervisor') + fieldRow('Signature', 'op_ps_signature'));
                html += section('Product and batch information',
                    fieldRow('Batch Number of Product Produced', 'op_ps_batch_product', 'text', 'wide') +
                    fieldRow('Batch number and Name of Oil produced', 'op_ps_batch_name_oil', 'text', 'wide') +
                    fieldRow('Name of product produced', 'op_ps_name_product', 'text', 'wide'));
                html += section('Run details',
                    fieldRow('Start time', 'op_ps_start_time') + fieldRow('End time', 'op_ps_end_time') + fieldRow('Temperature', 'op_ps_temperature', 'number') + fieldRow('Speed for infeed', 'op_ps_speed_infeed') + fieldRow('Speed for Press', 'op_ps_speed_press'));
                html += section('Main production data',
                    '<div class="op-ps-table-wrap"><table class="table align-middle op-ps-table"><thead><tr><th>Batch number of Raw material used</th><th>Weight of Raw material in (kg)</th><th>Weight of cake out (kg)</th><th>Total weight of Protein Powder hammermilled (kg)</th></tr></thead><tbody id="opProdSheetTableProtein"></tbody></table></div><button type="button" class="btn btn-sm btn-outline-secondary op-ps-add-row" data-sheet="protein_powder">Add row</button>');
                html += section('Comments', '<textarea class="form-control" name="op_ps_comments" rows="2" placeholder="Comments"></textarea>');
                html += section('Waste at end of run', fieldRow('General waste (kg)', 'op_ps_waste_general', 'number') + fieldRow('Floor waste (kg)', 'op_ps_waste_floor', 'number') + fieldRow('Product waste (kg)', 'op_ps_waste_product', 'number'));
                html += '<div class="op-ps-doc-ref">MP5.2.3.5 Rev 01</div>';
                html += '</div>';
            } else if (sheetType === 'cosmetic_oil') {
                html += '<div class="op-ps-paper">';
                html += '<div class="op-ps-doc-title">Macadamia Cosmetic Oil Production Sheet</div>';
                html +=                 section('Date and supervisory details',
                    fieldRow('Date', 'op_ps_date', 'text', '', 'flatpickr-date') + fieldRow('Period', 'op_ps_shift') + fieldRow('Supervisor', 'op_ps_shift_supervisor') + fieldRow('Signature', 'op_ps_signature') + fieldRow('Start Oil BN', 'op_ps_start_oil_bn'));
                html += section('Production log (time, quantities kg)',
                    '<div class="op-ps-table-wrap"><table class="table align-middle op-ps-table"><thead><tr><th>No.</th><th>Time</th><th>Crude kernel</th><th>Kernel dust</th><th>Crush</th><th>Cracker dust</th><th>Cake</th><th>Raw Material Traceability – Description</th><th>Batch #</th></tr></thead><tbody id="opProdSheetTableCosmetic"></tbody></table></div><button type="button" class="btn btn-sm btn-outline-secondary op-ps-add-row" data-sheet="cosmetic_oil">Add row</button>');
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

        refreshProductionSheetDateInfo: async function (iso, sourceLabel) {
            var scope = _oilProductionGrid;
            scope.currentProductionSheetDate = iso || null;
            var infoEl = document.getElementById('opProdSheetDateInfo');
            var sheetType = document.getElementById('opProductionSheetType') && document.getElementById('opProductionSheetType').value;
            if (!infoEl || !sheetType || !iso) return;
            infoEl.style.display = '';
            infoEl.innerHTML = 'Checking existing sheets for <strong>' + escapeHtml(fromISO(iso)) + '</strong>…';
            try {
                var rawList = await dataFunctions.getShiftList({ date_from: iso, date_to: iso, limit: 10 }, null, true);
                var list = normalizeShiftList(rawList);
                var existing = list && list[0] ? list[0] : null;
                var entries = getProductionSheetEntriesForType(existing && existing.shift_tracking, sheetType);
                var msg = 'Adding a new production sheet for <strong>' + escapeHtml(fromISO(iso)) + '</strong>.';
                if (sourceLabel) msg += ' Source: <strong>' + escapeHtml(String(sourceLabel)) + '</strong>.';
                if (entries.length > 0) {
                    msg += ' This date already has <strong>' + entries.length + '</strong> attached ' + (entries.length === 1 ? 'sheet' : 'sheets') + ' for this type.';
                } else {
                    msg += ' No sheets are attached for this type yet.';
                }
                var prevDate = new Date(iso + 'T12:00:00');
                prevDate.setDate(prevDate.getDate() - 1);
                var prevIso = prevDate.toISOString().split('T')[0];
                var prevRaw = await dataFunctions.getShiftList({ date_from: prevIso, date_to: prevIso, limit: 10 }, null, true);
                var prevList = normalizeShiftList(prevRaw);
                var prevExisting = prevList && prevList[0] ? prevList[0] : null;
                var prevEntries = getProductionSheetEntriesForType(prevExisting && prevExisting.shift_tracking, sheetType);
                if (prevEntries.length > 0) {
                    msg += ' Yesterday (' + escapeHtml(fromISO(prevIso)) + ') has <strong>' + prevEntries.length + '</strong> attached ' + (prevEntries.length === 1 ? 'sheet' : 'sheets') + '.';
                }
                infoEl.innerHTML = msg;
            } catch (e) {
                console.warn('[Oil Production] refreshProductionSheetDateInfo:', e);
                infoEl.innerHTML = 'Adding a new production sheet for <strong>' + escapeHtml(fromISO(iso)) + '</strong>.';
            }
        },

        submitProductionSheet: async function () {
            var scope = _oilProductionGrid;
            var sheetType = document.getElementById('opProductionSheetType') && document.getElementById('opProductionSheetType').value;
            if (!sheetType) return;
            var uploadMode = $('#opProdSheetModeUpload').is(':checked');
            var dateInput = document.querySelector('#opProdSheetFormBody [name="op_ps_date"]');
            var supInput = document.querySelector('#opProdSheetFormBody [name="op_ps_shift_supervisor"]');
            var iso;
            if (uploadMode) {
                iso = new Date().toISOString().split('T')[0];
            } else {
                iso = toISO(dateInput && dateInput.value ? dateInput.value.trim() : '');
            }
            if (!iso) {
                if (typeof Swal !== 'undefined') Swal.fire('Warning', 'Please select a date.', 'warning');
                return;
            }
            var shift_supervisor = (supInput && supInput.value && supInput.value.trim()) ? supInput.value.trim() : '';
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
            var existing = null;
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getShiftList) {
                    var rawList = await dataFunctions.getShiftList({ date_from: iso, date_to: iso, limit: 1 }, null, true);
                    var list = normalizeShiftList(rawList);
                    existing = list && list[0] ? list[0] : null;
                }
            } catch (e) {
                console.warn('[Oil Production] submitProductionSheet getShiftList:', e);
            }
            var tracking = (existing && existing.shift_tracking && typeof existing.shift_tracking === 'object') ? Object.assign({}, existing.shift_tracking) : {};
            if (!tracking.production_sheets || typeof tracking.production_sheets !== 'object') tracking.production_sheets = {};
            var existingEntries = getProductionSheetEntriesForType(tracking, sheetType);
            existingEntries.push(gmpData);
            tracking.production_sheets[sheetType] = existingEntries;
            var payload = {
                shift_id: existing && existing.id ? existing.id : null,
                shift_date: iso,
                shift_supervisor: shift_supervisor || (existing && existing.shift_supervisor) || null,
                shift_name: null,
                shift_tracking: tracking
            };
            try {
                var result = await dataFunctions.upsertShift(payload);
                var resolved = resolveUpsertShiftResult(result);
                var ok = resolved && resolved.success !== false && !resolved.error;
                if (ok) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'Production sheet attached to ' + fromISO(iso) + '.', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('opProductionSheetModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getInstance(modalEl).hide();
                    scope.loadAll(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (resolved && (resolved.error || resolved.message)) || (result && (result.error || result.message)) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] submitProductionSheet:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
            }
        },

        loadAll: function (forceRefresh) {
            var scope = _oilProductionGrid;
            scope.loadRawIngredients(forceRefresh);
            scope.loadFinishedRawIngredients(forceRefresh);
            scope.loadOilBinBatches(forceRefresh);
            scope.loadProteinBinBatches(forceRefresh);
            scope.loadConsolidatedBatches(forceRefresh);
        },

        loadConsolidatedBatches: function () {
            var scope = _oilProductionGrid;
            if (!dataFunctions || !dataFunctions.getOilConsolidatedBatches) return;
            dataFunctions.getOilConsolidatedBatches().then(function (rows) {
                scope.consolidatedBatches = Array.isArray(rows) ? rows : [];
                scope.renderConsolidatedBatches();
            }).catch(function () {
                scope.consolidatedBatches = [];
                scope.renderConsolidatedBatches();
            });
        },

        renderConsolidatedBatches: function () {
            var el = document.getElementById('opConsolidatedBatchesList');
            if (!el) return;
            var rows = _oilProductionGrid.consolidatedBatches || [];
            if (!rows.length) {
                el.innerHTML = '<p class="text-muted mb-0">No consolidated batches yet.</p>';
                return;
            }
            el.innerHTML = rows.map(function (c) {
                return '<div class="border rounded p-3 mb-2">' +
                    '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2">' +
                    '<div><strong>' + escapeHtml(c.consolidated_number || '') + '</strong>' +
                    ' · ' + escapeHtml(c.status || '') +
                    ' · ' + (c.member_count || 0) + ' sheets · ' + Number(c.total_oil_litre || c.members_litre || 0).toFixed(1) + ' L</div>' +
                    '<button type="button" class="btn btn-sm btn-outline-primary op-edit-consolidated-btn" data-consolidated-id="' + escapeHtml(c.id || '') + '" data-action-perm="oil.consolidated.manage"><i class="fas fa-edit me-1"></i>Lab / edit</button>' +
                    '</div>' +
                    (c.lab_test_doc_ref ? '<div class="small text-muted mt-1">Lab ref: ' + escapeHtml(c.lab_test_doc_ref) + '</div>' : '') +
                    (c.lab_test_notes ? '<div class="small mt-1">' + escapeHtml(c.lab_test_notes) + '</div>' : '') +
                    '</div>';
            }).join('');
        },

        runOilBatchSearch: function () {
            var scope = _oilProductionGrid;
            var q = ($('#opOilSearchInput').val() || '').trim();
            var from = ($('#opOilSearchFrom').val() || '').trim() || null;
            var to = ($('#opOilSearchTo').val() || '').trim() || null;
            var status = ($('#opOilSearchStatus').val() || '').trim() || null;
            var out = document.getElementById('opOilSearchResults');
            if (!out || !dataFunctions.searchOilBatches) return;
            if (!q && !from && !to && !status) { out.innerHTML = '<span class="text-muted">Enter a search term or filter.</span>'; return; }
            out.innerHTML = 'Searching…';
            dataFunctions.searchOilBatches({ search: q || null, from: from, to: to, status: status }).then(function (rows) {
                scope.oilSearchResults = Array.isArray(rows) ? rows : [];
                if (!scope.oilSearchResults.length) {
                    out.innerHTML = '<span class="text-muted">No matches.</span>';
                    return;
                }
                var consolidatedOpts = (scope.consolidatedBatches || []).filter(function (c) { return c.status === 'open'; });
                out.innerHTML = scope.oilSearchResults.map(function (b) {
                    var addBtns = consolidatedOpts.map(function (c) {
                        return '<button type="button" class="btn btn-xs btn-outline-success btn-sm op-add-member-search-btn ms-1" data-oil-id="' + escapeHtml(b.id || '') + '" data-consolidated-id="' + escapeHtml(c.id || '') + '" data-action-perm="oil.consolidated.manage">+ ' + escapeHtml(c.consolidated_number || 'batch') + '</button>';
                    }).join('');
                    return '<div class="py-1 border-bottom">' + escapeHtml(b.batch_id || '') + ' · ' + escapeHtml(b.product_name || '') + ' · ' + Number(b.total_oil_litre || 0).toFixed(1) + ' L ' + addBtns + '</div>';
                }).join('');
            }).catch(function (e) {
                out.innerHTML = '<span class="text-danger">' + escapeHtml(e.message || 'Search failed') + '</span>';
            });
        },

        promptCreateConsolidatedBatch: function () {
            if (typeof hasAction === 'function' && !hasAction('oil.consolidated.manage')) {
                Swal.fire('Not permitted', 'You do not have permission to manage consolidated batches.', 'warning');
                return;
            }
            Swal.fire({
                title: 'New consolidated batch',
                input: 'text',
                inputLabel: 'Consolidated batch number',
                showCancelButton: true,
                confirmButtonText: 'Create'
            }).then(function (r) {
                if (!r.isConfirmed || !r.value) return;
                dataFunctions.upsertOilConsolidatedBatch({ consolidated_number: r.value.trim(), status: 'open' }).then(function () {
                    _oilProductionGrid.loadConsolidatedBatches();
                    Swal.fire('Created', 'Consolidated batch created.', 'success');
                });
            });
        },

        promptEditConsolidatedBatch: function (row) {
            if (typeof hasAction === 'function' && !hasAction('oil.consolidated.manage')) {
                Swal.fire('Not permitted', 'You do not have permission to manage consolidated batches.', 'warning');
                return;
            }
            Swal.fire({
                title: 'Consolidated batch — lab results',
                html: '<input id="swalConLabRef" class="swal2-input" placeholder="Lab document ref" value="' + escapeHtml(row.lab_test_doc_ref || '') + '">' +
                    '<textarea id="swalConLabNotes" class="swal2-textarea" placeholder="Lab notes">' + escapeHtml(row.lab_test_notes || '') + '</textarea>' +
                    '<select id="swalConStatus" class="swal2-input"><option value="open">Open</option><option value="closed">Closed</option><option value="released">Released</option></select>',
                didOpen: function () {
                    var sel = document.getElementById('swalConStatus');
                    if (sel && row.status) sel.value = row.status;
                },
                showCancelButton: true,
                confirmButtonText: 'Save',
                preConfirm: function () {
                    return {
                        id: row.id,
                        consolidated_number: row.consolidated_number,
                        lab_test_doc_ref: (document.getElementById('swalConLabRef').value || '').trim(),
                        lab_test_notes: (document.getElementById('swalConLabNotes').value || '').trim(),
                        status: document.getElementById('swalConStatus').value || 'open'
                    };
                }
            }).then(function (r) {
                if (!r.isConfirmed) return;
                dataFunctions.upsertOilConsolidatedBatch(r.value).then(function () {
                    _oilProductionGrid.loadConsolidatedBatches();
                    Swal.fire('Saved', 'Consolidated batch updated.', 'success');
                });
            });
        },

        addConsolidatedMember: function (consolidatedId, oilId) {
            if (!dataFunctions.addOilConsolidatedMember) return;
            dataFunctions.addOilConsolidatedMember(consolidatedId, oilId).then(function () {
                _oilProductionGrid.loadConsolidatedBatches();
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Added', timer: 1500, showConfirmButton: false });
            }).catch(function (e) {
                Swal.fire('Error', e.message || 'Could not add member', 'error');
            });
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
            var html = '';

            function section(title, icon, content) {
                return '<div class="card mb-3"><div class="card-header bg-light py-2"><h6 class="mb-0">' + (icon ? '<i class="' + icon + ' me-2"></i>' : '') + escapeHtml(title) + '</h6></div><div class="card-body p-2">' + content + '</div></div>';
            }

            html += section('Raw ingredients in production', 'fas fa-boxes', (function () {
                if (!raw.length) return '<p class="text-muted small mb-0">No raw ingredients in production.</p>';
                var intake = function (o) { return (o && o.intake_data) || {}; };
                var productLabel = function (o) {
                    var i = intake(o);
                    var pt = i.product_type || (o.name_of_product && String(o.name_of_product));
                    return pt ? String(pt).replace(/_/g, ' ') : '—';
                };
                var dateReceived = function (o) {
                    var i = intake(o);
                    var d = i.date_received || o.production_date;
                    return d ? fromISO(String(d).split('T')[0]) : '—';
                };
                var tbl = '<div class="table-responsive"><table class="table align-middle table-bordered mb-0"><thead><tr><th>Batch #</th><th>Supplier</th><th>Product type</th><th>FFA (bag) %</th><th>Weight (kg)</th><th>Date received</th></tr></thead><tbody>';
                raw.forEach(function (o) {
                    var bf = officialBagFfaFromOil(o);
                    var i = intake(o);
                    tbl += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(supplierLabelFromOil(o) || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + (bf != null ? escapeHtml(String(bf)) : '—') + '</td><td>' + formatKgPairHtml(i) + '</td><td>' + escapeHtml(dateReceived(o)) + '</td></tr>';
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
                var tbl = '<div class="table-responsive"><table class="table align-middle table-bordered mb-0"><thead><tr><th>Batch #</th><th>Supplier</th><th>Product type</th><th>FFA (bag) %</th><th>Weight (kg)</th><th>Emptied at</th></tr></thead><tbody>';
                rawFin.forEach(function (o) {
                    var bf = officialBagFfaFromOil(o);
                    var i = intake(o);
                    tbl += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(supplierLabelFromOil(o) || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + (bf != null ? escapeHtml(String(bf)) : '—') + '</td><td>' + formatKgPairHtml(i) + '</td><td>' + escapeHtml(emptiedAt(o)) + '</td></tr>';
                });
                tbl += '</tbody></table></div>';
                return tbl;
            })());

            html += section(scope.oilBinBatchesReport != null ? 'Oil bin batches (all)' : 'Oil bin batches (production)', 'fas fa-flask', (function () {
                if (!batches.length) return '<p class="text-muted small mb-0">No oil bin batches yet.</p>';
                var tbl = '<div class="table-responsive"><table class="table align-middle table-bordered mb-0"><thead><tr><th>Batch number</th><th>Grade</th><th>Ingredients</th><th>Start date</th><th>Letrerage</th><th>FFA %</th><th>FFA test</th><th>Status</th></tr></thead><tbody>';
                batches.forEach(function (b) {
                    var startDate = b.start_date ? (typeof b.start_date === 'string' ? b.start_date.split('T')[0] : b.start_date) : '—';
                    var ffaPct = b.ffa != null ? escapeHtml(String(b.ffa)) + ' %' : '—';
                    var ffaTestCol = formatFfaTestStatusHtml(b);
                    if (b.status === 'in_production') {
                        ffaTestCol += ' <button type="button" class="btn btn-sm btn-outline-warning op-ffa-test-btn mt-1" data-oil-bin-batch-id="' + escapeHtml(b.id) + '"><i class="fas fa-vial me-1"></i>Test FFA</button>';
                    }
                    tbl += '<tr><td>' + escapeHtml(b.batch_number || '—') + '</td><td>' + escapeHtml(formatOilStreamLabel(b.oil_stream)) + '</td><td>' + escapeHtml(b.ingredients || '—') + '</td><td>' + escapeHtml(startDate) + '</td><td>' + (b.letrerage != null ? b.letrerage : '—') + '</td><td>' + ffaPct + '</td><td class="text-nowrap">' + ffaTestCol + '</td><td>' + escapeHtml(b.status || '—') + '</td></tr>';
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
                var dateReceived = function (o) {
                    var i = intake(o);
                    var d = i.date_received || o.production_date;
                    return d ? fromISO(String(d).split('T')[0]) : '—';
                };

                var html = '<div class="table-responsive"><table class="table align-middle table-hover mb-0 op-raw-ingredients-table"><thead><tr><th>Batch #</th><th>Supplier</th><th>Product type</th><th>FFA (bag) %</th><th>Weight (kg)</th><th>Date received</th><th class="text-end">Action</th></tr></thead><tbody>';
                rows.forEach(function (o) {
                    var bagFfa = officialBagFfaFromOil(o);
                    var ffaCell = bagFfa != null ? escapeHtml(String(bagFfa)) : '—';
                    var i = intake(o);
                    html += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(supplierLabelFromOil(o) || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + ffaCell + '</td><td>' + formatKgPairHtml(i) + '</td><td>' + escapeHtml(dateReceived(o)) + '</td><td class="mac-table-actions-col">' + MacTableActions.render({
                        id: 'opRawEmpty' + o.id,
                        items: [{ label: 'Empty', className: 'op-raw-empty-btn', dataAttrs: { 'oil-id': o.id } }]
                    }) + '</td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
                MacTableActions.init(el);
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

                var html = '<div class="table-responsive"><table class="table align-middle table-hover mb-0 op-raw-ingredients-table op-finished-raw-table"><thead><tr><th>Batch #</th><th>Supplier</th><th>Product type</th><th>FFA (bag) %</th><th>Weight (kg)</th><th>Emptied at</th></tr></thead><tbody>';
                rows.forEach(function (o) {
                    var bagFfa = officialBagFfaFromOil(o);
                    var ffaCell = bagFfa != null ? escapeHtml(String(bagFfa)) : '—';
                    var i = intake(o);
                    html += '<tr><td>' + escapeHtml(o.batch_id || '—') + '</td><td>' + escapeHtml(supplierLabelFromOil(o) || '—') + '</td><td>' + escapeHtml(productLabel(o)) + '</td><td>' + ffaCell + '</td><td>' + formatKgPairHtml(i) + '</td><td>' + escapeHtml(emptiedAt(o)) + '</td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
            } catch (e) {
                console.error('[Oil Production] loadFinishedRawIngredients:', e);
                el.innerHTML = '<p class="text-danger small mb-0">Failed to load finished batches.</p>';
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

                var html = '<div class="table-responsive"><table class="table align-middle table-hover mb-0 op-oil-bin-batches-table"><thead><tr><th>Batch number</th><th>Grade</th><th>Ingredients</th><th>Start date</th><th>Letrerage</th><th>FFA %</th><th>FFA test</th><th class="text-end">Actions</th></tr></thead><tbody>';
                rows.forEach(function (b) {
                    var startDate = b.start_date ? (typeof b.start_date === 'string' ? b.start_date.split('T')[0] : b.start_date) : '—';
                    var actions = '';
                    var ffaPctCell = b.ffa != null ? escapeHtml(String(b.ffa)) + ' %' : '—';
                    var ffaTestCell = '<div class="op-ffa-test-cell">' + formatFfaTestStatusHtml(b);
                    if (b.status === 'in_production') {
                        ffaTestCell += '<button type="button" class="btn btn-sm btn-outline-warning op-ffa-test-btn mt-1 d-block" data-oil-bin-batch-id="' + escapeHtml(b.id) + '"><i class="fas fa-vial me-1"></i>Test FFA</button>';
                    }
                    ffaTestCell += '</div>';
                    if (b.status === 'in_production') {
                        actions = MacTableActions.render({
                            id: 'opOilBinActions' + b.id,
                            items: [
                                { label: 'Ingredients', className: 'op-link-ingredients-btn', icon: 'fas fa-link', dataAttrs: { 'oil-bin-batch-id': b.id } },
                                { label: 'Edit', className: 'op-edit-oil-bin-batch', icon: 'fas fa-edit', dataAttrs: { 'oil-bin-batch-id': b.id } },
                                { label: 'Delete', className: 'op-delete-oil-bin-batch', danger: true, icon: 'fas fa-trash-alt', dataAttrs: { 'oil-bin-batch-id': b.id } },
                                { label: 'Send to stock', className: 'op-send-oil-bin-to-stock', dataAttrs: { 'oil-bin-batch-id': b.id } }
                            ]
                        });
                    } else if (b.oil_id) {
                        actions = MacTableActions.render({
                            id: 'opOilBinSentActions' + b.id,
                            items: [
                                { label: 'Production data', className: 'op-production-data-btn', dataAttrs: { 'oil-id': b.oil_id } }
                            ]
                        });
                    } else {
                        actions = MacTableActions.render({
                            id: 'opOilBinSentActions' + b.id,
                            items: [{ label: 'Sent', disabled: true }]
                        });
                    }
                    var ingN = rawIngredientAuditCount(b);
                    var ingCell = '<span class="d-inline-block">' + escapeHtml(b.ingredients != null && String(b.ingredients).trim() !== '' ? String(b.ingredients) : '—') +
                        (ingN ? ' <span class="badge bg-success align-middle" title="Raw batches linked for traceability">' + ingN + ' linked</span>' : '') + '</span>';
                    html += '<tr><td>' + escapeHtml(b.batch_number || '—') + '</td><td>' + escapeHtml(formatOilStreamLabel(b.oil_stream)) + '</td><td>' + ingCell + '</td><td>' + escapeHtml(startDate) + '</td><td>' + (b.letrerage != null ? b.letrerage : '—') + '</td><td>' + ffaPctCell + '</td><td>' + ffaTestCell + '</td><td class="mac-table-actions-col">' + actions + '</td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
                MacTableActions.init(el);
            } catch (e) {
                console.error('[Oil Production] loadOilBinBatches:', e);
                el.innerHTML = '<p class="text-danger mb-0">Failed to load oil bin batches.</p>';
            }
        },

        loadProteinBinBatches: async function (forceRefresh) {
            var el = document.getElementById('opProteinBinBatchesList');
            if (!el) return;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getProteinBinBatches) {
                    el.innerHTML = '<p class="text-muted mb-0">Data not available.</p>';
                    return;
                }
                var raw = await dataFunctions.getProteinBinBatches({ limit: 100, status: 'in_production' }, null, !!forceRefresh);
                var rows = normalizeProteinBinBatches(raw).map(normalizeProteinBinBatchRow);
                _oilProductionGrid.proteinBinBatches = rows || [];

                if (!rows || rows.length === 0) {
                    el.innerHTML = '<p class="text-muted mb-0">No protein batches yet. Click <strong>Start protein batch</strong> to create one.</p>';
                    return;
                }

                var html = '<div class="table-responsive"><table class="table align-middle table-hover mb-0 op-protein-bin-batches-table"><thead><tr><th>Batch number</th><th>Ingredients</th><th>Start date</th><th>Weight (kg)</th><th class="text-end">Actions</th></tr></thead><tbody>';
                rows.forEach(function (b) {
                    var startDate = b.start_date ? (typeof b.start_date === 'string' ? b.start_date.split('T')[0] : b.start_date) : '—';
                    var actions = '';
                    var ingN = rawIngredientAuditCount(b);
                    var ingCell = '<span class="d-inline-block">' + escapeHtml(b.ingredients != null && String(b.ingredients).trim() !== '' ? String(b.ingredients) : '—') +
                        (ingN ? ' <span class="badge bg-success align-middle" title="Raw batches linked">' + ingN + ' linked</span>' : '') + '</span>';
                    if (b.status === 'in_production') {
                        actions = MacTableActions.render({
                            id: 'opProteinBinActions' + b.id,
                            items: [
                                { label: 'Ingredients', className: 'op-link-protein-ingredients-btn', icon: 'fas fa-link', dataAttrs: { 'protein-bin-batch-id': b.id } },
                                { label: 'Send to stock', className: 'op-send-protein-bin-to-stock', dataAttrs: { 'protein-bin-batch-id': b.id } }
                            ]
                        });
                    } else {
                        actions = MacTableActions.render({
                            id: 'opProteinBinSentActions' + b.id,
                            items: [{ label: 'Sent', disabled: true }]
                        });
                    }
                    html += '<tr><td>' + escapeHtml(b.batch_number || '—') + '</td><td>' + ingCell + '</td><td>' + escapeHtml(startDate) + '</td><td>' + (b.batch_weight_kg != null ? escapeHtml(String(b.batch_weight_kg)) : '—') + '</td><td class="mac-table-actions-col">' + actions + '</td></tr>';
                });
                html += '</tbody></table></div>';
                el.innerHTML = html;
                MacTableActions.init(el);
            } catch (e) {
                console.error('[Oil Production] loadProteinBinBatches:', e);
                el.innerHTML = '<p class="text-danger mb-0">Failed to load protein batches.</p>';
            }
        },

        startOilBin: async function () {
            var scope = _oilProductionGrid;
            var oilStream = null;
            if (typeof Swal !== 'undefined') {
                var choice = await Swal.fire({
                    title: 'Start oil bin',
                    html: 'Is this run for <strong>food-grade</strong> oil or <strong>cosmetic</strong> (non-food) oil? This is recorded on the batch for traceability and stock.',
                    icon: 'question',
                    showCancelButton: true,
                    showDenyButton: true,
                    confirmButtonText: 'Food grade',
                    denyButtonText: 'Cosmetic',
                    cancelButtonText: 'Cancel'
                });
                if (choice.isConfirmed) oilStream = 'food_grade';
                else if (choice.isDenied) oilStream = 'cosmetic';
                else return;
            } else {
                var raw = window.prompt('Grade: type food_grade or cosmetic', 'food_grade');
                if (raw === null) return;
                oilStream = String(raw).trim().toLowerCase().replace(/\s+/g, '_');
                if (oilStream !== 'food_grade' && oilStream !== 'cosmetic') {
                    window.alert('Enter food_grade or cosmetic.');
                    return;
                }
            }
            var batchNumber = null;
            if (typeof Swal !== 'undefined') {
                var bnSwal = await Swal.fire({
                    title: 'Oil bin batch number',
                    html: 'Enter the <strong>batch number</strong> for this oil bin run (required; not auto-generated).',
                    input: 'text',
                    inputPlaceholder: 'e.g. OIL-2026-03-001',
                    inputAttributes: { autocapitalize: 'off', autocorrect: 'off' },
                    showCancelButton: true,
                    confirmButtonText: 'Start',
                    inputValidator: function (value) {
                        if (!value || !String(value).trim()) return 'Enter a batch number';
                    }
                });
                if (!bnSwal.isConfirmed) return;
                batchNumber = String(bnSwal.value || '').trim();
            } else {
                var rawBn = window.prompt('Oil bin batch number (required)');
                if (rawBn === null) return;
                batchNumber = String(rawBn).trim();
                if (!batchNumber) {
                    window.alert('Batch number is required.');
                    return;
                }
            }
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.startOilBinBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.startOilBinBatch({ oilStream: oilStream, batchNumber: batchNumber }, null);
                var resolved = result && (result.data !== undefined ? result.data : result);
                if (resolved && typeof resolved === 'string') {
                    try { resolved = JSON.parse(resolved); } catch (e) { resolved = result; }
                }
                if (resolved && resolved.start_oil_bin_batch) resolved = resolved.start_oil_bin_batch;
                result = resolved || result;
                if (result && result.success && result.batch_number) {
                    var streamLabel = formatOilStreamLabel(result.oil_stream || oilStream);
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Oil bin started', text: 'Batch ' + result.batch_number + ' created (' + streamLabel + ').', timer: 2800, showConfirmButton: false });
                    scope.loadOilBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Failed to start oil bin', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] startOilBin:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to start oil bin', 'error');
            }
        },

        startProteinBin: async function () {
            var scope = _oilProductionGrid;
            var batchNumber = null;
            if (typeof Swal !== 'undefined') {
                var bnSwal = await Swal.fire({
                    title: 'Protein batch number',
                    html: 'Enter the <strong>batch number</strong> for this protein production run (required; not auto-generated).',
                    input: 'text',
                    inputPlaceholder: 'e.g. PROT-2026-01-001',
                    inputAttributes: { autocapitalize: 'off', autocorrect: 'off' },
                    showCancelButton: true,
                    confirmButtonText: 'Start',
                    inputValidator: function (value) {
                        if (!value || !String(value).trim()) return 'Enter a batch number';
                    }
                });
                if (!bnSwal.isConfirmed) return;
                batchNumber = String(bnSwal.value || '').trim();
            } else {
                var rawBn = window.prompt('Protein batch number (required)');
                if (rawBn === null) return;
                batchNumber = String(rawBn).trim();
                if (!batchNumber) {
                    window.alert('Batch number is required.');
                    return;
                }
            }
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.startProteinBinBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.startProteinBinBatch({ batchNumber: batchNumber }, null);
                var resolved = result && (result.data !== undefined ? result.data : result);
                if (resolved && typeof resolved === 'string') {
                    try { resolved = JSON.parse(resolved); } catch (e) { resolved = result; }
                }
                if (resolved && resolved.start_protein_bin_batch) resolved = resolved.start_protein_bin_batch;
                result = resolved || result;
                if (result && result.success && result.batch_number) {
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'success', title: 'Protein batch started', text: 'Batch ' + result.batch_number + ' created.', timer: 2800, showConfirmButton: false });
                    }
                    scope.loadProteinBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Failed to start protein batch', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] startProteinBin:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to start protein batch', 'error');
            }
        },

        showLinkIngredientsModal: async function (oilBinBatchId) {
            var scope = _oilProductionGrid;
            var bid = oilBinBatchId != null ? String(oilBinBatchId) : '';
            var batch = (scope.oilBinBatches || []).find(function (b) { return b && String(b.id) === bid; });
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Not found', 'Refresh the list and try again.', 'info');
                return;
            }
            if (batch.status !== 'in_production') {
                if (typeof Swal !== 'undefined') Swal.fire('Not available', 'Ingredients can only be linked while the bin is in production.', 'info');
                return;
            }
            var idEl = document.getElementById('opLinkIngredientsBinId');
            var numEl = document.getElementById('opLinkIngredientsBatchNumber');
            var listEl = document.getElementById('opLinkIngredientsList');
            if (!idEl || !listEl) return;
            idEl.value = batch.id || '';
            if (numEl) numEl.textContent = batch.batch_number || '—';
            listEl.innerHTML = '<p class="text-muted small mb-0">Loading raw ingredients…</p>';
            scope._linkIngredientsOilRows = {};

            var modalEl = document.getElementById('opLinkIngredientsModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();

            var selectedIds = {};
            var audit = batch.raw_ingredient_audit;
            if (Array.isArray(audit)) {
                audit.forEach(function (row) {
                    var oid = row && (row.oil_id != null ? row.oil_id : row.oilId);
                    if (oid) selectedIds[String(oid)] = true;
                });
            }

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilBatches) {
                    listEl.innerHTML = '<p class="text-danger small mb-0">Cannot load raw ingredients.</p>';
                    return;
                }
                var raw = await dataFunctions.getOilBatches({ status: 'production', limit: 200 }, null, true);
                var rows = normalizeOilBatches(raw) || [];
                var productionHtml = '';
                rows.forEach(function (o) {
                    var oid = o.id != null ? String(o.id) : '';
                    if (!oid) return;
                    scope._linkIngredientsOilRows[oid] = o;
                    var checked = selectedIds[oid] ? ' checked' : '';
                    var intake = o.intake_data || {};
                    var sup = intake.supplier || intake.supplier_details;
                    var pt = intake.product_type || (o.name_of_product && String(o.name_of_product));
                    if (pt) pt = String(pt).replace(/_/g, ' ');
                    else pt = '—';
                    var bagFfa = officialBagFfaFromOil(o);
                    var safeId = 'op-ing-' + oid.replace(/[^a-zA-Z0-9\-]/g, '_');
                    var wPart = formatKgPairHtml(intake);
                    productionHtml += '<div class="form-check py-1 border-bottom op-link-ing-item mb-0">';
                    productionHtml += '<input class="form-check-input op-link-ing-cb" type="checkbox" value="' + escapeHtml(oid) + '" id="' + safeId + '"' + checked + '>';
                    productionHtml += '<label class="form-check-label w-100" for="' + safeId + '">';
                    productionHtml += '<strong>' + escapeHtml(o.batch_id || oid) + '</strong>';
                    if (sup) productionHtml += ' <span class="text-muted small">(' + escapeHtml(String(sup)) + ')</span>';
                    productionHtml += ' — ' + escapeHtml(pt);
                    if (bagFfa != null) productionHtml += ' <span class="text-muted">· FFA ' + escapeHtml(String(bagFfa)) + '%</span>';
                    if (wPart !== '—') productionHtml += ' <span class="text-muted ms-1">' + wPart + '</span>';
                    productionHtml += '</label></div>';
                });
                var auditOnlyHtml = '';
                if (Array.isArray(audit)) {
                    audit.forEach(function (row) {
                        var oid = row && (row.oil_id != null ? String(row.oil_id) : (row.oilId != null ? String(row.oilId) : ''));
                        if (oid && scope._linkIngredientsOilRows[oid]) return;
                        auditOnlyHtml += htmlForAuditOnlyIngredientRow(row);
                    });
                }
                if (rows.length === 0 && !auditOnlyHtml) {
                    listEl.innerHTML = '<p class="text-muted small mb-0">No raw ingredient batches in production. Release batches from Supplier Intake first.</p>';
                    return;
                }
                var chunks = [];
                if (rows.length === 0) {
                    chunks.push('<p class="text-muted small mb-2">No raw ingredient batches are currently in production. Entries below stay on this bin for audit when bags are emptied.</p>');
                } else if (productionHtml) {
                    chunks.push(productionHtml);
                } else {
                    chunks.push('<p class="text-muted small mb-0">No rows to display.</p>');
                }
                if (auditOnlyHtml) {
                    chunks.push('<div class="mt-3 pt-2 border-top"><div class="small text-secondary fw-semibold mb-1">Linked for audit (no longer in production)</div>' + auditOnlyHtml + '</div>');
                }
                listEl.innerHTML = chunks.join('');
            } catch (e) {
                console.error('[Oil Production] showLinkIngredientsModal:', e);
                listEl.innerHTML = '<p class="text-danger small mb-0">Failed to load raw ingredients.</p>';
            }
        },

        saveLinkIngredients: async function () {
            var scope = _oilProductionGrid;
            var idEl = document.getElementById('opLinkIngredientsBinId');
            var binId = idEl && idEl.value ? idEl.value.trim() : '';
            if (!binId) return;
            var rowsMap = scope._linkIngredientsOilRows || {};
            var batch = (scope.oilBinBatches || []).find(function (b) { return b && String(b.id) === String(binId); });
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Not found', 'Refresh the list and try again.', 'info');
                return;
            }
            var checkedSet = new Set();
            document.querySelectorAll('#opLinkIngredientsList .op-link-ing-cb:checked').forEach(function (cb) {
                checkedSet.add(cb.value);
            });
            var audit = mergeRawIngredientAuditForBin(batch, rowsMap, checkedSet);
            var labels = audit.map(function (a) { return a.batch_id ? String(a.batch_id) : ''; }).filter(function (s) { return s; });
            var ingredientsStr = labels.join(', ');

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.setOilBinBatchRawIngredientLinks) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.setOilBinBatchRawIngredientLinks(binId, audit, ingredientsStr, null);
                if (result && result.success) {
                    var modalEl = document.getElementById('opLinkIngredientsModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getInstance(modalEl).hide();
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Saved',
                            text: audit.length ? ('Traceability updated: ' + audit.length + ' raw batch(es) linked to this oil bin.') : 'Cleared production links for this bin (historical entries kept if any).',
                            timer: 2800,
                            showConfirmButton: false
                        });
                    }
                    scope.loadOilBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] saveLinkIngredients:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
            }
        },

        showLinkProteinIngredientsModal: async function (proteinBinBatchId) {
            var scope = _oilProductionGrid;
            var bid = proteinBinBatchId != null ? String(proteinBinBatchId) : '';
            var batch = (scope.proteinBinBatches || []).find(function (b) { return b && String(b.id) === bid; });
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Not found', 'Refresh the list and try again.', 'info');
                return;
            }
            if (batch.status !== 'in_production') {
                if (typeof Swal !== 'undefined') Swal.fire('Not available', 'Ingredients can only be linked while the batch is in production.', 'info');
                return;
            }
            var idEl = document.getElementById('opProteinLinkIngredientsBinId');
            var numEl = document.getElementById('opProteinLinkIngredientsBatchNumber');
            var listEl = document.getElementById('opProteinLinkIngredientsList');
            if (!idEl || !listEl) return;
            idEl.value = batch.id || '';
            if (numEl) numEl.textContent = batch.batch_number || '—';
            listEl.innerHTML = '<p class="text-muted small mb-0">Loading raw ingredients…</p>';
            scope._linkProteinIngredientsOilRows = {};

            var modalEl = document.getElementById('opProteinLinkIngredientsModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();

            var selectedIds = {};
            var audit = batch.raw_ingredient_audit;
            if (Array.isArray(audit)) {
                audit.forEach(function (row) {
                    var oid = row && (row.oil_id != null ? row.oil_id : row.oilId);
                    if (oid) selectedIds[String(oid)] = true;
                });
            }

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilBatches) {
                    listEl.innerHTML = '<p class="text-danger small mb-0">Cannot load raw ingredients.</p>';
                    return;
                }
                var raw = await dataFunctions.getOilBatches({ status: 'production', limit: 200 }, null, true);
                var rows = normalizeOilBatches(raw) || [];
                var productionHtml = '';
                rows.forEach(function (o) {
                    var oid = o.id != null ? String(o.id) : '';
                    if (!oid) return;
                    scope._linkProteinIngredientsOilRows[oid] = o;
                    var checked = selectedIds[oid] ? ' checked' : '';
                    var intake = o.intake_data || {};
                    var sup = intake.supplier || intake.supplier_details;
                    var pt = intake.product_type || (o.name_of_product && String(o.name_of_product));
                    if (pt) pt = String(pt).replace(/_/g, ' ');
                    else pt = '—';
                    var bagFfa = officialBagFfaFromOil(o);
                    var safeId = 'op-ping-' + oid.replace(/[^a-zA-Z0-9\-]/g, '_');
                    var wPart = formatKgPairHtml(intake);
                    productionHtml += '<div class="form-check py-1 border-bottom op-protein-link-ing-item mb-0">';
                    productionHtml += '<input class="form-check-input op-protein-link-ing-cb" type="checkbox" value="' + escapeHtml(oid) + '" id="' + safeId + '"' + checked + '>';
                    productionHtml += '<label class="form-check-label w-100" for="' + safeId + '">';
                    productionHtml += '<strong>' + escapeHtml(o.batch_id || oid) + '</strong>';
                    if (sup) productionHtml += ' <span class="text-muted small">(' + escapeHtml(String(sup)) + ')</span>';
                    productionHtml += ' — ' + escapeHtml(pt);
                    if (bagFfa != null) productionHtml += ' <span class="text-muted">· FFA ' + escapeHtml(String(bagFfa)) + '%</span>';
                    if (wPart !== '—') productionHtml += ' <span class="text-muted ms-1">' + wPart + '</span>';
                    productionHtml += '</label></div>';
                });
                var auditOnlyHtml = '';
                if (Array.isArray(audit)) {
                    audit.forEach(function (row) {
                        var oid = row && (row.oil_id != null ? String(row.oil_id) : (row.oilId != null ? String(row.oilId) : ''));
                        if (oid && scope._linkProteinIngredientsOilRows[oid]) return;
                        auditOnlyHtml += htmlForAuditOnlyIngredientRow(row);
                    });
                }
                if (rows.length === 0 && !auditOnlyHtml) {
                    listEl.innerHTML = '<p class="text-muted small mb-0">No raw ingredient batches in production. Release batches from Supplier Intake first.</p>';
                    return;
                }
                var chunks = [];
                if (rows.length === 0) {
                    chunks.push('<p class="text-muted small mb-2">No raw ingredient batches are currently in production. Entries below stay on this batch for audit when bags are emptied.</p>');
                } else if (productionHtml) {
                    chunks.push(productionHtml);
                } else {
                    chunks.push('<p class="text-muted small mb-0">No rows to display.</p>');
                }
                if (auditOnlyHtml) {
                    chunks.push('<div class="mt-3 pt-2 border-top"><div class="small text-secondary fw-semibold mb-1">Linked for audit (no longer in production)</div>' + auditOnlyHtml + '</div>');
                }
                listEl.innerHTML = chunks.join('');
            } catch (e) {
                console.error('[Oil Production] showLinkProteinIngredientsModal:', e);
                listEl.innerHTML = '<p class="text-danger small mb-0">Failed to load raw ingredients.</p>';
            }
        },

        saveLinkProteinIngredients: async function () {
            var scope = _oilProductionGrid;
            var idEl = document.getElementById('opProteinLinkIngredientsBinId');
            var binId = idEl && idEl.value ? idEl.value.trim() : '';
            if (!binId) return;
            var rowsMap = scope._linkProteinIngredientsOilRows || {};
            var batch = (scope.proteinBinBatches || []).find(function (b) { return b && String(b.id) === String(binId); });
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Not found', 'Refresh the list and try again.', 'info');
                return;
            }
            var checkedSet = new Set();
            document.querySelectorAll('#opProteinLinkIngredientsList .op-protein-link-ing-cb:checked').forEach(function (cb) {
                checkedSet.add(cb.value);
            });
            var audit = mergeRawIngredientAuditForBin(batch, rowsMap, checkedSet);
            var labels = audit.map(function (a) { return a.batch_id ? String(a.batch_id) : ''; }).filter(function (s) { return s; });
            var ingredientsStr = labels.join(', ');

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.setProteinBinBatchRawIngredientLinks) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.setProteinBinBatchRawIngredientLinks(binId, audit, ingredientsStr, null);
                if (result && result.success) {
                    var modalEl = document.getElementById('opProteinLinkIngredientsModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getInstance(modalEl).hide();
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Saved',
                            text: audit.length ? ('Traceability updated: ' + audit.length + ' raw batch(es) linked.') : 'Cleared production links (historical entries kept if any).',
                            timer: 2800,
                            showConfirmButton: false
                        });
                    }
                    scope.loadProteinBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] saveLinkProteinIngredients:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
            }
        },

        sendProteinBinBatchToStock: async function (proteinBinBatchId) {
            var scope = _oilProductionGrid;
            var bid = proteinBinBatchId != null ? String(proteinBinBatchId) : '';
            var batch = (scope.proteinBinBatches || []).find(function (b) { return b && String(b.id) === bid; });
            var defaultKg = batch && batch.batch_weight_kg != null && !isNaN(Number(batch.batch_weight_kg)) ? String(batch.batch_weight_kg) : '';

            var weightKg = null;
            if (typeof Swal !== 'undefined') {
                var promptResult = await Swal.fire({
                    title: 'Send protein batch to stock?',
                    html: 'Enter <strong>batch weight</strong> (kg) for this run. This is stored on the batch and used for the stock lot.',
                    icon: 'question',
                    input: 'number',
                    inputLabel: 'Batch weight (kg)',
                    inputAttributes: { step: 'any', min: '0' },
                    inputValue: defaultKg,
                    showCancelButton: true,
                    confirmButtonText: 'Send to stock',
                    focusConfirm: false,
                    preConfirm: function (value) {
                        var v = value === '' || value == null ? NaN : parseFloat(String(value).replace(',', '.'));
                        if (isNaN(v) || v <= 0) {
                            Swal.showValidationMessage('Please enter a positive weight in kg.');
                            return false;
                        }
                        return v;
                    }
                });
                if (!promptResult || !promptResult.isConfirmed) return;
                weightKg = promptResult.value;
            } else {
                var raw = window.prompt('Batch weight (kg) before sending to stock:', defaultKg);
                if (raw === null) return;
                weightKg = parseFloat(String(raw).replace(',', '.'));
                if (isNaN(weightKg) || weightKg <= 0) {
                    window.alert('Please enter a positive weight in kg.');
                    return;
                }
            }

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.updateProteinBinBatch || !dataFunctions.sendProteinBinBatchToStock) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var upd = await dataFunctions.updateProteinBinBatch({ id: proteinBinBatchId, batch_weight_kg: weightKg }, null);
                if (!upd || !upd.success) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (upd && (upd.error || upd.message)) || 'Could not save weight.', 'error');
                    return;
                }
                var result = await dataFunctions.sendProteinBinBatchToStock(proteinBinBatchId, null);
                if (result && result.success) {
                    var bn = result.batch_number || (result.data && result.data.batch_number);
                    var msg = (bn ? 'Batch ' + bn + ' ' : '') + 'added to Stock Management (protein powder, location 801).';
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadOilLotsAndSummary) {
                        try { await _stockManagementGrid.loadOilLotsAndSummary(true); } catch (x) { /* ignore */ }
                    }
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Sent to stock', text: msg, timer: 3500, showConfirmButton: false });
                    scope.loadProteinBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Failed to send to stock', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] sendProteinBinBatchToStock:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to send to stock', 'error');
            }
        },

        sendOilBinBatchToStock: async function (oilBinBatchId) {
            var scope = _oilProductionGrid;
            var bid = oilBinBatchId != null ? String(oilBinBatchId) : '';
            var batch = (scope.oilBinBatches || []).find(function (b) { return b && String(b.id) === bid; });
            var defaultLitres = batch && batch.letrerage != null && !isNaN(Number(batch.letrerage)) ? String(batch.letrerage) : '';

            var letrerage = null;
            if (typeof Swal !== 'undefined') {
                var promptResult = await Swal.fire({
                    title: 'Send to stock?',
                    html: 'Enter <strong>letrerage</strong> (litres) for this batch. This is used for stock volume and kilograms.',
                    icon: 'question',
                    input: 'number',
                    inputLabel: 'Letrerage (litres)',
                    /* step+min must not conflict: min=0.0001 + step=0.01 rejects integers like 8000. Use step any; validate in preConfirm. */
                    inputAttributes: { step: 'any', min: '0' },
                    inputValue: defaultLitres,
                    showCancelButton: true,
                    confirmButtonText: 'Send to stock',
                    focusConfirm: false,
                    preConfirm: function (value) {
                        var v = value === '' || value == null ? NaN : parseFloat(String(value).replace(',', '.'));
                        if (isNaN(v) || v <= 0) {
                            Swal.showValidationMessage('Please enter a positive letrerage in litres.');
                            return false;
                        }
                        return v;
                    }
                });
                if (!promptResult || !promptResult.isConfirmed) return;
                letrerage = promptResult.value;
            } else {
                var raw = window.prompt('Letrerage (litres) before sending to stock:', defaultLitres);
                if (raw === null) return;
                letrerage = parseFloat(String(raw).replace(',', '.'));
                if (isNaN(letrerage) || letrerage <= 0) {
                    window.alert('Please enter a positive letrerage in litres.');
                    return;
                }
            }

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.sendOilBinBatchToStock || !dataFunctions.updateOilBinBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var upd = await dataFunctions.updateOilBinBatch({ id: oilBinBatchId, letrerage: letrerage }, null);
                if (!upd || !upd.success) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (upd && (upd.error || upd.message)) || 'Could not save letrerage.', 'error');
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

        deleteOilBinBatch: async function (oilBinBatchId) {
            var scope = _oilProductionGrid;
            var bid = oilBinBatchId != null ? String(oilBinBatchId) : '';
            var batch = (scope.oilBinBatches || []).find(function (b) { return b && String(b.id) === bid; });
            var batchNumber = batch && batch.batch_number ? String(batch.batch_number) : bid;
            var confirmed = false;

            if (typeof Swal !== 'undefined') {
                var res = await Swal.fire({
                    icon: 'warning',
                    title: 'Delete oil bin batch?',
                    html: 'Delete <strong>' + escapeHtml(batchNumber) + '</strong>?<br><span class="text-muted small">Only in-production batches that have not been sent to stock can be deleted.</span>',
                    showCancelButton: true,
                    confirmButtonText: 'Delete',
                    confirmButtonColor: '#d33'
                });
                confirmed = !!(res && res.isConfirmed);
            } else {
                confirmed = window.confirm('Delete oil bin batch ' + batchNumber + '?');
            }
            if (!confirmed) return;

            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.deleteOilBinBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.deleteOilBinBatch(oilBinBatchId, null);
                if (result && result.success) {
                    scope.oilBinBatches = (scope.oilBinBatches || []).filter(function (b) { return !b || String(b.id) !== bid; });
                    scope.oilBinBatchesReport = (scope.oilBinBatchesReport || []).filter(function (b) { return !b || String(b.id) !== bid; });
                    scope.loadOilBinBatches(true);
                    scope.loadOilBinBatchesReport(true);
                    scope.loadAll(true);
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'success', title: 'Deleted', text: 'Batch ' + batchNumber + ' was deleted.', timer: 2200, showConfirmButton: false });
                    }
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Failed to delete batch', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] deleteOilBinBatch:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to delete batch', 'error');
            }
        },

        showEditOilBinBatchModal: function (oilBinBatchId) {
            var scope = _oilProductionGrid;
            var bid = oilBinBatchId != null ? String(oilBinBatchId) : '';
            var batch = (scope.oilBinBatches || []).find(function (b) { return b && String(b.id) === bid; });
            if (!batch) return;
            document.getElementById('opEditOilBinBatchId').value = batch.id || '';
            document.getElementById('opEditOilBinBatchNumber').textContent = batch.batch_number || '—';
            var streamSel = document.getElementById('opEditOilBinOilStream');
            if (streamSel) {
                var os = batch.oil_stream ? String(batch.oil_stream).toLowerCase() : '';
                streamSel.value = (os === 'food_grade' || os === 'cosmetic') ? os : '';
            }
            var ingEl = document.getElementById('opEditOilBinIngredients');
            if (ingEl) ingEl.value = batch.ingredients || '';
            document.getElementById('opEditOilBinLetrerage').value = batch.letrerage != null ? batch.letrerage : '';
            document.getElementById('opEditOilBinFfa').value = batch.ffa != null ? batch.ffa : '';
            var modalEl = document.getElementById('opEditOilBinBatchModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
        },

        syncOpFfaTestPass: function () {
            var pctEl = document.getElementById('opFfaTestPct');
            var maxEl = document.getElementById('opFfaTestMax');
            var passEl = document.getElementById('opFfaTestPass');
            if (!pctEl || !maxEl || !passEl) return;
            var pct = parseFloat(pctEl.value);
            var max = parseFloat(maxEl.value);
            if (isNaN(max) || max < 0) max = 0.5;
            if (!isNaN(pct)) passEl.checked = pct <= max;
        },

        showFfaTestModal: function (oilBinBatchId) {
            var scope = _oilProductionGrid;
            var bid = oilBinBatchId != null ? String(oilBinBatchId) : '';
            var batch = (scope.oilBinBatches || []).find(function (b) { return b && String(b.id) === bid; });
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Not found', 'Refresh the list and try again.', 'info');
                return;
            }
            if (batch.status !== 'in_production') {
                if (typeof Swal !== 'undefined') Swal.fire('Not available', 'FFA test is only for batches still in production.', 'info');
                return;
            }
            var idEl = document.getElementById('opFfaTestBatchId');
            var numEl = document.getElementById('opFfaTestBatchNumber');
            var pctEl = document.getElementById('opFfaTestPct');
            var maxEl = document.getElementById('opFfaTestMax');
            if (idEl) idEl.value = batch.id || '';
            if (numEl) numEl.textContent = batch.batch_number || '—';
            if (pctEl) pctEl.value = batch.ffa != null ? batch.ffa : '';
            if (maxEl) {
                if (maxEl.value === '' || maxEl.value == null) maxEl.value = '0.5';
            }
            scope.syncOpFfaTestPass();
            var modalEl = document.getElementById('opFfaTestModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
        },

        saveFfaTest: async function () {
            var scope = _oilProductionGrid;
            var id = document.getElementById('opFfaTestBatchId') && document.getElementById('opFfaTestBatchId').value ? document.getElementById('opFfaTestBatchId').value.trim() : '';
            var pctRaw = document.getElementById('opFfaTestPct') && document.getElementById('opFfaTestPct').value;
            var pct = pctRaw === '' || pctRaw == null ? NaN : parseFloat(pctRaw);
            var passEl = document.getElementById('opFfaTestPass');
            var pass = passEl && passEl.checked;
            if (!id) return;
            if (isNaN(pct) || pct < 0 || pct > 100) {
                if (typeof Swal !== 'undefined') Swal.fire('Invalid', 'Enter FFA % between 0 and 100.', 'warning');
                return;
            }
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.recordOilBinBatchFfaTest) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                    return;
                }
                var result = await dataFunctions.recordOilBinBatchFfaTest(id, pct, pass, null);
                if (result && result.success) {
                    var modalEl = document.getElementById('opFfaTestModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'FFA test saved', timer: 2000, showConfirmButton: false });
                    scope.loadOilBinBatches(true);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Save failed', 'error');
                }
            } catch (e) {
                console.error('[Oil Production] saveFfaTest:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Save failed', 'error');
            }
        },

        saveEditOilBinBatch: async function () {
            var scope = _oilProductionGrid;
            var idEl = document.getElementById('opEditOilBinBatchId');
            var id = idEl && idEl.value ? idEl.value.trim() : null;
            if (!id) return;
            var ingredients = (document.getElementById('opEditOilBinIngredients') && document.getElementById('opEditOilBinIngredients').value) || '';
            var letrerageRaw = document.getElementById('opEditOilBinLetrerage') && document.getElementById('opEditOilBinLetrerage').value;
            var ffaRaw = document.getElementById('opEditOilBinFfa') && document.getElementById('opEditOilBinFfa').value;
            var letrerage = letrerageRaw === '' || letrerageRaw === null ? null : parseFloat(letrerageRaw);
            var ffa = ffaRaw === '' || ffaRaw === null ? null : parseFloat(ffaRaw);
            if (isNaN(letrerage)) letrerage = null;
            if (isNaN(ffa)) ffa = null;
            var streamEl = document.getElementById('opEditOilBinOilStream');
            var streamVal = streamEl && streamEl.value ? streamEl.value.trim() : '';
            var payload = {
                id: id,
                shifts: '',
                ingredients: ingredients,
                letrerage: letrerage,
                ffa: ffa
            };
            if (streamVal === 'food_grade' || streamVal === 'cosmetic') payload.oilStream = streamVal;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.updateOilBinBatch) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data functions not available', 'error');
                return;
                }
                var result = await dataFunctions.updateOilBinBatch(payload, null);
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
