/**
 * Find a batch → batch page (Kernel tab only).
 *
 * Clicking a kernel row hides the list and shows this page inside the same module (the router has no
 * deep links, so there is no route of its own). "Back to Find a batch" shows the list again with its
 * search, filter and sort untouched — they live in the list's own inputs, which are only hidden.
 *
 * Data: one get_kernel_production_history read (same as the Batch history popup) plus the list row from
 * get_kernel_batches (supplier_id, declared weight, FFA, best before and the has_* flags the history
 * read does not return). Both are re-read after every save and the page re-renders.
 *
 * Every section saves ONLY through the writer its own module already uses:
 *   Batch details   → updateKernelStockBatchInfo   (rules shared with KernelBatchEdit, js/kernel-batch-edit.js)
 *   Receiving       → upsertKernelChecklist        (merges; sends every stored value it does not edit)
 *   Intake samples  → saveKernelIntakeSample       (one call per sample that actually changed)
 *   Production days → upsertKernelProduction       (same call Kernel Production makes; entries keyed by date)
 *   Job card        → upsertKernelJobCard (draft)  (never approves from here)
 *   End sample (QA) → upsertKernelQa               (whole-object replace, so the stored object is merged first)
 *   Dispatch        → read-only (orders span several batches; edited on Kernel Dispatch)
 *
 * Shared read helpers (stage schemas, dispatch panel, file links) are the globals defined in
 * modules/modals/modal-batch-history/js/modal_batch_history.js, which this module already loads.
 */
var _batchJourneyDetail = (function () {
    'use strict';

    var CONTAINER_ID = 'bjKernelDetail';
    var BATCH_FORM_PREFIX = 'bjdBatch';
    /** Same constant as Kernel Production's packing sheet (modal_production_stages.js recalcPackingQty). */
    var KG_PER_CARTON = 11.34;

    /** Same six checks, questions and "bad" answers as the Grower Intake checklist (modal_grower_receiving_checklist.js). */
    var CHECKS = [
        { key: 'vehicle_clean', q: 'Is the vehicle clean?', bad: 'No' },
        { key: 'vehicle_enclosed', q: 'Vehicle fully enclosed?', bad: 'No' },
        { key: 'hazard_substances', q: 'Any hazard substances noted on truck?', bad: 'Yes' },
        { key: 'pest_infestations', q: 'Any signs of pest infestations?', bad: 'Yes' },
        { key: 'pallets_condition', q: 'Pallets received are in good condition', bad: 'No' },
        { key: 'raw_materials_condition', q: 'Are raw materials received in good condition?', bad: 'No' }
    ];

    var ZIPLOCK_TESTS = [
        { key: 'moisture', label: 'Moisture', unit: '%' },
        { key: 'peroxide', label: 'Peroxide value', unit: ' meqO₂/kg' },
        { key: 'ffa', label: 'Free fatty acids', unit: '%' }
    ];

    var UNSOUND = [
        { key: 'germination_g', label: 'Germination' },
        { key: 'late_stinkbug_g', label: 'Late stinkbug' },
        { key: 'early_stinkbug_g', label: 'Early stinkbug' },
        { key: 'dark_centre_g', label: 'Dark centre' },
        { key: 'mould_g', label: 'Mould' },
        { key: 'rotten_g', label: 'Rotten' },
        { key: 'immature_split_g', label: 'Immature / split' },
        { key: 'shrivelled_g', label: 'Shrivelled' },
        { key: 'nut_borer_g', label: 'Nut borer' }
    ];

    var QA_TESTS = [
        { key: 'moisture', label: 'Moisture', numeric: true },
        { key: 'peroxide', label: 'Peroxide', numeric: true },
        { key: 'ffa', label: 'FFA', numeric: true },
        { key: 'internal_micro', label: 'Internal micro', numeric: false },
        { key: 'external_lab', label: 'External lab', numeric: false }
    ];

    /** Style options of the job card's two tables (modal_kernel_job_card.js addSoundKernelRow / addButterGradeRow). */
    var JC_STYLES = {
        sound: ['SP', '0', '1', '1S', '4L', '5', '6'],
        butter: ['7/8', 'Butter High Oil (Floaters)', 'Butter Low Oil (Sinkers)']
    };

    var STAGES = [
        { key: 'cracking', label: 'Cracking', dataKey: 'crackingData' },
        { key: 'washing', label: 'Washing', dataKey: 'washingData' },
        { key: 'sorting', label: 'Sorting', dataKey: 'sortingData' },
        { key: 'packing', label: 'Packing', dataKey: 'packingData' }
    ];

    /**
     * Fields Kernel Production calculates (read-only there, so read-only here), per stage.
     * Mirrors recalcWashingQty / updateWashWasteTotal / recalcSortingQty / recalcPackingQty in
     * modules/modals/modal-production-stages/js/modal_production_stages.js.
     */
    var STAGE_CALC_KEYS = {
        washing: ['total_crates', 'crate_diff', 'total_qty', 'qty_diff', 'waste_total'],
        sorting: ['sound_crates', 'sound_qty', 'butter_crates', 'butter_qty'],
        packing: ['sk_sp_qty', 'sk_0_qty', 'sk_1_qty', 'sk_1s_qty', 'sk_4l_qty', 'sk_5_qty', 'sk_6_qty',
            'bt_78_qty', 'bt_high_qty', 'bt_low_qty', 'sk_total_cartons', 'sk_total_qty',
            'bt_total_cartons', 'bt_total_qty', 'totals_cartons', 'totals_qty']
    };

    /** crates → kg pairs that follow a Settings factor (modal_production_stages.js crateKgPairs). */
    var CRATE_KG_PAIRS = {
        washing: [
            { crates: 'crates_in', kg: 'qty_in', key: 'washing.in' },
            { crates: 'floater_crates', kg: 'floater_qty', key: 'washing.floater' },
            { crates: 'sinker_crates', kg: 'sinker_qty', key: 'washing.sinker' }
        ],
        sorting: [
            { crates: 'floater_crates_in', kg: 'floater_qty_in', key: 'sorting.floater_in' },
            { crates: 'style0_crates', kg: 'style0_qty', key: 'sorting.style_0' },
            { crates: 'style1_crates', kg: 'style1_qty', key: 'sorting.style_1' },
            { crates: 'style1s_crates', kg: 'style1s_qty', key: 'sorting.style_1S' },
            { crates: 'style4l_crates', kg: 'style4l_qty', key: 'sorting.style_4L' },
            { crates: 'style5_crates', kg: 'style5_qty', key: 'sorting.style_5' },
            { crates: 'style6_crates', kg: 'style6_qty', key: 'sorting.style_6' },
            { crates: 'style78_crates', kg: 'style78_qty', key: 'sorting.style_78' },
            { crates: 'sinker_crates_in', kg: 'sinker_qty_in', key: 'sorting.sinker_in' },
            { crates: 'butterlow_crates', kg: 'butterlow_qty', key: 'sorting.butterlow' }
        ]
    };

    /** Sorting crate groups (data-group on the production sheet): sound kernel vs butter. */
    var SORT_GROUPS = {
        sk: ['style0', 'style1', 'style1s', 'style4l', 'style5', 'style6', 'style78'],
        bt: ['butterlow']
    };
    /** Packing carton groups (data-group on the production sheet). */
    var PACK_GROUPS = {
        sk: ['sk_sp', 'sk_0', 'sk_1', 'sk_1s', 'sk_4l', 'sk_5', 'sk_6'],
        bt: ['bt_78', 'bt_high', 'bt_low']
    };

    var SECTION_LABELS = {
        details: 'Batch details',
        receiving: 'Receiving',
        samples: 'Intake samples',
        production: 'Production days',
        jobcard: 'Job card',
        qa: 'End sample (QA)',
        dispatch: 'Dispatch'
    };

    var state = freshState();

    function freshState() {
        return {
            kernelId: null,
            row: null,
            detail: null,
            hooks: null,
            editing: null,      // 'details' | 'receiving' | 'samples' | 'jobcard' | 'qa' | 'stage'
            dayKey: null,       // selected production day (YYYY-MM-DD)
            openStage: null,    // stage panel shown under the day cards
            stageEditing: false,
            suppliers: undefined,
            crateKg: {},
            saving: false,
            loadSeq: 0,
            scroll: null,
            error: null
        };
    }

    // ------------------------------------------------------------------ small helpers

    function esc(s) {
        if (s == null) return '';
        if (typeof _common !== 'undefined' && _common.escapeHtml) return _common.escapeHtml(s);
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function df() {
        if (typeof dataFunctions !== 'undefined' && dataFunctions) return dataFunctions;
        if (typeof _dataFunctions !== 'undefined' && _dataFunctions) return _dataFunctions;
        return null;
    }

    function can(actionKey) {
        return typeof window.hasAction === 'function' && window.hasAction(actionKey);
    }

    function numOrNull(v) {
        if (v == null || v === '') return null;
        var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, ''));
        return isFinite(n) ? n : null;
    }

    function kgNum(v) {
        if (v == null || v === '') return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        return _common.parseKg(v);
    }

    /** 1,234.50 kg, or the given empty marker. */
    function kgText(v, empty) {
        var n = kgNum(v);
        if (n == null) return empty == null ? '—' : empty;
        return _common.formatKg(n) + ' kg';
    }

    function isoDate(v) {
        if (v == null || v === '') return '';
        var s = String(v).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
        return '';
    }

    /** dd/mm/yyyy from an ISO date, without a timezone round-trip. */
    function dateText(v, empty) {
        var iso = isoDate(v);
        if (!iso) return empty == null ? '—' : empty;
        var p = iso.split('-');
        return p[2] + '/' + p[1] + '/' + p[0];
    }

    function hasText(v) {
        return v != null && String(v).trim() !== '';
    }

    function parseJson(v) {
        if (v && typeof v === 'string') {
            try { return JSON.parse(v); } catch (e) { return null; }
        }
        return v;
    }

    function obj(v) {
        v = parseJson(v);
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    }

    function arr(v) {
        v = parseJson(v);
        return Array.isArray(v) ? v : [];
    }

    function isTrue(v) {
        return v === true || v === 'true' || v === 1 || v === '1';
    }

    function isFalse(v) {
        return v === false || v === 'false' || v === 0 || v === '0';
    }

    /** Unwrap an RPC result ({ fn: {...} }, { data }, [row], JSON string) and throw on success:false. */
    function assertOk(result, fnName) {
        var r = result;
        if (r && typeof r === 'object' && r.data !== undefined && r.data !== null) r = r.data;
        if (r && typeof r === 'object' && fnName && r[fnName] !== undefined) r = r[fnName];
        if (typeof r === 'string') {
            try { r = JSON.parse(r); } catch (e) { /* keep */ }
        }
        if (Array.isArray(r) && r.length === 1 && r[0] && typeof r[0] === 'object') r = r[0];
        if (r && typeof r === 'object' && (r.success === false || r.Success === false)) {
            throw new Error(r.error || r.Error || 'Save failed');
        }
        return r;
    }

    function toast(title, text) {
        if (typeof Swal === 'undefined') return;
        Swal.fire({ icon: 'success', title: title, text: text || '', timer: 2200, showConfirmButton: false });
    }

    function showError(msg) {
        if (typeof Swal !== 'undefined') Swal.fire('Error', msg, 'error');
        else window.alert(msg);
    }

    function confirmBox(title, html, confirmText) {
        if (typeof Swal === 'undefined') {
            return Promise.resolve(window.confirm(title));
        }
        return Swal.fire({
            title: title,
            html: html,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: confirmText || 'Continue',
            cancelButtonText: 'Cancel'
        }).then(function (res) { return !!(res && res.isConfirmed); });
    }

    function historyHelpersReady() {
        return typeof window.buildBatchHistoryDispatchPanelHtml === 'function' &&
            typeof window.renderBatchHistoryProductionSchemaTable === 'function';
    }

    // ------------------------------------------------------------------ derived data

    function intake() { return obj(state.detail && state.detail.intake_data); }
    function checklist() { return obj(intake().receiving_checklist); }
    function delivery() {
        var d = intake().delivery;
        return d && typeof d === 'object' ? d : null;
    }
    function ziplock() {
        var z = intake().ziplock_sample;
        return z && typeof z === 'object' ? z : null;
    }
    function fiveKg() {
        var f = intake().five_kg_sample;
        return f && typeof f === 'object' ? f : null;
    }
    function jobCard() { return obj(state.detail && state.detail.job_card_data); }
    function qaData() { return obj(state.detail && state.detail.qa_data); }

    /** Job card value, accepting the legacy p_-prefixed key (as modal_batch_history.js jcVal does). */
    function jcVal(key) {
        var jc = jobCard();
        if (jc[key] != null && jc[key] !== '') return jc[key];
        var pk = 'p_' + key;
        return jc[pk] != null && jc[pk] !== '' ? jc[pk] : null;
    }

    /** Same test as modal_kernel_job_card.js jobCardDataHasContent: a job card exists once any real key has a value. */
    function jobCardHasContent() {
        var jc = jobCard();
        return Object.keys(jc).some(function (k) {
            if (k === 'production_batch_id' || k === 'id' || k.indexOf('_') === 0) return false;
            var v = jc[k];
            if (v == null || v === '') return false;
            if (Array.isArray(v)) return v.length > 0;
            if (typeof v === 'object') return Object.keys(v).length > 0;
            return true;
        });
    }

    function isJobcardApproved() {
        var d = df();
        var row = state.row || {};
        if (d && typeof d.isKernelJobcardApproved === 'function') return d.isKernelJobcardApproved(row);
        return row.has_jobcard_approved === true || row.jobcard_approved === true;
    }

    /** QA counts as recorded once a test, a signature or its completed date is stored (not just the FFA from Batch details). */
    function qaRecorded() {
        var qa = qaData();
        var keys = ['completed_at', 'supervisor_signed_by', 'nut_plant_manager_signed_by', 'lab_test_pdf_url'];
        QA_TESTS.forEach(function (t) { keys.push(t.key + '_required'); keys.push(t.key + '_result'); });
        return keys.some(function (k) {
            if (k === 'ffa_result') return false;
            var v = qa[k];
            return v === true || (v != null && v !== false && String(v).trim() !== '');
        });
    }

    /** kg cracked for one day entry: volume_cracked, else endqty1, else totalqty (modal_production_stages.js crackKgCracked). */
    function crackKg(c) {
        if (!c) return null;
        var keys = ['volume_cracked', 'endqty1', 'totalqty'];
        for (var i = 0; i < keys.length; i++) {
            var n = numOrNull(c[keys[i]]);
            if (n != null) return n;
        }
        return null;
    }

    /**
     * Production days grouped by date, exactly as the Batch history popup groups them (date-only and
     * placeholder rows are ignored). Each stage holds the merged entry for that date.
     */
    function productionDays() {
        var d = state.detail || {};
        var map = {};
        var noDate = '__nodate';
        STAGES.forEach(function (st) {
            arr(d[st.key + '_data']).forEach(function (entry) {
                var raw = entry && entry.date;
                var key = (raw && typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) ? raw.substring(0, 10) : noDate;
                if (!map[key]) map[key] = { cracking: [], washing: [], sorting: [], packing: [] };
                map[key][st.key].push(entry);
            });
        });
        var keys = Object.keys(map).sort(function (a, b) {
            if (a === noDate) return 1;
            if (b === noDate) return -1;
            return a < b ? -1 : (a > b ? 1 : 0);
        });
        var out = [];
        keys.forEach(function (key) {
            var g = map[key];
            if (typeof batchHistoryDayGroupHasAnyMeaningfulStage === 'function' && !batchHistoryDayGroupHasAnyMeaningfulStage(g)) return;
            var day = { key: key, date: key === noDate ? null : key, num: out.length + 1, stages: {} };
            STAGES.forEach(function (st) {
                var list = g[st.key];
                day.stages[st.key] = (list.length && batchHistoryStageArrayHasMeaningful(list)) ? mergeBatchHistoryStageObjects(list) : null;
            });
            out.push(day);
        });
        return out;
    }

    function dispatchOrders() {
        return typeof parseDispatchOrdersFromDetail === 'function' ? parseDispatchOrdersFromDetail(state.detail) : [];
    }

    function keyFigures() {
        var d = state.detail || {};
        var row = state.row || {};
        var weighed = row.actual_wet_nis_kg != null && row.actual_wet_nis_kg !== '' ? row.actual_wet_nis_kg : d.actual_wet_nis_kg;
        var declared = row.wet_nis_received_kg;
        var wet = kgNum(weighed) != null ? { v: weighed, note: 'weighed' } : { v: declared, note: kgNum(declared) != null ? 'declared' : '' };

        var z = ziplock() || {};
        var f = fiveKg() || {};
        var moisture = numOrNull(z.moisture_result);
        if (moisture == null) moisture = numOrNull(f.moisture_result);

        var cracked = 0;
        arr(d.cracking_data).forEach(function (c) { cracked += crackKg(c) || 0; });

        var packed = 0;
        arr(d.packing_data).forEach(function (p) { packed += kgNum(p && p.sk_total_qty) || 0; });
        if (!packed && kgNum(jcVal('sound_kernel_total_kg')) != null) packed = kgNum(jcVal('sound_kernel_total_kg'));

        var dispatched = 0;
        dispatchOrders().forEach(function (o) {
            arr(o && (o.lines != null ? o.lines : o.Lines)).forEach(function (ln) {
                dispatched += (typeof batchHistoryDispatchLineKg === 'function' ? batchHistoryDispatchLineKg(ln) : 0) || 0;
            });
        });
        return { wet: wet, moisture: moisture, cracked: cracked, packed: packed, dispatched: dispatched };
    }

    function journeySteps() {
        var d = state.detail || {};
        var cl = checklist();
        var days = productionDays();
        var z = ziplock();
        var f = fiveKg();
        var samplesDone = !!(z && z.completed_at) && !!(f && f.completed_at);
        var steps = [
            { label: 'Received', done: Object.keys(cl).length > 0 || !!delivery() || !!d.received_date },
            { label: 'Samples', done: samplesDone },
            { label: days.length ? 'Production · day ' + days.length : 'Production', done: !!d.production_finished_at },
            { label: 'Job card', done: isJobcardApproved() },
            { label: 'End sample', done: qaRecorded() },
            { label: 'Dispatch', done: dispatchOrders().length > 0 }
        ];
        var currentSet = false;
        steps.forEach(function (s) {
            if (s.done) { s.state = 'done'; return; }
            if (!currentSet) { s.state = 'current'; currentSet = true; return; }
            s.state = 'todo';
        });
        return steps;
    }

    function displayStatus() {
        var row = state.row || state.detail || {};
        return typeof BatchStatus !== 'undefined' ? BatchStatus.getDisplayStatus(row) : { value: '', label: row.status || '' };
    }

    function isGrowerIntakeStage() {
        return displayStatus().bucket === 'grower';
    }

    // ------------------------------------------------------------------ rendering: frame

    function container() { return document.getElementById(CONTAINER_ID); }

    function render() {
        var el = container();
        if (!el) return;
        if (!state.detail) {
            el.innerHTML = backLinkHtml() + (state.error
                ? '<div class="alert alert-danger">' + esc(state.error) + '</div>'
                : '<div class="card"><div class="card-body text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Loading batch…</div></div>');
            return;
        }
        var html = backLinkHtml() + headerHtml();
        html += '<div class="row g-3 bjd-body">';
        html += '<div class="col-12 col-lg-3 col-xxl-2">' + navHtml() + '</div>';
        html += '<div class="col-12 col-lg-9 col-xxl-10 d-flex flex-column gap-3">';
        html += detailsSectionHtml() + receivingSectionHtml() + samplesSectionHtml() + productionSectionHtml() +
            jobCardSectionHtml() + qaSectionHtml() + dispatchSectionHtml();
        html += '</div></div>';
        el.innerHTML = html;
        afterRender();
    }

    function backLinkHtml() {
        return '<div class="bjd-breadcrumb d-flex align-items-center gap-2 mb-2 small text-muted">' +
            '<button type="button" class="btn btn-link px-0 bjd-touch" data-bjd-act="back"><i class="fas fa-chevron-left me-1"></i>Back to Find a batch</button>' +
            '<span aria-hidden="true">/</span><span>Kernel</span></div>';
    }

    function headerHtml() {
        var d = state.detail;
        var row = state.row || {};
        var ds = displayStatus();
        var badge = typeof BatchStatus !== 'undefined' ? BatchStatus.statusBadgeHtml(ds) : esc(ds.label);
        var cl = checklist();
        var dlv = delivery();
        var tr = dlv && dlv.transport && typeof dlv.transport === 'object' ? dlv.transport : {};
        var note = hasText(tr.delivery_note_ref) ? tr.delivery_note_ref : cl.delivery_note_ref;
        var sub = [];
        sub.push(esc(row.grower_name || d.grower_name || 'Grower not set'));
        sub.push('received ' + esc(dateText(row.received_date || d.received_date || cl.date_received, 'not set')));
        if (hasText(note)) sub.push('delivery note ' + esc(note));

        var routeInfo = typeof BatchStatus !== 'undefined' ? BatchStatus.getKernelRouteForStatus(ds) : null;
        var fig = keyFigures();
        var h = '<section class="card mb-3 bjd-header"><div class="card-body d-flex flex-column gap-3">';
        h += '<div class="d-flex flex-wrap justify-content-between align-items-start gap-3">';
        h += '<div class="d-flex flex-column gap-1"><div class="d-flex flex-wrap align-items-center gap-2">' +
            '<h2 class="h4 mb-0 bjd-batch-number">' + esc(d.batch_number || row.batch_number || 'Batch') + '</h2>' + badge + '</div>' +
            '<div class="small text-muted">' + sub.join(' · ') + '</div></div>';
        h += '<div class="d-flex flex-wrap gap-2">';
        if (routeInfo && routeInfo.route !== 'batch-journey') {
            h += '<button type="button" class="btn btn-outline-secondary bjd-touch" data-bjd-act="open-module">' + esc(routeInfo.label.replace(/^Open /, 'Open in ')) + '</button>';
        }
        h += '<button type="button" class="btn btn-outline-secondary bjd-touch" data-bjd-act="archive"><i class="fas fa-archive me-1"></i>Archive</button>';
        h += '</div></div>';

        h += '<div class="bjd-figures">';
        h += figureHtml('Wet NIS received', esc(kgText(fig.wet.v)), fig.wet.note);
        h += figureHtml('Intake moisture', fig.moisture != null ? esc(String(fig.moisture)) + '%' : '—', 'ziplock sample');
        h += figureHtml('Cracked so far', esc(kgText(fig.cracked, '0.00 kg')), 'all production days');
        h += figureHtml('Sound kernel packed', esc(kgText(fig.packed, '0.00 kg')), '');
        h += figureHtml('Dispatched', esc(kgText(fig.dispatched, '0.00 kg')), '');
        h += '</div>';

        h += '<ol class="bjd-journey list-unstyled mb-0">';
        journeySteps().forEach(function (s) {
            h += '<li class="bjd-step bjd-step--' + s.state + '"><span class="bjd-step-bar"></span><span class="bjd-step-label">' +
                esc(s.label) + (s.state === 'done' ? ' <i class="fas fa-check" aria-hidden="true"></i>' : '') +
                '<span class="visually-hidden"> (' + (s.state === 'done' ? 'done' : (s.state === 'current' ? 'current' : 'not yet')) + ')</span></span></li>';
        });
        h += '</ol></div></section>';
        return h;
    }

    function figureHtml(label, valueHtml, note) {
        return '<div class="bjd-figure"><div class="small text-muted">' + esc(label) + '</div>' +
            '<div class="bjd-figure-value">' + valueHtml + '</div>' +
            (note ? '<div class="small text-muted">' + esc(note) + '</div>' : '') + '</div>';
    }

    function navHtml() {
        var days = productionDays().length;
        var h = '<nav class="card bjd-nav" aria-label="Batch sections"><div class="bjd-nav-list">';
        Object.keys(SECTION_LABELS).forEach(function (key) {
            var label = SECTION_LABELS[key] + (key === 'production' && days ? ' (' + days + ')' : '');
            var active = (state.editing === key || (state.editing === 'stage' && key === 'production')) ? ' active' : '';
            h += '<button type="button" class="bjd-nav-link' + active + '" data-bjd-act="nav" data-section="' + key + '">' + esc(label) + '</button>';
        });
        return h + '</div></nav>';
    }

    /**
     * Section card. `editBtn` is the header button markup in view mode; in edit mode the header carries
     * Cancel / Save <label> and the "Editing" note.
     */
    function sectionHtml(key, opts) {
        var editing = state.editing === key;
        var h = '<section class="card bjd-section' + (editing ? ' bjd-section--editing' : '') + '" id="bjd-sec-' + key + '">';
        h += '<div class="card-header bjd-section-header d-flex flex-wrap justify-content-between align-items-center gap-2">';
        h += '<div class="d-flex flex-column"><div class="d-flex align-items-center gap-2 flex-wrap"><h3 class="h6 mb-0">' + esc(SECTION_LABELS[key]) + '</h3>' + (opts.badge || '') + '</div>';
        if (editing) h += '<span class="small bjd-editing-note">Editing — changes save to this section only</span>';
        else if (opts.subtitle) h += '<span class="small text-muted">' + opts.subtitle + '</span>';
        h += '</div><div class="d-flex flex-wrap gap-2">';
        if (editing) {
            h += '<button type="button" class="btn btn-outline-secondary btn-sm bjd-touch" data-bjd-act="cancel"' + (state.saving ? ' disabled' : '') + '>Cancel</button>';
            h += '<button type="button" class="btn btn-primary btn-sm bjd-touch" data-bjd-act="save" data-section="' + key + '"' + (state.saving ? ' disabled' : '') + '>' +
                (state.saving ? '<i class="fas fa-spinner fa-spin me-1"></i>Saving…' : 'Save ' + esc(opts.saveLabel || SECTION_LABELS[key].toLowerCase())) + '</button>';
        } else if (opts.headerButtons) {
            h += opts.headerButtons;
        }
        h += '</div></div><div class="card-body">' + opts.body + '</div></section>';
        return h;
    }

    function editButton(key, label) {
        return '<button type="button" class="btn btn-outline-secondary btn-sm bjd-touch" data-bjd-act="edit" data-section="' + key + '">' + esc(label || 'Edit') + '</button>';
    }

    function dlItem(label, valueHtml, muted) {
        return '<div class="bjd-dl-item"><dt class="small text-muted fw-normal">' + esc(label) + '</dt><dd class="mb-0' + (muted ? ' text-muted' : '') + '">' + valueHtml + '</dd></div>';
    }

    // ------------------------------------------------------------------ Batch details

    /** Row from get_kernel_batches merged with the history read — the shape KernelBatchEdit expects. */
    function batchForForm() {
        var d = state.detail || {};
        var row = state.row || {};
        return Object.assign({}, row, {
            id: row.id || d.id,
            batch_number: row.batch_number || d.batch_number,
            grower_name: row.grower_name != null ? row.grower_name : d.grower_name,
            received_date: row.received_date || d.received_date,
            best_before_date: row.best_before_date || jcVal('best_before_date')
        });
    }

    function detailsSectionHtml() {
        var b = batchForForm();
        var body;
        if (state.editing === 'details') {
            body = (typeof KernelBatchEdit !== 'undefined' && KernelBatchEdit.gridFormHtml)
                ? KernelBatchEdit.gridFormHtml(b, state.suppliers || null, BATCH_FORM_PREFIX)
                : '<p class="text-danger mb-0">Edit is not available. Refresh the page and try again.</p>';
        } else {
            body = '<dl class="bjd-dl mb-0">' +
                dlItem('Batch number', esc(b.batch_number || '—')) +
                dlItem('Grower', esc(b.grower_name || '—'), !b.grower_name) +
                dlItem('Received date', esc(dateText(b.received_date, 'Not set')), !b.received_date) +
                dlItem('Supplier\'s declared weight', esc(kgText(b.wet_nis_received_kg, 'Not set')), kgNum(b.wet_nis_received_kg) == null) +
                dlItem('Weighed total (wet NIS)', esc(kgText(b.actual_wet_nis_kg != null ? b.actual_wet_nis_kg : (state.detail || {}).actual_wet_nis_kg, 'Not weighed')), false) +
                dlItem('FFA (QA)', b.ffa != null && b.ffa !== '' ? esc(String(b.ffa)) : 'Not set', b.ffa == null || b.ffa === '') +
                dlItem('Best before', esc(dateText(b.best_before_date, 'Not set')), !b.best_before_date) +
                '</dl>' +
                '<p class="small text-muted mt-3 mb-0">The weighed total comes from the delivery bags (or received items) — change those under Receiving.</p>';
        }
        return sectionHtml('details', { body: body, headerButtons: editButton('details'), saveLabel: 'batch details' });
    }

    // ------------------------------------------------------------------ Receiving

    function receivingSectionHtml() {
        var cl = checklist();
        var dlv = delivery();
        var hasAny = Object.keys(cl).length > 0 || !!dlv;
        var body = state.editing === 'receiving' ? receivingEditHtml() : receivingViewHtml();
        return sectionHtml('receiving', {
            body: body,
            headerButtons: editButton('receiving', hasAny ? 'Edit' : 'Add checklist'),
            saveLabel: 'receiving'
        });
    }

    /** Removed pre-sizer: the batch-level figure (release + silo allocations) wins over the checklist's own copy. */
    function preSizerInfo() {
        var top = intake().removed_pre_sizer_kg;
        if (top != null && top !== '') return { value: top, locked: true };
        return { value: checklist().removed_pre_sizer_kg, locked: false };
    }

    function receivingViewHtml() {
        var cl = checklist();
        var dlv = delivery();
        var tr = dlv && dlv.transport && typeof dlv.transport === 'object' ? dlv.transport : {};
        if (!Object.keys(cl).length && !dlv) {
            return '<p class="text-muted mb-0">No receiving checklist or delivery recorded yet.</p>';
        }
        var note = hasText(tr.delivery_note_ref) ? tr.delivery_note_ref : cl.delivery_note_ref;
        var pre = preSizerInfo();
        var h = '<dl class="bjd-dl">';
        h += dlItem('Date received (checklist)', esc(dateText(cl.date_received || (state.detail || {}).received_date, 'Not set')));
        h += dlItem('Delivery note ref', hasText(note) ? esc(note) : 'Not set', !hasText(note));
        h += dlItem('Removed pre-sizer', esc(kgText(pre.value, 'Not set')), kgNum(pre.value) == null);
        if (dlv) {
            h += dlItem('Transporter', hasText(tr.transporter_name) ? esc(tr.transporter_name) : '—');
            h += dlItem('Transport type', hasText(tr.transport_type_name) ? esc(tr.transport_type_name) : '—');
        }
        h += '</dl>';

        h += '<h4 class="bjd-subhead">Truck and load checks</h4><div class="bjd-check-grid">';
        var comments = obj(cl.item_comments);
        var photos = obj(cl.item_photos);
        CHECKS.forEach(function (c) {
            var v = cl[c.key];
            var bad = hasText(v) && String(v).toLowerCase() === c.bad.toLowerCase();
            h += '<div class="bjd-check' + (bad ? ' bjd-check--bad' : '') + '"><div class="d-flex justify-content-between gap-2"><span>' + esc(c.q) + '</span>' +
                '<strong>' + (hasText(v) ? esc(v) : '<span class="text-muted fw-normal">—</span>') + '</strong></div>';
            if (hasText(comments[c.key])) h += '<div class="small text-muted mt-1">' + esc(comments[c.key]) + '</div>';
            var ph = typeof historyFileLinksHtml === 'function' ? historyFileLinksHtml(photos[c.key]) : '';
            if (ph) h += '<div class="small mt-1">Photos: ' + ph + '</div>';
            h += '</div>';
        });
        h += '</div>';

        h += itemsViewHtml();
        h += '<h4 class="bjd-subhead">Comments</h4><p class="mb-0' + (hasText(cl.comments) ? '' : ' text-muted') + '">' + (hasText(cl.comments) ? esc(cl.comments) : 'None') + '</p>';
        return h;
    }

    function itemsViewHtml() {
        var dlv = delivery();
        var bags = dlv && Array.isArray(dlv.bags) ? dlv.bags : [];
        var h = '';
        if (bags.length) {
            var total = 0;
            h += '<h4 class="bjd-subhead">Delivery bags</h4><div class="table-responsive bjd-table-box"><table class="table align-middle mb-0"><thead><tr><th>No.</th><th>Description</th><th class="text-end">Weight (kg)</th></tr></thead><tbody>';
            bags.forEach(function (bag) {
                total += kgNum(bag && bag.weight_kg) || 0;
                h += '<tr><td>' + esc(bag && bag.no) + '</td><td>' + esc(bag && bag.description) + '</td><td class="text-end">' + esc(_common.formatKg(kgNum(bag && bag.weight_kg))) + '</td></tr>';
            });
            h += '<tr class="fw-semibold"><td colspan="2">Weighed total</td><td class="text-end">' + esc(_common.formatKg(total)) + '</td></tr></tbody></table></div>';
            var docs = typeof historyFileLinksHtml === 'function' ? historyFileLinksHtml(dlv.documents) : '';
            if (docs) h += '<p class="small mt-2 mb-0">Documents: ' + docs + '</p>';
            return h;
        }
        var items = arr(checklist().received_items);
        if (!items.length) return '';
        var sum = 0;
        h += '<h4 class="bjd-subhead">Received items</h4><div class="table-responsive bjd-table-box"><table class="table align-middle mb-0"><thead><tr><th>Description</th><th class="text-end">Qty (kg)</th><th>Manufactured</th></tr></thead><tbody>';
        items.forEach(function (it) {
            sum += kgNum(it && it.quantity_kg) || 0;
            h += '<tr><td>' + esc(it && it.description) + '</td><td class="text-end">' + esc(_common.formatKg(kgNum(it && it.quantity_kg))) + '</td><td>' + esc(dateText(it && it.manufactured_date, '')) + '</td></tr>';
        });
        h += '<tr class="fw-semibold"><td>Total</td><td class="text-end">' + esc(_common.formatKg(sum)) + '</td><td></td></tr></tbody></table></div>';
        return h;
    }

    function receivingEditHtml() {
        var cl = checklist();
        var dlv = delivery();
        var tr = dlv && dlv.transport && typeof dlv.transport === 'object' ? dlv.transport : {};
        var noteLocked = hasText(tr.delivery_note_ref);
        var pre = preSizerInfo();
        var comments = obj(cl.item_comments);
        var h = '<div class="row g-2">';
        h += '<div class="col-12 col-md-4"><label class="form-label" for="bjdRcvDate">Date received</label>' +
            '<input type="date" class="form-control" id="bjdRcvDate" value="' + esc(isoDate(cl.date_received)) + '"></div>';
        h += '<div class="col-12 col-md-4"><label class="form-label" for="bjdRcvNote">Delivery note ref</label>';
        if (noteLocked) {
            h += '<input type="text" class="form-control" id="bjdRcvNote" value="' + esc(tr.delivery_note_ref) + '" readonly>' +
                '<div class="form-text">Recorded on New Delivery with the bags; shown from there.</div>';
        } else {
            h += '<input type="text" class="form-control" id="bjdRcvNote" value="' + esc(cl.delivery_note_ref || '') + '">';
        }
        h += '</div>';
        h += '<div class="col-12 col-md-4"><label class="form-label" for="bjdRcvPre">Removed pre-sizer (kg)</label>';
        if (pre.locked) {
            h += '<input type="text" class="form-control text-end" id="bjdRcvPre" value="' + esc(_common.formatKg(kgNum(pre.value))) + '" readonly>' +
                '<div class="form-text">Set at release and silo allocation; change it there.</div>';
        } else {
            h += '<input type="text" inputmode="decimal" class="form-control text-end js-kg-input" id="bjdRcvPre" value="' + esc(_common.formatKg(kgNum(pre.value))) + '">';
        }
        h += '</div></div>';

        h += '<h4 class="bjd-subhead">Truck and load checks</h4><div class="bjd-check-grid">';
        CHECKS.forEach(function (c) {
            var v = hasText(cl[c.key]) ? String(cl[c.key]) : '';
            var norm = v.toLowerCase();
            h += '<div class="bjd-check" data-check="' + c.key + '"><label class="d-flex justify-content-between align-items-center gap-2 mb-0" for="bjdChk_' + c.key + '">' +
                '<span>' + esc(c.q) + '</span>' +
                '<select class="form-select form-select-sm bjd-check-select" id="bjdChk_' + c.key + '" data-bjd-check="' + c.key + '">' +
                '<option value=""' + (v === '' ? ' selected' : '') + '>—</option>' +
                '<option value="Yes"' + (norm === 'yes' ? ' selected' : '') + '>Yes</option>' +
                '<option value="No"' + (norm === 'no' ? ' selected' : '') + '>No</option>' +
                '</select></label>' +
                '<input type="text" class="form-control form-control-sm mt-2 bjd-check-comment' + (norm === c.bad.toLowerCase() ? '' : ' d-none') + '" id="bjdChkCmt_' + c.key + '" placeholder="What was wrong? (required)" value="' + esc(comments[c.key] || '') + '">' +
                '</div>';
        });
        h += '</div><p class="small text-muted mt-1 mb-0">Answer all six; a problem answer needs a comment, as on the Grower Intake checklist. Photos stay as they are — add or remove them on Grower Intake.</p>';

        var bags = dlv && Array.isArray(dlv.bags) ? dlv.bags : [];
        if (bags.length) {
            h += itemsViewHtml();
            h += '<p class="small text-muted mt-2 mb-0">Bag weights are recorded on New Delivery and set the weighed total; they cannot be changed from here.</p>';
        } else {
            var items = arr(cl.received_items);
            h += '<h4 class="bjd-subhead">Received items</h4>';
            h += '<div class="table-responsive bjd-table-box"><table class="table align-middle mb-0 bjd-items-table"><thead><tr><th>Description</th><th class="text-end">Qty (kg)</th><th>Manufactured</th><th class="bjd-col-btn"><span class="visually-hidden">Remove</span></th></tr></thead><tbody id="bjdItemsBody">';
            if (!items.length) items = [{}];
            items.forEach(function (it) { h += itemRowHtml(it); });
            h += '</tbody><tfoot><tr class="fw-semibold"><td>Total (becomes the weighed total)</td><td class="text-end" id="bjdItemsTotal"></td><td colspan="2"></td></tr></tfoot></table></div>';
            h += '<button type="button" class="btn btn-outline-secondary btn-sm mt-2 bjd-touch" data-bjd-act="add-item"><i class="fas fa-plus me-1"></i>Add item</button>';
            h += '<p class="small text-muted mt-2 mb-0">Saving with items replaces the batch\'s weighed total (wet NIS) with this total.</p>';
        }

        h += '<label class="form-label mt-3" for="bjdRcvComments">Comments</label>' +
            '<textarea class="form-control" id="bjdRcvComments" rows="2">' + esc(cl.comments || '') + '</textarea>';
        return h;
    }

    function itemRowHtml(it) {
        it = it || {};
        var q = kgNum(it.quantity_kg);
        return '<tr class="bjd-item-row">' +
            '<td><input type="text" class="form-control form-control-sm" data-item="description" aria-label="Description" value="' + esc(it.description || '') + '"></td>' +
            '<td><input type="text" inputmode="decimal" class="form-control form-control-sm text-end js-kg-input" data-item="quantity_kg" aria-label="Quantity kg" value="' + esc(q == null ? '' : _common.formatKg(q)) + '"></td>' +
            '<td><input type="date" class="form-control form-control-sm" data-item="manufactured_date" aria-label="Manufactured date" value="' + esc(isoDate(it.manufactured_date)) + '"></td>' +
            '<td class="text-center"><button type="button" class="btn btn-outline-danger btn-sm bjd-touch" data-bjd-act="remove-item" aria-label="Remove row"><i class="fas fa-times"></i></button></td>' +
            '</tr>';
    }

    function updateItemsTotal() {
        var total = 0;
        $('#bjdItemsBody input[data-item="quantity_kg"]').each(function () { total += _common.parseKg(this.value) || 0; });
        $('#bjdItemsTotal').text(_common.formatKg(total));
    }

    // ------------------------------------------------------------------ Intake samples

    function samplesSectionHtml() {
        var body = state.editing === 'samples' ? samplesEditHtml() : samplesViewHtml();
        var any = !!(ziplock() || fiveKg());
        return sectionHtml('samples', { body: body, headerButtons: editButton('samples', any ? 'Edit' : 'Add samples'), saveLabel: 'samples' });
    }

    function gText(v) {
        var n = numOrNull(v);
        return n == null ? '—' : esc(n.toLocaleString('en-US', { maximumFractionDigits: 2 })) + ' g';
    }

    function samplesViewHtml() {
        var z = ziplock();
        var f = fiveKg();
        var h = '<div class="bjd-card-grid">';
        h += '<div class="bjd-subcard"><div class="d-flex justify-content-between align-items-baseline"><h4 class="h6 mb-0">Ziplock sample</h4><span class="small text-muted">' + esc(z ? dateText(z.completed_at, '') : '') + '</span></div>';
        if (!z) {
            h += '<p class="text-muted small mb-0 mt-2">Not taken yet.</p>';
        } else {
            h += '<div class="bjd-mini-grid mt-2">';
            ZIPLOCK_TESTS.forEach(function (t) {
                var r = numOrNull(z[t.key + '_result']);
                var req = isTrue(z[t.key + '_required']);
                h += '<div><div class="small text-muted">' + esc(t.label) + (req ? '' : ' (not required)') + '</div><div class="fw-semibold">' + (r == null ? '—' : esc(String(r)) + esc(t.unit)) + '</div></div>';
            });
            h += '</div><div class="small text-muted mt-2">Wet nut-in-shell: ' + esc(kgText(z.wet_nut_in_shell_kg)) + '</div>';
        }
        h += '</div>';

        h += '<div class="bjd-subcard"><div class="d-flex justify-content-between align-items-baseline"><h4 class="h6 mb-0">5 kg sample</h4><span class="small text-muted">' + esc(f ? dateText(f.completed_at, '') : '') + '</span></div>';
        if (!f) {
            h += '<p class="text-muted small mb-0 mt-2">Not taken yet.</p>';
        } else {
            var co = obj(f.crack_out);
            var ft = obj(f.float_test);
            var un = obj(f.unsound);
            h += '<div class="bjd-mini-grid mt-2">' +
                '<div><div class="small text-muted">Sound kernel</div><div class="fw-semibold">' + gText(co.sound_kernel_g) + '</div></div>' +
                '<div><div class="small text-muted">Unsound</div><div class="fw-semibold">' + gText(co.unsound_kernel_g) + '</div></div>' +
                '<div><div class="small text-muted">Shell</div><div class="fw-semibold">' + gText(co.shell_g) + '</div></div></div>';
            h += '<div class="small text-muted mt-2">Float test: ' + gText(ft.floating_g) + ' floating · ' + gText(ft.sinking_g) + ' sinking</div>';
            h += '<details class="small mt-2"><summary class="bjd-summary">Unsound breakdown (9 types)</summary><div class="bjd-mini-grid mt-2">';
            UNSOUND.forEach(function (u) { h += '<span class="text-muted">' + esc(u.label) + ' ' + gText(un[u.key]) + '</span>'; });
            h += '</div></details>';
        }
        h += '</div></div>';
        return h;
    }

    function numInput(id, value, opts) {
        opts = opts || {};
        return '<input type="number" step="any" min="0" inputmode="decimal" class="form-control' + (opts.sm ? ' form-control-sm' : '') + '" id="' + id + '" value="' + esc(value == null ? '' : String(value)) + '"' + (opts.label ? ' aria-label="' + esc(opts.label) + '"' : '') + '>';
    }

    function samplesEditHtml() {
        var z = ziplock() || {};
        var f = fiveKg() || {};
        var co = obj(f.crack_out);
        var ft = obj(f.float_test);
        var un = obj(f.unsound);
        var h = '<div class="bjd-card-grid">';
        h += '<div class="bjd-subcard"><h4 class="h6">Ziplock sample</h4>';
        h += '<div class="table-responsive bjd-table-box"><table class="table align-middle mb-0"><thead><tr><th>Test</th><th class="text-center">Required</th><th>Result</th></tr></thead><tbody>';
        ZIPLOCK_TESTS.forEach(function (t) {
            h += '<tr><td>' + esc(t.label) + '</td><td class="text-center"><input type="checkbox" class="form-check-input bjd-check-input" id="bjdZl_' + t.key + '_required"' + (isTrue(z[t.key + '_required']) ? ' checked' : '') + ' aria-label="' + esc(t.label) + ' required"></td>' +
                '<td>' + numInput('bjdZl_' + t.key + '_result', z[t.key + '_result'], { sm: true, label: t.label + ' result' }) + '</td></tr>';
        });
        h += '</tbody></table></div>';
        h += '<label class="form-label mt-2" for="bjdZl_wet_nut_in_shell_kg">Wet nut-in-shell (kg)</label>' +
            '<input type="text" inputmode="decimal" class="form-control js-kg-input" id="bjdZl_wet_nut_in_shell_kg" value="' + esc(kgNum(z.wet_nut_in_shell_kg) == null ? '' : _common.formatKg(kgNum(z.wet_nut_in_shell_kg))) + '">';
        h += '</div>';

        h += '<div class="bjd-subcard"><h4 class="h6">5 kg sample</h4><div class="row g-2">';
        [['crack_out_sound_kernel_g', 'Crack-out: sound kernel (g)', co.sound_kernel_g],
            ['crack_out_unsound_kernel_g', 'Crack-out: unsound kernel (g)', co.unsound_kernel_g],
            ['crack_out_shell_g', 'Crack-out: shell (g)', co.shell_g],
            ['float_floating_g', 'Float test: floating (g)', ft.floating_g],
            ['float_sinking_g', 'Float test: sinking (g)', ft.sinking_g]].forEach(function (f5) {
            h += '<div class="col-12 col-sm-6"><label class="form-label small mb-1" for="bjd5_' + f5[0] + '">' + esc(f5[1]) + '</label>' + numInput('bjd5_' + f5[0], f5[2]) + '</div>';
        });
        h += '</div><h5 class="bjd-subhead">Unsound breakdown (g)</h5><div class="row g-2">';
        UNSOUND.forEach(function (u) {
            h += '<div class="col-6 col-sm-4"><label class="form-label small mb-1" for="bjd5_unsound_' + u.key + '">' + esc(u.label) + '</label>' + numInput('bjd5_unsound_' + u.key, un[u.key]) + '</div>';
        });
        h += '</div></div></div>';
        h += '<p class="small text-muted mt-2 mb-0">Only a sample you change is saved. Saving a sample marks it completed today (that is how the sample save works everywhere). The batch does not move back a step.</p>';
        return h;
    }

    // ------------------------------------------------------------------ Production days

    function stageSchema(stageKey, entry) {
        if (stageKey === 'cracking') return buildBatchHistoryCrackingSchema(entry || {});
        if (stageKey === 'washing') return BATCH_HISTORY_WASHING_SCHEMA;
        if (stageKey === 'sorting') return BATCH_HISTORY_SORTING_SCHEMA;
        return BATCH_HISTORY_PACKING_SCHEMA;
    }

    function stageSummaryHtml(stageKey, e) {
        if (!e) return '<div class="small text-muted">Nothing recorded for this day</div>';
        var n = numOrNull;
        if (stageKey === 'cracking') {
            var t = [hasText(e.start1) && hasText(e.end1) ? esc(e.start1) + ' – ' + esc(e.end1) : '', hasText(e.timespent1) ? esc(e.timespent1) : (hasText(e.totaltime) ? esc(e.totaltime) : '')].filter(Boolean).join(' · ');
            var parts = [];
            if (n(e.avg_wholes) != null) parts.push('Avg wholes ' + esc(String(e.avg_wholes)));
            if (n(e.avg_uncracks) != null) parts.push('uncracks ' + esc(String(e.avg_uncracks)));
            if (kgNum(e.shell_total) != null) parts.push('shell ' + esc(kgText(e.shell_total)));
            return (t ? '<div class="small text-muted">' + t + '</div>' : '') +
                '<div class="bjd-stage-figure">' + esc(kgText(crackKg(e))) + '</div>' +
                (parts.length ? '<div class="small text-muted">' + parts.join(' · ') + '</div>' : '');
        }
        if (stageKey === 'washing') {
            var tests = 0, passed = 0;
            [1, 2, 3].forEach(function (i) {
                if (hasText(e['test' + i + '_time']) || e['test' + i + '_pass'] != null) tests++;
                if (isTrue(e['test' + i + '_pass'])) passed++;
            });
            return '<div class="small text-muted">' + esc(kgText(e.qty_in)) + ' in → ' + esc(kgText(e.total_qty)) + ' out</div>' +
                '<div class="bjd-stage-figure">' + (kgNum(e.qty_diff) != null ? esc(kgText(e.qty_diff)) : '—') + '</div>' +
                '<div class="small text-muted">Peracetic tests ' + passed + ' of ' + tests + ' passed</div>';
        }
        if (stageKey === 'sorting') {
            var sound = kgNum(e.sound_qty) || 0;
            var butter = kgNum(e.butter_qty) || 0;
            return '<div class="small text-muted">Sound ' + esc(kgText(sound)) + ' · Butter ' + esc(kgText(butter)) + '</div>' +
                '<div class="bjd-stage-figure">' + esc(kgText(sound + butter)) + '</div>';
        }
        return '<div class="small text-muted">Sound ' + esc(hasText(e.sk_total_cartons) ? String(e.sk_total_cartons) : '0') + ' cartons · Butter ' + esc(hasText(e.bt_total_cartons) ? String(e.bt_total_cartons) : '0') + ' cartons</div>' +
            '<div class="bjd-stage-figure">' + esc(kgText(e.totals_qty)) + '</div>';
    }

    /** Why a stage cannot be edited here, or '' when it can. */
    function stageLockReason(stageKey, day) {
        if (stageKey === 'cracking') {
            return 'Cracking is filled from the silo Cracking log and also books shell stock, so it is edited on Kernel Production only.';
        }
        if (!day || !day.date) return 'This entry has no date, so it cannot be matched for saving. Open it on Kernel Production.';
        if (!can('kernel.production_stages.edit')) return 'Your role cannot edit production stages.';
        if (isGrowerIntakeStage()) return 'This batch has not been released to production yet.';
        if (stageKey === 'packing' && isJobcardApproved()) {
            return 'The job card is approved, so packing is locked; stock now follows the job card.';
        }
        return '';
    }

    function productionSectionHtml() {
        var days = productionDays();
        var body;
        if (!days.length) {
            body = '<p class="text-muted mb-0">No production days recorded yet. Days are started on Kernel Production.</p>';
        } else {
            if (!state.dayKey || !days.some(function (d) { return d.key === state.dayKey; })) state.dayKey = days[days.length - 1].key;
            var day = days.filter(function (d) { return d.key === state.dayKey; })[0];
            body = '<div class="d-flex flex-wrap gap-2 mb-3" role="tablist" aria-label="Production day">';
            days.forEach(function (d) {
                var sel = d.key === state.dayKey;
                body += '<button type="button" role="tab" aria-selected="' + sel + '" class="btn btn-sm rounded-pill bjd-touch ' + (sel ? 'btn-primary' : 'btn-outline-secondary') + '" data-bjd-act="day" data-day="' + esc(d.key) + '"' + (state.editing === 'stage' ? ' disabled' : '') + '>' +
                    'Day ' + d.num + (d.date ? ' · ' + esc(dateText(d.date).slice(0, 5)) : '') + '</button>';
            });
            body += '</div><div class="bjd-card-grid bjd-card-grid--stages">';
            STAGES.forEach(function (st) {
                var e = day.stages[st.key];
                var lock = stageLockReason(st.key, day);
                var btn = '';
                if (!lock && state.editing !== 'stage') {
                    btn = '<button type="button" class="btn btn-outline-secondary btn-sm bjd-touch" data-bjd-act="stage-edit" data-stage="' + st.key + '">' + (e ? 'Edit' : 'Add') + '</button>';
                } else if (e && state.editing !== 'stage') {
                    btn = '<button type="button" class="btn btn-outline-secondary btn-sm bjd-touch" data-bjd-act="stage-view" data-stage="' + st.key + '">View</button>';
                }
                var open = state.openStage === st.key;
                body += '<div class="bjd-subcard' + (e ? '' : ' bjd-subcard--empty') + (open ? ' bjd-subcard--open' : '') + '">' +
                    '<div class="d-flex justify-content-between align-items-center gap-2"><h4 class="h6 mb-0">' + esc(st.label) + '</h4>' + btn + '</div>' +
                    stageSummaryHtml(st.key, e) + '</div>';
            });
            body += '</div>';
            if (state.openStage) body += stagePanelHtml(day, state.openStage);
        }
        var sub = 'Pick a day, then view or edit a stage';
        return sectionHtml('production', {
            body: body,
            subtitle: sub,
            headerButtons: '<button type="button" class="btn btn-link btn-sm bjd-touch" data-bjd-act="open-production">Open Kernel Production</button>'
        }).replace('bjd-section"', state.editing === 'stage' ? 'bjd-section bjd-section--editing"' : 'bjd-section"');
    }

    function stagePanelHtml(day, stageKey) {
        var st = STAGES.filter(function (s) { return s.key === stageKey; })[0];
        var e = day.stages[stageKey];
        var editing = state.editing === 'stage' && state.stageEditing;
        var lock = stageLockReason(stageKey, day);
        var h = '<div class="bjd-stage-panel mt-3" id="bjdStagePanel" data-stage="' + stageKey + '">';
        h += '<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2"><h4 class="h6 mb-0">' + esc(st.label) + ' · Day ' + day.num + (day.date ? ' (' + esc(dateText(day.date)) + ')' : '') + '</h4><div class="d-flex flex-wrap gap-2">';
        if (editing) {
            h += '<button type="button" class="btn btn-outline-secondary btn-sm bjd-touch" data-bjd-act="cancel"' + (state.saving ? ' disabled' : '') + '>Cancel</button>' +
                '<button type="button" class="btn btn-primary btn-sm bjd-touch" data-bjd-act="save" data-section="stage"' + (state.saving ? ' disabled' : '') + '>' + (state.saving ? '<i class="fas fa-spinner fa-spin me-1"></i>Saving…' : 'Save ' + esc(st.label.toLowerCase())) + '</button>';
        } else {
            h += '<button type="button" class="btn btn-outline-secondary btn-sm bjd-touch" data-bjd-act="stage-close">Close</button>';
        }
        h += '</div></div>';
        if (lock && !editing) h += '<p class="small text-muted mb-2"><i class="fas fa-lock me-1"></i>' + esc(lock) + (stageKey === 'cracking' || !day.date ? ' <button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-bjd-act="open-production">Open Kernel Production</button>' : '') + '</p>';
        if (editing) {
            h += stageEditorHtml(stageKey, e || {}, day);
        } else {
            h += '<div class="table-responsive bjd-table-box">' + renderBatchHistoryProductionSchemaTable(stageSchema(stageKey, e), e || {}, '—') + '</div>';
        }
        return h + '</div>';
    }

    function stageEditorHtml(stageKey, e, day) {
        var schema = stageSchema(stageKey, e);
        var calc = STAGE_CALC_KEYS[stageKey] || [];
        var factorKg = {};
        (CRATE_KG_PAIRS[stageKey] || []).forEach(function (p) { if (state.crateKg[p.key]) factorKg[p.kg] = state.crateKg[p.key]; });
        var h = '<div class="row g-2 bjd-stage-form">';
        schema.forEach(function (spec) {
            var id = 'bjdStage_' + spec.key;
            var v = e[spec.key];
            var label = esc(spec.label);
            if (spec.key === 'date') {
                h += '<div class="col-12 col-sm-6 col-xl-4"><label class="form-label small mb-1">' + label + '</label><input type="text" class="form-control" value="' + esc(dateText(day.date)) + '" readonly></div>';
                return;
            }
            if (spec.type === 'signature') {
                var sig = hasText(v) ? (String(v).indexOf('data:image') === 0 ? 'On file' : String(v)) : 'Not signed';
                h += '<div class="col-12 col-sm-6 col-xl-4"><label class="form-label small mb-1">' + label + '</label><input type="text" class="form-control" value="' + esc(sig) + '" readonly><div class="form-text">Signed on Kernel Production.</div></div>';
                return;
            }
            if (spec.type === 'bool') {
                var yes = isTrue(v);
                h += '<div class="col-12 col-sm-6 col-xl-4"><label class="form-label small mb-1" for="' + id + '">' + label + '</label>' +
                    '<select class="form-select" id="' + id + '" data-stage-key="' + spec.key + '" data-stage-type="bool"><option value="false"' + (yes ? '' : ' selected') + '>No</option><option value="true"' + (yes ? ' selected' : '') + '>Yes</option></select></div>';
                return;
            }
            var isKg = !!(spec.unit && /^kg$/.test(spec.unit));
            var readonly = calc.indexOf(spec.key) >= 0 || !!factorKg[spec.key];
            var shown = v == null || v === '' ? '' : (isKg && kgNum(v) != null ? _common.formatKg(kgNum(v)) : String(v));
            var hint = calc.indexOf(spec.key) >= 0 ? 'Calculated' : (factorKg[spec.key] ? 'Crates × ' + _common.formatKg(factorKg[spec.key]) + ' kg' : '');
            h += '<div class="col-12 col-sm-6 col-xl-4"><label class="form-label small mb-1" for="' + id + '">' + label + '</label>' +
                '<input type="text" class="form-control' + (isKg ? ' text-end js-kg-input' : '') + '"' + (isKg || /crates|cartons|_diff/.test(spec.key) ? ' inputmode="decimal"' : '') +
                ' id="' + id + '" data-stage-key="' + spec.key + '" data-stage-type="' + (isKg ? 'kg' : 'text') + '" value="' + esc(shown) + '"' + (readonly ? ' readonly tabindex="-1"' : '') + '>' +
                (hint ? '<div class="form-text">' + esc(hint) + '</div>' : '') + '</div>';
        });
        h += '</div><p class="small text-muted mt-2 mb-0">Saves this stage for this day only, through the same save Kernel Production uses. Calculated boxes follow Kernel Production\'s rules.</p>';
        return h;
    }

    function stageVal(key) {
        var el = document.getElementById('bjdStage_' + key);
        return el ? el.value : '';
    }

    function stageNum(key) {
        return _common.parseKg(stageVal(key));
    }

    function setStageVal(key, v) {
        var el = document.getElementById('bjdStage_' + key);
        if (el) el.value = v;
    }

    function kg2(n) {
        return (typeof n === 'number' && isFinite(n)) ? _common.formatKg(n) : '';
    }

    /** Re-run Kernel Production's calculated boxes for the open stage. fromLoad keeps stored kg (as the sheet does on open). */
    function recalcStage(stageKey, fromLoad) {
        (CRATE_KG_PAIRS[stageKey] || []).forEach(function (pair) {
            var factor = state.crateKg[pair.key];
            if (!factor) return;
            if (fromLoad && stageVal(pair.kg) !== '') return;
            var crates = numOrNull(stageVal(pair.crates));
            setStageVal(pair.kg, crates == null ? '' : kg2(crates * factor));
        });
        if (stageKey === 'washing') {
            var floater = stageNum('floater_crates') || 0;
            var sinker = stageNum('sinker_crates') || 0;
            var totalOutC = floater + sinker;
            var cratesIn = stageNum('crates_in') || 0;
            var anyCrates = stageNum('crates_in') != null || stageNum('floater_crates') != null || stageNum('sinker_crates') != null;
            setStageVal('total_crates', totalOutC || '');
            setStageVal('crate_diff', anyCrates ? String(+(cratesIn - totalOutC).toFixed(2)) : '');
            var fKg = stageNum('floater_qty');
            var sKg = stageNum('sinker_qty');
            var outKg = (fKg || 0) + (sKg || 0);
            if (fKg != null || sKg != null) setStageVal('total_qty', kg2(outKg));
            else if (!fromLoad) setStageVal('total_qty', '');
            var qtyIn = stageNum('qty_in');
            if (qtyIn != null || fKg != null || sKg != null) setStageVal('qty_diff', kg2((qtyIn || 0) - outKg));
            else if (!fromLoad) setStageVal('qty_diff', '');
            var waste = (stageNum('waste_shellfines') || 0) + (stageNum('waste_compost') || 0);
            setStageVal('waste_total', waste === 0 ? '' : _common.formatKg(waste));
        } else if (stageKey === 'sorting') {
            var sum = { sk: { c: 0, q: 0 }, bt: { c: 0, q: 0 } };
            Object.keys(SORT_GROUPS).forEach(function (g) {
                SORT_GROUPS[g].forEach(function (k) {
                    sum[g].c += parseFloat(stageVal(k + '_crates')) || 0;
                    sum[g].q += stageNum(k + '_qty') || 0;
                });
            });
            setStageVal('sound_crates', sum.sk.c || '');
            setStageVal('sound_qty', sum.sk.q ? _common.formatKg(sum.sk.q) : '');
            setStageVal('butter_crates', sum.bt.c || '');
            setStageVal('butter_qty', sum.bt.q ? _common.formatKg(sum.bt.q) : '');
        } else if (stageKey === 'packing') {
            var tot = { sk: 0, bt: 0 };
            Object.keys(PACK_GROUPS).forEach(function (g) {
                PACK_GROUPS[g].forEach(function (k) {
                    var cartons = parseFloat(stageVal(k + '_cartons')) || 0;
                    setStageVal(k + '_qty', cartons ? _common.formatKg(cartons * KG_PER_CARTON) : '');
                    tot[g] += cartons;
                });
            });
            var grand = tot.sk + tot.bt;
            setStageVal('sk_total_cartons', tot.sk || '');
            setStageVal('sk_total_qty', tot.sk ? _common.formatKg(tot.sk * KG_PER_CARTON) : '');
            setStageVal('bt_total_cartons', tot.bt || '');
            setStageVal('bt_total_qty', tot.bt ? _common.formatKg(tot.bt * KG_PER_CARTON) : '');
            setStageVal('totals_cartons', grand || '');
            setStageVal('totals_qty', grand ? _common.formatKg(grand * KG_PER_CARTON) : '');
        }
    }

    // ------------------------------------------------------------------ Job card

    function jobCardSectionHtml() {
        var approved = isJobcardApproved();
        var has = jobCardHasContent();
        var badge = has
            ? (approved ? '<span class="badge rounded-pill text-bg-light border">Approved</span>' : '<span class="badge rounded-pill text-bg-light border">Draft — not approved</span>')
            : '';
        var body;
        if (state.editing === 'jobcard') body = jobCardEditHtml();
        else if (!has) body = '<p class="text-muted mb-0">Not started. Kernel Production fills the job card in when production is finished; it can be edited here after that.</p>';
        else body = jobCardViewHtml();
        return sectionHtml('jobcard', {
            body: body,
            badge: badge,
            headerButtons: has ? editButton('jobcard') : '',
            saveLabel: 'job card draft'
        });
    }

    function jcStyles(group) {
        return arr(jcVal(group === 'sound' ? 'sound_kernel_styles' : 'butter_grade_styles'));
    }

    function jobCardViewHtml() {
        var pre = jcVal('removed_pre_sizer_kg');
        if (pre == null) pre = intake().removed_pre_sizer_kg;
        var pct = function (v) { var n = numOrNull(v); return n == null ? '—' : esc(String(n)) + '%'; };
        var h = '<div class="bjd-card-grid">';
        h += '<div><h4 class="bjd-subhead mt-0">Receiving</h4><div>Total ' + esc(kgText(jcVal('total_weight_kg'))) + '</div><div>Pre-sizer ' + esc(kgText(pre)) + '</div><div>Balance ' + esc(kgText(jcVal('balance_kg'))) + '</div></div>';
        h += '<div><h4 class="bjd-subhead mt-0">Moisture</h4><div>Receiving ' + pct(jcVal('receiving_moisture_percentage')) + '</div><div>Packing ' + pct(jcVal('packing_moisture_percentage')) + '</div><div>Removed ' + pct(jcVal('removed_moisture_percentage')) + '</div></div>';
        h += '<div><h4 class="bjd-subhead mt-0">Packing</h4><div>Start ' + esc(dateText(jcVal('packing_start_date'))) + '</div><div>Completed ' + esc(dateText(jcVal('packing_completion_date'))) + '</div><div>Best before ' + esc(dateText(jcVal('best_before_date'))) + '</div></div>';
        h += '<div><h4 class="bjd-subhead mt-0">Packed</h4><div>Sound ' + esc(hasText(jcVal('sound_kernel_total_cartons')) ? String(jcVal('sound_kernel_total_cartons')) : '0') + ' cartons · ' + esc(kgText(jcVal('sound_kernel_total_kg'), '0.00 kg')) + '</div>' +
            '<div>Butter ' + esc(hasText(jcVal('butter_grade_total_cartons')) ? String(jcVal('butter_grade_total_cartons')) : '0') + ' cartons · ' + esc(kgText(jcVal('butter_grade_total_kg'), '0.00 kg')) + '</div></div>';
        h += '<div><h4 class="bjd-subhead mt-0">Waste &amp; mass balance</h4><div>Shell ' + esc(kgText(jcVal('waste_shell_kg'))) + ' · Shell fines ' + esc(kgText(jcVal('waste_shell_fines_kg'))) + '</div>' +
            '<div>Oil kernel ' + esc(kgText(jcVal('waste_oil_kernel_kg'))) + ' · Compost ' + esc(kgText(jcVal('waste_compost_kg'))) + '</div>' +
            '<div>Mass balance ' + pct(jcVal('mass_balance_percentage')) + '</div></div>';
        h += '</div>';
        ['sound', 'butter'].forEach(function (g) {
            var rows = jcStyles(g);
            if (!rows.length) return;
            h += '<h4 class="bjd-subhead">' + (g === 'sound' ? 'Sound kernel' : 'Butter grade') + ' styles</h4><div class="table-responsive bjd-table-box"><table class="table align-middle mb-0"><thead><tr><th>Style</th><th class="text-end">Cartons</th><th class="text-end">Weight (kg)</th></tr></thead><tbody>';
            rows.forEach(function (r) {
                h += '<tr><td>' + esc(r && r.style) + '</td><td class="text-end">' + esc(r && r.cartons) + '</td><td class="text-end">' + esc(_common.formatKg(kgNum(r && r.weight_kg))) + '</td></tr>';
            });
            h += '</tbody></table></div>';
        });
        return h;
    }

    function jcField(id, label, value, opts) {
        opts = opts || {};
        var input;
        if (opts.type === 'date') {
            input = '<input type="date" class="form-control" id="' + id + '" value="' + esc(isoDate(value)) + '"' + (opts.readonly ? ' readonly' : '') + '>';
        } else if (opts.type === 'kg') {
            input = '<input type="text" inputmode="decimal" class="form-control text-end js-kg-input" id="' + id + '" value="' + esc(kgNum(value) == null ? '' : _common.formatKg(kgNum(value))) + '"' + (opts.readonly ? ' readonly tabindex="-1"' : '') + '>';
        } else if (opts.type === 'number') {
            input = '<input type="number" step="0.01" class="form-control" id="' + id + '" value="' + esc(numOrNull(value) == null ? '' : String(numOrNull(value))) + '"' + (opts.readonly ? ' readonly tabindex="-1"' : '') + '>';
        } else {
            input = '<input type="text" class="form-control" id="' + id + '" value="' + esc(value == null ? '' : String(value)) + '"' + (opts.readonly ? ' readonly tabindex="-1"' : '') + '>';
        }
        return '<div class="col-12 col-sm-6 col-xl-4"><label class="form-label small mb-1" for="' + id + '">' + esc(label) + '</label>' + input +
            (opts.hint ? '<div class="form-text">' + esc(opts.hint) + '</div>' : '') + '</div>';
    }

    function jcStyleRowHtml(group, r) {
        r = r || {};
        var opts = '<option value="">Select style</option>';
        var styles = JC_STYLES[group].slice();
        if (hasText(r.style) && styles.indexOf(String(r.style)) < 0) styles.push(String(r.style));
        styles.forEach(function (s) {
            opts += '<option value="' + esc(s) + '"' + (String(r.style) === s ? ' selected' : '') + '>' + esc(s) + '</option>';
        });
        return '<tr class="bjd-jc-row" data-group="' + group + '">' +
            '<td><select class="form-select form-select-sm" data-jc="style" aria-label="Style">' + opts + '</select></td>' +
            '<td><input type="number" min="0" step="1" class="form-control form-control-sm text-end" data-jc="cartons" aria-label="Cartons" value="' + esc(r.cartons != null ? String(r.cartons) : '') + '"></td>' +
            '<td><input type="text" inputmode="decimal" class="form-control form-control-sm text-end js-kg-input" data-jc="weight_kg" aria-label="Weight kg" value="' + esc(kgNum(r.weight_kg) == null ? '' : _common.formatKg(kgNum(r.weight_kg))) + '"></td>' +
            '<td class="text-center"><button type="button" class="btn btn-outline-danger btn-sm bjd-touch" data-bjd-act="jc-remove-row" aria-label="Remove row"><i class="fas fa-times"></i></button></td></tr>';
    }

    function jobCardEditHtml() {
        var pre = jcVal('removed_pre_sizer_kg');
        if (pre == null) pre = intake().removed_pre_sizer_kg;
        var h = '';
        if (isJobcardApproved()) {
            h += '<div class="alert alert-warning small">This job card is approved. Saving updates the batch\'s stock by style straight away.</div>';
        }
        h += '<div class="row g-2">';
        h += jcField('bjdJc_batch_number', 'Batch number', jcVal('batch_number') || (state.detail || {}).batch_number);
        h += jcField('bjdJc_received_date', 'Received date', jcVal('received_date') || (state.detail || {}).received_date, { type: 'date' });
        h += jcField('bjdJc_supplier', 'Supplier', jcVal('supplier_name') || (state.row || {}).grower_name || (state.detail || {}).grower_name, { readonly: true, hint: 'Change the grower under Batch details.' });
        h += '</div><h4 class="bjd-subhead">Receiving</h4><div class="row g-2">';
        h += jcField('bjdJc_total_weight_kg', 'Total weight (kg)', jcVal('total_weight_kg'), { type: 'kg' });
        h += jcField('bjdJc_removed_pre_sizer_kg', 'Removed pre-sizer (kg)', pre, { type: 'kg' });
        h += jcField('bjdJc_balance_kg', 'Balance (kg)', jcVal('balance_kg'), { type: 'kg', readonly: true, hint: 'Total weight − pre-sizer' });
        h += '</div><h4 class="bjd-subhead">Moisture</h4><div class="row g-2">';
        h += jcField('bjdJc_receiving_moisture_percentage', 'Receiving (%)', jcVal('receiving_moisture_percentage'), { type: 'number' });
        h += jcField('bjdJc_packing_moisture_percentage', 'Packing (%)', jcVal('packing_moisture_percentage'), { type: 'number' });
        h += jcField('bjdJc_removed_moisture_percentage', 'Removed (%)', jcVal('removed_moisture_percentage'), { type: 'number', readonly: true, hint: 'Receiving − packing' });
        h += '</div><h4 class="bjd-subhead">Packing</h4><div class="row g-2">';
        h += jcField('bjdJc_packing_start_date', 'Start date', jcVal('packing_start_date'), { type: 'date' });
        h += jcField('bjdJc_packing_completion_date', 'Completion date', jcVal('packing_completion_date'), { type: 'date' });
        h += jcField('bjdJc_best_before_date', 'Best before', jcVal('best_before_date'), { type: 'date', readonly: true, hint: 'Follows the start date (shelf life from Settings)' });
        h += '</div>';
        ['sound', 'butter'].forEach(function (g) {
            h += '<h4 class="bjd-subhead">' + (g === 'sound' ? 'Sound kernel' : 'Butter grade') + '</h4>';
            h += '<div class="table-responsive bjd-table-box"><table class="table align-middle mb-0"><thead><tr><th>Style</th><th class="text-end">Cartons</th><th class="text-end">Weight (kg)</th><th class="bjd-col-btn"><span class="visually-hidden">Remove</span></th></tr></thead><tbody id="bjdJcBody_' + g + '">';
            var rows = jcStyles(g);
            if (!rows.length) rows = [{}];
            rows.forEach(function (r) { h += jcStyleRowHtml(g, r); });
            h += '</tbody><tfoot><tr class="fw-semibold"><td>Total</td><td class="text-end" id="bjdJcTotC_' + g + '"></td><td class="text-end" id="bjdJcTotKg_' + g + '"></td><td></td></tr></tfoot></table></div>';
            h += '<button type="button" class="btn btn-outline-secondary btn-sm mt-2 bjd-touch" data-bjd-act="jc-add-row" data-group="' + g + '"><i class="fas fa-plus me-1"></i>Add style</button>';
        });
        h += '<h4 class="bjd-subhead">Waste</h4><div class="row g-2">';
        h += jcField('bjdJc_waste_oil_kernel_kg', 'Oil kernel (kg)', jcVal('waste_oil_kernel_kg'), { type: 'kg' });
        h += jcField('bjdJc_waste_shell_fines_kg', 'Shell fines (kg)', jcVal('waste_shell_fines_kg'), { type: 'kg' });
        h += jcField('bjdJc_waste_compost_kg', 'Compost (kg)', jcVal('waste_compost_kg'), { type: 'kg' });
        h += jcField('bjdJc_waste_shell_kg', 'Shell (kg)', jcVal('waste_shell_kg'), { type: 'kg' });
        h += '</div><h4 class="bjd-subhead">Mass balance</h4><div class="row g-2">';
        h += jcField('bjdJc_mass_balance_in_kg', 'In (kg)', jcVal('mass_balance_in_kg'), { type: 'kg', readonly: true });
        h += jcField('bjdJc_mass_balance_out_kg', 'Out (kg)', jcVal('mass_balance_out_kg'), { type: 'kg', readonly: true });
        h += jcField('bjdJc_mass_balance_percentage', 'Mass balance (%)', jcVal('mass_balance_percentage'), { type: 'number', readonly: true });
        h += '</div><p class="small text-muted mt-2 mb-0">Saves a draft only. Approve the job card on Kernel Production.</p>';
        return h;
    }

    function jcKg(id) { return _common.parseKg($('#' + id).val()) || 0; }

    /** Live totals, balance, removed moisture and mass balance (modal_kernel_job_card.js calculate* functions). */
    function recalcJobCard() {
        var totals = {};
        ['sound', 'butter'].forEach(function (g) {
            var c = 0, kg = 0;
            $('#bjdJcBody_' + g + ' tr').each(function () {
                c += parseInt($(this).find('[data-jc="cartons"]').val(), 10) || 0;
                kg += _common.parseKg($(this).find('[data-jc="weight_kg"]').val()) || 0;
            });
            totals[g] = { c: c, kg: kg };
            $('#bjdJcTotC_' + g).text(c);
            $('#bjdJcTotKg_' + g).text(_common.formatKg(kg));
        });
        var balance = jcKg('bjdJc_total_weight_kg') - jcKg('bjdJc_removed_pre_sizer_kg');
        $('#bjdJc_balance_kg').val(_common.formatKg(balance));
        var r = parseFloat($('#bjdJc_receiving_moisture_percentage').val()) || 0;
        var p = parseFloat($('#bjdJc_packing_moisture_percentage').val()) || 0;
        $('#bjdJc_removed_moisture_percentage').val((r - p).toFixed(2));
        var out = totals.sound.kg + totals.butter.kg + jcKg('bjdJc_waste_oil_kernel_kg') + jcKg('bjdJc_waste_shell_fines_kg') +
            jcKg('bjdJc_waste_compost_kg') + jcKg('bjdJc_waste_shell_kg');
        $('#bjdJc_mass_balance_in_kg').val(_common.formatKg(balance));
        $('#bjdJc_mass_balance_out_kg').val(_common.formatKg(out));
        $('#bjdJc_mass_balance_percentage').val(balance > 0 ? ((out / balance) * 100).toFixed(2) : '0');
        return totals;
    }

    /**
     * Best before follows the packing start: kept as stored while the start is the one it was saved with,
     * otherwise start + the configured shelf life (modal_kernel_job_card.js bestBeforeFromPackingStartISO).
     */
    function syncJobCardBestBefore() {
        var start = $('#bjdJc_packing_start_date').val();
        if (!start) return;
        var storedStart = isoDate(jcVal('packing_start_date'));
        var storedBb = isoDate(jcVal('best_before_date'));
        var bb = (storedBb && start === storedStart) ? storedBb
            : (typeof _common.kernelBestBeforeFromPackingStart === 'function' ? _common.kernelBestBeforeFromPackingStart(start) : null);
        if (bb) $('#bjdJc_best_before_date').val(bb);
    }

    // ------------------------------------------------------------------ End sample (QA)

    function qaSectionHtml() {
        var recorded = qaRecorded();
        var finished = !!(state.detail && state.detail.production_finished_at);
        var body;
        if (state.editing === 'qa') body = qaEditHtml();
        else if (recorded) body = qaViewHtml();
        else if (finished) body = '<p class="text-muted mb-0">No results yet.</p>';
        else body = '<p class="text-muted mb-0">Not done yet — opens once production is finished.</p>';
        return sectionHtml('qa', {
            body: body,
            headerButtons: recorded ? editButton('qa') : (finished ? editButton('qa', 'Add results') : ''),
            saveLabel: 'end sample'
        });
    }

    function qaViewHtml() {
        var qa = qaData();
        var h = '<div class="table-responsive bjd-table-box"><table class="table align-middle mb-0"><thead><tr><th>Test</th><th class="text-center">Required</th><th>Result</th></tr></thead><tbody>';
        QA_TESTS.forEach(function (t) {
            var req = qa[t.key + '_required'];
            h += '<tr><td>' + esc(t.label) + '</td><td class="text-center">' + (isTrue(req) ? '<i class="fas fa-check" aria-label="Required"></i>' : (isFalse(req) ? 'No' : '—')) + '</td><td>' + (hasText(qa[t.key + '_result']) ? esc(String(qa[t.key + '_result'])) : '—') + '</td></tr>';
        });
        h += '</tbody></table></div><dl class="bjd-dl mt-3 mb-0">';
        h += dlItem('Completed', esc(dateText(qa.completed_at)));
        h += dlItem('Signed (Supervisor)', hasText(qa.supervisor_signed_by) ? esc(qa.supervisor_signed_by) : '—');
        h += dlItem('Signed (Nut Plant Manager)', hasText(qa.nut_plant_manager_signed_by) ? esc(qa.nut_plant_manager_signed_by) : '—');
        if (/^https?:\/\//i.test(String(qa.lab_test_pdf_url || ''))) {
            h += dlItem('Lab test PDF', '<a href="' + esc(qa.lab_test_pdf_url) + '" target="_blank" rel="noopener noreferrer"><i class="fas fa-file-pdf me-1"></i>Open</a>');
        }
        return h + '</dl>';
    }

    function qaEditHtml() {
        var qa = qaData();
        var h = '<div class="table-responsive bjd-table-box"><table class="table align-middle mb-0"><thead><tr><th>Test</th><th class="text-center">Required</th><th>Result</th></tr></thead><tbody>';
        QA_TESTS.forEach(function (t) {
            var v = qa[t.key + '_result'];
            h += '<tr><td>' + esc(t.label) + '</td><td class="text-center"><input type="checkbox" class="form-check-input bjd-check-input" id="bjdQa_' + t.key + '_required"' + (isTrue(qa[t.key + '_required']) ? ' checked' : '') + ' aria-label="' + esc(t.label) + ' required"></td><td>' +
                (t.numeric ? numInput('bjdQa_' + t.key + '_result', v, { sm: true, label: t.label + ' result' })
                    : '<input type="text" class="form-control form-control-sm" id="bjdQa_' + t.key + '_result" aria-label="' + esc(t.label) + ' result" value="' + esc(v == null ? '' : String(v)) + '">') +
                '</td></tr>';
        });
        h += '</tbody></table></div><div class="row g-2 mt-1">';
        h += '<div class="col-12 col-md-6"><label class="form-label small mb-1" for="bjdQa_supervisor_signed_by">Signed (Supervisor)</label><input type="text" class="form-control" id="bjdQa_supervisor_signed_by" value="' + esc(qa.supervisor_signed_by || '') + '"></div>';
        h += '<div class="col-12 col-md-6"><label class="form-label small mb-1" for="bjdQa_nut_plant_manager_signed_by">Signed (Nut Plant Manager)</label><input type="text" class="form-control" id="bjdQa_nut_plant_manager_signed_by" value="' + esc(qa.nut_plant_manager_signed_by || '') + '"></div>';
        h += '</div><p class="small text-muted mt-2 mb-0">The lab test PDF and anything else already stored on the end sample are kept. Upload a PDF on Kernel Production.</p>';
        return h;
    }

    // ------------------------------------------------------------------ Dispatch

    function dispatchSectionHtml() {
        var body = (typeof buildBatchHistoryDispatchPanelHtml === 'function')
            ? buildBatchHistoryDispatchPanelHtml(state.detail)
            : '<p class="text-muted mb-0">Dispatch details are not available.</p>';
        body += '<p class="small text-muted mt-2 mb-0">Orders are edited on Kernel Dispatch because one order can hold several batches.</p>';
        return sectionHtml('dispatch', {
            body: '<div class="bjd-dispatch">' + body + '</div>',
            headerButtons: '<button type="button" class="btn btn-link btn-sm bjd-touch" data-bjd-act="open-dispatch">Open Kernel Dispatch</button>'
        });
    }

    // ------------------------------------------------------------------ after render wiring

    function afterRender() {
        if (state.editing === 'details' && typeof KernelBatchEdit !== 'undefined' && KernelBatchEdit.bindBatchNumberSuggestion) {
            KernelBatchEdit.bindBatchNumberSuggestion(batchForForm(), BATCH_FORM_PREFIX);
        }
        if (state.editing === 'receiving') updateItemsTotal();
        if (state.editing === 'jobcard') recalcJobCard();
        if (state.editing === 'stage' && state.openStage) recalcStage(state.openStage, true);
    }

    function scrollToSection(key) {
        var el = document.getElementById('bjd-sec-' + key);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ------------------------------------------------------------------ loading

    function ensureDeps() {
        var hooks = state.hooks;
        var v = typeof _appRouterWithVersion === 'function' ? _appRouterWithVersion : function (u) { return u; };
        function need(globalPath, src) {
            return new Promise(function (resolve) {
                if (!hooks || !hooks.withEditDialog) { resolve(); return; }
                // Never hang the page on a script that already finished loading without the member we
                // wanted (withEditDialog would wait for a 'load' event that has already fired).
                setTimeout(resolve, 8000);
                hooks.withEditDialog(globalPath, v(src), resolve, resolve);
            });
        }
        return Promise.all([
            // The edit form pieces arrived with this page; a tab opened before the deploy still has the
            // older kernel-batch-edit.js (dialog only), so fetch the current one if they are missing.
            need('KernelBatchEdit.collectForm', 'js/kernel-batch-edit.js'),
            need('buildBatchHistoryDispatchPanelHtml', 'modules/modals/modal-batch-history/js/modal_batch_history.js'),
            // Shelf life (best before) and crate kg factors, both from Kernel Pipeline Settings. null on failure.
            (typeof _common !== 'undefined' && _common.loadKernelPipelineConfig) ? _common.loadKernelPipelineConfig().then(function (cfg) {
                var map = {};
                if (cfg && Array.isArray(cfg.crate_weights)) {
                    cfg.crate_weights.forEach(function (cw) {
                        var kg = cw && cw.kg_per_crate != null ? parseFloat(cw.kg_per_crate) : NaN;
                        if (isFinite(kg) && kg > 0) map[cw.stage + '.' + cw.crate_type] = kg;
                    });
                }
                state.crateKg = map;
            }) : Promise.resolve()
        ]);
    }

    function loadDetail() {
        var d = df();
        var id = state.kernelId;
        var seq = ++state.loadSeq;
        if (!d || !d.getKernelProductionHistory || !historyHelpersReady()) {
            state.error = 'Cannot load this batch. Refresh the page and try again.';
            render();
            return Promise.resolve();
        }
        return d.getKernelProductionHistory(id, null, true).then(function (detail) {
            if (!detail) throw new Error('Batch not found. It may have been archived.');
            return typeof loadDispatchOrdersFallback === 'function' ? loadDispatchOrdersFallback(detail) : detail;
        }).then(function (detail) {
            if (seq !== state.loadSeq || id !== state.kernelId) return;
            state.detail = detail;
            state.error = null;
            if (state.hooks && state.hooks.getBatch) state.row = state.hooks.getBatch(id) || state.row;
            render();
        }).catch(function (err) {
            if (seq !== state.loadSeq || id !== state.kernelId) return;
            console.error('[Batch page] load failed', err);
            state.error = (err && err.message) ? err.message : 'Could not load this batch.';
            render();
        });
    }

    /** After a save: re-read the list row (flags, FFA, best before) and the batch, then re-render. */
    function reloadAll() {
        var list = state.hooks && state.hooks.reloadList ? Promise.resolve(state.hooks.reloadList()).catch(function () { /* list errors show in the list */ }) : Promise.resolve();
        return list.then(loadDetail);
    }

    // ------------------------------------------------------------------ saves

    function saveDetails() {
        var d = df();
        if (!d || !d.updateKernelStockBatchInfo || typeof KernelBatchEdit === 'undefined') throw new Error('Save is not available. Refresh the page and try again.');
        var res = KernelBatchEdit.collectForm(batchForForm(), state.suppliers || null, BATCH_FORM_PREFIX);
        if (res.error) throw new Error(res.error);
        return d.updateKernelStockBatchInfo(state.kernelId, res.value).then(function (r) {
            assertOk(r, 'update_kernel_stock_batch_info');
            return 'Batch details saved.';
        });
    }

    function saveReceiving() {
        var d = df();
        if (!d || !d.upsertKernelChecklist) throw new Error('Save is not available. Refresh the page and try again.');
        var cl = checklist();
        var dlv = delivery();
        var tr = dlv && dlv.transport && typeof dlv.transport === 'object' ? dlv.transport : {};
        var pre = preSizerInfo();
        var missing = [];

        // Every value the checklist already holds is sent back unless the user changed it here; the RPC
        // merges (20261006090100), but sending them keeps this save independent of that detail.
        var req = {
            kernel_id: state.kernelId,
            date_received: $('#bjdRcvDate').val() || cl.date_received || null,
            delivery_note_ref: hasText(tr.delivery_note_ref) ? (cl.delivery_note_ref || null) : ($.trim($('#bjdRcvNote').val()) || cl.delivery_note_ref || null),
            supplier_id: cl.supplier_id || null,
            comments: $('#bjdRcvComments').val(),
            item_comments: {},
            item_photos: {}
        };
        var photos = obj(cl.item_photos);
        CHECKS.forEach(function (c) {
            var ans = $('#bjdChk_' + c.key).val() || '';
            // Every check answered, as the Grower Intake checklist demands: a stored checklist is what
            // marks the batch as checked (get_kernel_batches has_receiving_checklist).
            if (!ans) missing.push('Answer "' + c.q + '"');
            req[c.key] = ans || cl[c.key] || null;
            var bad = ans && ans.toLowerCase() === c.bad.toLowerCase();
            if (bad) {
                var cmt = $.trim($('#bjdChkCmt_' + c.key).val() || '');
                if (!cmt) missing.push('Add a comment for "' + c.q + '"');
                req.item_comments[c.key] = cmt;
                // Photos are not edited here; a problem answer keeps the photos it already has.
                req.item_photos[c.key] = Array.isArray(photos[c.key]) ? photos[c.key] : [];
            }
        });
        if (!pre.locked) {
            var preRaw = $.trim($('#bjdRcvPre').val() || '');
            if (preRaw !== '') {
                var preKg = _common.parseKg(preRaw);
                if (preKg == null || preKg < 0) missing.push('Removed pre-sizer must be 0 or more');
                else req.removed_pre_sizer_kg = preKg;
            } else if (pre.value != null && pre.value !== '') {
                req.removed_pre_sizer_kg = kgNum(pre.value);
            }
        }
        var bags = dlv && Array.isArray(dlv.bags) ? dlv.bags : [];
        if (!bags.length) {
            var items = [];
            $('#bjdItemsBody tr.bjd-item-row').each(function () {
                var $r = $(this);
                var desc = $.trim($r.find('[data-item="description"]').val() || '');
                var qtyRaw = $.trim($r.find('[data-item="quantity_kg"]').val() || '');
                var md = $r.find('[data-item="manufactured_date"]').val() || '';
                if (!desc && !qtyRaw && !md) return;
                var q = qtyRaw === '' ? null : _common.parseKg(qtyRaw);
                if (qtyRaw !== '' && (q == null || q < 0)) missing.push('Item quantities must be 0 or more');
                items.push({ description: desc, quantity_kg: q, manufactured_date: md || null });
            });
            if (!items.length && arr(cl.received_items).length) {
                missing.push('Keep at least one received item — the checklist save cannot remove every line');
            }
            if (items.length) req.received_items = items;
        }
        if (missing.length) throw new Error(missing.join('. ') + '.');
        return d.upsertKernelChecklist(req).then(function (r) {
            assertOk(r, 'upsert_kernel_checklist');
            return req.received_items ? 'Receiving saved. The weighed total now follows the received items.' : 'Receiving saved.';
        });
    }

    function readZiplock() {
        var out = { sample_type: 'ziplock' };
        ZIPLOCK_TESTS.forEach(function (t) {
            out[t.key + '_required'] = $('#bjdZl_' + t.key + '_required').is(':checked');
            out[t.key + '_result'] = numOrNull($('#bjdZl_' + t.key + '_result').val());
        });
        out.wet_nut_in_shell_kg = _common.parseKg($('#bjdZl_wet_nut_in_shell_kg').val());
        return out;
    }

    function storedZiplock() {
        var z = ziplock() || {};
        var out = { sample_type: 'ziplock' };
        ZIPLOCK_TESTS.forEach(function (t) {
            out[t.key + '_required'] = isTrue(z[t.key + '_required']);
            out[t.key + '_result'] = numOrNull(z[t.key + '_result']);
        });
        out.wet_nut_in_shell_kg = kgNum(z.wet_nut_in_shell_kg);
        return out;
    }

    function read5kg() {
        var out = { sample_type: '5kg' };
        ['crack_out_sound_kernel_g', 'crack_out_unsound_kernel_g', 'crack_out_shell_g', 'float_floating_g', 'float_sinking_g'].forEach(function (k) {
            out[k] = numOrNull($('#bjd5_' + k).val());
        });
        UNSOUND.forEach(function (u) { out['unsound_' + u.key] = numOrNull($('#bjd5_unsound_' + u.key).val()); });
        return out;
    }

    function stored5kg() {
        var f = fiveKg() || {};
        var co = obj(f.crack_out);
        var ft = obj(f.float_test);
        var un = obj(f.unsound);
        var out = {
            sample_type: '5kg',
            crack_out_sound_kernel_g: numOrNull(co.sound_kernel_g),
            crack_out_unsound_kernel_g: numOrNull(co.unsound_kernel_g),
            crack_out_shell_g: numOrNull(co.shell_g),
            float_floating_g: numOrNull(ft.floating_g),
            float_sinking_g: numOrNull(ft.sinking_g)
        };
        UNSOUND.forEach(function (u) { out['unsound_' + u.key] = numOrNull(un[u.key]); });
        return out;
    }

    function allNull(o, skip) {
        return Object.keys(o).every(function (k) { return skip.indexOf(k) >= 0 || o[k] == null || o[k] === false; });
    }

    function saveSamples() {
        var d = df();
        if (!d || !d.saveKernelIntakeSample) throw new Error('Save is not available. Refresh the page and try again.');
        var calls = [];
        var problems = [];
        var zNew = readZiplock();
        var zOld = storedZiplock();
        var zChanged = JSON.stringify(zNew) !== JSON.stringify(zOld) && !(allNull(zNew, ['sample_type']) && !ziplock());
        if (zChanged) {
            // Same checks as the Grower Intake sample dialog (modal_grower_link_sample_to_batch.js).
            if (!zNew.moisture_required && !zNew.peroxide_required && !zNew.ffa_required) problems.push('Tick at least one ziplock test');
            ZIPLOCK_TESTS.forEach(function (t) {
                if (zNew[t.key + '_required'] && zNew[t.key + '_result'] == null) problems.push('Enter the ' + t.label.toLowerCase() + ' result');
            });
            calls.push(Object.assign({ kernel_id: state.kernelId }, zNew));
        }
        var fNew = read5kg();
        var fOld = stored5kg();
        var fChanged = JSON.stringify(fNew) !== JSON.stringify(fOld) && !(allNull(fNew, ['sample_type']) && !fiveKg());
        if (fChanged) {
            var crack = (fNew.crack_out_sound_kernel_g || 0) + (fNew.crack_out_unsound_kernel_g || 0) + (fNew.crack_out_shell_g || 0);
            if (crack <= 0) problems.push('Enter at least one 5 kg crack-out weight');
            calls.push(Object.assign({ kernel_id: state.kernelId }, fNew));
        }
        if (problems.length) throw new Error(problems.join('. ') + '.');
        if (!calls.length) return Promise.resolve('Nothing changed.');
        // One after the other: both write kernel.intake_data.
        return calls.reduce(function (p, payload) {
            return p.then(function () {
                return d.saveKernelIntakeSample(payload).then(function (r) { assertOk(r, 'save_kernel_intake_sample'); });
            });
        }, Promise.resolve()).then(function () {
            return calls.length === 2 ? 'Both samples saved.' : (calls[0].sample_type === 'ziplock' ? 'Ziplock sample saved.' : '5 kg sample saved.');
        });
    }

    function saveStage() {
        var d = df();
        if (!d || !d.upsertKernelProduction) throw new Error('Save is not available. Refresh the page and try again.');
        var days = productionDays();
        var day = days.filter(function (x) { return x.key === state.dayKey; })[0];
        var stageKey = state.openStage;
        var lock = stageLockReason(stageKey, day);
        if (lock) throw new Error(lock);
        recalcStage(stageKey, false);
        var entry = Object.assign({}, day.stages[stageKey] || {});
        $('#bjdStagePanel [data-stage-key]').each(function () {
            var key = this.getAttribute('data-stage-key');
            var type = this.getAttribute('data-stage-type');
            if (type === 'bool') entry[key] = this.value === 'true';
            else if (type === 'kg') { var n = _common.parseKg(this.value); entry[key] = n == null ? '' : String(n); }
            else entry[key] = this.value == null ? '' : String(this.value);
        });
        entry.date = day.date;
        // Kernel Production stores a few derived figures alongside (enrichProductionStageCalculations). When that
        // screen has been opened in this tab its function is available; otherwise they refresh on its next save.
        if (typeof enrichProductionStageCalculations === 'function') {
            var parts = { cracking: {}, washing: {}, sorting: {}, packing: {} };
            parts[stageKey] = entry;
            var enriched = enrichProductionStageCalculations(parts.cracking, parts.washing, parts.sorting, parts.packing, null);
            entry = enriched[stageKey + '_data'] || entry;
        }
        var meaningful = typeof batchHistoryStageEntryHasMeaningful === 'function' ? batchHistoryStageEntryHasMeaningful(entry) : true;
        var st = STAGES.filter(function (s) { return s.key === stageKey; })[0];
        var opts = {};
        opts[st.dataKey] = entry;
        var go = function () {
            return d.upsertKernelProduction(state.kernelId, opts).then(function (r) {
                assertOk(r, 'upsert_kernel_production');
                return meaningful ? st.label + ' saved for this day.' : st.label + ' cleared for this day.';
            });
        };
        if (meaningful) return go();
        return confirmBox('Clear ' + st.label.toLowerCase() + ' for this day?', 'Every box is empty, so saving removes this stage\'s entry for the day.', 'Clear it').then(function (ok) {
            if (!ok) return null;
            return go();
        });
    }

    function saveJobCard() {
        var d = df();
        if (!d || !d.upsertKernelJobCard) throw new Error('Save is not available. Refresh the page and try again.');
        var totals = recalcJobCard();
        var kg = function (id) { var n = _common.parseKg($('#' + id).val()); return n || null; };
        var nm = function (id) { var n = parseFloat($('#' + id).val()); return isFinite(n) && n ? n : null; };
        var dt = function (id) { return $('#' + id).val() || null; };
        var styles = { sound: [], butter: [] };
        var problems = [];
        ['sound', 'butter'].forEach(function (g) {
            $('#bjdJcBody_' + g + ' tr').each(function () {
                var style = $(this).find('[data-jc="style"]').val();
                var cartons = parseInt($(this).find('[data-jc="cartons"]').val(), 10) || 0;
                var weight = _common.parseKg($(this).find('[data-jc="weight_kg"]').val()) || 0;
                if (!style && (cartons > 0 || weight > 0)) problems.push('Pick a style for every line with cartons or kg');
                if (style && (cartons > 0 || weight > 0)) styles[g].push({ style: style, cartons: cartons, weight_kg: weight });
            });
        });
        var bn = $.trim($('#bjdJc_batch_number').val() || '');
        if (!bn) problems.push('Batch number is required');
        if (!dt('bjdJc_received_date')) problems.push('Received date is required');
        if (kg('bjdJc_total_weight_kg') == null) problems.push('Total weight is required');
        if (problems.length) throw new Error(problems.filter(function (p, i, a) { return a.indexOf(p) === i; }).join('. ') + '.');

        // Same keys the job card dialog writes (modal_kernel_job_card.js _buildJobCardPayload, p_ prefix dropped).
        var edited = {
            batch_number: bn,
            received_date: dt('bjdJc_received_date'),
            total_weight_kg: kg('bjdJc_total_weight_kg'),
            removed_pre_sizer_kg: kg('bjdJc_removed_pre_sizer_kg'),
            balance_kg: kg('bjdJc_balance_kg'),
            receiving_moisture_percentage: nm('bjdJc_receiving_moisture_percentage'),
            packing_moisture_percentage: nm('bjdJc_packing_moisture_percentage'),
            removed_moisture_percentage: nm('bjdJc_removed_moisture_percentage'),
            packing_start_date: dt('bjdJc_packing_start_date'),
            packing_completion_date: dt('bjdJc_packing_completion_date'),
            best_before_date: dt('bjdJc_best_before_date'),
            sound_kernel_styles: styles.sound.length ? styles.sound : null,
            sound_kernel_total_cartons: totals.sound.c,
            sound_kernel_total_kg: totals.sound.kg,
            butter_grade_styles: styles.butter.length ? styles.butter : null,
            butter_grade_total_cartons: totals.butter.c,
            butter_grade_total_kg: totals.butter.kg,
            waste_oil_kernel_kg: kg('bjdJc_waste_oil_kernel_kg'),
            waste_shell_fines_kg: kg('bjdJc_waste_shell_fines_kg'),
            waste_compost_kg: kg('bjdJc_waste_compost_kg'),
            waste_shell_kg: kg('bjdJc_waste_shell_kg'),
            mass_balance_in_kg: kg('bjdJc_mass_balance_in_kg'),
            mass_balance_out_kg: kg('bjdJc_mass_balance_out_kg'),
            mass_balance_percentage: nm('bjdJc_mass_balance_percentage')
        };
        // upsert_kernel_job_card REPLACES job_card_data, so start from what is stored (supplier, production
        // batch id, anything else) and lay the edits over it. Approval flags are stripped: this is a draft save.
        var payload = Object.assign({}, jobCard(), edited);
        delete payload.jobcard_approved;
        delete payload.submit_action;
        delete payload._submit_action;
        var approved = isJobcardApproved();
        var go = function () {
            return d.upsertKernelJobCard(state.kernelId, payload, null, { draft: true }).then(function (r) {
                var inner = assertOk(r, 'upsert_kernel_job_card');
                var synced = !!(inner && (inner.stock_synced === true || inner.StockSynced === true));
                return synced ? 'Job card saved and stock updated.' : 'Job card draft saved.';
            });
        };
        if (!approved) return go();
        return confirmBox('Update stock from this job card?',
            'This job card is already approved, so saving <strong>updates the batch\'s stock by style</strong> straight away (same as saving it on Kernel Production).',
            'Save and update stock').then(function (ok) { return ok ? go() : null; });
    }

    function saveQa() {
        var d = df();
        if (!d || !d.upsertKernelQa) throw new Error('Save is not available. Refresh the page and try again.');
        var existing = qaData();
        var wasRecorded = qaRecorded();
        var edited = {};
        QA_TESTS.forEach(function (t) {
            edited[t.key + '_required'] = $('#bjdQa_' + t.key + '_required').is(':checked');
            var raw = $.trim($('#bjdQa_' + t.key + '_result').val() || '');
            edited[t.key + '_result'] = raw === '' ? null : (t.numeric ? numOrNull(raw) : raw);
        });
        edited.supervisor_signed_by = $.trim($('#bjdQa_supervisor_signed_by').val() || '') || null;
        edited.nut_plant_manager_signed_by = $.trim($('#bjdQa_nut_plant_manager_signed_by').val() || '') || null;
        // upsert_kernel_qa replaces qa_data whole, so merge onto the stored object: lab_test_pdf_url,
        // completed_at and any flags written by other screens survive.
        var payload = Object.assign({}, existing, edited, { completed_at: existing.completed_at || new Date().toISOString() });
        return d.upsertKernelQa(state.kernelId, payload).then(function (r) {
            assertOk(r, 'upsert_kernel_qa');
            return wasRecorded ? 'End sample saved.' : 'End sample saved. The batch is now release ready.';
        });
    }

    function save(section) {
        if (state.saving) return;
        var run;
        try {
            if (section === 'details') run = saveDetails();
            else if (section === 'receiving') run = saveReceiving();
            else if (section === 'samples') run = saveSamples();
            else if (section === 'stage') run = saveStage();
            else if (section === 'jobcard') run = saveJobCard();
            else if (section === 'qa') run = saveQa();
            else return;
        } catch (err) {
            showError(err.message || 'Could not save');
            return;
        }
        // Never re-render while saving: that would rebuild the form from stored data and lose the edits
        // if the save fails. Only the buttons change until the save settles.
        setSavingUi(true);
        Promise.resolve(run).then(function (msg) {
            setSavingUi(false);
            if (msg == null) return;  // cancelled at a confirm; the form is untouched
            state.editing = null;
            state.stageEditing = false;
            toast('Saved', msg);
            return reloadAll();
        }).catch(function (err) {
            setSavingUi(false);
            console.error('[Batch page] save failed', err);
            showError((err && err.message) || 'Could not save');
        });
    }

    function setSavingUi(on) {
        state.saving = on;
        var $c = $('#' + CONTAINER_ID);
        $c.find('[data-bjd-act="cancel"]').prop('disabled', on);
        $c.find('[data-bjd-act="save"]').each(function () {
            var $b = $(this);
            if (on) {
                $b.data('bjdLabel', $b.html());
                $b.prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-1"></i>Saving…');
            } else {
                if ($b.data('bjdLabel') != null) $b.html($b.data('bjdLabel'));
                $b.prop('disabled', false);
            }
        });
    }

    // ------------------------------------------------------------------ edit mode switching

    function leaveEditIfAllowed() {
        if (!state.editing) return Promise.resolve(true);
        return confirmBox('Discard your changes?', 'You are editing <strong>' + esc(state.editing === 'stage' ? 'a production stage' : SECTION_LABELS[state.editing]) + '</strong>. Unsaved changes will be lost.', 'Discard').then(function (ok) {
            if (ok) { state.editing = null; state.stageEditing = false; }
            return ok;
        });
    }

    function startEdit(section) {
        if (state.editing === section) return;
        leaveEditIfAllowed().then(function (ok) {
            if (!ok) return;
            state.openStage = null;
            if (section === 'details') {
                // Grower list first (fresh, so a just-added grower appears); null on failure keeps the grower locked.
                var load = (state.suppliers === undefined && typeof KernelBatchEdit !== 'undefined' && KernelBatchEdit.loadSuppliers)
                    ? KernelBatchEdit.loadSuppliers().then(function (s) { state.suppliers = s; })
                    : Promise.resolve();
                load.then(function () { state.editing = 'details'; render(); scrollToSection('details'); });
                return;
            }
            state.editing = section;
            render();
            scrollToSection(section);
        });
    }

    function startStage(stageKey, edit) {
        leaveEditIfAllowed().then(function (ok) {
            if (!ok) return;
            state.openStage = stageKey;
            state.editing = edit ? 'stage' : null;
            state.stageEditing = !!edit;
            render();
            var p = document.getElementById('bjdStagePanel');
            if (p && p.scrollIntoView) p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    // ------------------------------------------------------------------ events

    function bind() {
        var $c = $('#' + CONTAINER_ID);
        if (!$c.length || $c.data('bjdBound')) return;
        $c.data('bjdBound', true);

        $c.on('click', '[data-bjd-act]', function (e) {
            e.preventDefault();
            var $t = $(this);
            var act = $t.attr('data-bjd-act');
            switch (act) {
                case 'back':
                    leaveEditIfAllowed().then(function (ok) { if (ok) close(); });
                    break;
                case 'nav':
                    scrollToSection($t.attr('data-section'));
                    break;
                case 'edit':
                    startEdit($t.attr('data-section'));
                    break;
                case 'cancel':
                    state.editing = null;
                    state.stageEditing = false;
                    render();
                    break;
                case 'save':
                    save($t.attr('data-section'));
                    break;
                case 'day':
                    state.dayKey = $t.attr('data-day');
                    state.openStage = null;
                    render();
                    break;
                case 'stage-view':
                    startStage($t.attr('data-stage'), false);
                    break;
                case 'stage-edit':
                    startStage($t.attr('data-stage'), true);
                    break;
                case 'stage-close':
                    state.openStage = null;
                    render();
                    break;
                case 'add-item':
                    $('#bjdItemsBody').append(itemRowHtml({}));
                    updateItemsTotal();
                    break;
                case 'remove-item':
                    $t.closest('tr').remove();
                    updateItemsTotal();
                    break;
                case 'jc-add-row':
                    $('#bjdJcBody_' + $t.attr('data-group')).append(jcStyleRowHtml($t.attr('data-group'), {}));
                    recalcJobCard();
                    break;
                case 'jc-remove-row':
                    $t.closest('tr').remove();
                    recalcJobCard();
                    break;
                case 'open-module':
                    leaveEditIfAllowed().then(function (ok) {
                        if (ok && state.hooks && state.hooks.openInModule) state.hooks.openInModule(state.row || state.detail);
                    });
                    break;
                case 'open-production':
                    leaveEditIfAllowed().then(function (ok) { if (ok) navigate('kernel-production-grid', 'searchBatchesInput'); });
                    break;
                case 'open-dispatch':
                    leaveEditIfAllowed().then(function (ok) { if (ok) navigate('kernel-dispatch-grid', null); });
                    break;
                case 'archive':
                    if (state.hooks && state.hooks.archive) {
                        state.hooks.archive(state.kernelId, (state.detail && state.detail.batch_number) || '', function () { close(); });
                    }
                    break;
            }
        });

        $c.on('change', '.bjd-check-select', function () {
            var key = $(this).attr('data-bjd-check');
            var c = CHECKS.filter(function (x) { return x.key === key; })[0];
            var bad = c && String(this.value).toLowerCase() === c.bad.toLowerCase();
            $('#bjdChkCmt_' + key).toggleClass('d-none', !bad);
        });
        $c.on('input', '#bjdItemsBody input[data-item="quantity_kg"]', updateItemsTotal);
        $c.on('input change', '#bjdStagePanel [data-stage-key]', function () {
            if (state.openStage) recalcStage(state.openStage, false);
        });
        $c.on('input change', '[id^="bjdJc_"], #bjdJcBody_sound input, #bjdJcBody_butter input', function () {
            if (this.id === 'bjdJc_packing_start_date') syncJobCardBestBefore();
            recalcJobCard();
        });
    }

    function navigate(route, searchInputId) {
        var label = (state.detail && state.detail.batch_number) || '';
        if (typeof HandoffDialog !== 'undefined' && HandoffDialog.navigateToRoute) {
            HandoffDialog.navigateToRoute(route, searchInputId ? label : '', searchInputId);
        } else if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
            _appRouter.routeTo(route);
        }
    }

    // ------------------------------------------------------------------ open / close

    function scrollHost() {
        return document.getElementById('content-area');
    }

    function open(kernelId, hooks) {
        if (!kernelId) return;
        var host = scrollHost();
        var keepScroll = { win: window.pageYOffset || 0, host: host ? host.scrollTop : 0 };
        state = freshState();
        state.kernelId = String(kernelId);
        state.hooks = hooks || {};
        state.scroll = keepScroll;
        state.row = state.hooks.getBatch ? state.hooks.getBatch(state.kernelId) : null;
        if (state.hooks.showList) state.hooks.showList(false);
        var el = container();
        if (el) el.classList.remove('d-none');
        bind();
        render();
        window.scrollTo(0, 0);
        if (host) host.scrollTop = 0;
        ensureDeps().then(loadDetail);
    }

    function close() {
        var el = container();
        var keep = state.scroll;
        var hooks = state.hooks;
        state = freshState();
        if (el) {
            el.classList.add('d-none');
            el.innerHTML = '';
        }
        if (hooks && hooks.showList) hooks.showList(true);
        if (keep) {
            var host = scrollHost();
            if (host) host.scrollTop = keep.host;
            window.scrollTo(0, keep.win);
        }
    }

    return {
        open: open,
        close: close,
        isOpen: function () { return !!state.kernelId; }
    };
})();
