/**
 * Material Journey Dashboard Module - Material Journey Tracking
 */
var _amandaDashboard = function () {
    return {
        batches: [],
        alerts: [],
        init: function () {
            this.setupEventListeners();
            this.loadData();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#refreshBtn').on('click', function () {
                scope.loadData(true); // Force refresh
            });
        },
        loadData: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                // Load batches and alerts in parallel (both use cache)
                const [batches, alerts] = await Promise.all([
                    dataFunctions.getProductionBatches(null, forceRefresh).catch(() => []),
                    dataFunctions.getDashboardAlerts(null, forceRefresh).catch(() => [])
                ]);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Dashboard data loaded in ${loadTime.toFixed(2)}ms`);
                
                this.batches = batches || [];
                this.alerts = alerts || [];
                this.renderDashboard();
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        },
        renderDashboard: function () {
            this.renderAlerts();
            this.renderBatches();
        },
        renderAlerts: function () {
            const alertsSection = $('#alertsSection');
            if (this.alerts.length === 0) {
                alertsSection.html('<p class="text-muted mb-0">No active alerts</p>');
                return;
            }
            let html = '<div class="list-group">';
            this.alerts.forEach(alert => {
                const severityClass = alert.severity === 'critical' ? 'list-group-item-danger' :
                                    alert.severity === 'warning' ? 'list-group-item-warning' : 'list-group-item-info';
                html += `<div class="list-group-item ${severityClass}">
                    <h6 class="mb-1">${alert.alert_title || 'Alert'}</h6>
                    <p class="mb-1">${alert.alert_message || ''}</p>
                    <small>Batch: ${alert.batch_number || 'N/A'}</small>
                </div>`;
            });
            html += '</div>';
            alertsSection.html(html);
        },
        renderBatches: function () {
            const cardsContainer = $('#materialJourneyCards');
            cardsContainer.empty();
            if (this.batches.length === 0) {
                cardsContainer.html('<div class="col-12"><p class="text-muted text-center">No batches in system</p></div>');
                return;
            }
            this.batches.forEach(batch => {
                const card = `<div class="col-md-6 col-lg-4 mb-4">
                    <div class="card h-100">
                        <div class="card-header">
                            <h6 class="mb-0">${batch.batch_number || 'N/A'}</h6>
                        </div>
                        <div class="card-body">
                            <p><strong>Grower:</strong> ${batch.grower_name || 'N/A'}</p>
                            <p><strong>Status:</strong> <span class="badge bg-info">${batch.status || 'N/A'}</span></p>
                            <p><strong>Step:</strong> ${batch.current_step || 1}/17</p>
                            <p><strong>Wet NIS:</strong> ${batch.wet_nis_received_kg || '0'} kg</p>
                        </div>
                    </div>
                </div>`;
                cardsContainer.append(card);
            });
        }
    };
}();
const amandaDashboard = _amandaDashboard;
function initializeAmandaDashboard() {
    if (typeof amandaDashboard !== 'undefined') {
        amandaDashboard.init();
    }
}

