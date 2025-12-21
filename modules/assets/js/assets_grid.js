// Assets Module JavaScript
let assetsData = {
    vehicles: [],
    fuelTransactions: []
};

async function initializeAssetsGrid() {
    try {
        console.log('Assets Grid initialized');
        
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
        
        // Load and populate farm selector
        try {
            await populateFarmSelector('farmFilter', localStorage.getItem('selectedFarmId') || 'all', true);
            
            // Setup farm selector change handler
            const farmSelector = document.getElementById('farmFilter');
            if (farmSelector) {
                farmSelector.addEventListener('change', () => {
                    Promise.all([
                        loadVehicles().catch(err => console.error('Error loading vehicles:', err)),
                        loadFuelTransactions().catch(err => console.error('Error loading transactions:', err))
                    ]).then(() => {
                        updateAssetsSummaryCards();
                    });
                });
            }
        } catch (error) {
            console.error('Error setting up farm selector:', error);
        }
        
        await loadVehicles();
        await loadFuelTransactions();
        updateAssetsSummaryCards();
    } catch (error) {
        console.error('Error initializing Assets Grid:', error);
    }
}

/**
 * Update summary cards with calculated values
 */
function updateAssetsSummaryCards() {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // Calculate fuel cost and litres this month
        const monthlyTransactions = assetsData.fuelTransactions.filter(trans => {
            const transDate = new Date(trans.transaction_date);
            return transDate >= startOfMonth;
        });
        
        const monthlyFuelCost = monthlyTransactions.reduce((sum, trans) => sum + (parseFloat(trans.cost) || 0), 0);
        const monthlyLitres = monthlyTransactions.reduce((sum, trans) => sum + (parseFloat(trans.litres) || 0), 0);
        
        // Count vehicles needing service (simplified: vehicles with high odometer or status issues)
        const serviceDue = assetsData.vehicles.filter(v => {
            return v.status === 'maintenance_required' || 
                   (parseFloat(v.current_odometer) || 0) > 50000;
        }).length;
        
        // Calculate equipment value (simplified: sum of vehicle values if available, or count * average)
        const equipmentValue = assetsData.vehicles.length * 50000; // Rough estimate
        
        // Update DOM elements
        const fuelCostEl = document.querySelector('#fuelCostThisMonth');
        if (fuelCostEl) {
            fuelCostEl.textContent = 'R' + monthlyFuelCost.toLocaleString('en-ZA', {minimumFractionDigits: 0, maximumFractionDigits: 0});
        }
        
        const litresConsumedEl = document.querySelector('#litresConsumedThisMonth');
        if (litresConsumedEl) {
            litresConsumedEl.textContent = monthlyLitres.toLocaleString('en-ZA', {maximumFractionDigits: 0}) + ' litres consumed';
        }
        
        const serviceDueEl = document.querySelector('#serviceDueCount');
        if (serviceDueEl) {
            serviceDueEl.textContent = serviceDue.toString();
        }
        
        const equipmentValueEl = document.querySelector('#equipmentValue');
        if (equipmentValueEl) {
            equipmentValueEl.textContent = 'R' + equipmentValue.toLocaleString('en-ZA', {minimumFractionDigits: 0, maximumFractionDigits: 0});
        }
    } catch (error) {
        console.error('Error updating assets summary cards:', error);
    }
}

async function loadVehicles() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getVehicles) {
            console.error('dataFunctions.getVehicles is not available');
            assetsData.vehicles = [];
            renderVehicles();
            return;
        }
        
        const farmId = localStorage.getItem('selectedFarmId') || 'all';
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        const vehicles = await dataFunctions.getVehicles(filters);
        if (vehicles && Array.isArray(vehicles)) {
            assetsData.vehicles = vehicles;
        } else {
            assetsData.vehicles = [];
        }
        renderVehicles();
        updateAssetsSummaryCards();
    } catch (error) {
        console.error('Error loading vehicles:', error);
        assetsData.vehicles = [];
        renderVehicles();
        updateAssetsSummaryCards();
    }
}

async function loadFuelTransactions() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getFuelTransactions) {
            console.error('dataFunctions.getFuelTransactions is not available');
            assetsData.fuelTransactions = [];
            renderFuelTransactions();
            return;
        }
        
        const farmId = localStorage.getItem('selectedFarmId') || 'all';
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        const transactions = await dataFunctions.getFuelTransactions(filters);
        if (transactions && Array.isArray(transactions)) {
            assetsData.fuelTransactions = transactions;
        } else {
            assetsData.fuelTransactions = [];
        }
        renderFuelTransactions();
        updateAssetsSummaryCards();
    } catch (error) {
        console.error('Error loading fuel transactions:', error);
        assetsData.fuelTransactions = [];
        renderFuelTransactions();
        updateAssetsSummaryCards();
    }
}

function renderVehicles() {
    const container = document.getElementById('vehiclesList');
    if (!container) return;
    
    if (assetsData.vehicles.length === 0) {
        container.innerHTML = '<p class="text-muted">No vehicles found</p>';
        return;
    }
    
    container.innerHTML = assetsData.vehicles.map(vehicle => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title">${vehicle.make || ''} ${vehicle.model || ''}</h5>
                        <p class="card-text mb-2">
                            <strong>Registration:</strong> ${vehicle.registration_number}<br>
                            <strong>Type:</strong> ${vehicle.vehicle_type || 'N/A'}<br>
                            <strong>Year:</strong> ${vehicle.year || 'N/A'}<br>
                            <strong>Odometer:</strong> ${vehicle.current_odometer || 'N/A'} km<br>
                            <strong>Status:</strong> ${vehicle.status || 'N/A'}
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editVehicle('${vehicle.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteVehicle('${vehicle.id}', '${vehicle.registration_number}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderFuelTransactions() {
    const container = document.getElementById('fuelTransactionsList');
    if (!container) return;
    
    if (assetsData.fuelTransactions.length === 0) {
        container.innerHTML = '<p class="text-muted">No fuel transactions found</p>';
        return;
    }
    
    container.innerHTML = assetsData.fuelTransactions.map(trans => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title">Transaction - ${new Date(trans.transaction_date).toLocaleDateString()}</h5>
                        <p class="card-text mb-2">
                            <strong>Vehicle:</strong> ${trans.vehicle_registration || trans.registration_number || 'N/A'}<br>
                            <strong>Litres:</strong> ${trans.litres || 'N/A'}<br>
                            <strong>Cost:</strong> R${trans.cost || '0.00'}<br>
                            <strong>Price per Litre:</strong> R${trans.price_per_litre || '0.00'}
                            ${trans.odometer_reading ? `<br><strong>Odometer:</strong> ${trans.odometer_reading} km` : ''}
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editFuelTransaction('${trans.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteFuelTransaction('${trans.id}', '${new Date(trans.transaction_date).toLocaleDateString()}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Populate vehicle dropdown for transaction modal
 */
async function populateVehicleDropdown(selectId, selectedVehicleId = null) {
    const vehicleSelect = document.getElementById(selectId);
    if (!vehicleSelect) return;
    
    // Always repopulate to ensure fresh data
    const farmId = localStorage.getItem('selectedFarmId');
    const filters = farmId && farmId !== 'all' ? { farmId: farmId } : {};
    const vehicles = await dataFunctions.getVehicles(filters);
    
    vehicleSelect.innerHTML = '<option value="">Select vehicle</option>';
    if (vehicles && Array.isArray(vehicles)) {
        vehicles.forEach(vehicle => {
            const option = document.createElement('option');
            option.value = vehicle.id;
            option.textContent = `${vehicle.registration_number}${vehicle.make ? ' - ' + vehicle.make : ''}${vehicle.model ? ' ' + vehicle.model : ''}`.trim();
            vehicleSelect.appendChild(option);
        });
        
        if (selectedVehicleId) {
            vehicleSelect.value = selectedVehicleId;
        }
    }
}

/**
 * Edit fuel transaction
 */
async function editFuelTransaction(transactionId) {
    const transaction = assetsData.fuelTransactions.find(t => String(t.id) === String(transactionId));
    if (!transaction) {
        showErrorMessage('Fuel transaction not found');
        return;
    }
    
    // Populate vehicle dropdown
    await populateVehicleDropdown('editTransactionVehicle', transaction.vehicle_id);
    
    document.getElementById('editTransactionId').value = transaction.id;
    document.getElementById('editTransactionDate').value = transaction.transaction_date ? transaction.transaction_date.split('T')[0] : '';
    document.getElementById('editTransactionVehicle').value = transaction.vehicle_id || '';
    document.getElementById('editTransactionLitres').value = transaction.litres || '';
    document.getElementById('editTransactionCost').value = transaction.cost || '';
    document.getElementById('editTransactionPricePerLitre').value = transaction.price_per_litre || '';
    document.getElementById('editTransactionOdometer').value = transaction.odometer_reading || '';
    
    const modal = new bootstrap.Modal(document.getElementById('editTransactionModal'));
    modal.show();
}

/**
 * Add new fuel transaction (populate vehicle dropdown)
 */
async function addFuelTransaction() {
    document.getElementById('editTransactionId').value = '';
    document.getElementById('editTransactionDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('editTransactionVehicle').value = '';
    document.getElementById('editTransactionLitres').value = '';
    document.getElementById('editTransactionCost').value = '';
    document.getElementById('editTransactionPricePerLitre').value = '';
    document.getElementById('editTransactionOdometer').value = '';
    
    // Populate vehicle dropdown
    await populateVehicleDropdown('editTransactionVehicle');
    
    const modal = new bootstrap.Modal(document.getElementById('editTransactionModal'));
    modal.show();
}

/**
 * Save fuel transaction
 */
async function saveFuelTransaction() {
    try {
        const transactionId = document.getElementById('editTransactionId').value;
        const farmId = localStorage.getItem('selectedFarmId');
        const vehicleId = document.getElementById('editTransactionVehicle').value;
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a farm');
            return;
        }
        
        if (!vehicleId) {
            showErrorMessage('Vehicle is required');
            return;
        }
        
        const transactionData = {
            vehicle_id: vehicleId,
            farm_id: farmId,
            transaction_date: document.getElementById('editTransactionDate').value,
            litres: parseFloat(document.getElementById('editTransactionLitres').value) || null,
            cost: document.getElementById('editTransactionCost').value ? parseFloat(document.getElementById('editTransactionCost').value) : null,
            price_per_litre: document.getElementById('editTransactionPricePerLitre').value ? parseFloat(document.getElementById('editTransactionPricePerLitre').value) : null,
            odometer_reading: document.getElementById('editTransactionOdometer').value ? parseFloat(document.getElementById('editTransactionOdometer').value) : null
        };
        
        if (!transactionData.transaction_date || !transactionData.litres) {
            showErrorMessage('Transaction Date and Litres are required');
            return;
        }
        
        let result;
        if (transactionId) {
            result = await dataFunctions.updateFuelTransaction(transactionId, transactionData);
            showSuccessMessage('Fuel transaction updated successfully');
        } else {
            result = await dataFunctions.createFuelTransaction(transactionData);
            showSuccessMessage('Fuel transaction created successfully');
        }
        
        await loadFuelTransactions();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editTransactionModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving fuel transaction:', error);
        showErrorMessage('Failed to save fuel transaction: ' + error.message);
    }
}

/**
 * Delete fuel transaction
 */
async function deleteFuelTransaction(transactionId, transactionDate) {
    if (!confirm(`Are you sure you want to delete the fuel transaction from ${transactionDate}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteFuelTransaction(transactionId);
        showSuccessMessage('Fuel transaction deleted successfully');
        await loadFuelTransactions();
    } catch (error) {
        console.error('Error deleting fuel transaction:', error);
        showErrorMessage('Failed to delete fuel transaction: ' + error.message);
    }
}

/**
 * Show success/error/info messages
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

function showInfoMessage(message) {
    if (typeof _common !== 'undefined' && _common.showInfoToast) {
        _common.showInfoToast(message);
    } else {
        alert(message);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAssetsGrid);
} else {
    initializeAssetsGrid();
}

