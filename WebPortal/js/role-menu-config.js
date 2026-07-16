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
                    'kernel-production-forecast-grid',
                    'stock-management-kernel',
                    'kernel-dispatch-grid',
                    'document-management-grid',
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
                    'kernel-production-forecast-grid',
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
                    'kernel-production-forecast-grid',
                    'stock-management-kernel',
                    'kernel-dispatch-grid',
                    'document-management-grid'
                ]
            },

            'Palladium Manager': {
                access: 'specific',
                menus: [
                    'kernel-production-grid',
                    'kernel-production-forecast-grid',
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
                    'kernel-production-forecast-grid',
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
                    'kernel-production-forecast-grid',
                    'stock-management-kernel',
                    'kernel-dispatch-grid',
                    'document-management-grid'
                ]
            },

            // Management roles - Full access (refine later)
            'General Manager': {
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
                    'kernel-production-forecast-grid',
                    'oil-production-grid',
                    'oil-production-forecast-grid',
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
                    'kernel-production-forecast-grid',
                    'stock-management-oil',
                    'oil-production-forecast-grid',
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
                    'kernel-production-forecast-grid',
                    'stock-management-oil',
                    'oil-production-forecast-grid',
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
                    'kernel-production-forecast-grid',
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
                    'kernel-production-forecast-grid',
                    'oil-production-grid',
                    'oil-production-forecast-grid',
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
            'batch-journey': {
                route: 'batch-journey',
                icon: 'fas fa-search',
                label: 'Find a batch',
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
            'kernel-production-forecast-grid': {
                route: 'kernel-production-forecast-grid',
                icon: 'fas fa-clipboard-list',
                label: 'Kernel forecast',
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
            'oil-production-forecast-grid': {
                route: 'oil-production-forecast-grid',
                icon: 'fas fa-clipboard-list',
                label: 'Oil forecast',
                category: 'oil',
                parent: 'oilCollapse'
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
                label: 'Documents',
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
                icon: 'fas fa-user-shield',
                label: 'User & access',
                category: 'user-management',
                parent: 'userManagementCollapse'
            },
            'dashboard-targets-grid': {
                route: 'dashboard-targets-grid',
                icon: 'fas fa-bullseye',
                label: 'Dashboard Targets',
                category: 'user-management',
                parent: 'userManagementCollapse'
            },
            'stock-alert-rules-grid': {
                route: 'stock-alert-rules-grid',
                icon: 'fas fa-flag',
                label: 'Stock Alert Rules',
                category: 'user-management',
                parent: 'userManagementCollapse'
            },
            'scheduled-reports-grid': {
                route: 'scheduled-reports-grid',
                icon: 'fas fa-paper-plane',
                label: 'Scheduled Reports',
                category: 'user-management',
                parent: 'userManagementCollapse'
            },
            'messaging-compose-grid': {
                route: 'messaging-compose-grid',
                icon: 'fas fa-paper-plane',
                label: 'Send Message',
                category: 'user-management',
                parent: 'userManagementCollapse'
            }
        },

        /**
         * Human-readable module label as shown in the sidebar (Customize modules, etc.).
         * Prefers live sidebar link text, then menuStructure.label, then fallbackName.
         */
        getPortalModuleLabel: function (featureKey, fallbackName) {
            var key = featureKey != null ? String(featureKey) : '';
            if (!key) {
                return fallbackName != null ? String(fallbackName) : '';
            }

            try {
                if (typeof document !== 'undefined') {
                    var link = null;
                    var sidebarLinks = document.querySelectorAll('#sidebarMenu a[route]');
                    for (var li = 0; li < sidebarLinks.length; li++) {
                        if (sidebarLinks[li].getAttribute('route') === key) {
                            link = sidebarLinks[li];
                            break;
                        }
                    }
                    if (link) {
                        var clone = link.cloneNode(true);
                        var icons = clone.querySelectorAll('i');
                        for (var i = 0; i < icons.length; i++) {
                            icons[i].parentNode.removeChild(icons[i]);
                        }
                        var text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
                        if (text) return text;
                    }
                }
            } catch (e) { /* ignore */ }

            var entry = this.menuStructure[key];
            if (entry && entry.label) {
                return entry.label;
            }

            return fallbackName != null ? String(fallbackName) : key;
        },

        /**
         * Sidebar route order (matches index.html). Used when DOM is unavailable.
         */
        portalModuleOrder: [
            'dashboard',
            'my-day',
            'batch-journey',
            'grower-intake-grid',
            'kernel-production-grid',
            'stock-management-kernel',
            'kernel-dispatch-grid',
            'supplier-intake-grid',
            'oil-production-grid',
            'stock-management-oil',
            'oil-dispatch-grid',
            'kernel-production-forecast-grid',
            'oil-production-forecast-grid',
            'crm-grid',
            'quality-assurance-grid',
            'document-management-grid',
            'sales-forecasting-grid',
            'financial-management-grid',
            'palladium-integration-grid',
            'admin-grid',
            'features-grid',
            'dashboard-targets-grid',
            'stock-alert-rules-grid',
            'scheduled-reports-grid',
            'messaging-compose-grid',
            'executive-dashboard',
            'amanda-dashboard',
            'users-grid',
            'roles-grid',
            'role-permissions-grid',
            'role-features-grid',
            'stock-management-grid'
        ],

        /** Route keys in sidebar DOM order (top to bottom). */
        getPortalModuleOrder: function () {
            var order = [];
            var seen = {};
            try {
                if (typeof document !== 'undefined') {
                    var items = document.querySelectorAll('#sidebarMenu [data-route]');
                    for (var i = 0; i < items.length; i++) {
                        var route = items[i].getAttribute('data-route');
                        if (route && !seen[route]) {
                            seen[route] = true;
                            order.push(route);
                        }
                    }
                    if (order.length) {
                        return order;
                    }
                }
            } catch (e) { /* ignore */ }
            return this.portalModuleOrder.slice();
        },

        /** Sort feature rows for Customize / Role Features to match sidebar order. */
        sortFeaturesByPortalOrder: function (features) {
            if (!Array.isArray(features) || !features.length) {
                return features || [];
            }
            var order = this.getPortalModuleOrder();
            var indexMap = {};
            for (var i = 0; i < order.length; i++) {
                indexMap[order[i]] = i;
            }
            var unknownBase = order.length;
            return features.slice().sort(function (a, b) {
                var ak = a && a.key != null ? String(a.key) : '';
                var bk = b && b.key != null ? String(b.key) : '';
                var ai = Object.prototype.hasOwnProperty.call(indexMap, ak) ? indexMap[ak] : unknownBase;
                var bi = Object.prototype.hasOwnProperty.call(indexMap, bk) ? indexMap[bk] : unknownBase;
                if (ai !== bi) {
                    return ai - bi;
                }
                var an = (a && a.name) ? String(a.name) : ak;
                var bn = (b && b.name) ? String(b.name) : bk;
                return an.localeCompare(bn);
            });
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

            var roleName = this.getUserRole();
            if (roleName) {
                var normalizedRole = String(roleName).toLowerCase().replace(/\s+/g, '_');
                if (normalizedRole === 'admin' || normalizedRole === 'super_user') return true;
            }

            // DB-cached features are authoritative once loaded (including an empty list).
            var keys = Session.get('featureKeys');
            if (Array.isArray(keys)) {
                return keys.indexOf(route) !== -1;
            }

            // Fallback before feature keys are cached at login (role-menu-config only).
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

            // 1. DB-cached features (preferred; empty array means nothing enabled)
            var keys = Session.get('featureKeys');
            if (Array.isArray(keys)) return keys;

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
            var normalized = String(roleName).toLowerCase();
            return normalized === 'admin' || normalized === 'super_user';
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

