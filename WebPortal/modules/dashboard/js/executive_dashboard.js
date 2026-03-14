/**
 * Executive Dashboard Module
 * Loaded by dashboard router when user role maps to executive dashboard.
 */
var _executiveDashboard = function () {
    'use strict';

    var DASHBOARD_VISIBILITY_KEY = 'executive_dashboard_visible_widgets';
    var DASHBOARD_WIDGET_LABELS = {
        totalProduction: 'Total Production (kg)',
        qualityPassRate: 'Quality Pass Rate',
        execStatBatchesInProduction: 'Kernel batches in production',
        execStatKgCrackedToday: 'Kg cracked today',
        execStatKgCrackedWeek: 'Kg cracked this week',
        execStatKgPackedToday: 'Kg packed today',
        execStatKgPackedWeek: 'Kg packed this week',
        execStatBatchesAwaitingTest: 'Awaiting test',
        execStatBatchesReleaseReady: 'Release ready',
        execStatBatchesCompletedWeek: 'Completed this week',
        execStatBatchesInIntake: 'In intake',
        execStatBatchesOnHold: 'On hold',
        execStatOilLitresToday: 'Oil (L) today',
        execStatOilLitresWeek: 'Oil (L) this week',
        execStatOilSheetsWeek: 'Oil sheets this week',
        execStatQualityPassRate: 'Quality pass rate',
        execStatQualityTestsWeek: 'Quality tests this week',
        execStatDispatchWeek: 'Dispatch this week',
        execStatDispatchPending: 'Dispatch pending',
        execDailyMinuteTests: 'Daily minute tests',
        execProductionTrends: 'Production Trends'
    };

    return {
        kpis: {},
        productionTrendsData: null,
        productionTrendsChart: null,


        init: async () => {
            const scope = _executiveDashboard;
            // Unified dashboard: show only this role's section (data-access) via d-none
            document.querySelectorAll('[data-access]').forEach(function (el) {
                if (el.getAttribute('data-access') === 'executive') {
                    el.classList.remove('d-none');
                } else {
                    el.classList.add('d-none');
                }
            });
            scope.initHandlers();
            scope.applyDashboardVisibility();
            await scope.loadKPIs();
            await scope.loadKernelStats();
            await scope.loadProductionStats();
            await scope.loadDailyMinuteTests();
            await scope.loadProductionTrendsChart();
        },

        getDashboardVisibility: function () {
            try {
                var raw = localStorage.getItem(DASHBOARD_VISIBILITY_KEY);
                if (raw === null) return null;
                var arr = JSON.parse(raw);
                return Array.isArray(arr) ? arr : null;
            } catch (e) {
                return null;
            }
        },

        setDashboardVisibility: function (visibleIds) {
            try {
                if (visibleIds === null) {
                    localStorage.removeItem(DASHBOARD_VISIBILITY_KEY);
                } else {
                    localStorage.setItem(DASHBOARD_VISIBILITY_KEY, JSON.stringify(visibleIds));
                }
            } catch (e) {
                console.warn('[Executive Dashboard] Could not save visibility', e);
            }
        },

        applyDashboardVisibility: function () {
            var visible = _executiveDashboard.getDashboardVisibility();
            var allIds = Object.keys(DASHBOARD_WIDGET_LABELS);
            document.querySelectorAll('[data-dashboard-widget]').forEach(function (el) {
                var id = el.getAttribute('data-dashboard-widget');
                if (!id) return;
                var show = visible === null || visible.indexOf(id) >= 0;
                el.style.display = show ? '' : 'none';
            });
        },

        openCustomizeModal: function () {
            var visible = _executiveDashboard.getDashboardVisibility();
            var allIds = Object.keys(DASHBOARD_WIDGET_LABELS);
            var checkedSet = visible === null ? allIds.slice() : visible;
            var container = document.getElementById('execDashboardWidgetCheckboxes');
            if (!container) return;
            container.innerHTML = '';
            allIds.forEach(function (id) {
                var label = DASHBOARD_WIDGET_LABELS[id] || id;
                var checked = checkedSet.indexOf(id) >= 0;
                var item = document.createElement('label');
                item.className = 'list-group-item list-group-item-action d-flex align-items-center';
                item.innerHTML = '<input type="checkbox" class="form-check-input me-2" data-dashboard-widget-id="' + id.replace(/"/g, '&quot;') + '" ' + (checked ? 'checked' : '') + '> ' + label;
                container.appendChild(item);
            });
            var modalEl = document.getElementById('execDashboardCustomizeModal');
            if (typeof bootstrap !== 'undefined' && modalEl) {
                var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                modal.show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#execDashboardCustomizeModal').modal('show');
            }
        },

        saveCustomizeModal: function () {
            var checkboxes = document.querySelectorAll('#execDashboardWidgetCheckboxes input[data-dashboard-widget-id]');
            var visible = [];
            checkboxes.forEach(function (cb) {
                if (cb.checked) visible.push(cb.getAttribute('data-dashboard-widget-id'));
            });
            _executiveDashboard.setDashboardVisibility(visible.length === Object.keys(DASHBOARD_WIDGET_LABELS).length ? null : visible);
            _executiveDashboard.applyDashboardVisibility();
            var modalEl = document.getElementById('execDashboardCustomizeModal');
            if (typeof bootstrap !== 'undefined' && modalEl) {
                var modal = bootstrap.Modal.getInstance(modalEl);
                if (modal) modal.hide();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#execDashboardCustomizeModal').modal('hide');
            }
        },

        loadKernelStats: async () => {
            const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-ZA', { maximumFractionDigits: 0 }) : (n || 0));
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getDashboardKernelStats) return;
                const stats = await dataFunctions.getDashboardKernelStats();
                $('#execStatBatchesInProduction').text(Number(stats.batches_in_production) || 0);
                $('#execStatKgCrackedToday').text(fmt(stats.kg_cracked_today));
                $('#execStatKgCrackedWeek').text(fmt(stats.kg_cracked_week));
                $('#execStatKgPackedToday').text(fmt(stats.kg_packed_today));
                $('#execStatKgPackedWeek').text(fmt(stats.kg_packed_week));
            } catch (error) {
                console.error('Error loading kernel stats:', error);
                $('#execStatBatchesInProduction, #execStatKgCrackedToday, #execStatKgCrackedWeek, #execStatKgPackedToday, #execStatKgPackedWeek').text('—');
            }
        },

        loadDailyMinuteTests: async () => {
            const slotMap = { '07h00': '07', '10h00': '10', '13h00': '13', 'Averages': 'avg' };
            const cols = ['batch', 'wholes', 'uncracks', 'total'];
            const empty = '\u2014';
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getDailyMinuteTests) return;
                const rows = await dataFunctions.getDailyMinuteTests();
                rows.forEach(function (r) {
                    var slot = slotMap[r.time_slot];
                    if (!slot) return;
                    cols.forEach(function (col) {
                        var val = r[col];
                        var cell = document.querySelector('.minute-test-cell[data-slot="' + slot + '"][data-col="' + col + '"]');
                        if (cell) cell.textContent = (val != null && String(val).trim() !== '') ? String(val).trim() : empty;
                    });
                });
            } catch (e) {
                console.error('Error loading daily minute tests:', e);
                document.querySelectorAll('.minute-test-cell').forEach(function (el) { el.textContent = empty; });
            }
        },

        loadProductionStats: async () => {
            const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-ZA', { maximumFractionDigits: 0 }) : (n || 0));
            const fmtDec = (n, d) => (typeof n === 'number' ? Number(n).toLocaleString('en-ZA', { minimumFractionDigits: d, maximumFractionDigits: d }) : (n || 0));
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getDashboardProductionStats) return;
                const s = await dataFunctions.getDashboardProductionStats();
                $('#execStatBatchesAwaitingTest').text(fmt(s.batches_awaiting_test));
                $('#execStatBatchesReleaseReady').text(fmt(s.batches_release_ready));
                $('#execStatBatchesCompletedWeek').text(fmt(s.batches_completed_week));
                $('#execStatBatchesInIntake').text(fmt(s.batches_in_intake));
                $('#execStatBatchesOnHold').text(fmt(s.batches_on_hold));
                $('#execStatOilLitresToday').text(fmtDec(s.oil_litres_today, 1));
                $('#execStatOilLitresWeek').text(fmtDec(s.oil_litres_week, 1));
                $('#execStatOilSheetsWeek').text(fmt(s.oil_sheets_week));
                $('#execStatQualityPassRate').text(fmtDec(s.quality_pass_rate, 1) + '%');
                $('#execStatQualityTestsWeek').text(fmt(s.quality_tests_week));
                $('#execStatDispatchWeek').text(fmt(s.dispatch_orders_week));
                $('#execStatDispatchPending').text(fmt(s.dispatch_pending));
            } catch (error) {
                console.error('Error loading production stats:', error);
                $('#execStatBatchesAwaitingTest, #execStatBatchesReleaseReady, #execStatBatchesCompletedWeek, #execStatBatchesInIntake, #execStatBatchesOnHold, #execStatOilLitresToday, #execStatOilLitresWeek, #execStatOilSheetsWeek, #execStatQualityPassRate, #execStatQualityTestsWeek, #execStatDispatchWeek, #execStatDispatchPending').text('—');
            }
        },

        initHandlers: () => {
            const scope = _executiveDashboard;
            $('#generateReportBtn').off('click').on('click', () => {
                Swal.fire('Info', 'Report generation coming soon', 'info');
            });
            $('#customizeDashboardBtn').off('click').on('click', function () {
                scope.openCustomizeModal();
            });
            $('#execDashboardSelectAll').off('click').on('click', function () {
                $('#execDashboardWidgetCheckboxes input[data-dashboard-widget-id]').prop('checked', true);
            });
            $('#execDashboardDeselectAll').off('click').on('click', function () {
                $('#execDashboardWidgetCheckboxes input[data-dashboard-widget-id]').prop('checked', false);
            });
            $('#execDashboardSaveVisibility').off('click').on('click', function () {
                scope.saveCustomizeModal();
            });
            $('#productionTrendsMetric').off('change').on('change', function () {
                scope.updateProductionTrendsChart();
            });
        },

        loadProductionTrendsChart: async () => {
            const scope = _executiveDashboard;
            const canvas = document.getElementById('productionTrendsChart');
            if (!canvas) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getProductionTrendsDaily) return;
            try {
                const raw = await dataFunctions.getProductionTrendsDaily(30);
                scope.productionTrendsData = Array.isArray(raw) ? raw : [];
                scope.renderProductionTrendsChart();
            } catch (e) {
                console.error('Error loading production trends:', e);
                if (canvas && canvas.parentNode) {
                    canvas.parentNode.innerHTML = '<p class="text-muted small mb-0">Unable to load trends. Apply migration get_production_trends_daily if needed.</p>';
                }
            }
        },

        renderProductionTrendsChart: () => {
            const scope = _executiveDashboard;
            const data = scope.productionTrendsData || [];
            const canvas = document.getElementById('productionTrendsChart');
            if (!canvas || !data.length) return;
            const labels = data.map(function (r) {
                var d = r.trend_date;
                if (!d) return '';
                if (typeof d === 'string') d = d.split('T')[0];
                var parts = d.split('-');
                if (parts.length === 3) return parts[2] + '/' + parts[1];
                return d;
            });
            const metric = document.getElementById('productionTrendsMetric');
            const key = (metric && metric.value) ? metric.value : 'kg_cracked';
            const datasetLabel = metric && metric.options[metric.selectedIndex] ? metric.options[metric.selectedIndex].text : 'kg';
            const values = data.map(function (r) { return Number(r[key]) || 0; });
            if (scope.productionTrendsChart) {
                scope.productionTrendsChart.data.labels = labels;
                scope.productionTrendsChart.data.datasets[0].label = datasetLabel;
                scope.productionTrendsChart.data.datasets[0].data = values;
                scope.productionTrendsChart.update();
                return;
            }
            if (typeof Chart === 'undefined') return;
            var ctx = canvas.getContext('2d');
            scope.productionTrendsChart = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [{
                        label: datasetLabel,
                        data: values,
                        backgroundColor: 'rgba(13, 110, 253, 0.6)',
                        borderColor: 'rgba(13, 110, 253, 1)',
                        borderWidth: 1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: function (item) { return (item.raw || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 }) + ' kg'; }
                            }
                        }
                    },
                    scales: {
                        x: { ticks: { maxRotation: 45, minRotation: 0, maxTicksLimit: 15 } },
                        y: {
                            beginAtZero: true,
                            ticks: { callback: function (v) { return (v || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 }); } }
                        }
                    }
                }
            });
        },

        updateProductionTrendsChart: () => {
            _executiveDashboard.renderProductionTrendsChart();
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
            $('#qualityPassRate').text((scope.kpis.quality_pass_rate || '0') + '%');
        }
    };
}();

window.initializeExecutiveDashboard = function () {
    if (typeof _executiveDashboard !== 'undefined' && _executiveDashboard.init) {
        _executiveDashboard.init();
    }
};
