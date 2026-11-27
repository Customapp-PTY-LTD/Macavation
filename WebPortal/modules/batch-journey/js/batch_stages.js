/**
 * Find a batch > Batch stages (Mike's MacView "Batch overview", 27 Nov 2026; migration 20261127210000).
 *
 * The stage is worked out from what was captured (get_batch_stages) — nobody moves a production
 * stage by hand. The tab shows kg + batches per stage (click a stage to filter), each batch's next
 * step and, when it is blocked, why. The two invoice stages have buttons:
 *   Request invoice   batch_stages.request_invoice  (opens a My Day task + WhatsApp nudge for admin)
 *   Mark invoiced     batch_stages.mark_invoiced
 *   Move back         batch_stages.move_back        (only the invoice stages; senior roles)
 * Buttons are gated with hasAction() at render time (rows are dynamic, so data-action-perm is inert).
 * All typed values (batch numbers, grower names, notes) go through _common.escapeHtml.
 */
var _batchStages = function () {
    var ROUTES = {
        'grower-intake-grid': 'Grower Intake',
        'silo-allocation-grid': 'Silos',
        'kernel-production-grid': 'Kernel Production'
    };
    // _kernel_stage 'where' -> route name.
    var WHERE = {
        'grower-intake-grid': 'grower-intake-grid',
        'silo-allocation': 'silo-allocation-grid',
        'kernel-production': 'kernel-production-grid'
    };
    var state = { data: null, filter: 'active', search: '', withCompleted: false, bound: false };

    function esc(v) { return _common.escapeHtml(v == null ? '' : String(v)); }
    function kg(v) { return _common.formatKg(Number(v) || 0, 0); }
    function day(iso) {
        if (!iso) return '';
        var d = new Date(String(iso).length === 10 ? iso + 'T00:00:00' : iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
    }
    function when(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        return isNaN(d.getTime()) ? '' : d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    function batchNo(b) {
        return (typeof macBatchNo !== 'undefined' && macBatchNo.format) ? macBatchNo.format(b) : String(b || '');
    }
    function can(key) { return typeof hasAction === 'function' && hasAction(key); }
    function panel() { return document.getElementById('bjStagesPanel'); }

    function stageBar(no) {
        var h = '<div class="bj-stagebar" aria-hidden="true">';
        for (var i = 1; i <= 9; i++) {
            h += '<i class="bj-stage-c' + i + (i < no ? ' past' : i === no ? ' now' : '') + '">' + i + '</i>';
        }
        return h + '</div>';
    }

    function nextCell(b) {
        var no = Number(b.stage_no);
        if (no === 9) {
            var done = b.invoice && b.invoice.legacy ? 'Completed' : 'Invoiced' + (b.invoice && b.invoice.invoice_ref ? ' · ' + esc(b.invoice.invoice_ref) : '');
            return '<span class="text-muted small">' + done + '</span>' +
                (can('batch_stages.move_back') && !(b.invoice && b.invoice.legacy)
                    ? ' <button type="button" class="btn btn-link btn-sm p-0 ms-1" data-stg-act="back" data-id="' + esc(b.kernel_id) + '">Move back</button>' : '');
        }
        if (no === 7) {
            return can('batch_stages.request_invoice')
                ? '<button type="button" class="btn btn-sm btn-primary" data-stg-act="request" data-id="' + esc(b.kernel_id) + '">Request invoice ▸</button>'
                : '<span class="text-muted small">Waiting for someone to ask for the invoice</span>';
        }
        if (no === 8) {
            var h = can('batch_stages.mark_invoiced')
                ? '<button type="button" class="btn btn-sm btn-primary" data-stg-act="invoiced" data-id="' + esc(b.kernel_id) + '">Mark invoiced ▸</button>'
                : '<span class="text-muted small">Waiting for the invoice</span>';
            if (can('batch_stages.move_back')) {
                h += ' <button type="button" class="btn btn-link btn-sm p-0 ms-1" data-stg-act="back" data-id="' + esc(b.kernel_id) + '">Move back</button>';
            }
            if (b.invoice && b.invoice.requested_at) {
                h += '<div class="bj-stage-why">Asked ' + esc(day(b.invoice.requested_at)) + (b.invoice.note ? ': ' + esc(b.invoice.note) : '') + '</div>';
            }
            return h;
        }
        var route = WHERE[b.where];
        var label = esc(b.next || '');
        var h2 = route && typeof _appRouter !== 'undefined'
            ? '<button type="button" class="btn btn-sm ' + (b.blocked ? 'btn-outline-secondary' : 'btn-outline-primary') + '" data-stg-act="go" data-route="' + esc(route) +
              '" data-batch="' + esc(b.batch_number) + '" title="' + esc('Open ' + (ROUTES[route] || '')) + '">' + label + ' ▸</button>'
            : '<span class="small">' + label + '</span>';
        if (b.blocked) h2 += '<div class="bj-stage-why"><i class="fas fa-lock me-1" aria-hidden="true"></i>' + esc(b.blocked) + '</div>';
        return h2;
    }

    function render() {
        var el = panel();
        if (!el) return;
        var d = state.data;
        if (!d) {
            el.innerHTML = '<p class="text-muted">Loading batch stages…</p>';
            return;
        }
        if (d.error) {
            el.innerHTML = '<div class="alert alert-warning mb-0">' + esc(d.error) + '</div>';
            return;
        }
        var f = state.filter;
        var pipe = '<div class="bj-pipeline" role="group" aria-label="Filter by stage">';
        (d.stages || []).forEach(function (s) {
            pipe += '<button type="button" class="bj-pstep bj-stage-c' + s.no + (String(f) === String(s.no) ? ' on' : '') +
                '" data-stg-filter="' + s.no + '" title="' + esc(s.hint) + '"><span class="pn">' + s.no + '</span><span class="pl">' + esc(s.name) +
                '</span><b>' + esc(kg(s.kg)) + ' kg</b><small>' + esc(s.count) + ' batch' + (Number(s.count) === 1 ? '' : 'es') + '</small></button>';
        });
        pipe += '</div>';

        var q = state.search.toLowerCase().trim();
        var rows = (d.batches || []).filter(function (b) {
            if (f === 'active' && Number(b.stage_no) === 9) return false;
            if (f !== 'active' && f !== 'all' && String(b.stage_no) !== String(f)) return false;
            if (!q) return true;
            return (batchNo(b.batch_number) + ' ' + (b.batch_number || '') + ' ' + (b.grower_name || '') + ' ' + (b.stage || '')).toLowerCase().indexOf(q) >= 0;
        });
        var totalKg = rows.reduce(function (a, b) { return a + (Number(b.nis_kg) || 0); }, 0);

        var body = rows.map(function (b) {
            return '<tr><td class="fw-semibold">' + esc(batchNo(b.batch_number)) + '</td><td>' + esc(b.grower_name || '') + '</td><td>' +
                esc(day(b.received_date)) + '</td><td class="text-end">' + esc(kg(b.nis_kg)) + '</td><td>' + stageBar(Number(b.stage_no)) +
                '<span class="bj-sbadge bj-stage-c' + esc(b.stage_no) + '">' + esc(b.stage) + '</span>' +
                (b.since ? '<div class="text-muted small">since ' + esc(day(b.since)) + '</div>' : '') +
                '</td><td class="bj-nextcell">' + nextCell(b) + '</td><td><button type="button" class="btn btn-link btn-sm p-0" data-stg-act="history" data-id="' +
                esc(b.kernel_id) + '" data-batch="' + esc(b.batch_number) + '">History</button></td></tr>';
        }).join('');
        if (!body) body = '<tr><td colspan="7" class="text-muted">No batches here.</td></tr>';

        el.innerHTML =
            '<p class="text-muted small mb-2">Every batch and the stage it is at, worked out from what has been captured. A batch moves on by itself once the step before it is done; when it can’t, the reason shows under its next step.</p>' +
            pipe +
            '<div class="card"><div class="card-body pb-2"><div class="d-flex flex-wrap gap-2 align-items-center">' +
            '<div class="btn-group btn-group-sm" role="group">' +
            '<button type="button" class="btn ' + (f === 'active' ? 'btn-primary' : 'btn-outline-secondary') + '" data-stg-filter="active">Not completed</button>' +
            '<button type="button" class="btn ' + (f === 'all' ? 'btn-primary' : 'btn-outline-secondary') + '" data-stg-filter="all">All batches</button></div>' +
            '<input type="search" class="form-control form-control-sm bj-stage-search" id="bjStageSearch" placeholder="Search batch, supplier, stage…" value="' + esc(state.search) + '">' +
            '<span class="text-muted small ms-auto">Showing <b>' + rows.length + '</b> · ' + esc(kg(totalKg)) + ' kg nut in shell</span>' +
            '</div></div><div class="table-responsive"><table class="table align-middle mb-0 bj-stage-table"><thead><tr>' +
            '<th>Batch</th><th>Supplier</th><th>Received</th><th class="text-end">NIS kg</th><th>Stage</th><th>Next step</th><th></th>' +
            '</tr></thead><tbody>' + body + '</tbody></table></div></div>';
    }

    async function load() {
        // Completed rows are only fetched when someone filters to them (the list grows forever).
        var need = state.filter === 'all' || state.filter === '9';
        state.withCompleted = need;
        var r = null;
        try { r = await dataFunctions.getBatchStages(need); } catch (e) { r = null; }
        state.data = r || { error: 'Could not load the batch stages. Refresh the page to try again.' };
        render();
    }

    function findBatch(id) {
        return ((state.data && state.data.batches) || []).filter(function (b) { return String(b.kernel_id) === String(id); })[0] || null;
    }

    function done(r, fallback) {
        if (!r || r.success === false) {
            Swal.fire({ icon: 'error', text: (r && (r.error || r.message)) || fallback });
            return false;
        }
        return true;
    }

    async function requestInvoice(id) {
        var b = findBatch(id);
        if (!b) return;
        var ask = await Swal.fire({
            title: 'Ask for the invoice?',
            html: '<p class="text-start mb-2">Batch <b>' + esc(batchNo(b.batch_number)) + '</b> · ' + esc(b.grower_name || '') + ' · ' +
                esc(kg(b.nis_kg)) + ' kg nut in shell.</p><p class="text-start small text-muted mb-0">The people who raise invoices get a My Day task and a WhatsApp nudge.</p>',
            input: 'text', inputLabel: 'Note (optional)', inputPlaceholder: 'e.g. supplier wants it by Friday',
            showCancelButton: true, confirmButtonText: 'Request invoice'
        });
        if (!ask.isConfirmed) return;
        var r = await dataFunctions.requestKernelInvoice(id, ask.value || null);
        if (done(r, 'Could not request the invoice.')) {
            Swal.fire({ icon: 'success', text: 'Invoice requested for ' + batchNo(b.batch_number) + '.', timer: 2200, showConfirmButton: false });
        }
        load();
    }

    async function markInvoiced(id) {
        var b = findBatch(id);
        if (!b) return;
        var ask = await Swal.fire({
            title: 'Mark ' + batchNo(b.batch_number) + ' invoiced?',
            input: 'text', inputLabel: 'Invoice number (optional)',
            showCancelButton: true, confirmButtonText: 'Mark invoiced'
        });
        if (!ask.isConfirmed) return;
        var r = await dataFunctions.markKernelInvoiced(id, ask.value || null);
        done(r, 'Could not mark it invoiced.');
        load();
    }

    async function moveBack(id) {
        var b = findBatch(id);
        if (!b) return;
        var to = Number(b.stage_no) === 9 ? 'Invoice Requested' : 'Request Invoice';
        var ask = await Swal.fire({
            icon: 'warning',
            title: 'Move ' + batchNo(b.batch_number) + ' back to ' + to + '?',
            text: 'Use this only to correct a mistake.',
            input: 'text', inputLabel: 'Why (optional)',
            showCancelButton: true, confirmButtonText: 'Move back'
        });
        if (!ask.isConfirmed) return;
        var r = await dataFunctions.moveKernelStageBack(id, ask.value || null);
        done(r, 'Could not move it back.');
        load();
    }

    async function showHistory(id, batch) {
        var r = await dataFunctions.getKernelStageHistory(id);
        if (!r || r.success === false) {
            Swal.fire({ icon: 'error', text: 'Could not load the stage history.' });
            return;
        }
        var rows = (r.history || []).map(function (h) {
            return '<tr><td class="text-nowrap">' + esc(when(h.at)) + '</td><td><span class="bj-sbadge bj-stage-c' + esc(h.stage_no) + '">' +
                esc(h.stage_no + '. ' + h.stage) + '</span></td><td>' + esc(h.by_name || '') + '</td><td class="small">' + esc(h.note || '') + '</td></tr>';
        }).join('') || '<tr><td colspan="4" class="text-muted">No history yet.</td></tr>';
        Swal.fire({
            title: 'Stage history · ' + batchNo(batch),
            width: 760,
            html: '<div class="table-responsive text-start"><table class="table table-sm mb-0"><thead><tr><th>When</th><th>Stage</th><th>By</th><th>Note</th></tr></thead><tbody>' +
                rows + '</tbody></table></div><p class="small text-muted text-start mt-2 mb-0">History starts on 27 Nov 2026, when stages were added.</p>'
        });
    }

    function bind() {
        var el = panel();
        if (!el || el.getAttribute('data-bound') === '1') return;
        el.setAttribute('data-bound', '1');
        el.addEventListener('click', function (e) {
            var fb = e.target.closest('[data-stg-filter]');
            if (fb) {
                var nf = fb.getAttribute('data-stg-filter');
                state.filter = (state.filter === nf && nf !== 'active' && nf !== 'all') ? 'active' : nf;
                if ((state.filter === 'all' || state.filter === '9') && !state.withCompleted) { load(); } else { render(); }
                return;
            }
            var btn = e.target.closest('[data-stg-act]');
            if (!btn) return;
            var act = btn.getAttribute('data-stg-act'), id = btn.getAttribute('data-id');
            if (act === 'request') requestInvoice(id);
            else if (act === 'invoiced') markInvoiced(id);
            else if (act === 'back') moveBack(id);
            else if (act === 'history') showHistory(id, btn.getAttribute('data-batch'));
            else if (act === 'go' && typeof HandoffDialog !== 'undefined' && HandoffDialog.navigateToRoute) {
                var route = btn.getAttribute('data-route');
                var input = route === 'kernel-production-grid' ? 'searchBatchesInput' : null;
                if (input) HandoffDialog.navigateToRoute(route, btn.getAttribute('data-batch') || '', input);
                else _appRouter.openWith(route, {});
            } else if (act === 'go' && typeof _appRouter !== 'undefined') {
                _appRouter.openWith(btn.getAttribute('data-route'), {});
            }
        });
        el.addEventListener('input', function (e) {
            if (e.target && e.target.id === 'bjStageSearch') {
                state.search = e.target.value || '';
                var pos = e.target.selectionStart;
                render();
                var s = document.getElementById('bjStageSearch');
                if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch (x) { /* ignore */ } }
            }
        });
    }

    return {
        /** Called by batch_journey_grid.js each time the Batch stages tab is shown. */
        show: function (opts) {
            if (opts && opts.search != null) state.search = String(opts.search);
            if (!panel()) return;
            state.data = null;
            render();
            bind();
            load();
        }
    };
}();
