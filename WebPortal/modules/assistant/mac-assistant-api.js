/**
 * Mac Portal Guide — HTTP client for portal-assistant edge function.
 * Classic script (no modules). Depends on window.MACAVATION_SUPABASE + Session.
 */
(function (global) {
  'use strict';

  var MOCK_KEY = 'DEV_MOCK_AGENT';

  function cfg() {
    return global.MACAVATION_SUPABASE || {};
  }

  function paUrl() {
    var c = cfg();
    return String(c.url || '').replace(/\/$/, '') + '/functions/v1/portal-assistant';
  }

  function sessionToken() {
    try {
      if (typeof Session !== 'undefined' && Session.get) return Session.get('token') || '';
    } catch (e) { /* ignore */ }
    return '';
  }

  function isMockMode() {
    try {
      if (sessionStorage.getItem(MOCK_KEY) === 'true') return true;
    } catch (e) { /* ignore */ }
    return false;
  }

  function mockChatTurn(opts) {
    var msgs = (opts && opts.messages) || [];
    var last = msgs[msgs.length - 1];
    var lastText = last && typeof last.content === 'string' ? last.content : '';
    return Promise.resolve({
      success: true,
      text:
        'Portal Guide is in offline/mock mode. You asked: "' +
        String(lastText).slice(0, 120) +
        '". Connect the assistant edge function to get real how-to answers.',
      citations: [],
      nav_actions: [],
      suggested_replies: [
        'How do I receive grower intake?',
        'How do I dispatch kernel stock?'
      ],
      can_escalate: false,
      cost_usd: 0
    });
  }

  async function postAction(action, body) {
    if (isMockMode() && action === 'assistant_chat') {
      return mockChatTurn(body);
    }

    var c = cfg();
    var token = sessionToken();
    var headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + c.anonKey,
      apikey: c.anonKey
    };
    if (token) headers['X-Portal-Session'] = token;

    var res = await fetch(paUrl(), {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(Object.assign({ action: action }, body || {}))
    });

    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = { success: false, error: 'Invalid response from assistant' };
    }

    if (!res.ok) {
      var msg = (data && (data.message || data.error)) || 'HTTP ' + res.status;
      if (res.status === 403 && /not enabled|assistant_disabled/i.test(String(msg))) {
        msg =
          'Portal Guide is not enabled yet. An admin can turn it on in the database (assistant_client.assistant_enabled).';
      }
      if (res.status === 401) {
        msg = (data && (data.message || data.error)) || 'Please sign in again to use Portal Guide.';
      }
      if (res.status === 402) {
        msg = (data && (data.message || data.error)) || 'Monthly AI budget reached.';
      }
      var err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  function assistantChat(opts) {
    return postAction('assistant_chat', {
      user_message: opts && opts.user_message,
      messages: opts && opts.messages,
      conversation_guid: opts && opts.conversation_guid,
      client_context: opts && opts.client_context
    });
  }

  function assistantFeedback(opts) {
    return postAction('assistant_feedback', {
      message_id: opts && opts.message_id,
      rating: opts && opts.rating,
      comment: opts && opts.comment
    });
  }

  global.MacAssistantApi = {
    isMockMode: isMockMode,
    assistantChat: assistantChat,
    assistantFeedback: assistantFeedback,
    postAction: postAction
  };
})(typeof window !== 'undefined' ? window : globalThis);
