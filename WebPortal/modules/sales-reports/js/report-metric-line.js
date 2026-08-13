/**
 * Report metric row renderer — shared by every `metric_table` section in the report editor.
 * Namespace-assignment pattern only (see WebPortal/js/ui-states.js, WebPortal/js/mac-status.js):
 * no reference to document/$/jQuery/Swal/dataFunctions at evaluation time, so this file can be
 * evaluated with plain `vm.Script` and no DOM (scripts/tmp-verify-report-metric-line.cjs).
 *
 * Columns: Description · System · Entered · Target · Achieved % · Status.
 * Database/user text (labels, override reasons, attribution) reaches the DOM only via .text();
 * the one .html() use here is MacStatus.pill, which escapes its own arguments and is given only
 * a static label ('Overridden').
 */
(function (w) {
    'use strict';

    function isFiniteNumber(v) {
        return typeof v === 'number' ? Number.isFinite(v) : Number.isFinite(Number(v)) && String(v).trim() !== '';
    }

    // Locale-independent number formatting so behaviour is identical in every browser/locale and
    // in the pure-Node verification harness. No toLocaleString/Intl.NumberFormat.
    function formatNumber(value) {
        var n = Number(value);
        var fixed = n.toFixed(2);
        var neg = fixed.charAt(0) === '-';
        if (neg) fixed = fixed.slice(1);
        var parts = fixed.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + parts.join('.');
    }

    function formatSystemValue(metric) {
        var v = metric ? metric.system_value : null;
        if (v === null || v === undefined) return 'No system data';
        if (!isFiniteNumber(v)) return 'No system data';
        return formatNumber(v);
    }

    function formatAchievedPct(metric) {
        var target = metric ? metric.target_value : null;
        var effective = metric ? metric.effective_value : null;
        if (target === null || target === undefined) return '\u2014';
        if (!isFiniteNumber(target) || Number(target) === 0) return '\u2014';
        if (effective === null || effective === undefined) return '\u2014';
        if (!isFiniteNumber(effective)) return '\u2014';
        var pct = (Number(effective) / Number(target)) * 100;
        if (!Number.isFinite(pct)) return '\u2014';
        return formatNumber(pct) + '%';
    }

    function safeKey(key) {
        var s = String(key == null ? '' : key);
        if (s === '__proto__' || s === 'constructor' || s === 'prototype') return '';
        return s;
    }

    function buildMetricRow(metric, options) {
        var opts = options || {};
        var editable = opts.editable === true;
        var m = metric || {};
        var metricKey = safeKey(m.metric_key);

        var $tr = w.jQuery('<tr>');
        $tr.append(w.jQuery('<td>').text(String(m.label == null ? '' : m.label).replace(/\s+/g, ' ').trim()));
        $tr.append(w.jQuery('<td>').text(formatSystemValue(m)));

        var seed = (m.entered_value !== null && m.entered_value !== undefined) ? m.entered_value : m.system_value;
        var seedStr = (seed === null || seed === undefined) ? '' : String(seed);
        var $input = w.jQuery('<input>', {
            type: 'number',
            step: 'any',
            'class': 'form-control form-control-sm js-report-metric-input'
        });
        $input.attr('data-metric-key', metricKey);
        $input.val(seedStr);
        $input.data('lastValue', seedStr);
        if (!editable) $input.prop('disabled', true);
        $tr.append(w.jQuery('<td>').append($input));

        $tr.append(w.jQuery('<td>').text(m.target_value === null || m.target_value === undefined ? '\u2014' : formatNumber(m.target_value)));
        $tr.append(w.jQuery('<td>').text(formatAchievedPct(m)));

        var $statusCell = w.jQuery('<td>');
        if (m.is_overridden) {
            $statusCell.append(w.jQuery(w.MacStatus.pill('warning', 'Overridden')));
            var $detail = w.jQuery('<div>', { 'class': 'mac-metric-override-detail small text-muted' });
            var reasonText = String(m.override_reason == null ? '' : m.override_reason).trim();
            var byText = String(m.overridden_by_name == null ? '' : m.overridden_by_name).trim();
            var detailText = reasonText;
            if (byText) detailText = detailText ? (detailText + ' \u2014 ' + byText) : byText;
            $detail.text(detailText);
            $statusCell.append($detail);
        }
        $tr.append($statusCell);

        return $tr;
    }

    w.ReportMetricLine = {
        formatSystemValue: formatSystemValue,
        formatAchievedPct: formatAchievedPct,
        buildMetricRow: buildMetricRow
    };
})(typeof window !== 'undefined' ? window : this);
