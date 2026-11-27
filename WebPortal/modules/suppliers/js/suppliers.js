/**
 * Suppliers (route 'suppliers'; Mike's MacView round 3, 27 Nov 2026).
 *
 * Ranking of suppliers by nut-in-shell kg delivered in a period, with deliveries and kg-weighted
 * SKR / USKR / moisture, arrows against the period before; oil raws received per supplier; a map
 * of South Africa with Mike's growing regions and a pin per supplier sized by kg; a supplier's
 * full record and history on click.
 *
 * Data: get_supplier_performance(from, to) (migration 20261128090000) returns every delivery in
 * the range (Pete's NIS ledger + live Grower Intake, de-duplicated by batch number), oil raw
 * receipts, and the supplier directory (CRM contacts). This screen never edits the supplier list:
 * that stays in Contacts. The only write is a supplier's map pin (suppliers.location.edit).
 *
 * No rand values on this screen, so it is visible to every role.
 * Security: every DB-sourced or typed string goes into the DOM through esc().
 */
var _suppliers = (function () {
    'use strict';

    var NS = '.sup';
    var HISTORY_FROM = '2015-01-01';
    /* Macadamia growing regions (MacView): [key, name, latMin, latMax, lngMin, lngMax]; first match wins. */
    var REGIONS = [
        ['limpopo', 'Limpopo', -24.4, -22.3, 29.3, 31.2], ['lowveld', 'Mpumalanga Lowveld', -26.3, -24.4, 30.25, 32.1],
        ['highveld', 'Highveld & Gauteng', -27, -24.4, 27, 30.25], ['pongola', 'Pongola & northern KZN', -28, -26.6, 30.5, 32.4],
        ['zululand', 'Zululand', -29.15, -28, 31.2, 32.8], ['northcoast', 'KZN North Coast', -29.95, -29.15, 30.95, 31.6],
        ['southcoast', 'KZN South Coast', -31.4, -29.95, 30.15, 31.1], ['midlands', 'KZN Midlands', -30.6, -28.6, 29.3, 30.95]
    ];

    var state = { period: 'fy', type: 'all', show: 'active', q: '', sort: 'kg', dir: -1, cur: null, prev: null, range: null, history: null };

    function esc(v) { return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v); }
    function toast(msg, type) { if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(msg, type || 'success'); }
    function kg(v) { return _common.formatKg(Number(v) || 0) + ' kg'; }
    function pct(v) { return v == null ? '—' : Number(v).toFixed(2) + '%'; }
    function day(s) { return MacPeriods.day(s); }
    function canPin() { return typeof window.hasAction === 'function' && !!window.hasAction('suppliers.location.edit'); }
    function norm(s) { return String(s || '').toLowerCase().replace(/\(pty\)|\bpty\b|\bltd\b|\bcc\b|\btrading\b|\bestates?\b|[^a-z0-9]/g, ''); }

    // ------------------------------------------------------------------ figures

    /** kg-weighted average of field k over rows that have it. */
    function wavg(rows, k) {
        var w = 0, s = 0;
        rows.forEach(function (r) { if (r[k] != null && r.kg) { w += Number(r.kg); s += Number(r[k]) * Number(r.kg); } });
        return w ? s / w : null;
    }
    function stats(rows) {
        var dates = rows.map(function (r) { return r.date; }).filter(Boolean).sort();
        return {
            n: rows.length, kg: rows.reduce(function (a, r) { return a + (Number(r.kg) || 0); }, 0),
            skr: wavg(rows, 'skr'), uskr: wavg(rows, 'uskr'), moist: wavg(rows, 'moisture'),
            first: dates[0] || null, last: dates[dates.length - 1] || null
        };
    }
    function oilStats(rows) {
        var s = { n: 0, kernel: 0, dust: 0, cracker: 0, total: 0, last: null };
        var dates = {};
        rows.forEach(function (r) {
            s.kernel += Number(r.kernel_kg) || 0; s.dust += Number(r.kernel_dust_kg) || 0; s.cracker += Number(r.cracker_dust_kg) || 0;
            if (r.date) { dates[r.date] = 1; if (!s.last || r.date > s.last) s.last = r.date; }
        });
        s.n = Object.keys(dates).length;           // a delivery = one supplier on one receiving date
        s.total = s.kernel + s.dust + s.cracker;
        return s;
    }

    /** A delivery's supplier key: the contact id, or the name it was captured under. */
    function keyOf(r) { return r.supplier_id || ('name:' + norm(r.name || 'unknown')); }

    function directory() {
        var d = (state.cur && state.cur.suppliers) || [];
        var byId = {};
        d.forEach(function (s) { byId[s.id] = s; });
        return byId;
    }

    function typesOf(s, nisRows, oilRows) {
        var t = {};
        if (s && s.type === 'nis_supplier') t.nis = 1;
        if (s && (s.type === 'oil_processor' || s.type === 'oil_ingredient_supplier')) t.oil = 1;
        if (nisRows && nisRows.length) t.nis = 1;
        if (oilRows && oilRows.length) t.oil = 1;
        return t;
    }

    /** Every supplier with its rows in the current period, filtered by type / active / search. */
    function rankRows() {
        var C = state.cur, byId = directory(), g = {}, o = {};
        (C.deliveries || []).forEach(function (r) { var k = keyOf(r); (g[k] = g[k] || []).push(r); });
        (C.oil || []).forEach(function (r) { var k = keyOf(r); (o[k] = o[k] || []).push(r); });
        var keys = {};
        Object.keys(g).concat(Object.keys(o)).forEach(function (k) { keys[k] = 1; });
        var q = state.q.trim().toLowerCase();
        return Object.keys(keys).map(function (k) {
            var s = byId[k] || null, rows = g[k] || [], orows = o[k] || [];
            var name = s ? s.name : ((rows[0] || orows[0] || {}).name || 'Supplier not recorded');
            return { key: k, s: s, name: name, rows: rows, orows: orows, t: typesOf(s, rows, orows), st: stats(rows), ost: oilStats(orows),
                own: orows.some(function (r) { return r.own; }) };
        }).filter(function (x) {
            if (state.type !== 'all' && !x.t[state.type]) return false;
            if (state.show === 'active' && x.s && x.s.status && x.s.status !== 'active') return false;
            if (q) {
                var hay = [x.name, x.s && x.s.number, x.s && x.s.area, x.s && x.s.city, x.s && x.s.province, x.s && x.s.contact].join(' ').toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
    }

    // ------------------------------------------------------------------ loading

    async function load() {
        var p = MacPeriods.range(state.period, $('#supFrom').val(), $('#supTo').val());
        state.range = p;
        $('#supBody').html('<div class="text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading&hellip;</div>');
        var res = await Promise.all([dataFunctions.getSupplierPerformance(p.from, p.to), dataFunctions.getSupplierPerformance(p.pFrom, p.pTo)]);
        if (state.range !== p) return;
        if (!res[0]) {
            $('#supBody').html('<div class="alert alert-warning">Supplier performance is not set up on this database yet.</div>');
            return;
        }
        state.cur = res[0];
        state.prev = res[1];
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
        return '<th class="' + (num ? 'text-end ' : '') + 'sup-sort' + (on ? ' sup-on' : '') + '" data-supsort="' + k + '" role="button" tabindex="0" aria-sort="' +
            (on ? (state.dir < 0 ? 'descending' : 'ascending') : 'none') + '">' + esc(label) + (on ? (state.dir < 0 ? ' ▼' : ' ▲') : '') + '</th>';
    }

    function place(s) { return s ? [s.area || s.city, s.province].filter(Boolean).join(', ') : ''; }

    function render() {
        var C = state.cur, p = state.range;
        if (!C || !p) return;
        var list = rankRows();
        var nisList = list.filter(function (x) { return x.rows.length; });
        var allRows = [].concat.apply([], nisList.map(function (x) { return x.rows; }));
        var T = stats(allRows);
        var P = state.prev;
        var T0 = P ? stats(P.deliveries || []) : null;
        var n0 = P ? Object.keys((P.deliveries || []).reduce(function (a, r) { a[keyOf(r)] = 1; return a; }, {})).length : null;
        var dirAll = C.suppliers || [];
        var nActive = dirAll.filter(function (s) { return s.status === 'active'; }).length;

        var key = {
            kg: function (x) { return x.st.kg; }, n: function (x) { return x.st.n; },
            skr: function (x) { return x.st.skr == null ? -1 : x.st.skr; }, uskr: function (x) { return x.st.uskr == null ? 999 : x.st.uskr; },
            moist: function (x) { return x.st.moist == null ? 999 : x.st.moist; }, name: function (x) { return x.name.toLowerCase(); },
            last: function (x) { return x.st.last || ''; }
        }[state.sort];
        nisList.sort(function (a, b) {
            var A = key(a), B = key(b);
            return (typeof A === 'string' ? A.localeCompare(B) : A - B) * state.dir;
        });
        var maxKg = Math.max.apply(null, [1].concat(nisList.map(function (x) { return x.st.kg; })));
        var unmatched = nisList.filter(function (x) { return !x.s; }).length;

        var h = '<p class="small text-muted mb-2">' + esc(day(p.from)) + ' to ' + esc(day(p.to)) + ' · arrows compare with ' + esc(p.word) +
            ' (' + esc(day(p.pFrom)) + ' to ' + esc(day(p.pTo)) + ') · quality is weighted by kg</p>';
        h += '<div class="row g-2 mb-3">' +
            tile('Suppliers delivering', esc(nisList.length), esc(nActive + ' active of ' + dirAll.length + ' on the list'), n0 != null ? MacPeriods.trend(nisList.length, n0) : '') +
            tile('Nut-in-shell received', esc(kg(T.kg)), esc(T.n + ' deliver' + (T.n === 1 ? 'y' : 'ies')), T0 ? MacPeriods.trend(T.kg, T0.kg) : '') +
            tile('Average SKR', esc(pct(T.skr)), 'sound kernel recovery', T0 ? MacPeriods.trend(T.skr, T0.skr, true) : '') +
            tile('Average USKR', esc(pct(T.uskr)), 'unsound kernel', T0 ? MacPeriods.trend(T.uskr, T0.uskr, false) : '') +
            tile('Average moisture', esc(pct(T.moist)), 'at receiving', T0 ? MacPeriods.trend(T.moist, T0.moist, false) : '') +
            tile('Top supplier', esc(nisList.length ? nisList.slice().sort(function (a, b) { return b.st.kg - a.st.kg; })[0].name : '—'),
                nisList.length && T.kg ? esc(Math.round(Math.max.apply(null, nisList.map(function (x) { return x.st.kg; })) / T.kg * 100) + '% of the kg') : '', '') +
            '</div>';

        // Nut-in-shell ranking
        h += '<div class="card mb-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><strong>Nut-in-shell suppliers</strong>' +
            '<span class="small text-muted">click a supplier for the full record' + (unmatched ? ' · ' + unmatched + ' name' + (unmatched === 1 ? '' : 's') + ' on deliveries are not on the supplier list' : '') + '</span></div>' +
            '<div class="table-responsive sup-scroll"><table class="table table-sm table-hover mb-0 sup-table"><thead><tr><th class="text-end">#</th>' +
            th('name', 'Supplier') + th('n', 'Deliveries', 1) + th('kg', 'NIS kg', 1) + '<th class="text-end">Share</th>' +
            th('skr', 'SKR', 1) + th('uskr', 'USKR', 1) + th('moist', 'Moisture', 1) + th('last', 'Last delivery') + '</tr></thead><tbody>';
        h += nisList.map(function (x, i) {
            var share = T.kg ? x.st.kg / T.kg * 100 : 0;
            return '<tr class="sup-row" data-supopen="' + esc(x.key) + '" tabindex="0"><td class="text-end text-muted">' + (i + 1) + '</td>' +
                '<td><strong>' + esc(x.name) + '</strong>' + (x.s && x.s.number != null ? ' <span class="text-muted">#' + esc(x.s.number) + '</span>' : '') +
                (!x.s ? ' <span class="badge text-bg-warning">not on the list</span>' : '') +
                (place(x.s) ? '<div class="small text-muted">' + esc(place(x.s)) + '</div>' : '') + '</td>' +
                '<td class="text-end">' + esc(x.st.n) + '</td>' +
                '<td class="text-end"><strong>' + esc(_common.formatKg(x.st.kg)) + '</strong><div class="sup-bar"><i style="width:' + (x.st.kg / maxKg * 100).toFixed(1) + '%"></i></div></td>' +
                '<td class="text-end">' + share.toFixed(1) + '%</td>' +
                '<td class="text-end">' + esc(pct(x.st.skr)) + '</td><td class="text-end">' + esc(pct(x.st.uskr)) + '</td><td class="text-end">' + esc(pct(x.st.moist)) + '</td>' +
                '<td>' + esc(day(x.st.last)) + '</td></tr>';
        }).join('') || '<tr><td colspan="9" class="text-center text-muted py-4">No nut-in-shell deliveries in this period.</td></tr>';
        h += '</tbody></table></div></div>';

        // Oil raws ranking
        var oilList = list.filter(function (x) { return x.orows.length; }).sort(function (a, b) { return b.ost.total - a.ost.total; });
        if (state.type !== 'nis') {
            var OT = oilList.reduce(function (a, x) { a.total += x.ost.total; if (x.own) a.own += x.ost.total; return a; }, { total: 0, own: 0 });
            h += '<div class="card mb-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><strong>Oil raw material suppliers</strong>' +
                '<span class="small text-muted">a delivery is one supplier on one receiving date' +
                (OT.total ? ' · bought in ' + esc(kg(OT.total - OT.own)) + ' · in-house ' + esc(kg(OT.own)) : '') + '</span></div>' +
                '<div class="table-responsive sup-scroll"><table class="table table-sm table-hover mb-0 sup-table"><thead><tr><th>Supplier</th><th class="text-end">Deliveries</th>' +
                '<th class="text-end">Oil kernel kg</th><th class="text-end">Kernel dust kg</th><th class="text-end">Cracker dust kg</th><th class="text-end">Total kg</th><th>Last delivery</th></tr></thead><tbody>' +
                (oilList.map(function (x) {
                    return '<tr class="sup-row" data-supopen="' + esc(x.key) + '" tabindex="0"><td><strong>' + esc(x.name) + '</strong>' +
                        (x.own ? ' <span class="badge text-bg-secondary">In-house</span>' : '') + (!x.s && !x.own ? ' <span class="badge text-bg-warning">not on the list</span>' : '') + '</td>' +
                        '<td class="text-end">' + esc(x.ost.n) + '</td><td class="text-end">' + esc(_common.formatKg(x.ost.kernel)) + '</td>' +
                        '<td class="text-end">' + esc(_common.formatKg(x.ost.dust)) + '</td><td class="text-end">' + esc(_common.formatKg(x.ost.cracker)) + '</td>' +
                        '<td class="text-end"><strong>' + esc(_common.formatKg(x.ost.total)) + '</strong></td><td>' + esc(day(x.ost.last)) + '</td></tr>';
                }).join('') || '<tr><td colspan="7" class="text-center text-muted py-4">No oil raws received in this period.</td></tr>') +
                '</tbody></table></div></div>';
        }

        // Map
        h += '<div class="card mb-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><strong>Supplier map</strong>' +
            '<span class="small text-muted">pin size = kg in the period · click a pin to open the supplier · click a region box to zoom in</span>' +
            '<span class="ms-auto small mm-legend"><i class="mm-k-a"></i>Nut-in-shell <i class="mm-k-b"></i>Oil raws <i class="mm-k-c"></i>Both</span></div>' +
            '<div class="card-body p-2"><div id="supMap"></div><div id="supMapNote" class="small text-muted mt-2"></div><div id="supRegions"></div></div></div>';

        $('#supBody').html(h);
        renderMap(list);
    }

    /** Where a supplier is: its GPS pin, else its town/area from the town list. */
    function pointOf(s) {
        if (!s) return null;
        if (s.lat != null && s.lng != null) return { lat: Number(s.lat), lng: Number(s.lng), exact: true };
        var T = (window.MAP_OUTLINES && window.MAP_OUTLINES.towns) || {};
        var cands = [s.area, s.city];
        for (var i = 0; i < cands.length; i++) {
            var t = T[String(cands[i] || '').trim().toLowerCase()];
            if (t) return { lat: t[0], lng: t[1], exact: false };
        }
        return null;
    }
    function regionOf(pt) {
        if (!pt) return null;
        var r = REGIONS.filter(function (x) { return pt.lat >= x[2] && pt.lat <= x[3] && pt.lng >= x[4] && pt.lng <= x[5]; })[0];
        return r ? r[0] : 'other';
    }

    function renderMap(list) {
        // Every supplier on the list that passes the filters, even without deliveries in the period.
        var byKey = {};
        list.forEach(function (x) { byKey[x.key] = x; });
        var q = state.q.trim().toLowerCase();
        (state.cur.suppliers || []).forEach(function (s) {
            if (byKey[s.id]) return;
            var t = typesOf(s, null, null);
            if (state.type !== 'all' && !t[state.type]) return;
            if (state.show === 'active' && s.status && s.status !== 'active') return;
            if (q && [s.name, s.number, s.area, s.city, s.province].join(' ').toLowerCase().indexOf(q) === -1) return;
            byKey[s.id] = { key: s.id, s: s, name: s.name, rows: [], orows: [], t: t, st: stats([]), ost: oilStats([]) };
        });
        var all = Object.keys(byKey).map(function (k) { return byKey[k]; }).filter(function (x) { return x.s; });
        var pins = [], none = [], reg = {};
        all.forEach(function (x) {
            var pt = pointOf(x.s);
            if (!pt) { none.push(x); return; }
            var kind = x.t.nis && x.t.oil ? 'c' : x.t.oil ? 'b' : 'a';
            pins.push({ id: x.key, lat: pt.lat, lng: pt.lng, exact: pt.exact, kind: kind, value: x.st.kg + x.ost.total, title: x.name,
                lines: [place(x.s), x.st.kg ? 'NIS ' + kg(x.st.kg) + ' in the period' : '', x.ost.total ? 'Oil raws ' + kg(x.ost.total) : ''].filter(Boolean) });
            var rk = regionOf(pt);
            var R = reg[rk] = reg[rk] || { n: 0, exact: 0, kg: 0, oil: 0 };
            R.n++; if (pt.exact) R.exact++; R.kg += x.st.kg; R.oil += x.ost.total;
        });
        MacMap.render(document.getElementById('supMap'), { view: 'sa', pins: pins, regions: REGIONS, onPin: openSupplier });
        var exact = pins.filter(function (p) { return p.exact; }).length;
        $('#supMapNote').html(esc(exact + ' with a GPS pin · ' + (pins.length - exact) + ' placed by town') +
            (none.length ? ' · <strong>' + none.length + '</strong> not on the map yet (no pin, and no town we recognise)' +
                (canPin() ? '. Open a supplier to add its pin.' : '.') : ''));
        var names = REGIONS.concat([['other', 'Outside these regions']]);
        var tot = Object.keys(reg).reduce(function (a, k) { return a + reg[k].kg; }, 0);
        var rows = names.filter(function (r) { return reg[r[0]]; }).sort(function (a, b) { return reg[b[0]].kg - reg[a[0]].kg; });
        $('#supRegions').html(rows.length ? '<div class="table-responsive mt-2"><table class="table table-sm mb-0"><thead><tr><th>Region</th><th class="text-end">Suppliers</th>' +
            '<th class="text-end">GPS pinned</th><th class="text-end">NIS kg in period</th><th class="text-end">Share</th><th class="text-end">Oil raws kg</th></tr></thead><tbody>' +
            rows.map(function (r) {
                var R = reg[r[0]];
                return '<tr><td>' + esc(r[1]) + '</td><td class="text-end">' + R.n + '</td><td class="text-end">' + R.exact + '</td><td class="text-end">' +
                    esc(_common.formatKg(R.kg)) + '</td><td class="text-end">' + (tot ? (R.kg / tot * 100).toFixed(1) + '%' : '—') + '</td><td class="text-end">' + esc(_common.formatKg(R.oil)) + '</td></tr>';
            }).join('') + '</tbody></table></div>' : '');
    }

    // ------------------------------------------------------------------ supplier record

    async function openSupplier(key) {
        var byId = directory(), s = byId[key] || null;
        var name = s ? s.name : key.replace(/^name:/, '');
        var sample = ((state.cur.deliveries || []).concat(state.cur.oil || [])).filter(function (r) { return keyOf(r) === key; })[0];
        if (!s && sample) name = sample.name || name;
        $('#supModalTitle').text(name + (s && s.number != null ? '  #' + s.number : ''));
        $('#supModalBody').html('<div class="text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading the history&hellip;</div>');
        bootstrap.Modal.getOrCreateInstance(document.getElementById('supModal')).show();
        if (!state.history) state.history = await dataFunctions.getSupplierPerformance(HISTORY_FROM, MacPeriods.today());
        var H = state.history || { deliveries: [], oil: [] };
        var rows = (H.deliveries || []).filter(function (r) { return keyOf(r) === key; });
        var orows = (H.oil || []).filter(function (r) { return keyOf(r) === key; });
        var L = stats(rows), O = oilStats(orows);

        var h = '';
        if (!s) h += '<div class="alert alert-warning py-2">This name is on deliveries but is not on the supplier list. Add it in Contacts (or fix the name on the delivery) so its deliveries count under one supplier.</div>';
        h += '<div class="row g-2 mb-3">' +
            tile('Deliveries', esc(L.n), L.first ? 'since ' + esc(day(L.first)) : '', '') +
            tile('Nut-in-shell', esc(kg(L.kg)), 'all time', '') +
            tile('SKR', esc(pct(L.skr)), 'weighted by kg', '') +
            tile('USKR', esc(pct(L.uskr)), '', '') +
            tile('Moisture', esc(pct(L.moist)), '', '') +
            tile('Oil raws', esc(kg(O.total)), esc(O.n + ' deliveries'), '') + '</div>';
        if (s) {
            var f = function (l, v) { return v ? '<div class="col-sm-6 col-lg-4"><div class="small text-muted">' + esc(l) + '</div><div>' + esc(v) + '</div></div>' : ''; };
            h += '<div class="row g-2 mb-3">' + f('Supplier number', s.number) + f('Registered name', s.company_name !== s.name ? s.company_name : '') +
                f('Status', s.status === 'active' ? 'Active' : (s.status || '')) + f('Contact person', s.contact) + f('Cell / phone', s.phone) + f('Email', s.email) +
                f('Area / town', [s.area, s.city].filter(Boolean).join(', ')) + f('Province', s.province) + f('Notes', s.notes) + '</div>';
            h += '<div class="small text-muted mb-3">To change these details, open the supplier in Contacts.</div>';
            var pt = pointOf(s);
            h += '<div class="card mb-3"><div class="card-body p-2"><div class="d-flex flex-wrap gap-2 align-items-end">' +
                '<div><div class="small text-muted">Map pin</div><div>' + (pt ? (pt.exact ? esc(Number(s.lat).toFixed(5) + ', ' + Number(s.lng).toFixed(5)) +
                    ' · <a href="https://www.google.com/maps?q=' + encodeURIComponent(s.lat + ',' + s.lng) + '" target="_blank" rel="noopener noreferrer">open in Google Maps</a>'
                    : 'Placed by town (no exact pin yet)') : 'Not on the map yet') + '</div></div>';
            if (canPin()) {
                h += '<label class="mb-0 flex-grow-1" for="supGps"><span class="d-block small text-muted">Paste coordinates or a google.com/maps link</span>' +
                    '<input class="form-control form-control-sm" id="supGps" placeholder="e.g. -25.12345, 30.45678" value="' + (s.lat != null ? esc(s.lat + ', ' + s.lng) : '') + '"></label>' +
                    '<button type="button" class="btn btn-sm btn-primary" id="supGpsSave" data-id="' + esc(s.id) + '">Save pin</button>' +
                    (s.lat != null ? '<button type="button" class="btn btn-sm btn-outline-secondary" id="supGpsClear" data-id="' + esc(s.id) + '">Remove pin</button>' : '') +
                    '<div class="w-100 small text-muted" id="supGpsHint">In Google Maps, press and hold (or right-click) on the farm and copy the numbers that appear.</div>';
            }
            h += '</div></div></div>';
        }
        // By financial year
        var fy = {};
        rows.forEach(function (r) { if (!r.date) return; var y = MacPeriods.fyStart(r.date).slice(0, 4); (fy[y] = fy[y] || []).push(r); });
        var ys = Object.keys(fy).sort().reverse();
        if (ys.length) {
            h += '<h6 class="mt-2">By financial year</h6><div class="table-responsive"><table class="table table-sm mb-3"><thead><tr><th>Year</th><th class="text-end">Deliveries</th>' +
                '<th class="text-end">NIS kg</th><th class="text-end">SKR</th><th class="text-end">USKR</th><th class="text-end">Moisture</th></tr></thead><tbody>' +
                ys.map(function (y) {
                    var t = stats(fy[y]);
                    return '<tr><td>Apr ' + y + ' – Mar ' + (Number(y) + 1) + '</td><td class="text-end">' + t.n + '</td><td class="text-end">' + esc(_common.formatKg(t.kg)) +
                        '</td><td class="text-end">' + esc(pct(t.skr)) + '</td><td class="text-end">' + esc(pct(t.uskr)) + '</td><td class="text-end">' + esc(pct(t.moist)) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }
        if (rows.length) {
            h += '<h6>Nut-in-shell deliveries <span class="small text-muted">newest first</span></h6><div class="table-responsive sup-scroll"><table class="table table-sm mb-3"><thead><tr>' +
                '<th>Batch</th><th>Received</th><th class="text-end">NIS kg</th><th class="text-end">SKR</th><th class="text-end">USKR</th><th class="text-end">Moisture</th><th>From</th></tr></thead><tbody>' +
                rows.map(function (r) {
                    return '<tr><td class="text-nowrap">' + esc(r.batch || '—') + '</td><td>' + esc(day(r.date)) + '</td><td class="text-end">' + esc(_common.formatKg(r.kg)) +
                        '</td><td class="text-end">' + esc(pct(r.skr)) + '</td><td class="text-end">' + esc(pct(r.uskr)) + '</td><td class="text-end">' + esc(pct(r.moisture)) +
                        '</td><td class="small text-muted">' + (r.src === 'ledger' ? 'Procurement sheet' : 'Receiving') + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }
        if (orows.length) {
            h += '<h6>Oil raw deliveries</h6><div class="table-responsive sup-scroll"><table class="table table-sm mb-0"><thead><tr><th>Received</th>' +
                '<th class="text-end">Oil kernel kg</th><th class="text-end">Kernel dust kg</th><th class="text-end">Cracker dust kg</th></tr></thead><tbody>' +
                orows.map(function (r) {
                    return '<tr><td>' + esc(day(r.date)) + '</td><td class="text-end">' + esc(_common.formatKg(r.kernel_kg)) + '</td><td class="text-end">' +
                        esc(_common.formatKg(r.kernel_dust_kg)) + '</td><td class="text-end">' + esc(_common.formatKg(r.cracker_dust_kg)) + '</td></tr>';
                }).join('') + '</tbody></table></div>';
        }
        if (!rows.length && !orows.length) h += '<div class="text-muted">No deliveries recorded for this supplier yet.</div>';
        $('#supModalBody').html(h);
    }

    async function savePin(id, clear) {
        var lat = null, lng = null;
        if (!clear) {
            var g = MacMap.parseGps($('#supGps').val());
            if (!g) {
                $('#supGpsHint').text(/goo\.gl|maps\.app/i.test($('#supGps').val()) ? 'Short share links can\'t be read. Press and hold on the farm in Google Maps, copy the numbers that appear and paste those.'
                    : 'Couldn\'t read that. Paste coordinates like -25.12345, 30.45678 or a full google.com/maps link.').addClass('text-danger');
                return;
            }
            lat = g[0]; lng = g[1];
        }
        var r = await dataFunctions.setContactLocation(id, lat, lng);
        if (!r || r.success === false) { toast((r && r.error) || 'Could not save the pin.', 'error'); return; }
        toast(clear ? 'Pin removed' : 'Pin saved');
        [state.cur, state.history].forEach(function (D) {
            ((D && D.suppliers) || []).forEach(function (s) { if (s.id === id) { s.lat = lat; s.lng = lng; } });
        });
        render();
        openSupplier(id);
    }

    // ------------------------------------------------------------------ CSV

    function csv() {
        var list = rankRows().filter(function (x) { return x.rows.length || x.orows.length; }), p = state.range;
        var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var lines = [['Supplier', 'Supplier no.', 'On supplier list', 'Area', 'Province', 'Deliveries', 'NIS kg', 'SKR %', 'USKR %', 'Moisture %', 'Last delivery', 'Oil raws kg'].join(',')];
        list.forEach(function (x) {
            lines.push([x.name, x.s ? x.s.number : '', x.s ? 'yes' : 'no', x.s ? (x.s.area || x.s.city) : '', x.s ? x.s.province : '', x.st.n, x.st.kg.toFixed(2),
                x.st.skr == null ? '' : x.st.skr.toFixed(2), x.st.uskr == null ? '' : x.st.uskr.toFixed(2), x.st.moist == null ? '' : x.st.moist.toFixed(2),
                x.st.last || '', x.ost.total.toFixed(2)].map(q).join(','));
        });
        var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'suppliers-' + p.from + '-to-' + p.to + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    // ------------------------------------------------------------------ init

    function init() {
        var $m = $('#supModule');
        $m.off(NS);
        state.history = null;
        $('#supPeriod').html(MacPeriods.optionsHtml(state.period));
        $('#supType').val(state.type); $('#supShow').val(state.show); $('#supSearch').val(state.q);
        $('.sup-custom').toggleClass('d-none', state.period !== 'custom');
        $m.on('change' + NS, '#supPeriod', function () {
            state.period = this.value;
            $('.sup-custom').toggleClass('d-none', state.period !== 'custom');
            if (state.period === 'custom' && !$('#supFrom').val()) { $('#supFrom').val(state.range ? state.range.from : ''); $('#supTo').val(state.range ? state.range.to : ''); }
            load();
        });
        $m.on('change' + NS, '#supFrom, #supTo', function () { if (state.period === 'custom') load(); });
        $m.on('change' + NS, '#supType', function () { state.type = this.value; render(); });
        $m.on('change' + NS, '#supShow', function () { state.show = this.value; render(); });
        var t = null;
        $m.on('input' + NS, '#supSearch', function () { var v = this.value; clearTimeout(t); t = setTimeout(function () { state.q = v; render(); }, 200); });
        $m.on('click' + NS + ' keydown' + NS, '[data-supsort]', function (e) {
            if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            var k = $(this).attr('data-supsort');
            if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = (k === 'name' || k === 'uskr' || k === 'moist') ? 1 : -1; }
            render();
        });
        $m.on('click' + NS + ' keydown' + NS, '[data-supopen]', function (e) {
            if (e.type === 'keydown' && e.key !== 'Enter') return;
            openSupplier($(this).attr('data-supopen'));
        });
        $m.on('click' + NS, '#supGpsSave', function () { savePin($(this).attr('data-id'), false); });
        $m.on('click' + NS, '#supGpsClear', function () { savePin($(this).attr('data-id'), true); });
        $m.on('click' + NS, '#supCsv', csv);
        load();
    }

    return { init: init };
})();
