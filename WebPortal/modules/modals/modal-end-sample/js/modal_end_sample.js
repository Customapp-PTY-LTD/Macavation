/**
 * Modal: End Sample (PACKING) – form and save. Logic from modules/kernel-production/js/kernel_production_end_sample.js
 */
var _modal_end_sample = (function () {
    'use strict';
    var labTestPdfUrl = '';       // stored URL after upload
    var _completedAt  = null;     // preserved from existing qa_data so re-saves don't reset the date

    // Positive release (migration 20261111090000): each lab test has an outcome Waiting / Passed / Failed.
    var LAB_TESTS = [
        { req: '#endSampleInternalMicroRequired', status: '#endSampleInternalMicroStatus', name: 'Internal Micro' },
        { req: '#endSampleExternalLabRequired',   status: '#endSampleExternalLabStatus',   name: 'External lab' }
    ];
    function todayIso() {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function anyLabWaiting() {
        return LAB_TESTS.some(function (x) { return $(x.req).prop('checked') && $(x.status).val() === 'waiting'; });
    }
    function refreshLabUi() {
        LAB_TESTS.forEach(function (x) { $(x.status).prop('disabled', !$(x.req).prop('checked')); });
        $('#saveEndSampleBtnText').text(anyLabWaiting() ? 'Save and send to lab' : 'Save');
    }

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
            // Ticking a lab test starts it at Waiting (and dates the External lab sample today); unticking clears it.
            LAB_TESTS.forEach(function (x) {
                $(x.req).off('change.lab').on('change.lab', function () {
                    if (this.checked) {
                        if (!$(x.status).val()) $(x.status).val('waiting');
                        if (x.status === '#endSampleExternalLabStatus' && !$('#endSampleLabSentOn').val()) $('#endSampleLabSentOn').val(todayIso());
                    } else {
                        $(x.status).val('');
                    }
                    refreshLabUi();
                });
                $(x.status).off('change.lab').on('change.lab', refreshLabUi);
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
            $('#endSampleInternalMicroStatus').val('');
            $('#endSampleExternalLabStatus').val('');
            $('#endSampleLabSentOn').val('');
            $('#endSampleLabInfo').empty();
            refreshLabUi();
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
                    var displayName = ((user.first_name || '') + ' ' + (user.last_name || '')).trim() || user.email || 'Unknown';
                    var value = user.email || '';
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
            $('#endSampleInternalMicroStatus').val(qa.internal_micro_required ? (qa.internal_micro_status || '') : '');
            $('#endSampleExternalLabStatus').val(qa.external_lab_required ? (qa.external_lab_status || '') : '');
            $('#endSampleLabSentOn').val(qa.lab_sent_on || '');
            var info = [];
            if (Number(qa.lab_attempt) >= 2) info.push('<span class="badge bg-warning text-dark">Retest</span> The first lab test failed; this is the retest.');
            if (qa.lab_decision === 'rejected') info.push('<span class="badge bg-danger">Rejected</span> ' + _common.escapeHtml(qa.lab_rejected_reason || ''));
            $('#endSampleLabInfo').html(info.join('<br>'));
            refreshLabUi();
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
            // Lab outcome checks (positive release).
            var imReq = $('#endSampleInternalMicroRequired').prop('checked');
            var exReq = $('#endSampleExternalLabRequired').prop('checked');
            var imStatus = imReq ? ($('#endSampleInternalMicroStatus').val() || '') : '';
            var exStatus = exReq ? ($('#endSampleExternalLabStatus').val() || '') : '';
            var sentOn = $('#endSampleLabSentOn').val() || '';
            var labErr = null;
            if (imReq && !imStatus) labErr = 'Choose the Internal Micro outcome: Waiting, Passed or Failed.';
            else if (exReq && !exStatus) labErr = 'Choose the External lab outcome: Waiting, Passed or Failed.';
            else if (exReq && !sentOn) labErr = 'Enter the date the sample was sent to the lab.';
            else if (sentOn && sentOn > todayIso()) labErr = 'The date sent to the lab cannot be in the future.';
            else if (exStatus === 'passed' && !labTestPdfUrl) labErr = 'Attach the lab test PDF before marking External lab as Passed.';
            if (labErr) {
                if (typeof Swal !== 'undefined') Swal.fire('Check the lab results', labErr, 'warning');
                return;
            }
            if (!sentOn && (imStatus === 'waiting')) sentOn = todayIso();
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
                internal_micro_status: imStatus || null,
                external_lab_status: exStatus || null,
                lab_sent_on: sentOn || null,
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
                var doneText = (imStatus === 'failed' || exStatus === 'failed')
                    ? 'End sample saved. The batch failed a lab test: choose what happens next on Production.'
                    : (imStatus === 'waiting' || exStatus === 'waiting')
                        ? 'End sample saved. The batch is now at the lab.'
                        : 'End sample saved. Batch is now release ready.';
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: doneText, timer: 2500, showConfirmButton: false });
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
