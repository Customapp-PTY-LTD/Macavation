/**
 * Modal: Add/Edit Role Feature. Parent calls show() or show(feature). Modal owns init, show, clearForm, save.
 */
var _modal_role_feature = (function () {
    'use strict';

    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveFeatureBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('featureModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: async function (feature) {
            var title = document.getElementById('featureModalLabel');
            if (title) title.textContent = feature ? 'Edit Role Feature' : 'Add Role Feature';
            api.clearForm();
            var form = document.getElementById('featureForm');
            if (form) form.removeAttribute('data-editing-id');
            if (feature) {
                if (form && feature.id) form.setAttribute('data-editing-id', feature.id);
                if (typeof $ !== 'undefined') {
                    $('#cboRole').val(feature.role_id || '');
                    $('#cboFeature').val(feature.feature_id || '');
                    $('#cboValue').val(feature.value === true || feature.feature_value === true ? 'true' : (feature.value === false || feature.feature_value === false ? 'false' : (feature.value || feature.feature_value || '')));
                    $('#txtDescription').val(feature.description || feature.feature_description || '');
                }
            }
            try {
                await api.loadRolesForDropdown();
                await api.loadFeaturesForDropdown();
                if (feature && typeof $ !== 'undefined') {
                    $('#cboRole').val(feature.role_id || '');
                    $('#cboFeature').val(feature.feature_id || '');
                    $('#cboValue').val(feature.value === true || feature.feature_value === true ? 'true' : (feature.value === false || feature.feature_value === false ? 'false' : (feature.value || feature.feature_value || '')));
                    $('#txtDescription').val(feature.description || feature.feature_description || '');
                }
            } catch (e) { console.error('Error loading dropdowns:', e); }
            var modalEl = document.getElementById('featureModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#featureModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('featureForm');
            if (form) { form.reset(); form.removeAttribute('data-editing-id'); }
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

        loadFeaturesForDropdown: async function () {
            var select = document.getElementById('cboFeature');
            if (!select || typeof dataFunctions === 'undefined' || !dataFunctions.getFeatures) return;
            var response = await dataFunctions.getFeatures();
            var features = [];
            if (response && Array.isArray(response)) features = response;
            else if (response && response.get_features && Array.isArray(response.get_features)) features = response.get_features;
            var html = '<option value="">Select Feature</option>';
            features.forEach(function (feature) {
                var id = feature.id || '';
                var name = feature.feature_name || feature.name || '';
                html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(name) + '</option>';
            });
            select.innerHTML = html;
        },

        save: async function () {
            if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined') return;
            var roleId = $('#cboRole').val();
            var featureId = $('#cboFeature').val();
            var value = $('#cboValue').val();
            var description = $('#txtDescription').val() || '';
            if (!roleId) {
                api.showError('Role is required');
                return;
            }
            if (!featureId) {
                api.showError('Feature is required');
                return;
            }
            if (!value) {
                api.showError('Value is required');
                return;
            }
            var backendData = {
                role_id: roleId,
                feature_id: featureId,
                value: value === 'true' ? true : (value === 'false' ? false : value),
                description: description
            };
            var form = document.getElementById('featureForm');
            var editingId = form && form.getAttribute('data-editing-id');
            try {
                if (editingId) {
                    await dataFunctions.updateRoleFeature(editingId, backendData);
                    api.showSuccess('Feature updated successfully');
                } else {
                    await dataFunctions.createRoleFeature(backendData);
                    api.showSuccess('Feature created successfully');
                }
                var modalEl = document.getElementById('featureModal');
                if (modalEl && typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#featureModal').modal('hide');
                if (typeof _roleFeaturesGrid !== 'undefined' && _roleFeaturesGrid.loadFeatures) _roleFeaturesGrid.loadFeatures();
            } catch (error) {
                console.error('Error saving feature:', error);
                api.showError('Error saving feature: ' + (error.message || ''));
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
_modal_role_feature.init();
