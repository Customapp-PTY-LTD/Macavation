/**
 * South African public holidays, worked out (company calendar, 27 Nov 2026).
 *
 * Same rule as the database function sa_public_holidays (migration 20261127130000), so the
 * Procurement plan forecast and the Calendar agree: the fixed dates, Good Friday and Family Day
 * from Easter, and a holiday that falls on a Sunday is also observed on the Monday.
 *
 *   SaHolidays.name('2026-12-25')   -> 'Christmas Day' (or null)
 *   SaHolidays.forYear(2027)        -> { 'YYYY-MM-DD': 'name', ... }
 */
var SaHolidays = (function () {
    'use strict';

    var FIXED = [
        [1, 1, "New Year's Day"], [3, 21, 'Human Rights Day'], [4, 27, 'Freedom Day'], [5, 1, "Workers' Day"],
        [6, 16, 'Youth Day'], [8, 9, "National Women's Day"], [9, 24, 'Heritage Day'],
        [12, 16, 'Day of Reconciliation'], [12, 25, 'Christmas Day'], [12, 26, 'Day of Goodwill']
    ];
    var cache = {};

    function iso(d) { return d.toISOString().slice(0, 10); }

    /** Easter Sunday (Anonymous Gregorian algorithm), as a UTC Date. */
    function easter(y) {
        var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
            f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
            i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
            n = h + l - 7 * m + 114;
        return new Date(Date.UTC(y, Math.floor(n / 31) - 1, (n % 31) + 1));
    }

    function addDays(d, n) { return new Date(d.getTime() + n * 864e5); }

    function forYear(y) {
        if (cache[y]) return cache[y];
        var out = {};
        var list = FIXED.map(function (f) { return [new Date(Date.UTC(y, f[0] - 1, f[1])), f[2]]; });
        var e = easter(y);
        list.push([addDays(e, -2), 'Good Friday'], [addDays(e, 1), 'Family Day']);
        list.forEach(function (x) {
            var k = iso(x[0]);
            out[k] = out[k] ? out[k] + ' / ' + x[1] : x[1];
        });
        list.forEach(function (x) {
            if (x[0].getUTCDay() === 0) {
                var k = iso(addDays(x[0], 1));
                var nm = x[1] + ' (observed)';
                out[k] = out[k] ? out[k] + ' / ' + nm : nm;
            }
        });
        cache[y] = out;
        return out;
    }

    /** Holiday name for 'YYYY-MM-DD', or null. */
    function name(day) {
        var y = parseInt(String(day || '').slice(0, 4), 10);
        if (!y) return null;
        return forYear(y)[String(day).slice(0, 10)] || null;
    }

    return { forYear: forYear, name: name, easter: function (y) { return iso(easter(y)); } };
})();
