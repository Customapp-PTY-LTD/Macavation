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
            const isPWAUser = roleMenuConfig.isPWAUser();
            const isAdmin = roleMenuConfig.isAdminUser();

            console.log('[Menu Filter] Accessible menus:', accessibleMenus);
            console.log('[Menu Filter] Is PWA User:', isPWAUser);
            console.log('[Menu Filter] Is Admin:', isAdmin);

            // If PWA user, apply role-based filtering
            if (isPWAUser) {
                // Hide all menu items first
                this.hideAllMenus();

                // Show accessible menus
                accessibleMenus.forEach(route => {
                    this.showMenu(route);
                });

                // Handle parent collapse menus
                this.updateParentMenus();

                // Hide admin-only sections
                this.hideAdminSections();
            } else {
                // Admin and super_user see all menus
                this.showAllMenus();
                this.updateParentMenus();
            }
        },

        /**
         * Show a specific menu item
         */
        showMenu: function (route) {
            const menuItem = document.querySelector(`a[route="${route}"]`);
            if (menuItem) {
                const navItem = menuItem.closest('.nav-item');
                if (navItem) {
                    navItem.style.display = '';
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
                item.style.display = '';
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
                if (visibleUserItems.length > 0) {
                    parentNavItem.style.display = '';
                } else {
                    parentNavItem.style.display = 'none';
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
                if (visibleCrmItems.length > 0) {
                    parentNavItem.style.display = '';
                } else {
                    parentNavItem.style.display = 'none';
                }
            }

            // Kernel
            const kernelItems = document.querySelectorAll('#kernelCollapse .nav-item');
            const visibleKernelItems = Array.from(kernelItems).filter(item => item.style.display !== 'none');
            const kernelToggle = document.querySelector('[data-bs-target="#kernelCollapse"]');
            if (kernelToggle) {
                const parentNavItem = kernelToggle.closest('.nav-item');
                parentNavItem.style.display = visibleKernelItems.length > 0 ? '' : 'none';
            }

            // Oil & Protein
            const oilItems = document.querySelectorAll('#oilCollapse .nav-item');
            const visibleOilItems = Array.from(oilItems).filter(item => item.style.display !== 'none');
            const oilToggle = document.querySelector('[data-bs-target="#oilCollapse"]');
            if (oilToggle) {
                const parentNavItem = oilToggle.closest('.nav-item');
                parentNavItem.style.display = visibleOilItems.length > 0 ? '' : 'none';
            }

            // Quality & Stock
            const qualityItems = document.querySelectorAll('#qualityCollapse .nav-item');
            const visibleQualityItems = Array.from(qualityItems).filter(item => 
                item.style.display !== 'none'
            );
            const qualityToggle = document.querySelector('[data-bs-target="#qualityCollapse"]');
            if (qualityToggle) {
                const parentNavItem = qualityToggle.closest('.nav-item');
                if (visibleQualityItems.length > 0) {
                    parentNavItem.style.display = '';
                } else {
                    parentNavItem.style.display = 'none';
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
                if (visibleBusinessItems.length > 0) {
                    parentNavItem.style.display = '';
                } else {
                    parentNavItem.style.display = 'none';
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

