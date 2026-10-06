/**
 * Silo Allocation — put the bags of a released delivery into silos, open a silo to start
 * cracking, close it to log the run (volume, time, kg/hour).
 *
 * Data comes from the kernel-pipeline RPC wrappers in data-functions.js:
 *   getSiloOverview / getSiloAllocationBatches / getSiloRuns,
 *   allocateBagsToSilo / unallocateSiloBag / openSilo / closeSilo.
 * Each returns the RPC jsonb, or { success:false, error } on failure. If an RPC is missing
 * (database not migrated yet) the affected card shows an inline notice and the rest of the page
 * keeps working.
 *
 * The open-silo timers tick on one interval. There is no route-leave hook in appRouter.js, so the
 * interval stops itself as soon as the module's root element is no longer in the document, and
 * init() clears any interval left by a previous visit.
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
        batchId: null,
        timer: null
    };

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

    function todayStr() { return localDate(new Date().toISOString()); }

    function batchLabel(b) {
        var s = String(b.batch_number || '');
        if (b.grower_name) { s += ' · ' + b.grower_name; }
        return s;
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

    function setNotice(html) { $('#siloNotice').html(html || ''); }

    function notSetUpHtml() {
        return '<div class="alert alert-warning">Silo Allocation isn\'t set up on this database yet.</div>';
    }

    // ------------------------------------------------------------------
    // Loading.
    // ------------------------------------------------------------------

    function load() {
        function safe(p) {
            return p.catch(function (e) { return { success: false, error: String(e) }; });
        }
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
            render();
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
        renderSilos();
        renderRuns();
        startTicker();
    }

    function renderAllocate() {
        var $body = $('#siloAllocBody');
        var $count = $('#siloAllocCount').text('');
        if (state.batches === null) {
            $body.html('<div class="text-muted">Unavailable until Silo Allocation is set up.</div>');
            return;
        }
        if (!state.batches.length) {
            $body.html('<div class="text-muted">No released deliveries are waiting. Bags appear here after a New Delivery is released to production.</div>');
            return;
        }
        var batch = currentBatch();
        var un = unallocated(batch);
        $count.text(un.length + ' of ' + (batch.bags || []).length + ' bags not yet allocated');

        var h = '<div class="mb-3"><label for="siloBatchSel" class="form-label">Batch</label>' +
            '<select class="form-select" id="siloBatchSel">';
        state.batches.forEach(function (b) {
            h += '<option value="' + esc(b.kernel_id) + '"' +
                (String(b.kernel_id) === String(state.batchId) ? ' selected' : '') + '>' +
                esc(batchLabel(b)) + '</option>';
        });
        h += '</select></div>';

        if (un.length) {
            h += '<div class="table-responsive"><table class="table align-middle mb-2"><thead><tr>' +
                '<th class="silo-col" style="width:40px"><input type="checkbox" class="form-check-input" id="siloSelAll" aria-label="Select all"></th>' +
                '<th class="silo-col">Bag No.</th><th class="silo-col text-end">Weight (kg)</th></tr></thead><tbody>';
            un.forEach(function (b) {
                h += '<tr><td><input type="checkbox" class="form-check-input silo-bag-sel" value="' + esc(b.no) +
                    '" aria-label="Bag ' + esc(b.no) + '"></td><td><strong>' + esc(b.no) +
                    '</strong></td><td class="text-end">' + esc(kg(b.weight_kg)) + '</td></tr>';
            });
            h += '</tbody></table></div>';
            h += '<div class="silo-alloc-row"><label for="siloAllocSilo" class="form-label mb-0">Into silo</label>' +
                '<select class="form-select" id="siloAllocSilo">';
            (state.overview || []).forEach(function (s) {
                var free = Number(s.capacity_kg || 0) - Number(s.filled_kg || 0);
                h += '<option value="' + esc(s.silo_number) + '">Silo ' + esc(s.silo_number) + ', ' +
                    esc(kg(free, 0)) + ' kg free</option>';
            });
            h += '</select><button type="button" class="btn btn-primary" id="siloAllocBtn">Allocate selected</button></div>';
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
    }

    function renderSilos() {
        var $grid = $('#siloGrid');
        if (state.overview === null) {
            $grid.html('<div class="text-muted">Unavailable until Silo Allocation is set up.</div>');
            return;
        }
        var h = '';
        state.overview.forEach(function (s) {
            var cap = Number(s.capacity_kg || 0), filled = Number(s.filled_kg || 0);
            var pct = cap > 0 ? Math.min(100, filled / cap * 100) : 0;
            var open = s.open_run || null;
            var pill = open ? '<span class="badge bg-success">Cracking</span>'
                : (filled > 0 ? '<span class="badge bg-secondary">Filled</span>'
                    : '<span class="badge bg-secondary">Empty</span>');
            var contents = (s.contents || []).map(function (c) {
                return esc(c.batch_number) + ((c.bags && c.bags.length) ? ' (bags ' + esc(c.bags.join(', ')) + ')' : '');
            }).join('<br>') || '&mdash;';
            h += '<div class="silo-card' + (open ? ' silo-open' : '') + '">' +
                '<div class="silo-card-head"><span>Silo ' + esc(s.silo_number) + '</span>' + pill + '</div>' +
                '<div class="silo-tank" role="img" aria-label="Silo ' + esc(s.silo_number) + ' ' + Math.round(pct) + ' percent full">' +
                '<div class="silo-level' + (pct >= 99 ? ' silo-level-full' : '') + '" style="height:' + pct.toFixed(1) + '%"></div>' +
                '<div class="silo-pct">' + Math.round(pct) + '%</div></div>' +
                '<div class="silo-meta">' + esc(kg(filled, 0)) + ' / ' + esc(kg(cap, 0)) + ' kg</div>' +
                '<div class="silo-meta">' + contents + '</div>';
            if (open) {
                h += '<div class="silo-timer" data-opened="' + esc(open.opened_at) + '">00:00:00</div>' +
                    '<button type="button" class="btn btn-primary btn-sm silo-close" data-silo="' +
                    esc(s.silo_number) + '">Silo complete</button>';
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
            $body.html('<tr><td colspan="6" class="text-muted">Unavailable until Silo Allocation is set up.</td></tr>');
            return;
        }
        var today = todayStr(), totalKg = 0, totalMin = 0, any = false;
        var h = '';
        state.runs.forEach(function (r) {
            var when = r.closed_at || r.opened_at;
            if (r.closed_at && localDate(r.closed_at) === today) {
                any = true;
                totalKg += Number(r.volume_kg) || 0;
                totalMin += Number(r.minutes) || 0;
            }
            var batches = Array.isArray(r.batch_numbers) ? r.batch_numbers.join(', ') : (r.batch_numbers || '');
            h += '<tr><td class="silo-col">' + esc(localDate(when)) + '</td><td>' + esc(r.silo_number) + '</td><td>' +
                esc(batches) + '</td><td class="text-end">' + esc(kg(r.volume_kg)) + '</td><td class="text-end">' +
                esc(fmtDuration(r.minutes)) + '</td><td class="text-end">' +
                (r.kg_per_hour == null ? '&mdash;' : esc(kg(r.kg_per_hour))) + '</td></tr>';
        });
        $body.html(h || '<tr><td colspan="6" class="text-muted">No silos have been cracked yet.</td></tr>');
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

    function allocate() {
        var batch = currentBatch();
        var nos = $('#siloAllocBody .silo-bag-sel:checked').map(function () { return Number(this.value); }).get();
        var $msg = $('#siloAllocMsg');
        if (!nos.length) {
            $msg.html('<div class="alert alert-warning mb-0">Tick at least one bag.</div>');
            return;
        }
        var silo = Number($('#siloAllocSilo').val());
        $('#siloAllocBtn').prop('disabled', true);
        dataFunctions.allocateBagsToSilo(batch.kernel_id, nos, silo).then(function (r) {
            if (isOk(r)) { return load(); }
            $('#siloAllocBtn').prop('disabled', false);
            $('#siloAllocMsg').html('<div class="alert alert-danger mb-0">' +
                esc(errText(r, 'Could not allocate those bags.')) + '</div>');
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

    function openSiloNow(no) {
        dataFunctions.openSilo(no).then(function (r) {
            if (!isOk(r)) { Swal.fire({ icon: 'error', text: errText(r, 'Could not open the silo.') }); }
            return load();
        });
    }

    function closeSiloNow(no) {
        Swal.fire({
            title: 'Silo ' + no + ' complete?',
            text: 'This stops the timer and logs the run.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Silo complete'
        }).then(function (c) {
            if (!c.isConfirmed) { return; }
            dataFunctions.closeSilo(no).then(function (r) {
                if (!isOk(r)) {
                    Swal.fire({ icon: 'error', text: errText(r, 'Could not close the silo.') });
                } else {
                    var line = 'Silo ' + no + ' complete: ' + kg(r.volume_kg) + ' kg in ' +
                        fmtDuration(r.minutes) + (r.kg_per_hour == null ? '' : ' = ' + kg(r.kg_per_hour) + ' kg/hour');
                    Swal.fire({ icon: 'success', text: line });
                }
                return load();
            });
        });
    }

    function bindEvents() {
        // Namespaced on the module root, which the router replaces on each visit, so handlers
        // never stack up.
        $('#siloAllocationModule')
            .off('.siloAlloc')
            .on('change.siloAlloc', '#siloBatchSel', function () { state.batchId = $(this).val(); renderAllocate(); })
            .on('change.siloAlloc', '#siloSelAll', function () {
                $('#siloAllocBody .silo-bag-sel').prop('checked', this.checked);
            })
            .on('click.siloAlloc', '#siloAllocBtn', allocate)
            .on('click.siloAlloc', '.silo-undo', function (e) { e.preventDefault(); undo(Number($(this).data('no'))); })
            .on('click.siloAlloc', '.silo-open-btn', function () { openSiloNow(Number($(this).data('silo'))); })
            .on('click.siloAlloc', '.silo-close', function () { closeSiloNow(Number($(this).data('silo'))); })
            .on('click.siloAlloc', '#siloRefreshBtn', function () { load(); });
    }

    return {
        init: function () {
            stopTicker();
            state.batchId = null;
            bindEvents();
            load();
        },
        destroy: stopTicker
    };
})();
