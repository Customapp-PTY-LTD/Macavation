/**
 * MacPriceAccess — may this session see costs, prices and rand values? (MacView round 3)
 *
 * The rule is a Role Features switch, 'see-costs-prices' (migration 20261128110000), on per role in
 * Role Features. super_user and admin always see prices. The server enforces the same rule in the
 * functions that return prices (portal_actor_sees_prices); this is the screen side, so a page can
 * hide a column instead of showing it empty.
 *
 *   MacPriceAccess.canSee()   true / false
 */
var MacPriceAccess = (function () {
    'use strict';

    var KEY = 'see-costs-prices';
    var ALWAYS = ['super_user', 'admin'];

    function roleName() {
        try {
            var u = (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
            var rn = u ? (u.role_name || u.role || '') : '';
            if (rn && typeof rn === 'object') rn = rn.name || rn.role_name || '';
            return String(rn || '').toLowerCase();
        } catch (e) { return ''; }
    }
    function featureKeys() {
        try {
            var k = (typeof Session !== 'undefined' && Session.get) ? Session.get('featureKeys') : null;
            return Array.isArray(k) ? k : [];
        } catch (e) { return []; }
    }

    function canSee() {
        if (ALWAYS.indexOf(roleName()) !== -1) return true;
        return featureKeys().indexOf(KEY) !== -1;
    }

    return { canSee: canSee, KEY: KEY };
})();
