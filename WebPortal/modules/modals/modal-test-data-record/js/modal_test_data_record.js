/**
 * Modal: Add/Edit Test Data Record. Parent calls show() or show(record).
 * Modal owns init, show, clearForm, populateForm, save, loadDataSetsForSelect.
 */
var _modal_test_data_record = (function () {
    'use strict';

    var editingRecord = null;

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveRecordBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('recordModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        loadDataSetsForSelect: async function () {
            var select = document.getElementById('recordDataSetId');
            if (!select || typeof dataFunctions === 'undefined') return;
            try {
                var dataSets = await dataFunctions.getTestDataSets() || [];
                var html = '<option value="">Select Data Set</option>';
                dataSets.forEach(function (set) {
                    var name = (set.set_name || '') + ' (' + (set.module || '') + ')';
                    var escaped = name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                    html += '<option value="' + set.id + '">' + escaped + '</option>';
                });
                select.innerHTML = html;
            } catch (e) {
                console.error('Error loading data sets for record modal:', e);
            }
        },

        show: async function (record) {
            var title = document.getElementById('recordModalLabel');
            if (title) title.textContent = record ? 'Edit Record' : 'Add New Record';
            editingRecord = record || null;
            api.clearForm();
            await api.loadDataSetsForSelect();
            if (record) {
                api.populateForm(record);
            } else {
                if (typeof $ !== 'undefined') $('#recordDataValue').val('{}');
                var cleanupCheck = document.getElementById('recordCleanupRequired');
                if (cleanupCheck) cleanupCheck.checked = true;
            }
            var modalEl = document.getElementById('recordModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#recordModal').modal('show');
        },

        clearForm: function () {
            var form = document.getElementById('recordForm');
            if (form) form.reset();
            if (typeof $ !== 'undefined') {
                $('#recordDataValue').val('{}');
                $('#recordCleanupRequired').prop('checked', true);
            }
            editingRecord = null;
        },

        populateForm: function (record) {
            if (typeof $ === 'undefined') return;
            $('#recordDataSetId').val(record.data_set_id || '');
            $('#recordEntityType').val(record.entity_type || '');
            $('#recordDataKey').val(record.data_key || '');
            $('#recordEntityId').val(record.entity_id || '');
            $('#recordPurpose').val(record.purpose || '');
            $('#recordCleanupRequired').prop('checked', record.cleanup_required !== false);
            $('#recordDataValue').val(record.data_value ? JSON.stringify(record.data_value, null, 2) : '{}');
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
                api.showError('You do not have permission to modify test data records.');
                return;
            }
            var dataValue = {};
            try {
                if (typeof $ !== 'undefined' && $('#recordDataValue').val().trim()) {
                    dataValue = JSON.parse($('#recordDataValue').val());
                }
            } catch (e) {
                api.showError('Invalid JSON in Data Value field');
                return;
            }
            var formData = {
                data_set_id: typeof $ !== 'undefined' ? $('#recordDataSetId').val() : (document.getElementById('recordDataSetId') && document.getElementById('recordDataSetId').value),
                entity_type: typeof $ !== 'undefined' ? $('#recordEntityType').val() : (document.getElementById('recordEntityType') && document.getElementById('recordEntityType').value),
                data_key: typeof $ !== 'undefined' ? $('#recordDataKey').val().trim() : (document.getElementById('recordDataKey') && document.getElementById('recordDataKey').value.trim()),
                entity_id: (typeof $ !== 'undefined' ? $('#recordEntityId').val() : (document.getElementById('recordEntityId') && document.getElementById('recordEntityId').value)) || null,
                data_value: dataValue,
                purpose: (typeof $ !== 'undefined' ? $('#recordPurpose').val() : (document.getElementById('recordPurpose') && document.getElementById('recordPurpose').value)) || null,
                cleanup_required: typeof $ !== 'undefined' ? $('#recordCleanupRequired').is(':checked') : (document.getElementById('recordCleanupRequired') && document.getElementById('recordCleanupRequired').checked)
            };
            if (!formData.data_set_id) { api.showError('Data Set is required'); return; }
            if (!formData.entity_type) { api.showError('Entity Type is required'); return; }
            if (!formData.data_key) { api.showError('Data Key is required'); return; }
            try {
                var result;
                if (editingRecord) {
                    result = await dataFunctions.updateTestDataRecord(editingRecord.id, formData);
                } else {
                    result = await dataFunctions.createTestDataRecord(formData);
                }
                if (result && result.success) {
                    api.showSuccess(result.message || 'Record saved successfully');
                    if (typeof $ !== 'undefined') $('#recordModal').modal('hide');
                    else if (typeof bootstrap !== 'undefined') {
                        var modalEl = document.getElementById('recordModal');
                        if (modalEl) bootstrap.Modal.getInstance(modalEl).hide();
                    }
                    if (typeof _testDataGrid !== 'undefined' && _testDataGrid.loadRecords) _testDataGrid.loadRecords();
                } else {
                    api.showError((result && result.message) || 'Error saving record');
                }
            } catch (error) {
                console.error('Error saving record:', error);
                if (error.message && (error.message.indexOf('403') !== -1 || error.message.toLowerCase().indexOf('permission') !== -1 || error.message.toLowerCase().indexOf('forbidden') !== -1)) {
                    api.showError('You do not have permission to modify test data records.');
                } else {
                    api.showError('Error saving record: ' + error.message);
                }
            }
        }
    };

    return api;
})();
