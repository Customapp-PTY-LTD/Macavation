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

    // "Open this report": the report editor now lives inside the Management reports page
    // (reports_page.js), so this selects the report there instead of routing away. The page checks
    // the id; role access to the editor is checked here as before (roleMenuConfig.hasAccess returns
    // a strict boolean, and the router only gates when a role is known).
    function openReportEditor(reportId) {
        if (typeof roleMenuConfig !== 'undefined' && roleMenuConfig.getUserRole() &&
            roleMenuConfig.hasAccess('sales-report-editor') !== true) {
            Swal.fire({ icon: 'info', title: 'Report editing not enabled', text: 'Report editing has not been enabled for your role yet. An administrator must apply the report-builder permissions migration, then sign out and back in.' });
            return false;
        }
        if (!isReportUuid(reportId)) {
            console.warn('[sales-reports] refusing to open editor for invalid report id');
            Swal.fire({ icon: 'error', title: 'Could not open report', text: 'That report could not be opened. Refresh the list and try again.' });
            return false;
        }
        if (window._reportsPage && window._reportsPage.openInstance) {
            window._reportsPage.openInstance(reportId);
            return true;
        }
        return false;
    }

    // Re-reads the history list on the page after a create/delete.
    function load() {
        if (window._reportsPage && window._reportsPage.reload) return window._reportsPage.reload();
        return Promise.resolve();
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
                load();
                return;
            }
            var row = firstRpcRow(result);
            if (Number(row && row.success) === 1) {
                hideNewReportModal();
                load();
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
            text: 'This will permanently delete the draft report. This action cannot be undone. A draft for last week or last month is re-created automatically next time Reports opens.',
            showCancelButton: true,
            confirmButtonText: 'Delete',
            confirmButtonColor: '#d33'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            dataFunctions.deleteReportInstance(reportId).then(function (delResult) {
                if (isQueuedOffline(delResult)) {
                    Swal.fire({ icon: 'info', title: 'Delete queued', text: 'You are offline. The delete will be sent when the connection returns.' });
                    load();
                    return;
                }
                var row = firstRpcRow(delResult);
                if (Number(row && row.success) === 1) {
                    load();
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

    // ------------------------------------------------------------------
    // Report distribution — who gets these reports.
    //
    // Replaces the Scheduled Reports module. That screen wrote to scheduled_reports, which had no
    // schedule column and which nothing has ever sent from; this panel drives report_subscriptions,
    // the list send-daily-production-report actually reads.
    //
    // Recipients arrive two ways: added here with "Add person" (upsert_report_recipient), or by
    // joining themselves on WhatsApp by messaging the number the word "reports"
    // (report_recipient_by_inbound_phone / set_report_subscription_by_phone, in
    // supabase/functions/whatsapp-inbound/index.ts). This panel then decides which reports an
    // existing recipient receives, whichever way they arrived.
    // ------------------------------------------------------------------

    function distributionEsc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml)
            ? _common.escapeHtml(v)
            : String(v == null ? '' : v);
    }

    function subscriptionCell(recipientId, kind, sub) {
        var subscribed = !!(sub && sub.subscribed);
        var muted = sub && sub.muted_until ? String(sub.muted_until).slice(0, 10) : '';
        var title = muted ? 'Paused until ' + muted : '';
        return '<td class="text-center">' +
            '<input type="checkbox" class="form-check-input js-report-sub"' +
            ' data-recipient-id="' + distributionEsc(recipientId) + '"' +
            ' data-report-kind="' + distributionEsc(kind) + '"' +
            (subscribed ? ' checked' : '') +
            ' aria-label="' + distributionEsc(kind) + ' report">' +
            (muted ? '<div class="small text-warning mt-1" title="' + distributionEsc(title) + '">' +
                     '<i class="fas fa-clock me-1"></i>' + distributionEsc(muted) + '</div>' : '') +
            '</td>';
    }

    // Status column: the existing Active/Inactive badge, plus a Staff toggle. Deliberately kept in
    // the Status column rather than a new one — a new column here would push the table wider than
    // its container (the Daily/Weekly/Monthly columns already use the table's full width).
    function statusCell(r) {
        var statusBadge = r.is_active
            ? '<span class="badge bg-success-subtle text-success-emphasis">Active</span>'
            : '<span class="badge bg-secondary-subtle text-secondary-emphasis">Inactive</span>';
        return '<td>' + statusBadge +
            ' <span class="form-check form-check-inline mb-0 ms-2">' +
            '<input type="checkbox" class="form-check-input js-report-staff"' +
            ' data-recipient-id="' + distributionEsc(r.recipient_id) + '"' +
            (r.is_staff ? ' checked' : '') +
            ' aria-label="Staff">' +
            '<label class="form-check-label small text-muted">Staff</label>' +
            '</span></td>';
    }

    // "Remove" (contract 2: deactivate, never delete) — an icon button, matching the fa-* icon set
    // already used throughout this file rather than introducing a second one.
    function actionsCell(r) {
        return '<td class="text-end">' +
            '<button type="button" class="btn btn-sm btn-outline-secondary js-report-remove"' +
            ' data-recipient-id="' + distributionEsc(r.recipient_id) + '"' +
            ' data-recipient-name="' + distributionEsc(r.display_name || r.phone || '') + '"' +
            ' title="Remove (deactivate)" aria-label="Remove">' +
            '<i class="fas fa-user-slash"></i></button>' +
            '</td>';
    }

    // The last list shown, so the "Pick from users" dropdown can mark who is already on it.
    var lastRecipients = [];

    function renderDistribution(recipients) {
        lastRecipients = recipients || [];
        var $tbody = $('#reportDistributionTableBody');
        if (!$tbody.length) return;

        if (!recipients.length) {
            $tbody.html('<tr><td colspan="7" class="text-center text-muted py-4">' +
                'Nobody is set up to receive reports yet. Use "Add person" above, or they can message ' +
                'the WhatsApp number with the word "reports" to join themselves.' +
                '</td></tr>');
            return;
        }

        $tbody.html(recipients.map(function (r) {
            return '<tr>' +
                '<td>' + distributionEsc(r.display_name || '—') + '</td>' +
                '<td>' + distributionEsc(r.phone || '—') + '</td>' +
                subscriptionCell(r.recipient_id, 'daily', r.daily) +
                subscriptionCell(r.recipient_id, 'weekly', r.weekly) +
                subscriptionCell(r.recipient_id, 'monthly', r.monthly) +
                statusCell(r) +
                actionsCell(r) +
                '</tr>';
        }).join(''));
    }

    function loadDistribution() {
        var $tbody = $('#reportDistributionTableBody');
        if (!$tbody.length || !dataFunctions.listReportDistribution) return Promise.resolve();
        $tbody.html('<tr><td colspan="7" class="text-center text-muted py-4">' +
            '<i class="fas fa-spinner fa-spin me-2"></i>Loading recipients…</td></tr>');
        var includeInactive = $('#reportDistributionShowInactive').prop('checked');
        return dataFunctions.listReportDistribution(includeInactive)
            .then(renderDistribution)
            .catch(function (err) {
                console.warn('[sales-reports] listReportDistribution failed', err);
                $tbody.html('<tr><td colspan="7" class="text-center text-muted py-4">' +
                    'Report recipients are not available on this database yet.</td></tr>');
            });
    }

    function toggleSubscription($checkbox) {
        var recipientId = $checkbox.data('recipient-id');
        var kind = $checkbox.data('report-kind');
        var wanted = $checkbox.prop('checked');
        $checkbox.prop('disabled', true);
        dataFunctions.setReportSubscription(recipientId, kind, wanted)
            .then(function (result) {
                if (result && result.ok === false) {
                    $checkbox.prop('checked', !wanted);
                    Swal.fire({ icon: 'error', text: result.error || 'Could not change that subscription.' });
                    return;
                }
                // Re-read rather than trusting the local tick: ticking a box back on also clears
                // any WhatsApp pause server-side, and the row has to show that.
                return loadDistribution();
            })
            .catch(function (err) {
                console.warn('[sales-reports] setReportSubscription failed', err);
                $checkbox.prop('checked', !wanted);
                Swal.fire({ icon: 'error', text: 'Could not change that subscription.' });
            })
            .finally(function () {
                $checkbox.prop('disabled', false);
            });
    }

    // ------------------------------------------------------------------
    // Add person — contract 1. A modal, not a new page. On submit: upsert_report_recipient, then
    // set_report_subscription once per ticked kind (all off by default — adding someone must never
    // silently opt them into anything). Follows the panel's existing re-fetch-after-write pattern.
    // ------------------------------------------------------------------

    // "Pick from users" — fills Name and WhatsApp number from a portal user so they don't have to
    // be retyped. The verified WhatsApp number wins over the profile mobile. Saving still goes
    // through upsert_report_recipient, which matches on the normalised phone, so picking someone
    // already on the list updates their row rather than duplicating it.
    var pickerUsers = [];

    function phoneTail(p) {
        return String(p == null ? '' : p).replace(/\D/g, '').slice(-9);
    }

    function userDisplayName(u) {
        var name = [u.first_name, u.last_name].map(function (x) { return (x || '').trim(); })
            .filter(Boolean).join(' ');
        return name || u.email || '';
    }

    function userPhone(u) {
        return (u.whatsapp_phone || '').trim() || (u.mobile_number || '').trim();
    }

    function loadRecipientUserPicker() {
        var $sel = $('#addReportRecipientUser');
        $('#addReportRecipientUserHint').text('');
        if (!$sel.length || !dataFunctions.getUsers) return;
        $sel.find('option:not(:first)').remove();
        dataFunctions.getUsers()
            .then(function (users) {
                var onList = {};
                lastRecipients.forEach(function (r) {
                    if (r.is_active && phoneTail(r.phone)) onList[phoneTail(r.phone)] = true;
                });
                pickerUsers = (users || []).filter(function (u) { return u && u.is_active !== false; })
                    .sort(function (a, b) { return userDisplayName(a).localeCompare(userDisplayName(b)); });
                $sel.append(pickerUsers.map(function (u, i) {
                    var phone = userPhone(u);
                    var note = !phone ? ' (no number on profile)'
                        : (onList[phoneTail(phone)] ? ' (already on the list)' : '');
                    return '<option value="' + i + '">' + distributionEsc(userDisplayName(u) + note) + '</option>';
                }).join(''));
            })
            .catch(function (err) {
                console.warn('[sales-reports] getUsers failed', err);
            });
    }

    function applyPickedUser() {
        var idx = $('#addReportRecipientUser').val();
        var u = idx === '' ? null : pickerUsers[Number(idx)];
        var $hint = $('#addReportRecipientUserHint');
        if (!u) {
            $hint.text('');
            return;
        }
        var phone = userPhone(u);
        $('#addReportRecipientName').val(userDisplayName(u));
        $('#addReportRecipientPhone').val(phone);
        $hint.text(phone ? '' : 'There is no number on their user profile. Type their WhatsApp number below.');
        if (!phone) $('#addReportRecipientPhone').trigger('focus');
    }

    function openAddRecipientModal() {
        var form = document.getElementById('addReportRecipientForm');
        if (form) form.reset();
        loadRecipientUserPicker();
        var modalEl = document.getElementById('addReportRecipientModal');
        if (modalEl && typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
        else if (typeof $ !== 'undefined' && $.fn.modal) $('#addReportRecipientModal').modal('show');
    }

    function hideAddRecipientModal() {
        var modalEl = document.getElementById('addReportRecipientModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            var inst = bootstrap.Modal.getInstance(modalEl);
            if (inst) inst.hide();
        } else if (typeof $ !== 'undefined' && $.fn.modal) {
            $('#addReportRecipientModal').modal('hide');
        }
    }

    function handleAddRecipient() {
        var form = document.getElementById('addReportRecipientForm');
        if (form && !form.checkValidity()) {
            form.reportValidity();
            return;
        }
        var name = $('#addReportRecipientName').val();
        var phone = $('#addReportRecipientPhone').val();
        var kinds = [];
        if ($('#addReportRecipientDaily').prop('checked')) kinds.push('daily');
        if ($('#addReportRecipientWeekly').prop('checked')) kinds.push('weekly');
        if ($('#addReportRecipientMonthly').prop('checked')) kinds.push('monthly');

        var $btn = $('#saveReportRecipientBtn');
        $btn.prop('disabled', true);
        var addFailed = false;
        dataFunctions.upsertReportRecipient(name, phone, 'manual')
            .then(function (result) {
                var row = firstRpcRow(result);
                if (!row || Number(row.success) !== 1) {
                    addFailed = true;
                    var msg = (row && row.error) ? row.error : 'Could not add that person.';
                    Swal.fire({ icon: 'error', title: 'Could not add person', text: msg });
                    return null;
                }
                var recipientId = row.id;
                // Each ticked kind is its own call — sequential, not parallel, so a later failure
                // never races an earlier one for the same recipient_id.
                return kinds.reduce(function (chain, kind) {
                    return chain.then(function () {
                        return dataFunctions.setReportSubscription(recipientId, kind, true);
                    });
                }, Promise.resolve());
            })
            .then(function () {
                if (addFailed) return;
                hideAddRecipientModal();
                // Re-fetch rather than hand-patching the DOM, same as toggleSubscription above.
                loadDistribution();
            })
            .catch(function (err) {
                console.warn('[sales-reports] add recipient failed', err);
                Swal.fire({
                    icon: 'error',
                    title: 'Could not add person',
                    text: 'Report recipients are not available on this database yet.'
                });
            })
            .finally(function () {
                $btn.prop('disabled', false);
            });
    }

    // ------------------------------------------------------------------
    // Staff toggle — contract 3. A small, separate addition; set_report_recipient_staff has had no
    // portal caller until now despite existing since 25 August.
    // ------------------------------------------------------------------

    function toggleStaff($checkbox) {
        var recipientId = $checkbox.data('recipient-id');
        var wanted = $checkbox.prop('checked');
        $checkbox.prop('disabled', true);
        dataFunctions.setReportRecipientStaff(recipientId, wanted)
            .then(function (result) {
                if (result && result.ok === false) {
                    $checkbox.prop('checked', !wanted);
                    Swal.fire({ icon: 'error', text: result.error || 'Could not change that.' });
                    return;
                }
                return loadDistribution();
            })
            .catch(function (err) {
                console.warn('[sales-reports] setReportRecipientStaff failed', err);
                $checkbox.prop('checked', !wanted);
                Swal.fire({ icon: 'error', text: 'Could not change that.' });
            })
            .finally(function () {
                $checkbox.prop('disabled', false);
            });
    }

    // ------------------------------------------------------------------
    // Remove — contract 2. Deactivate only; there is no delete. The row stays visible only when
    // "Show inactive" is ticked, exactly as an already-inactive row behaves today.
    // ------------------------------------------------------------------

    function confirmRemoveRecipient(recipientId, name) {
        Swal.fire({
            icon: 'warning',
            title: 'Remove this person?',
            text: 'This deactivates ' + (name || 'them') + '; they will stop receiving reports. ' +
                'You can bring them back later by ticking "Show inactive".',
            showCancelButton: true,
            confirmButtonText: 'Remove',
            confirmButtonColor: '#d33'
        }).then(function (result) {
            if (!result.isConfirmed) return;
            dataFunctions.setReportRecipientActive(recipientId, false)
                .then(function (delResult) {
                    var row = firstRpcRow(delResult);
                    if (!row || Number(row.success) !== 1) {
                        var msg = (row && row.error) ? row.error : 'Could not remove that person.';
                        Swal.fire({ icon: 'error', text: msg });
                        return;
                    }
                    loadDistribution();
                })
                .catch(function (err) {
                    console.warn('[sales-reports] setReportRecipientActive failed', err);
                    Swal.fire({ icon: 'error', text: 'Could not remove that person.' });
                });
        });
    }

    function bindEvents() {
        $(document).on('click.salesReports', '#reportsOtherPeriodBtn', function () {
            openNewReportModal();
        });
        $(document).on('click.salesReports', '#refreshReportDistributionBtn', function () {
            loadDistribution();
        });
        $(document).on('change.salesReports', '#reportDistributionShowInactive', function () {
            loadDistribution();
        });
        $(document).on('change.salesReports', '.js-report-sub', function () {
            toggleSubscription($(this));
        });
        $(document).on('click.salesReports', '#addReportRecipientBtn', function () {
            openAddRecipientModal();
        });
        $(document).on('change.salesReports', '#addReportRecipientUser', function () {
            applyPickedUser();
        });
        $(document).on('click.salesReports', '#saveReportRecipientBtn', function () {
            handleAddRecipient();
        });
        $(document).on('change.salesReports', '.js-report-staff', function () {
            toggleStaff($(this));
        });
        $(document).on('click.salesReports', '.js-report-remove', function (e) {
            e.preventDefault();
            confirmRemoveRecipient($(this).data('recipient-id'), $(this).data('recipient-name'));
        });
        $(document).on('click.salesReports', '.js-report-delete', function (e) {
            e.preventDefault();
            confirmDeleteReport(String($(this).attr('data-report-id') || ''));
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
            // Not destroy(): that would also tear down _reportsPage, which de-duplicates a double init itself.
            $(document).off('.salesReports');
            bindEvents();
            loadDistribution();
            if (window._reportsPage) window._reportsPage.init();
        },

        destroy: function () {
            $(document).off('.salesReports');
            if (window._reportsPage) window._reportsPage.destroy();
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
