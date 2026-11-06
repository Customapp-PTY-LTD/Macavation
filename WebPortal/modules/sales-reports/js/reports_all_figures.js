/**
 * Management reports - the "All figures" tab (Kernel stream 1-5, Oil stream 1-5 for any period).
 *
 * Contract with the rest of the module:
 *   - reports_page.js calls _reportsAllFigures.show() the first time the tab is shown; the content goes
 *     into #reportsAllHost. init() / destroy() are also safe to call.
 *   - html/reports_all_figures.html holds the markup; this file fills it.
 *   - Data: dataFunctions.getReportsAllFigures(fromISO, toISO) -> one jsonb object
 *     { success, from, to, today, kernel:{...}, oil:{...} } (see get_reports_all_figures).
 *   - Shared helpers (period maths, tiles, charts, tables) come from MgmtDashboard
 *     (management-dashboard/js/mgmt_dashboard_common.js).
 *
 * Security invariant: every database value (grower, customer, supplier, style, notes) reaches the DOM
 * through textContent (MgmtDashboard.el / fillTable / tile) - never innerHTML. Colours come from the
 * --mac-* tokens (CSS and MgmtDashboard.colors()); this file holds no colour literals.
 * null in the data means "not available": shown as an em dash or a muted note, never as 0.
 * Events are namespaced ".raf" and removed by destroy() and at the start of init().
 */
var _reportsAllFigures = (function () {
    'use strict';

    var M = window.MgmtDashboard;
    var HTML_PATH = '/sales-reports/html/reports_all_figures.html';
    var NS = '.raf';
    var DASH = '—';
    var TOP_CUSTOMERS = 8;

    var state = { mode: 'month', anchor: null, seq: 0, data: null, oilFilter: 'all', ready: false, loading: null };

    // Every canvas this tab draws on (so destroy() clears only its own charts).
    var CANVASES = ['rafCK1', 'rafCK2', 'rafCK3a', 'rafCK3b', 'rafCK5a', 'rafCK5b', 'rafCK5c',
        'rafCO1', 'rafCO3', 'rafCO5a', 'rafCO5b', 'rafCO5c'];

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

    // ------------------------------------------------------------------
    // Small DOM helpers (textContent only).
    // ------------------------------------------------------------------

    function $id(id) { return document.getElementById(id); }

    function setNotice(id, text, kind) {
        var n = $id(id);
        if (!n) return;
        M.clear(n);
        if (!text) { n.classList.add('d-none'); return; }
        n.className = 'raf-notice raf-notice-' + (kind || 'muted');
        n.textContent = text;
    }

    // Red "Not captured" note under a section.
    function setGap(id, text) {
        var n = $id(id);
        if (!n) return;
        M.clear(n);
        if (!text) { n.classList.add('d-none'); return; }
        n.className = 'raf-gap';
        n.appendChild(M.el('b', null, 'Not captured today: '));
        n.appendChild(document.createTextNode(text));
    }

    function missingTile(label, note) {
        var t = M.tile(label, 'Not captured', note);
        t.classList.add('raf-tile-missing');
        return t;
    }

    function chartEmpty(canvasId, hint) { M.emptyBox(canvasId, 'Nothing to chart', hint || 'No figures in this period.'); }

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
    function anyPositive(arr) { return arr.some(function (v) { return v > 0; }); }

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

    function hbar(canvasId, labels, values, unit, color) {
        if (!values.length || !anyPositive(values)) { chartEmpty(canvasId); return; }
        M.fitHeight(canvasId, labels.length);
        M.drawChart(canvasId, 'hbar', labels, [{ label: '', data: values, color: color }], unit);
    }

    function timeBars(canvasId, buckets, values, unit, color) {
        if (!buckets.length) return;
        if (!anyPositive(values)) { chartEmpty(canvasId); return; }
        M.drawChart(canvasId, 'bar', labelsOf(buckets), [{ label: '', data: values, color: color }], unit);
    }

    function grouped(canvasId, buckets, series, unit, stacked) {
        if (!buckets.length) return;
        if (!series.some(function (s) { return anyPositive(s.data); })) { chartEmpty(canvasId); return; }
        M.drawGrouped(canvasId, labelsOf(buckets), series, unit, stacked);
    }

    function safeRender(name, fn) {
        try { fn(); } catch (e) {
            if (window.console) console.warn('[AllFigures] ' + name + ' failed', e);
            setNotice(name + 'Notice', 'This section could not be drawn.', 'danger');
        }
    }

    // ------------------------------------------------------------------
    // Kernel sections.
    // ------------------------------------------------------------------

    function renderK1(k, b) {
        var p = k && k.procurement;
        if (!p) { M.setTiles('rafK1Tiles', [M.tile('NIS received', DASH, 'Not available')]); setNotice('rafK1Notice', 'Procurement figures are not available for this period.'); M.fillTable('rafTK1', [{ text: 'Grower' }], []); setGap('rafK1Gap', ''); chartEmpty('rafCK1'); return; }
        setNotice('rafK1Notice', '');
        var tiles = [
            M.tile('NIS received', kgF(p.nis_kg), isNum(p.deliveries) ? M.num(p.deliveries) + ' deliveries' : ''),
            M.tile('Planned vs received', pctF(p.received_vs_plan_pct), isNum(p.planned_kg) ? 'of ' + kgF(p.planned_kg) + ' planned arrived' : 'of planned kg arrived'),
            M.tile('Growers delivering', intF(p.growers), isNum(p.planned_trucks) ? M.num(p.planned_trucks) + ' trucks planned' : '')
        ];
        if (p.cost_captured === false) tiles.push(missingTile('Cost of NIS bought', 'see red note below'));
        M.setTiles('rafK1Tiles', tiles);
        var s = bucketRows(p.by_day, b, ['received_kg', 'planned_kg']);
        grouped('rafCK1', b, [
            { label: 'Received', data: s.map(function (x) { return x.received_kg; }), color: M.colors().green },
            { label: 'Planned', data: s.map(function (x) { return x.planned_kg; }), color: M.colors().tan }
        ], 'kg', false);
        var rows = (p.by_grower || []).map(function (g) { return [g.grower, intF(g.deliveries), kgPlain(g.nis_kg)]; });
        M.fillTable('rafTK1', [{ text: 'Grower' }, { text: 'Deliveries', num: true }, { text: 'NIS (kg)', num: true }], rows,
            rows.length ? ['Total', intF(sumOf((p.by_grower || []).map(function (g) { return num0(g.deliveries); }))),
                kgPlain(sumOf((p.by_grower || []).map(function (g) { return num0(g.nis_kg); })))] : null);
        setGap('rafK1Gap', p.cost_captured === false
            ? 'the portal records how many kg came in and from which grower, but not what Macavation paid for it.' : '');
    }

    function renderK2(k) {
        var st = k && k.storage;
        if (!st) { M.setTiles('rafK2Tiles', [M.tile('NIS in storage at period end', DASH, 'Not available')]); chartEmpty('rafCK2'); M.fillTable('rafTK2', [{ text: 'Area' }], []); return; }
        if (st.available === false) {
            setNotice('rafK2Notice', st.available_from ? 'Storage tracking starts on ' + M.prettyDate(st.available_from) + '.' : 'Storage tracking is not available for this period.');
            M.setTiles('rafK2Tiles', [M.tile('NIS in storage at period end', DASH, ''), M.tile('Moved into storage', DASH, ''), M.tile('Sent to cracking', DASH, '')]);
            chartEmpty('rafCK2', 'Storage tracking had not started yet.');
            M.fillTable('rafTK2', [{ text: 'Area' }], []);
            return;
        }
        setNotice('rafK2Notice', '');
        M.setTiles('rafK2Tiles', [
            M.tile('NIS in storage at period end', kgF(st.end_kg), 'across all areas'),
            M.tile('Moved into storage', kgF(st.in_kg), 'during the period'),
            M.tile('Sent to cracking', kgF(st.out_kg), 'from silos')
        ]);
        var areas = st.by_area || [];
        hbar('rafCK2', areas.map(function (a) { return a.label || a.code; }), areas.map(function (a) { return num0(a.end_kg); }), 'kg', M.colors().green);
        var rows = areas.map(function (a) { return [a.label || a.code, kgPlain(a.in_kg), kgPlain(a.out_kg), kgPlain(a.end_kg)]; });
        M.fillTable('rafTK2', [{ text: 'Area' }, { text: 'In (kg)', num: true }, { text: 'Out (kg)', num: true }, { text: 'At end (kg)', num: true }], rows,
            rows.length ? ['Total', kgPlain(st.in_kg), kgPlain(st.out_kg), kgPlain(st.end_kg)] : null);
    }

    function renderK3(k, b) {
        var p = k && k.production;
        if (!p) { M.setTiles('rafK3Tiles', [M.tile('NIS cracked', DASH, 'Not available')]); setNotice('rafK3Notice', 'Production figures are not available for this period.'); chartEmpty('rafCK3a'); chartEmpty('rafCK3b'); M.fillTable('rafTK3', [{ text: 'By-product' }], []); return; }
        setNotice('rafK3Notice', '');
        M.setTiles('rafK3Tiles', [
            M.tile('NIS cracked', kgF(p.cracked_kg), 'closed silo runs'),
            M.tile('Kernel packed', kgF(p.sk_packed_kg), isNum(p.cartons) ? M.num(p.cartons) + ' cartons' : ''),
            M.tile('Kernel recovery', pctF(p.recovery_pct), 'packed ÷ cracked, same period'),
            M.tile('Butter (low + high oil)', kgF(p.butter_kg), 'of the packed kg')
        ]);
        var s = bucketRows(p.by_day, b, ['cracked_kg', 'sk_packed_kg']);
        timeBars('rafCK3a', b, s.map(function (x) { return x.cracked_kg; }), 'kg', M.colors().green);
        var styles = (p.packed_by_style || []).slice().sort(function (a, c) { return num0(c.kg) - num0(a.kg); });
        hbar('rafCK3b', styles.map(function (x) { return x.style; }), styles.map(function (x) { return num0(x.kg); }), 'kg', M.colors().tan);
        var bp = p.byproducts || {};
        M.fillTable('rafTK3', [{ text: 'By-product' }, { text: 'Kg', num: true }], [
            ['Oil kernel', kgPlain(bp.oil_kernel_kg)], ['Cracker dust', kgPlain(bp.cracker_dust_kg)],
            ['Shell fines', kgPlain(bp.shell_fines_kg)], ['Compost', kgPlain(bp.compost_kg)], ['Shell', kgPlain(bp.shell_kg)]
        ]);
    }

    function renderK4(k) {
        var f = k && k.finished_stock;
        var heads = [{ text: 'Style' }, { text: 'Opening (kg)', num: true }, { text: 'Packed in (kg)', num: true },
            { text: 'Out (kg)', num: true }, { text: 'Closing (kg)', num: true }, { text: 'Cartons', num: true }];
        if (!f || f.available === false) {
            setNotice('rafK4Notice', 'Finished stock figures are not available for this period.');
            M.setTiles('rafK4Tiles', [M.tile('Kernel on hand at period end', DASH, ''), M.tile('Packed in', DASH, ''), M.tile('Dispatched / adjusted out', DASH, '')]);
            M.fillTable('rafTK4', heads, []);
            return;
        }
        setNotice('rafK4Notice', '');
        M.setTiles('rafK4Tiles', [
            M.tile('Kernel on hand at period end', kgF(f.closing_kg), isNum(f.closing_cartons) ? M.num(f.closing_cartons) + ' cartons' : ''),
            M.tile('Packed in', kgF(f.packed_kg), 'during the period'),
            M.tile('Dispatched / adjusted out', kgF(f.out_kg), 'during the period')
        ]);
        var styles = f.by_style || [];
        var rows = styles.map(function (r) {
            return [r.style, kgPlain(r.opening_kg), kgPlain(r.packed_kg), kgPlain(r.out_kg), kgPlain(r.closing_kg), intF(r.closing_cartons)];
        });
        M.fillTable('rafTK4', heads, rows, rows.length ? ['Total', kgPlain(f.opening_kg), kgPlain(f.packed_kg), kgPlain(f.out_kg),
            kgPlain(f.closing_kg), intF(f.closing_cartons)] : null);
    }

    function renderK5(k, b) {
        var s = k && k.sales;
        var heads = [{ text: 'Customer' }, { text: 'Style' }, { text: 'Kg', num: true }, { text: 'Cartons', num: true },
            { text: 'Price / kg', num: true }, { text: 'Value (R)', num: true }];
        if (!s) {
            M.setTiles('rafK5Tiles', [M.tile('Kernel sold', DASH, 'Not available')]);
            setNotice('rafK5Notice', 'Sales figures are not available for this period.');
            chartEmpty('rafCK5a'); chartEmpty('rafCK5b'); chartEmpty('rafCK5c'); M.fillTable('rafTK5', heads, []);
            return;
        }
        setNotice('rafK5Notice', '');
        M.setTiles('rafK5Tiles', [
            M.tile('Kernel sold', kgF(s.kg), isNum(s.cartons) ? M.num(s.cartons) + ' cartons' : ''),
            M.tile('Sales value (excl. VAT)', zarF(s.value_zar), 'kg × price per kg'),
            M.tile('Average price', priceF(s.avg_price_per_kg), 'across all styles'),
            M.tile('Customers', intF(s.customers), 'bought in the period')
        ]);
        var cust = topN(s.by_customer, 'customer', 'value_zar', TOP_CUSTOMERS);
        hbar('rafCK5a', cust.labels, cust.values, 'R', M.colors().green);
        var sty = (s.by_style || []).filter(function (x) { return num0(x.kg) > 0; });
        if (sty.length) M.drawDoughnut('rafCK5b', sty.map(function (x) { return x.style; }), sty.map(function (x) { return num0(x.kg); }), 'kg');
        else chartEmpty('rafCK5b');
        var d = bucketRows(s.by_day, b, ['value_zar']);
        timeBars('rafCK5c', b, d.map(function (x) { return x.value_zar; }), 'R', M.colors().green);
        var lines = s.by_customer_style || [];
        var rows = lines.map(function (r) { return [r.customer, r.style, kgPlain(r.kg), intF(r.cartons), priceF(r.price_per_kg), zarF(r.value_zar)]; });
        M.fillTable('rafTK5', heads, rows, rows.length ? ['Total', '', kgPlain(s.kg), intF(s.cartons), priceF(s.avg_price_per_kg), zarF(s.value_zar)] : null);
    }

    // ------------------------------------------------------------------
    // Oil sections.
    // ------------------------------------------------------------------

    function renderO1(o, b) {
        var p = o && o.procurement;
        if (!p) { M.setTiles('rafO1Tiles', [M.tile('Oil kernel received', DASH, 'Not available')]); setNotice('rafO1Notice', 'Procurement figures are not available for this period.'); chartEmpty('rafCO1'); M.fillTable('rafTO1', [{ text: 'Supplier' }], []); setGap('rafO1Gap', ''); return; }
        setNotice('rafO1Notice', '');
        var tiles = [
            M.tile('Oil kernel received', kgF(p.oil_kernel_kg), isNum(p.food_grade_kg) ? 'of which food grade ' + kgF(p.food_grade_kg) : ''),
            M.tile('Kernel dust received', kgF(p.kernel_dust_kg), isNum(p.loads) ? M.num(p.loads) + ' loads in total' : ''),
            M.tile('Cracker dust received', kgF(p.cracker_dust_kg), 'total raws ' + kgF(p.total_kg))
        ];
        if (p.cost_captured === false) tiles.push(missingTile('Cost of raws bought', 'see red note below'));
        M.setTiles('rafO1Tiles', tiles);
        var c = M.colors();
        var s = bucketRows(p.by_day, b, ['oil_kernel_kg', 'kernel_dust_kg', 'cracker_dust_kg']);
        grouped('rafCO1', b, [
            { label: 'Oil kernel', data: s.map(function (x) { return x.oil_kernel_kg; }), color: c.green },
            { label: 'Kernel dust', data: s.map(function (x) { return x.kernel_dust_kg; }), color: c.tan },
            { label: 'Cracker dust', data: s.map(function (x) { return x.cracker_dust_kg; }), color: c.info }
        ], 'kg', true);
        var sup = p.by_supplier || [];
        var rows = sup.map(function (r) { return [r.supplier, kgPlain(r.oil_kernel_kg), kgPlain(r.kernel_dust_kg), kgPlain(r.cracker_dust_kg), kgPlain(r.total_kg)]; });
        M.fillTable('rafTO1', [{ text: 'Supplier' }, { text: 'Oil kernel', num: true }, { text: 'Kernel dust', num: true }, { text: 'Cracker dust', num: true }, { text: 'Total (kg)', num: true }], rows,
            rows.length ? ['Total', kgPlain(p.oil_kernel_kg), kgPlain(p.kernel_dust_kg), kgPlain(p.cracker_dust_kg), kgPlain(p.total_kg)] : null);
        setGap('rafO1Gap', p.cost_captured === false
            ? 'the portal records how many kg were received and from which supplier, but not what Macavation paid for them.' : '');
    }

    function renderO2(o) {
        var r = o && o.raw_stock;
        var heads = [{ text: 'Material' }, { text: 'Opening (kg)', num: true }, { text: 'Received (kg)', num: true },
            { text: 'Used (kg)', num: true }, { text: 'Closing (kg)', num: true }];
        if (!r || r.available === false) {
            M.fillTable('rafTO2', heads, []);
            setNotice('rafO2Notice', (r && r.note) || 'Raw material stock is not available for this period.');
            return;
        }
        var parts = [];
        if (r.count_date) parts.push('Starts from the stock count on ' + M.prettyDate(r.count_date) + '.');
        if (r.note) parts.push(r.note);
        setNotice('rafO2Notice', parts.join(' '));
        M.fillTable('rafTO2', heads, (r.materials || []).map(function (m) {
            return [m.label || m.material, kgPlain(m.opening_kg), kgPlain(m.received_kg), kgPlain(m.used_kg), kgPlain(m.closing_kg)];
        }));
    }

    function renderO3(o, b) {
        var p = o && o.production;
        if (!p) { M.setTiles('rafO3Tiles', [M.tile('Food grade oil', DASH, 'Not available')]); setNotice('rafO3Notice', 'Production figures are not available for this period.'); chartEmpty('rafCO3'); return; }
        setNotice('rafO3Notice', '');
        M.setTiles('rafO3Tiles', [
            M.tile('Food grade oil', kgF(p.food_grade_kg), 'pressed'),
            M.tile('Crude oil', kgF(p.crude_kg), isNum(p.oil_litres) ? 'all oil: ' + litresF(p.oil_litres) : 'pressed'),
            M.tile('Protein powder', kgF(p.protein_kg), 'bagged'),
            M.tile('Oil cake', kgF(p.cake_kg), 'produced')
        ]);
        var c = M.colors();
        var s = bucketRows(p.by_day, b, ['food_grade_kg', 'crude_kg', 'protein_kg', 'cake_kg']);
        grouped('rafCO3', b, [
            { label: 'Food grade', data: s.map(function (x) { return x.food_grade_kg; }), color: c.green },
            { label: 'Crude', data: s.map(function (x) { return x.crude_kg; }), color: c.tan },
            { label: 'Protein powder', data: s.map(function (x) { return x.protein_kg; }), color: c.info },
            { label: 'Oil cake', data: s.map(function (x) { return x.cake_kg; }), color: c.grid }
        ], 'kg', false);
    }

    function renderO4(o) {
        var f = o && o.finished_stock;
        var heads = [{ text: 'Product' }, { text: 'Opening (kg)', num: true }, { text: 'Produced (kg)', num: true },
            { text: 'Sold (kg)', num: true }, { text: 'Closing (kg)', num: true }];
        if (!f) { setNotice('rafO4Notice', 'Finished stock figures are not available for this period.'); M.fillTable('rafTO4', heads, []); return; }
        setNotice('rafO4Notice', '');
        M.fillTable('rafTO4', heads, (f.products || []).map(function (r) {
            var tracked = r.tracked !== false;
            return [r.label || r.product, tracked ? kgPlain(r.opening_kg) : 'Not tracked', kgPlain(r.produced_kg), kgPlain(r.sold_kg),
                tracked ? kgPlain(r.closing_kg) : 'Not tracked'];
        }));
    }

    function renderO5(o, b) {
        var s = o && o.sales;
        if (!s) {
            M.setTiles('rafO5Tiles', [M.tile('Food grade oil', DASH, 'Not available')]);
            setNotice('rafO5Notice', 'Sales figures are not available for this period.');
            chartEmpty('rafCO5a'); chartEmpty('rafCO5b'); chartEmpty('rafCO5c'); setGap('rafO5Gap', '');
            return;
        }
        setNotice('rafO5Notice', '');
        var L = s.lines || {};
        function line(label, key) {
            var l = L[key];
            return M.tile(label, l ? zarF(l.value_zar) : DASH, l ? kgF(l.kg) + ' sold' : 'Not available');
        }
        M.setTiles('rafO5Tiles', [line('Food grade oil', 'food_grade'), line('Crude oil', 'crude'), line('Protein powder', 'protein'), line('Oil cake', 'cake')]);
        var f = state.oilFilter;
        var match = function (r) { return f === 'all' || r.product === f; };
        var cust = {};
        (s.by_customer || []).filter(match).forEach(function (r) { cust[r.customer] = (cust[r.customer] || 0) + num0(r.value_zar); });
        var custRows = Object.keys(cust).map(function (k2) { return { customer: k2, value_zar: cust[k2] }; });
        var top = topN(custRows, 'customer', 'value_zar', TOP_CUSTOMERS);
        hbar('rafCO5a', top.labels, top.values, 'R', M.colors().green);
        // Value by product always shows all four lines (it is the thing the filter chooses between).
        var names = { food_grade: 'Food grade', crude: 'Crude', protein: 'Protein powder', cake: 'Oil cake', other: 'Other' };
        var pk = Object.keys(L).filter(function (k2) { return L[k2] && num0(L[k2].value_zar) > 0; });
        if (pk.length) M.drawDoughnut('rafCO5b', pk.map(function (k2) { return names[k2] || k2; }), pk.map(function (k2) { return num0(L[k2].value_zar); }), 'R');
        else chartEmpty('rafCO5b');
        var d = bucketRows((s.by_day || []).filter(match), b, ['value_zar']);
        timeBars('rafCO5c', b, d.map(function (x) { return x.value_zar; }), 'R', M.colors().tan);
        setGap('rafO5Gap', s.pricing_note || 'the Oil Dispatch screen records kg only, with no price, so oil sales reach the reports only when they are typed or imported on the Sales & Production Data page.');
    }

    // ------------------------------------------------------------------
    // Load + render.
    // ------------------------------------------------------------------

    function rangeNow() { return M.period.range(state.mode, state.anchor); }

    function updateBar() {
        var r = rangeNow();
        $('#rafLabel').text(M.period.label(state.mode, state.anchor));
        $('#rafRange').text(state.mode === 'day' ? '' : '  ' + M.prettyDate(r.from) + ' – ' + M.prettyDate(r.to));
        $('#rafModeChips button').each(function () { $(this).toggleClass('active', $(this).attr('data-mode') === state.mode); });
        $('#rafNext').prop('disabled', r.to >= M.period.todayStr());
        $('#rafRoot').toggleClass('raf-day', state.mode === 'day');
    }

    function showAlert(text) {
        var $a = $('#rafAlert');
        if (!text) { $a.addClass('d-none').empty(); return; }
        $a.removeClass('d-none').empty().append($('<div class="alert alert-danger mb-3" role="alert">').text(text));
    }

    // The wrapper may resolve to the object, to {name: object}, to {data: object} or to a one-row array.
    function normalise(raw) {
        var o = Array.isArray(raw) ? raw[0] : raw;
        if (o && o.get_reports_all_figures && typeof o.get_reports_all_figures === 'object') o = o.get_reports_all_figures;
        if (o && o.data && typeof o.data === 'object' && !('kernel' in o) && !('oil' in o)) o = o.data;
        return o && typeof o === 'object' ? o : null;
    }

    function renderAll() {
        var d = state.data;
        if (!d) return;
        var r = rangeNow();
        var b = M.period.buckets(state.mode, r.from, r.to);
        var k = d.kernel || null, o = d.oil || null;
        safeRender('rafK1', function () { renderK1(k, b); });
        safeRender('rafK2', function () { renderK2(k); });
        safeRender('rafK3', function () { renderK3(k, b); });
        safeRender('rafK4', function () { renderK4(k); });
        safeRender('rafK5', function () { renderK5(k, b); });
        safeRender('rafO1', function () { renderO1(o, b); });
        safeRender('rafO2', function () { renderO2(o); });
        safeRender('rafO3', function () { renderO3(o, b); });
        safeRender('rafO4', function () { renderO4(o); });
        safeRender('rafO5', function () { renderO5(o, b); });
    }

    function load() {
        updateBar();
        var r = rangeNow();
        var seq = ++state.seq;
        $('#rafLoading').removeClass('d-none');
        $('#rafRoot').addClass('raf-busy');
        showAlert('');
        var call;
        try {
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.getReportsAllFigures !== 'function') {
                throw new Error('The All figures data call is not available yet.');
            }
            call = Promise.resolve(dataFunctions.getReportsAllFigures(r.from, r.to));
        } catch (e) { call = Promise.reject(e); }
        return call.then(function (raw) {
            if (seq !== state.seq) return; // a newer click superseded this one
            var d = normalise(raw);
            if (!d) throw new Error('No figures came back for this period.');
            if (d.success === false) throw new Error(d.error || 'The figures could not be loaded.');
            state.data = d;
            renderAll();
        }).catch(function (e) {
            if (seq !== state.seq) return;
            state.data = null;
            CANVASES.forEach(function (id) { M.destroyChart(id); });
            showAlert('Could not load the figures: ' + (e && e.message ? e.message : 'unknown error') + '. Try again, or pick another period.');
        }).then(function () {
            if (seq !== state.seq) return;
            $('#rafLoading').addClass('d-none');
            $('#rafRoot').removeClass('raf-busy');
        });
    }

    // ------------------------------------------------------------------
    // Events and lifecycle.
    // ------------------------------------------------------------------

    function bind() {
        var $host = $('#reportsAllHost');
        $host.off(NS);
        $host.on('click' + NS, '#rafModeChips button[data-mode]', function () {
            state.mode = $(this).attr('data-mode');
            load();
        });
        $host.on('click' + NS, '#rafPrev', function () { state.anchor = M.period.step(state.mode, state.anchor, -1); load(); });
        $host.on('click' + NS, '#rafNext', function () { state.anchor = M.period.step(state.mode, state.anchor, 1); load(); });
        $host.on('click' + NS, '#rafToday', function () { state.anchor = M.period.todayStr(); load(); });
        $host.on('click' + NS, '#rafOilFilter button[data-product]', function () {
            state.oilFilter = $(this).attr('data-product');
            $('#rafOilFilter button').each(function () { $(this).toggleClass('active', $(this).attr('data-product') === state.oilFilter); });
            if (state.data) safeRender('rafO5', function () {
                var r = rangeNow();
                renderO5(state.data.oil || null, M.period.buckets(state.mode, r.from, r.to));
            });
        });
        // Jump links must not change the URL hash (the router listens to it).
        $host.on('click' + NS, '.raf-jump a[data-jump]', function (e) {
            e.preventDefault();
            var t = document.getElementById($(this).attr('data-jump'));
            if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    function destroy() {
        state.seq++; // drop any response still in flight
        $('#reportsAllHost').off(NS);
        CANVASES.forEach(function (id) { M.destroyChart(id); });
        state.ready = false;
        state.loading = null;
        state.data = null;
    }

    function ensureMarkup() {
        if (state.ready && document.getElementById('rafRoot')) return Promise.resolve(true);
        if (state.loading) return state.loading;
        var host = document.getElementById('reportsAllHost');
        if (!host) return Promise.reject(new Error('The All figures area is missing from the page.'));
        state.loading = _appRouter.fetchHtml(_appRouter.basePath + HTML_PATH).then(function (res) {
            if (!res || !res.success) throw new Error('Could not load the All figures page.');
            // Static markup shipped in html/reports_all_figures.html (no database values in it).
            $(host).html(res.data);
            if (typeof actionAccess !== 'undefined' && actionAccess.apply) actionAccess.apply(host);
            bind();
            state.ready = true;
            return true;
        }).then(function (v) { state.loading = null; return v; }, function (e) { state.loading = null; throw e; });
        return state.loading;
    }

    function init() {
        destroy();
        state.mode = 'month';
        state.anchor = M.period.todayStr();
        state.oilFilter = 'all';
        return ensureMarkup().then(load).catch(function (e) {
            $('#reportsAllHost').empty().append($('<div class="alert alert-danger" role="alert">')
                .text((e && e.message) || 'Could not load the All figures page.'));
        });
    }

    // First call builds the page; later calls (tab re-shown) just refresh if nothing is drawn yet.
    function show() {
        if (state.ready && document.getElementById('rafRoot')) { return state.data ? Promise.resolve() : load(); }
        return init();
    }

    return { init: init, show: show, destroy: destroy };
}());

window._reportsAllFigures = _reportsAllFigures;
