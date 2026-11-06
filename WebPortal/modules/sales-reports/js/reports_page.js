/**
 * Management reports page — the Weekly report / Monthly report / All figures tabs.
 * Hosts one embedded report editor (_reportEditor.openEmbedded) beside a history list.
 *
 * Contract with the rest of the module:
 *   - report_list.html provides #reportsTabs, #reportsPaneReport (shared by Weekly + Monthly),
 *     #reportsPaneAll / #reportsAllHost, #reportsHistoryList, #reportsEditorHost and the bar ids.
 *   - report_list_grid.js (the router entry) calls _reportsPage.init() and routes "open this
 *     report" to _reportsPage.openInstance(id).
 *   - Data: dataFunctions.ensureReportDrafts() and dataFunctions.listReportHistory(type, limit, force).
 *
 * Every database value reaches the DOM through .text(); there is no raw .html() of data here.
 * Events are namespaced ".reportsPage" and removed by destroy() / the start of init().
 */
var _reportsPage = function () {
    'use strict';

    var REPORT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    var HISTORY_LIMIT = 30;
    var EDITOR_HTML = '/sales-reports/html/report_editor.html';
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var state = {
        tab: 'weekly',
        items: { weekly: [], monthly: [] },
        selectedId: null,
        userPicked: false,
        editorReady: false,
        allShown: false,
        openToken: 0,
        historyToken: 0,
        initHostEl: null
    };

    // ------------------------------------------------------------------
    // Helpers.
    // ------------------------------------------------------------------

    function isUuid(v) {
        return typeof v === 'string' && REPORT_UUID_RE.test(v);
    }

    function unwrap(result) {
        return Array.isArray(result) ? (result[0] || null) : result;
    }

    // "Mon 2 Nov". A date-only value ("2026-11-02") is read by string split so no timezone can
    // move it; a full timestamp is shown in the viewer's local time.
    function fmtDay(value) {
        if (value == null || value === '') return '';
        var s = String(value);
        var d;
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
            return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
        }
        d = new Date(s);
        if (isNaN(d.getTime())) return '';
        return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    }

    function fmtTime(value) {
        var d = new Date(String(value || ''));
        if (isNaN(d.getTime())) return '';
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    // Chip rules shared by the history rows and the bar: {text, cls}.
    function statusChip(item) {
        var cls = {
            draft: 'bg-warning-subtle text-warning-emphasis',
            danger: 'bg-danger-subtle text-danger-emphasis',
            sent: 'bg-success-subtle text-success-emphasis',
            muted: 'bg-secondary-subtle text-secondary-emphasis'
        };
        if (item.overdue && (item.status === 'draft' || item.send_state === 'not_sent' || !item.send_state)) {
            return { text: 'Overdue', cls: cls.danger };
        }
        if (item.status === 'draft') return { text: 'Draft', cls: cls.draft };
        switch (item.send_state) {
            case 'sent': return { text: 'Sent ' + fmtDay(item.first_sent_at), cls: cls.sent };
            case 'sent_late': return { text: 'Sent late · ' + fmtDay(item.first_sent_at), cls: cls.danger };
            case 'failed_only': return { text: 'Send failed', cls: cls.danger };
            default: return { text: 'Published, not sent', cls: cls.muted };
        }
    }

    function chipEl(item) {
        var c = statusChip(item);
        return $('<span class="badge fw-semibold">').addClass(c.cls).text(c.text);
    }

    function itemLabel(item) {
        var label = String(item.label == null ? '' : item.label).replace(/\s+/g, ' ').trim();
        var v = Number(item.version);
        return label + (Number.isFinite(v) && v > 1 ? ' · v' + v : '');
    }

    function findItem(id) {
        var all = state.items.weekly.concat(state.items.monthly);
        for (var i = 0; i < all.length; i++) {
            if (all[i].id === id) return all[i];
        }
        return null;
    }

    function typeOfItem(id) {
        if (state.items.weekly.some(function (x) { return x.id === id; })) return 'weekly';
        if (state.items.monthly.some(function (x) { return x.id === id; })) return 'monthly';
        return null;
    }

    function showAlert($target, text) {
        $target.empty().append($('<div class="alert alert-warning mb-0" role="alert">').text(text));
    }

    // ------------------------------------------------------------------
    // History list + bar.
    // ------------------------------------------------------------------

    function renderHistory() {
        var $list = $('#reportsHistoryList').empty();
        var items = state.items[state.tab] || [];
        $('#reportsHistoryHeading').text(state.tab === 'monthly' ? 'Monthly reports' : 'Weekly reports');
        if (!items.length) {
            $list.append($('<div class="small text-muted px-2 py-3">').text('No reports yet.'));
            return;
        }
        items.forEach(function (item) {
            var $row = $('<button type="button" class="list-group-item list-group-item-action d-flex align-items-center flex-wrap gap-1 px-2 js-reports-history-row">')
                .attr('data-report-id', item.id)
                .toggleClass('active', item.id === state.selectedId);
            $row.append($('<span class="fw-semibold small">').text(itemLabel(item)));
            $row.append(chipEl(item).addClass('ms-auto'));
            $list.append($row);
        });
    }

    function renderBar(item) {
        var $title = $('#reportsBarTitle');
        var $sub = $('#reportsBarSub');
        var $status = $('#reportsBarStatus').empty();
        var $del = $('#reportsDeleteBtn');
        if (!item) {
            $title.text('');
            $sub.text('');
            $del.addClass('d-none').removeAttr('data-report-id');
            return;
        }
        $title.text(itemLabel(item));
        $status.append(chipEl(item));
        var parts = [];
        if (item.generated_at) {
            var t = fmtTime(item.generated_at);
            parts.push('Drafted ' + fmtDay(item.generated_at) + (t ? ' ' + t : ''));
        }
        var due = fmtDay(item.due_date);
        if (due) {
            parts.push(item.period_type === 'monthly' || state.tab === 'monthly'
                ? 'Aim to send by ' + due
                : 'Due: end of ' + due);
        }
        $sub.text(parts.join(' · '));
        $del.attr('data-report-id', item.id).toggleClass('d-none', item.status !== 'draft');
    }

    // Fetches one period type's history. Resolves to an array (never rejects).
    function fetchHistory(type, force) {
        return Promise.resolve().then(function () {
            return dataFunctions.listReportHistory(type, HISTORY_LIMIT, !!force);
        }).then(function (res) {
            var r = unwrap(res);
            if (!r || r.success === false) throw new Error((r && (r.error || r.message)) || 'Could not load the report history.');
            return Array.isArray(r.items) ? r.items : [];
        });
    }

    // Loads the current tab's history. opts.keepSelection leaves an already-selected report open;
    // otherwise (or if nothing valid is selected) the newest report is opened.
    function loadHistory(force, opts) {
        opts = opts || {};
        var token = ++state.historyToken;
        var type = state.tab;
        var $list = $('#reportsHistoryList');
        if (!state.items[type].length) {
            $list.empty().append($('<div class="small text-muted px-2 py-3">').text('Loading…'));
        }
        return fetchHistory(type, force).then(function (items) {
            if (token !== state.historyToken || type !== state.tab) return;
            state.items[type] = items;
            var keep = opts.keepSelection && state.selectedId && items.some(function (x) { return x.id === state.selectedId; });
            if (keep) {
                renderHistory();
                renderBar(findItem(state.selectedId));
                return;
            }
            if (!items.length) {
                state.selectedId = null;
                renderHistory();
                renderBar(null);
                $('#reportsEditorHost').empty().append($('<div class="alert alert-info mb-0">')
                    .text('There are no ' + type + ' reports yet. They are drafted automatically; use "Other period…" to make one now.'));
                state.editorReady = false;
                return;
            }
            state.selectedId = items[0].id;
            renderHistory();
            renderBar(items[0]);
            openSelected();
        }).catch(function (err) {
            if (token !== state.historyToken) return;
            console.warn('[reports] listReportHistory failed', err);
            $list.empty().append($('<div class="alert alert-warning m-2" role="alert">')
                .text('Could not load the report history. Try again with "Reload list".'));
            showAlert($('#reportsEditorHost'), 'Could not load the report history: ' + (err && err.message ? err.message : 'unknown error') + '.');
            state.editorReady = false;
        });
    }

    var lastOpenedId = null;

    // ------------------------------------------------------------------
    // Embedded editor.
    // ------------------------------------------------------------------

    function canOpenEditor() {
        if (typeof roleMenuConfig === 'undefined' || !roleMenuConfig.getUserRole()) return true;
        return roleMenuConfig.hasAccess('sales-report-editor') === true;
    }

    function basePath() {
        return (typeof _appRouter !== 'undefined' && _appRouter.basePath) ? _appRouter.basePath : '';
    }

    // Fetches the editor markup once, injects it into the host, and moves its toolbar into the bar.
    function ensureEditorMarkup() {
        if (state.editorReady && $('#reportEditorModule').length) return Promise.resolve(true);
        return _appRouter.fetchHtml(basePath() + EDITOR_HTML).then(function (res) {
            if (!res || !res.success) throw new Error('Could not load the report editor.');
            // A previous visit may have left the editor's modal on <body> (it is moved there below).
            $('body > #reportWhatsappSendModal').remove();
            var $host = $('#reportsEditorHost').empty().html(res.data);
            var $module = $host.find('#reportEditorModule');
            var $bar = $('#reportsBarActions');
            $bar.find('.js-reports-editor-toolbar').remove();
            var $toolbar = $module.find('.btn-toolbar').first().detach();
            $toolbar.removeClass('mb-2 mb-md-0 ms-auto').addClass('js-reports-editor-toolbar flex-wrap');
            $bar.prepend($toolbar);
            // The editor's own title row is replaced by the bar above it.
            $module.children('.d-flex').first().addClass('d-none');
            $module.removeClass('module-content');
            // Bootstrap modals must sit directly under <body> to stack above the page.
            $host.find('#reportWhatsappSendModal').appendTo('body');
            // The router's access sweep already ran for this page; injected content needs its own.
            if (typeof actionAccess !== 'undefined' && actionAccess.apply) {
                actionAccess.apply($host[0]);
                actionAccess.apply($bar[0]);
            }
            state.editorReady = true;
            return true;
        });
    }

    function openSelected() {
        var id = state.selectedId;
        if (!id) return Promise.resolve();
        var token = ++state.openToken;
        var $host = $('#reportsEditorHost');
        if (!canOpenEditor()) {
            $host.empty().append($('<div class="alert alert-info mb-0" role="alert">')
                .text('You can see that reports exist, but report editing has not been enabled for your role.'));
            state.editorReady = false;
            return Promise.resolve();
        }
        if (typeof _reportEditor === 'undefined' || !_reportEditor.openEmbedded) {
            showAlert($host, 'The report editor is not available. Reload the page and try again.');
            return Promise.resolve();
        }
        return ensureEditorMarkup().then(function () {
            if (token !== state.openToken) return;
            lastOpenedId = id;
            _reportEditor.openEmbedded(id, { onChange: handleEditorChange });
        }).catch(function (err) {
            if (token !== state.openToken) return;
            console.warn('[reports] could not open the editor', err);
            showAlert($host, 'Could not open this report: ' + (err && err.message ? err.message : 'unknown error') + '.');
        });
    }

    // Refresh / publish / re-issue happened inside the editor: re-read the history so chips and the
    // bar are current. A re-issue hands back the new version's id, which becomes the selection.
    function handleEditorChange(info) {
        if (info && isUuid(info.reportId)) state.selectedId = info.reportId;
        lastOpenedId = state.selectedId;
        return loadHistory(true, { keepSelection: true });
    }

    // ------------------------------------------------------------------
    // Tabs.
    // ------------------------------------------------------------------

    function showTab(tab, opts) {
        opts = opts || {};
        if (tab !== 'weekly' && tab !== 'monthly' && tab !== 'all') tab = 'weekly';
        state.tab = tab === 'all' ? state.tab : tab;
        var shown = tab;
        try { if (typeof Session !== 'undefined' && Session.set) Session.set('reportsActiveTab', tab); } catch (e) { /* ignore */ }
        $('#reportsTabs [data-reports-tab]').each(function () {
            $(this).toggleClass('active', $(this).attr('data-reports-tab') === tab);
        });
        if (shown === 'all') {
            $('#reportsPaneReport').addClass('d-none');
            $('#reportsPaneAll').removeClass('d-none');
            if (!state.allShown) {
                state.allShown = true;
                if (window._reportsAllFigures && window._reportsAllFigures.show) window._reportsAllFigures.show();
            }
            return Promise.resolve();
        }
        $('#reportsPaneAll').addClass('d-none');
        $('#reportsPaneReport').removeClass('d-none');
        if (opts.noLoad) return Promise.resolve();
        // Switching type opens that type's newest report.
        state.selectedId = null;
        state.userPicked = false;
        lastOpenedId = null;
        renderHistory();
        renderBar(null);
        return loadHistory(!!opts.force, {});
    }

    // ------------------------------------------------------------------
    // Public: open a specific report (used after "Other period…" creates one).
    // ------------------------------------------------------------------

    function openInstance(id) {
        if (!isUuid(id)) {
            Swal.fire({ icon: 'error', title: 'Could not open report', text: 'That report could not be opened. Reload the list and try again.' });
            return Promise.resolve(false);
        }
        var select = function () {
            var type = typeOfItem(id);
            if (type && type !== state.tab) {
                state.tab = type;
                showTab(type, { noLoad: true });
            } else if ($('#reportsPaneReport').hasClass('d-none')) {
                showTab(state.tab, { noLoad: true });
            }
            state.selectedId = id;
            state.userPicked = true;
            renderHistory();
            renderBar(findItem(id));
            return openSelected().then(function () { return true; });
        };
        if (findItem(id)) return select();
        // Not in the loaded lists (e.g. a period created from the modal): reload both, then look again.
        return Promise.all([fetchHistory('weekly', true), fetchHistory('monthly', true)]).then(function (lists) {
            state.items.weekly = lists[0];
            state.items.monthly = lists[1];
            return select();
        }).catch(function (err) {
            console.warn('[reports] openInstance reload failed', err);
            state.selectedId = id;
            return openSelected().then(function () { return true; });
        });
    }

    function reload() {
        return loadHistory(true, { keepSelection: true });
    }

    // ------------------------------------------------------------------
    // Lifecycle.
    // ------------------------------------------------------------------

    function bindEvents() {
        $(document).on('click.reportsPage', '#reportsTabs [data-reports-tab]', function () {
            showTab($(this).attr('data-reports-tab'));
        });
        $(document).on('click.reportsPage', '.js-reports-history-row', function () {
            var id = String($(this).attr('data-report-id') || '');
            if (!isUuid(id) || id === state.selectedId) return;
            state.selectedId = id;
            state.userPicked = true;
            renderHistory();
            renderBar(findItem(id));
            openSelected();
        });
        $(document).on('click.reportsPage', '#refreshReportListBtn', function () {
            loadHistory(true, { keepSelection: true });
        });
    }

    function init() {
        var hostEl = document.getElementById('reportsEditorHost');
        if (!hostEl) return;
        // The router handler and the grid's own ready-handler can both call init for one page load.
        if (state.initHostEl === hostEl) return;
        destroy();
        state.initHostEl = hostEl;
        state.items = { weekly: [], monthly: [] };
        state.selectedId = null;
        state.userPicked = false;
        state.editorReady = false;
        state.allShown = false;
        lastOpenedId = null;
        bindEvents();

        var tab = 'weekly';
        try { tab = (typeof Session !== 'undefined' && Session.get && Session.get('reportsActiveTab')) || 'weekly'; } catch (e) { /* ignore */ }
        if (tab !== 'weekly' && tab !== 'monthly' && tab !== 'all') tab = 'weekly';
        if (tab === 'all') state.tab = 'weekly';

        // History renders straight away; today's drafts are ensured in parallel and, if any were
        // created, the history is read again so they appear.
        var shown = showTab(tab);
        Promise.resolve().then(function () {
            return dataFunctions.ensureReportDrafts();
        }).then(function (res) {
            var r = unwrap(res);
            var created = !!(r && Array.isArray(r.items) && r.items.some(function (x) { return x && x.created; }));
            if (!created || state.initHostEl !== hostEl) return;
            return Promise.resolve(shown).then(function () {
                if (state.tab === 'all' || $('#reportsPaneReport').hasClass('d-none')) {
                    state.items = { weekly: [], monthly: [] };
                    return;
                }
                // Reopen the newest only if the user has not picked something themselves.
                state.items[state.tab] = [];
                return loadHistory(true, state.userPicked ? { keepSelection: true } : {});
            });
        }).catch(function (err) {
            console.warn('[reports] ensureReportDrafts failed', err);
        });
    }

    function destroy() {
        $(document).off('.reportsPage');
        state.initHostEl = null;
        state.openToken++;
        state.historyToken++;
        $('body > #reportWhatsappSendModal').remove();
        if (typeof _reportEditor !== 'undefined' && _reportEditor.destroy && state.editorReady) {
            _reportEditor.destroy();
        }
        state.editorReady = false;
    }

    return { init: init, openInstance: openInstance, destroy: destroy, reload: reload };
}();

window._reportsPage = _reportsPage;
