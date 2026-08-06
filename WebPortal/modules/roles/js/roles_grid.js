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
        searchDebounceToken: 0,

        init: async () => {
            const scope = _rolesGrid;
            await scope.waitForReady();
            // Unified role grids: show only this section (data-access), same pattern as dashboard_unified
            document.querySelectorAll('[data-access]').forEach(function (el) {
                el.style.display = (el.getAttribute('data-access') === 'roles') ? '' : 'none';
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
            if (typeof _modal_role !== 'undefined' && _modal_role.init) _modal_role.init();
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

            $('#rolesSearchInput').on('input', function () {
                var token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) scope.filterRoles();
                });
            });

            $('#rolesFilterStatus').on('change', function () {
                scope.filterRoles();
            });

            $(document).on('click', '#rolesPagination .page-link', function (e) {
                e.preventDefault();
                const scope = _rolesGrid;
                var page = parseInt($(this).data('page'), 10);
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderRoles();
                }
            });

            $('#addRoleBtn').on('click', function () {
                if (typeof _modal_role !== 'undefined' && _modal_role.show) _modal_role.show();
            });

            $('#rolesExportBtn').on('click', function () { _rolesGrid.exportRoles(); });
            $('#rolesRefreshBtn').on('click', function () { _rolesGrid.refreshRoles(); });
            $('#rolesClearFiltersBtn').on('click', function () { _rolesGrid.clearFilters(); });

            $(document).on('click', '#rolesTableBody tr.js-role-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                var roleId = $(this).data('role-id');
                if (roleId) _rolesGrid.editRole(roleId);
            });

            $(document).on('click', '.js-role-edit', function (e) {
                e.preventDefault();
                var roleId = $(this).data('role-id');
                if (roleId) _rolesGrid.editRole(roleId);
            });

            $(document).on('click', '.js-role-deactivate', function (e) {
                e.preventDefault();
                var roleId = $(this).data('role-id');
                if (roleId) _rolesGrid.deleteRole(roleId);
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
            var searchTerm = $('#rolesSearchInput').val().toLowerCase();
            var statusFilter = $('#rolesFilterStatus').val();
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

            var rolesHtml = '';
            if (rolesToShow.length === 0) {
                var isEmpty = scope.filteredRoles.length === 0;
                rolesHtml = '<tr><td colspan="4" class="text-center text-muted py-4">' +
                    '<i class="fas fa-info-circle me-2"></i>' +
                    (isEmpty ? 'No roles found.' : 'No roles match your search.') +
                    '</td></tr>';
            } else {
                rolesHtml = rolesToShow.map(function (role) {
                    var roleId = scope.escapeHtml(role.id);
                    var canManage = typeof superUserVisibility === 'undefined' || superUserVisibility.canManageRole(role);
                    var actionItems = [];
                    if (canManage) {
                        actionItems.push(
                            { label: 'Edit', className: 'js-role-edit', dataAttrs: { 'role-id': role.id } },
                            { label: 'Deactivate', className: 'js-role-deactivate', danger: true, dataAttrs: { 'role-id': role.id, 'action-perm': 'admin.roles.delete' } }
                        );
                    } else {
                        actionItems.push({ label: 'View only', disabled: true, className: 'text-muted' });
                    }
                    var actionsCell = MacTableActions.renderCell({
                        wrapLi: true,
                        items: actionItems
                    });
                    return '<tr class="js-role-row" data-role-id="' + roleId + '">' +
                        '<td>' + scope.escapeHtml(window.formatRoleName(role.role_name)) + '</td>' +
                        '<td>' + scope.escapeHtml(role.description || '') + '</td>' +
                        '<td><span class="badge bg-info">' + (role.users_count != null ? role.users_count : 0) + '</span></td>' +
                        actionsCell + '</tr>';
                }).join('');
            }
            $('#rolesTableBody').html(rolesHtml);
            MacTableActions.init(document.getElementById('rolesTable'));
            if (typeof actionAccess !== 'undefined' && actionAccess.apply) {
                actionAccess.apply(document.getElementById('rolesTable') || document);
            }
            scope.renderPagination();
        },

        renderPagination: () => {
            const scope = _rolesGrid;
            var totalPages = Math.ceil(scope.filteredRoles.length / scope.itemsPerPage);
            if (totalPages <= 1) {
                $('#rolesPagination').empty();
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
            $('#rolesPagination').html(paginationHtml);
        },

        editRole: (roleId) => {
            const scope = _rolesGrid;
            var role = scope.roles.find(function (r) { return r.id === roleId; });
            if (!role) {
                scope.showError('Role not found');
                return;
            }
            if (typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageRole(role)) {
                scope.showError('Only super users may edit the super_user role.');
                return;
            }
            if (typeof _modal_role !== 'undefined' && _modal_role.show) _modal_role.show(role);
        },

        deleteRole: (roleId) => {
            const scope = _rolesGrid;
            if (typeof hasAction === 'function' && !hasAction('admin.roles.delete')) {
                scope.showError('You do not have permission to deactivate roles.');
                return;
            }
            var role = scope.roles.find(function (r) { return r.id === roleId; });
            if (!role) return;
            if (typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageRole(role)) {
                scope.showError('Only super users may deactivate the super_user role.');
                return;
            }
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to deactivate "' + window.formatRoleName(role.role_name) + '"?',
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

        showLoading: () => {
            $('#rolesTableBody').html('<tr><td colspan="4" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading roles...</td></tr>');
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
            return _common.escapeHtml(text);
        },

        search: () => {
            _rolesGrid.filterRoles();
        },

        applyFilters: () => {
            _rolesGrid.filterRoles();
        },

        clearFilters: () => {
            const scope = _rolesGrid;
            $('#rolesSearchInput').val('');
            $('#rolesFilterStatus').val('');
            scope.filterRoles();
        },

        refreshRoles: () => {
            _rolesGrid.loadRoles();
        },

        exportRoles: () => {
            const scope = _rolesGrid;
            if (!scope.roles || scope.roles.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No roles to export', 'info');
                return;
            }
            var columns = [
                { key: 'role_name', label: 'Role Name' },
                { key: 'description', label: 'Description' },
                { key: 'users_count', label: 'Users Count' },
                { key: 'is_active', label: 'Active' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.roles, 'roles', columns);
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Export utility not available', 'error');
            }
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
