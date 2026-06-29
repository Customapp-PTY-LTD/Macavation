/**
 * In-app messaging compose — broadcast, role, or user-targeted notifications.
 */
var _messagingComposeGrid = function () {
    'use strict';

    return {
        roles: [],
        users: [],

        init: async () => {
            const scope = _messagingComposeGrid;
            await new Promise(function (resolve) { $(document).ready(resolve); });
            if (typeof applyActionPermissions === 'function') applyActionPermissions(document);
            scope.bindEvents();
            await scope.loadLookups();
        },

        bindEvents: () => {
            const scope = _messagingComposeGrid;
            $('#msgTargetType').off('change').on('change', function () { scope.toggleTargetFields(); });
            $('#msgSendBtn').off('click').on('click', function () { scope.send(); });
            $('#msgRefreshSentBtn').off('click').on('click', function () { scope.loadRecent(); });
            scope.toggleTargetFields();
        },

        toggleTargetFields: () => {
            var t = $('#msgTargetType').val();
            $('#msgRoleWrap').toggleClass('d-none', t !== 'role');
            $('#msgUserWrap').toggleClass('d-none', t !== 'user');
        },

        loadLookups: async () => {
            const scope = _messagingComposeGrid;
            try {
                if (dataFunctions.getRoles) {
                    scope.roles = await dataFunctions.getRoles() || [];
                    var roleOpts = ['<option value="">Select role</option>'];
                    scope.roles.forEach(function (r) {
                        roleOpts.push('<option value="' + (r.id || '') + '">' + scope.escapeHtml(r.role_name || r.name || '') + '</option>');
                    });
                    $('#msgRoleSelect').html(roleOpts.join(''));
                }
                if (dataFunctions.getUsers) {
                    scope.users = await dataFunctions.getUsers() || [];
                    var userOpts = ['<option value="">Select user</option>'];
                    scope.users.forEach(function (u) {
                        var label = (u.full_name || u.email || u.username || u.id || '').toString();
                        userOpts.push('<option value="' + (u.id || '') + '">' + scope.escapeHtml(label) + '</option>');
                    });
                    $('#msgUserSelect').html(userOpts.join(''));
                }
            } catch (e) {
                console.warn('[Messaging] lookup load failed:', e);
            }
            await scope.loadRecent();
        },

        send: async () => {
            const scope = _messagingComposeGrid;
            if (typeof hasAction === 'function' && !hasAction('messaging.broadcast')) {
                Swal.fire('Not permitted', 'You do not have permission to send broadcast messages.', 'warning');
                return;
            }
            var title = ($('#msgTitle').val() || '').trim();
            var body = ($('#msgBody').val() || '').trim();
            if (!title || !body) {
                Swal.fire('Required', 'Title and message are required.', 'warning');
                return;
            }
            var payload = {
                title: title,
                body: body,
                severity: $('#msgSeverity').val() || 'info',
                link_route: ($('#msgLinkRoute').val() || '').trim() || null
            };
            var target = $('#msgTargetType').val();
            try {
                if (target === 'role') {
                    var roleId = $('#msgRoleSelect').val();
                    if (!roleId) { Swal.fire('Required', 'Select a role.', 'warning'); return; }
                    var role = scope.roles.find(function (r) { return String(r.id) === String(roleId); });
                    var roleName = role && (role.role_name || role.name);
                    if (!roleName) { Swal.fire('Error', 'Role name not found.', 'error'); return; }
                    await dataFunctions.notifyRole(Object.assign({ role_name: roleName }, payload));
                } else if (target === 'user') {
                    var userId = $('#msgUserSelect').val();
                    if (!userId) { Swal.fire('Required', 'Select a user.', 'warning'); return; }
                    await dataFunctions.createNotification(Object.assign({ target_user_id: userId }, payload));
                } else {
                    await dataFunctions.createNotification(payload);
                }
                Swal.fire('Sent', 'Message delivered to the inbox.', 'success');
                $('#msgTitle, #msgBody, #msgLinkRoute').val('');
                await scope.loadRecent();
            } catch (e) {
                Swal.fire('Error', e.message || 'Send failed', 'error');
            }
        },

        loadRecent: async () => {
            var list = document.getElementById('msgRecentList');
            if (!list || !dataFunctions.getMyNotifications) return;
            var user = (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
            if (!user || !user.id) {
                list.innerHTML = '<li class="list-group-item text-muted small">Sign in to see your inbox.</li>';
                return;
            }
            try {
                var rows = await dataFunctions.getMyNotifications(user.id, user.role_id, 10);
                if (!rows || !rows.length) {
                    list.innerHTML = '<li class="list-group-item text-muted small">No recent messages in your inbox.</li>';
                    return;
                }
                list.innerHTML = rows.map(function (n) {
                    var t = (n.title || n.notification_title || 'Message');
                    var when = n.created_at ? String(n.created_at).slice(0, 16).replace('T', ' ') : '';
                    return '<li class="list-group-item"><div class="fw-semibold small">' + t + '</div><div class="text-muted small">' + when + '</div></li>';
                }).join('');
            } catch (e) {
                list.innerHTML = '<li class="list-group-item text-danger small">' + (e.message || 'Load failed') + '</li>';
            }
        },

        escapeHtml: (text) => {
            if (text == null) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };
}();

window._messagingComposeGrid = _messagingComposeGrid;

$(document).ready(function () {
    var start = Date.now();
    (function tryInit() {
        if (typeof dataFunctions !== 'undefined') { _messagingComposeGrid.init(); return; }
        if (Date.now() - start < 5000) setTimeout(tryInit, 50);
    })();
});
