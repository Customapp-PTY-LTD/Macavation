/**
 * Role Features Grid Module
 * Checkbox-per-feature UI: select a role, toggle features on/off with auto-save.
 */

var _roleFeaturesGrid = function () {
    'use strict';

    return {
        allFeatures: [],
        enabledKeys: [],
        selectedRoleId: null,

        init: async () => {
            const scope = _roleFeaturesGrid;
            await scope.waitForReady();
            // Unified role grids: show only this section (data-access)
            document.querySelectorAll('[data-access]').forEach(function (el) {
                el.style.display = (el.getAttribute('data-access') === 'role-features') ? '' : 'none';
            });
            var modalContainers = document.querySelectorAll('.modal[route-name]');
            var loadPromises = [];
            modalContainers.forEach(function (el) {
                var routeName = el.getAttribute('route-name');
                if (routeName && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + el.id }));
                }
            });
            if (loadPromises.length) await Promise.all(loadPromises);
            if (typeof _modal_role_feature !== 'undefined' && _modal_role_feature.init) _modal_role_feature.init();
            scope.setupEventListeners();
            await scope.loadRolesDropdown();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _roleFeaturesGrid;

            $('#roleSelect').on('change', function () {
                var roleId = $(this).val();
                if (roleId) {
                    scope.loadFeaturesForRole(roleId);
                } else {
                    scope.selectedRoleId = null;
                    scope.clearFeatures();
                }
            });

            $(document).on('change', '.feature-checkbox', function () {
                var checkbox = $(this);
                var featureId = checkbox.data('feature-id');
                var featureKey = checkbox.data('feature-key');
                var enabled = checkbox.is(':checked');
                scope.toggleFeature(featureId, featureKey, enabled, checkbox);
            });

            $('#refreshFeaturesBtn').on('click', function () {
                scope.refreshFeatures();
            });
        },

        loadRolesDropdown: async () => {
            try {
                var roles = await dataFunctions.getRoles();
                if (!roles || !Array.isArray(roles) || roles.length === 0) return;
                var select = document.getElementById('roleSelect');
                if (!select) return;
                var html = '<option value="">-- Select a role --</option>';
                roles.forEach(function (role) {
                    var name = _roleFeaturesGrid.escapeHtml(role.role_name);
                    html += '<option value="' + role.id + '">' + name + '</option>';
                });
                select.innerHTML = html;
            } catch (error) {
                console.error('[Role Features] Error loading roles:', error);
            }
        },

        loadFeaturesForRole: async (roleId) => {
            const scope = _roleFeaturesGrid;
            scope.selectedRoleId = roleId;
            scope.showLoading();

            try {
                var results = await Promise.all([
                    dataFunctions.getFeatures(),
                    dataFunctions.getFeaturesForRole(roleId)
                ]);

                var featuresResponse = results[0];
                var enabledResponse = results[1];

                // Parse features
                if (Array.isArray(featuresResponse)) {
                    scope.allFeatures = featuresResponse;
                } else if (featuresResponse && featuresResponse.get_features) {
                    scope.allFeatures = featuresResponse.get_features;
                } else {
                    scope.allFeatures = [];
                }

                // Parse enabled keys
                scope.enabledKeys = [];
                if (Array.isArray(enabledResponse)) {
                    scope.enabledKeys = enabledResponse.map(function (row) {
                        return row.key;
                    });
                }

                scope.renderFeatures();
                scope.updateSummary();
            } catch (error) {
                console.error('[Role Features] Error loading features:', error);
                scope.showError('Error loading features: ' + (error.message || ''));
            }
        },

        renderFeatures: () => {
            const scope = _roleFeaturesGrid;
            var tbody = document.getElementById('featuresTableBody');
            if (!tbody) return;

            if (scope.allFeatures.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">' +
                    '<i class="fas fa-info-circle me-2"></i>No features found</td></tr>';
                return;
            }

            var html = scope.allFeatures.map(function (feature) {
                var isEnabled = scope.enabledKeys.indexOf(feature.key) !== -1;
                var checkedAttr = isEnabled ? ' checked' : '';
                var featureId = feature.id;
                var featureKey = scope.escapeHtml(feature.key || '');
                var featureName = scope.escapeHtml(feature.name || '');
                var featureDesc = scope.escapeHtml(feature.description || '');

                return '<tr class="feature-row">' +
                    '<td class="text-center">' +
                    '<div class="form-check d-flex justify-content-center mb-0">' +
                    '<input class="form-check-input feature-checkbox" type="checkbox"' +
                    ' data-feature-id="' + featureId + '"' +
                    ' data-feature-key="' + featureKey + '"' +
                    checkedAttr + '>' +
                    '</div></td>' +
                    '<td class="fw-medium">' + featureName + '</td>' +
                    '<td><code>' + featureKey + '</code></td>' +
                    '<td class="text-muted">' + featureDesc + '</td>' +
                    '</tr>';
            }).join('');

            tbody.innerHTML = html;
        },

        toggleFeature: async (featureId, featureKey, enabled, checkboxEl) => {
            const scope = _roleFeaturesGrid;
            if (!scope.selectedRoleId) return;

            // Disable checkbox during save
            checkboxEl.prop('disabled', true);
            checkboxEl.closest('tr').addClass('saving');

            try {
                await dataFunctions.createRoleFeature({
                    role_id: scope.selectedRoleId,
                    feature_id: featureId,
                    value: enabled ? 'true' : 'false'
                });

                // Update local state
                if (enabled && scope.enabledKeys.indexOf(featureKey) === -1) {
                    scope.enabledKeys.push(featureKey);
                } else if (!enabled) {
                    scope.enabledKeys = scope.enabledKeys.filter(function (k) {
                        return k !== featureKey;
                    });
                }

                scope.updateSummary();
            } catch (error) {
                console.error('[Role Features] Error toggling feature:', error);
                scope.showError('Error saving: ' + (error.message || ''));
                // Revert checkbox
                checkboxEl.prop('checked', !enabled);
            } finally {
                checkboxEl.prop('disabled', false);
                checkboxEl.closest('tr').removeClass('saving');
            }
        },

        updateSummary: () => {
            const scope = _roleFeaturesGrid;
            var summaryEl = document.getElementById('featureSummary');
            if (!summaryEl) return;
            var total = scope.allFeatures.length;
            var enabled = scope.enabledKeys.length;
            summaryEl.style.display = '';
            summaryEl.className = 'col-md-8 d-flex align-items-center';
            summaryEl.innerHTML = '<span class="badge bg-primary me-2">' + enabled + ' / ' + total + '</span>' +
                '<span class="text-muted">features enabled for this role</span>';
        },

        clearFeatures: () => {
            var tbody = document.getElementById('featuresTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-5">' +
                    '<i class="fas fa-hand-pointer me-2"></i>Select a role above to manage its feature access' +
                    '</td></tr>';
            }
            var summaryEl = document.getElementById('featureSummary');
            if (summaryEl) {
                summaryEl.style.display = 'none';
                summaryEl.innerHTML = '';
            }
        },

        refreshFeatures: () => {
            const scope = _roleFeaturesGrid;
            if (scope.selectedRoleId) {
                scope.loadFeaturesForRole(scope.selectedRoleId);
            }
        },

        showLoading: () => {
            var tbody = document.getElementById('featuresTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">' +
                    '<i class="fas fa-spinner fa-spin me-2"></i>Loading features...</td></tr>';
            }
        },

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
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

window.roleFeaturesGrid = _roleFeaturesGrid;

function initializeRoleFeaturesGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _roleFeaturesGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeRoleFeaturesGrid();
});
