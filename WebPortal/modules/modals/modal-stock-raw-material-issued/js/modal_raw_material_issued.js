/**
 * Modal: Raw Material Stock Issued. Parent calls show().
 */
var _modal_stock_raw_material_issued = (function () {
    'use strict';
    var api = {
        init: function () {
            var scope = api;
            var saveBtn = document.getElementById('saveRawMaterialIssuedBtn');
            if (saveBtn) saveBtn.addEventListener('click', function (e) { e.preventDefault(); scope.saveRawMaterialIssued(); });
            var addRowBtn = document.getElementById('addIssuedItemRow');
            if (addRowBtn) addRowBtn.addEventListener('click', function () { scope.addIssuedItemRow(); });
            if (typeof $ !== 'undefined') {
                $(document).on('click', '.removeIssuedRow', function () { $(this).closest('tr').remove(); });
            }
        },

        show: async function () {
            if (typeof $ !== 'undefined') {
                $('#rawMaterialIssuedModalLabel').text('Raw Material Stock Issued');
                $('#stockIssuedId').val('');
                api.clearRawMaterialIssuedForm();
            }

            try {
                if (typeof dataFunctions !== 'undefined' && dataFunctions.getUsers) {
                    var users = await dataFunctions.getUsers();
                    var firstSelect = document.querySelector('select[name="issuedBy"]');
                    if (firstSelect) {
                        var opts = '<option value="">Select User</option>';
                        if (users && Array.isArray(users)) {
                            users.forEach(function (user) {
                                var name = user.email || user.username || 'Unknown';
                                opts += '<option value="' + user.id + '">' + name + '</option>';
                            });
                        }
                        document.querySelectorAll('select[name="issuedBy"]').forEach(function (sel) { sel.innerHTML = opts; });
                    }
                }
            } catch (err) {
                console.error('Error loading users:', err);
            }

            var modalEl = document.getElementById('rawMaterialIssuedModal');
            if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else if (typeof $ !== 'undefined' && $.fn.modal) $('#rawMaterialIssuedModal').modal('show');
        },

        clearRawMaterialIssuedForm: function () {
            if (typeof $ === 'undefined') return;
            $('#rawMaterialIssuedForm')[0].reset();
            $('#stockIssuedId').val('');
            $('#issuedItemsTableBody tr:not(:first)').remove();
            $('#issuedItemsTableBody tr:first input, #issuedItemsTableBody tr:first select').val('');
            var emptyOpt = '<option value="">Select User</option>';
            document.querySelectorAll('select[name="issuedBy"]').forEach(function (s) { s.innerHTML = emptyOpt; });
        },

        addIssuedItemRow: function () {
            if (typeof $ === 'undefined') return;
            var userOptions = $('select[name="issuedBy"]:first').html();
            var newRow = '<tr>' +
                '<td><input type="date" class="form-control form-control-sm" name="issueDate"></td>' +
                '<td><input type="date" class="form-control form-control-sm" name="bestBefore"></td>' +
                '<td><input type="date" class="form-control form-control-sm" name="productionDate"></td>' +
                '<td><select class="form-select form-select-sm" name="productDescription">' +
                '<option value="">Select Product</option><option value="Shell">Shell</option><option value="Kernel">Kernel</option>' +
                '<option value="Kernel Dust">Kernel Dust</option><option value="Cracker Dust">Cracker Dust</option><option value="cracker">cracker</option></select></td>' +
                '<td><input type="text" class="form-control form-control-sm" name="batchDetails"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="quantityRequired" step="0.01"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="totalIssued" step="0.01"></td>' +
                '<td><select class="form-select form-select-sm" name="issuedBy">' + userOptions + '</select></td>' +
                '<td><select class="form-select form-select-sm" name="issuedToDept">' +
                '<option value="">Select Department</option><option value="Crude Oil Dept.">Crude Oil Dept.</option>' +
                '<option value="Kernel Production">Kernel Production</option><option value="Oil Production">Oil Production</option>' +
                '<option value="Packing">Packing</option><option value="Quality Assurance">Quality Assurance</option></select></td>' +
                '<td><button type="button" class="btn btn-sm btn-danger removeIssuedRow"><i class="fas fa-times"></i></button></td></tr>';
            $('#issuedItemsTableBody').append(newRow);
        },

        saveRawMaterialIssued: async function () {
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions) return;

                var form = document.getElementById('rawMaterialIssuedForm');
                if (form && !form.checkValidity()) {
                    form.reportValidity();
                    return;
                }

                var issuedItems = [];
                if (typeof $ !== 'undefined') {
                    $('#issuedItemsTableBody tr').each(function () {
                        var issueDate = $(this).find('input[name="issueDate"]').val();
                        var bestBefore = $(this).find('input[name="bestBefore"]').val();
                        var productionDate = $(this).find('input[name="productionDate"]').val();
                        var productDescription = $(this).find('select[name="productDescription"]').val();
                        var batchDetails = $(this).find('input[name="batchDetails"]').val();
                        var quantityRequired = $(this).find('input[name="quantityRequired"]').val();
                        var totalIssued = $(this).find('input[name="totalIssued"]').val();
                        var issuedBy = $(this).find('select[name="issuedBy"]').val();
                        var issuedToDept = $(this).find('select[name="issuedToDept"]').val();
                        if (issueDate || productDescription || batchDetails || quantityRequired || totalIssued) {
                            issuedItems.push({
                                issue_date: issueDate || null,
                                best_before: bestBefore || null,
                                production_date: productionDate || null,
                                product_description: productDescription || null,
                                batch_details: batchDetails || null,
                                quantity_required_kg: quantityRequired ? parseFloat(quantityRequired) : null,
                                total_issued_kg: totalIssued ? parseFloat(totalIssued) : null,
                                issued_by: issuedBy || null,
                                issued_to_department: issuedToDept || null
                            });
                        }
                    });
                }

                var issuedData = {
                    p_shift: document.getElementById('issuedShift') && document.getElementById('issuedShift').value,
                    p_issued_items: JSON.stringify(issuedItems)
                };

                var issuedId = document.getElementById('stockIssuedId') && document.getElementById('stockIssuedId').value;
                var result;
                if (issuedId) {
                    result = await dataFunctions.callFunction('update_raw_material_issued', { p_issued_id: issuedId, p_shift: issuedData.p_shift, p_issued_items: issuedData.p_issued_items });
                } else {
                    result = await dataFunctions.callFunction('create_raw_material_issued', issuedData);
                }

                if (result && result.success !== false) {
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('raw_material_issued');
                        dataFunctions.clearCachePattern('stock_items');
                    }
                    if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'success', title: 'Success', text: issuedId ? 'Raw material issued updated successfully' : 'Raw material issued recorded successfully', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('rawMaterialIssuedModal');
                    if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined' && $.fn.modal) $('#rawMaterialIssuedModal').modal('hide');
                    if (typeof _stockManagementGrid !== 'undefined' && _stockManagementGrid.loadStockItems) await _stockManagementGrid.loadStockItems(true);
                } else {
                    throw new Error(result && (result.error || result.message) ? (result.error || result.message) : 'Failed to save raw material issued');
                }
            } catch (error) {
                console.error('Error saving raw material issued:', error);
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save raw material issued: ' + error.message });
            }
        }
    };
    return api;
})();
_modal_stock_raw_material_issued.init();
