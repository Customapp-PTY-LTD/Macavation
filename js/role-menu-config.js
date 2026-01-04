/**
 * Role-Based Menu Configuration
 * Defines which menu items are visible for each role
 */

var _roleMenuConfig = function () {
    return {
        /**
         * Menu configuration mapping roles to accessible routes
         */
        menuConfig: {
            // Super User and Admin - Full Access
            'super_user': {
                access: 'all' // All menus
            },
            'admin': {
                access: 'all' // All menus
            },
            
            // PWA Grower Intake - Access to grower intake and related
            'PWA Grower Intake': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'grower-intake-grid',
                    'my-day'
                ]
            },
            
            // PWA Production - Access to production modules
            'PWA Production': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'grower-intake-grid',
                    'kernel-production-grid',
                    'oil-production-grid',
                    'my-day'
                ]
            },
            
            // PWA Quality Assurance - Access to quality and stock
            'PWA Quality Assurance': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'quality-assurance-grid',
                    'stock-management-grid',
                    'grower-intake-grid', // To view intake data for quality checks
                    'my-day'
                ]
            },
            
            // PWA Stock Management - Access to stock operations
            'PWA Stock Management': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'stock-management-grid',
                    'quality-assurance-grid', // To view quality data
                    'my-day'
                ]
            },
            
            // PWA Sales - Access to sales and forecasting
            'PWA Sales': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'sales-forecasting-grid',
                    'crm-grid',
                    'executive-dashboard',
                    'my-day'
                ]
            },
            
            // PWA Finance - Access to financial data
            'PWA Finance': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'financial-management-grid',
                    'executive-dashboard',
                    'my-day'
                ]
            },
            
            // PWA Document Management - Access to documents
            'PWA Document Management': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'document-management-grid',
                    'my-day'
                ]
            },
            
            // PWA Field Operations - Access to field operations
            'PWA Field Operations': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'grower-intake-grid',
                    'kernel-production-grid',
                    'quality-assurance-grid',
                    'my-day'
                ]
            }
        },

        /**
         * Menu structure with route mapping
         */
        menuStructure: {
            'dashboard': {
                route: 'dashboard',
                icon: 'fas fa-tachometer-alt',
                label: 'Dashboard',
                category: 'main'
            },
            'my-day': {
                route: 'my-day',
                icon: 'fas fa-calendar-day',
                label: 'My Day',
                category: 'main'
            },
            'amanda-dashboard': {
                route: 'amanda-dashboard',
                icon: 'fas fa-chart-line',
                label: 'Material Journey Dashboard',
                category: 'main'
            },
            'executive-dashboard': {
                route: 'executive-dashboard',
                icon: 'fas fa-chart-bar',
                label: 'Executive Dashboard',
                category: 'main'
            },
            'users-grid': {
                route: 'users-grid',
                icon: 'fas fa-user',
                label: 'Users',
                category: 'user-management',
                parent: 'userManagementCollapse'
            },
            'roles-grid': {
                route: 'roles-grid',
                icon: 'fas fa-user-tag',
                label: 'Roles',
                category: 'user-management',
                parent: 'userManagementCollapse'
            },
            'role-permissions-grid': {
                route: 'role-permissions-grid',
                icon: 'fas fa-key',
                label: 'Database Role Permissions',
                category: 'user-management',
                parent: 'userManagementCollapse'
            },
            'role-features-grid': {
                route: 'role-features-grid',
                icon: 'fas fa-cog',
                label: 'Role Features',
                category: 'user-management',
                parent: 'userManagementCollapse'
            },
            'crm-grid': {
                route: 'crm-grid',
                icon: 'fas fa-building',
                label: 'Contacts',
                category: 'crm',
                parent: 'crmCollapse'
            },
            'grower-intake-grid': {
                route: 'grower-intake-grid',
                icon: 'fas fa-truck-loading',
                label: 'Grower Intake',
                category: 'production',
                parent: 'productionCollapse'
            },
            'kernel-production-grid': {
                route: 'kernel-production-grid',
                icon: 'fas fa-cogs',
                label: 'Kernel Production',
                category: 'production',
                parent: 'productionCollapse'
            },
            'oil-production-grid': {
                route: 'oil-production-grid',
                icon: 'fas fa-oil-can',
                label: 'Oil Production',
                category: 'production',
                parent: 'productionCollapse'
            },
            'quality-assurance-grid': {
                route: 'quality-assurance-grid',
                icon: 'fas fa-flask',
                label: 'Quality Assurance',
                category: 'quality',
                parent: 'qualityCollapse'
            },
            'stock-management-grid': {
                route: 'stock-management-grid',
                icon: 'fas fa-warehouse',
                label: 'Stock Management',
                category: 'quality',
                parent: 'qualityCollapse'
            },
            'sales-forecasting-grid': {
                route: 'sales-forecasting-grid',
                icon: 'fas fa-chart-line',
                label: 'Sales Forecasting',
                category: 'business',
                parent: 'businessCollapse'
            },
            'financial-management-grid': {
                route: 'financial-management-grid',
                icon: 'fas fa-money-bill-wave',
                label: 'Financial Management',
                category: 'business',
                parent: 'businessCollapse'
            },
            'document-management-grid': {
                route: 'document-management-grid',
                icon: 'fas fa-file-alt',
                label: 'Document Management',
                category: 'main'
            },
            'palladium-integration-grid': {
                route: 'palladium-integration-grid',
                icon: 'fas fa-sync-alt',
                label: 'Palladium Integration',
                category: 'main'
            },
            'admin-grid': {
                route: 'admin-grid',
                icon: 'fas fa-cog',
                label: 'System Administration',
                category: 'main'
            }
        },

        /**
         * Get user's role name
         */
        getUserRole: function () {
            const userInfo = localStorage.getItem('user_info');
            if (!userInfo) return null;

            try {
                const user = JSON.parse(userInfo);
                return user.role_name || user.role || null;
            } catch (error) {
                console.error('[Role Menu Config] Error parsing user info:', error);
                return null;
            }
        },

        /**
         * Check if user has access to a specific route
         * Currently configured to allow all authenticated users access to all features
         */
        hasAccess: function (route) {
            // Check if user is authenticated (has user_info)
            const userInfo = localStorage.getItem('user_info');
            if (!userInfo) return false;

            // Allow all authenticated users access to all features
            return true;

            /* Original role-based access logic (disabled):
            const roleName = this.getUserRole();
            if (!roleName) return false;

            const roleConfig = this.menuConfig[roleName];
            if (!roleConfig) return false;

            // Super user and admin have all access
            if (roleConfig.access === 'all') {
                return true;
            }

            // Check specific menu access
            if (roleConfig.access === 'specific') {
                return roleConfig.menus.includes(route);
            }

            return false;
            */
        },

        /**
         * Get accessible menus for current user
         * Currently configured to allow all authenticated users access to all menus
         */
        getAccessibleMenus: function () {
            // Check if user is authenticated (has user_info)
            const userInfo = localStorage.getItem('user_info');
            if (!userInfo) return [];

            // Allow all authenticated users access to all menus
            return Object.keys(this.menuStructure);

            /* Original role-based access logic (disabled):
            const roleName = this.getUserRole();
            if (!roleName) return [];

            const roleConfig = this.menuConfig[roleName];
            if (!roleConfig) return [];

            // Super user and admin have all menus
            if (roleConfig.access === 'all') {
                return Object.keys(this.menuStructure);
            }

            // Return specific menus
            if (roleConfig.access === 'specific') {
                return roleConfig.menus || [];
            }

            return [];
            */
        },

        /**
         * Check if user is PWA user
         */
        isPWAUser: function () {
            const roleName = this.getUserRole();
            if (!roleName) return false;

            return roleName.startsWith('PWA ');
        },

        /**
         * Check if user is admin or super user
         */
        isAdminUser: function () {
            const roleName = this.getUserRole();
            if (!roleName) return false;

            return roleName === 'admin' || roleName === 'super_user';
        }
    };
}();

// Create global instance
const roleMenuConfig = _roleMenuConfig;
window.roleMenuConfig = roleMenuConfig;

