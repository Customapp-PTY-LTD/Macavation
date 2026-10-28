/**
 * NIS storage areas — nut-in-shell stock by storage area, with moves between areas.
 *
 * Loads from dataFunctions.getNisStorageOverview(). Moving stock and editing capacity need the
 * nis_storage.move action. The server re-validates every move; client checks are courtesy only.
 *
 * Security invariant: DB-sourced text goes into the DOM via .text() or option labels, never innerHTML.
 */
var _nisStorage = (function () {
    'use strict';

    var NS = '.nisStorage';
    var state = { ov: null };

    function canMove() {
        return typeof window.hasAction === 'function' && window.hasAction('nis_storage.move');
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
        $c.append(el('div', 'nis-card-name', a.label));
        $c.append(el('div', 'nis-card-kg', fmtKg(a.kg) + ' kg'));
        var meta = (a.batch_count || 0) + ' batch' + (a.batch_count === 1 ? '' : 'es');
        if (a.oldest_in) meta += ' · oldest ' + fmtDate(a.oldest_in);
        $c.append(el('div', 'nis-card-meta', meta));
        var cap = Number(a.capacity_kg || 0);
        if (cap > 0) {
            var pct = Math.min(100, Math.round((Number(a.kg || 0) / cap) * 100));
            var $bar = el('div', 'nis-bar').attr({ role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, 'aria-label': a.label + ' capacity used' });
            $bar.append(el('div', 'nis-bar-fill' + (Number(a.kg) > cap ? ' nis-bar-warn' : '')).css('width', pct + '%'));
            $c.append($bar);
            var $cap = el('div', 'nis-card-cap');
            $cap.append(el('span', null, 'Capacity ' + fmtKg(cap) + ' kg'));
            if (canMove()) {
                $cap.append(el('button', 'nis-icon-btn nis-edit-cap').attr({ type: 'button', 'aria-label': 'Edit capacity for ' + a.label, 'data-code': a.code })
                    .append('<i class="fas fa-pen" aria-hidden="true"></i>'));
            }
            $c.append($cap);
        } else if (canMove()) {
            $c.append(el('button', 'nis-link-btn nis-edit-cap', 'Set capacity').attr({ type: 'button', 'data-code': a.code, 'aria-label': 'Set capacity for ' + a.label }));
        }
        return $c;
    }

    function buildUnplacedCard(ov) {
        var $c = el('div', 'nis-card nis-card-unplaced');
        $c.append(el('div', 'nis-card-name', 'Not placed yet'));
        $c.append(el('div', 'nis-card-kg', fmtKg(ov.unplaced_kg) + ' kg'));
        $c.append(el('div', 'nis-card-meta', 'Stock the system holds that is not in any area yet. Move it into an area below.'));
        return $c;
    }

    function buildForm(ov) {
        var $f = el('div', 'nis-panel nis-form').attr('id', 'nisMoveForm');
        $f.append(el('h2', 'nis-h2', 'Move stock'));
        var $g = el('div', 'nis-grid');

        var $from = $('<select class="form-select" id="nisFrom"></select>').append(option('', 'Not placed yet'));
        var $to = $('<select class="form-select" id="nisTo"></select>');
        (ov.areas || []).forEach(function (a) { $from.append(option(a.code, a.label)); $to.append(option(a.code, a.label)); });
        $to.append(option('__out', 'Cracked / used'));

        $g.append(el('label', 'nis-field', 'From').append($from));
        $g.append(el('label', 'nis-field', 'To').append($to));
        $g.append(el('label', 'nis-field nis-span2', 'Batch').append($('<select class="form-select" id="nisBatch"></select>')));
        $g.append(el('label', 'nis-field', 'Kg moved').append($('<input type="number" class="form-control" id="nisKg" min="0" step="any" inputmode="decimal" placeholder="All of it">')));
        $g.append(el('label', 'nis-field', 'Date').append($('<input type="date" class="form-control" id="nisDate">').val(todayStr())));
        $g.append(el('label', 'nis-field nis-span2', 'Note').append($('<input type="text" class="form-control" id="nisNote" maxlength="200">')));
        $f.append($g);
        $f.append(el('div', 'nis-hint', 'Logged under the person signed in, so each person needs their own login on their own phone.'));
        $f.append(el('button', 'btn btn-primary nis-btn', 'Save move').attr({ type: 'button', id: 'nisSave' }));
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
            $('#nisSub').text('');
            $('#nisJumpMove').prop('hidden', true);
            $body.append(el('div', 'nis-panel nis-form', 'Storage areas are not available yet.'));
            return;
        }
        $('#nisSub').text('Total ' + fmtKg(ov.pool_kg) + ' kg in the system.');
        var $cards = el('div', 'nis-cards');
        (ov.areas || []).forEach(function (a) { $cards.append(buildCard(a)); });
        $cards.append(buildUnplacedCard(ov));
        $body.append($cards);

        var $split = el('div', 'nis-split');
        var move = canMove();
        if (move) $split.append(buildForm(ov));
        $('#nisJumpMove').prop('hidden', !move);
        $split.append(buildMoves(ov));
        $body.append($split);
        if (move) fillBatches();
    }

    function reload() {
        return dataFunctions.getNisStorageOverview(200).then(function (ov) {
            state.ov = ov;
            render();
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
        $m.on('click' + NS, '#nisJumpMove', function () {
            var f = document.getElementById('nisMoveForm');
            if (f) { f.scrollIntoView({ behavior: 'smooth', block: 'start' }); $('#nisFrom').trigger('focus'); }
        });
    }

    function init() {
        bind();
        reload();
    }

    return { init: init };
})();
window._nisStorage = _nisStorage;
