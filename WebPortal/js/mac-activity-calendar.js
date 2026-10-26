/**
 * MacActivityCalendar — a "what happened on which day" month calendar in a toolbar dropdown.
 *
 * Same look and behaviour as the Kernel Production calendar: days with activity are shaded
 * with a dot, clicking a day lists what happened on it. Used by Grower Intake, Stock and
 * Dispatch. The calendar only fetches when it is opened, and once per month shown.
 *
 *   MacActivityCalendar.create({
 *       mountId: 'giActivityCalendarMount',   // empty element in the module toolbar
 *       idPrefix: 'giActivityCalendar',       // unique per screen
 *       title: 'Intake Calendar',
 *       icon: 'fa-calendar-check',
 *       intro: 'Days shaded green had ...',
 *       emptyDayText: 'Nothing was received on this day.',
 *       // Resolves to [{ date: 'YYYY-MM-DD', title, subtitle, tags: [{ text, tone }] }]
 *       // tone: 'green' (default) | 'blue' | 'amber' | 'grey'
 *       loadMonth: async (fromIso, toIso) => [...]
 *   });
 *
 * All text is escaped before it is rendered — callers pass plain strings, never HTML.
 */
var MacActivityCalendar = (function () {
    'use strict';

    var TZ = 'Africa/Johannesburg';

    var esc = function (v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    };

    var pad = function (n) { return String(n).padStart(2, '0'); };
    var isoFromDate = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
    var parseIso = function (iso) {
        var p = String(iso || '').split('-');
        if (p.length < 3) return null;
        return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
    };

    /**
     * Calendar day (YYYY-MM-DD) for a date or timestamp, in South African time.
     * A plain 'YYYY-MM-DD' is returned as-is; a timestamp is converted so an event at
     * 00:30 SAST lands on its own day, not the previous UTC one.
     */
    var dayOf = function (value) {
        if (!value) return null;
        var s = String(value);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var d = new Date(s);
        if (isNaN(d.getTime())) return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
        // en-CA formats as YYYY-MM-DD.
        return d.toLocaleDateString('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
    };

    var formatKg = function (v) {
        var n = Number(v);
        if (!isFinite(n)) return '';
        return (Math.round(n * 10) / 10).toLocaleString('en-ZA') + ' kg';
    };

    var TONE_CLASS = { green: '', blue: 'is-blue', amber: 'is-amber', grey: 'is-grey' };

    var create = function (opts) {
        var mount = document.getElementById(opts.mountId);
        if (!mount) return null;
        var p = opts.idPrefix;

        mount.className = 'dropdown';
        mount.innerHTML =
            '<button type="button" class="btn btn-outline-secondary" id="' + p + 'Btn" data-bs-toggle="dropdown" data-bs-auto-close="outside" aria-expanded="false" title="' + esc(opts.title) + '" aria-label="' + esc(opts.title) + '">' +
                '<i class="fas ' + esc(opts.icon || 'fa-calendar-check') + '"></i>' +
            '</button>' +
            '<div class="dropdown-menu dropdown-menu-end p-3 mac-acal-menu" aria-labelledby="' + p + 'Btn">' +
                '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">' +
                    '<h6 class="mb-0"><i class="fas ' + esc(opts.icon || 'fa-calendar-check') + ' me-2"></i>' + esc(opts.title) + '</h6>' +
                    '<div class="mac-acal-toolbar">' +
                        '<button type="button" class="btn btn-sm btn-outline-secondary" data-acal-shift="-1" aria-label="Previous month"><i class="fas fa-chevron-left"></i></button>' +
                        '<div class="mac-acal-month" data-acal-label>Loading…</div>' +
                        '<button type="button" class="btn btn-sm btn-outline-secondary" data-acal-shift="1" aria-label="Next month"><i class="fas fa-chevron-right"></i></button>' +
                    '</div>' +
                '</div>' +
                '<p class="text-muted small mb-3">' + esc(opts.intro) + '</p>' +
                '<div class="mac-acal-layout">' +
                    '<div>' +
                        '<div class="mac-acal-weekdays"><div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div></div>' +
                        '<div class="mac-acal-grid" data-acal-grid></div>' +
                    '</div>' +
                    '<div class="mac-acal-detail" data-acal-detail></div>' +
                '</div>' +
            '</div>';

        var btn = mount.querySelector('#' + p + 'Btn');
        var labelEl = mount.querySelector('[data-acal-label]');
        var gridEl = mount.querySelector('[data-acal-grid]');
        var detailEl = mount.querySelector('[data-acal-detail]');

        var today = new Date();
        var state = {
            month: new Date(today.getFullYear(), today.getMonth(), 1),
            selected: null,
            byMonth: {}       // 'YYYY-MM' -> { status: 'loading'|'ready'|'error', index, error }
        };

        var monthKey = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); };

        var buildIndex = function (entries) {
            var idx = {};
            (entries || []).forEach(function (e) {
                if (!e || !e.date) return;
                if (!idx[e.date]) idx[e.date] = [];
                idx[e.date].push(e);
            });
            Object.keys(idx).forEach(function (iso) {
                idx[iso].sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || '')); });
            });
            return idx;
        };

        var load = function () {
            var key = monthKey(state.month);
            var slot = state.byMonth[key];
            if (slot && slot.status !== 'error') return;
            var from = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
            var to = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 0);
            state.byMonth[key] = { status: 'loading', index: {} };
            Promise.resolve()
                .then(function () { return opts.loadMonth(isoFromDate(from), isoFromDate(to)); })
                .then(function (entries) {
                    state.byMonth[key] = { status: 'ready', index: buildIndex(entries) };
                })
                .catch(function (err) {
                    console.error('[' + p + '] calendar load failed:', err);
                    state.byMonth[key] = { status: 'error', index: {}, error: (err && err.message) || String(err) };
                })
                // Only redraw if the user is still looking at the month that just arrived.
                .then(function () { if (monthKey(state.month) === key) render(); });
        };

        var render = function () {
            var key = monthKey(state.month);
            var slot = state.byMonth[key] || { status: 'loading', index: {} };
            labelEl.textContent = state.month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

            if (slot.status === 'ready' && !state.selected) {
                // Same as the production calendar: open on the first active day of the month.
                state.selected = Object.keys(slot.index).sort()[0] || null;
            }

            var first = new Date(state.month.getFullYear(), state.month.getMonth(), 1 - state.month.getDay());
            var html = '';
            for (var i = 0; i < 42; i++) {
                var d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
                var iso = isoFromDate(d);
                var n = (slot.index[iso] || []).length;
                var cls = ['mac-acal-day'];
                if (d.getMonth() !== state.month.getMonth()) cls.push('is-outside-month');
                if (n > 0) cls.push('has-activity');
                if (state.selected === iso) cls.push('is-active');
                html += '<button type="button" class="' + cls.join(' ') + '" data-iso="' + iso + '"' +
                    (n > 0 ? ' title="' + n + ' item' + (n === 1 ? '' : 's') + '"' : '') + '>' +
                    '<div class="mac-acal-daynum">' + d.getDate() + '</div>' +
                    (n > 0 ? '<div class="mac-acal-dot"></div>' : '') +
                    '</button>';
            }
            gridEl.innerHTML = html;
            renderDetail(slot);
        };

        var renderDetail = function (slot) {
            if (slot.status === 'loading') {
                detailEl.innerHTML = '<div class="mac-acal-detail-empty"><i class="fas fa-spinner fa-spin me-2"></i>Loading…</div>';
                return;
            }
            if (slot.status === 'error') {
                detailEl.innerHTML = '<div class="mac-acal-detail-title">Could not load this month</div>' +
                    '<div class="mac-acal-detail-empty">' + esc(slot.error) + '</div>' +
                    '<button type="button" class="btn btn-sm btn-outline-secondary mt-2" data-acal-retry>Try again</button>';
                return;
            }
            var iso = state.selected;
            if (!iso) {
                detailEl.innerHTML = '<div class="mac-acal-detail-title">Nothing this month</div>' +
                    '<div class="mac-acal-detail-empty">' + esc(opts.emptyMonthText || 'No activity was recorded in this month.') + '</div>';
                return;
            }
            var date = parseIso(iso);
            var title = date ? date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : iso;
            var entries = slot.index[iso] || [];
            if (!entries.length) {
                detailEl.innerHTML = '<div class="mac-acal-detail-title">' + esc(title) + '</div>' +
                    '<div class="mac-acal-detail-empty">' + esc(opts.emptyDayText || 'Nothing recorded on this day.') + '</div>';
                return;
            }
            var html = '<div class="mac-acal-detail-title">' + esc(title) + '</div>';
            entries.forEach(function (e) {
                html += '<div class="mac-acal-entry">' +
                    '<div class="mac-acal-entry-title">' + esc(e.title) + '</div>' +
                    (e.subtitle ? '<div class="mac-acal-entry-sub">' + esc(e.subtitle) + '</div>' : '') +
                    '<div class="mac-acal-tags">';
                (e.tags || []).forEach(function (t) {
                    html += '<span class="mac-acal-tag ' + (TONE_CLASS[t.tone] || '') + '">' + esc(t.text) + '</span>';
                });
                html += '</div></div>';
            });
            detailEl.innerHTML = html;
        };

        mount.addEventListener('click', function (ev) {
            var shift = ev.target.closest('[data-acal-shift]');
            if (shift) {
                var delta = parseInt(shift.getAttribute('data-acal-shift'), 10) || 0;
                state.month = new Date(state.month.getFullYear(), state.month.getMonth() + delta, 1);
                state.selected = null;
                render();
                load();
                return;
            }
            var day = ev.target.closest('.mac-acal-day');
            if (day) {
                var iso = day.getAttribute('data-iso');
                var d = parseIso(iso);
                if (d && d.getMonth() !== state.month.getMonth()) {
                    state.month = new Date(d.getFullYear(), d.getMonth(), 1);
                    state.selected = iso;
                    render();
                    load();
                    return;
                }
                state.selected = iso;
                render();
                return;
            }
            if (ev.target.closest('[data-acal-retry]')) {
                delete state.byMonth[monthKey(state.month)];
                render();
                load();
            }
        });

        // Fetch only when the user opens it, and re-fetch each time it is reopened so a
        // batch received / basket dispatched a minute ago shows up.
        btn.addEventListener('show.bs.dropdown', function () {
            state.byMonth = {};
            state.selected = null;
            render();
            load();
        });

        render();
        return { refresh: function () { state.byMonth = {}; render(); load(); } };
    };

    return { create: create, dayOf: dayOf, formatKg: formatKg };
})();
