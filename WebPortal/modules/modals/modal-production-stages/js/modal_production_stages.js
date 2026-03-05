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
    var AUTO_SAVE_DELAY_MS = 900;
    return {
        modalProductionDays: null,
        modalProductionDayStages: null,
        currentProductionAction: null,
        currentTabSection: 'crack',
        /** Cached result of getKernelBatchDetail — avoids repeated DB calls within one modal session. */
        _loadedKernelDetail: null,
        _signaturePad: null,
        _autoSaveTimer: null,
        /** When true, date picker onChange will not clear the form (used when we set dates programmatically). */
        _suppressDateChangeClear: false,
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
                    scope.scheduleAutoSave();
                    var batchId = $('#productionStagesBatchId').val();
                    var tabName = newTabId.replace('tab-', '');
                    if (batchId && tabName) {
                        try { localStorage.setItem('kernelProduction_lastTab_' + batchId, tabName); } catch (err) {}
                    }
                    // Init signature pad when packing tab is shown (canvas must be visible for sizing)
                    if (newTabId === 'tab-packing') scope.initSignaturePad();
                }
            });
            $('#batchSummaryBtn').off('click').on('click', function (e) {
                e.preventDefault();
                scope.showBatchSummary();
            });
            $(document).on('click', '#batchSummaryFinishProductionBtn', function (e) {
                e.preventDefault();
                var batchId = $('#batchSummaryModal').data('current-batch-id') || $('#productionStagesBatchId').val();
                if (!batchId) {
                    if (typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
                    return;
                }
                var summaryModalEl = document.getElementById('batchSummaryModal');
                if (summaryModalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(summaryModalEl).hide();
                else $('#batchSummaryModal').modal('hide');
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ title: 'Finish batch production?', text: 'This will mark the batch production as complete.', icon: 'question', showCancelButton: true, confirmButtonText: 'Finish' }).then(function (confirmResult) {
                        if (confirmResult.isConfirmed) scope.doFinishBatchProduction(batchId);
                    });
                } else {
                    scope.doFinishBatchProduction(batchId);
                }
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
            // Crates/cartons → qty auto-calc (× 11.34)
            $(document).on('input change', '.wash-crate-input', function () { scope.recalcWashingQty(); });
            $(document).on('input change', '.sort-crate-input', function () { scope.recalcSortingQty(); });
            $(document).on('input change', '.pack-carton-input', function () { scope.recalcPackingQty(); });
            // Map section date field IDs to their section key
            var sectionDateFields = {
                'ps_crack_date': 'crack',
                'ps_wash_date':  'wash',
                'ps_sort_date':  'sort',
                'ps_pack_date':  'pack'
            };
            $('#productionStagesModal').off('shown.bs.modal').on('shown.bs.modal', function () {
                var container = document.getElementById('productionStagesModal');
                var inputs = container ? container.querySelectorAll('.flatpickr-date') : [];
                var todayPlaceholder = fromISO(new Date().toISOString().split('T')[0]);
                inputs.forEach(function (el) {
                    if (el._flatpickr) return;
                    if (typeof flatpickr !== 'undefined') {
                        flatpickr(el, Object.assign({}, FLATPICKR_DDMMYYYY, {
                            onChange: function (selectedDates, dateStr) {
                                if (dateStr != null && dateStr !== '') _modal_production_stages.onProductionDateChanged(dateStr);
                            }
                        }));
                        if (!el.value && todayPlaceholder) el.placeholder = todayPlaceholder;
                    }
                });
            });
            // Signature pad init
            $(document).off('click.sigclear', '#ps_pack_signature_clear').on('click.sigclear', '#ps_pack_signature_clear', function (e) {
                e.preventDefault();
                if (scope._signaturePad) { scope._signaturePad.clear(); $('#ps_pack_signature').val(''); }
            });
            $('#productionStagesModal').off('hidden.bs.modal').on('hidden.bs.modal', function () {
                var batchId = $('#productionStagesBatchId').val();
                if (batchId) scope.saveProductionStagesDraftToStorage();
            });
            $('#productionStagesModal').off('hide.bs.modal').on('hide.bs.modal', function () {
                scope.flushAutoSave();
            });
            $(document).on('click', '#productionStagesDayList [data-day-id]', function () {
                var dayId = $(this).attr('data-day-id');
                if (dayId) scope.selectProductionDay(dayId);
            });
            $(document).on('click', '#addProductionDayBtn', function (e) {
                e.preventDefault();
                scope.addProductionDay();
            });
            $(document).on('change input', '#productionStagesModal [id^="ps_"]', function () {
                scope.scheduleAutoSave();
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

        recalcWashingQty: () => {
            var KG = 11.34;
            var calc = function (id) { return parseFloat($('#' + id).val()) || 0; };
            // Individual crate → qty
            $('.wash-crate-input').each(function () {
                var crates = parseFloat(this.value) || 0;
                var qtyEl = document.getElementById(this.getAttribute('data-qty'));
                if (qtyEl) qtyEl.value = crates ? +(crates * KG).toFixed(2) : '';
            });
            // Totals & diffs
            var floater = calc('ps_wash_floater_crates'), sinker = calc('ps_wash_sinker_crates');
            var totalOut = floater + sinker;
            var cratesIn = calc('ps_wash_crates_in');
            var diff = Math.abs(cratesIn - totalOut);
            $('#ps_wash_total_crates').val(totalOut || '');
            $('#ps_wash_total_qty').val(totalOut ? +(totalOut * KG).toFixed(2) : '');
            $('#ps_wash_crate_diff').val(diff || '');
            $('#ps_wash_qty_diff').val(diff ? +(diff * KG).toFixed(2) : '');
        },

        recalcSortingQty: () => {
            var KG = 11.34;
            var skTotal = 0, btTotal = 0;
            // Individual crate → qty
            $('.sort-crate-input').each(function () {
                var crates = parseFloat(this.value) || 0;
                var qtyEl = document.getElementById(this.getAttribute('data-qty'));
                if (qtyEl) qtyEl.value = crates ? +(crates * KG).toFixed(2) : '';
                var group = this.getAttribute('data-group');
                if (group === 'sk') skTotal += crates;
                else if (group === 'bt') btTotal += crates;
            });
            // Sound Kernel totals (styles 0,1,1s,4l,5,6,7/8)
            $('#ps_sort_sound_crates').val(skTotal || '');
            $('#ps_sort_sound_qty').val(skTotal ? +(skTotal * KG).toFixed(2) : '');
            // Butter totals (butter low oil only; 7/8 is in Sound Kernel)
            $('#ps_sort_butter_crates').val(btTotal || '');
            $('#ps_sort_butter_qty').val(btTotal ? +(btTotal * KG).toFixed(2) : '');
        },

        recalcPackingQty: () => {
            var KG = 11.34;
            var skTotal = 0, btTotal = 0;
            $('.pack-carton-input').each(function () {
                var cartons = parseFloat(this.value) || 0;
                var qty = cartons ? +(cartons * KG).toFixed(2) : '';
                var qtyEl = document.getElementById(this.getAttribute('data-qty'));
                if (qtyEl) qtyEl.value = qty;
                if (this.getAttribute('data-group') === 'sk') skTotal += cartons;
                else if (this.getAttribute('data-group') === 'bt') btTotal += cartons;
            });
            var grandTotal = skTotal + btTotal;
            $('#ps_pack_sk_total_cartons').val(skTotal || '');
            $('#ps_pack_sk_total_qty').val(skTotal ? +(skTotal * KG).toFixed(2) : '');
            $('#ps_pack_bt_total_cartons').val(btTotal || '');
            $('#ps_pack_bt_total_qty').val(btTotal ? +(btTotal * KG).toFixed(2) : '');
            $('#ps_pack_totals_cartons').val(grandTotal || '');
            $('#ps_pack_totals_qty').val(grandTotal ? +(grandTotal * KG).toFixed(2) : '');
        },

        initSignaturePad: () => {
            const scope = _modal_production_stages;
            var canvas = document.getElementById('ps_pack_signature_canvas');
            if (!canvas || typeof SignaturePad === 'undefined') return;
            if (scope._signaturePad) return; // already initialized
            scope._signaturePad = new SignaturePad(canvas, { penColor: '#222', backgroundColor: 'rgba(255,255,255,0)' });
            // Sync to hidden input when stroke ends
            scope._signaturePad.addEventListener('endStroke', function () {
                var hidden = document.getElementById('ps_pack_signature');
                if (hidden && !scope._signaturePad.isEmpty()) {
                    hidden.value = scope._signaturePad.toDataURL('image/png');
                }
            });
            // Resize canvas to match CSS display size
            var ratio = Math.max(window.devicePixelRatio || 1, 1);
            canvas.width = canvas.offsetWidth * ratio;
            canvas.height = canvas.offsetHeight * ratio;
            canvas.getContext('2d').scale(ratio, ratio);
            scope._signaturePad.clear();
            // Load existing signature if present
            var hidden = document.getElementById('ps_pack_signature');
            if (hidden && hidden.value && hidden.value.indexOf('data:') === 0) {
                scope._signaturePad.fromDataURL(hidden.value, { ratio: ratio });
            }
        },

        getProductionStagesSectionData: (prefix) => {
            const scope = _modal_production_stages;
            // Sync signature pad to hidden input before collecting packing data
            if (prefix === 'pack' && scope._signaturePad && !scope._signaturePad.isEmpty()) {
                var sigEl = document.getElementById('ps_pack_signature');
                if (sigEl) sigEl.value = scope._signaturePad.toDataURL('image/png');
            }
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
            scope._suppressDateChangeClear = true;
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
            if (prefix === 'wash') { scope.updateWashWasteTotal(); scope.recalcWashingQty(); }
            if (prefix === 'crack') scope.updateCrackSiloQty();
            if (prefix === 'sort') scope.recalcSortingQty();
            if (prefix === 'pack') scope.recalcPackingQty();
            if (prefix === 'pack' && data.signature && scope._signaturePad) {
                scope._signaturePad.clear();
                if (data.signature.indexOf('data:') === 0) {
                    var ratio = Math.max(window.devicePixelRatio || 1, 1);
                    scope._signaturePad.fromDataURL(data.signature, { ratio: ratio });
                }
            }
            setTimeout(function () { scope._suppressDateChangeClear = false; }, 0);
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
            const scope = _modal_production_stages;
            $('[id^="ps_"]').each(function () {
                if (this.type === 'checkbox') this.checked = false;
                else this.value = '';
            });
            if (scope._signaturePad) scope._signaturePad.clear();
        },

        /** Set the four stage date inputs (Cracking, Washing, Sorting, Packing) to today. Use for a brand new day. */
        setTodayDatesInProductionForm: () => {
            const scope = _modal_production_stages;
            scope._suppressDateChangeClear = true;
            var today = new Date().toISOString().split('T')[0];
            var ddmmyyyy = fromISO(today);
            $('#ps_crack_date, #ps_wash_date, #ps_sort_date, #ps_pack_date').val(ddmmyyyy);
            setTimeout(function () { scope._suppressDateChangeClear = false; }, 0);
        },

        /** Called when user changes any stage date in the picker. Saves current day, loads data for the new date (or clears), and syncs all four dates. */
        onProductionDateChanged: (newDateStr) => {
            const scope = _modal_production_stages;
            if (scope._suppressDateChangeClear || !newDateStr || typeof newDateStr !== 'string') return;
            newDateStr = newDateStr.trim();
            if (newDateStr === '') return;
            scope._suppressDateChangeClear = true;
            // Flush any pending auto-save for the current date before switching
            scope.flushAutoSave();
            var dateIds = ['ps_crack_date', 'ps_wash_date', 'ps_sort_date', 'ps_pack_date'];
            // Sync all four date fields to the selected date
            dateIds.forEach(function (id) { $('#' + id).val(newDateStr); });
            setTimeout(function () { scope._suppressDateChangeClear = false; }, 0);
            // Look up existing data for this date in the cached detail
            var isoDate = toISO(newDateStr);
            var detail = scope._loadedKernelDetail;
            var crack = scope._findByDate(detail && detail.cracking_data, isoDate);
            var wash  = scope._findByDate(detail && detail.washing_data,  isoDate);
            var sort  = scope._findByDate(detail && detail.sorting_data,  isoDate);
            var pack  = scope._findByDate(detail && detail.packing_data,  isoDate);
            var hasData = Object.keys(crack).length || Object.keys(wash).length || Object.keys(sort).length || Object.keys(pack).length;
            if (hasData) {
                scope.setProductionStagesSectionData('crack', crack);
                scope.setProductionStagesSectionData('wash', wash);
                scope.setProductionStagesSectionData('sort', sort);
                scope.setProductionStagesSectionData('pack', pack);
            } else {
                // No data for this date — clear all non-date inputs
                $('[id^="ps_"]').each(function () {
                    if (dateIds.indexOf(this.id) >= 0) return;
                    if (this.type === 'checkbox') this.checked = false;
                    else this.value = '';
                });
            }
            // Do not auto-save on date navigation — wait for actual data entry
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
                if (!dayId) return;
                var label = (d.date && d.date !== '') ? fromISO(d.date) : 'New day';
                var isSaved = !!d.kernel_production_stages_id;
                var html = isSaved
                    ? label + ' <span class="text-success ms-1">&#10003;</span>'
                    : label;
                $container.append($('<button type="button" class="btn btn-sm btn-outline-secondary" data-day-id="' + dayId + '" data-day-saved="' + (isSaved ? '1' : '0') + '">').html(html));
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

        /** When a section date picker changes, look up existing data for that date and populate the section. */
        _onSectionDateChange: (section, dateFieldId) => {
            const scope = _modal_production_stages;
            var rawDate = $('#' + dateFieldId).val();
            var isoDate = toISO(rawDate);
            if (!isoDate || isoDate === '') return;

            var detail = scope._loadedKernelDetail;
            if (!detail) return;

            var map = scope.productionActionMap[section];
            if (!map) return;

            var existing = scope._findByDate(detail[map.dataKey], isoDate);
            if (Object.keys(existing).length > 0) {
                // Found existing data for this date — populate the section
                scope.setProductionStagesSectionData(map.section, existing);
            } else {
                // No existing data — clear section fields except the date itself
                $('[id^="ps_' + map.section + '_"]').each(function () {
                    if (this.id === dateFieldId) return;
                    if (this.type === 'checkbox') this.checked = false;
                    else this.value = '';
                });
            }
        },

        /** Find entry in a JSONB array by its 'date' field. Returns the object or {}. */
        _findByDate: (arr, date) => {
            if (!Array.isArray(arr) || !date || date === '') return {};
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] && arr[i].date === date) return arr[i];
            }
            return {};
        },

        loadProductionStagesForDay: (dayDate, stagesId) => {
            const scope = _modal_production_stages;
            if (!dayDate || dayDate === '') {
                scope.clearProductionStagesForm();
                scope.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
                return Promise.resolve();
            }
            // dayDate is an ISO date string — look up each section by date
            var detail = scope._loadedKernelDetail;
            var crack = scope._findByDate(detail && detail.cracking_data, dayDate);
            var wash  = scope._findByDate(detail && detail.washing_data,  dayDate);
            var sort  = scope._findByDate(detail && detail.sorting_data,  dayDate);
            var pack  = scope._findByDate(detail && detail.packing_data,  dayDate);
            var hasData = Object.keys(crack).length || Object.keys(wash).length || Object.keys(sort).length || Object.keys(pack).length;
            scope.modalProductionDayStages = {
                cracking_data: crack,
                washing_data: wash,
                sorting_data: sort,
                packing_data: pack,
                summary_data: hasData ? deriveSummaryFromStages(crack, wash, sort, pack) : {}
            };
            if (hasData) {
                scope.setProductionStagesSectionData('crack', crack);
                scope.setProductionStagesSectionData('wash', wash);
                scope.setProductionStagesSectionData('sort', sort);
                scope.setProductionStagesSectionData('pack', pack);
            } else {
                scope.clearProductionStagesForm();
                scope.setTodayDatesInProductionForm();
            }
            return Promise.resolve();
        },

        /** Switch to a day: save current day, then load the selected day's data (or blank + today's date if new day). */
        selectProductionDay: (dayId) => {
            const scope = _modal_production_stages;
            scope.flushAutoSave();
            scope.persistCurrentTabToStages();
            $('#productionStagesDayId').val(dayId || '');
            var days = scope.modalProductionDays || [];
            var day = days.filter(function (d) { return (d.id || d.kernel_production_day_id) === dayId; })[0];
            // Pass the date for lookup (dayId = date string for saved days, day.date for all)
            var dayDate = (day && day.date) ? day.date : dayId;
            scope.loadProductionStagesForDay(dayDate, day && day.kernel_production_stages_id).then(function () {
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
            scope.persistCurrentTabToStages();
            scope.modalProductionDays = scope.modalProductionDays || [];
            // New day gets a temporary ID until saved (then keyed by date)
            var newDayId = 'new_' + Date.now();
            var dayNum = scope.modalProductionDays.length + 1;
            scope.modalProductionDays.push({ id: newDayId, date: '', day_number: dayNum, kernel_production_stages_id: null });
            scope.renderProductionDaysList(scope.modalProductionDays);
            $('#productionStagesDayId').val(newDayId);
            scope.clearProductionStagesForm();
            scope.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
            scope.setProductionStagesTabsVisibility(true);
            scope.setProductionDayActive(newDayId);
            scope.setTodayDatesInProductionForm();
        },

        showBatchSummary: () => {
            const scope = _modal_production_stages;
            var batchId = $('#productionStagesBatchId').val();
            if (!batchId) return;
            var $body = $('#batchSummaryBody');
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            $('#batchSummaryFinishProductionBtn').hide();
            var modalEl = document.getElementById('batchSummaryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#batchSummaryModal').modal('show');
            // Build stages list from cached kernel detail (no extra DB call)
            var detail = scope._loadedKernelDetail;
            var cracking = (detail && Array.isArray(detail.cracking_data)) ? detail.cracking_data : [];
            var washing  = (detail && Array.isArray(detail.washing_data))  ? detail.washing_data  : [];
            var sorting  = (detail && Array.isArray(detail.sorting_data))  ? detail.sorting_data  : [];
            var packing  = (detail && Array.isArray(detail.packing_data))  ? detail.packing_data  : [];
            var maxLen = Math.max(cracking.length, washing.length, sorting.length, packing.length);
            if (maxLen === 0) {
                $body.html('<p class="text-muted mb-0">No production days to summarize. Add days and save data first.</p>');
                $('#batchSummaryFinishProductionBtn').hide();
                return;
            }
            var allStages = [];
            for (var i = 0; i < maxLen; i++) {
                allStages.push({
                    cracking_data: cracking[i] || {},
                    washing_data:  washing[i]  || {},
                    sorting_data:  sorting[i]  || {},
                    packing_data:  packing[i]  || {}
                });
            }
            var agg = scope.aggregateProductionStages(allStages);
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
            $body.html(scope.renderBatchSummaryHtml(agg, maxLen, batch, detail));
            $('#batchSummaryModal').data('current-batch-id', batchId);
            var $finishBtn = $('#batchSummaryFinishProductionBtn');
            if ($finishBtn.length) $finishBtn.toggle(!!(batch && !batch.production_finished_at));
        },

        /**
         * Show batch summary modal for a batch by ID (e.g. from kanban card or table).
         * Loads kernel detail then renders the same summary as when opened from Production modal.
         */
        showBatchSummaryForBatch: (batchId) => {
            const scope = _modal_production_stages;
            if (!batchId || typeof dataFunctions === 'undefined' || !dataFunctions.getKernelBatchDetail) return;
            var $body = $('#batchSummaryBody');
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            $('#batchSummaryFinishProductionBtn').hide();
            var modalEl = document.getElementById('batchSummaryModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#batchSummaryModal').modal('show');
            dataFunctions.getKernelBatchDetail(batchId).then(function (detail) {
                scope._loadedKernelDetail = detail;
                var cracking = (detail && Array.isArray(detail.cracking_data)) ? detail.cracking_data : [];
                var washing  = (detail && Array.isArray(detail.washing_data))  ? detail.washing_data  : [];
                var sorting  = (detail && Array.isArray(detail.sorting_data))  ? detail.sorting_data  : [];
                var packing  = (detail && Array.isArray(detail.packing_data))  ? detail.packing_data  : [];
                var maxLen = Math.max(cracking.length, washing.length, sorting.length, packing.length);
                if (maxLen === 0) {
                    $body.html('<p class="text-muted mb-0">No production days to summarize. Add days and save data first.</p>');
                    $('#batchSummaryFinishProductionBtn').hide();
                    return;
                }
                var allStages = [];
                for (var i = 0; i < maxLen; i++) {
                    allStages.push({
                        cracking_data: cracking[i] || {},
                        washing_data:  washing[i]  || {},
                        sorting_data:  sorting[i]  || {},
                        packing_data:  packing[i]  || {}
                    });
                }
                var agg = scope.aggregateProductionStages(allStages);
                var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
                $body.html(scope.renderBatchSummaryHtml(agg, maxLen, batch, detail));
                $('#batchSummaryModal').data('current-batch-id', batchId);
                var $finishBtn = $('#batchSummaryFinishProductionBtn');
                if ($finishBtn.length) $finishBtn.toggle(!!(batch && !batch.production_finished_at));
            }).catch(function (err) {
                console.error('[Batch Summary] Failed to load kernel detail:', err);
                $body.html('<p class="text-danger mb-0">Unable to load batch data. Please try again.</p>');
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
                            if (key === 'date') continue; // skip date field
                            var v = data[key];
                            // Values come from JSONB as strings — parse to number
                            var n = (typeof v === 'number') ? v : parseFloat(v);
                            if (!isNaN(n)) agg[sec][key] = (agg[sec][key] || 0) + n;
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
            var totalWeight = (agg.summary_data && (agg.summary_data.pack_total_qty != null || agg.summary_data.crack_qty != null)) ? (agg.summary_data.pack_total_qty != null ? agg.summary_data.pack_total_qty : agg.summary_data.crack_qty) : (skTotalKg + btTotalKg) || null;
            var c = (agg.cracking_data && typeof agg.cracking_data === 'object') ? agg.cracking_data : {};
            var w = (agg.washing_data && typeof agg.washing_data === 'object') ? agg.washing_data : {};
            var s = (agg.sorting_data && typeof agg.sorting_data === 'object') ? agg.sorting_data : {};
            var batchNumber = (batch && batch.batch_number) ? String(batch.batch_number) : null;
            if (!batchNumber && unwrapped.length) {
                var firstCrack = unwrapped[0].cracking_data;
                if (firstCrack && (firstCrack.batch1 != null && firstCrack.batch1 !== '')) batchNumber = String(firstCrack.batch1);
            }
            return {
                p_batch_number: batchNumber,
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

        renderBatchSummaryHtml: (agg, dayCount, batch, detail) => {
            var n = function (v) { return (v != null && typeof v === 'number') ? v : parseFloat(v); };
            var kg = function (v) { var x = n(v); return isNaN(x) ? '—' : x.toFixed(1) + ' kg'; };
            var num = function (v) { var x = n(v); return isNaN(x) ? '—' : (x % 1 === 0 ? String(x) : x.toFixed(2)); };
            var pct = function (v) { var x = n(v); return isNaN(x) ? '—' : x.toFixed(1) + '%'; };
            var has = function (obj, k) { return obj && obj[k] != null && obj[k] !== '' && !isNaN(n(obj[k])); };
            var v = function (obj, k) { return has(obj, k) ? n(obj[k]) : 0; };

            var c = agg.cracking_data || {};
            var w = agg.washing_data || {};
            var s = agg.sorting_data || {};
            var p = agg.packing_data || {};

            /* ── Inline styles (scoped to summary) ── */
            var styles = {
                card: 'border-radius:12px;padding:16px 20px;background:var(--mac-surface, #f8f9fa);border:1px solid var(--mac-border, #e0e0e0);',
                metricCard: 'text-align:center;border-radius:12px;padding:14px 10px;background:var(--mac-surface, #f8f9fa);border:1px solid var(--mac-border, #e0e0e0);flex:1;min-width:120px;',
                metricVal: 'font-size:1.5rem;font-weight:700;color:var(--mac-green, #2e7d32);line-height:1.2;',
                metricLabel: 'font-size:0.75rem;color:var(--mac-text-secondary, #666);text-transform:uppercase;letter-spacing:0.04em;margin-top:4px;',
                sectionTitle: 'font-size:0.85rem;font-weight:700;color:var(--mac-green, #2e7d32);text-transform:uppercase;letter-spacing:0.06em;margin:20px 0 10px 0;padding-bottom:6px;border-bottom:2px solid var(--mac-green, #2e7d32);',
                row: 'display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--mac-border-light, rgba(0,0,0,0.05));',
                rowLabel: 'color:var(--mac-text-secondary, #666);font-size:0.85rem;',
                rowValue: 'font-weight:600;font-size:0.85rem;',
                barOuter: 'height:8px;border-radius:4px;background:var(--mac-border, #e0e0e0);overflow:hidden;flex:1;margin-left:10px;',
                barInner: 'height:100%;border-radius:4px;transition:width 0.3s;',
                pill: 'display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.75rem;font-weight:600;',
                flowArrow: 'display:flex;align-items:center;justify-content:center;color:var(--mac-text-secondary, #999);font-size:1.2rem;padding:4px 0;'
            };

            var html = [];

            /* ═══════════════════════════════════════════
               HEADER — Batch info + key metrics
               ═══════════════════════════════════════════ */
            var batchName = (batch && batch.batch_number) ? batch.batch_number : (detail && detail.batch_number) ? detail.batch_number : '';
            var grower = (batch && batch.grower_name) ? batch.grower_name : (detail && detail.supplier_name) ? detail.supplier_name : '';
            var nisReceived = (detail && detail.wet_nis_received_kg) ? n(detail.wet_nis_received_kg) : ((batch && batch.wet_nis_received_kg) ? n(batch.wet_nis_received_kg) : NaN);
            var status = (batch && batch.status) ? batch.status : (detail && detail.status) ? detail.status : '';

            // Status pill colour
            var statusColour = '#888';
            if (status === 'production') statusColour = '#f59e0b';
            else if (status === 'qa') statusColour = '#3b82f6';
            else if (status === 'complete' || status === 'dispatch') statusColour = '#22c55e';
            else if (status === 'intake' || status === 'receiving') statusColour = '#8b5cf6';

            html.push('<div style="margin-bottom:18px;">');
            if (batchName || grower) {
                html.push('<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px;">');
                if (batchName) html.push('<span style="font-size:1.1rem;font-weight:700;">' + batchName + '</span>');
                if (status) html.push('<span style="' + styles.pill + 'background:' + statusColour + '20;color:' + statusColour + ';">' + status.charAt(0).toUpperCase() + status.slice(1) + '</span>');
                html.push('</div>');
                if (grower) html.push('<div style="color:var(--mac-text-secondary,#666);font-size:0.85rem;">Grower: ' + grower + '</div>');
            }
            html.push('<div style="color:var(--mac-text-secondary,#666);font-size:0.8rem;margin-top:4px;">' + dayCount + ' production day' + (dayCount !== 1 ? 's' : '') + ' recorded</div>');
            html.push('</div>');

            /* ── Top-level KPI cards ── */
            var crackOutput = v(c, 'total_output');
            var totalSKkg = v(p, 'total_sk_kg');
            var totalBTkg = v(p, 'total_bt_kg');
            var packedTotal = totalSKkg + totalBTkg;
            var crackPct = has(c, 'cracking_percentage') ? n(c.cracking_percentage) : NaN;

            html.push('<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">');
            if (!isNaN(nisReceived)) {
                html.push('<div style="' + styles.metricCard + '"><div style="' + styles.metricVal + '">' + nisReceived.toFixed(0) + '</div><div style="' + styles.metricLabel + '">NIS Received (kg)</div></div>');
            }
            if (crackOutput > 0) {
                html.push('<div style="' + styles.metricCard + '"><div style="' + styles.metricVal + '">' + crackOutput.toFixed(0) + '</div><div style="' + styles.metricLabel + '">Kernel Cracked (kg)</div></div>');
            }
            if (packedTotal > 0) {
                html.push('<div style="' + styles.metricCard + '"><div style="' + styles.metricVal + '">' + packedTotal.toFixed(0) + '</div><div style="' + styles.metricLabel + '">Total Packed (kg)</div></div>');
            }
            if (!isNaN(crackPct)) {
                html.push('<div style="' + styles.metricCard + '"><div style="' + styles.metricVal + '">' + crackPct.toFixed(1) + '%</div><div style="' + styles.metricLabel + '">Cracking Yield</div></div>');
            }
            html.push('</div>');

            /* ═══════════════════════════════════════════
               HELPER: build a detail row
               ═══════════════════════════════════════════ */
            var row = function (label, value, indent) {
                return '<div style="' + styles.row + (indent ? 'padding-left:12px;' : '') + '"><span style="' + styles.rowLabel + '">' + label + '</span><span style="' + styles.rowValue + '">' + value + '</span></div>';
            };
            var sectionHead = function (title) {
                return '<div style="' + styles.sectionTitle + '">' + title + '</div>';
            };

            /* ═══════════════════════════════════════════
               1. CRACKING
               ═══════════════════════════════════════════ */
            if (Object.keys(c).length) {
                html.push(sectionHead('Cracking'));
                html.push('<div style="' + styles.card + '">');

                if (has(c, 'silo1')) html.push(row('Silo Input', kg(c.silo1)));
                if (has(c, 'startqty1')) html.push(row('Start Quantity', kg(c.startqty1)));

                // Summarise wholes/halves across time slots as totals only
                var totalWholes = v(c, 'total_wholes');
                var totalHalves = v(c, 'total_halves');
                var totalInshell = v(c, 'total_inshell');
                var totalReject = v(c, 'total_reject');

                if (totalWholes > 0 || totalHalves > 0) {
                    html.push('<div style="margin:10px 0 6px 0;font-weight:600;font-size:0.8rem;color:var(--mac-text-secondary,#666);text-transform:uppercase;letter-spacing:0.04em;">Kernel Output</div>');
                    if (totalWholes > 0) html.push(row('Wholes', kg(totalWholes), true));
                    if (totalHalves > 0) html.push(row('Halves', kg(totalHalves), true));
                    if (totalInshell > 0) html.push(row('In-Shell', kg(totalInshell), true));
                    if (totalReject > 0) html.push(row('Rejects', kg(totalReject), true));
                }

                if (has(c, 'total_output')) html.push(row('Total Kernel Output', kg(c.total_output)));

                // Shell & waste
                var shellTotal = v(c, 'shell_total');
                var shellCarryover = v(c, 'shell_carryover');
                var shellFines = v(c, 'shell_fines');
                if (shellTotal > 0 || shellCarryover > 0 || shellFines > 0) {
                    html.push('<div style="margin:10px 0 6px 0;font-weight:600;font-size:0.8rem;color:var(--mac-text-secondary,#666);text-transform:uppercase;letter-spacing:0.04em;">Shell & Waste</div>');
                    if (shellTotal > 0) html.push(row('Shell', kg(shellTotal), true));
                    if (shellCarryover > 0) html.push(row('Carry Over', kg(shellCarryover), true));
                    if (shellFines > 0) html.push(row('Shell & Fines', kg(shellFines), true));
                }

                if (has(c, 'cracking_percentage')) {
                    var cp = n(c.cracking_percentage);
                    html.push('<div style="display:flex;align-items:center;margin-top:10px;">');
                    html.push('<span style="font-size:0.85rem;font-weight:600;min-width:110px;">Cracking Yield</span>');
                    html.push('<div style="' + styles.barOuter + '"><div style="' + styles.barInner + 'width:' + Math.min(cp, 100) + '%;background:var(--mac-green,#2e7d32);"></div></div>');
                    html.push('<span style="font-weight:700;margin-left:10px;min-width:50px;text-align:right;">' + pct(cp) + '</span>');
                    html.push('</div>');
                }

                html.push('</div>');
                html.push('<div style="' + styles.flowArrow + '">&#8595;</div>');
            }

            /* ═══════════════════════════════════════════
               2. WASHING
               ═══════════════════════════════════════════ */
            if (Object.keys(w).length) {
                html.push(sectionHead('Washing'));
                html.push('<div style="' + styles.card + '">');

                if (has(w, 'total_in')) html.push(row('Total In', kg(w.total_in)));
                else if (has(w, 'crates_in')) html.push(row('Crates In', num(w.crates_in)));

                // Sinker / Floater split
                var sinkerT = v(w, 'sinker_total');
                var floaterT = v(w, 'floater_total');
                if (sinkerT > 0 || floaterT > 0) {
                    var splitTotal = sinkerT + floaterT;
                    html.push('<div style="margin:10px 0 6px 0;font-weight:600;font-size:0.8rem;color:var(--mac-text-secondary,#666);text-transform:uppercase;letter-spacing:0.04em;">Float Test Split</div>');
                    html.push(row('Sinkers (good kernel)', kg(sinkerT), true));
                    html.push(row('Floaters', kg(floaterT), true));
                    if (splitTotal > 0) {
                        var sinkerPct = (sinkerT / splitTotal * 100);
                        html.push('<div style="display:flex;align-items:center;margin:6px 0 0 12px;">');
                        html.push('<span style="font-size:0.8rem;color:var(--mac-text-secondary,#666);min-width:90px;">Sinker ratio</span>');
                        html.push('<div style="' + styles.barOuter + '">');
                        html.push('<div style="' + styles.barInner + 'width:' + sinkerPct.toFixed(0) + '%;background:#22c55e;"></div>');
                        html.push('</div>');
                        html.push('<span style="font-weight:600;margin-left:10px;font-size:0.8rem;">' + sinkerPct.toFixed(0) + '%</span>');
                        html.push('</div>');
                    }
                }

                if (has(w, 'total_output')) html.push(row('Total Output', kg(w.total_output)));

                // Waste
                var wShell = v(w, 'waste_shellfines');
                var wCompost = v(w, 'waste_compost');
                if (wShell > 0 || wCompost > 0) {
                    html.push('<div style="margin:10px 0 6px 0;font-weight:600;font-size:0.8rem;color:var(--mac-text-secondary,#666);text-transform:uppercase;letter-spacing:0.04em;">Waste</div>');
                    if (wShell > 0) html.push(row('Shell & Fines', kg(wShell), true));
                    if (wCompost > 0) html.push(row('Compost', kg(wCompost), true));
                    if (has(w, 'waste_total')) html.push(row('Total Waste', kg(w.waste_total), true));
                }

                if (has(w, 'recovery')) {
                    var wr = n(w.recovery);
                    html.push('<div style="display:flex;align-items:center;margin-top:10px;">');
                    html.push('<span style="font-size:0.85rem;font-weight:600;min-width:110px;">Recovery</span>');
                    html.push('<div style="' + styles.barOuter + '"><div style="' + styles.barInner + 'width:' + Math.min(wr, 100) + '%;background:#3b82f6;"></div></div>');
                    html.push('<span style="font-weight:700;margin-left:10px;min-width:50px;text-align:right;">' + pct(wr) + '</span>');
                    html.push('</div>');
                }

                html.push('</div>');
                html.push('<div style="' + styles.flowArrow + '">&#8595;</div>');
            }

            /* ═══════════════════════════════════════════
               3. SORTING — Grade distribution
               ═══════════════════════════════════════════ */
            if (Object.keys(s).length) {
                html.push(sectionHead('Sorting'));
                html.push('<div style="' + styles.card + '">');

                if (has(s, 'total_in')) html.push(row('Total In', kg(s.total_in)));
                else if (has(s, 'crates_in')) html.push(row('Crates In', num(s.crates_in)));

                // Grade distribution as stacked bar + rows
                var grades = [
                    { key: 'style0',  label: 'Style 0 (Premium)',  color: '#16a34a' },
                    { key: 'style1',  label: 'Style 1',            color: '#22c55e' },
                    { key: 'style1s', label: 'Style 1s',           color: '#4ade80' },
                    { key: 'style4l', label: 'Style 4L',           color: '#86efac' },
                    { key: 'style5',  label: 'Style 5',            color: '#bbf7d0' },
                    { key: 'style6',  label: 'Style 6 (Butter)',   color: '#fbbf24' },
                    { key: 'style78', label: 'Style 7/8 (Butter)', color: '#f59e0b' }
                ];

                var gradeData = [];
                var gradeTotal = 0;
                grades.forEach(function (g) {
                    var wt = v(s, g.key + '_weight');
                    var qt = v(s, g.key + '_qty');
                    if (wt > 0 || qt > 0) {
                        gradeData.push({ label: g.label, weight: wt, qty: qt, color: g.color });
                        gradeTotal += wt;
                    }
                });

                if (gradeData.length > 0) {
                    html.push('<div style="margin:10px 0 6px 0;font-weight:600;font-size:0.8rem;color:var(--mac-text-secondary,#666);text-transform:uppercase;letter-spacing:0.04em;">Grade Distribution</div>');

                    // Stacked bar
                    if (gradeTotal > 0) {
                        html.push('<div style="display:flex;height:14px;border-radius:7px;overflow:hidden;margin-bottom:10px;">');
                        gradeData.forEach(function (g) {
                            var widthPct = (g.weight / gradeTotal * 100).toFixed(1);
                            if (parseFloat(widthPct) > 0) {
                                html.push('<div style="width:' + widthPct + '%;background:' + g.color + ';" title="' + g.label + ': ' + g.weight.toFixed(1) + ' kg (' + widthPct + '%)"></div>');
                            }
                        });
                        html.push('</div>');
                    }

                    // Legend rows
                    gradeData.forEach(function (g) {
                        var detail = g.weight > 0 ? g.weight.toFixed(1) + ' kg' : '';
                        if (g.qty > 0) detail += (detail ? ' / ' : '') + num(g.qty) + ' crates';
                        if (gradeTotal > 0 && g.weight > 0) detail += ' (' + (g.weight / gradeTotal * 100).toFixed(0) + '%)';
                        html.push('<div style="display:flex;align-items:center;padding:3px 0 3px 12px;">');
                        html.push('<span style="width:10px;height:10px;border-radius:50%;background:' + g.color + ';margin-right:8px;flex-shrink:0;"></span>');
                        html.push('<span style="' + styles.rowLabel + 'flex:1;">' + g.label + '</span>');
                        html.push('<span style="' + styles.rowValue + '">' + detail + '</span>');
                        html.push('</div>');
                    });
                }

                // Waste
                var oilKernel = v(s, 'oil_weight') || v(s, 'oil_qty');
                var compost = v(s, 'compost_weight') || v(s, 'compost_qty');
                if (oilKernel > 0 || compost > 0) {
                    html.push('<div style="margin:10px 0 6px 0;font-weight:600;font-size:0.8rem;color:var(--mac-text-secondary,#666);text-transform:uppercase;letter-spacing:0.04em;">Waste & By-product</div>');
                    if (oilKernel > 0) html.push(row('Oil Kernel', kg(oilKernel), true));
                    if (compost > 0) html.push(row('Compost', kg(compost), true));
                }

                if (has(s, 'total_output')) html.push(row('Total Output', kg(s.total_output)));
                if (has(s, 'recovery')) {
                    var sr = n(s.recovery);
                    html.push('<div style="display:flex;align-items:center;margin-top:10px;">');
                    html.push('<span style="font-size:0.85rem;font-weight:600;min-width:110px;">Recovery</span>');
                    html.push('<div style="' + styles.barOuter + '"><div style="' + styles.barInner + 'width:' + Math.min(sr, 100) + '%;background:#8b5cf6;"></div></div>');
                    html.push('<span style="font-weight:700;margin-left:10px;min-width:50px;text-align:right;">' + pct(sr) + '</span>');
                    html.push('</div>');
                }

                html.push('</div>');
                html.push('<div style="' + styles.flowArrow + '">&#8595;</div>');
            }

            /* ═══════════════════════════════════════════
               4. PACKING — Final product
               ═══════════════════════════════════════════ */
            if (Object.keys(p).length) {
                html.push(sectionHead('Packing'));
                html.push('<div style="' + styles.card + '">');

                // Sound Kernel table
                var skStyles = [
                    ['sk_sp',  'Special'],
                    ['sk_0',   'Style 0'],
                    ['sk_1',   'Style 1'],
                    ['sk_1s',  'Style 1s'],
                    ['sk_4l',  'Style 4L'],
                    ['sk_5',   'Style 5']
                ];
                var hasSK = skStyles.some(function (s) { return v(p, s[0] + '_qty') > 0 || v(p, s[0] + '_cartons') > 0; });
                if (hasSK) {
                    html.push('<div style="margin:4px 0 8px 0;font-weight:600;font-size:0.8rem;color:var(--mac-text-secondary,#666);text-transform:uppercase;letter-spacing:0.04em;">Sound Kernel</div>');
                    html.push('<table style="width:100%;font-size:0.85rem;border-collapse:collapse;"><thead><tr style="border-bottom:2px solid var(--mac-border,#e0e0e0);">');
                    html.push('<th style="text-align:left;padding:4px 0;color:var(--mac-text-secondary,#666);font-weight:600;">Grade</th>');
                    html.push('<th style="text-align:right;padding:4px 0;color:var(--mac-text-secondary,#666);font-weight:600;">Qty (kg)</th>');
                    html.push('<th style="text-align:right;padding:4px 0;color:var(--mac-text-secondary,#666);font-weight:600;">Cartons</th>');
                    html.push('</tr></thead><tbody>');
                    skStyles.forEach(function (pair) {
                        var qty = v(p, pair[0] + '_qty');
                        var ctn = v(p, pair[0] + '_cartons');
                        if (qty > 0 || ctn > 0) {
                            html.push('<tr style="border-bottom:1px solid var(--mac-border-light,rgba(0,0,0,0.05));">');
                            html.push('<td style="padding:4px 0;">' + pair[1] + '</td>');
                            html.push('<td style="text-align:right;padding:4px 0;font-weight:600;">' + (qty > 0 ? qty.toFixed(1) : '—') + '</td>');
                            html.push('<td style="text-align:right;padding:4px 0;font-weight:600;">' + (ctn > 0 ? num(ctn) : '—') + '</td>');
                            html.push('</tr>');
                        }
                    });
                    if (has(p, 'total_sk_kg') || has(p, 'total_sk_cartons')) {
                        html.push('<tr style="border-top:2px solid var(--mac-border,#e0e0e0);font-weight:700;">');
                        html.push('<td style="padding:4px 0;">Total</td>');
                        html.push('<td style="text-align:right;padding:4px 0;">' + (v(p, 'total_sk_kg') > 0 ? v(p, 'total_sk_kg').toFixed(1) : '—') + '</td>');
                        html.push('<td style="text-align:right;padding:4px 0;">' + (v(p, 'total_sk_cartons') > 0 ? num(v(p, 'total_sk_cartons')) : '—') + '</td>');
                        html.push('</tr>');
                    }
                    html.push('</tbody></table>');
                }

                // Butter Grade table
                var btStyles = [
                    ['bt_78',   'Style 7/8'],
                    ['bt_high', 'High Grade'],
                    ['bt_low',  'Low Grade']
                ];
                var hasBT = btStyles.some(function (s) { return v(p, s[0] + '_qty') > 0 || v(p, s[0] + '_cartons') > 0; });
                if (hasBT) {
                    html.push('<div style="margin:14px 0 8px 0;font-weight:600;font-size:0.8rem;color:var(--mac-text-secondary,#666);text-transform:uppercase;letter-spacing:0.04em;">Butter Grade</div>');
                    html.push('<table style="width:100%;font-size:0.85rem;border-collapse:collapse;"><thead><tr style="border-bottom:2px solid var(--mac-border,#e0e0e0);">');
                    html.push('<th style="text-align:left;padding:4px 0;color:var(--mac-text-secondary,#666);font-weight:600;">Grade</th>');
                    html.push('<th style="text-align:right;padding:4px 0;color:var(--mac-text-secondary,#666);font-weight:600;">Qty (kg)</th>');
                    html.push('<th style="text-align:right;padding:4px 0;color:var(--mac-text-secondary,#666);font-weight:600;">Cartons</th>');
                    html.push('</tr></thead><tbody>');
                    btStyles.forEach(function (pair) {
                        var qty = v(p, pair[0] + '_qty');
                        var ctn = v(p, pair[0] + '_cartons');
                        if (qty > 0 || ctn > 0) {
                            html.push('<tr style="border-bottom:1px solid var(--mac-border-light,rgba(0,0,0,0.05));">');
                            html.push('<td style="padding:4px 0;">' + pair[1] + '</td>');
                            html.push('<td style="text-align:right;padding:4px 0;font-weight:600;">' + (qty > 0 ? qty.toFixed(1) : '—') + '</td>');
                            html.push('<td style="text-align:right;padding:4px 0;font-weight:600;">' + (ctn > 0 ? num(ctn) : '—') + '</td>');
                            html.push('</tr>');
                        }
                    });
                    if (has(p, 'total_bt_kg') || has(p, 'total_bt_cartons')) {
                        html.push('<tr style="border-top:2px solid var(--mac-border,#e0e0e0);font-weight:700;">');
                        html.push('<td style="padding:4px 0;">Total</td>');
                        html.push('<td style="text-align:right;padding:4px 0;">' + (v(p, 'total_bt_kg') > 0 ? v(p, 'total_bt_kg').toFixed(1) : '—') + '</td>');
                        html.push('<td style="text-align:right;padding:4px 0;">' + (v(p, 'total_bt_cartons') > 0 ? num(v(p, 'total_bt_cartons')) : '—') + '</td>');
                        html.push('</tr>');
                    }
                    html.push('</tbody></table>');
                }

                html.push('</div>');
            }

            /* ═══════════════════════════════════════════
               OVERALL YIELD WATERFALL (if enough data)
               ═══════════════════════════════════════════ */
            if (!isNaN(nisReceived) && nisReceived > 0 && packedTotal > 0) {
                var overallYield = (packedTotal / nisReceived * 100);
                html.push('<div style="margin-top:20px;' + styles.card + 'background:var(--mac-green,#2e7d32)10;border-color:var(--mac-green,#2e7d32)30;">');
                html.push('<div style="display:flex;justify-content:space-between;align-items:center;">');
                html.push('<div>');
                html.push('<div style="font-weight:700;font-size:0.9rem;">Overall Yield: NIS to Packed Product</div>');
                html.push('<div style="color:var(--mac-text-secondary,#666);font-size:0.8rem;margin-top:2px;">' + nisReceived.toFixed(0) + ' kg NIS received &rarr; ' + packedTotal.toFixed(0) + ' kg packed</div>');
                html.push('</div>');
                html.push('<div style="font-size:1.6rem;font-weight:800;color:var(--mac-green,#2e7d32);">' + overallYield.toFixed(1) + '%</div>');
                html.push('</div>');
                html.push('<div style="margin-top:8px;' + styles.barOuter + 'height:10px;margin-left:0;"><div style="' + styles.barInner + 'width:' + Math.min(overallYield, 100) + '%;background:var(--mac-green,#2e7d32);height:10px;"></div></div>');
                html.push('</div>');
            }

            return html.join('');
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

        /** Completes the "Finish batch production" action: sets production_finished_at, status→qa, auto-saves job card, closes modal, refreshes grid. */
        doFinishBatchProduction: (batchId) => {
            const scope = _modal_production_stages;
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.upsertKernelProduction !== 'function') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Finish batch function not available', 'error');
                return;
            }
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch(batchId) : null;
            // Build job card from current loaded stage arrays
            var detail = scope._loadedKernelDetail;
            var cracking = (detail && Array.isArray(detail.cracking_data)) ? detail.cracking_data : [];
            var washing  = (detail && Array.isArray(detail.washing_data))  ? detail.washing_data  : [];
            var sorting  = (detail && Array.isArray(detail.sorting_data))  ? detail.sorting_data  : [];
            var packing  = (detail && Array.isArray(detail.packing_data))  ? detail.packing_data  : [];
            var maxLen = Math.max(cracking.length, washing.length, sorting.length, packing.length);
            var allStages = [];
            for (var i = 0; i < maxLen; i++) {
                allStages.push({ cracking_data: cracking[i] || {}, washing_data: washing[i] || {}, sorting_data: sorting[i] || {}, packing_data: packing[i] || {} });
            }
            var jobCardPayload = null;
            if (allStages.length > 0) {
                var p = scope.buildJobCardPayloadFromBatchAndStages(batchId, batch, allStages);
                if (p) {
                    // Convert p_* payload to flat object for job_card_data JSONB (always save when we have production data)
                    jobCardPayload = {};
                    Object.keys(p).forEach(function (k) {
                        jobCardPayload[k.replace(/^p_/, '')] = p[k];
                    });
                }
            }
            dataFunctions.upsertKernelProduction(batchId, {
                finishProduction: true,
                jobCardData: jobCardPayload
            }).then(function (result) {
                var inner = (result && result.upsert_kernel_production) ? result.upsert_kernel_production : result;
                if (inner && inner.success === false) throw new Error(inner.error || 'Failed to finish');
                if (typeof Swal !== 'undefined') Swal.fire('Saved', 'Batch production marked as finished.', 'success');
                scope._loadedKernelDetail = null;
                var modalEl = document.getElementById('productionStagesModal');
                if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).hide();
                else if (typeof $ !== 'undefined') $('#productionStagesModal').modal('hide');
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
            }).catch(function (e) {
                if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to finish batch production', 'error');
            });
        },

        /** Upsert an entry into a JSONB array by matching the 'date' field. Returns updated array. */
        _upsertByDate: (arr, data) => {
            if (!data || !data.date || data.date === '') return Array.isArray(arr) ? arr : [];
            arr = Array.isArray(arr) ? arr.slice() : [];
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] && arr[i].date === data.date) {
                    arr[i] = data;
                    return arr;
                }
            }
            arr.push(data);
            return arr;
        },

        /** Rebuild the day list from the union of dates across all cached arrays. */
        _rebuildDayListFromCache: () => {
            const scope = _modal_production_stages;
            var detail = scope._loadedKernelDetail;
            if (!detail) return;
            var allDates = {};
            ['cracking_data', 'washing_data', 'sorting_data', 'packing_data'].forEach(function (key) {
                (detail[key] || []).forEach(function (entry) {
                    if (entry && entry.date && entry.date !== '') allDates[entry.date] = true;
                });
            });
            var dates = Object.keys(allDates).sort();
            var list = [];
            dates.forEach(function (dt, idx) {
                list.push({ id: dt, date: dt, day_number: idx + 1, kernel_production_stages_id: dt });
            });
            if (list.length === 0) {
                list = [{ id: 'new', date: '', day_number: 1, kernel_production_stages_id: null }];
            }
            scope.modalProductionDays = list;
            scope.renderProductionDaysList(list);
        },

        saveProductionStages: () => {
            _modal_production_stages.doSaveProductionStages(false);
        },

        /**
         * Core save: persists current form to backend. When silent is true, no success toast (for auto-save).
         * Shows "Saving..." / "Saved" in the status span when silent.
         */
        doSaveProductionStages: (silent) => {
            const scope = _modal_production_stages;
            var batchId = $('#productionStagesBatchId').val();
            var dayId = $('#productionStagesDayId').val();
            if (!batchId) {
                if (!silent && typeof Swal !== 'undefined') Swal.fire('Error', 'Batch not selected', 'error');
                return;
            }
            if (dayId == null || dayId === '') {
                if (!silent && typeof Swal !== 'undefined') Swal.fire('Error', 'Select or add a day first, then save.', 'error');
                return;
            }
            var $status = $('#productionStagesAutoSaveStatus');
            if (silent && $status.length) $status.removeClass('text-success text-danger').text('Saving…');
            scope.persistCurrentTabToStages();
            var cracking_data = scope.getProductionStagesSectionData('crack');
            var washing_data = scope.getProductionStagesSectionData('wash');
            var sorting_data = scope.getProductionStagesSectionData('sort');
            var packing_data = scope.getProductionStagesSectionData('pack');
            var summary_data = deriveSummaryFromStages(cracking_data, washing_data, sorting_data, packing_data);

            // Validate: at least cracking must have a date
            if (!cracking_data.date || cracking_data.date === '') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Cracking date is required. Please set a date on the Cracking tab.', 'error');
                return;
            }

            // Do not auto-finish production when packing is complete — there may be multiple days (e.g. 3 days).
            // User must explicitly click "Finish batch production" in the Batch summary modal.
            dataFunctions.upsertKernelProduction(batchId, {
                crackingData: cracking_data,
                washingData: washing_data,
                sortingData: sorting_data,
                packingData: packing_data,
                finishProduction: false
            }).then(function (result) {
                var inner = (result && result.upsert_kernel_production) ? result.upsert_kernel_production : result;
                if (inner && inner.success === false) throw new Error(inner.error || 'Save failed');
                // Update cached detail by date (upsert into each array)
                if (scope._loadedKernelDetail) {
                    scope._loadedKernelDetail.cracking_data = scope._upsertByDate(scope._loadedKernelDetail.cracking_data, cracking_data);
                    scope._loadedKernelDetail.washing_data  = scope._upsertByDate(scope._loadedKernelDetail.washing_data,  washing_data);
                    scope._loadedKernelDetail.sorting_data  = scope._upsertByDate(scope._loadedKernelDetail.sorting_data,  sorting_data);
                    scope._loadedKernelDetail.packing_data  = scope._upsertByDate(scope._loadedKernelDetail.packing_data,  packing_data);
                }
                scope.modalProductionDayStages = { cracking_data: cracking_data, washing_data: washing_data, sorting_data: sorting_data, packing_data: packing_data, summary_data: summary_data };
                // Rebuild the day list from cached arrays and set active day to cracking date
                scope._rebuildDayListFromCache();
                var primaryDate = cracking_data.date || washing_data.date || sorting_data.date || packing_data.date;
                if (primaryDate) {
                    $('#productionStagesDayId').val(primaryDate);
                    scope.setProductionDayActive(primaryDate);
                }
                scope.updateProductionActionButtonTicks();
                scope.clearProductionStagesDraft(batchId);
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                if (silent) {
                    if ($status.length) { $status.removeClass('text-danger').addClass('text-success').text('Saved'); }
                    setTimeout(function () { if ($status.length) $status.text(''); }, 2000);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Saved', 'Production stages saved for this day.', 'success');
                }
            }).catch(function (e) {
                if ($status.length) { $status.removeClass('text-success').addClass('text-danger').text('Save failed'); }
                if (!silent && typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to save production stages', 'error');
                else if (silent && typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Auto-save failed', 'error');
            });
        },

        /** Schedules a single auto-save after AUTO_SAVE_DELAY_MS. Cancels any pending auto-save. */
        scheduleAutoSave: () => {
            const scope = _modal_production_stages;
            var batchId = $('#productionStagesBatchId').val();
            var dayId = $('#productionStagesDayId').val();
            if (!batchId || dayId == null || dayId === '') return;
            if (scope._autoSaveTimer) clearTimeout(scope._autoSaveTimer);
            scope._autoSaveTimer = setTimeout(function () {
                scope._autoSaveTimer = null;
                scope.doSaveProductionStages(true);
            }, AUTO_SAVE_DELAY_MS);
        },

        /** Runs any pending auto-save immediately, then clears the timer. Call before switching day or closing modal. */
        flushAutoSave: () => {
            const scope = _modal_production_stages;
            if (scope._autoSaveTimer) {
                clearTimeout(scope._autoSaveTimer);
                scope._autoSaveTimer = null;
                scope.doSaveProductionStages(true);
            }
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
            $('#productionStagesBatchNumber').text(batch.batch_number || batchId || '');
            $('#productionStagesDayId').val('');
            scope.clearProductionStagesForm();
            scope._loadedKernelDetail = null;

            var dateVal = batch.received_date ? (batch.received_date.toString().split('T')[0]) : (new Date().toISOString().split('T')[0]);

            // Load full kernel detail (stage arrays) via getKernelBatchDetail
            dataFunctions.getKernelBatchDetail(batchId).then(function (detail) {
                scope._loadedKernelDetail = detail;
                var cracking = (detail && Array.isArray(detail.cracking_data)) ? detail.cracking_data : [];
                var washing  = (detail && Array.isArray(detail.washing_data))  ? detail.washing_data  : [];
                var sorting  = (detail && Array.isArray(detail.sorting_data))  ? detail.sorting_data  : [];
                var packing  = (detail && Array.isArray(detail.packing_data))  ? detail.packing_data  : [];

                // Patch legacy entries: if an entry has no date, inherit from cracking at same index
                [washing, sorting, packing].forEach(function (arr) {
                    arr.forEach(function (entry, idx) {
                        if (entry && (!entry.date || entry.date === '') && cracking[idx] && cracking[idx].date) {
                            entry.date = cracking[idx].date;
                        }
                    });
                });

                // Build day list from unique dates across all 4 arrays
                var allDates = {};
                [cracking, washing, sorting, packing].forEach(function (arr) {
                    (arr || []).forEach(function (entry) {
                        if (entry && entry.date && entry.date !== '') allDates[entry.date] = true;
                    });
                });
                var dates = Object.keys(allDates).sort();
                var list = [];
                dates.forEach(function (dt, idx) {
                    list.push({ id: dt, date: dt, day_number: idx + 1, kernel_production_stages_id: dt });
                });

                // If no days yet, start with an empty new day
                if (list.length === 0) {
                    list = [{ id: 'new', date: '', day_number: 1, kernel_production_stages_id: null }];
                }

                scope.modalProductionDays = list;
                scope.setProductionStagesTabsVisibility(true);
                var first = list[0];
                $('#productionStagesDayId').val(first.id);

                return scope.populateProductionGrowerSelects(batch.grower_name || '').then(function () {
                    return scope.loadProductionStagesForDay(first.date || first.id, first.kernel_production_stages_id);
                }).then(function () {
                    // For new days (no saved data), set default dates in all section date fields
                    if (!first.date || first.date === '') {
                        var defaultDisplay = fromISO(dateVal);
                        $('#ps_crack_date').val(defaultDisplay);
                        $('#ps_wash_date').val(defaultDisplay);
                        $('#ps_sort_date').val(defaultDisplay);
                        $('#ps_pack_date').val(defaultDisplay);
                    }
                    scope.renderProductionDaysList(list);
                    scope.setProductionDayActive(first.id);
                    scope.updateProductionActionButtonTicks();
                });
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

        showProductionStagesViewModal: (dayIdOrDate) => {
            var $body = $('#productionStagesViewBody');
            if (!$body.length) return;
            $body.html('<p class="text-muted mb-0">Loading…</p>');
            var modalEl = document.getElementById('productionStagesViewModal');
            if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(modalEl).show();
            else $('#productionStagesViewModal').modal('show');
            // Use cached kernel detail — read stage data by date
            var scope = _modal_production_stages;
            var detail = scope._loadedKernelDetail;
            var s = detail ? {
                cracking_data: scope._findByDate(detail.cracking_data, dayIdOrDate),
                washing_data:  scope._findByDate(detail.washing_data,  dayIdOrDate),
                sorting_data:  scope._findByDate(detail.sorting_data,  dayIdOrDate),
                packing_data:  scope._findByDate(detail.packing_data,  dayIdOrDate)
            } : null;
            if (!s) { $body.html('<p class="text-muted mb-0">Production record not found.</p>'); return; }
            var fmt = function (v) { return v != null && v !== '' ? String(v) : '—'; };
            var renderSection = function (data) {
                if (!data || typeof data !== 'object') return '<p class="text-muted mb-0">No data</p>';
                var rows = [];
                for (var k in data) { if (data.hasOwnProperty(k)) rows.push('<tr><td class="text-nowrap">' + k + '</td><td>' + fmt(data[k]) + '</td></tr>'); }
                return rows.length ? '<table class="table table-sm table-bordered mb-2"><tbody>' + rows.join('') + '</tbody></table>' : '<p class="text-muted mb-0">No data</p>';
            };
            var batchNum = detail ? (detail.batch_number || '—') : '—';
            var grower   = detail ? (detail.grower_name || '—') : '—';
            var html = '<div class="small"><p class="mb-2"><strong>Batch:</strong> ' + fmt(batchNum) + ' &nbsp; <strong>Grower:</strong> ' + fmt(grower) + '</p>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Cracking</strong></div><div class="card-body py-2">' + renderSection(s.cracking_data) + '</div></div>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Washing</strong></div><div class="card-body py-2">' + renderSection(s.washing_data) + '</div></div>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Sorting</strong></div><div class="card-body py-2">' + renderSection(s.sorting_data) + '</div></div>';
            html += '<div class="card mb-2"><div class="card-header py-1"><strong>Packing</strong></div><div class="card-body py-2">' + renderSection(s.packing_data) + '</div></div></div>';
            $body.html(html);
        }
    };
}());
_modal_production_stages.init();
