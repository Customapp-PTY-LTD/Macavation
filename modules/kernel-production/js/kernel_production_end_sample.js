/**
 * Kernel Production End Sample Module
 * End sample modal: form and view. Triggered by End sample button on grid.
 * Pattern: same as hatchability.js (return object, arrow functions, const scope = _module).
 */
var _kernelProductionEndSample = function () {
    'use strict';
    return {
        init: () => {
            const scope = _kernelProductionEndSample;
            $('#saveEndSampleBtn').off('click').on('click', (e) => {
                e.preventDefault();
                scope.saveEndSample();
            });
        },

        showEndSampleModal: (batchId) => {
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
            (dataFunctions.createKernelPackingSample && dataFunctions.createKernelPackingSample(data)).then((result) => {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'End sample saved.', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('endSampleModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else $('#endSampleModal').modal('hide');
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Save failed');
                }
            }).catch((e) => {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save end sample', 'error');
            });
        },

        showEndSampleViewModal: (packingSampleId) => {
            var $body = $('#endSampleViewBody');
            if (!$body.length) return;
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('endSampleViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#endSampleViewModal').modal('show');
            (dataFunctions.getKernelPackingSample && dataFunctions.getKernelPackingSample(packingSampleId)).then((ps) => {
                if (!ps || !ps.id) {
                    $body.html('<p class="text-muted mb-0">End sample not found.</p>');
                    return;
                }
                var fmt = (v) => v != null && v !== '' ? v : '—';
                var tick = (b) => b ? '&#10003;' : '—';
                var html = '<p class="text-muted small mb-3">1 x kernel sample – ziplock bag, 1 x sterile bag, 1 x 1kg vacuum bag</p>';
                html += '<table class="table table-bordered table-sm"><thead><tr><th>Description</th><th>Required (tick)</th><th>Result</th><th>UOM</th></tr></thead><tbody>';
                html += '<tr><td>Moisture</td><td>' + tick(ps.moisture_required) + '</td><td>' + fmt(ps.moisture_result) + '</td><td>%</td></tr>';
                html += '<tr><td>Peroxide Value</td><td>' + tick(ps.peroxide_required) + '</td><td>' + fmt(ps.peroxide_result) + '</td><td>meqO2/kg</td></tr>';
                html += '<tr><td>Free Fatty Acids</td><td>' + tick(ps.ffa_required) + '</td><td>' + fmt(ps.ffa_result) + '</td><td>%</td></tr>';
                html += '<tr><td>Internal Micro</td><td>' + tick(ps.internal_micro_required) + '</td><td>' + fmt(ps.internal_micro_result) + '</td><td></td></tr>';
                html += '<tr><td>External lab testing</td><td>' + tick(ps.external_lab_required) + '</td><td>' + fmt(ps.external_lab_result) + '</td><td></td></tr>';
                html += '</tbody></table>';
                html += '<div class="row mt-3"><div class="col-md-6"><p class="mb-0"><strong>Signed (Supervisor):</strong> ' + fmt(ps.supervisor_signed_by) + '</p></div>';
                html += '<div class="col-md-6"><p class="mb-0"><strong>Signed (Nut Plant Manager):</strong> ' + fmt(ps.nut_plant_manager_signed_by) + '</p></div></div>';
                $body.html(html);
            }).catch(() => {
                $body.html('<p class="text-danger mb-0">Could not load end sample.</p>');
            });
        }
    };
}();
