/**
 * Oil Raw Materials (Mike's "Oil Changes" email, 11-12 Nov 2026). Oil side step 2 of 5:
 * Receiving, Raw Materials, Production, Stock on Hand, Dispatch and Sales.
 *
 * Tabs: Stock levels (six material cards + the bags in stock, with Move to Production),
 * Weekly overview, Month-end count, Daily recipe (+ recipe settings), Supplier recon
 * (oil_raw_recon.js). Data comes from migration 20261112090000_oil_raw_materials.sql.
 *
 * Moving bags to Production calls dataFunctions.releaseSupplierIntakeToProductionWithWeights
 * one bag at a time, exactly like the Receiving "Release to Oil Production" button.
 *
 * Security invariant: every DB-supplied or user-supplied string goes through esc() before it
 * reaches markup. No innerHTML/.html() with raw values.
 */
var _oilRawMaterials = (function () {
    'use strict';

    var MATS = [
        { key: 'crude_kernel', name: 'Crude Grade Oil Kernel' },
        { key: 'food_grade_kernel', name: 'Food Grade Oil Kernel' },
        { key: 'kernel_dust', name: 'Kernel Dust' },
        { key: 'cracker_dust', name: 'Cracker Dust' },
        { key: 'crush', name: 'Crush' },
        { key: 'cake', name: 'Oil Cake' }
    ];
    var TABS = ['stock', 'weekly', 'count', 'recipe', 'recon'];
    var LEVELS = {
        critical: { label: 'Stock Level Critical', short: 'Critical', icon: 'fa-triangle-exclamation' },
        low: { label: 'Stock Level Low', short: 'Low', icon: 'fa-arrow-down' },
        manageable: { label: 'Stock Level Manageable', short: 'Manageable', icon: 'fa-minus' },
        good: { label: 'Stock Level Good', short: 'Good', icon: 'fa-check' }
    };
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    var state = {
        tab: 'stock',
        mats: null,          // get_oil_raw_materials result
        matsError: '',
        bags: null,          // mapped supplier-intake batches (array), or null when unavailable
        selected: {},        // bag id -> true (ticked for Move to Production)
        moveMat: null,
        moving: false,
        weeklyMat: 'crude_kernel',
        weekly: null,
        weeklyError: '',
        counts: null,        // month-end counts, all materials (history)
        countResult: null,   // response of the last save
        recipes: null,
        recipesError: ''
    };

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function esc(v) { return _common.escapeHtml(v == null ? '' : String(v)); }
    function kg(v, dp) { var n = Number(v); return _common.formatKg(isFinite(n) ? n : 0, dp === undefined ? 2 : dp); }
    function pad2(n) { return (n < 10 ? '0' : '') + n; }
    function todayStr() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
    function parts(iso) { var p = String(iso || '').split('T')[0].split('-'); return p.length === 3 ? p : null; }
    function fmtDate(iso) {
        var p = parts(iso);
        if (!p) { return String(iso || ''); }
        return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
    }
    function fmtDayMonth(iso) {
        var p = parts(iso);
        if (!p) { return String(iso || ''); }
        var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        return DAYS[d.getDay()] + ' ' + Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1];
    }
    function isOk(r) { return !!r && r.success !== false && !r.error; }
    function errText(r, fallback) { return (r && (r.error || r.message)) ? String(r.error || r.message) : fallback; }
    function safe(p) { return Promise.resolve(p).catch(function (e) { return { success: false, error: String(e && e.message || e) }; }); }
    function notify(icon, text) { if (typeof Swal !== 'undefined') { Swal.fire({ icon: icon, text: text }); } }
    function matName(key) { var m = MATS.filter(function (x) { return x.key === key; })[0]; return m ? m.name : String(key); }
    function num(v) { var n = Number(v); return isFinite(n) ? n : null; }

    function levelChip(level, extra) {
        var l = LEVELS[level];
        if (!l) { return '<span class="or-level or-level-none">Set the daily recipe</span>'; }
        return '<span class="or-level or-level-' + esc(level) + '"><i class="fas ' + l.icon + '" aria-hidden="true"></i> ' + esc(extra || l.label) + '</span>';
    }

    // ------------------------------------------------------------------
    // Tabs
    // ------------------------------------------------------------------

    function showTab(tab) {
        if (TABS.indexOf(tab) < 0) { tab = 'stock'; }
        state.tab = tab;
        $('.or-tab').each(function () {
            $(this).attr('aria-selected', $(this).attr('data-or-tab') === tab ? 'true' : 'false');
        });
        TABS.forEach(function (t) { $('#orPane_' + t).toggleClass('d-none', t !== tab); });
        if (tab === 'stock') { loadStock(); }
        if (tab === 'weekly') { loadWeekly(); }
        if (tab === 'count') { loadCount(); }
        if (tab === 'recipe') { loadRecipes(); }
        if (tab === 'recon' && typeof _oilRawRecon !== 'undefined') { _oilRawRecon.show(); }
    }

    // ------------------------------------------------------------------
    // Stock levels
    // ------------------------------------------------------------------

    function bagMaterial(b) {
        var pt = b && b.product_type;
        if (pt === 'oil_kernel') { return b.grade === 'food_grade' ? 'food_grade_kernel' : 'crude_kernel'; }
        if (pt === 'kernel_dust' || pt === 'cracker_dust' || pt === 'crush' || pt === 'cake') { return pt; }
        return null;
    }

    function loadMats() {
        return safe(dataFunctions.getOilRawMaterials()).then(function (r) {
            if (isOk(r) && Array.isArray(r.materials)) { state.mats = r; state.matsError = ''; }
            else { state.mats = null; state.matsError = errText(r, 'Could not load the stock levels.'); }
        });
    }

    function loadBags(force) {
        return safe(dataFunctions.getSupplierIntakeBatches('supplier_intake', null, !!force)).then(function (r) {
            state.bags = Array.isArray(r) ? r : null;
            // Drop ticks for bags that are no longer ready.
            var ready = {};
            (state.bags || []).forEach(function (b) { if (b.status === 'release_ready') { ready[String(b.id)] = true; } });
            Object.keys(state.selected).forEach(function (id) { if (!ready[id]) { delete state.selected[id]; } });
        });
    }

    function loadStock(force) {
        if (!state.mats) { $('#orPane_stock').html('<div class="text-muted p-3">Loading…</div>'); }
        return Promise.all([loadMats(), loadBags(force)]).then(function () { if (state.tab === 'stock') { renderStock(); } });
    }

    function legendHtml() {
        return '<div class="or-legend" aria-label="Stock levels">' +
            ['critical', 'low', 'manageable', 'good'].map(function (k) { return levelChip(k); }).join('') +
            '<span class="or-legend-note">1 week = daily use &times; 4 working days</span></div>';
    }

    function barHtml(m) {
        var onHand = Number(m.on_hand_kg) || 0;
        var wk = Number(m.week_kg) || 0;
        if (!(wk > 0)) {
            var s0 = Math.max(onHand * 1.1, 1);
            return '<div class="or-bar-wrap"><div class="or-bar" role="img" aria-label="' + esc(kg(onHand)) + ' kg on hand">' +
                '<span class="or-bar-fill" style="width:' + Math.min(100, onHand / s0 * 100).toFixed(1) + '%"></span></div></div>';
        }
        var scale = Math.max(wk * 5, onHand * 1.1);
        function pct(x) { return Math.max(0, Math.min(100, x / scale * 100)); }
        var h = '<div class="or-bar-wrap"><div class="or-bar" role="img" aria-label="' + esc(kg(onHand)) + ' kg on hand, ' +
            esc(m.weeks == null ? '' : Number(m.weeks).toFixed(1) + ' weeks of stock') + '">' +
            '<span class="or-zone or-zone-critical" style="left:0;width:' + pct(wk).toFixed(2) + '%"></span>' +
            '<span class="or-zone or-zone-low" style="left:' + pct(wk).toFixed(2) + '%;width:' + (pct(2 * wk) - pct(wk)).toFixed(2) + '%"></span>' +
            '<span class="or-zone or-zone-manageable" style="left:' + pct(2 * wk).toFixed(2) + '%;width:' + (pct(4 * wk) - pct(2 * wk)).toFixed(2) + '%"></span>' +
            '<span class="or-zone or-zone-good" style="left:' + pct(4 * wk).toFixed(2) + '%;width:' + (100 - pct(4 * wk)).toFixed(2) + '%"></span>' +
            '<span class="or-bar-fill" style="width:' + pct(onHand).toFixed(2) + '%"></span>' +
            '<span class="or-marker" style="left:' + pct(wk).toFixed(2) + '%"></span>' +
            '<span class="or-marker" style="left:' + pct(2 * wk).toFixed(2) + '%"></span>' +
            '<span class="or-marker" style="left:' + pct(4 * wk).toFixed(2) + '%"></span>' +
            '</div><div class="or-bar-labels">' +
            '<span class="or-mlabel" style="left:' + pct(wk).toFixed(2) + '%">1 week &middot; ' + esc(kg(wk, 0)) + ' kg</span>' +
            '<span class="or-mlabel or-mlabel-low" style="left:' + pct(2 * wk).toFixed(2) + '%">2 weeks &middot; ' + esc(kg(2 * wk, 0)) + ' kg</span>' +
            '<span class="or-mlabel" style="left:' + pct(4 * wk).toFixed(2) + '%">1 month &middot; ' + esc(kg(4 * wk, 0)) + ' kg</span>' +
            '</div></div>';
        return h;
    }

    function bagsFor(key) {
        return (state.bags || []).filter(function (b) {
            return bagMaterial(b) === key && (b.status === 'awaiting_test' || b.status === 'release_ready');
        }).sort(function (a, b) {
            var da = String(a.date_received || ''), db = String(b.date_received || '');
            return da < db ? -1 : da > db ? 1 : String(a.batch_number || '').localeCompare(String(b.batch_number || ''));
        });
    }

    function waitingText(b) {
        var d = b.ffa_decision;
        return (d && d.status === 'pending') ? 'Waiting for a decision' : 'Waiting for FFA';
    }

    function bagsHtml(key) {
        if (state.bags === null) { return '<div class="small text-muted">The bags in stock could not be loaded.</div>'; }
        var bags = bagsFor(key);
        var total = bags.reduce(function (s, b) { return s + (Number(b.quantity_kg) || 0); }, 0);
        var h = '<div class="or-bags"><div class="or-bags-head"><span class="fw-semibold">Bags in stock (' + esc(bags.length) + ')</span>' +
            '<span class="small text-muted">' + esc(kg(total)) + ' kg</span></div>';
        if (!bags.length) { return h + '<div class="small text-muted py-2">No bags waiting.</div></div>'; }
        h += '<div class="or-bags-scroll"><table class="table table-sm align-middle mb-0"><thead><tr><th class="or-col-tick"><span class="visually-hidden">Select</span></th>' +
            '<th>Batch #</th><th>Grade / description</th><th>Received</th><th>Supplier</th><th class="text-end">Weight (kg)</th></tr></thead><tbody>';
        bags.forEach(function (b) {
            var ready = b.status === 'release_ready';
            var id = String(b.id);
            var desc = b.description || (b.grade ? String(b.grade).replace(/_/g, ' ') : '') || '';
            h += '<tr class="' + (ready ? '' : 'or-bag-waiting') + '">' +
                '<td><input type="checkbox" class="form-check-input or-bag-tick" data-mat="' + esc(key) + '" data-id="' + esc(id) + '"' +
                (ready ? '' : ' disabled') + (state.selected[id] ? ' checked' : '') + ' aria-label="Select batch ' + esc(b.batch_number || '') + '"></td>' +
                '<td class="text-nowrap">' + esc(b.batch_number || '') + '</td>' +
                '<td>' + (esc(desc) || '&mdash;') + (ready ? '' : '<div class="small or-waiting-text">' + esc(waitingText(b)) + '</div>') + '</td>' +
                '<td class="text-nowrap">' + esc(fmtDate(b.date_received)) + '</td>' +
                '<td>' + esc(b.supplier_details || '') + '</td>' +
                '<td class="text-end text-nowrap">' + (b.quantity_kg != null && b.quantity_kg !== '' ? esc(kg(b.quantity_kg)) : '&mdash;') + '</td></tr>';
        });
        h += '</tbody></table></div>' +
            '<div class="or-bags-foot"><button type="button" class="btn btn-primary or-move-btn" data-mat="' + esc(key) + '" disabled></button></div></div>';
        return h;
    }

    function selectedBags(key) {
        return bagsFor(key).filter(function (b) { return b.status === 'release_ready' && state.selected[String(b.id)]; });
    }

    function updateMoveBtn(key) {
        var sel = selectedBags(key);
        var total = sel.reduce(function (s, b) { return s + (Number(b.quantity_kg) || 0); }, 0);
        $('.or-move-btn').filter(function () { return $(this).attr('data-mat') === key; })
            .prop('disabled', !sel.length)
            .text('Move ' + sel.length + (sel.length === 1 ? ' bag' : ' bags') + ' to Production (' + kg(total) + ' kg)');
    }

    function renderStock() {
        var $p = $('#orPane_stock');
        var r = state.mats;
        if (!r) {
            $p.html('<div class="alert alert-warning">' + esc(state.matsError || 'The stock levels are not available yet.') + '</div>');
            return;
        }
        var h = legendHtml();
        if (r.daily_source === 'settings') {
            h += '<div class="alert alert-info or-notice">Daily use is coming from the old figures until the first daily recipe is saved on the Daily recipe tab.</div>';
        }
        h += '<div class="or-cards">';
        MATS.forEach(function (meta) {
            var m = (r.materials || []).filter(function (x) { return x.material === meta.key; })[0] ||
                { material: meta.key, on_hand_kg: 0, week_kg: null, days: null, level: null };
            var days = num(m.days);
            h += '<div class="card or-card"><div class="card-body"><div class="or-card-top"><div class="fw-semibold">' + esc(meta.name) + '</div>' +
                levelChip(m.level) + '</div>' +
                '<div class="or-kg">' + esc(kg(m.on_hand_kg)) + ' <span>kg on hand</span></div>' +
                (days != null ? '<div class="or-days">about ' + esc(Math.round(days)) + ' working days left</div>' : '') +
                barHtml(m) + bagsHtml(meta.key) + '</div></div>';
        });
        h += '</div>';
        $p.html(h);
        MATS.forEach(function (meta) { updateMoveBtn(meta.key); });
    }

    // ---- Move to Production ----

    function openMoveModal(key) {
        var sel = selectedBags(key);
        if (!sel.length) { return; }
        state.moveMat = key;
        var h = '<p class="small text-muted">Weigh each bag and confirm its weight before production. This weight comes off raw material stock. ' +
            'If it is more than <strong>50 kg</strong> below the weight received, a warning is added to the dashboard.</p>' +
            '<div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr><th>Batch #</th><th>Grade / description</th>' +
            '<th class="text-end">Received (kg)</th><th class="text-end or-col-weigh">Weight before production (kg)</th></tr></thead><tbody>';
        sel.forEach(function (b) {
            var first = Number(b.quantity_kg);
            h += '<tr><td class="text-nowrap">' + esc(b.batch_number || '') + '</td>' +
                '<td>' + (esc(b.description || '') || '&mdash;') + '</td>' +
                '<td class="text-end">' + (isFinite(first) && b.quantity_kg != null && b.quantity_kg !== '' ? esc(kg(first)) : '&mdash;') + '</td>' +
                '<td><input type="text" inputmode="decimal" class="form-control form-control-sm text-end js-kg-input or-move-weight" data-id="' + esc(b.id) + '" ' +
                'aria-label="Weight before production for batch ' + esc(b.batch_number || '') + '" value="' +
                esc(isFinite(first) && b.quantity_kg != null && b.quantity_kg !== '' ? _common.formatKg(first) : '') + '" autocomplete="off"></td></tr>';
        });
        h += '</tbody></table></div>';
        $('#orMoveModalTitle').text('Move ' + sel.length + (sel.length === 1 ? ' bag' : ' bags') + ' to Production: ' + matName(key));
        $('#orMoveModalBody').html(h);
        $('#orMoveConfirmBtn').prop('disabled', false);
        var el = document.getElementById('orMoveModal');
        if (el && typeof bootstrap !== 'undefined') { bootstrap.Modal.getOrCreateInstance(el).show(); }
    }

    function confirmMove() {
        if (state.moving) { return; }
        var key = state.moveMat;
        var sel = selectedBags(key);
        var jobs = [];
        var bad = false;
        sel.forEach(function (b) {
            var $in = $('.or-move-weight').filter(function () { return $(this).attr('data-id') === String(b.id); });
            var w = _common.parseKg($in.val());
            if (w == null || !isFinite(w) || w < 0) { bad = true; $in.addClass('is-invalid'); return; }
            $in.removeClass('is-invalid');
            jobs.push({ bag: b, weight: w });
        });
        if (bad) { notify('warning', 'Enter the weight before production for every bag (0 or more).'); return; }
        if (!jobs.length) { return; }
        state.moving = true;
        $('#orMoveConfirmBtn').prop('disabled', true);

        var failures = [];
        var drops = 0;
        var chain = Promise.resolve();
        jobs.forEach(function (j) {
            chain = chain.then(function () {
                var first = Number(j.bag.quantity_kg);
                var hasFirst = j.bag.quantity_kg != null && j.bag.quantity_kg !== '' && isFinite(first);
                return safe(dataFunctions.releaseSupplierIntakeToProductionWithWeights(j.bag.id, {
                    weight_before_production_kg: j.weight,
                    first_weight_kg: hasFirst ? first : null,
                    batch_number: j.bag.batch_number || null
                })).then(function (result) {
                    var resolved = result && (result.data !== undefined ? result.data : result);
                    if (resolved && resolved.success !== false && !resolved.error) {
                        delete state.selected[String(j.bag.id)];
                        if (hasFirst && first - j.weight > 50) { drops++; }
                    } else {
                        failures.push((j.bag.batch_number || j.bag.id) + ': ' + errText(resolved, 'could not be moved'));
                    }
                });
            });
        });
        chain.then(function () {
            state.moving = false;
            var el = document.getElementById('orMoveModal');
            if (el && typeof bootstrap !== 'undefined') {
                var inst = bootstrap.Modal.getInstance(el);
                if (inst) { inst.hide(); }
            }
            var done = jobs.length - failures.length;
            if (typeof Swal !== 'undefined') {
                if (failures.length) {
                    Swal.fire({
                        icon: 'warning',
                        title: done + ' of ' + jobs.length + ' bags moved',
                        html: '<div class="text-start small">These bags were not moved:<ul class="mb-0">' +
                            failures.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul></div>'
                    });
                } else if (drops) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Moved to Production',
                        text: done + (done === 1 ? ' bag' : ' bags') + ' moved. ' + drops + (drops === 1 ? ' bag weighed' : ' bags weighed') +
                            ' more than 50 kg below the weight received, so a warning was added to the dashboard.'
                    });
                } else {
                    Swal.fire({ icon: 'success', text: done + (done === 1 ? ' bag' : ' bags') + ' moved to Production.', timer: 2200, showConfirmButton: false });
                }
            }
            loadStock(true);
        });
    }

    // ------------------------------------------------------------------
    // Weekly overview
    // ------------------------------------------------------------------

    function loadWeekly() {
        $('#orPane_weekly').html('<div class="text-muted p-3">Loading…</div>');
        var wanted = state.weeklyMat;
        return safe(dataFunctions.getOilRawWeekly(8, wanted)).then(function (r) {
            if (state.weeklyMat !== wanted) { return; }
            if (isOk(r) && Array.isArray(r.weeks)) { state.weekly = r; state.weeklyError = ''; }
            else { state.weekly = null; state.weeklyError = errText(r, 'Could not load the weekly overview.'); }
            renderWeekly();
        });
    }

    function pctText(diff, expected) {
        if (expected == null || !(Math.abs(Number(expected)) > 0)) { return null; }
        return diff / Number(expected) * 100;
    }

    function countRowHtml(c, key) {
        var counted = c.counted ? num(c.counted[key]) : null;
        var expected = c.expected ? num(c.expected[key]) : null;
        var diff = (counted != null && expected != null) ? counted - expected : null;
        var pct = diff != null ? pctText(diff, expected) : null;
        var warn = pct != null && Math.abs(pct) > 2;
        return '<td>' + (expected != null ? esc(kg(expected)) : '&mdash;') + '</td>' +
            '<td>' + (counted != null ? esc(kg(counted)) : '&mdash;') + '</td>' +
            '<td class="' + (warn ? 'or-diff-warn' : '') + '">' + (diff != null ? (warn ? '<i class="fas fa-triangle-exclamation me-1" aria-hidden="true"></i>' : '') + esc((diff > 0 ? '+' : '') + kg(diff)) : '&mdash;') + '</td>' +
            '<td class="' + (warn ? 'or-diff-warn' : '') + '">' + (pct != null ? esc((pct > 0 ? '+' : '') + pct.toFixed(1) + '%') : '&mdash;') + '</td>';
    }

    function renderWeekly() {
        var $p = $('#orPane_weekly');
        var r = state.weekly;
        var key = state.weeklyMat;
        var h = '<div class="d-flex flex-wrap gap-2 align-items-center mb-3"><label for="orWeeklyMat" class="form-label mb-0 fw-semibold">Material</label>' +
            '<select class="form-select or-select-auto" id="orWeeklyMat">' +
            MATS.map(function (m) { return '<option value="' + esc(m.key) + '"' + (m.key === key ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') +
            '</select></div>';
        if (!r) {
            $p.html(h + '<div class="alert alert-warning">' + esc(state.weeklyError || 'Not available.') + '</div>');
            return;
        }
        h += '<p class="small text-muted">Should have = stock in less stock moved to production. The physical count is once a month, at month end; it becomes the new starting point.</p>';
        h += '<div class="card mb-3"><div class="card-body p-0"><div class="table-responsive"><table class="table align-middle mb-0 or-num-table"><thead><tr>' +
            '<th>Week</th><th class="text-end">Start of week (kg)</th><th class="text-end">+ Received (kg)</th><th class="text-end">&minus; Moved to production (kg)</th>' +
            '<th class="text-end">Should have (kg)</th><th>Stock level</th></tr></thead><tbody>';
        if (!r.weeks.length) { h += '<tr><td colspan="6" class="text-muted">No weeks to show yet.</td></tr>'; }
        r.weeks.forEach(function (w) {
            var m = (w.materials && w.materials[key]) || {};
            var wk = num(m.weeks);
            h += '<tr><td class="text-nowrap">' + esc(fmtDayMonth(w.week_start) + ' – ' + fmtDayMonth(w.week_end)) +
                (w.from_count ? '<div class="small text-muted">from the count on ' + esc(fmtDate(r.count_date)) + '</div>' : '') + '</td>' +
                '<td class="text-end">' + esc(kg(m.start_kg)) + '</td><td class="text-end">' + esc(kg(m.received_kg)) + '</td>' +
                '<td class="text-end">' + esc(kg(m.used_kg)) + '</td><td class="text-end fw-bold">' + esc(kg(m.end_kg)) + '</td>' +
                '<td>' + (LEVELS[m.level] ? levelChip(m.level, LEVELS[m.level].short + (wk != null ? ' · ' + wk.toFixed(1) + ' wks' : '')) : '<span class="text-muted">&mdash;</span>') + '</td></tr>';
        });
        h += '</tbody></table></div></div></div>';

        var counts = Array.isArray(r.counts) ? r.counts : [];
        h += '<div class="card"><div class="card-body p-0"><h3 class="h6 px-3 pt-3">Month-end counts: ' + esc(matName(key)) + '</h3>' +
            '<div class="table-responsive"><table class="table align-middle mb-0 or-num-table"><thead><tr><th>Date</th><th>Counted by</th>' +
            '<th>Should have (kg)</th><th>Counted (kg)</th><th>Difference (kg)</th><th>Difference (%)</th></tr></thead><tbody>';
        if (!counts.length) { h += '<tr><td colspan="6" class="text-muted">No month-end counts yet.</td></tr>'; }
        counts.forEach(function (c) {
            h += '<tr><td class="text-nowrap">' + esc(fmtDate(c.count_date)) + '</td><td>' + (c.counted_by_name ? esc(c.counted_by_name) : '&mdash;') + '</td>' +
                countRowHtml(c, key) + '</tr>';
        });
        h += '</tbody></table></div></div></div>';
        $p.html(h);
    }

    // ------------------------------------------------------------------
    // Month-end count
    // ------------------------------------------------------------------

    function loadCount() {
        $('#orPane_count').html('<div class="text-muted p-3">Loading…</div>');
        return Promise.all([loadMats(), safe(dataFunctions.getOilRawWeekly(8, null))]).then(function (res) {
            var w = res[1];
            state.counts = (isOk(w) && Array.isArray(w.counts)) ? w.counts : [];
            if (state.tab === 'count') { renderCount(); }
        });
    }

    function renderCount() {
        var $p = $('#orPane_count');
        var today = todayStr();
        var onHand = {};
        ((state.mats && state.mats.materials) || []).forEach(function (m) { onHand[m.material] = m.on_hand_kg; });
        var h = '<div class="card mb-3"><div class="card-body">' +
            '<h3 class="h6">Month-end count</h3>' +
            '<p class="small text-muted">Count each material in the store and enter it below. Simone and Josh get a My Day task near month end. ' +
            'The count becomes the new starting point for the stock levels.</p>' +
            '<div class="row g-2 align-items-end mb-3"><div class="col-sm-5 col-md-3"><label for="orCountDate" class="form-label">Counted on</label>' +
            '<input type="date" class="form-control" id="orCountDate" max="' + esc(today) + '" value="' + esc(today) + '"></div></div>' +
            '<div class="table-responsive"><table class="table align-middle mb-2 or-num-table"><thead><tr><th>Material</th>' +
            '<th class="text-end">Portal says today (kg)</th><th>Counted (kg)</th></tr></thead><tbody>';
        MATS.forEach(function (m) {
            h += '<tr><td class="fw-semibold">' + esc(m.name) + '</td><td class="text-end">' + (onHand[m.key] != null ? esc(kg(onHand[m.key])) : '&mdash;') + '</td>' +
                '<td><input type="text" inputmode="decimal" class="form-control text-end js-kg-input or-count-in" data-mat="' + esc(m.key) + '" aria-label="' +
                esc(m.name) + ' counted kg" autocomplete="off" placeholder="0.00"></td></tr>';
        });
        h += '</tbody></table></div>' +
            '<div class="mb-3"><label for="orCountNotes" class="form-label">Notes</label><input type="text" class="form-control" id="orCountNotes" maxlength="500" placeholder="Optional"></div>' +
            '<button type="button" class="btn btn-primary" id="orCountSave"><i class="fas fa-save me-1" aria-hidden="true"></i>Save month-end count</button>' +
            '</div></div>';

        var cr = state.countResult;
        if (cr) {
            h += '<div class="card mb-3 or-result"><div class="card-body"><h3 class="h6">Count saved</h3>' +
                '<div class="table-responsive"><table class="table align-middle mb-0 or-num-table"><thead><tr><th>Material</th><th class="text-end">Should have (kg)</th>' +
                '<th class="text-end">Counted (kg)</th><th class="text-end">Difference (kg)</th></tr></thead><tbody>';
            MATS.forEach(function (m) {
                var e = cr.expected ? num(cr.expected[m.key]) : null;
                var c = cr.counted ? num(cr.counted[m.key]) : null;
                var d = (e != null && c != null) ? c - e : null;
                var p = d != null ? pctText(d, e) : null;
                var warn = p != null && Math.abs(p) > 2;
                h += '<tr><td>' + esc(m.name) + '</td><td class="text-end">' + (e != null ? esc(kg(e)) : '&mdash;') + '</td>' +
                    '<td class="text-end">' + (c != null ? esc(kg(c)) : '&mdash;') + '</td>' +
                    '<td class="text-end ' + (warn ? 'or-diff-warn' : '') + '">' + (d != null ? (warn ? '<i class="fas fa-triangle-exclamation me-1" aria-hidden="true"></i>' : '') + esc((d > 0 ? '+' : '') + kg(d)) +
                    (p != null ? ' (' + esc((p > 0 ? '+' : '') + p.toFixed(1)) + '%)' : '') : '&mdash;') + '</td></tr>';
            });
            h += '</tbody></table></div></div></div>';
        }

        var counts = state.counts || [];
        h += '<div class="card"><div class="card-body p-0"><h3 class="h6 px-3 pt-3">Earlier counts</h3><div class="table-responsive">' +
            '<table class="table align-middle mb-0 or-num-table"><thead><tr><th>Date</th><th>Counted by</th><th>Material</th>' +
            '<th>Should have (kg)</th><th>Counted (kg)</th><th>Difference (kg)</th><th>Difference (%)</th></tr></thead><tbody>';
        if (!counts.length) { h += '<tr><td colspan="7" class="text-muted">No month-end counts yet.</td></tr>'; }
        counts.forEach(function (c) {
            MATS.forEach(function (m, i) {
                if (!c.counted || c.counted[m.key] == null) { return; }
                h += '<tr' + (i === 0 ? ' class="or-count-first"' : '') + '><td class="text-nowrap">' + esc(fmtDate(c.count_date)) + '</td>' +
                    '<td>' + (c.counted_by_name ? esc(c.counted_by_name) : '&mdash;') + '</td><td>' + esc(m.name) + '</td>' + countRowHtml(c, m.key) + '</tr>';
            });
        });
        h += '</tbody></table></div></div></div>';
        $p.html(h);
    }

    function saveCount() {
        var date = String($('#orCountDate').val() || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayStr()) { notify('warning', 'Enter the date of the count (today or earlier).'); return; }
        var counted = {};
        var bad = false;
        $('.or-count-in').each(function () {
            var v = _common.parseKg($(this).val());
            if (v == null || !isFinite(v) || v < 0) { bad = true; $(this).addClass('is-invalid'); return; }
            $(this).removeClass('is-invalid');
            counted[$(this).attr('data-mat')] = v;
        });
        if (bad || Object.keys(counted).length !== MATS.length) { notify('warning', 'Enter a count for every material (0 is fine).'); return; }
        $('#orCountSave').prop('disabled', true);
        safe(dataFunctions.saveOilRawCount(date, counted, String($('#orCountNotes').val() || '').trim())).then(function (r) {
            if (!isOk(r)) { notify('error', errText(r, 'Could not save the count.')); $('#orCountSave').prop('disabled', false); return; }
            state.countResult = { expected: r.expected || {}, counted: r.counted || counted };
            state.mats = null;
            loadCount();
        });
    }

    // ------------------------------------------------------------------
    // Daily recipe
    // ------------------------------------------------------------------

    function loadRecipes() {
        $('#orPane_recipe').html('<div class="text-muted p-3">Loading…</div>');
        return safe(dataFunctions.getOilDailyRecipes(30)).then(function (r) {
            if (isOk(r) && Array.isArray(r.recipes)) { state.recipes = r; state.recipesError = ''; }
            else { state.recipes = null; state.recipesError = errText(r, 'Could not load the daily recipe.'); }
            if (state.tab === 'recipe') { renderRecipes(); }
        });
    }

    function unitLabel(settings) {
        if (settings && settings.recipe_unit === 'per_bin') {
            var n = num(settings.bins_per_day);
            return 'kg per bin' + (n != null ? ' · ' + n + ' bins a day' : ' · set the bins a day below');
        }
        return 'kg per day';
    }

    function renderRecipes() {
        var $p = $('#orPane_recipe');
        var r = state.recipes;
        if (!r) { $p.html('<div class="alert alert-warning">' + esc(state.recipesError || 'Not available.') + '</div>'); return; }
        var s = r.settings || {};
        var latest = r.latest || null;
        var today = todayStr();
        var daily = (r.daily_now && r.daily_now.daily) || {};
        var perBin = s.recipe_unit === 'per_bin';

        var h = '<div class="card mb-3"><div class="card-body"><h3 class="h6">Daily recipe</h3>' +
            '<p class="small text-muted">What goes into the oil plant each day, in <strong>' + esc(unitLabel(s)) + '</strong>. ' +
            'If nothing changed from the last recipe press Recipe unchanged.' +
            (latest ? ' Last recipe: ' + esc(fmtDate(latest.recipe_date)) + '.' : '') + '</p>' +
            '<div class="row g-2 align-items-end mb-3"><div class="col-sm-5 col-md-3"><label for="orRecipeDate" class="form-label">Date</label>' +
            '<input type="date" class="form-control" id="orRecipeDate" max="' + esc(today) + '" value="' + esc(today) + '"></div></div>' +
            '<div class="table-responsive"><table class="table align-middle mb-2 or-num-table"><thead><tr><th>Material</th><th>' + esc(unitLabel(s)) + '</th>' +
            '<th class="text-end">Daily use now (kg)</th></tr></thead><tbody>';
        MATS.forEach(function (m) {
            var pre = latest && latest.materials ? num(latest.materials[m.key]) : null;
            h += '<tr><td class="fw-semibold">' + esc(m.name) + '</td>' +
                '<td><input type="text" inputmode="decimal" class="form-control text-end js-kg-input or-recipe-in" data-mat="' + esc(m.key) + '" aria-label="' + esc(m.name) +
                ' ' + esc(perBin ? 'kg per bin' : 'kg per day') + '" autocomplete="off" value="' + (pre != null ? esc(_common.formatKg(pre)) : '') + '"></td>' +
                '<td class="text-end">' + (daily[m.key] != null ? esc(kg(daily[m.key])) : '&mdash;') + '</td></tr>';
        });
        h += '</tbody></table></div>' +
            (r.daily_now && r.daily_now.source === 'settings' ? '<p class="small text-muted">Daily use now is from the old figures until the first recipe is saved.</p>' : '') +
            '<div class="d-flex flex-wrap gap-2">' +
            '<button type="button" class="btn btn-outline-secondary" id="orRecipeUnchanged"' + (latest ? '' : ' disabled') + '>Recipe unchanged</button>' +
            '<button type="button" class="btn btn-primary" id="orRecipeSave"><i class="fas fa-save me-1" aria-hidden="true"></i>Save recipe</button></div>' +
            '</div></div>';

        // History
        h += '<div class="card mb-3"><div class="card-body p-0"><h3 class="h6 px-3 pt-3">Recipe history</h3><div class="table-responsive">' +
            '<table class="table align-middle mb-0 or-num-table"><thead><tr><th>Date</th><th>Entry</th>';
        MATS.forEach(function (m) { h += '<th class="text-end">' + esc(m.name) + '</th>'; });
        h += '<th>Unit</th><th>Entered by</th></tr></thead><tbody>';
        if (!r.recipes.length) { h += '<tr><td colspan="' + (MATS.length + 4) + '" class="text-muted">No recipes saved yet.</td></tr>'; }
        r.recipes.forEach(function (x) {
            h += '<tr><td class="text-nowrap">' + esc(fmtDate(x.recipe_date)) + '</td>' +
                '<td>' + (x.unchanged ? '<span class="or-pill or-pill-muted">Unchanged</span>' : '<span class="or-pill or-pill-info">Changed</span>') + '</td>';
            MATS.forEach(function (m) {
                var v = x.materials ? num(x.materials[m.key]) : null;
                h += '<td class="text-end">' + (v != null ? esc(kg(v)) : '&mdash;') + '</td>';
            });
            h += '<td class="small text-nowrap">' + (x.unit === 'per_bin' ? 'per bin' + (num(x.bins_per_day) != null ? ' &times; ' + esc(num(x.bins_per_day)) : '') : 'per day') + '</td>' +
                '<td>' + (x.entered_by_name ? esc(x.entered_by_name) : '&mdash;') + '</td></tr>';
        });
        h += '</tbody></table></div></div></div>';

        // Settings
        var reminder = num(s.count_reminder_days);
        h += '<div class="card"><div class="card-body"><h3 class="h6">Recipe settings</h3>' +
            '<fieldset class="mb-3"><legend class="form-label fs-6">Recipe unit</legend>' +
            '<div class="form-check"><input class="form-check-input" type="radio" name="orUnit" id="orUnitDay" value="per_day"' + (perBin ? '' : ' checked') + '>' +
            '<label class="form-check-label" for="orUnitDay">kg per day</label></div>' +
            '<div class="form-check"><input class="form-check-input" type="radio" name="orUnit" id="orUnitBin" value="per_bin"' + (perBin ? ' checked' : '') + '>' +
            '<label class="form-check-label" for="orUnitBin">kg per bin</label></div></fieldset>' +
            '<div class="row g-2 mb-3"><div class="col-sm-5 col-md-3"><label for="orBins" class="form-label">Bins a day</label>' +
            '<input type="text" inputmode="decimal" class="form-control" id="orBins" value="' + (num(s.bins_per_day) != null ? esc(num(s.bins_per_day)) : '') + '"' + (perBin ? '' : ' disabled') + '></div>' +
            '<div class="col-sm-7 col-md-5"><label for="orReminderDays" class="form-label">Month-end reminder starts N working days before the last working day</label>' +
            '<input type="number" min="0" max="15" step="1" class="form-control or-narrow" id="orReminderDays" value="' + (reminder != null ? esc(reminder) : '3') + '"></div></div>' +
            '<p class="small text-muted">Who gets the tasks is set in Role Features: Tasks: oil daily recipe / Tasks: oil month-end count.</p>' +
            '<button type="button" class="btn btn-primary" id="orSettingsSave">Save settings</button></div></div>';
        $p.html(h);
    }

    function readRecipe() {
        var mats = {};
        var bad = false;
        $('.or-recipe-in').each(function () {
            var v = _common.parseKg($(this).val());
            if (v == null || !isFinite(v) || v < 0) { bad = true; $(this).addClass('is-invalid'); return; }
            $(this).removeClass('is-invalid');
            mats[$(this).attr('data-mat')] = v;
        });
        return bad || Object.keys(mats).length !== MATS.length ? null : mats;
    }

    function saveRecipe(unchanged) {
        var date = String($('#orRecipeDate').val() || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > todayStr()) { notify('warning', 'Enter the date (today or earlier).'); return; }
        var mats = null;
        if (!unchanged) {
            mats = readRecipe();
            if (!mats) { notify('warning', 'Enter an amount for every material (0 is fine).'); return; }
        }
        $('#orRecipeSave, #orRecipeUnchanged').prop('disabled', true);
        safe(dataFunctions.saveOilDailyRecipe(date, unchanged ? null : mats, !!unchanged)).then(function (r) {
            if (!isOk(r)) {
                notify('error', errText(r, 'Could not save the recipe.'));
                $('#orRecipeSave').prop('disabled', false);
                $('#orRecipeUnchanged').prop('disabled', !(state.recipes && state.recipes.latest));
                return;
            }
            state.mats = null;
            if (typeof Swal !== 'undefined') { Swal.fire({ icon: 'success', text: unchanged ? 'Recipe kept the same.' : 'Recipe saved.', timer: 1800, showConfirmButton: false }); }
            loadRecipes();
        });
    }

    function saveSettings() {
        var unit = $('input[name="orUnit"]:checked').val() === 'per_bin' ? 'per_bin' : 'per_day';
        var bins = null;
        if (unit === 'per_bin') {
            bins = Number(String($('#orBins').val() || '').replace(/[\s,]/g, ''));
            if (!isFinite(bins) || !(bins > 0)) { notify('warning', 'Enter how many bins a day (more than 0).'); return; }
        }
        var days = Number($('#orReminderDays').val());
        if (!isFinite(days) || days < 0 || days > 15 || Math.floor(days) !== days) { notify('warning', 'The reminder days must be a whole number from 0 to 15.'); return; }
        $('#orSettingsSave').prop('disabled', true);
        safe(dataFunctions.setOilRawMaterialsSettings({ recipe_unit: unit, bins_per_day: bins, count_reminder_days: days })).then(function (r) {
            if (!isOk(r)) { notify('error', errText(r, 'Could not save the settings.')); $('#orSettingsSave').prop('disabled', false); return; }
            if (typeof Swal !== 'undefined') { Swal.fire({ icon: 'success', text: 'Settings saved.', timer: 1500, showConfirmButton: false }); }
            loadRecipes();
        });
    }

    // ------------------------------------------------------------------

    function bindEvents() {
        // Namespaced on the module root, which the router replaces on each visit.
        $('#oilRawMaterialsModule')
            .off('.orMat')
            .on('click.orMat', '.or-tab', function () { showTab(String($(this).attr('data-or-tab') || 'stock')); })
            .on('change.orMat', '.or-bag-tick', function () {
                var id = String($(this).attr('data-id') || '');
                if ($(this).is(':checked')) { state.selected[id] = true; } else { delete state.selected[id]; }
                updateMoveBtn(String($(this).attr('data-mat') || ''));
            })
            .on('click.orMat', '.or-move-btn', function () { openMoveModal(String($(this).attr('data-mat') || '')); })
            .on('click.orMat', '#orMoveConfirmBtn', confirmMove)
            .on('change.orMat', '#orWeeklyMat', function () { state.weeklyMat = String($(this).val() || 'crude_kernel'); loadWeekly(); })
            .on('click.orMat', '#orCountSave', saveCount)
            .on('click.orMat', '#orRecipeSave', function () { saveRecipe(false); })
            .on('click.orMat', '#orRecipeUnchanged', function () { saveRecipe(true); })
            .on('change.orMat', 'input[name="orUnit"]', function () {
                $('#orBins').prop('disabled', $('input[name="orUnit"]:checked').val() !== 'per_bin');
            })
            .on('click.orMat', '#orSettingsSave', saveSettings);
    }

    return {
        init: function () {
            var handoff = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('oil-raw-materials') : null;
            state.mats = null;
            state.bags = null;
            state.selected = {};
            state.weekly = null;
            state.counts = null;
            state.countResult = null;
            state.recipes = null;
            state.moving = false;
            bindEvents();
            if (typeof _oilRawRecon !== 'undefined') { _oilRawRecon.init(); }
            var tab = 'stock';
            if (handoff && handoff.tab === 'recipe') { tab = 'recipe'; }
            else if (handoff && handoff.tab === 'count') { tab = 'count'; }
            showTab(tab);
        },
        refresh: function () { loadStock(true); }
    };
})();
