/**
 * User & access hub (Admin): people, roles, menu modules, advanced DB permissions.
 * Pattern: IIFE, single global _adminGrid.
 */
var _adminGrid = function () {
    'use strict';

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function escapeHtml(text) {
        if (text == null || text === '') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /** True when the actor may delete/deactivate a role from Roles & modules. */
    function canDeleteRoleInHub() {
        if (typeof hasAction === 'function') {
            return hasAction('admin.roles.delete') || hasAction('admin.users.manage');
        }
        if (typeof dataFunctions !== 'undefined' && typeof dataFunctions.canAccessUserManagement === 'function') {
            return dataFunctions.canAccessUserManagement();
        }
        return false;
    }

    return {
        data: {
            users: [],
            roles: [],
            permissions: []
        },
        selectedRoleId: null,
        adminAllFeatures: [],
        adminRoleFeatureIdMap: {},
        adminAllPermissions: [],
        adminAllActions: [],
        adminRoleActionIdMap: {},
        adminExpandedFeatureKeys: {},
        adminCustomizePermSearch: '',
        adminFeaturesLoadSeq: 0,
        adminLoadedRoleId: null,
        _usersLoaded: false,
        _rolesLoaded: false,
        _modalsLoaded: false,
        _modalsLoading: null,
        _initToken: 0,

        waitForDataFunctionsReady: async () => {
            if (typeof dataFunctions !== 'undefined' && typeof dataFunctions.getUsers === 'function') {
                return;
            }
            if (typeof waitForDataFunctions === 'function') {
                await waitForDataFunctions(20, 50);
                return;
            }
            for (var i = 0; i < 10; i++) {
                if (typeof dataFunctions !== 'undefined' && typeof dataFunctions.getUsers === 'function') return;
                await delay(50);
            }
            throw new Error('dataFunctions is not available');
        },

        resetListState: () => {
            const scope = _adminGrid;
            scope._usersLoaded = false;
            scope._rolesLoaded = false;
            scope.data.users = [];
            scope.data.roles = [];
        },

        init: async () => {
            const scope = _adminGrid;
            if (!document.getElementById('usersTableBody')) return;
            var initToken = ++scope._initToken;
            try {
                console.log('[Admin] Initializing User & access…');
                scope.resetListState();
                scope._modalsLoaded = false;
                scope._modalsLoading = null;

                await scope.waitForDataFunctionsReady();

                var adminTab = document.getElementById('adminTab');
                if (adminTab && !adminTab.dataset.adminTabsBound) {
                    adminTab.dataset.adminTabsBound = '1';
                    adminTab.addEventListener('shown.bs.tab', function (event) {
                        var targetId = event.target.getAttribute('data-bs-target');
                        scope.handleTabSwitch(targetId);
                    });
                }

                scope.setupFormHandlersOnce();
                scope.setupRoleDetailUiOnce();
                scope.setupAddUserButtons();

                try {
                    await scope.loadUsers();
                    if (initToken !== scope._initToken) return;
                } catch (error) {
                    console.error('Error loading users:', error);
                }
                if (initToken !== scope._initToken) return;
                scope.loadRoles().catch(function (error) {
                    console.error('Error prefetching roles:', error);
                });
            } catch (error) {
                console.error('Error initializing Admin Grid:', error);
            }
        },

        ensureModalsLoaded: async () => {
            const scope = _adminGrid;
            if (scope._modalsLoaded) return;
            if (scope._modalsLoading) {
                await scope._modalsLoading;
                return;
            }
            scope._modalsLoading = (async function () {
                var loadPromises = [];
                ['addUserModal', 'addRoleModal', 'userModal', 'roleModal', 'permissionModal'].forEach(function (modalId) {
                    var el = document.getElementById(modalId);
                    if (!el) return;
                    var routeName = el.getAttribute('route-name');
                    if (routeName && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                        loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + modalId }));
                    }
                });
                try {
                    if (loadPromises.length) await Promise.all(loadPromises);
                    if (typeof _modal_admin_add_user !== 'undefined' && _modal_admin_add_user.init) _modal_admin_add_user.init();
                    if (typeof _modal_admin_add_role !== 'undefined' && _modal_admin_add_role.init) _modal_admin_add_role.init();
                    scope.wireUserModalRefresh();
                    scope._modalsLoaded = true;
                } catch (err) {
                    console.error('[Admin] Error loading modals:', err);
                    if (typeof _modal_admin_add_user !== 'undefined' && _modal_admin_add_user.init) _modal_admin_add_user.init();
                    if (typeof _modal_admin_add_role !== 'undefined' && _modal_admin_add_role.init) _modal_admin_add_role.init();
                    scope.wireUserModalRefresh();
                    scope._modalsLoaded = true;
                } finally {
                    scope._modalsLoading = null;
                }
            })();
            await scope._modalsLoading;
        },

        wireUserModalRefresh: () => {
            var el = document.getElementById('userModal');
            if (!el || typeof $ === 'undefined') return;
            $(el).off('hidden.bs.modal.adminRefresh').on('hidden.bs.modal.adminRefresh', function () {
                _adminGrid.loadUsers({ forceRefresh: true });
            });
        },

        setupAddUserButtons: () => {
            var root = document.querySelector('.admin-access-module');
            if (!root || root.dataset.addButtonsBound) return;
            root.dataset.addButtonsBound = '1';

            function openAdd(e) {
                if (e) e.preventDefault();
                _adminGrid.ensureModalsLoaded().then(function () {
                    if (typeof _modal_user !== 'undefined' && _modal_user.show) _modal_user.show(null);
                });
            }
            function prefetchModals(e) {
                if (e && e.target && e.target.closest('[data-bs-target="#addRoleModal"]')) {
                    _adminGrid.ensureModalsLoaded();
                }
            }
            root.addEventListener('click', function (e) {
                if (e.target.closest('#adminBtnAddUserTab')) openAdd(e);
                prefetchModals(e);
            });
        },

        setupRoleDetailUiOnce: () => {
            if (window.__adminGridRoleUiBound) return;
            window.__adminGridRoleUiBound = true;
            const scope = _adminGrid;
            document.addEventListener('click', function (e) {
                if (e.target.closest('#adminRefreshFeaturesBtn')) {
                    e.preventDefault();
                    if (scope.selectedRoleId) scope.loadAdminRoleFeatures(scope.selectedRoleId);
                    return;
                }
                var expandBtn = e.target.closest('.js-admin-feature-expand');
                if (expandBtn && !expandBtn.disabled) {
                    e.preventDefault();
                    scope.toggleAdminFeatureExpand(expandBtn.getAttribute('data-feature-key'));
                    return;
                }
            });
            document.addEventListener('change', function (e) {
                var t = e.target;
                if (!t || !t.classList) return;
                if (t.classList.contains('admin-feature-checkbox')) {
                    var featureId = t.getAttribute('data-feature-id');
                    var featureKey = t.getAttribute('data-feature-key');
                    scope.toggleAdminFeature(featureId, featureKey, t.checked, $(t));
                    return;
                }
                if (t.classList.contains('admin-perm-checkbox')) {
                    scope.toggleAdminPermission(t.getAttribute('data-permission-id'), t.checked, $(t));
                    return;
                }
                if (t.classList.contains('admin-action-checkbox')) {
                    scope.toggleAdminAction(t.getAttribute('data-action-id'), t.getAttribute('data-action-key'), t.checked, $(t));
                }
            });
            var searchInput = document.getElementById('adminCustomizePermSearch');
            if (searchInput) {
                searchInput.addEventListener('input', function () {
                    scope.adminCustomizePermSearch = this.value.trim();
                    scope.renderAdminFeatureRows();
                });
            }
        },

        onRoleModalHidden: () => {
            const scope = _adminGrid;
            var cust = document.getElementById('adminRoleCustomizeModal');
            if (cust && cust.classList.contains('show')) return;
            scope.selectedRoleId = null;
        },

        handleTabSwitch: (targetId) => {
            const scope = _adminGrid;
            switch (targetId) {
                case '#users':
                    if (scope._usersLoaded) {
                        scope.renderUsersFromCache();
                    } else {
                        scope.loadUsers();
                    }
                    break;
                case '#roles':
                    if (scope._rolesLoaded) {
                        scope.renderRolesTable(scope.data.roles);
                    } else {
                        scope.loadRoles();
                    }
                    break;
                default:
                    break;
            }
        },

        renderUsersFromCache: () => {
            const scope = _adminGrid;
            scope.updateRoleFilter();
            scope.applyUserFilters();
        },

        // Search + role + status filters, combined. Renders the matching subset.
        applyUserFilters: () => {
            const scope = _adminGrid;
            const searchEl = document.getElementById('userSearchInput');
            const roleEl = document.getElementById('userRoleFilter');
            const statusEl = document.getElementById('userStatusFilter');
            const q = ((searchEl && searchEl.value) || '').trim().toLowerCase();
            const role = (roleEl && roleEl.value) || '';
            const status = (statusEl && statusEl.value) || '';
            let list = scope.data.users || [];
            if (role) list = list.filter((u) => u.role === role);
            if (status) list = list.filter((u) => u.status === status);
            if (q) {
                list = list.filter((u) => {
                    const name = ((u.first_name || '') + ' ' + (u.last_name || '')).toLowerCase();
                    return name.indexOf(q) !== -1 || (u.email || '').toLowerCase().indexOf(q) !== -1;
                });
            }
            scope.renderUsersTable(list);
        },

        loadUsers: async (options) => {
            const scope = _adminGrid;
            var forceRefresh = options && options.forceRefresh === true;
            if (!forceRefresh && scope._usersLoaded) {
                scope.renderUsersFromCache();
                return;
            }
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getUsers) {
                    console.error('dataFunctions.getUsers is not available');
                    return;
                }

                const users = await dataFunctions.getUsers(null, forceRefresh);

                if (!users || users.length === 0) {
                    scope.data.users = [];
                } else {
                    scope.data.users = users.map((user) => ({
                        id: user.id,
                        first_name: user.first_name || user.email?.split('@')[0] || 'User',
                        last_name: user.last_name || '',
                        email: user.email,
                        role: user.role || user.role_name || 'user',
                        role_id: user.role_id,
                        is_active: user.is_active !== false,
                        status: user.is_active !== false ? 'active' : 'inactive',
                        phone_number: user.phone_number || null
                    }));
                }

                scope._usersLoaded = true;
                scope.renderUsersFromCache();
                if (scope._rolesLoaded) {
                    scope.renderRolesTable(scope.data.roles);
                }
            } catch (error) {
                console.error('Error loading users:', error);
                const errorMessage = error.message || error.toString() || '';
                const isPermissionError = error.status === 403 ||
                    errorMessage.includes('Access denied') ||
                    errorMessage.includes('operation EXECUTE is not allowed') ||
                    errorMessage.includes('permission');

                if (isPermissionError) {
                    scope.showNotification('You do not have permission to view users. Please contact your administrator.', 'warning');
                    scope.data.users = [];
                    scope._usersLoaded = true;
                    scope.renderUsersFromCache();
                } else {
                    scope.showNotification('Failed to load users. Please try again later.', 'error');
                }
            }
        },

        renderUsersTable: (users) => {
            const scope = _adminGrid;
            const tbody = document.getElementById('usersTableBody');
            if (!tbody) return;

            if (!users || users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No users found.</td></tr>';
                return;
            }

            tbody.innerHTML = users.map((user) => {
                const roleBadge = scope.getRoleBadge(user.role);
                const statusBadge = user.status === 'active'
                    ? '<span class="badge bg-success">Active</span>'
                    : '<span class="badge bg-secondary">Inactive</span>';
                const name = escapeHtml((user.first_name || '') + ' ' + (user.last_name || '').trim() || 'User');
                const phone = user.phone_number ? escapeHtml(user.phone_number) : '';
                const email = escapeHtml(user.email || '');
                return `
        <tr class="js-admin-user-row" data-user-id="${escapeHtml(String(user.id))}">
            <td>
                <strong>${name}</strong>
                ${phone ? `<br><small class="text-muted">${phone}</small>` : ''}
            </td>
            <td>${email}</td>
            <td>${roleBadge}</td>
            <td>${statusBadge}</td>
            <td class="mac-table-actions-col">${MacTableActions.render({
                wrapLi: true,
                items: [{
                    label: 'Edit user',
                    icon: 'fas fa-pen me-2',
                    attrs: { 'data-admin-edit-user': String(user.id) }
                }]
            })}</td>
        </tr>
        `;
            }).join('');
            MacTableActions.init(document.getElementById('adminUsersTable'));
        },

        getRoleBadge: (roleName) => {
            const roleMap = {
                'super_user': { label: 'Super User', color: 'danger' },
                'admin': { label: 'Admin', color: 'primary' },
                'user': { label: 'User', color: 'info' },
                'viewer': { label: 'Viewer', color: 'secondary' }
            };
            const role = roleMap[roleName] || { label: window.formatRoleName(roleName), color: 'secondary' };
            return `<span class="badge bg-${role.color}">${escapeHtml(String(role.label))}</span>`;
        },

        updateUserStats: (users) => {
            const scope = _adminGrid;
            const container = document.getElementById('userStatisticsContainer');
            if (!container) return;

            const stats = {};
            users.forEach((user) => {
                const role = user.role || 'unknown';
                stats[role] = (stats[role] || 0) + 1;
            });

            container.innerHTML = Object.entries(stats).map(([role, count]) => {
                const roleInfo = scope.getRoleInfo(role);
                return `
            <div class="mb-2">
                <div class="d-flex justify-content-between">
                    <small>${roleInfo.label}:</small>
                    <strong>${count}</strong>
                </div>
            </div>
        `;
            }).join('') || '<p class="text-muted small mb-0">No statistics available</p>';
        },

        getRoleInfo: (roleName) => {
            const roleMap = {
                'super_user': { label: 'Super User' },
                'admin': { label: 'Admin' },
                'user': { label: 'User' },
                'viewer': { label: 'Viewer' }
            };
            return roleMap[roleName] || { label: window.formatRoleName(roleName) };
        },

        updateRoleFilter: () => {
            const scope = _adminGrid;
            const filter = document.getElementById('userRoleFilter');
            if (!filter) return;

            const roles = [...new Set(scope.data.users.map((u) => u.role))];
            const currentValue = filter.value;

            filter.innerHTML = '<option value="">All roles</option>' +
                roles.map((role) => {
                    const roleInfo = scope.getRoleInfo(role);
                    return `<option value="${escapeHtml(String(role))}">${escapeHtml(String(roleInfo.label))}</option>`;
                }).join('');

            if (currentValue) filter.value = currentValue;
        },

        loadRoles: async (options) => {
            const scope = _adminGrid;
            var forceRefresh = options && options.forceRefresh === true;
            if (!forceRefresh && scope._rolesLoaded) {
                scope.renderRolesTable(scope.data.roles);
                return;
            }
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getRoles) {
                    console.error('dataFunctions.getRoles is not available');
                    return;
                }

                const roles = await dataFunctions.getRoles(null, forceRefresh);

                if (!roles || roles.length === 0) {
                    scope.data.roles = [];
                } else {
                    scope.data.roles = roles.map((role) => ({
                        id: role.id,
                        role_name: role.role_name || role.name,
                        description: role.description || role.role_description || '',
                        is_active: role.is_active !== false
                    }));
                }

                scope._rolesLoaded = true;
                scope.renderRolesTable(scope.data.roles);
                if (scope.selectedRoleId) {
                    var still = scope.data.roles.some((r) => String(r.id) === String(scope.selectedRoleId));
                    if (!still) scope.clearRoleDetail();
                    else scope.highlightRoleRow(scope.selectedRoleId);
                }
            } catch (error) {
                console.error('Error loading roles:', error);
                const errorMessage = error.message || error.toString() || '';
                const isPermissionError = error.status === 403 ||
                    errorMessage.includes('Access denied') ||
                    errorMessage.includes('operation EXECUTE is not allowed') ||
                    errorMessage.includes('permission');

                if (isPermissionError) {
                    scope.showNotification('You do not have permission to view roles. Please contact your administrator.', 'warning');
                    scope.data.roles = [];
                    scope._rolesLoaded = true;
                    scope.renderRolesTable(scope.data.roles);
                } else {
                    scope.showNotification('Failed to load roles. Please try again later.', 'error');
                }
            }
        },

        renderRolesTable: (roles) => {
            const scope = _adminGrid;
            const tbody = document.getElementById('rolesTableBody');
            if (!tbody) return;

            if (!roles || roles.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No roles found.</td></tr>';
                return;
            }

            tbody.innerHTML = roles.map((role) => {
                const userCount = scope.data.users.filter((u) => u.role === role.role_name).length;
                const statusBadge = role.is_active
                    ? '<span class="badge bg-success">Active</span>'
                    : '<span class="badge bg-secondary">Inactive</span>';
                const roleName = escapeHtml(role.role_name || '');
                const desc = escapeHtml(role.description || 'No description');
                const rid = escapeHtml(String(role.id));
                const canManage = typeof superUserVisibility === 'undefined' || superUserVisibility.canManageRole(role);
                const actionItems = [];
                if (canManage) {
                    actionItems.push(
                        { label: 'Edit role', icon: 'fas fa-pen me-1', attrs: { 'data-admin-edit-role': String(role.id) } },
                        { label: 'Customize', icon: 'fas fa-sliders-h me-1', attrs: { 'data-admin-customize-role': String(role.id) } }
                    );
                    if (canDeleteRoleInHub()) {
                        actionItems.push({
                            label: 'Delete role',
                            icon: 'fas fa-trash me-1',
                            danger: true,
                            className: 'js-admin-deactivate-role',
                            dataAttrs: { 'role-id': String(role.id) }
                        });
                    }
                } else {
                    actionItems.push({ label: 'View only', disabled: true, className: 'text-muted' });
                }
                return `
            <tr class="js-admin-role-row" data-role-id="${rid}">
                <td><strong>${window.formatRoleName(roleName)}</strong></td>
                <td><small class="text-muted">${desc}</small></td>
                <td><span class="badge bg-info">${userCount} users</span></td>
                <td>${statusBadge}</td>
                <td class="mac-table-actions-col">${MacTableActions.render({
                    wrapLi: true,
                    items: actionItems
                })}</td>
            </tr>
        `;
            }).join('');
            MacTableActions.init(document.getElementById('adminRolesTable'));
            if (scope.selectedRoleId) scope.highlightRoleRow(scope.selectedRoleId);
        },

        highlightRoleRow: (roleId) => {
            document.querySelectorAll('tr.js-admin-role-row').forEach(function (tr) {
                tr.classList.toggle('table-active', String(tr.getAttribute('data-role-id')) === String(roleId));
            });
        },

        canApplyCustomizeLoad: (roleId, loadSeq) => {
            const scope = _adminGrid;
            return loadSeq === scope.adminFeaturesLoadSeq &&
                String(roleId) === String(scope.selectedRoleId);
        },

        canSaveCustomizeForRole: () => {
            const scope = _adminGrid;
            return !!(scope.selectedRoleId && scope.adminLoadedRoleId &&
                String(scope.selectedRoleId) === String(scope.adminLoadedRoleId));
        },

        refreshSessionFeatureKeysIfCurrentRole: (roleId) => {
            var user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
            var currentRoleId = user && user.role_id ? user.role_id : null;
            if (currentRoleId && String(currentRoleId) === String(roleId)) {
                if (typeof Session !== 'undefined' && Session.remove) Session.remove('featureKeys');
                if (typeof authService !== 'undefined' && authService.fetchAndCacheFeatures) {
                    authService.fetchAndCacheFeatures(currentRoleId);
                } else if (typeof menuFilter !== 'undefined' && menuFilter.refresh) {
                    menuFilter.refresh();
                }
            }
        },

        clearRoleDetail: () => {
            const scope = _adminGrid;
            scope.selectedRoleId = null;
            scope.adminLoadedRoleId = null;
            scope.adminAllFeatures = [];
            scope.adminRoleFeatureIdMap = {};
            scope.adminAllPermissions = [];
            scope.adminAllActions = [];
            scope.adminRoleActionIdMap = {};
            scope.adminExpandedFeatureKeys = {};
            document.querySelectorAll('tr.js-admin-role-row').forEach(function (tr) { tr.classList.remove('table-active'); });
            var tbody = document.getElementById('adminFeaturesTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">Open this dialog from a role\'s Customize action.</td></tr>';
            }
            var sum = document.getElementById('adminFeatureSummary');
            if (sum) { sum.style.display = 'none'; sum.innerHTML = ''; }
        },

        setSelectedRoleRow: (roleId) => {
            const scope = _adminGrid;
            if (!roleId) return;
            scope.selectedRoleId = roleId;
            scope.highlightRoleRow(roleId);
        },

        openCustomizeModulesModal: (roleId) => {
            const scope = _adminGrid;
            if (!roleId) return;
            var role = scope.data.roles.find(function (r) { return String(r.id) === String(roleId); });
            if (role && typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageRole(role)) {
                scope.showNotification('Only super users may change permissions for the super_user role.', 'warning');
                return;
            }
            scope.selectedRoleId = roleId;
            scope.adminLoadedRoleId = null;
            scope.adminRoleFeatureIdMap = {};
            scope.adminRoleActionIdMap = {};
            scope.adminAllPermissions = [];
            scope.highlightRoleRow(roleId);
            var sub = document.getElementById('adminCustomizeModalSubtitle');
            if (role && sub) {
                var uc = scope.data.users.filter((u) => u.role === role.role_name).length;
                sub.textContent = (role.role_name || 'Role') + ' · ' + uc + ' user(s) · ' + (role.is_active ? 'Active' : 'Inactive');
            }
            scope.loadAdminRoleFeatures(roleId);
            var el = document.getElementById('adminRoleCustomizeModal');
            if (el && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(el).show();
            }
        },

        loadAdminRoleFeatures: async (roleId) => {
            const scope = _adminGrid;
            const tbody = document.getElementById('adminFeaturesTableBody');
            if (!tbody || !dataFunctions.getFeatures || !dataFunctions.getRoleFeatures) return;
            scope.adminFeaturesLoadSeq += 1;
            var loadSeq = scope.adminFeaturesLoadSeq;
            scope.adminLoadedRoleId = null;
            scope.adminRoleFeatureIdMap = {};
            scope.adminRoleActionIdMap = {};
            scope.adminAllPermissions = [];
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading…</td></tr>';
            scope.adminExpandedFeatureKeys = {};
            try {
                var results = await Promise.all([
                    dataFunctions.getFeatures(),
                    dataFunctions.getRoleFeatures(),
                    dataFunctions.getRolePermissionsFiltered ? dataFunctions.getRolePermissionsFiltered({ roleId: roleId }) : [],
                    dataFunctions.getActions ? dataFunctions.getActions() : [],
                    dataFunctions.getRoleActions ? dataFunctions.getRoleActions() : []
                ]);
                if (!scope.canApplyCustomizeLoad(roleId, loadSeq)) return;
                var featuresResponse = results[0];
                var allRoleFeatures = results[1];
                var permissions = results[2];
                var actionsResponse = results[3];
                var allRoleActions = results[4];
                if (Array.isArray(featuresResponse)) {
                    scope.adminAllFeatures = featuresResponse;
                } else if (featuresResponse && featuresResponse.get_features) {
                    scope.adminAllFeatures = featuresResponse.get_features;
                } else {
                    scope.adminAllFeatures = [];
                }
                scope.adminRoleFeatureIdMap = {};
                var assigned = Array.isArray(allRoleFeatures) ? allRoleFeatures : [];
                assigned.forEach(function (rf) {
                    if (String(rf.role_id) === String(roleId)) {
                        scope.adminRoleFeatureIdMap[String(rf.feature_id)] = rf.id;
                    }
                });
                scope.adminAllPermissions = Array.isArray(permissions) ? permissions : [];
                scope.adminAllActions = Array.isArray(actionsResponse) ? actionsResponse : [];
                scope.adminRoleActionIdMap = {};
                (Array.isArray(allRoleActions) ? allRoleActions : []).forEach(function (ra) {
                    if (String(ra.role_id) === String(roleId) && ra.value === 'true') {
                        scope.adminRoleActionIdMap[String(ra.action_key)] = ra.id;
                    }
                });
                scope.adminLoadedRoleId = roleId;
                scope.renderAdminFeatureRows();
                scope.updateAdminFeatureSummary();
            } catch (error) {
                if (!scope.canApplyCustomizeLoad(roleId, loadSeq)) return;
                console.error('[Admin] Features load error:', error);
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">Could not load features.</td></tr>';
            }
        },

        // Assign each permission to the first matching feature row so it appears
        // once; anything unmatched ends up in the trailing "Other / shared" group.
        groupAdminPermissions: () => {
            const scope = _adminGrid;
            var map = (typeof _permissionModuleMap !== 'undefined') ? _permissionModuleMap : null;
            var groups = {};
            var other = [];
            scope.adminAllFeatures.forEach(function (f) { groups[String(f.key)] = []; });
            scope.adminAllPermissions.forEach(function (perm) {
                var placed = false;
                if (map) {
                    for (var i = 0; i < scope.adminAllFeatures.length; i++) {
                        var fk = scope.adminAllFeatures[i].key;
                        if (map.permissionBelongsToFeature(perm, fk)) {
                            groups[String(fk)].push(perm);
                            placed = true;
                            break;
                        }
                    }
                }
                if (!placed) other.push(perm);
            });
            return { groups: groups, other: other };
        },

        groupAdminActions: () => {
            const scope = _adminGrid;
            var map = (typeof _permissionModuleMap !== 'undefined') ? _permissionModuleMap : null;
            var groups = {};
            var other = [];
            scope.adminAllFeatures.forEach(function (f) { groups[String(f.key)] = []; });
            scope.adminAllActions.forEach(function (action) {
                var placed = false;
                if (map && map.actionBelongsToFeature) {
                    for (var i = 0; i < scope.adminAllFeatures.length; i++) {
                        var fk = scope.adminAllFeatures[i].key;
                        if (map.actionBelongsToFeature(action, fk)) {
                            groups[String(fk)].push(action);
                            placed = true;
                            break;
                        }
                    }
                }
                if (!placed) other.push(action);
            });
            return { groups: groups, other: other };
        },

        actionMatchesSearch: (action) => {
            const scope = _adminGrid;
            var term = (scope.adminCustomizePermSearch || '').toLowerCase();
            if (!term) return true;
            return String(action.key || '').toLowerCase().indexOf(term) !== -1 ||
                String(action.label || '').toLowerCase().indexOf(term) !== -1 ||
                String(action.description || '').toLowerCase().indexOf(term) !== -1;
        },

        isActionAllowed: (action) => {
            const scope = _adminGrid;
            return Object.prototype.hasOwnProperty.call(scope.adminRoleActionIdMap, String(action.key));
        },

        renderAdminActionRows: (actions) => {
            const scope = _adminGrid;
            var visible = actions.filter(scope.actionMatchesSearch);
            if (!visible.length) {
                return '';
            }
            var rows = visible.map(function (a) {
                var aid = escapeHtml(String(a.id));
                var akey = escapeHtml(String(a.key || ''));
                var allowed = scope.isActionAllowed(a) ? ' checked' : '';
                return '<tr class="admin-action-row">' +
                    '<td class="text-center">' +
                    '<div class="form-check d-flex justify-content-center mb-0">' +
                    '<input class="form-check-input admin-action-checkbox" type="checkbox" data-action-id="' + aid + '" data-action-key="' + akey + '"' + allowed + '>' +
                    '</div></td>' +
                    '<td class="admin-perm-name">' + escapeHtml(a.label || '') + '</td>' +
                    '<td class="text-muted small"><code>' + akey + '</code></td>' +
                    '<td class="text-muted small">Button action</td>' +
                    '<td></td>' +
                    '</tr>';
            }).join('');
            return '<tr class="admin-perm-section-row"><td></td><td colspan="4" class="text-uppercase small text-muted py-2">Button actions</td></tr>' + rows;
        },

        permissionMatchesSearch: (perm) => {
            const scope = _adminGrid;
            var term = (scope.adminCustomizePermSearch || '').toLowerCase();
            if (!term) return true;
            return String(perm.object_name || '').toLowerCase().indexOf(term) !== -1 ||
                String(perm.operation || '').toLowerCase().indexOf(term) !== -1;
        },

        isPermissionAllowed: (perm) => {
            if (perm.allowed !== undefined) return perm.allowed === true || perm.allowed === 'true';
            if (perm.is_active !== undefined) return perm.is_active === true || perm.is_active === 'true';
            return false;
        },

        renderAdminPermRows: (perms) => {
            const scope = _adminGrid;
            var visible = perms.filter(scope.permissionMatchesSearch);
            if (!visible.length) {
                return '<tr class="admin-perm-row"><td></td><td colspan="4" class="text-muted small py-2">' +
                    (scope.adminCustomizePermSearch ? 'No permissions match the filter.' : 'No database permissions in this module.') +
                    '</td></tr>';
            }
            return visible.map(function (p) {
                var pid = escapeHtml(String(p.id));
                var allowed = scope.isPermissionAllowed(p) ? ' checked' : '';
                return '<tr class="admin-perm-row">' +
                    '<td class="text-center">' +
                    '<div class="form-check d-flex justify-content-center mb-0">' +
                    '<input class="form-check-input admin-perm-checkbox" type="checkbox" data-permission-id="' + pid + '"' + allowed + '>' +
                    '</div></td>' +
                    '<td class="admin-perm-name"><code>' + escapeHtml(p.object_name || '') + '</code></td>' +
                    '<td class="text-muted small">' + escapeHtml(p.object_type || '') + '</td>' +
                    '<td class="text-muted small">' + escapeHtml(p.operation || '') + '</td>' +
                    '<td></td>' +
                    '</tr>';
            }).join('');
        },

        renderAdminExpandedRows: (actions, perms) => {
            const scope = _adminGrid;
            var html = '';
            var actionRows = scope.renderAdminActionRows(actions);
            if (actionRows) html += actionRows;
            var permRows = scope.renderAdminPermRows(perms);
            if (permRows && perms.length) {
                if (actionRows) {
                    html += '<tr class="admin-perm-section-row"><td></td><td colspan="4" class="text-uppercase small text-muted py-2">Database functions</td></tr>';
                }
                html += permRows;
            }
            if (!html) {
                html = '<tr class="admin-perm-row"><td></td><td colspan="4" class="text-muted small py-2">' +
                    (scope.adminCustomizePermSearch ? 'No permissions or actions match the filter.' : 'No button actions or database permissions in this module.') +
                    '</td></tr>';
            }
            return html;
        },

        renderAdminFeatureRows: () => {
            const scope = _adminGrid;
            var tbody = document.getElementById('adminFeaturesTableBody');
            if (!tbody) return;
            if (!scope.adminAllFeatures.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No features defined.</td></tr>';
                return;
            }
            var grouped = scope.groupAdminPermissions();
            var actionGrouped = scope.groupAdminActions();
            var html = '';
            scope.adminAllFeatures.forEach(function (feature) {
                var fkRaw = String(feature.key || '');
                var isEnabled = Object.prototype.hasOwnProperty.call(scope.adminRoleFeatureIdMap, String(feature.id));
                var checkedAttr = isEnabled ? ' checked' : '';
                var fk = escapeHtml(feature.key || '');
                var fn = escapeHtml(feature.name || '');
                var fd = escapeHtml(feature.description || '');
                var perms = grouped.groups[fkRaw] || [];
                var actions = actionGrouped.groups[fkRaw] || [];
                var expanded = scope.adminExpandedFeatureKeys[fkRaw] === true;
                var allowedCount = perms.filter(scope.isPermissionAllowed).length + actions.filter(scope.isActionAllowed).length;
                var totalCount = perms.length + actions.length;
                var expandBtn = '<button type="button" class="btn btn-sm btn-outline-secondary js-admin-feature-expand" data-feature-key="' + fk + '"' +
                    (totalCount ? '' : ' disabled') + ' aria-expanded="' + (expanded ? 'true' : 'false') + '">' +
                    '<i class="fas fa-chevron-' + (expanded ? 'down' : 'right') + ' me-1"></i>' +
                    allowedCount + ' / ' + totalCount +
                    '</button>';
                html += '<tr class="feature-row" data-feature-key="' + fk + '">' +
                    '<td class="text-center">' +
                    '<div class="form-check d-flex justify-content-center mb-0">' +
                    '<input class="form-check-input admin-feature-checkbox" type="checkbox"' +
                    ' data-feature-id="' + feature.id + '" data-feature-key="' + fk + '"' + checkedAttr + '>' +
                    '</div></td>' +
                    '<td class="fw-medium">' + fn + '</td>' +
                    '<td><code>' + fk + '</code></td>' +
                    '<td class="text-muted small">' + fd + '</td>' +
                    '<td class="text-end">' + expandBtn + '</td>' +
                    '</tr>';
                if (expanded && totalCount) {
                    html += '<tr class="admin-perm-group" data-feature-key="' + fk + '"><td colspan="5" class="p-0">' +
                        '<table class="table align-middle mb-0 admin-perm-table"><tbody>' +
                        scope.renderAdminExpandedRows(actions, perms) +
                        '</tbody></table></td></tr>';
                }
            });
            if (grouped.other.length || actionGrouped.other.length) {
                var otherExpanded = scope.adminExpandedFeatureKeys.__other__ === true;
                var otherAllowed = grouped.other.filter(scope.isPermissionAllowed).length +
                    actionGrouped.other.filter(scope.isActionAllowed).length;
                var otherTotal = grouped.other.length + actionGrouped.other.length;
                html += '<tr class="feature-row admin-other-row" data-feature-key="__other__">' +
                    '<td class="text-center text-muted"><i class="fas fa-shapes"></i></td>' +
                    '<td class="fw-medium">Other / shared</td>' +
                    '<td><code>—</code></td>' +
                    '<td class="text-muted small">Database permissions not tied to a specific module.</td>' +
                    '<td class="text-end">' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary js-admin-feature-expand" data-feature-key="__other__" aria-expanded="' + (otherExpanded ? 'true' : 'false') + '">' +
                    '<i class="fas fa-chevron-' + (otherExpanded ? 'down' : 'right') + ' me-1"></i>' +
                    otherAllowed + ' / ' + otherTotal +
                    '</button>' +
                    '</td></tr>';
                if (otherExpanded) {
                    html += '<tr class="admin-perm-group" data-feature-key="__other__"><td colspan="5" class="p-0">' +
                        '<table class="table align-middle mb-0 admin-perm-table"><tbody>' +
                        scope.renderAdminExpandedRows(actionGrouped.other, grouped.other) +
                        '</tbody></table></td></tr>';
                }
            }
            tbody.innerHTML = html;
        },

        toggleAdminFeatureExpand: (featureKey) => {
            const scope = _adminGrid;
            var key = featureKey === '__other__' ? '__other__' : String(featureKey);
            scope.adminExpandedFeatureKeys[key] = scope.adminExpandedFeatureKeys[key] !== true;
            scope.renderAdminFeatureRows();
        },

        updateAdminFeatureSummary: () => {
            const scope = _adminGrid;
            var summaryEl = document.getElementById('adminFeatureSummary');
            if (!summaryEl) return;
            var total = scope.adminAllFeatures.length;
            var enabled = scope.adminAllFeatures.filter(function (f) {
                return Object.prototype.hasOwnProperty.call(scope.adminRoleFeatureIdMap, String(f.id));
            }).length;
            var permTotal = scope.adminAllPermissions.length;
            var permAllowed = scope.adminAllPermissions.filter(scope.isPermissionAllowed).length;
            var actionTotal = scope.adminAllActions.length;
            var actionAllowed = scope.adminAllActions.filter(scope.isActionAllowed).length;
            summaryEl.style.display = '';
            summaryEl.innerHTML = '<span class="badge bg-primary me-2">' + enabled + ' / ' + total + '</span>' +
                '<span class="text-muted me-3">modules enabled</span>' +
                '<span class="badge bg-secondary me-2">' + actionAllowed + ' / ' + actionTotal + '</span>' +
                '<span class="text-muted me-3">button actions</span>' +
                '<span class="badge bg-secondary me-2">' + permAllowed + ' / ' + permTotal + '</span>' +
                '<span class="text-muted">database permissions allowed</span>';
        },

        toggleAdminFeature: async (featureId, _featureKey, enabled, $checkbox) => {
            const scope = _adminGrid;
            if (!scope.selectedRoleId || !featureId) return;
            if (!scope.canSaveCustomizeForRole()) {
                scope.showNotification('Role data is still loading. Wait for Loading to finish, then try again.', 'warning');
                $checkbox.prop('checked', !enabled);
                return;
            }
            var selectedRole = scope.data.roles.find(function (r) { return String(r.id) === String(scope.selectedRoleId); });
            if (selectedRole && typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageRole(selectedRole)) {
                scope.showNotification('Only super users may change permissions for the super_user role.', 'warning');
                $checkbox.prop('checked', !enabled);
                return;
            }
            $checkbox.prop('disabled', true);
            try {
                if (enabled) {
                    var result = await dataFunctions.createRoleFeature({
                        role_id: scope.selectedRoleId,
                        feature_id: featureId,
                        value: 'true'
                    });
                    var newId = null;
                    if (result) {
                        if (result.id) newId = result.id;
                        else if (Array.isArray(result) && result[0] && result[0].id) newId = result[0].id;
                    }
                    if (newId) scope.adminRoleFeatureIdMap[String(featureId)] = newId;
                    else {
                        var allRoleFeatures = await dataFunctions.getRoleFeatures();
                        var assigned = Array.isArray(allRoleFeatures) ? allRoleFeatures : [];
                        assigned.forEach(function (rf) {
                            if (String(rf.role_id) === String(scope.selectedRoleId) && String(rf.feature_id) === String(featureId)) {
                                scope.adminRoleFeatureIdMap[String(featureId)] = rf.id;
                            }
                        });
                    }
                } else {
                    var roleFeatureId = scope.adminRoleFeatureIdMap[String(featureId)];
                    if (roleFeatureId) {
                        await dataFunctions.deleteRoleFeature(roleFeatureId);
                        delete scope.adminRoleFeatureIdMap[String(featureId)];
                    }
                }
                if (dataFunctions.clearCachePattern) {
                    dataFunctions.clearCachePattern('get_role_features');
                    dataFunctions.clearCachePattern('get_features_for_role');
                }
                scope.updateAdminFeatureSummary();
                scope.refreshSessionFeatureKeysIfCurrentRole(scope.selectedRoleId);
            } catch (error) {
                console.error('[Admin] Feature toggle error:', error);
                scope.showNotification('Error saving: ' + (error.message || ''), 'error');
                $checkbox.prop('checked', !enabled);
            } finally {
                $checkbox.prop('disabled', false);
            }
        },

        toggleAdminAction: async (actionId, actionKey, enabled, $checkbox) => {
            const scope = _adminGrid;
            if (!scope.selectedRoleId || !actionId) return;
            if (!scope.canSaveCustomizeForRole()) {
                scope.showNotification('Role data is still loading. Wait for Loading to finish, then try again.', 'warning');
                $checkbox.prop('checked', !enabled);
                return;
            }
            var selectedRole = scope.data.roles.find(function (r) { return String(r.id) === String(scope.selectedRoleId); });
            if (selectedRole && typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageRole(selectedRole)) {
                scope.showNotification('Only super users may change permissions for the super_user role.', 'warning');
                $checkbox.prop('checked', !enabled);
                return;
            }
            $checkbox.prop('disabled', true);
            try {
                if (enabled) {
                    var result = await dataFunctions.createRoleAction({
                        role_id: scope.selectedRoleId,
                        action_id: actionId,
                        value: 'true'
                    });
                    var newId = null;
                    if (result) {
                        if (result.id) newId = result.id;
                        else if (Array.isArray(result) && result[0] && result[0].id) newId = result[0].id;
                    }
                    if (newId) scope.adminRoleActionIdMap[String(actionKey)] = newId;
                    else {
                        var allRoleActions = await dataFunctions.getRoleActions();
                        (Array.isArray(allRoleActions) ? allRoleActions : []).forEach(function (ra) {
                            if (String(ra.role_id) === String(scope.selectedRoleId) && String(ra.action_key) === String(actionKey)) {
                                scope.adminRoleActionIdMap[String(actionKey)] = ra.id;
                            }
                        });
                    }
                } else {
                    var roleActionId = scope.adminRoleActionIdMap[String(actionKey)];
                    if (roleActionId) {
                        await dataFunctions.deleteRoleAction(roleActionId);
                        delete scope.adminRoleActionIdMap[String(actionKey)];
                    }
                }
                if (dataFunctions.clearCachePattern) {
                    dataFunctions.clearCachePattern('get_role_actions');
                    dataFunctions.clearCachePattern('get_actions_for_role');
                }
                scope.updateAdminFeatureSummary();
                scope.refreshAdminExpandBadges();
                scope.refreshSessionFeatureKeysIfCurrentRole(scope.selectedRoleId);
            } catch (error) {
                console.error('[Admin] Action toggle error:', error);
                scope.showNotification('Error saving: ' + (error.message || ''), 'error');
                $checkbox.prop('checked', !enabled);
            } finally {
                $checkbox.prop('disabled', false);
            }
        },

        toggleAdminPermission: async (permissionId, enabled, $checkbox) => {
            const scope = _adminGrid;
            if (!scope.selectedRoleId || !permissionId) return;
            if (!scope.canSaveCustomizeForRole()) {
                scope.showNotification('Role data is still loading. Wait for Loading to finish, then try again.', 'warning');
                $checkbox.prop('checked', !enabled);
                return;
            }
            var selectedRole = scope.data.roles.find(function (r) { return String(r.id) === String(scope.selectedRoleId); });
            if (selectedRole && typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageRole(selectedRole)) {
                scope.showNotification('Only super users may change permissions for the super_user role.', 'warning');
                $checkbox.prop('checked', !enabled);
                return;
            }
            var perm = scope.adminAllPermissions.find(function (p) { return String(p.id) === String(permissionId); });
            if (!perm) return;
            if (perm.role_id && String(perm.role_id) !== String(scope.adminLoadedRoleId)) {
                scope.showNotification('Permission does not belong to the selected role. Close Customize and reopen it for this role.', 'warning');
                $checkbox.prop('checked', !enabled);
                return;
            }
            $checkbox.prop('disabled', true);
            try {
                await dataFunctions.updateRolePermission(perm.id, {
                    role_id: perm.role_id || scope.selectedRoleId,
                    object_type: perm.object_type,
                    object_name: perm.object_name,
                    operation: perm.operation,
                    is_active: enabled
                });
                if (perm.allowed !== undefined) perm.allowed = enabled;
                perm.is_active = enabled;
                if (dataFunctions.clearCachePattern) {
                    dataFunctions.clearCachePattern('get_role_permissions');
                }
                scope.updateAdminFeatureSummary();
                scope.refreshAdminExpandBadges();
            } catch (error) {
                console.error('[Admin] Permission toggle error:', error);
                scope.showNotification('Error saving: ' + (error.message || ''), 'error');
                $checkbox.prop('checked', !enabled);
            } finally {
                $checkbox.prop('disabled', false);
            }
        },

        // Update the allowed-count badge on each expand button without collapsing
        // any open group (so a toggle does not jump the scroll position).
        refreshAdminExpandBadges: () => {
            const scope = _adminGrid;
            var grouped = scope.groupAdminPermissions();
            var actionGrouped = scope.groupAdminActions();
            document.querySelectorAll('#adminFeaturesTableBody .js-admin-feature-expand').forEach(function (btn) {
                var key = btn.getAttribute('data-feature-key');
                var perms = key === '__other__' ? grouped.other : (grouped.groups[key] || []);
                var actions = key === '__other__' ? actionGrouped.other : (actionGrouped.groups[key] || []);
                var allowed = perms.filter(scope.isPermissionAllowed).length + actions.filter(scope.isActionAllowed).length;
                var total = perms.length + actions.length;
                var expanded = btn.getAttribute('aria-expanded') === 'true';
                btn.innerHTML = '<i class="fas fa-chevron-' + (expanded ? 'down' : 'right') + ' me-1"></i>' + allowed + ' / ' + total;
            });
        },

        setupFormHandlersOnce: () => {
            const scope = _adminGrid;

            ['userSearchInput', 'userRoleFilter', 'userStatusFilter'].forEach(function (id) {
                const el = document.getElementById(id);
                if (el && !el.dataset.adminFilterBound) {
                    el.dataset.adminFilterBound = '1';
                    el.addEventListener(id === 'userSearchInput' ? 'input' : 'change', function () {
                        scope.applyUserFilters();
                    });
                }
            });

            const clearUserFiltersBtn = document.getElementById('clearUserFiltersBtn');
            if (clearUserFiltersBtn && !clearUserFiltersBtn.dataset.adminFilterBound) {
                clearUserFiltersBtn.dataset.adminFilterBound = '1';
                clearUserFiltersBtn.addEventListener('click', function () {
                    ['userSearchInput', 'userRoleFilter', 'userStatusFilter'].forEach(function (id) {
                        const el = document.getElementById(id);
                        if (el) el.value = '';
                    });
                    scope.applyUserFilters();
                });
            }

            if (window.__adminGridClickBound) return;
            window.__adminGridClickBound = true;

            document.addEventListener('click', function (e) {
                if (!document.getElementById('adminTab')) return;
                var editUser = e.target.closest('[data-admin-edit-user]');
                if (editUser) {
                    e.preventDefault();
                    scope.editUser(editUser.getAttribute('data-admin-edit-user'));
                    return;
                }
                var editRoleBtn = e.target.closest('[data-admin-edit-role]');
                if (editRoleBtn) {
                    e.preventDefault();
                    scope.editRole(editRoleBtn.getAttribute('data-admin-edit-role'));
                    return;
                }
                var customizeBtn = e.target.closest('[data-admin-customize-role]');
                if (customizeBtn) {
                    e.preventDefault();
                    scope.openCustomizeModulesModal(customizeBtn.getAttribute('data-admin-customize-role'));
                    return;
                }
                var deactivateRoleBtn = e.target.closest('.js-admin-deactivate-role');
                if (deactivateRoleBtn) {
                    e.preventDefault();
                    scope.deactivateRole(deactivateRoleBtn.getAttribute('data-role-id'));
                    return;
                }
                var userRow = e.target.closest('tr.js-admin-user-row');
                if (userRow) {
                    if (e.target.closest('.dropdown') || e.target.closest('button') || e.target.closest('.btn')) return;
                    var uid = userRow.getAttribute('data-user-id');
                    if (uid) scope.editUser(uid);
                    return;
                }
                var roleRow = e.target.closest('tr.js-admin-role-row');
                if (roleRow) {
                    if (e.target.closest('button') || e.target.closest('a')) return;
                    var rid = roleRow.getAttribute('data-role-id');
                    if (rid) scope.setSelectedRoleRow(rid);
                }
            });
        },

        editUser: async (userId) => {
            const scope = _adminGrid;
            var user = scope.data.users.find(function (u) { return String(u.id) === String(userId); });
            if (!user) {
                scope.showNotification('User not found in the current list. Refresh and try again.', 'warning');
                return;
            }
            if (typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageUser(user)) {
                scope.showNotification('You do not have permission to manage this user.', 'warning');
                return;
            }
            var raw = {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role_id: user.role_id,
                is_active: user.is_active !== false
            };
            await scope.ensureModalsLoaded();
            if (typeof _modal_user !== 'undefined' && _modal_user.show) {
                _modal_user.show(raw);
            } else {
                scope.showNotification('User editor is not loaded yet.', 'warning');
            }
        },

        editRole: async (roleId) => {
            const scope = _adminGrid;
            var role = scope.data.roles.find(function (r) { return String(r.id) === String(roleId); });
            if (!role) {
                scope.showNotification('Role not found.', 'warning');
                return;
            }
            if (typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageRole(role)) {
                scope.showNotification('Only super users may edit the super_user role.', 'warning');
                return;
            }
            await scope.ensureModalsLoaded();
            if (typeof _modal_role !== 'undefined' && _modal_role.show) {
                _modal_role.show(role);
            } else {
                scope.showNotification('Role editor is not loaded yet.', 'warning');
            }
        },

        deactivateRole: (roleId) => {
            const scope = _adminGrid;
            if (!canDeleteRoleInHub()) {
                scope.showNotification('You do not have permission to delete roles.', 'warning');
                return;
            }
            var role = scope.data.roles.find(function (r) { return String(r.id) === String(roleId); });
            if (!role) {
                scope.showNotification('Role not found.', 'warning');
                return;
            }
            if (typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageRole(role)) {
                scope.showNotification('Only super users may deactivate the super_user role.', 'warning');
                return;
            }
            if (typeof Swal === 'undefined') {
                scope.showNotification('Confirmation dialog is not available.', 'error');
                return;
            }
            Swal.fire({
                title: 'Delete role?',
                text: 'Do you want to deactivate "' + (role.role_name || '') + '"? Users assigned to this role will need to be reassigned.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete role'
            }).then(async function (result) {
                if (!result.isConfirmed) return;
                try {
                    await dataFunctions.deactivateRole(roleId);
                    scope.showNotification('Role deleted successfully', 'success');
                    await scope.loadRoles();
                } catch (error) {
                    console.error('Error deactivating role:', error);
                    scope.showNotification('Error deactivating role: ' + (error.message || ''), 'error');
                }
            });
        },

        showNotification: (message, type = 'info') => {
            if (typeof _common !== 'undefined' && _common.showSuccessToast) {
                switch (type) {
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
                const iconMap = { success: 'success', error: 'error', warning: 'warning', info: 'info' };
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
    };
}();

function initializeAdminGrid() {
    var maxWait = 3000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined' && typeof dataFunctions.getUsers === 'function') {
            _adminGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

window.initializeAdminGrid = initializeAdminGrid;
