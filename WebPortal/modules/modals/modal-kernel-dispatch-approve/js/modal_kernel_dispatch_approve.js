/**
 * Modal: kernel dispatch workflow (Dispatch and Sales, Mike's five steps, 5 Nov 2026).
 *   1 Dispatch created  2 Stock picked  3 Pricing confirmed  4 Truck loaded  5 Invoice sent
 * Pick mode (Thando): confirm cartons picked, no prices. A short line can get substitutes from
 *   other batches; a different style is marked "needs Pete's OK". Changes notify Joslyn, Mike
 *   and Pete, and a short line flags the batch for a count (server side).
 * Approve mode (Pete): prices fill in from the customer's price list (or the standard list);
 *   a changed price can carry a reason. Confirming accepts any different-style substitute.
 * Invoice (Joslyn): once the truck is loaded, "Invoice sent" ticks step 5. She types the customer's PO
 *   number and our invoice number (both required) and can attach each; they show on the dispatch after.
 * Everyone else gets the same layout read-only; rand figures only with kernel_prices.view.
 */
var _modal_kernel_dispatch_approve = (function () {
    'use strict';

    var KG_PER_CARTON = 11.34;
    var VAT_RATE = 0.15;
    var MODAL_ID = 'kernelDispatchApproveModal';
    var wf = null;       // last loaded workflow
    var mode = 'view';   // 'pick' | 'approve' | 'invoice' | 'view'
    var busy = false;
    var stockOptions = null;   // [{ kernel_id, batch_number, grower_name, style, left }] for substitutes
    var transporters = null;   // [{ id, name }] active transporters; null = list unavailable, use free text
    var paperDocs = { po: [], inv: [] };   // step 5 files: [{ name, file_id, file_link }]
    var paperUploads = 0;      // uploads still running
    var paperGen = 0;          // bumped on each render so a late upload can't land on another dispatch

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
    function fmtBatch(v) { return (typeof macBatchNo !== 'undefined') ? macBatchNo.format(v) : String(v == null ? '' : v); }

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

    function isSub(line) { return !!(line && line.substitute_for); }

    function isChanged(line) {
        return !isSub(line) && line.requested_cartons != null && Number(line.requested_cartons) !== Number(line.cartons);
    }

    function requestedLines() { return wf.lines.filter(function (l) { return !isSub(l); }); }
    function subLines() { return wf.lines.filter(isSub); }

    function pickerLabel() {
        return (wf && wf.order && wf.order.picked_by_label) || 'The picker';
    }

    function stageOf() { return (wf.order.workflow_stage || '').toLowerCase(); }
    function isDispatched() { return String(wf.order.status || '').toLowerCase() === 'dispatched'; }
    function isInvoiced() { return !!wf.order.invoice_sent_at; }

    /** Steps done, 1-5 (Dispatch created is always done). */
    function stepsDone() {
        var st = stageOf();
        if (!st) return isDispatched() ? (isInvoiced() ? 5 : 4) : 1;
        if (st === 'picking') return 1;
        if (st === 'approval') return 2;
        if (!isDispatched()) return 3;
        return isInvoiced() ? 5 : 4;
    }

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
    // Substitute stock (pick mode only).
    // ------------------------------------------------------------------

    function loadStockOptions() {
        if (stockOptions) return Promise.resolve(stockOptions);
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getKernelBatches) return Promise.resolve([]);
        return dataFunctions.getKernelBatches(null, true, { status: 'complete' }).then(function (all) {
            var out = [];
            (all || []).forEach(function (b) {
                var st = b && b.status != null ? String(b.status).trim() : '';
                if (!(st === 'complete' || st === 'in_finished_stock') || b.is_active === false) return;
                var cells = (b.remaining_by_style_cartons && typeof b.remaining_by_style_cartons === 'object') ? b.remaining_by_style_cartons : {};
                Object.keys(cells).forEach(function (style) {
                    var left = Math.floor(Number(cells[style]) || 0);
                    if (left > 0) out.push({ kernel_id: String(b.id), batch_number: b.batch_number, grower_name: b.grower_name || '', best_before: b.best_before_date || '', style: style, left: left });
                });
            });
            out.sort(function (a, b) {
                var da = String(a.best_before || '9999'), db = String(b.best_before || '9999');
                return da < db ? -1 : (da > db ? 1 : 0);
            });
            stockOptions = out;
            return out;
        }).catch(function (e) {
            console.warn('[Dispatch approve] could not load stock for substitutes:', e);
            return [];
        });
    }

    /** Batches this order's own substitutes already hold count as available to it again. */
    function heldByThisOrder(kernelId, style) {
        return subLines().reduce(function (n, l) {
            return n + (String(l.kernel_id) === String(kernelId) && String(l.style) === String(style) ? Number(l.cartons) || 0 : 0);
        }, 0);
    }

    function subRow(forIndex, preset) {
        var parent = wf.lines[forIndex];
        var $tr = el('tr', 'kda-sub-row js-kda-sub-row').attr('data-for-index', forIndex);
        var $sel = el('select', 'form-select form-select-sm js-kda-sub-stock')
            .attr('aria-label', 'Substitute batch and style for ' + fmtBatch(parent.batch_number) + ' style ' + (parent.style || ''));
        $sel.append(el('option', null, 'Choose a batch…').attr('value', ''));
        var opts = stockOptions || [];
        var same = el('optgroup').attr('label', 'Same style (' + (parent.style || '') + ')');
        var other = el('optgroup').attr('label', 'Different style: needs Pete’s OK');
        var seen = {};
        var addOpt = function (o, $grp) {
            var key = o.kernel_id + '|' + o.style;
            if (seen[key]) return;
            seen[key] = true;
            var left = o.left + heldByThisOrder(o.kernel_id, o.style);
            $grp.append(el('option', null, fmtBatch(o.batch_number) + ' · ' + o.style + ' · ' + left + ' left' + (o.grower_name ? ' · ' + o.grower_name : ''))
                .attr({ value: key, 'data-left': left, 'data-batch-number': o.batch_number }));
        };
        // A substitute already saved on this order stays selectable even if its batch shows 0 left now.
        if (preset && !opts.some(function (o) { return o.kernel_id === String(preset.kernel_id) && o.style === String(preset.style); })) {
            addOpt({ kernel_id: String(preset.kernel_id), batch_number: preset.batch_number, grower_name: '', style: String(preset.style), left: 0 },
                String(preset.style) === String(parent.style) ? same : other);
        }
        opts.forEach(function (o) {
            if (o.kernel_id === String(parent.kernel_id) && o.style === String(parent.style)) return; // the short batch itself
            addOpt(o, o.style === String(parent.style) ? same : other);
        });
        $sel.append(same).append(other);
        if (preset) $sel.val(String(preset.kernel_id) + '|' + String(preset.style));

        var $cell = el('td').attr('colspan', 2);
        $cell.append(el('div', 'kda-sub-label', 'Substitute for ' + fmtBatch(parent.batch_number) + ' ' + (parent.style || '')));
        $cell.append($sel);
        $cell.append(el('div', 'kda-sub-warn small d-none js-kda-sub-warn', 'Different style: Pete must accept it when he confirms pricing.'));
        $tr.append($cell);
        $tr.append(td('', 'text-end'));
        var $n = el('input', 'form-control form-control-sm kda-num-input js-kda-sub-cartons')
            .attr({ type: 'text', inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Substitute cartons' })
            .val(preset ? Number(preset.cartons) || '' : '');
        $tr.append(td($n, 'text-end'));
        var $kg = td('', 'text-end js-kda-kg');
        var $rm = el('button', 'btn btn-sm btn-link text-danger js-kda-sub-remove', 'Remove').attr('type', 'button');
        $kg.append(el('div').append($rm));
        $tr.append($kg);
        if (showPrices()) { $tr.append(td('')); $tr.append(td('', 'text-end')); }
        updateSubWarn($tr);
        return $tr;
    }

    function updateSubWarn($tr) {
        var forIndex = Number($tr.attr('data-for-index'));
        var val = String($tr.find('.js-kda-sub-stock').val() || '');
        var style = val.split('|')[1];
        var parent = wf.lines[forIndex];
        $tr.find('.js-kda-sub-warn').toggleClass('d-none', !style || style === String(parent.style));
    }

    function addSubRow(forIndex, preset) {
        var $after = $('#kdaTable tbody tr[data-index="' + forIndex + '"]');
        var $last = $('#kdaTable tbody tr.js-kda-sub-row[data-for-index="' + forIndex + '"]').last();
        (($last.length ? $last : $after)).after(subRow(forIndex, preset));
    }

    // ------------------------------------------------------------------
    // Rendering.
    // ------------------------------------------------------------------

    function renderStepper() {
        var doneN = stepsDone();
        var current = doneN >= 5 ? 0 : doneN + 1;
        var steps = [
            ['1 · Dispatch created', 'Customer, collection date, stock'],
            ['2 · Stock picked', 'Picker confirms what is on the shelf'],
            ['3 · Pricing confirmed', 'Prices from the customer price list'],
            ['4 · Truck loaded', 'Truck details and checks'],
            ['5 · Invoice sent', 'Invoice and documents to the customer']
        ];
        var $ol = $('#kdaStepper').empty();
        steps.forEach(function (s, i) {
            var n = i + 1;
            var isDone = n <= doneN;
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
        var subs = subLines();
        var note = wf.order.pick_note;
        var $flag = $('#kdaFlag').empty().addClass('d-none');
        if (stageOf() !== 'picking' && (changed.length || subs.length || note)) {
            var who = pickerLabel();
            var $txt = el('div');
            var parts = [];
            if (changed.length) parts.push(changed.length + (changed.length === 1 ? ' short line' : ' short lines'));
            if (subs.length) parts.push(subs.length + (subs.length === 1 ? ' substitute' : ' substitutes'));
            $txt.append(el('strong', 'kda-flag-title', parts.length ? who + ' changed the pick: ' + parts.join(', ') : 'Note from ' + who));
            changed.forEach(function (l) {
                $txt.append(el('span', 'kda-flag-line',
                    fmtBatch(l.batch_number || '-') + ' style ' + (l.style_code || l.style || '') + ': ' + asked(l) + ' asked, ' + l.cartons + ' found'));
            });
            subs.forEach(function (l) {
                var f = l.substitute_for || {};
                var diff = l.needs_approval && !l.substitute_accepted;
                $txt.append(el('span', 'kda-flag-line' + (diff ? ' fw-semibold' : ''),
                    l.cartons + ' cartons of ' + l.style + ' from ' + fmtBatch(l.batch_number) + ' instead of ' + fmtBatch(f.batch_number) + ' ' + (f.style || '')
                    + (diff ? ' (different style: confirming pricing accepts it)' : (l.needs_approval ? ' (different style, accepted)' : ''))));
            });
            if (note) $txt.append(el('span', 'kda-flag-line', 'Note: "' + note + '"'));
            $flag.append(el('i', 'fas fa-triangle-exclamation').attr('aria-hidden', 'true')).append($txt).removeClass('d-none');
        }
        var $rev = $('#kdaReview').addClass('d-none').empty();
        if (wf.order.review_note) {
            $rev.text('Sent back: ' + wf.order.review_note).removeClass('d-none');
        }
        var $ap = $('#kdaApprovedInfo').addClass('d-none').empty();
        if (stageOf() === 'approved') {
            var bits = [];
            if (wf.order.approved_at) bits.push('Pricing confirmed by ' + (wf.order.approved_by_label || 'Pete') + ' on ' + fmtDay(wf.order.approved_at) + '.');
            if (isDispatched()) {
                bits.push('Truck loaded' + (wf.order.dispatched_at ? ' on ' + fmtDay(wf.order.dispatched_at) : '')
                    + (wf.order.delivery_note_number ? ', delivery note / invoice ' + wf.order.delivery_note_number : '') + '.');
            } else {
                bits.push('Next: load the truck (truck details and checks).');
            }
            if (isInvoiced()) bits.push('Invoice sent' + (wf.order.invoice_sent_by_label ? ' by ' + wf.order.invoice_sent_by_label : '') + ' on ' + fmtDay(wf.order.invoice_sent_at) + '.');
            $ap.text(bits.join(' ')).removeClass('d-none');
        }
        renderCustomer();
    }

    function renderCustomer() {
        var $c = $('#kdaCustomer').empty().addClass('d-none');
        var c = wf.customer;
        if (!c || !(mode === 'invoice' || mode === 'approve')) return;
        var bits = [c.contact_person, c.phone, c.email, c.address, c.vat_number ? 'VAT ' + c.vat_number : null].filter(Boolean);
        if (!bits.length) return;
        $c.append(el('strong', null, 'Customer: ')).append(document.createTextNode(bits.join(' · '))).removeClass('d-none');
    }

    function td(content, cls) {
        var $c = el('td', cls);
        if (content != null && content !== '') {
            if (typeof content === 'object') $c.append(content); else $c.text(String(content));
        }
        return $c;
    }

    function priceSourceText(l) {
        if (l.price_source === 'customer') return 'Customer price' + (l.price_valid_until ? ' until ' + fmtDate(l.price_valid_until) : '');
        if (l.price_source === 'list') return 'Standard price';
        return 'No price set';
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
        var lines = mode === 'pick' ? requestedLines() : wf.lines;
        lines.forEach(function (l) {
            var changed = isChanged(l);
            var sub = isSub(l);
            var $tr = el('tr', changed ? 'kda-row-changed' : (sub ? 'kda-sub-row' : '')).attr('data-index', l.index);
            var $b = el('td');
            if (sub) $b.append(el('div', 'kda-sub-label', 'Substitute for ' + fmtBatch((l.substitute_for || {}).batch_number) + ' ' + ((l.substitute_for || {}).style || '')));
            $b.append(el('span', null, fmtBatch(l.batch_number || '-')));
            if (sub && l.needs_approval) {
                $b.append(document.createTextNode(' ')).append(el('span', 'badge ' + (l.substitute_accepted ? 'bg-secondary' : 'bg-warning text-dark'),
                    l.substitute_accepted ? 'Different style, accepted' : 'Different style: needs Pete’s OK'));
            }
            $tr.append($b);
            var $style = el('td');
            $style.append(el('strong', null, l.style_code || l.style || '-'));
            if (l.style_label) $style.append(document.createTextNode(' ')).append(el('span', 'kda-muted', l.style_label));
            $tr.append($style);
            $tr.append(td(sub ? '—' : asked(l), 'text-end' + (changed && mode !== 'pick' ? ' kda-struck' : '')));
            if (mode === 'pick') {
                var $in = el('input', 'form-control form-control-sm kda-num-input js-kda-picked')
                    .attr({ type: 'text', inputmode: 'numeric', autocomplete: 'off',
                        'aria-label': 'Cartons picked, style ' + (l.style_code || l.style || '') + ' batch ' + fmtBatch(l.batch_number || '') })
                    .val(Number(l.cartons) || 0);
                var $pickCell = td($in, 'text-end');
                $pickCell.append(el('button', 'btn btn-sm btn-link p-0 mt-1 d-none js-kda-add-sub', '+ Substitute')
                    .attr({ type: 'button', 'data-for-index': l.index }));
                $tr.append($pickCell);
            } else {
                $tr.append(td(Number(l.cartons) + ' ctn', 'text-end' + (changed ? ' kda-changed-qty' : '')));
            }
            $tr.append(td(fmtKg((Number(l.cartons) || 0) * KG_PER_CARTON), 'text-end js-kda-kg'));
            if (prices) {
                if (mode === 'approve') {
                    var pre = l.price_per_kg != null ? l.price_per_kg : l.list_price;
                    var $p = el('input', 'form-control form-control-sm kda-num-input js-kda-price')
                        .attr({ type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'No price',
                            'aria-label': 'Price per kg, style ' + (l.style_code || l.style || '') + ' batch ' + fmtBatch(l.batch_number || '') });
                    if (pre != null) $p.val(Number(pre).toFixed(2));
                    var $cell = el('td');
                    $cell.append(el('span', 'kda-price-wrap').append(el('span', 'text-muted', 'R')).append($p));
                    $cell.append(el('div', 'kda-price-src small text-muted js-kda-price-src', priceSourceText(l)));
                    var $why = el('input', 'form-control form-control-sm mt-1 d-none js-kda-price-note')
                        .attr({ type: 'text', maxlength: 300, placeholder: 'Reason for the change (optional)', 'aria-label': 'Reason for the price change' })
                        .val(l.price_note || '');
                    $cell.append($why);
                    $tr.append($cell);
                } else {
                    var shown = l.price_per_kg != null ? l.price_per_kg : l.list_price;
                    var $v = td(shown != null ? fmtRand(shown) : '-');
                    if (l.price_note) $v.append(el('div', 'small text-muted', '"' + l.price_note + '"'));
                    $tr.append($v);
                }
                $tr.append(td('', 'text-end js-kda-value'));
            }
            $body.append($tr);
        });
        if (!lines.length) {
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

        if (mode === 'pick') {
            subLines().forEach(function (s) { addSubRow(Number((s.substitute_for || {}).index), s); });
        }

        $('#kdaTableHelp').text(mode === 'approve'
            ? 'Prices fill in from this customer’s price list, or the standard price list. Change one for this dispatch only and say why. Kg = cartons × 11.34.'
            : (mode === 'pick'
                ? 'Lower a line if the shelf is short, then use + Substitute to pick from another batch. A short line flags that batch for a stock count. Kg = cartons × 11.34.'
                : 'Kg = cartons × 11.34.'));
    }

    function renderTransport() {
        var o = wf.order;
        var payer = o.transport_payer === 'customer' ? 'customer' : 'macavation';
        $('#kdaPayerMac').prop('checked', payer === 'macavation');
        $('#kdaPayerCust').prop('checked', payer === 'customer');
        $('#kdaTransportCost').val(o.transport_cost_zar != null ? Number(o.transport_cost_zar) : '');
        $('#kdaPallets').val(o.pallets != null ? Number(o.pallets) : '');
        $('#kdaTransporterAddForm').addClass('d-none');
        showTransporterError('');
        renderTransporterSelect(o.transport_company || '');
    }

    /** Loads active transporters (same list as the dispatch form). Failure leaves the free-text box. Never rejects. */
    function loadTransporters() {
        if (typeof dataFunctions === 'undefined' || !dataFunctions.getKernelPipelineConfig) {
            transporters = null;
            return Promise.resolve();
        }
        return Promise.resolve(dataFunctions.getKernelPipelineConfig()).then(function (cfg) {
            if (!cfg || cfg.success === false || !Array.isArray(cfg.transporters)) throw new Error('config unavailable');
            transporters = cfg.transporters.filter(function (t) { return t && t.id && t.is_active !== false; });
        }).catch(function (err) {
            console.warn('[Dispatch] Transporter list not available, using free text:', err);
            transporters = null;
        });
    }

    /** Fills the Transporter dropdown and selects `name`; a name not on the list is kept as its own option. */
    function renderTransporterSelect(name) {
        var useSelect = Array.isArray(transporters);
        var $sel = $('#kdaTransporterSelect').toggleClass('d-none', !useSelect);
        $('#kdaTransporterAddBtn').toggleClass('d-none', !useSelect);
        $('#kdaTransportCompany').toggleClass('d-none', useSelect).val(name || '');
        if (!useSelect) return;
        $sel.empty().append(el('option', null, 'Select transporter').attr('value', ''));
        var found = false;
        transporters.forEach(function (t) {
            $sel.append(el('option', null, t.name).attr('value', t.name));
            if (name && String(t.name).toLowerCase() === String(name).toLowerCase()) { found = true; name = t.name; }
        });
        if (name && !found) $sel.append(el('option', null, name).attr('value', name));
        $sel.val(name || '');
    }

    function transporterName() {
        var v = Array.isArray(transporters) ? $('#kdaTransporterSelect').val() : $('#kdaTransportCompany').val();
        return String(v || '').trim();
    }

    function showTransporterError(msg) {
        $('#kdaTransporterAddError').text(msg || '').toggleClass('d-none', !msg);
    }

    function addTransporter() {
        var name = String($('#kdaTransporterAddName').val() || '').trim();
        if (!name) { showTransporterError('Enter the transporter name.'); return; }
        if (typeof dataFunctions === 'undefined' || !dataFunctions.upsertTransporter) { showTransporterError('Could not add the transporter.'); return; }
        showTransporterError('');
        var $btn = $('#kdaTransporterAddSave').prop('disabled', true);
        Promise.resolve(dataFunctions.upsertTransporter(name)).then(function (res) {
            if (!res || res.success === false || !res.id) throw new Error((res && res.error) || 'Could not add the transporter.');
            var saved = res.name || name;
            if (!transporters.some(function (t) { return String(t.id) === String(res.id); })) {
                transporters.push({ id: res.id, name: saved, is_active: true });
            }
            renderTransporterSelect(saved);
            $('#kdaTransporterAddName').val('');
            $('#kdaTransporterAddForm').addClass('d-none');
        }).catch(function (e) {
            showTransporterError(e && e.message ? e.message : 'Could not add the transporter.');
        }).then(function () {
            $btn.prop('disabled', false);
        });
    }

    // ---------------- Step 5: customer PO and our invoice ----------------

    var PAPER = {
        po:  { files: '#kdaPoFiles',  error: '#kdaPoFileError',  input: '#kdaPoFileInput',  btn: '#kdaPoAttachBtn',  tag: 'po' },
        inv: { files: '#kdaInvFiles', error: '#kdaInvFileError', input: '#kdaInvFileInput', btn: '#kdaInvAttachBtn', tag: 'inv' }
    };
    var PAPER_FOLDER = 'Macavation/KernelDispatch';

    function docList(v) { return Array.isArray(v) ? v.filter(function (d) { return d && typeof d === 'object'; }) : []; }

    function renderPaperFiles(kind) {
        if (typeof DispatchFormShared === 'undefined') return;
        DispatchFormShared.renderFileList($(PAPER[kind].files), paperDocs[kind], true, function (i) {
            paperDocs[kind].splice(i, 1);
            renderPaperFiles(kind);
        });
    }

    /** Step 5 form. Undoing step 5 keeps the numbers and files, so they come back filled in. */
    function renderInvoiceForm() {
        var o = wf.order;
        paperGen++;
        paperUploads = 0;
        paperDocs = { po: docList(o.po_documents).slice(), inv: docList(o.invoice_documents).slice() };
        $('#kdaPoRef').val(o.po_reference || '');
        $('#kdaInvRef').val(o.invoice_reference || '');
        $('#kdaInvoiceNote').val('');
        ['po', 'inv'].forEach(function (k) {
            $(PAPER[k].error).addClass('d-none').text('');
            $(PAPER[k].btn).prop('disabled', false);
            renderPaperFiles(k);
        });
    }

    async function uploadPaper(kind, files) {
        var S = window.DispatchFormShared;
        var $err = $(PAPER[kind].error).addClass('d-none').text('');
        if (!S || !S.uploadOne) { $err.text('Attaching files is not available right now.').removeClass('d-none'); return; }
        var gen = paperGen;
        var errors = [];
        var $btn = $(PAPER[kind].btn).prop('disabled', true);
        for (var i = 0; i < files.length; i++) {
            var file = files[i];
            if (!S.fileAllowed(file)) { errors.push((file.name || 'file') + ': only PDFs and photos can be attached.'); continue; }
            if (file.size > S.MAX_FILE_BYTES) { errors.push((file.name || 'file') + ': larger than 6 MB.'); continue; }
            paperUploads++;
            try {
                var att = await S.uploadOne(file, PAPER_FOLDER, PAPER[kind].tag);
                if (gen !== paperGen) return;
                paperDocs[kind].push(att);
            } catch (e) {
                errors.push((file.name || 'file') + ': ' + (e && e.message ? e.message : 'Upload failed'));
            } finally {
                if (gen === paperGen) paperUploads--;
            }
        }
        if (gen !== paperGen) return;
        $btn.prop('disabled', false);
        renderPaperFiles(kind);
        if (errors.length) $err.text(errors.join(' ')).removeClass('d-none');
    }

    /** Read-only PO / invoice card, for everyone once step 5 is done. */
    function renderPaper() {
        var o = wf.order;
        var show = isInvoiced() && mode !== 'invoice';
        $('#kdaPaperWrap').toggleClass('d-none', !show);
        if (!show) return;
        $('#kdaPaperPoRef').text(o.po_reference || 'Not recorded');
        $('#kdaPaperInvRef').text(o.invoice_reference || 'Not recorded');
        if (typeof DispatchFormShared !== 'undefined') {
            DispatchFormShared.renderFileList($('#kdaPaperPoFiles'), docList(o.po_documents), false);
            DispatchFormShared.renderFileList($('#kdaPaperInvFiles'), docList(o.invoice_documents), false);
        }
        $('#kdaPaperNote').text(o.invoice_note ? 'Note: ' + o.invoice_note : '').toggleClass('d-none', !o.invoice_note);
    }

    function lineFor($tr) {
        var idx = Number($tr.attr('data-index'));
        for (var i = 0; i < wf.lines.length; i++) if (Number(wf.lines[i].index) === idx) return wf.lines[i];
        return null;
    }

    // Live figures: row kg, totals, line values, sale summary.
    function recalc() {
        if (!wf) return;
        var totCartons = 0, totKg = 0, goods = 0;
        $('#kdaTable tbody tr[data-index], #kdaTable tbody tr.js-kda-sub-row').each(function () {
            var $tr = $(this);
            var subRowEl = $tr.hasClass('js-kda-sub-row');
            var line = subRowEl ? null : lineFor($tr);
            var ctn;
            if (subRowEl) ctn = parseInt($tr.find('.js-kda-sub-cartons').val(), 10);
            else ctn = mode === 'pick' ? parseInt($tr.find('.js-kda-picked').val(), 10) : Number(line && line.cartons);
            if (isNaN(ctn) || ctn < 0) ctn = 0;
            var kg = ctn * KG_PER_CARTON;
            totCartons += ctn;
            totKg += kg;
            if (subRowEl) {
                $tr.find('.js-kda-kg').contents().filter(function () { return this.nodeType === 3; }).remove();
                $tr.find('.js-kda-kg').prepend(document.createTextNode(fmtKg(kg)));
                return;
            }
            $tr.find('.js-kda-kg').text(fmtKg(kg));
            if (mode === 'pick' && line) {
                $tr.find('.js-kda-add-sub').toggleClass('d-none', !(ctn < asked(line)));
            }
            var $price = $tr.find('.js-kda-price');
            var price = $price.length ? parseFloat($price.val()) : (line && line.price_per_kg != null ? Number(line.price_per_kg) : (line && line.list_price != null ? Number(line.list_price) : NaN));
            var val = isNaN(price) ? 0 : kg * price;
            goods += val;
            $tr.find('.js-kda-value').text(isNaN(price) ? '-' : fmtRand(val));
            if ($price.length && line) {
                var listed = line.list_price != null ? Number(line.list_price) : null;
                var changedPrice = !isNaN(price) && (listed == null || Math.abs(price - listed) > 0.004);
                $tr.find('.js-kda-price-note').toggleClass('d-none', !changedPrice && !line.price_note);
                $tr.find('.js-kda-price-src').text(changedPrice
                    ? (listed != null ? 'Changed (list ' + fmtRand(listed) + ')' : 'Typed price')
                    : priceSourceText(line));
            }
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
        var hasCost = payer === 'macavation' && !isNaN(cost);
        var hasPallets = !isNaN(pallets) && pallets > 0;
        $('#kdaTransportCost').prop('disabled', payer === 'customer');
        $('#kdaTransportCostInc').val(hasCost ? fmtRand(Math.round(cost * (1 + VAT_RATE) * 100) / 100) : '');
        $('#kdaCostPerPallet').val(hasCost && hasPallets ? fmtRand(cost / pallets) : '');
        $('#kdaSumGoods').text(fmtRand(goods));
        $('#kdaSumTransportRow').toggleClass('d-none', payer !== 'macavation');
        $('#kdaSumTransport').text('- ' + fmtRand(transport));
        $('#kdaSumNet').text(fmtRand(net));
        $('#kdaSumPerKg').text(totKg > 0 ? fmtRand(net / totKg) : '-');
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
            $primary.text(st === 'approved' ? 'Update pricing' : 'Confirm pricing').removeClass('d-none');
            $back.removeClass('d-none');
        } else if (mode === 'invoice') {
            $primary.text('Invoice sent').removeClass('d-none');
        }
    }

    function render() {
        var o = wf.order;
        var st = stageOf();
        if (st === 'picking' && can('kernel_dispatch.pick')) mode = 'pick';
        else if ((st === 'approval' || st === 'approved') && can('kernel_dispatch.approve') && !isDispatched()) mode = 'approve';
        else if (isDispatched() && !isInvoiced() && can('kernel_dispatch.invoice')) mode = 'invoice';
        else mode = 'view';

        $('#kernelDispatchApproveModalLabel').text('Dispatch to ' + (o.buyer_name || 'buyer'));
        var sub = [];
        var coll = o.planned_collection_date || o.delivery_date;
        if (coll) sub.push('Collection ' + fmtDate(coll));
        sub.push('Step ' + Math.min(stepsDone() + 1, 5) + ' of 5');
        $('#kdaSubline').text(sub.join(' · '));

        $('#kdaUnavailable').addClass('d-none');
        $('#kdaContent').removeClass('d-none');
        renderStepper();
        renderFlags();
        renderTable();
        $('#kdaPickNote').val('');
        $('#kdaPickNoteWrap').toggleClass('d-none', mode !== 'pick');
        $('#kdaInvoiceWrap').toggleClass('d-none', mode !== 'invoice');
        if (mode === 'invoice') renderInvoiceForm();
        renderPaper();
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
        var subs = [];
        var bad = null;
        var any = false;
        var shortBy = {};
        $('#kdaTable tbody tr[data-index]').each(function () {
            var line = lineFor($(this));
            if (!line) return;
            var raw = String($(this).find('.js-kda-picked').val() || '').trim();
            var n = Number(raw);
            if (raw === '' || !/^\d+$/.test(raw)) bad = 'Picked cartons must be whole numbers, zero or more.';
            else if (n > asked(line)) bad = 'You cannot pick more than was asked for (style ' + (line.style_code || line.style) + ', batch ' + fmtBatch(line.batch_number) + '). Use + Substitute for cartons from another batch.';
            if (n > 0) any = true;
            shortBy[line.index] = asked(line) - n;
            picked.push({ index: line.index, cartons: n });
        });
        var used = {};
        $('#kdaTable tbody tr.js-kda-sub-row').each(function () {
            var forIndex = Number($(this).attr('data-for-index'));
            var val = String($(this).find('.js-kda-sub-stock').val() || '');
            var raw = String($(this).find('.js-kda-sub-cartons').val() || '').trim();
            if (!val && !raw) return; // an empty row is ignored
            if (!val) { bad = bad || 'Choose the batch for each substitute, or remove the empty row.'; return; }
            if (!/^\d+$/.test(raw) || Number(raw) <= 0) { bad = bad || 'Substitute cartons must be whole numbers above 0.'; return; }
            var $opt = $(this).find('.js-kda-sub-stock option:selected');
            var left = Number($opt.attr('data-left')) || 0;
            if (Number(raw) > left) { bad = bad || 'Only ' + left + ' cartons are left in ' + $opt.text().split(' · ')[0] + '.'; return; }
            used[forIndex] = (used[forIndex] || 0) + Number(raw);
            if (used[forIndex] > (shortBy[forIndex] || 0)) bad = bad || 'Substitutes can only make up the cartons that were not found.';
            var parts = val.split('|');
            subs.push({ for_index: forIndex, kernel_id: parts[0], batch_number: $opt.attr('data-batch-number') || null, style: parts[1], cartons: Number(raw) });
            any = true;
        });
        if (!bad && !any) bad = 'At least one line must have cartons picked.';
        if (bad) {
            if (typeof Swal !== 'undefined') Swal.fire('Check the cartons', bad, 'warning');
            return;
        }
        var fn = dataFunctions.confirmKernelDispatchPickWithSubstitutes
            ? function () { return dataFunctions.confirmKernelDispatchPickWithSubstitutes(wf.order.id, picked, subs, ($('#kdaPickNote').val() || '').trim()); }
            : function () { return dataFunctions.confirmKernelDispatchPick(wf.order.id, picked, ($('#kdaPickNote').val() || '').trim()); };
        setBusy(true);
        fn().then(function (res) {
            setBusy(false);
            if (res && res.success !== false) {
                stockOptions = null;
                done(res.changes > 0 ? 'Picking confirmed. Joslyn, Mike and Pete have been told what changed.' : 'Picking confirmed. Pete can price it now.');
            } else fail(res, 'Could not confirm the picking.');
        });
    }

    function collectSale() {
        var prices = [];
        var missing = false;
        var goods = 0;
        $('#kdaTable tbody tr[data-index]').each(function () {
            var line = lineFor($(this));
            if (!line) return;
            var p = parseFloat(String($(this).find('.js-kda-price').val() || '').replace(/,/g, ''));
            if (isNaN(p) || p < 0) { missing = true; return; }
            var note = String($(this).find('.js-kda-price-note').val() || '').trim();
            var item = { index: line.index, price_per_kg: p };
            if (note && !$(this).find('.js-kda-price-note').hasClass('d-none')) item.price_note = note;
            prices.push(item);
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
                transportCompany: transporterName()
            }
        };
    }

    function submitApprove() {
        var sale = collectSale();
        if (sale.error) {
            if (typeof Swal !== 'undefined') Swal.fire('Check the pricing', sale.error, 'warning');
            return;
        }
        var updating = stageOf() === 'approved';
        var pending = wf.lines.filter(function (l) { return l.needs_approval && !l.substitute_accepted; }).length;
        Swal.fire({
            title: updating ? 'Update the pricing?' : 'Confirm pricing of ' + fmtRand(sale.goods) + ' for ' + (wf.order.buyer_name || 'the customer') + '?',
            text: (pending ? 'This also accepts the different-style substitute' + (pending === 1 ? '' : 's') + '. ' : '')
                + 'The sale shows on the Kernel Dashboard straight away. Next step: load the truck.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: updating ? 'Update pricing' : 'Confirm pricing',
            cancelButtonText: 'Cancel'
        }).then(function (r) {
            if (!r.isConfirmed) return;
            setBusy(true);
            dataFunctions.approveKernelDispatchSale(wf.order.id, sale.args).then(function (res) {
                setBusy(false);
                if (res && res.success !== false) done(updating ? 'Pricing updated.' : 'Pricing confirmed. The truck can be loaded.');
                else fail(res, 'Could not confirm the pricing.');
            });
        });
    }

    function submitInvoice() {
        var poRef = String($('#kdaPoRef').val() || '').trim();
        var invRef = String($('#kdaInvRef').val() || '').trim();
        var problem = paperUploads > 0 ? 'A file is still uploading. Give it a moment, then try again.'
            : (!poRef ? 'Enter the customer’s PO number.'
            : (!invRef ? 'Enter our invoice number.' : null));
        if (problem) {
            if (typeof Swal !== 'undefined') Swal.fire('Not quite yet', problem, 'warning');
            return;
        }
        setBusy(true);
        dataFunctions.markKernelDispatchInvoiceSent(wf.order.id, true, ($('#kdaInvoiceNote').val() || '').trim(), {
            poReference: poRef,
            invoiceReference: invRef,
            poDocuments: paperDocs.po,
            invoiceDocuments: paperDocs.inv
        }).then(function (res) {
            setBusy(false);
            if (res && res.success !== false) done('Invoice marked as sent. All five steps are done.');
            else fail(res, 'Could not mark the invoice as sent.');
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
            $modal.on('input.kda change.kda', '.js-kda-picked, .js-kda-price, .js-kda-sub-cartons, #kdaTransportCost, #kdaPallets, input[name="kdaPayer"]', recalc);
            $modal.on('change.kda', '.js-kda-sub-stock', function () { updateSubWarn($(this).closest('tr')); recalc(); });
            $modal.on('click.kda', '.js-kda-add-sub', function (e) {
                e.preventDefault();
                var forIndex = Number($(this).attr('data-for-index'));
                var $btn = $(this).prop('disabled', true);
                loadStockOptions().then(function () {
                    $btn.prop('disabled', false);
                    addSubRow(forIndex, null);
                    recalc();
                });
            });
            $modal.on('click.kda', '.js-kda-sub-remove', function (e) {
                e.preventDefault();
                $(this).closest('tr').remove();
                recalc();
            });
            $('#kdaPrimaryBtn').off('click.kda').on('click.kda', function (e) {
                e.preventDefault();
                if (busy || !wf) return;
                if (mode === 'pick') submitPick();
                else if (mode === 'approve') submitApprove();
                else if (mode === 'invoice') submitInvoice();
            });
            $('#kdaSendBackBtn').off('click.kda').on('click.kda', function (e) {
                e.preventDefault();
                if (!busy && wf && mode === 'approve') submitSendBack();
            });
            $('#kdaTransporterAddBtn').off('click.kda').on('click.kda', function () {
                $('#kdaTransporterAddForm').toggleClass('d-none');
                showTransporterError('');
                $('#kdaTransporterAddName').trigger('focus');
            });
            $('#kdaTransporterAddCancel').off('click.kda').on('click.kda', function () {
                $('#kdaTransporterAddForm').addClass('d-none');
                showTransporterError('');
            });
            $('#kdaTransporterAddSave').off('click.kda').on('click.kda', function () { addTransporter(); });
            ['po', 'inv'].forEach(function (kind) {
                $(PAPER[kind].btn).off('click.kda').on('click.kda', function () { $(PAPER[kind].input).trigger('click'); });
                $(PAPER[kind].input).off('change.kda').on('change.kda', function () {
                    var files = Array.prototype.slice.call(this.files || []);
                    this.value = '';
                    if (files.length) uploadPaper(kind, files);
                });
            });
        },

        show: function (orderId) {
            if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.getKernelDispatchWorkflow) return;
            $('#kdaOrderId').val(orderId);
            stockOptions = null;
            dataFunctions.getKernelDispatchWorkflow(orderId).then(function (data) {
                if (data && data.order && Array.isArray(data.lines)) {
                    wf = data;
                    var needStock = (wf.order.workflow_stage || '') === 'picking' && can('kernel_dispatch.pick');
                    Promise.all([needStock ? loadStockOptions() : Promise.resolve(), loadTransporters()]).then(function () {
                        render();
                        openModal();
                    });
                } else {
                    wf = null;
                    renderUnavailable();
                    openModal();
                }
            });
        }
    };
})();

window._modal_kernel_dispatch_approve = _modal_kernel_dispatch_approve;
