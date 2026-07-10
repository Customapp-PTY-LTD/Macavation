/**
 * Kernel Production Batch Actions Module
 * Grid-only: release to stock, new batch modal + save. No modal controllers – batch history routes to _modal_batch_history.show() from grid.
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

        jobCardHasStockQuantities: (jobCardData) => {
            if (typeof _kernelJobCardStock !== 'undefined' && _kernelJobCardStock.hasStockQuantities) {
                return _kernelJobCardStock.hasStockQuantities(jobCardData);
            }
            if (!jobCardData || typeof jobCardData !== 'object') return false;
            function parseStyles(val) {
                if (!val) return [];
                if (Array.isArray(val)) return val;
                if (typeof val === 'string') {
                    try { return JSON.parse(val); } catch (e) { return []; }
                }
                return [];
            }
            function hasQty(rows) {
                return rows.some(function (row) {
                    if (!row) return false;
                    var c = parseInt(row.cartons, 10) || 0;
                    var kg = parseFloat(row.weight_kg) || 0;
                    return c > 0 || kg > 0;
                });
            }
            return hasQty(parseStyles(jobCardData.sound_kernel_styles)) ||
                hasQty(parseStyles(jobCardData.butter_grade_styles));
        },

        releaseBatchToStock: (batchId) => {
            if (!batchId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.completeKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Release function not available. Please refresh.', 'error');
                return;
            }
            var batch = (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch) ? _kernelProductionGrid.getBatch(batchId) : null;
            var batchLabel = batch ? (batch.batch_number || 'this batch') : 'this batch';
            var scope = _kernelProductionBatchActions;

            function confirmAndRelease() {
                Swal.fire({
                    title: 'Release to stock?',
                    html: 'Release <strong>' + batchLabel + '</strong> to kernel stock?<br><small class="text-muted">Stock on hand will match the saved job card style quantities.</small>',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Release to stock',
                    cancelButtonText: 'Cancel',
                    confirmButtonColor: '#198754'
                }).then((res) => {
                    if (!res.isConfirmed) return;
                    dataFunctions.completeKernelBatch(batchId).then((result) => {
                        var inner = result;
                        if (typeof dataFunctions.unwrapKernelRpcJson === 'function') {
                            inner = dataFunctions.unwrapKernelRpcJson(result, 'complete_kernel_batch') || result;
                        } else if (result && result.complete_kernel_batch) {
                            inner = result.complete_kernel_batch;
                        }
                        if (inner && inner.success === false) throw new Error(inner.error || inner.Error || 'Update failed');
                        if (typeof HandoffDialog !== 'undefined' && HandoffDialog.showKernelReleaseToStock) {
                            HandoffDialog.showKernelReleaseToStock(batch || { batch_number: batchLabel });
                        } else if (typeof Swal !== 'undefined') {
                            Swal.fire({ icon: 'success', title: 'Released to stock', text: batchLabel + ' is now in kernel stock.', timer: 2000, showConfirmButton: false });
                        }
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadKernelBatches) {
                        _stockManagementGrid.loadKernelBatches(true);
                    }
                    }).catch((e) => {
                        console.error(e);
                        Swal.fire('Error', e.message || 'Failed to release to stock', 'error');
                    });
                });
            }

            var detailPromise = (dataFunctions.getKernelBatchDetail && batchId)
                ? dataFunctions.getKernelBatchDetail(batchId)
                : Promise.resolve(null);
            detailPromise.then(function (detail) {
                var approved = (typeof _dataFunctions !== 'undefined' && _dataFunctions.isKernelJobcardApproved)
                    ? (_dataFunctions.isKernelJobcardApproved(detail) || _dataFunctions.isKernelJobcardApproved(batch))
                    : ((detail && detail.jobcard_approved === true) ||
                        (batch && batch.has_jobcard_approved === true));
                if (!approved) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Job card not approved',
                        text: 'Open the job card, review style quantities, and press Jobcard approved before releasing to stock.'
                    });
                    return;
                }
                var jc = detail && detail.job_card_data ? detail.job_card_data : null;
                if (!scope.jobCardHasStockQuantities(jc)) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Job card quantities required',
                        text: 'Enter at least one style line (cartons or kg) on the job card and press Jobcard approved before releasing to stock.'
                    });
                    return;
                }
                confirmAndRelease();
            }).catch(function () {
                Swal.fire({
                    icon: 'warning',
                    title: 'Could not verify job card',
                    text: 'Reload the batch and ensure the job card is approved before releasing to stock.'
                });
            });
        },

        archiveBatch: (batchId) => {
            if (!batchId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.deactivateKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Archive is not available. Please refresh.', 'error');
                return;
            }
            var batch = (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch) ? _kernelProductionGrid.getBatch(batchId) : null;
            var batchLabel = batch ? (batch.batch_number || 'this batch') : 'this batch';
            Swal.fire({
                title: 'Archive kernel batch?',
                html: 'Send <strong>' + batchLabel + '</strong> to the archive? It will be removed from production lists. Restore later from Stock → <strong>View archive</strong>.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#6c757d',
                confirmButtonText: 'Yes, archive',
                cancelButtonText: 'Cancel'
            }).then((res) => {
                if (!res.isConfirmed) return;
                dataFunctions.deactivateKernelBatch(batchId).then((result) => {
                    var inner = (result && result.deactivate_kernel_batch) ? result.deactivate_kernel_batch : result;
                    if (inner && inner.success === false) throw new Error(inner.error || 'Archive failed');
                    Swal.fire({ icon: 'success', title: 'Batch archived', text: batchLabel + ' has been sent to the archive.', timer: 2200, showConfirmButton: false });
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                }).catch((e) => {
                    console.error(e);
                    Swal.fire('Error', e.message || 'Failed to archive batch', 'error');
                });
            });
        },

        deleteBatch: (batchId) => {
            _kernelProductionBatchActions.archiveBatch(batchId);
        },

        /** Prefill batch number from DB; uses received date year (matches create_kernel_batch). */
        refreshSuggestedBatchNumber: () => {
            var supplierId = $('#batchSupplier').val() || null;
            var dateStr = $('#batchReceivedDate').val();
            var year = dateStr && dateStr.length >= 4 ? parseInt(dateStr.slice(0, 4), 10) : new Date().getFullYear();
            if (!supplierId) {
                $('#batchNumber').val('').attr('placeholder', 'Select supplier to see suggestion');
                return;
            }
            (dataFunctions.getNextBatchNumber && dataFunctions.getNextBatchNumber(supplierId, year) || Promise.resolve(null))
                .then(function (nextId) {
                    $('#batchNumber').val(nextId || '').attr('placeholder', nextId ? '' : 'Will assign on save');
                })
                .catch(function () { $('#batchNumber').val('').attr('placeholder', 'Will assign on save'); });
        },

        showNewBatchModal: () => {
            const scope = _kernelProductionBatchActions;
            $('#newBatchModalLabel').text('New Production Batch');
            $('#batchId').val('');
            scope.clearNewBatchForm();
            $('#batchReceivedDate').val(new Date().toISOString().split('T')[0]);
            $('#batchNumber').val('').attr('placeholder', 'Select supplier to see suggestion');
            $('#batchSupplier').off('change.kernelNextBatch').on('change.kernelNextBatch', function () {
                scope.refreshSuggestedBatchNumber();
            });
            $('#batchReceivedDate').off('change.kernelNextBatchDate').on('change.kernelNextBatchDate', function () {
                scope.refreshSuggestedBatchNumber();
            });
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
            if (typeof dataFunctions === 'undefined' || !dataFunctions.createKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create batch function not available. Please refresh.', 'error');
                return;
            }
            var getVal = (id) => $('#' + id).val() || null;
            var getFloat = (id) => { var v = $('#' + id).val(); return v ? parseFloat(v) : null; };
            var batchNumRaw = $('#batchNumber').val();
            var batchNumTrim = batchNumRaw != null ? String(batchNumRaw).trim() : '';
            var batchData = {
                batch_number:        batchNumTrim.length ? batchNumTrim : null,
                received_date:       getVal('batchReceivedDate'),
                wet_nis_received_kg: getFloat('batchWetNIS'),
                supplier_id:         getVal('batchSupplier') || null,
                grower_name:         getVal('batchGrowerName') || null
            };
            dataFunctions.createKernelBatch(batchData).then((result) => {
                var inner = (result && result.create_kernel_batch) ? result.create_kernel_batch : result;
                if (inner && inner.success === false) throw new Error(inner.error || 'Failed to create batch');
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: 'Production batch created successfully', timer: 2000, showConfirmButton: false });
                var modalEl = document.getElementById('newBatchModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else $('#newBatchModal').modal('hide');
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
            }).catch((e) => {
                console.error('[Kernel Production] saveNewBatch failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to create batch', 'error');
            });
        }
    };
}();
