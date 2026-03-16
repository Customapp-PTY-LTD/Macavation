/**
 * Menu Filter Utility
 * Filters sidebar menus based on user role
 */

var _menuFilter = function () {
    return {
        /**
         * Initialize menu filtering
         */
        init: function () {
            this.filterMenus();

            var self = this;
            // Re-filter when Session changes (other tab)
            window.addEventListener('storage', function (e) {
                if (e.key === '_Session') {
                    self.filterMenus();
                }
            });
            // Re-filter when feature keys are set in this tab (e.g. after fetchAndCacheFeatures)
            window.addEventListener('featureKeysUpdated', function () {
                self.filterMenus();
            });
        },

        /**
         * Get accessible routes. Uses Session featureKeys when available (array, including empty);
         * otherwise falls back to role-menu-config.
         */
        _getAccessibleRoutes: function () {
            var keys = Session.get('featureKeys');
            if (Array.isArray(keys)) {
                return keys;
            }
            if (typeof roleMenuConfig !== 'undefined') {
                return roleMenuConfig.getAccessibleMenus();
            }
            return [];
        },

        /**
         * Filter menus: only show items whose feature key is in Session featureKeys (from Role Features).
         * No fallback to "admin sees all" — Role Features is the single source of truth.
         */
        filterMenus: function () {
            var keys = Session.get('featureKeys');
            var accessibleMenus = Array.isArray(keys) ? keys : [];
            var usingFeatureKeys = Array.isArray(keys);

            console.log('[Menu Filter] Accessible menus:', accessibleMenus.length, 'from featureKeys:', usingFeatureKeys);

            // Always use featureKeys when it's an array (including empty). Never show all for admin.
            this.hideAllMenus();
            var self = this;
            accessibleMenus.forEach(function (route) {
                self.showMenu(route);
            });
            this.updateParentMenus();
        },

        /**
         * Show a specific menu item by route (feature key). Removes d-none so item is visible.
         */
        showMenu: function (route) {
            var navItem = document.querySelector('#sidebarMenu .nav-item[data-route="' + route + '"]');
            if (!navItem) {
                var link = document.querySelector('#sidebarMenu a[route="' + route + '"]');
                if (link) navItem = link.closest('.nav-item');
            }
            if (navItem) {
                navItem.classList.remove('d-none');
            }
        },

        /**
         * Hide all sidebar menu items by adding d-none (all start with d-none; this resets for re-filter).
         */
        hideAllMenus: function () {
            var all = document.querySelectorAll('#sidebarMenu .nav-item');
            all.forEach(function (item) {
                item.classList.add('d-none');
            });
        },

        /**
         * Show all sidebar menu items by removing d-none (full access).
         */
        showAllMenus: function () {
            var all = document.querySelectorAll('#sidebarMenu .nav-item');
            all.forEach(function (item) {
                item.classList.remove('d-none');
            });
        },

        /**
         * Update parent (top-level) sidebar items based on visible children.
         * When a side nav feature is hidden, hide the corresponding top-level element if no children remain visible.
         */
        updateParentMenus: function () {
            var collapseIds = [
                'crmCollapse',
                'kernelCollapse',
                'oilCollapse',
                'qualityCollapse',
                'businessCollapse',
                'userManagementCollapse',
                'testManagementCollapse'
            ];

            collapseIds.forEach(function (id) {
                var children = document.querySelectorAll('#' + id + ' .nav-item');
                var hasVisible = Array.from(children).some(function (item) {
                    return !item.classList.contains('d-none');
                });
                var toggle = document.querySelector('[data-bs-target="#' + id + '"]');
                if (toggle) {
                    var parentNavItem = toggle.closest('.nav-item');
                    if (parentNavItem) {
                        if (hasVisible) {
                            parentNavItem.classList.remove('d-none');
                        } else {
                            parentNavItem.classList.add('d-none');
                        }
                    }
                }
            });
        },

        /**
         * Hide admin-only sections for PWA users (add d-none).
         */
        hideAdminSections: function () {
            var addDNone = function (el) {
                if (el) el.classList.add('d-none');
            };

            var userMgmt = document.querySelector('[data-bs-target="#userManagementCollapse"]');
            addDNone(userMgmt && userMgmt.closest('.nav-item'));

            var adminMenu = document.querySelector('#sidebarMenu a[route="admin-grid"]');
            addDNone(adminMenu && adminMenu.closest('.nav-item'));

            var palladiumMenu = document.querySelector('#sidebarMenu a[route="palladium-integration-grid"]');
            addDNone(palladiumMenu && palladiumMenu.closest('.nav-item'));

            if (typeof roleMenuConfig !== 'undefined' && !roleMenuConfig.hasAccess('executive-dashboard')) {
                var execDashboard = document.querySelector('#sidebarMenu a[route="executive-dashboard"]');
                addDNone(execDashboard && execDashboard.closest('.nav-item'));
            }

            if (typeof roleMenuConfig !== 'undefined' && !roleMenuConfig.hasAccess('amanda-dashboard')) {
                var amandaDashboard = document.querySelector('#sidebarMenu a[route="amanda-dashboard"]');
                addDNone(amandaDashboard && amandaDashboard.closest('.nav-item'));
            }
        },

        /**
         * Refresh menu filter (call after role change)
         */
        refresh: function () {
            this.filterMenus();
        }
    };
}();

// Create global instance
const menuFilter = _menuFilter;
window.menuFilter = menuFilter;

