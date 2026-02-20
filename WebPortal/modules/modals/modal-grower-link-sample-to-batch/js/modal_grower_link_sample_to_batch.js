/**
 * Modal: New batch sample (Grower Intake).
 * Fill in receiving fields (Moisture, Peroxide Value, Free Fatty Acids), then save to create
 * sample submission and link it to the batch.
 * Uses container id: linkSampleToBatchModal
 */
var _modal_grower_link_sample_to_batch = (function () {
    'use strict';

    var CONTAINER_ID = 'linkSampleToBatchModal';
    var _batchId = null;

    function getFloat(id) {
        var el = document.getElementById(id);
        if (!el || !el.value || el.value.trim() === '') return null;
        var n = parseFloat(el.value);
        return isNaN(n) ? null : n;
    }

    function clearForm() {
        ['sampleMoistureRequired', 'samplePeroxideRequired', 'sampleFfaRequired'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.checked = false;
        });
        ['sampleMoistureResult', 'samplePeroxideResult', 'sampleFfaResult'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.value = '';
        });
    }

    var api = {
        init: function () {
            var btn = document.getElementById('linkSampleToBatchBtn');
            if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
        },

        show: function (batchId) {
            _batchId = batchId || null;
            if (!_batchId) return;
            clearForm();
            var modalEl = document.getElementById(CONTAINER_ID);
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#' + CONTAINER_ID).modal('show');
        },

        save: async function () {
            var batchId = _batchId;
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected.', 'error');
                return;
            }

            var moistureRequired = !!document.getElementById('sampleMoistureRequired')?.checked;
            var peroxideRequired = !!document.getElementById('samplePeroxideRequired')?.checked;
            var ffaRequired = !!document.getElementById('sampleFfaRequired')?.checked;
            var moistureResult = getFloat('sampleMoistureResult');
            var peroxideResult = getFloat('samplePeroxideResult');
            var ffaResult = getFloat('sampleFfaResult');

            if (moistureRequired && moistureResult == null) {
                if (typeof Swal !== 'undefined') Swal.fire('Please enter a result for Moisture.', '', 'info');
                return;
            }
            if (peroxideRequired && peroxideResult == null) {
                if (typeof Swal !== 'undefined') Swal.fire('Please enter a result for Peroxide Value.', '', 'info');
                return;
            }
            if (ffaRequired && ffaResult == null) {
                if (typeof Swal !== 'undefined') Swal.fire('Please enter a result for Free Fatty Acids.', '', 'info');
                return;
            }

            var payload = {
                p_batch_id: batchId,
                p_moisture_required: moistureRequired,
                p_moisture_result: moistureResult,
                p_peroxide_required: peroxideRequired,
                p_peroxide_result: peroxideResult,
                p_ffa_required: ffaRequired,
                p_ffa_result: ffaResult,
                p_wet_nut_in_shell_kg: 0
            };

            try {
                var result = await dataFunctions.createSampleSubmissionForBatch(payload);

                var ok = result && (result.success === true || (result.success !== false && result.id));
                if (!ok) {
                    throw new Error(result && result.error ? result.error : 'Failed to save sample');
                }

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
                    title: 'Saved',
                    text: 'Sample submission created and linked to batch.',
                    timer: 2000,
                    showConfirmButton: false
                });

                if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.loadIntakeBatches) {
                    _growerIntakeGrid.loadIntakeBatches(true);
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save sample', 'error');
            }
        }
    };
    return api;
})();
