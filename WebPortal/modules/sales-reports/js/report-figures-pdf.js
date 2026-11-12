/**
 * Management reports - the new-look PDF ("Reports v2"): ReportFiguresPdf.
 *
 *   ReportFiguresPdf.ensureLib()                      -> Promise (lazy-loads pdfmake + its fonts once)
 *   ReportFiguresPdf.build(viewPayload, images, parts) -> pdfmake docDefinition (pure, no DOM)
 *   ReportFiguresPdf.chartPlan(parts)                 -> [{spec, size:'full'|'half'}] (which charts the PDF draws, and how wide)
 *
 *   viewPayload = dataFunctions.getReportView(id): {instance, frozen, snapshot:{built_at, ...}}.
 *   images      = {<chartId>: {dataUrl, w, h}} or [{id, dataUrl, w, h}] from ReportFigures.chartImages.
 *   parts       = {top:{streams}, sections:{streams}|null, up:{streams}} - the same section models
 *                 report_view.js paints on screen (headline tiles, charts, the monthly parts, coming up),
 *                 so the PDF and the screen never disagree. report_view.js supplies it.
 *
 * pdfmake is ~2.7MB with its embedded fonts, so it is NOT in index.html: ensureLib() fetches it on first
 * use (same lazy <script> pattern as kernel_production_grid.js). vfs_fonts must load AFTER pdfmake.
 *
 * Colours come from ReportFigures.printColors(): a fixed LIGHT print palette (the print-palette exception
 * to "colours come from the tokens"), so a PDF never inherits dark mode. No colour literals live here.
 * Comparison lines use "+12%" / "-12%" text, never arrow glyphs (Roboto in pdfmake has no such glyphs).
 * Weights read 1,000.00 kg and rand reads R 1,234,567.
 */
(function (w) {
    'use strict';

    var DASH = '—';
    var MARGIN = 36;
    var PAGE_W = 595.28 - 2 * MARGIN;           // 523.28pt usable
    var FULL_FIT = [515, 202];                  // 840 x 330 image (CSS px -> ~7pt axis text)
    var HALF_FIT = [250, 149];                  // 420 x 250 image
    var WEEKLY_HALF_FIT = [250, 125];           // the same image, a little shorter, in the two-page weekly report
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // ------------------------------------------------------------------
    // pdfmake loader (moved here from report_editor.js).
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

    function ensureLib() {
        if (typeof pdfMake !== 'undefined' && pdfMake.vfs) return Promise.resolve();
        return loadScriptOnce(PDFMAKE_SRC, 'pdfmake')
            .then(function () { return loadScriptOnce(PDFFONTS_SRC, 'pdfmake-vfs'); });
    }

    // ------------------------------------------------------------------
    // Text and colour helpers.
    // ------------------------------------------------------------------

    function s(v) { return v == null ? '' : String(v); }

    // The dashboard formatters group thousands with spaces (en-ZA); the PDF reads 1,234,567.
    function fmt(v) {
        var t = s(v).replace(/[  ]/g, ' ');
        var prev;
        do { prev = t; t = t.replace(/(\d) (\d{3})(?!\d)/g, '$1,$2'); } while (t !== prev);
        return t;
    }

    var SAST_DAY = (typeof Intl !== 'undefined' && Intl.DateTimeFormat)
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }) : null;

    // Timestamps read as the South African calendar day; date-only strings are unchanged.
    function sastDay(iso) {
        var v = s(iso);
        if (v.length > 10 && SAST_DAY) {
            var d = new Date(v);
            if (!isNaN(d.getTime())) return SAST_DAY.format(d);
        }
        return v.slice(0, 10);
    }

    function prettyDate(iso) {
        if (!iso) return '';
        var p = sastDay(iso).split('-');
        if (p.length < 3 || !+p[1]) return s(iso);
        return (+p[2]) + ' ' + MONTHS[+p[1] - 1] + ' ' + p[0];
    }

    // CSS token (hex or rgb()) -> '#rrggbb'; anything else -> undefined (pdfmake then uses its default).
    function hex(c) {
        c = s(c).trim();
        if (/^#[0-9a-f]{6}$/i.test(c)) return c;
        if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.charAt(1) + c.charAt(1) + c.charAt(2) + c.charAt(2) + c.charAt(3) + c.charAt(3);
        var m = c.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
        if (!m) return undefined;
        function h2(n) { n = Math.max(0, Math.min(255, +n)); return (n < 16 ? '0' : '') + n.toString(16); }
        return '#' + h2(m[1]) + h2(m[2]) + h2(m[3]);
    }

    function palette() {
        var RFG = w.ReportFigures, c = {};
        try { c = (RFG && RFG.printColors && RFG.printColors()) || {}; } catch (e) { c = {}; }
        return { green: hex(c.green), tan: hex(c.tan), grid: hex(c.grid), muted: hex(c.muted), text: hex(c.text),
            headFill: hex(c.headFill), watermark: hex(c.watermark) };
    }

    function colorize(obj, color) { if (color) obj.color = color; return obj; }

    // ------------------------------------------------------------------
    // Chart plan: which charts the PDF draws and at what width. A chart in a 2+ column grid is drawn
    // two-up (half width); a chart alone in a 1-column grid is full width.
    // ------------------------------------------------------------------

    function eachSection(parts, fn) {
        ['top', 'sections', 'up'].forEach(function (k) {
            var blk = parts && parts[k];
            ((blk && blk.streams) || []).forEach(function (st) {
                (st.sections || []).forEach(function (sec) { fn(sec, st); });
            });
        });
    }

    function chartPlan(parts) {
        var out = [];
        eachSection(parts, function (sec) {
            (sec.grids || []).forEach(function (g) {
                (g.cards || []).forEach(function (c) {
                    if (c.chart && !c.chart.empty) out.push({ spec: c.chart, size: (g.cols || 1) >= 2 ? 'half' : 'full' });
                });
            });
        });
        return out;
    }

    function imageMap(images) {
        var map = {};
        if (Array.isArray(images)) images.forEach(function (i) { if (i && i.id) map[i.id] = i; });
        else if (images) Object.keys(images).forEach(function (k) { map[k] = images[k]; });
        return map;
    }

    // ------------------------------------------------------------------
    // Content pieces.
    // ------------------------------------------------------------------

    function tilesTable(tiles, pal) {
        var rows = [], i, j;
        function cell(t) {
            if (!t) return { text: '' };
            var stack = [
                colorize({ text: fmt(t.label), fontSize: 8 }, pal.muted),
                { text: fmt(t.value), fontSize: 14, bold: true, margin: [0, 2, 0, 2] }
            ];
            if (t.note) stack.push(colorize({ text: fmt(t.note), fontSize: 8 }, pal.muted));
            (t.lines || []).forEach(function (l) {
                stack.push(colorize({ text: fmt(l.text), fontSize: 8 }, l.tone === 'up' ? pal.green : l.tone === 'down' ? pal.tan : pal.muted));
            });
            return { stack: stack, margin: [4, 4, 4, 4] };
        }
        for (i = 0; i < tiles.length; i += 3) {
            var row = [];
            for (j = 0; j < 3; j++) row.push(cell(tiles[i + j]));
            rows.push(row);
        }
        return {
            table: { widths: ['*', '*', '*'], body: rows, dontBreakRows: true },
            layout: {
                hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0.5; },
                hLineColor: function () { return pal.grid; }, vLineColor: function () { return pal.grid; }
            },
            margin: [0, 0, 0, 8]
        };
    }

    // Column widths from the longest cell per column: numeric columns take their natural width, text
    // columns share what is left in proportion to theirs, so no column swallows the page.
    function columnWidths(heads, rows) {
        // pdfmake adds 4pt padding each side of every cell ON TOP of these widths, so the widths
        // must sum to the page width minus 8pt per column or the table runs past the right margin.
        var CH = 4.4, MAXTXT = 48;
        var avail = PAGE_W - 8 * heads.length - 2;
        var nat = heads.map(function (h, i) {
            var m = fmt(h.text).length;
            rows.forEach(function (r) { var l = fmt(r[i]).length; if (l > m) m = l; });
            return Math.max(18, Math.min(m, h.num ? 30 : MAXTXT) * CH);
        });
        var total = nat.reduce(function (a, b) { return a + b; }, 0);
        var txt = 0;
        heads.forEach(function (h, i) { if (!h.num) txt += nat[i]; });
        if (total > avail || !txt) {
            // Too wide (or all numeric): shrink every column in proportion.
            return nat.map(function (w) { return Math.floor(w * avail / total); });
        }
        // Room to spare: numbers keep their natural width, text columns share the surplus.
        var surplus = avail - total;
        return heads.map(function (h, i) {
            return Math.floor(h.num ? nat[i] : nat[i] + surplus * nat[i] / txt);
        });
    }

    // The title sits inside the table as a spanning header row (headerRows: 2), so it repeats with the
    // column heads when the table breaks across pages and can never be stranded at the foot of a page.
    function dataTable(tbl, pal, title) {
        var heads = tbl.heads || [];
        var n = Math.max(heads.length, 1);
        var titleRow = [{ text: fmt(title), fontSize: 9, bold: true, colSpan: n, margin: [0, 0, 0, 1] }];
        for (var k = 1; k < n; k++) titleRow.push({});
        var body = [titleRow, heads.map(function (h) {
            return { text: fmt(h.text), bold: true, fontSize: 8, alignment: h.num ? 'right' : 'left', fillColor: pal.headFill };
        })];
        function line(r, bold) {
            return heads.map(function (h, i) {
                return { text: fmt(r[i]), fontSize: 8, bold: !!bold, alignment: h.num ? 'right' : 'left' };
            });
        }
        (tbl.rows || []).forEach(function (r) { body.push(line(r, false)); });
        if (tbl.total) body.push(line(tbl.total, true));
        var widths = heads.length ? columnWidths(heads, (tbl.rows || []).concat(tbl.total ? [tbl.total] : [])) : ['*'];
        return {
            table: { headerRows: 2, dontBreakRows: true, widths: widths, body: body },
            layout: {
                hLineWidth: function (i) { return i === 1 ? 0 : 0.5; }, vLineWidth: function () { return 0; },
                hLineColor: function () { return pal.grid; }
            },
            margin: [0, 0, 0, 8]
        };
    }

    function chartBlock(card, size, imgs) {
        var im = imgs[card.chart.id];
        var fit = size === 'half' ? HALF_FIT : FULL_FIT;
        var stack = [{ text: fmt(card.title), fontSize: 9, bold: true, margin: [0, 0, 0, 2] }];
        if (im && im.dataUrl) stack.push({ image: im.dataUrl, fit: fit });
        else stack.push({ text: card.chart.empty ? 'Nothing to chart' : 'Chart not available', fontSize: 8, italics: true });
        return { stack: stack, width: size === 'half' ? 250 : '*' };
    }

    function gridBlocks(g, imgs, pal) {
        var out = [], buf = [];
        function flush() {
            if (!buf.length) return;
            if (buf.length === 1) out.push({ columns: [buf[0], { text: '', width: '*' }], columnGap: 15, margin: [0, 0, 0, 8], unbreakable: true });
            else out.push({ columns: buf.slice(0, 2), columnGap: 15, margin: [0, 0, 0, 8], unbreakable: true });
            buf = [];
        }
        (g.cards || []).forEach(function (c) {
            if (c.chart) {
                if ((g.cols || 1) >= 2) {
                    buf.push(chartBlock(c, 'half', imgs));
                    if (buf.length === 2) flush();
                } else {
                    flush();
                    var b = chartBlock(c, 'full', imgs);
                    out.push({ stack: b.stack, margin: [0, 0, 0, 8], unbreakable: true });
                }
            } else if (c.table) {
                flush();
                out.push(dataTable(c.table, pal, c.title));
            }
        });
        flush();
        return out;
    }

    function sectionBlocks(sec, imgs, pal) {
        var out = [];
        var head = (sec.num ? sec.num + ' ' : '') + sec.title;
        var htxt = [{ text: fmt(head) }];
        if (sec.src) htxt.push(colorize({ text: '  ' + fmt(sec.src), fontSize: 8, bold: false }, pal.muted));
        out.push({ text: htxt, fontSize: 11, bold: true, margin: [0, 8, 0, 4], headlineLevel: 1 });
        if (sec.notice && sec.notice.text) out.push(colorize({ text: fmt(sec.notice.text), fontSize: 8, italics: true, margin: [0, 0, 0, 4] }, pal.muted));
        if (sec.tiles && sec.tiles.length) out.push(tilesTable(sec.tiles, pal));
        if (sec.source) out.push(colorize({ text: fmt(sec.source), fontSize: 8, margin: [0, 0, 0, 4] }, pal.muted));
        (sec.grids || []).forEach(function (g) { gridBlocks(g, imgs, pal).forEach(function (b) { out.push(b); }); });
        if (sec.gap) out.push({ text: [{ text: 'Not captured today: ', bold: true }, { text: fmt(sec.gap) }], fontSize: 8, margin: [0, 0, 0, 4] });
        if (sec.fine) out.push(colorize({ text: fmt(sec.fine), fontSize: 7, italics: true, margin: [0, 0, 0, 4] }, pal.muted));
        return out;
    }

    function streamBlocks(blk, imgs, pal) {
        var out = [];
        ((blk && blk.streams) || []).forEach(function (st) {
            if (st.title) {
                // Title and sub-line are ONE node so pageBreakBefore sees a single heading.
                var runs = [{ text: fmt(st.title) }];
                if (st.sub) runs.push(colorize({ text: '\n' + fmt(st.sub), fontSize: 8, bold: false }, pal.muted));
                out.push(colorize({ text: runs, fontSize: 14, bold: true, margin: [0, 14, 0, 2], headlineLevel: 1 }, pal.green));
            }
            (st.sections || []).forEach(function (sec) { sectionBlocks(sec, imgs, pal).forEach(function (b) { out.push(b); }); });
        });
        return out;
    }

    // ------------------------------------------------------------------
    // Weekly report v2: exactly one page per stream (Kernel Processing, then Oil Processing), plain like
    // Mike's workbook - logo, title, dates, then compact tables and two charts. parts.weekly is set by
    // report_view.js; parts.up ("coming up") is screen-only and left out. Sections carry no headlineLevel,
    // so pageBreakBefore never moves anything: the only break is the one before the Oil page.
    // ------------------------------------------------------------------

    function weeklyHeader(st, inst, parts, pal, first) {
        var color = st.key === 'oil' ? pal.tan : pal.green;
        var mark = parts.logo
            ? { image: parts.logo, fit: [54, 54], width: 60 }
            : colorize({ text: 'MACAVATION', fontSize: 12, bold: true, width: 100, margin: [0, 14, 0, 0] }, color);
        var dates = [];
        if (inst.period_start) dates.push({ text: [{ text: 'Start date: ', bold: true }, { text: prettyDate(inst.period_start) }], fontSize: 9 });
        if (inst.period_end) dates.push({ text: [{ text: 'End date: ', bold: true }, { text: prettyDate(inst.period_end) }], fontSize: 9 });
        if (inst.period_label) dates.push(colorize({ text: fmt(inst.period_label), fontSize: 8 }, pal.muted));
        var node = {
            columns: [
                mark,
                { stack: [
                    { text: 'Macavation Weekly Report', fontSize: 16, bold: true },
                    colorize({ text: fmt(st.title), fontSize: 13, bold: true, margin: [0, 2, 0, 0] }, color)
                ], width: '*', margin: [8, 4, 0, 0] },
                { stack: dates, width: 'auto', alignment: 'right', margin: [0, 6, 0, 0] }
            ],
            columnGap: 6,
            margin: [0, 0, 0, 4]
        };
        if (!first) node.pageBreak = 'before';
        return [node, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: PAGE_W, y2: 0, lineWidth: 1.2, lineColor: color }], margin: [0, 0, 0, 8] }];
    }

    function weeklySectionBlocks(sec, imgs, pal) {
        var out = [];
        out.push(colorize({ text: fmt(sec.title).toUpperCase(), fontSize: 9, bold: true, margin: [0, 4, 0, 3] }, sec.oil ? pal.tan : pal.green));
        if (sec.notice && sec.notice.text) out.push(colorize({ text: fmt(sec.notice.text), fontSize: 8, italics: true, margin: [0, 0, 0, 3] }, pal.muted));
        if (sec.tiles && sec.tiles.length) out.push(tilesTable(sec.tiles, pal));
        (sec.grids || []).forEach(function (g) {
            gridBlocks(g, imgs, pal).forEach(function (b) {
                // The card title repeats the section heading: drop the table's spanning title row, and
                // tighten the rows so each stream fits on one A4 page.
                if (b.table && b.table.headerRows === 2) {
                    b.table.body.shift();
                    b.table.headerRows = 1;
                    b.layout.hLineWidth = function () { return 0.5; };
                    b.layout.paddingTop = function () { return 1; };
                    b.layout.paddingBottom = function () { return 1; };
                }
                // Charts two-up, a little shorter than in the monthly report.
                (b.columns || []).forEach(function (c) {
                    (c.stack || []).forEach(function (n) { if (n.image) n.fit = WEEKLY_HALF_FIT; });
                });
                b.margin = [0, 0, 0, 4];
                out.push(b);
            });
        });
        if (sec.source) out.push({ text: fmt(sec.source), fontSize: 8, bold: true, margin: [0, 0, 0, 3] });
        if (sec.fine) out.push(colorize({ text: fmt(sec.fine), fontSize: 7, italics: true, margin: [0, 0, 0, 3] }, pal.muted));
        return out;
    }

    function buildWeekly(view, imgs, parts, pal) {
        var inst = view.instance || {};
        var content = [];
        var summary = s(inst.executive_summary).trim();
        ((parts.top && parts.top.streams) || []).forEach(function (st, i) {
            weeklyHeader(st, inst, parts, pal, i === 0).forEach(function (b) { content.push(b); });
            if (i === 0 && summary) content.push({ text: summary, fontSize: 8, margin: [0, 0, 0, 6] });
            (st.sections || []).forEach(function (sec) {
                weeklySectionBlocks(sec, imgs, pal).forEach(function (b) { content.push(b); });
            });
        });
        return content;
    }

    // ------------------------------------------------------------------
    // build()
    // ------------------------------------------------------------------

    function build(view, images, parts) {
        view = view || {};
        var inst = view.instance || {};
        var snap = view.snapshot || {};
        var monthly = inst.period_type === 'monthly';
        var draft = inst.status === 'draft';
        var pal = palette();
        var imgs = imageMap(images);
        parts = parts || (w._reportView && w._reportView.parts ? w._reportView.parts(view) : null) || {};

        var content = [];
        content.push({ text: monthly ? 'Macavation monthly report' : 'Macavation weekly update', fontSize: 20, bold: true });
        content.push(colorize({ text: fmt(inst.period_label || DASH), fontSize: 12, margin: [0, 2, 0, 0] }, pal.green));
        var status = draft ? 'Draft' : (inst.status === 'published' ? 'Published' : s(inst.status));
        var bits = [status];
        if (inst.period_start && inst.period_end) bits.push(prettyDate(inst.period_start) + ' to ' + prettyDate(inst.period_end));
        if (!draft && inst.version != null) bits.push('version ' + inst.version);
        content.push(colorize({ text: bits.join(' · '), fontSize: 9, margin: [0, 2, 0, 8] }, pal.muted));

        var summary = s(inst.executive_summary).trim();
        if (summary) {
            content.push({ text: 'Executive summary', fontSize: 11, bold: true, margin: [0, 4, 0, 3], headlineLevel: 1 });
            content.push({ text: summary, fontSize: 9, margin: [0, 0, 0, 6] });
        }

        [parts.top, parts.sections, parts.up].forEach(function (blk) {
            streamBlocks(blk, imgs, pal).forEach(function (b) { content.push(b); });
        });
        // The two-page weekly report replaces all of the above.
        if (parts.weekly) content = buildWeekly(view, imgs, parts, pal);

        var whenIso = inst.published_at || snap.built_at || '';
        var when = whenIso ? prettyDate(whenIso) : prettyDate(new Date().toISOString());
        var footText = view.frozen
            ? 'Figures frozen ' + when + ' · version ' + (inst.version != null ? inst.version : DASH)
            : 'Draft figures, ' + when;

        var doc = {
            pageSize: 'A4',
            pageMargins: [MARGIN, MARGIN, MARGIN, 48],
            defaultStyle: { fontSize: 9, color: pal.text },
            // pdfmake 0.2 ignores keepWithNext: a heading (headlineLevel 1) left last on a page moves to the next.
            pageBreakBefore: function (node, followingNodesOnPage) {
                // Also move a heading that lands in the bottom fifth of a page: with only a line or
                // two of its section under it, it reads as stranded.
                if (node.headlineLevel !== 1) return false;
                if (followingNodesOnPage.length === 0) return true;
                var pos = node.startPosition || {};
                return pos.pageInnerHeight > 0 && pos.top > pos.pageInnerHeight * 0.8;
            },
            content: content,
            footer: function (currentPage, pageCount) {
                return {
                    margin: [MARGIN, 14, MARGIN, 0],
                    columns: [
                        colorize({ text: footText, fontSize: 8 }, pal.muted),
                        colorize({ text: 'Page ' + currentPage + ' of ' + pageCount, fontSize: 8, alignment: 'right' }, pal.muted)
                    ]
                };
            }
        };
        if (draft) {
            doc.watermark = { text: 'DRAFT', opacity: 0.3, bold: true };
            if (pal.watermark) doc.watermark.color = pal.watermark;
        }
        return doc;
    }

    w.ReportFiguresPdf = { ensureLib: ensureLib, build: build, chartPlan: chartPlan, _fmt: fmt };
})(typeof window !== 'undefined' ? window : this);
