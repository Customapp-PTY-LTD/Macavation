/**
 * Modal: Kernel Job Card – form, sound kernel/butter grade rows, calculations, save.
 * Packing: Start Date = first production packing date. Best Before Date = Start Date + 18 months (always; never use stored value).
 * Date inputs follow docs/markdown-archive/INSTRUCTIONS-DATE-FLATPICKR.md:
 * - HTML: type="text", class="flatpickr-date", data-input, placeholder dd/mm/yyyy (§3).
 * - Config: dateFormat 'd/m/Y', allowInput: false, disableMobile: true (§6).
 * - Init on modal shown (§5.3). Display: dd/mm/yyyy; API: yyyy-mm-dd (§8).
 */
var _modal_kernel_job_card = (function () {
    'use strict';

    var DEBUG_BEST_BEFORE = false;
    var JOB_CARD_DATE_IDS = ['jobCardReceivedDate', 'jobCardPackingStartDate', 'jobCardPackingCompletionDate', 'jobCardBestBeforeDate'];
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
    var AUTO_SAVE_DELAY_MS = 900;
    var KERNEL_KG_PER_CARTON = 11.34;
    var PACKING_ROW_KG_TO_JOB_CARD_STYLE = [
        { key: 'sk_sp_qty', style: 'SP', group: 'sound' },
        { key: 'sk_0_qty', style: '0', group: 'sound' },
        { key: 'sk_1_qty', style: '1', group: 'sound' },
        { key: 'sk_1s_qty', style: '1S', group: 'sound' },
        { key: 'sk_4l_qty', style: '4L', group: 'sound' },
        { key: 'sk_5_qty', style: '5', group: 'sound' },
        { key: 'sk_6_qty', style: '6', group: 'sound' },
        { key: 'bt_78_qty', style: '7/8', group: 'butter' },
        { key: 'bt_high_qty', style: 'Butter High Oil (Floaters)', group: 'butter' },
        { key: 'bt_low_qty', style: 'Butter Low Oil (Sinkers)', group: 'butter' }
    ];

    /** Module state for packing start and best-before (no DOM reads for Best Before). */
    var _jobCardPackingStartISO = null;
    var _jobCardBestBeforeISO = null;
    var _autoSaveTimer = null;
    /** Skip draft flush when closing after Jobcard approved (avoids racing draft save on hide). */
    var _skipFlushOnHide = false;

    /** §7.1 Convert dd/mm/yyyy → yyyy-mm-dd for API. Pass-through if already ISO. */
    function jobCardToISO(dateStr) {
        if (!dateStr) return null;
        var s = String(dateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(s)) return s.split('T')[0];
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return null;
        var parts = s.split('/');
        return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
    }

    /** §7.2 Convert yyyy-mm-dd (from API) → dd/mm/yyyy for display. */
    function jobCardFromISO(isoStr) {
        if (!isoStr) return '';
        var s = String(isoStr).trim().split('T')[0];
        var parts = s.split('-');
        if (parts.length !== 3 || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return isoStr;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    /** Display date in dd/mm/yyyy; use _common.formatDateDDMMYYYY when available (company standard). */
    function formatDateForDisplay(isoStr) {
        if (!isoStr) return '';
        if (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) return _common.formatDateDDMMYYYY(isoStr);
        return jobCardFromISO(isoStr);
    }

    /** Best Before = 18 MONTHS (not 18 days) after the given ISO date. Returns YYYY-MM-DD or null. */
    function add18MonthsToISO(isoStr) {
        if (!isoStr) return null;
        var s = String(isoStr).trim().split('T')[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        var parts = s.split('-');
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10) - 1;
        var day = parseInt(parts[2], 10);
        if (isNaN(y) || isNaN(m) || isNaN(day)) return null;
        m += 18;
        y += Math.floor(m / 12);
        m = m % 12;
        if (m < 0) { m += 12; y -= 1; }
        var d = new Date(y, m, day);
        if (isNaN(d.getTime())) return null;
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    return {
        init: () => {
            const scope = _modal_kernel_job_card;
            if (typeof _appRouter !== 'undefined' && _appRouter.loadBreadCrumbs) _appRouter.loadBreadCrumbs('#breadcrumb-container');

            $('#kernelJobCardModal').off('shown.bs.modal').on('shown.bs.modal', function () {
                var container = document.getElementById('kernelJobCardModal');
                var inputs = container ? container.querySelectorAll('.flatpickr-date') : [];
                inputs.forEach(function (el) {
                    if (el.id === 'jobCardBestBeforeDate') return;
                    if (el._flatpickr) return;
                    if (typeof flatpickr !== 'undefined') {
                        var opts = Object.assign({}, FLATPICKR_DDMMYYYY);
                        if (el.id === 'jobCardPackingStartDate') {
                            opts.onChange = function (selectedDates) {
                                _jobCardPackingStartISO = selectedDates[0] ? selectedDates[0].toISOString().split('T')[0] : null;
                                _jobCardBestBeforeISO = _jobCardPackingStartISO ? add18MonthsToISO(_jobCardPackingStartISO) : null;
                                scope.syncBestBeforeFromStartDate();
                            };
                        }
                        if (el.value && el.value.trim()) {
                            var iso = jobCardToISO(el.value.trim());
                            if (iso) opts.defaultDate = iso;
                        }
                        var fp = flatpickr(el, opts);
                        if (el.value && el.value.trim() && fp) {
                            var v = el.value.trim();
                            if (/^\d{4}-\d{2}-\d{2}/.test(v)) fp.setDate(v.split('T')[0], false);
                            else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) fp.setDate(v, false, 'd/m/Y');
                        }
                    }
                });
                function applyBestBeforeFromStart() {
                    if (!_jobCardBestBeforeISO || !container) return;
                    var bestEl = container.querySelector('#jobCardBestBeforeDate');
                    if (bestEl) bestEl.value = formatDateForDisplay(_jobCardBestBeforeISO);
                }
                applyBestBeforeFromStart();
                requestAnimationFrame(function () { applyBestBeforeFromStart(); });
                requestAnimationFrame(function () { requestAnimationFrame(applyBestBeforeFromStart); });
            });

            $('#kernelJobCardModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
                _skipFlushOnHide = false;
                scope.clearJobCardForm();
            });
            $('#kernelJobCardModal').off('hide.bs.modal').on('hide.bs.modal', function () {
                if (!_skipFlushOnHide) scope.flushAutoSave();
            });
            scope.initHandlers();
        },

        initHandlers: () => {
            const scope = _modal_kernel_job_card;
            $('#saveJobCardBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.saveJobCard();
            });
            $('#addSoundKernelRow').off('click').on('click', function () { scope.addSoundKernelRow(); });
            $('#addButterGradeRow').off('click').on('click', function () { scope.addButterGradeRow(); });
            $(document).on('click', '.removeSoundKernelRow', function () {
                $(this).closest('tr').remove();
                scope.calculateJobCardTotals();
                scope.refreshStockPreview();
            });
            $(document).on('click', '.removeButterGradeRow', function () {
                $(this).closest('tr').remove();
                scope.calculateJobCardTotals();
                scope.refreshStockPreview();
            });
            $('#jobCardTotalWeight, #jobCardRemovedPreSizer').on('input', function () { scope.calculateBalance(); });
            $('#jobCardReceivingMoisture, #jobCardPackingMoisture').on('input', function () { scope.calculateRemovedMoisture(); });
            $(document).on('input', '#soundKernelTableBody input, #butterGradeTableBody input, #soundKernelTableBody select, #butterGradeTableBody select', function () {
                scope.calculateJobCardTotals();
                scope.refreshStockPreview();
            });
            $(document).on('input', '#jobCardWasteOilKernel, #jobCardWasteShellFines, #jobCardWasteCompost, #jobCardWasteShell', function () { scope.calculateMassBalance(); });
            $(document).on('change', '#jobCardPackingStartDate', function () { scope.syncBestBeforeFromStartDate(); });
            $(document).on('input change', '#kernelJobCardModal :input, #kernelJobCardModal select', function () {
                scope.scheduleAutoSave();
            });
        },

        syncBestBeforeFromStartDate: () => {
            const scope = _modal_kernel_job_card;
            if (!_jobCardPackingStartISO) return;
            _jobCardBestBeforeISO = add18MonthsToISO(_jobCardPackingStartISO);
            if (_jobCardBestBeforeISO) scope.setJobCardField('jobCardBestBeforeDate', _jobCardBestBeforeISO);
        },

        setJobCardField: (id, value) => {
            const scope = _modal_kernel_job_card;
            var $modal = $('#kernelJobCardModal');
            var $el = $modal.length ? $modal.find('#' + id) : $('#' + id);
            if (!$el.length) return;
            var el = $el[0];
            if (el.type === 'checkbox') {
                el.checked = value === true || value === 'true' || value === 1 || value === '1';
            } else {
                var str = value != null && value !== '' ? String(value).trim() : '';
                if (id === 'jobCardPackingStartDate' && str) {
                    var startISOForState = /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(str) ? str.split('T')[0] : jobCardToISO(str);
                    if (startISOForState) {
                        _jobCardPackingStartISO = startISOForState;
                        _jobCardBestBeforeISO = add18MonthsToISO(startISOForState);
                    }
                }
                if (id === 'jobCardBestBeforeDate') {
                    if (_jobCardBestBeforeISO) str = _jobCardBestBeforeISO;
                }
                var displayStr = str;
                if (JOB_CARD_DATE_IDS.indexOf(id) >= 0) {
                    if (str && (/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(str))) displayStr = formatDateForDisplay(str);
                    if (el._flatpickr) {
                        if (str) {
                            if (/^\d{4}-\d{2}-\d{2}/.test(str)) el._flatpickr.setDate(str.split('T')[0], false);
                            else el._flatpickr.setDate(str, false, 'd/m/Y');
                        } else el._flatpickr.clear();
                    } else {
                        $el.val(displayStr || '');
                    }
                } else $el.val(displayStr);
            }
        },

        populateJobCardFormFromData: (jc) => {
            const scope = _modal_kernel_job_card;
            var fmtDate = function (v) {
                if (!v) return '';
                if (typeof v.toISOString === 'function') return v.toISOString().split('T')[0];
                var s = typeof v === 'string' ? v : (v.toString && v.toString());
                return s.indexOf('T') >= 0 ? s.split('T')[0] : s;
            };
            scope.setJobCardField('jobCardBatchNumber', jc.batch_number);
            scope.setJobCardField('jobCardReceivedDate', fmtDate(jc.received_date));
            if (jc.supplier_id != null && jc.supplier_id !== '') scope.setJobCardField('jobCardSupplier', jc.supplier_id);
            scope.setJobCardField('jobCardTotalWeight', jc.total_weight_kg);
            scope.setJobCardField('jobCardRemovedPreSizer', jc.removed_pre_sizer_kg);
            scope.setJobCardField('jobCardBalance', jc.balance_kg);
            scope.setJobCardField('jobCardReceivingMoisture', jc.receiving_moisture_percentage);
            scope.setJobCardField('jobCardPackingMoisture', jc.packing_moisture_percentage);
            scope.setJobCardField('jobCardRemovedMoisture', jc.removed_moisture_percentage);
            scope.setJobCardField('jobCardPackingStartDate', fmtDate(jc.packing_start_date));
            scope.setJobCardField('jobCardPackingCompletionDate', fmtDate(jc.packing_completion_date));
            scope.setJobCardField('jobCardBestBeforeDate', '');
            scope.syncBestBeforeFromStartDate();
            scope.setJobCardField('jobCardWasteOilKernel', jc.waste_oil_kernel_kg);
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
            scope.refreshStockPreview();
        },

        refreshStockPreview: () => {
            if (typeof _kernelJobCardStock === 'undefined' || !_kernelJobCardStock.renderPreviewTable) return;
            _kernelJobCardStock.renderPreviewTable($('#jobCardStockPreviewBody'));
        },

        /** Prefill job card style rows from stock import / historical packing_data (kg per style). */
        buildJobCardDataFromPackingData: (packingData) => {
            var rows = packingData;
            if (typeof rows === 'string') {
                try { rows = JSON.parse(rows); } catch (e) { rows = null; }
            }
            if (!Array.isArray(rows) || !rows.length) return null;
            var kgByStyle = {};
            rows.forEach(function (row) {
                if (!row || typeof row !== 'object') return;
                PACKING_ROW_KG_TO_JOB_CARD_STYLE.forEach(function (def) {
                    var kg = parseFloat(row[def.key]);
                    if (isNaN(kg) || kg <= 0) return;
                    kgByStyle[def.style] = (kgByStyle[def.style] || 0) + kg;
                });
            });
            var sound = [];
            var butter = [];
            Object.keys(kgByStyle).forEach(function (style) {
                var kg = Math.round(kgByStyle[style] * 100) / 100;
                var cartons = Math.round((kg / KERNEL_KG_PER_CARTON) * 100) / 100;
                var entry = { style: style, cartons: cartons, weight_kg: kg };
                var group = 'sound';
                PACKING_ROW_KG_TO_JOB_CARD_STYLE.forEach(function (d) {
                    if (d.style === style) group = d.group;
                });
                if (group === 'butter') butter.push(entry);
                else sound.push(entry);
            });
            if (!sound.length && !butter.length) return null;
            return {
                sound_kernel_styles: sound.length ? sound : null,
                butter_grade_styles: butter.length ? butter : null
            };
        },

        jobCardDataFromPayload: (payload) => {
            if (!payload || typeof payload !== 'object') return null;
            return {
                batch_number: payload.p_batch_number,
                received_date: payload.p_received_date,
                supplier_id: payload.p_supplier_id,
                supplier_name: payload.p_supplier_name,
                total_weight_kg: payload.p_total_weight_kg,
                packing_start_date: payload.p_packing_start_date,
                packing_completion_date: payload.p_packing_completion_date,
                best_before_date: payload.p_best_before_date,
                sound_kernel_styles: payload.p_sound_kernel_styles,
                butter_grade_styles: payload.p_butter_grade_styles,
                waste_oil_kernel_kg: payload.p_waste_oil_kernel_kg,
                waste_shell_fines_kg: payload.p_waste_shell_fines_kg,
                waste_compost_kg: payload.p_waste_compost_kg,
                waste_shell_kg: payload.p_waste_shell_kg
            };
        },

        showJobCardModal: () => {
            const scope = _modal_kernel_job_card;
            $('#kernelJobCardModalLabel').text('Kernel Production Job Card');
            $('#jobCardId').val('');
            $('#jobCardProductionBatchId').val('');
            scope.clearJobCardForm();
            scope.setJobCardField('jobCardReceivedDate', new Date().toISOString().split('T')[0]);
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
            var openForBatch = function (b) {
            if (!b || !b.id) {
                if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Batch not found. On Stock (Kernel), use Send back to production, then refresh Kernel Production.', 'error');
                }
                return;
            }
            var batch = b;
            scope.clearJobCardForm();
            $('#jobCardId').val('');
            $('#jobCardProductionBatchId').val(batchId);
            $('#jobCardBatchNumber').val(batch.batch_number || '');
            scope.setJobCardField('jobCardReceivedDate', batch.received_date ? batch.received_date.toString().split('T')[0] : new Date().toISOString().split('T')[0]);
            // Receiving: Total Weight = Actual from grower intake; Removed Pre-Sizer and Balance filled when detail loads
            if (batch.actual_wet_nis_kg != null && batch.actual_wet_nis_kg !== '') {
                scope.setJobCardField('jobCardTotalWeight', batch.actual_wet_nis_kg);
                scope.calculateBalance();
            }

            // Load contacts + full kernel detail (job_card_data + stage arrays) in parallel
            var getContacts = dataFunctions.getContacts && dataFunctions.getContacts();
            var getDetail = dataFunctions.getKernelBatchDetail(batchId);

            (getContacts || Promise.resolve([])).then(function (contacts) {
                var html = '<option value="">Select Supplier</option>';
                if (contacts && Array.isArray(contacts)) {
                    var batchSupplierId = batch.supplier_id != null && batch.supplier_id !== '' ? String(batch.supplier_id) : null;
                    contacts.forEach(function (contact) {
                        var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        var cid = contact.id != null ? String(contact.id) : '';
                        var selected = batchSupplierId && cid === batchSupplierId ? ' selected' : '';
                        html += '<option value="' + (contact.id || '') + '"' + selected + '>' + name + '</option>';
                    });
                }
                $('#jobCardSupplier').html(html);
                return getDetail;
            }).then(function (detail) {
                var intake = (detail && (detail.intake_data || detail.intakeData)) ? (detail.intake_data || detail.intakeData) : {};
                var moistureResult = null;
                if (intake.moisture && intake.moisture.result != null) moistureResult = intake.moisture.result;
                else if (intake.ziplock_sample) {
                    var zl = intake.ziplock_sample;
                    if (zl.moisture && zl.moisture.result != null) moistureResult = zl.moisture.result;
                    else if (zl.moisture_result != null) moistureResult = zl.moisture_result;
                }
                if (moistureResult != null) {
                    scope.setJobCardField('jobCardReceivingMoisture', moistureResult);
                    scope.calculateRemovedMoisture();
                }

                var qa = (detail && (detail.qa_data || detail.qaData)) ? (detail.qa_data || detail.qaData) : {};
                var packingMoistureResult = null;
                if (qa.moisture_result != null) packingMoistureResult = qa.moisture_result;
                else if (qa.moisture && qa.moisture.result != null) packingMoistureResult = qa.moisture.result;
                if (packingMoistureResult != null) {
                    scope.setJobCardField('jobCardPackingMoisture', packingMoistureResult);
                    scope.calculateRemovedMoisture();
                }

                var jc = detail && detail.job_card_data ? detail.job_card_data : null;
                if (typeof jc === 'string') {
                    try { jc = JSON.parse(jc); } catch (e) { jc = null; }
                }
                var hasSavedJobCard = jc && typeof jc === 'object' && (
                    jc.batch_number || jc.packing_start_date || jc.packing_completion_date ||
                    (Array.isArray(jc.sound_kernel_styles) && jc.sound_kernel_styles.length > 0) ||
                    (Array.isArray(jc.butter_grade_styles) && jc.butter_grade_styles.length > 0)
                );
                if (hasSavedJobCard) {
                    // Populate from saved job_card_data (source of truth)
                    scope.populateJobCardFormFromData(jc);
                } else if (detail && typeof _modal_production_stages !== 'undefined' && _modal_production_stages.buildJobCardPayloadFromBatchAndStages) {
                    // No saved job card — pre-fill from production stage arrays
                    var cracking = Array.isArray(detail.cracking_data) ? detail.cracking_data : [];
                    var washing  = Array.isArray(detail.washing_data)  ? detail.washing_data  : [];
                    var sorting  = Array.isArray(detail.sorting_data)  ? detail.sorting_data  : [];
                    var packing  = Array.isArray(detail.packing_data)  ? detail.packing_data  : [];
                    var maxLen = Math.max(cracking.length, washing.length, sorting.length, packing.length);
                    if (maxLen > 0) {
                        var allStages = [];
                        for (var i = 0; i < maxLen; i++) {
                            allStages.push({ cracking_data: cracking[i] || {}, washing_data: washing[i] || {}, sorting_data: sorting[i] || {}, packing_data: packing[i] || {} });
                        }
                        var payload = _modal_production_stages.buildJobCardPayloadFromBatchAndStages(batchId, batch, allStages);
                        if (payload) {
                            var jcFromPayload = scope.jobCardDataFromPayload(payload);
                            if (jcFromPayload) scope.populateJobCardFormFromData(jcFromPayload);
                        }
                    }
                } else {
                    var packingRows = detail && (detail.packing_data != null ? detail.packing_data : detail.PackingData);
                    var fromPacking = scope.buildJobCardDataFromPackingData(packingRows);
                    if (fromPacking) scope.populateJobCardFormFromData(fromPacking);
                }

                // Receiving: Total Weight = Actual from grower intake; Removed Pre-Sizer from checklist or derived; Balance = Total − Removed
                var actualKg = (detail && (detail.actual_wet_nis_kg != null && detail.actual_wet_nis_kg !== '')) ? detail.actual_wet_nis_kg : (batch.actual_wet_nis_kg != null && batch.actual_wet_nis_kg !== '' ? batch.actual_wet_nis_kg : null);
                var suppliedKg = (detail && (detail.wet_nis_received_kg != null && detail.wet_nis_received_kg !== '')) ? detail.wet_nis_received_kg : (batch.wet_nis_received_kg != null && batch.wet_nis_received_kg !== '' ? batch.wet_nis_received_kg : null);
                var rc = (intake && intake.receiving_checklist) ? intake.receiving_checklist : {};
                var removedPreSizerKg = (rc.removed_pre_sizer_kg != null && rc.removed_pre_sizer_kg !== '') ? rc.removed_pre_sizer_kg : (rc.removedPreSizerKg != null && rc.removedPreSizerKg !== '' ? rc.removedPreSizerKg : null);
                if (actualKg != null) scope.setJobCardField('jobCardTotalWeight', actualKg);
                if (removedPreSizerKg != null) {
                    scope.setJobCardField('jobCardRemovedPreSizer', removedPreSizerKg);
                } else if (suppliedKg != null && actualKg != null) {
                    var supplied = parseFloat(suppliedKg);
                    var actual = parseFloat(actualKg);
                    if (!isNaN(supplied) && !isNaN(actual)) scope.setJobCardField('jobCardRemovedPreSizer', (supplied - actual).toFixed(2));
                }
                scope.calculateBalance();

                var receivingMoistureVal = $('#jobCardReceivingMoisture').val();
                if (moistureResult != null && (!receivingMoistureVal || String(receivingMoistureVal).trim() === '')) {
                    scope.setJobCardField('jobCardReceivingMoisture', moistureResult);
                    scope.calculateRemovedMoisture();
                }
                var packingMoistureVal = $('#jobCardPackingMoisture').val();
                if (packingMoistureResult != null && (!packingMoistureVal || String(packingMoistureVal).trim() === '')) {
                    scope.setJobCardField('jobCardPackingMoisture', packingMoistureResult);
                    scope.calculateRemovedMoisture();
                }
                var supplierVal = $('#jobCardSupplier').val();
                var supplierIdFromBatchOrDetail = (detail && (detail.supplier_id != null && detail.supplier_id !== '')) ? detail.supplier_id : (batch.supplier_id != null && batch.supplier_id !== '' ? batch.supplier_id : null);
                if (supplierIdFromBatchOrDetail != null && (!supplierVal || String(supplierVal).trim() === '')) {
                    scope.setJobCardField('jobCardSupplier', supplierIdFromBatchOrDetail);
                }
            }).then(function () {
                var modalEl = document.getElementById('kernelJobCardModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
                else $('#kernelJobCardModal').modal('show');
            }).catch(function (e) {
                console.error(e);
            });
            };
            if (batch) {
                openForBatch(batch);
                return;
            }
            if (typeof dataFunctions !== 'undefined' && dataFunctions.getKernelBatchDetail) {
                dataFunctions.getKernelBatchDetail(batchId, null, true).then(function (detail) {
                    var row = detail;
                    if (row && typeof dataFunctions.normalizeKernelBatchDetailRow === 'function') {
                        row = dataFunctions.normalizeKernelBatchDetailRow(detail);
                    }
                    openForBatch(Object.assign({ id: batchId }, row || {}));
                }).catch(function () {
                    openForBatch(null);
                });
                return;
            }
            openForBatch(null);
        },

        clearJobCardForm: () => {
            const scope = _modal_kernel_job_card;
            _jobCardPackingStartISO = null;
            _jobCardBestBeforeISO = null;
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
            var wasteShellFines = parseFloat($('#jobCardWasteShellFines').val()) || 0;
            var wasteCompost = parseFloat($('#jobCardWasteCompost').val()) || 0;
            var wasteShell = parseFloat($('#jobCardWasteShell').val()) || 0;
            var totalOut = soundKg + butterKg + wasteOil + wasteShellFines + wasteCompost + wasteShell;
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

        _buildJobCardPayload: () => {
            var parseNum = function (val) {
                if (typeof _kernelJobCardStock !== 'undefined' && _kernelJobCardStock.parseLocaleNumber) {
                    return _kernelJobCardStock.parseLocaleNumber(val);
                }
                var s = String(val == null ? '' : val).trim().replace(/\s/g, '').replace(',', '.');
                var n = parseFloat(s);
                return isNaN(n) ? 0 : n;
            };
            var styleRows = (typeof _kernelJobCardStock !== 'undefined' && _kernelJobCardStock.collectStyleRowsFromDom)
                ? _kernelJobCardStock.collectStyleRowsFromDom()
                : null;
            var soundKernelStyles = styleRows ? (styleRows.sound_kernel_styles || []) : [];
            var butterGradeStyles = styleRows ? (styleRows.butter_grade_styles || []) : [];
            if (!styleRows) {
                $('#soundKernelTableBody tr').each(function () {
                    var style = $(this).find('select[name="style"]').val();
                    var cartons = parseInt($(this).find('input[name="cartons"]').val(), 10) || 0;
                    var weight = parseNum($(this).find('input[name="weight_kg"]').val());
                    if (style && (cartons > 0 || weight > 0)) soundKernelStyles.push({ style: style, cartons: cartons, weight_kg: weight });
                });
                $('#butterGradeTableBody tr').each(function () {
                    var style = $(this).find('select[name="style"]').val();
                    var cartons = parseInt($(this).find('input[name="cartons"]').val(), 10) || 0;
                    var weight = parseNum($(this).find('input[name="weight_kg"]').val());
                    if (style && (cartons > 0 || weight > 0)) butterGradeStyles.push({ style: style, cartons: cartons, weight_kg: weight });
                });
            }
            var getVal = function (id) { return $('#' + id).val() || null; };
            var getDateVal = function (id) { var v = getVal(id); return (v && JOB_CARD_DATE_IDS.indexOf(id) >= 0) ? jobCardToISO(v) : v; };
            var getFloat = function (id) {
                var v = $('#' + id).val();
                if (!v) return null;
                var n = parseNum(v);
                return n || null;
            };
            var getIntText = function (id) { var v = $('#' + id).text(); return v ? parseInt(v, 10) : null; };
            var getFloatText = function (id) { var v = $('#' + id).text(); return v ? parseFloat(v) : null; };
            var data = {
                p_batch_number: getVal('jobCardBatchNumber'),
                p_received_date: getDateVal('jobCardReceivedDate'),
                p_production_batch_id: getVal('jobCardProductionBatchId') || null,
                p_total_weight_kg: getFloat('jobCardTotalWeight'),
                p_supplier_id: getVal('jobCardSupplier') || null,
                p_supplier_name: null,
                p_removed_pre_sizer_kg: getFloat('jobCardRemovedPreSizer'),
                p_balance_kg: getFloat('jobCardBalance'),
                p_receiving_moisture_percentage: getFloat('jobCardReceivingMoisture'),
                p_packing_moisture_percentage: getFloat('jobCardPackingMoisture'),
                p_removed_moisture_percentage: getFloat('jobCardRemovedMoisture'),
                p_packing_start_date: getDateVal('jobCardPackingStartDate') || null,
                p_packing_completion_date: getDateVal('jobCardPackingCompletionDate') || null,
                p_best_before_date: getDateVal('jobCardBestBeforeDate') || null,
                p_sound_kernel_styles: soundKernelStyles.length ? soundKernelStyles : null,
                p_sound_kernel_total_cartons: getIntText('soundKernelTotalCartons'),
                p_sound_kernel_total_kg: getFloatText('soundKernelTotalKg'),
                p_butter_grade_styles: butterGradeStyles.length ? butterGradeStyles : null,
                p_butter_grade_total_cartons: getIntText('butterGradeTotalCartons'),
                p_butter_grade_total_kg: getFloatText('butterGradeTotalKg'),
                p_waste_oil_kernel_kg: getFloat('jobCardWasteOilKernel'),
                p_waste_shell_fines_kg: getFloat('jobCardWasteShellFines'),
                p_waste_compost_kg: getFloat('jobCardWasteCompost'),
                p_waste_shell_kg: getFloat('jobCardWasteShell'),
                p_mass_balance_in_kg: getFloat('jobCardMassBalanceIn'),
                p_mass_balance_out_kg: getFloat('jobCardMassBalanceOut'),
                p_mass_balance_percentage: getFloat('jobCardMassBalancePercentage')
            };
            if (getVal('jobCardId')) data.p_id = getVal('jobCardId');
            return data;
        },

        _finishJobCardApprovedUi: (kernelId, inner, stockSynced, hasStyleLines, approvalSucceeded) => {
            const scope = _modal_kernel_job_card;
            var df = (typeof _dataFunctions !== 'undefined' && _dataFunctions) ? _dataFunctions : (typeof dataFunctions !== 'undefined' ? dataFunctions : null);
            if (approvalSucceeded === true) {
                inner = Object.assign({}, inner || {}, { jobcard_approved: true, has_jobcard_approved: true, success: true });
            }
            var isApproved = function (row) {
                return df && df.isKernelJobcardApproved
                    ? df.isKernelJobcardApproved(row)
                    : !!(row && (row.jobcard_approved === true || row.has_jobcard_approved === true));
            };
            var finishApproved = function (row) {
            if (!isApproved(row) && approvalSucceeded !== true) {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'error',
                        title: 'Approval not saved',
                        text: 'The server did not record job card approval. Add at least one style line with cartons or kg, then press Jobcard approved again. If this batch came from Stock, use Send back to production first.'
                    });
                }
                return;
            }
            if (hasStyleLines && !stockSynced && typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'info',
                    title: 'Approved (stock sync pending)',
                    text: 'Job card is approved. Style stock will update when quantities are recognised by the server.',
                    timer: 3500,
                    showConfirmButton: true
                });
            } else if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'Jobcard approved',
                    text: 'The job card button shows a tick. Use Release to stock when the batch is release ready.',
                    timer: 2600,
                    showConfirmButton: false
                });
            }
            if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.patchBatchJobcardApproved) {
                _kernelProductionGrid.patchBatchJobcardApproved(kernelId, true);
            }
            _skipFlushOnHide = true;
            var modalEl = document.getElementById('kernelJobCardModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                bootstrap.Modal.getOrCreateInstance(modalEl).hide();
            } else {
                $('#kernelJobCardModal').modal('hide');
            }
            if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) {
                var reload = _kernelProductionGrid.loadBatches(true);
                if (reload && typeof reload.then === 'function') {
                    reload.then(function () {
                        if (_kernelProductionGrid.patchBatchJobcardApproved) {
                            _kernelProductionGrid.patchBatchJobcardApproved(kernelId, true);
                        }
                    }).catch(function () {});
                }
            }
            };
            if (approvalSucceeded === true || isApproved(inner)) {
                finishApproved(inner);
                return;
            }
            var verifyApproval = function (row, thenFinish) {
                if (isApproved(row)) {
                    thenFinish(row);
                    return;
                }
                if (df && df.getKernelJobcardApprovalMap) {
                    df.getKernelJobcardApprovalMap([kernelId], null).then(function (map) {
                        var key = String(kernelId);
                        if (df.coerceKernelBool(map && map[key])) {
                            thenFinish(Object.assign({}, row || {}, {
                                jobcard_approved: true,
                                has_jobcard_approved: true
                            }));
                        } else {
                            thenFinish(row);
                        }
                    }).catch(function () {
                        thenFinish(row);
                    });
                    return;
                }
                thenFinish(row);
            };
            if (df && df.getKernelBatchDetail) {
                df.getKernelBatchDetail(kernelId, null, true).then(function (detail) {
                    verifyApproval(detail || inner, finishApproved);
                }).catch(function () {
                    verifyApproval(inner, finishApproved);
                });
                return;
            }
            verifyApproval(inner, finishApproved);
        },

        doSaveJobCard: (silent) => {
            _modal_kernel_job_card.doSaveJobCardRun(!!silent, false);
        },

        doSaveJobCardRun: (silent, approve) => {
            const scope = _modal_kernel_job_card;
            if (approve && _autoSaveTimer) {
                clearTimeout(_autoSaveTimer);
                _autoSaveTimer = null;
            }
            var kernelId = $('#jobCardProductionBatchId').val();
            if (!kernelId) {
                if (!silent && typeof Swal !== 'undefined') Swal.fire('Error', 'Batch ID missing. Please reopen the job card from a batch row.', 'error');
                return;
            }
            if (!silent) {
                var form = $('#kernelJobCardForm')[0];
                if (!form || !form.checkValidity()) {
                    if (form) form.reportValidity();
                    return;
                }
            }
            var $status = $('#jobCardAutoSaveStatus');
            if (silent && $status.length) $status.removeClass('text-success text-danger').text('Saving…');
            var jobCardData = scope._buildJobCardPayload();
            var jobCardObj = {};
            Object.keys(jobCardData).forEach(function (k) {
                jobCardObj[k.replace(/^p_/, '')] = jobCardData[k];
            });
            var upsertOpts = approve ? { approved: true } : { draft: true };
            dataFunctions.upsertKernelJobCard(kernelId, jobCardObj, null, upsertOpts).then(function (result) {
                var inner = result;
                if (typeof dataFunctions.unwrapKernelRpcJson === 'function') {
                    inner = dataFunctions.unwrapKernelRpcJson(result, 'upsert_kernel_job_card') || result;
                } else if (result && result.upsert_kernel_job_card) {
                    inner = result.upsert_kernel_job_card;
                }
                if (inner && inner.success === false) throw new Error(inner.error || inner.Error || 'Failed to save');
                var stockSynced = !!(inner && (inner.stock_synced === true || inner.StockSynced === true));
                var hasStyleLines = typeof _kernelJobCardStock !== 'undefined'
                    ? _kernelJobCardStock.hasStockQuantities(jobCardObj)
                    : !!(jobCardObj.sound_kernel_styles || jobCardObj.butter_grade_styles);
                if (silent) {
                    if ($status.length) { $status.removeClass('text-danger').addClass('text-success').text('Saved'); setTimeout(function () { if ($status.length) $status.text(''); }, 2000); }
                } else if (approve) {
                    scope._finishJobCardApprovedUi(kernelId, inner, stockSynced, hasStyleLines, true);
                }
            }).catch(function (e) {
                console.error('[Kernel Job Card] save failed:', e);
                if ($status.length) { $status.removeClass('text-success').addClass('text-danger').text('Save failed'); }
                if (!silent && typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save job card', 'error');
            });
        },

        saveJobCard: () => {
            _modal_kernel_job_card.doSaveJobCardRun(false, true);
        },

        scheduleAutoSave: () => {
            var kernelId = $('#jobCardProductionBatchId').val();
            if (!kernelId) return;
            if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
            _autoSaveTimer = setTimeout(function () {
                _autoSaveTimer = null;
                _modal_kernel_job_card.doSaveJobCard(true);
            }, AUTO_SAVE_DELAY_MS);
        },

        flushAutoSave: () => {
            if (_autoSaveTimer) {
                clearTimeout(_autoSaveTimer);
                _autoSaveTimer = null;
                _modal_kernel_job_card.doSaveJobCard(true);
            }
        }
    };
}());
_modal_kernel_job_card.init();
