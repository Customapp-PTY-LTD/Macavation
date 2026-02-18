// FruitLive Admin Portal - Main Application
// Updated to work with new router system

// Global application object
var _app = {
    // Application configuration
    config: {
        supabaseUrl: 'https://ekgjuvnrzyacoltcypio.supabase.co',
        supabaseAnonKey: 'your-anon-key-here', // Replace with actual key
        apiBaseUrl: '/api',
        version: '1.0.0'
    },

    // Initialize application
    init: function () {
        console.log('Initializing FruitLive Admin Portal...');

        // Initialize Supabase client
        this.initSupabase();

        // Initialize router
        this.initRouter();

        // Initialize common utilities
        this.initCommon();

        // Initialize the new router system
        this.initializeAppRouter();

        console.log('Application initialized successfully');
    },

    // Initialize Supabase client
    initSupabase: function () {
        if (typeof window.supabase !== 'undefined') {
            window._supabase = window.supabase.createClient(
                this.config.supabaseUrl,
                this.config.supabaseAnonKey
            );
            console.log('Supabase client initialized');
        } else {
            console.warn('Supabase library not loaded');
        }
    },

    // Initialize router
    initRouter: function () {
        // Old router system - keeping for compatibility
        console.log('Old router system available');
    },

    // Initialize new app router system
    initializeAppRouter: function () {
        if (typeof _appRouter !== 'undefined') {
            _appRouter.init();
            console.log('New app router initialized');
        } else {
            console.warn('App router not available');
        }
    },

    // Initialize common utilities
    initCommon: function () {
        if (typeof _common !== 'undefined') {
            _common.init();
            console.log('Common utilities initialized');
        } else {
            console.warn('Common utilities not available');
        }
    },

    // Legacy module loading - redirects to new router
    loadModule: function (moduleName) {
        console.log('Legacy loadModule called for:', moduleName);
        if (typeof _appRouter !== 'undefined') {
            _appRouter.routeTo(moduleName);
        } else {
            console.warn('App router not available for module:', moduleName);
        }
    },

    // Legacy compatibility - all module loading now handled by new router

    // Show loading state
    showLoading: function () {
        const contentArea = document.getElementById('content-area');
        if (contentArea) {
            contentArea.innerHTML = `
                <div class="d-flex justify-content-center align-items-center" style="min-height: 200px;">
                    <div class="text-center">
                        <div class="spinner-border text-primary" role="status">
                            <span class="visually-hidden">Loading...</span>
                        </div>
                        <p class="mt-2 text-muted">Loading...</p>
                    </div>
                </div>
            `;
        }
    },

    // Hide loading state
    hideLoading: function () {
        // Loading state is automatically hidden when content is loaded
    },

    // Show error message
    showError: function (message) {
        const contentArea = document.getElementById('content-area');
        if (contentArea) {
            contentArea.innerHTML = `
                <div class="alert alert-danger" role="alert">
                    <h4 class="alert-heading"><i class="fas fa-exclamation-triangle me-2"></i>Error</h4>
                    <p>${message}</p>
                </div>
            `;
        }
    },

    // Update breadcrumb
    updateBreadcrumb: function (section, subsection) {
        const breadcrumbElement = document.querySelector('.breadcrumb');
        if (breadcrumbElement) {
            let breadcrumbHTML = '<nav aria-label="breadcrumb"><ol class="breadcrumb mb-0">';
            breadcrumbHTML += '<li class="breadcrumb-item"><a href="#" onclick="_appRouter.routeTo(\'users-grid\')">Home</a></li>';
            if (section) {
                breadcrumbHTML += `<li class="breadcrumb-item active" aria-current="page">${section}</li>`;
            }
            if (subsection) {
                breadcrumbHTML += `<li class="breadcrumb-item active" aria-current="page">${subsection}</li>`;
            }
            breadcrumbHTML += '</ol></nav>';
            breadcrumbElement.innerHTML = breadcrumbHTML;
        }
    },

    // Initialize module (legacy compatibility)
    initializeModule: function (moduleName) {
        console.log('Legacy initializeModule called for:', moduleName);
        // New router handles module initialization automatically
    },

    // Initialize module with retry
    initializeModuleWithRetry: function (moduleName, maxRetries = 5) {
        console.log('Legacy initializeModuleWithRetry called for:', moduleName);
        // New router handles module initialization automatically
    }
};

// Initialize application when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    _app.init();
});

// Make app globally available
window.app = _app;
