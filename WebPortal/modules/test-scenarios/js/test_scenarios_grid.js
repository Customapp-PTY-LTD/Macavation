/**
 * Test Scenarios Grid Module
 * Handles test scenario management functionality with Supabase integration.
 * Follows company module pattern: IIFE, arrow methods, scope = _testScenariosGrid for same-module calls.
 */

var _testScenariosGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        scenarios: [],
        filteredScenarios: [],
        currentPage: 1,
        itemsPerPage: 20,
        searchDebounceToken: 0,
        currentFilters: {},

        init: async () => {
            const scope = _testScenariosGrid;
            await scope.waitForReady();
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
                    if (typeof _modal_test_scenario !== 'undefined' && _modal_test_scenario.init) _modal_test_scenario.init();
                    scope.setupEventListeners();
                    scope.loadScenarios();
                    scope.loadRolesForDropdown();
                    scope.loadModulesForFilter();
                });
            } else {
                scope.setupEventListeners();
                await scope.loadScenarios();
                await scope.loadRolesForDropdown();
                scope.loadModulesForFilter();
            }
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _testScenariosGrid;

            $('#searchInput').on('input', function () {
                const token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) {
                        scope.filterScenarios();
                    }
                });
            });

            $('#searchBtn').on('click', function () {
                scope.filterScenarios();
            });

            $('#filterModule, #filterTestType, #filterSeverity, #filterRole, #filterAutomated').on('change', function () {
                scope.filterScenarios();
            });

            $('#applyFiltersBtn').on('click', function () {
                scope.applyFilters();
            });

            $('#clearFiltersBtn').on('click', function () {
                scope.clearFilters();
            });

            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const scope = _testScenariosGrid;
                const page = parseInt($(this).data('page'), 10);
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderScenarios();
                }
            });

            $('#addScenarioBtn').on('click', function () {
                if (typeof _modal_test_scenario !== 'undefined' && _modal_test_scenario.show) _modal_test_scenario.show();
            });

            $(document).on('click', '.scenario-code-link, .scenario-name-link', function (e) {
                e.preventDefault();
                const scope = _testScenariosGrid;
                const scenarioId = $(this).data('scenario-id');
                if (!scenarioId) return;
                dataFunctions.getTestScenarioById(scenarioId).then(function (scenario) {
                    if (!scenario || (Array.isArray(scenario) && scenario.length === 0)) {
                        scope.showError('Test scenario not found');
                        return;
                    }
                    var scenarioData = Array.isArray(scenario) ? scenario[0] : scenario;
                    if (typeof _modal_test_scenario !== 'undefined' && _modal_test_scenario.show) _modal_test_scenario.show(scenarioData);
                }).catch(function (error) {
                    console.error('Error editing scenario:', error);
                    scope.showError('Error loading scenario details: ' + error.message);
                });
            });

            $(document).on('click', '.edit-scenario-btn', function (e) {
                e.preventDefault();
                const scope = _testScenariosGrid;
                const scenarioId = $(this).data('scenario-id');
                if (!scenarioId) return;
                dataFunctions.getTestScenarioById(scenarioId).then(function (scenario) {
                    if (!scenario || (Array.isArray(scenario) && scenario.length === 0)) {
                        scope.showError('Test scenario not found');
                        return;
                    }
                    var scenarioData = Array.isArray(scenario) ? scenario[0] : scenario;
                    if (typeof _modal_test_scenario !== 'undefined' && _modal_test_scenario.show) _modal_test_scenario.show(scenarioData);
                }).catch(function (error) {
                    console.error('Error editing scenario:', error);
                    scope.showError('Error loading scenario details: ' + error.message);
                });
            });

            $(document).on('click', '.delete-scenario-btn', function () {
                const scope = _testScenariosGrid;
                const scenarioId = $(this).data('scenario-id');
                scope.deleteScenario(scenarioId);
            });

        },

        loadScenarios: async (forceRefresh) => {
            const scope = _testScenariosGrid;
            try {
                scope.showLoading();
                const startTime = performance.now();
                const scenarios = await dataFunctions.getTestScenarios(null, forceRefresh || false);
                const loadTime = performance.now() - startTime;
                console.log('[Performance] Test scenarios loaded in ' + loadTime.toFixed(2) + 'ms');

                scope.scenarios = scenarios || [];
                scope.filteredScenarios = scope.scenarios;
                scope.currentPage = 1;
                scope.renderScenarios();
                scope.hideLoading();
            } catch (error) {
                console.error('Error loading test scenarios:', error);
                scope.showError('Error loading test scenarios: ' + error.message);
                scope.hideLoading();
            }
        },

        loadRolesForDropdown: async () => {
            const scope = _testScenariosGrid;
            try {
                const roles = await dataFunctions.getRoles();
                if (!roles || !Array.isArray(roles) || roles.length === 0) {
                    console.warn('No roles found');
                    return;
                }
                const select = document.getElementById('filterRole');
                if (select) {
                    var html = '<option value="">All Roles</option>';
                    roles.forEach(function (role) {
                        html += '<option value="' + role.id + '">' + scope.escapeHtml(role.role_name) + '</option>';
                    });
                    select.innerHTML = html;
                }
            } catch (error) {
                console.error('Error loading roles:', error);
            }
        },

        loadModulesForFilter: () => {
            const scope = _testScenariosGrid;
            var modules = [
                'authentication', 'crm', 'grower-intake', 'kernel-production',
                'oil-production', 'quality-assurance', 'stock-management',
                'sales-forecasting', 'financial-management', 'user-management',
                'dashboard', 'document-management', 'palladium-integration'
            ];
            var moduleSelect = document.getElementById('filterModule');
            if (moduleSelect) {
                var html = '<option value="">All Modules</option>';
                modules.forEach(function (mod) {
                    html += '<option value="' + mod + '">' + scope.escapeHtml(mod) + '</option>';
                });
                moduleSelect.innerHTML = html;
            }
        },

        filterScenarios: () => {
            const scope = _testScenariosGrid;
            var searchTerm = $('#searchInput').val().toLowerCase();
            var moduleFilter = $('#filterModule').val();
            var testTypeFilter = $('#filterTestType').val();
            var severityFilter = $('#filterSeverity').val();
            var roleFilter = $('#filterRole').val();
            var automatedFilter = $('#filterAutomated').is(':checked');

            scope.filteredScenarios = scope.scenarios.filter(function (scenario) {
                var matchesSearch = !searchTerm ||
                    (scenario.scenario_code && scenario.scenario_code.toLowerCase().includes(searchTerm)) ||
                    (scenario.scenario_name && scenario.scenario_name.toLowerCase().includes(searchTerm)) ||
                    (scenario.description && scenario.description.toLowerCase().includes(searchTerm)) ||
                    (scenario.module_name && scenario.module_name.toLowerCase().includes(searchTerm)) ||
                    (scenario.feature_name && scenario.feature_name.toLowerCase().includes(searchTerm));
                var matchesModule = !moduleFilter || scenario.module_name === moduleFilter;
                var matchesTestType = !testTypeFilter || scenario.test_type === testTypeFilter;
                var matchesSeverity = !severityFilter || scenario.severity_level === severityFilter;
                var matchesRole = !roleFilter || scenario.role_id === roleFilter;
                var matchesAutomated = !automatedFilter || scenario.is_automated === true;
                return matchesSearch && matchesModule && matchesTestType && matchesSeverity && matchesRole && matchesAutomated;
            });
            scope.currentPage = 1;
            scope.renderScenarios();
        },

        applyFilters: () => {
            const scope = _testScenariosGrid;
            scope.currentFilters = {
                module_name: $('#filterModule').val() || null,
                test_type: $('#filterTestType').val() || null,
                severity_level: $('#filterSeverity').val() || null,
                role_id: $('#filterRole').val() || null,
                is_automated: $('#filterAutomated').is(':checked') || null,
                searchTerm: $('#searchInput').val() || null
            };
            scope.performSearch();
        },

        performSearch: async () => {
            const scope = _testScenariosGrid;
            try {
                scope.showLoading();
                var scenarios = await dataFunctions.searchTestScenarios(scope.currentFilters);
                scope.scenarios = scenarios || [];
                scope.filteredScenarios = scope.scenarios;
                scope.currentPage = 1;
                scope.renderScenarios();
                scope.hideLoading();
            } catch (error) {
                console.error('Error searching scenarios:', error);
                scope.showError('Error searching scenarios: ' + error.message);
                scope.hideLoading();
            }
        },

        clearFilters: () => {
            const scope = _testScenariosGrid;
            $('#filterModule').val('');
            $('#filterTestType').val('');
            $('#filterSeverity').val('');
            $('#filterRole').val('');
            $('#filterAutomated').prop('checked', false);
            $('#searchInput').val('');
            scope.currentFilters = {};
            scope.filterScenarios();
        },

        renderScenarios: () => {
            const scope = _testScenariosGrid;
            var startIndex = (scope.currentPage - 1) * scope.itemsPerPage;
            var endIndex = startIndex + scope.itemsPerPage;
            var pageScenarios = scope.filteredScenarios.slice(startIndex, endIndex);

            if (scope.filteredScenarios.length === 0) {
                $('#scenariosTableBody').empty();
                $('#scenariosEmpty').show();
                $('#scenariosTable').hide();
                scope.renderPagination();
                return;
            }

            $('#scenariosEmpty').hide();
            $('#scenariosTable').show();

            var html = '';
            pageScenarios.forEach(function (scenario) {
                var severityBadge = scope.getSeverityBadge(scenario.severity_level);
                var automatedBadge = scenario.is_automated
                    ? '<span class="badge bg-success">Yes</span>'
                    : '<span class="badge bg-secondary">No</span>';
                var statusBadge = scenario.is_active
                    ? '<span class="badge bg-success">Active</span>'
                    : '<span class="badge bg-danger">Inactive</span>';
                html +=
                    '<tr>' +
                    '<td><a href="#" class="scenario-code-link text-primary" data-scenario-id="' + scope.escapeHtml(scenario.id) + '">' + scope.escapeHtml(scenario.scenario_code || 'N/A') + '</a></td>' +
                    '<td><a href="#" class="scenario-name-link" data-scenario-id="' + scope.escapeHtml(scenario.id) + '">' + scope.escapeHtml(scenario.scenario_name || 'N/A') + '</a></td>' +
                    '<td>' + scope.escapeHtml(scenario.module_name || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(scenario.feature_name || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(scenario.test_type || 'N/A') + '</td>' +
                    '<td>' + severityBadge + '</td>' +
                    '<td>' + scope.escapeHtml(scenario.role_name || 'N/A') + '</td>' +
                    '<td>' + automatedBadge + '</td>' +
                    '<td>' + statusBadge + '</td>' +
                    '<td><div class="btn-group btn-group-sm" role="group">' +
                    '<button type="button" class="btn btn-outline-primary edit-scenario-btn" data-scenario-id="' + scope.escapeHtml(scenario.id) + '" title="Edit"><i class="fas fa-edit"></i></button>' +
                    '<button type="button" class="btn btn-outline-danger delete-scenario-btn" data-scenario-id="' + scope.escapeHtml(scenario.id) + '" title="Delete"><i class="fas fa-trash"></i></button>' +
                    '</div></td></tr>';
            });

            $('#scenariosTableBody').html(html);
            scope.renderPagination();
        },

        getSeverityBadge: (severity) => {
            const scope = _testScenariosGrid;
            var badges = {
                critical: '<span class="badge bg-danger">Critical</span>',
                high: '<span class="badge bg-warning">High</span>',
                medium: '<span class="badge bg-info">Medium</span>',
                low: '<span class="badge bg-secondary">Low</span>',
                info: '<span class="badge bg-light text-dark">Info</span>'
            };
            return badges[severity] || '<span class="badge bg-secondary">' + (severity || 'N/A') + '</span>';
        },

        renderPagination: () => {
            const scope = _testScenariosGrid;
            var totalPages = Math.ceil(scope.filteredScenarios.length / scope.itemsPerPage);
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

        deleteScenario: (scenarioId) => {
            const scope = _testScenariosGrid;
            var scenario = scope.scenarios.find(function (s) { return s.id === scenarioId; });
            if (!scenario) return;

            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete "' + (scenario.scenario_code || '') + ': ' + (scenario.scenario_name || '') + '"? This action cannot be undone.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async function (result) {
                if (result.isConfirmed) {
                    const scope = _testScenariosGrid;
                    try {
                        var deleteResult = await dataFunctions.deleteTestScenario(scenarioId);
                        if (deleteResult && deleteResult.success) {
                            scope.showSuccess('Test scenario deleted successfully');
                            scope.loadScenarios(true);
                        } else {
                            scope.showError((deleteResult && deleteResult.message) || 'Error deleting test scenario');
                        }
                    } catch (error) {
                        console.error('Error deleting scenario:', error);
                        scope.showError('Error deleting test scenario: ' + error.message);
                    }
                }
            });
        },

        confirmDelete: () => {
            const scope = _testScenariosGrid;
            if (scope.deletingScenarioId) {
                scope.deleteScenario(scope.deletingScenarioId);
            }
        },

        refreshScenarios: () => {
            _testScenariosGrid.loadScenarios(true);
        },

        exportScenarios: () => {
            const scope = _testScenariosGrid;
            var headers = ['Scenario Code', 'Scenario Name', 'Module', 'Feature', 'Test Type', 'Severity', 'Role', 'Automated', 'Status'];
            var rows = scope.filteredScenarios.map(function (s) {
                return [
                    s.scenario_code || '',
                    s.scenario_name || '',
                    s.module_name || '',
                    s.feature_name || '',
                    s.test_type || '',
                    s.severity_level || '',
                    s.role_name || '',
                    s.is_automated ? 'Yes' : 'No',
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
            a.download = 'test_scenarios_' + new Date().toISOString().split('T')[0] + '.csv';
            a.click();
            window.URL.revokeObjectURL(url);
        },

        showLoading: () => {
            $('#scenariosLoading').show();
            $('#scenariosTable').hide();
            $('#scenariosEmpty').hide();
        },

        hideLoading: () => {
            $('#scenariosLoading').hide();
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

window.testScenariosGrid = _testScenariosGrid;

$(document).ready(function () {
    if ($('#scenariosTable').length) {
        _testScenariosGrid.init();
    }
});
