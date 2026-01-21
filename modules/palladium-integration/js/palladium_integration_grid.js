/**
 * Palladium ERP Integration Grid Module
 */
var _palladiumIntegrationGrid = function () {
    return {
        syncStatus: [],
        init: function () {
            this.setupEventListeners();
            this.loadSyncStatus();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#syncBtn').on('click', function () {
                scope.performSync();
            });
        },
        loadSyncStatus: async function () {
            try {
                const status = await dataFunctions.callFunction('get_palladium_sync_status', {});
                this.syncStatus = status || [];
                this.renderSyncStatus();
            } catch (error) {
                console.error('Error loading sync status:', error);
            }
        },
        renderSyncStatus: function () {
            const tbody = $('#syncTableBody');
            tbody.empty();
            if (this.syncStatus.length === 0) {
                tbody.html('<tr><td colspan="5" class="text-center text-muted">No sync status available</td></tr>');
                return;
            }
            this.syncStatus.forEach(status => {
                const statusClass = status.status === 'success' ? 'bg-success' : 
                                  status.status === 'error' ? 'bg-danger' : 'bg-warning';
                const row = `<tr>
                    <td>${status.entity_type || 'N/A'}</td>
                    <td>${status.last_sync || 'Never'}</td>
                    <td><span class="badge ${statusClass}">${status.status || 'N/A'}</span></td>
                    <td>${status.records_synced || '0'}</td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="palladiumIntegrationGrid.syncEntity('${status.entity_type}')"><i class="fas fa-sync"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        performSync: async function () {
            try {
                Swal.fire({
                    title: 'Syncing...',
                    text: 'Please wait while data is synced with Palladium ERP',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });
                const result = await dataFunctions.callFunction('sync_palladium', {});
                Swal.fire('Success', 'Sync completed successfully', 'success');
                this.loadSyncStatus();
            } catch (error) {
                Swal.fire('Error', 'Sync failed: ' + error.message, 'error');
            }
        },
        syncEntity: async function (entityType) {
            try {
                await dataFunctions.callFunction('sync_palladium_entity', { p_entity_type: entityType });
                Swal.fire('Success', `${entityType} synced successfully`, 'success');
                this.loadSyncStatus();
            } catch (error) {
                Swal.fire('Error', 'Sync failed: ' + error.message, 'error');
            }
        }
    };
}();
const palladiumIntegrationGrid = _palladiumIntegrationGrid;
function initializePalladiumIntegrationGrid() {
    if (typeof palladiumIntegrationGrid !== 'undefined') {
        palladiumIntegrationGrid.init();
    }
}

