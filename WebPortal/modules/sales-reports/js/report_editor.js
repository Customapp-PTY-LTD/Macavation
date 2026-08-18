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
        var versionNum = Number(payload.version);
        if (Number.isFinite(versionNum) && versionNum > 0) {
            text += ' Version ' + versionNum + '.';
        }
        var sha = payload.content_sha256;
        if (typeof sha === 'string' && sha.trim() !== '') {
            text += ' Content fingerprint ' + sha.slice(0, 12) + '.';
        }
        $banner.text(text).removeClass('d-none');
    }

    // ------------------------------------------------------------------
    // Publish / re-issue button visibility — class toggling only. Toggling the d-none class can
    // never clear the inline display style actionAccess.apply sets on a permission-denied
    // control, so this is the only safe way to drive visibility here.
    // ------------------------------------------------------------------

    function updatePublishControls(payload) {
        var status = payload && payload.status;
        $('#reportEditorPublishBtn').toggleClass('d-none', status !== 'draft');
        $('#reportEditorReissueBtn').toggleClass('d-none', status !== 'published');
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

    function buildNoRowsBody() {
        // A connected section that simply had nothing in this period. Distinct from the message
        // above: "no rows" is a fact about the period, "not available yet" is a fact about the
        // feature, and conflating them would tell Pete a quiet week was a broken report.
        return $(macEmptyState('fa-table', 'No rows', 'Nothing was captured for this period.'));
    }

    // ------------------------------------------------------------------
    // line_table / tracking_table rendering.
    //
    // Column definitions are intentionally duplicated from report-pdf-builder.js rather than
    // imported: that file is not on this route's script list (appRouteConfig.json) and is not
    // loaded in the browser at all yet, so depending on it would leave every table blank. When the
    // PDF export is wired up, the two lists should be unified — until then this is the only
    // definition that actually renders.
    // ------------------------------------------------------------------

    var LINE_COLUMN_DEFS = {
        kernel_sales_line: [
            { key: 'sale_date', label: 'Date' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'invoice_number', label: 'Invoice' },
            { key: 'style_code', label: 'Style' },
            { key: 'description', label: 'Description' },
            { key: 'cartons', label: 'Cartons', numeric: true },
            { key: 'quantity_kg', label: 'Qty kg', numeric: true },
            { key: 'price_per_kg', label: 'Price/kg', numeric: true },
            { key: 'vat_excl_zar', label: 'Value excl VAT', numeric: true }
        ],
        oil_sales_line: [
            { key: 'sale_date', label: 'Date' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'invoice_number', label: 'Invoice' },
            { key: 'product_line', label: 'Product' },
            { key: 'description', label: 'Description' },
            { key: 'quantity_kg', label: 'Qty kg', numeric: true },
            { key: 'price_per_kg', label: 'Price/kg', numeric: true },
            { key: 'vat_excl_zar', label: 'Value excl VAT', numeric: true }
        ],
        oil_export_line: [
            { key: 'export_date', label: 'Date' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'location_country', label: 'Country' },
            { key: 'document_number', label: 'Document' },
            { key: 'product_class', label: 'Product' },
            { key: 'incoterm', label: 'Terms' },
            { key: 'weight_kg', label: 'Qty kg', numeric: true },
            { key: 'price_per_kg_usd', label: 'Price $/kg', numeric: true },
            { key: 'usd_debit', label: 'Value $', numeric: true },
            { key: 'usd_zar_rate', label: 'Rate', numeric: true },
            { key: 'rand_value', label: 'Value R', numeric: true }
        ],
        kernel_sales_style_line: [
            { key: 'style_label', label: 'Style' },
            { key: 'cartons', label: 'Cartons', numeric: true },
            { key: 'quantity_kg', label: 'Qty kg', numeric: true },
            { key: 'price_per_kg', label: 'Price/kg', numeric: true },
            { key: 'vat_excl_zar', label: 'Value excl VAT', numeric: true }
        ]
    };

    // Additive columns only. A summed price-per-kg or exchange rate is not a total.
    var TOTALLED_KEYS = {
        quantity_kg: true, vat_excl_zar: true, weight_kg: true,
        usd_debit: true, rand_value: true, cartons: true
    };

    // Sections whose server-side resolver exists (see populate_report_instance_lines). Only these
    // may report "no rows for this period" when they come back empty — for any other section an
    // empty result means the data source is not connected yet, and saying "nothing was captured"
    // would assert a fact about the business that the database cannot support.
    var CONNECTED_SECTIONS = {
        kernel_sales_lines: true,
        oil_sales_lines: true,
        oil_export_lines: true,
        kernel_sales_by_style: true,
        nis_procurement_tracking: true,
        sound_kernel_recovery_tracking: true,
        kernel_sales_tracking: true
    };

    function isFiniteNum(v) {
        if (v === null || v === undefined || String(v).trim() === '') return false;
        return Number.isFinite(Number(v));
    }

    // Locale-independent, matching report-pdf-builder.js so the on-screen table and the PDF cannot
    // print the same figure differently.
    function fmtNum(v) {
        if (!isFiniteNum(v)) return '';
        var fixed = Number(v).toFixed(2);
        var neg = fixed.charAt(0) === '-';
        if (neg) fixed = fixed.slice(1);
        var parts = fixed.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + parts.join('.');
    }

    function fmtPct(v) {
        if (!isFiniteNum(v)) return '';
        return fmtNum(Number(v) * 100) + '%';
    }

    function buildLineTableBody(section) {
        var lines = Array.isArray(section.lines) ? section.lines : [];
        if (lines.length === 0) {
            return CONNECTED_SECTIONS[section.section_key] ? buildNoRowsBody() : buildEmptyRenderKindBody();
        }

        var lineType = lines[0] && lines[0].line_type;
        var columns = LINE_COLUMN_DEFS[lineType];
        if (!columns) {
            // Rows exist but this build does not know their shape. Say so rather than drop them.
            return $(macEmptyState('fa-circle-question', 'Rows not displayable',
                'This section returned rows in a format this screen does not recognise.'));
        }

        var $table = $('<table>', { 'class': 'table table-sm table-hover align-middle mb-0' });
        var $headRow = $('<tr>');
        columns.forEach(function (col) {
            $headRow.append($('<th>', { 'class': col.numeric ? 'text-end' : null }).text(col.label));
        });
        $table.append($('<thead>').append($headRow));

        var totals = {};
        var $tbody = $('<tbody>');
        lines.forEach(function (line) {
            var payload = (line && line.payload) || {};
            var $tr = $('<tr>');
            columns.forEach(function (col) {
                var raw = payload[col.key];
                if (col.numeric) {
                    if (TOTALLED_KEYS[col.key] && isFiniteNum(raw)) {
                        totals[col.key] = (totals[col.key] || 0) + Number(raw);
                    }
                    $tr.append($('<td>', { 'class': 'text-end' }).text(fmtNum(raw)));
                } else {
                    $tr.append($('<td>').text(raw == null ? '' : String(raw)));
                }
            });
            $tbody.append($tr);
        });
        $table.append($tbody);

        var $totalRow = $('<tr>', { 'class': 'fw-bold border-top' });
        columns.forEach(function (col, idx) {
            if (idx === 0) { $totalRow.append($('<td>').text('Total')); return; }
            if (TOTALLED_KEYS[col.key]) {
                $totalRow.append($('<td>', { 'class': 'text-end' }).text(fmtNum(totals[col.key] || 0)));
                return;
            }
            $totalRow.append($('<td>'));
        });
        $table.append($('<tfoot>').append($totalRow));

        return $('<div>', { 'class': 'table-responsive' }).append($table);
    }

    function buildTrackingTableBody(section) {
        var lines = Array.isArray(section.lines) ? section.lines : [];
        if (lines.length === 0) {
            return CONNECTED_SECTIONS[section.section_key] ? buildNoRowsBody() : buildEmptyRenderKindBody();
        }

        var first = (lines[0] && lines[0].payload) || {};
        var priorLabel = first.fy_prior != null ? 'FYE ' + String(first.fy_prior) : 'Prior year';
        var currentLabel = first.fy_current != null ? 'FYE ' + String(first.fy_current) : 'This year';

        var $table = $('<table>', { 'class': 'table table-sm table-hover align-middle mb-0' });
        $table.append($('<thead>').append($('<tr>')
            .append($('<th>').text('Month'))
            .append($('<th>', { 'class': 'text-end' }).text(priorLabel))
            .append($('<th>', { 'class': 'text-end' }).text(currentLabel))
            .append($('<th>', { 'class': 'text-end' }).text('Variance'))));

        var $tbody = $('<tbody>');
        lines.forEach(function (line) {
            var p = (line && line.payload) || {};
            var isTotal = p.row_kind === 'total';
            var isCurrent = p.row_kind === 'current_month' || p.row_kind === 'current_month_cumulative';
            var cls = isTotal ? 'fw-bold border-top' : (isCurrent ? 'fst-italic text-body-secondary' : null);
            $tbody.append($('<tr>', { 'class': cls })
                .append($('<td>').text(p.label == null ? '' : String(p.label)))
                .append($('<td>', { 'class': 'text-end' }).text(fmtNum(p.prior_value)))
                .append($('<td>', { 'class': 'text-end' }).text(fmtNum(p.current_value)))
                .append($('<td>', { 'class': 'text-end' }).text(fmtPct(p.variance_pct))));
        });
        $table.append($tbody);

        return $('<div>', { 'class': 'table-responsive' }).append($table);
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
        } else if (section.render_kind === 'line_table') {
            $body.append(buildLineTableBody(section));
        } else if (section.render_kind === 'tracking_table') {
            $body.append(buildTrackingTableBody(section));
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

        var $targetsLink = $('<a>', {
            href: '#',
            'class': 'small js-section-edit-targets d-inline-block mt-2'
        }).attr('data-section-key', sectionKey);
        $targetsLink.append($('<i>', { 'class': 'fas fa-bullseye me-1' }));
        $targetsLink.append(document.createTextNode('Edit targets for this period'));
        $body.append($targetsLink);

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
        updatePublishControls(payload);

        var $summary = $('#reportEditorExecSummary');
        var summaryVal = payload.executive_summary == null ? '' : String(payload.executive_summary);
        $summary.val(summaryVal);
        $summary.data('lastValue', summaryVal);
        $summary.prop('disabled', !isEditable);

        $('#reportEditorRefreshFiguresBtn').prop('disabled', !statusDraft);
        // Export is available for any loaded report, draft or published — unlike refresh, it
        // changes nothing. It stays disabled until a payload exists so a failed load presents a
        // dead button rather than one that silently does nothing.
        $('#reportEditorDownloadPdfBtn').prop('disabled', false);

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

    // Used after publish and after re-issue, where the on-screen report's editability has changed.
    // A failed reload must not leave a stale, wrongly-editable screen behind — unlike
    // reloadAndRerender() above, this routes back to the list on failure rather than logging and
    // leaving the DOM as-is. It reads state.reportId at call time, so callers must assign
    // state.reportId before calling this (re-issue assigns the new report's id first).
    function reloadAfterLockChange() {
        if (!state.reportId) return Promise.resolve();
        return dataFunctions.getReportInstance(state.reportId, null, true).then(function (fresh) {
            if (!fresh) {
                showEmptyState('fa-file-invoice', 'Report not found', 'This report could not be found. It may have been deleted.');
                return;
            }
            state.payload = fresh;
            renderPayload(fresh);
        }).catch(function (err) {
            console.warn('[sales-reports] could not reload report after publish/re-issue', err);
            Swal.fire({
                icon: 'warning',
                title: 'Saved, but not reloaded',
                text: 'The change was saved but this screen could not be refreshed. Reopen the report from the list.'
            });
            routeBackToList();
        });
    }

    // ------------------------------------------------------------------
    // Publish / re-issue.
    //
    // publish_report_instance performs no permission check of its own (granted to
    // anon/authenticated/service_role) — the DOM gate is the only gate, so both handlers below
    // re-check hasAction('reports.report.publish') and fail closed before calling anything.
    //
    // Naming discipline (mandatory): each handler holds two different objects — the SweetAlert
    // dialog result and the RPC result — bound under different identifiers. firstRpcRow/
    // isRpcSuccess/rpcError may be called only on the RPC result, never on the dialog result.
    // ------------------------------------------------------------------

    function handlePublish() {
        if (typeof hasAction !== 'function' || !hasAction('reports.report.publish')) {
            Swal.fire({ icon: 'warning', title: 'Not permitted', text: 'You do not have permission for this action.' });
            return;
        }
        if (!state.reportId) return;

        Swal.fire({
            icon: 'question',
            title: 'Publish this report?',
            text: 'Figures will be locked. Corrections after this create a new version.',
            showCancelButton: true
        }).then(function (confirmed) {
            if (!confirmed.isConfirmed) return;

            return dataFunctions.publishReportInstance(state.reportId).then(function (rpcResult) {
                if (!isRpcSuccess(rpcResult)) {
                    Swal.fire({ icon: 'error', title: 'Could not publish', text: rpcError(rpcResult, 'Could not publish this report.') });
                    return;
                }
                return reloadAfterLockChange();
            });
        }).catch(function (err) {
            console.warn('[sales-reports] publishReportInstance failed', err);
            Swal.fire({ icon: 'error', title: 'Could not publish', text: 'Could not publish this report. Please try again.' });
        });
    }

    function handleReissue() {
        if (typeof hasAction !== 'function' || !hasAction('reports.report.publish')) {
            Swal.fire({ icon: 'warning', title: 'Not permitted', text: 'You do not have permission for this action.' });
            return;
        }
        if (!state.reportId) return;

        Swal.fire({
            input: 'text',
            inputLabel: 'Why is this report being re-issued?',
            inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
            showCancelButton: true
        }).then(function (reasonPrompt) {
            if (!reasonPrompt.isConfirmed) return;

            return dataFunctions.supersedeReportInstance(state.reportId, reasonPrompt.value).then(function (rpcResult) {
                if (!isRpcSuccess(rpcResult)) {
                    Swal.fire({ icon: 'error', title: 'Could not re-issue', text: rpcError(rpcResult, 'Could not re-issue this report.') });
                    return;
                }
                var newId = (firstRpcRow(rpcResult) || {}).new_report_instance_id;
                if (!isReportUuid(newId)) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Re-issued, but could not open the new version',
                        text: 'The new version was created. Reopen it from the report list.'
                    });
                    routeBackToList();
                    return;
                }
                if (typeof Session !== 'undefined' && Session.set) Session.set('currentReportId', newId);
                state.reportId = newId;
                return reloadAfterLockChange();
            });
        }).catch(function (err) {
            console.warn('[sales-reports] supersedeReportInstance failed', err);
            Swal.fire({ icon: 'error', title: 'Could not re-issue', text: 'Could not re-issue this report. Please try again.' });
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
    // PDF export.
    //
    // pdfmake is ~2.7MB with its embedded font file, so it is NOT added to index.html alongside the
    // portal's other CDN libraries — that would charge every page load for a button most visits
    // never press. It is fetched on first click, using the same lazy <script> pattern as
    // kernel_production_grid.js / stock_management_grid.js. vfs_fonts must load AFTER pdfmake: it
    // assigns into the pdfMake global.
    // ------------------------------------------------------------------

    var PDFMAKE_SRC = 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js';
    var PDFFONTS_SRC = 'https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js';

    function loadScriptOnce(src, marker) {
        return new Promise(function (resolve, reject) {
            var existing = document.querySelector('script[data-mac-lib="' + marker + '"]');
            if (existing) {
                if (existing.getAttribute('data-mac-loaded') === '1') { resolve(); return; }
                existing.addEventListener('load', function () { resolve(); });
                existing.addEventListener('error', function () { reject(new Error(marker)); });
                return;
            }
            var el = document.createElement('script');
            el.src = src;
            el.setAttribute('data-mac-lib', marker);
            el.onload = function () { el.setAttribute('data-mac-loaded', '1'); resolve(); };
            el.onerror = function () {
                if (el.parentNode) el.parentNode.removeChild(el);
                reject(new Error(marker));
            };
            document.head.appendChild(el);
        });
    }

    function ensurePdfMake() {
        if (typeof pdfMake !== 'undefined' && pdfMake.vfs) return Promise.resolve();
        return loadScriptOnce(PDFMAKE_SRC, 'pdfmake')
            .then(function () { return loadScriptOnce(PDFFONTS_SRC, 'pdfmake-vfs'); });
    }

    // Filename from the report's own period label, so a downloaded file is identifiable offline.
    // Anything that is not a letter, digit or dash becomes a dash — the label is user-facing text
    // and must never reach the filesystem verbatim.
    function pdfFileName(payload) {
        var base = displayLabel(payload && payload.period_label) || 'report';
        var safe = base.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        return 'Macavation-' + (safe || 'report') + '.pdf';
    }

    function handleDownloadPdf() {
        if (!state.payload) return;
        var $btn = $('#reportEditorDownloadPdfBtn');
        $btn.prop('disabled', true);
        ensurePdfMake().then(function () {
            if (typeof ReportPdfBuilder === 'undefined' || !ReportPdfBuilder.buildReportDocDefinition) {
                throw new Error('builder-missing');
            }
            var docDefinition = ReportPdfBuilder.buildReportDocDefinition(state.payload);
            pdfMake.createPdf(docDefinition).download(pdfFileName(state.payload));
        }).catch(function (err) {
            console.warn('[sales-reports] PDF export failed', err);
            Swal.fire({
                icon: 'error',
                title: 'Could not build the PDF',
                text: 'The PDF library could not be loaded. Check your connection and try again.'
            });
        }).finally(function () {
            $btn.prop('disabled', false);
        });
    }

    // ------------------------------------------------------------------
    // Event wiring — every binding namespaced ".reportEditor"; destroy() removes them all.
    // ------------------------------------------------------------------

    function bindEvents() {
        $(document).on('click.reportEditor', '#reportEditorDownloadPdfBtn', function () {
            handleDownloadPdf();
        });
        $(document).on('click.reportEditor', '#reportEditorBackBtn', function (e) {
            e.preventDefault();
            routeBackToList();
        });
        $(document).on('click.reportEditor', '.js-section-edit-targets', function (e) {
            e.preventDefault();
            if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
                _appRouter.routeTo('report-targets-grid', true);
            }
        });
        $(document).on('click.reportEditor', '#reportEditorRefreshFiguresBtn', function () {
            handleRefreshFigures();
        });
        $(document).on('click.reportEditor', '#reportEditorPublishBtn', function () { handlePublish(); });
        $(document).on('click.reportEditor', '#reportEditorReissueBtn', function () { handleReissue(); });
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
