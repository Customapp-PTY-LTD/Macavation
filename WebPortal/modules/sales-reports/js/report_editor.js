/**
 * Sales & Production Reports — report editor (route: sales-report-editor).
 * No deep-linking in this app: the id arrives via Session.get('currentReportId'), set by the
 * list screen just before routing here (see report_list_grid.js openReport()). A missing or
 * malformed id must never attempt an RPC call with it.
 */
var _salesReportEditor = (function () {
    'use strict';

    var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    var state = {
        reportInstanceId: null,
        report: null,
        readOnly: false
    };

    var bound = false;

    function isValidUuid(id) {
        return typeof id === 'string' && UUID_RE.test(id);
    }

    function fromIsoDate(isoStr) {
        if (!isoStr) return '—';
        var s = typeof isoStr === 'string' ? isoStr.trim() : String(isoStr);
        if (s.indexOf('T') >= 0) s = s.split('T')[0];
        var parts = s.split('-');
        if (parts.length !== 3) return s;
        return parts[2] + '/' + parts[1] + '/' + parts[0];
    }

    function toast(msg, type) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({
                icon: type === 'error' ? 'error' : 'success',
                title: type === 'error' ? 'Error' : 'Done',
                text: msg,
                timer: type === 'error' ? undefined : 2000,
                showConfirmButton: type === 'error'
            });
        }
    }

    function domId(key, idx) {
        var safe = String(key != null ? key : idx).replace(/[^a-zA-Z0-9_-]/g, '_');
        return 'sre-' + safe;
    }

    function init() {
        var scope = _salesReportEditor;
        if (!bound) {
            scope.bindEvents();
            bound = true;
        }

        var id = (typeof Session !== 'undefined' && Session.get) ? Session.get('currentReportId') : null;
        if (!isValidUuid(id)) {
            scope.showInvalidIdState();
            return;
        }
        state.reportInstanceId = id;
        scope.load();
    }

    function bindEvents() {
        $('#sreBackBtn').off('click').on('click', function () {
            _appRouter.routeTo('sales-forecasting-grid');
        });
        $('#sreRefreshBtn').off('click').on('click', function () {
            _salesReportEditor.refreshFigures();
        });
        $('#sreExecutiveSummary').off('blur').on('blur', function () {
            _salesReportEditor.saveExecutiveSummary();
        });
    }

    function showInvalidIdState() {
        var loading = document.getElementById('sreLoadingState');
        var content = document.getElementById('sreContent');
        if (content) content.classList.add('d-none');
        if (loading) {
            loading.classList.remove('d-none');
            loading.innerHTML = macEmptyState('fa-triangle-exclamation', 'No report selected',
                'Choose a report from the list to open it. Returning to the list…');
        }
        setTimeout(function () { _appRouter.routeTo('sales-forecasting-grid'); }, 2000);
    }

    async function load() {
        var scope = _salesReportEditor;
        var loading = document.getElementById('sreLoadingState');
        var content = document.getElementById('sreContent');
        if (content) content.classList.add('d-none');
        if (loading) {
            loading.classList.remove('d-none');
            loading.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Loading report…';
        }

        try {
            var report = await dataFunctions.getReportInstance(state.reportInstanceId, true);
            if (!report) {
                if (loading) {
                    loading.innerHTML = macEmptyState('fa-file-circle-question', 'Report not found',
                        'It may have been deleted. Use Back to reports to return to the list.');
                }
                return;
            }
            state.report = report;
            state.readOnly = report.status !== 'draft';
            scope.renderHeader();
            scope.renderExecutiveSummary();
            scope.renderSections();
            if (loading) loading.classList.add('d-none');
            if (content) content.classList.remove('d-none');
        } catch (e) {
            // Thrown means the RPC itself is unavailable (e.g. schema-cache miss before this
            // migration is applied) — a degraded screen, not a business-logic failure.
            if (loading) {
                loading.innerHTML = macEmptyState('fa-triangle-exclamation', 'This report could not be loaded',
                    'The report service could not be reached. Try again in a moment.');
            }
        }
    }

    function renderHeader() {
        var report = state.report;
        var periodLabel = typeof report.period_label === 'string' ? report.period_label.replace(/\s+/g, ' ').trim() : '';
        var h1 = document.getElementById('sreHeaderPeriodLabel');
        if (h1) h1.textContent = periodLabel || 'Report';

        var dateRange = document.getElementById('sreHeaderDateRange');
        if (dateRange) dateRange.textContent = fromIsoDate(report.period_start) + ' – ' + fromIsoDate(report.period_end);

        var badge = document.getElementById('sreStatusBadge');
        if (badge) badge.innerHTML = MacStatus.pill(report.status);

        var banner = document.getElementById('sreReadOnlyBanner');
        if (banner) banner.classList.toggle('d-none', !state.readOnly);

        var refreshBtn = document.getElementById('sreRefreshBtn');
        if (refreshBtn) refreshBtn.disabled = state.readOnly;
    }

    function renderExecutiveSummary() {
        var el = document.getElementById('sreExecutiveSummary');
        if (!el) return;
        el.value = state.report.executive_summary || '';
        el.disabled = state.readOnly;
    }

    async function saveExecutiveSummary() {
        if (state.readOnly) return;
        var el = document.getElementById('sreExecutiveSummary');
        if (!el || !state.report) return;
        var newVal = el.value;
        var oldVal = state.report.executive_summary || '';
        if (newVal === oldVal) return;

        try {
            var outcome = await dataFunctions.setReportExecutiveSummary(state.reportInstanceId, newVal);
            if (outcome && Number(outcome.success) === 1) {
                state.report.executive_summary = newVal.trim() === '' ? null : newVal;
                toast('Executive summary saved.', 'success');
            } else {
                el.value = oldVal;
                toast((outcome && outcome.error) || 'Could not save the executive summary.', 'error');
            }
        } catch (e) {
            el.value = oldVal;
            toast('The report service could not be reached. Try again in a moment.', 'error');
        }
    }

    function renderSections() {
        var container = document.getElementById('sreSectionsAccordion');
        if (!container) return;
        container.innerHTML = '';
        var sections = Array.isArray(state.report.sections) ? state.report.sections : [];
        if (sections.length === 0) {
            var empty = document.createElement('p');
            empty.className = 'text-muted';
            empty.textContent = 'This report has no sections configured.';
            container.appendChild(empty);
            return;
        }
        sections.forEach(function (section, idx) {
            container.appendChild(buildSectionAccordionItem(section, idx));
        });
    }

    function buildSectionAccordionItem(section, idx) {
        var id = domId(section.section_key, idx);

        var item = document.createElement('div');
        item.className = 'accordion-item';

        var header = document.createElement('h2');
        header.className = 'accordion-header';

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'accordion-button' + (idx === 0 ? '' : ' collapsed');
        btn.setAttribute('data-bs-toggle', 'collapse');
        btn.setAttribute('data-bs-target', '#' + id + '-body');
        btn.setAttribute('aria-expanded', idx === 0 ? 'true' : 'false');

        if (!section.is_enabled) {
            var offBadge = document.createElement('span');
            offBadge.className = 'me-2';
            offBadge.innerHTML = MacStatus.pill('disabled', 'Off');
            btn.appendChild(offBadge);
        }
        var labelSpan = document.createElement('span');
        labelSpan.textContent = section.label || section.section_key || '—';
        btn.appendChild(labelSpan);

        header.appendChild(btn);
        item.appendChild(header);

        var collapse = document.createElement('div');
        collapse.id = id + '-body';
        collapse.className = 'accordion-collapse collapse' + (idx === 0 ? ' show' : '');

        var body = document.createElement('div');
        body.className = 'accordion-body';

        body.appendChild(buildSectionToggle(section, id));
        body.appendChild(buildSectionCommentary(section, id));

        if (section.render_kind === 'metric_table' && Array.isArray(section.metrics) && section.metrics.length) {
            body.appendChild(buildMetricsTable(section));
        } else if (Array.isArray(section.lines) && section.lines.length) {
            body.appendChild(buildLinesTable(section.lines));
        } else {
            var noData = document.createElement('p');
            noData.className = 'text-muted small mb-0';
            noData.textContent = 'No data captured for this section yet.';
            body.appendChild(noData);
        }

        collapse.appendChild(body);
        item.appendChild(collapse);
        return item;
    }

    function buildSectionToggle(section, id) {
        var wrap = document.createElement('div');
        wrap.className = 'form-check form-switch mb-2';

        var input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'form-check-input';
        input.id = id + '-toggle';
        input.checked = !!section.is_enabled;
        input.disabled = state.readOnly;
        input.addEventListener('change', function () {
            var newVal = input.checked;
            saveSectionState(section.section_key, newVal, undefined).then(function (ok) {
                if (ok) {
                    section.is_enabled = newVal;
                } else {
                    input.checked = !newVal;
                }
            });
        });

        var label = document.createElement('label');
        label.className = 'form-check-label';
        label.setAttribute('for', input.id);
        label.textContent = 'Include this section in the report';

        wrap.appendChild(input);
        wrap.appendChild(label);
        return wrap;
    }

    function buildSectionCommentary(section, id) {
        var wrap = document.createElement('div');
        wrap.className = 'mb-3';

        var label = document.createElement('label');
        label.className = 'form-label small text-muted mb-1';
        label.setAttribute('for', id + '-commentary');
        label.textContent = 'Commentary';
        wrap.appendChild(label);

        var textarea = document.createElement('textarea');
        textarea.className = 'form-control';
        textarea.id = id + '-commentary';
        textarea.rows = 2;
        textarea.value = section.commentary || '';
        textarea.disabled = state.readOnly;
        textarea.addEventListener('blur', function () {
            var newVal = textarea.value;
            var oldVal = section.commentary || '';
            if (newVal === oldVal) return;
            saveSectionState(section.section_key, undefined, newVal).then(function (ok) {
                if (ok) {
                    section.commentary = newVal;
                } else {
                    textarea.value = oldVal;
                }
            });
        });
        wrap.appendChild(textarea);
        return wrap;
    }

    /**
     * isEnabled/commentary: pass `undefined` for whichever one is not changing — the wrapper
     * always strips undefined, leaving that field alone server-side (see setReportSectionState
     * in data-functions.js). Only a defined value (including '') is ever sent for the other.
     */
    async function saveSectionState(sectionKey, isEnabled, commentary) {
        if (state.readOnly) return false;
        try {
            var outcome = await dataFunctions.setReportSectionState(state.reportInstanceId, sectionKey, isEnabled, commentary);
            if (outcome && Number(outcome.success) === 1) {
                toast('Saved.', 'success');
                return true;
            }
            toast((outcome && outcome.error) || 'Could not update this section.', 'error');
            return false;
        } catch (e) {
            toast('The report service could not be reached. Try again in a moment.', 'error');
            return false;
        }
    }

    function buildMetricsTable(section) {
        var wrap = document.createElement('div');
        wrap.className = 'table-responsive';

        var table = document.createElement('table');
        table.className = 'table table-sm align-middle mb-0';

        var thead = document.createElement('thead');
        var headRow = document.createElement('tr');
        ['Metric', 'System', 'Entered', 'Target', 'Achieved %', 'Status'].forEach(function (text, i) {
            var th = document.createElement('th');
            if (i > 0 && i < 5) th.className = 'text-end';
            th.textContent = text;
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);

        var tbody = document.createElement('tbody');
        var ctx = {
            reportInstanceId: state.reportInstanceId,
            readOnly: state.readOnly,
            onChanged: function () { _salesReportEditor.load(); }
        };
        section.metrics.forEach(function (m) {
            tbody.appendChild(MacReportMetricLine.render(m, ctx));
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    /** Generic key/value renderer for line_table / tracking_table sections — every payload key
     *  is DB-sourced, so each value is written with textContent, never innerHTML. */
    function buildLinesTable(lines) {
        var wrap = document.createElement('div');
        wrap.className = 'table-responsive';

        var table = document.createElement('table');
        table.className = 'table table-sm table-borderless mb-0 small';
        var tbody = document.createElement('tbody');

        lines.forEach(function (line) {
            var tr = document.createElement('tr');
            var td = document.createElement('td');
            var payload = (line && typeof line.payload === 'object' && line.payload) ? line.payload : {};
            var keys = Object.keys(payload);
            if (keys.length === 0) {
                td.textContent = '—';
            } else {
                keys.forEach(function (key) {
                    var val = payload[key];
                    var span = document.createElement('span');
                    span.className = 'me-3';
                    span.textContent = key + ': ' + (val === null || val === undefined ? '—' : String(val));
                    td.appendChild(span);
                });
            }
            tr.appendChild(td);
            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        wrap.appendChild(table);
        return wrap;
    }

    async function refreshFigures() {
        if (state.readOnly) {
            toast('Published reports cannot be refreshed.', 'error');
            return;
        }
        var btn = document.getElementById('sreRefreshBtn');
        if (btn) btn.disabled = true;
        try {
            var outcome = await dataFunctions.refreshReportInstance(state.reportInstanceId);
            if (outcome && Number(outcome.success) === 1) {
                toast('Figures refreshed.', 'success');
                await _salesReportEditor.load();
            } else {
                toast((outcome && outcome.error) || 'Could not refresh this report.', 'error');
            }
        } catch (e) {
            toast('The report service could not be reached. Try again in a moment.', 'error');
        } finally {
            if (btn) btn.disabled = state.readOnly;
        }
    }

    return {
        init: init,
        bindEvents: bindEvents,
        load: load,
        showInvalidIdState: showInvalidIdState,
        renderHeader: renderHeader,
        renderExecutiveSummary: renderExecutiveSummary,
        renderSections: renderSections,
        saveExecutiveSummary: saveExecutiveSummary,
        refreshFigures: refreshFigures,
        isValidUuid: isValidUuid
    };
})();

window._salesReportEditor = _salesReportEditor;

function initializeSalesReportEditor() {
    _salesReportEditor.init();
}
window.initializeSalesReportEditor = initializeSalesReportEditor;
