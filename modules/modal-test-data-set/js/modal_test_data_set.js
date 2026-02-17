/**
 * Modal: Add/Edit Test Data Set. Parent calls show() or show(dataSet).
 * Modal owns init, show, clearForm, populateForm, save.
 */
var _modal_test_data_set = (function () {
    'use strict';

    var MODULES = [
        'authentication', 'crm', 'grower-intake', 'kernel-production',
        'oil-production', 'quality-assurance', 'stock-management',
        'sales-forecasting', 'financial-management', 'user-management',
        'dashboard', 'document-management', 'palladium-integration'
    ];

    var editingDataSet = null;

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveDataSetBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('dataSetModal');
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

        show: function (dataSet) {
            var title = document.getElementById('dataSetModalLabel');
            if (title) title.textContent = dataSet ? 'Edit Data Set' : 'Add New Data Set';
            editingDataSet = dataSet || null;
            api.clearForm();
            if (dataSet) api.populateForm(dataSet);
            var modalEl = document.getElementById('dataSetModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#dataSetModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('dataSetForm');
            if (form) form.reset();
            if (typeof $ !== 'undefined') {
                $('#setScenarioIds').val('[]');
                $('#setIsActive').prop('checked', true);
            }
            editingDataSet = null;
        },

        populateForm: function (dataSet) {
            if (typeof $ === 'undefined') return;
            $('#setName').val(dataSet.set_name || '');
            $('#setModule').val(dataSet.module || '');
            $('#setDescription').val(dataSet.description || '');
            $('#setScenarioIds').val(dataSet.test_scenario_ids ? JSON.stringify(dataSet.test_scenario_ids, null, 2) : '[]');
            $('#setIsActive').prop('checked', dataSet.is_active !== false);
        },

        showError: function (message) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                alert(message);
            }
        },

        showSuccess: function (message) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'success', title: 'Success', text: message, timer: 2000, showConfirmButton: false });
            } else {
                alert(message);
            }
        },

        save: async function () {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.canAccessTestManagement()) {
                api.showError('You do not have permission to modify test data sets.');
                return;
            }
            var scenarioIds = [];
            try {
                if (typeof $ !== 'undefined' && $('#setScenarioIds').val().trim()) {
                    scenarioIds = JSON.parse($('#setScenarioIds').val());
                }
            } catch (e) {
                api.showError('Invalid JSON in Scenario IDs field');
                return;
            }
            var set_name = typeof $ !== 'undefined' ? $('#setName').val().trim() : (document.getElementById('setName') && document.getElementById('setName').value.trim());
            var module_val = typeof $ !== 'undefined' ? $('#setModule').val().trim() : (document.getElementById('setModule') && document.getElementById('setModule').value.trim());
            if (!set_name) { api.showError('Set Name is required'); return; }
            if (!module_val) { api.showError('Module is required'); return; }
            var formData = {
                set_name: set_name,
                module: module_val,
                description: (typeof $ !== 'undefined' ? $('#setDescription').val() : (document.getElementById('setDescription') && document.getElementById('setDescription').value)) || null,
                test_scenario_ids: scenarioIds.length > 0 ? scenarioIds : null,
                is_active: typeof $ !== 'undefined' ? $('#setIsActive').is(':checked') : (document.getElementById('setIsActive') && document.getElementById('setIsActive').checked)
            };
            try {
                var result;
                if (editingDataSet) {
                    result = await dataFunctions.updateTestDataSet(editingDataSet.id, formData);
                } else {
                    result = await dataFunctions.createTestDataSet(formData);
                }
                if (result && result.success) {
                    api.showSuccess(result.message || 'Data set saved successfully');
                    if (typeof $ !== 'undefined') $('#dataSetModal').modal('hide');
                    else if (typeof bootstrap !== 'undefined') {
                        var modalEl = document.getElementById('dataSetModal');
                        if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
                    }
                    if (typeof _testDataGrid !== 'undefined' && _testDataGrid.loadDataSets) _testDataGrid.loadDataSets(true);
                } else {
                    api.showError((result && result.message) || 'Error saving data set');
                }
            } catch (error) {
                console.error('Error saving data set:', error);
                if (error.message && (error.message.indexOf('403') !== -1 || error.message.toLowerCase().indexOf('permission') !== -1 || error.message.toLowerCase().indexOf('forbidden') !== -1)) {
                    api.showError('You do not have permission to modify test data sets.');
                } else {
                    api.showError('Error saving data set: ' + error.message);
                }
            }
        }
    };

    return api;
})();
