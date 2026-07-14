/*
 * Shared role-name display formatter (window.formatRoleName).
 *
 * Roles are stored with snake_case keys (e.g. "super_user") that are the
 * canonical RBAC identifiers used throughout the app and DB. Those keys must
 * NEVER be renamed. This helper is DISPLAY-ONLY: it turns a raw key into a
 * friendly label ("super_user" -> "Super User") for rendering in the UI.
 * Values that are already human labels ("Super Admin") pass through cleanly.
 */
(function (w) {
    'use strict';
    function formatRoleName(name) {
        if (name == null) { return ''; }
        var s = String(name).trim();
        if (!s) { return ''; }
        return s
            .replace(/[_-]+/g, ' ')          // super_user -> super user
            .replace(/\s+/g, ' ')            // collapse whitespace
            .replace(/\b\w/g, function (c) { // Title Case first letters
                return c.toUpperCase();
            });
    }
    w.formatRoleName = formatRoleName;
})(typeof window !== 'undefined' ? window : this);
