/**
 * CRM WhatsApp & Messaging Module
 * Consolidated: WhatsApp conversations with contacts + internal staff-to-staff chat
 */

var _crmWhatsappGrid = (function () {
    'use strict';

    var pollInterval = null;
    var dataFunctionsWaitInterval = null;
    var currentUserId = null;

    function getCurrentUserId() {
        if (currentUserId) return currentUserId;
        try {
            var userStr = Session.get('user');
            if (userStr) {
                var user = JSON.parse(userStr);
                currentUserId = user.id;
                return currentUserId;
            }
        } catch (e) {
            console.error('Failed to get current user ID:', e);
        }
        return null;
    }

    function waitForDataFunctions(callback) {
        if (typeof dataFunctions !== 'undefined' && dataFunctions) {
            callback();
            return;
        }

        var attempts = 0;
        var maxAttempts = 50;
        var interval = setInterval(function () {
            attempts++;
            if (typeof dataFunctions !== 'undefined' && dataFunctions) {
                clearInterval(interval);
                callback();
            } else if (attempts >= maxAttempts) {
                clearInterval(interval);
                console.error('dataFunctions not available after waiting');
            }
        }, 100);
    }

    function init() {
        console.log('Initializing CRM WhatsApp Grid module');

        // Clear any existing intervals from previous navigation
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
        if (dataFunctionsWaitInterval) {
            clearInterval(dataFunctionsWaitInterval);
            dataFunctionsWaitInterval = null;
        }

        // Wait for dataFunctions to be ready, then initialize tabs
        waitForDataFunctions(function () {
            // Initialize both tabs
            if (typeof _crmWhatsappContactsTab !== 'undefined' && _crmWhatsappContactsTab.init) {
                _crmWhatsappContactsTab.init();
            }
            if (typeof _crmWhatsappInternalTab !== 'undefined' && _crmWhatsappInternalTab.init) {
                _crmWhatsappInternalTab.init();
            }

            // Apply action-based access control
            if (typeof actionAccess !== 'undefined' && actionAccess.apply) {
                actionAccess.apply(document);
            }

            // Handle pending handoff context from Contacts page shortcut
            consumePendingHandoff();
        });
    }

    function consumePendingHandoff() {
        try {
            var raw = sessionStorage.getItem('macavation_pending_route_context');
            if (!raw) return;

            var ctx = JSON.parse(raw);
            if (!ctx || ctx.route !== 'crm-whatsapp-grid') {
                // Not for us - restore for the correct module
                return;
            }

            // Remove from storage
            sessionStorage.removeItem('macavation_pending_route_context');

            // Open the conversation on the Contacts tab
            if (ctx.openConversationId && typeof _crmWhatsappContactsTab !== 'undefined') {
                // Switch to Contacts tab
                var contactsTabBtn = document.getElementById('contacts-tab');
                if (contactsTabBtn) {
                    var bsTab = new bootstrap.Tab(contactsTabBtn);
                    bsTab.show();
                }

                // Let the tab load, then open the conversation
                setTimeout(function () {
                    if (_crmWhatsappContactsTab.openConversation) {
                        _crmWhatsappContactsTab.openConversation(ctx.openConversationId);
                    }
                }, 500);
            }
        } catch (e) {
            console.error('Failed to consume pending handoff:', e);
        }
    }

    return {
        init: init,
        getCurrentUserId: getCurrentUserId
    };
})();
