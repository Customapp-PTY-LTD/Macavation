/**
 * Kernel Production Grid Module
 * Loads batch table and wires on-screen buttons. Action buttons trigger their own JS modules.
 * Pattern: same as hatchability.js (return object, arrow functions, const scope = _module).
 */
var _kernelProductionGrid = function () {
    'use strict';
    const delay = (ms) => {
        const end = Date.now() + ms;
        return new Promise((resolve) => {
            function tick() {
                if (Date.now() >= end) return resolve();
                requestAnimationFrame(tick);
            }
            requestAnimationFrame(tick);
        });
    };

    return {
        batches: [],
        filteredBatches: [],
        searchDebounceToken: 0,

        init: () => {
            const scope = _kernelProductionGrid;
            if (typeof _app !== 'undefined' && typeof _app.checkSession === 'function' && !_app.checkSession()) {
                return;
            }
            console.log('[Kernel Production] Initializing grid...');
            scope.bindEvents();
            scope.loadBatches();
            if (typeof _kernelProductionStages !== 'undefined' && _kernelProductionStages.init) _kernelProductionStages.init();
            if (typeof _kernelProductionJobCard !== 'undefined' && _kernelProductionJobCard.init) _kernelProductionJobCard.init();
            if (typeof _kernelProductionEndSample !== 'undefined' && _kernelProductionEndSample.init) _kernelProductionEndSample.init();
            if (typeof _kernelProductionBatchActions !== 'undefined' && _kernelProductionBatchActions.init) _kernelProductionBatchActions.init();
        },

        bindEvents: () => {
            const scope = _kernelProductionGrid;
            $('#exportBatchesBtn').off('click').on('click', (e) => {
                e.preventDefault();
                scope.exportBatches();
            });
            $('#searchBatchesInput').on('input', () => {
                const token = ++scope.searchDebounceToken;
                (async () => {
                    await delay(300);
                    if (token === scope.searchDebounceToken) scope.filterBatches();
                })();
            });
            $('#filterBatchStatus').on('change', () => scope.filterBatches());
            $('#clearBatchFiltersBtn').on('click', () => {
                $('#searchBatchesInput').val('');
                $('#filterBatchStatus').val('');
                scope.filterBatches();
            });
            $(document).on('click', '.js-production-batch', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                const productionStagesId = $(this).data('production-stages-id');
                if (typeof _kernelProductionStages === 'undefined') {
                    console.warn('[Kernel Production] Stages module not loaded');
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Production stages not loaded. Please refresh the page.', 'error');
                    return;
                }
                if (typeof _kernelProductionStages.init === 'function') _kernelProductionStages.init();
                if (productionStagesId && _kernelProductionStages.showProductionStagesViewModal) {
                    _kernelProductionStages.showProductionStagesViewModal(productionStagesId);
                } else if (batchId && _kernelProductionStages.showProductionStagesModalForBatch) {
                    _kernelProductionStages.showProductionStagesModalForBatch(batchId);
                }
            });
            $(document).on('click', '.js-end-sample-batch', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                const packingSampleId = $(this).data('packing-sample-id');
                if (packingSampleId && typeof _kernelProductionEndSample !== 'undefined' && _kernelProductionEndSample.showEndSampleViewModal) {
                    _kernelProductionEndSample.showEndSampleViewModal(packingSampleId);
                } else if (batchId && typeof _kernelProductionEndSample !== 'undefined' && _kernelProductionEndSample.showEndSampleModal) {
                    _kernelProductionEndSample.showEndSampleModal(batchId);
                }
            });
            $(document).on('click', '.js-release-to-stock', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _kernelProductionBatchActions !== 'undefined' && _kernelProductionBatchActions.releaseBatchToStock) {
                    _kernelProductionBatchActions.releaseBatchToStock(batchId);
                }
            });
            $(document).on('click', '.js-batch-history', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _kernelProductionBatchActions !== 'undefined' && _kernelProductionBatchActions.showBatchHistory) {
                    _kernelProductionBatchActions.showBatchHistory(batchId);
                }
            });
            $(document).on('click', '.js-job-card-batch', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                const jobCardId = $(this).data('job-card-id');
                if (jobCardId && typeof _kernelProductionJobCard !== 'undefined' && _kernelProductionJobCard.showJobCardViewModal) {
                    _kernelProductionJobCard.showJobCardViewModal(jobCardId);
                } else if (batchId && typeof _kernelProductionJobCard !== 'undefined' && _kernelProductionJobCard.showJobCardModalForBatch) {
                    _kernelProductionJobCard.showJobCardModalForBatch(batchId);
                }
            });
        },

        filterBatches: () => {
            const scope = _kernelProductionGrid;
            const searchTerm = ($('#searchBatchesInput').val() || '').toLowerCase();
            const statusFilter = $('#filterBatchStatus').val();
            scope.filteredBatches = scope.batches.filter((batch) => {
                const matchesSearch = !searchTerm ||
                    (batch.batch_number && batch.batch_number.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (batch.grower_name && batch.grower_name.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (batch.status && batch.status.toLowerCase().indexOf(searchTerm) >= 0);
                const matchesStatus = !statusFilter || batch.status === statusFilter;
                return matchesSearch && matchesStatus;
            });
            scope.renderBatches();
        },

        loadBatches: (forceRefresh) => {
            const scope = _kernelProductionGrid;
            forceRefresh = !!forceRefresh;
            if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getProductionBatches !== 'function') {
                console.warn('[Kernel Production] dataFunctions not available');
                return;
            }
            const startTime = performance.now();
            dataFunctions.getProductionBatches(null, forceRefresh, { batch_type: 'kernel' }).then((allBatches) => {
                const productionStatuses = ['in_production', 'receiving', 'cracking', 'drying', 'sorting_dry', 'packing', 'completed'];
                const batches = (allBatches || []).filter((b) =>
                    productionStatuses.indexOf(b.status) >= 0 && b.status !== 'in_finished_stock'
                );
                const jobCardsPromise = (dataFunctions.getKernelJobCards && dataFunctions.getKernelJobCards(null, forceRefresh)) || Promise.resolve([]);
                const packingSamplesPromise = (dataFunctions.getKernelPackingSamples && dataFunctions.getKernelPackingSamples(null, forceRefresh)) || Promise.resolve([]);
                const daysListPromise = (dataFunctions.getKernelProductionDaysList && dataFunctions.getKernelProductionDaysList(null, forceRefresh)) || Promise.resolve([]);
                Promise.all([Promise.resolve(batches), jobCardsPromise, packingSamplesPromise, daysListPromise]).then((results) => {
                    const jobCards = results[1] || [];
                    const packingSamples = results[2] || [];
                    const daysList = results[3] || [];
                    const jobCardByBatchId = {};
                    const jobCardByBatchNumber = {};
                    jobCards.forEach((jc) => {
                        if (jc.production_batch_id) jobCardByBatchId[jc.production_batch_id] = { id: jc.id, status: jc.status };
                        if (jc.batch_number) jobCardByBatchNumber[jc.batch_number] = { id: jc.id, status: jc.status };
                    });
                    const packingByBatchId = {};
                    (packingSamples || []).forEach((ps) => {
                        if (ps.production_batch_id) packingByBatchId[ps.production_batch_id] = { id: ps.id };
                    });
                    const productionDaysByBatchId = {};
                    (Array.isArray(daysList) ? daysList : []).forEach((d) => {
                        const bid = d.production_batch_id;
                        if (!bid) return;
                        if (!productionDaysByBatchId[bid]) productionDaysByBatchId[bid] = [];
                        productionDaysByBatchId[bid].push({
                            id: d.id,
                            day_number: d.day_number,
                            kernel_production_stages_id: d.kernel_production_stages_id
                        });
                    });
                    batches.forEach((b) => {
                        const jc = jobCardByBatchId[b.id] || jobCardByBatchNumber[b.batch_number];
                        b.jobCardId = jc ? jc.id : null;
                        b.hasJobCard = !!(jc && jc.id);
                        const ps = packingByBatchId[b.id];
                        b.packingSampleId = ps ? ps.id : null;
                        b.hasPackingSample = !!(ps && ps.id);
                        b.productionDays = productionDaysByBatchId[b.id] || [];
                        b.productionFinishedAt = b.production_finished_at != null ? b.production_finished_at : b.productionFinishedAt;
                        b.hasProductionStages = b.productionDays.length > 0;
                    });
                    scope.batches = batches;
                    scope.filteredBatches = scope.batches;
                    scope.renderBatches();
                    console.log('[Kernel Production] Batches loaded in ' + (performance.now() - startTime).toFixed(2) + 'ms, count: ' + batches.length);
                }).catch((err) => {
                    console.error('[Kernel Production] Error loading batches:', err);
                });
            }).catch((error) => {
                console.error('[Kernel Production] Error loading batches:', error);
            });
        },

        renderBatches: () => {
            const scope = _kernelProductionGrid;
            const tbody = $('#batchesTableBody');
            tbody.empty();
            if (scope.filteredBatches.length === 0) {
                if (scope.batches.length === 0) {
                    tbody.html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No production batches. Release batches from Grower Intake.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search.</td></tr>');
                }
                return;
            }
            scope.filteredBatches.forEach((batch) => {
                const step = batch.current_step != null ? batch.current_step : 1;
                const productionAndSampleDone = (batch.hasJobCard || batch.hasProductionStages) && batch.hasPackingSample;
                const canReleaseToStock = productionAndSampleDone || batch.status === 'completed' || step >= 17;
                const receivedDate = batch.received_date ? (batch.received_date.toString().split ? batch.received_date.toString().split('T')[0] : batch.received_date) : 'N/A';
                const productionStagesId = batch.productionDays && batch.productionDays[0] && batch.productionDays[0].kernel_production_stages_id ? batch.productionDays[0].kernel_production_stages_id : '';
                const productionLabel = batch.productionFinishedAt ? '&#10003; Production' : 'Production';
                const endSampleLabel = batch.hasPackingSample && batch.packingSampleId ? '&#10003; End sample' : 'End sample';
                const jobCardLabel = batch.hasJobCard && batch.jobCardId ? '&#10003; Job Card' : 'Job Card';
                const jobCardItem = '<a class="dropdown-item js-job-card-batch" href="#" data-batch-id="' + batch.id + '" data-job-card-id="' + (batch.jobCardId || '') + '">' + jobCardLabel + '</a>';
                let menuItems = [
                    '<a class="dropdown-item js-batch-history" href="#" data-batch-id="' + batch.id + '">History</a>',
                    '<a class="dropdown-item js-production-batch" href="#" data-batch-id="' + batch.id + '" data-production-stages-id="' + productionStagesId + '">' + productionLabel + '</a>',
                    '<a class="dropdown-item js-end-sample-batch" href="#" data-batch-id="' + batch.id + '" data-packing-sample-id="' + (batch.packingSampleId || '') + '">' + endSampleLabel + '</a>',
                    jobCardItem
                ];
                if (canReleaseToStock) {
                    menuItems.push('<a class="dropdown-item js-release-to-stock" href="#" data-batch-id="' + batch.id + '">Release to stock</a>');
                } else {
                    menuItems.push('<span class="dropdown-item text-muted">Release to stock</span>');
                }
                const actionsCell = '<div class="dropdown">' +
                    '<button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" id="batchActions' + batch.id + '" data-bs-toggle="dropdown" aria-expanded="false">Actions</button>' +
                    '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="batchActions' + batch.id + '">' + menuItems.join('') + '</ul></div>';
                const row = '<tr><td>' + (batch.batch_number || 'N/A') + '</td><td>' + (batch.grower_name || 'N/A') + '</td><td>' + receivedDate + '</td><td>' + (batch.wet_nis_received_kg || '0') + '</td><td><span class="badge bg-info">' + (batch.status || 'in_production') + '</span></td><td>' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
        },

        getNextStepAndStatus: (currentStep) => {
            const step = currentStep != null ? currentStep : 1;
            if (step >= 17) return { nextStep: 17, nextStatus: 'in_finished_stock', stage: 'finished_stock' };
            const nextStep = step + 1;
            const statusMap = { 1: 'receiving', 2: 'cracking', 3: 'drying', 4: 'sorting_dry', 5: 'packing', 6: 'packing', 7: 'packing', 8: 'packing', 9: 'packing', 10: 'packing', 11: 'packing', 12: 'packing', 13: 'packing', 14: 'packing', 15: 'packing', 16: 'packing', 17: 'in_finished_stock' };
            const nextStatus = nextStep >= 17 ? 'in_finished_stock' : (statusMap[nextStep] || 'packing');
            const stage = nextStep >= 17 ? 'finished_stock' : 'production';
            return { nextStep, nextStatus, stage };
        },

        advanceBatchStep: (batchId, currentStep) => {
            const scope = _kernelProductionGrid;
            if (!batchId) return;
            const step = currentStep != null ? currentStep : 1;
            if (step >= 17) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Batch already at final step (17).', 'info');
                return;
            }
            const out = scope.getNextStepAndStatus(step);
            if (typeof dataFunctions === 'undefined' || !dataFunctions.updateProductionBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Update batch function not available', 'error');
                return;
            }
            dataFunctions.updateProductionBatch(batchId, { status: out.nextStatus, current_step: out.nextStep, stage: out.stage }).then((result) => {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Step updated', text: 'Batch moved to step ' + out.nextStep, timer: 2000, showConfirmButton: false });
                    scope.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Failed to update batch');
                }
            }).catch((e) => {
                console.error('[Kernel Production] advanceBatchStep failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to advance step', 'error');
            });
        },

        getBatch: (batchId) => {
            const scope = _kernelProductionGrid;
            const id = String(batchId);
            return scope.batches.filter((b) => String(b.id) === id)[0] || scope.filteredBatches.filter((b) => String(b.id) === id)[0] || null;
        },

        exportBatches: () => {
            const scope = _kernelProductionGrid;
            if (!scope.batches || scope.batches.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            const columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'grower_name', label: 'Supplier' },
                { key: 'received_date', label: 'Received Date' },
                { key: 'wet_nis_received_kg', label: 'Wet NIS (kg)' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.batches, 'production_batches', columns);
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

function initializeKernelProductionGrid() {
    if (typeof _kernelProductionGrid === 'undefined') {
        console.error('[Kernel Production] _kernelProductionGrid not defined');
        return;
    }
    _kernelProductionGrid.init();
}
