/**
 * Shell (route 'shell'; Mike's MacView round 3, 27 Nov 2026).
 *
 * Bags on hand, kg and average kg a bag; stock by batch and weigh day; shell sales per bag
 * (customer, invoice, bags, price per bag), oldest bags first, with the period's sales and value.
 *
 * Data: get_shell_overview / save_shell_sale / void_shell_sale (migration 20261128150000). Bags come
 * from the shell rows on the cracking sheet (kernel.cracking_data); a batch whose shell lot was
 * dispatched or written off in the old Shell waste menu counts as gone. The server refuses a sale
 * of more bags than are on hand, and only roles with shell.sales.edit AND "See costs and prices"
 * may record one. Prices and values come back empty for roles without prices.
 *
 * Security: every DB-sourced or typed string goes into the DOM through esc() / .text() / .val().
 */
var _shell = (function () {
    'use strict';

    var NS = '.shl';
    var CUSTOMER_TYPES = ['kernel_customer', 'customer', 'both', 'oil_protein_customer'];
    var state = { period: 'fy', data: null, range: null, customers: [], editing: null };

    function esc(v) { return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v); }
    function toast(msg, type) { if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(msg, type || 'success'); }
    function kgTxt(v) { return _common.formatKg(Number(v) || 0) + ' kg'; }
    function money(v) { return v == null ? '—' : 'R ' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function day(s) { return MacPeriods.day(s); }
    function num(v) { var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; }
    function prices() { return !!(state.data && state.data.sees_prices) && (typeof MacPriceAccess === 'undefined' || MacPriceAccess.canSee()); }
    function canSell() { return !!(state.data && state.data.can_sell) && prices() && (typeof window.hasAction !== 'function' || window.hasAction('shell.sales.edit')); }

    function onHand() {
        var b = (state.data && state.data.batches) || [];
        return b.reduce(function (a, x) { if (!x.gone) { a.bags += Number(x.left) || 0; a.kg += Number(x.left_kg) || 0; } return a; }, { bags: 0, kg: 0 });
    }

    async function load() {
        state.range = MacPeriods.range(state.period, $('#shlFrom').val(), $('#shlTo').val());
        var d = await dataFunctions.getShellOverview();
        if (!d) { $('#shlBody').html('<div class="alert alert-warning">The shell page is not set up on this database yet.</div>'); return; }
        state.data = d;
        $('#shlAdd').toggleClass('d-none', !canSell());
        render();
    }

    function tile(label, value, sub) {
        return '<div class="col-6 col-md-3"><div class="card h-100"><div class="card-body p-2"><div class="small text-muted">' + esc(label) + '</div>' +
            '<div class="fs-5 fw-semibold">' + value + '</div>' + (sub ? '<div class="small text-muted">' + sub + '</div>' : '') + '</div></div></div>';
    }

    function render() {
        var D = state.data, p = state.range, R = prices();
        if (!D || !p) return;
        var H = onHand();
        var all = (D.batches || []).reduce(function (a, x) { a.bags += Number(x.bags) || 0; a.kg += Number(x.kg) || 0; return a; }, { bags: 0, kg: 0 });
        var sales = (D.sales || []).filter(function (s) { return s.date >= p.from && s.date <= p.to; });
        var pb = sales.reduce(function (a, s) { return a + (Number(s.bags) || 0); }, 0);
        var pkg = sales.reduce(function (a, s) { return a + (Number(s.kg) || 0); }, 0);
        var pv = sales.reduce(function (a, s) { return a + (Number(s.value) || 0); }, 0);

        var h = '<div class="row g-2 mb-3">' +
            tile('Bags on hand', esc(H.bags), esc(kgTxt(H.kg)) + (H.bags ? ' · ≈ ' + esc(kgTxt(H.kg / H.bags)) + ' a bag' : '')) +
            tile('Bags weighed in, all time', esc(all.bags), esc(kgTxt(all.kg))) +
            tile('Sold in the period', esc(pb + ' bag' + (pb === 1 ? '' : 's')), esc(kgTxt(pkg)) + ' · ' + esc(day(p.from)) + ' to ' + esc(day(p.to))) +
            (R ? tile('Sales value in the period', esc(money(pv)), 'excl. VAT' + (pb ? ' · ' + esc(money(pv / pb)) + ' a bag' : '')) : '') +
            '</div>';

        h += '<div class="card mb-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><strong>Stock by batch</strong>' +
            '<span class="small text-muted">weighed on the cracking sheet · the oldest bags are sold first</span></div>' +
            '<div class="table-responsive shl-scroll"><table class="table table-sm mb-0 shl-table"><thead><tr><th>Batch</th><th>Weighed</th>' +
            '<th class="text-end">Bags</th><th class="text-end">Kg</th><th class="text-end">Bags left</th><th class="text-end">Kg left</th></tr></thead><tbody>' +
            ((D.batches || []).map(function (b) {
                return '<tr' + (b.gone ? ' class="text-muted"' : '') + '><td class="text-nowrap">' + esc(typeof macBatchNo !== 'undefined' ? macBatchNo.format(b.batch) : b.batch) +
                    (b.gone ? ' <span class="badge text-bg-secondary" title="Dispatched or written off in the Shell waste menu on Stock on Hand">dispatched earlier</span>' : '') + '</td>' +
                    '<td>' + esc(day(b.day) || '—') + '</td><td class="text-end">' + esc(b.bags) + '</td><td class="text-end">' + esc(_common.formatKg(b.kg)) + '</td>' +
                    '<td class="text-end"><strong>' + esc(b.gone ? 0 : b.left) + '</strong></td><td class="text-end">' + esc(_common.formatKg(b.gone ? 0 : b.left_kg)) + '</td></tr>';
            }).join('') || '<tr><td colspan="6" class="text-center text-muted py-4">No shell weighed yet. Shell bags are entered on the cracking sheet (Production stages).</td></tr>') +
            '</tbody></table></div></div>';

        h += '<div class="card mb-3"><div class="card-header d-flex flex-wrap gap-2 align-items-center"><strong>Shell sales</strong>' +
            '<span class="small text-muted">in the period' + (R ? ' · price per bag excl. VAT' : '') + '</span></div>' +
            '<div class="table-responsive shl-scroll"><table class="table table-sm table-hover mb-0 shl-table"><thead><tr><th>Date</th><th>Customer</th><th>Invoice</th>' +
            '<th class="text-end">Bags</th><th class="text-end">Kg</th>' + (R ? '<th class="text-end">R / bag</th><th class="text-end">Value</th>' : '') + '<th></th></tr></thead><tbody>' +
            (sales.map(function (s) {
                return '<tr><td>' + esc(day(s.date)) + '</td><td>' + esc(s.customer) + (!s.customer_id ? ' <span class="badge text-bg-warning" title="Not on the customer list">not on the list</span>' : '') +
                    '</td><td class="text-nowrap">' + esc(s.invoice || '—') + '</td><td class="text-end">' + esc(s.bags) + '</td><td class="text-end">' + esc(s.kg != null ? '≈ ' + _common.formatKg(s.kg) : '—') + '</td>' +
                    (R ? '<td class="text-end">' + esc(money(s.price)) + '</td><td class="text-end">' + esc(money(s.value)) + '</td>' : '') +
                    '<td class="text-end">' + (canSell() ? '<button type="button" class="btn btn-sm btn-outline-secondary" data-shledit="' + esc(s.id) + '">Edit</button>' : '') + '</td></tr>';
            }).join('') || '<tr><td colspan="8" class="text-center text-muted py-4">No shell sales in this period.</td></tr>') +
            '</tbody></table></div></div>';
        $('#shlBody').html(h);
    }

    // ------------------------------------------------------------------ sale form

    async function loadCustomers() {
        if (state.customers.length) return;
        try {
            var list = await dataFunctions.getContacts();
            state.customers = (list || []).filter(function (c) { return CUSTOMER_TYPES.indexOf(c.contact_type) !== -1 && !c.deleted_at; })
                .map(function (c) { return { id: c.id, name: (c.trading_name || c.company_name || '').trim() }; })
                .filter(function (c) { return c.name; })
                .sort(function (a, b) { return a.name.localeCompare(b.name); });
        } catch (e) { state.customers = []; }
        var $dl = $('#shlCustomers').empty();
        state.customers.forEach(function (c) { $dl.append($('<option>').attr('value', c.name)); });
    }
    function customerByName(n) {
        var k = String(n || '').trim().toLowerCase();
        return state.customers.filter(function (c) { return c.name.toLowerCase() === k; })[0] || null;
    }

    function available() { var H = onHand(); return H.bags + (state.editing ? Number(state.editing.bags) || 0 : 0); }

    function calc() {
        var b = Math.round(num($('#shlBags').val())), pr = num($('#shlPrice').val());
        var c = customerByName($('#shlCustomer').val());
        $('#shlCustomerHint').text($('#shlCustomer').val().trim() && !c ? 'Not on the customer list. It will be saved as typed and marked "not on the list"; add the customer in Contacts.' : '');
        $('#shlSum').html(b > 0 && pr >= 0 && isFinite(pr) ? 'Value <strong>' + esc(money(b * pr)) + '</strong> excl. VAT · ' + esc(money(b * pr * 1.15)) + ' incl. 15% VAT' : '');
    }

    async function openForm(id) {
        if (!canSell()) return;
        await loadCustomers();
        var s = id ? (state.data.sales || []).filter(function (x) { return x.id === id; })[0] : null;
        state.editing = s || null;
        $('#shlModalTitle').text(s ? 'Edit shell sale' : 'Shell sale');
        $('#shlDate').val(s ? s.date : MacPeriods.today());
        $('#shlInvoice').val(s ? s.invoice || '' : '');
        $('#shlCustomer').val(s ? s.customer : '');
        $('#shlBags').val(s ? s.bags : '');
        $('#shlPrice').val(s && s.price != null ? Number(s.price).toFixed(2) : '');
        $('#shlNotes').val(s ? s.notes || '' : '');
        $('#shlAvail').text('(' + available() + ' available)');
        $('#shlErr').text('');
        $('#shlVoid').toggleClass('d-none', !s);
        calc();
        bootstrap.Modal.getOrCreateInstance(document.getElementById('shlModal')).show();
    }

    async function save() {
        var b = Math.round(num($('#shlBags').val())), pr = num($('#shlPrice').val()), date = $('#shlDate').val(), name = $('#shlCustomer').val().trim();
        if (!date || !name || !(b > 0) || !(pr >= 0)) { $('#shlErr').text('Fill in the date, customer, bags and price per bag.'); return; }
        if (b > available()) { $('#shlErr').text('Only ' + available() + ' bags of shell are in stock.'); return; }
        var c = customerByName(name);
        $('#shlSave').prop('disabled', true);
        try {
            var r = await dataFunctions.saveShellSale({
                id: state.editing ? state.editing.id : null, date: date, customerId: c ? c.id : null, customerName: c ? c.name : name,
                invoice: $('#shlInvoice').val(), bags: b, price: pr, notes: $('#shlNotes').val()
            });
            if (!r || r.success === false) { $('#shlErr').text((r && r.error) || 'Could not save the sale.'); return; }
            bootstrap.Modal.getInstance(document.getElementById('shlModal')).hide();
            toast('Shell sale saved · ' + money(b * pr));
            await load();
        } finally { $('#shlSave').prop('disabled', false); }
    }

    async function voidSale() {
        var s = state.editing;
        if (!s) return;
        var go = typeof Swal !== 'undefined'
            ? (await Swal.fire({ title: 'Take this sale back?', text: 'Its ' + s.bags + ' bags go back into stock.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Take it back' })).isConfirmed
            : window.confirm('Take this sale back? Its bags go back into stock.');
        if (!go) return;
        var r = await dataFunctions.voidShellSale(s.id, 'Taken back on the Shell page');
        if (!r || r.success === false) { $('#shlErr').text((r && r.error) || 'Could not take the sale back.'); return; }
        bootstrap.Modal.getInstance(document.getElementById('shlModal')).hide();
        toast('Sale taken back');
        await load();
    }

    function init() {
        var $m = $('#shlModule');
        $m.off(NS);
        $('#shlPeriod').html(MacPeriods.optionsHtml(state.period));
        $('.shl-custom').toggleClass('d-none', state.period !== 'custom');
        $m.on('change' + NS, '#shlPeriod', function () {
            state.period = this.value;
            $('.shl-custom').toggleClass('d-none', state.period !== 'custom');
            state.range = MacPeriods.range(state.period, $('#shlFrom').val(), $('#shlTo').val());
            render();
        });
        $m.on('change' + NS, '#shlFrom, #shlTo', function () {
            if (state.period !== 'custom') return;
            state.range = MacPeriods.range('custom', $('#shlFrom').val(), $('#shlTo').val());
            render();
        });
        $m.on('click' + NS, '#shlAdd', function () { openForm(null); });
        $m.on('click' + NS, '[data-shledit]', function () { openForm($(this).attr('data-shledit')); });
        $m.on('input' + NS, '#shlBags, #shlPrice, #shlCustomer', calc);
        $m.on('click' + NS, '#shlSave', save);
        $m.on('click' + NS, '#shlVoid', voidSale);
        load();
    }

    return { init: init };
})();
