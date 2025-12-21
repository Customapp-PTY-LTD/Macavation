// Water Module JavaScript
let waterData = {
    pumpReadings: [],
    licenses: []
};

async function initializeWaterGrid() {
    try {
        console.log('Water Grid initialized');
        
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
                        loadPumpReadings().catch(err => console.error('Error loading readings:', err)),
                        loadWaterLicenses().catch(err => console.error('Error loading licenses:', err))
                    ]).then(() => {
                        updateWaterSummaryCards();
                    });
                });
            }
        } catch (error) {
            console.error('Error setting up farm selector:', error);
        }
        
        await loadPumpReadings();
        await loadWaterLicenses();
        updateWaterSummaryCards();
    } catch (error) {
        console.error('Error initializing Water Grid:', error);
    }
}

/**
 * Update summary cards with calculated values
 */
function updateWaterSummaryCards() {
    try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        // Calculate water used this month
        const monthlyUsage = waterData.pumpReadings
            .filter(reading => {
                const readingDate = new Date(reading.reading_date);
                return readingDate >= startOfMonth;
            })
            .reduce((sum, reading) => sum + (parseFloat(reading.usage_m3) || 0), 0);
        
        // Count active pumps (unique pump locations)
        const activePumps = new Set(waterData.pumpReadings.map(r => r.pump_location).filter(Boolean)).size;
        
        // Calculate license remaining (total allocation - total usage)
        const totalAllocation = waterData.licenses
            .filter(license => license.status === 'active')
            .reduce((sum, license) => sum + (parseFloat(license.annual_allocation_m3 || license.allocation_m3) || 0), 0);
        
        const totalUsage = waterData.pumpReadings
            .reduce((sum, reading) => sum + (parseFloat(reading.usage_m3) || 0), 0);
        
        const licenseRemaining = Math.max(0, totalAllocation - totalUsage);
        
        // Estimate cost (simplified: assume R2.50 per m³)
        const estimatedCost = monthlyUsage * 2.5;
        
        // Update DOM elements
        const waterUsedEl = document.querySelector('#waterUsedThisMonth');
        if (waterUsedEl) {
            waterUsedEl.textContent = monthlyUsage.toLocaleString('en-ZA', {maximumFractionDigits: 0}) + ' m³';
        }
        
        const activePumpsEl = document.querySelector('#activePumpsCount');
        if (activePumpsEl) {
            activePumpsEl.textContent = activePumps.toString();
        }
        
        const licenseRemainingEl = document.querySelector('#licenseRemaining');
        if (licenseRemainingEl) {
            licenseRemainingEl.textContent = licenseRemaining.toLocaleString('en-ZA', {maximumFractionDigits: 0}) + ' m³';
        }
        
        const totalAllocationEl = document.querySelector('#totalAllocation');
        if (totalAllocationEl) {
            totalAllocationEl.textContent = `annual allocation: ${totalAllocation.toLocaleString('en-ZA', {maximumFractionDigits: 0})} m³`;
        }
        
        const waterCostEl = document.querySelector('#waterCostThisMonth');
        if (waterCostEl) {
            waterCostEl.textContent = 'R' + estimatedCost.toLocaleString('en-ZA', {minimumFractionDigits: 0, maximumFractionDigits: 0});
        }
    } catch (error) {
        console.error('Error updating water summary cards:', error);
    }
}

async function loadPumpReadings() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getPumpReadings) {
            console.error('dataFunctions.getPumpReadings is not available');
            waterData.pumpReadings = [];
            renderPumpReadings();
            return;
        }
        
        const farmId = localStorage.getItem('selectedFarmId') || 'all';
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        const readingsResponse = await dataFunctions.getPumpReadings(filters);
        console.log('Water - Pump readings response:', readingsResponse);
        
        // Handle different response structures
        let readings = readingsResponse;
        if (readingsResponse && !Array.isArray(readingsResponse)) {
            if (readingsResponse.readings && Array.isArray(readingsResponse.readings)) {
                readings = readingsResponse.readings;
            } else if (readingsResponse.data && Array.isArray(readingsResponse.data)) {
                readings = readingsResponse.data;
            } else if (readingsResponse.result && Array.isArray(readingsResponse.result)) {
                readings = readingsResponse.result;
            } else {
                console.warn('Water - Readings response is not in expected format:', readingsResponse);
                readings = [];
            }
        }
        
        if (readings && Array.isArray(readings)) {
            waterData.pumpReadings = readings;
            console.log('Water - Loaded pump readings:', readings.length);
        } else {
            waterData.pumpReadings = [];
            console.log('Water - No pump readings found');
        }
        renderPumpReadings();
        updateWaterSummaryCards();
    } catch (error) {
        console.error('Error loading pump readings:', error);
        waterData.pumpReadings = [];
        renderPumpReadings();
        updateWaterSummaryCards();
    }
}

async function loadWaterLicenses() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getWaterLicenses) {
            console.error('dataFunctions.getWaterLicenses is not available');
            waterData.licenses = [];
            renderWaterLicenses();
            return;
        }
        
        const farmId = localStorage.getItem('selectedFarmId') || 'all';
        const filters = farmId !== 'all' ? { farmId: farmId } : {};
        const licensesResponse = await dataFunctions.getWaterLicenses(filters);
        console.log('Water - Licenses response:', licensesResponse);
        
        // Handle different response structures
        let licenses = licensesResponse;
        if (licensesResponse && !Array.isArray(licensesResponse)) {
            if (licensesResponse.licenses && Array.isArray(licensesResponse.licenses)) {
                licenses = licensesResponse.licenses;
            } else if (licensesResponse.data && Array.isArray(licensesResponse.data)) {
                licenses = licensesResponse.data;
            } else if (licensesResponse.result && Array.isArray(licensesResponse.result)) {
                licenses = licensesResponse.result;
            } else {
                console.warn('Water - Licenses response is not in expected format:', licensesResponse);
                licenses = [];
            }
        }
        
        if (licenses && Array.isArray(licenses)) {
            waterData.licenses = licenses;
            console.log('Water - Loaded licenses:', licenses.length);
        } else {
            waterData.licenses = [];
            console.log('Water - No licenses found');
        }
        renderWaterLicenses();
        updateWaterSummaryCards();
    } catch (error) {
        console.error('Error loading water licenses:', error);
        waterData.licenses = [];
        renderWaterLicenses();
        updateWaterSummaryCards();
    }
}

function renderPumpReadings() {
    const container = document.getElementById('pumpReadingsList');
    if (!container) return;
    
    if (waterData.pumpReadings.length === 0) {
        container.innerHTML = '<p class="text-muted">No pump readings found</p>';
        return;
    }
    
    container.innerHTML = waterData.pumpReadings.map(reading => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title">${reading.pump_location || 'Pump Station'}</h5>
                        <p class="card-text mb-2">
                            <strong>Date:</strong> ${new Date(reading.reading_date).toLocaleDateString()}<br>
                            <strong>Meter Reading:</strong> ${reading.meter_reading || 'N/A'} m³<br>
                            <strong>Usage:</strong> ${reading.usage_m3 || 'N/A'} m³
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editPumpReading('${reading.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deletePumpReading('${reading.id}', '${reading.pump_location || 'Pump'}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

function renderWaterLicenses() {
    const container = document.getElementById('waterLicensesList');
    if (!container) return;
    
    if (waterData.licenses.length === 0) {
        container.innerHTML = '<p class="text-muted">No water licenses found</p>';
        return;
    }
    
    container.innerHTML = waterData.licenses.map(license => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="d-flex justify-content-between align-items-start">
                    <div class="flex-grow-1">
                        <h5 class="card-title">License ${license.license_number}</h5>
                        <p class="card-text mb-2">
                            <strong>Type:</strong> ${license.license_type || 'N/A'}<br>
                            <strong>Allocation:</strong> ${license.annual_allocation_m3 || license.allocation_m3 || 'N/A'} m³<br>
                            <strong>Issued:</strong> ${license.issued_date ? new Date(license.issued_date).toLocaleDateString() : 'N/A'}<br>
                            <strong>Expires:</strong> ${license.expiry_date ? new Date(license.expiry_date).toLocaleDateString() : 'N/A'}<br>
                            <strong>Status:</strong> ${license.status || 'N/A'}
                        </p>
                    </div>
                    <div class="ms-3">
                        <button class="btn btn-sm btn-outline-primary me-2" onclick="editWaterLicense('${license.id}')" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteWaterLicense('${license.id}', '${license.license_number}')" title="Delete">
                            <i class="bi bi-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Edit pump reading
 */
async function editPumpReading(readingId) {
    const reading = waterData.pumpReadings.find(r => String(r.id) === String(readingId));
    if (!reading) {
        showErrorMessage('Pump reading not found');
        return;
    }
    
    document.getElementById('editReadingId').value = reading.id;
    document.getElementById('editReadingDate').value = reading.reading_date ? reading.reading_date.split('T')[0] : '';
    document.getElementById('editPumpLocation').value = reading.pump_location || '';
    document.getElementById('editMeterReading').value = reading.meter_reading || '';
    document.getElementById('editPreviousReading').value = reading.previous_reading || '';
    document.getElementById('editUsageM3').value = reading.usage_m3 || '';
    
    const modal = new bootstrap.Modal(document.getElementById('editReadingModal'));
    modal.show();
}

/**
 * Save pump reading
 */
async function savePumpReading() {
    try {
        const readingId = document.getElementById('editReadingId').value;
        const farmId = localStorage.getItem('selectedFarmId');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a farm');
            return;
        }
        
        const readingData = {
            farm_id: farmId,
            pump_location: document.getElementById('editPumpLocation').value,
            reading_date: document.getElementById('editReadingDate').value,
            meter_reading: parseFloat(document.getElementById('editMeterReading').value) || null,
            previous_reading: document.getElementById('editPreviousReading').value ? parseFloat(document.getElementById('editPreviousReading').value) : null,
            usage_m3: document.getElementById('editUsageM3').value ? parseFloat(document.getElementById('editUsageM3').value) : null
        };
        
        if (!readingData.pump_location || !readingData.reading_date) {
            showErrorMessage('Pump Location and Reading Date are required');
            return;
        }
        
        let result;
        if (readingId) {
            result = await dataFunctions.updatePumpReading(readingId, readingData);
            showSuccessMessage('Pump reading updated successfully');
        } else {
            result = await dataFunctions.createPumpReading(readingData);
            showSuccessMessage('Pump reading created successfully');
        }
        
        await loadPumpReadings();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editReadingModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving pump reading:', error);
        showErrorMessage('Failed to save pump reading: ' + error.message);
    }
}

/**
 * Delete pump reading
 */
async function deletePumpReading(readingId, pumpLocation) {
    if (!confirm(`Are you sure you want to delete the pump reading for ${pumpLocation}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deletePumpReading(readingId);
        showSuccessMessage('Pump reading deleted successfully');
        await loadPumpReadings();
    } catch (error) {
        console.error('Error deleting pump reading:', error);
        showErrorMessage('Failed to delete pump reading: ' + error.message);
    }
}

/**
 * Edit water license
 */
async function editWaterLicense(licenseId) {
    const license = waterData.licenses.find(l => String(l.id) === String(licenseId));
    if (!license) {
        showErrorMessage('Water license not found');
        return;
    }
    
    document.getElementById('editLicenseId').value = license.id;
    document.getElementById('editLicenseNumber').value = license.license_number || '';
    document.getElementById('editLicenseType').value = license.license_type || '';
    document.getElementById('editLicenseIssued').value = license.issued_date ? license.issued_date.split('T')[0] : '';
    document.getElementById('editLicenseExpiry').value = license.expiry_date ? license.expiry_date.split('T')[0] : '';
    document.getElementById('editLicenseAllocation').value = license.annual_allocation_m3 || '';
    document.getElementById('editLicenseAuthority').value = license.issuing_authority || '';
    document.getElementById('editLicenseStatus').value = license.status || 'active';
    
    const modal = new bootstrap.Modal(document.getElementById('editLicenseModal'));
    modal.show();
}

/**
 * Save water license
 */
async function saveWaterLicense() {
    try {
        const licenseId = document.getElementById('editLicenseId').value;
        const farmId = localStorage.getItem('selectedFarmId');
        
        if (!farmId || farmId === 'all') {
            showErrorMessage('Please select a farm');
            return;
        }
        
        const licenseData = {
            farm_id: farmId,
            license_number: document.getElementById('editLicenseNumber').value,
            license_type: document.getElementById('editLicenseType').value || null,
            issued_date: document.getElementById('editLicenseIssued').value || null,
            expiry_date: document.getElementById('editLicenseExpiry').value || null,
            annual_allocation_m3: document.getElementById('editLicenseAllocation').value ? parseFloat(document.getElementById('editLicenseAllocation').value) : null,
            issuing_authority: document.getElementById('editLicenseAuthority').value || null,
            status: document.getElementById('editLicenseStatus').value || 'active'
        };
        
        if (!licenseData.license_number) {
            showErrorMessage('License Number is required');
            return;
        }
        
        let result;
        if (licenseId) {
            result = await dataFunctions.updateWaterLicense(licenseId, licenseData);
            showSuccessMessage('Water license updated successfully');
        } else {
            result = await dataFunctions.createWaterLicense(licenseData);
            showSuccessMessage('Water license created successfully');
        }
        
        await loadWaterLicenses();
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('editLicenseModal'));
        if (modal) modal.hide();
        
    } catch (error) {
        console.error('Error saving water license:', error);
        showErrorMessage('Failed to save water license: ' + error.message);
    }
}

/**
 * Delete water license
 */
async function deleteWaterLicense(licenseId, licenseNumber) {
    if (!confirm(`Are you sure you want to delete license "${licenseNumber}"? This action cannot be undone.`)) {
        return;
    }
    
    try {
        await dataFunctions.deleteWaterLicense(licenseId);
        showSuccessMessage('Water license deleted successfully');
        await loadWaterLicenses();
    } catch (error) {
        console.error('Error deleting water license:', error);
        showErrorMessage('Failed to delete water license: ' + error.message);
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
    document.addEventListener('DOMContentLoaded', initializeWaterGrid);
} else {
    initializeWaterGrid();
}

