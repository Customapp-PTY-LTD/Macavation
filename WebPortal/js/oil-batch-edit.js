/**
 * OilBatchEdit — shared "Edit batch details" dialog for oil batches.
 *
 * Oil counterpart to KernelBatchEdit (WebPortal/js/kernel-batch-edit.js), used by Find a batch.
 * Rows come from get_oil_batches, which already carries everything the dialog needs, so there is
 * no extra fetch.
 *
 * SCOPE — header details only, deliberately narrower than the row looks:
 *   batch number, production date, total oil (L).
 * Status is NOT editable here. It drives which module the Open button routes to
 * (WebPortal/js/batch-status.js) and which pipeline step owns the batch, so changing it from a
 * details dialog would move a batch between stages behind the workflow's back. The stage blobs
 * (intake/production/stock/dispatch) belong to their own modules for the same reason.
 *
 * Unlike the kernel dialog, an empty optional field means LEAVE UNCHANGED rather than clear —
 * that matches the COALESCE convention every other write to public.oil already uses
 * (upsert_oil_batch), and update_oil_batch_header follows it.
 */
(function (global) {
    'use strict';

    function escapeHtml(s) {
        if (s == null) return '';
        if (typeof _common !== 'undefined' && _common.escapeHtml) return _common.escapeHtml(s);
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** Oil row id for RPCs (proxy casing varies, same tolerance as KernelBatchEdit). */
    function oilIdFromBatch(b) {
        if (!b) return '';
        if (b.id != null && b.id !== '') return String(b.id);
        if (b.Id != null && b.Id !== '') return String(b.Id);
        if (b.oil_id != null && b.oil_id !== '') return String(b.oil_id);
        return '';
    }

    /** get_oil_batches returns batch_id; some callers/proxies surface it as batch_number. */
    function batchNumberFromBatch(b) {
        if (!b) return '';
        if (b.batch_number != null && b.batch_number !== '') return String(b.batch_number);
        if (b.batch_id != null && b.batch_id !== '') return String(b.batch_id);
        return '';
    }

    function isoDateOnlyForInput(v) {
        if (v == null || v === '') return '';
        var s = String(v).trim();
        if (s.indexOf('T') !== -1) return s.split('T')[0];
        if (s.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        return s;
    }

    function numberForInput(v) {
        if (v == null || v === '') return '';
        var n = typeof v === 'number' ? v : parseFloat(v);
        return isNaN(n) ? '' : String(n);
    }

    function valueOf(id) {
        var node = document.getElementById(id);
        return node && node.value != null ? node.value : '';
    }

    function dialogHtml(batch) {
        return '<div class="text-start">' +
            '<label class="form-label">Batch number <span class="text-danger">*</span></label>' +
            '<input id="swalOBatchBn" class="form-control mb-2" value="' + escapeHtml(batchNumberFromBatch(batch)) + '" autocomplete="off">' +
            '<label class="form-label">Production date</label>' +
            '<input id="swalOBatchPd" type="date" class="form-control mb-2" value="' + escapeHtml(isoDateOnlyForInput(batch.production_date)) + '">' +
            '<label class="form-label">Total oil (L)</label>' +
            '<input id="swalOBatchLitre" type="number" step="0.01" min="0" class="form-control mb-2" value="' + escapeHtml(numberForInput(batch.total_oil_litre)) + '">' +
            '<p class="small text-muted mt-2 mb-0">Leaving a field empty keeps its current value. Status and the recorded production, stock and dispatch details are changed in their own modules.</p>' +
            '</div>';
    }

    function readForm() {
        var Swal = global.Swal;
        var batchNumber = valueOf('swalOBatchBn').trim();
        if (!batchNumber) {
            Swal.showValidationMessage('Batch number is required');
            return false;
        }
        var litreRaw = valueOf('swalOBatchLitre').trim();
        var litre = litreRaw === '' ? null : parseFloat(litreRaw);
        if (litreRaw !== '' && (!isFinite(litre) || litre < 0)) {
            Swal.showValidationMessage('Total oil (L) must be a valid non-negative number');
            return false;
        }
        var productionDate = valueOf('swalOBatchPd').trim();
        return {
            batch_id: batchNumber,
            production_date: productionDate === '' ? null : productionDate,
            total_oil_litre: litre
        };
    }

    /**
     * Open the edit dialog for an oil batch.
     * @param {object} batch - row from get_oil_batches (id = oil.id)
     * @param {object} [options] - { onSaved: function }
     */
    function prompt(batch, options) {
        var Swal = global.Swal;
        var opts = options || {};
        if (typeof Swal === 'undefined') return;
        var oilId = oilIdFromBatch(batch);
        if (!batch || !oilId) {
            Swal.fire('Error', 'Batch not found. Refresh and try again.', 'error');
            return;
        }
        var df = (typeof dataFunctions !== 'undefined' && dataFunctions) ? dataFunctions : null;
        if (!df || !df.updateOilBatchHeader) {
            Swal.fire('Error', 'Save is not available. Apply the latest database migration and refresh.', 'error');
            return;
        }

        Swal.fire({
            title: 'Edit batch details',
            width: 520,
            showCancelButton: true,
            confirmButtonText: 'Save',
            focusConfirm: false,
            html: dialogHtml(batch),
            preConfirm: readForm
        }).then(function (res) {
            if (!res || !res.isConfirmed || !res.value) return;
            return df.updateOilBatchHeader(oilId, res.value).then(function (result) {
                if (result && result.success === false) throw new Error(result.error || 'Save failed');
                Swal.fire({ icon: 'success', title: 'Saved', timer: 1600, showConfirmButton: false });
                if (typeof opts.onSaved === 'function') opts.onSaved(result);
            });
        }).catch(function (e) {
            console.error('[OilBatchEdit] save failed:', e);
            Swal.fire('Error', e.message || 'Failed to save', 'error');
        });
    }

    global.OilBatchEdit = { prompt: prompt };
}(window));
