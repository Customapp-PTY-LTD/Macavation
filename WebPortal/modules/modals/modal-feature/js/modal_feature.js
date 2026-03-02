/**
 * Modal: Add/Edit Feature. Parent calls show() or show(feature).
 */
var _modal_feature = (function () {
    'use strict';

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveFeatureBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('featureModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: function (feature) {
            var title = document.getElementById('featureModalLabel');
            if (title) title.textContent = feature ? 'Edit Feature' : 'Add Feature';
            api.clearForm();
            var form = document.getElementById('featureForm');
            if (form) form.removeAttribute('data-editing-id');
            if (feature) {
                if (form && feature.id) form.setAttribute('data-editing-id', feature.id);
                if (typeof $ !== 'undefined') {
                    $('#featureKey').val(feature.key || '');
                    $('#featureName').val(feature.name || '');
                    $('#featureDescription').val(feature.description || '');
                    $('#featureIsActive').prop('checked', feature.is_active !== false);
                }
            }
            var modalEl = document.getElementById('featureModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#featureModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('featureForm');
            if (form) { form.reset(); form.removeAttribute('data-editing-id'); }
            if (typeof $ !== 'undefined') $('#featureIsActive').prop('checked', true);
        },

        save: async function () {
            if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined') return;
            var key = $('#featureKey').val().trim();
            var name = $('#featureName').val().trim();
            var description = $('#featureDescription').val().trim();
            var isActive = $('#featureIsActive').is(':checked');

            if (!key) { api.showError('Feature key is required'); return; }
            if (!name) { api.showError('Feature name is required'); return; }

            var formData = {
                key: key,
                name: name,
                description: description,
                is_active: isActive
            };

            var form = document.getElementById('featureForm');
            var editingId = form && form.getAttribute('data-editing-id');

            try {
                if (editingId) {
                    await dataFunctions.updateFeature(editingId, formData);
                    api.showSuccess('Feature updated successfully');
                } else {
                    await dataFunctions.createFeature(formData);
                    api.showSuccess('Feature created successfully');
                }
                var modalEl = document.getElementById('featureModal');
                if (modalEl && typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
                else if (typeof $ !== 'undefined' && $.fn.modal) $('#featureModal').modal('hide');
                if (typeof _featuresGrid !== 'undefined' && _featuresGrid.loadFeatures) _featuresGrid.loadFeatures();
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
_modal_feature.init();
