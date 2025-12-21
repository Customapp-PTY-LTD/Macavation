/**
 * Dashboard Module
 * Main dashboard with farm overview, stats, and quick access
 */

let dashboardData = null;

/**
 * Initialize Dashboard Module
 */
async function initializeDashboard() {
    try {
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
        
        // Set current date
        setCurrentDate();
        
        // Load farms and set up farm selector first (await to ensure it's ready)
        try {
            await loadFarmsAndSetupSelector();
        } catch (error) {
            console.error('Error loading farms:', error);
            // Continue anyway - dashboard can still work without farm selector
        }
        
        // Load dashboard data (will use selected farm from selector)
        try {
            await loadDashboardData();
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            // Continue with fallback data
        }
        
        // Load components (async)
        loadAlerts();
        loadStats();
        loadModules();
        loadRecentActivity();
        await loadUpcomingTasks();
    } catch (error) {
        console.error('Error initializing Dashboard:', error);
        // Show user-friendly error message
        const container = document.getElementById('content-area');
        if (container) {
            container.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <h4 class="alert-heading">Error Loading Dashboard</h4>
                    <p>There was an error initializing the dashboard. Please refresh the page.</p>
                    <hr>
                    <p class="mb-0"><small>Error: ${error.message}</small></p>
                </div>
            `;
        }
    }
}

/**
 * Set current date display
 */
function setCurrentDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const dateString = now.toLocaleDateString('en-US', options);
    
    const dateElement = document.getElementById('currentDate');
    if (dateElement) {
        dateElement.textContent = dateString;
    }
}

/**
 * Load farms and set up farm selector dropdown
 */
async function loadFarmsAndSetupSelector() {
    const farmSelector = document.getElementById('farmSelector');
    if (!farmSelector) return;
    
    try {
        // Check if dataFunctions is available
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getFarms) {
            console.error('dataFunctions.getFarms is not available');
            farmSelector.innerHTML = '<option value="">Data functions not available</option>';
            return;
        }
        
        const farmsResponse = await dataFunctions.getFarms();
        
        // Handle different response structures
        let farms = farmsResponse;
        if (farmsResponse && !Array.isArray(farmsResponse)) {
            if (farmsResponse.farms && Array.isArray(farmsResponse.farms)) {
                farms = farmsResponse.farms;
            } else if (farmsResponse.data && Array.isArray(farmsResponse.data)) {
                farms = farmsResponse.data;
            } else if (farmsResponse.result && Array.isArray(farmsResponse.result)) {
                farms = farmsResponse.result;
            } else {
                console.warn('Dashboard - Farms response is not in expected format:', farmsResponse);
                farms = [];
            }
        }
        
        if (farms && farms.length > 0) {
            // Clear loading message
            farmSelector.innerHTML = '';
            
            // Add "All Farms" option first
            const allFarmsOption = document.createElement('option');
            allFarmsOption.value = 'all';
            allFarmsOption.textContent = 'All Farms';
            farmSelector.appendChild(allFarmsOption);
            
            // Populate dropdown with individual farms
            farms.forEach(farm => {
                const option = document.createElement('option');
                option.value = farm.id;
                option.textContent = farm.name;
                farmSelector.appendChild(option);
            });
            
            // Get previously selected farm from localStorage, or use "All Farms"
            const savedFarmId = localStorage.getItem('selectedFarmId');
            let farmToSelect = 'all'; // Default to "All Farms"
            
            if (savedFarmId) {
                if (savedFarmId === 'all') {
                    farmToSelect = 'all';
                } else if (farms.find(f => f.id === savedFarmId)) {
                    farmToSelect = savedFarmId;
                }
            }
            
            farmSelector.value = farmToSelect;
            
            // Store selected farm
            localStorage.setItem('selectedFarmId', farmToSelect);
            
            // Add change event listener
            farmSelector.addEventListener('change', function() {
                const selectedValue = this.value;
                localStorage.setItem('selectedFarmId', selectedValue);
                // Reload dashboard data with new selection
                loadDashboardData().then(() => {
                    loadAlerts();
                    loadStats();
                    loadRecentActivity();
                });
            });
        } else {
            farmSelector.innerHTML = '<option value="">No farms available</option>';
        }
    } catch (error) {
        console.error('Error loading farms:', error);
        farmSelector.innerHTML = '<option value="">Error loading farms</option>';
    }
}

/**
 * Load dashboard data from API
 */
async function loadDashboardData() {
    try {
        // Get selected farm ID from localStorage or selector
        const farmSelector = document.getElementById('farmSelector');
        const selectedValue = farmSelector?.value || localStorage.getItem('selectedFarmId') || 'all';
        
        // Check if "All Farms" is selected
        if (selectedValue === 'all') {
            // For "All Farms" view, show aggregated information
            const farms = await dataFunctions.getFarms();
            
            if (farms && farms.length > 0) {
                // Calculate totals across all farms
                const totalHectares = farms.reduce((sum, farm) => sum + (parseFloat(farm.hectares) || 0), 0);
                const farmCount = farms.length;
                
                dashboardData = {
                    farm: {
                        id: null,
                        name: 'All Farms',
                        location: `${farmCount} farm${farmCount > 1 ? 's' : ''}`,
                        size: `${totalHectares.toLocaleString('en-ZA', {maximumFractionDigits: 0})} hectares total`,
                        cropType: 'Portfolio View'
                    }
                };
            } else {
                dashboardData = {
                    farm: {
                        id: null,
                        name: 'All Farms',
                        location: 'No farms available',
                        size: '0 hectares',
                        cropType: 'Portfolio View'
                    }
                };
            }
            
            // Update farm selector if it exists
            if (farmSelector) {
                farmSelector.value = 'all';
            }
            
            // Store selected value
            localStorage.setItem('selectedFarmId', 'all');
        } else {
            // Single farm view
            const farms = await dataFunctions.getFarms();
            let selectedFarm = null;
            
            if (farms && farms.length > 0) {
                selectedFarm = farms.find(f => f.id === selectedValue) || farms[0];
            }
            
            if (selectedFarm) {
                dashboardData = {
                    farm: {
                        id: selectedFarm.id,
                        name: selectedFarm.name,
                        location: selectedFarm.location || 'Location not set',
                        size: selectedFarm.hectares ? `${selectedFarm.hectares} hectares` : 'Size not set',
                        cropType: selectedFarm.crop_type || 'Not specified'
                    }
                };
                
                // Update farm selector if it exists
                if (farmSelector) {
                    farmSelector.value = selectedFarm.id;
                }
                
                // Store selected farm
                localStorage.setItem('selectedFarmId', selectedFarm.id);
            } else {
                // No farms available - use empty state
                dashboardData = {
                    farm: {
                        name: 'No Farm Selected',
                        location: 'Select a farm to view details',
                        size: 'N/A',
                        cropType: 'N/A'
                    }
                };
            }
        }
        
        // Update farm info display
        const locationElement = document.getElementById('farmLocation');
        const sizeElement = document.getElementById('farmSize');
        
        if (locationElement) {
            locationElement.textContent = dashboardData.farm.location;
        }
        if (sizeElement) {
            sizeElement.textContent = dashboardData.farm.size;
        }
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showErrorMessage('Failed to load dashboard data');
        // Use empty state on error
        dashboardData = {
            farm: {
                name: 'Error Loading Data',
                location: 'Unable to load farm information',
                size: 'N/A',
                cropType: 'Apples & Citrus'
            }
        };
    }
}

/**
 * Load and display alerts
 */
async function loadAlerts() {
    const container = document.getElementById('alertsContainer');
    if (!container) return;
    
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getDashboardAlerts) {
            console.error('dataFunctions.getDashboardAlerts is not available');
            container.innerHTML = '<div class="col-12"><div class="alert alert-info">Unable to load alerts.</div></div>';
            return;
        }
        
        // Pass null for "All Farms" view, otherwise pass the farm ID
        const farmId = dashboardData?.farm?.id || null;
        const alerts = await dataFunctions.getDashboardAlerts(farmId);
        
        if (alerts && alerts.length > 0) {
            container.innerHTML = alerts.map(alert => {
                const alertClass = alert.alert_type === 'critical' ? 'danger' : 
                                 alert.alert_type === 'warning' ? 'warning' : 'info';
                const icon = alert.alert_type === 'critical' ? 'bi-exclamation-triangle-fill' :
                            alert.alert_type === 'warning' ? 'bi-info-circle-fill' : 'bi-info-circle';
                
                return `
                    <div class="col-12">
                        <div class="alert alert-${alertClass}-custom" role="alert">
                            <strong><i class="bi ${icon} me-2"></i>${alert.title || 'Alert'}:</strong> 
                            ${alert.message} <a href="${alert.action_url || '#'}" class="alert-link">View details</a>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            container.innerHTML = '<div class="col-12"><div class="alert alert-info">No alerts at this time.</div></div>';
        }
    } catch (error) {
        console.error('Error loading alerts:', error);
        container.innerHTML = '<div class="col-12"><div class="alert alert-warning">Unable to load alerts. Please try again later.</div></div>';
    }
}

/**
 * Load and display statistics cards
 */
async function loadStats() {
    const container = document.getElementById('statsContainer');
    if (!container) return;
    
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getDashboardStats) {
            console.error('dataFunctions.getDashboardStats is not available');
            return;
        }
        
        // Pass null for "All Farms" view, otherwise pass the farm ID
        const farmId = dashboardData?.farm?.id || null;
        const statsData = await dataFunctions.getDashboardStats(farmId);
        
        const stats = [
            {
                icon: 'bi-people-fill',
                title: 'Active Workers',
                value: statsData?.active_workers || '0',
                label: 'workers today'
            },
            {
                icon: 'bi-cash-stack',
                title: 'Labour Cost',
                value: statsData?.labour_cost_week ? `R${parseFloat(statsData.labour_cost_week).toLocaleString('en-ZA', {minimumFractionDigits: 0, maximumFractionDigits: 0})}` : 'R0',
                label: 'this week'
            },
            {
                icon: 'bi-clipboard-check',
                title: 'Compliance Score',
                value: statsData?.compliance_score ? `${statsData.compliance_score}%` : 'N/A',
                label: 'Global GAP ready'
            },
            {
                icon: 'bi-droplet-fill',
                title: 'Spray Schedule',
                value: statsData?.spray_schedule_due || '0',
                label: 'applications due this week'
            }
        ];
        
        container.innerHTML = stats.map(stat => `
            <div class="col-md-6 col-lg-3">
                <div class="card stat-card">
                    <div class="card-header">
                        <i class="bi ${stat.icon} me-2"></i>${stat.title}
                    </div>
                    <div class="card-body text-center">
                        <div class="stat-value">${stat.value}</div>
                        <small class="stat-label">${stat.label}</small>
                    </div>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading stats:', error);
        container.innerHTML = '<div class="col-12"><div class="alert alert-warning">Unable to load statistics. Please try again later.</div></div>';
    }
}

/**
 * Load and display module cards
 */
function loadModules() {
    const container = document.getElementById('modulesContainer');
    if (!container) return;
    
    // Define available modules
    const modules = [
        {
            icon: 'bi-people-fill',
            title: 'Labour Allocation',
            description: 'Daily allocation, attendance, task tracking',
            route: 'labour-grid'
        },
        {
            icon: 'bi-clipboard-check',
            title: 'Compliance & Audits',
            description: 'Global GAP, Caesar audits, training certificates',
            route: 'compliance-grid'
        },
        {
            icon: 'bi-droplet-fill',
            title: 'Chemicals',
            description: 'Spray programs, inventory & compliance',
            route: 'chemicals-grid'
        },
        {
            icon: 'bi-graph-up',
            title: 'Crop Monitoring',
            description: 'Growth tracking, quality & yield forecasts',
            route: 'crops-grid'
        },
        {
            icon: 'bi-truck',
            title: 'Asset Management',
            description: 'Vehicles, fuel, equipment & inventory',
            route: 'assets-grid'
        },
        {
            icon: 'bi-box-seam',
            title: 'Post-Harvest',
            description: 'Pack season data, traceability & markets',
            route: 'postharvest-grid'
        },
        {
            icon: 'bi-water',
            title: 'Water & Irrigation',
            description: 'Water usage, pump meters & compliance',
            route: 'water-grid'
        },
        {
            icon: 'bi-gear-fill',
            title: 'System Administration',
            description: 'Farms, users, resources & permissions',
            route: 'admin-grid'
        }
    ];
    
    container.innerHTML = modules.map(module => `
        <div class="col-lg-3 col-md-6">
            <div class="card module-card" onclick="navigateToModule('${module.route}')">
                <div class="card-body text-center">
                    <i class="bi ${module.icon} module-icon"></i>
                    <h5 class="card-title mt-3 fw-bold">${module.title}</h5>
                    <p class="card-text text-muted">${module.description}</p>
                    <button class="btn btn-dashboard">Open Module</button>
                </div>
            </div>
        </div>
    `).join('');
}

/**
 * Load and display recent activity
 */
async function loadRecentActivity() {
    const container = document.getElementById('recentActivityList');
    if (!container) return;
    
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getRecentActivity) {
            console.error('dataFunctions.getRecentActivity is not available');
            container.innerHTML = '<div class="text-center text-muted py-4"><p>Unable to load activity</p></div>';
            return;
        }
        
        // Pass null for "All Farms" view, otherwise pass the farm ID
        const farmId = dashboardData?.farm?.id || null;
        const activities = await dataFunctions.getRecentActivity(farmId, 10);
        
        if (activities && activities.length > 0) {
            const iconMap = {
                'labour': { icon: 'bi-people-fill', class: 'success' },
                'compliance': { icon: 'bi-shield-check', class: 'info' },
                'chemicals': { icon: 'bi-droplet-fill', class: 'warning' },
                'crops': { icon: 'bi-graph-up', class: 'primary' },
                'assets': { icon: 'bi-truck', class: 'secondary' }
            };
            
            container.innerHTML = activities.map(activity => {
                const iconInfo = iconMap[activity.module] || { icon: 'bi-circle', class: 'info' };
                const timeAgo = formatTimeAgo(activity.created_at);
                
                return `
                    <div class="list-group-item px-0">
                        <div class="d-flex align-items-center">
                            <div class="activity-icon ${iconInfo.class} me-3">
                                <i class="bi ${iconInfo.icon}"></i>
                            </div>
                            <div class="flex-grow-1">
                                <strong>${activity.action || 'Activity'}</strong> - ${activity.description || 'No description'}
                                <br><small class="text-muted">${timeAgo}</small>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            container.innerHTML = '<div class="text-center text-muted py-4"><p>No recent activity</p></div>';
        }
    } catch (error) {
        console.error('Error loading recent activity:', error);
        // Fallback to mock data
        container.innerHTML = '<div class="text-center text-muted py-4"><p>Loading activity...</p></div>';
    }
}

/**
 * Format time ago from timestamp
 */
function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Recently';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
}

/**
 * Load and display upcoming tasks
 */
async function loadUpcomingTasks() {
    const container = document.getElementById('upcomingTasksList');
    if (!container) return;
    
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getUpcomingTasks) {
            console.error('dataFunctions.getUpcomingTasks is not available');
            container.innerHTML = '<li class="text-center text-muted py-4"><p>Unable to load tasks</p></li>';
            return;
        }
        
        // Pass null for "All Farms" view, otherwise pass the farm ID
        const farmId = dashboardData?.farm?.id || null;
        const tasks = await dataFunctions.getUpcomingTasks(farmId, 5);
        
        if (tasks && tasks.length > 0) {
            container.innerHTML = tasks.map(task => {
                const priority = task.priority || 'medium';
                const dueDate = task.due_date ? new Date(task.due_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'No due date';
                
                return `
                    <li class="task-item">
                        <span class="task-priority-dot priority-${priority}"></span>
                        <strong>${task.title || 'Task'}</strong>
                        <br><small class="text-muted">Due: ${dueDate}</small>
                    </li>
                `;
            }).join('');
        } else {
            container.innerHTML = '<li class="text-center text-muted py-4"><p>No upcoming tasks</p></li>';
        }
    } catch (error) {
        console.error('Error loading upcoming tasks:', error);
        container.innerHTML = '<li class="text-center text-muted py-4"><p>Unable to load tasks</p></li>';
    }
}

/**
 * Navigate to a module
 * Make this function globally accessible
 */
window.navigateToModule = function navigateToModule(routeName) {
    // Use appRouter if available
    if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
        // Use routeTo method if available (preferred)
        _appRouter.routeTo(routeName);
    } else if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
        _appRouter.loadContent({
            routeName: routeName,
            elementSelector: _appRouter.contentContainer || '#content-area'
        }).then(() => {
            if (typeof $ !== 'undefined') {
                $(window).scrollTop(0);
            } else {
                window.scrollTo(0, 0);
            }
            // Update session storage
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.setItem('lastActivePage', routeName);
                localStorage.setItem('lastActivePage', routeName);
            }
        }).catch(error => {
            console.error('Navigation error:', error);
        });
    } else if (typeof window.appRouter !== 'undefined' && window.appRouter.loadContent) {
        window.appRouter.loadContent({
            routeName: routeName,
            elementSelector: window.appRouter.contentContainer || '#content-area'
        });
    } else {
        console.error('AppRouter not available. Route:', routeName);
        // Fallback: try direct URL change
        if (window.location) {
            window.location.hash = '#' + routeName;
        }
    }
};

/**
 * Show error message
 */
function showErrorMessage(message) {
    if (typeof _common !== 'undefined' && _common.showErrorToast) {
        _common.showErrorToast(message);
    } else if (typeof Swal !== 'undefined') {
        Swal.fire({
            icon: 'error',
            title: 'Error',
            text: message,
            timer: 5000,
            showConfirmButton: true
        });
    } else {
        console.error(message);
        alert('Error: ' + message);
    }
}

// Auto-initialize when loaded via router
if (typeof window !== 'undefined') {
    // Module loaded and ready
}

