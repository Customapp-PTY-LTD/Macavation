/**
 * Data health - the first tab on Sales & Production Data.
 *
 * One row per data page, one cell per week (Monday to Sunday) across a financial year. A cell says
 * whether the data page holds what the factory side captured that week:
 *   ok     captured
 *   miss   the factory recorded activity but this page has nothing
 *   diff   both have figures but they disagree (production: more than 5% apart; NIS: fewer rows)
 *   none   no activity on either side - normal, not a gap
 *   cant   nothing to compare against (oil has no factory-side figure yet), or a weekday with no
 *          figure before the factory figure was tracked
 *   future not reached yet
 *
 * Source: get_data_health (migrations/20261014120000), one compact row per day:
 *   [date, typed cracked kg, factory cracked kg (null = not tracked), NIS intake rows,
 *    deliveries booked in, kernel sales lines, kernel dispatch orders, oil sales lines, oil export rows]
 *
 * Clicking a cell shows that week day by day, with a button that opens the tab where the gap gets
 * filled (via the onOpen callback the page controller passes in).
 *
 * Security: every value reaches the DOM via textContent. No innerHTML.
 */
var DataHealthPanel = (function () {
    'use strict';

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    // From this date everything is captured in the portal (agreed with the client, 14 Oct 2026).
    // Before it, gaps are filled from the client's Excel. Drawn as a marker on the timeline.
    var CUTOVER_ISO = '2026-11-01';
    var DIFF_TOLERANCE = 0.05;

    var LABELS = { ok: 'Captured', miss: 'Missing', diff: 'Differs', none: 'No activity', cant: 'Can’t check', future: '–', will: 'Filled by this file' };
    var RANK = { miss: 5, diff: 4, cant: 3, ok: 2, none: 1, future: 0 };

    var state = { fy: null, byIso: {}, weeks: [], status: {}, todayIso: null, onOpen: null, root: null, sel: null, container: null, lastImport: null };

    // Fill gaps from a file (data-import-wizard.js): offered only to people who may edit data pages,
    // and only when the wizard script loaded.
    function canImport() {
        return typeof DataImportWizard !== 'undefined' && typeof hasAction === 'function' && hasAction('reports.data.edit');
    }

    function openImport(datasetKey, from, to) {
        DataImportWizard.open({
            datasetKey: datasetKey, from: from, to: to,
            onDone: function () { if (state.container && document.body.contains(state.container)) load(state.container); }
        });
    }

    // Fill everything from a file (data-import-all-wizard.js): the whole financial year, every page.
    function canImportAll() { return canImport() && typeof DataImportAllWizard !== 'undefined'; }

    function reload() { if (state.container && document.body.contains(state.container)) load(state.container); }

    function openImportAll() {
        if (!state.weeks.length) return;
        DataImportAllWizard.open({
            snapshot: snapshot(),
            onSaved: function (result) { state.lastImport = result; reload(); },
            onUndone: function () { state.lastImport = null; reload(); }
        });
    }

    // What the Fill everything wizard needs to know about this grid.
    function snapshot() {
        return {
            fy: state.fy,
            todayIso: state.todayIso,
            cutoverIso: CUTOVER_ISO,
            weeks: state.weeks.map(function (w) { return { startIso: isoOf(w.start), endIso: isoOf(w.end), label: fmt(w.start) }; }),
            status: JSON.parse(JSON.stringify(state.status))
        };
    }

    // Missing weeks a file is meant to fill: those that start before the cut-over.
    function missWeeks(key) {
        return (state.status[key] || []).reduce(function (a, s, i) {
            if (s === 'miss' && isoOf(state.weeks[i].start) < CUTOVER_ISO) a.push(i);
            return a;
        }, []);
    }

    // Under the grid: how many missing weeks a file could fill, or what the last import in this
    // session did (with its Undo).
    function renderGapBar(host) {
        clear(host);
        if (!host || !canImportAll()) return;
        var last = state.lastImport;
        var bar = el('div', 'dh-gapbar');
        var text = el('span');
        if (last) {
            bar.classList.add('dh-gapbar-done');
            var left = missWeeks('nis_intake').length + missWeeks('kernel_sales_lines').length;
            text.appendChild(document.createTextNode('✓ '));
            text.appendChild(el('b', null, 'Imported ' + last.code));
            text.appendChild(document.createTextNode(' from ' + last.fileName + '. '
                + (left ? left + ' missing week' + (left === 1 ? '' : 's') + ' left that the file couldn’t fill.' : 'No missing weeks left.')));
            bar.appendChild(text);
            var u = el('button', 'btn btn-outline-secondary btn-sm', '↶ Undo');
            u.type = 'button';
            u.addEventListener('click', function () {
                DataImportAllWizard.undo(last.groupId, function (msg) {
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ text: msg, icon: 'info' });
                    state.lastImport = null;
                    reload();
                });
            });
            bar.appendChild(u);
            host.appendChild(bar);
            return;
        }
        var nis = missWeeks('nis_intake').length, ker = missWeeks('kernel_sales_lines').length, prod = missWeeks('production_daily').length;
        if (!nis && !ker) return;
        var parts = [];
        if (nis) parts.push('Nut in Shell Intake ' + nis);
        if (ker) parts.push('Kernel Sales ' + ker);
        text.appendChild(document.createTextNode('⚠ '));
        text.appendChild(el('b', null, (nis + ker) + ' missing week' + (nis + ker === 1 ? '' : 's')));
        text.appendChild(document.createTextNode(' can be filled from a file: ' + parts.join(', ') + '.'
            + (prod ? ' Production’s ' + prod + ' week' + (prod === 1 ? '' : 's') + ' come' + (prod === 1 ? 's' : '') + ' from the factory instead.' : '')));
        bar.appendChild(text);
        var b = el('button', 'btn btn-outline-secondary btn-sm', 'Fill everything from a file →');
        b.type = 'button';
        b.addEventListener('click', openImportAll);
        bar.appendChild(b);
        host.appendChild(bar);
    }

    // ------------------------------------------------------------------
    // Helpers.
    // ------------------------------------------------------------------

    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseIso(iso) { var p = String(iso).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
    function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
    function fmt(d) { return d.getDate() + ' ' + MONTHS[d.getMonth()]; }
    function num(v) { return Math.round(Number(v) || 0).toLocaleString('en-ZA').replace(/ /g, ' '); }
    function fyOf(d) { return d.getFullYear() + (d.getMonth() + 1 >= 4 ? 1 : 0); }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = String(text);
        return e;
    }

    function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

    function pill(status) { return el('span', 'dh-pill dh-pill-' + status, LABELS[status]); }

    function row(iso) { return state.byIso[iso] || null; }

    // ------------------------------------------------------------------
    // Status rules.
    // ------------------------------------------------------------------

    function prodDay(d) {
        var iso = isoOf(d);
        if (iso > state.todayIso) return 'future';
        var r = row(iso);
        if (!r) return 'none';
        var typed = Number(r[1]) || 0, sys = r[2];
        if (sys != null) {
            sys = Number(sys) || 0;
            if (sys > 0 && typed === 0) return 'miss';
            if (sys > 0 && Math.abs(typed - sys) / sys > DIFF_TOLERANCE) return 'diff';
            return typed > 0 ? 'ok' : 'none';
        }
        if (typed > 0) return 'ok';
        var dow = d.getDay();
        return (dow >= 1 && dow <= 5) ? 'cant' : 'none';
    }

    function weekSum(w, idx) {
        return w.days.reduce(function (s, d) { var r = row(isoOf(d)); return s + (r ? Number(r[idx]) || 0 : 0); }, 0);
    }

    function weekStarted(w) { return isoOf(w.start) <= state.todayIso; }

    var ROWS = [
        { key: 'production_daily', name: 'Production (daily)', sub: 'typed vs factory', cell: function (w) {
            if (!weekStarted(w)) return 'future';
            var s = w.days.map(prodDay).filter(function (x) { return x !== 'future'; });
            if (s.indexOf('miss') !== -1) return 'miss';
            if (s.indexOf('diff') !== -1) return 'diff';
            if (s.indexOf('ok') !== -1) return 'ok';
            return s.indexOf('cant') !== -1 ? 'cant' : 'none';
        } },
        { key: 'nis_intake', name: 'Nut in Shell Intake', sub: 'vs deliveries booked in', cell: function (w) {
            if (!weekStarted(w)) return 'future';
            var n = weekSum(w, 3), k = weekSum(w, 4);
            if (k > 0 && n === 0) return 'miss';
            if (n > 0 && k > 0 && n < k) return 'diff';
            return n > 0 ? 'ok' : 'none';
        } },
        { key: 'kernel_sales_lines', name: 'Kernel Sales', sub: 'vs dispatches', cell: function (w) {
            if (!weekStarted(w)) return 'future';
            var s = weekSum(w, 5), o = weekSum(w, 6);
            if (o > 0 && s === 0) return 'miss';
            return s > 0 ? 'ok' : 'none';
        } },
        { key: 'oil_sales_lines', name: 'Oil & Protein Sales', sub: 'nothing to compare yet', cell: function (w) {
            if (!weekStarted(w)) return 'future';
            return weekSum(w, 7) > 0 ? 'ok' : 'cant';
        } },
        { key: 'oil_export_register', name: 'Oil Export Register', sub: 'nothing to compare yet', cell: function (w) {
            if (!weekStarted(w)) return 'future';
            return weekSum(w, 8) > 0 ? 'ok' : 'cant';
        } }
    ];

    // Weeks Monday-Sunday covering the whole financial year.
    function buildWeeks(fy) {
        var first = new Date(fy - 1, 3, 1);
        var monday = addDays(first, -((first.getDay() + 6) % 7));
        var end = new Date(fy, 2, 31);
        var weeks = [];
        for (var m = monday; m <= end; m = addDays(m, 7)) {
            var days = [];
            for (var i = 0; i < 7; i++) days.push(addDays(m, i));
            weeks.push({ start: m, end: days[6], days: days });
        }
        return weeks;
    }

    // ------------------------------------------------------------------
    // Rendering.
    // ------------------------------------------------------------------

    function renderSummary(host) {
        clear(host);
        var missDays = [];
        Object.keys(state.byIso).sort().forEach(function (iso) {
            var r = state.byIso[iso];
            if (r[2] != null && Number(r[2]) > 0 && (Number(r[1]) || 0) === 0) missDays.push(iso);
        });
        var missKg = missDays.reduce(function (s, iso) { return s + (Number(state.byIso[iso][2]) || 0); }, 0);
        var count = function (k) { return state.status[k].filter(function (s) { return s === 'miss'; }).length; };
        var lastWith = function (idx) {
            var keys = Object.keys(state.byIso).sort().filter(function (iso) { return Number(state.byIso[iso][idx]) > 0; });
            return keys.length ? fmt(parseIso(keys[keys.length - 1])) : null;
        };
        var tiles = [
            { cls: missDays.length ? 'red' : 'green', k: 'Production (daily)',
              v: missDays.length ? missDays.length + ' day' + (missDays.length === 1 ? '' : 's') + ' missing' : 'Up to date',
              s: missDays.length ? fmt(parseIso(missDays[0])) + ' – ' + fmt(parseIso(missDays[missDays.length - 1]))
                  + ' · ' + num(missKg) + ' kg cracked but not entered' : 'Matches what the factory captured' },
            { cls: count('nis_intake') ? 'red' : 'green', k: 'Nut in Shell Intake',
              v: count('nis_intake') ? count('nis_intake') + ' week' + (count('nis_intake') === 1 ? '' : 's') + ' missing' : 'Up to date',
              s: lastWith(3) ? 'Last entry ' + lastWith(3) : 'No entries this year' },
            { cls: count('kernel_sales_lines') ? 'red' : 'green', k: 'Kernel Sales',
              v: count('kernel_sales_lines') ? count('kernel_sales_lines') + ' week' + (count('kernel_sales_lines') === 1 ? '' : 's') + ' missing' : 'Up to date',
              s: count('kernel_sales_lines') ? 'Dispatches went out with no invoice lines entered' : 'Every dispatch week has invoice lines' },
            { cls: 'grey', k: 'Oil sales & exports', v: 'Can’t check yet', s: 'Needs the oil pipeline captured in the portal' }
        ];
        tiles.forEach(function (t) {
            var d = el('div', 'dh-sum dh-sum-' + t.cls);
            d.appendChild(el('div', 'dh-sum-k', t.k));
            d.appendChild(el('div', 'dh-sum-v', t.v));
            d.appendChild(el('div', 'dh-sum-s', t.s));
            host.appendChild(d);
        });
    }

    function renderLegend(host) {
        clear(host);
        [['ok', 'Captured'], ['miss', 'Missing: the factory recorded activity but this page has nothing'],
         ['diff', 'Doesn’t match the factory figure'], ['none', 'No activity'],
         ['cant', 'Can’t be checked (no factory figure to compare)'], ['future', 'Still to come']].forEach(function (x) {
            var s = el('span', 'dh-legend-item');
            s.appendChild(el('span', 'dh-sw dh-' + x[0]));
            s.appendChild(document.createTextNode(x[1]));
            host.appendChild(s);
        });
    }

    // statusOf(rowKey, weekIndex) defaults to the computed status. The Fill everything wizard passes
    // its own to draw the "after this import" preview, with interactive false (no focus, no clicks)
    // and dim naming rows to grey out.
    function renderGrid(table, statusOf, opts) {
        opts = opts || {};
        statusOf = statusOf || function (rk, i) { return state.status[rk][i]; };
        var interactive = opts.interactive !== false;
        clear(table);
        var thead = el('thead');
        // Month row
        var trm = el('tr');
        trm.appendChild(el('th'));
        var spans = [];
        state.weeks.forEach(function (w) {
            // A week belongs to the month its Thursday falls in.
            var m = addDays(w.start, 3).getMonth();
            if (spans.length && spans[spans.length - 1].m === m) spans[spans.length - 1].n++;
            else spans.push({ m: m, n: 1 });
        });
        spans.forEach(function (s) {
            var th = el('th', 'dh-month', MONTHS[s.m]);
            th.colSpan = s.n;
            trm.appendChild(th);
        });
        thead.appendChild(trm);
        var trd = el('tr');
        trd.appendChild(el('th'));
        state.weeks.forEach(function (w) { trd.appendChild(el('th', 'dh-day', w.start.getDate())); });
        thead.appendChild(trd);
        table.appendChild(thead);

        var tbody = el('tbody');
        ROWS.forEach(function (r) {
            var dim = opts.dim && opts.dim[r.key];
            var tr = el('tr', dim ? 'dh-row-dim' : null);
            var name = el('td', 'dh-name', r.name);
            name.appendChild(el('small', null, dim || r.sub));
            tr.appendChild(name);
            state.weeks.forEach(function (w, i) {
                var status = statusOf(r.key, i);
                var td = el('td', 'dh-c dh-' + status);
                var cutIso = CUTOVER_ISO;
                if (isoOf(w.start) <= cutIso && isoOf(w.end) >= cutIso) td.classList.add('dh-cut');
                td.title = r.name + ' · week of ' + fmt(w.start) + ': ' + (LABELS[status] || '');
                if (interactive) {
                    td.setAttribute('data-r', r.key);
                    td.setAttribute('data-w', String(i));
                    if (status !== 'future') td.tabIndex = 0;
                } else {
                    td.classList.add('dh-static');
                }
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
    }

    function renderDetail(rk, wi) {
        var host = state.root.querySelector('.dh-detail');
        clear(host);
        Array.prototype.forEach.call(state.root.querySelectorAll('td.dh-sel'), function (c) { c.classList.remove('dh-sel'); });
        var cell = state.root.querySelector('td.dh-c[data-r="' + rk + '"][data-w="' + wi + '"]');
        if (cell) cell.classList.add('dh-sel');
        var w = state.weeks[wi];
        var r = ROWS.filter(function (x) { return x.key === rk; })[0];
        if (!w || !r) return;
        var h = el('h3', 'dh-detail-title', r.name + ' · week of ' + fmt(w.start) + ' – ' + fmt(w.end) + ' ');
        h.appendChild(pill(state.status[rk][wi]));
        host.appendChild(h);
        host.appendChild(el('div', 'dh-detail-sub', 'Click any cell above to see that week. The button opens the tab where the gap gets filled.'));

        var table = el('table', 'table table-sm dh-days');
        var thead = el('thead'), trh = el('tr'), tbody = el('tbody');
        var days = w.days.filter(function (d) { return isoOf(d) <= state.todayIso; });
        function head(cols) { cols.forEach(function (c) { trh.appendChild(el('th', c.num ? 'text-end' : null, c.t)); }); }
        function line(cells, numIdx) {
            var tr = el('tr');
            cells.forEach(function (c, i) {
                var td = el('td', numIdx.indexOf(i) !== -1 ? 'text-end' : null);
                if (c && c.nodeType) td.appendChild(c); else td.textContent = c == null ? '' : String(c);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        }
        if (rk === 'production_daily') {
            head([{ t: 'Day' }, { t: 'Factory recorded (kg)', num: true }, { t: 'Typed on this page (kg)', num: true }, { t: 'Status' }]);
            days.forEach(function (d) {
                var x = row(isoOf(d)) || [];
                line([DAYS[d.getDay()] + ' ' + fmt(d), x[2] == null ? 'not tracked yet' : num(x[2]), num(x[1]), pill(prodDay(d))], [1, 2]);
            });
        } else if (rk === 'nis_intake' || rk === 'kernel_sales_lines') {
            var a = rk === 'nis_intake' ? 4 : 6, b = rk === 'nis_intake' ? 3 : 5;
            head([{ t: 'Day' }, { t: rk === 'nis_intake' ? 'Deliveries booked in' : 'Dispatch orders', num: true },
                  { t: rk === 'nis_intake' ? 'Intake rows on this page' : 'Invoice lines on this page', num: true }]);
            var any = false;
            days.forEach(function (d) {
                var x = row(isoOf(d)) || [];
                if (!(Number(x[a]) || Number(x[b]))) return;
                any = true;
                line([DAYS[d.getDay()] + ' ' + fmt(d), num(x[a]), num(x[b])], [1, 2]);
            });
            if (!any) {
                var tr = el('tr'), td = el('td', 'text-muted', 'Nothing on either side this week.');
                td.colSpan = 3; tr.appendChild(td); tbody.appendChild(tr);
            }
        } else {
            head([{ t: 'Day' }, { t: 'Rows on this page', num: true }]);
            var idx = rk === 'oil_sales_lines' ? 7 : 8, some = false;
            days.forEach(function (d) {
                var x = row(isoOf(d)) || [];
                if (!Number(x[idx])) return;
                some = true;
                line([DAYS[d.getDay()] + ' ' + fmt(d), num(x[idx])], [1]);
            });
            if (!some) {
                var tr2 = el('tr'), td2 = el('td', 'text-muted',
                    'Nothing entered this week. There is no factory-side figure for oil yet, so this row cannot say whether that is a gap.');
                td2.colSpan = 2; tr2.appendChild(td2); tbody.appendChild(tr2);
            }
        }
        thead.appendChild(trh);
        table.appendChild(thead);
        table.appendChild(tbody);
        host.appendChild(table);

        var bar = el('div', 'dh-fixbar');
        var btn = el('button', 'btn btn-primary btn-sm');
        btn.type = 'button';
        btn.appendChild(el('i', 'fas fa-pen me-1'));
        btn.appendChild(document.createTextNode('Open ' + r.name + ' for this week'));
        btn.addEventListener('click', function () {
            if (typeof state.onOpen === 'function') state.onOpen(rk, isoOf(w.start), isoOf(w.end));
        });
        bar.appendChild(btn);
        if (canImport() && DataImportWizard.canImport(rk)) {
            var imp = el('button', 'btn btn-outline-secondary btn-sm');
            imp.type = 'button';
            imp.appendChild(el('i', 'fas fa-file-import me-1'));
            imp.appendChild(document.createTextNode('Fill this week from a file'));
            imp.addEventListener('click', function () { openImport(rk, isoOf(w.start), isoOf(w.end)); });
            bar.appendChild(imp);
        }
        host.appendChild(bar);
    }

    function compute() {
        state.weeks = buildWeeks(state.fy);
        state.status = {};
        ROWS.forEach(function (r) { state.status[r.key] = state.weeks.map(r.cell); });
    }

    function renderAll() {
        var root = state.root;
        renderSummary(root.querySelector('.dh-summary'));
        renderLegend(root.querySelector('.dh-legend'));
        renderGrid(root.querySelector('table.dh-grid'));
        renderGapBar(root.querySelector('.dh-gapbar-host'));
        // Open on the first missing production week, else the latest started week.
        var wi = state.status.production_daily.indexOf('miss');
        var rk = 'production_daily';
        if (wi === -1) {
            ROWS.some(function (r) { var i = state.status[r.key].indexOf('miss'); if (i !== -1) { wi = i; rk = r.key; return true; } return false; });
        }
        if (wi === -1) {
            wi = state.weeks.reduce(function (acc, w, i) { return weekStarted(w) ? i : acc; }, 0);
        }
        renderDetail(rk, wi);
    }

    function shell(container) {
        clear(container);
        var root = el('div', 'dh-root');
        var top = el('div', 'dh-top');
        var label = el('label', 'form-label mb-0 me-2', 'Financial year');
        label.setAttribute('for', 'dhFy');
        var sel = el('select', 'form-select form-select-sm dh-fy');
        sel.id = 'dhFy';
        var cur = fyOf(new Date());
        [cur, cur - 1].forEach(function (fy) {
            var o = el('option', null, 'FY ' + fy + ' (Apr ' + (fy - 1) + ' – Mar ' + fy + ')');
            o.value = String(fy);
            sel.appendChild(o);
        });
        sel.value = String(state.fy);
        top.appendChild(label);
        top.appendChild(sel);
        top.appendChild(el('span', 'dh-intro text-muted small ms-3',
            'What each data page is missing, week by week, compared with what the factory captured.'));
        if (canImport()) {
            var btns = el('div', 'dh-top-btns ms-auto');
            var one = el('button', 'btn btn-outline-secondary btn-sm');
            one.type = 'button';
            one.title = 'One page and chosen dates, from Excel or a photo/PDF';
            one.appendChild(el('i', 'fas fa-file-import me-1'));
            one.appendChild(document.createTextNode('One page from a file'));
            one.addEventListener('click', function () {
                openImport('nis_intake', (state.fy - 1) + '-04-01', state.todayIso || isoOf(new Date()));
            });
            btns.appendChild(one);
            if (canImportAll()) {
                var all = el('button', 'btn btn-primary btn-sm');
                all.type = 'button';
                all.appendChild(el('i', 'fas fa-upload me-1'));
                all.appendChild(document.createTextNode('Fill everything from a file'));
                all.addEventListener('click', openImportAll);
                btns.appendChild(all);
            }
            top.appendChild(btns);
        }
        root.appendChild(top);
        root.appendChild(el('div', 'dh-summary'));
        root.appendChild(el('div', 'dh-legend'));
        var wrap = el('div', 'dh-grid-wrap');
        wrap.appendChild(el('table', 'dh-grid'));
        root.appendChild(wrap);
        root.appendChild(el('div', 'dh-gapbar-host'));
        root.appendChild(el('p', 'dh-cutnote', '▎ The blue line marks 1 November 2026. Before it, gaps are filled from the client’s Excel. From then on everything is captured in the portal, and this page should stay green.'));
        root.appendChild(el('div', 'dh-detail'));
        var explain = el('div', 'dh-explain');
        var e1 = el('div');
        e1.appendChild(el('h4', null, 'How “missing” is worked out'));
        e1.appendChild(el('p', null, 'Production: each day’s typed cracked kg is compared with what the factory recorded on Kernel Production. Nut in Shell Intake: each week’s intake rows are compared with the deliveries booked in on Grower Intake. Kernel Sales: a week with dispatches but no invoice lines is flagged. Oil sales and exports have no factory figure to compare against yet.'));
        var e2 = el('div');
        e2.appendChild(el('h4', null, 'Why a blank isn’t always a gap'));
        e2.appendChild(el('p', null, 'A week without a delivery or a sale can be perfectly normal, so this page only flags a gap when the factory side shows activity and the data page doesn’t.'));
        explain.appendChild(e1);
        explain.appendChild(e2);
        root.appendChild(explain);
        root.appendChild(el('div', 'dh-imports'));
        container.appendChild(root);
        state.root = root;

        sel.addEventListener('change', function () { state.fy = +sel.value; load(container); });
        root.addEventListener('click', function (e) {
            var td = e.target.closest ? e.target.closest('td.dh-c') : null;
            if (!td || td.classList.contains('dh-future')) return;
            renderDetail(td.getAttribute('data-r'), +td.getAttribute('data-w'));
        });
        root.addEventListener('keydown', function (e) {
            if (e.key !== 'Enter') return;
            var td = e.target.closest ? e.target.closest('td.dh-c') : null;
            if (td && !td.classList.contains('dh-future')) renderDetail(td.getAttribute('data-r'), +td.getAttribute('data-w'));
        });
    }

    function load(container) {
        var range = { from: (state.fy - 1) + '-04-01', to: state.fy + '-03-31' };
        var host = state.root.querySelector('.dh-summary');
        clear(host);
        host.appendChild(el('div', 'text-muted', 'Loading…'));
        var df = (typeof dataFunctions !== 'undefined') ? dataFunctions : null;
        var p = (df && typeof df.getDataHealth === 'function') ? df.getDataHealth(range.from, range.to) : Promise.resolve(null);
        return p.catch(function () { return null; }).then(function (res) {
            if (!res || !Array.isArray(res.days)) {
                clear(container);
                var box = el('div', 'mac-empty-state text-center py-4');
                box.appendChild(el('i', 'fas fa-heartbeat mac-empty-icon mb-2'));
                box.appendChild(el('div', 'mac-empty-title', 'Data health is not available yet'));
                box.appendChild(el('div', 'mac-empty-hint', 'The data-health function has not been applied to this database, or the request failed. Try again shortly.'));
                container.appendChild(box);
                return;
            }
            state.todayIso = String(res.today || isoOf(new Date())).slice(0, 10);
            state.byIso = {};
            res.days.forEach(function (r) { if (Array.isArray(r) && r[0]) state.byIso[String(r[0]).slice(0, 10)] = r; });
            compute();
            renderAll();
            renderImports();
        });
    }

    // Recent imports, newest first, each undoable. Hidden when the import functions are not on this
    // database yet (getDataImportBatches resolves to null).
    function renderImports() {
        var host = state.root && state.root.querySelector('.dh-imports');
        if (!host) return;
        clear(host);
        var df = (typeof dataFunctions !== 'undefined') ? dataFunctions : null;
        if (!df || typeof df.getDataImportBatches !== 'function') return;
        df.getDataImportBatches(null, 20).then(function (rows) {
            if (!Array.isArray(rows)) {
                console.warn('[data-health] import history unavailable - is migration 20261015090000 applied?');
                return;
            }
            clear(host);
            host.appendChild(el('h4', 'dh-imports-title', 'Recent imports'));
            if (!rows.length) {
                host.appendChild(el('div', 'text-muted small', 'Nothing has been imported yet.'));
                return;
            }
            var t = el('table', 'table table-sm dh-imports-table');
            var thead = el('thead'), hr = el('tr');
            ['When', 'File', 'Page', 'Rows', 'kg', 'By', ''].forEach(function (h, i) { hr.appendChild(el('th', i === 3 || i === 4 ? 'text-end' : null, h)); });
            thead.appendChild(hr);
            t.appendChild(thead);
            var tbody = el('tbody');
            var names = (typeof DataImportWizard !== 'undefined') ? DataImportWizard.DATASETS : {};
            // A Fill everything import is one batch per page sharing import_group_id: one line, one Undo.
            var lines = [], byGroup = {};
            rows.forEach(function (b) {
                var label = (names[b.dataset_key] && names[b.dataset_key].label) || b.dataset_key || '';
                if (b.import_group_id && byGroup[b.import_group_id]) {
                    var g = byGroup[b.import_group_id];
                    g.pages.unshift(label);
                    g.row_count += Number(b.row_count) || 0;
                    g.total_qty += Number(b.total_qty) || 0;
                    g.undone = g.undone && !!b.undone_at;
                    return;
                }
                var line = { id: b.id, groupId: b.import_group_id || null, created_at: b.created_at, file_name: b.file_name,
                    pages: [label], row_count: Number(b.row_count) || 0, total_qty: Number(b.total_qty) || 0,
                    by: b.created_by_name || '', undone: !!b.undone_at };
                if (line.groupId) byGroup[line.groupId] = line;
                lines.push(line);
            });
            lines.forEach(function (b) {
                var tr = el('tr', b.undone ? 'dh-import-undone' : '');
                var when = b.created_at ? new Date(b.created_at) : null;
                tr.appendChild(el('td', 'text-nowrap', when ? fmt(when) + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes()) : ''));
                tr.appendChild(el('td', null, b.file_name || ''));
                tr.appendChild(el('td', null, b.pages.join(', ')));
                tr.appendChild(el('td', 'text-end', num(b.row_count)));
                tr.appendChild(el('td', 'text-end', num(b.total_qty)));
                tr.appendChild(el('td', null, b.by));
                var td = el('td', 'text-end');
                if (b.undone) {
                    td.appendChild(el('span', 'text-muted small', 'Undone'));
                } else if (canImport() && (!b.groupId || canImportAll())) {
                    var u = el('button', 'btn btn-outline-secondary btn-sm');
                    u.type = 'button';
                    u.textContent = 'Undo';
                    u.addEventListener('click', function () {
                        var report = function (msg) {
                            if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ text: msg, icon: 'info' });
                            if (b.groupId && state.lastImport && state.lastImport.groupId === b.groupId) state.lastImport = null;
                            reload();
                        };
                        if (b.groupId) DataImportAllWizard.undo(b.groupId, report);
                        else DataImportWizard.undo(b.id, report);
                    });
                    td.appendChild(u);
                }
                tr.appendChild(td);
                tbody.appendChild(tr);
            });
            t.appendChild(tbody);
            host.appendChild(t);
        });
    }

    return {
        /**
         * @param {HTMLElement} container - the tab pane to render into (replaced outright).
         * @param {function(string, string, string)} onOpen - (datasetKey, weekStartIso, weekEndIso)
         */
        render: function (container, onOpen) {
            state.onOpen = onOpen;
            state.container = container;
            if (!state.fy) state.fy = fyOf(new Date());
            shell(container);
            return load(container);
        },

        /**
         * Draws the grid as it is now into another table - used by Fill everything for its
         * before/after preview. statusOf(rowKey, weekIndex) may return 'will' for "filled by this file".
         * @param {HTMLTableElement} table
         * @param {function(string, number): string} [statusOf]
         * @param {Object<string, string>} [dim] - row key -> replacement subtitle, drawn greyed out
         */
        renderPreviewGrid: function (table, statusOf, dim) {
            if (!state.weeks.length) return;
            renderGrid(table, statusOf, { interactive: false, dim: dim || null });
        },

        LABELS: LABELS
    };
}());

window.DataHealthPanel = DataHealthPanel;
