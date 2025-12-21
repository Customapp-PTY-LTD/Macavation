// Crops Module JavaScript
let cropsData = {
    measurements: []
};

async function initializeCropsGrid() {
    try {
    console.log('Crops Grid initialized');
        
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
                    loadFruitMeasurements().catch(err => {
                        console.error('Error reloading measurements:', err);
                    });
    });
            }
        } catch (error) {
            console.error('Error setting up selectors:', error);
        }
    
    await loadFruitMeasurements();
    } catch (error) {
        console.error('Error initializing Crops Grid:', error);
    }
}

async function loadFruitMeasurements() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getFruitMeasurements) {
            console.error('dataFunctions.getFruitMeasurements is not available');
            cropsData.measurements = [];
            renderMeasurements();
            return;
        }
        
        const farmId = localStorage.getItem('selectedFarmId') || 'all';
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        const measurements = await dataFunctions.getFruitMeasurements(filters);
        if (measurements && Array.isArray(measurements)) {
            cropsData.measurements = measurements;
        } else {
            cropsData.measurements = [];
        }
        renderMeasurements();
    } catch (error) {
        console.error('Error loading fruit measurements:', error);
        cropsData.measurements = [];
        renderMeasurements();
    }
}

function renderMeasurements() {
    const container = document.getElementById('measurementsList');
    if (!container) return;
    
    if (cropsData.measurements.length === 0) {
        container.innerHTML = '<p class="text-muted">No measurements found</p>';
        return;
    }
    
    container.innerHTML = cropsData.measurements.map(meas => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                <h5 class="card-title">Measurement - ${new Date(meas.measurement_date).toLocaleDateString()}</h5>
                        <p class="card-text mb-2">
                    <strong>Days After Bloom:</strong> ${meas.days_after_full_bloom || 'N/A'}<br>
                    <strong>Sample Size:</strong> ${meas.sample_size || 'N/A'}<br>
                    <strong>Avg Circumference:</strong> ${meas.circumference_avg || 'N/A'} mm<br>
                    <strong>Avg Weight:</strong> ${meas.weight_avg || 'N/A'} g
                </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editFruitMeasurement('${meas.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteFruitMeasurement('${meas.id}', '${new Date(meas.measurement_date).toLocaleDateString()}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Edit fruit measurement
 */
async function editFruitMeasurement(measurementId) {
    const measurement = cropsData.measurements.find(m => String(m.id) === String(measurementId));
    if (!measurement) {
        showErrorMessage('Measurement not found');
        return;
    }
    
    // Populate block dropdown if needed
    const blockSelect = document.getElementById('editMeasurementBlock');
    if (blockSelect && typeof populateBlockSelector === 'function') {
        const farmId = localStorage.getItem('selectedFarmId');
        if (farmId && farmId !== 'all') {
            await populateBlockSelector('editMeasurementBlock', measurement.block_id, false);
        }
    }
    
    // Populate variety dropdown if needed
    const varietySelect = document.getElementById('editMeasurementVariety');
    if (varietySelect && typeof populateVarietySelector === 'function') {
        await populateVarietySelector('editMeasurementVariety', measurement.variety_id, false);
    }
    
    document.getElementById('editMeasurementId').value = measurement.id;
    document.getElementById('editMeasurementDate').value = measurement.measurement_date ? measurement.measurement_date.split('T')[0] : '';
    document.getElementById('editDaysAfterBloom').value = measurement.days_after_full_bloom || '';
    document.getElementById('editSampleSize').value = measurement.sample_size || '';
    document.getElementById('editCircumference').value = measurement.circumference_avg || '';
    document.getElementById('editWeight').value = measurement.weight_avg || '';
    
    const modal = new bootstrap.Modal(document.getElementById('editMeasurementModal'));
    modal.show();
}

/**
 * Save measurement
 */
async function saveMeasurement() {
    try {
        const measurementId = document.getElementById('editMeasurementId').value;
        const farmId = localStorage.getItem('selectedFarmId');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a farm');
            return;
        }
        
        const measurementData = {
            farm_id: farmId,
            measurement_date: document.getElementById('editMeasurementDate').value,
            block_id: document.getElementById('editMeasurementBlock')?.value || null,
            variety_id: document.getElementById('editMeasurementVariety')?.value || null,
            days_after_full_bloom: parseInt(document.getElementById('editDaysAfterBloom').value) || null,
            sample_size: parseInt(document.getElementById('editSampleSize').value) || null,
            circumference_avg: parseFloat(document.getElementById('editCircumference').value) || null,
            weight_avg: parseFloat(document.getElementById('editWeight').value) || null
        };
        
        if (!measurementData.measurement_date) {
            showErrorMessage('Measurement Date is required');
            return;
        }
        
        let result;
        if (measurementId) {
            result = await dataFunctions.updateFruitMeasurement(measurementId, measurementData);
            showSuccessMessage('Measurement updated successfully');
        } else {
            result = await dataFunctions.createFruitMeasurement(measurementData);
            showSuccessMessage('Measurement created successfully');
        }
        
        await loadFruitMeasurements();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editMeasurementModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving measurement:', error);
        showErrorMessage('Failed to save measurement: ' + error.message);
    }
}

/**
 * Delete fruit measurement
 */
async function deleteFruitMeasurement(measurementId, measurementDate) {
    if (!confirm(`Are you sure you want to delete the measurement from ${measurementDate}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteFruitMeasurement(measurementId);
        showSuccessMessage('Measurement deleted successfully');
        await loadFruitMeasurements();
    } catch (error) {
        console.error('Error deleting measurement:', error);
        showErrorMessage('Failed to delete measurement: ' + error.message);
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
    document.addEventListener('DOMContentLoaded', initializeCropsGrid);
} else {
    initializeCropsGrid();
}

