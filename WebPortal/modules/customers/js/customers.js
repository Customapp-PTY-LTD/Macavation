/**
 * Customers (route 'customers'; Mike's MacView round 3, 27 Nov 2026).
 *
 * Sales rolled up by customer for a period: invoices, kg, rand value (roles that may see prices),
 * average R/kg, products bought, last invoice, this financial year so far, and a trend against the
 * period before. Local or export, with a world map for export customers and a South Africa map for
 * local ones. A badge marks names that are on invoices but not on the customer list.
 *
 * Data: get_customer_performance(from, to) (migration 20261128110000) reads the kernel and oil
 * sales ledgers and the export register (an oil line already on the register is skipped, as in
 * Pete's reports) and the customer contacts. Nothing is re-entered here; the list stays in Contacts.
 * Rand values: the server leaves `value` empty for a role without "See costs and prices"; the page
 * also asks MacPriceAccess (view-as preview) before showing any.
 *
 * Security: every DB-sourced or typed string goes into the DOM through esc().
 */
var _customers = (function () {
    'use strict';

    var NS = '.cus';
    var HISTORY_FROM = '2015-01-01';
    var KINDS = [['kernel', 'Kernel', 'text-bg-primary'], ['oil', 'Oil', 'text-bg-warning'], ['protein', 'Protein', 'text-bg-success'],
        ['cake', 'Oil cake', 'text-bg-secondary'], ['shell', 'Shell', 'text-bg-info']];
    /* South African customer areas (MacView): [key, name, latMin, latMax, lngMin, lngMax] */
    var REGIONS = [['gauteng', 'Gauteng', -26.95, -25.3, 27.4, 28.9], ['capetown', 'Cape Town & Winelands', -34.45, -33.3, 18.1, 19.3],
        ['durban', 'Durban & Pietermaritzburg', -30.3, -29.3, 30.1, 31.5], ['ec', 'Eastern Cape', -34.2, -31.0, 24.4, 29.5]];
    /* Middle of a country, for export customers without a pin. Lower-case name or spelling -> [lat, lng, display]. */
    var COUNTRIES = {
        netherlands: [52.2, 5.3, 'Netherlands'], 'the netherlands': [52.2, 5.3, 'Netherlands'], holland: [52.2, 5.3, 'Netherlands'],
        germany: [51.2, 10.4, 'Germany'], deutschland: [51.2, 10.4, 'Germany'], spain: [40.3, -3.7, 'Spain'], mexico: [23.6, -102.5, 'Mexico'],
        usa: [39.8, -98.6, 'USA'], 'united states': [39.8, -98.6, 'USA'], 'united states of america': [39.8, -98.6, 'USA'],
        uk: [54, -2.5, 'United Kingdom'], 'united kingdom': [54, -2.5, 'United Kingdom'], england: [52.5, -1.5, 'United Kingdom'],
        france: [46.6, 2.4, 'France'], italy: [42.8, 12.5, 'Italy'], belgium: [50.6, 4.6, 'Belgium'], portugal: [39.6, -8, 'Portugal'],
        china: [35, 103, 'China'], 'hong kong': [22.3, 114.2, 'Hong Kong'], japan: [36.2, 138.3, 'Japan'], australia: [-25, 134, 'Australia'],
        canada: [56, -106, 'Canada'], switzerland: [46.8, 8.2, 'Switzerland'], austria: [47.5, 14.6, 'Austria'], vietnam: [14.1, 108.3, 'Vietnam'],
        'south korea': [36.5, 127.9, 'South Korea'], india: [21, 78, 'India'], uae: [24.3, 54.4, 'UAE'], 'united arab emirates': [24.3, 54.4, 'UAE'],
        mauritius: [-20.3, 57.6, 'Mauritius'], namibia: [-22.6, 17.1, 'Namibia'], botswana: [-22.3, 24.7, 'Botswana'], israel: [31.0, 34.9, 'Israel'],
        denmark: [56, 9.5, 'Denmark'], sweden: [62, 15, 'Sweden'], poland: [52, 19.1, 'Poland'], ireland: [53.4, -8.2, 'Ireland'], turkey: [39, 35.2, 'Turkey']
    };

    var state = { period: 'fy', kind: 'all', mkt: 'all', show: 'all', q: '', sort: null, dir: -1, cur: null, prev: null, range: null, history: null, mapView: null };

    function esc(v) { return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v); }
    function toast(msg, type) { if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(msg, type || 'success'); }
    function kg(v) { return _common.formatKg(Number(v) || 0) + ' kg'; }
    function money(v) { return v == null ? '—' : 'R ' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function day(s) { return MacPeriods.day(s); }
    function norm(s) { return String(s || '').toLowerCase().replace(/\(pty\)|\bpty\b|\bltd\b|\bcc\b|\btrading\b|\bestates?\b|[^a-z0-9]/g, ''); }
    function canPin() { return typeof window.hasAction === 'function' && !!window.hasAction('suppliers.location.edit'); }
    /** Rand values only when the server sent them AND this session (or the role being previewed) may see them. */
    function prices() { return !!(state.cur && state.cur.sees_prices) && (typeof MacPriceAccess === 'undefined' || MacPriceAccess.canSee()); }

    function keyOf(l) { return l.customer_id || ('name:' + norm(l.name || 'unknown')); }

    // ------------------------------------------------------------------ customers and figures

    /** Directory = customers on the list + names that are only on invoices. */
    function directory() {
        var C = state.cur, out = {};
        (C.customers || []).forEach(function (c) {
            out[c.id] = { key: c.id, c: c, name: c.name, listed: true, kinds: c.kinds || [], export: !!c.export, country: countryOf(c, c.export_country),
                last: c.last_invoice, fyKg: c.fy_kg, fyVal: c.fy_value, active: c.status === 'active' };
        });
        (C.unlisted || []).forEach(function (u) {
            out[u.key] = { key: u.key, c: null, name: u.name, listed: false, kinds: u.kinds || [], export: !!u.export, country: countryOf(null, u.export_country),
                last: u.last_invoice, fyKg: u.fy_kg, fyVal: u.fy_value, active: true };
        });
        return out;
    }
    function countryOf(c, exportCountry) {
        var cands = [c && c.country, exportCountry, c && c.province, c && c.city];
        for (var i = 0; i < cands.length; i++) {
            var k = String(cands[i] || '').trim().toLowerCase();
            if (k && k !== 'south africa' && COUNTRIES[k]) return COUNTRIES[k][2];
        }
        return exportCountry || null;
    }

    function stats(lines) {
        var inv = {}, s = { lines: lines.length, kg: 0, val: 0, hasVal: false, last: null, first: null };
        lines.forEach(function (l) {
            s.kg += Number(l.kg) || 0;
            if (l.value != null) { s.val += Number(l.value); s.hasVal = true; }
            inv[(l.src || '') + ':' + (l.invoice || l.date + ':' + l.kg)] = 1;
            if (l.date && (!s.last || l.date > s.last)) s.last = l.date;
            if (l.date && (!s.first || l.date < s.first)) s.first = l.date;
        });
        s.n = Object.keys(inv).length;
        s.avg = s.kg && s.hasVal ? s.val / s.kg : null;
        return s;
    }

    function kindOk(l) { return state.kind === 'all' || l.kind === state.kind; }

    function passes(d) {
        if (state.mkt !== 'all' && (state.mkt === 'export') !== d.export) return false;
        if (state.kind !== 'all' && d.kinds.indexOf(state.kind) === -1) return false;
        if (state.show === 'active' && !(d.listed && d.active)) return false;
        if (state.show === 'new' && d.listed) return false;
        var q = state.q.trim().toLowerCase();
        if (q) {
            var hay = [d.name, d.country, d.c && d.c.city, d.c && d.c.province, d.c && d.c.area, d.c && d.c.contact].join(' ').toLowerCase();
            if (hay.indexOf(q) === -1) return false;
        }
        return true;
    }

    function buyers() {
        var D = directory(), g = {}, g0 = {};
        (state.cur.lines || []).filter(kindOk).forEach(function (l) { var k = keyOf(l); (g[k] = g[k] || []).push(l); });
        ((state.prev && state.prev.lines) || []).filter(kindOk).forEach(function (l) { var k = keyOf(l); (g0[k] = g0[k] || []).push(l); });
        return Object.keys(g).map(function (k) {
            var d = D[k] || { key: k, c: null, name: g[k][0].name || 'Customer not recorded', listed: false, kinds: [], export: g[k].some(function (l) { return l.export; }), active: true };
            return { d: d, lines: g[k], st: stats(g[k]), p0: stats(g0[k] || []) };
        }).filter(function (x) { return passes(x.d); });
    }

    // ------------------------------------------------------------------ loading

    async function load() {
        var p = MacPeriods.range(state.period, $('#cusFrom').val(), $('#cusTo').val());
        state.range = p;
        $('#cusBody').html('<div class="text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading&hellip;</div>');
        var res = await Promise.all([dataFunctions.getCustomerPerformance(p.from, p.to), dataFunctions.getCustomerPerformance(p.pFrom, p.pTo)]);
        if (state.range !== p) return;
        if (!res[0]) {
            $('#cusBody').html('<div class="alert alert-warning">Customer performance is not set up on this database yet.</div>');
            return;
        }
        state.cur = res[0];
        state.prev = res[1];
        if (!state.sort) state.sort = prices() ? 'val' : 'kg';
        if (state.sort === 'val' && !prices()) state.sort = 'kg';
        render();
    }

    // ------------------------------------------------------------------ rendering

    function tile(label, value, sub, tr) {
        return '<div class="col-6 col-md-4 col-xl-2"><div class="card h-100"><div class="card-body p-2">' +
            '<div class="small text-muted">' + esc(label) + '</div><div class="fs-5 fw-semibold">' + value + '</div>' +
            (tr ? '<div>' + tr + '</div>' : '') + (sub ? '<div class="small text-muted">' + sub + '</div>' : '') + '</div></div></div>';
    }
    function th(k, label, num) {
        var on = state.sort === k;
        return '<th class="' + (num ? 'text-end ' : '') + 'cus-sort' + (on ? ' cus-on' : '') + '" data-cussort="' + k + '" role="button" tabindex="0" aria-sort="' +
            (on ? (state.dir < 0 ? 'descending' : 'ascending') : 'none') + '">' + esc(label) + (on ? (state.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>';
    }
    function kindBadges(kinds) {
        return KINDS.filter(function (k) { return kinds.indexOf(k[0]) !== -1; }).map(function (k) {
            return '<span class="badge ' + k[2] + '">' + esc(k[1]) + '</span>';
        }).join(' ');
    }
    function mktBadge(d) {
        return d.export ? '<span class="badge text-bg-info">Export' + (d.country ? ' · ' + esc(d.country) : '') + '</span>' : '<span class="badge text-bg-light border">Local</span>';
    }

    function render() {
        var C = state.cur, p = state.range;
        if (!C || !p) return;
        var R = prices();
        var list = buyers();
        var lines = [].concat.apply([], list.map(function (x) { return x.lines; }));
        var T = stats(lines);
        var prevLines = ((state.prev && state.prev.lines) || []).filter(kindOk);
        var T0 = state.prev ? stats(prevLines) : null;
        var n0 = state.prev ? Object.keys(prevLines.reduce(function (a, l) { a[keyOf(l)] = 1; return a; }, {})).length : null;
        var D = directory();
        var nList = Object.keys(D).filter(function (k) { return D[k].listed && D[k].active; }).length;
        var nNew = Object.keys(D).filter(function (k) { return !D[k].listed; }).length;
        var expKg = list.filter(function (x) { return x.d.export; }).reduce(function (a, x) { return a + x.st.kg; }, 0);

        var key = {
            val: function (x) { return x.st.val; }, kg: function (x) { return x.st.kg; }, n: function (x) { return x.st.n; },
            avg: function (x) { return x.st.avg == null ? -1 : x.st.avg; }, name: function (x) { return x.d.name.toLowerCase(); },
            last: function (x) { return x.d.last || x.st.last || ''; }
        }[state.sort] || function (x) { return x.st.kg; };
        list.sort(function (a, b) { var A = key(a), B = key(b); return (typeof A === 'string' ? A.localeCompare(B) : A - B) * state.dir; });
        var shareBase = R ? T.val : T.kg;

        var h = '<p class="small text-muted mb-2">' + esc(day(p.from)) + ' to ' + esc(day(p.to)) + ' · arrows compare with ' + esc(p.word) +
            ' (' + esc(day(p.pFrom)) + ' to ' + esc(day(p.pTo)) + ')' + (R ? ' · values excl. VAT, export in rand' : ' · your role sees kg only') + '</p>';
        h += '<div class="row g-2 mb-3">' +
            tile('Customers buying', esc(list.length), esc(nList + ' active on the list'), n0 != null ? MacPeriods.trend(list.length, n0, true) : '') +
            (R ? tile('Sales value', esc(money(T.val)), esc(T.n + ' invoice' + (T.n === 1 ? '' : 's')), T0 ? MacPeriods.trend(T.val, T0.val, true) : '') : '') +
            tile('Kg sold', esc(kg(T.kg)), R ? '' : esc(T.n + ' invoice' + (T.n === 1 ? '' : 's')), T0 ? MacPeriods.trend(T.kg, T0.kg, true) : '') +
            (R ? tile('Average price', esc(T.avg == null ? '—' : money(T.avg) + '/kg'), '', T0 && T0.avg ? MacPeriods.trend(T.avg, T0.avg, true) : '') : '') +
            tile('Export share', esc(T.kg ? Math.round(expKg / T.kg * 100) + '%' : '—'), 'of the kg sold', '') +
            tile('Not on the list', esc(nNew), 'names on invoices only', '') + '</div>';

        h += '<div class="card mb-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><strong>Sales by customer</strong>' +
            '<span class="small text-muted">click a customer for the full record · Last invoice and This year are over all time, not just the period</span></div>' +
            '<div class="table-responsive cus-scroll"><table class="table table-sm table-hover mb-0 cus-table"><thead><tr><th class="text-end">#</th>' +
            th('name', 'Customer') + th('n', 'Invoices', 1) + th('kg', 'Kg', 1) + (R ? th('val', 'Value', 1) : '') + '<th class="text-end">Share</th>' +
            (R ? th('avg', 'Avg R/kg', 1) : '') + '<th class="text-end">vs before</th><th>Products</th>' + th('last', 'Last invoice') +
            '<th class="text-end">This year' + (R ? '' : ' kg') + '</th></tr></thead><tbody>';
        h += list.map(function (x, i) {
            var cur = R ? x.st.val : x.st.kg, prev = R ? x.p0.val : x.p0.kg;
            var share = shareBase ? cur / shareBase * 100 : 0;
            return '<tr class="cus-row" data-cusopen="' + esc(x.d.key) + '" tabindex="0"><td class="text-end text-muted">' + (i + 1) + '</td>' +
                '<td><strong>' + esc(x.d.name) + '</strong> ' + mktBadge(x.d) + (!x.d.listed ? ' <span class="badge text-bg-warning" title="On invoices but not on the customer list">not on the list</span>' : '') +
                (x.d.c && (x.d.c.city || x.d.c.province) ? '<div class="small text-muted">' + esc([x.d.c.city || x.d.c.area, x.d.c.province].filter(Boolean).join(', ')) + '</div>' : '') + '</td>' +
                '<td class="text-end">' + x.st.n + '</td><td class="text-end">' + esc(_common.formatKg(x.st.kg)) + '</td>' +
                (R ? '<td class="text-end"><strong>' + esc(money(x.st.val)) + '</strong></td>' : '') +
                '<td class="text-end">' + share.toFixed(1) + '%</td>' + (R ? '<td class="text-end">' + esc(x.st.avg == null ? '—' : money(x.st.avg)) + '</td>' : '') +
                '<td class="text-end">' + (prev ? MacPeriods.trend(cur, prev, true) : '<span class="small text-muted">new</span>') + '</td>' +
                '<td>' + kindBadges(x.d.kinds.length ? x.d.kinds : x.lines.map(function (l) { return l.kind; })) + '</td>' +
                '<td>' + esc(day(x.d.last || x.st.last)) + '</td>' +
                '<td class="text-end">' + esc(R && x.d.fyVal != null ? money(x.d.fyVal) : _common.formatKg(x.d.fyKg || 0)) + '</td></tr>';
        }).join('') || '<tr><td colspan="11" class="text-center text-muted py-4">No sales in this period.</td></tr>';
        h += '</tbody></table></div></div>';

        // Map
        var view = state.mapView || (state.mkt === 'local' ? 'sa' : state.mkt === 'export' ? 'world' : 'sa');
        state.mapView = view;
        h += '<div class="card mb-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><strong>Customer map</strong>' +
            '<div class="btn-group btn-group-sm" role="group" aria-label="Map"><button type="button" class="btn btn-outline-secondary cus-mapv' + (view === 'sa' ? ' active' : '') +
            '" data-cusmap="sa" aria-pressed="' + (view === 'sa') + '">Local · South Africa</button><button type="button" class="btn btn-outline-secondary cus-mapv' +
            (view === 'world' ? ' active' : '') + '" data-cusmap="world" aria-pressed="' + (view === 'world') + '">Export · world</button></div>' +
            '<span class="ms-auto small mm-legend"><i class="mm-k-a"></i>Kernel <i class="mm-k-b"></i>Oil, protein, cake or shell <i class="mm-k-c"></i>Kernel and more</span></div>' +
            '<div class="card-body p-2"><div id="cusMap"></div><div id="cusMapNote" class="small text-muted mt-2"></div></div></div>';

        $('#cusBody').html(h);
        renderMap(list, view);
    }

    function pointOf(d) {
        var c = d.c;
        if (c && c.lat != null && c.lng != null) return { lat: Number(c.lat), lng: Number(c.lng), exact: true };
        if (!d.export) {
            var T = (window.MAP_OUTLINES && window.MAP_OUTLINES.towns) || {};
            var cands = c ? [c.city, c.area] : [];
            for (var i = 0; i < cands.length; i++) {
                var t = T[String(cands[i] || '').trim().toLowerCase()];
                if (t) return { lat: t[0], lng: t[1], exact: false };
            }
            return null;
        }
        var k = String(d.country || '').trim().toLowerCase();
        return COUNTRIES[k] ? { lat: COUNTRIES[k][0], lng: COUNTRIES[k][1], exact: false } : null;
    }

    function renderMap(list, view) {
        var byKey = {};
        list.forEach(function (x) { byKey[x.d.key] = x; });
        var D = directory();
        Object.keys(D).forEach(function (k) { if (!byKey[k] && D[k].listed && passes(D[k])) byKey[k] = { d: D[k], lines: [], st: stats([]) }; });
        var pins = [], none = [];
        var R = prices();
        Object.keys(byKey).forEach(function (k) {
            var x = byKey[k];
            if ((view === 'world') !== x.d.export) return;
            var pt = pointOf(x.d);
            if (!pt) { if (x.d.listed) none.push(x); return; }
            var kinds = x.d.kinds.length ? x.d.kinds : x.lines.map(function (l) { return l.kind; });
            var kn = kinds.indexOf('kernel') !== -1, other = kinds.some(function (q) { return q !== 'kernel'; });
            pins.push({ id: x.d.key, lat: pt.lat, lng: pt.lng, exact: pt.exact, kind: kn && other ? 'c' : other ? 'b' : 'a', value: R ? x.st.val : x.st.kg, title: x.d.name,
                lines: [x.d.export ? (x.d.country || 'Export') : [x.d.c && (x.d.c.city || x.d.c.area), x.d.c && x.d.c.province].filter(Boolean).join(', '),
                    x.st.kg ? kg(x.st.kg) + (R ? ' · ' + money(x.st.val) : '') + ' in the period' : 'No sales in the period'].filter(Boolean) });
        });
        MacMap.render(document.getElementById('cusMap'), { view: view, pins: pins, regions: view === 'sa' ? REGIONS : [], onPin: openCustomer });
        var exact = pins.filter(function (p) { return p.exact; }).length;
        $('#cusMapNote').html(esc(pins.length + ' ' + (view === 'world' ? 'export' : 'local') + ' customer' + (pins.length === 1 ? '' : 's') + ' on the map · ' + exact + ' with a GPS pin · ' +
            (pins.length - exact) + ' placed by ' + (view === 'world' ? 'country' : 'town')) +
            (none.length ? ' · <strong>' + none.length + '</strong> not on the map yet (no pin, and no ' + (view === 'world' ? 'country' : 'town') + ' we recognise)' : '') +
            (view === 'world' ? '. Put the country in the contact\'s country field in Contacts.' : ''));
    }

    // ------------------------------------------------------------------ customer record

    async function openCustomer(key) {
        var D = directory(), d = D[key];
        if (!d) {
            var l0 = (state.cur.lines || []).filter(function (l) { return keyOf(l) === key; })[0];
            d = { key: key, c: null, name: l0 ? l0.name : key.replace(/^name:/, ''), listed: false, kinds: [], export: !!(l0 && l0.export), country: null };
        }
        var c = d.c;
        $('#cusModalTitle').text(d.name);
        $('#cusModalBody').html('<div class="text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading the history&hellip;</div>');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('cusModal')).show();
        if (!state.history) state.history = await dataFunctions.getCustomerPerformance(HISTORY_FROM, MacPeriods.today());
        var H = state.history || { lines: [] };
        var R = prices() && !!(H && H.sees_prices);
        var xs = (H.lines || []).filter(function (l) { return keyOf(l) === key; });
        var L = stats(xs);

        var h = '<div class="mb-2">' + mktBadge(d) + ' ' + kindBadges(d.kinds) + '</div>';
        if (!d.listed) h += '<div class="alert alert-warning py-2">This name is on invoices but not on the customer list. Add it in Contacts (or correct the name on the invoice) so its sales count under one customer.</div>';
        h += '<div class="row g-2 mb-3">' + tile('Invoices', esc(L.n), L.first ? 'since ' + esc(day(L.first)) : '', '') + tile('Kg bought', esc(kg(L.kg)), 'all time', '') +
            (R ? tile('Value', esc(money(L.val)), 'excl. VAT', '') + tile('Average price', esc(L.avg == null ? '—' : money(L.avg) + '/kg'), '', '') : '') +
            tile('Last invoice', esc(day(L.last) || '—'), '', '') + '</div>';
        if (c) {
            var f = function (lab, v) { return v ? '<div class="col-sm-6 col-lg-4"><div class="small text-muted">' + esc(lab) + '</div><div>' + esc(v) + '</div></div>' : ''; };
            h += '<div class="row g-2 mb-2">' + f('Registered name', c.company_name !== c.name ? c.company_name : '') + f('Status', c.status === 'active' ? 'Active' : (c.status || '')) +
                f('Contact person', c.contact) + f('Cell / phone', c.phone) + f('Email', c.email) + f('Town / area', [c.city, c.area].filter(Boolean).join(', ')) +
                f('Province', c.province) + f('Country', c.country) + f('Notes', c.notes) + '</div>';
            h += '<div class="small text-muted mb-3">To change these details, open the customer in Contacts.</div>';
            if (canPin()) {
                h += '<div class="card mb-3"><div class="card-body p-2 d-flex flex-wrap gap-2 align-items-end">' +
                    '<label class="mb-0 flex-grow-1" for="cusGps"><span class="d-block small text-muted">Map pin: paste coordinates or a google.com/maps link</span>' +
                    '<input class="form-control form-control-sm" id="cusGps" placeholder="e.g. -26.10, 28.05" value="' + (c.lat != null ? esc(c.lat + ', ' + c.lng) : '') + '"></label>' +
                    '<button type="button" class="btn btn-sm btn-primary" id="cusGpsSave" data-id="' + esc(c.id) + '">Save pin</button>' +
                    (c.lat != null ? '<button type="button" class="btn btn-sm btn-outline-secondary" id="cusGpsClear" data-id="' + esc(c.id) + '">Remove pin</button>' : '') +
                    '<div class="w-100 small text-muted" id="cusGpsHint"></div></div></div>';
            }
        }
        var fy = {};
        xs.forEach(function (l) { if (!l.date) return; var y = MacPeriods.fyStart(l.date).slice(0, 4); (fy[y] = fy[y] || []).push(l); });
        var ys = Object.keys(fy).sort().reverse();
        if (ys.length) {
            h += '<h6>By financial year</h6><div class="table-responsive"><table class="table table-sm mb-3"><thead><tr><th>Year</th><th class="text-end">Invoices</th><th class="text-end">Kg</th>' +
                (R ? '<th class="text-end">Value</th><th class="text-end">Avg R/kg</th>' : '') + '<th>Products</th></tr></thead><tbody>' +
                ys.map(function (y) {
                    var t = stats(fy[y]), ks = {};
                    fy[y].forEach(function (l) { ks[l.kind] = 1; });
                    return '<tr><td>Apr ' + y + ' – Mar ' + (Number(y) + 1) + '</td><td class="text-end">' + t.n + '</td><td class="text-end">' + esc(_common.formatKg(t.kg)) + '</td>' +
                        (R ? '<td class="text-end">' + esc(money(t.val)) + '</td><td class="text-end">' + esc(t.avg == null ? '—' : money(t.avg)) + '</td>' : '') +
                        '<td>' + kindBadges(Object.keys(ks)) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }
        if (xs.length) {
            h += '<h6>Invoice lines <span class="small text-muted">newest first</span></h6><div class="table-responsive cus-scroll"><table class="table table-sm mb-0"><thead><tr><th>Date</th>' +
                '<th>Invoice</th><th>Product</th><th class="text-end">Kg</th>' + (R ? '<th class="text-end">R/kg</th><th class="text-end">Value</th>' : '') + '<th>Ledger</th></tr></thead><tbody>' +
                xs.map(function (l) {
                    return '<tr><td>' + esc(day(l.date)) + '</td><td class="text-nowrap">' + esc(l.invoice || '—') + '</td><td>' + esc(l.product || l.kind) + '</td>' +
                        '<td class="text-end">' + esc(_common.formatKg(l.kg)) + '</td>' +
                        (R ? '<td class="text-end">' + esc(l.value != null && Number(l.kg) ? money(l.value / l.kg) : '—') + '</td><td class="text-end">' + esc(money(l.value)) + '</td>' : '') +
                        '<td class="small text-muted">' + esc({ kernel: 'Kernel sales', oil: 'Oil sales', export: 'Export register', shell: 'Shell sales' }[l.src] || l.src) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        } else {
            h += '<div class="text-muted">No sales recorded for this customer yet.</div>';
        }
        $('#cusModalBody').html(h);
    }

    async function savePin(id, clear) {
        var lat = null, lng = null;
        if (!clear) {
            var g = MacMap.parseGps($('#cusGps').val());
            if (!g) { $('#cusGpsHint').text('Couldn\'t read that. Paste coordinates like -26.10, 28.05 or a full google.com/maps link.').addClass('text-danger'); return; }
            lat = g[0]; lng = g[1];
        }
        var r = await dataFunctions.setContactLocation(id, lat, lng);
        if (!r || r.success === false) { toast((r && r.error) || 'Could not save the pin.', 'error'); return; }
        toast(clear ? 'Pin removed' : 'Pin saved');
        [state.cur, state.history].forEach(function (D) { ((D && D.customers) || []).forEach(function (c) { if (c.id === id) { c.lat = lat; c.lng = lng; } }); });
        render();
        openCustomer(id);
    }

    function csv() {
        var R = prices(), list = buyers(), p = state.range;
        var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var head = ['Customer', 'On customer list', 'Market', 'Country', 'Invoices', 'Kg'].concat(R ? ['Value excl VAT', 'Avg R/kg'] : []).concat(['Products', 'Last invoice']);
        var lines = [head.join(',')];
        list.forEach(function (x) {
            lines.push([x.d.name, x.d.listed ? 'yes' : 'no', x.d.export ? 'Export' : 'Local', x.d.country || '', x.st.n, x.st.kg.toFixed(2)]
                .concat(R ? [x.st.val.toFixed(2), x.st.avg == null ? '' : x.st.avg.toFixed(2)] : [])
                .concat([x.d.kinds.join(' '), x.d.last || x.st.last || '']).map(q).join(','));
        });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
        a.download = 'customers-' + p.from + '-to-' + p.to + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    function init() {
        var $m = $('#cusModule');
        $m.off(NS);
        state.history = null;
        $('#cusPeriod').html(MacPeriods.optionsHtml(state.period));
        $('#cusKind').val(state.kind); $('#cusMkt').val(state.mkt); $('#cusShow').val(state.show); $('#cusSearch').val(state.q);
        $('.cus-custom').toggleClass('d-none', state.period !== 'custom');
        $m.on('change' + NS, '#cusPeriod', function () {
            state.period = this.value;
            $('.cus-custom').toggleClass('d-none', state.period !== 'custom');
            if (state.period === 'custom' && !$('#cusFrom').val() && state.range) { $('#cusFrom').val(state.range.from); $('#cusTo').val(state.range.to); }
            load();
        });
        $m.on('change' + NS, '#cusFrom, #cusTo', function () { if (state.period === 'custom') load(); });
        $m.on('change' + NS, '#cusKind', function () { state.kind = this.value; render(); });
        $m.on('change' + NS, '#cusMkt', function () { state.mkt = this.value; state.mapView = this.value === 'export' ? 'world' : this.value === 'local' ? 'sa' : state.mapView; render(); });
        $m.on('change' + NS, '#cusShow', function () { state.show = this.value; render(); });
        var t = null;
        $m.on('input' + NS, '#cusSearch', function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { state.q = v; render(); }, 200); });
        $m.on('click' + NS + ' keydown' + NS, '[data-cussort]', function (e) {
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            var k = $(this).attr('data-cussort');
            if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' ? 1 : -1; }
            render();
        });
        $m.on('click' + NS + ' keydown' + NS, '[data-cusopen]', function (e) {
            if (e.type === 'keydown' && e.key !== 'Enter') return;
            openCustomer($(this).attr('data-cusopen'));
        });
        $m.on('click' + NS, '[data-cusmap]', function () { state.mapView = $(this).attr('data-cusmap'); render(); });
        $m.on('click' + NS, '#cusGpsSave', function () { savePin($(this).attr('data-id'), false); });
        $m.on('click' + NS, '#cusGpsClear', function () { savePin($(this).attr('data-id'), true); });
        $m.on('click' + NS, '#cusCsv', csv);
        load();
    }

    return { init: init };
})();
