/**
 * Kernel Production Batch Actions Module
 * Release to stock, batch history modal, new batch modal and save.
 * Pattern: same as hatchability.js (return object, arrow functions, const scope = _module).
 */
var _kernelProductionBatchActions = function () {
    'use strict';
    return {
        init: () => {
            const scope = _kernelProductionBatchActions;
            $(document).off('click.kernelNewBatch', '#saveNewBatchBtn').on('click.kernelNewBatch', '#saveNewBatchBtn', (e) => {
                e.preventDefault();
                scope.saveNewBatch();
            });
        },

        releaseBatchToStock: (batchId) => {
            if (!batchId) return;
            (dataFunctions.updateProductionBatch && dataFunctions.updateProductionBatch(batchId, { status: 'in_finished_stock', stage: 'finished_stock' })).then((result) => {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released', text: 'Batch is now in Kernel Stock.', timer: 2000, showConfirmButton: false });
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            }).catch((e) => {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release to stock', 'error');
            });
        },

        showBatchHistory: (batchId) => {
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
        },

        showNewBatchModal: () => {
            const scope = _kernelProductionBatchActions;
            $('#newBatchModalLabel').text('New Production Batch');
            $('#batchId').val('');
            scope.clearNewBatchForm();
            $('#batchReceivedDate').val(new Date().toISOString().split('T')[0]);
            var p = dataFunctions.getContacts && dataFunctions.getContacts();
            (p || Promise.resolve([])).then((contacts) => {
                var html = '<option value="">Select Supplier</option>';
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach((contact) => {
                        var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        html += '<option value="' + contact.id + '">' + name + '</option>';
                    });
                }
                $('#batchSupplier').html(html);
            }).then(() => {
                var y = new Date().getFullYear();
                var m = String(new Date().getMonth() + 1).padStart(2, '0');
                $('#batchNumber').val('BATCH-' + y + '-' + m + '-001');
                var modalEl = document.getElementById('newBatchModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
                else $('#newBatchModal').modal('show');
            });
        },

        clearNewBatchForm: () => {
            var form = document.getElementById('newBatchForm');
            if (form) form.reset();
            $('#batchId').val('');
        },

        saveNewBatch: () => {
            var form = document.getElementById('newBatchForm');
            if (!form || !form.checkValidity()) {
                if (form) form.reportValidity();
                return;
            }
            var getVal = (id) => $('#' + id).val() || null;
            var getFloat = (id) => { var v = $('#' + id).val(); return v ? parseFloat(v) : null; };
            var batchData = {
                p_batch_number: getVal('batchNumber'),
                p_received_date: getVal('batchReceivedDate'),
                p_wet_nis_received_kg: getFloat('batchWetNIS'),
                p_supplier_id: getVal('batchSupplier') || null,
                p_grower_name: getVal('batchGrowerName') || null,
                p_receiving_moisture_percentage: getFloat('batchReceivingMoisture') || null,
                p_start_date: getVal('batchStartDate') || null,
                p_estimated_completion_date: getVal('batchEstimatedCompletion') || null,
                p_batch_type: 'kernel',
                p_status: 'receiving',
                p_current_step: 1
            };
            (dataFunctions.createProductionBatch && dataFunctions.createProductionBatch(batchData)).then((result) => {
                if (result && result.success !== false) {
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) dataFunctions.clearCachePattern('production_batches');
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: 'Production batch created successfully', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('newBatchModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else $('#newBatchModal').modal('hide');
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Failed to create batch');
                }
            }).catch((e) => {
                console.error('[Kernel Production] saveNewBatch failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to create batch', 'error');
            });
        }
    };
}();
