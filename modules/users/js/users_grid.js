/**
 * Users Grid Module
 * Handles user management functionality with Supabase integration
 */

var _usersGrid = function () {
    return {
        users: [],
        filteredUsers: [],
        currentPage: 1,
        itemsPerPage: 10,
        editingUser: null,
        searchTimeout: null,

        init: function () {
            this.setupEventListeners();
            this.loadUsers();
        },

        setupEventListeners: function () {
            const scope = this;

            // Search functionality
            $('#searchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterUsers();
                }, 300);
            });

            // Filter functionality
            $('#filterRole').on('change', function () {
                scope.filterUsers();
            });

            // Pagination
            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const page = parseInt($(this).data('page'));
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderUsers();
                }
            });

            // Add user button
            $('#addUserBtn').on('click', function () {
                scope.showAddUserModal();
            });

            // Edit user (click on user name)
            $(document).on('click', '.user-name-link', function (e) {
                e.preventDefault();
                console.log('User name link clicked');
                const userId = $(this).data('user-id');
                console.log('User ID:', userId);
                if (!userId) {
                    console.error('No user ID found');
                    return;
                }
                scope.editUser(userId);
            });

            // Delete user
            $(document).on('click', '.delete-user-btn', function () {
                const userId = $(this).data('user-id');
                scope.deleteUser(userId);
            });

            // Save user form
            $('#saveUserBtn').on('click', function () {
                scope.saveUser();
            });

            // Modal events
            $('#userModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });
        },

        loadUsers: async function () {
            try {
                this.showLoading();
                const users = await dataFunctions.getUsers();
                this.users = users;
                this.filteredUsers = users;
                this.renderUsers();
                this.loadRolesForDropdown();
                this.hideLoading();
            } catch (error) {
                console.error('Error loading users:', error);
                this.showError('Error loading users: ' + error.message);
                this.hideLoading();
            }
        },

        loadRolesForDropdown: async function () {
            try {
                console.log('=== loadRolesForDropdown START (Users) ===');

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

                console.log('=== loadRolesForDropdown COMPLETE (Users) ===');
            } catch (error) {
                console.error('❌ Error in loadRolesForDropdown (Users):', error);
            }
        },

        filterUsers: function () {
            const searchTerm = $('#searchInput').val().toLowerCase();
            const roleFilter = $('#filterRole').val();

            this.filteredUsers = this.users.filter(user => {
                const matchesSearch = !searchTerm ||
                    (user.username && user.username.toLowerCase().includes(searchTerm)) ||
                    (user.email && user.email.toLowerCase().includes(searchTerm)) ||
                    (user.first_name && user.first_name.toLowerCase().includes(searchTerm)) ||
                    (user.last_name && user.last_name.toLowerCase().includes(searchTerm));

                const matchesRole = !roleFilter || user.role_id === roleFilter;

                return matchesSearch && matchesRole;
            });

            this.currentPage = 1;
            this.renderUsers();
        },

        renderUsers: function () {
            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const usersToShow = this.filteredUsers.slice(startIndex, endIndex);

            const usersHtml = usersToShow.map(user => {
                const avatarHtml = this.generateAvatar(user);
                const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'Unknown User';

                return `
                    <tr>
                        <td>
                            <input type="checkbox" class="user-checkbox" data-user-id="${user.id}">
                        </td>
                        <td>
                            <div class="d-flex align-items-center">
                                ${avatarHtml}
                                <a href="#" class="user-name-link text-decoration-none ms-2" data-user-id="${user.id}">
                                    ${this.escapeHtml(fullName)}
                                </a>
                            </div>
                        </td>
                        <td>${this.escapeHtml(user.email || '')}</td>
                        <td>${this.escapeHtml(user.role_name || 'No Role')}</td>
                        <td>
                            <button class="btn btn-sm btn-outline-danger delete-user-btn" data-user-id="${user.id}">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            $('#usersTableBody').html(usersHtml);
            this.renderPagination();
        },

        generateAvatar: function (user) {
            const firstName = user.first_name || '';
            const lastName = user.last_name || '';
            const initials = (firstName.charAt(0) + lastName.charAt(0)).toUpperCase() || 'U';
            const bgColor = this.getAvatarColor(user.id);

            return `
                <div class="avatar avatar-s rounded-circle bg-${bgColor}" style="width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; font-size: 12px;">
                    ${initials}
                </div>
            `;
        },

        getAvatarColor: function (userId) {
            const colors = ['primary', 'secondary', 'success', 'danger', 'warning', 'info'];
            const hash = userId.split('').reduce((a, b) => {
                a = ((a << 5) - a) + b.charCodeAt(0);
                return a & a;
            }, 0);
            return colors[Math.abs(hash) % colors.length];
        },

        renderPagination: function () {
            const totalPages = Math.ceil(this.filteredUsers.length / this.itemsPerPage);

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

        showAddUserModal: async function () {
            this.editingUser = null;
            this.clearForm();

            // Reload roles dropdown from database when adding
            console.log('Reloading roles dropdown from database for add...');
            await this.loadRolesForDropdown();

            $('#userModalLabel').text('Add User');
            $('#userModal').modal('show');
        },

        editUser: async function (userId) {
            try {
                console.log('=== editUser called with ID:', userId);
                const user = this.users.find(u => u.id === userId);
                console.log('Found user:', user);
                if (!user) {
                    this.showError('User not found');
                    return;
                }

                this.editingUser = user;

                // Reload roles dropdown from database when editing
                console.log('Reloading roles dropdown from database for edit...');
                console.log('About to call loadRolesForDropdown...');
                await this.loadRolesForDropdown();
                console.log('loadRolesForDropdown completed');

                // Add a delay to ensure dropdown is fully populated before setting values
                setTimeout(() => {
                    this.populateForm(user);
                }, 200);

                $('#userModalLabel').text('Edit User');
                $('#userModal').modal('show');
            } catch (error) {
                console.error('Error editing user:', error);
                this.showError('Error loading user details: ' + error.message);
            }
        },

        deleteUser: function (userId) {
            const user = this.users.find(u => u.id === userId);
            if (!user) return;

            Swal.fire({
                title: 'Are you sure?',
                text: `Do you want to delete "${user.first_name} ${user.last_name}"? This action cannot be undone.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        await dataFunctions.deleteUser(userId);
                        this.showSuccess('User deleted successfully');
                        this.loadUsers();
                    } catch (error) {
                        console.error('Error deleting user:', error);
                        this.showError('Error deleting user: ' + error.message);
                    }
                }
            });
        },

        saveUser: async function () {
            try {
                const formData = {
                    username: $('#username').val().trim(),
                    email: $('#email').val().trim(),
                    first_name: $('#firstName').val().trim(),
                    last_name: $('#lastName').val().trim(),
                    password: $('#password').val().trim(),
                    role_id: $('#cboRole').val(),
                    is_active: $('#isActive').is(':checked')
                };

                // Validation
                if (!formData.username) {
                    this.showError('Username is required');
                    return;
                }

                if (!formData.email) {
                    this.showError('Email is required');
                    return;
                }

                // Email validation
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(formData.email)) {
                    this.showError('Please enter a valid email address');
                    return;
                }

                if (!this.editingUser && !formData.password) {
                    this.showError('Password is required for new users');
                    return;
                }

                if (!formData.role_id) {
                    this.showError('Role is required');
                    return;
                }

                if (this.editingUser) {
                    // Update existing user
                    await dataFunctions.updateUser(this.editingUser.id, formData);
                    this.showSuccess('User updated successfully');
                } else {
                    // Create new user
                    await dataFunctions.createUser(formData);
                    this.showSuccess('User created successfully');
                }

                $('#userModal').modal('hide');
                this.loadUsers();
            } catch (error) {
                console.error('Error saving user:', error);
                this.showError('Error saving user: ' + error.message);
            }
        },

        populateForm: function (user) {
            console.log('populateForm called with user:', user);
            console.log('Available user fields:', Object.keys(user));

            // Handle different possible field names from backend
            const username = user.username || user.user_name || user.userName || '';
            const email = user.email || user.email_address || '';
            const firstName = user.first_name || user.firstName || user.firstname || '';
            const lastName = user.last_name || user.lastName || user.lastname || '';
            const roleId = user.role_id || user.roleId || user.role_id || '';
            const isActive = user.is_active !== undefined ? user.is_active : true;

            console.log('Setting username to:', username);
            $('#username').val(username);
            console.log('Setting email to:', email);
            $('#email').val(email);
            console.log('Setting firstName to:', firstName);
            $('#firstName').val(firstName);
            console.log('Setting lastName to:', lastName);
            $('#lastName').val(lastName);
            console.log('Setting roleId to:', roleId);
            $('#cboRole').val(roleId);
            console.log('Setting isActive to:', isActive);
            $('#isActive').prop('checked', isActive);
            $('#password').val(''); // Don't populate password
            console.log('Form population complete');
        },

        clearForm: function () {
            $('#userForm')[0].reset();
            this.editingUser = null;
        },

        showLoading: function () {
            $('#usersTableBody').html('<tr><td colspan="6" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>');
        },

        hideLoading: function () {
            // Loading will be replaced by renderUsers
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
            this.filterUsers();
        },

        applyFilters: function () {
            this.filterUsers();
        },

        clearFilters: function () {
            $('#searchInput').val('');
            $('#filterRole').val('');
            this.filterUsers();
        },

        confirmDelete: function () {
            // This method is called from the delete confirmation modal
            // The actual delete logic is handled by the deleteUser method
            console.log('Delete confirmation - this should be handled by deleteUser method');
        }
    }
}();

// Initialize users grid when module is loaded
function initializeUsersGrid() {
    if (typeof dataFunctions !== 'undefined') {
        _usersGrid.init();
    } else {
        // Wait for dataFunctions to be available
        setTimeout(initializeUsersGrid, 100);
    }
}

// Auto-initialize if DOM is ready
$(document).ready(function () {
    initializeUsersGrid();
});