/**
 * Report Targets & Prior-Period Baselines.
 *
 * Two tabs, backed by six RPCs added alongside this module (see data-functions.js):
 *   - Targets: set the target for a metric in a given weekly/monthly period. Every targetable
 *     metric is listed even when unset (get_report_period_targets returns a row per metric with
 *     target_value NULL) so the gaps are visible, not hidden.
 *   - Prior periods: hand-enter actuals for periods that predate the report builder, so the
 *     year-on-year tracking tables have a comparison series. This is neither a report nor an
 *     override of anything live.
 *
 * Deliberately does NOT touch dashboard_targets or its RPCs/screen — that table is effective-dated
 * ("what applies right now") and answers a different question than this one ("what applied to the
 * exact week of 3 November"). See CLAUDE.md and the plan for the two-table split.
 *
 * Follows WebPortal/modules/sales-reports/js/report_list_grid.js's pattern (IIFE, init()/destroy(),
 * namespaced ".reportTargets" events, cached $-prefixed selectors) rather than
 * dashboard-targets_grid.js's free-text metric_key input, which is the one thing deliberately not
 * carried over — metric_key here always comes from a <select> populated by getReportMetrics.
 */
var _reportTargetsGrid = (function () {
    'use strict';

    var state = {
        activeTab: 'targets',
        targets: {
            rows: []
        },
        baselines: {
            rows: [],
            metricsForAdd: []
        }
    };

    // ------------------------------------------------------------------
    // Shared helpers.
    // ------------------------------------------------------------------

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v);
    }

    function displayLabel(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function firstRpcRow(result) {
        return Array.isArray(result) ? (result[0] || null) : (result && typeof result === 'object' ? result : null);
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

    // Populate a period <select> (MacPeriodPicker, js/report-period-picker.js) and write the
    // day range it covers into its hint line. Nothing here is greyed out: unlike a report, a
    // target or a prior-period actual can legitimately be revisited for a period that already
    // has one — the RPCs upsert rather than reject.
    //
    // The anchor comes from get_report_current_period because that RPC is SAST-correct; a
    // failure falls back to the browser's own date so the dropdown still populates.
    function fillPeriodSelect(selectElId, rangeElId, periodType, selectedIso) {
        return dataFunctions.getReportCurrentPeriod(periodType).then(function (result) {
            var row = firstRpcRow(result);
            return row && row.period_start ? String(row.period_start).slice(0, 10) : null;
        }).catch(function (err) {
            console.warn('[report-targets] getReportCurrentPeriod failed; using the browser date', err);
            return null;
        }).then(function (anchorIso) {
            var chosen = MacPeriodPicker.fill(document.getElementById(selectElId), {
                periodType: periodType,
                anchorIso: anchorIso,
                selectedIso: selectedIso || null,
                // Keeps a period the user was already on even when switching type lands it
                // outside the default window, instead of silently jumping back to this week.
                ensureIso: selectedIso || null
            });
            refreshPeriodRangeHint(selectElId, rangeElId, periodType);
            return chosen;
        }).catch(function (err) {
            // Resolves rather than rejects: both callers chain loadTargets/loadBaselines off this
            // promise, and a rejection here would leave the grid stuck on its loading row with
            // nothing said. The empty option makes the failure visible in the control itself.
            console.warn('[report-targets] could not build the period list', err);
            $('#' + selectElId).empty()
                .append($('<option>').attr('value', '').text('Period list unavailable — reload the page'));
            $('#' + rangeElId).text('');
            return '';
        });
    }

    function refreshPeriodRangeHint(selectElId, rangeElId, periodType) {
        var iso = String($('#' + selectElId).val() || '');
        $('#' + rangeElId).text(iso ? MacPeriodPicker.rangeText(periodType, iso) : '');
    }

    // ------------------------------------------------------------------
    // Tabs.
    // ------------------------------------------------------------------

    function switchTab(tab) {
        if (tab !== 'targets' && tab !== 'baselines') return;
        state.activeTab = tab;
        $('.report-targets-tab-pane').addClass('d-none');
        $('#reportTargets-' + tab + '-pane').removeClass('d-none');
        $('#reportTargetsTabs .nav-link').removeClass('active');
        $('#reportTargetsTabs .nav-link[data-tab="' + tab + '"]').addClass('active');
        if (tab === 'targets') {
            loadTargets(false);
        } else {
            loadBaselines(false);
        }
    }

    // ------------------------------------------------------------------
    // Targets tab.
    // ------------------------------------------------------------------

    function currentTargetsPeriodType() {
        return $('#targetsPeriodType').val() || 'weekly';
    }

    function currentTargetsPeriodIso() {
        var iso = String($('#targetsPeriod').val() || '');
        return MacPeriodPicker.isIso(iso) ? iso : null;
    }

    // Repopulates the period list for the selected type. Keeps the period the user was already
    // on if it survives the switch to the new type — the equivalent week of the month they were
    // looking at, snapped — rather than jumping back to today.
    function refreshTargetsPeriodOptions() {
        var periodType = currentTargetsPeriodType();
        var keep = MacPeriodPicker.normalise(periodType, currentTargetsPeriodIso());
        return fillPeriodSelect('targetsPeriod', 'targetsPeriodRange', periodType, keep);
    }

    function targetRowHtml(row) {
        var key = esc(row.metric_key);
        var label = esc(row.label);
        var section = esc(row.section_key);
        var unit = esc(row.unit || '');
        var hasValue = row.target_value !== null && row.target_value !== undefined;
        var valueAttr = hasValue ? esc(row.target_value) : '';
        var notesAttr = esc(row.notes || '');
        var editable = canEdit();
        var statusPill = hasValue ? MacStatus.pill('active', 'Set') : MacStatus.pill('none', 'Not set');
        var saveBtn = editable
            ? '<button type="button" class="btn btn-sm btn-primary js-save-target"><i class="fas fa-save me-1"></i>Save</button>'
            : '';
        return '<tr data-metric-key="' + key + '">' +
            '<td>' + label + '</td>' +
            '<td>' + section + '</td>' +
            '<td>' + unit + '</td>' +
            '<td><input type="number" step="any" class="form-control form-control-sm js-target-value" value="' + valueAttr + '"' + (editable ? '' : ' disabled') + '></td>' +
            '<td>' + statusPill + '</td>' +
            '<td><input type="text" class="form-control form-control-sm js-target-notes" value="' + notesAttr + '"' + (editable ? '' : ' disabled') + '></td>' +
            '<td>' + saveBtn + '</td>' +
            '</tr>';
    }

    function renderTargets() {
        var $tbody = $('#reportTargetsTableBody');
        if (!state.targets.rows.length) {
            $tbody.html(macEmptyRow(7, 'No targetable metrics found.'));
            return;
        }
        $tbody.html(state.targets.rows.map(targetRowHtml).join(''));
    }

    function loadTargets(forceRefresh) {
        var periodType = currentTargetsPeriodType();
        var periodIso = currentTargetsPeriodIso();
        var $tbody = $('#reportTargetsTableBody');
        $tbody.html(macLoadingRow(7, 'Loading targets\u2026'));
        if (!periodIso) {
            $tbody.html('<tr><td colspan="7">' + macEmptyState('fa-calendar-xmark', 'Pick a period', 'Choose a date within the period to load its targets.') + '</td></tr>');
            return Promise.resolve();
        }
        return dataFunctions.getReportPeriodTargets(periodType, periodIso, null, !!forceRefresh).then(function (result) {
            var rows = Array.isArray(result) ? result : (result ? [result] : []);
            state.targets.rows = rows;
            renderTargets();
        }).catch(function (err) {
            console.warn('[report-targets] getReportPeriodTargets failed', err);
            state.targets.rows = [];
            $tbody.html('<tr><td colspan="7">' +
                macEmptyState('fa-bullseye', 'Report targets are not available yet', 'The report-builder migrations have not been applied to this database.') +
                '</td></tr>');
        });
    }

    function saveTargetRow($tr) {
        var metricKey = $tr.data('metric-key');
        var periodType = currentTargetsPeriodType();
        var periodIso = currentTargetsPeriodIso();
        var value = $tr.find('.js-target-value').val();
        var notes = ($tr.find('.js-target-notes').val() || '').trim() || null;
        if (!metricKey || !periodIso) return;
        if (value === '' || value === null || !Number.isFinite(Number(value))) {
            Swal.fire({ icon: 'error', text: 'Enter a valid target value.' });
            return;
        }
        if (Number(value) < 0) {
            Swal.fire({ icon: 'error', text: 'Target must be zero or greater.' });
            return;
        }
        dataFunctions.upsertReportPeriodTarget(String(metricKey), periodType, periodIso, Number(value), notes).then(function (result) {
            if (isSuccess(result)) {
                loadTargets(true);
            } else {
                Swal.fire({ icon: 'error', text: rpcErrorMessage(result, 'Could not save the target.') });
            }
        }).catch(function (err) {
            console.warn('[report-targets] upsertReportPeriodTarget failed', err);
            Swal.fire({ icon: 'error', text: 'Report targets are not available yet. The report-builder migrations have not been applied to this database.' });
        });
    }

    function handleCopyTargets() {
        var periodType = currentTargetsPeriodType();
        var toIso = currentTargetsPeriodIso();
        if (!toIso) {
            Swal.fire({ icon: 'error', text: 'Pick a destination period first.' });
            return;
        }
        Swal.fire({
            title: 'Copy targets from which period?',
            html: '<div class="text-start">' +
                '<label class="form-label" for="copyTargetsFromPeriod">Source period</label>' +
                '<select id="copyTargetsFromPeriod" class="form-select"></select>' +
                '</div>',
            showCancelButton: true,
            confirmButtonText: 'Copy',
            // Populated in didOpen rather than inlined into the html string: MacPeriodPicker.fill
            // sets each option with textContent, so no label can carry markup into the dialog.
            // The destination period is excluded — copying a period onto itself does nothing.
            didOpen: function () {
                MacPeriodPicker.fill(document.getElementById('copyTargetsFromPeriod'), {
                    periodType: periodType,
                    anchorIso: toIso,
                    taken: [toIso],
                    takenSuffix: ' — this is the destination'
                });
            },
            preConfirm: function () {
                var el = document.getElementById('copyTargetsFromPeriod');
                var iso = el ? el.value : '';
                if (!MacPeriodPicker.isIso(iso)) {
                    Swal.showValidationMessage('Pick a source period.');
                    return false;
                }
                return iso;
            }
        }).then(function (result) {
            if (!result.isConfirmed || !result.value) return;
            dataFunctions.copyReportPeriodTargets(periodType, result.value, toIso).then(function (copyResult) {
                var row = firstRpcRow(copyResult);
                if (row && Number(row.success) === 1) {
                    var count = Number(row.targets_copied) || 0;
                    Swal.fire({ icon: 'success', text: count + ' target' + (count === 1 ? '' : 's') + ' copied.' });
                    loadTargets(true);
                } else {
                    Swal.fire({ icon: 'error', text: rpcErrorMessage(copyResult, 'Could not copy targets.') });
                }
            }).catch(function (err) {
                console.warn('[report-targets] copyReportPeriodTargets failed', err);
                Swal.fire({ icon: 'error', text: 'Report targets are not available yet. The report-builder migrations have not been applied to this database.' });
            });
        });
    }

    // ------------------------------------------------------------------
    // Prior periods (manual baselines) tab.
    // ------------------------------------------------------------------

    function currentBaselinesPeriodType() {
        return $('#baselinesPeriodType').val() || 'weekly';
    }

    function currentBaselinesFy() {
        return parseInt($('#baselinesFy').val(), 10) || null;
    }

    function baselineRowHtml(row) {
        var key = esc(row.metric_key);
        var periodStart = esc(String(row.period_start || '').slice(0, 10));
        var label = esc(row.label);
        var valueAttr = row.achieved_value !== null && row.achieved_value !== undefined ? esc(row.achieved_value) : '';
        var notesAttr = esc(row.notes || '');
        var editable = canEdit();
        var saveBtn = editable
            ? '<button type="button" class="btn btn-sm btn-primary js-save-baseline"><i class="fas fa-save me-1"></i>Save</button>'
            : '';
        return '<tr data-metric-key="' + key + '" data-period-start="' + periodStart + '">' +
            '<td>' + label + '</td>' +
            '<td>' + periodStart + '</td>' +
            '<td><input type="number" step="any" class="form-control form-control-sm js-baseline-value" value="' + valueAttr + '"' + (editable ? '' : ' disabled') + '></td>' +
            '<td><input type="text" class="form-control form-control-sm js-baseline-notes" value="' + notesAttr + '"' + (editable ? '' : ' disabled') + '></td>' +
            '<td>' + saveBtn + '</td>' +
            '</tr>';
    }

    function renderBaselines() {
        var $tbody = $('#reportBaselinesTableBody');
        if (!state.baselines.rows.length) {
            $tbody.html(macEmptyRow(5, 'No prior-period actuals recorded for this financial year yet.'));
            return;
        }
        $tbody.html(state.baselines.rows.map(baselineRowHtml).join(''));
    }

    function loadBaselines(forceRefresh) {
        var periodType = currentBaselinesPeriodType();
        var fy = currentBaselinesFy();
        var $tbody = $('#reportBaselinesTableBody');
        $tbody.html(macLoadingRow(5, 'Loading prior-period actuals\u2026'));
        if (!fy) {
            $tbody.html(macEmptyRow(5, 'Pick a financial year.'));
            return Promise.resolve();
        }
        return dataFunctions.getReportManualBaselines(periodType, fy, null, !!forceRefresh).then(function (result) {
            var rows = Array.isArray(result) ? result : (result ? [result] : []);
            state.baselines.rows = rows;
            renderBaselines();
        }).catch(function (err) {
            console.warn('[report-targets] getReportManualBaselines failed', err);
            state.baselines.rows = [];
            $tbody.html('<tr><td colspan="5">' +
                macEmptyState('fa-bullseye', 'Report targets are not available yet', 'The report-builder migrations have not been applied to this database.') +
                '</td></tr>');
        });
    }

    function saveBaselineRow($tr) {
        var metricKey = $tr.data('metric-key');
        var periodStart = $tr.data('period-start');
        var periodType = currentBaselinesPeriodType();
        var value = $tr.find('.js-baseline-value').val();
        var notes = ($tr.find('.js-baseline-notes').val() || '').trim() || null;
        if (!metricKey || !periodStart) return;
        if (value === '' || value === null || !Number.isFinite(Number(value))) {
            Swal.fire({ icon: 'error', text: 'Enter a valid achieved value.' });
            return;
        }
        dataFunctions.upsertReportManualBaseline(String(metricKey), periodType, String(periodStart), Number(value), notes).then(function (result) {
            if (isSuccess(result)) {
                loadBaselines(true);
            } else {
                Swal.fire({ icon: 'error', text: rpcErrorMessage(result, 'Could not save the actual.') });
            }
        }).catch(function (err) {
            console.warn('[report-targets] upsertReportManualBaseline failed', err);
            Swal.fire({ icon: 'error', text: 'Report targets are not available yet. The report-builder migrations have not been applied to this database.' });
        });
    }

    // ------------------------------------------------------------------
    // Add baseline modal — metric_key always comes from this <select>, populated from
    // getReportMetrics, never typed free-text (security invariant in the plan).
    // ------------------------------------------------------------------

    function populateAddBaselineMetricSelect() {
        var periodType = currentBaselinesPeriodType();
        var $select = $('#addBaselineMetric');
        $select.html('<option value="">Loading\u2026</option>');
        return dataFunctions.getReportMetrics(null, periodType).then(function (result) {
            var rows = Array.isArray(result) ? result : (result ? [result] : []);
            state.baselines.metricsForAdd = rows;
            if (!rows.length) {
                $select.html('<option value="">No metrics available</option>');
                return;
            }
            $select.html(rows.map(function (m) {
                return '<option value="' + esc(m.metric_key) + '">' + esc(displayLabel(m.label)) + ' (' + esc(m.section_key) + ')</option>';
            }).join(''));
        }).catch(function (err) {
            console.warn('[report-targets] getReportMetrics failed', err);
            state.baselines.metricsForAdd = [];
            $select.html('<option value="">Metrics not available yet</option>');
        });
    }

    function openAddBaselineModal() {
        var form = document.getElementById('addBaselineForm');
        if (form) form.reset();
        populateAddBaselineMetricSelect();
        var modalEl = document.getElementById('addBaselineModal');
        if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
        else if (typeof $ !== 'undefined' && $.fn.modal) $('#addBaselineModal').modal('show');
    }

    function hideAddBaselineModal() {
        var modalEl = document.getElementById('addBaselineModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            var inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
        } else if (typeof $ !== 'undefined' && $.fn.modal) {
            $('#addBaselineModal').modal('hide');
        }
    }

    function handleSaveNewBaseline() {
        var form = document.getElementById('addBaselineForm');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }
        var metricKey = $('#addBaselineMetric').val();
        var periodType = currentBaselinesPeriodType();
        var iso = String($('#addBaselinePeriod').val() || '');
        var value = $('#addBaselineValue').val();
        var notes = ($('#addBaselineNotes').val() || '').trim() || null;

        if (!metricKey) {
            Swal.fire({ icon: 'error', text: 'Pick a metric.' });
            return;
        }
        if (!MacPeriodPicker.isIso(iso)) {
            Swal.fire({ icon: 'error', text: 'Choose the period this actual belongs to.' });
            return;
        }
        if (value === '' || value === null || !Number.isFinite(Number(value))) {
            Swal.fire({ icon: 'error', text: 'Enter a valid achieved value.' });
            return;
        }

        var $btn = $('#saveBaselineBtn');
        $btn.prop('disabled', true);
        dataFunctions.upsertReportManualBaseline(String(metricKey), periodType, iso, Number(value), notes).then(function (result) {
            if (isSuccess(result)) {
                hideAddBaselineModal();
                loadBaselines(true);
            } else {
                Swal.fire({ icon: 'error', text: rpcErrorMessage(result, 'Could not add the actual.') });
            }
        }).catch(function (err) {
            console.warn('[report-targets] upsertReportManualBaseline failed', err);
            Swal.fire({ icon: 'error', text: 'Report targets are not available yet. The report-builder migrations have not been applied to this database.' });
        }).finally(function () {
            $btn.prop('disabled', false);
        });
    }

    // ------------------------------------------------------------------
    // Event wiring — every binding namespaced ".reportTargets"; destroy() removes them all.
    // ------------------------------------------------------------------

    function bindEvents() {
        $(document).on('click.reportTargets', '#reportTargetsTabs .nav-link', function (e) {
            e.preventDefault();
            switchTab($(this).data('tab'));
        });

        $(document).on('click.reportTargets', '#refreshTargetsBtn', function () { loadTargets(true); });
        $(document).on('change.reportTargets', '#targetsPeriodType', function () {
            refreshTargetsPeriodOptions().then(function () { loadTargets(false); });
        });
        $(document).on('change.reportTargets', '#targetsPeriod', function () {
            refreshPeriodRangeHint('targetsPeriod', 'targetsPeriodRange', currentTargetsPeriodType());
            loadTargets(false);
        });
        $(document).on('click.reportTargets', '.js-save-target', function () {
            saveTargetRow($(this).closest('tr'));
        });
        $(document).on('click.reportTargets', '#copyTargetsBtn', function () {
            if (!canEdit()) { Swal.fire({ icon: 'warning', text: 'You do not have permission for this action.' }); return; }
            handleCopyTargets();
        });

        $(document).on('click.reportTargets', '#refreshBaselinesBtn', function () { loadBaselines(true); });
        $(document).on('change.reportTargets', '#baselinesFy', function () { loadBaselines(false); });
        $(document).on('change.reportTargets', '#baselinesPeriodType', function () { loadBaselines(false); });
        $(document).on('click.reportTargets', '.js-save-baseline', function () {
            saveBaselineRow($(this).closest('tr'));
        });
        $(document).on('click.reportTargets', '#addBaselineBtn', function () {
            if (!canEdit()) { Swal.fire({ icon: 'warning', text: 'You do not have permission for this action.' }); return; }
            openAddBaselineModal();
        });
        $(document).on('shown.bs.modal.reportTargets', '#addBaselineModal', function () {
            // The modal has no period type of its own: a prior-period actual is filed against
            // whichever type the tab is showing, exactly as handleSaveNewBaseline reads it.
            fillPeriodSelect('addBaselinePeriod', 'addBaselinePeriodRange', currentBaselinesPeriodType());
        });
        $(document).on('change.reportTargets', '#addBaselinePeriod', function () {
            refreshPeriodRangeHint('addBaselinePeriod', 'addBaselinePeriodRange', currentBaselinesPeriodType());
        });
        $(document).on('click.reportTargets', '#saveBaselineBtn', function () { handleSaveNewBaseline(); });
    }

    return {
        init: function () {
            _reportTargetsGrid.destroy();
            state.activeTab = 'targets';
            bindEvents();
            $('.report-targets-tab-pane').addClass('d-none');
            $('#reportTargets-targets-pane').removeClass('d-none');
            $('#reportTargetsTabs .nav-link').removeClass('active');
            $('#reportTargetsTabs .nav-link[data-tab="targets"]').addClass('active');
            refreshTargetsPeriodOptions().then(function () { loadTargets(false); });
        },

        destroy: function () {
            $(document).off('.reportTargets');
        }
    };
}());

window._reportTargetsGrid = _reportTargetsGrid;
