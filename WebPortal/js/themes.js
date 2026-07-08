/**
 * Macavation Theme System
 * Light + Dark mode — design tokens are in css/design-tokens.css
 */

const ThemeManager = {
    init: function() {
        document.documentElement.setAttribute('data-theme', 'macavation');

        // Clear any inline CSS variable overrides from old theme system
        var root = document.documentElement;
        var oldVars = [
            '--mac-green', '--mac-green-rgb',
            '--mac-border', '--mac-border-rgb',
            '--phoenix-tertiary', '--phoenix-tertiary-rgb',
            '--mac-success', '--mac-success-rgb',
            '--mac-info', '--mac-info-rgb',
            '--mac-warning', '--mac-warning-rgb',
            '--mac-danger', '--mac-danger-rgb',
            '--mac-bg-tertiary', '--mac-bg-tertiary-rgb',
            '--mac-text', '--mac-text-rgb',
            '--mac-bg', '--mac-bg-secondary',
            '--mac-text', '--mac-border',
            '--theme-sidebar-bg', '--theme-sidebar-text',
            '--theme-sidebar-active', '--theme-sidebar-hover',
            '--theme-navbar-gradient', '--theme-accent'
        ];
        oldVars.forEach(function(v) { root.style.removeProperty(v); });

        // Restore dark mode preference
        var saved = localStorage.getItem('mac-dark-mode');
        if (saved === 'true') {
            this._applyDark(true);
        } else {
            this._applyDark(false);
        }
    },

    getCurrentTheme: function() { return 'macavation'; },
    getTheme: function() { return { name: 'Macavation', isDark: this.isDarkMode() }; },
    getAllThemes: function() { return {}; },
    applyTheme: function() {},
    setupThemeSelector: function() {},
    updateThemeSelectorUI: function() {},

    toggleDarkMode: function() {
        var nowDark = !this.isDarkMode();
        localStorage.setItem('mac-dark-mode', nowDark ? 'true' : 'false');
        this._applyDark(nowDark);
    },

    isDarkMode: function() {
        return document.documentElement.getAttribute('data-theme-mode') === 'dark';
    },

    _applyDark: function(dark) {
        if (dark) {
            document.documentElement.setAttribute('data-theme-mode', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme-mode');
        }
        // Update toggle button if it exists
        var btn = document.getElementById('darkModeToggle');
        if (btn) {
            var icon = btn.querySelector('i');
            var label = btn.querySelector('.toggle-text');
            if (icon) {
                icon.className = dark ? 'fas fa-sun me-2' : 'fas fa-moon me-2';
            }
            if (label) {
                label.textContent = dark ? 'Light mode' : 'Dark mode';
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', function() {
    ThemeManager.init();
});

window.ThemeManager = ThemeManager;
