/**
 * Procurement plan: planned grower trucks of nut in shell vs. what cracking uses.
 *
 * Everything loads from dataFunctions.getProcurementPlan(). The forecast is a pure function
 * (simulate) that walks day by day from the start point; Week / Day / Month views, the tiles and
 * the season chart are all drawn from its output. Edit controls need 'procurement.plan.edit'.
 *
 * Security invariant: no innerHTML; DB and typed text goes in via .text() or _common.escapeHtml.
 * The chart SVG string only ever contains numbers and fixed labels.
 */
var _procurementPlan = (function () {
    'use strict';

    var NS = '.pp';
    var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var LONG_MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MAX_DAYS = 450;
    var LOW_KG = 100000;
    var DAY_TAGS = { off: 'Off', half: 'Half day', shutdown: 'Shutdown', holiday: 'Holiday', nocrack: 'No cracking' };

    var LATE_DAYS = 14;        // a truck is "late" up to this many days after its date; older ones are clean-up items
    var RUNWAY_WARN_DAYS = 30; // wording only: the database warns Mike inside this window

    var state = { plan: null, view: 'week', rate: 'planned', area: '', monthKey: null, sim: null, cleanup: null, handoff: null, openLists: {} };
    var panel = { id: null, nameTouched: false, status: 'planned' };

    // ------------------------------------------------------------------
    // Small helpers (dates are 'YYYY-MM-DD' strings, maths via UTC Dates).
    // ------------------------------------------------------------------

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml)
            ? _common.escapeHtml(v)
            : String(v == null ? '' : v);
    }

    function canEdit() {
        return typeof window !== 'undefined' && typeof window.hasAction === 'function' && !!window.hasAction('procurement.plan.edit');
    }

    function parse(k) {
        var p = String(k).split('-');
        return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    }

    function iso(d) { return d.toISOString().slice(0, 10); }

    function addDays(k, n) {
        var d = parse(k);
        d.setUTCDate(d.getUTCDate() + n);
        return iso(d);
    }

    function diffDays(a, b) { return Math.round((parse(a) - parse(b)) / 86400000); }

    function dow(k) { return parse(k).getUTCDay(); }

    function mondayOf(k) { return addDays(k, -((dow(k) + 6) % 7)); }

    function isoWeek(k) {
        var t = parse(k);
        t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
        var y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
        return Math.ceil(((t - y) / 86400000 + 1) / 7);
    }

    function dShort(k) { var d = parse(k); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }

    function dLong(k) { var d = parse(k); return d.getUTCDate() + ' ' + LONG_MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }

    function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

    function kgText(n) { return fmt(n) + ' kg'; }

    function truckLabel(d) { return d.truck_label || d.grower_name || d.grower || 'Truck'; }

    function isReceived(d) { return d.status === 'received'; }

    function canBookIn() {
        return typeof window !== 'undefined' && typeof window.hasAction === 'function' && !!window.hasAction('grower.intake.create');
    }

    function dDay(k) { var d = parse(k); return WEEKDAY[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; }

    /** Late = planned/confirmed, date before today and within LATE_DAYS. Oldest first. */
    function lateTrucks(plan) {
        var from = addDays(plan.today, -LATE_DAYS);
        return (plan.deliveries || []).filter(function (d) {
            return !isReceived(d) && d.scheduled_date < plan.today && d.scheduled_date >= from;
        }).sort(function (a, b) { return a.scheduled_date < b.scheduled_date ? -1 : (a.scheduled_date > b.scheduled_date ? 1 : 0); });
    }

    function growerLabel(d) { return d.grower || d.grower_name || 'Grower'; }

    function areaLabel(code) {
        var out = code || '';
        ((state.plan && state.plan.areas) || []).forEach(function (a) { if (a.code === code) out = a.label; });
        return out;
    }

    // ------------------------------------------------------------------
    // Forecast.
    // ------------------------------------------------------------------

    function ratePerDay(plan, rateMode) {
        var st = plan.settings || {};
        if (rateMode === 'actual' && plan.actual_kg_per_day != null) return Number(plan.actual_kg_per_day) || 0;
        return Number(st.planned_kg_per_day) || 0;
    }

    function simulate(plan, rateMode) {
        var st = plan.settings || {};
        var today = plan.today;
        var rate = ratePerDay(plan, rateMode);
        var manual = st.opening_mode === 'manual' && !!st.opening_as_of;
        var startK = manual ? st.opening_as_of : today;
        var stock = manual ? (Number(st.opening_kg) || 0) : (Number(plan.system_pool_kg) || 0);

        var types = {};
        (plan.day_types || []).forEach(function (r) { types[r.day] = r; });

        var byDay = {};
        var late = [];
        (plan.deliveries || []).forEach(function (d) {
            var received = isReceived(d);
            var k = received ? (d.received_date || d.scheduled_date) : d.scheduled_date;
            var kg = received && d.received_kg != null ? Number(d.received_kg) : Number(d.predicted_weight_kg) || 0;
            if (manual) {
                if (k < startK) return;
            } else {
                if (received) return;
                if (k < today) { late.push(d); return; }
            }
            (byDay[k] = byDay[k] || []).push({ d: d, kg: kg });
        });

        var days = [];
        var runOut = null;
        var k = startK;
        for (var i = 0; i < MAX_DAYS; i++) {
            var wd = dow(k);
            var row = types[k] || null;
            var type = row ? row.day_type : ((wd === 0 || wd === 6) ? 'off' : 'work');
            var open = stock;
            var dels = byDay[k] || [];
            var inKg = 0;
            dels.forEach(function (x) { inKg += x.kg; });
            stock += inKg;
            var ov = row && row.kg_override != null ? Number(row.kg_override) : null;
            var use = 0;
            if (type === 'work') use = ov != null ? ov : rate;
            else if (type === 'half') use = ov != null ? ov : rate / 2;
            stock -= use;
            days.push({ k: k, wd: wd, type: type, note: row ? row.note : null, open: open, dels: dels, inKg: inKg, use: use, close: stock });
            if (stock <= 0) { runOut = k; break; }
            k = addDays(k, 1);
        }
        return { days: days, runOut: runOut, rate: rate, startK: startK, manual: manual, late: late };
    }

    function weekRows(sim) {
        var weeks = [];
        sim.days.forEach(function (x) {
            var mon = mondayOf(x.k);
            var w = weeks[weeks.length - 1];
            if (!w || w.mon !== mon) {
                w = { mon: mon, start: x.k, end: x.k, open: x.open, inKg: 0, used: 0, days: [], close: x.close };
                weeks.push(w);
            }
            w.end = x.k; w.close = x.close; w.inKg += x.inKg; w.used += x.use; w.days.push(x);
        });
        return weeks;
    }

    function monthRows(sim) {
        var months = [];
        sim.days.forEach(function (x) {
            var key = x.k.slice(0, 7);
            var m = months[months.length - 1];
            if (!m || m.key !== key) {
                m = { key: key, y: +x.k.slice(0, 4), m: +x.k.slice(5, 7) - 1, open: x.open, n: 0, inKg: 0, used: 0, close: x.close };
                months.push(m);
            }
            m.n += x.dels.length; m.inKg += x.inKg; m.used += x.use; m.close = x.close;
        });
        return months;
    }

    // ------------------------------------------------------------------
    // DOM helpers.
    // ------------------------------------------------------------------

    function el(tag, cls, text) {
        var $e = $('<' + tag + '>');
        if (cls) $e.addClass(cls);
        if (text != null) $e.text(text);
        return $e;
    }

    function matchesArea(d) { return !state.area || d.storage_area_code === state.area; }

    function chipFor(x, label, clickable) {
        var d = x.d;
        var cls = 'pp-chip ' + (isReceived(d) ? 'pp-chip-received' : (d.status === 'confirmed' ? 'pp-chip-confirmed' : 'pp-chip-planned'));
        var $c = (clickable && !isReceived(d)) ? el('button', cls, label).attr({ type: 'button', 'data-id': d.id }).addClass('pp-chip-btn') : el('span', cls, label);
        if (isReceived(d)) $c.attr('title', 'Received and weighed');
        return $c;
    }

    function flagChip(d) {
        if (!isReceived(d) || !d.received_date || !d.scheduled_date) return null;
        if (Math.abs(diffDays(d.received_date, d.scheduled_date)) <= 2) return null;
        return el('span', 'pp-chip pp-chip-flag', 'Arrived ' + dShort(d.received_date)).attr('title', 'Planned for ' + dShort(d.scheduled_date));
    }

    function chipLabel(x, short) {
        var d = x.d;
        if (isReceived(d)) return '✓ ' + truckLabel(d) + ' · ' + fmt(x.kg) + ' kg';
        return truckLabel(d) + ' · ' + (short ? (Math.round(x.kg / 100) / 10) + ' t' : dShort(d.scheduled_date));
    }

    function appendChips($box, dels, short, clickable) {
        dels.forEach(function (x) {
            if (!matchesArea(x.d)) return;
            $box.append(chipFor(x, chipLabel(x, short), clickable));
            var f = flagChip(x.d);
            if (f) $box.append(f);
        });
    }

    // ------------------------------------------------------------------
    // Rendering.
    // ------------------------------------------------------------------

    function tile(label, value, note, warn) {
        return el('div', 'pp-tile' + (warn ? ' pp-tile-warn' : ''))
            .append(el('div', 'pp-tile-label', label), el('div', 'pp-tile-value', value), el('div', 'pp-tile-note', note));
    }

    function renderTiles(plan, sim) {
        var todayDay = null;
        sim.days.forEach(function (x) { if (x.k === plan.today) todayDay = x; });
        var onHand = sim.manual ? (todayDay ? todayDay.open : 0) : (Number(plan.system_pool_kg) || 0);
        var onHandNote = sim.manual ? 'your count of ' + dShort(plan.settings.opening_as_of) + ', plus the plan' : 'system stock';

        var inKg = 0, n = 0, last = null;
        (plan.deliveries || []).forEach(function (d) {
            if (isReceived(d) || d.scheduled_date < plan.today || !matchesArea(d)) return;
            inKg += Number(d.predicted_weight_kg) || 0; n++;
            if (!last || d.scheduled_date > last) last = d.scheduled_date;
        });

        var actual = state.rate === 'actual' && plan.actual_kg_per_day != null;
        var rateNote = actual
            ? 'real average of the last ' + (plan.actual_days_used || 0) + ' cracking days'
            : 'planned rate';

        var lastDel = null;
        sim.days.forEach(function (x) { x.dels.forEach(function (y) { if (!lastDel || y.d.scheduled_date > lastDel) lastDel = y.d.scheduled_date; }); });
        var runNote = '';
        if (!sim.runOut) runNote = 'plenty of stock for the whole forecast';
        else if (lastDel && lastDel < sim.runOut) runNote = 'no trucks planned after ' + LONG_MON[parse(lastDel).getUTCMonth()];

        var plannedKg = 0;
        (plan.deliveries || []).forEach(function (d) { plannedKg += Number(d.predicted_weight_kg) || 0; });
        var t1 = function (kg) { return Math.round(kg / 1000) + ' t'; };
        var $run = tile('Stock runs out', sim.runOut ? '~' + dLong(sim.runOut) : 'Not in the next 15 months',
            "Warns Mike when it's inside " + RUNWAY_WARN_DAYS + ' days' + (runNote ? ' \u00b7 ' + runNote : ''), true).attr('id', 'ppRunway');

        $('#ppTiles').empty().append(
            tile('Nut in shell on hand', t1(onHand), onHandNote),
            tile('Still to come', n + (n === 1 ? ' truck' : ' trucks'), '~' + t1(inKg) + ' of ' + t1(plannedKg) + ' planned' + (last ? ' \u00b7 last one ' + dShort(last) : '')),
            $run,
            tile('Cracking uses', fmt(sim.rate) + ' kg/day', rateNote)
        );
    }

    function renderLate(plan) {
        var $b = $('#ppLate').empty();
        var late = lateTrucks(plan);
        if (!late.length) return;
        var first = late[0];
        var $box = el('div', 'pp-late').attr('role', 'alert');
        var $msg = el('div', 'pp-late-msg');
        $msg.append(el('strong', '', late.length + (late.length === 1 ? ' truck is late.' : ' trucks are late.')));
        $msg.append(document.createTextNode(' ' + growerLabel(first) + (first.truck_label ? ' \u00b7 ' + first.truck_label : '') + ' was due ' + dDay(first.scheduled_date) +
            (late.length > 1 ? ' and ' + (late.length - 1) + ' more' : '') + '. Book it in if it arrived, or move it.'));
        var $acts = el('div', 'pp-late-acts');
        if (canEdit()) $acts.append(el('button', 'btn btn-outline-secondary pp-act', 'Move date').attr({ type: 'button', 'data-late': first.id }));
        if (canBookIn()) $acts.append(el('button', 'btn btn-primary pp-act', 'Book in').attr({ type: 'button', 'data-bookin': first.id }));
        $box.append($msg, $acts);
        $b.append($box);
    }

    // ------------------------------------------------------------------
    // Trucks this week and next.
    // ------------------------------------------------------------------

    function statusChip(d, today) {
        if (isReceived(d)) return el('span', 'pp-chip pp-chip-received', 'Received');
        if (d.scheduled_date < today) return el('span', 'pp-chip pp-chip-late', 'Late');
        if (d.status === 'confirmed') return el('span', 'pp-chip pp-chip-confirmed', 'Confirmed');
        return el('span', 'pp-chip pp-chip-planned', 'Planned');
    }

    function truckActions(d, today) {
        var $a = el('div', 'pp-row-acts');
        if (isReceived(d)) {
            if (d.batch_number) $a.append(el('span', 'pp-muted', 'Batch ' + d.batch_number));
            return $a;
        }
        var dueNow = d.scheduled_date <= today;
        if (dueNow && canBookIn()) $a.append(el('button', 'btn btn-sm btn-primary pp-act', 'Book in').attr({ type: 'button', 'data-bookin': d.id }));
        if (!dueNow && d.status === 'planned' && canEdit()) $a.append(el('button', 'btn btn-sm btn-outline-secondary pp-act', 'Mark confirmed').attr({ type: 'button', 'data-confirm': d.id }));
        if (canEdit()) $a.append(el('button', 'btn btn-sm btn-outline-secondary pp-act', 'Edit').attr({ type: 'button', 'data-late': d.id }));
        return $a;
    }

    function truckRow(d, today) {
        var late = !isReceived(d) && d.scheduled_date < today;
        var $date = el('td', 'pp-td pp-nowrap');
        if (d.scheduled_date === today) $date.append(el('strong', '', 'Today'), document.createTextNode(' '));
        $date.append(document.createTextNode(dDay(d.scheduled_date)));
        var rec = isReceived(d) && d.received_kg != null ? fmt(d.received_kg) : '\u2013';
        return el('tr', (late ? 'pp-row-late' : '')).attr('data-truck', d.id).append(
            $date,
            el('td', 'pp-td').append(el('strong', '', growerLabel(d) + (d.truck_label ? ' \u00b7 ' + d.truck_label : ''))),
            el('td', 'pp-td pp-num', fmt(Number(d.predicted_weight_kg) || 0)),
            el('td', 'pp-td pp-num' + (rec === '\u2013' ? ' pp-muted' : ''), rec),
            el('td', 'pp-td', areaLabel(d.storage_area_code) || '\u2013'),
            el('td', 'pp-td').append(statusChip(d, today)),
            el('td', 'pp-td').append(truckActions(d, today))
        );
    }

    function truckTable(rows, today) {
        var $head = el('tr').append(th('Date'), th('Truck'), th('Planned kg', 1), th('Received kg', 1), th('Storage area'), th('Status'), el('th', 'pp-th').append(el('span', 'visually-hidden', 'Actions')));
        var $body = el('tbody');
        rows.forEach(function (d) { $body.append(truckRow(d, today)); });
        return el('div', 'pp-table-wrap').append(el('table', 'pp-table').append(el('thead').append($head), $body));
    }

    function renderTrucks(plan) {
        var $box = $('#ppTrucks').empty();
        var today = plan.today;
        var start = mondayOf(today), end = addDays(start, 13);
        var all = (plan.deliveries || []).slice().sort(function (a, b) { return a.scheduled_date < b.scheduled_date ? -1 : (a.scheduled_date > b.scheduled_date ? 1 : 0); });
        var rows = all.filter(function (d) { return d.scheduled_date >= start && d.scheduled_date <= end; });

        var h = state.handoff;
        if (h && h.focusProcurementId) {
            var f = findDelivery(h.focusProcurementId);
            if (f && !rows.some(function (d) { return String(d.id) === String(f.id); })) {
                $box.append(el('div', 'pp-card pp-selected').append(el('div', 'pp-card-title', 'Selected truck'), truckTable([f], today)));
            }
        }

        var $legend = el('div', 'pp-chips pp-legend-chips').append(
            el('span', 'pp-chip pp-chip-planned', 'Planned'),
            el('span', 'pp-chip pp-chip-confirmed', 'Confirmed'),
            el('span', 'pp-chip pp-chip-received', 'Received'),
            el('span', 'pp-chip pp-chip-late', 'Late'));
        var $card = el('div', 'pp-card').append(
            el('div', 'pp-card-head').append(el('h2', 'pp-card-title h6 mb-0', 'Trucks this week and next'), $legend));
        if (rows.length) $card.append(truckTable(rows, today));
        else $card.append(el('div', 'pp-empty', 'No trucks planned for this week or next.'));
        $card.append(el('div', 'pp-hint', 'Book in is shown to people who can create intake batches (Thando). Editing the plan stays with Mike.'));
        $box.append($card);
    }

    // ------------------------------------------------------------------
    // Clean-up card (get_procurement_cleanup).
    // ------------------------------------------------------------------

    function renderCleanup() {
        var $box = $('#ppCleanup').empty();
        var c = state.cleanup;
        if (!c || !canEdit()) return;
        var doubles = c.possible_doubles || [], never = c.never_booked_in || [];
        if (!doubles.length && !never.length) return;

        var $card = el('div', 'pp-card').append(
            el('h2', 'pp-card-title h6 mb-0', 'Before the old calendar is switched off'),
            el('div', 'pp-sub', "Trucks Mike already typed into the old calendar are on this plan too. A few may now show twice, or show as late when they arrived. We'll list them for Mike to tidy up once."));
        var $chips = el('div', 'pp-chips');
        if (doubles.length) $chips.append(el('button', 'pp-chip pp-chip-flag pp-chip-toggle', doubles.length + ' possible ' + (doubles.length === 1 ? 'double' : 'doubles')).attr({ type: 'button', 'data-list': 'doubles', 'aria-expanded': state.openLists.doubles ? 'true' : 'false' }));
        if (never.length) $chips.append(el('button', 'pp-chip pp-chip-flag pp-chip-toggle', never.length + ' old ' + (never.length === 1 ? 'truck' : 'trucks') + ' never booked in').attr({ type: 'button', 'data-list': 'never', 'aria-expanded': state.openLists.never ? 'true' : 'false' }));
        $card.append($chips);

        var cancelBtn = function (id) { return el('button', 'btn btn-sm btn-outline-danger pp-act', 'Cancel this truck').attr({ type: 'button', 'data-cancel': id }); };

        if (doubles.length && state.openLists.doubles) {
            var $l = el('div', 'pp-cleanup-list');
            doubles.forEach(function (g) {
                var trucks = (g.trucks || []).slice().sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : 1; });
                var newest = trucks.length ? trucks[trucks.length - 1].id : null;
                var $g = el('div', 'pp-cleanup-group').append(el('div', 'pp-cleanup-head', dDay(g.scheduled_date) + ' \u00b7 ' + (g.grower || 'Grower')));
                trucks.forEach(function (t) {
                    var $r = el('div', 'pp-cleanup-row').append(
                        el('span', 'pp-cleanup-name', (t.truck_label || 'Truck') + ' \u00b7 ' + fmt(Number(t.predicted_weight_kg) || 0) + ' kg'));
                    if (t.id === newest) $r.append(el('span', 'pp-chip pp-chip-confirmed', 'Newest'));
                    $r.append(cancelBtn(t.id));
                    $g.append($r);
                });
                $l.append($g);
            });
            $card.append($l);
        }
        if (never.length && state.openLists.never) {
            var $n = el('div', 'pp-cleanup-list');
            never.forEach(function (t) {
                $n.append(el('div', 'pp-cleanup-row').append(
                    el('span', 'pp-cleanup-name', dDay(t.scheduled_date) + ' \u00b7 ' + (t.grower || 'Grower') + (t.truck_label ? ' \u00b7 ' + t.truck_label : '') + ' \u00b7 ' + fmt(Number(t.predicted_weight_kg) || 0) + ' kg'),
                    cancelBtn(t.id)));
            });
            $card.append($n);
        }
        $box.append($card);
    }

    function loadCleanup() {
        if (!canEdit() || typeof dataFunctions === 'undefined' || !dataFunctions._rpcRead) { state.cleanup = null; renderCleanup(); return $.Deferred().resolve().promise(); }
        return dataFunctions._rpcRead('get_procurement_cleanup', {}).then(function (res) {
            state.cleanup = res || null;
            renderCleanup();
        });
    }

    function confirmTruckCancel() {
        if (typeof Swal === 'undefined') return $.Deferred().resolve(window.confirm('Cancel this truck? It comes off the plan.')).promise();
        return Swal.fire({ title: 'Cancel this truck?', text: 'It comes off the plan.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Cancel truck', cancelButtonText: 'Keep it' })
            .then(function (r) { return !!r.isConfirmed; });
    }

    function cleanupCancel(id) {
        $.when(confirmTruckCancel()).then(function (yes) {
            if (!yes) return null;
            return dataFunctions.cancelProcurementDelivery(id).then(function (res) {
                if (!res || res.success === false) { toast(false, (res && res.error) || 'Could not cancel. Please try again.'); return null; }
                toast(true, 'Truck cancelled.');
                return load();
            });
        });
    }

    function markConfirmed(id) {
        dataFunctions._rpcWrite('set_procurement_confirmed', { p_id: id, p_is_confirmed: true }, null).then(function (res) {
            if (!res || res.success === false) { toast(false, (res && res.error) || 'Could not confirm. Please try again.'); return null; }
            toast(true, 'Truck confirmed.');
            return load();
        });
    }

    function bookIn(id) {
        if (typeof _appRouter !== 'undefined' && _appRouter.openWith) _appRouter.openWith('grower-intake-grid', { bookInProcurementId: id });
    }

    /** Router handoff: scroll to + highlight a truck, or the run-out tile. Runs once after the first render. */
    function applyHandoff() {
        var h = state.handoff;
        if (!h) return;
        state.handoff = null;
        setTimeout(function () {
            var node = null;
            if (h.focusProcurementId) {
                node = $('#ppTrucks [data-truck="' + String(h.focusProcurementId).replace(/[^0-9a-zA-Z-]/g, '') + '"]').get(0);
                if (node) $(node).addClass('pp-row-focus');
            } else if (h.section === 'runway') {
                node = document.getElementById('ppRunway');
                if (node) $(node).addClass('pp-tile-focus');
            }
            if (node && node.scrollIntoView) node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 150);
    }

    function renderChart(sim, weeks) {
        var $c = $('#ppChart').empty();
        if (!weeks.length) return;
        var X0 = 50, X1 = 990, n = weeks.length;
        var maxV = LOW_KG;
        sim.days.forEach(function (x) { if (x.close > maxV) maxV = x.close; if (x.open > maxV) maxV = x.open; });
        var top = Math.max(300000, Math.ceil(maxV / 100000) * 100000);
        var t0 = weeks[0].mon;
        var xAt = function (i) { return X0 + (X1 - X0) * i / Math.max(1, n); };
        var yAt = function (v) { return 200 - Math.max(0, v) / top * 180; };
        var dayX = function (k) { return X0 + (X1 - X0) * (diffDays(k, t0) / 7) / Math.max(1, n); };
        var f = function (v) { return v.toFixed(1); };

        var s = '';
        for (var v = 0; v <= top; v += 100000) {
            s += '<line class="' + (v === 0 ? 'pp-axis-line' : 'pp-grid-line') + '" x1="' + X0 + '" y1="' + f(yAt(v)) + '" x2="' + X1 + '" y2="' + f(yAt(v)) + '"></line>';
            s += '<text class="pp-axis-text" x="' + (X0 - 6) + '" y="' + f(yAt(v) + 4) + '" text-anchor="end">' + (v === 0 ? '0' : (v / 1000) + ' t') + '</text>';
        }
        s += '<line class="pp-low-line" x1="' + X0 + '" y1="' + f(yAt(LOW_KG)) + '" x2="' + X1 + '" y2="' + f(yAt(LOW_KG)) + '"></line>';

        // one grey band per run of consecutive shutdown days
        var run = null;
        var bands = [];
        sim.days.forEach(function (x) {
            if (x.type === 'shutdown') { if (!run) { run = { a: x.k, b: x.k }; bands.push(run); } run.b = x.k; } else run = null;
        });
        bands.forEach(function (b) {
            var x0 = Math.max(X0, dayX(b.a)), x1 = Math.min(X1, dayX(addDays(b.b, 1)));
            s += '<rect class="pp-shut" x="' + f(x0) + '" y="20" width="' + f(Math.max(0, x1 - x0)) + '" height="180"></rect>';
            s += '<text class="pp-shut-text" x="' + f((x0 + x1) / 2) + '" y="36" text-anchor="middle">Shutdown</text>';
        });

        var pts = [[xAt(0), yAt(weeks[0].open)]];
        weeks.forEach(function (w, i) { pts.push([xAt(i + 1), yAt(w.close)]); });
        s += '<polyline class="pp-line" points="' + pts.map(function (p) { return f(p[0]) + ',' + f(p[1]); }).join(' ') + '"></polyline>';

        sim.days.forEach(function (x) {
            if (x.dels.length) s += '<circle class="pp-dot" cx="' + f(dayX(x.k)) + '" cy="' + f(yAt(x.close)) + '" r="4.5"></circle>';
        });

        var last = sim.days[sim.days.length - 1].k;
        var m = parse(t0.slice(0, 7) + '-01');
        while (iso(m) <= last) {
            var mk = iso(m);
            s += '<text class="pp-axis-text" x="' + f(Math.max(X0, dayX(mk))) + '" y="222">' + MON[m.getUTCMonth()] + '</text>';
            m.setUTCMonth(m.getUTCMonth() + 1);
        }

        var aria = 'Nut in shell on hand by week, from ' + fmt(weeks[0].open / 1000) + ' tonnes' +
            (sim.runOut ? ', running out on ' + dLong(sim.runOut) : ', not running out in the forecast');
        $c.append($('<svg class="pp-svg" viewBox="0 0 1000 240" role="img" aria-label="' + esc(aria) + '">' + s + '</svg>'));
    }

    function dayNotes(w) {
        var shut = 0, nc = [], hol = 0;
        w.days.forEach(function (x) {
            if (x.type === 'shutdown') shut++;
            else if (x.type === 'nocrack') nc.push(x.k);
            else if (x.type === 'holiday') hol++;
        });
        var out = [];
        if (shut) out.push('Shutdown');
        if (nc.length) out.push('No cracking ' + (nc.length === 1 ? dShort(nc[0]) : parse(nc[0]).getUTCDate() + '–' + dShort(nc[nc.length - 1])));
        if (hol) out.push(hol > 1 ? 'Public holidays' : 'Public holiday');
        return out;
    }

    function coverText(close, rate) {
        if (close <= 0 || rate <= 0) return '–';
        var wk = Math.floor(close / (rate * 5));
        return wk < 1 ? 'under 1 wk' : wk + (wk === 1 ? ' wk' : ' wks');
    }

    function th(text, num) { return el('th', 'pp-th' + (num ? ' pp-num' : ''), text).attr('scope', 'col'); }

    function renderWeek(sim, weeks, today) {
        var $head = el('tr').append(th('Week'), th('Opening', 1), th('Trucks in'), th('Kg in', 1), th('Cracking days', 1), th('Kg used', 1), th('Closing', 1), th('Lasts', 1));
        var $body = el('tbody');
        weeks.forEach(function (w) {
            var now = today >= w.mon && today <= addDays(w.mon, 6);
            var crack = sim.rate > 0 ? Math.round(w.used / sim.rate * 10) / 10 : 0;
            var $chips = el('div', 'pp-chips');
            w.days.forEach(function (x) { appendChips($chips, x.dels, false, canEdit()); });
            dayNotes(w).forEach(function (t) { $chips.append(el('span', 'pp-daynote', t)); });
            var $wk = el('td', 'pp-td pp-nowrap').append(el('strong', '', 'Wk ' + isoWeek(w.mon)), document.createTextNode(' '), el('span', 'pp-muted', dShort(w.start) + '–' + dShort(w.end)));
            if (now) $wk.append(document.createTextNode(' '), el('span', 'pp-muted', '· this week'));
            $body.append(el('tr', now ? 'pp-row-now' : '').append(
                $wk,
                el('td', 'pp-td pp-num', fmt(w.open)),
                el('td', 'pp-td').append($chips),
                el('td', 'pp-td pp-num', w.inKg ? fmt(w.inKg) : '–'),
                el('td', 'pp-td pp-num', String(crack)),
                el('td', 'pp-td pp-num', fmt(w.used)),
                el('td', 'pp-td pp-num pp-close' + (w.close < LOW_KG ? ' pp-low' : ''), w.close > 0 ? fmt(w.close) : 'Out'),
                el('td', 'pp-td pp-num pp-muted', coverText(w.close, sim.rate))
            ));
        });
        return el('div', 'pp-table-wrap').append(el('table', 'pp-table').append(el('thead').append($head), $body));
    }

    function renderMonth(sim) {
        var $head = el('tr').append(th('Month'), th('Opening', 1), th('Trucks', 1), th('Kg in', 1), th('Kg used', 1), th('Closing', 1));
        var $body = el('tbody');
        monthRows(sim).forEach(function (m) {
            $body.append(el('tr').append(
                el('td', 'pp-td', LONG_MON[m.m] + ' ' + m.y).css('font-weight', 600),
                el('td', 'pp-td pp-num', fmt(m.open)),
                el('td', 'pp-td pp-num', String(m.n)),
                el('td', 'pp-td pp-num', m.inKg ? fmt(m.inKg) : '–'),
                el('td', 'pp-td pp-num', fmt(m.used)),
                el('td', 'pp-td pp-num pp-close' + (m.close < LOW_KG ? ' pp-low' : ''), m.close > 0 ? fmt(m.close) : 'Out')
            ));
        });
        return el('div', 'pp-table-wrap').append(el('table', 'pp-table pp-table-month').append(el('thead').append($head), $body));
    }

    function renderDay(sim, today) {
        var months = monthRows(sim);
        var keys = months.map(function (m) { return m.key; });
        var idx = keys.indexOf(state.monthKey);
        if (idx < 0) idx = Math.max(0, keys.indexOf(today.slice(0, 7)));
        state.monthKey = keys[idx];
        var m = months[idx];
        var byK = {};
        sim.days.forEach(function (x) { byK[x.k] = x; });
        var first = m.key + '-01';
        var nDays = new Date(Date.UTC(m.y, m.m + 1, 0)).getUTCDate();
        var lead = (dow(first) + 6) % 7;

        var $nav = el('div', 'pp-cal-nav').append(
            el('button', 'pp-nav-btn', '‹').attr({ type: 'button', id: 'ppPrevMonth', 'aria-label': 'Previous month' }).prop('disabled', idx === 0),
            el('div', 'pp-cal-title', LONG_MON[m.m] + ' ' + m.y),
            el('button', 'pp-nav-btn', '›').attr({ type: 'button', id: 'ppNextMonth', 'aria-label': 'Next month' }).prop('disabled', idx === months.length - 1)
        );
        var $grid = el('div', 'pp-cal');
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (d) { $grid.append(el('div', 'pp-dow', d)); });
        for (var i = 0; i < lead; i++) $grid.append(el('div', 'pp-cell pp-cell-blank'));
        var edit = canEdit();
        for (var dd = 1; dd <= nDays; dd++) {
            var k = m.key + '-' + (dd < 10 ? '0' : '') + dd;
            var x = byK[k];
            var muted = !x || (x.type !== 'work' && x.type !== 'half');
            var $cell = el('div', 'pp-cell' + (muted ? ' pp-cell-muted' : '') + (k === today ? ' pp-cell-today' : '') + (edit ? ' pp-cell-click' : '')).attr('data-day', k);
            var tag = '', tagCls = '';
            if (x) {
                if (x.type === 'work' && (x.wd === 6 || x.wd === 0)) { tag = 'Worked ' + WEEKDAY[x.wd]; tagCls = ' pp-tag-work'; }
                else if (DAY_TAGS[x.type]) { tag = DAY_TAGS[x.type]; tagCls = x.type === 'half' ? ' pp-tag-half' : ''; }
            }
            var $top = el('span', 'pp-day-num', String(dd));
            var $tag = tag ? el('span', 'pp-tag' + tagCls, tag) : null;
            if (edit) {
                $cell.append(el('button', 'pp-day-btn').attr({ type: 'button', 'data-day': k, 'aria-label': 'Set day ' + dShort(k) }).append($top, $tag));
            } else {
                $cell.append(el('div', 'pp-cell-top').append($top, $tag));
            }
            if (x) {
                $cell.append(el('div', 'pp-cell-soh', kgText(x.open)));
                var $chips = el('div', 'pp-chips');
                appendChips($chips, x.dels, true, edit);
                $cell.append($chips);
            }
            $grid.append($cell);
        }
        return el('div', 'pp-card').append($nav, el('div', 'pp-cal-scroll').append($grid),
            el('div', 'pp-hint', 'Each day shows the stock at the start of the day.' + (edit ? ' Click a day to change it to off, half day, shutdown or holiday.' : '')));
    }

    function render() {
        var plan = state.plan;
        if (!plan) return;
        if (state.rate === 'actual' && plan.actual_kg_per_day == null) state.rate = 'planned';
        var sim = simulate(plan, state.rate);
        state.sim = sim;
        var weeks = weekRows(sim);

        $('#ppRateSeg [data-rate]').each(function () {
            var r = $(this).data('rate');
            $(this).attr('aria-pressed', r === state.rate ? 'true' : 'false');
            if (r === 'actual') {
                var none = plan.actual_kg_per_day == null;
                $(this).prop('disabled', none).attr('title', none ? 'Not enough cracking recorded yet' : '');
            }
        });
        $('#ppViewSeg [data-view]').each(function () { $(this).attr('aria-pressed', $(this).data('view') === state.view ? 'true' : 'false'); });

        renderTiles(plan, sim);
        renderLate(plan);
        renderTrucks(plan);
        renderCleanup();
        renderChart(sim, weeks);
        var $v = $('#ppView').empty();
        if (state.view === 'day') $v.append(renderDay(sim, plan.today));
        else if (state.view === 'month') $v.append(renderMonth(sim));
        else $v.append(renderWeek(sim, weeks, plan.today));
    }

    function fillAreaFilter(plan) {
        var $s = $('#ppArea').empty().append($('<option>').val('').text('All areas'));
        (plan.areas || []).forEach(function (a) { $s.append($('<option>').val(a.code).text(a.label)); });
        $s.val(state.area);
        if ($s.val() == null) { state.area = ''; $s.val(''); }
    }

    // ------------------------------------------------------------------
    // Side panel.
    // ------------------------------------------------------------------

    function toast(ok, msg) {
        if (typeof _common === 'undefined') return;
        if (ok && _common.showSuccessToast) _common.showSuccessToast(msg);
        else if (!ok && _common.showErrorToast) _common.showErrorToast(msg);
    }

    function offcanvas() {
        var node = document.getElementById('ppPanel');
        return (node && window.bootstrap && window.bootstrap.Offcanvas) ? window.bootstrap.Offcanvas.getOrCreateInstance(node) : null;
    }

    function shortGrower(name) {
        return String(name || '')
            .replace(/\(\s*pty\s*\)/gi, ' ')
            .replace(/\b(pty|ltd|limited|cc|trust|bpk|edms)\b\.?/gi, ' ')
            .replace(/&\s*(seuns|sons|zonen)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .replace(/^[\s,.&-]+|[\s,.&-]+$/g, '');
    }

    function growerName() {
        var v = $('#ppGrower').val();
        if (v === '__other') return $.trim($('#ppOther').val());
        var g = (state.plan.growers || []).filter(function (x) { return String(x.id) === String(v); })[0];
        return g ? g.name : '';
    }

    function suggestName() {
        var short = shortGrower(growerName());
        if (!short) return '';
        var lc = short.toLowerCase(), max = 0;
        (state.plan.deliveries || []).forEach(function (d) {
            var l = String(d.truck_label || '');
            if (l.toLowerCase().indexOf(lc) !== 0) return;
            var m = /^\s*(\d+)\b/.exec(l.slice(short.length));
            if (m && +m[1] > max) max = +m[1];
        });
        return short + ' ' + (max + 1);
    }

    function refreshSuggestion() {
        if (!panel.nameTouched) $('#ppTruck').val(suggestName());
    }

    function setStatus(s) {
        panel.status = s;
        $('#ppStatusSeg [data-status]').each(function () { $(this).attr('aria-pressed', $(this).data('status') === s ? 'true' : 'false'); });
    }

    function paintAreas() {
        $('#ppAreas .pp-area').each(function () { $(this).toggleClass('pp-area-on', $(this).find('input').is(':checked')); });
    }

    function fillGrowerSelect(plan) {
        var $g = $('#ppGrower').empty().append($('<option>').val('').text('Choose a grower…'));
        (plan.growers || []).forEach(function (g) { $g.append($('<option>').val(g.id).text(g.name)); });
        $g.append($('<option>').val('__other').text('Other grower…'));
    }

    function fillAreaRadios(plan, code) {
        var $a = $('#ppAreas').empty();
        var areas = plan.areas || [];
        areas.forEach(function (a, i) {
            var on = code ? a.code === code : i === 0;
            var $in = $('<input type="radio" name="ppAreaRadio">').val(a.code).prop('checked', on);
            $a.append($('<label class="pp-area">').append($in, document.createTextNode(a.label)));
        });
        paintAreas();
    }

    function openDelivery(d, defaultDate) {
        var plan = state.plan;
        panel.id = d ? d.id : null;
        fillGrowerSelect(plan);
        fillAreaRadios(plan, d ? d.storage_area_code : null);
        $('#ppPanelTitle').text(d ? 'Edit truck' : 'Plan a delivery');
        $('#ppOther').val('');
        if (d) {
            var known = d.supplier_id && (plan.growers || []).some(function (g) { return String(g.id) === String(d.supplier_id); });
            if (known) $('#ppGrower').val(String(d.supplier_id));
            else { $('#ppGrower').val('__other'); $('#ppOther').val(d.grower_name || d.grower || ''); }
            $('#ppTruck').val(d.truck_label || '');
            $('#ppDate').val(d.scheduled_date);
            $('#ppWeight').val(_common.formatKg(d.predicted_weight_kg != null ? Number(d.predicted_weight_kg) : 30000));
            $('#ppNote').val(d.note || '');
            setStatus(d.status === 'confirmed' ? 'confirmed' : 'planned');
            panel.nameTouched = true;
        } else {
            $('#ppGrower').val('');
            $('#ppTruck').val('');
            $('#ppDate').val(defaultDate || plan.today);
            $('#ppWeight').val(_common.formatKg(30000));
            $('#ppNote').val('');
            setStatus('planned');
            panel.nameTouched = false;
        }
        $('#ppOtherWrap').prop('hidden', $('#ppGrower').val() !== '__other');
        $('#ppRepeat').val('0');
        $('#ppRepeatCount').val(4);
        $('#ppRepeatWrap').prop('hidden', !!d);
        $('#ppRepeatCountWrap').prop('hidden', true);
        $('#ppCancelTruck').prop('hidden', !d);
    }

    function openDayFields(k) {
        $('#ppDayFrom').val(k || state.plan.today);
        $('#ppDayTo').val('');
        $('#ppDayType').val('work');
        $('#ppDayKg').val('');
    }

    function openSettingsFields() {
        var st = state.plan.settings || {};
        var pool = state.plan.system_pool_kg;
        $('#ppSetRate').val(st.planned_kg_per_day != null ? _common.formatKg(st.planned_kg_per_day) : '');
        $('#ppOpenSystemText').text("Use the system's stock" + (pool != null ? ' (currently ' + kgText(pool) + ')' : ''));
        var manual = st.opening_mode === 'manual';
        $('input[name="ppOpen"][value="' + (manual ? 'manual' : 'system') + '"]').prop('checked', true);
        $('#ppSetKg').val(st.opening_kg != null ? _common.formatKg(st.opening_kg) : '');
        $('#ppSetAsOf').val(st.opening_as_of || state.plan.today);
        toggleManual();
    }

    function toggleManual() {
        var manual = $('input[name="ppOpen"]:checked').val() === 'manual';
        $('#ppManualWrap').find('input').prop('disabled', !manual);
    }

    function openPanel(section, opts) {
        if (!canEdit() || !state.plan) return;
        opts = opts || {};
        if (section === 'delivery') openDelivery(opts.delivery || null, opts.date);
        else openDelivery(null);
        openDayFields(opts.day);
        openSettingsFields();
        var oc = offcanvas();
        if (!oc) return;
        oc.show();
        var target = section === 'day' ? '#ppSecDay' : '#ppSecDelivery';
        setTimeout(function () {
            var n = document.querySelector(target);
            if (n && n.scrollIntoView) n.scrollIntoView({ block: 'start' });
        }, 200);
    }

    function closePanel() {
        var oc = offcanvas();
        if (oc) oc.hide();
    }

    function afterSave(res, okMsg) {
        if (!res || res.success === false) { toast(false, (res && res.error) || 'Could not save. Please try again.'); return $.Deferred().resolve(false).promise(); }
        toast(true, okMsg);
        closePanel();
        return load().then(function () { return true; });
    }

    function saveDelivery() {
        var date = $('#ppDate').val();
        var weight = _common.parseKg($('#ppWeight').val());
        var gv = $('#ppGrower').val();
        var other = gv === '__other';
        if (!gv) { toast(false, 'Choose a grower.'); return; }
        if (other && !growerName()) { toast(false, 'Type the grower name.'); return; }
        if (!date) { toast(false, 'Choose the planned date.'); return; }
        if (!(weight > 0)) { toast(false, 'Enter the planned weight in kg.'); return; }
        var repeat = parseInt($('#ppRepeat').val(), 10) || 0;
        var count = repeat ? parseInt($('#ppRepeatCount').val(), 10) : 0;
        if (repeat && !(count > 0)) { toast(false, 'Enter how many more trucks.'); return; }
        var $btn = $('#ppSaveDelivery').prop('disabled', true);
        dataFunctions.saveProcurementDelivery({
            id: panel.id,
            scheduledDate: date,
            predictedWeightKg: weight,
            supplierId: other ? null : gv,
            growerName: other ? growerName() : null,
            truckLabel: $.trim($('#ppTruck').val()),
            storageAreaCode: $('#ppAreas input:checked').val() || null,
            isConfirmed: panel.status === 'confirmed',
            note: $.trim($('#ppNote').val()),
            repeatEveryWeeks: repeat,
            repeatCount: count
        }).then(function (res) { return afterSave(res, panel.id ? 'Truck updated.' : 'Delivery planned.'); })
            .finally(function () { $btn.prop('disabled', false); });
    }

    function confirmCancel() {
        var text = 'Cancel this truck? It comes off the calendar.';
        if (typeof Swal === 'undefined') return $.Deferred().resolve(window.confirm(text)).promise();
        return Swal.fire({ title: 'Cancel this truck?', text: 'It comes off the calendar.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Cancel truck', cancelButtonText: 'Keep it' })
            .then(function (r) { return !!r.isConfirmed; });
    }

    function cancelTruck() {
        if (!panel.id) return;
        $.when(confirmCancel()).then(function (yes) {
            if (!yes) return null;
            return dataFunctions.cancelProcurementDelivery(panel.id).then(function (res) { return afterSave(res, 'Truck cancelled.'); });
        });
    }

    function saveDay() {
        var from = $('#ppDayFrom').val();
        var to = $('#ppDayTo').val() || from;
        if (!from) { toast(false, 'Choose a date.'); return; }
        if (to < from) { toast(false, 'The to date must not be before the from date.'); return; }
        var kgNum = _common.parseKg($('#ppDayKg').val());
        if ($('#ppDayKg').val().trim() !== '' && !(kgNum >= 0)) { toast(false, 'Kg cracked must be a number.'); return; }
        var kg = kgNum === null ? '' : String(kgNum);
        var $btn = $('#ppSaveDay').prop('disabled', true);
        dataFunctions.setProcurementDays(from, to, $('#ppDayType').val(), kg, null)
            .then(function (res) { return afterSave(res, 'Day saved.'); })
            .finally(function () { $btn.prop('disabled', false); });
    }

    function saveSettings() {
        var rate = _common.parseKg($('#ppSetRate').val());
        if (!(rate > 0)) { toast(false, 'Enter the planned kg per day.'); return; }
        var settings = { planned_kg_per_day: rate };
        var mode = $('input[name="ppOpen"]:checked').val() || 'system';
        settings.opening_mode = mode;
        if (mode === 'manual') {
            var kg = _common.parseKg($('#ppSetKg').val()), asOf = $('#ppSetAsOf').val();
            if (kg === null || !(kg >= 0)) { toast(false, 'Enter the kg you counted.'); return; }
            if (!asOf) { toast(false, 'Choose the date you counted on.'); return; }
            settings.opening_kg = kg;
            settings.opening_as_of = asOf;
        }
        var $btn = $('#ppSaveSettings').prop('disabled', true);
        dataFunctions.setProcurementPlanSettings(settings)
            .then(function (res) { return afterSave(res, 'Settings saved.'); })
            .finally(function () { $btn.prop('disabled', false); });
    }

    // ------------------------------------------------------------------
    // Load and wire up.
    // ------------------------------------------------------------------

    function load() {
        return $.Deferred(function (dfd) {
            dataFunctions.getProcurementPlan(null, null).then(function (plan) {
                $('#ppLoading').prop('hidden', true);
                if (!plan) {
                    state.plan = null;
                    $('#ppBody').prop('hidden', true);
                    $('#ppHeadActions').prop('hidden', true);
                    $('#ppUnavailable').prop('hidden', false);
                } else {
                    state.plan = plan;
                    $('#ppUnavailable').prop('hidden', true);
                    $('#ppBody').prop('hidden', false);
                    $('#ppHeadActions').prop('hidden', !canEdit());
                    fillAreaFilter(plan);
                    render();
                    loadCleanup();
                    applyHandoff();
                }
                dfd.resolve();
            }, function () {
                $('#ppLoading').prop('hidden', true);
                $('#ppUnavailable').prop('hidden', false);
                dfd.resolve();
            });
        }).promise();
    }

    function findDelivery(id) {
        var out = null;
        ((state.plan && state.plan.deliveries) || []).forEach(function (d) { if (String(d.id) === String(id)) out = d; });
        return out;
    }

    function bind() {
        var $m = $('#ppModule');
        $m.off(NS);
        $m.on('click' + NS, '#ppBtnPlan', function () { openPanel('delivery'); });
        $m.on('click' + NS, '#ppBtnDays', function () { openPanel('day'); });
        $m.on('click' + NS, '#ppViewSeg [data-view]', function () { state.view = $(this).data('view'); render(); });
        $m.on('click' + NS, '#ppRateSeg [data-rate]', function () { if (!this.disabled) { state.rate = $(this).data('rate'); render(); } });
        $m.on('change' + NS, '#ppArea', function () { state.area = $(this).val() || ''; render(); });
        $m.on('click' + NS, '#ppPrevMonth, #ppNextMonth', function () {
            var keys = monthRows(state.sim).map(function (x) { return x.key; });
            var i = keys.indexOf(state.monthKey) + (this.id === 'ppPrevMonth' ? -1 : 1);
            if (i >= 0 && i < keys.length) { state.monthKey = keys[i]; render(); }
        });
        $m.on('click' + NS, '.pp-chip-btn', function (e) {
            e.stopPropagation();
            var d = findDelivery($(this).data('id'));
            if (d) openPanel('delivery', { delivery: d });
        });
        $m.on('click' + NS, '[data-late]', function () {
            var d = findDelivery($(this).data('late'));
            if (d) openPanel('delivery', { delivery: d });
        });
        $m.on('click' + NS, '[data-bookin]', function () { bookIn($(this).data('bookin')); });
        $m.on('click' + NS, '[data-confirm]', function () { markConfirmed($(this).data('confirm')); });
        $m.on('click' + NS, '[data-cancel]', function () { cleanupCancel($(this).data('cancel')); });
        $m.on('click' + NS, '.pp-chip-toggle', function () {
            var k = $(this).data('list');
            state.openLists[k] = !state.openLists[k];
            renderCleanup();
        });
        $m.on('click' + NS, '.pp-cell-click', function (e) {
            if ($(e.target).closest('.pp-chip-btn').length) return;
            openPanel('day', { day: $(this).data('day') });
        });

        $m.on('change' + NS, '#ppGrower', function () {
            $('#ppOtherWrap').prop('hidden', $(this).val() !== '__other');
            refreshSuggestion();
        });
        $m.on('input' + NS, '#ppOther', refreshSuggestion);
        $m.on('input' + NS, '#ppTruck', function () { panel.nameTouched = true; });
        $m.on('change' + NS, '#ppRepeat', function () { $('#ppRepeatCountWrap').prop('hidden', $(this).val() === '0'); });
        $m.on('change' + NS, '#ppAreas input', paintAreas);
        $m.on('click' + NS, '#ppStatusSeg [data-status]', function () { setStatus($(this).data('status')); });
        $m.on('change' + NS, 'input[name="ppOpen"]', toggleManual);
        $m.on('click' + NS, '#ppSaveDelivery', saveDelivery);
        $m.on('click' + NS, '#ppCancelTruck', cancelTruck);
        $m.on('click' + NS, '#ppSaveDay', saveDay);
        $m.on('click' + NS, '#ppSaveSettings', saveSettings);
    }

    function init() {
        if (!$('#ppModule').length) return;
        // a previous visit may have left a backdrop behind
        $('.offcanvas-backdrop').remove();
        $('body').css({ overflow: '', paddingRight: '' });
        $('#ppHeadActions').prop('hidden', !canEdit());
        state.handoff = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('procurement-plan') : null;
        state.cleanup = null;
        state.openLists = {};
        bind();
        $('#ppLoading').prop('hidden', false);
        load();
    }

    return { init: init, _simulate: simulate };
})();
window._procurementPlan = _procurementPlan;
