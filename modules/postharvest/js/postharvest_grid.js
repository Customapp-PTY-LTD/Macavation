// Post-Harvest Module JavaScript
let postharvestData = {
    consignments: []
};

async function initializePostharvestGrid() {
    try {
        console.log('Post-Harvest Grid initialized');
        
        // Wait for dataFunctions to be available
        if (typeof waitForDataFunctions === 'function') {
            try {
                await waitForDataFunctions(50, 100);
            } catch (error) {
                console.error('dataFunctions not available:', error);
                throw new Error('Data functions not available');
            }
        } else if (typeof dataFunctions === 'undefined') {
            await new Promise(resolve => setTimeout(resolve, 500));
            if (typeof dataFunctions === 'undefined') {
                throw new Error('dataFunctions is not available');
            }
        }
        
        // Check if utility functions are available
        if (typeof populateFarmSelector === 'undefined') {
            console.error('populateFarmSelector is not defined. Make sure farm-selector-utils.js is loaded.');
            return;
        }
        
        // Load and populate farm, block, and variety selectors
        try {
            await populateFarmSelector('farmFilter', localStorage.getItem('selectedFarmId') || 'all', true);
            await populateBlockSelector('blockFilter', null, null, true);
            if (typeof populateVarietySelector === 'function') {
                await populateVarietySelector('varietyFilter', null, true);
            }
            
            // Setup farm selector to update block selector when changed
            if (typeof setupFarmSelectorWithBlocks === 'function') {
                setupFarmSelectorWithBlocks('farmFilter', 'blockFilter', (farmId) => {
                    // Reload data when farm changes
                    loadConsignments().catch(err => {
                        console.error('Error reloading consignments:', err);
                    }).then(() => {
                        updatePostharvestSummaryCards();
                    });
                });
            }
        } catch (error) {
            console.error('Error setting up selectors:', error);
        }
        
        await loadConsignments();
        updatePostharvestSummaryCards();
    } catch (error) {
        console.error('Error initializing Post-Harvest Grid:', error);
    }
}

/**
 * Update summary cards with calculated values
 */
function updatePostharvestSummaryCards() {
    try {
        // Estimate returns based on consignments
        // Simplified: assume average price per carton
        const avgPricePerCarton = 50; // R50 per carton (rough estimate)
        
        const estimatedReturns = postharvestData.consignments.reduce((sum, consignment) => {
            const cartons = parseFloat(consignment.total_cartons) || 0;
            return sum + (cartons * avgPricePerCarton);
        }, 0);
        
        // Update DOM element
        const returnsEl = document.querySelector('#estimatedReturns');
        if (returnsEl) {
            if (estimatedReturns >= 1000000) {
                returnsEl.textContent = 'R' + (estimatedReturns / 1000000).toFixed(1) + 'M';
            } else {
                returnsEl.textContent = 'R' + estimatedReturns.toLocaleString('en-ZA', {minimumFractionDigits: 0, maximumFractionDigits: 0});
            }
        }
    } catch (error) {
        console.error('Error updating postharvest summary cards:', error);
    }
}

async function loadConsignments() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getConsignments) {
            console.error('dataFunctions.getConsignments is not available');
            postharvestData.consignments = [];
            renderConsignments();
            return;
        }
        
        const farmId = localStorage.getItem('selectedFarmId') || 'all';
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        const consignments = await dataFunctions.getConsignments(filters);
        if (consignments && Array.isArray(consignments)) {
            postharvestData.consignments = consignments;
        } else {
            postharvestData.consignments = [];
        }
        renderConsignments();
        updatePostharvestSummaryCards();
    } catch (error) {
        console.error('Error loading consignments:', error);
        updatePostharvestSummaryCards();
    }
}

function renderConsignments() {
    const container = document.getElementById('consignmentsList');
    if (!container) return;
    
    if (postharvestData.consignments.length === 0) {
        container.innerHTML = '<p class="text-muted">No consignments found</p>';
        return;
    }
    
    container.innerHTML = postharvestData.consignments.map(consignment => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title">Consignment ${consignment.consignment_number || 'N/A'}</h5>
                        <p class="card-text mb-2">
                            <strong>Harvest Date:</strong> ${new Date(consignment.harvest_date).toLocaleDateString()}<br>
                            <strong>Pack Date:</strong> ${consignment.pack_date ? new Date(consignment.pack_date).toLocaleDateString() : 'N/A'}<br>
                            <strong>Total Pallets:</strong> ${consignment.total_pallets || 'N/A'}<br>
                            <strong>Total Cartons:</strong> ${consignment.total_cartons || 'N/A'}<br>
                            <strong>Market:</strong> ${consignment.market_destination || 'N/A'}
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editConsignment('${consignment.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteConsignment('${consignment.id}', '${consignment.consignment_number || 'Consignment'}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Edit consignment
 */
async function editConsignment(consignmentId) {
    const consignment = postharvestData.consignments.find(c => String(c.id) === String(consignmentId));
    if (!consignment) {
        showErrorMessage('Consignment not found');
        return;
    }
    
    // Populate block dropdown if needed
    const blockSelect = document.getElementById('editConsignmentBlock');
    if (blockSelect && typeof populateBlockSelector === 'function') {
        const farmId = localStorage.getItem('selectedFarmId');
        if (farmId && farmId !== 'all') {
            await populateBlockSelector('editConsignmentBlock', consignment.block_id, false);
        }
    }
    
    // Populate variety dropdown if needed
    const varietySelect = document.getElementById('editConsignmentVariety');
    if (varietySelect && typeof populateVarietySelector === 'function') {
        await populateVarietySelector('editConsignmentVariety', consignment.variety_id, false);
    }
    
    document.getElementById('editConsignmentId').value = consignment.id;
    document.getElementById('editConsignmentNumber').value = consignment.consignment_number || '';
    document.getElementById('editHarvestDate').value = consignment.harvest_date ? consignment.harvest_date.split('T')[0] : '';
    document.getElementById('editPackDate').value = consignment.pack_date ? consignment.pack_date.split('T')[0] : '';
    document.getElementById('editTotalPallets').value = consignment.total_pallets || '';
    document.getElementById('editTotalCartons').value = consignment.total_cartons || '';
    document.getElementById('editMarketDestination').value = consignment.market_destination || '';
    
    const modal = new bootstrap.Modal(document.getElementById('editConsignmentModal'));
    modal.show();
}

/**
 * Save consignment
 */
async function saveConsignment() {
    try {
        const consignmentId = document.getElementById('editConsignmentId').value;
        const farmId = localStorage.getItem('selectedFarmId');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a farm');
            return;
        }
        
        const consignmentData = {
            farm_id: farmId,
            consignment_number: document.getElementById('editConsignmentNumber').value,
            harvest_date: document.getElementById('editHarvestDate').value,
            block_id: document.getElementById('editConsignmentBlock')?.value || null,
            variety_id: document.getElementById('editConsignmentVariety')?.value || null,
            pack_date: document.getElementById('editPackDate').value || null,
            total_pallets: parseInt(document.getElementById('editTotalPallets').value) || null,
            total_cartons: parseInt(document.getElementById('editTotalCartons').value) || null,
            market_destination: document.getElementById('editMarketDestination').value || null
        };
        
        if (!consignmentData.consignment_number || !consignmentData.harvest_date) {
            showErrorMessage('Consignment Number and Harvest Date are required');
            return;
        }
        
        let result;
        if (consignmentId) {
            result = await dataFunctions.updateConsignment(consignmentId, consignmentData);
            showSuccessMessage('Consignment updated successfully');
        } else {
            result = await dataFunctions.createConsignment(consignmentData);
            showSuccessMessage('Consignment created successfully');
        }
        
        await loadConsignments();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editConsignmentModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving consignment:', error);
        showErrorMessage('Failed to save consignment: ' + error.message);
    }
}

/**
 * Delete consignment
 */
async function deleteConsignment(consignmentId, consignmentNumber) {
    if (!confirm(`Are you sure you want to delete consignment "${consignmentNumber}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteConsignment(consignmentId);
        showSuccessMessage('Consignment deleted successfully');
        await loadConsignments();
    } catch (error) {
        console.error('Error deleting consignment:', error);
        showErrorMessage('Failed to delete consignment: ' + error.message);
    }
}

/**
 * Show success/error messages
 */
function showSuccessMessage(message) {
    if (typeof _common !== 'undefined' && _common.showSuccessToast) {
        _common.showSuccessToast(message);
    } else {
        alert('Success: ' + message);
    }
}

function showErrorMessage(message) {
    if (typeof _common !== 'undefined' && _common.showErrorToast) {
        _common.showErrorToast(message);
    } else {
        alert('Error: ' + message);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializePostharvestGrid);
} else {
    initializePostharvestGrid();
}

