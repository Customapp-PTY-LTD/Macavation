/**
 * Test Data Grid Module
 * Handles test data sets and records management with Supabase integration
 */

var _testDataGrid = function () {
    return {
        dataSets: [],
        filteredDataSets: [],
        records: [],
        filteredRecords: [],
        currentPage: 1,
        itemsPerPage: 20,
        editingDataSet: null,
        editingRecord: null,
        searchTimeout: null,
        currentFilters: {},
        activeTab: 'data-sets',

        init: function () {
            // Check permissions before initializing
            if (typeof dataFunctions === 'undefined' || !dataFunctions.canAccessTestManagement()) {
                this.showAccessDenied();
                return;
            }
            
            this.setupEventListeners();
            this.loadDataSets();
            this.loadModulesForFilter();
        },

        showAccessDenied: function () {
            const contentArea = document.querySelector('.module-content') || document.getElementById('content-area');
            if (contentArea) {
                contentArea.innerHTML = `
                    <div class="alert alert-danger" role="alert">
                        <h4 class="alert-heading"><i class="fas fa-exclamation-triangle me-2"></i>Access Denied</h4>
                        <p>You need Super Admin role to access Test Data Management.</p>
                        <hr>
                        <p class="mb-0">Please contact your system administrator if you believe you should have access.</p>
                    </div>
                `;
            }
        },

        setupEventListeners: function () {
            const scope = this;

            // Tab switching
            $('#data-sets-tab, #records-tab').on('shown.bs.tab', function (e) {
                const target = $(e.target).data('bs-target');
                scope.activeTab = target.replace('#', '');
                if (scope.activeTab === 'records') {
                    scope.loadRecords();
                    $('#addRecordBtn').show();
                } else {
                    $('#addRecordBtn').hide();
                }
            });

            // Search functionality
            $('#searchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.performSearch();
                }, 300);
            });

            $('#searchBtn').on('click', function () {
                scope.performSearch();
            });

            // Filter functionality
            $('#filterModule, #filterEntityType, #filterPurpose').on('change', function () {
                scope.applyFilters();
            });

            $('#applyFiltersBtn').on('click', function () {
                scope.applyFilters();
            });

            $('#clearFiltersBtn').on('click', function () {
                scope.clearFilters();
            });

            // Data set selector for records
            $('#recordDataSetSelect').on('change', function () {
                scope.filterRecords();
            });

            // Pagination
            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const page = parseInt($(this).data('page'));
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    if (scope.activeTab === 'data-sets') {
                        scope.renderDataSets();
                    } else {
                        scope.renderRecords();
                    }
                }
            });

            // Add buttons
            $('#addDataSetBtn').on('click', function () {
                scope.showAddDataSetModal();
            });

            $('#addRecordBtn').on('click', function () {
                scope.showAddRecordModal();
            });

            // Edit data set
            $(document).on('click', '.edit-data-set-btn', function () {
                const setId = $(this).data('set-id');
                scope.editDataSet(setId);
            });

            // View records for data set
            $(document).on('click', '.view-records-btn', function () {
                const setId = $(this).data('set-id');
                scope.viewRecordsForSet(setId);
            });

            // Delete data set
            $(document).on('click', '.delete-data-set-btn', function () {
                const setId = $(this).data('set-id');
                scope.deleteDataSet(setId);
            });

            // Edit record
            $(document).on('click', '.edit-record-btn', function () {
                const recordId = $(this).data('record-id');
                scope.editRecord(recordId);
            });

            // Delete record
            $(document).on('click', '.delete-record-btn', function () {
                const recordId = $(this).data('record-id');
                scope.deleteRecord(recordId);
            });

            // Save buttons
            $('#saveDataSetBtn').on('click', function () {
                scope.saveDataSet();
            });

            $('#saveRecordBtn').on('click', function () {
                scope.saveRecord();
            });

            // Modal events
            $('#dataSetModal').on('hidden.bs.modal', function () {
                scope.clearDataSetForm();
            });

            $('#recordModal').on('hidden.bs.modal', function () {
                scope.clearRecordForm();
            });
        },

        loadDataSets: async function (forceRefresh = false) {
            try {
                this.showDataSetsLoading();
                const dataSets = await dataFunctions.getTestDataSets(null, forceRefresh);
                this.dataSets = dataSets || [];
                this.filteredDataSets = this.dataSets;
                this.currentPage = 1;
                this.renderDataSets();
                this.populateDataSetSelectors();
                this.hideDataSetsLoading();
            } catch (error) {
                console.error('Error loading data sets:', error);
                this.showError('Error loading data sets: ' + error.message);
                this.hideDataSetsLoading();
            }
        },

        loadRecords: async function (setId = null) {
            // Check permissions
            if (!dataFunctions.canAccessTestManagement()) {
                this.showAccessDenied();
                return;
            }
            
            try {
                this.showRecordsLoading();
                if (setId) {
                    const records = await dataFunctions.getTestDataRecordsBySet(setId);
                    this.records = records || [];
                } else {
                    // Load all records by searching
                    const records = await dataFunctions.searchTestDataRecords({});
                    this.records = records || [];
                }
                this.filteredRecords = this.records;
                this.currentPage = 1;
                this.renderRecords();
                this.hideRecordsLoading();
            } catch (error) {
                console.error('Error loading records:', error);
                // Check if it's a permission error
                if (error.message && (error.message.includes('403') || error.message.includes('permission') || error.message.includes('forbidden'))) {
                    this.showAccessDenied();
                } else {
                    this.showError('Error loading records: ' + error.message);
                }
                this.hideRecordsLoading();
            }
        },

        loadModulesForFilter: function () {
            const modules = [
                'authentication', 'crm', 'grower-intake', 'kernel-production',
                'oil-production', 'quality-assurance', 'stock-management',
                'sales-forecasting', 'financial-management', 'user-management',
                'dashboard', 'document-management', 'palladium-integration'
            ];

            const moduleSelects = ['filterModule', 'setModule'];
            moduleSelects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    let html = '<option value="">All Modules</option>';
                    if (selectId === 'setModule') {
                        html = '';
                    }
                    modules.forEach(module => {
                        html += `<option value="${module}">${module}</option>`;
                    });
                    select.innerHTML = html;
                }
            });
        },

        populateDataSetSelectors: function () {
            const selects = ['recordDataSetId', 'recordDataSetSelect'];
            selects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    let html = '<option value="">Select Data Set</option>';
                    if (selectId === 'recordDataSetSelect') {
                        html = '<option value="">All Data Sets</option>';
                    }
                    this.dataSets.forEach(set => {
                        html += `<option value="${set.id}">${set.set_name} (${set.module})</option>`;
                    });
                    select.innerHTML = html;
                }
            });
        },

        performSearch: async function () {
            const searchTerm = $('#searchInput').val().trim();
            
            if (this.activeTab === 'data-sets') {
                if (searchTerm) {
                    this.currentFilters = { searchTerm: searchTerm };
                    const results = await dataFunctions.searchTestDataSets(this.currentFilters);
                    this.dataSets = results || [];
                } else {
                    this.dataSets = await dataFunctions.getTestDataSets();
                }
                this.filteredDataSets = this.dataSets;
                this.currentPage = 1;
                this.renderDataSets();
            } else {
                if (searchTerm) {
                    this.currentFilters = { searchTerm: searchTerm };
                    const results = await dataFunctions.searchTestDataRecords(this.currentFilters);
                    this.records = results || [];
                } else {
                    this.records = await dataFunctions.searchTestDataRecords({});
                }
                this.filteredRecords = this.records;
                this.currentPage = 1;
                this.renderRecords();
            }
        },

        applyFilters: function () {
            if (this.activeTab === 'data-sets') {
                const moduleFilter = $('#filterModule').val();
                this.currentFilters = {
                    module: moduleFilter || null,
                    searchTerm: $('#searchInput').val().trim() || null
                };
                this.filterDataSets();
            } else {
                const entityTypeFilter = $('#filterEntityType').val();
                const purposeFilter = $('#filterPurpose').val();
                const dataSetFilter = $('#recordDataSetSelect').val();
                this.currentFilters = {
                    entity_type: entityTypeFilter || null,
                    purpose: purposeFilter || null,
                    data_set_id: dataSetFilter || null,
                    searchTerm: $('#searchInput').val().trim() || null
                };
                this.filterRecords();
            }
        },

        filterDataSets: function () {
            const moduleFilter = $('#filterModule').val();
            const searchTerm = $('#searchInput').val().toLowerCase();

            this.filteredDataSets = this.dataSets.filter(set => {
                const matchesSearch = !searchTerm ||
                    (set.set_name && set.set_name.toLowerCase().includes(searchTerm)) ||
                    (set.description && set.description.toLowerCase().includes(searchTerm)) ||
                    (set.module && set.module.toLowerCase().includes(searchTerm));
                const matchesModule = !moduleFilter || set.module === moduleFilter;
                return matchesSearch && matchesModule;
            });

            this.currentPage = 1;
            this.renderDataSets();
        },

        filterRecords: function () {
            const entityTypeFilter = $('#filterEntityType').val();
            const purposeFilter = $('#filterPurpose').val();
            const dataSetFilter = $('#recordDataSetSelect').val();
            const searchTerm = $('#searchInput').val().toLowerCase();

            this.filteredRecords = this.records.filter(record => {
                const matchesSearch = !searchTerm ||
                    (record.data_key && record.data_key.toLowerCase().includes(searchTerm)) ||
                    (record.entity_type && record.entity_type.toLowerCase().includes(searchTerm)) ||
                    (record.purpose && record.purpose.toLowerCase().includes(searchTerm)) ||
                    (record.set_name && record.set_name.toLowerCase().includes(searchTerm));
                const matchesEntityType = !entityTypeFilter || record.entity_type === entityTypeFilter;
                const matchesPurpose = !purposeFilter || (record.purpose && record.purpose.toLowerCase().includes(purposeFilter.toLowerCase()));
                const matchesDataSet = !dataSetFilter || record.data_set_id === dataSetFilter;
                return matchesSearch && matchesEntityType && matchesPurpose && matchesDataSet;
            });

            this.currentPage = 1;
            this.renderRecords();
        },

        clearFilters: function () {
            $('#filterModule').val('');
            $('#filterEntityType').val('');
            $('#filterPurpose').val('');
            $('#recordDataSetSelect').val('');
            $('#searchInput').val('');
            this.currentFilters = {};
            if (this.activeTab === 'data-sets') {
                this.filteredDataSets = this.dataSets;
                this.renderDataSets();
            } else {
                this.filteredRecords = this.records;
                this.renderRecords();
            }
        },

        renderDataSets: function () {
            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const pageDataSets = this.filteredDataSets.slice(startIndex, endIndex);

            if (this.filteredDataSets.length === 0) {
                $('#dataSetsTableBody').empty();
                $('#dataSetsEmpty').show();
                $('#dataSetsTable').hide();
                this.renderPagination();
                return;
            }

            $('#dataSetsEmpty').hide();
            $('#dataSetsTable').show();

            let html = '';
            pageDataSets.forEach(set => {
                const statusBadge = set.is_active 
                    ? '<span class="badge bg-success">Active</span>' 
                    : '<span class="badge bg-danger">Inactive</span>';
                const scenarioCount = set.test_scenario_ids ? set.test_scenario_ids.length : 0;

                html += `
                    <tr>
                        <td><strong>${this.escapeHtml(set.set_name || 'N/A')}</strong></td>
                        <td>${this.escapeHtml(set.module || 'N/A')}</td>
                        <td>${this.escapeHtml(set.description || 'N/A')}</td>
                        <td><span class="badge bg-info">${set.record_count || 0}</span></td>
                        <td><span class="badge bg-secondary">${scenarioCount}</span></td>
                        <td>${statusBadge}</td>
                        <td>
                            <div class="btn-group btn-group-sm" role="group">
                                <button type="button" class="btn btn-outline-primary edit-data-set-btn" data-set-id="${set.id}" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button type="button" class="btn btn-outline-info view-records-btn" data-set-id="${set.id}" title="View Records">
                                    <i class="fas fa-list"></i>
                                </button>
                                <button type="button" class="btn btn-outline-danger delete-data-set-btn" data-set-id="${set.id}" title="Delete">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            $('#dataSetsTableBody').html(html);
            this.renderPagination();
        },

        renderRecords: function () {
            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const pageRecords = this.filteredRecords.slice(startIndex, endIndex);

            if (this.filteredRecords.length === 0) {
                $('#recordsTableBody').empty();
                $('#recordsEmpty').show();
                $('#recordsTable').hide();
                this.renderPagination();
                return;
            }

            $('#recordsEmpty').hide();
            $('#recordsTable').show();

            let html = '';
            pageRecords.forEach(record => {
                const cleanupBadge = record.cleanup_required 
                    ? '<span class="badge bg-warning">Yes</span>' 
                    : '<span class="badge bg-success">No</span>';
                const dataValuePreview = this.previewJson(record.data_value);

                html += `
                    <tr>
                        <td><strong>${this.escapeHtml(record.data_key || 'N/A')}</strong></td>
                        <td>${this.escapeHtml(record.entity_type || 'N/A')}</td>
                        <td>${this.escapeHtml(record.set_name || 'N/A')}</td>
                        <td>${this.escapeHtml(record.purpose || 'N/A')}</td>
                        <td>${cleanupBadge}</td>
                        <td>
                            <div class="btn-group btn-group-sm" role="group">
                                <button type="button" class="btn btn-outline-primary edit-record-btn" data-record-id="${record.id}" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button type="button" class="btn btn-outline-info" onclick="testDataGrid.viewRecordDetails('${record.id}')" title="View Details">
                                    <i class="fas fa-eye"></i>
                                </button>
                                <button type="button" class="btn btn-outline-danger delete-record-btn" data-record-id="${record.id}" title="Delete">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            $('#recordsTableBody').html(html);
            this.renderPagination();
        },

        previewJson: function (json) {
            if (!json) return 'N/A';
            try {
                const obj = typeof json === 'string' ? JSON.parse(json) : json;
                const keys = Object.keys(obj);
                return keys.length > 0 ? `${keys.length} fields` : 'Empty';
            } catch (e) {
                return 'Invalid JSON';
            }
        },

        renderPagination: function () {
            const totalItems = this.activeTab === 'data-sets' ? this.filteredDataSets.length : this.filteredRecords.length;
            const totalPages = Math.ceil(totalItems / this.itemsPerPage);

            if (totalPages <= 1) {
                $('#pagination').empty();
                return;
            }

            let paginationHtml = '';

            if (this.currentPage > 1) {
                paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage - 1}">Previous</a></li>`;
            }

            for (let i = 1; i <= totalPages; i++) {
                if (i === this.currentPage) {
                    paginationHtml += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
                } else {
                    paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
                }
            }

            if (this.currentPage < totalPages) {
                paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage + 1}">Next</a></li>`;
            }

            $('#pagination').html(paginationHtml);
        },

        showAddDataSetModal: function () {
            this.editingDataSet = null;
            this.clearDataSetForm();
            $('#dataSetModalLabel').text('Add New Data Set');
            $('#dataSetModal').modal('show');
        },

        editDataSet: async function (setId) {
            try {
                const dataSet = await dataFunctions.getTestDataSetById(setId);
                if (!dataSet || (Array.isArray(dataSet) && dataSet.length === 0)) {
                    this.showError('Data set not found');
                    return;
                }

                const setData = Array.isArray(dataSet) ? dataSet[0] : dataSet;
                this.editingDataSet = setData;
                this.populateDataSetForm(setData);

                $('#dataSetModalLabel').text('Edit Data Set');
                $('#dataSetModal').modal('show');
            } catch (error) {
                console.error('Error editing data set:', error);
                this.showError('Error loading data set details: ' + error.message);
            }
        },

        populateDataSetForm: function (dataSet) {
            $('#setName').val(dataSet.set_name || '');
            $('#setModule').val(dataSet.module || '');
            $('#setDescription').val(dataSet.description || '');
            $('#setScenarioIds').val(dataSet.test_scenario_ids ? JSON.stringify(dataSet.test_scenario_ids, null, 2) : '[]');
            $('#setIsActive').prop('checked', dataSet.is_active !== false);
        },

        clearDataSetForm: function () {
            $('#dataSetForm')[0].reset();
            $('#setScenarioIds').val('[]');
            $('#setIsActive').prop('checked', true);
            this.editingDataSet = null;
        },

        saveDataSet: async function () {
            // Check permissions
            if (!dataFunctions.canAccessTestManagement()) {
                this.showError('You do not have permission to modify test data sets.');
                return;
            }
            
            try {
                let scenarioIds = [];
                try {
                    if ($('#setScenarioIds').val().trim()) {
                        scenarioIds = JSON.parse($('#setScenarioIds').val());
                    }
                } catch (e) {
                    this.showError('Invalid JSON in Scenario IDs field');
                    return;
                }

                const formData = {
                    set_name: $('#setName').val().trim(),
                    module: $('#setModule').val().trim(),
                    description: $('#setDescription').val().trim() || null,
                    test_scenario_ids: scenarioIds.length > 0 ? scenarioIds : null,
                    is_active: $('#setIsActive').is(':checked')
                };

                if (!formData.set_name) {
                    this.showError('Set Name is required');
                    return;
                }

                if (!formData.module) {
                    this.showError('Module is required');
                    return;
                }

                let result;
                if (this.editingDataSet) {
                    result = await dataFunctions.updateTestDataSet(this.editingDataSet.id, formData);
                } else {
                    result = await dataFunctions.createTestDataSet(formData);
                }

                if (result && result.success) {
                    this.showSuccess(result.message || 'Data set saved successfully');
                    $('#dataSetModal').modal('hide');
                    this.loadDataSets(true);
                } else {
                    this.showError(result?.message || 'Error saving data set');
                }
            } catch (error) {
                console.error('Error saving data set:', error);
                // Check if it's a permission error
                if (error.message && (error.message.includes('403') || error.message.includes('permission') || error.message.includes('forbidden'))) {
                    this.showError('You do not have permission to modify test data sets.');
                } else {
                    this.showError('Error saving data set: ' + error.message);
                }
            }
        },

        deleteDataSet: function (setId) {
            // Check permissions
            if (!dataFunctions.canAccessTestManagement()) {
                this.showError('You do not have permission to delete test data sets.');
                return;
            }
            
            const dataSet = this.dataSets.find(s => s.id === setId);
            if (!dataSet) return;

            Swal.fire({
                title: 'Are you sure?',
                text: `Do you want to delete "${dataSet.set_name}"? This will also delete all records in this set. This action cannot be undone.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        const deleteResult = await dataFunctions.deleteTestDataSet(setId);
                        if (deleteResult && deleteResult.success) {
                            this.showSuccess('Data set deleted successfully');
                            this.loadDataSets(true);
                        } else {
                            this.showError(deleteResult?.message || 'Error deleting data set');
                        }
                    } catch (error) {
                        console.error('Error deleting data set:', error);
                        // Check if it's a permission error
                        if (error.message && (error.message.includes('403') || error.message.includes('permission') || error.message.includes('forbidden'))) {
                            this.showError('You do not have permission to delete test data sets.');
                        } else {
                            this.showError('Error deleting data set: ' + error.message);
                        }
                    }
                }
            });
        },

        viewRecordsForSet: function (setId) {
            $('#records-tab').tab('show');
            $('#recordDataSetSelect').val(setId);
            this.loadRecords(setId);
        },

        showAddRecordModal: function () {
            this.editingRecord = null;
            this.clearRecordForm();
            this.populateDataSetSelectors();
            $('#recordModalLabel').text('Add New Record');
            $('#recordModal').modal('show');
        },

        editRecord: async function (recordId) {
            // Check permissions
            if (!dataFunctions.canAccessTestManagement()) {
                this.showError('You do not have permission to edit test data records.');
                return;
            }
            
            try {
                const record = await dataFunctions.getTestDataRecordById(recordId);
                if (!record || (Array.isArray(record) && record.length === 0)) {
                    this.showError('Record not found');
                    return;
                }

                const recordData = Array.isArray(record) ? record[0] : record;
                this.editingRecord = recordData;
                this.populateDataSetSelectors();
                
                setTimeout(() => {
                    this.populateRecordForm(recordData);
                }, 200);

                $('#recordModalLabel').text('Edit Record');
                $('#recordModal').modal('show');
            } catch (error) {
                console.error('Error editing record:', error);
                this.showError('Error loading record details: ' + error.message);
            }
        },

        populateRecordForm: function (record) {
            $('#recordDataSetId').val(record.data_set_id || '');
            $('#recordEntityType').val(record.entity_type || '');
            $('#recordDataKey').val(record.data_key || '');
            $('#recordEntityId').val(record.entity_id || '');
            $('#recordPurpose').val(record.purpose || '');
            $('#recordCleanupRequired').prop('checked', record.cleanup_required !== false);
            $('#recordDataValue').val(record.data_value ? JSON.stringify(record.data_value, null, 2) : '{}');
        },

        clearRecordForm: function () {
            $('#recordForm')[0].reset();
            $('#recordDataValue').val('{}');
            $('#recordCleanupRequired').prop('checked', true);
            this.editingRecord = null;
        },

        saveRecord: async function () {
            // Check permissions
            if (!dataFunctions.canAccessTestManagement()) {
                this.showError('You do not have permission to modify test data records.');
                return;
            }
            
            try {
                let dataValue = {};
                try {
                    if ($('#recordDataValue').val().trim()) {
                        dataValue = JSON.parse($('#recordDataValue').val());
                    }
                } catch (e) {
                    this.showError('Invalid JSON in Data Value field');
                    return;
                }

                const formData = {
                    data_set_id: $('#recordDataSetId').val(),
                    entity_type: $('#recordEntityType').val(),
                    data_key: $('#recordDataKey').val().trim(),
                    entity_id: $('#recordEntityId').val().trim() || null,
                    data_value: dataValue,
                    purpose: $('#recordPurpose').val().trim() || null,
                    cleanup_required: $('#recordCleanupRequired').is(':checked')
                };

                if (!formData.data_set_id) {
                    this.showError('Data Set is required');
                    return;
                }

                if (!formData.entity_type) {
                    this.showError('Entity Type is required');
                    return;
                }

                if (!formData.data_key) {
                    this.showError('Data Key is required');
                    return;
                }

                let result;
                if (this.editingRecord) {
                    result = await dataFunctions.updateTestDataRecord(this.editingRecord.id, formData);
                } else {
                    result = await dataFunctions.createTestDataRecord(formData);
                }

                if (result && result.success) {
                    this.showSuccess(result.message || 'Record saved successfully');
                    $('#recordModal').modal('hide');
                    this.loadRecords();
                } else {
                    this.showError(result?.message || 'Error saving record');
                }
            } catch (error) {
                console.error('Error saving record:', error);
                // Check if it's a permission error
                if (error.message && (error.message.includes('403') || error.message.includes('permission') || error.message.includes('forbidden'))) {
                    this.showError('You do not have permission to modify test data records.');
                } else {
                    this.showError('Error saving record: ' + error.message);
                }
            }
        },

        deleteRecord: function (recordId) {
            // Check permissions
            if (!dataFunctions.canAccessTestManagement()) {
                this.showError('You do not have permission to delete test data records.');
                return;
            }
            
            const record = this.records.find(r => r.id === recordId);
            if (!record) return;

            Swal.fire({
                title: 'Are you sure?',
                text: `Do you want to delete record "${record.data_key}"? This action cannot be undone.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        const deleteResult = await dataFunctions.deleteTestDataRecord(recordId);
                        if (deleteResult && deleteResult.success) {
                            this.showSuccess('Record deleted successfully');
                            this.loadRecords();
                        } else {
                            this.showError(deleteResult?.message || 'Error deleting record');
                        }
                    } catch (error) {
                        console.error('Error deleting record:', error);
                        // Check if it's a permission error
                        if (error.message && (error.message.includes('403') || error.message.includes('permission') || error.message.includes('forbidden'))) {
                            this.showError('You do not have permission to delete test data records.');
                        } else {
                            this.showError('Error deleting record: ' + error.message);
                        }
                    }
                }
            });
        },

        viewRecordDetails: async function (recordId) {
            try {
                const record = await dataFunctions.getTestDataRecordById(recordId);
                if (!record || (Array.isArray(record) && record.length === 0)) {
                    this.showError('Record not found');
                    return;
                }

                const recordData = Array.isArray(record) ? record[0] : record;
                const dataValueJson = JSON.stringify(recordData.data_value, null, 2);

                Swal.fire({
                    title: `Record: ${recordData.data_key}`,
                    html: `
                        <div class="text-start">
                            <p><strong>Entity Type:</strong> ${this.escapeHtml(recordData.entity_type)}</p>
                            <p><strong>Data Set:</strong> ${this.escapeHtml(recordData.set_name)}</p>
                            <p><strong>Purpose:</strong> ${this.escapeHtml(recordData.purpose || 'N/A')}</p>
                            <p><strong>Cleanup Required:</strong> ${recordData.cleanup_required ? 'Yes' : 'No'}</p>
                            <hr>
                            <p><strong>Data Value:</strong></p>
                            <pre class="bg-light p-3 text-start" style="max-height: 400px; overflow-y: auto;">${this.escapeHtml(dataValueJson)}</pre>
                        </div>
                    `,
                    width: '800px',
                    showCloseButton: true,
                    showConfirmButton: false
                });
            } catch (error) {
                console.error('Error viewing record:', error);
                this.showError('Error loading record details: ' + error.message);
            }
        },

        confirmDelete: function () {
            // Handled by individual delete functions
        },

        refreshData: function () {
            if (this.activeTab === 'data-sets') {
                this.loadDataSets(true);
            } else {
                this.loadRecords();
            }
        },

        exportData: function () {
            if (this.activeTab === 'data-sets') {
                this.exportDataSets();
            } else {
                this.exportRecords();
            }
        },

        exportDataSets: function () {
            const headers = ['Set Name', 'Module', 'Description', 'Records', 'Scenarios', 'Status'];
            const rows = this.filteredDataSets.map(s => [
                s.set_name || '',
                s.module || '',
                s.description || '',
                s.record_count || 0,
                s.test_scenario_ids ? s.test_scenario_ids.length : 0,
                s.is_active ? 'Active' : 'Inactive'
            ]);

            const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `test_data_sets_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
        },

        exportRecords: function () {
            const headers = ['Data Key', 'Entity Type', 'Data Set', 'Purpose', 'Cleanup Required'];
            const rows = this.filteredRecords.map(r => [
                r.data_key || '',
                r.entity_type || '',
                r.set_name || '',
                r.purpose || '',
                r.cleanup_required ? 'Yes' : 'No'
            ]);

            const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `test_data_records_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
        },

        showDataSetsLoading: function () {
            $('#dataSetsLoading').show();
            $('#dataSetsTable').hide();
            $('#dataSetsEmpty').hide();
        },

        hideDataSetsLoading: function () {
            $('#dataSetsLoading').hide();
        },

        showRecordsLoading: function () {
            $('#recordsLoading').show();
            $('#recordsTable').hide();
            $('#recordsEmpty').hide();
        },

        hideRecordsLoading: function () {
            $('#recordsLoading').hide();
        },

        showError: function (message) {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: message
            });
        },

        showSuccess: function (message) {
            Swal.fire({
                icon: 'success',
                title: 'Success',
                text: message,
                timer: 2000,
                showConfirmButton: false
            });
        },

        escapeHtml: function (text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

// Create global instance
const testDataGrid = _testDataGrid;

// Make it available globally
window.testDataGrid = testDataGrid;

// Initialize when DOM is ready
$(document).ready(function () {
    if ($('#dataSetsTable').length) {
        testDataGrid.init();
    }
});
