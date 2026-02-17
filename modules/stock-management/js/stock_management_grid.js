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
        searchTimeout: null,
        init: function () {
            console.log('[Stock Management] Initializing grid...');
            const scope = this;

            const checkAndInit = async () => {
                const stockTakeBtn = document.getElementById('stockTakeBtn');
                if (!stockTakeBtn) {
                    console.log('[Stock Management] Buttons not found yet, retrying...');
                    setTimeout(checkAndInit, 100);
                    return;
                }
                console.log('[Stock Management] Buttons found, loading modal content...');
                const modalContainers = document.querySelectorAll('.modal[route-name]');
                const loadPromises = [];
                modalContainers.forEach(function (el) {
                    const routeName = el.getAttribute('route-name');
                    if (routeName && el.id && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                        loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + el.id }));
                    }
                });
                try {
                    if (loadPromises.length) await Promise.all(loadPromises);
                } catch (e) {
                    console.warn('[Stock Management] One or more modal loads failed:', e);
                }
                scope.setupEventListeners();
                scope.loadStockItems();
                if (document.getElementById('oilLotsTableBody')) scope.loadOilLotsAndSummary();
            };

            setTimeout(checkAndInit, 50);
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
                $('#receivingChecklistBtn').off('click');
                $('#rawMaterialIssuedBtn').off('click');
                $('#stockTakeBtn').off('click');
            }
            
            // Use both native and jQuery event listeners
            if (stockTakeBtn) {
                stockTakeBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (typeof _modal_stock_stock_take !== 'undefined' && _modal_stock_stock_take.show) _modal_stock_stock_take.show();
                });
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
            
            const receivingBtn = document.getElementById('receivingChecklistBtn');
            if (receivingBtn) {
                receivingBtn.addEventListener('click', function () {
                    if (typeof _modal_stock_receiving_checklist !== 'undefined' && _modal_stock_receiving_checklist.show) _modal_stock_receiving_checklist.show();
                });
            }

            const rawMaterialBtn = document.getElementById('rawMaterialIssuedBtn');
            if (rawMaterialBtn) {
                rawMaterialBtn.addEventListener('click', function () {
                    if (typeof _modal_stock_raw_material_issued !== 'undefined' && _modal_stock_raw_material_issued.show) _modal_stock_raw_material_issued.show();
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
                    if (typeof _modal_stock_oil_lot !== 'undefined' && _modal_stock_oil_lot.show) _modal_stock_oil_lot.show();
                });
            }
            const importOilLotsBtn = document.getElementById('importOilLotsBtn');
            if (importOilLotsBtn) {
                importOilLotsBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    if (typeof _modal_stock_import_oil_lots !== 'undefined' && _modal_stock_import_oil_lots.show) _modal_stock_import_oil_lots.show();
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
        },
        filterStockItems: function () {
            const searchTerm = $('#searchStockInput').val().toLowerCase();
            const statusFilter = $('#filterStockStatus').val();
            const productFilter = $('#filterStockProduct').val();
            const locationFilter = $('#filterStockLocation').val();
            
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
                
                return matchesSearch && matchesStatus && matchesProduct && matchesLocation;
            });
            
            this.renderStockItems();
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

        editOilLot: function (lotId) {
            const lot = (this.oilLots || []).find(function (x) { return x.id === lotId; });
            if (!lot) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire('Error', 'Oil lot not found in current list. Try refreshing.', 'error');
                return;
            }
            if (typeof _modal_stock_oil_lot !== 'undefined' && _modal_stock_oil_lot.show) _modal_stock_oil_lot.show(lot);
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

