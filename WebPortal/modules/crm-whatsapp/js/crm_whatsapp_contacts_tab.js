/**
 * CRM WhatsApp Contacts Tab
 * WhatsApp conversations with CRM contacts
 */

var _crmWhatsappContactsTab = (function () {
    'use strict';

    var state = {
        conversations: [],
        currentConversationId: null,
        currentConversation: null,
        messages: [],
        pollInterval: null
    };

    function init() {
        console.log('Initializing Contacts tab');

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
        $('#contactsNewChatBtn').off('click').on('click', function () {
            openNewChatModal();
        });

        // Send button
        $('#contactsSendBtn').off('click').on('click', function () {
            sendMessage();
        });

        // Enter key in composer
        $('#contactsMessageInput').off('keypress').on('keypress', function (e) {
            if (e.which === 13 && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Search input
        $('#contactsSearchInput').off('input').on('input', function () {
            var query = $(this).val().toLowerCase();
            filterConversations(query);
        });

        // Conversation list item clicks - delegated to container
        $('#contactsConversationList').off('click', '.chat-list-item').on('click', '.chat-list-item', function () {
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

        dataFunctions.chatListConversations(userId, 'whatsapp_contact').then(function (data) {
            if (data && data.success !== false) {
                state.conversations = data;
                renderConversationList();
            } else {
                console.error('Failed to load conversations:', data);
                $('#contactsConversationList').html('<div class="text-center text-danger p-4">Failed to load conversations</div>');
            }
        }).catch(function (error) {
            console.error('Error loading conversations:', error);
            $('#contactsConversationList').html('<div class="text-center text-danger p-4">Error loading conversations</div>');
        });
    }

    function renderConversationList() {
        var $list = $('#contactsConversationList');
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
        $('#contactsConversationList .chat-list-item').each(function () {
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
        $('#contactsConversationList .chat-list-item').removeClass('active');
        $('#contactsConversationList .chat-list-item[data-conversation-id="' + conversationId + '"]').addClass('active');

        // Show composer
        $('#contactsComposerContainer').show();

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
            if ($('#contactsThreadContainer').length === 0) {
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
                $('#contactsThreadContainer').html('<div class="text-center text-danger p-4">Failed to load messages</div>');
            }
        }).catch(function (error) {
            if (!silent) {
                console.error('Error loading messages:', error);
                $('#contactsThreadContainer').html('<div class="text-center text-danger p-4">Error loading messages</div>');
            }
        });
    }

    function renderMessages() {
        var $container = $('#contactsThreadContainer');
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
            var statusIcon = '';

            if (isOutbound && msg.direction === 'outbound_whatsapp') {
                // Show status for outbound WhatsApp messages
                if (msg.send_status === 'sent') {
                    statusIcon = '<i class="fas fa-check message-status-icon status-sent" title="Sent"></i>';
                } else if (msg.send_status === 'queued') {
                    statusIcon = '<i class="fas fa-clock message-status-icon status-queued" title="Queued"></i>';
                } else if (msg.send_status === 'not_connected') {
                    statusIcon = '<i class="fas fa-exclamation-triangle message-status-icon status-not-connected" title="Not connected"></i>';
                } else if (msg.send_status === 'failed') {
                    statusIcon = '<i class="fas fa-times-circle message-status-icon status-failed" title="Failed"></i>';
                }
            }

            var html = '<div class="d-flex ' + (isOutbound ? 'justify-content-end' : 'justify-content-start') + '">' +
                '<div class="message-bubble ' + bubbleClass + '">' +
                '<div class="message-body">' + escapeHtml(msg.body).replace(/\n/g, '<br>') + '</div>' +
                '<div class="message-meta">' +
                statusIcon +
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
        var body = $('#contactsMessageInput').val().trim();
        if (!body) return;

        var userId = _crmWhatsappGrid.getCurrentUserId();
        if (!userId || !state.currentConversationId || !state.currentConversation) return;

        // Check for action permission
        if (typeof actionAccess !== 'undefined' && !actionAccess.hasAction('messaging.whatsapp.contact.send')) {
            Swal.fire('Permission Denied', 'You do not have permission to send WhatsApp messages.', 'error');
            return;
        }

        // Resolve phone number from conversation
        var phone = state.currentConversation.external_phone;
        if (!phone) {
            Swal.fire('Error', 'No phone number found for this conversation.', 'error');
            return;
        }

        // Clear input immediately
        $('#contactsMessageInput').val('');

        // Send via RPC (queues the message)
        dataFunctions.chatSendMessage(state.currentConversationId, userId, body).then(function (result) {
            if (result && result.success && result.message_id) {
                var messageId = result.message_id;

                // Reload messages to show the new one
                loadMessages();

                // Reload conversation list to update preview
                loadConversations();

                // Attempt to send via WhatsApp edge function
                dataFunctions.sendWhatsappMessageNow(phone, body).then(function (sendResult) {
                    var status = 'failed';
                    var externalId = null;
                    var errorMsg = null;

                    if (sendResult.httpStatus === 503) {
                        status = 'not_connected';
                        $('#contactsNotConnectedBanner').show();
                    } else if (sendResult.data && sendResult.data.success) {
                        status = 'sent';
                        externalId = sendResult.data.external_message_id;
                    } else {
                        status = 'failed';
                        errorMsg = sendResult.data ? sendResult.data.error : 'Unknown error';
                    }

                    // Update message status
                    return dataFunctions.chatUpdateMessageSendResult(messageId, userId, status, externalId, errorMsg);
                }).then(function () {
                    // Reload messages to show updated status
                    loadMessages(true);
                }).catch(function (error) {
                    console.error('Error sending WhatsApp message:', error);
                    // Mark as failed
                    dataFunctions.chatUpdateMessageSendResult(messageId, userId, 'failed', null, String(error)).then(function () {
                        loadMessages(true);
                    });
                });
            } else {
                Swal.fire('Error', result && result.error ? result.error : 'Failed to send message', 'error');
                // Restore the message to the input
                $('#contactsMessageInput').val(body);
            }
        }).catch(function (error) {
            console.error('Error queuing message:', error);
            Swal.fire('Error', 'Failed to send message', 'error');
            // Restore the message to the input
            $('#contactsMessageInput').val(body);
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
        if (typeof actionAccess !== 'undefined' && !actionAccess.hasAction('messaging.whatsapp.contact.send')) {
            Swal.fire('Permission Denied', 'You do not have permission to send WhatsApp messages.', 'error');
            return;
        }

        // Load contacts
        dataFunctions.getContactsForMessaging().then(function (contacts) {
            if (!contacts || contacts.length === 0) {
                Swal.fire('No Contacts', 'No contacts available for messaging.', 'info');
                return;
            }

            // Build contact picker HTML
            var html = '<div style="max-height: 400px; overflow-y: auto;">';
            contacts.forEach(function (contact) {
                var hasPhone = (contact.primary_contact_phone || contact.primary_contact_mobile);
                var disabled = !hasPhone;
                var disabledClass = disabled ? ' disabled' : '';
                var phoneDisplay = hasPhone ?
                    '<div class="contact-phone">' + escapeHtml(contact.primary_contact_mobile || contact.primary_contact_phone) + '</div>' :
                    '<div class="no-phone-warning"><i class="fas fa-exclamation-triangle"></i> No WhatsApp number on file</div>';

                html += '<div class="contact-picker-item' + disabledClass + '" data-contact-id="' + contact.id + '" data-disabled="' + disabled + '">' +
                    '<div class="contact-name">' + escapeHtml(contact.company_name || contact.primary_contact_name || 'Unknown') + '</div>' +
                    phoneDisplay +
                    '</div>';
            });
            html += '</div>';

            Swal.fire({
                title: 'New WhatsApp Conversation',
                html: html,
                showCancelButton: true,
                showConfirmButton: false,
                cancelButtonText: 'Close'
            });

            // Bind click events
            $('.contact-picker-item').on('click', function () {
                if ($(this).data('disabled')) {
                    Swal.fire('No Phone Number', 'This contact has no phone or mobile number on file.', 'warning');
                    return;
                }

                var contactId = $(this).data('contact-id');
                startContactConversation(contactId);
            });
        }).catch(function (error) {
            console.error('Error loading contacts:', error);
            Swal.fire('Error', 'Failed to load contacts', 'error');
        });
    }

    function startContactConversation(contactId) {
        var userId = _crmWhatsappGrid.getCurrentUserId();
        if (!userId) return;

        Swal.close();

        dataFunctions.chatStartContactConversation(contactId, userId).then(function (result) {
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
        init: init,
        openConversation: openConversation
    };
})();
