/**
 * Stock red-flag evaluation — shared between kernel/oil stock grids and dashboard.
 * Observations are sent to evaluate_stock_alerts RPC; rules are configured in Stock Alert Rules admin.
 */
var StockAlertsShared = (function () {
    'use strict';

    var STYLE_KEY_MAP = {
        SP: 'SP', '0': '0', '1': '1', '1S': '1S', '4L': '4L', '5': '5', '6': '6',
        '7/8': '7/8', 'Butter High Oil': 'Butter High Oil', 'Butter Low Oil': 'Butter Low Oil'
    };

    function parseStyleMap(batch, prop) {
        var v = batch && batch[prop];
        if (v == null) return {};
        if (typeof v === 'object' && !Array.isArray(v)) return v;
        if (typeof v === 'string') {
            try {
                var p = JSON.parse(v.trim());
                if (typeof p === 'object' && p !== null && !Array.isArray(p)) return p;
            } catch (e) { /* ignore */ }
        }
        return {};
    }

    function num(v) {
        if (v == null || v === '') return 0;
        var n = typeof v === 'number' ? v : parseFloat(v);
        return isNaN(n) ? 0 : n;
    }

    function collectFromKernelBatches(batches, styleKeys) {
        var keys = styleKeys || Object.keys(STYLE_KEY_MAP);
        var totals = {};
        keys.forEach(function (k) { totals[k] = 0; });
        (batches || []).forEach(function (b) {
            var rem = parseStyleMap(b, 'remaining_by_style');
            keys.forEach(function (k) {
                totals[k] += num(rem[k]);
            });
        });
        var observations = [];
        keys.forEach(function (k) {
            if (totals[k] > 0 || totals[k] === 0) {
                observations.push({ product_type: 'kernel', style: k, qty: totals[k] });
            }
        });
        return observations;
    }

    function collectFromOilLots(lots) {
        var oilKg = 0;
        var proteinKg = 0;
        (lots || []).forEach(function (l) {
            var s = (l.status && String(l.status).toLowerCase()) || '';
            if (s !== 'on_hand' && s !== 'hold') return;
            var kg = num(l.kilograms);
            var g = (l.grade != null ? String(l.grade) : '').toLowerCase();
            var cat = (l.stock_category != null ? String(l.stock_category) : '').toLowerCase();
            if (g.indexOf('protein') !== -1 || cat.indexOf('protein') !== -1) {
                proteinKg += kg;
            } else {
                oilKg += kg;
            }
        });
        return [
            { product_type: 'oil', style: '*', qty: oilKg },
            { product_type: 'protein', style: '*', qty: proteinKg }
        ];
    }

    function collectFromShellLots(lots) {
        var shellKg = 0;
        (lots || []).forEach(function (l) {
            var s = (l.status && String(l.status).toLowerCase()) || 'in_stock';
            if (s === 'dispatched' || s === 'written_off') return;
            shellKg += num(l.quantity_kg);
        });
        return [{ product_type: 'shell', style: '*', qty: shellKg }];
    }

    function evaluateObservations(observations) {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.evaluateStockAlerts) {
            return Promise.resolve({ success: false, skipped: true });
        }
        if (!observations || !observations.length) return Promise.resolve({ success: true, checked: 0, raised: 0 });
        return dataFunctions.evaluateStockAlerts(observations).catch(function (e) {
            console.warn('[StockAlerts] evaluateStockAlerts failed:', e.message || e);
            return { success: false, error: e.message };
        });
    }

    function captureAccuracySnapshot(totalSoh, adjustedQty, adjustmentEvents, productType) {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.captureStockAccuracySnapshot) return Promise.resolve();
        var month = new Date();
        month = month.getFullYear() + '-' + String(month.getMonth() + 1).padStart(2, '0') + '-01';
        return dataFunctions.captureStockAccuracySnapshot({
            month: month,
            product_type: productType || 'kernel',
            total_soh: totalSoh,
            adjusted_qty: adjustedQty || 0,
            adjustment_events: adjustmentEvents || 0
        }).catch(function (e) {
            console.warn('[StockAlerts] captureStockAccuracySnapshot failed:', e.message || e);
        });
    }

    return {
        STYLE_KEY_MAP: STYLE_KEY_MAP,
        collectFromKernelBatches: collectFromKernelBatches,
        collectFromOilLots: collectFromOilLots,
        collectFromShellLots: collectFromShellLots,
        evaluateObservations: evaluateObservations,
        captureAccuracySnapshot: captureAccuracySnapshot,
        runKernelStockCheck: function (batches, styleKeys) {
            return evaluateObservations(collectFromKernelBatches(batches, styleKeys));
        },
        runOilStockCheck: function (lots) {
            return evaluateObservations(collectFromOilLots(lots));
        },
        runShellStockCheck: function (lots) {
            return evaluateObservations(collectFromShellLots(lots));
        }
    };
}());
