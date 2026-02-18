/**
 * Modal: End Sample (PACKING) – form and save. Logic from modules/kernel-production/js/kernel_production_end_sample.js
 */
var _modal_end_sample = function () {
    'use strict';
    return {
        init: () => {
            const scope = _modal_end_sample;
            $('#saveEndSampleBtn').off('click').on('click', (e) => {
                e.preventDefault();
                scope.saveEndSample();
            });
        },

        show: (batchId) => {
            $('#endSampleProductionBatchId').val(batchId || '');
            $('#endSampleMoistureRequired').prop('checked', false);
            $('#endSampleMoistureResult').val('');
            $('#endSamplePeroxideRequired').prop('checked', false);
            $('#endSamplePeroxideResult').val('');
            $('#endSampleFfaRequired').prop('checked', false);
            $('#endSampleFfaResult').val('');
            $('#endSampleInternalMicroRequired').prop('checked', false);
            $('#endSampleInternalMicroResult').val('');
            $('#endSampleExternalLabRequired').prop('checked', false);
            $('#endSampleExternalLabResult').val('');
            $('#endSampleSupervisorSigned').val('');
            $('#endSampleNutPlantManagerSigned').val('');
            var modalEl = document.getElementById('endSampleModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#endSampleModal').modal('show');
        },

        saveEndSample: () => {
            var batchId = $('#endSampleProductionBatchId').val();
            if (!batchId || !batchId.trim()) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            var data = {
                production_batch_id: batchId,
                moisture_required: $('#endSampleMoistureRequired').prop('checked'),
                moisture_result: $('#endSampleMoistureResult').val() ? parseFloat($('#endSampleMoistureResult').val()) : null,
                peroxide_required: $('#endSamplePeroxideRequired').prop('checked'),
                peroxide_result: $('#endSamplePeroxideResult').val() ? parseFloat($('#endSamplePeroxideResult').val()) : null,
                ffa_required: $('#endSampleFfaRequired').prop('checked'),
                ffa_result: $('#endSampleFfaResult').val() ? parseFloat($('#endSampleFfaResult').val()) : null,
                internal_micro_required: $('#endSampleInternalMicroRequired').prop('checked'),
                internal_micro_result: $('#endSampleInternalMicroResult').val() || null,
                external_lab_required: $('#endSampleExternalLabRequired').prop('checked'),
                external_lab_result: $('#endSampleExternalLabResult').val() || null,
                supervisor_signed_by: $('#endSampleSupervisorSigned').val() || null,
                nut_plant_manager_signed_by: $('#endSampleNutPlantManagerSigned').val() || null
            };
            var createPromise = (typeof dataFunctions !== 'undefined' && dataFunctions.createKernelPackingSample)
                ? dataFunctions.createKernelPackingSample(data)
                : Promise.reject(new Error('Save not available: dataFunctions.createKernelPackingSample is missing'));
            createPromise.then((result) => {
                if (result && result.success !== false) {
                    var updatePromise = (typeof dataFunctions !== 'undefined' && dataFunctions.updateProductionBatch)
                        ? dataFunctions.updateProductionBatch(batchId, { status: 'release_ready' })
                        : Promise.resolve();
                    updatePromise.then(() => {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'End sample saved. Batch is now release ready.', timer: 2000, showConfirmButton: false });
                        var modalEl = document.getElementById('endSampleModal');
                        if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                        else $('#endSampleModal').modal('hide');
                        if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                    });
                } else {
                    throw new Error(result && result.error ? result.error : 'Save failed');
                }
            }).catch((e) => {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save end sample', 'error');
            });
        }
    };
}();
