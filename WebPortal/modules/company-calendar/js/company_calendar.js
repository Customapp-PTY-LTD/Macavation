/**
 * Company calendar (route 'company-calendar'; Mike's MacView, 27 Nov 2026).
 *
 * Month grid (Monday first, today marked), a panel for the picked day, and the next 60 days.
 * Data: get_company_calendar (migration 20261127130000) = one row per day with its working-day
 * value (weekday 1, weekend 0, public holiday / shutdown / closed 0, working day 1, half day 0.5)
 * plus the Procurement plan's planned trucks (the expected deliveries).
 *
 * Henry (27 Nov 2026): ONE day list. Adding or removing a day writes procurement_day_types through
 * set_procurement_days, exactly as the Procurement plan does, so both screens always agree.
 * Editing needs company_calendar.edit; everyone with the screen can look.
 *
 * Security: every DB-sourced or typed string goes into the DOM through esc() or .text().
 */
var _companyCalendar = (function () {
    'use strict';

    var NS = '.cc';
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    var KIND_TEXT = {
        workday: 'Working day', weekend: 'Weekend', public_holiday: 'Public holiday', company_holiday: 'Extra holiday',
        shutdown: 'Shutdown', closed: 'Closed', working_day: 'Working day (added)', half_day: 'Half day', no_cracking: 'No cracking'
    };
    var TYPE_TEXT = { shutdown: 'Shutdown / closed', work: 'Working day', half: 'Half day', holiday: 'Extra holiday / closed', off: 'Closed', nocrack: 'No cracking' };
    var STATUS_TEXT = { planned: 'Planned', confirmed: 'Truck booked', received: 'Received' };

    var state = { data: null, month: null, sel: null, today: null };

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v);
    }
    function canEdit() { return typeof window.hasAction === 'function' && !!window.hasAction('company_calendar.edit'); }
    function toast(msg, type) { if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(msg, type || 'success'); }

    // ---- dates as 'YYYY-MM-DD' strings, worked in UTC so no time zone can shift a day ----
    function d2s(d) { return d.toISOString().slice(0, 10); }
    function s2d(s) { return new Date(s + 'T00:00:00Z'); }
    function addDays(s, n) { return d2s(new Date(s2d(s).getTime() + n * 864e5)); }
    function isoDow(s) { var w = s2d(s).getUTCDay(); return w === 0 ? 7 : w; }
    function monthStart(s) { return s.slice(0, 7) + '-01'; }
    function addMonths(s, n) { var d = s2d(monthStart(s)); d.setUTCMonth(d.getUTCMonth() + n); return d2s(d); }
    function longDay(s) { var d = s2d(s); return WD[isoDow(s) - 1] + ' ' + d.getUTCDate() + ' ' + MON3[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
    function shortDay(s) { var d = s2d(s); return WD[isoDow(s) - 1] + ' ' + d.getUTCDate() + ' ' + MON3[d.getUTCMonth()]; }
    function sastToday() { return d2s(new Date(Date.now() + 2 * 3600 * 1000)); }
    function kg(v) { return v == null ? '' : _common.formatKg(Number(v)) + ' kg'; }

    function gridRange(month) {
        var first = monthStart(month);
        var start = addDays(first, -(isoDow(first) - 1));
        var last = addDays(addMonths(first, 1), -1);
        var end = addDays(last, 7 - isoDow(last));
        return { first: first, last: last, start: start, end: end };
    }

    // ------------------------------------------------------------------ loading

    async function load() {
        var r = gridRange(state.month);
        var to = r.end;
        var horizon = addDays(state.today, 60);
        if (horizon > to) to = horizon;
        var from = r.start < state.today ? r.start : state.today;
        var data = await dataFunctions.getCompanyCalendar(from, to);
        if (!data) {
            $('#ccNotice').html('<div class="alert alert-warning">The company calendar is not set up on this database yet.</div>');
            return;
        }
        $('#ccNotice').empty();
        state.today = data.today || state.today;
        state.data = data;
        state.byDay = {};
        (data.days || []).forEach(function (d) { state.byDay[d.day] = { info: d, trucks: [] }; });
        (data.deliveries || []).forEach(function (t) {
            var x = state.byDay[t.scheduled_date];
            if (x) x.trucks.push(t);
        });
        render();
    }

    // ------------------------------------------------------------------ rendering

    function dayTag(info) {
        if (!info) return '';
        var k = info.kind;
        if (k === 'workday' || k === 'weekend') return info.note ? info.note : '';
        return info.label || KIND_TEXT[k] || '';
    }

    function renderGrid() {
        var r = gridRange(state.month);
        var d = s2d(r.first);
        $('#ccMonth').text(MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear());
        var h = WD.map(function (w) { return '<div class="cc-head" role="columnheader">' + w + '</div>'; }).join('');
        var workDays = 0, holidays = [], trucks = 0, truckKg = 0;
        for (var s = r.start; s <= r.end; s = addDays(s, 1)) {
            var x = state.byDay[s] || { info: null, trucks: [] };
            var info = x.info;
            var inMonth = s >= r.first && s <= r.last;
            if (inMonth && info) {
                workDays += Number(info.value) || 0;
                if (info.holiday) holidays.push(info.holiday);
                trucks += x.trucks.length;
                x.trucks.forEach(function (t) { truckKg += Number(t.predicted_weight_kg) || 0; });
            }
            var cls = ['cc-cell'];
            if (!inMonth) cls.push('cc-out');
            if (isoDow(s) >= 6) cls.push('cc-weekend');
            if (info && info.kind) cls.push('cc-k-' + info.kind);
            if (s === state.today) cls.push('cc-today');
            if (s === state.sel) cls.push('cc-sel');
            var tag = dayTag(info);
            h += '<button type="button" class="' + cls.join(' ') + '" role="gridcell" data-day="' + s + '"' +
                ' aria-label="' + esc(longDay(s) + (tag ? ', ' + tag : '') + (x.trucks.length ? ', ' + x.trucks.length + ' expected deliveries' : '')) + '"' +
                (s === state.sel ? ' aria-selected="true"' : '') + '>' +
                '<span class="cc-num">' + s2d(s).getUTCDate() + '</span>' +
                (tag ? '<span class="cc-tag" title="' + esc(tag) + '">' + esc(tag) + '</span>' : '') +
                (x.trucks.length ? '<span class="cc-trucks"><i class="fas fa-truck me-1" aria-hidden="true"></i>' + x.trucks.length + '</span>' : '') +
                '</button>';
        }
        $('#ccGrid').html(h);
        $('#ccMonthSummary').text(workDays + ' working day' + (workDays === 1 ? '' : 's') + ' this month' +
            (holidays.length ? ' · public holidays: ' + holidays.join(', ') : '') +
            (trucks ? ' · ' + trucks + ' expected deliver' + (trucks === 1 ? 'y' : 'ies') + ' (' + _common.formatKg(truckKg) + ' kg)' : ''));
    }

    function truckHtml(t) {
        var bits = [kg(t.predicted_weight_kg), t.bags ? t.bags + ' bags' : null, t.transporter_name,
            t.collection_date ? 'collected ' + shortDay(t.collection_date) : null].filter(Boolean).join(' · ');
        var status = t.status === 'received' && t.batch_number
            ? '<button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-cc-act="batch" data-kernel="' + esc(t.kernel_id || '') + '">Received as ' + esc(t.batch_number) + '</button>'
            : '<span class="badge border ' + (t.status === 'confirmed' ? 'bg-success-subtle text-success-emphasis' : 'bg-light text-dark') + '">' + esc(STATUS_TEXT[t.status] || t.status) + '</span>';
        return '<li class="mb-2"><div class="fw-semibold">' + esc(t.grower) + (t.truck_label ? ' <span class="text-muted fw-normal">· ' + esc(t.truck_label) + '</span>' : '') + '</div>' +
            '<div class="small">' + esc(bits) + '</div>' +
            (t.note ? '<div class="small text-muted">' + esc(t.note) + '</div>' : '') +
            '<div class="small d-flex gap-2 align-items-center mt-1">' + status +
            (t.status !== 'received' ? '<button type="button" class="btn btn-link btn-sm p-0" data-cc-act="truck" data-id="' + esc(t.id) + '">Open in Procurement plan</button>' : '') +
            '</div></li>';
    }

    function renderDay() {
        var s = state.sel;
        if (!s) { $('#ccDayTitle').text('Pick a day'); $('#ccDayBody').html('<p class="text-muted mb-0">Click a day to see what is on it.</p>'); return; }
        var x = state.byDay[s] || { info: null, trucks: [] };
        var info = x.info || {};
        $('#ccDayTitle').text(longDay(s) + (s === state.today ? ' (today)' : ''));
        var v = Number(info.value);
        var h = '<div class="mb-2"><span class="fw-semibold">' + esc(KIND_TEXT[info.kind] || '') + '</span>' +
            (info.kind ? ' <span class="text-muted small">· counts as ' + (v === 0.5 ? 'half a working day' : v === 1 ? 'a working day' : 'no working day') + '</span>' : '') + '</div>';
        if (info.holiday) h += '<div class="small mb-1"><i class="fas fa-flag me-1 text-danger" aria-hidden="true"></i>' + esc(info.holiday) + '</div>';
        if (info.day_type && info.day_type !== 'default') h += '<div class="small mb-1">Set on the calendar: <strong>' + esc(TYPE_TEXT[info.day_type] || info.day_type) + '</strong></div>';
        if (info.note) h += '<div class="small mb-1">' + esc(info.note) + '</div>';
        if (canEdit() && (info.day_type || info.note)) {
            h += '<button type="button" class="btn btn-outline-danger btn-sm mt-1" data-cc-act="remove" data-day="' + s + '">Remove what is set on this day</button>';
        }
        if (canEdit()) h += '<button type="button" class="btn btn-outline-secondary btn-sm mt-1 ms-1" data-cc-act="add-day" data-day="' + s + '">Add or change</button>';
        h += '<h3 class="h6 mt-3">Expected deliveries</h3>';
        h += x.trucks.length ? '<ul class="list-unstyled mb-0">' + x.trucks.map(truckHtml).join('') + '</ul>'
            : '<p class="text-muted small mb-0">None planned. Trucks are planned on the Procurement plan.</p>';
        $('#ccDayBody').html(h);
    }

    function renderUpcoming() {
        var items = [];
        var end = addDays(state.today, 60);
        for (var s = state.today; s <= end; s = addDays(s, 1)) {
            var x = state.byDay[s];
            if (!x) continue;
            var info = x.info || {};
            var special = !(info.kind === 'workday' || info.kind === 'weekend') || !!info.note;
            if (!special && !x.trucks.length) continue;
            var parts = [];
            if (special) parts.push(esc(info.label || KIND_TEXT[info.kind]));
            if (x.trucks.length) {
                var kgSum = x.trucks.reduce(function (a, t) { return a + (Number(t.predicted_weight_kg) || 0); }, 0);
                parts.push('<span class="text-muted"><i class="fas fa-truck me-1" aria-hidden="true"></i>' + x.trucks.length + ' · ' + esc(_common.formatKg(kgSum)) + ' kg</span>');
            }
            items.push('<li class="list-group-item list-group-item-action" role="button" tabindex="0" data-day="' + s + '">' +
                '<div class="small text-muted">' + esc(shortDay(s)) + (s === state.today ? ' · today' : '') + '</div><div>' + parts.join(' · ') + '</div></li>');
        }
        $('#ccUpcoming').html(items.join('') || '<li class="list-group-item text-muted">Nothing special in the next 60 days.</li>');
    }

    function render() {
        $('#ccAdd').toggleClass('d-none', !canEdit());
        renderGrid();
        renderDay();
        renderUpcoming();
    }

    // ------------------------------------------------------------------ editing

    function openAdd(day) {
        var x = day && state.byDay[day] ? state.byDay[day].info : null;
        $('#ccFrom').val(day || state.today);
        $('#ccTo').val('');
        $('#ccKind').val(x && x.day_type && x.day_type !== 'default' && TYPE_TEXT[x.day_type] && $('#ccKind option[value="' + x.day_type + '"]').length ? x.day_type : (x && x.note ? 'default' : 'shutdown'));
        $('#ccTitle').val(x && x.note ? x.note : '');
        $('#ccModalError').text('');
        kindChanged();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('ccModal')).show();
    }

    function kindChanged() { $('#ccTitleReq').toggleClass('d-none', $('#ccKind').val() !== 'default'); }

    async function save() {
        if (!canEdit()) return;
        var from = $('#ccFrom').val(), to = $('#ccTo').val() || from, kind = $('#ccKind').val(), title = $.trim($('#ccTitle').val());
        if (!from) { $('#ccModalError').text('Choose the date.'); return; }
        if (to < from) { $('#ccModalError').text('The To date must not be before From.'); return; }
        if (kind === 'default' && !title) { $('#ccModalError').text('Give the company date a title.'); return; }
        $('#ccSave').prop('disabled', true);
        try {
            var res = await dataFunctions.setProcurementDays(from, to, kind, null, title || null);
            if (!res || res.success === false) throw new Error((res && res.error) || 'Could not save.');
            bootstrap.Modal.getInstance(document.getElementById('ccModal')).hide();
            toast('Saved.');
            state.sel = from;
            await load();
        } catch (e) {
            $('#ccModalError').text(e.message || String(e));
        } finally {
            $('#ccSave').prop('disabled', false);
        }
    }

    async function removeDay(day) {
        if (!canEdit()) return;
        if (typeof Swal !== 'undefined') {
            var ok = await Swal.fire({ title: 'Remove what is set on ' + longDay(day) + '?', text: 'The day goes back to normal (weekday, weekend or public holiday). The Procurement plan changes too.',
                icon: 'warning', showCancelButton: true, confirmButtonText: 'Remove' });
            if (!ok.isConfirmed) return;
        }
        var res = await dataFunctions.setProcurementDays(day, day, 'default', null, null);
        if (!res || res.success === false) { toast((res && res.error) || 'Could not remove.', 'error'); return; }
        toast('Removed.');
        await load();
    }

    function pick(day) {
        if (!day) return;
        state.sel = day;
        var r = gridRange(state.month);
        if (day < r.first || day > r.last) { state.month = monthStart(day); load(); return; }
        renderGrid();
        renderDay();
    }

    function bind() {
        var $m = $('#ccModule');
        $m.off(NS);
        $m.on('click' + NS, '#ccPrev', function () { state.month = addMonths(state.month, -1); load(); });
        $m.on('click' + NS, '#ccNext', function () { state.month = addMonths(state.month, 1); load(); });
        $m.on('click' + NS, '#ccToday', function () { state.month = monthStart(state.today); state.sel = state.today; load(); });
        $m.on('click' + NS, '.cc-cell', function () { pick(this.getAttribute('data-day')); });
        $m.on('click' + NS, '#ccUpcoming [data-day]', function () { pick(this.getAttribute('data-day')); });
        $m.on('keydown' + NS, '#ccUpcoming [data-day]', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(this.getAttribute('data-day')); }
        });
        $m.on('click' + NS, '#ccAdd', function () { openAdd(state.sel); });
        $m.on('change' + NS, '#ccKind', kindChanged);
        $m.on('click' + NS, '#ccSave', save);
        $m.on('click' + NS, '[data-cc-act]', function () {
            var act = this.getAttribute('data-cc-act');
            if (act === 'remove') removeDay(this.getAttribute('data-day'));
            if (act === 'add-day') openAdd(this.getAttribute('data-day'));
            if (act === 'truck' && typeof _appRouter !== 'undefined') _appRouter.openWith('procurement-plan', { editProcurementId: this.getAttribute('data-id') });
            if (act === 'batch' && this.getAttribute('data-kernel') && typeof _appRouter !== 'undefined') {
                _appRouter.openWith('batch-journey', { openKernelId: this.getAttribute('data-kernel') });
            }
        });
    }

    async function init() {
        state.today = sastToday();
        state.month = monthStart(state.today);
        state.sel = state.today;
        bind();
        await load();
    }

    return { init: init };
})();
