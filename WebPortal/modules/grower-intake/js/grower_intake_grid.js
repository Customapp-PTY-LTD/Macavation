/**
 * Grower Intake Grid Module
 * Route-only modal pattern: parent loads modal content, routes to modals; modals own logic.
 * See MODAL_PATTERN_INSTRUCTIONS.md, SEPARATING_LARGE_JS_FILES.md
 */
var _growerIntakeGrid = function () {
    'use strict';

    return {
        samples: [],
        filteredSamples: [],
        intakeBatches: [],
        filteredIntakeBatches: [],
        currentPage: 1,
        itemsPerPage: 20,

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

            $(document).on('click', '#intakeBatchesTableBody .js-intake-batch-number-link', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const checklistId = ($(this).data('receiving-checklist-id') || '').trim() || undefined;
                const sampleId = ($(this).data('sample-submission-id') || '').trim() || undefined;
                const checklistDone = !!(checklistId && checklistId.length > 0);
                const sampleDone = !!(sampleId && sampleId.length > 0);
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
                        _modal_grower_receiving_checklist.show(batchId, checklistId);
                    }
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-checklist-btn', function (e) {
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const checklistId = ($(this).data('receiving-checklist-id') || '').trim() || undefined;
                if (batchId && typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.show) {
                    _modal_grower_receiving_checklist.show(batchId, checklistId);
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-sample-btn', function (e) {
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                const sampleId = ($(this).data('sample-submission-id') || '').trim();
                if (sampleId && typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.viewSample) {
                    _growerIntakeGrid.viewSample(sampleId);
                } else if (batchId && typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.show) {
                    _modal_grower_link_sample_to_batch.show(batchId);
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-release-btn', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const batchId = $(this).data('batch-id');
                if (batchId && typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.moveBatchToRawStock) {
                    _growerIntakeGrid.moveBatchToRawStock(batchId);
                }
            });
            $(document).on('click', '#intakeBatchesTableBody .js-intake-edit', function (e) {
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
                const matchesStatus = !statusFilter || b.status === statusFilter;
                return matchesSearch && matchesStatus;
            });
            scope.renderIntakeBatches();
        },

        loadIntakeBatches: async (forceRefresh) => {
            const scope = _growerIntakeGrid;
            try {
                const all = await dataFunctions.getProductionBatches(null, forceRefresh, { batch_type: 'kernel' });
                scope.intakeBatches = (all || []).filter((b) =>
                    ['receiving', 'intake_received', 'quality_pending', 'quality_approved'].indexOf(b.status) >= 0
                );
                scope.filterIntakeBatches();
            } catch (e) {
                console.error('Error loading intake batches:', e);
                scope.intakeBatches = [];
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
                const checklistDone = !!(b.receiving_checklist_id || b.receivingChecklistId);
                const sampleDone = !!(b.sample_submission_id || b.sampleSubmissionId);
                const sampleEnabled = checklistDone;
                const canRelease = checklistDone && sampleDone;
                const checklistId = b.receiving_checklist_id || b.receivingChecklistId || '';
                const sampleId = b.sample_submission_id || b.sampleSubmissionId || '';

                /* Stage 1: show only one option per workflow — Receiving checklist first, then New batch sample, then complete */
                var stage1Btn;
                if (!checklistDone) {
                    stage1Btn = '<button type="button" class="btn btn-sm btn-primary intake-step-btn js-intake-checklist-btn" data-batch-id="' + b.id + '" data-receiving-checklist-id="" title="Receiving checklist"><i class="fas fa-clipboard-check me-1"></i><span class="intake-btn-text">Receiving checklist</span></button>';
                } else if (!sampleDone) {
                    stage1Btn = '<button type="button" class="btn btn-sm btn-primary intake-step-btn js-intake-sample-btn" data-batch-id="' + b.id + '" title="New batch sample"><i class="fas fa-vial me-1"></i><span class="intake-btn-text">New batch sample</span></button>';
                } else {
                    stage1Btn = '<button type="button" class="btn btn-sm btn-success intake-step-btn js-intake-sample-btn" data-batch-id="' + b.id + '" data-sample-submission-id="' + sampleId + '" title="View batch sample"><i class="fas fa-check me-1"></i><span class="intake-btn-text">Batch sample</span></button>';
                }

                var releaseItem = canRelease
                    ? '<a class="dropdown-item js-intake-release-btn" href="#" data-batch-id="' + b.id + '"><i class="fas fa-arrow-right me-2"></i>Release to production</a>'
                    : '<span class="dropdown-item text-muted" role="button" tabindex="0">Release to production</span>';
                var editItem = '<a class="dropdown-item js-intake-edit" href="#" data-batch-id="' + b.id + '" data-receiving-checklist-id="' + (checklistId || '') + '"><i class="fas fa-pen me-2"></i>Edit</a>';
                var actionsCell = '<div class="dropdown">' +
                    '<button class="btn btn-sm btn-outline-secondary" type="button" id="intakeBatchActions' + b.id + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                    '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="intakeBatchActions' + b.id + '">' +
                    releaseItem + editItem +
                    '</ul></div>';

                const stage1Cell = '<div class="intake-stage1-buttons">' + stage1Btn + '</div>';

                var batchNum = (b.batch_number || '').toString();
                var batchNumEscaped = batchNum.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                var batchNumberCell = '<a href="#" class="intake-batch-number-link js-intake-batch-number-link" role="button" data-batch-id="' + b.id + '" data-receiving-checklist-id="' + (checklistId || '') + '" data-sample-submission-id="' + (sampleId || '') + '">' + batchNumEscaped + '</a>';

                const row = '<tr class="js-intake-batch-row" data-batch-id="' + b.id + '" data-receiving-checklist-id="' + checklistId + '">' +
                    '<td class="intake-col-batch">' + batchNumberCell + '</td>' +
                    '<td class="intake-col-grower d-none d-md-table-cell">' + (b.grower_name || '') + '</td>' +
                    '<td class="intake-col-date">' + receivedDate + '</td>' +
                    '<td class="intake-col-wet d-none d-sm-table-cell">' + (b.wet_nis_received_kg || '') + '</td>' +
                    '<td class="intake-col-stage1">' + stage1Cell + '</td>' +
                    '<td class="intake-col-status"><span class="badge bg-info">' + (b.status || '') + '</span></td>' +
                    '<td class="intake-col-actions">' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
        },

        moveBatchToRawStock: async (batchId) => {
            const scope = _growerIntakeGrid;
            if (!batchId) return;
            try {
                const result = await dataFunctions.updateProductionBatch(batchId, { status: 'awaiting_production', stage: 'production' });
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released', text: 'Batch is now in Kernel Production (awaiting production). Start production, then complete and run tests to release to stock.', timer: 2500, showConfirmButton: false });
                    scope.loadIntakeBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            } catch (e) {
                console.error(e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to release batch', 'error');
            }
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
