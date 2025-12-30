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
        loadKPIs: async function () {
            try {
                const kpis = await dataFunctions.callFunction('get_executive_kpis', {}).catch(() => ({}));
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

