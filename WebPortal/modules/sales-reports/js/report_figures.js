/**
 * Management reports - shared figures renderer (Kernel 1-5, Oil 1-5, headline compare tiles, charts).
 *
 * Used by BOTH the "All figures" tab (reports_all_figures.js, idPrefix 'raf') and the Weekly / Monthly
 * report view (report_view.js, idPrefix 'rv'), so the two screens look identical.
 *
 *   ReportFigures.model(data, {mode, from, to, oilFilter}) -> pure description, NO DOM:
 *       { mode, from, to, streams:[{key,title,sub,jump,sections:[section]}], charts:[spec], _input }
 *       section = { id:'K1', oil:bool, num:'1.'|null, title, src, notice:{text,kind}|null, source:text|null,
 *                   tiles:[tile], grids:[{cols, cards:[{title, ts, chart:spec|null, table:tbl|null}]}],
 *                   gap:text|null, fine:text|null, filter:{active, products:[{value,label}]}|null }
 *       tile    = { label, value, note, missing, lines:[{text, tone:'up'|'down'|'muted'}] }
 *       spec    = { id:'CK1', kind:'bar'|'hbar'|'grouped'|'doughnut'|'combo', labels, datasets:[{label,data,color,type?,dashed?}],
 *                   opts:{unit:'kg'|'R'|'L', stacked, rows, emptyHint}, empty:bool }
 *     Ids in a model are UNPREFIXED; paint() adds the prefix (`${p}K1`, `${p}K1Tiles`, `${p}CK3a`, `${p}TK5`,
 *     `${p}K1Notice`, `${p}K1Source`, `${p}K1Gap`, `${p}OilFilter`). The PDF builder reads model.charts.
 *   ReportFigures.paint(hostEl, model, {idPrefix, controls:{oilFilter:true}, onOilFilter(v)}) draws it.
 *   ReportFigures.destroy(idPrefix) destroys every chart painted under that prefix.
 *   ReportFigures.compareTile(metric, {periodWord, ytd}) -> tile (value, target line, vs-last-period line).
 *   ReportFigures.chartImages(specs, {w, h, scale}) -> Promise<[{id, dataUrl, w, h}]> (off-screen light-palette JPEGs; w/h in CSS px).
 *
 * Security invariant: every database value reaches the DOM through textContent (MgmtDashboard.el /
 * fillTable / tile) - never innerHTML. Colours come from MgmtDashboard.colors() (the --mac-* tokens);
 * the one exception is the print palette (printColors(): fixed light colours, incl. the
 * white page behind PDF chart images) so PDFs never inherit dark mode.
 * null in the data means "not available": shown as an em dash, never as 0; a null target is
 * "No target set", never 0%.
 */
var ReportFigures = (function () {
    'use strict';

    var M = window.MgmtDashboard;
    var DASH = '—';
    var MINUS = '−';
    var TOP_CUSTOMERS = 8;
    var OIL_FILTERS = [
        { value: 'all', label: 'All products' }, { value: 'food_grade', label: 'Food grade' }, { value: 'crude', label: 'Crude' },
        { value: 'protein', label: 'Protein powder' }, { value: 'cake', label: 'Oil cake' }
    ];

    var registry = {};   // idPrefix -> { chartIds: {id: true}, own: {id: Chart} }

    // PRINT PALETTE (exception to "colours come from the tokens"; the PDF builder reads it as ReportFigures.printColors()): PDF pages and their chart images are
    // always light, whatever theme the portal is in, so they must not inherit dark-mode tokens. Values
    // are the light-theme tokens in css/design-tokens.css. These are the only print colour literals.
    function printColors() {
        return {
            text: '#1f1f1f', muted: '#6e6e68', grid: '#e3e3e0', headFill: '#f2f2ef',
            green: '#198754', tan: '#8d7434', info: '#0969DA',
            greenSoft: 'rgba(25, 135, 84, 0.4)', tanSoft: 'rgba(141, 116, 52, 0.4)',
            surface: '#ffffff', watermark: '#d9d9d6'
        };
    }


    // ------------------------------------------------------------------
    // Formatting. null -> an em dash, never 0.
    // ------------------------------------------------------------------

    function isNum(v) { return v !== null && v !== undefined && v !== '' && isFinite(Number(v)); }
    function kgF(v) { return isNum(v) ? _common.formatKg(Number(v), 2) + ' kg' : DASH; }
    function kgPlain(v) { return isNum(v) ? _common.formatKg(Number(v), 2) : DASH; }
    function intF(v) { return isNum(v) ? M.num(v) : DASH; }
    function zarF(v) { return isNum(v) ? M.rand(v) : DASH; }
    function pctF(v) { return isNum(v) ? Number(v).toFixed(1) + '%' : DASH; }
    function priceF(v) { return isNum(v) ? 'R ' + _common.formatKg(Number(v), 2) + '/kg' : DASH; }
    function litresF(v) { return isNum(v) ? M.num(v) + ' L' : DASH; }
    function num0(v) { return Number(v) || 0; }
    function day(s) { return String(s || '').slice(0, 10); }

    function fmtByUnit(unit, v) {
        if (!isNum(v)) return DASH;
        if (unit === 'zar') return zarF(v);
        if (unit === 'pct') return pctF(v);
        if (unit === 'zar_per_kg') return priceF(v);
        return kgF(v);
    }

    function signedPct(delta) {
        var r = Math.round(delta);
        return (r > 0 ? '+' : r < 0 ? MINUS : '') + Math.abs(r) + '%';
    }

    // ------------------------------------------------------------------
    // Data helpers (shared with report_view.js through ReportFigures.util).
    // ------------------------------------------------------------------

    // Sums rows' fields into the buckets: returns [{field: total}] aligned to `buckets`.
    function bucketRows(rows, buckets, fields) {
        var out = buckets.map(function () {
            var o = {};
            fields.forEach(function (f) { o[f] = 0; });
            return o;
        });
        (rows || []).forEach(function (r) {
            if (!r || !r.d) return;
            var d = day(r.d);
            for (var i = 0; i < buckets.length; i++) {
                if (d >= buckets[i].from && d <= buckets[i].to) {
                    fields.forEach(function (f) { out[i][f] += num0(r[f]); });
                    break;
                }
            }
        });
        return out;
    }

    function labelsOf(buckets) { return buckets.map(function (b) { return b.label; }); }
    function sumOf(arr) { return arr.reduce(function (s, v) { return s + v; }, 0); }
    function anyPositive(arr) { return (arr || []).some(function (v) { return v > 0; }); }
    function col(arr, k) { return arr.map(function (x) { return x[k]; }); }

    // Top N rows by value, the rest folded into "Other".
    function topN(rows, labelKey, valueKey, n) {
        var sorted = (rows || []).filter(function (r) { return num0(r[valueKey]) > 0; })
            .sort(function (a, b) { return num0(b[valueKey]) - num0(a[valueKey]); });
        var labels = [], values = [], rest = 0;
        sorted.forEach(function (r, i) {
            if (i < n) { labels.push(String(r[labelKey] == null ? '' : r[labelKey])); values.push(num0(r[valueKey])); }
            else rest += num0(r[valueKey]);
        });
        if (rest > 0) { labels.push('Other'); values.push(rest); }
        return { labels: labels, values: values };
    }

    // ------------------------------------------------------------------
    // Spec builders.
    // ------------------------------------------------------------------

    function spec(kind, id, labels, datasets, opts) {
        opts = opts || {};
        var empty;
        if (kind === 'doughnut') empty = !datasets[0] || !datasets[0].data.length;
        else empty = !labels.length || !datasets.some(function (d) { return anyPositive(d.data); });
        return { id: id, kind: kind, labels: labels, datasets: datasets, opts: opts, empty: empty };
    }
    function hbarSpec(id, labels, values, unit, color) {
        return spec('hbar', id, labels, [{ label: '', data: values, color: color }], { unit: unit, rows: labels.length });
    }
    function barSpec(id, buckets, values, unit, color) {
        return spec('bar', id, labelsOf(buckets), [{ label: '', data: values, color: color }], { unit: unit });
    }
    function groupedSpec(id, buckets, series, unit, stacked) {
        return spec('grouped', id, labelsOf(buckets), series, { unit: unit, stacked: !!stacked });
    }
    function doughnutSpec(id, labels, data, unit) {
        return spec('doughnut', id, labels, [{ label: '', data: data }], { unit: unit });
    }

    function tileOf(label, value, note, missing) {
        return { label: label, value: value, note: note || '', missing: !!missing, lines: [] };
    }
    function missingTile(label, note) { return tileOf(label, 'Not captured', note, true); }

    function tableOf(id, heads, rows, total) { return { id: id, heads: heads, rows: rows, total: total || null }; }
    function card(title, chart, table, ts) { return { title: title, chart: chart || null, table: table || null, ts: !!ts }; }
    function grid(cols, cards) { return { cols: cols, cards: cards }; }

    function newSection(id, num, title, src, oil) {
        return { id: id, oil: !!oil, num: num, title: title, src: src || '', notice: null, source: null, tiles: [],
            grids: [], gap: null, fine: null, filter: null };
    }
    function notice(sec, text, kind) { sec.notice = text ? { text: text, kind: kind || 'muted' } : null; }

    // ------------------------------------------------------------------
    // Kernel sections.
    // ------------------------------------------------------------------

    function secK1(k, b) {
        var s = newSection('K1', '1.', 'Procurement', 'Grower Intake deliveries and the Procurement plan');
        var p = k && k.procurement;
        if (!p) {
            s.tiles = [tileOf('NIS received', DASH, 'Not available')];
            notice(s, 'Procurement figures are not available for this period.');
            s.grids = [grid(2, [card('NIS received vs planned (kg)', spec('grouped', 'CK1', [], [], { unit: 'kg' }), null, true),
                card('By grower', null, tableOf('TK1', [{ text: 'Grower' }], []))])];
            return s;
        }
        s.source = 'From 16 Oct 2026 NIS received is read from Grower Intake; the monthly report still uses the data page, so the two can differ.';
        s.tiles = [
            tileOf('NIS received', kgF(p.nis_kg), isNum(p.deliveries) ? M.num(p.deliveries) + ' deliveries' : ''),
            tileOf('Planned vs received', pctF(p.received_vs_plan_pct), isNum(p.planned_kg) ? 'of ' + kgF(p.planned_kg) + ' planned arrived' : 'of planned kg arrived'),
            tileOf('Growers delivering', intF(p.growers), isNum(p.planned_trucks) ? M.num(p.planned_trucks) + ' trucks planned' : '')
        ];
        if (p.cost_captured === false) s.tiles.push(missingTile('Cost of NIS bought', 'see red note below'));
        var c = M.colors();
        var d = bucketRows(p.by_day, b, ['received_kg', 'planned_kg']);
        var rows = (p.by_grower || []).map(function (g) { return [g.grower, intF(g.deliveries), kgPlain(g.nis_kg)]; });
        s.grids = [grid(2, [
            card('NIS received vs planned (kg)', groupedSpec('CK1', b, [
                { label: 'Received', data: col(d, 'received_kg'), color: c.green },
                { label: 'Planned', data: col(d, 'planned_kg'), color: c.tan }], 'kg', false), null, true),
            card('By grower', null, tableOf('TK1', [{ text: 'Grower' }, { text: 'Deliveries', num: true }, { text: 'NIS (kg)', num: true }], rows,
                rows.length ? ['Total', intF(sumOf((p.by_grower || []).map(function (g) { return num0(g.deliveries); }))),
                    kgPlain(sumOf((p.by_grower || []).map(function (g) { return num0(g.nis_kg); })))] : null))
        ])];
        if (p.cost_captured === false) s.gap = 'the portal records how many kg came in and from which grower, but not what Macavation paid for it.';
        return s;
    }

    function secK2(k) {
        var s = newSection('K2', '2.', 'Storage', 'Silos & storage areas, bag movements');
        var st = k && k.storage;
        var emptyTable = tableOf('TK2', [{ text: 'Area' }], []);
        if (!st) {
            s.tiles = [tileOf('NIS in storage at period end', DASH, 'Not available')];
            s.grids = [grid(2, [card('Where the NIS is at period end (kg)', spec('hbar', 'CK2', [], [], { unit: 'kg' })),
                card('In and out during the period', null, emptyTable)])];
            return s;
        }
        if (st.available === false) {
            notice(s, st.available_from ? 'Storage tracking starts on ' + M.prettyDate(st.available_from) + '.' : 'Storage tracking is not available for this period.');
            s.tiles = [tileOf('NIS in storage at period end', DASH, ''), tileOf('Moved into storage', DASH, ''), tileOf('Sent to cracking', DASH, '')];
            var e = spec('hbar', 'CK2', [], [], { unit: 'kg', emptyHint: 'Storage tracking had not started yet.' });
            s.grids = [grid(2, [card('Where the NIS is at period end (kg)', e), card('In and out during the period', null, emptyTable)])];
            return s;
        }
        s.tiles = [
            tileOf('NIS in storage at period end', kgF(st.end_kg), 'across all areas'),
            tileOf('Moved into storage', kgF(st.in_kg), 'during the period'),
            tileOf('Sent to cracking', kgF(st.out_kg), 'from silos')
        ];
        var areas = st.by_area || [];
        var rows = areas.map(function (a) { return [a.label || a.code, kgPlain(a.in_kg), kgPlain(a.out_kg), kgPlain(a.end_kg)]; });
        s.grids = [grid(2, [
            card('Where the NIS is at period end (kg)', hbarSpec('CK2', areas.map(function (a) { return a.label || a.code; }),
                areas.map(function (a) { return num0(a.end_kg); }), 'kg', M.colors().green)),
            card('In and out during the period', null, tableOf('TK2',
                [{ text: 'Area' }, { text: 'In incl. moves (kg)', num: true }, { text: 'Out incl. moves (kg)', num: true }, { text: 'At end (kg)', num: true }], rows,
                rows.length ? ['Total (deliveries in / to cracking out)', kgPlain(st.in_kg), kgPlain(st.out_kg), kgPlain(st.end_kg)] : null))
        ])];
        return s;
    }

    function secK3(k, b) {
        var s = newSection('K3', '3.', 'Production', 'Cracking log (silo runs) and packing sheets');
        var p = k && k.production;
        if (!p) {
            s.tiles = [tileOf('NIS cracked', DASH, 'Not available')];
            notice(s, 'Production figures are not available for this period.');
            s.grids = [grid(2, [card('NIS cracked (kg)', spec('bar', 'CK3a', [], [{ data: [] }], { unit: 'kg' }), null, true),
                card('Kernel packed by style (kg)', spec('hbar', 'CK3b', [], [], { unit: 'kg' }))]),
                grid(1, [card('By-products', null, tableOf('TK3', [{ text: 'By-product' }], []))])];
            return s;
        }
        s.tiles = [
            tileOf('NIS cracked', kgF(p.cracked_kg), 'closed silo runs'),
            tileOf('Kernel packed', kgF(p.sk_packed_kg), isNum(p.cartons) ? M.num(p.cartons) + ' cartons' : ''),
            tileOf('Kernel recovery', pctF(p.recovery_pct), 'packed ÷ cracked, same period'),
            tileOf('Butter (low + high oil)', kgF(p.butter_kg), 'of the packed kg')
        ];
        var c = M.colors();
        var d = bucketRows(p.by_day, b, ['cracked_kg', 'sk_packed_kg']);
        var styles = (p.packed_by_style || []).slice().sort(function (a, z) { return num0(z.kg) - num0(a.kg); });
        var bp = p.byproducts || {};
        s.grids = [
            grid(2, [
                card('NIS cracked (kg)', barSpec('CK3a', b, col(d, 'cracked_kg'), 'kg', c.green), null, true),
                card('Kernel packed by style (kg)', hbarSpec('CK3b', styles.map(function (x) { return x.style; }), styles.map(function (x) { return num0(x.kg); }), 'kg', c.tan))
            ]),
            grid(1, [card('By-products', null, tableOf('TK3', [{ text: 'By-product' }, { text: 'Kg', num: true }], [
                ['Oil kernel', kgPlain(bp.oil_kernel_kg)], ['Cracker dust', kgPlain(bp.cracker_dust_kg)],
                ['Shell fines', kgPlain(bp.shell_fines_kg)], ['Compost', kgPlain(bp.compost_kg)], ['Shell', kgPlain(bp.shell_kg)]
            ]))])
        ];
        return s;
    }

    function secK4(k) {
        var s = newSection('K4', '4.', 'Finished goods stock on hand', 'Kernel stock on hand, by style');
        var f = k && k.finished_stock;
        var heads = [{ text: 'Style' }, { text: 'Opening (kg)', num: true }, { text: 'Packed in (kg)', num: true },
            { text: 'Out (kg)', num: true }, { text: 'Closing (kg)', num: true }, { text: 'Cartons', num: true }];
        if (!f || f.available === false) {
            notice(s, 'Finished stock figures are not available for this period.');
            s.tiles = [tileOf('Kernel on hand at period end', DASH, ''), tileOf('Packed in', DASH, ''), tileOf('Dispatched / adjusted out', DASH, '')];
            s.grids = [grid(1, [card('By style', null, tableOf('TK4', heads, []))])];
            return s;
        }
        s.tiles = [
            tileOf('Kernel on hand at period end', kgF(f.closing_kg), isNum(f.closing_cartons) ? M.num(f.closing_cartons) + ' cartons' : ''),
            tileOf('Packed in', kgF(f.packed_kg), 'during the period'),
            tileOf('Dispatched / adjusted out', kgF(f.out_kg), 'during the period')
        ];
        var rows = (f.by_style || []).map(function (r) {
            return [r.style, kgPlain(r.opening_kg), kgPlain(r.packed_kg), kgPlain(r.out_kg), kgPlain(r.closing_kg), intF(r.closing_cartons)];
        });
        s.grids = [grid(1, [card('By style', null, tableOf('TK4', heads, rows, rows.length ? ['Total', kgPlain(f.opening_kg), kgPlain(f.packed_kg),
            kgPlain(f.out_kg), kgPlain(f.closing_kg), intF(f.closing_cartons)] : null))])];
        return s;
    }

    function secK5(k, b) {
        var s = newSection('K5', '5.', 'Sales', 'Dispatch and Sales (priced at step 3)');
        var d0 = k && k.sales;
        var heads = [{ text: 'Customer' }, { text: 'Style' }, { text: 'Kg', num: true }, { text: 'Cartons', num: true },
            { text: 'Price / kg', num: true }, { text: 'Value (R)', num: true }];
        var tblCard = function (rows, total) { return grid(1, [card('By customer and style', null, tableOf('TK5', heads, rows, total))]); };
        if (!d0) {
            s.tiles = [tileOf('Kernel sold', DASH, 'Not available')];
            notice(s, 'Sales figures are not available for this period.');
            s.grids = [grid(3, [card('Sales value by customer (R)', spec('hbar', 'CK5a', [], [], { unit: 'R' })),
                card('Volume by style (kg)', spec('doughnut', 'CK5b', [], [{ data: [] }], { unit: 'kg' })),
                card('Sales value over the period (R)', spec('bar', 'CK5c', [], [{ data: [] }], { unit: 'R' }), null, true)]), tblCard([], null)];
            return s;
        }
        s.tiles = [
            tileOf('Kernel sold', kgF(d0.kg), isNum(d0.cartons) ? M.num(d0.cartons) + ' cartons' : ''),
            tileOf('Sales value (excl. VAT)', zarF(d0.value_zar), 'kg × price per kg'),
            tileOf('Average price', priceF(d0.avg_price_per_kg), 'across all styles'),
            tileOf('Customers', intF(d0.customers), 'bought in the period')
        ];
        var c = M.colors();
        var cust = topN(d0.by_customer, 'customer', 'value_zar', TOP_CUSTOMERS);
        var sty = (d0.by_style || []).filter(function (x) { return num0(x.kg) > 0; });
        var dd = bucketRows(d0.by_day, b, ['value_zar']);
        var lines = d0.by_customer_style || [];
        var rows = lines.map(function (r) { return [r.customer, r.style, kgPlain(r.kg), intF(r.cartons), priceF(r.price_per_kg), zarF(r.value_zar)]; });
        s.grids = [
            grid(3, [
                card('Sales value by customer (R)', hbarSpec('CK5a', cust.labels, cust.values, 'R', c.green)),
                card('Volume by style (kg)', doughnutSpec('CK5b', sty.map(function (x) { return x.style; }), sty.map(function (x) { return num0(x.kg); }), 'kg')),
                card('Sales value over the period (R)', barSpec('CK5c', b, col(dd, 'value_zar'), 'R', c.green), null, true)
            ]),
            tblCard(rows, rows.length ? ['Total', '', kgPlain(d0.kg), intF(d0.cartons), priceF(d0.avg_price_per_kg), zarF(d0.value_zar)] : null)
        ];
        s.fine = 'All Rand figures are excluding VAT.';
        return s;
    }

    // ------------------------------------------------------------------
    // Oil sections.
    // ------------------------------------------------------------------

    function secO1(o, b) {
        var s = newSection('O1', '1.', 'Procurement', 'Supplier Intake (oil raws in)', true);
        var p = o && o.procurement;
        var supHeads = [{ text: 'Supplier' }, { text: 'Oil kernel', num: true }, { text: 'Kernel dust', num: true }, { text: 'Cracker dust', num: true }, { text: 'Total (kg)', num: true }];
        if (!p) {
            s.tiles = [tileOf('Oil kernel received', DASH, 'Not available')];
            notice(s, 'Procurement figures are not available for this period.');
            s.grids = [grid(2, [card('Raws received by material (kg)', spec('grouped', 'CO1', [], [], { unit: 'kg', stacked: true }), null, true),
                card('By supplier', null, tableOf('TO1', [{ text: 'Supplier' }], []))])];
            return s;
        }
        s.tiles = [
            tileOf('Oil kernel received', kgF(p.oil_kernel_kg), isNum(p.food_grade_kg) ? 'of which food grade ' + kgF(p.food_grade_kg) : ''),
            tileOf('Kernel dust received', kgF(p.kernel_dust_kg), isNum(p.loads) ? M.num(p.loads) + ' loads in total' : ''),
            tileOf('Cracker dust received', kgF(p.cracker_dust_kg), 'total raws ' + kgF(p.total_kg))
        ];
        if (p.cost_captured === false) s.tiles.push(missingTile('Cost of raws bought', 'see red note below'));
        var c = M.colors();
        var d = bucketRows(p.by_day, b, ['oil_kernel_kg', 'kernel_dust_kg', 'cracker_dust_kg']);
        var rows = (p.by_supplier || []).map(function (r) { return [r.supplier, kgPlain(r.oil_kernel_kg), kgPlain(r.kernel_dust_kg), kgPlain(r.cracker_dust_kg), kgPlain(r.total_kg)]; });
        s.grids = [grid(2, [
            card('Raws received by material (kg)', groupedSpec('CO1', b, [
                { label: 'Oil kernel', data: col(d, 'oil_kernel_kg'), color: c.green },
                { label: 'Kernel dust', data: col(d, 'kernel_dust_kg'), color: c.tan },
                { label: 'Cracker dust', data: col(d, 'cracker_dust_kg'), color: c.info }], 'kg', true), null, true),
            card('By supplier', null, tableOf('TO1', supHeads, rows,
                rows.length ? ['Total', kgPlain(p.oil_kernel_kg), kgPlain(p.kernel_dust_kg), kgPlain(p.cracker_dust_kg), kgPlain(p.total_kg)] : null))
        ])];
        if (p.cost_captured === false) s.gap = 'the portal records how many kg were received and from which supplier, but not what Macavation paid for them.';
        return s;
    }

    function secO2(o) {
        var s = newSection('O2', '2.', 'Raw material stock on hand', 'Last stock count + received − used in production', true);
        var r = o && o.raw_stock;
        var heads = [{ text: 'Material' }, { text: 'Opening (kg)', num: true }, { text: 'Received (kg)', num: true },
            { text: 'Used (kg)', num: true }, { text: 'Closing (kg)', num: true }];
        if (!r) {
            notice(s, 'Raw material stock is not available for this period.');
            s.grids = [grid(1, [card('Raw material stock', null, tableOf('TO2', heads, []))])];
            return s;
        }
        // The SQL note embeds ISO dates ("2026-10-26"); show them as "26 Oct 2026".
        var note = r.note ? String(r.note).replace(/(\d{4}-\d{2}-\d{2})/g, function (d) { return M.prettyDate(d); }) : '';
        var parts = [];
        if (r.available !== false && r.count_date) parts.push('Starts from the stock count on ' + M.prettyDate(r.count_date) + '.');
        if (note) parts.push(note);
        else if (r.available === false) parts.push('Raw material stock is not available for this period.');
        notice(s, parts.join(' '));
        // Rows are shown whenever present, even when stock is not fully available (null cells show a dash).
        s.grids = [grid(1, [card('Raw material stock', null, tableOf('TO2', heads, (r.materials || []).map(function (m) {
            return [m.label || m.material, kgPlain(m.opening_kg), kgPlain(m.received_kg), kgPlain(m.used_kg), kgPlain(m.closing_kg)];
        })))])];
        return s;
    }

    function secO3(o, b) {
        var s = newSection('O3', '3.', 'Production', 'Oil Production, protein bins, oil cake', true);
        var p = o && o.production;
        if (!p) {
            s.tiles = [tileOf('Food grade oil', DASH, 'Not available')];
            notice(s, 'Production figures are not available for this period.');
            s.grids = [grid(1, [card('Production over the period (kg)', spec('grouped', 'CO3', [], [], { unit: 'kg' }), null, true)])];
            return s;
        }
        s.tiles = [
            tileOf('Food grade oil', kgF(p.food_grade_kg), 'pressed'),
            tileOf('Crude oil', kgF(p.crude_kg), isNum(p.oil_litres) ? 'all oil: ' + litresF(p.oil_litres) : 'pressed'),
            tileOf('Protein powder', kgF(p.protein_kg), 'bagged'),
            tileOf('Oil cake', kgF(p.cake_kg), 'produced')
        ];
        var c = M.colors();
        var d = bucketRows(p.by_day, b, ['food_grade_kg', 'crude_kg', 'protein_kg', 'cake_kg']);
        s.grids = [grid(1, [card('Production over the period (kg)', groupedSpec('CO3', b, [
            { label: 'Food grade', data: col(d, 'food_grade_kg'), color: c.green },
            { label: 'Crude', data: col(d, 'crude_kg'), color: c.tan },
            { label: 'Protein powder', data: col(d, 'protein_kg'), color: c.info },
            { label: 'Oil cake', data: col(d, 'cake_kg'), color: c.grid }], 'kg', false), null, true)])];
        return s;
    }

    function secO4(o) {
        var s = newSection('O4', '4.', 'Finished goods stock on hand', 'Oil & protein stock, oil cake', true);
        var f = o && o.finished_stock;
        var heads = [{ text: 'Product' }, { text: 'Opening (kg)', num: true }, { text: 'Produced (kg)', num: true },
            { text: 'Sold (kg)', num: true }, { text: 'Closing (kg)', num: true }];
        if (!f) {
            notice(s, 'Finished stock figures are not available for this period.');
            s.grids = [grid(1, [card('By product', null, tableOf('TO4', heads, []))])];
            return s;
        }
        s.grids = [grid(1, [card('By product', null, tableOf('TO4', heads, (f.products || []).map(function (r) {
            var tracked = r.tracked !== false;
            return [r.label || r.product, tracked ? kgPlain(r.opening_kg) : 'Not tracked', kgPlain(r.produced_kg), kgPlain(r.sold_kg),
                tracked ? kgPlain(r.closing_kg) : 'Not tracked'];
        })))])];
        return s;
    }

    function secO5(o, b, oilFilter) {
        var s = newSection('O5', '5.', 'Sales', 'Food grade, crude, protein powder and oil cake', true);
        var d0 = o && o.sales;
        s.filter = { active: oilFilter || 'all', products: OIL_FILTERS };
        if (!d0) {
            s.tiles = [tileOf('Food grade oil', DASH, 'Not available')];
            notice(s, 'Sales figures are not available for this period.');
            s.grids = [grid(3, [card('Sales value by customer (R)', spec('hbar', 'CO5a', [], [], { unit: 'R' })),
                card('Value by product (R)', spec('doughnut', 'CO5b', [], [{ data: [] }], { unit: 'R' })),
                card('Sales value over the period (R)', spec('bar', 'CO5c', [], [{ data: [] }], { unit: 'R' }), null, true)])];
            return s;
        }
        var L = d0.lines || {};
        function line(label, key) {
            var l = L[key];
            return tileOf(label, l ? zarF(l.value_zar) : DASH, l ? kgF(l.kg) + ' sold' : 'Not available');
        }
        s.tiles = [line('Food grade oil', 'food_grade'), line('Crude oil', 'crude'), line('Protein powder', 'protein'), line('Oil cake', 'cake')];
        var f = s.filter.active;
        // 'other' (anything outside the four product buttons) counts in "All products" only.
        var match = function (r) { return f === 'all' || r.product === f; };
        var cust = {};
        (d0.by_customer || []).filter(match).forEach(function (r) { cust[r.customer] = (cust[r.customer] || 0) + num0(r.value_zar); });
        var custRows = Object.keys(cust).map(function (k2) { return { customer: k2, value_zar: cust[k2] }; });
        var top = topN(custRows, 'customer', 'value_zar', TOP_CUSTOMERS);
        // Value by product always shows all product lines (it is the thing the filter chooses between).
        var names = { food_grade: 'Food grade', crude: 'Crude', protein: 'Protein powder', cake: 'Oil cake', other: 'Other' };
        var pk = Object.keys(L).filter(function (k2) { return L[k2] && num0(L[k2].value_zar) > 0; });
        var dd = bucketRows((d0.by_day || []).filter(match), b, ['value_zar']);
        var c = M.colors();
        s.grids = [grid(3, [
            card('Sales value by customer (R)', hbarSpec('CO5a', top.labels, top.values, 'R', c.green)),
            card('Value by product (R)', doughnutSpec('CO5b', pk.map(function (k2) { return names[k2] || k2; }), pk.map(function (k2) { return num0(L[k2].value_zar); }), 'R')),
            card('Sales value over the period (R)', barSpec('CO5c', b, col(dd, 'value_zar'), 'R', c.tan), null, true)
        ])];
        s.gap = d0.pricing_note || 'the Oil Dispatch screen records kg only, with no price, so oil sales reach the reports only when they are typed or imported on the Sales & Production Data page.';
        return s;
    }

    function safeSection(id, oil, fn) {
        try { return fn(); } catch (e) {
            if (window.console) console.warn('[ReportFigures] section ' + id + ' failed', e);
            var s = newSection(id, null, 'Section ' + id, '', oil);
            notice(s, 'This section could not be drawn.', 'danger');
            return s;
        }
    }

    // ------------------------------------------------------------------
    // model()
    // ------------------------------------------------------------------

    function model(data, o) {
        o = o || {};
        data = data || {};
        var mode = o.mode || 'month';
        var from = o.from || data.from, to = o.to || data.to;
        var b = (from && to) ? M.period.buckets(mode, from, to) : [];
        var k = data.kernel || null, oil = data.oil || null;
        var f = o.oilFilter || 'all';
        var kernel = { key: 'kernel', title: 'Kernel processing', sub: 'From nut-in-shell bought to kernel sold',
            jump: [['K1', 'Procurement'], ['K2', 'Storage'], ['K3', 'Production'], ['K4', 'Finished stock'], ['K5', 'Sales']],
            sections: [
                safeSection('K1', false, function () { return secK1(k, b); }), safeSection('K2', false, function () { return secK2(k); }),
                safeSection('K3', false, function () { return secK3(k, b); }), safeSection('K4', false, function () { return secK4(k); }),
                safeSection('K5', false, function () { return secK5(k, b); })] };
        var oilS = { key: 'oil', title: 'Oil processing', sub: 'From oil raws bought to oil, protein and cake sold',
            jump: [['O1', 'Procurement'], ['O2', 'Raw material stock'], ['O3', 'Production'], ['O4', 'Finished stock'], ['O5', 'Sales']],
            sections: [
                safeSection('O1', true, function () { return secO1(oil, b); }), safeSection('O2', true, function () { return secO2(oil); }),
                safeSection('O3', true, function () { return secO3(oil, b); }), safeSection('O4', true, function () { return secO4(oil); }),
                safeSection('O5', true, function () { return secO5(oil, b, f); })] };
        var m = { mode: mode, from: from, to: to, streams: [kernel, oilS], charts: [], _input: { data: data, opts: { mode: mode, from: from, to: to, oilFilter: f } } };
        m.charts = collectCharts(m);
        return m;
    }

    function collectCharts(m) {
        var out = [];
        (m.streams || []).forEach(function (st) {
            (st.sections || []).forEach(function (s) {
                (s.grids || []).forEach(function (g) {
                    (g.cards || []).forEach(function (c) { if (c.chart && !c.chart.empty) out.push(c.chart); });
                });
            });
        });
        return out;
    }

    // ------------------------------------------------------------------
    // compareTile - headline metric with target and previous-period comparison.
    // ------------------------------------------------------------------

    function compareTile(metric, o) {
        o = o || {};
        var word = o.periodWord || 'period';
        metric = metric || {};
        var unit = metric.unit;
        var t = tileOf(metric.label || '', fmtByUnit(unit, metric.value), '');
        var hasVal = isNum(metric.value);
        // Target line.
        if (!isNum(metric.target)) {
            t.lines.push({ text: 'No target set', tone: 'muted' });
        } else {
            var txt = 'Target ' + fmtByUnit(unit, metric.target);
            var tone = 'muted';
            if (hasVal) {
                if (unit === 'pct') {
                    var diff = Number(metric.value) - Number(metric.target);
                    txt += ' · ' + (diff > 0 ? '+' : diff < 0 ? MINUS : '') + Math.abs(diff).toFixed(1) + ' pts';
                    tone = diff >= 0 ? 'up' : 'down';
                } else if (Number(metric.target) !== 0) {
                    var dl = (Number(metric.value) - Number(metric.target)) / Math.abs(Number(metric.target)) * 100;
                    txt += ' · ' + signedPct(dl);
                    tone = dl >= 0 ? 'up' : 'down';
                }
            }
            t.lines.push({ text: txt, tone: tone });
        }
        // Previous period.
        var vs = 'vs last ' + word;
        if (!hasVal || !isNum(metric.previous)) {
            t.lines.push({ text: vs + ' ' + DASH, tone: 'muted' });
        } else if (unit === 'pct') {
            var pd = Number(metric.value) - Number(metric.previous);
            t.lines.push({ text: vs + ' ' + (pd > 0 ? '+' : pd < 0 ? MINUS : '') + Math.abs(pd).toFixed(1) + ' pts', tone: pd >= 0 ? 'up' : 'down' });
        } else if (Number(metric.previous) === 0) {
            t.lines.push({ text: vs + ' ' + DASH, tone: 'muted' });
        } else {
            var pc = (Number(metric.value) - Number(metric.previous)) / Math.abs(Number(metric.previous)) * 100;
            t.lines.push({ text: vs + ' ' + signedPct(pc), tone: pc >= 0 ? 'up' : 'down' });
        }
        // Year to date (monthly report).
        // Targets may exist for only some periods, so the like-for-like actual is ytd_actual_on_target.
        if (o.ytd && isNum(metric.ytd)) {
            var yp = Number(metric.ytd_periods) || 0, tp = Number(metric.ytd_target_periods) || 0;
            var ytxt = 'Year to date ' + fmtByUnit(unit, metric.ytd);
            if (!isNum(metric.ytd_target) || tp <= 0) {
                ytxt += ' · no target set';
            } else {
                var full = tp === yp;
                var base = full ? metric.ytd : metric.ytd_actual_on_target;
                if (full) ytxt += ' vs target ' + fmtByUnit(unit, metric.ytd_target);
                else if (isNum(base)) ytxt += ' · target set for ' + tp + ' of ' + yp + ' ' + word + 's: ' + fmtByUnit(unit, base) + ' vs ' + fmtByUnit(unit, metric.ytd_target);
                else ytxt += ' · target set for ' + tp + ' of ' + yp + ' ' + word + 's: ' + fmtByUnit(unit, metric.ytd_target);
                if (isNum(base)) {
                    if (unit === 'pct') {
                        var yd = Number(base) - Number(metric.ytd_target);
                        ytxt += ' · ' + (yd > 0 ? '+' : yd < 0 ? MINUS : '') + Math.abs(yd).toFixed(1) + ' pts';
                    } else if (Number(metric.ytd_target) !== 0) {
                        ytxt += ' · ' + signedPct((Number(base) - Number(metric.ytd_target)) / Math.abs(Number(metric.ytd_target)) * 100);
                    }
                }
            }
            t.lines.push({ text: ytxt, tone: 'muted' });
        }
        return t;
    }

    // ------------------------------------------------------------------
    // paint()
    // ------------------------------------------------------------------

    function reg(prefix) {
        if (!registry[prefix]) registry[prefix] = { ids: {}, own: {} };
        return registry[prefix];
    }

    function destroyOwn(prefix, id) {
        var r = registry[prefix];
        if (r && r.own[id]) { try { r.own[id].destroy(); } catch (e) { /* gone */ } delete r.own[id]; }
    }

    // Destroys every chart whose canvas lives inside `root` (before the root is cleared or replaced).
    function destroyWithin(prefix, root) {
        var canvases = root.querySelectorAll ? root.querySelectorAll('canvas') : [];
        for (var i = 0; i < canvases.length; i++) {
            var id = canvases[i].id;
            M.destroyChart(id);
            destroyOwn(prefix, id);
        }
    }

    function buildTile(t) {
        var node = M.tile(t.label, t.value, t.note);
        if (t.missing) node.classList.add('raf-tile-missing');
        (t.lines || []).forEach(function (l) {
            node.appendChild(M.el('div', 'mgmt-tile-note rf-cmp' + (l.tone === 'up' ? ' rf-cmp-up' : l.tone === 'down' ? ' rf-cmp-down' : ''), l.text));
        });
        return node;
    }

    function buildSection(sec, p, opts) {
        var el = M.el('section', 'raf-block' + (sec.oil ? ' raf-block-oil' : ''));
        el.id = p + sec.id;
        var h3 = M.el('h3', 'raf-h3');
        if (sec.num) { h3.appendChild(M.el('span', 'raf-num', sec.num)); h3.appendChild(document.createTextNode(' ')); }
        h3.appendChild(document.createTextNode(sec.title + ' '));
        if (sec.src) h3.appendChild(M.el('span', 'raf-src', sec.src));
        el.appendChild(h3);

        var n = M.el('div', sec.notice ? 'raf-notice raf-notice-' + sec.notice.kind : 'raf-notice d-none', sec.notice ? sec.notice.text : '');
        n.id = p + sec.id + 'Notice';
        el.appendChild(n);

        var body = M.el('div', 'raf-body');
        if (sec.tiles && sec.tiles.length) {
            var tiles = M.el('div', 'raf-tiles');
            tiles.id = p + sec.id + 'Tiles';
            sec.tiles.forEach(function (t) { tiles.appendChild(buildTile(t)); });
            body.appendChild(tiles);
        }
        if (sec.source) {
            var src = M.el('div', 'small text-muted mb-2', sec.source);
            src.id = p + sec.id + 'Source';
            body.appendChild(src);
        }
        if (sec.filter && !(opts.controls && opts.controls.oilFilter === false)) {
            var chips = M.el('div', 'raf-chips raf-subtabs');
            chips.id = p + 'OilFilter';
            chips.setAttribute('role', 'group');
            chips.setAttribute('aria-label', 'Product filter');
            sec.filter.products.forEach(function (pr) {
                var btn = M.el('button', 'btn btn-sm' + (pr.value === sec.filter.active ? ' active' : ''), pr.label);
                btn.type = 'button';
                btn.setAttribute('data-product', pr.value);
                btn.addEventListener('click', function () { onFilter(pr.value, p, opts); });
                chips.appendChild(btn);
            });
            body.appendChild(chips);
        }
        (sec.grids || []).forEach(function (g) {
            var gEl = M.el('div', 'raf-grid raf-grid-' + g.cols);
            g.cards.forEach(function (c) {
                var cEl = M.el('div', 'raf-card');
                cEl.appendChild(M.el('h4', null, c.title));
                if (c.chart) {
                    var box = M.el('div', 'raf-chart' + (c.ts ? ' raf-ts' : ''));
                    var cv = document.createElement('canvas');
                    cv.id = p + c.chart.id;
                    box.appendChild(cv);
                    cEl.appendChild(box);
                } else if (c.table) {
                    var wrap = M.el('div', 'raf-table-wrap');
                    var tb = M.el('table', 'raf-table');
                    tb.id = p + c.table.id;
                    wrap.appendChild(tb);
                    cEl.appendChild(wrap);
                }
                gEl.appendChild(cEl);
            });
            body.appendChild(gEl);
        });
        if (sec.gap) {
            var gap = M.el('div', 'raf-gap');
            gap.id = p + sec.id + 'Gap';
            gap.appendChild(M.el('b', null, 'Not captured today: '));
            gap.appendChild(document.createTextNode(sec.gap));
            body.appendChild(gap);
        }
        if (sec.fine) body.appendChild(M.el('div', 'raf-fine', sec.fine));
        el.appendChild(body);
        return el;
    }

    // Tables and charts are drawn once the section is attached (they look up their ids in the document).
    function fillSection(sec, p) {
        (sec.grids || []).forEach(function (g) {
            g.cards.forEach(function (c) {
                if (c.table) M.fillTable(p + c.table.id, c.table.heads, c.table.rows, c.table.total);
                if (c.chart) drawSpec(c.chart, p);
            });
        });
    }

    function drawSpec(s, p) {
        var id = p + s.id;
        var r = reg(p);
        r.ids[id] = true;
        if (!document.getElementById(id)) return;
        try {
            if (s.empty) { M.emptyBox(id, 'Nothing to chart', s.opts.emptyHint || 'No figures in this period.'); return; }
            var d = s.datasets;
            if (s.kind === 'hbar') {
                M.fitHeight(id, s.opts.rows || s.labels.length);
                M.drawChart(id, 'hbar', s.labels, d, s.opts.unit);
            } else if (s.kind === 'bar') M.drawChart(id, 'bar', s.labels, d, s.opts.unit);
            else if (s.kind === 'grouped') M.drawGrouped(id, s.labels, d, s.opts.unit, s.opts.stacked);
            else if (s.kind === 'doughnut') M.drawDoughnut(id, s.labels, d[0].data, s.opts.unit);
            else if (s.kind === 'combo') drawCombo(s, id, p);
        } catch (e) {
            if (window.console) console.warn('[ReportFigures] chart ' + id + ' failed', e);
        }
    }

    function drawCombo(s, id, p) {
        var canvas = document.getElementById(id);
        if (!canvas || typeof Chart === 'undefined') return;
        destroyOwn(p, id);
        var cfg = chartConfig(s, { responsive: true });
        reg(p).own[id] = new Chart(canvas, cfg);
    }

    function onFilter(value, p, opts) {
        var m = opts._model;
        if (!m || !m._input) return;
        m._input.opts.oilFilter = value;
        if (typeof opts.onOilFilter === 'function') { try { opts.onOilFilter(value); } catch (e) { /* host callback */ } }
        var fresh = model(m._input.data, m._input.opts);
        var secNew = null;
        fresh.streams.forEach(function (st) { st.sections.forEach(function (s) { if (s.id === 'O5') secNew = s; }); });
        var old = document.getElementById(p + 'O5');
        if (!secNew || !old || !old.parentNode) return;
        destroyWithin(p, old);
        var el = buildSection(secNew, p, opts);
        old.parentNode.replaceChild(el, old);
        fillSection(secNew, p);
    }

    // Draws `model` into hostEl (cleared first). opts: {idPrefix, controls, onOilFilter}.
    function paint(hostEl, m, opts) {
        opts = opts || {};
        var p = opts.idPrefix || '';
        if (!hostEl || !m) return;
        opts._model = m;
        reg(p);
        destroyWithin(p, hostEl);
        M.clear(hostEl);
        var secs = [];
        (m.streams || []).forEach(function (st) {
            if (st.title) {
                var h = M.el('div', 'raf-stream raf-stream-' + st.key);
                h.appendChild(M.el('h2', null, st.title));
                if (st.sub) h.appendChild(M.el('span', null, st.sub));
                hostEl.appendChild(h);
            }
            (st.sections || []).forEach(function (sec) {
                hostEl.appendChild(buildSection(sec, p, opts));
                secs.push(sec);
            });
        });
        secs.forEach(function (sec) { fillSection(sec, p); });
    }

    function destroy(idPrefix) {
        var p = idPrefix || '';
        var r = registry[p];
        if (!r) return;
        Object.keys(r.ids).forEach(function (id) { M.destroyChart(id); });
        Object.keys(r.own).forEach(function (id) { destroyOwn(p, id); });
        delete registry[p];
    }

    // ------------------------------------------------------------------
    // Chart.js config from a spec (combo charts on screen, and every off-screen PDF image).
    // ------------------------------------------------------------------

    function axisFmt(unit) {
        return function (v) {
            if (unit === 'R') return v >= 1e6 ? 'R ' + (v / 1e6) + 'm' : v >= 1000 ? 'R ' + (v / 1000) + 'k' : 'R ' + v;
            if (unit === 'L') return v >= 1000 ? (v / 1000) + 'k L' : v + ' L';
            return v >= 1000 ? (v / 1000) + 't' : v;
        };
    }

    function chartConfig(s, extra) {
        extra = extra || {};
        var c = extra.print ? printColors() : M.colors();
        var unit = s.opts && s.opts.unit;
        var common = { maintainAspectRatio: false, animation: false };
        if (extra.responsive === false) { common.responsive = false; common.devicePixelRatio = extra.scale || 2; }
        var legend = { display: s.datasets.length > 1, position: 'top', align: 'end', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 6, color: c.text } };
        if (s.kind === 'doughnut') {
            var palette = [c.green, c.tan, c.info, c.greenSoft, c.tanSoft, c.grid, c.text];
            var data = s.datasets[0].data;
            return { type: 'doughnut', plugins: extra.plugins || [], data: { labels: s.labels, datasets: [{ data: data, borderColor: c.surface, borderWidth: 2,
                backgroundColor: data.map(function (_, i) { return palette[i % palette.length]; }) }] },
                options: Object.assign({ cutout: '58%', plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 6, color: c.text } } } }, common) };
        }
        var horizontal = s.kind === 'hbar';
        var stacked = !!(s.opts && s.opts.stacked);
        var valueAxis = { stacked: stacked, beginAtZero: true, grid: { color: c.grid, drawTicks: false }, border: { display: false },
            ticks: { color: c.text, padding: 6, callback: axisFmt(unit) } };
        var catAxis = { stacked: stacked, grid: { display: false }, border: { display: false }, ticks: { color: c.text, autoSkip: !horizontal } };
        var ds = s.datasets.map(function (d) {
            var colr = d.color || c.green;
            if (d.type === 'line') {
                return { type: 'line', label: d.label || '', data: d.data, borderColor: colr, backgroundColor: colr, borderWidth: 2,
                    borderDash: d.dashed ? [6, 4] : [], pointRadius: 3, tension: 0.2, spanGaps: false, order: 0 };
            }
            return { type: 'bar', label: d.label || '', data: d.data, backgroundColor: colr, borderRadius: 3, maxBarThickness: 34, order: 1 };
        });
        return { type: 'bar', plugins: extra.plugins || [], data: { labels: s.labels, datasets: ds },
            options: Object.assign({ indexAxis: horizontal ? 'y' : 'x',
                interaction: { mode: 'index', intersect: false },
                scales: horizontal ? { x: valueAxis, y: catAxis } : { x: catAxis, y: valueAxis },
                plugins: { legend: legend, tooltip: { callbacks: { label: function (ctx) {
                    var v = horizontal ? ctx.parsed.x : ctx.parsed.y;
                    if (v == null) return '';
                    return ' ' + (ctx.dataset.label ? ctx.dataset.label + ': ' : '') + (unit === 'R' ? M.rand(v) : unit === 'L' ? M.litres(v) : M.kg(v));
                } } } } }, common) };
    }

    // Renders each spec off-screen and returns JPEG data URLs (used by the PDF).
    function chartImages(specs, o) {
        o = o || {};
        // w x h are CSS pixels (the PDF scales them to 250pt / 515pt wide); devicePixelRatio = scale does the doubling.
        var w = o.w || 840, h = o.h || 330, scale = o.scale || 2;
        var PC = printColors();
        var list = (specs || []).filter(function (s) { return s && !s.empty; });
        if (typeof Chart === 'undefined' || typeof document === 'undefined') return Promise.resolve([]);
        // White page behind the chart: a JPEG has no transparency, and the PDF page is white.
        var whiteBg = { id: 'rfWhiteBg', beforeDraw: function (chart) {
            var ctx = chart.ctx;
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = PC.surface;
            ctx.fillRect(0, 0, chart.width, chart.height);
            ctx.restore();
        } };
        var holder = document.createElement('div');
        holder.style.cssText = 'position:fixed;left:-12000px;top:0;width:' + w + 'px;height:' + h + 'px;pointer-events:none;';
        document.body.appendChild(holder);
        var out = [];
        function one(s) {
            return new Promise(function (resolve) {
                var canvas = document.createElement('canvas');
                canvas.width = w; canvas.height = h;
                canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
                holder.appendChild(canvas);
                var chart = null;
                try {
                    chart = new Chart(canvas, chartConfig(s, { responsive: false, scale: scale, plugins: [whiteBg], print: true }));
                    out.push({ id: s.id, dataUrl: chart.toBase64Image('image/jpeg', 0.9), w: w, h: h });
                } catch (e) {
                    if (window.console) console.warn('[ReportFigures] chart image ' + s.id + ' failed', e);
                }
                if (chart) { try { chart.destroy(); } catch (e2) { /* gone */ } }
                canvas.width = 0; canvas.height = 0;   // release the bitmap
                holder.removeChild(canvas);
                resolve();
            });
        }
        return list.reduce(function (pr, s) { return pr.then(function () { return one(s); }); }, Promise.resolve())
            .then(function () { if (holder.parentNode) holder.parentNode.removeChild(holder); return out; },
                function (e) { if (holder.parentNode) holder.parentNode.removeChild(holder); throw e; });
    }

    return {
        model: model, paint: paint, printColors: printColors, destroy: destroy, compareTile: compareTile, chartImages: chartImages,
        util: { bucketRows: bucketRows, topN: topN, spec: spec, hbarSpec: hbarSpec, barSpec: barSpec, groupedSpec: groupedSpec,
            doughnutSpec: doughnutSpec, tileOf: tileOf, tableOf: tableOf, card: card, grid: grid, newSection: newSection,
            notice: notice, collectCharts: collectCharts, fmtByUnit: fmtByUnit, kgF: kgF, kgPlain: kgPlain, zarF: zarF,
            priceF: priceF, intF: intF, pctF: pctF, isNum: isNum, num0: num0, col: col, labelsOf: labelsOf, sumOf: sumOf, DASH: DASH }
    };
}());

window.ReportFigures = ReportFigures;
