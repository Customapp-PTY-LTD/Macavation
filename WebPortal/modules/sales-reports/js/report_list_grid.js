/**
 * Sales & Production Reports — report list (route key kept as sales-forecasting-grid).
 * See CLAUDE.md and Playwright Tests/helpers/navigation.helper.ts for why that key can't move.
 *
 * No deep-linking in this app (see CLAUDE.md "No screen is deep-linkable"): opening the editor
 * hands off the id via Session.set('currentReportId', id), never a URL/hash param.
 */
var _salesReportList = (function () {
    'use strict';

    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    var PAGE_SIZE = 20;
    var FLATPICKR_DDMMYYYY = { dateFormat: 'd/m/Y', allowInput: false, disableMobile: true };

    var state = {
        rows: [],
        totalCount: 0,
        page: 1,
        periodType: '',
        status: ''
    };

    var bound = false;
    var flatpickrInstance = null;

    function isValidUuid(id) {
        return typeof id === 'string' && UUID_RE.test(id);
    }

    /**
     * Gate before leaving this screen for the editor. A missing/malformed id must never
     * navigate — the editor has nothing else to fall back on since there is no deep link.
     */
    function canOpenReportEditor(reportId) {
        return isValidUuid(reportId);
    }

    /** dd/mm/yyyy (Flatpickr display value) -> ISO yyyy-mm-dd, using the typed components only —
     *  never Date/toISOString, which would shift the day under a UTC+ offset. */
    function toIsoDateFromPicker(value) {
        if (!value || typeof value !== 'string') return null;
        var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
        if (!m) return null;
        var day = m[1].padStart(2, '0');
        var month = m[2].padStart(2, '0');
        var year = m[3];
        var iso = year + '-' + month + '-' + day;
        return ISO_DATE_RE.test(iso) ? iso : null;
    }

    function fromIsoDate(isoStr) {
        if (!isoStr) return '—';
        var s = typeof isoStr === 'string' ? isoStr.trim() : String(isoStr);
        if (s.indexOf('T') >= 0) s = s.split('T')[0];
        var parts = s.split('-');
        if (parts.length !== 3) return s;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    function formatTimestamp(ts) {
        if (!ts) return '—';
        var s = String(ts);
        if (s.indexOf('T') < 0) return s;
        return s.slice(0, 10).split('-').reverse().join('/') + ' ' + s.slice(11, 16);
    }

    function toast(msg, type) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: type === 'error' ? 'error' : 'success',
                title: type === 'error' ? 'Error' : 'Done',
                text: msg,
                timer: type === 'error' ? undefined : 2200,
                showConfirmButton: type === 'error'
            });
        }
    }

    function toggleFormBusy(busy) {
        var btn = document.getElementById('srlCreateReportBtn');
        if (!btn) return;
        btn.disabled = !!busy;
        btn.innerHTML = busy
            ? '<i class="fas fa-spinner fa-spin me-1"></i>Creating…'
            : '<i class="fas fa-plus me-1"></i>Create';
    }

    function init() {
        var scope = _salesReportList;
        if (!bound) {
            scope.bindEvents();
            bound = true;
        }
        scope.load();
    }

    function bindEvents() {
        var scope = _salesReportList;

        $('#srlRefreshBtn').off('click').on('click', function () { scope.load(); });

        $('#srlFilterPeriodType').off('change').on('change', function () {
            state.periodType = this.value || '';
            state.page = 1;
            scope.load();
        });

        $('#srlFilterStatus').off('change').on('change', function () {
            state.status = this.value || '';
            state.page = 1;
            scope.load();
        });

        $(document).off('click', '#srlPagination .page-link').on('click', '#srlPagination .page-link', function (e) {
            e.preventDefault();
            var page = parseInt($(this).attr('data-page'), 10);
            if (page && page !== state.page) {
                state.page = page;
                scope.load();
            }
        });

        $(document).off('click', '.js-srl-open-report').on('click', '.js-srl-open-report', function (e) {
            e.preventDefault();
            scope.openReport($(this).attr('data-report-id'));
        });

        $(document).off('click', '.js-srl-delete-report').on('click', '.js-srl-delete-report', function (e) {
            e.preventDefault();
            scope.deleteReport($(this).attr('data-report-id'));
        });

        var modalEl = document.getElementById('srlNewReportModal');
        if (modalEl) {
            $(modalEl).off('shown.bs.modal').on('shown.bs.modal', function () {
                scope.onNewReportModalShown();
            });
        }

        $('input[name="srlPeriodType"]').off('change').on('change', function () {
            scope.loadTemplateOptions();
        });

        $('#srlCreateReportBtn').off('click').on('click', function () {
            scope.createReport();
        });
    }

    function onNewReportModalShown() {
        var scope = _salesReportList;
        var input = document.getElementById('srlPeriodDate');
        if (input && typeof flatpickr !== 'undefined' && !input._flatpickr) {
            flatpickrInstance = flatpickr(input, FLATPICKR_DDMMYYYY);
        }
        var form = document.getElementById('srlNewReportForm');
        if (form) form.reset();
        if (input && input._flatpickr) input._flatpickr.clear();
        scope.loadTemplateOptions();
    }

    async function loadTemplateOptions() {
        var select = document.getElementById('srlTemplateSelect');
        if (!select) return;
        var periodType = document.getElementById('srlPeriodTypeMonthly').checked ? 'monthly' : 'weekly';
        select.innerHTML = '<option value="">Loading…</option>';
        try {
            var templates = await dataFunctions.getReportTemplates(periodType, null, true);
            templates = Array.isArray(templates) ? templates : [];
            select.innerHTML = '';
            if (templates.length === 0) {
                var opt = document.createElement('option');
                opt.value = '';
                opt.textContent = 'No ' + periodType + ' templates available';
                select.appendChild(opt);
                return;
            }
            templates.forEach(function (t) {
                var o = document.createElement('option');
                o.value = t.id;
                o.textContent = t.name || t.code || t.id;
                select.appendChild(o);
            });
        } catch (e) {
            select.innerHTML = '';
            var errOpt = document.createElement('option');
            errOpt.value = '';
            errOpt.textContent = 'Unable to load templates';
            select.appendChild(errOpt);
        }
    }

    async function load() {
        var scope = _salesReportList;
        var tbody = document.getElementById('srlTableBody');
        if (tbody) tbody.innerHTML = macLoadingRow(7, 'Loading reports…');

        var offset = (state.page - 1) * PAGE_SIZE;
        try {
            var rows = await dataFunctions.listReportInstances(
                state.periodType || null,
                state.status || null,
                PAGE_SIZE,
                offset,
                null,
                true
            );
            state.rows = Array.isArray(rows) ? rows : [];
            state.totalCount = state.rows.length > 0 ? Number(state.rows[0].total_count) || 0 : 0;
            scope.renderRows();
            scope.renderPagination();
        } catch (e) {
            // A thrown error here means the RPC itself is unavailable (e.g. a schema-cache miss
            // because the migration hasn't been applied yet) — that's a degraded screen, not a
            // business-logic failure, so it gets the empty state rather than a toast.
            var container = document.querySelector('.card .table-responsive');
            if (container) {
                container.innerHTML = macEmptyState(
                    'fa-triangle-exclamation',
                    'Reports are not available right now',
                    'The report list service could not be reached. Try refreshing in a moment.'
                );
            }
            var pag = document.getElementById('srlPagination');
            if (pag) pag.innerHTML = '';
        }
    }

    function renderRows() {
        var tbody = document.getElementById('srlTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (state.rows.length === 0) {
            tbody.innerHTML = macEmptyRow(7, 'No reports match these filters.');
            return;
        }

        state.rows.forEach(function (r) {
            tbody.appendChild(buildRow(r));
        });

        MacTableActions.init(document.getElementById('srlTable'));
    }

    function buildRow(r) {
        var tr = document.createElement('tr');
        if (isValidUuid(r.id)) tr.setAttribute('data-report-id', r.id);

        var periodLabel = typeof r.period_label === 'string' ? r.period_label.replace(/\s+/g, ' ').trim() : '';
        var tdPeriod = document.createElement('td');
        tdPeriod.textContent = periodLabel || '—';
        tr.appendChild(tdPeriod);

        var tdType = document.createElement('td');
        tdType.textContent = r.period_type === 'monthly' ? 'Monthly' : (r.period_type === 'weekly' ? 'Weekly' : (r.period_type || '—'));
        tr.appendChild(tdType);

        var tdRange = document.createElement('td');
        tdRange.className = 'small text-muted';
        tdRange.textContent = fromIsoDate(r.period_start) + ' – ' + fromIsoDate(r.period_end);
        tr.appendChild(tdRange);

        var tdStatus = document.createElement('td');
        tdStatus.innerHTML = MacStatus.pill(r.status);
        tr.appendChild(tdStatus);

        var tdCompleteness = document.createElement('td');
        var metricCount = Number(r.metric_count) || 0;
        var overrideCount = Number(r.override_count) || 0;
        tdCompleteness.className = 'small';
        tdCompleteness.title = 'Metrics with a manually entered figure, out of the total for this report.';
        tdCompleteness.textContent = metricCount > 0 ? (overrideCount + ' of ' + metricCount + ' overridden') : '—';
        tr.appendChild(tdCompleteness);

        var tdGenerated = document.createElement('td');
        tdGenerated.className = 'small text-muted';
        tdGenerated.textContent = formatTimestamp(r.generated_at);
        tr.appendChild(tdGenerated);

        var items = [{
            label: 'Open',
            icon: 'fas fa-arrow-up-right-from-square',
            className: 'js-srl-open-report',
            dataAttrs: { reportId: r.id }
        }];
        if (r.status === 'draft' && typeof hasAction === 'function' && hasAction('reports.report.delete')) {
            items.push({
                label: 'Delete',
                icon: 'fas fa-trash',
                className: 'js-srl-delete-report',
                danger: true,
                dataAttrs: { reportId: r.id }
            });
        }
        var tdActions = document.createElement('td');
        tdActions.className = 'mac-table-actions-col text-end';
        tdActions.innerHTML = MacTableActions.render({ id: 'srlActions' + r.id, items: items });
        tr.appendChild(tdActions);

        return tr;
    }

    function renderPagination() {
        var pag = document.getElementById('srlPagination');
        if (!pag) return;
        var totalPages = Math.max(1, Math.ceil(state.totalCount / PAGE_SIZE));
        if (totalPages <= 1) {
            pag.innerHTML = '';
            return;
        }
        var html = '<nav><ul class="pagination justify-content-center">';
        if (state.page > 1) {
            html += '<li class="page-item"><a class="page-link" href="#" data-page="' + (state.page - 1) + '">Previous</a></li>';
        }
        for (var i = 1; i <= totalPages; i++) {
            html += i === state.page
                ? '<li class="page-item active"><span class="page-link">' + i + '</span></li>'
                : '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
        }
        if (state.page < totalPages) {
            html += '<li class="page-item"><a class="page-link" href="#" data-page="' + (state.page + 1) + '">Next</a></li>';
        }
        html += '</ul></nav>';
        pag.innerHTML = html;
    }

    function openReport(reportId) {
        if (!canOpenReportEditor(reportId)) {
            toast('That report could not be opened.', 'error');
            return;
        }
        Session.set('currentReportId', reportId);
        _appRouter.routeTo('sales-report-editor');
    }

    async function createReport() {
        var scope = _salesReportList;
        if (typeof actionAccess !== 'undefined' && actionAccess.denyUnless &&
            !actionAccess.denyUnless('reports.report.create', 'You do not have permission to create reports.')) {
            return;
        }

        var dateInput = document.getElementById('srlPeriodDate');
        var templateSelect = document.getElementById('srlTemplateSelect');
        var periodDateIso = toIsoDateFromPicker(dateInput ? dateInput.value : '');
        var templateId = templateSelect ? templateSelect.value : '';

        if (!periodDateIso) {
            toast('Enter a valid date (dd/mm/yyyy).', 'error');
            return;
        }
        if (!isValidUuid(templateId)) {
            toast('Choose a report template.', 'error');
            return;
        }

        toggleFormBusy(true);
        try {
            var result = await dataFunctions.createReportInstance(templateId, periodDateIso);
            if (result && Number(result.success) === 1 && isValidUuid(result.report_instance_id)) {
                var modalEl = document.getElementById('srlNewReportModal');
                if (modalEl && typeof bootstrap !== 'undefined') {
                    var instance = bootstrap.Modal.getInstance(modalEl);
                    if (instance) instance.hide();
                }
                scope.load();
                scope.openReport(result.report_instance_id);
            } else {
                toast((result && result.error) || 'Could not create the report.', 'error');
            }
        } catch (e) {
            toast('The report service could not be reached. Try again in a moment.', 'error');
        } finally {
            toggleFormBusy(false);
        }
    }

    async function deleteReport(reportId) {
        var scope = _salesReportList;
        if (!isValidUuid(reportId)) return;
        if (typeof actionAccess !== 'undefined' && actionAccess.denyUnless &&
            !actionAccess.denyUnless('reports.report.delete', 'You do not have permission to delete reports.')) {
            return;
        }
        if (typeof Swal === 'undefined') return;

        var confirmResult = await Swal.fire({
            icon: 'warning',
            title: 'Delete this report?',
            text: 'This permanently deletes the draft report and its entered figures.',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            confirmButtonColor: 'var(--mac-danger)'
        });
        if (!confirmResult.isConfirmed) return;

        try {
            var result = await dataFunctions.deleteReportInstance(reportId);
            if (result && Number(result.success) === 1) {
                toast('Report deleted.', 'success');
                scope.load();
            } else {
                toast((result && result.error) || 'Could not delete the report.', 'error');
            }
        } catch (e) {
            toast('The report service could not be reached. Try again in a moment.', 'error');
        }
    }

    return {
        init: init,
        bindEvents: bindEvents,
        load: load,
        renderRows: renderRows,
        renderPagination: renderPagination,
        onNewReportModalShown: onNewReportModalShown,
        loadTemplateOptions: loadTemplateOptions,
        openReport: openReport,
        createReport: createReport,
        deleteReport: deleteReport,
        canOpenReportEditor: canOpenReportEditor,
        toIsoDateFromPicker: toIsoDateFromPicker
    };
})();

window._salesReportList = _salesReportList;

function initializeSalesReportList() {
    _salesReportList.init();
}
window.initializeSalesReportList = initializeSalesReportList;
