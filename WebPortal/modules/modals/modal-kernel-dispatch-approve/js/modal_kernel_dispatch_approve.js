/**
 * Modal: kernel dispatch approval workflow.
 * Pick mode (Thando): confirm cartons picked, no prices. Approve mode (Pete): price per kg, transport, record the sale.
 * Everyone else gets the same layout read-only; rand figures only with kernel_prices.view.
 */
var _modal_kernel_dispatch_approve = (function () {
    'use strict';

    var KG_PER_CARTON = 11.34;
    var MODAL_ID = 'kernelDispatchApproveModal';
    var wf = null;       // last loaded workflow
    var mode = 'view';   // 'pick' | 'approve' | 'view'
    var busy = false;

    function can(key) { return typeof window.hasAction === 'function' && !!window.hasAction(key); }

    function el(tag, cls, text) {
        var $e = $('<' + tag + '>');
        if (cls) $e.addClass(cls);
        if (text != null) $e.text(String(text));
        return $e;
    }

    function fmtNum(n, dp) {
        return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
    }
    function fmtKg(n) { return fmtNum(n, 2); }
    function fmtRand(n) { return 'R ' + fmtNum(n, 2); }

    function fmtDay(v) {
        if (!v) return '';
        var d = new Date(v);
        if (isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
    }

    function fmtDate(v) {
        if (!v) return '';
        if (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) return _common.formatDateDDMMYYYY(v);
        return String(v).slice(0, 10);
    }

    function asked(line) {
        return line.requested_cartons != null ? Number(line.requested_cartons) : Number(line.cartons) || 0;
    }

    function isChanged(line) {
        return line.requested_cartons != null && Number(line.requested_cartons) !== Number(line.cartons);
    }

    function pickerLabel() {
        return (wf && wf.order && wf.order.picked_by_label) || 'The picker';
    }

    function stageOf() { return (wf.order.workflow_stage || '').toLowerCase(); }
    function isDispatched() { return String(wf.order.status || '').toLowerCase() === 'dispatched'; }

    function showPrices() {
        var st = stageOf();
        return mode === 'approve' || (can('kernel_prices.view') && (st === 'approval' || st === 'approved'));
    }

    function toast(title) {
        if (typeof Swal !== 'undefined') {
            Swal.fire({ toast: true, position: 'top-end', icon: 'success', title: title, showConfirmButton: false, timer: 2800 });
        }
    }

    function hideModal() {
        var elm = document.getElementById(MODAL_ID);
        if (elm && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
            var m = bootstrap.Modal.getInstance(elm);
            if (m) m.hide();
        }
    }

    function openModal() {
        var elm = document.getElementById(MODAL_ID);
        if (elm && typeof bootstrap !== 'undefined' && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(elm).show();
    }

    function done(title) {
        hideModal();
        toast(title);
        $(document).trigger('kernelDispatch:changed');
    }

    function fail(res, fallback) {
        if (typeof Swal !== 'undefined') Swal.fire('Could not save', (res && res.error) || fallback, 'error');
    }

    function setBusy(on) {
        busy = on;
        $('#kdaPrimaryBtn, #kdaSendBackBtn').prop('disabled', on);
    }

    // ------------------------------------------------------------------
    // Rendering.
    // ------------------------------------------------------------------

    function renderStepper() {
        var st = stageOf();
        var finished = st === 'approved' || isDispatched();
        var current = finished ? 0 : (st === 'picking' ? 2 : 3);
        var steps = [
            ['Step 1 · Pete', 'Picks batches and styles'],
            ['Step 2 · Thando', 'Picks the stock, flags changes'],
            ['Step 3 · Pete', 'Checks, prices and approves'],
            ['Step 4', 'Goes out, counted as a sale']
        ];
        var $ol = $('#kdaStepper').empty();
        steps.forEach(function (s, i) {
            var n = i + 1;
            var isDone = finished || n < current;
            var cls = 'kda-step' + (isDone ? ' kda-step-done' : (n === current ? ' kda-step-current' : ''));
            var head = (isDone ? '✓ ' : '') + s[0] + (n === current ? ' (now)' : '');
            var $li = el('li', cls);
            if (n === current) $li.attr('aria-current', 'step');
            $li.append(el('span', 'kda-step-head', head)).append(el('span', 'kda-step-text', s[1]));
            $ol.append($li);
        });
    }

    function renderFlags() {
        var changed = wf.lines.filter(isChanged);
        var note = wf.order.pick_note;
        var $flag = $('#kdaFlag').empty().addClass('d-none');
        if (changed.length || note) {
            var who = pickerLabel();
            var $txt = el('div');
            $txt.append(el('strong', 'kda-flag-title',
                changed.length ? who + ' changed ' + changed.length + (changed.length === 1 ? ' line' : ' lines') : 'Note from ' + who));
            changed.forEach(function (l) {
                $txt.append(el('span', 'kda-flag-line',
                    'Style ' + (l.style_code || l.style || '') + ' from ' + (l.batch_number || '-') + ': asked ' + asked(l) + ', picked ' + l.cartons));
            });
            if (note) $txt.append(el('span', 'kda-flag-line', 'Note: "' + note + '"'));
            $flag.append(el('i', 'fas fa-triangle-exclamation').attr('aria-hidden', 'true')).append($txt).removeClass('d-none');
        }
        var $rev = $('#kdaReview').addClass('d-none').empty();
        if (wf.order.review_note) {
            $rev.text('Sent back: ' + wf.order.review_note).removeClass('d-none');
        }
        var $ap = $('#kdaApprovedInfo').addClass('d-none').empty();
        if (stageOf() === 'approved' && wf.order.approved_at) {
            $ap.text('Approved by ' + (wf.order.approved_by_label || 'Pete') + ' on ' + fmtDay(wf.order.approved_at)).removeClass('d-none');
        }
    }

    function td(content, cls) {
        var $c = el('td', cls);
        if (content != null && content !== '') {
            if (typeof content === 'object') $c.append(content); else $c.text(String(content));
        }
        return $c;
    }

    function renderTable() {
        var prices = showPrices();
        var $t = $('#kdaTable').empty();
        var $head = el('tr');
        var cols = ['Batch', 'Style', 'Asked', 'Picked', 'Kg'];
        if (prices) cols = cols.concat(['Price per kg', 'Line value']);
        cols.forEach(function (c, i) {
            var $th = el('th', i >= 2 && c !== 'Price per kg' ? 'text-end' : '', c);
            $th.attr('scope', 'col');
            $head.append($th);
        });
        $t.append(el('thead', 'table-light').append($head));

        var $body = el('tbody');
        wf.lines.forEach(function (l, i) {
            var changed = isChanged(l);
            var $tr = el('tr', changed ? 'kda-row-changed' : '').attr('data-index', l.index != null ? l.index : i);
            $tr.append(td(l.batch_number || '-'));
            var $style = el('td');
            $style.append(el('strong', null, l.style_code || l.style || '-'));
            if (l.style_label) $style.append(document.createTextNode(' ')).append(el('span', 'kda-muted', l.style_label));
            $tr.append($style);
            $tr.append(td(asked(l), 'text-end' + (changed && mode !== 'pick' ? ' kda-struck' : '')));
            if (mode === 'pick') {
                var $in = el('input', 'form-control form-control-sm kda-num-input js-kda-picked')
                    .attr({ type: 'number', min: 0, max: asked(l), step: 1, inputmode: 'numeric',
                        'aria-label': 'Cartons picked, style ' + (l.style_code || l.style || '') + ' batch ' + (l.batch_number || '') })
                    .val(Number(l.cartons) || 0);
                $tr.append(td($in, 'text-end'));
            } else {
                $tr.append(td(Number(l.cartons) + ' ctn', 'text-end' + (changed ? ' kda-changed-qty' : '')));
            }
            $tr.append(td(fmtKg((Number(l.cartons) || 0) * KG_PER_CARTON), 'text-end js-kda-kg'));
            if (prices) {
                if (mode === 'approve') {
                    var pre = l.price_per_kg != null ? l.price_per_kg : l.list_price;
                    var $p = el('input', 'form-control form-control-sm kda-num-input js-kda-price')
                        .attr({ type: 'number', min: 0, step: '0.01', inputmode: 'decimal', placeholder: 'No list price',
                            'aria-label': 'Price per kg, style ' + (l.style_code || l.style || '') + ' batch ' + (l.batch_number || '') });
                    if (pre != null) $p.val(Number(pre));
                    var $wrap = el('span', 'kda-price-wrap').append(el('span', 'text-muted', 'R')).append($p);
                    $tr.append(td($wrap));
                } else {
                    var shown = l.price_per_kg != null ? l.price_per_kg : l.list_price;
                    $tr.append(td(shown != null ? fmtRand(shown) : '-'));
                }
                $tr.append(td('', 'text-end js-kda-value'));
            }
            $body.append($tr);
        });
        if (!wf.lines.length) {
            $body.append(el('tr').append(td('No lines on this order.', 'text-center text-muted py-3').attr('colspan', cols.length)));
        }
        var $tot = el('tr', 'kda-total-row');
        $tot.append(td('Total').attr('colspan', 3));
        $tot.append(td('', 'text-end').attr('id', 'kdaTotCartons'));
        $tot.append(td('', 'text-end').attr('id', 'kdaTotKg'));
        if (prices) {
            $tot.append(td(''));
            $tot.append(td('', 'text-end').attr('id', 'kdaTotValue'));
        }
        $body.append($tot);
        $t.append($body);

        $('#kdaTableHelp').text(mode === 'approve'
            ? 'Prices fill in from the style price list. Change one for this dispatch only. Kg = cartons × 11.34.'
            : 'Kg = cartons × 11.34.');
    }

    function renderTransport() {
        var o = wf.order;
        var payer = o.transport_payer === 'customer' ? 'customer' : 'macavation';
        $('#kdaPayerMac').prop('checked', payer === 'macavation');
        $('#kdaPayerCust').prop('checked', payer === 'customer');
        $('#kdaTransportCost').val(o.transport_cost_zar != null ? Number(o.transport_cost_zar) : '');
        $('#kdaPallets').val(o.pallets != null ? Number(o.pallets) : '');
        $('#kdaTransportCompany').val(o.transport_company || '');
    }

    // Live figures: row kg, totals, line values, sale summary.
    function recalc() {
        if (!wf) return;
        var totCartons = 0, totKg = 0, goods = 0;
        $('#kdaTable tbody tr[data-index]').each(function (i) {
            var line = wf.lines[i];
            var $tr = $(this);
            var ctn = mode === 'pick' ? parseInt($tr.find('.js-kda-picked').val(), 10) : Number(line.cartons);
            if (isNaN(ctn) || ctn < 0) ctn = 0;
            var kg = ctn * KG_PER_CARTON;
            totCartons += ctn;
            totKg += kg;
            $tr.find('.js-kda-kg').text(fmtKg(kg));
            var $price = $tr.find('.js-kda-price');
            var price = $price.length ? parseFloat($price.val()) : (line.price_per_kg != null ? Number(line.price_per_kg) : (line.list_price != null ? Number(line.list_price) : NaN));
            var val = isNaN(price) ? 0 : kg * price;
            goods += val;
            $tr.find('.js-kda-value').text(isNaN(price) ? '-' : fmtRand(val));
        });
        $('#kdaTotCartons').text(totCartons + ' ctn');
        $('#kdaTotKg').text(fmtKg(totKg) + ' kg');
        $('#kdaTotValue').text(fmtRand(goods));

        if (mode !== 'approve') return;
        var payer = $('input[name="kdaPayer"]:checked').val();
        $('.kda-radio').each(function () { $(this).toggleClass('kda-radio-on', $(this).find('input').is(':checked')); });
        var cost = parseFloat($('#kdaTransportCost').val());
        var transport = payer === 'macavation' && !isNaN(cost) ? cost : 0;
        var pallets = parseInt($('#kdaPallets').val(), 10);
        var net = goods - transport;
        $('#kdaTransportCost').prop('disabled', payer === 'customer');
        $('#kdaSumGoods').text(fmtRand(goods));
        $('#kdaSumTransportRow').toggleClass('d-none', payer !== 'macavation');
        $('#kdaSumTransport').text('- ' + fmtRand(transport));
        $('#kdaSumNet').text(fmtRand(net));
        $('#kdaSumPerKg').text(totKg > 0 ? fmtRand(net / totKg) : '-');
        var hasPallets = !isNaN(pallets) && pallets > 0;
        $('#kdaSumPerPalletTile').toggleClass('d-none', !hasPallets);
        $('#kdaSumPerPallet').text(hasPallets ? fmtRand(net / pallets) : '-');
    }

    function renderButtons() {
        var st = stageOf();
        var $primary = $('#kdaPrimaryBtn').addClass('d-none').prop('disabled', false);
        var $back = $('#kdaSendBackBtn').addClass('d-none').prop('disabled', false);
        if (mode === 'pick') {
            $primary.text('Confirm picked').removeClass('d-none');
        } else if (mode === 'approve') {
            $primary.text(st === 'approved' ? 'Update sale' : 'Approve and record sale').removeClass('d-none');
            $back.removeClass('d-none');
        }
    }

    function render() {
        var o = wf.order;
        var st = stageOf();
        if (st === 'picking' && can('kernel_dispatch.pick')) mode = 'pick';
        else if ((st === 'approval' || st === 'approved') && can('kernel_dispatch.approve') && !isDispatched()) mode = 'approve';
        else mode = 'view';

        $('#kernelDispatchApproveModalLabel').text('Dispatch to ' + (o.buyer_name || 'buyer'));
        var sub = [];
        if (o.delivery_date) sub.push('Delivery date ' + fmtDate(o.delivery_date));
        $('#kdaSubline').text(sub.join(' · '));

        $('#kdaUnavailable').addClass('d-none');
        $('#kdaContent').removeClass('d-none');
        renderStepper();
        renderFlags();
        renderTable();
        $('#kdaPickNote').val('');
        $('#kdaPickNoteWrap').toggleClass('d-none', mode !== 'pick');
        $('#kdaApproveCards').toggleClass('d-none', mode !== 'approve');
        if (mode === 'approve') renderTransport();
        $('#kdaFootnote').toggleClass('d-none', !(mode === 'pick' || mode === 'approve'));
        renderButtons();
        recalc();
    }

    function renderUnavailable() {
        $('#kernelDispatchApproveModalLabel').text('Dispatch');
        $('#kdaSubline').text('');
        $('#kdaContent').addClass('d-none');
        $('#kdaUnavailable').removeClass('d-none');
        $('#kdaPrimaryBtn, #kdaSendBackBtn, #kdaFootnote').addClass('d-none');
    }

    // ------------------------------------------------------------------
    // Actions.
    // ------------------------------------------------------------------

    function submitPick() {
        var picked = [];
        var bad = null;
        var any = false;
        $('#kdaTable tbody tr[data-index]').each(function (i) {
            var line = wf.lines[i];
            var raw = $(this).find('.js-kda-picked').val();
            var n = Number(raw);
            if (raw === '' || !isFinite(n) || Math.floor(n) !== n || n < 0) bad = 'Picked cartons must be whole numbers, zero or more.';
            else if (n > asked(line)) bad = 'You cannot pick more than was asked for (style ' + (line.style_code || line.style) + ', batch ' + line.batch_number + ').';
            if (n > 0) any = true;
            picked.push({ index: line.index, cartons: n });
        });
        if (!bad && !any) bad = 'At least one line must have cartons picked.';
        if (bad) {
            if (typeof Swal !== 'undefined') Swal.fire('Check the cartons', bad, 'warning');
            return;
        }
        setBusy(true);
        dataFunctions.confirmKernelDispatchPick(wf.order.id, picked, ($('#kdaPickNote').val() || '').trim()).then(function (res) {
            setBusy(false);
            if (res && res.success !== false) done('Picking confirmed. Pete can price it now.');
            else fail(res, 'Could not confirm the picking.');
        });
    }

    function collectSale() {
        var prices = [];
        var missing = false;
        var goods = 0;
        $('#kdaTable tbody tr[data-index]').each(function (i) {
            var line = wf.lines[i];
            var p = parseFloat($(this).find('.js-kda-price').val());
            if (isNaN(p) || p < 0) { missing = true; return; }
            prices.push({ index: line.index, price_per_kg: p });
            goods += (Number(line.cartons) || 0) * KG_PER_CARTON * p;
        });
        if (missing) return { error: 'Enter a price per kg for every line.' };
        var payer = $('input[name="kdaPayer"]:checked').val() || 'macavation';
        var cost = $('#kdaTransportCost').val();
        if (payer === 'macavation' && cost !== '' && (isNaN(parseFloat(cost)) || parseFloat(cost) < 0)) {
            return { error: 'The transport cost must be a number, or leave it blank for now.' };
        }
        return {
            goods: goods,
            args: {
                prices: prices,
                transportPayer: payer,
                transportCostZar: payer === 'macavation' ? cost : null,
                pallets: $('#kdaPallets').val(),
                transportCompany: ($('#kdaTransportCompany').val() || '').trim()
            }
        };
    }

    function submitApprove() {
        var sale = collectSale();
        if (sale.error) {
            if (typeof Swal !== 'undefined') Swal.fire('Check the sale', sale.error, 'warning');
            return;
        }
        var updating = stageOf() === 'approved';
        Swal.fire({
            title: updating ? 'Update this sale?' : 'Record a sale of ' + fmtRand(sale.goods) + ' to ' + (wf.order.buyer_name || 'the buyer') + '?',
            text: 'The sale shows on the Kernel Dashboard straight away.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: updating ? 'Update sale' : 'Record sale',
            cancelButtonText: 'Cancel'
        }).then(function (r) {
            if (!r.isConfirmed) return;
            setBusy(true);
            dataFunctions.approveKernelDispatchSale(wf.order.id, sale.args).then(function (res) {
                setBusy(false);
                if (res && res.success !== false) done(updating ? 'Sale updated.' : 'Approved. The sale is recorded.');
                else fail(res, 'Could not record the sale.');
            });
        });
    }

    function submitSendBack() {
        Swal.fire({
            title: 'Send back to Thando?',
            input: 'textarea',
            inputLabel: 'What needs another look?',
            inputAttributes: { maxlength: 1000, 'aria-label': 'Reason for sending back' },
            showCancelButton: true,
            confirmButtonText: 'Send back',
            cancelButtonText: 'Cancel',
            inputValidator: function (v) { return (v && v.trim()) ? undefined : 'Please say why, so Thando knows what to fix.'; }
        }).then(function (r) {
            if (!r.isConfirmed) return;
            setBusy(true);
            dataFunctions.sendBackKernelDispatch(wf.order.id, (r.value || '').trim()).then(function (res) {
                setBusy(false);
                if (res && res.success !== false) done('Sent back for picking.');
                else fail(res, 'Could not send it back.');
            });
        });
    }

    return {
        init: function () {
            var $modal = $('#' + MODAL_ID);
            if (!$modal.length) return;
            $modal.off('.kda');
            $modal.on('input.kda change.kda', '.js-kda-picked, .js-kda-price, #kdaTransportCost, #kdaPallets, input[name="kdaPayer"]', recalc);
            $('#kdaPrimaryBtn').off('click.kda').on('click.kda', function (e) {
                e.preventDefault();
                if (busy || !wf) return;
                if (mode === 'pick') submitPick(); else if (mode === 'approve') submitApprove();
            });
            $('#kdaSendBackBtn').off('click.kda').on('click.kda', function (e) {
                e.preventDefault();
                if (!busy && wf && mode === 'approve') submitSendBack();
            });
        },

        show: function (orderId) {
            if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.getKernelDispatchWorkflow) return;
            $('#kdaOrderId').val(orderId);
            dataFunctions.getKernelDispatchWorkflow(orderId).then(function (data) {
                if (data && data.order && Array.isArray(data.lines)) {
                    wf = data;
                    render();
                } else {
                    wf = null;
                    renderUnavailable();
                }
                openModal();
            });
        }
    };
})();

window._modal_kernel_dispatch_approve = _modal_kernel_dispatch_approve;
