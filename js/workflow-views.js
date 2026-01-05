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
                                    <button class="btn btn-sm btn-primary me-1" onclick="workflowViews.executeTask('${task.id}', '${task.action_url}')">
                                        ${task.action_label || 'Action'}
                                    </button>
                                ` : ''}
                                <div class="btn-group" role="group">
                                    <button type="button" class="btn btn-sm btn-outline-secondary" 
                                            onclick="workflowViews.snoozeTask('${task.id}')" 
                                            title="Snooze for 1 hour">
                                        <i class="bi bi-clock"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-danger" 
                                            onclick="workflowViews.dismissTask('${task.id}')" 
                                            title="Dismiss task">
                                        <i class="bi bi-x"></i>
                                    </button>
                                </div>
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
                                <div class="flex-grow-1">
                                    <strong>${item.title}</strong>
                                    <div class="text-muted small">${item.description || ''}</div>
                                    <div class="text-muted small">
                                        <i class="bi bi-calendar me-1"></i>
                                        ${item.due_date ? new Date(item.due_date).toLocaleDateString() : 'No due date'}
                                    </div>
                                </div>
                                <div class="btn-group ms-2" role="group">
                                    ${item.action_url ? `
                                        <button class="btn btn-sm btn-outline-primary" onclick="workflowViews.handleDueItem('${item.id}', '${item.action_url}')">
                                            View
                                        </button>
                                    ` : ''}
                                    <button type="button" class="btn btn-sm btn-outline-success" 
                                            onclick="workflowViews.completeDueItem('${item.id}')" 
                                            title="Mark as complete">
                                        <i class="bi bi-check"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" 
                                            onclick="workflowViews.snoozeDueItem('${item.id}')" 
                                            title="Snooze for 1 day">
                                        <i class="bi bi-clock"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-danger" 
                                            onclick="workflowViews.dismissDueItem('${item.id}')" 
                                            title="Dismiss">
                                        <i class="bi bi-x"></i>
                                    </button>
                                </div>
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
                                <div class="flex-grow-1">
                                    <strong>${item.title}</strong>
                                    <div class="text-muted small">${item.insight || item.description}</div>
                                    ${item.trend ? `
                                        <div class="trend-indicator mt-1">
                                            <i class="bi ${item.trend > 0 ? 'bi-arrow-up text-success' : item.trend < 0 ? 'bi-arrow-down text-danger' : 'bi-dash text-muted'}"></i>
                                            <span class="small">${Math.abs(item.trend)}% ${item.trend_period || ''}</span>
                                        </div>
                                    ` : ''}
                                </div>
                                <div class="btn-group ms-2" role="group">
                                    ${item.action_url ? `
                                        <button class="btn btn-sm btn-outline-info" onclick="workflowViews.handleWatchingItem('${item.id}', '${item.action_url}')">
                                            View
                                        </button>
                                    ` : ''}
                                    <button type="button" class="btn btn-sm btn-outline-secondary" 
                                            onclick="workflowViews.snoozeWatchingItem('${item.id}')" 
                                            title="Snooze for 1 day">
                                        <i class="bi bi-clock"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-danger" 
                                            onclick="workflowViews.dismissWatchingItem('${item.id}')" 
                                            title="Stop watching">
                                        <i class="bi bi-x"></i>
                                    </button>
                                </div>
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
        },

        /**
         * Snooze a task for 1 hour
         */
        snoozeTask: async function (taskId) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    // Calculate new scheduled time (1 hour from now)
                    const now = new Date();
                    const snoozeTime = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour
                    const timeString = snoozeTime.toTimeString().slice(0, 5); // HH:MM format
                    
                    await dataFunctions.callFunction('update_workflow_task', {
                        p_task_id: taskId,
                        p_status: 'pending',
                        p_scheduled_time: timeString
                    }, null, { useCache: false });
                    
                    // Refresh workflow view
                    const data = await this.getMyDayData();
                    this.renderMyDay(data, 'my-day-container');
                    
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Task Snoozed',
                            text: 'Task will reappear in 1 hour',
                            timer: 2000,
                            showConfirmButton: false,
                            toast: true,
                            position: 'top-end'
                        });
                    }
                }
            } catch (error) {
                console.error('Error snoozing task:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to snooze task: ' + error.message
                    });
                }
            }
        },

        /**
         * Dismiss a task (mark as dismissed)
         */
        dismissTask: async function (taskId) {
            try {
                if (typeof Swal !== 'undefined') {
                    const result = await Swal.fire({
                        title: 'Dismiss Task?',
                        text: 'This task will be removed from your view. You can still access it from the main module.',
                        icon: 'question',
                        showCancelButton: true,
                        confirmButtonText: 'Yes, dismiss',
                        cancelButtonText: 'Cancel'
                    });

                    if (!result.isConfirmed) return;
                }

                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    await dataFunctions.callFunction('update_workflow_task', {
                        p_task_id: taskId,
                        p_status: 'dismissed'
                    }, null, { useCache: false });
                    
                    // Refresh workflow view
                    const data = await this.getMyDayData();
                    this.renderMyDay(data, 'my-day-container');
                    
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Task Dismissed',
                            timer: 2000,
                            showConfirmButton: false,
                            toast: true,
                            position: 'top-end'
                        });
                    }
                }
            } catch (error) {
                console.error('Error dismissing task:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to dismiss task: ' + error.message
                    });
                }
            }
        },

        /**
         * Complete a due item
         */
        completeDueItem: async function (itemId) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    await dataFunctions.callFunction('update_due_item', {
                        p_item_id: itemId,
                        p_status: 'completed'
                    }, null, { useCache: false });
                    
                    // Refresh workflow view
                    const data = await this.getMyDayData();
                    this.renderMyDay(data, 'my-day-container');
                    
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Item Completed',
                            timer: 2000,
                            showConfirmButton: false,
                            toast: true,
                            position: 'top-end'
                        });
                    }
                }
            } catch (error) {
                console.error('Error completing due item:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to complete item: ' + error.message
                    });
                }
            }
        },

        /**
         * Snooze a due item for 1 day
         */
        snoozeDueItem: async function (itemId) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    const dateString = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD
                    
                    await dataFunctions.callFunction('update_due_item', {
                        p_item_id: itemId,
                        p_due_date: dateString
                    }, null, { useCache: false });
                    
                    // Refresh workflow view
                    const data = await this.getMyDayData();
                    this.renderMyDay(data, 'my-day-container');
                    
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Item Snoozed',
                            text: 'Item will reappear tomorrow',
                            timer: 2000,
                            showConfirmButton: false,
                            toast: true,
                            position: 'top-end'
                        });
                    }
                }
            } catch (error) {
                console.error('Error snoozing due item:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to snooze item: ' + error.message
                    });
                }
            }
        },

        /**
         * Dismiss a due item
         */
        dismissDueItem: async function (itemId) {
            try {
                if (typeof Swal !== 'undefined') {
                    const result = await Swal.fire({
                        title: 'Dismiss Item?',
                        text: 'This item will be removed from your view.',
                        icon: 'question',
                        showCancelButton: true,
                        confirmButtonText: 'Yes, dismiss',
                        cancelButtonText: 'Cancel'
                    });

                    if (!result.isConfirmed) return;
                }

                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    await dataFunctions.callFunction('update_due_item', {
                        p_item_id: itemId,
                        p_status: 'dismissed'
                    }, null, { useCache: false });
                    
                    // Refresh workflow view
                    const data = await this.getMyDayData();
                    this.renderMyDay(data, 'my-day-container');
                    
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Item Dismissed',
                            timer: 2000,
                            showConfirmButton: false,
                            toast: true,
                            position: 'top-end'
                        });
                    }
                }
            } catch (error) {
                console.error('Error dismissing due item:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to dismiss item: ' + error.message
                    });
                }
            }
        },

        /**
         * Snooze a watching item for 1 day
         */
        snoozeWatchingItem: async function (itemId) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    // Temporarily deactivate the item (will be reactivated by system after period)
                    // Note: The database function will handle snooze logic
                    await dataFunctions.callFunction('update_watching_item', {
                        p_item_id: itemId,
                        p_is_active: false
                    }, null, { useCache: false });
                    
                    // Refresh workflow view
                    const data = await this.getMyDayData();
                    this.renderMyDay(data, 'my-day-container');
                    
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Item Snoozed',
                            text: 'Item will reappear tomorrow',
                            timer: 2000,
                            showConfirmButton: false,
                            toast: true,
                            position: 'top-end'
                        });
                    }
                }
            } catch (error) {
                console.error('Error snoozing watching item:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to snooze item: ' + error.message
                    });
                }
            }
        },

        /**
         * Dismiss a watching item (stop watching)
         */
        dismissWatchingItem: async function (itemId) {
            try {
                if (typeof Swal !== 'undefined') {
                    const result = await Swal.fire({
                        title: 'Stop Watching?',
                        text: 'This item will be removed from your watching list.',
                        icon: 'question',
                        showCancelButton: true,
                        confirmButtonText: 'Yes, stop watching',
                        cancelButtonText: 'Cancel'
                    });

                    if (!result.isConfirmed) return;
                }

                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    await dataFunctions.callFunction('update_watching_item', {
                        p_item_id: itemId,
                        p_is_active: false
                    }, null, { useCache: false });
                    
                    // Refresh workflow view
                    const data = await this.getMyDayData();
                    this.renderMyDay(data, 'my-day-container');
                    
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Stopped Watching',
                            timer: 2000,
                            showConfirmButton: false,
                            toast: true,
                            position: 'top-end'
                        });
                    }
                }
            } catch (error) {
                console.error('Error dismissing watching item:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to stop watching: ' + error.message
                    });
                }
            }
        }
    };
}();

// Create global instance
const workflowViews = _workflowViews;
window.workflowViews = workflowViews;

