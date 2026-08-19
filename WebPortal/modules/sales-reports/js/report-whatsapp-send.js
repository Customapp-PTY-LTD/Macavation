/**
 * Report WhatsApp send dialog — recipient picker + send flow for a PUBLISHED report.
 *
 * Recipient sources (both re-verified against this checkout — see the plan this file was built
 * from for file:line citations):
 *   - dataFunctions.chatListWhatsappConversations(userId) — the shared WhatsApp inbox. Returns
 *     `null` when the RPC is absent from the database (migration not applied); that is NOT an
 *     error, it means "this source is unavailable here" and is shown as a note, not a failure.
 *   - dataFunctions.getContactsForMessaging() — CRM contacts. Always returns an array (`[]` on
 *     both the no-rows and the catch path) — it can never return `null`, so this source never
 *     shows an "unavailable" note.
 * There is no saved-recipient store anywhere in this repo. A number typed into the "send to
 * another number" field is session-only: it is never persisted, and disappears when this dialog
 * is closed.
 *
 * Namespace-assignment pattern only (see report-pdf-builder.js's own header comment for the same
 * convention): at EVALUATION time this file touches nothing but `w`. No `$(...)`, no `document`,
 * no `dataFunctions` reference outside a function body, and no auto-init call — those all live
 * inside the exported functions, so this file can be loaded into a bare `node:vm` context with no
 * DOM and no jQuery (see scripts/verify-report-whatsapp-picker.mjs).
 *
 * normalizePhoneKey/mergeRecipientCandidates are pure functions of their arguments — no closure
 * over module state — so the verify script can exercise them directly.
 */
(function (w) {
    'use strict';

    var MAX_RECIPIENTS = 25;

    // ------------------------------------------------------------------
    // Pure helpers — normalisation + merge. No DOM, no globals, no module state.
    // ------------------------------------------------------------------

    /**
     * Mirrors public.chat_normalize_phone exactly (migrations/20260813090000_..._shared_inbox.sql):
     * strip every non-digit; empty -> null; a leading '0' becomes '27'; otherwise prefix '27' when
     * the result does not already start with '27' and is 11 digits or fewer. Never adds a '+'.
     * This is a comparison key ONLY — the original value is what gets sent, never this key.
     */
    function normalizePhoneKey(value) {
        var digits = String(value === null || value === undefined ? '' : value).replace(/\D/g, '');
        if (digits === '') return null;
        if (/^0/.test(digits)) {
            digits = '27' + digits.slice(1);
        }
        if (!/^27/.test(digits) && digits.length <= 11) {
            digits = '27' + digits;
        }
        return digits;
    }

    function isUsableKey(key) {
        return typeof key === 'string' && key.length >= 11;
    }

    /**
     * De-duplicates inbox rows (chat_list_whatsapp_conversations shape) and CRM rows
     * (get_contacts_for_messaging shape) into one list, keyed by normalizePhoneKey(number).
     * On a collision the inbox row wins; the CRM copy of the same number is dropped (not counted
     * as skipped — it is not "no usable number", it is a duplicate of a row already shown).
     *
     * A candidate is SKIPPED (not rendered, counted in `skipped` instead) when it has no usable
     * number: normalizePhoneKey yields null, or a key shorter than 11 characters, or (CRM only)
     * both phone fields are empty.
     *
     * An inbox row whose own `success` is 0 is a failed-RPC-row shape, not a contact — it is
     * excluded and is NOT counted as skipped.
     */
    function mergeRecipientCandidates(inboxRows, crmRows) {
        var inbox = Array.isArray(inboxRows) ? inboxRows : [];
        var crm = Array.isArray(crmRows) ? crmRows : [];

        var byKey = {};
        var order = [];
        var skipped = 0;

        inbox.forEach(function (row) {
            if (!row) return;
            if (Number(row.success) === 0) return; // failed-row shape, not a contact
            var phone = row.external_phone;
            var key = normalizePhoneKey(phone);
            if (!isUsableKey(key)) { skipped++; return; }
            if (byKey[key]) return; // duplicate inbox row for the same number
            var rawLabel = row.other_party_name;
            var label = (rawLabel !== null && rawLabel !== undefined && String(rawLabel).trim() !== '')
                ? String(rawLabel)
                : 'Unknown number';
            byKey[key] = { key: key, source: 'inbox', phone: String(phone == null ? '' : phone), label: label };
            order.push(key);
        });

        crm.forEach(function (row) {
            if (!row) return;
            var phone = row.primary_contact_mobile || row.primary_contact_phone;
            if (!phone || !String(phone).trim()) { skipped++; return; }
            var key = normalizePhoneKey(phone);
            if (!isUsableKey(key)) { skipped++; return; }
            if (byKey[key]) return; // inbox wins on a same-number collision
            var label = row.company_name || row.primary_contact_name || 'Unnamed contact';
            byKey[key] = { key: key, source: 'crm', phone: String(phone), label: String(label) };
            order.push(key);
        });

        return {
            rows: order.map(function (k) { return byKey[k]; }),
            skipped: skipped
        };
    }

    // ------------------------------------------------------------------
    // Module state — private to this file.
    // ------------------------------------------------------------------

    var state = {
        reportInstanceId: null,
        filename: null,
        periodLabel: null,
        getPdfBase64: null,
        rows: [],          // merged inbox+CRM candidates, from mergeRecipientCandidates
        manualRows: [],    // session-only typed numbers, never persisted
        selected: {},       // key -> { phone, displayName }
        sending: false
    };

    function resetState() {
        state.reportInstanceId = null;
        state.filename = null;
        state.periodLabel = null;
        state.getPdfBase64 = null;
        state.rows = [];
        state.manualRows = [];
        state.selected = {};
        state.sending = false;
    }

    function allRows() {
        return state.rows.concat(state.manualRows);
    }

    function findRowByKey(key) {
        var rows = allRows();
        for (var i = 0; i < rows.length; i++) {
            if (rows[i].key === key) return rows[i];
        }
        return null;
    }

    // ------------------------------------------------------------------
    // Rendering — every payload/label value reaches the DOM via .text() only.
    // ------------------------------------------------------------------

    function recipientRowMarkup(row, checked) {
        var $wrap = $('<div>', { 'class': 'form-check js-wa-recipient-row' }).attr('data-key', row.key);
        var inputId = 'waRecip-' + row.key;
        var $input = $('<input>', {
            type: 'checkbox',
            id: inputId,
            'class': 'form-check-input js-wa-recipient-checkbox'
        }).attr('data-key', row.key).prop('checked', !!checked);
        var $label = $('<label>', { 'class': 'form-check-label', 'for': inputId });
        $label.append($('<span>').text(row.label));
        $label.append(' ');
        $label.append($('<span>', { 'class': 'text-muted small' }).text(row.phone));
        $wrap.append($input).append($label);
        return $wrap;
    }

    function renderGroup(selector, rows, emptyText) {
        var $group = $(selector).empty();
        if (!rows.length) {
            $group.append($('<div>', { 'class': 'text-muted small' }).text(emptyText));
            return;
        }
        rows.forEach(function (row) {
            $group.append(recipientRowMarkup(row, !!state.selected[row.key]));
        });
    }

    function renderManualGroup() {
        var $group = $('#reportWhatsappSendManualList').empty();
        if (!state.manualRows.length) return;
        state.manualRows.forEach(function (row) {
            $group.append(recipientRowMarkup(row, !!state.selected[row.key]));
        });
    }

    function updateFooter() {
        var count = Object.keys(state.selected).length;
        $('#reportWhatsappSendSelectedCount').text(
            count + ' recipient' + (count === 1 ? '' : 's') + ' selected'
        );
        $('#reportWhatsappSendCapNote').toggleClass('d-none', count < MAX_RECIPIENTS);
        $('#reportWhatsappSendBtn').prop('disabled', count === 0 || state.sending);
    }

    function renderSkippedNote(count) {
        var $note = $('#reportWhatsappSendSkippedNote');
        if (!count) { $note.addClass('d-none').text(''); return; }
        $note.removeClass('d-none').text(
            count + ' contact' + (count === 1 ? '' : 's') + ' have no usable mobile number.'
        );
    }

    function clearResults() {
        $('#reportWhatsappSendResults').empty().addClass('d-none');
    }

    // ------------------------------------------------------------------
    // Loading the two sources.
    // ------------------------------------------------------------------

    function loadSources() {
        $('#reportWhatsappSendLoading').removeClass('d-none');
        $('#reportWhatsappSendGroups').addClass('d-none');

        var inboxPromise = dataFunctions.chatListWhatsappConversations(dataFunctions.getCurrentUserId())
            .catch(function (err) {
                console.warn('[report-whatsapp-send] inbox load failed', err);
                return [];
            });
        var crmPromise = dataFunctions.getContactsForMessaging()
            .catch(function (err) {
                console.warn('[report-whatsapp-send] CRM contacts load failed', err);
                return [];
            });

        return Promise.all([inboxPromise, crmPromise]).then(function (results) {
            var inboxResult = results[0];
            var crmResult = Array.isArray(results[1]) ? results[1] : [];

            var inboxUnavailable = (inboxResult === null || inboxResult === undefined);
            var inboxRows = inboxUnavailable ? [] : inboxResult;

            var merged = mergeRecipientCandidates(inboxRows, crmResult);
            state.rows = merged.rows;

            var inboxGroupRows = merged.rows.filter(function (r) { return r.source === 'inbox'; });
            var crmGroupRows = merged.rows.filter(function (r) { return r.source === 'crm'; });

            if (inboxUnavailable) {
                $('#reportWhatsappSendInboxUnavailable').removeClass('d-none');
                $('#reportWhatsappSendInboxList').empty();
            } else {
                $('#reportWhatsappSendInboxUnavailable').addClass('d-none');
                renderGroup('#reportWhatsappSendInboxList', inboxGroupRows, 'No WhatsApp inbox conversations found.');
            }
            renderGroup('#reportWhatsappSendCrmList', crmGroupRows, 'No CRM contacts found.');
            renderSkippedNote(merged.skipped);

            $('#reportWhatsappSendLoading').addClass('d-none');
            $('#reportWhatsappSendGroups').removeClass('d-none');
            updateFooter();
        });
    }

    // ------------------------------------------------------------------
    // Selection handling.
    // ------------------------------------------------------------------

    function handleCheckboxChange($checkbox) {
        var key = $checkbox.data('key');
        var row = findRowByKey(key);
        if (!row) return;

        if ($checkbox.prop('checked')) {
            var currentCount = Object.keys(state.selected).length;
            if (currentCount >= MAX_RECIPIENTS) {
                $checkbox.prop('checked', false);
                Swal.fire({
                    icon: 'warning',
                    title: 'Too many recipients',
                    text: 'You can select up to ' + MAX_RECIPIENTS + ' recipients for one send.'
                });
                return;
            }
            state.selected[key] = { phone: row.phone, displayName: row.label };
        } else {
            delete state.selected[key];
        }
        updateFooter();
    }

    // ------------------------------------------------------------------
    // "Send to another number" — session-only, never persisted.
    // ------------------------------------------------------------------

    function handleAddManualNumber() {
        var $label = $('#reportWhatsappSendOtherLabel');
        var $number = $('#reportWhatsappSendOtherNumber');
        var $error = $('#reportWhatsappSendOtherError');

        var labelVal = String($label.val() == null ? '' : $label.val()).trim();
        var numberVal = String($number.val() == null ? '' : $number.val()).trim();
        var key = normalizePhoneKey(numberVal);

        if (!isUsableKey(key)) {
            $error.removeClass('d-none').text('Enter a valid mobile number.');
            return;
        }
        $error.addClass('d-none').text('');

        var existing = findRowByKey(key);
        if (existing) {
            // Already listed above (from a source or a previous manual add) — select it instead
            // of adding a duplicate row.
            state.selected[key] = { phone: existing.phone, displayName: existing.label };
            $('.js-wa-recipient-checkbox[data-key="' + key + '"]').prop('checked', true);
            $label.val('');
            $number.val('');
            updateFooter();
            return;
        }

        var currentCount = Object.keys(state.selected).length;
        if (currentCount >= MAX_RECIPIENTS) {
            Swal.fire({
                icon: 'warning',
                title: 'Too many recipients',
                text: 'You can select up to ' + MAX_RECIPIENTS + ' recipients for one send.'
            });
            return;
        }

        var displayLabel = labelVal || numberVal;
        var newRow = { key: key, source: 'manual', phone: numberVal, label: displayLabel };
        state.manualRows.push(newRow);
        state.selected[key] = { phone: newRow.phone, displayName: newRow.label };

        renderManualGroup();
        updateFooter();
        $label.val('');
        $number.val('');
    }

    // ------------------------------------------------------------------
    // Send.
    // ------------------------------------------------------------------

    function stripDataUriPrefix(b64) {
        return String(b64 == null ? '' : b64).replace(/^data:[^;]*;base64,/, '');
    }

    function renderSendResults(res) {
        var $results = $('#reportWhatsappSendResults').empty().removeClass('d-none');
        if (res && Array.isArray(res.results)) {
            res.results.forEach(function (r) {
                var $row = $('<div>', { 'class': 'd-flex align-items-center gap-2 py-1 border-bottom' });
                $row.append($('<span>', { 'class': 'flex-grow-1' }).text(
                    (r && (r.displayName || r.phone)) || 'Recipient'
                ));
                $row.append($(MacStatus.pill((r && r.status) || 'unknown')));
                if (r && r.error) {
                    $row.append($('<span>', { 'class': 'text-danger small' }).text(String(r.error)));
                }
                $results.append($row);
            });
        } else {
            $results.append($('<div>', { 'class': 'text-muted small' })
                .text('The send completed but returned no per-recipient detail.'));
        }
    }

    function handleSend() {
        if (typeof hasAction !== 'function' || !hasAction('reports.report.generate')) {
            Swal.fire({ icon: 'warning', title: 'Not permitted', text: 'You do not have permission for this action.' });
            return;
        }
        if (state.sending) return;

        var recipients = Object.keys(state.selected).map(function (key) {
            var sel = state.selected[key];
            return { phone: sel.phone, displayName: sel.displayName };
        });
        if (!recipients.length) return;

        state.sending = true;
        var $btn = $('#reportWhatsappSendBtn');
        var originalHtml = $btn.html();
        $btn.prop('disabled', true).html('<i class="fas fa-spinner fa-spin me-1"></i>Sending&hellip;');
        clearResults();

        var getPdf = (typeof state.getPdfBase64 === 'function') ? state.getPdfBase64 : function () {
            return Promise.reject(new Error('getPdfBase64 is not configured'));
        };

        getPdf().then(function (pdfBase64) {
            var cleanBase64 = stripDataUriPrefix(pdfBase64);
            return Promise.resolve()
                .then(function () {
                    return dataFunctions.sendReportWhatsapp({
                        reportInstanceId: state.reportInstanceId,
                        pdfBase64: cleanBase64,
                        filename: state.filename,
                        recipients: recipients
                    });
                })
                .catch(function (err) {
                    // sendReportWhatsapp throws on its own argument validation; present that the
                    // same way as a returned failure rather than letting it propagate silently.
                    return { success: false, error: (err && err.message) ? err.message : String(err) };
                });
        }, function () {
            Swal.fire({
                icon: 'error',
                title: 'Could not build the PDF',
                text: 'The report PDF could not be built. Please try again.'
            });
            return null;
        }).then(function (res) {
            if (res === null) return; // PDF build failed; already reported above.

            if (!res || res.success === false) {
                Swal.fire({
                    icon: 'error',
                    title: 'Send failed',
                    text: (res && res.error) ? String(res.error) : 'The send could not be completed.'
                });
                return; // Leave selection intact so the operator can retry.
            }

            renderSendResults(res);
            $(document).trigger('reportWhatsappSend:completed', [{ reportInstanceId: state.reportInstanceId }]);
        }).catch(function (err) {
            console.warn('[report-whatsapp-send] unexpected send failure', err);
            Swal.fire({
                icon: 'error',
                title: 'Send failed',
                text: 'The send could not be completed. Please try again.'
            });
        }).finally(function () {
            state.sending = false;
            $btn.html(originalHtml);
            updateFooter();
        });
    }

    // ------------------------------------------------------------------
    // Lifecycle.
    // ------------------------------------------------------------------

    function bindEvents() {
        $(document).on('change.reportWhatsappSend', '.js-wa-recipient-checkbox', function () {
            handleCheckboxChange($(this));
        });
        $(document).on('click.reportWhatsappSend', '#reportWhatsappSendAddNumberBtn', function () {
            handleAddManualNumber();
        });
        $(document).on('click.reportWhatsappSend', '#reportWhatsappSendBtn', function () {
            handleSend();
        });
        $(document).on('hidden.bs.modal.reportWhatsappSend', '#reportWhatsappSendModal', function () {
            resetState();
        });
    }

    function init() {
        destroy();
        bindEvents();
    }

    function destroy() {
        $(document).off('.reportWhatsappSend');
        resetState();
    }

    function open(options) {
        var opts = options || {};
        resetState();
        state.reportInstanceId = opts.reportInstanceId || null;
        state.filename = opts.filename || null;
        state.periodLabel = opts.periodLabel || null;
        state.getPdfBase64 = opts.getPdfBase64 || null;

        $('#reportWhatsappSendPeriodLabel').text(state.periodLabel || '');
        $('#reportWhatsappSendOtherLabel').val('');
        $('#reportWhatsappSendOtherNumber').val('');
        $('#reportWhatsappSendOtherError').addClass('d-none').text('');
        $('#reportWhatsappSendManualList').empty();
        clearResults();
        updateFooter();

        $('#reportWhatsappSendModal').modal('show');
        loadSources().catch(function (err) {
            console.warn('[report-whatsapp-send] failed to load recipient sources', err);
            $('#reportWhatsappSendLoading').addClass('d-none');
            $('#reportWhatsappSendGroups').removeClass('d-none');
        });
    }

    w.ReportWhatsappSend = {
        init: init,
        destroy: destroy,
        open: open,
        normalizePhoneKey: normalizePhoneKey,
        mergeRecipientCandidates: mergeRecipientCandidates
    };
})(typeof window !== 'undefined' ? window : this);
