/**
 * Silos & storage menu item. It opens the Silos screen (silo-allocation-grid).
 *
 * The old "Storage areas" tab was retired on 2 Nov 2026 (migration 20261102120000): storage areas,
 * placing and moving bags, recent moves and their history now live on Grower Intake, and area
 * capacity is set in Kernel Pipeline Settings > Plant. The route is kept because it is the sidebar
 * item and the role feature key (nis-storage).
 */
var _nisStorage = (function () {
    'use strict';

    function init() {
        var h = (typeof _appRouter !== 'undefined' && _appRouter.takeHandoff) ? _appRouter.takeHandoff('nis-storage') : null;
        // Old links ({ tab: 'areas' } / { place: true }) go to the storage list on Grower Intake.
        if (h && (h.tab === 'areas' || h.place) && _appRouter.openWith) {
            _appRouter.openWith('grower-intake-grid', { placeBags: !!h.place, storage: true });
            return;
        }
        _appRouter.routeTo('silo-allocation-grid', true);
    }

    return { init: init };
})();
window._nisStorage = _nisStorage;
