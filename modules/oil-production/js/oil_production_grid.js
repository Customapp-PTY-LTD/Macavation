/**
 * Oil Production Grid Module
 */
var _oilProductionGrid = function () {
    return {
        batches: [],
        init: function () {
            this.setupEventListeners();
            this.loadBatches();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#addOilBatchBtn').on('click', function () {
                Swal.fire('Info', 'New oil production batch form coming soon', 'info');
            });
        },
        loadBatches: async function () {
            try {
                const batches = await dataFunctions.getOilProductionBatches().catch(() => []);
                this.batches = batches || [];
                this.renderBatches();
            } catch (error) {
                console.error('Error loading oil batches:', error);
                this.showError('Unable to load oil production batches. Please try again later.');
            }
        },
        renderBatches: function () {
            const tbody = $('#oilBatchesTableBody');
            tbody.empty();
            if (this.batches.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No oil production batches found. Click "New Oil Production Batch" to create one.</td></tr>');
                return;
            }
            this.batches.forEach(batch => {
                const row = `<tr>
                    <td>${batch.batch_number || 'N/A'}</td>
                    <td>${batch.input_material || 'N/A'}</td>
                    <td>${batch.input_quantity_kg || '0'}</td>
                    <td>${batch.oil_produced_l || '0'}</td>
                    <td><span class="badge bg-info">${batch.status || 'pending'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="oilProductionGrid.viewBatch('${batch.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        viewBatch: function (batchId) {
            Swal.fire('Info', 'Oil batch details view is under development', 'info');
        },
        showError: function (message) {
            Swal.fire({ icon: 'error', title: 'Error', text: message });
        },
        exportBatches: function () {
            if (!this.batches || this.batches.length === 0) {
                Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            
            const columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'input_material', label: 'Input Material' },
                { key: 'input_quantity_kg', label: 'Input Quantity (kg)' },
                { key: 'oil_produced_l', label: 'Oil Produced (L)' },
                { key: 'status', label: 'Status' }
            ];
            
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(this.batches, 'oil_production_batches', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();
const oilProductionGrid = _oilProductionGrid;
function initializeOilProductionGrid() {
    if (typeof oilProductionGrid !== 'undefined') {
        oilProductionGrid.init();
    }
}

