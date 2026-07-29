/**
 * CRM WhatsApp Grid Module — shell initialization and action-access sweep.
 * Pattern: IIFE, single global _crmWhatsappGrid, self-init poll-for-dataFunctions loop.
 */
var _crmWhatsappGrid = function () {
    'use strict';

    return {
        initialized: false,

        init: async () => {
            const scope = _crmWhatsappGrid;
            if (scope.initialized) return;

            console.log('[CRM WhatsApp] Initializing CRM WhatsApp Grid module...');

            // Poll for dataFunctions availability (matching messaging-compose pattern)
            if (typeof dataFunctions === 'undefined' || !dataFunctions.chatListConversations) {
                console.log('[CRM WhatsApp] Waiting for dataFunctions...');
                setTimeout(scope.init, 100);
                return;
            }

            // Apply action-access sweep once (static markup only)
            if (typeof actionAccess !== 'undefined' && actionAccess.apply) {
                actionAccess.apply(document);
            }

            // Initialize tabs
            if (typeof _crmWhatsappContactsTab !== 'undefined' && _crmWhatsappContactsTab.init) {
                await _crmWhatsappContactsTab.init();
            }

            if (typeof _crmWhatsappInternalTab !== 'undefined' && _crmWhatsappInternalTab.init) {
                await _crmWhatsappInternalTab.init();
            }

            // Check for handoff context (shortcut from Contacts page)
            scope.applyHandoffContext();

            scope.initialized = true;
            console.log('[CRM WhatsApp] CRM WhatsApp Grid module initialized');
        },

        applyHandoffContext: () => {
            try {
                const raw = sessionStorage.getItem('macavation_pending_route_context');
                if (!raw) return;

                const ctx = JSON.parse(raw);
                if (ctx.route !== 'crm-whatsapp-grid') return;

                // Consume (remove) the context
                sessionStorage.removeItem('macavation_pending_route_context');

                // If openConversationId is set, open that conversation
                if (ctx.openConversationId) {
                    console.log('[CRM WhatsApp] Handoff context: opening conversation', ctx.openConversationId);
                    // Switch to contacts tab and open the conversation
                    const contactsTabButton = document.getElementById('contacts-tab');
                    if (contactsTabButton) {
                        const tab = new bootstrap.Tab(contactsTabButton);
                        tab.show();
                    }

                    // Wait a moment for tab to be active, then open conversation
                    setTimeout(() => {
                        if (typeof _crmWhatsappContactsTab !== 'undefined' && _crmWhatsappContactsTab.openConversation) {
                            _crmWhatsappContactsTab.openConversation(ctx.openConversationId);
                        }
                    }, 100);
                }
            } catch (e) {
                console.warn('[CRM WhatsApp] Failed to apply handoff context:', e);
            }
        }
    };
}();

// Self-init
_crmWhatsappGrid.init();
