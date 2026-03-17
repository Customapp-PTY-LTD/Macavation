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
                access: 'all'
            },
            'admin': {
                access: 'all'
            },

            'Sales Exec': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'batch-journey',
                    'grower-intake-grid',
                    'kernel-production-grid',
                    'stock-management-kernel',
                    'kernel-dispatch-grid',
                    'document-management-grid',
                    'users-grid',
                    'admin-grid'
                ]
            },

            'Factory Manager': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'batch-journey',
                    'grower-intake-grid',
                    'kernel-production-grid',
                    'stock-management-kernel',
                    'kernel-dispatch-grid',
                    'document-management-grid'
                ]
            },

            'Quality Assurance': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'batch-journey',
                    'grower-intake-grid',
                    'kernel-production-grid',
                    'stock-management-kernel',
                    'kernel-dispatch-grid',
                    'document-management-grid'
                ]
            },

            'Palladium Manager': {
                access: 'specific',
                menus: [
                    'kernel-production-grid',
                    'stock-management-kernel',
                    'kernel-dispatch-grid',
                    'document-management-grid'
                ]
            },

            'Production Manager': {
                access: 'specific',
                menus: [
                    'grower-intake-grid',
                    'kernel-production-grid',
                    'kernel-dispatch-grid'
                ]
            },

            'Shareholder': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'batch-journey',
                    'grower-intake-grid',
                    'kernel-production-grid',
                    'stock-management-kernel',
                    'kernel-dispatch-grid',
                    'document-management-grid'
                ]
            },

            // Management roles - Full access (refine later)
            'General Manager': {
                access: 'all'
            },
            'Production Manager': {
                access: 'all'
            },
            'QA Supervisor': {
                access: 'all'
            },
            'Oil Plant Manager': {
                access: 'all'
            },
            'Office Administrator': {
                access: 'all'
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
                    'supplier-intake-grid',
                    'my-day'
                ]
            },

            // PWA Quality Assurance - Access to quality and stock
            'PWA Quality Assurance': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'quality-assurance-grid',
                    'stock-management-kernel',
                    'stock-management-oil',
                    'grower-intake-grid',
                    'my-day'
                ]
            },

            // PWA Stock Management - Access to stock operations
            'PWA Stock Management': {
                access: 'specific',
                menus: [
                    'dashboard',
                    'stock-management-kernel',
                    'stock-management-oil',
                    'quality-assurance-grid',
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
            },

            // KP Data Admin - Production section only
            'KP Data Admin': {
                access: 'specific',
                menus: [
                    'grower-intake-grid',
                    'kernel-production-grid',
                    'oil-production-grid',
                    'supplier-intake-grid'
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
                label: 'Pallandium Integrator Dashboard',
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
            'features-grid': {
                route: 'features-grid',
                icon: 'fas fa-puzzle-piece',
                label: 'Features',
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
                category: 'kernel',
                parent: 'kernelCollapse'
            },
            'kernel-production-grid': {
                route: 'kernel-production-grid',
                icon: 'fas fa-cogs',
                label: 'Kernel Production',
                category: 'kernel',
                parent: 'kernelCollapse'
            },
            'stock-management-kernel': {
                route: 'stock-management-kernel',
                icon: 'fas fa-warehouse',
                label: 'Stock (Kernel)',
                category: 'kernel',
                parent: 'kernelCollapse'
            },
            'kernel-dispatch-grid': {
                route: 'kernel-dispatch-grid',
                icon: 'fas fa-box',
                label: 'Kernel Dispatch',
                category: 'kernel',
                parent: 'kernelCollapse'
            },
            'supplier-intake-grid': {
                route: 'supplier-intake-grid',
                icon: 'fas fa-dolly',
                label: 'Supplier Intake',
                category: 'oil',
                parent: 'oilCollapse'
            },
            'oil-production-grid': {
                route: 'oil-production-grid',
                icon: 'fas fa-industry',
                label: 'Oil Production',
                category: 'oil',
                parent: 'oilCollapse'
            },
            'stock-management-oil': {
                route: 'stock-management-oil',
                icon: 'fas fa-warehouse',
                label: 'Stock (Oil & Protein)',
                category: 'oil',
                parent: 'oilCollapse'
            },
            'oil-dispatch-grid': {
                route: 'oil-dispatch-grid',
                icon: 'fas fa-box-open',
                label: 'Oil & Protein Dispatch',
                category: 'oil',
                parent: 'oilCollapse'
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
            // Note: stock-management-kernel and stock-management-oil are defined above under kernel/oil categories
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
            const user = Session.get('user');
            if (!user) return null;
            return user.role_name || user.role || null;
        },

        /**
         * Get role config by name (case-insensitive match so DB "Quality assurance" matches "Quality Assurance").
         */
        _getRoleConfig: function (roleName) {
            if (!roleName) return null;
            var exact = this.menuConfig[roleName];
            if (exact) return exact;
            var lower = (typeof roleName === 'string' ? roleName : '').toLowerCase();
            for (var key in this.menuConfig) {
                if (key.toLowerCase() === lower) return this.menuConfig[key];
            }
            return null;
        },

        /**
         * Check if user has access to a specific route.
         * Uses DB featureKeys when present; also allows access if fallback role config includes the route.
         */
        hasAccess: function (route) {
            if (!Session.get('user')) return false;

            // Admin bypass
            if (this.isAdminUser()) return true;

            // 1. DB-cached features: allow if route is in keys
            var keys = Session.get('featureKeys');
            if (Array.isArray(keys) && keys.indexOf(route) !== -1) return true;

            // 2. If we have keys but route not in keys, still allow if fallback config includes it (avoids deny when DB is out of sync)
            var roleName = this.getUserRole();
            if (roleName) {
                var roleConfig = this._getRoleConfig(roleName);
                if (roleConfig) {
                    if (roleConfig.access === 'all') return true;
                    if (roleConfig.access === 'specific' && roleConfig.menus && roleConfig.menus.indexOf(route) !== -1) return true;
                }
            }

            return false;
        },

        /**
         * Get accessible menus for current user.
         * Prefers DB-cached features, falls back to hardcoded config (case-insensitive role match).
         */
        getAccessibleMenus: function () {
            if (!Session.get('user')) return [];

            // Admin bypass
            if (this.isAdminUser()) return Object.keys(this.menuStructure);

            // 1. DB-cached features (preferred)
            var keys = Session.get('featureKeys');
            if (Array.isArray(keys) && keys.length > 0) return keys;

            // 2. Fallback to hardcoded config
            var roleName = this.getUserRole();
            if (!roleName) return [];

            var roleConfig = this._getRoleConfig(roleName);
            if (!roleConfig) return [];

            if (roleConfig.access === 'all') return Object.keys(this.menuStructure);
            if (roleConfig.access === 'specific') return roleConfig.menus || [];

            return [];
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

            var roleConfig = this._getRoleConfig(roleName);
            return roleConfig && roleConfig.access === 'all';
        },

        /**
         * Check if user is KP Data Admin (production section only)
         */
        isKpDataAdmin: function () {
            return this.getUserRole() === 'KP Data Admin';
        }
    };
}();

// Create global instance
const roleMenuConfig = _roleMenuConfig;
window.roleMenuConfig = roleMenuConfig;

