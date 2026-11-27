/**
 * Macavation colour themes — the one source of truth for the 12 palettes.
 *
 * Copied from Mike's MacView prototype (CustomappReports/MacView-Mike-prototype-2026-11-27.html,
 * THEMES / BGS / THEME_DEF / palette()). Used two ways:
 *   1. In the browser: js/themes.js reads window.MacThemePalettes for the Design picker and for
 *      a person's own custom accent colour.
 *   2. At build time: scripts/build-theme-tokens.mjs runs palette() for every theme x mode and
 *      writes the result as CSS token blocks into css/design-tokens.css (CSS may not hold raw hex
 *      anywhere else — see scripts/verify-ui-standard.mjs).
 *
 * After changing anything here, run `node scripts/build-theme-tokens.mjs` and commit both files.
 * (`npm run theme-tokens:verify` fails when the two are out of step.)
 */
(function (root) {
    'use strict';

    var THEMES = {
        macnoir: { name: 'Macavation Noir', bg: '#1A1215', fg: '#F6EEF1', muted: '#B9A6AE', line: 'rgba(255,61,130,.18)', accent: '#FF3D82', accent2: '#D9C07A', border: 'rgba(255,61,130,.28)', good: '#7BC47F', warn: '#E8B04B', bad: '#F28B6B', on: '#1A0A10' },
        olive: { name: 'Olive Grove', bg: '#1B1D14', fg: '#F1F0E2', muted: '#B3B196', line: 'rgba(168,172,78,.20)', accent: '#A8AC4E', accent2: '#E2C46E', border: 'rgba(168,172,78,.30)', good: '#8CC47A', warn: '#E8B04B', bad: '#E5737A', on: '#17180B' },
        amethyst: { name: 'Amethyst Dusk', bg: '#1A1726', fg: '#EEEAF8', muted: '#A9A2C0', line: 'rgba(181,156,230,.20)', accent: '#B59CE6', accent2: '#F2A7C3', border: 'rgba(181,156,230,.30)', good: '#7BC47F', warn: '#E8B04B', bad: '#EF7A86', on: '#17122A' },
        ocean: { name: 'Ocean Depth', bg: '#0F1E2E', fg: '#E8F1F8', muted: '#9FB3C4', line: 'rgba(91,155,213,.22)', accent: '#5B9BD5', accent2: '#E9C46A', border: 'rgba(91,155,213,.3)', good: '#6FCF97', warn: '#F2C94C', bad: '#EB7A7A', on: '#0B1622' },
        ember: { name: 'Ember', bg: '#1F1712', fg: '#F5ECE4', muted: '#BBA898', line: 'rgba(224,138,90,.20)', accent: '#E08A5A', accent2: '#F2D59B', border: 'rgba(224,138,90,.30)', good: '#7BC47F', warn: '#E8C04B', bad: '#EF7A86', on: '#1F120A' },
        graphite: { name: 'Graphite Night', bg: '#16171A', fg: '#ECEDEF', muted: '#9CA0A8', line: 'rgba(200,205,215,.12)', accent: '#C9CDD4', accent2: '#7FB3FF', border: 'rgba(200,205,215,.18)', good: '#7BC47F', warn: '#E8B04B', bad: '#E5737A', on: '#16171A' },
        teal: { name: 'Midnight Teal', bg: '#0E1C1E', fg: '#E6F4F2', muted: '#98B3B0', line: 'rgba(60,198,183,.18)', accent: '#3CC6B7', accent2: '#F2C46B', border: 'rgba(60,198,183,.28)', good: '#7BC47F', warn: '#E8B04B', bad: '#EF7A86', on: '#06201D' },
        crimson: { name: 'Crimson Night', bg: '#1B0E11', fg: '#F6ECEE', muted: '#BFA3A8', line: 'rgba(229,72,77,.18)', accent: '#E5484D', accent2: '#E8C9A0', border: 'rgba(229,72,77,.28)', good: '#7BC47F', warn: '#E8B04B', bad: '#FF8A80', on: '#1B0607' },
        royal: { name: 'Royal Navy', bg: '#0F1328', fg: '#E9ECFA', muted: '#A1A8C8', line: 'rgba(110,139,255,.2)', accent: '#6E8BFF', accent2: '#F2C94C', border: 'rgba(110,139,255,.3)', good: '#7BC47F', warn: '#F2C94C', bad: '#EF7A86', on: '#0A0F2A' },
        copper: { name: 'Copper Slate', bg: '#16181B', fg: '#EEECEA', muted: '#A7A29C', line: 'rgba(217,142,95,.16)', accent: '#D98E5F', accent2: '#8FC1E8', border: 'rgba(217,142,95,.26)', good: '#7BC47F', warn: '#E8B04B', bad: '#EF7A86', on: '#1A0F08' },
        orchid: { name: 'Orchid Mint', bg: '#170F1D', fg: '#F3EAF8', muted: '#B4A3BF', line: 'rgba(209,107,255,.18)', accent: '#D16BFF', accent2: '#7FE0C2', border: 'rgba(209,107,255,.28)', good: '#7FE0C2', warn: '#E8C04B', bad: '#FF7A9A', on: '#1A0624' },
        mono: { name: 'Mono Pink', bg: '#111111', fg: '#F2F2F2', muted: '#A3A3A3', line: 'rgba(255,255,255,.08)', accent: '#FF3D82', accent2: '#E6E6E6', border: 'rgba(255,255,255,.14)', good: '#7BC47F', warn: '#E8B04B', bad: '#F28B6B', on: '#1A0A10' }
    };

    var BGS = { plain: 'Plain', soft: 'Soft glow', aurora: 'Aurora glow', waves: 'Waves', ripples: 'Ripples', hex: 'Honeycomb', nuts: 'Macadamias', dots: 'Dots', contours: 'Contour lines' };

    /** Mike's default — what everyone sees until they pick their own look. */
    var THEME_DEF = { mode: 'dark', theme: 'macnoir', bg: 'contours', accent: '', seed: 7 };

    /* ---------- colour helpers (same maths as MacView) ---------- */
    function hexRgb(h) { h = String(h).replace('#', ''); return [0, 2, 4].map(function (i) { return parseInt(h.slice(i, i + 2), 16); }); }
    function rgbHex(rgb) { return '#' + rgb.map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join(''); }
    function hexA(h, a) { return 'rgba(' + hexRgb(h).join(',') + ',' + a + ')'; }
    function hexMix(a, b, t) { var x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map(function (v, i) { return v + (y[i] - v) * t; })); }
    function lum(h) { var c = hexRgb(h); return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255; }
    function darkenTo(h, max) { var c = h, i = 0; while (lum(c) > max && i < 12) { c = hexMix(c, '#000000', 0.1); i++; } return c; }
    /** Parse 'rgba(r,g,b,a)' or '#rrggbb' into {rgb:[r,g,b], a}. */
    function parseColor(s) {
        s = String(s).trim();
        if (s.charAt(0) === '#') return { rgb: hexRgb(s), a: 1 };
        var m = s.match(/rgba?\(([^)]+)\)/);
        var p = m ? m[1].split(',').map(function (x) { return parseFloat(x); }) : [0, 0, 0, 1];
        return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
    }
    /** Paint a (possibly translucent) colour over a solid hex and return the solid result. */
    function over(top, baseHex) {
        var t = parseColor(top), b = hexRgb(baseHex);
        return rgbHex(t.rgb.map(function (v, i) { return v * t.a + b[i] * (1 - t.a); }));
    }
    function onColour(accentHex) { return lum(accentHex) > 0.5 ? '#14100F' : '#ffffff'; }

    /**
     * One palette as a full token set — MacView's palette(key, dark), with the translucent layers
     * also flattened to solid colours (our dropdowns, sticky headers and modals need solid fills).
     * `accentOverride` is a person's own accent colour ('' = use the theme's).
     */
    function palette(key, dark, accentOverride) {
        var t = THEMES[key] || THEMES.macnoir;
        var acc = accentOverride || t.accent;
        var onAcc = accentOverride ? onColour(acc) : t.on;
        var p;
        if (dark) {
            p = {
                mode: 'dark', bg: t.bg, panel: 'rgba(24,24,28,.72)', ink: t.fg, muted: t.muted, line: t.border, linec: t.line,
                soft: 'rgba(255,255,255,.03)', field: 'rgba(255,255,255,.04)', hover: 'rgba(255,255,255,.05)', mutebg: 'rgba(255,255,255,.08)',
                brand: acc, brand2: t.accent2, on: onAcc, side: hexMix(t.bg, '#000000', 0.35), sideInk: t.fg, sideOn: acc, sideOnInk: onAcc,
                good: t.good, warn: t.warn, bad: t.bad, info: '#8FC1E8', shadow: 'none'
            };
        } else {
            p = {
                mode: 'light', bg: hexMix('#f7f5f2', acc, 0.06), panel: 'rgba(255,255,255,.9)', ink: '#1f1d1b', muted: '#6b655f', line: hexA(acc, 0.3), linec: hexA(acc, 0.2),
                soft: hexA(acc, 0.05), field: '#ffffff', hover: hexA(acc, 0.07), mutebg: 'rgba(0,0,0,.06)',
                brand: darkenTo(acc, 0.38), brand2: darkenTo(t.accent2, 0.3), on: '#ffffff', side: hexMix(t.bg, '#000000', 0.15), sideInk: t.fg, sideOn: acc, sideOnInk: onAcc,
                good: '#2f7d3f', warn: '#8a5a00', bad: '#b4232a', info: '#2f6fa8', shadow: '0 1px 2px rgba(0,0,0,.05),0 4px 16px rgba(0,0,0,.05)'
            };
        }
        // Solid versions of the translucent layers.
        p.panelSolid = over(p.panel, p.bg);
        p.mutebgSolid = over(p.mutebg, p.panelSolid);
        p.hoverSolid = over(p.hover, p.panelSolid);
        p.softSolid = over(p.soft, p.panelSolid);
        p.lineSolid = over(p.line, p.panelSolid);
        p.lineStrong = dark ? over(p.line, over(p.line, p.panelSolid)) : over(hexA(acc, 0.45), p.panelSolid);
        p.mutedSoft = hexMix(p.muted, p.panelSolid, 0.22);
        p.brandHover = dark ? hexMix(p.brand, '#ffffff', 0.12) : hexMix(p.brand, '#000000', 0.12);
        return p;
    }

    function rgbList(hex) { return hexRgb(hex).join(', '); }

    /**
     * A palette mapped onto the portal's --mac-* tokens (plus the new MacView-only ones).
     * Everything else (Bootstrap bridge, legacy names) is derived from these in design-tokens.css.
     */
    function tokens(p) {
        var dark = p.mode === 'dark';
        return {
            '--mac-bg': p.bg,
            '--mac-bg-rgb': rgbList(p.bg),
            '--mac-bg-secondary': p.panelSolid,
            '--mac-bg-tertiary': p.mutebgSolid,
            '--mac-panel': p.panel,
            '--mac-surface-soft': p.softSolid,
            '--mac-hover': p.hover,
            '--mac-hover-solid': p.hoverSolid,
            '--mac-field': p.field,
            '--mac-border': p.line,
            '--mac-border-solid': p.lineSolid,
            '--mac-border-strong': p.lineStrong,
            '--mac-border-rgb': rgbList(p.lineSolid),
            '--mac-line-contour': p.linec,
            '--mac-text': p.ink,
            '--mac-text-rgb': rgbList(p.ink),
            '--mac-text-secondary': p.muted,
            '--mac-text-tertiary': p.mutedSoft,
            '--bs-secondary-color': p.muted,
            '--mac-green': p.brand,
            '--mac-green-rgb': rgbList(p.brand),
            '--mac-green-hover': p.brandHover,
            '--mac-green-light': hexA(p.brand, dark ? 0.15 : 0.08),
            '--mac-accent': p.brand,
            '--mac-accent2': p.brand2,
            '--mac-accent2-rgb': rgbList(p.brand2),
            '--mac-on-accent': p.on,
            '--mac-side': p.side,
            '--mac-side-ink': p.sideInk,
            '--mac-side-ink-rgb': rgbList(p.sideInk),
            '--mac-side-on': p.sideOn,
            '--mac-side-on-ink': p.sideOnInk,
            '--mac-success': p.good,
            '--mac-success-rgb': rgbList(p.good),
            '--mac-success-light': hexA(p.good, 0.15),
            '--mac-warning': p.warn,
            '--mac-warning-rgb': rgbList(p.warn),
            '--mac-warning-light': hexA(p.warn, 0.15),
            '--mac-warning-text': p.warn,
            '--mac-danger': p.bad,
            '--mac-danger-rgb': rgbList(p.bad),
            '--mac-danger-light': hexA(p.bad, 0.15),
            '--mac-info': p.info,
            '--mac-info-rgb': rgbList(p.info),
            '--mac-info-light': hexA(p.info, 0.15),
            '--mac-shadow-card': p.shadow
        };
    }

    var api = {
        THEMES: THEMES, BGS: BGS, THEME_DEF: THEME_DEF,
        palette: palette, tokens: tokens, hexRgb: hexRgb, hexA: hexA, hexMix: hexMix, lum: lum, over: over, onColour: onColour
    };
    root.MacThemePalettes = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
