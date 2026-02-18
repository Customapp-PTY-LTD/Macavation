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
            
            // Re-filter when user info changes
            window.addEventListener('storage', (e) => {
                if (e.key === 'user_info') {
                    this.filterMenus();
                }
            });
        },

        /**
         * Filter menus based on user role
         */
        filterMenus: function () {
            if (typeof roleMenuConfig === 'undefined') {
                console.warn('[Menu Filter] roleMenuConfig not available');
                return;
            }

            const accessibleMenus = roleMenuConfig.getAccessibleMenus();
            const isAdmin = roleMenuConfig.isAdminUser();

            console.log('[Menu Filter] Accessible menus:', accessibleMenus);
            console.log('[Menu Filter] Is Admin:', isAdmin);

            // Only admin/super_user see all menus. Everyone else (PWA, KP Data Admin, or unknown role) gets restricted menu.
            // This avoids showing full menu on first load when role_name is not yet in user_info.
            if (isAdmin) {
                this.showAllMenus();
                this.updateParentMenus();
            } else {
                // Restricted: hide all first, then show only allowed routes (empty if role unknown)
                this.hideAllMenus();
                accessibleMenus.forEach(route => {
                    this.showMenu(route);
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
         * Update parent collapse menus based on visible children
         */
        updateParentMenus: function () {
            // User Management
            const userManagementItems = document.querySelectorAll('#userManagementCollapse .nav-item');
            const visibleUserItems = Array.from(userManagementItems).filter(item => 
                item.style.display !== 'none'
            );
            const userManagementToggle = document.querySelector('[data-bs-target="#userManagementCollapse"]');
            if (userManagementToggle) {
                const parentNavItem = userManagementToggle.closest('.nav-item');
                if (parentNavItem) {
                    if (visibleUserItems.length > 0) {
                        parentNavItem.style.display = this._visibleDisplay;
                    } else {
                        parentNavItem.style.display = 'none';
                    }
                }
            }

            // CRM
            const crmItems = document.querySelectorAll('#crmCollapse .nav-item');
            const visibleCrmItems = Array.from(crmItems).filter(item => 
                item.style.display !== 'none'
            );
            const crmToggle = document.querySelector('[data-bs-target="#crmCollapse"]');
            if (crmToggle) {
                const parentNavItem = crmToggle.closest('.nav-item');
                if (parentNavItem) {
                    if (visibleCrmItems.length > 0) {
                        parentNavItem.style.display = this._visibleDisplay;
                    } else {
                        parentNavItem.style.display = 'none';
                    }
                }
            }

            // Production
            const productionItems = document.querySelectorAll('#productionCollapse .nav-item');
            const visibleProductionItems = Array.from(productionItems).filter(item => 
                item.style.display !== 'none'
            );
            const productionToggle = document.querySelector('[data-bs-target="#productionCollapse"]');
            if (productionToggle) {
                const parentNavItem = productionToggle.closest('.nav-item');
                if (parentNavItem) {
                    if (visibleProductionItems.length > 0) {
                        parentNavItem.style.display = this._visibleDisplay;
                    } else {
                        parentNavItem.style.display = 'none';
                    }
                }
            }

            // Quality & Stock
            const qualityItems = document.querySelectorAll('#qualityCollapse .nav-item');
            const visibleQualityItems = Array.from(qualityItems).filter(item => 
                item.style.display !== 'none'
            );
            const qualityToggle = document.querySelector('[data-bs-target="#qualityCollapse"]');
            if (qualityToggle) {
                const parentNavItem = qualityToggle.closest('.nav-item');
                if (parentNavItem) {
                    if (visibleQualityItems.length > 0) {
                        parentNavItem.style.display = this._visibleDisplay;
                    } else {
                        parentNavItem.style.display = 'none';
                    }
                }
            }

            // Business
            const businessItems = document.querySelectorAll('#businessCollapse .nav-item');
            const visibleBusinessItems = Array.from(businessItems).filter(item => 
                item.style.display !== 'none'
            );
            const businessToggle = document.querySelector('[data-bs-target="#businessCollapse"]');
            if (businessToggle) {
                const parentNavItem = businessToggle.closest('.nav-item');
                if (parentNavItem) {
                    if (visibleBusinessItems.length > 0) {
                        parentNavItem.style.display = this._visibleDisplay;
                    } else {
                        parentNavItem.style.display = 'none';
                    }
                }
            }
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

