/**
 * ReportWhatsappSend — the "Send via WhatsApp" dialog for a published Sales & Production report.
 *
 * Opened from report_editor.js's toolbar button. Loads three recipient sources (saved
 * recipients, the shared WhatsApp inbox, CRM contacts), lets the operator pick up to
 * MAX_RECIPIENTS, then calls sendReportWhatsapp() with a PDF supplied by an injected provider
 * (see setPdfProvider) — this file has no pdfmake reference of its own.
 *
 * Lifecycle hygiene modelled on report_list_grid.js (real destroy(), namespaced bindings,
 * init() calls destroy() first) rather than on crm_whatsapp_contacts_tab.js, which has no
 * destroy() at all — see CLAUDE.md / the plan this file was built from for why.
 *
 * data-action-perm is inert on markup rendered after the router's one-time sweep (CLAUDE.md),
 * so every control inside this dialog is gated by calling hasAction() inline at render time,
 * not by a static attribute.
 */
var ReportWhatsappSend = (function () {
    'use strict';

    var MAX_RECIPIENTS = 25; // mirrors MAX_RECIPIENTS in supabase/functions/send-report-whatsapp/index.ts:61

    var NS = '.reportWhatsappSend';

    var state = {
        reportInstanceId: null,
        filename: null,
        periodLabel: null,
        getPdfBase64: null,
        selected: {},     // key -> candidate object (see buildCandidateLists)
        sending: false,
        initialized: false
    };

    var pdfProvider = null;

    // ------------------------------------------------------------------------------------------
    // Pure helpers — no DOM, no jQuery. Exposed on the returned object so a Node unit test can
    // exercise them directly (scripts/verify-report-whatsapp-picker.mjs), matching the pattern
    // report-pdf-builder.js uses for its own pure functions.
    // ------------------------------------------------------------------------------------------

    /**
     * Mirrors public.report_normalize_wa_phone exactly (migrations/
     * 20260822090000_report_whatsapp_recipients_and_deliveries.sql, section 1):
     *   strip every non-digit
     *   empty                                -> null
     *   leading '0'                          -> replace with '27'
     *   else no leading '27' and length <= 11 -> prefix '27'
     *   finally prefix '+'
     *
     * This is NOT the shared-inbox helper that normalises to bare digits with no '+' prefix
     * (migrations/20260813090000_whatsapp_inbound_shared_inbox.sql:72-92) — do not conflate the two.
     */
    function normalizeKey(phone) {
        var digits = String(phone === null || phone === undefined ? '' : phone).replace(/\D/g, '');
        if (!digits) return null;
        if (digits.charAt(0) === '0') {
            digits = '27' + digits.slice(1);
        } else if (digits.slice(0, 2) !== '27' && digits.length <= 11) {
            digits = '27' + digits;
        }
        return '+' + digits;
    }

    /** True when a normalised key is unusable (null, or too short to be a real number). */
    function isUnusableKey(key) {
        return !key || key.length < 11;
    }

    /**
     * Builds the three de-duplicated, skip-filtered candidate lists from raw source rows.
     * Pure — no DOM. saved always wins a collision; inbox rows with success === 0 are dropped
     * silently (that means "no access", not "no number"); a candidate whose normalised key is
     * unusable is dropped and counted in skippedCount ("N contacts have no usable mobile
     * number"), never rendered as a selectable row with a blank number.
     *
     * @param {{saved: Array, inbox: Array, crm: Array}} sources
     * @returns {{saved: Array, inbox: Array, crm: Array, skippedCount: number}}
     */
    function buildCandidateLists(sources) {
        var savedRows = Array.isArray(sources && sources.saved) ? sources.saved : [];
        var inboxRows = Array.isArray(sources && sources.inbox) ? sources.inbox : [];
        var crmRows = Array.isArray(sources && sources.crm) ? sources.crm : [];

        var seenKeys = Object.create(null);
        var skippedCount = 0;

        var savedList = [];
        savedRows.forEach(function (r) {
            var key = normalizeKey(r && r.phone);
            if (isUnusableKey(key)) { skippedCount++; return; }
            if (seenKeys[key]) return;
            seenKeys[key] = true;
            savedList.push({
                key: key,
                source: 'saved',
                phone: r.phone,
                display_name: r.display_name,
                recipientId: r.id
            });
        });

        var inboxList = [];
        inboxRows.forEach(function (r) {
            if (!r || r.success === 0) return; // "no access" signal — not a skip, not a number
            var key = normalizeKey(r.external_phone);
            if (isUnusableKey(key)) { skippedCount++; return; }
            if (seenKeys[key]) return; // a saved recipient (or an earlier inbox row) already claims it
            seenKeys[key] = true;
            inboxList.push({
                key: key,
                source: 'whatsapp_chat',
                phone: r.external_phone,
                display_name: r.other_party_name,
                conversationId: r.conversation_id
            });
        });

        var crmList = [];
        crmRows.forEach(function (r) {
            // Only primary_contact_mobile — this RPC has no secondary-contact fields, and a
            // report send targets a WhatsApp-capable mobile number, not a landline.
            var key = normalizeKey(r && r.primary_contact_mobile);
            if (isUnusableKey(key)) { skippedCount++; return; }
            if (seenKeys[key]) return;
            seenKeys[key] = true;
            crmList.push({
                key: key,
                source: 'crm_contact',
                phone: r.primary_contact_mobile,
                display_name: (r.company_name || r.primary_contact_name || 'Unnamed contact'),
                contactId: r.id
            });
        });

        return { saved: savedList, inbox: inboxList, crm: crmList, skippedCount: skippedCount };
    }

    /** Strips a leading `data:...;base64,` prefix, defensively — see plan grounding. */
    function stripDataUriPrefix(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/^data:[^;]*;base64,/, '');
    }

    /**
     * Builds the send-outcome summary from the edge function's response. Reads sent/failed —
     * never `success`, which describes the request reaching the endpoint, not delivery. A
     * response with `success: true` and every recipient failed must NOT read as a success.
     */
    function summarizeSend(resp) {
        var sent = Number(resp && resp.sent) || 0;
        var failed = Number(resp && resp.failed) || 0;
        var tone;
        if (failed > 0 && sent === 0) {
            tone = 'danger';
        } else if (failed > 0) {
            tone = 'warning';
        } else {
            tone = 'success';
        }
        return { sent: sent, failed: failed, text: sent + ' sent / ' + failed + ' failed', tone: tone };
    }

    /** First row of a PostgREST TABLE-returning RPC, whatever shape callFunction handed back. */
    function firstRpcRow(raw) {
        if (Array.isArray(raw)) return raw[0] || null;
        if (raw && typeof raw === 'object') return raw;
        return null;
    }

    function isRpcRowSuccess(row) {
        return !!row && (row.success === 1 || row.success === true);
    }

    // ------------------------------------------------------------------------------------------
    // DOM helpers
    // ------------------------------------------------------------------------------------------

    function escapeText($el, text) {
        $el.text(text === null || text === undefined ? '' : String(text));
        return $el;
    }

    function buildRecipientRow(candidate) {
        var checkboxId = 'rwsRow_' + candidate.source + '_' + candidate.key.replace(/[^A-Za-z0-9]/g, '');
        var $wrap = $('<div>', { class: 'form-check mb-1' });
        var $input = $('<input>', {
            type: 'checkbox',
            id: checkboxId,
            class: 'form-check-input js-rws-recipient'
        });
        $input.data('key', candidate.key);
        $input.data('candidate', candidate);
        if (Object.prototype.hasOwnProperty.call(state.selected, candidate.key)) {
            $input.prop('checked', true);
            state.selected[candidate.key] = candidate; // refresh the stored candidate (e.g. new recipientId)
        }
        var $label = $('<label>', { class: 'form-check-label', for: checkboxId });
        escapeText($label, (candidate.display_name || 'Unnamed') + ' ');
        var $phone = $('<span>', { class: 'text-muted small' });
        escapeText($phone, candidate.phone || '');
        $label.append($phone);
        $wrap.append($input).append($label);
        return $wrap;
    }

    function renderGroup($listEl, $noteEl, candidates, note, emptyMessage) {
        $listEl.empty();
        if (note) {
            escapeText($noteEl, note).removeClass('d-none');
            return;
        }
        $noteEl.addClass('d-none').empty();
        if (!candidates.length) {
            var $empty = $('<div>', { class: 'text-muted small' });
            escapeText($empty, emptyMessage);
            $listEl.append($empty);
            return;
        }
        candidates.forEach(function (c) {
            $listEl.append(buildRecipientRow(c));
        });
    }

    function updateFooter() {
        var count = Object.keys(state.selected).length;
        var $count = $('#reportWhatsappSendCount');
        escapeText($count, count + ' selected');
        $('#reportWhatsappSendSubmitBtn').prop('disabled', count === 0 || state.sending);
        var $cap = $('#reportWhatsappSendCapNote');
        if (count >= MAX_RECIPIENTS) {
            escapeText($cap, 'Maximum of ' + MAX_RECIPIENTS + ' recipients per send — deselect one to add another.');
            $cap.removeClass('d-none');
        } else {
            $cap.addClass('d-none').empty();
        }
    }

    function handleRecipientToggle() {
        var $input = $(this);
        var candidate = $input.data('candidate');
        var key = candidate && candidate.key;
        if (!key) return;
        if ($input.is(':checked')) {
            var count = Object.keys(state.selected).length;
            if (count >= MAX_RECIPIENTS) {
                $input.prop('checked', false);
                updateFooter();
                return;
            }
            state.selected[key] = candidate;
        } else {
            delete state.selected[key];
        }
        updateFooter();
    }

    // ------------------------------------------------------------------------------------------
    // Add-a-number sub-form — rendered only when hasAction('reports.recipient.manage') is true,
    // checked inline at render time (data-action-perm is inert on this dynamic markup).
    // ------------------------------------------------------------------------------------------

    function renderAddForm() {
        var $container = $('#reportWhatsappSendAddForm').empty();
        if (typeof hasAction !== 'function' || !hasAction('reports.recipient.manage')) {
            return;
        }
        var $card = $('<div>', { class: 'card card-body p-2' });
        var $row = $('<div>', { class: 'row g-2 align-items-end' });

        var $nameCol = $('<div>', { class: 'col-sm-4' });
        $nameCol.append($('<label>', { class: 'form-label small mb-1', for: 'rwsAddName' }).text('Name'));
        var $nameInput = $('<input>', { type: 'text', class: 'form-control form-control-sm', id: 'rwsAddName' });
        $nameCol.append($nameInput);

        var $phoneCol = $('<div>', { class: 'col-sm-4' });
        $phoneCol.append($('<label>', { class: 'form-label small mb-1', for: 'rwsAddPhone' }).text('Number'));
        var $phoneInput = $('<input>', { type: 'text', class: 'form-control form-control-sm', id: 'rwsAddPhone' });
        $phoneCol.append($phoneInput);

        var $btnCol = $('<div>', { class: 'col-sm-4' });
        var $addBtn = $('<button>', { type: 'button', class: 'btn btn-outline-primary btn-sm w-100', id: 'rwsAddBtn' })
            .text('Add recipient');
        $btnCol.append($addBtn);

        var $errorLine = $('<div>', { class: 'text-danger small mt-2 d-none', id: 'rwsAddError' });

        $row.append($nameCol).append($phoneCol).append($btnCol);
        $card.append($row).append($errorLine);
        $container.append($card);

        $addBtn.on('click' + NS, function () {
            var name = $nameInput.val();
            var phone = $phoneInput.val();
            $addBtn.prop('disabled', true);
            var $err = $('#rwsAddError').addClass('d-none').empty();
            dataFunctions.upsertReportRecipient(name, phone, 'manual')
                .then(function (raw) {
                    var row = firstRpcRow(raw);
                    if (!isRpcRowSuccess(row)) {
                        escapeText($err, (row && row.error) || 'Could not add this recipient.');
                        $err.removeClass('d-none');
                        return;
                    }
                    $nameInput.val('');
                    $phoneInput.val('');
                    return reloadSources(true);
                })
                .catch(function (e) {
                    console.warn('[report-whatsapp-send] upsertReportRecipient failed', e);
                    escapeText($err, 'Could not add this recipient.');
                    $err.removeClass('d-none');
                })
                .finally(function () {
                    $addBtn.prop('disabled', false);
                });
        });
    }

    // ------------------------------------------------------------------------------------------
    // Source loading — each wrapped so one failing source cannot blank the whole dialog.
    // ------------------------------------------------------------------------------------------

    function loadSavedSource(forceRefresh) {
        return dataFunctions.listReportRecipients(false, null, !!forceRefresh)
            .then(function (rows) {
                return { rows: Array.isArray(rows) ? rows : [], note: null };
            })
            .catch(function (e) {
                console.warn('[report-whatsapp-send] listReportRecipients failed', e);
                return { rows: [], note: 'Saved recipients could not be loaded.' };
            });
    }

    function loadInboxSource() {
        if (typeof dataFunctions.chatListWhatsappConversations !== 'function') {
            return Promise.resolve({ rows: [], note: 'The WhatsApp inbox is not available.' });
        }
        var userId = (typeof dataFunctions.getCurrentUserId === 'function') ? dataFunctions.getCurrentUserId() : null;
        return dataFunctions.chatListWhatsappConversations(userId)
            .then(function (result) {
                if (result === null || result === undefined) {
                    return { rows: [], note: 'The WhatsApp inbox is not available on this database yet.' };
                }
                return { rows: Array.isArray(result) ? result : [], note: null };
            })
            .catch(function (e) {
                console.warn('[report-whatsapp-send] chatListWhatsappConversations failed', e);
                return { rows: [], note: 'The WhatsApp inbox could not be loaded.' };
            });
    }

    function loadCrmSource() {
        // getContactsForMessaging() returns [] in BOTH the no-rows path and its own internal
        // catch path — it can never return null. So there is no "unavailable" note for this
        // source; an empty list always means "No CRM contacts found."
        return dataFunctions.getContactsForMessaging()
            .then(function (rows) {
                return { rows: Array.isArray(rows) ? rows : [] };
            })
            .catch(function (e) {
                console.warn('[report-whatsapp-send] getContactsForMessaging failed', e);
                return { rows: [] };
            });
    }

    function reloadSources(forceRefreshSaved) {
        return Promise.all([loadSavedSource(forceRefreshSaved), loadInboxSource(), loadCrmSource()])
            .then(function (results) {
                renderSources(results[0], results[1], results[2]);
            });
    }

    function renderSources(savedResult, inboxResult, crmResult) {
        var lists = buildCandidateLists({
            saved: savedResult.rows,
            inbox: inboxResult.rows,
            crm: crmResult.rows
        });

        renderGroup(
            $('#reportWhatsappSendSavedList'), $('#reportWhatsappSendSavedNote'),
            lists.saved, savedResult.note, 'No saved recipients yet.'
        );
        renderGroup(
            $('#reportWhatsappSendInboxList'), $('#reportWhatsappSendInboxNote'),
            lists.inbox, inboxResult.note, 'No WhatsApp conversations found.'
        );
        renderGroup(
            $('#reportWhatsappSendCrmList'), $('#reportWhatsappSendCrmNote'),
            lists.crm, null, 'No CRM contacts found.'
        );

        var $skipped = $('#reportWhatsappSendSkippedNote');
        if (lists.skippedCount > 0) {
            escapeText($skipped, lists.skippedCount + ' contact' + (lists.skippedCount === 1 ? '' : 's') +
                ' have no usable mobile number.').removeClass('d-none');
        } else {
            $skipped.addClass('d-none').empty();
        }

        renderAddForm();

        // Delegated on the body, not the individual (freshly re-rendered) checkboxes, so this
        // survives renderSources() being called again after "Add recipient". off() first so a
        // second call cannot double-bind the same delegated handler.
        $('#reportWhatsappSendBody').off('change' + NS, '.js-rws-recipient')
            .on('change' + NS, '.js-rws-recipient', handleRecipientToggle);

        updateFooter();
    }

    // ------------------------------------------------------------------------------------------
    // Send results rendering
    // ------------------------------------------------------------------------------------------

    function renderResults(resp) {
        var $results = $('#reportWhatsappSendResults').empty().removeClass('d-none');
        var summary = summarizeSend(resp);
        var $summary = $('<div>', { class: 'alert alert-' + summary.tone + ' small mb-2' });
        escapeText($summary, summary.text);
        $results.append($summary);

        if (Array.isArray(resp && resp.results)) {
            var $list = $('<div>', { class: 'list-group' });
            resp.results.forEach(function (r) {
                var $row = $('<div>', { class: 'list-group-item d-flex justify-content-between align-items-center' });
                var $name = $('<span>');
                escapeText($name, (r.display_name || r.phone || 'Unknown'));
                var $status = $('<span>').html(
                    (typeof MacStatus !== 'undefined' && MacStatus.pill) ? MacStatus.pill(r.status) : ''
                );
                $row.append($name).append($status);
                if (r.error) {
                    var $err = $('<div>', { class: 'text-danger small w-100 mt-1' });
                    escapeText($err, r.error);
                    $row.append($err);
                }
                $list.append($row);
            });
            $results.append($list);
        }
    }

    // ------------------------------------------------------------------------------------------
    // Send
    // ------------------------------------------------------------------------------------------

    function saveUnsavedSelections() {
        if (typeof hasAction !== 'function' || !hasAction('reports.recipient.manage')) {
            return Promise.resolve();
        }
        var toSave = Object.keys(state.selected)
            .map(function (k) { return state.selected[k]; })
            .filter(function (c) { return c.source !== 'saved'; });

        if (!toSave.length) return Promise.resolve();

        return Promise.all(toSave.map(function (c) {
            return dataFunctions.upsertReportRecipient(
                c.display_name, c.phone, c.source,
                { contactId: c.contactId || null, conversationId: c.conversationId || null }
            ).catch(function (e) {
                // Non-fatal: a save failure never blocks the send itself.
                console.warn('[report-whatsapp-send] could not save recipient', c.display_name, e);
                return null;
            });
        }));
    }

    function handleSend() {
        if (state.sending) return;
        var keys = Object.keys(state.selected);
        if (!keys.length) return;

        state.sending = true;
        updateFooter();
        $('#reportWhatsappSendResults').addClass('d-none').empty();
        var $sendBtn = $('#reportWhatsappSendSubmitBtn');
        var originalHtml = $sendBtn.html();
        $sendBtn.html('<i class="fas fa-spinner fa-spin me-1"></i>Sending&hellip;');

        var provider = state.getPdfBase64 || pdfProvider;
        if (typeof provider !== 'function') {
            state.sending = false;
            $sendBtn.html(originalHtml);
            updateFooter();
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Could not build the PDF', text: 'No PDF provider is registered.' });
            }
            return;
        }

        provider()
            .catch(function (e) {
                console.warn('[report-whatsapp-send] PDF build failed', e);
                throw new Error('pdf-build-failed');
            })
            .then(function (b64) {
                var pdfBase64 = stripDataUriPrefix(b64);
                return saveUnsavedSelections().then(function () { return pdfBase64; });
            })
            .then(function (pdfBase64) {
                var recipients = keys.map(function (k) {
                    var c = state.selected[k];
                    return { phone: c.phone, display_name: c.display_name };
                });
                return dataFunctions.sendReportWhatsapp({
                    reportInstanceId: state.reportInstanceId,
                    pdfBase64: pdfBase64,
                    filename: state.filename,
                    recipients: recipients
                });
            })
            .then(function (resp) {
                if (!resp || resp.success === false) {
                    var errMsg = (resp && resp.error) || 'The send failed for an unknown reason.';
                    if (typeof Swal !== 'undefined') {
                        Swal.fire({ icon: 'error', title: 'Send failed', text: errMsg });
                    }
                    return;
                }
                renderResults(resp);
                $(document).trigger('reportWhatsappSend:completed' + NS, [{ reportInstanceId: state.reportInstanceId }]);
            })
            .catch(function (e) {
                var msg = (e && e.message === 'pdf-build-failed')
                    ? 'The report PDF could not be built. Please try again.'
                    : 'Could not reach the send endpoint. Please try again.';
                console.warn('[report-whatsapp-send] send failed', e);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'error', title: 'Send failed', text: msg });
                }
            })
            .finally(function () {
                state.sending = false;
                $sendBtn.html(originalHtml);
                updateFooter();
            });
    }

    // ------------------------------------------------------------------------------------------
    // Public lifecycle
    // ------------------------------------------------------------------------------------------

    function resetDialog() {
        state.selected = {};
        state.sending = false;
        $('#reportWhatsappSendResults').addClass('d-none').empty();
        $('#reportWhatsappSendCapNote').addClass('d-none').empty();
        $('#reportWhatsappSendSkippedNote').addClass('d-none').empty();
        ['Saved', 'Inbox', 'Crm'].forEach(function (g) {
            $('#reportWhatsappSend' + g + 'List').empty();
            $('#reportWhatsappSend' + g + 'Note').addClass('d-none').empty();
        });
        $('#reportWhatsappSendAddForm').empty();
        updateFooter();
    }

    function open(options) {
        var opts = options || {};
        state.reportInstanceId = opts.reportInstanceId || null;
        state.filename = opts.filename || null;
        state.periodLabel = opts.periodLabel || null;
        state.getPdfBase64 = (typeof opts.getPdfBase64 === 'function') ? opts.getPdfBase64 : null;

        resetDialog();

        var $modal = $('#reportWhatsappSendModal');
        if (!$modal.length) return;

        $('#reportWhatsappSendLoading').removeClass('d-none');
        $('#reportWhatsappSendBody').addClass('d-none');
        if (typeof $ !== 'undefined' && $.fn.modal) $modal.modal('show');

        reloadSources()
            .catch(function (e) {
                console.warn('[report-whatsapp-send] failed to load recipient sources', e);
            })
            .finally(function () {
                $('#reportWhatsappSendLoading').addClass('d-none');
                $('#reportWhatsappSendBody').removeClass('d-none');
            });
    }

    function setPdfProvider(fn) {
        if (typeof fn === 'function') {
            pdfProvider = fn;
        }
    }

    function bindEvents() {
        $('#reportWhatsappSendSubmitBtn').off('click' + NS).on('click' + NS, handleSend);
    }

    function init() {
        destroy();
        bindEvents();
        state.initialized = true;
    }

    function destroy() {
        $('#reportWhatsappSendSubmitBtn').off(NS);
        $('#reportWhatsappSendBody').off(NS);
        $('#rwsAddBtn').off(NS);
        $(document).off(NS);
        state.initialized = false;
    }

    return {
        init: init,
        destroy: destroy,
        open: open,
        setPdfProvider: setPdfProvider,
        // Exposed for scripts/verify-report-whatsapp-picker.mjs — pure, no DOM.
        _normalizeKey: normalizeKey,
        _buildCandidateLists: buildCandidateLists,
        _summarizeSend: summarizeSend,
        _stripDataUriPrefix: stripDataUriPrefix
    };
})();
