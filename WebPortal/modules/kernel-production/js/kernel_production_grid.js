/**
 * Kernel Production Grid Module
 * Loads batch table and wires on-screen buttons. Action buttons trigger their own JS modules.
 * Pattern: same as hatchability.js (return object, arrow functions, const scope = _module).
 */
var _kernelProductionGrid = function () {
    'use strict';

    // --- TEMPORARY: Role-based UI (hardcoded). To remove: delete this ROLE_FEATURE block and the "if (isKpDataAdmin)" branch in renderBatches (keep only the dropdown branch). ---
    const ROLE_FEATURE = {
        /** Role name that sees only the Production button instead of the full Actions dropdown. */
        KP_DATA_ADMIN_ROLE: 'KP Data Admin',
        /** Returns true if current user has role "KP Data Admin" (from localStorage user_info). */
        isKpDataAdmin: function () {
            try {
                const raw = typeof localStorage !== 'undefined' && localStorage.getItem('user_info');
                if (!raw) return false;
                const user = JSON.parse(raw);
                return user && user.role_name === ROLE_FEATURE.KP_DATA_ADMIN_ROLE;
            } catch (e) {
                return false;
            }
        }
    };
    // --- End TEMPORARY role feature ---

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

    /** Convert status from snake_case to title case with spaces for display (e.g. in_production -> In Production). */
    const statusToTitleCase = (str) => {
        if (!str || typeof str !== 'string') return str || '';
        return str.split('_').map((part) =>
            part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
        ).join(' ');
    };

    /**
     * Derive display status from actual production data, not just DB status.
     * Batches with no production days/history show "Awaiting production"; only batches with real production data show "In production".
     * Returns { label: string, filterValue: string }.
     */
    const getBatchDisplayStatus = (batch) => {
        const hasProductionData = (batch.productionDays && batch.productionDays.length > 0) || !!batch.jobCardId;
        const productionFinished = !!batch.productionFinishedAt;
        const hasEndSample = !!batch.hasPackingSample;

        if (productionFinished && hasEndSample) return { label: 'Release ready', filterValue: 'release_ready' };
        if (productionFinished) return { label: 'Awaiting test', filterValue: 'awaiting_test' };
        if (hasProductionData) return { label: 'In production', filterValue: 'in_production' };
        return { label: 'Awaiting production', filterValue: 'awaiting_production' };
    };

    return {
        batches: [],
        filteredBatches: [],
        searchDebounceToken: 0,

        /** Same derived status as in the grid table (for use by batch history modal etc.). */
        getBatchDisplayStatus: getBatchDisplayStatus,

        init: () => {
            const scope = _kernelProductionGrid;
            if (typeof _app !== 'undefined' && typeof _app.checkSession === 'function' && !_app.checkSession()) {
                return;
            }
            console.log('[Kernel Production] Initializing grid...');
            scope.bindEvents();
            scope.loadBatches();
            // Modal pattern: load modal content into empty containers, then init child modules (they bind to modal DOM)
            const loadPromises = [];
            $('.modal[route-name]').each((index, el) => {
                const routeName = $(el).attr('route-name');
                const elementSelector = '#' + $(el).attr('id');
                if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName, elementSelector }));
                }
            });
            Promise.all(loadPromises).then(() => {
                if (typeof _modal_production_stages !== 'undefined' && _modal_production_stages.init) _modal_production_stages.init();
                if (typeof _modal_kernel_job_card !== 'undefined' && _modal_kernel_job_card.init) _modal_kernel_job_card.init();
                if (typeof _modal_end_sample !== 'undefined' && _modal_end_sample.init) _modal_end_sample.init();
                if (typeof _kernelProductionBatchActions !== 'undefined' && _kernelProductionBatchActions.init) _kernelProductionBatchActions.init();
            }).catch((err) => {
                console.error('[Kernel Production] Error loading modals:', err);
                if (typeof _modal_production_stages !== 'undefined' && _modal_production_stages.init) _modal_production_stages.init();
                if (typeof _modal_kernel_job_card !== 'undefined' && _modal_kernel_job_card.init) _modal_kernel_job_card.init();
                if (typeof _modal_end_sample !== 'undefined' && _modal_end_sample.init) _modal_end_sample.init();
                if (typeof _kernelProductionBatchActions !== 'undefined' && _kernelProductionBatchActions.init) _kernelProductionBatchActions.init();
            });
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
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (typeof _modal_production_stages === 'undefined') {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Production modal not loaded. Please refresh the page.', 'error');
                    return;
                }
                if (!batchId) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found.', 'error');
                    return;
                }
                if (typeof _modal_production_stages.init === 'function') _modal_production_stages.init();
                if (_modal_production_stages.showProductionStagesModalForBatch) {
                    _modal_production_stages.showProductionStagesModalForBatch(batchId);
                }
            });
            $(document).on('click', '.js-end-sample-batch', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                const packingSampleId = $(this).data('packing-sample-id');
                if (packingSampleId && typeof _modal_end_sample_view !== 'undefined' && _modal_end_sample_view.show) {
                    _modal_end_sample_view.show(packingSampleId);
                } else if (batchId && typeof _modal_end_sample !== 'undefined' && _modal_end_sample.show) {
                    _modal_end_sample.show(batchId);
                }
            });
            $(document).on('click', '.js-release-to-stock', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _kernelProductionBatchActions !== 'undefined' && _kernelProductionBatchActions.releaseBatchToStock) {
                    _kernelProductionBatchActions.releaseBatchToStock(batchId);
                }
            });
            $(document).on('click', '.js-release-to-stock-disabled', function (e) {
                e.preventDefault();
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'info',
                        title: 'Release to stock',
                        text: 'Complete Production, then complete End sample for this batch. Release to stock will become available when the batch is release-ready or completed.'
                    });
                }
            });
            $(document).on('click', '.js-batch-history', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _modal_batch_history !== 'undefined' && _modal_batch_history.show) {
                    _modal_batch_history.show(batchId);
                }
            });
            $(document).on('click', '#batchesTableBody tr.js-batch-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _modal_batch_history !== 'undefined' && _modal_batch_history.show) {
                    _modal_batch_history.show(batchId);
                }
            });
            $(document).on('click', '.js-job-card-batch', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                const jobCardId = $(this).data('job-card-id');
                if (jobCardId && typeof _modal_job_card_view !== 'undefined' && _modal_job_card_view.show) {
                    _modal_job_card_view.show(jobCardId);
                } else if (batchId && typeof _modal_kernel_job_card !== 'undefined' && _modal_kernel_job_card.showJobCardModalForBatch) {
                    _modal_kernel_job_card.showJobCardModalForBatch(batchId);
                }
            });
        },

        filterBatches: () => {
            const scope = _kernelProductionGrid;
            const searchTerm = ($('#searchBatchesInput').val() || '').toLowerCase();
            const statusFilter = $('#filterBatchStatus').val();
            scope.filteredBatches = scope.batches.filter((batch) => {
                const displayStatus = getBatchDisplayStatus(batch);
                const matchesSearch = !searchTerm ||
                    (batch.batch_number && batch.batch_number.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (batch.grower_name && batch.grower_name.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (batch.status && batch.status.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (displayStatus.label && displayStatus.label.toLowerCase().indexOf(searchTerm) >= 0);
                const matchesStatus = !statusFilter || displayStatus.filterValue === statusFilter;
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
                const productionStatuses = ['awaiting_production', 'in_production', 'receiving', 'cracking', 'drying', 'sorting_dry', 'packing', 'awaiting_test', 'release_ready', 'completed'];
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
                const canReleaseToStock = batch.status === 'release_ready' || batch.status === 'completed' || (batch.productionFinishedAt && batch.hasPackingSample);
                const receivedDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                    ? (_common.formatDateDDMMYYYY(batch.received_date) || 'N/A')
                    : (batch.received_date ? (batch.received_date.toString().split ? batch.received_date.toString().split('T')[0] : batch.received_date) : 'N/A');
                const productionStagesId = batch.productionDays && batch.productionDays[0] && batch.productionDays[0].kernel_production_stages_id ? batch.productionDays[0].kernel_production_stages_id : '';
                const productionLabel = batch.productionFinishedAt ? '&#10003; Production' : 'Production';
                const endSampleLabel = batch.hasPackingSample && batch.packingSampleId ? '&#10003; End sample' : 'End sample';
                const jobCardLabel = batch.hasJobCard && batch.jobCardId ? '&#10003; Job Card' : 'Job Card';
                const jobCardItem = '<a class="dropdown-item js-job-card-batch" href="#" data-batch-id="' + batch.id + '" data-job-card-id="' + (batch.jobCardId || '') + '">' + jobCardLabel + '</a>';
                let menuItems = [
                    '<a class="dropdown-item js-production-batch" href="#" data-batch-id="' + batch.id + '" data-production-stages-id="' + productionStagesId + '">' + productionLabel + '</a>',
                    '<a class="dropdown-item js-end-sample-batch" href="#" data-batch-id="' + batch.id + '" data-packing-sample-id="' + (batch.packingSampleId || '') + '">' + endSampleLabel + '</a>',
                    jobCardItem
                ];
                if (canReleaseToStock) {
                    menuItems.push('<a class="dropdown-item js-release-to-stock" href="#" data-batch-id="' + batch.id + '">Release to stock</a>');
                } else {
                    menuItems.push('<span class="dropdown-item text-muted js-release-to-stock-disabled" role="button" tabindex="0">Release to stock</span>');
                }
                // TEMPORARY: KP Data Admin sees only Production button. Remove when replacing with real auth.
                const isKpDataAdmin = typeof ROLE_FEATURE !== 'undefined' && ROLE_FEATURE.isKpDataAdmin && ROLE_FEATURE.isKpDataAdmin();
                let actionsCell;
                if (isKpDataAdmin) {
                    actionsCell = '<button type="button" class="btn btn-sm btn-outline-secondary js-production-batch" data-batch-id="' + batch.id + '" data-production-stages-id="' + productionStagesId + '">' + productionLabel + '</button>';
                } else {
                    actionsCell = '<div class="dropdown">' +
                        '<button class="btn btn-sm btn-outline-secondary" type="button" id="batchActions' + batch.id + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                        '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="batchActions' + batch.id + '">' + menuItems.join('') + '</ul></div>';
                }
                const displayStatus = getBatchDisplayStatus(batch);
                const row = '<tr class="js-batch-row" data-batch-id="' + batch.id + '"><td>' + (batch.batch_number || 'N/A') + '</td><td>' + (batch.grower_name || 'N/A') + '</td><td>' + receivedDate + '</td><td>' + (batch.wet_nis_received_kg || '0') + '</td><td><span class="badge bg-info">' + displayStatus.label + '</span></td><td>' + actionsCell + '</td></tr>';
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
