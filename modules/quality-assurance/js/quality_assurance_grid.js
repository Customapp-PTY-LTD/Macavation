/**
 * Quality Assurance Grid Module
 */
var _qualityAssuranceGrid = function () {
    return {
        tests: [],
        filteredTests: [],
        searchTimeout: null,
        init: function () {
            this.setupEventListeners();
            this.loadTests();
            this.loadUsers();
        },
        setupEventListeners: function () {
            const scope = this;
            $('#addTestBtn').on('click', function () {
                scope.showAddTestModal();
            });
            
            // Save test button
            $('#saveTestBtn').on('click', function () {
                scope.saveTest();
            });
            
            // Modal events
            $('#qualityTestModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });
            
            // Search with debouncing
            $('#searchTestsInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterTests();
                }, 300);
            });
            
            // Filters
            $('#filterTestType, #filterTestResult').on('change', function () {
                scope.filterTests();
            });
            
            // Clear filters
            $('#clearTestFiltersBtn').on('click', function () {
                $('#searchTestsInput').val('');
                $('#filterTestType').val('');
                $('#filterTestResult').val('');
                scope.filterTests();
            });
        },
        filterTests: function () {
            const searchTerm = $('#searchTestsInput').val().toLowerCase();
            const typeFilter = $('#filterTestType').val();
            const resultFilter = $('#filterTestResult').val();
            
            this.filteredTests = this.tests.filter(test => {
                // Search filter
                const matchesSearch = !searchTerm || 
                    (test.test_number && test.test_number.toLowerCase().includes(searchTerm)) ||
                    (test.batch_number && test.batch_number.toLowerCase().includes(searchTerm)) ||
                    (test.overall_result && test.overall_result.toLowerCase().includes(searchTerm));
                
                // Type filter
                const matchesType = !typeFilter || test.test_type === typeFilter;
                
                // Result filter
                const matchesResult = !resultFilter || test.overall_result === resultFilter;
                
                return matchesSearch && matchesType && matchesResult;
            });
            
            this.renderTests();
        },
        loadTests: async function (forceRefresh = false) {
            try {
                const startTime = performance.now();
                const tests = await dataFunctions.getQualityTests(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Quality tests loaded in ${loadTime.toFixed(2)}ms`);
                
                this.tests = tests || [];
                this.filteredTests = this.tests;
                this.renderTests();
            } catch (error) {
                console.error('Error loading tests:', error);
            }
        },
        renderTests: function () {
            const tbody = $('#testsTableBody');
            tbody.empty();
            if (this.filteredTests.length === 0) {
                if (this.tests.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No quality tests found. Click "New Quality Test" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No tests match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            this.filteredTests.forEach(test => {
                const badgeClass = test.overall_result === 'pass' ? 'bg-success' : 
                                 test.overall_result === 'fail' ? 'bg-danger' : 'bg-warning';
                const row = `<tr>
                    <td>${test.test_number || 'N/A'}</td>
                    <td>${test.test_type || 'N/A'}</td>
                    <td>${test.product_type || 'N/A'}</td>
                    <td>${test.batch_number || 'N/A'}</td>
                    <td>${test.test_date || 'N/A'}</td>
                    <td><span class="badge ${badgeClass}">${test.overall_result || 'pending'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="qualityAssuranceGrid.viewTest('${test.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        loadUsers: async function () {
            try {
                const users = await dataFunctions.getUsers();
                const select = $('#testedBy');
                let html = '<option value="">Select Tester</option>';
                
                if (users && Array.isArray(users)) {
                    users.forEach(user => {
                        const name = user.email || user.username || 'Unknown';
                        html += `<option value="${user.id}">${name}</option>`;
                    });
                }
                
                select.html(html);
            } catch (error) {
                console.error('Error loading users:', error);
            }
        },
        
        showAddTestModal: function () {
            $('#qualityTestModalLabel').text('New Quality Test');
            $('#testId').val('');
            this.clearForm();
            // Set default test date to today (after clearing form)
            const today = new Date().toISOString().split('T')[0];
            $('#testDate').val(today);
            // Reset tabs to first tab
            $('#basic-info-tab').tab('show');
            // Use Bootstrap 5 modal API
            const qualityModal = document.getElementById('qualityTestModal');
            if (qualityModal) {
                const modal = new bootstrap.Modal(qualityModal);
                modal.show();
            } else {
                console.error('Quality test modal element not found!');
            }
        },
        
        clearForm: function () {
            $('#qualityTestForm')[0].reset();
            $('#testId').val('');
            // Reset all checkboxes explicitly
            $('#moisturePass, #ffaPass, #peroxidePass, #tasteTestPass, #smellTestPass, #appearanceTestPass').prop('checked', false);
        },
        
        saveTest: async function () {
            try {
                const form = $('#qualityTestForm')[0];
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                
                // Get current user ID if available
                const userInfo = localStorage.getItem('user_info');
                let testedBy = null;
                if (userInfo) {
                    const user = JSON.parse(userInfo);
                    testedBy = user.id || $('#testedBy').val() || null;
                } else {
                    testedBy = $('#testedBy').val() || null;
                }
                
                const testData = {
                    p_test_number: $('#testNumber').val(),
                    p_test_type: $('#testType').val(),
                    p_product_type: $('#productType').val() || null,
                    p_test_date: $('#testDate').val(),
                    p_batch_number: $('#batchNumber').val() || null,
                    p_sample_reference: $('#sampleReference').val() || null,
                    p_style: $('#style').val() || null,
                    p_moisture_percentage: $('#moisturePercentage').val() ? parseFloat($('#moisturePercentage').val()) : null,
                    p_moisture_method: $('#moistureMethod').val() || null,
                    p_moisture_pass: $('#moisturePass').is(':checked') || null,
                    p_ffa_percentage: $('#ffaPercentage').val() ? parseFloat($('#ffaPercentage').val()) : null,
                    p_ffa_method: $('#ffaMethod').val() || null,
                    p_ffa_pass: $('#ffaPass').is(':checked') || null,
                    p_peroxide_value: $('#peroxideValue').val() ? parseFloat($('#peroxideValue').val()) : null,
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
                
                const testId = $('#testId').val();
                let result;
                
                if (testId) {
                    // Update existing test
                    result = await dataFunctions.callFunction('update_quality_test_simple', {
                        p_test_id: testId,
                        ...testData
                    });
                } else {
                    // Create new test
                    result = await dataFunctions.callFunction('create_quality_test_simple', testData);
                }
                
                if (result && result.success !== false) {
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: testId ? 'Quality test updated successfully' : 'Quality test created successfully',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    const qualityModal = document.getElementById('qualityTestModal');
                    if (qualityModal) {
                        const modal = bootstrap.Modal.getInstance(qualityModal);
                        if (modal) modal.hide();
                    }
                    this.loadTests(true); // Force refresh
                } else {
                    throw new Error(result?.error || result?.message || 'Failed to save quality test');
                }
            } catch (error) {
                console.error('Error saving quality test:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to save quality test: ' + error.message
                });
            }
        },
        
        viewTest: function (testId) {
            Swal.fire('Info', 'Test details view coming soon', 'info');
        },
        
        exportTests: function () {
            if (!this.tests || this.tests.length === 0) {
                Swal.fire('Info', 'No tests to export', 'info');
                return;
            }
            
            const columns = [
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
                exportUtils.exportToCSV(this.tests, 'quality_tests', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();
const qualityAssuranceGrid = _qualityAssuranceGrid;
function initializeQualityAssuranceGrid() {
    if (typeof qualityAssuranceGrid !== 'undefined') {
        qualityAssuranceGrid.init();
    }
}

