/**
 * Role Permissions Grid Module
 * Handles role permissions management functionality with Supabase integration
 */

var _rolePermissionsGrid = function () {
    return {
        permissions: [],
        filteredPermissions: [],
        currentPage: 1,
        itemsPerPage: 10,
        editingPermission: null,
        searchTimeout: null,

        init: function () {
            this.setupEventListeners();
            this.loadPermissions();
            this.loadRolesForDropdown();
        },

        setupEventListeners: function () {
            const scope = this;

            // Search functionality - now uses server-side filtering
            $('#searchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterPermissions();
                }, 500); // Increased delay for server-side search
            });

            // Filter functionality
            $('#filterRole').on('change', function () {
                scope.filterPermissions();
            });

            $('#filterObjectType').on('change', function () {
                scope.filterPermissions();
            });

            $('#filterOperation').on('change', function () {
                scope.filterPermissions();
            });

            $('#filterStatus').on('change', function () {
                scope.filterPermissions();
            });

            // Pagination
            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const page = parseInt($(this).data('page'));
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderPermissions();
                }
            });

            // Add permission button
            $('#addPermissionBtn').on('click', function () {
                scope.showAddPermissionModal();
            });

            // Edit permission (click on object name)
            $(document).on('click', '.object-name-link', function (e) {
                e.preventDefault();
                console.log('Object name link clicked');
                const permissionId = $(this).data('permission-id');
                console.log('Permission ID:', permissionId);
                if (!permissionId) {
                    console.error('No permission ID found');
                    return;
                }
                scope.editPermission(permissionId);
            });

            // Delete permission
            $(document).on('click', '.delete-permission-btn', function () {
                const permissionId = $(this).data('permission-id');
                scope.deletePermission(permissionId);
            });

            // Save permission form
            $('#savePermissionBtn').on('click', function () {
                scope.savePermission();
            });

            // Modal events
            $('#permissionModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });
        },

        loadPermissions: async function () {
            try {
                this.showLoading();
                const permissions = await dataFunctions.getRolePermissions();
                this.permissions = permissions;
                this.filteredPermissions = permissions;
                this.renderPermissions();
                this.hideLoading();
            } catch (error) {
                console.error('Error loading permissions:', error);
                this.showError('Error loading permissions: ' + error.message);
                this.hideLoading();
            }
        },

        loadRolesForDropdown_NEW: async function () {
            try {
                console.log('=== loadRolesForDropdown_NEW START (Role Permissions) ===');

                const response = await dataFunctions.getRoles();
                console.log('API Response received:', response);

                // Direct approach - use the response as-is since we know it's an array
                let roles = response;
                console.log('Using direct response as roles:', roles);
                console.log('Number of roles:', roles ? roles.length : 'undefined');

                if (!roles || !Array.isArray(roles) || roles.length === 0) {
                    console.error('No valid roles data!');
                    return;
                }

                console.log('First role sample:', roles[0]);

                // Populate dropdowns directly
                const roleSelects = ['cboRole', 'filterRole'];
                roleSelects.forEach(selectId => {
                    const select = document.getElementById(selectId);
                    if (select) {
                        let html = '<option value="">Select Role</option>';
                        if (selectId === 'filterRole') {
                            html = '<option value="">All Roles</option>';
                        }
                        roles.forEach(role => {
                            html += `<option value="${role.id}">${role.role_name}</option>`;
                        });
                        select.innerHTML = html;
                        console.log(`✅ Populated ${selectId} with ${roles.length} roles`);
                    }
                });

                console.log('=== loadRolesForDropdown COMPLETE (Role Permissions) ===');
            } catch (error) {
                console.error('❌ Error in loadRolesForDropdown (Role Permissions):', error);
            }
        },

        loadMockRoles: function () {
            const mockRoles = [
                { id: 'd57c236a-a9c1-4a2b-bc81-eff6af913560', role_name: 'Super Admin' },
                { id: 'd9976e2f-9095-4a4b-b407-626ca9b7e08e', role_name: 'Transport Manager' },
                { id: 'b300e442-8963-4777-a4f9-a28bfe2c0115', role_name: 'Fleet Supervisor' },
                { id: '623d54ee-e827-42ee-bf2e-0fcd7e7a506c', role_name: 'Driver' },
                { id: '61738554-d8f1-4561-a7cc-5ffb71dd0e07', role_name: 'Customer Service' },
                { id: '9176d35d-f256-4b4c-bdf1-104a0a5359bc', role_name: 'User' }
            ];

            const roleSelects = ['cboRole', 'filterRole'];
            roleSelects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    let html = '<option value="">Select Role</option>';
                    if (selectId === 'filterRole') {
                        html = '<option value="">All Roles</option>';
                    }
                    mockRoles.forEach(role => {
                        html += `<option value="${role.id}">${role.role_name}</option>`;
                    });
                    select.innerHTML = html;
                }
            });
        },

        filterPermissions: async function () {
            try {
                this.showLoading();

                const filters = {
                    searchTerm: $('#searchInput').val().trim() || null,
                    roleId: $('#filterRole').val() || null,
                    objectType: $('#filterObjectType').val() || null,
                    operation: $('#filterOperation').val() || null,
                    isActive: $('#filterStatus').val() ? ($('#filterStatus').val() === 'active') : null
                };

                // Remove null/empty values
                Object.keys(filters).forEach(key => {
                    if (filters[key] === null || filters[key] === '') {
                        delete filters[key];
                    }
                });

                console.log('Applying filters:', filters);

                const permissions = await dataFunctions.getRolePermissionsFiltered(filters);
                this.permissions = permissions;
                this.filteredPermissions = permissions;
                this.currentPage = 1;
                this.renderPermissions();
                this.hideLoading();
            } catch (error) {
                console.error('Error filtering permissions:', error);
                this.showError('Error filtering permissions: ' + error.message);
                this.hideLoading();
            }
        },

        renderPermissions: function () {
            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const permissionsToShow = this.filteredPermissions.slice(startIndex, endIndex);

            const permissionsHtml = permissionsToShow.map(permission => `
                <tr>
                    <td>
                        <a href="#" class="object-name-link text-decoration-none" data-permission-id="${permission.id}">
                            ${this.escapeHtml(permission.object_name)}
                        </a>
                    </td>
                    <td>${this.escapeHtml(permission.role_name || 'No Role')}</td>
                    <td>${this.escapeHtml(permission.object_type || '')}</td>
                    <td>${this.escapeHtml(permission.operation || '')}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger delete-permission-btn" data-permission-id="${permission.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

            $('#permissionsTableBody').html(permissionsHtml);
            this.renderPagination();
        },

        renderPagination: function () {
            const totalPages = Math.ceil(this.filteredPermissions.length / this.itemsPerPage);

            if (totalPages <= 1) {
                $('#pagination').empty();
                return;
            }

            let paginationHtml = '<nav><ul class="pagination justify-content-center">';

            // Previous button
            if (this.currentPage > 1) {
                paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage - 1}">Previous</a></li>`;
            }

            // Page numbers
            for (let i = 1; i <= totalPages; i++) {
                if (i === this.currentPage) {
                    paginationHtml += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
                } else {
                    paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
                }
            }

            // Next button
            if (this.currentPage < totalPages) {
                paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage + 1}">Next</a></li>`;
            }

            paginationHtml += '</ul></nav>';
            $('#pagination').html(paginationHtml);
        },

        showAddPermissionModal: async function () {
            this.editingPermission = null;
            this.clearForm();

            // Reload roles dropdown from database when adding
            console.log('Reloading roles dropdown from database for add...');
            await this.loadRolesForDropdown_NEW();

            $('#permissionModalLabel').text('Add Database Role Permission');
            $('#permissionModal').modal('show');
        },

        editPermission: async function (permissionId) {
            try {
                console.log('=== editPermission called with ID:', permissionId);
                const permission = this.permissions.find(p => p.id === permissionId);
                console.log('Found permission:', permission);
                if (!permission) {
                    this.showError('Permission not found');
                    return;
                }

                this.editingPermission = permission;

                // Reload roles dropdown from database when editing
                console.log('Reloading roles dropdown from database for edit...');
                console.log('About to call loadRolesForDropdown_NEW...');
                await this.loadRolesForDropdown_NEW();
                console.log('loadRolesForDropdown_NEW completed');

                // Add a delay to ensure dropdown is fully populated before setting values
                setTimeout(() => {
                    this.populateForm(permission);
                }, 200);

                $('#permissionModalLabel').text('Edit Database Role Permission');
                $('#permissionModal').modal('show');
            } catch (error) {
                console.error('Error editing permission:', error);
                this.showError('Error loading permission details: ' + error.message);
            }
        },

        deletePermission: function (permissionId) {
            const permission = this.permissions.find(p => p.id === permissionId);
            if (!permission) return;

            Swal.fire({
                title: 'Are you sure?',
                text: `Do you want to delete "${permission.object_name}" permission? This action cannot be undone.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        await dataFunctions.deleteRolePermission(permissionId);
                        this.showSuccess('Permission deleted successfully');
                        this.loadPermissions();
                    } catch (error) {
                        console.error('Error deleting permission:', error);
                        this.showError('Error deleting permission: ' + error.message);
                    }
                }
            });
        },

        savePermission: async function () {
            try {
                const formData = {
                    role_id: $('#cboRole').val(),
                    object_name: $('#cboObjectType').val() || '', // Use object type as object name
                    object_type: $('#cboObjectType').val() || '',
                    operation: $('#cboPermission').val() || '',
                    description: $('#txtDescription').val() || '',
                    is_active: $('#cboStatus').val() === 'active'
                };

                // Validation
                if (!formData.role_id) {
                    this.showError('Role is required');
                    return;
                }

                if (!formData.object_type) {
                    this.showError('Object type is required');
                    return;
                }

                if (!formData.operation) {
                    this.showError('Permission is required');
                    return;
                }

                // Use object_type as object_name since that's what the form provides
                formData.object_name = formData.object_type;

                if (this.editingPermission) {
                    // Update existing permission
                    await dataFunctions.updateRolePermission(this.editingPermission.id, formData);
                    this.showSuccess('Permission updated successfully');
                } else {
                    // Create new permission
                    await dataFunctions.createRolePermission(formData);
                    this.showSuccess('Permission created successfully');
                }

                $('#permissionModal').modal('hide');
                this.loadPermissions();
            } catch (error) {
                console.error('Error saving permission:', error);
                this.showError('Error saving permission: ' + error.message);
            }
        },

        populateForm: function (permission) {
            console.log('populateForm called with permission:', permission);
            console.log('Available permission fields:', Object.keys(permission));

            // Use the correct field names from the database response
            const roleId = permission.role_id || '';
            const objectName = permission.object_name || '';
            const objectType = permission.object_type || '';
            const operation = permission.operation || '';
            const description = permission.description || '';
            const isActive = permission.is_active !== undefined ? permission.is_active : true;

            console.log('Setting role ID to:', roleId);
            console.log('Available role options:', $('#cboRole option').map(function () { return this.value; }).get());
            $('#cboRole').val(roleId);
            console.log('Role dropdown value after setting:', $('#cboRole').val());

            console.log('Setting object type to:', objectType);
            $('#cboObjectType').val(objectType);
            console.log('Setting operation to:', operation);
            $('#cboPermission').val(operation);
            console.log('Setting description to:', description);
            $('#txtDescription').val(description);
            console.log('Setting status to:', isActive ? 'active' : 'inactive');
            $('#cboStatus').val(isActive ? 'active' : 'inactive');

            console.log('Form population complete');
        },

        clearForm: function () {
            $('#permissionForm')[0].reset();
            this.editingPermission = null;
        },

        showLoading: function () {
            $('#permissionsTableBody').html('<tr><td colspan="6" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>');
        },

        hideLoading: function () {
            // Loading will be replaced by renderPermissions
        },

        showError: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'error');
            } else {
                alert(message);
            }
        },

        showSuccess: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'success');
            } else {
                alert(message);
            }
        },

        escapeHtml: function (text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        search: function () {
            this.filterPermissions();
        },

        applyFilters: function () {
            this.filterPermissions();
        },

        clearFilters: function () {
            $('#searchInput').val('');
            $('#filterRole').val('');
            $('#filterObjectType').val('');
            $('#filterOperation').val('');
            $('#filterStatus').val('');
            this.filterPermissions();
        },

        loadRolesForDropdown: async function () {
            try {
                const roles = await dataFunctions.getRoles();
                const roleSelects = ['roleId', 'filterRole'];
                roleSelects.forEach(selectId => {
                    const select = document.getElementById(selectId);
                    if (select) {
                        let html = '<option value="">Select Role</option>';
                        if (selectId === 'filterRole') {
                            html = '<option value="">All Roles</option>';
                        }
                        roles.forEach(role => {
                            html += `<option value="${role.id}">${role.role_name}</option>`;
                        });
                        select.innerHTML = html;
                    }
                });
            } catch (error) {
                console.error('Error loading roles:', error);
            }
        },

        // Add missing functions that are called from HTML
        addPermission: function () {
            this.showAddPermissionModal();
        },

        exportPermissions: function () {
            // TODO: Implement export functionality
            this.showInfo('Export functionality not yet implemented');
        },

        refreshPermissions: function () {
            this.loadPermissions();
        },

        confirmDelete: function () {
            // TODO: Implement delete confirmation
            this.showInfo('Delete confirmation not yet implemented');
        },

        showInfo: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'info');
            } else {
                alert(message);
            }
        }
    }
}();

// Initialize role permissions grid when module is loaded
function initializeRolePermissionsGrid() {
    if (typeof dataFunctions !== 'undefined') {
        _rolePermissionsGrid.init();
    } else {
        // Wait for dataFunctions to be available
        setTimeout(initializeRolePermissionsGrid, 100);
    }
}

// Auto-initialize if DOM is ready
$(document).ready(function () {
    initializeRolePermissionsGrid();
});