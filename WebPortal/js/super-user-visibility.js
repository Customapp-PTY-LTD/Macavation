/**
 * Super-user / CustomApp staff visibility rules.
 *
 * Non-super_user actors must not see or manage:
 *   - users with role super_user
 *   - users whose email ends with @customapp.co.za
 *   - the super_user role in permission admin screens
 *   - permissions/features/actions assigned to super_user (unless actor is super_user)
 */
var superUserVisibility = (function () {
    'use strict';

    var STAFF_EMAIL_SUFFIX = '@customapp.co.za';
    var SUPER_ROLE = 'super_user';
    var SUPER_ROLE_ID_SESSION_KEY = 'superUserRoleId';

    function normalizeRoleName(roleName) {
        if (roleName == null || roleName === '') return '';
        if (typeof roleName === 'object') {
            roleName = roleName.name || roleName.role_name || roleName.role || '';
        }
        // "Super User" / "super-user" → "super_user" (canonical RBAC key form)
        return String(roleName).toLowerCase().trim()
            .replace(/[\s-]+/g, '_')
            .replace(/_+/g, '_');
    }

    function normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function isSuperUserRole(roleName) {
        return normalizeRoleName(roleName) === SUPER_ROLE;
    }

    function isCustomAppEmail(email) {
        return normalizeEmail(email).endsWith(STAFF_EMAIL_SUFFIX);
    }

    function getSessionUser() {
        try {
            return (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
        } catch (e) {
            return null;
        }
    }

    function getUserId(user) {
        if (!user) return null;
        return user.id || user.user_id || null;
    }

    function getUserRoleId(user) {
        if (!user) return null;
        if (user.role_id != null && user.role_id !== '') return user.role_id;
        if (user.role && typeof user.role === 'object' && user.role.id != null) return user.role.id;
        return null;
    }

    function getUserRoleName(user) {
        if (!user) return '';
        if (user.role_name) return user.role_name;
        if (typeof user.role === 'string') return user.role;
        if (user.role && typeof user.role === 'object') {
            return user.role.role_name || user.role.name || '';
        }
        return '';
    }

    function getCachedSuperUserRoleId() {
        try {
            return (typeof Session !== 'undefined' && Session.get)
                ? Session.get(SUPER_ROLE_ID_SESSION_KEY)
                : null;
        } catch (e) {
            return null;
        }
    }

    /** Remember the super_user role UUID when roles are loaded (avoids stale role_name strings). */
    function rememberSuperUserRoleIdFromRoles(roles) {
        if (!Array.isArray(roles)) return;
        for (var i = 0; i < roles.length; i++) {
            var role = roles[i];
            if (!role) continue;
            if (isSuperUserRole(role.role_name || role.name || role.role) && role.id != null) {
                try {
                    if (typeof Session !== 'undefined' && Session.set) {
                        Session.set(SUPER_ROLE_ID_SESSION_KEY, role.id);
                    }
                } catch (e) { /* ignore */ }
                return;
            }
        }
    }

    function sessionRoleIdMatchesSuperUser(user) {
        var userRoleId = getUserRoleId(user);
        if (!userRoleId) return false;
        var cachedId = getCachedSuperUserRoleId();
        return !!(cachedId && String(cachedId) === String(userRoleId));
    }

    /** User record hidden from non-super_user actors. */
    function isPrivilegedUser(user) {
        if (!user) return false;
        return isSuperUserRole(getUserRoleName(user)) || isCustomAppEmail(user.email);
    }

    function isCurrentUserSuperUser() {
        try {
            var user = getSessionUser();
            if (!user) return false;
            if (isSuperUserRole(getUserRoleName(user))) return true;
            return sessionRoleIdMatchesSuperUser(user);
        } catch (e) {
            return false;
        }
    }

    function canSeeUser(user) {
        if (!user) return false;
        if (isCurrentUserSuperUser()) return true;
        // Always allow actors to see their own row (needed to re-sync role_name from DB).
        var me = getSessionUser();
        var meId = getUserId(me);
        var otherId = getUserId(user);
        if (meId && otherId && String(meId) === String(otherId)) return true;
        return !isPrivilegedUser(user);
    }

    function canSeeRole(role) {
        if (!role) return false;
        if (isCurrentUserSuperUser()) return true;
        return !isSuperUserRole(role.role_name || role.name || role.role);
    }

    /** Edit / customize / deactivate the super_user role — super_user actors only. */
    function canManageRole(role) {
        if (!role) return false;
        if (!isSuperUserRole(role.role_name || role.name || role.role)) {
            return true;
        }
        if (isCurrentUserSuperUser()) return true;
        // Session may lack role_name while role_id still points at this super_user role.
        var user = getSessionUser();
        var userRoleId = getUserRoleId(user);
        if (userRoleId && role.id != null && String(userRoleId) === String(role.id)) {
            rememberSuperUserRoleIdFromRoles([role]);
            return true;
        }
        return false;
    }

    function canManageUser(user) {
        if (!user) return false;
        if (isCurrentUserSuperUser()) return true;
        return !isPrivilegedUser(user);
    }

    function filterUsers(users) {
        if (!Array.isArray(users)) return [];
        if (isCurrentUserSuperUser()) return users;
        return users.filter(canSeeUser);
    }

    function filterRoles(roles) {
        if (!Array.isArray(roles)) return [];
        rememberSuperUserRoleIdFromRoles(roles);
        if (isCurrentUserSuperUser()) return roles;
        return roles.filter(canSeeRole);
    }

    /** Rows from get_role_* joins that include role_name. */
    function filterRoleAssignments(rows) {
        if (!Array.isArray(rows)) return [];
        if (isCurrentUserSuperUser()) return rows;
        return rows.filter(function (row) {
            return !isSuperUserRole(row.role_name || row.role);
        });
    }

    return {
        STAFF_EMAIL_SUFFIX: STAFF_EMAIL_SUFFIX,
        SUPER_ROLE: SUPER_ROLE,
        isSuperUserRole: isSuperUserRole,
        isCustomAppEmail: isCustomAppEmail,
        isPrivilegedUser: isPrivilegedUser,
        isCurrentUserSuperUser: isCurrentUserSuperUser,
        canSeeUser: canSeeUser,
        canSeeRole: canSeeRole,
        canManageRole: canManageRole,
        canManageUser: canManageUser,
        filterUsers: filterUsers,
        filterRoles: filterRoles,
        filterRoleAssignments: filterRoleAssignments,
        rememberSuperUserRoleIdFromRoles: rememberSuperUserRoleIdFromRoles,
        normalizeRoleName: normalizeRoleName
    };
}());

window.superUserVisibility = superUserVisibility;
