// Chemicals Module JavaScript
let chemicalsData = {
    chemicals: [],
    applications: []
};

async function initializeChemicalsGrid() {
    try {
        console.log('Chemicals Grid initialized');
        
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
                    loadSprayApplications().catch(err => {
                        console.error('Error reloading applications:', err);
                    }).then(() => {
                        updateChemicalsSummaryCards();
                    });
                });
            }
        } catch (error) {
            console.error('Error setting up selectors:', error);
        }
        
        await loadChemicals();
        await loadSprayApplications();
        updateChemicalsSummaryCards();
    } catch (error) {
        console.error('Error initializing Chemicals Grid:', error);
    }
}

/**
 * Update summary cards with calculated values
 */
function updateChemicalsSummaryCards() {
    try {
        const now = new Date();
        const currentYear = now.getFullYear();
        const startOfSeason = new Date(currentYear, 0, 1); // Start of year (simplified season)
        
        // Calculate cost this season (sum of all chemical purchases/applications)
        // This is simplified - ideally would track actual purchase costs
        const seasonCost = chemicalsData.applications
            .filter(app => {
                const appDate = new Date(app.application_date);
                return appDate >= startOfSeason;
            })
            .reduce((sum, app) => {
                // Estimate cost: quantity * average price per unit (simplified)
                const quantity = parseFloat(app.quantity_used || app.total_quantity) || 0;
                const estimatedCost = quantity * 50; // Rough estimate: R50 per unit
                return sum + estimatedCost;
            }, 0);
        
        // Update DOM element
        const costEl = document.querySelector('#chemicalsCostThisSeason');
        if (costEl) {
            costEl.textContent = 'R' + seasonCost.toLocaleString('en-ZA', {minimumFractionDigits: 0, maximumFractionDigits: 0});
        }
    } catch (error) {
        console.error('Error updating chemicals summary cards:', error);
    }
}

async function loadChemicals() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getChemicals) {
            console.error('dataFunctions.getChemicals is not available');
            return;
        }
        
        const farmId = localStorage.getItem('selectedFarmId') || 'all';
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        const chemicals = await dataFunctions.getChemicals(filters);
        if (chemicals && Array.isArray(chemicals)) {
            chemicalsData.chemicals = chemicals;
            renderChemicals();
        } else {
            chemicalsData.chemicals = [];
            renderChemicals();
        }
    } catch (error) {
        console.error('Error loading chemicals:', error);
        chemicalsData.chemicals = [];
        renderChemicals();
    }
}

async function loadSprayApplications() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getSprayApplications) {
            console.error('dataFunctions.getSprayApplications is not available');
            chemicalsData.applications = [];
            renderApplications();
            return;
        }
        
        const farmId = localStorage.getItem('selectedFarmId') || 'all';
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        const applications = await dataFunctions.getSprayApplications(filters);
        if (applications && Array.isArray(applications)) {
            chemicalsData.applications = applications;
        } else {
            chemicalsData.applications = [];
        }
        renderApplications();
        updateChemicalsSummaryCards();
    } catch (error) {
        console.error('Error loading spray applications:', error);
        chemicalsData.applications = [];
        renderApplications();
        updateChemicalsSummaryCards();
    }
}

function renderChemicals() {
    const container = document.getElementById('chemicalsList');
    if (!container) return;
    
    if (chemicalsData.chemicals.length === 0) {
        container.innerHTML = '<p class="text-muted">No chemicals found</p>';
        return;
    }
    
    container.innerHTML = chemicalsData.chemicals.map(chem => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title">${chem.name}</h5>
                        <p class="card-text mb-2">
                            <strong>Active Ingredient:</strong> ${chem.active_ingredient || 'N/A'}<br>
                            <strong>Registration:</strong> ${chem.registration_number || 'N/A'}<br>
                            <strong>PHI Days:</strong> ${chem.phi_days || 'N/A'}<br>
                            <strong>Quantity:</strong> ${chem.quantity_on_hand || 0} ${chem.unit || ''}
                            ${chem.expiry_date ? `<br><strong>Expiry:</strong> ${new Date(chem.expiry_date).toLocaleDateString()}` : ''}
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editChemical('${chem.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteChemical('${chem.id}', '${chem.name}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderApplications() {
    const container = document.getElementById('applicationsList');
    if (!container) return;
    
    if (chemicalsData.applications.length === 0) {
        container.innerHTML = '<p class="text-muted">No applications found</p>';
        return;
    }
    
    container.innerHTML = chemicalsData.applications.map(app => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title">Application - ${new Date(app.application_date).toLocaleDateString()}</h5>
                        <p class="card-text mb-2">
                            <strong>Chemical:</strong> ${app.chemical_name || 'N/A'}<br>
                            <strong>Area Treated:</strong> ${app.area_treated || 'N/A'} hectares<br>
                            <strong>Quantity Used:</strong> ${app.quantity_used || app.total_quantity || 'N/A'} ${app.unit || ''}
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editSprayApplication('${app.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteSprayApplication('${app.id}', '${new Date(app.application_date).toLocaleDateString()}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Add new chemical (opens modal)
 */
function addChemical() {
    document.getElementById('editChemicalId').value = '';
    document.getElementById('editChemicalName').value = '';
    document.getElementById('editActiveIngredient').value = '';
    document.getElementById('editRegistrationNumber').value = '';
    document.getElementById('editPHIDays').value = '';
    document.getElementById('editQuantity').value = '';
    document.getElementById('editUnit').value = '';
    document.getElementById('editExpiryDate').value = '';
    
    const modal = new bootstrap.Modal(document.getElementById('editChemicalModal'));
    modal.show();
}

/**
 * Add new chemical (opens modal)
 */
function addChemical() {
    if (!document.getElementById('editChemicalModal')) {
        showErrorMessage('Edit modal not found in HTML');
        return;
    }
    
    document.getElementById('editChemicalId').value = '';
    document.getElementById('editChemicalName').value = '';
    document.getElementById('editActiveIngredient').value = '';
    document.getElementById('editRegistrationNumber').value = '';
    document.getElementById('editPHIDays').value = '';
    document.getElementById('editQuantity').value = '';
    document.getElementById('editUnit').value = '';
    document.getElementById('editExpiryDate').value = '';
    
    const modal = new bootstrap.Modal(document.getElementById('editChemicalModal'));
    modal.show();
}

/**
 * Edit chemical
 */
async function editChemical(chemicalId) {
    const chemical = chemicalsData.chemicals.find(c => String(c.id) === String(chemicalId));
    if (!chemical) {
        showErrorMessage('Chemical not found');
        return;
    }
    
    // Populate edit modal
    if (!document.getElementById('editChemicalModal')) {
        showErrorMessage('Edit modal not found in HTML');
        return;
    }
    
    document.getElementById('editChemicalId').value = chemical.id;
    document.getElementById('editChemicalName').value = chemical.name || '';
    document.getElementById('editActiveIngredient').value = chemical.active_ingredient || '';
    document.getElementById('editRegistrationNumber').value = chemical.registration_number || '';
    document.getElementById('editPHIDays').value = chemical.phi_days || '';
    document.getElementById('editQuantity').value = chemical.quantity_on_hand || '';
    document.getElementById('editUnit').value = chemical.unit || '';
    document.getElementById('editExpiryDate').value = chemical.expiry_date ? chemical.expiry_date.split('T')[0] : '';
    
    const modal = new bootstrap.Modal(document.getElementById('editChemicalModal'));
    modal.show();
}

/**
 * Add new application (populate dropdowns)
 */
async function addApplication() {
    document.getElementById('editApplicationId').value = '';
    document.getElementById('editApplicationDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('editApplicationChemical').value = '';
    document.getElementById('editApplicationBlock').value = '';
    document.getElementById('editAreaTreated').value = '';
    document.getElementById('editQuantityUsed').value = '';
    
    // Populate chemical dropdown
    const chemicalSelect = document.getElementById('editApplicationChemical');
    if (chemicalSelect) {
        const farmId = localStorage.getItem('selectedFarmId');
        const filters = farmId && farmId !== 'all' ? { farmId: farmId } : {};
        const chemicals = await dataFunctions.getChemicals(filters);
        chemicalSelect.innerHTML = '<option value="">Select chemical</option>';
        if (chemicals && Array.isArray(chemicals)) {
            chemicals.forEach(chem => {
                const option = document.createElement('option');
                option.value = chem.id;
                option.textContent = chem.name;
                chemicalSelect.appendChild(option);
            });
        }
    }
    
    // Populate block dropdown
    const blockSelect = document.getElementById('editApplicationBlock');
    if (blockSelect && typeof populateBlockSelector === 'function') {
        const farmId = localStorage.getItem('selectedFarmId');
        if (farmId && farmId !== 'all') {
            await populateBlockSelector('editApplicationBlock', null, false);
        }
    }
    
    const modal = new bootstrap.Modal(document.getElementById('editApplicationModal'));
    modal.show();
}

/**
 * Save application (create or update)
 */
async function saveApplication() {
    try {
        const applicationId = document.getElementById('editApplicationId').value;
        const farmId = localStorage.getItem('selectedFarmId');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a farm');
            return;
        }
        
        const applicationData = {
            farm_id: farmId,
            chemical_id: document.getElementById('editApplicationChemical').value,
            application_date: document.getElementById('editApplicationDate').value,
            block_id: document.getElementById('editApplicationBlock').value || null,
            area_treated: parseFloat(document.getElementById('editAreaTreated').value) || null,
            quantity_used: parseFloat(document.getElementById('editQuantityUsed').value) || null
        };
        
        if (!applicationData.chemical_id || !applicationData.application_date) {
            showErrorMessage('Chemical and Application Date are required');
            return;
        }
        
        let result;
        if (applicationId) {
            result = await dataFunctions.updateSprayApplication(applicationId, applicationData);
            showSuccessMessage('Application updated successfully');
        } else {
            result = await dataFunctions.createSprayApplication(applicationData);
            showSuccessMessage('Application created successfully');
        }
        
        await loadSprayApplications();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editApplicationModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving application:', error);
        showErrorMessage('Failed to save application: ' + error.message);
    }
}

/**
 * Save chemical (create or update)
 */
async function saveChemical() {
    try {
        const chemicalId = document.getElementById('editChemicalId').value;
        const farmId = localStorage.getItem('selectedFarmId');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a farm');
            return;
        }
        
        const chemicalData = {
            farm_id: farmId,
            name: document.getElementById('editChemicalName').value,
            active_ingredient: document.getElementById('editActiveIngredient').value || null,
            registration_number: document.getElementById('editRegistrationNumber').value || null,
            phi_days: parseInt(document.getElementById('editPHIDays').value) || null,
            quantity_on_hand: parseFloat(document.getElementById('editQuantity').value) || null,
            unit: document.getElementById('editUnit').value || null,
            expiry_date: document.getElementById('editExpiryDate').value || null
        };
        
        if (!chemicalData.name) {
            showErrorMessage('Chemical name is required');
            return;
        }
        
        let result;
        if (chemicalId) {
            result = await dataFunctions.updateChemical(chemicalId, chemicalData);
            showSuccessMessage('Chemical updated successfully');
        } else {
            result = await dataFunctions.createChemical(chemicalData);
            showSuccessMessage('Chemical created successfully');
        }
        
        await loadChemicals();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editChemicalModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving chemical:', error);
        showErrorMessage('Failed to save chemical: ' + error.message);
    }
}

/**
 * Delete chemical
 */
async function deleteChemical(chemicalId, chemicalName) {
    if (!confirm(`Are you sure you want to delete "${chemicalName}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteChemical(chemicalId);
        showSuccessMessage('Chemical deleted successfully');
        await loadChemicals();
    } catch (error) {
        console.error('Error deleting chemical:', error);
        showErrorMessage('Failed to delete chemical: ' + error.message);
    }
}

/**
 * Edit spray application
 */
async function editSprayApplication(applicationId) {
    const application = chemicalsData.applications.find(a => String(a.id) === String(applicationId));
    if (!application) {
        showErrorMessage('Application not found');
        return;
    }
    
    // Populate chemical dropdown if needed
    const chemicalSelect = document.getElementById('editApplicationChemical');
    if (chemicalSelect) {
        // Populate chemicals dropdown
        const farmId = localStorage.getItem('selectedFarmId');
        const filters = farmId && farmId !== 'all' ? { farmId: farmId } : {};
        const chemicals = await dataFunctions.getChemicals(filters);
        chemicalSelect.innerHTML = '<option value="">Select chemical</option>';
        if (chemicals && Array.isArray(chemicals)) {
            chemicals.forEach(chem => {
                const option = document.createElement('option');
                option.value = chem.id;
                option.textContent = chem.name;
                chemicalSelect.appendChild(option);
            });
        }
    }
    
    // Populate block dropdown if needed
    const blockSelect = document.getElementById('editApplicationBlock');
    if (blockSelect && typeof populateBlockSelector === 'function') {
        const farmId = localStorage.getItem('selectedFarmId');
        if (farmId && farmId !== 'all') {
            await populateBlockSelector('editApplicationBlock', application.block_id, false);
        }
    }
    
    document.getElementById('editApplicationId').value = application.id;
    document.getElementById('editApplicationDate').value = application.application_date ? application.application_date.split('T')[0] : '';
    document.getElementById('editApplicationChemical').value = application.chemical_id || '';
    document.getElementById('editAreaTreated').value = application.area_treated || '';
    document.getElementById('editQuantityUsed').value = application.quantity_used || application.total_quantity || '';
    
    const modal = new bootstrap.Modal(document.getElementById('editApplicationModal'));
    modal.show();
}

/**
 * Delete spray application
 */
async function deleteSprayApplication(applicationId, applicationDate) {
    if (!confirm(`Are you sure you want to delete the application from ${applicationDate}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteSprayApplication(applicationId);
        showSuccessMessage('Application deleted successfully');
        await loadSprayApplications();
    } catch (error) {
        console.error('Error deleting application:', error);
        showErrorMessage('Failed to delete application: ' + error.message);
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
    document.addEventListener('DOMContentLoaded', initializeChemicalsGrid);
} else {
    initializeChemicalsGrid();
}

