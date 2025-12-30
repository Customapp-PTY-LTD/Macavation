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

        init: function () {
            this.setupEventListeners();
            this.loadSamples();
        },

        setupEventListeners: function () {
            const scope = this;
            $('#addSampleBtn').on('click', function () {
                scope.showAddSampleModal();
            });
        },

        loadSamples: async function () {
            try {
                // TODO: Implement get_sample_submissions function in data-functions.js
                const samples = await dataFunctions.callFunction('get_sample_submissions', {});
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
                tbody.html('<tr><td colspan="7" class="text-center text-muted">No sample submissions found</td></tr>');
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
        }
    };
}();

const growerIntakeGrid = _growerIntakeGrid;

function initializeGrowerIntakeGrid() {
    if (typeof growerIntakeGrid !== 'undefined') {
        growerIntakeGrid.init();
    }
}

