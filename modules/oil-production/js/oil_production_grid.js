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
                const batches = await dataFunctions.callFunction('get_oil_production_batches', {});
                this.batches = batches || [];
                this.renderBatches();
            } catch (error) {
                console.error('Error loading oil batches:', error);
            }
        },
        renderBatches: function () {
            const tbody = $('#oilBatchesTableBody');
            tbody.empty();
            if (this.batches.length === 0) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted">No oil production batches found</td></tr>');
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
            Swal.fire('Info', 'Oil batch details coming soon', 'info');
        }
    };
}();
const oilProductionGrid = _oilProductionGrid;
function initializeOilProductionGrid() {
    if (typeof oilProductionGrid !== 'undefined') {
        oilProductionGrid.init();
    }
}

