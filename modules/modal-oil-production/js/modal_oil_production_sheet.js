/**
 * Modal: Oil Production Sheet – add/edit form. Parent (oil-production grid) only loads this route and calls show() or show(batch).
 */
var _modal_oil_production_sheet = function () {
    'use strict';

    return {
        init: () => {
            const scope = _modal_oil_production_sheet;
            $('#saveOilProductionBtn').off('click').on('click', function () { scope.saveProductionSheet(); });
            $('#addRawMaterialRow').off('click').on('click', function () { scope.addRawMaterialRow(); });
            $(document).on('click', '#oilProductionModal .removeRow', function () {
                $(this).closest('tr').remove();
                scope.calculateRawMaterialTotals();
            });
            $(document).on('input', '#oilProductionModal input[name="rawMaterialIn"], #oilProductionModal input[name="oilOut"], #oilProductionModal input[name="cakeOut"]', function () {
                scope.calculateRawMaterialTotals();
            });
            $('#oilProductionModal').off('hidden.bs.modal').on('hidden.bs.modal', function () { scope.clearForm(); });
        },

        show: (batch) => {
            const scope = _modal_oil_production_sheet;
            var modalElement = document.getElementById('oilProductionModal');
            if (!modalElement) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire({ icon: 'error', title: 'Modal Not Found', text: 'The production sheet form could not be loaded. Please refresh the page (Ctrl+F5) to clear cache.', confirmButtonText: 'OK' });
                }
                return;
            }
            if (batch) {
                $('#oilProductionModalLabel').text('Edit Oil Production Sheet');
                $('#oilBatchId').val(batch.id || '');
                scope.populateForm(batch);
            } else {
                $('#oilProductionModalLabel').text('New Oil Production Sheet');
                $('#oilBatchId').val('');
                scope.clearForm();
                var today = new Date().toISOString().split('T')[0];
                $('#productionDate').val(today);
            }
            if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                var modal = bootstrap.Modal.getOrCreateInstance(modalElement);
                modal.show();
            } else {
                $('#oilProductionModal').modal('show');
            }
        },

        clearForm: () => {
            const scope = _modal_oil_production_sheet;
            var form = document.getElementById('oilProductionForm');
            if (form) form.reset();
            $('#oilBatchId').val('');
            $('#productName').val('Food grade oil');
            $('#rawMaterialTableBody tr:not(:first)').remove();
            $('#rawMaterialTableBody tr:first input').val('');
            scope.calculateRawMaterialTotals();
        },

        populateForm: (batch) => {
            $('#productionDate').val(batch.production_date || '');
            $('#shift').val(batch.shift || '');
            $('#shiftSupervisor').val(batch.shift_supervisor || '');
            $('#supervisorSignature').val(batch.supervisor_signature || '');
            $('#batchNumber').val(batch.batch_number || '');
            $('#productName').val(batch.product_name || 'Food grade oil');
            $('#startOilBN').val(batch.start_oil_bn || '');
            $('#startOilLitre').val(batch.start_oil_litre != null ? batch.start_oil_litre : '');
            $('#ibc1BN').val(batch.ibc1_bn || '');
            $('#ibc1Litre').val(batch.ibc1_litre != null ? batch.ibc1_litre : '');
            $('#ibc2BN').val(batch.ibc2_bn || '');
            $('#ibc2Litre').val(batch.ibc2_litre != null ? batch.ibc2_litre : '');
            $('#ibc3BN').val(batch.ibc3_bn || '');
            $('#ibc3Litre').val(batch.ibc3_litre != null ? batch.ibc3_litre : '');
            $('#recipeOilKernel').val(batch.recipe_oil_kernel != null ? batch.recipe_oil_kernel : '0');
            $('#recipeCrackerDust').val(batch.recipe_cracker_dust != null ? batch.recipe_cracker_dust : '0');
            $('#recipeKernelDust').val(batch.recipe_kernel_dust != null ? batch.recipe_kernel_dust : '0');
            $('#recipeCrush').val(batch.recipe_crush != null ? batch.recipe_crush : '0');
            $('#recipeCake').val(batch.recipe_cake != null ? batch.recipe_cake : '0');
            $('#recipeNotes').val(batch.recipe_notes || '');
            $('#generalWaste').val(batch.general_waste_kg != null ? batch.general_waste_kg : '');
            $('#floorWaste').val(batch.floor_waste_kg != null ? batch.floor_waste_kg : '');
            $('#productWaste').val(batch.product_waste_kg != null ? batch.product_waste_kg : '');
            $('#oilFromFilter').val(batch.oil_from_filter_kg != null ? batch.oil_from_filter_kg : '');
            _modal_oil_production_sheet.calculateRawMaterialTotals();
        },

        addRawMaterialRow: () => {
            var newRow = '<tr>' +
                '<td><input type="text" class="form-control form-control-sm" name="rawMaterialBatch"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="rawMaterialIn" step="0.01"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="oilOut" step="0.01"></td>' +
                '<td><input type="number" class="form-control form-control-sm" name="cakeOut" step="0.01"></td>' +
                '<td><button type="button" class="btn btn-sm btn-danger removeRow"><i class="fas fa-times"></i></button></td>' +
                '</tr>';
            $('#rawMaterialTableBody').append(newRow);
        },

        calculateRawMaterialTotals: () => {
            var totalRawIn = 0, totalOilOut = 0, totalCakeOut = 0;
            $('#rawMaterialTableBody tr').each(function () {
                totalRawIn += parseFloat($(this).find('input[name="rawMaterialIn"]').val()) || 0;
                totalOilOut += parseFloat($(this).find('input[name="oilOut"]').val()) || 0;
                totalCakeOut += parseFloat($(this).find('input[name="cakeOut"]').val()) || 0;
            });
            $('#totalRawMaterialIn').text(totalRawIn.toFixed(2));
            $('#totalOilOut').text(totalOilOut.toFixed(2));
            $('#totalCakeOut').text(totalCakeOut.toFixed(2));
        },

        saveProductionSheet: async () => {
            const scope = _modal_oil_production_sheet;
            if (typeof dataFunctions === 'undefined' || !dataFunctions.callFunction) {
                if (typeof Swal !== 'undefined' && Swal.fire) Swal.fire({ icon: 'error', title: 'Error', text: 'System not ready. Please refresh the page.' });
                return;
            }
            try {
                var form = document.getElementById('oilProductionForm');
                if (!form || !form.checkValidity()) {
                    if (form) form.reportValidity();
                    return;
                }
                var mixes = [];
                $('#mixTableBody tr').each(function () {
                    var mixNumber = $(this).find('input[name="mixNumber"]').val();
                    var rawMaterialType = $(this).find('select[name="rawMaterialType"]').val();
                    var quantity = $(this).find('input[name="quantity"]').val();
                    if (mixNumber || rawMaterialType || quantity) {
                        mixes.push({
                            mix_number: mixNumber ? parseInt(mixNumber, 10) : null,
                            crush_value: $(this).find('input[name="crush"]').val() ? parseFloat($(this).find('input[name="crush"]').val()) : null,
                            time_value: $(this).find('input[name="time"]').val() || null,
                            raw_material_type: rawMaterialType || null,
                            raw_material_batch: $(this).find('input[name="rawMaterialBatch"]').val() || null,
                            quantity_kg: quantity ? parseFloat(quantity) : null,
                            notes: $(this).find('input[name="notes"]').val() || null
                        });
                    }
                });
                var rawMaterials = [];
                $('#rawMaterialTableBody tr').each(function () {
                    var batch = $(this).find('input[name="rawMaterialBatch"]').val();
                    var rawIn = $(this).find('input[name="rawMaterialIn"]').val();
                    var oilOut = $(this).find('input[name="oilOut"]').val();
                    var cakeOut = $(this).find('input[name="cakeOut"]').val();
                    if (batch || rawIn || oilOut || cakeOut) {
                        rawMaterials.push({
                            batch_number: batch || null,
                            raw_material_in_kg: rawIn ? parseFloat(rawIn) : null,
                            oil_out_kg: oilOut ? parseFloat(oilOut) : null,
                            cake_out_kg: cakeOut ? parseFloat(cakeOut) : null
                        });
                    }
                });
                var productionData = {
                    p_production_date: $('#productionDate').val(),
                    p_shift: $('#shift').val(),
                    p_shift_supervisor: $('#shiftSupervisor').val(),
                    p_batch_number: $('#batchNumber').val(),
                    p_supervisor_signature: $('#supervisorSignature').val() || null,
                    p_product_name: $('#productName').val(),
                    p_start_oil_bn: $('#startOilBN').val() || null,
                    p_start_oil_litre: $('#startOilLitre').val() ? parseFloat($('#startOilLitre').val()) : null,
                    p_ibc1_bn: $('#ibc1BN').val() || null,
                    p_ibc1_litre: $('#ibc1Litre').val() ? parseFloat($('#ibc1Litre').val()) : null,
                    p_ibc2_bn: $('#ibc2BN').val() || null,
                    p_ibc2_litre: $('#ibc2Litre').val() ? parseFloat($('#ibc2Litre').val()) : null,
                    p_ibc3_bn: $('#ibc3BN').val() || null,
                    p_ibc3_litre: $('#ibc3Litre').val() ? parseFloat($('#ibc3Litre').val()) : null,
                    p_recipe_oil_kernel: $('#recipeOilKernel').val() ? parseFloat($('#recipeOilKernel').val()) : null,
                    p_recipe_cracker_dust: $('#recipeCrackerDust').val() ? parseFloat($('#recipeCrackerDust').val()) : null,
                    p_recipe_kernel_dust: $('#recipeKernelDust').val() ? parseFloat($('#recipeKernelDust').val()) : null,
                    p_recipe_crush: $('#recipeCrush').val() ? parseFloat($('#recipeCrush').val()) : null,
                    p_recipe_cake: $('#recipeCake').val() ? parseFloat($('#recipeCake').val()) : null,
                    p_recipe_notes: $('#recipeNotes').val() || null,
                    p_general_waste_kg: $('#generalWaste').val() ? parseFloat($('#generalWaste').val()) : null,
                    p_floor_waste_kg: $('#floorWaste').val() ? parseFloat($('#floorWaste').val()) : null,
                    p_product_waste_kg: $('#productWaste').val() ? parseFloat($('#productWaste').val()) : null,
                    p_oil_from_filter_kg: $('#oilFromFilter').val() ? parseFloat($('#oilFromFilter').val()) : null,
                    p_raw_materials: rawMaterials.length > 0 ? JSON.stringify(rawMaterials) : null,
                    p_mixes: mixes.length > 0 ? JSON.stringify(mixes) : null
                };
                var batchId = $('#oilBatchId').val();
                var result;
                if (batchId) {
                    productionData.p_batch_id = batchId;
                    result = await dataFunctions.callFunction('update_oil_production_sheet', productionData);
                } else {
                    result = await dataFunctions.callFunction('create_oil_production_sheet', productionData);
                }
                if (result && result.success !== false) {
                    if (typeof dataFunctions.clearCachePattern === 'function') dataFunctions.clearCachePattern('oil_production_sheets');
                    if (typeof Swal !== 'undefined' && Swal.fire) {
                        Swal.fire({ icon: 'success', title: 'Success', text: batchId ? 'Production sheet updated successfully' : 'Production sheet created successfully', timer: 2000, showConfirmButton: false });
                    }
                    var modalEl = document.getElementById('oilProductionModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var inst = bootstrap.Modal.getInstance(modalEl);
                        if (inst) inst.hide();
                    } else {
                        $('#oilProductionModal').modal('hide');
                    }
                    if (typeof _oilProductionGrid !== 'undefined' && _oilProductionGrid.loadBatches) _oilProductionGrid.loadBatches(true);
                } else {
                    throw new Error(result && (result.error || result.message) ? (result.error || result.message) : 'Failed to save production sheet');
                }
            } catch (error) {
                console.error('Error saving production sheet:', error);
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire({ icon: 'error', title: 'Error', text: 'Failed to save production sheet: ' + (error.message || error) });
                }
            }
        }
    };
}();
