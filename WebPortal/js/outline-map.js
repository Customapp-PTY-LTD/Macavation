/**
 * Inline-SVG map for the Suppliers and Customers screens (MacView round 3). No map library and no
 * map service: outlines come from js/map-outlines.js (Natural Earth, public domain).
 *
 *   MacMap.render(el, {
 *       view: 'sa' | 'world',
 *       pins: [{ id, lat, lng, title, lines: [..], value, kind: 'a'|'b'|'c', exact }],
 *       regions: [[key, name, latMin, latMax, lngMin, lngMax], ...]   // dashed boxes, SA view
 *       onPin: function (id) {}
 *   })
 * Pins are circles sized by value (area ∝ value). Exact (GPS) pins are solid; pins placed by
 * town or country are dashed. + / − / reset buttons zoom by changing the viewBox.
 * Every label goes in as text (textContent / esc), never as markup from data.
 */
var MacMap = (function () {
    'use strict';

    var K = 0.883;                                // cos(28°): keeps South Africa's shape right
    var VB = { sa: [14.2, 21.6, 15.2, 13.6], world: [-150, -92, 320, 171] };   // y = -latitude
    var NS = 'http://www.w3.org/2000/svg';

    function xy(lat, lng) { return [lng * K, -lat]; }
    function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    function ringPath(r) {
        var d = '';
        for (var i = 0; i < r.length; i += 2) d += (i ? 'L' : 'M') + (r[i] * K).toFixed(3) + ' ' + (-r[i + 1]).toFixed(3);
        return d + 'Z';
    }
    function shapes(list, cls) {
        return (list || []).map(function (s) {
            return '<path class="' + cls + '" d="' + s[1].map(ringPath).join('') + '"><title>' + esc(s[0]) + '</title></path>';
        }).join('');
    }
    function provinceLabels() {
        var O = window.MAP_OUTLINES;
        return (O.saProvinces || []).map(function (p) {
            var r = p[1].reduce(function (a, b) { return b.length > a.length ? b : a; });
            var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
            for (var i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
            var adj = { 'Western Cape': [1, 0.6], 'Eastern Cape': [0, 0.3], 'Gauteng': [0, -0.25] }[p[0]] || [0, 0];
            var c = xy((y0 + y1) / 2 + adj[1], (x0 + x1) / 2 + adj[0]);
            return '<text class="mm-plab" x="' + c[0].toFixed(2) + '" y="' + c[1].toFixed(2) + '">' + esc(p[0]) + '</text>';
        }).join('');
    }

    function draw(st) {
        var O = window.MAP_OUTLINES;
        var vb = st.vb, z = vb[2] / 640;
        var maxV = Math.max.apply(null, [1].concat(st.pins.map(function (p) { return Number(p.value) || 0; })));
        var rMax = (st.view === 'world' ? 14 : 16), rMin = 3.2;
        var land = st.view === 'world'
            ? shapes(O.world, 'mm-land')
            : shapes(O.saNeighbours, 'mm-land mm-nb') + shapes(O.saProvinces, 'mm-land mm-prov');
        var labels = st.view === 'world' || vb[2] > 30 ? '' : provinceLabels();
        var regs = st.view === 'world' ? '' : (st.regions || []).map(function (r) {
            var a = xy(r[3], r[4]), b = xy(r[2], r[5]);
            return '<g class="mm-reg" data-mmreg="' + esc(r[0]) + '"><rect x="' + a[0].toFixed(2) + '" y="' + a[1].toFixed(2) + '" width="' + (b[0] - a[0]).toFixed(2) +
                '" height="' + (b[1] - a[1]).toFixed(2) + '" rx="' + (5 * z).toFixed(3) + '" stroke-width="' + (1.1 * z).toFixed(3) + '" stroke-dasharray="' + (4 * z).toFixed(3) + ' ' + (3 * z).toFixed(3) + '"/>' +
                '<text x="' + (a[0] + 4 * z).toFixed(2) + '" y="' + (a[1] + 11 * z).toFixed(2) + '" font-size="' + (10 * z).toFixed(3) + '">' + esc(r[1]) + '</text></g>';
        }).join('');
        // Biggest first so small pins sit on top and stay clickable.
        var pins = st.pins.slice().sort(function (a, b) { return (b.value || 0) - (a.value || 0); }).map(function (p) {
            var c = xy(p.lat, p.lng), v = Number(p.value) || 0;
            var r = (rMin + (rMax - rMin) * Math.sqrt(v / maxV)) * z;
            var t = [p.title].concat(p.lines || []).concat(p.exact ? [] : ['Placed by town or country, not an exact pin']).join('\n');
            return '<g class="mm-pin mm-k-' + esc(p.kind || 'a') + (p.exact ? '' : ' mm-approx') + '" data-mmpin="' + esc(p.id) + '" tabindex="0" role="button" aria-label="' + esc(p.title) + '">' +
                '<circle cx="' + c[0].toFixed(3) + '" cy="' + c[1].toFixed(3) + '" r="' + r.toFixed(3) + '" stroke-width="' + (1.4 * z).toFixed(3) + '"' +
                (p.exact ? '' : ' stroke-dasharray="' + (2.4 * z).toFixed(3) + ' ' + (1.6 * z).toFixed(3) + '"') + '/><title>' + esc(t) + '</title></g>';
        }).join('');
        st.svg.setAttribute('viewBox', vb.map(function (n) { return n.toFixed(3); }).join(' '));
        st.svg.innerHTML = '<rect class="mm-sea" x="-1000" y="-1000" width="3000" height="3000"/>' + land + labels + regs + pins;
    }

    function zoom(st, f, cx, cy) {
        var v = st.vb, w = Math.min(360, Math.max(0.3, v[2] * f)), h = v[3] * w / v[2];
        cx = cx == null ? v[0] + v[2] / 2 : cx; cy = cy == null ? v[1] + v[3] / 2 : cy;
        st.vb = [cx - (cx - v[0]) * w / v[2], cy - (cy - v[1]) * h / v[3], w, h];
        draw(st);
    }

    function render(el, opts) {
        if (!el) return;
        if (!window.MAP_OUTLINES) { el.innerHTML = '<div class="text-muted small">The map could not load.</div>'; return; }
        var prev = el._mm;
        var st = {
            view: opts.view || 'sa', pins: (opts.pins || []).filter(function (p) { return isFinite(p.lat) && isFinite(p.lng); }),
            regions: opts.regions || [], onPin: opts.onPin
        };
        st.vb = prev && prev.view === st.view ? prev.vb : VB[st.view].slice();
        el.innerHTML = '<div class="mm-wrap"><svg class="mm-svg" xmlns="' + NS + '" role="img" aria-label="' + (st.view === 'world' ? 'World map' : 'Map of South Africa') + '"></svg>' +
            '<div class="mm-ctl"><button type="button" class="btn btn-sm btn-light" data-mmz="in" title="Zoom in" aria-label="Zoom in">+</button>' +
            '<button type="button" class="btn btn-sm btn-light" data-mmz="out" title="Zoom out" aria-label="Zoom out">&minus;</button>' +
            '<button type="button" class="btn btn-sm btn-light" data-mmz="reset" title="Show everything">' + (st.view === 'world' ? 'World' : 'SA') + '</button></div></div>';
        st.svg = el.querySelector('svg');
        el._mm = st;
        draw(st);
        el.onclick = function (e) {
            var b = e.target.closest('[data-mmz]');
            if (b) {
                var k = b.getAttribute('data-mmz');
                if (k === 'in') zoom(st, 0.6); else if (k === 'out') zoom(st, 1 / 0.6);
                else { st.vb = VB[st.view].slice(); draw(st); }
                return;
            }
            var p = e.target.closest('[data-mmpin]');
            if (p && st.onPin) { st.onPin(p.getAttribute('data-mmpin')); return; }
            var r = e.target.closest('[data-mmreg]');
            if (r) {
                var R = st.regions.filter(function (x) { return x[0] === r.getAttribute('data-mmreg'); })[0];
                if (R) {
                    var a = xy(R[3], R[4]), c = xy(R[2], R[5]), pad = 0.4;
                    var w = (c[0] - a[0]) + pad * 2, h = w * VB.sa[3] / VB.sa[2];
                    st.vb = [a[0] - pad, (a[1] + c[1]) / 2 - h / 2, w, h];
                    draw(st);
                }
            }
        };
        el.onkeydown = function (e) {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            var p = e.target.closest && e.target.closest('[data-mmpin]');
            if (p && st.onPin) { e.preventDefault(); st.onPin(p.getAttribute('data-mmpin')); }
        };
    }

    /** Is a point inside the area the SA map shows? */
    function inSouthernAfrica(lat, lng) { return lat >= -36 && lat <= -9 && lng >= 11 && lng <= 41; }

    /**
     * Read a pin typed or pasted by a person: "-25.123, 30.456", a google.com/maps link (@lat,lng
     * or !3d…!4d… or ?q=lat,lng) or degrees-minutes-seconds. Returns [lat, lng] or null.
     */
    function parseGps(raw) {
        var v = String(raw || '').trim();
        if (!v) return null;
        function ok(a, b) { return isFinite(a) && isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 ? [a, b] : null; }
        var pats = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
            /[?&](?:q|query|ll|center|destination|daddr)=(?:loc:)?(-?\d+(?:\.\d+)?)\s*(?:,|%2C)\s*\+?(-?\d+(?:\.\d+)?)/i,
            /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/];
        for (var i = 0; i < pats.length; i++) { var m = v.match(pats[i]); if (m) { var r = ok(+m[1], +m[2]); if (r) return r; } }
        var d = v.match(/(\d+(?:\.\d+)?)°\s*(?:(\d+(?:\.\d+)?)['′]\s*)?(?:(\d+(?:\.\d+)?)["″]\s*)?([NS])[\s,]+(\d+(?:\.\d+)?)°\s*(?:(\d+(?:\.\d+)?)['′]\s*)?(?:(\d+(?:\.\d+)?)["″]\s*)?([EW])/i);
        if (d) {
            var c = function (g, mi, s, h) { return (+g + (+mi || 0) / 60 + (+s || 0) / 3600) * (/[SW]/i.test(h) ? -1 : 1); };
            return ok(c(d[1], d[2], d[3], d[4]), c(d[5], d[6], d[7], d[8]));
        }
        return null;
    }

    return { render: render, parseGps: parseGps, inSouthernAfrica: inSouthernAfrica };
})();
