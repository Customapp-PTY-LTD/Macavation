/**
 * Modal: Add/Edit User. Parent calls show() or show(user). Modal owns init, show, clearForm, save.
 */
var _modal_user = (function () {
    'use strict';

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveUserBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('userModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: async function (user) {
            var title = document.getElementById('userModalLabel');
            if (title) title.textContent = user ? 'Edit User' : 'Add User';
            api.clearForm();
            var form = document.getElementById('userForm');
            if (form) form.removeAttribute('data-editing-id');
            if (user) {
                if (form && user.id) form.setAttribute('data-editing-id', user.id);
                if (typeof $ !== 'undefined') {
                    $('#username').val(user.username || user.user_name || user.userName || '');
                    $('#email').val(((user.email || user.email_address || '') + '').trim().toLowerCase());
                    $('#firstName').val(user.first_name || user.firstName || user.firstname || '');
                    $('#lastName').val(user.last_name || user.lastName || user.lastname || '');
                    $('#cboRole').val(user.role_id || user.roleId || '');
                    $('#isActive').prop('checked', user.is_active !== undefined ? user.is_active : true);
                    $('#password').val('');
                    $('#txtConfirmPassword').val('');
                }
            }
            try {
                await api.loadRolesForDropdown();
                if (user && typeof $ !== 'undefined') {
                    $('#cboRole').val(user.role_id || user.roleId || '');
                }
            } catch (e) { console.error('Error loading roles:', e); }
            if (typeof $ !== 'undefined') {
                if (user) {
                    $('#passwordSection').show();
                    $('#confirmPasswordSection').show();
                    $('#password').prop('required', false);
                    $('#txtConfirmPassword').prop('required', false);
                    $('#passwordLabel').removeClass('required');
                    $('#confirmPasswordLabel').removeClass('required');
                    $('#passwordHelp').text('Leave blank to keep current password');
                } else {
                    $('#passwordSection').show();
                    $('#confirmPasswordSection').show();
                    $('#password').prop('required', true);
                    $('#txtConfirmPassword').prop('required', true);
                    $('#passwordLabel').addClass('required');
                    $('#confirmPasswordLabel').addClass('required');
                    $('#passwordHelp').text('Password is required for new users');
                }
            }
            var modalEl = document.getElementById('userModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#userModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('userForm');
            if (form) { form.reset(); form.removeAttribute('data-editing-id'); }
            if (typeof $ !== 'undefined') $('#isActive').prop('checked', true);
        },

        loadRolesForDropdown: async function () {
            var select = document.getElementById('cboRole');
            if (!select || typeof dataFunctions === 'undefined' || !dataFunctions.getRoles) return;
            var roles = await dataFunctions.getRoles();
            var html = '<option value="">Select Role</option>';
            if (roles && Array.isArray(roles)) {
                roles.forEach(function (role) {
                    html += '<option value="' + escapeHtml(role.id) + '">' + escapeHtml(role.role_name || '') + '</option>';
                });
            }
            select.innerHTML = html;
        },

        save: async function () {
            if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined') return;
            var password = $('#password').val().trim();
            var confirmPassword = $('#txtConfirmPassword').val().trim();
            var emailRaw = $('#email').val().trim();
            var email = emailRaw.toLowerCase();
            $('#email').val(email);
            var formData = {
                username: $('#username').val().trim(),
                email: email,
                first_name: $('#firstName').val().trim(),
                last_name: $('#lastName').val().trim(),
                role_id: $('#cboRole').val(),
                is_active: $('#isActive').is(':checked')
            };
            if (!formData.username) {
                api.showError('Username is required');
                return;
            }
            if (!formData.email) {
                api.showError('Email is required');
                return;
            }
            var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(formData.email)) {
                api.showError('Please enter a valid email address');
                return;
            }
            var form = document.getElementById('userForm');
            var editingId = form && form.getAttribute('data-editing-id');
            if (!editingId) {
                if (!password) {
                    api.showError('Password is required for new users');
                    return;
                }
                if (password !== confirmPassword) {
                    api.showError('Passwords do not match');
                    return;
                }
                formData.password = password;
            } else {
                if (password) {
                    if (password !== confirmPassword) {
                        api.showError('Passwords do not match');
                        return;
                    }
                    formData.password = password;
                }
            }
            if (!formData.role_id) {
                api.showError('Role is required');
                return;
            }
            try {
                if (editingId) {
                    await dataFunctions.updateUser(editingId, formData);
                    api.showSuccess('User updated successfully');
                } else {
                    await dataFunctions.createUser(formData);
                    api.showSuccess('User created successfully');
                }
                var modalEl = document.getElementById('userModal');
                if (modalEl && typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#userModal').modal('hide');
                if (typeof _usersGrid !== 'undefined' && _usersGrid.loadUsers) _usersGrid.loadUsers();
            } catch (error) {
                console.error('Error saving user:', error);
                api.showError('Error saving user: ' + (error.message || ''));
            }
        },

        showError: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(message, 'error');
            else alert(message);
        },

        showSuccess: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(message, 'success');
            else alert(message);
        }
    };

    return api;
})();
_modal_user.init();
