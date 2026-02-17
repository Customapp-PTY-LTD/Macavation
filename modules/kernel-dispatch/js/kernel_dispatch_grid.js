/**
 * Kernel Dispatch - INV from KERNEL R YES → KERNEL CUSTOMERS → DEBTORS.
 * Lists batches in_finished_stock; modal (dispatch batch) owned by modal-kernel-dispatch.
 */
var _kernelDispatchGrid = function () {
    'use strict';

    return {
        batches: [],
        _handlersBound: false,

        init: async () => {
            const scope = _kernelDispatchGrid;
            $('#kernelDispatchRefreshBtn').off('click').on('click', function () { scope.loadBatches(true); });
            if (!scope._handlersBound) {
                scope._handlersBound = true;
                $(document).on('click', '.js-dispatch-batch', function () {
                    var id = $(this).data('batch-id');
                    if (id && typeof _modal_kernel_dispatch !== 'undefined' && _modal_kernel_dispatch.show) {
                        _modal_kernel_dispatch.show(id);
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
            }).catch(function (err) {
                console.error('[Kernel Dispatch] Error loading modal:', err);
                if (typeof _modal_kernel_dispatch !== 'undefined' && _modal_kernel_dispatch.init) _modal_kernel_dispatch.init();
            });
            await scope.loadBatches();
        },

        loadBatches: async (forceRefresh) => {
            const scope = _kernelDispatchGrid;
            try {
                if (typeof dataFunctions === 'undefined' || !dataFunctions.getProductionBatches) {
                    scope.batches = [];
                    scope.render();
                    return;
                }
                let all = await dataFunctions.getProductionBatches(null, forceRefresh, { batch_type: 'kernel' });
                all = all || [];
                scope.batches = all.filter((b) => b.status === 'in_finished_stock');
                scope.render();
            } catch (e) {
                console.error('[Kernel Dispatch] loadBatches failed:', e);
                scope.batches = [];
                scope.render();
            }
        },

        render: () => {
            const scope = _kernelDispatchGrid;
            const tbody = $('#kernelDispatchTableBody');
            tbody.empty();
            if (!scope.batches.length) {
                tbody.html('<tr><td colspan="5" class="text-center text-muted py-4">No batches ready to dispatch. Complete production (step 17) to move batches to finished stock.</td></tr>');
                return;
            }
            const formatDate = (typeof _common !== 'undefined' && _common.formatDateDDMMYYYY) ? _common.formatDateDDMMYYYY : (v) => v || '';
            scope.batches.forEach((b) => {
                const dateStr = formatDate(b.received_date) || (b.received_date || '');
                tbody.append('<tr><td>' + (b.batch_number || '') + '</td><td>' + (b.grower_name || '') + '</td><td>' + dateStr + '</td><td>' + (b.wet_nis_received_kg || '') + '</td><td><button type="button" class="btn btn-sm btn-success js-dispatch-batch" data-batch-id="' + b.id + '"><i class="fas fa-truck me-1"></i>Dispatch</button></td></tr>');
            });
        }
    };
}();

_kernelDispatchGrid.init();
