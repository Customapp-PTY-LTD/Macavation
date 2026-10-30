/**
 * Grower Intake Grid Module
 * Route-only modal pattern: parent loads modal content, routes to modals; modals own logic.
 * See MODAL_PATTERN_INSTRUCTIONS.md, SEPARATING_LARGE_JS_FILES.md
 */
var _growerIntakeGrid = function () {
    'use strict';

    var INTAKE_KANBAN_COLUMNS = [
        { key: 'receiving', label: 'Receiving' },
        // Checklist done, sample still to take (Quality Pending folded in: nothing ever sat there).
        { key: 'intake_received', label: 'Quality checks' },
        { key: 'quality_approved', label: 'Ready to release' },
        // Released to production but with bags still waiting in storage or a silo (grower_intake_bags.js).
        { key: 'released', label: 'Released – cracking' }
    ];

    function getIntakeColumnKey(b) {
        if (b._released) return 'released';
        if (b.status === 'quality_pending') return 'intake_received';
        if (['receiving', 'intake_received', 'quality_pending', 'quality_approved'].indexOf(b.status) >= 0) {
            return b.status;
        }
        var checklistDone = !!b.has_receiving_checklist;
        var sampleDone = !!b.has_ziplock_sample && !!b.has_5kg_sample;
        if (!checklistDone) return 'receiving';
        if (!sampleDone) return 'intake_received';
        return 'quality_approved';
    }

        return {
        samples: [],
        filteredSamples: [],
        intakeBatches: [],
        filteredIntakeBatches: [],
        currentPage: 1,
        itemsPerPage: 20,
        currentView: 'kanban',
        wetNisDisplayMode: 'both', // 'supplied' | 'actual' | 'both'

        // Expected trucks state (from the procurement plan)
        procurementItems: [],
        procurementAreas: [],
        procurementToday: null,
        procurementLoadFailed: false,
        _truckSortables: [],
        trucksOpen: false,
        _procurementReceivingSortable: null,

        init: () => {
            const scope = _growerIntakeGrid;
            if (typeof BatchStatus !== 'undefined') BatchStatus.applyModuleSubtitle('grower-intake-grid');
            if (typeof HandoffDialog !== 'undefined') HandoffDialog.applyPendingSearchForRoute('grower-intake-grid');
            scope.bindEvents();
            if (typeof _giBags !== 'undefined') _giBags.init();
            if (typeof initMacSectionCollapses === 'function') {
                initMacSectionCollapses(document.querySelector('.module-content'));
            }
            scope.initActivityCalendar();
            scope.loadIntakeBatches(true);
            // Handoff from My Day etc.: { bookInProcurementId } opens Book in once data and modals are ready
            var handoff = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('grower-intake-grid') : null;
            var plansLoaded = scope.loadProcurements(true);
            const loadPromises = [];
            $('.modal[route-name]').each((index, el) => {
                const routeName = $(el).attr('route-name');
                const elementSelector = '#' + $(el).attr('id');
                if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName, elementSelector }));
                }
            });
            var modalsReady = Promise.all(loadPromises).then(() => {
                if (typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.init) _modal_grower_receiving_checklist.init();
                if (typeof _modal_grower_create_kernel_batch !== 'undefined' && _modal_grower_create_kernel_batch.init) _modal_grower_create_kernel_batch.init();
                if (typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.init) _modal_grower_link_sample_to_batch.init();
                if (typeof actionAccess !== 'undefined' && actionAccess.apply) {
                    actionAccess.apply(document.querySelector('.module-content') || document.getElementById('content-area') || document);
                }
            }).catch((err) => {
                console.error('[Grower Intake] Error loading modals:', err);
                if (typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.init) _modal_grower_receiving_checklist.init();
                if (typeof _modal_grower_create_kernel_batch !== 'undefined' && _modal_grower_create_kernel_batch.init) _modal_grower_create_kernel_batch.init();
                if (typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.init) _modal_grower_link_sample_to_batch.init();
            });
            if (handoff && handoff.bookInProcurementId) {
                Promise.all([plansLoaded, modalsReady]).then(() => {
                    scope.bookIn(handoff.bookInProcurementId);
                });
            }
        },

        bindEvents: () => {
            const scope = _growerIntakeGrid;

            // Expected trucks: Book in, and the link to the Procurement plan
            $(document).off('click.giTrucks').on('click.giTrucks', '#giExpectedTrucks .js-book-in-btn', function (e) {
                e.preventDefault();
                if (typeof actionAccess !== 'undefined' && actionAccess.denyUnless &&
                    !actionAccess.denyUnless('grower.intake.create', 'You do not have permission to create kernel intake batches.')) {
                    return;
                }
                scope.bookIn($(this).data('procurement-id'));
            });
            $(document).off('click.giTrucksStrip').on('click.giTrucksStrip', '#giTrucksToggle', function (e) {
                e.preventDefault();
                scope.trucksOpen = !scope.trucksOpen;
                scope.renderExpectedTrucks();
            }).on('click.giTrucksStrip', '#giTrucksOld', function (e) {
                e.preventDefault();
                if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) _appRouter.routeTo('procurement-plan', true);
            });
            $('#giOpenProcurementPlanBtn').off('click').on('click', () => {
                if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) _appRouter.routeTo('procurement-plan', true);
            });

            $('#addSampleBtn').off('click').on('click', () => scope.showAddSampleModal());
            $('#createKernelBatchBtn').off('click').on('click', () => {
                if (typeof actionAccess !== 'undefined' && actionAccess.denyUnless &&
                    !actionAccess.denyUnless('grower.intake.create', 'You do not have permission to create kernel intake batches.')) {
                    return;
                }
                if (typeof _modal_grower_create_kernel_batch !== 'undefined' && _modal_grower_create_kernel_batch.show) {
                    _modal_grower_create_kernel_batch.show();
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Create batch modal not loaded. Please refresh the page.', 'error');
                }
            });
            $('#exportIntakeBatchesBtn').off('click').on('click', () => scope.exportIntakeBatches());

            $('#searchIntakeBatchesInput').on('input', () => scope.filterIntakeBatches());
            $('#filterIntakeBatchStatus').on('change', () => scope.filterIntakeBatches());
            $('#clearIntakeBatchFiltersBtn').on('click', () => {
                $('#searchIntakeBatchesInput').val('');
                $('#filterIntakeBatchStatus').val('');
                scope.filterIntakeBatches();
            });

            $('#giViewKanban, #giViewTable').off('click').on('click', function () {
                scope.toggleView($(this).data('view'));
            });

            $(document).on('click', '#intakeWetNisDropdownMenu .js-wet-nis-mode', function (e) {
                e.preventDefault();
                var mode = $(this).data('mode');
                if (mode && scope.wetNisDisplayMode !== mode) {
                    scope.wetNisDisplayMode = mode;
                    scope.renderIntakeBatches();
                    var subheads = document.getElementById('intakeWetNisSubheads');
                    if (subheads) {
                        subheads.classList.toggle('d-none', mode !== 'both');
                    }
                }
            });

            $(document).on('click', '#intakeBatchesTableBody .js-intake-batch-number-link, #giKanbanBoard .js-intake-batch-number-link', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const checklistDone = $(this).data('has-checklist') === 1 || $(this).data('has-checklist') === '1';
                const sampleDone = $(this).data('sample-done') === 1 || $(this).data('sample-done') === '1';
                if (!batchId) return;
                if (!checklistDone) {
                    if (typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.show) {
                        _modal_grower_receiving_checklist.show(batchId, undefined);
                    }
                } else if (!sampleDone) {
                    if (typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.show) {
                        _modal_grower_link_sample_to_batch.show(batchId);
                    }
                } else {
                    if (typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.show) {
                        _modal_grower_receiving_checklist.show(batchId, undefined);
                    }
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-checklist-btn, #giKanbanBoard .js-intake-checklist-btn', function (e) {
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const checklistId = ($(this).data('receiving-checklist-id') || '').trim() || undefined;
                if (batchId && typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.show) {
                    _modal_grower_receiving_checklist.show(batchId, checklistId);
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-sample-btn, #giKanbanBoard .js-intake-sample-btn', function (e) {
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const batchNumber = $(this).data('batch-number');
                const sampleId = ($(this).data('sample-submission-id') || '').trim();
                if (sampleId && typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.viewSample) {
                    _growerIntakeGrid.viewSample(sampleId);
                } else if (batchId && typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.show) {
                    _modal_grower_link_sample_to_batch.show(batchId, batchNumber);
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-release-btn, #giKanbanBoard .js-intake-release-btn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.moveBatchToRawStock) {
                    _growerIntakeGrid.moveBatchToRawStock(batchId);
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-edit, #giKanbanBoard .js-intake-edit', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const checklistId = ($(this).data('receiving-checklist-id') || '').trim() || undefined;
                if (batchId && typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.show) {
                    _modal_grower_receiving_checklist.show(batchId, checklistId);
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Receiving checklist modal not loaded. Please refresh the page.', 'error');
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-archive-btn, #giKanbanBoard .js-intake-archive-btn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.deleteBatch) {
                    _growerIntakeGrid.deleteBatch(batchId);
                }
            });
        },

        filterSamples: () => {
            const scope = _growerIntakeGrid;
            const searchTerm = ($('#searchSamplesInput').val() || '').toLowerCase();
            const statusFilter = $('#filterSampleStatus').val();
            const dateFilter = $('#filterSampleDate').val();
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
            scope.filteredSamples = scope.samples.filter((sample) => {
                const matchesSearch = !searchTerm ||
                    (sample.submission_number && sample.submission_number.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (sample.grower_name && sample.grower_name.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (sample.status && sample.status.toLowerCase().indexOf(searchTerm) >= 0);
                const matchesStatus = !statusFilter || sample.status === statusFilter;
                let matchesDate = true;
                if (dateFilter && sample.delivery_date) {
                    const deliveryDate = new Date(sample.delivery_date);
                    if (dateFilter === 'today') matchesDate = deliveryDate >= today;
                    else if (dateFilter === 'week') matchesDate = deliveryDate >= weekAgo;
                    else if (dateFilter === 'month') matchesDate = deliveryDate >= monthAgo;
                }
                return matchesSearch && matchesStatus && matchesDate;
            });
            scope.renderSamples();
        },

        loadSamples: async (forceRefresh = false) => {
            const scope = _growerIntakeGrid;
            try {
                const samples = await dataFunctions.getSampleSubmissions(null, forceRefresh);
                scope.samples = samples || [];
                scope.filteredSamples = scope.samples;
                scope.renderSamples();
            } catch (error) {
                console.error('Error loading samples:', error);
                scope.showError('Error loading samples: ' + error.message);
            }
        },

        renderSamples: () => {
            const scope = _growerIntakeGrid;
            const tbody = $('#samplesTableBody');
            if (!tbody.length) return;
            tbody.empty();
            if (scope.filteredSamples.length === 0) {
                if (scope.samples.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No sample submissions found. Click "New Sample Submission" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No samples match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            scope.filteredSamples.forEach((sample) => {
                const row = '<tr><td>' + (sample.submission_number || 'N/A') + '</td><td>' + (sample.grower_name || 'N/A') + '</td><td>' + ((typeof _common !== 'undefined' && _common.formatDateDDMMYYYY ? _common.formatDateDDMMYYYY(sample.delivery_date) : sample.delivery_date) || 'N/A') + '</td><td>' + (sample.wet_nut_in_shell_kg || '0') + '</td><td>' + (sample.moisture_content_percentage || '0') + '%</td><td><span class="badge bg-info">' + (sample.status || 'pending') + '</span></td><td><button class="btn btn-sm btn-outline-primary js-view-sample" data-sample-id="' + sample.id + '"><i class="fas fa-eye"></i></button></td></tr>';
                tbody.append(row);
            });
            tbody.find('.js-view-sample').on('click', function () {
                const sampleId = $(this).data('sample-id');
                if (sampleId) scope.viewSample(sampleId);
            });
        },

        filterIntakeBatches: () => {
            const scope = _growerIntakeGrid;
            const searchTerm = ($('#searchIntakeBatchesInput').val() || '').toLowerCase();
            const statusFilter = $('#filterIntakeBatchStatus').val();
            const released = (typeof _giBags !== 'undefined') ? _giBags.releasedBatches() : [];
            scope.filteredIntakeBatches = scope.intakeBatches.concat(released).filter((b) => {
                const matchesSearch = !searchTerm ||
                    (b.batch_number && b.batch_number.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (b.grower_name && b.grower_name.toLowerCase().indexOf(searchTerm) >= 0);
                var matchesStatus = !statusFilter;
                if (statusFilter === 'released') {
                    matchesStatus = !!b._released;
                } else if (statusFilter) {
                    if (b._released) {
                        matchesStatus = false;
                    } else if (b.status === statusFilter) {
                        matchesStatus = true;
                    } else {
                        matchesStatus = getIntakeColumnKey(b) === statusFilter;
                    }
                }
                return matchesSearch && matchesStatus;
            });
            if (scope.currentView === 'kanban') {
                scope.renderKanbanIntake();
            } else {
                scope.renderIntakeBatches();
            }
        },

        loadIntakeBatches: async (forceRefresh) => {
            const scope = _growerIntakeGrid;
            const df =
                typeof _dataFunctions !== 'undefined' && _dataFunctions && typeof _dataFunctions.getKernelBatches === 'function'
                    ? _dataFunctions
                    : typeof dataFunctions !== 'undefined' && dataFunctions && typeof dataFunctions.getKernelBatches === 'function'
                      ? dataFunctions
                      : null;
            if (!df) {
                console.error('[Grower Intake] dataFunctions.getKernelBatches not available');
                scope.intakeBatches = [];
                scope.filterIntakeBatches();
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Cannot load batches',
                        text: 'Data layer not ready. Refresh the page or sign in again.'
                    });
                }
                return;
            }
            try {
                const all = await df.getKernelBatches(null, forceRefresh, { status: 'intake,receiving', limit: 500 });
                scope.intakeBatches = all || [];
                scope.filterIntakeBatches();
                if (typeof _giBags !== 'undefined') _giBags.load();
            } catch (e) {
                console.error('Error loading intake batches:', e);
                scope.intakeBatches = [];
                scope.filterIntakeBatches();
                var msg = (e && e.message) ? String(e.message) : 'Could not load grower intake batches.';
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Failed to load batches',
                        text: msg,
                        footer: '<span class="small text-muted">Try Refresh (Ctrl+F5). If you were signed out, sign in again.</span>'
                    });
                }
            }
        },

        /** Update one batch's actual weight in memory and re-render (so table shows new value without waiting for refetch). */
        setBatchActualWeight: (batchId, actualWetNisKg, suppliedKg) => {
            const scope = _growerIntakeGrid;
            const id = (batchId || '').toString().trim();
            if (!id) return;
            const idLower = id.toLowerCase();
            const batch = scope.intakeBatches.find((b) => {
                if (!b) return false;
                const bid = (b.id != null ? String(b.id) : '').trim();
                const bnum = (b.batch_number != null ? String(b.batch_number) : '').trim();
                return bid.toLowerCase() === idLower || bnum === id;
            });
            if (batch) {
                batch.actual_wet_nis_kg = actualWetNisKg != null ? Number(actualWetNisKg) : null;
                if (suppliedKg != null) batch.wet_nis_received_kg = Number(suppliedKg);
                batch.weight_difference_kg = (batch.wet_nis_received_kg != null && batch.actual_wet_nis_kg != null)
                    ? batch.wet_nis_received_kg - batch.actual_wet_nis_kg : null;
                scope.filterIntakeBatches();
            }
        },

        renderIntakeBatches: () => {
            const scope = _growerIntakeGrid;
            const tbody = $('#intakeBatchesTableBody');
            if (!tbody.length) return;
            tbody.empty();
            if (scope.filteredIntakeBatches.length === 0) {
                if (scope.intakeBatches.length === 0) {
                    tbody.html('<tr><td colspan="9" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No kernel batches in intake. Create one to start the journey.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="9" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search.</td></tr>');
                }
                return;
            }
            scope.filteredIntakeBatches.forEach((b) => {
                const receivedDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY ? _common.formatDateDDMMYYYY(b.received_date) : b.received_date) || 'N/A';
                const checklistDone = !!b.has_receiving_checklist;
                const sampleDone = !!b.has_ziplock_sample && !!b.has_5kg_sample;
                const canRelease = checklistDone && sampleDone;
                var batchNum = (b.batch_number || '').toString();
                var batchNumEscaped = batchNum.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

                /* Stage 1: show only one option per workflow — Receiving checklist first, then New batch sample, then complete */
                var stage1Btn;
                if (!checklistDone) {
                    stage1Btn = '<button type="button" class="btn btn-sm btn-primary intake-step-btn js-intake-checklist-btn" data-batch-id="' + b.id + '" title="Receiving checklist"><i class="fas fa-clipboard-check me-1"></i><span class="intake-btn-text">Receiving checklist</span></button>';
                } else if (!sampleDone) {
                    stage1Btn = '<button type="button" class="btn btn-sm btn-primary intake-step-btn js-intake-sample-btn" data-batch-id="' + b.id + '" data-batch-number="' + batchNumEscaped + '" title="Take the batch sample"><i class="fas fa-vial me-1"></i><span class="intake-btn-text">Take sample</span></button>';
                } else {
                    stage1Btn = '<button type="button" class="btn btn-sm btn-primary intake-step-btn js-intake-sample-btn" data-batch-id="' + b.id + '" data-batch-number="' + batchNumEscaped + '" title="View batch sample"><i class="fas fa-check me-1"></i><span class="intake-btn-text">Batch sample</span></button>';
                }

                var releaseItem = canRelease
                    ? '<a class="dropdown-item js-intake-release-btn" href="#" data-batch-id="' + b.id + '"><i class="fas fa-arrow-right me-2"></i>Release to production</a>'
                    : '<span class="dropdown-item text-muted" role="button" tabindex="0">Release to production</span>';
                var editItem = '<a class="dropdown-item js-intake-edit" href="#" data-batch-id="' + b.id + '"><i class="fas fa-pen me-2"></i>Edit</a>';
                var deleteItem = '<a class="dropdown-item js-intake-archive-btn text-secondary" href="#" data-batch-id="' + b.id + '"><i class="fas fa-archive me-2"></i>Archive batch</a>';
                var actionsCell = MacTableActions.render({
                    id: 'intakeBatchActions' + b.id,
                    items: [releaseItem, editItem, deleteItem]
                });

                var stage1Cell = '<div class="intake-stage1-buttons">' + stage1Btn + '</div>';

                var batchNumberCell = '<a href="#" class="intake-batch-number-link js-intake-batch-number-link" role="button"' +
                    ' data-batch-id="' + b.id + '"' +
                    ' data-has-checklist="' + (checklistDone ? '1' : '0') + '"' +
                    ' data-sample-done="' + (sampleDone ? '1' : '0') + '">' +
                    batchNumEscaped + '</a>';

                var suppliedVal = b.wet_nis_received_kg != null ? _common.formatKg(b.wet_nis_received_kg) : '';
                var actualVal = b.actual_wet_nis_kg != null ? _common.formatKg(b.actual_wet_nis_kg) : '';
                var wetCellContent;
                if (scope.wetNisDisplayMode === 'actual') {
                    wetCellContent = actualVal;
                } else if (scope.wetNisDisplayMode === 'both') {
                    wetCellContent = '<div class="intake-wet-both-cell">' +
                        '<span class="intake-wet-actual-val">' + (actualVal !== '' ? actualVal : '—') + '</span>' +
                        '<span class="intake-wet-supplied-val">' + (suppliedVal !== '' ? suppliedVal : '—') + '</span>' +
                        '</div>';
                } else {
                    wetCellContent = suppliedVal;
                }

                var gib = (typeof _giBags !== 'undefined') ? _giBags : null;
                if (b._released) {
                    // Released to production with bags still waiting: read-only here, no stage steps.
                    stage1Cell = '<span class="text-muted small">In production</span>';
                    actionsCell = '';
                    batchNumberCell = batchNumEscaped;
                }
                const row = '<tr class="js-intake-batch-row" data-batch-id="' + b.id + '">' +
                    '<td class="intake-col-expand">' + (gib ? gib.tableToggle(b.id) : '') + '</td>' +
                    '<td class="intake-col-batch">' + batchNumberCell + '</td>' +
                    '<td class="intake-col-grower d-none d-md-table-cell">' + (b.grower_name || '') + '</td>' +
                    '<td class="intake-col-date" title="Received date">' + receivedDate + '</td>' +
                    '<td class="intake-col-wet d-none d-sm-table-cell">' + wetCellContent + '</td>' +
                    '<td class="intake-col-bags">' + (gib ? gib.tableCell(b.id) : '') + '</td>' +
                    '<td class="intake-col-stage1">' + stage1Cell + '</td>' +
                    '<td class="intake-col-status">' + (b._released ? KanbanHelper.statusBadge('Released – cracking', 'last') : (function() { var ik = getIntakeColumnKey(b); var sp = ik === 'receiving' ? 'first' : ik === 'quality_approved' ? 'last' : 'mid'; return KanbanHelper.statusBadge((INTAKE_KANBAN_COLUMNS.filter(function (c) { return c.key === ik; })[0] || { label: b.status || '' }).label, sp); })()) + '</td>' +
                    '<td class="intake-col-actions mac-table-actions-col">' + actionsCell + '</td></tr>';
                tbody.append(row + (gib ? gib.tableRow(b.id, 9) : ''));
            });
            MacTableActions.init(document.getElementById('intakeBatchesTable'));
        },

        toggleView: (view) => {
            const scope = _growerIntakeGrid;
            scope.currentView = view;
            var board = document.getElementById('giKanbanBoard');
            var table = document.getElementById('giTableCard');
            if (view === 'kanban') {
                if (board) board.style.display = '';
                if (table) table.style.display = 'none';
                scope.renderKanbanIntake();
            } else {
                if (board) board.style.display = 'none';
                if (table) table.style.display = '';
                scope.renderIntakeBatches();
            }
            $('#giViewKanban').toggleClass('active', view === 'kanban');
            $('#giViewTable').toggleClass('active', view === 'table');
        },

        renderKanbanIntake: () => {
            const scope = _growerIntakeGrid;
            if (typeof KanbanHelper === 'undefined') return;

            KanbanHelper.render('giKanbanBoard', INTAKE_KANBAN_COLUMNS, scope.filteredIntakeBatches, getIntakeColumnKey, function (b) {
                var batchNum = (b.batch_number || '').toString();
                var esc = KanbanHelper._esc;
                var receivedDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY ? _common.formatDateDDMMYYYY(b.received_date) : b.received_date) || '';
                var checklistDone = !!b.has_receiving_checklist;
                var sampleDone = !!b.has_ziplock_sample && !!b.has_5kg_sample;
                var canRelease = checklistDone && sampleDone;

                var stage1Html;
                if (!checklistDone) {
                    stage1Html = '<button type="button" class="btn btn-sm btn-primary js-intake-checklist-btn" data-batch-id="' + b.id + '" title="Receiving checklist"><i class="fas fa-clipboard-check me-1"></i>Checklist</button>';
                } else if (!sampleDone) {
                    stage1Html = '<button type="button" class="btn btn-sm btn-primary js-intake-sample-btn" data-batch-id="' + b.id + '" data-batch-number="' + esc(batchNum) + '" title="Take the batch sample"><i class="fas fa-vial me-1"></i>Take sample</button>';
                } else {
                    stage1Html = '<button type="button" class="btn btn-sm btn-outline-secondary js-intake-sample-btn" data-batch-id="' + b.id + '" data-batch-number="' + esc(batchNum) + '" title="View the batch sample"><i class="fas fa-check"></i><span class="visually-hidden">View sample</span></button>';
                }

                var releaseHtml = canRelease
                    ? '<button type="button" class="btn btn-sm btn-primary js-intake-release-btn" data-batch-id="' + b.id + '" title="Release to production"><i class="fas fa-arrow-right me-1"></i>Release</button>'
                    : '';
                var deleteHtml = '<button type="button" class="btn btn-sm btn-outline-secondary js-intake-archive-btn" data-batch-id="' + b.id + '" title="Archive batch"><i class="fas fa-archive"></i></button>';

                var kgForCard = b.actual_wet_nis_kg != null ? b.actual_wet_nis_kg : b.wet_nis_received_kg;
                var tonnesLabel = kgForCard != null ? _common.formatKg(Number(kgForCard) / 1000, 1) + ' t' : '';
                var gib = (typeof _giBags !== 'undefined') ? _giBags : null;

                // Collapsed card: number and tonnes, grower, one bag line, the next step. The column is the status.
                var html = '<div class="kanban-card js-intake-batch-row gi-card' + (b._released ? ' gi-card-released' : '') + '" data-batch-id="' + b.id + '">';
                html += '<div class="gi-card-head"><span class="kanban-card-title">' + esc(batchNum) + '</span>' +
                    (tonnesLabel ? '<span class="gi-card-t" title="' + (b.actual_wet_nis_kg != null ? 'Weighed total' : "Supplier's declared") + (receivedDate ? ' · received ' + esc(receivedDate) : '') + '">' + esc(tonnesLabel) + '</span>' : '') + '</div>';
                if (b.grower_name) html += '<div class="kanban-card-meta"><div class="kanban-card-meta-item" title="Grower / supplier"><i class="fas fa-user"></i> ' + esc(b.grower_name) + '</div></div>';
                if (gib) html += gib.cardSummary(b.id, !!b._released);
                var bagsBtn = gib ? gib.toggleButton(b.id) : '';
                var steps = b._released ? '' : (canRelease ? releaseHtml + stage1Html : stage1Html) + deleteHtml;
                if (steps || bagsBtn) html += '<div class="kanban-card-actions gi-card-actions">' + steps + (bagsBtn ? '<span class="gi-card-bags">' + bagsBtn + '</span>' : '') + '</div>';
                if (gib) html += gib.cardPanel(b.id);
                html += '</div>';
                return html;
            });

            // Drag-and-drop: forward transitions only
            var colOrder = ['receiving', 'intake_received', 'quality_approved'];
            // Re-bind procurement drop zone after every Kanban render (DOM is replaced by KanbanHelper)
            if (typeof _growerIntakeGrid._bindProcurementReceivingDrop === 'function') {
                _growerIntakeGrid._bindProcurementReceivingDrop();
            }
            KanbanHelper.enableDragDrop('giKanbanBoard', function (batchId, fromKey, toKey) {
                if (fromKey === 'released' || toKey === 'released') return;
                var fromIdx = colOrder.indexOf(fromKey);
                var toIdx = colOrder.indexOf(toKey);
                if (toIdx <= fromIdx) return; // block backward moves

                if (toKey === 'intake_received' && fromKey === 'receiving') {
                    if (typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.show) {
                        _modal_grower_receiving_checklist.show(batchId);
                    }
                } else if ((toKey === 'quality_pending' || toKey === 'quality_approved') && (fromKey === 'intake_received' || fromKey === 'receiving')) {
                    if (typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.show) {
                        _modal_grower_link_sample_to_batch.show(batchId);
                    }
                }
            }, { noDrag: (typeof _giBags !== 'undefined') ? _giBags.noDragSelector : '' });
        },

        moveBatchToRawStock: async (batchId) => {
            const scope = _growerIntakeGrid;
            if (!batchId) return;
            var relBatch = scope.intakeBatches.find(function (x) { return String(x.id) === String(batchId); });
            var relNumber = relBatch && relBatch.batch_number ? relBatch.batch_number : 'batch';
            var relDelivery = relBatch && relBatch.intake_data && relBatch.intake_data.delivery;
            var relBags = relDelivery && Array.isArray(relDelivery.bags) ? relDelivery.bags : [];
            var relHtml = '';
            if (relBags.length) {
                var relTotal = relBags.reduce(function (sum, bag) { return sum + (Number(bag.weight_kg) || 0); }, 0);
                relHtml += '<p class="mb-2">Weighed total: <strong>' + _common.escapeHtml(_common.formatKg(relTotal)) + ' kg</strong> from ' + relBags.length + ' bag' + (relBags.length === 1 ? '' : 's') + '.</p>';
            }
            relHtml += '<p class="mb-0 text-muted">The pre-sizer figure is now entered when bags are allocated to a silo.</p>';
            const confirmRes = await Swal.fire({
                title: 'Release ' + _common.escapeHtml(relNumber) + ' to production',
                html: relHtml,
                showCancelButton: true,
                confirmButtonText: 'Release',
                cancelButtonText: 'Cancel'
            });
            if (!confirmRes.isConfirmed) return;
            try {
                const result = await dataFunctions.releaseKernelToProduction({ kernel_id: batchId });
                if (result && result.success !== false) {
                    var batch = scope.intakeBatches.find(function (x) { return String(x.id) === String(batchId); });
                    scope.loadIntakeBatches(true);
                    if (typeof HandoffDialog !== 'undefined' && HandoffDialog.showKernelReleaseToProduction) {
                        await HandoffDialog.showKernelReleaseToProduction(batch || { batch_number: batchId });
                    } else if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'success', title: 'Released to production', text: 'Batch is now in Kernel Production. Start production, then complete and run tests to release to stock.', timer: 2500, showConfirmButton: false });
                    }
                } else {
                    throw new Error(result && result.error ? result.error : 'Release failed');
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release batch', 'error');
            }
        },

        archiveBatch: (batchId) => {
            const scope = _growerIntakeGrid;
            if (!batchId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.deactivateKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Archive is not available. Please refresh.', 'error');
                return;
            }
            const batch = scope.intakeBatches.find((b) => String(b.id) === String(batchId));
            const batchLabel = batch ? (batch.batch_number || 'this batch') : 'this batch';
            Swal.fire({
                title: 'Archive kernel batch?',
                html: 'Send <strong>' + batchLabel + '</strong> to the archive? It will be removed from intake and production lists. Restore later from Stock → <strong>View archive</strong>.',
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
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Batch archived', text: batchLabel + ' has been sent to the archive.', timer: 2200, showConfirmButton: false });
                    scope.loadIntakeBatches(true);
                }).catch((e) => {
                    console.error(e);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to archive batch', 'error');
                });
            });
        },

        deleteBatch: (batchId) => {
            _growerIntakeGrid.archiveBatch(batchId);
        },

        showAddSampleModal: () => {
            if (typeof Swal !== 'undefined') Swal.fire('Info', 'Sample submission form coming soon', 'info');
        },

        viewSample: async (sampleId) => {
            const scope = _growerIntakeGrid;
            if (!sampleId) return;
            let sample = (scope.samples || []).find((s) => s.id === sampleId);
            if (!sample) {
                try {
                    await scope.loadSamples(true);
                    sample = (scope.samples || []).find((s) => s.id === sampleId);
                } catch (e) { console.error(e); }
            }
            if (!sample) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'Sample not found.', 'info');
                return;
            }
            const html = '<div class="text-start small">' +
                '<p><strong>Submission:</strong> ' + (sample.submission_number || '—') + '</p>' +
                '<p><strong>Grower:</strong> ' + (sample.grower_name || '—') + '</p>' +
                '<p><strong>Delivery date:</strong> ' + ((typeof _common !== 'undefined' && _common.formatDateDDMMYYYY ? _common.formatDateDDMMYYYY(sample.delivery_date) : sample.delivery_date) || 'N/A') + '</p>' +
                '<p><strong>Wet NIS (kg):</strong> ' + (sample.wet_nut_in_shell_kg != null ? sample.wet_nut_in_shell_kg : '—') + '</p>' +
                '<p><strong>Moisture %:</strong> ' + (sample.moisture_content_percentage != null ? sample.moisture_content_percentage : '—') + '</p>' +
                '<p><strong>Status:</strong> ' + (sample.status || '—') + '</p>' +
                '</div>';
            if (typeof Swal !== 'undefined') Swal.fire({ title: 'Sample submission', html, confirmButtonText: 'OK', width: '400px' });
        },

        showError: (message) => {
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: message });
        },

        exportIntakeBatches: () => {
            const scope = _growerIntakeGrid;
            if (!scope.intakeBatches || scope.intakeBatches.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            const columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'grower_name', label: 'Grower / supplier' },
                { key: 'received_date', label: 'Received Date' },
                { key: 'wet_nis_received_kg', label: 'Wet NIS (kg)' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.intakeBatches, 'grower_intake_batches', columns);
            } else if (typeof Swal !== 'undefined') {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        },

        exportSamples: () => {
            const scope = _growerIntakeGrid;
            if (!scope.samples || scope.samples.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No samples to export', 'info');
                return;
            }
            const columns = [
                { key: 'submission_number', label: 'Submission Number' },
                { key: 'grower_name', label: 'Grower' },
                { key: 'delivery_date', label: 'Delivery Date' },
                { key: 'wet_nut_in_shell_kg', label: 'Wet NIS (kg)' },
                { key: 'moisture_content_percentage', label: 'Moisture %' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.samples, 'sample_submissions', columns);
            } else if (typeof Swal !== 'undefined') {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        },

        // ================================================================
        // Procurement Calendar methods
        // ================================================================

        _procIsoFromDate: (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),

        // Intake calendar: what was actually received each day, whatever stage the batch is at now.
        // (The Procurement Calendar above is the plan; this is what happened.)
        initActivityCalendar: () => {
            if (typeof MacActivityCalendar === 'undefined') return;
            var df = typeof _dataFunctions !== 'undefined' && _dataFunctions ? _dataFunctions
                   : typeof dataFunctions !== 'undefined' ? dataFunctions : null;
            var NOW_AT = {
                intake: 'Still at intake', receiving: 'Still at intake',
                production: 'In production', qa: 'Awaiting release', complete: 'In stock'
            };
            MacActivityCalendar.create({
                mountId: 'giActivityCalendarMount',
                idPrefix: 'giActivityCalendar',
                title: 'Intake Calendar',
                icon: 'fa-calendar-check',
                intro: 'Days shaded green had kernel batches received. Click a day to see which batches came in, from which grower, and where each batch is now.',
                emptyDayText: 'No batches were received on this day.',
                emptyMonthText: 'No batches were received in this month.',
                loadMonth: async (fromIso, toIso) => {
                    if (!df || typeof df.getKernelBatchesReceivedBetween !== 'function') throw new Error('Kernel batches are not available right now.');
                    var batches = await df.getKernelBatchesReceivedBetween(fromIso, toIso);
                    return batches.map(function (b) {
                        var kg = (b.actual_wet_nis_kg != null && b.actual_wet_nis_kg !== '') ? b.actual_wet_nis_kg : b.wet_nis_received_kg;
                        var tags = [{ text: 'Received' }];
                        if (kg != null && kg !== '' && Number(kg) > 0) tags.push({ text: MacActivityCalendar.formatKg(kg) + ' wet NIS', tone: 'grey' });
                        var status = String(b.status || '').toLowerCase();
                        if (status) tags.push({ text: NOW_AT[status] || ('Now: ' + status), tone: 'blue' });
                        return {
                            date: String(b.received_date).slice(0, 10),
                            title: b.batch_number || 'Batch',
                            subtitle: b.grower_name || '',
                            tags: tags
                        };
                    });
                }
            });
        },

        // ---- Expected trucks (from the Procurement plan) ----

        _procEsc: (str) => {
            if (str == null || str === '') return '';
            var div = document.createElement('div');
            div.appendChild(document.createTextNode(String(str)));
            return div.innerHTML.replace(/"/g, '&quot;');
        },

        _procCanBook: () => typeof window.hasAction === 'function' && !!window.hasAction('grower.intake.create'),

        _procFmtDate: (iso) => {
            if (!iso) return '';
            var p = String(iso).slice(0, 10).split('-');
            var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
            var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return days[d.getDay()] + ' ' + d.getDate() + ' ' + months[d.getMonth()];
        },

        _procFmtTonnes: (kg) => {
            var n = Number(kg);
            if (!isFinite(n) || n <= 0) return '';
            return n >= 1000 ? '~' + (Math.round(n / 100) / 10) + ' t' : '~' + Math.round(n) + ' kg';
        },

        _procAreaLabel: (code) => {
            var scope = _growerIntakeGrid;
            if (!code) return '';
            var a = (scope.procurementAreas || []).filter(function (x) { return x.code === code; })[0];
            return a ? a.label : '';
        },

        /** Loads the plan for today-14 .. today+7 and draws the Expected trucks list. */
        loadProcurements: async (forceRefresh) => {
            const scope = _growerIntakeGrid;
            var df = typeof _dataFunctions !== 'undefined' && _dataFunctions ? _dataFunctions
                   : typeof dataFunctions !== 'undefined' ? dataFunctions : null;
            var now = new Date();
            var from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
            var to = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
            scope.procurementLoadFailed = false;
            try {
                if (!df || typeof df.getProcurementPlan !== 'function') throw new Error('Procurement plan is not available.');
                var plan = await df.getProcurementPlan(scope._procIsoFromDate(from), scope._procIsoFromDate(to));
                if (!plan) throw new Error('Could not load the plan.');
                scope.procurementToday = plan.today ? String(plan.today).slice(0, 10) : scope._procIsoFromDate(now);
                scope.procurementAreas = Array.isArray(plan.areas) ? plan.areas : [];
                scope.procurementItems = (plan.deliveries || []).filter(function (p) { return p && p.status !== 'received'; });
                scope.procurementMeta = {
                    poolKg: Number(plan.system_pool_kg) || 0,
                    ratePerDay: Number(plan.settings && plan.settings.planned_kg_per_day) || 0,
                    dayTypes: Array.isArray(plan.day_types) ? plan.day_types : []
                };
            } catch (e) {
                console.error('[Expected trucks] Failed to load:', e);
                scope.procurementItems = [];
                scope.procurementLoadFailed = true;
            }
            scope.renderExpectedTrucks();
        },

        /** Expected trucks: a strip above the board. Folded to one line; opened, a row of truck cards for
         *  late (up to LATE_DAYS), today and tomorrow. Older late trucks are left to the Procurement plan. */
        renderExpectedTrucks: () => {
            const scope = _growerIntakeGrid;
            var LATE_DAYS = 14;
            var host = document.getElementById('giExpectedTrucks');
            if (!host) return;
            if (scope.procurementLoadFailed) {
                host.innerHTML = '<div class="gi-trucks-line"><strong>Expected trucks</strong><span class="text-muted">Could not load them. Refresh the page to try again.</span></div>';
                scope._renderProcurementButton();
                return;
            }
            var esc = scope._procEsc;
            var today = scope.procurementToday || scope._procIsoFromDate(new Date());
            var tp = today.split('-');
            var d0 = new Date(parseInt(tp[0], 10), parseInt(tp[1], 10) - 1, parseInt(tp[2], 10));
            var iso = function (n) { return scope._procIsoFromDate(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + n)); };
            var tomorrow = iso(1), lateFrom = iso(-LATE_DAYS), weekEnd = iso(6);
            var canBook = scope._procCanBook();
            var items = (scope.procurementItems || []).slice().sort(function (x, y) {
                return String(x.scheduled_date).localeCompare(String(y.scheduled_date)) ||
                    ((x.sort_index != null ? x.sort_index : 9999) - (y.sort_index != null ? y.sort_index : 9999));
            });
            var old = [], late = [], todays = [], tom = [], week = 0;
            items.forEach(function (p) {
                var d = String(p.scheduled_date || '').slice(0, 10);
                if (d < lateFrom) old.push(p);
                else if (d < today) late.push(p);
                else if (d === today) todays.push(p);
                else if (d === tomorrow) tom.push(p);
                if (d >= today && d <= weekEnd) week++;
            });

            var parts = [];
            if (late.length) parts.push('<span class="gi-trucks-late">' + late.length + ' late</span>');
            parts.push(todays.length + ' today');
            parts.push(week + ' in the next 7 days');
            var shown = late.length + todays.length + tom.length;
            var open = !!scope.trucksOpen && shown > 0;
            var html = '<div class="gi-trucks-line"><strong>Expected trucks</strong><span>' + parts.join(' \u00B7 ') + '</span>' +
                (shown ? '<button type="button" class="btn btn-sm btn-outline-secondary ms-auto" id="giTrucksToggle" aria-expanded="' + open + '">' + (open ? 'Hide \u25B4' : 'Show \u25BE') + '</button>' : '') + '</div>';

            if (open) {
                var card = function (p, kind) {
                    var area = scope._procAreaLabel(p.storage_area_code);
                    var kgTxt = scope._procFmtTonnes(p.predicted_weight_kg);
                    var when = kind === 'late' ? 'Was due ' + scope._procFmtDate(p.scheduled_date) : (kind === 'today' ? 'Today' : 'Tomorrow');
                    var h = '<div class="gi-truck-card is-' + kind + '" data-procurement-id="' + esc(p.id) + '">';
                    h += '<div class="gi-truck-card-top">' + (canBook ? '<span class="gi-truck-handle" title="Drag onto Receiving"><i class="fas fa-grip-vertical" aria-hidden="true"></i><span class="visually-hidden">Drag handle</span></span>' : '') +
                        '<span class="gi-truck-when">' + esc(when) + (p.status === 'confirmed' ? '' : ' \u00B7 not confirmed') + '</span></div>';
                    h += '<div class="gi-truck-title">' + esc(p.grower || 'Grower') + '</div>';
                    h += '<div class="gi-truck-sub">' + esc([p.truck_label, kgTxt, area].filter(Boolean).join(' \u00B7 ')) + '</div>';
                    if (canBook && kind !== 'tomorrow') h += '<button type="button" class="btn btn-sm btn-primary js-book-in-btn" data-procurement-id="' + esc(p.id) + '">Book in</button>';
                    return h + '</div>';
                };
                html += '<div class="gi-trucks-list" data-kind="all">' +
                    late.map(function (p) { return card(p, 'late'); }).join('') +
                    todays.map(function (p) { return card(p, 'today'); }).join('') +
                    tom.map(function (p) { return card(p, 'tomorrow'); }).join('') + '</div>';
            }
            if (old.length) {
                html += '<div class="gi-trucks-old"><button type="button" class="btn btn-link btn-sm p-0" id="giTrucksOld">' + old.length + (old.length === 1 ? ' old truck was' : ' old trucks were') +
                    ' never booked in \u2192 sort out in the Procurement plan</button></div>';
            }
            host.innerHTML = html;
            scope._bindTruckDrag();
            scope._renderProcurementButton();
        },

        /** Header button: "Procurement plan · N trucks this week", with an amber dot when the next 7 days
         *  of the plan take stock under 100 t (same day rules as the plan: weekends off unless set). */
        _renderProcurementButton: () => {
            const scope = _growerIntakeGrid;
            var btn = document.getElementById('giOpenProcurementPlanBtn');
            if (!btn) return;
            var today = scope.procurementToday || scope._procIsoFromDate(new Date());
            var p = today.split('-');
            var day0 = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
            var keys = [];
            for (var i = 0; i < 7; i++) keys.push(scope._procIsoFromDate(new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + i)));
            var week = (scope.procurementItems || []).filter(function (x) {
                var d = String(x.scheduled_date || '').slice(0, 10);
                return d >= keys[0] && d <= keys[6];
            });
            var low = null, meta = scope.procurementMeta;
            if (meta && meta.ratePerDay > 0) {
                var types = {};
                meta.dayTypes.forEach(function (r) { types[String(r.day).slice(0, 10)] = r; });
                var stock = meta.poolKg;
                keys.forEach(function (k) {
                    if (low) return;
                    week.forEach(function (x) { if (String(x.scheduled_date).slice(0, 10) === k) stock += Number(x.predicted_weight_kg) || 0; });
                    var wd = new Date(parseInt(k.slice(0, 4), 10), parseInt(k.slice(5, 7), 10) - 1, parseInt(k.slice(8, 10), 10)).getDay();
                    var row = types[k];
                    var type = row ? row.day_type : ((wd === 0 || wd === 6) ? 'off' : 'work');
                    var ov = row && row.kg_override != null ? Number(row.kg_override) : null;
                    if (type === 'work') stock -= ov != null ? ov : meta.ratePerDay;
                    else if (type === 'half') stock -= ov != null ? ov : meta.ratePerDay / 2;
                    if (stock < 100000) low = k;
                });
            }
            btn.innerHTML = '<i class="fas fa-calendar-days me-1"></i>Procurement plan · ' + week.length + (week.length === 1 ? ' truck' : ' trucks') + ' this week' +
                (low ? '<span class="gi-proc-dot" aria-hidden="true"></span>' : '');
            btn.title = low ? 'Stock drops below 100 t around ' + scope._procFmtDate(low) + '. Open the procurement plan.' : 'Open the procurement plan';
        },

        /** Late and Today rows can be dragged into the Receiving column (copy; the drop handler opens Book in). */
        _bindTruckDrag: () => {
            const scope = _growerIntakeGrid;
            (scope._truckSortables || []).forEach(function (s) { if (s && s.destroy) s.destroy(); });
            scope._truckSortables = [];
            if (typeof Sortable === 'undefined' || !scope._procCanBook()) return;
            document.querySelectorAll('#giExpectedTrucks .gi-trucks-list').forEach(function (el) {
                scope._truckSortables.push(Sortable.create(el, {
                    group: { name: 'gi-procurement-pills', pull: 'clone', put: false },
                    sort: false,
                    handle: '.gi-truck-handle',
                    animation: 150,
                    ghostClass: 'sortable-ghost'
                }));
            });
        },

        bookIn: (procurementId) => {
            const scope = _growerIntakeGrid;
            var truck = (scope.procurementItems || []).filter(function (p) { return String(p.id) === String(procurementId); })[0];
            if (!truck) {
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'info', title: 'Already booked in', text: 'That truck has already been booked in or cancelled.' });
                return false;
            }
            if (typeof _modal_grower_create_kernel_batch !== 'undefined' && _modal_grower_create_kernel_batch.showFromProcurement) {
                _modal_grower_create_kernel_batch.showFromProcurement(truck, scope.procurementAreas);
                return true;
            }
            if (typeof Swal !== 'undefined') Swal.fire('Error', 'Create batch modal not loaded. Please refresh the page.', 'error');
            return false;
        },

        _bindProcurementReceivingDrop: () => {
            const scope = _growerIntakeGrid;
            if (typeof Sortable === 'undefined') return;

            // Destroy previous receiving sortable
            if (scope._procurementReceivingSortable && scope._procurementReceivingSortable.destroy) {
                scope._procurementReceivingSortable.destroy();
                scope._procurementReceivingSortable = null;
            }

            var boardEl = document.getElementById('giKanbanBoard');
            if (!boardEl) return;
            var receivingBody = boardEl.querySelector('.kanban-column-body[data-column-key="receiving"]');
            if (!receivingBody) return;

            scope._procurementReceivingSortable = Sortable.create(receivingBody, {
                group: { name: 'gi-procurement-pills', put: true, pull: false },
                animation: 150,
                onAdd: function (evt) {
                    var pill = evt.item;
                    var procurementId = pill.getAttribute('data-procurement-id');
                    // Always revert — procurement pills should never live in the Kanban
                    receivingBody.removeChild(pill);
                    if (!procurementId) return;

                    // Find the procurement data
                    var procurement = null;
                    (scope.procurementItems || []).forEach(function (p) { if (p.id === procurementId) procurement = p; });
                    if (!procurement) return;

                    if (typeof actionAccess !== 'undefined' && actionAccess.denyUnless &&
                        !actionAccess.denyUnless('grower.intake.create', 'You do not have permission to create kernel intake batches from procurement.')) {
                        return;
                    }

                    // Open create-batch modal pre-filled
                    if (typeof _modal_grower_create_kernel_batch !== 'undefined' && _modal_grower_create_kernel_batch.showFromProcurement) {
                        _modal_grower_create_kernel_batch.showFromProcurement(procurement, scope.procurementAreas);
                    } else {
                        console.warn('[Procurement] showFromProcurement not available on create-batch modal');
                    }
                }
            });

            // Add visual drop-target hint while dragging
            receivingBody.addEventListener('dragenter', function () {
                receivingBody.classList.add('gi-receiving-drop-target');
            });
            receivingBody.addEventListener('dragleave', function (e) {
                if (!receivingBody.contains(e.relatedTarget)) {
                    receivingBody.classList.remove('gi-receiving-drop-target');
                }
            });
            receivingBody.addEventListener('drop', function () {
                receivingBody.classList.remove('gi-receiving-drop-target');
            });
        }

    };
}();
if (typeof window !== 'undefined') {
    window.growerIntakeGrid = _growerIntakeGrid;
}
