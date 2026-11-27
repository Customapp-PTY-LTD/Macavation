/**
 * Transporters page (route 'transporters'; Mike's MacView, 27 Nov 2026).
 *
 * Three tabs over get_transport_sheet (migration 20261127090000_transport_rate_sheet.sql):
 *   Transporters  company details, two contacts, GIT insurance and B-BBEE (with expiry), certificates
 *   Routes        code, from, to, km; cheapest current rate per route
 *   Rates         transporter + route + rate per load + valid from / to; Renew starts the next one
 * Editing needs the transport_rates.edit action; everyone with the screen can look.
 * My Day hands over { tab, transporterId } (rates expiring) or { tab, editTransporterId } (documents).
 *
 * Security: every DB-sourced or typed string goes into the DOM through esc() or .text().
 */
var _transporters = (function () {
    'use strict';

    var NS = '.trp';
    var STATUS = [
        ['active', 'Active'], ['approved_not_used', 'Approved, not used'], ['on_hold', 'On hold'], ['inactive', 'Inactive']
    ];
    var BBBEE_LEVELS = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8',
        'Non-compliant', 'EME / QSE affidavit'];
    var DOC_WARN_DAYS = 30;

    var state = { sheet: null, tab: 'transporters', filter: '', showOld: false, modal: null, files: [], uploading: 0,
        perf: { period: 'this-month', dir: 'in', cur: null, prev: null, range: null } };

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v);
    }
    function canEdit() { return typeof window.hasAction === 'function' && !!window.hasAction('transport_rates.edit'); }
    function money(n) { return TransportRateSheet.money(n); }
    function day(iso) { return iso ? TransportRateSheet.day(iso) : ''; }
    function today() { return (state.sheet && state.sheet.today) || TransportRateSheet.todayIso(); }
    function statusLabel(k) { var s = STATUS.filter(function (x) { return x[0] === k; })[0]; return s ? s[1] : 'Active'; }
    function byId(list, id) { return (list || []).filter(function (x) { return String(x.id) === String(id); })[0] || null; }
    function addDays(iso, n) {
        var d = new Date(iso + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() + n);
        return d.toISOString().slice(0, 10);
    }
    function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5); }

    function toast(msg, type) {
        if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(msg, type || 'success');
    }

    // ------------------------------------------------------------------ loading

    async function load() {
        $('#trpNotice').empty();
        var s = await dataFunctions.getTransportSheet();
        if (!s) {
            state.sheet = null;
            $('#trpNotice').html('<div class="alert alert-warning">The rate sheet is not set up on this database yet.</div>');
            $('#trpTransportersBody, #trpRoutesBody, #trpRatesBody').empty();
            return;
        }
        state.sheet = s;
        if (typeof TransportRateSheet !== 'undefined') TransportRateSheet.clear();
        render();
    }

    // ------------------------------------------------------------------ rendering

    /** A date badge: red when past, amber within DOC_WARN_DAYS, plain otherwise. */
    function expiryCell(iso, extra) {
        if (!iso) return '<span class="text-muted">' + (extra ? esc(extra) : '—') + '</span>';
        var left = daysBetween(today(), iso);
        var cls = left < 0 ? 'bg-danger-subtle text-danger-emphasis border border-danger-subtle'
            : left <= DOC_WARN_DAYS ? 'bg-warning-subtle text-warning-emphasis border border-warning-subtle' : 'bg-light text-dark border';
        var when = left < 0 ? 'Expired ' : 'To ';
        return (extra ? '<div class="small">' + esc(extra) + '</div>' : '') +
            '<span class="badge ' + cls + '">' + when + esc(day(iso)) + '</span>';
    }

    function statusBadge(k) {
        var cls = { active: 'bg-success-subtle text-success-emphasis', on_hold: 'bg-warning-subtle text-warning-emphasis',
            inactive: 'bg-light text-muted', approved_not_used: 'bg-info-subtle text-info-emphasis' }[k] || 'bg-light text-dark';
        return '<span class="badge border ' + cls + '">' + esc(statusLabel(k)) + '</span>';
    }

    function renderTransporters() {
        var rows = (state.sheet.transporters || []).map(function (t) {
            var contact = [t.contact_name, t.contact_cell].filter(Boolean).join(' · ');
            return '<tr class="' + (t.is_active ? '' : 'trp-row-inactive') + '">' +
                '<td><div class="fw-semibold">' + esc(t.name) + '</div>' + (t.base ? '<div class="small text-muted">' + esc(t.base) + '</div>' : '') + '</td>' +
                '<td>' + statusBadge(t.status) + '</td>' +
                '<td>' + (contact ? esc(contact) : '<span class="text-muted">—</span>') +
                (t.contact_email ? '<div class="small text-muted">' + esc(t.contact_email) + '</div>' : '') + '</td>' +
                '<td>' + expiryCell(t.git_expiry, t.git_cover_zar != null ? money(t.git_cover_zar) + ' per load' : '') + '</td>' +
                '<td>' + expiryCell(t.bbbee_expiry, t.bbbee_level || '') + '</td>' +
                '<td class="text-end"><button type="button" class="btn btn-link btn-sm p-0" data-trp-act="show-rates" data-id="' + esc(t.id) + '">' + esc(t.current_rates) + '</button></td>' +
                '<td class="text-end text-nowrap"><button type="button" class="btn btn-outline-secondary btn-sm" data-trp-act="edit-transporter" data-id="' + esc(t.id) + '">' +
                (canEdit() ? 'Edit' : 'View') + '</button></td></tr>';
        }).join('');
        $('#trpTransportersBody').html(rows || '<tr><td colspan="7" class="text-center text-muted py-4">No transporters yet.</td></tr>');
    }

    function renderRoutes() {
        var rows = (state.sheet.routes || []).map(function (r) {
            var ch = TransportRateSheet.cheapestOn(state.sheet, r.id, today());
            return '<tr class="' + (r.is_active ? '' : 'trp-row-inactive') + '">' +
                '<td class="trp-code">' + esc(r.code) + (r.is_active ? '' : ' <span class="badge bg-light text-muted border">Not used</span>') + '</td>' +
                '<td>' + esc(r.origin) + '</td><td>' + esc(r.destination) + '</td>' +
                '<td class="text-end">' + (r.km != null ? esc(r.km) : '—') + '</td>' +
                '<td>' + (ch ? '<strong>' + esc(money(ch.rate_zar)) + '</strong> <span class="text-muted">' + esc(ch.transporter_name) + '</span>' : '<span class="text-muted">No current rate</span>') + '</td>' +
                '<td class="text-end">' + esc(r.current_rates) + '</td>' +
                '<td class="text-end">' + (canEdit() ? '<button type="button" class="btn btn-outline-secondary btn-sm" data-trp-act="edit-route" data-id="' + esc(r.id) + '">Edit</button>' : '') + '</td></tr>';
        }).join('');
        $('#trpRoutesBody').html(rows || '<tr><td colspan="7" class="text-center text-muted py-4">No routes yet.' +
            (canEdit() ? ' Press <strong>Add a route</strong>.' : '') + '</td></tr>');
    }

    /** A rate is "replaced" when a later rate for the same transporter + route starts after it. */
    function replacedBy(r) {
        return (state.sheet.rates || []).filter(function (o) {
            return o.id !== r.id && o.transporter_id === r.transporter_id && o.route_id === r.route_id &&
                String(o.valid_from) > String(r.valid_from) && (!o.valid_to || !r.valid_to || o.valid_to > r.valid_to);
        })[0] || null;
    }

    function renderRates() {
        var $f = $('#trpRateFilter');
        var keep = state.filter;
        $f.html('<option value="">All transporters</option>' + (state.sheet.transporters || []).map(function (t) {
            return '<option value="' + esc(t.id) + '">' + esc(t.name) + '</option>';
        }).join(''));
        $f.val(keep);
        $('#trpShowOld').prop('checked', state.showOld);
        var on = today();
        var rows = (state.sheet.rates || []).filter(function (r) {
            if (state.filter && String(r.transporter_id) !== String(state.filter)) return false;
            return state.showOld || r.status !== 'expired' || !replacedBy(r);
        }).map(function (r) {
            var cls = r.status === 'current' ? 'bg-success-subtle text-success-emphasis' : r.status === 'expired' ? 'bg-danger-subtle text-danger-emphasis' : 'bg-info-subtle text-info-emphasis';
            var label = r.status === 'current' ? 'Current' : r.status === 'expired' ? 'Expired' : 'Starts ' + day(r.valid_from);
            var soon = r.status === 'current' && r.valid_to && daysBetween(on, r.valid_to) <= 14 && !replacedBy(r);
            if (soon) { cls = 'bg-warning-subtle text-warning-emphasis'; label = 'Ends in ' + daysBetween(on, r.valid_to) + ' days'; }
            var renew = canEdit() && (soon || (r.status === 'expired' && !replacedBy(r)));
            return '<tr>' +
                '<td>' + esc(r.transporter_name) + '</td><td class="trp-code">' + esc(r.route_code) + '</td>' +
                '<td class="text-end fw-semibold">' + esc(money(r.rate_zar)) + '</td>' +
                '<td class="text-end">' + (r.per_km != null ? esc(money(r.per_km)) : '—') + '</td>' +
                '<td>' + esc(day(r.valid_from)) + '</td><td>' + (r.valid_to ? esc(day(r.valid_to)) : '<span class="text-muted">No end date</span>') + '</td>' +
                '<td><span class="badge border ' + cls + '">' + esc(label) + '</span></td>' +
                '<td class="trp-notes" title="' + esc(r.notes || '') + '">' + esc(r.notes || '') + '</td>' +
                '<td class="text-end text-nowrap">' + (canEdit()
                    ? (renew ? '<button type="button" class="btn btn-primary btn-sm me-1" data-trp-act="renew-rate" data-id="' + esc(r.id) + '">Renew</button>' : '') +
                      '<button type="button" class="btn btn-outline-secondary btn-sm" data-trp-act="edit-rate" data-id="' + esc(r.id) + '">Edit</button>'
                    : '') + '</td></tr>';
        }).join('');
        $('#trpRatesBody').html(rows || '<tr><td colspan="9" class="text-center text-muted py-4">No rates' +
            (state.filter ? ' for this transporter' : '') + ' yet.</td></tr>');
    }

    // ------------------------------------------------------------------ compare rates

    /** Routes x transporters, today's current rates; cheapest per route green, others "+x%". */
    function renderCompare() {
        var on = today();
        var current = (state.sheet.rates || []).filter(function (r) { return TransportRateSheet.statusOn(r, on) === 'current'; });
        var trIds = {};
        current.forEach(function (r) { trIds[r.transporter_id] = true; });
        var trs = (state.sheet.transporters || []).filter(function (t) { return trIds[t.id]; });
        var routes = (state.sheet.routes || []).filter(function (r) { return r.is_active; })
            .sort(function (a, b) { return (Number(b.km) || 0) - (Number(a.km) || 0) || String(a.code).localeCompare(String(b.code)); });
        if (!trs.length || !routes.length) {
            $('#trpCompareBody').html('<p class="text-muted text-center py-4 mb-0">No current rates to compare yet. Add rates on the Rates tab.</p>');
            return;
        }
        var h = '<table class="table align-middle mb-0 trp-compare"><thead><tr><th>Route</th><th class="text-end">km</th>' +
            trs.map(function (t) { return '<th class="text-end">' + esc(t.name) + '</th>'; }).join('') + '</tr></thead><tbody>';
        routes.forEach(function (ro) {
            var vals = trs.map(function (t) {
                var best = current.filter(function (r) { return r.route_id === ro.id && r.transporter_id === t.id; })
                    .sort(function (a, b) { return Number(a.rate_zar) - Number(b.rate_zar); })[0];
                return best ? Number(best.rate_zar) : null;
            });
            var have = vals.filter(function (v) { return v != null; });
            var min = have.length ? Math.min.apply(null, have) : null;
            h += '<tr><td><span class="trp-code">' + esc(ro.code) + '</span> <span class="small text-muted">' + esc(ro.origin) + '</span></td>' +
                '<td class="text-end">' + (ro.km != null ? esc(ro.km) : '—') + '</td>' +
                vals.map(function (v) {
                    if (v == null) return '<td class="text-end text-muted">—</td>';
                    var cheapest = v === min && have.length > 1;
                    var more = min > 0 && v > min ? ' <span class="small text-danger">+' + Math.round((v - min) / min * 100) + '%</span>' : '';
                    return '<td class="text-end' + (cheapest ? ' bg-success-subtle fw-semibold' : '') + '">' + esc(money(v)) + more +
                        (ro.km > 0 ? '<div class="small text-muted fw-normal">' + esc(money(v / ro.km)) + '/km</div>' : '') + '</td>';
                }).join('') + '</tr>';
        });
        $('#trpCompareBody').html(h + '</tbody></table>');
    }

    // ------------------------------------------------------------------ performance & spend

    function monthStart(iso) { return iso.slice(0, 7) + '-01'; }
    function addMonths(iso, n) {
        var d = new Date(monthStart(iso) + 'T00:00:00Z');
        d.setUTCMonth(d.getUTCMonth() + n);
        return d.toISOString().slice(0, 10);
    }
    function fyStart(iso) { var y = parseInt(iso.slice(0, 4), 10); if (parseInt(iso.slice(5, 7), 10) < 4) y--; return y + '-04-01'; }

    /** { from, to, pFrom, pTo, word } for the chosen period and the one before it. */
    function periods() {
        var t = today(), p = state.perf.period, from, to, pFrom, pTo, word;
        if (p === 'last-month') { from = addMonths(t, -1); to = addDays(monthStart(t), -1); pFrom = addMonths(t, -2); pTo = addDays(from, -1); word = 'the month before'; }
        else if (p === 'last-3') { from = addMonths(t, -2); to = t; pFrom = addMonths(t, -5); pTo = addDays(from, -1); word = 'the 3 months before'; }
        else if (p === 'fy') { from = fyStart(t); to = t; pFrom = addMonths(from, -12); pTo = addDays(pFrom, daysBetween(from, to)); word = 'the same time last year'; }
        else if (p === 'last-fy') { to = addDays(fyStart(t), -1); from = addMonths(fyStart(t), -12); pFrom = addMonths(from, -12); pTo = addDays(from, -1); word = 'the year before'; }
        else if (p === 'custom') {
            from = $('#trpFrom').val() || monthStart(t); to = $('#trpTo').val() || t;
            if (to < from) { var x = from; from = to; to = x; }
            var len = daysBetween(from, to);
            pTo = addDays(from, -1); pFrom = addDays(pTo, -len); word = 'the ' + (len + 1) + ' days before';
        } else { from = monthStart(t); to = t; pFrom = addMonths(t, -1); pTo = addDays(pFrom, daysBetween(from, to)); word = 'the same days last month'; }
        return { from: from, to: to, pFrom: pFrom, pTo: pTo, word: word };
    }

    function saving(l) {
        return l.cost != null && l.cheapest != null && Number(l.cost) > Number(l.cheapest) + 0.5 ? Number(l.cost) - Number(l.cheapest) : 0;
    }

    function agg(ls) {
        var a = { n: ls.length, kg: 0, spend: 0, pricedKg: 0, priced: 0, supplier: 0, noCost: 0, checked: 0, bad: 0, save: 0, saveN: 0, last: null, probs: {} };
        ls.forEach(function (l) {
            var kg = Number(l.kg) || 0;
            a.kg += kg;
            if (l.cost != null) { a.priced++; a.spend += Number(l.cost); a.pricedKg += kg; }
            else if (l.payer === 'supplier' || l.payer === 'customer') a.supplier++;
            else a.noCost++;
            if (l.checked) a.checked++;
            if (l.problems && l.problems.length) { a.bad++; l.problems.forEach(function (p) { a.probs[p] = (a.probs[p] || 0) + 1; }); }
            var s = saving(l);
            if (s) { a.save += s; a.saveN++; }
            if (!a.last || l.date > a.last) a.last = l.date;
        });
        a.perLoad = a.priced ? a.spend / a.priced : null;
        a.perKg = a.pricedKg ? a.spend / a.pricedKg : null;
        var top = Object.keys(a.probs).sort(function (x, y) { return a.probs[y] - a.probs[x]; })[0];
        a.topProblem = top ? top + ' (' + a.probs[top] + ')' : '';
        return a;
    }

    /** "↑ 12%" against the period before; costs going up are red. */
    function trend(cur, prev, costLike) {
        if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev) || prev === 0) return '';
        var pct = (cur - prev) / Math.abs(prev) * 100;
        if (Math.abs(pct) < 0.5) return '<span class="small text-muted">same as before</span>';
        var up = pct > 0;
        var cls = !costLike ? 'text-muted' : (up ? 'text-danger' : 'text-success');
        return '<span class="small ' + cls + '">' + (up ? '↑' : '↓') + ' ' + Math.round(Math.abs(pct)) + '%</span>';
    }

    function kgText(v) { return _common.formatKg(v) + ' kg'; }
    function perKgText(v) { return v == null ? '—' : 'R ' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }); }

    function tile(label, value, sub, tr) {
        return '<div class="col-6 col-md-4 col-xl-2"><div class="card h-100"><div class="card-body p-2">' +
            '<div class="small text-muted">' + esc(label) + '</div><div class="fs-5 fw-semibold">' + value + '</div>' +
            (tr ? '<div>' + tr + '</div>' : '') + (sub ? '<div class="small text-muted">' + sub + '</div>' : '') + '</div></div></div>';
    }

    function groupBy(ls, keyFn) {
        var g = {};
        ls.forEach(function (l) { var k = keyFn(l); (g[k] = g[k] || []).push(l); });
        return g;
    }

    async function loadPerf() {
        var p = periods();
        state.perf.range = p;
        $('#trpPerfBody').html('<div class="text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading&hellip;</div>');
        var res = await Promise.all([dataFunctions.getTransportPerformance(p.from, p.to), dataFunctions.getTransportPerformance(p.pFrom, p.pTo)]);
        if (state.perf.range !== p) return;
        if (!res[0]) {
            $('#trpPerfBody').html('<div class="alert alert-warning">Performance and spend are not set up on this database yet.</div>');
            return;
        }
        state.perf.cur = res[0].loads || [];
        state.perf.prev = res[1] ? res[1].loads || [] : null;
        renderPerf();
    }

    function renderPerf() {
        var P = state.perf, p = P.range, dir = P.dir;
        if (!P.cur || !p) return;
        var L = P.cur.filter(function (l) { return l.direction === dir; });
        var L0 = (P.prev || []).filter(function (l) { return l.direction === dir; });
        var T = agg(L), T0 = P.prev ? agg(L0) : null;
        var inbound = dir === 'in';
        var nKernel = L.filter(function (l) { return l.stream === 'kernel'; }).length, nOil = L.length - nKernel;
        var trNames = groupBy(L, function (l) { return l.transporter || 'Transporter not recorded'; });

        var h = '<p class="small text-muted mb-2">' + esc(day(p.from)) + ' to ' + esc(day(p.to)) + ' · arrows compare with ' + esc(p.word) +
            ' (' + esc(day(p.pFrom)) + ' to ' + esc(day(p.pTo)) + ')</p>';
        h += '<div class="row g-2 mb-3">' +
            tile('Loads', esc(T.n), esc((inbound ? 'nut in shell ' : 'kernel ') + nKernel + ' · oil ' + nOil), T0 ? trend(T.n, T0.n, false) : '') +
            tile('Kg moved', esc(kgText(T.kg)), esc(Object.keys(trNames).length + ' transporter' + (Object.keys(trNames).length === 1 ? '' : 's')), T0 ? trend(T.kg, T0.kg, false) : '') +
            tile('Transport spend', esc(money(T.spend)), T.perLoad != null ? esc(money(T.perLoad)) + ' per load' : 'no truck costs captured', T0 ? trend(T.spend, T0.spend, true) : '') +
            tile('Cost per kg', esc(perKgText(T.perKg)), 'loads with a truck cost', T0 ? trend(T.perKg, T0.perKg, true) : '') +
            (inbound ? tile('Failed vehicle checks', esc(T.bad) + ' <span class="small text-muted fw-normal">of ' + esc(T.checked) + '</span>',
                T.checked ? esc(Math.round(T.bad / T.checked * 100)) + '% of checked loads' : 'no loads checked', '') : '') +
            (inbound ? tile('Could have saved', esc(money(T.save)), esc(T.saveN + ' load' + (T.saveN === 1 ? '' : 's') + ' above the cheapest rate'), '') : '') +
            '</div>';

        var notes = [];
        if (T.noCost) notes.push(T.noCost + ' load' + (T.noCost === 1 ? '' : 's') + ' with no truck cost entered');
        if (T.supplier) notes.push(T.supplier + ' paid by the ' + (inbound ? 'supplier' : 'customer') + ' (counted, not added to spend)');
        var noRoute = inbound ? L.filter(function (l) { return l.stream === 'kernel' && !l.route_code; }).length : 0;
        if (noRoute) notes.push(noRoute + ' nut-in-shell load' + (noRoute === 1 ? '' : 's') + ' without a route (no saving worked out)');
        if (notes.length) h += '<p class="small text-muted">' + esc(notes.join(' · ')) + '.</p>';

        // By transporter, most spend first.
        var rows = Object.keys(trNames).map(function (nm) {
            var a = agg(trNames[nm]);
            a.nm = nm;
            a.prev = T0 ? agg(L0.filter(function (l) { return (l.transporter || 'Transporter not recorded') === nm; })) : null;
            return a;
        }).sort(function (x, y) { return y.spend - x.spend || y.n - x.n; });
        h += '<h3 class="h6 mt-3">By transporter</h3><div class="card mb-3"><div class="card-body p-0"><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr>' +
            '<th>Transporter</th><th class="text-end">Loads</th><th class="text-end">Kg moved</th><th class="text-end">Spend</th><th class="text-end">Per load</th><th class="text-end">Per kg</th>' +
            (inbound ? '<th class="text-end">Failed checks</th><th>Most common problem</th><th class="text-end">Could have saved</th>' : '') + '<th>Last load</th></tr></thead><tbody>' +
            (rows.map(function (a) {
                return '<tr><td class="fw-semibold">' + esc(a.nm) + '</td>' +
                    '<td class="text-end">' + esc(a.n) + '</td><td class="text-end">' + esc(_common.formatKg(a.kg)) + '</td>' +
                    '<td class="text-end fw-semibold">' + (a.priced ? esc(money(a.spend)) : '—') + (a.prev && a.priced ? '<div>' + trend(a.spend, a.prev.spend, true) + '</div>' : '') + '</td>' +
                    '<td class="text-end">' + (a.perLoad != null ? esc(money(a.perLoad)) : '—') + '</td>' +
                    '<td class="text-end">' + esc(perKgText(a.perKg)) + '</td>' +
                    (inbound ? '<td class="text-end">' + (a.checked ? esc(a.bad) + ' <span class="small text-muted">of ' + esc(a.checked) + '</span>' : '—') + '</td>' +
                        '<td class="small">' + esc(a.topProblem || '') + '</td>' +
                        '<td class="text-end' + (a.save ? ' text-danger' : '') + '">' + (a.save ? esc(money(a.save)) : '—') + '</td>' : '') +
                    '<td>' + esc(day(a.last)) + '</td></tr>';
            }).join('') || '<tr><td colspan="10" class="text-center text-muted py-4">No loads in this period.</td></tr>') +
            '</tbody></table></div></div></div>';

        if (inbound) {
            var byRoute = groupBy(L.filter(function (l) { return l.stream === 'kernel'; }), function (l) { return l.route_code || ''; });
            var rrows = Object.keys(byRoute).map(function (code) {
                var ls = byRoute[code], a = agg(ls);
                var ro = (state.sheet && (state.sheet.routes || []).filter(function (r) { return r.code === code; })[0]) || null;
                a.code = code; a.ro = ro;
                a.trs = Object.keys(groupBy(ls, function (l) { return l.transporter || 'Not recorded'; }));
                a.now = ro ? TransportRateSheet.cheapestOn(state.sheet, ro.id, today()) : null;
                return a;
            }).sort(function (x, y) { return (x.code ? 0 : 1) - (y.code ? 0 : 1) || y.spend - x.spend; });
            h += '<h3 class="h6">Spend by route <span class="small text-muted fw-normal">(nut in shell)</span></h3><div class="card"><div class="card-body p-0"><div class="table-responsive"><table class="table table-hover align-middle mb-0"><thead><tr>' +
                '<th>Route</th><th class="text-end">km</th><th class="text-end">Loads</th><th class="text-end">Kg</th><th class="text-end">Spend</th><th class="text-end">Avg paid per load</th>' +
                '<th>Transporters used</th><th>Cheapest rate now</th><th class="text-end">Could have saved</th></tr></thead><tbody>' +
                (rrows.map(function (a) {
                    var km = a.ro && a.ro.km > 0 ? Number(a.ro.km) : null;
                    return '<tr><td>' + (a.code ? '<span class="trp-code">' + esc(a.code) + '</span> <span class="small text-muted">' + esc(a.ro ? a.ro.origin : '') + '</span>'
                            : '<span class="text-muted">No route captured</span>') + '</td>' +
                        '<td class="text-end">' + (km != null ? esc(km) : '—') + '</td>' +
                        '<td class="text-end">' + esc(a.n) + '</td><td class="text-end">' + esc(_common.formatKg(a.kg)) + '</td>' +
                        '<td class="text-end fw-semibold">' + (a.priced ? esc(money(a.spend)) : '—') + '</td>' +
                        '<td class="text-end">' + (a.perLoad != null ? esc(money(a.perLoad)) + (km ? '<div class="small text-muted">' + esc(money(a.perLoad / km)) + '/km</div>' : '') : '—') + '</td>' +
                        '<td class="small">' + esc(a.trs.join(', ')) + '</td>' +
                        '<td>' + (a.now ? esc(money(a.now.rate_zar)) + ' <span class="small text-muted">' + esc(a.now.transporter_name) + '</span>' : '<span class="text-muted">—</span>') + '</td>' +
                        '<td class="text-end' + (a.save ? ' text-danger' : '') + '">' + (a.save ? esc(money(a.save)) : '—') + '</td></tr>';
                }).join('') || '<tr><td colspan="9" class="text-center text-muted py-4">No nut-in-shell loads in this period.</td></tr>') +
                '</tbody></table></div></div></div>' +
                '<p class="small text-muted mt-2">"Could have saved" compares what was paid for a load with the cheapest rate on its route that was current on the day (any transporter). Loads with no route, no cost, or no current rate are not counted.</p>';
        }
        $('#trpPerfBody').html(h);
    }

    var ADD_LABELS = { transporters: 'Add a transporter', routes: 'Add a route', rates: 'Add a rate' };
    var PANES = { transporters: '#trpPaneTransporters', perf: '#trpPanePerf', routes: '#trpPaneRoutes', rates: '#trpPaneRates', compare: '#trpPaneCompare' };

    function render() {
        if (!state.sheet) return;
        $('#trpModule .trp-tab').each(function () {
            var on = this.getAttribute('data-tab') === state.tab;
            $(this).toggleClass('active', on).attr('aria-selected', on ? 'true' : 'false');
        });
        Object.keys(PANES).forEach(function (k) { $(PANES[k]).toggleClass('d-none', k !== state.tab); });
        $('#trpAdd').toggleClass('d-none', !canEdit() || !ADD_LABELS[state.tab]);
        $('#trpAddLabel').text(ADD_LABELS[state.tab] || '');
        renderTransporters();
        renderRoutes();
        renderRates();
        renderCompare();
        if (state.tab === 'perf') {
            if (!state.perf.cur) loadPerf(); else renderPerf();
        }
    }

    // ------------------------------------------------------------------ edit window

    function field(id, label, value, opts) {
        opts = opts || {};
        var ro = canEdit() ? '' : ' disabled';
        var input = opts.textarea
            ? '<textarea class="form-control" id="' + id + '" rows="2"' + ro + '>' + esc(value || '') + '</textarea>'
            : '<input type="' + (opts.type || 'text') + '" class="form-control" id="' + id + '"' +
              (opts.step ? ' step="' + opts.step + '"' : '') + (opts.min != null ? ' min="' + opts.min + '"' : '') +
              (opts.max ? ' maxlength="' + opts.max + '"' : '') + (opts.ph ? ' placeholder="' + esc(opts.ph) + '"' : '') +
              ' value="' + esc(value == null ? '' : value) + '"' + ro + '>';
        return '<div class="' + (opts.col || 'col-md-6') + '"><label class="form-label" for="' + id + '">' + esc(label) +
            (opts.req ? ' <span class="text-danger">*</span>' : '') + '</label>' + input +
            (opts.hint ? '<div class="form-text">' + esc(opts.hint) + '</div>' : '') + '</div>';
    }

    function select(id, label, options, value, opts) {
        opts = opts || {};
        var ro = canEdit() ? '' : ' disabled';
        return '<div class="' + (opts.col || 'col-md-6') + '"><label class="form-label" for="' + id + '">' + esc(label) +
            (opts.req ? ' <span class="text-danger">*</span>' : '') + '</label>' +
            '<select class="form-select" id="' + id + '"' + ro + '>' + options.map(function (o) {
                return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(value == null ? '' : value) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
            }).join('') + '</select></div>';
    }

    function openModal(kind, title, bodyHtml, rec) {
        state.modal = { kind: kind, rec: rec || null };
        $('#trpModalTitle').text(title);
        $('#trpModalBody').html(bodyHtml);
        $('#trpModalError').text('');
        $('#trpModalSave').toggleClass('d-none', !canEdit()).prop('disabled', false);
        $('#trpModalRemove').toggleClass('d-none', !(kind === 'rate' && rec && rec.id && canEdit()));
        bootstrap.Modal.getOrCreateInstance(document.getElementById('trpModal')).show();
    }

    function closeModal() {
        var m = bootstrap.Modal.getInstance(document.getElementById('trpModal'));
        if (m) m.hide();
    }

    function transporterForm(t) {
        t = t || {};
        state.files = Array.isArray(t.documents) ? t.documents.slice() : [];
        var levels = [['', 'Not known']].concat(BBBEE_LEVELS.map(function (l) { return [l, l]; }));
        var h = '<div class="trp-sect">Company</div><div class="row g-3">' +
            field('trpName', 'Company name', t.name, { req: true, max: 120 }) +
            select('trpStatus', 'Status', STATUS, t.status || 'active') +
            field('trpBase', 'Province / base', t.base, { max: 120 }) +
            field('trpTruckTypes', 'Truck types offered', t.truck_types, { ph: 'e.g. Tautliner superlink, tri-axle', max: 200 }) +
            field('trpVat', 'VAT no.', t.vat_no, { max: 40 }) + '</div>' +
            '<div class="trp-sect">Contact people</div><div class="row g-3">' +
            field('trpC1Name', 'Main contact', t.contact_name, { col: 'col-md-4', max: 120 }) +
            field('trpC1Cell', 'Cell', t.contact_cell, { col: 'col-md-4', ph: '+27 82 123 4567', max: 40 }) +
            field('trpC1Email', 'Email', t.contact_email, { col: 'col-md-4', type: 'email', max: 160 }) +
            field('trpC2Name', 'Second contact (e.g. accounts)', t.contact2_name, { col: 'col-md-4', max: 120 }) +
            field('trpC2Cell', 'Cell', t.contact2_cell, { col: 'col-md-4', max: 40 }) +
            field('trpC2Email', 'Email', t.contact2_email, { col: 'col-md-4', type: 'email', max: 160 }) + '</div>' +
            '<div class="trp-sect">Documents and cover</div><div class="row g-3">' +
            field('trpGitInsurer', 'Goods-in-transit insurer', t.git_insurer, { col: 'col-md-4', max: 120 }) +
            field('trpGitCover', 'GIT cover per load (R)', t.git_cover_zar, { col: 'col-md-4', type: 'number', step: '0.01', min: 0 }) +
            field('trpGitExpiry', 'GIT insurance expires', t.git_expiry, { col: 'col-md-4', type: 'date' }) +
            select('trpBbbeeLevel', 'B-BBEE level', levels, t.bbbee_level || '', { col: 'col-md-4' }) +
            field('trpBbbeeExpiry', 'B-BBEE certificate expires', t.bbbee_expiry, { col: 'col-md-4', type: 'date' }) +
            '<div class="col-12"><label class="form-label" for="trpFiles">Certificates (GIT, B-BBEE, roadworthy, tax clearance)</label>' +
            (canEdit() ? '<input type="file" class="form-control" id="trpFiles" multiple accept="image/*,application/pdf">' : '') +
            '<div class="mt-2" id="trpFileList"></div></div></div>' +
            '<div class="trp-sect">Notes</div><div class="row g-3">' +
            field('trpNotes', 'Notes', t.notes, { col: 'col-12', textarea: true }) + '</div>';
        openModal('transporter', t.id ? t.name : 'Add a transporter', h, t);
        drawFiles();
    }

    function drawFiles() {
        var $el = $('#trpFileList');
        if (!$el.length) return;
        var onRemove = canEdit() ? function (i) { state.files.splice(i, 1); drawFiles(); } : null;
        if (typeof FilePreview !== 'undefined') {
            FilePreview.render($el, state.files, { onRemove: onRemove });
            return;
        }
        $el.empty();
        state.files.forEach(function (f, i) {
            var $row = $('<div class="small mb-1"></div>');
            if (typeof f.file_link === 'string' && f.file_link.indexOf('https://') === 0) {
                $row.append($('<a target="_blank" rel="noopener"></a>').attr('href', f.file_link).text(f.name || 'file'));
            } else {
                $row.text(f.name || 'file');
            }
            if (onRemove) {
                $row.append(' ', $('<button type="button" class="btn btn-link btn-sm text-danger p-0">Remove</button>').on('click', function () { onRemove(i); }));
            }
            $el.append($row);
        });
    }

    async function uploadFiles(files) {
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            var t = (file.type || '').toLowerCase();
            if (!(t.indexOf('image/') === 0 || t === 'application/pdf' || (!t && /\.pdf$/i.test(file.name || '')))) {
                $('#trpModalError').text(file.name + ' is not a photo or PDF.');
                continue;
            }
            state.uploading++;
            $('#trpModalSave').prop('disabled', true);
            try {
                var safe = (file.name || 'file').replace(/[^\w.-]/g, '_');
                var fileId = 'transporter_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) + '_' + safe;
                var res = await _common.uploadFile({ file: file, resourceFolder: 'transporters', fileId: fileId });
                if (!res || !res.Success) throw new Error((res && res.LastErrorDescription) || 'Upload failed');
                var data = res.Data;
                state.files.push({
                    file_id: (data && data[0] && (data[0].fileId || data[0].key)) || (data && data.fileId) || fileId,
                    file_link: (data && data[0] && data[0].fileLink) || (data && data.fileLink) || null,
                    name: file.name || safe
                });
                drawFiles();
            } catch (e) {
                $('#trpModalError').text('Could not upload ' + file.name + ': ' + (e.message || e));
            } finally {
                state.uploading--;
                if (!state.uploading) $('#trpModalSave').prop('disabled', false);
            }
        }
    }

    function routeForm(r) {
        r = r || {};
        var h = '<div class="row g-3">' +
            field('trpRouteCode', 'Route code', r.code, { col: 'col-md-4', req: true, ph: 'e.g. HAZ-HOW', max: 30, hint: 'Short and unique. Capitals are added for you.' }) +
            field('trpRouteFrom', 'From (collection point)', r.origin, { col: 'col-md-4', req: true, max: 120 }) +
            field('trpRouteTo', 'To (delivery point)', r.destination || 'Howick', { col: 'col-md-4', max: 120 }) +
            field('trpRouteKm', 'Distance (km)', r.km, { col: 'col-md-4', type: 'number', step: '0.1', min: 0 }) +
            (r.id ? select('trpRouteActive', 'In use', [['1', 'Yes'], ['0', 'No, hide it from the route lists']], r.is_active === false ? '0' : '1', { col: 'col-md-8' }) : '') +
            field('trpRouteNotes', 'Notes', r.notes, { col: 'col-12', textarea: true }) + '</div>';
        openModal('route', r.id ? 'Route ' + r.code : 'Add a route', h, r);
    }

    function rateForm(r, title) {
        r = r || {};
        var ts = [['', 'Pick the transporter']].concat((state.sheet.transporters || []).filter(function (t) {
            return t.is_active || String(t.id) === String(r.transporter_id || '');
        }).map(function (t) { return [t.id, t.name]; }));
        var rs = [['', 'Pick the route']].concat((state.sheet.routes || []).filter(function (x) {
            return x.is_active || String(x.id) === String(r.route_id || '');
        }).map(function (x) { return [x.id, TransportRateSheet.routeLabel(x)]; }));
        var h = '<div class="row g-3">' +
            select('trpRateTr', 'Transporter', ts, r.transporter_id || state.filter || '', { req: true }) +
            select('trpRateRoute', 'Route', rs, r.route_id || '', { req: true }) +
            field('trpRateZar', 'Rate per load (R, excl. VAT)', r.rate_zar, { col: 'col-md-4', type: 'number', step: '0.01', min: 0, req: true }) +
            field('trpRateFrom', 'Valid from', r.valid_from || today(), { col: 'col-md-4', type: 'date', req: true }) +
            field('trpRateTo', 'Valid to (blank = no end date)', r.valid_to, { col: 'col-md-4', type: 'date' }) +
            '<div class="col-12 small text-muted" id="trpRatePerKm" aria-live="polite"></div>' +
            field('trpRateNotes', 'Notes', r.notes, { col: 'col-12', textarea: true }) + '</div>';
        openModal('rate', title || (r.id ? 'Edit rate' : 'Add a rate'), h, r);
        perKm();
    }

    function perKm() {
        var route = byId(state.sheet.routes, $('#trpRateRoute').val());
        var v = parseFloat($('#trpRateZar').val());
        $('#trpRatePerKm').text(route && route.km > 0 && isFinite(v) ? 'Rate per km: ' + money(v / route.km) : '');
    }

    function num(id) {
        var raw = String($('#' + id).val() || '').trim();
        if (raw === '') return null;
        var n = Number(raw);
        return isFinite(n) ? n : NaN;
    }

    async function save() {
        if (!state.modal || !canEdit()) return;
        if (state.uploading) { $('#trpModalError').text('A file is still uploading. Try again in a moment.'); return; }
        var m = state.modal, rec = m.rec || {}, res;
        $('#trpModalError').text('');
        $('#trpModalSave').prop('disabled', true);
        try {
            if (m.kind === 'transporter') {
                var cover = num('trpGitCover');
                if (Number.isNaN(cover)) throw new Error('GIT cover per load must be a number.');
                res = await dataFunctions.saveTransporter(rec.id || null, {
                    name: $('#trpName').val(), status: $('#trpStatus').val(), base: $('#trpBase').val(),
                    truck_types: $('#trpTruckTypes').val(), vat_no: $('#trpVat').val(),
                    contact_name: $('#trpC1Name').val(), contact_cell: $('#trpC1Cell').val(), contact_email: $('#trpC1Email').val(),
                    contact2_name: $('#trpC2Name').val(), contact2_cell: $('#trpC2Cell').val(), contact2_email: $('#trpC2Email').val(),
                    git_insurer: $('#trpGitInsurer').val(), git_cover_zar: cover, git_expiry: $('#trpGitExpiry').val() || null,
                    bbbee_level: $('#trpBbbeeLevel').val(), bbbee_expiry: $('#trpBbbeeExpiry').val() || null,
                    documents: state.files, notes: $('#trpNotes').val()
                });
            } else if (m.kind === 'route') {
                var km = num('trpRouteKm');
                if (Number.isNaN(km)) throw new Error('Distance must be a number.');
                res = await dataFunctions.saveTransportRoute({
                    id: rec.id || null, code: $('#trpRouteCode').val(), origin: $('#trpRouteFrom').val(),
                    destination: $('#trpRouteTo').val(), km: km, notes: $('#trpRouteNotes').val(),
                    is_active: rec.id ? $('#trpRouteActive').val() !== '0' : true
                });
            } else {
                var rate = num('trpRateZar');
                if (rate == null || Number.isNaN(rate)) throw new Error('Enter the rate per load.');
                res = await dataFunctions.saveTransportRate({
                    id: rec.id || null, transporter_id: $('#trpRateTr').val() || null, route_id: $('#trpRateRoute').val() || null,
                    rate_zar: rate, valid_from: $('#trpRateFrom').val() || null, valid_to: $('#trpRateTo').val() || null,
                    notes: $('#trpRateNotes').val()
                });
            }
            if (!res || res.success === false) throw new Error((res && res.error) || 'Could not save.');
            closeModal();
            toast('Saved.');
            await load();
        } catch (e) {
            $('#trpModalError').text(e.message || String(e));
        } finally {
            $('#trpModalSave').prop('disabled', false);
        }
    }

    async function removeRate() {
        var m = state.modal;
        if (!m || m.kind !== 'rate' || !m.rec || !m.rec.id || !canEdit()) return;
        if (typeof Swal !== 'undefined') {
            var ok = await Swal.fire({ title: 'Remove this rate?', text: 'Deliveries already priced from it keep their cost.', icon: 'warning',
                showCancelButton: true, confirmButtonText: 'Remove rate' });
            if (!ok.isConfirmed) return;
        }
        var res = await dataFunctions.saveTransportRate({ id: m.rec.id, is_active: false });
        if (!res || res.success === false) { $('#trpModalError').text((res && res.error) || 'Could not remove.'); return; }
        closeModal();
        toast('Rate removed.');
        await load();
    }

    // ------------------------------------------------------------------ events

    function showTab(tab) {
        if (!PANES[tab]) return;
        state.tab = tab;
        render();
    }

    function bind() {
        var $m = $('#trpModule');
        $m.off(NS);
        $m.on('click' + NS, '.trp-tab', function () { showTab(this.getAttribute('data-tab')); });
        $m.on('click' + NS, '#trpRefresh', function () { load(); });
        $m.on('click' + NS, '#trpAdd', function () {
            if (!state.sheet || !canEdit()) return;
            if (state.tab === 'routes') routeForm(null);
            else if (state.tab === 'rates') rateForm(null);
            else transporterForm(null);
        });
        $m.on('click' + NS, '[data-trp-act]', function () {
            var act = this.getAttribute('data-trp-act'), id = this.getAttribute('data-id');
            if (act === 'edit-transporter') transporterForm(byId(state.sheet.transporters, id));
            if (act === 'edit-route') routeForm(byId(state.sheet.routes, id));
            if (act === 'edit-rate') rateForm(byId(state.sheet.rates, id));
            if (act === 'show-rates') { state.filter = id; showTab('rates'); }
            if (act === 'renew-rate') {
                var old = byId(state.sheet.rates, id);
                if (!old) return;
                var from = old.valid_to && old.valid_to >= today() ? addDays(old.valid_to, 1) : today();
                rateForm({ transporter_id: old.transporter_id, route_id: old.route_id, rate_zar: old.rate_zar, valid_from: from, notes: '' },
                    'Renew ' + old.transporter_name + ' · ' + old.route_code);
            }
        });
        $m.on('change' + NS, '#trpPeriod', function () {
            state.perf.period = this.value;
            $('#trpModule .trp-custom').toggleClass('d-none', this.value !== 'custom');
            if (this.value === 'custom' && !$('#trpFrom').val()) { $('#trpFrom').val(monthStart(today())); $('#trpTo').val(today()); }
            loadPerf();
        });
        $m.on('change' + NS, '#trpFrom, #trpTo', function () { if (state.perf.period === 'custom') loadPerf(); });
        $m.on('click' + NS, '.trp-dir', function () {
            state.perf.dir = this.getAttribute('data-dir');
            $('#trpModule .trp-dir').each(function () {
                var on = this.getAttribute('data-dir') === state.perf.dir;
                $(this).toggleClass('active', on).attr('aria-pressed', on ? 'true' : 'false');
            });
            renderPerf();
        });
        $m.on('change' + NS, '#trpRateFilter', function () { state.filter = this.value; renderRates(); });
        $m.on('change' + NS, '#trpShowOld', function () { state.showOld = this.checked; renderRates(); });
        $m.on('input' + NS + ' change' + NS, '#trpRateZar, #trpRateRoute', perKm);
        $m.on('change' + NS, '#trpFiles', function () {
            var files = Array.prototype.slice.call(this.files || []);
            this.value = '';
            uploadFiles(files);
        });
        $m.on('click' + NS, '#trpModalSave', save);
        $m.on('click' + NS, '#trpModalRemove', removeRate);
    }

    async function init() {
        state.tab = 'transporters';
        state.filter = '';
        state.perf.cur = null;
        state.perf.prev = null;
        bind();
        var h = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('transporters') : null;
        if (h && h.tab) state.tab = h.tab;
        if (h && h.transporterId) { state.filter = h.transporterId; state.showOld = true; }
        await load();
        if (h && h.editTransporterId && state.sheet) {
            var t = byId(state.sheet.transporters, h.editTransporterId);
            if (t) transporterForm(t);
        }
    }

    return { init: init };
})();
