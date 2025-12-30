/**
 * Executive Dashboard Module
 */
var _executiveDashboard = function () {
    return {
        kpis: {},
        init: function () {
            this.setupEventListeners();
            this.loadKPIs();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#generateReportBtn').on('click', function () {
                Swal.fire('Info', 'Report generation coming soon', 'info');
            });
        },
        loadKPIs: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                const kpis = await dataFunctions.getExecutiveKPIs(null, forceRefresh).catch(() => ({}));
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Executive KPIs loaded in ${loadTime.toFixed(2)}ms`);
                
                this.kpis = kpis || {};
                this.renderKPIs();
            } catch (error) {
                console.error('Error loading KPIs:', error);
            }
        },
        renderKPIs: function () {
            $('#totalProduction').text(this.kpis.total_production_kg || '0');
            $('#activeBatches').text(this.kpis.active_batches || '0');
            $('#totalSales').text('R ' + (this.kpis.total_sales || '0.00'));
            $('#qualityPassRate').text((this.kpis.quality_pass_rate || '0') + '%');
        }
    };
}();
const executiveDashboard = _executiveDashboard;
function initializeExecutiveDashboard() {
    if (typeof executiveDashboard !== 'undefined') {
        executiveDashboard.init();
    }
}

