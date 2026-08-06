/**
 * CRM WhatsApp Grid Module — shell initialization and action-access sweep.
 * Pattern: IIFE, single global _crmWhatsappGrid, self-init poll-for-dataFunctions loop.
 */
var _crmWhatsappGrid = function () {
    'use strict';

    const WAIT_TIMEOUT_MS = 10000;

    return {
        initialized: false,
        initializing: false,
        waitStartedAt: null,

        init: async () => {
            const scope = _crmWhatsappGrid;

            // Two callers race to initialise: this file's own bottom-of-file call and the
            // router's initializeModule. Both are wanted (whichever wins, the module comes
            // up), but only one should run the tab init.
            if (scope.initializing) return;

            // The router re-injects this module's markup on every visit but does not
            // re-execute its script, so `initialized` alone would block every visit after
            // the first and leave the freshly-injected placeholder on screen. Stamp the
            // container instead: an unstamped container means new markup needing wiring.
            const container = document.getElementById('contactsConversationList');
            if (scope.initialized && container && container.dataset.waInit === '1') return;

            // Wait for dataFunctions AND both tab modules before doing anything.
            //
            // This file is the FIRST entry in appRouteConfig's js list, so the
            // `_crmWhatsappGrid.init()` call at the bottom of it runs before
            // crm_whatsapp_contacts_tab.js has even been appended to the page — the tab
            // globals genuinely do not exist yet. The previous code merely skipped the
            // tabs when they were missing and then set initialized = true, so the tabs
            // were never wired: no setupEventListeners (so "New chat" did nothing) and no
            // loadConversations (so the list stayed on its empty placeholder). Waiting for
            // them, rather than skipping them, is the fix.
            const ready =
                typeof dataFunctions !== 'undefined' && dataFunctions.chatListConversations &&
                typeof _crmWhatsappContactsTab !== 'undefined' && _crmWhatsappContactsTab.init &&
                typeof _crmWhatsappInternalTab !== 'undefined' && _crmWhatsappInternalTab.init &&
                container;

            if (!ready) {
                if (scope.waitStartedAt === null) scope.waitStartedAt = Date.now();
                if (Date.now() - scope.waitStartedAt > WAIT_TIMEOUT_MS) {
                    console.error('[CRM WhatsApp] Gave up waiting for dependencies:', {
                        dataFunctions: typeof dataFunctions !== 'undefined' && !!dataFunctions.chatListConversations,
                        contactsTab: typeof _crmWhatsappContactsTab !== 'undefined',
                        internalTab: typeof _crmWhatsappInternalTab !== 'undefined',
                        container: !!container
                    });
                    scope.waitStartedAt = null;
                    return;
                }
                setTimeout(scope.init, 100);
                return;
            }

            scope.waitStartedAt = null;
            scope.initializing = true;
            console.log('[CRM WhatsApp] Initializing CRM WhatsApp Grid module...');

            try {
                // Apply action-access sweep once (static markup only)
                if (typeof actionAccess !== 'undefined' && actionAccess.apply) {
                    actionAccess.apply(document);
                }

                // Initialize tabs
                await _crmWhatsappContactsTab.init();
                await _crmWhatsappInternalTab.init();

                // Check for handoff context (shortcut from Contacts page)
                scope.applyHandoffContext();

                // Stamp only now that the tabs are actually wired up. Stamping before this
                // point would make the router's own initializeModule call a no-op.
                container.dataset.waInit = '1';

                scope.initialized = true;
                console.log('[CRM WhatsApp] CRM WhatsApp Grid module initialized');
            } catch (e) {
                // Leave the container unstamped so the next visit retries rather than
                // silently presenting a dead screen.
                console.error('[CRM WhatsApp] Initialization failed:', e);
            } finally {
                scope.initializing = false;
            }
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
