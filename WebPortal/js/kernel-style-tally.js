/**
 * Kernel stock-on-hand tally, per style.
 *
 * Extracted from WebPortal/modules/stock-management/js/stock_management_grid.js so the Kernel Stock
 * Report section can show the SAME figures as the Kernel Stock on Hand page rather than a second
 * implementation of them. Two independent answers to "what stock do we have" is the exact class of
 * problem docs/database/KG_CRACKED_UNDERCOUNT_INVESTIGATION.md documents the cost of, so the stock
 * page now delegates here too — this file is the only place the tally is computed.
 *
 * Pure values only: no DOM, no jQuery, no `document`, nothing touched at evaluation time, so it can
 * be loaded with plain `vm.Script` and asserted headlessly.
 *
 * NOTE ON UNITS: the tally is in CARTONS (or a carton equivalent at 11.34 kg per carton where a
 * batch recorded only kg). The stock-on-hand history chart beside it is in KG and is reconstructed
 * from the packing/dispatch ledgers by get_stock_soh_history — a different source. The two do not
 * currently reconcile for every style, so each is labelled with its own unit and neither is
 * silently converted into the other.
 */
(function (w) {
    'use strict';

    // Canonical order, matching the Kernel Stock on Hand grid and kernel_style_totals() in
    // migrations/20260816090000_stock_soh_history.sql.
    var KERNEL_STYLES = ['SP', '0', '1', '1S', '4L', '5', '6', '7/8', 'Butter High Oil', 'Butter Low Oil'];

    var KG_PER_CARTON = 11.34;

    // Statuses that count as finished stock on the Kernel Stock on Hand page.
    var FINISHED_STATUSES = ['complete', 'in_finished_stock'];

    function parseNum(val) {
        if (val == null || val === '') return 0;
        var n = typeof val === 'number' ? val : parseFloat(val);
        return isNaN(n) ? 0 : n;
    }

    // Style maps from the API arrive as plain objects or, through the proxy, as JSON strings.
    function styleMapFromBatch(batch, prop) {
        var v = batch && batch[prop];
        if (v == null) return {};
        if (typeof v === 'object' && !Array.isArray(v)) return v;
        if (typeof v === 'string') {
            var s = v.trim();
            if (s === '' || s === 'null') return {};
            try {
                var p = JSON.parse(s);
                if (typeof p === 'object' && p !== null && !Array.isArray(p)) return p;
            } catch (e) { /* ignore */ }
        }
        return {};
    }

    // Per style for one batch, in the requested unit.
    //
    // 'cartons' (the default) is the Kernel Stock on Hand page's rule, unchanged: the recorded
    // carton count, else a carton equivalent from kg, else zero. 'kg' is its mirror image: the
    // recorded kg, else kg derived from the carton count. Each unit therefore prefers the figure
    // that was actually captured in that unit and only derives the other as a fallback — so
    // switching units is not a lossy round-trip through 11.34 when both were recorded.
    function cellsForBatch(batch, unit) {
        var wantKg = String(unit || 'cartons') === 'kg';
        var remKg = styleMapFromBatch(batch, 'remaining_by_style');
        var remCart = styleMapFromBatch(batch, 'remaining_by_style_cartons');
        var out = {};
        KERNEL_STYLES.forEach(function (k) {
            var rk = parseNum(remKg[k]);
            var rc = parseNum(remCart[k]);
            var v;
            if (wantKg) {
                v = rk > 0 ? rk : (rc > 0 ? rc * KG_PER_CARTON : 0);
            } else {
                v = rc > 0 ? rc : (rk > 0 ? rk / KG_PER_CARTON : 0);
            }
            out[k] = Math.round(v * 100) / 100;
        });
        return out;
    }

    // A batch is on the grid only if it still holds stock in at least one style. FFA, best-before
    // and historical yield alone do not keep it visible.
    function batchHasStock(batch) {
        if (!batch) return false;
        var cells = cellsForBatch(batch);
        return KERNEL_STYLES.some(function (k) { return parseNum(cells[k]) > 0; });
    }

    function isFinishedBatch(batch) {
        var st = (batch && batch.status != null) ? String(batch.status).trim() : '';
        return FINISHED_STATUSES.indexOf(st) !== -1;
    }

    // The tally: per style, in the requested unit, summed over every finished batch still holding
    // stock, plus the batch count that produced it. Rounded to 2dp per style so float addition
    // cannot show a carton count like 482.99999999.
    //
    // Which batches are included never depends on the unit — visibility is always decided on the
    // carton view, so switching to kg cannot make a batch appear or vanish.
    function tallyForBatches(batches, unit) {
        var list = Array.isArray(batches) ? batches : [];
        var visible = list.filter(function (b) { return isFinishedBatch(b) && batchHasStock(b); });
        var totals = {};
        KERNEL_STYLES.forEach(function (k) { totals[k] = 0; });
        visible.forEach(function (b) {
            var cells = cellsForBatch(b, unit);
            KERNEL_STYLES.forEach(function (k) { totals[k] += parseNum(cells[k]); });
        });
        KERNEL_STYLES.forEach(function (k) { totals[k] = Math.round(totals[k] * 100) / 100; });
        return { totals: totals, batchCount: visible.length, unit: String(unit || 'cartons') === 'kg' ? 'kg' : 'cartons' };
    }

    function grandTotal(totals) {
        var sum = 0;
        KERNEL_STYLES.forEach(function (k) { sum += parseNum(totals && totals[k]); });
        return Math.round(sum * 100) / 100;
    }

    w.KernelStyleTally = {
        KERNEL_STYLES: KERNEL_STYLES,
        KG_PER_CARTON: KG_PER_CARTON,
        FINISHED_STATUSES: FINISHED_STATUSES,
        parseNum: parseNum,
        styleMapFromBatch: styleMapFromBatch,
        cellsForBatch: cellsForBatch,
        batchHasStock: batchHasStock,
        isFinishedBatch: isFinishedBatch,
        tallyForBatches: tallyForBatches,
        grandTotal: grandTotal
    };
})(typeof window !== 'undefined' ? window : this);
