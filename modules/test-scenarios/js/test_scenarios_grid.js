/**
 * Test Scenarios Grid Module
 * Handles test scenario management functionality with Supabase integration
 */

var _testScenariosGrid = function () {
    return {
        scenarios: [],
        filteredScenarios: [],
        currentPage: 1,
        itemsPerPage: 20,
        editingScenario: null,
        searchTimeout: null,
        currentFilters: {},

        init: function () {
            this.setupEventListeners();
            this.loadScenarios();
            this.loadRolesForDropdown();
            this.loadModulesForFilter();
        },

        setupEventListeners: function () {
            const scope = this;

            // Search functionality
            $('#searchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterScenarios();
                }, 300);
            });

            $('#searchBtn').on('click', function () {
                scope.filterScenarios();
            });

            // Filter functionality
            $('#filterModule, #filterTestType, #filterSeverity, #filterRole, #filterAutomated').on('change', function () {
                scope.filterScenarios();
            });

            $('#applyFiltersBtn').on('click', function () {
                scope.applyFilters();
            });

            $('#clearFiltersBtn').on('click', function () {
                scope.clearFilters();
            });

            // Pagination
            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const page = parseInt($(this).data('page'));
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderScenarios();
                }
            });

            // Add scenario button
            $('#addScenarioBtn').on('click', function () {
                scope.showAddScenarioModal();
            });

            // Edit scenario (click on scenario code/name)
            $(document).on('click', '.scenario-code-link, .scenario-name-link', function (e) {
                e.preventDefault();
                const scenarioId = $(this).data('scenario-id');
                if (scenarioId) {
                    scope.editScenario(scenarioId);
                }
            });

            // Delete scenario
            $(document).on('click', '.delete-scenario-btn', function () {
                const scenarioId = $(this).data('scenario-id');
                scope.deleteScenario(scenarioId);
            });

            // Save scenario form
            $('#saveScenarioBtn').on('click', function () {
                scope.saveScenario();
            });

            // Modal events
            $('#scenarioModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });
        },

        loadScenarios: async function (forceRefresh = false) {
            try {
                this.showLoading();
                const startTime = performance.now();
                const scenarios = await dataFunctions.getTestScenarios(null, forceRefresh);
                const loadTime = performance.now() - startTime;
                console.log(`[Performance] Test scenarios loaded in ${loadTime.toFixed(2)}ms`);
                
                this.scenarios = scenarios || [];
                this.filteredScenarios = this.scenarios;
                this.currentPage = 1;
                this.renderScenarios();
                this.hideLoading();
            } catch (error) {
                console.error('Error loading test scenarios:', error);
                this.showError('Error loading test scenarios: ' + error.message);
                this.hideLoading();
            }
        },

        loadRolesForDropdown: async function () {
            try {
                const roles = await dataFunctions.getRoles();
                if (!roles || !Array.isArray(roles) || roles.length === 0) {
                    console.warn('No roles found');
                    return;
                }

                // Populate role dropdowns
                const roleSelects = ['cboRole', 'filterRole'];
                roleSelects.forEach(selectId => {
                    const select = document.getElementById(selectId);
                    if (select) {
                        let html = '<option value="">Select Role</option>';
                        if (selectId === 'filterRole') {
                            html = '<option value="">All Roles</option>';
                        }
                        roles.forEach(role => {
                            html += `<option value="${role.id}">${role.role_name}</option>`;
                        });
                        select.innerHTML = html;
                    }
                });
            } catch (error) {
                console.error('Error loading roles:', error);
            }
        },

        loadModulesForFilter: function () {
            const modules = [
                'authentication', 'crm', 'grower-intake', 'kernel-production',
                'oil-production', 'quality-assurance', 'stock-management',
                'sales-forecasting', 'financial-management', 'user-management',
                'dashboard', 'document-management', 'palladium-integration'
            ];

            const moduleSelect = document.getElementById('filterModule');
            if (moduleSelect) {
                let html = '<option value="">All Modules</option>';
                modules.forEach(module => {
                    html += `<option value="${module}">${module}</option>`;
                });
                moduleSelect.innerHTML = html;
            }
        },

        filterScenarios: function () {
            const searchTerm = $('#searchInput').val().toLowerCase();
            const moduleFilter = $('#filterModule').val();
            const testTypeFilter = $('#filterTestType').val();
            const severityFilter = $('#filterSeverity').val();
            const roleFilter = $('#filterRole').val();
            const automatedFilter = $('#filterAutomated').is(':checked');

            this.filteredScenarios = this.scenarios.filter(scenario => {
                const matchesSearch = !searchTerm ||
                    (scenario.scenario_code && scenario.scenario_code.toLowerCase().includes(searchTerm)) ||
                    (scenario.scenario_name && scenario.scenario_name.toLowerCase().includes(searchTerm)) ||
                    (scenario.description && scenario.description.toLowerCase().includes(searchTerm)) ||
                    (scenario.module_name && scenario.module_name.toLowerCase().includes(searchTerm)) ||
                    (scenario.feature_name && scenario.feature_name.toLowerCase().includes(searchTerm));

                const matchesModule = !moduleFilter || scenario.module_name === moduleFilter;
                const matchesTestType = !testTypeFilter || scenario.test_type === testTypeFilter;
                const matchesSeverity = !severityFilter || scenario.severity_level === severityFilter;
                const matchesRole = !roleFilter || scenario.role_id === roleFilter;
                const matchesAutomated = !automatedFilter || scenario.is_automated === true;

                return matchesSearch && matchesModule && matchesTestType && matchesSeverity && matchesRole && matchesAutomated;
            });

            this.currentPage = 1;
            this.renderScenarios();
        },

        applyFilters: function () {
            this.currentFilters = {
                module_name: $('#filterModule').val() || null,
                test_type: $('#filterTestType').val() || null,
                severity_level: $('#filterSeverity').val() || null,
                role_id: $('#filterRole').val() || null,
                is_automated: $('#filterAutomated').is(':checked') || null,
                searchTerm: $('#searchInput').val() || null
            };

            this.performSearch();
        },

        performSearch: async function () {
            try {
                this.showLoading();
                const scenarios = await dataFunctions.searchTestScenarios(this.currentFilters);
                this.scenarios = scenarios || [];
                this.filteredScenarios = this.scenarios;
                this.currentPage = 1;
                this.renderScenarios();
                this.hideLoading();
            } catch (error) {
                console.error('Error searching scenarios:', error);
                this.showError('Error searching scenarios: ' + error.message);
                this.hideLoading();
            }
        },

        clearFilters: function () {
            $('#filterModule').val('');
            $('#filterTestType').val('');
            $('#filterSeverity').val('');
            $('#filterRole').val('');
            $('#filterAutomated').prop('checked', false);
            $('#searchInput').val('');
            this.currentFilters = {};
            this.filterScenarios();
        },

        renderScenarios: function () {
            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const pageScenarios = this.filteredScenarios.slice(startIndex, endIndex);

            if (this.filteredScenarios.length === 0) {
                $('#scenariosTableBody').empty();
                $('#scenariosEmpty').show();
                $('#scenariosTable').hide();
                this.renderPagination();
                return;
            }

            $('#scenariosEmpty').hide();
            $('#scenariosTable').show();

            let html = '';
            pageScenarios.forEach(scenario => {
                const severityBadge = this.getSeverityBadge(scenario.severity_level);
                const automatedBadge = scenario.is_automated 
                    ? '<span class="badge bg-success">Yes</span>' 
                    : '<span class="badge bg-secondary">No</span>';
                const statusBadge = scenario.is_active 
                    ? '<span class="badge bg-success">Active</span>' 
                    : '<span class="badge bg-danger">Inactive</span>';

                html += `
                    <tr>
                        <td>
                            <a href="#" class="scenario-code-link text-primary" data-scenario-id="${scenario.id}">
                                ${this.escapeHtml(scenario.scenario_code || 'N/A')}
                            </a>
                        </td>
                        <td>
                            <a href="#" class="scenario-name-link" data-scenario-id="${scenario.id}">
                                ${this.escapeHtml(scenario.scenario_name || 'N/A')}
                            </a>
                        </td>
                        <td>${this.escapeHtml(scenario.module_name || 'N/A')}</td>
                        <td>${this.escapeHtml(scenario.feature_name || 'N/A')}</td>
                        <td>${this.escapeHtml(scenario.test_type || 'N/A')}</td>
                        <td>${severityBadge}</td>
                        <td>${this.escapeHtml(scenario.role_name || 'N/A')}</td>
                        <td>${automatedBadge}</td>
                        <td>${statusBadge}</td>
                        <td>
                            <div class="btn-group btn-group-sm" role="group">
                                <button type="button" class="btn btn-outline-primary" onclick="testScenariosGrid.editScenario('${scenario.id}')" title="Edit">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button type="button" class="btn btn-outline-danger delete-scenario-btn" data-scenario-id="${scenario.id}" title="Delete">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            });

            $('#scenariosTableBody').html(html);
            this.renderPagination();
        },

        getSeverityBadge: function (severity) {
            const badges = {
                'critical': '<span class="badge bg-danger">Critical</span>',
                'high': '<span class="badge bg-warning">High</span>',
                'medium': '<span class="badge bg-info">Medium</span>',
                'low': '<span class="badge bg-secondary">Low</span>',
                'info': '<span class="badge bg-light text-dark">Info</span>'
            };
            return badges[severity] || '<span class="badge bg-secondary">' + (severity || 'N/A') + '</span>';
        },

        renderPagination: function () {
            const totalPages = Math.ceil(this.filteredScenarios.length / this.itemsPerPage);

            if (totalPages <= 1) {
                $('#pagination').empty();
                return;
            }

            let paginationHtml = '';

            // Previous button
            if (this.currentPage > 1) {
                paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage - 1}">Previous</a></li>`;
            }

            // Page numbers
            for (let i = 1; i <= totalPages; i++) {
                if (i === this.currentPage) {
                    paginationHtml += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
                } else {
                    paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
                }
            }

            // Next button
            if (this.currentPage < totalPages) {
                paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage + 1}">Next</a></li>`;
            }

            $('#pagination').html(paginationHtml);
        },

        showAddScenarioModal: async function () {
            this.editingScenario = null;
            this.clearForm();
            await this.loadRolesForDropdown();
            $('#scenarioModalLabel').text('Add New Test Scenario');
            $('#scenarioModal').modal('show');
        },

        editScenario: async function (scenarioId) {
            try {
                const scenario = await dataFunctions.getTestScenarioById(scenarioId);
                if (!scenario || (Array.isArray(scenario) && scenario.length === 0)) {
                    this.showError('Test scenario not found');
                    return;
                }

                const scenarioData = Array.isArray(scenario) ? scenario[0] : scenario;
                this.editingScenario = scenarioData;
                await this.loadRolesForDropdown();

                setTimeout(() => {
                    this.populateForm(scenarioData);
                }, 200);

                $('#scenarioModalLabel').text('Edit Test Scenario');
                $('#scenarioModal').modal('show');
            } catch (error) {
                console.error('Error editing scenario:', error);
                this.showError('Error loading scenario details: ' + error.message);
            }
        },

        populateForm: function (scenario) {
            $('#scenarioCode').val(scenario.scenario_code || '');
            $('#scenarioName').val(scenario.scenario_name || '');
            $('#moduleName').val(scenario.module_name || '');
            $('#featureName').val(scenario.feature_name || '');
            $('#testType').val(scenario.test_type || 'functional');
            $('#severityLevel').val(scenario.severity_level || 'medium');
            $('#severityDescription').val(scenario.severity_description || '');
            $('#cboRole').val(scenario.role_id || '');
            $('#preconditions').val(scenario.preconditions || '');
            $('#expectedResult').val(scenario.expected_result || '');
            $('#description').val(scenario.description || '');
            $('#testSteps').val(scenario.test_steps ? JSON.stringify(scenario.test_steps, null, 2) : '[]');
            $('#testData').val(scenario.test_data ? JSON.stringify(scenario.test_data, null, 2) : '{}');
            $('#testDataDescription').val(scenario.test_data_description || '');
            $('#tags').val(scenario.tags ? JSON.stringify(scenario.tags, null, 2) : '[]');
            $('#isAutomated').prop('checked', scenario.is_automated || false);
            $('#automationScriptPath').val(scenario.automation_script_path || '');
            $('#isActive').prop('checked', scenario.is_active !== false);
            $('#isDeprecated').prop('checked', scenario.is_deprecated || false);
            $('#deprecatedReason').val(scenario.deprecated_reason || '');
        },

        clearForm: function () {
            $('#scenarioForm')[0].reset();
            $('#testSteps').val('[]');
            $('#testData').val('{}');
            $('#tags').val('[]');
            $('#isActive').prop('checked', true);
            $('#isDeprecated').prop('checked', false);
            this.editingScenario = null;
        },

        saveScenario: async function () {
            try {
                // Parse JSON fields
                let testSteps = [];
                let testData = {};
                let tags = [];

                try {
                    if ($('#testSteps').val().trim()) {
                        testSteps = JSON.parse($('#testSteps').val());
                    }
                } catch (e) {
                    this.showError('Invalid JSON in Test Steps field');
                    return;
                }

                try {
                    if ($('#testData').val().trim()) {
                        testData = JSON.parse($('#testData').val());
                    }
                } catch (e) {
                    this.showError('Invalid JSON in Test Data field');
                    return;
                }

                try {
                    if ($('#tags').val().trim()) {
                        tags = JSON.parse($('#tags').val());
                    }
                } catch (e) {
                    this.showError('Invalid JSON in Tags field');
                    return;
                }

                const formData = {
                    scenario_code: $('#scenarioCode').val().trim(),
                    scenario_name: $('#scenarioName').val().trim(),
                    module_name: $('#moduleName').val().trim(),
                    feature_name: $('#featureName').val().trim() || null,
                    test_type: $('#testType').val(),
                    severity_level: $('#severityLevel').val(),
                    severity_description: $('#severityDescription').val().trim() || null,
                    role_id: $('#cboRole').val() || null,
                    preconditions: $('#preconditions').val().trim() || null,
                    expected_result: $('#expectedResult').val().trim(),
                    description: $('#description').val().trim() || null,
                    test_steps: testSteps,
                    test_data: testData,
                    test_data_description: $('#testDataDescription').val().trim() || null,
                    tags: tags,
                    is_automated: $('#isAutomated').is(':checked'),
                    automation_script_path: $('#automationScriptPath').val().trim() || null,
                    is_active: $('#isActive').is(':checked'),
                    is_deprecated: $('#isDeprecated').is(':checked'),
                    deprecated_reason: $('#deprecatedReason').val().trim() || null
                };

                // Validation
                if (!formData.scenario_code) {
                    this.showError('Scenario Code is required');
                    return;
                }

                if (!formData.scenario_name) {
                    this.showError('Scenario Name is required');
                    return;
                }

                if (!formData.module_name) {
                    this.showError('Module Name is required');
                    return;
                }

                if (!formData.expected_result) {
                    this.showError('Expected Result is required');
                    return;
                }

                let result;
                if (this.editingScenario) {
                    result = await dataFunctions.updateTestScenario(this.editingScenario.id, formData);
                } else {
                    result = await dataFunctions.createTestScenario(formData);
                }

                if (result && result.success) {
                    this.showSuccess(result.message || 'Test scenario saved successfully');
                    $('#scenarioModal').modal('hide');
                    this.loadScenarios(true);
                } else {
                    this.showError(result?.message || 'Error saving test scenario');
                }
            } catch (error) {
                console.error('Error saving scenario:', error);
                this.showError('Error saving test scenario: ' + error.message);
            }
        },

        deleteScenario: function (scenarioId) {
            const scenario = this.scenarios.find(s => s.id === scenarioId);
            if (!scenario) return;

            Swal.fire({
                title: 'Are you sure?',
                text: `Do you want to delete "${scenario.scenario_code}: ${scenario.scenario_name}"? This action cannot be undone.`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        const deleteResult = await dataFunctions.deleteTestScenario(scenarioId);
                        if (deleteResult && deleteResult.success) {
                            this.showSuccess('Test scenario deleted successfully');
                            this.loadScenarios(true);
                        } else {
                            this.showError(deleteResult?.message || 'Error deleting test scenario');
                        }
                    } catch (error) {
                        console.error('Error deleting scenario:', error);
                        this.showError('Error deleting test scenario: ' + error.message);
                    }
                }
            });
        },

        confirmDelete: function () {
            // This is called from the delete modal if needed
            if (this.deletingScenarioId) {
                this.deleteScenario(this.deletingScenarioId);
            }
        },

        refreshScenarios: function () {
            this.loadScenarios(true);
        },

        exportScenarios: function () {
            // Simple CSV export
            const headers = ['Scenario Code', 'Scenario Name', 'Module', 'Feature', 'Test Type', 'Severity', 'Role', 'Automated', 'Status'];
            const rows = this.filteredScenarios.map(s => [
                s.scenario_code || '',
                s.scenario_name || '',
                s.module_name || '',
                s.feature_name || '',
                s.test_type || '',
                s.severity_level || '',
                s.role_name || '',
                s.is_automated ? 'Yes' : 'No',
                s.is_active ? 'Active' : 'Inactive'
            ]);

            const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `test_scenarios_${new Date().toISOString().split('T')[0]}.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
        },

        showLoading: function () {
            $('#scenariosLoading').show();
            $('#scenariosTable').hide();
            $('#scenariosEmpty').hide();
        },

        hideLoading: function () {
            $('#scenariosLoading').hide();
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
const testScenariosGrid = _testScenariosGrid;

// Make it available globally
window.testScenariosGrid = testScenariosGrid;

// Initialize when DOM is ready
$(document).ready(function () {
    if ($('#scenariosTable').length) {
        testScenariosGrid.init();
    }
});
