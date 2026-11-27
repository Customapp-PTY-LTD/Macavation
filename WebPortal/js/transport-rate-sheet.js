/**
 * Transport rate sheet: the route picker that fills a delivery's transport cost from the rate sheet
 * (Mike's MacView, 27 Nov 2026; migration 20261127090000_transport_rate_sheet.sql).
 *
 * Used wherever a delivery's rate is typed today, so there is still ONE place per screen to type it:
 *   - My Day "Enter transport rate" task (workflow-views.js enterTransportRate)
 *   - Find a batch > Delivery > Edit (batch_journey_detail.js)
 *
 * Rules (same as the server, set_transport_rate_from_route):
 *   - the rate for transporter + route on the delivery's date: the current one (latest valid-from),
 *     else the most recent expired one, shown as expired;
 *   - picking a route fills the cost box when it is blank or still holds the last filled-in rate;
 *   - a cost more than R0.50 away from the sheet rate needs a reason.
 * When the migration is not on the database, load() gives null and the picker is not drawn, so the
 * screens behave exactly as before.
 *
 * Security: every DB string goes into the DOM through esc() or textContent.
 */
var TransportRateSheet = (function () {
    'use strict';

    var cache = null, cacheAt = 0, TTL_MS = 60000;

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml)
            ? _common.escapeHtml(v)
            : String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function money(n) {
        var x = Number(n);
        return isFinite(x) ? 'R ' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
    }

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    /** '2026-12-02' -> '2 Dec 2026' */
    function day(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        return m ? parseInt(m[3], 10) + ' ' + MONTHS[parseInt(m[2], 10) - 1] + ' ' + m[1] : '';
    }

    /** Today in SAST as YYYY-MM-DD. */
    function todayIso() {
        var d = new Date(Date.now() + 2 * 3600 * 1000);
        return d.toISOString().slice(0, 10);
    }

    /** Any date-ish value -> YYYY-MM-DD in SAST (timestamps are shifted to SAST first). */
    function isoDay(v) {
        if (!v) return todayIso();
        var s = String(v);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        var d = new Date(s);
        if (isNaN(d.getTime())) return todayIso();
        return new Date(d.getTime() + 2 * 3600 * 1000).toISOString().slice(0, 10);
    }

    function statusOn(rate, on) {
        if (rate.valid_from && rate.valid_from > on) return 'future';
        if (rate.valid_to && rate.valid_to < on) return 'expired';
        return 'current';
    }

    async function load(force) {
        if (!force && cache && Date.now() - cacheAt < TTL_MS) return cache;
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getTransportSheet) return null;
        var s = await dataFunctions.getTransportSheet();
        cache = s; cacheAt = Date.now();
        return s;
    }

    function clear() { cache = null; cacheAt = 0; }

    /** { rate, row, expired } for transporter + route on a day, or null. */
    function rateFor(sheet, transporterId, routeId, on) {
        if (!sheet || !transporterId || !routeId) return null;
        on = on || todayIso();
        var rs = (sheet.rates || []).filter(function (r) {
            return String(r.transporter_id) === String(transporterId) && String(r.route_id) === String(routeId) &&
                (!r.valid_from || r.valid_from <= on);
        });
        var cur = rs.filter(function (r) { return statusOn(r, on) === 'current'; })
            .sort(function (a, b) { return String(b.valid_from || '').localeCompare(String(a.valid_from || '')); })[0];
        if (cur) return { rate: Number(cur.rate_zar), row: cur, expired: false };
        var old = rs.sort(function (a, b) { return String(b.valid_to || '').localeCompare(String(a.valid_to || '')); })[0];
        return old ? { rate: Number(old.rate_zar), row: old, expired: true } : null;
    }

    /** The cheapest current rate on a route (any transporter), or null. */
    function cheapestOn(sheet, routeId, on) {
        if (!sheet || !routeId) return null;
        on = on || todayIso();
        return (sheet.rates || []).filter(function (r) {
            return String(r.route_id) === String(routeId) && statusOn(r, on) === 'current';
        }).sort(function (a, b) { return Number(a.rate_zar) - Number(b.rate_zar); })[0] || null;
    }

    function routeLabel(r) {
        return r.code + ' · ' + r.origin + ' → ' + (r.destination || '') + (r.km ? ' (' + r.km + ' km)' : '');
    }

    /**
     * Markup for the route box, the rate-sheet line and the reason box. prefix keeps ids unique.
     * Returns '' when there is no sheet or no route yet (nothing to pick).
     */
    function pickerHtml(prefix, sheet, routeId, reason) {
        if (!sheet) return '';
        var routes = (sheet.routes || []).filter(function (r) { return r.is_active || String(r.id) === String(routeId || ''); });
        if (!routes.length) return '';
        var opts = '<option value="">No route (once-off trip)</option>' + routes.map(function (r) {
            return '<option value="' + esc(r.id) + '"' + (String(r.id) === String(routeId || '') ? ' selected' : '') + '>' + esc(routeLabel(r)) + '</option>';
        }).join('');
        return '<div class="trs-picker text-start" id="' + prefix + 'Box">' +
            '<label for="' + prefix + 'Route" class="form-label fw-semibold">Route</label>' +
            '<select id="' + prefix + 'Route" class="form-select">' + opts + '</select>' +
            '<div class="small mt-1" id="' + prefix + 'Info" aria-live="polite"></div>' +
            '<div class="mt-2 d-none" id="' + prefix + 'ReasonBox">' +
            '<label for="' + prefix + 'Reason" class="form-label small fw-semibold mb-1">Why is the cost different from the rate sheet? <span class="text-danger">*</span></label>' +
            '<input type="text" id="' + prefix + 'Reason" class="form-control form-control-sm" maxlength="300" placeholder="e.g. fuel surcharge, extra drop" value="' + esc(reason || '') + '">' +
            '</div></div>';
    }

    /**
     * Wire the picker drawn by pickerHtml. opts: { prefix, sheet, rateInput (element),
     * transporterId: fn -> id, date: fn -> date-ish, transporterName: fn -> text }.
     * Returns { routeId(), reason(), sheetRate(), validate() -> message or null, refresh() }.
     */
    function wire(opts) {
        var p = opts.prefix;
        var sel = document.getElementById(p + 'Route');
        var info = document.getElementById(p + 'Info');
        var reasonBox = document.getElementById(p + 'ReasonBox');
        var reason = document.getElementById(p + 'Reason');
        var input = opts.rateInput;
        var autoValue = null;   // the value this picker last put in the cost box
        var current = null;     // rateFor(...) for the picked route

        function inputNum() {
            var raw = input ? String(input.value || '').trim() : '';
            if (raw === '') return null;
            var n = parseFloat(raw.replace(/,/g, ''));
            return isFinite(n) ? n : null;
        }

        function differs() {
            var n = inputNum();
            return !!(current && n != null && !(input && input.disabled) && Math.abs(n - current.rate) > 0.5);
        }

        function useRate() {
            if (!current || !input) return;
            input.value = String(current.rate);
            autoValue = input.value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        function draw() {
            if (!info) return;
            info.textContent = '';
            var routeId = sel ? sel.value : '';
            if (!routeId) { reasonBox.classList.add('d-none'); return; }
            var tid = opts.transporterId ? opts.transporterId() : null;
            var on = isoDay(opts.date ? opts.date() : null);
            var route = (opts.sheet.routes || []).filter(function (r) { return String(r.id) === String(routeId); })[0];
            var code = route ? route.code : '';
            var line = document.createElement('div');
            if (!tid) {
                line.className = 'text-muted';
                line.textContent = 'Pick the transporter to pull its rate.';
            } else if (current) {
                var strong = document.createElement('strong');
                strong.textContent = money(current.rate);
                line.appendChild(document.createTextNode('Rate sheet for ' + code + ': '));
                line.appendChild(strong);
                line.appendChild(document.createTextNode(' per load'));
                var when = document.createElement('span');
                if (current.expired) {
                    when.className = 'text-danger fw-semibold';
                    when.textContent = ' (expired ' + day(current.row.valid_to) + ')';
                } else {
                    when.className = 'text-muted';
                    when.textContent = current.row.valid_to ? ' · valid to ' + day(current.row.valid_to) : ' · no end date';
                }
                line.appendChild(when);
            } else {
                line.className = 'text-warning-emphasis';
                line.textContent = 'No rate on file for ' + ((opts.transporterName && opts.transporterName()) || 'this transporter') + ' on ' + code + '.';
            }
            info.appendChild(line);
            var ch = cheapestOn(opts.sheet, routeId, on);
            if (ch && (!current || Number(ch.rate_zar) < current.rate - 0.5)) {
                var hint = document.createElement('div');
                hint.className = 'text-muted';
                hint.textContent = 'Cheapest on this route: ' + (ch.transporter_name || '') + ' ' + money(ch.rate_zar);
                info.appendChild(hint);
            }
            if (differs()) {
                var diff = document.createElement('div');
                diff.className = 'text-danger';
                diff.textContent = 'Changed from the rate by ' + money(inputNum() - current.rate) + '. ';
                var back = document.createElement('button');
                back.type = 'button';
                back.className = 'btn btn-link btn-sm p-0 align-baseline';
                back.textContent = 'Back to the rate ' + money(current.rate);
                back.addEventListener('click', function () { useRate(); draw(); });
                diff.appendChild(back);
                info.appendChild(diff);
                reasonBox.classList.remove('d-none');
            } else {
                reasonBox.classList.add('d-none');
            }
        }

        function pick(fill) {
            var routeId = sel ? sel.value : '';
            var tid = opts.transporterId ? opts.transporterId() : null;
            current = routeId ? rateFor(opts.sheet, tid, routeId, isoDay(opts.date ? opts.date() : null)) : null;
            if (fill && current && input && !input.disabled) {
                var v = String(input.value || '').trim();
                if (v === '' || v === autoValue) useRate();
            }
            draw();
        }

        if (sel) sel.addEventListener('change', function () { pick(true); });
        if (input) input.addEventListener('input', draw);
        // A delivery saved before routes existed: fill on first pick only; one with a route keeps its cost.
        pick(false);

        return {
            routeId: function () { return sel && sel.value ? sel.value : null; },
            reason: function () { return reason && differs() ? String(reason.value || '').trim() : null; },
            sheetRate: function () { return current ? current.rate : null; },
            validate: function () {
                if (differs() && !String(reason.value || '').trim()) return 'Say why the cost is different from the rate sheet (' + money(current.rate) + ').';
                return null;
            },
            refresh: function () { pick(true); },
            redraw: function () { pick(false); }
        };
    }

    return {
        load: load, clear: clear, rateFor: rateFor, cheapestOn: cheapestOn, statusOn: statusOn,
        pickerHtml: pickerHtml, wire: wire, money: money, day: day, todayIso: todayIso, routeLabel: routeLabel
    };
})();
