/**
 * Report PDF document-definition builder — turns a `get_report_instance` payload into a plain
 * pdfmake document-definition object. Pure function, no wiring: nothing in this repo loads this
 * file yet (see the plan that added it). No CDN tag, no button, no route.
 *
 * Namespace-assignment pattern only (see WebPortal/modules/sales-reports/js/report-metric-line.js,
 * WebPortal/js/ui-states.js, WebPortal/js/mac-status.js): this file has no reference to the DOM, to
 * any global rendering library, or to any UI framework helper at evaluation time, so it can be
 * evaluated with plain `vm.Script`/`require` and no browser.
 *
 * This file deliberately does NOT reuse report-metric-line.js's formatNumber/safeKey — those are
 * private to that module (WebPortal/modules/sales-reports/js/report_editor.js:168 is its only
 * consumer) and widening its exports is out of scope. This file has its own private number
 * formatter instead, so it has zero blast radius on anything that already ships.
 */
(function (w) {
    'use strict';

    var EM_DASH = '\u2014';

    function isFiniteNumber(v) {
        return typeof v === 'number' ? Number.isFinite(v) : Number.isFinite(Number(v)) && String(v).trim() !== '';
    }

    // Locale-independent number formatting so behaviour is identical in every browser/locale and in
    // the pure-Node verification harness. No toLocaleString/Intl.NumberFormat.
    function formatNumber(value) {
        var n = Number(value);
        var fixed = n.toFixed(2);
        var neg = fixed.charAt(0) === '-';
        if (neg) fixed = fixed.slice(1);
        var parts = fixed.split('.');
        parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return (neg ? '-' : '') + parts.join('.');
    }

    function formatMaybeNumber(v) {
        if (v === null || v === undefined) return '';
        if (!isFiniteNumber(v)) return '';
        return formatNumber(v);
    }

    // Normalises for display only — collapses runs of internal blanks. Never mutates the source
    // payload.
    function normSpace(x) {
        return String(x == null ? '' : x).replace(/\s+/g, ' ').trim();
    }

    function textOrEmpty(v) {
        if (v === null || v === undefined) return '';
        return String(v);
    }

    function sortByDisplayOrder(arr) {
        return arr.slice().sort(function (a, b) {
            var oa = parseInt(String(a && a.display_order != null ? a.display_order : '0'), 10);
            var ob = parseInt(String(b && b.display_order != null ? b.display_order : '0'), 10);
            if (!Number.isFinite(oa)) oa = 0;
            if (!Number.isFinite(ob)) ob = 0;
            return oa - ob;
        });
    }

    function formatSystemValue(metric) {
        var v = metric ? metric.system_value : null;
        if (v === null || v === undefined) return 'No system data';
        if (!isFiniteNumber(v)) return 'No system data';
        return formatNumber(v);
    }

    function formatEnteredValue(metric) {
        var v = metric ? metric.entered_value : null;
        if (v === null || v === undefined) return EM_DASH;
        if (!isFiniteNumber(v)) return EM_DASH;
        return formatNumber(v);
    }

    function formatTargetValue(metric) {
        var v = metric ? metric.target_value : null;
        if (v === null || v === undefined) return EM_DASH;
        if (!isFiniteNumber(v)) return EM_DASH;
        return formatNumber(v);
    }

    function formatAchievedPct(metric) {
        var m = metric || {};
        var target = m.target_value;
        var effective = m.effective_value;
        if (target === null || target === undefined) return EM_DASH;
        if (!isFiniteNumber(target) || Number(target) === 0) return EM_DASH;
        if (effective === null || effective === undefined) return EM_DASH;
        if (!isFiniteNumber(effective)) return EM_DASH;
        var pct = (Number(effective) / Number(target)) * 100;
        if (!Number.isFinite(pct)) return EM_DASH;
        return formatNumber(pct) + '%';
    }

    // ---- metric_table -------------------------------------------------------------------------

    function buildMetricTable(section) {
        var metrics = (section && Array.isArray(section.metrics)) ? section.metrics : [];
        var body = [
            [
                { text: 'Description', style: 'tableHeader' },
                { text: 'System', style: 'tableHeader' },
                { text: 'Entered', style: 'tableHeader' },
                { text: 'Target', style: 'tableHeader' },
                { text: 'Achieved %', style: 'tableHeader' }
            ]
        ];
        var footnotes = [];

        metrics.forEach(function (m) {
            var enteredCell = { text: formatEnteredValue(m) };
            if (m && m.is_overridden) {
                enteredCell.color = '#b45309';
                enteredCell.bold = true;
                footnotes.push(normSpace(m.label) + ': ' + normSpace(m.override_reason));
            }
            body.push([
                { text: normSpace(m ? m.label : ''), alignment: 'left' },
                { text: formatSystemValue(m), alignment: 'right' },
                Object.assign({ alignment: 'right' }, enteredCell),
                { text: formatTargetValue(m), alignment: 'right' },
                { text: formatAchievedPct(m), alignment: 'right' }
            ]);
        });

        var content = [
            {
                table: {
                    headerRows: 1,
                    widths: ['*', 'auto', 'auto', 'auto', 'auto'],
                    body: body
                },
                layout: 'lightHorizontalLines'
            }
        ];

        footnotes.forEach(function (note) {
            content.push({ text: note, style: 'footnote', margin: [0, 2, 0, 0] });
        });

        return content;
    }

    // ---- line_table -----------------------------------------------------------------------------

    var LINE_COLUMN_DEFS = {
        kernel_sales_line: [
            { key: 'sale_date', label: 'Date', numeric: false },
            { key: 'customer_name', label: 'Customer', numeric: false },
            { key: 'invoice_number', label: 'Invoice', numeric: false },
            { key: 'style_code', label: 'Style', numeric: false },
            { key: 'description', label: 'Description', numeric: false },
            { key: 'cartons', label: 'Cartons', numeric: true },
            { key: 'quantity_kg', label: 'Qty kg', numeric: true },
            { key: 'price_per_kg', label: 'Price/kg', numeric: true },
            { key: 'vat_excl_zar', label: 'Value excl VAT', numeric: true }
        ],
        oil_sales_line: [
            { key: 'sale_date', label: 'Date', numeric: false },
            { key: 'customer_name', label: 'Customer', numeric: false },
            { key: 'invoice_number', label: 'Invoice', numeric: false },
            { key: 'product_line', label: 'Product', numeric: false },
            { key: 'description', label: 'Description', numeric: false },
            { key: 'quantity_kg', label: 'Qty kg', numeric: true },
            { key: 'price_per_kg', label: 'Price/kg', numeric: true },
            { key: 'vat_excl_zar', label: 'Value excl VAT', numeric: true }
        ],
        // Export invoices are priced in USD and converted at the rate recorded on that invoice, so
        // this table carries both currencies. rand_value is deliberately named as the totalling
        // column below rather than vat_excl_zar — the register has no VAT concept (exports are
        // zero-rated), and reusing the local book's column name would imply one.
        oil_export_line: [
            { key: 'export_date', label: 'Date', numeric: false },
            { key: 'customer_name', label: 'Customer', numeric: false },
            { key: 'location_country', label: 'Country', numeric: false },
            { key: 'document_number', label: 'Document', numeric: false },
            { key: 'product_class', label: 'Product', numeric: false },
            { key: 'incoterm', label: 'Terms', numeric: false },
            { key: 'weight_kg', label: 'Qty kg', numeric: true },
            { key: 'price_per_kg_usd', label: 'Price $/kg', numeric: true },
            { key: 'usd_debit', label: 'Value $', numeric: true },
            { key: 'usd_zar_rate', label: 'Rate', numeric: true },
            { key: 'rand_value', label: 'Value R', numeric: true }
        ],
        kernel_sales_style_line: [
            { key: 'style_label', label: 'Style', numeric: false },
            { key: 'cartons', label: 'Cartons', numeric: true },
            { key: 'quantity_kg', label: 'Qty kg', numeric: true },
            { key: 'price_per_kg', label: 'Price/kg', numeric: true },
            { key: 'vat_excl_zar', label: 'Value excl VAT', numeric: true }
        ]
    };

    // Which numeric columns are meaningful to add up. Summing a price-per-kg or an exchange rate is
    // not a total, so those are left blank on the totals row.
    var TOTALLED_KEYS = { quantity_kg: true, vat_excl_zar: true, weight_kg: true, usd_debit: true, rand_value: true, cartons: true };

    function cellForColumn(col, payload) {
        var raw = payload ? payload[col.key] : null;
        if (col.numeric) {
            return { text: formatMaybeNumber(raw), alignment: 'right' };
        }
        return { text: textOrEmpty(raw), alignment: 'left' };
    }

    function buildRecognisedLineTable(lineType, columns, lines) {
        var headerRow = columns.map(function (col) {
            return { text: col.label, style: 'tableHeader' };
        });
        var body = [headerRow];

        var totalsByKey = {};
        columns.forEach(function (col) {
            if (col.numeric) totalsByKey[col.key] = 0;
        });

        lines.forEach(function (line) {
            var payload = (line && line.payload) || {};
            body.push(columns.map(function (col) {
                return cellForColumn(col, payload);
            }));
            columns.forEach(function (col) {
                if (col.numeric) {
                    var v = payload[col.key];
                    if (isFiniteNumber(v)) totalsByKey[col.key] += Number(v);
                }
            });
        });

        // Totals row: label in the first text column, and a total only for the columns TOTALLED_KEYS
        // says are additive. Price-per-kg and exchange-rate columns are left blank — summing them is
        // not a meaningful total.
        var totalsRow = columns.map(function (col, idx) {
            if (idx === 0) return { text: 'Total', bold: true, alignment: 'left' };
            if (TOTALLED_KEYS[col.key]) {
                return { text: formatNumber(totalsByKey[col.key]), bold: true, alignment: 'right' };
            }
            return { text: '' };
        });
        body.push(totalsRow);

        return [
            {
                table: {
                    headerRows: 1,
                    widths: columns.map(function () { return 'auto'; }).map(function (_, i, arr) {
                        // give the description-like columns more room than the rest
                        return i === arr.length - 5 || columns[i].key === 'description' ? '*' : 'auto';
                    }),
                    body: body
                },
                layout: 'lightHorizontalLines',
                fontSize: 8
            }
        ];
    }

    function buildUnrecognisedLineTable(lineType, count) {
        return [
            {
                table: {
                    headerRows: 1,
                    widths: ['*'],
                    body: [
                        [{ text: 'Rows', style: 'tableHeader' }],
                        [{ text: count + ' rows are not shown in this PDF.', italics: true }]
                    ]
                },
                layout: 'lightHorizontalLines'
            }
        ];
    }

    function buildEmptyLineTable() {
        return [
            {
                table: {
                    headerRows: 1,
                    widths: ['*'],
                    body: [
                        [{ text: 'Rows', style: 'tableHeader' }],
                        [{ text: 'No rows for this period.', italics: true }]
                    ]
                },
                layout: 'lightHorizontalLines'
            }
        ];
    }

    function buildLineTable(section) {
        var lines = (section && Array.isArray(section.lines)) ? section.lines : [];
        if (lines.length === 0) return buildEmptyLineTable();

        var lineType = lines[0] && lines[0].line_type;
        var columns = LINE_COLUMN_DEFS[lineType];
        if (!columns) {
            return buildUnrecognisedLineTable(lineType, lines.length);
        }
        return buildRecognisedLineTable(lineType, columns, lines);
    }

    // ---- tracking_table -------------------------------------------------------------------------
    // A tracking section compares this financial year against the previous one, cumulatively by
    // month. Rows arrive as line_type 'tracking_line' with row_kind in:
    //   current_month / current_month_cumulative — this period, above the grid
    //   month                                    — the twelve April-March cumulative rows
    //   total                                    — full-year totals
    // The two FY column headers come from the rows themselves (fy_prior / fy_current) rather than
    // being derived here, so the header can never disagree with the figures underneath it.

    // Year-on-year variance, already computed server-side as a ratio. NULL where the prior year was
    // zero or absent, which renders blank — the same blank Pete's workbook shows as #DIV/0!, and
    // deliberately not "0%", which would claim the two years were equal.
    function formatVariancePct(v) {
        if (v === null || v === undefined || !isFiniteNumber(v)) return '';
        return formatNumber(Number(v) * 100) + '%';
    }

    function buildTrackingTable(section) {
        var lines = (section && Array.isArray(section.lines)) ? section.lines : [];
        if (lines.length === 0) return buildEmptyLineTable();

        var first = (lines[0] && lines[0].payload) || {};
        var priorLabel = first.fy_prior != null ? 'FYE ' + normSpace(first.fy_prior) : 'Prior year';
        var currentLabel = first.fy_current != null ? 'FYE ' + normSpace(first.fy_current) : 'This year';

        var body = [[
            { text: 'Month', style: 'tableHeader' },
            { text: priorLabel, style: 'tableHeader' },
            { text: currentLabel, style: 'tableHeader' },
            { text: 'Variance', style: 'tableHeader' }
        ]];

        lines.forEach(function (line) {
            var p = (line && line.payload) || {};
            var isTotal = p.row_kind === 'total';
            var isCurrent = p.row_kind === 'current_month' || p.row_kind === 'current_month_cumulative';
            body.push([
                { text: textOrEmpty(p.label), alignment: 'left', bold: isTotal, italics: isCurrent },
                { text: formatMaybeNumber(p.prior_value), alignment: 'right', bold: isTotal },
                { text: formatMaybeNumber(p.current_value), alignment: 'right', bold: isTotal },
                { text: formatVariancePct(p.variance_pct), alignment: 'right', bold: isTotal }
            ]);
        });

        return [
            {
                table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto'], body: body },
                layout: 'lightHorizontalLines',
                fontSize: 8
            }
        ];
    }

    // ---- section dispatch -----------------------------------------------------------------------

    function buildSectionBody(section) {
        var kind = section ? section.render_kind : null;
        if (kind === 'metric_table') return buildMetricTable(section);
        if (kind === 'line_table') return buildLineTable(section);
        if (kind === 'tracking_table') return buildTrackingTable(section);
        // Unknown render_kind: be honest, do not claim anything about the data.
        return [{ text: 'Unrecognised section type: ' + normSpace(kind), italics: true }];
    }

    function buildSection(section) {
        var content = [];
        content.push({ text: normSpace(section.label), style: 'sectionHeading', margin: [0, 12, 0, 4] });

        var commentary = normSpace(section.commentary);
        if (commentary) {
            content.push({ text: commentary, style: 'commentary', margin: [0, 0, 0, 6] });
        }

        content = content.concat(buildSectionBody(section));
        return content;
    }

    // ---- overrides closing note -----------------------------------------------------------------

    function countOverrides(sections) {
        var total = 0;
        var overridden = 0;
        sections.forEach(function (section) {
            var metrics = (section && Array.isArray(section.metrics)) ? section.metrics : [];
            metrics.forEach(function (m) {
                total += 1;
                if (m && m.is_overridden) overridden += 1;
            });
        });
        return { overridden: overridden, total: total };
    }

    // ---- top-level document ---------------------------------------------------------------------

    function buildReportDocDefinition(report, opts) {
        var r = report || {};
        var options = opts || {};
        var generatedOn = options.generatedOn ? String(options.generatedOn) : '';

        var periodLabel = normSpace(r.period_label);
        var allSections = Array.isArray(r.sections) ? r.sections : [];
        var enabledSections = sortByDisplayOrder(allSections.filter(function (s) {
            return s && s.is_enabled === true;
        }));

        var content = [];

        // Title block.
        content.push({ text: normSpace(r.template_name), style: 'title', margin: [0, 0, 0, 2] });
        content.push({ text: periodLabel, style: 'subtitle', margin: [0, 0, 0, 2] });
        content.push({
            text: textOrEmpty(r.period_start) + ' \u2013 ' + textOrEmpty(r.period_end),
            style: 'subtitle',
            margin: [0, 0, 0, 2]
        });
        if (r.version && Number(r.version) > 1) {
            content.push({ text: 'Version ' + String(r.version), style: 'subtitle', margin: [0, 0, 0, 8] });
        } else {
            content.push({ text: '', margin: [0, 0, 0, 8] });
        }

        var execSummary = normSpace(r.executive_summary);
        if (execSummary) {
            content.push({ text: 'Executive Summary', style: 'sectionHeading', margin: [0, 8, 0, 4] });
            content.push({ text: execSummary, style: 'commentary', margin: [0, 0, 0, 8] });
        }

        enabledSections.forEach(function (section) {
            content = content.concat(buildSection(section));
        });

        var overrideCounts = countOverrides(enabledSections);
        if (overrideCounts.overridden > 0) {
            content.push({
                text: String(overrideCounts.overridden) + ' of ' + String(overrideCounts.total) +
                    ' figures in this report were entered manually.',
                style: 'closingNote',
                margin: [0, 12, 0, 0]
            });
        }

        var docDefinition = {
            pageSize: 'A4',
            pageMargins: [32, 70, 32, 40],
            header: function () {
                return {
                    columns: [
                        { text: 'Macavation', margin: [32, 20, 0, 0] },
                        { text: periodLabel, alignment: 'right', margin: [0, 20, 32, 0] }
                    ]
                };
            },
            footer: function (currentPage, pageCount) {
                var pageText = 'Page ' + String(currentPage) + ' of ' + String(pageCount);
                var genText = generatedOn ? (pageText + '  \u2014  Generated ' + generatedOn) : pageText;
                return { text: genText, alignment: 'center', margin: [0, 0, 0, 10], fontSize: 8 };
            },
            content: content,
            styles: {
                title: { fontSize: 18, bold: true },
                subtitle: { fontSize: 10, color: '#555555' },
                sectionHeading: { fontSize: 13, bold: true },
                commentary: { fontSize: 10, italics: true },
                tableHeader: { bold: true, fillColor: '#eeeeee' },
                footnote: { fontSize: 8, italics: true, color: '#b45309' },
                closingNote: { fontSize: 9, italics: true }
            }
        };

        if (r.status !== 'published') {
            docDefinition.watermark = { text: 'DRAFT', color: '#cccccc', opacity: 0.3 };
        }

        return docDefinition;
    }

    w.ReportPdfBuilder = {
        buildReportDocDefinition: buildReportDocDefinition,
        LINE_COLUMN_DEFS: LINE_COLUMN_DEFS,
        TOTALLED_KEYS: TOTALLED_KEYS
    };
})(typeof window !== 'undefined' ? window : this);
