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
            // Unified role grids: show only this section (data-access)
            document.querySelectorAll('[data-access]').forEach(function (el) {
                el.style.display = (el.getAttribute('data-access') === 'role-permissions') ? '' : 'none';
            });
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

            $('#rpSearchInput').on('input', function () {
                var token = ++scope.searchDebounceToken;
                delay(500).then(function () {
                    if (token === scope.searchDebounceToken) scope.filterPermissions();
                });
            });

            $('#rpFilterRole, #rpFilterObjectType, #rpFilterPermission').on('change', function () {
                scope.filterPermissions();
            });

            $(document).on('click', '#rpPagination .page-link', function (e) {
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

            $('#exportPermissionsBtn').on('click', function () { _rolePermissionsGrid.exportPermissions(); });
            $('#refreshPermissionsBtn').on('click', function () { _rolePermissionsGrid.refreshPermissions(); });
            $('#rpClearFiltersBtn').on('click', function () { _rolePermissionsGrid.clearFilters(); });

            $(document).on('click', '#permissionsTableBody tr.js-permission-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                var permissionId = $(this).data('permission-id');
                if (permissionId) _rolePermissionsGrid.editPermission(permissionId);
            });

            $(document).on('click', '.js-permission-edit', function (e) {
                e.preventDefault();
                var permissionId = $(this).data('permission-id');
                if (permissionId) _rolePermissionsGrid.editPermission(permissionId);
            });

            $(document).on('click', '.js-permission-delete', function (e) {
                e.preventDefault();
                var permissionId = $(this).data('permission-id');
                if (permissionId) _rolePermissionsGrid.deletePermission(permissionId);
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
                var select = document.getElementById('rpFilterRole');
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
                    searchTerm: $('#rpSearchInput').val().trim() || null,
                    roleId: $('#rpFilterRole').val() || null,
                    objectType: $('#rpFilterObjectType').val() || null,
                    operation: $('#rpFilterPermission').val() || null,
                    isActive: null
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

            var permissionsHtml = '';
            if (permissionsToShow.length === 0) {
                var isEmpty = scope.filteredPermissions.length === 0;
                permissionsHtml = '<tr><td colspan="5" class="text-center text-muted py-4">' +
                    '<i class="fas fa-info-circle me-2"></i>' +
                    (isEmpty ? 'No permissions found.' : 'No permissions match your search.') +
                    '</td></tr>';
            } else {
                permissionsHtml = permissionsToShow.map(function (permission) {
                    var permId = scope.escapeHtml(permission.id);
                    var actionsCell = MacTableActions.renderCell({
                        wrapLi: true,
                        items: [
                            { label: 'Edit', className: 'js-permission-edit', dataAttrs: { 'permission-id': permission.id } },
                            { label: 'Delete', className: 'js-permission-delete', danger: true, dataAttrs: { 'permission-id': permission.id } }
                        ]
                    });
                    return '<tr class="js-permission-row" data-permission-id="' + permId + '">' +
                        '<td>' + scope.escapeHtml(permission.object_name || '') + '</td>' +
                        '<td>' + scope.escapeHtml(permission.role_name || 'No Role') + '</td>' +
                        '<td>' + scope.escapeHtml(permission.object_type || '') + '</td>' +
                        '<td>' + scope.escapeHtml(permission.operation || '') + '</td>' +
                        actionsCell + '</tr>';
                }).join('');
            }
            $('#permissionsTableBody').html(permissionsHtml);
            MacTableActions.init(document.getElementById('permissionsTable'));
            scope.renderPagination();
        },

        renderPagination: () => {
            const scope = _rolePermissionsGrid;
            var totalPages = Math.ceil(scope.filteredPermissions.length / scope.itemsPerPage);
            if (totalPages <= 1) {
                $('#rpPagination').empty();
                return;
            }
            var current = scope.currentPage;
            var paginationHtml = '';

            paginationHtml += '<li class="page-item' + (current <= 1 ? ' disabled' : '') + '">';
            paginationHtml += current <= 1 ? '<span class="page-link">Previous</span>' : '<a class="page-link" href="#" data-page="' + (current - 1) + '">Previous</a>';
            paginationHtml += '</li>';

            var delta = 2;
            var left = Math.max(1, current - delta);
            var right = Math.min(totalPages, current + delta);
            if (left > 1) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>';
                if (left > 2) paginationHtml += '<li class="page-item disabled"><span class="page-link">…</span></li>';
            }
            for (var i = left; i <= right; i++) {
                if (i === current) {
                    paginationHtml += '<li class="page-item active"><span class="page-link">' + i + '</span></li>';
                } else {
                    paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
                }
            }
            if (right < totalPages) {
                if (right < totalPages - 1) paginationHtml += '<li class="page-item disabled"><span class="page-link">…</span></li>';
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + totalPages + '">' + totalPages + '</a></li>';
            }
            paginationHtml += '<li class="page-item' + (current >= totalPages ? ' disabled' : '') + '">';
            paginationHtml += current >= totalPages ? '<span class="page-link">Next</span>' : '<a class="page-link" href="#" data-page="' + (current + 1) + '">Next</a>';
            paginationHtml += '</li>';
            $('#rpPagination').html(paginationHtml);
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
            $('#permissionsTableBody').html('<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading permissions...</td></tr>');
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
            $('#rpSearchInput').val('');
            $('#rpFilterRole').val('');
            $('#rpFilterObjectType').val('');
            $('#rpFilterPermission').val('');
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
