/**
 * Role Actions Grid Module
 * Checkbox-per-action UI grouped by module: select a role, toggle actions on/off.
 * Check = grant (createRoleAction), Uncheck = revoke (deleteRoleAction).
 * Mirrors role-features_grid.js.
 */
var _roleActionsGrid = function () {
    'use strict';

    return {
        allActions: [],
        // Map of String(action_id) -> role_action_id (bigint from DB)
        roleActionIdMap: {},
        selectedRoleId: null,

        init: async () => {
            const scope = _roleActionsGrid;
            await scope.waitForReady();
            document.querySelectorAll('[data-access]').forEach(function (el) {
                el.style.display = (el.getAttribute('data-access') === 'role-actions') ? '' : 'none';
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
            const scope = _roleActionsGrid;

            $('#actionRoleSelect').on('change', function () {
                var roleId = $(this).val();
                if (roleId) {
                    scope.loadActionsForRole(roleId);
                } else {
                    scope.selectedRoleId = null;
                    scope.clearActions();
                }
            });

            $(document).on('change', '.action-checkbox', function () {
                var checkbox = $(this);
                var actionId = checkbox.data('action-id');
                var enabled = checkbox.is(':checked');
                scope.toggleAction(actionId, enabled, checkbox);
            });

            $('#refreshActionsBtn').on('click', function () {
                scope.refreshActions();
            });
        },

        loadRolesDropdown: async () => {
            try {
                var roles = await dataFunctions.getRoles();
                if (!roles || !Array.isArray(roles) || roles.length === 0) return;
                var select = document.getElementById('actionRoleSelect');
                if (!select) return;
                var html = '<option value="">-- Select a role --</option>';
                roles.forEach(function (role) {
                    var name = _roleActionsGrid.escapeHtml(role.role_name);
                    html += '<option value="' + role.id + '">' + name + '</option>';
                });
                select.innerHTML = html;
            } catch (error) {
                console.error('[Role Actions] Error loading roles:', error);
            }
        },

        loadActionsForRole: async (roleId) => {
            const scope = _roleActionsGrid;
            scope.selectedRoleId = roleId;
            scope.showLoading();

            try {
                var results = await Promise.all([
                    dataFunctions.getActions(),
                    dataFunctions.getRoleActions()
                ]);

                scope.allActions = Array.isArray(results[0]) ? results[0] : [];
                var allRoleActions = Array.isArray(results[1]) ? results[1] : [];

                scope.roleActionIdMap = {};
                allRoleActions.forEach(function (ra) {
                    if (String(ra.role_id) === String(roleId) && ra.value === 'true') {
                        // get_role_actions returns ra.id and joined action_key; map by action key->id lookup below
                        scope.roleActionIdMap[String(ra.action_key)] = ra.id;
                    }
                });

                scope.renderActions();
                scope.updateSummary();
            } catch (error) {
                console.error('[Role Actions] Error loading actions:', error);
                scope.showError('Error loading actions: ' + (error.message || ''));
            }
        },

        renderActions: () => {
            const scope = _roleActionsGrid;
            var tbody = document.getElementById('actionsTableBody');
            if (!tbody) return;

            if (scope.allActions.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">' +
                    '<i class="fas fa-info-circle me-2"></i>No actions found. Apply migration 20260602100000_create_actions_tables.sql.</td></tr>';
                return;
            }

            // Group actions by module for readability.
            var groups = {};
            scope.allActions.forEach(function (a) {
                var mod = a.module || 'Other';
                if (!groups[mod]) groups[mod] = [];
                groups[mod].push(a);
            });

            var html = '';
            Object.keys(groups).forEach(function (mod) {
                html += '<tr class="table-light"><td colspan="4" class="fw-semibold text-uppercase small text-muted">' +
                    scope.escapeHtml(mod) + '</td></tr>';
                groups[mod].forEach(function (action) {
                    var isEnabled = Object.prototype.hasOwnProperty.call(scope.roleActionIdMap, String(action.key));
                    var checkedAttr = isEnabled ? ' checked' : '';
                    var actionKey = scope.escapeHtml(action.key || '');
                    var actionLabel = scope.escapeHtml(action.label || '');
                    var actionDesc = scope.escapeHtml(action.description || '');

                    html += '<tr class="action-row">' +
                        '<td class="text-center">' +
                        '<div class="form-check d-flex justify-content-center mb-0">' +
                        '<input class="form-check-input action-checkbox" type="checkbox"' +
                        ' data-action-id="' + action.id + '"' +
                        ' data-action-key="' + actionKey + '"' +
                        checkedAttr + '>' +
                        '</div></td>' +
                        '<td class="fw-medium">' + actionLabel + '</td>' +
                        '<td><code>' + actionKey + '</code></td>' +
                        '<td class="text-muted small">' + actionDesc + '</td>' +
                        '</tr>';
                });
            });

            tbody.innerHTML = html;
        },

        toggleAction: async (actionId, enabled, checkboxEl) => {
            const scope = _roleActionsGrid;
            if (!scope.selectedRoleId) return;

            var actionKey = checkboxEl.data('action-key');
            checkboxEl.prop('disabled', true);

            try {
                if (enabled) {
                    var result = await dataFunctions.createRoleAction({
                        role_id: scope.selectedRoleId,
                        action_id: actionId,
                        value: 'true'
                    });
                    var newId = null;
                    if (result) {
                        if (result.id) newId = result.id;
                        else if (Array.isArray(result) && result[0] && result[0].id) newId = result[0].id;
                    }
                    if (newId) {
                        scope.roleActionIdMap[String(actionKey)] = newId;
                    } else {
                        await scope.reloadRoleActionIds();
                    }
                } else {
                    var roleActionId = scope.roleActionIdMap[String(actionKey)];
                    if (roleActionId) {
                        await dataFunctions.deleteRoleAction(roleActionId);
                        delete scope.roleActionIdMap[String(actionKey)];
                    }
                }
                dataFunctions.clearCachePattern('get_role_actions');
                dataFunctions.clearCachePattern('get_actions_for_role');
                scope.updateSummary();

                // If editing current user's role, refresh cached actionKeys.
                var user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
                var currentRoleId = user && user.role_id ? user.role_id : null;
                if (currentRoleId && String(currentRoleId) === String(scope.selectedRoleId)) {
                    if (typeof authService !== 'undefined' && authService.fetchAndCacheFeatures) {
                        authService.fetchAndCacheFeatures(currentRoleId);
                    }
                }
            } catch (error) {
                console.error('[Role Actions] Error toggling action:', error);
                scope.showError('Error saving: ' + (error.message || ''));
                checkboxEl.prop('checked', !enabled);
            } finally {
                checkboxEl.prop('disabled', false);
            }
        },

        reloadRoleActionIds: async () => {
            const scope = _roleActionsGrid;
            if (!scope.selectedRoleId) return;
            try {
                var allRoleActions = await dataFunctions.getRoleActions();
                scope.roleActionIdMap = {};
                (Array.isArray(allRoleActions) ? allRoleActions : []).forEach(function (ra) {
                    if (String(ra.role_id) === String(scope.selectedRoleId) && ra.value === 'true') {
                        scope.roleActionIdMap[String(ra.action_key)] = ra.id;
                    }
                });
            } catch (error) {
                console.error('[Role Actions] Error reloading role action IDs:', error);
            }
        },

        updateSummary: () => {
            const scope = _roleActionsGrid;
            var summaryEl = document.getElementById('actionSummary');
            if (!summaryEl) return;
            var total = scope.allActions.length;
            var enabled = scope.allActions.filter(function (a) {
                return Object.prototype.hasOwnProperty.call(scope.roleActionIdMap, String(a.key));
            }).length;
            summaryEl.style.cssText = '';
            summaryEl.innerHTML = '<span class="badge bg-primary me-2">' + enabled + ' / ' + total + '</span>' +
                '<span class="text-muted">actions allowed for this role</span>';
        },

        clearActions: () => {
            var tbody = document.getElementById('actionsTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-5">' +
                    '<i class="fas fa-hand-pointer me-2"></i>Select a role above to manage its action permissions' +
                    '</td></tr>';
            }
            var summaryEl = document.getElementById('actionSummary');
            if (summaryEl) {
                summaryEl.style.cssText = 'display:none !important;';
                summaryEl.innerHTML = '';
            }
        },

        refreshActions: () => {
            const scope = _roleActionsGrid;
            if (scope.selectedRoleId) {
                scope.loadActionsForRole(scope.selectedRoleId);
            }
        },

        showLoading: () => {
            var tbody = document.getElementById('actionsTableBody');
            if (tbody) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">' +
                    '<i class="fas fa-spinner fa-spin me-2"></i>Loading actions...</td></tr>';
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

window._roleActionsGrid = _roleActionsGrid;

function initializeRoleActionsGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _roleActionsGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeRoleActionsGrid();
});
