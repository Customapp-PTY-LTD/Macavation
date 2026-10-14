/**
 * Kernel Dashboard - Procurement, Production, Stock and Sales by financial year (Apr-Mar).
 *
 * Each section loads on its own: a failed or not-yet-migrated RPC empties that section only
 * (Promise.allSettled), never the whole screen. Wrappers return null on failure.
 *
 * Security: database values reach the DOM through MgmtDashboard.el/textContent only.
 */
var _kernelDashboard = (function () {
    'use strict';

    var D = window.MgmtDashboard;
    var getPeriod = null;
    var loadSeq = 0;
    var supplierMin = 0;
    var salesUnit = 'kg';
    var salesStyle = '';
    var last = { proc: null, sales: null };

    function dataFns() { return (typeof dataFunctions !== 'undefined') ? dataFunctions : null; }

    function call(name) {
        var df = dataFns();
        var args = Array.prototype.slice.call(arguments, 1);
        if (!df || typeof df[name] !== 'function') return Promise.resolve(null);
        return df[name].apply(df, args).catch(function () { return null; });
    }

    // ------------------------------------------------------------------
    // Procurement.
    // ------------------------------------------------------------------

    function renderProcurement(p, period) {
        last.proc = { data: p, period: period };
        if (!p) {
            D.setTiles('kdProcTiles', []);
            D.setFreshness('kdProcFresh', null);
            D.emptyBox('kdSupplierChart', 'Not available yet', 'The dashboard functions have not been applied to this database.');
            D.emptyBox('kdNisMonthChart', 'Not available yet');
            D.fillTable('kdQuarterTable', [], []);
            return;
        }
        var c = D.colors();
        var total = Number(p.total_kg) || 0;
        var suppliers = (p.by_supplier || []).map(function (s) { return { name: s.supplier_name, kg: Number(s.nis_kg) || 0 }; });
        var top = suppliers[0];
        var curMonth = D.currentMonthKey();
        var monthNow = D.seriesFor(p.by_month, [curMonth], 'nis_kg')[0];
        D.setFreshness('kdProcFresh', p.last_date, 'Nut in Shell Intake has not been updated since this date');
        D.setTiles('kdProcTiles', [
            D.tile(period.label, D.kg(total), 'nut in shell received'),
            D.tile('Suppliers delivering', String(suppliers.length),
                suppliers.filter(function (s) { return s.kg >= 10000; }).length + ' above 10 tonnes'),
            D.tile('Biggest supplier', top && total ? Math.round(top.kg / total * 100) + '%' : '–', top ? top.name : 'no deliveries'),
            D.tile(D.monthLabel(curMonth).replace(' (to date)', '') + ', to date', D.kg(monthNow), 'this month so far')
        ]);

        renderSupplierChart();

        if (!(p.by_month || []).length) {
            D.emptyBox('kdNisMonthChart', 'No deliveries for this period');
        } else {
            var vals = D.seriesFor(p.by_month, period.months, 'nis_kg');
            D.drawChart('kdNisMonthChart', 'bar', period.months.map(D.monthLabel),
                [{ label: 'Received', data: vals, barColors: D.monthBarColors(period.months, c.green, c.greenSoft) }], 'kg');
        }

        // Quarter table (financial-year quarters).
        var q = {};
        (p.by_month || []).forEach(function (r) {
            var n = D.quarterOfMonthKey(r.month);
            q[n] = q[n] || { months: [], kg: 0 };
            q[n].months.push(D.monthLabel(r.month).replace(' (to date)', ''));
            q[n].kg += Number(r.nis_kg) || 0;
        });
        var names = { 1: 'Apr – Jun', 2: 'Jul – Sep', 3: 'Oct – Dec', 4: 'Jan – Mar' };
        var rows = Object.keys(q).sort().map(function (k) { return ['Q' + k, names[k], D.num(q[k].kg)]; });
        D.fillTable('kdQuarterTable',
            [{ text: 'Quarter' }, { text: 'Months' }, { text: 'kg', num: true }],
            rows, rows.length ? ['Total', '', D.num(total)] : null);
    }

    function renderSupplierChart() {
        var p = last.proc && last.proc.data;
        if (!p) return;
        var c = D.colors();
        var total = Number(p.total_kg) || 0;
        var list = (p.by_supplier || []).map(function (s) { return { name: s.supplier_name, kg: Number(s.nis_kg) || 0 }; })
            .filter(function (s) { return s.kg > supplierMin; });
        if (!list.length) {
            D.emptyBox('kdSupplierChart', supplierMin ? 'No supplier above this size in the period' : 'No deliveries for this period');
            return;
        }
        D.fitHeight('kdSupplierChart', list.length);
        D.drawChart('kdSupplierChart', 'hbar', list.map(function (s) { return s.name; }),
            [{ label: '', data: list.map(function (s) { return s.kg; }), color: c.green }], 'kg',
            { tooltipExtra: function (v) { return total ? ' · ' + (v / total * 100).toFixed(1) + '% of period' : ''; } });
    }

    // ------------------------------------------------------------------
    // Production - this FY against the previous one, Apr to Mar.
    // ------------------------------------------------------------------

    function renderProduction(cur, prev, period) {
        var c = D.colors();
        var fy = period.fy;
        var months = D.fyMonths(fy);
        var prevMonths = D.fyMonths(fy - 1);
        if (!cur) {
            D.setTiles('kdProdTiles', []);
            D.setFreshness('kdProdFresh', null);
            D.emptyBox('kdCrackedChart', 'Not available yet', 'The dashboard functions have not been applied to this database.');
            return;
        }
        D.setFreshness('kdProdFresh', cur.last_date, 'Production (daily) has gaps or has not been updated');
        var curKey = D.currentMonthKey();
        var curIdx = months.indexOf(curKey);
        var a = D.seriesFor(cur.by_month, months, 'cracked_kg');
        var b = prev ? D.seriesFor(prev.by_month, prevMonths, 'cracked_kg') : null;
        // Months not reached yet in the current FY are gaps, not zeros.
        var aPlot = a.map(function (v, i) { return curIdx !== -1 && i > curIdx ? null : v; });
        // Compare full months only: the current month is partial.
        var full = curIdx === -1 ? 12 : curIdx;
        var sum = function (arr, n) { return arr ? arr.slice(0, n).reduce(function (s, v) { return s + (v || 0); }, 0) : 0; };
        var aFull = sum(a, full), bFull = sum(b, full);
        var best = { v: -1, i: 0 };
        aPlot.forEach(function (v, i) { if (v != null && v > best.v) best = { v: v, i: i }; });
        var fullLabel = full === 12 ? 'FY ' + fy : 'Apr – ' + D.MONTHS[(3 + full - 1) % 12] + ' (full months)';
        D.setTiles('kdProdTiles', [
            D.tile(fullLabel, D.kg(aFull), 'kernel cracked'),
            b ? D.tile('Against the same months last year', D.kg(bFull) + ' last year', null, D.pct(aFull, bFull))
              : D.tile('Against last year', '–', 'no figures for FY ' + (fy - 1)),
            D.tile('Best month', best.v > 0 ? D.kg(best.v) : '–', best.v > 0 ? D.MONTHS[(3 + best.i) % 12] : ''),
            curIdx !== -1 ? D.tile(D.MONTHS[(3 + curIdx) % 12] + ', to date', D.kg(a[curIdx]), 'this month so far')
                          : D.tile('Monthly average', D.kg(aFull / 12), 'FY ' + fy)
        ]);
        document.getElementById('kdProdTitle').textContent =
            'Cracked (kg) per month, FY ' + fy + (b ? ' against FY ' + (fy - 1) : '');
        var labels = months.map(D.monthLabel);
        var sets = [{ label: 'FY ' + fy, data: aPlot, color: c.green,
            pointColors: aPlot.map(function (v, i) { return i === curIdx ? c.surface : c.green; }) }];
        if (b) sets.push({ label: 'FY ' + (fy - 1), data: b, color: c.tan, dashed: true });
        D.drawChart('kdCrackedChart', 'line', labels, sets, 'kg');
    }

    // ------------------------------------------------------------------
    // Stock - last 12 months, independent of the period filter.
    // ------------------------------------------------------------------

    function renderStock(rows) {
        var c = D.colors();
        var s = D.summariseStock(rows);
        if (!s.dates.length) {
            D.setTiles('kdStockTiles', []);
            D.setFreshness('kdStockFresh', null);
            D.emptyBox('kdSohChart', 'No stock history', 'Nothing has been booked into kernel stock in the last 12 months.');
            D.fillTable('kdStyleTable', [], []);
            return;
        }
        var now = s.totals[s.totals.length - 1];
        var weekAgo = s.totals.length > 7 ? s.totals[s.totals.length - 8] : null;
        D.setFreshness('kdStockFresh', s.lastDate);
        D.setTiles('kdStockTiles', [
            D.tile('Kernel on hand', D.kg(now), D.prettyDate(s.lastDate)),
            weekAgo != null ? D.tile('Against a week ago', D.kg(weekAgo) + ' then', null, D.pct(now, weekAgo))
                            : D.tile('Against a week ago', '–', ''),
            D.tile('Styles in stock', String(s.latest.length), 'with stock on hand today')
        ]);
        var w = D.weeklyPoints(s);
        D.drawChart('kdSohChart', 'line', w.labels, [{ label: '', data: w.values, color: c.green }], 'kg');
        var total = s.latest.reduce(function (t, r) { return t + r.qty_kg; }, 0);
        D.fillTable('kdStyleTable', [{ text: 'Style' }, { text: 'kg', num: true }, { text: 'Share', num: true }],
            s.latest.map(function (r) { return [r.series, D.num(r.qty_kg), total ? Math.round(r.qty_kg / total * 100) + '%' : '']; }),
            s.latest.length ? ['Total', D.num(total), '100%'] : null);
    }

    // ------------------------------------------------------------------
    // Sales - kg or rand (excl. VAT), optional style.
    // ------------------------------------------------------------------

    function renderSales(p, period) {
        last.sales = { data: p, period: period };
        var c = D.colors();
        if (!p) {
            D.setTiles('kdSalesTiles', []);
            D.setFreshness('kdSalesFresh', null);
            ['kdSalesMonthChart', 'kdSalesStyleChart', 'kdCustomerChart'].forEach(function (id) {
                D.emptyBox(id, 'Not available yet', 'The dashboard functions have not been applied to this database.');
            });
            return;
        }
        fillStyleSelect(p.by_style || []);
        var unit = salesUnit;
        var field = unit === 'R' ? 'value_zar' : 'quantity_kg';
        var fmt = unit === 'R' ? D.rand : D.kg;
        var totalKg = Number(p.total_kg) || 0, totalZar = Number(p.total_zar) || 0;
        var curKey = D.currentMonthKey();
        var monthVals = D.seriesFor(p.by_month, period.months, field);
        var curIdx = period.months.indexOf(curKey);
        D.setFreshness('kdSalesFresh', p.last_date, 'Kernel Sales has not been updated since this date');
        D.setTiles('kdSalesTiles', [
            D.tile('Sold, ' + period.label + (salesStyle ? ' · ' + salesStyle : ''), fmt(unit === 'R' ? totalZar : totalKg),
                unit === 'R' ? D.kg(totalKg) : D.rand(totalZar) + ' excl. VAT'),
            D.tile('Average price', totalKg ? 'R ' + (totalZar / totalKg).toFixed(2) + ' /kg' : '–', 'excl. VAT'),
            curIdx !== -1 ? D.tile(D.MONTHS[+curKey.slice(5) - 1] + ', to date', fmt(monthVals[curIdx]), 'this month so far')
                          : D.tile('Customers', String((p.by_customer || []).length), 'bought in this period')
        ]);
        document.getElementById('kdSalesMonthTitle').textContent =
            'Kernel sold per month' + (unit === 'R' ? ' (R, excl. VAT)' : ' (kg)') + (salesStyle ? ' · ' + salesStyle : '');

        if (!(p.by_month || []).length) {
            D.emptyBox('kdSalesMonthChart', 'No sales for this period');
        } else {
            D.drawChart('kdSalesMonthChart', 'bar', period.months.map(D.monthLabel),
                [{ label: '', data: monthVals, barColors: D.monthBarColors(period.months, c.green, c.greenSoft) }], unit);
        }

        var styles = (p.by_style || []);
        if (!styles.length) {
            D.emptyBox('kdSalesStyleChart', 'No sales for this period');
        } else {
            D.fitHeight('kdSalesStyleChart', styles.length);
            D.drawChart('kdSalesStyleChart', 'hbar', styles.map(function (s) { return s.style_code; }),
                [{ label: '', data: styles.map(function (s) { return Number(s[field]) || 0; }),
                   barColors: styles.map(function (s) { return salesStyle && s.style_code === salesStyle ? c.green : (salesStyle ? c.greenSoft : c.green); }) }], unit);
        }

        var cust = (p.by_customer || []).slice(0, 8);
        var rest = (p.by_customer || []).slice(8).reduce(function (s, r) { return s + (Number(r[field]) || 0); }, 0);
        if (!cust.length) {
            D.emptyBox('kdCustomerChart', 'No sales for this period');
        } else {
            var labels = cust.map(function (r) { return r.customer_name; });
            var vals = cust.map(function (r) { return Number(r[field]) || 0; });
            var cols = cust.map(function () { return c.green; });
            if (rest > 0) { labels.push('Others'); vals.push(rest); cols.push(c.tan); }
            D.fitHeight('kdCustomerChart', labels.length);
            D.drawChart('kdCustomerChart', 'hbar', labels, [{ label: '', data: vals, barColors: cols }], unit);
        }
    }

    function fillStyleSelect(styles) {
        var sel = document.getElementById('kdSalesStyle');
        if (!sel) return;
        var keep = salesStyle;
        D.clear(sel);
        var all = D.el('option', null, 'All styles'); all.value = ''; sel.appendChild(all);
        styles.forEach(function (s) {
            var o = D.el('option', null, s.style_code);
            o.value = s.style_code;
            sel.appendChild(o);
        });
        sel.value = keep;
        if (sel.value !== keep) { sel.value = ''; salesStyle = ''; }
    }

    // ------------------------------------------------------------------
    // Load.
    // ------------------------------------------------------------------

    function load(period) {
        var seq = ++loadSeq;
        document.getElementById('kdPeriodLabel').textContent =
            period.custom ? period.label : (period.quarter ? period.label + ' · ' : '') + D.fyLabel(period.fy);
        var prevRange = D.fyRange(period.fy - 1);
        var curRange = D.fyRange(period.fy);
        Promise.allSettled([
            call('getKernelDashboardProcurement', period.from, period.to),
            call('getKernelDashboardProduction', curRange.from, curRange.to),
            call('getKernelDashboardProduction', prevRange.from, prevRange.to),
            call('getKernelDashboardSales', period.from, period.to, salesStyle || null)
        ]).then(function (r) {
            if (seq !== loadSeq) return; // a newer filter change won
            var v = r.map(function (x) { return x.status === 'fulfilled' ? x.value : null; });
            renderProcurement(v[0], period);
            renderProduction(v[1], v[2], period);
            renderSales(v[3], period);
        });
    }

    function loadStock() {
        call('getStockSohHistory', 'kernel', 365).then(function (rows) { renderStock(Array.isArray(rows) ? rows : []); });
    }

    function reloadSales() {
        if (!getPeriod) return;
        var period = getPeriod();
        call('getKernelDashboardSales', period.from, period.to, salesStyle || null).then(function (p) { renderSales(p, period); });
    }

    function bindJumps() {
        Array.prototype.forEach.call(document.querySelectorAll('#kernelDashboardModule [data-jump]'), function (a) {
            a.addEventListener('click', function (e) {
                e.preventDefault();
                var target = document.getElementById(a.getAttribute('data-jump'));
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    return {
        init: function () {
            _kernelDashboard.destroy();
            if (!D || !document.getElementById('kernelDashboardModule')) return;
            supplierMin = 0; salesUnit = 'kg'; salesStyle = '';
            getPeriod = D.bindPeriodBar('kd', load);
            D.bindToggle('kdSupplierFilter', function (v) { supplierMin = +v || 0; renderSupplierChart(); });
            D.bindToggle('kdSalesUnit', function (v) {
                salesUnit = v;
                if (last.sales) renderSales(last.sales.data, last.sales.period);
            });
            var styleSel = document.getElementById('kdSalesStyle');
            if (styleSel) styleSel.addEventListener('change', function () { salesStyle = styleSel.value; reloadSales(); });
            bindJumps();
            load(getPeriod());
            loadStock();
        },
        destroy: function () {
            loadSeq++;
            if (D) D.destroyAll();
            last = { proc: null, sales: null };
        }
    };
}());

window._kernelDashboard = _kernelDashboard;
