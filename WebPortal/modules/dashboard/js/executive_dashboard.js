/**
 * Executive Dashboard Module
 * Loaded by dashboard router when user role maps to executive dashboard.
 */
var _executiveDashboard = function () {
    'use strict';

    var DASHBOARD_VISIBILITY_KEY = 'executive_dashboard_visible_widgets';
    var PRODUCTION_TRENDS_HIDE_WEEKENDS_KEY = 'production_trends_hide_weekends';

    function isWeekendIsoDate(iso) {
        var parts = String(iso).split('T')[0].split('-');
        if (parts.length !== 3) return false;
        var dow = new Date(+parts[0], +parts[1] - 1, +parts[2]).getDay();
        return dow === 0 || dow === 6;
    }
    var DASHBOARD_WIDGET_LABELS = {
        totalProduction: 'Total Production (kg)',
        execStatBatchesInProduction: 'Kernel batches in production',
        execStatKgCrackedToday: 'Kg cracked today',
        execStatKgCrackedWeek: 'Kg cracked this week',
        execStatKgPackedToday: 'Kg packed today',
        execStatKgPackedWeek: 'Kg packed this week',
        execStatBatchesAwaitingTest: 'Awaiting test',
        execStatBatchesReleaseReady: 'Release ready',
        execStatBatchesCompletedWeek: 'Completed this week',
        execStatBatchesInIntake: 'In intake',
        execStatOilLitresToday: 'Oil bins today',
        execStatOilLitresWeek: 'Oil bins this week',
        execStatDispatchWeek: 'Dispatch this week',
        execStatDispatchPending: 'Dispatch pending',
        execDailyMinuteTests: 'Daily minute tests',
        execProductionTrends: 'Production Trends',
        execProcurementForecast: 'Procurement & forecast',
        execStockAlerts: 'Stock alerts',
        execRunway: 'Raw material runway',
        execOilTrends: 'Oil production trends',
        execStockAccuracy: 'Stock accuracy',
        execProducedVsTarget: 'Produced vs target',
        execDailyReportDelivery: 'Daily report delivery',
        execSoundRecovery: 'Sound kernel recovery',
        execOilYield: 'Oil yield',
        execStockOnHand: 'Stock on hand summary',
        execConsolidatedSummary: 'Oil consolidated summary',
        execOilForecast: 'Oil production forecast'
    };

    return {
        kpis: {},
        productionTrendsData: null,
        productionTrendsChart: null,
        productionTrendsPageOffset: 0,
        productionTrendsRangeKey: '1Y',
        productionTrendsHideWeekends: true,


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
            await scope.loadProcurementForecastChart();
            await scope.loadExecutiveAlerts();
            await scope.loadRunwaySummary();
            await scope.loadOilTrendsChart();
            await scope.loadStockAccuracyChart();
            await scope.loadProducedVsTarget();
            await scope.loadPhase2ExtendedKpis();
            await scope.loadConsolidatedSummary();
            await scope.loadOilForecastChart();
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

        // Role-specific default widget sets. Used only when the user has not saved
        // a custom selection. null/missing role falls back to all widgets.
        getDefaultWidgetsForRole: function () {
            var role = '';
            try {
                if (typeof roleMenuConfig !== 'undefined' && roleMenuConfig.getUserRole) {
                    role = String(roleMenuConfig.getUserRole() || '').toLowerCase();
                }
                if (!role) {
                    var user = (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
                    role = String((user && (user.role_name || user.role)) || '').toLowerCase();
                }
            } catch (e) { role = ''; }

            var production = ['totalProduction', 'execStatBatchesInProduction', 'execStatKgCrackedToday', 'execStatKgCrackedWeek',
                'execStatKgPackedToday', 'execStatKgPackedWeek', 'execStatBatchesAwaitingTest', 'execStatBatchesReleaseReady',
                'execStatBatchesCompletedWeek', 'execStatBatchesInIntake', 'execDailyMinuteTests', 'execProductionTrends'];
            var oil = ['execStatOilLitresToday', 'execStatOilLitresWeek', 'execProductionTrends', 'totalProduction'];
            var qa = ['execStatBatchesAwaitingTest', 'execStatBatchesReleaseReady', 'execDailyMinuteTests', 'totalProduction'];
            var forecastSales = ['execProcurementForecast', 'totalProduction', 'execStatBatchesCompletedWeek', 'execProductionTrends'];

            var map = {
                'production manager': production,
                'qa supervisor': qa,
                'oil plant manager': oil,
                'pwa sales': forecastSales
            };
            return map[role] || null;
        },

        applyDashboardVisibility: function () {
            var visible = _executiveDashboard.getDashboardVisibility();
            if (visible === null) {
                // No saved custom selection: apply role default if one exists.
                visible = _executiveDashboard.getDefaultWidgetsForRole();
            }
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
                $('#execStatOilLitresToday').text(fmt(s.oil_litres_today));
                $('#execStatOilLitresWeek').text(fmt(s.oil_litres_week));
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
            try {
                var storedHideWeekends = localStorage.getItem(PRODUCTION_TRENDS_HIDE_WEEKENDS_KEY);
                if (storedHideWeekends !== null) {
                    scope.productionTrendsHideWeekends = storedHideWeekends === 'true';
                }
            } catch (e) {
                scope.productionTrendsHideWeekends = true;
            }
            var hideWeekendsEl = document.getElementById('productionTrendsHideWeekends');
            if (hideWeekendsEl) hideWeekendsEl.checked = scope.productionTrendsHideWeekends !== false;
            $('#generateReportBtn').off('click').on('click', () => {
                if (typeof _appRouter !== 'undefined') {
                    _appRouter.navigate('scheduled-reports-grid');
                } else {
                    Swal.fire('Info', 'Open Scheduled Reports from Support in the sidebar.', 'info');
                }
            });
            $('#execDailyReportBtn, #execOpenScheduledReportsBtn').off('click').on('click', function () {
                if (typeof _appRouter !== 'undefined') {
                    _appRouter.navigate('scheduled-reports-grid');
                }
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
            $('#productionTrendsView').off('change').on('change', function () {
                scope.productionTrendsPageOffset = 0;
                var v = (this && this.value) ? String(this.value) : 'monthly';
                if (v === 'yearly' && (scope.productionTrendsRangeKey === '1M' || scope.productionTrendsRangeKey === '3M' || scope.productionTrendsRangeKey === '6M')) {
                    scope.productionTrendsRangeKey = '1Y';
                }
                scope.updateProductionTrendsChart();
            });
            $('#productionTrendsChartType').off('change').on('change', function () {
                scope.updateProductionTrendsChart();
            });
            $('.production-trends-range-btn').off('click').on('click', function () {
                var r = $(this).data('range');
                scope.productionTrendsRangeKey = r ? String(r).toUpperCase() : '1Y';
                scope.productionTrendsPageOffset = 0;
                scope.updateProductionTrendsChart();
            });
            $('#productionTrendsPrev').off('click').on('click', function () {
                scope.productionTrendsPageOffset += 1;
                scope.updateProductionTrendsChart();
            });
            $('#productionTrendsNext').off('click').on('click', function () {
                scope.productionTrendsPageOffset = Math.max(0, (scope.productionTrendsPageOffset || 0) - 1);
                scope.updateProductionTrendsChart();
            });
            $('#productionTrendsHideWeekends').off('change').on('change', function () {
                scope.productionTrendsHideWeekends = !!(this && this.checked);
                try {
                    localStorage.setItem(PRODUCTION_TRENDS_HIDE_WEEKENDS_KEY, scope.productionTrendsHideWeekends ? 'true' : 'false');
                } catch (e) {
                    console.warn('[Executive Dashboard] Could not save hide-weekends preference', e);
                }
                scope.updateProductionTrendsChart();
            });
        },

        loadProductionTrendsChart: async () => {
            const scope = _executiveDashboard;
            const canvas = document.getElementById('productionTrendsChart');
            if (!canvas) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getProductionTrendsDaily) return;
            try {
                const raw = await dataFunctions.getProductionTrendsDaily(1825);
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
            const metric = document.getElementById('productionTrendsMetric');
            const key = (metric && metric.value) ? metric.value : 'kg_cracked';
            const datasetLabel = metric && metric.options[metric.selectedIndex] ? metric.options[metric.selectedIndex].text : 'kg';
            const viewSel = document.getElementById('productionTrendsView');
            const viewMode = (viewSel && viewSel.value) ? viewSel.value : 'monthly';
            const typeSel = document.getElementById('productionTrendsChartType');
            const chartType = (typeSel && typeSel.value) ? typeSel.value : 'bar';
            var pageOffset = Number(scope.productionTrendsPageOffset) || 0;
            if (pageOffset < 0) pageOffset = 0;
            var rangeKey = (scope.productionTrendsRangeKey || '1Y').toUpperCase();

            function spanForRange(view, key) {
                if (key === 'ALL') return null;
                if (view === 'yearly') {
                    if (key === '1Y') return 12;
                    if (key === '3Y') return 36;
                    if (key === '5Y') return 60;
                    return 12;
                }
                if (key === '1M') return 31;
                if (key === '3M') return 93;
                if (key === '6M') return 186;
                if (key === '1Y') return 366;
                if (key === '3Y') return 1096;
                if (key === '5Y') return 1826;
                return 366;
            }

            var prepared = [];
            var totalWindows = 1;
            if (viewMode === 'yearly') {
                var byMonth = {};
                data.forEach(function (r) {
                    var iso = (r && r.trend_date) ? String(r.trend_date).split('T')[0] : '';
                    if (!iso || iso.length < 7) return;
                    var monthKey = iso.slice(0, 7); // YYYY-MM
                    if (!byMonth[monthKey]) byMonth[monthKey] = 0;
                    byMonth[monthKey] += Number(r[key]) || 0;
                });
                var monthly = Object.keys(byMonth).sort().map(function (monthKey) {
                    var y = monthKey.slice(0, 4);
                    var m = monthKey.slice(5, 7);
                    return { label: m + '/' + y, value: byMonth[monthKey] };
                });
                var yearWindow = spanForRange('yearly', rangeKey);
                if (yearWindow == null) {
                    prepared = monthly.slice();
                    totalWindows = 1;
                    scope.productionTrendsPageOffset = 0;
                } else {
                    totalWindows = Math.max(1, Math.ceil(monthly.length / yearWindow));
                    if (pageOffset > totalWindows - 1) pageOffset = totalWindows - 1;
                    scope.productionTrendsPageOffset = pageOffset;
                    var endY = monthly.length - (pageOffset * yearWindow);
                    var startY = Math.max(0, endY - yearWindow);
                    prepared = monthly.slice(startY, endY);
                }
            } else {
                var daily = data.slice().sort(function (a, b) {
                    var da = a && a.trend_date ? String(a.trend_date) : '';
                    var db = b && b.trend_date ? String(b.trend_date) : '';
                    return da.localeCompare(db);
                });
                var dayWindow = spanForRange('monthly', rangeKey);
                var dailySlice = [];
                if (dayWindow == null) {
                    dailySlice = daily.slice();
                    totalWindows = 1;
                    scope.productionTrendsPageOffset = 0;
                } else {
                    totalWindows = Math.max(1, Math.ceil(daily.length / dayWindow));
                    if (pageOffset > totalWindows - 1) pageOffset = totalWindows - 1;
                    scope.productionTrendsPageOffset = pageOffset;
                    var endD = daily.length - (pageOffset * dayWindow);
                    var startD = Math.max(0, endD - dayWindow);
                    dailySlice = daily.slice(startD, endD);
                }
                if (scope.productionTrendsHideWeekends) {
                    dailySlice = dailySlice.filter(function (r) {
                        var d = r && r.trend_date ? String(r.trend_date).split('T')[0] : '';
                        return d && !isWeekendIsoDate(d);
                    });
                }
                dailySlice.forEach(function (r) {
                    var d = r && r.trend_date ? String(r.trend_date).split('T')[0] : '';
                    if (!d) return;
                    var parts = d.split('-');
                    prepared.push({
                        label: parts.length === 3 ? (parts[2] + '/' + parts[1]) : d,
                        value: Number(r[key]) || 0
                    });
                });
            }

            const labels = prepared.map(function (p) { return p.label; });
            const values = prepared.map(function (p) { return p.value; });
            if (!labels.length) return;
            var rangeEl = document.getElementById('productionTrendsRange');
            if (rangeEl) rangeEl.textContent = 'Showing ' + labels[0] + ' - ' + labels[labels.length - 1];
            var prevBtn = document.getElementById('productionTrendsPrev');
            var nextBtn = document.getElementById('productionTrendsNext');
            if (prevBtn) prevBtn.disabled = (scope.productionTrendsPageOffset >= totalWindows - 1);
            if (nextBtn) nextBtn.disabled = (scope.productionTrendsPageOffset <= 0);
            var currentView = viewMode;
            var hideWeekendsToggle = document.getElementById('productionTrendsHideWeekends');
            if (hideWeekendsToggle) {
                hideWeekendsToggle.disabled = currentView === 'yearly';
                if (hideWeekendsToggle.parentElement) {
                    hideWeekendsToggle.parentElement.classList.toggle('opacity-50', currentView === 'yearly');
                }
            }
            document.querySelectorAll('.production-trends-range-btn').forEach(function (btn) {
                var key = (btn.getAttribute('data-range') || '').toUpperCase();
                var unsupportedInYearly = currentView === 'yearly' && (key === '1M' || key === '3M' || key === '6M');
                btn.disabled = unsupportedInYearly;
                var active = key === rangeKey;
                btn.classList.toggle('btn-primary', active && !unsupportedInYearly);
                btn.classList.toggle('btn-outline-secondary', !(active && !unsupportedInYearly));
            });
            if (scope.productionTrendsChart) {
                if (scope.productionTrendsChart.config.type !== chartType) {
                    scope.productionTrendsChart.destroy();
                    scope.productionTrendsChart = null;
                }
            }
            if (scope.productionTrendsChart) {
                scope.productionTrendsChart.data.labels = labels;
                scope.productionTrendsChart.data.datasets[0].label = datasetLabel;
                scope.productionTrendsChart.data.datasets[0].data = values;
                scope.productionTrendsChart.data.datasets[0].fill = (chartType === 'line');
                scope.productionTrendsChart.data.datasets[0].tension = chartType === 'line' ? 0.35 : 0;
                scope.productionTrendsChart.data.datasets[0].pointRadius = chartType === 'line' ? 3 : 0;
                scope.productionTrendsChart.update();
                return;
            }
            if (typeof Chart === 'undefined') return;
            var ctx = canvas.getContext('2d');
            scope.productionTrendsChart = new Chart(ctx, {
                type: chartType,
                data: {
                    labels: labels,
                    datasets: [{
                        label: datasetLabel,
                        data: values,
                        backgroundColor: 'rgba(13, 110, 253, 0.6)',
                        borderColor: 'rgba(13, 110, 253, 1)',
                        borderWidth: 1,
                        fill: chartType === 'line',
                        tension: chartType === 'line' ? 0.35 : 0,
                        pointRadius: chartType === 'line' ? 3 : 0
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

        procurementForecastChart: null,
        oilTrendsChart: null,
        stockAccuracyChart: null,
        dashboardTargets: [],

        loadProcurementForecastChart: async () => {
            const scope = _executiveDashboard;
            var canvas = document.getElementById('procurementForecastChart');
            if (!canvas || typeof Chart === 'undefined') return;
            if (!dataFunctions.getProcurementForecastByWeek) return;
            try {
                var results = await Promise.all([
                    dataFunctions.getProcurementForecastByWeek(12).catch(() => []),
                    dataFunctions.getKernelForecastByWeek(12).catch(() => [])
                ]);
                var procurement = results[0] || [];
                var forecastRows = results[1] || [];

                // Build a union of week labels.
                var procByWeek = {};
                procurement.forEach(function (r) { procByWeek[String(r.week_start)] = Number(r.predicted_weight_kg) || 0; });
                var demandByWeek = {};
                forecastRows.forEach(function (r) {
                    var k = String(r.week_start);
                    demandByWeek[k] = (demandByWeek[k] || 0) + (Number(r.quantity_cartons) || 0);
                });
                var weeks = Object.keys(procByWeek).concat(Object.keys(demandByWeek))
                    .filter(function (v, i, a) { return a.indexOf(v) === i; })
                    .sort();

                var emptyEl = document.getElementById('procurementForecastEmpty');
                if (weeks.length === 0) {
                    if (emptyEl) emptyEl.classList.remove('d-none');
                    return;
                }
                if (emptyEl) emptyEl.classList.add('d-none');

                var labels = weeks.map(function (w) { return String(w).slice(0, 10); });
                var procData = weeks.map(function (w) { return procByWeek[w] || 0; });
                var demandData = weeks.map(function (w) { return demandByWeek[w] || 0; });

                if (scope.procurementForecastChart) {
                    scope.procurementForecastChart.destroy();
                    scope.procurementForecastChart = null;
                }
                var ctx = canvas.getContext('2d');
                scope.procurementForecastChart = new Chart(ctx, {
                    data: {
                        labels: labels,
                        datasets: [
                            {
                                type: 'bar',
                                label: 'Scheduled intake (kg)',
                                data: procData,
                                backgroundColor: 'rgba(25, 135, 84, 0.6)',
                                borderColor: 'rgba(25, 135, 84, 1)',
                                borderWidth: 1,
                                yAxisID: 'yKg'
                            },
                            {
                                type: 'line',
                                label: 'Open demand (cartons)',
                                data: demandData,
                                borderColor: 'rgba(13, 110, 253, 1)',
                                backgroundColor: 'rgba(13, 110, 253, 0.2)',
                                tension: 0.35,
                                pointRadius: 3,
                                yAxisID: 'yCartons'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom' } },
                        scales: {
                            x: { ticks: { maxRotation: 45, minRotation: 0 } },
                            yKg: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'kg' } },
                            yCartons: { type: 'linear', position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, title: { display: true, text: 'cartons' } }
                        }
                    }
                });
            } catch (e) {
                console.warn('[Executive Dashboard] Procurement/forecast chart failed.', e.message);
            }
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
            $('#totalProduction').text(Number(scope.kpis.total_production_kg || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 }));
            var qEl = $('#qualityPassRate');
            if (qEl.length) qEl.text((scope.kpis.quality_pass_rate || '0') + '%');
        },

        loadExecutiveAlerts: async () => {
            var container = document.getElementById('execAlertsContainer');
            if (!container || !dataFunctions.getDashboardAlerts) return;
            try {
                var alerts = await dataFunctions.getDashboardAlerts(null, true);
                if (!alerts || !alerts.length) {
                    container.innerHTML = '<p class="text-muted small mb-0">No active alerts.</p>';
                    return;
                }
                var canResolve = typeof hasAction === 'function' ? hasAction('alerts.resolve') : true;
                container.innerHTML = alerts.slice(0, 8).map(function (a) {
                    var sev = (a.severity || a.alert_type || 'info').toLowerCase();
                    var cls = sev === 'critical' ? 'danger' : sev === 'warning' ? 'warning' : 'info';
                    var id = a.id || a.alert_id || '';
                    var resolveBtn = canResolve && id
                        ? ' <button type="button" class="btn btn-xs btn-sm btn-outline-dark ms-2 exec-resolve-alert-btn" data-alert-id="' + id + '" data-action-perm="alerts.resolve">Resolve</button>'
                        : '';
                    return '<div class="alert alert-' + cls + ' py-2 px-3 small mb-2 d-flex justify-content-between align-items-start">' +
                        '<span><strong>' + (a.title || a.alert_title || 'Alert') + '</strong> — ' + (a.message || a.alert_message || '') + '</span>' +
                        resolveBtn + '</div>';
                }).join('');
                container.querySelectorAll('.exec-resolve-alert-btn').forEach(function (btn) {
                    btn.addEventListener('click', async function () {
                        var alertId = btn.getAttribute('data-alert-id');
                        if (!alertId || !dataFunctions.resolveDashboardAlert) return;
                        var note = window.prompt('Optional note when resolving this alert:', '') || '';
                        try {
                            await dataFunctions.resolveDashboardAlert(alertId, note);
                            await _executiveDashboard.loadExecutiveAlerts();
                        } catch (e) {
                            console.warn('[Executive Dashboard] resolve alert failed', e);
                        }
                    });
                });
            } catch (e) {
                container.innerHTML = '<p class="text-muted small mb-0">Unable to load alerts.</p>';
            }
        },

        loadRunwaySummary: async () => {
            if (!dataFunctions.getKernelRunwaySummary) return;
            try {
                var r = await dataFunctions.getKernelRunwaySummary();
                var soh = Number(r.soh_kg || 0);
                var weeks = r.weeks_cover;
                var months = r.months_cover;
                $('#execRunwaySohKg').text(soh.toLocaleString('en-ZA', { maximumFractionDigits: 0 }));
                $('#execRunwayWeeks').text(weeks != null ? weeks + ' wks' : '—');
                $('#execRunwayMonths').text(months != null ? months + ' mo' : '—');
                $('#execRunwayDemand').text(Number(r.weekly_demand_kg || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 }) + ' kg/wk');
            } catch (e) {
                $('#execRunwaySohKg, #execRunwayWeeks, #execRunwayMonths, #execRunwayDemand').text('—');
            }
        },

        loadOilTrendsChart: async () => {
            var scope = _executiveDashboard;
            var canvas = document.getElementById('oilTrendsChart');
            if (!canvas || typeof Chart === 'undefined' || !dataFunctions.getOilProductionTrendsDaily) return;
            try {
                var rows = await dataFunctions.getOilProductionTrendsDaily(180);
                var labels = (rows || []).map(function (r) { return String(r.trend_date || '').slice(0, 10); });
                var litres = (rows || []).map(function (r) { return Number(r.oil_litres) || 0; });
                if (scope.oilTrendsChart) scope.oilTrendsChart.destroy();
                scope.oilTrendsChart = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: { labels: labels, datasets: [{ label: 'Oil (L)', data: litres, borderColor: '#198754', backgroundColor: 'rgba(25,135,84,0.2)', fill: true, tension: 0.3 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
                });
            } catch (e) {
                console.warn('[Executive Dashboard] oil trends failed', e);
            }
        },

        loadStockAccuracyChart: async () => {
            var scope = _executiveDashboard;
            var canvas = document.getElementById('stockAccuracyChart');
            if (!canvas || typeof Chart === 'undefined' || !dataFunctions.getStockAccuracy) return;
            try {
                var rows = await dataFunctions.getStockAccuracy(6);
                rows = (rows || []).slice().reverse();
                var labels = rows.map(function (r) { return String(r.snapshot_month || '').slice(0, 7); });
                var pct = rows.map(function (r) { return Number(r.pct_adjusted) || 0; });
                if (scope.stockAccuracyChart) scope.stockAccuracyChart.destroy();
                scope.stockAccuracyChart = new Chart(canvas.getContext('2d'), {
                    type: 'bar',
                    data: { labels: labels, datasets: [{ label: '% adjusted', data: pct, backgroundColor: 'rgba(255,193,7,0.7)' }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: '% of SOH adjusted' } } } }
                });
            } catch (e) {
                console.warn('[Executive Dashboard] stock accuracy failed', e);
            }
        },

        loadProducedVsTarget: async () => {
            if (!dataFunctions.getDashboardTargets) return;
            try {
                var res = await dataFunctions.getDashboardTargets();
                var rows = (res && res.rows) || [];
                var prodTarget = rows.find(function (t) { return t.metric_key === 'total_production_kg'; });
                var actual = Number(_executiveDashboard.kpis.total_production_kg) || 0;
                var target = prodTarget ? Number(prodTarget.target_value) : 0;
                var pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;
                $('#execProducedActual').text(actual.toLocaleString('en-ZA', { maximumFractionDigits: 0 }));
                $('#execProducedTarget').text(target > 0 ? target.toLocaleString('en-ZA', { maximumFractionDigits: 0 }) : '—');
                $('#execProducedProgress').css('width', pct + '%').attr('aria-valuenow', pct);
                $('#execProducedPct').text(target > 0 ? pct + '% of target' : 'Set target in Dashboard Targets');
            } catch (e) {
                $('#execProducedActual, #execProducedTarget, #execProducedPct').text('—');
            }
        },

        loadPhase2ExtendedKpis: async () => {
            if (!dataFunctions.getPhase2ExtendedKpis) return;
            // Derived percentages are only meaningful when their inputs are real.
            // With missing/partial inputs the DB can return nonsense (e.g. oil
            // yield of 100000% when only 6 kg of raw material is recorded) —
            // showing that erodes trust in the whole dashboard. Render '—' instead.
            var sanePct = function (v) {
                var n = Number(v);
                if (v == null || !isFinite(n) || n < 0 || n > 500) return null;
                return n;
            };
            try {
                var k = await dataFunctions.getPhase2ExtendedKpis();
                var rec = sanePct(k.sound_kernel_recovery_pct);
                var yieldPct = sanePct(k.oil_yield_pct);
                $('#execSoundRecoveryPct').text(rec != null ? rec + '%' : '—');
                $('#execOilYieldPct').text(yieldPct != null ? yieldPct + '%' : '—');
                $('#execSohKernel').text(Number(k.kernel_soh_kg || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 }));
                $('#execSohOil').text(Number(k.oil_finished_soh_kg || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 }));
                $('#execSohRm').text(Number(k.oil_rm_soh_kg || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 }));
                var delta = k.production_delta_pct;
                $('#execProductionDelta').text(delta != null ? (delta >= 0 ? '+' : '') + delta + '% vs last month' : '');
            } catch (e) {
                $('#execSoundRecoveryPct, #execOilYieldPct, #execSohKernel, #execSohOil, #execSohRm, #execProductionDelta').text('—');
            }
        },

        loadConsolidatedSummary: async () => {
            if (!dataFunctions.getConsolidatedBatchDashboardSummary) return;
            try {
                var s = await dataFunctions.getConsolidatedBatchDashboardSummary();
                $('#execConOpenCount').text(s.open_count != null ? s.open_count : '—');
                $('#execConOpenLitres').text(s.total_litres_open != null ? Number(s.total_litres_open).toFixed(1) : '—');
                $('#execConLabCount').text(s.with_lab_ref != null ? s.with_lab_ref : '—');
            } catch (e) {
                $('#execConOpenCount, #execConOpenLitres, #execConLabCount').text('—');
            }
        },

        loadOilForecastChart: async () => {
            var scope = _executiveDashboard;
            var canvas = document.getElementById('oilForecastChart');
            if (!canvas || typeof Chart === 'undefined' || !dataFunctions.getOilForecastByWeek) return;
            try {
                var rows = await dataFunctions.getOilForecastByWeek(12);
                var byWeek = {};
                (rows || []).forEach(function (r) {
                    var w = String(r.week_start || '').slice(0, 10);
                    byWeek[w] = (byWeek[w] || 0) + (Number(r.quantity_kg) || 0);
                });
                var weeks = Object.keys(byWeek).sort();
                var data = weeks.map(function (w) { return byWeek[w]; });
                if (scope.oilForecastChart) scope.oilForecastChart.destroy();
                scope.oilForecastChart = new Chart(canvas.getContext('2d'), {
                    type: 'bar',
                    data: { labels: weeks, datasets: [{ label: 'Forecast kg', data: data, backgroundColor: 'rgba(13,110,253,0.6)' }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
                });
            } catch (e) {
                console.warn('[Executive Dashboard] oil forecast chart failed', e);
            }
        }
    };
}();

window.initializeExecutiveDashboard = function () {
    if (typeof _executiveDashboard !== 'undefined' && _executiveDashboard.init) {
        _executiveDashboard.init();
    }
};
