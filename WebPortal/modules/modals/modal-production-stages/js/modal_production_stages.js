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

/** Best Before = packing start + _common.KERNEL_BEST_BEFORE_MONTHS. Returns YYYY-MM-DD or null. */
function bestBeforeFromPackingStartISO(isoStr) {
    if (typeof _common === 'undefined' || !_common.kernelBestBeforeFromPackingStart) return null;
    return _common.kernelBestBeforeFromPackingStart(isoStr);
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

function parseStageNum(v) {
    if (v == null || v === '') return null;
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
}

function roundStagePct(numerator, denominator) {
    if (!denominator || denominator <= 0) return null;
    return +(Math.round((numerator / denominator) * 1000) / 10).toFixed(1);
}

/**
 * kg cracked for a day: volume_cracked, else the legacy end quantity, else the legacy total quantity.
 * Never uses the minute-test totals (those are grams).
 */
function crackKgCracked(c) {
    if (!c) return null;
    var keys = ['volume_cracked', 'endqty1', 'totalqty'];
    for (var i = 0; i < keys.length; i++) {
        var n = parseStageNum(c[keys[i]]);
        if (n != null) return n;
    }
    return null;
}

/**
 * Compute derived statistics (yield, recovery, totals) from raw stage inputs.
 * Called before save and when rendering batch summary so stored/displayed figures stay consistent.
 */
function enrichProductionStageCalculations(cracking_data, washing_data, sorting_data, packing_data, nisKg) {
    var c = Object.assign({}, cracking_data || {});
    var w = Object.assign({}, washing_data || {});
    var s = Object.assign({}, sorting_data || {});
    var p = Object.assign({}, packing_data || {});
    var nis = parseStageNum(nisKg);

    var totalWholes = (parseStageNum(c.wholes_07) || 0) + (parseStageNum(c.wholes_10) || 0) + (parseStageNum(c.wholes_13) || 0);
    var crackOutput = crackKgCracked(c);
    if (totalWholes > 0) c.total_wholes = +totalWholes.toFixed(2);
    if (crackOutput != null && crackOutput > 0) c.total_output = +crackOutput.toFixed(2);
    var shellTotal = parseStageNum(c.shell_total) || 0;
    var crackPct = nis && crackOutput ? roundStagePct(crackOutput, nis)
        : (crackOutput && (crackOutput + shellTotal) > 0 ? roundStagePct(crackOutput, crackOutput + shellTotal) : null);
    if (crackPct != null) c.cracking_percentage = crackPct;

    var qtyIn = parseStageNum(w.qty_in) || 0;
    var floaterQty = parseStageNum(w.floater_qty) || 0;
    var sinkerQty = parseStageNum(w.sinker_qty) || 0;
    var washOut = floaterQty + sinkerQty;
    var washTotalQty = parseStageNum(w.total_qty);
    if (washOut > 0) {
        w.total_qty = +washOut.toFixed(2);
        w.floater_total = +floaterQty.toFixed(2);
        w.sinker_total = +sinkerQty.toFixed(2);
        w.total_output = +washOut.toFixed(2);
    } else if (washTotalQty != null && washTotalQty > 0) {
        washOut = washTotalQty;
        w.total_output = +washTotalQty.toFixed(2);
    }
    if (qtyIn > 0) {
        w.total_in = +qtyIn.toFixed(2);
        w.qty_diff = +(qtyIn - washOut).toFixed(2);
    }
    var washRecovery = roundStagePct(washOut, qtyIn);
    if (washRecovery != null) w.recovery = washRecovery;

    var floaterIn = parseStageNum(s.floater_qty_in) || 0;
    var sinkerIn = parseStageNum(s.sinker_qty_in) || 0;
    var sortIn = floaterIn + sinkerIn;
    var soundQty = parseStageNum(s.sound_qty) || 0;
    var butterQty = parseStageNum(s.butter_qty) || 0;
    var sortOut = soundQty + butterQty;
    if (sortIn > 0) s.total_in = +sortIn.toFixed(2);
    if (sortOut > 0) s.total_output = +sortOut.toFixed(2);
    var sortRecovery = roundStagePct(sortOut, sortIn);
    if (sortRecovery != null) s.recovery = sortRecovery;
    [
        ['style0', 'style0_qty'], ['style1', 'style1_qty'], ['style1s', 'style1s_qty'],
        ['style4l', 'style4l_qty'], ['style5', 'style5_qty'], ['style6', 'style6_qty'], ['style78', 'style78_qty']
    ].forEach(function (pair) {
        var qty = parseStageNum(s[pair[1]]);
        if (qty != null && qty > 0) s[pair[0] + '_weight'] = +qty.toFixed(2);
    });

    var skKg = parseStageNum(p.sk_total_qty);
    var btKg = parseStageNum(p.bt_total_qty);
    if (skKg != null && skKg > 0) p.total_sk_kg = +skKg.toFixed(2);
    if (btKg != null && btKg > 0) p.total_bt_kg = +btKg.toFixed(2);
    var skCartons = parseStageNum(p.sk_total_cartons);
    var btCartons = parseStageNum(p.bt_total_cartons);
    if (skCartons != null && skCartons > 0) p.total_sk_cartons = skCartons;
    if (btCartons != null && btCartons > 0) p.total_bt_cartons = btCartons;

    return { cracking_data: c, washing_data: w, sorting_data: s, packing_data: p };
}

function enrichAggregatedProductionStats(agg, nisKg) {
    if (!agg) return agg;
    var enriched = enrichProductionStageCalculations(
        agg.cracking_data, agg.washing_data, agg.sorting_data, agg.packing_data, nisKg
    );
    agg.cracking_data = enriched.cracking_data;
    agg.washing_data = enriched.washing_data;
    agg.sorting_data = enriched.sorting_data;
    agg.packing_data = enriched.packing_data;
    return agg;
}

/**
 * Derive summary_data from the four stage blobs (Cracking/Washing/Sorting/Packing).
 * Used on save so Summary is always computed; also for timeline snippets.
 * Field mapping: see Summary tab IDs (ps_sum_*) in modal_production_stages.html.
 */
function deriveSummaryFromStages(cracking_data, washing_data, sorting_data, packing_data) {
    var enriched = enrichProductionStageCalculations(cracking_data, washing_data, sorting_data, packing_data, null);
    var c = enriched.cracking_data;
    var w = enriched.washing_data;
    var s = enriched.sorting_data;
    var p = enriched.packing_data;
    var num = function (v) { var n = parseFloat(v); return isNaN(n) ? '' : n; };
    var str = function (v) { return v != null && v !== '' ? String(v) : ''; };
    return {
        crack_time: str(c.timespent1 || c.totaltime),
        crack_qty: num(crackKgCracked(c)),
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
        /** Silos offered in the Cracking silo select (from getSiloOverview): [{silo_number, filled_kg, ...}]. */
        _siloOptions: [],
        /** kg-per-crate factors from Settings, keyed '<stage>.<crate_type>' (only entries that are set). Loaded once per page. */
        _crateKg: {},
        _crateWeightsLoaded: false,
        /** crates input -> kg input -> config key. When a factor is set, kg = crates x factor (read-only); otherwise kg stays manual. */
        crateKgPairs: [
            { crates: 'ps_wash_crates_in', kg: 'ps_wash_qty_in', key: 'washing.in' },
            { crates: 'ps_wash_floater_crates', kg: 'ps_wash_floater_qty', key: 'washing.floater' },
            { crates: 'ps_wash_sinker_crates', kg: 'ps_wash_sinker_qty', key: 'washing.sinker' },
            { crates: 'ps_sort_floater_crates_in', kg: 'ps_sort_floater_qty_in', key: 'sorting.floater_in' },
            { crates: 'ps_sort_style0_crates', kg: 'ps_sort_style0_qty', key: 'sorting.style_0' },
            { crates: 'ps_sort_style1_crates', kg: 'ps_sort_style1_qty', key: 'sorting.style_1' },
            { crates: 'ps_sort_style1s_crates', kg: 'ps_sort_style1s_qty', key: 'sorting.style_1S' },
            { crates: 'ps_sort_style4l_crates', kg: 'ps_sort_style4l_qty', key: 'sorting.style_4L' },
            { crates: 'ps_sort_style5_crates', kg: 'ps_sort_style5_qty', key: 'sorting.style_5' },
            { crates: 'ps_sort_style6_crates', kg: 'ps_sort_style6_qty', key: 'sorting.style_6' },
            { crates: 'ps_sort_style78_crates', kg: 'ps_sort_style78_qty', key: 'sorting.style_78' },
            { crates: 'ps_sort_sinker_crates_in', kg: 'ps_sort_sinker_qty_in', key: 'sorting.sinker_in' },
            { crates: 'ps_sort_butterlow_crates', kg: 'ps_sort_butterlow_qty', key: 'sorting.butterlow' }
        ],
        /** When true, date picker onChange will not clear the form (used when we set dates programmatically). */
        _suppressDateChangeClear: false,
        productionActionMap: {
            crack: { section: 'crack', paneId: 'pane-cracking', dataKey: 'cracking_data' },
            wash: { section: 'wash', paneId: 'pane-washing', dataKey: 'washing_data' },
            sort: { section: 'sort', paneId: 'pane-sorting', dataKey: 'sorting_data' },
            pack: { section: 'pack', paneId: 'pane-packing', dataKey: 'packing_data' }
        },

        getMarkedProductionDates: () => {
            var scope = _modal_production_stages;
            var detail = scope._loadedKernelDetail;
            var marked = {};
            ['cracking_data', 'washing_data', 'sorting_data', 'packing_data'].forEach(function (key) {
                var arr = (detail && Array.isArray(detail[key])) ? detail[key] : [];
                arr.forEach(function (entry) {
                    var iso = entry && entry.date ? String(entry.date).split('T')[0] : '';
                    if (iso && scope.hasMeaningfulStageData(entry)) marked[iso] = true;
                });
            });
            return marked;
        },

        decorateFlatpickrDay: function (dayElem, dateObj) {
            var scope = _modal_production_stages;
            if (!dayElem || !dateObj) return;
            var iso = dateObj.getFullYear() + '-' + String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + String(dateObj.getDate()).padStart(2, '0');
            var marked = scope.getMarkedProductionDates();
            var hasData = marked[iso] === true;
            dayElem.classList.toggle('production-date-has-data', hasData);
            dayElem.title = hasData ? 'Production saved for this date' : '';
            var dot = dayElem.querySelector('.production-date-dot');
            if (hasData) {
                if (!dot) {
                    dot = document.createElement('span');
                    dot.className = 'production-date-dot';
                    dot.style.position = 'absolute';
                    dot.style.bottom = '4px';
                    dot.style.left = '50%';
                    dot.style.transform = 'translateX(-50%)';
                    dot.style.width = '6px';
                    dot.style.height = '6px';
                    dot.style.borderRadius = '50%';
                    dot.style.background = '#8a6d1f';
                    dot.style.pointerEvents = 'none';
                    dayElem.style.position = 'relative';
                    dayElem.appendChild(dot);
                }
            } else if (dot) {
                dot.remove();
            }
        },

        refreshProductionDatePickers: () => {
            document.querySelectorAll('#productionStagesModal .flatpickr-date').forEach(function (el) {
                if (el && el._flatpickr && typeof el._flatpickr.redraw === 'function') {
                    el._flatpickr.redraw();
                }
            });
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
            $(document).on('click', '.js-clear-time-input', function (e) {
                e.preventDefault();
                var targetSel = this.getAttribute('data-target');
                if (!targetSel) return;
                var input = document.querySelector(targetSel);
                if (!input) return;
                input.value = '';
                $(input).trigger('input').trigger('change');
            });
            $(document).on('change input', '#ps_wash_waste_shellfines, #ps_wash_waste_compost', function () {
                scope.updateWashWasteTotal();
            });
            $(document).on('change input', '#ps_crack_timespent1', function () {
                scope.syncCrackTimeToSummary();
            });
            // Washing/Sorting: where Settings has a kg-per-crate factor for a crate type, its kg field is crates x factor
            // (read-only); where no factor is set the kg field stays a manual entry. See crateKgPairs / applyCrateWeights.
            // Packing: cartons → kg uses × 11.34 (standard carton weight).
            $(document).on('input change', '.wash-crate-input, .ps-wash-manual-kg', function () { scope.recalcWashingQty(); });
            $(document).on('input change', '.sort-crate-input, .ps-sort-manual-kg', function () { scope.recalcSortingQty(); });
            $(document).on('input change', '.pack-carton-input', function () { scope.recalcPackingQty(); });
            // Cracking: volume cracked, minute tests and shell waste are all derived from what the user types.
            $(document).off('.kp2ps'); // init() can run more than once; never stack these handlers
            $(document).on('input.kp2ps change.kp2ps', '#ps_crack_startqty1, #ps_crack_endqty_left', function () { scope.recalcCrackVolume(); });
            $(document).on('click.kp2ps', '#crackRunAddBtn', function (e) { e.preventDefault(); scope.openAddCrackingRun(); });
            $(document).on('click.kp2ps', '.js-crack-run-edit', function (e) { e.preventDefault(); scope.openEditCrackingRun(parseInt(this.getAttribute('data-idx'), 10)); });
            $(document).on('input.kp2ps change.kp2ps', '[id^="ps_crack_wholes_"], [id^="ps_crack_uncracks_"]', function () {
                scope.recalcMinuteTestRow(this.id.split('_').pop());
            });
            $(document).on('input.kp2ps change.kp2ps', '[id^="ps_crack_shell_qty"]', function () { scope.recalcShellTotal(); });
            $(document).on('click.kp2ps', '#crackShellAdd', function (e) {
                e.preventDefault();
                scope.setShellRowCount($('#crackShellRows .ps-shell-row').length + 1);
            });
            $(document).on('click.kp2ps', '.js-ps-shell-remove', function (e) {
                e.preventDefault();
                var rows = $('#crackShellRows .ps-shell-row');
                // Only the last row may be removed so the shell_bagN / shell_qtyN keys stay contiguous.
                if (rows.length <= 2 || !$(this).closest('.ps-shell-row').is(rows.last())) return;
                scope.setShellRowCount(rows.length - 1);
                scope.recalcShellTotal();
                scope.scheduleAutoSave();
            });
            $(document).on('change.kp2ps', '#ps_crack_silo_number', function () {
                var no = this.value;
                if (!no) return;
                var silo = (scope._siloOptions || []).filter(function (x) { return String(x.silo_number) === String(no); })[0];
                var kg = silo ? parseFloat(silo.filled_kg) : NaN;
                if (!isFinite(kg)) return;
                $('#ps_crack_startqty1').val(kg.toFixed(2));
                scope.recalcCrackVolume();
            });
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
                            onDayCreate: function (dObj, dStr, fp, dayElem) {
                                scope.decorateFlatpickrDay(dayElem, dayElem.dateObj);
                            },
                            onChange: function (selectedDates, dateStr) {
                                if (dateStr != null && dateStr !== '') _modal_production_stages.onProductionDateChanged(dateStr);
                            },
                            onOpen: function () {
                                scope.refreshProductionDatePickers();
                            },
                            onMonthChange: function () {
                                scope.refreshProductionDatePickers();
                            },
                            onYearChange: function () {
                                scope.refreshProductionDatePickers();
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
            scope.recalcCrackVolume();
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

        /** Round to 2 dp as a plain-number string ('' when not finite). Used for every stored derived value. */
        _fixed2: (n) => (typeof n === 'number' && isFinite(n)) ? n.toFixed(2) : '',

        /**
         * Fill each crates -> kg pair that has a Settings factor (kg = crates x factor). When loading a saved day
         * (fromLoad) a kg value already stored is left alone, so opening a day never rewrites its history.
         */
        _applyCrateKg: (idPrefix, fromLoad) => {
            const scope = _modal_production_stages;
            scope.crateKgPairs.forEach(function (pair) {
                if (pair.kg.indexOf(idPrefix) !== 0) return;
                var factor = scope._crateKg[pair.key];
                if (!factor) return;
                var kgEl = document.getElementById(pair.kg);
                if (!kgEl || (fromLoad && kgEl.value !== '')) return;
                var crates = parseStageNum($('#' + pair.crates).val());
                kgEl.value = crates == null ? '' : scope._fixed2(crates * factor);
            });
            scope._renderCrateSums();
        },

        /** Display only: show "N crates x factor = kg (auto)" under each kg field, or "x not set" when Settings has no factor. */
        _renderCrateSums: () => {
            const scope = _modal_production_stages;
            scope.crateKgPairs.forEach(function (pair) {
                var kgEl = document.getElementById(pair.kg);
                if (!kgEl) return;
                var $kg = $(kgEl);
                var $hint = $kg.nextAll('.ps-crate-hint').first();
                if (!$hint.length) $hint = $('<div class="form-text ps-crate-hint"></div>').insertAfter($kg);
                var factor = scope._crateKg[pair.key];
                $hint.empty();
                if (!factor) {
                    $hint.append($('<span class="ps-crate-x ps-crate-unset"></span>').text('× not set'));
                    return;
                }
                var crates = parseStageNum($('#' + pair.crates).val());
                var text = '× ' + _common.formatKg(factor, 0 === factor % 1 ? 0 : 2);
                if (crates != null) text = _common.formatKg(crates, 0 === crates % 1 ? 0 : 2) + ' crates ' + text + ' = ' + _common.formatKg(crates * factor) + ' kg';
                $hint.append($('<span class="ps-crate-x"></span>').text(text)).append($('<span class="ps-auto-pill"></span>').text('auto'));
            });
        },

        recalcWashingQty: (fromLoad) => {
            const scope = _modal_production_stages;
            var num = function (id) { return parseStageNum($('#' + id).val()); };
            var calc = function (id) { return num(id) || 0; };
            scope._applyCrateKg('ps_wash_', fromLoad === true);
            var floater = calc('ps_wash_floater_crates'), sinker = calc('ps_wash_sinker_crates');
            var totalOutC = floater + sinker;
            var cratesIn = calc('ps_wash_crates_in');
            var anyCrates = num('ps_wash_crates_in') != null || num('ps_wash_floater_crates') != null || num('ps_wash_sinker_crates') != null;
            $('#ps_wash_total_crates').val(totalOutC || '');
            $('#ps_wash_crate_diff').val(anyCrates ? +(cratesIn - totalOutC).toFixed(2) : '');
            var floaterKg = num('ps_wash_floater_qty');
            var sinkerKg = num('ps_wash_sinker_qty');
            var totalOutKg = (floaterKg || 0) + (sinkerKg || 0);
            if (floaterKg != null || sinkerKg != null) $('#ps_wash_total_qty').val(scope._fixed2(totalOutKg));
            else if (fromLoad !== true) $('#ps_wash_total_qty').val('');
            var qtyIn = num('ps_wash_qty_in');
            if (qtyIn != null || floaterKg != null || sinkerKg != null) $('#ps_wash_qty_diff').val(scope._fixed2((qtyIn || 0) - totalOutKg));
            else if (fromLoad !== true) $('#ps_wash_qty_diff').val('');
        },

        /** Time between start and end in minutes (0 when either is missing). Reuses the Time Spent maths (overnight wrap). */
        _crackMinutes: () => {
            const scope = _modal_production_stages;
            // Runs mode: time is the sum of the runs' own durations (earliest..latest would count gaps between silos).
            if (scope._crackRunsMode && scope._crackRunsTotal != null) return Math.round(scope._crackRunsMinutes);
            return scope.parseTimeSpentToMinutes(scope.computeTimeSpent($('#ps_crack_start1').val(), $('#ps_crack_end1').val()));
        },

        /** Volume Cracked = Start Quantity - End Quantity, plus per hour / per minute over the Start-End time. */
        recalcCrackVolume: () => {
            const scope = _modal_production_stages;
            // Volume Cracked = Start - End (left in silo). Only when BOTH are entered and End <= Start:
            // a blank End mid-shift must not report the whole silo as cracked, and legacy days (which
            // have endqty1 = kg cracked and no endqty_left) must not get a restated volume.
            var start = parseStageNum($('#ps_crack_startqty1').val());
            var left = parseStageNum($('#ps_crack_endqty_left').val());
            // Runs mode: the batch's own kg from the silo runs (a silo can hold several batches, so start - left is not it).
            if (scope._crackRunsMode && scope._crackRunsTotal != null) {
                var rmins = scope._crackMinutes();
                $('#ps_crack_volume_cracked').val(scope._fixed2(scope._crackRunsTotal));
                $('#ps_crack_vol_cracked_per_hour').val(rmins > 0 ? scope._fixed2(scope._crackRunsTotal / (rmins / 60)) : '');
                $('#ps_crack_vol_cracked_per_min').val(rmins > 0 ? scope._fixed2(scope._crackRunsTotal / rmins) : '');
                return;
            }
            if (start == null || left == null || left > start) {
                $('#ps_crack_volume_cracked, #ps_crack_vol_cracked_per_hour, #ps_crack_vol_cracked_per_min').val('');
                return;
            }
            var vol = start - left;
            var mins = scope._crackMinutes();
            $('#ps_crack_volume_cracked').val(scope._fixed2(vol));
            $('#ps_crack_vol_cracked_per_hour').val(mins > 0 ? scope._fixed2(vol / (mins / 60)) : '');
            $('#ps_crack_vol_cracked_per_min').val(mins > 0 ? scope._fixed2(vol / mins) : '');
        },

        /** A minute-test row was edited: recompute that row's total (wholes + uncracks), then percentages and averages. */
        recalcMinuteTestRow: (slot) => {
            const scope = _modal_production_stages;
            var w = parseStageNum($('#ps_crack_wholes_' + slot).val());
            var u = parseStageNum($('#ps_crack_uncracks_' + slot).val());
            $('#ps_crack_total_' + slot).val(w == null && u == null ? '' : scope._fixed2((w || 0) + (u || 0)));
            scope.recalcMinuteTestDerived();
        },

        /** Percentages per slot and averages across the slots that have a number. A hand-typed legacy total is respected as-is. */
        recalcMinuteTestDerived: () => {
            const scope = _modal_production_stages;
            var sw = 0, su = 0, st = 0, cnt = 0;
            ['07', '10', '13'].forEach(function (slot) {
                var w = parseStageNum($('#ps_crack_wholes_' + slot).val());
                var u = parseStageNum($('#ps_crack_uncracks_' + slot).val());
                var t = parseStageNum($('#ps_crack_total_' + slot).val());
                if (w == null && u == null && t == null) {
                    $('#ps_crack_pct_wholes_' + slot + ', #ps_crack_pct_uncracks_' + slot).val('');
                    return;
                }
                var wv = w || 0, uv = u || 0, tv = t != null ? t : wv + uv;
                $('#ps_crack_pct_wholes_' + slot).val(tv > 0 ? scope._fixed2(wv / tv * 100) : '');
                $('#ps_crack_pct_uncracks_' + slot).val(tv > 0 ? scope._fixed2(uv / tv * 100) : '');
                sw += wv; su += uv; st += tv; cnt++;
            });
            $('#ps_crack_avg_wholes').val(cnt ? scope._fixed2(sw / cnt) : '');
            $('#ps_crack_avg_uncracks').val(cnt ? scope._fixed2(su / cnt) : '');
            $('#ps_crack_avg_total').val(cnt ? scope._fixed2(st / cnt) : '');
            $('#ps_crack_pct_avg_wholes').val(st > 0 ? scope._fixed2(sw / st * 100) : '');
            $('#ps_crack_pct_avg_uncracks').val(st > 0 ? scope._fixed2(su / st * 100) : '');
        },

        /** Total Shell Waste = sum of the bag quantities. Called when a quantity is edited or a row removed (never on load). */
        recalcShellTotal: () => {
            const scope = _modal_production_stages;
            var any = false, sum = 0;
            $('#crackShellRows [id^="ps_crack_shell_qty"]').each(function () {
                var q = parseStageNum(this.value);
                if (q != null) { any = true; sum += q; }
            });
            $('#ps_crack_shell_total').val(any ? scope._fixed2(sum) : '');
        },

        _currentBatchNumber: () => ($('#productionStagesBatchNumber').text() || '').trim(),

        /** Show the current batch number as the auto Batch text on every shell row, and only the last extra row's remove button. */
        refreshShellRows: () => {
            const scope = _modal_production_stages;
            var rows = $('#crackShellRows .ps-shell-row');
            rows.find('.ps-shell-batch-text').text(scope._currentBatchNumber());
            rows.each(function (i) {
                $(this).find('.js-ps-shell-remove').toggleClass('d-none', i !== rows.length - 1);
            });
        },

        /** Build exactly `count` shell rows (minimum 2). Extra rows get ids ps_crack_shell_bagN / ps_crack_shell_qtyN. */
        setShellRowCount: (count) => {
            const scope = _modal_production_stages;
            count = Math.min(Math.max(parseInt(count, 10) || 2, 2), 200);
            var $body = $('#crackShellRows');
            if (!$body.length) return;
            while ($body.find('.ps-shell-row').length > count) $body.find('.ps-shell-row').last().remove();
            for (var n = $body.find('.ps-shell-row').length + 1; n <= count; n++) {
                var $tr = $('<tr class="ps-shell-row"></tr>').attr('data-n', n);
                $('<td></td>').append($('<input type="text" class="form-control form-control-sm">').attr('id', 'ps_crack_shell_bag' + n)).appendTo($tr);
                $('<td></td>')
                    .append('<span class="ps-shell-batch-text"></span> <span class="form-text">auto</span>')
                    .append($('<input type="text" class="d-none" tabindex="-1">').attr('id', 'ps_crack_shell_batch' + n))
                    .appendTo($tr);
                $('<td></td>').append($('<input type="number" class="form-control form-control-sm" step="0.01">').attr('id', 'ps_crack_shell_qty' + n)).appendTo($tr);
                $('<td></td>').append($('<button type="button" class="btn btn-sm btn-outline-secondary js-ps-shell-remove" aria-label="Remove bag"></button>').text('\u2715')).appendTo($tr);
                $body.append($tr);
            }
            scope.refreshShellRows();
        },

        /** Fill the Silo select from the silo overview (silos with stock or an open run). Hides the select when the RPC is unavailable. */
        loadSiloOptions: () => {
            const scope = _modal_production_stages;
            var $sel = $('#ps_crack_silo_number');
            var $wrap = $('#crackSiloWrap');
            if (!$sel.length) return Promise.resolve();
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.getSiloOverview !== 'function') {
                $wrap.addClass('d-none');
                return Promise.resolve();
            }
            return Promise.resolve().then(function () { return dataFunctions.getSiloOverview(); }).then(function (res) {
                if (!res || res.success === false || !Array.isArray(res.silos)) throw new Error((res && res.error) || 'Silo overview unavailable');
                var silos = res.silos.filter(function (x) { return (parseFloat(x.filled_kg) || 0) > 0 || x.open_run; });
                scope._siloOptions = silos;
                var cur = $sel.val();
                $sel.empty().append($('<option value=""></option>').text('Choose silo\u2026'));
                silos.forEach(function (x) {
                    $('<option></option>').val(String(x.silo_number)).text('Silo ' + x.silo_number + ', ' + _common.formatKg(x.filled_kg, 0) + ' kg').appendTo($sel);
                });
                if (cur) { scope.ensureSelectHasOption($sel[0], cur); $sel.val(cur); }
                $wrap.removeClass('d-none');
            }).catch(function (err) {
                // Silo allocation not available: hide the select; Start Quantity stays a manual entry.
                console.warn('[Production] Silo overview unavailable:', err && err.message ? err.message : err);
                scope._siloOptions = [];
                $wrap.addClass('d-none');
            });
        },

        // ------------------------------------------------------------------------------------------
        // Cracking runs (silo runs that cracked kg from THIS batch on the sheet's day). When the
        // get_batch_cracking_runs RPC works, the manual Silo / Start / End / Start Qty / End Qty /
        // Volume inputs are hidden (still in the DOM) and filled from the runs so the existing save
        // path writes this day's cracking element; the parallel-array storage shape is untouched.
        // If the RPC fails (or the day has no runs but already has hand-typed cracking values),
        // the legacy fields show exactly as before.
        // ------------------------------------------------------------------------------------------

        _crackRunsMode: false,
        _crackRunsTotal: null,
        _crackRunsMinutes: 0,
        _crackRunsSeq: 0,

        /** Local time of an ISO timestamp as HH:MM (browser = SA time). '' when invalid. */
        _crackHHMM: (ts) => {
            var d = new Date(ts);
            if (isNaN(d.getTime())) return '';
            return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
        },

        /** Sheet date (YYYY-MM-DD) + local HH:MM -> ISO timestamp carrying the browser's UTC offset. '' when invalid. */
        _crackToTimestamp: (dateISO, hhmm) => {
            var dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateISO || ''));
            var tm = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
            if (!dm || !tm) return '';
            var d = new Date(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0, 0);
            if (isNaN(d.getTime())) return '';
            var off = -d.getTimezoneOffset();
            var sign = off >= 0 ? '+' : '-';
            var a = Math.abs(off);
            var p = function (n) { return String(n).padStart(2, '0'); };
            return dm[1] + '-' + dm[2] + '-' + dm[3] + 'T' + p(+tm[1]) + ':' + tm[2] + ':00' + sign + p(Math.floor(a / 60)) + ':' + p(a % 60);
        },

        _crackFmtMinutes: (m) => {
            m = Math.round(m || 0);
            var h = Math.floor(m / 60);
            var r = m % 60;
            if (h === 0) return r + 'm';
            if (r === 0) return h + 'h';
            return h + 'h ' + r + 'm';
        },

        _crackKg: (n, dec) => {
            var v = parseFloat(n);
            return isFinite(v) ? _common.formatKg(v, dec == null ? 0 : dec) : '';
        },

        /** Day the Cracking tab is showing, as YYYY-MM-DD ('' when none). */
        _crackSheetDate: () => {
            var iso = toISO($('#ps_crack_date').val());
            return /^\d{4}-\d{2}-\d{2}$/.test(iso || '') ? iso : '';
        },

        _setCrackRunsMode: (on) => {
            const scope = _modal_production_stages;
            scope._crackRunsMode = !!on;
            $('#pane-cracking').toggleClass('ps-crack-runs-mode', !!on);
            $('#crackRunsSection').toggleClass('d-none', !on);
            if (!on) { scope._crackRunsTotal = null; scope._crackRunsMinutes = 0; }
        },

        /** True when the Cracking form already holds hand-typed quantities (old days keep working). */
        _crackHasManualValues: () => {
            return ['ps_crack_startqty1', 'ps_crack_endqty_left', 'ps_crack_endqty1', 'ps_crack_volume_cracked'].some(function (id) {
                var v = $('#' + id).val();
                return v != null && String(v).trim() !== '';
            });
        },

        /**
         * Load this batch's cracking runs for a day and switch the tab between runs mode and legacy mode.
         * userChanged: true after the user added/edited a run, so the derived values get saved.
         */
        loadCrackingRuns: (dayDate, userChanged) => {
            const scope = _modal_production_stages;
            var kernelId = $('#productionStagesBatchId').val();
            var date = (dayDate && /^\d{4}-\d{2}-\d{2}/.test(dayDate)) ? String(dayDate).slice(0, 10) : scope._crackSheetDate();
            var seq = ++scope._crackRunsSeq;
            if (!kernelId || !date || typeof dataFunctions === 'undefined' || typeof dataFunctions.getBatchCrackingRuns !== 'function') {
                scope._setCrackRunsMode(false);
                return Promise.resolve();
            }
            return Promise.resolve().then(function () { return dataFunctions.getBatchCrackingRuns(kernelId, date); }).then(function (res) {
                if (seq !== scope._crackRunsSeq) return; // a newer load superseded this one
                if (!res || res.success === false || !Array.isArray(res.runs)) throw new Error((res && res.error) || 'Cracking runs unavailable');
                var runs = res.runs;
                if (runs.length === 0 && scope._crackHasManualValues()) { scope._setCrackRunsMode(false); return; }
                scope._setCrackRunsMode(true);
                scope._crackRuns = runs;
                scope._crackRunsDate = date;
                scope.renderCrackingRuns(runs, res.total_batch_kg);
                if (runs.length > 0) {
                    scope.applyCrackingRunsToFields(runs, res.total_batch_kg);
                    if (userChanged) scope.scheduleAutoSave();
                }
            }).catch(function (err) {
                if (seq !== scope._crackRunsSeq) return;
                // RPC missing or failing: fall back to today's manual Start/End quantity fields.
                console.warn('[Production] Cracking runs unavailable:', err && err.message ? err.message : err);
                scope._setCrackRunsMode(false);
            });
        },

        renderCrackingRuns: (runs, totalBatchKg) => {
            const scope = _modal_production_stages;
            var esc = _common.escapeHtml;
            var canEdit = !(typeof hasAction === 'function' && !hasAction('kernel.production_stages.edit'));
            $('#crackRunAddBtn').toggleClass('d-none', !canEdit);
            var $body = $('#crackRunsBody').empty();
            if (!runs.length) {
                $body.append('<tr><td colspan="9" class="text-muted">No cracking runs for this batch on this day yet.</td></tr>');
                return;
            }
            var sumKg = 0, sumMin = 0;
            runs.forEach(function (r, i) {
                var batchKg = parseFloat(r.batch_kg) || 0;
                var o = new Date(r.opened_at).getTime(), c = new Date(r.closed_at).getTime();
                if (isFinite(o) && isFinite(c) && c > o) sumMin += (c - o) / 60000;
                sumKg += batchKg;
                var left = parseFloat(r.left_kg);
                var pill = r.times_edited ? ' <span class="ps-crack-run-pill">time changed</span>' : '';
                $body.append(
                    '<tr>' +
                    '<td>Silo ' + esc(r.silo_number) + '</td>' +
                    '<td>' + esc(scope._crackBatchLabel()) + '</td>' +
                    '<td>' + esc(scope._crackHHMM(r.opened_at)) + pill + '</td>' +
                    '<td>' + esc(scope._crackHHMM(r.closed_at)) + '</td>' +
                    '<td class="text-end">' + esc(scope._crackKg(r.start_kg)) + '</td>' +
                    '<td class="text-end">' + (left === 0 ? 'Empty' : esc(scope._crackKg(r.left_kg))) + '</td>' +
                    '<td class="text-end fw-semibold">' + esc(scope._crackKg(batchKg)) + '</td>' +
                    '<td class="text-end">' + esc(scope._crackKg(r.kg_per_hour)) + '</td>' +
                    '<td>' + (canEdit ? '<a href="#" class="js-crack-run-edit" data-idx="' + i + '">Edit</a>' : '') + '</td>' +
                    '</tr>'
                );
            });
            var total = totalBatchKg != null && isFinite(parseFloat(totalBatchKg)) ? parseFloat(totalBatchKg) : sumKg;
            $body.append(
                '<tr class="ps-crack-runs-total"><td colspan="6">Total cracked today</td>' +
                '<td class="text-end">' + esc(scope._crackKg(total)) + ' kg</td>' +
                '<td class="text-end">' + (sumMin > 0 ? esc(scope._crackKg(total / (sumMin / 60))) : '') + '</td><td></td></tr>'
            );
        },

        _crackBatchLabel: () => {
            var d = _modal_production_stages._loadedKernelDetail;
            var b = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch ? _kernelProductionGrid.getBatch($('#productionStagesBatchId').val()) : null;
            return (d && d.batch_number) || (b && b.batch_number) || '';
        },

        /** Write the runs' totals into the (hidden) cracking inputs so the normal save path stores them. */
        applyCrackingRunsToFields: (runs, totalBatchKg) => {
            const scope = _modal_production_stages;
            var startSum = 0, leftSum = 0, minutes = 0, first = null, last = null, silos = {};
            runs.forEach(function (r) {
                startSum += parseFloat(r.start_kg) || 0;
                leftSum += parseFloat(r.left_kg) || 0;
                var o = new Date(r.opened_at).getTime(), c = new Date(r.closed_at).getTime();
                if (isFinite(o) && (first == null || o < first)) first = o;
                if (isFinite(c) && (last == null || c > last)) last = c;
                if (isFinite(o) && isFinite(c) && c > o) minutes += (c - o) / 60000;
                silos[r.silo_number] = true;
            });
            var total = totalBatchKg != null && isFinite(parseFloat(totalBatchKg))
                ? parseFloat(totalBatchKg)
                : runs.reduce(function (a, r) { return a + (parseFloat(r.batch_kg) || 0); }, 0);
            scope._crackRunsTotal = total;
            scope._crackRunsMinutes = minutes;
            var siloKeys = Object.keys(silos);
            if (siloKeys.length === 1) { scope.ensureSelectHasOption($('#ps_crack_silo_number')[0], siloKeys[0]); $('#ps_crack_silo_number').val(siloKeys[0]); }
            else $('#ps_crack_silo_number').val('');
            $('#ps_crack_startqty1').val(scope._fixed2(startSum));
            $('#ps_crack_endqty_left').val(scope._fixed2(leftSum));
            $('#ps_crack_endqty1').val('');
            $('#ps_crack_start1').val(first != null ? scope._crackHHMM(first) : '');
            $('#ps_crack_end1').val(last != null ? scope._crackHHMM(last) : '');
            $('#ps_crack_timespent1').val(minutes > 0 ? scope._crackFmtMinutes(minutes) : '');
            scope.updateCrackTotalTime();
            scope.syncCrackTimeToSummary();
            scope.recalcCrackVolume();
        },

        /** Silos holding stock of THIS batch, from the silo overview. */
        _crackSilosForBatch: () => {
            var kernelId = String($('#productionStagesBatchId').val() || '');
            return Promise.resolve().then(function () { return dataFunctions.getSiloOverview(); }).then(function (res) {
                if (!res || res.success === false || !Array.isArray(res.silos)) throw new Error((res && res.error) || 'Silo overview unavailable');
                return res.silos.filter(function (s) {
                    return (s.contents || []).some(function (c) { return String(c.kernel_id) === kernelId; });
                });
            });
        },

        /** "+ Add cracking run": same box as the silo screen's stop dialog, plus silo and times. */
        openAddCrackingRun: () => {
            const scope = _modal_production_stages;
            var date = scope._crackSheetDate();
            if (!date) { Swal.fire({ icon: 'warning', text: 'Set the Cracking date first.' }); return; }
            scope._crackSilosForBatch().then(function (silos) {
                if (!silos.length) { Swal.fire({ icon: 'info', text: 'No silo holds this batch right now, so there is nothing to crack. Allocate it to a silo first.' }); return; }
                var esc = _common.escapeHtml;
                var opts = silos.map(function (s) {
                    return '<option value="' + esc(s.silo_number) + '">Silo ' + esc(s.silo_number) + ', ' + esc(scope._crackKg(s.filled_kg)) + ' kg</option>';
                }).join('');
                Swal.fire({
                    title: 'Add cracking run',
                    html: '<div class="ps-crack-dialog text-start">' +
                        '<label class="form-label" for="crRunSilo">Silo</label><select class="form-select" id="crRunSilo"><option value="">Choose silo&hellip;</option>' + opts + '</select>' +
                        '<div class="row g-2 mt-1"><div class="col-6"><label class="form-label" for="crRunStart">Started at</label><input type="time" class="form-control" id="crRunStart"></div>' +
                        '<div class="col-6"><label class="form-label" for="crRunStop">Stopped at</label><input type="time" class="form-control" id="crRunStop"></div></div>' +
                        '<label class="form-label mt-2" for="crRunLeft">Kg left in silo</label><input type="number" class="form-control" id="crRunLeft" min="0" step="0.01" placeholder="Estimate is fine">' +
                        '<div class="ps-crack-strip mt-3"><span>Ran for <b id="crRunDur">-</b></span><span>Cracked <b id="crRunKg">-</b></span><span>Rate <b id="crRunRate">-</b></span></div>' +
                        '<div class="form-text mt-2">Adding a run here empties the silo by the same amount, as if “Stop cracking” had been pressed.</div></div>',
                    showCancelButton: true,
                    confirmButtonText: 'Save',
                    focusConfirm: false,
                    didOpen: function () {
                        var filled = function () {
                            var s = silos.filter(function (x) { return String(x.silo_number) === String($('#crRunSilo').val()); })[0];
                            return s ? (parseFloat(s.filled_kg) || 0) : null;
                        };
                        var refresh = function () {
                            var f = filled();
                            if (f != null) $('#crRunLeft').attr('max', String(f)); else $('#crRunLeft').removeAttr('max');
                            var a = scope._crackToTimestamp(date, $('#crRunStart').val()), b = scope._crackToTimestamp(date, $('#crRunStop').val());
                            var mins = (a && b) ? (new Date(b) - new Date(a)) / 60000 : NaN;
                            var left = parseFloat($('#crRunLeft').val());
                            var kgv = (f != null && isFinite(left)) ? f - left : NaN;
                            $('#crRunDur').text(isFinite(mins) && mins > 0 ? scope._crackFmtMinutes(mins) : '-');
                            $('#crRunKg').text(isFinite(kgv) && kgv >= 0 ? scope._crackKg(kgv) + ' kg' : '-');
                            $('#crRunRate').text(isFinite(mins) && mins > 0 && isFinite(kgv) && kgv >= 0 ? scope._crackKg(kgv / (mins / 60)) + ' kg/hour' : '-');
                        };
                        $('#crRunSilo, #crRunStart, #crRunStop, #crRunLeft').on('input change', refresh);
                    },
                    preConfirm: function () {
                        var silo = $('#crRunSilo').val();
                        var a = scope._crackToTimestamp(date, $('#crRunStart').val());
                        var b = scope._crackToTimestamp(date, $('#crRunStop').val());
                        var leftStr = $('#crRunLeft').val();
                        var left = parseFloat(leftStr);
                        var f = silos.filter(function (x) { return String(x.silo_number) === String(silo); })[0];
                        if (!silo) { Swal.showValidationMessage('Choose the silo.'); return false; }
                        if (!a || !b) { Swal.showValidationMessage('Enter when the run started and stopped.'); return false; }
                        if (new Date(b) <= new Date(a)) { Swal.showValidationMessage('Stopped at must be after Started at.'); return false; }
                        if (leftStr === '' || !isFinite(left) || left < 0) { Swal.showValidationMessage('Enter the kg left in the silo (0 if empty).'); return false; }
                        if (f && left > (parseFloat(f.filled_kg) || 0) + 0.005) { Swal.showValidationMessage('That is more than the silo held (' + scope._crackKg(f.filled_kg) + ' kg).'); return false; }
                        return Promise.resolve().then(function () { return dataFunctions.recordSiloRun(silo, a, b, left); }).then(function (r) {
                            if (!r || r.success === false) { Swal.showValidationMessage((r && r.error) || 'Could not save the run.'); return false; }
                            return r;
                        }).catch(function (e) {
                            Swal.showValidationMessage((e && e.message) || 'Could not save the run.');
                            return false;
                        });
                    }
                }).then(function (c) {
                    if (c.isConfirmed && c.value) scope.loadCrackingRuns(date, true);
                });
            }).catch(function (e) {
                Swal.fire({ icon: 'error', text: (e && e.message) || 'Could not read the silos.' });
            });
        },

        /** "Edit" on a run row: change the started/stopped times only. */
        openEditCrackingRun: (idx) => {
            const scope = _modal_production_stages;
            var run = (scope._crackRuns || [])[idx];
            var date = scope._crackRunsDate || scope._crackSheetDate();
            if (!run || !date) return;
            Swal.fire({
                title: 'Edit run times, silo ' + run.silo_number,
                html: '<div class="ps-crack-dialog text-start"><div class="row g-2"><div class="col-6"><label class="form-label" for="crEditStart">Started at</label>' +
                    '<input type="time" class="form-control" id="crEditStart" value="' + _common.escapeHtml(scope._crackHHMM(run.opened_at)) + '"></div>' +
                    '<div class="col-6"><label class="form-label" for="crEditStop">Stopped at</label>' +
                    '<input type="time" class="form-control" id="crEditStop" value="' + _common.escapeHtml(scope._crackHHMM(run.closed_at)) + '"></div></div></div>',
                showCancelButton: true,
                confirmButtonText: 'Save',
                focusConfirm: false,
                preConfirm: function () {
                    var a = scope._crackToTimestamp(date, $('#crEditStart').val());
                    var b = scope._crackToTimestamp(date, $('#crEditStop').val());
                    if (!a || !b) { Swal.showValidationMessage('Enter when the run started and stopped.'); return false; }
                    if (new Date(b) <= new Date(a)) { Swal.showValidationMessage('Stopped at must be after Started at.'); return false; }
                    return Promise.resolve().then(function () { return dataFunctions.updateSiloRunTimes(run.run_id, a, b); }).then(function (r) {
                        if (!r || r.success === false) { Swal.showValidationMessage((r && r.error) || 'Could not save the times.'); return false; }
                        return r;
                    }).catch(function (e) {
                        Swal.showValidationMessage((e && e.message) || 'Could not save the times.');
                        return false;
                    });
                }
            }).then(function (c) {
                if (c.isConfirmed && c.value) scope.loadCrackingRuns(date, true);
            });
        },

        /** Load kg-per-crate factors once (failure = all unset, kg fields stay manual), then apply them to the form. */
        loadCrateWeights: () => {
            const scope = _modal_production_stages;
            if (scope._crateWeightsLoaded) { scope.applyCrateWeights(); return Promise.resolve(); }
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.getKernelPipelineConfig !== 'function') {
                scope._crateKg = {};
                scope.applyCrateWeights();
                return Promise.resolve();
            }
            return Promise.resolve().then(function () { return dataFunctions.getKernelPipelineConfig(); }).then(function (cfg) {
                var map = {};
                if (cfg && cfg.success !== false && Array.isArray(cfg.crate_weights)) {
                    cfg.crate_weights.forEach(function (cw) {
                        var kg = cw && cw.kg_per_crate != null ? parseFloat(cw.kg_per_crate) : NaN;
                        if (isFinite(kg) && kg > 0) map[cw.stage + '.' + cw.crate_type] = kg;
                    });
                    scope._crateWeightsLoaded = true;
                }
                scope._crateKg = map;
            }).catch(function (err) {
                console.warn('[Production] Kernel pipeline config unavailable:', err && err.message ? err.message : err);
                scope._crateKg = {};
            }).then(function () { scope.applyCrateWeights(); });
        },

        /** Make each kg field read-only (with a "x N kg/crate" hint) when it has a factor; manual otherwise. */
        applyCrateWeights: () => {
            const scope = _modal_production_stages;
            scope.crateKgPairs.forEach(function (pair) {
                var kgEl = document.getElementById(pair.kg);
                if (!kgEl) return;
                var $kg = $(kgEl);
                var factor = scope._crateKg[pair.key];
                if (factor) {
                    kgEl.readOnly = true;
                    kgEl.tabIndex = -1;
                    $kg.addClass('ps-calc');
                } else {
                    kgEl.readOnly = false;
                    kgEl.removeAttribute('tabindex');
                    $kg.removeClass('ps-calc');
                }
            });
            scope._renderCrateSums();
        },

        recalcSortingQty: (fromLoad) => {
            const scope = _modal_production_stages;
            scope._applyCrateKg('ps_sort_', fromLoad === true);
            var skCrates = 0, skQty = 0, btCrates = 0, btQty = 0;
            $('.sort-crate-input').each(function () {
                var group = this.getAttribute('data-group');
                if (group !== 'sk' && group !== 'bt') return;
                var crates = parseFloat(this.value) || 0;
                var qtyId = this.getAttribute('data-qty');
                var qtyEl = qtyId ? document.getElementById(qtyId) : null;
                var q = (qtyEl && qtyEl.value !== '') ? (parseFloat(qtyEl.value) || 0) : 0;
                if (group === 'sk') {
                    skCrates += crates;
                    skQty += q;
                } else if (group === 'bt') {
                    btCrates += crates;
                    btQty += q;
                }
            });
            $('#ps_sort_sound_crates').val(skCrates || '');
            $('#ps_sort_sound_qty').val(skQty ? +skQty.toFixed(2) : '');
            $('#ps_sort_butter_crates').val(btCrates || '');
            $('#ps_sort_butter_qty').val(btQty ? +btQty.toFixed(2) : '');
        },

        recalcPackingQty: () => {
            var KG_PER_CARTON = 11.34;
            var skTotal = 0, btTotal = 0;
            $('.pack-carton-input').each(function () {
                var cartons = parseFloat(this.value) || 0;
                var qty = cartons ? +(cartons * KG_PER_CARTON).toFixed(2) : '';
                var qtyEl = document.getElementById(this.getAttribute('data-qty'));
                if (qtyEl) qtyEl.value = qty;
                if (this.getAttribute('data-group') === 'sk') skTotal += cartons;
                else if (this.getAttribute('data-group') === 'bt') btTotal += cartons;
            });
            var grandTotal = skTotal + btTotal;
            $('#ps_pack_sk_total_cartons').val(skTotal || '');
            $('#ps_pack_sk_total_qty').val(skTotal ? +(skTotal * KG_PER_CARTON).toFixed(2) : '');
            $('#ps_pack_bt_total_cartons').val(btTotal || '');
            $('#ps_pack_bt_total_qty').val(btTotal ? +(btTotal * KG_PER_CARTON).toFixed(2) : '');
            $('#ps_pack_totals_cartons').val(grandTotal || '');
            $('#ps_pack_totals_qty').val(grandTotal ? +(grandTotal * KG_PER_CARTON).toFixed(2) : '');
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
            // Shell waste rows are dynamic: build exactly enough rows for the highest shell_bagN / shell_qtyN key before assigning values.
            if (prefix === 'crack') {
                var maxShell = 2;
                Object.keys(data).forEach(function (key) {
                    var m = /^shell_(?:bag|qty)(\d+)$/.exec(key);
                    if (m) maxShell = Math.max(maxShell, parseInt(m[1], 10));
                });
                scope.setShellRowCount(maxShell);
            }
            scope._suppressDateChangeClear = true;
            $.each(data, function (key, v) {
                var el = document.getElementById('ps_' + prefix + '_' + key);
                if (el) {
                    if (el.type === 'checkbox') {
                        el.checked = v === true || v === 'true' || v === '1' || v === 1;
} else {
                    if (el.tagName === 'SELECT' && v != null && v !== '') { scope.ensureSelectHasOption(el, String(v)); el.value = String(v); }
                    else if (el.classList && el.classList.contains('flatpickr-date'))
                        el.value = v != null && v !== '' ? fromISO(String(v)) : '';
                    else
                        el.value = v != null && v !== '' ? String(v) : '';
                }
                }
            });
            if (prefix === 'wash') { scope.updateWashWasteTotal(); scope.recalcWashingQty(true); }
            if (prefix === 'sort') scope.recalcSortingQty(true);
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
            scope.setShellRowCount(2);
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

        hasMeaningfulStageData: (data) => {
            if (!data || typeof data !== 'object') return false;
            for (var key in data) {
                if (!Object.prototype.hasOwnProperty.call(data, key) || key === 'date') continue;
                var val = data[key];
                if (typeof val === 'boolean') {
                    if (val) return true;
                    continue;
                }
                if (val == null) continue;
                if (typeof val === 'string') {
                    if (val.trim() !== '') return true;
                    continue;
                }
                return true;
            }
            return false;
        },

        hasAnyMeaningfulProductionData: (cracking_data, washing_data, sorting_data, packing_data) => {
            const scope = _modal_production_stages;
            return scope.hasMeaningfulStageData(cracking_data) ||
                scope.hasMeaningfulStageData(washing_data) ||
                scope.hasMeaningfulStageData(sorting_data) ||
                scope.hasMeaningfulStageData(packing_data);
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
            scope.setShellRowCount(2);
            if (hasData) {
                scope.setProductionStagesSectionData('crack', crack);
                scope.setProductionStagesSectionData('wash', wash);
                scope.setProductionStagesSectionData('sort', sort);
                scope.setProductionStagesSectionData('pack', pack);
            } else {
                // No data for this date — clear all non-date inputs (shell waste is already back to 2 rows)
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
            if (!scope.hasAnyMeaningfulProductionData(crack, wash, sort, pack)) {
                scope.clearProductionStagesDraft(batchId);
                return;
            }
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
            if (!scope.hasAnyMeaningfulProductionData(draft.cracking_data, draft.washing_data, draft.sorting_data, draft.packing_data)) {
                scope.clearProductionStagesDraft(batchId);
                return;
            }
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
            if (section === 'crack') scope.loadCrackingRuns(isoDate);
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
            return scope.loadCrackingRuns(dayDate);
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
            scope.loadCrackingRuns();
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
            // Start = chronologically first packing date (earliest calendar date). Best Before = Start + _common.KERNEL_BEST_BEFORE_MONTHS.
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
            var bestBeforeDate = (packingStart && /^\d{4}-\d{2}-\d{2}$/.test(packingStart)) ? bestBeforeFromPackingStartISO(packingStart) : null;
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
                p_sound_kernel_styles: soundKernelStyles.length ? soundKernelStyles : null,
                p_sound_kernel_total_cartons: skTotalCartons ? Math.round(skTotalCartons) : null,
                p_sound_kernel_total_kg: skTotalKg || null,
                p_butter_grade_styles: butterGradeStyles.length ? butterGradeStyles : null,
                p_butter_grade_total_cartons: btTotalCartons ? Math.round(btTotalCartons) : null,
                p_butter_grade_total_kg: btTotalKg || null,
                p_waste_shell_kg: (c.shell_total != null && c.shell_total !== '') ? num(c.shell_total) : null,
                p_waste_shell_fines_kg: (w.waste_shellfines != null && w.waste_shellfines !== '') ? num(w.waste_shellfines) : null,
                p_waste_compost_kg: (num(w.waste_compost) + num(s.compost_qty)) > 0 ? num(w.waste_compost) + num(s.compost_qty) : null,
                p_waste_oil_kernel_kg: (s.oil_qty != null && s.oil_qty !== '') ? num(s.oil_qty) : null
            };
        },

        renderBatchSummaryHtml: (agg, dayCount, batch, detail) => {
            var nisReceived = (detail && detail.wet_nis_received_kg) ? parseFloat(detail.wet_nis_received_kg)
                : ((batch && batch.wet_nis_received_kg) ? parseFloat(batch.wet_nis_received_kg) : null);
            enrichAggregatedProductionStats(agg, nisReceived);
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
            if (nisReceived != null && !isNaN(nisReceived)) nisReceived = n(nisReceived);
            else nisReceived = NaN;
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

                if (has(c, 'volume_cracked')) html.push(row('Volume Cracked', kg(c.volume_cracked)));
                else if (has(c, 'silo1')) html.push(row('Silo Input', kg(c.silo1)));
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
                    html.push('<table class="table align-middle table-hover mb-0"><thead><tr>');
                    html.push('<th>Grade</th>');
                    html.push('<th class="text-end">Qty (kg)</th>');
                    html.push('<th class="text-end">Cartons</th>');
                    html.push('</tr></thead><tbody>');
                    skStyles.forEach(function (pair) {
                        var qty = v(p, pair[0] + '_qty');
                        var ctn = v(p, pair[0] + '_cartons');
                        if (qty > 0 || ctn > 0) {
                            html.push('<tr>');
                            html.push('<td>' + pair[1] + '</td>');
                            html.push('<td class="text-end fw-semibold">' + (qty > 0 ? qty.toFixed(1) : '—') + '</td>');
                            html.push('<td class="text-end fw-semibold">' + (ctn > 0 ? num(ctn) : '—') + '</td>');
                            html.push('</tr>');
                        }
                    });
                    if (has(p, 'total_sk_kg') || has(p, 'total_sk_cartons')) {
                        html.push('<tr class="fw-bold">');
                        html.push('<td>Total</td>');
                        html.push('<td class="text-end">' + (v(p, 'total_sk_kg') > 0 ? v(p, 'total_sk_kg').toFixed(1) : '—') + '</td>');
                        html.push('<td class="text-end">' + (v(p, 'total_sk_cartons') > 0 ? num(v(p, 'total_sk_cartons')) : '—') + '</td>');
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
                    html.push('<table class="table align-middle table-hover mb-0"><thead><tr>');
                    html.push('<th>Grade</th>');
                    html.push('<th class="text-end">Qty (kg)</th>');
                    html.push('<th class="text-end">Cartons</th>');
                    html.push('</tr></thead><tbody>');
                    btStyles.forEach(function (pair) {
                        var qty = v(p, pair[0] + '_qty');
                        var ctn = v(p, pair[0] + '_cartons');
                        if (qty > 0 || ctn > 0) {
                            html.push('<tr>');
                            html.push('<td>' + pair[1] + '</td>');
                            html.push('<td class="text-end fw-semibold">' + (qty > 0 ? qty.toFixed(1) : '—') + '</td>');
                            html.push('<td class="text-end fw-semibold">' + (ctn > 0 ? num(ctn) : '—') + '</td>');
                            html.push('</tr>');
                        }
                    });
                    if (has(p, 'total_bt_kg') || has(p, 'total_bt_cartons')) {
                        html.push('<tr class="fw-bold">');
                        html.push('<td>Total</td>');
                        html.push('<td class="text-end">' + (v(p, 'total_bt_kg') > 0 ? v(p, 'total_bt_kg').toFixed(1) : '—') + '</td>');
                        html.push('<td class="text-end">' + (v(p, 'total_bt_cartons') > 0 ? num(v(p, 'total_bt_cartons')) : '—') + '</td>');
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
                if (typeof Swal !== 'undefined') Swal.fire({
                    icon: 'success',
                    title: 'Production finished',
                    text: 'Job card lines were prefilled when empty. Open the job card, review quantities, and press Jobcard approved before releasing to stock.',
                    timer: 4000,
                    showConfirmButton: true
                });
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
            var scope = _modal_production_stages;
            var shouldRemove = !scope.hasMeaningfulStageData(data);
            for (var i = 0; i < arr.length; i++) {
                if (arr[i] && arr[i].date === data.date) {
                    if (shouldRemove) arr.splice(i, 1);
                    else arr[i] = data;
                    return arr;
                }
            }
            if (!shouldRemove) arr.push(data);
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
            if (typeof hasAction === 'function' && !hasAction('kernel.production_stages.edit')) {
                if (!silent && typeof Swal !== 'undefined') {
                    Swal.fire('Not permitted', 'You do not have permission to edit production stages.', 'warning');
                }
                return;
            }
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
            var batch = typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.getBatch
                ? _kernelProductionGrid.getBatch(batchId) : null;
            var nisKg = (scope._loadedKernelDetail && scope._loadedKernelDetail.wet_nis_received_kg != null)
                ? scope._loadedKernelDetail.wet_nis_received_kg
                : (batch && batch.wet_nis_received_kg != null ? batch.wet_nis_received_kg : null);
            var enrichedStages = enrichProductionStageCalculations(
                cracking_data, washing_data, sorting_data, packing_data, nisKg
            );
            cracking_data = enrichedStages.cracking_data;
            washing_data = enrichedStages.washing_data;
            sorting_data = enrichedStages.sorting_data;
            packing_data = enrichedStages.packing_data;
            var summary_data = deriveSummaryFromStages(cracking_data, washing_data, sorting_data, packing_data);
            var hasMeaningfulData = scope.hasAnyMeaningfulProductionData(cracking_data, washing_data, sorting_data, packing_data);
            var currentDate = cracking_data.date || washing_data.date || sorting_data.date || packing_data.date || null;
            var hadExistingDataForDate = !!(currentDate && scope._loadedKernelDetail && (
                scope.hasMeaningfulStageData(scope._findByDate(scope._loadedKernelDetail.cracking_data, currentDate)) ||
                scope.hasMeaningfulStageData(scope._findByDate(scope._loadedKernelDetail.washing_data, currentDate)) ||
                scope.hasMeaningfulStageData(scope._findByDate(scope._loadedKernelDetail.sorting_data, currentDate)) ||
                scope.hasMeaningfulStageData(scope._findByDate(scope._loadedKernelDetail.packing_data, currentDate))
            ));

            // Validate: at least cracking must have a date
            if (!cracking_data.date || cracking_data.date === '') {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Cracking date is required. Please set a date on the Cracking tab.', 'error');
                return;
            }

            if (!hasMeaningfulData) {
                if (hadExistingDataForDate !== true) {
                    scope.modalProductionDayStages = { cracking_data: {}, washing_data: {}, sorting_data: {}, packing_data: {}, summary_data: {} };
                    scope.updateProductionActionButtonTicks();
                    if (silent) {
                        if ($status.length) $status.text('');
                    } else if (typeof Swal !== 'undefined') {
                        Swal.fire('Nothing to save', 'Date only does not count as production data. Add production details first.', 'info');
                    }
                    return;
                }
                summary_data = {};
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
                if (primaryDate && scope.hasAnyMeaningfulProductionData(cracking_data, washing_data, sorting_data, packing_data)) {
                    $('#productionStagesDayId').val(primaryDate);
                    scope.setProductionDayActive(primaryDate);
                } else if (!scope.modalProductionDays || scope.modalProductionDays.length === 0) {
                    $('#productionStagesDayId').val('new');
                } else {
                    var firstDay = scope.modalProductionDays[0];
                    var nextDayId = firstDay ? (firstDay.id || firstDay.date || '') : '';
                    $('#productionStagesDayId').val(nextDayId);
                    if (nextDayId) scope.setProductionDayActive(nextDayId);
                }
                scope.refreshProductionDatePickers();
                scope.updateProductionActionButtonTicks();
                scope.clearProductionStagesDraft(batchId);
                // Shell stock: call whenever a Total Shell Waste value exists (0 included; the DB adjusts by difference per batch + production day).
                var shellKg = (cracking_data && cracking_data.shell_total != null && String(cracking_data.shell_total).trim() !== '') ? parseFloat(cracking_data.shell_total) : NaN;
                var shellDate = cracking_data && cracking_data.date ? String(cracking_data.date).split('T')[0] : null;
                if (isFinite(shellKg) && dataFunctions.autoCreateShellLotFromProduction) {
                    var batchNum = ($('#productionStagesBatchNumber').text() || $('#productionStagesBatchId').val() || '').trim();
                    if (batchNum) {
                        Promise.resolve(dataFunctions.autoCreateShellLotFromProduction(batchNum, shellKg, 'Production stages save', null, shellDate)).catch(function () { /* non-blocking */ });
                    }
                }
                if (typeof _kernelProductionGrid !== 'undefined' && _kernelProductionGrid.loadBatches) _kernelProductionGrid.loadBatches(true);
                if (silent) {
                    if ($status.length) { $status.removeClass('text-danger').addClass('text-success').text(hadExistingDataForDate && !hasMeaningfulData ? 'Cleared' : 'Saved'); }
                    setTimeout(function () { if ($status.length) $status.text(''); }, 2000);
                } else {
                    if (typeof Swal !== 'undefined') Swal.fire('Saved', hadExistingDataForDate && !hasMeaningfulData ? 'Production data cleared for this day.' : 'Production stages saved for this day.', 'success');
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
            scope.refreshShellRows();
            scope._loadedKernelDetail = null;

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
                        if (entry && entry.date && entry.date !== '' && scope.hasMeaningfulStageData(entry)) allDates[entry.date] = true;
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
                scope.refreshProductionDatePickers();
                scope.setProductionStagesTabsVisibility(true);
                var first = list[0];
                $('#productionStagesDayId').val(first.id);

                return scope.populateProductionGrowerSelects(batch.grower_name || '').then(function () {
                    // Silo options and crate factors are best-effort: neither may block opening or saving a day.
                    return Promise.all([scope.loadSiloOptions(), scope.loadCrateWeights()]);
                }).then(function () {
                    return scope.loadProductionStagesForDay(first.date || first.id, first.kernel_production_stages_id);
                }).then(function () {
                    // For new days (no saved data), set default dates in all section date fields
                    if (!first.date || first.date === '') {
                        scope.setTodayDatesInProductionForm();
                    }
                    scope.renderProductionDaysList(list);
                    scope.setProductionDayActive(first.id);
                    scope.updateProductionActionButtonTicks();
                });
            }).then(function () {
                scope.restoreProductionStagesDraft(batchId);
                scope.refreshProductionDatePickers();
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
                return rows.length ? '<table class="table align-middle table-bordered mb-2"><tbody>' + rows.join('') + '</tbody></table>' : '<p class="text-muted mb-0">No data</p>';
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
