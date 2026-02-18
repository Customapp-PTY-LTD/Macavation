// Hope Diamond Transport Admin Portal - Router
// Following WebPortals module pattern

var _appRouter = {
    // Router configuration
    config: {
        basePath: '',
        defaultRoute: 'dashboard',
        routes: {
            'dashboard': {
                module: 'dashboard',
                title: 'Dashboard'
            },
            'users-grid': {
                module: 'users-grid',
                title: 'Users',
                parent: 'User Management'
            },
            'users-form': {
                module: 'users-form',
                title: 'User Form',
                parent: 'User Management'
            },
            'roles-grid': {
                module: 'roles-grid',
                title: 'Roles',
                parent: 'User Management'
            },
            'roles-form': {
                module: 'roles-form',
                title: 'Role Form',
                parent: 'User Management'
            },
            'role-permissions-grid': {
                module: 'role-permissions-grid',
                title: 'Role Permissions',
                parent: 'User Management'
            },
            'role-features-grid': {
                module: 'role-features-grid',
                title: 'Role Features',
                parent: 'User Management'
            }
        }
    },

    // Current route
    currentRoute: null,

    // Initialize router
    init: function () {
        console.log('Router initialized');
        this.setupNavigation();
    },

    // Setup navigation handlers
    setupNavigation: function () {
        // Handle browser back/forward
        window.addEventListener('popstate', (event) => {
            if (event.state && event.state.route) {
                this.navigate(event.state.route, false);
            }
        });

        // Handle initial route
        const initialRoute = this.getRouteFromUrl() || this.config.defaultRoute;
        this.navigate(initialRoute, false);
    },

    // Navigate to route
    navigate: function (routeName, pushState = true) {
        console.log('Navigating to:', routeName);

        if (!this.config.routes[routeName]) {
            console.error('Route not found:', routeName);
            return;
        }

        const route = this.config.routes[routeName];
        this.currentRoute = routeName;

        // Update URL
        if (pushState) {
            const url = this.config.basePath + '#' + routeName;
            history.pushState({ route: routeName }, route.title, url);
        }

        // Update page title
        document.title = route.title + ' - FruitLive';

        // Load module
        if (typeof _app !== 'undefined') {
            _app.loadModule(route.module);
        }

        // Update active navigation
        this.updateActiveNavigation(routeName);
    },

    // Get route from URL
    getRouteFromUrl: function () {
        const hash = window.location.hash.substring(1);
        return hash || null;
    },

    // Update active navigation
    updateActiveNavigation: function (routeName) {
        // Remove active class from all nav links
        document.querySelectorAll('.nav-link, .dropdown-item').forEach(link => {
            link.classList.remove('active');
        });

        // Add active class to current route
        const currentLink = document.querySelector(`[onclick*="${routeName}"]`);
        if (currentLink) {
            currentLink.classList.add('active');
        }
    },

    // Load breadcrumbs
    loadBreadCrumbs: function (containerId) {
        const container = document.getElementById(containerId);
        if (!container || !this.currentRoute) return;

        const route = this.config.routes[this.currentRoute];
        if (!route) return;

        let breadcrumbHtml = '<nav aria-label="breadcrumb"><ol class="breadcrumb">';

        if (route.parent) {
            breadcrumbHtml += `<li class="breadcrumb-item">${route.parent}</li>`;
        }

        breadcrumbHtml += `<li class="breadcrumb-item active" aria-current="page">${route.title}</li>`;
        breadcrumbHtml += '</ol></nav>';

        container.innerHTML = breadcrumbHtml;
    },

    // Get current route
    getCurrentRoute: function () {
        return this.currentRoute;
    },

    // Get route config
    getRouteConfig: function (routeName) {
        return this.config.routes[routeName];
    }
};
