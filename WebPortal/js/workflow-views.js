/**
 * Role-Based Workflow Views
 * Implements Process-Driven Design: Role-Based Workflow Views
 * Provides "My Day" dashboards personalized per role
 */

var _workflowViews = function () {
    // Red count bubble on a menu link's icon (styles: css/workflow-views.css .mac-task-badge).
    function setIconBadge(a, n) {
        var icon = a.querySelector('i.fas, i.far');
        if (!icon) return;
        var anchor = icon.parentElement.classList.contains('mac-icon-badge-anchor') ? icon.parentElement : null;
        if (!anchor) {
            anchor = document.createElement('span');
            anchor.className = 'mac-icon-badge-anchor';
            icon.parentNode.insertBefore(anchor, icon);
            anchor.appendChild(icon);
        }
        var badge = anchor.querySelector('.mac-task-badge');
        if (!n) { if (badge) badge.remove(); return; }
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'mac-task-badge';
            anchor.appendChild(badge);
        }
        badge.textContent = n > 99 ? '99+' : String(n);
        badge.setAttribute('aria-label', n + ' task' + (n === 1 ? '' : 's') + ' waiting');
    }

    return {
        /**
         * Get user's role
         */
        getUserRole: function () {
            const user = Session.get('user');
            if (!user) return null;
            return user.role_name || user.role || null;
        },

        /**
         * Get workflow tasks for current user's role
         */
        getWorkflowTasks: async function (role = null) {
            const userRole = role || this.getUserRole();
            if (!userRole) return [];

            // Role tasks (migration 20261027130000): a role's open tasks; super_user gets every role's.
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const res = await dataFunctions.callFunction('get_role_tasks', { p_role: userRole }, null, { useCache: false });
                    const body = res && res.data !== undefined ? res.data : res;
                    if (body && body.success !== false && Array.isArray(body.tasks)) {
                        this._lastTasks = body.tasks;
                        return body.tasks;
                    }
                }
            } catch (e) {
                console.warn('get_role_tasks unavailable, falling back to get_workflow_tasks:', e);
            }

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
         * Client-side work queue from live batch data (exception-first sections).
         */
        buildClientWorkQueue: async function () {
            var sections = {
                intake: [],
                production: [],
                stockDispatch: []
            };
            if (typeof _dataFunctions === 'undefined' || !_dataFunctions.getKernelBatches) {
                return sections;
            }
            try {
                var intakeRows = await _dataFunctions.getKernelBatches(null, false, { status: 'intake,receiving', limit: 80 });
                (intakeRows || []).forEach(function (b) {
                    if (typeof BatchStatus === 'undefined') return;
                    var d = BatchStatus.getDisplayStatus(b);
                    if (d.bucket !== 'grower') return;
                    var route = BatchStatus.getKernelRouteForStatus(d);
                    sections.intake.push({
                        id: 'ki-' + b.id,
                        batch: b.batch_number || b.id,
                        status: d.label,
                        route: route.route,
                        search: b.batch_number || '',
                        searchInputId: route.searchInputId,
                        actionLabel: 'Do now'
                    });
                });
                var prodRows = await _dataFunctions.getKernelBatches(null, false, { status: 'production,qa', limit: 80 });
                (prodRows || []).forEach(function (b) {
                    if (typeof BatchStatus === 'undefined') return;
                    var d = BatchStatus.getProductionKanbanStatus(b);
                    if (d.filterValue === 'release_ready') {
                        sections.production.push({
                            id: 'kp-' + b.id,
                            batch: b.batch_number || b.id,
                            status: d.label,
                            route: 'kernel-production-grid',
                            search: b.batch_number || '',
                            searchInputId: 'searchBatchesInput',
                            actionLabel: 'Open production'
                        });
                    } else if (d.filterValue === 'awaiting_test') {
                        sections.production.push({
                            id: 'kp-test-' + b.id,
                            batch: b.batch_number || b.id,
                            status: d.label,
                            route: 'kernel-production-grid',
                            search: b.batch_number || '',
                            searchInputId: 'searchBatchesInput',
                            actionLabel: 'End sample'
                        });
                    }
                });
                var stockRows = await _dataFunctions.getKernelBatches(null, false, { status: 'complete', limit: 80 });
                (stockRows || []).forEach(function (b) {
                    if (typeof BatchStatus === 'undefined') return;
                    var d = BatchStatus.getDisplayStatus(b);
                    if (d.value !== 'stock') return;
                    sections.stockDispatch.push({
                        id: 'ks-' + b.id,
                        batch: b.batch_number || b.id,
                        status: d.label,
                        route: 'stock-management-kernel',
                        search: b.batch_number || '',
                        searchInputId: null,
                        actionLabel: 'Open stock'
                    });
                });
            } catch (e) {
                console.warn('[My Day] buildClientWorkQueue failed', e);
            }
            return sections;
        },

        renderWorkQueueSection: function (title, items, emptyText) {
            if (!items || !items.length) {
                return '<p class="text-muted small mb-0">' + (emptyText || 'Nothing here.') + '</p>';
            }
            return '<ul class="list-group list-group-flush">' + items.slice(0, 8).map(function (item) {
                return '<li class="list-group-item d-flex justify-content-between align-items-center px-0">'
                    + '<div><strong>' + (item.batch || '—') + '</strong>'
                    + '<div class="small text-muted">' + (item.status || '') + '</div></div>'
                    + '<button type="button" class="btn btn-sm btn-outline-primary js-myday-work-action"'
                    + ' data-route="' + (item.route || '') + '"'
                    + ' data-search="' + (item.search || '').replace(/"/g, '&quot;') + '"'
                    + ' data-search-input="' + (item.searchInputId || '') + '">'
                    + (item.actionLabel || 'Do now') + '</button></li>';
            }).join('') + '</ul>';
        },

        bindWorkQueueActions: function () {
            var self = this;
            document.querySelectorAll('.js-myday-work-action').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    var route = btn.getAttribute('data-route');
                    var search = btn.getAttribute('data-search') || '';
                    var searchInputId = btn.getAttribute('data-search-input') || null;
                    if (typeof HandoffDialog !== 'undefined' && route) {
                        HandoffDialog.navigateToRoute(route, search, searchInputId || undefined);
                    } else if (typeof _appRouter !== 'undefined' && _appRouter.routeTo && route) {
                        _appRouter.routeTo(route);
                    }
                });
            });
        },

        /**
         * Get "My Day" dashboard data
         */
        getMyDayData: async function () {
            const role = this.getUserRole();
            if (!role) return null;

            try {
                const [tasks, watching, dueItems, recentActivity, workQueue] = await Promise.all([
                    this.getWorkflowTasks(role),
                    this.getWatchingItems(role),
                    this.getDueItems(role),
                    this.getRecentActivity(role),
                    this.buildClientWorkQueue()
                ]);

                this.updateTaskBadge(tasks);
                return {
                    role: role,
                    tasks: tasks,
                    watching: watching,
                    dueItems: dueItems,
                    recentActivity: recentActivity,
                    workQueue: workQueue,
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

            const { tasks, watching, dueItems, recentActivity, workQueue } = data;
            var wq = workQueue || { intake: [], production: [], stockDispatch: [] };

            var openCount = (tasks || []).filter(function (t) { return !t.is_snoozed; }).length;
            var countPill = openCount
                ? '<span class="badge rounded-pill bg-danger ms-2">' + openCount + ' waiting</span>' : '';

            // Tasks first and full width: they are what the person has to act on (Henry, 27 Oct 2026).
            const html = `
                <div class="my-day-dashboard">
                    <div class="card mb-4 my-day-tasks-card${openCount ? ' has-tasks' : ''}">
                        <div class="card-header d-flex flex-wrap align-items-center gap-2">
                            <h4 class="mb-0"><i class="fas fa-list-check me-2"></i>Your tasks</h4>${countPill}
                            <span class="small text-muted ms-auto">Things waiting for you to do. Each new one also shows in the bell.</span>
                        </div>
                        <div class="card-body">
                            ${this.renderWorkflowTasks(tasks)}
                        </div>
                    </div>

                    <div class="row g-4 mb-2">
                        <div class="col-lg-4">
                            <div class="card h-100">
                                <div class="card-header">
                                    <h5 class="mb-0"><i class="fas fa-inbox me-2"></i>Intake waiting</h5>
                                </div>
                                <div class="card-body">${this.renderWorkQueueSection('Intake', wq.intake, 'No intake batches need attention.')}</div>
                            </div>
                        </div>
                        <div class="col-lg-4">
                            <div class="card h-100">
                                <div class="card-header">
                                    <h5 class="mb-0"><i class="fas fa-gears me-2"></i>Production waiting</h5>
                                </div>
                                <div class="card-body">${this.renderWorkQueueSection('Production', wq.production, 'No production actions queued.')}</div>
                            </div>
                        </div>
                        <div class="col-lg-4">
                            <div class="card h-100">
                                <div class="card-header">
                                    <h5 class="mb-0"><i class="fas fa-warehouse me-2"></i>Stock &amp; dispatch</h5>
                                </div>
                                <div class="card-body">${this.renderWorkQueueSection('Stock', wq.stockDispatch, 'No stock handoffs queued.')}</div>
                            </div>
                        </div>
                    </div>

                    <div class="row g-4 mt-2">
                        <div class="col-lg-4">
                            <div class="card h-100">
                                <div class="card-header">
                                    <h5 class="mb-0"><i class="fas fa-calendar-day me-2"></i>Due This Period</h5>
                                </div>
                                <div class="card-body">${this.renderDueItems(dueItems)}</div>
                            </div>
                        </div>
                        <div class="col-lg-4">
                            <div class="card h-100">
                                <div class="card-header">
                                    <h5 class="mb-0"><i class="fas fa-eye me-2"></i>Watching</h5>
                                </div>
                                <div class="card-body">${this.renderWatchingItems(watching)}</div>
                            </div>
                        </div>
                        <div class="col-lg-4">
                            <div class="card h-100">
                                <div class="card-header">
                                    <h5 class="mb-0"><i class="fas fa-clock-rotate-left me-2"></i>Recent Activity</h5>
                                </div>
                                <div class="card-body">${this.renderRecentActivity(recentActivity)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            container.innerHTML = html;
            this.bindWorkQueueActions();
        },

        /**
         * Render workflow tasks
         */
        _esc: function (v) {
            return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        },

        _fmtNum: function (n, dp) {
            var x = Number(n);
            if (!isFinite(x)) return '';
            // Same style as the rest of the portal: 15,420 and 321.43 (en-ZA would give 321,43).
            return x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
        },

        // "27 Oct 12:05"
        _fmtWhen: function (iso) {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            var M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            var p = function (n) { return (n < 10 ? '0' : '') + n; };
            return p(d.getDate()) + ' ' + M[d.getMonth()] + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
        },

        /**
         * Render workflow tasks. Every DB string goes through _esc. Transport-rate tasks are closed by
         * entering the rate (no tick box). super_user sees every role's tasks, labelled with the role.
         */
        renderWorkflowTasks: function (tasks) {
            if (!tasks || tasks.length === 0) {
                return '<p class="text-muted text-center py-4">No tasks waiting. Great job!</p>';
            }
            var self = this, esc = this._esc.bind(this);
            var isSuper = this.getUserRole() === 'super_user';

            return '<div class="workflow-tasks">' + tasks.map(function (task) {
                var id = esc(task.id);
                var rolePill = isSuper && task.role
                    ? ' <span class="badge bg-light text-dark border ms-1">For: ' + esc(task.role) + '</span>' : '';
                var snoozed = task.is_snoozed
                    ? ' <span class="badge bg-warning-subtle text-dark border ms-1">Snoozed until ' + esc(self._fmtWhen(task.snoozed_until)) + '</span>' : '';

                if (task.kind === 'transport_rate') {
                    var meta = [task.supplier, task.transporter ? task.transporter + (task.transport_type ? ' (' + task.transport_type + ')' : '') : null,
                        task.delivery_note ? 'delivery note ' + task.delivery_note : null].filter(Boolean).join(' · ');
                    var sub = [task.pallets != null ? task.pallets + ' pallets' : null,
                        task.weighed_kg != null ? self._fmtNum(task.weighed_kg, 0) + ' kg' : null,
                        task.captured_at ? 'captured ' + self._fmtWhen(task.captured_at) : null].filter(Boolean).join(' · ');
                    return '<div class="workflow-task task-transport-rate" data-task-id="' + id + '">' +
                        '<div class="task-content">' +
                        '<div class="task-description fw-semibold">Enter transport rate · ' + esc(task.batch_number || '') + rolePill + snoozed + '</div>' +
                        '<div class="task-context small">' + esc(meta) + '</div>' +
                        '<div class="task-context text-muted small">' + esc(sub) + '</div>' +
                        '</div><div class="task-actions d-flex gap-2">' +
                        (task.is_snoozed ? '' : '<button type="button" class="btn btn-outline-secondary" onclick="workflowViews.snoozeTask(\'' + id + '\')" title="Hide until tomorrow 07:00">Snooze</button>') +
                        '<button type="button" class="btn btn-primary" onclick="workflowViews.enterTransportRate(\'' + id + '\')">Enter rate</button>' +
                        '</div></div>';
                }

                return '<div class="workflow-task task-' + esc(task.status) + '" data-task-id="' + id + '">' +
                    '<div class="task-checkbox"><input type="checkbox" aria-label="Done" ' + (task.status === 'completed' ? 'checked' : '') +
                    ' onchange="workflowViews.toggleTask(\'' + id + '\', this.checked)"></div>' +
                    '<div class="task-content">' +
                    '<div class="task-time">' + esc(task.scheduled_time || '') + '</div>' +
                    '<div class="task-description">' + esc(task.description || task.title) + rolePill + snoozed + '</div>' +
                    (task.context ? '<div class="task-context text-muted small">' + esc(task.context) + '</div>' : '') +
                    '</div><div class="task-actions">' +
                    (task.action_url ? '<button class="btn btn-sm btn-primary me-1" onclick="workflowViews.executeTask(\'' + id + '\', \'' +
                        esc(task.action_url) + '\')">' + esc(task.action_label || 'Action') + '</button>' : '') +
                    '<div class="btn-group" role="group">' +
                    (task.is_snoozed ? '' : '<button type="button" class="btn btn-sm btn-outline-secondary" onclick="workflowViews.snoozeTask(\'' + id + '\')" title="Hide until tomorrow 07:00"><i class="fas fa-clock"></i></button>') +
                    '<button type="button" class="btn btn-sm btn-outline-danger" onclick="workflowViews.dismissTask(\'' + id + '\')" title="Dismiss task"><i class="fas fa-xmark"></i></button>' +
                    '</div></div></div>';
            }).join('') + '</div>';
        },

        /**
         * Enter the transport rate for a delivery task. Saving stores it on the delivery and closes the task.
         */
        enterTransportRate: async function (taskId) {
            var self = this, esc = this._esc.bind(this);
            var task = (this._lastTasks || []).filter(function (t) { return String(t.id) === String(taskId); })[0];
            if (!task || typeof Swal === 'undefined') return;
            var pallets = Number(task.pallets) || 0, kg = Number(task.weighed_kg) || 0;
            var row = function (k, v) { return '<dt class="col-5 text-muted fw-normal">' + k + '</dt><dd class="col-7 mb-1">' + esc(v || '—') + '</dd>'; };
            var result = await Swal.fire({
                title: 'Transport rate · ' + (task.batch_number || ''),
                html: '<dl class="row small text-start bg-light rounded p-2 mx-0 mb-3">' +
                    row('Supplier', task.supplier) +
                    row('Transporter', task.transporter ? task.transporter + (task.transport_type ? ' (' + task.transport_type + ')' : '') : '') +
                    row('Delivery note', task.delivery_note) +
                    row('Pallets · weighed', (pallets || '—') + ' · ' + (kg ? self._fmtNum(kg, 0) + ' kg' : '—')) + '</dl>' +
                    '<div class="text-start"><label for="wvRateZar" class="form-label fw-semibold">Transport Rate (R, whole trip)</label>' +
                    '<input type="number" id="wvRateZar" class="form-control" min="0" step="0.01" placeholder="e.g. 4500"></div>' +
                    '<div class="row text-start mt-3 g-2"><div class="col-6"><div class="small text-muted">Rate per pallet</div><strong id="wvRatePallet">—</strong></div>' +
                    '<div class="col-6"><div class="small text-muted">Rate per kg</div><strong id="wvRateKg">—</strong></div></div>',
                showCancelButton: true,
                confirmButtonText: 'Save rate',
                cancelButtonText: 'Cancel',
                focusConfirm: false,
                didOpen: function () {
                    var input = document.getElementById('wvRateZar');
                    input.focus();
                    input.addEventListener('input', function () {
                        var r = parseFloat(input.value);
                        var ok = input.value !== '' && isFinite(r) && r >= 0;
                        document.getElementById('wvRatePallet').textContent = ok && pallets > 0 ? 'R ' + self._fmtNum(r / pallets, 2) : '—';
                        document.getElementById('wvRateKg').textContent = ok && kg > 0 ? 'R ' + self._fmtNum(r / kg, 2) : '—';
                    });
                },
                preConfirm: async function () {
                    var raw = document.getElementById('wvRateZar').value;
                    var r = parseFloat(raw);
                    if (raw === '' || !isFinite(r) || r < 0) {
                        Swal.showValidationMessage('Enter the rate for the whole trip. Use 0 only if transport was free.');
                        return false;
                    }
                    try {
                        var res = await dataFunctions.callFunction('set_transport_rate', { p_kernel_id: task.kernel_id, p_rate_zar: r }, null, { useCache: false });
                        var body = res && res.data !== undefined ? res.data : res;
                        if (!body || body.success === false) throw new Error((body && body.error) || 'Could not save the rate.');
                        return r;
                    } catch (e) {
                        Swal.showValidationMessage(e.message || String(e));
                        return false;
                    }
                }
            });
            if (!result.isConfirmed) return;
            if (dataFunctions.clearCachePattern) { dataFunctions.clearCachePattern('kernel_batch'); }
            Swal.fire({ icon: 'success', title: 'Rate saved', text: 'R ' + this._fmtNum(result.value, 2) + ' saved for ' + (task.batch_number || 'this delivery') + '.',
                timer: 2500, showConfirmButton: false, toast: true, position: 'top-end' });
            await this.refreshMyDay();
        },

        /** Re-render My Day (if open) and the menu badge. */
        refreshMyDay: async function () {
            var data = await this.getMyDayData();
            if (document.getElementById('my-day-container')) this.renderMyDay(data, 'my-day-container');
        },

        /**
         * Count badge on the My Day menu link: open, un-snoozed tasks for the user's role
         * (super_user: all roles).
         */
        updateTaskBadge: function (tasks) {
            var link = document.querySelector('.nav-item[data-route="my-day"] > a');
            if (!link) return;
            var n = (tasks || []).filter(function (t) { return !t.is_snoozed; }).length;
            // The My Day link (a top-level item now), plus the folding group's link if it is ever put
            // back inside one, so the bubble still shows when that group is folded.
            var links = [link];
            var group = link.closest('.collapse');
            var groupLink = group && group.id
                ? document.querySelector('#sidebarMenu [data-bs-target="#' + group.id + '"]') : null;
            if (groupLink) links.push(groupLink);
            links.forEach(function (a) { setIconBadge(a, n); });
        },

        refreshTaskBadge: async function () {
            try { this.updateTaskBadge(await this.getWorkflowTasks()); } catch (e) { /* badge is a convenience */ }
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
                                        <i class="fas fa-calendar me-1"></i>
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
                                        <i class="fas fa-check"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-secondary" 
                                            onclick="workflowViews.snoozeDueItem('${item.id}')" 
                                            title="Snooze for 1 day">
                                        <i class="fas fa-clock"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-danger" 
                                            onclick="workflowViews.dismissDueItem('${item.id}')" 
                                            title="Dismiss">
                                        <i class="fas fa-xmark"></i>
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
                                        <i class="fas fa-clock"></i>
                                    </button>
                                    <button type="button" class="btn btn-sm btn-outline-danger" 
                                            onclick="workflowViews.dismissWatchingItem('${item.id}')" 
                                            title="Stop watching">
                                        <i class="fas fa-xmark"></i>
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
                                        ${activity.activity_timestamp || activity.timestamp ? new Date(activity.activity_timestamp || activity.timestamp).toLocaleString() : ''}
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
         * Render My Day summary for the header dropdown (at-a-glance).
         */
        renderMyDayDropdownSummary: function (data) {
            if (!data) return '<p class="text-muted small mb-0">Unable to load. <a href="#" route="my-day">Open My Day</a></p>';
            var role = data.role || '';
            var tasks = data.tasks || [];
            var dueItems = data.dueItems || [];
            var watching = data.watching || [];
            var recentActivity = data.recentActivity || [];
            var taskCount = Array.isArray(tasks) ? tasks.length : 0;
            var dueCount = Array.isArray(dueItems) ? dueItems.length : 0;
            var watchCount = Array.isArray(watching) ? watching.length : 0;
            var recent = Array.isArray(recentActivity) ? recentActivity.slice(0, 3) : [];
            var lines = [];
            lines.push('<div class="my-day-summary mb-2">');
            if (role) lines.push('<span class="badge bg-primary mb-2">' + (role.replace(/_/g, ' ')) + '</span>');
            lines.push('<div class="d-flex flex-wrap gap-2 small mb-2">');
            lines.push('<span class="text-muted"><i class="fas fa-list-check me-1"></i>' + taskCount + ' tasks</span>');
            lines.push('<span class="text-muted"><i class="fas fa-calendar-check me-1"></i>' + dueCount + ' due</span>');
            lines.push('<span class="text-muted"><i class="fas fa-eye me-1"></i>' + watchCount + ' watching</span>');
            lines.push('</div>');
            if (recent.length > 0) {
                lines.push('<div class="recent-activity-summary small">');
                lines.push('<div class="text-muted mb-1">Recent activity</div>');
                recent.forEach(function (a) {
                    var desc = (a.description || a.title || '').toString().slice(0, 50);
                    if ((a.description || a.title || '').length > 50) desc += '…';
                    var ts = a.activity_timestamp || a.timestamp;
                    var timeStr = ts ? (function () { var d = new Date(ts); var n = (Date.now() - d) / 60000; if (n < 60) return Math.round(n) + 'm ago'; if (n < 1440) return Math.round(n / 60) + 'h ago'; return Math.round(n / 1440) + 'd ago'; })() : '';
                    lines.push('<div class="d-flex justify-content-between align-items-start mb-1"><span class="me-2">' + desc + '</span><span class="text-muted">' + timeStr + '</span></div>');
                });
                lines.push('</div>');
            } else {
                lines.push('<p class="text-muted small mb-0">No recent activity.</p>');
            }
            lines.push('</div>');
            return lines.join('');
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
         * Snooze a task: hidden from its role until tomorrow 07:00, then it comes back by itself.
         * super_user still sees it, marked "Snoozed until …". (The old version sent a time that
         * update_workflow_task never accepted, so it always failed.)
         */
        snoozeTask: async function (taskId) {
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.callFunction) {
                    const until = new Date();
                    until.setDate(until.getDate() + 1);
                    until.setHours(7, 0, 0, 0);

                    const res = await dataFunctions.callFunction('snooze_workflow_task', {
                        p_task_id: taskId,
                        p_until: until.toISOString()
                    }, null, { useCache: false });
                    const body = res && res.data !== undefined ? res.data : res;
                    if (!body || body.success === false) throw new Error((body && body.error) || 'Could not snooze the task.');

                    await this.refreshMyDay();

                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Task Snoozed',
                            text: 'It will come back tomorrow at 07:00.',
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

