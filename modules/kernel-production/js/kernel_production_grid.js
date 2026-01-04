/**
 * Kernel Production Grid Module
 * Handles 17-step production workflow
 */
var _kernelProductionGrid = function () {
    return {
        batches: [],
        filteredBatches: [],
        searchTimeout: null,
        init: function () {
            this.setupEventListeners();
            this.loadBatches();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#addBatchBtn').on('click', function () {
                Swal.fire('Info', 'New batch creation coming soon', 'info');
            });
            
            // Search with debouncing
            $('#searchBatchesInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterBatches();
                }, 300);
            });
            
            // Filters
            $('#filterBatchStatus, #filterBatchStep').on('change', function () {
                scope.filterBatches();
            });
            
            // Clear filters
            $('#clearBatchFiltersBtn').on('click', function () {
                $('#searchBatchesInput').val('');
                $('#filterBatchStatus').val('');
                $('#filterBatchStep').val('');
                scope.filterBatches();
            });
        },
        filterBatches: function () {
            const searchTerm = $('#searchBatchesInput').val().toLowerCase();
            const statusFilter = $('#filterBatchStatus').val();
            const stepFilter = $('#filterBatchStep').val();
            
            this.filteredBatches = this.batches.filter(batch => {
                // Search filter
                const matchesSearch = !searchTerm || 
                    (batch.batch_number && batch.batch_number.toLowerCase().includes(searchTerm)) ||
                    (batch.grower_name && batch.grower_name.toLowerCase().includes(searchTerm)) ||
                    (batch.status && batch.status.toLowerCase().includes(searchTerm));
                
                // Status filter
                const matchesStatus = !statusFilter || batch.status === statusFilter;
                
                // Step filter
                let matchesStep = true;
                if (stepFilter) {
                    const currentStep = batch.current_step || 1;
                    if (stepFilter === '1-5') matchesStep = currentStep >= 1 && currentStep <= 5;
                    else if (stepFilter === '6-10') matchesStep = currentStep >= 6 && currentStep <= 10;
                    else if (stepFilter === '11-15') matchesStep = currentStep >= 11 && currentStep <= 15;
                    else if (stepFilter === '16-17') matchesStep = currentStep >= 16 && currentStep <= 17;
                }
                
                return matchesSearch && matchesStatus && matchesStep;
            });
            
            this.renderBatches();
        },
        loadBatches: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                const batches = await dataFunctions.getProductionBatches(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Production batches loaded in ${loadTime.toFixed(2)}ms`);
                
                this.batches = batches || [];
                this.filteredBatches = this.batches;
                this.renderBatches();
            } catch (error) {
                console.error('Error loading batches:', error);
            }
        },
        renderBatches: function () {
            const tbody = $('#batchesTableBody');
            tbody.empty();
            if (this.filteredBatches.length === 0) {
                if (this.batches.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No production batches found. Click "New Production Batch" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            this.filteredBatches.forEach(batch => {
                const row = `<tr>
                    <td>${batch.batch_number || 'N/A'}</td>
                    <td>${batch.grower_name || 'N/A'}</td>
                    <td>${batch.received_date || 'N/A'}</td>
                    <td>${batch.wet_nis_received_kg || '0'}</td>
                    <td>${batch.current_step || '1'}/17</td>
                    <td><span class="badge bg-info">${batch.status || 'receiving'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="kernelProductionGrid.viewBatch('${batch.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        viewBatch: function (batchId) {
            Swal.fire('Info', 'Batch details view coming soon', 'info');
        },
        
        exportBatches: function () {
            if (!this.batches || this.batches.length === 0) {
                Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            
            const columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'grower_name', label: 'Supplier' },
                { key: 'received_date', label: 'Received Date' },
                { key: 'wet_nis_received_kg', label: 'Wet NIS (kg)' },
                { key: 'current_step', label: 'Current Step' },
                { key: 'status', label: 'Status' }
            ];
            
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(this.batches, 'production_batches', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();
const kernelProductionGrid = _kernelProductionGrid;
function initializeKernelProductionGrid() {
    if (typeof kernelProductionGrid !== 'undefined') {
        kernelProductionGrid.init();
    }
}

