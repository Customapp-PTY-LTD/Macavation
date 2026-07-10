/**
 * Action access — button/action-level permission checks.
 *
 * Companion to menu-filter.js (which gates modules/routes via featureKeys).
 * Action keys are cached in Session 'actionKeys' at login by auth-service.js.
 *
 * Default-deny: hasAction(key) returns false unless the key is granted, except
 * for super_user/admin roles which are always allowed (defensive fallback so an
 * admin is never locked out if seeds are missing).
 *
 * Declarative DOM gating: add data-action-perm="key" to any element. Optionally
 * data-action-deny="hide" (default) or "disable". Call actionAccess.apply(root)
 * after rendering to hide/disable controls the role may not use.
 */
var actionAccess = (function () {
    'use strict';

    var ALWAYS_ALLOW_ROLES = ['super_user', 'admin'];

    function currentRoleName() {
        try {
            var user = (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
            if (!user) return '';
            var rn = user.role_name || user.role || '';
            if (rn && typeof rn === 'object') rn = rn.name || rn.role_name || '';
            return String(rn || '').toLowerCase();
        } catch (e) {
            return '';
        }
    }

    function actionKeys() {
        try {
            var keys = (typeof Session !== 'undefined' && Session.get) ? Session.get('actionKeys') : null;
            return Array.isArray(keys) ? keys : [];
        } catch (e) {
            return [];
        }
    }

    return {
        /** True if the current role may perform the given action key. */
        has: function (key) {
            if (!key) return true;
            if (ALWAYS_ALLOW_ROLES.indexOf(currentRoleName()) !== -1) return true;
            return actionKeys().indexOf(key) !== -1;
        },

        /**
         * Block an operation unless the role has the action key.
         * @returns {boolean} true when allowed
         */
        denyUnless: function (key, message) {
            if (this.has(key)) return true;
            if (typeof Swal !== 'undefined') {
                Swal.fire('Not permitted', message || 'You do not have permission for this action.', 'warning');
            }
            return false;
        },

        /**
         * Hide/disable controls under root based on their data-action-perm key.
         * @param {HTMLElement|Document} [root=document]
         */
        apply: function (root) {
            var scope = root || document;
            var nodes = scope.querySelectorAll ? scope.querySelectorAll('[data-action-perm]') : [];
            for (var i = 0; i < nodes.length; i++) {
                var el = nodes[i];
                var key = el.getAttribute('data-action-perm');
                var allowed = this.has(key);
                var mode = el.getAttribute('data-action-deny') || 'hide';
                if (allowed) {
                    if (mode === 'disable') {
                        el.removeAttribute('disabled');
                        el.classList.remove('disabled');
                    } else {
                        el.style.display = el.getAttribute('data-action-display') || '';
                    }
                } else if (mode === 'disable') {
                    el.setAttribute('disabled', 'disabled');
                    el.classList.add('disabled');
                    if (el.getAttribute('title')) el.setAttribute('data-action-title-orig', el.getAttribute('title'));
                    el.setAttribute('title', 'You do not have permission for this action.');
                } else {
                    el.style.display = 'none';
                }
            }
        }
    };
}());

// Global convenience: hasAction('kernel.job_card.approve')
window.actionAccess = actionAccess;
window.hasAction = function (key) { return actionAccess.has(key); };

// Re-apply gates whenever action keys change (e.g. after login).
try {
    window.addEventListener('actionKeysUpdated', function () {
        actionAccess.apply(document);
    });
} catch (e) {}
