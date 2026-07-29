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
        featuresLoadSeq: 0,
        loadedRoleId: null,
        featuresSaveSeq: 0,
        pendingSaves: 0,

        canApplyFeaturesLoad: (roleId, loadSeq) => {
            const scope = _roleFeaturesGrid;
            return loadSeq === scope.featuresLoadSeq &&
                String(roleId) === String(scope.selectedRoleId);
        },

        canSaveFeaturesForRole: () => {
            const scope = _roleFeaturesGrid;
            return !!(scope.selectedRoleId && scope.loadedRoleId &&
                String(scope.selectedRoleId) === String(scope.loadedRoleId));
        },

        canApplyFeaturesSave: (roleId, loadSeq, saveSeq) => {
            const scope = _roleFeaturesGrid;
            return saveSeq === scope.featuresSaveSeq &&
                loadSeq === scope.featuresLoadSeq &&
                String(roleId) === String(scope.selectedRoleId) &&
                String(roleId) === String(scope.loadedRoleId);
        },

        setFeatureCheckboxesDisabled: (disabled) => {
            document.querySelectorAll('.feature-checkbox').forEach(function (el) {
                el.disabled = disabled;
            });
        },

        beginFeatureSave: () => {
            const scope = _roleFeaturesGrid;
            scope.pendingSaves += 1;
            scope.setFeatureCheckboxesDisabled(true);
        },

        endFeatureSave: () => {
            const scope = _roleFeaturesGrid;
            scope.pendingSaves = Math.max(0, scope.pendingSaves - 1);
            if (scope.pendingSaves === 0 && scope.loadedRoleId) {
                scope.setFeatureCheckboxesDisabled(false);
            }
        },

        refreshSessionFeatureKeysIfCurrentRole: (roleId) => {
            var user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
            var currentRoleId = user && user.role_id ? user.role_id : null;
            if (currentRoleId && String(currentRoleId) === String(roleId)) {
                if (typeof Session !== 'undefined' && Session.remove) Session.remove('featureKeys');
                if (typeof authService !== 'undefined' && authService.fetchAndCacheFeatures) {
                    authService.fetchAndCacheFeatures(currentRoleId);
                } else if (typeof menuFilter !== 'undefined' && menuFilter.refresh) {
                    menuFilter.refresh();
                }
            }
        },

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
                scope.featuresSaveSeq += 1;
                if (roleId) {
                    scope.loadFeaturesForRole(roleId);
                } else {
                    scope.selectedRoleId = null;
                    scope.loadedRoleId = null;
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
                var roles = await (dataFunctions.getRolesForAssignment
                    ? dataFunctions.getRolesForAssignment()
                    : dataFunctions.getRoles());
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
            scope.loadedRoleId = null;
            scope.roleFeatureIdMap = {};
            scope.featuresLoadSeq += 1;
            var loadSeq = scope.featuresLoadSeq;
            scope.selectedRoleRecord = null;
            if (typeof dataFunctions !== 'undefined' && dataFunctions.getRoles) {
                var allRoles = await dataFunctions.getRoles();
                scope.selectedRoleRecord = (Array.isArray(allRoles) ? allRoles : []).find(function (r) {
                    return String(r.id) === String(roleId);
                }) || null;
            }
            scope.showLoading();

            try {
                var roleFeaturesPromise = dataFunctions.getRoleFeaturesForRole
                    ? dataFunctions.getRoleFeaturesForRole(roleId, null, true)
                    : dataFunctions.getRoleFeatures(null, true);
                var results = await Promise.all([
                    dataFunctions.getFeatures(),
                    roleFeaturesPromise
                ]);

                if (!scope.canApplyFeaturesLoad(roleId, loadSeq)) return;

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

                scope.loadedRoleId = roleId;
                scope.renderFeatures();
                scope.updateSummary();
            } catch (error) {
                if (!scope.canApplyFeaturesLoad(roleId, loadSeq)) return;
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

            var orderedFeatures = (typeof roleMenuConfig !== 'undefined' && roleMenuConfig.sortFeaturesByPortalOrder)
                ? roleMenuConfig.sortFeaturesByPortalOrder(scope.allFeatures)
                : scope.allFeatures;

            var html = orderedFeatures.map(function (feature) {
                var isEnabled = Object.prototype.hasOwnProperty.call(scope.roleFeatureIdMap, String(feature.id));
                var checkedAttr = isEnabled ? ' checked' : '';
                var featureKey = scope.escapeHtml(feature.key || '');
                var featureName = scope.escapeHtml(
                    (typeof roleMenuConfig !== 'undefined' && roleMenuConfig.getPortalModuleLabel)
                        ? roleMenuConfig.getPortalModuleLabel(feature.key, feature.name)
                        : (feature.name || '')
                );
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
            if (!scope.canSaveFeaturesForRole()) {
                scope.showError('Role data is still loading. Wait for Loading to finish, then try again.');
                checkboxEl.prop('checked', !enabled);
                return;
            }
            if (typeof superUserVisibility !== 'undefined' && scope.selectedRoleRecord &&
                !superUserVisibility.canManageRole(scope.selectedRoleRecord)) {
                scope.showError('Only super users may change features for the super_user role.');
                checkboxEl.prop('checked', !enabled);
                return;
            }

            var saveRoleId = scope.loadedRoleId;
            var loadSeq = scope.featuresLoadSeq;
            var saveSeq = scope.featuresSaveSeq;
            scope.beginFeatureSave();
            checkboxEl.prop('disabled', true);

            try {
                if (!scope.canApplyFeaturesSave(saveRoleId, loadSeq, saveSeq)) {
                    checkboxEl.prop('checked', !enabled);
                    return;
                }
                if (enabled) {
                    var result = await dataFunctions.createRoleFeature({
                        role_id: saveRoleId,
                        feature_id: featureId,
                        value: 'true'
                    });
                    if (!scope.canApplyFeaturesSave(saveRoleId, loadSeq, saveSeq)) {
                        checkboxEl.prop('checked', !enabled);
                        return;
                    }
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
                        await scope.reloadRoleFeatureIds();
                    }
                } else {
                    if (!dataFunctions.deleteRoleFeatureForRole) {
                        throw new Error('Role-scoped feature delete is unavailable. Apply migration 20260716100000_role_scoped_feature_action_delete.sql.');
                    }
                    await dataFunctions.deleteRoleFeatureForRole(saveRoleId, featureId);
                    if (!scope.canApplyFeaturesSave(saveRoleId, loadSeq, saveSeq)) {
                        checkboxEl.prop('checked', !enabled);
                        return;
                    }
                    delete scope.roleFeatureIdMap[String(featureId)];
                }
                dataFunctions.clearCachePattern('get_role_features');
                dataFunctions.clearCachePattern('get_role_features_for_role');
                dataFunctions.clearCachePattern('get_features_for_role');
                scope.updateSummary();
                scope.refreshSessionFeatureKeysIfCurrentRole(saveRoleId);
            } catch (error) {
                console.error('[Role Features] Error toggling feature:', error);
                scope.showError('Error saving: ' + (error.message || ''));
                checkboxEl.prop('checked', !enabled);
            } finally {
                scope.endFeatureSave();
                if (scope.pendingSaves === 0) {
                    checkboxEl.prop('disabled', false);
                }
            }
        },

        reloadRoleFeatureIds: async () => {
            const scope = _roleFeaturesGrid;
            if (!scope.selectedRoleId || !scope.canSaveFeaturesForRole()) return;
            try {
                var assigned = [];
                if (dataFunctions.getRoleFeaturesForRole) {
                    assigned = await dataFunctions.getRoleFeaturesForRole(scope.selectedRoleId, null, true);
                } else {
                    var allRoleFeatures = await dataFunctions.getRoleFeatures(null, true);
                    assigned = Array.isArray(allRoleFeatures) ? allRoleFeatures : [];
                }
                scope.roleFeatureIdMap = {};
                (Array.isArray(assigned) ? assigned : []).forEach(function (rf) {
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
            // Count enabled same way we render checkboxes (by feature.id in map) so summary and checkboxes stay in sync
            var enabled = scope.allFeatures.filter(function (f) {
                return Object.prototype.hasOwnProperty.call(scope.roleFeatureIdMap, String(f.id));
            }).length;
            summaryEl.style.cssText = '';
            summaryEl.innerHTML = '<span class="badge bg-primary me-2">' + enabled + ' / ' + total + '</span>' +
                '<span class="text-muted">features enabled for this role</span>';
        },

        clearFeatures: () => {
            _roleFeaturesGrid.loadedRoleId = null;
            _roleFeaturesGrid.roleFeatureIdMap = {};
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
