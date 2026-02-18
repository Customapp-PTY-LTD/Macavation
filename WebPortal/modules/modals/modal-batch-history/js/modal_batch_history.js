/**
 * Modal: Batch History (Grower Intake). Logic from modules/kernel-production/js/kernel_production_batch_actions.js
 */
var _modal_batch_history = function () {
    'use strict';
    return {
        show: (batchId) => {
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            var checklistId = batch.receiving_checklist_id || batch.receivingChecklistId;
            var sampleId = batch.sample_submission_id || batch.sampleSubmissionId;
            var batchInfo = (batch.batch_number || 'Batch') + (batch.grower_name ? ' — ' + batch.grower_name : '');
            $('#batchHistoryModalLabel').text('Grower Intake history');
            $('#batchHistoryBatchInfo').text('Batch: ' + batchInfo);
            $('#batchHistoryChecklistBody').html('<p class="text-muted mb-0">Loading…</p>');
            $('#batchHistorySampleBody').html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('batchHistoryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#batchHistoryModal').modal('show');
            if (checklistId && dataFunctions.getReceivingChecklist) {
                dataFunctions.getReceivingChecklist(checklistId).then((raw) => {
                    var payload = (raw && (raw.checklist || raw.received_items !== undefined)) ? raw : (raw && raw.data) ? raw.data : raw;
                    if (payload && payload.checklist) {
                        var c = payload.checklist;
                        var items = payload.received_items || [];
                        var html = '<div class="small"><p class="mb-1"><strong>Date received:</strong> ' + (c.date_received || '—') + '</p><p class="mb-1"><strong>Delivery note ref:</strong> ' + (c.delivery_note_ref || '—') + '</p><p class="mb-1"><strong>Vehicle clean:</strong> ' + (c.vehicle_clean || '—') + ' &nbsp; <strong>Enclosed:</strong> ' + (c.vehicle_enclosed || '—') + '</p><p class="mb-1"><strong>Pallets condition:</strong> ' + (c.pallets_condition || '—') + '</p>';
                        if (c.comments) html += '<p class="mb-2"><strong>Comments:</strong> ' + (c.comments || '—') + '</p>';
                        if (items.length > 0) {
                            html += '<table class="table table-sm table-bordered mt-2"><thead><tr><th>Reference</th><th>Description</th><th>Batch</th><th>Qty (kg)</th><th>Best before</th></tr></thead><tbody>';
                            items.forEach((it) => {
                                html += '<tr><td>' + (it.reference || '—') + '</td><td>' + (it.description || '—') + '</td><td>' + (it.batch || '—') + '</td><td>' + (it.quantity_kg != null ? it.quantity_kg : '—') + '</td><td>' + (it.best_before_date || '—') + '</td></tr>';
                            });
                            html += '</tbody></table>';
                        }
                        html += '</div>';
                        $('#batchHistoryChecklistBody').html(html);
                    } else {
                        $('#batchHistoryChecklistBody').html('<p class="text-muted mb-0">No checklist data available.</p>');
                    }
                }).catch(() => {
                    $('#batchHistoryChecklistBody').html('<p class="text-danger mb-0">Could not load checklist.</p>');
                });
            } else {
                $('#batchHistoryChecklistBody').html('<p class="text-muted mb-0">No receiving checklist linked to this batch.</p>');
            }
            if (sampleId && dataFunctions.getSampleSubmissions) {
                dataFunctions.getSampleSubmissions(null, true).then((samples) => {
                    var sample = (samples || []).filter((s) => s.id === sampleId)[0];
                    if (sample) {
                        var html = '<div class="small"><p class="mb-1"><strong>Submission:</strong> ' + (sample.submission_number || '—') + '</p><p class="mb-1"><strong>Grower:</strong> ' + (sample.grower_name || '—') + '</p><p class="mb-1"><strong>Delivery date:</strong> ' + (sample.delivery_date || '—') + '</p><p class="mb-1"><strong>Wet NIS (kg):</strong> ' + (sample.wet_nut_in_shell_kg != null ? sample.wet_nut_in_shell_kg : '—') + '</p><p class="mb-1"><strong>Moisture %:</strong> ' + (sample.moisture_content_percentage != null ? sample.moisture_content_percentage : '—') + '</p><p class="mb-0"><strong>Status:</strong> ' + (sample.status || '—') + '</p></div>';
                        $('#batchHistorySampleBody').html(html);
                    } else {
                        $('#batchHistorySampleBody').html('<p class="text-muted mb-0">Sample not found.</p>');
                    }
                }).catch(() => {
                    $('#batchHistorySampleBody').html('<p class="text-danger mb-0">Could not load sample.</p>');
                });
            } else {
                $('#batchHistorySampleBody').html('<p class="text-muted mb-0">No sample linked to this batch.</p>');
            }
        }
    };
}();
