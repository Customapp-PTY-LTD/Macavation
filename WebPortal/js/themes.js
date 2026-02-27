/**
 * Macavation Theme System (Simplified)
 * Single light theme — design tokens are in css/design-tokens.css
 */

const ThemeManager = {
    init: function() {
        // Remove any legacy dark-mode attributes
        document.documentElement.removeAttribute('data-theme-mode');
        document.body.removeAttribute('data-bs-theme');
        document.documentElement.setAttribute('data-theme', 'macavation');

        // Clear any inline CSS variable overrides from old theme system
        var root = document.documentElement;
        var oldVars = [
            '--phoenix-primary', '--phoenix-primary-rgb',
            '--phoenix-secondary', '--phoenix-secondary-rgb',
            '--phoenix-tertiary', '--phoenix-tertiary-rgb',
            '--phoenix-success', '--phoenix-success-rgb',
            '--phoenix-info', '--phoenix-info-rgb',
            '--phoenix-warning', '--phoenix-warning-rgb',
            '--phoenix-danger', '--phoenix-danger-rgb',
            '--phoenix-light', '--phoenix-light-rgb',
            '--phoenix-dark', '--phoenix-dark-rgb',
            '--phoenix-body-bg', '--phoenix-card-bg',
            '--phoenix-text-color', '--phoenix-border-color',
            '--theme-sidebar-bg', '--theme-sidebar-text',
            '--theme-sidebar-active', '--theme-sidebar-hover',
            '--theme-navbar-gradient', '--theme-accent'
        ];
        oldVars.forEach(function(v) { root.style.removeProperty(v); });
    },

    getCurrentTheme: function() { return 'macavation'; },
    getTheme: function() { return { name: 'Macavation', isDark: false }; },
    getAllThemes: function() { return {}; },
    applyTheme: function() {},
    setupThemeSelector: function() {},
    updateThemeSelectorUI: function() {},
    toggleDarkMode: function() {},
    isDarkMode: function() { return false; }
};

document.addEventListener('DOMContentLoaded', function() {
    ThemeManager.init();
});

window.ThemeManager = ThemeManager;
