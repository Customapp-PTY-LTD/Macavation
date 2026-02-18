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
            scope.setupBodyMountedDropdown();
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

        setupBodyMountedDropdown: () => {
            const scope = _growerIntakeGrid;
            let globalDropdown = null;

            const getDropdown = () => {
                if (globalDropdown) return globalDropdown;
                const existing = document.querySelector('.custom-dropdown-menu');
                if (existing) { globalDropdown = existing; return globalDropdown; }
                globalDropdown = document.createElement('div');
                globalDropdown.className = 'custom-dropdown-menu';
                globalDropdown.style.cssText = 'position:fixed;z-index:2147483647;background:white;border:1px solid rgba(0,0,0,0.15);border-radius:6px;box-shadow:0 10px 30px rgba(0,0,0,0.2);min-width:180px;padding:8px 0;display:none;font-size:14px;pointer-events:auto;';
                document.body.appendChild(globalDropdown);
                return globalDropdown;
            };

            const hideDropdown = () => {
                const el = document.querySelector('.custom-dropdown-menu');
                if (el) el.style.display = 'none';
            };

            $(document).off('click.growerIntakeDropdown').on('click.growerIntakeDropdown', (e) => {
                const button = e.target.closest('button.js-intake-batch-actions');
                if (button && $(button).closest('#intakeBatchesTable').length) {
                    e.preventDefault();
                    e.stopPropagation();
                    const batchId = button.getAttribute('data-batch-id');
                    const checklistId = button.getAttribute('data-receiving-checklist-id') || '';
                    const sampleId = button.getAttribute('data-sample-submission-id') || '';
                    const checklistDone = !!checklistId;
                    const sampleDone = !!sampleId;
                    const sampleEnabled = checklistDone;
                    const canRelease = checklistDone && sampleDone;

                    const checklistLabel = checklistDone ? '&#10003; Receiving checklist' : 'Receiving checklist';
                    const sampleLabel = sampleDone ? '&#10003; Batch sample' : (sampleEnabled ? 'New batch sample' : 'Batch sample');
                    const releaseLabel = 'Release to production';

                    const parts = [];
                    parts.push('<a href="#" class="dropdown-item-intake-checklist" style="display:block;padding:8px 16px;text-decoration:none;color:#212529;"><i class="fas fa-clipboard-check me-2"></i>' + checklistLabel + '</a>');
                    if (sampleDone) {
                        parts.push('<a href="#" class="dropdown-item-intake-sample-view" style="display:block;padding:8px 16px;text-decoration:none;color:#212529;"><i class="fas fa-vial me-2"></i>' + sampleLabel + '</a>');
                    } else if (sampleEnabled) {
                        parts.push('<a href="#" class="dropdown-item-intake-sample-submit" style="display:block;padding:8px 16px;text-decoration:none;color:#212529;"><i class="fas fa-vial me-2"></i>' + sampleLabel + '</a>');
                    } else {
                        parts.push('<span style="display:block;padding:8px 16px;color:#6c757d;cursor:not-allowed;"><i class="fas fa-vial me-2"></i>' + sampleLabel + '</span>');
                    }
                    parts.push('<hr style="margin:4px 0;border-top:1px solid #eee;">');
                    if (canRelease) {
                        parts.push('<a href="#" class="dropdown-item-intake-release" style="display:block;padding:8px 16px;text-decoration:none;color:#212529;"><i class="fas fa-arrow-right me-2"></i>' + releaseLabel + '</a>');
                    } else {
                        parts.push('<span style="display:block;padding:8px 16px;color:#6c757d;cursor:not-allowed;"><i class="fas fa-arrow-right me-2"></i>' + releaseLabel + '</span>');
                    }

                    const dropdown = getDropdown();
                    dropdown.innerHTML = parts.join('');
                    dropdown.dataset.batchId = batchId;
                    dropdown.dataset.checklistId = checklistId;
                    dropdown.dataset.sampleId = sampleId;

                    const rect = button.getBoundingClientRect();
                    let top = rect.bottom + 5;
                    let left = rect.left;
                    if (left + 180 > window.innerWidth) left = rect.right - 180;
                    if (top + 150 > window.innerHeight) top = rect.top - 150;
                    left = Math.max(10, left);
                    top = Math.max(10, top);
                    dropdown.style.left = left + 'px';
                    dropdown.style.top = top + 'px';
                    dropdown.style.display = 'block';

                    dropdown.querySelectorAll('a').forEach((link) => {
                        link.addEventListener('mouseenter', function () { this.style.backgroundColor = '#f8f9fa'; });
                        link.addEventListener('mouseleave', function () { this.style.backgroundColor = 'transparent'; });
                        link.addEventListener('click', function (ev) {
                            ev.preventDefault();
                            hideDropdown();
                            const bid = dropdown.dataset.batchId;
                            const cid = dropdown.dataset.checklistId || null;
                            const sid = dropdown.dataset.sampleId;
                            if (this.classList.contains('dropdown-item-intake-checklist') && typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.show) {
                                _modal_grower_receiving_checklist.show(bid, cid || undefined);
                            } else if (this.classList.contains('dropdown-item-intake-sample-view') && sid) {
                                scope.viewSample(sid);
                            } else if (this.classList.contains('dropdown-item-intake-sample-submit') && typeof _modal_grower_link_sample_to_batch !== 'undefined' && _modal_grower_link_sample_to_batch.show) {
                                _modal_grower_link_sample_to_batch.show(bid);
                            } else if (this.classList.contains('dropdown-item-intake-release') && bid) {
                                scope.moveBatchToRawStock(bid);
                            }
                        });
                    });
                } else if (!$(e.target).closest('.custom-dropdown-menu').length && !$(e.target).closest('button.js-intake-batch-actions').length) {
                    hideDropdown();
                }
            });

            $(window).off('scroll.growerIntakeDropdown resize.growerIntakeDropdown').on('scroll.growerIntakeDropdown resize.growerIntakeDropdown', () => hideDropdown());
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

            $(document).on('click', '#intakeBatchesTableBody tr.js-intake-batch-row', (e) => {
                if ($(e.target).closest('.custom-dropdown-menu').length || $(e.target).closest('button.js-intake-batch-actions').length) return;
                const batchId = $(e.currentTarget).data('batch-id');
                const checklistId = $(e.currentTarget).data('receiving-checklist-id') || null;
                if (batchId && typeof _modal_grower_receiving_checklist !== 'undefined' && _modal_grower_receiving_checklist.show) {
                    _modal_grower_receiving_checklist.show(batchId, checklistId || undefined);
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
                const checklistId = b.receiving_checklist_id || b.receivingChecklistId || '';
                const sampleId = b.sample_submission_id || b.sampleSubmissionId || '';

                const checklistLabel = checklistDone ? '&#10003; Receiving checklist' : 'Receiving checklist';
                const sampleLabel = sampleDone ? '&#10003; Batch sample' : (sampleEnabled ? 'New batch sample' : 'Batch sample');
                const releaseLabel = 'Release to production';

                /* Body-mounted dropdown: button only, no menu in cell (INSTRUCTIONS-DROPDOWNS-IN-TABLES) */
                const actionsCell = '<button type="button" class="btn btn-sm btn-outline-secondary js-intake-batch-actions" data-batch-id="' + b.id + '" data-receiving-checklist-id="' + checklistId + '" data-sample-submission-id="' + sampleId + '" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>';

                const stage1Badges = '<span class="badge ' + (checklistDone ? 'bg-success' : 'bg-secondary') + ' me-1">Checklist ' + (checklistDone ? '&#10003;' : '○') + '</span>' +
                    '<span class="badge ' + (sampleDone ? 'bg-success' : 'bg-secondary') + '">Sample ' + (sampleDone ? '&#10003;' : '○') + '</span>';

                const row = '<tr class="js-intake-batch-row" data-batch-id="' + b.id + '" data-receiving-checklist-id="' + checklistId + '">' +
                    '<td>' + (b.batch_number || '') + '</td>' +
                    '<td>' + (b.grower_name || '') + '</td>' +
                    '<td>' + receivedDate + '</td>' +
                    '<td>' + (b.wet_nis_received_kg || '') + '</td>' +
                    '<td>' + stage1Badges + '</td>' +
                    '<td><span class="badge bg-info">' + (b.status || '') + '</span></td>' +
                    '<td>' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
        },

        moveBatchToRawStock: async (batchId) => {
            const scope = _growerIntakeGrid;
            if (!batchId) return;
            try {
                const result = await dataFunctions.updateProductionBatch(batchId, { status: 'in_production', stage: 'production' });
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Released', text: 'Batch is now in Kernel Production. Complete Production and End sample, then Release to stock.', timer: 2500, showConfirmButton: false });
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
