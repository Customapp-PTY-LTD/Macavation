/**
 * Material Journey Dashboard Module - Material Journey Tracking
 * Loaded by dashboard router when user role maps to amanda dashboard.
 * Pattern: IIFE, single global _amandaDashboard, arrow methods, const scope for same-module calls.
 */
var _amandaDashboard = function () {
    'use strict';

    return {
        batches: [],
        alerts: [],

        init: async () => {
            const scope = _amandaDashboard;
            scope.setupEventListeners();
            await scope.loadData();
        },

        setupEventListeners: () => {
            const scope = _amandaDashboard;
            $('#refreshBtn').off('click').on('click', () => scope.loadData(true));
        },

        loadData: async (forceRefresh = false) => {
            const scope = _amandaDashboard;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getProductionBatches || !dataFunctions.getDashboardAlerts) {
                    console.error('dataFunctions or dashboard methods not available');
                    return;
                }
                const startTime = performance.now();
                const [batches, alerts] = await Promise.all([
                    dataFunctions.getProductionBatches(null, forceRefresh).catch(() => []),
                    dataFunctions.getDashboardAlerts(null, forceRefresh).catch(() => [])
                ]);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Dashboard data loaded in ${loadTime.toFixed(2)}ms`);

                scope.batches = batches || [];
                scope.alerts = alerts || [];
                scope.renderDashboard();
            } catch (error) {
                console.error('Error loading dashboard data:', error);
            }
        },

        renderDashboard: () => {
            const scope = _amandaDashboard;
            scope.renderAlerts();
            scope.renderBatches();
        },

        renderAlerts: () => {
            const scope = _amandaDashboard;
            const alertsSection = $('#alertsSection');
            if (!alertsSection.length) return;
            if (scope.alerts.length === 0) {
                alertsSection.html('<p class="text-muted mb-0">No active alerts</p>');
                return;
            }
            let html = '<div class="list-group">';
            scope.alerts.forEach((alert) => {
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

        renderBatches: () => {
            const scope = _amandaDashboard;
            const cardsContainer = $('#materialJourneyCards');
            if (!cardsContainer.length) return;
            cardsContainer.empty();
            if (scope.batches.length === 0) {
                cardsContainer.html('<div class="col-12"><p class="text-muted text-center">No batches in system</p></div>');
                return;
            }
            scope.batches.forEach((batch) => {
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

window.initializeAmandaDashboard = function () {
    if (typeof _amandaDashboard !== 'undefined' && _amandaDashboard.init) {
        _amandaDashboard.init();
    }
};
