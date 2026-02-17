/**
 * Role Permissions Grid Module
 * Handles role permissions management functionality with Supabase integration.
 * Follows company module pattern: IIFE, arrow methods, scope = _rolePermissionsGrid for same-module calls.
 */

var _rolePermissionsGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        permissions: [],
        filteredPermissions: [],
        currentPage: 1,
        itemsPerPage: 10,
        searchDebounceToken: 0,

        init: async () => {
            const scope = _rolePermissionsGrid;
            await scope.waitForReady();
            var modalContainers = document.querySelectorAll('.modal[route-name]');
            var loadPromises = [];
            modalContainers.forEach(function (el) {
                var routeName = el.getAttribute('route-name');
                if (routeName && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + el.id }));
                }
            });
            if (loadPromises.length) await Promise.all(loadPromises);
            if (typeof _modal_role_permission !== 'undefined' && _modal_role_permission.init) _modal_role_permission.init();
            scope.setupEventListeners();
            await scope.loadRolesForDropdown();
            await scope.loadPermissions();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _rolePermissionsGrid;

            $('#searchInput').on('input', function () {
                var token = ++scope.searchDebounceToken;
                delay(500).then(function () {
                    if (token === scope.searchDebounceToken) scope.filterPermissions();
                });
            });

            $('#filterRole, #filterObjectType, #filterOperation, #filterStatus').on('change', function () {
                scope.filterPermissions();
            });

            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const scope = _rolePermissionsGrid;
                var page = parseInt($(this).data('page'), 10);
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderPermissions();
                }
            });

            $('#addPermissionBtn').on('click', function () {
                if (typeof _modal_role_permission !== 'undefined' && _modal_role_permission.show) _modal_role_permission.show();
            });

            $(document).on('click', '.object-name-link', function (e) {
                e.preventDefault();
                const scope = _rolePermissionsGrid;
                var permissionId = $(this).data('permission-id');
                if (!permissionId) return;
                scope.editPermission(permissionId);
            });

            $(document).on('click', '.delete-permission-btn', function () {
                const scope = _rolePermissionsGrid;
                var permissionId = $(this).data('permission-id');
                scope.deletePermission(permissionId);
            });
        },

        loadPermissions: async () => {
            const scope = _rolePermissionsGrid;
            try {
                scope.showLoading();
                var permissions = await dataFunctions.getRolePermissions();
                scope.permissions = permissions || [];
                scope.filteredPermissions = scope.permissions;
                scope.renderPermissions();
                scope.hideLoading();
            } catch (error) {
                console.error('Error loading permissions:', error);
                scope.showError('Error loading permissions: ' + error.message);
                scope.hideLoading();
            }
        },

        loadRolesForDropdown: async () => {
            const scope = _rolePermissionsGrid;
            try {
                var roles = await dataFunctions.getRoles();
                if (!roles || !Array.isArray(roles) || roles.length === 0) return;
                var select = document.getElementById('filterRole');
                if (select) {
                    var html = '<option value="">All Roles</option>';
                    roles.forEach(function (role) {
                        html += '<option value="' + role.id + '">' + scope.escapeHtml(role.role_name) + '</option>';
                    });
                    select.innerHTML = html;
                }
            } catch (error) {
                console.error('Error loading roles:', error);
            }
        },

        filterPermissions: async () => {
            const scope = _rolePermissionsGrid;
            try {
                scope.showLoading();
                var filters = {
                    searchTerm: $('#searchInput').val().trim() || null,
                    roleId: $('#filterRole').val() || null,
                    objectType: $('#filterObjectType').val() || null,
                    operation: $('#filterOperation').val() || null,
                    isActive: $('#filterStatus').val() ? ($('#filterStatus').val() === 'active') : null
                };
                Object.keys(filters).forEach(function (key) {
                    if (filters[key] === null || filters[key] === '') delete filters[key];
                });
                var permissions = await dataFunctions.getRolePermissionsFiltered(filters);
                scope.permissions = permissions || [];
                scope.filteredPermissions = scope.permissions;
                scope.currentPage = 1;
                scope.renderPermissions();
                scope.hideLoading();
            } catch (error) {
                console.error('Error filtering permissions:', error);
                scope.showError('Error filtering permissions: ' + error.message);
                scope.hideLoading();
            }
        },

        renderPermissions: () => {
            const scope = _rolePermissionsGrid;
            var startIndex = (scope.currentPage - 1) * scope.itemsPerPage;
            var endIndex = startIndex + scope.itemsPerPage;
            var permissionsToShow = scope.filteredPermissions.slice(startIndex, endIndex);
            var permissionsHtml = permissionsToShow.map(function (permission) {
                return '<tr><td><a href="#" class="object-name-link text-decoration-none" data-permission-id="' + scope.escapeHtml(permission.id) + '">' + scope.escapeHtml(permission.object_name) + '</a></td><td>' + scope.escapeHtml(permission.role_name || 'No Role') + '</td><td>' + scope.escapeHtml(permission.object_type || '') + '</td><td>' + scope.escapeHtml(permission.operation || '') + '</td><td><button class="btn btn-sm btn-outline-danger delete-permission-btn" data-permission-id="' + scope.escapeHtml(permission.id) + '"><i class="fas fa-trash"></i></button></td></tr>';
            }).join('');
            $('#permissionsTableBody').html(permissionsHtml);
            scope.renderPagination();
        },

        renderPagination: () => {
            const scope = _rolePermissionsGrid;
            var totalPages = Math.ceil(scope.filteredPermissions.length / scope.itemsPerPage);
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

        editPermission: (permissionId) => {
            const scope = _rolePermissionsGrid;
            var permission = scope.permissions.find(function (p) { return p.id === permissionId; });
            if (!permission) {
                scope.showError('Permission not found');
                return;
            }
            if (typeof _modal_role_permission !== 'undefined' && _modal_role_permission.show) _modal_role_permission.show(permission);
        },

        deletePermission: (permissionId) => {
            const scope = _rolePermissionsGrid;
            var permission = scope.permissions.find(function (p) { return p.id === permissionId; });
            if (!permission) return;
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete "' + (permission.object_name || '') + '" permission? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async function (result) {
                if (result.isConfirmed) {
                    const scope = _rolePermissionsGrid;
                    try {
                        await dataFunctions.deleteRolePermission(permissionId);
                        scope.showSuccess('Permission deleted successfully');
                        scope.loadPermissions();
                    } catch (error) {
                        console.error('Error deleting permission:', error);
                        scope.showError('Error deleting permission: ' + error.message);
                    }
                }
            });
        },

        showLoading: () => {
            $('#permissionsTableBody').html('<tr><td colspan="6" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>');
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
            _rolePermissionsGrid.filterPermissions();
        },

        applyFilters: () => {
            _rolePermissionsGrid.filterPermissions();
        },

        clearFilters: () => {
            const scope = _rolePermissionsGrid;
            $('#searchInput').val('');
            $('#filterRole').val('');
            $('#filterObjectType').val('');
            $('#filterOperation').val('');
            $('#filterStatus').val('');
            scope.filterPermissions();
        },

        addPermission: () => {
            if (typeof _modal_role_permission !== 'undefined' && _modal_role_permission.show) _modal_role_permission.show();
        },

        exportPermissions: () => {
            _rolePermissionsGrid.showInfo('Export functionality not yet implemented');
        },

        refreshPermissions: () => {
            _rolePermissionsGrid.loadPermissions();
        },

        confirmDelete: () => {
            _rolePermissionsGrid.showInfo('Delete confirmation not yet implemented');
        },

        showInfo: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'info');
            } else {
                alert(message);
            }
        }
    };
}();

function initializeRolePermissionsGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _rolePermissionsGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeRolePermissionsGrid();
});
