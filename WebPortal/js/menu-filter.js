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

            // Re-filter when user info or role features change
            var self = this;
            window.addEventListener('storage', function (e) {
                if (e.key === '_Session') {
                    self.filterMenus();
                }
            });
        },

        /**
         * Get accessible routes — prefers DB-cached features, falls back to hardcoded config
         */
        _getAccessibleRoutes: function () {
            // 1. Try DB-cached features from localStorage (set by auth-service)
            var keys = Session.get('featureKeys');
            if (Array.isArray(keys) && keys.length > 0) {
                return keys;
            }

            // 2. Fallback to hardcoded role-menu-config
            if (typeof roleMenuConfig !== 'undefined') {
                return roleMenuConfig.getAccessibleMenus();
            }

            return [];
        },

        /**
         * Filter menus based on role features (DB-driven with fallback)
         */
        filterMenus: function () {
            var isAdmin = typeof roleMenuConfig !== 'undefined' && roleMenuConfig.isAdminUser();
            var accessibleMenus = this._getAccessibleRoutes();

            console.log('[Menu Filter] Accessible menus:', accessibleMenus.length, 'Admin:', isAdmin);

            if (isAdmin) {
                // Admin/super_user/management roles — show everything
                this.showAllMenus();
                this.updateParentMenus();
            } else {
                // Restricted: hide all, then show only allowed routes
                this.hideAllMenus();
                var self = this;
                accessibleMenus.forEach(function (route) {
                    self.showMenu(route);
                });
                this.updateParentMenus();
                this.hideAdminSections();
            }
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

