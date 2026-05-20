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

    /** Return ISO week key "YYYY-Www" for grouping (e.g. 2026-W10). Same as Supplier Intake / Grower Intake. */
    function getIsoWeekKey(d) {
        if (!d) return '';
        var date;
        if (typeof d === 'string') {
            var s = d.trim();
            date = (s.indexOf('T') !== -1) ? new Date(s) : new Date(s + 'T12:00:00');
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

    /** Sum total kg from yield_by_style object (all style keys). */
    function totalKgFromYield(b) {
        var o = kernelStyleMapFromBatch(b, 'yield_by_style');
        var sum = 0;
        Object.keys(o).forEach(function (k) {
            var v = o[k];
            if (v != null && v !== '') sum += (typeof v === 'number' ? v : parseFloat(v)) || 0;
        });
        return sum;
    }

    /** Sum total kg from remaining_by_style object. */
    function totalKgFromRemaining(b) {
        var o = kernelStyleMapFromBatch(b, 'remaining_by_style');
        var sum = 0;
        Object.keys(o).forEach(function (k) {
            var v = o[k];
            if (v != null && v !== '') sum += (typeof v === 'number' ? v : parseFloat(v)) || 0;
        });
        return sum;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        var str = String(s);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function parseNum(val) {
        if (val == null || val === '') return 0;
        var n = typeof val === 'number' ? val : parseFloat(val);
        return isNaN(n) ? 0 : n;
    }

    /** Normalize API date to yyyy-mm-dd for date inputs. */
    function isoDateOnlyForInput(v) {
        if (v == null || v === '') return '';
        var s = String(v).trim();
        if (s.indexOf('T') !== -1) return s.split('T')[0];
        if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        return s;
    }

    /** Style maps from API may be plain objects or JSON strings (proxy); normalize for sums and display. */
    function kernelStyleMapFromBatch(batch, prop) {
        var v = batch && batch[prop];
        if (v == null) return {};
        if (typeof v === 'object' && !Array.isArray(v)) return v;
        if (typeof v === 'string') {
            var s = v.trim();
            if (s === '' || s === 'null') return {};
            try {
                var p = JSON.parse(s);
                if (typeof p === 'object' && p !== null && !Array.isArray(p)) return p;
            } catch (e) { /* ignore */ }
        }
        return {};
    }

    /** Kernel row id for RPCs (proxy may send batches.id as Id — server resolves either). */
    function kernelIdFromBatch(b) {
        if (!b) return '';
        if (b.kernel_id != null && b.kernel_id !== '') return String(b.kernel_id);
        if (b.KernelId != null && b.KernelId !== '') return String(b.KernelId);
        if (b.id != null && b.id !== '') return String(b.id);
        if (b.Id != null && b.Id !== '') return String(b.Id);
        return '';
    }

    function batchNumberFromBatch(b) {
        if (!b) return '';
        var n = b.batch_number != null ? b.batch_number : (b.BatchNumber != null ? b.BatchNumber : '');
        return n != null ? String(n).trim() : '';
    }

    function kernelBatchStatusIsFinishedStock(b) {
        if (!b) return false;
        var st = b.status != null ? String(b.status).trim() : '';
        return st === 'complete' || st === 'in_finished_stock';
    }

    /** True when any kernel dispatch order line references this kernel id (from get_kernel_batches). */
    function kernelBatchHasDispatch(b) {
        if (!b) return false;
        if (b.has_dispatch === true || b.HasDispatch === true) return true;
        if (b.has_dispatch === false || b.HasDispatch === false) return false;
        return false;
    }

    var KERNEL_STYLE_OPTIONS = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];
    /** Long hover text so users can see which style a column is without scrolling to the header. */
    var KERNEL_STYLE_DESCRIPTION = {
        'SP': 'Sound Kernel SP — premium SP grade',
        '0': 'Sound kernel — style 0',
        '1': 'Sound kernel — style 1',
        '1S': 'Sound kernel — style 1S',
        '4L': 'Sound kernel — style 4L',
        '5': 'Sound kernel — style 5',
        '6': 'Sound kernel — style 6',
        '7/8': 'Butter — style 7/8',
        'Butter High Oil': 'Butter High Oil grade',
        'Butter Low Oil': 'Butter Low Oil grade'
    };

    function kernelStyleStockCellTitle(styleKey, adjustMode) {
        var line = (KERNEL_STYLE_DESCRIPTION[styleKey] || styleKey) + '. Values are remaining cartons (or carton equivalent from kg).';
        if (adjustMode) line += ' Click to adjust stock.';
        return line;
    }

    function kernelStyleWeeklyCellTitle(styleKey) {
        return (KERNEL_STYLE_DESCRIPTION[styleKey] || styleKey) + '. Values are kg for this style in this week.';
    }

    /** Same nominal kg/carton as dispatch / get_kernel_batches (for carton equivalent when only kg is recorded). */
    var KERNEL_KG_PER_CARTON = 11.34;

    /**
     * Per-style on-hand in cartons: use remaining cartons from the API; if none but remaining kg exists, show carton equivalent (kg / 11.34).
     */
    function getKernelStyleCellsForDisplay(batch) {
        var remKg = kernelStyleMapFromBatch(batch, 'remaining_by_style');
        var remCart = kernelStyleMapFromBatch(batch, 'remaining_by_style_cartons');
        var out = {};
        KERNEL_STYLE_OPTIONS.forEach(function (k) {
            var rk = parseNum(remKg[k]);
            var rc = parseNum(remCart[k]);
            if (rc > 0) {
                out[k] = rc;
            } else if (rk > 0) {
                out[k] = Math.round((rk / KERNEL_KG_PER_CARTON) * 100) / 100;
            } else {
                out[k] = 0;
            }
        });
        return out;
    }

    /**
     * Kernel by-style grid: normally list only batches that still show remaining on hand.
     * In adjust-stock mode also list batches that have production yield but zero remaining — otherwise
     * the grid looked empty / non-editable after full dispatch when users still need to correct stock.
     */
    function kernelBatchVisibleInByStyleGrid(batch, adjustMode) {
        var cells = getKernelStyleCellsForDisplay(batch);
        var hasRemaining = KERNEL_STYLE_OPTIONS.some(function (k) {
            return parseNum(cells[k]) > 0;
        });
        if (hasRemaining) return true;
        // Finished batches with no dispatch lines still belong in stock on hand until first dispatch.
        if (batch && kernelBatchStatusIsFinishedStock(batch) && !kernelBatchHasDispatch(batch)) {
            return true;
        }
        if (!adjustMode || !batch) return false;
        var yieldObj = kernelStyleMapFromBatch(batch, 'yield_by_style');
        return KERNEL_STYLE_OPTIONS.some(function (k) {
            return parseNum(yieldObj[k]) > 0;
        });
    }

    return {
        stockItems: [],
        filteredStockItems: [],
        oilLots: [],
        oilDispatchOrdersWithLines: null,
        oilCurrentView: 'bystock',
        oilWeeklyMode: 'in',
        kernelRawBatches: [],
        kernelFinishedBatches: [],
        kernelDispatchOrders: [],
        kernelDispatchOrdersWithLines: null,
        kernelCurrentView: 'bystyle',
        kernelWeeklyMode: 'in',
        kernelAdjustMode: false,
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
                // Move dispatch modals to body so they are outside container-fluid and not affected by aria-hidden
                ['sendToDispatchModal', 'sendToDispatchOilModal', 'oilBulkAddStockModal'].forEach(function (id) {
                    var el = document.getElementById(id);
                    if (el && el.parentNode && el.parentNode !== document.body) {
                        document.body.appendChild(el);
                    }
                });
                if (typeof _modal_stock_stock_take !== 'undefined' && _modal_stock_stock_take.init) _modal_stock_stock_take.init();
                if (typeof _modal_stock_raw_material_issued !== 'undefined' && _modal_stock_raw_material_issued.init) _modal_stock_raw_material_issued.init();
                if (typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.init) _modal_stock_send_to_dispatch.init();
                if (typeof _modal_stock_oil_lot !== 'undefined' && _modal_stock_oil_lot.init) _modal_stock_oil_lot.init();
                if (typeof _modal_stock_import_oil_lots !== 'undefined' && _modal_stock_import_oil_lots.init) _modal_stock_import_oil_lots.init();
                if (typeof _modal_stock_oil_bulk_add !== 'undefined' && _modal_stock_oil_bulk_add.init) _modal_stock_oil_bulk_add.init();
                return delay(100);
            }).then(function () {
                var stream = document.getElementById('filterStockStream') ? document.getElementById('filterStockStream').value : 'kernel';
                if (document.getElementById('exportStockBtn')) {
                    scope.setupEventListeners();
                    // Kernel / oil stock UIs use get_kernel_batches / oil lots only; skip legacy get_stock_items
                    // (avoids DB error when public.stock_items is not deployed).
                    if (stream !== 'kernel' && stream !== 'oil') {
                        scope.loadStockItems();
                    } else {
                        scope.stockItems = [];
                        scope.filteredStockItems = [];
                    }
                    scope.toggleKernelBatchJourney(stream);
                    if (document.getElementById('oilStockOilTableBody')) scope.loadOilLotsAndSummary(true);
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
                if (subtitleEl) subtitleEl.textContent = 'Track kernel batches by style (totals across the top, on hand from the saved job card). Production prefills the job card; correct style lines there if needed, then save—stock updates to match. Select a batch and send to dispatch—or export when you\'re ready.';
            } else if (route === 'stock-management-oil') {
                stream = 'oil';
                if (titleEl) titleEl.textContent = 'Stock (Oil & Protein)';
                if (subtitleEl) subtitleEl.textContent = 'Oil stock on top, protein powder below. Use Add stock for many batches at once (like Supplier Intake adjust stock), Add lot for a single row, or import from Excel. Weekly in/out, send to dispatch when ready—export anytime.';
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
                $('#importHistoricalKernelBtn').off('click').on('click', function () {
                    var modalEl = document.getElementById('importHistoricalKernelModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                        modal.show();
                    } else if (modalEl) modalEl.classList.add('show');
                });
                $('#refreshKernelStockBtn').off('click').on('click', function () {
                    scope.loadKernelBatches(true);
                });
                $('#toggleKernelAdjustModeBtn').off('click').on('click', function () {
                    scope.setKernelAdjustMode(!scope.kernelAdjustMode);
                });
                $('#kernelAdjustModeAddBatchBtn').off('click').on('click', function () {
                    scope.promptCreateKernelBatchFromStock();
                });
                $('#importHistoricalKernelRefreshBtn').off('click').on('click', function () {
                    scope.loadKernelBatches(true);
                    var modalEl = document.getElementById('importHistoricalKernelModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modal = bootstrap.Modal.getInstance(modalEl);
                        if (modal) modal.hide();
                    }
                });
                $('#sendToDispatchOilBtn').off('click').on('click', function () {
                    if (typeof _modal_stock_send_to_dispatch_oil !== 'undefined' && _modal_stock_send_to_dispatch_oil.show) _modal_stock_send_to_dispatch_oil.show();
                });
                $('#refreshOilStockBtn').off('click').on('click', function () {
                    scope.loadOilLotsAndSummary(true);
                });
                $('#oilBulkAddStockBtn').off('click').on('click', function () {
                    if (typeof _modal_stock_oil_bulk_add !== 'undefined' && _modal_stock_oil_bulk_add.show) _modal_stock_oil_bulk_add.show();
                });
                $('#osViewByStock, #osViewWeekly, #osViewOverview').off('click').on('click', function () {
                    var v = $(this).data('oil-view');
                    if (v) scope.toggleOilView(v);
                });
                $('#osWeeklyViewMode').off('change').on('change', function () {
                    scope.oilWeeklyMode = $(this).val() || 'in';
                    scope.renderOilWeekly();
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
                $('#ksViewByStyle, #ksViewWeekly, #ksViewOverview').off('click').on('click', function () {
                    var view = $(this).data('view');
                    if (view) scope.toggleKernelView(view);
                });
                $('#ksWeeklyViewMode').off('change').on('change', function () {
                    scope.kernelWeeklyMode = $(this).val() || 'in';
                    scope.renderKernelWeekly();
                });
                $(document).on('click', '.js-release-batch-to-production', function () {
                    var $btn = $(this);
                    var kernelId = $btn.attr('data-kernel-id') || $btn.attr('data-batch-id') || '';
                    var batchNumber = $btn.attr('data-batch-number') || '';
                    if (kernelId || batchNumber) {
                        scope.confirmAndReleaseBatchToProduction(kernelId, batchNumber);
                    }
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
                $(document).on('click', '.edit-kernel-batch-btn', function () {
                    var id = $(this).data('kernel-id');
                    if (id) scope.promptEditKernelBatch(id);
                });
                $(document).on('click', '.delete-kernel-batch-btn', function () {
                    var id = $(this).data('kernel-id');
                    var label = $(this).data('batch-label');
                    if (id) scope.deleteKernelBatch(id, label);
                });
                $(document).on('click', '.adjust-oil-lot-btn', function () {
                    var id = $(this).data('oil-lot-id');
                    var lot = (scope.oilLots || []).find(function (x) { return String(x.id) === String(id); });
                    if (lot) scope.promptAdjustOilLot(lot);
                });
                $(document).on('click', '.oil-batch-ingredients-btn', function () {
                    var bn = $(this).attr('data-oil-batch-number');
                    if (bn) scope.showOilBatchIngredientsModal(String(bn));
                });
            }

            var oilSearchInput = document.getElementById('oilSearchInput');
            if (oilSearchInput) {
                oilSearchInput.addEventListener('input', function () {
                    clearTimeout(scope.oilSearchTimeout);
                    scope.oilSearchTimeout = setTimeout(function () { scope.loadOilLotsAndSummary(); }, 300);
                });
            }

            scope.ensureKernelStockByStyleAdjustListeners();
        },

        /**
         * Delegated handlers on document so clicks work after every re-render (tbody rows are replaced;
         * a listener bound only once on tbody was fragile). Namespaced handlers are refreshed from setupEventListeners.
         */
        ensureKernelStockByStyleAdjustListeners: function () {
            var scope = _stockManagementGrid;
            if (typeof $ === 'undefined') return;
            $(document).off('mousedown.kernelAdjStock').on('mousedown.kernelAdjStock', '#kernelStockByStyleBody td[data-kernel-stock-adjust="1"]', function (e) {
                if (!scope.kernelAdjustMode) return;
                e.preventDefault();
            });
            $(document).off('click.kernelAdjStock').on('click.kernelAdjStock', '#kernelStockByStyleBody td[data-kernel-stock-adjust="1"]', function (e) {
                e.preventDefault();
                e.stopPropagation();
                scope.handleKernelStockAdjustTd(this);
            });
        },

        handleKernelStockAdjustTd: function (td) {
            var scope = _stockManagementGrid;
            if (!td) return;
            if (!scope.kernelAdjustMode) {
                if (typeof Swal !== 'undefined') Swal.fire('Adjust Stock', 'Press the Adjust Stock button first, then click the batch/style cell you want to change.', 'info');
                else window.alert('Press Adjust Stock first, then click a style cell.');
                return;
            }
            var kernelId = (td.getAttribute('data-kernel-id') || '').trim();
            var style = td.getAttribute('data-style') || '';
            var batchNumber = (td.getAttribute('data-batch-number') || '').trim();
            if (!style) return;
            var batch = null;
            if (kernelId) {
                batch = (scope.kernelFinishedBatches || []).find(function (x) { return kernelIdFromBatch(x) === String(kernelId); }) || null;
            }
            if (!batch && batchNumber) {
                batch = (scope.kernelFinishedBatches || []).find(function (x) { return String(x.batch_number) === String(batchNumber); }) || null;
            }
            if (!batch && kernelId) batch = { id: kernelId, batch_number: batchNumber || 'Kernel batch' };
            if (batch) scope.promptAdjustKernelStockCell(batch, style);
            else if (typeof Swal !== 'undefined') Swal.fire('Error', 'Kernel batch not found. Refresh and try again.', 'error');
            else window.alert('Kernel batch not found. Refresh and try again.');
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
                if (stream === 'oil' && document.getElementById('oilStockOilTableBody')) scope.loadOilLotsAndSummary(true);
            }
        },

        loadKernelBatches: function (forceRefresh) {
            var scope = _stockManagementGrid;
            var df = (typeof _dataFunctions !== 'undefined' && _dataFunctions && typeof _dataFunctions.getKernelBatches === 'function')
                ? _dataFunctions
                : (typeof dataFunctions !== 'undefined' && dataFunctions ? dataFunctions : null);
            var loadDispatch = (typeof dataFunctions !== 'undefined' && dataFunctions && dataFunctions.getKernelDispatchOrders)
                ? dataFunctions.getKernelDispatchOrders(null, forceRefresh).catch(function () { return []; })
                : Promise.resolve([]);
            if (!df) {
                console.warn('[Stock Management] getKernelBatches not available (_dataFunctions/dataFunctions)');
                scope.kernelFinishedBatches = [];
                scope.kernelDispatchOrders = [];
                scope.renderKernelBatches();
                return Promise.resolve();
            }
            return df.getKernelBatches(null, forceRefresh, { status: 'complete' }).then(function (all) {
                all = (all || []).filter(function (b) {
                    var st = b && b.status != null ? String(b.status).trim() : '';
                    return st === 'complete' || st === 'in_finished_stock';
                });
                scope.kernelRawBatches = [];
                scope.kernelFinishedBatches = all;
                scope.renderKernelBatches();
                return loadDispatch;
            }).then(function (orders) {
                scope.kernelDispatchOrders = Array.isArray(orders) ? orders : [];
                scope.kernelDispatchOrdersWithLines = null;
                if (scope.kernelCurrentView === 'weekly') scope.renderKernelWeekly();
                if (scope.kernelCurrentView === 'overview') scope.renderKernelOverview();
            }).catch(function (e) {
                console.error('[Stock Management] loadKernelBatches failed:', e);
                scope.kernelRawBatches = [];
                scope.kernelFinishedBatches = [];
                scope.kernelDispatchOrders = [];
                scope.renderKernelBatches();
            });
        },

        /** Load full order details (with lines) for all dispatched orders; cache in kernelDispatchOrdersWithLines. */
        loadKernelDispatchOrdersWithLines: function () {
            var scope = _stockManagementGrid;
            var df = (typeof dataFunctions !== 'undefined' && dataFunctions && dataFunctions.getKernelDispatchOrder) ? dataFunctions : null;
            if (!df) return Promise.resolve();
            var dispatched = (scope.kernelDispatchOrders || []).filter(function (o) { return o.dispatched_at; });
            if (dispatched.length === 0) {
                scope.kernelDispatchOrdersWithLines = [];
                return Promise.resolve();
            }
            return Promise.all(dispatched.map(function (o) { return df.getKernelDispatchOrder(o.id); })).then(function (results) {
                scope.kernelDispatchOrdersWithLines = (results || []).filter(function (r) { return r && r.order && Array.isArray(r.lines); });
            }).catch(function (e) {
                console.error('[Stock Management] loadKernelDispatchOrdersWithLines failed:', e);
                scope.kernelDispatchOrdersWithLines = [];
            });
        },

        renderKernelBatches: function () {
            _stockManagementGrid.renderKernelStockByStyle();
        },

        setKernelAdjustMode: function (enabled) {
            var scope = _stockManagementGrid;
            scope.kernelAdjustMode = enabled === true;
            var btn = document.getElementById('toggleKernelAdjustModeBtn');
            var hint = document.getElementById('kernelAdjustModeHint');
            var addBatchRow = document.getElementById('kernelAdjustModeAddBatchRow');
            if (btn) {
                btn.classList.toggle('btn-outline-primary', !scope.kernelAdjustMode);
                btn.classList.toggle('btn-primary', scope.kernelAdjustMode);
                btn.innerHTML = scope.kernelAdjustMode
                    ? '<i class="fas fa-times me-1"></i>Exit Adjust Stock'
                    : '<i class="fas fa-balance-scale me-1"></i>Adjust Stock';
            }
            if (hint) hint.style.display = scope.kernelAdjustMode ? '' : 'none';
            if (addBatchRow) addBatchRow.style.display = scope.kernelAdjustMode ? '' : 'none';
            if (scope.kernelCurrentView === 'bystyle') scope.renderKernelStockByStyle();
        },

        promptCreateKernelBatchFromStock: async function () {
            var scope = _stockManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.importHistoricalKernelBatch || typeof Swal === 'undefined') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create batch is not available right now.', 'error');
                return;
            }
            if (!dataFunctions.getKernelBatches) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Kernel batch list is not available.', 'error');
                return;
            }
            try {
                await scope.loadKernelBatches(true);
            } catch (e1) {
                console.warn('[Stock Management] loadKernelBatches before Add Batch:', e1);
            }
            var contacts = [];
            try {
                contacts = await ((dataFunctions.getContacts && dataFunctions.getContacts()) || Promise.resolve([]));
            } catch (e) {
                contacts = [];
            }
            var supplierOptions = ['<option value="">Select supplier</option>'];
            (contacts || []).forEach(function (contact) {
                var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                supplierOptions.push('<option value="' + escapeHtml(String(contact.id || '')) + '">' + escapeHtml(String(name)) + '</option>');
            });
            var today = new Date().toISOString().split('T')[0];
            var styleFieldDefs = [
                { key: 'sk_sp_qty', label: 'SP' },
                { key: 'sk_0_qty', label: '0' },
                { key: 'sk_1_qty', label: '1' },
                { key: 'sk_1s_qty', label: '1S' },
                { key: 'sk_4l_qty', label: '4L' },
                { key: 'sk_5_qty', label: '5' },
                { key: 'sk_6_qty', label: '6' },
                { key: 'bt_78_qty', label: '7/8' },
                { key: 'bt_high_qty', label: 'Butter High Oil' },
                { key: 'bt_low_qty', label: 'Butter Low Oil' }
            ];
            var restorePickKernelId = null;
            var addBatchMatchDebounce = null;
            function renderAddBatchCompletedMatches() {
                var listEl = document.getElementById('swalStockBatchMatchList');
                var batchNumberEl = document.getElementById('swalStockBatchNumber');
                if (!listEl || !batchNumberEl) return;
                var q = (batchNumberEl.value || '').trim().toLowerCase();
                if (!q) {
                    listEl.innerHTML = '';
                    listEl.style.display = 'none';
                    return;
                }
                var matches = (scope.kernelFinishedBatches || []).filter(function (b) {
                    if (!kernelBatchStatusIsFinishedStock(b)) return false;
                    var bn = batchNumberFromBatch(b).toLowerCase();
                    return bn && bn.indexOf(q) !== -1;
                });
                matches.sort(function (a, b) {
                    var an = batchNumberFromBatch(a);
                    var bn = batchNumberFromBatch(b);
                    var ae = an.toLowerCase() === q ? 0 : 1;
                    var be = bn.toLowerCase() === q ? 0 : 1;
                    if (ae !== be) return ae - be;
                    return String(an).localeCompare(String(bn), undefined, { numeric: true, sensitivity: 'base' });
                });
                if (matches.length === 0) {
                    listEl.innerHTML = '<div class="stock-addbatch-match-empty p-2 small text-muted">No completed batches match. Continue below to create a new historical batch with this number.</div>';
                    listEl.style.display = '';
                    return;
                }
                var maxRows = 40;
                var slice = matches.slice(0, maxRows);
                var more = matches.length > maxRows ? '<div class="p-2 small text-muted border-top">Showing first ' + maxRows + ' of ' + matches.length + ' matches — type more characters to narrow.</div>' : '';
                listEl.innerHTML = slice.map(function (b) {
                    var id = kernelIdFromBatch(b);
                    var bn = batchNumberFromBatch(b);
                    var g = ((b.grower_name != null ? b.grower_name : b.GrowerName) || '').toString().trim();
                    var disp = kernelBatchHasDispatch(b);
                    var badge = disp
                        ? '<span class="badge bg-secondary ms-1">Dispatch</span>'
                        : '<span class="badge bg-success ms-1">No dispatch</span>';
                    var vis = kernelBatchVisibleInByStyleGrid(b, false)
                        ? '<span class="text-muted small ms-1">On By style</span>'
                        : '<span class="text-muted small ms-1">Use Adjust Stock</span>';
                    return '<button type="button" class="stock-addbatch-match-row js-stock-addbatch-pick list-group-item list-group-item-action py-2 px-3 text-start w-100 border-0 border-bottom"' +
                        ' data-kernel-id="' + escapeHtml(id) + '"' +
                        (id ? '' : ' disabled') + '>' +
                        '<span class="fw-semibold">' + escapeHtml(bn || '—') + '</span>' +
                        (g ? '<span class="text-muted"> · ' + escapeHtml(g) + '</span>' : '') +
                        badge + vis +
                        '</button>';
                }).join('') + more;
                listEl.style.display = '';
            }
            var refreshSuggestedBatchNumber = async function () {
                var supplierEl = document.getElementById('swalStockBatchSupplier');
                var dateEl = document.getElementById('swalStockBatchReceivedDate');
                var batchNumberEl = document.getElementById('swalStockBatchNumber');
                if (!supplierEl || !dateEl || !batchNumberEl) return;
                var supplierId = supplierEl.value || null;
                var year = dateEl.value && dateEl.value.length >= 4 ? parseInt(dateEl.value.slice(0, 4), 10) : new Date().getFullYear();
                if (!supplierId) {
                    batchNumberEl.placeholder = 'Type to search completed batches, or select supplier for a suggested new number';
                    return;
                }
                if ((batchNumberEl.value || '').trim() !== '') {
                    return;
                }
                try {
                    var nextId = await ((dataFunctions.getNextBatchNumber && dataFunctions.getNextBatchNumber(supplierId, year)) || Promise.resolve(null));
                    batchNumberEl.value = nextId || '';
                    batchNumberEl.placeholder = nextId ? '' : 'Will assign on save';
                } catch (e2) {
                    batchNumberEl.value = '';
                    batchNumberEl.placeholder = 'Will assign on save';
                }
            };
            var result = await Swal.fire({
                title: 'Add Batch',
                width: 760,
                showCancelButton: true,
                confirmButtonText: 'Continue',
                html:
                    '<div class="text-start">' +
                    '<label class="form-label">Batch number</label>' +
                    '<input id="swalStockBatchNumber" class="form-control mb-1" placeholder="Type to search completed batches, or enter a new number" autocomplete="off">' +
                    '<p class="small text-muted mb-2">Matching <strong>completed</strong> batches appear below. Click one to bring it back into the By style stock view (turns on Adjust Stock and refreshes). Otherwise fill in supplier and styles and press Continue to create a <strong>new</strong> historical batch.</p>' +
                    '<div id="swalStockBatchMatchList" class="stock-addbatch-match-list list-group mb-3" style="display:none;"></div>' +
                    '<hr class="my-3">' +
                    '<p class="small fw-semibold mb-2">Create a new batch (historical)</p>' +
                    '<label class="form-label">Supplier <span class="text-danger">*</span> <span class="text-muted fw-normal">(new batch only)</span></label>' +
                    '<select id="swalStockBatchSupplier" class="form-select mb-3" required>' + supplierOptions.join('') + '</select>' +
                    '<label class="form-label">Received date <span class="text-danger">*</span></label>' +
                    '<input id="swalStockBatchReceivedDate" type="date" class="form-control mb-3" value="' + escapeHtml(today) + '">' +
                    '<label class="form-label">Wet NIS received (kg)</label>' +
                    '<input id="swalStockBatchWetNis" type="number" step="0.01" min="0" class="form-control mb-3">' +
                    '<label class="form-label">FFA</label>' +
                    '<input id="swalStockBatchFfa" type="number" step="0.01" min="0" class="form-control mb-3">' +
                    '<label class="form-label">Best Before Date</label>' +
                    '<input id="swalStockBatchBestBeforeDate" type="date" class="form-control mb-3">' +
                    '<label class="form-label">Styles (kg)</label>' +
                    '<div class="row g-2 mb-1">' +
                        styleFieldDefs.map(function (field) {
                            return '<div class="col-md-4">' +
                                '<label class="form-label small mb-1">' + escapeHtml(field.label) + '</label>' +
                                '<input id="swalStockBatch_' + escapeHtml(field.key) + '" type="number" step="0.01" min="0" class="form-control form-control-sm">' +
                            '</div>';
                        }).join('') +
                    '</div>' +
                    '</div>',
                didOpen: function () {
                    var supplierEl = document.getElementById('swalStockBatchSupplier');
                    var dateEl = document.getElementById('swalStockBatchReceivedDate');
                    var batchNumberEl = document.getElementById('swalStockBatchNumber');
                    var matchList = document.getElementById('swalStockBatchMatchList');
                    if (supplierEl) supplierEl.addEventListener('change', refreshSuggestedBatchNumber);
                    if (dateEl) dateEl.addEventListener('change', refreshSuggestedBatchNumber);
                    if (batchNumberEl) {
                        batchNumberEl.addEventListener('input', function () {
                            if (addBatchMatchDebounce) clearTimeout(addBatchMatchDebounce);
                            addBatchMatchDebounce = setTimeout(function () {
                                renderAddBatchCompletedMatches();
                            }, 200);
                        });
                    }
                    if (matchList) {
                        matchList.addEventListener('click', function (ev) {
                            var btn = ev.target && ev.target.closest ? ev.target.closest('.js-stock-addbatch-pick') : null;
                            if (!btn || btn.disabled) return;
                            ev.preventDefault();
                            var kid = btn.getAttribute('data-kernel-id');
                            if (!kid) return;
                            restorePickKernelId = String(kid).trim();
                            if (typeof Swal !== 'undefined' && Swal.clickConfirm) Swal.clickConfirm();
                        });
                    }
                },
                preConfirm: function () {
                    var rid = restorePickKernelId ? String(restorePickKernelId).trim() : '';
                    if (rid) {
                        return { mode: 'restore', kernel_id: rid };
                    }
                    var supplierId = (document.getElementById('swalStockBatchSupplier') || {}).value || '';
                    var batchNumber = ((document.getElementById('swalStockBatchNumber') || {}).value || '').trim();
                    var receivedDate = (document.getElementById('swalStockBatchReceivedDate') || {}).value || '';
                    var wetNisRaw = (document.getElementById('swalStockBatchWetNis') || {}).value || '';
                    var ffaRaw = (document.getElementById('swalStockBatchFfa') || {}).value || '';
                    var bestBeforeDate = (document.getElementById('swalStockBatchBestBeforeDate') || {}).value || '';
                    var styleValues = {};
                    var totalStyles = 0;
                    if (!supplierId) {
                        Swal.showValidationMessage('Select a supplier for a new batch, or click a completed batch in the list above');
                        return false;
                    }
                    if (!receivedDate) {
                        Swal.showValidationMessage('Enter a received date');
                        return false;
                    }
                    styleFieldDefs.forEach(function (field) {
                        var raw = (document.getElementById('swalStockBatch_' + field.key) || {}).value || '';
                        var num = raw === '' ? 0 : parseFloat(raw);
                        if (isNaN(num) || num < 0) num = 0;
                        styleValues[field.key] = num;
                        totalStyles += num;
                    });
                    if (totalStyles <= 0) {
                        Swal.showValidationMessage('Enter at least one style quantity for a new batch, or click a completed batch in the list above');
                        return false;
                    }
                    return {
                        mode: 'create',
                        supplier_id: supplierId,
                        batch_number: batchNumber || null,
                        received_date: receivedDate,
                        wet_nis_received_kg: wetNisRaw === '' ? null : parseFloat(wetNisRaw),
                        production_finished_at: receivedDate,
                        ffa: ffaRaw === '' ? null : parseFloat(ffaRaw),
                        best_before_date: bestBeforeDate || null,
                        style_values: styleValues
                    };
                }
            });
            if (!result || !result.isConfirmed || !result.value) return;
            try {
                if (result.value.mode === 'restore') {
                    scope.setKernelAdjustMode(true);
                    await scope.loadKernelBatches(true);
                    var pickedBn = '';
                    try {
                        var pid = String(result.value.kernel_id || '');
                        var pb = (scope.kernelFinishedBatches || []).find(function (x) { return kernelIdFromBatch(x) === pid; });
                        pickedBn = pb ? batchNumberFromBatch(pb) : '';
                    } catch (ePick) { /* ignore */ }
                    await Swal.fire({
                        icon: 'success',
                        title: 'Batch linked to stock',
                        text: pickedBn
                            ? ('Batch ' + pickedBn + ' is available in By style with Adjust Stock on. Edit quantities or send to dispatch as needed.')
                            : ('Adjust Stock is on and the batch list was refreshed. Edit quantities or send to dispatch as needed.'),
                        timer: 5200,
                        showConfirmButton: true,
                        confirmButtonText: 'OK'
                    });
                    return;
                }
                styleFieldDefs.forEach(function (field) {
                    result.value[field.key] = result.value.style_values && result.value.style_values[field.key] != null
                        ? result.value.style_values[field.key]
                        : 0;
                });
                delete result.value.style_values;
                delete result.value.mode;
                var payload = result.value;
                var df = (typeof _dataFunctions !== 'undefined' && _dataFunctions && _dataFunctions.importHistoricalKernelBatch)
                    ? _dataFunctions
                    : dataFunctions;
                if (!df || !df.importHistoricalKernelBatch) throw new Error('importHistoricalKernelBatch is not available');
                var bn = (payload.batch_number && String(payload.batch_number).trim()) ? String(payload.batch_number).trim() : '';
                if (!bn) {
                    var y = payload.received_date && String(payload.received_date).length >= 4
                        ? parseInt(String(payload.received_date).slice(0, 4), 10)
                        : new Date().getFullYear();
                    var nextBn = await ((df.getNextBatchNumber && df.getNextBatchNumber(payload.supplier_id, y)) || Promise.resolve(null));
                    if (!nextBn) throw new Error('Batch number is required, or supplier/date could not suggest one.');
                    payload.batch_number = nextBn;
                } else {
                    payload.batch_number = bn;
                }
                var rd = payload.received_date || '';
                if (rd && (!payload.production_finished_at || String(payload.production_finished_at).length <= 10)) {
                    payload.production_finished_at = String(rd).indexOf('T') === -1 ? (rd + 'T12:00:00') : payload.production_finished_at;
                }
                var createResult = await df.importHistoricalKernelBatch(payload);
                var inner = createResult;
                if (inner && inner.import_historical_kernel_batch !== undefined) {
                    inner = inner.import_historical_kernel_batch;
                    if (typeof inner === 'string') {
                        try { inner = JSON.parse(inner); } catch (e2) { inner = createResult; }
                    }
                }
                if (inner && inner.create_kernel_batch) inner = inner.create_kernel_batch;
                var ok = inner && (inner.success === true || inner.Success === true);
                var kid = inner && (
                    inner.kernel_id != null ? inner.kernel_id :
                        (inner.KernelId != null ? inner.KernelId :
                            (inner.id != null ? inner.id : inner.Id))
                );
                if (!ok) throw new Error((inner && (inner.error || inner.Error)) || 'Failed to create batch');
                if (kid == null) throw new Error('Server did not return a kernel id — batch may not be linked. Check proxy logs.');
                if (inner.batch_id != null && String(kid) === String(inner.batch_id) && inner.kernel_id == null) {
                    console.warn('[Stock Management] Create batch returned batches.id as id; send-back will resolve by batch_number.');
                }
                await Swal.fire({ icon: 'success', title: 'Batch created', text: 'New kernel batch added to the database.', timer: 2000, showConfirmButton: false });
                scope.loadKernelBatches(true);
            } catch (e) {
                console.error('[Stock Management] promptCreateKernelBatchFromStock failed:', e);
                Swal.fire('Error', e.message || 'Failed to create batch', 'error');
            }
        },

        renderKernelStockByStyle: function () {
            var scope = _stockManagementGrid;
            var body = $('#kernelStockByStyleBody');
            var totalsRow = $('#kernelStockByStyleTotalsRow');
            if (!body.length || !totalsRow.length) return;
            body.empty();
            var batches = (scope.kernelFinishedBatches || []).filter(function (b) {
                return kernelBatchVisibleInByStyleGrid(b, scope.kernelAdjustMode);
            });
            var totals = { 'SP': 0, '0': 0, '1': 0, '1S': 0, '4L': 0, '5': 0, '6': 0, '7/8': 0, 'Butter High Oil': 0, 'Butter Low Oil': 0 };
            var styleKeys = KERNEL_STYLE_OPTIONS.slice();
            batches.forEach(function (b) {
                var cells = getKernelStyleCellsForDisplay(b);
                var batchNum = (b.batch_number || '').toString();
                var row = '<tr><td>' + batchNum + '</td>';
                styleKeys.forEach(function (k) {
                    var val = cells[k] != null ? cells[k] : 0;
                    totals[k] += parseNum(val);
                    var displayVal = (val !== 0 && val !== '' && val != null) ? val : '—';
                    var stTitle = escapeHtml(kernelStyleStockCellTitle(k, scope.kernelAdjustMode)).replace(/"/g, '&quot;');
                    if (scope.kernelAdjustMode) {
                        row += '<td class="text-end table-warning kernel-stock-adjust-cell kernel-style-col" data-kernel-stock-adjust="1" data-kernel-id="' + escapeHtml(kernelIdFromBatch(b)) + '" data-batch-number="' + escapeHtml(batchNum) + '" data-style="' + escapeHtml(k) + '" title="' + stTitle + '">' +
                            '<span class="kernel-stock-adjust-value d-block w-100 text-end">' + displayVal + '</span>' +
                            '</td>';
                    } else {
                        row += '<td class="text-end kernel-style-col" title="' + stTitle + '">' + displayVal + '</td>';
                    }
                });
                var ffaVal = (b.ffa != null && b.ffa !== '') ? (typeof b.ffa === 'number' ? b.ffa : parseFloat(b.ffa)) : null;
                var ffaDisplay = (ffaVal != null && !isNaN(ffaVal)) ? ffaVal : '—';
                var bbVal = b.best_before_date;
                var bbDisplay = '—';
                if (bbVal) {
                    var d = typeof bbVal === 'string' ? new Date(bbVal) : bbVal;
                    if (!isNaN(d.getTime())) bbDisplay = d.getDate() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
                }
                var ffaTitle = 'Free Fatty Acids (from QA)';
                var bbTitle = bbDisplay !== '—' ? 'Best Before Date' : 'Best Before Date (from Job Card or packing completion + 18 months)';
                row += '<td class="text-end" title="' + ffaTitle.replace(/"/g, '&quot;') + '">' + ffaDisplay + '</td><td class="text-end" title="' + bbTitle.replace(/"/g, '&quot;') + '">' + bbDisplay + '</td>';
                var kid = kernelIdFromBatch(b);
                row += '<td class="text-center"><div class="d-inline-flex flex-wrap gap-1 justify-content-center align-items-center">';
                row += '<button type="button" class="btn btn-sm btn-outline-secondary js-release-batch-to-production" data-kernel-id="' + escapeHtml(kid) + '" data-batch-number="' + escapeHtml(batchNum) + '" title="Send this batch back to production"><i class="fas fa-undo me-1"></i>Send back to production</button>';
                if (kid) {
                    row += '<button type="button" class="btn btn-sm btn-outline-primary edit-kernel-batch-btn" data-kernel-id="' + escapeHtml(kid) + '" title="Edit batch details (number, grower, dates, FFA)"><i class="fas fa-edit me-1"></i>Edit</button>';
                    row += '<button type="button" class="btn btn-sm btn-outline-danger delete-kernel-batch-btn" data-kernel-id="' + escapeHtml(kid) + '" data-batch-label="' + escapeHtml(batchNum) + '" title="Delete batch (soft delete)"><i class="fas fa-trash me-1"></i>Delete</button>';
                }
                row += '</div></td>';
                row += '</tr>';
                body.append(row);
            });
            totalsRow.find('td[data-style]').each(function () {
                var k = $(this).data('style');
                $(this).text(totals[k] != null ? totals[k] : 0);
            });
        },

        toggleKernelView: function (view) {
            var scope = _stockManagementGrid;
            scope.kernelCurrentView = view;
            var byStylePanel = document.getElementById('ksByStylePanel');
            var weeklyPanel = document.getElementById('ksWeeklyPanel');
            var overviewPanel = document.getElementById('ksOverviewPanel');
            if (byStylePanel) byStylePanel.style.display = (view === 'bystyle') ? '' : 'none';
            if (weeklyPanel) weeklyPanel.style.display = (view === 'weekly') ? '' : 'none';
            if (overviewPanel) overviewPanel.style.display = (view === 'overview') ? '' : 'none';
            $('#ksViewByStyle').toggleClass('active', view === 'bystyle');
            $('#ksViewWeekly').toggleClass('active', view === 'weekly');
            $('#ksViewOverview').toggleClass('active', view === 'overview');
            if (view === 'weekly') scope.renderKernelWeekly();
            if (view === 'overview') scope.renderKernelOverview();
        },

        renderKernelWeekly: function () {
            var scope = _stockManagementGrid;
            var tbody = document.getElementById('ksWeeklyTableBody');
            var totalHeader = document.getElementById('ksWeeklyTotalHeader');
            if (!tbody) return;
            var modeEl = document.getElementById('ksWeeklyViewMode');
            var mode = (modeEl && modeEl.value) || scope.kernelWeeklyMode || 'in';
            scope.kernelWeeklyMode = mode;
            if (totalHeader) totalHeader.textContent = mode === 'out' ? 'Total out (kg)' : 'Total in (kg)';

            var styleKeys = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];
            var colspan = styleKeys.length + 2;

            if (mode === 'out') {
                if (scope.kernelDispatchOrdersWithLines === null) {
                    tbody.innerHTML = '<tr><td colspan="' + colspan + '" class="text-center text-muted py-4">Loading…</td></tr>';
                    scope.loadKernelDispatchOrdersWithLines().then(function () { scope.renderKernelWeekly(); });
                    return;
                }
                var byWeek = {};
                function ensureWeekOut(key) {
                    if (!byWeek[key]) {
                        byWeek[key] = { stockOut: 0, byStyleOut: {} };
                        styleKeys.forEach(function (k) { byWeek[key].byStyleOut[k] = 0; });
                    }
                }
                (scope.kernelDispatchOrdersWithLines || []).forEach(function (item) {
                    var order = item.order;
                    var lines = item.lines || [];
                    var dt = order && order.dispatched_at;
                    if (!dt) return;
                    var key = getIsoWeekKey(dt);
                    if (!key) return;
                    ensureWeekOut(key);
                    lines.forEach(function (line) {
                        var style = line.style != null ? String(line.style) : '';
                        var kg = (line.quantity_kg != null) ? (typeof line.quantity_kg === 'number' ? line.quantity_kg : parseFloat(line.quantity_kg)) : 0;
                        if (isNaN(kg)) kg = 0;
                        if (!byWeek[key].byStyleOut[style]) byWeek[key].byStyleOut[style] = 0;
                        byWeek[key].byStyleOut[style] += kg;
                        byWeek[key].stockOut += kg;
                    });
                });
                var weeks = Object.keys(byWeek).sort();
                var rows = weeks.length === 0
                    ? '<tr><td colspan="' + colspan + '" class="text-center text-muted py-4">No data. Dispatch orders (with dispatched date) show weekly out by style.</td></tr>'
                    : weeks.map(function (key) {
                        var v = byWeek[key];
                        var cells = ['<td>' + escapeHtml(key) + '</td>'];
                        styleKeys.forEach(function (sk) {
                            var val = (v.byStyleOut && v.byStyleOut[sk] != null && v.byStyleOut[sk] > 0)
                                ? Number(v.byStyleOut[sk]).toLocaleString(undefined, { maximumFractionDigits: 2 })
                                : '—';
                            var wkTitle = escapeHtml(kernelStyleWeeklyCellTitle(sk)).replace(/"/g, '&quot;');
                            cells.push('<td class="text-end kernel-style-col" title="' + wkTitle + '">' + escapeHtml(String(val)) + '</td>');
                        });
                        var totalOut = (v.stockOut != null && !isNaN(v.stockOut)) ? Number(v.stockOut).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
                        cells.push('<td class="text-end fw-bold">' + escapeHtml(String(totalOut)) + '</td>');
                        return '<tr>' + cells.join('') + '</tr>';
                    }).join('');
                tbody.innerHTML = rows;
                return;
            }

            var byWeek = {};
            function ensureWeek(key) {
                if (!byWeek[key]) {
                    byWeek[key] = { stockIn: 0, byStyleIn: {} };
                    styleKeys.forEach(function (k) { byWeek[key].byStyleIn[k] = 0; });
                }
            }
            (scope.kernelFinishedBatches || []).forEach(function (b) {
                var dt = b.production_finished_at || b.updated_at || b.created_at;
                if (!dt) return;
                var key = getIsoWeekKey(dt);
                if (!key) return;
                ensureWeek(key);
                var yieldObj = kernelStyleMapFromBatch(b, 'yield_by_style');
                styleKeys.forEach(function (styleKey) {
                    var v = yieldObj[styleKey];
                    var kg = (v != null && v !== '') ? (typeof v === 'number' ? v : parseFloat(v)) : 0;
                    if (!isNaN(kg)) {
                        byWeek[key].byStyleIn[styleKey] += kg;
                        byWeek[key].stockIn += kg;
                    }
                });
            });
            var weeks = Object.keys(byWeek).sort();
            var rows = weeks.length === 0
                ? '<tr><td colspan="' + colspan + '" class="text-center text-muted py-4">No data. Release batches to stock from Kernel Production to see weekly in by style.</td></tr>'
                : weeks.map(function (key) {
                    var v = byWeek[key];
                    var cells = ['<td>' + escapeHtml(key) + '</td>'];
                    styleKeys.forEach(function (sk) {
                        var val = (v.byStyleIn && v.byStyleIn[sk] != null && v.byStyleIn[sk] > 0)
                            ? Number(v.byStyleIn[sk]).toLocaleString(undefined, { maximumFractionDigits: 2 })
                            : '—';
                        var wkTitle = escapeHtml(kernelStyleWeeklyCellTitle(sk)).replace(/"/g, '&quot;');
                        cells.push('<td class="text-end kernel-style-col" title="' + wkTitle + '">' + escapeHtml(String(val)) + '</td>');
                    });
                    var totalIn = (v.stockIn != null && !isNaN(v.stockIn)) ? Number(v.stockIn).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
                    cells.push('<td class="text-end fw-bold">' + escapeHtml(String(totalIn)) + '</td>');
                    return '<tr>' + cells.join('') + '</tr>';
                }).join('');
            tbody.innerHTML = rows;
        },

        renderKernelOverview: function () {
            var scope = _stockManagementGrid;
            var tbody = document.getElementById('ksOverviewTableBody');
            if (!tbody) return;
            var styleKeys = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];
            var byStyle = {};
            styleKeys.forEach(function (k) { byStyle[k] = 0; });
            (scope.kernelFinishedBatches || []).forEach(function (b) {
                var cells = getKernelStyleCellsForDisplay(b);
                styleKeys.forEach(function (k) {
                    var v = cells[k];
                    if (v != null && v !== '') byStyle[k] += (typeof v === 'number' ? v : parseFloat(v)) || 0;
                });
            });
            var rows = styleKeys.map(function (k) {
                var total = byStyle[k];
                var amount = (total != null && !isNaN(total)) ? Number(total).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
                var ovTitle = escapeHtml((KERNEL_STYLE_DESCRIPTION[k] || k) + '. Total remaining cartons (all batches).').replace(/"/g, '&quot;');
                return '<tr><td class="kernel-style-col" title="' + ovTitle + '">' + escapeHtml(k) + '</td><td class="text-end">' + escapeHtml(String(amount)) + '</td></tr>';
            }).join('');
            tbody.innerHTML = rows || '<tr><td colspan="2" class="text-center text-muted py-4">No data.</td></tr>';
        },

        confirmAndReleaseBatchToProduction: function (kernelId, batchNumber) {
            var scope = _stockManagementGrid;
            kernelId = kernelId != null ? String(kernelId).trim() : '';
            batchNumber = batchNumber != null ? String(batchNumber).trim() : '';
            if (!kernelId && !batchNumber) return;
            if (typeof Swal === 'undefined') {
                scope.releaseBatchToProduction(kernelId, batchNumber);
                return;
            }
            Swal.fire({
                title: 'Send back to Kernel Production?',
                text: 'This batch will reappear in the Kernel Production queue. You can then correct or update production data.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonText: 'Yes, send back',
                cancelButtonText: 'Cancel'
            }).then(function (result) {
                if (result && result.isConfirmed) scope.releaseBatchToProduction(kernelId, batchNumber);
            });
        },

        promptAdjustKernelStockCell: function (batch, style) {
            var scope = _stockManagementGrid;
            if (!batch || !kernelIdFromBatch(batch)) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Kernel batch not found. Refresh and try again.', 'error');
                else window.alert('Kernel batch not found. Refresh and try again.');
                return;
            }
            if (typeof Swal === 'undefined') {
                scope.promptAdjustKernelStockCellWithNativePrompt(batch, style);
                return;
            }
            var titleBatch = escapeHtml(batch.batch_number || 'Kernel batch');
            Swal.fire({
                title: 'Adjust Stock',
                html:
                    '<div class="text-start">' +
                    '<div class="small text-muted mb-2">Batch: <strong>' + titleBatch + '</strong></div>' +
                    '<div class="small text-muted mb-2">Style: <strong>' + escapeHtml(style) + '</strong></div>' +
                    '<label class="form-label">Type <code>+</code> or <code>-</code></label>' +
                    '<input id="swalAdjustKernelSign" type="text" class="form-control mb-2" maxlength="1" placeholder="+ or -">' +
                    '<label class="form-label">Value captured</label>' +
                    '<input id="swalAdjustKernelValue" type="number" class="form-control mb-2" step="0.01" min="0" value="0">' +
                    '<label class="form-label">Unit</label>' +
                    '<select id="swalAdjustKernelUnit" class="form-select mb-2">' +
                    '<option value="cartons">Boxes (cartons)</option>' +
                    '<option value="kg">Kg</option>' +
                    '</select>' +
                    '<div id="swalAdjustKernelCalc" class="small text-muted mb-2">Calculated boxes: 0.00 ct (kg: 0.00)</div>' +
                    '<label class="form-label">Reason</label>' +
                    '<input id="swalAdjustKernelReason" type="text" class="form-control" maxlength="250" placeholder="Optional note">' +
                    '</div>',
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: 'Save adjustment',
                didOpen: function () {
                    var signEl = document.getElementById('swalAdjustKernelSign');
                    var valueEl = document.getElementById('swalAdjustKernelValue');
                    var unitEl = document.getElementById('swalAdjustKernelUnit');
                    var calcEl = document.getElementById('swalAdjustKernelCalc');
                    var refreshCalc = function () {
                        if (!calcEl || !valueEl || !unitEl) return;
                        var v = parseNum(valueEl.value);
                        var unit = unitEl.value || 'cartons';
                        var sign = (signEl && signEl.value === '-') ? -1 : 1;
                        var cartons = unit === 'kg'
                            ? (v / KERNEL_KG_PER_CARTON)
                            : v;
                        var kg = unit === 'kg'
                            ? v
                            : (v * KERNEL_KG_PER_CARTON);
                        cartons = Math.round(cartons * 100) / 100;
                        kg = Math.round(kg * 100) / 100;
                        var prefix = sign < 0 ? '-' : '+';
                        calcEl.textContent = 'Calculated boxes: ' + prefix + cartons.toFixed(2) + ' ct (kg: ' + prefix + kg.toFixed(2) + ')';
                    };
                    if (signEl) signEl.addEventListener('input', refreshCalc);
                    if (valueEl) valueEl.addEventListener('input', refreshCalc);
                    if (unitEl) unitEl.addEventListener('change', refreshCalc);
                    refreshCalc();
                },
                preConfirm: function () {
                    var signInput = (document.getElementById('swalAdjustKernelSign').value || '').trim();
                    var valueAbs = parseNum(document.getElementById('swalAdjustKernelValue').value);
                    var unit = (document.getElementById('swalAdjustKernelUnit').value || 'cartons').trim().toLowerCase();
                    var reason = document.getElementById('swalAdjustKernelReason').value || null;
                    if (signInput !== '+' && signInput !== '-') {
                        Swal.showValidationMessage('Type + or - to show whether stock must increase or decrease.');
                        return false;
                    }
                    if (unit !== 'cartons' && unit !== 'kg') {
                        Swal.showValidationMessage('Choose a valid unit.');
                        return false;
                    }
                    if (valueAbs === 0) {
                        Swal.showValidationMessage('Enter a non-zero adjustment value.');
                        return false;
                    }
                    var sign = signInput === '-' ? -1 : 1;
                    var cartonsAbs = unit === 'kg'
                        ? (valueAbs / KERNEL_KG_PER_CARTON)
                        : valueAbs;
                    var qtyAbs = unit === 'kg'
                        ? valueAbs
                        : (valueAbs * KERNEL_KG_PER_CARTON);
                    cartonsAbs = Math.round(cartonsAbs * 100) / 100;
                    qtyAbs = Math.round(qtyAbs * 100) / 100;
                    return {
                        style: style,
                        qtyDelta: sign * qtyAbs,
                        cartonsDelta: sign * cartonsAbs,
                        reason: reason
                    };
                }
            }).then(function (result) {
                if (!result || !result.isConfirmed || !result.value) return;
                scope.saveKernelStockAdjustment(batch, result.value);
            });
        },

        promptAdjustKernelStockCellWithNativePrompt: function (batch, style) {
            var scope = _stockManagementGrid;
            var bn = batch.batch_number || 'batch';
            var sign = (window.prompt('Batch ' + bn + ', style ' + style + ' — type + or -', '+') || '').trim();
            if (sign !== '+' && sign !== '-') return;
            var unit = (window.prompt('Unit? Type cartons or kg', 'cartons') || 'cartons').trim().toLowerCase();
            if (unit !== 'cartons' && unit !== 'kg') return;
            var valueStr = window.prompt('Value to change (number only)', '0');
            var valueAbs = valueStr === '' || valueStr == null ? 0 : parseFloat(valueStr);
            if (isNaN(valueAbs) || valueAbs < 0) {
                window.alert('Invalid adjustment value');
                return;
            }
            if (valueAbs === 0) {
                window.alert('Enter a non-zero adjustment value');
                return;
            }
            var mult = sign === '-' ? -1 : 1;
            var cartonsAbs = unit === 'kg' ? (valueAbs / KERNEL_KG_PER_CARTON) : valueAbs;
            var qtyAbs = unit === 'kg' ? valueAbs : (valueAbs * KERNEL_KG_PER_CARTON);
            cartonsAbs = Math.round(cartonsAbs * 100) / 100;
            qtyAbs = Math.round(qtyAbs * 100) / 100;
            scope.saveKernelStockAdjustment(batch, {
                style: style,
                qtyDelta: mult * qtyAbs,
                cartonsDelta: mult * cartonsAbs,
                reason: null
            });
        },

        saveKernelStockAdjustment: function (batch, adjustment) {
            var scope = _stockManagementGrid;
            var kernelId = kernelIdFromBatch(batch);
            if (!kernelId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Missing kernel id for this batch. Refresh and try again.', 'error');
                else window.alert('Missing kernel id for this batch. Refresh and try again.');
                return;
            }
            var df = (typeof _dataFunctions !== 'undefined' && _dataFunctions && _dataFunctions.adjustKernelStockOnHand)
                ? _dataFunctions
                : (typeof dataFunctions !== 'undefined' && dataFunctions ? dataFunctions : null);
            if (!df || !df.adjustKernelStockOnHand) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Kernel stock adjustment is not available. Please refresh.', 'error');
                else window.alert('Kernel stock adjustment is not available. Please refresh.');
                return;
            }
            df.adjustKernelStockOnHand(kernelId, adjustment).then(function (result) {
                var r = result;
                if (r && r.data !== undefined) r = r.data;
                if (typeof r === 'string') {
                    try { r = JSON.parse(r); } catch (e) { r = result; }
                }
                if (!r || typeof r !== 'object') throw new Error('No response from server');
                if (r.success === false || r.Success === false) throw new Error(r.error || r.Error || 'Failed to adjust stock');
                if (r.success !== true && r.Success !== true) {
                    throw new Error(r.error || r.Error || 'Stock adjustment did not succeed');
                }
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'success',
                        title: 'Stock adjusted',
                        text: (batch.batch_number || 'Batch') + ' was updated.',
                        timer: 1800,
                        showConfirmButton: false
                    });
                } else window.alert('Stock adjusted for ' + (batch.batch_number || 'batch'));
                scope.loadKernelBatches(true);
            }).catch(function (e) {
                console.error('[Stock Management] saveKernelStockAdjustment failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to adjust stock', 'error');
                else window.alert(e.message || 'Failed to adjust stock');
            });
        },

        releaseBatchToProduction: function (kernelId, batchNumber) {
            var scope = _stockManagementGrid;
            kernelId = kernelId != null ? String(kernelId).trim() : '';
            batchNumber = batchNumber != null ? String(batchNumber).trim() : '';
            if (!kernelId && !batchNumber) return;
            var row = null;
            if (kernelId || batchNumber) {
                row = (scope.kernelFinishedBatches || []).find(function (b) {
                    return (kernelId && kernelIdFromBatch(b) === kernelId) ||
                        (batchNumber && batchNumberFromBatch(b) === batchNumber);
                }) || null;
            }
            if (row) {
                if (!kernelId) kernelId = kernelIdFromBatch(row);
                if (!batchNumber) batchNumber = batchNumberFromBatch(row);
            }
            var df = (typeof _dataFunctions !== 'undefined' && _dataFunctions) ? _dataFunctions : dataFunctions;
            var call = df && df.returnKernelFromStockToProduction
                ? df.returnKernelFromStockToProduction(kernelId || null, null, {
                    batchNumber: batchNumber || null,
                    gridRow: row || null
                })
                : Promise.reject(new Error('returnKernelFromStockToProduction is not available — apply migration return_kernel_from_stock_to_production.'));
            call.then(function (result) {
                if (result && result.success !== false) {
                    var already = result.already_in_production === true;
                    scope.kernelFinishedBatches = (scope.kernelFinishedBatches || []).filter(function (b) {
                        if (kernelId && kernelIdFromBatch(b) === kernelId) return false;
                        if (batchNumber && batchNumberFromBatch(b) === batchNumber) return false;
                        return true;
                    });
                    scope.renderKernelBatches();
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: already ? 'Already on production board' : 'Sent back to production',
                            text: already
                                ? 'This batch is already in the Kernel Production queue. Open the job card there and press Jobcard approved when ready.'
                                : 'Batch is on Kernel Production (QA). Open the job card, confirm style quantities, then press Jobcard approved.',
                            timer: 3200,
                            showConfirmButton: false
                        });
                    }
                    scope.loadKernelBatches(true);
                } else {
                    throw new Error((result && result.error) ? result.error : 'Update failed');
                }
            }).catch(function (e) {
                console.error('[Stock Management] releaseBatchToProduction failed:', e);
                var msg = (e && e.message) ? String(e.message) : 'Failed to send batch back to production';
                if (msg.indexOf('not found or inactive') >= 0) {
                    msg = 'This batch could not be found in kernel stock (it may be inactive or removed). Press Ctrl+F5 to refresh, then try again. Batch: '
                        + (batchNumber || kernelId || '?');
                }
                if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
            });
        },

        loadStockItems: function (forceRefresh) {
            var scope = _stockManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getStockItems !== 'function') {
                console.warn('[Stock Management] dataFunctions not available, skipping load');
                return;
            }
            dataFunctions.getStockItems(null, forceRefresh).catch(function (error) {
                var msg = (error && error.message) ? String(error.message) : String(error || '');
                if (msg.indexOf('stock_items') !== -1 || msg.toLowerCase().indexOf('does not exist') !== -1) {
                    console.warn('[Stock Management] Generic stock list unavailable (stock_items not in database). Using empty list.');
                } else {
                    console.error('[Stock Management] Error loading stock items:', error);
                }
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
                location_code: null,
                stock_category: null,
                status: null,
                search: el('oilSearchInput') ? el('oilSearchInput').value || null : null,
                limit: 2000,
                offset: 0
            };
        },

        /** Split ledger rows: protein powder vs everything else (oil). Prefer grade + batch prefix so long ingredient text does not mis-route oil lots. */
        isProteinPowderLot: function (l) {
            if (!l) return false;
            var bn = (l.batch_number && String(l.batch_number)) || '';
            if (bn.indexOf('PP-') === 0) return true;
            var g = (l.grade && String(l.grade).toLowerCase().trim()) || '';
            if (g === 'protein powder' || g.indexOf('protein powder') === 0) return true;
            return false;
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
                if (scope.oilCurrentView === 'weekly') scope.renderOilWeekly();
                if (scope.oilCurrentView === 'overview') scope.renderOilOverview();
                scope.renderOilStockTables();
            });
        },

        toggleOilView: function (view) {
            var scope = _stockManagementGrid;
            scope.oilCurrentView = view;
            var byStock = document.getElementById('osByStockPanel');
            var weekly = document.getElementById('osWeeklyPanel');
            var overview = document.getElementById('osOverviewPanel');
            if (byStock) byStock.style.display = (view === 'bystock') ? '' : 'none';
            if (weekly) weekly.style.display = (view === 'weekly') ? '' : 'none';
            if (overview) overview.style.display = (view === 'overview') ? '' : 'none';
            $('#osViewByStock').toggleClass('active', view === 'bystock');
            $('#osViewWeekly').toggleClass('active', view === 'weekly');
            $('#osViewOverview').toggleClass('active', view === 'overview');
            if (view === 'weekly') scope.renderOilWeekly();
            if (view === 'overview') scope.renderOilOverview();
            if (view === 'bystock') scope.renderOilStockTables();
        },

        loadOilDispatchOrdersWithLines: function () {
            var scope = _stockManagementGrid;
            var df = (typeof dataFunctions !== 'undefined' && dataFunctions && dataFunctions.getOilDispatchOrders) ? dataFunctions : null;
            if (!df) return Promise.resolve();
            return df.getOilDispatchOrders(null, true, 500).then(function (orders) {
                var dispatched = (orders || []).filter(function (o) { return o.dispatched_at; });
                if (dispatched.length === 0) {
                    scope.oilDispatchOrdersWithLines = [];
                    return;
                }
                return Promise.all(dispatched.map(function (o) { return df.getOilDispatchOrder(o.id); })).then(function (results) {
                    scope.oilDispatchOrdersWithLines = (results || []).filter(function (r) {
                        return r && r.order && Array.isArray(r.lines);
                    });
                });
            }).catch(function (e) {
                console.error('[Stock Management] loadOilDispatchOrdersWithLines failed:', e);
                scope.oilDispatchOrdersWithLines = [];
            });
        },

        /** Dispatch line: classify as protein (powder) vs oil for weekly out. */
        _oilDispatchLineIsProtein: function (line) {
            var st = (line.style && String(line.style).toLowerCase()) || '';
            var bn = (line.batch_number && String(line.batch_number)) || '';
            if (st.indexOf('protein') !== -1) return true;
            if (bn.indexOf('PP-') === 0) return true;
            return false;
        },

        renderOilWeekly: function () {
            var scope = _stockManagementGrid;
            var tbody = document.getElementById('osWeeklyTableBody');
            var totalHeader = document.getElementById('osWeeklyTotalHeader');
            if (!tbody) return;
            var modeEl = document.getElementById('osWeeklyViewMode');
            var mode = (modeEl && modeEl.value) || scope.oilWeeklyMode || 'in';
            scope.oilWeeklyMode = mode;
            if (totalHeader) totalHeader.textContent = mode === 'out' ? 'Total out (kg)' : 'Total in (kg)';

            if (mode === 'out') {
                if (scope.oilDispatchOrdersWithLines === null) {
                    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Loading…</td></tr>';
                    scope.loadOilDispatchOrdersWithLines().then(function () { scope.renderOilWeekly(); });
                    return;
                }
                var byWeek = {};
                function ensureWeek(key) {
                    if (!byWeek[key]) byWeek[key] = { oil: 0, protein: 0 };
                }
                (scope.oilDispatchOrdersWithLines || []).forEach(function (item) {
                    var order = item.order;
                    var lines = item.lines || [];
                    var dt = order && order.dispatched_at;
                    if (!dt) return;
                    var key = getIsoWeekKey(dt);
                    if (!key) return;
                    ensureWeek(key);
                    lines.forEach(function (line) {
                        var kg = (line.quantity_kg != null) ? (typeof line.quantity_kg === 'number' ? line.quantity_kg : parseFloat(line.quantity_kg)) : 0;
                        if (isNaN(kg)) kg = 0;
                        if (scope._oilDispatchLineIsProtein(line)) byWeek[key].protein += kg;
                        else byWeek[key].oil += kg;
                    });
                });
                var weeks = Object.keys(byWeek).sort();
                var rows = weeks.length === 0
                    ? '<tr><td colspan="4" class="text-center text-muted py-4">No dispatch data with a dispatch date yet.</td></tr>'
                    : weeks.map(function (key) {
                        var v = byWeek[key];
                        var tot = (v.oil || 0) + (v.protein || 0);
                        return '<tr><td>' + escapeHtml(key) + '</td><td class="text-end">' + escapeHtml(Number(v.oil || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td>' +
                            '<td class="text-end">' + escapeHtml(Number(v.protein || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td>' +
                            '<td class="text-end fw-bold">' + escapeHtml(Number(tot).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td></tr>';
                    }).join('');
                tbody.innerHTML = rows;
                return;
            }

            var byWeek = {};
            function ensureWeekIn(key) {
                if (!byWeek[key]) byWeek[key] = { oil: 0, protein: 0 };
            }
            (scope.oilLots || []).forEach(function (l) {
                var dt = l.created_at;
                if (!dt) return;
                var key = getIsoWeekKey(dt);
                if (!key) return;
                ensureWeekIn(key);
                var kg = (l.kilograms != null) ? (typeof l.kilograms === 'number' ? l.kilograms : parseFloat(l.kilograms)) : 0;
                if (isNaN(kg)) kg = 0;
                if (scope.isProteinPowderLot(l)) byWeek[key].protein += kg;
                else byWeek[key].oil += kg;
            });
            var weeks = Object.keys(byWeek).sort();
            var rows = weeks.length === 0
                ? '<tr><td colspan="4" class="text-center text-muted py-4">No ledger rows. Load stock or add lots.</td></tr>'
                : weeks.map(function (key) {
                    var v = byWeek[key];
                    var tot = (v.oil || 0) + (v.protein || 0);
                    return '<tr><td>' + escapeHtml(key) + '</td><td class="text-end">' + escapeHtml(Number(v.oil || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td>' +
                        '<td class="text-end">' + escapeHtml(Number(v.protein || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td>' +
                        '<td class="text-end fw-bold">' + escapeHtml(Number(tot).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td></tr>';
                }).join('');
            tbody.innerHTML = rows;
        },

        renderOilOverview: function () {
            var scope = _stockManagementGrid;
            var tbody = document.getElementById('osOverviewTableBody');
            if (!tbody) return;
            var oilKg = 0;
            var protKg = 0;
            (scope.oilLots || []).forEach(function (l) {
                if (l.status !== 'on_hand') return;
                var kg = (l.kilograms != null) ? (typeof l.kilograms === 'number' ? l.kilograms : parseFloat(l.kilograms)) : 0;
                if (isNaN(kg)) kg = 0;
                if (scope.isProteinPowderLot(l)) protKg += kg;
                else oilKg += kg;
            });
            tbody.innerHTML =
                '<tr><td>Oil</td><td class="text-end">' + escapeHtml(Number(oilKg).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td></tr>' +
                '<tr><td>Protein powder</td><td class="text-end">' + escapeHtml(Number(protKg).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td></tr>' +
                '<tr class="table-light fw-bold"><td>Total</td><td class="text-end">' + escapeHtml(Number(oilKg + protKg).toLocaleString(undefined, { maximumFractionDigits: 2 })) + '</td></tr>';
        },

        /** Lots available in warehouse (excludes dispatched/sold). */
        oilLotsAvailableForStockView: function () {
            var scope = _stockManagementGrid;
            return (scope.oilLots || []).filter(function (l) {
                var s = (l.status && String(l.status).toLowerCase()) || '';
                return s === 'on_hand' || s === 'hold';
            });
        },

        renderOilStockTables: function () {
            var scope = _stockManagementGrid;
            var bodyOil = document.getElementById('oilStockOilTableBody');
            var bodyProt = document.getElementById('oilStockProteinTableBody');
            if (!bodyOil || !bodyProt) return;
            bodyOil.innerHTML = '';
            bodyProt.innerHTML = '';
            var rows = scope.oilLotsAvailableForStockView();
            var oilRows = rows.filter(function (l) { return !scope.isProteinPowderLot(l); });
            var protRows = rows.filter(function (l) { return scope.isProteinPowderLot(l); });
            var formatDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) ? _common.formatDateDDMMYYYY : function (v) { return v || ''; };

            /** Normalize grade for display: Food grade | Cosmetic | Protein powder | legacy snake_case. */
            function displayOilLotGrade(lot) {
                if (!lot) return '';
                var g = (lot.grade != null && String(lot.grade).trim()) ? String(lot.grade).trim() : '';
                if (!g) return '';
                var low = g.toLowerCase().replace(/_/g, ' ');
                if (low === 'food grade') return 'Food grade';
                if (low === 'cosmetic') return 'Cosmetic';
                return g;
            }

            function renderRow(l, tbody) {
                var days = scope.daysRemainingFromBbDate(l.bb_date);
                var daysClass = (days !== '' && days < 0) ? 'text-danger fw-bold' : (days !== '' && days < 30) ? 'text-warning fw-bold' : '';
                var bbDisplay = formatDate(l.bb_date) || l.bb_date || '';
                var tr = document.createElement('tr');
                tr.innerHTML = '<td>' + (l.location_code || '') + '</td>' +
                    '<td>' + (l.stock_category || '') + '</td>' +
                    '<td>' + (l.batch_number || '') + '</td>' +
                    '<td>' + escapeHtml(displayOilLotGrade(l)) + '</td>' +
                    '<td class="text-end">' + (l.ffa !== null && l.ffa !== undefined ? Number(l.ffa).toFixed(2) : '') + '</td>' +
                    '<td class="text-end">' + (l.kilograms !== null && l.kilograms !== undefined ? Number(l.kilograms).toFixed(2) : '') + '</td>' +
                    '<td>' + bbDisplay + '</td>' +
                    '<td class="text-end ' + daysClass + '">' + (days !== '' ? days : '') + '</td>' +
                    '<td>' + (l.status || '') + '</td>' +
                    '<td class="text-nowrap"><button type="button" class="btn btn-sm btn-outline-info oil-batch-ingredients-btn" data-oil-batch-number="' + escapeHtml(String(l.batch_number || '')) + '" title="Ingredients used for this batch"><i class="fas fa-carrot"></i></button> ' +
                    '<button type="button" class="btn btn-sm btn-outline-primary adjust-oil-lot-btn" data-oil-lot-id="' + l.id + '" title="Adjust stock on hand"><i class="fas fa-balance-scale"></i></button> ' +
                    '<button type="button" class="btn btn-sm btn-outline-primary edit-oil-lot-btn" data-oil-lot-id="' + l.id + '" title="Edit lot details"><i class="fas fa-edit me-1"></i>Edit</button> <button type="button" class="btn btn-sm btn-outline-danger delete-oil-lot-btn" data-oil-lot-id="' + l.id + '" title="Delete batch (soft delete)"><i class="fas fa-trash me-1"></i>Delete</button></td>';
                tbody.appendChild(tr);
            }

            if (!oilRows.length) {
                bodyOil.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">No oil stock lines match your search.</td></tr>';
            } else oilRows.forEach(function (l) { renderRow(l, bodyOil); });

            if (!protRows.length) {
                bodyProt.innerHTML = '<tr><td colspan="10" class="text-center text-muted py-4">No protein powder stock lines match your search.</td></tr>';
            } else protRows.forEach(function (l) { renderRow(l, bodyProt); });
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

        /** Build HTML for get_oil_batch_ingredients_detail JSON (SweetAlert2). */
        formatOilBatchIngredientsHtml: function (d) {
            if (!d || d.success === false) {
                return '<p class="text-danger mb-0">' + escapeHtml((d && d.error) ? d.error : 'Unable to load ingredients.') + '</p>';
            }
            var parts = [];
            parts.push('<p class="small text-muted mb-2">Batch <strong>' + escapeHtml(String(d.batch_number || '')) + '</strong>');
            if (d.oil_stream) parts.push(' · Stream: <strong>' + escapeHtml(String(d.oil_stream)) + '</strong>');
            parts.push('</p>');
            if (!d.has_oil_bin_batch && !d.has_oil_row) {
                parts.push('<p class="mb-0">No production ingredient record was found for this batch (e.g. manually added stock, imports, or legacy data).</p>');
                return parts.join('');
            }
            /** Hide legacy rows where the whole bin "ingredients" string was copied into one line (comma-separated batch refs, no qty). */
            function normIng(s) {
                return String(s || '').replace(/\s+/g, ' ').trim();
            }
            function isJunkSegmentIngredientRow(ing, binIngredientsText) {
                var desc = normIng(ing.description || ing.batch_id || ing.product_type || '');
                if (!desc) return false;
                var binT = normIng(binIngredientsText);
                if (binT && desc === binT) return true;
                var qty = ing.qty_kg != null ? ing.qty_kg : (ing.quantity_kg != null ? ing.quantity_kg : null);
                var qtyEmpty = qty === null || qty === undefined || qty === '';
                if (!qtyEmpty) return false;
                if (!binT) return false;
                if (desc.length < 15 || desc.indexOf(',') === -1) return false;
                return desc === binT || desc.replace(/\s*,\s*/g, ',') === binT.replace(/\s*,\s*/g, ',');
            }
            if (d.shifts_text && String(d.shifts_text).trim()) {
                parts.push('<h6 class="mt-2 mb-1 text-start">Shifts (text)</h6>');
                parts.push('<p class="text-start small mb-2">' + escapeHtml(String(d.shifts_text)).replace(/\n/g, '<br>') + '</p>');
            }
            var segs = d.shift_segments;
            if (segs && Array.isArray(segs) && segs.length > 0) {
                parts.push('<h6 class="mt-2 mb-1 text-start">Shifts &amp; ingredients</h6>');
                segs.forEach(function (seg, i) {
                    parts.push('<div class="border rounded p-2 mb-2 text-start">');
                    parts.push('<div class="fw-bold">' + escapeHtml('Segment ' + (i + 1) + (seg.shift_name ? ': ' + String(seg.shift_name) : '')) + '</div>');
                    if (seg.shift_date) parts.push('<div class="small text-muted">' + escapeHtml(String(seg.shift_date)) + '</div>');
                    var ings = seg.ingredients;
                    if (ings && Array.isArray(ings) && ings.length) {
                        ings = ings.filter(function (ing) {
                            return !isJunkSegmentIngredientRow(ing, d.ingredients_text);
                        });
                    }
                    if (ings && Array.isArray(ings) && ings.length) {
                        parts.push('<table class="table table-sm table-bordered mt-1 mb-0"><thead><tr><th>Item</th><th>Supplier</th><th class="text-end">Qty (kg)</th></tr></thead><tbody>');
                        ings.forEach(function (ing) {
                            var desc = ing.description || ing.batch_id || ing.product_type || '';
                            var qty = ing.qty_kg != null ? ing.qty_kg : (ing.quantity_kg != null ? ing.quantity_kg : '');
                            var sup = ing.supplier || ing.supplier_details || '';
                            parts.push('<tr><td>' + escapeHtml(String(desc)) + '</td><td>' + escapeHtml(String(sup || '—')) + '</td><td class="text-end">' + escapeHtml(String(qty)) + '</td></tr>');
                        });
                        parts.push('</tbody></table>');
                    }
                    parts.push('</div>');
                });
            }
            var audit = d.raw_ingredient_audit;
            if (audit && Array.isArray(audit) && audit.length) {
                parts.push('<h6 class="mt-2 mb-1 text-start">Raw ingredient audit</h6>');
                parts.push('<table class="table table-sm table-bordered text-start"><thead><tr><th>Batch</th><th>Supplier</th><th>Product / description</th><th class="text-end">Qty (kg)</th></tr></thead><tbody>');
                audit.forEach(function (row) {
                    var bid = row.batch_id != null ? row.batch_id : '';
                    var pt = row.product_type || row.description || '';
                    var qk = row.quantity_kg != null ? row.quantity_kg : '';
                    var sup = row.supplier || row.supplier_details || '';
                    parts.push('<tr><td>' + escapeHtml(String(bid)) + '</td><td>' + escapeHtml(String(sup || '—')) + '</td><td>' + escapeHtml(String(pt)) + '</td><td class="text-end">' + escapeHtml(String(qk)) + '</td></tr>');
                });
                parts.push('</tbody></table>');
            }
            var hasDetail = (d.shifts_text && String(d.shifts_text).trim()) ||
                (segs && Array.isArray(segs) && segs.length) ||
                (audit && Array.isArray(audit) && audit.length);
            if ((d.has_oil_bin_batch || d.has_oil_row) && !hasDetail) {
                parts.push('<p class="mb-0 text-muted">No detailed ingredient lines were recorded for this batch.</p>');
            }
            return parts.join('');
        },

        showOilBatchIngredientsModal: function (batchNumber) {
            var scope = _stockManagementGrid;
            if (!batchNumber || typeof dataFunctions === 'undefined' || !dataFunctions.getOilBatchIngredientsDetail) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Ingredients lookup is not available.', 'error');
                return;
            }
            if (typeof Swal !== 'undefined') Swal.fire({ title: 'Loading…', didOpen: function () { Swal.showLoading(); }, allowOutsideClick: false, showConfirmButton: false });
            dataFunctions.getOilBatchIngredientsDetail(batchNumber, null).then(function (d) {
                if (typeof Swal !== 'undefined') Swal.close();
                if (d && d.success === false) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', d.error || 'Could not load ingredients', 'error');
                    return;
                }
                var html = scope.formatOilBatchIngredientsHtml(d);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: 'Ingredients for batch',
                        html: html,
                        width: '48rem',
                        confirmButtonText: 'OK',
                        customClass: { htmlContainer: 'text-start' }
                    });
                }
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.close();
                console.error('[Stock Management] getOilBatchIngredientsDetail failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', (e && e.message) ? e.message : 'Failed to load ingredients', 'error');
            });
        },

        deleteOilLot: function (lotId) {
            var scope = _stockManagementGrid;
            Swal.fire({ title: 'Delete oil lot?', text: 'This will hide the lot from the ledger (soft delete).', icon: 'warning', showCancelButton: true, confirmButtonText: 'Yes, delete', cancelButtonText: 'Cancel' }).then(function (confirm) {
                if (!confirm.isConfirmed) return;
                dataFunctions.deactivateOilStockLot(lotId).then(function (result) {
                    if (result && result.success !== false) {
                        Swal.fire('Deleted', 'Oil lot removed from stock view.', 'success');
                        scope.loadOilLotsAndSummary(true);
                    } else Swal.fire('Error', (result && (result.error || result.message)) || 'Failed to delete oil lot', 'error');
                }).catch(function (e) {
                    console.error('[Stock Management] deleteOilLot failed:', e);
                    Swal.fire('Error', e.message || 'Failed to delete oil lot', 'error');
                });
            });
        },

        promptEditKernelBatch: function (kernelId) {
            var scope = _stockManagementGrid;
            if (!kernelId || typeof Swal === 'undefined') return;
            var b = (scope.kernelFinishedBatches || []).find(function (x) { return kernelIdFromBatch(x) === String(kernelId); });
            if (!b) {
                Swal.fire('Error', 'Batch not found. Refresh and try again.', 'error');
                return;
            }
            var bn = (b.batch_number || '').toString();
            var gn = (b.grower_name || '').toString();
            var rd = isoDateOnlyForInput(b.received_date);
            var wetStr = (b.wet_nis_received_kg != null && b.wet_nis_received_kg !== '')
                ? String(typeof b.wet_nis_received_kg === 'number' ? b.wet_nis_received_kg : parseFloat(b.wet_nis_received_kg))
                : '';
            if (wetStr && isNaN(parseFloat(wetStr))) wetStr = '';
            var ffaStr = (b.ffa != null && b.ffa !== '') ? String(typeof b.ffa === 'number' ? b.ffa : parseFloat(b.ffa)) : '';
            if (ffaStr && isNaN(parseFloat(ffaStr))) ffaStr = '';
            var bb = isoDateOnlyForInput(b.best_before_date);
            Swal.fire({
                title: 'Edit batch',
                width: 520,
                showCancelButton: true,
                confirmButtonText: 'Save',
                focusConfirm: false,
                html:
                    '<div class="text-start">' +
                    '<label class="form-label">Batch number <span class="text-danger">*</span></label>' +
                    '<input id="swalKStockBn" class="form-control mb-2" value="' + escapeHtml(bn) + '" autocomplete="off">' +
                    '<label class="form-label">Grower / supplier name</label>' +
                    '<input id="swalKStockGrower" class="form-control mb-2" value="' + escapeHtml(gn) + '">' +
                    '<label class="form-label">Received date</label>' +
                    '<input id="swalKStockRd" type="date" class="form-control mb-2" value="' + escapeHtml(rd) + '">' +
                    '<label class="form-label">Wet NIS received (kg)</label>' +
                    '<input id="swalKStockWet" type="number" step="0.01" min="0" class="form-control mb-2" value="' + escapeHtml(wetStr) + '">' +
                    '<label class="form-label">FFA (QA)</label>' +
                    '<input id="swalKStockFfa" type="number" step="0.01" min="0" class="form-control mb-2" value="' + escapeHtml(ffaStr) + '" placeholder="Optional">' +
                    '<label class="form-label">Best before date</label>' +
                    '<input id="swalKStockBb" type="date" class="form-control" value="' + escapeHtml(bb) + '">' +
                    '<p class="small text-muted mt-2 mb-0">Leave FFA or best before empty to leave them unchanged. Clearing Wet NIS or received date removes the stored value.</p>' +
                    '</div>',
                preConfirm: function () {
                    var bnV = ((document.getElementById('swalKStockBn') || {}).value || '').trim();
                    if (!bnV) {
                        Swal.showValidationMessage('Batch number is required');
                        return false;
                    }
                    var rdV = (document.getElementById('swalKStockRd') || {}).value || '';
                    var wetRaw = ((document.getElementById('swalKStockWet') || {}).value || '').trim();
                    var wet = wetRaw === '' ? null : parseFloat(wetRaw);
                    if (wetRaw !== '' && (!isFinite(wet) || wet < 0)) {
                        Swal.showValidationMessage('Wet NIS must be a valid non-negative number');
                        return false;
                    }
                    var ffaRaw = ((document.getElementById('swalKStockFfa') || {}).value || '').trim();
                    var ffa = ffaRaw === '' ? null : parseFloat(ffaRaw);
                    if (ffaRaw !== '' && (!isFinite(ffa) || ffa < 0)) {
                        Swal.showValidationMessage('FFA must be a valid non-negative number');
                        return false;
                    }
                    var bbV = ((document.getElementById('swalKStockBb') || {}).value || '').trim();
                    return {
                        batch_number: bnV,
                        grower_name: (document.getElementById('swalKStockGrower') || {}).value || '',
                        received_date: rdV.trim() === '' ? null : rdV.trim(),
                        wet_nis_received_kg: wet,
                        ffa: ffa,
                        best_before_date: bbV === '' ? null : bbV
                    };
                }
            }).then(function (res) {
                if (!res || !res.isConfirmed || !res.value) return;
                var df = (typeof dataFunctions !== 'undefined' && dataFunctions) ? dataFunctions : null;
                if (!df || !df.updateKernelStockBatchInfo) {
                    Swal.fire('Error', 'Save is not available. Apply the latest database migration and refresh.', 'error');
                    return;
                }
                df.updateKernelStockBatchInfo(kernelId, res.value).then(function (result) {
                    if (result && result.success === false) throw new Error(result.error || 'Save failed');
                    Swal.fire({ icon: 'success', title: 'Saved', timer: 1600, showConfirmButton: false });
                    scope.loadKernelBatches(true);
                }).catch(function (e) {
                    console.error('[Stock Management] promptEditKernelBatch failed:', e);
                    Swal.fire('Error', e.message || 'Failed to save', 'error');
                });
            });
        },

        deleteKernelBatch: function (kernelId, batchLabel) {
            var scope = _stockManagementGrid;
            if (!kernelId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.deactivateKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Delete is not available. Please refresh.', 'error');
                return;
            }
            var label = (batchLabel && String(batchLabel).trim()) ? String(batchLabel).trim() : 'this batch';
            Swal.fire({
                title: 'Delete kernel batch?',
                html: 'Remove <strong>' + escapeHtml(label) + '</strong> from stock? It will be hidden from lists (soft delete).',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                confirmButtonText: 'Yes, delete',
                cancelButtonText: 'Cancel'
            }).then(function (res) {
                if (!res.isConfirmed) return;
                dataFunctions.deactivateKernelBatch(kernelId).then(function (result) {
                    var inner = (result && result.deactivate_kernel_batch) ? result.deactivate_kernel_batch : result;
                    if (inner && inner.success === false) throw new Error(inner.error || 'Delete failed');
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Batch deleted', text: label + ' has been removed from stock.', timer: 2000, showConfirmButton: false });
                    scope.loadKernelBatches(true);
                }).catch(function (e) {
                    console.error('[Stock Management] deleteKernelBatch failed:', e);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to delete batch', 'error');
                });
            });
        },

        promptAdjustOilLot: function (lot) {
            var scope = _stockManagementGrid;
            if (!lot || !lot.id || typeof Swal === 'undefined') return;
            Swal.fire({
                title: 'Adjust Stock',
                html:
                    '<div class="text-start">' +
                    '<div class="small text-muted mb-2">Lot: <strong>' + escapeHtml(lot.batch_number || lot.location_code || 'Oil lot') + '</strong></div>' +
                    '<label class="form-label">Direction</label>' +
                    '<select id="swalAdjustOilDirection" class="form-select mb-2">' +
                    '<option value="plus">Plus to stock</option>' +
                    '<option value="minus">Minus from stock</option>' +
                    '</select>' +
                    '<label class="form-label">Kg</label>' +
                    '<input id="swalAdjustOilKg" type="number" class="form-control mb-2" step="0.01" min="0" value="0">' +
                    '<label class="form-label">Reason</label>' +
                    '<input id="swalAdjustOilReason" type="text" class="form-control" maxlength="250" placeholder="Optional note">' +
                    '</div>',
                focusConfirm: false,
                showCancelButton: true,
                confirmButtonText: 'Save adjustment',
                preConfirm: function () {
                    var kgAbs = parseNum(document.getElementById('swalAdjustOilKg').value);
                    var direction = document.getElementById('swalAdjustOilDirection').value;
                    var reason = document.getElementById('swalAdjustOilReason').value || null;
                    if (kgAbs <= 0) {
                        Swal.showValidationMessage('Enter an adjustment greater than zero.');
                        return false;
                    }
                    var currentKg = parseNum(lot.kilograms);
                    var nextKg = direction === 'minus' ? currentKg - kgAbs : currentKg + kgAbs;
                    if (nextKg < 0) {
                        Swal.showValidationMessage('Adjustment would make stock on hand negative.');
                        return false;
                    }
                    return {
                        p_kilograms: nextKg,
                        p_notes: reason ? ((lot.notes ? String(lot.notes) + '\n' : '') + '[Stock adjustment] ' + reason) : lot.notes
                    };
                }
            }).then(function (result) {
                if (!result || !result.isConfirmed || !result.value) return;
                scope.saveOilLotAdjustment(lot, result.value);
            });
        },

        saveOilLotAdjustment: function (lot, updatePayload) {
            var scope = _stockManagementGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.updateOilStockLot) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Oil stock adjustment is not available. Please refresh.', 'error');
                return;
            }
            dataFunctions.updateOilStockLot(lot.id, updatePayload).then(function (result) {
                if (result && result.success === false) throw new Error(result.error || result.message || 'Failed to adjust stock');
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'success',
                        title: 'Stock adjusted',
                        text: (lot.batch_number || 'Lot') + ' was updated.',
                        timer: 1800,
                        showConfirmButton: false
                    });
                }
                scope.loadOilLotsAndSummary(true);
            }).catch(function (e) {
                console.error('[Stock Management] saveOilLotAdjustment failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to adjust stock', 'error');
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
