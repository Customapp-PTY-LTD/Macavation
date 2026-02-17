/**
 * Quality Assurance Grid Module
 * Follows company module pattern: IIFE, arrow methods, scope = _qualityAssuranceGrid for same-module calls.
 */
var _qualityAssuranceGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        tests: [],
        filteredTests: [],
        searchDebounceToken: 0,

        init: async () => {
            const scope = _qualityAssuranceGrid;
            await scope.waitForReady();
            scope.setupEventListeners();
            await scope.loadTests();
            await scope.loadUsers();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _qualityAssuranceGrid;

            $('#addTestBtn').on('click', function () {
                scope.showAddTestModal();
            });

            $('#saveTestBtn').on('click', function () {
                scope.saveTest();
            });

            $('#qualityTestModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });

            $('#searchTestsInput').on('input', function () {
                var token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) scope.filterTests();
                });
            });

            $('#filterTestType, #filterTestResult').on('change', function () {
                scope.filterTests();
            });

            $('#clearTestFiltersBtn').on('click', function () {
                const scope = _qualityAssuranceGrid;
                $('#searchTestsInput').val('');
                $('#filterTestType').val('');
                $('#filterTestResult').val('');
                scope.filterTests();
            });
        },

        filterTests: () => {
            const scope = _qualityAssuranceGrid;
            var searchTerm = $('#searchTestsInput').val().toLowerCase();
            var typeFilter = $('#filterTestType').val();
            var resultFilter = $('#filterTestResult').val();
            scope.filteredTests = scope.tests.filter(function (test) {
                var matchesSearch = !searchTerm ||
                    (test.test_number && test.test_number.toLowerCase().includes(searchTerm)) ||
                    (test.batch_number && test.batch_number.toLowerCase().includes(searchTerm)) ||
                    (test.overall_result && test.overall_result.toLowerCase().includes(searchTerm));
                var matchesType = !typeFilter || test.test_type === typeFilter;
                var matchesResult = !resultFilter || test.overall_result === resultFilter;
                return matchesSearch && matchesType && matchesResult;
            });
            scope.renderTests();
        },

        loadTests: async (forceRefresh) => {
            const scope = _qualityAssuranceGrid;
            try {
                var startTime = performance.now();
                var tests = await dataFunctions.getQualityTests(null, forceRefresh || false);
                var loadTime = performance.now() - startTime;
                console.log('[Performance] Quality tests loaded in ' + loadTime.toFixed(2) + 'ms');
                scope.tests = tests || [];
                scope.filteredTests = scope.tests;
                scope.renderTests();
            } catch (error) {
                console.error('Error loading tests:', error);
            }
        },

        renderTests: () => {
            const scope = _qualityAssuranceGrid;
            if (typeof $ === 'undefined') return;
            var tbody = $('#testsTableBody');
            tbody.empty();
            if (scope.filteredTests.length === 0) {
                if (scope.tests.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No quality tests found. Click "New Quality Test" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No tests match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            scope.filteredTests.forEach(function (test) {
                var badgeClass = test.overall_result === 'pass' ? 'bg-success' : (test.overall_result === 'fail' ? 'bg-danger' : 'bg-warning');
                var row = '<tr><td>' + scope.escapeHtml(test.test_number || 'N/A') + '</td><td>' + scope.escapeHtml(test.test_type || 'N/A') + '</td><td>' + scope.escapeHtml(test.product_type || 'N/A') + '</td><td>' + scope.escapeHtml(test.batch_number || 'N/A') + '</td><td>' + scope.escapeHtml(test.test_date || 'N/A') + '</td><td><span class="badge ' + badgeClass + '">' + scope.escapeHtml(test.overall_result || 'pending') + '</span></td><td><button class="btn btn-sm btn-outline-primary" onclick="qualityAssuranceGrid.viewTest(\'' + scope.escapeHtml(test.id || '') + '\')"><i class="fas fa-eye"></i></button></td></tr>';
                tbody.append(row);
            });
        },

        loadUsers: async () => {
            const scope = _qualityAssuranceGrid;
            try {
                var users = await dataFunctions.getUsers();
                var select = $('#testedBy');
                var html = '<option value="">Select Tester</option>';
                if (users && Array.isArray(users)) {
                    users.forEach(function (user) {
                        var name = user.email || user.username || 'Unknown';
                        html += '<option value="' + (user.id || '') + '">' + scope.escapeHtml(name) + '</option>';
                    });
                }
                select.html(html);
            } catch (error) {
                console.error('Error loading users:', error);
            }
        },

        showAddTestModal: () => {
            const scope = _qualityAssuranceGrid;
            $('#qualityTestModalLabel').text('New Quality Test');
            $('#testId').val('');
            scope.clearForm();
            var today = new Date().toISOString().split('T')[0];
            $('#testDate').val(today);
            $('#basic-info-tab').tab('show');
            var qualityModal = document.getElementById('qualityTestModal');
            if (qualityModal && typeof bootstrap !== 'undefined') {
                var modal = new bootstrap.Modal(qualityModal);
                modal.show();
            } else if (!qualityModal) {
                console.error('Quality test modal element not found!');
            }
        },

        clearForm: () => {
            $('#qualityTestForm')[0].reset();
            $('#testId').val('');
            $('#moisturePass, #ffaPass, #peroxidePass, #tasteTestPass, #smellTestPass, #appearanceTestPass').prop('checked', false);
        },

        saveTest: async () => {
            const scope = _qualityAssuranceGrid;
            try {
                var form = $('#qualityTestForm')[0];
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                var userInfo = localStorage.getItem('user_info');
                var testedBy = null;
                if (userInfo) {
                    try {
                        var user = JSON.parse(userInfo);
                        testedBy = user.id || $('#testedBy').val() || null;
                    } catch (e) {
                        testedBy = $('#testedBy').val() || null;
                    }
                } else {
                    testedBy = $('#testedBy').val() || null;
                }
                var testData = {
                    p_test_number: $('#testNumber').val(),
                    p_test_type: $('#testType').val(),
                    p_product_type: $('#productType').val() || null,
                    p_test_date: $('#testDate').val(),
                    p_batch_number: $('#batchNumber').val() || null,
                    p_sample_reference: $('#sampleReference').val() || null,
                    p_style: $('#style').val() || null,
                    p_moisture_percentage: $('#moisturePercentage').val() ? parseFloat($('#moisturePercentage').val(), 10) : null,
                    p_moisture_method: $('#moistureMethod').val() || null,
                    p_moisture_pass: $('#moisturePass').is(':checked') || null,
                    p_ffa_percentage: $('#ffaPercentage').val() ? parseFloat($('#ffaPercentage').val(), 10) : null,
                    p_ffa_method: $('#ffaMethod').val() || null,
                    p_ffa_pass: $('#ffaPass').is(':checked') || null,
                    p_peroxide_value: $('#peroxideValue').val() ? parseFloat($('#peroxideValue').val(), 10) : null,
                    p_peroxide_method: $('#peroxideMethod').val() || null,
                    p_peroxide_pass: $('#peroxidePass').is(':checked') || null,
                    p_taste_test_result: $('#tasteTestResult').val() || null,
                    p_taste_test_notes: $('#tasteTestNotes').val() || null,
                    p_taste_test_pass: $('#tasteTestPass').is(':checked') || null,
                    p_smell_test_result: $('#smellTestResult').val() || null,
                    p_smell_test_notes: $('#smellTestNotes').val() || null,
                    p_smell_test_pass: $('#smellTestPass').is(':checked') || null,
                    p_appearance_test_result: $('#appearanceTestResult').val() || null,
                    p_appearance_test_notes: $('#appearanceTestNotes').val() || null,
                    p_appearance_test_pass: $('#appearanceTestPass').is(':checked') || null,
                    p_overall_result: $('#overallResult').val() || 'pending',
                    p_overall_notes: $('#overallNotes').val() || null,
                    p_tested_by: testedBy,
                    p_status: $('#testStatus').val() || 'pending'
                };
                var testId = $('#testId').val();
                var result;
                if (testId) {
                    var updatePayload = { p_test_id: testId };
                    for (var key in testData) { if (testData.hasOwnProperty(key)) updatePayload[key] = testData[key]; }
                    result = await dataFunctions.callFunction('update_quality_test_simple', updatePayload);
                } else {
                    result = await dataFunctions.callFunction('create_quality_test_simple', testData);
                }
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({
                            icon: 'success',
                            title: 'Success',
                            text: testId ? 'Quality test updated successfully' : 'Quality test created successfully',
                            timer: 2000,
                            showConfirmButton: false
                        });
                    }
                    var qualityModal = document.getElementById('qualityTestModal');
                    if (qualityModal && typeof bootstrap !== 'undefined') {
                        var modal = bootstrap.Modal.getInstance(qualityModal);
                        if (modal) modal.hide();
                    }
                    scope.loadTests(true);
                } else {
                    throw new Error((result && result.error) || (result && result.message) || 'Failed to save quality test');
                }
            } catch (error) {
                console.error('Error saving quality test:', error);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to save quality test: ' + error.message
                    });
                }
            }
        },

        viewTest: (testId) => {
            if (typeof Swal !== 'undefined') Swal.fire('Info', 'Test details view coming soon', 'info');
        },

        exportTests: () => {
            const scope = _qualityAssuranceGrid;
            if (!scope.tests || scope.tests.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No tests to export', 'info');
                return;
            }
            var columns = [
                { key: 'test_number', label: 'Test Number' },
                { key: 'test_type', label: 'Test Type' },
                { key: 'product_type', label: 'Product Type' },
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'test_date', label: 'Test Date' },
                { key: 'overall_result', label: 'Result' },
                { key: 'moisture_percentage', label: 'Moisture %' },
                { key: 'ffa_percentage', label: 'FFA %' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.tests, 'quality_tests', columns);
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Export utility not available', 'error');
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

window.qualityAssuranceGrid = _qualityAssuranceGrid;

function initializeQualityAssuranceGrid() {
    if (typeof _qualityAssuranceGrid !== 'undefined') {
        if (typeof $ !== 'undefined') {
            $(document).ready(function () { _qualityAssuranceGrid.init(); });
        } else if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { _qualityAssuranceGrid.init(); });
        } else {
            _qualityAssuranceGrid.init();
        }
    }
}
