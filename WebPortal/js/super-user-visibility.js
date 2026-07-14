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

    function normalizeRoleName(roleName) {
        if (roleName == null || roleName === '') return '';
        if (typeof roleName === 'object') {
            roleName = roleName.name || roleName.role_name || roleName.role || '';
        }
        return String(roleName).toLowerCase().trim();
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

    /** User record hidden from non-super_user actors. */
    function isPrivilegedUser(user) {
        if (!user) return false;
        var role = user.role_name || user.role || '';
        return isSuperUserRole(role) || isCustomAppEmail(user.email);
    }

    function isCurrentUserSuperUser() {
        try {
            var user = (typeof Session !== 'undefined' && Session.get) ? Session.get('user') : null;
            if (!user) return false;
            return isSuperUserRole(user.role_name || user.role);
        } catch (e) {
            return false;
        }
    }

    function canSeeUser(user) {
        if (!user) return false;
        if (isCurrentUserSuperUser()) return true;
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
        if (isSuperUserRole(role.role_name || role.name || role.role)) {
            return isCurrentUserSuperUser();
        }
        return true;
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
        filterRoleAssignments: filterRoleAssignments
    };
}());

window.superUserVisibility = superUserVisibility;
