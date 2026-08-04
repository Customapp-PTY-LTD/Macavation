/**
 * Scheduled Reports admin — daily digest email subscriptions.
 */
var _scheduledReportsGrid = function () {
    'use strict';

    return {
        rows: [],

        init: async () => {
            const scope = _scheduledReportsGrid;
            await new Promise(function (resolve) { $(document).ready(resolve); });
            scope.bindEvents();
            await scope.load();
            scope.previewDigest(true);
        },

        bindEvents: () => {
            const scope = _scheduledReportsGrid;
            $('#refreshScheduledReportsBtn').off('click').on('click', function () { scope.load(); });
            $('#addScheduledReportBtn').off('click').on('click', function () { scope.addRow(); });
            $('#previewDailyDigestBtn').off('click').on('click', function () { scope.previewDigest(); });
            $('#srWhatsAppPreviewBtn').off('click').on('click', function () { scope.previewDigest(true); });
            $(document).off('click', '.js-save-scheduled-report').on('click', '.js-save-scheduled-report', function () {
                scope.saveRow($(this).closest('tr'));
            });
        },

        load: async () => {
            const scope = _scheduledReportsGrid;
            var tbody = document.getElementById('scheduledReportsTableBody');
            if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading...</td></tr>';
            try {
                var rows = await dataFunctions.getScheduledReports();
                scope.rows = Array.isArray(rows) ? rows : [];
                scope.render();
            } catch (e) {
                if (tbody) tbody.innerHTML = '<tr><td colspan="6" class="text-danger text-center py-4">' + scope.escapeHtml(e.message || '') + '</td></tr>';
            }
        },

        render: () => {
            const scope = _scheduledReportsGrid;
            var tbody = document.getElementById('scheduledReportsTableBody');
            if (!tbody) return;
            if (scope.rows.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No subscriptions. Use Add subscription.</td></tr>';
                return;
            }
            tbody.innerHTML = scope.rows.map(function (r) { return scope.rowHtml(r); }).join('');
            MacTableActions.init(document.getElementById('scheduledReportsTable'));
            scope.renderWhatsAppPlannedList();
        },

        renderWhatsAppPlannedList: () => {
            var tbody = document.getElementById('srWhatsAppPlannedListBody');
            if (!tbody) return;
            var waRows = (_scheduledReportsGrid.rows || []).filter(function (r) {
                return r && String(r.channel || '').toLowerCase() === 'whatsapp';
            });
            if (!waRows.length) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 small text-muted">No WhatsApp subscriptions yet — channel goes live after Business API setup.</td></tr>';
                return;
            }
            tbody.innerHTML = waRows.map(function (r) {
                return '<tr><td>' + _scheduledReportsGrid.escapeHtml(r.email || r.phone || '—') + '</td>' +
                    '<td>' + _scheduledReportsGrid.escapeHtml(r.report_type || 'daily_digest') + '</td>' +
                    '<td>' + (r.is_active !== false ? 'Active' : 'Paused') + '</td>' +
                    '<td class="small text-muted">' + (r.last_sent_at ? String(r.last_sent_at).slice(0, 16).replace('T', ' ') : '—') + '</td></tr>';
            }).join('');
        },

        rowHtml: (r) => {
            const scope = _scheduledReportsGrid;
            var id = r && r.id ? r.id : '';
            var email = scope.escapeHtml(r && r.email ? r.email : '');
            var phone = scope.escapeHtml(r && r.phone ? r.phone : '');
            var channel = (r && r.channel) ? String(r.channel).toLowerCase() : 'email';
            var active = r && r.is_active !== false;
            var lastSent = r && r.last_sent_at ? String(r.last_sent_at).slice(0, 16).replace('T', ' ') : '—';
            return '<tr data-report-id="' + id + '">' +
                '<td><input type="email" class="form-control form-control-sm sr-email" value="' + email + '" placeholder="email@example.com"></td>' +
                '<td><input type="text" class="form-control form-control-sm sr-phone" value="' + phone + '" placeholder="+27…"></td>' +
                '<td><select class="form-select form-select-sm sr-type"><option value="daily_digest" selected>Daily digest</option></select></td>' +
                '<td><select class="form-select form-select-sm sr-channel">' +
                '<option value="email"' + (channel === 'email' ? ' selected' : '') + '>Email</option>' +
                '<option value="whatsapp"' + (channel === 'whatsapp' ? ' selected' : '') + '>WhatsApp</option></select></td>' +
                '<td><input type="checkbox" class="form-check-input sr-active"' + (active ? ' checked' : '') + '></td>' +
                '<td class="small text-muted">' + lastSent + '</td>' +
                '<td class="mac-table-actions-col text-end">' + MacTableActions.render({
                    id: 'srActions' + id,
                    items: [{ label: 'Save', className: 'js-save-scheduled-report', icon: 'fas fa-save' }]
                }) + '</td>' +
                '</tr>';
        },

        addRow: () => {
            const scope = _scheduledReportsGrid;
            var tbody = document.getElementById('scheduledReportsTableBody');
            if (!tbody) return;
            if (scope.rows.length === 0) tbody.innerHTML = '';
            $(tbody).append(scope.rowHtml({ id: '', email: '', is_active: true }));
        },

        saveRow: async ($tr) => {
            const scope = _scheduledReportsGrid;
            var id = $tr.data('report-id');
            var email = ($tr.find('.sr-email').val() || '').trim();
            var phone = ($tr.find('.sr-phone').val() || '').trim();
            var channel = ($tr.find('.sr-channel').val() || 'email').toLowerCase();
            if (channel === 'email' && !email) {
                scope.toast('Email is required for email channel.', 'error');
                return;
            }
            if (channel === 'whatsapp' && !phone) {
                scope.toast('Phone number is required for WhatsApp channel.', 'error');
                return;
            }
            try {
                await dataFunctions.upsertScheduledReport({
                    id: id || null,
                    user_id: null,
                    email: email || phone,
                    phone: phone || null,
                    report_type: 'daily_digest',
                    channel: channel,
                    is_active: $tr.find('.sr-active').prop('checked')
                });
                scope.toast('Subscription saved.', 'success');
                await scope.load();
            } catch (e) {
                scope.toast('Error: ' + (e.message || ''), 'error');
            }
        },

        previewDigest: async (updateWhatsAppSample) => {
            const scope = _scheduledReportsGrid;
            var pre = document.getElementById('dailyDigestPreview');
            if (pre && !updateWhatsAppSample) pre.textContent = 'Loading...';
            try {
                var digest = await dataFunctions.getDailyDigest();
                if (pre && !updateWhatsAppSample) pre.textContent = JSON.stringify(digest, null, 2);
                scope.renderWhatsAppSample(digest);
            } catch (e) {
                if (pre && !updateWhatsAppSample) pre.textContent = 'Error: ' + (e.message || '');
            }
        },

        renderWhatsAppSample: (digest) => {
            const scope = _scheduledReportsGrid;
            var el = document.getElementById('srWhatsAppPreviewBody');
            if (!el) return;
            digest = digest || {};
            var ks = digest.kernel_stats || {};
            var alerts = digest.open_alerts || [];
            var proc = digest.procurement_today || {};
            var lines = [
                'Macavation daily digest · ' + (digest.date || 'today'),
                '',
                'Kernel: ' + (ks.kg_cracked_today != null ? ks.kg_cracked_today + ' kg cracked today' : '—'),
                'Packed this week: ' + (ks.kg_packed_week != null ? ks.kg_packed_week + ' kg' : '—'),
                'Oil: ' + ((digest.oil_stats || {}).litres_today ?? '—') + ' L today',
                'Runway: ' + ((digest.runway || {}).weeks_cover ?? '—') + ' wks',
                'Open alerts: ' + (alerts.length || 0),
                'Procurement today: ' + (proc.deliveries_today || 0) + ' deliveries, ' + Math.round(Number(proc.predicted_kg_today) || 0) + ' kg',
                '',
                'Full detail in the portal dashboard.'
            ];
            el.innerHTML = lines.map(function (ln) {
                return ln === '' ? '<br>' : scope.escapeHtml(ln) + '<br>';
            }).join('');
        },

        toast: (msg, type) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(msg, type || 'info');
            } else if (typeof Swal !== 'undefined') {
                Swal.fire(type === 'error' ? 'Error' : 'Done', msg, type === 'error' ? 'error' : 'success');
            }
        },

        escapeHtml: (text) => {
            if (text == null) return '';
            return _common.escapeHtml(text);
        }
    };
}();

window._scheduledReportsGrid = _scheduledReportsGrid;

$(document).ready(function () {
    var start = Date.now();
    (function tryInit() {
        if (typeof dataFunctions !== 'undefined') { _scheduledReportsGrid.init(); return; }
        if (Date.now() - start < 5000) setTimeout(tryInit, 50);
    })();
});
