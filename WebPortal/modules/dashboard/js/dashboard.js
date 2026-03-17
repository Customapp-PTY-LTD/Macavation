/**
 * Dashboard Module
 * Main entry: reads user role and directs to the correct dashboard (executive, amanda, or default).
 * All dashboard HTML/JS/CSS live under this module.
 * Pattern: IIFE, single global _dashboard, arrow methods, const scope for same-module calls.
 */
var _dashboard = function () {
    'use strict';

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    /** Update exceptions card header: green when no exceptions, red when there are */
    const updateExceptionsHeaderState = (hasExceptions) => {
        const $header = $('#exceptionsContainer').closest('.card').find('.card-header.dashboard-exceptions-header');
        if ($header.length) {
            $header.toggleClass('dashboard-exceptions-header--clear', !hasExceptions);
        }
    };

    /** Role name (normalized lowercase) -> data-access section key */
    const roleToDashboardSection = {
        'super admin': 'executive',
        'admin': 'executive',
        'executive': 'executive',
        'super_user': 'executive',
        'general manager': 'executive',
        'production manager': 'executive',
        'qa supervisor': 'executive',
        'oil plant manager': 'executive',
        'office administrator': 'executive',
        'pwa sales': 'executive',
        'pwa finance': 'executive',
        'pallandium integrator': 'pallandium-integrator',
        'material journey': 'pallandium-integrator'
    };

    const routeAddButtonMap = {
        'crm-grid': 'addContactBtn',
        'grower-intake-grid': 'addSampleBtn',
        'kernel-production-grid': 'addBatchBtn',
        'quality-assurance-grid': 'addTestBtn',
        'stock-management-grid': 'addStockBtn',
        'document-management-grid': 'uploadDocBtn'
    };

    return {
        data: null,

        /**
         * Get current user role. Prefers roleMenuConfig (same source as menu access) then auth/Session.
         * @returns {string} Normalized role name (lowercase) or empty string
         */
        getUserRole: () => {
            let role = '';
            if (typeof roleMenuConfig !== 'undefined' && roleMenuConfig.getUserRole) {
                const r = roleMenuConfig.getUserRole();
                role = (r != null && String(r).trim()) ? String(r).trim() : '';
            }
            if (!role && typeof authService !== 'undefined' && authService.getUserRole) {
                const r = authService.getUserRole();
                role = (r && String(r).trim()) ? String(r).trim() : '';
            }
            if (!role) {
                try {
                    const user = Session.get('user');
                    if (user) role = (user.role_name || user.role || '').trim();
                } catch (e) { /* ignore */ }
            }
            return role ? String(role).toLowerCase() : '';
        },

        init: async () => {
            const scope = _dashboard;
            const role = scope.getUserRole();
            // Unified model: all roles with dashboard access see the executive (unified) dashboard unless they are Material Journey.
            let section = roleToDashboardSection[role];
            if (!section && role) {
                // New roles not in the map get the unified (executive) dashboard
                section = 'executive';
            }
            if (!section && typeof roleMenuConfig !== 'undefined' && roleMenuConfig.hasAccess && roleMenuConfig.hasAccess('executive-dashboard')) {
                section = 'executive';
            }
            if (!section) section = 'default';

            // Show only the section for this role, hide all others (use d-none for consistency)
            document.querySelectorAll('[data-access]').forEach(function (el) {
                var sectionAttr = el.getAttribute('data-access');
                if (sectionAttr === section) {
                    el.classList.remove('d-none');
                } else {
                    el.classList.add('d-none');
                }
            });

            // Delegate to role-specific sub-init (it handles its own data loading)
            if (section === 'pallandium-integrator') {
                if (typeof _amandaDashboard !== 'undefined' && _amandaDashboard.init) {
                    await _amandaDashboard.init();
                }
                return;
            }
            if (section === 'executive') {
                if (typeof _executiveDashboard !== 'undefined' && _executiveDashboard.init) {
                    await _executiveDashboard.init();
                }
                return;
            }

            // Default dashboard – if user exists but role/featureKeys weren't ready yet (e.g. after login), re-check and switch to executive/amanda when they become available
            const user = Session.get('user');
            if (user && !role) {
                const recheckSection = () => {
                    const r = scope.getUserRole();
                    let sec = roleToDashboardSection[r];
                    if (!sec && r) sec = 'executive';
                    if (!sec && typeof roleMenuConfig !== 'undefined' && roleMenuConfig.hasAccess && roleMenuConfig.hasAccess('executive-dashboard')) sec = 'executive';
                    if (!sec) sec = 'default';
                    if (sec === 'default') return;
                    document.querySelectorAll('[data-access]').forEach(function (el) {
                        var sectionAttr = el.getAttribute('data-access');
                        el.classList.toggle('d-none', sectionAttr !== sec);
                    });
                    if (sec === 'executive' && typeof _executiveDashboard !== 'undefined' && _executiveDashboard.init) {
                        _executiveDashboard.init();
                    } else if (sec === 'pallandium-integrator' && typeof _amandaDashboard !== 'undefined' && _amandaDashboard.init) {
                        _amandaDashboard.init();
                    }
                };
                window.addEventListener('featureKeysUpdated', recheckSection, { once: true });
                setTimeout(recheckSection, 800);
                setTimeout(recheckSection, 2000);
            }

            // Default dashboard
            try {
                if (typeof waitForDataFunctions === 'function') {
                    try {
                        await waitForDataFunctions(50, 100);
                    } catch (error) {
                        console.error('dataFunctions not available:', error);
                        throw new Error('Data functions not available');
                    }
                } else if (typeof dataFunctions === 'undefined') {
                    await delay(500);
                    if (typeof dataFunctions === 'undefined') {
                        throw new Error('dataFunctions is not available');
                    }
                }

                scope.setCurrentDate();
                scope.initHandlers();
                try {
                    await scope.loadDashboardData();
                } catch (error) {
                    console.error('Error loading dashboard data:', error);
                }
                await scope.loadKernelStats();
                await scope.loadExceptions();
                await scope.loadMetrics();
                scope.loadQuickActions();
                scope.loadAlerts();
                scope.loadStats();
                scope.loadRecentActivity();
                if ($('#upcomingTasksList').length) await scope.loadUpcomingTasks();
            } catch (error) {
                console.error('Error initializing Dashboard:', error);
                const $container = $('#content-area');
                if ($container.length) {
                    $container.html(`
                        <div class="alert alert-danger" role="alert">
                            <h4 class="alert-heading">Error Loading Dashboard</h4>
                            <p>There was an error initializing the dashboard. Please refresh the page.</p>
                            <hr>
                            <p class="mb-0"><small>Error: ${error.message}</small></p>
                        </div>
                    `);
                }
            }
        },

        initHandlers: () => {
            const scope = _dashboard;
            $(document).on('click', '[data-dashboard-route][data-dashboard-action]', function (e) {
                e.preventDefault();
                const $btn = $(this);
                scope.handleQuickAction($btn.data('dashboard-route'), $btn.data('dashboard-action'));
            });
        },

        setCurrentDate: () => {
            const now = new Date();
            const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            const dateString = now.toLocaleDateString('en-US', options);
            $('#currentDate').text(dateString);
        },

        loadKernelStats: async () => {
            const $batches = $('#statBatchesInProduction');
            const $crackToday = $('#statKgCrackedToday');
            const $crackWeek = $('#statKgCrackedWeek');
            const $packToday = $('#statKgPackedToday');
            const $packWeek = $('#statKgPackedWeek');
            const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-ZA', { maximumFractionDigits: 0 }) : (n || 0));
            if (!$batches.length && !$crackToday.length && !$packToday.length) return;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getDashboardKernelStats) {
                    $batches.text('0');
                    $crackToday.text('0');
                    $crackWeek.text('0');
                    $packToday.text('0');
                    $packWeek.text('0');
                    return;
                }
                const stats = await dataFunctions.getDashboardKernelStats();
                if ($batches.length) $batches.text(Number(stats.batches_in_production) || 0);
                if ($crackToday.length) $crackToday.text(fmt(stats.kg_cracked_today));
                if ($crackWeek.length) $crackWeek.text(fmt(stats.kg_cracked_week));
                if ($packToday.length) $packToday.text(fmt(stats.kg_packed_today));
                if ($packWeek.length) $packWeek.text(fmt(stats.kg_packed_week));
            } catch (error) {
                console.error('Error loading kernel stats:', error);
                if ($batches.length) $batches.text('—');
                if ($crackToday.length) $crackToday.text('—');
                if ($crackWeek.length) $crackWeek.text('—');
                if ($packToday.length) $packToday.text('—');
                if ($packWeek.length) $packWeek.text('—');
            }
        },

        loadExceptions: async () => {
            const $container = $('#exceptionsContainer');
            if (!$container.length) return;
            try {
                if (typeof anomalyDetection === 'undefined' || !anomalyDetection.getActiveAnomalies) {
                    console.error('anomalyDetection.getActiveAnomalies is not available');
                    $container.html('<div class="alert alert-info">Exception detection not available.</div>');
                    updateExceptionsHeaderState(false);
                    return;
                }
                const exceptions = await anomalyDetection.getActiveAnomalies();
                const hasExceptions = exceptions && exceptions.length > 0;
                if (typeof exceptionUI !== 'undefined' && exceptionUI.renderExceptionPanel) {
                    exceptionUI.renderExceptionPanel(exceptions, 'exceptionsContainer');
                } else {
                    if (hasExceptions) {
                        $container.html(exceptions.map(e => `
                            <div class="alert alert-${e.severity === 'critical' ? 'danger' : e.severity === 'warning' ? 'warning' : 'info'}">
                                <strong>${e.title}:</strong> ${e.description}
                            </div>
                        `).join(''));
                    } else {
                        $container.html('<div class="alert alert-success">No exceptions at this time. All systems operating normally.</div>');
                    }
                }
                updateExceptionsHeaderState(hasExceptions);
            } catch (error) {
                console.error('Error loading exceptions:', error);
                $container.html('<div class="alert alert-warning">Unable to load exceptions. Please try again later.</div>');
                updateExceptionsHeaderState(true);
            }
        },

        loadMetrics: async () => {
            const $container = $('#metricsContainer');
            if (!$container.length) return;
            try {
                if (typeof dataFunctions === 'undefined') {
                    $container.html('<div class="alert alert-info">Metrics not available.</div>');
                    return;
                }
                const kpis = await dataFunctions.getExecutiveKPIs().catch(() => ({}));
                const batches = await dataFunctions.getProductionBatches().catch(() => []);
                const stockItems = await dataFunctions.getStockItems().catch(() => []);
                const qualityRate = kpis.quality_pass_rate != null ? Number(kpis.quality_pass_rate) : 0;
                const totalKg = kpis.total_production_kg != null ? Number(kpis.total_production_kg) : 0;
                // No fake trend when data is zero; pass trend: null so "vs. last month" is not shown
                const metrics = [
                    {
                        title: 'Quality Pass Rate',
                        value: qualityRate,
                        unit: '%',
                        target: 95,
                        current: qualityRate,
                        trend: null,
                        trendPeriod: 'vs. last month',
                        icon: 'bi-check-circle',
                        color: qualityRate >= 95 ? 'success' : qualityRate >= 80 ? 'warning' : 'danger',
                        actionUrl: 'quality-assurance-grid'
                    },
                    {
                        title: 'Total Production',
                        value: totalKg,
                        unit: 'kg',
                        target: 50000,
                        current: totalKg,
                        trend: null,
                        trendPeriod: 'vs. last month',
                        icon: 'bi-graph-up',
                        color: 'info',
                        actionUrl: 'kernel-production-grid'
                    }
                ];
        
        if (typeof metricUI !== 'undefined' && metricUI.renderMetricPanel) {
            metricUI.renderMetricPanel(metrics, 'metricsContainer');
        } else {
            // Fallback rendering
            $container.html(`
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
            `);
        }
            } catch (error) {
                console.error('Error loading metrics:', error);
                $container.html('<div class="alert alert-warning">Unable to load metrics. Please try again later.</div>');
            }
        },

        loadQuickActions: () => {
            const $container = $('#quickActionsContainer');
            if (!$container.length) return;
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
            $container.html(quickActions.map(action => `
                <div class="col-md-4 col-lg-2">
                    <button class="btn btn-${action.color} w-100 quick-action-btn"
                            data-dashboard-route="${action.route}"
                            data-dashboard-action="${action.action}"
                            style="height: 100px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem;">
                        <i class="bi ${action.icon} fs-3"></i>
                        <span>${action.label}</span>
                    </button>
                </div>
            `).join(''));
        },

        handleQuickAction: (route, action) => {
            if (typeof _appRouter === 'undefined' || (!_appRouter.loadContent && !_appRouter.routeTo)) {
                console.error('AppRouter not available');
                if (typeof _common !== 'undefined' && _common.showErrorToast) _common.showErrorToast('Unable to navigate to module');
                return;
            }
            const navigatePromise = typeof _appRouter.routeTo === 'function'
                ? Promise.resolve(_appRouter.routeTo(route))
                : _appRouter.loadContent(route);
            navigatePromise.then(() => {
                if (action === 'add') {
                    const buttonId = routeAddButtonMap[route];
                    let $addBtn = buttonId ? $('#' + buttonId) : $();
                    if (!$addBtn.length) {
                        const commonIds = ['addContactBtn', 'addSampleBtn', 'addBatchBtn', 'addTestBtn', 'addStockBtn', 'addDocumentBtn', 'addBtn'];
                        for (const id of commonIds) {
                            $addBtn = $('#' + id);
                            if ($addBtn.length) break;
                        }
                    }
                    if (!$addBtn.length) {
                        $addBtn = $('[id*="add"][id*="Btn"].btn-primary').length ? $('[id*="add"][id*="Btn"].btn-primary').first() : $('[id$="Btn"].btn-primary').first();
                    }
                    if ($addBtn.length) setTimeout(() => $addBtn.trigger('click'), 300);
                    else console.warn('Could not find add button for route: ' + route);
                }
            }).catch((error) => {
                console.error('Error navigating to module:', error);
                if (typeof _common !== 'undefined' && _common.showErrorToast) _common.showErrorToast('Error navigating to module');
            });
        },

        loadDashboardData: async () => {
            const scope = _dashboard;
            try {
                scope.data = {
            company: {
                name: 'Macavation',
                description: 'Premium Macadamia Management System'
            }
        };
            } catch (error) {
                console.error('Error loading dashboard data:', error);
                scope.showErrorMessage('Failed to load dashboard data');
                scope.data = { company: { name: 'Macavation', description: 'Premium Macadamia Management System' } };
            }
        },

        loadAlerts: async () => {
    const $container = $('#alertsContainer');
    if (!$container.length) return;
    
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getDashboardAlerts) {
            console.error('dataFunctions.getDashboardAlerts is not available');
            $container.html('<div class="col-12"><div class="alert alert-info">Unable to load alerts.</div></div>');
            return;
        }
        
        const alerts = await dataFunctions.getDashboardAlerts(null);
        
        if (alerts && alerts.length > 0) {
            $container.html(alerts.map(alert => {
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
            }).join(''));
        } else {
            $container.html('<div class="col-12"><div class="alert alert-info">No alerts at this time.</div></div>');
        }
            } catch (error) {
                console.error('Error loading alerts:', error);
                $container.html('<div class="col-12"><div class="alert alert-warning">Unable to load alerts. Please try again later.</div></div>');
            }
        },

        loadStats: async () => {
            const $container = $('#statsContainer');
            if (!$container.length) return;
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
                $container.html(stats.map(stat => `
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
        `).join(''));
            } catch (error) {
                console.error('Error loading stats:', error);
                $container.html('<div class="col-12"><div class="alert alert-warning">Unable to load statistics. Please try again later.</div></div>');
            }
        },

        loadRecentActivity: async () => {
            const scope = _dashboard;
            const $container = $('#recentActivityList');
            if (!$container.length) return;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getRecentActivity) {
            console.error('dataFunctions.getRecentActivity is not available');
            $container.html('<div class="text-center text-muted py-4"><p>Unable to load activity</p></div>');
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
                $container.html('<div class="text-center text-muted py-4"><p>Please log in to view recent activity</p></div>');
                return;
            }
            throw error; // Re-throw if it's a different error
        }
        
        if (activities && activities.length > 0) {
            const iconMap = {
                'crm': { icon: 'bi-person-fill', class: 'primary' },
                'production': { icon: 'bi-gear-fill', class: 'info' },
                'quality': { icon: 'bi-shield-check', class: 'success' },
                'stock': { icon: 'bi-box-seam', class: 'warning' },
                'sales': { icon: 'bi-graph-up', class: 'primary' },
                'financial': { icon: 'bi-cash-stack', class: 'success' },
                'document': { icon: 'bi-file-earmark', class: 'secondary' },
                'grower': { icon: 'bi-truck', class: 'info' },
                'oil': { icon: 'bi-droplet-fill', class: 'warning' }
            };
            
            $container.html(activities.map(activity => {
                const iconInfo = iconMap[activity.module] || { icon: 'bi-circle', class: 'info' };
                const timeAgo = scope.formatTimeAgo(activity.created_at);
                
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
            }).join(''));
        } else {
            $container.html('<div class="text-center text-muted py-4"><p>No recent activity</p></div>');
        }
            } catch (error) {
                console.error('Error loading recent activity:', error);
                $container.html('<div class="text-center text-muted py-4"><p>Loading activity...</p></div>');
            }
        },

        formatTimeAgo: (timestamp) => {
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
        },

        loadUpcomingTasks: async () => {
            const $container = $('#upcomingTasksList');
            if (!$container.length) return;
            try {
                if (typeof workflowViews !== 'undefined' && workflowViews.getTasksForRole) {
            // Get current user's role (you may need to get this from auth service)
                const userRole = 'user';
                const tasks = await workflowViews.getTasksForRole(userRole);
                if (tasks && tasks.length > 0) {
                    const upcomingTasks = tasks.slice(0, 5);
                    $container.html(upcomingTasks.map(task => {
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
                    }).join(''));
                } else {
                    $container.html('<li class="text-center text-muted py-4"><p>No upcoming tasks</p></li>');
                }
            } else {
                $container.html('<li class="text-center text-muted py-4"><p>No upcoming tasks</p></li>');
            }
            } catch (error) {
                console.error('Error loading upcoming tasks:', error);
                $container.html('<li class="text-center text-muted py-4"><p>No upcoming tasks</p></li>');
            }
        },

        showErrorMessage: (message) => {
            if (typeof _common !== 'undefined' && _common.showErrorToast) {
                _common.showErrorToast(message);
            } else if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Error', text: message, timer: 5000, showConfirmButton: true });
            } else {
                console.error(message);
                alert('Error: ' + message);
            }
        }
    };
}();

// Expose for app router: initializeModule('dashboard') calls this when loading dashboard (first load or nav from sidenav).
window.initializeDashboard = function () {
    if (typeof _dashboard !== 'undefined' && _dashboard.init) {
        _dashboard.init();
    }
};

