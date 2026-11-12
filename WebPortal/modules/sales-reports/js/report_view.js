/**
 * Management reports - the Weekly / Monthly report view ("Reports v2").
 *
 * Contract:
 *   _reportView.render(hostEl, payload) -> boolean. payload is dataFunctions.getReportView(id):
 *     {success, instance, frozen, legacy, snapshot:{figures, comparison, coming_up, built_at, version}}.
 *     Returns false for a legacy report (the editor then keeps its old accordion), true once drawn.
 *   _reportView.pdfBase64() -> Promise<base64 string, no data: prefix> / fileName() / parts(payload) / destroy().
 * Called by report_editor.js (openEmbedded with {view}); drawing is done by ReportFigures
 * (js/report_figures.js) so the look matches the "All figures" tab.
 *
 * Ids (prefix 'rv'): #rvFrozenNote, #rvAlert, #rvHeadK, #rvHeadO, #rvCW1..#rvCW4 (weekly charts),
 * #rvCFy1, #rvCFy2 (monthly FY charts), #rvSections (monthly parts 1-10), #rvComingUp with
 * tables #rvTUpProc and #rvTUpOrders.
 *
 * Security invariant: every database value reaches the DOM through textContent (MgmtDashboard.el,
 * fillTable, ReportFigures.paint) - never innerHTML. Colours come from MgmtDashboard.colors().
 * null means "not available" (an em dash); a null target is "No target set", never 0%.
 */
var _reportView = (function () {
    'use strict';

    var M = window.MgmtDashboard;
    var RF = window.ReportFigures;
    var PREFIX = 'rv';
    var U = RF.util;

    var KERNEL_KEYS = ['nis_received_kg', 'cracked_kg', 'sk_packed_kg', 'recovery_pct', 'kernel_stock_kg', 'kernel_sales_zar', 'kernel_avg_price'];
    var OIL_KEYS = ['raws_received_kg', 'food_grade_kg', 'crude_kg', 'protein_kg', 'oil_sales_zar', 'raw_stock_kg'];

    var state = { host: null, payload: null };

    function day(s) { return String(s || '').slice(0, 10); }

    function headTiles(metrics, keys, word, ytd) {
        var tiles = [];
        keys.forEach(function (k) {
            if (metrics && metrics[k]) tiles.push(RF.compareTile(metrics[k], { periodWord: word, ytd: ytd }));
        });
        if (!tiles.length) tiles.push(U.tileOf('Headline figures', U.DASH, 'Not available'));
        return tiles;
    }

    // ------------------------------------------------------------------
    // Weekly charts (all from snapshot.figures, bucketed by day).
    // ------------------------------------------------------------------

    function weeklyCharts(figures, from, to) {
        var c = M.colors();
        var k = (figures && figures.kernel) || {}, o = (figures && figures.oil) || {};
        var b = (from && to) ? M.period.buckets('week', from, to) : [];
        var cracked = U.bucketRows(k.production && k.production.by_day, b, ['cracked_kg']);
        var cust = U.topN(k.sales && k.sales.by_customer, 'customer', 'value_zar', 8);
        var prod = U.bucketRows(o.production && o.production.by_day, b, ['food_grade_kg', 'crude_kg', 'protein_kg', 'cake_kg']);
        var L = (o.sales && o.sales.lines) || {};
        var names = { food_grade: 'Food grade', crude: 'Crude', protein: 'Protein powder', cake: 'Oil cake', other: 'Other' };
        var pk = Object.keys(L).filter(function (x) { return L[x] && U.num0(L[x].value_zar) > 0; });
        return {
            CW1: U.barSpec('CW1', b, U.col(cracked, 'cracked_kg'), 'kg', c.green),
            CW2: U.hbarSpec('CW2', cust.labels, cust.values, 'R', c.green),
            CW3: U.groupedSpec('CW3', b, [
                { label: 'Food grade', data: U.col(prod, 'food_grade_kg'), color: c.green },
                { label: 'Crude', data: U.col(prod, 'crude_kg'), color: c.tan },
                { label: 'Protein powder', data: U.col(prod, 'protein_kg'), color: c.info },
                { label: 'Oil cake', data: U.col(prod, 'cake_kg'), color: c.grid }], 'kg', false),
            CW4: U.hbarSpec('CW4', pk.map(function (x) { return names[x] || x; }), pk.map(function (x) { return U.num0(L[x].value_zar); }), 'R', c.tan)
        };
    }

    // ------------------------------------------------------------------
    // Monthly FY charts (bars vs a target line).
    // ------------------------------------------------------------------

    function fyCharts(cmp) {
        var c = M.colors();
        var fm = (cmp && cmp.fy_months) || [];
        var labels = fm.map(function (r) { return M.monthLabel(String(r.month).slice(0, 7)); });
        function series(field) { return fm.map(function (r) { return U.isNum(r[field]) ? Number(r[field]) : null; }); }
        function withTarget(list) { return list.filter(function (d) { return d.type !== 'line' || anyNum(d.data); }); }
        var s1 = RF.util.spec('combo', 'CFy1', labels, withTarget([
            { label: 'Cracked', data: series('cracked_kg'), color: c.green },
            { label: 'Target', data: series('cracked_target'), color: c.tan, type: 'line', dashed: true }]), { unit: 'kg' });
        var s2 = RF.util.spec('combo', 'CFy2', labels, withTarget([
            { label: 'Kernel sales', data: series('kernel_sales_zar'), color: c.green },
            { label: 'Oil sales', data: series('oil_sales_zar'), color: c.tan },
            { label: 'Kernel target', data: series('kernel_sales_target'), color: c.green, type: 'line', dashed: true },
            { label: 'Oil target', data: series('oil_sales_target'), color: c.tan, type: 'line', dashed: true }]), { unit: 'R' });
        return { CFy1: s1, CFy2: s2 };
    }

    function anyNum(arr) { return arr.some(function (v) { return v !== null && v !== undefined; }); }

    // ------------------------------------------------------------------
    // Coming up.
    // ------------------------------------------------------------------

    function deliveriesNote(n) { return U.intF(n) + (n === 1 ? ' delivery' : ' deliveries'); }

    function comingUpSection(cu, word) {
        var s = U.newSection('ComingUp', null, 'Coming up next ' + word, 'Planned deliveries and orders to collect');
        if (!cu || cu.success === false) {
            U.notice(s, 'Coming-up figures are not available.');
            return s;
        }
        var procRows = (cu.procurement || []).map(function (r) {
            return [M.prettyDate(r.date), r.grower, r.truck || U.DASH, U.kgPlain(r.kg), r.confirmed ? 'Yes' : 'No'];
        });
        var orderRows = (cu.orders || []).map(function (r) {
            return [M.prettyDate(r.date), r.customer, U.intF(r.cartons), U.kgPlain(r.kg), U.zarF(r.value_zar), r.stage || U.DASH];
        });
        if (!procRows.length) procRows.push(['Nothing planned', '', '', '', '']);
        if (!orderRows.length) orderRows.push(['No orders to collect', '', '', '', '', '']);
        s.tiles = [
            U.tileOf('Planned deliveries', U.kgF(cu.procurement_kg), deliveriesNote((cu.procurement || []).length)),
            U.tileOf('Orders to collect', U.kgF(cu.orders_kg), U.zarF(cu.orders_zar))
        ];
        s.grids = [U.grid(2, [
            U.card('Planned deliveries', null, U.tableOf('TUpProc',
                [{ text: 'Date' }, { text: 'Grower' }, { text: 'Truck' }, { text: 'Kg', num: true }, { text: 'Confirmed' }], procRows)),
            U.card('Orders to collect', null, U.tableOf('TUpOrders',
                [{ text: 'Date' }, { text: 'Customer' }, { text: 'Cartons', num: true }, { text: 'Kg', num: true }, { text: 'Value (R)', num: true }, { text: 'Stage' }], orderRows))
        ])];
        if (U.num0(cu.overdue_orders) > 0) {
            s.gap = null;
            U.notice(s, U.num0(cu.overdue_orders) + ' earlier order' + (U.num0(cu.overdue_orders) === 1 ? ' is' : 's are') + ' still marked as not dispatched.', 'danger');
        }
        return s;
    }

    // ------------------------------------------------------------------
    // Weekly report v2 (Mike, 12 Nov 2026): one page for Kernel Processing, one for Oil Processing.
    // Built from snapshot.weekly (get_report_weekly_detail). Weekly reports published before it have no
    // snapshot.weekly and keep the older headline-tiles layout below.
    // ------------------------------------------------------------------

    var MAX_LINES = 8;   // per list; more than this shows the 7 biggest plus one "other" line
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var MATERIALS = { food_grade_kernel: 'Food Grade Oil Kernel', crude_kernel: 'Crude Grade Oil Kernel',
        kernel_dust: 'Kernel Dust', cracker_dust: 'Cracker Dust' };
    var PRODUCTS = { food_grade: 'Food grade oil', crude: 'Crude oil', protein: 'Protein powder', cake: 'Oil cake', other: 'Other' };

    // "Fri 6 Nov" from a date-only string; split, so no timezone can move it.
    function shortDay(iso) {
        var s = day(iso);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return U.DASH;
        var d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
        return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
    }

    function pctOfTarget(value, target) {
        if (!U.isNum(target) || Number(target) <= 0) return 'No target set';
        if (!U.isNum(value)) return U.DASH;
        return Math.round(Number(value) / Number(target) * 100) + '%';
    }

    function plain2(v) { return U.isNum(v) ? U.kgPlain(v) : U.DASH; }

    // Lines over MAX_LINES: keep the (MAX_LINES - 1) biggest by `key`, in their original order, and fold
    // the rest into one line built by other(restLines).
    function capLines(lines, key, other) {
        lines = lines || [];
        if (lines.length <= MAX_LINES) return lines;
        var keep = MAX_LINES - 1;
        var ranked = lines.map(function (l, i) { return { l: l, i: i }; })
            .sort(function (a, b) { return U.num0(b.l[key]) - U.num0(a.l[key]) || a.i - b.i; });
        var kept = ranked.slice(0, keep).sort(function (a, b) { return a.i - b.i; }).map(function (x) { return x.l; });
        var rest = ranked.slice(keep).map(function (x) { return x.l; });
        return kept.concat([other(rest)]);
    }

    function sumKey(lines, key) { return lines.reduce(function (s, l) { return s + U.num0(l[key]); }, 0); }

    function productionSection(id, rows, oil) {
        var s = U.newSection(id, null, 'Production', '', oil);
        var body = (rows || []).map(function (r) {
            return [r.label, plain2(r.kg), plain2(r.target), pctOfTarget(r.kg, r.target)];
        });
        s.grids = [U.grid(1, [U.card('This week against target', null, U.tableOf('T' + id,
            [{ text: 'Description' }, { text: 'Achieved (kg)', num: true }, { text: 'Target (kg)', num: true }, { text: '% of target', num: true }],
            body))])];
        return s;
    }

    // One line under a sales table: the week's target and how far along it is.
    function salesTargetLine(sales) {
        if (!U.isNum(sales.target) || Number(sales.target) <= 0) return 'Weekly sales target: no target set.';
        return 'Weekly sales target ' + U.zarF(sales.target) + ' (monthly target ÷ 4 unless a weekly one is set) · ' +
            pctOfTarget(sales.value_zar, sales.target) + ' of target.';
    }

    function kernelWeekly(wk, to, charts) {
        var k = wk.kernel || {};
        var dv = k.deliveries || {}, st = k.nis_stock || {}, sl = k.sales || {};

        var sDel = U.newSection('KW2', null, 'Nut in shell received', 'Every delivery that arrived this week');
        var dl = capLines(dv.lines, 'kg', function (rest) {
            return { d: null, supplier: 'Other deliveries (' + rest.length + ')', kg: sumKey(rest, 'kg') };
        });
        var dRows = dl.map(function (l) { return [l.d ? shortDay(l.d) : '', l.supplier, plain2(l.kg)]; });
        if (!dRows.length) dRows.push(['No deliveries this week', '', '']);
        sDel.grids = [U.grid(1, [U.card('Deliveries', null, U.tableOf('TKW2',
            [{ text: 'Date' }, { text: 'Supplier' }, { text: 'Volume (kg)', num: true }], dRows,
            dv.count ? ['Total', U.intF(dv.count) + (dv.count === 1 ? ' delivery' : ' deliveries'), plain2(dv.kg)] : null))])];

        // One line, so the Kernel page stays on one A4 page.
        var sStock = U.newSection('KW3', null, 'Nut in shell stock holding', 'All silos and storage areas');
        sStock.source = st.available
            ? 'In stock at the end of ' + shortDay(to) + ': ' + U.kgF(st.end_kg) + ' · ' +
              (U.isNum(st.weeks_on_hand) ? Number(st.weeks_on_hand).toFixed(1) + ' weeks of stock on hand' : 'weeks on hand not known') +
              ' (average cracked ' + U.kgF(st.avg_week_kg) + ' a week over the last 4 weeks).'
            : 'NIS stock is only known from ' + (st.available_from ? shortDay(st.available_from) : 'the first recorded storage movement') + '.';

        var sSales = U.newSection('KW4', null, 'Kernel sales', 'Every sale this week');
        sSales.source = salesTargetLine(sl);
        var kl = capLines(sl.lines, 'value_zar', function (rest) {
            var kg = sumKey(rest, 'kg'), zar = sumKey(rest, 'value_zar');
            return { d: null, customer: 'Other sales (' + rest.length + ' lines)', style: '', kg: kg,
                price_per_kg: kg > 0 ? zar / kg : null, value_zar: zar };
        });
        var kRows = kl.map(function (l) {
            return [l.d ? shortDay(l.d) : '', l.customer, l.style, plain2(l.kg), plain2(l.price_per_kg), plain2(l.value_zar)];
        });
        if (!kRows.length) kRows.push(['No kernel sales this week', '', '', '', '', '']);
        sSales.grids = [U.grid(1, [U.card('Sales', null, U.tableOf('TKW4',
            [{ text: 'Date' }, { text: 'Customer' }, { text: 'Style' }, { text: 'Volume (kg)', num: true },
             { text: 'Price (R/kg)', num: true }, { text: 'Total (R, excl. VAT)', num: true }], kRows,
            sl.count ? ['Total', '', '', plain2(sl.kg), U.num0(sl.kg) > 0 ? plain2(U.num0(sl.value_zar) / U.num0(sl.kg)) + ' avg' : '', plain2(sl.value_zar)] : null))])];

        var sCharts = U.newSection('KW5', null, 'This week at a glance', '');
        sCharts.grids = [U.grid(2, [U.card('NIS cracked by day (kg)', charts.CW1), U.card('Kernel sales by customer (R)', charts.CW2)])];

        return [productionSection('KW1', k.production), sDel, sStock, sSales, sCharts];
    }

    function oilWeekly(wk, charts) {
        var o = wk.oil || {};
        var ld = o.loads || {}, rs = o.raw_stock || {}, sl = o.sales || {};

        var sIn = U.newSection('OW2', null, 'Raw materials received', 'Every load this week, by type', true);
        if (ld.error) U.notice(sIn, ld.error, 'danger');
        var ll = capLines(ld.lines, 'kg', function (rest) {
            return { material: null, d: null, supplier: 'Other loads (' + rest.length + ')', kg: sumKey(rest, 'kg') };
        });
        var lRows = ll.map(function (l) {
            return [l.material ? (MATERIALS[l.material] || l.material) : '', l.d ? shortDay(l.d) : '', l.supplier, plain2(l.kg)];
        });
        if (!lRows.length) lRows.push(['No raw materials received this week', '', '', '']);
        sIn.grids = [U.grid(1, [U.card('Loads', null, U.tableOf('TOW2',
            [{ text: 'Raw material' }, { text: 'Date' }, { text: 'Supplier' }, { text: 'Volume (kg)', num: true }], lRows,
            (ld.lines || []).length ? ['Total', '', U.intF(ld.count) + (ld.count === 1 ? ' load' : ' loads'), plain2(sumKey(ld.lines, 'kg'))] : null))])];

        var sStock = U.newSection('OW3', null, 'Raw materials stock holding', 'At the end of the week', true);
        if (!rs.available) {
            U.notice(sStock, 'Raw stock is only known from the stock count' + (rs.count_date ? ' on ' + shortDay(rs.count_date) : '') + '.');
        }
        var mats = rs.materials || [];
        var onHand = mats.filter(function (m) { return U.isNum(m.on_hand_kg); });
        var used = mats.filter(function (m) { return U.isNum(m.avg_week_kg); });
        var totOn = onHand.length === mats.length && mats.length ? sumKey(mats, 'on_hand_kg') : null;
        var totUse = used.length === mats.length && mats.length ? sumKey(mats, 'avg_week_kg') : null;
        sStock.grids = [U.grid(1, [U.card('Stock on hand', null, U.tableOf('TOW3',
            [{ text: 'Raw material' }, { text: 'In stock (kg)', num: true }, { text: 'Used per week (kg)', num: true }, { text: 'Weeks on hand', num: true }],
            mats.map(function (m) {
                return [MATERIALS[m.material] || m.material, plain2(m.on_hand_kg), plain2(m.avg_week_kg),
                    U.isNum(m.weeks_on_hand) ? Number(m.weeks_on_hand).toFixed(1) : U.DASH];
            }),
            mats.length ? ['Total', plain2(totOn), plain2(totUse),
                U.isNum(totOn) && U.num0(totUse) > 0 ? (totOn / totUse).toFixed(1) : U.DASH] : null))])];
        sStock.fine = 'Weeks on hand = stock ÷ average used in oil production per week, ' +
            (U.isNum(rs.avg_days) && Number(rs.avg_days) < 28
                ? 'over the ' + rs.avg_days + ' days since the stock count (not yet a full 4 weeks).'
                : 'over the last 4 weeks.');

        var sSales = U.newSection('OW4', null, 'Oil, protein and cake sales', 'Every sale this week', true);
        sSales.source = salesTargetLine(sl);
        var ol = capLines(sl.lines, 'value_zar', function (rest) {
            return { d: null, customer: 'Other sales (' + rest.length + ' lines)', product: null, kg: sumKey(rest, 'kg'),
                currency: null, value_zar: sumKey(rest, 'value_zar') };
        });
        var oRows = ol.map(function (l) {
            var price = '';
            if (l.currency === 'USD') {
                price = U.isNum(l.price_per_kg) ? 'US$ ' + Number(l.price_per_kg).toFixed(2) + '/kg' : 'US$';
                if (U.isNum(l.usd_zar_rate)) price += ' @ R' + Number(l.usd_zar_rate).toFixed(2);
            } else if (l.currency === 'ZAR' && U.isNum(l.price_per_kg)) {
                price = 'R ' + plain2(l.price_per_kg) + '/kg';
            }
            return [l.d ? shortDay(l.d) : '', l.customer, l.product ? (PRODUCTS[l.product] || l.product) : '', plain2(l.kg), price, plain2(l.value_zar)];
        });
        if (!oRows.length) oRows.push(['No oil, protein or cake sales this week', '', '', '', '', '']);
        sSales.grids = [U.grid(1, [U.card('Sales', null, U.tableOf('TOW4',
            [{ text: 'Date' }, { text: 'Customer' }, { text: 'Product' }, { text: 'Volume (kg)', num: true },
             { text: 'Price', num: true }, { text: 'Total (R, excl. VAT)', num: true }], oRows,
            sl.count ? ['Total', '', '', plain2(sl.kg), '', plain2(sl.value_zar)] : null))])];
        if (U.num0(sl.value_usd) > 0) {
            sSales.fine = 'US dollar sales are converted to rand at the rate recorded on each invoice (US$ ' +
                plain2(sl.value_usd) + ' this week).';
        }

        var sCharts = U.newSection('OW5', null, 'This week at a glance', '', true);
        sCharts.grids = [U.grid(2, [U.card('Oil production by day (kg)', charts.CW3), U.card('Oil sales by product (R)', charts.CW4)])];

        return [productionSection('OW1', o.production, true), sIn, sStock, sSales, sCharts];
    }

    function weeklyParts(payload) {
        var inst = payload.instance || {};
        var snap = payload.snapshot;
        var cmp = snap.comparison || {};
        var from = day(inst.period_start || cmp.from), to = day(inst.period_end || cmp.to);
        var charts = weeklyCharts(snap.figures, from, to);
        return {
            weekly: true,
            from: from,
            to: to,
            top: { streams: [
                { key: 'kernel', title: 'Kernel Processing', sub: null, sections: kernelWeekly(snap.weekly, to, charts) },
                { key: 'oil', title: 'Oil Processing', sub: null, sections: oilWeekly(snap.weekly, charts) }
            ] },
            sections: null,
            // On screen only: the sent weekly PDF is two pages, Kernel then Oil.
            up: { streams: [{ key: 'upcoming', title: null, sections: [comingUpSection(snap.coming_up, 'week')] }] }
        };
    }

    // ------------------------------------------------------------------
    // Page.
    // ------------------------------------------------------------------

    // The section models for a payload: {top, sections|null, up} - painted on screen by build() and
    // drawn into the PDF by ReportFiguresPdf (so the two never disagree). null when no figures yet.
    function composeParts(payload) {
        var inst = payload.instance || {};
        var snap = payload.snapshot;
        if (!snap || !snap.comparison) return null;
        var monthly = inst.period_type === 'monthly';
        if (!monthly && snap.weekly && snap.weekly.success === true) return weeklyParts(payload);
        var word = monthly ? 'month' : 'week';
        var cmp = snap.comparison, metrics = cmp.metrics || {};
        var from = day(inst.period_start || cmp.from), to = day(inst.period_end || cmp.to);

        var headK = U.newSection('HeadK', null, 'Headline figures', monthly ? 'This month against last month, target and the year so far' : 'This week against last week and target');
        var headO = U.newSection('HeadO', null, 'Headline figures', headK.src, true);
        headK.tiles = headTiles(metrics, KERNEL_KEYS, word, monthly);
        headO.tiles = headTiles(metrics, OIL_KEYS, word, monthly);

        var streams = [
            { key: 'kernel', title: 'Kernel processing', sub: 'From nut-in-shell bought to kernel sold', sections: [headK] },
            { key: 'oil', title: 'Oil processing', sub: 'From oil raws bought to oil, protein and cake sold', sections: [headO] }
        ];
        if (monthly) {
            var fy = fyCharts(cmp);
            var trend = U.newSection('FyTrend', null, 'Financial year to date', 'Month by month against target');
            trend.grids = [U.grid(2, [U.card('NIS cracked by month vs target (kg)', fy.CFy1), U.card('Kernel and oil sales by month vs target (R)', fy.CFy2)])];
            streams.push({ key: 'fy', title: null, sections: [trend] });
        } else {
            var wc = weeklyCharts(snap.figures, from, to);
            headK.grids = [U.grid(2, [U.card('NIS cracked by day (kg)', wc.CW1), U.card('Kernel sales by customer (R)', wc.CW2)])];
            headO.grids = [U.grid(2, [U.card('Oil production by day (kg)', wc.CW3), U.card('Oil sales by product (R)', wc.CW4)])];
        }
        return {
            top: { streams: streams },
            sections: monthly ? RF.model(snap.figures || {}, { mode: 'month', from: from, to: to, oilFilter: 'all' }) : null,
            up: { streams: [{ key: 'upcoming', title: null, sections: [comingUpSection(snap.coming_up, word)] }] }
        };
    }

    function build(host, payload) {
        var inst = payload.instance || {};
        var snap = payload.snapshot;

        var root = M.el('div', 'rf-root rv-root');
        var alertEl = M.el('div', 'd-none');
        alertEl.id = 'rvAlert';
        root.appendChild(alertEl);
        var note = M.el('div', 'raf-notice raf-notice-muted');
        note.id = 'rvFrozenNote';
        var when = inst.published_at || (snap && snap.built_at);
        note.textContent = payload.frozen
            ? 'Figures frozen on ' + (when ? M.prettyDate(when) : U.DASH) + ' · version ' + (inst.version != null ? inst.version : U.DASH)
            : 'Draft — figures update until you publish';
        root.appendChild(note);
        host.appendChild(root);

        if (!snap || !snap.comparison) {
            alertEl.className = '';
            alertEl.appendChild(M.el('div', 'alert alert-warning mb-3', 'The figures for this report are not available yet. Use Refresh figures to build them.'));
            return;
        }

        var parts = composeParts(payload);
        var topHost = M.el('div'); topHost.id = 'rvTop';
        var secHost = M.el('div'); secHost.id = 'rvSections';
        var upHost = M.el('div'); upHost.id = 'rvUp';
        root.appendChild(topHost); root.appendChild(secHost); root.appendChild(upHost);
        RF.paint(topHost, parts.top, { idPrefix: PREFIX });
        if (parts.sections) RF.paint(secHost, parts.sections, { idPrefix: PREFIX });
        RF.paint(upHost, parts.up, { idPrefix: PREFIX });
    }

    function render(hostEl, payload) {
        if (!hostEl) return false;
        if (!payload || payload.legacy) return false;
        destroy(true);
        state.host = hostEl;
        state.payload = payload;
        M.clear(hostEl);
        if (payload.success === false) {
            var root = M.el('div', 'rf-root rv-root');
            var a = M.el('div', 'alert alert-danger mb-3', 'Could not load the report figures: ' + (payload.error || 'unknown error') + '.');
            a.id = 'rvAlert';
            root.appendChild(a);
            hostEl.appendChild(root);
            return true;
        }
        try {
            build(hostEl, payload);
        } catch (e) {
            if (window.console) console.warn('[reportView] render failed', e);
            M.clear(hostEl);
            var r2 = M.el('div', 'rf-root rv-root');
            var a2 = M.el('div', 'alert alert-danger mb-3', 'This report could not be drawn. Reload the page and try again.');
            a2.id = 'rvAlert';
            r2.appendChild(a2);
            hostEl.appendChild(r2);
        }
        return true;
    }

    // The weekly PDF's logo: img/report-logo.png as a data URL, or null (the PDF then prints a plain
    // "MACAVATION" wordmark). Drop Macavation's logo file at that path to use it; no code change needed.
    var LOGO_PATH = 'img/report-logo.png';
    function loadLogo() {
        if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return Promise.resolve(null);
        return fetch(LOGO_PATH, { cache: 'no-cache' }).then(function (res) {
            var type = (res.headers && res.headers.get('content-type')) || '';
            if (!res.ok || !/^image\/(png|jpeg)/i.test(type)) return null;
            return res.blob().then(function (blob) {
                return new Promise(function (resolve) {
                    var r = new FileReader();
                    r.onload = function () { resolve(typeof r.result === 'string' ? r.result : null); };
                    r.onerror = function () { resolve(null); };
                    r.readAsDataURL(blob);
                });
            });
        }).catch(function () { return null; });
    }

    // Chart images (off-screen JPEGs in CSS px: full width 840x330, half 420x250, devicePixelRatio 2) for every chart the
    // PDF draws, then ReportFiguresPdf.build, then pdfMake -> base64 (no data: prefix).
    function pdfBase64() {
        var payload = state.payload;
        if (!payload || payload.success === false || payload.legacy) return Promise.reject(new Error('no-report-view'));
        var lib = window.ReportFiguresPdf;
        if (!lib || !lib.build) return Promise.reject(new Error('builder-missing'));
        var parts = composeParts(payload) || {};
        var plan = lib.chartPlan(parts);
        function ids(size) { return plan.filter(function (p) { return p.size === size; }).map(function (p) { return p.spec; }); }
        var imgs = {};
        function take(list) { (list || []).forEach(function (i) { imgs[i.id] = i; }); }
        return lib.ensureLib().then(function () {
            return parts.weekly ? loadLogo() : null;
        }).then(function (logo) {
            parts.logo = logo;
            return RF.chartImages(ids('full'), { w: 840, h: 330, scale: 2 });
        }).then(function (list) {
            take(list);
            return RF.chartImages(ids('half'), { w: 420, h: 250, scale: 2 });
        }).then(function (list) {
            take(list);
            var docDefinition = lib.build(payload, imgs, parts);
            return new Promise(function (resolve, reject) {
                try {
                    pdfMake.createPdf(docDefinition).getBase64(function (b64) {
                        if (b64) resolve(String(b64).replace(/^data:[^,]*,/, '')); else reject(new Error('pdf-empty'));
                    });
                } catch (e) { reject(e); }
            });
        });
    }

    // ISO 8601 week number of a YYYY-MM-DD day (weeks run Monday to Sunday).
    function isoWeekKey(iso) {
        var p = day(iso).split('-');
        var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
        if (isNaN(d.getTime())) return null;
        var dow = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dow);
        var y = d.getUTCFullYear();
        var wk = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
        return y + '-W' + (wk < 10 ? '0' : '') + wk;
    }

    // e.g. Macavation-Weekly-2026-W44.pdf / Macavation-Monthly-2026-10.pdf. Must match the edge
    // function's filename rule /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.pdf$/.
    function fileName() {
        var inst = (state.payload && state.payload.instance) || {};
        var monthly = inst.period_type === 'monthly';
        var key = monthly ? day(inst.period_start).slice(0, 7) : isoWeekKey(inst.period_start);
        if (!key || !/^[0-9A-Za-z-]+$/.test(key)) key = 'report';
        return 'Macavation-' + (monthly ? 'Monthly' : 'Weekly') + '-' + key + '.pdf';
    }

    function destroy(keepHost) {
        RF.destroy(PREFIX);
        if (!keepHost && state.host) M.clear(state.host);
        if (!keepHost) { state.host = null; state.payload = null; }
    }

    return { render: render, parts: composeParts, pdfBase64: pdfBase64, fileName: fileName, destroy: function () { destroy(false); } };
}());

window._reportView = _reportView;
