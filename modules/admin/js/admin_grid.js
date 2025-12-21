/**
 * System Administration Module
 * Multi-farm portfolio management, users, resources & configuration
 */

let adminData = {
    farms: [],
    users: [],
    resources: {},
    cropTypes: [],
    transfers: []
};

/**
 * Initialize Admin Grid Module
 */
async function initializeAdminGrid() {
    try {
        console.log('Initializing Admin Grid Module...');
        
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
        
        // Set up Bootstrap tab event handlers
        const tabElements = document.querySelectorAll('button[data-bs-toggle="tab"]');
        tabElements.forEach(tab => {
            tab.addEventListener('shown.bs.tab', function (event) {
                const targetId = event.target.getAttribute('data-bs-target');
                console.log('Tab switched to:', targetId);
                handleTabSwitch(targetId);
            });
        });
        
        // Load initial data with error handling
        try {
            await loadPortfolioSummary();
        } catch (error) {
            console.error('Error loading portfolio summary:', error);
        }
        
        try {
            await loadFarms();
        } catch (error) {
            console.error('Error loading farms:', error);
        }
        
        try {
            await loadUsers();
        } catch (error) {
            console.error('Error loading users:', error);
        }
        
        try {
            await loadSharedResources();
        } catch (error) {
            console.error('Error loading shared resources:', error);
        }
        
        try {
            await loadCropTypes();
        } catch (error) {
            console.error('Error loading crop types:', error);
        }
        
        // Set up form handlers
        if (typeof setupFormHandlers === 'function') {
            setupFormHandlers();
        }
    } catch (error) {
        console.error('Error initializing Admin Grid:', error);
    }
}

/**
 * Handle tab switching
 */
function handleTabSwitch(targetId) {
    switch(targetId) {
        case '#farms':
            loadFarms();
            break;
        case '#users':
            loadUsers();
            break;
        case '#resources':
            loadSharedResources();
            loadActiveTransfers();
            break;
        case '#crops':
            loadCropTypes();
            break;
        case '#analytics':
            loadPortfolioAnalytics();
            break;
    }
}

/**
 * Load portfolio summary data
 */
async function loadPortfolioSummary() {
    try {
        // Get actual data from API
        let summary = {
            totalFarms: 0,
            totalUsers: 0,
            totalWorkers: 0,
            totalHectares: 0,
            totalVehicles: 0,
            totalEquipment: 0
        };
        
        try {
            // Get farms
            if (typeof dataFunctions !== 'undefined' && dataFunctions.getFarms) {
                const farms = await dataFunctions.getFarms();
                if (farms && Array.isArray(farms)) {
                    summary.totalFarms = farms.length;
                    summary.totalHectares = farms.reduce((sum, farm) => sum + (parseFloat(farm.hectares) || 0), 0);
                }
            }
            
            // Get users (if function exists - may not be implemented yet)
            // For now, skip user count if function doesn't exist
            if (typeof dataFunctions !== 'undefined' && typeof dataFunctions.getUsers === 'function') {
                try {
                    const users = await dataFunctions.getUsers();
                    if (users && Array.isArray(users)) {
                        summary.totalUsers = users.length;
                    }
                } catch (error) {
                    console.warn('Could not load users count:', error);
                }
            }
            
            // Get workers
            if (typeof dataFunctions !== 'undefined' && dataFunctions.getWorkers) {
                const workers = await dataFunctions.getWorkers({});
                if (workers && Array.isArray(workers)) {
                    summary.totalWorkers = workers.length;
                }
            }
            
            // Get vehicles
            if (typeof dataFunctions !== 'undefined' && dataFunctions.getVehicles) {
                const vehicles = await dataFunctions.getVehicles({});
                if (vehicles && Array.isArray(vehicles)) {
                    summary.totalVehicles = vehicles.length;
                }
            }
            
            // Equipment count (same as vehicles for now)
            summary.totalEquipment = summary.totalVehicles;
        } catch (error) {
            console.error('Error loading portfolio summary data:', error);
            // Keep default zeros if API fails
        }
        
        // Update summary cards (safely handle missing elements)
        const setTextContent = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        
        setTextContent('totalFarms', summary.totalFarms);
        setTextContent('totalUsers', summary.totalUsers);
        setTextContent('totalWorkers', summary.totalWorkers);
        setTextContent('totalHectares', summary.totalHectares);
        
        // Update additional summary elements
        setTextContent('summaryHectares', summary.totalHectares + ' ha');
        setTextContent('summaryWorkers', summary.totalWorkers);
        setTextContent('summaryVehicles', summary.totalVehicles);
        setTextContent('summaryEquipment', summary.totalEquipment);
        
        setTextContent('resourceWorkers', summary.totalWorkers);
        setTextContent('resourceVehicles', summary.totalVehicles);
        setTextContent('resourceEquipment', summary.totalEquipment);
        
    } catch (error) {
        console.error('Error loading portfolio summary:', error);
        showNotification('Failed to load portfolio summary', 'error');
    }
}

/**
 * Load farms list
 */
async function loadFarms() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getFarms) {
            console.error('dataFunctions.getFarms is not available');
            return;
        }
        
        const farms = await dataFunctions.getFarms();
        
        if (!farms || farms.length === 0) {
            adminData.farms = [];
        } else {
            // Get worker and vehicle counts for each farm
            const farmsWithCounts = await Promise.all(farms.map(async (farm) => {
                let workerCount = 0;
                let vehicleCount = 0;
                
                try {
                    // Count workers for this farm
                    if (dataFunctions.getWorkers) {
                        const workers = await dataFunctions.getWorkers({ farmId: farm.id });
                        if (workers && Array.isArray(workers)) {
                            workerCount = workers.length;
                        }
                    }
                    
                    // Count vehicles for this farm
                    if (dataFunctions.getVehicles) {
                        const vehicles = await dataFunctions.getVehicles({ farmId: farm.id });
                        if (vehicles && Array.isArray(vehicles)) {
                            vehicleCount = vehicles.length;
                        }
                    }
                } catch (error) {
                    console.warn(`Error getting counts for farm ${farm.id}:`, error);
                }
                
                return {
                    id: farm.id,
                    name: farm.name,
                    location: farm.location || 'Location not set',
                    region: farm.region || 'Region not set',
                    hectares: farm.hectares || 0,
                    crop_type: farm.crop_type || 'Not specified',
                    manager_name: farm.manager_name || 'Manager TBD',
                    status: farm.status || 'active',
                    workers: workerCount,
                    vehicles: vehicleCount
                };
            }));
            
            adminData.farms = farmsWithCounts;
        }
        
        renderFarmsList(adminData.farms);
        renderCropDistribution(adminData.farms);
        
        // Update farm selects in modals and forms
        updateFarmSelects(adminData.farms);
        
    } catch (error) {
        console.error('Error loading farms:', error);
        showNotification('Failed to load farms', 'error');
    }
}

/**
 * Render farms list
 */
function renderFarmsList(farms) {
    const container = document.getElementById('farmsListContainer');
    if (!container) return;
    
    if (!farms || farms.length === 0) {
        container.innerHTML = '<p class="text-muted text-center py-4">No farms found</p>';
        return;
    }
    
    container.innerHTML = farms.map(farm => `
        <div class="card mb-3">
            <div class="card-body">
                <div class="row align-items-center">
                    <div class="col-md-6">
                        <h5 class="mb-1 fw-bold">${farm.name}</h5>
                        <p class="text-muted mb-2">
                            <i class="bi bi-geo-alt me-1"></i>${farm.location}
                        </p>
                        <p class="mb-0">
                            <span class="badge bg-primary">${farm.crop_type}</span>
                            <span class="badge bg-secondary ms-2">${farm.hectares} ha</span>
                        </p>
                    </div>
                    <div class="col-md-4">
                        <small class="text-muted d-block">Manager:</small>
                        <strong>${farm.manager_name}</strong>
                        <div class="mt-2">
                            <small class="text-muted">Workers: ${farm.workers} | Vehicles: ${farm.vehicles}</small>
                        </div>
                    </div>
                    <div class="col-md-2 text-end">
                        <div class="btn-group" role="group">
                            <button class="btn btn-sm btn-outline-primary" onclick="editFarm('${farm.id}')" title="Edit">
                                <i class="bi bi-pencil"></i>
                            </button>
                            <button class="btn btn-sm btn-outline-secondary" onclick="viewFarmDetails('${farm.id}')" title="View Details">
                                <i class="bi bi-eye"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Render crop distribution
 */
function renderCropDistribution(farms) {
    const container = document.getElementById('cropDistributionContainer');
    if (!container) return;
    
    const cropMap = {};
    farms.forEach(farm => {
        if (!cropMap[farm.crop_type]) {
            cropMap[farm.crop_type] = 0;
        }
        cropMap[farm.crop_type] += farm.hectares;
    });
    
    const total = Object.values(cropMap).reduce((sum, val) => sum + val, 0);
    
    container.innerHTML = Object.entries(cropMap).map(([crop, hectares]) => {
        const percentage = ((hectares / total) * 100).toFixed(1);
        return `
            <div class="mb-2">
                <div class="d-flex justify-content-between mb-1">
                    <small>${crop}</small>
                    <small class="fw-bold">${hectares} ha (${percentage}%)</small>
                </div>
                <div class="progress" style="height: 8px;">
                    <div class="progress-bar" role="progressbar" style="width: ${percentage}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Update farm selects in forms
 */
function updateFarmSelects(farms) {
    const selects = [
        'farmManagerSelect',
        'transferFromFarm',
        'transferToFarm',
        'userFarmAccessSelect'
    ];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const isMultiple = select.hasAttribute('multiple');
            select.innerHTML = farms.map(farm => 
                `<option value="${farm.id}">${farm.name}</option>`
            ).join('');
            
            if (!isMultiple) {
                select.insertAdjacentHTML('afterbegin', '<option value="">Select farm...</option>');
            }
        }
    });
}

/**
 * Load users list
 */
async function loadUsers() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getUsers) {
            console.error('dataFunctions.getUsers is not available');
            return;
        }
        
        const users = await dataFunctions.getUsers();
        
        if (!users || users.length === 0) {
            // Fallback to mock data
            const users = [
            {
                id: '1',
                first_name: 'Admin',
                last_name: 'User',
                email: 'admin@fruitlive.com',
                role: 'super_admin',
                farm_access: ['All Farms'],
                status: 'active'
            },
            {
                id: '2',
                first_name: 'John',
                last_name: 'Smith',
                email: 'john.smith@fruitlive.com',
                role: 'farm_manager',
                farm_access: ['Applewood Farm'],
                status: 'active'
            },
            {
                id: '3',
                first_name: 'Sarah',
                last_name: 'Johnson',
                email: 'sarah.johnson@fruitlive.com',
                role: 'farm_manager',
                farm_access: ['Citrus Valley'],
                status: 'active'
            }
            ];
            adminData.users = users;
        } else {
            // Map database users to display format
            adminData.users = users.map(user => ({
                id: user.id,
                first_name: user.username || user.email?.split('@')[0] || 'User',
                last_name: '',
                email: user.email,
                role: user.role || 'user',
                farm_access: ['All Farms'], // TODO: Get from user_farm_access
                status: user.is_active ? 'active' : 'inactive'
            }));
        }
        
        renderUsersTable(adminData.users);
        updateUserStats(adminData.users);
        
    } catch (error) {
        console.error('Error loading users:', error);
        showNotification('Failed to load users', 'error');
    }
}

/**
 * Render users table
 */
function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">No users found</td></tr>';
        return;
    }
    
    const roleColors = {
        super_admin: 'danger',
        farm_admin: 'primary',
        farm_manager: 'info',
        field_user: 'secondary'
    };
    
    const roleLabels = {
        super_admin: 'Super Admin',
        farm_admin: 'Farm Admin',
        farm_manager: 'Farm Manager',
        field_user: 'Field User'
    };
    
    tbody.innerHTML = users.map(user => `
        <tr>
            <td>
                <strong>${user.first_name} ${user.last_name}</strong>
                <br><small class="text-muted">${user.email}</small>
            </td>
            <td>
                <span class="badge bg-${roleColors[user.role]}">${roleLabels[user.role]}</span>
            </td>
            <td>
                <small>${user.farm_access.join(', ')}</small>
            </td>
            <td>
                <span class="badge bg-${user.status === 'active' ? 'success' : 'secondary'}">
                    ${user.status}
                </span>
            </td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-sm btn-outline-primary" onclick="editUser('${user.id}')" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="manageUserPermissions('${user.id}')" title="Permissions">
                        <i class="bi bi-key"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Update user statistics
 */
function updateUserStats(users) {
    const stats = {
        super_admin: 0,
        farm_admin: 0,
        farm_manager: 0,
        field_user: 0
    };
    
    users.forEach(user => {
        if (stats[user.role] !== undefined) {
            stats[user.role]++;
        }
    });
    
    document.getElementById('statSuperAdmin').textContent = stats.super_admin;
    document.getElementById('statFarmAdmin').textContent = stats.farm_admin;
    document.getElementById('statFarmManager').textContent = stats.farm_manager;
    document.getElementById('statFieldUser').textContent = stats.field_user;
}

/**
 * Load shared resources
 */
async function loadSharedResources() {
    try {
        // TODO: Replace with actual API call
        // const resources = await dataFunctions.callFunction('get_shared_resource_summary', {});
        
        // Mock data
        const resources = {
            totalWorkers: 547,
            totalVehicles: 50,
            totalEquipment: 190,
            byFarm: adminData.farms.map(farm => ({
                farmId: farm.id,
                farmName: farm.name,
                workers: farm.workers,
                vehicles: farm.vehicles
            }))
        };
        
        adminData.resources = resources;
        renderLabourPoolDistribution(resources);
        
    } catch (error) {
        console.error('Error loading shared resources:', error);
        showNotification('Failed to load shared resources', 'error');
    }
}

/**
 * Render labour pool distribution
 */
function renderLabourPoolDistribution(resources) {
    const container = document.getElementById('labourPoolContainer');
    if (!container) return;
    
    if (!resources.byFarm || resources.byFarm.length === 0) {
        container.innerHTML = '<p class="text-muted">No labour data available</p>';
        return;
    }
    
    const maxWorkers = Math.max(...resources.byFarm.map(f => f.workers));
    
    container.innerHTML = resources.byFarm.map(farm => {
        const percentage = ((farm.workers / resources.totalWorkers) * 100).toFixed(1);
        const barWidth = ((farm.workers / maxWorkers) * 100).toFixed(1);
        
        return `
            <div class="mb-3">
                <div class="d-flex justify-content-between mb-1">
                    <strong>${farm.farmName}</strong>
                    <span>${farm.workers} workers (${percentage}%)</span>
                </div>
                <div class="progress" style="height: 25px;">
                    <div class="progress-bar bg-success" role="progressbar" style="width: ${barWidth}%">
                        ${farm.workers}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Load active transfers
 */
async function loadActiveTransfers() {
    try {
        // TODO: Replace with actual API call
        // const transfers = await dataFunctions.callFunction('get_active_transfers', {});
        
        adminData.transfers = [];
        renderTransfersTable(adminData.transfers);
        
    } catch (error) {
        console.error('Error loading transfers:', error);
    }
}

/**
 * Render transfers table
 */
function renderTransfersTable(transfers) {
    const tbody = document.getElementById('transfersTableBody');
    if (!tbody) return;
    
    if (!transfers || transfers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No active transfers</td></tr>';
        return;
    }
    
    tbody.innerHTML = transfers.map(transfer => `
        <tr>
            <td><code>${transfer.id.substring(0, 8)}</code></td>
            <td>${transfer.resource_type}</td>
            <td>${transfer.from_farm}</td>
            <td>${transfer.to_farm}</td>
            <td>${transfer.start_date}</td>
            <td>${transfer.return_date}</td>
            <td>
                <span class="badge bg-${transfer.status === 'active' ? 'success' : 'secondary'}">
                    ${transfer.status}
                </span>
            </td>
        </tr>
    `).join('');
}

/**
 * Load crop types
 */
async function loadCropTypes() {
    try {
        // TODO: Replace with actual API call
        // const cropTypes = await dataFunctions.callFunction('get_crop_types', {});
        
        // Mock data
        const cropTypes = [
            {
                id: '1',
                name: 'Apples',
                category: 'Fruit',
                varieties_count: 12,
                farms_count: 2,
                total_hectares: 192,
                compliance_standards: ['Global GAP', 'BRC']
            },
            {
                id: '2',
                name: 'Citrus',
                category: 'Citrus',
                varieties_count: 8,
                farms_count: 1,
                total_hectares: 98,
                compliance_standards: ['Global GAP']
            },
            {
                id: '3',
                name: 'Grapes',
                category: 'Fruit',
                varieties_count: 15,
                farms_count: 1,
                total_hectares: 156,
                compliance_standards: ['Global GAP', 'FSSC 22000']
            }
        ];
        
        adminData.cropTypes = cropTypes;
        renderCropTypesTable(cropTypes);
        
    } catch (error) {
        console.error('Error loading crop types:', error);
        showNotification('Failed to load crop types', 'error');
    }
}

/**
 * Render crop types table
 */
function renderCropTypesTable(cropTypes) {
    const tbody = document.getElementById('cropTypesTableBody');
    if (!tbody) return;
    
    if (!cropTypes || cropTypes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">No crop types found</td></tr>';
        return;
    }
    
    tbody.innerHTML = cropTypes.map(crop => `
        <tr>
            <td><strong>${crop.name}</strong></td>
            <td>${crop.category}</td>
            <td>${crop.varieties_count}</td>
            <td>${crop.farms_count}</td>
            <td>${crop.total_hectares} ha</td>
            <td>
                ${crop.compliance_standards.map(std => 
                    `<span class="badge bg-success me-1">${std}</span>`
                ).join('')}
            </td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-sm btn-outline-primary" onclick="editCropType('${crop.id}')" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="viewVarieties('${crop.id}')" title="View Varieties">
                        <i class="bi bi-list"></i>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Load portfolio analytics
 */
async function loadPortfolioAnalytics() {
    try {
        // TODO: Replace with actual API call
        // Update analytics cards
        document.getElementById('analyticsFarms').textContent = adminData.farms.length;
        document.getElementById('analyticsHectares').textContent = 
            adminData.farms.reduce((sum, f) => sum + f.hectares, 0);
        document.getElementById('analyticsWorkers').textContent = 
            adminData.farms.reduce((sum, f) => sum + f.workers, 0);
        
        const uniqueCrops = [...new Set(adminData.farms.map(f => f.crop_type))];
        document.getElementById('analyticsCrops').textContent = uniqueCrops.length;
        
        // TODO: Initialize charts using Chart.js
        initializeAnalyticsCharts();
        
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

/**
 * Initialize analytics charts
 */
function initializeAnalyticsCharts() {
    // TODO: Implement Chart.js charts
    console.log('Analytics charts would be initialized here');
}

/**
 * Setup form handlers
 */
function setupFormHandlers() {
    const transferForm = document.getElementById('createTransferForm');
    if (transferForm) {
        transferForm.addEventListener('submit', handleCreateTransfer);
    }
    
    const roleFilter = document.getElementById('userRoleFilter');
    if (roleFilter) {
        roleFilter.addEventListener('change', handleUserRoleFilter);
    }
}

/**
 * Handle create transfer form
 */
function handleCreateTransfer(e) {
    e.preventDefault();
    
    const formData = {
        resource_type: document.getElementById('transferResourceType').value,
        from_farm: document.getElementById('transferFromFarm').value,
        to_farm: document.getElementById('transferToFarm').value,
        return_date: document.getElementById('transferReturnDate').value
    };
    
    if (!formData.resource_type || !formData.from_farm || !formData.to_farm) {
        showNotification('Please fill in all required fields', 'warning');
        return;
    }
    
    console.log('Creating transfer:', formData);
    // TODO: API call to create transfer
    showNotification('Transfer created successfully', 'success');
    e.target.reset();
}

/**
 * Handle user role filter
 */
function handleUserRoleFilter(e) {
    const role = e.target.value;
    let filteredUsers = adminData.users;
    
    if (role) {
        filteredUsers = adminData.users.filter(u => u.role === role);
    }
    
    renderUsersTable(filteredUsers);
}

/**
 * Submit farm form
 */
function submitFarmForm() {
    const form = document.getElementById('addFarmForm');
    const formData = new FormData(form);
    
    const farmData = {
        name: formData.get('name'),
        location: formData.get('location'),
        region: formData.get('region'),
        hectares: parseFloat(formData.get('hectares')),
        crop_type: formData.get('crop_type'),
        manager_id: formData.get('manager_id'),
        status: formData.get('status') || 'active',
        notes: formData.get('notes')
    };
    
    console.log('Creating farm:', farmData);
    // TODO: API call to create farm
    showNotification('Farm created successfully', 'success');
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('addFarmModal'));
    modal.hide();
    form.reset();
    loadFarms();
}

/**
 * Submit user form
 */
function submitUserForm() {
    const form = document.getElementById('addUserForm');
    const formData = new FormData(form);
    
    const userData = {
        first_name: formData.get('first_name'),
        last_name: formData.get('last_name'),
        email: formData.get('email'),
        role: formData.get('role'),
        farm_access: Array.from(document.getElementById('userFarmAccessSelect').selectedOptions).map(o => o.value)
    };
    
    console.log('Creating user:', userData);
    // TODO: API call to create user
    showNotification('User created successfully', 'success');
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
    modal.hide();
    form.reset();
    loadUsers();
}

/**
 * Submit crop type form
 */
function submitCropTypeForm() {
    const form = document.getElementById('addCropTypeForm');
    const formData = new FormData(form);
    
    const standards = [];
    document.querySelectorAll('input[name="standards"]:checked').forEach(cb => {
        standards.push(cb.value);
    });
    
    const cropData = {
        name: formData.get('name'),
        category: formData.get('category'),
        compliance_standards: standards
    };
    
    console.log('Creating crop type:', cropData);
    // TODO: API call to create crop type
    showNotification('Crop type created successfully', 'success');
    
    const modal = bootstrap.Modal.getInstance(document.getElementById('addCropTypeModal'));
    modal.hide();
    form.reset();
    loadCropTypes();
}

/**
 * Edit farm
 */
function editFarm(farmId) {
    console.log('Edit farm:', farmId);
    // TODO: Implement farm editing
    showNotification('Farm editing coming soon', 'info');
}

/**
 * View farm details
 */
function viewFarmDetails(farmId) {
    console.log('View farm details:', farmId);
    // TODO: Implement farm details view
    showNotification('Farm details view coming soon', 'info');
}

/**
 * Edit user
 */
function editUser(userId) {
    console.log('Edit user:', userId);
    // TODO: Implement user editing
    showNotification('User editing coming soon', 'info');
}

/**
 * Manage user permissions
 */
function manageUserPermissions(userId) {
    console.log('Manage permissions for user:', userId);
    // TODO: Implement permissions management
    showNotification('Permissions management coming soon', 'info');
}

/**
 * Edit crop type
 */
function editCropType(cropId) {
    console.log('Edit crop type:', cropId);
    // TODO: Implement crop type editing
    showNotification('Crop type editing coming soon', 'info');
}

/**
 * View varieties
 */
function viewVarieties(cropId) {
    console.log('View varieties for crop:', cropId);
    // TODO: Implement varieties view
    showNotification('Varieties view coming soon', 'info');
}

/**
 * Show notification
 */
function showNotification(message, type = 'info') {
    if (typeof _common !== 'undefined') {
        switch(type) {
            case 'success':
                _common.showSuccessToast(message);
                break;
            case 'error':
                _common.showErrorToast(message);
                break;
            case 'warning':
                _common.showWarningToast(message);
                break;
            default:
                _common.showInfoToast(message);
        }
    } else if (typeof Swal !== 'undefined') {
        const iconMap = {
            'success': 'success',
            'error': 'error',
            'warning': 'warning',
            'info': 'info'
        };
        
        Swal.fire({
            icon: iconMap[type] || 'info',
            title: type.charAt(0).toUpperCase() + type.slice(1),
            text: message,
            timer: type === 'error' ? 5000 : 3000,
            showConfirmButton: type === 'error',
            toast: type !== 'error',
            position: type === 'error' ? 'center' : 'top-end'
        });
    } else {
        console.log(`[${type.toUpperCase()}]`, message);
        alert(message);
    }
}

// Auto-initialize when loaded via router
if (typeof window !== 'undefined') {
    console.log('Admin Grid module script loaded');
}
