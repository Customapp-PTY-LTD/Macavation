/**
 * Data Import (Excel) Module
 * - Parse Excel via SheetJS
 * - Map Excel headers to DB columns
 * - Preview and bulk import via Supabase RPC
 */

var _dataImportGrid = (function () {
    'use strict';

    return {
        workbook: null,
        sheetData: [],
        headers: [],
        targetColumns: [],
        headerMap: {},

        init: () => {
            const scope = _dataImportGrid;
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _dataImportGrid;
            $('#loadPreviewBtn').on('click', async () => {
                try {
                    const fileInput = $('#excelFileInput').prop('files')[0];
                    const targetTable = $('#targetTableSelect').val();
                    if (!fileInput) {
                        if (typeof Swal !== 'undefined') Swal.fire('Upload required', 'Please choose an Excel file first.', 'warning');
                        else alert('Please choose an Excel file first.');
                        return;
                    }
                    if (!targetTable) {
                        if (typeof Swal !== 'undefined') Swal.fire('Target required', 'Please select a target table.', 'warning');
                        else alert('Please select a target table.');
                        return;
                    }
                    await scope.parseExcel(fileInput);
                    await scope.loadTargetColumns(targetTable);
                    scope.buildMappingUI();
                    scope.renderPreview();
                    $('#mappingCard').show();
                    $('#previewCard').show();
                } catch (err) {
                    console.error('[Data Import] Preview error:', err);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', err.message || 'Failed to load preview', 'error');
                    else alert('Error: ' + (err.message || 'Failed to load preview'));
                }
            });

            $('#importBtn').on('click', async () => {
                try {
                    const targetTable = $('#targetTableSelect').val();
                    if (!targetTable) {
                        if (typeof Swal !== 'undefined') Swal.fire('Target required', 'Please select a target table.', 'warning');
                        else alert('Please select a target table.');
                        return;
                    }
                    const mappedRows = scope.mapRowsToColumns();
                    if (!mappedRows || mappedRows.length === 0) {
                        if (typeof Swal !== 'undefined') Swal.fire('No rows', 'No rows to import after mapping.', 'warning');
                        else alert('No rows to import after mapping.');
                        return;
                    }
                    const confirm = typeof Swal !== 'undefined'
                        ? await Swal.fire({
                            icon: 'question',
                            title: 'Import data',
                            text: `Import ${mappedRows.length} rows into ${targetTable}?`,
                            showCancelButton: true,
                            confirmButtonText: 'Import'
                        })
                        : { isConfirmed: window.confirm(`Import ${mappedRows.length} rows into ${targetTable}?`) };
                    if (!confirm.isConfirmed) return;

                    if (typeof dataFunctions === 'undefined' || !dataFunctions.importTableRows) {
                        throw new Error('dataFunctions.importTableRows is not available');
                    }
                    const result = await dataFunctions.importTableRows(targetTable, mappedRows);
                    if (result && result.success) {
                        if (typeof Swal !== 'undefined') Swal.fire('Imported', result.message || 'Data imported successfully.', 'success');
                        else alert(result.message || 'Data imported successfully.');
                    } else {
                        throw new Error(result?.message || 'Import failed');
                    }
                } catch (err) {
                    console.error('[Data Import] Import error:', err);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', err.message || 'Import failed', 'error');
                    else alert('Error: ' + (err.message || 'Import failed'));
                }
            });

            $('#downloadTemplateBtn').on('click', () => scope.downloadTemplate());
        },

        parseExcel: async (file) => {
            const scope = _dataImportGrid;
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

            if (!json || json.length === 0) {
                throw new Error('No data found in the first sheet');
            }

            const headers = (json[0] || []).map(h => (h || '').toString().trim());
            const rows = json.slice(1).map(r => {
                const obj = {};
                headers.forEach((h, i) => (obj[h] = r[i] ?? null));
                return obj;
            });

            scope.workbook = workbook;
            scope.sheetData = rows;
            scope.headers = headers;
        },

        loadTargetColumns: async (tableName) => {
            const scope = _dataImportGrid;
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getTableColumns) {
                    const cols = await dataFunctions.getTableColumns(tableName);
                    scope.targetColumns = (cols || []).map(c => c.column_name);
                } else {
                    scope.targetColumns = [];
                }
            } catch (err) {
                console.warn('[Data Import] Could not load target columns for mapping:', err);
                scope.targetColumns = [];
            }
        },

        buildMappingUI: () => {
            const scope = _dataImportGrid;
            const tbody = $('#mappingTableBody');
            tbody.empty();
            const sample = scope.sheetData[0] || {};
            scope.headerMap = {};

            scope.headers.forEach(h => {
                const row = $('<tr/>');
                const sampleVal = (sample[h] !== undefined && sample[h] !== null) ? sample[h] : '';
                const select = $('<select class="form-select form-select-sm map-select"/>');
                select.append('<option value="">(ignore)</option>');

                scope.targetColumns.forEach(tc => {
                    const opt = $('<option/>').attr('value', tc).text(tc);
                    if (tc.toLowerCase() === (h || '').toLowerCase()) {
                        opt.attr('selected', 'selected');
                        scope.headerMap[h] = tc;
                    }
                    select.append(opt);
                });

                select.on('change', () => {
                    scope.headerMap[h] = select.val() || null;
                });

                row.append($('<td/>').text(h || '(unnamed)'));
                row.append($('<td/>').text(sampleVal));
                row.append($('<td/>').append(select));
                tbody.append(row);
            });
        },

        renderPreview: () => {
            const scope = _dataImportGrid;
            const head = $('#previewHead').empty();
            const body = $('#previewBody').empty();
            const headers = scope.headers;

            const tr = $('<tr/>');
            headers.forEach(h => tr.append($('<th/>').text(h)));
            head.append(tr);

            const rowCount = Math.min(scope.sheetData.length, 50);
            for (let i = 0; i < rowCount; i++) {
                const r = scope.sheetData[i];
                const trb = $('<tr/>');
                headers.forEach(h => trb.append($('<td/>').text(r[h] != null ? r[h] : '')));
                body.append(trb);
            }
            $('#rowCountBadge').text(`${scope.sheetData.length} rows`);
        },

        mapRowsToColumns: () => {
            const scope = _dataImportGrid;
            const mapped = [];
            for (const row of scope.sheetData) {
                const obj = {};
                for (const [excelHeader, dbColumn] of Object.entries(scope.headerMap)) {
                    if (!dbColumn) continue;
                    obj[dbColumn] = row[excelHeader] ?? null;
                }
                if (Object.keys(obj).length > 0) mapped.push(obj);
            }
            return mapped;
        },

        downloadTemplate: () => {
            const ws = XLSX.utils.aoa_to_sheet([['column1', 'column2', 'column3']]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Template');
            XLSX.writeFile(wb, 'import_template.xlsx');
        }
    };
})();

function initializeDataImportGrid() {
    if (typeof _dataImportGrid !== 'undefined') _dataImportGrid.init();
}
