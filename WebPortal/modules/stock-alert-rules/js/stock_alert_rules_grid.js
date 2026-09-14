/**
 * Stock Alert Rules admin grid — configure red-flag thresholds.
 *
 * Style and Unit are dropdowns, not free text.
 *
 * The style list comes from StockAlertsShared.STYLE_KEY_MAP — the SAME list the evaluator
 * compares against (WebPortal/js/stock-alerts-shared.js). It is deliberately NOT taken from
 * kernel_style_registry / get_kernel_styles: that registry carries BHO, BLO and 5M, which are not
 * the strings observations are reported under ('Butter High Oil', 'Butter Low Oil', and no 5M
 * source at all). evaluate_stock_alerts matches on exact string equality
 * (migrations/20260602130000_stock_alerts_and_accuracy.sql — "r.style = v_style OR r.style = '*'"),
 * so a rule built on a registry code would save happily and then never fire, with nothing to say
 * so. Sourcing the dropdown from the evaluator's own list makes that failure impossible.
 *
 * Only kernel has meaningful styles. Oil, protein, shell and nis_raw observations are always
 * reported with style '*' (stock-alerts-shared.js collectFromOilLots / collectFromRawRmLots /
 * collectFromShellLots), so for those products Style is locked to "Any".
 *
 * Rules saved before Style was a dropdown may hold a value the evaluator will never match. Those
 * are flagged in-row rather than silently rewritten — the fix is a judgement call, not a migration.
 */
var _stockAlertRulesGrid = function () {
    'use strict';

    var PRODUCT_TYPES = ['kernel', 'oil', 'protein', 'shell', 'nis_raw'];
    var SEVERITIES = ['info', 'warning', 'critical'];
    var UNITS = ['kg', 'L', 't'];
    var ANY_STYLE = '*';

    // Fallback mirrors stock-alerts-shared.js:8-11 for the case where that file has not loaded.
    var FALLBACK_KERNEL_STYLES = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8',
                                  'Butter High Oil', 'Butter Low Oil'];

    function kernelStyles() {
        if (typeof StockAlertsShared !== 'undefined' && StockAlertsShared.STYLE_KEY_MAP) {
            var keys = Object.keys(StockAlertsShared.STYLE_KEY_MAP);
            if (keys.length) return keys;
        }
        return FALLBACK_KERNEL_STYLES.slice();
    }

    function stylesFor(productType) {
        return productType === 'kernel' ? [ANY_STYLE].concat(kernelStyles()) : [ANY_STYLE];
    }

    function styleLabel(style) {
        return style === ANY_STYLE ? 'Any style' : style;
    }

    function isFirableStyle(productType, style) {
        return stylesFor(productType).indexOf(String(style)) !== -1;
    }

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
            // Changing the product changes which styles can fire, so the style list is rebuilt
            // and reset to Any rather than left showing a style the new product never reports.
            $(document).off('change', '.r-product').on('change', '.r-product', function () {
                scope.syncStyleSelect($(this).closest('tr'));
            });
        },

        syncStyleSelect: ($tr) => {
            const scope = _stockAlertRulesGrid;
            var product = $tr.find('.r-product').val();
            var $style = $tr.find('.r-style');
            $style.html(scope.styleOptions(product, ANY_STYLE));
            $style.prop('disabled', product !== 'kernel');
            $tr.find('.js-style-warning').remove();
        },

        styleOptions: (productType, selected) => {
            var list = stylesFor(productType);
            var html = '';
            var matched = false;
            list.forEach(function (s) {
                var isSel = String(s) === String(selected);
                if (isSel) matched = true;
                html += '<option value="' + _stockAlertRulesGrid.escapeHtml(s) + '"' +
                    (isSel ? ' selected' : '') + '>' +
                    _stockAlertRulesGrid.escapeHtml(styleLabel(s)) + '</option>';
            });
            // A saved style the evaluator does not know still has to be selectable, or saving the
            // row would silently change it to something else behind the user's back.
            if (!matched && selected != null && String(selected) !== '') {
                html = '<option value="' + _stockAlertRulesGrid.escapeHtml(selected) + '" selected>' +
                    _stockAlertRulesGrid.escapeHtml(selected) + ' — not recognised</option>' + html;
            }
            return html;
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
                scope.renderBadStyleWarning(0);
                return;
            }
            tbody.innerHTML = scope.rows.map(function (r) { return scope.rowHtml(r); }).join('');
            MacTableActions.init(document.getElementById('stockAlertRulesTable'));

            var broken = scope.rows.filter(function (r) {
                return !isFirableStyle(r.product_type || 'kernel', r.style || ANY_STYLE);
            }).length;
            scope.renderBadStyleWarning(broken);
        },

        renderBadStyleWarning: (count) => {
            var $box = $('#stockAlertRulesBadStyleWarning');
            if (!$box.length) return;
            if (!count) { $box.addClass('d-none'); return; }
            $('#stockAlertRulesBadStyleText').text(
                count + ' rule' + (count === 1 ? '' : 's') + ' below ' +
                (count === 1 ? 'has a style' : 'have styles') +
                ' the alert checker does not recognise, so ' + (count === 1 ? 'it' : 'they') +
                ' can never fire. Pick a style from the list to fix ' + (count === 1 ? 'it' : 'them') + '.'
            );
            $box.removeClass('d-none');
        },

        rowHtml: (r) => {
            const scope = _stockAlertRulesGrid;
            var id = r && r.id != null ? r.id : '';
            function opts(list, sel) {
                return list.map(function (o) {
                    return '<option value="' + scope.escapeHtml(o) + '"' +
                        (String(o) === String(sel) ? ' selected' : '') + '>' +
                        scope.escapeHtml(o) + '</option>';
                }).join('');
            }
            var pt = r && r.product_type ? r.product_type : 'kernel';
            var style = r && r.style ? r.style : ANY_STYLE;
            var minQty = r && r.min_qty != null ? r.min_qty : 0;
            var unit = r && r.unit ? r.unit : 'kg';
            var sev = r && r.severity ? r.severity : 'warning';
            var active = r && r.is_active !== false;
            var canFire = isFirableStyle(pt, style);

            var styleWarning = canFire ? '' :
                '<div class="text-danger small mt-1 js-style-warning">' +
                '<i class="fas fa-triangle-exclamation me-1"></i>Can never fire — pick a style from the list' +
                '</div>';

            // Unit is a display label on the alert, not part of the comparison, so an unrecognised
            // saved unit is kept selectable rather than being silently coerced to kg.
            var unitList = UNITS.indexOf(unit) === -1 ? [unit].concat(UNITS) : UNITS;

            return '<tr data-rule-id="' + scope.escapeHtml(id) + '">' +
                '<td><select class="form-select form-select-sm r-product">' + opts(PRODUCT_TYPES, pt) + '</select></td>' +
                '<td><select class="form-select form-select-sm r-style"' +
                    (pt === 'kernel' ? '' : ' disabled') + '>' +
                    scope.styleOptions(pt, style) + '</select>' + styleWarning + '</td>' +
                '<td><input type="number" step="any" min="0" class="form-control form-control-sm r-min" value="' + scope.escapeHtml(minQty) + '"></td>' +
                '<td><select class="form-select form-select-sm r-unit">' + opts(unitList, unit) + '</select></td>' +
                '<td><select class="form-select form-select-sm r-severity">' + opts(SEVERITIES, sev) + '</select></td>' +
                '<td><input type="checkbox" class="form-check-input r-active"' + (active ? ' checked' : '') + '></td>' +
                '<td class="mac-table-actions-col text-end">' + MacTableActions.render({
                    id: 'sarActions' + id,
                    items: [
                        { label: 'Save', className: 'js-save-stock-alert-rule', icon: 'fas fa-save' },
                        { label: 'Delete', className: 'js-delete-stock-alert-rule', danger: true, icon: 'fas fa-trash' }
                    ]
                }) + '</td></tr>';
        },

        addRow: () => {
            const scope = _stockAlertRulesGrid;
            var tbody = document.getElementById('stockAlertRulesTableBody');
            if (!tbody) return;
            if (scope.rows.length === 0) tbody.innerHTML = '';
            $(tbody).append(scope.rowHtml({
                id: '', product_type: 'kernel', style: ANY_STYLE,
                min_qty: 100, unit: 'kg', severity: 'warning', is_active: true
            }));
        },

        saveRow: async ($tr) => {
            const scope = _stockAlertRulesGrid;
            var id = $tr.data('rule-id');
            var product = ($tr.find('.r-product').val() || '').trim();
            var style = ($tr.find('.r-style').val() || ANY_STYLE).trim() || ANY_STYLE;

            if (!isFirableStyle(product, style)) {
                scope.toast('That style is not one the alert checker recognises, so the rule could never fire. Pick one from the list.', 'error');
                return;
            }

            var payload = {
                id: id !== '' && id != null ? id : null,
                product_type: product,
                style: style,
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
            return _common.escapeHtml(text);
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
