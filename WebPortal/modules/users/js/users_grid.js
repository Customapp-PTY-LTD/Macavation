/**
 * Users Grid Module
 * Handles user management functionality with Supabase integration.
 * Follows company module pattern: IIFE, arrow methods, scope = _usersGrid for same-module calls.
 */

var _usersGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        users: [],
        filteredUsers: [],
        currentPage: 1,
        itemsPerPage: 10,
        searchDebounceToken: 0,

        init: async () => {
            const scope = _usersGrid;
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
            if (typeof _modal_user !== 'undefined' && _modal_user.init) _modal_user.init();
            scope.setupEventListeners();
            await scope.loadUsers();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _usersGrid;

            $('#searchInput').on('input', function () {
                const token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) {
                        scope.filterUsers();
                    }
                });
            });

            $('#filterRole').on('change', function () {
                scope.filterUsers();
            });

            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const scope = _usersGrid;
                const page = parseInt($(this).data('page'), 10);
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderUsers();
                }
            });

            $('#addUserBtn').on('click', function () {
                if (typeof _modal_user !== 'undefined' && _modal_user.show) _modal_user.show();
            });

            $('#exportUsersBtn').on('click', function () { _usersGrid.exportUsers(); });
            $('#refreshUsersBtn').on('click', function () { _usersGrid.refreshUsers(); });
            $('#clearFiltersBtn').on('click', function () { _usersGrid.clearFilters(); });

            $(document).on('click', '#usersTableBody tr.js-user-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                const userId = $(this).data('user-id');
                if (userId) _usersGrid.editUser(userId);
            });

            $(document).on('click', '.js-user-edit', function (e) {
                e.preventDefault();
                const userId = $(this).data('user-id');
                if (userId) _usersGrid.editUser(userId);
            });

            $(document).on('click', '.js-user-deactivate', function (e) {
                e.preventDefault();
                const userId = $(this).data('user-id');
                if (userId) _usersGrid.deleteUser(userId);
            });
        },

        loadUsers: async (forceRefresh) => {
            const scope = _usersGrid;
            try {
                scope.showLoading();
                const startTime = performance.now();
                const users = await dataFunctions.getUsers(null, forceRefresh || false);
                const loadTime = performance.now() - startTime;
                console.log('[Performance] Users loaded in ' + loadTime.toFixed(2) + 'ms');

                scope.users = Array.isArray(users) ? users : [];
                scope.filteredUsers = scope.users;
                scope.renderUsers();
                await scope.loadRolesForDropdown();
                scope.hideLoading();
            } catch (error) {
                console.error('Error loading users:', error);
                scope.showError('Error loading users: ' + error.message);
                scope.hideLoading();
            }
        },

        loadRolesForDropdown: async () => {
            const scope = _usersGrid;
            try {
                const response = await dataFunctions.getRolesForAssignment
                    ? dataFunctions.getRolesForAssignment()
                    : dataFunctions.getRoles();
                var roles = response;
                if (!roles || !Array.isArray(roles) || roles.length === 0) {
                    console.error('No valid roles data!');
                    return;
                }
                var select = document.getElementById('filterRole');
                if (select) {
                    var html = '<option value="">All Roles</option>';
                    roles.forEach(function (role) {
                        html += '<option value="' + role.id + '">' + scope.escapeHtml(role.role_name) + '</option>';
                    });
                    select.innerHTML = html;
                }
            } catch (error) {
                console.error('Error in loadRolesForDropdown (Users):', error);
            }
        },

        filterUsers: () => {
            const scope = _usersGrid;
            const searchTerm = $('#searchInput').val().toLowerCase();
            const roleFilter = $('#filterRole').val();

            scope.filteredUsers = scope.users.filter(function (user) {
                const matchesSearch = !searchTerm ||
                    (user.username && user.username.toLowerCase().includes(searchTerm)) ||
                    (user.email && user.email.toLowerCase().includes(searchTerm)) ||
                    (user.first_name && user.first_name.toLowerCase().includes(searchTerm)) ||
                    (user.last_name && user.last_name.toLowerCase().includes(searchTerm));
                const matchesRole = !roleFilter || user.role_id === roleFilter;
                return matchesSearch && matchesRole;
            });

            scope.currentPage = 1;
            scope.renderUsers();
        },

        renderUsers: () => {
            const scope = _usersGrid;
            const startIndex = (scope.currentPage - 1) * scope.itemsPerPage;
            const endIndex = startIndex + scope.itemsPerPage;
            const usersToShow = scope.filteredUsers.slice(startIndex, endIndex);

            let usersHtml = '';
            if (usersToShow.length === 0) {
                const isEmpty = scope.filteredUsers.length === 0;
                usersHtml = '<tr><td colspan="4" class="text-center text-muted py-4">' +
                    '<i class="fas fa-info-circle me-2"></i>' +
                    (isEmpty ? 'No users found.' : 'No users match your search.') +
                    '</td></tr>';
            } else {
                usersHtml = usersToShow.map(function (user) {
                    const avatarHtml = scope.generateAvatar(user);
                    const rawName = (user.first_name || '') + ' ' + (user.last_name || '');
                    const fullName = rawName.trim() || user.username || 'Unknown User';
                    const userId = scope.escapeHtml(user.id);
                    const actionsCell = MacTableActions.renderCell({
                        wrapLi: true,
                        items: [
                            { label: 'Edit', className: 'js-user-edit', dataAttrs: { 'user-id': user.id } },
                            { label: 'Deactivate', className: 'js-user-deactivate', danger: true, dataAttrs: { 'user-id': user.id } }
                        ]
                    });
                    return '<tr class="js-user-row" data-user-id="' + userId + '">' +
                        '<td><div class="d-flex align-items-center">' + avatarHtml +
                        '<span class="ms-2">' + scope.escapeHtml(fullName) + '</span></div></td>' +
                        '<td>' + scope.escapeHtml(user.email || '') + '</td>' +
                        '<td>' + scope.escapeHtml(user.role_name || 'No Role') + '</td>' +
                        actionsCell + '</tr>';
                }).join('');
            }

            $('#usersTableBody').html(usersHtml);
            MacTableActions.init(document.getElementById('usersTable'));
            scope.renderPagination();
        },

        generateAvatar: (user) => {
            const scope = _usersGrid;
            const firstName = user.first_name || '';
            const lastName = user.last_name || '';
            const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase() || 'U';
            const bgColor = scope.getAvatarColor(user.id);
            return '<div class="avatar avatar-s rounded-circle bg-' + bgColor + '" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">' + scope.escapeHtml(initials) + '</div>';
        },

        getAvatarColor: (userId) => {
            const colors = ['primary', 'secondary', 'success', 'danger', 'warning', 'info'];
            const hash = userId.split('').reduce(function (a, b) {
                a = ((a << 5) - a) + b.charCodeAt(0);
                return a & a;
            }, 0);
            return colors[Math.abs(hash) % colors.length];
        },

        renderPagination: () => {
            const scope = _usersGrid;
            const totalPages = Math.ceil(scope.filteredUsers.length / scope.itemsPerPage);

            if (totalPages <= 1) {
                $('#pagination').empty();
                return;
            }

            let paginationHtml = '<nav><ul class="pagination justify-content-center">';
            if (scope.currentPage > 1) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage - 1) + '">Previous</a></li>';
            }
            for (let i = 1; i <= totalPages; i++) {
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

        editUser: (userId) => {
            const scope = _usersGrid;
            var user = scope.users.find(function (u) { return u.id === userId; });
            if (!user) {
                scope.showError('User not found');
                return;
            }
            if (typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageUser(user)) {
                scope.showError('You do not have permission to manage this user.');
                return;
            }
            if (typeof _modal_user !== 'undefined' && _modal_user.show) _modal_user.show(user);
        },

        deleteUser: (userId) => {
            const scope = _usersGrid;
            const user = scope.users.find(function (u) { return u.id === userId; });
            if (!user) return;
            if (typeof superUserVisibility !== 'undefined' && !superUserVisibility.canManageUser(user)) {
                scope.showError('You do not have permission to manage this user.');
                return;
            }

            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete "' + (user.first_name || '') + ' ' + (user.last_name || '') + '"? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async function (result) {
                if (result.isConfirmed) {
                    const scope = _usersGrid;
                    try {
                        await dataFunctions.deleteUser(userId);
                        scope.showSuccess('User deleted successfully');
                        scope.loadUsers();
                    } catch (error) {
                        console.error('Error deleting user:', error);
                        scope.showError('Error deleting user: ' + error.message);
                    }
                }
            });
        },

        showLoading: () => {
            $('#usersTableBody').html('<tr><td colspan="4" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading users...</td></tr>');
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
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        search: () => {
            _usersGrid.filterUsers();
        },

        applyFilters: () => {
            _usersGrid.filterUsers();
        },

        clearFilters: () => {
            const scope = _usersGrid;
            $('#searchInput').val('');
            $('#filterRole').val('');
            scope.filterUsers();
        },

        confirmDelete: () => {
            // No-op: actual delete is handled by deleteUser and Swal confirmation.
        },

        refreshUsers: () => {
            _usersGrid.loadUsers(true);
        },

        exportUsers: () => {
            const scope = _usersGrid;
            if (!scope.users || scope.users.length === 0) {
                Swal.fire('Info', 'No users to export', 'info');
                return;
            }
            const columns = [
                { key: 'username', label: 'Username' },
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role' },
                { key: 'is_active', label: 'Active' },
                { key: 'created_at', label: 'Created At' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.users, 'users', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

function initializeUsersGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _usersGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeUsersGrid();
});
