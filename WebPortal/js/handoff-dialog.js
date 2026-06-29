/**
 * Handoff success dialogs with navigation to the next workflow step.
 */
var HandoffDialog = (function () {
    'use strict';

    var STORAGE_KEY = 'macavation_pending_route_context';

    function escapeHtml(s) {
        if (s == null) return '';
        return String(s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function setPendingRouteContext(ctx) {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx || {}));
        } catch (e) { /* ignore */ }
    }

    function consumePendingRouteContext(expectedRoute) {
        try {
            var raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            sessionStorage.removeItem(STORAGE_KEY);
            var ctx = JSON.parse(raw);
            if (expectedRoute && ctx.route && ctx.route !== expectedRoute) {
                sessionStorage.setItem(STORAGE_KEY, raw);
                return null;
            }
            return ctx;
        } catch (e) {
            return null;
        }
    }

    function navigateToRoute(routeName, searchText, searchInputId) {
        setPendingRouteContext({
            route: routeName,
            search: searchText || '',
            searchInputId: searchInputId || null
        });
        if (typeof _appRouter !== 'undefined' && _appRouter.routeTo) {
            _appRouter.routeTo(routeName);
        } else if (typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
            _appRouter.loadContent({ routeName: routeName, elementSelector: _appRouter.contentContainer || '#content-area' });
        }
    }

    function applyPendingSearchForRoute(routeName) {
        var ctx = consumePendingRouteContext(routeName);
        if (!ctx || !ctx.search) return ctx;
        var inputId = ctx.searchInputId;
        function tryApply() {
            if (!inputId) return;
            var el = document.getElementById(inputId);
            if (el) {
                el.value = ctx.search;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
        tryApply();
        setTimeout(tryApply, 300);
        setTimeout(tryApply, 800);
        return ctx;
    }

    /**
     * @param {object} opts
     * @param {string} opts.batchLabel
     * @param {string} opts.statusLabel - e.g. "Awaiting production"
     * @param {string} opts.destinationModule - e.g. "Kernel Production"
     * @param {string} opts.primaryRoute
     * @param {string} opts.primaryLabel
     * @param {string} [opts.searchText]
     * @param {string} [opts.searchInputId]
     * @param {string} [opts.secondaryRoute='batch-journey']
     * @param {string} [opts.secondaryLabel='Find in Batch Journey']
     */
    function show(opts) {
        if (typeof Swal === 'undefined') {
            if (opts.primaryRoute) navigateToRoute(opts.primaryRoute, opts.searchText, opts.searchInputId);
            return Promise.resolve({ isConfirmed: true });
        }
        var batchLabel = escapeHtml(opts.batchLabel || 'Batch');
        var statusLabel = escapeHtml(opts.statusLabel || '');
        var dest = escapeHtml(opts.destinationModule || '');
        var html = '<p class="mb-2">Batch <strong>' + batchLabel + '</strong> moved to <strong>' + dest + '</strong>'
            + (statusLabel ? ' (<span class="text-muted">' + statusLabel + '</span>)' : '') + '.</p>'
            + '<p class="small text-muted mb-0">Use the button below to open the next step, or find the batch later from <strong>Find a batch</strong>.</p>';

        return Swal.fire({
            icon: 'success',
            title: opts.title || 'Done',
            html: html,
            showCancelButton: true,
            confirmButtonText: opts.primaryLabel || 'Open next step',
            cancelButtonText: opts.secondaryLabel || 'Find in Batch Journey',
            reverseButtons: true,
            focusConfirm: true
        }).then(function (res) {
            if (res && res.isConfirmed && opts.primaryRoute) {
                navigateToRoute(opts.primaryRoute, opts.searchText, opts.searchInputId);
            } else if (res && !res.isConfirmed && opts.secondaryRoute !== false) {
                navigateToRoute(opts.secondaryRoute || 'batch-journey', opts.searchText, opts.searchInputId || 'bjSearchInput');
            }
            return res;
        });
    }

    function showKernelReleaseToProduction(batch) {
        var label = (batch && batch.batch_number) ? batch.batch_number : 'Batch';
        var d = typeof BatchStatus !== 'undefined' ? BatchStatus.getDisplayStatus(batch) : { label: 'Awaiting production' };
        var route = typeof BatchStatus !== 'undefined' ? BatchStatus.getKernelRouteForStatus(d) : { route: 'kernel-production-grid', label: 'Open Kernel Production', searchInputId: 'searchBatchesInput' };
        return show({
            batchLabel: label,
            statusLabel: d.label,
            destinationModule: 'Kernel Production',
            primaryRoute: route.route,
            primaryLabel: route.label,
            searchText: label,
            searchInputId: route.searchInputId
        });
    }

    function showKernelReleaseToStock(batch) {
        var label = (batch && batch.batch_number) ? batch.batch_number : 'Batch';
        return show({
            batchLabel: label,
            statusLabel: 'Stock',
            destinationModule: 'Stock (Kernel)',
            primaryRoute: 'stock-management-kernel',
            primaryLabel: 'Open Stock (Kernel)',
            searchText: label,
            searchInputId: null
        });
    }

    function showOilReleaseToProduction(batch) {
        var label = (batch && (batch.batch_number || batch.BatchNumber)) ? (batch.batch_number || batch.BatchNumber) : 'Batch';
        return show({
            batchLabel: label,
            statusLabel: 'In oil production',
            destinationModule: 'Oil Production',
            primaryRoute: 'oil-production-grid',
            primaryLabel: 'Open Oil Production',
            searchText: label,
            searchInputId: 'searchOilProductionInput'
        });
    }

    function showSendToDispatch(stream, batchLabel) {
        var isOil = stream === 'oil';
        return show({
            batchLabel: batchLabel || 'Selection',
            statusLabel: 'Dispatch basket',
            destinationModule: isOil ? 'Oil & Protein Dispatch' : 'Kernel Dispatch',
            primaryRoute: isOil ? 'oil-dispatch-grid' : 'kernel-dispatch-grid',
            primaryLabel: isOil ? 'Open Oil Dispatch' : 'Open Kernel Dispatch',
            searchText: batchLabel || '',
            searchInputId: isOil ? null : 'kdFilterBatch'
        });
    }

    return {
        show: show,
        navigateToRoute: navigateToRoute,
        setPendingRouteContext: setPendingRouteContext,
        consumePendingRouteContext: consumePendingRouteContext,
        applyPendingSearchForRoute: applyPendingSearchForRoute,
        showKernelReleaseToProduction: showKernelReleaseToProduction,
        showKernelReleaseToStock: showKernelReleaseToStock,
        showOilReleaseToProduction: showOilReleaseToProduction,
        showSendToDispatch: showSendToDispatch
    };
})();
