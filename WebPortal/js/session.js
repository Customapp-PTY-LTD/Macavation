/**
 * Session — single localStorage key '_Session' with typed sub-keys.
 *
 * Sub-keys:
 *   token          — JWT (was: lambda_token)
 *   user           — user object (was: user_info, stored as JSON.stringify)
 *   clientGuid     — client GUID (was: client_guid)
 *   featureKeys    — string[] of enabled feature keys (was: role_feature_keys, JSON.stringify)
 *   lastActivePage — last visited route name (was: lastActivePage)
 */
var Session = (function () {
    var KEY = '_Session';

    function load() {
        try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
        catch (e) { return {}; }
    }

    function save(data) {
        localStorage.setItem(KEY, JSON.stringify(data));
    }

    return {
        get: function (subKey) {
            var val = load()[subKey];
            return (val !== undefined) ? val : null;
        },

        set: function (subKey, value) {
            var data = load();
            data[subKey] = value;
            save(data);
        },

        remove: function (subKey) {
            var data = load();
            delete data[subKey];
            save(data);
        },

        /** Wipe the entire session (on logout). */
        clear: function () {
            localStorage.removeItem(KEY);
        },

        /** Convenience — returns the full parsed session object. */
        getAll: function () {
            return load();
        }
    };
}());

window.Session = Session;
