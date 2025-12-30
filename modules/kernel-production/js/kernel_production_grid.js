/**
 * Kernel Production Grid Module
 * Handles 17-step production workflow
 */
var _kernelProductionGrid = function () {
    return {
        batches: [],
        init: function () {
            this.setupEventListeners();
            this.loadBatches();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#addBatchBtn').on('click', function () {
                Swal.fire('Info', 'New batch creation coming soon', 'info');
            });
        },
        loadBatches: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                const batches = await dataFunctions.getProductionBatches(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Production batches loaded in ${loadTime.toFixed(2)}ms`);
                
                this.batches = batches || [];
                this.renderBatches();
            } catch (error) {
                console.error('Error loading batches:', error);
            }
        },
        renderBatches: function () {
            const tbody = $('#batchesTableBody');
            tbody.empty();
            if (this.batches.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center text-muted">No production batches found</td></tr>');
                return;
            }
            this.batches.forEach(batch => {
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
        }
    };
}();
const kernelProductionGrid = _kernelProductionGrid;
function initializeKernelProductionGrid() {
    if (typeof kernelProductionGrid !== 'undefined') {
        kernelProductionGrid.init();
    }
}

