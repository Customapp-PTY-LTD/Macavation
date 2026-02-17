/**
 * Grower Intake Grid Module
 * Handles sample submissions and main run documents
 */
var _growerIntakeGrid = function () {
    'use strict';

    return {
        samples: [],
        filteredSamples: [],
        currentPage: 1,
        itemsPerPage: 20,
        searchTimeout: null,
        _handlersBound: false,

        init: async () => {
            const scope = _growerIntakeGrid;
            scope.initHandlers();
            await scope.loadSamples();
        },

        initHandlers: () => {
            const scope = _growerIntakeGrid;
            $('#addSampleBtn').off('click').on('click', () => scope.showAddSampleModal());

            $('#searchSamplesInput').off('input').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => scope.filterSamples(), 300);
            });

            $('#filterSampleStatus, #filterSampleDate').off('change').on('change', () => scope.filterSamples());

            $('#clearSampleFiltersBtn').off('click').on('click', () => {
                $('#searchSamplesInput').val('');
                $('#filterSampleStatus').val('');
                $('#filterSampleDate').val('');
                scope.filterSamples();
            });

            $('#exportSamplesBtn').off('click').on('click', () => scope.exportSamples());

            if (!scope._handlersBound) {
                scope._handlersBound = true;
                $(document).on('click', '.js-view-sample', function (e) {
                    e.preventDefault();
                    const id = $(this).data('id');
                    if (id) scope.viewSample(id);
                });
                $(document).on('click', '.js-grower-intake-row', function (e) {
                    if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                    const id = $(this).data('id');
                    if (id) scope.viewSample(id);
                });
            }
        },

        filterSamples: () => {
            const scope = _growerIntakeGrid;
            const searchTerm = $('#searchSamplesInput').val().toLowerCase();
            const statusFilter = $('#filterSampleStatus').val();
            const dateFilter = $('#filterSampleDate').val();

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

            scope.filteredSamples = scope.samples.filter(sample => {
                const matchesSearch = !searchTerm ||
                    (sample.submission_number && sample.submission_number.toLowerCase().includes(searchTerm)) ||
                    (sample.grower_name && sample.grower_name.toLowerCase().includes(searchTerm)) ||
                    (sample.status && sample.status.toLowerCase().includes(searchTerm));

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
                const startTime = performance.now();
                const samples = await dataFunctions.getSampleSubmissions(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Sample submissions loaded in ${loadTime.toFixed(2)}ms`);

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
            tbody.empty();

            if (scope.filteredSamples.length === 0) {
                if (scope.samples.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No sample submissions found. Click "New Sample Submission" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No samples match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }

            const displayDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY)
                ? (v) => (_common.formatDateDDMMYYYY(v) || 'N/A')
                : (v) => (v ? (String(v).split ? String(v).split('T')[0] : v) : 'N/A');

            scope.filteredSamples.forEach(sample => {
                const actionsCell = '<div class="dropdown">' +
                    '<button class="btn btn-sm btn-outline-secondary" type="button" id="sampleActions' + sample.id + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                    '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="sampleActions' + sample.id + '">' +
                    '<a class="dropdown-item js-view-sample" href="#" data-id="' + sample.id + '"><i class="fas fa-eye me-2"></i>View</a>' +
                    '</ul></div>';
                const row = '<tr class="js-grower-intake-row" data-id="' + sample.id + '">' +
                    '<td>' + (sample.submission_number || 'N/A') + '</td>' +
                    '<td>' + (sample.grower_name || 'N/A') + '</td>' +
                    '<td>' + displayDate(sample.delivery_date) + '</td>' +
                    '<td>' + (sample.wet_nut_in_shell_kg || '0') + '</td>' +
                    '<td>' + (sample.moisture_content_percentage || '0') + '%</td>' +
                    '<td><span class="badge bg-info">' + (sample.status || 'pending') + '</span></td>' +
                    '<td>' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
        },

        showAddSampleModal: () => {
            Swal.fire('Info', 'Sample submission form coming soon', 'info');
        },

        viewSample: (sampleId) => {
            Swal.fire('Info', 'Sample details view coming soon', 'info');
        },

        showError: (message) => {
            Swal.fire({ icon: 'error', title: 'Error', text: message });
        },

        exportSamples: () => {
            const scope = _growerIntakeGrid;
            if (!scope.samples || scope.samples.length === 0) {
                Swal.fire('Info', 'No samples to export', 'info');
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
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

_growerIntakeGrid.init();
