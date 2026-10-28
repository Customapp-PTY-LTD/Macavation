/**
 * Kernel style prices — Pete's price per kg per kernel style, with history.
 *
 * Loads from dataFunctions.getKernelStylePrices(customerId). Viewing needs kernel_prices.view
 * (no data call is made without it); saving prices and changing the pricing mode need
 * kernel_prices.edit. Save sends only the rows whose value changed.
 *
 * Security invariant: DB-sourced text goes into the DOM via .text() or attr(), never innerHTML.
 */
var _kernelStylePrices = (function () {
    'use strict';

    var NS = '.kspPrices';
    var MODES = [
        { key: 'single', label: 'One price for everyone' },
        { key: 'per_customer', label: 'Price per customer' },
        { key: 'per_dispatch', label: 'Set on each dispatch' }
    ];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var state = { data: null, customerId: null, open: {} };

    function has(key) {
        return typeof window.hasAction === 'function' && window.hasAction(key);
    }

    function el(tag, cls, text) {
        var $e = $('<' + tag + '>');
        if (cls) $e.addClass(cls);
        if (text != null) $e.text(text);
        return $e;
    }

    function money(n) {
        var v = Number(n || 0);
        return 'R ' + v.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ',');
    }

    function fmtDate(v) {
        if (!v) return '';
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
        if (m) return Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1];
        var d = new Date(v);
        return isNaN(d) ? '' : d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
    }

    function todayStr() {
        var d = new Date();
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function styleLabel(code) {
        var s = (state.data.styles || []).filter(function (x) { return x.style_code === code; })[0];
        return s && s.label ? s.label : code;
    }

    // The price a row currently shows in the input column.
    function currentPrice(s) {
        return state.customerId ? s.customer_price : s.list_price;
    }

    function carton(price) {
        var n = Number(price);
        if (price === '' || price == null || !isFinite(n)) return '';
        return money(n * Number(state.data.kg_per_carton || 11.34));
    }

    function buildMode(d) {
        var edit = has('kernel_prices.edit');
        var $p = el('div', 'ksp-panel ksp-mode');
        var $t = el('div');
        $t.append(el('div', 'ksp-strong', 'How prices work'));
        $t.append(el('div', 'ksp-muted', 'You can change this later without losing any prices.'));
        $p.append($t);
        var $seg = el('div', 'ksp-seg').attr({ role: 'group', 'aria-label': 'Pricing mode' });
        MODES.forEach(function (m) {
            var on = d.mode === m.key;
            $seg.append(el('button', 'ksp-seg-btn' + (on ? ' is-active' : ''), m.label)
                .attr({ type: 'button', 'data-mode': m.key, 'aria-pressed': on ? 'true' : 'false' })
                .prop('disabled', !edit));
        });
        $p.append($seg);
        return $p;
    }

    function buildTable(d) {
        var edit = has('kernel_prices.edit');
        var $p = el('div', 'ksp-panel ksp-main');

        var $bar = el('div', 'ksp-bar');
        $bar.append(el('div', 'ksp-h2', 'Price list'));
        var $right = el('div', 'd-flex flex-wrap gap-3 align-items-center');
        if (d.mode === 'per_customer') {
            var $sel = $('<select class="form-select" id="kspCustomer"></select>').append($('<option>').val('').text('List price for everyone'));
            (d.customers || []).forEach(function (c) { $sel.append($('<option>').val(c.id).text(c.name)); });
            $sel.val(state.customerId || '');
            $right.append(el('label', 'ksp-inline', 'Prices for').append($sel));
        }
        if (edit) {
            $right.append(el('label', 'ksp-inline', 'New prices apply from')
                .append($('<input type="date" class="form-control" id="kspFrom">').val(todayStr())));
        }
        $bar.append($right);
        $p.append($bar);

        if (d.mode === 'per_dispatch') {
            $p.append(el('div', 'ksp-muted ksp-note', 'Pete types the price on each dispatch; these prices fill it in as a starting point.'));
        }

        var $t = el('table', 'table ksp-table');
        var $hr = $('<tr>');
        [['Style'], ['Price per kg (excl. VAT)'], ['Per ' + (d.kg_per_carton || 11.34) + ' kg carton', 'ksp-r'], ['Last changed']].forEach(function (h) {
            $hr.append(el('th', 'ksp-th ' + (h[1] || ''), h[0]).attr('scope', 'col'));
        });
        $t.append($('<thead>').append($hr));
        var $tb = $('<tbody>');
        (d.styles || []).forEach(function (s) {
            var cur = currentPrice(s);
            var $r = $('<tr>');
            var $name = $('<td>').append(el('strong', null, s.style_code)).append(document.createTextNode(' ')).append(el('span', 'ksp-tiny', s.label || ''));
            $r.append($name);

            var $in = $('<input type="number" class="form-control ksp-input ksp-val" min="0" step="0.01" inputmode="decimal">')
                .attr({ 'data-code': s.style_code, 'aria-label': 'Price per kg for ' + (s.label || s.style_code) })
                .val(cur == null ? '' : cur)
                .attr('data-orig', cur == null ? '' : String(cur))
                .prop('readonly', !edit);
            if (state.customerId) $in.attr('placeholder', s.list_price == null ? '' : String(s.list_price));
            var $cell = el('td').append(el('label', 'ksp-price').append(el('span', 'ksp-muted', 'R')).append($in));
            if (state.customerId) {
                $cell.append(el('div', 'ksp-tiny', 'List price ' + (s.list_price == null ? 'not set' : money(s.list_price))));
            }
            $r.append($cell);

            var shown = cur == null || cur === '' ? (state.customerId ? s.list_price : null) : cur;
            $r.append(el('td', 'ksp-r ksp-muted ksp-carton', shown == null ? '' : carton(shown)));

            var from = state.customerId ? s.customer_from : s.list_from;
            var by = s.list_changed_by;
            var txt = from ? fmtDate(from) + (by && !state.customerId ? ' · ' + by : '') : 'Not set yet';
            $r.append(el('td', 'ksp-tiny', txt));
            $tb.append($r);
        });
        $t.append($tb);
        $p.append($t);

        if (edit) {
            $p.append($('<div class="ksp-actions">').append(
                el('button', 'btn btn-primary ksp-btn', 'Save prices').attr({ type: 'button', id: 'kspSave' })));
        }
        return $p;
    }

    function buildHistory(d) {
        var $c = el('div', 'ksp-panel ksp-side-card');
        $c.append(el('div', 'ksp-h2', 'Price history'));
        $c.append(el('div', 'ksp-muted', 'A dispatch keeps the price it was sold at. Changing a price only affects dispatches approved after the new date.'));
        var hist = d.history || [];
        var currentIdx = -1;
        hist.forEach(function (h, i) { if (currentIdx < 0 && !h.is_future && !h.customer_id) currentIdx = i; });
        if (!hist.length) $c.append(el('div', 'ksp-tiny', 'No prices have been set yet.'));
        hist.forEach(function (h, i) {
            var $row = el('div', 'ksp-hist-row');
            var $l = el('span');
            $l.append(el('strong', null, 'From ' + fmtDate(h.effective_from)));
            $l.append(el('div', 'ksp-tiny', (h.customer_id ? (h.customer_name || 'Customer') : 'List price')));
            var n = h.styles_changed != null ? h.styles_changed : (h.prices || []).length;
            $l.append(el('div', 'ksp-tiny', n + ' style' + (n === 1 ? '' : 's') + ' changed' + (h.changed_by ? ' by ' + h.changed_by : '')));
            $row.append($l);
            var $r = el('span', 'd-flex flex-column align-items-end');
            if (h.is_future) $r.append(el('span', 'ksp-chip ksp-chip-future', 'Starts ' + fmtDate(h.effective_from)));
            else if (i === currentIdx) $r.append(el('span', 'ksp-chip ksp-chip-current', 'Current'));
            var open = !!state.open[i];
            $r.append(el('button', 'ksp-link-btn ksp-view', open ? 'Hide' : 'View').attr({ type: 'button', 'data-i': i, 'aria-expanded': open ? 'true' : 'false' }));
            $row.append($r);
            $c.append($row);
            if (open) {
                var $ul = el('ul', 'ksp-hist-detail');
                (h.prices || []).forEach(function (p) {
                    $ul.append(el('li', null, styleLabel(p.style_code) + ' · ' + money(p.price_per_kg) + '/kg'));
                });
                $c.append($ul);
            }
        });
        return $c;
    }

    function render() {
        var d = state.data;
        var $body = $('#ksp-body').empty();
        if (!d || d.success === false) {
            $body.append(el('div', 'ksp-panel ksp-side-card', 'Style prices are not available yet.'));
            return;
        }
        $body.append(buildMode(d));
        var $split = el('div', 'ksp-split');
        $split.append(buildTable(d));
        $split.append(el('div', 'ksp-side').append(buildHistory(d)));
        $body.append($split);
    }

    function reload() {
        return dataFunctions.getKernelStylePrices(state.customerId || null, null).then(function (d) {
            state.data = d;
            render();
        });
    }

    function changedRows() {
        var rows = [], bad = false;
        $('#ksp-body .ksp-val').each(function () {
            var $i = $(this);
            var v = String($i.val()).trim();
            if (v === '' || v === $i.attr('data-orig')) return;
            var n = Number(v);
            if (!isFinite(n) || n < 0) { bad = true; return; }
            if ($i.attr('data-orig') !== '' && Number($i.attr('data-orig')) === n) return;
            rows.push({ style_code: $i.attr('data-code'), price_per_kg: n });
        });
        return bad ? null : rows;
    }

    function save() {
        var from = $('#kspFrom').val() || todayStr();
        var rows = changedRows();
        if (rows === null) { _common.showErrorToast('Prices must be numbers, zero or more.'); return; }
        if (!rows.length) { _common.showErrorToast('No prices have changed.'); return; }
        var who = state.customerId
            ? ((state.data.customers || []).filter(function (c) { return String(c.id) === String(state.customerId); })[0] || {}).name
            : null;
        Swal.fire({
            title: 'Save prices?',
            text: rows.length + ' price' + (rows.length === 1 ? '' : 's') + ' change from ' + fmtDate(from) + (who ? ' for ' + who : '') + '.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Save prices'
        }).then(function (r) {
            if (!r.isConfirmed) return;
            $('#kspSave').prop('disabled', true);
            dataFunctions.saveKernelStylePrices(from, rows, state.customerId || null).then(function (res) {
                if (res && res.success) {
                    _common.showSuccessToast('Prices saved.');
                    reload();
                } else {
                    _common.showErrorToast((res && res.error) ? String(res.error) : 'Could not save the prices.');
                    $('#kspSave').prop('disabled', false);
                }
            });
        });
    }

    function changeMode(mode) {
        if (!state.data || mode === state.data.mode) return;
        var label = MODES.filter(function (m) { return m.key === mode; })[0].label;
        Swal.fire({
            title: 'Change how prices work?',
            text: 'Switch to “' + label + '”. No prices are lost.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Change'
        }).then(function (r) {
            if (!r.isConfirmed) return;
            dataFunctions.setKernelPricingMode(mode).then(function (res) {
                if (res && res.success) {
                    _common.showSuccessToast('Pricing mode changed.');
                    state.customerId = null;
                    reload();
                } else {
                    _common.showErrorToast((res && res.error) ? String(res.error) : 'Could not change the pricing mode.');
                }
            });
        });
    }

    function bind() {
        var $m = $('#ksp-module');
        $m.off(NS);
        $m.on('click' + NS, '.ksp-seg-btn', function () { changeMode($(this).attr('data-mode')); });
        $m.on('click' + NS, '#kspSave', save);
        $m.on('change' + NS, '#kspCustomer', function () { state.customerId = $(this).val() || null; reload(); });
        $m.on('input' + NS, '.ksp-val', function () {
            var $i = $(this);
            var v = String($i.val()).trim();
            var s = (state.data.styles || []).filter(function (x) { return x.style_code === $i.attr('data-code'); })[0];
            var use = v === '' ? (state.customerId && s ? s.list_price : null) : v;
            $i.closest('tr').find('.ksp-carton').text(use == null ? '' : carton(use));
        });
        $m.on('click' + NS, '.ksp-view', function () {
            var i = $(this).attr('data-i');
            state.open[i] = !state.open[i];
            $('#ksp-body .ksp-side').empty().append(buildHistory(state.data));
        });
    }

    function init() {
        var $body = $('#ksp-body');
        bind();
        state.customerId = null;
        state.open = {};
        if (!has('kernel_prices.view')) {
            $body.empty().append(el('div', 'ksp-panel ksp-side-card', 'Prices are only shown to Pete, Mike and super users.'));
            return;
        }
        reload();
    }

    return { init: init };
})();
window._kernelStylePrices = _kernelStylePrices;
