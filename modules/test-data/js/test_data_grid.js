/**
 * Test Data Grid Module
 * Handles test data sets and records management with Supabase integration.
 * Follows company module pattern: IIFE, arrow methods, scope = _testDataGrid for same-module calls.
 */

var _testDataGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        dataSets: [],
        filteredDataSets: [],
        records: [],
        filteredRecords: [],
        currentPage: 1,
        itemsPerPage: 20,
        editingDataSet: null,
        editingRecord: null,
        searchDebounceToken: 0,
        currentFilters: {},
        activeTab: 'data-sets',

        init: async () => {
            const scope = _testDataGrid;
            await scope.waitForReady();
            if (typeof dataFunctions === 'undefined' || !dataFunctions.canAccessTestManagement()) {
                scope.showAccessDenied();
                return;
            }
            scope.setupEventListeners();
            await scope.loadDataSets();
            scope.loadModulesForFilter();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        showAccessDenied: () => {
            const scope = _testDataGrid;
            var contentArea = document.querySelector('.module-content') || document.getElementById('content-area');
            if (contentArea) {
                contentArea.innerHTML =
                    '<div class="alert alert-danger" role="alert">' +
                    '<h4 class="alert-heading"><i class="fas fa-exclamation-triangle me-2"></i>Access Denied</h4>' +
                    '<p>You need Super Admin role to access Test Data Management.</p>' +
                    '<hr><p class="mb-0">Please contact your system administrator if you believe you should have access.</p>' +
                    '</div>';
            }
        },

        setupEventListeners: () => {
            const scope = _testDataGrid;

            $('#data-sets-tab, #records-tab').on('shown.bs.tab', function (e) {
                const scope = _testDataGrid;
                var target = $(e.target).attr('data-bs-target') || $(e.target).data('bs-target') || '';
                scope.activeTab = target.replace('#', '');
                if (scope.activeTab === 'records') {
                    scope.loadRecords();
                    $('#addRecordBtn').show();
                } else {
                    $('#addRecordBtn').hide();
                }
            });

            $('#searchInput').on('input', function () {
                const scope = _testDataGrid;
                var token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) {
                        scope.performSearch();
                    }
                });
            });

            $('#searchBtn').on('click', function () {
                scope.performSearch();
            });

            $('#filterModule, #filterEntityType, #filterPurpose').on('change', function () {
                scope.applyFilters();
            });

            $('#applyFiltersBtn').on('click', function () {
                scope.applyFilters();
            });

            $('#clearFiltersBtn').on('click', function () {
                scope.clearFilters();
            });

            $('#recordDataSetSelect').on('change', function () {
                scope.filterRecords();
            });

            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const scope = _testDataGrid;
                var page = parseInt($(this).data('page'), 10);
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    if (scope.activeTab === 'data-sets') {
                        scope.renderDataSets();
                    } else {
                        scope.renderRecords();
                    }
                }
            });

            $('#addDataSetBtn').on('click', function () {
                scope.showAddDataSetModal();
            });

            $('#addRecordBtn').on('click', function () {
                scope.showAddRecordModal();
            });

            $(document).on('click', '.edit-data-set-btn', function () {
                const scope = _testDataGrid;
                var setId = $(this).data('set-id');
                scope.editDataSet(setId);
            });

            $(document).on('click', '.view-records-btn', function () {
                const scope = _testDataGrid;
                var setId = $(this).data('set-id');
                scope.viewRecordsForSet(setId);
            });

            $(document).on('click', '.delete-data-set-btn', function () {
                const scope = _testDataGrid;
                var setId = $(this).data('set-id');
                scope.deleteDataSet(setId);
            });

            $(document).on('click', '.edit-record-btn', function () {
                const scope = _testDataGrid;
                var recordId = $(this).data('record-id');
                scope.editRecord(recordId);
            });

            $(document).on('click', '.delete-record-btn', function () {
                const scope = _testDataGrid;
                var recordId = $(this).data('record-id');
                scope.deleteRecord(recordId);
            });

            $('#saveDataSetBtn').on('click', function () {
                scope.saveDataSet();
            });

            $('#saveRecordBtn').on('click', function () {
                scope.saveRecord();
            });

            $('#dataSetModal').on('hidden.bs.modal', function () {
                scope.clearDataSetForm();
            });

            $('#recordModal').on('hidden.bs.modal', function () {
                scope.clearRecordForm();
            });
        },

        loadDataSets: async (forceRefresh) => {
            const scope = _testDataGrid;
            try {
                scope.showDataSetsLoading();
                var dataSets = await dataFunctions.getTestDataSets(null, forceRefresh || false);
                scope.dataSets = dataSets || [];
                scope.filteredDataSets = scope.dataSets;
                scope.currentPage = 1;
                scope.renderDataSets();
                scope.populateDataSetSelectors();
                scope.hideDataSetsLoading();
            } catch (error) {
                console.error('Error loading data sets:', error);
                scope.showError('Error loading data sets: ' + error.message);
                scope.hideDataSetsLoading();
            }
        },

        loadRecords: async (setId) => {
            const scope = _testDataGrid;
            if (!dataFunctions.canAccessTestManagement()) {
                scope.showAccessDenied();
                return;
            }
            try {
                scope.showRecordsLoading();
                if (setId) {
                    var records = await dataFunctions.getTestDataRecordsBySet(setId);
                    scope.records = records || [];
                } else {
                    var allRecords = await dataFunctions.searchTestDataRecords({});
                    scope.records = allRecords || [];
                }
                scope.filteredRecords = scope.records;
                scope.currentPage = 1;
                scope.renderRecords();
                scope.hideRecordsLoading();
            } catch (error) {
                console.error('Error loading records:', error);
                if (error.message && (error.message.indexOf('403') !== -1 || error.message.toLowerCase().indexOf('permission') !== -1 || error.message.toLowerCase().indexOf('forbidden') !== -1)) {
                    scope.showAccessDenied();
                } else {
                    scope.showError('Error loading records: ' + error.message);
                }
                scope.hideRecordsLoading();
            }
        },

        loadModulesForFilter: () => {
            const scope = _testDataGrid;
            var modules = [
                'authentication', 'crm', 'grower-intake', 'kernel-production',
                'oil-production', 'quality-assurance', 'stock-management',
                'sales-forecasting', 'financial-management', 'user-management',
                'dashboard', 'document-management', 'palladium-integration'
            ];
            var moduleSelects = ['filterModule', 'setModule'];
            moduleSelects.forEach(function (selectId) {
                var select = document.getElementById(selectId);
                if (select) {
                    var html = selectId === 'setModule' ? '' : '<option value="">All Modules</option>';
                    modules.forEach(function (mod) {
                        html += '<option value="' + mod + '">' + scope.escapeHtml(mod) + '</option>';
                    });
                    select.innerHTML = html;
                }
            });
        },

        populateDataSetSelectors: () => {
            const scope = _testDataGrid;
            var selects = ['recordDataSetId', 'recordDataSetSelect'];
            selects.forEach(function (selectId) {
                var select = document.getElementById(selectId);
                if (select) {
                    var html = selectId === 'recordDataSetSelect' ? '<option value="">All Data Sets</option>' : '<option value="">Select Data Set</option>';
                    scope.dataSets.forEach(function (set) {
                        html += '<option value="' + set.id + '">' + scope.escapeHtml(set.set_name || '') + ' (' + scope.escapeHtml(set.module || '') + ')</option>';
                    });
                    select.innerHTML = html;
                }
            });
        },

        performSearch: async () => {
            const scope = _testDataGrid;
            var searchTerm = $('#searchInput').val().trim();

            if (scope.activeTab === 'data-sets') {
                if (searchTerm) {
                    scope.currentFilters = { searchTerm: searchTerm };
                    var results = await dataFunctions.searchTestDataSets(scope.currentFilters);
                    scope.dataSets = results || [];
                } else {
                    scope.dataSets = await dataFunctions.getTestDataSets() || [];
                }
                scope.filteredDataSets = scope.dataSets;
                scope.currentPage = 1;
                scope.renderDataSets();
            } else {
                if (searchTerm) {
                    scope.currentFilters = { searchTerm: searchTerm };
                    var recordResults = await dataFunctions.searchTestDataRecords(scope.currentFilters);
                    scope.records = recordResults || [];
                } else {
                    scope.records = await dataFunctions.searchTestDataRecords({}) || [];
                }
                scope.filteredRecords = scope.records;
                scope.currentPage = 1;
                scope.renderRecords();
            }
        },

        applyFilters: () => {
            const scope = _testDataGrid;
            if (scope.activeTab === 'data-sets') {
                var moduleFilter = $('#filterModule').val();
                scope.currentFilters = {
                    module: moduleFilter || null,
                    searchTerm: $('#searchInput').val().trim() || null
                };
                scope.filterDataSets();
            } else {
                scope.currentFilters = {
                    entity_type: $('#filterEntityType').val() || null,
                    purpose: $('#filterPurpose').val() || null,
                    data_set_id: $('#recordDataSetSelect').val() || null,
                    searchTerm: $('#searchInput').val().trim() || null
                };
                scope.filterRecords();
            }
        },

        filterDataSets: () => {
            const scope = _testDataGrid;
            var moduleFilter = $('#filterModule').val();
            var searchTerm = $('#searchInput').val().toLowerCase();
            scope.filteredDataSets = scope.dataSets.filter(function (set) {
                var matchesSearch = !searchTerm ||
                    (set.set_name && set.set_name.toLowerCase().includes(searchTerm)) ||
                    (set.description && set.description.toLowerCase().includes(searchTerm)) ||
                    (set.module && set.module.toLowerCase().includes(searchTerm));
                var matchesModule = !moduleFilter || set.module === moduleFilter;
                return matchesSearch && matchesModule;
            });
            scope.currentPage = 1;
            scope.renderDataSets();
        },

        filterRecords: () => {
            const scope = _testDataGrid;
            var entityTypeFilter = $('#filterEntityType').val();
            var purposeFilter = $('#filterPurpose').val();
            var dataSetFilter = $('#recordDataSetSelect').val();
            var searchTerm = $('#searchInput').val().toLowerCase();
            scope.filteredRecords = scope.records.filter(function (record) {
                var matchesSearch = !searchTerm ||
                    (record.data_key && record.data_key.toLowerCase().includes(searchTerm)) ||
                    (record.entity_type && record.entity_type.toLowerCase().includes(searchTerm)) ||
                    (record.purpose && record.purpose.toLowerCase().includes(searchTerm)) ||
                    (record.set_name && record.set_name.toLowerCase().includes(searchTerm));
                var matchesEntityType = !entityTypeFilter || record.entity_type === entityTypeFilter;
                var matchesPurpose = !purposeFilter || (record.purpose && record.purpose.toLowerCase().includes(purposeFilter.toLowerCase()));
                var matchesDataSet = !dataSetFilter || record.data_set_id === dataSetFilter;
                return matchesSearch && matchesEntityType && matchesPurpose && matchesDataSet;
            });
            scope.currentPage = 1;
            scope.renderRecords();
        },

        clearFilters: () => {
            const scope = _testDataGrid;
            $('#filterModule').val('');
            $('#filterEntityType').val('');
            $('#filterPurpose').val('');
            $('#recordDataSetSelect').val('');
            $('#searchInput').val('');
            scope.currentFilters = {};
            if (scope.activeTab === 'data-sets') {
                scope.filteredDataSets = scope.dataSets;
                scope.renderDataSets();
            } else {
                scope.filteredRecords = scope.records;
                scope.renderRecords();
            }
        },

        renderDataSets: () => {
            const scope = _testDataGrid;
            var startIndex = (scope.currentPage - 1) * scope.itemsPerPage;
            var endIndex = startIndex + scope.itemsPerPage;
            var pageDataSets = scope.filteredDataSets.slice(startIndex, endIndex);

            if (scope.filteredDataSets.length === 0) {
                $('#dataSetsTableBody').empty();
                $('#dataSetsEmpty').show();
                $('#dataSetsTable').hide();
                scope.renderPagination();
                return;
            }
            $('#dataSetsEmpty').hide();
            $('#dataSetsTable').show();

            var html = '';
            pageDataSets.forEach(function (set) {
                var statusBadge = set.is_active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-danger">Inactive</span>';
                var scenarioCount = set.test_scenario_ids ? set.test_scenario_ids.length : 0;
                html +=
                    '<tr>' +
                    '<td><strong>' + scope.escapeHtml(set.set_name || 'N/A') + '</strong></td>' +
                    '<td>' + scope.escapeHtml(set.module || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(set.description || 'N/A') + '</td>' +
                    '<td><span class="badge bg-info">' + (set.record_count || 0) + '</span></td>' +
                    '<td><span class="badge bg-secondary">' + scenarioCount + '</span></td>' +
                    '<td>' + statusBadge + '</td>' +
                    '<td><div class="btn-group btn-group-sm" role="group">' +
                    '<button type="button" class="btn btn-outline-primary edit-data-set-btn" data-set-id="' + scope.escapeHtml(set.id) + '" title="Edit"><i class="fas fa-edit"></i></button>' +
                    '<button type="button" class="btn btn-outline-info view-records-btn" data-set-id="' + scope.escapeHtml(set.id) + '" title="View Records"><i class="fas fa-list"></i></button>' +
                    '<button type="button" class="btn btn-outline-danger delete-data-set-btn" data-set-id="' + scope.escapeHtml(set.id) + '" title="Delete"><i class="fas fa-trash"></i></button>' +
                    '</div></td></tr>';
            });
            $('#dataSetsTableBody').html(html);
            scope.renderPagination();
        },

        renderRecords: () => {
            const scope = _testDataGrid;
            var startIndex = (scope.currentPage - 1) * scope.itemsPerPage;
            var endIndex = startIndex + scope.itemsPerPage;
            var pageRecords = scope.filteredRecords.slice(startIndex, endIndex);

            if (scope.filteredRecords.length === 0) {
                $('#recordsTableBody').empty();
                $('#recordsEmpty').show();
                $('#recordsTable').hide();
                scope.renderPagination();
                return;
            }
            $('#recordsEmpty').hide();
            $('#recordsTable').show();

            var html = '';
            pageRecords.forEach(function (record) {
                var cleanupBadge = record.cleanup_required ? '<span class="badge bg-warning">Yes</span>' : '<span class="badge bg-success">No</span>';
                html +=
                    '<tr>' +
                    '<td><strong>' + scope.escapeHtml(record.data_key || 'N/A') + '</strong></td>' +
                    '<td>' + scope.escapeHtml(record.entity_type || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(record.set_name || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(record.purpose || 'N/A') + '</td>' +
                    '<td>' + cleanupBadge + '</td>' +
                    '<td><div class="btn-group btn-group-sm" role="group">' +
                    '<button type="button" class="btn btn-outline-primary edit-record-btn" data-record-id="' + scope.escapeHtml(record.id) + '" title="Edit"><i class="fas fa-edit"></i></button>' +
                    '<button type="button" class="btn btn-outline-info" onclick="testDataGrid.viewRecordDetails(\'' + scope.escapeHtml(record.id) + '\')" title="View Details"><i class="fas fa-eye"></i></button>' +
                    '<button type="button" class="btn btn-outline-danger delete-record-btn" data-record-id="' + scope.escapeHtml(record.id) + '" title="Delete"><i class="fas fa-trash"></i></button>' +
                    '</div></td></tr>';
            });
            $('#recordsTableBody').html(html);
            scope.renderPagination();
        },

        previewJson: (json) => {
            if (!json) return 'N/A';
            try {
                var obj = typeof json === 'string' ? JSON.parse(json) : json;
                var keys = Object.keys(obj);
                return keys.length > 0 ? keys.length + ' fields' : 'Empty';
            } catch (e) {
                return 'Invalid JSON';
            }
        },

        renderPagination: () => {
            const scope = _testDataGrid;
            var totalItems = scope.activeTab === 'data-sets' ? scope.filteredDataSets.length : scope.filteredRecords.length;
            var totalPages = Math.ceil(totalItems / scope.itemsPerPage);
            if (totalPages <= 1) {
                $('#pagination').empty();
                return;
            }
            var paginationHtml = '';
            if (scope.currentPage > 1) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage - 1) + '">Previous</a></li>';
            }
            for (var i = 1; i <= totalPages; i++) {
                if (i === scope.currentPage) {
                    paginationHtml += '<li class="page-item active"><span class="page-link">' + i + '</span></li>';
                } else {
                    paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
                }
            }
            if (scope.currentPage < totalPages) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage + 1) + '">Next</a></li>';
            }
            $('#pagination').html(paginationHtml);
        },

        showAddDataSetModal: () => {
            const scope = _testDataGrid;
            scope.editingDataSet = null;
            scope.clearDataSetForm();
            $('#dataSetModalLabel').text('Add New Data Set');
            $('#dataSetModal').modal('show');
        },

        editDataSet: async (setId) => {
            const scope = _testDataGrid;
            try {
                var dataSet = await dataFunctions.getTestDataSetById(setId);
                if (!dataSet || (Array.isArray(dataSet) && dataSet.length === 0)) {
                    scope.showError('Data set not found');
                    return;
                }
                var setData = Array.isArray(dataSet) ? dataSet[0] : dataSet;
                scope.editingDataSet = setData;
                scope.populateDataSetForm(setData);
                $('#dataSetModalLabel').text('Edit Data Set');
                $('#dataSetModal').modal('show');
            } catch (error) {
                console.error('Error editing data set:', error);
                scope.showError('Error loading data set details: ' + error.message);
            }
        },

        populateDataSetForm: (dataSet) => {
            $('#setName').val(dataSet.set_name || '');
            $('#setModule').val(dataSet.module || '');
            $('#setDescription').val(dataSet.description || '');
            $('#setScenarioIds').val(dataSet.test_scenario_ids ? JSON.stringify(dataSet.test_scenario_ids, null, 2) : '[]');
            $('#setIsActive').prop('checked', dataSet.is_active !== false);
        },

        clearDataSetForm: () => {
            const scope = _testDataGrid;
            $('#dataSetForm')[0].reset();
            $('#setScenarioIds').val('[]');
            $('#setIsActive').prop('checked', true);
            scope.editingDataSet = null;
        },

        saveDataSet: async () => {
            const scope = _testDataGrid;
            if (!dataFunctions.canAccessTestManagement()) {
                scope.showError('You do not have permission to modify test data sets.');
                return;
            }
            try {
                var scenarioIds = [];
                try {
                    if ($('#setScenarioIds').val().trim()) {
                        scenarioIds = JSON.parse($('#setScenarioIds').val());
                    }
                } catch (e) {
                    scope.showError('Invalid JSON in Scenario IDs field');
                    return;
                }
                var formData = {
                    set_name: $('#setName').val().trim(),
                    module: $('#setModule').val().trim(),
                    description: $('#setDescription').val().trim() || null,
                    test_scenario_ids: scenarioIds.length > 0 ? scenarioIds : null,
                    is_active: $('#setIsActive').is(':checked')
                };
                if (!formData.set_name) {
                    scope.showError('Set Name is required');
                    return;
                }
                if (!formData.module) {
                    scope.showError('Module is required');
                    return;
                }
                var result;
                if (scope.editingDataSet) {
                    result = await dataFunctions.updateTestDataSet(scope.editingDataSet.id, formData);
                } else {
                    result = await dataFunctions.createTestDataSet(formData);
                }
                if (result && result.success) {
                    scope.showSuccess(result.message || 'Data set saved successfully');
                    $('#dataSetModal').modal('hide');
                    scope.loadDataSets(true);
                } else {
                    scope.showError((result && result.message) || 'Error saving data set');
                }
            } catch (error) {
                console.error('Error saving data set:', error);
                if (error.message && (error.message.indexOf('403') !== -1 || error.message.toLowerCase().indexOf('permission') !== -1 || error.message.toLowerCase().indexOf('forbidden') !== -1)) {
                    scope.showError('You do not have permission to modify test data sets.');
                } else {
                    scope.showError('Error saving data set: ' + error.message);
                }
            }
        },

        deleteDataSet: (setId) => {
            const scope = _testDataGrid;
            if (!dataFunctions.canAccessTestManagement()) {
                scope.showError('You do not have permission to delete test data sets.');
                return;
            }
            var dataSet = scope.dataSets.find(function (s) { return s.id === setId; });
            if (!dataSet) return;
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete "' + (dataSet.set_name || '') + '"? This will also delete all records in this set. This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async function (result) {
                if (result.isConfirmed) {
                    const scope = _testDataGrid;
                    try {
                        var deleteResult = await dataFunctions.deleteTestDataSet(setId);
                        if (deleteResult && deleteResult.success) {
                            scope.showSuccess('Data set deleted successfully');
                            scope.loadDataSets(true);
                        } else {
                            scope.showError((deleteResult && deleteResult.message) || 'Error deleting data set');
                        }
                    } catch (error) {
                        console.error('Error deleting data set:', error);
                        if (error.message && (error.message.indexOf('403') !== -1 || error.message.toLowerCase().indexOf('permission') !== -1 || error.message.toLowerCase().indexOf('forbidden') !== -1)) {
                            scope.showError('You do not have permission to delete test data sets.');
                        } else {
                            scope.showError('Error deleting data set: ' + error.message);
                        }
                    }
                }
            });
        },

        viewRecordsForSet: (setId) => {
            const scope = _testDataGrid;
            $('#records-tab').tab('show');
            $('#recordDataSetSelect').val(setId);
            scope.loadRecords(setId);
        },

        showAddRecordModal: () => {
            const scope = _testDataGrid;
            scope.editingRecord = null;
            scope.clearRecordForm();
            scope.populateDataSetSelectors();
            $('#recordModalLabel').text('Add New Record');
            $('#recordModal').modal('show');
        },

        editRecord: async (recordId) => {
            const scope = _testDataGrid;
            if (!dataFunctions.canAccessTestManagement()) {
                scope.showError('You do not have permission to edit test data records.');
                return;
            }
            try {
                var record = await dataFunctions.getTestDataRecordById(recordId);
                if (!record || (Array.isArray(record) && record.length === 0)) {
                    scope.showError('Record not found');
                    return;
                }
                var recordData = Array.isArray(record) ? record[0] : record;
                scope.editingRecord = recordData;
                scope.populateDataSetSelectors();
                await delay(200);
                scope.populateRecordForm(recordData);
                $('#recordModalLabel').text('Edit Record');
                $('#recordModal').modal('show');
            } catch (error) {
                console.error('Error editing record:', error);
                scope.showError('Error loading record details: ' + error.message);
            }
        },

        populateRecordForm: (record) => {
            $('#recordDataSetId').val(record.data_set_id || '');
            $('#recordEntityType').val(record.entity_type || '');
            $('#recordDataKey').val(record.data_key || '');
            $('#recordEntityId').val(record.entity_id || '');
            $('#recordPurpose').val(record.purpose || '');
            $('#recordCleanupRequired').prop('checked', record.cleanup_required !== false);
            $('#recordDataValue').val(record.data_value ? JSON.stringify(record.data_value, null, 2) : '{}');
        },

        clearRecordForm: () => {
            const scope = _testDataGrid;
            $('#recordForm')[0].reset();
            $('#recordDataValue').val('{}');
            $('#recordCleanupRequired').prop('checked', true);
            scope.editingRecord = null;
        },

        saveRecord: async () => {
            const scope = _testDataGrid;
            if (!dataFunctions.canAccessTestManagement()) {
                scope.showError('You do not have permission to modify test data records.');
                return;
            }
            try {
                var dataValue = {};
                try {
                    if ($('#recordDataValue').val().trim()) {
                        dataValue = JSON.parse($('#recordDataValue').val());
                    }
                } catch (e) {
                    scope.showError('Invalid JSON in Data Value field');
                    return;
                }
                var formData = {
                    data_set_id: $('#recordDataSetId').val(),
                    entity_type: $('#recordEntityType').val(),
                    data_key: $('#recordDataKey').val().trim(),
                    entity_id: $('#recordEntityId').val().trim() || null,
                    data_value: dataValue,
                    purpose: $('#recordPurpose').val().trim() || null,
                    cleanup_required: $('#recordCleanupRequired').is(':checked')
                };
                if (!formData.data_set_id) {
                    scope.showError('Data Set is required');
                    return;
                }
                if (!formData.entity_type) {
                    scope.showError('Entity Type is required');
                    return;
                }
                if (!formData.data_key) {
                    scope.showError('Data Key is required');
                    return;
                }
                var result;
                if (scope.editingRecord) {
                    result = await dataFunctions.updateTestDataRecord(scope.editingRecord.id, formData);
                } else {
                    result = await dataFunctions.createTestDataRecord(formData);
                }
                if (result && result.success) {
                    scope.showSuccess(result.message || 'Record saved successfully');
                    $('#recordModal').modal('hide');
                    scope.loadRecords();
                } else {
                    scope.showError((result && result.message) || 'Error saving record');
                }
            } catch (error) {
                console.error('Error saving record:', error);
                if (error.message && (error.message.indexOf('403') !== -1 || error.message.toLowerCase().indexOf('permission') !== -1 || error.message.toLowerCase().indexOf('forbidden') !== -1)) {
                    scope.showError('You do not have permission to modify test data records.');
                } else {
                    scope.showError('Error saving record: ' + error.message);
                }
            }
        },

        deleteRecord: (recordId) => {
            const scope = _testDataGrid;
            if (!dataFunctions.canAccessTestManagement()) {
                scope.showError('You do not have permission to delete test data records.');
                return;
            }
            var record = scope.records.find(function (r) { return r.id === recordId; });
            if (!record) return;
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete record "' + (record.data_key || '') + '"? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async function (result) {
                if (result.isConfirmed) {
                    const scope = _testDataGrid;
                    try {
                        var deleteResult = await dataFunctions.deleteTestDataRecord(recordId);
                        if (deleteResult && deleteResult.success) {
                            scope.showSuccess('Record deleted successfully');
                            scope.loadRecords();
                        } else {
                            scope.showError((deleteResult && deleteResult.message) || 'Error deleting record');
                        }
                    } catch (error) {
                        console.error('Error deleting record:', error);
                        if (error.message && (error.message.indexOf('403') !== -1 || error.message.toLowerCase().indexOf('permission') !== -1 || error.message.toLowerCase().indexOf('forbidden') !== -1)) {
                            scope.showError('You do not have permission to delete test data records.');
                        } else {
                            scope.showError('Error deleting record: ' + error.message);
                        }
                    }
                }
            });
        },

        viewRecordDetails: async (recordId) => {
            const scope = _testDataGrid;
            try {
                var record = await dataFunctions.getTestDataRecordById(recordId);
                if (!record || (Array.isArray(record) && record.length === 0)) {
                    scope.showError('Record not found');
                    return;
                }
                var recordData = Array.isArray(record) ? record[0] : record;
                var dataValueJson = JSON.stringify(recordData.data_value, null, 2);
                Swal.fire({
                    title: 'Record: ' + scope.escapeHtml(recordData.data_key || ''),
                    html:
                        '<div class="text-start">' +
                        '<p><strong>Entity Type:</strong> ' + scope.escapeHtml(recordData.entity_type || '') + '</p>' +
                        '<p><strong>Data Set:</strong> ' + scope.escapeHtml(recordData.set_name || '') + '</p>' +
                        '<p><strong>Purpose:</strong> ' + scope.escapeHtml(recordData.purpose || 'N/A') + '</p>' +
                        '<p><strong>Cleanup Required:</strong> ' + (recordData.cleanup_required ? 'Yes' : 'No') + '</p>' +
                        '<hr><p><strong>Data Value:</strong></p>' +
                        '<pre class="bg-light p-3 text-start" style="max-height: 400px; overflow-y: auto;">' + scope.escapeHtml(dataValueJson) + '</pre></div>',
                    width: '800px',
                    showCloseButton: true,
                    showConfirmButton: false
                });
            } catch (error) {
                console.error('Error viewing record:', error);
                scope.showError('Error loading record details: ' + error.message);
            }
        },

        confirmDelete: () => {},

        refreshData: () => {
            const scope = _testDataGrid;
            if (scope.activeTab === 'data-sets') {
                scope.loadDataSets(true);
            } else {
                scope.loadRecords();
            }
        },

        exportData: () => {
            const scope = _testDataGrid;
            if (scope.activeTab === 'data-sets') {
                scope.exportDataSets();
            } else {
                scope.exportRecords();
            }
        },

        exportDataSets: () => {
            const scope = _testDataGrid;
            var headers = ['Set Name', 'Module', 'Description', 'Records', 'Scenarios', 'Status'];
            var rows = scope.filteredDataSets.map(function (s) {
                return [
                    s.set_name || '',
                    s.module || '',
                    s.description || '',
                    s.record_count || 0,
                    s.test_scenario_ids ? s.test_scenario_ids.length : 0,
                    s.is_active ? 'Active' : 'Inactive'
                ];
            });
            var csv = [headers].concat(rows).map(function (row) {
                return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
            }).join('\n');
            var blob = new Blob([csv], { type: 'text/csv' });
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'test_data_sets_' + new Date().toISOString().split('T')[0] + '.csv';
            a.click();
            window.URL.revokeObjectURL(url);
        },

        exportRecords: () => {
            const scope = _testDataGrid;
            var headers = ['Data Key', 'Entity Type', 'Data Set', 'Purpose', 'Cleanup Required'];
            var rows = scope.filteredRecords.map(function (r) {
                return [
                    r.data_key || '',
                    r.entity_type || '',
                    r.set_name || '',
                    r.purpose || '',
                    r.cleanup_required ? 'Yes' : 'No'
                ];
            });
            var csv = [headers].concat(rows).map(function (row) {
                return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(',');
            }).join('\n');
            var blob = new Blob([csv], { type: 'text/csv' });
            var url = window.URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'test_data_records_' + new Date().toISOString().split('T')[0] + '.csv';
            a.click();
            window.URL.revokeObjectURL(url);
        },

        showDataSetsLoading: () => {
            $('#dataSetsLoading').show();
            $('#dataSetsTable').hide();
            $('#dataSetsEmpty').hide();
        },

        hideDataSetsLoading: () => {
            $('#dataSetsLoading').hide();
        },

        showRecordsLoading: () => {
            $('#recordsLoading').show();
            $('#recordsTable').hide();
            $('#recordsEmpty').hide();
        },

        hideRecordsLoading: () => {
            $('#recordsLoading').hide();
        },

        showError: (message) => {
            Swal.fire({
                icon: 'error',
                title: 'Error',
                text: message
            });
        },

        showSuccess: (message) => {
            Swal.fire({
                icon: 'success',
                title: 'Success',
                text: message,
                timer: 2000,
                showConfirmButton: false
            });
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

window.testDataGrid = _testDataGrid;

$(document).ready(function () {
    if ($('#dataSetsTable').length) {
        _testDataGrid.init();
    }
});
