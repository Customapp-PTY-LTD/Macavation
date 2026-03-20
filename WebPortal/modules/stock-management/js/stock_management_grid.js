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
        if (!b || !b.yield_by_style || typeof b.yield_by_style !== 'object') return 0;
        var sum = 0;
        Object.keys(b.yield_by_style).forEach(function (k) {
            var v = b.yield_by_style[k];
            if (v != null && v !== '') sum += (typeof v === 'number' ? v : parseFloat(v)) || 0;
        });
        return sum;
    }

    /** Sum total kg from remaining_by_style object. */
    function totalKgFromRemaining(b) {
        if (!b || !b.remaining_by_style || typeof b.remaining_by_style !== 'object') return 0;
        var sum = 0;
        Object.keys(b.remaining_by_style).forEach(function (k) {
            var v = b.remaining_by_style[k];
            if (v != null && v !== '') sum += (typeof v === 'number' ? v : parseFloat(v)) || 0;
        });
        return sum;
    }

    function escapeHtml(s) {
        if (s == null) return '';
        var str = String(s);
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
                ['sendToDispatchModal', 'sendToDispatchOilModal'].forEach(function (id) {
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
                return delay(100);
            }).then(function () {
                var stream = document.getElementById('filterStockStream') ? document.getElementById('filterStockStream').value : 'kernel';
                if (document.getElementById('exportStockBtn')) {
                    scope.setupEventListeners();
                    scope.loadStockItems();
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
                if (subtitleEl) subtitleEl.textContent = 'Track kernel batches by style (totals across the top, yield per style from Production Job Card). Select a batch and send to dispatch—or export when you\'re ready.';
            } else if (route === 'stock-management-oil') {
                stream = 'oil';
                if (titleEl) titleEl.textContent = 'Stock (Oil & Protein)';
                if (subtitleEl) subtitleEl.textContent = 'Oil stock on top, protein powder below. Weekly in/out, send to dispatch when ready—export anytime.';
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
                    var id = $(this).data('batch-id');
                    if (id) scope.confirmAndReleaseBatchToProduction(id);
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
                return;
            }
            df.getKernelBatches(null, forceRefresh, { status: 'complete' }).then(function (all) {
                all = all || [];
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
                var ffaTitle = 'Free Fatty Acids (from QA)';
                var bbTitle = bbDisplay !== '—' ? 'Best Before Date' : 'Best Before Date (from Job Card or packing completion + 18 months)';
                row += '<td class="text-end" title="' + ffaTitle.replace(/"/g, '&quot;') + '">' + ffaDisplay + '</td><td class="text-end" title="' + bbTitle.replace(/"/g, '&quot;') + '">' + bbDisplay + '</td>';
                row += '<td class="text-center"><button type="button" class="btn btn-sm btn-outline-secondary js-release-batch-to-production" data-batch-id="' + (b.id || '') + '" title="Send this batch back to production"><i class="fas fa-undo me-1"></i>Send back to production</button></td>';
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
                            cells.push('<td class="text-end">' + escapeHtml(String(val)) + '</td>');
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
                var yieldObj = (b.yield_by_style && typeof b.yield_by_style === 'object') ? b.yield_by_style : {};
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
                        cells.push('<td class="text-end">' + escapeHtml(String(val)) + '</td>');
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
                var cells = (b.remaining_by_style && typeof b.remaining_by_style === 'object') ? b.remaining_by_style : (b.yield_by_style || {});
                styleKeys.forEach(function (k) {
                    var v = cells[k];
                    if (v != null && v !== '') byStyle[k] += (typeof v === 'number' ? v : parseFloat(v)) || 0;
                });
            });
            var rows = styleKeys.map(function (k) {
                var total = byStyle[k];
                var amount = (total != null && !isNaN(total)) ? Number(total).toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
                return '<tr><td>' + escapeHtml(k) + '</td><td class="text-end">' + escapeHtml(String(amount)) + '</td></tr>';
            }).join('');
            tbody.innerHTML = rows || '<tr><td colspan="2" class="text-center text-muted py-4">No data.</td></tr>';
        },

        confirmAndReleaseBatchToProduction: function (batchId) {
            var scope = _stockManagementGrid;
            if (!batchId) return;
            if (typeof Swal === 'undefined') {
                scope.releaseBatchToProduction(batchId);
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
                if (result && result.isConfirmed) scope.releaseBatchToProduction(batchId);
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
                    '<td>' + (l.product_description || l.product_code || '') + '</td>' +
                    '<td>' + escapeHtml(displayOilLotGrade(l)) + '</td>' +
                    '<td class="text-end">' + (l.ffa !== null && l.ffa !== undefined ? Number(l.ffa).toFixed(2) : '') + '</td>' +
                    '<td class="text-end">' + (l.kilograms !== null && l.kilograms !== undefined ? Number(l.kilograms).toFixed(2) : '') + '</td>' +
                    '<td>' + bbDisplay + '</td>' +
                    '<td class="text-end ' + daysClass + '">' + (days !== '' ? days : '') + '</td>' +
                    '<td>' + (l.status || '') + '</td>' +
                    '<td class="text-nowrap"><button type="button" class="btn btn-sm btn-outline-primary edit-oil-lot-btn" data-oil-lot-id="' + l.id + '" title="Edit"><i class="fas fa-edit"></i></button> <button type="button" class="btn btn-sm btn-outline-danger delete-oil-lot-btn" data-oil-lot-id="' + l.id + '" title="Remove"><i class="fas fa-trash"></i></button></td>';
                tbody.appendChild(tr);
            }

            if (!oilRows.length) {
                bodyOil.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">No oil stock lines match your search.</td></tr>';
            } else oilRows.forEach(function (l) { renderRow(l, bodyOil); });

            if (!protRows.length) {
                bodyProt.innerHTML = '<tr><td colspan="11" class="text-center text-muted py-4">No protein powder stock lines match your search.</td></tr>';
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
