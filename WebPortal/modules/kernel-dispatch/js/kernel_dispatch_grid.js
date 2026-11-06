/**
 * Dispatch and Sales (was Kernel Dispatch) - INV from KERNEL R YES → KERNEL CUSTOMERS → DEBTORS.
 * Mike, 5 Nov 2026: every dispatch shows five steps as tick boxes:
 *   1 Dispatch created  2 Stock picked  3 Pricing confirmed  4 Truck loaded  5 Invoice sent
 * Steps come from get_kernel_dispatch_stages (workflow_stage, status, invoice_sent_at); orders made
 * before the workflow have no stage and show "Older order". Send to Dispatch starts a dispatch here.
 */
var _kernelDispatchGrid = function () {
    'use strict';

    var formatDate = function (v) {
        if (!v) return '';
        if (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) return _common.formatDateDDMMYYYY(v);
        var d = v instanceof Date ? v : new Date(v);
        if (isNaN(d.getTime())) return '';
        var day = String(d.getDate()).padStart(2, '0');
        var month = String(d.getMonth() + 1).padStart(2, '0');
        var year = d.getFullYear();
        return day + '/' + month + '/' + year;
    };

    var DISPATCH_KANBAN_COLUMNS = [
        { key: 'confirmed', label: 'Dispatch orders' },
        { key: 'dispatched', label: 'Dispatched' }
    ];

    var can = function (key) { return typeof window.hasAction === 'function' && !!window.hasAction(key); };
    var escHtml = function (v) { return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v).replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    var fmtBatch = function (v) { return (typeof macBatchNo !== 'undefined') ? macBatchNo.format(v) : String(v == null ? '' : v); };
    var STEP_NAMES = ['Dispatch created', 'Stock picked', 'Pricing confirmed', 'Truck loaded', 'Invoice sent'];

    return {
        orders: [],
        /** Workflow state by order id: { workflow_stage, status, invoice_sent_at, picked_by_label, has_pick_changes,
         *  substitutes, needs_approval }. Legacy orders have no entry. */
        stages: {},
        _handlersBound: false,
        currentView: 'table',
        /** Stage filter chip: 'all' | 'picking' | 'approval' | 'truck' | 'invoice' | 'done' | 'legacy'. */
        stageFilter: 'all',
        _pendingOpenOrderId: null,
        /** Active list filters (applied on server via get_kernel_dispatch_orders). */
        dispatchListFilters: { batch: '', supplierDate: '' },

        listFiltersActive: function () {
            var f = this.dispatchListFilters || {};
            return !!(String(f.batch || '').trim() || String(f.supplierDate || '').trim());
        },

        updateFilterEmptyBanner: function () {
            var el = document.getElementById('kdFilterEmptyBanner');
            if (!el) return;
            if (!this.orders.length && this.listFiltersActive()) {
                el.classList.remove('d-none');
                el.innerHTML = 'No baskets match your search. Try another buyer name, batch number, or supplier received date, or <a href="#" class="js-kd-clear-filters">clear search</a>.';
            } else {
                el.classList.add('d-none');
                el.innerHTML = '';
            }
        },

        /** Debounced reload from filter inputs (live search). */
        _kdFilterDebounce: null,
        scheduleDispatchFilterReload: function () {
            var scope = this;
            if (scope._kdFilterDebounce) clearTimeout(scope._kdFilterDebounce);
            scope._kdFilterDebounce = setTimeout(function () {
                scope._kdFilterDebounce = null;
                scope.dispatchListFilters.batch = ($('#kdFilterBatch').val() || '').trim();
                scope.dispatchListFilters.supplierDate = ($('#kdFilterSupplierDate').val() || '').trim();
                scope.loadOrders(true);
            }, 300);
        },

        init: async () => {
            const scope = _kernelDispatchGrid;
            var handoff = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('kernel-dispatch-grid') : null;
            var handoffStage = handoff && handoff.stage === 'approved' ? 'truck' : (handoff && handoff.stage);
            scope.stageFilter = (handoffStage && ['picking', 'approval', 'truck', 'invoice', 'done', 'legacy'].indexOf(handoffStage) >= 0) ? handoffStage : 'all';
            scope._pendingOpenOrderId = (handoff && handoff.openOrderId) || null;
            $('#kdStageChips').off('click.kdStage').on('click.kdStage', '[data-stage]', function () {
                scope.stageFilter = String($(this).data('stage'));
                scope.render();
            });
            $('#kernelDispatchRefreshBtn').off('click').on('click', function () { scope.loadOrders(true); });
            $('#kdSendToDispatchBtn').toggleClass('d-none', !can('kernel.dispatch.create')).off('click').on('click', function () {
                if (typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.show) _modal_stock_send_to_dispatch.show();
            });
            scope.initActivityCalendar();

            $('#kdFilterBatch').off('input.kdFilter').on('input.kdFilter', function () {
                scope.scheduleDispatchFilterReload();
            });
            $('#kdFilterSupplierDate').off('change.kdFilter input.kdFilter').on('change.kdFilter input.kdFilter', function () {
                scope.scheduleDispatchFilterReload();
            });

            $('#kdFilterClear').off('click').on('click', function () {
                if (scope._kdFilterDebounce) clearTimeout(scope._kdFilterDebounce);
                scope._kdFilterDebounce = null;
                scope.dispatchListFilters.batch = '';
                scope.dispatchListFilters.supplierDate = '';
                $('#kdFilterBatch').val('');
                $('#kdFilterSupplierDate').val('');
                scope.loadOrders(true);
            });

            $('#kdViewKanban, #kdViewTable').off('click').on('click', function () {
                scope.toggleView($(this).data('view'));
            });
            if (!scope._handlersBound) {
                scope._handlersBound = true;
                $(document).on('click', '.js-view-dispatch-order', function () {
                    var id = $(this).data('order-id');
                    if (id && typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.show) {
                        _modal_kernel_dispatch_form.show(id);
                    }
                });
                $(document).on('click', '.js-dispatch-order', function () {
                    scope.openDispatch($(this).data('order-id'));
                });
                $(document).on('click', '.js-kd-open-approve', function () {
                    var id = $(this).data('order-id');
                    if (id && typeof _modal_kernel_dispatch_approve !== 'undefined' && _modal_kernel_dispatch_approve.show) {
                        _modal_kernel_dispatch_approve.show(id);
                    }
                });
                $(document).on('kernelDispatch:changed', function () { scope.loadOrders(true); });
                $(document).on('click', '.js-edit-dispatch-order', function () {
                    var id = $(this).data('order-id');
                    if (id && typeof _modal_kernel_dispatch_edit !== 'undefined' && _modal_kernel_dispatch_edit.show) {
                        _modal_kernel_dispatch_edit.show(id);
                    }
                });
                $(document).on('click', '.js-edit-dispatched-basket', function () {
                    var id = $(this).data('order-id');
                    scope.confirmRevertDispatchOrder(id);
                });
                $(document).on('click', '.js-kd-step', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var id = $(this).data('order-id');
                    var step = Number($(this).data('step'));
                    if ($(this).data('state') === 'done') scope.onStepDone(id, step);
                    else scope.onStepNow(id, step);
                });
                $(document).on('click', '.js-kd-invoice-undo', function () {
                    scope.undoInvoiceSent($(this).data('order-id'));
                });
                $(document).on('click', '.js-kd-clear-filters', function (e) {
                    e.preventDefault();
                    if (scope._kdFilterDebounce) clearTimeout(scope._kdFilterDebounce);
                    scope._kdFilterDebounce = null;
                    scope.dispatchListFilters.batch = '';
                    scope.dispatchListFilters.supplierDate = '';
                    $('#kdFilterBatch').val('');
                    $('#kdFilterSupplierDate').val('');
                    scope.loadOrders(true);
                });
            }
            var loadPromises = [];
            $('.modal[route-name]').each(function (index, el) {
                var routeName = $(el).attr('route-name');
                var elementSelector = '#' + $(el).attr('id');
                if (routeName && elementSelector && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: elementSelector }));
                }
            });
            Promise.all(loadPromises).then(function () {
                if (typeof _modal_kernel_dispatch !== 'undefined' && _modal_kernel_dispatch.init) _modal_kernel_dispatch.init();
                if (typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.init) _modal_kernel_dispatch_form.init();
                if (typeof _modal_kernel_dispatch_edit !== 'undefined' && _modal_kernel_dispatch_edit.init) _modal_kernel_dispatch_edit.init();
                if (typeof _modal_kernel_dispatch_approve !== 'undefined' && _modal_kernel_dispatch_approve.init) _modal_kernel_dispatch_approve.init();
                if (typeof _modal_stock_send_to_dispatch !== 'undefined' && _modal_stock_send_to_dispatch.init) _modal_stock_send_to_dispatch.init();
            }).catch(function (err) {
                console.error('[Kernel Dispatch] Error loading modal:', err);
                if (typeof _modal_kernel_dispatch !== 'undefined' && _modal_kernel_dispatch.init) _modal_kernel_dispatch.init();
                if (typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.init) _modal_kernel_dispatch_form.init();
                if (typeof _modal_kernel_dispatch_edit !== 'undefined' && _modal_kernel_dispatch_edit.init) _modal_kernel_dispatch_edit.init();
                if (typeof _modal_kernel_dispatch_approve !== 'undefined' && _modal_kernel_dispatch_approve.init) _modal_kernel_dispatch_approve.init();
            });
            await scope.loadOrders();
            // the modal loads above are not awaited here, so wait for the approve modal's markup
            Promise.all(loadPromises).catch(function () { }).then(function () { scope._openPendingOrder(); });
        },

        /** Router handoff { openOrderId }: open the order once the orders and the approve modal have loaded. */
        _openPendingOrder: function () {
            var id = this._pendingOpenOrderId;
            if (!id) return;
            this._pendingOpenOrderId = null;
            var tries = 0;
            var go = function () {
                if (typeof _modal_kernel_dispatch_approve !== 'undefined' && _modal_kernel_dispatch_approve.show && $('#kernelDispatchApproveModal').children().length) {
                    _modal_kernel_dispatch_approve.show(id);
                } else if (tries++ < 40) {
                    setTimeout(go, 250);
                }
            };
            go();
        },

        // Dispatch calendar: baskets created and baskets dispatched, by day.
        initActivityCalendar: () => {
            if (typeof MacActivityCalendar === 'undefined') return;
            MacActivityCalendar.create({
                mountId: 'kdActivityCalendarMount',
                idPrefix: 'kdActivityCalendar',
                title: 'Dispatch Calendar',
                icon: 'fa-calendar-check',
                intro: 'Days shaded green had dispatch activity. Click a day to see which baskets were dispatched or created, for which buyer, and how many kg.',
                emptyDayText: 'No baskets were created or dispatched on this day.',
                emptyMonthText: 'No baskets were created or dispatched in this month.',
                loadMonth: async (fromIso, toIso) => {
                    if (typeof dataFunctions === 'undefined' || !dataFunctions.getKernelDispatchOrderHistory) throw new Error('Dispatch orders are not available right now.');
                    var orders = await dataFunctions.getKernelDispatchOrderHistory();
                    var inMonth = function (iso) { return iso && iso >= fromIso && iso <= toIso; };
                    var entries = [];
                    orders.forEach(function (o) {
                        if (String(o && o.status || '').toLowerCase() === 'cancelled') return;
                        var created = MacActivityCalendar.dayOf(o.created_at);
                        var dispatched = MacActivityCalendar.dayOf(o.dispatched_at);
                        var detailTags = [];
                        if (o.total_kg != null && Number(o.total_kg) > 0) detailTags.push({ text: MacActivityCalendar.formatKg(o.total_kg), tone: 'grey' });
                        var lines = o.line_count != null ? Number(o.line_count) : 0;
                        if (lines > 0) detailTags.push({ text: lines + ' line' + (lines === 1 ? '' : 's'), tone: 'grey' });
                        var make = function (date, tags) {
                            entries.push({ date: date, title: o.buyer_name || 'Buyer not set', subtitle: '', tags: tags.concat(detailTags) });
                        };
                        if (dispatched && dispatched === created) {
                            if (inMonth(dispatched)) make(dispatched, [{ text: 'Created', tone: 'blue' }, { text: 'Dispatched' }]);
                            return;
                        }
                        if (inMonth(created)) make(created, [{ text: 'Created', tone: 'blue' }]);
                        if (inMonth(dispatched)) make(dispatched, [{ text: 'Dispatched' }]);
                    });
                    return entries;
                }
            });
        },

        stageOf: function (o) {
            var st = o && this.stages[o.id];
            return st && st.workflow_stage ? String(st.workflow_stage).toLowerCase() : '';
        },

        isDispatched: function (o) {
            var st = o && this.stages[o.id];
            return String((st && st.status) || (o && o.status) || '').toLowerCase() === 'dispatched';
        },

        isInvoiced: function (o) {
            var st = o && this.stages[o.id];
            return !!(st && st.invoice_sent_at);
        },

        /** Steps done (1-5), or 0 for an older order with no workflow. */
        stepsDone: function (o) {
            var st = this.stageOf(o);
            if (!st) return 0;
            if (st === 'picking') return 1;
            if (st === 'approval') return 2;
            if (!this.isDispatched(o)) return 3;
            return this.isInvoiced(o) ? 5 : 4;
        },

        /** Stage key for filtering: picking | approval | truck | invoice | done | legacy (no workflow stage). */
        stageKey: function (o) {
            return ['legacy', 'picking', 'approval', 'truck', 'invoice', 'done'][this.stepsDone(o)];
        },

        /** One step box. Done (green) and current (amber) are buttons: done shows what happened,
         *  current opens the action when the user may do it. Steps still to come are plain boxes. */
        stepBox: function (o, i, n) {
            var name = STEP_NAMES[i];
            var state = i < n ? 'done' : (i === n ? 'now' : 'todo');
            var cls = 'kd-box kd-box-' + state;
            if (state === 'todo') return '<span class="' + cls + '" role="img" aria-label="' + name + ': not yet" title="' + name + ': not yet"></span>';
            var label = state === 'done' ? name + ': done. Show details' : name + ': waiting. ' + (this.canDoStep(o, i + 1) ? 'Do this step' : 'Who is it waiting on?');
            return '<button type="button" class="' + cls + ' js-kd-step" data-order-id="' + escHtml(o.id || '') + '" data-step="' + (i + 1) + '" data-state="' + state + '"'
                + ' aria-label="' + escHtml(label) + '" title="' + escHtml(label) + '">'
                + (state === 'done' ? '<i class="fas fa-check" aria-hidden="true"></i>' : '') + '</button>';
        },

        /** Five tick boxes (one per step) as <td> cells, or one cell saying "Older order". */
        stepCells: function (o) {
            var scope = this;
            var n = this.stepsDone(o);
            if (!n) return '<td colspan="5" class="text-center kd-older">Older order (before the five steps)</td>';
            return STEP_NAMES.map(function (name, i) {
                return '<td class="text-center">' + scope.stepBox(o, i, n) + '</td>';
            }).join('');
        },

        /** Small row of boxes for kanban cards. */
        miniSteps: function (o) {
            var scope = this;
            var n = this.stepsDone(o);
            if (!n) return '';
            var boxes = STEP_NAMES.map(function (name, i) { return scope.stepBox(o, i, n); }).join('');
            return '<div class="kd-mini-steps" aria-label="Step ' + Math.min(n + 1, 5) + ' of 5">' + boxes + '</div>';
        },

        /** May this user do step (1-5)? Step 4 (truck form) has no permission of its own today. */
        canDoStep: function (o, step) {
            if (step === 2) return can('kernel_dispatch.pick');
            if (step === 3) return can('kernel_dispatch.approve');
            if (step === 4) return true;
            if (step === 5) return can('kernel_dispatch.invoice');
            return false;
        },

        /** Amber box: open the step's action, or say who it is waiting on. */
        onStepNow: function (id, step) {
            var o = this.orders.filter(function (x) { return String(x.id) === String(id); })[0] || { id: id };
            if (!this.canDoStep(o, step)) {
                var who = { 2: 'the Production Manager (picking)', 3: 'the Sales Exec (pricing)', 5: 'the Palladium Manager (invoice)' }[step] || 'someone else';
                if (typeof Swal !== 'undefined') {
                    Swal.fire({ icon: 'info', title: STEP_NAMES[step - 1] + ': waiting', text: 'This step is waiting on ' + who + '. You don\u2019t have permission to do it.' });
                }
                return;
            }
            if (step === 4) { this.openDispatch(id); return; }
            if (typeof _modal_kernel_dispatch_approve !== 'undefined' && _modal_kernel_dispatch_approve.show) _modal_kernel_dispatch_approve.show(id);
        },

        /** Green tick: what happened at that step, with a way into the full details. */
        onStepDone: function (id, step) {
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getKernelDispatchWorkflow || typeof Swal === 'undefined') return;
            var when = function (v) {
                if (!v) return '';
                var d = new Date(v);
                if (isNaN(d.getTime())) return '';
                return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' +
                    d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
            };
            var rand = function (n) { return 'R ' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
            dataFunctions.getKernelDispatchWorkflow(id).then(function (wf) {
                if (!wf || !wf.order) { Swal.fire('Not available', 'Could not load this dispatch. Please refresh.', 'error'); return; }
                var o = wf.order;
                var lines = Array.isArray(wf.lines) ? wf.lines : [];
                var rows = [];   // [label, value] pairs, rendered as text
                var add = function (k, v) { if (v !== null && v !== undefined && String(v).trim() !== '') rows.push([k, String(v)]); };
                var cartons = lines.reduce(function (t, l) { return t + (Number(l.cartons) || 0); }, 0);
                if (step === 1) {
                    add('Created', when(o.created_at));
                    add('By', o.created_by_label);
                    add('Customer', o.buyer_name);
                    add('Collection date', formatDate(o.planned_collection_date || o.delivery_date));
                    var asked = lines.filter(function (l) { return !l.substitute_for; });
                    add('Asked for', asked.reduce(function (t, l) { return t + (Number(l.requested_cartons != null ? l.requested_cartons : l.cartons) || 0); }, 0) + ' cartons on ' + asked.length + (asked.length === 1 ? ' line' : ' lines'));
                } else if (step === 2) {
                    add('Picked', when(o.picked_at));
                    add('By', o.picked_by_label);
                    add('Cartons picked', cartons);
                    lines.forEach(function (l) {
                        if (l.substitute_for) {
                            add('Substitute', l.cartons + ' of ' + l.style + ' from ' + fmtBatch(l.batch_number) + ' instead of '
                                + fmtBatch(l.substitute_for.batch_number) + ' ' + (l.substitute_for.style || '') + (l.needs_approval ? ' (different style)' : ''));
                        } else if (l.requested_cartons != null && Number(l.requested_cartons) !== Number(l.cartons)) {
                            add('Short', fmtBatch(l.batch_number) + ' ' + l.style + ': ' + l.requested_cartons + ' asked, ' + l.cartons + ' found');
                        }
                    });
                    add('Note', o.pick_note);
                } else if (step === 3) {
                    add('Pricing confirmed', when(o.approved_at));
                    add('By', o.approved_by_label);
                    if (can('kernel_prices.view')) add('Sale value (excl. VAT)', o.sale_value_zar != null ? rand(o.sale_value_zar) : '');
                    add('Transport paid by', o.transport_payer === 'customer' ? 'Customer collects' : (o.transport_payer === 'macavation' ? 'Macavation' : ''));
                    if (can('kernel_prices.view')) {
                        lines.forEach(function (l) {
                            if (l.price_per_kg != null && l.list_price != null && Math.abs(Number(l.price_per_kg) - Number(l.list_price)) > 0.004) {
                                add('Changed price', l.style + ' ' + fmtBatch(l.batch_number) + ': ' + rand(l.price_per_kg) + '/kg (list ' + rand(l.list_price) + ')' + (l.price_note ? ', "' + l.price_note + '"' : ''));
                            }
                        });
                    }
                } else if (step === 4) {
                    add('Truck loaded', when(o.dispatched_at));
                    add('Transport company', o.transport_company);
                    add('Delivery note / invoice number', o.delivery_note_number);
                    add('Cartons', cartons);
                } else if (step === 5) {
                    add('Invoice sent', when(o.invoice_sent_at));
                    add('By', o.invoice_sent_by_label);
                    add('Note', o.invoice_note);
                }
                if (!rows.length) rows.push(['', 'Done.']);
                var $box = $('<div class="kd-step-info text-start"></div>');
                rows.forEach(function (r) {
                    var $row = $('<div class="kd-step-info-row"></div>');
                    if (r[0]) $row.append($('<span class="kd-step-info-label"></span>').text(r[0]));
                    $row.append($('<span class="kd-step-info-value"></span>').text(r[1]));
                    $box.append($row);
                });
                Swal.fire({
                    title: '\u2713 ' + STEP_NAMES[step - 1],
                    html: $box[0],
                    showCancelButton: true,
                    confirmButtonText: step === 4 ? 'Open the truck sheet' : 'Open full details',
                    cancelButtonText: 'Close'
                }).then(function (r) {
                    if (!r.isConfirmed) return;
                    if (step === 4 && typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.show) _modal_kernel_dispatch_form.show(id);
                    else if (typeof _modal_kernel_dispatch_approve !== 'undefined' && _modal_kernel_dispatch_approve.show) _modal_kernel_dispatch_approve.show(id);
                });
            });
        },

        /** Orders after the stage chip filter. */
        visibleOrders: function () {
            var scope = this;
            if (scope.stageFilter === 'all') return scope.orders;
            return scope.orders.filter(function (o) { return scope.stageKey(o) === scope.stageFilter; });
        },

        /** "Waiting on" cell HTML (static text only). */
        waitingOn: function (o) {
            var key = this.stageKey(o);
            var info = this.stages[o.id] || {};
            var n = this.stepsDone(o);
            var of = n && n < 5 ? '<div class="kd-step-of">Step ' + (n + 1) + ' of 5</div>' : '';
            if (key === 'picking') return 'Production Manager <span class="text-muted">&middot; pick the stock</span>' + of;
            if (key === 'approval') {
                return 'Sales Exec <span class="text-muted">&middot; confirm pricing</span>'
                    + (info.needs_approval ? ' <span class="badge bg-warning text-dark">different style to OK</span>'
                        : (info.has_pick_changes ? ' <span class="text-muted">&middot; pick changed</span>' : '')) + of;
            }
            if (key === 'truck') return 'Truck <span class="text-muted">&middot; load and check</span>' + of;
            if (key === 'invoice') return 'Palladium Manager <span class="text-muted">&middot; send the invoice</span>' + of;
            if (key === 'done') return '<span class="text-muted">Done</span>';
            return '<span class="text-muted">Before the five steps</span>';
        },

        renderStageChips: function () {
            var scope = this;
            var counts = { all: scope.orders.length, picking: 0, approval: 0, truck: 0, invoice: 0, done: 0, legacy: 0 };
            scope.orders.forEach(function (o) { counts[scope.stageKey(o)]++; });
            var defs = [
                ['all', 'All', 'kd-chip-all'],
                ['picking', 'Waiting for picking', 'kd-chip-picking'],
                ['approval', 'Waiting for pricing', 'kd-chip-approval'],
                ['truck', 'Waiting for the truck', 'kd-chip-approved'],
                ['invoice', 'Waiting for the invoice', 'kd-chip-approved'],
                ['done', 'Done', 'kd-chip-legacy'],
                ['legacy', 'Older orders', 'kd-chip-legacy']
            ];
            var $box = $('#kdStageChips').empty();
            defs.forEach(function (d) {
                $box.append($('<button type="button" class="kd-chip ' + d[2] + '"></button>')
                    .attr({ 'data-stage': d[0], 'aria-pressed': scope.stageFilter === d[0] ? 'true' : 'false' })
                    .text(d[1] + ' \u00b7 ' + counts[d[0]]));
            });
        },

        /** Extra Status-cell badge for orders in the approval workflow ('' for legacy orders). */
        stageBadge: function (o) {
            var stage = this.stageOf(o);
            if (!stage) return '';
            var info = this.stages[o.id] || {};
            var map = {
                picking: ['Waiting for picking', 'bg-warning text-dark'],
                approval: ['Waiting for pricing', 'bg-info text-dark'],
                truck: ['Priced · waiting for the truck', 'bg-success'],
                invoice: ['Loaded · waiting for the invoice', 'bg-success'],
                done: ['Invoice sent', 'bg-secondary']
            };
            var m = map[this.stageKey(o)];
            if (!m) return '';
            var html = '<div class="mt-1"><span class="badge ' + m[1] + '">' + escHtml(m[0]) + '</span>';
            if (stage === 'approval' && info.has_pick_changes) html += ' <span class="badge bg-warning text-dark" title="The picker changed some cartons">changed</span>';
            return html + '</div>' + this.miniSteps(o);
        },

        /** { label, icon } of the workflow button for this row, or null (legacy orders). */
        stageAction: function (o) {
            var stage = this.stageOf(o);
            if (!stage) return null;
            var key = this.stageKey(o);
            if (key === 'picking' && can('kernel_dispatch.pick')) return { label: 'Confirm picking', icon: 'fas fa-clipboard-check' };
            if (key === 'approval' && can('kernel_dispatch.approve')) return { label: 'Confirm pricing', icon: 'fas fa-tags' };
            if (key === 'truck' && can('kernel_dispatch.approve')) return { label: 'View pricing', icon: 'fas fa-receipt' };
            if (key === 'invoice' && can('kernel_dispatch.invoice')) return { label: 'Invoice sent', icon: 'fas fa-file-invoice' };
            return { label: 'Progress', icon: 'fas fa-list-check' };
        },

        stageMenuItem: function (o) {
            var a = this.stageAction(o);
            return a ? [{ label: a.label, className: 'js-kd-open-approve', icon: a.icon, dataAttrs: { 'order-id': o.id || '' } }] : [];
        },

        stageButton: function (o) {
            var a = this.stageAction(o);
            if (!a) return '';
            return '<button type="button" class="btn btn-sm btn-outline-primary js-kd-open-approve me-1" data-order-id="' + escHtml(o.id || '') + '"><i class="' + a.icon + ' me-1"></i>' + escHtml(a.label) + '</button>';
        },

        /** Truck form (step 4). Blocked until pricing is confirmed; the server refuses it too. */
        openDispatch: function (id) {
            if (!id || typeof _modal_kernel_dispatch_form === 'undefined' || !_modal_kernel_dispatch_form.show) return;
            var stage = this.stageOf({ id: id });
            if (stage === 'picking' || stage === 'approval') {
                var msg = stage === 'picking'
                    ? 'The stock has not been picked yet. The truck can be loaded once the picking and the pricing are confirmed.'
                    : 'Pete has not confirmed the pricing yet. The truck can be loaded once he has.';
                if (typeof Swal !== 'undefined') Swal.fire({ title: 'Not ready for the truck', text: msg, icon: 'info' });
                else window.alert(msg);
                return;
            }
            _modal_kernel_dispatch_form.show(id);
        },

        undoInvoiceSent: function (id) {
            const scope = _kernelDispatchGrid;
            if (!id || typeof dataFunctions === 'undefined' || !dataFunctions.markKernelDispatchInvoiceSent) return;
            var run = function () {
                dataFunctions.markKernelDispatchInvoiceSent(id, false).then(function (res) {
                    if (res && res.success !== false) scope.loadOrders(true);
                    else if (typeof Swal !== 'undefined') Swal.fire('Could not save', (res && res.error) || 'Please try again.', 'error');
                });
            };
            if (typeof Swal !== 'undefined') {
                Swal.fire({ title: 'Undo "Invoice sent"?', text: 'Step 5 goes back to waiting, and the invoice task opens again.', icon: 'warning',
                    showCancelButton: true, confirmButtonText: 'Undo', cancelButtonText: 'Cancel', focusCancel: true })
                    .then(function (r) { if (r.isConfirmed) run(); });
            } else if (window.confirm('Undo "Invoice sent"?')) run();
        },

        loadOrders: async (forceRefresh) => {
            const scope = _kernelDispatchGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getKernelDispatchOrders) {
                    scope.orders = [];
                    scope.render();
                    return;
                }
                var f = scope.dispatchListFilters || { batch: '', supplierDate: '' };
                var filters = scope.listFiltersActive()
                    ? { batchSearch: f.batch, supplierReceivedDate: f.supplierDate }
                    : null;
                var rows = await dataFunctions.getKernelDispatchOrders(null, forceRefresh, filters) || [];
                // Cancelled orders (their last line sent back to stock) never belong on this board -
                // the movement is already recorded in stock_soh_history.
                scope.orders = rows.filter(function (o) { return String(o && o.status || '').toLowerCase() !== 'cancelled'; });
                scope.stages = {};
                if (dataFunctions.getKernelDispatchStages && scope.orders.length) {
                    var stageRows = await dataFunctions.getKernelDispatchStages(scope.orders.map(function (o) { return o.id; })) || [];
                    stageRows.forEach(function (r) { if (r && r.id && r.workflow_stage) scope.stages[r.id] = r; });
                }
                scope.render();
            } catch (e) {
                console.error('[Kernel Dispatch] loadOrders failed:', e);
                var errMsg = (e && e.message) ? String(e.message) : '';
                if (errMsg.indexOf('schema cache') >= 0 || errMsg.indexOf('Could not find the function') >= 0) {
                    console.warn(
                        '[Kernel Dispatch] PostgREST has no RPC matching this call (often: DB still on the old 2-arg get_kernel_dispatch_orders, or schema cache stale). ' +
                        'Apply migrations from 20260526120000_get_kernel_dispatch_orders_batch_supplier_date.sql onward on this environment, then run in SQL: NOTIFY pgrst, \'reload schema\';'
                    );
                }
                scope.orders = [];
                scope.render();
            }
        },

        confirmRevertDispatchOrder: (orderId) => {
            const scope = _kernelDispatchGrid;
            if (!orderId || typeof dataFunctions === 'undefined' || !dataFunctions.revertKernelDispatchOrder) return;
            var run = function () {
                dataFunctions.revertKernelDispatchOrder(orderId).then(function (result) {
                    if (result && result.success !== false) {
                        if (typeof Swal !== 'undefined') Swal.fire({ icon: 'success', title: 'Basket ready to edit', text: (result && result.message) ? result.message : 'Dispatch paperwork was cleared; you can edit and dispatch again.', timer: 2000, showConfirmButton: false });
                        return scope.loadOrders(true);
                    }
                    throw new Error(result && result.error ? result.error : 'Revert failed');
                }).catch(function (e) {
                    console.error(e);
                    if (typeof Swal !== 'undefined') Swal.fire('Error', e.message || 'Failed to revert dispatch', 'error');
                });
            };
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Edit dispatched basket?',
                    html: 'This moves the basket back to <strong>Ready to dispatch</strong> and clears saved dispatch paperwork so you can change lines or dispatch again. Use when dispatch was recorded in error.',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Yes, unlock for editing',
                    cancelButtonText: 'Cancel',
                    focusCancel: true
                }).then(function (res) { if (res.isConfirmed) run(); });
            } else if (window.confirm('Unlock this basket for editing? Saved dispatch paperwork will be cleared.')) {
                run();
            }
        },

        render: () => {
            const scope = _kernelDispatchGrid;
            scope.updateFilterEmptyBanner();
            scope.renderStageChips();
            if (scope.currentView === 'kanban') {
                scope.renderKanban();
                return;
            }
            var shown = scope.visibleOrders();
            // Open = not yet through all five steps. Done = invoiced, or an older order that has gone out.
            var isDone = function (o) { var k = scope.stageKey(o); return k === 'done' || (k === 'legacy' && o.status === 'dispatched'); };
            var pending = shown.filter(function (o) { return !isDone(o); });
            var dispatched = shown.filter(isDone);

            var pendingTbody = $('#kernelDispatchTableBody');
            pendingTbody.empty();
            if (!pending.length) {
                var pendingMsg = scope.listFiltersActive()
                    ? 'No dispatches match your search. Try customer name, batch number, or supplier received date, or clear search.'
                    : 'No open dispatches. Use Send to Dispatch above to start one.';
                pendingTbody.html('<tr><td colspan="10" class="text-center text-muted py-4">' + pendingMsg + '</td></tr>');
            } else {
                pending.forEach(function (o) {
                    var buyer = escHtml(o.buyer_name || '') || '—';
                    var collectionStr = formatDate(o.planned_collection_date || o.delivery_date) || '—';
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var key = scope.stageKey(o);
                    var items = [
                        { label: 'View sheet', className: 'js-view-dispatch-order', icon: 'fas fa-clipboard-list', dataAttrs: { 'order-id': o.id || '' } }
                    ].concat(scope.stageMenuItem(o));
                    if (o.status !== 'dispatched') {
                        items.push({ label: 'Edit', className: 'js-edit-dispatch-order', dataAttrs: { 'order-id': o.id || '' } });
                        if (key === 'truck' || key === 'legacy') items.push({ label: 'Truck loaded', className: 'js-dispatch-order', icon: 'fas fa-truck', dataAttrs: { 'order-id': o.id || '' } });
                    } else {
                        items.push({ label: 'Undo truck loaded', className: 'js-edit-dispatched-basket', dataAttrs: { 'order-id': o.id || '' } });
                    }
                    var actions = MacTableActions.render({ id: 'kdPendingActions' + (o.id || ''), items: items });
                    pendingTbody.append('<tr><td><strong>' + buyer + '</strong><div class="kd-step-of">' + lineCount + ' line' + (lineCount === 1 ? '' : 's') + '</div></td><td>' + collectionStr + '</td><td class="text-end">' + _common.formatKg(totalKg) + ' kg</td>' + scope.stepCells(o) + '<td>' + scope.waitingOn(o) + '</td><td class="mac-table-actions-col">' + actions + '</td></tr>');
                });
            }

            var dispatchedTbody = $('#kernelDispatchedTableBody');
            dispatchedTbody.empty();
            if (!dispatched.length) {
                var dispMsg = scope.listFiltersActive()
                    ? 'No finished dispatches match your search. Adjust search or clear it.'
                    : 'Nothing finished yet. A dispatch moves here once its invoice is sent.';
                dispatchedTbody.html('<tr><td colspan="10" class="text-center text-muted py-4">' + dispMsg + '</td></tr>');
            } else {
                dispatched.forEach(function (o) {
                    var buyer = escHtml(o.buyer_name || '') || '—';
                    var collectionStr = formatDate(o.planned_collection_date || o.delivery_date) || '—';
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var items = [
                        { label: 'View sheet', className: 'js-view-dispatch-order', icon: 'fas fa-clipboard-list', dataAttrs: { 'order-id': o.id || '' } }
                    ].concat(scope.stageMenuItem(o));
                    if (scope.stageKey(o) === 'done' && can('kernel_dispatch.invoice')) {
                        items.push({ label: 'Undo invoice sent', className: 'js-kd-invoice-undo', dataAttrs: { 'order-id': o.id || '' } });
                    }
                    items.push({ label: 'Undo truck loaded', className: 'js-edit-dispatched-basket', dataAttrs: { 'order-id': o.id || '' } });
                    var actions = MacTableActions.render({ id: 'kdDispatchedActions' + (o.id || ''), items: items });
                    dispatchedTbody.append('<tr><td><strong>' + buyer + '</strong><div class="kd-step-of">' + lineCount + ' line' + (lineCount === 1 ? '' : 's') + '</div></td><td>' + collectionStr + '</td><td class="text-end">' + _common.formatKg(totalKg) + ' kg</td>' + scope.stepCells(o) + '<td>' + scope.waitingOn(o) + '</td><td class="mac-table-actions-col">' + actions + '</td></tr>');
                });
            }
            MacTableActions.init(document.getElementById('kernelDispatchTable'));
            MacTableActions.init(document.getElementById('kernelDispatchedTable'));
        },

        toggleView: (view) => {
            const scope = _kernelDispatchGrid;
            scope.currentView = view;
            var board = document.getElementById('kdKanbanBoard');
            var tables = document.getElementById('kdTableCards');
            if (view === 'kanban') {
                if (board) board.style.display = '';
                if (tables) tables.style.display = 'none';
                scope.renderKanban();
            } else {
                if (board) board.style.display = 'none';
                if (tables) tables.style.display = '';
                scope.render();
            }
            $('#kdViewKanban').toggleClass('active', view === 'kanban');
            $('#kdViewTable').toggleClass('active', view === 'table');
        },

        renderKanban: () => {
            const scope = _kernelDispatchGrid;
            if (typeof KanbanHelper === 'undefined') return;
            scope.updateFilterEmptyBanner();
            scope.renderStageChips();

            KanbanHelper.render('kdKanbanBoard', DISPATCH_KANBAN_COLUMNS, scope.visibleOrders(), function (o) {
                return o.status === 'dispatched' ? 'dispatched' : 'confirmed';
            }, function (o) {
                var esc = KanbanHelper._esc;
                var buyer = esc(o.buyer_name || '—');
                var collectionStr = formatDate(o.planned_collection_date || o.delivery_date);
                var lineCount = o.line_count != null ? o.line_count : 0;
                var totalKg = o.total_kg != null ? _common.formatKg(o.total_kg) : '0.00';
                var isDispatched = o.status === 'dispatched';
                var key = scope.stageKey(o);

                var html = '<div class="kanban-card" data-order-id="' + (o.id || '') + '">';
                html += '<div class="kanban-card-title">' + buyer + '</div>';
                html += scope.stageBadge(o);
                html += '<div class="kanban-card-meta">';
                if (collectionStr) html += '<div class="kanban-card-meta-item"><i class="fas fa-calendar-plus"></i> Collect ' + esc(collectionStr) + '</div>';
                html += '<div class="kanban-card-meta-item"><i class="fas fa-list"></i> ' + lineCount + ' lines</div>';
                html += '<div class="kanban-card-meta-item"><i class="fas fa-weight-hanging"></i> ' + totalKg + ' kg</div>';
                html += '<div class="kanban-card-meta-item"><i class="fas fa-hourglass-half"></i> Waiting on: ' + scope.waitingOn(o) + '</div>';
                html += '</div>';
                html += '<div class="kanban-card-actions">';
                html += scope.stageButton(o);
                html += '<button type="button" class="btn btn-sm btn-outline-primary js-view-dispatch-order" data-order-id="' + (o.id || '') + '" title="View dispatch sheet"><i class="fas fa-clipboard-list me-1"></i>View</button>';
                if (!isDispatched) {
                    html += '<button type="button" class="btn btn-sm btn-outline-secondary js-edit-dispatch-order me-1" data-order-id="' + (o.id || '') + '">Edit</button>';
                    if (key === 'truck' || key === 'legacy') html += '<button type="button" class="btn btn-sm btn-primary js-dispatch-order" data-order-id="' + (o.id || '') + '"><i class="fas fa-truck me-1"></i>Truck loaded</button>';
                } else {
                    html += '<button type="button" class="btn btn-sm btn-outline-secondary js-edit-dispatched-basket me-1" data-order-id="' + (o.id || '') + '" title="Undo truck loaded: unlock the basket (clears the truck paperwork)">Undo truck</button>';
                }
                html += '</div>';
                html += '</div>';
                return html;
            });

            // Drag-and-drop: confirmed → dispatched only
            KanbanHelper.enableDragDrop('kdKanbanBoard', function (orderId, fromKey, toKey) {
                if (fromKey === 'confirmed' && toKey === 'dispatched') {
                    // openDispatch refuses until the pricing is confirmed.
                    scope.openDispatch(orderId);
                }
                // backward (dispatched → confirmed) is silently ignored
            });
        }
    };
}();

_kernelDispatchGrid.init();
