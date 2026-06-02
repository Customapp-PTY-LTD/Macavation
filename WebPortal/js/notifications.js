/**
 * Notifications inbox — header bell badge + dropdown list.
 * Polls the unread count and renders the latest notifications for the current
 * user (direct + role-targeted + broadcast). Backed by Sprint 4A RPCs.
 */
var notificationsInbox = (function () {
    'use strict';

    var POLL_MS = 60000;
    var pollTimer = null;

    function currentUser() {
        return (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
    }

    function ids() {
        var u = currentUser() || {};
        return { userId: u.id || u.user_id || null, roleId: u.role_id || null };
    }

    function severityClass(sev) {
        if (sev === 'critical') return 'danger';
        if (sev === 'warning') return 'warning';
        return 'info';
    }

    function escapeHtml(text) {
        if (text == null) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function timeAgo(iso) {
        try {
            var d = new Date(iso);
            var mins = Math.floor((Date.now() - d.getTime()) / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            var hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            return Math.floor(hrs / 24) + 'd ago';
        } catch (e) { return ''; }
    }

    return {
        init: function () {
            var self = this;
            if (typeof dataFunctions === 'undefined') return;
            var toggle = document.getElementById('notificationsDropdownToggle');
            if (toggle) {
                toggle.addEventListener('click', function () { self.loadList(); });
            }
            var markAll = document.getElementById('notificationsMarkAllBtn');
            if (markAll) {
                markAll.addEventListener('click', async function (e) {
                    e.preventDefault();
                    var u = ids();
                    if (!u.userId) return;
                    await dataFunctions.markAllNotificationsRead(u.userId, u.roleId);
                    self.refreshBadge();
                    self.loadList();
                });
            }
            this.refreshBadge();
            if (pollTimer) clearInterval(pollTimer);
            pollTimer = setInterval(function () { self.refreshBadge(); }, POLL_MS);
        },

        refreshBadge: async function () {
            var u = ids();
            if (!u.userId) return;
            try {
                var count = await dataFunctions.getUnreadNotificationCount(u.userId, u.roleId);
                var badge = document.getElementById('notificationsBadge');
                if (!badge) return;
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : String(count);
                    badge.classList.remove('d-none');
                } else {
                    badge.classList.add('d-none');
                }
            } catch (e) { /* silent */ }
        },

        loadList: async function () {
            var u = ids();
            var body = document.getElementById('notificationsDropdownBody');
            if (!body || !u.userId) return;
            body.innerHTML = '<div class="text-center text-muted py-3 small">Loading…</div>';
            try {
                var list = await dataFunctions.getMyNotifications(u.userId, u.roleId, 30);
                if (!list.length) {
                    body.innerHTML = '<div class="text-center text-muted py-3 small">No notifications.</div>';
                    return;
                }
                var self = this;
                body.innerHTML = list.map(function (n) {
                    var sev = severityClass(n.severity);
                    var unread = !n.is_read;
                    return '<a href="#" class="d-block text-decoration-none p-2 rounded mb-1 notif-item ' +
                        (unread ? 'bg-light' : '') + '" data-notif-id="' + n.id + '"' +
                        (n.link_route ? ' data-route="' + escapeHtml(n.link_route) + '"' : '') + '>' +
                        '<div class="d-flex align-items-start">' +
                        '<span class="badge bg-' + sev + ' me-2 mt-1">&nbsp;</span>' +
                        '<div class="flex-grow-1">' +
                        '<div class="fw-' + (unread ? 'semibold' : 'normal') + ' text-dark small">' + escapeHtml(n.title) + '</div>' +
                        (n.body ? '<div class="text-muted small">' + escapeHtml(n.body) + '</div>' : '') +
                        '<div class="text-muted" style="font-size:0.7rem;">' + timeAgo(n.created_at) + '</div>' +
                        '</div></div></a>';
                }).join('');

                body.querySelectorAll('.notif-item').forEach(function (el) {
                    el.addEventListener('click', async function (ev) {
                        ev.preventDefault();
                        var id = el.getAttribute('data-notif-id');
                        var route = el.getAttribute('data-route');
                        if (id) {
                            await dataFunctions.markNotificationRead(id, u.userId);
                            self.refreshBadge();
                        }
                        if (route && typeof _appRouter !== 'undefined' && _appRouter.navigate) {
                            _appRouter.navigate(route);
                        }
                    });
                });
            } catch (e) {
                body.innerHTML = '<div class="text-center text-danger py-3 small">Unable to load notifications.</div>';
            }
        }
    };
}());

window.notificationsInbox = notificationsInbox;

document.addEventListener('DOMContentLoaded', function () {
    var start = Date.now();
    (function tryInit() {
        var u = (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
        if (typeof dataFunctions !== 'undefined' && u) { notificationsInbox.init(); return; }
        if (Date.now() - start < 15000) setTimeout(tryInit, 500);
    })();
});
