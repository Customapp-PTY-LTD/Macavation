/**
 * Shared weekly pivot helpers for Stock Management (kernel/oil) and Supplier Intake.
 */
var StockWeeklyShared = (function () {
    'use strict';

    function getIsoWeekKey(d) {
        if (!d) return '';
        var date;
        if (typeof d === 'string') {
            var s = d.trim();
            date = (s.indexOf('T') !== -1) ? new Date(s) : new Date(s + 'T12:00:00');
        } else {
            date = d instanceof Date ? d : new Date(d);
        }
        if (isNaN(date.getTime())) return '';
        var year = date.getFullYear();
        var start = new Date(year, 0, 1);
        var days = Math.floor((date - start) / 86400000);
        var weekNum = Math.floor(days / 7) + 1;
        if (weekNum > 52) {
            var nextJan = new Date(year + 1, 0, 1);
            if (date >= nextJan) { year += 1; weekNum = 1; }
        }
        var pad = weekNum < 10 ? '0' : '';
        return year + '-W' + pad + weekNum;
    }

    return {
        getIsoWeekKey: getIsoWeekKey
    };
})();
