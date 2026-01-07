/**
 * Kernel Production Grid Module
 * Handles 17-step production workflow
 */
var _kernelProductionGrid = function () {
    return {
        batches: [],
        filteredBatches: [],
        searchTimeout: null,
        init: function () {
            console.log('[Kernel Production] Initializing grid...');
            const scope = this;
            
            // Use MutationObserver to wait for buttons to be added to DOM
            const checkAndInit = () => {
                const addJobCardBtn = document.getElementById('addJobCardBtn');
                if (addJobCardBtn) {
                    console.log('[Kernel Production] Buttons found, setting up event listeners');
                    scope.setupEventListeners();
                    scope.loadBatches();
                } else {
                    console.log('[Kernel Production] Buttons not found yet, retrying...');
                    setTimeout(checkAndInit, 100);
                }
            };
            
            // Start checking
            setTimeout(checkAndInit, 50);
        },
        setupEventListeners: function () {
            const scope = this;
            console.log('[Kernel Production] Setting up event listeners...');
            
            // Check if buttons exist
            const addJobCardBtn = document.getElementById('addJobCardBtn');
            if (!addJobCardBtn) {
                console.warn('[Kernel Production] addJobCardBtn not found!');
                return;
            }
            
            // Remove existing handlers to prevent duplicates (if jQuery is available)
            if (typeof $ !== 'undefined') {
                $('#addBatchBtn').off('click');
                $('#addJobCardBtn').off('click');
                $('#saveJobCardBtn').off('click');
                $('#addSoundKernelRow').off('click');
                $('#addButterGradeRow').off('click');
            }
            
            // Use both native and jQuery event listeners for maximum compatibility
            if (addJobCardBtn) {
                // Native event listener
                addJobCardBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    console.log('[Kernel Production] Job Card button clicked (native)');
                    scope.showJobCardModal();
                });
                
                // jQuery event listener (if available)
                if (typeof $ !== 'undefined') {
                    $('#addJobCardBtn').on('click', function(e) {
                        e.preventDefault();
                        console.log('[Kernel Production] Job Card button clicked (jQuery)');
                        scope.showJobCardModal();
                    });
                }
            }
            
            // Batch button
            const addBatchBtn = document.getElementById('addBatchBtn');
            if (addBatchBtn) {
                addBatchBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[Kernel Production] New Batch button clicked (native)');
                    if (typeof Swal !== 'undefined') {
                        Swal.fire('Info', 'New batch creation coming soon', 'info');
                    } else {
                        alert('New batch creation coming soon');
                    }
                });
                
                // jQuery handler for compatibility
                if (typeof $ !== 'undefined') {
                    $('#addBatchBtn').on('click', function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[Kernel Production] New Batch button clicked (jQuery)');
                        if (typeof Swal !== 'undefined') {
                            Swal.fire('Info', 'New batch creation coming soon', 'info');
                        } else {
                            alert('New batch creation coming soon');
                        }
                    });
                }
            } else {
                console.warn('[Kernel Production] addBatchBtn not found!');
            }
            
            // Export button
            const exportBtn = document.getElementById('exportBatchesBtn');
            if (exportBtn) {
                exportBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('[Kernel Production] Export button clicked (native)');
                    if (typeof scope.exportBatches === 'function') {
                        scope.exportBatches();
                    } else {
                        console.warn('[Kernel Production] exportBatches function not found');
                    }
                });
            } else {
                console.warn('[Kernel Production] exportBatchesBtn not found!');
            }
            
            // Save Job Card button
            const saveJobCardBtn = document.getElementById('saveJobCardBtn');
            if (saveJobCardBtn) {
                saveJobCardBtn.addEventListener('click', function(e) {
                    e.preventDefault();
                    scope.saveJobCard();
                });
            }
            
            // jQuery handlers for compatibility
            if (typeof $ !== 'undefined') {
                $('#saveJobCardBtn').on('click', function (e) {
                    e.preventDefault();
                    scope.saveJobCard();
                });
            }
            
            // Add row buttons - use delegated events for dynamically added elements
            const addSoundKernelBtn = document.getElementById('addSoundKernelRow');
            if (addSoundKernelBtn) {
                addSoundKernelBtn.addEventListener('click', function() {
                    scope.addSoundKernelRow();
                });
            }
            
            const addButterGradeBtn = document.getElementById('addButterGradeRow');
            if (addButterGradeBtn) {
                addButterGradeBtn.addEventListener('click', function() {
                    scope.addButterGradeRow();
                });
            }
            
            // jQuery handlers
            if (typeof $ !== 'undefined') {
                $('#addSoundKernelRow').on('click', function () {
                    scope.addSoundKernelRow();
                });
                $('#addButterGradeRow').on('click', function () {
                    scope.addButterGradeRow();
                });
            }
            // Delegated event handlers for dynamic content (both native and jQuery)
            document.addEventListener('click', function(e) {
                if (e.target.closest('.removeSoundKernelRow')) {
                    e.preventDefault();
                    const row = e.target.closest('tr');
                    if (row) row.remove();
                    scope.calculateJobCardTotals();
                }
                if (e.target.closest('.removeButterGradeRow')) {
                    e.preventDefault();
                    const row = e.target.closest('tr');
                    if (row) row.remove();
                    scope.calculateJobCardTotals();
                }
            });
            
            // Auto-calculate fields - use native and jQuery
            const totalWeightInput = document.getElementById('jobCardTotalWeight');
            const removedPreSizerInput = document.getElementById('jobCardRemovedPreSizer');
            if (totalWeightInput) {
                totalWeightInput.addEventListener('input', () => scope.calculateBalance());
            }
            if (removedPreSizerInput) {
                removedPreSizerInput.addEventListener('input', () => scope.calculateBalance());
            }
            
            const receivingMoistureInput = document.getElementById('jobCardReceivingMoisture');
            const packingMoistureInput = document.getElementById('jobCardPackingMoisture');
            if (receivingMoistureInput) {
                receivingMoistureInput.addEventListener('input', () => scope.calculateRemovedMoisture());
            }
            if (packingMoistureInput) {
                packingMoistureInput.addEventListener('input', () => scope.calculateRemovedMoisture());
            }
            
            // Delegated input handlers for tables
            const soundKernelTable = document.getElementById('soundKernelTable');
            const butterGradeTable = document.getElementById('butterGradeTable');
            if (soundKernelTable) {
                soundKernelTable.addEventListener('input', () => scope.calculateJobCardTotals());
            }
            if (butterGradeTable) {
                butterGradeTable.addEventListener('input', () => scope.calculateJobCardTotals());
            }
            
            // Waste inputs
            const wasteInputs = ['jobCardWasteOilKernel', 'jobCardWasteSaltPepper', 'jobCardWasteShellFines', 'jobCardWasteCompost', 'jobCardWasteShell'];
            wasteInputs.forEach(id => {
                const input = document.getElementById(id);
                if (input) {
                    input.addEventListener('input', () => scope.calculateMassBalance());
                }
            });
            
            // jQuery handlers for compatibility
            if (typeof $ !== 'undefined') {
                $(document).on('click', '.removeSoundKernelRow', function () {
                    $(this).closest('tr').remove();
                    scope.calculateJobCardTotals();
                });
                $(document).on('click', '.removeButterGradeRow', function () {
                    $(this).closest('tr').remove();
                    scope.calculateJobCardTotals();
                });
                $('#jobCardTotalWeight, #jobCardRemovedPreSizer').on('input', function () {
                    scope.calculateBalance();
                });
                $('#jobCardReceivingMoisture, #jobCardPackingMoisture').on('input', function () {
                    scope.calculateRemovedMoisture();
                });
                $(document).on('input', '#soundKernelTableBody input, #butterGradeTableBody input', function () {
                    scope.calculateJobCardTotals();
                });
                $(document).on('input', '#jobCardWasteOilKernel, #jobCardWasteSaltPepper, #jobCardWasteShellFines, #jobCardWasteCompost, #jobCardWasteShell', function () {
                    scope.calculateMassBalance();
                });
                
                // Modal cleanup
                $('#kernelJobCardModal').on('hidden.bs.modal', function () {
                    scope.clearJobCardForm();
                });
            }
            
            // Native modal cleanup
            const kernelJobCardModal = document.getElementById('kernelJobCardModal');
            if (kernelJobCardModal) {
                kernelJobCardModal.addEventListener('hidden.bs.modal', function () {
                    scope.clearJobCardForm();
                });
            }
            
            // Search with debouncing
            $('#searchBatchesInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterBatches();
                }, 300);
            });
            
            // Filters
            $('#filterBatchStatus, #filterBatchStep').on('change', function () {
                scope.filterBatches();
            });
            
            // Clear filters
            $('#clearBatchFiltersBtn').on('click', function () {
                $('#searchBatchesInput').val('');
                $('#filterBatchStatus').val('');
                $('#filterBatchStep').val('');
                scope.filterBatches();
            });
        },
        filterBatches: function () {
            const searchTerm = $('#searchBatchesInput').val().toLowerCase();
            const statusFilter = $('#filterBatchStatus').val();
            const stepFilter = $('#filterBatchStep').val();
            
            this.filteredBatches = this.batches.filter(batch => {
                // Search filter
                const matchesSearch = !searchTerm || 
                    (batch.batch_number && batch.batch_number.toLowerCase().includes(searchTerm)) ||
                    (batch.grower_name && batch.grower_name.toLowerCase().includes(searchTerm)) ||
                    (batch.status && batch.status.toLowerCase().includes(searchTerm));
                
                // Status filter
                const matchesStatus = !statusFilter || batch.status === statusFilter;
                
                // Step filter
                let matchesStep = true;
                if (stepFilter) {
                    const currentStep = batch.current_step || 1;
                    if (stepFilter === '1-5') matchesStep = currentStep >= 1 && currentStep <= 5;
                    else if (stepFilter === '6-10') matchesStep = currentStep >= 6 && currentStep <= 10;
                    else if (stepFilter === '11-15') matchesStep = currentStep >= 11 && currentStep <= 15;
                    else if (stepFilter === '16-17') matchesStep = currentStep >= 16 && currentStep <= 17;
                }
                
                return matchesSearch && matchesStatus && matchesStep;
            });
            
            this.renderBatches();
        },
        loadBatches: async function (forceRefresh = false) {
            try {
                // Ensure dataFunctions is available
                if (typeof dataFunctions === 'undefined' || !dataFunctions || typeof dataFunctions.getProductionBatches !== 'function') {
                    console.warn('[Kernel Production] dataFunctions not available, skipping load');
                    return;
                }
                
                const startTime = performance.now();
                console.log('[Kernel Production] Loading batches...');
                
                const batches = await dataFunctions.getProductionBatches(null, forceRefresh).catch((error) => {
                    console.error('[Kernel Production] Error loading batches:', error);
                    return [];
                });
                
                const loadTime = performance.now() - startTime;
                console.log(`[Kernel Production] Batches loaded in ${loadTime.toFixed(2)}ms, count: ${batches ? batches.length : 0}`);
                
                this.batches = batches || [];
                this.filteredBatches = this.batches;
                this.renderBatches();
            } catch (error) {
                console.error('[Kernel Production] Error loading batches:', error);
            }
        },
        renderBatches: function () {
            const tbody = $('#batchesTableBody');
            tbody.empty();
            if (this.filteredBatches.length === 0) {
                if (this.batches.length === 0) {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>No production batches found. Click "New Production Batch" to create one.</td></tr>');
                } else {
                    tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-filter me-2"></i>No batches match your search criteria. Try adjusting your filters.</td></tr>');
                }
                return;
            }
            this.filteredBatches.forEach(batch => {
                const row = `<tr>
                    <td>${batch.batch_number || 'N/A'}</td>
                    <td>${batch.grower_name || 'N/A'}</td>
                    <td>${batch.received_date || 'N/A'}</td>
                    <td>${batch.wet_nis_received_kg || '0'}</td>
                    <td>${batch.current_step || '1'}/17</td>
                    <td><span class="badge bg-info">${batch.status || 'receiving'}</span></td>
                    <td><button class="btn btn-sm btn-outline-primary" onclick="kernelProductionGrid.viewBatch('${batch.id}')"><i class="fas fa-eye"></i></button></td>
                </tr>`;
                tbody.append(row);
            });
        },
        viewBatch: function (batchId) {
            Swal.fire('Info', 'Batch details view coming soon', 'info');
        },
        
        exportBatches: function () {
            if (!this.batches || this.batches.length === 0) {
                Swal.fire('Info', 'No batches to export', 'info');
                return;
            }
            
            const columns = [
                { key: 'batch_number', label: 'Batch Number' },
                { key: 'grower_name', label: 'Supplier' },
                { key: 'received_date', label: 'Received Date' },
                { key: 'wet_nis_received_kg', label: 'Wet NIS (kg)' },
                { key: 'current_step', label: 'Current Step' },
                { key: 'status', label: 'Status' }
            ];
            
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(this.batches, 'production_batches', columns);
            } else {
                Swal.fire('Error', 'Export utility not available', 'error');
            }
        },
        
        showJobCardModal: async function () {
            try {
                console.log('[Kernel Production] Opening job card modal');
                $('#kernelJobCardModalLabel').text('Kernel Production Job Card');
                $('#jobCardId').val('');
                this.clearJobCardForm();
                
                // Set default date to today
                const today = new Date().toISOString().split('T')[0];
                $('#jobCardReceivedDate').val(today);
                
                // Load suppliers
                try {
                    const contacts = await dataFunctions.getContacts();
                    const select = $('#jobCardSupplier');
                    let html = '<option value="">Select Supplier</option>';
                    if (contacts && Array.isArray(contacts)) {
                        contacts.forEach(contact => {
                            const name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                            html += `<option value="${contact.id}">${name}</option>`;
                        });
                    }
                    select.html(html);
                } catch (error) {
                    console.error('Error loading suppliers:', error);
                }
                
                // Use Bootstrap 5 modal API with fallback
                const modalElement = document.getElementById('kernelJobCardModal');
                if (!modalElement) {
                    console.error('[Kernel Production] Modal element not found!');
                    Swal.fire('Error', 'Modal not found. Please refresh the page.', 'error');
                    return;
                }
                
                if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    const modal = new bootstrap.Modal(modalElement);
                    modal.show();
                    console.log('[Kernel Production] Modal shown via Bootstrap 5');
                } else if (typeof $ !== 'undefined' && $.fn.modal) {
                    $('#kernelJobCardModal').modal('show');
                    console.log('[Kernel Production] Modal shown via jQuery');
                } else {
                    console.error('[Kernel Production] Neither Bootstrap nor jQuery modal available!');
                    Swal.fire('Error', 'Unable to open modal. Please ensure Bootstrap is loaded.', 'error');
                }
            } catch (error) {
                console.error('[Kernel Production] Error showing job card modal:', error);
                Swal.fire('Error', 'Failed to open job card form: ' + error.message, 'error');
            }
        },
        
        clearJobCardForm: function () {
            const form = document.getElementById('kernelJobCardForm');
            if (form) form.reset();
            
            const jobCardId = document.getElementById('jobCardId');
            if (jobCardId) jobCardId.value = '';
            
            // Clear style rows except first
            const soundKernelBody = document.getElementById('soundKernelTableBody');
            if (soundKernelBody) {
                const rows = soundKernelBody.querySelectorAll('tr');
                for (let i = rows.length - 1; i > 0; i--) {
                    rows[i].remove();
                }
                if (rows[0]) {
                    const inputs = rows[0].querySelectorAll('input, select');
                    inputs.forEach(input => input.value = '');
                }
            }
            
            const butterGradeBody = document.getElementById('butterGradeTableBody');
            if (butterGradeBody) {
                const rows = butterGradeBody.querySelectorAll('tr');
                for (let i = rows.length - 1; i > 0; i--) {
                    rows[i].remove();
                }
                if (rows[0]) {
                    const inputs = rows[0].querySelectorAll('input, select');
                    inputs.forEach(input => input.value = '');
                }
            }
            
            this.calculateJobCardTotals();
        },
        
        calculateBalance: function () {
            const totalWeightEl = document.getElementById('jobCardTotalWeight');
            const removedPreSizerEl = document.getElementById('jobCardRemovedPreSizer');
            const balanceEl = document.getElementById('jobCardBalance');
            
            const totalWeight = totalWeightEl ? parseFloat(totalWeightEl.value) || 0 : 0;
            const removedPreSizer = removedPreSizerEl ? parseFloat(removedPreSizerEl.value) || 0 : 0;
            const balance = totalWeight - removedPreSizer;
            
            if (balanceEl) balanceEl.value = balance.toFixed(2);
            this.calculateMassBalance();
        },
        
        calculateRemovedMoisture: function () {
            const receivingEl = document.getElementById('jobCardReceivingMoisture');
            const packingEl = document.getElementById('jobCardPackingMoisture');
            const removedEl = document.getElementById('jobCardRemovedMoisture');
            
            const receiving = receivingEl ? parseFloat(receivingEl.value) || 0 : 0;
            const packing = packingEl ? parseFloat(packingEl.value) || 0 : 0;
            const removed = receiving - packing;
            
            if (removedEl) removedEl.value = removed.toFixed(2);
        },
        
        calculateJobCardTotals: function () {
            // Sound Kernel totals - use native DOM
            const soundKernelBody = document.getElementById('soundKernelTableBody');
            let soundCartons = 0;
            let soundKg = 0;
            
            if (soundKernelBody) {
                const rows = soundKernelBody.querySelectorAll('tr');
                rows.forEach(row => {
                    const cartonsInput = row.querySelector('input[name="cartons"]');
                    const weightInput = row.querySelector('input[name="weight_kg"]');
                    const cartons = cartonsInput ? parseInt(cartonsInput.value) || 0 : 0;
                    const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
                    soundCartons += cartons;
                    soundKg += weight;
                });
            }
            
            const soundCartonsEl = document.getElementById('soundKernelTotalCartons');
            const soundKgEl = document.getElementById('soundKernelTotalKg');
            if (soundCartonsEl) soundCartonsEl.textContent = soundCartons;
            if (soundKgEl) soundKgEl.textContent = soundKg.toFixed(2);
            
            // Butter Grade totals
            const butterGradeBody = document.getElementById('butterGradeTableBody');
            let butterCartons = 0;
            let butterKg = 0;
            
            if (butterGradeBody) {
                const rows = butterGradeBody.querySelectorAll('tr');
                rows.forEach(row => {
                    const cartonsInput = row.querySelector('input[name="cartons"]');
                    const weightInput = row.querySelector('input[name="weight_kg"]');
                    const cartons = cartonsInput ? parseInt(cartonsInput.value) || 0 : 0;
                    const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
                    butterCartons += cartons;
                    butterKg += weight;
                });
            }
            
            const butterCartonsEl = document.getElementById('butterGradeTotalCartons');
            const butterKgEl = document.getElementById('butterGradeTotalKg');
            if (butterCartonsEl) butterCartonsEl.textContent = butterCartons;
            if (butterKgEl) butterKgEl.textContent = butterKg.toFixed(2);
            
            this.calculateMassBalance();
        },
        
        calculateMassBalance: function () {
            const balanceEl = document.getElementById('jobCardBalance');
            const soundKgEl = document.getElementById('soundKernelTotalKg');
            const butterKgEl = document.getElementById('butterGradeTotalKg');
            
            const balance = balanceEl ? parseFloat(balanceEl.value) || 0 : 0;
            const soundKg = soundKgEl ? parseFloat(soundKgEl.textContent) || 0 : 0;
            const butterKg = butterKgEl ? parseFloat(butterKgEl.textContent) || 0 : 0;
            
            const wasteInputs = {
                oil: document.getElementById('jobCardWasteOilKernel'),
                saltPepper: document.getElementById('jobCardWasteSaltPepper'),
                shellFines: document.getElementById('jobCardWasteShellFines'),
                compost: document.getElementById('jobCardWasteCompost'),
                shell: document.getElementById('jobCardWasteShell')
            };
            
            const wasteOil = wasteInputs.oil ? parseFloat(wasteInputs.oil.value) || 0 : 0;
            const wasteSaltPepper = wasteInputs.saltPepper ? parseFloat(wasteInputs.saltPepper.value) || 0 : 0;
            const wasteShellFines = wasteInputs.shellFines ? parseFloat(wasteInputs.shellFines.value) || 0 : 0;
            const wasteCompost = wasteInputs.compost ? parseFloat(wasteInputs.compost.value) || 0 : 0;
            const wasteShell = wasteInputs.shell ? parseFloat(wasteInputs.shell.value) || 0 : 0;
            
            const totalOut = soundKg + butterKg + wasteOil + wasteSaltPepper + wasteShellFines + wasteCompost + wasteShell;
            
            const massBalanceInEl = document.getElementById('jobCardMassBalanceIn');
            const massBalanceOutEl = document.getElementById('jobCardMassBalanceOut');
            const massBalancePctEl = document.getElementById('jobCardMassBalancePercentage');
            
            if (massBalanceInEl) massBalanceInEl.value = balance.toFixed(2);
            if (massBalanceOutEl) massBalanceOutEl.value = totalOut.toFixed(2);
            
            const percentage = balance > 0 ? (totalOut / balance) * 100 : 0;
            if (massBalancePctEl) massBalancePctEl.value = percentage.toFixed(2);
        },
        
        addSoundKernelRow: function () {
            const newRow = `
                <tr>
                    <td>
                        <select class="form-select form-select-sm" name="style">
                            <option value="">Select Style</option>
                            <option value="SP">SP</option>
                            <option value="0">0</option>
                            <option value="1">1</option>
                            <option value="1S">1S</option>
                            <option value="4L">4L</option>
                            <option value="5">5</option>
                            <option value="6">6</option>
                        </select>
                    </td>
                    <td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td>
                    <td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td>
                    <td><button type="button" class="btn btn-sm btn-danger removeSoundKernelRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            const soundKernelBody = document.getElementById('soundKernelTableBody');
            if (soundKernelBody) {
                soundKernelBody.insertAdjacentHTML('beforeend', newRow);
            } else if (typeof $ !== 'undefined') {
                $('#soundKernelTableBody').append(newRow);
            }
        },
        
        addButterGradeRow: function () {
            const newRow = `
                <tr>
                    <td>
                        <select class="form-select form-select-sm" name="style">
                            <option value="">Select Style</option>
                            <option value="7/8">7/8</option>
                            <option value="Butter High Oil (Floaters)">Butter High Oil (Floaters)</option>
                            <option value="Butter Low Oil (Sinkers)">Butter Low Oil (Sinkers)</option>
                        </select>
                    </td>
                    <td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td>
                    <td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td>
                    <td><button type="button" class="btn btn-sm btn-danger removeButterGradeRow"><i class="fas fa-times"></i></button></td>
                </tr>
            `;
            const butterGradeBody = document.getElementById('butterGradeTableBody');
            if (butterGradeBody) {
                butterGradeBody.insertAdjacentHTML('beforeend', newRow);
            } else if (typeof $ !== 'undefined') {
                $('#butterGradeTableBody').append(newRow);
            }
        },
        
        saveJobCard: async function () {
            try {
                console.log('[Kernel Production] Saving job card...');
                const form = $('#kernelJobCardForm')[0];
                if (!form) {
                    Swal.fire('Error', 'Form not found', 'error');
                    return;
                }
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return;
                }
                
                // Collect sound kernel styles - use native DOM
                const soundKernelStyles = [];
                const soundKernelBody = document.getElementById('soundKernelTableBody');
                if (soundKernelBody) {
                    const rows = soundKernelBody.querySelectorAll('tr');
                    rows.forEach(row => {
                        const styleSelect = row.querySelector('select[name="style"]');
                        const cartonsInput = row.querySelector('input[name="cartons"]');
                        const weightInput = row.querySelector('input[name="weight_kg"]');
                        
                        const style = styleSelect ? styleSelect.value : '';
                        const cartons = cartonsInput ? parseInt(cartonsInput.value) || 0 : 0;
                        const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
                        
                        if (style && (cartons > 0 || weight > 0)) {
                            soundKernelStyles.push({
                                style: style,
                                cartons: cartons,
                                weight_kg: weight
                            });
                        }
                    });
                }
                
                // Collect butter grade styles - use native DOM
                const butterGradeStyles = [];
                const butterGradeBody = document.getElementById('butterGradeTableBody');
                if (butterGradeBody) {
                    const rows = butterGradeBody.querySelectorAll('tr');
                    rows.forEach(row => {
                        const styleSelect = row.querySelector('select[name="style"]');
                        const cartonsInput = row.querySelector('input[name="cartons"]');
                        const weightInput = row.querySelector('input[name="weight_kg"]');
                        
                        const style = styleSelect ? styleSelect.value : '';
                        const cartons = cartonsInput ? parseInt(cartonsInput.value) || 0 : 0;
                        const weight = weightInput ? parseFloat(weightInput.value) || 0 : 0;
                        
                        if (style && (cartons > 0 || weight > 0)) {
                            butterGradeStyles.push({
                                style: style,
                                cartons: cartons,
                                weight_kg: weight
                            });
                        }
                    });
                }
                
                // Get form values using native DOM
                const getValue = (id) => {
                    const el = document.getElementById(id);
                    return el ? el.value : null;
                };
                
                const getFloatValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.value ? parseFloat(el.value) : null;
                };
                
                const getIntValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.value ? parseInt(el.value) : null;
                };
                
                const getTextValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.textContent ? parseFloat(el.textContent) : null;
                };
                
                const getIntTextValue = (id) => {
                    const el = document.getElementById(id);
                    return el && el.textContent ? parseInt(el.textContent) : null;
                };
                
                const autoUpdateStockEl = document.getElementById('jobCardAutoUpdateStock');
                
                const jobCardData = {
                    p_batch_number: getValue('jobCardBatchNumber'),
                    p_received_date: getValue('jobCardReceivedDate'),
                    p_total_weight_kg: getFloatValue('jobCardTotalWeight'),
                    p_supplier_id: getValue('jobCardSupplier') || null,
                    p_supplier_name: getValue('jobCardSupplierName') || null,
                    p_removed_pre_sizer_kg: getFloatValue('jobCardRemovedPreSizer'),
                    p_balance_kg: getFloatValue('jobCardBalance'),
                    p_receiving_moisture_percentage: getFloatValue('jobCardReceivingMoisture'),
                    p_packing_moisture_percentage: getFloatValue('jobCardPackingMoisture'),
                    p_removed_moisture_percentage: getFloatValue('jobCardRemovedMoisture'),
                    p_packing_start_date: getValue('jobCardPackingStartDate') || null,
                    p_packing_completion_date: getValue('jobCardPackingCompletionDate') || null,
                    p_best_before_date: getValue('jobCardBestBeforeDate') || null,
                    p_sound_kernel_styles: soundKernelStyles.length > 0 ? JSON.stringify(soundKernelStyles) : null,
                    p_sound_kernel_total_cartons: getIntTextValue('soundKernelTotalCartons'),
                    p_sound_kernel_total_kg: getTextValue('soundKernelTotalKg'),
                    p_butter_grade_styles: butterGradeStyles.length > 0 ? JSON.stringify(butterGradeStyles) : null,
                    p_butter_grade_total_cartons: getIntTextValue('butterGradeTotalCartons'),
                    p_butter_grade_total_kg: getTextValue('butterGradeTotalKg'),
                    p_waste_oil_kernel_kg: getFloatValue('jobCardWasteOilKernel'),
                    p_waste_salt_pepper_kg: getFloatValue('jobCardWasteSaltPepper'),
                    p_waste_shell_fines_kg: getFloatValue('jobCardWasteShellFines'),
                    p_waste_compost_kg: getFloatValue('jobCardWasteCompost'),
                    p_waste_shell_kg: getFloatValue('jobCardWasteShell'),
                    p_mass_balance_in_kg: getFloatValue('jobCardMassBalanceIn'),
                    p_mass_balance_out_kg: getFloatValue('jobCardMassBalanceOut'),
                    p_mass_balance_percentage: getFloatValue('jobCardMassBalancePercentage'),
                    p_auto_update_stock: autoUpdateStockEl ? autoUpdateStockEl.checked : false
                };
                
                console.log('[Kernel Production] Job card data:', jobCardData);
                const result = await dataFunctions.createKernelJobCard(jobCardData);
                console.log('[Kernel Production] Save result:', result);
                
                if (result && result.success !== false) {
                    // Invalidate caches
                    if (typeof dataFunctions !== 'undefined' && dataFunctions.clearCachePattern) {
                        dataFunctions.clearCachePattern('stock_items');
                    }
                    
                    Swal.fire({
                        icon: 'success',
                        title: 'Success',
                        text: 'Kernel production job card saved successfully' + (jobCardData.p_auto_update_stock ? ' and stock updated' : ''),
                        timer: 2000,
                        showConfirmButton: false
                    });
                    
                    // Close modal
                    const modalElement = document.getElementById('kernelJobCardModal');
                    if (modalElement) {
                        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                            const modal = bootstrap.Modal.getInstance(modalElement);
                            if (modal) {
                                modal.hide();
                            } else {
                                const newModal = new bootstrap.Modal(modalElement);
                                newModal.hide();
                            }
                        } else if (typeof $ !== 'undefined' && $.fn.modal) {
                            $('#kernelJobCardModal').modal('hide');
                        }
                    }
                    
                    this.loadBatches(true); // Force refresh
                } else {
                    const errorMsg = result?.error || result?.message || 'Failed to save job card';
                    console.error('[Kernel Production] Save failed:', errorMsg);
                    throw new Error(errorMsg);
                }
            } catch (error) {
                console.error('[Kernel Production] Error saving job card:', error);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'Failed to save job card: ' + (error.message || error.toString())
                });
            }
        }
    };
}();
const kernelProductionGrid = _kernelProductionGrid;
function initializeKernelProductionGrid() {
    console.log('[Kernel Production] Initializing module...');
    if (typeof kernelProductionGrid !== 'undefined') {
        // Wait for DOM to be fully ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function() {
                setTimeout(() => kernelProductionGrid.init(), 100);
            });
        } else {
            setTimeout(() => kernelProductionGrid.init(), 100);
        }
    } else {
        console.error('[Kernel Production] kernelProductionGrid object not defined!');
    }
}

