/**
 * Kernel Dispatch - INV from KERNEL R YES → KERNEL CUSTOMERS → DEBTORS.
 * Lists dispatch orders (baskets) created from Stock (Kernel). View sheet opens the full dispatch form with lines and record.
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
        { key: 'confirmed', label: 'Ready to Dispatch' },
        { key: 'dispatched', label: 'Dispatched' }
    ];

    var can = function (key) { return typeof window.hasAction === 'function' && !!window.hasAction(key); };
    var escHtml = function (v) { return (typeof _common !== 'undefined' && _common.escapeHtml) ? _common.escapeHtml(v) : String(v == null ? '' : v).replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

    return {
        orders: [],
        /** Approval-workflow state by order id: { workflow_stage, picked_by_label, has_pick_changes }. Legacy orders have no entry. */
        stages: {},
        _handlersBound: false,
        currentView: 'kanban',
        /** Stage filter chip: 'all' | 'picking' | 'approval' | 'approved' | 'legacy'. */
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
            scope.stageFilter = (handoff && ['picking', 'approval', 'approved', 'legacy'].indexOf(handoff.stage) >= 0) ? handoff.stage : 'all';
            scope._pendingOpenOrderId = (handoff && handoff.openOrderId) || null;
            $('#kdStageChips').off('click.kdStage').on('click.kdStage', '[data-stage]', function () {
                scope.stageFilter = String($(this).data('stage'));
                scope.render();
            });
            $('#kernelDispatchRefreshBtn').off('click').on('click', function () { scope.loadOrders(true); });
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

        /** Stage key for filtering: picking | approval | approved | legacy (no workflow stage). */
        stageKey: function (o) {
            var st = this.stageOf(o);
            return (st === 'picking' || st === 'approval' || st === 'approved') ? st : 'legacy';
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
            if (key === 'picking') return 'Production Manager';
            if (key === 'approval') return 'Sales Exec' + (info.has_pick_changes ? ' <span class="text-muted">&middot; lines changed</span>' : '');
            if (key === 'approved') return '<span class="text-muted">Nobody &middot; sale recorded</span>';
            return '<span class="text-muted">Before approvals started</span>';
        },

        renderStageChips: function () {
            var scope = this;
            var counts = { all: scope.orders.length, picking: 0, approval: 0, approved: 0, legacy: 0 };
            scope.orders.forEach(function (o) { counts[scope.stageKey(o)]++; });
            var defs = [
                ['all', 'All', 'kd-chip-all'],
                ['picking', 'Picking', 'kd-chip-picking'],
                ['approval', 'Waiting for approval', 'kd-chip-approval'],
                ['approved', 'Approved', 'kd-chip-approved'],
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
                approval: ['Waiting for Pete', 'bg-info text-dark'],
                approved: ['Approved – sale recorded', 'bg-success']
            };
            var m = map[stage];
            if (!m) return '';
            var html = '<div class="mt-1"><span class="badge ' + m[1] + '">' + escHtml(m[0]) + '</span>';
            if (stage === 'approval' && info.has_pick_changes) html += ' <span class="badge bg-warning text-dark" title="The picker changed some cartons">changed</span>';
            return html + '</div>';
        },

        /** { label, icon } of the workflow button for this row, or null (legacy orders). */
        stageAction: function (o) {
            var stage = this.stageOf(o);
            if (!stage) return null;
            if (stage === 'picking' && can('kernel_dispatch.pick')) return { label: 'Confirm picking', icon: 'fas fa-clipboard-check' };
            if ((stage === 'approval' || stage === 'approved') && can('kernel_dispatch.approve')) {
                return stage === 'approved' ? { label: 'View sale', icon: 'fas fa-receipt' } : { label: 'Price & approve', icon: 'fas fa-tags' };
            }
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

        /** Dispatch form, after a heads-up when Pete has not approved (and so no sale is recorded). Never blocks. */
        openDispatch: function (id) {
            if (!id || typeof _modal_kernel_dispatch_form === 'undefined' || !_modal_kernel_dispatch_form.show) return;
            var stage = this.stageOf({ id: id });
            if ((stage === 'picking' || stage === 'approval') && typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Not approved yet',
                    text: 'Pete has not approved this dispatch yet, so it is not recorded as a sale. Dispatch anyway?',
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Continue',
                    cancelButtonText: 'Cancel',
                    focusCancel: true
                }).then(function (res) { if (res.isConfirmed) _modal_kernel_dispatch_form.show(id); });
                return;
            }
            _modal_kernel_dispatch_form.show(id);
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
            var pending = shown.filter(function (o) { return o.status !== 'dispatched'; });
            var dispatched = shown.filter(function (o) { return o.status === 'dispatched'; });

            var pendingTbody = $('#kernelDispatchTableBody');
            pendingTbody.empty();
            if (!pending.length) {
                var pendingMsg = scope.listFiltersActive()
                    ? 'No baskets match your search in <strong>Ready to dispatch</strong>. Try buyer name, batch #, or supplier received date, or clear search.'
                    : 'No orders ready to dispatch. Go to Stock (Kernel), select styles for batches, then Send to Dispatch to create an order.';
                pendingTbody.html('<tr><td colspan="9" class="text-center text-muted py-4">' + pendingMsg + '</td></tr>');
            } else {
                pending.forEach(function (o) {
                    var buyer = (o.buyer_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '—';
                    var deliveryStr = formatDate(o.delivery_date);
                    var collectionStr = formatDate(o.planned_collection_date) || '—';
                    var createdStr = formatDate(o.created_at);
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var statusBadge = KanbanHelper.statusBadge(o.status || 'confirmed', 'first') + scope.stageBadge(o);
                    var actions = MacTableActions.render({
                        id: 'kdPendingActions' + (o.id || ''),
                        items: [
                            { label: 'View sheet', className: 'js-view-dispatch-order', icon: 'fas fa-clipboard-list', dataAttrs: { 'order-id': o.id || '' } }
                        ].concat(scope.stageMenuItem(o), [
                            { label: 'Edit', className: 'js-edit-dispatch-order', dataAttrs: { 'order-id': o.id || '' } },
                            { label: 'Dispatch', className: 'js-dispatch-order', icon: 'fas fa-truck', dataAttrs: { 'order-id': o.id || '' } }
                        ])
                    });
                    pendingTbody.append('<tr><td>' + buyer + '</td><td>' + collectionStr + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + _common.formatKg(totalKg) + ' kg</td><td>' + statusBadge + '</td><td>' + scope.waitingOn(o) + '</td><td class="mac-table-actions-col">' + actions + '</td></tr>');
                });
            }

            var dispatchedTbody = $('#kernelDispatchedTableBody');
            dispatchedTbody.empty();
            if (!dispatched.length) {
                var dispMsg = scope.listFiltersActive()
                    ? 'No baskets match your search in <strong>Dispatched</strong>. Adjust search or clear it.'
                    : 'No baskets marked as dispatched yet. Use the Dispatch button above to complete an order.';
                dispatchedTbody.html('<tr><td colspan="9" class="text-center text-muted py-4">' + dispMsg + '</td></tr>');
            } else {
                dispatched.forEach(function (o) {
                    var buyer = (o.buyer_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '—';
                    var deliveryStr = formatDate(o.delivery_date);
                    var collectionStr = formatDate(o.planned_collection_date) || '—';
                    var createdStr = formatDate(o.created_at);
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var statusBadge = KanbanHelper.statusBadge('dispatched', 'last') + scope.stageBadge(o);
                    var actions = MacTableActions.render({
                        id: 'kdDispatchedActions' + (o.id || ''),
                        items: [
                            { label: 'Edit', className: 'js-edit-dispatched-basket', dataAttrs: { 'order-id': o.id || '' } },
                            { label: 'View sheet', className: 'js-view-dispatch-order', icon: 'fas fa-clipboard-list', dataAttrs: { 'order-id': o.id || '' } }
                        ].concat(scope.stageMenuItem(o))
                    });
                    dispatchedTbody.append('<tr><td>' + buyer + '</td><td>' + collectionStr + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + _common.formatKg(totalKg) + ' kg</td><td>' + statusBadge + '</td><td>' + scope.waitingOn(o) + '</td><td class="mac-table-actions-col">' + actions + '</td></tr>');
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
                var deliveryStr = formatDate(o.delivery_date);
                var collectionStr = formatDate(o.planned_collection_date);
                var createdStr = formatDate(o.created_at);
                var lineCount = o.line_count != null ? o.line_count : 0;
                var totalKg = o.total_kg != null ? _common.formatKg(o.total_kg) : '0.00';
                var isDispatched = o.status === 'dispatched';

                var html = '<div class="kanban-card" data-order-id="' + (o.id || '') + '">';
                html += '<div class="kanban-card-title">' + buyer + '</div>';
                html += scope.stageBadge(o);
                html += '<div class="kanban-card-meta">';
                if (collectionStr) html += '<div class="kanban-card-meta-item"><i class="fas fa-calendar-plus"></i> Collect ' + esc(collectionStr) + '</div>';
                if (deliveryStr) html += '<div class="kanban-card-meta-item"><i class="fas fa-calendar"></i> Deliver ' + esc(deliveryStr) + '</div>';
                html += '<div class="kanban-card-meta-item"><i class="fas fa-list"></i> ' + lineCount + ' lines</div>';
                html += '<div class="kanban-card-meta-item"><i class="fas fa-weight-hanging"></i> ' + totalKg + ' kg</div>';
                html += '<div class="kanban-card-meta-item"><i class="fas fa-hourglass-half"></i> Waiting on: ' + scope.waitingOn(o) + '</div>';
                html += '</div>';
                html += '<div class="kanban-card-actions">';
                html += scope.stageButton(o);
                html += '<button type="button" class="btn btn-sm btn-outline-primary js-view-dispatch-order" data-order-id="' + (o.id || '') + '" title="View dispatch sheet"><i class="fas fa-clipboard-list me-1"></i>View</button>';
                if (!isDispatched) {
                    html += '<button type="button" class="btn btn-sm btn-outline-secondary js-edit-dispatch-order me-1" data-order-id="' + (o.id || '') + '">Edit</button>';
                    html += '<button type="button" class="btn btn-sm btn-primary js-dispatch-order" data-order-id="' + (o.id || '') + '"><i class="fas fa-truck me-1"></i>Dispatch</button>';
                } else {
                    html += '<button type="button" class="btn btn-sm btn-outline-secondary js-edit-dispatched-basket me-1" data-order-id="' + (o.id || '') + '" title="Edit: unlock basket (clears dispatch paperwork)">Edit</button>';
                }
                html += '</div>';
                html += '</div>';
                return html;
            });

            // Drag-and-drop: confirmed → dispatched only
            KanbanHelper.enableDragDrop('kdKanbanBoard', function (orderId, fromKey, toKey) {
                if (fromKey === 'confirmed' && toKey === 'dispatched') {
                    scope.openDispatch(orderId);
                }
                // backward (dispatched → confirmed) is silently ignored
            });
        }
    };
}();

_kernelDispatchGrid.init();
