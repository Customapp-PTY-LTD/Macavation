/**
 * Role-Based Workflow Views
 * Implements Process-Driven Design: Role-Based Workflow Views
 * Provides "My Day" dashboards personalized per role
 */

var _workflowViews = function () {
    return {
        /**
         * Get user's role
         */
        getUserRole: function () {
            const userInfo = localStorage.getItem('user_info');
            if (!userInfo) return null;
            
            try {
                const user = JSON.parse(userInfo);
                return user.role_name || user.role || null;
            } catch (e) {
                return null;
            }
        },

        /**
         * Get workflow tasks for current user's role
         */
        getWorkflowTasks: async function (role = null) {
            const userRole = role || this.getUserRole();
            if (!userRole) return [];

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const tasks = await dataFunctions.callFunction('get_workflow_tasks', {
                        p_role: userRole
                    }, null, {
                        cacheKey: `workflow_tasks_${userRole}`,
                        useCache: true,
                        cacheTtl: 60000 // 1 minute
                    });
                    return tasks || [];
                }
                return [];
            } catch (error) {
                console.error('Error getting workflow tasks:', error);
                return [];
            }
        },

        /**
         * Get "My Day" dashboard data
         */
        getMyDayData: async function () {
            const role = this.getUserRole();
            if (!role) return null;

            try {
                const [tasks, watching, dueItems, recentActivity] = await Promise.all([
                    this.getWorkflowTasks(role),
                    this.getWatchingItems(role),
                    this.getDueItems(role),
                    this.getRecentActivity(role)
                ]);

                return {
                    role: role,
                    tasks: tasks,
                    watching: watching,
                    dueItems: dueItems,
                    recentActivity: recentActivity,
                    timestamp: new Date().toISOString()
                };
            } catch (error) {
                console.error('Error getting My Day data:', error);
                return null;
            }
        },

        /**
         * Get "Watching" items (proactive intelligence)
         */
        getWatchingItems: async function (role = null) {
            const userRole = role || this.getUserRole();
            if (!userRole) return [];

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const items = await dataFunctions.callFunction('get_watching_items', {
                        p_role: userRole
                    }, null, {
                        cacheKey: `watching_items_${userRole}`,
                        useCache: true,
                        cacheTtl: 120000 // 2 minutes
                    });
                    return items || [];
                }
                return [];
            } catch (error) {
                console.error('Error getting watching items:', error);
                return [];
            }
        },

        /**
         * Get due items for role
         */
        getDueItems: async function (role = null) {
            const userRole = role || this.getUserRole();
            if (!userRole) return [];

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const items = await dataFunctions.callFunction('get_due_items', {
                        p_role: userRole
                    }, null, {
                        cacheKey: `due_items_${userRole}`,
                        useCache: true,
                        cacheTtl: 60000 // 1 minute
                    });
                    return items || [];
                }
                return [];
            } catch (error) {
                console.error('Error getting due items:', error);
                return [];
            }
        },

        /**
         * Get recent activity for role
         */
        getRecentActivity: async function (role = null) {
            const userRole = role || this.getUserRole();
            if (!userRole) return [];

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const activity = await dataFunctions.callFunction('get_recent_activity_by_role', {
                        p_role: userRole,
                        p_limit: 10
                    }, null, {
                        cacheKey: `recent_activity_${userRole}`,
                        useCache: true,
                        cacheTtl: 30000 // 30 seconds
                    });
                    return activity || [];
                }
                return [];
            } catch (error) {
                console.error('Error getting recent activity:', error);
                return [];
            }
        },

        /**
         * Render "My Day" dashboard
         */
        renderMyDay: function (data, containerId) {
            const container = document.getElementById(containerId);
            if (!container || !data) return;

            const { role, tasks, watching, dueItems, recentActivity } = data;

            const html = `
                <div class="my-day-dashboard">
                    <div class="my-day-header mb-4">
                        <h2 class="mb-1">Good ${this.getTimeOfDay()}, ${this.getUserName()}</h2>
                        <p class="text-muted mb-0">${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
                        <span class="badge bg-primary mt-2">${role}</span>
                    </div>

                    <div class="row g-4">
                        <!-- Today's Workflow -->
                        <div class="col-lg-8">
                            <div class="card">
                                <div class="card-header bg-primary text-white">
                                    <h5 class="mb-0">
                                        <i class="bi bi-list-check me-2"></i>
                                        Today's Workflow
                                    </h5>
                                </div>
                                <div class="card-body">
                                    ${this.renderWorkflowTasks(tasks)}
                                </div>
                            </div>
                        </div>

                        <!-- Due This Period -->
                        <div class="col-lg-4">
                            <div class="card">
                                <div class="card-header bg-warning text-dark">
                                    <h5 class="mb-0">
                                        <i class="bi bi-calendar-event me-2"></i>
                                        Due This Period
                                    </h5>
                                </div>
                                <div class="card-body">
                                    ${this.renderDueItems(dueItems)}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row g-4 mt-2">
                        <!-- Watching (Proactive Intelligence) -->
                        <div class="col-lg-6">
                            <div class="card">
                                <div class="card-header bg-info text-white">
                                    <h5 class="mb-0">
                                        <i class="bi bi-eye me-2"></i>
                                        Watching
                                    </h5>
                                </div>
                                <div class="card-body">
                                    ${this.renderWatchingItems(watching)}
                                </div>
                            </div>
                        </div>

                        <!-- Recent Activity -->
                        <div class="col-lg-6">
                            <div class="card">
                                <div class="card-header">
                                    <h5 class="mb-0">
                                        <i class="bi bi-clock-history me-2"></i>
                                        Recent Activity
                                    </h5>
                                </div>
                                <div class="card-body">
                                    ${this.renderRecentActivity(recentActivity)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            container.innerHTML = html;
        },

        /**
         * Render workflow tasks
         */
        renderWorkflowTasks: function (tasks) {
            if (!tasks || tasks.length === 0) {
                return '<p class="text-muted text-center py-4">No tasks scheduled for today. Great job!</p>';
            }

            return `
                <div class="workflow-tasks">
                    ${tasks.map(task => `
                        <div class="workflow-task task-${task.status}" data-task-id="${task.id}">
                            <div class="task-checkbox">
                                <input type="checkbox" ${task.status === 'completed' ? 'checked' : ''} 
                                       onchange="workflowViews.toggleTask('${task.id}', this.checked)">
                            </div>
                            <div class="task-content">
                                <div class="task-time">${task.scheduled_time || ''}</div>
                                <div class="task-description">${task.description || task.title}</div>
                                ${task.context ? `<div class="task-context text-muted small">${task.context}</div>` : ''}
                            </div>
                            <div class="task-actions">
                                ${task.action_url ? `
                                    <button class="btn btn-sm btn-primary" onclick="workflowViews.executeTask('${task.id}', '${task.action_url}')">
                                        ${task.action_label || 'Action'}
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            `;
        },

        /**
         * Render due items
         */
        renderDueItems: function (items) {
            if (!items || items.length === 0) {
                return '<p class="text-muted text-center py-2">Nothing due. All caught up!</p>';
            }

            return `
                <ul class="list-unstyled mb-0">
                    ${items.map(item => `
                        <li class="due-item ${item.is_overdue ? 'overdue' : ''} mb-3">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <strong>${item.title}</strong>
                                    <div class="text-muted small">${item.description || ''}</div>
                                    <div class="text-muted small">
                                        <i class="bi bi-calendar me-1"></i>
                                        ${item.due_date ? new Date(item.due_date).toLocaleDateString() : 'No due date'}
                                    </div>
                                </div>
                                ${item.action_url ? `
                                    <button class="btn btn-sm btn-outline-primary" onclick="workflowViews.handleDueItem('${item.id}', '${item.action_url}')">
                                        View
                                    </button>
                                ` : ''}
                            </div>
                        </li>
                    `).join('')}
                </ul>
            `;
        },

        /**
         * Render watching items
         */
        renderWatchingItems: function (items) {
            if (!items || items.length === 0) {
                return '<p class="text-muted text-center py-2">No items being watched at this time.</p>';
            }

            return `
                <ul class="list-unstyled mb-0">
                    ${items.map(item => `
                        <li class="watching-item mb-3">
                            <div class="d-flex justify-content-between align-items-start">
                                <div>
                                    <strong>${item.title}</strong>
                                    <div class="text-muted small">${item.insight || item.description}</div>
                                    ${item.trend ? `
                                        <div class="trend-indicator mt-1">
                                            <i class="bi ${item.trend > 0 ? 'bi-arrow-up text-success' : item.trend < 0 ? 'bi-arrow-down text-danger' : 'bi-dash text-muted'}"></i>
                                            <span class="small">${Math.abs(item.trend)}% ${item.trend_period || ''}</span>
                                        </div>
                                    ` : ''}
                                </div>
                                ${item.action_url ? `
                                    <button class="btn btn-sm btn-outline-info" onclick="workflowViews.handleWatchingItem('${item.id}', '${item.action_url}')">
                                        View
                                    </button>
                                ` : ''}
                            </div>
                        </li>
                    `).join('')}
                </ul>
            `;
        },

        /**
         * Render recent activity
         */
        renderRecentActivity: function (activities) {
            if (!activities || activities.length === 0) {
                return '<p class="text-muted text-center py-2">No recent activity.</p>';
            }

            return `
                <ul class="list-unstyled mb-0">
                    ${activities.map(activity => `
                        <li class="activity-item mb-3">
                            <div class="d-flex align-items-start">
                                <div class="activity-icon me-2">
                                    <i class="bi ${this.getActivityIcon(activity.type)}"></i>
                                </div>
                                <div class="flex-grow-1">
                                    <div class="activity-description">${activity.description || activity.title}</div>
                                    <div class="text-muted small">
                                        ${activity.timestamp ? new Date(activity.timestamp).toLocaleString() : ''}
                                    </div>
                                </div>
                            </div>
                        </li>
                    `).join('')}
                </ul>
            `;
        },

        /**
         * Get activity icon
         */
        getActivityIcon: function (type) {
            const iconMap = {
                'create': 'bi-plus-circle',
                'update': 'bi-pencil',
                'delete': 'bi-trash',
                'complete': 'bi-check-circle',
                'approve': 'bi-check2-square',
                'reject': 'bi-x-circle',
                'comment': 'bi-chat',
                'upload': 'bi-upload'
            };
            return iconMap[type] || 'bi-circle';
        },

        /**
         * Get time of day greeting
         */
        getTimeOfDay: function () {
            const hour = new Date().getHours();
            if (hour < 12) return 'morning';
            if (hour < 17) return 'afternoon';
            return 'evening';
        },

        /**
         * Get user name
         */
        getUserName: function () {
            const userInfo = localStorage.getItem('user_info');
            if (!userInfo) return 'User';
            
            try {
                const user = JSON.parse(userInfo);
                return user.first_name || user.username || user.email || 'User';
            } catch (e) {
                return 'User';
            }
        },

        /**
         * Toggle task completion
         */
        toggleTask: async function (taskId, completed) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    await dataFunctions.callFunction('update_workflow_task', {
                        p_task_id: taskId,
                        p_status: completed ? 'completed' : 'pending'
                    }, null, { useCache: false });
                    
                    // Refresh workflow view
                    const data = await this.getMyDayData();
                    this.renderMyDay(data, 'my-day-container');
                }
            } catch (error) {
                console.error('Error toggling task:', error);
            }
        },

        /**
         * Execute task action
         */
        executeTask: function (taskId, actionUrl) {
            if (actionUrl && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                const route = actionUrl.startsWith('#') ? actionUrl.substring(1) : actionUrl;
                _appRouter.loadContent(route);
            }
        },

        /**
         * Handle due item
         */
        handleDueItem: function (itemId, actionUrl) {
            if (actionUrl && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                const route = actionUrl.startsWith('#') ? actionUrl.substring(1) : actionUrl;
                _appRouter.loadContent(route);
            }
        },

        /**
         * Handle watching item
         */
        handleWatchingItem: function (itemId, actionUrl) {
            if (actionUrl && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                const route = actionUrl.startsWith('#') ? actionUrl.substring(1) : actionUrl;
                _appRouter.loadContent(route);
            }
        }
    };
}();

// Create global instance
const workflowViews = _workflowViews;
window.workflowViews = workflowViews;

