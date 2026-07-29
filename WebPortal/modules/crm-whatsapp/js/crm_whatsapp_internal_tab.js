/**
 * CRM WhatsApp Internal Tab
 * Staff-to-staff internal messaging
 */

var _crmWhatsappInternalTab = (function () {
    'use strict';

    var state = {
        conversations: [],
        currentConversationId: null,
        currentConversation: null,
        messages: [],
        pollInterval: null
    };

    function init() {
        console.log('Initializing Internal tab');

        // Clear any existing poll interval
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
            state.pollInterval = null;
        }

        // Bind events
        bindEvents();

        // Load conversations
        loadConversations();
    }

    function bindEvents() {
        // New chat button
        $('#internalNewChatBtn').off('click').on('click', function () {
            openNewChatModal();
        });

        // Send button
        $('#internalSendBtn').off('click').on('click', function () {
            sendMessage();
        });

        // Enter key in composer
        $('#internalMessageInput').off('keypress').on('keypress', function (e) {
            if (e.which === 13 && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Search input
        $('#internalSearchInput').off('input').on('input', function () {
            var query = $(this).val().toLowerCase();
            filterConversations(query);
        });

        // Conversation list item clicks - delegated to container
        $('#internalConversationList').off('click', '.chat-list-item').on('click', '.chat-list-item', function () {
            var conversationId = $(this).data('conversation-id');
            openConversation(conversationId);
        });
    }

    function loadConversations() {
        var userId = _crmWhatsappGrid.getCurrentUserId();
        if (!userId) {
            console.error('User ID not available');
            return;
        }

        dataFunctions.chatListConversations(userId, 'internal').then(function (data) {
            if (data && data.success !== false) {
                state.conversations = data;
                renderConversationList();
            } else {
                console.error('Failed to load conversations:', data);
                $('#internalConversationList').html('<div class="text-center text-danger p-4">Failed to load conversations</div>');
            }
        }).catch(function (error) {
            console.error('Error loading conversations:', error);
            $('#internalConversationList').html('<div class="text-center text-danger p-4">Error loading conversations</div>');
        });
    }

    function renderConversationList() {
        var $list = $('#internalConversationList');
        $list.empty();

        if (!state.conversations || state.conversations.length === 0) {
            $list.html('<div class="text-center text-muted p-4">No conversations yet<br><small>Click + to start a new chat</small></div>');
            return;
        }

        state.conversations.forEach(function (conv) {
            var isActive = conv.conversation_id === state.currentConversationId;
            var unreadBadge = conv.unread_count > 0 ? '<span class="unread-badge">' + conv.unread_count + '</span>' : '';
            var preview = conv.last_message_body ? escapeHtml(conv.last_message_body).substring(0, 50) : 'No messages yet';
            var time = conv.last_message_created_at ? formatTime(conv.last_message_created_at) : '';

            var html = '<div class="chat-list-item' + (isActive ? ' active' : '') + '" data-conversation-id="' + conv.conversation_id + '">' +
                '<div class="d-flex justify-content-between align-items-start">' +
                '<div class="flex-grow-1">' +
                '<div class="chat-name">' + escapeHtml(conv.other_party_name || 'Unknown') + '</div>' +
                '<div class="chat-preview">' + preview + '</div>' +
                '</div>' +
                '<div class="text-end">' +
                '<div class="chat-time">' + time + '</div>' +
                unreadBadge +
                '</div>' +
                '</div>' +
                '</div>';

            $list.append(html);
        });
    }

    function filterConversations(query) {
        $('#internalConversationList .chat-list-item').each(function () {
            var $item = $(this);
            var name = $item.find('.chat-name').text().toLowerCase();
            var preview = $item.find('.chat-preview').text().toLowerCase();

            if (name.includes(query) || preview.includes(query)) {
                $item.show();
            } else {
                $item.hide();
            }
        });
    }

    function openConversation(conversationId) {
        state.currentConversationId = conversationId;
        state.currentConversation = state.conversations.find(function (c) {
            return c.conversation_id === conversationId;
        });

        // Update active state in list
        $('#internalConversationList .chat-list-item').removeClass('active');
        $('#internalConversationList .chat-list-item[data-conversation-id="' + conversationId + '"]').addClass('active');

        // Show composer
        $('#internalComposerContainer').show();

        // Load messages
        loadMessages();

        // Mark as read
        markConversationRead();

        // Start polling for new messages (every 5 seconds)
        if (state.pollInterval) {
            clearInterval(state.pollInterval);
        }
        state.pollInterval = setInterval(function () {
            // Only poll if the pane still exists in the document
            if ($('#internalThreadContainer').length === 0) {
                clearInterval(state.pollInterval);
                state.pollInterval = null;
                return;
            }
            loadMessages(true);
        }, 5000);
    }

    function loadMessages(silent) {
        if (!state.currentConversationId) return;

        var userId = _crmWhatsappGrid.getCurrentUserId();
        if (!userId) return;

        dataFunctions.chatListMessages(state.currentConversationId, userId).then(function (data) {
            if (data && data.success !== false) {
                state.messages = data;
                renderMessages();
            } else if (!silent) {
                console.error('Failed to load messages:', data);
                $('#internalThreadContainer').html('<div class="text-center text-danger p-4">Failed to load messages</div>');
            }
        }).catch(function (error) {
            if (!silent) {
                console.error('Error loading messages:', error);
                $('#internalThreadContainer').html('<div class="text-center text-danger p-4">Error loading messages</div>');
            }
        });
    }

    function renderMessages() {
        var $container = $('#internalThreadContainer');
        var scrolledToBottom = isScrolledToBottom($container[0]);

        $container.empty();

        if (!state.messages || state.messages.length === 0) {
            $container.html('<div class="text-center text-muted p-4">No messages yet<br><small>Send a message to start the conversation</small></div>');
            return;
        }

        var userId = _crmWhatsappGrid.getCurrentUserId();

        state.messages.forEach(function (msg) {
            var isOutbound = msg.sender_user_id === userId;
            var bubbleClass = isOutbound ? 'outbound' : 'inbound';
            var senderName = !isOutbound ? '<div style="font-size: 0.75rem; font-weight: 600; margin-bottom: 4px;">' + escapeHtml(msg.sender_name) + '</div>' : '';

            var html = '<div class="d-flex ' + (isOutbound ? 'justify-content-end' : 'justify-content-start') + '">' +
                '<div class="message-bubble ' + bubbleClass + '">' +
                senderName +
                '<div class="message-body">' + escapeHtml(msg.body).replace(/\n/g, '<br>') + '</div>' +
                '<div class="message-meta">' +
                '<span>' + formatTime(msg.created_at) + '</span>' +
                '</div>' +
                '</div>' +
                '</div>';

            $container.append(html);
        });

        // Scroll to bottom if previously at bottom or first load
        if (scrolledToBottom || state.messages.length <= 1) {
            scrollToBottom($container[0]);
        }
    }

    function sendMessage() {
        var body = $('#internalMessageInput').val().trim();
        if (!body) return;

        var userId = _crmWhatsappGrid.getCurrentUserId();
        if (!userId || !state.currentConversationId) return;

        // Check for action permission
        if (typeof actionAccess !== 'undefined' && !actionAccess.hasAction('messaging.chat.use')) {
            Swal.fire('Permission Denied', 'You do not have permission to use internal chat.', 'error');
            return;
        }

        // Clear input immediately
        $('#internalMessageInput').val('');

        // Send via RPC
        dataFunctions.chatSendMessage(state.currentConversationId, userId, body).then(function (result) {
            if (result && result.success) {
                // Reload messages to show the new one
                loadMessages();

                // Reload conversation list to update preview
                loadConversations();
            } else {
                Swal.fire('Error', result && result.error ? result.error : 'Failed to send message', 'error');
                // Restore the message to the input
                $('#internalMessageInput').val(body);
            }
        }).catch(function (error) {
            console.error('Error sending message:', error);
            Swal.fire('Error', 'Failed to send message', 'error');
            // Restore the message to the input
            $('#internalMessageInput').val(body);
        });
    }

    function markConversationRead() {
        if (!state.currentConversationId) return;

        var userId = _crmWhatsappGrid.getCurrentUserId();
        if (!userId) return;

        dataFunctions.chatMarkConversationRead(state.currentConversationId, userId).then(function () {
            // Reload conversation list to update unread count
            loadConversations();
        }).catch(function (error) {
            console.error('Error marking conversation read:', error);
        });
    }

    function openNewChatModal() {
        // Check for action permission
        if (typeof actionAccess !== 'undefined' && !actionAccess.hasAction('messaging.chat.use')) {
            Swal.fire('Permission Denied', 'You do not have permission to use internal chat.', 'error');
            return;
        }

        // Load users
        dataFunctions.getUsers().then(function (users) {
            if (!users || users.length === 0) {
                Swal.fire('No Users', 'No users available for messaging.', 'info');
                return;
            }

            var userId = _crmWhatsappGrid.getCurrentUserId();

            // Build user picker HTML
            var html = '<div style="max-height: 400px; overflow-y: auto;">';
            users.forEach(function (user) {
                // Skip current user
                if (user.id === userId) return;

                var displayName = user.first_name && user.last_name ?
                    user.first_name + ' ' + user.last_name :
                    user.email;

                html += '<div class="contact-picker-item" data-user-id="' + user.id + '">' +
                    '<div class="contact-name">' + escapeHtml(displayName) + '</div>' +
                    '<div class="contact-phone">' + escapeHtml(user.email) + '</div>' +
                    '</div>';
            });
            html += '</div>';

            Swal.fire({
                title: 'New Internal Chat',
                html: html,
                showCancelButton: true,
                showConfirmButton: false,
                cancelButtonText: 'Close'
            });

            // Bind click events
            $('.contact-picker-item').on('click', function () {
                var otherUserId = $(this).data('user-id');
                startInternalConversation(otherUserId);
            });
        }).catch(function (error) {
            console.error('Error loading users:', error);
            Swal.fire('Error', 'Failed to load users', 'error');
        });
    }

    function startInternalConversation(otherUserId) {
        var userId = _crmWhatsappGrid.getCurrentUserId();
        if (!userId) return;

        Swal.close();

        dataFunctions.chatStartInternalConversation(userId, otherUserId).then(function (result) {
            if (result && result.success && result.conversation_id) {
                // Reload conversations
                loadConversations();

                // Open the new/existing conversation
                setTimeout(function () {
                    openConversation(result.conversation_id);
                }, 500);
            } else {
                Swal.fire('Error', result && result.error ? result.error : 'Failed to start conversation', 'error');
            }
        }).catch(function (error) {
            console.error('Error starting conversation:', error);
            Swal.fire('Error', 'Failed to start conversation', 'error');
        });
    }

    // Utility functions
    function escapeHtml(text) {
        if (!text) return '';
        var map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, function (m) { return map[m]; });
    }

    function formatTime(timestamp) {
        if (!timestamp) return '';
        var date = new Date(timestamp);
        var now = new Date();
        var diff = now - date;
        var minutes = Math.floor(diff / 60000);
        var hours = Math.floor(diff / 3600000);
        var days = Math.floor(diff / 86400000);

        if (minutes < 1) return 'Just now';
        if (minutes < 60) return minutes + 'm ago';
        if (hours < 24) return hours + 'h ago';
        if (days < 7) return days + 'd ago';
        return date.toLocaleDateString();
    }

    function isScrolledToBottom(el) {
        return el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
    }

    function scrollToBottom(el) {
        el.scrollTop = el.scrollHeight;
    }

    return {
        init: init
    };
})();
