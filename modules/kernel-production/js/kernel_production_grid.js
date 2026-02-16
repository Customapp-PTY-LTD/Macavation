/**
 * Kernel Production Grid Module
 * Handles 17-step production workflow
 */
var _kernelProductionGrid = function () {
    return {
        batches: [],
        filteredBatches: [],
        searchTimeout: null,
        init: function () {
            console.log('[Kernel Production] Initializing grid...');
            const scope = this;
            
            // Use MutationObserver to wait for buttons to be added to DOM
            const checkAndInit = () => {
                const addJobCardBtn = document.getElementById('addJobCardBtn');
                if (addJobCardBtn) {
                    console.log('[Kernel Production] Buttons found, setting up event listeners');
                    scope.setupEventListeners();
                    scope.loadBatches();
                } else {
                    console.log('[Kernel Production] Buttons not found yet, retrying...');
                    setTimeout(checkAndInit, 100);
                }
            };
            
            // Start checking
            setTimeout(checkAndInit, 50);
        },
        setupEventListeners: function () {
            const scope = this;
            console.log('[Kernel Production] Setting up event listeners...');
            
            // Check if buttons exist
            const addJobCardBtn = document.getElementById('addJobCardBtn');
            if (!addJobCardBtn) {
                console.warn('[Kernel Production] addJobCardBtn not found!');
                return;
            }
            
            // Remove existing handlers to prevent duplicates (if jQuery is available)
            if (typeof $ !== 'undefined') {
                $('#addBatchBtn').off('click');
                $('#addJobCardBtn').off('click');
                $('#saveJobCardBtn').off('click');
                $('#addSoundKernelRow').off('click');
                $('#addButterGradeRow').off('click');
            }
            
            // Use both native and jQuery event listeners for maximum compatibility
            if (addJobCardBtn) {
                // Native event listener
                addJobCardBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    console.log('[Kernel Production] Job Card button clicked (native)');
                    scope.showJobCardModal();
                });
                
                // jQuery event listener (if available)
                if (typeof $ !== 'undefined') {
                    $('#addJobCardBtn').on('click', function(e) {
                        e.preventDefault();
                        console.log('[Kernel Production] Job Card button clicked (jQuery)');
                        scope.showJobCardModal();
                    });
                }
            }
            
            // Export button
            const exportBtn = document.getElementById('exportBatchesBtn');
            if (exportBtn) {
                exportBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[Kernel Production] Export button clicked (native)');
                    if (typeof scope.exportBatches === 'function') {
                        scope.exportBatches();
                    } else {
                        console.warn('[Kernel Production] exportBatches function not found');
                    }
                });
            } else {
                console.warn('[Kernel Production] exportBatchesBtn not found!');
            }
            
            // Save Job Card button
            const saveJobCardBtn = document.getElementById('saveJobCardBtn');
            if (saveJobCardBtn) {
                saveJobCardBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    scope.saveJobCard();
                });
            }
            
            // jQuery handlers for compatibility
            if (typeof $ !== 'undefined') {
                $('#saveJobCardBtn').on('click', function (e) {
                    e.preventDefault();
                    scope.saveJobCard();
                });
            }
            
            // Save End sample button
            const saveEndSampleBtn = document.getElementById('saveEndSampleBtn');
            if (saveEndSampleBtn) {
                saveEndSampleBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.saveEndSample();
                });
            }
            if (typeof $ !== 'undefined') {
                $('#saveEndSampleBtn').on('click', function (e) {
                    e.preventDefault();
                    scope.saveEndSample();
                });
            }
            var saveProductionStagesBtn = document.getElementById('saveProductionStagesBtn');
            if (saveProductionStagesBtn) {
                saveProductionStagesBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.saveProductionStages();
                });
            }
            if (typeof $ !== 'undefined') {
                $('#saveProductionStagesBtn').off('click').on('click', function (e) {
                    e.preventDefault();
                    scope.saveProductionStages();
                });
            }
            var addProductionDayBtn = document.getElementById('addProductionDayBtn');
            if (addProductionDayBtn) {
                addProductionDayBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.addProductionDay();
                });
            }
            var batchSummaryBtn = document.getElementById('batchSummaryBtn');
            if (batchSummaryBtn) {
                batchSummaryBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.showBatchSummary();
                });
            }
            var finishBatchProductionBtn = document.getElementById('finishBatchProductionBtn');
            if (finishBatchProductionBtn) {
                finishBatchProductionBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.finishBatchProduction();
                });
            }
            var dayListEl = document.getElementById('productionStagesDayList');
            if (dayListEl) {
                dayListEl.addEventListener('click', function (e) {
                    var btn = e.target && e.target.closest && e.target.closest('[data-day-id]');
                    if (btn && btn.getAttribute('data-day-id')) {
                        e.preventDefault();
                        scope.selectProductionDay(btn.getAttribute('data-day-id'));
                    }
                });
            }
            document.addEventListener('click', function (e) {
                var actionBtn = e.target && e.target.closest && e.target.closest('.production-action-btn');
                if (actionBtn && actionBtn.getAttribute('data-action')) {
                    e.preventDefault();
                    scope.chooseProductionAction(actionBtn.getAttribute('data-action'));
                }
            });
            var recordAnotherBtn = document.getElementById('recordAnotherActionBtn');
            if (recordAnotherBtn) {
                recordAnotherBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.showProductionActionSelector();
                });
            }
            var saveSingleBtn = document.getElementById('saveProductionStagesBtnSingle');
            if (saveSingleBtn) {
                saveSingleBtn.addEventListener('click', function (e) {
                    e.preventDefault();
                    scope.saveProductionStages();
                });
            }

            // Production form: auto-fill Time Spent from Start Time and End Time (Cracking section)
            document.addEventListener('change', function (e) {
                var id = e.target && e.target.id;
                if (id === 'ps_crack_start1' || id === 'ps_crack_end1') scope.updateCrackTimeSpentRow(1);
                if (id === 'ps_crack_start2' || id === 'ps_crack_end2') scope.updateCrackTimeSpentRow(2);
            });
            document.addEventListener('input', function (e) {
                var id = e.target && e.target.id;
                if (id === 'ps_crack_start1' || id === 'ps_crack_end1') scope.updateCrackTimeSpentRow(1);
                if (id === 'ps_crack_start2' || id === 'ps_crack_end2') scope.updateCrackTimeSpentRow(2);
            });
            
            // Add row buttons - use delegated events for dynamically added elements
            const addSoundKernelBtn = document.getElementById('addSoundKernelRow');
            if (addSoundKernelBtn) {
                addSoundKernelBtn.addEventListener('click', function() {
                    scope.addSoundKernelRow();
                });
            }
            
            const addButterGradeBtn = document.getElementById('addButterGradeRow');
            if (addButterGradeBtn) {
                addButterGradeBtn.addEventListener('click', function() {
                    scope.addButterGradeRow();
                });
            }
            
            // jQuery handlers
            if (typeof $ !== 'undefined') {
                $('#addSoundKernelRow').on('click', function () {
                    scope.addSoundKernelRow();
                });
                $('#addButterGradeRow').on('click', function () {
                    scope.addButterGradeRow();
                });
            }
            // Delegated event handlers for dynamic content (both native and jQuery)
            document.addEventListener('click', function(e) {
                if (e.target.closest('.removeSoundKernelRow')) {
                    e.preventDefault();
                    const row = e.target.closest('tr');
                    if (row) row.remove();
                    scope.calculateJobCardTotals();
                }
                if (e.target.closest('.removeButterGradeRow')) {
                    e.preventDefault();
                    const row = e.target.closest('tr');
                    if (row) row.remove();
                    scope.calculateJobCardTotals();
                }
            });
            
            // Auto-calculate fields - use native and jQuery
            const totalWeightInput = document.getElementById('jobCardTotalWeight');
            const removedPreSizerInput = document.getElementById('jobCardRemovedPreSizer');
            if (totalWeightInput) {
                totalWeightInput.addEventListener('input', () => scope.calculateBalance());
            }
            if (removedPreSizerInput) {
                removedPreSizerInput.addEventListener('input', () => scope.calculateBalance());
            }
            
            const receivingMoistureInput = document.getElementById('jobCardReceivingMoisture');
            const packingMoistureInput = document.getElementById('jobCardPackingMoisture');
            if (receivingMoistureInput) {
                receivingMoistureInput.addEventListener('input', () => scope.calculateRemovedMoisture());
            }
            if (packingMoistureInput) {
                packingMoistureInput.addEventListener('input', () => scope.calculateRemovedMoisture());
            }
            
            // Delegated input handlers for tables
            const soundKernelTable = document.getElementById('soundKernelTable');
            const butterGradeTable = document.getElementById('butterGradeTable');
            if (soundKernelTable) {
                soundKernelTable.addEventListener('input', () => scope.calculateJobCardTotals());
            }
            if (butterGradeTable) {
                butterGradeTable.addEventListener('input', () => scope.calculateJobCardTotals());
            }
            
            // Waste inputs
            const wasteInputs = ['jobCardWasteOilKernel', 'jobCardWasteSaltPepper', 'jobCardWasteShellFines', 'jobCardWasteCompost', 'jobCardWasteShell'];
            wasteInputs.forEach(id => {
                const input = document.getElementById(id);
                if (input) {
                    input.addEventListener('input', () => scope.calculateMassBalance());
                }
            });
            
            // jQuery handlers for compatibility
            if (typeof $ !== 'undefined') {
                $(document).on('click', '.removeSoundKernelRow', function () {
                    $(this).closest('tr').remove();
                    scope.calculateJobCardTotals();
                });
                $(document).on('click', '.removeButterGradeRow', function () {
                    $(this).closest('tr').remove();
                    scope.calculateJobCardTotals();
                });
                $('#jobCardTotalWeight, #jobCardRemovedPreSizer').on('input', function () {
                    scope.calculateBalance();
                });
                $('#jobCardReceivingMoisture, #jobCardPackingMoisture').on('input', function () {
                    scope.calculateRemovedMoisture();
                });
                $(document).on('input', '#soundKernelTableBody input, #butterGradeTableBody input', function () {
                    scope.calculateJobCardTotals();
                });
                $(document).on('input', '#jobCardWasteOilKernel, #jobCardWasteSaltPepper, #jobCardWasteShellFines, #jobCardWasteCompost, #jobCardWasteShell', function () {
                    scope.calculateMassBalance();
                });
                
                // Modal cleanup
                $('#kernelJobCardModal').on('hidden.bs.modal', function () {
                    scope.clearJobCardForm();
                });
            }
            
            // Native modal cleanup
            const kernelJobCardModal = document.getElementById('kernelJobCardModal');
            if (kernelJobCardModal) {
                kernelJobCardModal.addEventListener('hidden.bs.modal', function () {
                    scope.clearJobCardForm();
                });
            }
            
            // Search with debouncing
            $('#searchBatchesInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterBatches();
                }, 300);
            });
            
            // Filters
            $('#filterBatchStatus').on('change', function () {
                scope.filterBatches();
            });
            
            // Clear filters
            $('#clearBatchFiltersBtn').on('click', function () {
                $('#searchBatchesInput').val('');
                $('#filterBatchStatus').val('');
                scope.filterBatches();
            });

            // Delegated: Production / End sample / Release to stock (per doc)
            $(document).on('click', '.js-production-batch', function () {
                const batchId = $(this).data('batch-id');
                const productionStagesId = $(this).data('production-stages-id');
                const jobCardId = $(this).data('job-card-id');
                if (productionStagesId) {
                    scope.showProductionStagesViewModal(productionStagesId);
                } else if (jobCardId) {
                    scope.showJobCardViewModal(jobCardId);
                } else if (batchId) {
                    scope.showProductionStagesModalForBatch(batchId);
                }
            });
            $(document).on('click', '.js-end-sample-batch', function () {
                const batchId = $(this).data('batch-id');
                const packingSampleId = $(this).data('packing-sample-id');
                if (packingSampleId) {
                    scope.showEndSampleViewModal(packingSampleId);
                } else if (batchId) {
                    scope.showEndSampleModal(batchId);
                }
            });
            $(document).on('click', '.js-release-to-stock', function () {
                const batchId = $(this).data('batch-id');
                if (batchId) scope.releaseBatchToStock(batchId);
            });
            $(document).on('click', '.js-batch-history', function () {
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showBatchHistory(batchId);
            });
            $(document).on('click', '.js-job-card-batch', function () {
                const batchId = $(this).data('batch-id');
                if (batchId) scope.showJobCardModalForBatch(batchId);
            });

            // Remember production form tab per batch (when user switches tab or closes modal)
            var tabsEl = document.getElementById('productionStagesTabs');
            if (tabsEl) {
                tabsEl.addEventListener('shown.bs.tab', function (e) {
                    var target = e.target;
                    if (target && target.getAttribute && target.getAttribute('data-bs-target')) {
                        var paneId = target.getAttribute('data-bs-target'); // e.g. "#pane-washing"
                        var tabName = paneId.replace('#pane-', '');
                        var batchIdEl = document.getElementById('productionStagesBatchId');
                        var batchId = batchIdEl ? batchIdEl.value : null;
                        if (batchId && tabName) {
                            try { localStorage.setItem('kernelProduction_lastTab_' + batchId, tabName); } catch (err) {}
                        }
                    }
                });
            }
            var productionStagesModalEl = document.getElementById('productionStagesModal');
            if (productionStagesModalEl) {
                productionStagesModalEl.addEventListener('hidden.bs.modal', function () {
                    var batchIdEl = document.getElementById('productionStagesBatchId');
                    var batchId = batchIdEl ? batchIdEl.value : null;
                    if (!batchId) return;
                    var activeTab = tabsEl && tabsEl.querySelector('.nav-link.active');
                    if (activeTab && activeTab.getAttribute('data-bs-target')) {
                        var paneId = activeTab.getAttribute('data-bs-target');
                        var tabName = paneId.replace('#pane-', '');
                        try { localStorage.setItem('kernelProduction_lastTab_' + batchId, tabName); } catch (err) {}
                    }
                    scope.saveProductionStagesDraftToStorage();
                });
            }
        },
        filterBatches: function () {
            const searchTerm = $('#searchBatchesInput').val().toLowerCase();
            const statusFilter = $('#filterBatchStatus').val();
            
            this.filteredBatches = this.batches.filter(batch => {
                // Search filter
                const matchesSearch = !searchTerm || 
                    (batch.batch_number && batch.batch_number.toLowerCase().includes(searchTerm)) ||
                    (batch.grower_name && batch.grower_name.toLowerCase().includes(searchTerm)) ||
                    (batch.status && batch.status.toLowerCase().includes(searchTerm));
                
                // Status filter
                const matchesStatus = !statusFilter || batch.status === statusFilter;
                
                return matchesSearch && matchesStatus;
            });
            
            this.renderBatches();
        },
        loadBatches: async function (forceRefresh = false) {
            try {
                // Ensure dataFunctions is available
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getProductionBatches !== 'function') {
                    console.warn('[Kernel Production] dataFunctions not available, skipping load');
                    return;
                }
                
                const startTime = performance.now();
                console.log('[Kernel Production] Loading batches...');
                
                const allBatches = await dataFunctions.getProductionBatches(null, forceRefresh, { batch_type: 'kernel' }).catch((error) => {
                    console.error('[Kernel Production] Error loading batches:', error);
                    return [];
                });
                const productionStatuses = ['in_production', 'receiving', 'cracking', 'drying', 'sorting_dry', 'packing', 'completed'];
                const batches = (allBatches || []).filter(function (b) {
                    return productionStatuses.indexOf(b.status) >= 0 && b.status !== 'in_finished_stock';
                });
                var jobCards = [];
                try {
                    jobCards = await dataFunctions.getKernelJobCards(null, forceRefresh) || [];
                } catch (e) { console.warn('[Kernel Production] getKernelJobCards failed:', e); }
                var jobCardByBatchId = {};
                var jobCardByBatchNumber = {};
                jobCards.forEach(function (jc) {
                    if (jc.production_batch_id) jobCardByBatchId[jc.production_batch_id] = { id: jc.id, status: jc.status };
                    if (jc.batch_number) jobCardByBatchNumber[jc.batch_number] = { id: jc.id, status: jc.status };
                });
                var packingSamples = [];
                try {
                    packingSamples = await dataFunctions.getKernelPackingSamples(null, forceRefresh) || [];
                } catch (e) { console.warn('[Kernel Production] getKernelPackingSamples failed:', e); }
                var packingByBatchId = {};
                packingSamples.forEach(function (ps) {
                    if (ps.production_batch_id) packingByBatchId[ps.production_batch_id] = { id: ps.id };
                });
                var daysList = [];
                try {
                    daysList = await dataFunctions.getKernelProductionDaysList(null, forceRefresh) || [];
                } catch (e) { console.warn('[Kernel Production] getKernelProductionDaysList failed:', e); }
                var productionDaysByBatchId = {};
                (Array.isArray(daysList) ? daysList : []).forEach(function (d) {
                    var bid = d.production_batch_id;
                    if (!bid) return;
                    if (!productionDaysByBatchId[bid]) productionDaysByBatchId[bid] = [];
                    productionDaysByBatchId[bid].push({
                        id: d.id,
                        day_number: d.day_number,
                        kernel_production_stages_id: d.kernel_production_stages_id
                    });
                });
                batches.forEach(function (b) {
                    var jc = jobCardByBatchId[b.id] || jobCardByBatchNumber[b.batch_number];
                    b.jobCardId = jc ? jc.id : null;
                    b.hasJobCard = !!(jc && jc.id);
                    var ps = packingByBatchId[b.id];
                    b.packingSampleId = ps ? ps.id : null;
                    b.hasPackingSample = !!(ps && ps.id);
                    b.productionDays = productionDaysByBatchId[b.id] || [];
                    b.productionFinishedAt = b.production_finished_at != null ? b.production_finished_at : (b.productionFinishedAt);
                    b.hasProductionStages = b.productionDays.length > 0;
                });
                const loadTime = performance.now() - startTime;
                console.log(`[Kernel Production] Batches loaded in ${loadTime.toFixed(2)}ms, count: ${batches.length}`);
                this.batches = batches;
                this.filteredBatches = this.batches;
                this.renderBatches();
            } catch (error) {
                console.error('[Kernel Production] Error loading batches:', error);
            }
        },
        renderBatches: function () {
            const tbody = $('#batchesTableBody');
            tbody.empty();
            if (this.filteredBatches.length === 0) {
                if (this.batches.length === 0) {
                    tbody.html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No production batches. Release batches from Grower Intake (complete Receiving checklist and Batch test/sample, then click Release to production).</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            const scope = this;
            this.filteredBatches.forEach(batch => {
                const step = batch.current_step != null ? batch.current_step : 1;
                const productionAndSampleDone = (batch.hasJobCard || batch.hasProductionStages) && batch.hasPackingSample;
                const canReleaseToStock = productionAndSampleDone || batch.status === 'completed' || step >= 17;
                const receivedDate = batch.received_date ? (batch.received_date.toString().split ? batch.received_date.toString().split('T')[0] : batch.received_date) : 'N/A';
                const releaseBtn = canReleaseToStock
                    ? '<button type="button" class="btn btn-sm btn-success me-1 js-release-to-stock" data-batch-id="' + batch.id + '" title="Release batch to Kernel Stock">Release to stock</button>'
                    : '<button type="button" class="btn btn-sm btn-secondary me-1" disabled title="Complete Production and End sample first">Release to stock</button>';
                var productionBtn;
                if (batch.productionFinishedAt) {
                    productionBtn = '<button type="button" class="btn btn-sm btn-success me-1 js-production-batch" data-batch-id="' + batch.id + '" title="View Production (finished)"><span class="d-inline-flex align-items-center justify-content-center me-1 rounded border-2 border-success bg-success text-white" style="width:1.1em;height:1.1em;font-size:0.85em;line-height:1;">&#10003;</span>Production</button>';
                } else {
                    productionBtn = '<button type="button" class="btn btn-sm btn-primary me-1 js-production-batch" data-batch-id="' + batch.id + '" title="Open Production (Add days: Cracking, Washing, Sorting, Packing, Summary)">Production</button>';
                }
                var endSampleBtn;
                if (batch.hasPackingSample && batch.packingSampleId) {
                    endSampleBtn = '<button type="button" class="btn btn-sm btn-success me-1 js-end-sample-batch" data-batch-id="' + batch.id + '" data-packing-sample-id="' + batch.packingSampleId + '" title="View End sample (completed)"><span class="d-inline-flex align-items-center justify-content-center me-1 rounded border-2 border-success bg-success text-white" style="width:1.1em;height:1.1em;font-size:0.85em;line-height:1;">&#10003;</span>End sample</button>';
                } else {
                    endSampleBtn = '<button type="button" class="btn btn-sm btn-outline-primary me-1 js-end-sample-batch" data-batch-id="' + batch.id + '" title="Open End sample form">End sample</button>';
                }
                var jobCardBtn = '';
                if (batch.hasProductionStages) {
                    if (batch.hasJobCard && batch.jobCardId) {
                        jobCardBtn = '<button type="button" class="btn btn-sm btn-success me-1 js-job-card-batch" data-batch-id="' + batch.id + '" data-job-card-id="' + batch.jobCardId + '" title="View/Edit Job Card (completed)"><span class="d-inline-flex align-items-center justify-content-center me-1 rounded border-2 border-success bg-success text-white" style="width:1.1em;height:1.1em;font-size:0.85em;line-height:1;">&#10003;</span>Job Card</button>';
                    } else {
                        jobCardBtn = '<button type="button" class="btn btn-sm btn-outline-primary me-1 js-job-card-batch" data-batch-id="' + batch.id + '" title="Open Job Card (same fields as Kernel Production Job Card)">Job Card</button>';
                    }
                }
                const row = '<tr>' +
                    '<td>' + (batch.batch_number || 'N/A') + '</td>' +
                    '<td>' + (batch.grower_name || 'N/A') + '</td>' +
                    '<td>' + receivedDate + '</td>' +
                    '<td>' + (batch.wet_nis_received_kg || '0') + '</td>' +
                    '<td><span class="badge bg-info">' + (batch.status || 'in_production') + '</span></td>' +
                    '<td>' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary me-1 js-batch-history" data-batch-id="' + batch.id + '" title="View Grower Intake checklist and sample">History</button>' +
                    productionBtn +
                    endSampleBtn +
                    jobCardBtn +
                    releaseBtn +
                    '</td></tr>';
                tbody.append(row);
            });
        },

        /** Step 1–17 map to status; advancing moves batch along kernel journey */
        getNextStepAndStatus: function (currentStep) {
            const step = currentStep != null ? currentStep : 1;
            if (step >= 17) return { nextStep: 17, nextStatus: 'in_finished_stock', stage: 'finished_stock' };
            const nextStep = step + 1;
            const statusMap = { 1: 'receiving', 2: 'cracking', 3: 'drying', 4: 'sorting_dry', 5: 'packing', 6: 'packing', 7: 'packing', 8: 'packing', 9: 'packing', 10: 'packing', 11: 'packing', 12: 'packing', 13: 'packing', 14: 'packing', 15: 'packing', 16: 'packing', 17: 'in_finished_stock' };
            const nextStatus = nextStep >= 17 ? 'in_finished_stock' : (statusMap[nextStep] || 'packing');
            const stage = nextStep >= 17 ? 'finished_stock' : 'production';
            return { nextStep, nextStatus, stage };
        },

        advanceBatchStep: async function (batchId, currentStep) {
            if (!batchId) return;
            const step = currentStep != null ? currentStep : 1;
            if (step >= 17) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Batch already at final step (17).', 'info');
                return;
            }
            const { nextStep, nextStatus, stage } = this.getNextStepAndStatus(step);
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.updateProductionBatch) {
                    Swal.fire('Error', 'Update batch function not available', 'error');
                    return;
                }
                const result = await dataFunctions.updateProductionBatch(batchId, { status: nextStatus, current_step: nextStep, stage: stage });
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Step updated', text: 'Batch moved to step ' + nextStep + ' (' + nextStatus + ')', timer: 2000, showConfirmButton: false });
                    this.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Failed to update batch');
                }
            } catch (e) {
                console.error('[Kernel Production] advanceBatchStep failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to advance step', 'error');
            }
        },

        setJobCardField: function (id, value) {
            var el = document.getElementById(id);
            if (!el) return;
            if (el.type === 'checkbox') {
                el.checked = value === true || value === 'true' || value === 1 || value === '1';
            } else {
                el.value = value != null && value !== '' ? String(value) : '';
            }
        },

        populateJobCardFormFromData: function (jc) {
            var fmtDate = function (v) {
                if (!v) return '';
                var s = typeof v === 'string' ? v : (v.toString && v.toString());
                return s.indexOf('T') >= 0 ? s.split('T')[0] : s;
            };
            this.setJobCardField('jobCardBatchNumber', jc.batch_number);
            this.setJobCardField('jobCardReceivedDate', fmtDate(jc.received_date));
            this.setJobCardField('jobCardSupplierName', jc.supplier_name);
            if (jc.supplier_id != null && jc.supplier_id !== '') this.setJobCardField('jobCardSupplier', jc.supplier_id);
            this.setJobCardField('jobCardTotalWeight', jc.total_weight_kg);
            this.setJobCardField('jobCardRemovedPreSizer', jc.removed_pre_sizer_kg);
            this.setJobCardField('jobCardBalance', jc.balance_kg);
            this.setJobCardField('jobCardReceivingMoisture', jc.receiving_moisture_percentage);
            this.setJobCardField('jobCardPackingMoisture', jc.packing_moisture_percentage);
            this.setJobCardField('jobCardRemovedMoisture', jc.removed_moisture_percentage);
            this.setJobCardField('jobCardPackingStartDate', fmtDate(jc.packing_start_date));
            this.setJobCardField('jobCardPackingCompletionDate', fmtDate(jc.packing_completion_date));
            this.setJobCardField('jobCardBestBeforeDate', fmtDate(jc.best_before_date));
            this.setJobCardField('jobCardWasteOilKernel', jc.waste_oil_kernel_kg);
            this.setJobCardField('jobCardWasteSaltPepper', jc.waste_salt_pepper_kg);
            this.setJobCardField('jobCardWasteShellFines', jc.waste_shell_fines_kg);
            this.setJobCardField('jobCardWasteCompost', jc.waste_compost_kg);
            this.setJobCardField('jobCardWasteShell', jc.waste_shell_kg);
            this.setJobCardField('jobCardMassBalanceIn', jc.mass_balance_in_kg);
            this.setJobCardField('jobCardMassBalanceOut', jc.mass_balance_out_kg);
            this.setJobCardField('jobCardMassBalancePercentage', jc.mass_balance_percentage);
            var sk = jc.sound_kernel_styles;
            if (typeof sk === 'string') { try { sk = JSON.parse(sk); } catch (e) { sk = null; } }
            if (sk && Array.isArray(sk) && sk.length > 0) {
                var tbody = document.getElementById('soundKernelTableBody');
                if (tbody) {
                    tbody.innerHTML = '';
                    sk.forEach(function (row) {
                        var tr = tbody.insertRow(-1);
                        tr.innerHTML = '<td><select class="form-select form-select-sm" name="style"><option value="">Select Style</option><option value="SP">SP</option><option value="0">0</option><option value="1">1</option><option value="1S">1S</option><option value="4L">4L</option><option value="5">5</option><option value="6">6</option></select></td><td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td><td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td><td><button type="button" class="btn btn-sm btn-danger removeSoundKernelRow"><i class="fas fa-times"></i></button></td>';
                        var sel = tr.querySelector('select[name="style"]');
                        var cartons = tr.querySelector('input[name="cartons"]');
                        var weight = tr.querySelector('input[name="weight_kg"]');
                        if (sel && row.style) sel.value = row.style;
                        if (cartons && row.cartons != null) cartons.value = row.cartons;
                        if (weight && row.weight_kg != null) weight.value = row.weight_kg;
                    });
                }
            }
            var bg = jc.butter_grade_styles;
            if (typeof bg === 'string') { try { bg = JSON.parse(bg); } catch (e) { bg = null; } }
            if (bg && Array.isArray(bg) && bg.length > 0) {
                var tbody = document.getElementById('butterGradeTableBody');
                if (tbody) {
                    tbody.innerHTML = '';
                    bg.forEach(function (row) {
                        var tr = tbody.insertRow(-1);
                        tr.innerHTML = '<td><select class="form-select form-select-sm" name="style"><option value="">Select Style</option><option value="7/8">7/8</option><option value="Butter High Oil (Floaters)">Butter High Oil (Floaters)</option><option value="Butter Low Oil (Sinkers)">Butter Low Oil (Sinkers)</option></select></td><td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td><td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td><td><button type="button" class="btn btn-sm btn-danger removeButterGradeRow"><i class="fas fa-times"></i></button></td>';
                        var sel = tr.querySelector('select[name="style"]');
                        var cartons = tr.querySelector('input[name="cartons"]');
                        var weight = tr.querySelector('input[name="weight_kg"]');
                        if (sel && row.style) sel.value = row.style;
                        if (cartons && row.cartons != null) cartons.value = row.cartons;
                        if (weight && row.weight_kg != null) weight.value = row.weight_kg;
                    });
                }
            }
            this.calculateJobCardTotals();
        },

        prefillJobCardFromProductionStages: function (s) {
            if (!s) return;
            var crack = s.cracking_data || {};
            var pack = s.packing_data || {};
            var sum = s.summary_data || {};
            if (crack.date) this.setJobCardField('jobCardReceivedDate', crack.date.toString().split('T')[0]);
            if (crack.grower) this.setJobCardField('jobCardSupplierName', crack.grower);
            if (crack.batch1) this.setJobCardField('jobCardBatchNumber', crack.batch1);
            if (pack.date) this.setJobCardField('jobCardPackingStartDate', pack.date.toString().split('T')[0]);
            if (pack.date) this.setJobCardField('jobCardPackingCompletionDate', pack.date.toString().split('T')[0]);
            var totalQty = sum.pack_total_qty || sum.crack_qty;
            if (totalQty != null && totalQty !== '') this.setJobCardField('jobCardTotalWeight', totalQty);
            this.calculateBalance();
            this.calculateRemovedMoisture();
            this.calculateJobCardTotals();
        },

        showJobCardModalForBatch: async function (batchId) {
            var batch = this.batches.find(function (b) { return b.id === batchId; }) || this.filteredBatches.find(function (b) { return b.id === batchId; });
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            this.clearJobCardForm();
            var jobCardIdEl = document.getElementById('jobCardId');
            if (jobCardIdEl) jobCardIdEl.value = batch.hasJobCard && batch.jobCardId ? batch.jobCardId : '';
            $('#jobCardProductionBatchId').val(batchId);
            $('#jobCardBatchNumber').val(batch.batch_number || '');
            $('#jobCardReceivedDate').val(batch.received_date ? (batch.received_date.toString().split('T')[0]) : '');
            $('#jobCardSupplierName').val(batch.grower_name || '');
            var today = new Date().toISOString().split('T')[0];
            if (!batch.received_date) $('#jobCardReceivedDate').val(today);
            try {
                var contacts = await dataFunctions.getContacts();
                var select = $('#jobCardSupplier');
                var html = '<option value="">Select Supplier</option>';
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach(function (contact) {
                        var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        var selected = batch.supplier_id && contact.id === batch.supplier_id ? ' selected' : '';
                        html += '<option value="' + contact.id + '"' + selected + '>' + name + '</option>';
                    });
                }
                select.html(html);
                if (batch.hasJobCard && batch.jobCardId) {
                    var jc = await dataFunctions.getKernelJobCard(batch.jobCardId);
                    if (jc) this.populateJobCardFormFromData(jc);
                } else if (batch.productionStagesId) {
                    var s = await dataFunctions.getKernelProductionStages(batch.productionStagesId);
                    this.prefillJobCardFromProductionStages(s);
                }
            } catch (e) { console.error(e); }
            var modalElement = document.getElementById('kernelJobCardModal');
            if (modalElement && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalElement).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#kernelJobCardModal').modal('show');
            }
        },

        showJobCardViewModal: async function (jobCardId) {
            var body = document.getElementById('jobCardViewBody');
            if (!body) return;
            body.innerHTML = '<p class="text-muted mb-0">Loading…</p>';
            var modalEl = document.getElementById('jobCardViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#jobCardViewModal').modal('show');
            }
            try {
                var jc = await dataFunctions.getKernelJobCard(jobCardId);
                if (!jc) { body.innerHTML = '<p class="text-muted mb-0">Job card not found.</p>'; return; }
                var fmt = function (v) { return v != null && v !== '' ? v : '—'; };
                var html = '<div class="small">';
                html += '<div class="card mb-2"><div class="card-body py-2"><strong>Batch:</strong> ' + fmt(jc.batch_number) + ' &nbsp; <strong>Received:</strong> ' + fmt(jc.received_date) + ' &nbsp; <strong>Supplier:</strong> ' + fmt(jc.supplier_name) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Receiving</strong></div><div class="card-body py-2">Total weight: ' + fmt(jc.total_weight_kg) + ' kg &nbsp; Removed pre-sizer: ' + fmt(jc.removed_pre_sizer_kg) + ' kg &nbsp; Balance: ' + fmt(jc.balance_kg) + ' kg</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Moisture</strong></div><div class="card-body py-2">Receiving: ' + fmt(jc.receiving_moisture_percentage) + '% &nbsp; Packing: ' + fmt(jc.packing_moisture_percentage) + '% &nbsp; Removed: ' + fmt(jc.removed_moisture_percentage) + '%</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Packing</strong></div><div class="card-body py-2">Start: ' + fmt(jc.packing_start_date) + ' &nbsp; Completion: ' + fmt(jc.packing_completion_date) + ' &nbsp; Best before: ' + fmt(jc.best_before_date) + '</div></div>';
                var sk = jc.sound_kernel_styles;
                if (typeof sk === 'string') { try { sk = JSON.parse(sk); } catch (e) { sk = null; } }
                if (sk && Array.isArray(sk) && sk.length > 0) {
                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sound kernel</strong></div><div class="card-body py-2"><table class="table table-sm table-bordered mb-0"><thead><tr><th>Style</th><th>Cartons</th><th>Weight (kg)</th></tr></thead><tbody>';
                    for (var i = 0; i < sk.length; i++) {
                        var row = sk[i];
                        html += '<tr><td>' + fmt(row.style) + '</td><td>' + fmt(row.cartons) + '</td><td>' + fmt(row.weight_kg) + '</td></tr>';
                    }
                    html += '</tbody></table><div class="mt-1">Total cartons: ' + fmt(jc.sound_kernel_total_cartons) + ' &nbsp; Total kg: ' + fmt(jc.sound_kernel_total_kg) + '</div></div></div>';
                } else {
                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sound kernel</strong></div><div class="card-body py-2">Total cartons: ' + fmt(jc.sound_kernel_total_cartons) + ' &nbsp; Total kg: ' + fmt(jc.sound_kernel_total_kg) + '</div></div>';
                }
                var bg = jc.butter_grade_styles;
                if (typeof bg === 'string') { try { bg = JSON.parse(bg); } catch (e) { bg = null; } }
                if (bg && Array.isArray(bg) && bg.length > 0) {
                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Butter grade</strong></div><div class="card-body py-2"><table class="table table-sm table-bordered mb-0"><thead><tr><th>Style</th><th>Cartons</th><th>Weight (kg)</th></tr></thead><tbody>';
                    for (var j = 0; j < bg.length; j++) {
                        var r = bg[j];
                        html += '<tr><td>' + fmt(r.style) + '</td><td>' + fmt(r.cartons) + '</td><td>' + fmt(r.weight_kg) + '</td></tr>';
                    }
                    html += '</tbody></table><div class="mt-1">Total cartons: ' + fmt(jc.butter_grade_total_cartons) + ' &nbsp; Total kg: ' + fmt(jc.butter_grade_total_kg) + '</div></div></div>';
                } else {
                    html += '<div class="card mb-2"><div class="card-header py-1"><strong>Butter grade</strong></div><div class="card-body py-2">Total cartons: ' + fmt(jc.butter_grade_total_cartons) + ' &nbsp; Total kg: ' + fmt(jc.butter_grade_total_kg) + '</div></div>';
                }
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Waste (kg)</strong></div><div class="card-body py-2">Oil kernel: ' + fmt(jc.waste_oil_kernel_kg) + ' &nbsp; Salt/pepper: ' + fmt(jc.waste_salt_pepper_kg) + ' &nbsp; Shell fines: ' + fmt(jc.waste_shell_fines_kg) + ' &nbsp; Compost: ' + fmt(jc.waste_compost_kg) + ' &nbsp; Shell: ' + fmt(jc.waste_shell_kg) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Mass balance</strong></div><div class="card-body py-2">In: ' + fmt(jc.mass_balance_in_kg) + ' kg &nbsp; Out: ' + fmt(jc.mass_balance_out_kg) + ' kg &nbsp; Balance: ' + fmt(jc.mass_balance_percentage) + '%</div></div>';
                html += '<p class="mb-0"><strong>Status:</strong> ' + fmt(jc.status) + '</p>';
                html += '</div>';
                body.innerHTML = html;
            } catch (e) {
                console.error('[Kernel Production] Error loading job card for view:', e);
                body.innerHTML = '<p class="text-danger mb-0">Could not load job card.</p>';
            }
        },

        /** Compute time spent string from start/end time inputs (HH:mm). Returns e.g. "2h 30m" or "" */
        computeTimeSpent: function (startTimeVal, endTimeVal) {
            if (!startTimeVal || !endTimeVal || typeof startTimeVal !== 'string' || typeof endTimeVal !== 'string') return '';
            var s = startTimeVal.trim().split(':');
            var e = endTimeVal.trim().split(':');
            if (s.length < 2 || e.length < 2) return '';
            var startM = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
            var endM = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
            if (isNaN(startM) || isNaN(endM)) return '';
            var diffM = endM - startM;
            if (diffM < 0) diffM += 24 * 60;
            var h = Math.floor(diffM / 60);
            var m = diffM % 60;
            if (h === 0) return m + 'm';
            if (m === 0) return h + 'h';
            return h + 'h ' + m + 'm';
        },

        /** Parse time-spent string "Xh Ym" or "Xh" or "Ym" to total minutes */
        parseTimeSpentToMinutes: function (str) {
            if (!str || typeof str !== 'string') return 0;
            str = str.trim();
            var total = 0;
            var hMatch = str.match(/(\d+)\s*h/);
            var mMatch = str.match(/(\d+)\s*m/);
            if (hMatch) total += parseInt(hMatch[1], 10) * 60;
            if (mMatch) total += parseInt(mMatch[1], 10);
            return total;
        },

        /** Update Time Spent and Total Time in Cracking section from Start/End times */
        updateCrackTimeSpentRow: function (rowNum) {
            var startEl = document.getElementById('ps_crack_start' + rowNum);
            var endEl = document.getElementById('ps_crack_end' + rowNum);
            var spentEl = document.getElementById('ps_crack_timespent' + rowNum);
            if (!startEl || !endEl || !spentEl) return;
            var spent = this.computeTimeSpent(startEl.value, endEl.value);
            spentEl.value = spent;
            this.updateCrackTotalTime();
        },

        updateCrackTotalTime: function () {
            var spent1El = document.getElementById('ps_crack_timespent1');
            var spent2El = document.getElementById('ps_crack_timespent2');
            var totalEl = document.getElementById('ps_crack_totaltime');
            if (!totalEl) return;
            var m1 = spent1El ? this.parseTimeSpentToMinutes(spent1El.value) : 0;
            var m2 = spent2El ? this.parseTimeSpentToMinutes(spent2El.value) : 0;
            var totalM = m1 + m2;
            var h = Math.floor(totalM / 60);
            var m = totalM % 60;
            if (h === 0 && m === 0) totalEl.value = '';
            else if (h === 0) totalEl.value = m + 'm';
            else if (m === 0) totalEl.value = h + 'h';
            else totalEl.value = h + 'h ' + m + 'm';
        },

        getProductionStagesSectionData: function (prefix) {
            var out = {};
            var sel = document.querySelectorAll('[id^="ps_' + prefix + '_"]');
            for (var i = 0; i < sel.length; i++) {
                var el = sel[i];
                var key = el.id.replace(new RegExp('^ps_' + prefix + '_'), '');
                var val = el.type === 'checkbox' ? el.checked : (el.value || '');
                out[key] = val;
            }
            return out;
        },

        /** Populate one section of the production form from saved data (key = suffix after ps_prefix_) */
        setProductionStagesSectionData: function (prefix, data) {
            if (!data || typeof data !== 'object') return;
            for (var key in data) {
                if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
                var el = document.getElementById('ps_' + prefix + '_' + key);
                if (el) {
                    var v = data[key];
                    if (el.type === 'checkbox') {
                        el.checked = v === true || v === 'true' || v === '1' || v === 1;
                    } else {
                        if (el.tagName === 'SELECT' && v != null && v !== '') {
                            this.ensureSelectHasOption(el, String(v));
                        }
                        el.value = v != null && v !== '' ? String(v) : '';
                    }
                }
            }
        },

        ensureSelectHasOption: function (selectEl, value) {
            if (!selectEl || selectEl.tagName !== 'SELECT' || !value) return;
            var opts = selectEl.options;
            for (var i = 0; i < opts.length; i++) {
                if (opts[i].value === value) return;
            }
            var opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value;
            selectEl.appendChild(opt);
        },

        populateProductionGrowerSelects: async function (selectedGrowerName) {
            var ids = ['ps_crack_grower', 'ps_wash_grower', 'ps_sort_grower', 'ps_pack_grower'];
            var html = '<option value="">Select grower</option>';
            try {
                var contacts = await dataFunctions.getContacts();
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach(function (contact) {
                        var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        if (name) html += '<option value="' + name.replace(/"/g, '&quot;') + '">' + name.replace(/</g, '&lt;') + '</option>';
                    });
                }
            } catch (e) { console.warn('[Kernel Production] getContacts failed:', e); }
            var scope = this;
            ids.forEach(function (id) {
                var el = document.getElementById(id);
                if (el && el.tagName === 'SELECT') {
                    el.innerHTML = html;
                    if (selectedGrowerName) {
                        scope.ensureSelectHasOption(el, selectedGrowerName);
                        el.value = selectedGrowerName;
                    }
                }
            });
        },

        /** Clear all production stages form inputs so switching batches doesn't show previous batch data */
        clearProductionStagesForm: function () {
            var sel = document.querySelectorAll('[id^="ps_"]');
            for (var i = 0; i < sel.length; i++) {
                var el = sel[i];
                if (el.type === 'checkbox') {
                    el.checked = false;
                } else {
                    el.value = '';
                }
            }
        },

        /** Save current form state to localStorage for this batch (draft) so user can exit and come back */
        saveProductionStagesDraftToStorage: function () {
            var batchIdEl = document.getElementById('productionStagesBatchId');
            var batchId = batchIdEl ? batchIdEl.value : null;
            if (!batchId) return;
            var draft = {
                cracking_data: this.getProductionStagesSectionData('crack'),
                washing_data: this.getProductionStagesSectionData('wash'),
                sorting_data: this.getProductionStagesSectionData('sort'),
                packing_data: this.getProductionStagesSectionData('pack'),
                summary_data: this.getProductionStagesSectionData('sum')
            };
            try {
                localStorage.setItem('kernelProduction_draft_' + batchId, JSON.stringify(draft));
            } catch (err) { console.warn('[Kernel Production] Could not save draft to localStorage', err); }
        },

        /** Clear draft for a batch (e.g. after successful save) */
        clearProductionStagesDraft: function (batchId) {
            if (!batchId) return;
            try {
                localStorage.removeItem('kernelProduction_draft_' + batchId);
            } catch (err) {}
        },

        /** Restore draft from localStorage for this batch (overwrites server-loaded data so user sees where they left off) */
        restoreProductionStagesDraft: function (batchId) {
            if (!batchId) return;
            var json = null;
            try {
                json = localStorage.getItem('kernelProduction_draft_' + batchId);
            } catch (err) { return; }
            if (!json) return;
            var draft;
            try {
                draft = JSON.parse(json);
            } catch (e) { return; }
            if (!draft || typeof draft !== 'object') return;
            if (draft.cracking_data) this.setProductionStagesSectionData('crack', draft.cracking_data);
            if (draft.washing_data) this.setProductionStagesSectionData('wash', draft.washing_data);
            if (draft.sorting_data) this.setProductionStagesSectionData('sort', draft.sorting_data);
            if (draft.packing_data) this.setProductionStagesSectionData('pack', draft.packing_data);
            if (draft.summary_data) this.setProductionStagesSectionData('sum', draft.summary_data);
        },

        showProductionStagesModalForBatch: async function (batchId) {
            var batch = this.batches.find(function (b) { return b.id === batchId; }) || this.filteredBatches.find(function (b) { return b.id === batchId; });
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            var batchIdEl = document.getElementById('productionStagesBatchId');
            if (batchIdEl) batchIdEl.value = batchId;
            var dayIdEl = document.getElementById('productionStagesDayId');
            if (dayIdEl) dayIdEl.value = '';
            this.clearProductionStagesForm();
            var dateVal = batch.received_date ? (batch.received_date.toString().split('T')[0]) : (new Date().toISOString().split('T')[0]);
            var growerVal = batch.grower_name || '';
            var batchNumVal = batch.batch_number || '';
            var crackDate = document.getElementById('ps_crack_date');
            if (crackDate) crackDate.value = dateVal;
            await this.populateProductionGrowerSelects(growerVal);
            var crackBatch1 = document.getElementById('ps_crack_batch1');
            if (crackBatch1) crackBatch1.value = batchNumVal;
            var days = batch.productionDays && batch.productionDays.length ? batch.productionDays : [];
            try {
                if (days.length === 0) {
                    var raw = await dataFunctions.getKernelProductionDays(batchId);
                    days = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
                }
            } catch (e) { console.warn('[Kernel Production] getKernelProductionDays failed:', e); }
            this.modalProductionDays = days;
            this.renderProductionDaysList(days);
            this.setProductionStagesTabsVisibility(days.length > 0);
            if (days.length > 0) {
                var first = days[0];
                var firstDayId = first.id || first.kernel_production_day_id;
                if (dayIdEl) dayIdEl.value = firstDayId || '';
                await this.loadProductionStagesForDay(firstDayId, first.kernel_production_stages_id);
                this.setProductionDayActive(firstDayId);
                this.updateProductionActionButtonTicks();
            }
            this.restoreProductionStagesDraft(batchId);
            var modalEl = document.getElementById('productionStagesModal');
            var doRestoreTab = function () {
                var savedTab = null;
                try { savedTab = localStorage.getItem('kernelProduction_lastTab_' + batchId); } catch (err) {}
                var tabNames = ['cracking', 'washing', 'sorting', 'packing', 'summary'];
                if (savedTab && tabNames.indexOf(savedTab) !== -1) {
                    var tabBtn = document.getElementById('tab-' + savedTab);
                    if (tabBtn && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
                        bootstrap.Tab.getOrCreateInstance(tabBtn).show();
                    }
                }
            };
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                var onceShown = function () {
                    modalEl.removeEventListener('shown.bs.modal', onceShown);
                    doRestoreTab();
                };
                modalEl.addEventListener('shown.bs.modal', onceShown);
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#productionStagesModal').one('shown.bs.modal', doRestoreTab);
                $('#productionStagesModal').modal('show');
            } else {
                doRestoreTab();
            }
        },

        setProductionStagesTabsVisibility: function (visible) {
            var el = document.getElementById('productionStagesTabsContainer');
            if (el) el.style.display = visible ? '' : 'none';
            if (visible) this.showProductionActionSelector();
        },

        /** Map action (crack/wash/sort/pack/sum) to section key and pane id */
        productionActionMap: {
            crack: { section: 'crack', paneId: 'pane-cracking', dataKey: 'cracking_data' },
            wash: { section: 'wash', paneId: 'pane-washing', dataKey: 'washing_data' },
            sort: { section: 'sort', paneId: 'pane-sorting', dataKey: 'sorting_data' },
            pack: { section: 'pack', paneId: 'pane-packing', dataKey: 'packing_data' },
            sum: { section: 'sum', paneId: 'pane-summary', dataKey: 'summary_data' }
        },

        showProductionActionSelector: function () {
            if (this.currentProductionAction) {
                var prev = this.productionActionMap[this.currentProductionAction];
                if (prev && this.modalProductionDayStages) {
                    this.modalProductionDayStages[prev.dataKey] = this.getProductionStagesSectionData(prev.section);
                }
            }
            this.currentProductionAction = null;
            var sel = document.getElementById('productionStagesActionSelector');
            var tabsWrap = document.getElementById('productionStagesTabsWrap');
            var recAnother = document.getElementById('productionStagesRecordAnotherWrap');
            var singleSave = document.getElementById('productionStagesSingleSaveWrap');
            var summarySaveRow = document.getElementById('summaryPaneSaveRow');
            if (sel) sel.style.display = '';
            if (tabsWrap) tabsWrap.style.display = 'none';
            if (recAnother) recAnother.style.display = 'none';
            if (singleSave) singleSave.style.display = 'none';
            if (summarySaveRow) summarySaveRow.style.display = '';
            ['pane-cracking', 'pane-washing', 'pane-sorting', 'pane-packing', 'pane-summary'].forEach(function (id) {
                var p = document.getElementById(id);
                if (p) { p.style.display = 'none'; p.classList.remove('show', 'active'); }
            });
            this.updateProductionActionButtonTicks();
        },

        updateProductionActionButtonTicks: function () {
            var stages = this.modalProductionDayStages || {};
            var map = this.productionActionMap;
            Object.keys(map).forEach(function (action) {
                var dataKey = map[action].dataKey;
                var data = stages[dataKey];
                var hasData = data && typeof data === 'object' && Object.keys(data).length > 0;
                var btn = document.querySelector('.production-action-btn[data-action="' + action + '"]');
                if (!btn) return;
                var label = btn.textContent.replace(/\s*✓\s*$/, '').trim();
                if (action === 'crack') label = 'Cracking';
                else if (action === 'wash') label = 'Washing';
                else if (action === 'sort') label = 'Sorting';
                else if (action === 'pack') label = 'Packing';
                else if (action === 'sum') label = 'Summary';
                btn.textContent = hasData ? label + ' ✓' : label;
            });
        },

        chooseProductionAction: function (action) {
            var map = this.productionActionMap[action];
            if (!map) return;
            if (this.currentProductionAction) {
                var prev = this.productionActionMap[this.currentProductionAction];
                if (prev && this.modalProductionDayStages) {
                    this.modalProductionDayStages[prev.dataKey] = this.getProductionStagesSectionData(prev.section);
                }
            }
            this.currentProductionAction = action;
            this.modalProductionDayStages = this.modalProductionDayStages || {};
            this.setProductionStagesSectionData(map.section, this.modalProductionDayStages[map.dataKey] || {});
            var sel = document.getElementById('productionStagesActionSelector');
            var tabsWrap = document.getElementById('productionStagesTabsWrap');
            var recAnother = document.getElementById('productionStagesRecordAnotherWrap');
            var singleSave = document.getElementById('productionStagesSingleSaveWrap');
            var tabsEl = document.getElementById('productionStagesTabs');
            var summarySaveRow = document.getElementById('summaryPaneSaveRow');
            if (sel) sel.style.display = 'none';
            if (tabsWrap) tabsWrap.style.display = '';
            if (tabsEl) tabsEl.style.display = 'none';
            if (recAnother) recAnother.style.display = '';
            if (singleSave) singleSave.style.display = '';
            if (summarySaveRow) summarySaveRow.style.display = 'none';
            ['pane-cracking', 'pane-washing', 'pane-sorting', 'pane-packing', 'pane-summary'].forEach(function (id) {
                var p = document.getElementById(id);
                if (p) {
                    p.style.display = (id === map.paneId) ? '' : 'none';
                    if (id === map.paneId) p.classList.add('show', 'active');
                    else p.classList.remove('show', 'active');
                }
            });
        },

        renderProductionDaysList: function (days) {
            var container = document.getElementById('productionStagesDayList');
            if (!container) return;
            container.innerHTML = '';
            (days || []).forEach(function (d, idx) {
                var dayId = d.id || d.kernel_production_day_id;
                var num = d.day_number != null ? d.day_number : (idx + 1);
                if (!dayId) return;
                var btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'btn btn-sm btn-outline-secondary';
                btn.setAttribute('data-day-id', dayId);
                btn.setAttribute('data-day-saved', d.kernel_production_stages_id ? '1' : '0');
                if (d.kernel_production_stages_id) {
                    btn.innerHTML = 'Day ' + num + ' <span class="text-success ms-1" aria-hidden="true">&#10003;</span>';
                } else {
                    btn.textContent = 'Day ' + num;
                }
                container.appendChild(btn);
            });
        },

        setProductionDayActive: function (dayId) {
            var container = document.getElementById('productionStagesDayList');
            if (!container) return;
            container.querySelectorAll('[data-day-id]').forEach(function (btn) {
                var isActive = btn.getAttribute('data-day-id') === dayId;
                var isSaved = btn.getAttribute('data-day-saved') === '1';
                btn.classList.remove('btn-primary', 'btn-outline-secondary', 'btn-outline-success');
                if (isActive) {
                    btn.classList.add('btn-primary');
                } else if (isSaved) {
                    btn.classList.add('btn-outline-success');
                } else {
                    btn.classList.add('btn-outline-secondary');
                }
            });
        },

        loadProductionStagesForDay: async function (dayId, stagesId) {
            if (!dayId && !stagesId) return;
            var s = null;
            try {
                if (stagesId) s = await dataFunctions.getKernelProductionStages(stagesId);
                else if (dayId) s = await dataFunctions.getKernelProductionStagesByDay(dayId);
            } catch (e) { console.warn('[Kernel Production] load stages failed:', e); }
            this.modalProductionDayStages = {
                cracking_data: (s && s.cracking_data) ? s.cracking_data : {},
                washing_data: (s && s.washing_data) ? s.washing_data : {},
                sorting_data: (s && s.sorting_data) ? s.sorting_data : {},
                packing_data: (s && s.packing_data) ? s.packing_data : {},
                summary_data: (s && s.summary_data) ? s.summary_data : {}
            };
            if (s) {
                this.setProductionStagesSectionData('crack', s.cracking_data);
                this.setProductionStagesSectionData('wash', s.washing_data);
                this.setProductionStagesSectionData('sort', s.sorting_data);
                this.setProductionStagesSectionData('pack', s.packing_data);
                this.setProductionStagesSectionData('sum', s.summary_data);
            } else {
                this.clearProductionStagesForm();
            }
        },

        selectProductionDay: async function (dayId) {
            var dayIdEl = document.getElementById('productionStagesDayId');
            if (dayIdEl) dayIdEl.value = dayId || '';
            var days = this.modalProductionDays || [];
            var day = days.find(function (d) { return (d.id || d.kernel_production_day_id) === dayId; });
            await this.loadProductionStagesForDay(dayId, day && day.kernel_production_stages_id);
            this.setProductionDayActive(dayId);
            this.showProductionActionSelector();
        },

        addProductionDay: async function () {
            var batchIdEl = document.getElementById('productionStagesBatchId');
            var batchId = batchIdEl ? batchIdEl.value : null;
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
                return;
            }
            try {
                var result = await dataFunctions.createKernelProductionDay(batchId);
                var inner = (result && result.create_kernel_production_day) ? result.create_kernel_production_day : result;
                if (!inner || inner.success === false) {
                    throw new Error(inner && inner.error ? inner.error : 'Failed to create day');
                }
                var newDayId = inner.id;
                var dayNum = inner.day_number != null ? inner.day_number : ((this.modalProductionDays || []).length + 1);
                this.modalProductionDays = this.modalProductionDays || [];
                this.modalProductionDays.push({ id: newDayId, day_number: dayNum, kernel_production_stages_id: null });
                this.renderProductionDaysList(this.modalProductionDays);
                var dayIdEl = document.getElementById('productionStagesDayId');
                if (dayIdEl) dayIdEl.value = newDayId;
                this.clearProductionStagesForm();
                this.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
                this.setProductionStagesTabsVisibility(true);
                this.setProductionDayActive(newDayId);
            } catch (e) {
                console.error('[Kernel Production] addProductionDay failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to add day', 'error');
            }
        },

        showBatchSummary: async function () {
            var batchIdEl = document.getElementById('productionStagesBatchId');
            var batchId = batchIdEl ? batchIdEl.value : null;
            if (!batchId) return;
            var body = document.getElementById('batchSummaryBody');
            if (!body) return;
            body.innerHTML = '<p class="text-muted mb-0">Loading…</p>';
            var modalEl = document.getElementById('batchSummaryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#batchSummaryModal').modal('show');
            }
            var days = this.modalProductionDays || [];
            try {
                if (days.length === 0) {
                    var raw = await dataFunctions.getKernelProductionDays(batchId);
                    days = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
                }
            } catch (e) {}
            if (days.length === 0) {
                body.innerHTML = '<p class="text-muted mb-0">No production days to summarize. Add days and save data first.</p>';
                return;
            }
            var allStages = [];
            for (var i = 0; i < days.length; i++) {
                var d = days[i];
                var s = d.kernel_production_stages_id
                    ? await dataFunctions.getKernelProductionStages(d.kernel_production_stages_id)
                    : await dataFunctions.getKernelProductionStagesByDay(d.id || d.kernel_production_day_id);
                if (s) allStages.push(s);
            }
            var agg = this.aggregateProductionStages(allStages);
            body.innerHTML = this.renderBatchSummaryHtml(agg, days.length);
        },

        aggregateProductionStages: function (stagesList) {
            var sum = function (obj) {
                if (obj == null || typeof obj !== 'object') return obj;
                var out = {};
                for (var key in obj) {
                    var v = obj[key];
                    if (typeof v === 'number' && !isNaN(v)) out[key] = v;
                }
                return out;
            };
            var add = function (acc, obj) {
                if (!obj || typeof obj !== 'object') return;
                for (var key in obj) {
                    var v = obj[key];
                    if (typeof v === 'number' && !isNaN(v)) {
                        acc[key] = (acc[key] || 0) + v;
                    }
                }
            };
            var sections = ['cracking_data', 'washing_data', 'sorting_data', 'packing_data', 'summary_data'];
            var agg = {};
            sections.forEach(function (sec) {
                agg[sec] = {};
            });
            (stagesList || []).forEach(function (s) {
                sections.forEach(function (sec) {
                    var data = s[sec];
                    if (data && typeof data === 'object') add(agg[sec], data);
                });
            });
            return agg;
        },

        renderBatchSummaryHtml: function (agg, dayCount) {
            var fmt = function (v) { return v != null && typeof v === 'number' ? v.toFixed(2) : (v != null ? String(v) : '—'); };
            var rows = [];
            var pushRow = function (label, val) { rows.push('<tr><td>' + label + '</td><td>' + fmt(val) + '</td></tr>'); };
            rows.push('<p class="text-muted small">Totals across ' + dayCount + ' day(s).</p>');
            rows.push('<table class="table table-sm table-bordered"><thead><tr><th>Field</th><th>Total</th></tr></thead><tbody>');
            var sections = [
                ['cracking_data', 'Cracking'],
                ['washing_data', 'Washing'],
                ['sorting_data', 'Sorting'],
                ['packing_data', 'Packing'],
                ['summary_data', 'Summary']
            ];
            sections.forEach(function (pair) {
                var sec = pair[0], name = pair[1];
                var data = agg[sec];
                if (data && typeof data === 'object') {
                    rows.push('<tr><td colspan="2" class="fw-bold">' + name + '</td></tr>');
                    for (var k in data) rows.push('<tr><td class="ps-3">' + k + '</td><td>' + fmt(data[k]) + '</td></tr>');
                }
            });
            rows.push('</tbody></table>');
            return rows.join('');
        },

        finishBatchProduction: async function () {
            var batchIdEl = document.getElementById('productionStagesBatchId');
            var batchId = batchIdEl ? batchIdEl.value : null;
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
                return;
            }
            var scope = this;
            if (typeof Swal !== 'undefined') {
                var confirmResult = await Swal.fire({
                    title: 'Finish batch production?',
                    text: 'This will mark the batch production as complete and show the tick on the Production button.',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonText: 'Finish'
                });
                if (!confirmResult.isConfirmed) return;
            }
            try {
                var result = await dataFunctions.finishKernelBatchProduction(batchId);
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire('Saved', 'Batch production marked as finished.', 'success');
                    var modalEl = document.getElementById('productionStagesModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#productionStagesModal').modal('hide');
                    }
                    scope.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Failed to finish');
                }
            } catch (e) {
                console.error('[Kernel Production] finishBatchProduction failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to finish batch production', 'error');
            }
        },

        saveProductionStages: async function () {
            var batchIdEl = document.getElementById('productionStagesBatchId');
            var batchId = batchIdEl ? batchIdEl.value : null;
            var dayIdEl = document.getElementById('productionStagesDayId');
            var dayId = dayIdEl ? dayIdEl.value : null;
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
                return;
            }
            if (!dayId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Select or add a day first, then save.', 'error');
                return;
            }
            var batch = this.batches.find(function (b) { return String(b.id) === String(batchId); }) || this.filteredBatches.find(function (b) { return String(b.id) === String(batchId); });
            var batchNumber = batch ? (batch.batch_number || '') : '';
            var growerName = batch ? (batch.grower_name || '') : '';
            var cracking_data, washing_data, sorting_data, packing_data, summary_data;
            if (this.currentProductionAction) {
                var stages = this.modalProductionDayStages || {};
                var cur = this.productionActionMap[this.currentProductionAction];
                cracking_data = (cur && cur.dataKey === 'cracking_data') ? this.getProductionStagesSectionData('crack') : (stages.cracking_data || {});
                washing_data = (cur && cur.dataKey === 'washing_data') ? this.getProductionStagesSectionData('wash') : (stages.washing_data || {});
                sorting_data = (cur && cur.dataKey === 'sorting_data') ? this.getProductionStagesSectionData('sort') : (stages.sorting_data || {});
                packing_data = (cur && cur.dataKey === 'packing_data') ? this.getProductionStagesSectionData('pack') : (stages.packing_data || {});
                summary_data = (cur && cur.dataKey === 'summary_data') ? this.getProductionStagesSectionData('sum') : (stages.summary_data || {});
            } else {
                cracking_data = this.getProductionStagesSectionData('crack');
                washing_data = this.getProductionStagesSectionData('wash');
                sorting_data = this.getProductionStagesSectionData('sort');
                packing_data = this.getProductionStagesSectionData('pack');
                summary_data = this.getProductionStagesSectionData('sum');
            }
            var payload = {
                kernel_production_day_id: dayId,
                batch_number: batchNumber,
                grower_name: growerName,
                cracking_data: cracking_data,
                washing_data: washing_data,
                sorting_data: sorting_data,
                packing_data: packing_data,
                summary_data: summary_data
            };
            try {
                await dataFunctions.saveKernelProductionStages(payload);
                this.modalProductionDayStages = {
                    cracking_data: cracking_data,
                    washing_data: washing_data,
                    sorting_data: sorting_data,
                    packing_data: packing_data,
                    summary_data: summary_data
                };
                this.updateProductionActionButtonTicks();
                this.clearProductionStagesDraft(batchId);
                if (typeof Swal !== 'undefined') Swal.fire('Saved', 'Production stages saved for this day.', 'success');
                var days = [];
                try {
                    var raw = await dataFunctions.getKernelProductionDays(batchId);
                    days = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
                } catch (err) {}
                this.modalProductionDays = days;
                this.renderProductionDaysList(days);
                this.setProductionDayActive(dayId);
            } catch (e) {
                console.error('[Kernel Production] saveProductionStages failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save production stages', 'error');
            }
        },

        showProductionStagesViewModal: async function (stagesId) {
            var body = document.getElementById('productionStagesViewBody');
            if (!body) return;
            body.innerHTML = '<p class="text-muted mb-0">Loading…</p>';
            var modalEl = document.getElementById('productionStagesViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#productionStagesViewModal').modal('show');
            }
            try {
                var s = await dataFunctions.getKernelProductionStages(stagesId);
                if (!s) { body.innerHTML = '<p class="text-muted mb-0">Production record not found.</p>'; return; }
                var fmt = function (v) { return v != null && v !== '' ? String(v) : '—'; };
                var renderSection = function (title, data) {
                    if (!data || typeof data !== 'object') return '<p class="text-muted mb-0">No data</p>';
                    var rows = [];
                    for (var k in data) { if (data.hasOwnProperty(k)) rows.push('<tr><td class="text-nowrap">' + k + '</td><td>' + fmt(data[k]) + '</td></tr>'); }
                    if (rows.length === 0) return '<p class="text-muted mb-0">No data</p>';
                    return '<table class="table table-sm table-bordered mb-2"><tbody>' + rows.join('') + '</tbody></table>';
                };
                var html = '<div class="small">';
                html += '<p class="mb-2"><strong>Batch:</strong> ' + fmt(s.batch_number) + ' &nbsp; <strong>Grower:</strong> ' + fmt(s.grower_name) + '</p>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Cracking</strong></div><div class="card-body py-2">' + renderSection('Cracking', s.cracking_data) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Washing</strong></div><div class="card-body py-2">' + renderSection('Washing', s.washing_data) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sorting</strong></div><div class="card-body py-2">' + renderSection('Sorting', s.sorting_data) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Packing</strong></div><div class="card-body py-2">' + renderSection('Packing', s.packing_data) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Summary</strong></div><div class="card-body py-2">' + renderSection('Summary', s.summary_data) + '</div></div>';
                html += '</div>';
                body.innerHTML = html;
            } catch (e) {
                console.error('[Kernel Production] Error loading production stages for view:', e);
                body.innerHTML = '<p class="text-danger mb-0">Could not load production record.</p>';
            }
        },

        showEndSampleModal: function (batchId) {
            var batchIdEl = document.getElementById('endSampleProductionBatchId');
            if (batchIdEl) batchIdEl.value = batchId || '';
            document.getElementById('endSampleMoistureRequired').checked = false;
            document.getElementById('endSampleMoistureResult').value = '';
            document.getElementById('endSamplePeroxideRequired').checked = false;
            document.getElementById('endSamplePeroxideResult').value = '';
            document.getElementById('endSampleFfaRequired').checked = false;
            document.getElementById('endSampleFfaResult').value = '';
            document.getElementById('endSampleInternalMicroRequired').checked = false;
            document.getElementById('endSampleInternalMicroResult').value = '';
            document.getElementById('endSampleExternalLabRequired').checked = false;
            document.getElementById('endSampleExternalLabResult').value = '';
            document.getElementById('endSampleSupervisorSigned').value = '';
            document.getElementById('endSampleNutPlantManagerSigned').value = '';
            var modalEl = document.getElementById('endSampleModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#endSampleModal').modal('show');
            }
        },

        saveEndSample: async function () {
            var batchIdEl = document.getElementById('endSampleProductionBatchId');
            var batchId = batchIdEl && batchIdEl.value ? batchIdEl.value.trim() : null;
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            var data = {
                production_batch_id: batchId,
                moisture_required: document.getElementById('endSampleMoistureRequired').checked,
                moisture_result: document.getElementById('endSampleMoistureResult').value ? parseFloat(document.getElementById('endSampleMoistureResult').value) : null,
                peroxide_required: document.getElementById('endSamplePeroxideRequired').checked,
                peroxide_result: document.getElementById('endSamplePeroxideResult').value ? parseFloat(document.getElementById('endSamplePeroxideResult').value) : null,
                ffa_required: document.getElementById('endSampleFfaRequired').checked,
                ffa_result: document.getElementById('endSampleFfaResult').value ? parseFloat(document.getElementById('endSampleFfaResult').value) : null,
                internal_micro_required: document.getElementById('endSampleInternalMicroRequired').checked,
                internal_micro_result: document.getElementById('endSampleInternalMicroResult').value || null,
                external_lab_required: document.getElementById('endSampleExternalLabRequired').checked,
                external_lab_result: document.getElementById('endSampleExternalLabResult').value || null,
                supervisor_signed_by: document.getElementById('endSampleSupervisorSigned').value || null,
                nut_plant_manager_signed_by: document.getElementById('endSampleNutPlantManagerSigned').value || null
            };
            try {
                var result = await dataFunctions.createKernelPackingSample(data);
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Saved', text: 'End sample saved.', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('endSampleModal');
                    if (modalEl && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#endSampleModal').modal('hide');
                    this.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Save failed');
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save end sample', 'error');
            }
        },

        showEndSampleViewModal: async function (packingSampleId) {
            var body = document.getElementById('endSampleViewBody');
            if (!body) return;
            body.innerHTML = '<p class="text-muted mb-0">Loading…</p>';
            var modalEl = document.getElementById('endSampleViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#endSampleViewModal').modal('show');
            }
            try {
                var ps = await dataFunctions.getKernelPackingSample(packingSampleId);
                if (!ps || !ps.id) {
                    body.innerHTML = '<p class="text-muted mb-0">End sample not found.</p>';
                    return;
                }
                var fmt = function (v) { return v != null && v !== '' ? v : '—'; };
                var tick = function (b) { return b ? '&#10003;' : '—'; };
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
                body.innerHTML = html;
            } catch (e) {
                console.error('[Kernel Production] Error loading end sample for view:', e);
                body.innerHTML = '<p class="text-danger mb-0">Could not load end sample.</p>';
            }
        },

        releaseBatchToStock: async function (batchId) {
            if (!batchId) return;
            try {
                const result = await dataFunctions.updateProductionBatch(batchId, { status: 'in_finished_stock', stage: 'finished_stock' });
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released', text: 'Batch is now in Kernel Stock.', timer: 2000, showConfirmButton: false });
                    this.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release to stock', 'error');
            }
        },

        showBatchHistory: async function (batchId) {
            const batch = this.batches.find(function (b) { return b.id === batchId; }) || this.filteredBatches.find(function (b) { return b.id === batchId; });
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            const checklistId = batch.receiving_checklist_id || batch.receivingChecklistId;
            const sampleId = batch.sample_submission_id || batch.sampleSubmissionId;
            const batchInfo = (batch.batch_number || 'Batch') + (batch.grower_name ? ' — ' + batch.grower_name : '');
            $('#batchHistoryModalLabel').text('Grower Intake history');
            document.getElementById('batchHistoryBatchInfo').textContent = 'Batch: ' + batchInfo;
            $('#batchHistoryChecklistBody').html('<p class="text-muted mb-0">Loading…</p>');
            $('#batchHistorySampleBody').html('<p class="text-muted mb-0">Loading…</p>');
            const modalEl = document.getElementById('batchHistoryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#batchHistoryModal').modal('show');
            }
            try {
                if (checklistId && typeof dataFunctions !== 'undefined' && dataFunctions.getReceivingChecklist) {
                    const raw = await dataFunctions.getReceivingChecklist(checklistId);
                    const payload = (raw && (raw.checklist || raw.received_items !== undefined)) ? raw : (raw && raw.data) ? raw.data : raw;
                    if (payload && payload.checklist) {
                        const c = payload.checklist;
                        const items = payload.received_items || [];
                        let html = '<div class="small">';
                        html += '<p class="mb-1"><strong>Date received:</strong> ' + (c.date_received || '—') + '</p>';
                        html += '<p class="mb-1"><strong>Delivery note ref:</strong> ' + (c.delivery_note_ref || '—') + '</p>';
                        html += '<p class="mb-1"><strong>Vehicle clean:</strong> ' + (c.vehicle_clean || '—') + ' &nbsp; <strong>Enclosed:</strong> ' + (c.vehicle_enclosed || '—') + '</p>';
                        html += '<p class="mb-1"><strong>Pallets condition:</strong> ' + (c.pallets_condition || '—') + ' &nbsp; <strong>Raw materials:</strong> ' + (c.raw_materials_condition || '—') + '</p>';
                        if (c.comments) html += '<p class="mb-2"><strong>Comments:</strong> ' + (c.comments || '—') + '</p>';
                        if (items.length > 0) {
                            html += '<table class="table table-sm table-bordered mt-2"><thead><tr><th>Reference</th><th>Description</th><th>Batch</th><th>Qty (kg)</th><th>Best before</th></tr></thead><tbody>';
                            items.forEach(function (it) {
                                html += '<tr><td>' + (it.reference || '—') + '</td><td>' + (it.description || '—') + '</td><td>' + (it.batch || '—') + '</td><td>' + (it.quantity_kg != null ? it.quantity_kg : '—') + '</td><td>' + (it.best_before_date || '—') + '</td></tr>';
                            });
                            html += '</tbody></table>';
                        }
                        html += '</div>';
                        $('#batchHistoryChecklistBody').html(html);
                    } else {
                        $('#batchHistoryChecklistBody').html('<p class="text-muted mb-0">No checklist data available.</p>');
                    }
                } else {
                    $('#batchHistoryChecklistBody').html('<p class="text-muted mb-0">No receiving checklist linked to this batch.</p>');
                }
            } catch (e) {
                console.error('[Kernel Production] Error loading checklist for history:', e);
                $('#batchHistoryChecklistBody').html('<p class="text-danger mb-0">Could not load checklist.</p>');
            }
            try {
                if (sampleId && typeof dataFunctions !== 'undefined' && dataFunctions.getSampleSubmissions) {
                    const samples = await dataFunctions.getSampleSubmissions(null, true);
                    const sample = (samples || []).find(function (s) { return s.id === sampleId; });
                    if (sample) {
                        let html = '<div class="small">';
                        html += '<p class="mb-1"><strong>Submission:</strong> ' + (sample.submission_number || '—') + '</p>';
                        html += '<p class="mb-1"><strong>Grower:</strong> ' + (sample.grower_name || '—') + '</p>';
                        html += '<p class="mb-1"><strong>Delivery date:</strong> ' + (sample.delivery_date || '—') + '</p>';
                        html += '<p class="mb-1"><strong>Wet NIS (kg):</strong> ' + (sample.wet_nut_in_shell_kg != null ? sample.wet_nut_in_shell_kg : '—') + '</p>';
                        html += '<p class="mb-1"><strong>Moisture %:</strong> ' + (sample.moisture_content_percentage != null ? sample.moisture_content_percentage : '—') + '</p>';
                        html += '<p class="mb-0"><strong>Status:</strong> ' + (sample.status || '—') + '</p>';
                        html += '</div>';
                        $('#batchHistorySampleBody').html(html);
                    } else {
                        $('#batchHistorySampleBody').html('<p class="text-muted mb-0">Sample not found.</p>');
                    }
                } else {
                    $('#batchHistorySampleBody').html('<p class="text-muted mb-0">No sample linked to this batch.</p>');
                }
            } catch (e) {
                console.error('[Kernel Production] Error loading sample for history:', e);
                $('#batchHistorySampleBody').html('<p class="text-danger mb-0">Could not load sample.</p>');
            }
        },

        viewBatch: function (batchId) {
            Swal.fire('Info', 'Batch details view coming soon', 'info');
        },
        
        exportBatches: function () {
            if (!this.batches || this.batches.length === 0) {
                Swal.fire('Info', 'No batches to export', 'info');
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
                exportUtils.exportToCSV(this.batches, 'production_batches', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        },
        
        showNewBatchModal: async function () {
            try {
                console.log('[Kernel Production] Opening new batch modal');
                $('#newBatchModalLabel').text('New Production Batch');
                $('#batchId').val('');
                this.clearNewBatchForm();
                
                // Set default date to today
                const today = new Date().toISOString().split('T')[0];
                $('#batchReceivedDate').val(today);
                
                // Load suppliers
                try {
                    const contacts = await dataFunctions.getContacts();
                    const select = $('#batchSupplier');
                    let html = '<option value="">Select Supplier</option>';
                    if (contacts && Array.isArray(contacts)) {
                        contacts.forEach(contact => {
                            const name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                            html += `<option value="${contact.id}">${name}</option>`;
                        });
                    }
                    select.html(html);
                } catch (error) {
                    console.error('Error loading suppliers:', error);
                }
                
                // Generate suggested batch number
                const year = new Date().getFullYear();
                const month = String(new Date().getMonth() + 1).padStart(2, '0');
                const suggestedBatch = `BATCH-${year}-${month}-001`;
                $('#batchNumber').val(suggestedBatch);
                
                // Use Bootstrap 5 modal API with fallback
                const modalElement = document.getElementById('newBatchModal');
                if (!modalElement) {
                    console.error('[Kernel Production] New batch modal element not found!');
                    Swal.fire('Error', 'Modal not found. Please refresh the page.', 'error');
                    return;
                }
                
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    const modal = new bootstrap.Modal(modalElement);
                    modal.show();
                    console.log('[Kernel Production] New batch modal shown via Bootstrap 5');
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#newBatchModal').modal('show');
                    console.log('[Kernel Production] New batch modal shown via jQuery');
                } else {
                    console.error('[Kernel Production] Neither Bootstrap nor jQuery modal available!');
                    Swal.fire('Error', 'Unable to open modal. Please ensure Bootstrap is loaded.', 'error');
                }
            } catch (error) {
                console.error('[Kernel Production] Error showing new batch modal:', error);
                Swal.fire('Error', 'Failed to open new batch form: ' + error.message, 'error');
            }
        },
        
        clearNewBatchForm: function () {
            const form = document.getElementById('newBatchForm');
            if (form) form.reset();
            
            const batchId = document.getElementById('batchId');
            if (batchId) batchId.value = '';
        },
        
        saveNewBatch: async function () {
            try {
                console.log('[Kernel Production] Saving new batch...');
                const form = document.getElementById('newBatchForm');
                if (!form) {
                    Swal.fire('Error', 'Form not found', 'error');
                    return;
                }
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                
                const getValue = (id) => {
                    const el = document.getElementById(id);
                    return el ? el.value : null;
                };
                
                const getFloatValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.value ? parseFloat(el.value) : null;
                };
                
                const batchData = {
                    p_batch_number: getValue('batchNumber'),
                    p_received_date: getValue('batchReceivedDate'),
                    p_wet_nis_received_kg: getFloatValue('batchWetNIS'),
                    p_supplier_id: getValue('batchSupplier') || null,
                    p_grower_name: getValue('batchGrowerName') || null,
                    p_receiving_moisture_percentage: getFloatValue('batchReceivingMoisture') || null,
                    p_start_date: getValue('batchStartDate') || null,
                    p_estimated_completion_date: getValue('batchEstimatedCompletion') || null,
                    p_batch_type: 'kernel',
                    p_status: 'receiving',
                    p_current_step: 1
                };
                
                console.log('[Kernel Production] Batch data:', batchData);
                
                if (typeof dataFunctions === 'undefined' || !dataFunctions.createProductionBatch) {
                    Swal.fire('Error', 'Batch creation function not available', 'error');
                    return;
                }
                
                const result = await dataFunctions.createProductionBatch(batchData);
                console.log('[Kernel Production] Save result:', result);
                
                if (result && result.success !== false) {
                    // Invalidate caches
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('production_batches');
                    }
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: 'Production batch created successfully',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    // Close modal
                    const modalElement = document.getElementById('newBatchModal');
                    if (modalElement) {
                        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                            const modal = bootstrap.Modal.getInstance(modalElement);
                            if (modal) {
                                modal.hide();
                            } else {
                                const newModal = new bootstrap.Modal(modalElement);
                                newModal.hide();
                            }
                        } else if (typeof $ !== 'undefined' && $.fn.modal) {
                            $('#newBatchModal').modal('hide');
                        }
                    }
                    
                    this.loadBatches(true); // Force refresh
                } else {
                    const errorMsg = result?.error || result?.message || 'Failed to create batch';
                    console.error('[Kernel Production] Save failed:', errorMsg);
                    throw new Error(errorMsg);
                }
            } catch (error) {
                console.error('[Kernel Production] Error saving new batch:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to create batch: ' + (error.message || error.toString())
                });
            }
        },
        
        showJobCardModal: async function () {
            try {
                console.log('[Kernel Production] Opening job card modal');
                $('#kernelJobCardModalLabel').text('Kernel Production Job Card');
                $('#jobCardId').val('');
                $('#jobCardProductionBatchId').val('');
                this.clearJobCardForm();
                
                // Set default date to today
                const today = new Date().toISOString().split('T')[0];
                $('#jobCardReceivedDate').val(today);
                
                // Load suppliers
                try {
                    const contacts = await dataFunctions.getContacts();
                    const select = $('#jobCardSupplier');
                    let html = '<option value="">Select Supplier</option>';
                    if (contacts && Array.isArray(contacts)) {
                        contacts.forEach(contact => {
                            const name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                            html += `<option value="${contact.id}">${name}</option>`;
                        });
                    }
                    select.html(html);
                } catch (error) {
                    console.error('Error loading suppliers:', error);
                }
                
                // Use Bootstrap 5 modal API with fallback
                const modalElement = document.getElementById('kernelJobCardModal');
                if (!modalElement) {
                    console.error('[Kernel Production] Modal element not found!');
                    Swal.fire('Error', 'Modal not found. Please refresh the page.', 'error');
                    return;
                }
                
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    const modal = new bootstrap.Modal(modalElement);
                    modal.show();
                    console.log('[Kernel Production] Modal shown via Bootstrap 5');
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#kernelJobCardModal').modal('show');
                    console.log('[Kernel Production] Modal shown via jQuery');
                } else {
                    console.error('[Kernel Production] Neither Bootstrap nor jQuery modal available!');
                    Swal.fire('Error', 'Unable to open modal. Please ensure Bootstrap is loaded.', 'error');
                }
            } catch (error) {
                console.error('[Kernel Production] Error showing job card modal:', error);
                Swal.fire('Error', 'Failed to open job card form: ' + error.message, 'error');
            }
        },
        
        clearJobCardForm: function () {
            const form = document.getElementById('kernelJobCardForm');
            if (form) form.reset();
            
            const jobCardId = document.getElementById('jobCardId');
            if (jobCardId) jobCardId.value = '';
            
            // Clear style rows except first
            const soundKernelBody = document.getElementById('soundKernelTableBody');
            if (soundKernelBody) {
                const rows = soundKernelBody.querySelectorAll('tr');
                for (let i = rows.length - 1; i > 0; i--) {
                    rows[i].remove();
                }
                if (rows[0]) {
                    const inputs = rows[0].querySelectorAll('input, select');
                    inputs.forEach(input => input.value = '');
                }
            }
            
            const butterGradeBody = document.getElementById('butterGradeTableBody');
            if (butterGradeBody) {
                const rows = butterGradeBody.querySelectorAll('tr');
                for (let i = rows.length - 1; i > 0; i--) {
                    rows[i].remove();
                }
                if (rows[0]) {
                    const inputs = rows[0].querySelectorAll('input, select');
                    inputs.forEach(input => input.value = '');
                }
            }
            
            this.calculateJobCardTotals();
        },
        
        calculateBalance: function () {
            const totalWeightEl = document.getElementById('jobCardTotalWeight');
            const removedPreSizerEl = document.getElementById('jobCardRemovedPreSizer');
            const balanceEl = document.getElementById('jobCardBalance');
            
            const totalWeight = totalWeightEl ? parseFloat(totalWeightEl.value) || 0 : 0;
            const removedPreSizer = removedPreSizerEl ? parseFloat(removedPreSizerEl.value) || 0 : 0;
            const balance = totalWeight - removedPreSizer;
            
            if (balanceEl) balanceEl.value = balance.toFixed(2);
            this.calculateMassBalance();
        },
        
        calculateRemovedMoisture: function () {
            const receivingEl = document.getElementById('jobCardReceivingMoisture');
            const packingEl = document.getElementById('jobCardPackingMoisture');
            const removedEl = document.getElementById('jobCardRemovedMoisture');
            
            const receiving = receivingEl ? parseFloat(receivingEl.value) || 0 : 0;
            const packing = packingEl ? parseFloat(packingEl.value) || 0 : 0;
            const removed = receiving - packing;
            
            if (removedEl) removedEl.value = removed.toFixed(2);
        },
        
        calculateJobCardTotals: function () {
            // Sound Kernel totals - use native DOM
            const soundKernelBody = document.getElementById('soundKernelTableBody');
            let soundCartons = 0;
            let soundKg = 0;
            
            if (soundKernelBody) {
                const rows = soundKernelBody.querySelectorAll('tr');
                rows.forEach(row => {
                    const cartonsInput = row.querySelector('input[name="cartons"]');
                    const weightInput = row.querySelector('input[name="weight_kg"]');
                    const cartons = cartonsInput ? parseInt(cartonsInput.value) || 0 : 0;
                    const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
                    soundCartons += cartons;
                    soundKg += weight;
                });
            }
            
            const soundCartonsEl = document.getElementById('soundKernelTotalCartons');
            const soundKgEl = document.getElementById('soundKernelTotalKg');
            if (soundCartonsEl) soundCartonsEl.textContent = soundCartons;
            if (soundKgEl) soundKgEl.textContent = soundKg.toFixed(2);
            
            // Butter Grade totals
            const butterGradeBody = document.getElementById('butterGradeTableBody');
            let butterCartons = 0;
            let butterKg = 0;
            
            if (butterGradeBody) {
                const rows = butterGradeBody.querySelectorAll('tr');
                rows.forEach(row => {
                    const cartonsInput = row.querySelector('input[name="cartons"]');
                    const weightInput = row.querySelector('input[name="weight_kg"]');
                    const cartons = cartonsInput ? parseInt(cartonsInput.value) || 0 : 0;
                    const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
                    butterCartons += cartons;
                    butterKg += weight;
                });
            }
            
            const butterCartonsEl = document.getElementById('butterGradeTotalCartons');
            const butterKgEl = document.getElementById('butterGradeTotalKg');
            if (butterCartonsEl) butterCartonsEl.textContent = butterCartons;
            if (butterKgEl) butterKgEl.textContent = butterKg.toFixed(2);
            
            this.calculateMassBalance();
        },
        
        calculateMassBalance: function () {
            const balanceEl = document.getElementById('jobCardBalance');
            const soundKgEl = document.getElementById('soundKernelTotalKg');
            const butterKgEl = document.getElementById('butterGradeTotalKg');
            
            const balance = balanceEl ? parseFloat(balanceEl.value) || 0 : 0;
            const soundKg = soundKgEl ? parseFloat(soundKgEl.textContent) || 0 : 0;
            const butterKg = butterKgEl ? parseFloat(butterKgEl.textContent) || 0 : 0;
            
            const wasteInputs = {
                oil: document.getElementById('jobCardWasteOilKernel'),
                saltPepper: document.getElementById('jobCardWasteSaltPepper'),
                shellFines: document.getElementById('jobCardWasteShellFines'),
                compost: document.getElementById('jobCardWasteCompost'),
                shell: document.getElementById('jobCardWasteShell')
            };
            
            const wasteOil = wasteInputs.oil ? parseFloat(wasteInputs.oil.value) || 0 : 0;
            const wasteSaltPepper = wasteInputs.saltPepper ? parseFloat(wasteInputs.saltPepper.value) || 0 : 0;
            const wasteShellFines = wasteInputs.shellFines ? parseFloat(wasteInputs.shellFines.value) || 0 : 0;
            const wasteCompost = wasteInputs.compost ? parseFloat(wasteInputs.compost.value) || 0 : 0;
            const wasteShell = wasteInputs.shell ? parseFloat(wasteInputs.shell.value) || 0 : 0;
            
            const totalOut = soundKg + butterKg + wasteOil + wasteSaltPepper + wasteShellFines + wasteCompost + wasteShell;
            
            const massBalanceInEl = document.getElementById('jobCardMassBalanceIn');
            const massBalanceOutEl = document.getElementById('jobCardMassBalanceOut');
            const massBalancePctEl = document.getElementById('jobCardMassBalancePercentage');
            
            if (massBalanceInEl) massBalanceInEl.value = balance.toFixed(2);
            if (massBalanceOutEl) massBalanceOutEl.value = totalOut.toFixed(2);
            
            const percentage = balance > 0 ? (totalOut / balance) * 100 : 0;
            if (massBalancePctEl) massBalancePctEl.value = percentage.toFixed(2);
        },
        
        addSoundKernelRow: function () {
            const newRow = `
                <tr>
                    <td>
                        <select class="form-select form-select-sm" name="style">
                            <option value="">Select Style</option>
                            <option value="SP">SP</option>
                            <option value="0">0</option>
                            <option value="1">1</option>
                            <option value="1S">1S</option>
                            <option value="4L">4L</option>
                            <option value="5">5</option>
                            <option value="6">6</option>
                        </select>
                    </td>
                    <td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td>
                    <td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td>
                    <td><button type="button" class="btn btn-sm btn-danger removeSoundKernelRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            const soundKernelBody = document.getElementById('soundKernelTableBody');
            if (soundKernelBody) {
                soundKernelBody.insertAdjacentHTML('beforeend', newRow);
            } else if (typeof $ !== 'undefined') {
                $('#soundKernelTableBody').append(newRow);
            }
        },
        
        addButterGradeRow: function () {
            const newRow = `
                <tr>
                    <td>
                        <select class="form-select form-select-sm" name="style">
                            <option value="">Select Style</option>
                            <option value="7/8">7/8</option>
                            <option value="Butter High Oil (Floaters)">Butter High Oil (Floaters)</option>
                            <option value="Butter Low Oil (Sinkers)">Butter Low Oil (Sinkers)</option>
                        </select>
                    </td>
                    <td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td>
                    <td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td>
                    <td><button type="button" class="btn btn-sm btn-danger removeButterGradeRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            const butterGradeBody = document.getElementById('butterGradeTableBody');
            if (butterGradeBody) {
                butterGradeBody.insertAdjacentHTML('beforeend', newRow);
            } else if (typeof $ !== 'undefined') {
                $('#butterGradeTableBody').append(newRow);
            }
        },
        
        saveJobCard: async function () {
            try {
                console.log('[Kernel Production] Saving job card...');
                const form = $('#kernelJobCardForm')[0];
                if (!form) {
                    Swal.fire('Error', 'Form not found', 'error');
                    return;
                }
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                
                // Collect sound kernel styles - use native DOM
                const soundKernelStyles = [];
                const soundKernelBody = document.getElementById('soundKernelTableBody');
                if (soundKernelBody) {
                    const rows = soundKernelBody.querySelectorAll('tr');
                    rows.forEach(row => {
                        const styleSelect = row.querySelector('select[name="style"]');
                        const cartonsInput = row.querySelector('input[name="cartons"]');
                        const weightInput = row.querySelector('input[name="weight_kg"]');
                        
                        const style = styleSelect ? styleSelect.value : '';
                        const cartons = cartonsInput ? parseInt(cartonsInput.value) || 0 : 0;
                        const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
                        
                        if (style && (cartons > 0 || weight > 0)) {
                            soundKernelStyles.push({
                                style: style,
                                cartons: cartons,
                                weight_kg: weight
                            });
                        }
                    });
                }
                
                // Collect butter grade styles - use native DOM
                const butterGradeStyles = [];
                const butterGradeBody = document.getElementById('butterGradeTableBody');
                if (butterGradeBody) {
                    const rows = butterGradeBody.querySelectorAll('tr');
                    rows.forEach(row => {
                        const styleSelect = row.querySelector('select[name="style"]');
                        const cartonsInput = row.querySelector('input[name="cartons"]');
                        const weightInput = row.querySelector('input[name="weight_kg"]');
                        
                        const style = styleSelect ? styleSelect.value : '';
                        const cartons = cartonsInput ? parseInt(cartonsInput.value) || 0 : 0;
                        const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
                        
                        if (style && (cartons > 0 || weight > 0)) {
                            butterGradeStyles.push({
                                style: style,
                                cartons: cartons,
                                weight_kg: weight
                            });
                        }
                    });
                }
                
                // Get form values using native DOM
                const getValue = (id) => {
                    const el = document.getElementById(id);
                    return el ? el.value : null;
                };
                
                const getFloatValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.value ? parseFloat(el.value) : null;
                };
                
                const getIntValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.value ? parseInt(el.value) : null;
                };
                
                const getTextValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.textContent ? parseFloat(el.textContent) : null;
                };
                
                const getIntTextValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.textContent ? parseInt(el.textContent) : null;
                };
                
                const autoUpdateStockEl = document.getElementById('jobCardAutoUpdateStock');
                const jobCardIdVal = getValue('jobCardId');
                const productionBatchIdVal = getValue('jobCardProductionBatchId');
                
                const jobCardData = {
                    p_batch_number: getValue('jobCardBatchNumber'),
                    p_received_date: getValue('jobCardReceivedDate'),
                    p_production_batch_id: productionBatchIdVal || null,
                    p_total_weight_kg: getFloatValue('jobCardTotalWeight'),
                    p_supplier_id: getValue('jobCardSupplier') || null,
                    p_supplier_name: getValue('jobCardSupplierName') || null,
                    p_removed_pre_sizer_kg: getFloatValue('jobCardRemovedPreSizer'),
                    p_balance_kg: getFloatValue('jobCardBalance'),
                    p_receiving_moisture_percentage: getFloatValue('jobCardReceivingMoisture'),
                    p_packing_moisture_percentage: getFloatValue('jobCardPackingMoisture'),
                    p_removed_moisture_percentage: getFloatValue('jobCardRemovedMoisture'),
                    p_packing_start_date: getValue('jobCardPackingStartDate') || null,
                    p_packing_completion_date: getValue('jobCardPackingCompletionDate') || null,
                    p_best_before_date: getValue('jobCardBestBeforeDate') || null,
                    p_sound_kernel_styles: soundKernelStyles.length > 0 ? JSON.stringify(soundKernelStyles) : null,
                    p_sound_kernel_total_cartons: getIntTextValue('soundKernelTotalCartons'),
                    p_sound_kernel_total_kg: getTextValue('soundKernelTotalKg'),
                    p_butter_grade_styles: butterGradeStyles.length > 0 ? JSON.stringify(butterGradeStyles) : null,
                    p_butter_grade_total_cartons: getIntTextValue('butterGradeTotalCartons'),
                    p_butter_grade_total_kg: getTextValue('butterGradeTotalKg'),
                    p_waste_oil_kernel_kg: getFloatValue('jobCardWasteOilKernel'),
                    p_waste_salt_pepper_kg: getFloatValue('jobCardWasteSaltPepper'),
                    p_waste_shell_fines_kg: getFloatValue('jobCardWasteShellFines'),
                    p_waste_compost_kg: getFloatValue('jobCardWasteCompost'),
                    p_waste_shell_kg: getFloatValue('jobCardWasteShell'),
                    p_mass_balance_in_kg: getFloatValue('jobCardMassBalanceIn'),
                    p_mass_balance_out_kg: getFloatValue('jobCardMassBalanceOut'),
                    p_mass_balance_percentage: getFloatValue('jobCardMassBalancePercentage'),
                    p_auto_update_stock: autoUpdateStockEl ? autoUpdateStockEl.checked : false
                };
                if (jobCardIdVal) jobCardData.p_id = jobCardIdVal;
                
                console.log('[Kernel Production] Job card data:', jobCardData);
                const result = await dataFunctions.createKernelJobCard(jobCardData);
                console.log('[Kernel Production] Save result:', result);
                
                if (result && result.success !== false) {
                    // Invalidate caches
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('stock_items');
                    }
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: 'Kernel production job card saved successfully' + (jobCardData.p_auto_update_stock ? ' and stock updated' : ''),
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    // Close modal
                    const modalElement = document.getElementById('kernelJobCardModal');
                    if (modalElement) {
                        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                            const modal = bootstrap.Modal.getInstance(modalElement);
                            if (modal) {
                                modal.hide();
                            } else {
                                const newModal = new bootstrap.Modal(modalElement);
                                newModal.hide();
                            }
                        } else if (typeof $ !== 'undefined' && $.fn.modal) {
                            $('#kernelJobCardModal').modal('hide');
                        }
                    }
                    
                    this.loadBatches(true); // Force refresh
                } else {
                    const errorMsg = result?.error || result?.message || 'Failed to save job card';
                    console.error('[Kernel Production] Save failed:', errorMsg);
                    throw new Error(errorMsg);
                }
            } catch (error) {
                console.error('[Kernel Production] Error saving job card:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to save job card: ' + (error.message || error.toString())
                });
            }
        }
    };
}();
const kernelProductionGrid = _kernelProductionGrid;
function initializeKernelProductionGrid() {
    console.log('[Kernel Production] Initializing module...');
    if (typeof kernelProductionGrid !== 'undefined') {
        // Wait for DOM to be fully ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(() => kernelProductionGrid.init(), 100);
            });
        } else {
            setTimeout(() => kernelProductionGrid.init(), 100);
        }
    } else {
        console.error('[Kernel Production] kernelProductionGrid object not defined!');
    }
}

