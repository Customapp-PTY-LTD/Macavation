/**
 * Sales & Production Reports — report list grid.
 * Follows the company module pattern (IIFE, init()/destroy(), namespaced events) per
 * BluePrint/javascript-jquery-rules.md, modelled on WebPortal/modules/users/js/users_grid.js.
 *
 * Three defects in that reference file are deliberately NOT copied here:
 *   - users_grid.js has no destroy() and binds unnamespaced handlers on $(document), so they
 *     survive a route swap. Every binding here is namespaced ".salesReports" and destroy()
 *     removes them all.
 *   - users_grid.js double-inits (auto-init + router init). init() here calls destroy() first,
 *     so a second invocation cannot double-bind.
 *   - users_grid.js concatenates raw payload values into row HTML. Every database value here
 *     reaches the DOM only via .text() or an escaping helper (MacStatus.pill, macLoadingRow,
 *     macEmptyRow, macEmptyState, MacTableActions — verified to escape their own arguments).
 */
var _reportListGrid = function () {
    'use strict';

    var REPORT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Local dd/mm/yyyy <-> Flatpickr config, matching the existing repo idiom
    // (WebPortal/modules/modals/modal-stock-receiving-checklist/js/modal_receiving_checklist.js:9-17).
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };

    var state = {
        reports: [],
        totalCount: 0,
        currentPage: 1,
        itemsPerPage: 10,
        periodType: '',
        status: ''
    };

    var modalState = {
        templateId: null
    };

    // ------------------------------------------------------------------
    // Shared helpers (also relied on by the report editor plan later).
    // ------------------------------------------------------------------

    function displayLabel(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    function isReportUuid(value) {
        return typeof value === 'string' && REPORT_UUID_RE.test(value);
    }

    function firstRpcRow(result) {
        return Array.isArray(result) ? (result[0] || null) : (result && typeof result === 'object' ? result : null);
    }

    function isQueuedOffline(result) {
        return !!(result && result.offline === true && result.queued === true);
    }

    // Local dd/mm/yyyy -> yyyy-mm-dd by string split only. No Date arithmetic, no UTC conversion.
    function pickerDateToIso(dateStr) {
        var s = String(dateStr == null ? '' : dateStr).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return null;
        var p = s.split('/');
        return p[2] + '-' + p[1].padStart(2, '0') + '-' + p[0].padStart(2, '0');
    }

    // Mirrors appRouter.js:137-138 exactly. The router only runs its own hasAccess gate when
    // roleMenuConfig exists AND getUserRole() is truthy; a looser check here would block a
    // navigation the router would have allowed. roleMenuConfig.hasAccess returns a strict
    // boolean (role-menu-config.js:603-628), so `=== true` matches the router's truthiness test.
    function canOpenReportEditor() {
        if (typeof roleMenuConfig === 'undefined' || !roleMenuConfig.getUserRole()) return true;
        return roleMenuConfig.hasAccess('sales-report-editor') === true;
    }

    // Router's own registry lookup: appRouter.js:193 reads _appRouter.routeConfig[routeName]
    // (populated at appRouter.js:894 from appRouteConfig.json "appRoutes"); a missing entry makes
    // loadContent fail with "no route config found" (appRouter.js:195-199). Treating an
    // unavailable registry as "absent" is the fail-closed direction for navigation.
    function reportEditorRouteExists() {
        return !!(typeof _appRouter !== 'undefined' && _appRouter.routeConfig &&
                  _appRouter.routeConfig['sales-report-editor']);
    }

    // The single funnel: the only code path in this module that navigates to the editor.
    function openReportEditor(reportId) {
        // Checked first, with its own distinct message: a missing route is a deployment state,
        // not a permissions state, and is unaffected by role (super_user included —
        // role-menu-config.js:609 already returns true for that role).
        if (!reportEditorRouteExists()) {
            Swal.fire({ icon: 'info', title: 'Report editor not available', text: 'The report editor has not been deployed to this environment yet.' });
            return false;
        }
        if (!canOpenReportEditor()) {
            Swal.fire({ icon: 'info', title: 'Report editing not enabled', text: 'Report editing has not been enabled for your role yet. An administrator must apply the report-builder permissions migration, then sign out and back in.' });
            return false;
        }
        if (!isReportUuid(reportId)) {
            // Distinct from the message above on purpose: this is a data fault, not a
            // permissions or migration state, and must not be reported as one.
            console.warn('[sales-reports] refusing to open editor for invalid report id');
            Swal.fire({ icon: 'error', title: 'Could not open report', text: 'That report could not be opened. Refresh the list and try again.' });
            return false;
        }
        if (typeof Session !== 'undefined' && Session.set) Session.set('currentReportId', reportId);
        _appRouter.routeTo('sales-report-editor', true);
        return true;
    }

    // ------------------------------------------------------------------
    // Row rendering — every value that isn't already escaped by a shared
    // helper reaches the DOM only via .text().
    // ------------------------------------------------------------------

    function typeLabel(value) {
        var s = displayLabel(value);
        return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    }

    function formatOverride(row) {
        var overrideCount = Number(row && row.override_count) || 0;
        var metricCount = Number(row && row.metric_count) || 0;
        return overrideCount + ' of ' + metricCount;
    }

    function formatGeneratedAt(value) {
        var s = displayLabel(value);
        if (!s) return '\u2014';
        var idx = s.indexOf('T');
        return idx > -1 ? s.slice(0, idx) : s;
    }

    function buildRowActions(row) {
        var items = [
            { label: 'Open', className: 'js-report-open', dataAttrs: { 'report-id': row.id } }
        ];
        if (typeof hasAction === 'function' && hasAction('reports.report.delete')) {
            items.push({ label: 'Delete', className: 'js-report-delete', danger: true, dataAttrs: { 'report-id': row.id } });
        }
        return items;
    }

    // Appended only when the row is beyond its first version, so a normal first-issue report's
    // label is left exactly as it always was.
    function periodLabelWithVersion(row) {
        var label = displayLabel(row.period_label);
        var version = Number(row && row.version);
        if (Number.isFinite(version) && version > 1) {
            return label + ' \u00b7 v' + version;
        }
        return label;
    }

    function buildRow(row) {
        var $tr = $('<tr>');
        $tr.append($('<td>').text(periodLabelWithVersion(row)));
        $tr.append($('<td>').html(MacStatus.pill(row.period_type, typeLabel(row.period_type))));
        $tr.append($('<td>').text(displayLabel(row.period_start) + ' \u2013 ' + displayLabel(row.period_end)));
        $tr.append($('<td>').html(MacStatus.pill(row.status)));
        $tr.append($('<td>').text(formatOverride(row)));
        $tr.append($('<td>').text(formatGeneratedAt(row.generated_at)));
        $tr.append($(MacTableActions.renderCell({ items: buildRowActions(row) })));
        return $tr;
    }

    function renderRows() {
        var $tbody = $('#reportListTableBody');
        $tbody.empty();
        if (!state.reports.length) {
            $tbody.html(macEmptyRow(7, 'No reports found.'));
            return;
        }
        state.reports.forEach(function (row) {
            $tbody.append(buildRow(row));
        });
        MacTableActions.init(document.getElementById('reportListTable'));
    }

    function renderPagination() {
        var totalPages = Math.ceil(Number(state.totalCount || 0) / state.itemsPerPage) || 1;
        var $pagination = $('#reportListPagination');
        if (totalPages <= 1) {
            $pagination.empty();
            return;
        }
        var html = '';
        if (state.currentPage > 1) {
            html += '<li class="page-item"><a class="page-link" href="#" data-page="' + (state.currentPage - 1) + '">Previous</a></li>';
        }
        for (var i = 1; i <= totalPages; i++) {
            if (i === state.currentPage) {
                html += '<li class="page-item active"><span class="page-link">' + i + '</span></li>';
            } else {
                html += '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
            }
        }
        if (state.currentPage < totalPages) {
            html += '<li class="page-item"><a class="page-link" href="#" data-page="' + (state.currentPage + 1) + '">Next</a></li>';
        }
        $pagination.html(html);
    }

    // ------------------------------------------------------------------
    // Data loading.
    // ------------------------------------------------------------------

    function load(forceRefresh) {
        var $tbody = $('#reportListTableBody');
        $tbody.html(macLoadingRow(7, 'Loading reports\u2026'));
        var filters = {
            period_type: state.periodType || null,
            status: state.status || null,
            limit: state.itemsPerPage,
            offset: (state.currentPage - 1) * state.itemsPerPage
        };
        return dataFunctions.listReportInstances(filters, null, !!forceRefresh).then(function (result) {
            var rows = Array.isArray(result) ? result : (result ? [result] : []);
            state.reports = rows;
            state.totalCount = rows.length ? (Number(rows[0].total_count) || rows.length) : 0;
            renderRows();
            renderPagination();
        }).catch(function (err) {
            // Missing RPC (migration not applied to this database) must not white-screen
            // the module — render the empty state rather than leaving a spinner running.
            console.warn('[sales-reports] listReportInstances failed', err);
            state.reports = [];
            state.totalCount = 0;
            $('#reportListTableBody').html('<tr><td colspan="7">' +
                macEmptyState('fa-file-invoice', 'Reports are not available yet', 'The report-builder migrations have not been applied to this database.') +
                '</td></tr>');
            $('#reportListPagination').empty();
        });
    }

    // ------------------------------------------------------------------
    // New Report modal.
    // ------------------------------------------------------------------

    function selectedNewReportPeriodType() {
        return $('input[name="newReportPeriodType"]:checked').val() || 'weekly';
    }

    function initFlatpickrForModal() {
        var el = document.getElementById('newReportPeriodDate');
        if (!el || typeof flatpickr === 'undefined' || el._flatpickr) return;
        flatpickr(el, FLATPICKR_DDMMYYYY);
    }

    function refreshTemplateAvailability() {
        var periodType = selectedNewReportPeriodType();
        var $msg = $('#newReportNoTemplateMsg');
        var $submit = $('#createReportBtn');
        dataFunctions.getReportTemplates(periodType).then(function (result) {
            var rows = Array.isArray(result) ? result : (result ? [result] : []);
            modalState.templateId = rows.length && rows[0] && rows[0].id ? rows[0].id : null;
            if (modalState.templateId) {
                $msg.addClass('d-none');
                $submit.prop('disabled', false);
            } else {
                $msg.text('No active report template exists for this report type yet.').removeClass('d-none');
                $submit.prop('disabled', true);
            }
        }).catch(function (err) {
            console.warn('[sales-reports] getReportTemplates failed', err);
            modalState.templateId = null;
            $msg.text('Reports are not available yet. The report-builder migrations have not been applied to this database.').removeClass('d-none');
            $submit.prop('disabled', true);
        });
    }

    function refreshDefaultDate() {
        var periodType = selectedNewReportPeriodType();
        dataFunctions.getReportCurrentPeriod(periodType).then(function (result) {
            // get_report_current_period returns no rows for an unknown period type — treat an
            // empty result as "no default date" and leave the field as the user set it.
            var row = firstRpcRow(result);
            var iso = row && row.period_start ? String(row.period_start).slice(0, 10) : null;
            if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
                var parts = iso.split('-');
                var ddmmyyyy = parts[2] + '/' + parts[1] + '/' + parts[0];
                var el = document.getElementById('newReportPeriodDate');
                if (el) {
                    if (el._flatpickr) el._flatpickr.setDate(ddmmyyyy, false, 'd/m/Y');
                    else el.value = ddmmyyyy;
                }
            }
        }).catch(function (err) {
            console.warn('[sales-reports] getReportCurrentPeriod failed', err);
            // Leave the field as-is; the modal still opens.
        });
    }

    function openNewReportModal() {
        var form = document.getElementById('newReportForm');
        if (form) form.reset();
        $('#newReportPeriodTypeWeekly').prop('checked', true);
        $('#newReportNoTemplateMsg').addClass('d-none').text('No active report template exists for this report type yet.');
        modalState.templateId = null;
        var modalEl = document.getElementById('newReportModal');
        if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
        else if (typeof $ !== 'undefined' && $.fn.modal) $('#newReportModal').modal('show');
    }

    function hideNewReportModal() {
        var modalEl = document.getElementById('newReportModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            var inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
        } else if (typeof $ !== 'undefined' && $.fn.modal) {
            $('#newReportModal').modal('hide');
        }
    }

    function handleCreateReport() {
        var form = document.getElementById('newReportForm');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }
        if (!modalState.templateId) return; // submit is disabled in this case; defensive guard.
        var dateEl = document.getElementById('newReportPeriodDate');
        var iso = pickerDateToIso(dateEl ? dateEl.value : '');
        if (!iso) {
            Swal.fire({ icon: 'error', title: 'Invalid date', text: 'Enter a valid date (dd/mm/yyyy) within the reporting period.' });
            return;
        }
        var $btn = $('#createReportBtn');
        $btn.prop('disabled', true);
        dataFunctions.createReportInstance(modalState.templateId, iso).then(function (result) {
            if (isQueuedOffline(result)) {
                Swal.fire({ icon: 'info', title: 'Report queued', text: 'You are offline. The report will be created when the connection returns.' });
                hideNewReportModal();
                load(true);
                return;
            }
            var row = firstRpcRow(result);
            if (Number(row && row.success) === 1) {
                hideNewReportModal();
                load(true);
                openReportEditor(row.report_instance_id);
            } else {
                var msg = (row && row.error) ? row.error : 'Could not create the report.';
                Swal.fire({ icon: 'error', title: 'Could not create report', text: msg });
            }
        }).catch(function (err) {
            console.warn('[sales-reports] createReportInstance failed', err);
            Swal.fire({ icon: 'error', title: 'Could not create report', text: 'Reports are not available yet. The report-builder migrations have not been applied to this database.' });
        }).finally(function () {
            $btn.prop('disabled', false);
        });
    }

    // ------------------------------------------------------------------
    // Delete.
    // ------------------------------------------------------------------

    function confirmDeleteReport(reportId) {
        if (!isReportUuid(reportId)) {
            console.warn('[sales-reports] refusing to delete: invalid report id');
            return;
        }
        Swal.fire({
            icon: 'warning',
            title: 'Delete this report?',
            text: 'This will permanently delete the draft report. This action cannot be undone.',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            confirmButtonColor: '#d33'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            dataFunctions.deleteReportInstance(reportId).then(function (delResult) {
                if (isQueuedOffline(delResult)) {
                    Swal.fire({ icon: 'info', title: 'Delete queued', text: 'You are offline. The delete will be sent when the connection returns.' });
                    load(true);
                    return;
                }
                var row = firstRpcRow(delResult);
                if (Number(row && row.success) === 1) {
                    load(true);
                } else {
                    var msg = (row && row.error) ? row.error : 'Could not delete the report.';
                    Swal.fire({ icon: 'error', title: 'Could not delete report', text: msg });
                }
            }).catch(function (err) {
                console.warn('[sales-reports] deleteReportInstance failed', err);
                Swal.fire({ icon: 'error', title: 'Could not delete report', text: 'Reports are not available yet. The report-builder migrations have not been applied to this database.' });
            });
        });
    }

    // ------------------------------------------------------------------
    // Event wiring — every binding namespaced ".salesReports"; destroy() removes them all.
    // Delegated from document because the New Report modal is a sibling of the grid's own
    // container in report_list.html, not a descendant of it.
    // ------------------------------------------------------------------

    function bindEvents() {
        $(document).on('click.salesReports', '#newReportBtn', function () {
            openNewReportModal();
        });
        $(document).on('click.salesReports', '#refreshReportListBtn', function () {
            load(true);
        });
        $(document).on('change.salesReports', '#reportFilterPeriodType', function () {
            state.periodType = $(this).val() || '';
            state.currentPage = 1;
            load(false);
        });
        $(document).on('change.salesReports', '#reportFilterStatus', function () {
            state.status = $(this).val() || '';
            state.currentPage = 1;
            load(false);
        });
        $(document).on('click.salesReports', '#clearReportFiltersBtn', function () {
            $('#reportFilterPeriodType').val('');
            $('#reportFilterStatus').val('');
            state.periodType = '';
            state.status = '';
            state.currentPage = 1;
            load(false);
        });
        $(document).on('click.salesReports', '#reportListPagination .page-link', function (e) {
            e.preventDefault();
            var page = parseInt($(this).data('page'), 10);
            if (page && page !== state.currentPage) {
                state.currentPage = page;
                load(false);
            }
        });
        $(document).on('click.salesReports', '.js-report-open', function (e) {
            e.preventDefault();
            openReportEditor(String($(this).data('report-id') || ''));
        });
        $(document).on('click.salesReports', '.js-report-delete', function (e) {
            e.preventDefault();
            confirmDeleteReport(String($(this).data('report-id') || ''));
        });
        $(document).on('change.salesReports', 'input[name="newReportPeriodType"]', function () {
            refreshTemplateAvailability();
            refreshDefaultDate();
        });
        $(document).on('shown.bs.modal.salesReports', '#newReportModal', function () {
            initFlatpickrForModal();
            refreshTemplateAvailability();
            refreshDefaultDate();
        });
        $(document).on('click.salesReports', '#createReportBtn', function () {
            handleCreateReport();
        });
    }

    return {
        init: function () {
            _reportListGrid.destroy();
            state.currentPage = 1;
            state.periodType = '';
            state.status = '';
            bindEvents();
            load(false);
        },

        destroy: function () {
            $(document).off('.salesReports');
        },

        load: load
    };
}();

function initializeReportListGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _reportListGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeReportListGrid();
});
