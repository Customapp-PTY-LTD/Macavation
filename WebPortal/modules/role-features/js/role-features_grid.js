/**
 * Role Features Grid Module
 * Checkbox-per-feature UI: select a role, toggle features on/off.
 * Check = grant (createRoleFeature), Uncheck = remove (deleteRoleFeature).
 */

var _roleFeaturesGrid = function () {
    'use strict';

    return {
        allFeatures: [],
        // Map of String(feature_id) -> role_feature_id (bigint from DB)
        roleFeatureIdMap: {},
        selectedRoleId: null,

        init: async () => {
            const scope = _roleFeaturesGrid;
            await scope.waitForReady();
            document.querySelectorAll('[data-access]').forEach(function (el) {
                el.style.display = (el.getAttribute('data-access') === 'role-features') ? '' : 'none';
            });
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
                    dataFunctions.getRoleFeatures()
                ]);

                var featuresResponse = results[0];
                var allRoleFeatures = results[1];

                // Normalise features array
                if (Array.isArray(featuresResponse)) {
                    scope.allFeatures = featuresResponse;
                } else if (featuresResponse && featuresResponse.get_features) {
                    scope.allFeatures = featuresResponse.get_features;
                } else {
                    scope.allFeatures = [];
                }

                // Build map: String(feature_id) -> role_feature.id for this role
                scope.roleFeatureIdMap = {};
                var assigned = Array.isArray(allRoleFeatures) ? allRoleFeatures : [];
                assigned.forEach(function (rf) {
                    if (String(rf.role_id) === String(roleId)) {
                        scope.roleFeatureIdMap[String(rf.feature_id)] = rf.id;
                    }
                });

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
                var isEnabled = Object.prototype.hasOwnProperty.call(scope.roleFeatureIdMap, String(feature.id));
                var checkedAttr = isEnabled ? ' checked' : '';
                var featureKey = scope.escapeHtml(feature.key || '');
                var featureName = scope.escapeHtml(feature.name || '');
                var featureDesc = scope.escapeHtml(feature.description || '');

                return '<tr class="feature-row">' +
                    '<td class="text-center">' +
                    '<div class="form-check d-flex justify-content-center mb-0">' +
                    '<input class="form-check-input feature-checkbox" type="checkbox"' +
                    ' data-feature-id="' + feature.id + '"' +
                    ' data-feature-key="' + featureKey + '"' +
                    checkedAttr + '>' +
                    '</div></td>' +
                    '<td class="fw-medium">' + featureName + '</td>' +
                    '<td><code>' + featureKey + '</code></td>' +
                    '<td class="text-muted small">' + featureDesc + '</td>' +
                    '</tr>';
            }).join('');

            tbody.innerHTML = html;
        },

        toggleFeature: async (featureId, _featureKey, enabled, checkboxEl) => {
            const scope = _roleFeaturesGrid;
            if (!scope.selectedRoleId) return;

            checkboxEl.prop('disabled', true);

            try {
                if (enabled) {
                    var result = await dataFunctions.createRoleFeature({
                        role_id: scope.selectedRoleId,
                        feature_id: featureId,
                        value: 'true'
                    });
                    // Extract the returned role_feature id so we can delete it later
                    var newId = null;
                    if (result) {
                        if (result.id) {
                            newId = result.id;
                        } else if (Array.isArray(result) && result[0] && result[0].id) {
                            newId = result[0].id;
                        }
                    }
                    if (newId) {
                        scope.roleFeatureIdMap[String(featureId)] = newId;
                    } else {
                        // SP didn't return id — reload to get it
                        await scope.reloadRoleFeatureIds();
                    }
                } else {
                    var roleFeatureId = scope.roleFeatureIdMap[String(featureId)];
                    if (roleFeatureId) {
                        await dataFunctions.deleteRoleFeature(roleFeatureId);
                        delete scope.roleFeatureIdMap[String(featureId)];
                    }
                }
                // Invalidate cache so next role load fetches fresh data from DB
                dataFunctions.clearCachePattern('get_role_features');
                scope.updateSummary();
            } catch (error) {
                console.error('[Role Features] Error toggling feature:', error);
                scope.showError('Error saving: ' + (error.message || ''));
                // Revert checkbox
                checkboxEl.prop('checked', !enabled);
            } finally {
                checkboxEl.prop('disabled', false);
            }
        },

        reloadRoleFeatureIds: async () => {
            const scope = _roleFeaturesGrid;
            if (!scope.selectedRoleId) return;
            try {
                var allRoleFeatures = await dataFunctions.getRoleFeatures();
                var assigned = Array.isArray(allRoleFeatures) ? allRoleFeatures : [];
                scope.roleFeatureIdMap = {};
                assigned.forEach(function (rf) {
                    if (String(rf.role_id) === String(scope.selectedRoleId)) {
                        scope.roleFeatureIdMap[String(rf.feature_id)] = rf.id;
                    }
                });
            } catch (error) {
                console.error('[Role Features] Error reloading role feature IDs:', error);
            }
        },

        updateSummary: () => {
            const scope = _roleFeaturesGrid;
            var summaryEl = document.getElementById('featureSummary');
            if (!summaryEl) return;
            var total = scope.allFeatures.length;
            var enabled = Object.keys(scope.roleFeatureIdMap).length;
            summaryEl.style.cssText = '';
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
                summaryEl.style.cssText = 'display:none !important;';
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

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

window._roleFeaturesGrid = _roleFeaturesGrid;

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
