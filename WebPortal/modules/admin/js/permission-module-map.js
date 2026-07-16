/**
 * Permission ↔ module mapper for the Customize modules dialog.
 *
 * There is no DB link between features.key (sidebar modules) and
 * role_permissions.object_name (Supabase functions/tables). This helper groups
 * each database permission under the module it most likely belongs to so the
 * Customize dialog can show nested permission checkboxes per module.
 *
 * Mapping is best-effort: a permission resolves to a single module slug from its
 * object name, and each feature key declares which slugs it owns. Permissions
 * that match no feature fall into the "Other / shared" group.
 */
var _permissionModuleMap = (function () {
    'use strict';

    function resolveModuleSlug(objectName) {
        var name = (objectName || '').toLowerCase();
        if (!name) return 'unknown';
        if (name.indexOf('user') !== -1) return 'users';
        if (name.indexOf('role') !== -1 || name.indexOf('permission') !== -1 || name.indexOf('feature') !== -1) return 'roles';
        if (name.indexOf('contact') !== -1 || name.indexOf('customer') !== -1) return 'crm';
        if (name.indexOf('grower') !== -1) return 'grower-intake';
        if (name.indexOf('dispatch') !== -1) {
            return name.indexOf('oil') !== -1 ? 'oil-dispatch' : 'kernel-dispatch';
        }
        if (name.indexOf('supplier') !== -1) return 'supplier-intake';
        if (name.indexOf('oil') !== -1 || name.indexOf('protein') !== -1) return 'oil-production';
        if (name.indexOf('sample') !== -1 || name.indexOf('quality') !== -1 || name.indexOf('lab') !== -1 || name.indexOf('test') !== -1) return 'quality-assurance';
        if (name.indexOf('stock') !== -1 || name.indexOf('item') !== -1 || name.indexOf('inventory') !== -1) return 'stock-management';
        if (name.indexOf('production') !== -1 || name.indexOf('batch') !== -1 || name.indexOf('kernel') !== -1) return 'kernel-production';
        if (name.indexOf('sales') !== -1 || name.indexOf('forecast') !== -1) return 'sales-forecasting';
        if (name.indexOf('financial') !== -1 || name.indexOf('transaction') !== -1 || name.indexOf('invoice') !== -1 || name.indexOf('payment') !== -1) return 'financial-management';
        if (name.indexOf('document') !== -1) return 'document-management';
        if (name.indexOf('palladium') !== -1) return 'palladium-integration';
        if (name.indexOf('dashboard') !== -1 || name.indexOf('kpi') !== -1) return 'dashboard';
        return 'unknown';
    }

    // Feature key (sidebar module) -> module slugs it owns. The order of feature
    // rows in the dialog decides which feature claims a permission when several
    // share a slug, so a permission is only ever shown once.
    var FEATURE_KEY_SLUGS = {
        'dashboard': ['dashboard'],
        'executive-dashboard': ['dashboard'],
        'amanda-dashboard': ['dashboard'],
        'my-day': ['dashboard'],
        'crm-grid': ['crm'],
        'grower-intake-grid': ['grower-intake'],
        'kernel-production-grid': ['kernel-production'],
        'stock-management-kernel': ['stock-management'],
        'kernel-dispatch-grid': ['kernel-dispatch'],
        'supplier-intake-grid': ['supplier-intake'],
        'oil-production-grid': ['oil-production'],
        'stock-management-oil': ['stock-management'],
        'oil-dispatch-grid': ['oil-dispatch'],
        'quality-assurance-grid': ['quality-assurance'],
        'sales-forecasting-grid': ['sales-forecasting'],
        'financial-management-grid': ['financial-management'],
        'document-management-grid': ['document-management'],
        'palladium-integration-grid': ['palladium-integration'],
        'users-grid': ['users'],
        'roles-grid': ['roles'],
        'role-permissions-grid': ['roles'],
        'role-features-grid': ['roles'],
        'admin-grid': ['users', 'roles']
    };

    function featureKeyToModuleSlugs(featureKey) {
        return FEATURE_KEY_SLUGS[featureKey] || [];
    }

    function permissionBelongsToFeature(perm, featureKey) {
        var slug = resolveModuleSlug(perm && perm.object_name);
        return featureKeyToModuleSlugs(featureKey).indexOf(slug) !== -1;
    }

    // actions.module (catalogue label) -> sidebar feature keys that own those buttons.
    var ACTION_MODULE_FEATURE_KEYS = {
        'Grower Intake': ['grower-intake-grid'],
        'Kernel Production': ['kernel-production-grid'],
        'Kernel Dispatch': ['kernel-dispatch-grid'],
        'Stock': ['stock-management-kernel', 'stock-management-oil'],
        'Oil Production': ['oil-production-grid'],
        'Quality Assurance': ['quality-assurance-grid'],
        'Dashboard': ['dashboard', 'executive-dashboard', 'amanda-dashboard', 'my-day'],
        'Reporting': ['scheduled-reports-grid'],
        'Administration': ['admin-grid', 'users-grid', 'roles-grid', 'role-permissions-grid', 'role-features-grid'],
        'Messaging': ['messaging-compose-grid']
    };

    function actionBelongsToFeature(action, featureKey) {
        var mod = action && action.module ? String(action.module) : '';
        var keys = ACTION_MODULE_FEATURE_KEYS[mod] || [];
        return keys.indexOf(featureKey) !== -1;
    }

    return {
        resolveModuleSlug: resolveModuleSlug,
        featureKeyToModuleSlugs: featureKeyToModuleSlugs,
        permissionBelongsToFeature: permissionBelongsToFeature,
        actionBelongsToFeature: actionBelongsToFeature
    };
})();

window._permissionModuleMap = _permissionModuleMap;
