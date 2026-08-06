/**
 * Idle Mac — orchard-themed ambient mascot overlay.
 * Styles: glide, peek, drive (tractor + cart), parachute (leaf canopy), bubbles (oil/cream).
 * Prefs: mac_mascot_prefs — enabled defaults to false.
 */
(function (global) {
  'use strict';

  var FACE = 'img/mac.svg';
  var TRACTOR = 'img/tractor.png';
  var SVG = {
    glide: FACE,
    peek: FACE,
    drive: FACE,
    parachute: FACE,
    bubbles: FACE
  };
  var DURATION = { glide: 7000, peek: 5600, drive: 6500, parachute: 6500, bubbles: 7800 };
  var FLEE_MS = 260;
  var PREFS_KEY = 'mac_mascot_prefs';
  var DEFAULTS = {
    enabled: false,
    idleSeconds: 90,
    intervalSeconds: 60,
    preferredStyle: 'random'
  };
  var FREQ_TO_INTERVAL = { often: 30, sometimes: 60, rarely: 180 };
  var SETTINGS_MODAL_ID = 'idle-mac-settings-modal';
  var ACTIVITY_EVENTS = [
    'mousemove',
    'keydown',
    'mousedown',
    'click',
    'touchstart',
    'scroll',
    'wheel'
  ];
  var ACTIVITY_THROTTLE_MS = 250;
  var STYLES = ['glide', 'peek', 'drive', 'parachute', 'bubbles'];
  var BUBBLE_COUNT_MIN = 4;
  var BUBBLE_COUNT_MAX = 6;

  var _prefs = clonePrefs(DEFAULTS);
  var _started = false;
  var _animating = false;
  var _fleeing = false;
  var _preloaded = false;
  var _idleTimer = null;
  var _safetyTimer = null;
  var _lastShown = 0;
  var _lastActivityAt = 0;
  var _layer = null;
  var _onActivityBound = null;
  var _onVisBound = null;

  function normalizeStyle(value) {
    var v = String(value || '').toLowerCase();
    if (v === 'random' || !v) return 'random';
    return STYLES.indexOf(v) >= 0 ? v : 'random';
  }

  function clonePrefs(p) {
    return {
      enabled: !!p.enabled,
      idleSeconds: p.idleSeconds,
      intervalSeconds: p.intervalSeconds,
      preferredStyle: normalizeStyle(p && p.preferredStyle)
    };
  }

  function clampTiming(n, fallback) {
    var v = parseInt(n, 10);
    if (Number.isNaN(v)) v = fallback;
    if (v < 30) v = 30;
    if (v > 600) v = 600;
    return v;
  }

  function clampIdle(n) {
    return clampTiming(n, DEFAULTS.idleSeconds);
  }

  function clampInterval(n) {
    return clampTiming(n, DEFAULTS.intervalSeconds);
  }

  function loadPrefs() {
    var out = clonePrefs(DEFAULTS);
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && typeof p === 'object') {
          if (typeof p.enabled === 'boolean') out.enabled = p.enabled;
          out.idleSeconds = clampIdle(p.idleSeconds);
          if (p.intervalSeconds != null) {
            out.intervalSeconds = clampInterval(p.intervalSeconds);
          } else if (FREQ_TO_INTERVAL[p.frequency]) {
            out.intervalSeconds = FREQ_TO_INTERVAL[p.frequency];
          } else {
            out.intervalSeconds = DEFAULTS.intervalSeconds;
          }
          if (p.preferredStyle != null) {
            out.preferredStyle = normalizeStyle(p.preferredStyle);
          }
        }
      }
    } catch (e) {
      /* defaults */
    }
    out.idleSeconds = clampIdle(out.idleSeconds);
    out.intervalSeconds = clampInterval(out.intervalSeconds);
    out.preferredStyle = normalizeStyle(out.preferredStyle);
    return out;
  }

  function savePrefs(p) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(clonePrefs(p)));
    } catch (e) {
      /* ignore */
    }
  }

  function cooldownMs() {
    return clampInterval(_prefs.intervalSeconds) * 1000;
  }

  function prefersReducedMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {
      return false;
    }
  }

  function modalOpen() {
    try {
      return !!document.querySelector('.modal.show, .offcanvas.show');
    } catch (e) {
      return false;
    }
  }

  function railOpen() {
    try {
      return !!document.querySelector('#macAgentRail.mac-agent-open');
    } catch (e) {
      return false;
    }
  }

  function authed() {
    try {
      if (typeof authService !== 'undefined' && authService.isAuthenticated) {
        return !!authService.isAuthenticated();
      }
      if (typeof Session !== 'undefined' && Session.get) {
        return !!(Session.get('token') && Session.get('user'));
      }
    } catch (e) {
      /* fall through */
    }
    return false;
  }

  function canPlay() {
    if (!_prefs.enabled) return false;
    if (_animating) return false;
    if (!authed()) return false;
    if (document.hidden) return false;
    if (prefersReducedMotion()) return false;
    if (modalOpen()) return false;
    if (railOpen()) return false;
    if (Date.now() - _lastShown < cooldownMs()) return false;
    return true;
  }

  function pickStyle() {
    var preferred = normalizeStyle(_prefs.preferredStyle);
    if (preferred !== 'random') return preferred;
    return STYLES[Math.floor(Math.random() * STYLES.length)];
  }

  function moverTopFor(style) {
    var h = window.innerHeight || 700;
    if (style === 'glide') return Math.round(h * (0.12 + Math.random() * 0.16));
    return Math.round(h * (0.45 + Math.random() * 0.15));
  }

  function preload() {
    if (_preloaded) return;
    _preloaded = true;
    Object.keys(SVG).forEach(function (k) {
      var im = new Image();
      im.src = SVG[k];
    });
    var tractorImg = new Image();
    tractorImg.src = TRACTOR;
  }

  function createShellLayer(opts, flipOpts) {
    opts = opts || {};
    flipOpts = flipOpts || {};
    var flip = !!flipOpts.flip;
    var layer = document.createElement('div');
    layer.className =
      'macm-layer' +
      (flip ? ' macm-layer--flip' : '') +
      (railOpen() ? ' macm-layer--rail-open' : '') +
      (opts.aboveModals ? ' macm-layer--above-modal' : '');
    layer.setAttribute('aria-hidden', 'true');

    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'macm-dismiss';
    dismiss.setAttribute('aria-label', 'Turn off Idle Mac');
    dismiss.title = 'Turn off Idle Mac';
    dismiss.textContent = 'Turn off';
    dismiss.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dismissIdle();
    });
    layer.appendChild(dismiss);
    return layer;
  }

  function appendBubbles(layer) {
    var span = BUBBLE_COUNT_MAX - BUBBLE_COUNT_MIN + 1;
    var count = BUBBLE_COUNT_MIN + Math.floor(Math.random() * span);
    var macIndex = Math.floor(Math.random() * count);
    var movers = [];
    for (var i = 0; i < count; i++) {
      var size = 48 + Math.floor(Math.random() * 40);
      var sway = (18 + Math.random() * 42) * (Math.random() < 0.5 ? -1 : 1);
      var dur = 5.2 + Math.random() * 1.8;
      var delay = i * 0.32 + Math.random() * 0.28;

      var mover = document.createElement('div');
      mover.className = 'macm-mover macm-mover--bubbles';
      mover.style.width = size + 'px';
      mover.style.height = size + 'px';
      mover.style.left = Math.round(6 + Math.random() * 82) + '%';
      mover.style.setProperty('--macm-dur', dur.toFixed(2) + 's');
      mover.style.setProperty('--macm-delay', delay.toFixed(2) + 's');
      mover.style.setProperty('--macm-sway', sway.toFixed(0) + 'px');

      var bob = document.createElement('div');
      bob.className = 'macm-bob macm-bob--bubble';
      if (i === macIndex) {
        var img = document.createElement('img');
        img.className = 'macm-face';
        img.src = SVG.bubbles;
        img.alt = '';
        bob.appendChild(img);
      }
      mover.appendChild(bob);
      layer.appendChild(mover);
      movers.push(mover);
    }
    return movers;
  }

  function appendDriveTractor(mover) {
    var bob = document.createElement('div');
    bob.className = 'macm-bob macm-bob--drive';

    var convoy = document.createElement('div');
    convoy.className = 'macm-convoy';

    var cart = document.createElement('div');
    cart.className = 'macm-cart';
    cart.setAttribute('aria-hidden', 'true');
    cart.innerHTML =
      '<span class="macm-cart-bed"></span>' +
      '<span class="macm-cart-rail macm-cart-rail--back"></span>' +
      '<span class="macm-cart-rail macm-cart-rail--front"></span>' +
      '<span class="macm-cart-hitch"></span>' +
      '<span class="macm-cart-wheel"></span>';

    var mac = document.createElement('img');
    mac.className = 'macm-face macm-face--passenger';
    mac.src = SVG.drive;
    mac.alt = '';
    cart.appendChild(mac);

    var tractor = document.createElement('div');
    tractor.className = 'macm-tractor';

    var tractorImg = document.createElement('img');
    tractorImg.className = 'macm-tractor-sprite';
    tractorImg.src = TRACTOR;
    tractorImg.alt = '';
    tractor.appendChild(tractorImg);

    convoy.appendChild(cart);
    convoy.appendChild(tractor);
    bob.appendChild(convoy);
    mover.appendChild(bob);
  }

  function appendParachute(mover) {
    var bob = document.createElement('div');
    bob.className = 'macm-bob macm-bob--parachute';

    var rig = document.createElement('div');
    rig.className = 'macm-parachute-rig';

    var canopy = document.createElement('div');
    canopy.className = 'macm-parachute-canopy';
    canopy.setAttribute('aria-hidden', 'true');
    canopy.innerHTML =
      '<span class="macm-leaf macm-leaf--a"></span>' +
      '<span class="macm-leaf macm-leaf--b"></span>' +
      '<span class="macm-leaf macm-leaf--c"></span>';

    var strings = document.createElement('div');
    strings.className = 'macm-parachute-strings';
    strings.setAttribute('aria-hidden', 'true');
    strings.innerHTML =
      '<span class="macm-parachute-string macm-parachute-string--left"></span>' +
      '<span class="macm-parachute-string macm-parachute-string--right"></span>';

    var img = document.createElement('img');
    img.className = 'macm-face macm-face--parachute';
    img.src = SVG.parachute;
    img.alt = '';

    rig.appendChild(canopy);
    rig.appendChild(strings);
    rig.appendChild(img);
    bob.appendChild(rig);
    mover.appendChild(bob);
  }

  function appendPeek(mover) {
    var bob = document.createElement('div');
    bob.className = 'macm-bob macm-bob--peek';

    var img = document.createElement('img');
    img.className = 'macm-face';
    img.src = SVG.peek;
    img.alt = '';

    bob.appendChild(img);
    mover.appendChild(bob);
  }

  function buildLayer(style, opts) {
    opts = opts || {};
    if (style === 'bubbles') {
      var bubbleLayer = createShellLayer(opts);
      var movers = appendBubbles(bubbleLayer);
      return { layer: bubbleLayer, mover: movers[0] || null, movers: movers, style: style };
    }

    var flip = style === 'glide' && Math.random() < 0.5;
    var layer = createShellLayer(opts, { flip: flip });

    var mover = document.createElement('div');
    mover.className = 'macm-mover macm-mover--' + style;

    if (style === 'peek' || style === 'parachute') {
      mover.style.left = Math.round(15 + Math.random() * 70) + '%';
    } else if (style === 'glide') {
      mover.style.top = moverTopFor(style) + 'px';
    }

    if (style === 'drive') {
      appendDriveTractor(mover);
    } else if (style === 'parachute') {
      appendParachute(mover);
    } else if (style === 'peek') {
      appendPeek(mover);
    } else {
      var bob = document.createElement('div');
      bob.className = 'macm-bob';
      var img = document.createElement('img');
      img.className = 'macm-face';
      img.src = SVG[style] || SVG.glide;
      img.alt = '';
      bob.appendChild(img);
      mover.appendChild(bob);
    }

    layer.appendChild(mover);
    return { layer: layer, mover: mover, movers: [mover], style: style };
  }

  function show(style, opts) {
    opts = opts || {};
    if (_animating) return;
    if (STYLES.indexOf(style) < 0) style = pickStyle();
    _animating = true;
    _lastShown = Date.now();

    var built = buildLayer(style, opts);
    _layer = built.layer;
    document.body.appendChild(_layer);

    if (style === 'bubbles') {
      var movers = built.movers || [];
      var ended = 0;
      movers.forEach(function (m) {
        m.addEventListener('animationend', function (e) {
          if (e.target !== m) return;
          ended += 1;
          if (ended >= movers.length) hide();
        });
      });
    } else {
      built.mover.addEventListener('animationend', function (e) {
        if (e.target === built.mover) hide();
      });
    }

    clearTimeout(_safetyTimer);
    _safetyTimer = setTimeout(hide, (DURATION[style] || 7000) + 600);
  }

  function hide() {
    clearTimeout(_safetyTimer);
    _safetyTimer = null;
    if (_layer && _layer.parentNode) _layer.parentNode.removeChild(_layer);
    _layer = null;
    _animating = false;
    _fleeing = false;
    resetIdle();
  }

  function flee() {
    if (!_layer) {
      hide();
      return;
    }
    if (_fleeing) return;
    _fleeing = true;
    _layer.classList.add('macm-layer--flee');
    clearTimeout(_safetyTimer);
    _safetyTimer = setTimeout(hide, FLEE_MS);
  }

  function onIdle() {
    if (canPlay()) {
      show(pickStyle());
    } else if (_started && _prefs.enabled) {
      clearTimeout(_idleTimer);
      _idleTimer = setTimeout(onIdle, 4000);
    }
  }

  function resetIdle() {
    clearTimeout(_idleTimer);
    if (!_started || !_prefs.enabled) return;
    _idleTimer = setTimeout(onIdle, _prefs.idleSeconds * 1000);
  }

  function onActivity() {
    var now = Date.now();
    if (now - _lastActivityAt < ACTIVITY_THROTTLE_MS) return;
    _lastActivityAt = now;
    if (_animating) flee();
    else resetIdle();
  }

  function onVisibility() {
    if (document.hidden) {
      clearTimeout(_idleTimer);
      if (_animating) hide();
    } else {
      resetIdle();
    }
  }

  function attach() {
    _onActivityBound = onActivity;
    _onVisBound = onVisibility;
    ACTIVITY_EVENTS.forEach(function (ev) {
      window.addEventListener(ev, _onActivityBound, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', _onVisBound);
  }

  function detach() {
    if (_onActivityBound) {
      ACTIVITY_EVENTS.forEach(function (ev) {
        window.removeEventListener(ev, _onActivityBound, { capture: true });
      });
    }
    if (_onVisBound) document.removeEventListener('visibilitychange', _onVisBound);
    _onActivityBound = null;
    _onVisBound = null;
  }

  function start() {
    if (_started) return;
    _prefs = loadPrefs();
    _started = true;
    _lastActivityAt = Date.now();
    preload();
    attach();
    resetIdle();
  }

  function stop() {
    if (!_started) return;
    _started = false;
    clearTimeout(_idleTimer);
    _idleTimer = null;
    detach();
    if (_layer) {
      clearTimeout(_safetyTimer);
      if (_layer.parentNode) _layer.parentNode.removeChild(_layer);
      _layer = null;
    }
    _animating = false;
    _fleeing = false;
    _lastShown = 0;
  }

  function reloadPrefs() {
    _prefs = loadPrefs();
    if (_started) {
      _lastShown = 0;
      resetIdle();
    } else if (_prefs.enabled) {
      start();
    }
  }

  function setEnabled(on) {
    var next = clonePrefs(loadPrefs());
    next.enabled = !!on;
    savePrefs(next);
    _prefs = next;
    if (next.enabled) {
      if (!_started) start();
      else {
        _lastShown = 0;
        resetIdle();
      }
    } else {
      clearTimeout(_idleTimer);
      _idleTimer = null;
      if (_animating || _layer) hide();
    }
  }

  function dismissIdle() {
    setEnabled(false);
  }

  function previewNow(style) {
    if (prefersReducedMotion()) return;
    if (_animating) {
      clearTimeout(_safetyTimer);
      if (_layer && _layer.parentNode) _layer.parentNode.removeChild(_layer);
      _layer = null;
      _animating = false;
      _fleeing = false;
    }
    clearTimeout(_idleTimer);
    if (!_started) {
      _prefs = loadPrefs();
      _started = true;
      preload();
      attach();
    }
    var forced = STYLES.indexOf(style) >= 0 ? style : pickStyle();
    show(forced, { aboveModals: true });
  }

  function closeProfileDropdown() {
    var toggle = document.querySelector('.sidebar-profile-toggle');
    if (!toggle || !window.bootstrap || !window.bootstrap.Dropdown) return;
    try {
      window.bootstrap.Dropdown.getOrCreateInstance(toggle).hide();
    } catch (e) {
      /* ignore */
    }
  }

  function syncSettingsModalFields() {
    var p = loadPrefs();
    var enabledEl = document.getElementById('macm-settings-enabled');
    var idleEl = document.getElementById('macm-settings-idle');
    var intervalEl = document.getElementById('macm-settings-interval');
    var styleEl = document.getElementById('macm-settings-style');
    if (enabledEl) enabledEl.checked = !!p.enabled;
    if (idleEl) idleEl.value = String(p.idleSeconds);
    if (intervalEl) intervalEl.value = String(p.intervalSeconds);
    if (styleEl) styleEl.value = normalizeStyle(p.preferredStyle);
  }

  function openSettingsModal() {
    var el = document.getElementById(SETTINGS_MODAL_ID);
    if (!el || !window.bootstrap || !window.bootstrap.Modal) return;
    closeProfileDropdown();
    syncSettingsModalFields();
    var statusEl = document.getElementById('macm-settings-status');
    if (statusEl) statusEl.textContent = '';
    window.bootstrap.Modal.getOrCreateInstance(el).show();
  }

  function saveFromSettingsModal() {
    var enabledEl = document.getElementById('macm-settings-enabled');
    var idleEl = document.getElementById('macm-settings-idle');
    var intervalEl = document.getElementById('macm-settings-interval');
    var styleEl = document.getElementById('macm-settings-style');
    var statusEl = document.getElementById('macm-settings-status');
    var next = {
      enabled: !!(enabledEl && enabledEl.checked),
      idleSeconds: clampIdle(idleEl ? idleEl.value : DEFAULTS.idleSeconds),
      intervalSeconds: clampInterval(intervalEl ? intervalEl.value : DEFAULTS.intervalSeconds),
      preferredStyle: normalizeStyle(styleEl ? styleEl.value : DEFAULTS.preferredStyle)
    };
    if (idleEl) idleEl.value = String(next.idleSeconds);
    if (intervalEl) intervalEl.value = String(next.intervalSeconds);
    if (styleEl) styleEl.value = next.preferredStyle;
    savePrefs(next);
    setEnabled(next.enabled);
    reloadPrefs();
    if (statusEl) {
      statusEl.textContent = next.enabled
        ? 'Saved. Idle Mac is on.'
        : 'Saved. Idle Mac is off.';
    }
  }

  function previewFromSettingsModal() {
    var styleEl = document.getElementById('macm-settings-style');
    var statusEl = document.getElementById('macm-settings-status');
    var style = normalizeStyle(styleEl ? styleEl.value : 'random');
    if (prefersReducedMotion()) {
      if (statusEl) statusEl.textContent = 'Preview blocked: reduced motion is enabled.';
      return;
    }
    previewNow(style === 'random' ? null : style);
    if (statusEl) statusEl.textContent = 'Preview playing…';
  }

  var _settingsWired = false;

  function initSettingsUI() {
    if (_settingsWired) return;
    var openBtn = document.getElementById('userDropdownIdleMac');
    var saveBtn = document.getElementById('macm-settings-save');
    var previewBtn = document.getElementById('macm-settings-preview');
    if (!document.getElementById(SETTINGS_MODAL_ID)) return;
    _settingsWired = true;

    if (openBtn) {
      openBtn.addEventListener('click', function (e) {
        e.preventDefault();
        openSettingsModal();
      });
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', function (e) {
        e.preventDefault();
        saveFromSettingsModal();
      });
    }
    if (previewBtn) {
      previewBtn.addEventListener('click', function (e) {
        e.preventDefault();
        previewFromSettingsModal();
      });
    }
    syncSettingsModalFields();
  }

  global.MacMascot = {
    start: start,
    stop: stop,
    reloadPrefs: reloadPrefs,
    previewNow: previewNow,
    getPrefs: function () {
      return clonePrefs(_prefs.enabled != null ? _prefs : loadPrefs());
    },
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    setEnabled: setEnabled,
    dismissIdle: dismissIdle,
    clampIdle: clampIdle,
    clampInterval: clampInterval,
    openSettingsModal: openSettingsModal,
    initSettingsUI: initSettingsUI,
    DEFAULTS: DEFAULTS,
    PREFS_KEY: PREFS_KEY,
    STYLES: STYLES,
    SETTINGS_MODAL_ID: SETTINGS_MODAL_ID
  };
})(typeof window !== 'undefined' ? window : globalThis);
