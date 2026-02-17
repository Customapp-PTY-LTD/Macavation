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
            
            // Use MutationObserver to wait for buttons to be added to DOM
            const checkAndInit = () => {
                const stockTakeBtn = document.getElementById('stockTakeBtn');
                if (stockTakeBtn) {
                    console.log('[Stock Management] Buttons found, setting up event listeners');
                    scope.setupEventListeners();
                    scope.loadStockItems();
                    // Oil stock ledger (only if section exists in DOM)
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
                stockTakeBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    console.log('[Stock Management] Stock Take button clicked (native)');
                    scope.showStockTakeModal();
                });
                
                if (typeof $ !== 'undefined') {
                    $('#stockTakeBtn').on('click', function(e) {
                        e.preventDefault();
                        console.log('[Stock Management] Stock Take button clicked (jQuery)');
                        scope.showStockTakeModal();
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
            
            const receivingBtn = document.getElementById('receivingChecklistBtn');
            if (receivingBtn) {
                receivingBtn.addEventListener('click', function() {
                    scope.showReceivingChecklistModal();
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
                $('#receivingChecklistBtn').on('click', function () {
                    scope.showReceivingChecklistModal();
                });
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
            
            // Close modal handlers - ensure modal can be closed
            const stockTakeModal = document.getElementById('stockTakeModal');
            if (stockTakeModal) {
                // Cancel button in footer
                const cancelBtn = stockTakeModal.querySelector('.modal-footer button[data-bs-dismiss="modal"]');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', function(e) {
                        console.log('[Stock Management] Cancel button clicked');
                        scope.closeStockTakeModal();
                    });
                }
                
                // Close button in header
                const closeBtn = stockTakeModal.querySelector('.btn-close');
                if (closeBtn) {
                    closeBtn.addEventListener('click', function(e) {
                        console.log('[Stock Management] Close button clicked');
                        scope.closeStockTakeModal();
                    });
                }
                
                // Also handle ESC key
                stockTakeModal.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape' || e.keyCode === 27) {
                        e.preventDefault();
                        scope.closeStockTakeModal();
                    }
                });
            }
            
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
                
                // Receiving checklist handlers
                $('#saveReceivingChecklistBtn').on('click', function () {
                    scope.saveReceivingChecklist();
                });
                $('#addReceivedItemRow').on('click', function () {
                    scope.addReceivedItemRow();
                });
                $(document).on('click', '.removeItemRow', function () {
                    $(this).closest('tr').remove();
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
                $('#receivingChecklistModal').on('hidden.bs.modal', function () {
                    scope.clearReceivingForm();
                });
                $('#rawMaterialIssuedModal').on('hidden.bs.modal', function () {
                    scope.clearRawMaterialIssuedForm();
                });
            }
            
            // Native modal cleanup handlers
            const receivingModal = document.getElementById('receivingChecklistModal');
            if (receivingModal) {
                receivingModal.addEventListener('hidden.bs.modal', function () {
                    scope.clearReceivingForm();
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
        
        showReceivingChecklistModal: async function () {
            $('#receivingChecklistModalLabel').text('Incoming Receiving Checklist');
            $('#receivingId').val('');
            this.clearReceivingForm();
            // Set default date to today
            const today = new Date().toISOString().split('T')[0];
            $('#dateReceived').val(today);
            
            // Load suppliers
            try {
                const contacts = await dataFunctions.getContacts();
                const select = $('#supplierDetails');
                let html = '<option value="">Select Supplier</option>';
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach(contact => {
                        const name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        html += `<option value="${contact.id}">${name}</option>`;
                    });
                }
                select.html(html);
            } catch (error) {
                console.error('Error loading suppliers:', error);
            }
            
            // Use Bootstrap 5 modal API
            const receivingModal = document.getElementById('receivingChecklistModal');
            if (receivingModal) {
                const modal = new bootstrap.Modal(receivingModal);
                modal.show();
            } else {
                console.error('Receiving checklist modal element not found!');
            }
        },
        
        clearReceivingForm: function () {
            $('#receivingChecklistForm')[0].reset();
            $('#receivingId').val('');
            // Clear received items rows except first
            $('#receivedItemsTableBody tr:not(:first)').remove();
            $('#receivedItemsTableBody tr:first input').val('');
            $('#receivedItemsTableBody tr:first input[name="cartonBags"]').val('1');
        },
        
        addReceivedItemRow: function () {
            const newRow = `
                <tr>
                    <td><input type="text" class="form-control form-control-sm" name="reference"></td>
                    <td><input type="text" class="form-control form-control-sm" name="description"></td>
                    <td><input type="text" class="form-control form-control-sm" name="batch"></td>
                    <td><input type="number" class="form-control form-control-sm" name="cartonBags" value="1"></td>
                    <td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01"></td>
                    <td><input type="date" class="form-control form-control-sm" name="manufacturedDate"></td>
                    <td><input type="date" class="form-control form-control-sm" name="bestBeforeDate"></td>
                    <td><button type="button" class="btn btn-sm btn-danger removeItemRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            $('#receivedItemsTableBody').append(newRow);
        },
        
        saveReceivingChecklist: async function () {
            try {
                const form = $('#receivingChecklistForm')[0];
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                
                // Collect received items
                const receivedItems = [];
                $('#receivedItemsTableBody tr').each(function () {
                    const reference = $(this).find('input[name="reference"]').val();
                    const description = $(this).find('input[name="description"]').val();
                    const batch = $(this).find('input[name="batch"]').val();
                    const cartonBags = $(this).find('input[name="cartonBags"]').val();
                    const quantity = $(this).find('input[name="quantity"]').val();
                    const manufacturedDate = $(this).find('input[name="manufacturedDate"]').val();
                    const bestBeforeDate = $(this).find('input[name="bestBeforeDate"]').val();
                    
                    if (reference || description || batch || quantity) {
                        receivedItems.push({
                            reference: reference || null,
                            description: description || null,
                            batch: batch || null,
                            carton_bags: cartonBags ? parseInt(cartonBags) : null,
                            quantity_kg: quantity ? parseFloat(quantity) : null,
                            manufactured_date: manufacturedDate || null,
                            best_before_date: bestBeforeDate || null
                        });
                    }
                });
                
                const receivingData = {
                    p_date_received: $('#dateReceived').val(),
                    p_delivery_note_ref: $('#deliveryNoteRef').val(),
                    p_supplier_id: $('#supplierDetails').val(),
                    p_vehicle_clean: $('input[name="vehicleClean"]:checked').val() || null,
                    p_vehicle_enclosed: $('input[name="vehicleEnclosed"]:checked').val() || null,
                    p_hazard_substances: $('input[name="hazardSubstances"]:checked').val() || null,
                    p_pest_infestations: $('input[name="pestInfestations"]:checked').val() || null,
                    p_pallets_condition: $('input[name="palletsCondition"]:checked').val() || null,
                    p_raw_materials_condition: $('input[name="rawMaterialsCondition"]:checked').val() || null,
                    p_comments: $('#receivingComments').val() || null,
                    p_received_items: JSON.stringify(receivedItems)
                };
                
                const receivingId = $('#receivingId').val();
                let result;
                
                if (receivingId) {
                    result = await dataFunctions.callFunction('update_receiving_checklist', {
                        p_receiving_id: receivingId,
                        ...receivingData
                    });
                } else {
                    result = await dataFunctions.callFunction('create_receiving_checklist', receivingData);
                }
                
                if (result && result.success !== false) {
                    // Invalidate caches
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('receiving_checklists');
                        dataFunctions.clearCachePattern('stock_items');
                    }
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: receivingId ? 'Receiving checklist updated successfully' : 'Receiving checklist created successfully',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    const receivingModal = document.getElementById('receivingChecklistModal');
                    if (receivingModal) {
                        const modal = bootstrap.Modal.getInstance(receivingModal);
                        if (modal) modal.hide();
                    }
                    this.loadStockItems(true); // Force refresh
                } else {
                    throw new Error(result?.error || result?.message || 'Failed to save receiving checklist');
                }
            } catch (error) {
                console.error('Error saving receiving checklist:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to save receiving checklist: ' + error.message
                });
            }
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
            console.log('[Stock Management] Closing stock take modal');
            const modalElement = document.getElementById('stockTakeModal');
            if (!modalElement) {
                console.warn('[Stock Management] Modal element not found');
                return;
            }

            // Move focus out of the modal before hiding to avoid aria-hidden on focused element (a11y)
            const triggerBtn = document.getElementById('stockTakeBtn');
            if (triggerBtn) {
                triggerBtn.focus();
            } else if (document.activeElement && modalElement.contains(document.activeElement)) {
                document.activeElement.blur();
            }

            try {
                // Try Bootstrap 5 first
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    const modal = bootstrap.Modal.getOrCreateInstance(modalElement);
                    modal.hide();
                    console.log('[Stock Management] Modal closed via Bootstrap 5');
                }
                
                // Try jQuery
                if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#stockTakeModal').modal('hide');
                    console.log('[Stock Management] Modal closed via jQuery');
                }
                
                // If the modal is still visible after Bootstrap/jQuery attempts, force close.
                setTimeout(() => {
                    const stillShown = modalElement.classList.contains('show') || modalElement.style.display === 'block';
                    if (stillShown) {
                        console.warn('[Stock Management] Modal still visible after hide(); forcing close');
                        this.hardForceCloseStockTakeModal();
                    }
                }, 50);
            } catch (error) {
                console.error('[Stock Management] Error closing modal:', error);
                this.hardForceCloseStockTakeModal();
            }
        },

        hardForceCloseStockTakeModal: function () {
            const modalElement = document.getElementById('stockTakeModal');
            if (!modalElement) return;

            try {
                // Move focus out of modal before setting aria-hidden (avoids a11y violation)
                const triggerBtn = document.getElementById('stockTakeBtn');
                if (triggerBtn) {
                    triggerBtn.focus();
                } else if (document.activeElement && modalElement.contains(document.activeElement)) {
                    document.activeElement.blur();
                }

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

