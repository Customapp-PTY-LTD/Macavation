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

        init: () => {
            const scope = _growerIntakeGrid;
            scope.bindEvents();
            scope.loadIntakeBatches(true);
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
            // Silo selection modal: toggle selection on empty silo click
            $(document).on('click', '#siloSelectionGrid .silo-selectable', function () {
                $(this).toggleClass('silo-selected');
                _growerIntakeGrid.updateSiloSelectionSummary();
            });
            $('#siloSelectionConfirmBtn').off('click').on('click', function () {
                if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.confirmSiloSelection) {
                    _growerIntakeGrid.confirmSiloSelection();
                }
            });
            $('#siloSelectionModal').on('hidden.bs.modal', function () {
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
            try {
                const all = await _dataFunctions.getKernelBatches(null, forceRefresh, { status: 'intake,receiving' });
                scope.intakeBatches = all || [];
                scope.filterIntakeBatches();
            } catch (e) {
                console.error('Error loading intake batches:', e);
                scope.intakeBatches = [];
                scope.filterIntakeBatches();
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
                var actionsCell = '<div class="dropdown">' +
                    '<button class="btn btn-sm btn-outline-secondary" type="button" id="intakeBatchActions' + b.id + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                    '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="intakeBatchActions' + b.id + '">' +
                    releaseItem + editItem + deleteItem +
                    '</ul></div>';

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
                    '<td class="intake-col-date">' + receivedDate + '</td>' +
                    '<td class="intake-col-wet d-none d-sm-table-cell">' + wetCellContent + '</td>' +
                    '<td class="intake-col-stage1">' + stage1Cell + '</td>' +
                    '<td class="intake-col-status">' + (function() { var ik = getIntakeColumnKey(b); var sp = ik === 'receiving' ? 'first' : ik === 'quality_approved' ? 'last' : 'mid'; return KanbanHelper.statusBadge(b.status || '', sp); })() + '</td>' +
                    '<td class="intake-col-actions">' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
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
                html += '<div class="kanban-card-meta">';
                if (b.grower_name) html += '<div class="kanban-card-meta-item"><i class="fas fa-user"></i> ' + esc(b.grower_name) + '</div>';
                if (receivedDate) html += '<div class="kanban-card-meta-item"><i class="fas fa-calendar"></i> ' + esc(receivedDate) + '</div>';
                if (weightLabel) html += '<div class="kanban-card-meta-item"><i class="fas fa-weight-hanging"></i> ' + esc(weightLabel) + '</div>';
                html += '</div>';
                html += '<div class="kanban-card-actions">' + stage1Html + releaseHtml + deleteHtml + '</div>';
                html += '</div>';
                return html;
            });

            // Drag-and-drop: forward transitions only
            var colOrder = ['receiving', 'intake_received', 'quality_pending', 'quality_approved'];
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
                if (num >= 1 && num <= 12 && (s.kernel_id || s.oil_batch_id || s.status === 'occupied')) {
                    occupied[num] = true;
                }
            });
            var html = '';
            for (var n = 1; n <= 12; n++) {
                var isOccupied = !!occupied[n];
                var cls = 'silo-box ' + (isOccupied ? 'silo-occupied' : 'silo-empty silo-selectable');
                html += '<div class="' + cls + '" data-silo-number="' + n + '" role="button" tabindex="0"><span class="silo-label">' + n + '</span></div>';
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
                var releaseResult = await dataFunctions.releaseKernelToProduction({ kernel_id: kernelId, silos: selected });
                if (releaseResult && releaseResult.success === false) {
                    throw new Error(releaseResult.error || 'Release failed');
                }
                var modalEl = document.getElementById('siloSelectionModal');
                if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getInstance(modalEl).hide();
                else if (typeof $ !== 'undefined') $('#siloSelectionModal').modal('hide');
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released to production', text: 'Batch is in Kernel Production and assigned to silo(s) ' + selected.sort(function (a, b) { return a - b; }).join(', ') + '.', timer: 2500, showConfirmButton: false });
                scope.loadIntakeBatches(true);
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
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released to production', text: 'Batch is now in Kernel Production. Start production, then complete and run tests to release to stock.', timer: 2500, showConfirmButton: false });
                    scope.loadIntakeBatches(true);
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
        }
    };
}();
