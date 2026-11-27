/**
 * Macavation Theme System — MacView's look (Mike's prototype, 27 Nov 2026).
 *
 * A person's look = { mode: 'dark'|'light'|'auto', theme: <palette key>, bg: <pattern key>,
 * accent: '' | '#rrggbb', seed: <contour shape> }, kept in localStorage (MAC_THEME_KEY).
 * Default for everyone is Mike's: Macavation Noir, dark, Contour lines.
 *
 * How it paints:
 *   - <html data-mac-theme="macnoir" data-mac-mode="dark"> selects a generated token block in
 *     css/design-tokens.css (palettes live in js/mac-theme-palettes.js).
 *   - data-theme-mode="dark" (the portal's older dark switch, used by many stylesheets) and
 *     data-bs-theme="dark" (Bootstrap 5.3's own dark mode) are set alongside it.
 *   - A custom accent colour is written as inline token overrides on <html>.
 *   - The background pattern is a fixed layer (#macBgfx) behind the page.
 *
 * Kept from the old light/dark switch: init, toggleDarkMode, isDarkMode, getCurrentTheme,
 * getTheme, getAllThemes, applyTheme, setupThemeSelector, updateThemeSelectorUI.
 */
var ThemeManager = (function () {
    'use strict';

    var P = window.MacThemePalettes;
    var MAC_THEME_KEY = 'mac-theme-v2';
    var D3_URL = 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js';
    var root = document.documentElement;
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    var state = load();
    var inlineTokens = [];   // custom-accent overrides currently written on <html>
    var drawnContourKey = '';
    var listeners = [];

    function clean(t) {
        var o = Object.assign({}, P.THEME_DEF, t || {});
        if (!P.THEMES[o.theme]) o.theme = P.THEME_DEF.theme;
        if (!P.BGS[o.bg]) o.bg = P.THEME_DEF.bg;
        if (['light', 'dark', 'auto'].indexOf(o.mode) === -1) o.mode = P.THEME_DEF.mode;
        if (o.accent && !/^#[0-9a-f]{6}$/i.test(o.accent)) o.accent = '';
        o.seed = (parseInt(o.seed, 10) || P.THEME_DEF.seed) >>> 0;
        return o;
    }

    function load() {
        try { return clean(JSON.parse(localStorage.getItem(MAC_THEME_KEY) || 'null')); }
        catch (e) { return clean(null); }
    }

    function save() {
        try { localStorage.setItem(MAC_THEME_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
    }

    function isDark() {
        return state.mode === 'dark' || (state.mode === 'auto' && !!(mq && mq.matches));
    }

    /* ---------- painting ---------- */

    function paintTokens() {
        var dark = isDark();
        root.setAttribute('data-theme', 'macavation');
        root.setAttribute('data-mac-theme', state.theme);
        root.setAttribute('data-mac-mode', dark ? 'dark' : 'light');
        root.setAttribute('data-mac-bg', state.bg);
        root.setAttribute('data-bs-theme', dark ? 'dark' : 'light');
        if (dark) root.setAttribute('data-theme-mode', 'dark');
        else root.removeAttribute('data-theme-mode');
        root.style.colorScheme = dark ? 'dark' : 'light';

        inlineTokens.forEach(function (k) { root.style.removeProperty(k); });
        inlineTokens = [];
        if (state.accent) {
            var t = P.tokens(P.palette(state.theme, dark, state.accent));
            Object.keys(t).forEach(function (k) { root.style.setProperty(k, t[k]); inlineTokens.push(k); });
        }

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', P.palette(state.theme, dark, state.accent).side);
    }

    var svgUrl = function (s) { return 'url("data:image/svg+xml,' + encodeURIComponent(s) + '")'; };
    function ripplesSvg() {
        var c = '';
        for (var i = 0; i < 34; i++) c += "<circle cx='1600' cy='0' r='" + (46 * (i + 1)) + "'/>";
        return "<svg xmlns='http://www.w3.org/2000/svg' width='1600' height='1600'><g fill='none' stroke='black' stroke-width='1.1'>" + c + '</g></svg>';
    }
    var MASKS = {
        waves: [svgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='80' height='26'><path d='M0 13 Q20 1 40 13 T80 13' fill='none' stroke='black' stroke-width='1.2'/></svg>"), '0 0/80px 26px repeat'],
        hex: [svgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='38.105' height='66'><path d='M19.053 0 L38.105 11 L38.105 33 L19.053 44 L0 33 L0 11 Z M19.053 44 L19.053 66' fill='none' stroke='black' stroke-width='1.1' stroke-linejoin='round'/></svg>"), '0 0/38.105px 66px repeat'],
        nuts: [svgUrl("<svg xmlns='http://www.w3.org/2000/svg' width='72' height='72'><circle cx='18' cy='18' r='7' fill='none' stroke='black' stroke-width='1.2'/><circle cx='21' cy='15' r='1.4' fill='black'/><circle cx='52' cy='52' r='5' fill='none' stroke='black' stroke-width='1.2'/><circle cx='54' cy='50' r='1' fill='black'/><path d='M44 16 q7 -7 14 0 q-7 7 -14 0z' fill='none' stroke='black' stroke-width='1.1'/></svg>"), '0 0/72px 72px repeat'],
        ripples: [svgUrl(ripplesSvg()), '100% 0/1600px 1600px no-repeat']
    };

    function bgLayer() {
        var el = document.getElementById('macBgfx');
        if (!el && document.body) {
            el = document.createElement('div');
            el.id = 'macBgfx';
            el.className = 'mac-bgfx';
            el.setAttribute('aria-hidden', 'true');
            document.body.insertBefore(el, document.body.firstChild);
        }
        return el;
    }

    var d3Loading = null;
    function withD3(cb) {
        if (window.d3 && window.d3.contours) return cb();
        if (!d3Loading) {
            d3Loading = new Promise(function (resolve, reject) {
                var s = document.createElement('script');
                s.src = D3_URL;
                s.onload = resolve;
                s.onerror = reject;
                document.head.appendChild(s);
            });
        }
        d3Loading.then(cb, function () { /* offline: stay plain */ });
    }

    /** MacView's contour lines: smooth hills from a seeded random field, drawn with d3.contours. */
    function drawContours(el) {
        withD3(function () {
            if (state.bg !== 'contours') return;
            var d3 = window.d3;
            var W = Math.max(320, window.innerWidth), H = Math.max(400, window.innerHeight);
            var a = state.seed >>> 0;
            var rnd = function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
            var gw = 150, gh = Math.max(40, Math.round(150 * H / W));
            var bumps = d3.range(11).map(function () { return { x: rnd() * gw, y: rnd() * gh, s: (8 + rnd() * 22) * gw / 96, h: (rnd() < 0.3 ? -1 : 1) * (0.5 + rnd()) }; });
            var vals = new Float64Array(gw * gh);
            for (var j = 0; j < gh; j++) {
                for (var i = 0; i < gw; i++) {
                    var v = 0;
                    for (var k = 0; k < bumps.length; k++) { var b = bumps[k], dx = i - b.x, dy = j - b.y; v += b.h * Math.exp(-(dx * dx + dy * dy) / (2 * b.s * b.s)); }
                    vals[j * gw + i] = v;
                }
            }
            var contours = d3.contours().size([gw, gh]).thresholds(18)(vals);
            var sm = d3.line().curve(d3.curveBasisClosed);
            var pathOf = function (c) { return c.coordinates.map(function (poly) { return poly.map(function (ring) { return sm(ring.slice(0, -1)) || ''; }).join(''); }).join(''); };
            el.innerHTML = '';
            var svg = d3.select(el).append('svg').attr('viewBox', '0 0 ' + gw + ' ' + gh).attr('preserveAspectRatio', 'none');
            svg.selectAll('path').data(contours).join('path').attr('d', pathOf).attr('vector-effect', 'non-scaling-stroke');
            drawnContourKey = state.seed + ':' + gw + 'x' + gh;
        });
    }

    function paintBackground(force) {
        var el = bgLayer();
        if (!el) return;
        var k = state.bg;
        if (k === 'contours') {
            var gh = Math.max(40, Math.round(150 * Math.max(400, window.innerHeight) / Math.max(320, window.innerWidth)));
            if (!force && el.querySelector('svg') && drawnContourKey === state.seed + ':150x' + gh) return;
            el.style.background = '';
            drawContours(el);
            return;
        }
        drawnContourKey = '';
        el.innerHTML = '';
        el.style.background = '';
        if (MASKS[k]) {
            var d = document.createElement('div');
            d.className = 'mac-bgfx-mask';
            var m = MASKS[k][0] + ' ' + MASKS[k][1];
            d.style.setProperty('-webkit-mask', m);
            d.style.setProperty('mask', m);
            el.appendChild(d);
        } else if (k === 'soft') {
            el.style.background = 'radial-gradient(120% 70% at 50% 0%, rgba(var(--mac-green-rgb), .08), transparent 65%), radial-gradient(160% 60% at 50% 110%, rgba(0,0,0,' + (isDark() ? '.22' : '.04') + '), transparent 70%)';
        } else if (k === 'aurora') {
            el.style.background = 'radial-gradient(60% 45% at 12% 8%, rgba(var(--mac-green-rgb), .2), transparent 70%), radial-gradient(50% 40% at 88% 25%, rgba(var(--mac-accent2-rgb), .14), transparent 70%), radial-gradient(60% 50% at 50% 100%, rgba(var(--mac-green-rgb), .12), transparent 70%)';
        } else if (k === 'dots') {
            el.style.background = 'radial-gradient(var(--mac-line-contour) 1.4px, transparent 1.6px) 0 0/18px 18px';
        }
    }

    function updateModeButtons() {
        var dark = isDark();
        // Older single toggle (kept so nothing breaks if a page still has it)
        var btn = document.getElementById('darkModeToggle');
        if (btn) {
            var icon = btn.querySelector('i');
            var label = btn.querySelector('.toggle-text');
            if (icon && !btn.classList.contains('mac-mode-btn')) icon.className = dark ? 'fas fa-sun me-2' : 'fas fa-moon me-2';
            if (label) label.textContent = dark ? 'Light mode' : 'Dark mode';
            btn.setAttribute('title', dark ? 'Switch to light mode' : 'Switch to dark mode');
            btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
            btn.setAttribute('data-mode', dark ? 'dark' : 'light');
        }
    }

    function apply(opts) {
        paintTokens();
        if (document.body) paintBackground(opts && opts.redraw);
        updateModeButtons();
        save();
        listeners.forEach(function (fn) { try { fn(getState()); } catch (e) { console.error(e); } });
        try { document.dispatchEvent(new CustomEvent('mac-theme-change', { detail: getState() })); } catch (e) { /* old browser */ }
    }

    function getState() { return Object.assign({ isDark: isDark() }, state); }

    function set(patch) {
        var redraw = patch && ('seed' in patch);
        state = clean(Object.assign({}, state, patch || {}));
        apply({ redraw: redraw });
    }

    /** Chart colours from the current palette (MacView chartColors). */
    function chartColors() {
        var dark = isDark(), p = P.palette(state.theme, dark, state.accent);
        return {
            brown: p.brand, green: p.good, sand: p.brand2, sand2: P.hexA(p.brand, dark ? 0.5 : 0.45), slate: '#5b7083', red: p.bad,
            series: [p.brand, p.brand2, p.good, p.info, p.warn, p.bad, '#5b7083', P.hexA(p.brand, 0.5)],
            grid: dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.07)', text: p.muted, ink: p.ink, tip: dark ? '#000000' : '#1f1d1b'
        };
    }

    // Paint the colours straight away (this file loads in <head>) so the page never flashes white.
    paintTokens();

    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (state.mode === 'auto') apply(); });
    var rzT = null;
    window.addEventListener('resize', function () {
        if (state.bg !== 'contours') return;
        clearTimeout(rzT);
        rzT = setTimeout(function () { paintBackground(false); }, 250);
    });
    // Another tab changed the look: follow it.
    window.addEventListener('storage', function (e) {
        if (e.key === MAC_THEME_KEY) { state = load(); apply({ redraw: true }); }
    });

    return {
        THEMES: P.THEMES,
        BGS: P.BGS,
        DEFAULT: P.THEME_DEF,
        init: function () {
            // Clear inline variables left by the retired pre-2026 theme picker.
            ['--theme-sidebar-bg', '--theme-sidebar-text', '--theme-sidebar-active', '--theme-sidebar-hover',
                '--theme-navbar-gradient', '--theme-accent'].forEach(function (v) { root.style.removeProperty(v); });
            try { localStorage.removeItem('mac-dark-mode'); } catch (e) { /* ignore */ }
            apply({ redraw: true });
        },
        get: getState,
        set: set,
        reset: function () { state = clean(null); apply({ redraw: true }); },
        reshuffle: function () { set({ seed: Math.floor(Math.random() * 100000) + 1 }); },
        onChange: function (fn) { if (typeof fn === 'function') listeners.push(fn); },
        chartColors: chartColors,
        palette: function () { return P.palette(state.theme, isDark(), state.accent); },

        // ---- old API, still honoured ----
        getCurrentTheme: function () { return state.theme; },
        getTheme: function () { return { name: P.THEMES[state.theme].name, isDark: isDark() }; },
        getAllThemes: function () { return P.THEMES; },
        applyTheme: function (key) { if (key && P.THEMES[key]) set({ theme: key }); },
        setupThemeSelector: function () {},
        updateThemeSelectorUI: function () { updateModeButtons(); },
        toggleDarkMode: function () { set({ mode: isDark() ? 'light' : 'dark' }); },
        isDarkMode: isDark
    };
})();

document.addEventListener('DOMContentLoaded', function () {
    ThemeManager.init();
});

window.ThemeManager = ThemeManager;
