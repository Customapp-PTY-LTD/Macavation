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

    return {
        orders: [],
        _handlersBound: false,
        currentView: 'kanban',
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
            $('#kernelDispatchRefreshBtn').off('click').on('click', function () { scope.loadOrders(true); });

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
                    var id = $(this).data('order-id');
                    if (id && typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.show) {
                        _modal_kernel_dispatch_form.show(id);
                    }
                });
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
            }).catch(function (err) {
                console.error('[Kernel Dispatch] Error loading modal:', err);
                if (typeof _modal_kernel_dispatch !== 'undefined' && _modal_kernel_dispatch.init) _modal_kernel_dispatch.init();
                if (typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.init) _modal_kernel_dispatch_form.init();
                if (typeof _modal_kernel_dispatch_edit !== 'undefined' && _modal_kernel_dispatch_edit.init) _modal_kernel_dispatch_edit.init();
            });
            await scope.loadOrders();
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
                scope.orders = await dataFunctions.getKernelDispatchOrders(null, forceRefresh, filters) || [];
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
            if (scope.currentView === 'kanban') {
                scope.renderKanban();
                return;
            }
            var pending = scope.orders.filter(function (o) { return o.status !== 'dispatched'; });
            var dispatched = scope.orders.filter(function (o) { return o.status === 'dispatched'; });

            var pendingTbody = $('#kernelDispatchTableBody');
            pendingTbody.empty();
            if (!pending.length) {
                var pendingMsg = scope.listFiltersActive()
                    ? 'No baskets match your search in <strong>Ready to dispatch</strong>. Try buyer name, batch #, or supplier received date, or clear search.'
                    : 'No orders ready to dispatch. Go to Stock (Kernel), select styles for batches, then Send to Dispatch to create an order.';
                pendingTbody.html('<tr><td colspan="6" class="text-center text-muted py-4">' + pendingMsg + '</td></tr>');
            } else {
                pending.forEach(function (o) {
                    var buyer = (o.buyer_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '—';
                    var deliveryStr = formatDate(o.delivery_date);
                    var createdStr = formatDate(o.created_at);
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var statusBadge = KanbanHelper.statusBadge(o.status || 'confirmed', 'first');
                    var actions = MacTableActions.render({
                        id: 'kdPendingActions' + (o.id || ''),
                        items: [
                            { label: 'View sheet', className: 'js-view-dispatch-order', icon: 'fas fa-clipboard-list', dataAttrs: { 'order-id': o.id || '' } },
                            { label: 'Edit', className: 'js-edit-dispatch-order', dataAttrs: { 'order-id': o.id || '' } },
                            { label: 'Dispatch', className: 'js-dispatch-order', icon: 'fas fa-truck', dataAttrs: { 'order-id': o.id || '' } }
                        ]
                    });
                    pendingTbody.append('<tr><td>' + buyer + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + totalKg.toFixed(1) + '</td><td class="mac-table-actions-col">' + statusBadge + ' ' + actions + '</td></tr>');
                });
            }

            var dispatchedTbody = $('#kernelDispatchedTableBody');
            dispatchedTbody.empty();
            if (!dispatched.length) {
                var dispMsg = scope.listFiltersActive()
                    ? 'No baskets match your search in <strong>Dispatched</strong>. Adjust search or clear it.'
                    : 'No baskets marked as dispatched yet. Use the Dispatch button above to complete an order.';
                dispatchedTbody.html('<tr><td colspan="6" class="text-center text-muted py-4">' + dispMsg + '</td></tr>');
            } else {
                dispatched.forEach(function (o) {
                    var buyer = (o.buyer_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '—';
                    var deliveryStr = formatDate(o.delivery_date);
                    var createdStr = formatDate(o.created_at);
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var statusBadge = KanbanHelper.statusBadge('dispatched', 'last');
                    var actions = MacTableActions.render({
                        id: 'kdDispatchedActions' + (o.id || ''),
                        items: [
                            { label: 'Edit', className: 'js-edit-dispatched-basket', dataAttrs: { 'order-id': o.id || '' } },
                            { label: 'View sheet', className: 'js-view-dispatch-order', icon: 'fas fa-clipboard-list', dataAttrs: { 'order-id': o.id || '' } }
                        ]
                    });
                    dispatchedTbody.append('<tr><td>' + buyer + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + totalKg.toFixed(1) + '</td><td class="mac-table-actions-col">' + statusBadge + ' ' + actions + '</td></tr>');
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

            KanbanHelper.render('kdKanbanBoard', DISPATCH_KANBAN_COLUMNS, scope.orders, function (o) {
                return o.status === 'dispatched' ? 'dispatched' : 'confirmed';
            }, function (o) {
                var esc = KanbanHelper._esc;
                var buyer = esc(o.buyer_name || '—');
                var deliveryStr = formatDate(o.delivery_date);
                var createdStr = formatDate(o.created_at);
                var lineCount = o.line_count != null ? o.line_count : 0;
                var totalKg = o.total_kg != null ? Number(o.total_kg).toFixed(1) : '0.0';
                var isDispatched = o.status === 'dispatched';

                var html = '<div class="kanban-card" data-order-id="' + (o.id || '') + '">';
                html += '<div class="kanban-card-title">' + buyer + '</div>';
                html += '<div class="kanban-card-meta">';
                if (deliveryStr) html += '<div class="kanban-card-meta-item"><i class="fas fa-calendar"></i> ' + esc(deliveryStr) + '</div>';
                html += '<div class="kanban-card-meta-item"><i class="fas fa-list"></i> ' + lineCount + ' lines</div>';
                html += '<div class="kanban-card-meta-item"><i class="fas fa-weight-hanging"></i> ' + totalKg + ' kg</div>';
                html += '</div>';
                html += '<div class="kanban-card-actions">';
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
                    if (typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.show) {
                        _modal_kernel_dispatch_form.show(orderId);
                    }
                }
                // backward (dispatched → confirmed) is silently ignored
            });
        }
    };
}();

_kernelDispatchGrid.init();
