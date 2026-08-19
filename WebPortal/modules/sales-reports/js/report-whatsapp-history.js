/**
 * Report WhatsApp distribution — the "who got this report" delivery-history panel shown on a
 * published (or superseded) Sales & Production report (report_editor.html). Reads
 * public.report_deliveries through dataFunctions.listReportDeliveries (list_report_deliveries,
 * migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:390-443) and lets an
 * operator re-send to a delivery that never reached `sent`.
 *
 * Follows the company module pattern (IIFE, init()/destroy(), namespaced events) per
 * BluePrint/javascript-jquery-rules.md, modelled on report-whatsapp-send.js in this same module
 * (the closest sibling — same module family, same lifecycle conventions) and on
 * report_list_grid.js for the loading/empty-row convention (macLoadingRow/macEmptyRow).
 *
 * Global exposure only, no evaluation-time DOM/global references — this file is loaded into a
 * bare `vm` context by scripts/verify-report-whatsapp-history.mjs, so `$`, `document`, `Swal`,
 * `MacStatus`, `hasAction`, `macLoadingRow`, `macEmptyRow` and `dataFunctions` are referenced ONLY
 * inside function bodies, never at module-evaluation time.
 *
 * Security invariants:
 *   - Every value sourced from the database or the WhatsApp gateway (display names, the gateway's
 *     own failure text, phone numbers, sender names) reaches the DOM only via .text() or a jQuery
 *     attribute-object constructor (including `title=`, which is set with .attr(), never built
 *     inside an HTML string) — never raw concatenation, never .html()/innerHTML on a non-literal
 *     value.
 *   - This panel renders no link and assigns no value into a URI sink (img.src/href/iframe.src/
 *     location). The edge function never returns the signed PDF URL to the browser
 *     (supabase/functions/send-report-whatsapp/index.ts:517-518) and the storage bucket has no RLS
 *     policy for the browser to reach anyway — there is nothing here that could become one.
 *   - Deny-by-default: `typeof hasAction !== 'function'` is treated as denied, never allowed, and
 *     is evaluated inline at render time (data-action-perm is swept once over static markup by
 *     appRouter.js shortly after load and is inert on rows rendered afterwards).
 *   - A `pending` delivery may mean the message actually reached the phone and only the
 *     completion write was lost (begin_report_delivery inserts 'pending' before the gateway call;
 *     complete_report_delivery updates it after). Re-sending a `pending` row can therefore deliver
 *     a second copy of a confidential report — the row's own wording says so, and the human Send
 *     press inside the reused "Send via WhatsApp" dialog is the gate that makes that acceptable.
 *   - Re-sending creates NEW report_deliveries rows; it never updates the old one. The failed/
 *     pending attempt stays in the log — that is the entire point of an audit trail. Do not
 *     "tidy" this into an update later.
 */
var ReportWhatsappHistory = (function () {
    'use strict';

    var PENDING_NOTE = 'Never completed \u2014 the send did not finish; a re-send may deliver a second copy.';
    var SENT_BY_PLACEHOLDER = '\u2014';

    var state = {
        reportInstanceId: null,
        canResend: false,
        rows: [],       // _buildHistoryRow-shaped, for rendering only
        // The raw (Array.isArray-normalised) list_report_deliveries rows, kept alongside `rows`
        // so _buildResendPreselect can read row.display_name/row.recipient_id UNRESOLVED — a
        // shaped `rows` entry's displayName already falls back to the phone for display, which
        // would stop the send module from ever seeing a genuinely-null display name.
        rawRows: []
    };

    var resendHandler = null;

    // ------------------------------------------------------------------
    // Pure helpers — no DOM/global reference, unit-tested by
    // scripts/verify-report-whatsapp-history.mjs.
    // ------------------------------------------------------------------

    // Shapes one list_report_deliveries row into the plain data a render function needs. Reads
    // ONLY row.delivery_error for the per-row failure text, never row.error (list_report_deliveries
    // returns both: `error` at :414-417 is the RPC-level fault, always null for a row actually
    // returned; `delivery_error` at :432 is the gateway's own per-delivery text). Conflating them
    // is the single most likely defect in this module — do not "simplify" this later.
    function _buildHistoryRow(row) {
        var r = row || {};
        var status = r.status;
        var isFailed = status === 'failed';
        var isPending = status === 'pending';
        var displayName = (r.display_name != null && String(r.display_name).trim() !== '')
            ? r.display_name
            : (r.phone || '');
        var sentByName = (r.sent_by_name != null && String(r.sent_by_name).trim() !== '')
            ? r.sent_by_name
            : null;
        var when = (r.completed_at != null) ? r.completed_at : (r.created_at != null ? r.created_at : null);

        return {
            id: r.id || null,
            recipientId: r.recipient_id || null,
            phone: r.phone || '',
            displayName: displayName,
            status: status,
            isSent: status === 'sent',
            isPending: isPending,
            isFailed: isFailed,
            // Verbatim gateway text, never truncated here — the render function truncates for
            // display and keeps the full string in a title attribute.
            failureText: isFailed ? (r.delivery_error || null) : null,
            pendingNote: isPending ? PENDING_NOTE : null,
            when: when,
            sentByName: sentByName
        };
    }

    // Builds the resend preselect list the "Send via WhatsApp" dialog's open({ preselect }) call
    // expects, from the normalised (already Array.isArray-guarded) raw row array — every row whose status !== 'sent'
    // and whose phone is non-empty. `phone` is passed through as the row's ORIGINAL string, never a
    // normalised key (report-whatsapp-send.js normalises independently; two normalisers disagreeing
    // is the whole hazard). `displayName` may be null and is passed through unchanged — the send
    // module's own candidate falls back to the phone when displayName is absent.
    function _buildResendPreselect(rows) {
        var arr = Array.isArray(rows) ? rows : [];
        var out = [];
        arr.forEach(function (row) {
            if (!row) return;
            if (row.status === 'sent') return;
            var phone = row.phone;
            if (!phone || !String(phone).trim()) return;
            out.push({
                phone: phone,
                displayName: (row.display_name != null) ? row.display_name : null,
                recipientId: row.recipient_id || null
            });
        });
        return out;
    }

    // ------------------------------------------------------------------
    // Rendering — every interpolation goes through .text()/attribute-object construction, or
    // MacStatus.pill()/macLoadingRow()/macEmptyRow() (all self-escaping). No .html() call below
    // takes a non-literal value.
    // ------------------------------------------------------------------

    function formatWhen(value) {
        if (value == null || String(value).trim() === '') return '';
        var d = new Date(value);
        if (isNaN(d.getTime())) return String(value);
        return d.toLocaleString();
    }

    function truncate(text, max) {
        var s = String(text == null ? '' : text);
        if (s.length <= max) return s;
        return s.slice(0, max - 1) + '\u2026';
    }

    function canShowResendControl() {
        return !!state.canResend && typeof hasAction === 'function' && hasAction('reports.report.send');
    }

    function buildActionsCell(historyRow) {
        var $cell = $('<td>');
        if (historyRow.isSent || !canShowResendControl()) return $cell;
        var $btn = $('<button>', {
            type: 'button',
            'class': 'btn btn-sm btn-outline-primary js-rwh-resend',
            'data-id': historyRow.id || ''
        });
        $btn.append($('<i>', { 'class': 'fas fa-paper-plane me-1' }));
        $btn.append(document.createTextNode('Re-send'));
        $cell.append($btn);
        return $cell;
    }

    function buildRow(historyRow) {
        var $tr = $('<tr>');

        var $recipient = $('<td>').text(historyRow.displayName || '');
        $tr.append($recipient);

        $tr.append($('<td>').text(historyRow.phone || ''));

        var $statusCell = $('<td>');
        // MacStatus.pill() escapes its own label — the one permitted non-literal .html() call.
        $statusCell.html(MacStatus.pill(historyRow.status));
        if (historyRow.isFailed && historyRow.failureText) {
            var $err = $('<div>', { 'class': 'text-muted small mt-1' })
                .text(truncate(historyRow.failureText, 80));
            $err.attr('title', historyRow.failureText);
            $statusCell.append($err);
        } else if (historyRow.isPending) {
            $statusCell.append(
                $('<div>', { 'class': 'text-muted small mt-1' }).text(historyRow.pendingNote)
            );
        }
        $tr.append($statusCell);

        $tr.append($('<td>').text(formatWhen(historyRow.when)));

        $tr.append($('<td>').text(historyRow.sentByName || SENT_BY_PLACEHOLDER));

        $tr.append(buildActionsCell(historyRow));

        return $tr;
    }

    function updateResendFailedButton() {
        var $btn = $('#reportWhatsappHistoryResendFailedBtn');
        var hasFailedOrPending = state.rows.some(function (r) { return r.isFailed || r.isPending; });
        $btn.toggleClass('d-none', !(hasFailedOrPending && canShowResendControl()));
    }

    function renderCount() {
        var n = state.rows.length;
        var text = n === 0 ? '' : (n + (n === 1 ? ' send' : ' sends'));
        $('#reportWhatsappHistoryCount').text(text);
    }

    function renderRows() {
        var $body = $('#reportWhatsappHistoryBody').empty();
        if (!state.rows.length) {
            $body.html(macEmptyRow(6, 'This report has not been sent to anyone yet.'));
            renderCount();
            updateResendFailedButton();
            return;
        }
        state.rows.forEach(function (historyRow) {
            $body.append(buildRow(historyRow));
        });
        renderCount();
        updateResendFailedButton();
    }

    function renderLoadFailure(message) {
        var $body = $('#reportWhatsappHistoryBody').empty();
        var $tr = $('<tr>', { 'class': 'mac-state-row' });
        var $td = $('<td>', { colspan: 6, 'class': 'text-center py-4 text-muted' }).text(message);
        $tr.append($td);
        $body.append($tr);
        $('#reportWhatsappHistoryCount').text('');
        $('#reportWhatsappHistoryResendFailedBtn').addClass('d-none');
    }

    // ------------------------------------------------------------------
    // Loading.
    // ------------------------------------------------------------------

    function load(reportInstanceId, forceRefresh, canResend) {
        state.reportInstanceId = String(reportInstanceId || '');
        state.canResend = !!canResend;

        if (!state.reportInstanceId) {
            renderLoadFailure('No report selected.');
            return Promise.resolve();
        }

        $('#reportWhatsappHistoryBody').html(macLoadingRow(6));
        clearResendUnavailable();

        return Promise.resolve().then(function () {
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.listReportDeliveries !== 'function') {
                throw new Error('listReportDeliveries unavailable');
            }
            // listReportDeliveries THROWS on a missing id or RPC failure — it never returns an
            // empty list on error, so this try/catch chain is required, not optional.
            return dataFunctions.listReportDeliveries(state.reportInstanceId, null, !!forceRefresh);
        }).then(function (raw) {
            var rows = Array.isArray(raw) ? raw : (raw ? [raw] : []);
            var first = rows[0];
            if (first && Number(first.success) === 0) {
                throw new Error((first && first.error) || 'Could not load delivery history.');
            }
            state.rawRows = rows;
            state.rows = rows.map(_buildHistoryRow);
            renderRows();
        }).catch(function (err) {
            console.warn('[report-whatsapp-history] listReportDeliveries failed', err);
            state.rawRows = [];
            state.rows = [];
            renderLoadFailure('Could not load delivery history.');
        });
    }

    // ------------------------------------------------------------------
    // Re-send.
    // ------------------------------------------------------------------

    function showResendUnavailable(message) {
        $('#reportWhatsappHistoryMsg').removeClass('d-none').text(message);
    }

    function clearResendUnavailable() {
        $('#reportWhatsappHistoryMsg').addClass('d-none').text('');
    }

    function triggerResend(preselect) {
        if (!Array.isArray(preselect) || !preselect.length) return;
        if (typeof resendHandler !== 'function') {
            showResendUnavailable('Re-send is unavailable on this screen.');
            return;
        }
        var ok = resendHandler(preselect);
        if (ok !== true) {
            showResendUnavailable('This report can no longer be sent.');
        } else {
            clearResendUnavailable();
        }
    }

    // Both handlers filter state.rawRows (the RAW list_report_deliveries rows), never state.rows
    // (the render-shaped ones) — _buildResendPreselect reads row.display_name/row.recipient_id
    // and must see a genuinely-null display name pass through unchanged, not the render shape's
    // already-resolved phone-number fallback.
    function handleResendOne(deliveryId) {
        var row = state.rawRows.filter(function (r) { return r && r.id === deliveryId; })[0];
        if (!row) return;
        triggerResend(_buildResendPreselect([row]));
    }

    function handleResendAllFailed() {
        var candidates = state.rawRows.filter(function (r) { return r && (r.status === 'failed' || r.status === 'pending'); });
        triggerResend(_buildResendPreselect(candidates));
    }

    // ------------------------------------------------------------------
    // Event wiring — bound to this module's own static container ids so delegated handlers survive
    // re-render; namespaced ".reportWhatsappHistory" so destroy() removes exactly what this file
    // bound.
    // ------------------------------------------------------------------

    function bindEvents() {
        $('#reportWhatsappHistoryBody').on('click.reportWhatsappHistory', '.js-rwh-resend', function () {
            handleResendOne($(this).attr('data-id'));
        });
        $('#reportWhatsappHistoryResendFailedBtn').on('click.reportWhatsappHistory', function () {
            handleResendAllFailed();
        });
        $(document).on('reportWhatsappSend:completed.reportWhatsappHistory', function (e, payload) {
            var completedId = payload && payload.reportInstanceId;
            if (String(completedId || '') === state.reportInstanceId && state.reportInstanceId) {
                load(state.reportInstanceId, true, state.canResend);
            }
        });
    }

    function unbindEvents() {
        $('#reportWhatsappHistoryBody').off('.reportWhatsappHistory');
        $('#reportWhatsappHistoryResendFailedBtn').off('.reportWhatsappHistory');
        $(document).off('.reportWhatsappHistory');
    }

    // ------------------------------------------------------------------
    // Public API.
    // ------------------------------------------------------------------

    return {
        init: function () {
            unbindEvents();
            state.reportInstanceId = null;
            state.canResend = false;
            state.rows = [];
            state.rawRows = [];
            resendHandler = null;
            bindEvents();
        },

        destroy: function () {
            unbindEvents();
        },

        setResendHandler: function (fn) {
            resendHandler = (typeof fn === 'function') ? fn : null;
        },

        load: load,

        // Exposed for scripts/verify-report-whatsapp-history.mjs (pure-Node unit checks).
        _buildHistoryRow: _buildHistoryRow,
        _buildResendPreselect: _buildResendPreselect
    };
})();

if (typeof window !== 'undefined') {
    window.ReportWhatsappHistory = ReportWhatsappHistory;
}
