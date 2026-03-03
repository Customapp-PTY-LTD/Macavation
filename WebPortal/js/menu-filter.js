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

        /** Display value used when showing nav items (overrides default hidden state) */
        _visibleDisplay: 'block',

        /**
         * Show a specific menu item
         */
        showMenu: function (route) {
            const menuItem = document.querySelector(`a[route="${route}"]`);
            if (menuItem) {
                const navItem = menuItem.closest('.nav-item');
                if (navItem) {
                    navItem.style.display = this._visibleDisplay;
                }
            }
        },

        /**
         * Hide all menu items
         */
        hideAllMenus: function () {
            const allMenuItems = document.querySelectorAll('.sidebar .nav-item');
            allMenuItems.forEach(item => {
                item.style.display = 'none';
            });
        },

        /**
         * Show all menu items
         */
        showAllMenus: function () {
            const allMenuItems = document.querySelectorAll('.sidebar .nav-item');
            allMenuItems.forEach(item => {
                item.style.display = this._visibleDisplay;
            });
        },

        /**
         * Update parent collapse menus based on visible children.
         * If no children are visible, hide the parent toggle too.
         */
        updateParentMenus: function () {
            var self = this;
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
                    return item.style.display !== 'none';
                });
                var toggle = document.querySelector('[data-bs-target="#' + id + '"]');
                if (toggle) {
                    var parentNavItem = toggle.closest('.nav-item');
                    if (parentNavItem) {
                        parentNavItem.style.display = hasVisible ? self._visibleDisplay : 'none';
                    }
                }
            });
        },

        /**
         * Hide admin-only sections for PWA users
         */
        hideAdminSections: function () {
            // Hide User Management section
            const userManagementSection = document.querySelector('[data-bs-target="#userManagementCollapse"]');
            if (userManagementSection) {
                const parentNavItem = userManagementSection.closest('.nav-item');
                if (parentNavItem) {
                    parentNavItem.style.display = 'none';
                }
            }

            // Hide System Administration
            const adminMenu = document.querySelector('a[route="admin-grid"]');
            if (adminMenu) {
                const parentNavItem = adminMenu.closest('.nav-item');
                if (parentNavItem) {
                    parentNavItem.style.display = 'none';
                }
            }

            // Hide Palladium Integration (typically admin-only)
            const palladiumMenu = document.querySelector('a[route="palladium-integration-grid"]');
            if (palladiumMenu) {
                const parentNavItem = palladiumMenu.closest('.nav-item');
                if (parentNavItem) {
                    parentNavItem.style.display = 'none';
                }
            }

            // Hide Executive Dashboard (unless explicitly allowed)
            if (!roleMenuConfig.hasAccess('executive-dashboard')) {
                const execDashboard = document.querySelector('a[route="executive-dashboard"]');
                if (execDashboard) {
                    const parentNavItem = execDashboard.closest('.nav-item');
                    if (parentNavItem) {
                        parentNavItem.style.display = 'none';
                    }
                }
            }

            // Hide Material Journey Dashboard (unless explicitly allowed)
            if (!roleMenuConfig.hasAccess('amanda-dashboard')) {
                const amandaDashboard = document.querySelector('a[route="amanda-dashboard"]');
                if (amandaDashboard) {
                    const parentNavItem = amandaDashboard.closest('.nav-item');
                    if (parentNavItem) {
                        parentNavItem.style.display = 'none';
                    }
                }
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

