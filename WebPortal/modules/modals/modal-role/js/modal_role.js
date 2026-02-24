/**
 * Modal: Add/Edit Role. Parent calls show() or show(role). Modal owns init, show, clearForm, save.
 */
var _modal_role = (function () {
    'use strict';

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveRoleBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('roleModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: function (role) {
            var title = document.getElementById('roleModalLabel');
            if (title) title.textContent = role ? 'Edit Role' : 'Add Role';
            api.clearForm();
            var form = document.getElementById('roleForm');
            if (form) form.removeAttribute('data-editing-id');
            if (role) {
                if (form && role.id) form.setAttribute('data-editing-id', role.id);
                if (typeof $ !== 'undefined') {
                    $('#roleName').val(role.role_name || '');
                    $('#roleDescription').val(role.description || '');
                    $('#isActive').prop('checked', role.is_active !== false);
                    $('#cboStatus').val(role.is_active !== false ? 'active' : 'inactive');
                }
            }
            var modalEl = document.getElementById('roleModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#roleModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('roleForm');
            if (form) { form.reset(); form.removeAttribute('data-editing-id'); }
            if (typeof $ !== 'undefined') $('#isActive').prop('checked', true);
        },

        save: async function () {
            if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined') return;
            var roleName = $('#roleName').val().trim();
            var description = $('#roleDescription').val().trim();
            var isActive = $('#isActive').is(':checked');
            if (!roleName) {
                api.showError('Role name is required');
                return;
            }
            var formData = {
                role_name: roleName,
                description: description,
                is_active: isActive
            };
            var form = document.getElementById('roleForm');
            var editingId = form && form.getAttribute('data-editing-id');
            try {
                if (editingId) {
                    await dataFunctions.updateRole(editingId, formData);
                    api.showSuccess('Role updated successfully');
                } else {
                    await dataFunctions.createRole(formData);
                    api.showSuccess('Role created successfully');
                }
                var modalEl = document.getElementById('roleModal');
                if (modalEl && typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#roleModal').modal('hide');
                if (typeof _rolesGrid !== 'undefined' && _rolesGrid.loadRoles) _rolesGrid.loadRoles();
            } catch (error) {
                console.error('Error saving role:', error);
                api.showError('Error saving role: ' + (error.message || ''));
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
_modal_role.init();
