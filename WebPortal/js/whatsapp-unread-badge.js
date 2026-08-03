/**
 * WhatsApp Unread Badge — 60s-poll unread badge for the WhatsApp sidebar link.
 * Mirrors notifications.js pattern (POLL_MS=60000, no websockets).
 */
var WhatsappUnreadBadge = (function () {
    'use strict';

    const POLL_MS = 60000; // 60 seconds
    let pollInterval = null;
    let currentUserId = null;

    function getCurrentUserId() {
        try {
            const user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
            return user && user.id ? user.id : null;
        } catch (e) {
            return null;
        }
    }

    async function updateBadge() {
        if (!currentUserId) {
            currentUserId = getCurrentUserId();
            if (!currentUserId) return;
        }

        try {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.chatGetUnreadCount) {
                return;
            }

            // chat_get_unread_count only counts messages with a sender_user_id, so it
            // misses every inbound WhatsApp message (those have sender_user_id NULL).
            // Add the shared-inbox count on top. null means the RPC is absent (migration
            // 20260813090000 not applied) — then the internal count alone is all there is.
            let count = await dataFunctions.chatGetUnreadCount(currentUserId);

            if (dataFunctions.chatGetWhatsappUnreadCount) {
                const waCount = await dataFunctions.chatGetWhatsappUnreadCount(currentUserId);
                if (typeof waCount === 'number') {
                    count = (count || 0) + waCount;
                }
            }

            const badgeEl = document.getElementById('whatsappUnreadBadge');
            if (!badgeEl) return;

            if (count > 0) {
                badgeEl.textContent = count > 99 ? '99+' : count;
                badgeEl.style.display = 'inline-block';
            } else {
                badgeEl.style.display = 'none';
            }
        } catch (e) {
            console.warn('[WhatsApp Badge] Failed to update unread count:', e);
        }
    }

    function startPolling() {
        if (pollInterval) return; // Already polling

        currentUserId = getCurrentUserId();
        if (!currentUserId) return;

        // Initial update
        updateBadge();

        // Poll every 60 seconds
        pollInterval = setInterval(updateBadge, POLL_MS);
    }

    function stopPolling() {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }

    // Auto-start on page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startPolling);
    } else {
        startPolling();
    }

    return {
        updateBadge,
        startPolling,
        stopPolling
    };
})();
