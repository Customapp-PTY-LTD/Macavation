/**
 * Supplier Intake (oil plant) — Raw material stock and Oil cake tabs (Mike, 29 Oct 2026).
 *
 * Raw material stock: per material, stock on hand = Mike's stock count + bags received since the
 * count − bags released to Oil Production since (get_oil_raw_stock, migration 20261029100000).
 * Food grade and crude oil kernel are one pool. Minimum = a month of use (daily × 4 days × 4 weeks).
 * Until the migration is applied the tab shows the count alone (DEFAULTS) and says so.
 *
 * Oil cake: production and sales recorded separately; there is no stock-on-hand line for cake.
 *
 * Security invariant: every DB-supplied or user-supplied string goes through esc() before it
 * reaches markup.
 */
var _supplierIntakeStock = (function () {
    'use strict';

    var MATERIALS = [
        { key: 'oil_kernel', name: 'Oil kernel (food grade + crude)' },
        { key: 'kernel_dust', name: 'Kernel dust' },
        { key: 'cracker_dust', name: 'Cracker dust' }
    ];
    // Mike's count of 26 Oct 2026 ("Oil Pressing Plan YE27", Setup - Settings) — same as the migration seed.
    var DEFAULTS = {
        count_date: '2026-10-26',
        materials: {
            oil_kernel: { daily_kg: 2500, count_kg: 13350, count_food_grade_kg: 0 },
            kernel_dust: { daily_kg: 3000, count_kg: 8636 },
            cracker_dust: { daily_kg: 10000, count_kg: 66059 }
        }
    };
    var WORK_DAYS_PER_WEEK = 4;
    var MIN_WEEKS = 4;
    var AMBER_DAYS = 5; // amber when within 5 working days above the minimum (Mike's sheet)
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    var state = {
        tab: 'deliveries',
        stock: null,        // get_oil_raw_stock result
        stockFallback: false,
        settingsOpen: false,
        cakeMonth: null,    // 'YYYY-MM'
        cake: null,         // get_oil_cake_movements result, or null when unavailable
        cakeKind: 'produced'
    };

    function esc(v) { return _common.escapeHtml(v == null ? '' : String(v)); }
    function kg(v, dp) { var n = Number(v); return _common.formatKg(isFinite(n) ? n : 0, dp === undefined ? 0 : dp); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function fmtDate(iso) {
        var p = String(iso || '').split('T')[0].split('-');
        if (p.length !== 3) { return String(iso || ''); }
        return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
    }
    function isOk(r) { return !!r && r.success !== false && !r.error; }
    function errText(r, fallback) { return (r && (r.error || r.message)) ? String(r.error || r.message) : fallback; }
    function safe(p) { return Promise.resolve(p).catch(function (e) { return { success: false, error: String(e && e.message || e) }; }); }
    function notify(icon, text) { if (typeof Swal !== 'undefined') { Swal.fire({ icon: icon, text: text }); } }

    // ------------------------------------------------------------------
    // Tabs
    // ------------------------------------------------------------------

    function showTab(tab) {
        state.tab = tab;
        $('.si-tab').each(function () {
            $(this).attr('aria-selected', $(this).attr('data-si-tab') === tab ? 'true' : 'false');
        });
        $('#siPaneDeliveries').toggleClass('d-none', tab !== 'deliveries');
        $('#siPaneStock').toggleClass('d-none', tab !== 'stock');
        $('#siPaneCake').toggleClass('d-none', tab !== 'cake');
        if (tab === 'stock') { loadStock(); }
        if (tab === 'cake') { loadCake(); }
    }

    // ------------------------------------------------------------------
    // Raw material stock
    // ------------------------------------------------------------------

    // Same sums as get_oil_raw_stock, from the count alone (database not migrated yet).
    function fallbackStock() {
        return {
            success: true,
            count_date: DEFAULTS.count_date,
            settings: DEFAULTS,
            materials: MATERIALS.map(function (m) {
                var s = DEFAULTS.materials[m.key];
                return {
                    material: m.key, count_kg: s.count_kg, received_kg: 0, used_kg: 0, on_hand_kg: s.count_kg,
                    daily_kg: s.daily_kg, minimum_kg: s.daily_kg * WORK_DAYS_PER_WEEK * MIN_WEEKS,
                    days_cover: s.daily_kg > 0 ? Math.round(s.count_kg / s.daily_kg * 10) / 10 : null,
                    food_grade_kg: m.key === 'oil_kernel' ? (s.count_food_grade_kg || 0) : undefined
                };
            })
        };
    }

    function loadStock() {
        return safe(dataFunctions.getOilRawStock()).then(function (r) {
            if (isOk(r) && Array.isArray(r.materials)) {
                state.stock = r;
                state.stockFallback = false;
            } else {
                console.warn('[Supplier Intake] get_oil_raw_stock unavailable, showing the stock count only:', errText(r, ''));
                state.stock = fallbackStock();
                state.stockFallback = true;
            }
            renderStock();
        });
    }

    function materialInfo(row) {
        var meta = MATERIALS.filter(function (m) { return m.key === row.material; })[0] || { name: row.material };
        var daily = Number(row.daily_kg) || 0;
        var onHand = Number(row.on_hand_kg) || 0;
        var min = Number(row.minimum_kg) || daily * WORK_DAYS_PER_WEEK * MIN_WEEKS;
        var days = daily > 0 ? onHand / daily : null;
        var status = 'ok';
        if (onHand < min) { status = 'low'; }
        else if (onHand < min + AMBER_DAYS * daily) { status = 'amber'; }
        return { row: row, name: meta.name, daily: daily, onHand: onHand, min: min, days: days, status: status };
    }

    var STATUS_LABEL = { low: 'Below minimum', amber: 'Getting low', ok: 'OK' };

    function renderStock() {
        var $p = $('#siPaneStock');
        var r = state.stock;
        if (!r) { $p.html('<div class="text-muted p-3">Loading…</div>'); return; }
        var infos = r.materials.map(materialInfo).sort(function (a, b) {
            var da = a.days == null ? Infinity : a.days, db = b.days == null ? Infinity : b.days;
            return da - db;
        });
        var low = infos.filter(function (i) { return i.status === 'low'; }).length;
        $('#siStockLowBadge').toggleClass('d-none', low === 0).text(low + ' low');

        var h = '';
        if (state.stockFallback) {
            h += '<div class="alert alert-warning">Live stock isn\'t set up on this database yet. Showing the stock count of ' +
                esc(fmtDate(r.count_date)) + ' only; deliveries and releases since then are not counted.</div>';
        }
        var first = infos[0];
        if (first) {
            h += '<div class="card mb-3"><div class="card-body si-stock-head">' +
                '<div><div class="si-stock-eyebrow">Buy first</div><div class="si-stock-first">' + esc(first.name) + '</div>' +
                '<div class="text-muted">' + esc(kg(first.onHand)) + ' kg on hand' +
                (first.days == null ? '' : ', lasts ' + esc(first.days.toFixed(1)) + ' working days') +
                (first.onHand < first.min ? '. Needs ' + esc(kg(first.min - first.onHand)) + ' kg more to reach a month of stock.' : '.') +
                '</div></div>' +
                '<div class="si-stock-head-side"><span class="small text-muted">Plant works ' + WORK_DAYS_PER_WEEK + ' days a week · minimum = ' +
                MIN_WEEKS + ' weeks of use</span>' +
                '<button type="button" class="btn btn-outline-secondary" id="siStockSettingsBtn" aria-expanded="' + (state.settingsOpen ? 'true' : 'false') + '">' +
                '<i class="fas fa-sliders me-1" aria-hidden="true"></i>Stock count &amp; daily use</button></div>' +
                '</div></div>';
        }
        if (state.settingsOpen) { h += settingsHtml(r); }

        h += '<div class="si-stock-cards">';
        infos.forEach(function (i, idx) {
            var scale = Math.max(i.min * 1.5, i.onHand * 1.1, 1);
            var fillPct = Math.max(0, Math.min(100, i.onHand / scale * 100));
            var minPct = Math.min(100, i.min / scale * 100);
            var sub = '';
            if (i.row.material === 'oil_kernel') {
                var fg = Number(i.row.food_grade_kg) || 0;
                sub = '<div class="si-stock-sub">Crude ' + esc(kg(i.onHand - fg)) + ' · Food grade ' + esc(kg(fg)) + '</div>';
            }
            h += '<div class="card si-stock-card"><div class="card-body">' +
                '<div class="si-stock-card-top"><div><div class="small text-muted">#' + (idx + 1) + ' to buy</div>' +
                '<div class="fw-semibold">' + esc(i.name) + '</div></div>' +
                '<span class="si-stock-pill si-stock-pill-' + i.status + '">' + esc(STATUS_LABEL[i.status]) + '</span></div>' +
                '<div class="si-stock-kg">' + esc(kg(i.onHand)) + ' <span>kg on hand</span></div>' + sub +
                '<div class="si-stock-bar" role="img" aria-label="' + esc(kg(i.onHand)) + ' kg of a ' + esc(kg(i.min)) + ' kg minimum">' +
                '<span class="si-stock-bar-fill si-stock-bar-' + i.status + '" style="width:' + fillPct.toFixed(1) + '%"></span>' +
                '<span class="si-stock-bar-min" style="left:' + minPct.toFixed(1) + '%"></span></div>' +
                '<div class="si-stock-bar-scale"><span>0</span><span class="si-stock-bar-min-label" style="left:' + minPct.toFixed(1) + '%">min ' + esc(kg(i.min)) + '</span></div>' +
                '<div class="si-stock-facts">' +
                '<div><span>Lasts</span><strong>' + (i.days == null ? 'Set daily use' : esc(i.days.toFixed(1)) + ' working days') + '</strong></div>' +
                '<div><span>Weeks cover</span><strong>' + (i.days == null ? '&mdash;' : esc((i.days / WORK_DAYS_PER_WEEK).toFixed(1))) + '</strong></div>' +
                '<div><span>Short of minimum</span><strong class="' + (i.onHand < i.min ? 'text-danger' : '') + '">' +
                (i.onHand < i.min ? esc(kg(i.min - i.onHand)) + ' kg' : 'None') + '</strong></div>' +
                '</div>' +
                '<div class="si-stock-sum small text-muted">Count ' + esc(kg(i.row.count_kg)) + ' + received ' + esc(kg(i.row.received_kg)) +
                ' − released ' + esc(kg(i.row.used_kg)) + '</div>' +
                '</div></div>';
        });
        h += '</div>';
        h += '<p class="small text-muted mt-3 mb-0">Stock on hand is the stock count of ' + esc(fmtDate(r.count_date)) +
            ', plus every bag received after that day, minus every bag released to Oil Production after it. A bag used without being released here is still counted as stock. ' +
            'Food grade and crude oil kernel are received separately but count as one pool. Oil cake is made in the plant and is tracked on the Oil cake tab.</p>';
        $p.html(h);
    }

    function settingsHtml(r) {
        var set = (r && r.settings && r.settings.materials) ? r.settings : DEFAULTS;
        var h = '<div class="card mb-3"><div class="card-body">' +
            '<h3 class="h6">Stock count and daily use</h3>' +
            '<p class="small text-muted">Enter a new stock count when you count the store again. Daily use is per working day; the minimum is worked out from it.</p>' +
            '<div class="row g-2 align-items-end mb-2"><div class="col-sm-4 col-lg-3">' +
            '<label for="siCountDate" class="form-label">Stock counted on</label>' +
            '<input type="date" class="form-control" id="siCountDate" max="' + esc(todayStr()) + '" value="' + esc(set.count_date || r.count_date || '') + '"></div></div>' +
            '<div class="table-responsive"><table class="table align-middle mb-2"><thead><tr><th>Material</th><th>Counted (kg)</th><th>Daily use (kg)</th><th class="text-end">Minimum (kg)</th></tr></thead><tbody>';
        MATERIALS.forEach(function (m) {
            var s = (set.materials && set.materials[m.key]) || {};
            var count = '<input type="number" class="form-control si-set-count" min="0" step="1" data-key="' + m.key + '" aria-label="' + esc(m.name) + ' counted kg" value="' + esc(s.count_kg != null ? s.count_kg : '') + '">';
            if (m.key === 'oil_kernel') {
                var fg = Number(s.count_food_grade_kg) || 0;
                count = '<div class="d-flex gap-2 flex-wrap">' +
                    '<label class="small">Crude<input type="number" class="form-control si-set-crude" min="0" step="1" value="' + esc((Number(s.count_kg) || 0) - fg) + '"></label>' +
                    '<label class="small">Food grade<input type="number" class="form-control si-set-fg" min="0" step="1" value="' + esc(fg) + '"></label></div>';
            }
            h += '<tr><td class="fw-semibold">' + esc(m.name) + '</td><td>' + count + '</td>' +
                '<td><input type="number" class="form-control si-set-daily" min="0" step="1" data-key="' + m.key + '" aria-label="' + esc(m.name) + ' daily use kg" value="' + esc(s.daily_kg != null ? s.daily_kg : '') + '"></td>' +
                '<td class="text-end">' + esc(kg((Number(s.daily_kg) || 0) * WORK_DAYS_PER_WEEK * MIN_WEEKS)) + '</td></tr>';
        });
        h += '</tbody></table></div>' +
            '<div class="d-flex gap-2"><button type="button" class="btn btn-primary" id="siStockSettingsSave"' + (state.stockFallback ? ' disabled' : '') + '>Save</button>' +
            '<button type="button" class="btn btn-outline-secondary" id="siStockSettingsCancel">Cancel</button></div>' +
            '</div></div>';
        return h;
    }

    function saveSettings() {
        var materials = {};
        var bad = false;
        function num(v) { var n = Number(v); if (v === '' || !isFinite(n) || n < 0) { bad = true; } return n; }
        MATERIALS.forEach(function (m) { materials[m.key] = {}; });
        $('.si-set-daily').each(function () { materials[$(this).attr('data-key')].daily_kg = num($(this).val()); });
        $('.si-set-count').each(function () { materials[$(this).attr('data-key')].count_kg = num($(this).val()); });
        var crude = num($('.si-set-crude').val()), fg = num($('.si-set-fg').val());
        materials.oil_kernel.count_kg = crude + fg;
        materials.oil_kernel.count_food_grade_kg = fg;
        var countDate = String($('#siCountDate').val() || '');
        if (bad || !/^\d{4}-\d{2}-\d{2}$/.test(countDate)) { notify('warning', 'Fill in every weight (0 or more) and the count date.'); return; }
        $('#siStockSettingsSave').prop('disabled', true);
        safe(dataFunctions.setOilRawStockSettings({ count_date: countDate, materials: materials })).then(function (r) {
            if (!isOk(r)) { notify('error', errText(r, 'Could not save the stock count.')); $('#siStockSettingsSave').prop('disabled', false); return; }
            state.settingsOpen = false;
            loadStock();
        });
    }

    // ------------------------------------------------------------------
    // Oil cake
    // ------------------------------------------------------------------

    function monthRange(ym) {
        var p = ym.split('-'), y = Number(p[0]), m = Number(p[1]);
        var last = new Date(y, m, 0).getDate();
        return { from: ym + '-01', to: ym + '-' + pad2(last) };
    }

    function loadCake() {
        if (!state.cakeMonth) { state.cakeMonth = todayStr().slice(0, 7); }
        var range = monthRange(state.cakeMonth);
        var wanted = state.cakeMonth;
        return safe(dataFunctions.getOilCakeMovements(range.from, range.to)).then(function (r) {
            if (state.cakeMonth !== wanted) { return; }
            state.cake = isOk(r) && Array.isArray(r.movements) ? r : null;
            renderCake();
        });
    }

    function renderCake() {
        var $p = $('#siPaneCake');
        var r = state.cake;
        var ym = state.cakeMonth || todayStr().slice(0, 7);
        var monthName = MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
        if (r === null) {
            $p.html('<div class="alert alert-warning">The oil cake log isn\'t set up on this database yet.</div>');
            return;
        }
        var sale = state.cakeKind === 'sold';
        var h = '<div class="d-flex flex-wrap gap-2 align-items-center mb-3">' +
            '<label for="siCakeMonth" class="form-label mb-0 fw-semibold">Month</label>' +
            '<input type="month" class="form-control si-cake-month" id="siCakeMonth" max="' + esc(todayStr().slice(0, 7)) + '" value="' + esc(ym) + '"></div>';
        h += '<div class="si-cake-totals">' +
            '<div class="card"><div class="card-body"><span>Produced in ' + esc(monthName) + '</span><strong>' + esc(kg(r.produced_kg)) + ' kg</strong></div></div>' +
            '<div class="card"><div class="card-body"><span>Sold in ' + esc(monthName) + '</span><strong>' + esc(kg(r.sold_kg)) + ' kg</strong></div></div>' +
            '</div>';
        h += '<div class="card mb-3"><div class="card-body">' +
            '<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><h3 class="h6 mb-0">Record oil cake</h3>' +
            '<div class="btn-group" role="group" aria-label="Record type">' +
            '<button type="button" class="btn btn-outline-secondary si-cake-kind' + (!sale ? ' active' : '') + '" data-kind="produced" aria-pressed="' + (!sale) + '">Production</button>' +
            '<button type="button" class="btn btn-outline-secondary si-cake-kind' + (sale ? ' active' : '') + '" data-kind="sold" aria-pressed="' + sale + '">Sale</button>' +
            '</div></div>' +
            '<div class="row g-2 align-items-end">' +
            '<div class="col-sm-6 col-lg-2"><label for="siCakeDate" class="form-label">Date</label><input type="date" class="form-control" id="siCakeDate" max="' + esc(todayStr()) + '" value="' + esc(todayStr()) + '"></div>' +
            '<div class="col-sm-6 col-lg-2"><label for="siCakeKg" class="form-label">Weight (kg)</label><input type="number" class="form-control" id="siCakeKg" min="0" step="0.01"></div>' +
            (sale ? '<div class="col-sm-6 col-lg-3"><label for="siCakeSoldTo" class="form-label">Sold to</label><input type="text" class="form-control" id="siCakeSoldTo" maxlength="200"></div>' : '') +
            '<div class="col-sm-6 col-lg-3"><label for="siCakeNotes" class="form-label">Notes</label><input type="text" class="form-control" id="siCakeNotes" maxlength="500" placeholder="Optional"></div>' +
            '<div class="col-sm-6 col-lg-2"><button type="button" class="btn btn-primary w-100" id="siCakeSave">' + (sale ? 'Save sale' : 'Save production') + '</button></div>' +
            '</div></div></div>';
        h += '<div class="card"><div class="card-body p-0"><div class="table-responsive"><table class="table align-middle mb-0">' +
            '<thead><tr><th>Date</th><th>Type</th><th>Sold to</th><th>Notes</th><th class="text-end">Weight (kg)</th><th></th></tr></thead><tbody>';
        if (!r.movements.length) {
            h += '<tr><td colspan="6" class="text-muted">Nothing recorded in ' + esc(monthName) + '.</td></tr>';
        }
        r.movements.forEach(function (m) {
            var sold = m.kind === 'sold';
            h += '<tr><td class="text-nowrap">' + esc(fmtDate(m.movement_date)) + '</td>' +
                '<td><span class="si-cake-pill si-cake-pill-' + (sold ? 'sold' : 'produced') + '">' + (sold ? 'Sold' : 'Produced') + '</span></td>' +
                '<td>' + (m.sold_to ? esc(m.sold_to) : '&mdash;') + '</td><td>' + (m.notes ? esc(m.notes) : '') + '</td>' +
                '<td class="text-end">' + esc(kg(m.kg, 2)) + '</td>' +
                '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-secondary si-cake-void" data-id="' + esc(m.id) + '">Remove</button></td></tr>';
        });
        h += '</tbody></table></div></div></div>';
        $p.html(h);
    }

    function saveCake() {
        var sale = state.cakeKind === 'sold';
        var date = String($('#siCakeDate').val() || '');
        var amount = Number($('#siCakeKg').val());
        var soldTo = sale ? String($('#siCakeSoldTo').val() || '').trim() : null;
        var notes = String($('#siCakeNotes').val() || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { notify('warning', 'Enter the date.'); return; }
        if (!(amount > 0)) { notify('warning', 'Enter the weight in kg.'); return; }
        if (sale && !soldTo) { notify('warning', 'Enter who the oil cake was sold to.'); return; }
        $('#siCakeSave').prop('disabled', true);
        safe(dataFunctions.saveOilCakeMovement(state.cakeKind, date, amount, soldTo, notes)).then(function (r) {
            if (!isOk(r)) { notify('error', errText(r, 'Could not save.')); $('#siCakeSave').prop('disabled', false); return; }
            state.cakeMonth = date.slice(0, 7);
            loadCake();
        });
    }

    function voidCake(id) {
        if (typeof Swal === 'undefined') { return; }
        Swal.fire({ icon: 'question', text: 'Remove this oil cake entry?', showCancelButton: true, confirmButtonText: 'Remove' }).then(function (c) {
            if (!c.isConfirmed) { return; }
            safe(dataFunctions.voidOilCakeMovement(id)).then(function (r) {
                if (!isOk(r)) { notify('error', errText(r, 'Could not remove the entry.')); }
                loadCake();
            });
        });
    }

    // ------------------------------------------------------------------

    function bindEvents() {
        // Namespaced on the module root, which the router replaces on each visit.
        $('#supplierIntakeModule')
            .off('.siStock')
            .on('click.siStock', '.si-tab', function () { showTab(String($(this).attr('data-si-tab') || 'deliveries')); })
            .on('click.siStock', '#siStockSettingsBtn', function () { state.settingsOpen = !state.settingsOpen; renderStock(); })
            .on('click.siStock', '#siStockSettingsCancel', function () { state.settingsOpen = false; renderStock(); })
            .on('click.siStock', '#siStockSettingsSave', saveSettings)
            .on('change.siStock', '#siCakeMonth', function () {
                var v = String($(this).val() || '');
                if (/^\d{4}-\d{2}$/.test(v)) { state.cakeMonth = v; loadCake(); }
            })
            .on('click.siStock', '.si-cake-kind', function () { state.cakeKind = $(this).attr('data-kind') === 'sold' ? 'sold' : 'produced'; renderCake(); })
            .on('click.siStock', '#siCakeSave', saveCake)
            .on('click.siStock', '.si-cake-void', function () { voidCake(String($(this).attr('data-id') || '')); });
    }

    return {
        init: function () {
            state.tab = 'deliveries';
            state.settingsOpen = false;
            state.cakeMonth = null;
            state.cakeKind = 'produced';
            bindEvents();
            showTab('deliveries');
            // Load the stock quietly so the tab can show how many materials are below minimum.
            loadStock();
        },
        refresh: function () { loadStock(); }
    };
})();
