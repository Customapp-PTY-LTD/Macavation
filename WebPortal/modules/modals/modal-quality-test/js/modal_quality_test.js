/**
 * Modal: Quality Test (New/Edit). Parent calls show() or show(test). Modal owns init, show, clearForm, save.
 */
var _modal_quality_test = (function () {
    'use strict';

    var api = {
        init: function () {
            var saveBtn = document.getElementById('saveTestBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); api.save(); });
            var modalEl = document.getElementById('qualityTestModal');
            if (modalEl && typeof $ !== 'undefined') {
                $(modalEl).on('hidden.bs.modal', function () { api.clearForm(); });
            }
        },

        show: async function (test) {
            var title = document.getElementById('qualityTestModalLabel');
            if (title) title.textContent = test ? 'Edit Quality Test' : 'New Quality Test';
            if (typeof $ !== 'undefined') {
                api.clearForm();
                $('#testId').val(test ? test.id : '');
                var today = new Date().toISOString().split('T')[0];
                $('#testDate').val(test ? (test.test_date || today) : today);
                if (test) {
                    $('#testNumber').val(test.test_number || '');
                    $('#testType').val(test.test_type || '');
                    $('#productType').val(test.product_type || '');
                    $('#batchNumber').val(test.batch_number || '');
                    $('#sampleReference').val(test.sample_reference || '');
                    $('#style').val(test.style || '');
                    $('#testedBy').val(test.tested_by || '');
                    $('#moisturePercentage').val(test.moisture_percentage != null ? test.moisture_percentage : '');
                    $('#moistureMethod').val(test.moisture_method || '');
                    $('#moisturePass').prop('checked', !!test.moisture_pass);
                    $('#ffaPercentage').val(test.ffa_percentage != null ? test.ffa_percentage : '');
                    $('#ffaMethod').val(test.ffa_method || '');
                    $('#ffaPass').prop('checked', !!test.ffa_pass);
                    $('#peroxideValue').val(test.peroxide_value != null ? test.peroxide_value : '');
                    $('#peroxideMethod').val(test.peroxide_method || '');
                    $('#peroxidePass').prop('checked', !!test.peroxide_pass);
                    $('#tasteTestResult').val(test.taste_test_result || '');
                    $('#tasteTestNotes').val(test.taste_test_notes || '');
                    $('#tasteTestPass').prop('checked', !!test.taste_test_pass);
                    $('#smellTestResult').val(test.smell_test_result || '');
                    $('#smellTestNotes').val(test.smell_test_notes || '');
                    $('#smellTestPass').prop('checked', !!test.smell_test_pass);
                    $('#appearanceTestResult').val(test.appearance_test_result || '');
                    $('#appearanceTestNotes').val(test.appearance_test_notes || '');
                    $('#appearanceTestPass').prop('checked', !!test.appearance_test_pass);
                    $('#overallResult').val(test.overall_result || 'pending');
                    $('#overallNotes').val(test.overall_notes || '');
                    $('#testStatus').val(test.status || 'pending');
                }
                $('#basic-info-tab').tab('show');
            }

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getUsers) {
                    var users = await dataFunctions.getUsers();
                    var select = document.getElementById('testedBy');
                    if (select) {
                        var html = '<option value="">Select Tester</option>';
                        if (users && Array.isArray(users)) {
                            users.forEach(function (user) {
                                var name = user.email || user.username || 'Unknown';
                                html += '<option value="' + (user.id || '') + '">' + (name.replace(/</g, '&lt;').replace(/>/g, '&gt;')) + '</option>';
                            });
                        }
                        select.innerHTML = html;
                        if (test && test.tested_by) select.value = test.tested_by;
                    }
                }
            } catch (e) { console.error('Error loading users:', e); }

            var modalEl = document.getElementById('qualityTestModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#qualityTestModal').modal('show');
        },

        clearForm: function () {
            if (typeof $ === 'undefined') return;
            var form = document.getElementById('qualityTestForm');
            if (form) form.reset();
            var testId = document.getElementById('testId');
            if (testId) testId.value = '';
            $('#moisturePass, #ffaPass, #peroxidePass, #tasteTestPass, #smellTestPass, #appearanceTestPass').prop('checked', false);
        },

        save: async function () {
            if (typeof $ === 'undefined' || typeof dataFunctions === 'undefined') return;
            var form = document.getElementById('qualityTestForm');
            if (!form || !form.checkValidity()) {
                form.reportValidity();
                return;
            }
            var userInfo = typeof localStorage !== 'undefined' ? localStorage.getItem('user_info') : null;
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
            try {
                if (testId) {
                    var updatePayload = { p_test_id: testId };
                    for (var key in testData) { if (testData.hasOwnProperty(key)) updatePayload[key] = testData[key]; }
                    result = await dataFunctions.callFunction('update_quality_test_simple', updatePayload);
                } else {
                    result = await dataFunctions.callFunction('create_quality_test_simple', testData);
                }
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: testId ? 'Quality test updated successfully' : 'Quality test created successfully', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('qualityTestModal');
                    if (modalEl && typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(modalEl); if (m) m.hide(); }
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#qualityTestModal').modal('hide');
                    if (typeof _qualityAssuranceGrid !== 'undefined' && _qualityAssuranceGrid.loadTests) _qualityAssuranceGrid.loadTests(true);
                } else {
                    throw new Error((result && result.error) || (result && result.message) || 'Failed to save quality test');
                }
            } catch (error) {
                console.error('Error saving quality test:', error);
                if (typeof Swal !== 'undefined') Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save quality test: ' + (error.message || '') });
            }
        }
    };
    return api;
})();
_modal_quality_test.init();
