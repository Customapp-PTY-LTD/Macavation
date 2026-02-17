/**
 * Oil Production Grid Module
 * Version: 2.0.0 - Production Sheet Form Implementation
 * Follows company module pattern: IIFE, arrow methods, scope = _oilProductionGrid for same-module calls.
 */
console.log('[Oil Production] Loading module v2.0.0 - Production Sheet Form Enabled');

var _oilProductionGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        batches: [],

        init: async () => {
            const scope = _oilProductionGrid;
            await scope.waitForReady();
            scope.setupEventListeners();
            await scope.loadBatches();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _oilProductionGrid;
            // Remove any existing handlers first to prevent duplicates
            $('#addOilBatchBtn').off('click').on('click', function (e) {
                e.preventDefault();
                console.log('Add Oil Production button clicked');
                scope.showAddProductionModal();
            });
            
            // Save production sheet
            $('#saveOilProductionBtn').on('click', function () {
                scope.saveProductionSheet();
            });
            
            // Add mix row
            $('#addMixRow').on('click', function () {
                scope.addMixRow();
            });
            
            // Add raw material row
            $('#addRawMaterialRow').on('click', function () {
                scope.addRawMaterialRow();
            });
            
            // Remove row (delegated event)
            $(document).on('click', '.removeRow', function () {
                $(this).closest('tr').remove();
                scope.calculateRawMaterialTotals();
            });
            
            $(document).on('click', '.removeMixRow', function () {
                $(this).closest('tr').remove();
            });
            
            // Calculate totals on input change
            $(document).on('input', 'input[name="rawMaterialIn"], input[name="oilOut"], input[name="cakeOut"]', function () {
                scope.calculateRawMaterialTotals();
            });
            
            // Modal cleanup
            $('#oilProductionModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });
        },

        showAddProductionModal: () => {
            const scope = _oilProductionGrid;
            console.log('[Oil Production] Opening production sheet modal...');
            var modalElement = document.getElementById('oilProductionModal');
            if (!modalElement) {
                console.error('[Oil Production] Modal element not found in DOM!');
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire({
                    icon: 'error',
                    title: 'Modal Not Found',
                    text: 'The production sheet form could not be loaded. Please refresh the page (Ctrl+F5) to clear cache.',
                    confirmButtonText: 'OK'
                    });
                }
                return;
            }
            console.log('[Oil Production] Modal element found, initializing...');
            $('#oilProductionModalLabel').text('New Oil Production Sheet');
            $('#oilBatchId').val('');
            scope.clearForm();
            
            // Set default date to today
            const today = new Date().toISOString().split('T')[0];
            $('#productionDate').val(today);
            
            try {
                if (typeof bootstrap === 'undefined') {
                    $('#oilProductionModal').modal('show');
                } else {
                    var modal = new bootstrap.Modal(modalElement);
                    modal.show();
                    console.log('[Oil Production] Modal shown successfully');
                }
            } catch (error) {
                console.error('[Oil Production] Error showing modal:', error);
                $('#oilProductionModal').modal('show');
            }
        },

        clearForm: () => {
            const scope = _oilProductionGrid;
            $('#oilProductionForm')[0].reset();
            $('#oilBatchId').val('');
            $('#productName').val('Food grade oil');
            $('#rawMaterialTableBody tr:not(:first)').remove();
            $('#rawMaterialTableBody tr:first input').val('');
            scope.calculateRawMaterialTotals();
        },

        addMixRow: () => {
            const nextMixNumber = $('#mixTableBody tr').length + 1;
            const newRow = `
                <tr>
                    <td><input type="number" class="form-control form-control-sm" name="mixNumber" value="${nextMixNumber}"></td>
                    <td><input type="number" class="form-control form-control-sm" name="crush" step="0.01"></td>
                    <td><input type="time" class="form-control form-control-sm" name="time"></td>
                    <td>
                        <select class="form-select form-select-sm" name="rawMaterialType">
                            <option value="">Select Type</option>
                            <option value="Kernel">Kernel</option>
                            <option value="Cracker Dust">Cracker Dust</option>
                            <option value="Kernel Dust">Kernel Dust</option>
                            <option value="Shell">Shell</option>
                            <option value="Cake">Cake</option>
                        </select>
                    </td>
                    <td><input type="text" class="form-control form-control-sm" name="rawMaterialBatch"></td>
                    <td><input type="number" class="form-control form-control-sm" name="quantity" step="0.01"></td>
                    <td><input type="text" class="form-control form-control-sm" name="notes"></td>
                    <td><button type="button" class="btn btn-sm btn-danger removeMixRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            $('#mixTableBody').append(newRow);
        },

        addRawMaterialRow: () => {
            const newRow = `
                <tr>
                    <td><input type="text" class="form-control form-control-sm" name="rawMaterialBatch"></td>
                    <td><input type="number" class="form-control form-control-sm" name="rawMaterialIn" step="0.01"></td>
                    <td><input type="number" class="form-control form-control-sm" name="oilOut" step="0.01"></td>
                    <td><input type="number" class="form-control form-control-sm" name="cakeOut" step="0.01"></td>
                    <td><button type="button" class="btn btn-sm btn-danger removeRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            $('#rawMaterialTableBody').append(newRow);
        },

        calculateRawMaterialTotals: () => {
            let totalRawIn = 0;
            let totalOilOut = 0;
            let totalCakeOut = 0;
            
            $('#rawMaterialTableBody tr').each(function () {
                const rawIn = parseFloat($(this).find('input[name="rawMaterialIn"]').val()) || 0;
                const oilOut = parseFloat($(this).find('input[name="oilOut"]').val()) || 0;
                const cakeOut = parseFloat($(this).find('input[name="cakeOut"]').val()) || 0;
                
                totalRawIn += rawIn;
                totalOilOut += oilOut;
                totalCakeOut += cakeOut;
            });
            
            $('#totalRawMaterialIn').text(totalRawIn.toFixed(2));
            $('#totalOilOut').text(totalOilOut.toFixed(2));
            $('#totalCakeOut').text(totalCakeOut.toFixed(2));
        },

        saveProductionSheet: async () => {
            const scope = _oilProductionGrid;
            if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.callFunction !== 'function') {
                console.error('[Oil Production] dataFunctions not available');
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'System not ready. Please refresh the page.'
                    });
                }
                return;
            }
            
            try {
                const form = $('#oilProductionForm')[0];
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                
                // Collect mix data
                const mixes = [];
                $('#mixTableBody tr').each(function () {
                    const mixNumber = $(this).find('input[name="mixNumber"]').val();
                    const crush = $(this).find('input[name="crush"]').val();
                    const time = $(this).find('input[name="time"]').val();
                    const rawMaterialType = $(this).find('select[name="rawMaterialType"]').val();
                    const rawMaterialBatch = $(this).find('input[name="rawMaterialBatch"]').val();
                    const quantity = $(this).find('input[name="quantity"]').val();
                    const notes = $(this).find('input[name="notes"]').val();
                    
                    if (mixNumber || rawMaterialType || quantity) {
                        mixes.push({
                            mix_number: mixNumber ? parseInt(mixNumber) : null,
                            crush_value: crush ? parseFloat(crush) : null,
                            time_value: time || null,
                            raw_material_type: rawMaterialType || null,
                            raw_material_batch: rawMaterialBatch || null,
                            quantity_kg: quantity ? parseFloat(quantity) : null,
                            notes: notes || null
                        });
                    }
                });
                
                // Collect raw material data
                const rawMaterials = [];
                $('#rawMaterialTableBody tr').each(function () {
                    const batch = $(this).find('input[name="rawMaterialBatch"]').val();
                    const rawIn = $(this).find('input[name="rawMaterialIn"]').val();
                    const oilOut = $(this).find('input[name="oilOut"]').val();
                    const cakeOut = $(this).find('input[name="cakeOut"]').val();
                    
                    if (batch || rawIn || oilOut || cakeOut) {
                        rawMaterials.push({
                            batch_number: batch || null,
                            raw_material_in_kg: rawIn ? parseFloat(rawIn) : null,
                            oil_out_kg: oilOut ? parseFloat(oilOut) : null,
                            cake_out_kg: cakeOut ? parseFloat(cakeOut) : null
                        });
                    }
                });
                
                const productionData = {
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
                
                const batchId = $('#oilBatchId').val();
                let result;
                
                if (batchId) {
                    // Update existing
                    result = await dataFunctions.callFunction('update_oil_production_sheet', {
                        p_batch_id: batchId,
                        ...productionData
                    });
                } else {
                    // Create new
                    result = await dataFunctions.callFunction('create_oil_production_sheet', productionData);
                }
                
                if (result && result.success !== false) {
                    // Invalidate caches
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('oil_production_sheets');
                    }
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: batchId ? 'Production sheet updated successfully' : 'Production sheet created successfully',
                        timer: 2000,
                        showConfirmButton: false
                    });
                    var modalElement = document.getElementById('oilProductionModal');
                    if (modalElement && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                        var modalInstance = bootstrap.Modal.getInstance(modalElement);
                        if (modalInstance) modalInstance.hide();
                    }
                    scope.loadBatches(true);
                } else {
                    throw new Error(result?.error || result?.message || 'Failed to save production sheet');
                }
            } catch (error) {
                console.error('Error saving production sheet:', error);
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Error',
                        text: 'Failed to save production sheet: ' + error.message
                    });
                }
            }
        },

        loadBatches: async (forceRefresh) => {
            const scope = _oilProductionGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getOilProductionSheets !== 'function') {
                    console.warn('[Oil Production] dataFunctions not available, skipping load');
                    return;
                }
                var startTime = performance.now();
                console.log('[Oil Production] Loading batches...');
                var batches = await dataFunctions.getOilProductionSheets(null, forceRefresh).catch(function (error) {
                    console.error('[Oil Production] Error loading batches:', error);
                    return [];
                });
                console.log('[Oil Production] Batches loaded, count: ' + (batches ? batches.length : 0));
                scope.batches = batches || [];
                scope.renderBatches();
            } catch (error) {
                console.error('[Oil Production] Error loading oil production sheets:', error);
                if (error.message && !error.message.includes('dataFunctions')) {
                    scope.showError('Unable to load oil production sheets. Please try again later.');
                }
            }
        },

        renderBatches: () => {
            const scope = _oilProductionGrid;
            var tbody = $('#oilBatchesTableBody');
            tbody.empty();
            if (scope.batches.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No oil production batches found. Click "New Oil Production Sheet" to create one.</td></tr>');
                return;
            }
            scope.batches.forEach(function (batch) {
                var dateStr = scope.formatDate(batch.production_date);
                var row = '<tr>' +
                    '<td>' + scope.escapeHtml(dateStr || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(batch.shift || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(batch.batch_number || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(batch.product_name || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(String(batch.total_oil_litre || '0')) + '</td>' +
                    '<td><span class="badge bg-info">' + scope.escapeHtml(batch.status || 'pending') + '</span></td>' +
                    '<td>' +
                    '<button class="btn btn-sm btn-outline-primary" onclick="oilProductionGrid.viewBatch(\'' + scope.escapeHtml(batch.id) + '\')"><i class="fas fa-eye"></i></button> ' +
                    '<button class="btn btn-sm btn-outline-secondary" onclick="oilProductionGrid.editBatch(\'' + scope.escapeHtml(batch.id) + '\')"><i class="fas fa-edit"></i></button>' +
                    '</td></tr>';
                tbody.append(row);
            });
        },

        editBatch: (batchId) => {
            const scope = _oilProductionGrid;
            var batch = scope.batches.find(function (b) { return b.id === batchId; });
            if (batch) {
                $('#oilBatchId').val(batch.id);
                $('#oilProductionModalLabel').text('Edit Oil Production Sheet');
                // Populate form fields
                $('#productionDate').val(batch.production_date || '');
                $('#shift').val(batch.shift || '');
                $('#shiftSupervisor').val(batch.shift_supervisor || '');
                $('#supervisorSignature').val(batch.supervisor_signature || '');
                $('#batchNumber').val(batch.batch_number || '');
                $('#productName').val(batch.product_name || 'Food grade oil');
                // ... populate other fields
                var modalElement = document.getElementById('oilProductionModal');
                if (modalElement && typeof bootstrap !== 'undefined') {
                    var modal = new bootstrap.Modal(modalElement);
                    modal.show();
                }
            }
        },

        viewBatch: (batchId) => {
            if (typeof Swal !== 'undefined' && Swal.fire) {
                Swal.fire('Info', 'Oil batch details view is under development', 'info');
            }
        },

        showError: (message) => {
            if (typeof Swal !== 'undefined' && Swal.fire) {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                alert(message);
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        formatDate: (value) => {
            if (!value) return '';
            var d = value instanceof Date ? value : new Date(value);
            if (isNaN(d.getTime())) return '';
            var day = String(d.getDate()).padStart(2, '0');
            var month = String(d.getMonth() + 1).padStart(2, '0');
            var year = d.getFullYear();
            return day + '/' + month + '/' + year;
        },

        exportBatches: () => {
            const scope = _oilProductionGrid;
            if (!scope.batches || scope.batches.length === 0) {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Info', 'No batches to export', 'info');
                }
                return;
            }
            var columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'input_material', label: 'Input Material' },
                { key: 'input_quantity_kg', label: 'Input Quantity (kg)' },
                { key: 'oil_produced_l', label: 'Oil Produced (L)' },
                { key: 'status', label: 'Status' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.batches, 'oil_production_batches', columns);
            } else {
                if (typeof Swal !== 'undefined' && Swal.fire) {
                    Swal.fire('Error', 'Export utility not available', 'error');
                }
            }
        }
    };
}();

window.oilProductionGrid = _oilProductionGrid;

function initializeOilProductionGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined' && dataFunctions && typeof dataFunctions.getOilProductionSheets === 'function') {
            _oilProductionGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeOilProductionGrid();
});

