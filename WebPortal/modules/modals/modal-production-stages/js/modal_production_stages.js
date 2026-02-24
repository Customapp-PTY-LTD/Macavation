/**
 * Modal: Production Stages – owns all Production modal behaviour (Cracking/Washing/Sorting/Packing/Summary).
 * Logic moved from modules/kernel-production/js/kernel_production_stages.js.
 * Grid only routes here via _modal_production_stages.showProductionStagesModalForBatch(batchId).
 */
var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };
function toISO(dateStr) {
    if (!dateStr || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(String(dateStr).trim())) return dateStr || null;
    var parts = String(dateStr).trim().split('/');
    return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');
}
function fromISO(isoStr) {
    if (!isoStr) return '';
    var s = String(isoStr).split('T')[0];
    var parts = s.split('-');
    if (parts.length !== 3) return isoStr;
    return parts[2] + '/' + parts[1] + '/' + parts[0];
}

/** Best Before = 18 MONTHS (not 18 days) after ISO date. Returns YYYY-MM-DD or null. */
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

/** Return YYYY-MM-DD from stages (first found: crack, wash, sort, pack). Used when comparing to a single day's date. */
function getStagesEffectiveDate(stages) {
    if (!stages || typeof stages !== 'object') return null;
    var c = (stages.cracking_data && typeof stages.cracking_data === 'object') ? stages.cracking_data : {};
    var w = (stages.washing_data && typeof stages.washing_data === 'object') ? stages.washing_data : {};
    var s = (stages.sorting_data && typeof stages.sorting_data === 'object') ? stages.sorting_data : {};
    var p = (stages.packing_data && typeof stages.packing_data === 'object') ? stages.packing_data : {};
    var raw = c.date || w.date || s.date || p.date;
    if (raw && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
    return null;
}

/** Unwrap API response to stages object (cracking_data, washing_data, etc.). */
function unwrapStages(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.cracking_data !== undefined || raw.washing_data !== undefined) return raw;
    if (raw.get_kernel_production_stages_by_day != null) return raw.get_kernel_production_stages_by_day;
    if (raw.get_kernel_production_stages != null) return raw.get_kernel_production_stages;
    if (Array.isArray(raw) && raw[0]) return unwrapStages(raw[0]);
    return raw;
}

/** Return the latest (most recent) YYYY-MM-DD in stages. Used to choose which production day to save to when form has multiple dates (e.g. packing on 21st, other sections on 19th/20th). */
function getStagesLatestDate(stages) {
    if (!stages || typeof stages !== 'object') return null;
    var c = (stages.cracking_data && typeof stages.cracking_data === 'object') ? stages.cracking_data : {};
    var w = (stages.washing_data && typeof stages.washing_data === 'object') ? stages.washing_data : {};
    var s = (stages.sorting_data && typeof stages.sorting_data === 'object') ? stages.sorting_data : {};
    var p = (stages.packing_data && typeof stages.packing_data === 'object') ? stages.packing_data : {};
    var dates = [c.date, w.date, s.date, p.date].filter(function (raw) {
        return raw && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw);
    });
    if (dates.length === 0) return null;
    dates.sort();
    return dates[dates.length - 1];
}

/**
 * Derive summary_data from the four stage blobs (Cracking/Washing/Sorting/Packing).
 * Used on save so Summary is always computed; also for timeline snippets.
 * Field mapping: see Summary tab IDs (ps_sum_*) in modal_production_stages.html.
 */
function deriveSummaryFromStages(cracking_data, washing_data, sorting_data, packing_data) {
    var c = cracking_data || {};
    var w = washing_data || {};
    var s = sorting_data || {};
    var p = packing_data || {};
    var num = function (v) { var n = parseFloat(v); return isNaN(n) ? '' : n; };
    var str = function (v) { return v != null && v !== '' ? String(v) : ''; };
    return {
        crack_time: str(c.timespent1 || c.totaltime),
        crack_qty: num(c.totalqty),
        wholes: num(c.avg_wholes),
        uncracks: num(c.avg_uncracks),
        shell_waste: num(c.shell_total),
        wash_qty_in: num(w.qty_in),
        wash_floater_qty: num(w.floater_qty),
        wash_sinker_qty: num(w.sinker_qty),
        wash_total_qty: num(w.total_qty),
        wash_shellfines: num(w.waste_shellfines),
        wash_compost: num(w.waste_compost),
        sort_floater_in: num(s.floater_qty_in),
        sort_sound_qty: num(s.sound_qty),
        sort_sinker_in: num(s.sinker_qty_in),
        sort_butterlow_qty: num(s.butterlow_qty),
        sort_oil_waste: num(s.oil_qty),
        sort_compost_waste: num(s.compost_qty),
        pack_sound_qty: num(p.sk_total_qty),
        pack_unsound_qty: num(p.bt_total_qty),
        pack_total_qty: num(p.totals_qty)
    };
}

var _modal_production_stages = (function () {
    'use strict';
    return {
        modalProductionDays: null,
        modalProductionDayStages: null,
        currentProductionAction: null,
        productionActionMap: {
            crack: { section: 'crack', paneId: 'pane-cracking', dataKey: 'cracking_data' },
            wash: { section: 'wash', paneId: 'pane-washing', dataKey: 'washing_data' },
            sort: { section: 'sort', paneId: 'pane-sorting', dataKey: 'sorting_data' },
            pack: { section: 'pack', paneId: 'pane-packing', dataKey: 'packing_data' }
        },

        init: () => {
            const scope = _modal_production_stages;
            $('#productionStagesTabs').off('shown.bs.tab').on('shown.bs.tab', function (e) {
                var newTabId = (e.target && e.target.id) ? e.target.id : ($(e.target).attr && $(e.target).attr('id'));
                if (newTabId && scope.tabIdToSection[newTabId]) {
                    scope.persistCurrentTabToStages();
                    scope.currentTabSection = scope.tabIdToSection[newTabId];
                    scope.updateProductionActionButtonTicks();
                    var batchId = $('#productionStagesBatchId').val();
                    var tabName = newTabId.replace('tab-', '');
                    if (batchId && tabName) {
                        try { localStorage.setItem('kernelProduction_lastTab_' + batchId, tabName); } catch (err) {}
                    }
                }
            });
            $('#saveProductionStagesBtnSingle, #saveProductionStagesBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.saveProductionStages();
            });
            $('#batchSummaryBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.showBatchSummary();
            });
            $('#finishBatchProductionBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.finishBatchProduction();
            });
            $(document).on('change input', '#ps_crack_start1, #ps_crack_end1', function () {
                scope.updateCrackTimeSpentRow(1);
            });
            $(document).on('change input', '#ps_crack_startqty1, #ps_crack_endqty1', function () {
                scope.updateCrackSiloQty();
            });
            $(document).on('change input', '#ps_wash_waste_shellfines, #ps_wash_waste_compost', function () {
                scope.updateWashWasteTotal();
            });
            $(document).on('change input', '#ps_crack_timespent1', function () {
                scope.syncCrackTimeToSummary();
            });
            $('#productionStagesModal').off('shown.bs.modal').on('shown.bs.modal', function () {
                var container = document.getElementById('productionStagesModal');
                var inputs = container ? container.querySelectorAll('.flatpickr-date') : [];
                var todayPlaceholder = fromISO(new Date().toISOString().split('T')[0]);
                inputs.forEach(function (el) {
                    if (el._flatpickr) return;
                    if (typeof flatpickr !== 'undefined') {
                        flatpickr(el, FLATPICKR_DDMMYYYY);
                        if (!el.value && todayPlaceholder) el.placeholder = todayPlaceholder;
                    }
                });
            });
            $('#productionStagesModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
                var batchId = $('#productionStagesBatchId').val();
                if (batchId) scope.saveProductionStagesDraftToStorage();
            });
            $(document).on('click', '#productionStagesDayList [data-day-id]', function () {
                var dayId = $(this).attr('data-day-id');
                if (dayId) scope.selectProductionDay(dayId);
            });
            $(document).on('click', '#addProductionDayBtn', function (e) {
                e.preventDefault();
                scope.addProductionDay();
            });
        },

        computeTimeSpent: (startTimeVal, endTimeVal) => {
            if (!startTimeVal || !endTimeVal || typeof startTimeVal !== 'string' || typeof endTimeVal !== 'string') return '';
            var s = startTimeVal.trim().split(':');
            var e = endTimeVal.trim().split(':');
            if (s.length < 2 || e.length < 2) return '';
            var startM = parseInt(s[0], 10) * 60 + parseInt(s[1], 10);
            var endM = parseInt(e[0], 10) * 60 + parseInt(e[1], 10);
            if (isNaN(startM) || isNaN(endM)) return '';
            var diffM = endM - startM;
            if (diffM < 0) diffM += 24 * 60;
            var h = Math.floor(diffM / 60);
            var m = diffM % 60;
            if (h === 0) return m + 'm';
            if (m === 0) return h + 'h';
            return h + 'h ' + m + 'm';
        },

        parseTimeSpentToMinutes: (str) => {
            if (!str || typeof str !== 'string') return 0;
            str = str.trim();
            var total = 0;
            var hMatch = str.match(/(\d+)\s*h/);
            var mMatch = str.match(/(\d+)\s*m/);
            if (hMatch) total += parseInt(hMatch[1], 10) * 60;
            if (mMatch) total += parseInt(mMatch[1], 10);
            return total;
        },

        updateCrackTimeSpentRow: (rowNum) => {
            const scope = _modal_production_stages;
            var startVal = $('#ps_crack_start' + rowNum).val();
            var endVal = $('#ps_crack_end' + rowNum).val();
            var spent = scope.computeTimeSpent(startVal, endVal);
            $('#ps_crack_timespent' + rowNum).val(spent);
            scope.updateCrackTotalTime();
            scope.syncCrackTimeToSummary();
        },

        updateCrackSiloQty: () => {
            var startQty = parseFloat($('#ps_crack_startqty1').val(), 10);
            var endQty = parseFloat($('#ps_crack_endqty1').val(), 10);
            if (isNaN(startQty)) startQty = 0;
            if (isNaN(endQty)) endQty = 0;
            var siloQty = startQty - endQty;
            var siloEl = $('#ps_crack_silo1');
            if (siloQty === 0 && ($('#ps_crack_startqty1').val() === '' || $('#ps_crack_endqty1').val() === '')) {
                siloEl.val('');
            } else {
                siloEl.val(siloQty);
            }
        },

        updateCrackTotalTime: () => {
            const scope = _modal_production_stages;
            var m1 = scope.parseTimeSpentToMinutes($('#ps_crack_timespent1').val());
            var totalM = m1;
            var h = Math.floor(totalM / 60);
            var m = totalM % 60;
            var totalEl = $('#ps_crack_totaltime');
            if (h === 0 && m === 0) totalEl.val('');
            else if (h === 0) totalEl.val(m + 'm');
            else if (m === 0) totalEl.val(h + 'h');
            else totalEl.val(h + 'h ' + m + 'm');
        },

        updateWashWasteTotal: () => {
            var b = parseFloat($('#ps_wash_waste_shellfines').val()) || 0;
            var c = parseFloat($('#ps_wash_waste_compost').val()) || 0;
            var total = b + c;
            $('#ps_wash_waste_total').val(total === 0 ? '' : total);
        },

        syncCrackTimeToSummary: () => {
            var val = $('#ps_crack_timespent1').val();
            $('#ps_sum_crack_time').val(val != null && val !== '' ? val : '');
        },

        getProductionStagesSectionData: (prefix) => {
            var out = {};
            $('[id^="ps_' + prefix + '_"]').each(function () {
                var el = this;
                var key = el.id.replace(new RegExp('^ps_' + prefix + '_'), '');
                var val = el.type === 'checkbox' ? el.checked : (el.value || '');
                if (el.classList && el.classList.contains('flatpickr-date') && val) {
                    val = toISO(val);
                    if (val == null) val = '';
                }
                out[key] = val;
            });
            return out;
        },

        setProductionStagesSectionData: (prefix, data) => {
            const scope = _modal_production_stages;
            if (!data || typeof data !== 'object') return;
            $.each(data, function (key, v) {
                var el = document.getElementById('ps_' + prefix + '_' + key);
                if (el) {
                    if (el.type === 'checkbox') {
                        el.checked = v === true || v === 'true' || v === '1' || v === 1;
} else {
                    if (el.tagName === 'SELECT' && v != null && v !== '') scope.ensureSelectHasOption(el, String(v));
                    else if (el.classList && el.classList.contains('flatpickr-date'))
                        el.value = v != null && v !== '' ? fromISO(String(v)) : '';
                    else
                        el.value = v != null && v !== '' ? String(v) : '';
                }
                }
            });
            if (prefix === 'wash') scope.updateWashWasteTotal();
            if (prefix === 'crack') scope.updateCrackSiloQty();
        },

        ensureSelectHasOption: (selectEl, value) => {
            if (!selectEl || selectEl.tagName !== 'SELECT' || !value) return;
            if ($(selectEl).find('option[value="' + value.replace(/"/g, '&quot;') + '"]').length) return;
            var opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value;
            selectEl.appendChild(opt);
        },

        clearProductionStagesForm: () => {
            $('[id^="ps_"]').each(function () {
                if (this.type === 'checkbox') this.checked = false;
                else this.value = '';
            });
        },

        populateProductionGrowerSelects: (selectedGrowerName) => {
            const scope = _modal_production_stages;
            var ids = [];
            var html = '<option value="">Select grower</option>';
            var p = dataFunctions.getContacts && dataFunctions.getContacts();
            return p ? p.then(function (contacts) {
                if (contacts && Array.isArray(contacts)) {
                    contacts.forEach(function (contact) {
                        var name = contact.company_name || contact.trading_name || contact.primary_contact_name || 'Unknown';
                        if (name) html += '<option value="' + name.replace(/"/g, '&quot;') + '">' + name.replace(/</g, '&lt;') + '</option>';
                    });
                }
                ids.forEach(function (id) {
                    var $el = $('#' + id);
                    if ($el.length && $el[0].tagName === 'SELECT') {
                        $el.html(html);
                        if (selectedGrowerName) {
                            scope.ensureSelectHasOption($el[0], selectedGrowerName);
                            $el.val(selectedGrowerName);
                        }
                    }
                });
            }) : Promise.resolve();
        },

        saveProductionStagesDraftToStorage: () => {
            const scope = _modal_production_stages;
            var batchId = $('#productionStagesBatchId').val();
            if (!batchId) return;
            var crack = scope.getProductionStagesSectionData('crack');
            var wash = scope.getProductionStagesSectionData('wash');
            var sort = scope.getProductionStagesSectionData('sort');
            var pack = scope.getProductionStagesSectionData('pack');
            var draft = {
                cracking_data: crack,
                washing_data: wash,
                sorting_data: sort,
                packing_data: pack,
                summary_data: deriveSummaryFromStages(crack, wash, sort, pack)
            };
            try { localStorage.setItem('kernelProduction_draft_' + batchId, JSON.stringify(draft)); } catch (err) {}
        },

        clearProductionStagesDraft: (batchId) => {
            if (!batchId) return;
            try { localStorage.removeItem('kernelProduction_draft_' + batchId); } catch (err) {}
        },

        restoreProductionStagesDraft: (batchId) => {
            const scope = _modal_production_stages;
            if (!batchId) return;
            var json = null;
            try { json = localStorage.getItem('kernelProduction_draft_' + batchId); } catch (err) { return; }
            if (!json) return;
            var draft;
            try { draft = JSON.parse(json); } catch (e) { return; }
            if (!draft || typeof draft !== 'object') return;
            if (draft.cracking_data) scope.setProductionStagesSectionData('crack', draft.cracking_data);
            if (draft.washing_data) scope.setProductionStagesSectionData('wash', draft.washing_data);
            if (draft.sorting_data) scope.setProductionStagesSectionData('sort', draft.sorting_data);
            if (draft.packing_data) scope.setProductionStagesSectionData('pack', draft.packing_data);
            if (draft.summary_data) scope.modalProductionDayStages = scope.modalProductionDayStages || {};
            if (draft.summary_data) scope.modalProductionDayStages.summary_data = draft.summary_data;
        },

        tabIdToSection: { 'tab-cracking': 'crack', 'tab-washing': 'wash', 'tab-sorting': 'sort', 'tab-packing': 'pack' },
        currentTabSection: 'crack',

        setProductionStagesTabsVisibility: (visible) => {
            const scope = _modal_production_stages;
            $('#productionStagesTabsContainer').css('display', visible ? '' : 'none');
            if (visible) {
                scope.currentTabSection = 'crack';
                scope.updateProductionActionButtonTicks();
            }
        },

        updateProductionActionButtonTicks: () => {
            const scope = _modal_production_stages;
            scope.modalProductionDayStages = scope.modalProductionDayStages || {};
            ['crack', 'wash', 'sort', 'pack'].forEach(function (action) {
                var data = scope.modalProductionDayStages[scope.productionActionMap[action].dataKey];
                var formData = scope.getProductionStagesSectionData(scope.productionActionMap[action].section);
                var hasData = (data && typeof data === 'object' && Object.keys(data).length > 0) ||
                    (formData && typeof formData === 'object' && Object.keys(formData).length > 0);
                var label = action === 'crack' ? 'Cracking' : action === 'wash' ? 'Washing' : action === 'sort' ? 'Sorting' : action === 'pack' ? 'Packing' : 'Summary';
                var $tab = $('#tab-' + (action === 'crack' ? 'cracking' : action === 'wash' ? 'washing' : action === 'sort' ? 'sorting' : 'packing'));
                var $label = $tab.find('.production-tab-label');
                if ($label.length) {
                    $label.text(label);
                }
            });
        },

        persistCurrentTabToStages: () => {
            const scope = _modal_production_stages;
            var map = scope.productionActionMap[scope.currentTabSection];
            if (map && scope.modalProductionDayStages) {
                scope.modalProductionDayStages[map.dataKey] = scope.getProductionStagesSectionData(map.section);
            }
        },

        renderProductionDaysList: (days) => {
            var $container = $('#productionStagesDayList');
            $container.empty();
            (days || []).forEach(function (d, idx) {
                var dayId = d.id || d.kernel_production_day_id;
                var num = d.day_number != null ? d.day_number : (idx + 1);
                if (!dayId) return;
                var html = d.kernel_production_stages_id
                    ? 'Day ' + num + ' <span class="text-success ms-1">&#10003;</span>'
                    : 'Day ' + num;
                $container.append($('<button type="button" class="btn btn-sm btn-outline-secondary" data-day-id="' + dayId + '" data-day-saved="' + (d.kernel_production_stages_id ? '1' : '0') + '">').html(html));
            });
        },

        setProductionDayActive: (dayId) => {
            $('#productionStagesDayList [data-day-id]').each(function () {
                var $btn = $(this);
                var isActive = $btn.attr('data-day-id') === dayId;
                var isSaved = $btn.attr('data-day-saved') === '1';
                $btn.removeClass('btn-primary btn-outline-secondary btn-outline-success');
                if (isActive) $btn.addClass('btn-primary');
                else if (isSaved) $btn.addClass('btn-outline-success');
                else $btn.addClass('btn-outline-secondary');
            });
        },

        loadProductionStagesForDay: (dayId, stagesId) => {
            const scope = _modal_production_stages;
            if (!dayId && !stagesId) return Promise.resolve();
            var p = stagesId ? dataFunctions.getKernelProductionStages(stagesId) : (dayId ? dataFunctions.getKernelProductionStagesByDay(dayId) : Promise.resolve(null));
            return p.then(function (s) {
                var crack = (s && s.cracking_data) ? s.cracking_data : {};
                var wash = (s && s.washing_data) ? s.washing_data : {};
                var sort = (s && s.sorting_data) ? s.sorting_data : {};
                var pack = (s && s.packing_data) ? s.packing_data : {};
                scope.modalProductionDayStages = {
                    cracking_data: crack,
                    washing_data: wash,
                    sorting_data: sort,
                    packing_data: pack,
                    summary_data: s ? deriveSummaryFromStages(crack, wash, sort, pack) : {}
                };
                if (s) {
                    scope.setProductionStagesSectionData('crack', crack);
                    scope.setProductionStagesSectionData('wash', wash);
                    scope.setProductionStagesSectionData('sort', sort);
                    scope.setProductionStagesSectionData('pack', pack);
                } else {
                    scope.clearProductionStagesForm();
                }
            }).catch(function () {
                scope.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
                scope.clearProductionStagesForm();
            });
        },

        selectProductionDay: (dayId) => {
            const scope = _modal_production_stages;
            $('#productionStagesDayId').val(dayId || '');
            var days = scope.modalProductionDays || [];
            var day = days.filter(function (d) { return (d.id || d.kernel_production_day_id) === dayId; })[0];
            scope.loadProductionStagesForDay(dayId, day && day.kernel_production_stages_id).then(function () {
                scope.setProductionDayActive(dayId);
                scope.updateProductionActionButtonTicks();
            });
        },

        addProductionDay: () => {
            const scope = _modal_production_stages;
            var batchId = $('#productionStagesBatchId').val();
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
                return;
            }
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.createKernelProductionDay !== 'function') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Add production day is not available. Please refresh the page.', 'error');
                return;
            }
            dataFunctions.createKernelProductionDay(batchId).then(function (result) {
                var inner = (result && result.create_kernel_production_day) ? result.create_kernel_production_day : result;
                if (!inner || inner.success === false) throw new Error(inner && inner.error ? inner.error : 'Failed to create day');
                var newDayId = inner.id;
                var dayNum = inner.day_number != null ? inner.day_number : ((scope.modalProductionDays || []).length + 1);
                scope.modalProductionDays = scope.modalProductionDays || [];
                scope.modalProductionDays.push({ id: newDayId, day_number: dayNum, kernel_production_stages_id: null });
                scope.renderProductionDaysList(scope.modalProductionDays);
                $('#productionStagesDayId').val(newDayId);
                scope.clearProductionStagesForm();
                scope.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
                scope.setProductionStagesTabsVisibility(true);
                scope.setProductionDayActive(newDayId);
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to add day', 'error');
            });
        },

        showBatchSummary: () => {
            const scope = _modal_production_stages;
            var batchId = $('#productionStagesBatchId').val();
            if (!batchId) return;
            var $body = $('#batchSummaryBody');
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('batchSummaryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#batchSummaryModal').modal('show');
            var days = scope.modalProductionDays || [];
            var loadDays = days.length === 0 ? (dataFunctions.getKernelProductionDays && dataFunctions.getKernelProductionDays(batchId)) : Promise.resolve(days);
            loadDays.then(function (raw) {
                var list = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
                if (list.length === 0) {
                    $body.html('<p class="text-muted mb-0">No production days to summarize. Add days and save data first.</p>');
                    return;
                }
                var promises = list.map(function (d) {
                    return d.kernel_production_stages_id
                        ? dataFunctions.getKernelProductionStages(d.kernel_production_stages_id)
                        : dataFunctions.getKernelProductionStagesByDay(d.id || d.kernel_production_day_id);
                });
                return Promise.all(promises).then(function (allStages) {
                    var agg = scope.aggregateProductionStages(allStages);
                    $body.html(scope.renderBatchSummaryHtml(agg, list.length));
                });
            }).catch(function () {
                $body.html('<p class="text-muted mb-0">No production days to summarize.</p>');
            });
        },

        aggregateProductionStages: (stagesList) => {
            var sections = ['cracking_data', 'washing_data', 'sorting_data', 'packing_data', 'summary_data'];
            var agg = {};
            sections.forEach(function (sec) { agg[sec] = {}; });
            (stagesList || []).forEach(function (s) {
                var stages = unwrapStages(s);
                if (!stages) return;
                sections.forEach(function (sec) {
                    var data = stages[sec];
                    if (data && typeof data === 'object') {
                        for (var key in data) {
                            var v = data[key];
                            if (typeof v === 'number' && !isNaN(v)) agg[sec][key] = (agg[sec][key] || 0) + v;
                        }
                    }
                });
            });
            return agg;
        },

        /**
         * Build job card payload from batch and all production stages (all days aggregated).
         * Used when finishing batch production to create the kernel job card from cracking/washing/sorting/packing data.
         */
        buildJobCardPayloadFromBatchAndStages: (batchId, batch, stagesList) => {
            var scope = _modal_production_stages;
            var unwrapped = (stagesList || []).map(function (s) { return unwrapStages(s); }).filter(Boolean);
            var agg = scope.aggregateProductionStages(stagesList);
            var num = function (v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; };
            var receivedDate = null;
            if (batch && batch.received_date) {
                var d = batch.received_date.toString().split('T')[0];
                if (/^\d{4}-\d{2}-\d{2}$/.test(d)) receivedDate = d;
            }
            if (!receivedDate && unwrapped.length) {
                var crackDates = unwrapped.map(function (s) { return (s.cracking_data && s.cracking_data.date) ? String(s.cracking_data.date).split('T')[0] : null; }).filter(function (d) { return d && /^\d{4}-\d{2}-\d{2}$/.test(d); });
                if (crackDates.length) { crackDates.sort(); receivedDate = crackDates[0]; }
            }
            // Start = chronologically first packing date (earliest calendar date). Best Before = Start + 18 months.
            var packingDates = [];
            unwrapped.forEach(function (s) {
                var p = s.packing_data;
                if (p && p.date) {
                    var d = String(p.date).split('T')[0];
                    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) packingDates.push(d);
                }
            });
            packingDates.sort();
            var packingStart = packingDates.length ? packingDates[0] : null;
            var packingCompletion = packingDates.length ? packingDates[packingDates.length - 1] : null;
            var bestBeforeDate = (packingStart && /^\d{4}-\d{2}-\d{2}$/.test(packingStart)) ? add18MonthsToISO(packingStart) : null;
            var totalWeight = (agg.summary_data && (agg.summary_data.pack_total_qty != null || agg.summary_data.crack_qty != null)) ? (agg.summary_data.pack_total_qty != null ? agg.summary_data.pack_total_qty : agg.summary_data.crack_qty) : null;
            var p = (agg.packing_data && typeof agg.packing_data === 'object') ? agg.packing_data : {};
            var soundKernelStyles = [];
            [
                { key: 'sk_sp', style: 'SP' }, { key: 'sk_0', style: '0' }, { key: 'sk_1', style: '1' }, { key: 'sk_1s', style: '1S' }, { key: 'sk_4l', style: '4L' }, { key: 'sk_5', style: '5' }, { key: 'sk_6', style: '6' }
            ].forEach(function (item) {
                var cartons = num(p[item.key + '_cartons']);
                var qty = num(p[item.key + '_qty']);
                if (cartons > 0 || qty > 0) soundKernelStyles.push({ style: item.style, cartons: Math.round(cartons), weight_kg: qty });
            });
            var butterGradeStyles = [];
            [
                { key: 'bt_78', style: '7/8' }, { key: 'bt_high', style: 'Butter High Oil (Floaters)' }, { key: 'bt_low', style: 'Butter Low Oil (Sinkers)' }
            ].forEach(function (item) {
                var cartons = num(p[item.key + '_cartons']);
                var qty = num(p[item.key + '_qty']);
                if (cartons > 0 || qty > 0) butterGradeStyles.push({ style: item.style, cartons: Math.round(cartons), weight_kg: qty });
            });
            var skTotalCartons = num(p.sk_total_cartons) || soundKernelStyles.reduce(function (sum, r) { return sum + (r.cartons || 0); }, 0);
            var skTotalKg = num(p.sk_total_qty) || soundKernelStyles.reduce(function (sum, r) { return sum + (r.weight_kg || 0); }, 0);
            var btTotalCartons = num(p.bt_total_cartons) || butterGradeStyles.reduce(function (sum, r) { return sum + (r.cartons || 0); }, 0);
            var btTotalKg = num(p.bt_total_qty) || butterGradeStyles.reduce(function (sum, r) { return sum + (r.weight_kg || 0); }, 0);
            var c = (agg.cracking_data && typeof agg.cracking_data === 'object') ? agg.cracking_data : {};
            var w = (agg.washing_data && typeof agg.washing_data === 'object') ? agg.washing_data : {};
            var s = (agg.sorting_data && typeof agg.sorting_data === 'object') ? agg.sorting_data : {};
            return {
                p_batch_number: (batch && batch.batch_number) ? String(batch.batch_number) : null,
                p_received_date: receivedDate,
                p_production_batch_id: batchId || null,
                p_total_weight_kg: totalWeight,
                p_supplier_id: (batch && batch.supplier_id) ? batch.supplier_id : null,
                p_supplier_name: (batch && batch.grower_name) ? String(batch.grower_name) : null,
                p_packing_start_date: packingStart,
                p_packing_completion_date: packingCompletion,
                p_best_before_date: bestBeforeDate,
                p_sound_kernel_styles: soundKernelStyles.length ? JSON.stringify(soundKernelStyles) : null,
                p_sound_kernel_total_cartons: skTotalCartons ? Math.round(skTotalCartons) : null,
                p_sound_kernel_total_kg: skTotalKg || null,
                p_butter_grade_styles: butterGradeStyles.length ? JSON.stringify(butterGradeStyles) : null,
                p_butter_grade_total_cartons: btTotalCartons ? Math.round(btTotalCartons) : null,
                p_butter_grade_total_kg: btTotalKg || null,
                p_waste_shell_kg: (c.shell_total != null && c.shell_total !== '') ? num(c.shell_total) : null,
                p_waste_shell_fines_kg: (w.waste_shellfines != null && w.waste_shellfines !== '') ? num(w.waste_shellfines) : null,
                p_waste_compost_kg: (num(w.waste_compost) + num(s.compost_qty)) > 0 ? num(w.waste_compost) + num(s.compost_qty) : null,
                p_waste_oil_kernel_kg: (s.oil_qty != null && s.oil_qty !== '') ? num(s.oil_qty) : null
            };
        },

        renderBatchSummaryHtml: (agg, dayCount) => {
            var fmt = function (v) { return v != null && typeof v === 'number' ? v.toFixed(2) : (v != null ? String(v) : '—'); };
            var rows = ['<p class="text-muted small">Totals across ' + dayCount + ' day(s).</p>', '<table class="table table-sm table-bordered"><thead><tr><th>Field</th><th>Total</th></tr></thead><tbody>'];
            var sections = [['cracking_data', 'Cracking'], ['washing_data', 'Washing'], ['sorting_data', 'Sorting'], ['packing_data', 'Packing'], ['summary_data', 'Summary']];
            sections.forEach(function (pair) {
                var data = agg[pair[0]];
                if (data && typeof data === 'object') {
                    rows.push('<tr><td colspan="2" class="fw-bold">' + pair[1] + '</td></tr>');
                    for (var k in data) rows.push('<tr><td class="ps-3">' + k + '</td><td>' + fmt(data[k]) + '</td></tr>');
                }
            });
            rows.push('</tbody></table>');
            return rows.join('');
        },

        finishBatchProduction: () => {
            const scope = _modal_production_stages;
            var batchId = $('#productionStagesBatchId').val();
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
                return;
            }
            if (typeof Swal !== 'undefined') {
                Swal.fire({ title: 'Finish batch production?', text: 'This will mark the batch production as complete.', icon: 'question', showCancelButton: true, confirmButtonText: 'Finish' }).then(function (confirmResult) {
                    if (!confirmResult.isConfirmed) return;
                    scope.doFinishBatchProduction(batchId);
                });
            } else {
                scope.doFinishBatchProduction(batchId);
            }
        },

        /** Completes the "Finish batch production" action: calls API, updates status to awaiting_test, creates job card from production data, closes modal, refreshes grid. */
        doFinishBatchProduction: (batchId) => {
            const scope = _modal_production_stages;
            if (!dataFunctions || typeof dataFunctions.finishKernelBatchProduction !== 'function') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Finish batch function not available', 'error');
                return;
            }
            var p = dataFunctions.finishKernelBatchProduction(batchId);
            if (!p || typeof p.then !== 'function') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Finish batch function not available', 'error');
                return;
            }
            p.then(function (result) {
                var inner = (result && result.finish_kernel_batch_production) ? result.finish_kernel_batch_production : result;
                if (!inner || inner.success === false) {
                    throw new Error(inner && inner.error ? inner.error : 'Failed to finish');
                }
                var updatePromise = (dataFunctions.updateProductionBatch)
                    ? dataFunctions.updateProductionBatch(batchId, { status: 'awaiting_test' })
                    : Promise.resolve();
                return updatePromise.then(function () {
                    var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
                    var daysPromise = (dataFunctions.getKernelProductionDays && batchId) ? dataFunctions.getKernelProductionDays(batchId) : Promise.resolve([]);
                    return daysPromise.then(function (daysRaw) {
                        var days = Array.isArray(daysRaw) ? daysRaw : (daysRaw && daysRaw.data ? daysRaw.data : []);
                        if (days.length === 0) return null;
                        var stagePromises = days.map(function (d) {
                            var dayId = d.id || d.kernel_production_day_id;
                            return (dataFunctions.getKernelProductionStagesByDay && dayId) ? dataFunctions.getKernelProductionStagesByDay(dayId) : Promise.resolve(null);
                        });
                        return Promise.all(stagePromises).then(function (allStages) {
                            var payload = scope.buildJobCardPayloadFromBatchAndStages(batchId, batch, allStages);
                            if (payload && payload.p_batch_number && dataFunctions.createKernelJobCard) {
                                return dataFunctions.createKernelJobCard(payload).then(function () { return true; }).catch(function (err) {
                                    console.warn('[Kernel Production] Job card create on finish:', err);
                                    return false;
                                });
                            }
                            return null;
                        });
                    });
                }).then(function () {
                    if (typeof Swal !== 'undefined') Swal.fire('Saved', 'Batch production marked as finished. Status: Awaiting test.', 'success');
                    var modalEl = document.getElementById('productionStagesModal');
                    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                    else if (typeof $ !== 'undefined') $('#productionStagesModal').modal('hide');
                    if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                });
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to finish batch production', 'error');
            });
        },

        saveProductionStages: () => {
            const scope = _modal_production_stages;
            var batchId = $('#productionStagesBatchId').val();
            var dayId = $('#productionStagesDayId').val();
            if (!batchId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
                return;
            }
            if (!dayId) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Select or add a day first, then save.', 'error');
                return;
            }
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
            var batchNumber = batch ? (batch.batch_number || '') : '';
            var growerName = batch ? (batch.grower_name || '') : '';
            scope.persistCurrentTabToStages();
            var cracking_data = scope.getProductionStagesSectionData('crack');
            var washing_data = scope.getProductionStagesSectionData('wash');
            var sorting_data = scope.getProductionStagesSectionData('sort');
            var packing_data = scope.getProductionStagesSectionData('pack');
            var summary_data = deriveSummaryFromStages(cracking_data, washing_data, sorting_data, packing_data);
            var stagesPayload = { cracking_data: cracking_data, washing_data: washing_data, sorting_data: sorting_data, packing_data: packing_data };
            var effectiveSaveDate = getStagesLatestDate(stagesPayload) || getStagesEffectiveDate(stagesPayload);

            function doSave(targetDayId) {
                var payload = {
                    kernel_production_day_id: targetDayId,
                    batch_number: batchNumber,
                    grower_name: growerName,
                    cracking_data: cracking_data,
                    washing_data: washing_data,
                    sorting_data: sorting_data,
                    packing_data: packing_data,
                    summary_data: summary_data
                };
                return (dataFunctions.saveKernelProductionStages && dataFunctions.saveKernelProductionStages(payload)).then(function () {
                    scope.modalProductionDayStages = { cracking_data: cracking_data, washing_data: washing_data, sorting_data: sorting_data, packing_data: packing_data, summary_data: summary_data };
                    scope.updateProductionActionButtonTicks();
                    scope.clearProductionStagesDraft(batchId);
                    if (typeof Swal !== 'undefined') Swal.fire('Saved', 'Production stages saved for this day.', 'success');
                    return (dataFunctions.getKernelProductionDays && dataFunctions.getKernelProductionDays(batchId)) || Promise.resolve([]);
                }).then(function (raw) {
                    var days = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
                    scope.modalProductionDays = days;
                    scope.renderProductionDaysList(days);
                    scope.setProductionDayActive(targetDayId);
                });
            }

            // Save to the day that matches the form date (across all days), or create a new day if no day has that date.
            var checkAndSave = function () {
                if (!effectiveSaveDate) {
                    return doSave(dayId);
                }
                var daysPromise = (dataFunctions.getKernelProductionDays && dataFunctions.getKernelProductionDays(batchId)) || Promise.resolve([]);
                return daysPromise
                    .then(function (daysRaw) {
                        var days = Array.isArray(daysRaw) ? daysRaw : (daysRaw && daysRaw.data ? daysRaw.data : []);
                        if (!days.length) return { targetDayId: dayId, days: days };
                        var getStages = dataFunctions.getKernelProductionStagesByDay && dataFunctions.getKernelProductionStagesByDay;
                        if (!getStages) return { targetDayId: dayId, days: days };
                        return Promise.all(days.map(function (d) {
                            var did = d.id || d.kernel_production_day_id;
                            return getStages(did).then(function (raw) {
                                var stages = raw && typeof raw === 'object' && raw.get_kernel_production_stages_by_day != null
                                    ? raw.get_kernel_production_stages_by_day
                                    : (Array.isArray(raw) ? raw[0] : raw);
                                var dayDate = getStagesEffectiveDate(stages);
                                return { dayId: did, day: d, dayDate: dayDate };
                            }).catch(function () { return { dayId: did, day: d, dayDate: null }; });
                        })).then(function (dayInfos) {
                            var match = dayInfos.filter(function (info) { return info.dayDate === effectiveSaveDate; })[0];
                            var targetDayId = match ? match.dayId : null;
                            if (targetDayId) {
                                scope.modalProductionDays = days;
                                scope.renderProductionDaysList(days);
                                $('#productionStagesDayId').val(targetDayId);
                                scope.setProductionDayActive(targetDayId);
                                return { targetDayId: targetDayId, days: days };
                            }
                            var currentInfo = dayInfos.filter(function (info) { return info.dayId === dayId; })[0];
                            var currentDayDate = currentInfo ? currentInfo.dayDate : null;
                            if (currentDayDate !== null && currentDayDate === effectiveSaveDate) return { targetDayId: dayId, days: days };
                            if (typeof dataFunctions.createKernelProductionDay !== 'function') return { targetDayId: dayId, days: days };
                            return dataFunctions.createKernelProductionDay(batchId).then(function (result) {
                                var inner = (result && result.create_kernel_production_day) ? result.create_kernel_production_day : result;
                                if (!inner || inner.success === false) throw new Error(inner && inner.error ? inner.error : 'Failed to create production day');
                                var newDayId = inner.id;
                                var dayNum = inner.day_number != null ? inner.day_number : (days.length + 1);
                                var newDays = days.concat([{ id: newDayId, day_number: dayNum, kernel_production_stages_id: null }]);
                                scope.modalProductionDays = newDays;
                                scope.renderProductionDaysList(newDays);
                                $('#productionStagesDayId').val(newDayId);
                                scope.setProductionDayActive(newDayId);
                                return { targetDayId: newDayId, days: newDays };
                            });
                        });
                    })
                    .then(function (out) {
                        var target = out && out.targetDayId ? out.targetDayId : dayId;
                        return doSave(target);
                    })
                    .catch(function (err) {
                        return doSave(dayId);
                    });
            };

            checkAndSave().catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save production stages', 'error');
            });
        },

        showProductionStagesModalForBatch: (batchId) => {
            const scope = _modal_production_stages;
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
            if (!batch) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not found', 'error');
                return;
            }
            if (!$('#productionStagesBatchId').length) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Production modal not loaded yet. Please wait a moment and try again.', 'error');
                return;
            }
            $('#productionStagesBatchId').val(batchId);
            $('#productionStagesDayId').val('');
            scope.clearProductionStagesForm();
            var dateVal = batch.received_date ? (batch.received_date.toString().split('T')[0]) : (new Date().toISOString().split('T')[0]);
            $('#ps_crack_date').val(fromISO(dateVal));
            var days = batch.productionDays && batch.productionDays.length ? batch.productionDays : [];
            var loadDays = days.length === 0 && dataFunctions.getKernelProductionDays ? dataFunctions.getKernelProductionDays(batchId) : Promise.resolve(days);
            loadDays.then(function (raw) {
                var list = Array.isArray(raw) ? raw : (raw && raw.data ? raw.data : []);
                if (list.length === 0 && typeof dataFunctions !== 'undefined' && typeof dataFunctions.createKernelProductionDay === 'function') {
                    return dataFunctions.createKernelProductionDay(batchId).then(function (result) {
                        var inner = (result && result.create_kernel_production_day) ? result.create_kernel_production_day : result;
                        if (!inner || inner.success === false) throw new Error(inner && inner.error ? inner.error : 'Failed to create production day');
                        var newDayId = inner.id;
                        list = [{ id: newDayId, day_number: 1, kernel_production_stages_id: null }];
                        scope.modalProductionDays = list;
                        $('#productionStagesDayId').val(newDayId);
                        scope.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
                        scope.setProductionStagesTabsVisibility(true);
                        if (batch.status === 'awaiting_production' && typeof dataFunctions !== 'undefined' && dataFunctions.updateProductionBatch) {
                            dataFunctions.updateProductionBatch(batchId, { status: 'in_production' }).catch(function () {});
                        }
                        return scope.populateProductionGrowerSelects(batch.grower_name || '');
                    });
                }
                scope.modalProductionDays = list;
                scope.setProductionStagesTabsVisibility(list.length > 0);
                if (list.length > 0) {
                    var first = list[0];
                    var firstDayId = first.id || first.kernel_production_day_id;
                    $('#productionStagesDayId').val(firstDayId || '');
                    return scope.populateProductionGrowerSelects(batch.grower_name || '').then(function () {
                        return scope.loadProductionStagesForDay(firstDayId, first.kernel_production_stages_id);
                    }).then(function () {
                        scope.updateProductionActionButtonTicks();
                    });
                }
                return scope.populateProductionGrowerSelects(batch.grower_name || '');
            }).then(function () {
                scope.restoreProductionStagesDraft(batchId);
                var modalEl = document.getElementById('productionStagesModal');
                var doRestoreTab = function () {
                    var savedTab = null;
                    try { savedTab = localStorage.getItem('kernelProduction_lastTab_' + batchId); } catch (err) {}
                    var tabNames = ['cracking', 'washing', 'sorting', 'packing'];
                    if (savedTab && tabNames.indexOf(savedTab) !== -1) {
                        var tabBtn = document.getElementById('tab-' + savedTab);
                        if (tabBtn && typeof bootstrap !== 'undefined' && bootstrap.Tab) bootstrap.Tab.getOrCreateInstance(tabBtn).show();
                    }
                };
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                    $(modalEl).one('shown.bs.modal', doRestoreTab);
                    bootstrap.Modal.getOrCreateInstance(modalEl).show();
                } else {
                    $('#productionStagesModal').one('shown.bs.modal', doRestoreTab).modal('show');
                }
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e && e.message ? e.message : 'Could not open Production. Please try again.', 'error');
            });
        },

        showProductionStagesViewModal: (stagesId) => {
            var $body = $('#productionStagesViewBody');
            if (!$body.length) return;
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('productionStagesViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#productionStagesViewModal').modal('show');
            (dataFunctions.getKernelProductionStages && dataFunctions.getKernelProductionStages(stagesId)).then(function (s) {
                if (!s) { $body.html('<p class="text-muted mb-0">Production record not found.</p>'); return; }
                var fmt = function (v) { return v != null && v !== '' ? String(v) : '—'; };
                var renderSection = function (data) {
                    if (!data || typeof data !== 'object') return '<p class="text-muted mb-0">No data</p>';
                    var rows = [];
                    for (var k in data) { if (data.hasOwnProperty(k)) rows.push('<tr><td class="text-nowrap">' + k + '</td><td>' + fmt(data[k]) + '</td></tr>'); }
                    return rows.length ? '<table class="table table-sm table-bordered mb-2"><tbody>' + rows.join('') + '</tbody></table>' : '<p class="text-muted mb-0">No data</p>';
                };
                var html = '<div class="small"><p class="mb-2"><strong>Batch:</strong> ' + fmt(s.batch_number) + ' &nbsp; <strong>Grower:</strong> ' + fmt(s.grower_name) + '</p>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Cracking</strong></div><div class="card-body py-2">' + renderSection(s.cracking_data) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Washing</strong></div><div class="card-body py-2">' + renderSection(s.washing_data) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sorting</strong></div><div class="card-body py-2">' + renderSection(s.sorting_data) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Packing</strong></div><div class="card-body py-2">' + renderSection(s.packing_data) + '</div></div>';
                html += '<div class="card mb-2"><div class="card-header py-1"><strong>Summary</strong></div><div class="card-body py-2">' + renderSection(s.summary_data) + '</div></div></div>';
                $body.html(html);
            }).catch(function (e) {
                $body.html('<p class="text-danger mb-0">Could not load production record.</p>');
            });
        }
    };
}());
_modal_production_stages.init();
