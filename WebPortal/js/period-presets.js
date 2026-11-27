/**
 * Shared period picker for performance screens (Suppliers, Customers, Shell; MacView round 3).
 * Same presets and "period before" rules as Transporters > Performance & spend, so arrows on
 * every screen compare like with like. Financial year = April to March.
 *
 *   MacPeriods.optionsHtml(selected)   <option> list for a <select>
 *   MacPeriods.range(preset, from, to) { from, to, pFrom, pTo, word, label }
 *   MacPeriods.trend(cur, prev, goodUp) "↑ 12%" span (goodUp false = rising is bad)
 *   MacPeriods.today()                 SAST date as YYYY-MM-DD
 */
var MacPeriods = (function () {
    'use strict';

    var PRESETS = [
        ['this-month', 'This month'], ['last-month', 'Last month'], ['last-3', 'Last 3 months'],
        ['fy', 'This financial year'], ['last-fy', 'Last financial year'], ['last-12', 'Last 12 months'],
        ['custom', 'Choose dates']
    ];

    function today() { return new Date(Date.now() + 2 * 3600 * 1000).toISOString().slice(0, 10); }
    function s2d(s) { return new Date(s + 'T00:00:00Z'); }
    function addDays(s, n) { return new Date(s2d(s).getTime() + n * 864e5).toISOString().slice(0, 10); }
    function daysBetween(a, b) { return Math.round((s2d(b) - s2d(a)) / 864e5); }
    function monthStart(s) { return s.slice(0, 7) + '-01'; }
    function addMonths(s, n) { var d = s2d(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
    function fyStart(s) { var y = parseInt(s.slice(0, 4), 10); if (parseInt(s.slice(5, 7), 10) < 4) y--; return y + '-04-01'; }

    function optionsHtml(sel) {
        return PRESETS.map(function (p) {
            return '<option value="' + p[0] + '"' + (p[0] === sel ? ' selected' : '') + '>' + p[1] + '</option>';
        }).join('');
    }

    function range(p, cFrom, cTo) {
        var t = today(), from, to, pFrom, pTo, word;
        if (p === 'last-month') { from = addMonths(t, -1); to = addDays(monthStart(t), -1); pFrom = addMonths(t, -2); pTo = addDays(from, -1); word = 'the month before'; }
        else if (p === 'last-3') { from = addMonths(t, -2); to = t; pFrom = addMonths(t, -5); pTo = addDays(from, -1); word = 'the 3 months before'; }
        else if (p === 'fy') { from = fyStart(t); to = t; pFrom = addMonths(from, -12); pTo = addDays(pFrom, daysBetween(from, to)); word = 'the same time last year'; }
        else if (p === 'last-fy') { to = addDays(fyStart(t), -1); from = addMonths(fyStart(t), -12); pFrom = addMonths(from, -12); pTo = addDays(from, -1); word = 'the year before'; }
        else if (p === 'last-12') { from = addMonths(t, -11); to = t; pTo = addDays(from, -1); pFrom = addMonths(from, -12); word = 'the 12 months before'; }
        else if (p === 'custom') {
            from = cFrom || monthStart(t); to = cTo || t;
            if (to < from) { var x = from; from = to; to = x; }
            var len = daysBetween(from, to);
            pTo = addDays(from, -1); pFrom = addDays(pTo, -len); word = 'the ' + (len + 1) + ' days before';
        } else { from = monthStart(t); to = t; pFrom = addMonths(t, -1); pTo = addDays(pFrom, daysBetween(from, to)); word = 'the same days last month'; }
        return { from: from, to: to, pFrom: pFrom, pTo: pTo, word: word };
    }

    function trend(cur, prev, goodUp) {
        if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev) || prev === 0) return '';
        var pct = (cur - prev) / Math.abs(prev) * 100;
        if (Math.abs(pct) < 0.5) return '<span class="small text-muted">same as before</span>';
        var up = pct > 0;
        var cls = goodUp == null ? 'text-muted' : ((up === !!goodUp) ? 'text-success' : 'text-danger');
        return '<span class="small ' + cls + '">' + (up ? '↑' : '↓') + ' ' + Math.round(Math.abs(pct)) + '%</span>';
    }

    /** "3 Nov 2026" */
    function day(s) {
        if (!s) return '';
        var d = s2d(String(s).slice(0, 10));
        return d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear();
    }

    return { optionsHtml: optionsHtml, range: range, trend: trend, today: today, day: day, addDays: addDays, fyStart: fyStart, addMonths: addMonths };
})();
