/**
 * Stock Alert Rules admin grid — configure red-flag thresholds.
 */
var _stockAlertRulesGrid = function () {
    'use strict';

    var PRODUCT_TYPES = ['kernel', 'oil', 'protein', 'shell', 'nis_raw'];
    var SEVERITIES = ['info', 'warning', 'critical'];

    return {
        rows: [],

        init: async () => {
            const scope = _stockAlertRulesGrid;
            await new Promise(function (resolve) { $(document).ready(resolve); });
            scope.bindEvents();
            await scope.load();
        },

        bindEvents: () => {
            const scope = _stockAlertRulesGrid;
            $('#refreshStockAlertRulesBtn').off('click').on('click', function () { scope.load(); });
            $('#addStockAlertRuleBtn').off('click').on('click', function () { scope.addRow(); });
            $(document).off('click', '.js-save-stock-alert-rule').on('click', '.js-save-stock-alert-rule', function () {
                scope.saveRow($(this).closest('tr'));
            });
            $(document).off('click', '.js-delete-stock-alert-rule').on('click', '.js-delete-stock-alert-rule', function () {
                scope.deleteRow($(this).closest('tr'));
            });
        },

        load: async () => {
            const scope = _stockAlertRulesGrid;
            var tbody = document.getElementById('stockAlertRulesTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading rules...</td></tr>';
            try {
                var rows = await dataFunctions.getStockAlertRules();
                scope.rows = Array.isArray(rows) ? rows : [];
                scope.render();
            } catch (e) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-danger text-center py-4">Error: ' + scope.escapeHtml(e.message || '') + '</td></tr>';
            }
        },

        render: () => {
            const scope = _stockAlertRulesGrid;
            var tbody = document.getElementById('stockAlertRulesTableBody');
            if (!tbody) return;
            if (scope.rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No rules yet. Use Add Rule.</td></tr>';
                return;
            }
            tbody.innerHTML = scope.rows.map(function (r) { return scope.rowHtml(r); }).join('');
        },

        rowHtml: (r) => {
            const scope = _stockAlertRulesGrid;
            var id = r && r.id != null ? r.id : '';
            function opts(list, sel) {
                return list.map(function (o) {
                    return '<option value="' + o + '"' + (String(o) === String(sel) ? ' selected' : '') + '>' + o + '</option>';
                }).join('');
            }
            var pt = r && r.product_type ? r.product_type : 'kernel';
            var style = r && r.style ? r.style : '*';
            var minQty = r && r.min_qty != null ? r.min_qty : 0;
            var unit = r && r.unit ? r.unit : 'kg';
            var sev = r && r.severity ? r.severity : 'warning';
            var active = r && r.is_active !== false;
            return '<tr data-rule-id="' + id + '">' +
                '<td><select class="form-select form-select-sm r-product">' + opts(PRODUCT_TYPES, pt) + '</select></td>' +
                '<td><input type="text" class="form-control form-control-sm r-style" value="' + scope.escapeHtml(style) + '" placeholder="* for any"></td>' +
                '<td><input type="number" step="any" class="form-control form-control-sm r-min" value="' + minQty + '"></td>' +
                '<td><input type="text" class="form-control form-control-sm r-unit" value="' + scope.escapeHtml(unit) + '"></td>' +
                '<td><select class="form-select form-select-sm r-severity">' + opts(SEVERITIES, sev) + '</select></td>' +
                '<td><input type="checkbox" class="form-check-input r-active"' + (active ? ' checked' : '') + '></td>' +
                '<td class="text-end">' +
                '<button type="button" class="btn btn-sm btn-primary js-save-stock-alert-rule" title="Save"><i class="fas fa-save"></i></button> ' +
                '<button type="button" class="btn btn-sm btn-outline-danger js-delete-stock-alert-rule" title="Delete"><i class="fas fa-trash"></i></button>' +
                '</td></tr>';
        },

        addRow: () => {
            const scope = _stockAlertRulesGrid;
            var tbody = document.getElementById('stockAlertRulesTableBody');
            if (!tbody) return;
            if (scope.rows.length === 0) tbody.innerHTML = '';
            $(tbody).append(scope.rowHtml({ id: '', product_type: 'kernel', style: '*', min_qty: 100, unit: 'kg', severity: 'warning', is_active: true }));
        },

        saveRow: async ($tr) => {
            const scope = _stockAlertRulesGrid;
            var id = $tr.data('rule-id');
            var payload = {
                id: id !== '' && id != null ? id : null,
                product_type: ($tr.find('.r-product').val() || '').trim(),
                style: ($tr.find('.r-style').val() || '*').trim() || '*',
                min_qty: parseFloat($tr.find('.r-min').val()) || 0,
                unit: ($tr.find('.r-unit').val() || 'kg').trim(),
                alert_type: 'stock_low',
                severity: $tr.find('.r-severity').val() || 'warning',
                is_active: $tr.find('.r-active').prop('checked')
            };
            try {
                await dataFunctions.upsertStockAlertRule(payload);
                scope.toast('Rule saved.', 'success');
                await scope.load();
            } catch (e) {
                scope.toast('Error saving rule: ' + (e.message || ''), 'error');
            }
        },

        deleteRow: async ($tr) => {
            const scope = _stockAlertRulesGrid;
            var id = $tr.data('rule-id');
            if (!id) { $tr.remove(); return; }
            try {
                await dataFunctions.deleteStockAlertRule(id);
                scope.toast('Rule deleted.', 'success');
                await scope.load();
            } catch (e) {
                scope.toast('Error deleting rule: ' + (e.message || ''), 'error');
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

window._stockAlertRulesGrid = _stockAlertRulesGrid;

$(document).ready(function () {
    var start = Date.now();
    (function tryInit() {
        if (typeof dataFunctions !== 'undefined') { _stockAlertRulesGrid.init(); return; }
        if (Date.now() - start < 5000) setTimeout(tryInit, 50);
    })();
});
