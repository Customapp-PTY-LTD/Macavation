/**
 * OilBatchIngredients — shared "raw ingredients that went into this oil batch" modal.
 *
 * An oil batch's "supplier" is not one contact: it is the set of raw material batches consumed to
 * make it, each carrying its own supplier, batch number, quantity and FFA. That is why Find a
 * batch shows a button here rather than a name — one oil batch can draw on several suppliers.
 *
 * Lifted verbatim out of stock_management_grid.js (formatOilBatchIngredientsHtml +
 * showOilBatchIngredientsModal) so Find a batch and Stock Management render the same thing from
 * one place instead of two copies drifting apart. Stock Management now delegates here.
 */
(function (global) {
    'use strict';

    function escapeHtml(s) {
        if (s == null) return '';
        if (typeof _common !== 'undefined' && _common.escapeHtml) return _common.escapeHtml(s);
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * True when a get_oil_batches row records any raw ingredient, WITHOUT calling the detail RPC.
     *
     * The grid needs this per row to choose between "—" and a button, and a per-row RPC would mean
     * one request per visible batch (up to 500). production_data already travels with the row and
     * carries the same three signals the detail endpoint reports on, so the decision is free.
     */
    function hasIngredients(row) {
        if (!row) return false;
        var pd = row.production_data;
        if (pd == null) return false;
        if (typeof pd === 'string') {
            try { pd = JSON.parse(pd); } catch (e) { return false; }
        }
        if (!pd || typeof pd !== 'object') return false;
        if (Array.isArray(pd.raw_ingredient_audit) && pd.raw_ingredient_audit.length) return true;
        if (Array.isArray(pd.shift_segments) && pd.shift_segments.length) return true;
        if (typeof pd.ingredients === 'string' && pd.ingredients.trim() !== '') return true;
        if (Array.isArray(pd.ingredients) && pd.ingredients.length) return true;
        if (typeof pd.shifts === 'string' && pd.shifts.trim() !== '') return true;
        return false;
    }

    /** Distinct supplier names on a row's raw ingredient audit — used for the button label. */
    function supplierNames(row) {
        var pd = row && row.production_data;
        if (typeof pd === 'string') {
            try { pd = JSON.parse(pd); } catch (e) { return []; }
        }
        var audit = (pd && Array.isArray(pd.raw_ingredient_audit)) ? pd.raw_ingredient_audit : [];
        var seen = [];
        audit.forEach(function (r) {
            var s = (r && (r.supplier || r.supplier_details) ? String(r.supplier || r.supplier_details) : '').trim();
            if (s && seen.indexOf(s) === -1) seen.push(s);
        });
        return seen;
    }

    function formatHtml(d) {
        if (!d || d.success === false) {
            return '<p class="text-danger mb-0">' + escapeHtml((d && d.error) ? d.error : 'Unable to load ingredients.') + '</p>';
        }
        var parts = [];
        parts.push('<p class="small text-muted mb-2">Batch <strong>' + escapeHtml(String(d.batch_number || '')) + '</strong>');
        if (d.oil_stream) parts.push(' · Stream: <strong>' + escapeHtml(String(d.oil_stream)) + '</strong>');
        parts.push('</p>');
        if (!d.has_oil_bin_batch && !d.has_oil_row) {
            parts.push('<p class="mb-0">No production ingredient record was found for this batch (e.g. manually added stock, imports, or legacy data).</p>');
            return parts.join('');
        }
        /** Hide legacy rows where the whole bin "ingredients" string was copied into one line (comma-separated batch refs, no qty). */
        function normIng(s) {
            return String(s || '').replace(/\s+/g, ' ').trim();
        }
        function isJunkSegmentIngredientRow(ing, binIngredientsText) {
            var desc = normIng(ing.description || ing.batch_id || ing.product_type || '');
            if (!desc) return false;
            var binT = normIng(binIngredientsText);
            if (binT && desc === binT) return true;
            var qty = ing.qty_kg != null ? ing.qty_kg : (ing.quantity_kg != null ? ing.quantity_kg : null);
            var qtyEmpty = qty === null || qty === undefined || qty === '';
            if (!qtyEmpty) return false;
            if (!binT) return false;
            if (desc.length < 15 || desc.indexOf(',') === -1) return false;
            return desc === binT || desc.replace(/\s*,\s*/g, ',') === binT.replace(/\s*,\s*/g, ',');
        }
        if (d.shifts_text && String(d.shifts_text).trim()) {
            parts.push('<h6 class="mt-2 mb-1 text-start">Shifts (text)</h6>');
            parts.push('<p class="text-start small mb-2">' + escapeHtml(String(d.shifts_text)).replace(/\n/g, '<br>') + '</p>');
        }
        var segs = d.shift_segments;
        if (segs && Array.isArray(segs) && segs.length > 0) {
            parts.push('<h6 class="mt-2 mb-1 text-start">Shifts &amp; ingredients</h6>');
            segs.forEach(function (seg, i) {
                parts.push('<div class="border rounded p-2 mb-2 text-start">');
                parts.push('<div class="fw-bold">' + escapeHtml('Segment ' + (i + 1) + (seg.shift_name ? ': ' + String(seg.shift_name) : '')) + '</div>');
                if (seg.shift_date) parts.push('<div class="small text-muted">' + escapeHtml(String(seg.shift_date)) + '</div>');
                var ings = seg.ingredients;
                if (ings && Array.isArray(ings) && ings.length) {
                    ings = ings.filter(function (ing) {
                        return !isJunkSegmentIngredientRow(ing, d.ingredients_text);
                    });
                }
                if (ings && Array.isArray(ings) && ings.length) {
                    parts.push('<table class="table align-middle table-bordered mt-1 mb-0"><thead><tr><th>Item</th><th>Supplier</th><th class="text-end">Qty (kg)</th></tr></thead><tbody>');
                    ings.forEach(function (ing) {
                        var desc = ing.description || ing.batch_id || ing.product_type || '';
                        var qty = ing.qty_kg != null ? ing.qty_kg : (ing.quantity_kg != null ? ing.quantity_kg : '');
                        var sup = ing.supplier || ing.supplier_details || '';
                        parts.push('<tr><td>' + escapeHtml(String(desc)) + '</td><td>' + escapeHtml(String(sup || '—')) + '</td><td class="text-end">' + escapeHtml(String(qty)) + '</td></tr>');
                    });
                    parts.push('</tbody></table>');
                }
                parts.push('</div>');
            });
        }
        var audit = d.raw_ingredient_audit;
        if (audit && Array.isArray(audit) && audit.length) {
            parts.push('<h6 class="mt-2 mb-1 text-start">Raw ingredient audit</h6>');
            parts.push('<table class="table align-middle table-bordered text-start"><thead><tr><th>Batch</th><th>Supplier</th><th>Product / description</th><th class="text-end">Qty (kg)</th></tr></thead><tbody>');
            audit.forEach(function (row) {
                var bid = row.batch_id != null ? row.batch_id : '';
                var pt = row.product_type || row.description || '';
                var qk = row.quantity_kg != null ? row.quantity_kg : '';
                var sup = row.supplier || row.supplier_details || '';
                parts.push('<tr><td>' + escapeHtml(String(bid)) + '</td><td>' + escapeHtml(String(sup || '—')) + '</td><td>' + escapeHtml(String(pt)) + '</td><td class="text-end">' + escapeHtml(String(qk)) + '</td></tr>');
            });
            parts.push('</tbody></table>');
        }
        var hasDetail = (d.shifts_text && String(d.shifts_text).trim()) ||
            (segs && Array.isArray(segs) && segs.length) ||
            (audit && Array.isArray(audit) && audit.length);
        if ((d.has_oil_bin_batch || d.has_oil_row) && !hasDetail) {
            parts.push('<p class="mb-0 text-muted">No detailed ingredient lines were recorded for this batch.</p>');
        }
        return parts.join('');
    }

    /** Open the ingredients modal for an oil batch number. */
    function show(batchNumber) {
        var Swal = global.Swal;
        if (!batchNumber || typeof dataFunctions === 'undefined' || !dataFunctions.getOilBatchIngredientsDetail) {
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Ingredients lookup is not available.', 'error');
            return;
        }
        if (typeof Swal !== 'undefined') {
            Swal.fire({ title: 'Loading…', didOpen: function () { Swal.showLoading(); }, allowOutsideClick: false, showConfirmButton: false });
        }
        dataFunctions.getOilBatchIngredientsDetail(batchNumber, null).then(function (d) {
            if (typeof Swal !== 'undefined') Swal.close();
            if (d && d.success === false) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', d.error || 'Could not load ingredients', 'error');
                return;
            }
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Raw ingredients',
                    html: formatHtml(d),
                    width: '48rem',
                    confirmButtonText: 'OK',
                    customClass: { htmlContainer: 'text-start' }
                });
            }
        }).catch(function (e) {
            if (typeof Swal !== 'undefined') Swal.close();
            console.error('[OilBatchIngredients] load failed:', e);
            if (typeof Swal !== 'undefined') Swal.fire('Error', (e && e.message) ? e.message : 'Failed to load ingredients', 'error');
        });
    }

    global.OilBatchIngredients = {
        show: show,
        formatHtml: formatHtml,
        hasIngredients: hasIngredients,
        supplierNames: supplierNames
    };
}(window));
