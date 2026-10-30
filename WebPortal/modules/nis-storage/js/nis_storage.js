/**
 * Silos & storage (Storage areas tab) — nut-in-shell stock by storage area, with moves between areas.
 *
 * Loads from dataFunctions.getNisStorageOverview(). Moving stock and editing capacity need the
 * nis_storage.move action. The server re-validates every move; client checks are courtesy only.
 *
 * Security invariant: DB-sourced text goes into the DOM via .text() or option labels, never innerHTML.
 */
var _nisStorage = (function () {
    'use strict';

    var NS = '.nisStorage';
    var state = { ov: null, wantPlace: false };

    function isAdminRole() {
        try {
            var u = (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
            var rn = u ? (u.role_name || u.role || '') : '';
            if (rn && typeof rn === 'object') rn = rn.name || rn.role_name || '';
            rn = String(rn || '').toLowerCase();
            return rn === 'super_user' || rn === 'admin';
        } catch (e) { return false; }
    }

    function canMove() {
        return typeof window.hasAction === 'function' && window.hasAction('nis_storage.move');
    }

    function fmtT(kg) {
        return Number((Number(kg) || 0) / 1000).toLocaleString('en-ZA', { maximumFractionDigits: 1 }) + ' t';
    }

    function fmtKg(n) {
        return Number(n || 0).toLocaleString('en-ZA', { maximumFractionDigits: 2 }).replace(/ /g, ' ');
    }

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function fmtDate(v) {
        if (!v) return '';
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
        if (m) return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1];
        var d = new Date(v);
        return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()];
    }
    function fmtDateFull(v) {
        if (!v) return '';
        var d = new Date(v);
        if (isNaN(d)) return String(v);
        return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    function todayStr() {
        var d = new Date();
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function areaOf(code) {
        return (state.ov.areas || []).filter(function (x) { return x.code === code; })[0];
    }

    function areaLabel(code) {
        if (code == null) return null;
        var a = areaOf(code);
        return a ? a.label : String(code);
    }

    function el(tag, cls, text) {
        var $e = $('<' + tag + '>');
        if (cls) $e.addClass(cls);
        if (text != null) $e.text(text);
        return $e;
    }

    function option(value, text) {
        return $('<option>').val(value).text(text);
    }

    function buildCard(a) {
        var $c = el('div', 'nis-card');
        var cap = Number(a.capacity_kg || 0);
        var rawPct = cap > 0 ? Math.round((Number(a.kg || 0) / cap) * 100) : 0;
        var $top = el('div', 'nis-card-top');
        $top.append(el('strong', 'nis-card-name', a.label));
        if (cap > 0) $top.append(el('span', 'nis-card-pct', rawPct + '% full'));
        $c.append($top);
        $c.append(el('div', 'nis-card-kg', fmtT(a.kg)));
        var meta = (a.batch_count || 0) + ' batch' + (a.batch_count === 1 ? '' : 'es');
        if (a.oldest_in) meta += ' · oldest ' + fmtDate(a.oldest_in);
        $c.append(el('div', 'nis-card-meta', meta));
        if (cap > 0) {
            var pct = Math.min(100, rawPct);
            var $bar = el('div', 'nis-bar').attr({ role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': a.label + ' capacity used' });
            $bar.append(el('div', 'nis-bar-fill' + (rawPct > 85 ? ' nis-bar-warn' : '')).css('width', pct + '%'));
            $c.append($bar);
            var $cap = el('div', 'nis-card-cap');
            $cap.append(el('span', null, 'of ' + fmtT(cap) + ' capacity'));
            if (canMove()) {
                $cap.append(el('button', 'nis-icon-btn nis-edit-cap').attr({ type: 'button', 'aria-label': 'Edit capacity for ' + a.label, 'data-code': a.code })
                    .append('<i class="fas fa-pen" aria-hidden="true"></i>'));
            }
            $c.append($cap);
        } else if (canMove()) {
            $c.append(el('div', 'nis-card-cap', 'No capacity set'));
            $c.append(el('button', 'nis-link-btn nis-edit-cap', 'Set capacity').attr({ type: 'button', 'data-code': a.code, 'aria-label': 'Set capacity for ' + a.label }));
        }
        return $c;
    }

    function buildBanner(ov) {
        var $b = el('div', 'nis-banner').attr('role', 'alert');
        $b.append($('<div>').append(el('strong', null, fmtT(ov.unplaced_kg) + ' not placed yet.')).append(document.createTextNode(' Booked in without a storage area.')));
        if (canMove()) $b.append(el('button', 'btn btn-primary nis-btn', 'Place it').attr({ type: 'button', id: 'nisPlaceBtn' }));
        return $b;
    }

    function buildQuestion() {
        var $q = el('div', 'nis-question');
        $q.append(el('strong', null, 'Question for Mike and Thando:'));
        $q.append(document.createTextNode(" when nuts go from Silo storage into a silo and get cracked, should that take them out of Silo storage by itself? Today it doesn't, so the Silo storage total only ever goes up."));
        return $q;
    }

    function placeDialog() {
        var batches = (state.ov && state.ov.unplaced_batches) || [];
        if (!batches.length) { _common.showErrorToast('Nothing is waiting to be placed.'); return; }
        var $w = el('div', 'nis-place');
        var $bs = $('<select class="form-select" id="nisPlBatch"></select>');
        batches.forEach(function (x, i) { $bs.append(option(String(i), (x.batch_number || 'No batch no.') + ' · ' + fmtKg(x.kg) + ' kg')); });
        var $as = $('<select class="form-select" id="nisPlArea"></select>').append(option('', 'Pick a storage area'));
        (state.ov.areas || []).forEach(function (x) { $as.append(option(x.code, x.label)); });
        var $kg = $('<input type="number" class="form-control" id="nisPlKg" min="0" step="any" inputmode="decimal">').val(batches[0].kg);
        var $note = $('<input type="text" class="form-control" id="nisPlNote" maxlength="200">');
        $bs.on('change', function () { var x = batches[Number($bs.val())]; if (x) $kg.val(x.kg); });
        $w.append(el('label', 'nis-field', 'Batch').append($bs));
        $w.append(el('label', 'nis-field', 'Storage area').append($as));
        $w.append(el('label', 'nis-field', 'Kg').append($kg));
        $w.append(el('label', 'nis-field', 'Note').append($note));
        Swal.fire({
            title: 'Place stock',
            html: $w[0],
            showCancelButton: true,
            confirmButtonText: 'Place it',
            preConfirm: function () {
                var batch = batches[Number($bs.val())];
                var area = $as.val();
                var kg = Number($kg.val());
                if (!batch) { Swal.showValidationMessage('Pick a batch.'); return false; }
                if (!area) { Swal.showValidationMessage('Pick a storage area.'); return false; }
                if (!(kg > 0)) { Swal.showValidationMessage('Kg must be more than zero.'); return false; }
                if (kg > Number(batch.kg) + 0.0001) { Swal.showValidationMessage('That batch only has ' + fmtKg(batch.kg) + ' kg.'); return false; }
                return dataFunctions.recordNisStorageMovement({
                    fromArea: null, toArea: area, kg: kg, kernelId: batch.kernel_id, batchNumber: batch.batch_number,
                    movedAt: todayStr(), note: String($note.val() || '').trim() || null
                }).then(function (res) {
                    if (res && res.success) return true;
                    Swal.showValidationMessage((res && res.error) ? String(res.error) : 'Could not place the stock.');
                    return false;
                });
            }
        }).then(function (r) {
            if (r.isConfirmed) { _common.showSuccessToast('Stock placed.'); reload(); }
        });
    }

    function buildForm(ov) {
        var $f = el('div', 'nis-panel nis-form').attr('id', 'nisMoveForm');
        $f.append(el('h2', 'nis-h2', 'Move nut in shell'));
        var $g = el('div', 'nis-grid nis-move-row');

        var $from = $('<select class="form-select" id="nisFrom"></select>').append(option('', 'Not placed yet'));
        var $to = $('<select class="form-select" id="nisTo"></select>');
        (ov.areas || []).forEach(function (a) { $from.append(option(a.code, a.label)); $to.append(option(a.code, a.label)); });
        $to.append(option('__out', 'Cracked / used'));

        $g.append(el('label', 'nis-field', 'From').append($from));
        $g.append(el('label', 'nis-field', 'To').append($to));
        $g.append(el('label', 'nis-field', 'Batch').append($('<select class="form-select" id="nisBatch"></select>')));
        $g.append(el('label', 'nis-field', 'Kg').append($('<input type="number" class="form-control" id="nisKg" min="0" step="any" inputmode="decimal" placeholder="All of it">')));
        $g.append(el('label', 'nis-field', 'Date').append($('<input type="date" class="form-control" id="nisDate">').val(todayStr())));
        $g.append(el('label', 'nis-field', 'Note').append($('<input type="text" class="form-control" id="nisNote" maxlength="200">')));
        $g.append(el('button', 'btn btn-primary nis-btn', 'Record move').attr({ type: 'button', id: 'nisSave' }));
        $f.append($g);
        $f.append(el('div', 'nis-hint', 'Logged under the person signed in, so each person needs their own login on their own phone.'));
        return $f;
    }

    function batchesFor(code) {
        if (!code) return state.ov.unplaced_batches || [];
        var a = areaOf(code);
        return a ? (a.batches || []) : [];
    }

    function fillBatches() {
        var from = $('#nisFrom').val() || null;
        var list = batchesFor(from);
        var name = areaLabel(from) || 'Not placed yet';
        var $b = $('#nisBatch').empty();
        $b.append(option('', list.length ? 'Pick a batch in ' + name : 'No stock in ' + name));
        list.forEach(function (b, i) {
            $b.append(option(String(i), (b.batch_number || 'No batch no.') + ' · ' + fmtKg(b.kg) + ' kg'));
        });
    }

    function areaCell(m) {
        var from = areaLabel(m.from_area), to = areaLabel(m.to_area);
        if (m.movement_type === 'in' || (!m.from_area && m.to_area)) return '→ ' + to;
        if (m.movement_type === 'out' || (m.from_area && !m.to_area)) return from + ' →';
        return (from || 'Not placed') + ' → ' + (to || '');
    }

    function buildMoves(ov) {
        var $p = el('div', 'nis-panel nis-moves');
        $p.append(el('div', 'nis-h2', 'Movements'));
        var $t = el('table', 'table nis-table');
        var $hr = $('<tr>');
        [['When'], ['What'], ['Batch'], ['Area'], ['Kg', 'nis-r'], ['By']].forEach(function (h) {
            $hr.append(el('th', 'nis-th ' + (h[1] || ''), h[0]).attr('scope', 'col'));
        });
        $t.append($('<thead>').append($hr));
        var $tb = $('<tbody>');
        var moves = ov.movements || [];
        if (!moves.length) {
            $tb.append($('<tr>').append(el('td', 'text-muted', 'No movements yet.').attr('colspan', 6)));
        }
        moves.forEach(function (m) {
            var chip = m.movement_type === 'in' ? ['Placed in', 'nis-chip-in'] : (m.movement_type === 'out' ? ['Cracked / used', 'nis-chip-out'] : ['Moved', 'nis-chip-move']);
            var sign = m.movement_type === 'in' ? '+' : (m.movement_type === 'out' ? '−' : '');
            var $r = $('<tr>');
            $r.append(el('td', null, fmtDateFull(m.moved_at)));
            $r.append($('<td>').append(el('span', 'nis-chip ' + chip[1], chip[0])));
            $r.append(el('td', null, m.batch_number || ''));
            $r.append(el('td', null, areaCell(m)));
            $r.append(el('td', 'nis-r', sign + fmtKg(m.kg)));
            $r.append(el('td', null, m.by_label || ''));
            $tb.append($r);
        });
        $t.append($tb);
        $p.append($t);
        $p.append(el('div', 'nis-hint nis-foot', 'The four areas plus ‘not placed yet’ always add up to the system total.'));
        return $p;
    }

    function render() {
        var ov = state.ov;
        var $body = $('#nisBody').empty();
        if (!ov || ov.success === false) {
            $body.append(el('div', 'nis-panel nis-form', 'Storage areas are not available yet.'));
            return;
        }
        if (Number(ov.unplaced_kg) > 0) $body.append(buildBanner(ov));
        var $cards = el('div', 'nis-cards');
        (ov.areas || []).forEach(function (x) { $cards.append(buildCard(x)); });
        $body.append($cards);

        if (canMove()) $body.append(buildForm(ov));
        $body.append(buildMoves(ov));
        if (isAdminRole()) $body.append(buildQuestion());
        if (canMove()) fillBatches();
    }

    function reload() {
        return dataFunctions.getNisStorageOverview(200).then(function (ov) {
            state.ov = ov;
            render();
            if (state.wantPlace) {
                state.wantPlace = false;
                if (canMove() && Number(ov && ov.unplaced_kg) > 0) placeDialog();
            }
        });
    }

    function save() {
        var from = $('#nisFrom').val() || null;
        var toRaw = $('#nisTo').val();
        var to = toRaw === '__out' ? null : toRaw;
        var idx = $('#nisBatch').val();
        var batch = (idx === '' || idx == null) ? null : batchesFor(from)[Number(idx)];
        if (!batch) { _common.showErrorToast('Pick a batch first.'); return; }
        if (from && from === to) { _common.showErrorToast('From and To must be different.'); return; }
        if (!from && to === null) { _common.showErrorToast('Stock that is not placed yet must go into an area first.'); return; }
        var kgRaw = String($('#nisKg').val() || '').trim();
        var kg = kgRaw === '' ? Number(batch.kg) : Number(kgRaw);
        if (!(kg > 0)) { _common.showErrorToast('Kg must be more than zero.'); return; }
        if (kg > Number(batch.kg) + 0.0001) { _common.showErrorToast('That batch only has ' + fmtKg(batch.kg) + ' kg.'); return; }

        var $btn = $('#nisSave').prop('disabled', true);
        dataFunctions.recordNisStorageMovement({
            fromArea: from,
            toArea: to,
            kg: kg,
            kernelId: batch.kernel_id,
            batchNumber: batch.batch_number,
            movedAt: $('#nisDate').val() || todayStr(),
            note: String($('#nisNote').val() || '').trim() || null
        }).then(function (res) {
            if (res && res.success) {
                _common.showSuccessToast('Move saved.');
                return reload();
            }
            _common.showErrorToast((res && res.error) ? String(res.error) : 'Could not save the move.');
            $btn.prop('disabled', false);
        });
    }

    function editCapacity(code) {
        var a = areaOf(code);
        if (!a) return;
        Swal.fire({
            title: 'Capacity for ' + a.label,
            input: 'number',
            inputLabel: 'Kg (leave blank to hide the capacity bar)',
            inputValue: a.capacity_kg || '',
            inputAttributes: { min: 0, step: 'any' },
            showCancelButton: true,
            confirmButtonText: 'Save'
        }).then(function (r) {
            if (!r.isConfirmed) return;
            var v = String(r.value == null ? '' : r.value).trim();
            var kg = v === '' ? null : Number(v);
            if (kg !== null && !(kg >= 0)) { _common.showErrorToast('Enter a number of kg.'); return; }
            dataFunctions.setNisStorageAreaCapacity(code, kg).then(function (res) {
                if (res && res.success) { _common.showSuccessToast('Capacity saved.'); reload(); }
                else _common.showErrorToast((res && res.error) ? String(res.error) : 'Could not save the capacity.');
            });
        });
    }

    function bind() {
        var $m = $('#nisModule');
        $m.off(NS);
        $m.on('change' + NS, '#nisFrom', fillBatches);
        $m.on('click' + NS, '#nisSave', save);
        $m.on('click' + NS, '.nis-edit-cap', function () { editCapacity($(this).attr('data-code')); });
        $m.on('click' + NS, '#nisPlaceBtn', placeDialog);
        $m.on('click' + NS, '[data-nss-tab="silos"]', function () { _appRouter.routeTo('silo-allocation-grid', true); });
    }

    function init() {
        var h = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('nis-storage') : null;
        // The menu opens Silos first; Storage areas shows only when asked for (its tab, or "Place it" on My Day).
        if (!h || (h.tab !== 'areas' && !h.place)) { _appRouter.routeTo('silo-allocation-grid', true); return; }
        state.wantPlace = !!(h && h.place);
        bind();
        reload();
    }

    return { init: init };
})();
window._nisStorage = _nisStorage;
