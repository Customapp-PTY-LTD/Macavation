/**
 * Roles Grid Module
 * Handles role management functionality with Supabase integration
 */

var _rolesGrid = function () {
    return {
        roles: [],
        filteredRoles: [],
        currentPage: 1,
        itemsPerPage: 10,
        editingRole: null,
        searchTimeout: null,

        init: function () {
            this.setupEventListeners();
            this.loadRoles();
        },

        setupEventListeners: function () {
            const scope = this;

            // Search functionality
            $('#searchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterRoles();
                }, 300);
            });

            // Filter functionality
            $('#filterStatus').on('change', function () {
                scope.filterRoles();
            });

            // Pagination
            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const page = parseInt($(this).data('page'));
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderRoles();
                }
            });

            // Add role button
            $('#addRoleBtn').on('click', function () {
                scope.showAddRoleModal();
            });

            // Edit role (click on role name)
            $(document).on('click', '.role-name-link', function (e) {
                e.preventDefault();
                console.log('Role name link clicked');
                const roleId = $(this).data('role-id');
                console.log('Role ID:', roleId);
                if (!roleId) {
                    console.error('No role ID found');
                    return;
                }
                scope.editRole(roleId);
            });

            // Delete role
            $(document).on('click', '.delete-role-btn', function () {
                const roleId = $(this).data('role-id');
                scope.deleteRole(roleId);
            });

            // Save role form
            $('#saveRoleBtn').on('click', function () {
                scope.saveRole();
            });

            // Modal events
            $('#roleModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });
        },

        loadRoles: async function () {
            try {
                this.showLoading();
                const roles = await dataFunctions.getRoles();
                this.roles = roles;
                this.filteredRoles = roles;
                this.renderRoles();
                this.hideLoading();
            } catch (error) {
                console.error('Error loading roles:', error);
                this.showError('Error loading roles: ' + error.message);
                this.hideLoading();
            }
        },

        filterRoles: function () {
            const searchTerm = $('#searchInput').val().toLowerCase();
            const statusFilter = $('#filterStatus').val();

            this.filteredRoles = this.roles.filter(role => {
                const matchesSearch = !searchTerm ||
                    (role.role_name && role.role_name.toLowerCase().includes(searchTerm)) ||
                    (role.description && role.description.toLowerCase().includes(searchTerm));

                const matchesStatus = !statusFilter || role.is_active.toString() === statusFilter;

                return matchesSearch && matchesStatus;
            });

            this.currentPage = 1;
            this.renderRoles();
        },

        renderRoles: function () {
            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const rolesToShow = this.filteredRoles.slice(startIndex, endIndex);

            const rolesHtml = rolesToShow.map(role => `
                    <tr>
                        <td>
                        <a href="#" class="role-name-link text-decoration-none" data-role-id="${role.id}">
                            ${this.escapeHtml(role.role_name)}
                        </a>
                        </td>
                    <td>${this.escapeHtml(role.description || '')}</td>
                        <td>
                        <span class="badge bg-info">${role.users_count || 0}</span>
                        </td>
                        <td>
                        <button class="btn btn-sm btn-outline-danger delete-role-btn" data-role-id="${role.id}">
                                    <i class="fas fa-trash"></i>
                                </button>
                        </td>
                    </tr>
            `).join('');

            $('#rolesTableBody').html(rolesHtml);
            this.renderPagination();
        },

        renderPagination: function () {
            const totalPages = Math.ceil(this.filteredRoles.length / this.itemsPerPage);

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

        showAddRoleModal: function () {
            this.editingRole = null;
            this.clearForm();
            $('#roleModalLabel').text('Add Role');
            $('#roleModal').modal('show');
        },

        editRole: async function (roleId) {
            try {
                const role = this.roles.find(r => r.id === roleId);
                if (!role) {
                    this.showError('Role not found');
                    return;
                }

                this.editingRole = role;
                this.populateForm(role);
                $('#roleModalLabel').text('Edit Role');
                $('#roleModal').modal('show');
            } catch (error) {
                console.error('Error editing role:', error);
                this.showError('Error loading role details: ' + error.message);
            }
        },

        deleteRole: function (roleId) {
            const role = this.roles.find(r => r.id === roleId);
            if (!role) return;

            Swal.fire({
                title: 'Are you sure?',
                text: `Do you want to deactivate "${role.role_name}"?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, deactivate!'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        await dataFunctions.deactivateRole(roleId);
                        this.showSuccess('Role deactivated successfully');
                        this.loadRoles();
                    } catch (error) {
                        console.error('Error deactivating role:', error);
                        this.showError('Error deactivating role: ' + error.message);
                    }
                }
            });
        },

        saveRole: async function () {
            try {
                const formData = {
                    role_name: $('#roleName').val().trim(),
                    description: $('#roleDescription').val().trim(),
                    is_active: $('#isActive').is(':checked')
                };

                // Validation
                if (!formData.role_name) {
                    this.showError('Role name is required');
                    return;
                }

                if (this.editingRole) {
                    // Update existing role
                    await dataFunctions.updateRole(this.editingRole.id, formData);
                    this.showSuccess('Role updated successfully');
                } else {
                    // Create new role
                    await dataFunctions.createRole(formData);
                    this.showSuccess('Role created successfully');
                }

                $('#roleModal').modal('hide');
                this.loadRoles();
            } catch (error) {
                console.error('Error saving role:', error);
                this.showError('Error saving role: ' + error.message);
            }
        },

        populateForm: function (role) {
            $('#roleName').val(role.role_name);
            $('#roleDescription').val(role.description);
            $('#isActive').prop('checked', role.is_active);
        },

        clearForm: function () {
            $('#roleForm')[0].reset();
            this.editingRole = null;
        },

        showLoading: function () {
            $('#rolesTableBody').html('<tr><td colspan="4" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>');
        },

        hideLoading: function () {
            // Loading will be replaced by renderRoles
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
            this.filterRoles();
        },

        applyFilters: function () {
            this.filterRoles();
        },

        clearFilters: function () {
            $('#searchInput').val('');
            $('#filterStatus').val('');
            this.filterRoles();
        }
    }
}();

// Initialize roles grid when module is loaded
function initializeRolesGrid() {
    if (typeof dataFunctions !== 'undefined') {
        _rolesGrid.init();
    } else {
        // Wait for dataFunctions to be available
        setTimeout(initializeRolesGrid, 100);
    }
}

// Auto-initialize if DOM is ready
$(document).ready(function () {
    initializeRolesGrid();
});
