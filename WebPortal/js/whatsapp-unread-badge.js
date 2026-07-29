/**
 * WhatsApp unread badge — 60s poll (mirrors notifications.js pattern)
 * Independent of the notification bell.
 */

(function () {
    'use strict';

    var POLL_MS = 60000; // 60 seconds
    var pollInterval = null;

    function getCurrentUserId() {
        try {
            var userStr = Session.get('user');
            if (userStr) {
                var user = JSON.parse(userStr);
                return user.id;
            }
        } catch (e) {
            /* ignore */
        }
        return null;
    }

    function updateBadge() {
        var userId = getCurrentUserId();
        if (!userId) return;

        if (typeof dataFunctions === 'undefined' || !dataFunctions.chatGetUnreadCount) {
            return;
        }

        dataFunctions.chatGetUnreadCount(userId).then(function (count) {
            var badge = document.querySelector('[data-route="crm-whatsapp-grid"] .badge');
            if (!badge) {
                // Badge doesn't exist yet - create it
                var menuItem = document.querySelector('[data-route="crm-whatsapp-grid"]');
                if (menuItem) {
                    var badgeEl = document.createElement('span');
                    badgeEl.className = 'badge bg-primary ms-2';
                    badgeEl.style.display = 'none';
                    menuItem.appendChild(badgeEl);
                    badge = badgeEl;
                }
            }

            if (badge) {
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : count;
                    badge.style.display = '';
                } else {
                    badge.style.display = 'none';
                }
            }
        }).catch(function (error) {
            console.error('Error fetching WhatsApp unread count:', error);
        });
    }

    function init() {
        // Wait for dataFunctions to be ready
        var attempts = 0;
        var maxAttempts = 50;
        var waitInterval = setInterval(function () {
            attempts++;
            if (typeof dataFunctions !== 'undefined' && dataFunctions.chatGetUnreadCount) {
                clearInterval(waitInterval);

                // Initial update
                updateBadge();

                // Start polling
                if (pollInterval) clearInterval(pollInterval);
                pollInterval = setInterval(updateBadge, POLL_MS);
            } else if (attempts >= maxAttempts) {
                clearInterval(waitInterval);
                console.warn('WhatsApp unread badge: dataFunctions not available');
            }
        }, 100);
    }

    // Auto-initialize on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
