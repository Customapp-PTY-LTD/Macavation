/**
 * Report WhatsApp distribution — the "Send via WhatsApp" dialog for a published Sales &
 * Production report (report_editor.html). Sends a report PDF through the
 * send-report-whatsapp edge function (supabase/functions/send-report-whatsapp/index.ts) to a
 * mix of saved recipients, shared-WhatsApp-inbox conversations and CRM contacts.
 *
 * Follows the company module pattern (IIFE, init()/destroy(), namespaced events) per
 * BluePrint/javascript-jquery-rules.md, modelled on:
 *   - report_list_grid.js (bootstrap.Modal show/hide idiom)
 *   - crm_whatsapp_contacts_tab.js (the two-source recipient load/escape pattern — its dead
 *     jQuery-plugin modal calls and missing destroy() are NOT copied here)
 *   - report_editor.js (lifecycle hygiene: namespaced bindings, init() calling destroy() first)
 *
 * Global exposure only, no evaluation-time DOM/global references — this file is loaded into a
 * bare `vm` context by scripts/verify-report-whatsapp-picker.mjs, so `$`, `document`,
 * `bootstrap`, `Swal`, `MacStatus` and `dataFunctions` are referenced ONLY inside function
 * bodies, never at module-evaluation time.
 *
 * Security invariants:
 *   - Every value sourced from the database or the gateway (display names, profile names, error
 *     strings) reaches the DOM only via .text() or a jQuery attribute-object constructor, or
 *     through MacStatus.pill() (which escapes its own label). The only permitted .html() calls
 *     below are literal static strings.
 *   - No value here is ever assigned into a URI sink (img.src/href/iframe.src/location) — the
 *     edge function deliberately never returns the signed storage URL.
 *   - The base64 PDF is never logged; only its presence/length, never its content.
 *   - Deny-by-default: `typeof hasAction !== 'function'` is treated as denied, never allowed.
 */
var ReportWhatsappSend = (function () {
    'use strict';

    var MAX_RECIPIENTS = 25; // Mirrors MAX_RECIPIENTS in supabase/functions/send-report-whatsapp/index.ts:61

    var state = {
        reportInstanceId: null,
        filename: null,
        periodLabel: null,
        selected: {},                                  // key -> candidate object
        lists: { saved: [], inbox: [], crm: [] },
        skippedCount: 0,
        savedError: false,
        inboxAvailable: true,
        sending: false
    };

    var pdfProvider = null; // injected via setPdfProvider(); returns Promise<string>

    // ------------------------------------------------------------------
    // Pure helpers — no DOM/global reference, unit-tested by
    // scripts/verify-report-whatsapp-picker.mjs.
    // ------------------------------------------------------------------

    // Canonical SA WhatsApp phone normaliser. Mirrors public.report_normalize_wa_phone exactly
    // (migrations/20260822090000_report_whatsapp_recipients_and_deliveries.sql:46-66). This
    // returns a '+'-prefixed value and is NOT the same as the shared chat inbox's own bare-digit
    // normaliser (a different function in a different migration) — do not mirror that one here.
    // Kept in step with the SQL copy by scripts/verify-report-whatsapp-parity.mjs (a later plan).
    function normalizeKey(phone) {
        var digits = String(phone == null ? '' : phone).replace(/\D/g, '');
        if (!digits) return null;
        if (digits.charAt(0) === '0') {
            digits = '27' + digits.slice(1);
        } else if (digits.slice(0, 2) !== '27' && digits.length <= 11) {
            digits = '27' + digits;
        }
        return '+' + digits;
    }

    function firstRpcRow(raw) {
        return Array.isArray(raw) ? (raw[0] || null) : (raw && typeof raw === 'object' ? raw : null);
    }

    // Builds the three de-duplicated candidate groups from the raw rows of the three sources.
    // Saved recipients win a de-dup collision; a candidate with no usable normalised phone number
    // (null, or shorter than 11 characters — matching upsert_report_recipient's own
    // `length(v_phone) < 11` rejection) is dropped and counted in skippedCount. An inbox row with
    // success === 0 ("no access") is dropped WITHOUT being counted — that is a permission signal,
    // not a missing-number signal.
    function buildCandidateLists(savedRows, inboxRows, crmRows) {
        var saved = Array.isArray(savedRows) ? savedRows : [];
        var inbox = Array.isArray(inboxRows) ? inboxRows : [];
        var crm = Array.isArray(crmRows) ? crmRows : [];

        var seen = {};
        var skipped = 0;
        var out = { saved: [], inbox: [], crm: [], skippedCount: 0 };

        saved.forEach(function (r) {
            if (!r) return;
            var key = normalizeKey(r.phone);
            if (!key || key.length < 11) { skipped++; return; }
            if (seen[key]) return;
            seen[key] = true;
            out.saved.push({
                key: key,
                phone: r.phone,
                displayName: r.display_name,
                source: 'saved',
                recipientId: r.id,
                contactId: r.contact_id || null,
                conversationId: r.conversation_id || null
            });
        });

        inbox.forEach(function (r) {
            if (!r) return;
            if (Number(r.success) === 0) return; // no-access signal — not counted as skipped
            var key = normalizeKey(r.external_phone);
            if (!key || key.length < 11) { skipped++; return; }
            if (seen[key]) return; // a saved recipient already claimed this number
            seen[key] = true;
            out.inbox.push({
                key: key,
                phone: r.external_phone,
                displayName: r.other_party_name || r.profile_name || r.external_phone,
                source: 'whatsapp_chat',
                conversationId: r.conversation_id || null,
                contactId: r.contact_id || null
            });
        });

        crm.forEach(function (r) {
            if (!r) return;
            var phone = r.primary_contact_mobile || r.primary_contact_phone;
            if (!phone || !String(phone).trim()) { skipped++; return; }
            var key = normalizeKey(phone);
            if (!key || key.length < 11) { skipped++; return; }
            if (seen[key]) return;
            seen[key] = true;
            out.crm.push({
                key: key,
                phone: phone,
                displayName: r.company_name || r.primary_contact_name || 'Unnamed Contact',
                source: 'crm_contact',
                contactId: r.id
            });
        });

        out.skippedCount = skipped;
        return out;
    }

    // Drops any selected key not present in the freshly rendered lists, and refreshes the stored
    // candidate object for keys that survive (so a newly-saved row's recipientId is picked up).
    // A confidential report must never be sent to a recipient the operator can no longer see.
    function pruneSelection(selected, lists) {
        var byKey = {};
        ['saved', 'inbox', 'crm'].forEach(function (group) {
            var rows = (lists && Array.isArray(lists[group])) ? lists[group] : [];
            rows.forEach(function (c) { if (c && c.key) byKey[c.key] = c; });
        });
        var pruned = {};
        Object.keys(selected || {}).forEach(function (key) {
            if (byKey[key]) pruned[key] = byKey[key];
        });
        return pruned;
    }

    // Builds the recipients payload for sendReportWhatsapp: { phone, display_name[, recipient_id] }.
    // `phone` is always the source's original string, never the normalised key — the server
    // normalises independently, and two normalisers disagreeing is the whole hazard here.
    function buildSendRecipients(candidates) {
        var out = [];
        Object.keys(candidates || {}).forEach(function (key) {
            var c = candidates[key];
            if (!c) return;
            var row = { phone: c.phone, display_name: c.displayName };
            if (c.recipientId) row.recipient_id = c.recipientId;
            out.push(row);
        });
        return out;
    }

    // Reads sent/failed from the edge function's response, never `success` — `success: true`
    // describes the request, not the outcome (index.ts returns 200 even when every send failed).
    function summarizeSend(resp) {
        var sent = Number(resp && resp.sent) || 0;
        var failed = Number(resp && resp.failed) || 0;
        var tone;
        if (sent > 0 && failed === 0) {
            tone = 'success';
        } else if (failed > 0 && sent === 0) {
            tone = 'danger';
        } else {
            tone = 'warning';
        }
        var text = sent + (sent === 1 ? ' message sent' : ' messages sent');
        if (failed > 0) text += ', ' + failed + (failed === 1 ? ' failed' : ' failed');
        return { sent: sent, failed: failed, text: text, tone: tone };
    }

    function stripDataPrefix(value) {
        var s = String(value == null ? '' : value);
        return s.replace(/^data:[^;]*;base64,/, '');
    }

    // ------------------------------------------------------------------
    // Modal show/hide — bootstrap.Modal primary, jQuery plugin only as a trailing fallback.
    // Under the Bootstrap 5.3.0 bundle this portal loads (WebPortal/index.html:552-553) the
    // jQuery branch is dead code, but it costs nothing to keep as a fallback.
    // ------------------------------------------------------------------

    function showModal() {
        var modalEl = document.getElementById('reportWhatsappSendModal');
        if (!modalEl) return;
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        } else if (typeof $ !== 'undefined' && $.fn.modal) {
            $(modalEl).modal('show');
        }
    }

    function hideModal() {
        var modalEl = document.getElementById('reportWhatsappSendModal');
        if (!modalEl) return;
        if (typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            var inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
        } else if (typeof $ !== 'undefined' && $.fn.modal) {
            $(modalEl).modal('hide');
        }
    }

    // ------------------------------------------------------------------
    // Rendering — every interpolation goes through .text()/attribute-object construction, or
    // MacStatus.pill() (self-escaping). The only .html() calls below are literal static strings.
    // ------------------------------------------------------------------

    function findCandidateByKey(key) {
        var groups = [state.lists.saved, state.lists.inbox, state.lists.crm];
        for (var g = 0; g < groups.length; g++) {
            for (var i = 0; i < groups[g].length; i++) {
                if (groups[g][i].key === key) return groups[g][i];
            }
        }
        return null;
    }

    function renderLoading() {
        $('#reportWhatsappSendBody').html(
            '<div class="text-center text-muted py-3"><i class="fas fa-spinner fa-spin me-2"></i>Loading recipients&hellip;</div>'
        );
        $('#reportWhatsappSendAddForm').empty();
        $('#reportWhatsappSendResults').addClass('d-none').empty();
        updateFooter();
    }

    function renderGroup(title, list, note) {
        var $wrap = $('<div>', { 'class': 'mb-3' });
        $wrap.append($('<h6>').text(title));
        if (note) {
            $wrap.append($('<div>', { 'class': 'text-muted small' }).text(note));
        }
        if (!list.length) return $wrap;
        var $list = $('<div>', { 'class': 'list-group' });
        list.forEach(function (c) {
            var checked = !!state.selected[c.key];
            var $item = $('<label>', { 'class': 'list-group-item d-flex align-items-center gap-2' });
            var $cb = $('<input>', { type: 'checkbox', 'class': 'form-check-input js-rws-candidate' })
                .attr('data-key', c.key)
                .prop('checked', checked);
            $item.append($cb);
            var $text = $('<span>');
            $text.append($('<span>').text(c.displayName || c.phone || ''));
            $text.append(document.createTextNode(' '));
            $text.append($('<span>', { 'class': 'text-muted small' }).text(c.phone || ''));
            $item.append($text);
            $list.append($item);
        });
        $wrap.append($list);
        return $wrap;
    }

    function renderBody() {
        var $body = $('#reportWhatsappSendBody').empty();

        $body.append(renderGroup(
            'Saved recipients',
            state.lists.saved,
            state.savedError
                ? 'Saved recipients could not be loaded.'
                : (state.lists.saved.length ? null : 'No saved recipients yet.')
        ));

        $body.append(renderGroup(
            'From WhatsApp inbox',
            state.lists.inbox,
            !state.inboxAvailable
                ? 'The shared WhatsApp inbox is not available on this database.'
                : (state.lists.inbox.length ? null : 'No inbox conversations found.')
        ));

        $body.append(renderGroup(
            'From CRM contacts',
            state.lists.crm,
            state.lists.crm.length ? null : 'No CRM contacts found.'
        ));

        // Source-neutral wording: this counter aggregates all three sources, so it must not blame
        // one of them (a CRM contact with no mobile number and a malformed manual number look the
        // same from here).
        if (state.skippedCount > 0) {
            $body.append($('<div>', { 'class': 'text-muted small mt-2' }).text(
                state.skippedCount + (state.skippedCount === 1
                    ? ' entry was hidden \u2014 no usable WhatsApp number.'
                    : ' entries were hidden \u2014 no usable WhatsApp number.')
            ));
        }

        renderAddForm();
        updateFooter();
    }

    function renderAddForm() {
        var $wrap = $('#reportWhatsappSendAddForm').empty();
        var canManage = typeof hasAction === 'function' && hasAction('reports.recipient.manage');
        if (!canManage) return; // typeof hasAction !== 'function' is treated as denied

        var $card = $('<div>', { 'class': 'border rounded p-2 mt-2' });
        $card.append($('<div>', { 'class': 'small fw-semibold mb-1' }).text('Add a number'));
        var $row = $('<div>', { 'class': 'row g-2 align-items-center' });
        $row.append($('<div>', { 'class': 'col-12 col-md-5' }).append(
            $('<input>', { type: 'text', 'class': 'form-control form-control-sm', id: 'reportWhatsappSendAddName', placeholder: 'Name' })
        ));
        $row.append($('<div>', { 'class': 'col-12 col-md-5' }).append(
            $('<input>', { type: 'text', 'class': 'form-control form-control-sm', id: 'reportWhatsappSendAddPhone', placeholder: 'Phone number' })
        ));
        $row.append($('<div>', { 'class': 'col-12 col-md-2' }).append(
            $('<button>', { type: 'button', 'class': 'btn btn-sm btn-outline-primary w-100 js-rws-add-submit' }).text('Add')
        ));
        $card.append($row);
        $card.append($('<div>', { 'class': 'text-danger small mt-1 d-none', id: 'reportWhatsappSendAddMsg' }));
        $wrap.append($card);
    }

    function showAddRecipientMessage(msg) {
        var $msg = $('#reportWhatsappSendAddMsg');
        if (!msg) { $msg.addClass('d-none').text(''); return; }
        $msg.removeClass('d-none').text(msg);
    }

    function updateFooter() {
        var count = Object.keys(state.selected).length;
        var text = count + (count === 1 ? ' recipient selected' : ' recipients selected');
        if (count >= MAX_RECIPIENTS) text += ' (maximum ' + MAX_RECIPIENTS + ')';
        $('#reportWhatsappSendFooterCount').text(text);
        $('#reportWhatsappSendSubmitBtn').prop('disabled', count === 0 || state.sending);
    }

    function setSendingUI(sending) {
        state.sending = sending;
        var $btn = $('#reportWhatsappSendSubmitBtn');
        $btn.prop('disabled', sending || Object.keys(state.selected).length === 0);
        // Literal static strings only — no interpolated value reaches this .html() call.
        $btn.html(sending
            ? '<i class="fas fa-spinner fa-spin me-1"></i>Sending&hellip;'
            : '<i class="fas fa-paper-plane me-1"></i>Send');
    }

    function renderResults(resp) {
        var summary = summarizeSend(resp);
        var $results = $('#reportWhatsappSendResults').empty().removeClass('d-none');
        $results.append($('<div>', { 'class': 'alert alert-' + summary.tone }).text(summary.text));

        if (Array.isArray(resp && resp.results)) {
            var $list = $('<ul>', { 'class': 'list-unstyled mb-0' });
            resp.results.forEach(function (r) {
                var $li = $('<li>', { 'class': 'd-flex justify-content-between align-items-start border-bottom py-2' });
                var $info = $('<div>');
                $info.append($('<div>').text(r.display_name || r.phone || ''));
                $info.append($('<div>', { 'class': 'text-muted small' }).text(r.phone || ''));
                if (r.error) {
                    $info.append($('<div>', { 'class': 'text-muted small' }).text(r.error));
                }
                $li.append($info);
                // MacStatus.pill() escapes its own label — the one permitted non-literal .html().
                $li.append($('<div>').html(MacStatus.pill(r.status)));
                $list.append($li);
            });
            $results.append($list);
        }
    }

    // ------------------------------------------------------------------
    // Loading the three recipient sources.
    // ------------------------------------------------------------------

    function loadSources(forceRefresh) {
        renderLoading();

        var currentUserId = (typeof dataFunctions !== 'undefined' && typeof dataFunctions.getCurrentUserId === 'function')
            ? dataFunctions.getCurrentUserId() : null;

        var savedP = Promise.resolve().then(function () {
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.listReportRecipients !== 'function') {
                throw new Error('listReportRecipients unavailable');
            }
            // listReportRecipients THROWS on RPC failure (it does not return an empty list) —
            // this try/catch chain is required, not optional.
            return dataFunctions.listReportRecipients(false, null, !!forceRefresh);
        }).then(function (rows) {
            state.savedError = false;
            return Array.isArray(rows) ? rows : [];
        }).catch(function (err) {
            console.warn('[report-whatsapp-send] listReportRecipients failed', err);
            state.savedError = true;
            return [];
        });

        var inboxP = Promise.resolve().then(function () {
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.chatListWhatsappConversations !== 'function') {
                return null;
            }
            return dataFunctions.chatListWhatsappConversations(currentUserId);
        }).then(function (rows) {
            // null means "the RPC does not exist on this database" — distinct from [] ("no rows").
            state.inboxAvailable = rows !== null;
            return Array.isArray(rows) ? rows : [];
        }).catch(function (err) {
            console.warn('[report-whatsapp-send] chatListWhatsappConversations failed', err);
            state.inboxAvailable = false;
            return [];
        });

        var crmP = Promise.resolve().then(function () {
            if (typeof dataFunctions === 'undefined' || typeof dataFunctions.getContactsForMessaging !== 'function') {
                return [];
            }
            // getContactsForMessaging returns [] on both the no-rows path and the catch path — it
            // can never return null. No "unavailable" branch is written for this source.
            return dataFunctions.getContactsForMessaging();
        }).then(function (rows) {
            return Array.isArray(rows) ? rows : [];
        }).catch(function (err) {
            console.warn('[report-whatsapp-send] getContactsForMessaging failed', err);
            return [];
        });

        return Promise.all([savedP, inboxP, crmP]).then(function (results) {
            var built = buildCandidateLists(results[0], results[1], results[2]);
            state.lists = { saved: built.saved, inbox: built.inbox, crm: built.crm };
            state.skippedCount = built.skippedCount;
            state.selected = pruneSelection(state.selected, state.lists);
            renderBody();
        });
    }

    // ------------------------------------------------------------------
    // Candidate selection.
    // ------------------------------------------------------------------

    function handleCandidateToggle($checkbox) {
        var key = $checkbox.attr('data-key');
        if (!key) return;
        if ($checkbox.prop('checked')) {
            if (Object.keys(state.selected).length >= MAX_RECIPIENTS) {
                $checkbox.prop('checked', false);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Maximum reached',
                        text: 'You can select up to ' + MAX_RECIPIENTS + ' recipients.'
                    });
                }
                return;
            }
            var candidate = findCandidateByKey(key);
            if (candidate) state.selected[key] = candidate;
        } else {
            delete state.selected[key];
        }
        updateFooter();
    }

    // ------------------------------------------------------------------
    // Add-a-number sub-form — rendered only behind hasAction('reports.recipient.manage').
    // ------------------------------------------------------------------

    function handleAddRecipientSubmit() {
        if (typeof hasAction !== 'function' || !hasAction('reports.recipient.manage')) return;
        var name = $('#reportWhatsappSendAddName').val();
        var phone = $('#reportWhatsappSendAddPhone').val();
        name = name == null ? '' : String(name).trim();
        phone = phone == null ? '' : String(phone).trim();
        showAddRecipientMessage('');
        if (!name || !phone) {
            showAddRecipientMessage('A display name and phone number are required.');
            return;
        }
        var $btn = $('.js-rws-add-submit');
        $btn.prop('disabled', true);
        dataFunctions.upsertReportRecipient(name, phone, 'manual').then(function (raw) {
            var row = firstRpcRow(raw);
            if (!row || Number(row.success) !== 1) {
                // upsert_report_recipient's own error text is more useful than anything invented
                // here ("A display name is required." / "A valid phone number is required.").
                showAddRecipientMessage((row && row.error) || 'Could not save this recipient.');
                return;
            }
            return loadSources(true);
        }).catch(function (err) {
            console.warn('[report-whatsapp-send] upsertReportRecipient (manual add) failed', err);
            showAddRecipientMessage('Could not save this recipient. Please try again.');
        }).finally(function () {
            $btn.prop('disabled', false);
        });
    }

    // ------------------------------------------------------------------
    // Send.
    //
    // Three separate failure surfaces, each with its own message:
    //   1. getPdfBase64() rejects        -> "the PDF could not be built"; endpoint never called.
    //   2. sendReportWhatsapp() rejects  -> "could not reach the send endpoint" (network/steps
    //      before it); selection kept for a retry.
    //   3. Rendering the (successfully received) response throws -> a distinct, non-retry message
    //      ("submitted, but ... could not be displayed") — the operator must never be told to
    //      re-send a report that already went out.
    // ------------------------------------------------------------------

    function ensureRecipientsSaved(selectedKeys) {
        var canManage = typeof hasAction === 'function' && hasAction('reports.recipient.manage');
        var tasks = selectedKeys.map(function (key) {
            var c = state.selected[key];
            if (!c || c.recipientId || c.source === 'saved' || !canManage) return Promise.resolve();
            var opts = {};
            if (c.contactId) opts.contactId = c.contactId;
            if (c.conversationId) opts.conversationId = c.conversationId;
            return dataFunctions.upsertReportRecipient(c.displayName, c.phone, c.source, opts)
                .then(function (raw) {
                    var row = firstRpcRow(raw);
                    if (row && Number(row.success) === 1 && row.id) {
                        c.recipientId = row.id; // mutates the candidate object held in state.selected
                    }
                })
                .catch(function (err) {
                    // Non-fatal by design: the delivery log records the number either way.
                    console.warn('[report-whatsapp-send] upsertReportRecipient failed (non-fatal)', err);
                });
        });
        return Promise.all(tasks);
    }

    function callSendEndpoint(pdfBase64) {
        return Promise.resolve().then(function () {
            var recipients = buildSendRecipients(state.selected);
            return dataFunctions.sendReportWhatsapp({
                reportInstanceId: state.reportInstanceId,
                pdfBase64: pdfBase64,
                filename: state.filename,
                recipients: recipients
            });
        });
    }

    function showBlockingError(message) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({ icon: 'error', title: 'Could not send', text: message });
        }
    }

    function handleSendResponse(resp) {
        if (!resp || resp.success === false) {
            var msg = (resp && resp.error) ? resp.error : 'Could not send the report.';
            showBlockingError(msg);
            return; // selection intentionally left intact so the operator can retry
        }
        // success: true describes the request, not the outcome — read sent/failed, not success.
        renderResults(resp);
        $(document).trigger('reportWhatsappSend:completed', [{ reportInstanceId: state.reportInstanceId }]);
    }

    function handleSend() {
        if (state.sending) return;
        var selectedKeys = Object.keys(state.selected);
        if (!selectedKeys.length) return;

        setSendingUI(true);
        var stopped = false;

        Promise.resolve().then(function () {
            if (typeof pdfProvider !== 'function') throw new Error('pdf-provider-missing');
            return pdfProvider();
        }).then(function (rawB64) {
            var pdfBase64 = stripDataPrefix(rawB64);
            return ensureRecipientsSaved(selectedKeys).then(function () { return pdfBase64; });
        }).catch(function (pdfErr) {
            stopped = true;
            console.warn('[report-whatsapp-send] PDF build failed', pdfErr);
            showBlockingError('The report PDF could not be built. Please try again.');
            return null;
        }).then(function (pdfBase64) {
            if (stopped || pdfBase64 == null) return null;
            return callSendEndpoint(pdfBase64).catch(function (sendErr) {
                stopped = true;
                console.warn('[report-whatsapp-send] sendReportWhatsapp failed', sendErr);
                showBlockingError('Could not reach the send endpoint. Please try again.');
                return null;
            });
        }).then(function (resp) {
            if (stopped || resp == null) return;
            try {
                handleSendResponse(resp);
            } catch (renderErr) {
                console.warn('[report-whatsapp-send] result rendering failed', renderErr);
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Sent',
                        text: 'The messages were submitted, but the results could not be displayed.'
                    });
                }
            }
        }).finally(function () {
            setSendingUI(false);
            updateFooter();
        });
    }

    // ------------------------------------------------------------------
    // Event wiring — bound directly to this module's own static elements (never $(document)), so
    // destroy() can unbind exactly what this file bound and nothing a sibling module registered
    // under the same namespace.
    // ------------------------------------------------------------------

    function bindEvents() {
        $('#reportWhatsappSendBody').on('change.reportWhatsappSend', '.js-rws-candidate', function () {
            handleCandidateToggle($(this));
        });
        $('#reportWhatsappSendAddForm').on('click.reportWhatsappSend', '.js-rws-add-submit', function (e) {
            e.preventDefault();
            handleAddRecipientSubmit();
        });
        $('#reportWhatsappSendSubmitBtn').on('click.reportWhatsappSend', function () {
            handleSend();
        });
    }

    function unbindEvents() {
        $('#reportWhatsappSendBody').off('.reportWhatsappSend');
        $('#reportWhatsappSendAddForm').off('.reportWhatsappSend');
        $('#reportWhatsappSendSubmitBtn').off('.reportWhatsappSend');
    }

    // ------------------------------------------------------------------
    // Public API.
    // ------------------------------------------------------------------

    function open(options) {
        var opts = options || {};
        state.reportInstanceId = opts.reportInstanceId || null;
        state.filename = opts.filename || null;
        state.periodLabel = opts.periodLabel || null;
        state.selected = {};
        state.lists = { saved: [], inbox: [], crm: [] };
        state.skippedCount = 0;
        state.savedError = false;
        state.inboxAvailable = true;
        state.sending = false;

        // Show first, load second — a slow or failing RPC can never leave the operator staring at
        // nothing.
        showModal();
        loadSources(false);
    }

    return {
        init: function () {
            unbindEvents();
            state.selected = {};
            state.lists = { saved: [], inbox: [], crm: [] };
            state.skippedCount = 0;
            state.savedError = false;
            state.inboxAvailable = true;
            state.sending = false;
            bindEvents();
        },

        destroy: function () {
            unbindEvents();
        },

        open: open,

        setPdfProvider: function (fn) {
            pdfProvider = (typeof fn === 'function') ? fn : null;
        },

        // Exposed for scripts/verify-report-whatsapp-picker.mjs (pure-Node unit checks).
        _normalizeKey: normalizeKey,
        _buildCandidateLists: buildCandidateLists,
        _pruneSelection: pruneSelection,
        _buildSendRecipients: buildSendRecipients,
        _summarizeSend: summarizeSend
    };
})();

if (typeof window !== 'undefined') {
    window.ReportWhatsappSend = ReportWhatsappSend;
}
