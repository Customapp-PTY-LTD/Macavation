/**
 * Supplier Intake Grid – Oil & Protein.
 * Mirrored from Grower Intake (Kernel): same layout, Board/Table toggle, Kanban + table card.
 * Modals: Receiver checklist (create batches or edit one batch).
 */
var _supplierIntakeGrid = function () {
    'use strict';

    var SUPPLIER_INTAKE_KANBAN_COLUMNS = [
        { key: 'awaiting_test', label: 'Awaiting tests' },
        { key: 'release_ready', label: 'Ready for Oil Production' }
    ];

    /**
     * Fixed weekly pivot columns (order matches product-type dropdown + other).
     * Keys must match intake product_type values (snake_case).
     */
    var WEEKLY_INGREDIENT_COLUMN_KEYS = [
        'cracker_dust',
        'kernel_dust',
        'oil_kernel',
        'crush',
        'cake',
        'other'
    ];

    /** Map any product_type from API to a weekly column key. */
    function weeklyIngredientKeyFromBatch(b) {
        var raw = (b && b.product_type && String(b.product_type).trim()) ? String(b.product_type).trim() : '';
        var k = raw.toLowerCase().replace(/\s+/g, '_');
        if (k === 'protein_powder' || k.indexOf('protein') >= 0) return 'other';
        if (WEEKLY_INGREDIENT_COLUMN_KEYS.indexOf(k) >= 0) return k;
        if (!k) return 'other';
        return 'other';
    }

    function getSupplierColumnKey(b) {
        if (!b) return 'awaiting_test';
        var s = (b.status || '').toString().trim();
        if (s === 'release_ready') return 'release_ready';
        // Backwards compatibility: treat legacy 'intake' as "Awaiting tests" (status is now awaiting_test or release_ready only)
        if (!s || s === 'intake' || s === 'awaiting_test') return 'awaiting_test';
        return 'awaiting_test';
    }

    function productTypeLabel(value) {
        var map = {
            oil_kernel: 'Oil kernel',
            cracker_dust: 'Cracker dust',
            kernel_dust: 'Kernel dust',
            crush: 'Crush',
            cake: 'Cake',
            protein_powder: 'Protein powder',
            other: 'Other'
        };
        return map[value] || value || '—';
    }

    function formatDate(d) {
        if (!d) return '—';
        if (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) return _common.formatDateDDMMYYYY(d);
        var s = typeof d === 'string' ? d : (d.toISOString ? d.toISOString() : String(d));
        return s.split('T')[0];
    }

    /** Return ISO week key "YYYY-Www" for grouping (e.g. 2026-W10). Accepts YYYY-MM-DD or full ISO datetimes. */
    function getIsoWeekKey(d) {
        if (!d) return '';
        var date;
        if (typeof d === 'string') {
            date = d.indexOf('T') !== -1 ? new Date(d) : new Date(d + 'T12:00:00');
        } else {
            date = d instanceof Date ? d : new Date(d);
        }
        if (isNaN(date.getTime())) return '';
        var year = date.getFullYear();
        var start = new Date(year, 0, 1);
        var days = Math.floor((date - start) / 86400000);
        var weekNum = Math.floor(days / 7) + 1;
        if (weekNum > 52) {
            var nextJan = new Date(year + 1, 0, 1);
            if (date >= nextJan) { year += 1; weekNum = 1; }
        }
        var pad = weekNum < 10 ? '0' : '';
        return year + '-W' + pad + weekNum;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        var str = String(s);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    return {
        batches: [],
        filteredBatches: [],
        weeklyOilRows: [],
        weeklySnapshotLoaded: false,
        siWeeklyMode: 'in',
        currentView: 'kanban',
        _pendingOilRelease: null,

        init: () => {
            const scope = _supplierIntakeGrid;
            scope.bindEvents();
            scope.loadBatches(true);
            const loadPromises = [];
            $('.modal[route-name]').each((index, el) => {
                const routeName = $(el).attr('route-name');
                const elementSelector = '#' + $(el).attr('id');
                if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName, elementSelector }));
                }
            });
            Promise.all(loadPromises).then(() => {
                if (typeof _modalSupplierOilBatch !== 'undefined' && _modalSupplierOilBatch.init) _modalSupplierOilBatch.init();
                if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.init) _modal_stock_receiving_checklist.init();
                if (typeof _modal_supplier_receiver_checklist !== 'undefined' && _modal_supplier_receiver_checklist.init) _modal_supplier_receiver_checklist.init();
                if (typeof _modal_quality_test !== 'undefined' && _modal_quality_test.init) _modal_quality_test.init();
            }).catch((err) => {
                console.error('[Supplier Intake] Error loading modals:', err);
                if (typeof _modalSupplierOilBatch !== 'undefined' && _modalSupplierOilBatch.init) _modalSupplierOilBatch.init();
                if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.init) _modal_stock_receiving_checklist.init();
                if (typeof _modal_supplier_receiver_checklist !== 'undefined' && _modal_supplier_receiver_checklist.init) _modal_supplier_receiver_checklist.init();
                if (typeof _modal_quality_test !== 'undefined' && _modal_quality_test.init) _modal_quality_test.init();
            });
        },

        bindEvents: () => {
            const scope = _supplierIntakeGrid;
            $('#supplierReceiverChecklistBtn').off('click').on('click', function (e) {
                e.preventDefault();
                if (typeof _modal_supplier_receiver_checklist !== 'undefined' && _modal_supplier_receiver_checklist.show) {
                    _modal_supplier_receiver_checklist.show();
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Receiver checklist modal not loaded. Please refresh the page.', 'error');
                }
            });
            $('#exportSupplierIntakeBtn').off('click').on('click', () => scope.exportBatches());
            $('#siViewKanban, #siViewTable, #siViewWeekly, #siViewOverview').off('click').on('click', function () {
                scope.toggleView($(this).data('view'));
            });

            $('#searchSupplierIntakeInput').on('input', () => scope.filterBatches());
            $('#filterSupplierIntakeStatus').on('change', () => scope.filterBatches());
            $('#clearSupplierIntakeFiltersBtn').on('click', () => {
                $('#searchSupplierIntakeInput').val('');
                $('#filterSupplierIntakeStatus').val('');
                scope.filterBatches();
            });

            $('#siWeeklyViewMode').off('change').on('change', function () {
                scope.siWeeklyMode = $(this).val() || 'in';
                if (scope.currentView === 'weekly') scope.renderWeekly();
            });

            $('#siWeightBeforeProdConfirmBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.confirmWeightBeforeProductionRelease();
            });

            $(document).on('click', '#supplierIntakeBatchesTableBody tr.js-supplier-intake-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchDetail(batchId);
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .supplier-intake-batch-number-link', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchDetail(batchId);
            });
            $(document).on('click', '#siKanbanBoard .supplier-intake-batch-number-link', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchDetail(batchId);
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .js-supplier-intake-sample-test-btn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const batch = batchId ? scope.batches.find((b) => String(b.id) === batchId || String(b.batch_number) === batchId) : null;
                if (batch) {
                    scope.showSampleTest(batch);
                }
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .js-supplier-intake-view', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchDetail(batchId);
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .js-supplier-intake-edit', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var batchId = $(this).data('batch-id');
                if (!batchId) return;
                var batch = (scope.batches || []).find(function (b) {
                    return (b.id != null && String(b.id) === String(batchId)) || (b.batch_number != null && String(b.batch_number) === String(batchId));
                });
                if (batch && typeof _modal_supplier_receiver_checklist !== 'undefined' && _modal_supplier_receiver_checklist.show) {
                    _modal_supplier_receiver_checklist.show(batch);
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire('Info', batch ? 'Edit modal not loaded. Please refresh the page.' : 'Batch not found.', 'info');
                }
            });
            $(document).on('click', '#supplierIntakeBatchesTableBody .js-supplier-intake-release-oil', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var batchId = $(this).closest('tr.js-supplier-intake-row').data('batch-id');
                if (!batchId) {
                    if (typeof Swal !== 'undefined') Swal.fire('Info', 'Could not determine batch. Please try again.', 'info');
                    return;
                }
                var batch = (scope.batches || []).find(function (b) {
                    return (b.id != null && String(b.id) === String(batchId)) || (b.batch_number != null && String(b.batch_number) === String(batchId));
                });
                scope.releaseBatchToOilProduction(batchId, batch);
            });
            $(document).on('click', '#siKanbanBoard .js-supplier-intake-sample-test-btn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var batchId = $(this).data('batch-id');
                var batch = batchId ? scope.batches.find(function (b) { return (b.id != null && String(b.id) === String(batchId)) || (b.batch_number != null && String(b.batch_number) === String(batchId)); }) : null;
                if (batch) scope.showSampleTest(batch);
            });
            $(document).on('click', '#siKanbanBoard .js-supplier-intake-release-oil', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var batchId = $(this).data('batch-id');
                var batch = batchId ? scope.batches.find(function (b) { return (b.id != null && String(b.id) === String(batchId)) || (b.batch_number != null && String(b.batch_number) === String(batchId)); }) : null;
                scope.releaseBatchToOilProduction(batchId, batch);
            });
            $(document).on('click', '#siKanbanBoard .js-supplier-intake-view', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchDetail(batchId);
            });
            /* Move Actions dropdown menu to body so it is not clipped by table overflow */
            $(document).on('show.bs.dropdown', '#supplierIntakeBatchesTable .dropdown', function () {
                var $dropdown = $(this);
                var $menu = $dropdown.find('.dropdown-menu');
                if ($menu.length) {
                    $dropdown.data('si-menu', $menu);
                    $menu.addClass('supplier-intake-actions-menu').appendTo(document.body);
                }
            });
            $(document).on('hidden.bs.dropdown', '#supplierIntakeBatchesTable .dropdown', function () {
                var $dropdown = $(this);
                var $menu = $dropdown.data('si-menu');
                if ($menu && $menu.length) {
                    $menu.removeClass('supplier-intake-actions-menu').appendTo($dropdown);
                    $dropdown.removeData('si-menu');
                }
            });
        },

        filterBatches: () => {
            const scope = _supplierIntakeGrid;
            const searchTerm = ($('#searchSupplierIntakeInput').val() || '').toLowerCase();
            const statusFilter = $('#filterSupplierIntakeStatus').val();
            scope.filteredBatches = scope.batches.filter((b) => {
                const matchesSearch = !searchTerm ||
                    (b.batch_number && b.batch_number.toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    ((b.supplier_details || '').toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    ((b.delivery_note_ref || '').toString().toLowerCase().indexOf(searchTerm) >= 0) ||
                    ((b.product_type || '').toString().toLowerCase().indexOf(searchTerm) >= 0);
                const colKey = getSupplierColumnKey(b);
                const matchesStatus = !statusFilter || colKey === statusFilter;
                return matchesSearch && matchesStatus;
            });
            if (scope.currentView === 'kanban') {
                scope.renderKanbanIntake();
            } else {
                scope.renderBatches();
            }
            if (scope.currentView === 'weekly') scope.renderWeekly();
            if (scope.currentView === 'overview') scope.renderOverview();
        },

        toggleView: (view) => {
            const scope = _supplierIntakeGrid;
            scope.currentView = view;
            var board = document.getElementById('siKanbanBoard');
            var table = document.getElementById('siTableCard');
            var weekly = document.getElementById('siWeeklyCard');
            var overview = document.getElementById('siOverviewCard');
            if (board) board.style.display = (view === 'kanban') ? '' : 'none';
            if (table) table.style.display = (view === 'table') ? '' : 'none';
            if (weekly) weekly.style.display = (view === 'weekly') ? '' : 'none';
            if (overview) overview.style.display = (view === 'overview') ? '' : 'none';
            if (view === 'kanban') scope.renderKanbanIntake();
            else if (view === 'table') scope.renderBatches();
            else if (view === 'weekly') scope.loadWeeklySnapshot(false);
            else if (view === 'overview') scope.renderOverview();
            $('#siViewKanban').toggleClass('active', view === 'kanban');
            $('#siViewTable').toggleClass('active', view === 'table');
            $('#siViewWeekly').toggleClass('active', view === 'weekly');
            $('#siViewOverview').toggleClass('active', view === 'overview');
        },

        renderKanbanIntake: () => {
            const scope = _supplierIntakeGrid;
            if (typeof KanbanHelper === 'undefined') return;
            var esc = KanbanHelper._esc;
            KanbanHelper.render('siKanbanBoard', SUPPLIER_INTAKE_KANBAN_COLUMNS, scope.filteredBatches, getSupplierColumnKey, function (b) {
                var batchId = (b.id != null ? b.id : b.batch_number || '').toString();
                var batchNum = (b.batch_number || '—').toString();
                var dateStr = formatDate(b.date_received) || '—';
                var qtyStr = (b.quantity_kg != null ? b.quantity_kg + ' kg' : '');
                var productStr = productTypeLabel(b.product_type) || '—';
                var supplierStr = (b.supplier_details || '—').toString();
                var colKey = getSupplierColumnKey(b);
                var sampleBtn = '<button type="button" class="btn btn-sm btn-primary js-supplier-intake-sample-test-btn" data-batch-id="' + esc(batchId) + '" title="Sample test"><i class="fas fa-vial me-1"></i>Sample test</button>';
                var releaseBtn = colKey === 'release_ready'
                    ? '<button type="button" class="btn btn-sm btn-primary js-supplier-intake-release-oil" data-batch-id="' + esc(batchId) + '" title="Release to Oil Production"><i class="fas fa-arrow-right me-1"></i>Release to Oil Production</button>'
                    : '';
                var viewBtn = '<button type="button" class="btn btn-sm btn-outline-secondary js-supplier-intake-view" data-batch-id="' + esc(batchId) + '" title="View"><i class="fas fa-eye"></i></button>';
                var html = '<div class="kanban-card js-supplier-intake-card" data-batch-id="' + batchId + '" data-kanban-id="' + esc(batchId) + '">';
                html += '<div class="kanban-card-title">' + esc(batchNum) + '</div>';
                html += '<div class="kanban-card-meta">';
                if (productStr !== '—') html += '<div class="kanban-card-meta-item"><i class="fas fa-box"></i> ' + esc(productStr) + '</div>';
                if (supplierStr !== '—') html += '<div class="kanban-card-meta-item"><i class="fas fa-truck"></i> ' + esc(supplierStr) + '</div>';
                if (dateStr !== '—') html += '<div class="kanban-card-meta-item"><i class="fas fa-calendar"></i> ' + esc(dateStr) + '</div>';
                if (qtyStr) html += '<div class="kanban-card-meta-item"><i class="fas fa-weight-hanging"></i> ' + esc(qtyStr) + '</div>';
                html += '</div>';
                html += '<div class="kanban-card-actions">' + sampleBtn + releaseBtn + viewBtn + '</div>';
                html += '</div>';
                return html;
            });
        },

        loadBatches: async (forceRefresh) => {
            const scope = _supplierIntakeGrid;
            const tbody = $('#supplierIntakeBatchesTableBody');
            if (!tbody.length) return;
            tbody.html('<tr><td colspan="10" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>Loading…</td></tr>');
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getSupplierIntakeBatches) {
                    tbody.html('<tr><td colspan="10" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>Data functions not available.</td></tr>');
                    return;
                }
                const all = await dataFunctions.getSupplierIntakeBatches('supplier_intake', null, forceRefresh);
                scope.batches = Array.isArray(all) ? all : [];
                scope.filterBatches();
                if (scope.currentView === 'kanban') scope.renderKanbanIntake();
                else scope.renderBatches();
                scope.loadWeeklySnapshot(forceRefresh).catch(function (err) {
                    console.warn('[Supplier Intake] loadWeeklySnapshot:', err);
                });
            } catch (e) {
                console.error('[Supplier Intake] loadBatches failed:', e);
                scope.batches = [];
                tbody.html('<tr><td colspan="10" class="text-center text-danger py-4">Failed to load batches.</td></tr>');
            }
        },

        renderBatches: () => {
            const scope = _supplierIntakeGrid;
            const tbody = $('#supplierIntakeBatchesTableBody');
            if (!tbody.length) return;
            tbody.empty();
            if (scope.filteredBatches.length === 0) {
                if (scope.batches.length === 0) {
                    tbody.html('<tr><td colspan="10" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No batches in supplier intake. Click Receiver checklist to add batches.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="10" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search.</td></tr>');
                }
                return;
            }
            function groupKey(b) {
                var s = (b && b.supplier_details) ? String(b.supplier_details) : '—';
                var d = b && b.delivery_note_ref ? String(b.delivery_note_ref) : '—';
                var dt = formatDate(b && b.date_received) || '—';
                return (s + '|' + d + '|' + dt).toLowerCase();
            }
            var list = scope.filteredBatches.slice().sort(function (a, b) {
                var ga = groupKey(a);
                var gb = groupKey(b);
                if (ga < gb) return -1;
                if (ga > gb) return 1;
                var an = (a && a.batch_number) ? String(a.batch_number) : '';
                var bn = (b && b.batch_number) ? String(b.batch_number) : '';
                return an.localeCompare(bn);
            });
            var lastGroup = null;
            list.forEach((b) => {
                const batchId = (b.id != null ? b.id : b.batch_number || '').toString();
                const supplier = (b.supplier_details != null ? b.supplier_details : (b.supplier_id ? '—' : '—'));
                const mfgBb = [formatDate(b.manufactured_date), formatDate(b.best_before_date)].filter(Boolean).join(' / ') || '—';
                const batchNumEscaped = (b.batch_number || '—').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                const batchNumberCell = '<a href="#" class="supplier-intake-batch-number-link" role="button" data-batch-id="' + batchId + '">' + batchNumEscaped + '</a>';
                var colKey = getSupplierColumnKey(b);
                const sampleBtn = '<button type="button" class="btn btn-sm btn-primary supplier-intake-step-btn js-supplier-intake-sample-test-btn" data-batch-id="' + escapeHtml(batchId) + '" title="Sample test"><i class="fas fa-vial me-1"></i><span class="supplier-intake-btn-text">Sample test</span></button>';
                const releaseToOilBtn = '<button type="button" class="btn btn-sm btn-primary supplier-intake-step-btn js-supplier-intake-release-oil" data-batch-id="' + escapeHtml(batchId) + '" title="Release to Oil Production"><i class="fas fa-arrow-right me-1"></i><span class="supplier-intake-btn-text">Release to Oil Production</span></button>';
                const receivingCell = colKey === 'release_ready'
                    ? '<div class="supplier-intake-receiving-buttons">' + releaseToOilBtn + '</div>'
                    : '<div class="supplier-intake-receiving-buttons">' + sampleBtn + '</div>';
                const releaseItem = (colKey === 'release_ready')
                    ? '<a class="dropdown-item js-supplier-intake-release-oil" href="#"><i class="fas fa-arrow-right me-2"></i>Release to Oil Production</a>'
                    : '<span class="dropdown-item text-muted" role="button" tabindex="0">Release to Oil Production</span>';
                const viewItem = '<a class="dropdown-item js-supplier-intake-view" href="#" data-batch-id="' + batchId + '"><i class="fas fa-eye me-2"></i>View</a>';
                const editItem = '<a class="dropdown-item js-supplier-intake-edit" href="#" data-batch-id="' + batchId + '"><i class="fas fa-edit me-2"></i>Edit</a>';
                const actionsCell = '<div class="dropdown">' +
                    '<button class="btn btn-sm btn-outline-secondary" type="button" id="supplierIntakeActions' + escapeHtml(batchId) + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                    '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="supplierIntakeActions' + escapeHtml(batchId) + '">' + releaseItem + viewItem + editItem + '</ul></div>';
                var statusLabel = colKey === 'release_ready' ? 'Ready for Oil Production' : 'Awaiting tests';
                var stagePos = colKey === 'release_ready' ? 'last' : 'first';
                var statusBadgeHtml = (typeof KanbanHelper !== 'undefined' && KanbanHelper.statusBadge) ? KanbanHelper.statusBadge(statusLabel, stagePos) : ('<span class="badge bg-info">' + escapeHtml(statusLabel) + '</span>');

                var gk = groupKey(b);
                if (gk !== lastGroup) {
                    lastGroup = gk;
                    var grpSupplier = supplier || '—';
                    var grpDelivery = b.delivery_note_ref || '—';
                    var grpDate = formatDate(b.date_received) || '—';
                    var grpHtml = '<tr class="supplier-intake-group-row">' +
                        '<td colspan="10" class="supplier-intake-group-cell">' +
                        '<span class="supplier-intake-group-title">' + escapeHtml(grpSupplier) + '</span>' +
                        '<span class="supplier-intake-group-meta">Delivery: ' + escapeHtml(grpDelivery) + ' • Received: ' + escapeHtml(grpDate) + '</span>' +
                        '</td></tr>';
                    tbody.append(grpHtml);
                }
                const row = '<tr class="js-supplier-intake-row" data-batch-id="' + batchId + '">' +
                    '<td class="supplier-intake-col-batch">' + batchNumberCell + '</td>' +
                    '<td class="supplier-intake-col-product d-none d-md-table-cell">' + (productTypeLabel(b.product_type) || '—') + '</td>' +
                    '<td class="supplier-intake-col-date">' + (formatDate(b.date_received) || '—') + '</td>' +
                    '<td class="supplier-intake-col-note d-none d-lg-table-cell">' + (b.delivery_note_ref || '—') + '</td>' +
                    '<td class="supplier-intake-col-supplier">' + (supplier || '—') + '</td>' +
                    '<td class="supplier-intake-col-qty d-none d-sm-table-cell">' + (b.quantity_kg != null ? b.quantity_kg : '—') + '</td>' +
                    '<td class="supplier-intake-col-mfg d-none d-lg-table-cell">' + mfgBb + '</td>' +
                    '<td class="supplier-intake-col-receiving">' + receivingCell + '</td>' +
                    '<td class="supplier-intake-col-status">' + statusBadgeHtml + '</td>' +
                    '<td class="supplier-intake-col-actions">' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
            scope.initActionsDropdowns();
        },

        loadWeeklySnapshot: function (forceRefresh) {
            const scope = _supplierIntakeGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getSupplierIntakeWeeklyOilRows) {
                scope.weeklySnapshotLoaded = true;
                scope.weeklyOilRows = [];
                if (scope.currentView === 'weekly') scope.renderWeekly();
                return Promise.resolve();
            }
            return dataFunctions.getSupplierIntakeWeeklyOilRows(null, !!forceRefresh).then(function (rows) {
                scope.weeklyOilRows = Array.isArray(rows) ? rows : [];
                scope.weeklySnapshotLoaded = true;
                if (scope.currentView === 'weekly') scope.renderWeekly();
            }).catch(function (e) {
                console.error('[Supplier Intake] loadWeeklySnapshot:', e);
                scope.weeklyOilRows = [];
                scope.weeklySnapshotLoaded = true;
                if (scope.currentView === 'weekly') scope.renderWeekly();
            });
        },

        renderWeekly: () => {
            const scope = _supplierIntakeGrid;
            var tbody = document.getElementById('siWeeklyTableBody');
            var thead = document.getElementById('siWeeklyTableHead');
            var modeEl = document.getElementById('siWeeklyViewMode');
            var mode = (modeEl && modeEl.value) || scope.siWeeklyMode || 'in';
            scope.siWeeklyMode = mode;
            if (modeEl) modeEl.value = mode;
            var helpEl = document.getElementById('siWeeklyHelpText');
            if (helpEl) {
                helpEl.textContent = mode === 'out'
                    ? 'One row per week. Columns are ingredient types released to Oil Production (kg); Total is the row sum.'
                    : 'One row per week. Columns are ingredient types received (kg); Total is the row sum.';
            }
            if (!tbody) return;
            var weeklyColSpan = 1 + WEEKLY_INGREDIENT_COLUMN_KEYS.length + 1;
            if (!scope.weeklySnapshotLoaded) {
                if (thead) thead.innerHTML = '<tr><th class="si-weekly-th-week">Week</th><th class="text-end text-muted small" colspan="' + (WEEKLY_INGREDIENT_COLUMN_KEYS.length + 1) + '">…</th></tr>';
                tbody.innerHTML = '<tr><td colspan="' + weeklyColSpan + '" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>Loading…</td></tr>';
                return;
            }
            var list = scope.weeklyOilRows || [];
            if (list.length === 0) {
                if (thead) {
                    var emptyHead = '<tr><th class="si-weekly-th-week">Week</th>';
                    WEEKLY_INGREDIENT_COLUMN_KEYS.forEach(function (k) {
                        emptyHead += '<th class="text-end si-weekly-th-ing">' + escapeHtml(productTypeLabel(k)) + '</th>';
                    });
                    emptyHead += '<th class="text-end fw-semibold si-weekly-th-total">Total</th></tr>';
                    thead.innerHTML = emptyHead;
                }
                tbody.innerHTML = '<tr><td colspan="' + weeklyColSpan + '" class="text-center text-muted py-4">No supplier intake rows for weekly breakdown.</td></tr>';
                return;
            }
            var searchTerm = ($('#searchSupplierIntakeInput').val() || '').toLowerCase();
            var filtered = list.filter(function (b) {
                if (!searchTerm) return true;
                var bn = (b.batch_number && b.batch_number.toString().toLowerCase()) || '';
                var pt = (b.product_type && b.product_type.toString().toLowerCase()) || '';
                return bn.indexOf(searchTerm) >= 0 || pt.indexOf(searchTerm) >= 0;
            });
            var byWeek = {};
            function ensureCell(wk, ing) {
                if (!byWeek[wk]) byWeek[wk] = {};
                if (!byWeek[wk][ing]) byWeek[wk][ing] = { stockIn: 0, stockOut: 0 };
            }
            filtered.forEach(function (b) {
                var ing = weeklyIngredientKeyFromBatch(b);
                if (b.date_received) {
                    var wkIn = getIsoWeekKey(b.date_received);
                    if (wkIn) {
                        ensureCell(wkIn, ing);
                        var qIn = parseFloat(b.quantity_kg);
                        if (!isNaN(qIn)) byWeek[wkIn][ing].stockIn += qIn;
                    }
                }
                var st = (b.status || '').toLowerCase();
                if (st === 'production') {
                    var rel = b.weight_before_production_recorded_at || b.production_completed_at || b.created_at;
                    var wkOut = getIsoWeekKey(rel);
                    if (wkOut) {
                        ensureCell(wkOut, ing);
                        var qOut = b.weight_before_production_kg != null ? parseFloat(b.weight_before_production_kg) : parseFloat(b.quantity_kg);
                        if (!isNaN(qOut)) byWeek[wkOut][ing].stockOut += qOut;
                    }
                }
            });
            var weeks = Object.keys(byWeek).sort();
            var colKeys = WEEKLY_INGREDIENT_COLUMN_KEYS.slice();
            var numCols = 1 + colKeys.length + 1;
            function fmtKg(n) {
                if (n == null || isNaN(n) || n <= 0.0001) return '—';
                return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
            }
            if (thead) {
                var headCells = '<tr><th class="si-weekly-th-week">Week</th>';
                colKeys.forEach(function (k) {
                    headCells += '<th class="text-end si-weekly-th-ing">' + escapeHtml(productTypeLabel(k)) + '</th>';
                });
                headCells += '<th class="text-end fw-semibold si-weekly-th-total">Total</th></tr>';
                thead.innerHTML = headCells;
            }
            if (weeks.length === 0) {
                tbody.innerHTML = '<tr><td colspan="' + numCols + '" class="text-center text-muted py-4">No data for the current search.</td></tr>';
                return;
            }
            var rowsHtml = [];
            weeks.forEach(function (week) {
                var ingMap = byWeek[week] || {};
                var rowTotal = 0;
                var tds = '<td class="si-weekly-td-week">' + escapeHtml(week) + '</td>';
                colKeys.forEach(function (ingKey) {
                    var v = ingMap[ingKey];
                    var raw = mode === 'out'
                        ? (v && v.stockOut != null ? v.stockOut : 0)
                        : (v && v.stockIn != null ? v.stockIn : 0);
                    var n = parseFloat(raw);
                    if (!isNaN(n) && n > 0.0001) rowTotal += n;
                    tds += '<td class="text-end si-weekly-td-num">' + escapeHtml(fmtKg(isNaN(n) ? 0 : n)) + '</td>';
                });
                tds += '<td class="text-end fw-semibold si-weekly-td-total">' + escapeHtml(fmtKg(rowTotal)) + '</td>';
                rowsHtml.push('<tr>' + tds + '</tr>');
            });
            tbody.innerHTML = rowsHtml.join('');
        },

        renderOverview: () => {
            const scope = _supplierIntakeGrid;
            var tbody = document.getElementById('siOverviewTableBody');
            if (!tbody) return;
            var list = scope.filteredBatches && scope.filteredBatches.length > 0 ? scope.filteredBatches : (scope.batches || []);
            var byIngredient = {};
            list.forEach(function (b) {
                var key = b.product_type || 'other';
                if (!byIngredient[key]) byIngredient[key] = 0;
                var qty = parseFloat(b.quantity_kg);
                if (!isNaN(qty)) byIngredient[key] += qty;
            });
            var keys = Object.keys(byIngredient).sort();
            var rows = keys.length === 0
                ? '<tr><td colspan="2" class="text-center text-muted py-4">No data for the selected filters.</td></tr>'
                : keys.map(function (key) {
                    var total = byIngredient[key];
                    var label = productTypeLabel(key);
                    var amount = (total != null && !isNaN(total)) ? Number(total).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
                    return '<tr><td>' + escapeHtml(label) + '</td><td class="text-end">' + escapeHtml(String(amount)) + '</td></tr>';
                }).join('');
            tbody.innerHTML = rows;
        },

        showSampleTest: (batch) => {
            const scope = _supplierIntakeGrid;
            if (!batch) return;
            if (typeof _modal_quality_test === 'undefined' || !_modal_quality_test.show) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Sample test modal not loaded. Please refresh the page.', 'error');
                return;
            }
            var batchNumber = (batch.batch_number || '').toString();
            var context = {
                source: 'supplier-intake',
                oil_id: batch.id,
                batch_number: batchNumber,
                product_type: batch.product_type || null
            };
            _modal_quality_test.show(undefined, context);
        },

        initActionsDropdowns: () => {
            if (typeof bootstrap === 'undefined' || !bootstrap.Dropdown) return;
            $('#supplierIntakeBatchesTable [data-bs-toggle="dropdown"]').each(function () {
                var trigger = this;
                var existing = bootstrap.Dropdown.getInstance(trigger);
                if (existing) existing.dispose();
                new bootstrap.Dropdown(trigger, {
                    popperConfig: function (cfg) {
                        var c = Object.assign({}, cfg || {}, { strategy: 'fixed', placement: 'bottom-end' });
                        var mods = Array.isArray(c.modifiers) ? c.modifiers.slice() : [];
                        for (var i = 0; i < mods.length; i++) {
                            if (mods[i] && mods[i].name === 'flip') {
                                mods[i] = Object.assign({}, mods[i], { enabled: false });
                                break;
                            }
                        }
                        if (mods.every(function (m) { return m.name !== 'flip'; })) mods.push({ name: 'flip', enabled: false });
                        c.modifiers = mods;
                        return c;
                    }
                });
            });
        },

        showBatchDetail: (batchId) => {
            const scope = _supplierIntakeGrid;
            const b = (scope.batches || []).find((x) => (x.id != null ? x.id : x.batch_number) === batchId || String(x.id) === batchId || String(x.batch_number) === batchId);
            if (!b) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Batch not found.', 'info');
                return;
            }
            var line = function (label, value) {
                var v = value != null && value !== '' ? String(value) : '—';
                return '<p><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(v) + '</p>';
            };
            var html = '<div class="text-start small">' +
                '<p><strong>Batch #:</strong> ' + escapeHtml(b.batch_number || '—') + '</p>' +
                line('Product type', productTypeLabel(b.product_type) || b.product_type) +
                line('Date received', formatDate(b.date_received)) +
                line('Delivery note / PO', b.delivery_note_ref) +
                line('Supplier', b.supplier_details) +
                line('Quantity (kg)', b.quantity_kg != null ? b.quantity_kg : '') +
                line('Carton / bulk bags', b.carton_bulk_bags) +
                line('Manufactured date', formatDate(b.manufactured_date)) +
                line('Best before date', formatDate(b.best_before_date)) +
                line('Reference / PO', b.reference) +
                line('Description', b.description) +
                line('Status', (function () {
                    var s = (b.status || '').toLowerCase();
                    if (s === 'intake' || s === 'awaiting_test') return 'Awaiting tests';
                    if (s === 'release_ready') return 'Release ready';
                    if (s === 'production') return 'Production';
                    return b.status || '—';
                })()) +
                line('Created by', b.created_by_name) +
                line('Updated by', b.updated_by_name);
            if (b.vehicle_clean != null || b.vehicle_enclosed != null || b.hazard_substances != null || b.pest_infestations != null || b.pallets_condition != null || b.raw_materials_condition != null) {
                html += '<hr class="my-2"><p class="mb-1"><strong>Receiving checks</strong></p>' +
                    line('Vehicle clean', b.vehicle_clean) +
                    line('Vehicle enclosed', b.vehicle_enclosed) +
                    line('Hazard substances', b.hazard_substances) +
                    line('Pest infestations', b.pest_infestations) +
                    line('Pallets condition', b.pallets_condition) +
                    line('Raw materials condition', b.raw_materials_condition);
            }
            if (b.receiving_comments != null && String(b.receiving_comments).trim() !== '') {
                html += line('Receiving comments', b.receiving_comments);
            }
            html += '</div>';
            if (typeof Swal !== 'undefined') Swal.fire({ title: 'Batch details', html, confirmButtonText: 'OK', width: '420px' });
        },

        releaseBatchToOilProduction: (batchId, batch) => {
            const scope = _supplierIntakeGrid;
            if (!batchId || !batch || typeof dataFunctions === 'undefined' || !dataFunctions.releaseSupplierIntakeToProductionWithWeights) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Unable to release batch. Please try again.', 'error');
                return;
            }
            scope._pendingOilRelease = { batchId: String(batchId), batch: batch };
            var first = batch.quantity_kg != null && batch.quantity_kg !== '' ? Number(batch.quantity_kg) : NaN;
            var elFirst = document.getElementById('siFirstWeightDisplay');
            var elInput = document.getElementById('siWeightBeforeProductionInput');
            if (elFirst) elFirst.textContent = !isNaN(first) ? (first + ' kg') : '— (not recorded — still enter weight before production)';
            if (elInput) elInput.value = '';
            var modalEl = document.getElementById('supplierIntakeWeightBeforeProductionModal');
            if (modalEl && typeof bootstrap !== 'undefined') {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
                setTimeout(function () { if (elInput) elInput.focus(); }, 300);
            } else if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Weight before production (kg)',
                    html: '<p class="text-start small text-muted mb-2">Intake reference: ' + (!isNaN(first) ? first + ' kg' : '—') + '</p><input type="number" id="swalSiWeightBeforeProd" class="form-control" step="0.01" min="0" placeholder="kg">',
                    showCancelButton: true,
                    confirmButtonText: 'Release to Oil Production',
                    preConfirm: function () {
                        var v = document.getElementById('swalSiWeightBeforeProd');
                        var n = v && v.value !== '' ? parseFloat(v.value, 10) : NaN;
                        if (isNaN(n) || n < 0) {
                            Swal.showValidationMessage('Enter a valid weight (kg)');
                            return false;
                        }
                        return n;
                    }
                }).then(function (res) {
                    if (res.isConfirmed && res.value != null) scope._runOilProductionRelease(res.value);
                });
            }
        },

        confirmWeightBeforeProductionRelease: async () => {
            const scope = _supplierIntakeGrid;
            var input = document.getElementById('siWeightBeforeProductionInput');
            var raw = input && input.value != null ? String(input.value).trim() : '';
            if (raw === '') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Enter weight before production (kg).', 'error');
                return;
            }
            var w2 = parseFloat(raw, 10);
            if (isNaN(w2) || w2 < 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Enter a valid weight in kg.', 'error');
                return;
            }
            await scope._runOilProductionRelease(w2);
        },

        _runOilProductionRelease: async (weightBeforeKg) => {
            const scope = _supplierIntakeGrid;
            var p = scope._pendingOilRelease;
            if (!p || !p.batch || typeof dataFunctions === 'undefined' || !dataFunctions.releaseSupplierIntakeToProductionWithWeights) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Release session expired. Please try again.', 'error');
                return;
            }
            var batch = p.batch;
            var first = batch.quantity_kg != null && batch.quantity_kg !== '' ? Number(batch.quantity_kg) : NaN;
            var modalEl = document.getElementById('supplierIntakeWeightBeforeProductionModal');
            try {
                const result = await dataFunctions.releaseSupplierIntakeToProductionWithWeights(batch.id, {
                    weight_before_production_kg: weightBeforeKg,
                    first_weight_kg: !isNaN(first) ? first : null,
                    batch_number: batch.batch_number || null
                });
                var resolved = result && (result.data !== undefined ? result.data : result);
                var success = resolved && resolved.success !== false;
                if (success) {
                    var dropWarn = !isNaN(first) && first - weightBeforeKg > 50;
                    if (modalEl && typeof bootstrap !== 'undefined') {
                        var inst = bootstrap.Modal.getInstance(modalEl);
                        if (inst) inst.hide();
                    }
                    scope._pendingOilRelease = null;
                    if (typeof Swal !== 'undefined') {
                        if (dropWarn) {
                            Swal.fire({
                                icon: 'warning',
                                title: 'Released — dashboard warning',
                                html: 'The weight before production is more than <strong>50 kg</strong> below intake weight. A warning has been added to the <strong>dashboard</strong>.',
                                confirmButtonText: 'OK'
                            }).then(function () {
                                scope.loadBatches(true);
                                if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) _appRouter.routeTo('oil-production-grid');
                                else window.location.hash = '#oil-production-grid';
                            });
                        } else {
                            Swal.fire({ icon: 'success', title: 'Released', text: 'Batch has been moved to Oil Production.', timer: 2500, showConfirmButton: false });
                            scope.loadBatches(true);
                            if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) _appRouter.routeTo('oil-production-grid');
                            else window.location.hash = '#oil-production-grid';
                        }
                    } else {
                        scope.loadBatches(true);
                    }
                } else {
                    throw new Error(resolved && (resolved.error || resolved.message) ? (resolved.error || resolved.message) : 'Release failed');
                }
            } catch (e) {
                console.error('[Supplier Intake] release to oil production failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release batch to Oil Production.', 'error');
            }
        },

        exportBatches: () => {
            const scope = _supplierIntakeGrid;
            const list = scope.filteredBatches.length > 0 ? scope.filteredBatches : scope.batches;
            if (!list || list.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            const columns = [
                { key: 'batch_number', label: 'Batch #' },
                { key: 'product_type', label: 'Product type' },
                { key: 'date_received', label: 'Date received' },
                { key: 'delivery_note_ref', label: 'Delivery note / PO' },
                { key: 'supplier_details', label: 'Supplier' },
                { key: 'quantity_kg', label: 'Quantity (kg)' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(list, 'supplier_intake_batches', columns);
            } else if (typeof Swal !== 'undefined') {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

window.initializeSupplierIntakeGrid = function () {
    if (typeof _supplierIntakeGrid !== 'undefined' && _supplierIntakeGrid.init) {
        _supplierIntakeGrid.init();
    }
};
