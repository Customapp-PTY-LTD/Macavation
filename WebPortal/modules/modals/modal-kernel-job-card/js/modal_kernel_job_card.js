/**
 * Modal: Kernel Job Card – form, sound kernel/butter grade rows, calculations, save.
 * Logic carried over from modules/kernel-production/js/kernel_production_job_card.js
 */
var _modal_kernel_job_card = function () {
    'use strict';
    return {
        init: () => {
            const scope = _modal_kernel_job_card;

            _appRouter.loadBreadCrumbs('#breadcrumb-container');

            $('#saveJobCardBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.saveJobCard();
            });
            $('#addSoundKernelRow').off('click').on('click', function () { scope.addSoundKernelRow(); });
            $('#addButterGradeRow').off('click').on('click', function () { scope.addButterGradeRow(); });
            $(document).on('click', '.removeSoundKernelRow', function () {
                $(this).closest('tr').remove();
                scope.calculateJobCardTotals();
            });
            $(document).on('click', '.removeButterGradeRow', function () {
                $(this).closest('tr').remove();
                scope.calculateJobCardTotals();
            });
            $('#jobCardTotalWeight, #jobCardRemovedPreSizer').on('input', function () { scope.calculateBalance(); });
            $('#jobCardReceivingMoisture, #jobCardPackingMoisture').on('input', function () { scope.calculateRemovedMoisture(); });
            $(document).on('input', '#soundKernelTableBody input, #butterGradeTableBody input', function () { scope.calculateJobCardTotals(); });
            $(document).on('input', '#jobCardWasteOilKernel, #jobCardWasteSaltPepper, #jobCardWasteShellFines, #jobCardWasteCompost, #jobCardWasteShell', function () { scope.calculateMassBalance(); });
            $('#kernelJobCardModal').on('hidden.bs.modal', () => scope.clearJobCardForm());
        },

        setJobCardField: (id, value) => {
            var $el = $('#' + id);
            if (!$el.length) return;
            var el = $el[0];
            if (el.type === 'checkbox') {
                el.checked = value === true || value === 'true' || value === 1 || value === '1';
            } else {
                $el.val(value != null && value !== '' ? String(value) : '');
            }
        },

        populateJobCardFormFromData: (jc) => {
            const scope = _modal_kernel_job_card;
            var fmtDate = function (v) {
                if (!v) return '';
                var s = typeof v === 'string' ? v : (v.toString && v.toString());
                return s.indexOf('T') >= 0 ? s.split('T')[0] : s;
            };
            scope.setJobCardField('jobCardBatchNumber', jc.batch_number);
            scope.setJobCardField('jobCardReceivedDate', fmtDate(jc.received_date));
            scope.setJobCardField('jobCardSupplierName', jc.supplier_name);
            if (jc.supplier_id != null && jc.supplier_id !== '') scope.setJobCardField('jobCardSupplier', jc.supplier_id);
            scope.setJobCardField('jobCardTotalWeight', jc.total_weight_kg);
            scope.setJobCardField('jobCardRemovedPreSizer', jc.removed_pre_sizer_kg);
            scope.setJobCardField('jobCardBalance', jc.balance_kg);
            scope.setJobCardField('jobCardReceivingMoisture', jc.receiving_moisture_percentage);
            scope.setJobCardField('jobCardPackingMoisture', jc.packing_moisture_percentage);
            scope.setJobCardField('jobCardRemovedMoisture', jc.removed_moisture_percentage);
            scope.setJobCardField('jobCardPackingStartDate', fmtDate(jc.packing_start_date));
            scope.setJobCardField('jobCardPackingCompletionDate', fmtDate(jc.packing_completion_date));
            scope.setJobCardField('jobCardBestBeforeDate', fmtDate(jc.best_before_date));
            scope.setJobCardField('jobCardWasteOilKernel', jc.waste_oil_kernel_kg);
            scope.setJobCardField('jobCardWasteSaltPepper', jc.waste_salt_pepper_kg);
            scope.setJobCardField('jobCardWasteShellFines', jc.waste_shell_fines_kg);
            scope.setJobCardField('jobCardWasteCompost', jc.waste_compost_kg);
            scope.setJobCardField('jobCardWasteShell', jc.waste_shell_kg);
            scope.setJobCardField('jobCardMassBalanceIn', jc.mass_balance_in_kg);
            scope.setJobCardField('jobCardMassBalanceOut', jc.mass_balance_out_kg);
            scope.setJobCardField('jobCardMassBalancePercentage', jc.mass_balance_percentage);
            var sk = jc.sound_kernel_styles;
            if (typeof sk === 'string') { try { sk = JSON.parse(sk); } catch (e) { sk = null; } }
            if (sk && Array.isArray(sk) && sk.length > 0) {
                var $tbody = $('#soundKernelTableBody');
                $tbody.empty();
                sk.forEach(function (row) {
                    var tr = '<tr><td><select class="form-select form-select-sm" name="style"><option value="">Select Style</option><option value="SP">SP</option><option value="0">0</option><option value="1">1</option><option value="1S">1S</option><option value="4L">4L</option><option value="5">5</option><option value="6">6</option></select></td><td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td><td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td><td><button type="button" class="btn btn-sm btn-danger removeSoundKernelRow"><i class="fas fa-times"></i></button></td></tr>';
                    var $row = $(tr);
                    $row.find('select[name="style"]').val(row.style || '');
                    $row.find('input[name="cartons"]').val(row.cartons != null ? row.cartons : 0);
                    $row.find('input[name="weight_kg"]').val(row.weight_kg != null ? row.weight_kg : 0);
                    $tbody.append($row);
                });
            }
            var bg = jc.butter_grade_styles;
            if (typeof bg === 'string') { try { bg = JSON.parse(bg); } catch (e) { bg = null; } }
            if (bg && Array.isArray(bg) && bg.length > 0) {
                var $tbody = $('#butterGradeTableBody');
                $tbody.empty();
                bg.forEach(function (row) {
                    var tr = '<tr><td><select class="form-select form-select-sm" name="style"><option value="">Select Style</option><option value="7/8">7/8</option><option value="Butter High Oil (Floaters)">Butter High Oil (Floaters)</option><option value="Butter Low Oil (Sinkers)">Butter Low Oil (Sinkers)</option></select></td><td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td><td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td><td><button type="button" class="btn btn-sm btn-danger removeButterGradeRow"><i class="fas fa-times"></i></button></td></tr>';
                    var $row = $(tr);
                    $row.find('select[name="style"]').val(row.style || '');
                    $row.find('input[name="cartons"]').val(row.cartons != null ? row.cartons : 0);
                    $row.find('input[name="weight_kg"]').val(row.weight_kg != null ? row.weight_kg : 0);
                    $tbody.append($row);
                });
            }
            scope.calculateJobCardTotals();
        },

        prefillJobCardFromProductionStages: (s) => {
            const scope = _modal_kernel_job_card;
            if (!s) return;
            var crack = s.cracking_data || {};
            var pack = s.packing_data || {};
            var sum = s.summary_data || {};
            if (crack.date) scope.setJobCardField('jobCardReceivedDate', crack.date.toString().split('T')[0]);
            if (crack.grower) scope.setJobCardField('jobCardSupplierName', crack.grower);
            if (crack.batch1) scope.setJobCardField('jobCardBatchNumber', crack.batch1);
            if (pack.date) {
                var d = pack.date.toString().split('T')[0];
                scope.setJobCardField('jobCardPackingStartDate', d);
                scope.setJobCardField('jobCardPackingCompletionDate', d);
            }
            var totalQty = sum.pack_total_qty || sum.crack_qty;
            if (totalQty != null && totalQty !== '') scope.setJobCardField('jobCardTotalWeight', totalQty);
            scope.calculateBalance();
            scope.calculateRemovedMoisture();
            scope.calculateJobCardTotals();
        },

        showJobCardModal: () => {
            const scope = _modal_kernel_job_card;
            $('#kernelJobCardModalLabel').text('Kernel Production Job Card');
            $('#jobCardId').val('');
            $('#jobCardProductionBatchId').val('');
            scope.clearJobCardForm();
            $('#jobCardReceivedDate').val(new Date().toISOString().split('T')[0]);
            var p = dataFunctions.getContacts && dataFunctions.getContacts();
            (p || Promise.resolve([])).then(function (contacts) {
                var html = '<option value="">Select Supplier</option>';
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach(function (contact) {
                        var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        html += '<option value="' + contact.id + '">' + name + '</option>';
                    });
                }
                $('#jobCardSupplier').html(html);
            }).catch(function () {}).then(function () {
                var modalEl = document.getElementById('kernelJobCardModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
                else $('#kernelJobCardModal').modal('show');
            });
        },

        showJobCardModalForBatch: (batchId) => {
            const scope = _modal_kernel_job_card;
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            scope.clearJobCardForm();
            $('#jobCardId').val(batch.hasJobCard && batch.jobCardId ? batch.jobCardId : '');
            $('#jobCardProductionBatchId').val(batchId);
            $('#jobCardBatchNumber').val(batch.batch_number || '');
            $('#jobCardReceivedDate').val(batch.received_date ? batch.received_date.toString().split('T')[0] : '');
            $('#jobCardSupplierName').val(batch.grower_name || '');
            if (!batch.received_date) $('#jobCardReceivedDate').val(new Date().toISOString().split('T')[0]);
            var p = dataFunctions.getContacts && dataFunctions.getContacts();
            (p || Promise.resolve([])).then(function (contacts) {
                var html = '<option value="">Select Supplier</option>';
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach(function (contact) {
                        var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        var selected = batch.supplier_id && contact.id === batch.supplier_id ? ' selected' : '';
                        html += '<option value="' + contact.id + '"' + selected + '>' + name + '</option>';
                    });
                }
                $('#jobCardSupplier').html(html);
                if (batch.hasJobCard && batch.jobCardId) {
                    return (dataFunctions.getKernelJobCard && dataFunctions.getKernelJobCard(batch.jobCardId)) || Promise.resolve(null);
                }
                if (batch.productionDays && batch.productionDays[0] && batch.productionDays[0].kernel_production_stages_id) {
                    return (dataFunctions.getKernelProductionStages && dataFunctions.getKernelProductionStages(batch.productionDays[0].kernel_production_stages_id)) || Promise.resolve(null);
                }
                return Promise.resolve(null);
            }).then(function (jcOrStages) {
                if (jcOrStages && jcOrStages.batch_number) scope.populateJobCardFormFromData(jcOrStages);
                else if (jcOrStages && jcOrStages.cracking_data) scope.prefillJobCardFromProductionStages(jcOrStages);
            }).then(function () {
                var modalEl = document.getElementById('kernelJobCardModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
                else $('#kernelJobCardModal').modal('show');
            }).catch((e) => { console.error(e); });
        },

        clearJobCardForm: () => {
            const scope = _modal_kernel_job_card;
            var $form = $('#kernelJobCardForm');
            if ($form.length) $form[0].reset();
            $('#jobCardId').val('');
            $('#soundKernelTableBody tr:gt(0)').remove();
            $('#soundKernelTableBody tr:first input, #soundKernelTableBody tr:first select').val('');
            $('#butterGradeTableBody tr:gt(0)').remove();
            $('#butterGradeTableBody tr:first input, #butterGradeTableBody tr:first select').val('');
            scope.calculateJobCardTotals();
        },

        calculateBalance: () => {
            const scope = _modal_kernel_job_card;
            var totalWeight = parseFloat($('#jobCardTotalWeight').val()) || 0;
            var removedPreSizer = parseFloat($('#jobCardRemovedPreSizer').val()) || 0;
            $('#jobCardBalance').val((totalWeight - removedPreSizer).toFixed(2));
            scope.calculateMassBalance();
        },

        calculateRemovedMoisture: () => {
            var receiving = parseFloat($('#jobCardReceivingMoisture').val()) || 0;
            var packing = parseFloat($('#jobCardPackingMoisture').val()) || 0;
            $('#jobCardRemovedMoisture').val((receiving - packing).toFixed(2));
        },

        calculateJobCardTotals: () => {
            const scope = _modal_kernel_job_card;
            var soundCartons = 0, soundKg = 0;
            $('#soundKernelTableBody tr').each(function () {
                soundCartons += parseInt($(this).find('input[name="cartons"]').val(), 10) || 0;
                soundKg += parseFloat($(this).find('input[name="weight_kg"]').val()) || 0;
            });
            $('#soundKernelTotalCartons').text(soundCartons);
            $('#soundKernelTotalKg').text(soundKg.toFixed(2));
            var butterCartons = 0, butterKg = 0;
            $('#butterGradeTableBody tr').each(function () {
                butterCartons += parseInt($(this).find('input[name="cartons"]').val(), 10) || 0;
                butterKg += parseFloat($(this).find('input[name="weight_kg"]').val()) || 0;
            });
            $('#butterGradeTotalCartons').text(butterCartons);
            $('#butterGradeTotalKg').text(butterKg.toFixed(2));
            scope.calculateMassBalance();
        },

        calculateMassBalance: () => {
            var balance = parseFloat($('#jobCardBalance').val()) || 0;
            var soundKg = parseFloat($('#soundKernelTotalKg').text()) || 0;
            var butterKg = parseFloat($('#butterGradeTotalKg').text()) || 0;
            var wasteOil = parseFloat($('#jobCardWasteOilKernel').val()) || 0;
            var wasteSaltPepper = parseFloat($('#jobCardWasteSaltPepper').val()) || 0;
            var wasteShellFines = parseFloat($('#jobCardWasteShellFines').val()) || 0;
            var wasteCompost = parseFloat($('#jobCardWasteCompost').val()) || 0;
            var wasteShell = parseFloat($('#jobCardWasteShell').val()) || 0;
            var totalOut = soundKg + butterKg + wasteOil + wasteSaltPepper + wasteShellFines + wasteCompost + wasteShell;
            $('#jobCardMassBalanceIn').val(balance.toFixed(2));
            $('#jobCardMassBalanceOut').val(totalOut.toFixed(2));
            $('#jobCardMassBalancePercentage').val(balance > 0 ? ((totalOut / balance) * 100).toFixed(2) : '0');
        },

        addSoundKernelRow: () => {
            var row = '<tr><td><select class="form-select form-select-sm" name="style"><option value="">Select Style</option><option value="SP">SP</option><option value="0">0</option><option value="1">1</option><option value="1S">1S</option><option value="4L">4L</option><option value="5">5</option><option value="6">6</option></select></td><td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td><td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td><td><button type="button" class="btn btn-sm btn-danger removeSoundKernelRow"><i class="fas fa-times"></i></button></td></tr>';
            $('#soundKernelTableBody').append(row);
        },

        addButterGradeRow: () => {
            var row = '<tr><td><select class="form-select form-select-sm" name="style"><option value="">Select Style</option><option value="7/8">7/8</option><option value="Butter High Oil (Floaters)">Butter High Oil (Floaters)</option><option value="Butter Low Oil (Sinkers)">Butter Low Oil (Sinkers)</option></select></td><td><input type="number" class="form-control form-control-sm" name="cartons" value="0"></td><td><input type="number" class="form-control form-control-sm" name="weight_kg" step="0.01" value="0"></td><td><button type="button" class="btn btn-sm btn-danger removeButterGradeRow"><i class="fas fa-times"></i></button></td></tr>';
            $('#butterGradeTableBody').append(row);
        },

        saveJobCard: () => {
            const scope = _modal_kernel_job_card;
            var form = $('#kernelJobCardForm')[0];
            if (!form || !form.checkValidity()) {
                if (form) form.reportValidity();
                return;
            }
            var soundKernelStyles = [];
            $('#soundKernelTableBody tr').each(function () {
                var style = $(this).find('select[name="style"]').val();
                var cartons = parseInt($(this).find('input[name="cartons"]').val(), 10) || 0;
                var weight = parseFloat($(this).find('input[name="weight_kg"]').val()) || 0;
                if (style && (cartons > 0 || weight > 0)) soundKernelStyles.push({ style: style, cartons: cartons, weight_kg: weight });
            });
            var butterGradeStyles = [];
            $('#butterGradeTableBody tr').each(function () {
                var style = $(this).find('select[name="style"]').val();
                var cartons = parseInt($(this).find('input[name="cartons"]').val(), 10) || 0;
                var weight = parseFloat($(this).find('input[name="weight_kg"]').val()) || 0;
                if (style && (cartons > 0 || weight > 0)) butterGradeStyles.push({ style: style, cartons: cartons, weight_kg: weight });
            });
            var getVal = function (id) { return $('#' + id).val() || null; };
            var getFloat = function (id) { var v = $('#' + id).val(); return v ? parseFloat(v) : null; };
            var getIntText = function (id) { var v = $('#' + id).text(); return v ? parseInt(v, 10) : null; };
            var getFloatText = function (id) { var v = $('#' + id).text(); return v ? parseFloat(v) : null; };
            var jobCardData = {
                p_batch_number: getVal('jobCardBatchNumber'),
                p_received_date: getVal('jobCardReceivedDate'),
                p_production_batch_id: getVal('jobCardProductionBatchId') || null,
                p_total_weight_kg: getFloat('jobCardTotalWeight'),
                p_supplier_id: getVal('jobCardSupplier') || null,
                p_supplier_name: getVal('jobCardSupplierName') || null,
                p_removed_pre_sizer_kg: getFloat('jobCardRemovedPreSizer'),
                p_balance_kg: getFloat('jobCardBalance'),
                p_receiving_moisture_percentage: getFloat('jobCardReceivingMoisture'),
                p_packing_moisture_percentage: getFloat('jobCardPackingMoisture'),
                p_removed_moisture_percentage: getFloat('jobCardRemovedMoisture'),
                p_packing_start_date: getVal('jobCardPackingStartDate') || null,
                p_packing_completion_date: getVal('jobCardPackingCompletionDate') || null,
                p_best_before_date: getVal('jobCardBestBeforeDate') || null,
                p_sound_kernel_styles: soundKernelStyles.length ? JSON.stringify(soundKernelStyles) : null,
                p_sound_kernel_total_cartons: getIntText('soundKernelTotalCartons'),
                p_sound_kernel_total_kg: getFloatText('soundKernelTotalKg'),
                p_butter_grade_styles: butterGradeStyles.length ? JSON.stringify(butterGradeStyles) : null,
                p_butter_grade_total_cartons: getIntText('butterGradeTotalCartons'),
                p_butter_grade_total_kg: getFloatText('butterGradeTotalKg'),
                p_waste_oil_kernel_kg: getFloat('jobCardWasteOilKernel'),
                p_waste_salt_pepper_kg: getFloat('jobCardWasteSaltPepper'),
                p_waste_shell_fines_kg: getFloat('jobCardWasteShellFines'),
                p_waste_compost_kg: getFloat('jobCardWasteCompost'),
                p_waste_shell_kg: getFloat('jobCardWasteShell'),
                p_mass_balance_in_kg: getFloat('jobCardMassBalanceIn'),
                p_mass_balance_out_kg: getFloat('jobCardMassBalanceOut'),
                p_mass_balance_percentage: getFloat('jobCardMassBalancePercentage'),
                p_auto_update_stock: $('#jobCardAutoUpdateStock').length ? $('#jobCardAutoUpdateStock').prop('checked') : false
            };
            if (getVal('jobCardId')) jobCardData.p_id = getVal('jobCardId');
            (dataFunctions.createKernelJobCard && dataFunctions.createKernelJobCard(jobCardData)).then(function (result) {
                if (result && result.success !== false) {
                    if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Success', text: 'Job card saved successfully', timer: 2000, showConfirmButton: false });
                    var modalEl = document.getElementById('kernelJobCardModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else $('#kernelJobCardModal').modal('hide');
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                } else {
                    throw new Error(result && result.error ? result.error : 'Failed to save');
                }
            }).catch((e) => {
                console.error('[Kernel Production] saveJobCard failed:', e);
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save job card', 'error');
            });
        }
    };
}();
