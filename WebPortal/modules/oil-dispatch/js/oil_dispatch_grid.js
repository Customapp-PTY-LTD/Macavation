/**
 * Oil & Protein Dispatch - INV from OIL PROTEIN R YES → FEED+OIL+PROTEIN CUSTOMERS → DEBTORS.
 * Lists dispatch orders (baskets) created from Stock (Oil). View basket shows products/lines per order.
 * Mirrors Kernel Dispatch: same layout, flow, Board/Table, Kanban, View sheet + Dispatch.
 */
var _oilDispatchGrid = function () {
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
        dispatchListFilters: { buyer: '', deliveryDate: '' },

        init: async () => {
            const scope = _oilDispatchGrid;
            $('#oilDispatchRefreshBtn').off('click').on('click', function () { scope.loadOrders(true); });
            $('#odViewKanban, #odViewTable').off('click').on('click', function () {
                scope.toggleView($(this).data('view'));
            });
            $('#odFilterBuyer').off('input.odFilter').on('input.odFilter', function () {
                scope.dispatchListFilters.buyer = ($(this).val() || '').trim();
                scope.render();
            });
            $('#odFilterDeliveryDate').off('change.odFilter input.odFilter').on('change.odFilter input.odFilter', function () {
                scope.dispatchListFilters.deliveryDate = ($(this).val() || '').trim();
                scope.render();
            });
            $('#odFilterClear').off('click').on('click', function () {
                scope.dispatchListFilters.buyer = '';
                scope.dispatchListFilters.deliveryDate = '';
                $('#odFilterBuyer').val('');
                $('#odFilterDeliveryDate').val('');
                scope.render();
            });
            if (!scope._handlersBound) {
                scope._handlersBound = true;
                $(document).on('click', '.js-view-oil-dispatch-order', function () {
                    var id = $(this).data('order-id');
                    if (id && typeof _modal_oil_dispatch_form !== 'undefined' && _modal_oil_dispatch_form.show) {
                        _modal_oil_dispatch_form.show(id);
                    }
                });
                $(document).on('click', '.js-dispatch-oil-order', function () {
                    var id = $(this).data('order-id');
                    if (id && typeof _modal_oil_dispatch_form !== 'undefined' && _modal_oil_dispatch_form.show) {
                        _modal_oil_dispatch_form.show(id);
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
                if (typeof _modal_oil_dispatch !== 'undefined' && _modal_oil_dispatch.init) _modal_oil_dispatch.init();
                if (typeof _modal_oil_dispatch_form !== 'undefined' && _modal_oil_dispatch_form.init) _modal_oil_dispatch_form.init();
            }).catch(function (err) {
                console.error('[Oil Dispatch] Error loading modal:', err);
                if (typeof _modal_oil_dispatch !== 'undefined' && _modal_oil_dispatch.init) _modal_oil_dispatch.init();
                if (typeof _modal_oil_dispatch_form !== 'undefined' && _modal_oil_dispatch_form.init) _modal_oil_dispatch_form.init();
            });
            await scope.loadOrders();
        },

        loadOrders: async (forceRefresh) => {
            const scope = _oilDispatchGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getOilDispatchOrders) {
                    scope.orders = [];
                    scope.render();
                    return;
                }
                scope.orders = await dataFunctions.getOilDispatchOrders(null, forceRefresh) || [];
                scope.render();
            } catch (e) {
                console.error('[Oil Dispatch] loadOrders failed:', e);
                scope.orders = [];
                scope.render();
            }
        },

        filteredOrders: () => {
            const scope = _oilDispatchGrid;
            var buyer = (scope.dispatchListFilters.buyer || '').toLowerCase();
            var deliveryDate = scope.dispatchListFilters.deliveryDate || '';
            return scope.orders.filter(function (o) {
                if (buyer && (o.buyer_name || '').toLowerCase().indexOf(buyer) === -1) return false;
                if (deliveryDate && String(o.delivery_date || '').slice(0, 10) !== deliveryDate) return false;
                return true;
            });
        },

        render: () => {
            const scope = _oilDispatchGrid;
            if (scope.currentView === 'kanban') {
                scope.renderKanban();
                return;
            }
            var orders = scope.filteredOrders();
            var pending = orders.filter(function (o) { return o.status !== 'dispatched'; });
            var dispatched = orders.filter(function (o) { return o.status === 'dispatched'; });

            var pendingTbody = $('#oilDispatchTableBody');
            pendingTbody.empty();
            if (!pending.length) {
                pendingTbody.html('<tr><td colspan="6" class="text-center text-muted py-4">No orders ready to dispatch. Go to Stock (Oil &amp; Protein), select products/lots, then Send to Dispatch to create an order.</td></tr>');
            } else {
                pending.forEach(function (o) {
                    var buyer = (o.buyer_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') || '—';
                    var deliveryStr = formatDate(o.delivery_date);
                    var createdStr = formatDate(o.created_at);
                    var lineCount = o.line_count != null ? o.line_count : 0;
                    var totalKg = o.total_kg != null ? Number(o.total_kg) : 0;
                    var statusBadge = typeof KanbanHelper !== 'undefined' ? KanbanHelper.statusBadge(o.status || 'confirmed', 'first') : '<span class="badge bg-secondary">' + (o.status || 'confirmed') + '</span>';
                    var actions = MacTableActions.render({
                        id: 'odPendingActions' + (o.id || ''),
                        items: [
                            { label: 'View sheet', className: 'js-view-oil-dispatch-order', icon: 'fas fa-clipboard-list', dataAttrs: { 'order-id': o.id || '' } },
                            { label: 'Dispatch', className: 'js-dispatch-oil-order', icon: 'fas fa-truck', dataAttrs: { 'order-id': o.id || '' } }
                        ]
                    });
                    pendingTbody.append('<tr><td>' + buyer + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + totalKg.toFixed(1) + '</td><td class="mac-table-actions-col">' + statusBadge + ' ' + actions + '</td></tr>');
                });
            }

            var dispatchedTbody = $('#oilDispatchedTableBody');
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
                    var statusBadge = typeof KanbanHelper !== 'undefined' ? KanbanHelper.statusBadge('dispatched', 'last') : '<span class="badge bg-success">dispatched</span>';
                    var actions = MacTableActions.render({
                        id: 'odDispatchedActions' + (o.id || ''),
                        items: [
                            { label: 'View sheet', className: 'js-view-oil-dispatch-order', icon: 'fas fa-clipboard-list', dataAttrs: { 'order-id': o.id || '' } }
                        ]
                    });
                    dispatchedTbody.append('<tr><td>' + buyer + '</td><td>' + deliveryStr + '</td><td>' + createdStr + '</td><td class="text-end">' + lineCount + '</td><td class="text-end">' + totalKg.toFixed(1) + '</td><td class="mac-table-actions-col">' + statusBadge + ' ' + actions + '</td></tr>');
                });
            }
            MacTableActions.init(document.getElementById('oilDispatchTable'));
            MacTableActions.init(document.getElementById('oilDispatchedTable'));
        },

        toggleView: (view) => {
            const scope = _oilDispatchGrid;
            scope.currentView = view;
            var board = document.getElementById('odKanbanBoard');
            var tables = document.getElementById('odTableCards');
            if (view === 'kanban') {
                if (board) board.style.display = '';
                if (tables) tables.style.display = 'none';
                scope.renderKanban();
            } else {
                if (board) board.style.display = 'none';
                if (tables) tables.style.display = '';
                scope.render();
            }
            $('#odViewKanban').toggleClass('active', view === 'kanban');
            $('#odViewTable').toggleClass('active', view === 'table');
        },

        renderKanban: () => {
            const scope = _oilDispatchGrid;
            if (typeof KanbanHelper === 'undefined') return;

            KanbanHelper.render('odKanbanBoard', DISPATCH_KANBAN_COLUMNS, scope.filteredOrders(), function (o) {
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
                html += '<button type="button" class="btn btn-sm btn-outline-primary js-view-oil-dispatch-order" data-order-id="' + (o.id || '') + '" title="View dispatch sheet"><i class="fas fa-clipboard-list me-1"></i>View</button>';
                if (!isDispatched) {
                    html += '<button type="button" class="btn btn-sm btn-primary js-dispatch-oil-order" data-order-id="' + (o.id || '') + '" title="Complete inspection and dispatch"><i class="fas fa-truck me-1"></i>Dispatch</button>';
                }
                html += '</div>';
                html += '</div>';
                return html;
            });

            KanbanHelper.enableDragDrop('odKanbanBoard', function (orderId, fromKey, toKey) {
                if (fromKey === 'confirmed' && toKey === 'dispatched') {
                    if (typeof _modal_oil_dispatch_form !== 'undefined' && _modal_oil_dispatch_form.show) {
                        _modal_oil_dispatch_form.show(orderId);
                    }
                }
            });
        }
    };
}();

if (typeof _oilDispatchGrid !== 'undefined') _oilDispatchGrid.init();
