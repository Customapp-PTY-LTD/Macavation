/**
 * Stock Management Grid Module
 */
var _stockManagementGrid = function () {
    return {
        stockItems: [],
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
        },
        loadStockItems: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                const items = await dataFunctions.getStockItems(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Stock items loaded in ${loadTime.toFixed(2)}ms`);
                
                this.stockItems = items || [];
                this.renderStockItems();
            } catch (error) {
                console.error('Error loading stock items:', error);
            }
        },
        renderStockItems: function () {
            const tbody = $('#stockTableBody');
            tbody.empty();
            if (this.stockItems.length === 0) {
                tbody.html('<tr><td colspan="8" class="text-center text-muted">No stock items found</td></tr>');
                return;
            }
            this.stockItems.forEach(item => {
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

