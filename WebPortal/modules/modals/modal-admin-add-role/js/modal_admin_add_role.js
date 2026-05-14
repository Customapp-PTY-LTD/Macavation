/**
 * Modal: Add Role (Admin). Content and behaviour owned by this module.
 * Parent (admin grid) only loads this route into the container and opens the modal.
 */
var _modal_admin_add_role = (function () {
    'use strict';

    return {
        init: () => {
            const scope = _modal_admin_add_role;
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_admin_add_role;
            $('#addRoleSubmitBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.submitRoleForm();
            });
        },

        submitRoleForm: async () => {
            const scope = _modal_admin_add_role;
            var form = document.getElementById('addRoleForm');
            if (!form) return;
            var formData = new FormData(form);
            var roleData = {
                role_name: formData.get('role_name'),
                description: formData.get('description') || null,
                is_active: formData.get('is_active') === 'true'
            };
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createRole) {
                scope.showNotification('Role creation not available', 'error');
                return;
            }
            try {
                var result = await dataFunctions.createRole(roleData);
                if (result && result.success) {
                    scope.showNotification('Role created successfully', 'success');
                    var modalEl = document.getElementById('addRoleModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modal = bootstrap.Modal.getInstance(modalEl);
                        if (modal) modal.hide();
                    } else if (typeof $ !== 'undefined') {
                        $('#addRoleModal').modal('hide');
                    }
                    form.reset();
                    if (typeof _adminGrid !== 'undefined' && _adminGrid.loadRoles) _adminGrid.loadRoles();
                } else {
                    scope.showNotification('Failed to create role', 'error');
                }
            } catch (error) {
                console.error('Error submitting role form:', error);
                scope.showNotification('Error creating role: ' + (error && error.message ? error.message : error), 'error');
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
_modal_admin_add_role.init();
