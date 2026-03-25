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
                const user = typeof localStorage !== 'undefined' && Session.get('user');
                if (!user) return false;
                return user.role_name === ROLE_FEATURE.KP_DATA_ADMIN_ROLE;
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

    const escapeHtml = (text) => {
        if (text == null || typeof text !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    /**
     * Derive display status from actual production data, not just DB status.
     * Batches with no production days/history show "Awaiting production"; only batches with real production data show "In production".
     * Returns { label: string, filterValue: string }.
     */
    const getBatchDisplayStatus = (batch) => {
        const hasProductionData = (batch.production_day_count > 0) || !!batch.has_job_card;
        const productionFinished = !!batch.production_finished_at;
        const hasEndSample = !!batch.has_qa;

        if (productionFinished && hasEndSample) return { label: 'Release ready', filterValue: 'release_ready' };
        if (productionFinished) return { label: 'Awaiting test', filterValue: 'awaiting_test' };
        if (hasProductionData) return { label: 'In production', filterValue: 'in_production' };
        return { label: 'Awaiting production', filterValue: 'awaiting_production' };
    };

    const KANBAN_COLUMNS = [
        { key: 'awaiting_production', label: 'Awaiting Production' },
        { key: 'in_production', label: 'In Production' },
        { key: 'awaiting_test', label: 'Awaiting Test' },
        { key: 'release_ready', label: 'Release Ready' }
    ];

    return {
        batches: [],
        filteredBatches: [],
        searchDebounceToken: 0,
        currentView: 'kanban',
        /** When true, only show batches that are in Release ready and have an approved job card. */
        approvedJobcardsOnly: false,
        /** When user clicks an empty silo, this is the silo number (1–12) for "Mark as full". */
        selectedEmptySiloNumber: null,

        /** Same derived status as in the grid table (for use by batch history modal etc.). */
        getBatchDisplayStatus: getBatchDisplayStatus,

        init: () => {
            const scope = _kernelProductionGrid;
            if (typeof _app !== 'undefined' && typeof _app.checkSession === 'function' && !_app.checkSession()) {
                return;
            }
            console.log('[Kernel Production] Initializing grid...');
            scope.bindEvents();
            scope.loadSilosGrid();
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
                if (!batchId) return;
                var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
                if (batch && batch.has_qa && typeof _modal_end_sample_view !== 'undefined' && _modal_end_sample_view.show) {
                    _modal_end_sample_view.show(batchId);
                } else if (typeof _modal_end_sample !== 'undefined' && _modal_end_sample.show) {
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
            $(document).on('click', '.js-delete-batch', function (e) {
                e.preventDefault();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _kernelProductionBatchActions !== 'undefined' && _kernelProductionBatchActions.deleteBatch) {
                    _kernelProductionBatchActions.deleteBatch(batchId);
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
            $(document).on('click', '.js-batch-summary', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _modal_production_stages !== 'undefined' && _modal_production_stages.showBatchSummaryForBatch) {
                    _modal_production_stages.showBatchSummaryForBatch(batchId);
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
                if (!batchId) return;
                // Job card is always editable; open edit modal every time
                if (typeof _modal_kernel_job_card !== 'undefined' && _modal_kernel_job_card.showJobCardModalForBatch) {
                    _modal_kernel_job_card.showJobCardModalForBatch(batchId);
                }
            });
            // Kanban card click → batch history
            $(document).on('click', '#kpKanbanBoard .kanban-card', function (e) {
                if ($(e.target).closest('button, .btn').length) return;
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _modal_batch_history !== 'undefined' && _modal_batch_history.show) {
                    _modal_batch_history.show(batchId);
                }
            });
            // View toggle
            $('#kpViewKanban').on('click', function () { _kernelProductionGrid.toggleView('kanban'); });
            $('#kpViewTable').on('click', function () { _kernelProductionGrid.toggleView('table'); });
            // Approved jobcards filter (release ready + job card approved only)
            $('#kpViewApprovedJobcards').on('click', function () {
                const scope = _kernelProductionGrid;
                scope.approvedJobcardsOnly = !scope.approvedJobcardsOnly;
                $('#kpViewApprovedJobcards').toggleClass('active', scope.approvedJobcardsOnly);
                scope.filterBatches();
            });
            // Silos grid: click occupied silo to mark as empty
            $(document).on('click', '#kpSilosGrid .kp-silo-occupied', function () {
                const num = $(this).data('silo-number');
                if (num != null && typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.setSiloEmpty) {
                    _kernelProductionGrid.setSiloEmpty(num);
                }
            });
            // Silos grid: click empty silo → show "Mark as full" area
            $(document).on('click', '#kpSilosGrid .kp-silo-empty', function () {
                const num = $(this).data('silo-number');
                if (num == null || typeof _kernelProductionGrid === 'undefined') return;
                _kernelProductionGrid.selectEmptySiloForFill(num);
            });
            $('#kpMarkFullBtn').off('click').on('click', function () {
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.showSiloFillBatchModal) {
                    _kernelProductionGrid.showSiloFillBatchModal();
                }
            });
            $('#kpSiloFillCancel').off('click').on('click', function () {
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.clearSiloFillSelection) {
                    _kernelProductionGrid.clearSiloFillSelection();
                }
            });
            $(document).on('click', '#kpSiloFillBatchList .js-silo-fill-batch', function (e) {
                e.preventDefault();
                const kernelId = $(this).data('kernel-id');
                const scope = _kernelProductionGrid;
                const siloNum = scope.selectedEmptySiloNumber;
                if (!kernelId || !siloNum) return;
                if (typeof _dataFunctions === 'undefined' || !_dataFunctions.assignKernelToSilos) return;
                _dataFunctions.assignKernelToSilos(kernelId, [siloNum]).then(function (result) {
                    if (result && result.success !== false) {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Silo ' + siloNum + ' assigned', timer: 1500, showConfirmButton: false });
                        scope.clearSiloFillSelection();
                        scope.loadSilosGrid();
                        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                            var modalEl = document.getElementById('kpSiloFillBatchModal');
                            if (modalEl) bootstrap.Modal.getInstance(modalEl) && bootstrap.Modal.getInstance(modalEl).hide();
                        }
                    } else {
                        if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Failed to assign silo', 'error');
                    }
                }).catch(function (err) {
                    console.error(err);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', err.message || 'Failed to assign silo', 'error');
                });
            });
        },

        toggleView: (view) => {
            const scope = _kernelProductionGrid;
            scope.currentView = view;
            if (view === 'kanban') {
                $('#kpKanbanBoard').show();
                $('#kpTableCard').hide();
                $('#kpViewKanban').addClass('active');
                $('#kpViewTable').removeClass('active');
                scope.renderKanban();
            } else {
                $('#kpKanbanBoard').hide();
                $('#kpTableCard').show();
                $('#kpViewTable').addClass('active');
                $('#kpViewKanban').removeClass('active');
                scope.renderBatches();
            }
        },

        renderKanban: () => {
            const scope = _kernelProductionGrid;
            if (typeof KanbanHelper === 'undefined') return;
            KanbanHelper.render(
                'kpKanbanBoard',
                KANBAN_COLUMNS,
                scope.filteredBatches,
                function (batch) { return getBatchDisplayStatus(batch).filterValue; },
                function (batch) {
                    var receivedDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                        ? (_common.formatDateDDMMYYYY(batch.received_date) || '') : '';
                    var bbDisplay = (batch.best_before_date && (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY ? _common.formatDateDDMMYYYY(batch.best_before_date) : batch.best_before_date)) || '';
                    var productionIcon = batch.production_finished_at ? '<i class="fas fa-check text-success me-1"></i>' : '';
                    var qaIcon = batch.has_qa ? '<i class="fas fa-check text-success me-1"></i>' : '';
                    var displayStatus = getBatchDisplayStatus(batch);
                    var isJobCardApproved = batch.has_jobcard_approved === true || (batch.has_jobcard_approved !== false && !!batch.has_job_card);
                    var jcIcon = (displayStatus.filterValue === 'release_ready' && isJobCardApproved) ? '<i class="fas fa-check text-success me-1"></i>' : '';
                    return '<div class="kanban-card" data-batch-id="' + batch.id + '">' +
                        '<div class="kanban-card-title">' + KanbanHelper._esc(batch.batch_number || 'N/A') + '</div>' +
                        '<div class="kanban-card-meta">' +
                            '<span class="kanban-card-meta-item" title="Supplier"><i class="fas fa-user"></i> ' + KanbanHelper._esc(batch.grower_name || 'N/A') + '</span>' +
                            '<span class="kanban-card-meta-item" title="Wet NIS (kg)"><i class="fas fa-weight-hanging"></i> ' + KanbanHelper._esc(String(batch.display_wet_nis_kg != null ? batch.display_wet_nis_kg : (batch.wet_nis_received_kg || '0'))) + ' kg</span>' +
                            (receivedDate ? '<span class="kanban-card-meta-item" title="Received date"><i class="fas fa-calendar"></i> ' + KanbanHelper._esc(receivedDate) + '</span>' : '') +
                            (bbDisplay ? '<span class="kanban-card-meta-item" title="Best Before Date (from Job Card)"><i class="fas fa-calendar-check"></i> Best Before Date ' + KanbanHelper._esc(bbDisplay) + '</span>' : '') +
                        '</div>' +
                        '<div class="kanban-card-actions">' +
                            '<button class="btn btn-sm btn-outline-secondary js-production-batch" data-batch-id="' + batch.id + '" title="Production">' + productionIcon + '<i class="fas fa-cogs"></i></button>' +
                            '<button class="btn btn-sm btn-outline-secondary js-job-card-batch" data-batch-id="' + batch.id + '" title="Job Card">' + jcIcon + '<i class="fas fa-file-alt"></i></button>' +
                            '<button class="btn btn-sm btn-outline-secondary js-end-sample-batch" data-batch-id="' + batch.id + '" title="End Sample">' + qaIcon + '<i class="fas fa-flask"></i></button>' +
                            '<button class="btn btn-sm btn-outline-info js-batch-summary" data-batch-id="' + batch.id + '" title="Batch summary"><i class="fas fa-calculator"></i></button>' +
                        '</div></div>';
                }
            );

            // Drag-and-drop: forward transitions only
            var colOrder = ['awaiting_production', 'in_production', 'awaiting_test', 'release_ready'];
            KanbanHelper.enableDragDrop('kpKanbanBoard', function (batchId, fromKey, toKey) {
                var fromIdx = colOrder.indexOf(fromKey);
                var toIdx = colOrder.indexOf(toKey);
                if (toIdx <= fromIdx) return; // block backward moves

                if (fromKey === 'awaiting_production' && toKey === 'in_production') {
                    if (typeof _modal_production_stages !== 'undefined' && _modal_production_stages.showProductionStagesModalForBatch) {
                        _modal_production_stages.showProductionStagesModalForBatch(batchId);
                    }
                } else if (fromKey === 'in_production' && toKey === 'awaiting_test') {
                    if (typeof _modal_end_sample !== 'undefined' && _modal_end_sample.show) {
                        _modal_end_sample.show(batchId);
                    }
                } else if (fromKey === 'awaiting_test' && toKey === 'release_ready') {
                    var batch = scope.getBatch(batchId);
                    if (batch && batch.has_qa && typeof _modal_end_sample_view !== 'undefined' && _modal_end_sample_view.show) {
                        _modal_end_sample_view.show(batchId);
                    } else if (typeof _modal_end_sample !== 'undefined' && _modal_end_sample.show) {
                        _modal_end_sample.show(batchId);
                    }
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
                const matchesApprovedJobcards = !scope.approvedJobcardsOnly ||
                    (displayStatus.filterValue === 'release_ready' && batch.has_jobcard_approved === true);
                return matchesSearch && matchesStatus && matchesApprovedJobcards;
            });
            if (scope.currentView === 'kanban') {
                scope.renderKanban();
            } else {
                scope.renderBatches();
            }
        },

        loadBatches: (forceRefresh) => {
            const scope = _kernelProductionGrid;
            forceRefresh = !!forceRefresh;
            if (typeof _dataFunctions === 'undefined' || !_dataFunctions || typeof _dataFunctions.getKernelBatches !== 'function') {
                console.warn('[Kernel Production] _dataFunctions not available');
                return;
            }
            const startTime = performance.now();
            // Only fetch batches that are in the production pipeline (not yet released to stock).
            // Stock (Kernel) uses status 'complete'; we exclude that so the board stays empty when all are in stock.
            _dataFunctions.getKernelBatches(null, forceRefresh, { status: 'intake,receiving,production,qa' }).then((batches) => {
                scope.batches = (batches || []).map(function (b) {
                    var displayKg = (b.actual_wet_nis_kg != null && b.actual_wet_nis_kg !== '') ? b.actual_wet_nis_kg : b.wet_nis_received_kg;
                    return Object.assign({}, b, { display_wet_nis_kg: displayKg });
                });
                scope.filteredBatches = scope.batches;
                if (scope.currentView === 'kanban') {
                    scope.renderKanban();
                } else {
                    scope.renderBatches();
                }
                console.log('[Kernel Production] Batches loaded in ' + (performance.now() - startTime).toFixed(2) + 'ms, count: ' + scope.batches.length);
            }).catch((err) => {
                console.error('[Kernel Production] Error loading batches:', err);
            });
        },

        loadSilosGrid: async () => {
            const scope = _kernelProductionGrid;
            const el = document.getElementById('kpSilosGrid');
            if (!el) return;
            const df = (typeof _dataFunctions !== 'undefined' && _dataFunctions.getSilos) ? _dataFunctions : (typeof dataFunctions !== 'undefined' ? dataFunctions : null);
            if (!df || typeof df.getSilos !== 'function') {
                el.innerHTML = '<p class="text-muted mb-0">Silos not available.</p>';
                return;
            }
            try {
                const list = await df.getSilos(null, true);
                scope.renderSilosGrid(Array.isArray(list) ? list : []);
            } catch (e) {
                console.error('[Kernel Production] Error loading silos:', e);
                el.innerHTML = '<p class="text-danger mb-0">Failed to load silos.</p>';
            }
        },

        renderSilosGrid: (siloList) => {
            const el = document.getElementById('kpSilosGrid');
            if (!el) return;
            const occupied = {};
            (siloList || []).forEach((s) => {
                const num = s.silo_number != null ? Number(s.silo_number) : null;
                if (num >= 1 && num <= 12 && (s.kernel_id || s.oil_batch_id)) {
                    occupied[num] = {
                        batch_id: s.batch_id || s.batchId || null,
                        grower_name: s.grower_name || s.growerName || null
                    };
                }
            });
            let html = '';
            for (let n = 1; n <= 12; n++) {
                const isOccupied = !!occupied[n];
                const cls = 'kp-silo-box ' + (isOccupied ? 'kp-silo-occupied' : 'kp-silo-empty');
                const info = occupied[n];
                const grower = info && info.grower_name ? info.grower_name : null;
                const batch = info && info.batch_id ? info.batch_id : null;
                const titleParts = ['Silo ' + n];
                if (grower) titleParts.push(grower);
                if (batch) titleParts.push(batch);
                const title = (isOccupied ? titleParts.join(' — ') + ' — click to mark empty' : 'Silo ' + n + ' (empty)').replace(/"/g, '&quot;');
                const labelHtml = grower
                    ? '<span class="kp-silo-label">' + n + '</span><span class="kp-silo-grower">' + escapeHtml(grower) + '</span>'
                    : '<span class="kp-silo-label">' + n + '</span>';
                html += '<div class="' + cls + '" data-silo-number="' + n + '" title="' + title + '" role="button" tabindex="0">' + labelHtml + '</div>';
            }
            el.innerHTML = html;
        },

        setSiloEmpty: (siloNumber) => {
            const df = (typeof _dataFunctions !== 'undefined' && _dataFunctions.setSiloEmpty) ? _dataFunctions : (typeof dataFunctions !== 'undefined' ? dataFunctions : null);
            if (siloNumber == null || !df || typeof df.setSiloEmpty !== 'function') return;
            if (typeof Swal === 'undefined') {
                df.setSiloEmpty(siloNumber).then(() => _kernelProductionGrid.loadSilosGrid());
                return;
            }
            Swal.fire({
                title: 'Mark silo as empty?',
                text: 'Silo ' + siloNumber + ' will be cleared. This does not delete the batch.',
                icon: 'question',
                showCancelButton: true,
                confirmButtonColor: '#0d6efd',
                cancelButtonColor: '#6c757d',
                confirmButtonText: 'Yes, mark empty'
            }).then((res) => {
                if (!res.isConfirmed) return;
                df.setSiloEmpty(siloNumber).then((result) => {
                    if (result && result.success !== false) {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Silo ' + siloNumber + ' marked empty', timer: 1500, showConfirmButton: false });
                        _kernelProductionGrid.loadSilosGrid();
                    } else {
                        if (typeof Swal !== 'undefined') Swal.fire('Error', (result && result.error) || 'Failed to update silo', 'error');
                    }
                }).catch((e) => {
                    console.error(e);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to update silo', 'error');
                });
            });
        },

        selectEmptySiloForFill: (siloNumber) => {
            const scope = _kernelProductionGrid;
            scope.selectedEmptySiloNumber = siloNumber;
            $('#kpSilosGrid .kp-silo-box').removeClass('kp-silo-selected');
            $('#kpSilosGrid .kp-silo-box[data-silo-number="' + siloNumber + '"]').addClass('kp-silo-selected');
            document.getElementById('kpSiloFillSiloNum').textContent = siloNumber;
            $('#kpSiloFillArea').show();
        },

        clearSiloFillSelection: () => {
            const scope = _kernelProductionGrid;
            scope.selectedEmptySiloNumber = null;
            $('#kpSilosGrid .kp-silo-box').removeClass('kp-silo-selected');
            $('#kpSiloFillArea').hide();
        },

        showSiloFillBatchModal: () => {
            const scope = _kernelProductionGrid;
            const siloNum = scope.selectedEmptySiloNumber;
            if (siloNum == null) return;
            const titleEl = document.getElementById('kpSiloFillBatchModalLabel');
            if (titleEl) titleEl.textContent = 'Select batch for silo ' + siloNum;
            const listEl = document.getElementById('kpSiloFillBatchList');
            if (!listEl) return;
            const batches = scope.batches || [];
            if (batches.length === 0) {
                listEl.innerHTML = '<p class="text-muted mb-0">No production batches. Release batches from Grower Intake first.</p>';
            } else {
                let html = '';
                batches.forEach((b) => {
                    const kernelId = b.id;
                    const batchNum = escapeHtml(b.batch_number || 'N/A');
                    const grower = escapeHtml(b.grower_name || '');
                    const label = grower ? batchNum + ' — ' + grower : batchNum;
                    html += '<a href="#" class="list-group-item list-group-item-action js-silo-fill-batch" data-kernel-id="' + String(kernelId) + '">' + label + '</a>';
                });
                listEl.innerHTML = html;
            }
            const modalEl = document.getElementById('kpSiloFillBatchModal');
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                modal.show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#kpSiloFillBatchModal').modal('show');
            }
        },

        renderBatches: () => {
            const scope = _kernelProductionGrid;
            const tbody = $('#batchesTableBody');
            tbody.empty();
            if (scope.filteredBatches.length === 0) {
                if (scope.batches.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No production batches. Release batches from Grower Intake.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search.</td></tr>');
                }
                return;
            }
            scope.filteredBatches.forEach((batch) => {
                const displayStatus = getBatchDisplayStatus(batch);
                const isReleaseReady = batch.status === 'qa' || batch.status === 'complete' || (batch.production_finished_at && batch.has_qa);
                const isJobCardApproved = batch.has_jobcard_approved === true || (batch.has_jobcard_approved !== false && !!batch.has_job_card);
                const canReleaseToStock = isReleaseReady && isJobCardApproved;
                const receivedDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                    ? (_common.formatDateDDMMYYYY(batch.received_date) || 'N/A')
                    : (batch.received_date ? (batch.received_date.toString().split ? batch.received_date.toString().split('T')[0] : batch.received_date) : 'N/A');
                const bbDisplay = (batch.best_before_date && (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY ? _common.formatDateDDMMYYYY(batch.best_before_date) : batch.best_before_date)) || '—';
                const productionLabel = batch.production_finished_at ? '&#10003; Production' : 'Production';
                const endSampleLabel = batch.has_qa ? '&#10003; End sample' : 'End sample';
                const jobCardLabel = (displayStatus.filterValue === 'release_ready' && isJobCardApproved) ? '&#10003; Job Card' : 'Job Card';
                const jobCardItem = '<a class="dropdown-item js-job-card-batch" href="#" data-batch-id="' + batch.id + '">' + jobCardLabel + '</a>';
                const summaryItem = '<a class="dropdown-item js-batch-summary" href="#" data-batch-id="' + batch.id + '"><i class="fas fa-calculator me-1"></i>Batch summary</a>';
                let menuItems = [
                    '<a class="dropdown-item js-production-batch" href="#" data-batch-id="' + batch.id + '">' + productionLabel + '</a>',
                    '<a class="dropdown-item js-end-sample-batch" href="#" data-batch-id="' + batch.id + '">' + endSampleLabel + '</a>',
                    jobCardItem,
                    summaryItem
                ];
                if (canReleaseToStock) {
                    menuItems.push('<a class="dropdown-item js-release-to-stock" href="#" data-batch-id="' + batch.id + '">Release to stock</a>');
                } else {
                    menuItems.push('<span class="dropdown-item text-muted js-release-to-stock-disabled" role="button" tabindex="0">Release to stock</span>');
                }
                menuItems.push('<a class="dropdown-item js-delete-batch text-danger" href="#" data-batch-id="' + batch.id + '"><i class="fas fa-trash me-1"></i>Delete batch</a>');
                // TEMPORARY: KP Data Admin sees only Production button. Remove when replacing with real auth.
                const isKpDataAdmin = typeof ROLE_FEATURE !== 'undefined' && ROLE_FEATURE.isKpDataAdmin && ROLE_FEATURE.isKpDataAdmin();
                let actionsCell;
                if (isKpDataAdmin) {
                    actionsCell = '<button type="button" class="btn btn-sm btn-outline-secondary js-production-batch" data-batch-id="' + batch.id + '">' + productionLabel + '</button>';
                } else {
                    actionsCell = '<div class="dropdown">' +
                        '<button class="btn btn-sm btn-outline-secondary" type="button" id="batchActions' + batch.id + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                        '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="batchActions' + batch.id + '">' + menuItems.join('') + '</ul></div>';
                }
                var stagePos = displayStatus.filterValue === 'awaiting_production' ? 'first' : displayStatus.filterValue === 'release_ready' ? 'last' : 'mid';
                const bbTitle = bbDisplay !== '—' ? 'Best Before Date' : 'Best Before Date (set when Job Card is completed)';
                const row = '<tr class="js-batch-row" data-batch-id="' + batch.id + '"><td>' + (batch.batch_number || 'N/A') + '</td><td>' + (batch.grower_name || 'N/A') + '</td><td title="Received date">' + receivedDate + '</td><td title="' + (bbTitle.replace(/"/g, '&quot;')) + '">' + bbDisplay + '</td><td>' + (batch.display_wet_nis_kg != null ? batch.display_wet_nis_kg : (batch.wet_nis_received_kg || '0')) + '</td><td>' + KanbanHelper.statusBadge(displayStatus.label, stagePos) + '</td><td>' + actionsCell + '</td></tr>';
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
                { key: 'best_before_date', label: 'Best Before Date' },
                { key: 'display_wet_nis_kg', label: 'Wet NIS (kg)' },
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
