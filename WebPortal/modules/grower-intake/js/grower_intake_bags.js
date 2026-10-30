/**
 * Grower Intake - bags (31 Oct 2026).
 * Every batch's delivery bags and where each one is: a storage area (tagged here), a silo or
 * cracked (set on the Silos screen, read-only here), or not placed yet. Also supplies the
 * "Released – cracking" cards and draws the Storage areas cards at the bottom of the screen.
 * Data: get_intake_bag_overview / move_nis_bags (migration 20261031090000_nis_bag_locations).
 * Moving bags needs the nis_storage.move action; everyone else sees the bags read-only.
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
        open: {}, sel: {}, lastTap: {}, longPress: false, pressTimer: null, card: null
    };

    // ------------------------------------------------------------------ helpers

    function esc(v) { return _common.escapeHtml(v == null ? '' : String(v)); }
    function kg(v) { return _common.formatKg(v); }
    function tonnes(v) { return _common.formatKg((Number(v) || 0) / 1000, 1) + ' t'; }
    function canMove() { return typeof window.hasAction === 'function' && !!window.hasAction('nis_storage.move'); }
    function isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')); }

    function areaOf(code) {
        for (var i = 0; i < state.areas.length; i++) if (state.areas[i].code === code) return state.areas[i];
        return null;
    }

    /** What a bag's loc means: label, letter, colour class and whether it can be moved here. */
    function tagOf(loc) {
        loc = loc || '';
        if (loc === 'cracked') return { key: 'cracked', label: 'Cracked', l: '✓', cls: 'gib-c-cracked', movable: false };
        if (loc.indexOf('silo:') === 0) return { key: loc, label: 'Silo ' + loc.slice(5), l: '◉', cls: 'gib-c-insilo', movable: false, silo: true };
        if (!loc) return { key: '', label: 'Not placed yet', l: '?', cls: 'gib-c-none', movable: true };
        var a = areaOf(loc);
        return {
            key: loc, label: a ? a.label : loc, area: true, movable: true,
            l: LETTER[loc] || (a ? a.label.charAt(0).toUpperCase() : '?'),
            cls: 'gib-c-' + (KNOWN[loc] ? loc : 'other')
        };
    }

    function icon(t) { return '<i class="gib-ic ' + t.cls + '" aria-hidden="true">' + esc(t.l) + '</i>'; }

    function bagKg(b) { return b.bags.reduce(function (s, x) { return s + (Number(x.kg) || 0); }, 0); }

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

    function areaOptions(exclude) {
        return state.areas.filter(function (a) { return a.code !== exclude; }).map(function (a) {
            return '<option value="' + esc(a.code) + '">' + esc(a.label) + '</option>';
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

    // ------------------------------------------------------------------ batch pieces

    function panelHtml(b) {
        var id = b.kernel_id, s = state.sel[id] || {}, nSel = Object.keys(s).length, mv = canMove();
        var movable = b.bags.filter(function (x) { return tagOf(x.loc).movable; });

        var chips = '<div class="gib-chips">' + groups(b).map(function (g) {
            var inner = icon(g) + esc(g.label) + ' · ' + g.n;
            return (g.movable && mv)
                ? '<button type="button" class="gib-chip js-gib-chip" data-kernel-id="' + esc(id) + '" data-loc="' + esc(g.key) + '" title="Pick all these bags">' + inner + '</button>'
                : '<span class="gib-chip is-ro" title="' + (g.movable ? '' : 'Set on the Silos screen') + '">' + inner + '</span>';
        }).join('') + '</div>';

        var range = '';
        if (mv && movable.length) {
            range = '<div class="gib-range">' +
                '<span>Bags</span><input type="text" inputmode="numeric" class="form-control form-control-sm gib-num js-gib-from" aria-label="From bag" value="' + movable[0].no + '">' +
                '<span>to</span><input type="text" inputmode="numeric" class="form-control form-control-sm gib-num js-gib-to" aria-label="To bag" value="' + movable[movable.length - 1].no + '">' +
                '<span>→ Move to</span><select class="form-select form-select-sm gib-select js-gib-range-area" aria-label="Move to">' + areaOptions() + '</select>' +
                '<button type="button" class="btn btn-sm btn-primary js-gib-range-move" data-kernel-id="' + esc(id) + '">Move</button></div>';
        } else if (!movable.length) {
            range = '<div class="gib-note">All ' + b.bags.length + ' bags are in silos or cracked. Those are set on the Silos screen.</div>';
        }

        var grid = '<div class="gib-bags">' + b.bags.map(function (x) {
            var t = tagOf(x.loc), on = !!s[x.no];
            return '<button type="button" class="gib-bag ' + t.cls + (t.movable ? '' : ' is-ro') + (on ? ' is-sel' : '') + '"' +
                ' data-kernel-id="' + esc(id) + '" data-bag-no="' + x.no + '" aria-pressed="' + on + '"' +
                ' title="Bag ' + x.no + ': ' + esc(t.label) + ' · ' + esc(kg(x.kg)) + ' kg">' +
                '<span class="gib-no">' + x.no + '</span><span class="gib-lt">' + esc(t.l) + '</span></button>';
        }).join('') + '</div>';

        var bar = '';
        if (mv && movable.length) {
            bar = '<div class="gib-pickbar">' + (nSel
                ? '<span class="gib-cnt">' + nSel + ' picked</span><span>Move to</span>' +
                  '<select class="form-select form-select-sm gib-select js-gib-pick-area" aria-label="Move picked bags to">' + areaOptions() + '</select>' +
                  '<button type="button" class="btn btn-sm btn-primary js-gib-pick-move" data-kernel-id="' + esc(id) + '">Move</button>' +
                  '<button type="button" class="btn btn-sm btn-outline-secondary js-gib-clear" data-kernel-id="' + esc(id) + '">Clear</button>'
                : '<span class="gib-cnt">Or tap bags to pick odd ones.</span><span class="gib-hint">Shift-click, or press and hold, picks a run.</span>') + '</div>';
        } else if (!mv) {
            bar = '<div class="gib-hint">You can see where the bags are. Ask an admin for access to move them.</div>';
        }
        return '<div class="gib-panel">' + chips + range + grid + bar + '</div>';
    }

    /** Bag summary (+ strip and panel when open) for a board card. Empty string until loaded. */
    function cardBlock(kernelId, showStrip) {
        if (!state.loaded) return '';
        var b = state.byId[kernelId];
        if (!b || !b.bags.length) return '<div class="gib-sum gib-sum-none">No bags recorded</div>';
        var open = !!state.open[kernelId];
        var date = _common.formatDateDDMMYYYY(b.received_date);
        return (showStrip || open ? strip(b) : '') +
            '<div class="gib-sum"><span>' + b.bags.length + (b.bags.length === 1 ? ' bag' : ' bags') + ' · ' + esc(summary(b)) + '</span>' +
            '<button type="button" class="gib-toggle js-gib-toggle" data-kernel-id="' + esc(kernelId) + '" aria-expanded="' + open + '">' + (open ? 'Hide bags ▴' : 'Bags ▾') + '</button></div>' +
            (open ? '<div class="gib-meta">' + (date ? 'Received ' + esc(date) + ' · ' : '') +
                'weighed ' + esc(kg(b.actual_wet_nis_kg != null ? b.actual_wet_nis_kg : bagKg(b))) + ' kg' +
                (b.wet_nis_received_kg != null ? ' · declared ' + esc(kg(b.wet_nis_received_kg)) + ' kg' : '') + '</div>' + panelHtml(b) : '');
    }

    /** Table "Bags" cell. */
    function tableCell(kernelId) {
        if (!state.loaded) return '';
        var b = state.byId[kernelId];
        if (!b || !b.bags.length) return '<span class="text-muted small">No bags recorded</span>';
        return '<div class="gib-cell">' + strip(b) + '<span>' + b.bags.length + (b.bags.length === 1 ? ' bag' : ' bags') + ' · ' + esc(summary(b)) + '</span></div>';
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
        await api.load();
        toastUndo(list.length + ' bags of ' + b.batch_number + ' moved to ' + label + '.', async function () {
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
                return '<option value="' + esc(b.kernel_id) + '">' + esc(b.batch_number) + ' · ' + esc(b.grower_name || '') + ' · ' + here(b).length + ' bags here</option>';
            }).join('') + '</select>' +
            '<div class="gib-range gib-range-plain mb-3"><span>Bags</span><input type="text" inputmode="numeric" class="form-control gib-num" id="gibDlgFrom" aria-label="From bag">' +
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

    // ------------------------------------------------------------------ storage cards

    function placeTotals(match) {
        var bags = 0, kgSum = 0, batches = 0;
        state.batches.forEach(function (b) {
            var n = 0;
            b.bags.forEach(function (x) { if (match(x.loc || '')) { n++; kgSum += Number(x.kg) || 0; } });
            if (n) { bags += n; batches++; }
        });
        return { bags: bags, kg: kgSum, batches: batches };
    }

    function renderStorage() {
        var $cards = $('#giStorageCards');
        if (!$cards.length) return;
        var $note = $('#giStorageNote');
        if (state.failed) {
            $cards.html('<div class="text-muted small">Could not load the bags. Refresh the page to try again.</div>');
            $note.text('');
            $('#giStorageDetail').prop('hidden', true);
            return;
        }
        if (!state.loaded) return;
        var mv = canMove(), html = '';

        var un = placeTotals(function (l) { return l === ''; });
        if (un.bags) {
            html += '<div class="gib-scard is-none' + (state.card === '' ? ' is-on' : '') + '">' +
                '<button type="button" class="gib-scard-main js-gib-card" data-code="">' +
                '<span class="gib-sn">' + icon(tagOf('')) + 'Not placed yet</span>' +
                '<span class="gib-sv">' + un.bags + '<small>bags</small></span>' +
                '<span class="gib-ss">' + esc(tonnes(un.kg)) + ' booked in without a place</span></button>' +
                '<div class="gib-scard-acts">' + (mv ? '<button type="button" class="btn btn-sm btn-primary js-gib-area-move" data-code="">Place them</button>' : '') + '</div></div>';
        }
        state.areas.forEach(function (a) {
            var p = placeTotals(function (l) { return l === a.code; });
            var cap = Number(a.capacity_kg) || 0;
            var pct = cap ? Math.min(100, p.kg / cap * 100) : null;
            var t = tagOf(a.code);
            html += '<div class="gib-scard' + (state.card === a.code ? ' is-on' : '') + '">' +
                '<button type="button" class="gib-scard-main js-gib-card" data-code="' + esc(a.code) + '">' +
                '<span class="gib-sn">' + icon(t) + esc(a.label) + '</span>' +
                '<span class="gib-sv">' + esc(_common.formatKg(p.kg / 1000, 1)) + '<small>t</small></span>' +
                (pct !== null
                    ? '<span class="gib-bar' + (pct > 90 ? ' is-full' : '') + '"><span class="' + t.cls + '" style="width:' + pct.toFixed(1) + '%"></span></span>' +
                      '<span class="gib-ss">' + Math.round(pct) + '% full · ' + (pct > 90 ? '<b class="gib-full">Full soon</b>' : 'room for ' + esc(tonnes(Math.max(0, cap - p.kg)))) + '</span>'
                    : '<span class="gib-ss">No capacity set</span>') +
                '<span class="gib-ss">' + p.bags + ' bags from ' + p.batches + ' batch' + (p.batches === 1 ? '' : 'es') + '</span></button>' +
                '<div class="gib-scard-acts">' + (mv && p.bags ? '<button type="button" class="btn btn-sm btn-outline-secondary js-gib-area-move" data-code="' + esc(a.code) + '">Move bags</button>' : '') + '</div></div>';
        });
        var si = placeTotals(function (l) { return l.indexOf('silo:') === 0; });
        html += '<div class="gib-scard is-silo' + (state.card === 'silos' ? ' is-on' : '') + '">' +
            '<button type="button" class="gib-scard-main js-gib-card" data-code="silos">' +
            '<span class="gib-sn">' + icon(tagOf('silo:1')) + 'In silos</span>' +
            '<span class="gib-sv">' + esc(_common.formatKg(si.kg / 1000, 1)) + '<small>t</small></span>' +
            '<span class="gib-ss">' + si.bags + ' bags, not cracked yet</span></button>' +
            '<div class="gib-scard-acts"><span class="gib-ss">Set on the Silos screen</span></div></div>';
        $cards.html(html);

        var noBags = state.batches.filter(function (b) { return !b.bags.length; }).length;
        $note.text(noBags ? noBags + (noBags === 1 ? ' batch has' : ' batches have') + ' no bags recorded, so ' + (noBags === 1 ? 'it is' : 'they are') + ' not counted here.' : '');
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
                '<span class="gib-dr">' + nos.length + ' bags · ' + esc(tonnes(kgSum)) +
                ' <button type="button" class="btn btn-link btn-sm p-0 ms-2 js-gib-open-batch" data-kernel-id="' + esc(b.kernel_id) + '">Open batch</button></span></div>');
        });
        $d.prop('hidden', false).html(
            '<div class="gib-dhead"><h3 class="h6 mb-0">Bags in ' + esc(title) + ' <span class="text-muted fw-normal">' + total + ' bags from ' + rows.length + ' batch' + (rows.length === 1 ? '' : 'es') + '</span></h3>' +
            '<button type="button" class="btn btn-sm btn-outline-secondary js-gib-close-detail">Close</button></div>' +
            (rows.join('') || '<div class="text-muted small">Nothing stored here.</div>'));
    }

    // ------------------------------------------------------------------ events

    function pick(b, no, run) {
        var s = state.sel[b.kernel_id] = state.sel[b.kernel_id] || {};
        var last = state.lastTap[b.kernel_id];
        if (run && last != null) {
            var lo = Math.min(last, no), hi = Math.max(last, no);
            b.bags.forEach(function (x) { if (x.no >= lo && x.no <= hi && tagOf(x.loc).movable) s[x.no] = 1; });
        } else if (s[no]) {
            delete s[no];
        } else {
            s[no] = 1;
        }
        state.lastTap[b.kernel_id] = no;
    }

    function bind() {
        var $doc = $(document);
        $doc.off(NS);
        $doc.on('click' + NS, '.js-gib-toggle', function (e) {
            e.preventDefault(); e.stopPropagation();
            var id = $(this).data('kernel-id');
            if (!isUuid(id)) return;
            state.open[id] = !state.open[id];
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
            pick(b, no, e.shiftKey || state.longPress);
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
            rerenderGrid();
        });
        $doc.on('click' + NS, '.js-gib-clear', function (e) {
            e.preventDefault(); e.stopPropagation();
            state.sel[$(this).data('kernel-id')] = {};
            rerenderGrid();
        });
        $doc.on('click' + NS, '.js-gib-pick-move', function (e) {
            e.preventDefault(); e.stopPropagation();
            var b = state.byId[$(this).data('kernel-id')];
            if (!b) return;
            var to = $(this).closest('.gib-pickbar').find('.js-gib-pick-area').val();
            move(b, Object.keys(state.sel[b.kernel_id] || {}).map(Number), to, false);
        });
        $doc.on('click' + NS, '.js-gib-range-move', function (e) {
            e.preventDefault(); e.stopPropagation();
            var b = state.byId[$(this).data('kernel-id')];
            if (!b) return;
            var $r = $(this).closest('.gib-range');
            var f = parseInt($r.find('.js-gib-from').val(), 10), t = parseInt($r.find('.js-gib-to').val(), 10);
            if (!(f >= 1 && t >= f)) { _common.showErrorToast('Enter bag numbers, like 1 to 10.'); return; }
            var nos = b.bags.filter(function (x) { return x.no >= f && x.no <= t; }).map(function (x) { return x.no; });
            move(b, nos, $r.find('.js-gib-range-area').val(), false);
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
        $doc.on('click' + NS, '.js-gib-open-batch', function (e) {
            e.preventDefault();
            var id = $(this).data('kernel-id');
            if (!isUuid(id)) return;
            state.open[id] = true;
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
            state.lastTap = {};
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
            }
            renderStorage();
            rerenderGrid();
        },

        cardBlock: cardBlock,
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
