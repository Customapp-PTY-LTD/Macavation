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
        selectedDispatchBatchId: null,
        selectedDispatchBatch: null,
        dispatchSelectionMode: false,
        dispatchSelectedLines: [],
        dispatchOrderDetails: {},
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
                    if (stream === 'kernel' && typeof Swal !== 'undefined' && Swal.fire) {
                        try {
                            var draftJson = localStorage.getItem('kernel_dispatch_draft');
                            if (draftJson) {
                                var draft = null;
                                try { draft = JSON.parse(draftJson); } catch (e) {}
                                var hasLines = draft && Array.isArray(draft.dispatchSelectedLines) && draft.dispatchSelectedLines.length > 0;
                                if (hasLines) {
                                    Swal.fire({
                                        title: 'Restore draft?',
                                        text: 'You have a saved dispatch selection. Restore it?',
                                        icon: 'question',
                                        showCancelButton: true,
                                        confirmButtonText: 'Restore',
                                        cancelButtonText: 'No'
                                    }).then(function (r) {
                                        if (r.isConfirmed && scope.restoreDispatchDraft) scope.restoreDispatchDraft();
                                        else if (scope.clearDispatchDraft) scope.clearDispatchDraft();
                                    });
                                } else if (scope.clearDispatchDraft) scope.clearDispatchDraft();
                            }
                        } catch (e) {}
                    }
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
            if (route === 'stock-management-kernel') {
                stream = 'kernel';
                if (titleEl) titleEl.textContent = 'Stock (Kernel)';
            } else if (route === 'stock-management-oil') {
                stream = 'oil';
                if (titleEl) titleEl.textContent = 'Stock (Oil & Protein)';
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
                $('#exportStockBtn').off('click').on('click', function () { scope.exportStock(); });
                $('#sendDispatchBtn').off('click').on('click', function () { scope.submitDispatchOrder(); });
                $(document).on('click', '#dispatchSelectedList .js-dispatch-remove-line', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var batchId = $(this).data('batch-id');
                    var style = $(this).data('style');
                    style = style != null ? String(style) : '';
                    if (!batchId && style === '') return;
                    var scope = _stockManagementGrid;
                    var idx = scope.dispatchSelectedLines.findIndex(function (l) { return (l.production_batch_id || l.batch_id) === batchId && String(l.style) === style; });
                    if (idx >= 0) {
                        scope.dispatchSelectedLines.splice(idx, 1);
                        scope.renderKernelStockByStyle();
                        scope.renderDispatchSelectedList();
                        var summary = document.getElementById('dispatchSelectedSummary');
                        if (summary) summary.style.display = scope.dispatchSelectedLines.length > 0 ? '' : 'none';
                        if (scope.dispatchSelectedLines.length === 0 && scope.clearDispatchDraft) scope.clearDispatchDraft();
                        else if (scope.saveDispatchDraft) scope.saveDispatchDraft();
                    }
                });
                $(document).on('click', '#dispatchSelectedList .js-dispatch-edit-line', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var batchId = $(this).data('batch-id');
                    var style = $(this).data('style');
                    style = style != null ? String(style) : '';
                    var currentQty = parseInt($(this).data('current-qty'), 10) || 1;
                    var maxQty = parseInt($(this).data('max-qty'), 10) || 1;
                    if (maxQty < 1) maxQty = 1;
                    var scope = _stockManagementGrid;
                    if (typeof Swal === 'undefined' || !Swal.fire) {
                        var raw = prompt('Enter number of boxes (1 to ' + maxQty + ')', String(currentQty));
                        var num = parseInt(raw, 10);
                        if (!isNaN(num) && num >= 1 && num <= maxQty) {
                            var idx = scope.dispatchSelectedLines.findIndex(function (l) { return (l.production_batch_id || l.batch_id) === batchId && String(l.style) === style; });
                            if (idx >= 0) {
                                scope.dispatchSelectedLines[idx].quantity_kg = num;
                                scope.renderKernelStockByStyle();
                                scope.renderDispatchSelectedList();
                                if (scope.saveDispatchDraft) scope.saveDispatchDraft();
                            }
                        }
                        return;
                    }
                    Swal.fire({
                        title: 'Edit quantity',
                        html: '<label class="form-label">Number of boxes (1 to ' + maxQty + ')</label><input type="number" id="dispatchEditQtyInput" class="form-control" min="1" max="' + maxQty + '" value="' + currentQty + '" step="1">',
                        showCancelButton: true,
                        confirmButtonText: 'Update',
                        focusConfirm: false,
                        preConfirm: function () {
                            var input = document.getElementById('dispatchEditQtyInput');
                            var num = input ? parseInt(input.value, 10) : NaN;
                            if (isNaN(num) || num < 1 || num > maxQty) {
                                Swal.showValidationMessage('Please enter a number between 1 and ' + maxQty + '.');
                                return false;
                            }
                            return num;
                        }
                    }).then(function (result) {
                        if (result && result.isConfirmed && typeof result.value === 'number') {
                            var idx = scope.dispatchSelectedLines.findIndex(function (l) { return (l.production_batch_id || l.batch_id) === batchId && String(l.style) === style; });
                            if (idx >= 0) {
                                scope.dispatchSelectedLines[idx].quantity_kg = result.value;
                                scope.renderKernelStockByStyle();
                                scope.renderDispatchSelectedList();
                                if (scope.saveDispatchDraft) scope.saveDispatchDraft();
                            }
                        }
                    });
                });
                $(document).on('click', '#kernelStockByStyleBody .js-dispatch-qty-pick', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var batchId = $(this).data('batch-id');
                    var style = $(this).data('style');
                    style = style != null ? String(style) : '';
                    var qty = parseInt($(this).data('quantity'), 10) || 0;
                    if (!batchId || style === '') return;
                    var scope = _stockManagementGrid;
                    var idx = scope.dispatchSelectedLines.findIndex(function (l) { return (l.production_batch_id || l.batch_id) === batchId && String(l.style) === style; });
                    if (qty <= 0) {
                        if (idx >= 0) scope.dispatchSelectedLines.splice(idx, 1);
                    } else {
                        var line = { production_batch_id: batchId, style: style, quantity_kg: qty };
                        if (idx >= 0) scope.dispatchSelectedLines[idx] = line; else scope.dispatchSelectedLines.push(line);
                    }
                    scope.renderDispatchSelectedList();
                    var summary = document.getElementById('dispatchSelectedSummary');
                    if (summary) summary.style.display = scope.dispatchSelectedLines.length > 0 ? '' : 'none';
                    if (scope.saveDispatchDraft) scope.saveDispatchDraft();
                });
                $(document).on('click', '#kernelStockByStyleBody .js-dispatch-qty-other', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var batchId = $(this).data('batch-id');
                    var style = $(this).data('style');
                    style = style != null ? String(style) : '';
                    var maxQty = parseInt($(this).data('max-qty'), 10) || 0;
                    if (!batchId || style === '' || maxQty <= 0) return;
                    var scope = _stockManagementGrid;
                    if (typeof Swal === 'undefined') {
                        var raw = prompt('Enter number of boxes (1 to ' + maxQty + ')');
                        var num = parseInt(raw, 10);
                        if (!isNaN(num) && num >= 1 && num <= maxQty) {
                            var idx = scope.dispatchSelectedLines.findIndex(function (l) { return (l.production_batch_id || l.batch_id) === batchId && String(l.style) === style; });
                            var line = { production_batch_id: batchId, style: style, quantity_kg: num };
                            if (idx >= 0) scope.dispatchSelectedLines[idx] = line; else scope.dispatchSelectedLines.push(line);
                            scope.renderDispatchSelectedList();
                            var summary = document.getElementById('dispatchSelectedSummary');
                            if (summary) summary.style.display = 'none';
                            if (scope.dispatchSelectedLines.length > 0 && summary) summary.style.display = '';
                            if (scope.saveDispatchDraft) scope.saveDispatchDraft();
                        }
                        return;
                    }
                    Swal.fire({
                        title: 'Number of boxes',
                        html: '<label class="form-label">Enter amount (1 to ' + maxQty + ')</label><input type="number" id="dispatchQtyOtherInput" class="form-control" min="1" max="' + maxQty + '" value="1" step="1">',
                        showCancelButton: true,
                        confirmButtonText: 'Add',
                        focusConfirm: false,
                        preConfirm: function () {
                            var input = document.getElementById('dispatchQtyOtherInput');
                            var num = input ? parseInt(input.value, 10) : NaN;
                            if (isNaN(num) || num < 1 || num > maxQty) {
                                Swal.showValidationMessage('Please enter a number between 1 and ' + maxQty + '.');
                                return false;
                            }
                            return num;
                        }
                    }).then(function (result) {
                        if (result && result.isConfirmed && typeof result.value === 'number') {
                            var idx = scope.dispatchSelectedLines.findIndex(function (l) { return (l.production_batch_id || l.batch_id) === batchId && String(l.style) === style; });
                            var line = { production_batch_id: batchId, style: style, quantity_kg: result.value };
                            if (idx >= 0) scope.dispatchSelectedLines[idx] = line; else scope.dispatchSelectedLines.push(line);
                            scope.renderDispatchSelectedList();
                            var summary = document.getElementById('dispatchSelectedSummary');
                            if (summary) summary.style.display = scope.dispatchSelectedLines.length > 0 ? '' : 'none';
                            if (scope.saveDispatchDraft) scope.saveDispatchDraft();
                        }
                    });
                });

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

        enterDispatchSelectionMode: function (details) {
            var scope = _stockManagementGrid;
            scope.dispatchOrderDetails = details || {};
            scope.renderKernelStockByStyle();
            scope.renderDispatchSelectedList();
            var summary = document.getElementById('dispatchSelectedSummary');
            if (summary) summary.style.display = scope.dispatchSelectedLines.length > 0 ? '' : 'none';
            if (scope.saveDispatchDraft) scope.saveDispatchDraft();
        },

        hasDispatchDraft: function () {
            var scope = _stockManagementGrid;
            var hasLines = scope.dispatchSelectedLines && scope.dispatchSelectedLines.length > 0;
            return !!hasLines;
        },

        saveDispatchDraft: function () {
            var scope = _stockManagementGrid;
            try {
                localStorage.setItem('kernel_dispatch_draft', JSON.stringify({
                    dispatchOrderDetails: scope.dispatchOrderDetails || {},
                    dispatchSelectedLines: scope.dispatchSelectedLines || [],
                    savedAt: new Date().toISOString()
                }));
            } catch (e) { console.warn('[Stock Management] Could not save dispatch draft', e); }
        },

        clearDispatchDraft: function () {
            var scope = _stockManagementGrid;
            try {
                localStorage.removeItem('kernel_dispatch_draft');
            } catch (e) {}
            scope.dispatchSelectedLines = [];
            scope.dispatchOrderDetails = {};
            scope.renderKernelStockByStyle();
            scope.renderDispatchSelectedList();
            var summary = document.getElementById('dispatchSelectedSummary');
            if (summary) summary.style.display = 'none';
        },

        restoreDispatchDraft: function () {
            var scope = _stockManagementGrid;
            var json;
            try {
                json = localStorage.getItem('kernel_dispatch_draft');
            } catch (e) { return; }
            if (!json) return;
            var draft;
            try {
                draft = JSON.parse(json);
            } catch (e) { return; }
            if (!draft || !Array.isArray(draft.dispatchSelectedLines)) return;
            scope.dispatchOrderDetails = draft.dispatchOrderDetails || {};
            scope.dispatchSelectedLines = draft.dispatchSelectedLines;
            scope.renderKernelStockByStyle();
            scope.renderDispatchSelectedList();
            var summary = document.getElementById('dispatchSelectedSummary');
            if (summary) summary.style.display = scope.dispatchSelectedLines.length > 0 ? '' : 'none';
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
            var addOilBtn = document.getElementById('addOilLotBtn');
            var importOilBtn = document.getElementById('importOilLotsBtn');
            if (stream === 'kernel') {
                if (card) card.style.display = '';
                scope.loadKernelBatches();
                if (oilCard) oilCard.style.display = 'none';
                if (mainFiltersCard) mainFiltersCard.style.display = 'none';
                if (mainTableCard) mainTableCard.style.display = 'none';
                if (addOilBtn) addOilBtn.classList.add('d-none');
                if (importOilBtn) importOilBtn.classList.add('d-none');
            } else {
                if (card) card.style.display = 'none';
                if (oilCard) oilCard.style.display = '';
                if (mainFiltersCard) mainFiltersCard.style.display = '';
                if (mainTableCard) mainTableCard.style.display = '';
                if (addOilBtn) addOilBtn.classList.remove('d-none');
                if (importOilBtn) importOilBtn.classList.remove('d-none');
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
            var maxDropdownOptions = 51;
            batches.forEach(function (b) {
                var cells = (b.remaining_by_style && typeof b.remaining_by_style === 'object') ? b.remaining_by_style : null;
                if (cells == null) cells = (b.yield_by_style && typeof b.yield_by_style === 'object') ? b.yield_by_style : {};
                var batchId = (b.id || '');
                var batchNum = (b.batch_number || '').toString().replace(/"/g, '&quot;');
                var row = '<tr><td>' + batchNum + '</td>';
                styleKeys.forEach(function (k) {
                    var val = cells[k] != null ? cells[k] : (b['yield_' + k] != null ? b['yield_' + k] : 0);
                    if (typeof val === 'number') totals[k] += val;
                    var qty = (typeof val === 'number' && val > 0) ? Math.floor(val) : 0;
                    var displayVal = (val !== 0 && val !== '' && val != null) ? val : '—';
                    if (qty > 0) {
                        var cellId = 'kcell_' + (batchId + '_' + k).replace(/[^a-zA-Z0-9_-]/g, '_');
                        var maxOpt = Math.min(qty, maxDropdownOptions - 1);
                        var menuItems = '<li><a class="dropdown-item js-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="0">0 (clear)</a></li>';
                        for (var n = 1; n <= maxOpt; n++) {
                            menuItems += '<li><a class="dropdown-item js-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="' + n + '">' + n + '</a></li>';
                        }
                        if (qty > maxOpt) {
                            menuItems += '<li><a class="dropdown-item js-dispatch-qty-pick" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-quantity="' + qty + '">' + qty + ' (max)</a></li>';
                        }
                        menuItems += '<li><hr class="dropdown-divider"></li><li><a class="dropdown-item js-dispatch-qty-other" href="#" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-max-qty="' + qty + '">Other…</a></li>';
                        row += '<td class="text-end kernel-qty-cell"><div class="dropdown">' +
                            '<button class="btn btn-sm btn-outline-secondary py-0 px-1 js-kernel-qty-dropdown" type="button" id="' + cellId + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Add boxes">' + displayVal + '</button>' +
                            '<ul class="dropdown-menu dropdown-menu-end js-kernel-qty-menu" aria-labelledby="' + cellId + '" data-batch-id="' + (batchId.replace(/"/g, '&quot;')) + '" data-style="' + (k.replace(/"/g, '&quot;')) + '" data-max-qty="' + qty + '">' + menuItems + '</ul></div></td>';
                    } else {
                        row += '<td class="text-end">' + displayVal + '</td>';
                    }
                });
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

        renderDispatchSelectedList: function () {
            var scope = _stockManagementGrid;
            var listEl = document.getElementById('dispatchSelectedList');
            var totalLabel = document.getElementById('dispatchSelectedTotalLabel');
            if (!listEl) return;
            if (scope.dispatchSelectedLines.length === 0) {
                listEl.innerHTML = '<p class="text-muted small mb-0">No boxes selected. Click a quantity cell in the table above to choose how many boxes to add from that batch and style.</p>';
                if (totalLabel) totalLabel.textContent = 'Total: 0 kg';
                return;
            }
            var batches = scope.kernelFinishedBatches || [];
            var batchMap = {};
            batches.forEach(function (b) { batchMap[b.id] = b; });
            var totalKg = 0;
            var html = '<div class="table-responsive"><table class="table table-sm table-bordered mb-0 align-middle">' +
                '<thead class="table-light"><tr><th>Batch</th><th>Style</th><th class="text-end">Qty (kg)</th><th></th></tr></thead><tbody>';
            scope.dispatchSelectedLines.forEach(function (line) {
                var batchId = line.production_batch_id || line.batch_id;
                var style = line.style != null ? String(line.style) : '';
                var batch = batchMap[batchId];
                var batchNum = batch ? batch.batch_number : batchId;
                var qty = parseFloat(line.quantity_kg) || 0;
                totalKg += qty;
                var cells = batch && (batch.remaining_by_style && typeof batch.remaining_by_style === 'object') ? batch.remaining_by_style : (batch && batch.yield_by_style && typeof batch.yield_by_style === 'object' ? batch.yield_by_style : {});
                var styleVal = cells[style] != null ? cells[style] : (batch && batch['yield_' + style] != null ? batch['yield_' + style] : 0);
                var maxQty = (typeof styleVal === 'number' && styleVal > 0) ? Math.floor(styleVal) : 1;
                var styleAttr = (style || '').replace(/"/g, '&quot;');
                html += '<tr><td><span class="badge bg-primary">' + (batchNum || '—') + '</span></td><td>' + (line.style || '—') + '</td><td class="text-end">' + qty + '</td>' +
                    '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-primary js-dispatch-edit-line me-1" title="Edit quantity" data-batch-id="' + (batchId || '') + '" data-style="' + styleAttr + '" data-current-qty="' + qty + '" data-max-qty="' + maxQty + '"><i class="fas fa-edit"></i></button>' +
                    '<button type="button" class="btn btn-sm btn-danger js-dispatch-remove-line" title="Remove from basket" data-batch-id="' + (batchId || '') + '" data-style="' + styleAttr + '"><i class="fas fa-times"></i></button></td></tr>';
            });
            html += '</tbody></table></div>';
            listEl.innerHTML = html;
            if (totalLabel) totalLabel.textContent = 'Total: ' + totalKg.toFixed(1) + ' kg';
        },

        submitDispatchOrder: function () {
            var scope = _stockManagementGrid;
            if (!scope.dispatchOrderDetails || !scope.dispatchOrderDetails.buyer_name) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire({
                        title: 'Enter buyer and delivery date',
                        text: 'Please fill in the buyer and delivery date so we can complete the dispatch.',
                        icon: 'info',
                        confirmButtonText: 'OK'
                    }).then(function (r) {
                        if (r && r.isConfirmed && typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.show) {
                            _modal_stock_send_to_dispatch.show();
                        }
                    });
                } else if (typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.show) {
                    _modal_stock_send_to_dispatch.show();
                }
                return;
            }
            if (scope.dispatchSelectedLines.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Validation', 'Please select at least one box from the table.', 'warning');
                return;
            }
            var lines = scope.dispatchSelectedLines.map(function (l) {
                return { production_batch_id: l.production_batch_id || l.batch_id, style: l.style, quantity_kg: l.quantity_kg };
            });
            dataFunctions.createKernelDispatchOrder({
                buyer_name: scope.dispatchOrderDetails.buyer_name,
                buyer_contact_id: scope.dispatchOrderDetails.buyer_contact_id || null,
                delivery_date: scope.dispatchOrderDetails.delivery_date,
                lines: lines
            }).then(function (result) {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Sent', text: 'Dispatch order created successfully.', timer: 2000, showConfirmButton: false });
                    scope.dispatchSelectedLines = [];
                    scope.dispatchOrderDetails = {};
                    scope.clearDispatchDraft();
                    var summary = document.getElementById('dispatchSelectedSummary');
                    if (summary) summary.style.display = 'none';
                    setTimeout(function () {
                        scope.loadKernelBatches(true);
                    }, 300);
                } else throw new Error(result && result.error ? result.error : 'Failed to create dispatch order');
            }).catch(function (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to create dispatch order', 'error');
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
