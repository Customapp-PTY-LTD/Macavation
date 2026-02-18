/**
 * Oil Production Grid Module
 * Version: 2.0.0 - Production Sheet Form Implementation
 * Follows company module pattern: IIFE, arrow methods, scope = _oilProductionGrid for same-module calls.
 */
console.log('[Oil Production] Loading module v2.0.0 - Production Sheet Form Enabled');

var _oilProductionGrid = function () {
    'use strict';

    return {
        batches: [],

        init: async () => {
            const scope = _oilProductionGrid;
            await scope.waitForReady();
            var loadPromises = [];
            $('.modal[route-name]').each(function (index, el) {
                var routeName = $(el).attr('route-name');
                var elementSelector = '#' + $(el).attr('id');
                if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: elementSelector }));
                }
            });
            Promise.all(loadPromises).then(function () {
                if (typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.init) _modal_oil_production_sheet.init();
            }).catch(function (err) {
                console.error('[Oil Production] Error loading modal:', err);
                if (typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.init) _modal_oil_production_sheet.init();
            });
            scope.setupEventListeners();
            await scope.loadBatches();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _oilProductionGrid;
            $('#addOilBatchBtn').off('click').on('click', function (e) {
                e.preventDefault();
                if (typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.show) _modal_oil_production_sheet.show();
            });
        },

        loadBatches: async (forceRefresh) => {
            const scope = _oilProductionGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getOilProductionSheets !== 'function') {
                    console.warn('[Oil Production] dataFunctions not available, skipping load');
                    return;
                }
                var startTime = performance.now();
                console.log('[Oil Production] Loading batches...');
                var batches = await dataFunctions.getOilProductionSheets(null, forceRefresh).catch(function (error) {
                    console.error('[Oil Production] Error loading batches:', error);
                    return [];
                });
                console.log('[Oil Production] Batches loaded, count: ' + (batches ? batches.length : 0));
                scope.batches = batches || [];
                scope.renderBatches();
            } catch (error) {
                console.error('[Oil Production] Error loading oil production sheets:', error);
                if (error.message && !error.message.includes('dataFunctions')) {
                    scope.showError('Unable to load oil production sheets. Please try again later.');
                }
            }
        },

        renderBatches: () => {
            const scope = _oilProductionGrid;
            var tbody = $('#oilBatchesTableBody');
            tbody.empty();
            if (scope.batches.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No oil production batches found. Click "New Oil Production Sheet" to create one.</td></tr>');
                return;
            }
            scope.batches.forEach(function (batch) {
                var dateStr = scope.formatDate(batch.production_date);
                var row = '<tr>' +
                    '<td>' + scope.escapeHtml(dateStr || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(batch.shift || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(batch.batch_number || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(batch.product_name || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(String(batch.total_oil_litre || '0')) + '</td>' +
                    '<td><span class="badge bg-info">' + scope.escapeHtml(batch.status || 'pending') + '</span></td>' +
                    '<td>' +
                    '<button class="btn btn-sm btn-outline-primary" onclick="oilProductionGrid.viewBatch(\'' + scope.escapeHtml(batch.id) + '\')"><i class="fas fa-eye"></i></button> ' +
                    '<button class="btn btn-sm btn-outline-secondary" onclick="oilProductionGrid.editBatch(\'' + scope.escapeHtml(batch.id) + '\')"><i class="fas fa-edit"></i></button>' +
                    '</td></tr>';
                tbody.append(row);
            });
        },

        editBatch: (batchId) => {
            const scope = _oilProductionGrid;
            var batch = scope.batches.find(function (b) { return b.id === batchId; });
            if (batch && typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.show) {
                _modal_oil_production_sheet.show(batch);
            }
        },

        viewBatch: (batchId) => {
            if (typeof Swal !== 'undefined' && Swal.fire) {
                Swal.fire('Info', 'Oil batch details view is under development', 'info');
            }
        },

        showError: (message) => {
            if (typeof Swal !== 'undefined' && Swal.fire) {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                alert(message);
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        formatDate: (value) => {
            if (!value) return '';
            var d = value instanceof Date ? value : new Date(value);
            if (isNaN(d.getTime())) return '';
            var day = String(d.getDate()).padStart(2, '0');
            var month = String(d.getMonth() + 1).padStart(2, '0');
            var year = d.getFullYear();
            return day + '/' + month + '/' + year;
        },

        exportBatches: () => {
            const scope = _oilProductionGrid;
            if (!scope.batches || scope.batches.length === 0) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Info', 'No batches to export', 'info');
                }
                return;
            }
            var columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'input_material', label: 'Input Material' },
                { key: 'input_quantity_kg', label: 'Input Quantity (kg)' },
                { key: 'oil_produced_l', label: 'Oil Produced (L)' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.batches, 'oil_production_batches', columns);
            } else {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Error', 'Export utility not available', 'error');
                }
            }
        }
    };
}();

window.oilProductionGrid = _oilProductionGrid;

function initializeOilProductionGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined' && dataFunctions && typeof dataFunctions.getOilProductionSheets === 'function') {
            _oilProductionGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeOilProductionGrid();
});

