/**
 * Grower Intake - bags (31 Oct 2026).
 * Every batch's delivery bags and where each one is: a storage area (tagged here), a silo or
 * cracked (set on the Silos screen, read-only here), or not placed yet. Also supplies the
 * "Released – cracking" cards and draws the Storage areas list at the bottom of the screen.
 * Data: get_intake_bag_overview / move_nis_bags (migration 20261031090000_nis_bag_locations).
 * Moving bags needs the nis_storage.move action; everyone else sees the bags read-only.
 *
 * One move bar per batch: "Bags [a] to [b] · Move to [area] [Move]". The squares, the two number
 * boxes and the tag chips all edit the same selection (state.sel).
 */
var _giBags = (function () {
    'use strict';

    var NS = '.giBags';
    var LETTER = { silo: 'F', drying: 'D', shelter: 'S', fuels_depot: 'P' };
    var KNOWN = { silo: 1, drying: 1, shelter: 1, fuels_depot: 1 };
    var UNDO_MS = 8000;
    var LONG_PRESS_MS = 450;

    var state = {
        loaded: false, failed: false, areas: [], batches: [], byId: {},
        open: {}, sel: {}, anchor: {}, to: {}, longPress: false, pressTimer: null, card: null
    };

    // ------------------------------------------------------------------ helpers

    function esc(v) { return _common.escapeHtml(v == null ? '' : String(v)); }
    function kg(v) { return _common.formatKg(v); }
    function tonnes(v) { return _common.formatKg((Number(v) || 0) / 1000, 1) + ' t'; }
    function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
    function canMove() { return typeof window.hasAction === 'function' && !!window.hasAction('nis_storage.move'); }
    function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')); }

    function areaOf(code) {
        for (var i = 0; i < state.areas.length; i++) if (state.areas[i].code === code) return state.areas[i];
        return null;
    }

    /** What a bag's loc means: label, letter (or icon), colour class and whether it can be moved here. */
    function tagOf(loc) {
        loc = loc || '';
        if (loc === 'cracked') return { key: 'cracked', label: 'Cracked', l: '✓', cls: 'gib-c-cracked', movable: false };
        if (loc.indexOf('silo:') === 0) return { key: loc, label: 'Silo ' + loc.slice(5), fa: 'fa-database', cls: 'gib-c-insilo', movable: false, silo: true };
        if (!loc) return { key: '', label: 'Not placed yet', l: '?', cls: 'gib-c-none', movable: true };
        var a = areaOf(loc);
        return {
            key: loc, label: a ? a.label : loc, area: true, movable: true,
            l: LETTER[loc] || (a ? a.label.charAt(0).toUpperCase() : '?'),
            cls: 'gib-c-' + (KNOWN[loc] ? loc : 'other')
        };
    }

    function mark(t) { return t.fa ? '<i class="fas ' + t.fa + '" aria-hidden="true"></i>' : esc(t.l); }
    function icon(t) { return '<span class="gib-ic ' + t.cls + '" aria-hidden="true">' + mark(t) + '</span>'; }

    function bagKg(b) { return b.bags.reduce(function (s, x) { return s + (Number(x.kg) || 0); }, 0); }
    function movableNos(b) { return b.bags.filter(function (x) { return tagOf(x.loc).movable; }).map(function (x) { return x.no; }); }

    /** Bag groups of one batch in screen order: areas, silos, cracked, not placed. */
    function groups(b) {
        var c = {};
        b.bags.forEach(function (x) { var k = x.loc || ''; c[k] = (c[k] || 0) + 1; });
        var keys = [];
        state.areas.forEach(function (a) { if (c[a.code]) keys.push(a.code); });
        Object.keys(c).forEach(function (k) {
            if (k && k !== 'cracked' && k.indexOf('silo:') !== 0 && !areaOf(k)) keys.push(k);
        });
        Object.keys(c).filter(function (k) { return k.indexOf('silo:') === 0; }).sort().forEach(function (k) { keys.push(k); });
        if (c.cracked) keys.push('cracked');
        if (c['']) keys.push('');
        return keys.map(function (k) { var t = tagOf(k); t.n = c[k]; return t; });
    }

    function summary(b) {
        var parts = [], silo = 0, tail = [];
        groups(b).forEach(function (g) {
            if (g.silo) silo += g.n;
            else if (g.key === 'cracked' || g.key === '') tail.push(g.label + ' ' + g.n);
            else parts.push(g.label + ' ' + g.n);
        });
        if (silo) parts.push('In silos ' + silo);
        return parts.concat(tail).join(' · ');
    }

    function strip(b) {
        var n = b.bags.length || 1;
        return '<div class="gib-strip" aria-hidden="true">' + groups(b).map(function (g) {
            return '<span class="' + g.cls + '" style="width:' + (g.n / n * 100).toFixed(2) + '%"></span>';
        }).join('') + '</div>';
    }

    function areaOptions(exclude, selected) {
        return state.areas.filter(function (a) { return a.code !== exclude; }).map(function (a) {
            return '<option value="' + esc(a.code) + '"' + (a.code === selected ? ' selected' : '') + '>' + esc(a.label) + '</option>';
        }).join('');
    }

    function ranges(nos) {
        var out = [], s = nos[0], p = nos[0];
        for (var i = 1; i <= nos.length; i++) {
            if (nos[i] === p + 1) { p = nos[i]; continue; }
            out.push(s === p ? String(s) : s + '–' + p);
            s = p = nos[i];
        }
        return out.join(', ');
    }

    function rerenderGrid() {
        if (typeof _growerIntakeGrid !== 'undefined' && _growerIntakeGrid.filterIntakeBatches) _growerIntakeGrid.filterIntakeBatches();
    }

    // ------------------------------------------------------------------ selection

    function selNos(id) { return Object.keys(state.sel[id] || {}).map(Number).sort(function (a, b) { return a - b; }); }

    /** {from, to} when the picked bags are every movable bag between the lowest and highest; else null. */
    function selRun(b) {
        var nos = selNos(b.kernel_id);
        if (!nos.length) return null;
        var lo = nos[0], hi = nos[nos.length - 1], s = state.sel[b.kernel_id];
        var gap = movableNos(b).some(function (n) { return n >= lo && n <= hi && !s[n]; });
        return gap ? null : { from: lo, to: hi };
    }

    /** First time a panel opens: pick the bags that are not placed yet. */
    function initSel(b) {
        var s = {};
        b.bags.forEach(function (x) { if (!x.loc) s[x.no] = 1; });
        state.sel[b.kernel_id] = s;
        state.anchor[b.kernel_id] = null;
    }

    function setRange(b, from, to) {
        var s = {};
        b.bags.forEach(function (x) { if (x.no >= from && x.no <= to && tagOf(x.loc).movable) s[x.no] = 1; });
        state.sel[b.kernel_id] = s;
    }

    /** Where to send the picked bags by default: the chosen area, unless the bags are already all there. */
    function defaultTo(b) {
        var s = state.sel[b.kernel_id] || {};
        var here = {};
        b.bags.forEach(function (x) { if (s[x.no]) here[x.loc || ''] = 1; });
        var keys = Object.keys(here);
        var current = keys.length === 1 ? keys[0] : null;
        var chosen = state.to[b.kernel_id];
        if (chosen && chosen !== current && areaOf(chosen)) return chosen;
        var first = state.areas.filter(function (a) { return a.code !== current; })[0];
        return first ? first.code : '';
    }

    // ------------------------------------------------------------------ batch pieces

    function moveBar(b) {
        var id = b.kernel_id, nos = selNos(id), run = selRun(b);
        var pick = run
            ? '<span>Bags</span><input type="text" inputmode="numeric" class="form-control form-control-sm gib-num js-gib-from" aria-label="From bag" value="' + run.from + '">' +
              '<span>to</span><input type="text" inputmode="numeric" class="form-control form-control-sm gib-num js-gib-to" aria-label="To bag" value="' + run.to + '">'
            : nos.length
                ? '<span class="gib-picked">' + plural(nos.length, 'bag', 'bags') + ' picked</span>' +
                  '<button type="button" class="gib-unpick js-gib-clear" data-kernel-id="' + esc(id) + '" aria-label="Clear the picked bags">✕</button>'
                : '<span>Bags</span><input type="text" inputmode="numeric" class="form-control form-control-sm gib-num js-gib-from" aria-label="From bag" placeholder="from">' +
                  '<span>to</span><input type="text" inputmode="numeric" class="form-control form-control-sm gib-num js-gib-to" aria-label="To bag" placeholder="to">';
        return '<div class="gib-movebar" data-kernel-id="' + esc(id) + '">' +
            '<div class="gib-movebar-pick">' + pick + '</div>' +
            '<div class="gib-movebar-go"><select class="form-select form-select-sm gib-select js-gib-to-area" aria-label="Move to">' + areaOptions(null, defaultTo(b)) + '</select>' +
            '<button type="button" class="btn btn-sm btn-primary js-gib-move" data-kernel-id="' + esc(id) + '"' + (nos.length ? '' : ' disabled') + '>Move</button></div></div>';
    }

    function panelHtml(b) {
        var id = b.kernel_id, s = state.sel[id] || {}, mv = canMove(), movable = movableNos(b);

        var chips = '<div class="gib-chips">' + groups(b).map(function (g) {
            var inner = icon(g) + esc(g.label) + ' · ' + g.n;
            return (g.movable && mv)
                ? '<button type="button" class="gib-chip js-gib-chip" data-kernel-id="' + esc(id) + '" data-loc="' + esc(g.key) + '" title="Pick these bags">' + inner + '</button>'
                : '<span class="gib-chip is-ro" title="' + (g.movable ? '' : 'Set on the Silos screen') + '">' + inner + '</span>';
        }).join('') + '</div>';

        var grid = '<div class="gib-bags">' + b.bags.map(function (x) {
            var t = tagOf(x.loc), on = !!s[x.no];
            return '<button type="button" class="gib-bag ' + t.cls + (t.movable ? '' : ' is-ro') + (on ? ' is-sel' : '') + '"' +
                ' data-kernel-id="' + esc(id) + '" data-bag-no="' + x.no + '" aria-pressed="' + on + '"' +
                ' title="Bag ' + x.no + ': ' + esc(t.label) + ' · ' + esc(kg(x.kg)) + ' kg">' +
                '<span class="gib-no">' + x.no + '</span><span class="gib-lt">' + mark(t) + '</span></button>';
        }).join('') + '</div>';

        var foot;
        if (!movable.length) foot = '<div class="gib-note">All ' + b.bags.length + ' bags are in silos or cracked. Those are set on the Silos screen.</div>';
        else if (!mv) foot = '<div class="gib-hint">You can see where the bags are. Ask an admin for access to move them.</div>';
        else foot = moveBar(b) + '<div class="gib-hint">Tap a bag, then another, to pick the bags between. Press and hold (or Ctrl-click) to add or drop one bag.</div>';
        return '<div class="gib-panel">' + chips + grid + foot + '</div>';
    }

    /** Card: strip (when asked or open) and the one-line bag summary. */
    function cardSummary(kernelId, showStrip) {
        if (!state.loaded) return '';
        var b = state.byId[kernelId];
        if (!b || !b.bags.length) return '<div class="gib-sum gib-sum-none">No bags recorded</div>';
        return (showStrip || state.open[kernelId] ? strip(b) : '') +
            '<div class="gib-sum">' + plural(b.bags.length, 'bag', 'bags') + ' · ' + esc(summary(b)) + '</div>';
    }

    /** Card: the Bags button for the card's button row ('' when the batch has no bags). */
    function toggleButton(kernelId) {
        var b = state.byId[kernelId];
        if (!state.loaded || !b || !b.bags.length) return '';
        var open = !!state.open[kernelId];
        return '<button type="button" class="gib-toggle js-gib-toggle" data-kernel-id="' + esc(kernelId) + '" aria-expanded="' + open + '">' + (open ? 'Hide bags ▴' : 'Bags ▾') + '</button>';
    }

    /** Card: received/weighed line and the bag panel, only when open. */
    function cardPanel(kernelId) {
        var b = state.byId[kernelId];
        if (!state.loaded || !b || !b.bags.length || !state.open[kernelId]) return '';
        var date = _common.formatDateDDMMYYYY(b.received_date);
        return '<div class="gib-meta">' + (date ? 'Received ' + esc(date) + ' · ' : '') +
            'weighed ' + esc(kg(b.actual_wet_nis_kg != null ? b.actual_wet_nis_kg : bagKg(b))) + ' kg' +
            (b.wet_nis_received_kg != null ? ' · declared ' + esc(kg(b.wet_nis_received_kg)) + ' kg' : '') + '</div>' + panelHtml(b);
    }

    /** Table "Bags" cell. */
    function tableCell(kernelId) {
        if (!state.loaded) return '';
        var b = state.byId[kernelId];
        if (!b || !b.bags.length) return '<span class="text-muted small">No bags recorded</span>';
        return '<div class="gib-cell">' + strip(b) + '<span>' + plural(b.bags.length, 'bag', 'bags') + ' · ' + esc(summary(b)) + '</span></div>';
    }

    /** Table expand arrow. */
    function tableToggle(kernelId) {
        var b = state.byId[kernelId];
        if (!state.loaded || !b || !b.bags.length) return '';
        var open = !!state.open[kernelId];
        return '<button type="button" class="gib-chev js-gib-toggle" data-kernel-id="' + esc(kernelId) + '" aria-expanded="' + open + '" aria-label="Show bags">▶</button>';
    }

    /** Table sub-row with the bag panel, or '' when closed. */
    function tableRow(kernelId, colspan) {
        var b = state.byId[kernelId];
        if (!state.open[kernelId] || !b || !b.bags.length) return '';
        return '<tr class="gib-exp-row"><td colspan="' + colspan + '">' + panelHtml(b) + '</td></tr>';
    }

    /** Released batches that still have bags waiting, shaped like get_kernel_batches rows. */
    function releasedBatches() {
        if (!state.loaded) return [];
        return state.batches.filter(function (b) {
            return b.status === 'production' && b.bags.some(function (x) { return x.loc !== 'cracked'; });
        }).map(function (b) {
            return {
                id: b.kernel_id, batch_number: b.batch_number, grower_name: b.grower_name, received_date: b.received_date,
                wet_nis_received_kg: b.wet_nis_received_kg, actual_wet_nis_kg: b.actual_wet_nis_kg, status: 'production', _released: true
            };
        });
    }

    // ------------------------------------------------------------------ moving bags

    function toastUndo(message, undo) {
        var el = document.createElement('div');
        el.className = 'gib-toast';
        el.setAttribute('role', 'status');
        el.appendChild(document.createTextNode(message + ' '));
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'gib-undo';
        btn.textContent = 'Undo';
        btn.addEventListener('click', function () { el.remove(); undo(); });
        el.appendChild(btn);
        document.body.appendChild(el);
        setTimeout(function () { el.remove(); }, UNDO_MS);
    }

    async function move(b, nos, toArea, confirmed) {
        var label = (areaOf(toArea) || {}).label || toArea;
        var byNo = {};
        b.bags.forEach(function (x) { byNo[x.no] = x; });
        var list = nos.filter(function (no) { var x = byNo[no]; return x && tagOf(x.loc).movable && (x.loc || '') !== toArea; });
        if (!list.length) {
            _common.showErrorToast('Nothing to move. Those bags are already there, or are in a silo or cracked.');
            return;
        }
        if (!confirmed && list.length > b.bags.length / 2) {
            var ok = await Swal.fire({
                title: 'Move ' + list.length + ' bags?',
                text: 'That is ' + list.length + ' of the ' + b.bags.length + ' bags of ' + b.batch_number + ' going to ' + label + '.',
                showCancelButton: true, confirmButtonText: 'Move them', cancelButtonText: 'Cancel'
            });
            if (!ok.isConfirmed) return;
        }
        var before = {};
        list.forEach(function (no) { var k = byNo[no].loc || ''; (before[k] = before[k] || []).push(no); });
        var res = await dataFunctions.moveNisBags(b.kernel_id, list, toArea);
        if (!res || res.success === false) {
            _common.showErrorToast((res && res.error) || 'Could not move the bags.');
            return;
        }
        state.sel[b.kernel_id] = {};
        state.anchor[b.kernel_id] = null;
        await api.load();
        toastUndo(plural(list.length, 'bag', 'bags') + ' of ' + b.batch_number + ' moved to ' + label + '.', async function () {
            var keys = Object.keys(before);
            for (var i = 0; i < keys.length; i++) {
                var r = await dataFunctions.moveNisBags(b.kernel_id, before[keys[i]], keys[i] || null);
                if (!r || r.success === false) { _common.showErrorToast((r && r.error) || 'Could not undo.'); break; }
            }
            await api.load();
            _common.showSuccessToast('Undone.');
        });
    }

    function areaMoveDialog(code) {
        var list = state.batches.filter(function (b) { return b.bags.some(function (x) { return (x.loc || '') === code; }); });
        if (!list.length) { _common.showErrorToast('Nothing is stored here.'); return; }
        var here = function (b) { return b.bags.filter(function (x) { return (x.loc || '') === code; }).map(function (x) { return x.no; }); };
        var placing = code === '';
        var html = '<div class="text-start gib-dialog">' +
            '<label class="form-label small mb-1" for="gibDlgBatch">Batch</label>' +
            '<select class="form-select mb-3" id="gibDlgBatch">' + list.map(function (b) {
                return '<option value="' + esc(b.kernel_id) + '">' + esc(b.batch_number) + ' · ' + esc(b.grower_name || '') + ' · ' + plural(here(b).length, 'bag', 'bags') + ' here</option>';
            }).join('') + '</select>' +
            '<div class="gib-dlg-range mb-3"><span>Bags</span><input type="text" inputmode="numeric" class="form-control gib-num" id="gibDlgFrom" aria-label="From bag">' +
            '<span>to</span><input type="text" inputmode="numeric" class="form-control gib-num" id="gibDlgTo" aria-label="To bag"></div>' +
            '<label class="form-label small mb-1" for="gibDlgArea">Move to</label>' +
            '<select class="form-select" id="gibDlgArea">' + areaOptions(code) + '</select>' +
            '<div class="small text-muted mt-2">' + (placing ? 'Bags booked in without a place.' : 'Only bags that are in ' + esc((areaOf(code) || {}).label || code) + ' will move.') + '</div></div>';
        Swal.fire({
            title: placing ? 'Place bags' : 'Move bags out of ' + ((areaOf(code) || {}).label || code),
            html: html, showCancelButton: true, confirmButtonText: placing ? 'Place' : 'Move', focusConfirm: false,
            didOpen: function () {
                var fill = function () {
                    var b = state.byId[$('#gibDlgBatch').val()];
                    var nos = b ? here(b) : [];
                    $('#gibDlgFrom').val(nos.length ? nos[0] : '');
                    $('#gibDlgTo').val(nos.length ? nos[nos.length - 1] : '');
                };
                $('#gibDlgBatch').on('change', fill);
                fill();
            },
            preConfirm: function () {
                var b = state.byId[$('#gibDlgBatch').val()];
                var f = parseInt($('#gibDlgFrom').val(), 10), t = parseInt($('#gibDlgTo').val(), 10);
                if (!b) { Swal.showValidationMessage('Choose a batch.'); return false; }
                if (!(f >= 1 && t >= f)) { Swal.showValidationMessage('Enter bag numbers, like 1 to 10.'); return false; }
                var nos = here(b).filter(function (no) { return no >= f && no <= t; });
                if (!nos.length) { Swal.showValidationMessage('None of those bags are here.'); return false; }
                return { b: b, nos: nos, to: $('#gibDlgArea').val() };
            }
        }).then(function (r) {
            if (r.isConfirmed && r.value) move(r.value.b, r.value.nos, r.value.to, false);
        });
    }

    // ------------------------------------------------------------------ storage list

    function placeTotals(match) {
        var bags = 0, kgSum = 0, batches = 0;
        state.batches.forEach(function (b) {
            var n = 0;
            b.bags.forEach(function (x) { if (match(x.loc || '')) { n++; kgSum += Number(x.kg) || 0; } });
            if (n) { bags += n; batches++; }
        });
        return { bags: bags, kg: kgSum, batches: batches };
    }

    function storageRow(code, t, label, p, opts) {
        var cap = opts.cap || 0;
        var pct = cap ? Math.min(100, p.kg / cap * 100) : null;
        var figures = p.bags
            ? '<span class="gib-srow-num">' + plural(p.bags, 'bag', 'bags') + '</span>' +
              '<span class="gib-srow-num">' + esc(tonnes(p.kg)) + '</span>' +
              '<span class="gib-srow-num gib-srow-muted">' + plural(p.batches, 'batch', 'batches') + '</span>'
            : '<span class="gib-srow-empty">Empty</span>';
        var bar = pct !== null && p.bags
            ? '<span class="gib-srow-cap"><span class="gib-bar' + (pct > 90 ? ' is-full' : '') + '"><span class="' + t.cls + '" style="width:' + pct.toFixed(1) + '%"></span></span>' +
              '<span class="gib-srow-muted">' + Math.round(pct) + '% full' + (pct > 90 ? ' · <b class="gib-full">Full soon</b>' : '') + '</span></span>'
            : '';
        return '<div class="gib-srow' + (opts.cls ? ' ' + opts.cls : '') + (state.card === code ? ' is-on' : '') + '">' +
            '<button type="button" class="gib-srow-main js-gib-card" data-code="' + esc(code) + '"' + (p.bags ? '' : ' disabled') + ' aria-expanded="' + (state.card === code) + '">' +
            '<span class="gib-srow-name">' + icon(t) + esc(label) + '</span>' + figures + bar + '</button>' +
            '<span class="gib-srow-act">' + (opts.action || '') + '</span></div>';
    }

    function renderStorage() {
        var $list = $('#giStorageCards');
        if (!$list.length) return;
        var $note = $('#giStorageNote');
        if (state.failed) {
            $list.html('<div class="text-muted small">Could not load the bags. Refresh the page to try again.</div>');
            $note.text('');
            $('#giStorageDetail').prop('hidden', true);
            return;
        }
        if (!state.loaded) return;
        var mv = canMove(), html = '';

        var un = placeTotals(function (l) { return l === ''; });
        if (un.bags) {
            html += storageRow('', tagOf(''), 'Not placed yet', un, {
                cls: 'is-none',
                action: mv ? '<button type="button" class="btn btn-sm btn-primary js-gib-area-move" data-code="">Place them</button>' : ''
            });
        }
        state.areas.forEach(function (a) {
            var p = placeTotals(function (l) { return l === a.code; });
            html += storageRow(a.code, tagOf(a.code), a.label, p, {
                cap: Number(a.capacity_kg) || 0,
                action: mv && p.bags ? '<button type="button" class="btn btn-sm btn-outline-secondary js-gib-area-move" data-code="' + esc(a.code) + '">Move bags</button>' : ''
            });
        });
        var si = placeTotals(function (l) { return l.indexOf('silo:') === 0; });
        html += storageRow('silos', tagOf('silo:1'), 'In silos', si, {
            cls: 'is-silo',
            action: '<button type="button" class="btn btn-link btn-sm p-0 js-gib-silos">Silos screen →</button>'
        });
        $list.html(html);

        var noBags = state.batches.filter(function (b) { return !b.bags.length; }).length;
        $note.text(noBags ? plural(noBags, 'batch has', 'batches have') + ' no bags recorded, so ' + (noBags === 1 ? 'it is' : 'they are') + ' not counted here.' : '');
        renderDetail();
    }

    function renderDetail() {
        var $d = $('#giStorageDetail');
        if (state.card === null || !state.loaded) { $d.prop('hidden', true).empty(); return; }
        var code = state.card;
        var match = code === 'silos' ? function (l) { return l.indexOf('silo:') === 0; } : function (l) { return l === code; };
        var title = code === 'silos' ? 'In silos' : tagOf(code).label;
        var rows = [], total = 0;
        state.batches.forEach(function (b) {
            var nos = [], kgSum = 0, silos = {};
            b.bags.forEach(function (x) {
                if (match(x.loc || '')) { nos.push(x.no); kgSum += Number(x.kg) || 0; if (code === 'silos') silos[tagOf(x.loc).label] = 1; }
            });
            if (!nos.length) return;
            total += nos.length;
            var status = b.status === 'production' ? 'Released – cracking' : 'At intake';
            rows.push('<div class="gib-drow"><span class="gib-dn">' + esc(b.batch_number) + '</span>' +
                '<span>' + esc(b.grower_name || '') + ' <span class="text-muted">· bags ' + esc(ranges(nos)) + (code === 'silos' ? ' · ' + esc(Object.keys(silos).join(', ')) : '') + '</span></span>' +
                '<span class="badge ' + (b.status === 'production' ? 'bg-success' : 'bg-secondary') + '">' + status + '</span>' +
                '<span class="gib-dr">' + plural(nos.length, 'bag', 'bags') + ' · ' + esc(tonnes(kgSum)) +
                ' <button type="button" class="btn btn-link btn-sm p-0 ms-2 js-gib-open-batch" data-kernel-id="' + esc(b.kernel_id) + '">Open batch</button></span></div>');
        });
        $d.prop('hidden', false).html(
            '<div class="gib-dhead"><h3 class="h6 mb-0">Bags in ' + esc(title) + ' <span class="text-muted fw-normal">' + plural(total, 'bag', 'bags') + ' from ' + plural(rows.length, 'batch', 'batches') + '</span></h3>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary js-gib-close-detail">Close</button></div>' +
            (rows.join('') || '<div class="text-muted small">Nothing stored here.</div>'));
    }

    // ------------------------------------------------------------------ events

    /** Tap: first tap picks one bag, a second tap picks the run between. Ctrl / press-and-hold: add or drop one. */
    function tap(b, no, single) {
        var id = b.kernel_id, s = state.sel[id] = state.sel[id] || {};
        if (single) {
            if (s[no]) delete s[no]; else s[no] = 1;
            state.anchor[id] = null;
            return;
        }
        var a = state.anchor[id];
        if (a != null && a !== no) {
            setRange(b, Math.min(a, no), Math.max(a, no));
            state.anchor[id] = null;
        } else {
            state.sel[id] = {};
            state.sel[id][no] = 1;
            state.anchor[id] = no;
        }
    }

    /** Typed numbers: pick that run and light the squares without redrawing (keeps the typing focus). */
    function typedRange($bar) {
        var b = state.byId[$bar.data('kernel-id')];
        if (!b) return;
        var f = parseInt($bar.find('.js-gib-from').val(), 10), t = parseInt($bar.find('.js-gib-to').val(), 10);
        if (!(f >= 1)) return;
        if (!(t >= f)) t = f;
        setRange(b, f, t);
        state.anchor[b.kernel_id] = null;
        var s = state.sel[b.kernel_id];
        $bar.closest('.gib-panel').find('.gib-bag').each(function () {
            var on = !!s[parseInt($(this).data('bag-no'), 10)];
            $(this).toggleClass('is-sel', on).attr('aria-pressed', on);
        });
        $bar.find('.js-gib-move').prop('disabled', !Object.keys(s).length);
    }

    function bind() {
        var $doc = $(document);
        $doc.off(NS);
        $doc.on('click' + NS, '.js-gib-toggle', function (e) {
            e.preventDefault(); e.stopPropagation();
            var id = $(this).data('kernel-id');
            if (!isUuid(id) || !state.byId[id]) return;
            state.open[id] = !state.open[id];
            if (state.open[id] && !state.sel[id]) initSel(state.byId[id]);
            rerenderGrid();
        });
        $doc.on('click' + NS, '.gib-bag', function (e) {
            e.preventDefault(); e.stopPropagation();
            var b = state.byId[$(this).data('kernel-id')];
            var no = parseInt($(this).data('bag-no'), 10);
            if (!b || !(no > 0)) return;
            var x = b.bags.filter(function (y) { return y.no === no; })[0];
            if (!x) return;
            var t = tagOf(x.loc);
            if (!t.movable) { _common.showWarningToast('Bag ' + no + ' is in ' + t.label + '. That is set on the Silos screen.'); return; }
            if (!canMove()) return;
            tap(b, no, e.ctrlKey || e.metaKey || state.longPress);
            state.longPress = false;
            rerenderGrid();
        });
        $doc.on('pointerdown' + NS, '.gib-bag', function () {
            clearTimeout(state.pressTimer);
            state.longPress = false;
            state.pressTimer = setTimeout(function () { state.longPress = true; }, LONG_PRESS_MS);
        });
        $doc.on('pointerup' + NS + ' pointercancel' + NS, function () { clearTimeout(state.pressTimer); });
        $doc.on('contextmenu' + NS, '.gib-bag', function (e) { e.preventDefault(); });
        $doc.on('click' + NS, '.js-gib-chip', function (e) {
            e.preventDefault(); e.stopPropagation();
            var b = state.byId[$(this).data('kernel-id')];
            if (!b) return;
            var loc = String($(this).data('loc') == null ? '' : $(this).data('loc'));
            var s = {};
            b.bags.forEach(function (x) { if ((x.loc || '') === loc) s[x.no] = 1; });
            state.sel[b.kernel_id] = s;
            state.anchor[b.kernel_id] = null;
            rerenderGrid();
        });
        $doc.on('click' + NS, '.js-gib-clear', function (e) {
            e.preventDefault(); e.stopPropagation();
            var id = $(this).data('kernel-id');
            state.sel[id] = {};
            state.anchor[id] = null;
            rerenderGrid();
        });
        $doc.on('change' + NS, '.gib-movebar .js-gib-from, .gib-movebar .js-gib-to', function () { typedRange($(this).closest('.gib-movebar')); });
        $doc.on('keydown' + NS, '.gib-movebar .gib-num', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); typedRange($(this).closest('.gib-movebar')); }
        });
        $doc.on('change' + NS, '.gib-movebar .js-gib-to-area', function () {
            state.to[$(this).closest('.gib-movebar').data('kernel-id')] = $(this).val();
        });
        $doc.on('click' + NS, '.js-gib-move', function (e) {
            e.preventDefault(); e.stopPropagation();
            var $bar = $(this).closest('.gib-movebar');
            var b = state.byId[$bar.data('kernel-id')];
            if (!b) return;
            if ($bar.find('.js-gib-from').length) typedRange($bar);
            var nos = selNos(b.kernel_id);
            if (!nos.length) { _common.showErrorToast('Pick the bags first: tap them, or type the bag numbers.'); return; }
            move(b, nos, $bar.find('.js-gib-to-area').val(), false);
        });
        $doc.on('click' + NS, '.js-gib-card', function (e) {
            e.preventDefault();
            var code = String($(this).data('code') == null ? '' : $(this).data('code'));
            state.card = state.card === code ? null : code;
            renderStorage();
            if (state.card !== null) {
                var el = document.getElementById('giStorageDetail');
                if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        });
        $doc.on('click' + NS, '.js-gib-close-detail', function (e) { e.preventDefault(); state.card = null; renderStorage(); });
        $doc.on('click' + NS, '.js-gib-area-move', function (e) {
            e.preventDefault(); e.stopPropagation();
            if (!canMove()) return;
            areaMoveDialog(String($(this).data('code') == null ? '' : $(this).data('code')));
        });
        $doc.on('click' + NS, '.js-gib-silos', function (e) {
            e.preventDefault();
            if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) _appRouter.routeTo('nis-storage', true);
        });
        $doc.on('click' + NS, '.js-gib-open-batch', function (e) {
            e.preventDefault();
            var id = $(this).data('kernel-id');
            if (!isUuid(id) || !state.byId[id]) return;
            state.open[id] = true;
            if (!state.sel[id]) initSel(state.byId[id]);
            $('#searchIntakeBatchesInput').val('');
            $('#filterIntakeBatchStatus').val('');
            rerenderGrid();
            var el = document.querySelector('#giKanbanBoard [data-batch-id="' + id + '"], #intakeBatchesTableBody [data-batch-id="' + id + '"]');
            if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }

    // ------------------------------------------------------------------ public

    var api = {
        init: function () {
            state.card = null;
            state.sel = {};
            state.anchor = {};
            state.to = {};
            bind();
        },

        destroy: function () {
            $(document).off(NS);
            clearTimeout(state.pressTimer);
        },

        load: async function () {
            var res = (typeof dataFunctions !== 'undefined' && dataFunctions.getIntakeBagOverview)
                ? await dataFunctions.getIntakeBagOverview(400) : null;
            if (!res) {
                state.failed = true;
                state.loaded = false;
            } else {
                state.failed = false;
                state.loaded = true;
                state.areas = Array.isArray(res.areas) ? res.areas : [];
                state.batches = (Array.isArray(res.batches) ? res.batches : []).map(function (b) {
                    return Object.assign({}, b, {
                        bags: (Array.isArray(b.bags) ? b.bags : []).map(function (x) {
                            return { no: parseInt(x.no, 10), kg: Number(x.kg) || 0, loc: x.loc || '' };
                        }).filter(function (x) { return x.no > 0; })
                    });
                });
                state.byId = {};
                state.batches.forEach(function (b) { state.byId[b.kernel_id] = b; });
                // keep picks only for bags that can still move
                Object.keys(state.sel).forEach(function (id) {
                    var b = state.byId[id];
                    if (!b) { delete state.sel[id]; return; }
                    var ok = {};
                    movableNos(b).forEach(function (n) { ok[n] = 1; });
                    Object.keys(state.sel[id]).forEach(function (n) { if (!ok[n]) delete state.sel[id][n]; });
                });
            }
            renderStorage();
            rerenderGrid();
        },

        cardSummary: cardSummary,
        cardPanel: cardPanel,
        toggleButton: toggleButton,
        tableCell: tableCell,
        tableToggle: tableToggle,
        tableRow: tableRow,
        releasedBatches: releasedBatches,
        renderStorage: renderStorage,
        noDragSelector: '.gib-panel, .gib-toggle'
    };
    return api;
})();
window._giBags = _giBags;
