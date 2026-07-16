/**
 * Session — per-tab session in sessionStorage, shared snapshot in localStorage.
 *
 * Each browser tab keeps its own working copy (sessionStorage). localStorage holds
 * the last committed snapshot so new tabs can hydrate. Sign-out clears only the
 * current tab so other open tabs stay signed in.
 *
 * Sub-keys:
 *   token          — JWT
 *   user           — user object
 *   clientGuid     — client GUID
 *   featureKeys    — string[] of enabled feature keys
 *   actionKeys     — string[] of enabled action keys
 *   lastActivePage — last visited route name
 */
var Session = (function () {
    var KEY = '_Session';
    var SKIP_HYDRATE_KEY = '_SessionSkipHydrate';
    var _hydrated = false;

    function loadTab() {
        try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); }
        catch (e) { return {}; }
    }

    function saveTab(data) {
        sessionStorage.setItem(KEY, JSON.stringify(data));
    }

    function loadShared() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
        catch (e) { return {}; }
    }

    function saveShared(data) {
        localStorage.setItem(KEY, JSON.stringify(data));
    }

    function ensureHydrated() {
        if (_hydrated) return;
        _hydrated = true;
        if (sessionStorage.getItem(SKIP_HYDRATE_KEY) === '1') {
            return;
        }
        var tab = loadTab();
        if (!tab || Object.keys(tab).length === 0) {
            var shared = loadShared();
            if (shared && Object.keys(shared).length > 0) {
                saveTab(shared);
            }
        }
    }

    function syncSharedFromTab() {
        saveShared(loadTab());
    }

    function redirectToSignIn() {
        var ccParam = null;
        try {
            ccParam = Session.get('clientGuid');
        } catch (e) { /* ignore */ }
        var signinUrl = ccParam ? ('signin.html?cc=' + encodeURIComponent(ccParam)) : 'signin.html';
        window.location.href = signinUrl;
    }

    return {
        get: function (subKey) {
            ensureHydrated();
            var val = loadTab()[subKey];
            return (val !== undefined) ? val : null;
        },

        set: function (subKey, value, opts) {
            ensureHydrated();
            var data = loadTab();
            data[subKey] = value;
            saveTab(data);
            if (!opts || opts.tabOnly !== true) {
                syncSharedFromTab();
            }
        },

        remove: function (subKey, opts) {
            ensureHydrated();
            var data = loadTab();
            delete data[subKey];
            saveTab(data);
            if (!opts || opts.tabOnly !== true) {
                syncSharedFromTab();
            }
        },

        /** Sign out in this tab only (other tabs keep their session). */
        clear: function () {
            sessionStorage.removeItem(KEY);
            sessionStorage.setItem(SKIP_HYDRATE_KEY, '1');
            _hydrated = true;
        },

        /** Call on successful sign-in so this tab accepts a fresh session. */
        acceptNewLogin: function () {
            sessionStorage.removeItem(SKIP_HYDRATE_KEY);
            _hydrated = false;
        },

        /** Sign out everywhere — clears shared and tab session. */
        clearAll: function () {
            sessionStorage.removeItem(KEY);
            localStorage.removeItem(KEY);
            _hydrated = true;
        },

        /** Replace this tab's session from the shared localStorage snapshot. */
        hydrateFromShared: function () {
            var shared = loadShared();
            if (shared && Object.keys(shared).length > 0) {
                saveTab(shared);
            } else {
                sessionStorage.removeItem(KEY);
            }
            _hydrated = true;
        },

        /** Clear stale route from a prior login; does not wipe feature keys (other tabs may still need them). */
        clearPriorLoginNavigationState: function () {
            this.remove('lastActivePage');
            try {
                if (typeof sessionStorage !== 'undefined') {
                    sessionStorage.removeItem('lastActivePage');
                }
            } catch (e) { /* ignore */ }
        },

        isAuthenticated: function () {
            return !!(this.get('token') && this.get('user'));
        },

        /**
         * When another tab commits a new shared session, refresh this tab.
         * Tab-only sign-out does not touch localStorage, so other tabs are unaffected.
         */
        initCrossTabSync: function () {
            if (typeof window === 'undefined') return;
            window.addEventListener('storage', function (e) {
                if (e.key !== KEY) return;
                Session.hydrateFromShared();
                if (!Session.isAuthenticated()) {
                    redirectToSignIn();
                    return;
                }
                if (typeof authService !== 'undefined') {
                    if (authService.syncUserFromSession) {
                        authService.syncUserFromSession();
                    }
                    var user = Session.get('user');
                    var roleId = user && (user.role_id || (user.role && user.role.id));
                    if (roleId && !Array.isArray(Session.get('featureKeys')) && authService.fetchAndCacheFeatures) {
                        authService.fetchAndCacheFeatures(roleId);
                    }
                }
                if (typeof menuFilter !== 'undefined' && menuFilter.refresh) {
                    menuFilter.refresh();
                }
            });
        },

        /** Convenience — returns the full parsed session object for this tab. */
        getAll: function () {
            ensureHydrated();
            return loadTab();
        },

        /** Canonical signed-in user UUID from Session.user. */
        getUserId: function () {
            var user = this.get('user');
            if (!user) return null;
            return user.id != null ? user.id : (user.user_id != null ? user.user_id : null);
        },

        /**
         * Merge fields into Session.user only when the patch belongs to the same actor.
         * Prevents refresh/enrichment from swapping one user's identity for another.
         */
        mergeUserIfSameActor: function (patch) {
            if (!patch || typeof patch !== 'object') return false;
            var current = this.get('user');
            if (!current) return false;
            var currentId = current.id != null ? current.id : current.user_id;
            var patchId = patch.id != null ? patch.id : patch.user_id;
            if (!currentId || !patchId || String(currentId) !== String(patchId)) {
                return false;
            }
            var merged = Object.assign({}, current, patch);
            this.set('user', merged);
            return true;
        }
    };
}());

window.Session = Session;
