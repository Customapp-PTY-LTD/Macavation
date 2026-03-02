/**
 * Oil Production Grid Module
 * Implementation aligned with kernel-production: init order, filters, filterBatches, export, row/dropdown actions.
 */
var _oilProductionGrid = function () {
    'use strict';

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    var OIL_KANBAN_COLUMNS = [
        { key: 'pending', label: 'Pending' },
        { key: 'completed', label: 'Completed' }
    ];

    return {
        batches: [],
        filteredBatches: [],
        searchDebounceToken: 0,
        currentView: 'kanban',

        init: () => {
            const scope = _oilProductionGrid;
            console.log('[Oil Production] Initializing grid...');
            scope.bindEvents();
            scope.loadBatches();
            const loadPromises = [];
            $('.modal[route-name]').each((index, el) => {
                const routeName = $(el).attr('route-name');
                const elementSelector = '#' + $(el).attr('id');
                if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName, elementSelector }));
                }
            });
            Promise.all(loadPromises).then(() => {
                if (typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.init) _modal_oil_production_sheet.init();
            }).catch((err) => {
                console.error('[Oil Production] Error loading modal:', err);
                if (typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.init) _modal_oil_production_sheet.init();
            });
        },

        bindEvents: () => {
            const scope = _oilProductionGrid;
            $('#addOilBatchBtn').off('click').on('click', function (e) {
                e.preventDefault();
                if (typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.show) {
                    _modal_oil_production_sheet.show();
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Oil production sheet modal not loaded. Please refresh the page.', 'error');
                }
            });
            $('#exportOilBatchesBtn').off('click').on('click', () => scope.exportBatches());
            $('#searchOilBatchesInput').on('input', () => {
                const token = ++scope.searchDebounceToken;
                delay(300).then(() => {
                    if (token === scope.searchDebounceToken) scope.filterBatches();
                });
            });
            $('#filterOilBatchStatus').on('change', () => scope.filterBatches());
            $('#clearOilBatchFiltersBtn').on('click', () => {
                $('#searchOilBatchesInput').val('');
                $('#filterOilBatchStatus').val('');
                scope.filterBatches();
            });
            $('#opViewKanban, #opViewTable').off('click').on('click', function () {
                scope.toggleView($(this).data('view'));
            });
            $(document).on('click', '#oilBatchesTableBody tr.js-oil-batch-row, #opKanbanBoard .js-oil-batch-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                const batchId = $(this).data('batch-id');
                if (batchId && scope.editBatch) scope.editBatch(batchId);
            });
            $(document).on('click', '.js-oil-batch-view', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId && scope.viewBatch) scope.viewBatch(batchId);
            });
            $(document).on('click', '.js-oil-batch-edit', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId && scope.editBatch) scope.editBatch(batchId);
            });
        },

        filterBatches: () => {
            const scope = _oilProductionGrid;
            const searchTerm = ($('#searchOilBatchesInput').val() || '').toLowerCase();
            const statusFilter = $('#filterOilBatchStatus').val();
            scope.filteredBatches = scope.batches.filter((batch) => {
                const matchesSearch = !searchTerm ||
                    (batch.batch_number && batch.batch_number.toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    (batch.product_name && batch.product_name.toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    (batch.status && batch.status.toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    (batch.shift && batch.shift.toString().toLowerCase().indexOf(searchTerm) >= 0);
                const matchesStatus = !statusFilter || (batch.status || '').toString() === statusFilter;
                return matchesSearch && matchesStatus;
            });
            if (scope.currentView === 'kanban') {
                scope.renderKanban();
            } else {
                scope.renderBatches();
            }
        },

        loadBatches: async (forceRefresh) => {
            const scope = _oilProductionGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilProductionSheets) {
                    console.warn('[Oil Production] dataFunctions not available');
                    scope.batches = [];
                    scope.filterBatches();
                    return;
                }
                const batches = await dataFunctions.getOilProductionSheets(null, forceRefresh).catch((err) => {
                    console.error('[Oil Production] Error loading batches:', err);
                    return [];
                });
                scope.batches = Array.isArray(batches) ? batches : [];
                scope.filterBatches();
            } catch (error) {
                console.error('[Oil Production] loadBatches failed:', error);
                scope.batches = [];
                scope.filterBatches();
                scope.showError('Unable to load oil production sheets. Please try again later.');
            }
        },

        renderBatches: () => {
            const scope = _oilProductionGrid;
            const tbody = $('#oilBatchesTableBody');
            if (!tbody.length) return;
            tbody.empty();
            if (scope.filteredBatches.length === 0) {
                if (scope.batches.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No oil production batches found. Click "New Oil Production Sheet" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search.</td></tr>');
                }
                return;
            }
            scope.filteredBatches.forEach((batch) => {
                const dateStr = scope.formatDate(batch.production_date);
                const batchId = (batch.id != null ? batch.id : batch.batch_number || '').toString();
                const batchNumEscaped = scope.escapeHtml(batch.batch_number || 'N/A');
                const actionsCell = '<div class="dropdown">' +
                    '<button class="btn btn-sm btn-outline-secondary" type="button" id="oilBatchActions' + scope.escapeHtml(batchId) + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                    '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="oilBatchActions' + scope.escapeHtml(batchId) + '">' +
                    '<a class="dropdown-item js-oil-batch-view" href="#" data-batch-id="' + scope.escapeHtml(batchId) + '"><i class="fas fa-eye me-2"></i>View</a>' +
                    '<a class="dropdown-item js-oil-batch-edit" href="#" data-batch-id="' + scope.escapeHtml(batchId) + '"><i class="fas fa-pen me-2"></i>Edit</a>' +
                    '</ul></div>';
                const row = '<tr class="js-oil-batch-row" data-batch-id="' + scope.escapeHtml(batchId) + '">' +
                    '<td>' + batchNumEscaped + '</td>' +
                    '<td>' + scope.escapeHtml(dateStr || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(batch.shift || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(batch.product_name || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(String(batch.total_oil_litre != null ? batch.total_oil_litre : '0')) + '</td>' +
                    '<td>' + KanbanHelper.statusBadge(batch.status || 'pending', (batch.status === 'completed' ? 'last' : 'first')) + '</td>' +
                    '<td>' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
        },

        toggleView: (view) => {
            const scope = _oilProductionGrid;
            scope.currentView = view;
            var board = document.getElementById('opKanbanBoard');
            var table = document.getElementById('opTableCard');
            if (view === 'kanban') {
                if (board) board.style.display = '';
                if (table) table.style.display = 'none';
                scope.renderKanban();
            } else {
                if (board) board.style.display = 'none';
                if (table) table.style.display = '';
                scope.renderBatches();
            }
            $('#opViewKanban').toggleClass('active', view === 'kanban');
            $('#opViewTable').toggleClass('active', view === 'table');
        },

        renderKanban: () => {
            const scope = _oilProductionGrid;
            if (typeof KanbanHelper === 'undefined') return;

            KanbanHelper.render('opKanbanBoard', OIL_KANBAN_COLUMNS, scope.filteredBatches, function (batch) {
                return (batch.status || 'pending').toString().toLowerCase();
            }, function (batch) {
                var esc = KanbanHelper._esc;
                var batchId = (batch.id != null ? batch.id : batch.batch_number || '').toString();
                var dateStr = scope.formatDate(batch.production_date);

                var html = '<div class="kanban-card js-oil-batch-row" data-batch-id="' + scope.escapeHtml(batchId) + '">';
                html += '<div class="kanban-card-title">' + esc(batch.batch_number || 'N/A') + '</div>';
                html += '<div class="kanban-card-meta">';
                if (dateStr) html += '<div class="kanban-card-meta-item"><i class="fas fa-calendar"></i> ' + esc(dateStr) + '</div>';
                if (batch.shift) html += '<div class="kanban-card-meta-item"><i class="fas fa-clock"></i> ' + esc(batch.shift) + '</div>';
                if (batch.product_name) html += '<div class="kanban-card-meta-item"><i class="fas fa-oil-can"></i> ' + esc(batch.product_name) + '</div>';
                if (batch.total_oil_litre != null) html += '<div class="kanban-card-meta-item"><i class="fas fa-tint"></i> ' + esc(String(batch.total_oil_litre)) + ' L</div>';
                html += '</div>';
                html += '<div class="kanban-card-actions">';
                html += '<button type="button" class="btn btn-sm btn-outline-secondary js-oil-batch-edit" data-batch-id="' + scope.escapeHtml(batchId) + '"><i class="fas fa-pen me-1"></i>Edit</button>';
                html += '</div>';
                html += '</div>';
                return html;
            });

            // Drag-and-drop: pending → completed only
            KanbanHelper.enableDragDrop('opKanbanBoard', function (batchId, fromKey, toKey) {
                if (fromKey === 'pending' && toKey === 'completed') {
                    var batch = scope.batches.find(function (b) {
                        return String(b.id) === String(batchId) || String(b.batch_number) === String(batchId);
                    });
                    if (batch && typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.show) {
                        _modal_oil_production_sheet.show(batch);
                    }
                }
                // backward (completed → pending) is silently ignored
            });
        },

        editBatch: (batchId) => {
            const scope = _oilProductionGrid;
            const id = String(batchId);
            const batch = scope.batches.find((b) => String(b.id) === id || String(b.batch_number) === id);
            if (batch && typeof _modal_oil_production_sheet !== 'undefined' && _modal_oil_production_sheet.show) {
                _modal_oil_production_sheet.show(batch);
            } else if (typeof Swal !== 'undefined') {
                Swal.fire('Info', 'Batch not found or modal not loaded.', 'info');
            }
        },

        viewBatch: (batchId) => {
            const scope = _oilProductionGrid;
            const id = String(batchId);
            const batch = scope.batches.find((b) => String(b.id) === id || String(b.batch_number) === id);
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Batch not found.', 'info');
                return;
            }
            const dateStr = scope.formatDate(batch.production_date);
            const html = '<div class="text-start small">' +
                '<p><strong>Batch #:</strong> ' + scope.escapeHtml(batch.batch_number || '—') + '</p>' +
                '<p><strong>Date:</strong> ' + scope.escapeHtml(dateStr || '—') + '</p>' +
                '<p><strong>Shift:</strong> ' + scope.escapeHtml(batch.shift || '—') + '</p>' +
                '<p><strong>Product:</strong> ' + scope.escapeHtml(batch.product_name || '—') + '</p>' +
                '<p><strong>Oil produced (L):</strong> ' + scope.escapeHtml(String(batch.total_oil_litre != null ? batch.total_oil_litre : '0')) + '</p>' +
                '<p><strong>Status:</strong> ' + scope.escapeHtml(batch.status || '—') + '</p>' +
                '</div>';
            if (typeof Swal !== 'undefined') Swal.fire({ title: 'Oil production sheet', html, confirmButtonText: 'OK', width: '400px' });
        },

        showError: (message) => {
            if (typeof Swal !== 'undefined' && Swal.fire) {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                alert(message);
            }
        },

        escapeHtml: (text) => {
            if (text == null || text === '') return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        formatDate: (value) => {
            if (!value) return '';
            const d = value instanceof Date ? value : new Date(value);
            if (isNaN(d.getTime())) return '';
            if (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) return _common.formatDateDDMMYYYY(value);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return day + '/' + month + '/' + year;
        },

        exportBatches: () => {
            const scope = _oilProductionGrid;
            const list = scope.filteredBatches.length > 0 ? scope.filteredBatches : scope.batches;
            if (!list || list.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            const columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'production_date', label: 'Date' },
                { key: 'shift', label: 'Shift' },
                { key: 'product_name', label: 'Product' },
                { key: 'total_oil_litre', label: 'Oil Produced (L)' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(list, 'oil_production_batches', columns);
            } else if (typeof Swal !== 'undefined') {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

window.initializeOilProductionGrid = function () {
    if (typeof _oilProductionGrid !== 'undefined' && _oilProductionGrid.init) {
        _oilProductionGrid.init();
    }
};
