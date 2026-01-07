/**
 * Oil Production Grid Module
 * Version: 2.0.0 - Production Sheet Form Implementation
 * Date: 2025-01-XX
 */
console.log('[Oil Production] Loading module v2.0.0 - Production Sheet Form Enabled');

var _oilProductionGrid = function () {
    return {
        batches: [],
        init: function () {
            console.log('[Oil Production] Initializing module...');
            
            // Wait for dataFunctions to be available
            if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getOilProductionSheets !== 'function') {
                console.warn('[Oil Production] dataFunctions not ready, waiting...');
                let retries = 0;
                const checkDataFunctions = setInterval(() => {
                    retries++;
                    if (typeof dataFunctions !== 'undefined' && dataFunctions && typeof dataFunctions.getOilProductionSheets === 'function') {
                        clearInterval(checkDataFunctions);
                        console.log('[Oil Production] dataFunctions ready, proceeding with initialization');
                        this.setupEventListeners();
                        this.loadBatches();
                    } else if (retries > 50) {
                        clearInterval(checkDataFunctions);
                        console.error('[Oil Production] dataFunctions not available after 5 seconds');
                        this.showError('Unable to initialize. Please refresh the page.');
                    }
                }, 100);
                return;
            }
            
            this.setupEventListeners();
            this.loadBatches();
        },
        setupEventListeners: function () {
            const scope = this;
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
        
        showAddProductionModal: function () {
            console.log('[Oil Production] Opening production sheet modal...');
            
            // Check if modal exists in DOM
            const modalElement = document.getElementById('oilProductionModal');
            if (!modalElement) {
                console.error('[Oil Production] Modal element not found in DOM!');
                console.log('[Oil Production] Available modals:', document.querySelectorAll('.modal').length);
                Swal.fire({
                    icon: 'error',
                    title: 'Modal Not Found',
                    text: 'The production sheet form could not be loaded. Please refresh the page (Ctrl+F5) to clear cache.',
                    confirmButtonText: 'OK'
                });
                return;
            }
            
            console.log('[Oil Production] Modal element found, initializing...');
            
            // Set form values
            $('#oilProductionModalLabel').text('New Oil Production Sheet');
            $('#oilBatchId').val('');
            this.clearForm();
            
            // Set default date to today
            const today = new Date().toISOString().split('T')[0];
            $('#productionDate').val(today);
            
            // Use Bootstrap 5 modal API
            try {
                // Check if Bootstrap is available
                if (typeof bootstrap === 'undefined') {
                    console.error('[Oil Production] Bootstrap is not defined!');
                    // Fallback to jQuery if Bootstrap not available
                    $('#oilProductionModal').modal('show');
                } else {
                    const modal = new bootstrap.Modal(modalElement);
                    modal.show();
                    console.log('[Oil Production] Modal shown successfully');
                }
            } catch (error) {
                console.error('[Oil Production] Error showing modal:', error);
                // Fallback to jQuery
                $('#oilProductionModal').modal('show');
            }
        },
        
        clearForm: function () {
            $('#oilProductionForm')[0].reset();
            $('#oilBatchId').val('');
            $('#productName').val('Food grade oil');
            // Clear raw material rows except first
            $('#rawMaterialTableBody tr:not(:first)').remove();
            $('#rawMaterialTableBody tr:first input').val('');
            this.calculateRawMaterialTotals();
        },
        
        addMixRow: function () {
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
        
        addRawMaterialRow: function () {
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
        
        calculateRawMaterialTotals: function () {
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
        
        saveProductionSheet: async function () {
            // Ensure dataFunctions is available
            if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.callFunction !== 'function') {
                console.error('[Oil Production] dataFunctions not available');
                if (typeof Swal !== 'undefined') {
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
                    const modalElement = document.getElementById('oilProductionModal');
                    if (modalElement) {
                        const modal = bootstrap.Modal.getInstance(modalElement);
                        if (modal) modal.hide();
                    }
                    this.loadBatches(true); // Force refresh
                } else {
                    throw new Error(result?.error || result?.message || 'Failed to save production sheet');
                }
            } catch (error) {
                console.error('Error saving production sheet:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to save production sheet: ' + error.message
                });
            }
        },
        loadBatches: async function (forceRefresh = false) {
            try {
                // Ensure dataFunctions is available
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getOilProductionSheets !== 'function') {
                    console.warn('[Oil Production] dataFunctions not available, skipping load');
                    return;
                }
                
                const startTime = performance.now();
                console.log('[Oil Production] Loading batches...');
                
                const batches = await dataFunctions.getOilProductionSheets(null, forceRefresh).catch((error) => {
                    console.error('[Oil Production] Error loading batches:', error);
                    // Don't throw, just return empty array
                    return [];
                });
                
                const loadTime = performance.now() - startTime;
                console.log(`[Oil Production] Batches loaded in ${loadTime.toFixed(2)}ms, count: ${batches ? batches.length : 0}`);
                
                this.batches = batches || [];
                this.renderBatches();
            } catch (error) {
                console.error('[Oil Production] Error loading oil production sheets:', error);
                // Don't show error alert on initial load if it's just that dataFunctions isn't ready yet
                if (error.message && !error.message.includes('dataFunctions')) {
                    this.showError('Unable to load oil production sheets. Please try again later.');
                }
            }
        },
        renderBatches: function () {
            const tbody = $('#oilBatchesTableBody');
            tbody.empty();
            if (this.batches.length === 0) {
                tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No oil production batches found. Click "New Oil Production Sheet" to create one.</td></tr>');
                return;
            }
            this.batches.forEach(batch => {
                const row = `<tr>
                    <td>${batch.production_date || 'N/A'}</td>
                    <td>${batch.shift || 'N/A'}</td>
                    <td>${batch.batch_number || 'N/A'}</td>
                    <td>${batch.product_name || 'N/A'}</td>
                    <td>${batch.total_oil_litre || '0'}</td>
                    <td><span class="badge bg-info">${batch.status || 'pending'}</span></td>
                    <td>
                        <button class="btn btn-sm btn-outline-primary" onclick="oilProductionGrid.viewBatch('${batch.id}')"><i class="fas fa-eye"></i></button>
                        <button class="btn btn-sm btn-outline-secondary" onclick="oilProductionGrid.editBatch('${batch.id}')"><i class="fas fa-edit"></i></button>
                    </td>
                </tr>`;
                tbody.append(row);
            });
        },
        
        editBatch: function (batchId) {
            // Load batch data and populate form
            const batch = this.batches.find(b => b.id === batchId);
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
                const modalElement = document.getElementById('oilProductionModal');
                if (modalElement) {
                    const modal = new bootstrap.Modal(modalElement);
                    modal.show();
                }
            }
        },
        viewBatch: function (batchId) {
            Swal.fire('Info', 'Oil batch details view is under development', 'info');
        },
        showError: function (message) {
            Swal.fire({ icon: 'error', title: 'Error', text: message });
        },
        exportBatches: function () {
            if (!this.batches || this.batches.length === 0) {
                Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            
            const columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'input_material', label: 'Input Material' },
                { key: 'input_quantity_kg', label: 'Input Quantity (kg)' },
                { key: 'oil_produced_l', label: 'Oil Produced (L)' },
                { key: 'status', label: 'Status' }
            ];
            
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(this.batches, 'oil_production_batches', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();
const oilProductionGrid = _oilProductionGrid;
function initializeOilProductionGrid() {
    console.log('Initializing Oil Production Grid...');
    if (typeof oilProductionGrid !== 'undefined') {
        // Wait a bit for DOM to be ready
        setTimeout(() => {
            oilProductionGrid.init();
            console.log('Oil Production Grid initialized');
            
            // Verify button exists
            const btn = document.getElementById('addOilBatchBtn');
            if (btn) {
                console.log('Add Oil Production button found in DOM');
            } else {
                console.error('Add Oil Production button NOT found in DOM!');
            }
            
            // Verify modal exists
            const modal = document.getElementById('oilProductionModal');
            if (modal) {
                console.log('Oil Production modal found in DOM');
            } else {
                console.error('Oil Production modal NOT found in DOM!');
            }
        }, 200);
    } else {
        console.error('oilProductionGrid is undefined!');
    }
}

