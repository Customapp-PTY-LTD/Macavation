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

        init: async () => {
            const scope = _kernelDispatchGrid;
            $('#kernelDispatchRefreshBtn').off('click').on('click', function () { scope.loadOrders(true); });
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
                scope.orders = await dataFunctions.getKernelDispatchOrders(null, forceRefresh) || [];
                scope.render();
            } catch (e) {
                console.error('[Kernel Dispatch] loadOrders failed:', e);
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
            if (scope.currentView === 'kanban') {
                scope.renderKanban();
                return;
            }
            var pending = scope.orders.filter(function (o) { return o.status !== 'dispatched'; });
            var dispatched = scope.orders.filter(function (o) { return o.status === 'dispatched'; });

            var pendingTbody = $('#kernelDispatchTableBody');
            pendingTbody.empty();
            if (!pending.length) {
                pendingTbody.html('<tr><td colspan="6" class="text-center text-muted py-4">No orders ready to dispatch. Go to Stock (Kernel), select styles for batches, then Send to Dispatch to create an order.</td></tr>');
            } else {
                pending.forEach(function (o) {
                    var buyer = (o.buyer_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '—';
                    var deliveryStr = formatDate(o.delivery_date);
                    var createdStr = formatDate(o.created_at);
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var statusBadge = KanbanHelper.statusBadge(o.status || 'confirmed', 'first');
                    var viewBtn = '<button type="button" class="btn btn-sm btn-outline-primary js-view-dispatch-order me-1" data-order-id="' + (o.id || '') + '" title="View dispatch sheet and basket"><i class="fas fa-clipboard-list me-1"></i>View sheet</button>';
                    var editBtn = '<button type="button" class="btn btn-sm btn-outline-secondary js-edit-dispatch-order me-1" data-order-id="' + (o.id || '') + '">Edit</button>';
                    var dispatchBtn = '<button type="button" class="btn btn-sm btn-success js-dispatch-order" data-order-id="' + (o.id || '') + '"><i class="fas fa-truck me-1"></i>Dispatch</button>';
                    pendingTbody.append('<tr><td>' + buyer + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + totalKg.toFixed(1) + '</td><td class="text-nowrap">' + statusBadge + ' ' + viewBtn + editBtn + dispatchBtn + '</td></tr>');
                });
            }

            var dispatchedTbody = $('#kernelDispatchedTableBody');
            dispatchedTbody.empty();
            if (!dispatched.length) {
                dispatchedTbody.html('<tr><td colspan="6" class="text-center text-muted py-4">No baskets marked as dispatched yet. Use the Dispatch button above to complete an order.</td></tr>');
            } else {
                dispatched.forEach(function (o) {
                    var buyer = (o.buyer_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '—';
                    var deliveryStr = formatDate(o.delivery_date);
                    var createdStr = formatDate(o.created_at);
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var statusBadge = KanbanHelper.statusBadge('dispatched', 'last');
                    var viewBtn = '<button type="button" class="btn btn-sm btn-outline-primary js-view-dispatch-order" data-order-id="' + (o.id || '') + '" title="View dispatch sheet and basket"><i class="fas fa-clipboard-list me-1"></i>View sheet</button>';
                    var editDispatchedBtn = '<button type="button" class="btn btn-sm btn-outline-secondary js-edit-dispatched-basket me-1" data-order-id="' + (o.id || '') + '" title="Edit: unlock basket (clears dispatch paperwork, returns to ready to dispatch)">Edit</button>';
                    dispatchedTbody.append('<tr><td>' + buyer + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + totalKg.toFixed(1) + '</td><td>' + statusBadge + ' ' + editDispatchedBtn + ' ' + viewBtn + '</td></tr>');
                });
            }
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
                    html += '<button type="button" class="btn btn-sm btn-success js-dispatch-order" data-order-id="' + (o.id || '') + '"><i class="fas fa-truck me-1"></i>Dispatch</button>';
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
