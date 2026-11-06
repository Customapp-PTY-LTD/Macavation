/**
 * Production log on the Kernel dashboard (Mike, 3 Nov 2026).
 *
 * Switches between "Nut & shell cracked" and "Sound kernel packed", by Day / Week / Month /
 * Quarter / Year. Quarter and Year follow the financial year (Apr-Mar, Q1 = Apr-Jun). Looks like
 * the Cracking log on the Silos page (modules/silo-allocation/js/silo_allocation_grid.js), which
 * stays where it is for "Edit times"; this one is read-only.
 *
 * Data:
 *  - Cracked, Day / Week: get_silo_runs_between (one row per silo run, max 62 days).
 *  - Cracked, Month / Quarter / Year: get_cracking_log_daily (one row per day, max 400 days).
 *  - Packed: get_packing_log (one row per batch per packing day, max 400 days).
 * Packing has no start / finish times, so it has no time or kg/hour columns.
 * A missing RPC empties this block only, never the rest of the dashboard.
 *
 * Security: database values reach the DOM through MgmtDashboard.el / textContent only.
 */
var _productionLog = (function () {
    'use strict';

    var D = window.MgmtDashboard;
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December'];
    var SK_STYLES = ['SP', '0', '1', '1S', '4L', '5', '6'];
    var THIS_LABEL = { day: 'Today', week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This year' };
    // What a bar or summary row opens when clicked.
    var DRILL = { week: 'day', month: 'day', quarter: 'week', year: 'month' };

    var state = { stage: 'cracked', mode: 'week', anchor: null, seq: 0 };

    // ------------------------------------------------------------------
    // Dates ('YYYY-MM-DD' strings, local calendar days).
    // ------------------------------------------------------------------

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

    function todayStr() { return D.isoOf(D.today()); }

    function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return D.isoOf(d); }

    // First of the month n months after the month holding s.
    function addMonths(s, n) { var d = parse(s); return D.isoOf(new Date(d.getFullYear(), d.getMonth() + n, 1)); }

    function mondayOf(s) { return addDays(s, -((parse(s).getDay() + 6) % 7)); }

    function monthEnd(s) { var d = parse(s); return D.isoOf(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }

    function fmtDay(s) { var d = parse(s); return DAYS[d.getDay()] + ' ' + pad2(d.getDate()) + ' ' + D.MONTHS[d.getMonth()]; }

    function localDate(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? '' : D.isoOf(d); }

    function localTime(iso) {
        var d = new Date(iso);
        return isNaN(d.getTime()) ? '' : pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function fyQuarterOf(s) {
        var d = parse(s);
        return { fy: D.fyOf(d), q: D.quarterOfMonthKey(s.slice(0, 7)) };
    }

    // The picked period as { from, to } (inclusive).
    function range(mode, anchor) {
        var a = anchor || todayStr();
        if (mode === 'day') return { from: a, to: a };
        if (mode === 'week') { var m = mondayOf(a); return { from: m, to: addDays(m, 6) }; }
        if (mode === 'month') { var f = a.slice(0, 8) + '01'; return { from: f, to: monthEnd(f) }; }
        var fq = fyQuarterOf(a);
        if (mode === 'quarter') { var q = D.quarterRange(fq.fy, fq.q); return { from: q.from, to: q.to }; }
        return D.fyRange(fq.fy);
    }

    function step(dir) {
        var r = range(state.mode, state.anchor);
        if (state.mode === 'day') state.anchor = addDays(r.from, dir);
        else if (state.mode === 'week') state.anchor = addDays(r.from, 7 * dir);
        else state.anchor = addMonths(r.from, dir * ({ month: 1, quarter: 3, year: 12 }[state.mode]));
        if (state.anchor > todayStr()) state.anchor = todayStr();
    }

    function periodLabel(mode, r) {
        if (mode === 'day') return fmtDay(r.from) + ' ' + r.from.slice(0, 4) + (r.from === todayStr() ? ' (today)' : '');
        if (mode === 'week') return 'Week of ' + fmtDay(r.from) + ' – ' + fmtDay(r.to);
        if (mode === 'month') return MONTH_NAMES[+r.from.slice(5, 7) - 1] + ' ' + r.from.slice(0, 4);
        var fq = fyQuarterOf(r.from);
        if (mode === 'quarter') {
            return 'Q' + fq.q + ' of FY ' + fq.fy + ' (' + D.MONTHS[+r.from.slice(5, 7) - 1] + ' – ' +
                D.MONTHS[+r.to.slice(5, 7) - 1] + ' ' + r.to.slice(0, 4) + ')';
        }
        return D.fyLabel(fq.fy);
    }

    // Bars / summary rows of a period: [{key, from, to, label, short}].
    function buckets(mode, r) {
        var out = [], s;
        if (mode === 'week' || mode === 'month') {
            for (s = r.from; s <= r.to; s = addDays(s, 1)) {
                out.push({ key: s, from: s, to: s, label: fmtDay(s),
                    short: mode === 'week' ? fmtDay(s).split(' ').slice(0, 2).join(' ') : String(+s.slice(8, 10)) });
            }
        } else if (mode === 'quarter') {
            for (s = mondayOf(r.from); s <= r.to; s = addDays(s, 7)) {
                var a = s < r.from ? r.from : s, b = addDays(s, 6) > r.to ? r.to : addDays(s, 6);
                out.push({ key: s, from: a, to: b, label: 'Week of ' + fmtDay(s), short: fmtDay(s).split(' ').slice(1).join(' ') });
            }
        } else if (mode === 'year') {
            D.fyMonths(fyQuarterOf(r.from).fy).forEach(function (m) {
                var f = m + '-01';
                out.push({ key: m, from: f, to: monthEnd(f), label: MONTH_NAMES[+m.slice(5, 7) - 1] + ' ' + m.slice(0, 4),
                    short: D.MONTHS[+m.slice(5, 7) - 1] });
            });
        }
        return out;
    }

    function bucketOf(list, day) {
        for (var i = 0; i < list.length; i++) if (day >= list[i].from && day <= list[i].to) return list[i];
        return null;
    }

    // ------------------------------------------------------------------
    // Numbers.
    // ------------------------------------------------------------------

    function kg2(v) { return _common.formatKg(Number(v) || 0, 2); }

    function cartons(v) {
        var n = Math.round((Number(v) || 0) * 100) / 100;
        return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    }

    function fmtDuration(minutes) {
        var m = Math.max(0, Math.round(Number(minutes) || 0));
        return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
    }

    function kgh(kgv, min) { return min > 0 ? kgv / (min / 60) : null; }

    // ------------------------------------------------------------------
    // Data - every loader resolves to { ok, items } so a missing RPC only empties this block.
    // ------------------------------------------------------------------

    function call(name, from, to, listKey) {
        var df = (typeof dataFunctions !== 'undefined') ? dataFunctions : null;
        if (!df || typeof df[name] !== 'function') return Promise.resolve({ ok: false });
        return df[name](from, to).then(function (r) {
            if (r && r.success !== false && !r.error && Array.isArray(r[listKey])) return { ok: true, items: r[listKey] };
            return { ok: false, error: r && (r.error || r.message) };
        }).catch(function () { return { ok: false }; });
    }

    function detailMode() { return state.mode === 'day' || state.mode === 'week'; }

    function load() {
        var seq = ++state.seq;
        var r = range(state.mode, state.anchor);
        var req;
        if (state.stage === 'packed') req = call('getPackingLog', r.from, r.to, 'rows');
        else if (detailMode()) req = call('getSiloRunsBetween', r.from, r.to, 'runs');
        else req = call('getCrackingLogDaily', r.from, r.to, 'days');
        syncControls(r);
        req.then(function (res) {
            if (seq !== state.seq) return; // a newer pick won
            render(r, res);
        });
    }

    // Cracked items normalised to {day, kg, minutes, runs, emptied}, from runs or daily rows.
    function crackedDays(items) {
        if (!detailMode()) {
            return items.map(function (d) {
                return { day: String(d.day).slice(0, 10), kg: +d.kg || 0, minutes: +d.minutes || 0, runs: +d.runs || 0, emptied: +d.emptied || 0 };
            });
        }
        return items.map(function (run) {
            return { day: localDate(run.closed_at), kg: +run.volume_kg || 0, minutes: +run.minutes || 0, runs: 1,
                emptied: (run.left_kg == null || Number(run.left_kg) === 0) ? 1 : 0 };
        });
    }

    function sumCracked(list) {
        var t = { kg: 0, minutes: 0, runs: 0, emptied: 0 };
        list.forEach(function (d) { t.kg += d.kg; t.minutes += d.minutes; t.runs += d.runs; t.emptied += d.emptied; });
        return t;
    }

    function sumPacked(rows) {
        var t = { sk: 0, bt: 0, skc: 0, batches: {}, styles: {} };
        rows.forEach(function (p) {
            t.sk += +p.sk_kg || 0; t.bt += +p.bt_kg || 0; t.skc += +p.sk_cartons || 0;
            t.batches[String(p.kernel_id)] = true;
            SK_STYLES.forEach(function (s) { t.styles[s] = (t.styles[s] || 0) + (Number(p.by_style && p.by_style[s]) || 0); });
        });
        t.batchCount = Object.keys(t.batches).length;
        return t;
    }

    // ------------------------------------------------------------------
    // Render.
    // ------------------------------------------------------------------

    function $(id) { return document.getElementById(id); }

    function syncControls(r) {
        var today = todayStr();
        Array.prototype.forEach.call(document.querySelectorAll('#plogMode button[data-mode]'), function (b) {
            var on = b.getAttribute('data-mode') === state.mode;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        Array.prototype.forEach.call(document.querySelectorAll('#plogStage button[data-stage]'), function (b) {
            var on = b.getAttribute('data-stage') === state.stage;
            b.classList.toggle('active', on);
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        $('plogDate').max = today;
        $('plogDate').value = state.anchor || today;
        $('plogToday').textContent = THIS_LABEL[state.mode];
        $('plogNext').disabled = r.to >= today;
        $('plogLabel').textContent = periodLabel(state.mode, r);
    }

    function totalTile(label, value, note, main) {
        var t = D.el('div', 'plog-total' + (main ? ' plog-total-main' : ''));
        t.appendChild(D.el('span', null, label));
        t.appendChild(D.el('strong', null, value));
        if (note) t.appendChild(D.el('small', null, note));
        return t;
    }

    function emptyState(title, hint) {
        var table = $('plogTable');
        D.clear(table);
        var tb = D.el('tbody'), tr = D.el('tr'), td = D.el('td');
        var holder = D.el('div', 'mac-empty-state text-center py-4');
        holder.appendChild(D.el('i', 'fas fa-inbox mac-empty-icon mb-2'));
        holder.appendChild(D.el('div', 'mac-empty-title', title));
        if (hint) holder.appendChild(D.el('div', 'mac-empty-hint', hint));
        td.appendChild(holder);
        tr.appendChild(td); tb.appendChild(tr); table.appendChild(tb);
    }

    function render(r, res) {
        var totals = $('plogTotals'), bars = $('plogBars');
        D.clear(totals); D.clear(bars);
        bars.classList.add('d-none');
        $('plogNote').textContent = state.stage === 'packed'
            ? 'Packing shows once the batch\'s job card is approved. Packing has no start or finish times, so there is no kg / hour. Cartons are kg ÷ 11.34.'
            : 'From the Cracking log on the Silos page (closed silo runs, counted on the day the silo closed), which started on 26 Oct 2026. Change run times there.';
        if (!res.ok) {
            emptyState('Not available yet', res.error ? String(res.error) : 'The production log functions have not been applied to this database.');
            return;
        }
        if (state.stage === 'packed') renderPacked(r, res.items);
        else renderCracked(r, res.items);
    }

    function renderBars(r, values, fmt) {
        var list = buckets(state.mode, r);
        var host = $('plogBars');
        if (!list.length) return list;
        var today = todayStr(), max = 1;
        var byKey = {};
        list.forEach(function (b) { byKey[b.key] = 0; });
        values.forEach(function (v) { var b = bucketOf(list, v.day); if (b) byKey[b.key] += v.value; });
        list.forEach(function (b) { if (byKey[b.key] > max) max = byKey[b.key]; });
        host.style.gridTemplateColumns = 'repeat(' + list.length + ', minmax(0, 1fr))';
        host.classList.toggle('plog-bars-dense', list.length > 14);
        list.forEach(function (b) {
            var val = byKey[b.key];
            var isNow = today >= b.from && today <= b.to;
            var future = b.from > today;
            var btn = D.el('button', 'plog-bar' + (isNow ? ' plog-bar-today' : '') + (future ? ' plog-bar-future' : ''));
            btn.type = 'button';
            btn.title = b.label + ': ' + fmt(val);
            btn.setAttribute('aria-label', 'Show ' + b.label);
            btn.appendChild(D.el('span', 'plog-bar-kg', val > 0 ? D.kgNum(val) : (future ? '' : '0')));
            var track = D.el('span', 'plog-bar-track'), fill = D.el('span', 'plog-bar-fill');
            fill.style.height = (Math.round(val / max * 1000) / 10) + '%';
            track.appendChild(fill);
            btn.appendChild(track);
            btn.appendChild(D.el('span', 'plog-bar-label', b.short + (isNow && state.mode !== 'year' && state.mode !== 'quarter' && list.length <= 7 ? ' · today' : '')));
            if (!future) btn.addEventListener('click', function () { drill(b); });
            else btn.disabled = true;
            host.appendChild(btn);
        });
        host.classList.remove('d-none');
        return list;
    }

    function drill(b) {
        state.mode = DRILL[state.mode] || state.mode;
        state.anchor = b.from > todayStr() ? todayStr() : b.from;
        load();
    }

    // A table: headers [{text, num}], body rows built by the caller.
    function startTable(headers) {
        var table = $('plogTable');
        D.clear(table);
        var thead = D.el('thead'), tr = D.el('tr');
        headers.forEach(function (h) { tr.appendChild(D.el('th', h.num ? 'text-end' : null, h.text)); });
        thead.appendChild(tr);
        table.appendChild(thead);
        var tbody = D.el('tbody');
        table.appendChild(tbody);
        return tbody;
    }

    function addRow(tbody, cells, headers, cls) {
        var tr = D.el('tr', cls || null);
        cells.forEach(function (c, i) { tr.appendChild(D.el('td', headers[i] && headers[i].num ? 'text-end' : null, c)); });
        tbody.appendChild(tr);
        return tr;
    }

    function noneRow(tbody, cols, text) {
        var tr = D.el('tr'), td = D.el('td', 'text-muted', text);
        td.colSpan = cols;
        tr.appendChild(td);
        tbody.appendChild(tr);
    }

    function nothingText(verb) {
        return 'Nothing ' + verb + ' ' + ({ day: 'on this day', week: 'this week', month: 'this month',
            quarter: 'this quarter', year: 'this year' }[state.mode]) + '.';
    }

    // Month / Quarter / Year: one clickable row per bucket.
    function summaryRows(tbody, headers, list, cellsOf) {
        var today = todayStr();
        list.forEach(function (b) {
            if (b.from > today) return;
            var tr = addRow(tbody, [b.label].concat(cellsOf(b)), headers, 'plog-click');
            tr.tabIndex = 0;
            tr.title = 'Show ' + b.label;
            tr.addEventListener('click', function () { drill(b); });
            tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') drill(b); });
        });
    }

    function renderCracked(r, items) {
        var days = crackedDays(items);
        var t = sumCracked(days);
        var avg = kgh(t.kg, t.minutes);
        D.setTiles('plogTotals', [
            totalTile('Total cracked', kg2(t.kg) + ' kg', null, true),
            totalTile('Cracking time', fmtDuration(t.minutes)),
            totalTile('Average kg / hour', avg == null ? '–' : kg2(avg)),
            totalTile('Silo runs', String(t.runs), t.emptied + ' emptied')
        ]);
        var list = renderBars(r, days.map(function (d) { return { day: d.day, value: d.kg }; }), function (v) { return kg2(v) + ' kg'; });

        if (detailMode()) {
            var hd = [{ text: 'Date' }, { text: 'Silo' }, { text: 'Batch' }, { text: 'Supplier' },
                { text: 'Volume cracked (kg)', num: true }, { text: 'Left in silo (kg)', num: true },
                { text: 'Time', num: true }, { text: 'kg / hour', num: true }];
            var body = startTable(hd);
            if (!items.length) { noneRow(body, hd.length, nothingText('cracked')); return; }
            var lastDay = null, dayList = [];
            var subtotal = function () {
                if (state.mode !== 'week' || !dayList.length) return;
                var s = sumCracked(dayList), a = kgh(s.kg, s.minutes);
                addRow(body, [fmtDay(lastDay) + ' total', '', '', '', kg2(s.kg), '', fmtDuration(s.minutes), a == null ? '–' : kg2(a)],
                    hd, 'mgmt-total-row');
            };
            items.forEach(function (run, i) {
                var day = days[i].day;
                if (lastDay !== null && day !== lastDay) { subtotal(); dayList = []; }
                lastDay = day;
                dayList.push(days[i]);
                var batches = (Array.isArray(run.batch_numbers) ? run.batch_numbers : String(run.batch_numbers || '').split(',')).map(function (x) { return macBatchNo.format(String(x).trim()); }).filter(Boolean).join(', ');
                var tr = addRow(body, [day, run.silo_number, batches, run.grower_names || '–', kg2(run.volume_kg),
                    (run.left_kg == null || Number(run.left_kg) === 0) ? 'Empty' : kg2(run.left_kg),
                    localTime(run.opened_at) + '–' + localTime(run.closed_at) + ' (' + fmtDuration(run.minutes) + ')',
                    run.kg_per_hour == null ? '–' : kg2(run.kg_per_hour)], hd);
                if (run.times_edited) tr.children[6].appendChild(D.el('span', 'plog-pill', 'time changed'));
            });
            subtotal();
            return;
        }

        var hs = [{ text: state.mode === 'quarter' ? 'Week' : state.mode === 'year' ? 'Month' : 'Day' },
            { text: 'Silo runs', num: true }, { text: 'Emptied', num: true }, { text: 'Volume cracked (kg)', num: true },
            { text: 'Cracking time', num: true }, { text: 'kg / hour', num: true }];
        var sbody = startTable(hs);
        if (!t.runs) { noneRow(sbody, hs.length, nothingText('cracked')); return; }
        summaryRows(sbody, hs, list, function (b) {
            var s = sumCracked(days.filter(function (d) { return d.day >= b.from && d.day <= b.to; }));
            var a = kgh(s.kg, s.minutes);
            return [String(s.runs), String(s.emptied), kg2(s.kg), fmtDuration(s.minutes), a == null ? '–' : kg2(a)];
        });
        addRow(sbody, ['Total', String(t.runs), String(t.emptied), kg2(t.kg), fmtDuration(t.minutes), avg == null ? '–' : kg2(avg)],
            hs, 'mgmt-total-row');
    }

    function renderPacked(r, rows) {
        rows = rows.map(function (p) { var c = {}; for (var k in p) c[k] = p[k]; c.day = String(p.day).slice(0, 10); return c; });
        var t = sumPacked(rows);
        D.setTiles('plogTotals', [
            totalTile('Sound kernel packed', kg2(t.sk) + ' kg', null, true),
            totalTile('Cartons', cartons(t.skc), 'sound kernel'),
            totalTile('Butter packed', kg2(t.bt) + ' kg', '7/8, high and low oil'),
            totalTile('Batches packed', String(t.batchCount))
        ]);
        var list = renderBars(r, rows.map(function (p) { return { day: p.day, value: +p.sk_kg || 0 }; }), function (v) { return kg2(v) + ' kg'; });

        if (detailMode()) {
            // Only the styles packed in this period get a column.
            var styles = SK_STYLES.filter(function (s) { return t.styles[s]; });
            var hd = [{ text: 'Date' }, { text: 'Batch' }, { text: 'Supplier' }]
                .concat(styles.map(function (s) { return { text: 'Style ' + s + ' (kg)', num: true }; }))
                .concat([{ text: 'Sound kernel (kg)', num: true }, { text: 'Cartons', num: true }, { text: 'Butter (kg)', num: true }]);
            var body = startTable(hd);
            if (!rows.length) { noneRow(body, hd.length, nothingText('packed')); return; }
            var lastDay = null, dayRows = [];
            var subtotal = function () {
                if (state.mode !== 'week' || !dayRows.length) return;
                var s = sumPacked(dayRows);
                addRow(body, [fmtDay(lastDay) + ' total', '', ''].concat(styles.map(function (st) { return kg2(s.styles[st]); }))
                    .concat([kg2(s.sk), cartons(s.skc), kg2(s.bt)]), hd, 'mgmt-total-row');
            };
            rows.forEach(function (p) {
                if (lastDay !== null && p.day !== lastDay) { subtotal(); dayRows = []; }
                lastDay = p.day;
                dayRows.push(p);
                addRow(body, [p.day, macBatchNo.format(p.batch_number || ''), p.supplier || '–']
                    .concat(styles.map(function (st) { return kg2(p.by_style && p.by_style[st]); }))
                    .concat([kg2(p.sk_kg), cartons(p.sk_cartons), kg2(p.bt_kg)]), hd);
            });
            subtotal();
            return;
        }

        var hs = [{ text: state.mode === 'quarter' ? 'Week' : state.mode === 'year' ? 'Month' : 'Day' },
            { text: 'Batches', num: true }, { text: 'Sound kernel (kg)', num: true }, { text: 'Cartons', num: true },
            { text: 'Butter (kg)', num: true }];
        var sbody = startTable(hs);
        if (!rows.length) { noneRow(sbody, hs.length, nothingText('packed')); return; }
        summaryRows(sbody, hs, list, function (b) {
            var s = sumPacked(rows.filter(function (p) { return p.day >= b.from && p.day <= b.to; }));
            return [String(s.batchCount), kg2(s.sk), cartons(s.skc), kg2(s.bt)];
        });
        addRow(sbody, ['Total', String(t.batchCount), kg2(t.sk), cartons(t.skc), kg2(t.bt)], hs, 'mgmt-total-row');
    }

    // ------------------------------------------------------------------
    // Wiring.
    // ------------------------------------------------------------------

    function bind() {
        Array.prototype.forEach.call(document.querySelectorAll('#plogStage button[data-stage]'), function (b) {
            b.addEventListener('click', function () { state.stage = b.getAttribute('data-stage'); load(); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('#plogMode button[data-mode]'), function (b) {
            b.addEventListener('click', function () { state.mode = b.getAttribute('data-mode'); load(); });
        });
        $('plogPrev').addEventListener('click', function () { step(-1); load(); });
        $('plogNext').addEventListener('click', function () { step(1); load(); });
        $('plogToday').addEventListener('click', function () { state.anchor = todayStr(); load(); });
        $('plogDate').addEventListener('change', function () {
            var v = $('plogDate').value;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
            state.anchor = v > todayStr() ? todayStr() : v;
            load();
        });
    }

    return {
        init: function () {
            if (!D || !$('plog')) return;
            state = { stage: 'cracked', mode: 'week', anchor: todayStr(), seq: state.seq + 1 };
            bind();
            load();
        },
        destroy: function () { state.seq++; }
    };
}());

window._productionLog = _productionLog;
