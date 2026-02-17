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
            var loadPromises = [];
            if (typeof document !== 'undefined' && document.querySelectorAll) {
                document.querySelectorAll('.modal[route-name]').forEach(function (el) {
                    var routeName = el.getAttribute('route-name');
                    var id = el.id;
                    if (routeName && id && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                        loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + id }));
                    }
                });
            }
            if (loadPromises.length > 0) {
                Promise.all(loadPromises).then(function () {
                    if (typeof _modal_test_data_set !== 'undefined' && _modal_test_data_set.init) _modal_test_data_set.init();
                    if (typeof _modal_test_data_record !== 'undefined' && _modal_test_data_record.init) _modal_test_data_record.init();
                    scope.setupEventListeners();
                    scope.loadDataSets();
                    scope.loadModulesForFilter();
                });
            } else {
                scope.setupEventListeners();
                await scope.loadDataSets();
                scope.loadModulesForFilter();
            }
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
                if (typeof _modal_test_data_set !== 'undefined' && _modal_test_data_set.show) _modal_test_data_set.show();
            });

            $('#addRecordBtn').on('click', function () {
                if (typeof _modal_test_data_record !== 'undefined' && _modal_test_data_record.show) _modal_test_data_record.show();
            });

            $(document).on('click', '.edit-data-set-btn', function () {
                const scope = _testDataGrid;
                var setId = $(this).data('set-id');
                dataFunctions.getTestDataSetById(setId).then(function (dataSet) {
                    if (!dataSet || (Array.isArray(dataSet) && dataSet.length === 0)) {
                        scope.showError('Data set not found');
                        return;
                    }
                    var setData = Array.isArray(dataSet) ? dataSet[0] : dataSet;
                    if (typeof _modal_test_data_set !== 'undefined' && _modal_test_data_set.show) _modal_test_data_set.show(setData);
                }).catch(function (error) {
                    console.error('Error editing data set:', error);
                    scope.showError('Error loading data set details: ' + error.message);
                });
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
                if (!dataFunctions.canAccessTestManagement()) {
                    scope.showError('You do not have permission to edit test data records.');
                    return;
                }
                dataFunctions.getTestDataRecordById(recordId).then(function (record) {
                    if (!record || (Array.isArray(record) && record.length === 0)) {
                        scope.showError('Record not found');
                        return;
                    }
                    var recordData = Array.isArray(record) ? record[0] : record;
                    if (typeof _modal_test_data_record !== 'undefined' && _modal_test_data_record.show) _modal_test_data_record.show(recordData);
                }).catch(function (error) {
                    console.error('Error editing record:', error);
                    scope.showError('Error loading record details: ' + error.message);
                });
            });

            $(document).on('click', '.delete-record-btn', function () {
                const scope = _testDataGrid;
                var recordId = $(this).data('record-id');
                scope.deleteRecord(recordId);
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
            var select = document.getElementById('filterModule');
            if (select) {
                var html = '<option value="">All Modules</option>';
                modules.forEach(function (mod) {
                    html += '<option value="' + mod + '">' + scope.escapeHtml(mod) + '</option>';
                });
                select.innerHTML = html;
            }
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
