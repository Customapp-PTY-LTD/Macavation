/**
 * Kernel Dispatch - INV from KERNEL R YES → KERNEL CUSTOMERS → DEBTORS.
 * Lists dispatch orders (baskets) created from Stock (Kernel). View basket shows styles per batch.
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
                    if (id && typeof _modal_kernel_dispatch !== 'undefined' && _modal_kernel_dispatch.showOrder) {
                        _modal_kernel_dispatch.showOrder(id);
                    }
                });
                $(document).on('click', '.js-dispatch-order', function () {
                    var id = $(this).data('order-id');
                    if (id && typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.show) {
                        _modal_kernel_dispatch_form.show(id);
                    }
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
            }).catch(function (err) {
                console.error('[Kernel Dispatch] Error loading modal:', err);
                if (typeof _modal_kernel_dispatch !== 'undefined' && _modal_kernel_dispatch.init) _modal_kernel_dispatch.init();
                if (typeof _modal_kernel_dispatch_form !== 'undefined' && _modal_kernel_dispatch_form.init) _modal_kernel_dispatch_form.init();
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
                    var statusBadge = '<span class="badge bg-info">' + (o.status || 'confirmed') + '</span>';
                    var viewBtn = '<button type="button" class="btn btn-sm btn-outline-primary js-view-dispatch-order me-1" data-order-id="' + (o.id || '') + '"><i class="fas fa-box me-1"></i>View basket</button>';
                    var dispatchBtn = '<button type="button" class="btn btn-sm btn-success js-dispatch-order" data-order-id="' + (o.id || '') + '"><i class="fas fa-truck me-1"></i>Dispatch</button>';
                    pendingTbody.append('<tr><td>' + buyer + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + totalKg.toFixed(1) + '</td><td>' + statusBadge + ' ' + viewBtn + dispatchBtn + '</td></tr>');
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
                    var statusBadge = '<span class="badge bg-success">dispatched</span>';
                    var viewBtn = '<button type="button" class="btn btn-sm btn-outline-primary js-view-dispatch-order" data-order-id="' + (o.id || '') + '"><i class="fas fa-box me-1"></i>View basket</button>';
                    dispatchedTbody.append('<tr><td>' + buyer + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + totalKg.toFixed(1) + '</td><td>' + statusBadge + ' ' + viewBtn + '</td></tr>');
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
                html += '<button type="button" class="btn btn-sm btn-outline-primary js-view-dispatch-order" data-order-id="' + (o.id || '') + '"><i class="fas fa-box me-1"></i>View</button>';
                if (!isDispatched) {
                    html += '<button type="button" class="btn btn-sm btn-success js-dispatch-order" data-order-id="' + (o.id || '') + '"><i class="fas fa-truck me-1"></i>Dispatch</button>';
                }
                html += '</div>';
                html += '</div>';
                return html;
            });
        }
    };
}();

_kernelDispatchGrid.init();
