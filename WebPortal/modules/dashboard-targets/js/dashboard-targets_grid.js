/**
 * Dashboard Targets admin grid.
 * Lists configurable KPI targets and lets managers add/edit/delete them.
 * Backed by get_dashboard_targets / upsert_dashboard_target / delete_dashboard_target.
 */
var _dashboardTargetsGrid = function () {
    'use strict';

    var PERIODS = ['daily', 'weekly', 'monthly', 'annual'];
    var DIVISIONS = ['all', 'kernel', 'oil'];

    return {
        rows: [],

        init: async () => {
            const scope = _dashboardTargetsGrid;
            await new Promise(function (resolve) { $(document).ready(resolve); });
            scope.bindEvents();
            await scope.load();
        },

        bindEvents: () => {
            const scope = _dashboardTargetsGrid;
            $('#refreshTargetsBtn').off('click').on('click', function () { scope.load(); });
            $('#addTargetBtn').off('click').on('click', function () { scope.addRow(); });
            $(document).off('click', '.js-save-target').on('click', '.js-save-target', function () {
                scope.saveRow($(this).closest('tr'));
            });
            $(document).off('click', '.js-delete-target').on('click', '.js-delete-target', function () {
                scope.deleteRow($(this).closest('tr'));
            });
        },

        load: async () => {
            const scope = _dashboardTargetsGrid;
            var tbody = document.getElementById('targetsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading targets...</td></tr>';
            try {
                var res = await dataFunctions.getDashboardTargets();
                scope.rows = (res && res.rows) || [];
                scope.render();
            } catch (e) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-danger text-center py-4">Error loading targets: ' + scope.escapeHtml(e.message || '') + '</td></tr>';
            }
        },

        render: () => {
            const scope = _dashboardTargetsGrid;
            var tbody = document.getElementById('targetsTableBody');
            if (!tbody) return;
            if (scope.rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No targets yet. Use Add Target.</td></tr>';
                return;
            }
            tbody.innerHTML = scope.rows.map(function (t) { return scope.rowHtml(t); }).join('');
        },

        rowHtml: (t) => {
            const scope = _dashboardTargetsGrid;
            var id = t && t.id != null ? t.id : '';
            var metric = scope.escapeHtml(t && t.metric_key != null ? t.metric_key : '');
            var value = t && t.target_value != null ? t.target_value : 0;
            var period = t && t.period_type ? t.period_type : 'monthly';
            var division = t && t.division ? t.division : 'all';
            var eff = t && t.effective_from ? String(t.effective_from).slice(0, 10) : '';
            var notes = scope.escapeHtml(t && t.notes != null ? t.notes : '');
            function opts(list, sel) {
                return list.map(function (o) {
                    return '<option value="' + o + '"' + (o === sel ? ' selected' : '') + '>' + o + '</option>';
                }).join('');
            }
            return '<tr data-target-id="' + id + '">' +
                '<td><input type="text" class="form-control form-control-sm t-metric" value="' + metric + '" placeholder="e.g. total_production_kg"></td>' +
                '<td><select class="form-select form-select-sm t-division">' + opts(DIVISIONS, division) + '</select></td>' +
                '<td><select class="form-select form-select-sm t-period">' + opts(PERIODS, period) + '</select></td>' +
                '<td><input type="number" step="any" class="form-control form-control-sm t-value" value="' + value + '"></td>' +
                '<td><input type="date" class="form-control form-control-sm t-eff" value="' + eff + '"></td>' +
                '<td><input type="text" class="form-control form-control-sm t-notes" value="' + notes + '"></td>' +
                '<td class="text-end">' +
                '<button type="button" class="btn btn-sm btn-primary js-save-target" title="Save"><i class="fas fa-save"></i></button> ' +
                '<button type="button" class="btn btn-sm btn-outline-danger js-delete-target" title="Delete"><i class="fas fa-trash"></i></button>' +
                '</td></tr>';
        },

        addRow: () => {
            const scope = _dashboardTargetsGrid;
            var tbody = document.getElementById('targetsTableBody');
            if (!tbody) return;
            if (scope.rows.length === 0) tbody.innerHTML = '';
            $(tbody).append(scope.rowHtml({ id: '', metric_key: '', target_value: 0, period_type: 'monthly', division: 'all', effective_from: '', notes: '' }));
        },

        saveRow: async ($tr) => {
            const scope = _dashboardTargetsGrid;
            var id = $tr.data('target-id');
            var payload = {
                id: id !== '' && id != null ? id : null,
                metric_key: ($tr.find('.t-metric').val() || '').trim(),
                target_value: parseFloat($tr.find('.t-value').val()) || 0,
                period_type: $tr.find('.t-period').val(),
                division: $tr.find('.t-division').val(),
                effective_from: $tr.find('.t-eff').val() || null,
                notes: ($tr.find('.t-notes').val() || '').trim() || null
            };
            if (!payload.metric_key) {
                scope.toast('Metric key is required.', 'error');
                return;
            }
            try {
                await dataFunctions.upsertDashboardTarget(payload);
                scope.toast('Target saved.', 'success');
                await scope.load();
            } catch (e) {
                scope.toast('Error saving target: ' + (e.message || ''), 'error');
            }
        },

        deleteRow: async ($tr) => {
            const scope = _dashboardTargetsGrid;
            var id = $tr.data('target-id');
            if (!id) { $tr.remove(); return; }
            try {
                await dataFunctions.deleteDashboardTarget(id);
                scope.toast('Target deleted.', 'success');
                await scope.load();
            } catch (e) {
                scope.toast('Error deleting target: ' + (e.message || ''), 'error');
            }
        },

        toast: (msg, type) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(msg, type || 'info');
            } else if (typeof Swal !== 'undefined') {
                Swal.fire(type === 'error' ? 'Error' : 'Done', msg, type === 'error' ? 'error' : 'success');
            }
        },

        escapeHtml: (text) => {
            if (text == null) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

window._dashboardTargetsGrid = _dashboardTargetsGrid;

$(document).ready(function () {
    var start = Date.now();
    (function tryInit() {
        if (typeof dataFunctions !== 'undefined') { _dashboardTargetsGrid.init(); return; }
        if (Date.now() - start < 5000) setTimeout(tryInit, 50);
    })();
});
