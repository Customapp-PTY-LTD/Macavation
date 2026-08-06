/**
 * Palladium ERP Integration Grid Module
 * Follows company module pattern: IIFE, arrow methods, scope = _palladiumIntegrationGrid for same-module calls.
 */
var _palladiumIntegrationGrid = function () {
    'use strict';

    return {
        syncStatus: [],

        init: async () => {
            const scope = _palladiumIntegrationGrid;
            await scope.waitForReady();
            scope.setupEventListeners();
            await scope.loadSyncStatus();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                if (typeof $ !== 'undefined') {
                    $(document).ready(resolve);
                } else if (document.readyState === 'complete') {
                    resolve();
                } else {
                    document.addEventListener('DOMContentLoaded', resolve);
                }
            });
        },

        setupEventListeners: () => {
            const scope = _palladiumIntegrationGrid;
            if (typeof $ === 'undefined') return;
            $('#syncBtn').on('click', function () {
                scope.performSync();
            });
            $(document).on('click', '.js-sync-entity', function (e) {
                e.preventDefault();
                var entity = $(this).attr('data-entity-type');
                if (entity) scope.syncEntity(entity);
            });
        },

        loadSyncStatus: async () => {
            const scope = _palladiumIntegrationGrid;
            try {
                var status = await dataFunctions.callFunction('get_palladium_sync_status', {});
                scope.syncStatus = status && Array.isArray(status) ? status : [];
                scope.renderSyncStatus();
            } catch (error) {
                console.error('Error loading sync status:', error);
            }
        },

        renderSyncStatus: () => {
            const scope = _palladiumIntegrationGrid;
            if (typeof $ === 'undefined') return;
            var tbody = $('#syncTableBody');
            tbody.empty();
            if (!scope.syncStatus || scope.syncStatus.length === 0) {
                tbody.html('<tr><td colspan="5" class="text-center text-muted">No sync status available</td></tr>');
                return;
            }
            scope.syncStatus.forEach(function (item) {
                var statusClass = item.status === 'success' ? 'bg-success' : (item.status === 'error' ? 'bg-danger' : 'bg-warning');
                var entityEscaped = scope.escapeHtml(item.entity_type || '');
                var row = '<tr><td>' + entityEscaped + '</td><td>' + scope.escapeHtml(item.last_sync || 'Never') + '</td><td><span class="badge ' + statusClass + '">' + scope.escapeHtml(item.status || 'N/A') + '</span></td><td>' + (item.records_synced != null ? item.records_synced : '0') + '</td><td class="mac-table-actions-col">' + MacTableActions.render({
                    items: [{ label: 'Sync', className: 'js-sync-entity', icon: 'fas fa-sync', attrs: { 'data-entity-type': item.entity_type || '' } }]
                }) + '</td></tr>';
                tbody.append(row);
            });
            MacTableActions.init(document.getElementById('syncTable'));
        },

        performSync: async () => {
            const scope = _palladiumIntegrationGrid;
            try {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        title: 'Syncing...',
                        text: 'Please wait while data is synced with Palladium ERP',
                        allowOutsideClick: false,
                        didOpen: function () {
                            Swal.showLoading();
                        }
                    });
                }
                await dataFunctions.callFunction('sync_palladium', {});
                if (typeof Swal !== 'undefined') Swal.fire('Success', 'Sync completed successfully', 'success');
                scope.loadSyncStatus();
            } catch (error) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Sync failed: ' + error.message, 'error');
            }
        },

        syncEntity: async (entityType) => {
            const scope = _palladiumIntegrationGrid;
            try {
                await dataFunctions.callFunction('sync_palladium_entity', { p_entity_type: entityType });
                if (typeof Swal !== 'undefined') Swal.fire('Success', (entityType || '') + ' synced successfully', 'success');
                scope.loadSyncStatus();
            } catch (error) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Sync failed: ' + error.message, 'error');
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            return _common.escapeHtml(text);
        }
    };
}();

window.palladiumIntegrationGrid = _palladiumIntegrationGrid;

function initializePalladiumIntegrationGrid() {
    if (typeof _palladiumIntegrationGrid !== 'undefined') {
        if (typeof $ !== 'undefined') {
            $(document).ready(function () { _palladiumIntegrationGrid.init(); });
        } else if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { _palladiumIntegrationGrid.init(); });
        } else {
            _palladiumIntegrationGrid.init();
        }
    }
}
