/**
 * Grower Intake Grid Module
 * Route-only modal pattern: parent loads modal content, routes to modals; modals own logic.
 * See MODAL_PATTERN_INSTRUCTIONS.md, SEPARATING_LARGE_JS_FILES.md
 */
var _growerIntakeGrid = function () {
    'use strict';

    var INTAKE_KANBAN_COLUMNS = [
        { key: 'receiving', label: 'Receiving' },
        { key: 'intake_received', label: 'Intake Received' },
        { key: 'quality_pending', label: 'Quality Pending' },
        { key: 'quality_approved', label: 'Quality Approved' }
    ];

    function getIntakeColumnKey(b) {
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
        wetNisDisplayMode: 'both', // 'supplied' | 'actual' | 'both'
        currentView: 'kanban',
        releaseBatchIdForSilos: null,
        siloList: [],

        // Procurement calendar state
        procurementCalendarMonth: null,
        selectedProcurementCalendarDate: null,
        procurementByDate: {},
        procurementItems: [],
        _procurementSortableInstances: [],
        _procurementReceivingSortable: null,
        _procurementSupplierCache: null,

        init: () => {
            const scope = _growerIntakeGrid;
            if (typeof BatchStatus !== 'undefined') BatchStatus.applyModuleSubtitle('grower-intake-grid');
            if (typeof HandoffDialog !== 'undefined') HandoffDialog.applyPendingSearchForRoute('grower-intake-grid');
            scope.bindEvents();
            scope.loadIntakeBatches(true);
            scope.loadProcurements(true);
            const loadPromises = [];
            $('.modal[route-name]').each((index, el) => {
                const routeName = $(el).attr('route-name');
                const elementSelector = '#' + $(el).attr('id');
                if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName, elementSelector }));
                }
            });
            Promise.all(loadPromises).then(() => {
                if (typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.init) _modal_grower_receiving_checklist.init();
                if (typeof _modal_grower_create_kernel_batch !== 'undefined' && _modal_grower_create_kernel_batch.init) _modal_grower_create_kernel_batch.init();
                if (typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.init) _modal_grower_link_sample_to_batch.init();
            }).catch((err) => {
                console.error('[Grower Intake] Error loading modals:', err);
                if (typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.init) _modal_grower_receiving_checklist.init();
                if (typeof _modal_grower_create_kernel_batch !== 'undefined' && _modal_grower_create_kernel_batch.init) _modal_grower_create_kernel_batch.init();
                if (typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.init) _modal_grower_link_sample_to_batch.init();
            });
        },

        bindEvents: () => {
            const scope = _growerIntakeGrid;

            // Procurement calendar navigation
            $(document).on('click', '#giProcurementCalendarPrevBtn', () => scope.shiftProcurementCalendarMonth(-1));
            $(document).on('click', '#giProcurementCalendarNextBtn', () => scope.shiftProcurementCalendarMonth(1));

            // Day click (delegated; pills inside also bubble up, so check target is the day or its daynum)
            $(document).on('click', '#giProcurementCalendarGrid .gi-procurement-calendar-day', function (e) {
                if ($(e.target).closest('.gi-procurement-pill').length) return; // let pill handle
                var iso = $(this).data('iso');
                if (iso) {
                    scope.selectedProcurementCalendarDate = iso;
                    var cellMonth = new Date(iso + 'T12:00:00');
                    var calMonth = scope.procurementCalendarMonth instanceof Date ? scope.procurementCalendarMonth : new Date();
                    if (cellMonth.getFullYear() !== calMonth.getFullYear() || cellMonth.getMonth() !== calMonth.getMonth()) {
                        scope.procurementCalendarMonth = new Date(cellMonth.getFullYear(), cellMonth.getMonth(), 1);
                    }
                    scope.renderProcurementCalendar();
                }
            });

            // Save procurement from detail panel form
            $(document).on('click', '#giProcurementSaveBtn', function (e) {
                e.preventDefault();
                scope.saveProcurementFromForm();
            });

            // Delete procurement pill
            $(document).on('click', '.gi-procurement-delete-btn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var id = $(this).data('procurement-id');
                if (id) scope.deleteProcurement(id);
            });

            $('#addSampleBtn').off('click').on('click', () => scope.showAddSampleModal());
            $('#createKernelBatchBtn').off('click').on('click', () => {
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
                if (batchId && typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.showSiloPickerModal) {
                    _growerIntakeGrid.showSiloPickerModal(batchId);
                } else if (batchId && _growerIntakeGrid.moveBatchToRawStock) {
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
            $(document).on('click', '#intakeBatchesTableBody .js-intake-delete-btn, #giKanbanBoard .js-intake-delete-btn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.deleteBatch) {
                    _growerIntakeGrid.deleteBatch(batchId);
                }
            });
            // Silo selection modal: toggle selection on empty silo click (delegate from grid so clicks on label/children work).
            // Use namespaced events and .off() first so re-running bindEvents (e.g. after re-navigating to Grower Intake) never stacks handlers; duplicate handlers cause toggle to run twice and selection to appear to do nothing (intermittent "can't select").
            $(document).off('click.growerIntakeSilo', '#siloSelectionGrid .silo-box').on('click.growerIntakeSilo', '#siloSelectionGrid .silo-box', function (e) {
                e.preventDefault();
                e.stopPropagation();
                var $box = $(this);
                if ($box.hasClass('silo-selectable')) {
                    $box.toggleClass('silo-selected');
                    _growerIntakeGrid.updateSiloSelectionSummary();
                }
            });
            $(document).off('keydown.growerIntakeSilo', '#siloSelectionGrid .silo-box').on('keydown.growerIntakeSilo', '#siloSelectionGrid .silo-box', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    var $box = $(this);
                    if ($box.hasClass('silo-selectable')) {
                        $box.toggleClass('silo-selected');
                        _growerIntakeGrid.updateSiloSelectionSummary();
                    }
                }
            });
            $('#siloSelectionConfirmBtn').off('click').on('click', function () {
                if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.confirmSiloSelection) {
                    _growerIntakeGrid.confirmSiloSelection();
                }
            });
            $('#siloSelectionModal').off('hidden.bs.modal.growerIntakeSilo').on('hidden.bs.modal.growerIntakeSilo', function () {
                _growerIntakeGrid.releaseBatchIdForSilos = null;
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
            scope.filteredIntakeBatches = scope.intakeBatches.filter((b) => {
                const matchesSearch = !searchTerm ||
                    (b.batch_number && b.batch_number.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (b.grower_name && b.grower_name.toLowerCase().indexOf(searchTerm) >= 0);
                var matchesStatus = !statusFilter;
                if (statusFilter) {
                    if (b.status === statusFilter) {
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
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No kernel batches in intake. Create one to start the journey.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search.</td></tr>');
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
                    stage1Btn = '<button type="button" class="btn btn-sm btn-primary intake-step-btn js-intake-sample-btn" data-batch-id="' + b.id + '" data-batch-number="' + batchNumEscaped + '" title="New batch sample"><i class="fas fa-vial me-1"></i><span class="intake-btn-text">New batch sample</span></button>';
                } else {
                    stage1Btn = '<button type="button" class="btn btn-sm btn-success intake-step-btn js-intake-sample-btn" data-batch-id="' + b.id + '" data-batch-number="' + batchNumEscaped + '" title="View batch sample"><i class="fas fa-check me-1"></i><span class="intake-btn-text">Batch sample</span></button>';
                }

                var releaseItem = canRelease
                    ? '<a class="dropdown-item js-intake-release-btn" href="#" data-batch-id="' + b.id + '"><i class="fas fa-arrow-right me-2"></i>Release to production</a>'
                    : '<span class="dropdown-item text-muted" role="button" tabindex="0">Release to production</span>';
                var editItem = '<a class="dropdown-item js-intake-edit" href="#" data-batch-id="' + b.id + '"><i class="fas fa-pen me-2"></i>Edit</a>';
                var deleteItem = '<a class="dropdown-item js-intake-delete-btn text-danger" href="#" data-batch-id="' + b.id + '"><i class="fas fa-trash me-2"></i>Delete batch</a>';
                var actionsCell = MacTableActions.render({
                    id: 'intakeBatchActions' + b.id,
                    items: [releaseItem, editItem, deleteItem]
                });

                const stage1Cell = '<div class="intake-stage1-buttons">' + stage1Btn + '</div>';

                var batchNumberCell = '<a href="#" class="intake-batch-number-link js-intake-batch-number-link" role="button"' +
                    ' data-batch-id="' + b.id + '"' +
                    ' data-has-checklist="' + (checklistDone ? '1' : '0') + '"' +
                    ' data-sample-done="' + (sampleDone ? '1' : '0') + '">' +
                    batchNumEscaped + '</a>';

                var suppliedVal = b.wet_nis_received_kg != null ? b.wet_nis_received_kg : '';
                var actualVal = b.actual_wet_nis_kg != null ? b.actual_wet_nis_kg : '';
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

                const row = '<tr class="js-intake-batch-row" data-batch-id="' + b.id + '">' +
                    '<td class="intake-col-batch">' + batchNumberCell + '</td>' +
                    '<td class="intake-col-grower d-none d-md-table-cell">' + (b.grower_name || '') + '</td>' +
                    '<td class="intake-col-date" title="Received date">' + receivedDate + '</td>' +
                    '<td class="intake-col-wet d-none d-sm-table-cell">' + wetCellContent + '</td>' +
                    '<td class="intake-col-stage1">' + stage1Cell + '</td>' +
                    '<td class="intake-col-status">' + (function() { var ik = getIntakeColumnKey(b); var sp = ik === 'receiving' ? 'first' : ik === 'quality_approved' ? 'last' : 'mid'; return KanbanHelper.statusBadge(b.status || '', sp); })() + '</td>' +
                    '<td class="intake-col-actions mac-table-actions-col">' + actionsCell + '</td></tr>';
                tbody.append(row);
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
                    stage1Html = '<button type="button" class="btn btn-sm btn-primary js-intake-sample-btn" data-batch-id="' + b.id + '" data-batch-number="' + esc(batchNum) + '" title="New batch sample"><i class="fas fa-vial me-1"></i>Sample</button>';
                } else {
                    stage1Html = '<button type="button" class="btn btn-sm btn-success js-intake-sample-btn" data-batch-id="' + b.id + '" data-batch-number="' + esc(batchNum) + '" title="View batch sample"><i class="fas fa-check me-1"></i>Sample</button>';
                }

                var releaseHtml = canRelease
                    ? '<button type="button" class="btn btn-sm btn-outline-success js-intake-release-btn" data-batch-id="' + b.id + '" title="Release to production"><i class="fas fa-arrow-right me-1"></i>Release</button>'
                    : '';
                var deleteHtml = '<button type="button" class="btn btn-sm btn-outline-danger js-intake-delete-btn" data-batch-id="' + b.id + '" title="Delete batch"><i class="fas fa-trash"></i></button>';

                var weightLabel = b.wet_nis_received_kg != null ? b.wet_nis_received_kg + ' kg' : '';

                var html = '<div class="kanban-card js-intake-batch-row" data-batch-id="' + b.id + '">';
                html += '<div class="kanban-card-title">' + esc(batchNum) + '</div>';
                if (typeof BatchStatus !== 'undefined') {
                    html += '<div class="kanban-card-status-row">' + BatchStatus.statusBadgeHtml(BatchStatus.getDisplayStatus(b)) + '</div>';
                }
                html += '<div class="kanban-card-meta">';
                if (b.grower_name) html += '<div class="kanban-card-meta-item" title="Grower / supplier"><i class="fas fa-user"></i> ' + esc(b.grower_name) + '</div>';
                if (receivedDate) html += '<div class="kanban-card-meta-item" title="Received date"><i class="fas fa-calendar"></i> ' + esc(receivedDate) + '</div>';
                if (weightLabel) html += '<div class="kanban-card-meta-item" title="Wet NIS (kg)"><i class="fas fa-weight-hanging"></i> ' + esc(weightLabel) + '</div>';
                html += '</div>';
                html += '<div class="kanban-card-actions">' + stage1Html + releaseHtml + deleteHtml + '</div>';
                html += '</div>';
                return html;
            });

            // Drag-and-drop: forward transitions only
            var colOrder = ['receiving', 'intake_received', 'quality_pending', 'quality_approved'];
            // Re-bind procurement drop zone after every Kanban render (DOM is replaced by KanbanHelper)
            if (typeof _growerIntakeGrid._bindProcurementReceivingDrop === 'function') {
                _growerIntakeGrid._bindProcurementReceivingDrop();
            }
            KanbanHelper.enableDragDrop('giKanbanBoard', function (batchId, fromKey, toKey) {
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
            });
        },

        showSiloPickerModal: async (batchId) => {
            const scope = _growerIntakeGrid;
            if (!batchId) return;
            scope.releaseBatchIdForSilos = batchId;
            var gridEl = document.getElementById('siloSelectionGrid');
            var btnEl = document.getElementById('siloSelectionConfirmBtn');
            if (gridEl) gridEl.innerHTML = '<p class="text-muted mb-0">Loading silos…</p>';
            if (btnEl) btnEl.disabled = true;
            try {
                var list = typeof dataFunctions !== 'undefined' && dataFunctions.getSilos ? await dataFunctions.getSilos(null, true) : [];
                scope.siloList = Array.isArray(list) ? list : [];
                scope.renderSiloSelectionGrid();
                scope.updateSiloSelectionSummary();
            } catch (e) {
                console.error(e);
                if (gridEl) gridEl.innerHTML = '<p class="text-danger mb-0">Failed to load silos.</p>';
            }
            var modalEl = document.getElementById('siloSelectionModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#siloSelectionModal').modal('show');
        },

        renderSiloSelectionGrid: () => {
            const scope = _growerIntakeGrid;
            var gridEl = document.getElementById('siloSelectionGrid');
            if (!gridEl) return;
            var occupied = {};
            (scope.siloList || []).forEach(function (s) {
                var num = s.silo_number != null ? Number(s.silo_number) : null;
                if (num >= 1 && num <= 12 && (s.kernel_id || s.oil_batch_id)) {
                    occupied[num] = { grower_name: s.grower_name || s.growerName || null };
                }
            });
            function escapeHtml(t) {
                if (t == null || typeof t !== 'string') return '';
                var div = document.createElement('div');
                div.textContent = t;
                return div.innerHTML;
            }
            var html = '';
            for (var n = 1; n <= 12; n++) {
                var isOccupied = !!occupied[n];
                var cls = 'silo-box ' + (isOccupied ? 'silo-occupied' : 'silo-empty silo-selectable');
                var grower = occupied[n] && occupied[n].grower_name ? occupied[n].grower_name : null;
                var labelHtml = grower
                    ? '<span class="silo-label">' + n + '</span><span class="silo-grower">' + escapeHtml(grower) + '</span>'
                    : '<span class="silo-label">' + n + '</span>';
                var title = isOccupied ? ('Silo ' + n + (grower ? ': ' + grower : '') + ' (occupied)') : ('Silo ' + n + ' (available)');
                html += '<div class="' + cls + '" data-silo-number="' + n + '" role="button" tabindex="0" title="' + escapeHtml(title) + '">' + labelHtml + '</div>';
            }
            gridEl.innerHTML = html;
        },

        updateSiloSelectionSummary: () => {
            var selected = [];
            $('#siloSelectionGrid .silo-selectable.silo-selected').each(function () {
                var n = $(this).data('silo-number');
                if (n != null) selected.push(Number(n));
            });
            var summaryEl = document.getElementById('siloSelectionSummary');
            var btnEl = document.getElementById('siloSelectionConfirmBtn');
            if (summaryEl) summaryEl.textContent = selected.length > 0 ? 'Silos selected: ' + selected.sort(function (a, b) { return a - b; }).join(', ') : 'Select at least one silo.';
            if (btnEl) btnEl.disabled = selected.length === 0;
        },

        confirmSiloSelection: async () => {
            const scope = _growerIntakeGrid;
            var kernelId = scope.releaseBatchIdForSilos;
            if (!kernelId) return;
            var selected = [];
            $('#siloSelectionGrid .silo-selectable.silo-selected').each(function () {
                var n = $(this).data('silo-number');
                if (n != null) selected.push(Number(n));
            });
            if (selected.length === 0) return;
            var btnEl = document.getElementById('siloSelectionConfirmBtn');
            if (btnEl) btnEl.disabled = true;
            try {
                var releaseResult = await dataFunctions.releaseKernelToProduction({ kernel_id: kernelId });
                if (releaseResult && releaseResult.success === false) {
                    throw new Error(releaseResult.error || 'Release failed');
                }
                if (typeof dataFunctions.assignKernelToSilos === 'function') {
                    var assignResult = await dataFunctions.assignKernelToSilos(kernelId, selected);
                    if (assignResult && assignResult.success === false) {
                        throw new Error(assignResult.error || 'Silo assignment failed');
                    }
                }
                var modalEl = document.getElementById('siloSelectionModal');
                if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getInstance(modalEl).hide();
                else if (typeof $ !== 'undefined') $('#siloSelectionModal').modal('hide');
                var batch = scope.intakeBatches.find(function (x) { return String(x.id) === String(kernelId); });
                scope.loadIntakeBatches(true);
                if (typeof HandoffDialog !== 'undefined' && HandoffDialog.showKernelReleaseToProduction) {
                    HandoffDialog.showKernelReleaseToProduction(batch || { batch_number: kernelId });
                } else if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'success', title: 'Released to production', text: 'Batch is in Kernel Production and assigned to silo(s) ' + selected.sort(function (a, b) { return a - b; }).join(', ') + '.', timer: 2500, showConfirmButton: false });
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release or assign silos', 'error');
                if (btnEl) btnEl.disabled = false;
            }
        },

        moveBatchToRawStock: async (batchId) => {
            const scope = _growerIntakeGrid;
            if (!batchId) return;
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

        deleteBatch: (batchId) => {
            const scope = _growerIntakeGrid;
            if (!batchId) return;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.deactivateKernelBatch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Delete function not available. Please refresh.', 'error');
                return;
            }
            const batch = scope.intakeBatches.find((b) => String(b.id) === String(batchId));
            const batchLabel = batch ? (batch.batch_number || 'this batch') : 'this batch';
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete "' + batchLabel + '"? This will remove it from intake and production. This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then((res) => {
                if (!res.isConfirmed) return;
                dataFunctions.deactivateKernelBatch(batchId).then((result) => {
                    var inner = (result && result.deactivate_kernel_batch) ? result.deactivate_kernel_batch : result;
                    if (inner && inner.success === false) throw new Error(inner.error || 'Delete failed');
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Batch deleted', text: batchLabel + ' has been removed.', timer: 2000, showConfirmButton: false });
                    scope.loadIntakeBatches(true);
                }).catch((e) => {
                    console.error(e);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to delete batch', 'error');
                });
            });
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

        _procParseIso: (iso) => {
            if (!iso) return null;
            var p = String(iso).split('-');
            return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
        },

        _procFormatMonthYear: (d) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),

        _procFormatDisplayDate: (iso) => {
            var d = _growerIntakeGrid._procParseIso(iso);
            if (!d) return iso || '';
            return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
        },

        _procEsc: (str) => {
            if (!str) return '';
            var div = document.createElement('div');
            div.appendChild(document.createTextNode(str));
            return div.innerHTML;
        },

        _procBuildIndex: (items) => {
            var idx = {};
            (items || []).forEach(function (p) {
                var iso = p.scheduled_date ? String(p.scheduled_date).split('T')[0] : null;
                if (!iso) return;
                if (!idx[iso]) idx[iso] = [];
                idx[iso].push(p);
            });
            Object.keys(idx).forEach(function (iso) {
                idx[iso].sort(function (a, b) {
                    var si = (a.sort_index != null ? a.sort_index : 9999) - (b.sort_index != null ? b.sort_index : 9999);
                    if (si !== 0) return si;
                    return String(a.created_at || '').localeCompare(String(b.created_at || ''));
                });
            });
            return idx;
        },

        _procDisplayName: (p) => {
            if (p.grower_name && p.grower_name.trim()) return p.grower_name.trim();
            if (p._supplierName) return p._supplierName;
            return 'Grower';
        },

        loadProcurements: async (forceRefresh) => {
            const scope = _growerIntakeGrid;
            var df = typeof _dataFunctions !== 'undefined' && _dataFunctions ? _dataFunctions
                   : typeof dataFunctions !== 'undefined' ? dataFunctions : null;
            if (!df || typeof df.getKernelIntakeProcurements !== 'function') {
                scope.procurementItems = [];
                scope.procurementByDate = {};
                scope.renderProcurementCalendar();
                return;
            }
            // Fetch a generous window: 3 months either side of current calendar month
            var base = scope.procurementCalendarMonth instanceof Date ? scope.procurementCalendarMonth : new Date();
            var from = new Date(base.getFullYear(), base.getMonth() - 1, 1);
            var to   = new Date(base.getFullYear(), base.getMonth() + 3, 0);
            var fromIso = scope._procIsoFromDate(from);
            var toIso   = scope._procIsoFromDate(to);
            try {
                var items = await df.getKernelIntakeProcurements(fromIso, toIso, !!forceRefresh);
                scope.procurementItems = items || [];
                // Attach supplier display names if we have contacts cached
                if (scope._procurementSupplierCache) {
                    scope._attachProcurementSupplierNames(scope._procurementSupplierCache);
                } else {
                    // Try to pre-load supplier list for display names
                    if (typeof df.getContacts === 'function') {
                        df.getContacts(null, false).then(function (contacts) {
                            if (Array.isArray(contacts)) {
                                scope._procurementSupplierCache = contacts;
                                scope._attachProcurementSupplierNames(contacts);
                                scope.procurementByDate = scope._procBuildIndex(scope.procurementItems);
                                scope.renderProcurementCalendar();
                            }
                        }).catch(function () {});
                    }
                }
            } catch (e) {
                console.error('[Procurement Calendar] Failed to load:', e);
                scope.procurementItems = [];
            }
            scope.procurementByDate = scope._procBuildIndex(scope.procurementItems);
            scope.renderProcurementCalendar();
        },

        _attachProcurementSupplierNames: (contacts) => {
            const scope = _growerIntakeGrid;
            var map = {};
            (contacts || []).forEach(function (c) {
                map[c.id] = c.company_name || c.trading_name || c.primary_contact_name || '';
            });
            (scope.procurementItems || []).forEach(function (p) {
                if (p.supplier_id && map[p.supplier_id]) p._supplierName = map[p.supplier_id];
            });
        },

        shiftProcurementCalendarMonth: (delta) => {
            const scope = _growerIntakeGrid;
            var base = scope.procurementCalendarMonth instanceof Date ? scope.procurementCalendarMonth : new Date();
            scope.procurementCalendarMonth = new Date(base.getFullYear(), base.getMonth() + delta, 1);
            scope.selectedProcurementCalendarDate = null;
            scope.loadProcurements(true);
        },

        renderProcurementCalendar: () => {
            const scope = _growerIntakeGrid;
            var gridEl = document.getElementById('giProcurementCalendarGrid');
            var labelEl = document.getElementById('giProcurementCalendarMonthLabel');
            if (!gridEl || !labelEl) return;

            var monthDate = scope.procurementCalendarMonth instanceof Date
                ? scope.procurementCalendarMonth : new Date();
            monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
            scope.procurementCalendarMonth = monthDate;
            labelEl.textContent = scope._procFormatMonthYear(monthDate);

            var index = scope._procBuildIndex(scope.procurementItems);
            scope.procurementByDate = index;

            // Auto-select today if nothing selected
            if (!scope.selectedProcurementCalendarDate) {
                scope.selectedProcurementCalendarDate = scope._procIsoFromDate(new Date());
            }

            var firstCell = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - monthDate.getDay());
            var esc = scope._procEsc;
            var html = '';
            for (var i = 0; i < 42; i++) {
                var cellDate = new Date(firstCell.getFullYear(), firstCell.getMonth(), firstCell.getDate() + i);
                var iso = scope._procIsoFromDate(cellDate);
                var entries = index[iso] || [];
                var isCurrentMonth = cellDate.getMonth() === monthDate.getMonth();
                var classes = ['gi-procurement-calendar-day'];
                if (!isCurrentMonth) classes.push('is-outside-month');
                if (entries.length > 0) classes.push('has-procurement');
                if (scope.selectedProcurementCalendarDate === iso) classes.push('is-active');

                html += '<div class="' + classes.join(' ') + '" data-iso="' + esc(iso) + '">';
                html += '<div class="gi-procurement-calendar-daynum">' + cellDate.getDate() + '</div>';
                html += '<div class="gi-procurement-calendar-day-pills" data-iso="' + esc(iso) + '">';
                entries.forEach(function (p) {
                    var name = scope._procDisplayName(p);
                    var wt = p.predicted_weight_kg != null ? (p.predicted_weight_kg >= 1000
                        ? (p.predicted_weight_kg / 1000).toFixed(1) + 't'
                        : p.predicted_weight_kg + 'kg') : '';
                    html += '<div class="gi-procurement-pill" data-procurement-id="' + esc(p.id) + '" draggable="false">' +
                        '<span class="gi-procurement-pill-name" title="' + esc(name) + '">' + esc(name.length > 12 ? name.substring(0, 11) + '…' : name) + '</span>' +
                        (wt ? '<span class="gi-procurement-pill-weight">' + esc(wt) + '</span>' : '') +
                        '</div>';
                });
                html += '</div>';
                html += '</div>';
            }
            gridEl.innerHTML = html;

            scope.renderProcurementCalendarDetail(scope.selectedProcurementCalendarDate);
            scope._bindProcurementDragDrop();
        },

        renderProcurementCalendarDetail: (iso) => {
            const scope = _growerIntakeGrid;
            var detailEl = document.getElementById('giProcurementCalendarDetail');
            if (!detailEl) return;
            var esc = scope._procEsc;

            var entries = iso ? (scope.procurementByDate[iso] || []) : [];
            var dateTitle = iso ? '<div class="gi-procurement-calendar-detail-title">' + esc(scope._procFormatDisplayDate(iso)) + '</div>' : '';

            // Build add-procurement form (always shown for selected day)
            var formHtml = '';
            if (iso) {
                formHtml = '<div class="gi-procurement-add-form mb-3">' +
                    '<div class="mb-2">' +
                    '<label class="form-label">Grower / supplier</label>' +
                    '<select class="form-select form-select-sm" id="giProcurementSupplierSel"><option value="">Select (optional)</option></select>' +
                    '</div>' +
                    '<div class="mb-2">' +
                    '<label class="form-label">Grower name override <span class="text-muted fw-normal small">(optional)</span></label>' +
                    '<input type="text" class="form-control form-control-sm" id="giProcurementGrowerName" placeholder="Free-text name if not in supplier list">' +
                    '</div>' +
                    '<div class="mb-2">' +
                    '<label class="form-label">Predicted weight (kg) <span class="text-danger">*</span></label>' +
                    '<input type="number" class="form-control form-control-sm" id="giProcurementWeightKg" min="0.1" step="0.1" placeholder="e.g. 5000">' +
                    '</div>' +
                    '<button type="button" class="btn btn-primary btn-sm w-100" id="giProcurementSaveBtn"><i class="fas fa-plus me-1"></i>Add procurement</button>' +
                    '</div>';
            }

            // Build existing entries list
            var entriesHtml = '';
            if (entries.length > 0) {
                entriesHtml = '<div class="mb-1 small text-muted fw-semibold">Scheduled deliveries</div>';
                entries.forEach(function (p) {
                    var name = scope._procDisplayName(p);
                    var wt = p.predicted_weight_kg != null ? p.predicted_weight_kg + ' kg' : '';
                    entriesHtml += '<div class="gi-procurement-detail-entry" data-procurement-id="' + esc(p.id) + '">' +
                        '<div>' +
                        '<div class="gi-procurement-entry-grower">' + esc(name) + '</div>' +
                        (wt ? '<div class="gi-procurement-entry-weight"><i class="fas fa-weight-hanging me-1"></i>' + esc(wt) + '</div>' : '') +
                        '</div>' +
                        '<div class="gi-procurement-entry-actions">' +
                        '<button type="button" class="btn btn-sm btn-outline-danger gi-procurement-delete-btn" data-procurement-id="' + esc(p.id) + '" title="Delete"><i class="fas fa-times"></i></button>' +
                        '</div>' +
                        '</div>';
                });
            } else if (iso) {
                entriesHtml = '<div class="gi-procurement-calendar-detail-empty">No scheduled deliveries for this day.</div>';
            }

            if (!iso) {
                detailEl.innerHTML = '<div class="gi-procurement-calendar-detail-empty">Select a day to view or add procurement.</div>';
            } else {
                detailEl.innerHTML = dateTitle + formHtml + entriesHtml;
                scope._populateProcurementSupplierDropdown();
            }
        },

        _populateProcurementSupplierDropdown: () => {
            const scope = _growerIntakeGrid;
            var sel = document.getElementById('giProcurementSupplierSel');
            if (!sel) return;
            var TYPES = ['nis_supplier', 'supplier', 'both'];
            var df = typeof _dataFunctions !== 'undefined' && _dataFunctions ? _dataFunctions
                   : typeof dataFunctions !== 'undefined' ? dataFunctions : null;
            if (!df || typeof df.getContacts !== 'function') return;
            df.getContacts(null, false).then(function (raw) {
                var contacts = Array.isArray(raw) ? raw : (raw && raw.get_contacts ? raw.get_contacts : (raw && raw.data ? raw.data : []));
                if (!Array.isArray(contacts)) return;
                scope._procurementSupplierCache = contacts;
                scope._attachProcurementSupplierNames(contacts);
                var suppliers = contacts.filter(function (c) { return TYPES.indexOf((c.contact_type || '').trim()) >= 0; });
                var opts = '<option value="">Select (optional)</option>';
                suppliers.forEach(function (c) {
                    var name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                    var code = c.supplier_number != null ? ' (' + c.supplier_number + ')' : '';
                    opts += '<option value="' + c.id + '">' + name + code + '</option>';
                });
                sel.innerHTML = opts;
            }).catch(function (e) { console.error('[Procurement] Suppliers load error:', e); });
        },

        saveProcurementFromForm: async () => {
            const scope = _growerIntakeGrid;
            var iso = scope.selectedProcurementCalendarDate;
            if (!iso) return;
            var selEl = document.getElementById('giProcurementSupplierSel');
            var nameEl = document.getElementById('giProcurementGrowerName');
            var wtEl   = document.getElementById('giProcurementWeightKg');
            var supplierId = selEl && selEl.value ? selEl.value : null;
            var growerName = nameEl && nameEl.value ? nameEl.value.trim() : null;
            var weightKg = wtEl ? parseFloat(wtEl.value) : NaN;

            if (!weightKg || weightKg <= 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Validation', 'Predicted weight (kg) is required and must be greater than zero.', 'warning');
                if (wtEl) wtEl.focus();
                return;
            }

            var df = typeof _dataFunctions !== 'undefined' && _dataFunctions ? _dataFunctions
                   : typeof dataFunctions !== 'undefined' ? dataFunctions : null;
            if (!df || typeof df.upsertKernelIntakeProcurement !== 'function') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Data layer not ready.', 'error');
                return;
            }

            var btn = document.getElementById('giProcurementSaveBtn');
            if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

            try {
                var existing = scope.procurementByDate[iso] || [];
                await df.upsertKernelIntakeProcurement({
                    scheduled_date:      iso,
                    supplier_id:         supplierId,
                    grower_name:         growerName,
                    predicted_weight_kg: weightKg,
                    sort_index:          existing.length
                });
                await scope.loadProcurements(true);
            } catch (e) {
                console.error('[Procurement] Save error:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save procurement.', 'error');
                if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-plus me-1"></i>Add procurement'; }
            }
        },

        deleteProcurement: async (procurementId) => {
            const scope = _growerIntakeGrid;
            if (!procurementId) return;
            var confirmed = typeof Swal !== 'undefined'
                ? (await Swal.fire({ title: 'Delete procurement?', text: 'This scheduled delivery will be removed from the calendar.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Delete', confirmButtonColor: '#dc3545' })).isConfirmed
                : window.confirm('Delete this procurement entry?');
            if (!confirmed) return;
            var df = typeof _dataFunctions !== 'undefined' && _dataFunctions ? _dataFunctions
                   : typeof dataFunctions !== 'undefined' ? dataFunctions : null;
            if (!df || typeof df.deleteKernelIntakeProcurement !== 'function') return;
            try {
                await df.deleteKernelIntakeProcurement(procurementId);
                await scope.loadProcurements(true);
            } catch (e) {
                console.error('[Procurement] Delete error:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to delete procurement.', 'error');
            }
        },

        rescheduleProcurement: async (procurementId, newIso) => {
            const scope = _growerIntakeGrid;
            if (!procurementId || !newIso) return;
            var df = typeof _dataFunctions !== 'undefined' && _dataFunctions ? _dataFunctions
                   : typeof dataFunctions !== 'undefined' ? dataFunctions : null;
            if (!df || typeof df.upsertKernelIntakeProcurement !== 'function') return;
            // Find existing procurement data
            var existing = null;
            (scope.procurementItems || []).forEach(function (p) { if (p.id === procurementId) existing = p; });
            if (!existing) return;
            var targetEntries = scope.procurementByDate[newIso] || [];
            try {
                await df.upsertKernelIntakeProcurement({
                    id:                  procurementId,
                    scheduled_date:      newIso,
                    supplier_id:         existing.supplier_id || null,
                    grower_name:         existing.grower_name || null,
                    predicted_weight_kg: existing.predicted_weight_kg,
                    sort_index:          targetEntries.length
                });
                await scope.loadProcurements(true);
            } catch (e) {
                console.error('[Procurement] Reschedule error:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to reschedule procurement.', 'error');
                await scope.loadProcurements(true);
            }
        },

        _bindProcurementDragDrop: () => {
            const scope = _growerIntakeGrid;
            if (typeof Sortable === 'undefined') return;

            // Destroy existing pill sortable instances
            (scope._procurementSortableInstances || []).forEach(function (s) { if (s && s.destroy) s.destroy(); });
            scope._procurementSortableInstances = [];

            // Each day's pills container is a sortable group
            var pillContainers = document.querySelectorAll('#giProcurementCalendarGrid .gi-procurement-calendar-day-pills');
            pillContainers.forEach(function (el) {
                var instance = Sortable.create(el, {
                    group: { name: 'gi-procurement-pills', pull: true, put: true },
                    animation: 150,
                    ghostClass: 'sortable-ghost',
                    chosenClass: 'sortable-chosen',
                    filter: '.gi-procurement-delete-btn',
                    onEnd: function (evt) {
                        var pill = evt.item;
                        var procurementId = pill.getAttribute('data-procurement-id');
                        var toContainer = evt.to;
                        var fromContainer = evt.from;
                        if (!procurementId || !toContainer) return;

                        var toIso = toContainer.getAttribute('data-iso');
                        var fromIso = fromContainer ? fromContainer.getAttribute('data-iso') : null;

                        if (toIso && toIso !== fromIso) {
                            // Revert DOM immediately; state will be refreshed by loadProcurements
                            if (fromContainer && evt.oldIndex != null) {
                                fromContainer.insertBefore(pill, fromContainer.children[evt.oldIndex] || null);
                            }
                            scope.rescheduleProcurement(procurementId, toIso);
                        }
                    }
                });
                scope._procurementSortableInstances.push(instance);
            });

            // Bind drop-to-Receiving on the kanban board Receiving column body
            scope._bindProcurementReceivingDrop();
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

                    // Open create-batch modal pre-filled
                    if (typeof _modal_grower_create_kernel_batch !== 'undefined' && _modal_grower_create_kernel_batch.showFromProcurement) {
                        _modal_grower_create_kernel_batch.showFromProcurement(procurement);
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
