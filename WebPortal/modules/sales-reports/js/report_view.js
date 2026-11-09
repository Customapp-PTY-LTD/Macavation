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
            U.tileOf('Planned deliveries', U.kgF(cu.procurement_kg), U.intF((cu.procurement || []).length) + ' trucks'),
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
            U.notice(s, U.num0(cu.overdue_orders) + ' order' + (U.num0(cu.overdue_orders) === 1 ? ' is' : 's are') + ' overdue and still waiting to be collected.', 'danger');
        }
        return s;
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

    // Chart images (off-screen JPEGs: full width 1000x400, half 600x360, scale 2) for every chart the
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
            return RF.chartImages(ids('full'), { w: 1000, h: 400, scale: 2 });
        }).then(function (list) {
            take(list);
            return RF.chartImages(ids('half'), { w: 600, h: 360, scale: 2 });
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
