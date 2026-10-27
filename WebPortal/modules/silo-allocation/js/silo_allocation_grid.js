/**
 * Silo Allocation — put the bags of a released delivery into silos, open a silo to start
 * cracking, close it to log the run (volume, time, kg/hour).
 *
 * Data comes from the kernel-pipeline RPC wrappers in data-functions.js:
 *   getSiloOverview / getSiloAllocationBatches / getSiloRuns / getPresizerTally,
 *   allocateBagsToSilo / unallocateSiloBag / openSilo / closeSilo / updateSiloRunTimes.
 * Each returns the RPC jsonb, or { success:false, error } on failure. If an RPC is missing
 * (database not migrated yet) the affected card shows an inline notice and the rest of the page
 * keeps working.
 *
 * The open-silo timers tick on one interval. There is no route-leave hook in appRouter.js, so the
 * interval stops itself as soon as the module's root element is no longer in the document, and
 * init() clears any interval left by a previous visit.
 *
 * Times typed into the dialogs are local (South African) time. They are sent as ISO strings that
 * carry the browser's UTC offset, and only when the person actually changed them.
 *
 * Security invariant: every DB-supplied or user-supplied string is written with .text() or passed
 * through esc() before it reaches markup.
 */
var _siloAllocationGrid = (function () {
    'use strict';

    var state = {
        overview: null,   // array of silos, or null when the RPC failed
        batches: null,    // array of batches, or null when the RPC failed
        runs: null,       // array of runs, or null when the RPC failed
        tally: null,      // pre-sizer tally of the selected batch, or null when unavailable
        batchId: null,
        pickedKernel: null, // "Show a batch" on the Silos card: kernel_id, or null for all silos
        allocOpen: false,   // Allocate bags unfolded; remembered on this device
        timer: null
    };

    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // A run longer than this is almost always a stop time saved on the wrong day.
    var LONG_RUN_MINUTES = 16 * 60;
    var ALLOC_OPEN_KEY = 'mac.siloAllocation.allocOpen';

    // ------------------------------------------------------------------
    // Helpers.
    // ------------------------------------------------------------------

    function esc(v) {
        return (typeof _common !== 'undefined' && _common.escapeHtml)
            ? _common.escapeHtml(v)
            : String(v == null ? '' : v);
    }

    function kg(v, dp) {
        var n = Number(v);
        if (!isFinite(n)) { n = 0; }
        return _common.formatKg(n, dp === undefined ? 2 : dp);
    }

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function isOk(r) {
        return !!r && r.success !== false && !r.error;
    }

    function errText(r, fallback) {
        return (r && (r.error || r.message)) ? String(r.error || r.message) : fallback;
    }

    function fmtDuration(minutes) {
        var m = Math.max(0, Math.round(Number(minutes) || 0));
        return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm';
    }

    function localDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) { return ''; }
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function localTime(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) { return ''; }
        return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    function todayStr() { return localDate(new Date().toISOString()); }

    function nowTimeStr() { return localTime(new Date().toISOString()); }

    // "07 Oct 14:10"
    function fmtWhen(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) { return ''; }
        return pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    }

    // ISO string for a local date ('YYYY-MM-DD') and time ('HH:MM'), carrying the browser's UTC offset.
    function toIso(dateStr, timeStr) {
        var dp = String(dateStr || '').split('-');
        var tp = String(timeStr || '').split(':');
        if (dp.length !== 3 || tp.length < 2) { return null; }
        var y = Number(dp[0]), mo = Number(dp[1]), da = Number(dp[2]), h = Number(tp[0]), mi = Number(tp[1]);
        var d = new Date(y, mo - 1, da, h, mi, 0, 0);
        if (isNaN(d.getTime())) { return null; }
        var off = -d.getTimezoneOffset();
        var sign = off >= 0 ? '+' : '-';
        off = Math.abs(off);
        return dp[0] + '-' + pad2(mo) + '-' + pad2(da) + 'T' + pad2(h) + ':' + pad2(mi) + ':00' +
            sign + pad2(Math.floor(off / 60)) + ':' + pad2(off % 60);
    }

    function isoToMs(iso) {
        return iso ? new Date(iso).getTime() : NaN;
    }

    // 'YYYY-MM-DD' -> "Mon 26 Oct"
    function fmtDay(dateStr) {
        var p = String(dateStr || '').split('-');
        if (p.length !== 3) { return String(dateStr || ''); }
        var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
        if (isNaN(d.getTime())) { return String(dateStr); }
        return DAYS[d.getDay()] + ' ' + pad2(d.getDate()) + ' ' + MONTHS[d.getMonth()];
    }

    // Supplier of a batch in a silo: from the overview (migration 20261027090000), else from the
    // batch list, which has always carried grower_name.
    function supplierOf(c) {
        if (c && c.grower_name) { return String(c.grower_name); }
        var list = state.batches || [];
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].kernel_id) === String(c && c.kernel_id)) { return String(list[i].grower_name || ''); }
        }
        return '';
    }

    // Every silo holding bags of each batch: { kernel_id: { batch_number, supplier, silos: [no], kg } }.
    function batchSpread() {
        var out = {};
        (state.overview || []).forEach(function (s) {
            (s.contents || []).forEach(function (c) {
                var k = String(c.kernel_id);
                if (!out[k]) { out[k] = { kernel_id: k, batch_number: c.batch_number, supplier: supplierOf(c), silos: [], kg: 0 }; }
                if (out[k].silos.indexOf(Number(s.silo_number)) === -1) { out[k].silos.push(Number(s.silo_number)); }
                out[k].kg += Number(c.kg) || 0;
            });
        });
        Object.keys(out).forEach(function (k) { out[k].silos.sort(function (a, b) { return a - b; }); });
        return out;
    }

    function readAllocOpen() {
        try { return window.localStorage.getItem(ALLOC_OPEN_KEY) === '1'; } catch (e) { return false; }
    }

    function writeAllocOpen(open) {
        try { window.localStorage.setItem(ALLOC_OPEN_KEY, open ? '1' : '0'); } catch (e) { /* private mode: not remembered */ }
    }

    // [1,2,3,5] -> "1–3, 5"
    function bagRanges(nos) {
        var a = (nos || []).map(Number).filter(function (n) { return isFinite(n); })
            .sort(function (x, y) { return x - y; });
        var out = [], i = 0;
        while (i < a.length) {
            var j = i;
            while (j + 1 < a.length && a[j + 1] === a[j] + 1) { j++; }
            out.push(j > i ? a[i] + '–' + a[j] : String(a[i]));
            i = j + 1;
        }
        return out.join(', ');
    }

    function batchLabel(b) {
        var s = String(b.batch_number || '');
        if (b.grower_name) { s += ' · ' + b.grower_name; }
        return s;
    }

    function batchHint(b) {
        var parts = [];
        var w = Number(b.waiting_count), s = Number(b.in_silo_count);
        if (w > 0) { parts.push(w + ' waiting'); }
        if (s > 0) { parts.push(s + ' in silo'); }
        return parts.join(' · ');
    }

    function unallocated(b) {
        return (b.bags || []).filter(function (x) { return x.silo_number == null; });
    }

    function currentBatch() {
        var list = state.batches || [];
        for (var i = 0; i < list.length; i++) {
            if (String(list[i].kernel_id) === String(state.batchId)) { return list[i]; }
        }
        return null;
    }

    function siloByNumber(no) {
        return (state.overview || []).filter(function (s) { return Number(s.silo_number) === Number(no); })[0] || null;
    }

    // Fill tier: >=80% high (green), 40-79% mid (orange), >0 and <40% low (red), 0 empty (grey).
    // Pill wording follows the same bands as the fill colour.
    var SILO_TIER_LABEL = { high: 'Full', mid: 'Part full', low: 'Low', empty: 'Empty' };

    function siloTier(filled, cap) {
        if (!(filled > 0)) { return 'empty'; }
        var pct = cap > 0 ? filled / cap * 100 : 0;
        if (pct >= 80) { return 'high'; }
        if (pct >= 40) { return 'mid'; }
        return 'low';
    }

    function setNotice(html) { $('#siloNotice').html(html || ''); }

    function notSetUpHtml() {
        return '<div class="alert alert-warning">Silo Allocation isn\'t set up on this database yet.</div>';
    }

    // ------------------------------------------------------------------
    // Loading.
    // ------------------------------------------------------------------

    function safe(p) {
        return p.catch(function (e) { return { success: false, error: String(e) }; });
    }

    function load() {
        return Promise.all([
            safe(dataFunctions.getSiloOverview()),
            safe(dataFunctions.getSiloAllocationBatches()),
            safe(dataFunctions.getSiloRuns(50))
        ]).then(function (res) {
            state.overview = (isOk(res[0]) && Array.isArray(res[0].silos)) ? res[0].silos : null;
            state.batches = (isOk(res[1]) && Array.isArray(res[1].batches)) ? res[1].batches : null;
            state.runs = (isOk(res[2]) && Array.isArray(res[2].runs)) ? res[2].runs : null;
            if (state.overview === null || state.batches === null || state.runs === null) {
                setNotice(notSetUpHtml());
            } else {
                setNotice('');
            }
            pickBatch();
            return loadTally();
        }).then(render);
    }

    function loadTally() {
        var batch = currentBatch();
        if (!batch) { state.tally = null; return Promise.resolve(); }
        var wanted = batch.kernel_id;
        return safe(dataFunctions.getPresizerTally(wanted)).then(function (r) {
            // Ignore a late answer for a batch that is no longer selected.
            if (String(state.batchId) !== String(wanted)) { return; }
            state.tally = (isOk(r) && Array.isArray(r.groups)) ? r : null;
        });
    }

    // Keep the chosen batch if it is still listed; otherwise the first batch with bags to allocate.
    function pickBatch() {
        var list = state.batches || [];
        if (currentBatch()) { return; }
        state.batchId = null;
        for (var i = 0; i < list.length; i++) {
            if (unallocated(list[i]).length) { state.batchId = list[i].kernel_id; return; }
        }
        if (list.length) { state.batchId = list[0].kernel_id; }
    }

    // ------------------------------------------------------------------
    // Rendering.
    // ------------------------------------------------------------------

    function render() {
        renderAllocate();
        renderTally();
        renderSilos();
        renderRuns();
        startTicker();
    }

    // Folded: Allocate bags shows only its one-line summary, and the pre-sizer tally (part of
    // allocating) folds away with it.
    function applyAllocOpen() {
        var open = !!state.allocOpen;
        $('.silo-alloc-card').toggleClass('is-open', open);
        $('#siloAllocToggle').attr('aria-expanded', open ? 'true' : 'false');
        $('#siloAllocToggleLabel').text(open ? 'Hide' : 'Show');
        $('#siloAllocBody').toggleClass('d-none', !open);
        renderTally();
    }

    // Silo choices for the selected batch: empty or already holding THIS batch are selectable,
    // silos holding another batch are listed but disabled. Selectable ones come first.
    function siloOptions(batch) {
        var opts = (state.overview || []).map(function (s) {
            var cap = Number(s.capacity_kg || 0), filled = Number(s.filled_kg || 0);
            var free = Math.max(0, cap - filled);
            // A silo may be filled past capacity (migration 20261027120000): say how far over.
            var room = (cap > 0 && filled > cap) ? 'full, ' + kg(filled - cap, 0) + ' kg over' : kg(free, 0) + ' kg free';
            var contents = s.contents || [];
            var mine = contents.filter(function (c) { return String(c.kernel_id) === String(batch.kernel_id); })[0];
            var other = contents.filter(function (c) { return String(c.kernel_id) !== String(batch.kernel_id); })[0];
            var label, ok = true;
            if (other) {
                ok = false;
                label = 'Silo ' + s.silo_number + ' · holds ' + other.batch_number + ' — other batch, can’t mix';
            } else if (mine) {
                label = 'Silo ' + s.silo_number + ' · already holds ' + mine.batch_number + ' · ' + room;
            } else {
                label = 'Silo ' + s.silo_number + ' · empty · ' + kg(free, 0) + ' kg free';
            }
            return { no: s.silo_number, label: label, ok: ok, free: free };
        });
        // Array.prototype.sort is stable in current browsers; selectable first, then by silo number.
        opts.sort(function (a, b) {
            if (a.ok !== b.ok) { return a.ok ? -1 : 1; }
            return Number(a.no) - Number(b.no);
        });
        return opts;
    }

    function renderAllocate() {
        var $body = $('#siloAllocBody');
        var $count = $('#siloAllocCount').text('');
        if (state.batches === null) {
            $body.html('<div class="text-muted">Unavailable until Silo Allocation is set up.</div>');
            return;
        }
        if (!state.batches.length) {
            $count.text('No bags waiting to allocate');
            $body.html('<div class="text-muted">No released deliveries are waiting. Bags appear here after a New Delivery is released to production.</div>');
            return;
        }
        var batch = currentBatch();
        var un = unallocated(batch);
        $count.text(batchLabel(batch) + ' — ' + (un.length
            ? un.length + ' of ' + (batch.bags || []).length + ' bags still to allocate'
            : 'all bags allocated'));

        var h = '<div class="mb-3"><label for="siloBatchSel" class="form-label">Batch</label>' +
            '<select class="form-select" id="siloBatchSel">';
        state.batches.forEach(function (b) {
            var hint = batchHint(b);
            h += '<option value="' + esc(b.kernel_id) + '"' +
                (String(b.kernel_id) === String(state.batchId) ? ' selected' : '') + '>' +
                esc(batchLabel(b) + (hint ? ' — ' + hint : '')) + '</option>';
        });
        h += '</select></div>';

        var where = batchSpread()[String(batch.kernel_id)];
        if (where && where.silos.length) {
            h += '<div class="silo-where-strip mb-3"><span class="small fw-semibold">This batch is already in</span>';
            where.silos.forEach(function (no) { h += '<span class="silo-where-chip">Silo ' + esc(no) + '</span>'; });
            h += '<span class="small text-muted">· ' + esc(kg(where.kg, 0)) + ' kg</span></div>';
        }

        if (un.length) {
            h += '<div class="table-responsive"><table class="table align-middle mb-2"><thead><tr>' +
                '<th class="silo-col" style="width:40px"><input type="checkbox" class="form-check-input" id="siloSelAll" aria-label="Select all"></th>' +
                '<th class="silo-col">Bag No.</th><th class="silo-col text-end">Weight (kg)</th></tr></thead><tbody>';
            un.forEach(function (b) {
                h += '<tr><td><input type="checkbox" class="form-check-input silo-bag-sel" value="' + esc(b.no) +
                    '" data-kg="' + esc(Number(b.weight_kg) || 0) + '" aria-label="Bag ' + esc(b.no) +
                    '"></td><td><strong>' + esc(b.no) +
                    '</strong></td><td class="text-end">' + esc(kg(b.weight_kg)) + '</td></tr>';
            });
            h += '</tbody></table></div>';
            var opts = siloOptions(batch);
            var firstOk = opts.filter(function (o) { return o.ok; })[0];
            h += '<div class="silo-alloc-row"><label for="siloAllocSilo" class="form-label mb-0">Into silo</label>' +
                '<select class="form-select" id="siloAllocSilo">';
            opts.forEach(function (o) {
                h += '<option value="' + esc(o.no) + '"' + (o.ok ? '' : ' disabled') +
                    (firstOk && firstOk.no === o.no ? ' selected' : '') + '>' + esc(o.label) + '</option>';
            });
            h += '</select><button type="button" class="btn btn-primary" id="siloAllocBtn">Allocate selected</button></div>';
            h += '<div class="small text-muted mt-2">A silo only takes one batch. Silos holding a different batch are greyed out until they are cracked empty.</div>';
            h += '<div id="siloAllocMsg" class="mt-2"></div>';
        } else {
            h += '<div class="alert alert-success mb-0">All bags allocated.</div>';
        }

        var allocated = (batch.bags || []).filter(function (b) { return b.silo_number != null; });
        if (allocated.length) {
            h += '<div class="mt-3"><div class="small text-muted mb-1">Allocated:</div><ul class="list-unstyled mb-0 small">';
            allocated.forEach(function (b) {
                // Only bags still sitting in a silo can be undone; cracked ones are history.
                var undo = (b.status === 'in_silo')
                    ? ' <a href="#" class="silo-undo ms-2" data-no="' + esc(b.no) + '">Undo</a>' : '';
                h += '<li>bag ' + esc(b.no) + ' → silo ' + esc(b.silo_number) + ' · ' +
                    esc(kg(b.weight_kg)) + ' kg' + undo + '</li>';
            });
            h += '</ul></div>';
        }
        $body.html(h);
        updateAllocBtn();
    }

    // "Allocate selected (4 bags · 98.60 kg)"
    function updateAllocBtn() {
        var $btn = $('#siloAllocBtn');
        if (!$btn.length) { return; }
        var n = 0, total = 0;
        $('#siloAllocBody .silo-bag-sel:checked').each(function () {
            n++;
            total += Number($(this).attr('data-kg')) || 0;
        });
        $btn.text(n ? 'Allocate selected (' + n + ' bag' + (n === 1 ? '' : 's') + ' · ' + kg(total) + ' kg)' : 'Allocate selected');
    }

    function renderTally() {
        var $card = $('#siloTallyCard');
        var batch = currentBatch();
        if (state.batches === null || !batch || !state.allocOpen) { $card.addClass('d-none'); return; }
        $card.removeClass('d-none');
        $('#siloTallyTitle').text('Pre-sizer tally · ' + String(batch.batch_number || ''));
        var $body = $('#siloTallyBody');
        var t = state.tally;
        if (!t) {
            $body.html('<div class="text-muted">Unavailable until Silo Allocation is set up.</div>');
            return;
        }
        var groups = t.groups || [];
        var waiting = t.waiting_bag_nos || [];
        var h = '<div class="table-responsive"><table class="table align-middle mb-0"><thead><tr>' +
            '<th class="silo-col">When</th><th class="silo-col">Silo</th><th class="silo-col">Bags</th>' +
            '<th class="silo-col text-end">Bag kg</th><th class="silo-col text-end">Removed kg</th></tr></thead><tbody>';
        groups.forEach(function (g) {
            h += '<tr><td class="silo-col">' + esc(fmtWhen(g.allocated_at)) + '</td><td class="silo-col">Silo ' +
                esc(g.silo_number) + '</td><td>' + esc(bagRanges(g.bag_nos)) + '</td><td class="text-end">' +
                esc(kg(g.bag_kg)) + '</td><td class="text-end">' + esc(kg(g.removed_kg)) + '</td></tr>';
        });
        if (!groups.length) {
            h += '<tr><td colspan="5" class="text-muted">Nothing allocated yet.</td></tr>';
        }
        if (waiting.length) {
            h += '<tr><td colspan="5" class="text-muted small">' + (waiting.length === 1 ? 'Bag ' : 'Bags ') +
                esc(bagRanges(waiting)) + ' still waiting</td></tr>';
        }
        var totalBag = Number(t.total_bag_kg) || 0, totalRem = Number(t.total_removed_kg) || 0;
        var pct = totalBag > 0 ? ' <span class="text-muted fw-normal">(' + (totalRem / totalBag * 100).toFixed(1) + '%)</span>' : '';
        h += '<tr class="fw-bold"><td colspan="3">Batch total so far</td><td class="text-end">' + esc(kg(totalBag)) +
            '</td><td class="text-end">' + esc(kg(totalRem)) + pct + '</td></tr>';
        h += '</tbody></table></div>';
        h += '<div class="small text-muted mt-2">“Release to production” no longer asks for pre-sizer. ' +
            'Once the last bag is in, this total is the batch’s removed pre-sizer figure on the job card and batch history.</div>';
        $body.html(h);
    }

    function renderSilos() {
        var $grid = $('#siloGrid');
        var $chips = $('#siloBatchChips').empty();
        var $spread = $('#siloBatchSpread').empty();
        if (state.overview === null) {
            $grid.html('<div class="text-muted">Unavailable until Silo Allocation is set up.</div>');
            return;
        }
        var spread = batchSpread();
        var keys = Object.keys(spread).sort(function (a, b) {
            return String(spread[a].batch_number).localeCompare(String(spread[b].batch_number));
        });
        if (state.pickedKernel && !spread[state.pickedKernel]) { state.pickedKernel = null; }
        var picked = state.pickedKernel;

        // "Show a batch": one chip per batch sitting in a silo, plus "All silos".
        if (keys.length) {
            var ch = '<span class="small fw-semibold text-muted">Show a batch:</span>' +
                '<button type="button" class="silo-batch-chip' + (picked ? '' : ' is-active') +
                '" data-kernel="" aria-pressed="' + (picked ? 'false' : 'true') + '">All silos</button>';
            keys.forEach(function (k) {
                var b = spread[k], on = picked === k;
                ch += '<button type="button" class="silo-batch-chip' + (on ? ' is-active' : '') + '" data-kernel="' +
                    esc(k) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
                    esc(b.batch_number + (b.supplier ? ' · ' + b.supplier : '') + ' (' + b.silos.length + ')') + '</button>';
            });
            $chips.html(ch);
        }
        if (picked) {
            var p = spread[picked];
            $spread.html('<div class="silo-batch-spread"><i class="fas fa-magnifying-glass" aria-hidden="true"></i>' +
                '<strong>' + esc(p.batch_number + (p.supplier ? ' (' + p.supplier + ')' : '')) + '</strong>' +
                '<span>is in ' + esc(p.silos.length) + ' silo' + (p.silos.length === 1 ? '' : 's') + ': <strong>' +
                esc(p.silos.join(', ')) + '</strong></span>' +
                '<span class="text-muted">· ' + esc(kg(p.kg, 0)) + ' kg still in silos</span></div>');
        }

        var h = '';
        state.overview.forEach(function (s) {
            var cap = Number(s.capacity_kg || 0), filled = Number(s.filled_kg || 0);
            // pct is the real fill and can pass 100% (overfilled silo); the tank drawing stops at the top.
            var pct = cap > 0 ? filled / cap * 100 : 0;
            var tier = siloTier(filled, cap);
            var open = s.open_run || null;
            var pill = open ? '<span class="badge bg-success">Cracking</span>'
                : '<span class="silo-pill">' + SILO_TIER_LABEL[tier] + '</span>';
            var mine = false;
            var contents = (s.contents || []).map(function (c) {
                var k = String(c.kernel_id), others = spread[k] ? spread[k].silos.length - 1 : 0;
                var supplier = supplierOf(c);
                if (picked === k) { mine = true; }
                return '<button type="button" class="silo-batch-btn" data-kernel="' + esc(k) + '">' +
                    (supplier ? '<span class="silo-supplier">' + esc(supplier) + '</span>' : '') +
                    '<span class="silo-meta">' + esc(c.batch_number) +
                    ((c.bags && c.bags.length) ? ' (bags ' + esc(c.bags.join(', ')) + ')' : '') + '</span>' +
                    '<span class="silo-spread">' + (others > 0
                        ? 'Also in ' + esc(others) + ' other silo' + (others === 1 ? '' : 's')
                        : 'Only in this silo') + '</span></button>';
            }).join('') || '<div class="silo-meta">&mdash;</div>';
            var focus = picked ? (mine ? ' is-picked' : ' is-dimmed') : '';
            h += '<div class="silo-card silo-tier-' + tier + (open ? ' silo-open' : '') + focus + '">' +
                '<div class="silo-card-head"><span>Silo ' + esc(s.silo_number) + '</span>' + pill + '</div>' +
                '<div class="silo-tank" role="img" aria-label="Silo ' + esc(s.silo_number) + ' ' + Math.round(pct) + ' percent full">' +
                '<div class="silo-level" style="height:' + Math.min(100, pct).toFixed(1) + '%"></div>' +
                '<div class="silo-pct">' + Math.round(pct) + '%</div></div>' +
                '<div class="silo-meta">' + esc(kg(filled, 0)) + ' / ' + esc(kg(cap, 0)) + ' kg</div>' +
                '<div>' + contents + '</div>';
            if (open) {
                h += '<div class="silo-timer" data-opened="' + esc(open.opened_at) + '">00:00:00</div>' +
                    '<button type="button" class="btn btn-primary btn-sm silo-close" data-silo="' +
                    esc(s.silo_number) + '">Stop cracking ■</button>';
            } else if (filled > 0) {
                h += '<button type="button" class="btn btn-outline-secondary btn-sm silo-open-btn" data-silo="' +
                    esc(s.silo_number) + '">Open silo ▶</button>';
            }
            h += '</div>';
        });
        $grid.html(h || '<div class="text-muted">No silos configured.</div>');
    }

    function renderRuns() {
        var $body = $('#siloRunsBody');
        var $sum = $('#siloTodaySummary').text('');
        if (state.runs === null) {
            $body.html('<tr><td colspan="9" class="text-muted">Unavailable until Silo Allocation is set up.</td></tr>');
            return;
        }
        var today = todayStr(), totalKg = 0, totalMin = 0, any = false;
        // grower_names comes with migration 20261027090000; until then, match on batch number.
        var growerByBatch = {};
        (state.batches || []).forEach(function (b) { if (b.grower_name) { growerByBatch[String(b.batch_number)] = String(b.grower_name); } });
        (state.overview || []).forEach(function (s) {
            (s.contents || []).forEach(function (c) { var g = supplierOf(c); if (g) { growerByBatch[String(c.batch_number)] = g; } });
        });
        var h = '';
        state.runs.forEach(function (r) {
            var when = r.closed_at || r.opened_at;
            if (r.closed_at && localDate(r.closed_at) === today) {
                any = true;
                totalKg += Number(r.volume_kg) || 0;
                totalMin += Number(r.minutes) || 0;
            }
            var batches = Array.isArray(r.batch_numbers) ? r.batch_numbers.join(', ') : (r.batch_numbers || '');
            var growers = r.grower_names;
            if (growers == null) {
                growers = String(batches).split(',').map(function (x) { return growerByBatch[x.trim()] || ''; })
                    .filter(function (g, i, a) { return g && a.indexOf(g) === i; }).join(', ');
            }
            var edited = r.times_edited ? ' <span class="silo-edited-pill">time changed</span>' : '';
            var long = Number(r.minutes) > LONG_RUN_MINUTES;
            var check = long ? ' <span class="silo-check-pill">Check times</span>' : '';
            h += '<tr' + (long ? ' class="silo-run-long"' : '') + '><td class="silo-col">' + esc(localDate(when)) + '</td><td>' +
                esc(r.silo_number) + '</td><td>' + esc(batches) + '</td><td>' + (growers ? esc(growers) : '&mdash;') +
                '</td><td class="text-end">' + esc(kg(r.volume_kg)) + '</td><td class="text-end">' +
                (r.left_kg == null || Number(r.left_kg) === 0 ? 'Empty' : esc(kg(r.left_kg))) + '</td><td class="text-end silo-col">' +
                esc(localTime(r.opened_at)) + '–' + esc(localTime(r.closed_at)) + ' <span class="' + (long ? 'fw-bold' : 'text-muted small') + '">(' +
                esc(fmtDuration(r.minutes)) + ')</span>' + check + edited + '</td><td class="text-end">' +
                (r.kg_per_hour == null ? '&mdash;' : esc(kg(r.kg_per_hour))) + '</td><td class="silo-col">' +
                '<a href="#" class="silo-edit-times" data-run="' + esc(r.id) + '">Edit times</a></td></tr>';
        });
        $body.html(h || '<tr><td colspan="9" class="text-muted">No silos have been cracked yet.</td></tr>');
        if (any) {
            var avg = totalMin > 0 ? totalKg / (totalMin / 60) : null;
            $sum.text('Today: ' + kg(totalKg) + ' kg cracked' + (avg == null ? '' : ' · average ' + kg(avg) + ' kg/hour'));
        } else {
            $sum.text('Today: nothing cracked yet');
        }
    }

    // ------------------------------------------------------------------
    // Timers.
    // ------------------------------------------------------------------

    function stopTicker() {
        if (state.timer) { clearInterval(state.timer); state.timer = null; }
    }

    function tick() {
        // The router replaces the module markup on navigation; once ours is gone, stop.
        if (!document.getElementById('siloAllocationModule')) { stopTicker(); return; }
        var now = Date.now();
        $('#siloGrid .silo-timer').each(function () {
            var t = new Date($(this).attr('data-opened')).getTime();
            if (isNaN(t)) { return; }
            var s = Math.max(0, Math.floor((now - t) / 1000));
            $(this).text(pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60));
        });
    }

    function startTicker() {
        stopTicker();
        if (!$('#siloGrid .silo-timer').length) { return; }
        tick();
        state.timer = setInterval(tick, 1000);
    }

    // ------------------------------------------------------------------
    // Actions.
    // ------------------------------------------------------------------

    // Clicking "Allocate selected" first asks how many kg were taken out at the pre-sizer for these bags.
    function allocate() {
        var batch = currentBatch();
        var nos = $('#siloAllocBody .silo-bag-sel:checked').map(function () { return Number(this.value); }).get();
        var $msg = $('#siloAllocMsg');
        if (!nos.length) {
            $msg.html('<div class="alert alert-warning mb-0">Tick at least one bag.</div>');
            return;
        }
        var silo = Number($('#siloAllocSilo').val());
        if (!isFinite(silo)) {
            $msg.html('<div class="alert alert-warning mb-0">No silo is available for this batch.</div>');
            return;
        }
        var totalKg = 0;
        (batch.bags || []).forEach(function (b) {
            if (nos.indexOf(Number(b.no)) !== -1) { totalKg += Number(b.weight_kg) || 0; }
        });
        $msg.html('');

        var $in;
        Swal.fire({
            title: 'Removed pre-sizer',
            html: '<p class="text-start mb-3">You put <strong>' + esc(nos.length + ' bag' + (nos.length === 1 ? '' : 's') +
                ' (' + kg(totalKg) + ' kg)') + '</strong> of ' + esc(batch.batch_number) + ' into <strong>Silo ' + esc(silo) +
                '</strong>. How many kg were taken out at the pre-sizer for these bags?</p>' +
                '<div class="text-start"><label for="siloPresizerKg" class="form-label fw-semibold">Removed pre-sizer (kg)</label>' +
                '<input type="number" id="siloPresizerKg" class="form-control" min="0" step="0.01" style="max-width:180px">' +
                '<div class="form-text">Enter 0 if none.</div></div>' +
                '<div class="silo-summary-strip mt-3"><span>Going into Silo ' + esc(silo) + '</span>' +
                '<strong id="siloPresizerInto">' + esc(kg(totalKg)) + ' kg</strong></div>',
            showCancelButton: true,
            confirmButtonText: 'Save',
            cancelButtonText: 'Back',
            focusConfirm: false,
            didOpen: function () {
                $in = $('#siloPresizerKg');
                $in.trigger('focus');
                $in.on('input', function () {
                    var v = parseFloat($in.val());
                    var into = isFinite(v) && v >= 0 ? totalKg - v : totalKg;
                    $('#siloPresizerInto').text(kg(into) + ' kg');
                });
            },
            preConfirm: function () {
                var raw = $in.val();
                var v = parseFloat(raw);
                if (raw === '' || !isFinite(v) || v < 0) {
                    Swal.showValidationMessage('Enter the kg removed at the pre-sizer. Use 0 if none.');
                    return false;
                }
                if (v > totalKg + 0.005) {
                    Swal.showValidationMessage('That is more than the selected bags weigh (' + kg(totalKg) + ' kg).');
                    return false;
                }
                return v;
            }
        }).then(function (c) {
            if (!c.isConfirmed) { return; }
            $('#siloAllocBtn').prop('disabled', true);
            return dataFunctions.allocateBagsToSilo(batch.kernel_id, nos, silo, c.value).then(function (r) {
                if (isOk(r)) { return load(); }
                $('#siloAllocBtn').prop('disabled', false);
                $('#siloAllocMsg').html('<div class="alert alert-danger mb-0">' +
                    esc(errText(r, 'Could not allocate those bags.')) + '</div>');
            });
        }).catch(function (e) {
            $('#siloAllocBtn').prop('disabled', false);
            $('#siloAllocMsg').html('<div class="alert alert-danger mb-0">' + esc(String(e)) + '</div>');
        });
    }

    function undo(no) {
        var batch = currentBatch();
        dataFunctions.unallocateSiloBag(batch.kernel_id, no).then(function (r) {
            if (!isOk(r)) {
                Swal.fire({ icon: 'error', text: errText(r, 'Could not undo that allocation.') });
            }
            return load();
        });
    }

    // Open dialog: date + "Started at" prefilled with now. The start time is only sent when changed.
    function openSiloNow(no) {
        var silo = siloByNumber(no);
        var held = silo ? Number(silo.filled_kg) || 0 : 0;
        var batches = silo ? (silo.contents || []).map(function (c) { return c.batch_number; }).join(', ') : '';
        var d0 = todayStr(), t0 = nowTimeStr();
        Swal.fire({
            title: 'Open silo ' + no,
            html: '<p class="text-start mb-3">Silo ' + esc(no) + ' holds <strong>' + esc(kg(held)) + ' kg</strong>' +
                (batches ? ' of ' + esc(batches) : '') + '.</p>' +
                '<div class="row g-3 text-start"><div class="col-6"><label for="siloOpenDate" class="form-label fw-semibold">Date</label>' +
                '<input type="date" id="siloOpenDate" class="form-control" value="' + esc(d0) + '"></div>' +
                '<div class="col-6"><label for="siloOpenTime" class="form-label fw-semibold">Started at</label>' +
                '<input type="time" id="siloOpenTime" class="form-control" value="' + esc(t0) + '"></div></div>' +
                '<div class="form-text text-start mt-2">Fills in with the time now. Change it if the silo was actually opened earlier. ' +
                '<a href="#" id="siloOpenUseNow">Use now</a></div>',
            showCancelButton: true,
            confirmButtonText: 'Open silo',
            cancelButtonText: 'Cancel',
            focusConfirm: false,
            didOpen: function () {
                $('#siloOpenUseNow').on('click', function (e) {
                    e.preventDefault();
                    $('#siloOpenDate').val(todayStr());
                    $('#siloOpenTime').val(nowTimeStr());
                });
            },
            preConfirm: function () {
                var d = $('#siloOpenDate').val(), t = $('#siloOpenTime').val();
                if (!d || !t) {
                    Swal.showValidationMessage('Enter the date and the time the silo was opened.');
                    return false;
                }
                var changed = (d !== d0 || t !== t0);
                var iso = toIso(d, t);
                if (changed && (!iso || isoToMs(iso) > Date.now() + 5 * 60000)) {
                    Swal.showValidationMessage('Times can’t be in the future.');
                    return false;
                }
                return changed ? iso : null;
            }
        }).then(function (c) {
            if (!c.isConfirmed) { return; }
            return dataFunctions.openSilo(no, c.value).then(function (r) {
                if (!isOk(r)) { Swal.fire({ icon: 'error', text: errText(r, 'Could not open the silo.') }); }
                return load();
            });
        });
    }

    // "Did it stop on the day it started?" check for the stop / edit-times dialogs. A run over
    // LONG_RUN_MINUTES is nearly always a stop time saved against the wrong day (e.g. entered the
    // next morning), so the dialog asks, offers a one-tap move to the start day, and won't save
    // until the person either moves it or says the run really was that long.
    //   cfg.box        selector of the (empty) warning container inside the dialog
    //   cfg.times()    -> { startDate, stopDate, startMs, endMs }
    //   cfg.setStopDate(dateStr), cfg.onChange()
    function longRunCheck(cfg) {
        var acceptedLong = false, movedTo = null;

        function minutes() {
            var t = cfg.times();
            return (t.endMs - t.startMs) / 60000;
        }

        function isLong() {
            var m = minutes();
            return isFinite(m) && m > LONG_RUN_MINUTES;
        }

        function refresh() {
            var $box = $(cfg.box);
            var t = cfg.times();
            if (isLong() && !acceptedLong) {
                var sameDay = t.startDate === t.stopDate;
                $box.html('<div class="silo-long-warn text-start mt-3"><div class="mb-2">' +
                    '<i class="fas fa-triangle-exclamation me-2" aria-hidden="true"></i>That is <strong>' +
                    esc(fmtDuration(minutes())) + '</strong> of cracking — longer than one shift. ' +
                    (sameDay ? 'Check the start and stop times.'
                        : 'Did it stop on <strong>' + esc(fmtDay(t.startDate)) + '</strong>, the day it started?') +
                    '</div><div class="d-flex flex-wrap gap-2">' +
                    (sameDay ? '' : '<button type="button" class="btn btn-primary silo-long-same">Yes, it stopped on ' +
                        esc(fmtDay(t.startDate)) + '</button>') +
                    '<button type="button" class="btn btn-outline-secondary silo-long-ok">No, it really ran that long</button>' +
                    '</div></div>');
            } else if (movedTo && !isLong()) {
                $box.html('<div class="silo-long-ok text-start mt-3"><i class="fas fa-check me-2" aria-hidden="true"></i>' +
                    'Stop date set to ' + esc(fmtDay(movedTo)) + '.</div>');
            } else {
                $box.empty();
            }
        }

        $(cfg.box)
            .on('click', '.silo-long-same', function () {
                movedTo = cfg.times().startDate;
                cfg.setStopDate(movedTo);
                cfg.onChange();
            })
            .on('click', '.silo-long-ok', function () {
                acceptedLong = true;
                cfg.onChange();
            });

        return {
            refresh: refresh,
            error: function () {
                return (isLong() && !acceptedLong)
                    ? 'This run would be ' + fmtDuration(minutes()) + ' long. Check the stop date, or press “No, it really ran that long”.'
                    : null;
            }
        };
    }

    // Stop cracking from a silo. Staff enter the kg still in the silo (estimated until a sensor
    // is fitted; the rest stays in the silo for the next run) or press "Silo is empty". The start
    // and stop times can be corrected; they are sent only when changed.
    function closeSiloNow(no) {
        var silo = siloByNumber(no);
        var inSilo = silo ? Number(silo.filled_kg) || 0 : 0;
        var openedIso = silo && silo.open_run ? silo.open_run.opened_at : null;
        var startD0 = openedIso ? localDate(openedIso) : todayStr();
        var startT0 = openedIso ? localTime(openedIso) : nowTimeStr();
        var stopD0 = todayStr(), stopT0 = nowTimeStr();
        var who = silo ? (silo.contents || []).map(function (c) {
            var g = supplierOf(c);
            return c.batch_number + (g ? ' · ' + g : '');
        }).join(', ') : '';
        var check;

        // Started / stopped as Date objects: the exact stored start while untouched, and "now"
        // while the stop date and time are untouched. The stop has its own date because a run is
        // often stopped on the system the morning after it actually stopped (27 Oct 2026: a run
        // started 07:10 and stopped 15:49 the same day was saved as 32 hours).
        function times() {
            var sd = $('#siloStopStartD').val(), st = $('#siloStopStart').val();
            var ed = $('#siloStopEndD').val(), en = $('#siloStopEnd').val();
            var startChanged = sd !== startD0 || st !== startT0;
            var endChanged = ed !== stopD0 || en !== stopT0;
            var startMs = (!startChanged && openedIso) ? isoToMs(openedIso) : isoToMs(toIso(sd, st));
            var endMs = !endChanged ? Date.now() : isoToMs(toIso(ed, en));
            return {
                sd: sd, st: st, ed: ed, en: en, startDate: sd, stopDate: ed,
                startChanged: startChanged, endChanged: endChanged, startMs: startMs, endMs: endMs
            };
        }

        function refreshSummary() {
            var t = times();
            if (check) { check.refresh(); }
            var raw = $('#siloStopLeft').val();
            var left = parseFloat(raw);
            var ranMs = t.endMs - t.startMs;
            var okRan = isFinite(ranMs) && ranMs > 0;
            $('#siloSumRan').text(okRan ? fmtDuration(ranMs / 60000) : '—');
            var okLeft = raw !== '' && isFinite(left) && left >= 0 && left <= inSilo + 0.005;
            var cracked = okLeft ? inSilo - left : NaN;
            $('#siloSumCracked').text(okLeft ? kg(cracked) + ' kg' : '—');
            $('#siloSumRate').text(okRan && okLeft ? kg(cracked / (ranMs / 3600000)) + ' kg/hour' : '—');
        }

        // Returns an error message, or null when the two times are acceptable.
        function timeError() {
            var t = times();
            if (!t.sd || !t.st || !t.ed || !t.en || !isFinite(t.startMs) || !isFinite(t.endMs)) {
                return 'Enter the date and time for both the start and the stop.';
            }
            if (t.endMs <= t.startMs) { return 'The stop time must be after the start time.'; }
            if (t.endMs > Date.now() + 5 * 60000) { return 'Times can’t be in the future.'; }
            return check ? check.error() : null;
        }

        function pick(left) {
            var t = times();
            return {
                left: left,
                openedAt: t.startChanged ? toIso(t.sd, t.st) : null,
                closedAt: t.endChanged ? toIso(t.ed, t.en) : null
            };
        }

        Swal.fire({
            title: 'Stop cracking silo ' + no,
            html: '<p class="text-start mb-3">Silo ' + esc(no) + (who ? ' (' + esc(who) + ')' : '') + ' held <strong>' +
                esc(kg(inSilo)) + ' kg</strong> when this run started. How many kg are still in the silo?</p>' +
                '<div class="row g-3 text-start">' +
                '<div class="col-6"><label for="siloStopStartD" class="form-label fw-semibold">Started — date</label>' +
                '<input type="date" id="siloStopStartD" class="form-control" value="' + esc(startD0) + '"></div>' +
                '<div class="col-6"><label for="siloStopStart" class="form-label fw-semibold">Started — time</label>' +
                '<input type="time" id="siloStopStart" class="form-control" value="' + esc(startT0) + '"></div>' +
                '<div class="col-6"><label for="siloStopEndD" class="form-label fw-semibold">Stopped — date</label>' +
                '<input type="date" id="siloStopEndD" class="form-control" value="' + esc(stopD0) + '"></div>' +
                '<div class="col-6"><label for="siloStopEnd" class="form-label fw-semibold">Stopped — time</label>' +
                '<input type="time" id="siloStopEnd" class="form-control" value="' + esc(stopT0) + '"></div>' +
                '<div class="col-6"><label for="siloStopLeft" class="form-label fw-semibold">Kg left in silo</label>' +
                '<input type="number" id="siloStopLeft" class="form-control" min="0" step="0.01" max="' + esc(inSilo) +
                '" placeholder="Estimate is fine"></div></div>' +
                '<div id="siloStopLong"></div>' +
                '<div class="silo-summary-grid mt-3 text-start">' +
                '<div><span>Ran for</span><strong id="siloSumRan">—</strong></div>' +
                '<div><span>Cracked</span><strong id="siloSumCracked">—</strong></div>' +
                '<div><span>Rate</span><strong id="siloSumRate">—</strong></div></div>',
            showCancelButton: true,
            showDenyButton: true,
            confirmButtonText: 'Save',
            denyButtonText: 'Silo is empty',
            cancelButtonText: 'Cancel',
            focusConfirm: false,
            didOpen: function () {
                check = longRunCheck({
                    box: '#siloStopLong',
                    times: times,
                    setStopDate: function (d) { $('#siloStopEndD').val(d); },
                    onChange: refreshSummary
                });
                $('#siloStopStartD, #siloStopStart, #siloStopEndD, #siloStopEnd, #siloStopLeft').on('input change', refreshSummary);
                refreshSummary();
                $('#siloStopLeft').trigger('focus');
            },
            preConfirm: function () {
                var raw = $('#siloStopLeft').val();
                if (raw === '') {
                    Swal.showValidationMessage('Enter the kg left in the silo, or press "Silo is empty".');
                    return false;
                }
                var n = Number(raw);
                if (!isFinite(n) || n < 0) { Swal.showValidationMessage('Enter 0 or more.'); return false; }
                if (n > inSilo + 0.005) {
                    Swal.showValidationMessage('That is more than the silo held (' + kg(inSilo) + ' kg).');
                    return false;
                }
                var te = timeError();
                if (te) { Swal.showValidationMessage(te); return false; }
                return pick(n);
            },
            preDeny: function () {
                var te = timeError();
                if (te) { Swal.showValidationMessage(te); return false; }
                return pick(0);
            }
        }).then(function (c) {
            if (!(c.isConfirmed || c.isDenied) || !c.value) { return; }
            var p = c.value;
            dataFunctions.closeSilo(no, p.left, p.openedAt, p.closedAt).then(function (r) {
                if (!isOk(r)) {
                    Swal.fire({ icon: 'error', text: errText(r, 'Could not stop the silo.') });
                } else {
                    var rate = r.kg_per_hour == null ? '' : ' = ' + kg(r.kg_per_hour) + ' kg/hour';
                    var line = r.emptied
                        ? 'Silo ' + no + ' empty: ' + kg(r.volume_kg) + ' kg cracked in ' + fmtDuration(r.minutes) + rate + '.'
                        : 'Silo ' + no + ' stopped: ' + kg(r.volume_kg) + ' kg cracked in ' + fmtDuration(r.minutes) + rate +
                          '. ' + kg(r.left_kg) + ' kg left in the silo.';
                    Swal.fire({ icon: 'success', text: line });
                }
                return load();
            });
        });
    }

    // Correct the start / stop time of a finished run.
    function editTimes(runId) {
        var run = (state.runs || []).filter(function (r) { return String(r.id) === String(runId); })[0];
        if (!run) { return; }
        var check;
        function times() {
            var sd = $('#siloEtStartD').val(), ed = $('#siloEtStopD').val();
            return {
                startDate: sd, stopDate: ed,
                startMs: isoToMs(toIso(sd, $('#siloEtStartT').val())),
                endMs: isoToMs(toIso(ed, $('#siloEtStopT').val()))
            };
        }
        function refresh() {
            var t = times(), ms = t.endMs - t.startMs;
            $('#siloEtRan').text(isFinite(ms) && ms > 0 ? fmtDuration(ms / 60000) : '—');
            if (check) { check.refresh(); }
        }
        Swal.fire({
            title: 'Edit times · Silo ' + run.silo_number,
            html: '<div class="row g-3 text-start">' +
                '<div class="col-6"><label for="siloEtStartD" class="form-label fw-semibold">Started — date</label>' +
                '<input type="date" id="siloEtStartD" class="form-control" value="' + esc(localDate(run.opened_at)) + '"></div>' +
                '<div class="col-6"><label for="siloEtStartT" class="form-label fw-semibold">Started — time</label>' +
                '<input type="time" id="siloEtStartT" class="form-control" value="' + esc(localTime(run.opened_at)) + '"></div>' +
                '<div class="col-6"><label for="siloEtStopD" class="form-label fw-semibold">Stopped — date</label>' +
                '<input type="date" id="siloEtStopD" class="form-control" value="' + esc(localDate(run.closed_at)) + '"></div>' +
                '<div class="col-6"><label for="siloEtStopT" class="form-label fw-semibold">Stopped — time</label>' +
                '<input type="time" id="siloEtStopT" class="form-control" value="' + esc(localTime(run.closed_at)) + '"></div></div>' +
                '<div id="siloEtLong"></div>' +
                '<div class="silo-summary-strip mt-3"><span>Ran for</span><strong id="siloEtRan">—</strong></div>',
            showCancelButton: true,
            confirmButtonText: 'Save',
            cancelButtonText: 'Cancel',
            focusConfirm: false,
            didOpen: function () {
                check = longRunCheck({
                    box: '#siloEtLong',
                    times: times,
                    setStopDate: function (d) { $('#siloEtStopD').val(d); },
                    onChange: refresh
                });
                $('#siloEtStartD, #siloEtStartT, #siloEtStopD, #siloEtStopT').on('input change', refresh);
                refresh();
            },
            preConfirm: function () {
                var s = toIso($('#siloEtStartD').val(), $('#siloEtStartT').val());
                var e = toIso($('#siloEtStopD').val(), $('#siloEtStopT').val());
                if (!s || !e) { Swal.showValidationMessage('Enter both the start and the stop time.'); return false; }
                if (isoToMs(e) <= isoToMs(s)) {
                    Swal.showValidationMessage('The stop time must be after the start time.');
                    return false;
                }
                if (isoToMs(e) > Date.now() + 5 * 60000 || isoToMs(s) > Date.now() + 5 * 60000) {
                    Swal.showValidationMessage('Times can’t be in the future.');
                    return false;
                }
                var le = check ? check.error() : null;
                if (le) { Swal.showValidationMessage(le); return false; }
                return { s: s, e: e };
            }
        }).then(function (c) {
            if (!c.isConfirmed) { return; }
            return dataFunctions.updateSiloRunTimes(run.id, c.value.s, c.value.e).then(function (r) {
                if (!isOk(r)) { Swal.fire({ icon: 'error', text: errText(r, 'Could not save the times.') }); }
                return load();
            });
        });
    }

    function bindEvents() {
        // Namespaced on the module root, which the router replaces on each visit, so handlers
        // never stack up.
        $('#siloAllocationModule')
            .off('.siloAlloc')
            .on('change.siloAlloc', '#siloBatchSel', function () {
                state.batchId = $(this).val();
                state.tally = null;
                renderAllocate();
                renderTally();
                loadTally().then(renderTally);
            })
            .on('change.siloAlloc', '#siloSelAll', function () {
                $('#siloAllocBody .silo-bag-sel').prop('checked', this.checked);
                updateAllocBtn();
            })
            .on('change.siloAlloc', '.silo-bag-sel', updateAllocBtn)
            .on('click.siloAlloc', '#siloAllocBtn', allocate)
            .on('click.siloAlloc', '.silo-undo', function (e) { e.preventDefault(); undo(Number($(this).data('no'))); })
            .on('click.siloAlloc', '.silo-open-btn', function () { openSiloNow(Number($(this).data('silo'))); })
            .on('click.siloAlloc', '.silo-close', function () { closeSiloNow(Number($(this).data('silo'))); })
            .on('click.siloAlloc', '.silo-edit-times', function (e) { e.preventDefault(); editTimes($(this).attr('data-run')); })
            .on('click.siloAlloc', '#siloRefreshBtn', function () { load(); })
            .on('click.siloAlloc', '#siloAllocToggle', function () {
                state.allocOpen = !state.allocOpen;
                writeAllocOpen(state.allocOpen);
                applyAllocOpen();
            })
            // A chip or a silo's batch picks that batch; picking the shown batch again shows all.
            .on('click.siloAlloc', '.silo-batch-chip, .silo-batch-btn', function () {
                var k = String($(this).attr('data-kernel') || '');
                var fromCard = $(this).hasClass('silo-batch-btn');
                state.pickedKernel = (!k || (fromCard && state.pickedKernel === k)) ? null : k;
                renderSilos();
                startTicker();
            });
    }

    // ------------------------------------------------------------------
    // Silo calendar: bags allocated and silos cracked, by day.
    // ------------------------------------------------------------------

    function initActivityCalendar() {
        if (typeof MacActivityCalendar === 'undefined') { return; }
        var fmtKg = MacActivityCalendar.formatKg;
        var runEntry = function (r, date) {
            var tags = [{ text: r.closed_at ? 'Cracked' : 'Cracking now', tone: r.closed_at ? 'green' : 'blue' }];
            if (r.volume_kg != null && Number(r.volume_kg) > 0) { tags.push({ text: fmtKg(r.volume_kg), tone: 'grey' }); }
            tags.push({ text: localTime(r.opened_at) + (r.closed_at ? '–' + localTime(r.closed_at) : ''), tone: 'grey' });
            if (r.closed_at && r.left_kg != null && Number(r.left_kg) > 0) { tags.push({ text: fmtKg(r.left_kg) + ' left', tone: 'amber' }); }
            return { date: date, title: 'Silo ' + r.silo_number, subtitle: r.batch_numbers || '', tags: tags };
        };
        MacActivityCalendar.create({
            mountId: 'siloActivityCalendarMount',
            idPrefix: 'siloActivityCalendar',
            title: 'Silo Calendar',
            icon: 'fa-calendar-check',
            intro: 'Days shaded green had silo activity. Click a day to see which bags went into which silo, and which silos were cracked, how many kg and when.',
            emptyDayText: 'No bags were allocated and no silos were cracked on this day.',
            emptyMonthText: 'No silo activity in this month.',
            loadMonth: function (fromIso, toIso) {
                return safe(dataFunctions.getSiloActivity(fromIso, toIso)).then(function (r) {
                    if (!isOk(r)) { return runsOnly(r); }
                    var entries = [];
                    (r.allocations || []).forEach(function (a) {
                        var bags = a.bag_nos || [];
                        var tags = [{ text: 'Allocated to silo ' + a.silo_number }];
                        tags.push({ text: bags.length + ' bag' + (bags.length === 1 ? '' : 's') + ' · ' + fmtKg(a.bag_kg), tone: 'grey' });
                        if (Number(a.removed_kg) > 0) { tags.push({ text: 'Pre-sizer ' + fmtKg(a.removed_kg), tone: 'amber' }); }
                        entries.push({ date: a.day, title: a.batch_number || 'Batch', subtitle: a.grower_name || '', tags: tags });
                    });
                    (r.runs || []).forEach(function (run) { entries.push(runEntry(run, run.day)); });
                    return entries;
                });
                // Database without migration 20261016090000: still show cracking runs from the log.
                function runsOnly(failed) {
                    console.warn('[Silo Allocation] get_silo_activity unavailable, showing cracking runs only:', errText(failed, ''));
                    return safe(dataFunctions.getSiloRuns(500)).then(function (r) {
                        if (!isOk(r)) { throw new Error(errText(r, 'Could not load silo activity.')); }
                        return (r.runs || []).map(function (run) {
                            return runEntry(run, MacActivityCalendar.dayOf(run.closed_at || run.opened_at));
                        }).filter(function (e) { return e.date >= fromIso && e.date <= toIso; });
                    });
                }
            }
        });
    }

    return {
        init: function () {
            stopTicker();
            state.batchId = null;
            state.tally = null;
            state.pickedKernel = null;
            state.allocOpen = readAllocOpen();
            bindEvents();
            applyAllocOpen();
            initActivityCalendar();
            load();
        },
        destroy: stopTicker
    };
})();
