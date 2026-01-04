/**
 * Stock Management Grid Module
 */
var _stockManagementGrid = function () {
    return {
        stockItems: [],
        filteredStockItems: [],
        searchTimeout: null,
        init: function () {
            this.setupEventListeners();
            this.loadStockItems();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#addStockBtn').on('click', function () {
                Swal.fire('Info', 'New stock item form coming soon', 'info');
            });
            $('#stockTakeBtn').on('click', function () {
                Swal.fire('Info', 'Stock take feature coming soon', 'info');
            });
            
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
                const startTime = performance.now();
                const items = await dataFunctions.getStockItems(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Stock items loaded in ${loadTime.toFixed(2)}ms`);
                
                this.stockItems = items || [];
                this.filteredStockItems = this.stockItems;
                this.renderStockItems();
            } catch (error) {
                console.error('Error loading stock items:', error);
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
    if (typeof stockManagementGrid !== 'undefined') {
        stockManagementGrid.init();
    }
}

