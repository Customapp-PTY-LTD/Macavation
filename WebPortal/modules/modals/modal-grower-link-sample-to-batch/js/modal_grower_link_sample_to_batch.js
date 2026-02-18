/**
 * Modal: Link sample to batch (Grower Intake).
 * Parent calls show(batchId); modal owns init, show, save.
 * Uses container id: linkSampleToBatchModal
 */
var _modal_grower_link_sample_to_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'linkSampleToBatchModal';
    var _batchId = null;

    var api = {
        init: function () {
            var btn = document.getElementById('linkSampleToBatchBtn');
            if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
        },

        show: async function (batchId) {
            _batchId = batchId || null;
            if (!_batchId) return;

            var sel = document.getElementById('linkSampleToBatchSelect');
            if (!sel) return;

            sel.innerHTML = '<option value="">Select a sample to link…</option>';

            try {
                var samples = typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.samples && _growerIntakeGrid.samples.length
                    ? _growerIntakeGrid.samples
                    : (typeof dataFunctions !== 'undefined' && dataFunctions.getSampleSubmissions)
                        ? await dataFunctions.getSampleSubmissions(null, true)
                        : [];

                (samples || []).forEach(function (s) {
                    var opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = (s.submission_number || s.id) + ' – ' + (s.grower_name || '');
                    sel.appendChild(opt);
                });
            } catch (e) {
                console.error(e);
            }

            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        save: async function () {
            var batchId = _batchId;
            var sel = document.getElementById('linkSampleToBatchSelect');
            var sampleId = sel && sel.value ? sel.value : null;

            if (!batchId || !sampleId) {
                if (typeof Swal !== 'undefined') Swal.fire('Please select a sample to link to this batch.', '', 'info');
                return;
            }

            try {
                var result = await dataFunctions.updateProductionBatch(batchId, { sample_submission_id: sampleId });

                if (result && result.success !== false) {
                    var modalEl = document.getElementById(CONTAINER_ID);
                    if (modalEl && typeof bootstrap !== 'undefined') {
                        var inst = bootstrap.Modal.getInstance(modalEl);
                        if (inst) inst.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#' + CONTAINER_ID).modal('hide');
                    }

                    _batchId = null;

                    if (typeof Swal !== 'undefined') Swal.fire({
                        icon: 'success',
                        title: 'Linked',
                        text: 'Sample linked to batch.',
                        timer: 2000,
                        showConfirmButton: false
                    });

                    if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.loadIntakeBatches) {
                        _growerIntakeGrid.loadIntakeBatches(true);
                    }
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to link sample', 'error');
            }
        }
    };
    return api;
})();
