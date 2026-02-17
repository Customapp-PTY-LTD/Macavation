/**
 * Roles Grid Module
 * Handles role management functionality with Supabase integration.
 * Follows company module pattern: IIFE, arrow methods, scope = _rolesGrid for same-module calls.
 */

var _rolesGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        roles: [],
        filteredRoles: [],
        currentPage: 1,
        itemsPerPage: 10,
        editingRole: null,
        searchDebounceToken: 0,

        init: async () => {
            const scope = _rolesGrid;
            await scope.waitForReady();
            scope.setupEventListeners();
            await scope.loadRoles();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _rolesGrid;

            $('#searchInput').on('input', function () {
                var token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) scope.filterRoles();
                });
            });

            $('#filterStatus').on('change', function () {
                scope.filterRoles();
            });

            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const scope = _rolesGrid;
                var page = parseInt($(this).data('page'), 10);
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderRoles();
                }
            });

            $('#addRoleBtn').on('click', function () {
                scope.showAddRoleModal();
            });

            $(document).on('click', '.role-name-link', function (e) {
                e.preventDefault();
                const scope = _rolesGrid;
                var roleId = $(this).data('role-id');
                if (!roleId) return;
                scope.editRole(roleId);
            });

            $(document).on('click', '.delete-role-btn', function () {
                const scope = _rolesGrid;
                var roleId = $(this).data('role-id');
                scope.deleteRole(roleId);
            });

            $('#saveRoleBtn').on('click', function () {
                scope.saveRole();
            });

            $('#roleModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });
        },

        loadRoles: async () => {
            const scope = _rolesGrid;
            try {
                scope.showLoading();
                var roles = await dataFunctions.getRoles();
                scope.roles = roles || [];
                scope.filteredRoles = scope.roles;
                scope.renderRoles();
                scope.hideLoading();
            } catch (error) {
                console.error('Error loading roles:', error);
                scope.showError('Error loading roles: ' + error.message);
                scope.hideLoading();
            }
        },

        filterRoles: () => {
            const scope = _rolesGrid;
            var searchTerm = $('#searchInput').val().toLowerCase();
            var statusFilter = $('#filterStatus').val();
            scope.filteredRoles = scope.roles.filter(function (role) {
                var matchesSearch = !searchTerm ||
                    (role.role_name && role.role_name.toLowerCase().includes(searchTerm)) ||
                    (role.description && role.description.toLowerCase().includes(searchTerm));
                var matchesStatus = !statusFilter || String(role.is_active) === statusFilter;
                return matchesSearch && matchesStatus;
            });
            scope.currentPage = 1;
            scope.renderRoles();
        },

        renderRoles: () => {
            const scope = _rolesGrid;
            var startIndex = (scope.currentPage - 1) * scope.itemsPerPage;
            var endIndex = startIndex + scope.itemsPerPage;
            var rolesToShow = scope.filteredRoles.slice(startIndex, endIndex);
            var rolesHtml = rolesToShow.map(function (role) {
                return '<tr><td><a href="#" class="role-name-link text-decoration-none" data-role-id="' + scope.escapeHtml(role.id) + '">' + scope.escapeHtml(role.role_name) + '</a></td><td>' + scope.escapeHtml(role.description || '') + '</td><td><span class="badge bg-info">' + (role.users_count || 0) + '</span></td><td><button class="btn btn-sm btn-outline-danger delete-role-btn" data-role-id="' + scope.escapeHtml(role.id) + '"><i class="fas fa-trash"></i></button></td></tr>';
            }).join('');
            $('#rolesTableBody').html(rolesHtml);
            scope.renderPagination();
        },

        renderPagination: () => {
            const scope = _rolesGrid;
            var totalPages = Math.ceil(scope.filteredRoles.length / scope.itemsPerPage);
            if (totalPages <= 1) {
                $('#pagination').empty();
                return;
            }
            var paginationHtml = '<nav><ul class="pagination justify-content-center">';
            if (scope.currentPage > 1) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage - 1) + '">Previous</a></li>';
            }
            for (var i = 1; i <= totalPages; i++) {
                if (i === scope.currentPage) {
                    paginationHtml += '<li class="page-item active"><span class="page-link">' + i + '</span></li>';
                } else {
                    paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
                }
            }
            if (scope.currentPage < totalPages) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage + 1) + '">Next</a></li>';
            }
            paginationHtml += '</ul></nav>';
            $('#pagination').html(paginationHtml);
        },

        showAddRoleModal: () => {
            const scope = _rolesGrid;
            scope.editingRole = null;
            scope.clearForm();
            $('#roleModalLabel').text('Add Role');
            $('#roleModal').modal('show');
        },

        editRole: async (roleId) => {
            const scope = _rolesGrid;
            try {
                var role = scope.roles.find(function (r) { return r.id === roleId; });
                if (!role) {
                    scope.showError('Role not found');
                    return;
                }
                scope.editingRole = role;
                scope.populateForm(role);
                $('#roleModalLabel').text('Edit Role');
                $('#roleModal').modal('show');
            } catch (error) {
                console.error('Error editing role:', error);
                scope.showError('Error loading role details: ' + error.message);
            }
        },

        deleteRole: (roleId) => {
            const scope = _rolesGrid;
            var role = scope.roles.find(function (r) { return r.id === roleId; });
            if (!role) return;
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to deactivate "' + (role.role_name || '') + '"?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, deactivate!'
            }).then(async function (result) {
                if (result.isConfirmed) {
                    const scope = _rolesGrid;
                    try {
                        await dataFunctions.deactivateRole(roleId);
                        scope.showSuccess('Role deactivated successfully');
                        scope.loadRoles();
                    } catch (error) {
                        console.error('Error deactivating role:', error);
                        scope.showError('Error deactivating role: ' + error.message);
                    }
                }
            });
        },

        saveRole: async () => {
            const scope = _rolesGrid;
            try {
                var formData = {
                    role_name: $('#roleName').val().trim(),
                    description: $('#roleDescription').val().trim(),
                    is_active: $('#isActive').is(':checked')
                };
                if (!formData.role_name) {
                    scope.showError('Role name is required');
                    return;
                }
                if (scope.editingRole) {
                    await dataFunctions.updateRole(scope.editingRole.id, formData);
                    scope.showSuccess('Role updated successfully');
                } else {
                    await dataFunctions.createRole(formData);
                    scope.showSuccess('Role created successfully');
                }
                $('#roleModal').modal('hide');
                scope.loadRoles();
            } catch (error) {
                console.error('Error saving role:', error);
                scope.showError('Error saving role: ' + error.message);
            }
        },

        populateForm: (role) => {
            $('#roleName').val(role.role_name || '');
            $('#roleDescription').val(role.description || '');
            $('#isActive').prop('checked', role.is_active);
        },

        clearForm: () => {
            const scope = _rolesGrid;
            $('#roleForm')[0].reset();
            scope.editingRole = null;
        },

        showLoading: () => {
            $('#rolesTableBody').html('<tr><td colspan="4" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>');
        },

        hideLoading: () => {},

        showError: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'error');
            } else {
                alert(message);
            }
        },

        showSuccess: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'success');
            } else {
                alert(message);
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        search: () => {
            _rolesGrid.filterRoles();
        },

        applyFilters: () => {
            _rolesGrid.filterRoles();
        },

        clearFilters: () => {
            const scope = _rolesGrid;
            $('#searchInput').val('');
            $('#filterStatus').val('');
            scope.filterRoles();
        }
    };
}();

function initializeRolesGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _rolesGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeRolesGrid();
});
