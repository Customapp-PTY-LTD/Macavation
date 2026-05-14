/**
 * Modal: Add/Edit Role Permission. Parent calls show() or show(permission). Modal owns init, show, clearForm, save.
 */
var _modal_role_permission = (function () {
    'use strict';

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    var api = {
        init: function () {
            var saveBtn = document.getElementById('savePermissionBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('permissionModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: async function (permission) {
            var title = document.getElementById('permissionModalLabel');
            if (title) title.textContent = permission ? 'Edit Database Role Permission' : 'Add Database Role Permission';
            api.clearForm();
            var form = document.getElementById('permissionForm');
            if (form) form.removeAttribute('data-editing-id');
            if (permission) {
                if (form && permission.id) form.setAttribute('data-editing-id', permission.id);
                if (typeof $ !== 'undefined') {
                    $('#cboRole').val(permission.role_id || '');
                    $('#cboObjectType').val(permission.object_type || '');
                    $('#cboPermission').val(permission.operation || '');
                    $('#txtDescription').val(permission.description || '');
                    $('#cboStatus').val(permission.is_active !== undefined && permission.is_active ? 'active' : 'inactive');
                    $('#chkIsDefault').prop('checked', !!permission.is_default);
                }
            }
            try {
                await api.loadRolesForDropdown();
                if (permission && typeof $ !== 'undefined') {
                    $('#cboRole').val(permission.role_id || '');
                    $('#cboObjectType').val(permission.object_type || '');
                    $('#cboPermission').val(permission.operation || '');
                    $('#txtDescription').val(permission.description || '');
                    $('#cboStatus').val(permission.is_active !== undefined && permission.is_active ? 'active' : 'inactive');
                    $('#chkIsDefault').prop('checked', !!permission.is_default);
                }
            } catch (e) { console.error('Error loading roles:', e); }
            var modalEl = document.getElementById('permissionModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#permissionModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('permissionForm');
            if (form) { form.reset(); form.removeAttribute('data-editing-id'); }
            if (typeof $ !== 'undefined') $('#chkIsDefault').prop('checked', false);
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
            var roleId = $('#cboRole').val();
            var objectType = $('#cboObjectType').val() || '';
            var operation = $('#cboPermission').val() || '';
            var description = $('#txtDescription').val() || '';
            var isActive = $('#cboStatus').val() === 'active';
            if (!roleId) {
                api.showError('Role is required');
                return;
            }
            if (!objectType) {
                api.showError('Object type is required');
                return;
            }
            if (!operation) {
                api.showError('Permission is required');
                return;
            }
            var formData = {
                role_id: roleId,
                object_name: objectType,
                object_type: objectType,
                operation: operation,
                description: description,
                is_active: isActive
            };
            var form = document.getElementById('permissionForm');
            var editingId = form && form.getAttribute('data-editing-id');
            try {
                if (editingId) {
                    await dataFunctions.updateRolePermission(editingId, formData);
                    api.showSuccess('Permission updated successfully');
                } else {
                    await dataFunctions.createRolePermission(formData);
                    api.showSuccess('Permission created successfully');
                }
                var modalEl = document.getElementById('permissionModal');
                if (modalEl && typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#permissionModal').modal('hide');
                if (typeof _rolePermissionsGrid !== 'undefined' && _rolePermissionsGrid.loadPermissions) _rolePermissionsGrid.loadPermissions();
                if (typeof _adminGrid !== 'undefined' && _adminGrid.reloadEmbeddedPermissionsIfActive) _adminGrid.reloadEmbeddedPermissionsIfActive();
            } catch (error) {
                console.error('Error saving permission:', error);
                api.showError('Error saving permission: ' + (error.message || ''));
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
_modal_role_permission.init();
