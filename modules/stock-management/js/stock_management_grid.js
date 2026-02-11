/**
 * Stock Management Grid Module
 */
var _stockManagementGrid = function () {
    return {
        stockItems: [],
        filteredStockItems: [],
        oilLots: [],
        oilSummary: [],
        oilSearchTimeout: null,
        oilImportWorkbook: null,
        oilImportPreviewRows: [],
        searchTimeout: null,
        init: function () {
            console.log('[Stock Management] Initializing grid...');
            const scope = this;
            
            // Apply stream from route (Stock (Kernel) vs Stock (Oil & Protein)) so storage is separate per supply chain
            scope.applyStreamFromRoute();
            
            // Use MutationObserver to wait for buttons to be added to DOM
            const checkAndInit = () => {
                const stockTakeBtn = document.getElementById('stockTakeBtn');
                if (stockTakeBtn) {
                    console.log('[Stock Management] Buttons found, setting up event listeners');
                    scope.setupEventListeners();
                    scope.loadStockItems();
                    scope.toggleKernelBatchJourney(document.getElementById('filterStockStream') ? document.getElementById('filterStockStream').value : 'kernel');
                    if (document.getElementById('oilLotsTableBody')) {
                        scope.loadOilLotsAndSummary();
                    }
                } else {
                    console.log('[Stock Management] Buttons not found yet, retrying...');
                    setTimeout(checkAndInit, 100);
                }
            };
            
            // Start checking
            setTimeout(checkAndInit, 50);
        },
        applyStreamFromRoute: function () {
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
                this.updateLocationOptionsByStream(streamSel.value || 'kernel');
                this.toggleKernelBatchJourney(streamSel.value || 'kernel');
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
            const scope = this;
            console.log('[Stock Management] Setting up event listeners...');
            
            // Check if buttons exist
            const stockTakeBtn = document.getElementById('stockTakeBtn');
            if (!stockTakeBtn) {
                console.warn('[Stock Management] stockTakeBtn not found!');
                return;
            }
            
            // Remove existing handlers to prevent duplicates (if jQuery is available)
            if (typeof $ !== 'undefined') {
                $('#addStockBtn').off('click');
                $('#rawMaterialIssuedBtn').off('click');
                $('#stockTakeBtn').off('click');
            }
            
            // Use both native and jQuery event listeners (only open on real user click, not programmatic)
            if (stockTakeBtn) {
                stockTakeBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    if (e.isTrusted) scope.showStockTakeModal();
                });
                if (typeof $ !== 'undefined') {
                    $('#stockTakeBtn').on('click', function(e) {
                        e.preventDefault();
                        if (e.originalEvent && e.originalEvent.isTrusted) scope.showStockTakeModal();
                    });
                }
            }
            
            // Other buttons with native event listeners
            const addStockBtn = document.getElementById('addStockBtn');
            if (addStockBtn) {
                addStockBtn.addEventListener('click', function() {
                    if (typeof Swal !== 'undefined') {
                        Swal.fire('Info', 'New stock item form coming soon', 'info');
                    }
                });
            }
            
            const rawMaterialBtn = document.getElementById('rawMaterialIssuedBtn');
            if (rawMaterialBtn) {
                rawMaterialBtn.addEventListener('click', function() {
                    scope.showRawMaterialIssuedModal();
                });
            }
            
            // jQuery handlers for compatibility
            if (typeof $ !== 'undefined') {
                $('#rawMaterialIssuedBtn').on('click', function () {
                    scope.showRawMaterialIssuedModal();
                });
            }
            
            // Stock Take handlers - use both native and jQuery
            const saveStockTakeBtn = document.getElementById('saveStockTakeBtn');
            if (saveStockTakeBtn) {
                saveStockTakeBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    scope.saveStockTake();
                });
            }
            
            const completeStockTakeBtn = document.getElementById('completeStockTakeBtn');
            if (completeStockTakeBtn) {
                completeStockTakeBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    scope.completeStockTake();
                });
            }
            
            const loadSystemStockBtn = document.getElementById('loadSystemStockBtn');
            if (loadSystemStockBtn) {
                loadSystemStockBtn.addEventListener('click', function() {
                    scope.loadSystemStockIntoTable();
                });
            }
            
            const addStockTakeItemRowBtn = document.getElementById('addStockTakeItemRow');
            if (addStockTakeItemRowBtn) {
                addStockTakeItemRowBtn.addEventListener('click', function() {
                    scope.addStockTakeItemRow();
                });
            }
            
            // jQuery handlers
            if (typeof $ !== 'undefined') {
                $('#saveStockTakeBtn').on('click', function (e) {
                    e.preventDefault();
                    scope.saveStockTake();
                });
                $('#completeStockTakeBtn').on('click', function (e) {
                    e.preventDefault();
                    scope.completeStockTake();
                });
                $('#loadSystemStockBtn').on('click', function () {
                    scope.loadSystemStockIntoTable();
                });
                $('#addStockTakeItemRow').on('click', function () {
                    scope.addStockTakeItemRow();
                });
            }
            
            // Close modal handlers - ensure modal can be closed (direct + delegated so it always works)
            const stockTakeModal = document.getElementById('stockTakeModal');
            if (stockTakeModal) {
                const cancelBtn = stockTakeModal.querySelector('.modal-footer button[data-bs-dismiss="modal"]');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        scope.closeStockTakeModal();
                    });
                }
                const closeBtn = stockTakeModal.querySelector('.modal-header .btn-close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        scope.closeStockTakeModal();
                    });
                }
                stockTakeModal.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape' || e.keyCode === 27) {
                        e.preventDefault();
                        scope.closeStockTakeModal();
                    }
                });
            }

            // Delegated close for Stock Take modal (works even if modal was opened before listeners attached)
            document.addEventListener('click', function(e) {
                const modal = document.getElementById('stockTakeModal');
                if (!modal || !modal.classList.contains('show')) return;
                if (e.target.closest('#stockTakeModal .btn-close') || e.target.closest('#stockTakeModal .modal-footer button[data-bs-dismiss="modal"]')) {
                    e.preventDefault();
                    e.stopPropagation();
                    scope.closeStockTakeModal();
                }
            }, true);
            
            // Delegated event handlers for dynamic content (both native and jQuery)
            document.addEventListener('click', function(e) {
                if (e.target.closest('.removeStockTakeRow')) {
                    e.preventDefault();
                    const row = e.target.closest('tr');
                    if (row) row.remove();
                    scope.calculateStockTakeVariance();
                }
            });
            
            // Delegated input handler for physical quantity
            const stockTakeTable = document.getElementById('stockTakeTable');
            if (stockTakeTable) {
                stockTakeTable.addEventListener('input', function(e) {
                    if (e.target.name === 'physicalQuantity') {
                        const row = e.target.closest('tr');
                        if (row) {
                            scope.calculateRowVariance(row);
                            scope.calculateStockTakeVariance();
                        }
                    }
                });
            }
            
            // jQuery handlers for compatibility
            if (typeof $ !== 'undefined') {
                $(document).on('click', '.removeStockTakeRow', function () {
                    $(this).closest('tr').remove();
                    scope.calculateStockTakeVariance();
                });
                $(document).on('input', 'input[name="physicalQuantity"]', function () {
                    const row = this.closest('tr');
                    if (row) {
                        scope.calculateRowVariance(row);
                        scope.calculateStockTakeVariance();
                    }
                });
                
                // Raw Material Issued handlers
                $('#saveRawMaterialIssuedBtn').on('click', function () {
                    scope.saveRawMaterialIssued();
                });
                $('#addIssuedItemRow').on('click', function () {
                    scope.addIssuedItemRow();
                });
                $(document).on('click', '.removeIssuedRow', function () {
                    $(this).closest('tr').remove();
                });
            }
            
            // Modal cleanup
            if (typeof $ !== 'undefined') {
                $('#rawMaterialIssuedModal').on('hidden.bs.modal', function () {
                    scope.clearRawMaterialIssuedForm();
                });
            }
            
            const rawMaterialModal = document.getElementById('rawMaterialIssuedModal');
            if (rawMaterialModal) {
                rawMaterialModal.addEventListener('hidden.bs.modal', function () {
                    scope.clearRawMaterialIssuedForm();
                });
            }
            
            // Search with debouncing
            $('#searchStockInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterStockItems();
                }, 300);
            });
            
            // Filters
            $('#filterStockStatus, #filterStockProduct, #filterStockLocation').on('change', function () {
                scope.filterStockItems();
            });
            
            $(document).on('click', '.js-release-batch-to-production', function () {
                var id = $(this).data('batch-id');
                if (id) scope.releaseBatchToProduction(id);
            });
            
            // Clear filters
            $('#clearStockFiltersBtn').on('click', function () {
                $('#searchStockInput').val('');
                $('#filterStockStatus').val('');
                $('#filterStockProduct').val('');
                $('#filterStockLocation').val('');
                scope.filterStockItems();
            });

            // Oil stock ledger controls
            const addOilLotBtn = document.getElementById('addOilLotBtn');
            if (addOilLotBtn) {
                addOilLotBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.showOilLotModal();
                });
            }
            const importOilLotsBtn = document.getElementById('importOilLotsBtn');
            if (importOilLotsBtn) {
                importOilLotsBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.showImportOilLotsModal();
                });
            }
            const saveOilLotBtn = document.getElementById('saveOilLotBtn');
            if (saveOilLotBtn) {
                saveOilLotBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.saveOilLot();
                });
            }

            // Oil filters
            const oilLocationFilter = document.getElementById('oilLocationFilter');
            const oilCategoryFilter = document.getElementById('oilCategoryFilter');
            const oilStatusFilter = document.getElementById('oilStatusFilter');
            if (oilLocationFilter) oilLocationFilter.addEventListener('change', () => scope.loadOilLotsAndSummary());
            if (oilCategoryFilter) oilCategoryFilter.addEventListener('change', () => scope.loadOilLotsAndSummary());
            if (oilStatusFilter) oilStatusFilter.addEventListener('change', () => scope.loadOilLotsAndSummary());

            const oilSearchInput = document.getElementById('oilSearchInput');
            if (oilSearchInput) {
                oilSearchInput.addEventListener('input', function () {
                    clearTimeout(scope.oilSearchTimeout);
                    scope.oilSearchTimeout = setTimeout(() => {
                        scope.loadOilLotsAndSummary();
                    }, 300);
                });
            }

            // Delegated actions for oil lots (requires jQuery)
            if (typeof $ !== 'undefined') {
                $(document).on('click', '.edit-oil-lot-btn', function () {
                    const id = $(this).data('oil-lot-id');
                    scope.editOilLot(id);
                });
                $(document).on('click', '.delete-oil-lot-btn', function () {
                    const id = $(this).data('oil-lot-id');
                    scope.deleteOilLot(id);
                });
            }

            // Import modal handlers (requires SheetJS)
            const oilImportFile = document.getElementById('oilImportExcelFile');
            if (oilImportFile) {
                oilImportFile.addEventListener('change', function () {
                    scope.handleOilImportFile(this.files && this.files[0] ? this.files[0] : null);
                });
            }
            const oilImportSheet = document.getElementById('oilImportSheet');
            if (oilImportSheet) {
                oilImportSheet.addEventListener('change', function () {
                    scope.renderOilImportPreview();
                });
            }
            const performOilImportBtn = document.getElementById('performOilImportBtn');
            if (performOilImportBtn) {
                performOilImportBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.performOilImport();
                });
            }
        },
        filterStockItems: function () {
            const searchTerm = $('#searchStockInput').val().toLowerCase();
            const statusFilter = $('#filterStockStatus').val();
            const productFilter = $('#filterStockProduct').val();
            const locationFilter = $('#filterStockLocation').val();
            const streamSel = document.getElementById('filterStockStream');
            const stream = streamSel ? streamSel.value : '';
            // Per supply chain: Kernel and Oil are separate; only show stock for selected stream
            const kernelLocations = ['NIS = R NIL', 'KERNEL R YES'];
            const oilLocations = ['OIL KERNEL R YES', 'OIL PROTEIN R YES'];
            const streamLocations = stream === 'oil' ? oilLocations : (stream === 'kernel' ? kernelLocations : null);
            
            this.filteredStockItems = this.stockItems.filter(item => {
                // Search filter
                const matchesSearch = !searchTerm || 
                    (item.stock_number && item.stock_number.toLowerCase().includes(searchTerm)) ||
                    (item.batch_number && item.batch_number.toLowerCase().includes(searchTerm)) ||
                    (item.location && item.location.toLowerCase().includes(searchTerm));
                
                // Status filter
                const matchesStatus = !statusFilter || item.status === statusFilter;
                
                // Product filter
                const matchesProduct = !productFilter || item.product_type === productFilter;
                
                // Location filter
                const matchesLocation = !locationFilter || item.location === locationFilter;
                
                // Stream filter: only show locations for Kernel or Oil & Protein
                const matchesStream = !streamLocations || (item.location && streamLocations.indexOf(item.location) !== -1);
                
                return matchesSearch && matchesStatus && matchesProduct && matchesLocation && matchesStream;
            });
            
            this.renderStockItems();
        },
        toggleKernelBatchJourney: function (stream) {
            var card = document.getElementById('kernelBatchJourneyCard');
            var oilCard = document.getElementById('oilStockLedgerCard');
            var mainFiltersCard = document.getElementById('mainStockFiltersCard');
            var mainTableCard = document.getElementById('mainStockTableCard');
            var addOilBtn = document.getElementById('addOilLotBtn');
            var importOilBtn = document.getElementById('importOilLotsBtn');
            if (stream === 'kernel') {
                if (card) { card.style.display = ''; }
                this.loadKernelBatches();
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
                if (stream === 'oil' && document.getElementById('oilLotsTableBody')) this.loadOilLotsAndSummary();
            }
        },
        loadKernelBatches: async function (forceRefresh) {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getProductionBatches) return;
                var all = await dataFunctions.getProductionBatches(null, forceRefresh, { batch_type: 'kernel' });
                all = all || [];
                this.kernelRawBatches = all.filter(function (b) { return b.status === 'in_raw_stock'; });
                this.kernelFinishedBatches = all.filter(function (b) { return b.status === 'in_finished_stock'; });
                this.renderKernelBatches();
            } catch (e) {
                console.error('[Stock Management] loadKernelBatches failed:', e);
                this.kernelRawBatches = [];
                this.kernelFinishedBatches = [];
                this.renderKernelBatches();
            }
        },
        renderKernelBatches: function () {
            var rawBody = $('#kernelRawBatchesBody');
            var finishedBody = $('#kernelFinishedBatchesBody');
            if (!rawBody.length || !finishedBody.length) return;
            rawBody.empty();
            finishedBody.empty();
            var scope = this;
            if (this.kernelRawBatches && this.kernelRawBatches.length) {
                this.kernelRawBatches.forEach(function (b) {
                    rawBody.append('<tr><td>' + (b.batch_number || '') + '</td><td>' + (b.grower_name || '') + '</td><td>' + (b.received_date || '') + '</td><td>' + (b.wet_nis_received_kg || '') + '</td><td><button type="button" class="btn btn-sm btn-success js-release-batch-to-production" data-batch-id="' + b.id + '">Release to production</button></td></tr>');
                });
            } else {
                rawBody.append('<tr><td colspan="5" class="text-muted small">No batches in raw stock. Move batches from Grower Intake first.</td></tr>');
            }
            if (this.kernelFinishedBatches && this.kernelFinishedBatches.length) {
                this.kernelFinishedBatches.forEach(function (b) {
                    finishedBody.append('<tr><td>' + (b.batch_number || '') + '</td><td>' + (b.grower_name || '') + '</td><td>' + (b.received_date || '') + '</td><td>' + (b.wet_nis_received_kg || '') + '</td></tr>');
                });
            } else {
                finishedBody.append('<tr><td colspan="4" class="text-muted small">No finished batches. Release to stock from Kernel Production when Production and End sample are done.</td></tr>');
            }
            this.renderKernelStockByStyle();
        },
        kernelStyleKeys: ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'],
        renderKernelStockByStyle: function () {
            var body = $('#kernelStockByStyleBody');
            var totalsRow = $('#kernelStockByStyleTotalsRow');
            if (!body.length || !totalsRow.length) return;
            body.empty();
            var batches = this.kernelFinishedBatches || [];
            var totals = { 'SP': 0, '0': 0, '1': 0, '1S': 0, '4L': 0, '5': 0, '6': 0, '7/8': 0, 'Butter High Oil': 0, 'Butter Low Oil': 0 };
            batches.forEach(function (b) {
                var cells = (b.yield_by_style && typeof b.yield_by_style === 'object') ? b.yield_by_style : {};
                var row = '<tr><td>' + (b.batch_number || '') + '</td>';
                ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'].forEach(function (k) {
                    var val = cells[k] != null ? cells[k] : (b['yield_' + k] != null ? b['yield_' + k] : 0);
                    if (typeof val === 'number') totals[k] += val;
                    row += '<td class="text-end">' + (val !== 0 && val !== '' ? val : '—') + '</td>';
                });
                row += '</tr>';
                body.append(row);
            });
            totalsRow.find('td[data-style]').each(function () {
                var k = $(this).data('style');
                $(this).text(totals[k] != null ? totals[k] : 0);
            });
        },
        releaseBatchToProduction: async function (batchId) {
            if (!batchId) return;
            try {
                var result = await dataFunctions.updateProductionBatch(batchId, { status: 'receiving', current_step: 1, stage: 'production' });
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released', text: 'Batch is now in production. Use Kernel Production to advance steps.', timer: 2000, showConfirmButton: false });
                    this.loadKernelBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release batch', 'error');
            }
        },
        loadStockItems: async function (forceRefresh = false) {
            try {
                // Ensure dataFunctions is available
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getStockItems !== 'function') {
                    console.warn('[Stock Management] dataFunctions not available, skipping load');
                    return;
                }
                
                const startTime = performance.now();
                console.log('[Stock Management] Loading stock items...');
                
                const items = await dataFunctions.getStockItems(null, forceRefresh).catch((error) => {
                    console.error('[Stock Management] Error loading stock items:', error);
                    return [];
                });
                
                const loadTime = performance.now() - startTime;
                console.log(`[Stock Management] Stock items loaded in ${loadTime.toFixed(2)}ms, count: ${items ? items.length : 0}`);
                
                this.stockItems = items || [];
                this.filteredStockItems = this.stockItems;
                this.renderStockItems();
            } catch (error) {
                console.error('[Stock Management] Error loading stock items:', error);
            }
        },
        renderStockItems: function () {
            const tbody = $('#stockTableBody');
            tbody.empty();
            if (this.filteredStockItems.length === 0) {
                if (this.stockItems.length === 0) {
                    tbody.html('<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No stock items found. Click "New Stock Item" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="8" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No stock items match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            this.filteredStockItems.forEach(item => {
                const statusClass = item.status === 'available' ? 'bg-success' : 
                                  item.status === 'reserved' ? 'bg-warning' : 'bg-secondary';
                const row = `<tr>
                    <td>${item.stock_number || 'N/A'}</td>
                    <td>${item.product_type || 'N/A'}</td>
                    <td>${item.style || 'N/A'}</td>
                    <td>${item.batch_number || 'N/A'}</td>
                    <td>${item.quantity_kg || '0'}</td>
                    <td>${item.location || 'N/A'}</td>
                    <td><span class="badge ${statusClass}">${item.status || 'N/A'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="stockManagementGrid.viewItem('${item.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        viewItem: function (itemId) {
            Swal.fire('Info', 'Stock item details coming soon', 'info');
        },

        // -----------------------------
        // Oil Stock Ledger (801/850/Sold)
        // -----------------------------
        getOilFilters: function () {
            const el = (id) => document.getElementById(id);
            return {
                location_code: el('oilLocationFilter') ? el('oilLocationFilter').value || null : null,
                stock_category: el('oilCategoryFilter') ? el('oilCategoryFilter').value || null : null,
                status: el('oilStatusFilter') ? el('oilStatusFilter').value || null : null,
                search: el('oilSearchInput') ? el('oilSearchInput').value || null : null,
                limit: 500,
                offset: 0
            };
        },

        loadOilLotsAndSummary: async function (forceRefresh = false) {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getOilStockLots !== 'function') {
                    console.warn('[Stock Management] Oil stock functions not available yet');
                    return;
                }

                const filters = this.getOilFilters();
                const lots = await dataFunctions.getOilStockLots(filters, null, forceRefresh).catch((e) => {
                    console.error('[Stock Management] getOilStockLots error:', e);
                    return [];
                });
                this.oilLots = Array.isArray(lots) ? lots : (lots?.data || []);

                // Summary defaults to on_hand if no explicit status filter is selected
                const summaryFilters = {
                    location_code: filters.location_code,
                    stock_category: filters.stock_category,
                    status: filters.status || 'on_hand'
                };
                const summary = await dataFunctions.getOilStockSummary(summaryFilters, null, forceRefresh).catch((e) => {
                    console.error('[Stock Management] getOilStockSummary error:', e);
                    return [];
                });
                this.oilSummary = Array.isArray(summary) ? summary : (summary?.data || []);

                this.renderOilSummary();
                this.renderOilLots();
            } catch (e) {
                console.error('[Stock Management] loadOilLotsAndSummary failed:', e);
            }
        },

        renderOilSummary: function () {
            const tbody = document.getElementById('oilSummaryTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';

            const rows = this.oilSummary || [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted py-3">No summary data</td></tr>';
                return;
            }

            rows.forEach(r => {
                const avg = (r.avg_ffa !== null && r.avg_ffa !== undefined) ? Number(r.avg_ffa).toFixed(2) : '';
                const sumKg = (r.sum_kilograms !== null && r.sum_kilograms !== undefined) ? Number(r.sum_kilograms).toFixed(2) : '0.00';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${r.label || 'Unspecified'}</td>
                    <td class="text-end">${avg}</td>
                    <td class="text-end">${sumKg}</td>
                `;
                tbody.appendChild(tr);
            });
        },

        daysRemainingFromBbDate: function (bbDate) {
            if (!bbDate) return '';
            const d = new Date(bbDate);
            if (isNaN(d.getTime())) return '';
            const today = new Date();
            const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            const end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const diff = Math.round((end - start) / (1000 * 60 * 60 * 24));
            return diff;
        },

        renderOilLots: function () {
            const tbody = document.getElementById('oilLotsTableBody');
            if (!tbody) return;
            tbody.innerHTML = '';

            const rows = this.oilLots || [];
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="15" class="text-center text-muted py-4">No oil stock lots found</td></tr>';
                return;
            }

            rows.forEach(l => {
                const days = this.daysRemainingFromBbDate(l.bb_date);
                const daysClass = (days !== '' && days < 0) ? 'text-danger fw-bold' : (days !== '' && days < 30) ? 'text-warning fw-bold' : '';
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${l.location_code || ''}</td>
                    <td>${l.stock_category || ''}</td>
                    <td>${l.counterparty_name || ''}</td>
                    <td>${l.po_reference || ''}</td>
                    <td>${l.batch_number || ''}</td>
                    <td>${l.product_description || l.product_code || ''}</td>
                    <td>${l.grade || ''}</td>
                    <td class="text-end">${l.ffa !== null && l.ffa !== undefined ? Number(l.ffa).toFixed(2) : ''}</td>
                    <td class="text-end">${l.units !== null && l.units !== undefined ? l.units : ''}</td>
                    <td class="text-end">${l.kilograms !== null && l.kilograms !== undefined ? Number(l.kilograms).toFixed(2) : ''}</td>
                    <td>${l.manufacture_date || ''}</td>
                    <td>${l.bb_date || ''}</td>
                    <td class="text-end ${daysClass}">${days !== '' ? days : ''}</td>
                    <td>${l.status || ''}</td>
                    <td class="text-nowrap">
                        <button class="btn btn-sm btn-outline-primary edit-oil-lot-btn" data-oil-lot-id="${l.id}" title="Edit"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-outline-danger delete-oil-lot-btn" data-oil-lot-id="${l.id}" title="Remove"><i class="fas fa-trash"></i></button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        },

        showOilLotModal: function (lot = null) {
            const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
            const getDefault = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

            setVal('oilLotId', lot ? lot.id : '');
            setVal('oilLotLocation', lot ? lot.location_code : (getDefault('oilLocationFilter') || ''));
            setVal('oilLotCategory', lot ? lot.stock_category : (getDefault('oilCategoryFilter') || ''));
            setVal('oilLotStatus', lot ? lot.status : (getDefault('oilStatusFilter') || 'on_hand'));
            setVal('oilLotCounterpartyType', lot ? lot.counterparty_type : '');
            setVal('oilLotCounterpartyName', lot ? (lot.counterparty_name || '') : '');
            setVal('oilLotPoRef', lot ? (lot.po_reference || '') : '');
            setVal('oilLotBatchNumber', lot ? (lot.batch_number || '') : '');
            setVal('oilLotProductCode', lot ? (lot.product_code || '') : '');
            setVal('oilLotProductDescription', lot ? (lot.product_description || '') : '');
            setVal('oilLotGrade', lot ? (lot.grade || '') : '');
            setVal('oilLotFfa', lot ? (lot.ffa ?? '') : '');
            setVal('oilLotUnits', lot ? (lot.units ?? '') : '');
            setVal('oilLotKg', lot ? (lot.kilograms ?? '') : '');
            setVal('oilLotVolume', lot ? (lot.volume ?? '') : '');
            setVal('oilLotDeliveryDate', lot ? (lot.delivery_date || '') : '');
            setVal('oilLotManufactureDate', lot ? (lot.manufacture_date || '') : '');
            setVal('oilLotBbDate', lot ? (lot.bb_date || '') : '');
            setVal('oilLotCoaStatus', lot ? (lot.coa_status || '') : '');
            setVal('oilLotNotes', lot ? (lot.notes || '') : '');

            const title = document.getElementById('oilLotModalLabel');
            if (title) title.textContent = lot ? 'Edit Oil Stock Lot' : 'Add Oil Stock Lot';

            const modalEl = document.getElementById('oilLotModal');
            if (modalEl && window.bootstrap) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined') {
                $('#oilLotModal').modal('show');
            }
        },

        editOilLot: function (lotId) {
            const lot = (this.oilLots || []).find(x => x.id === lotId);
            if (!lot) {
                Swal.fire('Error', 'Oil lot not found in current list. Try refreshing.', 'error');
                return;
            }
            this.showOilLotModal(lot);
        },

        saveOilLot: async function () {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions) return;

                const val = (id) => {
                    const el = document.getElementById(id);
                    return el ? el.value : '';
                };

                const lotId = val('oilLotId') || null;
                const location = val('oilLotLocation');
                const category = val('oilLotCategory');
                const kg = parseFloat(val('oilLotKg'));

                if (!location || !category || !kg || kg <= 0) {
                    Swal.fire('Validation', 'Location, Category, and Kilograms (> 0) are required.', 'warning');
                    return;
                }

                const payload = {
                    p_location_code: location,
                    p_stock_category: category,
                    p_kilograms: kg,
                    p_status: val('oilLotStatus') || 'on_hand',
                    p_counterparty_type: val('oilLotCounterpartyType') || null,
                    p_counterparty_name: val('oilLotCounterpartyName') || null,
                    p_po_reference: val('oilLotPoRef') || null,
                    p_batch_number: val('oilLotBatchNumber') || null,
                    p_product_code: val('oilLotProductCode') || null,
                    p_product_description: val('oilLotProductDescription') || null,
                    p_grade: val('oilLotGrade') || null,
                    p_ffa: val('oilLotFfa') ? parseFloat(val('oilLotFfa')) : null,
                    p_coa_status: val('oilLotCoaStatus') || null,
                    p_units: val('oilLotUnits') ? parseInt(val('oilLotUnits'), 10) : null,
                    p_volume: val('oilLotVolume') ? parseFloat(val('oilLotVolume')) : null,
                    p_delivery_date: val('oilLotDeliveryDate') || null,
                    p_manufacture_date: val('oilLotManufactureDate') || null,
                    p_bb_date: val('oilLotBbDate') || null,
                    p_notes: val('oilLotNotes') || null
                };

                let result;
                if (lotId) {
                    result = await dataFunctions.updateOilStockLot(lotId, payload);
                } else {
                    result = await dataFunctions.createOilStockLot(payload);
                }

                if (result && result.success !== false) {
                    Swal.fire('Success', lotId ? 'Oil lot updated' : 'Oil lot created', 'success');
                    const modalEl = document.getElementById('oilLotModal');
                    if (modalEl && window.bootstrap) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined') $('#oilLotModal').modal('hide');
                    await this.loadOilLotsAndSummary(true);
                } else {
                    Swal.fire('Error', result?.error || result?.message || 'Failed to save oil lot', 'error');
                }
            } catch (e) {
                console.error('[Stock Management] saveOilLot failed:', e);
                Swal.fire('Error', e.message || 'Failed to save oil lot', 'error');
            }
        },

        deleteOilLot: async function (lotId) {
            try {
                const confirm = await Swal.fire({
                    title: 'Remove oil lot?',
                    text: 'This will hide the lot from the ledger (soft delete).',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, remove',
                    cancelButtonText: 'Cancel'
                });
                if (!confirm.isConfirmed) return;

                const result = await dataFunctions.deactivateOilStockLot(lotId);
                if (result && result.success !== false) {
                    Swal.fire('Removed', 'Oil lot removed', 'success');
                    await this.loadOilLotsAndSummary(true);
                } else {
                    Swal.fire('Error', result?.error || result?.message || 'Failed to remove oil lot', 'error');
                }
            } catch (e) {
                console.error('[Stock Management] deleteOilLot failed:', e);
                Swal.fire('Error', e.message || 'Failed to remove oil lot', 'error');
            }
        },

        showImportOilLotsModal: function () {
            // reset UI
            this.oilImportWorkbook = null;
            this.oilImportPreviewRows = [];
            const sheetSel = document.getElementById('oilImportSheet');
            if (sheetSel) {
                sheetSel.innerHTML = '<option value="">Select sheet</option>';
                sheetSel.disabled = true;
            }
            const preview = document.getElementById('oilImportPreview');
            if (preview) preview.style.display = 'none';
            const btn = document.getElementById('performOilImportBtn');
            if (btn) btn.disabled = true;
            const file = document.getElementById('oilImportExcelFile');
            if (file) file.value = '';

            const modalEl = document.getElementById('importOilLotsModal');
            if (modalEl && window.bootstrap) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined') {
                $('#importOilLotsModal').modal('show');
            }
        },

        handleOilImportFile: async function (file) {
            try {
                if (!file) return;
                if (typeof XLSX === 'undefined') {
                    Swal.fire('Missing library', 'SheetJS (XLSX) is not loaded. Please refresh the page.', 'error');
                    return;
                }

                const data = await file.arrayBuffer();
                this.oilImportWorkbook = XLSX.read(data, { type: 'array' });

                const sheetSel = document.getElementById('oilImportSheet');
                if (!sheetSel) return;

                sheetSel.innerHTML = '<option value="">Select sheet</option>';
                (this.oilImportWorkbook.SheetNames || []).forEach(name => {
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = name;
                    sheetSel.appendChild(opt);
                });
                sheetSel.disabled = false;

                // auto-select first sheet
                if (this.oilImportWorkbook.SheetNames && this.oilImportWorkbook.SheetNames.length) {
                    sheetSel.value = this.oilImportWorkbook.SheetNames[0];
                    this.renderOilImportPreview();
                }
            } catch (e) {
                console.error('[Stock Management] handleOilImportFile failed:', e);
                Swal.fire('Error', e.message || 'Failed to read Excel file', 'error');
            }
        },

        normalizeHeader: function (h) {
            return String(h || '').trim().toLowerCase();
        },

        parseExcelDate: function (v) {
            if (!v && v !== 0) return null;
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            if (typeof v === 'number' && typeof XLSX !== 'undefined' && XLSX.SSF && XLSX.SSF.parse_date_code) {
                const d = XLSX.SSF.parse_date_code(v);
                if (d && d.y && d.m && d.d) {
                    const mm = String(d.m).padStart(2, '0');
                    const dd = String(d.d).padStart(2, '0');
                    return `${d.y}-${mm}-${dd}`;
                }
            }
            const s = String(v).trim();
            const dt = new Date(s);
            if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
            return null;
        },

        inferDefaultsFromSheetName: function (sheetName) {
            const name = (sheetName || '').toLowerCase();
            const defaults = { location_code: null, stock_category: null };
            if (name.includes('801')) defaults.location_code = '801';
            if (name.includes('850')) defaults.location_code = '850';
            if (name.includes('rm') || name.includes('raw')) defaults.stock_category = 'raw_material';
            if (name.includes('fg') || name.includes('finished')) defaults.stock_category = 'finished_good';
            if (name.includes('sold')) defaults.stock_category = 'sold';
            return defaults;
        },

        findHeaderRowIndex: function (rows) {
            const wanted = ['batch', 'product', 'grade', 'kilograms', 'ffa'];
            for (let i = 0; i < Math.min(rows.length, 30); i++) {
                const r = rows[i] || [];
                const joined = r.map(x => this.normalizeHeader(x)).join(' | ');
                if (wanted.some(w => joined.includes(w))) return i;
            }
            return 0;
        },

        renderOilImportPreview: function () {
            try {
                const wb = this.oilImportWorkbook;
                const sheetName = document.getElementById('oilImportSheet')?.value;
                if (!wb || !sheetName) return;

                const ws = wb.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
                if (!rows || !rows.length) return;

                const headerIdx = this.findHeaderRowIndex(rows);
                const headers = (rows[headerIdx] || []).map(h => String(h || '').trim());
                const dataRows = rows.slice(headerIdx + 1).filter(r => (r || []).some(c => String(c || '').trim() !== ''));

                // Build preview table
                const thead = document.querySelector('#oilImportPreviewTable thead');
                const tbody = document.querySelector('#oilImportPreviewTable tbody');
                if (!thead || !tbody) return;

                thead.innerHTML = `<tr>${headers.slice(0, 12).map(h => `<th>${h}</th>`).join('')}</tr>`;
                tbody.innerHTML = '';
                dataRows.slice(0, 10).forEach(r => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = headers.slice(0, 12).map((_, idx) => `<td>${r[idx] ?? ''}</td>`).join('');
                    tbody.appendChild(tr);
                });

                const preview = document.getElementById('oilImportPreview');
                if (preview) preview.style.display = 'block';

                // Store parsed rows for import mapping
                this.oilImportPreviewRows = [{ headers, dataRows, sheetName }];

                const btn = document.getElementById('performOilImportBtn');
                if (btn) btn.disabled = dataRows.length === 0;
            } catch (e) {
                console.error('[Stock Management] renderOilImportPreview failed:', e);
            }
        },

        buildOilImportRows: function () {
            const parsed = this.oilImportPreviewRows && this.oilImportPreviewRows[0] ? this.oilImportPreviewRows[0] : null;
            if (!parsed) return [];

            const headers = parsed.headers || [];
            const dataRows = parsed.dataRows || [];
            const sheetName = parsed.sheetName || '';

            const headerMap = headers.map(h => this.normalizeHeader(h));
            const idxOf = (names) => {
                const ns = Array.isArray(names) ? names : [names];
                for (const n of ns) {
                    const idx = headerMap.indexOf(this.normalizeHeader(n));
                    if (idx >= 0) return idx;
                }
                return -1;
            };

            const idxDelivery = idxOf(['delivery date', 'date dispatched']);
            const idxSupplier = idxOf(['supplier']);
            const idxCustomer = idxOf(['customer']);
            const idxPo = idxOf(['po reference', 'po ref']);
            const idxBatch = idxOf(['batch #', 'batch']);
            const idxProduct = idxOf(['product description', 'product']);
            const idxGrade = idxOf(['grade']);
            const idxFfa = idxOf(['ffa']);
            const idxCoa = idxOf(['coa status', 'coa']);
            const idxUnits = idxOf(['units']);
            const idxVol = idxOf(['volume']);
            const idxKg = idxOf(['kilograms', 'kilogram', 'kg']);
            const idxMfg = idxOf(['manufacture date', 'mfg date']);
            const idxBb = idxOf(['bb date', 'best before', 'best before date']);
            const idxStatus = idxOf(['status']);

            const uiDefaultLoc = document.getElementById('oilImportDefaultLocation')?.value || null;
            const uiDefaultCat = document.getElementById('oilImportDefaultCategory')?.value || null;
            const inferred = this.inferDefaultsFromSheetName(sheetName);

            const location_code = uiDefaultLoc || inferred.location_code || (document.getElementById('oilLocationFilter')?.value || null) || '801';
            const stock_category = uiDefaultCat || inferred.stock_category || (document.getElementById('oilCategoryFilter')?.value || null) || 'raw_material';

            const rowsOut = [];
            dataRows.forEach(r => {
                const kgValRaw = idxKg >= 0 ? r[idxKg] : null;
                const kgVal = kgValRaw !== null && kgValRaw !== undefined && kgValRaw !== '' ? parseFloat(String(kgValRaw).replace(/,/g, '')) : null;

                const productDesc = idxProduct >= 0 ? (r[idxProduct] ?? null) : null;
                const batch = idxBatch >= 0 ? (r[idxBatch] ?? null) : null;

                if (!kgVal || kgVal <= 0) return; // skip non-rows
                if (!productDesc && !batch) return;

                const counterparty_name = idxSupplier >= 0 ? (r[idxSupplier] ?? null) : (idxCustomer >= 0 ? (r[idxCustomer] ?? null) : null);
                const counterparty_type = idxSupplier >= 0 ? 'supplier' : (idxCustomer >= 0 ? 'customer' : null);

                const pd = productDesc ? String(productDesc).trim() : null;
                const code = pd && pd.includes('-') ? pd.split('-')[0].trim() : null;

                rowsOut.push({
                    location_code,
                    stock_category,
                    status: (idxStatus >= 0 && r[idxStatus]) ? String(r[idxStatus]).trim() : (stock_category === 'sold' ? 'sold' : 'on_hand'),
                    counterparty_type,
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
                    delivery_date: idxDelivery >= 0 ? this.parseExcelDate(r[idxDelivery]) : null,
                    manufacture_date: idxMfg >= 0 ? this.parseExcelDate(r[idxMfg]) : null,
                    bb_date: idxBb >= 0 ? this.parseExcelDate(r[idxBb]) : null
                });
            });

            return rowsOut;
        },

        performOilImport: async function () {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.importTableRows !== 'function') {
                    Swal.fire('Error', 'Import functions are not available.', 'error');
                    return;
                }

                const rows = this.buildOilImportRows();
                if (!rows.length) {
                    Swal.fire('No data', 'No valid rows found to import (need Kilograms + Product/Batch).', 'info');
                    return;
                }

                const confirm = await Swal.fire({
                    title: `Import ${rows.length} rows?`,
                    text: 'This will insert rows into Oil Stock Ledger. You can edit/remove them after import.',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Import',
                    cancelButtonText: 'Cancel'
                });
                if (!confirm.isConfirmed) return;

                const result = await dataFunctions.importTableRows('oil_stock_lots', rows);
                if (result && result.success !== false) {
                    Swal.fire('Imported', result.message || 'Oil stock imported successfully', 'success');
                    const modalEl = document.getElementById('importOilLotsModal');
                    if (modalEl && window.bootstrap) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined') $('#importOilLotsModal').modal('hide');
                    await this.loadOilLotsAndSummary(true);
                } else {
                    Swal.fire('Error', result?.error || result?.message || 'Import failed', 'error');
                }
            } catch (e) {
                console.error('[Stock Management] performOilImport failed:', e);
                Swal.fire('Error', e.message || 'Import failed', 'error');
            }
        },
        
        forceCloseModal: function (modalId) {
            const el = document.getElementById(modalId);
            if (!el) return;
            el.classList.remove('show');
            el.style.display = 'none';
            el.setAttribute('aria-hidden', 'true');
            el.removeAttribute('aria-modal');
            el.removeAttribute('role');
            document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        },
        
        showRawMaterialIssuedModal: async function () {
            $('#rawMaterialIssuedModalLabel').text('Raw Material Stock Issued');
            $('#stockIssuedId').val('');
            this.clearRawMaterialIssuedForm();
            
            // Load users for "Issued By" dropdowns
            try {
                const users = await dataFunctions.getUsers();
                const userOptions = '<option value="">Select User</option>';
                if (users && Array.isArray(users)) {
                    users.forEach(user => {
                        const name = user.email || user.username || 'Unknown';
                        $('select[name="issuedBy"]').append(`<option value="${user.id}">${name}</option>`);
                    });
                }
            } catch (error) {
                console.error('Error loading users:', error);
            }
            
            // Use Bootstrap 5 modal API
            const issuedModal = document.getElementById('rawMaterialIssuedModal');
            if (issuedModal) {
                const modal = new bootstrap.Modal(issuedModal);
                modal.show();
            } else {
                console.error('Raw material issued modal element not found!');
            }
        },
        
        clearRawMaterialIssuedForm: function () {
            $('#rawMaterialIssuedForm')[0].reset();
            $('#stockIssuedId').val('');
            // Clear issued items rows except first
            $('#issuedItemsTableBody tr:not(:first)').remove();
            $('#issuedItemsTableBody tr:first input, #issuedItemsTableBody tr:first select').val('');
            // Clear user dropdowns
            $('select[name="issuedBy"]').html('<option value="">Select User</option>');
        },
        
        addIssuedItemRow: function () {
            const userOptions = $('select[name="issuedBy"]:first').html();
            const newRow = `
                <tr>
                    <td><input type="date" class="form-control form-control-sm" name="issueDate"></td>
                    <td><input type="date" class="form-control form-control-sm" name="bestBefore"></td>
                    <td><input type="date" class="form-control form-control-sm" name="productionDate"></td>
                    <td>
                        <select class="form-select form-select-sm" name="productDescription">
                            <option value="">Select Product</option>
                            <option value="Shell">Shell</option>
                            <option value="Kernel">Kernel</option>
                            <option value="Kernel Dust">Kernel Dust</option>
                            <option value="Cracker Dust">Cracker Dust</option>
                            <option value="cracker">cracker</option>
                        </select>
                    </td>
                    <td><input type="text" class="form-control form-control-sm" name="batchDetails"></td>
                    <td><input type="number" class="form-control form-control-sm" name="quantityRequired" step="0.01"></td>
                    <td><input type="number" class="form-control form-control-sm" name="totalIssued" step="0.01"></td>
                    <td>
                        <select class="form-select form-select-sm" name="issuedBy">
                            ${userOptions}
                        </select>
                    </td>
                    <td>
                        <select class="form-select form-select-sm" name="issuedToDept">
                            <option value="">Select Department</option>
                            <option value="Crude Oil Dept.">Crude Oil Dept.</option>
                            <option value="Kernel Production">Kernel Production</option>
                            <option value="Oil Production">Oil Production</option>
                            <option value="Packing">Packing</option>
                            <option value="Quality Assurance">Quality Assurance</option>
                        </select>
                    </td>
                    <td><button type="button" class="btn btn-sm btn-danger removeIssuedRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            $('#issuedItemsTableBody').append(newRow);
        },
        
        saveRawMaterialIssued: async function () {
            try {
                const form = $('#rawMaterialIssuedForm')[0];
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                
                // Collect issued items
                const issuedItems = [];
                $('#issuedItemsTableBody tr').each(function () {
                    const issueDate = $(this).find('input[name="issueDate"]').val();
                    const bestBefore = $(this).find('input[name="bestBefore"]').val();
                    const productionDate = $(this).find('input[name="productionDate"]').val();
                    const productDescription = $(this).find('select[name="productDescription"]').val();
                    const batchDetails = $(this).find('input[name="batchDetails"]').val();
                    const quantityRequired = $(this).find('input[name="quantityRequired"]').val();
                    const totalIssued = $(this).find('input[name="totalIssued"]').val();
                    const issuedBy = $(this).find('select[name="issuedBy"]').val();
                    const issuedToDept = $(this).find('select[name="issuedToDept"]').val();
                    
                    if (issueDate || productDescription || batchDetails || quantityRequired || totalIssued) {
                        issuedItems.push({
                            issue_date: issueDate || null,
                            best_before: bestBefore || null,
                            production_date: productionDate || null,
                            product_description: productDescription || null,
                            batch_details: batchDetails || null,
                            quantity_required_kg: quantityRequired ? parseFloat(quantityRequired) : null,
                            total_issued_kg: totalIssued ? parseFloat(totalIssued) : null,
                            issued_by: issuedBy || null,
                            issued_to_department: issuedToDept || null
                        });
                    }
                });
                
                const issuedData = {
                    p_shift: $('#issuedShift').val(),
                    p_issued_items: JSON.stringify(issuedItems)
                };
                
                const issuedId = $('#stockIssuedId').val();
                let result;
                
                if (issuedId) {
                    result = await dataFunctions.callFunction('update_raw_material_issued', {
                        p_issued_id: issuedId,
                        ...issuedData
                    });
                } else {
                    result = await dataFunctions.callFunction('create_raw_material_issued', issuedData);
                }
                
                if (result && result.success !== false) {
                    // Invalidate caches
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('raw_material_issued');
                        dataFunctions.clearCachePattern('stock_items');
                    }
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: issuedId ? 'Raw material issued updated successfully' : 'Raw material issued recorded successfully',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    const issuedModal = document.getElementById('rawMaterialIssuedModal');
                    if (issuedModal) {
                        const modal = bootstrap.Modal.getInstance(issuedModal);
                        if (modal) modal.hide();
                    }
                    this.loadStockItems(true); // Force refresh
                } else {
                    throw new Error(result?.error || result?.message || 'Failed to save raw material issued');
                }
            } catch (error) {
                console.error('Error saving raw material issued:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to save raw material issued: ' + error.message
                });
            }
        },
        
        showStockTakeModal: async function () {
            try {
                console.log('[Stock Management] Opening stock take modal');
                $('#stockTakeModalLabel').text('Stock Take - Physical Count');
                $('#stockTakeId').val('');
                this.clearStockTakeForm();
                
                // Set default date to today
                const today = new Date().toISOString().split('T')[0];
                $('#stockTakeDate').val(today);
                
                // Use Bootstrap 5 modal API with fallback
                const modalElement = document.getElementById('stockTakeModal');
                if (!modalElement) {
                    console.error('[Stock Management] Stock take modal element not found!');
                    Swal.fire('Error', 'Stock take modal not found. Please refresh the page.', 'error');
                    return;
                }
                
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
                    modal.show();
                    console.log('[Stock Management] Modal shown via Bootstrap 5');
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#stockTakeModal').modal('show');
                    console.log('[Stock Management] Modal shown via jQuery');
                } else {
                    console.error('[Stock Management] Neither Bootstrap nor jQuery modal available!');
                    Swal.fire('Error', 'Unable to open modal. Please ensure Bootstrap is loaded.', 'error');
                }
            } catch (error) {
                console.error('[Stock Management] Error showing stock take modal:', error);
                Swal.fire('Error', 'Failed to open stock take form: ' + error.message, 'error');
            }
        },
        
        closeStockTakeModal: function () {
            const modalElement = document.getElementById('stockTakeModal');
            if (!modalElement) return;
            try {
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
                    modal.hide();
                }
                if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#stockTakeModal').modal('hide');
                }
                // Always run force-cleanup after a short delay so backdrop and body state are cleared
                setTimeout(() => {
                    const stillShown = modalElement.classList.contains('show') || (modalElement.style.display && modalElement.style.display !== 'none');
                    if (stillShown) {
                        this.hardForceCloseStockTakeModal();
                    }
                    // Remove any leftover backdrops and restore body
                    document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
                    document.body.classList.remove('modal-open');
                    document.body.style.overflow = '';
                    document.body.style.paddingRight = '';
                }, 100);
            } catch (error) {
                this.hardForceCloseStockTakeModal();
            }
        },

        hardForceCloseStockTakeModal: function () {
            const modalElement = document.getElementById('stockTakeModal');
            if (!modalElement) return;

            try {
                // Use global safety hatch if available
                if (typeof window !== 'undefined' && typeof window.forceCloseAllModals === 'function') {
                    window.forceCloseAllModals();
                }

                // Targeted cleanup (in case global is unavailable / insufficient)
                modalElement.classList.remove('show');
                modalElement.style.display = 'none';
                modalElement.setAttribute('aria-hidden', 'true');
                modalElement.removeAttribute('aria-modal');
                modalElement.removeAttribute('role');

                // Remove all backdrops (sometimes multiple get stacked)
                document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());

                // Restore body scroll
                document.body.classList.remove('modal-open');
                document.body.style.overflow = '';
                document.body.style.paddingRight = '';

                console.log('[Stock Management] Modal force-closed');
            } catch (e) {
                console.warn('[Stock Management] hardForceCloseStockTakeModal failed:', e);
            }
        },
        
        clearStockTakeForm: function () {
            const form = document.getElementById('stockTakeForm');
            if (form) form.reset();
            
            const stockTakeId = document.getElementById('stockTakeId');
            if (stockTakeId) stockTakeId.value = '';
            
            const stockTakeBody = document.getElementById('stockTakeTableBody');
            if (stockTakeBody) {
                const rows = stockTakeBody.querySelectorAll('tr');
                // Remove all rows except first
                for (let i = rows.length - 1; i > 0; i--) {
                    rows[i].remove();
                }
                // Clear first row inputs
                if (rows[0]) {
                    const inputs = rows[0].querySelectorAll('input');
                    inputs.forEach(input => input.value = '');
                }
            }
            this.calculateStockTakeVariance();
        },
        
        loadSystemStockIntoTable: async function () {
            try {
                const stockItems = await dataFunctions.getStockItems();
                const tbody = $('#stockTakeTableBody');
                
                // Clear existing rows except header
                tbody.find('tr').remove();
                
                if (stockItems && stockItems.length > 0) {
                    stockItems.forEach(item => {
                        const row = `
                            <tr>
                                <td><input type="text" class="form-control form-control-sm" name="stockNumber" value="${item.stock_number || ''}" readonly></td>
                                <td><input type="text" class="form-control form-control-sm" name="description" value="${item.description || item.product_type || ''}"></td>
                                <td><input type="text" class="form-control form-control-sm" name="unitOfMeasure" value="kg"></td>
                                <td><input type="text" class="form-control form-control-sm" name="binLocation" value="${item.bin_location || 'DEFAULT'}"></td>
                                <td><input type="number" class="form-control form-control-sm" name="systemQuantity" step="0.01" value="${item.quantity_kg || 0}" readonly></td>
                                <td><input type="number" class="form-control form-control-sm" name="physicalQuantity" step="0.01" value="${item.quantity_kg || 0}"></td>
                                <td><input type="number" class="form-control form-control-sm" name="variance" step="0.01" readonly></td>
                                <td><input type="number" class="form-control form-control-sm" name="variancePercentage" step="0.01" readonly></td>
                                <td><button type="button" class="btn btn-sm btn-danger removeStockTakeRow"><i class="fas fa-times"></i></button></td>
                            </tr>
                        `;
                        tbody.append(row);
                    });
                    
                    // Calculate variance for all rows
                    tbody.find('tr').each((index, row) => {
                        this.calculateRowVariance($(row));
                    });
                    this.calculateStockTakeVariance();
                }
            } catch (error) {
                console.error('Error loading system stock:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to load system stock: ' + error.message
                });
            }
        },
        
        addStockTakeItemRow: function () {
            const newRow = `
                <tr>
                    <td><input type="text" class="form-control form-control-sm" name="stockNumber"></td>
                    <td><input type="text" class="form-control form-control-sm" name="description"></td>
                    <td><input type="text" class="form-control form-control-sm" name="unitOfMeasure" value="kg"></td>
                    <td><input type="text" class="form-control form-control-sm" name="binLocation" value="DEFAULT"></td>
                    <td><input type="number" class="form-control form-control-sm" name="systemQuantity" step="0.01" readonly></td>
                    <td><input type="number" class="form-control form-control-sm" name="physicalQuantity" step="0.01"></td>
                    <td><input type="number" class="form-control form-control-sm" name="variance" step="0.01" readonly></td>
                    <td><input type="number" class="form-control form-control-sm" name="variancePercentage" step="0.01" readonly></td>
                    <td><button type="button" class="btn btn-sm btn-danger removeStockTakeRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            const stockTakeBody = document.getElementById('stockTakeTableBody');
            if (stockTakeBody) {
                stockTakeBody.insertAdjacentHTML('beforeend', newRow);
            } else if (typeof $ !== 'undefined') {
                $('#stockTakeTableBody').append(newRow);
            }
        },
        
        calculateRowVariance: function (row) {
            // Support both jQuery object and native DOM element
            const rowEl = row && row.jquery ? row[0] : (row || null);
            if (!rowEl) return;
            
            const systemQtyInput = rowEl.querySelector('input[name="systemQuantity"]');
            const physicalQtyInput = rowEl.querySelector('input[name="physicalQuantity"]');
            const varianceInput = rowEl.querySelector('input[name="variance"]');
            const variancePctInput = rowEl.querySelector('input[name="variancePercentage"]');
            
            if (!systemQtyInput || !physicalQtyInput || !varianceInput || !variancePctInput) return;
            
            const systemQty = parseFloat(systemQtyInput.value) || 0;
            const physicalQty = parseFloat(physicalQtyInput.value) || 0;
            const variance = physicalQty - systemQty;
            const variancePercentage = systemQty > 0 ? (variance / systemQty) * 100 : 0;
            
            varianceInput.value = variance.toFixed(2);
            variancePctInput.value = variancePercentage.toFixed(2);
            
            // Color code variance
            if (Math.abs(variancePercentage) > 5) {
                rowEl.classList.add('table-warning');
            } else {
                rowEl.classList.remove('table-warning');
            }
        },
        
        calculateStockTakeVariance: function () {
            let totalItems = 0;
            let itemsWithVariance = 0;
            let totalSystemValue = 0;
            let totalPhysicalValue = 0;
            
            const stockTakeBody = document.getElementById('stockTakeTableBody');
            if (stockTakeBody) {
                const rows = stockTakeBody.querySelectorAll('tr');
                rows.forEach(row => {
                    const systemQtyInput = row.querySelector('input[name="systemQuantity"]');
                    const physicalQtyInput = row.querySelector('input[name="physicalQuantity"]');
                    
                    const systemQty = systemQtyInput ? parseFloat(systemQtyInput.value) || 0 : 0;
                    const physicalQty = physicalQtyInput ? parseFloat(physicalQtyInput.value) || 0 : 0;
                    
                    if (systemQty > 0 || physicalQty > 0) {
                        totalItems++;
                        totalSystemValue += systemQty;
                        totalPhysicalValue += physicalQty;
                        
                        if (Math.abs(systemQty - physicalQty) > 0.01) {
                            itemsWithVariance++;
                        }
                    }
                });
            }
            
            const totalItemsEl = document.getElementById('totalItemsCounted');
            const itemsWithVarianceEl = document.getElementById('itemsWithVariance');
            const totalSystemValueEl = document.getElementById('totalSystemValue');
            const totalPhysicalValueEl = document.getElementById('totalPhysicalValue');
            
            if (totalItemsEl) totalItemsEl.value = totalItems;
            if (itemsWithVarianceEl) itemsWithVarianceEl.value = itemsWithVariance;
            if (totalSystemValueEl) totalSystemValueEl.value = totalSystemValue.toFixed(2);
            if (totalPhysicalValueEl) totalPhysicalValueEl.value = totalPhysicalValue.toFixed(2);
        },
        
        saveStockTake: async function () {
            try {
                const form = $('#stockTakeForm')[0];
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                
                // Collect stock take items - use native DOM
                const stockTakeItems = [];
                const stockTakeBody = document.getElementById('stockTakeTableBody');
                if (stockTakeBody) {
                    const rows = stockTakeBody.querySelectorAll('tr');
                    rows.forEach(row => {
                        const stockNumberInput = row.querySelector('input[name="stockNumber"]');
                        const descriptionInput = row.querySelector('input[name="description"]');
                        const unitOfMeasureInput = row.querySelector('input[name="unitOfMeasure"]');
                        const binLocationInput = row.querySelector('input[name="binLocation"]');
                        const systemQtyInput = row.querySelector('input[name="systemQuantity"]');
                        const physicalQtyInput = row.querySelector('input[name="physicalQuantity"]');
                        const varianceInput = row.querySelector('input[name="variance"]');
                        const variancePctInput = row.querySelector('input[name="variancePercentage"]');
                        
                        const stockNumber = stockNumberInput ? stockNumberInput.value : '';
                        const description = descriptionInput ? descriptionInput.value : '';
                        
                        if (stockNumber || description) {
                            stockTakeItems.push({
                                stock_number: stockNumber || null,
                                description: description || null,
                                unit_of_measure: unitOfMeasureInput ? unitOfMeasureInput.value : null,
                                bin_location: binLocationInput ? binLocationInput.value : null,
                                system_quantity: systemQtyInput ? parseFloat(systemQtyInput.value) || 0 : 0,
                                physical_quantity: physicalQtyInput ? parseFloat(physicalQtyInput.value) || 0 : 0,
                                variance_quantity: varianceInput ? parseFloat(varianceInput.value) || 0 : 0,
                                variance_percentage: variancePctInput ? parseFloat(variancePctInput.value) || 0 : 0
                            });
                        }
                    });
                }
                
                const getValue = (id) => {
                    const el = document.getElementById(id);
                    return el ? el.value : null;
                };
                
                const stockTakeData = {
                    p_stock_take_date: getValue('stockTakeDate'),
                    p_location: getValue('stockTakeLocation') || null,
                    p_stock_take_type: getValue('stockTakeType') || 'full',
                    p_notes: getValue('stockTakeNotes') || null,
                    p_stock_take_items: stockTakeItems.length > 0 ? JSON.stringify(stockTakeItems) : null
                };
                
                const result = await dataFunctions.createStockTake(stockTakeData);
                
                if (result && result.success !== false) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: 'Stock take saved successfully',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    // Close modal using our close function
                    this.closeStockTakeModal();
                } else {
                    throw new Error(result?.error || result?.message || 'Failed to save stock take');
                }
            } catch (error) {
                console.error('Error saving stock take:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to save stock take: ' + error.message
                });
            }
        },
        
        completeStockTake: async function () {
            try {
                await this.saveStockTake();
                // Additional completion logic can be added here
            } catch (error) {
                console.error('Error completing stock take:', error);
            }
        },
        
        exportStock: function () {
            if (!this.stockItems || this.stockItems.length === 0) {
                Swal.fire('Info', 'No stock items to export', 'info');
                return;
            }
            
            const columns = [
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
                exportUtils.exportToCSV(this.stockItems, 'stock_items', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();
const stockManagementGrid = _stockManagementGrid;
function initializeStockManagementGrid() {
    console.log('[Stock Management] Initializing module...');
    if (typeof stockManagementGrid !== 'undefined') {
        // Wait for DOM to be fully ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(() => stockManagementGrid.init(), 100);
            });
        } else {
            setTimeout(() => stockManagementGrid.init(), 100);
        }
    } else {
        console.error('[Stock Management] stockManagementGrid object not defined!');
    }
}

