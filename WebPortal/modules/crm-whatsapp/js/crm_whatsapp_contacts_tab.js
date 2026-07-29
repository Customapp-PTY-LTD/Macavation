/**
 * CRM WhatsApp Contacts Tab — WhatsApp contact conversations with send status and polling.
 */
var _crmWhatsappContactsTab = function () {
    'use strict';

    let currentUserId = null;
    let currentConversationId = null;
    let conversations = [];
    let contacts = [];
    let pollInterval = null;
    const POLL_MS = 5000; // Poll every 5 seconds when a conversation is open

    const escapeHtml = (text) => {
        if (text == null || text === '') return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };

    const formatTime = (timestamp) => {
        if (!timestamp) return '';
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;

        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;

        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString();
    };

    return {
        init: async () => {
            console.log('[WhatsApp Contacts] Initializing contacts tab...');

            // Get current user
            try {
                const token = typeof Session !== 'undefined' && Session.get ? Session.get('token') : null;
                if (!token) {
                    console.error('[WhatsApp Contacts] No session token');
                    return;
                }

                const user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
                if (user && user.id) {
                    currentUserId = user.id;
                } else {
                    console.error('[WhatsApp Contacts] No current user');
                    return;
                }
            } catch (e) {
                console.error('[WhatsApp Contacts] Failed to get current user:', e);
                return;
            }

            // Load contacts for picker
            await _crmWhatsappContactsTab.loadContactsForPicker();

            // Setup event listeners
            _crmWhatsappContactsTab.setupEventListeners();

            // Load conversations
            await _crmWhatsappContactsTab.loadConversations();

            console.log('[WhatsApp Contacts] Contacts tab initialized');
        },

        setupEventListeners: () => {
            // New chat button
            $('#newContactChatBtn').off('click').on('click', () => {
                $('#newContactChatModal').modal('show');
            });

            // Contact select change
            $('#contactSelect').off('change').on('change', function () {
                const contactId = $(this).val();
                const startBtn = $('#startContactChatBtn');

                if (!contactId) {
                    startBtn.prop('disabled', true);
                    $('#contactPhoneHint').html('');
                    return;
                }

                const contact = contacts.find(c => c.id === contactId);
                if (!contact) {
                    startBtn.prop('disabled', true);
                    $('#contactPhoneHint').html('');
                    return;
                }

                const phone = contact.primary_contact_mobile || contact.primary_contact_phone;
                if (!phone) {
                    startBtn.prop('disabled', true);
                    $('#contactPhoneHint').html('<span class="text-danger"><i class="fas fa-exclamation-triangle me-1"></i>No WhatsApp number on file for this contact</span>');
                } else {
                    startBtn.prop('disabled', false);
                    $('#contactPhoneHint').html(`<span class="text-muted"><i class="fas fa-phone me-1"></i>${escapeHtml(phone)}</span>`);
                }
            });

            // Start contact chat button
            $('#startContactChatBtn').off('click').on('click', async () => {
                const contactId = $('#contactSelect').val();
                if (!contactId) return;

                await _crmWhatsappContactsTab.startContactConversation(contactId);
            });

            // Search input
            $('#contactsSearchInput').off('input').on('input', function () {
                const search = $(this).val().toLowerCase();
                _crmWhatsappContactsTab.filterConversations(search);
            });
        },

        loadContactsForPicker: async () => {
            try {
                contacts = await dataFunctions.getContactsForMessaging();

                const select = $('#contactSelect');
                select.empty();
                select.append('<option value="">Select a contact...</option>');

                contacts.forEach(contact => {
                    const name = contact.company_name || contact.primary_contact_name || 'Unnamed Contact';
                    select.append(`<option value="${escapeHtml(contact.id)}">${escapeHtml(name)}</option>`);
                });
            } catch (e) {
                console.error('[WhatsApp Contacts] Failed to load contacts:', e);
                $('#contactSelect').html('<option value="">Error loading contacts</option>');
            }
        },

        startContactConversation: async (contactId) => {
            try {
                const result = await dataFunctions.chatStartContactConversation(contactId, currentUserId);

                if (!result || !result.conversation_id) {
                    throw new Error(result?.error || 'Failed to start conversation');
                }

                $('#newContactChatModal').modal('hide');

                // Reload conversations and open the new/existing one
                await _crmWhatsappContactsTab.loadConversations();
                _crmWhatsappContactsTab.openConversation(result.conversation_id);
            } catch (e) {
                console.error('[WhatsApp Contacts] Failed to start conversation:', e);
                if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Failed to start conversation: ' + e.message, 'error');
                }
            }
        },

        loadConversations: async () => {
            try {
                const result = await dataFunctions.chatListConversations(currentUserId, 'whatsapp_contact');

                if (!result || typeof result.success === 'undefined') {
                    conversations = result || [];
                } else if (result.success === 0) {
                    throw new Error(result.error || 'Failed to load conversations');
                } else {
                    // Result is wrapped in success/error format
                    conversations = [];
                }

                _crmWhatsappContactsTab.renderConversationList();
            } catch (e) {
                console.error('[WhatsApp Contacts] Failed to load conversations:', e);
                $('#contactsConversationList').html(`
                    <div class="text-center text-danger py-5">
                        <i class="fas fa-exclamation-triangle fa-3x mb-3 opacity-25"></i>
                        <p>Failed to load conversations</p>
                    </div>
                `);
            }
        },

        renderConversationList: () => {
            const listEl = $('#contactsConversationList');

            if (!conversations || conversations.length === 0) {
                listEl.html(`
                    <div class="text-center text-muted py-5">
                        <i class="fas fa-comments fa-3x mb-3 opacity-25"></i>
                        <p>No conversations yet. Click "New chat" to start.</p>
                    </div>
                `);
                return;
            }

            let html = '';
            conversations.forEach(conv => {
                const unreadBadge = conv.unread_count > 0 ? `<span class="badge rounded-pill bg-danger">${conv.unread_count}</span>` : '';
                const preview = conv.last_message_body ? escapeHtml(conv.last_message_body).substring(0, 60) + (conv.last_message_body.length > 60 ? '...' : '') : 'No messages yet';
                const activeClass = conv.conversation_id === currentConversationId ? 'active' : '';

                html += `
                    <div class="chat-list-item ${activeClass}" data-conversation-id="${escapeHtml(conv.conversation_id)}">
                        <div class="d-flex align-items-start">
                            <div class="chat-avatar">
                                <i class="fas fa-user-circle fa-2x text-muted"></i>
                            </div>
                            <div class="flex-grow-1 ms-2">
                                <div class="d-flex justify-content-between align-items-start">
                                    <strong class="chat-name">${escapeHtml(conv.other_party_name || 'Contact')}</strong>
                                    <small class="text-muted">${formatTime(conv.last_message_at)}</small>
                                </div>
                                <div class="d-flex justify-content-between align-items-center">
                                    <small class="text-muted chat-preview">${preview}</small>
                                    ${unreadBadge}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            });

            listEl.html(html);

            // Attach click handlers
            $('.chat-list-item').off('click').on('click', function () {
                const convId = $(this).data('conversation-id');
                _crmWhatsappContactsTab.openConversation(convId);
            });
        },

        filterConversations: (search) => {
            if (!search) {
                $('.chat-list-item').show();
                return;
            }

            $('.chat-list-item').each(function () {
                const name = $(this).find('.chat-name').text().toLowerCase();
                const preview = $(this).find('.chat-preview').text().toLowerCase();

                if (name.includes(search) || preview.includes(search)) {
                    $(this).show();
                } else {
                    $(this).hide();
                }
            });
        },

        openConversation: async (conversationId) => {
            currentConversationId = conversationId;

            // Update active state in list
            $('.chat-list-item').removeClass('active');
            $(`.chat-list-item[data-conversation-id="${conversationId}"]`).addClass('active');

            // Load messages
            await _crmWhatsappContactsTab.loadMessages(conversationId);

            // Mark conversation as read
            try {
                await dataFunctions.chatMarkConversationRead(conversationId, currentUserId);
                // Reload conversations to update unread count
                await _crmWhatsappContactsTab.loadConversations();
            } catch (e) {
                console.warn('[WhatsApp Contacts] Failed to mark conversation read:', e);
            }

            // Start polling for new messages
            _crmWhatsappContactsTab.startPolling();

            // Update unread badge in sidebar
            if (typeof WhatsappUnreadBadge !== 'undefined' && WhatsappUnreadBadge.updateBadge) {
                WhatsappUnreadBadge.updateBadge();
            }
        },

        loadMessages: async (conversationId) => {
            try {
                const messages = await dataFunctions.chatListMessages(conversationId, currentUserId);

                if (!messages) {
                    throw new Error('Failed to load messages');
                }

                _crmWhatsappContactsTab.renderThread(conversationId, messages);
            } catch (e) {
                console.error('[WhatsApp Contacts] Failed to load messages:', e);
                $('#contactsThreadPane').html(`
                    <div class="text-center text-danger py-5">
                        <i class="fas fa-exclamation-triangle fa-3x mb-3 opacity-25"></i>
                        <p>Failed to load messages</p>
                    </div>
                `);
            }
        },

        renderThread: (conversationId, messages) => {
            const conv = conversations.find(c => c.conversation_id === conversationId);
            if (!conv) return;

            const pane = $('#contactsThreadPane');

            let html = `
                <div class="chat-thread-header">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-user-circle fa-2x text-muted me-2"></i>
                        <strong>${escapeHtml(conv.other_party_name || 'Contact')}</strong>
                    </div>
                </div>
                <div class="chat-thread-messages" id="contactsThreadMessages">
            `;

            if (!messages || messages.length === 0) {
                html += `<div class="text-center text-muted py-4"><p>No messages yet. Start the conversation below.</p></div>`;
            } else {
                messages.forEach(msg => {
                    const isOutbound = msg.direction === 'outbound_whatsapp';
                    const bubbleClass = isOutbound ? 'chat-bubble-outbound' : 'chat-bubble-inbound';

                    let statusIcon = '';
                    if (isOutbound) {
                        if (msg.send_status === 'queued') {
                            statusIcon = '<i class="fas fa-clock text-muted ms-2" title="Queued"></i>';
                        } else if (msg.send_status === 'not_connected') {
                            statusIcon = '<i class="fas fa-exclamation-circle text-warning ms-2" title="Not connected"></i>';
                        } else if (msg.send_status === 'failed') {
                            statusIcon = '<i class="fas fa-times-circle text-danger ms-2" title="Failed"></i>';
                        } else if (msg.send_status === 'sent') {
                            statusIcon = '<i class="fas fa-check text-success ms-2" title="Sent"></i>';
                        }
                    }

                    html += `
                        <div class="chat-message ${isOutbound ? 'chat-message-outbound' : 'chat-message-inbound'}">
                            <div class="chat-bubble ${bubbleClass}">
                                ${escapeHtml(msg.body)}
                                <div class="chat-message-meta">
                                    <small class="text-muted">${formatTime(msg.created_at)}</small>
                                    ${statusIcon}
                                </div>
                            </div>
                        </div>
                    `;
                });
            }

            html += `
                </div>
                <div class="chat-thread-composer">
                    <div class="input-group">
                        <input type="text" class="form-control" id="contactsMessageInput" placeholder="Type a message..." />
                        <button class="btn btn-primary" type="button" id="contactsSendBtn">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            `;

            pane.html(html);

            // Scroll to bottom
            const messagesEl = document.getElementById('contactsThreadMessages');
            if (messagesEl) {
                messagesEl.scrollTop = messagesEl.scrollHeight;
            }

            // Attach send handlers
            $('#contactsSendBtn').off('click').on('click', () => {
                _crmWhatsappContactsTab.sendMessage(conversationId);
            });

            $('#contactsMessageInput').off('keypress').on('keypress', function (e) {
                if (e.which === 13) { // Enter key
                    e.preventDefault();
                    _crmWhatsappContactsTab.sendMessage(conversationId);
                }
            });
        },

        sendMessage: async (conversationId) => {
            const input = $('#contactsMessageInput');
            const body = input.val().trim();

            if (!body) return;

            // Disable input while sending
            input.prop('disabled', true);
            $('#contactsSendBtn').prop('disabled', true);

            try {
                // Insert message with 'queued' status
                const result = await dataFunctions.chatSendMessage(
                    conversationId,
                    currentUserId,
                    body,
                    'outbound_whatsapp',
                    'queued',
                    null,
                    null
                );

                if (!result || !result.message_id) {
                    throw new Error(result?.error || 'Failed to send message');
                }

                const messageId = result.message_id;

                // Clear input
                input.val('').prop('disabled', false);
                $('#contactsSendBtn').prop('disabled', false);

                // Reload messages to show the queued message
                await _crmWhatsappContactsTab.loadMessages(conversationId);

                // Call WhatsApp edge function
                const conv = conversations.find(c => c.conversation_id === conversationId);
                const phone = conv ? conv.external_phone : null;

                if (!phone) {
                    throw new Error('No phone number for this conversation');
                }

                try {
                    const sendResult = await dataFunctions.sendWhatsappMessageNow(phone, body);

                    if (sendResult.success) {
                        // Update message status to 'sent'
                        await dataFunctions.chatUpdateMessageSendResult(
                            messageId,
                            'sent',
                            sendResult.external_message_id || null,
                            null
                        );
                    } else {
                        // Update message status to 'not_connected' or 'failed'
                        const status = sendResult.error && sendResult.error.includes('not yet connected') ? 'not_connected' : 'failed';
                        await dataFunctions.chatUpdateMessageSendResult(
                            messageId,
                            status,
                            null,
                            sendResult.error || 'Unknown error'
                        );
                    }
                } catch (sendError) {
                    // Update message status to 'failed'
                    await dataFunctions.chatUpdateMessageSendResult(
                        messageId,
                        'failed',
                        null,
                        sendError.message || 'Unknown error'
                    );
                }

                // Reload messages to show updated status
                await _crmWhatsappContactsTab.loadMessages(conversationId);

                // Reload conversations to update last message
                await _crmWhatsappContactsTab.loadConversations();
            } catch (e) {
                console.error('[WhatsApp Contacts] Failed to send message:', e);
                input.prop('disabled', false);
                $('#contactsSendBtn').prop('disabled', false);

                if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Failed to send message: ' + e.message, 'error');
                }
            }
        },

        startPolling: () => {
            // Clear existing poll
            if (pollInterval) {
                clearInterval(pollInterval);
            }

            // Poll for new messages every 5 seconds
            pollInterval = setInterval(async () => {
                if (currentConversationId) {
                    await _crmWhatsappContactsTab.loadMessages(currentConversationId);
                }
            }, POLL_MS);
        },

        stopPolling: () => {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
        }
    };
}();
