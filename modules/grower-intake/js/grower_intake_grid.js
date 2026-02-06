/**
 * Grower Intake Grid Module
 * Handles sample submissions and main run documents
 */

var _growerIntakeGrid = function () {
    return {
        samples: [],
        filteredSamples: [],
        intakeBatches: [],
        currentPage: 1,
        itemsPerPage: 20,
        searchTimeout: null,

        init: function () {
            this.setupEventListeners();
            this.loadSamples();
            this.loadIntakeBatches();
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

            // Kernel batch journey
            $('#createKernelBatchBtn').on('click', function () { scope.showCreateKernelBatchModal(); });
            $('#saveCreateKernelBatchBtn').on('click', function () { scope.saveCreateKernelBatch(); });
            $(document).on('click', '.js-move-batch-to-raw', function () {
                const id = $(this).data('batch-id');
                if (id) scope.moveBatchToRawStock(id);
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

        loadIntakeBatches: async function (forceRefresh) {
            try {
                const all = await dataFunctions.getProductionBatches(null, forceRefresh, { batch_type: 'kernel' });
                this.intakeBatches = (all || []).filter(function (b) {
                    return ['intake_received', 'quality_pending', 'quality_approved'].indexOf(b.status) >= 0;
                });
                this.renderIntakeBatches();
            } catch (e) {
                console.error('Error loading intake batches:', e);
                this.intakeBatches = [];
                this.renderIntakeBatches();
            }
        },

        renderIntakeBatches: function () {
            const tbody = $('#intakeBatchesTableBody');
            tbody.empty();
            if (!this.intakeBatches.length) {
                tbody.html('<tr><td colspan="6" class="text-center text-muted py-3">No kernel batches in intake. Create one to start the journey.</td></tr>');
                return;
            }
            this.intakeBatches.forEach(function (b) {
                const row = '<tr><td>' + (b.batch_number || '') + '</td><td>' + (b.grower_name || '') + '</td><td>' + (b.received_date || '') + '</td><td>' + (b.wet_nis_received_kg || '') + '</td><td><span class="badge bg-info">' + (b.status || '') + '</span></td><td><button type="button" class="btn btn-sm btn-success js-move-batch-to-raw" data-batch-id="' + b.id + '">Move to raw stock</button></td></tr>';
                tbody.append(row);
            });
        },

        showCreateKernelBatchModal: async function () {
            const today = new Date().toISOString().split('T')[0];
            $('#intakeBatchReceivedDate').val(today);
            $('#intakeBatchNumber').val('BATCH-' + new Date().getFullYear() + '-' + String(new Date().getMonth() + 1).padStart(2, '0') + '-001');
            $('#intakeBatchWetNis').val('');
            try {
                const contacts = await dataFunctions.getContacts();
                const sel = $('#intakeBatchGrower');
                sel.html('<option value="">Select (optional)</option>');
                if (contacts && contacts.length) {
                    contacts.forEach(function (c) {
                        const name = c.company_name || c.trading_name || c.primary_contact_name || 'Unknown';
                        sel.append('<option value="' + c.id + '">' + name + '</option>');
                    });
                }
            } catch (e) { console.error(e); }
            const modal = document.getElementById('createKernelBatchModal');
            if (modal && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                new bootstrap.Modal(modal).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#createKernelBatchModal').modal('show');
            }
        },

        saveCreateKernelBatch: async function () {
            const form = document.getElementById('createKernelBatchForm');
            if (!form || !form.checkValidity()) {
                form.reportValidity();
                return;
            }
            const batchNumber = $('#intakeBatchNumber').val();
            const receivedDate = $('#intakeBatchReceivedDate').val();
            const wetNis = parseFloat($('#intakeBatchWetNis').val(), 10);
            const supplierId = $('#intakeBatchGrower').val() || null;
            if (!batchNumber || !receivedDate || !wetNis || wetNis <= 0) {
                Swal.fire('Error', 'Batch number, received date and wet NIS (kg) are required.', 'error');
                return;
            }
            try {
                const createResult = await dataFunctions.createProductionBatch({
                    p_batch_number: batchNumber,
                    p_received_date: receivedDate,
                    p_wet_nis_received_kg: wetNis,
                    p_supplier_id: supplierId || undefined,
                    p_grower_name: undefined,
                    p_batch_type: 'kernel',
                    p_status: 'receiving',
                    p_current_step: 1
                });
                const id = createResult && createResult.id;
                if (!id) {
                    throw new Error(createResult && createResult.error ? createResult.error : 'Create failed');
                }
                await dataFunctions.updateProductionBatch(id, { status: 'intake_received', stage: 'intake' });
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('createKernelBatchModal'));
                    if (modal) modal.hide();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#createKernelBatchModal').modal('hide');
                }
                Swal.fire({ icon: 'success', title: 'Batch created', text: 'Kernel batch is in intake. Move to raw stock when ready.', timer: 2000, showConfirmButton: false });
                this.loadIntakeBatches(true);
            } catch (e) {
                console.error(e);
                Swal.fire('Error', e.message || 'Failed to create batch', 'error');
            }
        },

        moveBatchToRawStock: async function (batchId) {
            if (!batchId) return;
            try {
                const result = await dataFunctions.updateProductionBatch(batchId, { status: 'in_raw_stock', stage: 'raw_stock' });
                if (result && result.success !== false) {
                    Swal.fire({ icon: 'success', title: 'Moved', text: 'Batch is now in raw stock (NIS = R NIL). Release from Stock (Kernel) when ready.', timer: 2000, showConfirmButton: false });
                    this.loadIntakeBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            } catch (e) {
                console.error(e);
                Swal.fire('Error', e.message || 'Failed to move batch', 'error');
            }
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

