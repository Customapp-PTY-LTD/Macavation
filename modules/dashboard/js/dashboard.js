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
        
        // Load dashboard data
        try {
            await loadDashboardData();
        } catch (error) {
            console.error('Error loading dashboard data:', error);
            // Continue with fallback data
        }
        
        // Load Process-Driven Design components (Exception-First)
        await loadExceptions();
        await loadMetrics();
        loadQuickActions();
        
        // Load legacy components (for backward compatibility)
        loadAlerts();
        loadStats();
        loadModules();
        loadRecentActivity();
        
        // Load upcoming tasks if container exists
        const upcomingTasksContainer = document.getElementById('upcomingTasksList');
        if (upcomingTasksContainer) {
            await loadUpcomingTasks();
        }
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
 * Load dashboard data from API
 */
/**
 * Load exceptions (Exception-First Design)
 */
async function loadExceptions() {
    const container = document.getElementById('exceptionsContainer');
    if (!container) return;
    
    try {
        if (typeof anomalyDetection === 'undefined' || !anomalyDetection.getActiveAnomalies) {
            console.error('anomalyDetection.getActiveAnomalies is not available');
            container.innerHTML = '<div class="alert alert-info">Exception detection not available.</div>';
            return;
        }
        
        const exceptions = await anomalyDetection.getActiveAnomalies();
        
        if (typeof exceptionUI !== 'undefined' && exceptionUI.renderExceptionPanel) {
            exceptionUI.renderExceptionPanel(exceptions, 'exceptionsContainer');
        } else {
            // Fallback rendering
            if (exceptions && exceptions.length > 0) {
                container.innerHTML = exceptions.map(e => `
                    <div class="alert alert-${e.severity === 'critical' ? 'danger' : e.severity === 'warning' ? 'warning' : 'info'}">
                        <strong>${e.title}:</strong> ${e.description}
                    </div>
                `).join('');
            } else {
                container.innerHTML = '<div class="alert alert-success">No exceptions at this time. All systems operating normally.</div>';
            }
        }
    } catch (error) {
        console.error('Error loading exceptions:', error);
        container.innerHTML = '<div class="alert alert-warning">Unable to load exceptions. Please try again later.</div>';
    }
}

/**
 * Load context-aware metrics
 */
async function loadMetrics() {
    const container = document.getElementById('metricsContainer');
    if (!container) return;
    
    try {
        // Get KPIs and calculate metrics with context
        const kpis = await dataFunctions.getExecutiveKPIs().catch(() => ({}));
        const batches = await dataFunctions.getProductionBatches().catch(() => []);
        const stockItems = await dataFunctions.getStockItems().catch(() => []);
        
        // Calculate metrics with context
        const metrics = [
            {
                title: 'Active Batches',
                value: kpis.active_batches || 0,
                unit: 'batches',
                target: 10, // Example target
                current: kpis.active_batches || 0,
                trend: 5, // Example trend
                trendPeriod: 'vs. last week',
                icon: 'bi-box-seam',
                color: 'primary'
            },
            {
                title: 'Quality Pass Rate',
                value: kpis.quality_pass_rate || 0,
                unit: '%',
                target: 95,
                current: kpis.quality_pass_rate || 0,
                trend: -2, // Example trend
                trendPeriod: 'vs. last month',
                icon: 'bi-check-circle',
                color: kpis.quality_pass_rate >= 95 ? 'success' : kpis.quality_pass_rate >= 80 ? 'warning' : 'danger'
            },
            {
                title: 'Total Production',
                value: kpis.total_production_kg || 0,
                unit: 'kg',
                target: 50000,
                current: kpis.total_production_kg || 0,
                trend: 10,
                trendPeriod: 'vs. last month',
                icon: 'bi-graph-up',
                color: 'info'
            },
            {
                title: 'Total Sales',
                value: kpis.total_sales || 0,
                unit: 'ZAR',
                target: 1000000,
                current: kpis.total_sales || 0,
                trend: 8,
                trendPeriod: 'vs. last month',
                icon: 'bi-currency-dollar',
                color: 'success'
            }
        ];
        
        if (typeof metricUI !== 'undefined' && metricUI.renderMetricPanel) {
            metricUI.renderMetricPanel(metrics, 'metricsContainer');
        } else {
            // Fallback rendering
            container.innerHTML = `
                <div class="row g-3">
                    ${metrics.map(m => `
                        <div class="col-md-6 col-lg-3">
                            <div class="card">
                                <div class="card-body text-center">
                                    <h3>${m.value} ${m.unit}</h3>
                                    <p class="text-muted mb-0">${m.title}</p>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading metrics:', error);
        container.innerHTML = '<div class="alert alert-warning">Unable to load metrics. Please try again later.</div>';
    }
}

/**
 * Load quick actions
 */
function loadQuickActions() {
    const container = document.getElementById('quickActionsContainer');
    if (!container) return;
    
    const quickActions = [
        {
            icon: 'bi-person-plus',
            label: 'Add Contact',
            route: 'crm-grid',
            action: 'add',
            color: 'primary'
        },
        {
            icon: 'bi-clipboard-check',
            label: 'Submit Sample',
            route: 'grower-intake-grid',
            action: 'add',
            color: 'success'
        },
        {
            icon: 'bi-box-seam',
            label: 'New Batch',
            route: 'kernel-production-grid',
            action: 'add',
            color: 'info'
        },
        {
            icon: 'bi-clipboard-data',
            label: 'Quality Test',
            route: 'quality-assurance-grid',
            action: 'add',
            color: 'warning'
        },
        {
            icon: 'bi-arrow-left-right',
            label: 'Stock Movement',
            route: 'stock-management-grid',
            action: 'add',
            color: 'secondary'
        },
        {
            icon: 'bi-file-earmark-text',
            label: 'Upload Document',
            route: 'document-management-grid',
            action: 'add',
            color: 'dark'
        }
    ];
    
    container.innerHTML = quickActions.map(action => `
        <div class="col-md-4 col-lg-2">
            <button class="btn btn-${action.color} w-100 quick-action-btn" 
                    onclick="handleQuickAction('${action.route}', '${action.action}')"
                    style="height: 100px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem;">
                <i class="bi ${action.icon} fs-3"></i>
                <span>${action.label}</span>
            </button>
        </div>
    `).join('');
}

/**
 * Handle quick action
 */
function handleQuickAction(route, action) {
    if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
        _appRouter.loadContent(route);
        // Trigger action after route loads
        setTimeout(() => {
            if (action === 'add') {
                // Trigger add button click if available
                const addBtn = document.getElementById('addContactBtn') || 
                              document.getElementById('addBtn') ||
                              document.querySelector('[id$="Btn"][class*="btn-primary"]');
                if (addBtn) {
                    addBtn.click();
                }
            }
        }, 500);
    }
}

async function loadDashboardData() {
    try {
        // Dashboard data for Macadamia Management System
        dashboardData = {
            company: {
                name: 'Macavation',
                description: 'Premium Macadamia Management System'
            }
        };
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        showErrorMessage('Failed to load dashboard data');
        dashboardData = {
            company: {
                name: 'Macavation',
                description: 'Premium Macadamia Management System'
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
        
        const alerts = await dataFunctions.getDashboardAlerts(null);
        
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
        
        const statsData = await dataFunctions.getDashboardStats(null);
        
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
        
        // Try to get recent activity, but handle authentication errors gracefully
        let activities = [];
        try {
            activities = await dataFunctions.getRecentActivity(10);
        } catch (error) {
            // If authentication error, show empty state instead of error
            if (error.message && error.message.includes('token')) {
                console.warn('Authentication required for recent activity');
                container.innerHTML = '<div class="text-center text-muted py-4"><p>Please log in to view recent activity</p></div>';
                return;
            }
            throw error; // Re-throw if it's a different error
        }
        
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
 * Load and display upcoming tasks (using workflow tasks from Process-Driven Design)
 */
async function loadUpcomingTasks() {
    const container = document.getElementById('upcomingTasksList');
    if (!container) return;
    
    try {
        // Use workflow tasks from Process-Driven Design if available
        if (typeof workflowViews !== 'undefined' && workflowViews.getTasksForRole) {
            // Get current user's role (you may need to get this from auth service)
            const userRole = 'user'; // TODO: Get from auth service
            const tasks = await workflowViews.getTasksForRole(userRole);
            
            if (tasks && tasks.length > 0) {
                const upcomingTasks = tasks.slice(0, 5); // Limit to 5
                container.innerHTML = upcomingTasks.map(task => {
                    const dueDate = task.scheduled_date 
                        ? new Date(task.scheduled_date).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                        : 'No due date';
                    
                    return `
                        <li class="task-item">
                            <span class="task-priority-dot priority-medium"></span>
                            <strong>${task.title || 'Task'}</strong>
                            <br><small class="text-muted">Due: ${dueDate}</small>
                        </li>
                    `;
                }).join('');
            } else {
                container.innerHTML = '<li class="text-center text-muted py-4"><p>No upcoming tasks</p></li>';
            }
        } else {
            container.innerHTML = '<li class="text-center text-muted py-4"><p>No upcoming tasks</p></li>';
        }
    } catch (error) {
        console.error('Error loading upcoming tasks:', error);
        container.innerHTML = '<li class="text-center text-muted py-4"><p>No upcoming tasks</p></li>';
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

