/**
 * Supplier Intake (oil plant) — Supplier recon tab (29 Oct 2026).
 *
 * Kg received per supplier and per month, per raw material, so deliveries can be checked against
 * suppliers' invoices. Loads come from get_oil_supplier_recon (migration 20261029120000):
 *   - up to history_through: Mike's recon sheet (oil_raw_receipts, one row per load)
 *   - after it: portal deliveries (New delivery bags grouped per load)
 * Macavation's own material is shown on its own line and left out of the "Bought in" total, like
 * the sheet's Total row.
 *
 * Security invariant: every DB-supplied or user-supplied string goes through esc() before it
 * reaches markup.
 */
var _supplierIntakeRecon = (function () {
    'use strict';

    var COLS = [
        { key: 'cracker_dust_kg', name: 'Cracker dust' },
        { key: 'kernel_dust_kg', name: 'Kernel dust' },
        { key: 'food_grade_kg', name: 'FG kernel' },
        { key: 'crude_kg', name: 'Crude kernel' }
    ];
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var FLAG_LABEL = { check_duplicate: 'Check: possible repeat', date_corrected: 'Date corrected' };

    var state = {
        from: null,
        to: null,
        supplier: '',       // '' = all suppliers
        result: null,       // get_oil_supplier_recon result, or null when unavailable
        error: '',
        loaded: false
    };

    function esc(v) { return _common.escapeHtml(v == null ? '' : String(v)); }
    function kg(v) { var n = Number(v); return _common.formatKg(isFinite(n) ? n : 0, 0); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function fmtDate(iso) {
        var p = String(iso || '').split('T')[0].split('-');
        if (p.length !== 3) { return String(iso || ''); }
        return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
    }
    function monthName(ym) { return MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }
    function isOk(r) { return !!r && r.success !== false && !r.error; }
    function errText(r, fallback) { return (r && (r.error || r.message)) ? String(r.error || r.message) : fallback; }
    function safe(p) { return Promise.resolve(p).catch(function (e) { return { success: false, error: String(e && e.message || e) }; }); }
    function loadTotal(l) { return COLS.reduce(function (s, c) { return s + (Number(l[c.key]) || 0); }, 0); }

    function emptySum() { var s = { loads: 0, total: 0 }; COLS.forEach(function (c) { s[c.key] = 0; }); return s; }
    function addTo(sum, l) {
        sum.loads++;
        COLS.forEach(function (c) { sum[c.key] += Number(l[c.key]) || 0; });
        sum.total += loadTotal(l);
    }

    function load() {
        if (!state.from) { state.from = todayStr().slice(0, 4) + '-01-01'; }
        if (!state.to) { state.to = todayStr(); }
        var wanted = state.from + '|' + state.to;
        $('#siPaneRecon').html('<div class="text-muted p-3">Loading…</div>');
        return safe(dataFunctions.getOilSupplierRecon(state.from, state.to)).then(function (r) {
            if (state.from + '|' + state.to !== wanted) { return; }
            state.loaded = true;
            if (isOk(r) && Array.isArray(r.loads)) {
                state.result = r;
            } else {
                console.warn('[Supplier Intake] get_oil_supplier_recon unavailable:', errText(r, ''));
                state.result = null;
                state.error = errText(r, '');
            }
            render();
        });
    }

    function sumRow(label, s, cls) {
        var h = '<tr class="' + (cls || '') + '"><td>' + label + '</td><td class="text-end">' + esc(s.loads) + '</td>';
        COLS.forEach(function (c) { h += '<td class="text-end">' + esc(kg(s[c.key])) + '</td>'; });
        return h + '<td class="text-end fw-semibold">' + esc(kg(s.total)) + '</td></tr>';
    }

    function headRow(first) {
        var h = '<thead><tr><th>' + first + '</th><th class="text-end">Loads</th>';
        COLS.forEach(function (c) { h += '<th class="text-end">' + esc(c.name) + ' (kg)</th>'; });
        return h + '<th class="text-end">Total (kg)</th></tr></thead>';
    }

    function render() {
        var $p = $('#siPaneRecon');
        var r = state.result;
        var h = '<div class="card mb-3 mac-module-filter-bar"><div class="card-body"><div class="row g-2 align-items-end">' +
            '<div class="col-6 col-md-3 col-lg-2"><label for="siReconFrom" class="form-label">From</label>' +
            '<input type="date" class="form-control" id="siReconFrom" value="' + esc(state.from) + '"></div>' +
            '<div class="col-6 col-md-3 col-lg-2"><label for="siReconTo" class="form-label">To</label>' +
            '<input type="date" class="form-control" id="siReconTo" value="' + esc(state.to) + '"></div>' +
            '<div class="col-12 col-md-4 col-lg-3"><label for="siReconSupplier" class="form-label">Supplier</label>' +
            '<select class="form-select" id="siReconSupplier"><option value="">All suppliers</option>';
        var loads = r ? r.loads : [];
        var names = {};
        loads.forEach(function (l) { names[l.supplier] = true; });
        if (state.supplier) { names[state.supplier] = true; }
        Object.keys(names).sort().forEach(function (n) {
            h += '<option value="' + esc(n) + '"' + (n === state.supplier ? ' selected' : '') + '>' + esc(n) + '</option>';
        });
        h += '</select></div>' +
            '<div class="col-12 col-md-2 col-lg-2 ms-lg-auto"><button type="button" class="btn btn-outline-secondary w-100" id="siReconExport"' +
            (r && loads.length ? '' : ' disabled') + '><i class="fas fa-download me-1" aria-hidden="true"></i>Export loads</button></div>' +
            '</div></div></div>';

        if (!r) {
            $p.html(h + '<div class="alert alert-warning">The supplier recon isn\'t set up on this database yet' +
                (state.error ? ' (' + esc(state.error) + ')' : '') + '.</div>');
            return;
        }

        var shown = state.supplier ? loads.filter(function (l) { return l.supplier === state.supplier; }) : loads;

        // Headline numbers
        var bought = emptySum(), own = emptySum();
        shown.forEach(function (l) { addTo(l.own ? own : bought, l); });
        var flagged = shown.filter(function (l) { return !!l.flag; });
        h += '<div class="si-cake-totals">' +
            '<div class="card"><div class="card-body"><span>Bought in</span><strong>' + esc(kg(bought.total)) + ' kg</strong>' +
            '<div class="small text-muted">' + esc(bought.loads) + ' loads</div></div></div>' +
            '<div class="card"><div class="card-body"><span>Our own material</span><strong>' + esc(kg(own.total)) + ' kg</strong>' +
            '<div class="small text-muted">' + esc(own.loads) + ' loads</div></div></div>' +
            '<div class="card"><div class="card-body"><span>All received</span><strong>' + esc(kg(bought.total + own.total)) + ' kg</strong>' +
            '<div class="small text-muted">' + esc(fmtDate(state.from)) + ' – ' + esc(fmtDate(state.to)) + '</div></div></div>' +
            '</div>';
        if (flagged.length) {
            h += '<div class="alert alert-warning">' + esc(flagged.length) + (flagged.length === 1 ? ' load needs' : ' loads need') +
                ' a look. They are marked in the loads list below.</div>';
        }

        // By supplier
        if (!state.supplier) {
            var bySup = {};
            loads.forEach(function (l) {
                var s = bySup[l.supplier] || (bySup[l.supplier] = { name: l.supplier, own: !!l.own, sum: emptySum() });
                addTo(s.sum, l);
            });
            var sups = Object.keys(bySup).map(function (k) { return bySup[k]; }).sort(function (a, b) {
                if (a.own !== b.own) { return a.own ? 1 : -1; }
                return b.sum.total - a.sum.total;
            });
            h += '<div class="card mb-3"><div class="card-body p-0"><h3 class="h6 px-3 pt-3">By supplier</h3>' +
                '<div class="table-responsive"><table class="table align-middle mb-0 si-recon-table">' + headRow('Supplier') + '<tbody>';
            if (!sups.length) { h += '<tr><td colspan="7" class="text-muted">No loads in this period.</td></tr>'; }
            sups.forEach(function (s) {
                h += sumRow('<button type="button" class="btn btn-link p-0 si-recon-pick" data-supplier="' + esc(s.name) + '">' + esc(s.name) + '</button>' +
                    (s.own ? ' <span class="small text-muted">(own cracking)</span>' : ''), s.sum);
            });
            h += '</tbody><tfoot>' + sumRow('Bought in', bought, 'si-recon-total') + sumRow('All received', (function () {
                var all = emptySum(); loads.forEach(function (l) { addTo(all, l); }); return all;
            })(), 'si-recon-total') + '</tfoot></table></div></div></div>';
        }

        // By month
        var byMonth = {};
        shown.forEach(function (l) {
            var ym = String(l.received_date).slice(0, 7);
            addTo(byMonth[ym] || (byMonth[ym] = emptySum()), l);
        });
        var months = Object.keys(byMonth).sort();
        h += '<div class="card mb-3"><div class="card-body p-0"><h3 class="h6 px-3 pt-3">By month' +
            (state.supplier ? ' — ' + esc(state.supplier) : ', all suppliers') + '</h3>' +
            '<div class="table-responsive"><table class="table align-middle mb-0 si-recon-table">' + headRow('Month') + '<tbody>';
        if (!months.length) { h += '<tr><td colspan="7" class="text-muted">No loads in this period.</td></tr>'; }
        months.forEach(function (ym) { h += sumRow(esc(monthName(ym)), byMonth[ym]); });
        var tot = emptySum(); shown.forEach(function (l) { addTo(tot, l); });
        h += '</tbody>' + (months.length ? '<tfoot>' + sumRow('Total', tot, 'si-recon-total') + '</tfoot>' : '') + '</table></div></div></div>';

        // Loads
        h += '<div class="card"><div class="card-body p-0"><h3 class="h6 px-3 pt-3">Loads</h3>' +
            '<div class="table-responsive"><table class="table align-middle mb-0 si-recon-table"><thead><tr><th>Date</th><th>Supplier</th><th>From</th>';
        COLS.forEach(function (c) { h += '<th class="text-end">' + esc(c.name) + '</th>'; });
        h += '<th class="text-end">Total</th><th>Note</th></tr></thead><tbody>';
        if (!shown.length) { h += '<tr><td colspan="9" class="text-muted">No loads in this period.</td></tr>'; }
        shown.slice().sort(function (a, b) { return a.received_date < b.received_date ? 1 : a.received_date > b.received_date ? -1 : 0; }).forEach(function (l) {
            h += '<tr' + (l.flag ? ' class="si-recon-flagged"' : '') + '><td class="text-nowrap">' + esc(fmtDate(l.received_date)) + '</td>' +
                '<td>' + esc(l.supplier) + '</td>' +
                '<td class="small text-muted text-nowrap">' + (l.source === 'portal' ? 'Portal' + (l.reference ? ' · ' + esc(l.reference) : '') : 'Recon sheet') + '</td>';
            COLS.forEach(function (c) { h += '<td class="text-end">' + (Number(l[c.key]) ? esc(kg(l[c.key])) : '<span class="text-muted">–</span>') + '</td>'; });
            h += '<td class="text-end fw-semibold">' + esc(kg(loadTotal(l))) + '</td><td class="small">' +
                (l.flag ? '<span class="si-stock-pill si-stock-pill-amber">' + esc(FLAG_LABEL[l.flag] || l.flag) + '</span> ' : '') +
                (l.note ? esc(l.note) : '') + '</td></tr>';
        });
        h += '</tbody></table></div></div></div>';

        h += '<p class="small text-muted mt-3 mb-0">Loads up to ' + esc(fmtDate(r.history_through)) +
            ' come from the recon sheet (one line per load). Loads after that day come from New delivery in the portal. ' +
            'Our own material is cracker dust and kernel from our own cracking; it is not part of the Bought in total.</p>';
        $p.html(h);
    }

    function exportLoads() {
        var r = state.result;
        if (!r || typeof _exportUtils === 'undefined') { return; }
        var shown = state.supplier ? r.loads.filter(function (l) { return l.supplier === state.supplier; }) : r.loads;
        var rows = shown.map(function (l) {
            return {
                date: l.received_date, supplier: l.supplier, own: l.own ? 'Yes' : 'No',
                from: l.source === 'portal' ? 'Portal' : 'Recon sheet', reference: l.reference || '',
                cracker_dust_kg: Number(l.cracker_dust_kg) || 0, kernel_dust_kg: Number(l.kernel_dust_kg) || 0,
                food_grade_kg: Number(l.food_grade_kg) || 0, crude_kg: Number(l.crude_kg) || 0,
                total_kg: Math.round(loadTotal(l) * 100) / 100,
                note: (l.flag ? (FLAG_LABEL[l.flag] || l.flag) + '. ' : '') + (l.note || '')
            };
        });
        _exportUtils.exportToCSV(rows, 'oil-supplier-recon-' + state.from + '-to-' + state.to + '.csv', [
            { key: 'date', label: 'Date' }, { key: 'supplier', label: 'Supplier' }, { key: 'own', label: 'Own material' },
            { key: 'from', label: 'From' }, { key: 'reference', label: 'Delivery note' },
            { key: 'cracker_dust_kg', label: 'Cracker dust (kg)' }, { key: 'kernel_dust_kg', label: 'Kernel dust (kg)' },
            { key: 'food_grade_kg', label: 'FG kernel (kg)' }, { key: 'crude_kg', label: 'Crude kernel (kg)' },
            { key: 'total_kg', label: 'Total (kg)' }, { key: 'note', label: 'Note' }
        ]);
    }

    function setRange(from, to) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) { return; }
        if (to < from) {
            if (typeof Swal !== 'undefined') { Swal.fire({ icon: 'warning', text: 'The To date is before the From date.' }); }
            return;
        }
        state.from = from;
        state.to = to;
        load();
    }

    function bindEvents() {
        // Namespaced on the module root, which the router replaces on each visit.
        $('#supplierIntakeModule')
            .off('.siRecon')
            .on('change.siRecon', '#siReconFrom, #siReconTo', function () {
                setRange(String($('#siReconFrom').val() || ''), String($('#siReconTo').val() || ''));
            })
            .on('change.siRecon', '#siReconSupplier', function () { state.supplier = String($(this).val() || ''); render(); })
            .on('click.siRecon', '.si-recon-pick', function () { state.supplier = String($(this).attr('data-supplier') || ''); render(); })
            .on('click.siRecon', '#siReconExport', exportLoads);
    }

    return {
        init: function () {
            state.from = null;
            state.to = null;
            state.supplier = '';
            state.result = null;
            state.loaded = false;
            bindEvents();
        },
        // Called when the tab is opened; loads once per visit, the date pickers reload.
        show: function () { if (!state.loaded) { load(); } }
    };
})();
