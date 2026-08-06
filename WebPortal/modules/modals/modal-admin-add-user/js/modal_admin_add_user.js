/**
 * Modal: Add User (Admin). Content and behaviour owned by this module.
 * Parent (admin grid) only loads this route into the container and opens the modal.
 */
var _modal_admin_add_user = (function () {
    'use strict';

    return {
        init: () => {
            const scope = _modal_admin_add_user;
            scope.loadRolesForSelect();
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_admin_add_user;
            $('#addUserSubmitBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.submitUserForm();
            });
        },

        loadRolesForSelect: async () => {
            const scope = _modal_admin_add_user;
            var select = document.getElementById('userRoleSelect');
            if (!select || typeof dataFunctions === 'undefined' || !dataFunctions.getRoles) return;
            try {
                var roles = await dataFunctions.getRoles();
                if (!roles || !Array.isArray(roles)) return;
                var currentValue = select.value;
                select.innerHTML = '<option value="">Select role...</option>' +
                    roles.filter(function (r) { return r.is_active !== false; }).map(function (role) {
                        return '<option value="' + (role.id || '') + '">' + (scope.escapeHtml(window.formatRoleName(role.role_name || role.name || ''))) + '</option>';
                    }).join('');
                if (currentValue) select.value = currentValue;
            } catch (e) {
                console.warn('Could not load roles for Add User modal:', e);
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            return _common.escapeHtml(text);
        },

        submitUserForm: async () => {
            const scope = _modal_admin_add_user;
            var form = document.getElementById('addUserForm');
            if (!form) return;
            var formData = new FormData(form);
            var emailRaw = (formData.get('email') || '').toString().trim();
            var email = emailRaw.toLowerCase();
            var emailInput = form.querySelector('[name="email"]');
            if (emailInput) emailInput.value = email;
            var userData = {
                first_name: formData.get('first_name'),
                last_name: formData.get('last_name'),
                email: email,
                phone_number: formData.get('phone_number') || null,
                role_id: formData.get('role_id'),
                is_active: formData.get('is_active') === 'true'
            };
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createUser) {
                scope.showNotification('User creation not available', 'error');
                return;
            }
            try {
                var result = await dataFunctions.createUser(userData);
                if (result && result.success) {
                    scope.showNotification('User created successfully', 'success');
                    var modalEl = document.getElementById('addUserModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modal = bootstrap.Modal.getInstance(modalEl);
                        if (modal) modal.hide();
                    } else if (typeof $ !== 'undefined') {
                        $('#addUserModal').modal('hide');
                    }
                    form.reset();
                    if (typeof _adminGrid !== 'undefined' && _adminGrid.loadUsers) _adminGrid.loadUsers();
                } else {
                    scope.showNotification('Failed to create user', 'error');
                }
            } catch (error) {
                console.error('Error submitting user form:', error);
                scope.showNotification('Error creating user: ' + (error && error.message ? error.message : error), 'error');
            }
        },

        showNotification: (message, type) => {
            if (typeof _common !== 'undefined') {
                if (type === 'success' && _common.showSuccessToast) _common.showSuccessToast(message);
                else if (type === 'error' && _common.showErrorToast) _common.showErrorToast(message);
                else if (_common.showInfoToast) _common.showInfoToast(message);
                return;
            }
            if (typeof Swal !== 'undefined' && Swal.fire) {
                Swal.fire({
                    icon: type === 'error' ? 'error' : type === 'success' ? 'success' : 'info',
                    title: type === 'error' ? 'Error' : type === 'success' ? 'Success' : 'Info',
                    text: message,
                    timer: type === 'error' ? 5000 : 3000,
                    showConfirmButton: type === 'error',
                    toast: type !== 'error',
                    position: type === 'error' ? 'center' : 'top-end'
                });
            } else {
                alert(message);
            }
        }
    };
}());
_modal_admin_add_user.init();
