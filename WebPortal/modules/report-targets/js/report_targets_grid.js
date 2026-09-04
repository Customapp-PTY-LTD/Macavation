/**
 * Targets — the merged screen replacing Dashboard Targets and Report Targets.
 *
 * Shape: metrics down the side, periods across the top, one financial year (Apr-Mar) at a time.
 * Monthly shows all 12 months; weekly pages through the year 13 weeks at a time, because 52
 * columns is not a usable grid.
 *
 * Each cell carries two numbers:
 *   - the target, editable inline, saved via upsert_report_period_target
 *   - the same period a year earlier, faint underneath
 *
 * The earlier figure is what replaced the old "Prior periods" tab. get_report_targets_grid says
 * where it came from via prior_source:
 *   'actual' - a published report instance. Read-only here; the report is the record.
 *   'manual' - someone typed it in. Editable, so a typo can be corrected.
 *    NULL    - nothing recorded. Click to type one in; that writes a manual baseline for the
 *              PRIOR period, using prior_period_start straight from the RPC rather than
 *              recomputing the date in JS (a weekly period is 364 days back, not a calendar
 *              year, and having two places compute that is how they drift apart).
 *
 * Security invariant carried over from the previous version of this screen: metric_key is never
 * typed. It only ever comes from the RPC's own rows, and every value rendered into HTML goes
 * through esc().
 */
var _reportTargetsGrid = (function () {
    'use strict';

    var WEEKS_PER_PAGE = 13;

    var state = {
        periodType: 'monthly',
        fy: null,
        sectionFilter: '',
        rows: [],
        periods: [],       // ordered distinct period_start strings for the current period type
        metrics: [],       // ordered metric descriptors, section grouped
        cells: {},         // metric_key -> period_start -> row
        weekPage: 0
    };

    // ------------------------------------------------------------------
    // Helpers.
    // ------------------------------------------------------------------

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml)
            ? _common.escapeHtml(v)
            : String(v == null ? '' : v);
    }

    function firstRpcRow(result) {
        return Array.isArray(result) ? (result[0] || null)
            : (result && typeof result === 'object' ? result : null);
    }

    function isSuccess(result) {
        var row = firstRpcRow(result);
        return !!(row && Number(row.success) === 1);
    }

    function rpcErrorMessage(result, fallback) {
        var row = firstRpcRow(result);
        return (row && row.error) ? row.error : fallback;
    }

    function canEdit() {
        return typeof hasAction === 'function' && hasAction('reports.target.edit');
    }

    function toast(msg, type) {
        if (typeof _common !== 'undefined' && _common.showToastMessage) {
            _common.showToastMessage(msg, type || 'info');
        } else if (typeof Swal !== 'undefined') {
            Swal.fire({ icon: type === 'error' ? 'error' : 'success', text: msg });
        }
    }

    function isoDate(v) {
        return String(v == null ? '' : v).slice(0, 10);
    }

    // Financial year ending, April-March. Mirrors report_fy_of_date exactly.
    function fyOfToday() {
        var now = new Date();
        return now.getFullYear() + (now.getMonth() + 1 >= 4 ? 1 : 0);
    }

    function formatNumber(value, unit) {
        if (value === null || value === undefined || value === '') return '';
        var n = Number(value);
        if (!Number.isFinite(n)) return '';
        var digits = (unit === 'pct') ? 1 : 0;
        try {
            return n.toLocaleString(undefined, {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            });
        } catch (e) {
            return String(n.toFixed(digits));
        }
    }

    function shortPeriodHeader(row) {
        var iso = isoDate(row.period_start);
        var parts = iso.split('-');
        if (parts.length !== 3) return esc(iso);
        var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        var mon = monthNames[parseInt(parts[1], 10) - 1] || parts[1];
        if (state.periodType === 'monthly') return mon;
        return parts[2] + ' ' + mon;
    }

    // ------------------------------------------------------------------
    // Filter controls.
    // ------------------------------------------------------------------

    function populateFyOptions() {
        var $sel = $('#targetsFy');
        if (!$sel.length || $sel.children().length) return;
        var current = fyOfToday();
        var html = '';
        for (var y = current + 1; y >= current - 3; y--) {
            html += '<option value="' + y + '"' + (y === current ? ' selected' : '') + '>' +
                'FYE ' + y + ' — Apr ' + (y - 1) + ' to Mar ' + y + '</option>';
        }
        $sel.html(html);
        state.fy = current;
    }

    function populateSectionOptions() {
        var $sel = $('#targetsSection');
        if (!$sel.length) return;
        var seen = {};
        var opts = ['<option value="">All sections</option>'];
        state.rows.forEach(function (r) {
            if (seen[r.section_key]) return;
            seen[r.section_key] = true;
            opts.push('<option value="' + esc(r.section_key) + '"' +
                (state.sectionFilter === r.section_key ? ' selected' : '') + '>' +
                esc(r.section_label || r.section_key) + '</option>');
        });
        $sel.html(opts.join(''));
    }

    // ------------------------------------------------------------------
    // Shaping the flat RPC result into a grid.
    // ------------------------------------------------------------------

    function indexRows(rows) {
        var periodSeen = {};
        var metricSeen = {};
        state.periods = [];
        state.metrics = [];
        state.cells = {};

        rows.forEach(function (r) {
            var period = isoDate(r.period_start);
            var key = r.metric_key;

            if (!periodSeen[period]) {
                periodSeen[period] = true;
                state.periods.push({ period_start: period, period_label: r.period_label });
            }
            if (!metricSeen[key]) {
                metricSeen[key] = true;
                state.metrics.push({
                    metric_key: key,
                    admin_label: r.admin_label,
                    report_label: r.report_label,
                    section_key: r.section_key,
                    section_label: r.section_label,
                    unit: r.unit,
                    display_order: r.display_order
                });
            }
            if (!state.cells[key]) state.cells[key] = {};
            state.cells[key][period] = r;
        });

        state.periods.sort(function (a, b) {
            return a.period_start < b.period_start ? -1 : (a.period_start > b.period_start ? 1 : 0);
        });
    }

    function visiblePeriods() {
        if (state.periodType === 'monthly') return state.periods;
        var start = state.weekPage * WEEKS_PER_PAGE;
        return state.periods.slice(start, start + WEEKS_PER_PAGE);
    }

    function visibleMetrics() {
        if (!state.sectionFilter) return state.metrics;
        return state.metrics.filter(function (m) { return m.section_key === state.sectionFilter; });
    }

    function maxWeekPage() {
        return Math.max(0, Math.ceil(state.periods.length / WEEKS_PER_PAGE) - 1);
    }

    // ------------------------------------------------------------------
    // Rendering.
    // ------------------------------------------------------------------

    function renderHead(periods) {
        var html = '<th class="targets-metric-col">Metric</th>';
        periods.forEach(function (p) {
            var row = { period_start: p.period_start };
            html += '<th class="targets-cell-head" title="' + esc(p.period_label || '') + '">' +
                esc(shortPeriodHeader(row)) + '</th>';
        });
        $('#targetsGridHeadRow').html(html);
    }

    function cellHtml(cell, metric, editable) {
        if (!cell) return '<td class="targets-cell"></td>';

        var hasTarget = cell.target_value !== null && cell.target_value !== undefined;
        var hasPrior = cell.prior_value !== null && cell.prior_value !== undefined;
        var emptyClass = (!hasTarget && !hasPrior) ? ' is-empty' : '';

        var input = '<input type="number" step="any" min="0" class="targets-target-input js-target"' +
            ' value="' + (hasTarget ? esc(cell.target_value) : '') + '"' +
            ' aria-label="Target"' +
            (editable ? '' : ' disabled') + '>';

        // 'actual' comes from a published report and is the record — not editable here.
        var priorLocked = cell.prior_source === 'actual';
        var priorClass = 'targets-prior' + (editable && !priorLocked ? ' is-editable js-prior' : '');
        var priorText = hasPrior ? formatNumber(cell.prior_value, metric.unit) : '–';
        var priorTitle = priorLocked
            ? 'From a published report for ' + isoDate(cell.prior_period_start) + ' — not editable here'
            : (hasPrior ? 'Entered by hand for ' + isoDate(cell.prior_period_start) + ' — click to change'
                        : 'Nothing recorded for ' + isoDate(cell.prior_period_start) + ' — click to add');

        var prior = '<span class="' + priorClass + '" title="' + esc(priorTitle) + '">' +
            (priorLocked ? '<i class="fas fa-lock me-1" aria-hidden="true"></i>' : '') +
            esc(priorText) + '</span>';

        return '<td class="targets-cell' + emptyClass + '"' +
            ' data-metric-key="' + esc(cell.metric_key) + '"' +
            ' data-period-start="' + esc(isoDate(cell.period_start)) + '"' +
            ' data-prior-start="' + esc(isoDate(cell.prior_period_start)) + '"' +
            ' data-prior-source="' + esc(cell.prior_source || '') + '"' +
            ' data-unit="' + esc(metric.unit || '') + '">' +
            input + prior + '</td>';
    }

    function renderBody() {
        var $tbody = $('#reportTargetsTableBody');
        var periods = visiblePeriods();
        var metrics = visibleMetrics();
        var colspan = periods.length + 1;

        if (!metrics.length || !periods.length) {
            $tbody.html('<tr><td colspan="' + colspan + '">' +
                macEmptyState('fa-bullseye', 'Nothing to show',
                    'No targetable metrics for this financial year and period type.') +
                '</td></tr>');
            return;
        }

        var editable = canEdit();
        var html = '';
        var lastSection = null;

        metrics.forEach(function (m) {
            if (m.section_key !== lastSection) {
                lastSection = m.section_key;
                html += '<tr class="targets-section-row">' +
                    '<td class="targets-section-cell" colspan="' + colspan + '">' +
                    esc(m.section_label || m.section_key) + '</td></tr>';
            }

            var differs = m.report_label && m.report_label !== m.admin_label;
            html += '<tr data-metric-key="' + esc(m.metric_key) + '">' +
                '<td class="targets-metric-col">' +
                    '<div class="targets-metric-name">' + esc(m.admin_label) + '</div>' +
                    '<div class="targets-metric-sub">' + esc(m.metric_key) +
                        (differs ? ' · prints as “' + esc(m.report_label) + '”' : '') +
                    '</div>' +
                    (editable
                        ? '<button type="button" class="targets-fill-right js-fill-right"' +
                          ' title="Copy the first value in this row across the rest of the year">' +
                          '<i class="fas fa-arrow-right-long"></i> fill right</button>'
                        : '') +
                '</td>';

            periods.forEach(function (p) {
                var cell = (state.cells[m.metric_key] || {})[p.period_start];
                html += cellHtml(cell, m, editable);
            });

            html += '</tr>';
        });

        $tbody.html(html);
    }

    function renderWeeklyPager() {
        var $pager = $('#weeklyPager');
        if (state.periodType !== 'weekly') {
            $pager.addClass('d-none');
            return;
        }
        $pager.removeClass('d-none');
        var periods = visiblePeriods();
        var label = periods.length
            ? isoDate(periods[0].period_start) + ' → ' + isoDate(periods[periods.length - 1].period_start)
            : '—';
        $('#weeksRangeLabel').text(label);
        $('#weeksPrevBtn').prop('disabled', state.weekPage <= 0);
        $('#weeksNextBtn').prop('disabled', state.weekPage >= maxWeekPage());
    }

    // Give the grid box a real height, measured rather than guessed.
    //
    // The sticky month header pins to its nearest SCROLLING ancestor. If the grid box is taller
    // than the space it has, it never scrolls itself — the page scrolls instead, carrying the whole
    // card and its header off the top of the screen. So the box has to be shorter than the room
    // below it, and a CSS guess like calc(100vh - 260px) is only right for one page layout.
    //
    // getBoundingClientRect().top is the actual distance from the top of the window to the top of
    // the grid, whatever sits above it (title, tabs, filter card, a wrapped toolbar). Sizing
    // against that is correct on any screen and after any resize.
    function sizeGridViewport() {
        var el = document.querySelector('.targets-grid-scroll');
        if (!el) return;
        var top = el.getBoundingClientRect().top;
        // Leave a gutter so the legend under the grid is reachable without a fight.
        var available = window.innerHeight - top - 90;
        el.style.height = Math.max(300, available) + 'px';
    }

    function render() {
        renderHead(visiblePeriods());
        renderBody();
        renderWeeklyPager();
        sizeGridViewport();
    }

    // ------------------------------------------------------------------
    // Loading.
    // ------------------------------------------------------------------

    function load(forceRefresh) {
        var $tbody = $('#reportTargetsTableBody');
        $tbody.html(macLoadingRow(13, 'Loading targets…'));

        return dataFunctions.getReportTargetsGrid(state.periodType, state.fy, null, !!forceRefresh)
            .then(function (result) {
                var rows = Array.isArray(result) ? result : (result ? [result] : []);
                state.rows = rows;
                indexRows(rows);
                if (state.weekPage > maxWeekPage()) state.weekPage = maxWeekPage();
                populateSectionOptions();
                render();
            })
            .catch(function (err) {
                console.warn('[targets] getReportTargetsGrid failed', err);
                state.rows = [];
                state.periods = [];
                state.metrics = [];
                state.cells = {};
                $('#targetsGridHeadRow').html('<th class="targets-metric-col">Metric</th>');
                $tbody.html('<tr><td>' +
                    macEmptyState('fa-bullseye', 'Targets are not available yet',
                        'The targets migration has not been applied to this database.') +
                    '</td></tr>');
            });
    }

    // Default the weekly view to the page containing today, not the start of the year.
    function jumpWeekPageToToday() {
        if (state.periodType !== 'weekly' || !state.periods.length) return;
        var today = new Date().toISOString().slice(0, 10);
        var idx = 0;
        for (var i = 0; i < state.periods.length; i++) {
            if (state.periods[i].period_start <= today) idx = i;
        }
        state.weekPage = Math.floor(idx / WEEKS_PER_PAGE);
    }

    // ------------------------------------------------------------------
    // Saving.
    // ------------------------------------------------------------------

    function saveTarget($input) {
        var $cell = $input.closest('td');
        var metricKey = $cell.data('metric-key');
        var periodStart = $cell.data('period-start');
        var raw = String($input.val() == null ? '' : $input.val()).trim();

        if (!metricKey || !periodStart) return;
        if (raw === '') return;                       // clearing is not a delete; leave as-is
        if (!Number.isFinite(Number(raw)) || Number(raw) < 0) {
            toast('Target must be a number of zero or more.', 'error');
            return;
        }

        var cached = (state.cells[metricKey] || {})[periodStart];
        if (cached && Number(cached.target_value) === Number(raw)) return;   // nothing changed

        $input.addClass('is-saving').prop('disabled', true);
        dataFunctions.upsertReportPeriodTarget(String(metricKey), state.periodType,
                                               String(periodStart), Number(raw), null)
            .then(function (result) {
                if (isSuccess(result)) {
                    if (cached) cached.target_value = Number(raw);
                    $input.addClass('is-saved');
                    window.setTimeout(function () { $input.removeClass('is-saved'); }, 1200);
                } else {
                    toast(rpcErrorMessage(result, 'Could not save the target.'), 'error');
                }
            })
            .catch(function (err) {
                console.warn('[targets] upsertReportPeriodTarget failed', err);
                toast('Could not save the target. The targets migration may not be applied yet.', 'error');
            })
            .finally(function () {
                $input.removeClass('is-saving').prop('disabled', false);
            });
    }

    function savePrior($cell, value) {
        var metricKey = $cell.data('metric-key');
        var priorStart = $cell.data('prior-start');
        if (!metricKey || !priorStart) return;

        dataFunctions.upsertReportManualBaseline(String(metricKey), state.periodType,
                                                 String(priorStart), Number(value), null)
            .then(function (result) {
                if (isSuccess(result)) {
                    var periodStart = $cell.data('period-start');
                    var cached = (state.cells[metricKey] || {})[periodStart];
                    if (cached) {
                        cached.prior_value = Number(value);
                        cached.prior_source = 'manual';
                    }
                    render();
                } else {
                    toast(rpcErrorMessage(result, 'Could not save last year’s figure.'), 'error');
                    render();
                }
            })
            .catch(function (err) {
                console.warn('[targets] upsertReportManualBaseline failed', err);
                toast('Could not save last year’s figure.', 'error');
                render();
            });
    }

    function beginPriorEdit($span) {
        var $cell = $span.closest('td');
        var periodStart = $cell.data('period-start');
        var metricKey = $cell.data('metric-key');
        var cached = (state.cells[metricKey] || {})[periodStart];
        var current = (cached && cached.prior_value !== null && cached.prior_value !== undefined)
            ? cached.prior_value : '';

        var $input = $('<input type="number" step="any" class="targets-prior-input">')
            .val(current)
            .attr('aria-label', 'Figure for the same period last year');

        $span.replaceWith($input);
        $input.trigger('focus').trigger('select');

        var done = false;
        function commit(save) {
            if (done) return;
            done = true;
            var raw = String($input.val() == null ? '' : $input.val()).trim();
            if (save && raw !== '' && Number.isFinite(Number(raw))) {
                savePrior($cell, Number(raw));
            } else {
                render();
            }
        }

        $input.on('blur', function () { commit(true); });
        $input.on('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); commit(true); }
            else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        });
    }

    // Copy the first value in a row rightwards over every later period that has no target yet.
    // Deliberately does not overwrite a period that already has one — filling right should never
    // silently wipe a number somebody set on purpose.
    function fillRight($row) {
        var metricKey = $row.data('metric-key');
        var periods = visiblePeriods();
        var byPeriod = state.cells[metricKey] || {};
        var source = null;

        for (var i = 0; i < periods.length; i++) {
            var c = byPeriod[periods[i].period_start];
            if (c && c.target_value !== null && c.target_value !== undefined) {
                source = { value: Number(c.target_value), from: i };
                break;
            }
        }
        if (!source) {
            toast('Set a target in one cell of this row first, then fill right.', 'error');
            return;
        }

        var pending = [];
        for (var j = source.from + 1; j < periods.length; j++) {
            var cell = byPeriod[periods[j].period_start];
            if (cell && (cell.target_value === null || cell.target_value === undefined)) {
                pending.push(periods[j].period_start);
            }
        }
        if (!pending.length) {
            toast('Every later period in this row already has a target.', 'info');
            return;
        }

        Swal.fire({
            title: 'Fill right?',
            text: 'Set ' + pending.length + ' empty period' + (pending.length === 1 ? '' : 's') +
                  ' in this row to ' + source.value + '. Periods that already have a target are left alone.',
            showCancelButton: true,
            confirmButtonText: 'Fill'
        }).then(function (choice) {
            if (!choice.isConfirmed) return;
            var chain = Promise.resolve();
            pending.forEach(function (periodStart) {
                chain = chain.then(function () {
                    return dataFunctions.upsertReportPeriodTarget(String(metricKey), state.periodType,
                                                                  String(periodStart), source.value, null);
                });
            });
            chain.then(function () {
                toast(pending.length + ' target' + (pending.length === 1 ? '' : 's') + ' set.', 'success');
                return load(true);
            }).catch(function (err) {
                console.warn('[targets] fillRight failed', err);
                toast('Could not fill the row.', 'error');
                load(true);
            });
        });
    }

    function handleCopyPeriod() {
        Swal.fire({
            title: 'Copy targets between periods',
            html: '<div class="text-start">' +
                '<label class="form-label" for="copyFromDate">Copy from a date in this period</label>' +
                '<input id="copyFromDate" type="date" class="form-control mb-3">' +
                '<label class="form-label" for="copyToDate">Into the period containing</label>' +
                '<input id="copyToDate" type="date" class="form-control">' +
                '</div>',
            showCancelButton: true,
            confirmButtonText: 'Copy',
            preConfirm: function () {
                var from = (document.getElementById('copyFromDate') || {}).value || '';
                var to = (document.getElementById('copyToDate') || {}).value || '';
                if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
                    Swal.showValidationMessage('Pick both dates.');
                    return false;
                }
                return { from: from, to: to };
            }
        }).then(function (choice) {
            if (!choice.isConfirmed || !choice.value) return;
            dataFunctions.copyReportPeriodTargets(state.periodType, choice.value.from, choice.value.to)
                .then(function (result) {
                    var row = firstRpcRow(result);
                    if (row && Number(row.success) === 1) {
                        var count = Number(row.targets_copied) || 0;
                        toast(count + ' target' + (count === 1 ? '' : 's') + ' copied.', 'success');
                        load(true);
                    } else {
                        toast(rpcErrorMessage(result, 'Could not copy targets.'), 'error');
                    }
                })
                .catch(function (err) {
                    console.warn('[targets] copyReportPeriodTargets failed', err);
                    toast('Could not copy targets.', 'error');
                });
        });
    }

    // ------------------------------------------------------------------
    // Events — all namespaced ".reportTargets"; destroy() removes every one.
    // ------------------------------------------------------------------

    function switchTab(tab) {
        if (tab !== 'monthly' && tab !== 'weekly') return;
        state.periodType = tab;
        state.weekPage = 0;
        $('#reportTargetsTabs .nav-link').removeClass('active');
        $('#reportTargetsTabs .nav-link[data-tab="' + tab + '"]').addClass('active');
        load(false).then(function () {
            if (tab === 'weekly') {
                jumpWeekPageToToday();
                render();
            }
        });
    }

    function bindEvents() {
        $(document).on('click.reportTargets', '#reportTargetsTabs .nav-link', function (e) {
            e.preventDefault();
            switchTab($(this).data('tab'));
        });

        $(document).on('change.reportTargets', '#targetsFy', function () {
            state.fy = parseInt($(this).val(), 10) || fyOfToday();
            state.weekPage = 0;
            load(false);
        });

        $(document).on('change.reportTargets', '#targetsSection', function () {
            state.sectionFilter = $(this).val() || '';
            render();
        });

        $(document).on('click.reportTargets', '#refreshTargetsBtn', function () { load(true); });

        $(document).on('click.reportTargets', '#copyTargetsBtn', function () {
            if (!canEdit()) {
                Swal.fire({ icon: 'warning', text: 'You do not have permission for this action.' });
                return;
            }
            handleCopyPeriod();
        });

        $(document).on('click.reportTargets', '#weeksPrevBtn', function () {
            if (state.weekPage > 0) { state.weekPage--; render(); }
        });
        $(document).on('click.reportTargets', '#weeksNextBtn', function () {
            if (state.weekPage < maxWeekPage()) { state.weekPage++; render(); }
        });

        $(document).on('change.reportTargets', '.js-target', function () {
            saveTarget($(this));
        });
        $(document).on('keydown.reportTargets', '.js-target', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); $(this).trigger('blur'); }
        });

        $(document).on('click.reportTargets', '.js-prior', function () {
            if (!canEdit()) return;
            beginPriorEdit($(this));
        });

        // Re-measure on resize; the room below the grid changes with the window, and the filter
        // toolbar wraps to a second line on a narrow screen.
        $(window).on('resize.reportTargets', function () { sizeGridViewport(); });

        $(document).on('click.reportTargets', '.js-fill-right', function (e) {
            e.preventDefault();
            if (!canEdit()) {
                Swal.fire({ icon: 'warning', text: 'You do not have permission for this action.' });
                return;
            }
            fillRight($(this).closest('tr'));
        });
    }

    return {
        init: function () {
            _reportTargetsGrid.destroy();
            state.periodType = 'monthly';
            state.sectionFilter = '';
            state.weekPage = 0;
            bindEvents();
            populateFyOptions();
            $('#reportTargetsTabs .nav-link').removeClass('active');
            $('#reportTargetsTabs .nav-link[data-tab="monthly"]').addClass('active');
            load(false);
        },

        destroy: function () {
            $(document).off('.reportTargets');
            $(window).off('.reportTargets');
        }
    };
}());

window._reportTargetsGrid = _reportTargetsGrid;
