/**
 * Modal: Import Oil Stock from Excel. Uses SheetJS (XLSX). Parent calls show().
 */
var _modal_stock_import_oil_lots = (function () {
    'use strict';
    var oilImportWorkbook = null;
    var oilImportPreviewRows = [];

    function normalizeHeader(h) {
        return String(h || '').trim().toLowerCase();
    }
    function parseExcelDate(v) {
        if (v === undefined || v === null) return null;
        if (v instanceof Date) return v.toISOString().slice(0, 10);
        if (typeof v === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF && XLSX.SSF.parse_date_code) {
            var d = XLSX.SSF.parse_date_code(v);
            if (d && d.y && d.m && d.d) {
                var mm = String(d.m).padStart(2, '0');
                var dd = String(d.d).padStart(2, '0');
                return d.y + '-' + mm + '-' + dd;
            }
        }
        var s = String(v).trim();
        var dt = new Date(s);
        if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
        return null;
    }
    function inferDefaultsFromSheetName(sheetName) {
        var name = (sheetName || '').toLowerCase();
        var defaults = { location_code: null, stock_category: null };
        if (name.indexOf('801') >= 0) defaults.location_code = '801';
        if (name.indexOf('850') >= 0) defaults.location_code = '850';
        if (name.indexOf('rm') >= 0 || name.indexOf('raw') >= 0) defaults.stock_category = 'raw_material';
        if (name.indexOf('fg') >= 0 || name.indexOf('finished') >= 0) defaults.stock_category = 'finished_good';
        if (name.indexOf('sold') >= 0) defaults.stock_category = 'sold';
        return defaults;
    }
    function findHeaderRowIndex(rows) {
        var wanted = ['batch', 'product', 'grade', 'kilograms', 'ffa'];
        for (var i = 0; i < Math.min(rows.length, 30); i++) {
            var r = rows[i] || [];
            var joined = r.map(function (x) { return normalizeHeader(x); }).join(' | ');
            if (wanted.some(function (w) { return joined.indexOf(w) >= 0; })) return i;
        }
        return 0;
    }

    var api = {
        init: function () {
            var scope = api;
            var fileEl = document.getElementById('oilImportExcelFile');
            if (fileEl) {
                fileEl.addEventListener('change', function () {
                    scope.handleOilImportFile(this.files && this.files[0] ? this.files[0] : null);
                });
            }
            var sheetEl = document.getElementById('oilImportSheet');
            if (sheetEl) {
                sheetEl.addEventListener('change', function () {
                    scope.renderOilImportPreview();
                });
            }
            var btn = document.getElementById('performOilImportBtn');
            if (btn) {
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.performOilImport();
                });
            }
        },

        show: function () {
            oilImportWorkbook = null;
            oilImportPreviewRows = [];
            var sheetSel = document.getElementById('oilImportSheet');
            if (sheetSel) {
                sheetSel.innerHTML = '<option value="">Select sheet</option>';
                sheetSel.disabled = true;
            }
            var preview = document.getElementById('oilImportPreview');
            if (preview) preview.style.display = 'none';
            var btn = document.getElementById('performOilImportBtn');
            if (btn) btn.disabled = true;
            var file = document.getElementById('oilImportExcelFile');
            if (file) file.value = '';

            var modalEl = document.getElementById('importOilLotsModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#importOilLotsModal').modal('show');
        },

        handleOilImportFile: async function (file) {
            try {
                if (!file) return;
                if (typeof XLSX === 'undefined') {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Missing library', 'SheetJS (XLSX) is not loaded. Please refresh the page.', 'error');
                    return;
                }
                var data = await file.arrayBuffer();
                oilImportWorkbook = XLSX.read(data, { type: 'array' });

                var sheetSel = document.getElementById('oilImportSheet');
                if (!sheetSel) return;

                sheetSel.innerHTML = '<option value="">Select sheet</option>';
                (oilImportWorkbook.SheetNames || []).forEach(function (name) {
                    var opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    sheetSel.appendChild(opt);
                });
                sheetSel.disabled = false;

                if (oilImportWorkbook.SheetNames && oilImportWorkbook.SheetNames.length) {
                    sheetSel.value = oilImportWorkbook.SheetNames[0];
                    api.renderOilImportPreview();
                }
            } catch (e) {
                console.error('[Stock Management] handleOilImportFile failed:', e);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', e.message || 'Failed to read Excel file', 'error');
            }
        },

        renderOilImportPreview: function () {
            try {
                var wb = oilImportWorkbook;
                var sheetName = document.getElementById('oilImportSheet') && document.getElementById('oilImportSheet').value;
                if (!wb || !sheetName) return;

                var ws = wb.Sheets[sheetName];
                var rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
                if (!rows || !rows.length) return;

                var headerIdx = findHeaderRowIndex(rows);
                var headers = (rows[headerIdx] || []).map(function (h) { return String(h || '').trim(); });
                var dataRows = rows.slice(headerIdx + 1).filter(function (r) { return (r || []).some(function (c) { return String(c || '').trim() !== ''; }); });

                var thead = document.querySelector('#oilImportPreviewTable thead');
                var tbody = document.querySelector('#oilImportPreviewTable tbody');
                if (!thead || !tbody) return;

                thead.innerHTML = '<tr>' + headers.slice(0, 12).map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>';
                tbody.innerHTML = '';
                dataRows.slice(0, 10).forEach(function (r) {
                    var tr = document.createElement('tr');
                    tr.innerHTML = headers.slice(0, 12).map(function (_, idx) { return '<td>' + (r[idx] ?? '') + '</td>'; }).join('');
                    tbody.appendChild(tr);
                });

                var preview = document.getElementById('oilImportPreview');
                if (preview) preview.style.display = 'block';

                oilImportPreviewRows = [{ headers: headers, dataRows: dataRows, sheetName: sheetName }];

                var btn = document.getElementById('performOilImportBtn');
                if (btn) btn.disabled = dataRows.length === 0;
            } catch (e) {
                console.error('[Stock Management] renderOilImportPreview failed:', e);
            }
        },

        buildOilImportRows: function () {
            var parsed = oilImportPreviewRows && oilImportPreviewRows[0] ? oilImportPreviewRows[0] : null;
            if (!parsed) return [];

            var headers = parsed.headers || [];
            var dataRows = parsed.dataRows || [];
            var sheetName = parsed.sheetName || '';

            var headerMap = headers.map(function (h) { return normalizeHeader(h); });
            function idxOf(names) {
                var ns = Array.isArray(names) ? names : [names];
                for (var i = 0; i < ns.length; i++) {
                    var idx = headerMap.indexOf(normalizeHeader(ns[i]));
                    if (idx >= 0) return idx;
                }
                return -1;
            }

            var idxDelivery = idxOf(['delivery date', 'date dispatched']);
            var idxSupplier = idxOf(['supplier']);
            var idxCustomer = idxOf(['customer']);
            var idxPo = idxOf(['po reference', 'po ref']);
            var idxBatch = idxOf(['batch #', 'batch']);
            var idxProduct = idxOf(['product description', 'product']);
            var idxGrade = idxOf(['grade']);
            var idxFfa = idxOf(['ffa']);
            var idxCoa = idxOf(['coa status', 'coa']);
            var idxUnits = idxOf(['units']);
            var idxVol = idxOf(['volume']);
            var idxKg = idxOf(['kilograms', 'kilogram', 'kg']);
            var idxMfg = idxOf(['manufacture date', 'mfg date']);
            var idxBb = idxOf(['bb date', 'best before', 'best before date']);
            var idxStatus = idxOf(['status']);

            var uiDefaultLoc = document.getElementById('oilImportDefaultLocation') && document.getElementById('oilImportDefaultLocation').value || null;
            var uiDefaultCat = document.getElementById('oilImportDefaultCategory') && document.getElementById('oilImportDefaultCategory').value || null;
            var inferred = inferDefaultsFromSheetName(sheetName);

            var location_code = uiDefaultLoc || inferred.location_code || (document.getElementById('oilLocationFilter') && document.getElementById('oilLocationFilter').value || null) || '801';
            var stock_category = uiDefaultCat || inferred.stock_category || (document.getElementById('oilCategoryFilter') && document.getElementById('oilCategoryFilter').value || null) || 'raw_material';

            var rowsOut = [];
            dataRows.forEach(function (r) {
                var kgValRaw = idxKg >= 0 ? r[idxKg] : null;
                var kgVal = kgValRaw !== null && kgValRaw !== undefined && kgValRaw !== '' ? parseFloat(String(kgValRaw).replace(/,/g, '')) : null;

                var productDesc = idxProduct >= 0 ? (r[idxProduct] ?? null) : null;
                var batch = idxBatch >= 0 ? (r[idxBatch] ?? null) : null;

                if (!kgVal || kgVal <= 0) return;
                if (!productDesc && !batch) return;

                var counterparty_name = idxSupplier >= 0 ? (r[idxSupplier] ?? null) : (idxCustomer >= 0 ? (r[idxCustomer] ?? null) : null);
                var counterparty_type = idxSupplier >= 0 ? 'supplier' : (idxCustomer >= 0 ? 'customer' : null);

                var pd = productDesc ? String(productDesc).trim() : null;
                var code = pd && pd.indexOf('-') >= 0 ? pd.split('-')[0].trim() : null;

                rowsOut.push({
                    location_code: location_code,
                    stock_category: stock_category,
                    status: (idxStatus >= 0 && r[idxStatus]) ? String(r[idxStatus]).trim() : (stock_category === 'sold' ? 'sold' : 'on_hand'),
                    counterparty_type: counterparty_type,
                    counterparty_name: counterparty_name ? String(counterparty_name).trim() : null,
                    po_reference: idxPo >= 0 && r[idxPo] ? String(r[idxPo]).trim() : null,
                    batch_number: batch ? String(batch).trim() : null,
                    product_code: code,
                    product_description: pd,
                    grade: idxGrade >= 0 && r[idxGrade] ? String(r[idxGrade]).trim() : null,
                    ffa: idxFfa >= 0 && r[idxFfa] !== null && r[idxFfa] !== undefined && r[idxFfa] !== '' ? parseFloat(String(r[idxFfa]).replace('%', '').trim()) : null,
                    coa_status: idxCoa >= 0 && r[idxCoa] ? String(r[idxCoa]).trim() : null,
                    units: idxUnits >= 0 && r[idxUnits] !== null && r[idxUnits] !== undefined && r[idxUnits] !== '' ? parseInt(String(r[idxUnits]).replace(/,/g, ''), 10) : null,
                    volume: idxVol >= 0 && r[idxVol] !== null && r[idxVol] !== undefined && r[idxVol] !== '' ? parseFloat(String(r[idxVol]).replace(/,/g, '')) : null,
                    kilograms: kgVal,
                    delivery_date: idxDelivery >= 0 ? parseExcelDate(r[idxDelivery]) : null,
                    manufacture_date: idxMfg >= 0 ? parseExcelDate(r[idxMfg]) : null,
                    bb_date: idxBb >= 0 ? parseExcelDate(r[idxBb]) : null
                });
            });

            return rowsOut;
        },

        performOilImport: async function () {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.importTableRows !== 'function') {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Import functions are not available.', 'error');
                    return;
                }

                var rows = api.buildOilImportRows();
                if (!rows.length) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('No data', 'No valid rows found to import (need Kilograms + Product/Batch).', 'info');
                    return;
                }

                var confirm = await Swal.fire({
                    title: 'Import ' + rows.length + ' rows?',
                    text: 'This will insert rows into Oil Stock Ledger. You can edit/remove them after import.',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Import',
                    cancelButtonText: 'Cancel'
                });
                if (!confirm.isConfirmed) return;

                var result = await dataFunctions.importTableRows('oil_stock_lots', rows);
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Imported', result.message || 'Oil stock imported successfully', 'success');
                    var modalEl = document.getElementById('importOilLotsModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#importOilLotsModal').modal('hide');
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadOilLotsAndSummary) await _stockManagementGrid.loadOilLotsAndSummary(true);
                } else {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', result && (result.error || result.message) ? (result.error || result.message) : 'Import failed', 'error');
                }
            } catch (e) {
                console.error('[Stock Management] performOilImport failed:', e);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', e.message || 'Import failed', 'error');
            }
        }
    };
    return api;
})();
_modal_stock_import_oil_lots.init();
