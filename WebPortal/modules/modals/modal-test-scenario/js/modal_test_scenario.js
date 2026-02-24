/**
 * Modal: Add/Edit Test Scenario. Parent calls show() or show(scenario).
 * Modal owns init, show, clearForm, populateForm, save, loadRolesForSelect, loadModuleList.
 */
var _modal_test_scenario = (function () {
    'use strict';

    var MODULES = [
        'authentication', 'crm', 'grower-intake', 'kernel-production',
        'oil-production', 'quality-assurance', 'stock-management',
        'sales-forecasting', 'financial-management', 'user-management',
        'dashboard', 'document-management', 'palladium-integration'
    ];

    var editingScenario = null;

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveScenarioBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('scenarioModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
            api.loadModuleList();
        },

        loadModuleList: function () {
            var list = document.getElementById('moduleList');
            if (!list) return;
            list.innerHTML = '';
            MODULES.forEach(function (mod) {
                var opt = document.createElement('option');
                opt.value = mod;
                list.appendChild(opt);
            });
        },

        loadRolesForSelect: async function () {
            var select = document.getElementById('cboRole');
            if (!select || typeof dataFunctions === 'undefined' || !dataFunctions.getRoles) return;
            try {
                var roles = await dataFunctions.getRoles();
                if (!roles || !Array.isArray(roles) || roles.length === 0) return;
                var html = '<option value="">Select Role</option>';
                roles.forEach(function (role) {
                    var name = (role.role_name || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    html += '<option value="' + role.id + '">' + name + '</option>';
                });
                select.innerHTML = html;
            } catch (e) {
                console.error('Error loading roles for scenario modal:', e);
            }
        },

        show: async function (scenario) {
            var title = document.getElementById('scenarioModalLabel');
            if (title) title.textContent = scenario ? 'Edit Test Scenario' : 'Add New Test Scenario';
            editingScenario = scenario || null;
            api.clearForm();
            await api.loadRolesForSelect();
            if (scenario) api.populateForm(scenario);
            var modalEl = document.getElementById('scenarioModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#scenarioModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('scenarioForm');
            if (form) form.reset();
            if (typeof $ !== 'undefined') {
                $('#testSteps').val('[]');
                $('#testData').val('{}');
                $('#tags').val('[]');
                $('#isActive').prop('checked', true);
                $('#isDeprecated').prop('checked', false);
            }
            editingScenario = null;
        },

        populateForm: function (scenario) {
            if (typeof $ === 'undefined') return;
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

        showError: function (message) {
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: message });
            else alert(message);
        },

        showSuccess: function (message) {
            if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: message, timer: 2000, showConfirmButton: false });
            else alert(message);
        },

        save: async function () {
            var testSteps = [], testData = {}, tags = [];
            try {
                if (typeof $ !== 'undefined' && $('#testSteps').val().trim()) testSteps = JSON.parse($('#testSteps').val());
            } catch (e) {
                api.showError('Invalid JSON in Test Steps field');
                return;
            }
            try {
                if (typeof $ !== 'undefined' && $('#testData').val().trim()) testData = JSON.parse($('#testData').val());
            } catch (e) {
                api.showError('Invalid JSON in Test Data field');
                return;
            }
            try {
                if (typeof $ !== 'undefined' && $('#tags').val().trim()) tags = JSON.parse($('#tags').val());
            } catch (e) {
                api.showError('Invalid JSON in Tags field');
                return;
            }

            var formData = {
                scenario_code: typeof $ !== 'undefined' ? $('#scenarioCode').val().trim() : (document.getElementById('scenarioCode') && document.getElementById('scenarioCode').value.trim()),
                scenario_name: typeof $ !== 'undefined' ? $('#scenarioName').val().trim() : (document.getElementById('scenarioName') && document.getElementById('scenarioName').value.trim()),
                module_name: typeof $ !== 'undefined' ? $('#moduleName').val().trim() : (document.getElementById('moduleName') && document.getElementById('moduleName').value.trim()),
                feature_name: (typeof $ !== 'undefined' ? $('#featureName').val() : (document.getElementById('featureName') && document.getElementById('featureName').value)) || null,
                test_type: typeof $ !== 'undefined' ? $('#testType').val() : (document.getElementById('testType') && document.getElementById('testType').value),
                severity_level: typeof $ !== 'undefined' ? $('#severityLevel').val() : (document.getElementById('severityLevel') && document.getElementById('severityLevel').value),
                severity_description: (typeof $ !== 'undefined' ? $('#severityDescription').val() : (document.getElementById('severityDescription') && document.getElementById('severityDescription').value)) || null,
                role_id: (typeof $ !== 'undefined' ? $('#cboRole').val() : (document.getElementById('cboRole') && document.getElementById('cboRole').value)) || null,
                preconditions: (typeof $ !== 'undefined' ? $('#preconditions').val() : (document.getElementById('preconditions') && document.getElementById('preconditions').value)) || null,
                expected_result: typeof $ !== 'undefined' ? $('#expectedResult').val().trim() : (document.getElementById('expectedResult') && document.getElementById('expectedResult').value.trim()),
                description: (typeof $ !== 'undefined' ? $('#description').val() : (document.getElementById('description') && document.getElementById('description').value)) || null,
                test_steps: testSteps,
                test_data: testData,
                test_data_description: (typeof $ !== 'undefined' ? $('#testDataDescription').val() : (document.getElementById('testDataDescription') && document.getElementById('testDataDescription').value)) || null,
                tags: tags,
                is_automated: typeof $ !== 'undefined' ? $('#isAutomated').is(':checked') : (document.getElementById('isAutomated') && document.getElementById('isAutomated').checked),
                automation_script_path: (typeof $ !== 'undefined' ? $('#automationScriptPath').val() : (document.getElementById('automationScriptPath') && document.getElementById('automationScriptPath').value)) || null,
                is_active: typeof $ !== 'undefined' ? $('#isActive').is(':checked') : (document.getElementById('isActive') && document.getElementById('isActive').checked),
                is_deprecated: typeof $ !== 'undefined' ? $('#isDeprecated').is(':checked') : (document.getElementById('isDeprecated') && document.getElementById('isDeprecated').checked),
                deprecated_reason: (typeof $ !== 'undefined' ? $('#deprecatedReason').val() : (document.getElementById('deprecatedReason') && document.getElementById('deprecatedReason').value)) || null
            };

            if (!formData.scenario_code) { api.showError('Scenario Code is required'); return; }
            if (!formData.scenario_name) { api.showError('Scenario Name is required'); return; }
            if (!formData.module_name) { api.showError('Module Name is required'); return; }
            if (!formData.expected_result) { api.showError('Expected Result is required'); return; }

            try {
                var result;
                if (editingScenario) {
                    result = await dataFunctions.updateTestScenario(editingScenario.id, formData);
                } else {
                    result = await dataFunctions.createTestScenario(formData);
                }
                if (result && result.success) {
                    api.showSuccess(result.message || 'Test scenario saved successfully');
                    if (typeof $ !== 'undefined') $('#scenarioModal').modal('hide');
                    else if (typeof bootstrap !== 'undefined') {
                        var modalEl = document.getElementById('scenarioModal');
                        if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
                    }
                    if (typeof _testScenariosGrid !== 'undefined' && _testScenariosGrid.loadScenarios) _testScenariosGrid.loadScenarios(true);
                } else {
                    api.showError((result && result.message) || 'Error saving test scenario');
                }
            } catch (error) {
                console.error('Error saving scenario:', error);
                api.showError('Error saving test scenario: ' + error.message);
            }
        }
    };

    return api;
})();
_modal_test_scenario.init();
