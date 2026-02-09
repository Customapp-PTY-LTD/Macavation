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
            this.loadIntakeBatches();
        },

        setupEventListeners: function () {
            const scope = this;
            $('#addSampleBtn').on('click', function () {
                scope.showAddSampleModal();
            });

            // Kernel batch journey
            $('#createKernelBatchBtn').on('click', function () { scope.showCreateKernelBatchModal(); });
            $('#saveCreateKernelBatchBtn').on('click', function () { scope.saveCreateKernelBatch(); });
            $(document).on('click', '.js-move-batch-to-raw', function () {
                const id = $(this).data('batch-id');
                if (id) scope.moveBatchToRawStock(id);
            });
            $(document).on('click', '.js-batch-receiving-checklist', function () {
                const id = $(this).data('batch-id');
                if (id) scope.openReceivingChecklistForBatch(id);
            });
            $(document).on('click', '.js-batch-sample-submission', function () {
                const id = $(this).data('batch-id');
                if (id) scope.openSampleSubmissionForBatch(id);
            });
            $('#linkSampleToBatchBtn').on('click', function () { scope.linkSampleToBatch(); });
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
                tbody.html('<tr><td colspan="7" class="text-center text-muted py-3">No kernel batches in intake. Create one to start the journey.</td></tr>');
                return;
            }
            const scope = this;
            this.intakeBatches.forEach(function (b) {
                const checklistDone = !!b.receiving_checklist_id;
                const sampleDone = !!b.sample_submission_id;
                const sampleEnabled = checklistDone;
                const checklistBox = checklistDone
                    ? '<span class="text-success me-2" title="Incoming Receiving checklist completed"><i class="fas fa-check-square"></i></span>'
                    : '<button type="button" class="btn btn-link btn-sm p-0 me-2 text-secondary js-batch-receiving-checklist" data-batch-id="' + b.id + '" title="Complete Incoming Receiving checklist"><i class="far fa-square"></i></button>';
                const checklistLabel = checklistDone ? 'Checklist' : 'Incoming Receiving checklist';
                const sampleBox = sampleDone
                    ? '<span class="text-success me-2" title="Sample submission completed"><i class="fas fa-check-square"></i></span>'
                    : (!sampleEnabled
                        ? '<span class="text-muted me-2" title="Complete checklist first"><i class="far fa-square"></i></span>'
                        : '<button type="button" class="btn btn-link btn-sm p-0 me-2 text-secondary js-batch-sample-submission" data-batch-id="' + b.id + '" title="New sample submission"><i class="far fa-square"></i></button>');
                const sampleLabel = sampleDone ? 'Sample' : 'New sample submission';
                const stepsHtml = '<div class="d-flex align-items-center flex-wrap gap-2">' +
                    checklistBox + '<span class="small">' + checklistLabel + '</span> ' +
                    sampleBox + '<span class="small">' + sampleLabel + '</span></div>';
                const row = '<tr><td>' + (b.batch_number || '') + '</td><td>' + (b.grower_name || '') + '</td><td>' + (b.received_date || '') + '</td><td>' + (b.wet_nis_received_kg || '') + '</td><td>' + stepsHtml + '</td><td><span class="badge bg-info">' + (b.status || '') + '</span></td><td><button type="button" class="btn btn-sm btn-success js-move-batch-to-raw" data-batch-id="' + b.id + '">Move to raw stock</button></td></tr>';
                tbody.append(row);
            });
        },

        openReceivingChecklistForBatch: function (batchId) {
            var batchIdEl = document.getElementById('receivingChecklistBatchId');
            if (batchIdEl) batchIdEl.value = batchId || '';
            if (typeof window.showReceivingChecklistModal === 'function') {
                window.showReceivingChecklistModal();
            } else {
                var el = document.getElementById('receivingChecklistModal');
                if (el && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    bootstrap.Modal.getOrCreateInstance(el).show();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#receivingChecklistModal').modal('show');
                }
            }
        },

        openSampleSubmissionForBatch: async function (batchId) {
            this._sampleForBatchId = batchId;
            var modal = document.getElementById('linkSampleToBatchModal');
            if (!modal) return;
            if (!this.samples || this.samples.length === 0) {
                try { await this.loadSamples(true); } catch (e) { console.error(e); }
            }
            var sel = document.getElementById('linkSampleToBatchSelect');
            if (sel) {
                sel.innerHTML = '<option value="">Select a sample to link…</option>';
                var scope = this;
                (this.samples || []).forEach(function (s) {
                    var opt = document.createElement('option');
                    opt.value = s.id;
                    opt.textContent = (s.submission_number || s.id) + ' – ' + (s.grower_name || '');
                    sel.appendChild(opt);
                });
            }
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modal).show();
            } else if (typeof $ !== 'undefined' && $.fn.modal) {
                $(modal).modal('show');
            }
        },

        linkSampleToBatch: async function () {
            var batchId = this._sampleForBatchId;
            var sel = document.getElementById('linkSampleToBatchSelect');
            var sampleId = sel && sel.value ? sel.value : null;
            if (!batchId || !sampleId) {
                Swal.fire('Please select a sample to link to this batch.', '', 'info');
                return;
            }
            try {
                var result = await dataFunctions.updateProductionBatch(batchId, { sample_submission_id: sampleId });
                if (result && result.success !== false) {
                    var modal = document.getElementById('linkSampleToBatchModal');
                    if (modal && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var inst = bootstrap.Modal.getInstance(modal);
                        if (inst) inst.hide();
                    } else if (typeof $ !== 'undefined' && $.fn.modal) {
                        $('#linkSampleToBatchModal').modal('hide');
                    }
                    this._sampleForBatchId = null;
                    Swal.fire({ icon: 'success', title: 'Linked', text: 'Sample linked to batch.', timer: 2000, showConfirmButton: false });
                    this.loadIntakeBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Update failed');
                }
            } catch (e) {
                console.error(e);
                Swal.fire('Error', e.message || 'Failed to link sample', 'error');
            }
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
                // Support direct { id }, { data: { id } }, or RPC-wrapped shape
                const id = (createResult && createResult.id) ||
                    (createResult && createResult.data && createResult.data.id) ||
                    (createResult && createResult.create_production_batch_simple && createResult.create_production_batch_simple.id);
                if (createResult && createResult.success === false && createResult.error) {
                    Swal.fire('Error', createResult.error, 'error');
                    return;
                }
                if (!id) {
                    throw new Error(createResult && createResult.error ? createResult.error : 'Create failed: no batch id returned');
                }
                await dataFunctions.updateProductionBatch(id, { status: 'intake_received', stage: 'intake' });
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    const modal = bootstrap.Modal.getInstance(document.getElementById('createKernelBatchModal'));
                    if (modal) modal.hide();
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#createKernelBatchModal').modal('hide');
                }
                Swal.fire({ icon: 'success', title: 'Batch created', text: 'Kernel batch is in intake. Complete Stage 1 steps then move to raw stock when ready.', timer: 2500, showConfirmButton: false });
                await this.loadIntakeBatches(true);
            } catch (e) {
                console.error(e);
                const msg = e.message || '';
                const isRbacDenied = msg.includes('operation EXECUTE is not allowed') || msg.includes('Access denied');
                if (isRbacDenied) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Permission denied',
                        html: 'Creating a batch was blocked by the server. <strong>Ask an admin</strong> to either set the Lambda env <code>SUPABASE_URL</code> to the project where permissions were granted, or run the EXECUTE grants on the database the server uses. See <strong>BluePrint/RBAC_GUIDE.md</strong> or <strong>LAMBDA_ENV_REQUIRED.md</strong>.'
                    });
                } else {
                    Swal.fire('Error', msg || 'Failed to create batch', 'error');
                }
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

