/**
 * Sales (24 Nov 2026) - one page for everything to do with selling.
 *
 * Tabs: Today (what needs doing + headline numbers), Orders (kernel dispatch workflow + oil orders),
 * Prices (standard list + one customer's own prices), Customers (with their sales this FY) and
 * Sales figures (any period, by customer / style / month, CSV).
 *
 * Nothing here has its own write path. Every change goes through the dialogs and modules the
 * original screens use (kernel-dispatch-approve / -form, send-to-dispatch, crm-contact, and
 * _kernelStylePrices), so the server checks and side effects are exactly the same. All DB text
 * is put on the page with .text() / document.createTextNode - never as HTML.
 */
var _salesHub = (function () {
    'use strict';

    var NS = '.salesHub';
    var PAGE = 500;          // get_data_*_sales_lines caps a page at 500
    var MAX_PAGES = 40;      // 20,000 lines is far beyond a year of Macavation sales
    var LINES_SHOWN = 200;
    var CUSTOMER_TYPES = ['kernel_customer', 'customer', 'both', 'oil_protein_customer'];
    var STEP_NAMES = ['Order created', 'Stock picked', 'Pricing confirmed', 'Truck loaded', 'Invoice sent'];

    var state = {
        tab: 'today', stageFilter: 'open', product: 'kernel',
        orders: [], stages: {}, oilOrders: [], contacts: [], priceCustomers: [],
        lines: {},           // cache: 'kernel|from|to' -> rows
        pricesMounted: false, pendingPriceCustomer: null, figTicket: 0
    };

    // ---- helpers ------------------------------------------------------------------------------
    function can(key) { return typeof window.hasAction === 'function' && !!window.hasAction(key); }
    function el(tag, cls, text) {
        var $e = $(document.createElement(tag));
        if (cls) $e.attr('class', cls);
        if (text != null) $e.text(String(text));
        return $e;
    }
    function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
    function money(v) { return 'R ' + num(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function moneyShort(v) { return 'R ' + Math.round(num(v)).toLocaleString('en-US'); }
    function kg(v) { return (typeof _common !== 'undefined' && _common.formatKg) ? _common.formatKg(num(v)) : num(v).toFixed(2); }
    function iso(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function today() { var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    function fmtDate(v) {
        var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ''));
        return m ? Number(m[3]) + ' ' + MONTHS[Number(m[2]) - 1] + ' ' + m[1] : '';
    }
    function monthLabel(ym) { var p = ym.split('-'); return MONTHS[Number(p[1]) - 1] + ' ' + p[0]; }
    /** Macavation's financial year runs April to March (Mike, 14 Oct 2026; = report_fy_of_date). */
    function fyStart(d) { var y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return new Date(y, 3, 1); }
    function fyLabel(d) { var s = fyStart(d).getFullYear(); return 'FY ' + s + '/' + String(s + 1).slice(2); }
    function rows(raw) {
        if (Array.isArray(raw)) return raw;
        if (raw && Array.isArray(raw.data)) return raw.data;
        return [];
    }
    function contactName(c) { return (c && (c.company_name || c.trading_name)) || ''; }
    function emptyRow($tb, cols, text) {
        $tb.append($('<tr>').append(el('td', 'text-center text-muted py-4', text).attr('colspan', cols)));
    }
    function btn(label, icon, cls) {
        var $b = el('button', 'btn btn-sm ' + (cls || 'btn-outline-primary')).attr('type', 'button');
        if (icon) $b.append(el('i', icon + ' me-1'));
        return $b.append(document.createTextNode(label));
    }
    function onPage() { return $('#salesHub').length > 0; }

    // ---- data ---------------------------------------------------------------------------------
    async function loadOrders(force) {
        try {
            var list = await dataFunctions.getKernelDispatchOrders(null, !!force, null) || [];
            state.orders = list.filter(function (o) { return String(o && o.status || '').toLowerCase() !== 'cancelled'; });
            state.stages = {};
            if (dataFunctions.getKernelDispatchStages && state.orders.length) {
                var st = await dataFunctions.getKernelDispatchStages(state.orders.map(function (o) { return o.id; })) || [];
                st.forEach(function (r) { if (r && r.id && r.workflow_stage) state.stages[r.id] = r; });
            }
        } catch (e) {
            console.error('[Sales] orders failed:', e);
            state.orders = [];
        }
        try {
            state.oilOrders = dataFunctions.getOilDispatchOrders ? (await dataFunctions.getOilDispatchOrders(null, !!force, 50) || []) : [];
        } catch (e) { state.oilOrders = []; }
    }

    async function loadContacts(force) {
        try {
            var all = await dataFunctions.getContacts(null, !!force) || [];
            state.contacts = all.filter(function (c) { return CUSTOMER_TYPES.indexOf(c.contact_type) >= 0; });
        } catch (e) { console.error('[Sales] contacts failed:', e); state.contacts = []; }
    }

    /** Every sales line between from and to (YYYY-MM-DD), paged. Cached per product + period. */
    async function loadLines(product, from, to, force) {
        var key = product + '|' + from + '|' + to;
        if (!force && state.lines[key]) return state.lines[key];
        var getter = product === 'oil' ? 'getDataOilSalesLines' : 'getDataKernelSalesLines';
        var out = [];
        for (var p = 0; p < MAX_PAGES; p++) {
            var page = rows(await dataFunctions[getter](from, to, PAGE, p * PAGE, null, !!force));
            out = out.concat(page);
            var total = page.length ? num(page[0].total_count) : 0;
            if (page.length < PAGE || (total && out.length >= total)) break;
        }
        state.lines[key] = out;
        return out;
    }

    // ---- order workflow (same rules as kernel_dispatch_grid.js) --------------------------------
    function stageOf(o) { var s = state.stages[o.id]; return s && s.workflow_stage ? String(s.workflow_stage).toLowerCase() : ''; }
    function isDispatched(o) { var s = state.stages[o.id]; return String((s && s.status) || o.status || '').toLowerCase() === 'dispatched'; }
    function stepsDone(o) {
        var st = stageOf(o);
        if (!st) return 0;
        if (st === 'picking') return 1;
        if (st === 'approval') return 2;
        if (!isDispatched(o)) return 3;
        return (state.stages[o.id] && state.stages[o.id].invoice_sent_at) ? 5 : 4;
    }
    function stageKey(o) { return ['legacy', 'picking', 'approval', 'truck', 'invoice', 'done'][stepsDone(o)]; }
    var STAGE_TEXT = {
        picking: ['Waiting for picking', 'Production Manager · pick the stock'],
        approval: ['Waiting for pricing', 'Sales · confirm the pricing'],
        truck: ['Priced · waiting for the truck', 'Truck · load and check'],
        invoice: ['Loaded · waiting for the invoice', 'Accounts · send the invoice'],
        done: ['Invoice sent', 'Done'],
        legacy: ['Older order', 'Before the five steps']
    };
    function isOpen(o) { var k = stageKey(o); return k === 'picking' || k === 'approval' || k === 'truck' || k === 'invoice'; }

    /** The buttons for one order: [{ label, icon, cls, run }]. */
    function orderActions(o) {
        var k = stageKey(o), out = [];
        var approve = function () { openApprove(o.id); };
        if (k === 'picking') out.push(can('kernel_dispatch.pick') ? { label: 'Confirm picking', icon: 'fas fa-clipboard-check', cls: 'btn-primary', run: approve } : { label: 'Progress', icon: 'fas fa-list-check', run: approve });
        else if (k === 'approval') out.push(can('kernel_dispatch.approve') ? { label: 'Confirm pricing', icon: 'fas fa-tags', cls: 'btn-primary', run: approve } : { label: 'Progress', icon: 'fas fa-list-check', run: approve });
        else if (k === 'truck') {
            out.push({ label: 'Truck loaded', icon: 'fas fa-truck', cls: 'btn-primary', run: function () { openTruck(o.id); } });
            out.push({ label: 'View pricing', icon: 'fas fa-receipt', run: approve });
        } else if (k === 'invoice') out.push(can('kernel_dispatch.invoice') ? { label: 'Invoice sent', icon: 'fas fa-file-invoice', cls: 'btn-primary', run: approve } : { label: 'Progress', icon: 'fas fa-list-check', run: approve });
        else if (k === 'done') out.push({ label: 'View', icon: 'fas fa-eye', run: approve });
        else out.push({ label: 'View sheet', icon: 'fas fa-clipboard-list', run: function () { openTruck(o.id); } });
        return out;
    }
    function openApprove(id) {
        if (typeof _modal_kernel_dispatch_approve !== 'undefined' && _modal_kernel_dispatch_approve.show) _modal_kernel_dispatch_approve.show(id);
    }
    function openTruck(id) {
        if (typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.show) _modal_kernel_dispatch_form.show(id);
    }
    function actionCell(o) {
        var $td = el('td', 'text-end text-nowrap');
        orderActions(o).forEach(function (a) {
            $td.append(btn(a.label, a.icon, a.cls || 'btn-outline-primary').addClass('ms-1').on('click', a.run));
        });
        return $td;
    }

    // ---- tabs ---------------------------------------------------------------------------------
    function showTab(tab) {
        if (tab === 'prices' && !can('kernel_prices.view')) tab = 'today';
        state.tab = tab;
        $('#shTabs [data-sh-tab]').each(function () {
            var on = $(this).attr('data-sh-tab') === tab;
            $(this).toggleClass('active', on).attr('aria-selected', on ? 'true' : 'false');
        });
        $('#salesHub .sh-pane').each(function () { $(this).toggleClass('d-none', $(this).attr('data-sh-pane') !== tab); });
        if (tab === 'today') renderToday();
        if (tab === 'orders') renderOrders();
        if (tab === 'prices') renderPrices();
        if (tab === 'customers') renderCustomers();
        if (tab === 'figures') renderFigures();
    }

    // ---- Today --------------------------------------------------------------------------------
    function tile(title, value, sub, status, go) {
        var $c = el('div', 'metric-card' + (status ? ' status-' + status : '') + (go ? ' metric-card-clickable' : ''));
        $c.append(el('div', 'metric-title', title));
        $c.append(el('div', 'metric-value', value));
        if (sub) $c.append(el('div', 'metric-label', sub));
        if (go) $c.attr({ role: 'button', tabindex: '0' }).on('click keydown', function (e) {
            if (e.type === 'click' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
        });
        return el('div', 'col-sm-6 col-xl-3').append($c);
    }

    function sum(list, field) { return list.reduce(function (a, r) { return a + num(r[field]); }, 0); }

    async function renderToday() {
        var t = today();
        var monthFrom = iso(new Date(t.getFullYear(), t.getMonth(), 1));
        var fyFrom = iso(fyStart(t));
        var counts = { picking: 0, approval: 0, truck: 0, invoice: 0 };
        state.orders.forEach(function (o) { var k = stageKey(o); if (counts[k] != null) counts[k]++; });
        var open = counts.picking + counts.approval + counts.truck + counts.invoice;

        var $tiles = $('#shTiles').empty();
        var mine = can('kernel_dispatch.approve');
        $tiles.append(tile(mine ? 'Waiting for your pricing' : 'Waiting for pricing', String(counts.approval),
            counts.approval ? 'Open the order and confirm the prices' : 'Nothing waiting', counts.approval ? 'warning' : 'excellent',
            function () { state.stageFilter = 'approval'; showTab('orders'); }));
        $tiles.append(tile('Orders on the go', String(open),
            counts.picking + ' picking · ' + counts.approval + ' pricing · ' + counts.truck + ' truck · ' + counts.invoice + ' invoice', null,
            function () { state.stageFilter = 'open'; showTab('orders'); }));
        var $m = tile('Sales this month', '…', 'excl. VAT', null, function () { $('#shPeriod').val('month'); showTab('figures'); });
        var $f = tile('Sales ' + fyLabel(t), '…', 'excl. VAT', null, function () { $('#shPeriod').val('fy'); showTab('figures'); });
        $tiles.append($m, $f);

        renderTodo(counts);

        try {
            var fy = await loadLines('kernel', fyFrom, iso(t));
            var month = fy.filter(function (r) { return String(r.sale_date || '') >= monthFrom; });
            $m.find('.metric-value').text(moneyShort(sum(month, 'vat_excl_zar')));
            $m.find('.metric-label').text(kg(sum(month, 'quantity_kg')) + ' kg kernel · excl. VAT');
            $f.find('.metric-value').text(moneyShort(sum(fy, 'vat_excl_zar')));
            $f.find('.metric-label').text(kg(sum(fy, 'quantity_kg')) + ' kg kernel · excl. VAT');
            renderLatest(fy);
        } catch (e) {
            console.error('[Sales] figures failed:', e);
            $m.find('.metric-value').text('—'); $f.find('.metric-value').text('—');
            $('#shLatest').empty().append(el('div', 'p-3 text-muted', 'Sales could not be loaded.'));
        }
    }

    function todoItem(icon, text, sub, action) {
        var $r = el('div', 'sh-todo-item');
        var $t = el('div', 'sh-todo-text').append(el('i', icon + ' me-2 sh-todo-icon')).append(el('span', null, text));
        if (sub) $t.append(el('div', 'sh-muted', sub));
        $r.append($t);
        if (action) $r.append(btn(action.label, action.icon, action.cls || 'btn-primary').on('click', action.run));
        return $r;
    }

    async function renderTodo(counts) {
        var $box = $('#shTodo').empty();
        var items = [];
        state.orders.forEach(function (o) {
            var k = stageKey(o);
            var who = o.buyer_name || 'Customer not set';
            var detail = kg(o.total_kg) + ' kg · collection ' + (fmtDate(o.planned_collection_date || o.delivery_date) || 'not set');
            var a = orderActions(o)[0];
            if (k === 'approval' && can('kernel_dispatch.approve')) items.push(todoItem('fas fa-tags', 'Confirm the pricing for ' + who, detail, a));
            else if (k === 'invoice' && can('kernel_dispatch.invoice')) items.push(todoItem('fas fa-file-invoice', 'Send the invoice to ' + who, detail, a));
            else if (k === 'truck') items.push(todoItem('fas fa-truck', who + ' is priced and waiting for the truck', detail, a));
        });
        if (can('kernel_prices.view')) {
            try {
                var d = await dataFunctions.getKernelStylePrices(null, null);
                var styles = (d && d.styles) || [];
                var missing = styles.filter(function (s) { return s.list_price == null || s.list_price === ''; }).length;
                var newest = styles.reduce(function (a, s) { return s.list_from && s.list_from > a ? s.list_from : a; }, '');
                var age = newest ? Math.round((today() - new Date(newest.slice(0, 4), Number(newest.slice(5, 7)) - 1, newest.slice(8, 10))) / 86400000) : null;
                var goPrices = { label: 'Update prices', icon: 'fas fa-tags', cls: 'btn-outline-primary', run: function () { showTab('prices'); } };
                if (missing) items.push(todoItem('fas fa-triangle-exclamation', missing + ' kernel style' + (missing === 1 ? ' has' : 's have') + ' no standard price', 'An order with that style cannot be valued until it has one.', goPrices));
                if (age != null && age > 30) items.push(todoItem('fas fa-clock', 'Standard prices were last changed ' + age + ' days ago', 'Since ' + fmtDate(newest) + '.', goPrices));
            } catch (e) { /* prices are optional on this list */ }
        }
        if (!items.length) { $box.append(el('div', 'text-muted', 'Nothing is waiting. New orders and price reminders show here.')); return; }
        items.forEach(function ($i) { $box.append($i); });
    }

    function renderLatest(lines) {
        var $b = $('#shLatest').empty();
        var latest = lines.slice().sort(function (a, b) { return String(b.sale_date).localeCompare(String(a.sale_date)); }).slice(0, 8);
        if (!latest.length) { $b.append(el('div', 'p-3 text-muted', 'No kernel sales yet this financial year.')); return; }
        var $t = el('table', 'table table-sm align-middle mb-0');
        $t.append($('<thead>').append($('<tr>').append(el('th', null, 'Date'), el('th', null, 'Customer'), el('th', null, 'Style'), el('th', 'text-end', 'Value'))));
        var $tb = $('<tbody>');
        latest.forEach(function (r) {
            $tb.append($('<tr>').append(el('td', 'text-nowrap', fmtDate(r.sale_date)), el('td', null, r.customer_name || ''),
                el('td', null, r.style_code || ''), el('td', 'text-end text-nowrap', money(r.vat_excl_zar))));
        });
        $b.append(el('div', 'table-responsive').append($t.append($tb)));
    }

    // ---- Orders -------------------------------------------------------------------------------
    function renderOrders() {
        var chips = [['open', 'Still open', isOpen], ['approval', 'Waiting for pricing'], ['picking', 'Waiting for picking'],
            ['truck', 'Waiting for the truck'], ['invoice', 'Waiting for the invoice'], ['done', 'Done'], ['all', 'All']];
        var test = function (f, o) {
            if (f === 'all') return true;
            if (f === 'open') return isOpen(o);
            return stageKey(o) === f;
        };
        var $chips = $('#shStageChips').empty();
        chips.forEach(function (c) {
            var n = state.orders.filter(function (o) { return test(c[0], o); }).length;
            var on = state.stageFilter === c[0];
            $chips.append(el('button', 'btn btn-sm ' + (on ? 'btn-primary' : 'btn-outline-secondary'), c[1] + ' · ' + n)
                .attr({ type: 'button', 'aria-pressed': on ? 'true' : 'false' })
                .on('click', function () { state.stageFilter = c[0]; renderOrders(); }));
        });
        var $tb = $('#shOrdersBody').empty();
        var list = state.orders.filter(function (o) { return test(state.stageFilter, o); });
        if (!list.length) emptyRow($tb, 6, 'No orders here.');
        list.forEach(function (o) {
            var k = stageKey(o), n = stepsDone(o);
            var $step = el('td');
            $step.append(el('span', 'badge sh-stage sh-stage-' + k, STAGE_TEXT[k][0]));
            if (n && n < 5) $step.append(el('div', 'sh-muted', 'Step ' + (n + 1) + ' of 5 · ' + STEP_NAMES[n]));
            var info = state.stages[o.id] || {};
            var $wait = el('td', null, STAGE_TEXT[k][1]);
            if (k === 'approval' && info.needs_approval) $wait.append(' ').append(el('span', 'badge bg-warning text-dark', 'different style to OK'));
            else if (k === 'approval' && info.has_pick_changes) $wait.append(el('div', 'sh-muted', 'The picker changed some cartons'));
            var $who = el('td').append(el('strong', null, o.buyer_name || 'Customer not set'));
            $who.append(el('div', 'sh-muted', (o.line_count || 0) + ' line' + (Number(o.line_count) === 1 ? '' : 's')));
            $tb.append($('<tr>').append($who, el('td', 'text-nowrap', fmtDate(o.planned_collection_date || o.delivery_date) || '—'),
                el('td', 'text-end text-nowrap', kg(o.total_kg) + ' kg'), $step, $wait, actionCell(o)));
        });
        var $ob = $('#shOilOrdersBody').empty();
        if (!state.oilOrders.length) emptyRow($ob, 3, 'No oil orders.');
        state.oilOrders.forEach(function (o) {
            $ob.append($('<tr>').append(el('td', null, o.buyer_name || 'Customer not set'),
                el('td', 'text-nowrap', fmtDate(o.delivery_date || o.created_at)), el('td', 'text-capitalize', o.status || '')));
        });
    }

    // ---- Prices -------------------------------------------------------------------------------
    async function renderPrices() {
        if (!state.pricesMounted && typeof _kernelStylePrices !== 'undefined' && _kernelStylePrices.init) {
            state.pricesMounted = true;
            _kernelStylePrices.init();
        }
        var $sel = $('#shPriceCustomer');
        if ($sel.children().length <= 1) {
            try {
                var d = await dataFunctions.getKernelStylePrices(null, null);
                state.priceCustomers = (d && d.customers) || [];
            } catch (e) { state.priceCustomers = []; }
            var list = state.priceCustomers.length ? state.priceCustomers
                : state.contacts.map(function (c) { return { id: c.id, name: contactName(c) }; });
            list.forEach(function (c) {
                $sel.append($('<option>').val(c.id).text((c.name || '') + (c.has_prices ? '  (own prices)' : '')));
            });
        }
        if (state.pendingPriceCustomer) { $sel.val(state.pendingPriceCustomer); state.pendingPriceCustomer = null; $sel.trigger('change'); }
    }

    async function mountCustomerPrices(id) {
        var $box = $('#shCustomerPrices').empty();
        if (!id) { $box.addClass('sh-muted').text('Choose a customer to see or change their prices.'); return; }
        // Customer prices only apply in "Price per customer" mode. Read the mode now (not when the tab
        // opened) because it can be switched in the Standard prices card above.
        var mode = null;
        try { var d = await dataFunctions.getKernelStylePrices(null, null); mode = d && d.mode; } catch (e) { /* mountCustomer copes */ }
        if (mode === 'single') {
            $box.addClass('sh-muted').text('Customer prices are switched off: everyone pays the standard price. To give customers their own prices, press "Price per customer" in Standard prices above, then choose the customer again.');
            return;
        }
        $box.removeClass('sh-muted');
        var name = $('#shPriceCustomer option:selected').text().replace(/\s+\(own prices\)$/, '');
        if (typeof _kernelStylePrices !== 'undefined' && _kernelStylePrices.mountCustomer) {
            _kernelStylePrices.mountCustomer($box[0], id, { name: name });
        }
    }

    // ---- Customers ----------------------------------------------------------------------------
    async function renderCustomers() {
        var t = today();
        $('#shCustomerFy').text('Sales figures are for ' + fyLabel(t) + ' (April to March), kernel and oil.');
        var $tb = $('#shCustomersBody').empty();
        emptyRow($tb, 7, 'Loading…');
        var lines = [];
        try {
            var from = iso(fyStart(t)), to = iso(t);
            lines = (await loadLines('kernel', from, to)).concat(await loadLines('oil', from, to));
        } catch (e) { console.error('[Sales] customer figures failed:', e); }
        // Sales lines link to a contact by id; older imported lines may only carry the name.
        var byKey = {};
        lines.forEach(function (r) {
            var key = r.customer_id ? 'id:' + r.customer_id : 'name:' + String(r.customer_name || '').trim().toLowerCase();
            var agg = byKey[key] || (byKey[key] = { value: 0, kg: 0, last: '' });
            agg.value += num(r.vat_excl_zar); agg.kg += num(r.quantity_kg);
            if (String(r.sale_date || '') > agg.last) agg.last = String(r.sale_date);
        });
        var openBy = {};
        state.orders.forEach(function (o) { if (isOpen(o) && o.buyer_contact_id) openBy[o.buyer_contact_id] = (openBy[o.buyer_contact_id] || 0) + 1; });

        var q = String($('#shCustomerSearch').val() || '').trim().toLowerCase();
        var list = state.contacts.map(function (c) {
            var byId = byKey['id:' + c.id], byNm = byKey['name:' + contactName(c).trim().toLowerCase()];
            var a = { value: 0, kg: 0, last: '' };
            [byId, byNm].forEach(function (x) {
                if (!x) return;
                a.value += x.value; a.kg += x.kg;
                if (x.last > a.last) a.last = x.last;
            });
            return { c: c, a: a, open: openBy[c.id] || 0 };
        }).filter(function (x) {
            if (!q) return true;
            return (contactName(x.c) + ' ' + (x.c.primary_contact_name || '')).toLowerCase().indexOf(q) >= 0;
        }).sort(function (x, y) { return y.a.value - x.a.value || contactName(x.c).localeCompare(contactName(y.c)); });

        $tb.empty();
        if (!list.length) emptyRow($tb, 7, q ? 'No customer matches that search.' : 'No customers yet.');
        list.forEach(function (x) {
            var c = x.c;
            var $who = el('td').append(el('strong', null, contactName(c) || 'No name'));
            if (c.key_account) $who.append(' ').append(el('span', 'badge bg-secondary', 'Key account'));
            var $contact = el('td').append(el('div', null, c.primary_contact_name || ''));
            if (c.primary_contact_phone || c.primary_contact_email) $contact.append(el('div', 'sh-muted', c.primary_contact_phone || c.primary_contact_email));
            var $acts = el('td', 'text-end text-nowrap');
            $acts.append(btn('Open', 'fas fa-folder-open').on('click', function () { openContact(c.id); }));
            if (can('kernel_prices.view') && c.contact_type !== 'oil_protein_customer') {
                $acts.append(btn('Prices', 'fas fa-tags').addClass('ms-1').on('click', function () {
                    state.pendingPriceCustomer = c.id; showTab('prices');
                }));
            }
            $tb.append($('<tr>').append($who, $contact,
                el('td', 'text-end text-nowrap', x.a.value ? money(x.a.value) : '—'),
                el('td', 'text-end text-nowrap', x.a.kg ? kg(x.a.kg) : '—'),
                el('td', 'text-nowrap', fmtDate(x.a.last) || '—'),
                el('td', 'text-end', x.open ? String(x.open) : '—'), $acts));
        });
    }

    async function openContact(id) {
        try {
            var c = await dataFunctions.getContactById(id, null, true);
            if (Array.isArray(c)) c = c[0];
            if (c && c.data && !c.id) c = c.data;
            if (c && typeof _modal_crm_contact !== 'undefined' && _modal_crm_contact.show) _modal_crm_contact.show(c);
        } catch (e) {
            if (typeof Swal !== 'undefined') Swal.fire('Could not open the customer', (e && e.message) || 'Please try again.', 'error');
        }
    }

    // ---- Sales figures ------------------------------------------------------------------------
    function period() {
        var t = today(), p = $('#shPeriod').val();
        $('#salesHub .sh-custom').toggleClass('d-none', p !== 'custom');
        if (p === 'month') return { from: iso(new Date(t.getFullYear(), t.getMonth(), 1)), to: iso(t), label: 'this month' };
        if (p === 'last_month') return { from: iso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), to: iso(new Date(t.getFullYear(), t.getMonth(), 0)), label: 'last month' };
        if (p === 'last_fy') {
            var s = fyStart(t);
            var ls = new Date(s.getFullYear() - 1, 3, 1);
            return { from: iso(ls), to: iso(new Date(s.getFullYear(), 2, 31)), label: fyLabel(ls) };
        }
        if (p === 'custom') {
            var f = $('#shFrom').val(), to = $('#shTo').val();
            if (!f || !to || to < f) return null;
            return { from: f, to: to, label: 'your dates' };
        }
        return { from: iso(fyStart(t)), to: iso(t), label: fyLabel(t) + ' so far' };
    }

    function groupBy(lines, keyFn) {
        var m = {};
        lines.forEach(function (r) {
            var k = keyFn(r) || 'Not set';
            var a = m[k] || (m[k] = { key: k, value: 0, kg: 0, n: 0 });
            a.value += num(r.vat_excl_zar); a.kg += num(r.quantity_kg); a.n++;
        });
        return Object.keys(m).map(function (k) { return m[k]; });
    }

    function figTable(list, firstHead, total, labelFn) {
        var $t = el('table', 'table table-sm align-middle mb-0');
        $t.append($('<thead>').append($('<tr>').append(el('th', null, firstHead), el('th', 'text-end', 'Kg'),
            el('th', 'text-end', 'Value excl. VAT'), el('th', 'text-end', 'R/kg'), el('th', 'text-end', 'Share'))));
        var $tb = $('<tbody>');
        if (!list.length) emptyRow($tb, 5, 'No sales in this period.');
        list.forEach(function (g) {
            $tb.append($('<tr>').append(el('td', null, labelFn ? labelFn(g.key) : g.key),
                el('td', 'text-end text-nowrap', kg(g.kg)), el('td', 'text-end text-nowrap', money(g.value)),
                el('td', 'text-end text-nowrap', g.kg ? money(g.value / g.kg) : '—'),
                el('td', 'text-end', total ? Math.round(g.value / total * 100) + '%' : '—')));
        });
        return el('div', 'table-responsive').append($t.append($tb));
    }

    async function renderFigures(force) {
        var p = period();
        var oil = state.product === 'oil';
        $('#shByProductTitle').text(oil ? 'By product' : 'By style');
        if (!p) { $('#shFigNote').text('Choose a From and To date (To on or after From).'); return; }
        $('#shFigNote').text('Loading ' + p.label + '…');
        var ticket = ++state.figTicket;   // a newer period/product choice wins over a slower older load
        var lines;
        try { lines = await loadLines(state.product, p.from, p.to, force); }
        catch (e) {
            console.error('[Sales] figures failed:', e);
            if (ticket === state.figTicket) $('#shFigNote').text('Sales could not be loaded. Press Refresh to try again.');
            return;
        }
        if (ticket !== state.figTicket || !onPage()) return;
        var value = sum(lines, 'vat_excl_zar'), weight = sum(lines, 'quantity_kg');
        var invoices = {}, customers = {};
        lines.forEach(function (r) {
            if (r.invoice_number) invoices[r.invoice_number] = 1;
            customers[r.customer_id || String(r.customer_name || '').toLowerCase()] = 1;
        });
        $('#shFigNote').text((oil ? 'Oil & protein' : 'Kernel') + ' sales, ' + p.label + ' (' + fmtDate(p.from) + ' to ' + fmtDate(p.to) + '). ' +
            (oil ? 'Oil sales are typed in or imported on Sales lines.' : 'A kernel sale is added when an order’s pricing is confirmed. Older sales were imported.'));
        var $tiles = $('#shFigTiles').empty();
        $tiles.append(tile('Sales excl. VAT', moneyShort(value), lines.length + ' sales line' + (lines.length === 1 ? '' : 's')));
        $tiles.append(tile('Kg sold', kg(weight), 'kg'));
        $tiles.append(tile('Average price', weight ? money(value / weight) : '—', 'per kg'));
        $tiles.append(tile('Customers', String(Object.keys(customers).length), Object.keys(invoices).length + ' invoice' + (Object.keys(invoices).length === 1 ? '' : 's')));

        var byValue = function (a, b) { return b.value - a.value; };
        $('#shByCustomer').empty().append(figTable(groupBy(lines, function (r) { return r.customer_name; }).sort(byValue), 'Customer', value));
        $('#shByProduct').empty().append(figTable(groupBy(lines, function (r) { return oil ? r.product_line : r.style_code; }).sort(byValue), oil ? 'Product' : 'Style', value));
        $('#shByMonth').empty().append(figTable(groupBy(lines, function (r) { return String(r.sale_date || '').slice(0, 7); })
            .sort(function (a, b) { return a.key.localeCompare(b.key); }), 'Month', value, function (k) { return /^\d{4}-\d{2}$/.test(k) ? monthLabel(k) : k; }));

        var sorted = lines.slice().sort(function (a, b) { return String(b.sale_date).localeCompare(String(a.sale_date)); });
        $('#shLinesNote').text(sorted.length > LINES_SHOWN ? '(newest ' + LINES_SHOWN + ' of ' + sorted.length + '; Download CSV has them all)' : '');
        var $t = el('table', 'table table-sm align-middle mb-0');
        $t.append($('<thead>').append($('<tr>').append(el('th', null, 'Date'), el('th', null, 'Customer'), el('th', null, 'Invoice'),
            el('th', null, oil ? 'Product' : 'Style'), el('th', 'text-end', 'Kg'), el('th', 'text-end', 'R/kg'), el('th', 'text-end', 'Value excl. VAT'))));
        var $tb = $('<tbody>');
        if (!sorted.length) emptyRow($tb, 7, 'No sales in this period.');
        sorted.slice(0, LINES_SHOWN).forEach(function (r) {
            $tb.append($('<tr>').append(el('td', 'text-nowrap', fmtDate(r.sale_date)), el('td', null, r.customer_name || ''),
                el('td', null, r.invoice_number || ''), el('td', null, oil ? (r.product_line || '') : (r.style_code || '')),
                el('td', 'text-end text-nowrap', kg(r.quantity_kg)), el('td', 'text-end text-nowrap', r.price_per_kg != null ? money(r.price_per_kg) : '—'),
                el('td', 'text-end text-nowrap', money(r.vat_excl_zar))));
        });
        $('#shLines').empty().append(el('div', 'table-responsive').append($t.append($tb)));
    }

    function csvCell(v) {
        var s = v == null ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // stop a spreadsheet reading a cell as a formula
        return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    async function exportCsv() {
        var p = period();
        if (!p) return;
        var oil = state.product === 'oil';
        var lines = await loadLines(state.product, p.from, p.to);
        var head = ['Date', 'Customer', 'Invoice', oil ? 'Product' : 'Style', 'Description', 'Kg', 'Price per kg', 'Value excl VAT', 'VAT', 'Value incl VAT', 'Source'];
        var out = [head.join(',')];
        lines.forEach(function (r) {
            out.push([r.sale_date, r.customer_name, r.invoice_number, oil ? r.product_line : r.style_code, r.description,
                r.quantity_kg, r.price_per_kg, r.vat_excl_zar, r.vat_zar, r.vat_incl_zar, r.data_source].map(csvCell).join(','));
        });
        var blob = new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (oil ? 'oil' : 'kernel') + '-sales-' + p.from + '-to-' + p.to + '.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    // ---- wiring -------------------------------------------------------------------------------
    async function refresh(force) {
        if (force) state.lines = {};
        await Promise.all([loadOrders(force), loadContacts(force)]);
        if (!onPage()) return;
        showTab(state.tab);
    }

    function loadDialogs() {
        var jobs = [];
        $('#salesHub').parent().find('.modal[route-name]').each(function (i, m) {
            var route = $(m).attr('route-name');
            if (route && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                jobs.push(_appRouter.loadContent({ routeName: route, elementSelector: '#' + m.id }));
            }
        });
        // crm-contact-modal and send-to-dispatch-modal are initialised by appRouter itself.
        return Promise.all(jobs).catch(function (e) { console.error('[Sales] dialogs failed:', e); }).then(function () {
            if (typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.init) _modal_kernel_dispatch_form.init();
            if (typeof _modal_kernel_dispatch_approve !== 'undefined' && _modal_kernel_dispatch_approve.init) _modal_kernel_dispatch_approve.init();
        });
    }

    async function init() {
        state.pricesMounted = false;
        state.lines = {};
        var handoff = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('sales-hub') : null;
        state.tab = (handoff && handoff.tab) || 'today';

        $('#shPricesTabItem').toggleClass('d-none', !can('kernel_prices.view'));
        $('#shNewOrderBtn').toggleClass('d-none', !can('kernel.dispatch.create')).off('click').on('click', function () {
            if (typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.show) _modal_stock_send_to_dispatch.show();
        });
        $('#shAddCustomerBtn').removeClass('d-none').off('click').on('click', function () {
            if (typeof _modal_crm_contact !== 'undefined' && _modal_crm_contact.show) _modal_crm_contact.show(null, 'kernel_customer');
        });
        $('#shTabs').off('click').on('click', '[data-sh-tab]', function () { showTab($(this).attr('data-sh-tab')); });
        $('#shRefreshBtn').off('click').on('click', function () { refresh(true); });
        $('#shPriceCustomer').off('change').on('change', function () { mountCustomerPrices($(this).val()); });
        $('#shCustomerSearch').off('input').on('input', function () { renderCustomers(); });
        $('#shPeriod, #shFrom, #shTo').off('change').on('change', function () { renderFigures(); });
        $('#salesHub [data-sh-product]').off('click').on('click', function () {
            state.product = $(this).attr('data-sh-product');
            $('#salesHub [data-sh-product]').each(function () {
                var on = $(this).attr('data-sh-product') === state.product;
                $(this).toggleClass('active', on).attr('aria-pressed', on ? 'true' : 'false');
            });
            renderFigures();
        });
        $('#shExportBtn').off('click').on('click', function () { exportCsv(); });

        // Anything saved in a dialog (pricing, truck, invoice, new order, customer) refreshes this page.
        $(document).off(NS).on('kernelDispatch:changed' + NS, function () { if (onPage()) refresh(true); });
        $(document).on('hidden.bs.modal' + NS, '#kernelDispatchFormModal, #sendToDispatchModal, #contactModal', function () {
            if (onPage()) refresh(true);
        });

        await loadDialogs();
        await refresh(false);
    }

    return { init: init };
})();
window._salesHub = _salesHub;
