/*
 * MacPeriodPicker — the period selector for every screen that reports by week or month.
 *
 * Why this exists: four fields used to ask for a period type and then hand you a day-by-day
 * calendar, even though the database throws the day away. report_normalise_period_start
 * (migrations/20260817090000_report_builder_foundations.sql:92-102) snaps any date to the Monday
 * of its week, or the 1st of its month — so 3, 17 and 31 August all produced the identical
 * August period. The calendar asked for 31x more precision than anything used, showed no
 * confirmation of which period had actually been chosen, had no upper bound (a date in 2031 was
 * accepted), and named the period only in the duplicate error afterwards.
 *
 * This offers the periods themselves — named months, or weeks by their Monday — and mirrors the
 * three SQL period functions exactly:
 *   report_week_start              -> weekStart()   (Monday = ISODOW 1)
 *   report_normalise_period_start  -> normalise()
 *   report_period_end              -> periodEnd()
 * Those SQL functions stay authoritative: every value here is passed back to them for the real
 * snap, so a drift between the two shows up as a different label, never as a wrong period.
 * The FY suffix on a monthly label is deliberately NOT duplicated here — report_period_label
 * owns it, and a second copy of report_fy_of_date in JS would be a second thing to keep true.
 *
 * All arithmetic runs in UTC and is read back with getUTC* — no value passes through a local-time
 * conversion, so a browser in a different timezone to SAST cannot shift a month or week
 * boundary. The anchor (which period is "current") comes from get_report_current_period, which is
 * SAST-correct as of migrations/20260825091000_daily_production_report.sql:508; the browser clock
 * is only a fallback for when that RPC is unreachable.
 *
 * Usage:
 *   MacPeriodPicker.fill(document.getElementById('sel'), {
 *       periodType: 'monthly',        // 'weekly' | 'monthly'
 *       anchorIso:  '2026-09-01',     // period_start of the current period, from the DB
 *       count:      24,               // how many periods to offer, current first
 *       taken:      ['2026-08-01'],   // period starts to disable
 *       takenSuffix: ' - already created',
 *       selectedIso: '2026-09-01',    // optional; defaults to the newest selectable period
 *       ensureIso:  '2024-03-01'      // optional; extend the list back far enough to include it
 *   });
 *   MacPeriodPicker.rangeText('monthly', '2026-08-01')  -> '1 - 31 August 2026'
 */
(function (w) {
    'use strict';

    var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
    var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var EN_DASH = '–';

    // Defaults: two financial years of months, six months of weeks. Both comfortably inside
    // list_report_instances' server-side cap of 100 rows, which is ordered period_start DESC —
    // so the newest 100 reports are exactly the ones that could collide with these options.
    var DEFAULT_COUNT = { monthly: 24, weekly: 26 };

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function isIso(value) {
        return typeof value === 'string' && ISO_RE.test(value);
    }

    function toUtc(iso) {
        var p = iso.split('-');
        return new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    }

    function fromUtc(d) {
        return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
    }

    function addDays(iso, n) {
        var d = toUtc(iso);
        d.setUTCDate(d.getUTCDate() + n);
        return fromUtc(d);
    }

    // Component arithmetic, not Date arithmetic: a period start is always day 1, so there is no
    // end-of-month day to clamp and no chance of the 31st rolling into the following month.
    function addMonths(iso, n) {
        var p = iso.split('-');
        var total = Number(p[0]) * 12 + (Number(p[1]) - 1) + n;
        return Math.floor(total / 12) + '-' + pad2((total % 12) + 1) + '-01';
    }

    // Mirrors report_week_start: subtract (ISODOW - 1) days. getUTCDay() is 0 = Sunday, so Sunday
    // is ISODOW 7 and moves back 6 days to the Monday that began its week.
    function weekStart(iso) {
        var isoDow = toUtc(iso).getUTCDay() || 7;
        return addDays(iso, -(isoDow - 1));
    }

    function monthStart(iso) {
        return iso.slice(0, 7) + '-01';
    }

    // Mirrors report_normalise_period_start, including its deliberate NULL for an unknown type:
    // callers fail loudly rather than silently filing against the wrong period.
    function normalise(periodType, iso) {
        if (!isIso(iso)) return null;
        if (periodType === 'weekly') return weekStart(iso);
        if (periodType === 'monthly') return monthStart(iso);
        return null;
    }

    // Mirrors report_period_end: weekly = Monday + 6, monthly = last day of the month.
    function periodEnd(periodType, periodStartIso) {
        var start = normalise(periodType, periodStartIso);
        if (!start) return null;
        if (periodType === 'weekly') return addDays(start, 6);
        return addDays(addMonths(start, 1), -1);
    }

    function dayOf(iso) {
        return String(Number(iso.slice(8, 10)));
    }

    function monthNameOf(iso) {
        return MONTHS[Number(iso.slice(5, 7)) - 1];
    }

    function monthShortOf(iso) {
        return MONTHS_SHORT[Number(iso.slice(5, 7)) - 1];
    }

    function yearOf(iso) {
        return iso.slice(0, 4);
    }

    // The option text. Monthly is the plain month name; weekly mirrors report_period_label's
    // 'Week of FMDD Mon YYYY' so the dropdown and the created report read the same. Neither
    // duplicates the FY suffix — see the header note.
    function label(periodType, periodStartIso) {
        var start = normalise(periodType, periodStartIso);
        if (!start) return '';
        if (periodType === 'weekly') {
            return 'Week of ' + dayOf(start) + ' ' + monthShortOf(start) + ' ' + yearOf(start);
        }
        return monthNameOf(start) + ' ' + yearOf(start);
    }

    // The confirmation line under the select: the exact days the period covers, so the choice is
    // visible BEFORE anything is created rather than in the duplicate error after it.
    function rangeText(periodType, periodStartIso) {
        var start = normalise(periodType, periodStartIso);
        if (!start) return '';
        var end = periodEnd(periodType, start);
        if (periodType === 'monthly') {
            // Same month and year at both ends — say each only once.
            return dayOf(start) + ' ' + EN_DASH + ' ' + dayOf(end) + ' ' +
                   monthNameOf(start) + ' ' + yearOf(start);
        }
        // A week can straddle both a month end and a year end; name the year twice only then.
        var text = dayOf(start) + ' ' + monthShortOf(start);
        if (yearOf(start) !== yearOf(end)) text += ' ' + yearOf(start);
        return text + ' ' + EN_DASH + ' ' + dayOf(end) + ' ' + monthShortOf(end) + ' ' + yearOf(end);
    }

    // Fallback anchor for when get_report_current_period is unreachable. Uses the browser's own
    // calendar date — which can be a day out from SAST, and therefore a period out at a boundary.
    // That is why it is the fallback and not the source: it keeps the dropdown usable when the
    // RPC fails, instead of leaving the screen with no periods at all.
    function todayAnchor(periodType) {
        var now = new Date();
        var localIso = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
        return normalise(periodType, localIso);
    }

    // Period starts from the current one backwards. Newest first, so the period you almost always
    // want is the default; nothing beyond the current period is offered at all, which is what
    // closes the old calendar's "any date, any year" hole.
    function periodStarts(periodType, anchorIso, count) {
        var start = normalise(periodType, anchorIso);
        if (!start) return [];
        var n = Number(count) > 0 ? Math.floor(Number(count)) : (DEFAULT_COUNT[periodType] || 12);
        var out = [];
        for (var i = 0; i < n; i++) {
            out.push(start);
            start = periodType === 'weekly' ? addDays(start, -7) : addMonths(start, -1);
        }
        return out;
    }

    // How many periods back from anchorIso targetIso sits: 0 = the anchor itself, -1 = not
    // reachable going backwards (i.e. it is in the future relative to the anchor). Bounded so a
    // target decades away cannot spin: MAX_REACH is well past any period this business reports on.
    var MAX_REACH = 600;

    function periodsBack(periodType, anchorIso, targetIso) {
        var cursor = normalise(periodType, anchorIso);
        var target = normalise(periodType, targetIso);
        if (!cursor || !target) return -1;
        for (var i = 0; i <= MAX_REACH; i++) {
            if (cursor === target) return i;
            if (cursor < target) return -1; // walked past it: the target is newer than the anchor
            cursor = periodType === 'weekly' ? addDays(cursor, -7) : addMonths(cursor, -1);
        }
        return -1;
    }

    /**
     * Repopulate a <select> with the periods for periodType. Returns the ISO period start left
     * selected, or '' when there is nothing selectable.
     *
     * Option text is set with textContent and the value with setAttribute — never innerHTML — so
     * a label can never carry markup into the DOM.
     */
    function fill(selectEl, opts) {
        if (!selectEl) return '';
        var o = opts || {};
        var periodType = o.periodType === 'monthly' ? 'monthly' : 'weekly';
        var anchor = normalise(periodType, o.anchorIso) || todayAnchor(periodType);
        var count = o.count;

        // ensureIso keeps the list REACHING BACK to a period rather than re-anchoring on it.
        // Re-anchoring would drop every period newer than the target, which on a screen with
        // prev/next navigation is a trap: walk back past the window and there is no longer a way
        // forward in the dropdown. Extending the count instead keeps the recent periods listed.
        var reach = o.ensureIso ? periodsBack(periodType, anchor, o.ensureIso) : -1;
        if (reach >= 0) {
            var needed = reach + 1;
            var have = Number(count) > 0 ? Math.floor(Number(count)) : (DEFAULT_COUNT[periodType] || 12);
            count = Math.max(have, needed);
        }

        var starts = periodStarts(periodType, anchor, count);
        var taken = {};
        (Array.isArray(o.taken) ? o.taken : []).forEach(function (iso) {
            var snapped = normalise(periodType, typeof iso === 'string' ? iso.slice(0, 10) : '');
            if (snapped) taken[snapped] = true;
        });
        var suffix = typeof o.takenSuffix === 'string' ? o.takenSuffix : '';

        while (selectEl.firstChild) selectEl.removeChild(selectEl.firstChild);

        if (!starts.length) {
            var empty = document.createElement('option');
            empty.setAttribute('value', '');
            empty.textContent = 'No periods available';
            selectEl.appendChild(empty);
            selectEl.value = '';
            return '';
        }

        var firstSelectable = '';
        starts.forEach(function (iso) {
            var opt = document.createElement('option');
            opt.setAttribute('value', iso);
            opt.textContent = label(periodType, iso) + (taken[iso] ? suffix : '');
            if (taken[iso]) opt.disabled = true;
            else if (!firstSelectable) firstSelectable = iso;
            selectEl.appendChild(opt);
        });

        // Honour an explicit request only when it is actually selectable; otherwise fall back to
        // the newest period with nothing against it, so the screen never opens on a dead option.
        var wanted = normalise(periodType, o.selectedIso);
        var chosen = (wanted && !taken[wanted] && starts.indexOf(wanted) > -1) ? wanted : firstSelectable;
        selectEl.value = chosen || '';
        return selectEl.value;
    }

    w.MacPeriodPicker = {
        fill: fill,
        label: label,
        rangeText: rangeText,
        normalise: normalise,
        periodEnd: periodEnd,
        periodStarts: periodStarts,
        periodsBack: periodsBack,
        todayAnchor: todayAnchor,
        weekStart: weekStart,
        isIso: isIso
    };
})(typeof window !== 'undefined' ? window : this);
