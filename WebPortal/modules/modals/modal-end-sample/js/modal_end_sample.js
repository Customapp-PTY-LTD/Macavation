/**
 * Modal: End Sample (PACKING) – form and save. Logic from modules/kernel-production/js/kernel_production_end_sample.js
 */
var _modal_end_sample = (function () {
    'use strict';
    var labTestPdfUrl = ''; // stored URL after upload

    return {
        init: () => {
            const scope = _modal_end_sample;
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_end_sample;
            $('#saveEndSampleBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.saveEndSample();
            });
            $('#endSampleLabTestPdf').off('change').on('change', function (e) {
                scope.handleLabTestPdfSelect(e);
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
            labTestPdfUrl = '';
            $('#endSampleLabTestPdf').val('');
            $('#endSampleLabTestPdfPreview').empty();
            var modalEl = document.getElementById('endSampleModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#endSampleModal').modal('show');
        },

        handleLabTestPdfSelect: async function (e) {
            const scope = _modal_end_sample;
            const file = e.target && e.target.files && e.target.files[0];
            const previewEl = $('#endSampleLabTestPdfPreview');
            const maxSize = 10 * 1024 * 1024; // 10 MB

            if (!file) {
                previewEl.empty();
                labTestPdfUrl = '';
                return;
            }
            if (file.size > maxSize) {
                if (typeof _common !== 'undefined' && _common.showErrorToast) _common.showErrorToast('File too large. Max 10MB.');
                else if (typeof Swal !== 'undefined') Swal.fire('Error', 'File too large. Max 10MB.', 'error');
                e.target.value = '';
                previewEl.empty();
                return;
            }
            if (file.type !== 'application/pdf') {
                if (typeof _common !== 'undefined' && _common.showErrorToast) _common.showErrorToast('Please select a PDF file.');
                else if (typeof Swal !== 'undefined') Swal.fire('Error', 'Please select a PDF file.', 'error');
                e.target.value = '';
                previewEl.empty();
                return;
            }

            previewEl.html('<span class="text-muted"><i class="fas fa-spinner fa-spin me-1"></i>Uploading...</span>');
            try {
                const result = typeof _common !== 'undefined' && _common.uploadFile
                    ? await _common.uploadFile({ file: file, resourceFolder: 'EFS Assist/PreInspections/', fileId: file.name })
                    : { Success: false, LastErrorDescription: 'Upload not available' };
                if (result && result.Success && result.Data && result.Data.fileLink) {
                    labTestPdfUrl = result.Data.fileLink;
                    previewEl.html(
                        '<a href="' + _common.sanitizeHtml(labTestPdfUrl) + '" target="_blank" rel="noopener" class="text-primary">' +
                        '<i class="fas fa-file-pdf me-1"></i>' + _common.sanitizeHtml(file.name) + '</a> ' +
                        '<button type="button" class="btn btn-sm btn-outline-secondary ms-1" id="endSampleLabTestPdfRemove" title="Remove">' +
                        '<i class="fas fa-times"></i></button>'
                    );
                    $('#endSampleLabTestPdfRemove').on('click', function () {
                        labTestPdfUrl = '';
                        $('#endSampleLabTestPdf').val('');
                        previewEl.empty();
                    });
                    if (typeof _common !== 'undefined' && _common.showSuccessToast) _common.showSuccessToast('Lab test PDF uploaded.');
                } else {
                    throw new Error(result && result.LastErrorDescription ? result.LastErrorDescription : 'Upload failed');
                }
            } catch (err) {
                console.error(err);
                if (typeof _common !== 'undefined' && _common.showErrorToast) _common.showErrorToast('Error uploading PDF: ' + (err.message || 'Upload failed'));
                else if (typeof Swal !== 'undefined') Swal.fire('Error', err.message || 'Error uploading PDF', 'error');
                previewEl.empty();
                e.target.value = '';
                labTestPdfUrl = '';
            }
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
                lab_test_pdf_url: labTestPdfUrl || null,
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
}());
_modal_end_sample.init();
