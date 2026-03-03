/**
 * Modal: End Sample (PACKING) – form and save. Logic from modules/kernel-production/js/kernel_production_end_sample.js
 */
var _modal_end_sample = (function () {
    'use strict';
    var labTestPdfUrl = '';       // stored URL after upload
    var _completedAt  = null;     // preserved from existing qa_data so re-saves don't reset the date

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

        show: async (batchId) => {
            const scope = _modal_end_sample;
            // Reset form
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
            scope.setSignedDropdowns([]);
            labTestPdfUrl = '';
            _completedAt  = null;
            $('#endSampleLabTestPdf').val('');
            $('#endSampleLabTestPdfPreview').empty();
            // Show modal immediately (fields populate async below)
            var modalEl = document.getElementById('endSampleModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#endSampleModal').modal('show');
            // Load users and populate Signed (Supervisor) / Signed (Nut Plant Manager) dropdowns
            if (typeof dataFunctions !== 'undefined' && dataFunctions.getUsers) {
                try {
                    var users = await dataFunctions.getUsers();
                    var list = (users && Array.isArray(users)) ? users : (users && users.get_users && Array.isArray(users.get_users)) ? users.get_users : [];
                    scope.setSignedDropdowns(list);
                } catch (e) {
                    console.error('[End Sample] Failed to load users:', e);
                }
            }
            // Pre-populate from saved qa_data
            if (batchId && typeof dataFunctions !== 'undefined' && dataFunctions.getKernelBatchDetail) {
                dataFunctions.getKernelBatchDetail(batchId).then(function (detail) {
                    var qa = (detail && detail.qa_data && Object.keys(detail.qa_data).length) ? detail.qa_data : null;
                    if (!qa) return;
                    scope.populateFromQaData(qa);
                }).catch(function (e) {
                    console.error('[End Sample] Failed to load existing data:', e);
                });
            }
        },

        setSignedDropdowns: (users) => {
            var supSelect = document.getElementById('endSampleSupervisorSigned');
            var npmSelect = document.getElementById('endSampleNutPlantManagerSigned');
            if (!supSelect || !npmSelect) return;
            var defaultSup = document.createElement('option');
            defaultSup.value = '';
            defaultSup.textContent = 'Select Supervisor';
            defaultSup.selected = true;
            supSelect.innerHTML = '';
            supSelect.appendChild(defaultSup);
            var defaultNpm = document.createElement('option');
            defaultNpm.value = '';
            defaultNpm.textContent = 'Select Nut Plant Manager';
            defaultNpm.selected = true;
            npmSelect.innerHTML = '';
            npmSelect.appendChild(defaultNpm);
            if (users && users.length) {
                users.forEach(function (user) {
                    var displayName = user.email || user.username || 'Unknown';
                    var value = user.email || user.username || '';
                    var optSup = document.createElement('option');
                    optSup.value = value;
                    optSup.textContent = displayName;
                    supSelect.appendChild(optSup);
                    var optNpm = document.createElement('option');
                    optNpm.value = value;
                    optNpm.textContent = displayName;
                    npmSelect.appendChild(optNpm);
                });
            }
            supSelect.value = '';
            npmSelect.value = '';
        },

        populateFromQaData: (qa) => {
            _completedAt = qa.completed_at || null;
            $('#endSampleMoistureRequired').prop('checked', !!qa.moisture_required);
            $('#endSampleMoistureResult').val(qa.moisture_result != null ? qa.moisture_result : '');
            $('#endSamplePeroxideRequired').prop('checked', !!qa.peroxide_required);
            $('#endSamplePeroxideResult').val(qa.peroxide_result != null ? qa.peroxide_result : '');
            $('#endSampleFfaRequired').prop('checked', !!qa.ffa_required);
            $('#endSampleFfaResult').val(qa.ffa_result != null ? qa.ffa_result : '');
            $('#endSampleInternalMicroRequired').prop('checked', !!qa.internal_micro_required);
            $('#endSampleInternalMicroResult').val(qa.internal_micro_result || '');
            $('#endSampleExternalLabRequired').prop('checked', !!qa.external_lab_required);
            $('#endSampleExternalLabResult').val(qa.external_lab_result || '');
            var supVal = (qa.supervisor_signed_by || '').trim();
            var npmVal = (qa.nut_plant_manager_signed_by || '').trim();
            var $sup = $('#endSampleSupervisorSigned');
            var $npm = $('#endSampleNutPlantManagerSigned');
            $sup.val(supVal);
            if (supVal && $sup.val() !== supVal) {
                $sup.find('option').each(function () {
                    if ($(this).text().trim() === supVal) { $(this).prop('selected', true); return false; }
                });
            }
            $npm.val(npmVal);
            if (npmVal && $npm.val() !== npmVal) {
                $npm.find('option').each(function () {
                    if ($(this).text().trim() === npmVal) { $(this).prop('selected', true); return false; }
                });
            }
            if (qa.lab_test_pdf_url) {
                labTestPdfUrl = qa.lab_test_pdf_url;
                var href = (typeof _common !== 'undefined' && _common.sanitizeHtml) ? _common.sanitizeHtml(labTestPdfUrl) : labTestPdfUrl;
                var fileName = labTestPdfUrl.split('/').pop() || 'Lab Test PDF';
                var safeFileName = (typeof _common !== 'undefined' && _common.sanitizeHtml) ? _common.sanitizeHtml(fileName) : fileName;
                var $previewEl = $('#endSampleLabTestPdfPreview');
                $previewEl.html(
                    '<a href="' + href + '" target="_blank" rel="noopener" class="text-primary">' +
                    '<i class="fas fa-file-pdf me-1"></i>' + safeFileName + '</a> ' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary ms-1" id="endSampleLabTestPdfRemove" title="Remove">' +
                    '<i class="fas fa-times"></i></button>'
                );
                $('#endSampleLabTestPdfRemove').on('click', function () {
                    labTestPdfUrl = '';
                    $('#endSampleLabTestPdf').val('');
                    $previewEl.empty();
                });
            }
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
            var kernelId = $('#endSampleProductionBatchId').val();
            if (!kernelId || !kernelId.trim()) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            var qaData = {
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
                nut_plant_manager_signed_by: $('#endSampleNutPlantManagerSigned').val() || null,
                completed_at: _completedAt || new Date().toISOString()
            };
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.upsertKernelQa !== 'function') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Save not available. Please refresh the page.', 'error');
                return;
            }
            dataFunctions.upsertKernelQa(kernelId, qaData).then((result) => {
                var inner = (result && result.upsert_kernel_qa) ? result.upsert_kernel_qa : result;
                if (inner && inner.success === false) throw new Error(inner.error || 'Save failed');
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'End sample saved. Batch is now release ready.', timer: 2000, showConfirmButton: false });
                var modalEl = document.getElementById('endSampleModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else $('#endSampleModal').modal('hide');
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
            }).catch((e) => {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save end sample', 'error');
            });
        }
    };
}());
_modal_end_sample.init();
