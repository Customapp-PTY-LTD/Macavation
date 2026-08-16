/**
 * Sales & Production Reports — report editor.
 * Follows the company module pattern (IIFE, init()/destroy(), namespaced events) per
 * BluePrint/javascript-jquery-rules.md, modelled on report_list_grid.js in this same module.
 *
 * Every database/user-entered value (labels, commentary, override reasons, the executive
 * summary, overridden_by_name) reaches the DOM only via .text() or a shared self-escaping
 * helper (MacStatus.pill, macEmptyState) given a STATIC label — never a payload value through
 * .html()/innerHTML/string concatenation.
 *
 * No deep-linking: the report id is read from Session ('currentReportId'), never from a route
 * argument (initializeModule(routeName) is called with no other params — appRouter.js:252).
 *
 * data-action-perm is swept once over static markup shortly after load (appRouter.js:253-256)
 * and is inert on anything rendered afterwards. The "Refresh figures" button is static markup
 * so it may carry data-action-perm; every metric row is rendered after that sweep, so its
 * editability is gated with an inline hasAction() check instead.
 */
var _reportEditor = function () {
    'use strict';

    var REPORT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    var state = {
        reportId: null,
        payload: null,
        pendingExecSummary: false
    };

    // In-flight guards, keyed by metric_key / section_key. A Map (not a plain object) so a
    // payload string can never collide with a prototype property.
    var pendingOverrides = new Map();
    var pendingCommentary = new Map();

    // ------------------------------------------------------------------
    // Local helpers — private to this file (report_list_grid.js's helpers are not exported).
    // ------------------------------------------------------------------

    function displayLabel(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function isReportUuid(value) {
        return typeof value === 'string' && REPORT_UUID_RE.test(value);
    }

    function firstRpcRow(result) {
        return Array.isArray(result) ? (result[0] || null) : (result && typeof result === 'object' ? result : null);
    }

    // Reject __proto__/constructor before a payload string is ever used as a Map key.
    function safeKey(key) {
        var s = String(key == null ? '' : key);
        if (s === '__proto__' || s === 'constructor' || s === 'prototype' || s === '') return '';
        return s;
    }

    // String-slice only (no Date arithmetic, no toISOString) — same idiom as report_list_grid.js.
    function formatDateOnly(value) {
        var s = displayLabel(value);
        if (!s) return '';
        var idx = s.indexOf('T');
        return idx > -1 ? s.slice(0, idx) : s;
    }

    function isRpcSuccess(result) {
        var row = firstRpcRow(result);
        return Number(row && row.success) === 1;
    }

    function rpcError(result, fallback) {
        var row = firstRpcRow(result);
        return (row && row.error) ? row.error : fallback;
    }

    // ------------------------------------------------------------------
    // Report id — Session-only, validated before every RPC call.
    // ------------------------------------------------------------------

    function getCurrentReportId() {
        try {
            var id = (typeof Session !== 'undefined' && Session.get) ? Session.get('currentReportId') : null;
            return isReportUuid(id) ? id : null;
        } catch (e) {
            return null;
        }
    }

    function routeBackToList() {
        if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
            _appRouter.routeTo('sales-forecasting-grid', true);
        }
    }

    // ------------------------------------------------------------------
    // Screen states — loading / empty / locked-banner / content.
    // ------------------------------------------------------------------

    function showLoadingState() {
        $('#reportEditorLoadingState').removeClass('d-none');
        $('#reportEditorContent').addClass('d-none');
        $('#reportEditorEmptyState').addClass('d-none').empty();
        $('#reportEditorLockedBanner').addClass('d-none').text('');
    }

    function showEmptyState(icon, title, hint) {
        $('#reportEditorLoadingState').addClass('d-none');
        $('#reportEditorContent').addClass('d-none');
        $('#reportEditorLockedBanner').addClass('d-none').text('');
        // macEmptyState escapes its own arguments; every argument here is a static string this
        // file authors, never a payload value.
        $('#reportEditorEmptyState').html(macEmptyState(icon, title, hint)).removeClass('d-none');
    }

    function hideTransientStates() {
        $('#reportEditorLoadingState').addClass('d-none');
        $('#reportEditorEmptyState').addClass('d-none').empty();
    }

    // ------------------------------------------------------------------
    // Locked banner — derived only from the payload's own status/published_at.
    // ------------------------------------------------------------------

    function renderLockedBanner(payload) {
        var $banner = $('#reportEditorLockedBanner');
        if (payload.status === 'draft') {
            $banner.addClass('d-none').text('');
            return;
        }
        var publishedAtRaw = payload.published_at;
        var hasPublishedAt = publishedAtRaw !== null && publishedAtRaw !== undefined && String(publishedAtRaw).trim() !== '';
        var dateStr = hasPublishedAt ? formatDateOnly(publishedAtRaw) : '';
        var text;
        if (payload.status === 'published' && hasPublishedAt) {
            text = 'Published ' + dateStr + '\u2014figures are locked.';
        } else if (payload.status === 'superseded') {
            text = 'Superseded\u2014figures are locked.';
            if (hasPublishedAt) text += ' Published ' + dateStr + '.';
        } else {
            text = 'Figures are locked.';
        }
        $banner.text(text).removeClass('d-none');
    }

    // ------------------------------------------------------------------
    // Section / metric-table rendering.
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Kernel Stock Report section: the same per-style tally shown on the Kernel Stock on Hand page,
    // plus the stock-on-hand history chart, which can be switched off per report.
    //
    // The two come from different sources and are in different units — the tally is CARTONS from
    // batch remainders, the chart is KG reconstructed from the packing/dispatch ledgers by
    // get_stock_soh_history. They are labelled separately and neither is converted into the other.
    // ------------------------------------------------------------------

    // Locale-independent, matching report-metric-line.js's own formatter (which is private to that
    // file). Cartons are shown whole when they are whole — the stock page shows 483, not 483.00 —
    // and to 2dp only when a kg-derived carton equivalent produced a fraction.
    function formatCartons(value) {
        var n = Number(value);
        if (!Number.isFinite(n)) return '—';
        var rounded = Math.round(n * 100) / 100;
        var fixed = (rounded % 1 === 0) ? String(rounded) : rounded.toFixed(2);
        var neg = fixed.charAt(0) === '-';
        if (neg) fixed = fixed.slice(1);
        var parts = fixed.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + parts.join('.');
    }

    var KERNEL_STOCK_RANGES = [
        { key: '1M', label: '1M', days: 31 },
        { key: '3M', label: '3M', days: 92 },
        { key: '6M', label: '6M', days: 183 },
        { key: '1Y', label: '1Y', days: 365 },
        { key: 'ALL', label: 'All', days: 1826 }
    ];

    // Chart instances by section index, so a re-render destroys the old one rather than leaking a
    // Chart.js object bound to a canvas that has been removed from the DOM.
    var kernelStockCharts = {};

    // Batches are fetched once and held, so flipping cartons/kg re-totals in place rather than
    // making another round trip for figures already in hand.
    var kernelStockBatches = null;

    function destroyKernelStockCharts() {
        Object.keys(kernelStockCharts).forEach(function (k) {
            try { kernelStockCharts[k].destroy(); } catch (e) { /* ignore */ }
            delete kernelStockCharts[k];
        });
        // Held batches belong to the report being torn down; a later report must re-fetch.
        kernelStockBatches = null;
    }

    function buildKernelStockBody(index) {
        var $wrap = $('<div>', { 'class': 'js-kernel-stock-body' }).attr('data-index', String(index));

        // Tally — styles across the top, one totals row beneath, exactly as the stock page shows it,
        // under its own heading with a cartons/kg switch.
        var $tallyHead = $('<div>', { 'class': 'd-flex flex-wrap align-items-center gap-2 mb-2' });
        $tallyHead.append($('<h6>', { 'class': 'mb-0 me-2' }).text('Kernel Stock on Hand'));
        var $unitGroup = $('<div>', { 'class': 'btn-group btn-group-sm js-kernel-stock-units' });
        [{ key: 'cartons', label: 'Cartons' }, { key: 'kg', label: 'Kg' }].forEach(function (u) {
            $unitGroup.append($('<button>', {
                type: 'button',
                'class': 'btn btn-outline-secondary js-kernel-stock-unit' + (u.key === 'cartons' ? ' active' : '')
            }).attr('data-unit', u.key).text(u.label));
        });
        $tallyHead.append($unitGroup);
        $wrap.append($tallyHead);

        var $tallyWrap = $('<div>', { 'class': 'table-responsive mb-3' });
        var $table = $('<table>', { 'class': 'table table-sm table-bordered align-middle mb-1 js-kernel-stock-tally' });
        var styles = (window.KernelStyleTally && window.KernelStyleTally.KERNEL_STYLES) || [];
        var $headRow = $('<tr>');
        styles.forEach(function (s) {
            $headRow.append($('<th>', { 'class': 'text-center small text-uppercase text-muted' }).text(s));
        });
        $headRow.append($('<th>', { 'class': 'text-center small text-uppercase text-muted' }).text('Total'));
        $table.append($('<thead>').append($headRow));
        var $valRow = $('<tr>', { 'class': 'js-kernel-stock-tally-row fw-bold' });
        styles.forEach(function (s) {
            $valRow.append($('<td>', { 'class': 'text-center' }).attr('data-style', s).text('—'));
        });
        $valRow.append($('<td>', { 'class': 'text-center js-kernel-stock-grand' }).text('—'));
        $table.append($('<tbody>').append($valRow));
        $tallyWrap.append($table);
        $tallyWrap.append($('<div>', { 'class': 'text-muted small js-kernel-stock-tally-note' })
            .text('Cartons on hand by style, from finished batch remainders.'));
        $wrap.append($tallyWrap);

        // Chart toolbar: the on/off switch and the range buttons.
        var $bar = $('<div>', { 'class': 'd-flex flex-wrap align-items-center gap-2 mb-2' });
        var chartToggleId = 'reportKernelStockChartToggle' + index;
        var $toggleWrap = $('<div>', { 'class': 'form-check form-switch me-2' });
        $toggleWrap.append($('<input>', {
            type: 'checkbox', id: chartToggleId, 'class': 'form-check-input js-kernel-stock-chart-toggle'
        }).prop('checked', true));
        $toggleWrap.append($('<label>', { 'class': 'form-check-label small', 'for': chartToggleId })
            .text('Show stock on hand history'));
        $bar.append($toggleWrap);

        var $btnGroup = $('<div>', { 'class': 'btn-group btn-group-sm js-kernel-stock-ranges' });
        KERNEL_STOCK_RANGES.forEach(function (r) {
            var $b = $('<button>', {
                type: 'button',
                'class': 'btn btn-outline-secondary js-kernel-stock-range' + (r.key === '3M' ? ' active' : '')
            }).attr('data-range', r.key).text(r.label);
            $btnGroup.append($b);
        });
        $bar.append($btnGroup);
        $wrap.append($bar);

        // Chart.js runs with maintainAspectRatio:false, so it fills its container — the height is
        // set on the wrapper, not the canvas, or the canvas attribute is simply overwritten on the
        // first resize. 180px keeps the history readable without it dominating the section.
        var $chartWrap = $('<div>', { 'class': 'js-kernel-stock-chart-wrap' });
        var $chartBox = $('<div>', { 'class': 'js-kernel-stock-chart-box' }).css('height', '180px');
        $chartBox.append($('<canvas>', { 'class': 'js-kernel-stock-chart' })
            .attr('data-index', String(index)));
        $chartWrap.append($chartBox);
        $chartWrap.append($('<div>', { 'class': 'text-muted small mt-1 js-kernel-stock-chart-note' })
            .text('Kilograms on hand, reconstructed from packing and dispatch. A different source ' +
                  'from the carton tally above.'));
        $wrap.append($chartWrap);

        return $wrap;
    }

    function renderKernelStockTally($body) {
        var T = window.KernelStyleTally;
        if (!T || !Array.isArray(kernelStockBatches)) return;
        var unit = $body.find('.js-kernel-stock-unit.active').attr('data-unit') || 'cartons';
        var result = T.tallyForBatches(kernelStockBatches, unit);
        T.KERNEL_STYLES.forEach(function (s) {
            $body.find('.js-kernel-stock-tally-row [data-style="' + s + '"]')
                .text(formatCartons(result.totals[s] || 0));
        });
        $body.find('.js-kernel-stock-grand').text(formatCartons(T.grandTotal(result.totals)));
        $body.find('.js-kernel-stock-tally-note').text(
            (result.unit === 'kg' ? 'Kilograms' : 'Cartons') + ' on hand by style, across ' +
            result.batchCount + ' finished batch' + (result.batchCount === 1 ? '' : 'es') +
            ' still holding stock.');
    }

    function loadKernelStockSection() {
        var $bodies = $('#reportEditorAccordion .js-kernel-stock-body');
        if (!$bodies.length) return;

        // Tally: the same call the Kernel Stock on Hand page makes, summed by the same shared module.
        dataFunctions.getKernelBatches(null, false, { status: 'complete' }).then(function (batches) {
            kernelStockBatches = Array.isArray(batches) ? batches : [];
            $bodies.each(function () { renderKernelStockTally($(this)); });
        }).catch(function (err) {
            console.warn('[report-editor] kernel stock tally failed', err);
            kernelStockBatches = null;
            $bodies.find('.js-kernel-stock-tally-note').text('Stock on hand is not available right now.');
        });

        $bodies.each(function () {
            renderKernelStockChart($(this), '3M');
        });
    }

    function renderKernelStockChart($body, rangeKey) {
        var index = $body.attr('data-index');
        var range = null;
        KERNEL_STOCK_RANGES.forEach(function (r) { if (r.key === rangeKey) range = r; });
        if (!range) range = KERNEL_STOCK_RANGES[1];

        var canvas = $body.find('.js-kernel-stock-chart')[0];
        if (!canvas || typeof Chart === 'undefined' || typeof dataFunctions.getStockSohHistory !== 'function') {
            $body.find('.js-kernel-stock-chart-note').text('The stock history chart is not available in this build.');
            return;
        }

        dataFunctions.getStockSohHistory('kernel', range.days).then(function (rows) {
            var list = Array.isArray(rows) ? rows : [];
            if (kernelStockCharts[index]) {
                try { kernelStockCharts[index].destroy(); } catch (e) { /* ignore */ }
                delete kernelStockCharts[index];
            }
            if (!list.length) {
                $body.find('.js-kernel-stock-chart-note').text('No stock history for this range.');
                return;
            }

            // Group into one dataset per style, over the sorted set of dates present.
            var dates = [];
            var seen = {};
            list.forEach(function (r) {
                var d = String(r.d == null ? '' : r.d).slice(0, 10);
                if (d && !seen[d]) { seen[d] = true; dates.push(d); }
            });
            dates.sort();
            var bySeries = {};
            list.forEach(function (r) {
                var s = String(r.series == null ? '' : r.series);
                if (!bySeries[s]) bySeries[s] = {};
                bySeries[s][String(r.d == null ? '' : r.d).slice(0, 10)] = Number(r.qty_kg) || 0;
            });

            var order = (window.KernelStyleTally && window.KernelStyleTally.KERNEL_STYLES) || Object.keys(bySeries);
            var palette = ['#2563eb', '#d97706', '#7c3aed', '#0891b2', '#16a34a',
                           '#dc2626', '#0f766e', '#be185d', '#4b5563', '#a16207'];
            var datasets = [];
            order.forEach(function (s, i) {
                if (!bySeries[s]) return;
                datasets.push({
                    label: s,
                    data: dates.map(function (d) { return bySeries[s][d] == null ? null : bySeries[s][d]; }),
                    borderColor: palette[i % palette.length],
                    backgroundColor: palette[i % palette.length],
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0,
                    spanGaps: true
                });
            });

            kernelStockCharts[index] = new Chart(canvas.getContext('2d'), {
                type: 'line',
                data: { labels: dates, datasets: datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'nearest', intersect: false },
                    plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8 } } },
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: 'kg on hand' } },
                        x: { ticks: { maxTicksLimit: 12, autoSkip: true } }
                    }
                }
            });
            $body.find('.js-kernel-stock-chart-note').text(
                'Kilograms on hand, reconstructed from packing and dispatch. A different source from ' +
                'the carton tally above.');
        }).catch(function (err) {
            console.warn('[report-editor] stock history failed', err);
            $body.find('.js-kernel-stock-chart-note').text('Stock history is not available right now.');
        });
    }

    function buildEmptyRenderKindBody() {
        // macEmptyState escapes its own arguments; both strings here are static.
        return $(macEmptyState('fa-database', 'Not available yet', "Populated when this section's data source is connected."));
    }

    function buildMetricTableBody(section, editable) {
        var $table = $('<table>', { 'class': 'table table-sm align-middle mb-0' });
        var $thead = $('<thead>').append(
            $('<tr>')
                .append($('<th>').text('Description'))
                .append($('<th>').text('System'))
                .append($('<th>').text('Entered'))
                .append($('<th>').text('Target'))
                .append($('<th>').text('Achieved %'))
                .append($('<th>').text('Status'))
        );
        var $tbody = $('<tbody>');
        var metrics = Array.isArray(section.metrics) ? section.metrics : [];
        metrics.forEach(function (metric) {
            $tbody.append(ReportMetricLine.buildMetricRow(metric, { editable: editable }));
        });
        $table.append($thead).append($tbody);
        return $table;
    }

    function buildSectionAccordionItem(section, index, isEditable, statusDraft) {
        var sectionKey = safeKey(section.section_key);
        var collapseId = 'reportEditorSectionBody' + index;

        var $item = $('<div>', { 'class': 'accordion-item' });

        var $headerButton = $('<button>', {
            type: 'button',
            'class': 'accordion-button d-flex align-items-center',
            'data-bs-toggle': 'collapse',
            'data-bs-target': '#' + collapseId
        }).attr('aria-expanded', 'true');
        $headerButton.append($('<span>', { 'class': 'flex-grow-1' }).text(displayLabel(section.label)));

        if (statusDraft) {
            var $switchWrap = $('<div>', { 'class': 'form-check form-switch ms-3 js-section-toggle-wrap' });
            var $switchInput = $('<input>', {
                type: 'checkbox',
                'class': 'form-check-input js-section-toggle'
            }).attr('data-section-key', sectionKey);
            $switchInput.prop('checked', !!section.is_enabled);
            if (!isEditable) $switchInput.prop('disabled', true);
            $switchWrap.append($switchInput);
            $headerButton.append($switchWrap);
        }

        var $header = $('<h2>', { 'class': 'accordion-header' }).append($headerButton);
        $item.append($header);

        var $collapse = $('<div>', { id: collapseId, 'class': 'accordion-collapse collapse show' });
        var $body = $('<div>', { 'class': 'accordion-body' });

        if (section.render_kind === 'metric_table') {
            $body.append(buildMetricTableBody(section, isEditable && statusDraft));
        } else if (sectionKey === 'kernel_stock_report') {
            $body.append(buildKernelStockBody(index));
        } else {
            $body.append(buildEmptyRenderKindBody());
        }

        var commentaryId = 'reportEditorSectionCommentary' + index;
        var $commentaryLabel = $('<label>', { 'class': 'form-label small text-muted mt-3', 'for': commentaryId }).text('Commentary');
        var $commentary = $('<textarea>', {
            id: commentaryId,
            'class': 'form-control js-section-commentary',
            rows: 2
        }).attr('data-section-key', sectionKey);
        var commentaryVal = section.commentary == null ? '' : String(section.commentary);
        $commentary.val(commentaryVal);
        $commentary.data('lastValue', commentaryVal);
        if (!isEditable || !statusDraft) $commentary.prop('disabled', true);
        $body.append($commentaryLabel).append($commentary);

        $collapse.append($body);
        $item.append($collapse);
        return $item;
    }

    // ------------------------------------------------------------------
    // Full render from a payload.
    // ------------------------------------------------------------------

    function renderPayload(payload) {
        hideTransientStates();

        var statusDraft = payload.status === 'draft';
        var isEditable = statusDraft && typeof hasAction === 'function' && hasAction('reports.report.edit');

        $('#reportEditorTitle').text(displayLabel(payload.period_label));
        $('#reportEditorSubtitle').text(displayLabel(payload.period_start) + ' \u2013 ' + displayLabel(payload.period_end));

        renderLockedBanner(payload);

        var $summary = $('#reportEditorExecSummary');
        var summaryVal = payload.executive_summary == null ? '' : String(payload.executive_summary);
        $summary.val(summaryVal);
        $summary.data('lastValue', summaryVal);
        $summary.prop('disabled', !isEditable);

        $('#reportEditorRefreshFiguresBtn').prop('disabled', !statusDraft);

        // Any chart from a previous render is bound to a canvas about to be discarded.
        destroyKernelStockCharts();

        var $accordion = $('#reportEditorAccordion').empty();
        var sections = Array.isArray(payload.sections) ? payload.sections : [];
        sections.forEach(function (section, idx) {
            $accordion.append(buildSectionAccordionItem(section, idx, isEditable, statusDraft));
        });

        // Populated after the accordion is in the DOM, since both the tally and the chart are
        // fetched asynchronously and write into elements built above.
        loadKernelStockSection();

        $('#reportEditorContent').removeClass('d-none');
    }

    // ------------------------------------------------------------------
    // Loading.
    // ------------------------------------------------------------------

    function handleMissingReportId() {
        console.warn('[sales-reports] report editor opened with no valid report id');
        showEmptyState('fa-file-invoice', 'No report selected', 'Return to the report list and open a report again.');
        routeBackToList();
    }

    function load() {
        showLoadingState();
        var id = getCurrentReportId();
        if (!id) {
            handleMissingReportId();
            return;
        }
        state.reportId = id;
        dataFunctions.getReportInstance(id).then(function (payload) {
            if (!payload) {
                showEmptyState('fa-file-invoice', 'Report not found', 'This report could not be found. It may have been deleted.');
                return;
            }
            state.payload = payload;
            renderPayload(payload);
        }).catch(function (err) {
            console.warn('[sales-reports] getReportInstance failed', err);
            showEmptyState('fa-file-invoice', 'This report cannot be loaded', 'The report-builder migrations have not been applied to this database.');
        });
    }

    // A save/refresh RPC already succeeded when this is called; a failure here must not
    // discard what is already on screen (deliverable 5) — just log and leave the DOM as-is.
    function reloadAndRerender() {
        if (!state.reportId) return Promise.resolve();
        return dataFunctions.getReportInstance(state.reportId, null, true).then(function (fresh) {
            if (!fresh) {
                showEmptyState('fa-file-invoice', 'Report not found', 'This report could not be found. It may have been deleted.');
                return;
            }
            state.payload = fresh;
            renderPayload(fresh);
        }).catch(function (err) {
            console.warn('[sales-reports] could not refresh report after save', err);
        });
    }

    // ------------------------------------------------------------------
    // Metric override / clear.
    // ------------------------------------------------------------------

    function handleMetricBlur($input) {
        var metricKey = safeKey($input.attr('data-metric-key'));
        if (!metricKey || !state.reportId) return;

        var newVal = String($input.val() == null ? '' : $input.val()).trim();
        var lastVal = String($input.data('lastValue') == null ? '' : $input.data('lastValue'));
        if (newVal === lastVal) return;

        if (pendingOverrides.has(metricKey)) return;
        pendingOverrides.set(metricKey, true);

        var finish = function () { pendingOverrides.delete(metricKey); };

        if (newVal === '') {
            dataFunctions.clearReportMetricOverride(state.reportId, metricKey).then(function (result) {
                if (isRpcSuccess(result)) {
                    $input.data('lastValue', '');
                    return reloadAndRerender();
                }
                Swal.fire({ icon: 'error', title: 'Could not clear override', text: rpcError(result, 'Could not clear the override.') });
                $input.val(lastVal);
            }).catch(function (err) {
                console.warn('[sales-reports] clearReportMetricOverride failed', err);
                Swal.fire({ icon: 'error', title: 'Could not clear override', text: 'Could not save this change. Please try again.' });
                $input.val(lastVal);
            }).finally(finish);
            return;
        }

        var numVal = Number(newVal);
        if (!Number.isFinite(numVal)) {
            Swal.fire({ icon: 'error', title: 'Invalid value', text: 'Enter a valid number.' });
            $input.val(lastVal);
            finish();
            return;
        }

        Swal.fire({
            input: 'text',
            inputLabel: 'Reason for overriding this figure',
            inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
            showCancelButton: true
        }).then(function (result) {
            if (!result.isConfirmed) {
                $input.val(lastVal);
                finish();
                return;
            }
            dataFunctions.overrideReportMetricValue(state.reportId, metricKey, numVal, result.value).then(function (rpcResult) {
                if (isRpcSuccess(rpcResult)) {
                    $input.data('lastValue', String(numVal));
                    return reloadAndRerender();
                }
                Swal.fire({ icon: 'error', title: 'Could not save override', text: rpcError(rpcResult, 'Could not save the override.') });
                $input.val(lastVal);
            }).catch(function (err) {
                console.warn('[sales-reports] overrideReportMetricValue failed', err);
                Swal.fire({ icon: 'error', title: 'Could not save override', text: 'Could not save this figure. Please try again.' });
                $input.val(lastVal);
            }).finally(finish);
        }).catch(function (err) {
            console.warn('[sales-reports] override reason prompt failed', err);
            $input.val(lastVal);
            finish();
        });
    }

    // ------------------------------------------------------------------
    // Section toggle / commentary / executive summary.
    // ------------------------------------------------------------------

    function handleSectionToggle($checkbox) {
        var sectionKey = safeKey($checkbox.attr('data-section-key'));
        if (!sectionKey || !state.reportId) return;
        var newVal = $checkbox.prop('checked');
        $checkbox.prop('disabled', true);
        dataFunctions.setReportSectionState(state.reportId, sectionKey, { is_enabled: newVal }).then(function (result) {
            if (isRpcSuccess(result)) {
                return reloadAndRerender();
            }
            Swal.fire({ icon: 'error', title: 'Could not update section', text: rpcError(result, 'Could not update the section.') });
            $checkbox.prop('checked', !newVal).prop('disabled', false);
        }).catch(function (err) {
            console.warn('[sales-reports] setReportSectionState (toggle) failed', err);
            Swal.fire({ icon: 'error', title: 'Could not update section', text: 'Could not save this change. Please try again.' });
            $checkbox.prop('checked', !newVal).prop('disabled', false);
        });
    }

    function handleCommentaryBlur($textarea) {
        var sectionKey = safeKey($textarea.attr('data-section-key'));
        if (!sectionKey || !state.reportId) return;

        var newVal = String($textarea.val() == null ? '' : $textarea.val());
        var lastVal = String($textarea.data('lastValue') == null ? '' : $textarea.data('lastValue'));
        if (newVal === lastVal) return;

        if (pendingCommentary.has(sectionKey)) return;
        pendingCommentary.set(sectionKey, true);

        dataFunctions.setReportSectionState(state.reportId, sectionKey, { commentary: newVal }).then(function (result) {
            if (isRpcSuccess(result)) {
                $textarea.data('lastValue', newVal);
                return reloadAndRerender();
            }
            Swal.fire({ icon: 'error', title: 'Could not save commentary', text: rpcError(result, 'Could not save the commentary.') });
            $textarea.val(lastVal);
        }).catch(function (err) {
            console.warn('[sales-reports] setReportSectionState (commentary) failed', err);
            Swal.fire({ icon: 'error', title: 'Could not save commentary', text: 'Could not save this change. Please try again.' });
            $textarea.val(lastVal);
        }).finally(function () {
            pendingCommentary.delete(sectionKey);
        });
    }

    function handleExecSummaryBlur($textarea) {
        if (!state.reportId) return;
        var newVal = String($textarea.val() == null ? '' : $textarea.val());
        var lastVal = String($textarea.data('lastValue') == null ? '' : $textarea.data('lastValue'));
        if (newVal === lastVal) return;

        if (state.pendingExecSummary) return;
        state.pendingExecSummary = true;

        dataFunctions.setReportExecutiveSummary(state.reportId, newVal).then(function (result) {
            if (isRpcSuccess(result)) {
                $textarea.data('lastValue', newVal);
                return reloadAndRerender();
            }
            Swal.fire({ icon: 'error', title: 'Could not save summary', text: rpcError(result, 'Could not save the executive summary.') });
            $textarea.val(lastVal);
        }).catch(function (err) {
            console.warn('[sales-reports] setReportExecutiveSummary failed', err);
            Swal.fire({ icon: 'error', title: 'Could not save summary', text: 'Could not save this change. Please try again.' });
            $textarea.val(lastVal);
        }).finally(function () {
            state.pendingExecSummary = false;
        });
    }

    function handleRefreshFigures() {
        if (!state.reportId) return;
        var $btn = $('#reportEditorRefreshFiguresBtn');
        $btn.prop('disabled', true);
        dataFunctions.refreshReportInstance(state.reportId).then(function (result) {
            if (isRpcSuccess(result)) {
                var row = firstRpcRow(result);
                var count = Number(row && row.metrics_refreshed) || 0;
                return reloadAndRerender().then(function () {
                    Swal.fire({ icon: 'success', title: 'Figures refreshed', text: count + ' metric' + (count === 1 ? '' : 's') + ' refreshed.' });
                });
            }
            Swal.fire({ icon: 'error', title: 'Could not refresh figures', text: rpcError(result, 'Could not refresh figures.') });
        }).catch(function (err) {
            console.warn('[sales-reports] refreshReportInstance failed', err);
            Swal.fire({ icon: 'error', title: 'Could not refresh figures', text: 'Could not refresh figures. Please try again.' });
        }).finally(function () {
            $btn.prop('disabled', !(state.payload && state.payload.status === 'draft'));
        });
    }

    // ------------------------------------------------------------------
    // Event wiring — every binding namespaced ".reportEditor"; destroy() removes them all.
    // ------------------------------------------------------------------

    function bindEvents() {
        $(document).on('click.reportEditor', '#reportEditorBackBtn', function (e) {
            e.preventDefault();
            routeBackToList();
        });
        $(document).on('click.reportEditor', '#reportEditorRefreshFiguresBtn', function () {
            handleRefreshFigures();
        });
        $(document).on('blur.reportEditor', '.js-report-metric-input', function () {
            handleMetricBlur($(this));
        });
        $(document).on('change.reportEditor', '.js-section-toggle', function () {
            handleSectionToggle($(this));
        });
        $(document).on('blur.reportEditor', '.js-section-commentary', function () {
            handleCommentaryBlur($(this));
        });
        $(document).on('blur.reportEditor', '#reportEditorExecSummary', function () {
            handleExecSummaryBlur($(this));
        });
        // Keep the accordion open/closed toggle from also flipping the enable/disable switch.
        $(document).on('click.reportEditor', '.js-section-toggle-wrap', function (e) {
            e.stopPropagation();
        });

        // Kernel Stock Report: show/hide the history chart, and switch its range.
        $(document).on('change.reportEditor', '.js-kernel-stock-chart-toggle', function () {
            var $body = $(this).closest('.js-kernel-stock-body');
            var on = $(this).is(':checked');
            $body.find('.js-kernel-stock-chart-wrap').toggleClass('d-none', !on);
            $body.find('.js-kernel-stock-ranges').toggleClass('d-none', !on);
            // Chart.js sizes to a hidden canvas as zero, so redraw when it comes back into view.
            if (on) renderKernelStockChart($body, $body.find('.js-kernel-stock-range.active').attr('data-range') || '3M');
        });
        $(document).on('click.reportEditor', '.js-kernel-stock-unit', function () {
            var $btn = $(this);
            var $body = $btn.closest('.js-kernel-stock-body');
            $body.find('.js-kernel-stock-unit').removeClass('active');
            $btn.addClass('active');
            renderKernelStockTally($body);
        });
        $(document).on('click.reportEditor', '.js-kernel-stock-range', function () {
            var $btn = $(this);
            var $body = $btn.closest('.js-kernel-stock-body');
            $body.find('.js-kernel-stock-range').removeClass('active');
            $btn.addClass('active');
            renderKernelStockChart($body, $btn.attr('data-range'));
        });
    }

    return {
        init: function () {
            _reportEditor.destroy();
            state.reportId = null;
            state.payload = null;
            state.pendingExecSummary = false;
            pendingOverrides.clear();
            pendingCommentary.clear();
            bindEvents();
            load();
        },

        destroy: function () {
            // Chart.js keeps a live reference to its canvas and to resize listeners; leaving one
            // behind would keep redrawing into a canvas belonging to whichever module loads next.
            destroyKernelStockCharts();
            $(document).off('.reportEditor');
        }
    };
}();

function initializeReportEditor() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _reportEditor.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}
