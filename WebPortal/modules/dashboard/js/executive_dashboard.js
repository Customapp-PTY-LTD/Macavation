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

    // dashboard_targets.metric_key is free-text VARCHAR(100) with no vocabulary table or FK
    // (migrations/20260602110000_dashboard_targets.sql:8), so these two keys are a client-side
    // convention only — the same convention the NIS runway feature already uses for
    // nis_crack_rate_kg_per_day / nis_rate_basis_month (WebPortal/js/data-functions.js:2110-2117).
    // Nothing seeds them: a human must type the exact string into the Dashboard Targets admin
    // grid before a comparison appears here. Expected row shape is period_type 'monthly',
    // division 'all' — but match on metric_key only, because get_dashboard_targets() already
    // returns the latest effective row per metric_key/division/period_type and filtering further
    // would silently drop a validly-entered target.
    var TARGET_METRIC_KEYS = {
        soundKernelRecovery: 'sound_kernel_recovery_pct',
        oilYield: 'oil_yield_pct'
    };

    // Direction is per-metric, not a single global rule. Both metrics in this table are
    // higher-is-better, so a plain actual/target ratio is correct for both. This dashboard also
    // has a LOWER-is-better figure — the stock-accuracy "Monthly % of SOH adjusted"
    // (dashboard_unified.html ~:768) — which must NOT inherit this rule; it deliberately has no
    // target comparison implemented (out of scope, see plan notes).
    var TARGET_METRIC_DIRECTION = {
        sound_kernel_recovery_pct: 'higher-is-better',
        oil_yield_pct: 'higher-is-better'
    };

    // Shared lookup so more than one card can resolve a target row by metric_key.
    function findDashboardTarget(rows, metricKey) {
        return (rows || []).find(function (t) { return t.metric_key === metricKey; });
    }

    // Renders (or hides) the target/progress/caption block for one metric-comparison card.
    // No target row (or a non-positive/missing target) or no actual value => hide the block
    // entirely rather than showing a 0% target or a zero-width bar presented as a judgement.
    function renderMetricTargetComparison(rows, metricKey, actual, ids) {
        var block = document.getElementById(ids.block);
        if (!block) return;
        var row = findDashboardTarget(rows, metricKey);
        var target = row ? Number(row.target_value) : 0;
        if (!(target > 0) || actual == null) {
            block.classList.add('d-none');
            return;
        }
        var direction = TARGET_METRIC_DIRECTION[metricKey];
        // Only higher-is-better is implemented (both in-scope metrics use it); see comment above.
        var pct = direction === 'higher-is-better'
            ? Math.min(100, Math.round((actual / target) * 100))
            : 0;
        block.classList.remove('d-none');
        $('#' + ids.targetEl).text(target.toLocaleString('en-ZA', { maximumFractionDigits: 0 }));
        $('#' + ids.progressEl).css('width', pct + '%').attr('aria-valuenow', pct);
        $('#' + ids.captionEl).text(pct + '% of target');
    }

    // Failure/empty state for a metric-comparison block: same as "no target row".
    function clearMetricTargetComparison(ids) {
        var block = document.getElementById(ids.block);
        if (block) block.classList.add('d-none');
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
        execStockHistory: 'Stock on hand history',
        execRunwayForecast: 'Raw material runway forecast (NIS)',
        execStockAlerts: 'Stock alerts',
        execRunway: 'Finished stock cover (vs open orders)',
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
        stockHistoryChart: null,
        stockHistoryData: null,
        stockHistoryMode: 'kernel',
        stockHistoryRangeKey: '1Y',

        KERNEL_STYLE_COLORS: {
            'SP': '#2563eb',
            '0': '#dc2626',
            '1': '#16a34a',
            '1S': '#ca8a04',
            '4L': '#9333ea',
            '5': '#0891b2',
            '6': '#ea580c',
            '7/8': '#4f46e5',
            'Butter High Oil': '#be185d',
            'Butter Low Oil': '#0d9488'
        },
        OIL_STREAM_COLORS: {
            food_grade: '#198754',
            cosmetic: '#6f42c1',
            protein: '#fd7e14'
        },
        OIL_STREAM_LABELS: {
            food_grade: 'Food grade oil',
            cosmetic: 'Cosmetic oil',
            protein: 'Protein powder'
        },
        KERNEL_STYLE_ORDER: ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'],
        OIL_STREAM_ORDER: ['food_grade', 'cosmetic', 'protein'],


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
            await scope.loadStockHistoryChart();
            await scope.loadRunwayForecastChart();
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
                if (!Array.isArray(arr)) return null;
                // Retired widget keys map forward to their replacements. Without this, every user who
                // has ever saved a custom selection loses the replacement card permanently, because
                // new keys are in nobody's stored list and applyDashboardVisibility hides anything
                // that is not in it.
                var renamed = { execProcurementForecast: 'execRunwayForecast' };
                return arr.map(function (id) {
                    return Object.prototype.hasOwnProperty.call(renamed, id) ? renamed[id] : id;
                }).filter(function (id, i, a) { return a.indexOf(id) === i; });
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
                'execStatBatchesCompletedWeek', 'execStatBatchesInIntake', 'execDailyMinuteTests', 'execProductionTrends',
                'execRunwayForecast'];
            var oil = ['execStatOilLitresToday', 'execStatOilLitresWeek', 'execProductionTrends', 'totalProduction'];
            var qa = ['execStatBatchesAwaitingTest', 'execStatBatchesReleaseReady', 'execDailyMinuteTests', 'totalProduction'];
            var forecastSales = ['execRunwayForecast', 'totalProduction', 'execStatBatchesCompletedWeek', 'execProductionTrends'];

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
            $('.stock-history-mode-btn').off('click').on('click', function () {
                var mode = $(this).data('mode');
                if (!mode || mode === scope.stockHistoryMode) return;
                scope.stockHistoryMode = String(mode);
                $('.stock-history-mode-btn').removeClass('btn-primary').addClass('btn-outline-secondary');
                $(this).removeClass('btn-outline-secondary').addClass('btn-primary');
                scope.loadStockHistoryChart();
            });
            $('.runway-forecast-range-btn').off('click').on('click', function () {
                var r = $(this).data('range');
                scope.runwayForecastRangeKey = r ? String(r).toUpperCase() : '3M';
                $('.runway-forecast-range-btn').removeClass('btn-primary').addClass('btn-outline-secondary');
                $(this).removeClass('btn-outline-secondary').addClass('btn-primary');
                scope.loadRunwayForecastChart();
            });

            $('#runwayForecastSettingsBtn').off('click').on('click', function () {
                scope.openRunwayRateModal();
            });
            $('#runwayRateSaveBtn').off('click').on('click', function () {
                scope.saveRunwayRate();
            });
            $('#runwayRateClearBtn').off('click').on('click', function () {
                scope.clearRunwayRate();
            });

            $('.stock-history-range-btn').off('click').on('click', function () {
                var r = $(this).data('range');
                scope.stockHistoryRangeKey = r ? String(r).toUpperCase() : '1Y';
                $('.stock-history-range-btn').removeClass('btn-primary').addClass('btn-outline-secondary');
                $(this).removeClass('btn-outline-secondary').addClass('btn-primary');
                scope.loadStockHistoryChart();
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
                // Do NOT replace the wrapper's innerHTML here: that deletes the canvas, so every later
                // render silently no-ops. Use the empty state instead.
                console.error('Error loading production trends:', e);
                scope.productionTrendsData = [];
                scope.setChartEmptyState('productionTrendsChart', true);
            }
        },

        renderProductionTrendsChart: () => {
            const scope = _executiveDashboard;
            const data = scope.productionTrendsData || [];
            const canvas = document.getElementById('productionTrendsChart');
            if (!canvas) return;
            if (!data.length) {
                if (scope.productionTrendsChart) { scope.productionTrendsChart.destroy(); scope.productionTrendsChart = null; }
                scope.setChartEmptyState('productionTrendsChart', true);
                return;
            }
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
            var hasAny = values.some(function (v) { return Number(v) > 0; });
            if (!labels.length || !hasAny) {
                if (scope.productionTrendsChart) { scope.productionTrendsChart.destroy(); scope.productionTrendsChart = null; }
                var emptyMsg = document.getElementById('productionTrendsEmpty');
                if (emptyMsg) {
                    emptyMsg.textContent = labels.length
                        ? 'No ' + String(datasetLabel).toLowerCase() + ' recorded between ' +
                          labels[0] + ' and ' + labels[labels.length - 1] + '.'
                        : 'No data recorded for this metric in the selected period.';
                }
                var rangeElEmpty = document.getElementById('productionTrendsRange');
                if (rangeElEmpty) {
                    rangeElEmpty.textContent = labels.length
                        ? 'Showing ' + labels[0] + ' - ' + labels[labels.length - 1]
                        : '';
                }
                scope.setChartEmptyState('productionTrendsChart', true);
                return;
            }
            scope.setChartEmptyState('productionTrendsChart', false);
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

        stockHistoryDaysForRange: function (rangeKey) {
            var key = String(rangeKey || '1Y').toUpperCase();
            if (key === '1M') return 31;
            if (key === '3M') return 93;
            if (key === '6M') return 186;
            if (key === '1Y') return 366;
            return 1826;
        },

        loadStockHistoryChart: async () => {
            var scope = _executiveDashboard;
            var canvas = document.getElementById('stockHistoryChart');
            if (!canvas) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getStockSohHistory) return;
            var days = scope.stockHistoryDaysForRange(scope.stockHistoryRangeKey);
            try {
                var raw = await dataFunctions.getStockSohHistory(scope.stockHistoryMode, days);
                scope.stockHistoryData = Array.isArray(raw) ? raw : [];
                scope.renderStockHistoryChart();
            } catch (e) {
                console.error('Error loading stock history:', e);
                scope.stockHistoryData = [];
                scope.renderStockHistoryChart();
            }
        },

        renderStockHistoryChart: () => {
            var scope = _executiveDashboard;
            var data = scope.stockHistoryData || [];
            var canvas = document.getElementById('stockHistoryChart');
            var emptyEl = document.getElementById('stockHistoryEmpty');
            if (!canvas) return;

            var isOil = scope.stockHistoryMode === 'oil';
            var seriesOrder = isOil ? scope.OIL_STREAM_ORDER.slice() : scope.KERNEL_STYLE_ORDER.slice();
            var colorMap = isOil ? scope.OIL_STREAM_COLORS : scope.KERNEL_STYLE_COLORS;
            var labelMap = isOil ? scope.OIL_STREAM_LABELS : null;

            var byDate = {};
            data.forEach(function (r) {
                var d = r && r.d ? String(r.d).split('T')[0] : '';
                var series = r && r.series ? String(r.series) : '';
                if (!d || !series) return;
                if (!byDate[d]) byDate[d] = {};
                byDate[d][series] = Number(r.qty_kg) || 0;
            });

            var dates = Object.keys(byDate).sort();
            if (!dates.length) {
                if (scope.stockHistoryChart) {
                    scope.stockHistoryChart.destroy();
                    scope.stockHistoryChart = null;
                }
                if (emptyEl) emptyEl.classList.remove('d-none');
                var rangeElEmpty = document.getElementById('stockHistoryRange');
                if (rangeElEmpty) rangeElEmpty.textContent = '';
                return;
            }
            if (emptyEl) emptyEl.classList.add('d-none');

            var rangeKey = String(scope.stockHistoryRangeKey || '1Y').toUpperCase();
            var dayWindow = scope.stockHistoryDaysForRange(rangeKey);
            var slice = dates;
            if (rangeKey !== 'ALL' && dates.length > dayWindow) {
                slice = dates.slice(dates.length - dayWindow);
            }

            var labels = slice.map(function (d) {
                var parts = d.split('-');
                return parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0].slice(2)) : d;
            });

            var rangeEl = document.getElementById('stockHistoryRange');
            if (rangeEl && slice.length) {
                rangeEl.textContent = 'Showing ' + labels[0] + ' – ' + labels[labels.length - 1] +
                    ' · ' + (isOil ? 'Oil (kg)' : 'Kernel (kg)');
            }

            var activeSeries = seriesOrder.filter(function (s) {
                return slice.some(function (d) {
                    return byDate[d] && (Number(byDate[d][s]) || 0) > 0;
                });
            });
            if (!activeSeries.length) {
                activeSeries = seriesOrder.slice();
            }

            var datasets = activeSeries.map(function (series) {
                var color = colorMap[series] || '#6c757d';
                var label = labelMap && labelMap[series] ? labelMap[series] : series;
                return {
                    label: label,
                    data: slice.map(function (d) {
                        return byDate[d] && byDate[d][series] != null ? Number(byDate[d][series]) : 0;
                    }),
                    borderColor: color,
                    backgroundColor: color + '22',
                    borderWidth: 1.5,
                    fill: false,
                    tension: 0.25,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 8
                };
            });

            if (scope.stockHistoryChart) {
                scope.stockHistoryChart.destroy();
                scope.stockHistoryChart = null;
            }

            if (typeof Chart === 'undefined') return;
            scope.stockHistoryChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { labels: labels, datasets: datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { boxWidth: 12, padding: 14, usePointStyle: true }
                        },
                        tooltip: {
                            callbacks: {
                                label: function (item) {
                                    var val = item.raw || 0;
                                    return (item.dataset.label || '') + ': ' +
                                        val.toLocaleString('en-ZA', { maximumFractionDigits: 0 }) + ' kg';
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            ticks: { maxRotation: 45, minRotation: 0, maxTicksLimit: 12 },
                            grid: { color: 'rgba(0,0,0,0.06)' }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function (v) {
                                    return (v || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 });
                                }
                            },
                            grid: { color: 'rgba(0,0,0,0.06)' },
                            title: { display: true, text: 'kg on hand' }
                        }
                    }
                }
            });
        },

        oilTrendsChart: null,
        stockAccuracyChart: null,
        oilForecastChart: null,
        dashboardTargets: [],

        runwayForecastChart: null,
        runwayForecastData: null,
        runwayForecastRangeKey: '3M',
        RUNWAY_PX_PER_DAY: 12,
        runwayForecastSettings: null,
        runwayRatePreview: null,

        /**
         * Show/hide a chart's empty-state message and its canvas together.
         * An all-zero or row-less chart renders as a blank grid with a phantom
         * axis, which reads as "broken" rather than "nothing recorded yet" —
         * so hide the canvas outright and say so in words.
         * @param {string} chartId canvas element id (wrapper is `<chartId>Wrap`, message is `<chartId>Empty` minus the trailing 'Chart')
         * @param {boolean} isEmpty
         */
        setChartEmptyState: function (chartId, isEmpty) {
            var base = chartId.replace(/Chart$/, '');
            var wrap = document.getElementById(chartId + 'Wrap');
            var msg = document.getElementById(base + 'Empty');
            if (wrap) wrap.classList.toggle('d-none', !!isEmpty);
            if (msg) msg.classList.toggle('d-none', !isEmpty);
        },


        /**
         * Vertical reference lines on a category axis (Today, Run-out).
         *
         * Registered INLINE on the chart config (config.plugins), never via Chart.register, so it
         * cannot leak onto the dashboard's other charts. Do not reimplement with a scriptable
         * scales.x.grid.color: grid lines are emitted per surviving tick, and with maxTicksLimit set
         * over ~450 labels autoskip drops the today tick — the line would silently not draw.
         */
        runwayMarkerPlugin: {
            id: 'runwayMarkers',
            // Keep the pinned axis in step with the plot: same hook, same lifecycle.
            afterDraw: function (chart) {
                _executiveDashboard.drawRunwayAxisGutter(chart);
            },
            afterDatasetsDraw: function (chart, args, opts) {
                var markers = (opts && opts.markers) || [];
                if (!markers.length || !chart.scales || !chart.scales.x) return;
                var scale = chart.scales.x;
                var area = chart.chartArea;
                var ctx = chart.ctx;
                markers.forEach(function (m) {
                    if (m.index == null || m.index < 0) return;
                    var x = scale.getPixelForValue(m.index);
                    if (!isFinite(x) || x < area.left || x > area.right) return;
                    ctx.save();
                    ctx.beginPath();
                    ctx.setLineDash(m.dash || [4, 3]);
                    ctx.lineWidth = 1.5;
                    ctx.strokeStyle = m.color;
                    ctx.moveTo(x, area.top);
                    ctx.lineTo(x, area.bottom);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    if (m.label) {
                        ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
                        ctx.fillStyle = m.color;
                        var right = x > (area.left + area.right) / 2;
                        ctx.textAlign = right ? 'right' : 'left';
                        ctx.textBaseline = 'top';
                        ctx.fillText(m.label, x + (right ? -5 : 5), area.top + 2);
                    }
                    ctx.restore();
                });
            }
        },

        RUNWAY_AXIS_W: 88,

        /**
         * Paint the y axis into its own pinned canvas beside the scrolling plot.
         *
         * Why not a second Chart.js instance: two charts means two y scales that must be kept
         * identical, and the moment they drift the fixed axis silently mislabels the data. This reads
         * tick pixel positions straight off the live scale (yScale.getPixelForTick), so the gutter is
         * correct by construction. Both canvases share the same CSS height and are top-aligned, so
         * those coordinates map 1:1.
         *
         * Called from the marker plugin's afterDraw, so it repaints whenever the chart does.
         */
        drawRunwayAxisGutter: function (chart) {
            var scope = _executiveDashboard;
            var canvas = document.getElementById('runwayForecastAxis');
            if (!canvas || !chart || !chart.scales || !chart.scales.y || !chart.chartArea) return;
            var yScale = chart.scales.y;
            var w = scope.RUNWAY_AXIS_W;
            var h = chart.height;
            if (!h) return;

            var dpr = window.devicePixelRatio || 1;
            canvas.style.width = w + 'px';
            canvas.style.height = h + 'px';
            canvas.width = Math.round(w * dpr);
            canvas.height = Math.round(h * dpr);

            var ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, w, h);

            ctx.font = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
            ctx.fillStyle = '#666';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';

            (yScale.ticks || []).forEach(function (t, i) {
                var y = yScale.getPixelForTick(i);
                if (!isFinite(y)) return;
                ctx.fillText(scope.runwayKg(t.value), w - 8, y);
            });

            ctx.strokeStyle = 'rgba(0,0,0,0.12)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(w - 0.5, chart.chartArea.top);
            ctx.lineTo(w - 0.5, chart.chartArea.bottom);
            ctx.stroke();

            ctx.save();
            ctx.translate(12, (chart.chartArea.top + chart.chartArea.bottom) / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.fillStyle = '#666';
            ctx.font = '600 11px system-ui, -apple-system, "Segoe UI", sans-serif';
            ctx.fillText('kg NIS not yet cracked', 0, 0);
            ctx.restore();
        },

        clearRunwayAxisGutter: function () {
            var canvas = document.getElementById('runwayForecastAxis');
            if (!canvas) return;
            var ctx = canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        },

        /** History window per range key. Mirrors stockHistoryDaysForRange. */
        runwayDaysForRange: function (rangeKey) {
            var key = String(rangeKey || '3M').toUpperCase();
            if (key === '1M') return 31;
            if (key === '3M') return 93;
            if (key === '6M') return 186;
            if (key === '1Y') return 366;
            return 1826;
        },

        /** dd/mm/yy for the category axis. No Chart.js date adapter exists in this app. */
        runwayLabel: function (iso) {
            var parts = String(iso || '').split('T')[0].split('-');
            return parts.length === 3 ? (parts[2] + '/' + parts[1] + '/' + parts[0].slice(2)) : String(iso || '');
        },

        runwayKg: function (n) {
            return (Number(n) || 0).toLocaleString('en-ZA', { maximumFractionDigits: 0 });
        },

        loadRunwayForecastChart: async () => {
            var scope = _executiveDashboard;
            var canvas = document.getElementById('runwayForecastChart');
            if (!canvas) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getNisRunwayForecast) return;

            var opts = { historyDays: scope.runwayDaysForRange(scope.runwayForecastRangeKey) };
            // A preview lets someone see a rate before committing it for everyone.
            if (scope.runwayRatePreview) {
                if (scope.runwayRatePreview.kgPerDay) opts.kgPerDay = scope.runwayRatePreview.kgPerDay;
                if (scope.runwayRatePreview.basisMonth) opts.basisMonth = scope.runwayRatePreview.basisMonth;
            }

            try {
                var res = await dataFunctions.getNisRunwayForecast(opts);
                scope.runwayForecastData = res || { meta: {}, points: [] };
            } catch (e) {
                // The wrapper already swallows failures; this is belt and braces so a render bug
                // upstream can never take the whole dashboard boot down.
                console.warn('[Executive Dashboard] runway forecast failed', e);
                scope.runwayForecastData = { meta: {}, points: [] };
            }
            scope.renderRunwayForecastChart();

            // Open kernel demand is kept as a footer figure rather than a second Y axis — two units
            // in one frame is what made the old card unreadable.
            if (dataFunctions.getKernelForecastByWeek) {
                try {
                    var rows = await dataFunctions.getKernelForecastByWeek(12);
                    scope.renderRunwayOpenDemand(rows);
                } catch (e) { /* footer stat only, never blocks the chart */ }
            }
        },

        renderRunwayForecastChart: function () {
            var scope = _executiveDashboard;
            var canvas = document.getElementById('runwayForecastChart');
            if (!canvas) return;
            var data = scope.runwayForecastData || { meta: {}, points: [] };
            var points = Array.isArray(data.points) ? data.points : [];
            var meta = data.meta || {};

            if (scope.runwayForecastChart) {
                scope.runwayForecastChart.destroy();
                scope.runwayForecastChart = null;
            }

            if (!points.length) {
                scope.setChartEmptyState('runwayForecastChart', true);
                scope.clearRunwayAxisGutter();
                scope.renderRunwayVerdict(null, meta);
                scope.renderRunwayWarnings(meta);
                return;
            }
            scope.setChartEmptyState('runwayForecastChart', false);

            var labels = points.map(function (p) { return scope.runwayLabel(p.d); });
            var todayIndex = -1;
            for (var i = points.length - 1; i >= 0; i--) {
                if (!points[i].is_forecast) { todayIndex = i; break; }
            }
            if (todayIndex < 0) todayIndex = 0;

            // Two datasets over one labels array, null-padded. The boundary value is duplicated at
            // todayIndex in BOTH so the solid and dashed lines join without a one-segment hole; the
            // duplicate tooltip row is removed by the filter below.
            var actual = points.map(function (p, idx) {
                return idx <= todayIndex ? (Number(p.qty_kg) || 0) : null;
            });
            var forecast = points.map(function (p, idx) {
                return idx >= todayIndex ? (Number(p.qty_kg) || 0) : null;
            });
            var hasForecast = points.some(function (p) { return p.is_forecast; });

            var runOutIndex = -1;
            for (var j = todayIndex; j < points.length; j++) {
                if ((Number(points[j].qty_kg) || 0) <= 0) { runOutIndex = j; break; }
            }

            var markers = [{ index: todayIndex, color: '#6c757d', label: 'Today', dash: [4, 3] }];
            if (runOutIndex >= 0) {
                markers.push({ index: runOutIndex, color: '#dc3545', label: 'Run-out', dash: [4, 3] });
            }

            var datasets = [{
                label: 'Uncracked NIS on hand',
                data: actual,
                borderColor: '#2563eb',
                backgroundColor: '#2563eb22',
                borderWidth: 1.8,
                fill: false,
                tension: 0,
                spanGaps: false,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHitRadius: 8
            }];
            if (hasForecast) {
                datasets.push({
                    label: 'Projected',
                    data: forecast,
                    borderColor: '#dc3545',
                    backgroundColor: 'transparent',
                    borderWidth: 1.8,
                    borderDash: [6, 4],
                    fill: false,
                    tension: 0,
                    spanGaps: false,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHitRadius: 8
                });
            }

            var rangeEl = document.getElementById('runwayForecastRange');
            if (rangeEl) {
                rangeEl.textContent = 'Showing ' + labels[0] + ' – ' + labels[labels.length - 1] +
                    ' · kg nut-in-shell not yet in production' +
                    (labels.length > 120 ? ' · scroll sideways for the rest' : '');
            }

            // Widen the canvas to a fixed px-per-day and let the wrapper scroll, rather than squeezing
            // a year of daily points into the card width. Chart.js is responsive, so it sizes itself
            // to this explicit width.
            var scrollEl = document.getElementById('runwayForecastScroll');
            var wrapEl = document.getElementById('runwayForecastChartWrap');
            var viewW = scrollEl ? scrollEl.clientWidth : 0;
            var chartW = Math.max(viewW, labels.length * scope.RUNWAY_PX_PER_DAY);
            if (wrapEl) wrapEl.style.width = chartW + 'px';

            if (typeof Chart === 'undefined') return;
            scope.runwayForecastChart = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { labels: labels, datasets: datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 14, usePointStyle: true } },
                        runwayMarkers: { markers: markers },
                        tooltip: {
                            // The boundary value is duplicated at todayIndex so the solid and dashed
                            // lines join; filter (not a null-returning label callback, which renders
                            // literally) drops the duplicate row.
                            filter: function (item) {
                                return !(item.dataIndex === todayIndex && item.datasetIndex === 1);
                            },
                            callbacks: {
                                label: function (item) {
                                    return (item.dataset.label || '') + ': ' + scope.runwayKg(item.raw) + ' kg';
                                },
                                afterBody: function (items) {
                                    if (!items || !items.length) return '';
                                    var p = points[items[0].dataIndex];
                                    if (!p) return '';
                                    var extra = [];
                                    if ((Number(p.intake_kg) || 0) > 0) extra.push('Intake +' + scope.runwayKg(p.intake_kg) + ' kg');
                                    if ((Number(p.cracked_kg) || 0) > 0) extra.push('Cracked −' + scope.runwayKg(p.cracked_kg) + ' kg');
                                    // Reconciliation cliffs are a real artefact of batches leaving the
                                    // pool with unrecorded consumption — explain them rather than hide them.
                                    if (Math.abs(Number(p.reconciled_kg) || 0) > 0.005) {
                                        extra.push('Includes ' + scope.runwayKg(p.reconciled_kg) + ' kg reconciled at batch completion');
                                    }
                                    return extra;
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            // Scale tick count to the widened canvas: a fixed cap of 12 would leave a
                            // 3000px chart almost unlabelled.
                            ticks: {
                                maxRotation: 45,
                                minRotation: 0,
                                maxTicksLimit: Math.max(8, Math.floor(chartW / 85))
                            },
                            grid: { color: 'rgba(0,0,0,0.06)' }
                        },
                        y: {
                            beginAtZero: true,
                            // Gridlines stay; labels, title and border move to the pinned gutter canvas
                            // so they cannot scroll out of view. The scale itself must stay enabled or
                            // there are no ticks for the gutter to read.
                            ticks: { display: false },
                            title: { display: false },
                            border: { display: false },
                            grid: { color: 'rgba(0,0,0,0.06)' }
                        }
                    }
                },
                plugins: [scope.runwayMarkerPlugin]
            });

            // Land the view on the forecast rather than the far-left history edge: the projection is
            // the point of the card.
            if (scrollEl && chartW > viewW && labels.length > 1) {
                var todayX = (todayIndex / (labels.length - 1)) * chartW;
                scrollEl.scrollLeft = Math.max(0, Math.round(todayX - viewW * 0.35));
            }

            scope.renderRunwayVerdict({ points: points, todayIndex: todayIndex, runOutIndex: runOutIndex }, meta);
            scope.renderRunwayWarnings(meta);
        },

        /**
         * The run-out verdict is derived by walking the same points that draw the line, never read
         * from meta.run_out_date, so the sentence cannot contradict the plot.
         */
        renderRunwayVerdict: function (v, meta) {
            var scope = _executiveDashboard;
            var vEl = document.getElementById('runwayForecastVerdict');
            var aEl = document.getElementById('runwayForecastAssumptions');
            if (!vEl) return;
            meta = meta || {};

            var pill = function (tone, text) {
                if (typeof MacStatus !== 'undefined' && MacStatus.pill) return MacStatus.pill(tone, text);
                return '<strong>' + text + '</strong>';
            };

            if (!v || !v.points || !v.points.length) {
                vEl.innerHTML = pill('none', 'No runway data');
                if (aEl) aEl.textContent = '';
                return;
            }

            var onHand = Number(v.points[v.todayIndex] && v.points[v.todayIndex].qty_kg) || 0;
            var rate = Number(meta.kg_per_day) || 0;
            var source = String(meta.kg_per_day_source || 'none');

            if (source === 'none' || rate <= 0) {
                // Designed first-run state: show the stock, refuse to invent a run-out date.
                vEl.innerHTML = pill('open', scope.runwayKg(onHand) + ' kg on hand') +
                    ' <span class="ms-2">No depletion rate set, so no run-out is projected.</span>' +
                    ' <button type="button" class="btn btn-sm btn-link p-0 align-baseline" id="runwayForecastPickRateBtn">Choose a month to base it on</button>';
                if (aEl) aEl.textContent = '';
                var pick = document.getElementById('runwayForecastPickRateBtn');
                if (pick) pick.addEventListener('click', function () { scope.openRunwayRateModal(); });
                return;
            }

            if (onHand <= 0) {
                vEl.innerHTML = pill('critical', 'No raw material on hand');
            } else if (v.runOutIndex >= 0) {
                var d = v.points[v.runOutIndex].d;
                var days = v.runOutIndex - v.todayIndex;
                var tone = days <= 14 ? 'critical' : (days <= 45 ? 'due' : 'ok');
                var extra = '';
                // run_out is when the plant first goes dry; final_depletion is when the last booked
                // delivery has also been eaten. They differ whenever procurement lands after run-out,
                // and the difference is the part people actually plan around.
                if (meta.final_depletion_date && meta.final_depletion_date !== meta.run_out_date) {
                    extra = ' · scheduled nut lasts to ' + scope.runwayLabel(meta.final_depletion_date);
                    if ((Number(meta.idle_days_in_forecast) || 0) > 0) {
                        extra += ' with ' + meta.idle_days_in_forecast + ' idle day(s)';
                    }
                }
                vEl.innerHTML = pill(tone, 'Predicted run-out ' + scope.runwayLabel(d)) +
                    ' <span class="ms-2">' + days + ' days · ' + scope.runwayKg(onHand) + ' kg on hand' +
                    extra + '</span>';
            } else if (meta.forecast_truncated) {
                vEl.innerHTML = pill('ok', 'No run-out within the forecast horizon') +
                    ' <span class="ms-2">' + scope.runwayKg(onHand) + ' kg on hand</span>';
            } else {
                vEl.innerHTML = pill('open', scope.runwayKg(onHand) + ' kg on hand');
            }

            if (aEl) {
                var basis = meta.rate_basis_label
                    ? 'from ' + meta.rate_basis_label
                    : (source === 'override' || source === 'parameter' ? 'entered manually' : '');
                var bits = ['Consuming ' + scope.runwayKg(rate) + ' kg/day' + (basis ? ' (' + basis + ')' : '')];
                if ((Number(meta.scheduled_procurement_future_kg) || 0) > 0) {
                    bits.push(scope.runwayKg(meta.scheduled_procurement_future_kg) + ' kg scheduled intake included');
                }
                aEl.textContent = bits.join(' · ');
            }
        },

        /**
         * Data-quality and assumption warnings, as sentences. The cracking capture behind this
         * forecast is known to be unreliable, so the card says so rather than implying precision.
         */
        renderRunwayWarnings: function (meta) {
            var scope = _executiveDashboard;
            var el = document.getElementById('runwayForecastWarnings');
            if (!el) return;
            var warns = (meta && Array.isArray(meta.warnings)) ? meta.warnings : [];
            var msgs = [];

            warns.forEach(function (w) {
                var key = String(w).split(':')[0];
                if (key === 'procurement_calendar_empty') {
                    msgs.push('No scheduled grower intake is captured, so this runway assumes no further deliveries.');
                } else if (key === 'procurement_overdue') {
                    msgs.push('Some scheduled deliveries are past due and are excluded — they have not been rolled forward.');
                } else if (key === 'sparse_cracking_capture') {
                    var tot = Number(meta.cracking_rows_total) || 0;
                    var wk = Number(meta.cracking_rows_with_kg) || 0;
                    msgs.push('Only ' + wk + ' of ' + tot + ' recorded cracking days carry a tonnage, so the rate is indicative.');
                } else if (key === 'recorded_feed_exceeds_intake') {
                    msgs.push('On ' + (Number(meta.batches_over_cracked) || 0) + ' batches the recorded feed exceeds the nut received (' +
                        scope.runwayKg(meta.over_cracked_excess_kg) + ' kg excess) — cracking capture needs review.');
                } else if (key === 'history_has_negative_days') {
                    msgs.push('History includes ' + (Number(meta.history_has_negative_days) || 0) +
                        ' day(s) that computed below zero, which points at a data-entry error.');
                } else if (key === 'forecast_includes_idle_days') {
                    msgs.push('The projection includes ' + (Number(meta.idle_days_in_forecast) || 0) +
                        ' day(s) with no nut to crack, waiting on the next scheduled delivery.');
                } else if (key === 'forecast_truncated_at_max_days') {
                    msgs.push('Scheduled intake covers consumption for the whole horizon, so no run-out date is reached.');
                } else if (key === 'rate_source_rejected') {
                    msgs.push('A saved depletion rate was unusable and was ignored — set it again.');
                }
            });

            if (!msgs.length) { el.innerHTML = ''; return; }
            el.innerHTML = '<i class="fas fa-triangle-exclamation me-1"></i>' +
                msgs.map(function (m) { return '<span>' + m + '</span>'; }).join('<br>');
        },

        renderRunwayOpenDemand: function (rows) {
            var scope = _executiveDashboard;
            var el = document.getElementById('runwayForecastOpenDemand');
            if (!el) return;
            var cartons = (rows || []).reduce(function (a, r) { return a + (Number(r.quantity_cartons) || 0); }, 0);
            el.textContent = cartons > 0
                ? 'Open kernel demand behind this depletion: ' + scope.runwayKg(cartons) + ' cartons over the next 12 weeks.'
                : 'No open kernel demand booked in the next 12 weeks.';
        },

        // ---------------------------------------------------------------- depletion rate modal

        openRunwayRateModal: function () {
            var scope = _executiveDashboard;
            var meta = (scope.runwayForecastData && scope.runwayForecastData.meta) || {};
            scope.renderRunwayRateMonths(meta);

            var manual = document.getElementById('runwayRateManualInput');
            if (manual) {
                manual.value = (String(meta.kg_per_day_source) === 'override' && !meta.rate_basis_label)
                    ? (Number(meta.kg_per_day) || '') : '';
            }
            var prov = document.getElementById('runwayRateProvenance');
            if (prov) {
                prov.textContent = meta.rate_basis_label
                    ? 'Currently based on ' + meta.rate_basis_label
                    : ((Number(meta.kg_per_day) || 0) > 0 ? 'Currently ' + scope.runwayKg(meta.kg_per_day) + ' kg/day, entered manually' : 'No rate set');
            }
            var notice = document.getElementById('runwayRateNotice');
            if (notice) { notice.classList.add('d-none'); notice.textContent = ''; }

            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(document.getElementById('runwayRateModal')).show();
            }
        },

        renderRunwayRateMonths: function (meta) {
            var scope = _executiveDashboard;
            var tbody = document.getElementById('runwayRateMonthRows');
            if (!tbody) return;
            var months = (meta && Array.isArray(meta.months)) ? meta.months.slice() : [];
            months.reverse(); // newest first

            if (!months.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-muted small">No cracking data recorded yet, so no month can be used as a basis.</td></tr>';
                return;
            }

            var selected = Number(meta.rate_basis_month) || 0;
            tbody.innerHTML = months.map(function (m) {
                var usable = (Number(m.total_kg) || 0) > 0;
                var pct = Number(m.capture_pct) || 0;
                // Capture rate is the whole point of this table: it is the only thing that separates a
                // trustworthy month from one that will badly understate consumption.
                var tone = pct >= 50 ? 'text-success' : (pct >= 25 ? 'text-warning' : 'text-danger');
                var radio = usable
                    ? '<input class="form-check-input runway-rate-month" type="radio" name="runwayRateMonth" value="' + m.yyyymm + '"' +
                      (selected === Number(m.yyyymm) ? ' checked' : '') + ' aria-label="Use ' + m.label + '">'
                    : '';
                return '<tr' + (usable ? '' : ' class="text-muted"') + '>' +
                    '<td>' + radio + '</td>' +
                    '<td>' + m.label + '</td>' +
                    '<td class="text-end">' + (usable ? scope.runwayKg(m.total_kg) + ' kg' : '—') + '</td>' +
                    '<td class="text-end">' + (usable ? '<strong>' + scope.runwayKg(m.kg_per_day) + '</strong>' : '—') + '</td>' +
                    '<td class="' + (usable ? tone : '') + ' small">' +
                        (usable ? (m.day_rows_with_kg + ' of ' + m.day_rows + ' days (' + pct + '%)')
                                : 'no tonnage captured') +
                    '</td>' +
                '</tr>';
            }).join('');

            tbody.querySelectorAll('.runway-rate-month').forEach(function (el) {
                el.addEventListener('change', function () {
                    var manual = document.getElementById('runwayRateManualInput');
                    if (manual) manual.value = '';
                });
            });
        },

        saveRunwayRate: async function () {
            var scope = _executiveDashboard;
            var notice = document.getElementById('runwayRateNotice');
            var showNotice = function (msg) {
                if (!notice) return;
                notice.textContent = msg;
                notice.classList.remove('d-none');
            };
            if (!dataFunctions.saveNisRunwaySetting) return;

            var manualEl = document.getElementById('runwayRateManualInput');
            var manual = manualEl ? parseFloat(manualEl.value) : NaN;
            var checked = document.querySelector('.runway-rate-month:checked');
            var month = checked ? parseInt(checked.value, 10) : 0;

            if (manualEl && String(manualEl.value).trim() !== '') {
                if (!isFinite(manual) || manual <= 0 || manual > 200000) {
                    showNotice('Enter a kg-per-day figure between 1 and 200,000, or pick a month instead.');
                    return;
                }
            } else if (!month) {
                showNotice('Pick a month to base the rate on, or enter a kg-per-day figure.');
                return;
            }

            try {
                if (isFinite(manual) && manual > 0) {
                    await dataFunctions.saveNisRunwaySetting('nis_crack_rate_kg_per_day', manual, 'Entered manually from the runway forecast card');
                    await dataFunctions.saveNisRunwaySetting('nis_rate_basis_month', 0, 'Cleared: a manual kg/day rate was set');
                } else {
                    await dataFunctions.saveNisRunwaySetting('nis_rate_basis_month', month, 'Depletion rate based on this month, chosen from the runway forecast card');
                    await dataFunctions.saveNisRunwaySetting('nis_crack_rate_kg_per_day', 0, 'Cleared: rate now derives from a basis month');
                }
                scope.runwayRatePreview = null;
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getOrCreateInstance(document.getElementById('runwayRateModal')).hide();
                }
                await scope.loadRunwayForecastChart();
            } catch (e) {
                // Writes are RBAC-gated server-side by upsert_dashboard_target, which is why the
                // button is not client-gated — surface the refusal instead of hiding the control.
                showNotice('Could not save: ' + (e && e.message ? e.message : 'permission denied.'));
            }
        },

        clearRunwayRate: async function () {
            var scope = _executiveDashboard;
            if (!dataFunctions.saveNisRunwaySetting) return;
            try {
                await dataFunctions.saveNisRunwaySetting('nis_crack_rate_kg_per_day', 0, 'Rate cleared from the runway forecast card');
                await dataFunctions.saveNisRunwaySetting('nis_rate_basis_month', 0, 'Rate cleared from the runway forecast card');
                scope.runwayRatePreview = null;
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getOrCreateInstance(document.getElementById('runwayRateModal')).hide();
                }
                await scope.loadRunwayForecastChart();
            } catch (e) {
                var notice = document.getElementById('runwayRateNotice');
                if (notice) {
                    notice.textContent = 'Could not clear: ' + (e && e.message ? e.message : 'permission denied.');
                    notice.classList.remove('d-none');
                }
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
                if (scope.oilTrendsChart) { scope.oilTrendsChart.destroy(); scope.oilTrendsChart = null; }
                // The RPC back-fills every day in the window, so "no production"
                // arrives as a full series of zeros, not an empty array.
                if (!litres.length || !litres.some(function (v) { return v > 0; })) {
                    scope.setChartEmptyState('oilTrendsChart', true);
                    return;
                }
                scope.setChartEmptyState('oilTrendsChart', false);
                scope.oilTrendsChart = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: { labels: labels, datasets: [{ label: 'Oil (L)', data: litres, borderColor: '#198754', backgroundColor: 'rgba(25,135,84,0.2)', fill: true, tension: 0.3 }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
                });
            } catch (e) {
                console.warn('[Executive Dashboard] oil trends failed', e);
                scope.setChartEmptyState('oilTrendsChart', true);
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
                if (scope.stockAccuracyChart) { scope.stockAccuracyChart.destroy(); scope.stockAccuracyChart = null; }
                if (!pct.length) {
                    scope.setChartEmptyState('stockAccuracyChart', true);
                    return;
                }
                scope.setChartEmptyState('stockAccuracyChart', false);
                scope.stockAccuracyChart = new Chart(canvas.getContext('2d'), {
                    type: 'bar',
                    data: { labels: labels, datasets: [{ label: '% adjusted', data: pct, backgroundColor: 'rgba(255,193,7,0.7)' }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: '% of SOH adjusted' } } } }
                });
            } catch (e) {
                console.warn('[Executive Dashboard] stock accuracy failed', e);
                scope.setChartEmptyState('stockAccuracyChart', true);
            }
        },

        loadProducedVsTarget: async () => {
            if (!dataFunctions.getDashboardTargets) return;
            try {
                var res = await dataFunctions.getDashboardTargets();
                var rows = (res && res.rows) || [];
                var prodTarget = findDashboardTarget(rows, 'total_production_kg');
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
            var recoveryTargetIds = {
                block: 'execSoundRecoveryTargetBlock',
                targetEl: 'execSoundRecoveryTarget',
                progressEl: 'execSoundRecoveryProgress',
                captionEl: 'execSoundRecoveryTargetPct'
            };
            var oilYieldTargetIds = {
                block: 'execOilYieldTargetBlock',
                targetEl: 'execOilYieldTarget',
                progressEl: 'execOilYieldProgress',
                captionEl: 'execOilYieldTargetPct'
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

                // #totalProduction is an ALL-TIME figure (get_executive_kpis().total_production_kg,
                // no date filter — migrations/20260329000001_active_batches_intake_and_production_only.sql:27-43,
                // 20260328000002_executive_kpis_total_production_kg.sql:1). production_delta_pct is
                // this-calendar-month-vs-last-month, so it belongs beside production_kg_this_month,
                // never beside the all-time total and never beside Sound kernel recovery (a ratio
                // this delta does not describe) — migrations/20260708160000_fix_oil_recovery_kpi_calculations.sql:91-114.
                var prodThisMonthNum = Number(k.production_kg_this_month);
                var hasThisMonth = k.production_kg_this_month != null && isFinite(prodThisMonthNum);
                $('#execProductionThisMonth').text(hasThisMonth ? prodThisMonthNum.toLocaleString('en-ZA', { maximumFractionDigits: 0 }) : '—');
                var delta = k.production_delta_pct;
                $('#execProductionDelta').text(hasThisMonth && delta != null ? (delta >= 0 ? '+' : '') + delta + '% vs last month' : '');

                // Target comparisons for the two single-number cards that have one. The payload
                // carries no recovery delta (get_phase2_extended_kpis does not return one), so no
                // month-over-month figure is computed client-side for that card.
                var targetsRes = await dataFunctions.getDashboardTargets();
                var targetRows = (targetsRes && targetsRes.rows) || [];
                renderMetricTargetComparison(targetRows, TARGET_METRIC_KEYS.soundKernelRecovery, rec, recoveryTargetIds);
                renderMetricTargetComparison(targetRows, TARGET_METRIC_KEYS.oilYield, yieldPct, oilYieldTargetIds);
            } catch (e) {
                $('#execSoundRecoveryPct, #execOilYieldPct, #execSohKernel, #execSohOil, #execSohRm, #execProductionDelta, #execProductionThisMonth').text('—');
                clearMetricTargetComparison(recoveryTargetIds);
                clearMetricTargetComparison(oilYieldTargetIds);
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
                if (scope.oilForecastChart) { scope.oilForecastChart.destroy(); scope.oilForecastChart = null; }
                if (!weeks.length) {
                    scope.setChartEmptyState('oilForecastChart', true);
                    return;
                }
                scope.setChartEmptyState('oilForecastChart', false);
                scope.oilForecastChart = new Chart(canvas.getContext('2d'), {
                    type: 'bar',
                    data: { labels: weeks, datasets: [{ label: 'Forecast kg', data: data, backgroundColor: 'rgba(13,110,253,0.6)' }] },
                    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
                });
            } catch (e) {
                console.warn('[Executive Dashboard] oil forecast chart failed', e);
                scope.setChartEmptyState('oilForecastChart', true);
            }
        }
    };
}();

window.initializeExecutiveDashboard = function () {
    if (typeof _executiveDashboard !== 'undefined' && _executiveDashboard.init) {
        _executiveDashboard.init();
    }
};
