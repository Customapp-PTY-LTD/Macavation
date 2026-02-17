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
        editingUser: null,
        searchDebounceToken: 0,

        init: async () => {
            const scope = _usersGrid;
            await scope.waitForReady();
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
                scope.showAddUserModal();
            });

            $(document).on('click', '.user-name-link', function (e) {
                e.preventDefault();
                const scope = _usersGrid;
                const userId = $(this).data('user-id');
                if (!userId) return;
                scope.editUser(userId);
            });

            $(document).on('click', '.delete-user-btn', function () {
                const scope = _usersGrid;
                const userId = $(this).data('user-id');
                scope.deleteUser(userId);
            });

            $('#saveUserBtn').on('click', function () {
                scope.saveUser();
            });

            $('#userModal').on('hidden.bs.modal', function () {
                scope.clearForm();
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

                scope.users = users;
                scope.filteredUsers = users;
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
                const response = await dataFunctions.getRoles();
                let roles = response;

                if (!roles || !Array.isArray(roles) || roles.length === 0) {
                    console.error('No valid roles data!');
                    return;
                }

                const roleSelects = ['cboRole', 'filterRole'];
                roleSelects.forEach(function (selectId) {
                    const select = document.getElementById(selectId);
                    if (select) {
                        let html = selectId === 'filterRole' ? '<option value="">All Roles</option>' : '<option value="">Select Role</option>';
                        roles.forEach(function (role) {
                            html += '<option value="' + role.id + '">' + scope.escapeHtml(role.role_name) + '</option>';
                        });
                        select.innerHTML = html;
                    }
                });
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

            const usersHtml = usersToShow.map(function (user) {
                const avatarHtml = scope.generateAvatar(user);
                const rawName = (user.first_name || '') + ' ' + (user.last_name || '');
                const fullName = rawName.trim() || user.username || 'Unknown User';
                return (
                    '<tr>' +
                    '<td><input type="checkbox" class="user-checkbox" data-user-id="' + scope.escapeHtml(user.id) + '"></td>' +
                    '<td><div class="d-flex align-items-center">' + avatarHtml +
                    '<a href="#" class="user-name-link text-decoration-none ms-2" data-user-id="' + scope.escapeHtml(user.id) + '">' + scope.escapeHtml(fullName) + '</a></div></td>' +
                    '<td>' + scope.escapeHtml(user.email || '') + '</td>' +
                    '<td>' + scope.escapeHtml(user.role_name || 'No Role') + '</td>' +
                    '<td><button class="btn btn-sm btn-outline-danger delete-user-btn" data-user-id="' + scope.escapeHtml(user.id) + '"><i class="fas fa-trash"></i></button></td>' +
                    '</tr>'
                );
            }).join('');

            $('#usersTableBody').html(usersHtml);
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

        showAddUserModal: async () => {
            const scope = _usersGrid;
            scope.editingUser = null;
            scope.clearForm();
            await scope.loadRolesForDropdown();

            $('#passwordSection').show();
            $('#confirmPasswordSection').show();
            $('#password').prop('required', true);
            $('#txtConfirmPassword').prop('required', true);
            $('#passwordLabel').addClass('required');
            $('#confirmPasswordLabel').addClass('required');
            $('#passwordHelp').text('Password is required for new users');
            $('#userModalLabel').text('Add User');
            $('#userModal').modal('show');
        },

        editUser: async (userId) => {
            const scope = _usersGrid;
            try {
                const user = scope.users.find(function (u) { return u.id === userId; });
                if (!user) {
                    scope.showError('User not found');
                    return;
                }
                scope.editingUser = user;
                await scope.loadRolesForDropdown();
                await delay(200);
                scope.populateForm(user);

                $('#passwordSection').show();
                $('#confirmPasswordSection').show();
                $('#password').prop('required', false);
                $('#txtConfirmPassword').prop('required', false);
                $('#passwordLabel').removeClass('required');
                $('#confirmPasswordLabel').removeClass('required');
                $('#passwordHelp').text('Leave blank to keep current password');
                $('#userModalLabel').text('Edit User');
                $('#userModal').modal('show');
            } catch (error) {
                console.error('Error editing user:', error);
                scope.showError('Error loading user details: ' + error.message);
            }
        },

        deleteUser: (userId) => {
            const scope = _usersGrid;
            const user = scope.users.find(function (u) { return u.id === userId; });
            if (!user) return;

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

        saveUser: async () => {
            const scope = _usersGrid;
            try {
                const password = $('#password').val().trim();
                const confirmPassword = $('#txtConfirmPassword').val().trim();
                const formData = {
                    username: $('#username').val().trim(),
                    email: $('#email').val().trim(),
                    first_name: $('#firstName').val().trim(),
                    last_name: $('#lastName').val().trim(),
                    role_id: $('#cboRole').val(),
                    is_active: $('#isActive').is(':checked')
                };

                if (!formData.username) {
                    scope.showError('Username is required');
                    return;
                }
                if (!formData.email) {
                    scope.showError('Email is required');
                    return;
                }
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(formData.email)) {
                    scope.showError('Please enter a valid email address');
                    return;
                }
                if (!scope.editingUser) {
                    if (!password) {
                        scope.showError('Password is required for new users');
                        return;
                    }
                    if (password !== confirmPassword) {
                        scope.showError('Passwords do not match');
                        return;
                    }
                    formData.password = password;
                } else {
                    if (password) {
                        if (password !== confirmPassword) {
                            scope.showError('Passwords do not match');
                            return;
                        }
                        formData.password = password;
                    }
                }
                if (!formData.role_id) {
                    scope.showError('Role is required');
                    return;
                }

                if (scope.editingUser) {
                    await dataFunctions.updateUser(scope.editingUser.id, formData);
                    scope.showSuccess('User updated successfully');
                } else {
                    await dataFunctions.createUser(formData);
                    scope.showSuccess('User created successfully');
                }
                $('#userModal').modal('hide');
                scope.loadUsers();
            } catch (error) {
                console.error('Error saving user:', error);
                scope.showError('Error saving user: ' + error.message);
            }
        },

        populateForm: (user) => {
            const username = user.username || user.user_name || user.userName || '';
            const email = user.email || user.email_address || '';
            const firstName = user.first_name || user.firstName || user.firstname || '';
            const lastName = user.last_name || user.lastName || user.lastname || '';
            const roleId = user.role_id || user.roleId || '';
            const isActive = user.is_active !== undefined ? user.is_active : true;

            $('#username').val(username);
            $('#email').val(email);
            $('#firstName').val(firstName);
            $('#lastName').val(lastName);
            $('#cboRole').val(roleId);
            $('#isActive').prop('checked', isActive);
            $('#password').val('');
        },

        clearForm: () => {
            const scope = _usersGrid;
            $('#userForm')[0].reset();
            scope.editingUser = null;
        },

        showLoading: () => {
            $('#usersTableBody').html('<tr><td colspan="6" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>');
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
