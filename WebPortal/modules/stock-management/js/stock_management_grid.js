/**
 * Stock Management Grid Module
 * Entry module: loads table, filters, kernel batch journey, oil ledger. Routes to modals (stock take, raw material issued, send to dispatch, oil lot, import).
 * Follows SEPARATING_LARGE_JS_FILES.md and MODAL_PATTERN_INSTRUCTIONS.md.
 */
var _stockManagementGrid = function () {
    'use strict';

    var delay = function (ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    };

    return {
        stockItems: [],
        filteredStockItems: [],
        oilLots: [],
        oilSummary: [],
        kernelRawBatches: [],
        kernelFinishedBatches: [],
        oilSearchTimeout: null,
        searchTimeout: null,

        init: function () {
            var scope = _stockManagementGrid;
            console.log('[Stock Management] Initializing grid...');
            scope.applyStreamFromRoute();

            var loadPromises = [];
            if (typeof $ !== 'undefined' && $('.modal[route-name]').length) {
                $('.modal[route-name]').each(function (index, el) {
                    var routeName = $(el).attr('route-name');
                    var elementSelector = '#' + $(el).attr('id');
                    if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                        loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: elementSelector }));
                    }
                });
            }
            Promise.all(loadPromises).then(function () {
                if (typeof _modal_stock_stock_take !== 'undefined' && _modal_stock_stock_take.init) _modal_stock_stock_take.init();
                if (typeof _modal_stock_raw_material_issued !== 'undefined' && _modal_stock_raw_material_issued.init) _modal_stock_raw_material_issued.init();
                if (typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.init) _modal_stock_send_to_dispatch.init();
                if (typeof _modal_stock_oil_lot !== 'undefined' && _modal_stock_oil_lot.init) _modal_stock_oil_lot.init();
                if (typeof _modal_stock_import_oil_lots !== 'undefined' && _modal_stock_import_oil_lots.init) _modal_stock_import_oil_lots.init();
                return delay(100);
            }).then(function () {
                var stream = document.getElementById('filterStockStream') ? document.getElementById('filterStockStream').value : 'kernel';
                if (document.getElementById('exportStockBtn')) {
                    scope.setupEventListeners();
                    scope.loadStockItems();
                    scope.toggleKernelBatchJourney(stream);
                    if (document.getElementById('oilLotsTableBody')) scope.loadOilLotsAndSummary();
                } else {
                    console.warn('[Stock Management] Toolbar not found after modal load');
                }
            }).catch(function (err) {
                console.error('[Stock Management] Error loading modals:', err);
            });
        },

        applyStreamFromRoute: function () {
            var scope = _stockManagementGrid;
            var route = (typeof _appRouter !== 'undefined' && _appRouter.currentRoute) ? _appRouter.currentRoute : '';
            var stream = '';
            var titleEl = document.getElementById('stockManagementTitle');
            var subtitleEl = document.getElementById('stockManagementSubtitle');
            if (route === 'stock-management-kernel') {
                stream = 'kernel';
                if (titleEl) titleEl.textContent = 'Stock (Kernel)';
                if (subtitleEl) subtitleEl.textContent = 'Track kernel batches by style (totals across the top, yield per style from Production Job Card). Select a batch and send to dispatch—or export when you\'re ready.';
            } else if (route === 'stock-management-oil') {
                stream = 'oil';
                if (titleEl) titleEl.textContent = 'Stock (Oil)';
                if (subtitleEl) subtitleEl.textContent = 'Add and import oil lots from Excel; track by location (801 Raw Materials / 850 Finished Goods), category, and status. Days Remaining from BB Date—then export when you\'re ready.';
            }
            var streamSel = document.getElementById('filterStockStream');
            if (streamSel) {
                if (stream) streamSel.value = stream;
                scope.updateLocationOptionsByStream(streamSel.value || 'kernel');
                scope.toggleKernelBatchJourney(streamSel.value || 'kernel');
            }
        },

        updateLocationOptionsByStream: function (stream) {
            var locSel = document.getElementById('filterStockLocation');
            if (!locSel) return;
            var opts = locSel.querySelectorAll('option');
            opts.forEach(function (opt) {
                var s = opt.getAttribute('data-stream');
                opt.hidden = (s && s !== stream);
            });
            if (locSel.value) {
                var chosen = locSel.querySelector('option[value="' + locSel.value + '"]');
                if (chosen && chosen.hidden) locSel.value = '';
            }
        },

        setupEventListeners: function () {
            var scope = _stockManagementGrid;
            console.log('[Stock Management] Setting up event listeners...');

            if (typeof $ !== 'undefined') {
                $('#rawMaterialIssuedBtn').off('click').on('click', function () {
                    if (typeof _modal_stock_raw_material_issued !== 'undefined' && _modal_stock_raw_material_issued.show) _modal_stock_raw_material_issued.show();
                });
                $('#sendToDispatchBtn').off('click').on('click', function () {
                    if (typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.show) _modal_stock_send_to_dispatch.show();
                });
                $('#sendToDispatchOilBtn').off('click').on('click', function () {
                    if (typeof _modal_stock_send_to_dispatch_oil !== 'undefined' && _modal_stock_send_to_dispatch_oil.show) _modal_stock_send_to_dispatch_oil.show();
                });
                $('#exportStockBtn').off('click').on('click', function () { scope.exportStock(); });

                $('#searchStockInput').on('input', function () {
                    clearTimeout(scope.searchTimeout);
                    scope.searchTimeout = setTimeout(function () { scope.filterStockItems(); }, 300);
                });
                $('#filterStockStatus, #filterStockProduct, #filterStockLocation').on('change', function () { scope.filterStockItems(); });
                $('#clearStockFiltersBtn').on('click', function () {
                    $('#searchStockInput').val('');
                    $('#filterStockStatus').val('');
                    $('#filterStockProduct').val('');
                    $('#filterStockLocation').val('');
                    scope.filterStockItems();
                });
                $(document).on('click', '.js-release-batch-to-production', function () {
                    var id = $(this).data('batch-id');
                    if (id) scope.releaseBatchToProduction(id);
                });
                $(document).on('click', '[data-view-item]', function () {
                    var id = $(this).attr('data-view-item');
                    if (id) scope.viewItem(id);
                });
            }

            var addOilLotBtn = document.getElementById('addOilLotBtn');
            if (addOilLotBtn) {
                addOilLotBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (typeof _modal_stock_oil_lot !== 'undefined' && _modal_stock_oil_lot.show) _modal_stock_oil_lot.show();
                });
            }
            var importOilLotsBtn = document.getElementById('importOilLotsBtn');
            if (importOilLotsBtn) {
                importOilLotsBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (typeof _modal_stock_import_oil_lots !== 'undefined' && _modal_stock_import_oil_lots.show) _modal_stock_import_oil_lots.show();
                });
            }

            if (typeof $ !== 'undefined') {
                $(document).on('click', '.edit-oil-lot-btn', function () {
                    var id = $(this).data('oil-lot-id');
                    var lot = (scope.oilLots || []).find(function (x) { return x.id === id; });
                    if (lot && typeof _modal_stock_oil_lot !== 'undefined' && _modal_stock_oil_lot.show) _modal_stock_oil_lot.show(lot);
                    else if (typeof Swal !== 'undefined') Swal.fire('Error', 'Oil lot not found. Try refreshing.', 'error');
                });
                $(document).on('click', '.delete-oil-lot-btn', function () {
                    var id = $(this).data('oil-lot-id');
                    if (id) scope.deleteOilLot(id);
                });
            }

            var oilLocationFilter = document.getElementById('oilLocationFilter');
            var oilCategoryFilter = document.getElementById('oilCategoryFilter');
            var oilStatusFilter = document.getElementById('oilStatusFilter');
            if (oilLocationFilter) oilLocationFilter.addEventListener('change', function () { scope.loadOilLotsAndSummary(); });
            if (oilCategoryFilter) oilCategoryFilter.addEventListener('change', function () { scope.loadOilLotsAndSummary(); });
            if (oilStatusFilter) oilStatusFilter.addEventListener('change', function () { scope.loadOilLotsAndSummary(); });
            var oilSearchInput = document.getElementById('oilSearchInput');
            if (oilSearchInput) {
                oilSearchInput.addEventListener('input', function () {
                    clearTimeout(scope.oilSearchTimeout);
                    scope.oilSearchTimeout = setTimeout(function () { scope.loadOilLotsAndSummary(); }, 300);
                });
            }
        },

        filterStockItems: function () {
            var scope = _stockManagementGrid;
            var searchTerm = $('#searchStockInput').val().toLowerCase();
            var statusFilter = $('#filterStockStatus').val();
            var productFilter = $('#filterStockProduct').val();
            var locationFilter = $('#filterStockLocation').val();
            var streamSel = document.getElementById('filterStockStream');
            var stream = streamSel ? streamSel.value : '';
            var kernelLocations = ['NIS = R NIL', 'KERNEL R YES'];
            var oilLocations = ['OIL KERNEL R YES', 'OIL PROTEIN R YES'];
            var streamLocations = stream === 'oil' ? oilLocations : (stream === 'kernel' ? kernelLocations : null);

            scope.filteredStockItems = scope.stockItems.filter(function (item) {
                var matchesSearch = !searchTerm ||
                    (item.stock_number && item.stock_number.toLowerCase().includes(searchTerm)) ||
                    (item.batch_number && item.batch_number.toLowerCase().includes(searchTerm)) ||
                    (item.location && item.location.toLowerCase().includes(searchTerm));
                var matchesStatus = !statusFilter || item.status === statusFilter;
                var matchesProduct = !productFilter || item.product_type === productFilter;
                var matchesLocation = !locationFilter || item.location === locationFilter;
                var matchesStream = !streamLocations || (item.location && streamLocations.indexOf(item.location) !== -1);
                return matchesSearch && matchesStatus && matchesProduct && matchesLocation && matchesStream;
            });
            scope.renderStockItems();
        },

        toggleKernelBatchJourney: function (stream) {
            var scope = _stockManagementGrid;
            var card = document.getElementById('kernelBatchJourneyCard');
            var oilCard = document.getElementById('oilStockLedgerCard');
            var mainFiltersCard = document.getElementById('mainStockFiltersCard');
            var mainTableCard = document.getElementById('mainStockTableCard');
            if (stream === 'kernel') {
                if (card) card.style.display = '';
                scope.loadKernelBatches();
                if (oilCard) oilCard.style.display = 'none';
                if (mainFiltersCard) mainFiltersCard.style.display = 'none';
                if (mainTableCard) mainTableCard.style.display = 'none';
            } else {
                if (card) card.style.display = 'none';
                if (oilCard) oilCard.style.display = '';
                if (mainFiltersCard) mainFiltersCard.style.display = 'none';
                if (mainTableCard) mainTableCard.style.display = 'none';
                if (stream === 'oil' && document.getElementById('oilLotsTableBody')) scope.loadOilLotsAndSummary();
            }
        },

        loadKernelBatches: function (forceRefresh) {
            var scope = _stockManagementGrid;
            _dataFunctions.getKernelBatches(null, forceRefresh, { status: 'complete' }).then(function (all) {
                all = all || [];
                scope.kernelRawBatches = [];
                scope.kernelFinishedBatches = all;
                scope.renderKernelBatches();
            }).catch(function (e) {
                console.error('[Stock Management] loadKernelBatches failed:', e);
                scope.kernelRawBatches = [];
                scope.kernelFinishedBatches = [];
                scope.renderKernelBatches();
            });
        },

        renderKernelBatches: function () {
            _stockManagementGrid.renderKernelStockByStyle();
        },

        renderKernelStockByStyle: function () {
            var scope = _stockManagementGrid;
            var body = $('#kernelStockByStyleBody');
            var totalsRow = $('#kernelStockByStyleTotalsRow');
            if (!body.length || !totalsRow.length) return;
            body.empty();
            var batches = scope.kernelFinishedBatches || [];
            var totals = { 'SP': 0, '0': 0, '1': 0, '1S': 0, '4L': 0, '5': 0, '6': 0, '7/8': 0, 'Butter High Oil': 0, 'Butter Low Oil': 0 };
            var styleKeys = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];
            batches.forEach(function (b) {
                // Prefer cartons (remaining_by_style_cartons / yield_by_style_cartons)
                var cells = (b.remaining_by_style_cartons && typeof b.remaining_by_style_cartons === 'object') ? b.remaining_by_style_cartons : null;
                if (cells == null) cells = (b.yield_by_style_cartons && typeof b.yield_by_style_cartons === 'object') ? b.yield_by_style_cartons : {};
                var batchNum = (b.batch_number || '').toString();
                var row = '<tr><td>' + batchNum + '</td>';
                styleKeys.forEach(function (k) {
                    var val = cells[k] != null ? cells[k] : 0;
                    if (typeof val === 'number') totals[k] += val;
                    var displayVal = (val !== 0 && val !== '' && val != null) ? val : '—';
                    row += '<td class="text-end">' + displayVal + '</td>';
                });
                var ffaVal = (b.ffa != null && b.ffa !== '') ? (typeof b.ffa === 'number' ? b.ffa : parseFloat(b.ffa)) : null;
                var ffaDisplay = (ffaVal != null && !isNaN(ffaVal)) ? ffaVal : '—';
                var bbVal = b.best_before_date;
                var bbDisplay = '—';
                if (bbVal) {
                    var d = typeof bbVal === 'string' ? new Date(bbVal) : bbVal;
                    if (!isNaN(d.getTime())) bbDisplay = d.getDate() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
                }
                row += '<td class="text-end">' + ffaDisplay + '</td><td class="text-end">' + bbDisplay + '</td>';
                row += '</tr>';
                body.append(row);
            });
            totalsRow.find('td[data-style]').each(function () {
                var k = $(this).data('style');
                $(this).text(totals[k] != null ? totals[k] : 0);
            });
        },

        releaseBatchToProduction: function (batchId) {
            var scope = _stockManagementGrid;
            if (!batchId) return;
            dataFunctions.updateProductionBatch(batchId, { status: 'receiving', current_step: 1, stage: 'production' }).then(function (result) {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released', text: 'Batch is now in production. Use Kernel Production to advance steps.', timer: 2000, showConfirmButton: false });
                    scope.loadKernelBatches(true);
                } else throw new Error(result && result.error ? result.error : 'Update failed');
            }).catch(function (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release batch', 'error');
            });
        },

        loadStockItems: function (forceRefresh) {
            var scope = _stockManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getStockItems !== 'function') {
                console.warn('[Stock Management] dataFunctions not available, skipping load');
                return;
            }
            dataFunctions.getStockItems(null, forceRefresh).catch(function (error) {
                console.error('[Stock Management] Error loading stock items:', error);
                return [];
            }).then(function (items) {
                scope.stockItems = items || [];
                scope.filteredStockItems = scope.stockItems;
                scope.renderStockItems();
            });
        },

        renderStockItems: function () {
            var scope = _stockManagementGrid;
            var tbody = $('#stockTableBody');
            tbody.empty();
            if (scope.filteredStockItems.length === 0) {
                if (scope.stockItems.length === 0) {
                    tbody.html('<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No stock items found. Click "New Stock Item" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No stock items match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            scope.filteredStockItems.forEach(function (item) {
                var statusClass = item.status === 'available' ? 'bg-success' : item.status === 'reserved' ? 'bg-warning' : 'bg-secondary';
                var row = '<tr><td>' + (item.stock_number || 'N/A') + '</td><td>' + (item.product_type || 'N/A') + '</td><td>' + (item.style || 'N/A') + '</td><td>' + (item.batch_number || 'N/A') + '</td><td>' + (item.quantity_kg || '0') + '</td><td>' + (item.location || 'N/A') + '</td><td><span class="badge ' + statusClass + '">' + (item.status || 'N/A') + '</span></td><td><button class="btn btn-sm btn-outline-primary" data-view-item="' + (item.id || '') + '"><i class="fas fa-eye"></i></button></td></tr>';
                tbody.append(row);
            });
        },

        viewItem: function (itemId) {
            if (typeof Swal !== 'undefined') Swal.fire('Info', 'Stock item details coming soon', 'info');
        },

        getOilFilters: function () {
            var el = function (id) { return document.getElementById(id); };
            return {
                location_code: el('oilLocationFilter') ? el('oilLocationFilter').value || null : null,
                stock_category: el('oilCategoryFilter') ? el('oilCategoryFilter').value || null : null,
                status: el('oilStatusFilter') ? el('oilStatusFilter').value || null : null,
                search: el('oilSearchInput') ? el('oilSearchInput').value || null : null,
                limit: 500,
                offset: 0
            };
        },

        loadOilLotsAndSummary: function (forceRefresh) {
            var scope = _stockManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getOilStockLots !== 'function') {
                console.warn('[Stock Management] Oil stock functions not available yet');
                return;
            }
            var filters = scope.getOilFilters();
            dataFunctions.getOilStockLots(filters, null, forceRefresh).catch(function (e) {
                console.error('[Stock Management] getOilStockLots error:', e);
                return [];
            }).then(function (lots) {
                scope.oilLots = Array.isArray(lots) ? lots : (lots && lots.data ? lots.data : []);
                var summaryFilters = { location_code: filters.location_code, stock_category: filters.stock_category, status: filters.status || 'on_hand' };
                return dataFunctions.getOilStockSummary(summaryFilters, null, forceRefresh).catch(function (e) { return []; }).then(function (summary) {
                    scope.oilSummary = Array.isArray(summary) ? summary : (summary && summary.data ? summary.data : []);
                    scope.renderOilSummary();
                    scope.renderOilLots();
                });
            });
        },

        renderOilSummary: function () {
            var scope = _stockManagementGrid;
            var tbody = document.getElementById('oilSummaryTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            var rows = scope.oilSummary || [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No summary data</td></tr>';
                return;
            }
            rows.forEach(function (r) {
                var avg = (r.avg_ffa !== null && r.avg_ffa !== undefined) ? Number(r.avg_ffa).toFixed(2) : '';
                var sumKg = (r.sum_kilograms !== null && r.sum_kilograms !== undefined) ? Number(r.sum_kilograms).toFixed(2) : '0.00';
                var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + (r.label || 'Unspecified') + '</td><td class="text-end">' + avg + '</td><td class="text-end">' + sumKg + '</td>';
                tbody.appendChild(tr);
            });
        },

        daysRemainingFromBbDate: function (bbDate) {
            if (!bbDate) return '';
            var d = new Date(bbDate);
            if (isNaN(d.getTime())) return '';
            var today = new Date();
            var start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            var end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            return Math.round((end - start) / (1000 * 60 * 60 * 24));
        },

        renderOilLots: function () {
            var scope = _stockManagementGrid;
            var tbody = document.getElementById('oilLotsTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';
            var rows = scope.oilLots || [];
            var formatDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) ? _common.formatDateDDMMYYYY : function (v) { return v || ''; };
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="15" class="text-center text-muted py-4">No oil stock lots found</td></tr>';
                return;
            }
            rows.forEach(function (l) {
                var days = scope.daysRemainingFromBbDate(l.bb_date);
                var daysClass = (days !== '' && days < 0) ? 'text-danger fw-bold' : (days !== '' && days < 30) ? 'text-warning fw-bold' : '';
                var mfgDisplay = formatDate(l.manufacture_date) || l.manufacture_date || '';
                var bbDisplay = formatDate(l.bb_date) || l.bb_date || '';
                var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + (l.location_code || '') + '</td><td>' + (l.stock_category || '') + '</td><td>' + (l.counterparty_name || '') + '</td><td>' + (l.po_reference || '') + '</td><td>' + (l.batch_number || '') + '</td><td>' + (l.product_description || l.product_code || '') + '</td><td>' + (l.grade || '') + '</td><td class="text-end">' + (l.ffa !== null && l.ffa !== undefined ? Number(l.ffa).toFixed(2) : '') + '</td><td class="text-end">' + (l.units !== null && l.units !== undefined ? l.units : '') + '</td><td class="text-end">' + (l.kilograms !== null && l.kilograms !== undefined ? Number(l.kilograms).toFixed(2) : '') + '</td><td>' + mfgDisplay + '</td><td>' + bbDisplay + '</td><td class="text-end ' + daysClass + '">' + (days !== '' ? days : '') + '</td><td>' + (l.status || '') + '</td><td class="text-nowrap"><button class="btn btn-sm btn-outline-primary edit-oil-lot-btn" data-oil-lot-id="' + l.id + '" title="Edit"><i class="fas fa-edit"></i></button> <button class="btn btn-sm btn-outline-danger delete-oil-lot-btn" data-oil-lot-id="' + l.id + '" title="Remove"><i class="fas fa-trash"></i></button></td>';
                tbody.appendChild(tr);
            });
        },

        deleteOilLot: function (lotId) {
            var scope = _stockManagementGrid;
            Swal.fire({ title: 'Remove oil lot?', text: 'This will hide the lot from the ledger (soft delete).', icon: 'warning', showCancelButton: true, confirmButtonText: 'Yes, remove', cancelButtonText: 'Cancel' }).then(function (confirm) {
                if (!confirm.isConfirmed) return;
                dataFunctions.deactivateOilStockLot(lotId).then(function (result) {
                    if (result && result.success !== false) {
                        Swal.fire('Removed', 'Oil lot removed', 'success');
                        scope.loadOilLotsAndSummary(true);
                    } else Swal.fire('Error', (result && (result.error || result.message)) || 'Failed to remove oil lot', 'error');
                }).catch(function (e) {
                    console.error('[Stock Management] deleteOilLot failed:', e);
                    Swal.fire('Error', e.message || 'Failed to remove oil lot', 'error');
                });
            });
        },

        exportStock: function () {
            var scope = _stockManagementGrid;
            var streamEl = document.getElementById('filterStockStream');
            var stream = streamEl ? streamEl.value : 'kernel';
            if (stream === 'oil') {
                if (!scope.oilLots || scope.oilLots.length === 0) {
                    if (typeof Swal !== 'undefined') Swal.fire('Info', 'No oil lots to export', 'info');
                    return;
                }
                var columns = [
                    { key: 'location_code', label: 'Location' },
                    { key: 'stock_category', label: 'Category' },
                    { key: 'counterparty_name', label: 'Supplier/Customer' },
                    { key: 'po_reference', label: 'PO Ref' },
                    { key: 'batch_number', label: 'Batch #' },
                    { key: 'product_description', label: 'Product' },
                    { key: 'grade', label: 'Grade' },
                    { key: 'ffa', label: 'FFA' },
                    { key: 'units', label: 'Units' },
                    { key: 'kilograms', label: 'Kg' },
                    { key: 'manufacture_date', label: 'Mfg Date' },
                    { key: 'bb_date', label: 'BB Date' },
                    { key: 'status', label: 'Status' }
                ];
                if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                    exportUtils.exportToCSV(scope.oilLots, 'oil_stock_lots', columns);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Export utility not available', 'error');
                }
                return;
            }
            if (!scope.stockItems || scope.stockItems.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No stock items to export', 'info');
                return;
            }
            var columns = [
                { key: 'stock_number', label: 'Stock Number' },
                { key: 'product_type', label: 'Product Type' },
                { key: 'style', label: 'Style' },
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'quantity_kg', label: 'Quantity (kg)' },
                { key: 'location', label: 'Location' },
                { key: 'status', label: 'Status' },
                { key: 'quality_status', label: 'Quality Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.stockItems, 'stock_items', columns);
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

function initializeStockManagementGrid() {
    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.init) {
        _stockManagementGrid.init();
    } else {
        console.error('[Stock Management] _stockManagementGrid not defined');
    }
}
