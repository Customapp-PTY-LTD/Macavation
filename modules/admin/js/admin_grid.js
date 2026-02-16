/**
 * System Administration Module - Macadamia Management System
 * User Management, Roles & Permissions, System Configuration
 */

let adminData = {
    users: [],
    roles: [],
    permissions: []
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
        
        // Load initial data
        try {
            await loadSummary();
        } catch (error) {
            console.error('Error loading summary:', error);
        }
        
        try {
            await loadUsers();
        } catch (error) {
            console.error('Error loading users:', error);
        }
        
        try {
            await loadRoles();
        } catch (error) {
            console.error('Error loading roles:', error);
        }
        
        // Set up form handlers
            setupFormHandlers();
    } catch (error) {
        console.error('Error initializing Admin Grid:', error);
    }
}

/**
 * Handle tab switching
 */
function handleTabSwitch(targetId) {
    switch(targetId) {
        case '#users':
            loadUsers();
            break;
        case '#roles':
            loadRoles();
            break;
        case '#system':
            // System configuration - no action needed yet
            break;
    }
}

/**
 * Load summary statistics
 */
async function loadSummary() {
    try {
        // Load users count
        if (typeof dataFunctions !== 'undefined' && dataFunctions.getUsers) {
                try {
                    const users = await dataFunctions.getUsers();
                    if (users && Array.isArray(users)) {
                    const activeUsers = users.filter(u => u.is_active !== false);
                    document.getElementById('totalUsers').textContent = activeUsers.length;
                    }
                } catch (error) {
                    // Handle permission errors gracefully - don't show error, just set to 0
                    const errorMessage = error.message || error.toString() || '';
                    const isPermissionError = error.status === 403 || 
                                              errorMessage.includes('Access denied') ||
                                              errorMessage.includes('operation EXECUTE is not allowed') ||
                                              errorMessage.includes('permission');
                    if (!isPermissionError) {
                        console.warn('Could not load users count:', error);
                    }
                    // Set to 0 if permission error or other error
                    const totalUsersEl = document.getElementById('totalUsers');
                    if (totalUsersEl) totalUsersEl.textContent = '0';
                }
            }
            
        // Load roles count
        if (typeof dataFunctions !== 'undefined' && dataFunctions.getRoles) {
            try {
                const roles = await dataFunctions.getRoles();
                if (roles && Array.isArray(roles)) {
                    document.getElementById('totalRoles').textContent = roles.length;
                }
            } catch (error) {
                // Handle permission errors gracefully - don't show error, just set to 0
                const errorMessage = error.message || error.toString() || '';
                const isPermissionError = error.status === 403 || 
                                          errorMessage.includes('Access denied') ||
                                          errorMessage.includes('operation EXECUTE is not allowed') ||
                                          errorMessage.includes('permission');
                if (!isPermissionError) {
                    console.warn('Could not load roles count:', error);
                }
                // Set to 0 if permission error or other error
                const totalRolesEl = document.getElementById('totalRoles');
                if (totalRolesEl) totalRolesEl.textContent = '0';
            }
        }
        
        // Load permissions count (placeholder)
        document.getElementById('totalPermissions').textContent = '0';
        
        // Active sessions (placeholder)
        document.getElementById('activeSessions').textContent = '0';
        
    } catch (error) {
        console.error('Error loading summary:', error);
    }
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
            adminData.users = [];
        } else {
            adminData.users = users.map(user => ({
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
        
        renderUsersTable(adminData.users);
        updateUserStats(adminData.users);
        updateRoleFilter();
        
    } catch (error) {
        console.error('Error loading users:', error);
        
        // Check if it's a permission error
        const errorMessage = error.message || error.toString() || '';
        const isPermissionError = error.status === 403 || 
                                  errorMessage.includes('Access denied') ||
                                  errorMessage.includes('operation EXECUTE is not allowed') ||
                                  errorMessage.includes('permission');
        
        if (isPermissionError) {
            // Show user-friendly permission error message
            showNotification('You do not have permission to view users. Please contact your administrator.', 'warning');
            // Set empty users array and render empty state
            adminData.users = [];
            renderUsersTable(adminData.users);
            updateUserStats(adminData.users);
            updateRoleFilter();
        } else {
            // Show generic error for other issues
            showNotification('Failed to load users. Please try again later.', 'error');
        }
    }
}

/**
 * Render users table
 */
function renderUsersTable(users) {
    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    
    if (!users || users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No users found</td></tr>';
        return;
    }
    
    tbody.innerHTML = users.map(user => {
        const roleBadge = getRoleBadge(user.role);
        const statusBadge = user.status === 'active' 
            ? '<span class="badge bg-success">Active</span>'
            : '<span class="badge bg-secondary">Inactive</span>';
        
        const lastLogin = user.last_login 
            ? new Date(user.last_login).toLocaleDateString()
            : 'Never';
        
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
                    <button class="btn btn-sm btn-outline-primary" onclick="editUser('${user.id}')" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="manageUserPermissions('${user.id}')" title="Permissions">
                        <i class="bi bi-key"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

/**
 * Get role badge HTML
 */
function getRoleBadge(roleName) {
    const roleMap = {
        'super_user': { label: 'Super User', color: 'danger' },
        'admin': { label: 'Admin', color: 'primary' },
        'user': { label: 'User', color: 'info' },
        'viewer': { label: 'Viewer', color: 'secondary' }
    };
    
    const role = roleMap[roleName] || { label: roleName, color: 'secondary' };
    return `<span class="badge bg-${role.color}">${role.label}</span>`;
}

/**
 * Update user statistics
 */
function updateUserStats(users) {
    const container = document.getElementById('userStatisticsContainer');
    if (!container) return;
    
    const stats = {};
    users.forEach(user => {
        const role = user.role || 'unknown';
        stats[role] = (stats[role] || 0) + 1;
    });
    
    container.innerHTML = Object.entries(stats).map(([role, count]) => {
        const roleInfo = getRoleInfo(role);
        return `
            <div class="mb-2">
                <div class="d-flex justify-content-between">
                    <small>${roleInfo.label}:</small>
                    <strong>${count}</strong>
                </div>
            </div>
        `;
    }).join('') || '<p class="text-muted small mb-0">No statistics available</p>';
}

/**
 * Get role info
 */
function getRoleInfo(roleName) {
    const roleMap = {
        'super_user': { label: 'Super User' },
        'admin': { label: 'Admin' },
        'user': { label: 'User' },
        'viewer': { label: 'Viewer' }
    };
    
    return roleMap[roleName] || { label: roleName };
}

/**
 * Update role filter dropdown
 */
function updateRoleFilter() {
    const filter = document.getElementById('userRoleFilter');
    if (!filter) return;
    
    const roles = [...new Set(adminData.users.map(u => u.role))];
    const currentValue = filter.value;
    
    filter.innerHTML = '<option value="">All Roles</option>' + 
        roles.map(role => {
            const roleInfo = getRoleInfo(role);
            return `<option value="${role}">${roleInfo.label}</option>`;
        }).join('');
    
    if (currentValue) {
        filter.value = currentValue;
    }
}

/**
 * Load roles list
 */
async function loadRoles() {
    try {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getRoles) {
            console.error('dataFunctions.getRoles is not available');
            return;
        }
        
        const roles = await dataFunctions.getRoles();
        
        if (!roles || roles.length === 0) {
            adminData.roles = [];
        } else {
            adminData.roles = roles.map(role => ({
                id: role.id,
                role_name: role.role_name || role.name,
                description: role.description || role.role_description || '',
                is_active: role.is_active !== false
            }));
        }
        
        renderRolesTable(adminData.roles);
        renderRoleDefinitions(adminData.roles);
        updateRoleSelects(adminData.roles);
        
    } catch (error) {
        console.error('Error loading roles:', error);
        
        // Check if it's a permission error
        const errorMessage = error.message || error.toString() || '';
        const isPermissionError = error.status === 403 || 
                                  errorMessage.includes('Access denied') ||
                                  errorMessage.includes('operation EXECUTE is not allowed') ||
                                  errorMessage.includes('permission');
        
        if (isPermissionError) {
            // Show user-friendly permission error message
            showNotification('You do not have permission to view roles. Please contact your administrator.', 'warning');
            // Set empty roles array and render empty state
            adminData.roles = [];
            renderRolesTable(adminData.roles);
            renderRoleDefinitions(adminData.roles);
            updateRoleSelects(adminData.roles);
        } else {
            // Show generic error for other issues
            showNotification('Failed to load roles. Please try again later.', 'error');
        }
    }
}

/**
 * Render roles table
 */
function renderRolesTable(roles) {
    const tbody = document.getElementById('rolesTableBody');
    if (!tbody) return;
    
    if (!roles || roles.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-muted">No roles found</td></tr>';
        return;
    }
    
    tbody.innerHTML = roles.map(role => {
        const userCount = adminData.users.filter(u => u.role === role.role_name).length;
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
                        <button class="btn btn-sm btn-outline-primary" onclick="editRole('${role.id}')" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="manageRolePermissions('${role.id}')" title="Permissions">
                            <i class="bi bi-key"></i>
                    </button>
                </div>
            </td>
        </tr>
        `;
    }).join('');
}

/**
 * Render role definitions
 */
function renderRoleDefinitions(roles) {
    const container = document.getElementById('roleDefinitionsContainer');
    if (!container) return;
    
    if (!roles || roles.length === 0) {
        container.innerHTML = '<p class="text-muted small mb-0">No roles defined</p>';
        return;
    }
    
    container.innerHTML = roles.map(role => {
        const roleBadge = getRoleBadge(role.role_name);
        return `
            <div class="mb-3">
                <div class="d-flex align-items-center mb-2">
                    ${roleBadge}
                </div>
                <small class="text-muted">${role.description || 'No description'}</small>
            </div>
        `;
    }).join('');
}

/**
 * Update role selects in forms
 */
function updateRoleSelects(roles) {
    const selects = ['userRoleSelect'];
    
    selects.forEach(selectId => {
        const select = document.getElementById(selectId);
        if (select) {
            const currentValue = select.value;
            select.innerHTML = '<option value="">Select role...</option>' + 
                roles.filter(r => r.is_active).map(role => 
                    `<option value="${role.id}">${role.role_name}</option>`
                ).join('');
            
            if (currentValue) {
                select.value = currentValue;
            }
        }
    });
}

/**
 * Setup form handlers
 */
function setupFormHandlers() {
    // User role filter
    const userRoleFilter = document.getElementById('userRoleFilter');
    if (userRoleFilter) {
        userRoleFilter.addEventListener('change', function() {
            const filterValue = this.value;
            if (filterValue) {
                const filtered = adminData.users.filter(u => u.role === filterValue);
                renderUsersTable(filtered);
            } else {
                renderUsersTable(adminData.users);
            }
        });
    }

    // Reset add user modal when closed so "Add User" opens clean
    const addUserModalEl = document.getElementById('addUserModal');
    if (addUserModalEl) {
        addUserModalEl.addEventListener('hidden.bs.modal', function() {
            document.getElementById('editUserId').value = '';
            const form = document.getElementById('addUserForm');
            if (form) form.reset();
            const titleEl = addUserModalEl.querySelector('.modal-title');
            if (titleEl) titleEl.textContent = 'Add New User';
            const submitBtn = document.getElementById('addUserModalSubmitBtn');
            if (submitBtn) {
                submitBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Create User';
            }
        });
    }
}

/**
 * Submit user form (create or update)
 */
async function submitUserForm() {
    try {
        const form = document.getElementById('addUserForm');
        if (!form) return;

        const editIdEl = document.getElementById('editUserId');
        const isEdit = editIdEl && editIdEl.value;

        const formData = new FormData(form);
        const userData = {
            first_name: formData.get('first_name'),
            last_name: formData.get('last_name'),
            email: formData.get('email'),
            username: formData.get('email') || null,
            phone_number: formData.get('phone_number') || null,
            role_id: formData.get('role_id') || null,
            is_active: formData.get('is_active') === 'true'
        };

        if (isEdit) {
            if (typeof dataFunctions !== 'undefined' && dataFunctions.updateUser) {
                const result = await dataFunctions.updateUser(editIdEl.value, userData);
                if (result && result.success) {
                    showNotification('User updated successfully', 'success');
                    const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
                    if (modal) modal.hide();
                    editIdEl.value = '';
                    form.reset();
                    await loadUsers();
                    await loadSummary();
                } else {
                    showNotification('Failed to update user', 'error');
                }
            } else {
                showNotification('User update not available', 'error');
            }
        } else if (typeof dataFunctions !== 'undefined' && dataFunctions.createUser) {
            const result = await dataFunctions.createUser(userData);
            if (result && result.success) {
                showNotification('User created successfully', 'success');
                const modal = bootstrap.Modal.getInstance(document.getElementById('addUserModal'));
                if (modal) modal.hide();
                form.reset();
                await loadUsers();
                await loadSummary();
            } else {
                showNotification('Failed to create user', 'error');
            }
        } else {
            showNotification('User creation not available', 'error');
        }
    } catch (error) {
        console.error('Error submitting user form:', error);
        showNotification('Error saving user: ' + error.message, 'error');
    }
}

/**
 * Submit role form
 */
async function submitRoleForm() {
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
                showNotification('Role created successfully', 'success');
                const modal = bootstrap.Modal.getInstance(document.getElementById('addRoleModal'));
                if (modal) modal.hide();
    form.reset();
                await loadRoles();
                await loadSummary();
            } else {
                showNotification('Failed to create role', 'error');
            }
        } else {
            showNotification('Role creation not available', 'error');
        }
    } catch (error) {
        console.error('Error submitting role form:', error);
        showNotification('Error creating role: ' + error.message, 'error');
    }
}

/**
 * Normalize user from API (may be wrapped or snake_case). Handles last_name and phone_number.
 */
function normalizeUserForForm(raw) {
    if (!raw) return null;
    const u = Array.isArray(raw) ? raw[0] : (raw.get_user_by_id || raw);
    if (!u) return null;
    const last = (u.last_name ?? u.lastName ?? u.lastname ?? '').toString().trim();
    const phone = (u.phone_number ?? u.phone ?? u.phoneNumber ?? '').toString().trim();
    return {
        id: u.id,
        first_name: u.first_name ?? u.firstName ?? u.username ?? (u.email && u.email.split('@')[0]) ?? '',
        last_name: last,
        email: u.email ?? '',
        phone_number: phone,
        role_id: u.role_id ?? u.roleId ?? '',
        is_active: u.is_active !== false
    };
}

/**
 * Merge table user with API user so we have first_name, last_name, phone_number, etc.
 */
function mergeUserForForm(tableUser, apiUser) {
    if (!apiUser) return tableUser;
    return {
        id: apiUser.id ?? tableUser?.id,
        first_name: (apiUser.first_name != null && apiUser.first_name !== '') ? apiUser.first_name : (tableUser?.first_name || ''),
        last_name: (apiUser.last_name != null && apiUser.last_name !== '') ? apiUser.last_name : (tableUser?.last_name || ''),
        email: apiUser.email ?? tableUser?.email ?? '',
        phone_number: (apiUser.phone_number != null && apiUser.phone_number !== '') ? apiUser.phone_number : (tableUser?.phone_number || ''),
        role_id: apiUser.role_id ?? tableUser?.role_id ?? '',
        is_active: apiUser.is_active !== undefined ? apiUser.is_active : (tableUser?.status !== 'inactive')
    };
}

/**
 * Edit user: fetch full user (so last_name and phone_number are included), then fill form and show modal
 */
async function editUser(userId) {
    try {
        const form = document.getElementById('addUserForm');
        const editIdEl = document.getElementById('editUserId');
        if (!form || !editIdEl) return;

        const tableUser = (adminData.users || []).find(u => u.id === userId);
        let user = tableUser ? {
            id: tableUser.id,
            first_name: tableUser.first_name || '',
            last_name: tableUser.last_name || '',
            email: tableUser.email || '',
            phone_number: tableUser.phone_number || '',
            role_id: tableUser.role_id || '',
            is_active: tableUser.status !== 'inactive'
        } : null;

        if (typeof dataFunctions !== 'undefined' && dataFunctions.getUserById) {
            const raw = await dataFunctions.getUserById(userId, null, true);
            const apiUser = normalizeUserForForm(raw);
            user = mergeUserForForm(user, apiUser) || apiUser;
        }
        if (!user) {
            showNotification('User not found', 'error');
            return;
        }

        const isActive = user.is_active !== undefined ? user.is_active : (user.status !== 'inactive');
        const roleId = user.role_id || '';

        editIdEl.value = userId;
        form.querySelector('[name="first_name"]').value = user.first_name || '';
        form.querySelector('[name="last_name"]').value = user.last_name || '';
        form.querySelector('[name="email"]').value = user.email || '';
        form.querySelector('[name="phone_number"]').value = user.phone_number || '';
        form.querySelector('[name="role_id"]').value = roleId;
        form.querySelector('[name="is_active"]').value = isActive ? 'true' : 'false';

        const modalEl = document.getElementById('addUserModal');
        const titleEl = modalEl ? modalEl.querySelector('.modal-title') : null;
        const submitBtn = document.getElementById('addUserModalSubmitBtn');
        if (titleEl) titleEl.textContent = 'Edit User';
        if (submitBtn) submitBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Update User';

        const modal = new bootstrap.Modal(modalEl);
        modal.show();
    } catch (error) {
        console.error('Error opening edit user:', error);
        showNotification('Error loading user: ' + (error.message || 'Unknown error'), 'error');
    }
}

/**
 * Manage user permissions
 */
function manageUserPermissions(userId) {
    console.log('Manage permissions for user:', userId);
    showNotification('Permissions management coming soon', 'info');
}

/**
 * Edit role
 */
function editRole(roleId) {
    console.log('Edit role:', roleId);
    showNotification('Role editing coming soon', 'info');
}

/**
 * Manage role permissions
 */
function manageRolePermissions(roleId) {
    console.log('Manage permissions for role:', roleId);
    showNotification('Role permissions management coming soon', 'info');
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
