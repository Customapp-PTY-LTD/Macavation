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
 * Colours come from MgmtDashboard.colors() (the --mac-* tokens, read lazily at build time). No colour
 * literals live here: the page and chart background is white by definition (the default pdfmake page).
 * Comparison lines use "+12%" / "-12%" text, never arrow glyphs (Roboto in pdfmake has no such glyphs).
 * Weights read 1,000.00 kg and rand reads R 1,234,567.
 */
(function (w) {
    'use strict';

    var DASH = '—';
    var MARGIN = 36;
    var PAGE_W = 595.28 - 2 * MARGIN;           // 523.28pt usable
    var FULL_FIT = [515, 206];                  // 1000 x 400 image
    var HALF_FIT = [250, 150];                  // 600 x 360 image
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

    function prettyDate(iso) {
        if (!iso) return '';
        var p = s(iso).slice(0, 10).split('-');
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
        var M = w.MgmtDashboard, c = {};
        try { c = (M && M.colors && M.colors()) || {}; } catch (e) { c = {}; }
        return { green: hex(c.green), tan: hex(c.tan), grid: hex(c.grid), muted: hex(c.text) };
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

    function dataTable(tbl, pal) {
        var heads = tbl.heads || [];
        var body = [heads.map(function (h) {
            return { text: fmt(h.text), bold: true, fontSize: 8, alignment: h.num ? 'right' : 'left', fillColor: pal.grid };
        })];
        function line(r, bold) {
            return heads.map(function (h, i) {
                return { text: fmt(r[i]), fontSize: 8, bold: !!bold, alignment: h.num ? 'right' : 'left' };
            });
        }
        (tbl.rows || []).forEach(function (r) { body.push(line(r, false)); });
        if (tbl.total) body.push(line(tbl.total, true));
        var widths = heads.map(function (h, i) { return i === 0 ? '*' : 'auto'; });
        if (!widths.length) widths = ['*'];
        return {
            table: { headerRows: 1, dontBreakRows: true, widths: widths, body: body },
            layout: {
                hLineWidth: function () { return 0.5; }, vLineWidth: function () { return 0; },
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
                out.push({ text: fmt(c.title), fontSize: 9, bold: true, margin: [0, 0, 0, 2], keepWithNext: true });
                out.push(dataTable(c.table, pal));
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
        out.push({ text: htxt, fontSize: 11, bold: true, margin: [0, 8, 0, 4], keepWithNext: true });
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
                out.push(colorize({ text: fmt(st.title), fontSize: 14, bold: true, margin: [0, 14, 0, 0], keepWithNext: true }, pal.green));
                if (st.sub) out.push(colorize({ text: fmt(st.sub), fontSize: 8, margin: [0, 0, 0, 2], keepWithNext: true }, pal.muted));
            }
            (st.sections || []).forEach(function (sec) { sectionBlocks(sec, imgs, pal).forEach(function (b) { out.push(b); }); });
        });
        return out;
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
            content.push({ text: 'Executive summary', fontSize: 11, bold: true, margin: [0, 4, 0, 3] });
            content.push({ text: summary, fontSize: 9, margin: [0, 0, 0, 6] });
        }

        [parts.top, parts.sections, parts.up].forEach(function (blk) {
            streamBlocks(blk, imgs, pal).forEach(function (b) { content.push(b); });
        });

        var whenIso = inst.published_at || snap.built_at || '';
        var when = whenIso ? prettyDate(whenIso) : prettyDate(new Date().toISOString());
        var footText = view.frozen
            ? 'Figures frozen ' + when + ' · version ' + (inst.version != null ? inst.version : DASH)
            : 'Draft figures, ' + when;

        var doc = {
            pageSize: 'A4',
            pageMargins: [MARGIN, MARGIN, MARGIN, 48],
            defaultStyle: { fontSize: 9 },
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
            if (pal.grid) doc.watermark.color = pal.grid;
        }
        return doc;
    }

    w.ReportFiguresPdf = { ensureLib: ensureLib, build: build, chartPlan: chartPlan, _fmt: fmt };
})(typeof window !== 'undefined' ? window : this);
