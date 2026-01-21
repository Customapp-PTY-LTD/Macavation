/**
 * Grower Intake Grid Module
 * Handles sample submissions and main run documents
 */

var _growerIntakeGrid = function () {
    return {
        samples: [],
        filteredSamples: [],
        currentPage: 1,
        itemsPerPage: 20,
        searchTimeout: null,

        init: function () {
            this.setupEventListeners();
            this.loadSamples();
        },

        setupEventListeners: function () {
            const scope = this;
            $('#addSampleBtn').on('click', function () {
                scope.showAddSampleModal();
            });
            
            // Search with debouncing
            $('#searchSamplesInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterSamples();
                }, 300);
            });
            
            // Filters
            $('#filterSampleStatus, #filterSampleDate').on('change', function () {
                scope.filterSamples();
            });
            
            // Clear filters
            $('#clearSampleFiltersBtn').on('click', function () {
                $('#searchSamplesInput').val('');
                $('#filterSampleStatus').val('');
                $('#filterSampleDate').val('');
                scope.filterSamples();
            });
        },
        filterSamples: function () {
            const searchTerm = $('#searchSamplesInput').val().toLowerCase();
            const statusFilter = $('#filterSampleStatus').val();
            const dateFilter = $('#filterSampleDate').val();
            
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
            
            this.filteredSamples = this.samples.filter(sample => {
                // Search filter
                const matchesSearch = !searchTerm || 
                    (sample.submission_number && sample.submission_number.toLowerCase().includes(searchTerm)) ||
                    (sample.grower_name && sample.grower_name.toLowerCase().includes(searchTerm)) ||
                    (sample.status && sample.status.toLowerCase().includes(searchTerm));
                
                // Status filter
                const matchesStatus = !statusFilter || sample.status === statusFilter;
                
                // Date filter
                let matchesDate = true;
                if (dateFilter && sample.delivery_date) {
                    const deliveryDate = new Date(sample.delivery_date);
                    if (dateFilter === 'today') matchesDate = deliveryDate >= today;
                    else if (dateFilter === 'week') matchesDate = deliveryDate >= weekAgo;
                    else if (dateFilter === 'month') matchesDate = deliveryDate >= monthAgo;
                }
                
                return matchesSearch && matchesStatus && matchesDate;
            });
            
            this.renderSamples();
        },

        loadSamples: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                const samples = await dataFunctions.getSampleSubmissions(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Sample submissions loaded in ${loadTime.toFixed(2)}ms`);
                
                this.samples = samples || [];
                this.filteredSamples = this.samples;
                this.renderSamples();
            } catch (error) {
                console.error('Error loading samples:', error);
                this.showError('Error loading samples: ' + error.message);
            }
        },

        renderSamples: function () {
            const tbody = $('#samplesTableBody');
            tbody.empty();

            if (this.filteredSamples.length === 0) {
                if (this.samples.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No sample submissions found. Click "New Sample Submission" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No samples match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }

            this.filteredSamples.forEach(sample => {
                const row = `
                    <tr>
                        <td>${sample.submission_number || 'N/A'}</td>
                        <td>${sample.grower_name || 'N/A'}</td>
                        <td>${sample.delivery_date || 'N/A'}</td>
                        <td>${sample.wet_nut_in_shell_kg || '0'}</td>
                        <td>${sample.moisture_content_percentage || '0'}%</td>
                        <td><span class="badge bg-info">${sample.status || 'pending'}</span></td>
                        <td>
                            <button class="btn btn-sm btn-outline-primary" onclick="growerIntakeGrid.viewSample('${sample.id}')">
                                <i class="fas fa-eye"></i>
                            </button>
                        </td>
                    </tr>
                `;
                tbody.append(row);
            });
        },

        showAddSampleModal: function () {
            Swal.fire('Info', 'Sample submission form coming soon', 'info');
        },

        viewSample: function (sampleId) {
            Swal.fire('Info', 'Sample details view coming soon', 'info');
        },

        showError: function (message) {
            Swal.fire({ icon: 'error', title: 'Error', text: message });
        },
        
        exportSamples: function () {
            if (!this.samples || this.samples.length === 0) {
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
                exportUtils.exportToCSV(this.samples, 'sample_submissions', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

const growerIntakeGrid = _growerIntakeGrid;

function initializeGrowerIntakeGrid() {
    if (typeof growerIntakeGrid !== 'undefined') {
        growerIntakeGrid.init();
    }
}

