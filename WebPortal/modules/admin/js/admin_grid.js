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

    return {
        data: {
            users: [],
            roles: [],
            permissions: []
        },
        selectedRoleId: null,
        adminAllFeatures: [],
        adminRoleFeatureIdMap: {},
        adminPermissionRows: [],
        adminPermCurrentPage: 1,
        adminPermPerPage: 12,
        adminPermSearchTerm: '',
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
                if (e.target.closest('#adminBtnAddUser, #adminBtnAddUserTab')) openAdd(e);
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
                if (e.target.closest('#adminPermSearchBtn')) {
                    e.preventDefault();
                    var inp = document.getElementById('adminPermSearch');
                    scope.adminPermSearchTerm = inp ? inp.value.trim() : '';
                    scope.adminPermCurrentPage = 1;
                    var ridSearch = scope.getEditingRoleIdForPermPanel();
                    if (ridSearch) scope.loadAdminPermissions(ridSearch);
                    return;
                }
                if (e.target.closest('#adminPermRefreshBtn')) {
                    e.preventDefault();
                    var ridRef = scope.getEditingRoleIdForPermPanel();
                    if (ridRef) scope.loadAdminPermissions(ridRef);
                    return;
                }
                var pg = e.target.closest('#adminPermPagination a.page-link');
                if (!pg || pg.closest('li.disabled')) return;
                e.preventDefault();
                var p = parseInt(pg.getAttribute('data-page'), 10);
                if (p && p !== scope.adminPermCurrentPage) {
                    scope.adminPermCurrentPage = p;
                    scope.renderAdminPermissionsPage();
                }
            });
            document.addEventListener('change', function (e) {
                var t = e.target;
                if (!t || !t.classList || !t.classList.contains('admin-feature-checkbox')) return;
                var enabled = t.checked;
                var featureId = t.getAttribute('data-feature-id');
                var featureKey = t.getAttribute('data-feature-key');
                scope.toggleAdminFeature(featureId, featureKey, enabled, $(t));
            });
        },

        getEditingRoleIdForPermPanel: () => {
            const scope = _adminGrid;
            var form = document.getElementById('roleForm');
            var fromForm = form && form.getAttribute('data-editing-id');
            if (fromForm) return fromForm;
            return scope.selectedRoleId;
        },

        onRoleModalHidden: () => {
            const scope = _adminGrid;
            var cust = document.getElementById('adminRoleCustomizeModal');
            if (cust && cust.classList.contains('show')) return;
            scope.selectedRoleId = null;
            var tbody = document.getElementById('adminPermissionsTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Expand <strong>Advanced: database permissions</strong> to load rows.</td></tr>';
            }
            var pag = document.getElementById('adminPermPagination');
            if (pag) pag.innerHTML = '';
            var inp = document.getElementById('adminPermSearch');
            if (inp) inp.value = '';
            scope.adminPermSearchTerm = '';
        },

        handleTabSwitch: (targetId) => {
            const scope = _adminGrid;
            switch (targetId) {
                case '#users':
                    if (scope._usersLoaded) {
                        scope.renderUsersTable(scope.data.users);
                        scope.updateUserStats(scope.data.users);
                        scope.updateRoleFilter();
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
                case '#system':
                    break;
                default:
                    break;
            }
        },

        renderUsersFromCache: () => {
            const scope = _adminGrid;
            scope.renderUsersTable(scope.data.users);
            scope.updateUserStats(scope.data.users);
            scope.updateRoleFilter();
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
                        username: user.username || user.user_name || user.userName || '',
                        first_name: user.first_name || user.username || user.email?.split('@')[0] || 'User',
                        last_name: user.last_name || '',
                        email: user.email,
                        role: user.role || user.role_name || 'user',
                        role_id: user.role_id,
                        is_active: user.is_active !== false,
                        status: user.is_active !== false ? 'active' : 'inactive',
                        last_login: user.last_login || null,
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
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No users found.</td></tr>';
                return;
            }

            tbody.innerHTML = users.map((user) => {
                const roleBadge = scope.getRoleBadge(user.role);
                const statusBadge = user.status === 'active'
                    ? '<span class="badge bg-success">Active</span>'
                    : '<span class="badge bg-secondary">Inactive</span>';
                const lastLogin = user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never';
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
            <td><small class="text-muted">${escapeHtml(lastLogin)}</small></td>
            <td>
                <div class="dropdown">
                    <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions" title="Actions">
                        <i class="fas fa-ellipsis"></i>
                    </button>
                    <ul class="dropdown-menu dropdown-menu-end">
                        <li><a class="dropdown-item" href="#" data-admin-edit-user="${escapeHtml(String(user.id))}"><i class="fas fa-pen me-2"></i>Edit user</a></li>
                    </ul>
                </div>
            </td>
        </tr>
        `;
            }).join('');
        },

        getRoleBadge: (roleName) => {
            const roleMap = {
                'super_user': { label: 'Super User', color: 'danger' },
                'admin': { label: 'Admin', color: 'primary' },
                'user': { label: 'User', color: 'info' },
                'viewer': { label: 'Viewer', color: 'secondary' }
            };
            const role = roleMap[roleName] || { label: roleName, color: 'secondary' };
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
            return roleMap[roleName] || { label: roleName };
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
                return `
            <tr class="js-admin-role-row" data-role-id="${rid}">
                <td><strong>${roleName}</strong></td>
                <td><small class="text-muted">${desc}</small></td>
                <td><span class="badge bg-info">${userCount} users</span></td>
                <td>${statusBadge}</td>
                <td class="text-end admin-role-actions">
                    <div class="d-inline-flex flex-wrap gap-1 justify-content-end">
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-admin-edit-role="${rid}" title="Edit role name and description">
                            <i class="fas fa-pen me-1"></i>Edit role
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-primary" data-admin-customize-role="${rid}" title="Choose which sidebar modules this role can open">
                            <i class="fas fa-sliders-h me-1"></i>Customize
                        </button>
                    </div>
                </td>
            </tr>
        `;
            }).join('');
            if (scope.selectedRoleId) scope.highlightRoleRow(scope.selectedRoleId);
        },

        highlightRoleRow: (roleId) => {
            document.querySelectorAll('tr.js-admin-role-row').forEach(function (tr) {
                tr.classList.toggle('table-active', String(tr.getAttribute('data-role-id')) === String(roleId));
            });
        },

        clearRoleDetail: () => {
            const scope = _adminGrid;
            scope.selectedRoleId = null;
            scope.adminAllFeatures = [];
            scope.adminRoleFeatureIdMap = {};
            document.querySelectorAll('tr.js-admin-role-row').forEach(function (tr) { tr.classList.remove('table-active'); });
            var tbody = document.getElementById('adminFeaturesTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Open this dialog from a role\'s Customize action.</td></tr>';
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
            scope.selectedRoleId = roleId;
            scope.highlightRoleRow(roleId);
            var role = scope.data.roles.find(function (r) { return String(r.id) === String(roleId); });
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
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading…</td></tr>';
            try {
                var results = await Promise.all([
                    dataFunctions.getFeatures(),
                    dataFunctions.getRoleFeatures()
                ]);
                var featuresResponse = results[0];
                var allRoleFeatures = results[1];
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
                scope.renderAdminFeatureRows();
                scope.updateAdminFeatureSummary();
            } catch (error) {
                console.error('[Admin] Features load error:', error);
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-4">Could not load features.</td></tr>';
            }
        },

        renderAdminFeatureRows: () => {
            const scope = _adminGrid;
            var tbody = document.getElementById('adminFeaturesTableBody');
            if (!tbody) return;
            if (!scope.adminAllFeatures.length) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">No features defined.</td></tr>';
                return;
            }
            tbody.innerHTML = scope.adminAllFeatures.map(function (feature) {
                var isEnabled = Object.prototype.hasOwnProperty.call(scope.adminRoleFeatureIdMap, String(feature.id));
                var checkedAttr = isEnabled ? ' checked' : '';
                var fk = escapeHtml(feature.key || '');
                var fn = escapeHtml(feature.name || '');
                var fd = escapeHtml(feature.description || '');
                return '<tr class="feature-row">' +
                    '<td class="text-center">' +
                    '<div class="form-check d-flex justify-content-center mb-0">' +
                    '<input class="form-check-input admin-feature-checkbox" type="checkbox"' +
                    ' data-feature-id="' + feature.id + '" data-feature-key="' + fk + '"' + checkedAttr + '>' +
                    '</div></td>' +
                    '<td class="fw-medium">' + fn + '</td>' +
                    '<td><code>' + fk + '</code></td>' +
                    '<td class="text-muted small">' + fd + '</td>' +
                    '</tr>';
            }).join('');
        },

        updateAdminFeatureSummary: () => {
            const scope = _adminGrid;
            var summaryEl = document.getElementById('adminFeatureSummary');
            if (!summaryEl) return;
            var total = scope.adminAllFeatures.length;
            var enabled = scope.adminAllFeatures.filter(function (f) {
                return Object.prototype.hasOwnProperty.call(scope.adminRoleFeatureIdMap, String(f.id));
            }).length;
            summaryEl.style.display = '';
            summaryEl.innerHTML = '<span class="badge bg-primary me-2">' + enabled + ' / ' + total + '</span>' +
                '<span class="text-muted">modules enabled for this role</span>';
        },

        toggleAdminFeature: async (featureId, _featureKey, enabled, $checkbox) => {
            const scope = _adminGrid;
            if (!scope.selectedRoleId || !featureId) return;
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
                if (typeof Session !== 'undefined' && Session.remove) Session.remove('featureKeys');
                scope.updateAdminFeatureSummary();
                var user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
                var currentRoleId = user && user.role_id ? user.role_id : null;
                if (currentRoleId && String(currentRoleId) === String(scope.selectedRoleId)) {
                    if (typeof authService !== 'undefined' && authService.fetchAndCacheFeatures) {
                        authService.fetchAndCacheFeatures(currentRoleId);
                    } else if (typeof menuFilter !== 'undefined' && menuFilter.refresh) {
                        menuFilter.refresh();
                    }
                }
            } catch (error) {
                console.error('[Admin] Feature toggle error:', error);
                scope.showNotification('Error saving: ' + (error.message || ''), 'error');
                $checkbox.prop('checked', !enabled);
            } finally {
                $checkbox.prop('disabled', false);
            }
        },

        loadAdminPermissions: async (roleId) => {
            const scope = _adminGrid;
            if (!roleId || !dataFunctions.getRolePermissionsFiltered) return;
            var tbody = document.getElementById('adminPermissionsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading…</td></tr>';
            try {
                var filters = { roleId: roleId };
                if (scope.adminPermSearchTerm) filters.searchTerm = scope.adminPermSearchTerm;
                var rows = await dataFunctions.getRolePermissionsFiltered(filters);
                scope.adminPermissionRows = Array.isArray(rows) ? rows : [];
                scope.adminPermCurrentPage = 1;
                scope.renderAdminPermissionsPage();
            } catch (e) {
                console.error('[Admin] permissions', e);
                if (tbody) tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger py-3">Could not load.</td></tr>';
            }
        },

        renderAdminPermissionsPage: () => {
            const scope = _adminGrid;
            var tbody = document.getElementById('adminPermissionsTableBody');
            if (!tbody) return;
            var rows = scope.adminPermissionRows;
            if (!rows.length) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No rows for this role.</td></tr>';
                document.getElementById('adminPermPagination').innerHTML = '';
                return;
            }
            var start = (scope.adminPermCurrentPage - 1) * scope.adminPermPerPage;
            var slice = rows.slice(start, start + scope.adminPermPerPage);
            tbody.innerHTML = slice.map(function (p) {
                var pid = escapeHtml(String(p.id));
                return '<tr class="js-admin-perm-row" data-permission-id="' + pid + '">' +
                    '<td><code>' + escapeHtml(p.object_name || '') + '</code></td>' +
                    '<td>' + escapeHtml(p.object_type || '') + '</td>' +
                    '<td>' + escapeHtml(p.operation || '') + '</td>' +
                    '<td><button type="button" class="btn btn-sm btn-outline-secondary js-admin-perm-edit" data-permission-id="' + pid + '">Edit</button></td>' +
                    '</tr>';
            }).join('');
            scope.renderAdminPermPagination(Math.ceil(rows.length / scope.adminPermPerPage));
        },

        renderAdminPermPagination: (totalPages) => {
            const scope = _adminGrid;
            var ul = document.getElementById('adminPermPagination');
            if (!ul) return;
            if (totalPages <= 1) {
                ul.innerHTML = '';
                return;
            }
            var c = scope.adminPermCurrentPage;
            var html = '';
            html += '<li class="page-item' + (c <= 1 ? ' disabled' : '') + '">' +
                (c <= 1 ? '<span class="page-link">Prev</span>' : '<a class="page-link" href="#" data-page="' + (c - 1) + '">Prev</a>') + '</li>';
            for (var i = 1; i <= totalPages; i++) {
                if (i === c) html += '<li class="page-item active"><span class="page-link">' + i + '</span></li>';
                else html += '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
            }
            html += '<li class="page-item' + (c >= totalPages ? ' disabled' : '') + '">' +
                (c >= totalPages ? '<span class="page-link">Next</span>' : '<a class="page-link" href="#" data-page="' + (c + 1) + '">Next</a>') + '</li>';
            ul.innerHTML = html;
        },

        reloadEmbeddedPermissionsIfActive: () => {
            const scope = _adminGrid;
            var roleModal = document.getElementById('roleModal');
            var collapse = document.getElementById('roleModalAdvancedPermsCollapse');
            var rid = scope.getEditingRoleIdForPermPanel();
            if (roleModal && roleModal.classList.contains('show') && collapse && collapse.classList.contains('show') && rid) {
                scope.loadAdminPermissions(rid);
            }
        },

        setupFormHandlersOnce: () => {
            const scope = _adminGrid;

            const userRoleFilter = document.getElementById('userRoleFilter');
            if (userRoleFilter && !userRoleFilter.dataset.adminFilterBound) {
                userRoleFilter.dataset.adminFilterBound = '1';
                userRoleFilter.addEventListener('change', function () {
                    const filterValue = this.value;
                    if (filterValue) {
                        const filtered = scope.data.users.filter((u) => u.role === filterValue);
                        scope.renderUsersTable(filtered);
                    } else {
                        scope.renderUsersTable(scope.data.users);
                    }
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
                var permEdit = e.target.closest('.js-admin-perm-edit');
                if (permEdit) {
                    e.preventDefault();
                    var pid = permEdit.getAttribute('data-permission-id');
                    var perm = scope.adminPermissionRows.find(function (p) { return String(p.id) === String(pid); });
                    if (perm && typeof _modal_role_permission !== 'undefined' && _modal_role_permission.show) {
                        _modal_role_permission.show(perm);
                    }
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
            var raw = {
                id: user.id,
                username: user.username,
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
            await scope.ensureModalsLoaded();
            if (typeof _modal_role !== 'undefined' && _modal_role.show) {
                _modal_role.show(role);
            } else {
                scope.showNotification('Role editor is not loaded yet.', 'warning');
            }
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
