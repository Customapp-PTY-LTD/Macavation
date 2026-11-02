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
    var REM_DEFAULTS = { enabled: true, max_age_days: 30, frequency: 'weekly', scope: 'in_stock', remind_missing: true };
    var FREQUENCIES = [
        { key: 'weekly', label: 'Every Monday' },
        { key: 'daily', label: 'Every day' },
        { key: 'monthly', label: '1st of the month' }
    ];
    var SCOPES = [
        { key: 'in_stock', label: 'Only styles we have in stock' },
        { key: 'all', label: 'Every style' }
    ];
    // rem = reminder settings from get_price_reminder_settings (null until loaded / when unavailable).
    var state = { data: null, customerId: null, open: {}, rem: null };

    // Stock series names that differ from the style code in the price list (as kernel_dashboard.js).
    var STOCK_CODE_OF = { 'Butter High Oil': 'BHO', 'Butter Low Oil': 'BLO' };

    function maxAgeDays() {
        var n = state.rem ? parseInt(state.rem.max_age_days, 10) : NaN;
        return isNaN(n) || n < 1 ? REM_DEFAULTS.max_age_days : n;
    }

    // Whole days between a YYYY-MM-DD date and today (null when unreadable).
    function daysSince(v) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
        if (!m) return null;
        var then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return Math.round((today - then) / 86400000);
    }

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
        [['Style'], ['Price per kg (excl. VAT)'], ['Per ' + (d.kg_per_carton || 11.34) + ' kg carton', 'ksp-r'], ['In stock', 'ksp-r'], ['Last changed']].forEach(function (h) {
            $hr.append(el('th', 'ksp-th ' + (h[1] || ''), h[0]).attr('scope', 'col'));
        });
        $t.append($('<thead>').append($hr));
        var $tb = $('<tbody>');
        (d.styles || []).forEach(function (s) {
            var cur = currentPrice(s);
            // No price at all: nothing of its own, and (for a customer view) no list price to fall back on.
            var missing = (cur == null || cur === '') && (!state.customerId || s.list_price == null);
            var $r = $('<tr>');
            var $name = $('<td>').append(el('strong', null, s.style_code)).append(document.createTextNode(' ')).append(el('span', 'ksp-tiny', s.label || ''));
            $r.append($name);

            var $in = $('<input type="number" class="form-control ksp-input ksp-val" min="0" step="0.01" inputmode="decimal">')
                .attr({ 'data-code': s.style_code, 'aria-label': 'Price per kg for ' + (s.label || s.style_code) })
                .val(cur == null ? '' : cur)
                .attr('data-orig', cur == null ? '' : String(cur))
                .prop('readonly', !edit);
            if (state.customerId) $in.attr('placeholder', s.list_price == null ? '' : String(s.list_price));
            if (missing) {
                $in.addClass('ksp-input-missing');
                if (!state.customerId) $in.attr('placeholder', 'Needs a price');
            }
            var $cell = el('td').append(el('label', 'ksp-price').append(el('span', 'ksp-muted', 'R')).append($in));
            if (state.customerId) {
                $cell.append(el('div', 'ksp-tiny', 'List price ' + (s.list_price == null ? 'not set' : money(s.list_price))));
            }
            $r.append($cell);

            var shown = cur == null || cur === '' ? (state.customerId ? s.list_price : null) : cur;
            $r.append(el('td', 'ksp-r ksp-muted ksp-carton', shown == null ? '' : carton(shown)));
            var kg = state.stock ? state.stock[s.style_code] : null;
            $r.append(el('td', 'ksp-r ksp-muted', state.stock == null ? '' : (kg ? Math.round(kg).toLocaleString('en-ZA') + ' kg' : '–')));

            var from = state.customerId ? s.customer_from : s.list_from;
            var by = s.list_changed_by;
            var txt = from ? fmtDate(from) + (by && !state.customerId ? ' · ' + by : '') : 'Not set yet';
            var age = from ? daysSince(from) : null;
            var $last = el('td');
            if (missing) {
                $last.append(el('span', 'ksp-flag ksp-flag-bad', 'No price yet'));
            } else if (age != null && age > maxAgeDays()) {
                $last.append(el('span', 'ksp-flag ksp-flag-old', 'Older than ' + maxAgeDays() + ' days'));
            } else {
                $last.append(el('span', 'ksp-tiny', txt));
            }
            $r.append($last);
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

    function optionsHtml(list, cur) {
        return list.map(function (o) {
            return '<option value="' + o.key + '"' + (o.key === cur ? ' selected' : '') + '>' + o.label + '</option>';
        }).join('');
    }

    // The "Price reminder" card. Option labels are fixed copy; no DB text is put into HTML here.
    function buildReminder() {
        var edit = has('kernel_prices.edit');
        var $c = el('section', 'ksp-panel ksp-side-card ksp-reminder').attr('aria-labelledby', 'kspRemTitle');
        if (!state.rem) {
            $c.append(el('div', 'ksp-h2', 'Price reminder').attr('id', 'kspRemTitle'));
            $c.append(el('div', 'ksp-muted', 'The price reminder is not available yet.'));
            return $c;
        }
        var r = $.extend({}, REM_DEFAULTS, state.rem);
        var $top = el('div', 'ksp-rem-top');
        var $t = el('div');
        $t.append(el('h2', 'ksp-h2', 'Price reminder').attr('id', 'kspRemTitle'));
        $t.append(el('div', 'ksp-muted', 'When the "Style prices need a look" task appears on My Day.'));
        $top.append($t);
        $top.append($('<label class="ksp-check"><input type="checkbox" class="form-check-input" id="kspRemEnabled"> Send this reminder</label>'));
        $c.append($top);

        var $grid = el('div', 'ksp-rem-grid');
        $grid.append($('<label class="ksp-field">Remind when a price is older than<span class="ksp-inline">' +
            '<input type="number" min="1" max="365" step="1" class="form-control ksp-days" id="kspRemDays" aria-label="Days">' +
            '<span class="ksp-muted">days</span></span></label>'));
        $grid.append($('<label class="ksp-field">Check<select class="form-select" id="kspRemFreq">' +
            optionsHtml(FREQUENCIES, r.frequency) + '</select></label>'));
        $grid.append($('<label class="ksp-field">Which styles count<select class="form-select" id="kspRemScope">' +
            optionsHtml(SCOPES, r.scope) + '</select></label>'));
        $c.append($grid);
        $c.append($('<label class="ksp-check"><input type="checkbox" class="form-check-input" id="kspRemMissing"> Also remind when a style in stock has no price at all</label>'));
        $c.append(el('div', 'ksp-tiny', 'Goes to the Sales Exec role (Pete). Saving prices clears the task once nothing counted is missing or old.'));
        if (edit) {
            $c.append($('<div class="ksp-actions">').append(
                el('button', 'btn btn-primary ksp-btn', 'Save reminder').attr({ type: 'button', id: 'kspRemSave' })));
        }
        // Values set via .prop/.val, not markup.
        $c.find('#kspRemEnabled').prop('checked', !!r.enabled);
        $c.find('#kspRemMissing').prop('checked', !!r.remind_missing);
        $c.find('#kspRemDays').val(r.max_age_days);
        if (!edit) $c.find('input, select').prop('disabled', true);
        return $c;
    }

    function loadReminder() {
        return dataFunctions._rpcRead('get_price_reminder_settings', {}, null).then(function (res) {
            state.rem = res && res.settings ? res.settings : null;
        }, function () { state.rem = null; });
    }

    function saveReminder() {
        var days = Number($('#kspRemDays').val());
        if (!Number.isInteger(days) || days < 1 || days > 365) {
            _common.showErrorToast('Days must be a whole number from 1 to 365.');
            return;
        }
        var settings = {
            enabled: $('#kspRemEnabled').prop('checked'),
            max_age_days: days,
            frequency: $('#kspRemFreq').val(),
            scope: $('#kspRemScope').val(),
            remind_missing: $('#kspRemMissing').prop('checked')
        };
        $('#kspRemSave').prop('disabled', true);
        dataFunctions._rpcWrite('set_price_reminder_settings', { p_settings: settings }, null).then(function (res) {
            if (res && res.success) {
                if (res.settings) state.rem = res.settings;
                _common.showSuccessToast('Price reminder saved.');
                render();
            } else {
                _common.showErrorToast((res && res.error) ? String(res.error) : 'Could not save the reminder.');
                $('#kspRemSave').prop('disabled', false);
            }
        });
    }

    function render() {
        var d = state.data;
        var $body = $('#ksp-body').empty();
        if (!d || d.success === false) {
            $body.append(el('div', 'ksp-panel ksp-side-card', 'Style prices are not available yet.'));
            return;
        }
        $body.append(el('div', 'ksp-muted ksp-note').append(el('i', 'fas fa-lock me-1').attr('aria-hidden', 'true'))
            .append(document.createTextNode('Only people allowed to see prices get this tab.')));
        $body.append(buildMode(d));
        var $split = el('div', 'ksp-split');
        $split.append(buildTable(d));
        $split.append(el('div', 'ksp-side').append(buildHistory(d)));
        $body.append($split);
        $body.append(buildReminder());
    }

    function reload() {
        // Stock on hand per style: today's row of the same history the Kernel Dashboard values.
        var stock = dataFunctions.getStockSohHistory
            ? dataFunctions.getStockSohHistory('kernel', 7).then(function (rows) {
                if (!Array.isArray(rows) || !rows.length) return {};
                var last = rows.reduce(function (m, r) { return r.d > m ? r.d : m; }, '');
                var map = {};
                rows.forEach(function (r) {
                    if (r.d !== last) return;
                    var code = STOCK_CODE_OF[r.series] || r.series;
                    map[code] = (map[code] || 0) + (Number(r.qty_kg) || 0);
                });
                return map;
            }, function () { return null; })
            : Promise.resolve(null);
        return Promise.all([dataFunctions.getKernelStylePrices(state.customerId || null, null), stock]).then(function (r) {
            state.data = r[0];
            state.stock = r[1];
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
        $m.on('click' + NS, '#kspRemSave', saveReminder);
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
        // Reminder settings first so the "older than N days" flags use the saved N.
        loadReminder().then(reload);
    }

    return { init: init };
})();
window._kernelStylePrices = _kernelStylePrices;
