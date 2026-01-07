/**
 * Data Import (Excel) Module
 * - Parse Excel via SheetJS
 * - Map Excel headers to DB columns
 * - Preview and bulk import via Supabase RPC
 */

var _dataImportGrid = function () {
    return {
        workbook: null,
        sheetData: [],
        headers: [],
        targetColumns: [],
        headerMap: {}, // excelHeader -> dbColumn

        init: function () {
            this.bindEvents();
        },

        bindEvents: function () {
            const scope = this;

            $('#loadPreviewBtn').on('click', async function () {
                try {
                    const file = document.getElementById('excelFileInput').files[0];
                    const targetTable = $('#targetTableSelect').val();
                    if (!file) {
                        Swal.fire('Upload required', 'Please choose an Excel file first.', 'warning');
                        return;
                    }
                    if (!targetTable) {
                        Swal.fire('Target required', 'Please select a target table.', 'warning');
                        return;
                    }

                    await scope.parseExcel(file);
                    await scope.loadTargetColumns(targetTable);
                    scope.buildMappingUI();
                    scope.renderPreview();

                    $('#mappingCard').show();
                    $('#previewCard').show();
                } catch (err) {
                    console.error('[Data Import] Preview error:', err);
                    Swal.fire('Error', err.message || 'Failed to load preview', 'error');
                }
            });

            $('#importBtn').on('click', async function () {
                try {
                    const targetTable = $('#targetTableSelect').val();
                    if (!targetTable) {
                        Swal.fire('Target required', 'Please select a target table.', 'warning');
                        return;
                    }
                    const mappedRows = _dataImportGrid.mapRowsToColumns();
                    if (!mappedRows || mappedRows.length === 0) {
                        Swal.fire('No rows', 'No rows to import after mapping.', 'warning');
                        return;
                    }

                    const confirm = await Swal.fire({
                        icon: 'question',
                        title: 'Import data',
                        text: `Import ${mappedRows.length} rows into ${targetTable}?`,
                        showCancelButton: true,
                        confirmButtonText: 'Import'
                    });
                    if (!confirm.isConfirmed) return;

                    const result = await dataFunctions.importTableRows(targetTable, mappedRows);
                    if (result && result.success) {
                        Swal.fire('Imported', result.message || 'Data imported successfully.', 'success');
                    } else {
                        throw new Error(result?.message || 'Import failed');
                    }
                } catch (err) {
                    console.error('[Data Import] Import error:', err);
                    Swal.fire('Error', err.message || 'Import failed', 'error');
                }
            });

            $('#downloadTemplateBtn').on('click', function () {
                _dataImportGrid.downloadTemplate();
            });
        },

        parseExcel: async function (file) {
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
                headers.forEach((h, i) => obj[h] = r[i] ?? null);
                return obj;
            });

            this.workbook = workbook;
            this.sheetData = rows;
            this.headers = headers;
        },

        loadTargetColumns: async function (tableName) {
            try {
                const cols = await dataFunctions.getTableColumns(tableName);
                this.targetColumns = (cols || []).map(c => c.column_name);
            } catch (err) {
                console.warn('[Data Import] Could not load target columns for mapping:', err);
                this.targetColumns = [];
            }
        },

        buildMappingUI: function () {
            const tbody = $('#mappingTableBody');
            tbody.empty();
            const sample = this.sheetData[0] || {};

            this.headerMap = {};

            this.headers.forEach(h => {
                const row = $('<tr/>');
                const sampleVal = (sample[h] !== undefined && sample[h] !== null) ? sample[h] : '';

                const select = $('<select class="form-select form-select-sm map-select"/>');
                select.append('<option value="">(ignore)</option>');

                // Try exact match first
                this.targetColumns.forEach(tc => {
                    const opt = $('<option/>').attr('value', tc).text(tc);
                    if (tc.toLowerCase() === (h || '').toLowerCase()) {
                        opt.attr('selected', 'selected');
                        this.headerMap[h] = tc;
                    }
                    select.append(opt);
                });

                select.on('change', () => {
                    this.headerMap[h] = select.val() || null;
                });

                row.append($('<td/>').text(h || '(unnamed)'));
                row.append($('<td/>').text(sampleVal));
                row.append($('<td/>').append(select));
                tbody.append(row);
            });
        },

        renderPreview: function () {
            const head = $('#previewHead').empty();
            const body = $('#previewBody').empty();
            const headers = this.headers;

            const tr = $('<tr/>');
            headers.forEach(h => tr.append($('<th/>').text(h)));
            head.append(tr);

            const rowCount = Math.min(this.sheetData.length, 50);
            for (let i = 0; i < rowCount; i++) {
                const r = this.sheetData[i];
                const trb = $('<tr/>');
                headers.forEach(h => trb.append($('<td/>').text(r[h] != null ? r[h] : '')));
                body.append(trb);
            }
            $('#rowCountBadge').text(`${this.sheetData.length} rows`);
        },

        mapRowsToColumns: function () {
            const mapped = [];
            for (const row of this.sheetData) {
                const obj = {};
                for (const [excelHeader, dbColumn] of Object.entries(this.headerMap)) {
                    if (!dbColumn) continue; // ignored
                    obj[dbColumn] = row[excelHeader] ?? null;
                }
                if (Object.keys(obj).length > 0) mapped.push(obj);
            }
            return mapped;
        },

        downloadTemplate: function () {
            const ws = XLSX.utils.aoa_to_sheet([['column1','column2','column3']]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Template');
            XLSX.writeFile(wb, 'import_template.xlsx');
        }
    };
}();

const dataImportGrid = _dataImportGrid;
function initializeDataImportGrid() {
    if (typeof dataImportGrid !== 'undefined') {
        dataImportGrid.init();
    }
}

