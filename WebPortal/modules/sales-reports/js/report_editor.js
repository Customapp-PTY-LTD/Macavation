/**
 * Sales & Production Reports — report editor.
 * Follows the company module pattern (IIFE, init()/destroy(), namespaced events) per
 * BluePrint/javascript-jquery-rules.md, modelled on report_list_grid.js in this same module.
 *
 * Every database/user-entered value (labels, commentary, override reasons, the executive
 * summary, overridden_by_name) reaches the DOM only via .text() or a shared self-escaping
 * helper (MacStatus.pill, macEmptyState) given a STATIC label — never a payload value through
 * .html()/innerHTML/string concatenation.
 *
 * No deep-linking: the report id is read from Session ('currentReportId'), never from a route
 * argument (initializeModule(routeName) is called with no other params — appRouter.js:252).
 *
 * data-action-perm is swept once over static markup shortly after load (appRouter.js:253-256)
 * and is inert on anything rendered afterwards. The "Refresh figures" button is static markup
 * so it may carry data-action-perm; every metric row is rendered after that sweep, so its
 * editability is gated with an inline hasAction() check instead.
 */
var _reportEditor = function () {
    'use strict';

    var REPORT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    var state = {
        reportId: null,
        payload: null,
        pendingExecSummary: false
    };

    // In-flight guards, keyed by metric_key / section_key. A Map (not a plain object) so a
    // payload string can never collide with a prototype property.
    var pendingOverrides = new Map();
    var pendingCommentary = new Map();

    // ------------------------------------------------------------------
    // Local helpers — private to this file (report_list_grid.js's helpers are not exported).
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

    // Reject __proto__/constructor before a payload string is ever used as a Map key.
    function safeKey(key) {
        var s = String(key == null ? '' : key);
        if (s === '__proto__' || s === 'constructor' || s === 'prototype' || s === '') return '';
        return s;
    }

    // String-slice only (no Date arithmetic, no toISOString) — same idiom as report_list_grid.js.
    function formatDateOnly(value) {
        var s = displayLabel(value);
        if (!s) return '';
        var idx = s.indexOf('T');
        return idx > -1 ? s.slice(0, idx) : s;
    }

    function isRpcSuccess(result) {
        var row = firstRpcRow(result);
        return Number(row && row.success) === 1;
    }

    function rpcError(result, fallback) {
        var row = firstRpcRow(result);
        return (row && row.error) ? row.error : fallback;
    }

    // ------------------------------------------------------------------
    // Report id — Session-only, validated before every RPC call.
    // ------------------------------------------------------------------

    function getCurrentReportId() {
        try {
            var id = (typeof Session !== 'undefined' && Session.get) ? Session.get('currentReportId') : null;
            return isReportUuid(id) ? id : null;
        } catch (e) {
            return null;
        }
    }

    function routeBackToList() {
        if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
            _appRouter.routeTo('sales-forecasting-grid', true);
        }
    }

    // ------------------------------------------------------------------
    // Screen states — loading / empty / locked-banner / content.
    // ------------------------------------------------------------------

    function showLoadingState() {
        $('#reportEditorLoadingState').removeClass('d-none');
        $('#reportEditorContent').addClass('d-none');
        $('#reportEditorEmptyState').addClass('d-none').empty();
        $('#reportEditorLockedBanner').addClass('d-none').text('');
    }

    function showEmptyState(icon, title, hint) {
        $('#reportEditorLoadingState').addClass('d-none');
        $('#reportEditorContent').addClass('d-none');
        $('#reportEditorLockedBanner').addClass('d-none').text('');
        // macEmptyState escapes its own arguments; every argument here is a static string this
        // file authors, never a payload value.
        $('#reportEditorEmptyState').html(macEmptyState(icon, title, hint)).removeClass('d-none');
    }

    function hideTransientStates() {
        $('#reportEditorLoadingState').addClass('d-none');
        $('#reportEditorEmptyState').addClass('d-none').empty();
    }

    // ------------------------------------------------------------------
    // Locked banner — derived only from the payload's own status/published_at.
    // ------------------------------------------------------------------

    function renderLockedBanner(payload) {
        var $banner = $('#reportEditorLockedBanner');
        if (payload.status === 'draft') {
            $banner.addClass('d-none').text('');
            return;
        }
        var publishedAtRaw = payload.published_at;
        var hasPublishedAt = publishedAtRaw !== null && publishedAtRaw !== undefined && String(publishedAtRaw).trim() !== '';
        var dateStr = hasPublishedAt ? formatDateOnly(publishedAtRaw) : '';
        var text;
        if (payload.status === 'published' && hasPublishedAt) {
            text = 'Published ' + dateStr + '\u2014figures are locked.';
        } else if (payload.status === 'superseded') {
            text = 'Superseded\u2014figures are locked.';
            if (hasPublishedAt) text += ' Published ' + dateStr + '.';
        } else {
            text = 'Figures are locked.';
        }
        $banner.text(text).removeClass('d-none');
    }

    // ------------------------------------------------------------------
    // Section / metric-table rendering.
    // ------------------------------------------------------------------

    function buildEmptyRenderKindBody() {
        // macEmptyState escapes its own arguments; both strings here are static.
        return $(macEmptyState('fa-database', 'Not available yet', "Populated when this section's data source is connected."));
    }

    function buildMetricTableBody(section, editable) {
        var $table = $('<table>', { 'class': 'table table-sm align-middle mb-0' });
        var $thead = $('<thead>').append(
            $('<tr>')
                .append($('<th>').text('Description'))
                .append($('<th>').text('System'))
                .append($('<th>').text('Entered'))
                .append($('<th>').text('Target'))
                .append($('<th>').text('Achieved %'))
                .append($('<th>').text('Status'))
        );
        var $tbody = $('<tbody>');
        var metrics = Array.isArray(section.metrics) ? section.metrics : [];
        metrics.forEach(function (metric) {
            $tbody.append(ReportMetricLine.buildMetricRow(metric, { editable: editable }));
        });
        $table.append($thead).append($tbody);
        return $table;
    }

    function buildSectionAccordionItem(section, index, isEditable, statusDraft) {
        var sectionKey = safeKey(section.section_key);
        var collapseId = 'reportEditorSectionBody' + index;

        var $item = $('<div>', { 'class': 'accordion-item' });

        var $headerButton = $('<button>', {
            type: 'button',
            'class': 'accordion-button d-flex align-items-center',
            'data-bs-toggle': 'collapse',
            'data-bs-target': '#' + collapseId
        }).attr('aria-expanded', 'true');
        $headerButton.append($('<span>', { 'class': 'flex-grow-1' }).text(displayLabel(section.label)));

        if (statusDraft) {
            var $switchWrap = $('<div>', { 'class': 'form-check form-switch ms-3 js-section-toggle-wrap' });
            var $switchInput = $('<input>', {
                type: 'checkbox',
                'class': 'form-check-input js-section-toggle'
            }).attr('data-section-key', sectionKey);
            $switchInput.prop('checked', !!section.is_enabled);
            if (!isEditable) $switchInput.prop('disabled', true);
            $switchWrap.append($switchInput);
            $headerButton.append($switchWrap);
        }

        var $header = $('<h2>', { 'class': 'accordion-header' }).append($headerButton);
        $item.append($header);

        var $collapse = $('<div>', { id: collapseId, 'class': 'accordion-collapse collapse show' });
        var $body = $('<div>', { 'class': 'accordion-body' });

        if (section.render_kind === 'metric_table') {
            $body.append(buildMetricTableBody(section, isEditable && statusDraft));
        } else {
            $body.append(buildEmptyRenderKindBody());
        }

        var commentaryId = 'reportEditorSectionCommentary' + index;
        var $commentaryLabel = $('<label>', { 'class': 'form-label small text-muted mt-3', 'for': commentaryId }).text('Commentary');
        var $commentary = $('<textarea>', {
            id: commentaryId,
            'class': 'form-control js-section-commentary',
            rows: 2
        }).attr('data-section-key', sectionKey);
        var commentaryVal = section.commentary == null ? '' : String(section.commentary);
        $commentary.val(commentaryVal);
        $commentary.data('lastValue', commentaryVal);
        if (!isEditable || !statusDraft) $commentary.prop('disabled', true);
        $body.append($commentaryLabel).append($commentary);

        $collapse.append($body);
        $item.append($collapse);
        return $item;
    }

    // ------------------------------------------------------------------
    // Full render from a payload.
    // ------------------------------------------------------------------

    function renderPayload(payload) {
        hideTransientStates();

        var statusDraft = payload.status === 'draft';
        var isEditable = statusDraft && typeof hasAction === 'function' && hasAction('reports.report.edit');

        $('#reportEditorTitle').text(displayLabel(payload.period_label));
        $('#reportEditorSubtitle').text(displayLabel(payload.period_start) + ' \u2013 ' + displayLabel(payload.period_end));

        renderLockedBanner(payload);

        var $summary = $('#reportEditorExecSummary');
        var summaryVal = payload.executive_summary == null ? '' : String(payload.executive_summary);
        $summary.val(summaryVal);
        $summary.data('lastValue', summaryVal);
        $summary.prop('disabled', !isEditable);

        $('#reportEditorRefreshFiguresBtn').prop('disabled', !statusDraft);

        var $accordion = $('#reportEditorAccordion').empty();
        var sections = Array.isArray(payload.sections) ? payload.sections : [];
        sections.forEach(function (section, idx) {
            $accordion.append(buildSectionAccordionItem(section, idx, isEditable, statusDraft));
        });

        $('#reportEditorContent').removeClass('d-none');
    }

    // ------------------------------------------------------------------
    // Loading.
    // ------------------------------------------------------------------

    function handleMissingReportId() {
        console.warn('[sales-reports] report editor opened with no valid report id');
        showEmptyState('fa-file-invoice', 'No report selected', 'Return to the report list and open a report again.');
        routeBackToList();
    }

    function load() {
        showLoadingState();
        var id = getCurrentReportId();
        if (!id) {
            handleMissingReportId();
            return;
        }
        state.reportId = id;
        dataFunctions.getReportInstance(id).then(function (payload) {
            if (!payload) {
                showEmptyState('fa-file-invoice', 'Report not found', 'This report could not be found. It may have been deleted.');
                return;
            }
            state.payload = payload;
            renderPayload(payload);
        }).catch(function (err) {
            console.warn('[sales-reports] getReportInstance failed', err);
            showEmptyState('fa-file-invoice', 'This report cannot be loaded', 'The report-builder migrations have not been applied to this database.');
        });
    }

    // A save/refresh RPC already succeeded when this is called; a failure here must not
    // discard what is already on screen (deliverable 5) — just log and leave the DOM as-is.
    function reloadAndRerender() {
        if (!state.reportId) return Promise.resolve();
        return dataFunctions.getReportInstance(state.reportId, null, true).then(function (fresh) {
            if (!fresh) {
                showEmptyState('fa-file-invoice', 'Report not found', 'This report could not be found. It may have been deleted.');
                return;
            }
            state.payload = fresh;
            renderPayload(fresh);
        }).catch(function (err) {
            console.warn('[sales-reports] could not refresh report after save', err);
        });
    }

    // ------------------------------------------------------------------
    // Metric override / clear.
    // ------------------------------------------------------------------

    function handleMetricBlur($input) {
        var metricKey = safeKey($input.attr('data-metric-key'));
        if (!metricKey || !state.reportId) return;

        var newVal = String($input.val() == null ? '' : $input.val()).trim();
        var lastVal = String($input.data('lastValue') == null ? '' : $input.data('lastValue'));
        if (newVal === lastVal) return;

        if (pendingOverrides.has(metricKey)) return;
        pendingOverrides.set(metricKey, true);

        var finish = function () { pendingOverrides.delete(metricKey); };

        if (newVal === '') {
            dataFunctions.clearReportMetricOverride(state.reportId, metricKey).then(function (result) {
                if (isRpcSuccess(result)) {
                    $input.data('lastValue', '');
                    return reloadAndRerender();
                }
                Swal.fire({ icon: 'error', title: 'Could not clear override', text: rpcError(result, 'Could not clear the override.') });
                $input.val(lastVal);
            }).catch(function (err) {
                console.warn('[sales-reports] clearReportMetricOverride failed', err);
                Swal.fire({ icon: 'error', title: 'Could not clear override', text: 'Could not save this change. Please try again.' });
                $input.val(lastVal);
            }).finally(finish);
            return;
        }

        var numVal = Number(newVal);
        if (!Number.isFinite(numVal)) {
            Swal.fire({ icon: 'error', title: 'Invalid value', text: 'Enter a valid number.' });
            $input.val(lastVal);
            finish();
            return;
        }

        Swal.fire({
            input: 'text',
            inputLabel: 'Reason for overriding this figure',
            inputValidator: function (v) { return (!v || !v.trim()) && 'A reason is required'; },
            showCancelButton: true
        }).then(function (result) {
            if (!result.isConfirmed) {
                $input.val(lastVal);
                finish();
                return;
            }
            dataFunctions.overrideReportMetricValue(state.reportId, metricKey, numVal, result.value).then(function (rpcResult) {
                if (isRpcSuccess(rpcResult)) {
                    $input.data('lastValue', String(numVal));
                    return reloadAndRerender();
                }
                Swal.fire({ icon: 'error', title: 'Could not save override', text: rpcError(rpcResult, 'Could not save the override.') });
                $input.val(lastVal);
            }).catch(function (err) {
                console.warn('[sales-reports] overrideReportMetricValue failed', err);
                Swal.fire({ icon: 'error', title: 'Could not save override', text: 'Could not save this figure. Please try again.' });
                $input.val(lastVal);
            }).finally(finish);
        }).catch(function (err) {
            console.warn('[sales-reports] override reason prompt failed', err);
            $input.val(lastVal);
            finish();
        });
    }

    // ------------------------------------------------------------------
    // Section toggle / commentary / executive summary.
    // ------------------------------------------------------------------

    function handleSectionToggle($checkbox) {
        var sectionKey = safeKey($checkbox.attr('data-section-key'));
        if (!sectionKey || !state.reportId) return;
        var newVal = $checkbox.prop('checked');
        $checkbox.prop('disabled', true);
        dataFunctions.setReportSectionState(state.reportId, sectionKey, { is_enabled: newVal }).then(function (result) {
            if (isRpcSuccess(result)) {
                return reloadAndRerender();
            }
            Swal.fire({ icon: 'error', title: 'Could not update section', text: rpcError(result, 'Could not update the section.') });
            $checkbox.prop('checked', !newVal).prop('disabled', false);
        }).catch(function (err) {
            console.warn('[sales-reports] setReportSectionState (toggle) failed', err);
            Swal.fire({ icon: 'error', title: 'Could not update section', text: 'Could not save this change. Please try again.' });
            $checkbox.prop('checked', !newVal).prop('disabled', false);
        });
    }

    function handleCommentaryBlur($textarea) {
        var sectionKey = safeKey($textarea.attr('data-section-key'));
        if (!sectionKey || !state.reportId) return;

        var newVal = String($textarea.val() == null ? '' : $textarea.val());
        var lastVal = String($textarea.data('lastValue') == null ? '' : $textarea.data('lastValue'));
        if (newVal === lastVal) return;

        if (pendingCommentary.has(sectionKey)) return;
        pendingCommentary.set(sectionKey, true);

        dataFunctions.setReportSectionState(state.reportId, sectionKey, { commentary: newVal }).then(function (result) {
            if (isRpcSuccess(result)) {
                $textarea.data('lastValue', newVal);
                return reloadAndRerender();
            }
            Swal.fire({ icon: 'error', title: 'Could not save commentary', text: rpcError(result, 'Could not save the commentary.') });
            $textarea.val(lastVal);
        }).catch(function (err) {
            console.warn('[sales-reports] setReportSectionState (commentary) failed', err);
            Swal.fire({ icon: 'error', title: 'Could not save commentary', text: 'Could not save this change. Please try again.' });
            $textarea.val(lastVal);
        }).finally(function () {
            pendingCommentary.delete(sectionKey);
        });
    }

    function handleExecSummaryBlur($textarea) {
        if (!state.reportId) return;
        var newVal = String($textarea.val() == null ? '' : $textarea.val());
        var lastVal = String($textarea.data('lastValue') == null ? '' : $textarea.data('lastValue'));
        if (newVal === lastVal) return;

        if (state.pendingExecSummary) return;
        state.pendingExecSummary = true;

        dataFunctions.setReportExecutiveSummary(state.reportId, newVal).then(function (result) {
            if (isRpcSuccess(result)) {
                $textarea.data('lastValue', newVal);
                return reloadAndRerender();
            }
            Swal.fire({ icon: 'error', title: 'Could not save summary', text: rpcError(result, 'Could not save the executive summary.') });
            $textarea.val(lastVal);
        }).catch(function (err) {
            console.warn('[sales-reports] setReportExecutiveSummary failed', err);
            Swal.fire({ icon: 'error', title: 'Could not save summary', text: 'Could not save this change. Please try again.' });
            $textarea.val(lastVal);
        }).finally(function () {
            state.pendingExecSummary = false;
        });
    }

    function handleRefreshFigures() {
        if (!state.reportId) return;
        var $btn = $('#reportEditorRefreshFiguresBtn');
        $btn.prop('disabled', true);
        dataFunctions.refreshReportInstance(state.reportId).then(function (result) {
            if (isRpcSuccess(result)) {
                var row = firstRpcRow(result);
                var count = Number(row && row.metrics_refreshed) || 0;
                return reloadAndRerender().then(function () {
                    Swal.fire({ icon: 'success', title: 'Figures refreshed', text: count + ' metric' + (count === 1 ? '' : 's') + ' refreshed.' });
                });
            }
            Swal.fire({ icon: 'error', title: 'Could not refresh figures', text: rpcError(result, 'Could not refresh figures.') });
        }).catch(function (err) {
            console.warn('[sales-reports] refreshReportInstance failed', err);
            Swal.fire({ icon: 'error', title: 'Could not refresh figures', text: 'Could not refresh figures. Please try again.' });
        }).finally(function () {
            $btn.prop('disabled', !(state.payload && state.payload.status === 'draft'));
        });
    }

    // ------------------------------------------------------------------
    // Event wiring — every binding namespaced ".reportEditor"; destroy() removes them all.
    // ------------------------------------------------------------------

    function bindEvents() {
        $(document).on('click.reportEditor', '#reportEditorBackBtn', function (e) {
            e.preventDefault();
            routeBackToList();
        });
        $(document).on('click.reportEditor', '#reportEditorRefreshFiguresBtn', function () {
            handleRefreshFigures();
        });
        $(document).on('blur.reportEditor', '.js-report-metric-input', function () {
            handleMetricBlur($(this));
        });
        $(document).on('change.reportEditor', '.js-section-toggle', function () {
            handleSectionToggle($(this));
        });
        $(document).on('blur.reportEditor', '.js-section-commentary', function () {
            handleCommentaryBlur($(this));
        });
        $(document).on('blur.reportEditor', '#reportEditorExecSummary', function () {
            handleExecSummaryBlur($(this));
        });
        // Keep the accordion open/closed toggle from also flipping the enable/disable switch.
        $(document).on('click.reportEditor', '.js-section-toggle-wrap', function (e) {
            e.stopPropagation();
        });
    }

    return {
        init: function () {
            _reportEditor.destroy();
            state.reportId = null;
            state.payload = null;
            state.pendingExecSummary = false;
            pendingOverrides.clear();
            pendingCommentary.clear();
            bindEvents();
            load();
        },

        destroy: function () {
            $(document).off('.reportEditor');
        }
    };
}();

function initializeReportEditor() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _reportEditor.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}
