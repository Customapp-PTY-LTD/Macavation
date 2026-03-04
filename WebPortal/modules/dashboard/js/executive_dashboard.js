/**
 * Executive Dashboard Module
 * Loaded by dashboard router when user role maps to executive dashboard.
 */
var _executiveDashboard = function () {
    'use strict';

    var DASHBOARD_VISIBILITY_KEY = 'executive_dashboard_visible_widgets';
    var DASHBOARD_WIDGET_LABELS = {
        totalProduction: 'Total Production (kg)',
        activeBatches: 'Active Batches',
        totalSales: 'Total Sales (ZAR)',
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
        execStatDispatchPending: 'Dispatch pending'
    };

    return {
        kpis: {},

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
