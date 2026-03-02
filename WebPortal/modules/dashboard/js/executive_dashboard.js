/**
 * Executive Dashboard Module
 * Loaded by dashboard router when user role maps to executive dashboard.
 */
var _executiveDashboard = function () {
    'use strict';

    return {
        kpis: {},

        init: async () => {
            const scope = _executiveDashboard;
            // Unified dashboard: show only this role's section (data-access)
            document.querySelectorAll('[data-access]').forEach(function (el) {
                el.style.display = (el.getAttribute('data-access') === 'executive') ? '' : 'none';
            });
            scope.initHandlers();
            await scope.loadKPIs();
        },

        initHandlers: () => {
            const scope = _executiveDashboard;
            $('#generateReportBtn').off('click').on('click', () => {
                Swal.fire('Info', 'Report generation coming soon', 'info');
            });
        },

        loadKPIs: async (forceRefresh = false) => {
            const scope = _executiveDashboard;
            try {
                const startTime = performance.now();
                const kpis = await dataFunctions.getExecutiveKPIs(null, forceRefresh).catch(() => ({}));
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Executive KPIs loaded in ${loadTime.toFixed(2)}ms`);

                scope.kpis = kpis || {};
                scope.renderKPIs();
            } catch (error) {
                console.error('Error loading KPIs:', error);
            }
        },

        renderKPIs: () => {
            const scope = _executiveDashboard;
            $('#totalProduction').text(scope.kpis.total_production_kg || '0');
            $('#activeBatches').text(scope.kpis.active_batches || '0');
            $('#totalSales').text('R ' + (scope.kpis.total_sales || '0.00'));
            $('#qualityPassRate').text((scope.kpis.quality_pass_rate || '0') + '%');
        }
    };
}();

window.initializeExecutiveDashboard = function () {
    if (typeof _executiveDashboard !== 'undefined' && _executiveDashboard.init) {
        _executiveDashboard.init();
    }
};
