/**
 * CRM WhatsApp Internal Tab — staff-to-staff internal chat.
 */
var _crmWhatsappInternalTab = function () {
    'use strict';

    let currentUserId = null;
    let currentConversationId = null;
    let conversations = [];
    let users = [];
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
            console.log('[WhatsApp Internal] Initializing internal tab...');

            // Get current user
            try {
                const token = typeof Session !== 'undefined' && Session.get ? Session.get('token') : null;
                if (!token) {
                    console.error('[WhatsApp Internal] No session token');
                    return;
                }

                const user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
                if (user && user.id) {
                    currentUserId = user.id;
                } else {
                    console.error('[WhatsApp Internal] No current user');
                    return;
                }
            } catch (e) {
                console.error('[WhatsApp Internal] Failed to get current user:', e);
                return;
            }

            // Load users for picker
            await _crmWhatsappInternalTab.loadUsersForPicker();

            // Setup event listeners
            _crmWhatsappInternalTab.setupEventListeners();

            // Load conversations
            await _crmWhatsappInternalTab.loadConversations();

            console.log('[WhatsApp Internal] Internal tab initialized');
        },

        setupEventListeners: () => {
            // New chat button
            $('#newInternalChatBtn').off('click').on('click', () => {
                $('#newInternalChatModal').modal('show');
            });

            // Colleague select change
            $('#colleagueSelect').off('change').on('change', function () {
                const userId = $(this).val();
                const startBtn = $('#startInternalChatBtn');

                if (!userId) {
                    startBtn.prop('disabled', true);
                } else {
                    startBtn.prop('disabled', false);
                }
            });

            // Start internal chat button
            $('#startInternalChatBtn').off('click').on('click', async () => {
                const otherUserId = $('#colleagueSelect').val();
                if (!otherUserId) return;

                await _crmWhatsappInternalTab.startInternalConversation(otherUserId);
            });

            // Search input
            $('#internalSearchInput').off('input').on('input', function () {
                const search = $(this).val().toLowerCase();
                _crmWhatsappInternalTab.filterConversations(search);
            });
        },

        loadUsersForPicker: async () => {
            try {
                users = await dataFunctions.getUsers();

                const select = $('#colleagueSelect');
                select.empty();
                select.append('<option value="">Select a colleague...</option>');

                users.forEach(user => {
                    // Don't show current user in the list
                    if (user.id === currentUserId) return;

                    const name = user.first_name && user.last_name
                        ? `${user.first_name} ${user.last_name}`
                        : user.email || 'Unnamed User';
                    select.append(`<option value="${escapeHtml(user.id)}">${escapeHtml(name)}</option>`);
                });
            } catch (e) {
                console.error('[WhatsApp Internal] Failed to load users:', e);
                $('#colleagueSelect').html('<option value="">Error loading users</option>');
            }
        },

        startInternalConversation: async (otherUserId) => {
            try {
                const result = await dataFunctions.chatStartInternalConversation(currentUserId, otherUserId);

                if (!result || !result.conversation_id) {
                    throw new Error(result?.error || 'Failed to start conversation');
                }

                $('#newInternalChatModal').modal('hide');

                // Reload conversations and open the new/existing one
                await _crmWhatsappInternalTab.loadConversations();
                _crmWhatsappInternalTab.openConversation(result.conversation_id);
            } catch (e) {
                console.error('[WhatsApp Internal] Failed to start conversation:', e);
                if (typeof Swal !== 'undefined') {
                    Swal.fire('Error', 'Failed to start conversation: ' + e.message, 'error');
                }
            }
        },

        loadConversations: async () => {
            try {
                const result = await dataFunctions.chatListConversations(currentUserId, 'internal');

                if (!result || typeof result.success === 'undefined') {
                    conversations = result || [];
                } else if (result.success === 0) {
                    throw new Error(result.error || 'Failed to load conversations');
                } else {
                    conversations = [];
                }

                _crmWhatsappInternalTab.renderConversationList();
            } catch (e) {
                console.error('[WhatsApp Internal] Failed to load conversations:', e);
                $('#internalConversationList').html(`
                    <div class="text-center text-danger py-5">
                        <i class="fas fa-exclamation-triangle fa-3x mb-3 opacity-25"></i>
                        <p>Failed to load conversations</p>
                    </div>
                `);
            }
        },

        renderConversationList: () => {
            const listEl = $('#internalConversationList');

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
                                    <strong class="chat-name">${escapeHtml(conv.other_party_name || 'Colleague')}</strong>
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
                _crmWhatsappInternalTab.openConversation(convId);
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
            await _crmWhatsappInternalTab.loadMessages(conversationId);

            // Mark conversation as read
            try {
                await dataFunctions.chatMarkConversationRead(conversationId, currentUserId);
                // Reload conversations to update unread count
                await _crmWhatsappInternalTab.loadConversations();
            } catch (e) {
                console.warn('[WhatsApp Internal] Failed to mark conversation read:', e);
            }

            // Start polling for new messages
            _crmWhatsappInternalTab.startPolling();

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

                _crmWhatsappInternalTab.renderThread(conversationId, messages);
            } catch (e) {
                console.error('[WhatsApp Internal] Failed to load messages:', e);
                $('#internalThreadPane').html(`
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

            const pane = $('#internalThreadPane');

            let html = `
                <div class="chat-thread-header">
                    <div class="d-flex align-items-center">
                        <i class="fas fa-user-circle fa-2x text-muted me-2"></i>
                        <strong>${escapeHtml(conv.other_party_name || 'Colleague')}</strong>
                    </div>
                </div>
                <div class="chat-thread-messages" id="internalThreadMessages">
            `;

            if (!messages || messages.length === 0) {
                html += `<div class="text-center text-muted py-4"><p>No messages yet. Start the conversation below.</p></div>`;
            } else {
                messages.forEach(msg => {
                    const isMine = msg.sender_user_id === currentUserId;
                    const bubbleClass = isMine ? 'chat-bubble-outbound' : 'chat-bubble-inbound';

                    html += `
                        <div class="chat-message ${isMine ? 'chat-message-outbound' : 'chat-message-inbound'}">
                            <div class="chat-bubble ${bubbleClass}">
                                ${escapeHtml(msg.body)}
                                <div class="chat-message-meta">
                                    <small class="text-muted">${formatTime(msg.created_at)}</small>
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
                        <input type="text" class="form-control" id="internalMessageInput" placeholder="Type a message..." />
                        <button class="btn btn-primary" type="button" id="internalSendBtn">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            `;

            pane.html(html);

            // Scroll to bottom
            const messagesEl = document.getElementById('internalThreadMessages');
            if (messagesEl) {
                messagesEl.scrollTop = messagesEl.scrollHeight;
            }

            // Attach send handlers
            $('#internalSendBtn').off('click').on('click', () => {
                _crmWhatsappInternalTab.sendMessage(conversationId);
            });

            $('#internalMessageInput').off('keypress').on('keypress', function (e) {
                if (e.which === 13) { // Enter key
                    e.preventDefault();
                    _crmWhatsappInternalTab.sendMessage(conversationId);
                }
            });
        },

        sendMessage: async (conversationId) => {
            const input = $('#internalMessageInput');
            const body = input.val().trim();

            if (!body) return;

            // Disable input while sending
            input.prop('disabled', true);
            $('#internalSendBtn').prop('disabled', true);

            try {
                // Insert message
                const result = await dataFunctions.chatSendMessage(
                    conversationId,
                    currentUserId,
                    body,
                    'internal',
                    'sent',
                    null,
                    null
                );

                if (!result || !result.message_id) {
                    throw new Error(result?.error || 'Failed to send message');
                }

                // Clear input
                input.val('').prop('disabled', false);
                $('#internalSendBtn').prop('disabled', false);

                // Reload messages
                await _crmWhatsappInternalTab.loadMessages(conversationId);

                // Reload conversations to update last message
                await _crmWhatsappInternalTab.loadConversations();
            } catch (e) {
                console.error('[WhatsApp Internal] Failed to send message:', e);
                input.prop('disabled', false);
                $('#internalSendBtn').prop('disabled', false);

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
                    await _crmWhatsappInternalTab.loadMessages(currentConversationId);
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
