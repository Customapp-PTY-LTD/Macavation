/**
 * Mac Portal Guide — FAB + docked chat rail (Libra-parity, no escalation).
 * Classic script. Depends on MacAssistantApi, Session, _appRouter (optional).
 */
(function (global) {
  'use strict';

  var USER_GUIDE_URL = 'help/index.html';
  var MAC_SRC = 'img/mac.svg';
  var RAIL_PREF_KEY = 'mac_assistant_rail_w';
  var RAIL_MIN_W = 300;
  var RAIL_MAX_W = 560;
  var RAIL_STEP_W = 20;
  // Phrased so each one lands a dominant, unambiguous hit in
  // assistant_kb_search and answers for free via the portal-assistant
  // zero-token fast path instead of paying for an Anthropic call - mirrors
  // the same constraint Libra-Portal's assistant-shell.js documents for its
  // own example chips. Verified against migrations/20260716160000 +
  // 20260722130000's scoring/tokenizer and scripts/ingest-macavation-
  // assistant-kb.mjs's SECTION_KEYWORDS. Two natural phrasings that read
  // fine but tie against a sibling section and never trigger the free path:
  // "How do I receive a grower intake batch?" (ties grower-intake-grid vs
  // modal-grower-create-kernel-batch) and "How do I dispatch kernel to a
  // customer?" (ties kernel-dispatch-grid vs its own basket dialog) - if you
  // add new examples, re-check them the same way before shipping.
  var DEFAULT_EXAMPLES = [
    'Where do I create a kernel batch from a grower delivery?',
    'How do I start kernel production?',
    'How do I check stock on hand?',
    'How do I upload a document?',
    'How do I use My Day?',
    'How do I open Quality Assurance?'
  ];
  var WELCOME_COPY =
    "Hi, I'm Mac! Ask me anything about the portal and I'll point you in the right direction.";
  var ROUTE_LABELS = {
    dashboard: 'Dashboard',
    'my-day': 'My Day',
    'crm-grid': 'CRM',
    'grower-intake-grid': 'Grower Intake',
    'kernel-production-grid': 'Kernel Production',
    'oil-production-grid': 'Oil Production',
    'stock-management-grid': 'Stock',
    'quality-assurance-grid': 'Quality Assurance',
    'kernel-dispatch-grid': 'Kernel Dispatch',
    'financial-management-grid': 'Financial',
    'document-management-grid': 'Documents',
    'users-grid': 'Users'
  };

  var transcript = [];
  var conversationGuid = null;
  var pendingText = '';
  var inited = false;
  var busy = false;
  var spendUsd = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function api() {
    return global.MacAssistantApi || {};
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function guideFace(className) {
    return (
      '<img class="' +
      className +
      '" src="' +
      MAC_SRC +
      '" alt="" decoding="async" aria-hidden="true">'
    );
  }

  function formatText(raw) {
    var s = esc(String(raw || ''));
    s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\[([^\]]+)\]\(#[a-zA-Z0-9_-]+\)/g, '<b>$1</b>');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  function scrollDown() {
    var thread = $('macAgentThread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function buildContext() {
    var route = '';
    try {
      if (typeof Session !== 'undefined' && Session.get) {
        route = Session.get('lastActivePage') || '';
      }
    } catch (e) { /* ignore */ }
    var user = null;
    try {
      if (typeof Session !== 'undefined' && Session.get) user = Session.get('user');
    } catch (e2) { /* ignore */ }
    return {
      route: route,
      route_label: ROUTE_LABELS[route] || route || null,
      user_role: (user && (user.role_name || user.role)) || null
    };
  }

  function appendUserBubble(text) {
    var thread = $('macAgentThread');
    if (!thread) return;
    thread.insertAdjacentHTML(
      'beforeend',
      '<div class="mac-agent-msg mac-agent-msg-user">' +
        '<div class="mac-agent-bubble">' +
        esc(text) +
        '</div></div>'
    );
    scrollDown();
  }

  function appendAssistantBubble(resp) {
    var text = (resp && resp.text) || '';
    var citations = Array.isArray(resp && resp.citations) ? resp.citations : [];
    var navActions = Array.isArray(resp && resp.nav_actions) ? resp.nav_actions : [];
    var messageId = (resp && resp.message_id) || null;
    var thread = $('macAgentThread');
    if (!thread) return;

    var citesHtml = '';
    if (citations.length) {
      citesHtml =
        '<div class="pa-cites">' +
        citations
          .map(function (c) {
            return (
              '<button type="button" class="pa-cite" data-pa-anchor="' +
              esc(c.anchor || '') +
              '">' +
              esc(c.title || c.anchor || 'Guide') +
              '</button>'
            );
          })
          .join('') +
        '</div>';
    }

    var navHtml = '';
    if (navActions.length) {
      navHtml =
        '<div class="pa-nav-actions">' +
        navActions
          .map(function (n) {
            var route = n.route || n.id || '';
            return (
              '<button type="button" class="pa-chip" data-pa-route="' +
              esc(route) +
              '">' +
              esc(n.label || route) +
              '</button>'
            );
          })
          .join('') +
        '</div>';
    }

    var fbHtml = '';
    if (messageId) {
      fbHtml =
        '<div class="pa-feedback" data-mid="' +
        esc(String(messageId)) +
        '">' +
        '<button type="button" class="pa-fb-btn" data-vote="up" aria-label="Helpful">&#128077;</button>' +
        '<button type="button" class="pa-fb-btn" data-vote="down" aria-label="Not helpful">&#128078;</button>' +
        '</div>';
    }

    thread.insertAdjacentHTML(
      'beforeend',
      '<div class="mac-agent-msg mac-agent-msg-assistant">' +
        '<div class="mac-agent-msg-row">' +
        guideFace('mac-agent-face') +
        '<div class="mac-agent-bubble">' +
        formatText(text) +
        citesHtml +
        navHtml +
        fbHtml +
        '</div></div></div>'
    );
    scrollDown();
  }

  function appendHtml(html) {
    var thread = $('macAgentThread');
    if (!thread) return;
    thread.insertAdjacentHTML('beforeend', html);
    scrollDown();
  }

  function showTyping(on) {
    var existing = $('macAgentTyping');
    if (existing) existing.remove();
    if (!on) return;
    appendHtml(
      '<div class="mac-agent-msg mac-agent-msg-assistant" id="macAgentTyping">' +
        '<div class="mac-agent-msg-row">' +
        guideFace('mac-agent-face') +
        '<div class="mac-agent-bubble mac-agent-typing">Mac is thinking…</div></div></div>'
    );
  }

  function setComposerEnabled(enabled) {
    var input = $('macAgentInput');
    var send = $('macAgentSend');
    if (input) input.disabled = !enabled;
    if (send) send.disabled = !enabled || !(input && input.value.trim());
  }

  function updateSpend() {
    var chip = $('macAgentSpend');
    if (!chip) return;
    if (!spendUsd) {
      chip.hidden = true;
      return;
    }
    chip.hidden = false;
    chip.textContent = '~$' + spendUsd.toFixed(3);
  }

  function setChips(suggested) {
    var wrap = $('macAgentExamples');
    if (!wrap) return;
    wrap.classList.remove('d-none');
    wrap.innerHTML = '';
    (suggested || []).forEach(function (label) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mac-agent-chip';
      btn.textContent = label;
      wrap.appendChild(btn);
    });
  }

  function renderExamples() {
    var wrap = $('macAgentExamples');
    if (!wrap) return;
    if (transcript.length > 0) {
      wrap.classList.add('d-none');
      wrap.innerHTML = '';
      return;
    }
    wrap.classList.remove('d-none');
    wrap.innerHTML =
      '<div class="mac-agent-welcome">' +
      guideFace('mac-agent-welcome-face') +
      '<p class="mac-agent-welcome-text">' +
      esc(WELCOME_COPY) +
      '</p></div>' +
      '<div class="mac-agent-example-chips">' +
      DEFAULT_EXAMPLES.map(function (ex, i) {
        return (
          '<button type="button" class="mac-agent-chip" data-example-idx="' +
          i +
          '">' +
          esc(ex) +
          '</button>'
        );
      }).join('') +
      '</div>';
    wrap.querySelectorAll('[data-example-idx]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var idx = parseInt(btn.getAttribute('data-example-idx'), 10);
        var text = DEFAULT_EXAMPLES[idx];
        if (text) sendMessage(text);
      });
    });
  }

  function refreshContext() {
    var ctx = buildContext();
    var label = $('macAgentContextLabel');
    if (label) {
      label.textContent = ctx.route_label || 'How-to help for the portal';
    }
    if (!transcript.length) renderExamples();
  }

  function onThreadClick(e) {
    var cite = e.target.closest('[data-pa-anchor]');
    if (cite) {
      var anchor = cite.getAttribute('data-pa-anchor');
      if (anchor) window.open(USER_GUIDE_URL + '#' + anchor, '_blank', 'noopener');
      return;
    }

    var navBtn = e.target.closest('[data-pa-route]');
    if (navBtn) {
      var route = navBtn.getAttribute('data-pa-route');
      if (route && typeof global._appRouter !== 'undefined' && global._appRouter.routeTo) {
        global._appRouter.routeTo(route);
        close();
      }
      return;
    }

    var fbBtn = e.target.closest('[data-vote]');
    if (fbBtn) {
      var midEl = fbBtn.closest('[data-mid]');
      var mid = midEl && midEl.getAttribute('data-mid');
      var vote = fbBtn.getAttribute('data-vote');
      if (mid && vote && api().assistantFeedback) {
        api()
          .assistantFeedback({ message_id: mid, rating: vote })
          .catch(function () {});
        fbBtn.classList.add('pa-fb-active');
        var parent = fbBtn.parentNode;
        if (parent) {
          parent.querySelectorAll('[data-vote]').forEach(function (b) {
            if (b !== fbBtn) b.disabled = true;
          });
        }
      }
    }
  }

  function onExamplesClick(e) {
    var chip = e.target.closest('.mac-agent-chip');
    if (chip && !chip.disabled) {
      var text = chip.textContent.trim();
      if (text) sendMessage(text);
    }
  }

  function renderError(msg) {
    appendHtml(
      '<div class="mac-agent-error" role="alert">' +
        esc(msg) +
        ' <button type="button" class="mac-agent-retry" id="macAgentRetry">Retry</button></div>'
    );
    var retry = $('macAgentRetry');
    if (retry) {
      retry.addEventListener('click', function () {
        var errEl = retry.closest('.mac-agent-error');
        if (errEl) errEl.remove();
        if (pendingText) sendTurn(pendingText);
      });
    }
  }

  async function sendTurn(text) {
    if (busy) return;
    busy = true;
    pendingText = text;
    setComposerEnabled(false);
    showTyping(true);

    var resp;
    try {
      resp = await api().assistantChat({
        user_message: text,
        messages: transcript,
        conversation_guid: conversationGuid,
        client_context: buildContext()
      });
    } catch (err) {
      showTyping(false);
      renderError((err && err.message) || 'Network error. Check your connection.');
      busy = false;
      setComposerEnabled(true);
      if ($('macAgentInput')) $('macAgentInput').focus();
      return;
    }

    showTyping(false);

    if (!resp || resp.success === false) {
      renderError((resp && (resp.message || resp.error)) || 'The assistant service returned an error.');
      busy = false;
      setComposerEnabled(true);
      if ($('macAgentInput')) $('macAgentInput').focus();
      return;
    }

    if (resp.conversation_guid) conversationGuid = resp.conversation_guid;
    if (typeof resp.cost_usd === 'number') {
      spendUsd += resp.cost_usd;
      updateSpend();
    }

    transcript.push({ role: 'user', content: text });
    transcript.push({ role: 'assistant', content: resp.text || '' });

    appendAssistantBubble(resp);
    setChips(resp.suggested_replies || []);

    busy = false;
    setComposerEnabled(true);
    refreshContext();
    if ($('macAgentInput')) $('macAgentInput').focus();
  }

  async function sendMessage(text) {
    var trimmed = String(text || '').trim();
    if (!trimmed || busy) return;
    appendUserBubble(trimmed);
    var wrap = $('macAgentExamples');
    if (wrap) {
      wrap.classList.add('d-none');
      wrap.innerHTML = '';
    }
    await sendTurn(trimmed);
  }

  function newConversation() {
    transcript = [];
    conversationGuid = null;
    pendingText = '';
    spendUsd = 0;
    updateSpend();
    var thread = $('macAgentThread');
    if (thread) thread.innerHTML = '';
    renderExamples();
    refreshContext();
  }

  function applyRailWidth(px) {
    var w = Math.max(RAIL_MIN_W, Math.min(RAIL_MAX_W, Math.round(px)));
    document.documentElement.style.setProperty('--mac-agent-rail-w', w + 'px');
    try {
      localStorage.setItem(RAIL_PREF_KEY, String(w));
    } catch (e) { /* ignore */ }
    return w;
  }

  function restoreRailWidth() {
    try {
      var raw = localStorage.getItem(RAIL_PREF_KEY);
      var n = raw ? parseInt(raw, 10) : NaN;
      if (!isNaN(n)) applyRailWidth(n);
    } catch (e) { /* ignore */ }
  }

  function bindResize() {
    var handle = $('macAgentResize');
    var rail = $('macAgentRail');
    if (!handle || !rail) return;

    var dragging = false;
    var startX = 0;
    var startW = 0;

    function onMove(ev) {
      if (!dragging) return;
      var clientX = ev.touches ? ev.touches[0].clientX : ev.clientX;
      applyRailWidth(startW + (startX - clientX));
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('mac-agent-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    }

    handle.addEventListener('mousedown', function (ev) {
      dragging = true;
      startX = ev.clientX;
      startW = rail.getBoundingClientRect().width;
      document.body.classList.add('mac-agent-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      ev.preventDefault();
    });
    handle.addEventListener(
      'touchstart',
      function (ev) {
        dragging = true;
        startX = ev.touches[0].clientX;
        startW = rail.getBoundingClientRect().width;
        document.body.classList.add('mac-agent-resizing');
        document.addEventListener('touchmove', onMove, { passive: false });
        document.addEventListener('touchend', onUp);
      },
      { passive: true }
    );

    handle.addEventListener('keydown', function (ev) {
      var cur = rail.getBoundingClientRect().width;
      if (ev.key === 'ArrowLeft') {
        applyRailWidth(cur + RAIL_STEP_W);
        ev.preventDefault();
      } else if (ev.key === 'ArrowRight') {
        applyRailWidth(cur - RAIL_STEP_W);
        ev.preventDefault();
      }
    });
  }

  function open() {
    var rail = $('macAgentRail');
    var fab = $('macAgentFab');
    if (!rail) return;
    rail.classList.add('mac-agent-open');
    rail.setAttribute('aria-hidden', 'false');
    if (fab) fab.classList.add('mac-agent-fab-hidden');
    try {
      if (typeof global.MacMascot !== 'undefined' && global.MacMascot.stop) {
        global.MacMascot.stop();
      }
    } catch (e) { /* ignore */ }
    refreshContext();
    queueMicrotask(function () {
      if ($('macAgentInput')) $('macAgentInput').focus();
    });
  }

  function close() {
    var rail = $('macAgentRail');
    var fab = $('macAgentFab');
    if (!rail) return;
    rail.classList.remove('mac-agent-open');
    rail.setAttribute('aria-hidden', 'true');
    if (fab) fab.classList.remove('mac-agent-fab-hidden');
    try {
      if (typeof global.MacMascot !== 'undefined' && global.MacMascot.start) {
        global.MacMascot.start();
      }
    } catch (e) { /* ignore */ }
  }

  function toggle() {
    var rail = $('macAgentRail');
    if (rail && rail.classList.contains('mac-agent-open')) close();
    else open();
  }

  function onComposerInput() {
    var input = $('macAgentInput');
    var send = $('macAgentSend');
    if (send && input) send.disabled = busy || !input.value.trim();
  }

  function onComposerSubmit(ev) {
    ev.preventDefault();
    var input = $('macAgentInput');
    if (!input) return;
    var text = input.value;
    input.value = '';
    onComposerInput();
    sendMessage(text);
  }

  function onKeydown(ev) {
    if (ev.key === 'Escape') {
      var rail = $('macAgentRail');
      if (rail && rail.classList.contains('mac-agent-open')) {
        close();
        ev.preventDefault();
      }
    }
  }

  function init() {
    if (inited) return;
    if (!$('macAgentRail') || !$('macAgentFab')) return;
    inited = true;
    restoreRailWidth();
    bindResize();

    if ($('macAgentFab')) $('macAgentFab').addEventListener('click', open);
    if ($('macAgentCloseBtn')) $('macAgentCloseBtn').addEventListener('click', close);
    if ($('macAgentThread')) $('macAgentThread').addEventListener('click', onThreadClick);
    if ($('macAgentExamples')) $('macAgentExamples').addEventListener('click', onExamplesClick);
    if ($('macAgentComposer')) $('macAgentComposer').addEventListener('submit', onComposerSubmit);
    if ($('macAgentInput')) {
      $('macAgentInput').addEventListener('input', onComposerInput);
      $('macAgentInput').addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' && !ev.shiftKey) {
          ev.preventDefault();
          onComposerSubmit(ev);
        }
      });
    }
    document.addEventListener('keydown', onKeydown);

    renderExamples();
    refreshContext();
    onComposerInput();
  }

  global.MacAssistant = {
    init: init,
    open: open,
    close: close,
    toggle: toggle,
    sendMessage: sendMessage,
    newConversation: newConversation,
    onContextChange: refreshContext
  };
})(typeof window !== 'undefined' ? window : globalThis);
