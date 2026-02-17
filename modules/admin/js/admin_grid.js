/**
 * System Administration Module - Macadamia Management System
 * User Management, Roles & Permissions, System Configuration
 * Pattern: IIFE, single global _adminGrid, arrow methods, const scope for same-module calls.
 */
var _adminGrid = function () {
    'use strict';

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    return {
        data: {
            users: [],
            roles: [],
            permissions: []
        },

        init: async () => {
            const scope = _adminGrid;
            try {
                console.log('Initializing Admin Grid Module...');

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

                const tabElements = document.querySelectorAll('button[data-bs-toggle="tab"]');
                tabElements.forEach((tab) => {
                    tab.addEventListener('shown.bs.tab', function (event) {
                        const targetId = event.target.getAttribute('data-bs-target');
                        console.log('Tab switched to:', targetId);
                        scope.handleTabSwitch(targetId);
                    });
                });

                try {
                    await scope.loadSummary();
                } catch (error) {
                    console.error('Error loading summary:', error);
                }
                try {
                    await scope.loadUsers();
                } catch (error) {
                    console.error('Error loading users:', error);
                }
                try {
                    await scope.loadRoles();
                } catch (error) {
                    console.error('Error loading roles:', error);
                }

                scope.setupFormHandlers();
            } catch (error) {
                console.error('Error initializing Admin Grid:', error);
            }
        },

        handleTabSwitch: (targetId) => {
            const scope = _adminGrid;
            switch (targetId) {
                case '#users':
                    scope.loadUsers();
                    break;
                case '#roles':
                    scope.loadRoles();
                    break;
                case '#system':
                    break;
            }
        },

        loadSummary: async () => {
            const scope = _adminGrid;
            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getUsers) {
                    try {
                        const users = await dataFunctions.getUsers();
                        if (users && Array.isArray(users)) {
                            const activeUsers = users.filter((u) => u.is_active !== false);
                            const el = document.getElementById('totalUsers');
                            if (el) el.textContent = activeUsers.length;
                        }
                    } catch (error) {
                        const errorMessage = error.message || error.toString() || '';
                        const isPermissionError = error.status === 403 ||
                            errorMessage.includes('Access denied') ||
                            errorMessage.includes('operation EXECUTE is not allowed') ||
                            errorMessage.includes('permission');
                        if (!isPermissionError) console.warn('Could not load users count:', error);
                        const totalUsersEl = document.getElementById('totalUsers');
                        if (totalUsersEl) totalUsersEl.textContent = '0';
                    }
                }

                if (typeof dataFunctions !== 'undefined' && dataFunctions.getRoles) {
                    try {
                        const roles = await dataFunctions.getRoles();
                        if (roles && Array.isArray(roles)) {
                            const el = document.getElementById('totalRoles');
                            if (el) el.textContent = roles.length;
                        }
                    } catch (error) {
                        const errorMessage = error.message || error.toString() || '';
                        const isPermissionError = error.status === 403 ||
                            errorMessage.includes('Access denied') ||
                            errorMessage.includes('operation EXECUTE is not allowed') ||
                            errorMessage.includes('permission');
                        if (!isPermissionError) console.warn('Could not load roles count:', error);
                        const totalRolesEl = document.getElementById('totalRoles');
                        if (totalRolesEl) totalRolesEl.textContent = '0';
                    }
                }

                const totalPermEl = document.getElementById('totalPermissions');
                if (totalPermEl) totalPermEl.textContent = '0';
                const activeSessEl = document.getElementById('activeSessions');
                if (activeSessEl) activeSessEl.textContent = '0';
            } catch (error) {
                console.error('Error loading summary:', error);
            }
        },

        loadUsers: async () => {
            const scope = _adminGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getUsers) {
                    console.error('dataFunctions.getUsers is not available');
                    return;
                }

                const users = await dataFunctions.getUsers();

                if (!users || users.length === 0) {
                    scope.data.users = [];
                } else {
                    scope.data.users = users.map((user) => ({
                        id: user.id,
                        first_name: user.first_name || user.username || user.email?.split('@')[0] || 'User',
                        last_name: user.last_name || '',
                        email: user.email,
                        role: user.role || user.role_name || 'user',
                        role_id: user.role_id,
                        status: user.is_active !== false ? 'active' : 'inactive',
                        last_login: user.last_login || null,
                        phone_number: user.phone_number || null
                    }));
                }

                scope.renderUsersTable(scope.data.users);
                scope.updateUserStats(scope.data.users);
                scope.updateRoleFilter();
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
                    scope.renderUsersTable(scope.data.users);
                    scope.updateUserStats(scope.data.users);
                    scope.updateRoleFilter();
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
                tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No users found</td></tr>';
                return;
            }

            tbody.innerHTML = users.map((user) => {
                const roleBadge = scope.getRoleBadge(user.role);
                const statusBadge = user.status === 'active'
                    ? '<span class="badge bg-success">Active</span>'
                    : '<span class="badge bg-secondary">Inactive</span>';
                const lastLogin = user.last_login ? new Date(user.last_login).toLocaleDateString() : 'Never';
                return `
        <tr>
            <td>
                <strong>${user.first_name} ${user.last_name}</strong>
                ${user.phone_number ? `<br><small class="text-muted">${user.phone_number}</small>` : ''}
            </td>
            <td>${user.email}</td>
            <td>${roleBadge}</td>
            <td>${statusBadge}</td>
            <td><small class="text-muted">${lastLogin}</small></td>
            <td>
                <div class="btn-group" role="group">
                    <button class="btn btn-sm btn-outline-primary" data-admin-edit-user="${user.id}" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" data-admin-manage-user-perms="${user.id}" title="Permissions">
                        <i class="bi bi-key"></i>
                    </button>
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
            return `<span class="badge bg-${role.color}">${role.label}</span>`;
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

            filter.innerHTML = '<option value="">All Roles</option>' +
                roles.map((role) => {
                    const roleInfo = scope.getRoleInfo(role);
                    return `<option value="${role}">${roleInfo.label}</option>`;
                }).join('');

            if (currentValue) filter.value = currentValue;
        },

        loadRoles: async () => {
            const scope = _adminGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getRoles) {
                    console.error('dataFunctions.getRoles is not available');
                    return;
                }

                const roles = await dataFunctions.getRoles();

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

                scope.renderRolesTable(scope.data.roles);
                scope.renderRoleDefinitions(scope.data.roles);
                scope.updateRoleSelects(scope.data.roles);
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
                    scope.renderRolesTable(scope.data.roles);
                    scope.renderRoleDefinitions(scope.data.roles);
                    scope.updateRoleSelects(scope.data.roles);
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
                tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No roles found</td></tr>';
                return;
            }

            tbody.innerHTML = roles.map((role) => {
                const userCount = scope.data.users.filter((u) => u.role === role.role_name).length;
                const statusBadge = role.is_active
                    ? '<span class="badge bg-success">Active</span>'
                    : '<span class="badge bg-secondary">Inactive</span>';
                return `
            <tr>
                <td><strong>${role.role_name}</strong></td>
                <td><small class="text-muted">${role.description || 'No description'}</small></td>
                <td><span class="badge bg-info">${userCount} users</span></td>
                <td>${statusBadge}</td>
                <td>
                    <div class="btn-group" role="group">
                        <button class="btn btn-sm btn-outline-primary" data-admin-edit-role="${role.id}" title="Edit">
                            <i class="bi bi-pencil"></i>
                        </button>
                        <button class="btn btn-sm btn-outline-secondary" data-admin-manage-role-perms="${role.id}" title="Permissions">
                            <i class="bi bi-key"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
            }).join('');
        },

        renderRoleDefinitions: (roles) => {
            const scope = _adminGrid;
            const container = document.getElementById('roleDefinitionsContainer');
            if (!container) return;

            if (!roles || roles.length === 0) {
                container.innerHTML = '<p class="text-muted small mb-0">No roles defined</p>';
                return;
            }

            container.innerHTML = roles.map((role) => {
                const roleBadge = scope.getRoleBadge(role.role_name);
                return `
            <div class="mb-3">
                <div class="d-flex align-items-center mb-2">${roleBadge}</div>
                <small class="text-muted">${role.description || 'No description'}</small>
            </div>
        `;
            }).join('');
        },

        updateRoleSelects: (roles) => {
            const selectIds = ['userRoleSelect'];
            selectIds.forEach((selectId) => {
                const select = document.getElementById(selectId);
                if (select) {
                    const currentValue = select.value;
                    select.innerHTML = '<option value="">Select role...</option>' +
                        roles.filter((r) => r.is_active).map((role) =>
                            `<option value="${role.id}">${role.role_name}</option>`
                        ).join('');
                    if (currentValue) select.value = currentValue;
                }
            });
        },

        setupFormHandlers: () => {
            const scope = _adminGrid;

            const userRoleFilter = document.getElementById('userRoleFilter');
            if (userRoleFilter) {
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

            document.addEventListener('click', (e) => {
                const editUserBtn = e.target.closest('[data-admin-edit-user]');
                if (editUserBtn) {
                    e.preventDefault();
                    scope.editUser(editUserBtn.getAttribute('data-admin-edit-user'));
                    return;
                }
                const manageUserPermsBtn = e.target.closest('[data-admin-manage-user-perms]');
                if (manageUserPermsBtn) {
                    e.preventDefault();
                    scope.manageUserPermissions(manageUserPermsBtn.getAttribute('data-admin-manage-user-perms'));
                    return;
                }
                const editRoleBtn = e.target.closest('[data-admin-edit-role]');
                if (editRoleBtn) {
                    e.preventDefault();
                    scope.editRole(editRoleBtn.getAttribute('data-admin-edit-role'));
                    return;
                }
                const manageRolePermsBtn = e.target.closest('[data-admin-manage-role-perms]');
                if (manageRolePermsBtn) {
                    e.preventDefault();
                    scope.manageRolePermissions(manageRolePermsBtn.getAttribute('data-admin-manage-role-perms'));
                }
            });
        },

        submitUserForm: async () => {
            const scope = _adminGrid;
            try {
                const form = document.getElementById('addUserForm');
                if (!form) return;

                const formData = new FormData(form);
                const userData = {
                    first_name: formData.get('first_name'),
                    last_name: formData.get('last_name'),
                    email: formData.get('email'),
                    phone_number: formData.get('phone_number') || null,
                    role_id: formData.get('role_id'),
                    is_active: formData.get('is_active') === 'true'
                };

                if (typeof dataFunctions !== 'undefined' && dataFunctions.createUser) {
                    const result = await dataFunctions.createUser(userData);
                    if (result && result.success) {
                        scope.showNotification('User created successfully', 'success');
                        const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
                        if (modal) modal.hide();
                        form.reset();
                        await scope.loadUsers();
                        await scope.loadSummary();
                    } else {
                        scope.showNotification('Failed to create user', 'error');
                    }
                } else {
                    scope.showNotification('User creation not available', 'error');
                }
            } catch (error) {
                console.error('Error submitting user form:', error);
                _adminGrid.showNotification('Error creating user: ' + error.message, 'error');
            }
        },

        submitRoleForm: async () => {
            const scope = _adminGrid;
            try {
                const form = document.getElementById('addRoleForm');
                if (!form) return;

                const formData = new FormData(form);
                const roleData = {
                    role_name: formData.get('role_name'),
                    description: formData.get('description') || null,
                    is_active: formData.get('is_active') === 'true'
                };

                if (typeof dataFunctions !== 'undefined' && dataFunctions.createRole) {
                    const result = await dataFunctions.createRole(roleData);
                    if (result && result.success) {
                        scope.showNotification('Role created successfully', 'success');
                        const modal = bootstrap.Modal.getInstance(document.getElementById('addRoleModal'));
                        if (modal) modal.hide();
                        form.reset();
                        await scope.loadRoles();
                        await scope.loadSummary();
                    } else {
                        scope.showNotification('Failed to create role', 'error');
                    }
                } else {
                    scope.showNotification('Role creation not available', 'error');
                }
            } catch (error) {
                console.error('Error submitting role form:', error);
                scope.showNotification('Error creating role: ' + error.message, 'error');
            }
        },

        editUser: (userId) => {
            console.log('Edit user:', userId);
            _adminGrid.showNotification('User editing coming soon', 'info');
        },

        manageUserPermissions: (userId) => {
            console.log('Manage permissions for user:', userId);
            _adminGrid.showNotification('Permissions management coming soon', 'info');
        },

        editRole: (roleId) => {
            console.log('Edit role:', roleId);
            _adminGrid.showNotification('Role editing coming soon', 'info');
        },

        manageRolePermissions: (roleId) => {
            console.log('Manage permissions for role:', roleId);
            _adminGrid.showNotification('Role permissions management coming soon', 'info');
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

// Router entry point (unchanged contract)
var initializeAdminGrid = function () {
    if (typeof _adminGrid !== 'undefined' && _adminGrid.init) {
        return _adminGrid.init();
    }
};

// Form submit buttons call these by name from HTML
if (typeof window !== 'undefined') {
    window.submitUserForm = function () { return _adminGrid.submitUserForm(); };
    window.submitRoleForm = function () { return _adminGrid.submitRoleForm(); };
}
