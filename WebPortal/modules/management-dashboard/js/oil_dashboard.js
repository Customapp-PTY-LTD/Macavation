/**
 * Oil Dashboard - raw materials in (kg by type), oil (litres) and protein (kg) out with the yield,
 * stock on hand, and local sales plus exports. Same layout and filters as the Kernel Dashboard.
 *
 * Sections load independently; an empty section says what has not been captured yet rather than
 * showing zeros that look like a real result.
 *
 * Security: database values reach the DOM through MgmtDashboard.el/textContent only.
 */
var _oilDashboard = (function () {
    'use strict';

    var D = window.MgmtDashboard;
    var getPeriod = null;
    var loadSeq = 0;
    var salesUnit = 'kg';
    var last = null;

    function call(name) {
        var df = (typeof dataFunctions !== 'undefined') ? dataFunctions : null;
        var args = Array.prototype.slice.call(arguments, 1);
        if (!df || typeof df[name] !== 'function') return Promise.resolve(null);
        return df[name].apply(df, args).catch(function () { return null; });
    }

    function notAvailable() {
        D.setTiles('odProcTiles', []); D.setTiles('odProdTiles', []); D.setTiles('odSalesTiles', []);
        ['odProcFresh', 'odProdFresh', 'odSalesFresh'].forEach(function (id) { D.setFreshness(id, null); });
        ['odIntakeMonthChart', 'odIntakeMaterialChart', 'odOilChart', 'odProteinChart', 'odSalesMonthChart', 'odSalesLineChart']
            .forEach(function (id) { D.emptyBox(id, 'Not available yet', 'The dashboard functions have not been applied to this database.'); });
    }

    function renderProcurement(p, period) {
        var c = D.colors();
        var total = Number(p.intake_total_kg) || 0;
        var materials = p.intake_by_material || [];
        D.setFreshness('odProcFresh', p.intake_last_date, 'Oil Step 1 - Supplier Intake has not been updated since this date');
        D.setTiles('odProcTiles', [
            D.tile(period.label, D.kg(total), 'raw materials received'),
            D.tile('Types of material', String(materials.length), materials.length ? 'largest: ' + materials[0].material : 'none received')
        ]);
        if (!(p.intake_by_month || []).length) {
            var hint = 'Raw materials are captured on Oil & Protein pipeline › Step 1 – Supplier Intake.';
            D.emptyBox('odIntakeMonthChart', 'Nothing captured for this period', hint);
            D.emptyBox('odIntakeMaterialChart', 'Nothing captured for this period', hint);
            return;
        }
        D.drawChart('odIntakeMonthChart', 'bar', period.months.map(D.monthLabel),
            [{ label: '', data: D.seriesFor(p.intake_by_month, period.months, 'kg'),
               barColors: D.monthBarColors(period.months, c.green, c.greenSoft) }], 'kg');
        D.fitHeight('odIntakeMaterialChart', materials.length);
        D.drawChart('odIntakeMaterialChart', 'hbar', materials.map(function (m) { return m.material; }),
            [{ label: '', data: materials.map(function (m) { return Number(m.kg) || 0; }), color: c.green }], 'kg');
    }

    function renderProduction(p, period) {
        var c = D.colors();
        var litresOut = Number(p.oil_total_litres) || 0;
        var proteinOut = Number(p.protein_total_kg) || 0;
        var kgIn = Number(p.intake_total_kg) || 0;
        D.setFreshness('odProdFresh', p.production_last_date, 'Oil Step 2 - Oil Production has not been updated since this date');
        D.setTiles('odProdTiles', [
            D.tile('Oil out', D.litres(litresOut), period.label),
            D.tile('Protein out', D.kg(proteinOut), period.label),
            D.tile('Yield', kgIn && litresOut ? (litresOut / kgIn).toFixed(2) + ' L per kg' : '–',
                kgIn && litresOut ? 'litres of oil per kg of raw material in' : 'needs both raw materials in and oil out')
        ]);
        var hint = 'Oil and protein out are captured on Oil & Protein pipeline › Step 2 – Oil Production.';
        if (!litresOut) D.emptyBox('odOilChart', 'Nothing captured for this period', hint);
        else D.drawChart('odOilChart', 'bar', period.months.map(D.monthLabel),
            [{ label: '', data: D.seriesFor(p.production_by_month, period.months, 'oil_litres'),
               barColors: D.monthBarColors(period.months, c.info, c.info) }], 'L');
        if (!proteinOut) D.emptyBox('odProteinChart', 'Nothing captured for this period', hint);
        else D.drawChart('odProteinChart', 'bar', period.months.map(D.monthLabel),
            [{ label: '', data: D.seriesFor(p.production_by_month, period.months, 'protein_kg'),
               barColors: D.monthBarColors(period.months, c.tan, c.tanSoft) }], 'kg');
    }

    function renderSales(p, period) {
        var c = D.colors();
        var unit = salesUnit;
        var fmt = unit === 'R' ? D.rand : D.kg;
        var localV = unit === 'R' ? Number(p.local_total_zar) : Number(p.local_total_kg);
        var exportV = unit === 'R' ? Number(p.export_total_zar) : Number(p.export_total_kg);
        D.setFreshness('odSalesFresh', p.sales_last_date, 'Oil & Protein Sales / Oil Export Register have not been updated since this date');
        D.setTiles('odSalesTiles', [
            D.tile('Local sales', fmt(localV || 0), period.label),
            D.tile('Exports', fmt(exportV || 0), unit === 'R' ? 'rand value as recorded per invoice' : period.label),
            D.tile('Total', fmt((localV || 0) + (exportV || 0)), unit === 'R' ? 'excl. VAT' : 'local and export')
        ]);
        document.getElementById('odSalesMonthTitle').textContent = 'Sold per month' + (unit === 'R' ? ' (R, excl. VAT)' : ' (kg)');
        if (!(p.sales_by_month || []).length) {
            D.emptyBox('odSalesMonthChart', 'No sales for this period');
        } else {
            D.drawChart('odSalesMonthChart', 'bar', period.months.map(D.monthLabel), [
                { label: 'Local', data: D.seriesFor(p.sales_by_month, period.months, unit === 'R' ? 'local_zar' : 'local_kg'), color: c.green },
                { label: 'Export', data: D.seriesFor(p.sales_by_month, period.months, unit === 'R' ? 'export_zar' : 'export_kg'), color: c.tan }
            ], unit);
        }
        var lines = p.sales_by_line || [];
        if (!lines.length) {
            D.emptyBox('odSalesLineChart', 'No local sales for this period');
        } else {
            D.fitHeight('odSalesLineChart', lines.length);
            D.drawChart('odSalesLineChart', 'hbar', lines.map(function (l) { return l.product_line; }),
                [{ label: '', data: lines.map(function (l) { return Number(unit === 'R' ? l.value_zar : l.kg) || 0; }), color: c.green }], unit);
        }
    }

    function renderStock(rows) {
        var c = D.colors();
        var s = D.summariseStock(rows);
        if (!s.dates.length || !s.totals.some(function (v) { return v !== 0; })) {
            D.setTiles('odStockTiles', []);
            D.setFreshness('odStockFresh', null);
            D.emptyBox('odSohChart', 'No stock history', 'Nothing has been booked into finished oil or protein stock in the last 12 months.');
            D.fillTable('odStreamTable', [], []);
            return;
        }
        var now = s.totals[s.totals.length - 1];
        D.setFreshness('odStockFresh', s.lastDate);
        D.setTiles('odStockTiles', [
            D.tile('On hand', D.kg(now), D.prettyDate(s.lastDate)),
            D.tile('Streams in stock', String(s.latest.length), 'food grade, cosmetic, protein')
        ]);
        var w = D.weeklyPoints(s);
        D.drawChart('odSohChart', 'line', w.labels, [{ label: '', data: w.values, color: c.info }], 'kg');
        var names = { food_grade: 'Food grade', cosmetic: 'Cosmetic', protein: 'Protein' };
        D.fillTable('odStreamTable', [{ text: 'Stream' }, { text: 'kg', num: true }],
            s.latest.map(function (r) { return [names[r.series] || r.series, D.kgNum(r.qty_kg)]; }),
            s.latest.length ? ['Total', D.kgNum(now)] : null);
    }

    function load(period) {
        var seq = ++loadSeq;
        document.getElementById('odPeriodLabel').textContent =
            period.custom ? period.label : (period.quarter ? period.label + ' · ' : '') + D.fyLabel(period.fy);
        call('getOilDashboard', period.from, period.to).then(function (p) {
            if (seq !== loadSeq) return;
            last = { data: p, period: period };
            if (!p) { notAvailable(); return; }
            renderProcurement(p, period);
            renderProduction(p, period);
            renderSales(p, period);
        });
    }

    function bindJumps() {
        Array.prototype.forEach.call(document.querySelectorAll('#oilDashboardModule [data-jump]'), function (a) {
            a.addEventListener('click', function (e) {
                e.preventDefault();
                var target = document.getElementById(a.getAttribute('data-jump'));
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        });
    }

    return {
        init: function () {
            _oilDashboard.destroy();
            if (!D || !document.getElementById('oilDashboardModule')) return;
            salesUnit = 'kg';
            getPeriod = D.bindPeriodBar('od', load);
            D.bindToggle('odSalesUnit', function (v) {
                salesUnit = v;
                if (last && last.data) renderSales(last.data, last.period);
            });
            bindJumps();
            load(getPeriod());
            call('getStockSohHistory', 'oil', 365).then(function (rows) { renderStock(Array.isArray(rows) ? rows : []); });
        },
        destroy: function () {
            loadSeq++;
            if (D) D.destroyAll();
            last = null;
        }
    };
}());

window._oilDashboard = _oilDashboard;
