/**
 * Management reports - the "All figures" tab (Kernel stream 1-5, Oil stream 1-5 for any period).
 *
 * Contract with the rest of the module:
 *   - reports_page.js calls _reportsAllFigures.show() the first time the tab is shown; the content goes
 *     into #reportsAllHost. init() / destroy() are also safe to call.
 *   - html/reports_all_figures.html holds the markup; this file fills it.
 *   - Data: dataFunctions.getReportsAllFigures(fromISO, toISO) -> one jsonb object
 *     { success, from, to, today, kernel:{...}, oil:{...} } (see get_reports_all_figures).
 *   - Shared helpers (period maths, tiles, charts, tables) come from MgmtDashboard
 *     (management-dashboard/js/mgmt_dashboard_common.js).
 *
 * Security invariant: every database value (grower, customer, supplier, style, notes) reaches the DOM
 * through textContent (MgmtDashboard.el / fillTable / tile) - never innerHTML. Colours come from the
 * --mac-* tokens (CSS and MgmtDashboard.colors()); this file holds no colour literals.
 * null in the data means "not available": shown as an em dash or a muted note, never as 0.
 * Events are namespaced ".raf" and removed by destroy() and at the start of init().
 */
var _reportsAllFigures = (function () {
    'use strict';

    var M = window.MgmtDashboard;
    var RF = window.ReportFigures;
    var HTML_PATH = '/sales-reports/html/reports_all_figures.html';
    var NS = '.raf';
    var PREFIX = 'raf';

    var state = { mode: 'month', anchor: null, seq: 0, data: null, oilFilter: 'all', ready: false, loading: null };

    // ------------------------------------------------------------------
    // Load + render.
    // ------------------------------------------------------------------

    function rangeNow() { return M.period.range(state.mode, state.anchor); }

    function updateBar() {
        var r = rangeNow();
        $('#rafLabel').text(M.period.label(state.mode, state.anchor));
        $('#rafRange').text(state.mode === 'day' ? '' : '  ' + M.prettyDate(r.from) + ' – ' + M.prettyDate(r.to));
        $('#rafModeChips button').each(function () { $(this).toggleClass('active', $(this).attr('data-mode') === state.mode); });
        $('#rafNext').prop('disabled', r.to >= M.period.todayStr());
        $('#rafRoot').toggleClass('raf-day', state.mode === 'day');
    }

    function $id(id) { return document.getElementById(id); }

    function showAlert(text) {
        var $a = $('#rafAlert');
        if (!text) { $a.addClass('d-none').empty(); return; }
        $a.removeClass('d-none').empty().append($('<div class="alert alert-danger mb-3" role="alert">').text(text));
    }

    // The wrapper may resolve to the object, to {name: object}, to {data: object} or to a one-row array.
    function normalise(raw) {
        var o = Array.isArray(raw) ? raw[0] : raw;
        if (o && o.get_reports_all_figures && typeof o.get_reports_all_figures === 'object') o = o.get_reports_all_figures;
        if (o && o.data && typeof o.data === 'object' && !('kernel' in o) && !('oil' in o)) o = o.data;
        return o && typeof o === 'object' ? o : null;
    }

    function renderAll() {
        var d = state.data;
        var host = $id('rafSections');
        if (!d || !host) return;
        var r = rangeNow();
        var m = RF.model(d, { mode: state.mode, from: r.from, to: r.to, oilFilter: state.oilFilter });
        RF.paint(host, m, { idPrefix: PREFIX, onOilFilter: function (v) { state.oilFilter = v; } });
    }

    function load() {
        updateBar();
        var r = rangeNow();
        var seq = ++state.seq;
        $('#rafLoading').removeClass('d-none');
        $('#rafRoot').addClass('raf-busy');
        showAlert('');
        var call;
        try {
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.getReportsAllFigures !== 'function') {
                throw new Error('The All figures data call is not available yet.');
            }
            call = Promise.resolve(dataFunctions.getReportsAllFigures(r.from, r.to));
        } catch (e) { call = Promise.reject(e); }
        return call.then(function (raw) {
            if (seq !== state.seq) return; // a newer click superseded this one
            var d = normalise(raw);
            if (!d) throw new Error('No figures came back for this period.');
            if (d.success === false) throw new Error(d.error || 'The figures could not be loaded.');
            state.data = d;
            renderAll();
        }).catch(function (e) {
            if (seq !== state.seq) return;
            state.data = null;
            RF.destroy(PREFIX);
            showAlert('Could not load the figures: ' + (e && e.message ? e.message : 'unknown error') + '. Try again, or pick another period.');
        }).then(function () {
            if (seq !== state.seq) return;
            $('#rafLoading').addClass('d-none');
            $('#rafRoot').removeClass('raf-busy');
        });
    }

    // ------------------------------------------------------------------
    // Events and lifecycle.
    // ------------------------------------------------------------------

    function bind() {
        var $host = $('#reportsAllHost');
        $host.off(NS);
        $host.on('click' + NS, '#rafModeChips button[data-mode]', function () {
            state.mode = $(this).attr('data-mode');
            load();
        });
        $host.on('click' + NS, '#rafPrev', function () { state.anchor = M.period.step(state.mode, state.anchor, -1); load(); });
        $host.on('click' + NS, '#rafNext', function () { state.anchor = M.period.step(state.mode, state.anchor, 1); load(); });
        $host.on('click' + NS, '#rafToday', function () { state.anchor = M.period.todayStr(); load(); });
        // Jump links must not change the URL hash (the router listens to it).
        $host.on('click' + NS, '.raf-jump a[data-jump]', function (e) {
            e.preventDefault();
            var t = document.getElementById($(this).attr('data-jump'));
            if (t && t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }

    function destroy() {
        state.seq++; // drop any response still in flight
        $('#reportsAllHost').off(NS);
        RF.destroy(PREFIX);
        state.ready = false;
        state.loading = null;
        state.data = null;
    }

    function ensureMarkup() {
        if (state.ready && document.getElementById('rafRoot')) return Promise.resolve(true);
        if (state.loading) return state.loading;
        var host = document.getElementById('reportsAllHost');
        if (!host) return Promise.reject(new Error('The All figures area is missing from the page.'));
        state.loading = _appRouter.fetchHtml(_appRouter.basePath + HTML_PATH).then(function (res) {
            if (!res || !res.success) throw new Error('Could not load the All figures page.');
            // Static markup shipped in html/reports_all_figures.html (no database values in it).
            $(host).html(res.data);
            if (typeof actionAccess !== 'undefined' && actionAccess.apply) actionAccess.apply(host);
            bind();
            state.ready = true;
            return true;
        }).then(function (v) { state.loading = null; return v; }, function (e) { state.loading = null; throw e; });
        return state.loading;
    }

    function init() {
        destroy();
        state.mode = 'month';
        state.anchor = M.period.todayStr();
        state.oilFilter = 'all';
        return ensureMarkup().then(load).catch(function (e) {
            $('#reportsAllHost').empty().append($('<div class="alert alert-danger" role="alert">')
                .text((e && e.message) || 'Could not load the All figures page.'));
        });
    }

    // First call builds the page; later calls (tab re-shown) just refresh if nothing is drawn yet.
    function show() {
        if (state.ready && document.getElementById('rafRoot')) { return state.data ? Promise.resolve() : load(); }
        return init();
    }

    return { init: init, show: show, destroy: destroy };
}());

window._reportsAllFigures = _reportsAllFigures;
