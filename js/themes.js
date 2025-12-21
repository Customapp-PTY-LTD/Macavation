/**
 * FruitLive Theme System
 * Dynamically applies UI themes across the application
 */

const ThemeManager = {
    // Theme definitions
    themes: {
        'orchard-green': {
            name: 'Orchard Green',
            icon: 'fa-leaf',
            description: 'Fresh, natural, and professional',
            isDark: false,
            colors: {
                '--phoenix-primary': '#2d6a4f',
                '--phoenix-primary-rgb': '45, 106, 79',
                '--phoenix-secondary': '#52796f',
                '--phoenix-secondary-rgb': '82, 121, 111',
                '--phoenix-success': '#52b788',
                '--phoenix-success-rgb': '82, 183, 136',
                '--phoenix-info': '#0ea5e9',
                '--phoenix-info-rgb': '14, 165, 233',
                '--phoenix-warning': '#fbbf24',
                '--phoenix-warning-rgb': '251, 191, 36',
                '--phoenix-danger': '#ef4444',
                '--phoenix-danger-rgb': '239, 68, 68',
                '--phoenix-light': '#f0fdf4',
                '--phoenix-light-rgb': '240, 253, 244',
                '--phoenix-dark': '#14532d',
                '--phoenix-dark-rgb': '20, 83, 45',
                '--phoenix-body-bg': '#f0fdf4',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#1f2937',
                '--phoenix-border-color': '#bbf7d0',
                '--theme-sidebar-bg': '#1b4332',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.8)',
                '--theme-sidebar-active': '#40916c',
                '--theme-sidebar-hover': 'rgba(64, 145, 108, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #2d6a4f, #40916c)',
                '--theme-accent': '#95d5b2'
            }
        },
        'harvest-gold': {
            name: 'Harvest Gold',
            icon: 'fa-wheat-awn',
            description: 'Warm tones of golden fields',
            isDark: false,
            colors: {
                '--phoenix-primary': '#b07d2b',
                '--phoenix-primary-rgb': '176, 125, 43',
                '--phoenix-secondary': '#78716c',
                '--phoenix-secondary-rgb': '120, 113, 108',
                '--phoenix-success': '#6b8e23',
                '--phoenix-success-rgb': '107, 142, 35',
                '--phoenix-info': '#0ea5e9',
                '--phoenix-info-rgb': '14, 165, 233',
                '--phoenix-warning': '#f59e0b',
                '--phoenix-warning-rgb': '245, 158, 11',
                '--phoenix-danger': '#dc2626',
                '--phoenix-danger-rgb': '220, 38, 38',
                '--phoenix-light': '#fefce8',
                '--phoenix-light-rgb': '254, 252, 232',
                '--phoenix-dark': '#422006',
                '--phoenix-dark-rgb': '66, 32, 6',
                '--phoenix-body-bg': '#fffbeb',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#292524',
                '--phoenix-border-color': '#fde68a',
                '--theme-sidebar-bg': '#5c4033',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.85)',
                '--theme-sidebar-active': '#d4a84f',
                '--theme-sidebar-hover': 'rgba(212, 168, 79, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #b07d2b, #d4a84f)',
                '--theme-accent': '#f5deb3'
            }
        },
        'irrigation-blue': {
            name: 'Irrigation Blue',
            icon: 'fa-droplet',
            description: 'Cool and professional',
            isDark: false,
            colors: {
                '--phoenix-primary': '#0077b6',
                '--phoenix-primary-rgb': '0, 119, 182',
                '--phoenix-secondary': '#6b7280',
                '--phoenix-secondary-rgb': '107, 114, 128',
                '--phoenix-success': '#38b000',
                '--phoenix-success-rgb': '56, 176, 0',
                '--phoenix-info': '#00b4d8',
                '--phoenix-info-rgb': '0, 180, 216',
                '--phoenix-warning': '#fbbf24',
                '--phoenix-warning-rgb': '251, 191, 36',
                '--phoenix-danger': '#ef4444',
                '--phoenix-danger-rgb': '239, 68, 68',
                '--phoenix-light': '#f0f9ff',
                '--phoenix-light-rgb': '240, 249, 255',
                '--phoenix-dark': '#023e8a',
                '--phoenix-dark-rgb': '2, 62, 138',
                '--phoenix-body-bg': '#f0f9ff',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#1e3a5f',
                '--phoenix-border-color': '#bae6fd',
                '--theme-sidebar-bg': '#023e8a',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.85)',
                '--theme-sidebar-active': '#48cae4',
                '--theme-sidebar-hover': 'rgba(72, 202, 228, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #0077b6, #48cae4)',
                '--theme-accent': '#90e0ef'
            }
        },
        'twilight-field': {
            name: 'Twilight Field',
            icon: 'fa-moon',
            description: 'Elegant dark mode',
            isDark: true,
            colors: {
                '--phoenix-primary': '#7c3aed',
                '--phoenix-primary-rgb': '124, 58, 237',
                '--phoenix-secondary': '#64748b',
                '--phoenix-secondary-rgb': '100, 116, 139',
                '--phoenix-success': '#10b981',
                '--phoenix-success-rgb': '16, 185, 129',
                '--phoenix-info': '#06b6d4',
                '--phoenix-info-rgb': '6, 182, 212',
                '--phoenix-warning': '#f59e0b',
                '--phoenix-warning-rgb': '245, 158, 11',
                '--phoenix-danger': '#f43f5e',
                '--phoenix-danger-rgb': '244, 63, 94',
                '--phoenix-light': '#1e1e2e',
                '--phoenix-light-rgb': '30, 30, 46',
                '--phoenix-dark': '#0f0f1a',
                '--phoenix-dark-rgb': '15, 15, 26',
                '--phoenix-body-bg': '#0f0f1a',
                '--phoenix-card-bg': '#1a1a2e',
                '--phoenix-text-color': '#e2e8f0',
                '--phoenix-border-color': '#334155',
                '--theme-sidebar-bg': '#16213e',
                '--theme-sidebar-text': 'rgba(226, 232, 240, 0.85)',
                '--theme-sidebar-active': '#a78bfa',
                '--theme-sidebar-hover': 'rgba(167, 139, 250, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #1e1b4b, #4c1d95)',
                '--theme-accent': '#c4b5fd'
            }
        },
        'citrus-sunrise': {
            name: 'Citrus Sunrise',
            icon: 'fa-sun',
            description: 'Vibrant and energetic',
            isDark: false,
            colors: {
                '--phoenix-primary': '#ea580c',
                '--phoenix-primary-rgb': '234, 88, 12',
                '--phoenix-secondary': '#64748b',
                '--phoenix-secondary-rgb': '100, 116, 139',
                '--phoenix-success': '#16a34a',
                '--phoenix-success-rgb': '22, 163, 74',
                '--phoenix-info': '#0ea5e9',
                '--phoenix-info-rgb': '14, 165, 233',
                '--phoenix-warning': '#fcd34d',
                '--phoenix-warning-rgb': '252, 211, 77',
                '--phoenix-danger': '#dc2626',
                '--phoenix-danger-rgb': '220, 38, 38',
                '--phoenix-light': '#fff7ed',
                '--phoenix-light-rgb': '255, 247, 237',
                '--phoenix-dark': '#7c2d12',
                '--phoenix-dark-rgb': '124, 45, 18',
                '--phoenix-body-bg': '#fff7ed',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#1c1917',
                '--phoenix-border-color': '#fed7aa',
                '--theme-sidebar-bg': '#1e293b',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.85)',
                '--theme-sidebar-active': '#fb923c',
                '--theme-sidebar-hover': 'rgba(251, 146, 60, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #ea580c, #fb923c)',
                '--theme-accent': '#fcd34d'
            }
        },
        'apple-orchard': {
            name: 'Apple Orchard',
            icon: 'fa-apple-alt',
            description: 'Crisp red and fresh green',
            isDark: false,
            colors: {
                '--phoenix-primary': '#dc2626',
                '--phoenix-primary-rgb': '220, 38, 38',
                '--phoenix-secondary': '#64748b',
                '--phoenix-secondary-rgb': '100, 116, 139',
                '--phoenix-success': '#16a34a',
                '--phoenix-success-rgb': '22, 163, 74',
                '--phoenix-info': '#3b82f6',
                '--phoenix-info-rgb': '59, 130, 246',
                '--phoenix-warning': '#f59e0b',
                '--phoenix-warning-rgb': '245, 158, 11',
                '--phoenix-danger': '#ef4444',
                '--phoenix-danger-rgb': '239, 68, 68',
                '--phoenix-light': '#fef2f2',
                '--phoenix-light-rgb': '254, 242, 242',
                '--phoenix-dark': '#991b1b',
                '--phoenix-dark-rgb': '153, 27, 27',
                '--phoenix-body-bg': '#fef2f2',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#1f2937',
                '--phoenix-border-color': '#fecaca',
                '--theme-sidebar-bg': '#7f1d1d',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.85)',
                '--theme-sidebar-active': '#f87171',
                '--theme-sidebar-hover': 'rgba(248, 113, 113, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #dc2626, #ef4444)',
                '--theme-accent': '#fca5a5'
            }
        },
        'citrus-grove': {
            name: 'Citrus Grove',
            icon: 'fa-lemon',
            description: 'Vibrant orange and sunny yellow',
            isDark: false,
            colors: {
                '--phoenix-primary': '#f97316',
                '--phoenix-primary-rgb': '249, 115, 22',
                '--phoenix-secondary': '#78716c',
                '--phoenix-secondary-rgb': '120, 113, 108',
                '--phoenix-success': '#22c55e',
                '--phoenix-success-rgb': '34, 197, 94',
                '--phoenix-info': '#0ea5e9',
                '--phoenix-info-rgb': '14, 165, 233',
                '--phoenix-warning': '#eab308',
                '--phoenix-warning-rgb': '234, 179, 8',
                '--phoenix-danger': '#ef4444',
                '--phoenix-danger-rgb': '239, 68, 68',
                '--phoenix-light': '#fff7ed',
                '--phoenix-light-rgb': '255, 247, 237',
                '--phoenix-dark': '#9a3412',
                '--phoenix-dark-rgb': '154, 52, 18',
                '--phoenix-body-bg': '#fff7ed',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#1c1917',
                '--phoenix-border-color': '#fed7aa',
                '--theme-sidebar-bg': '#7c2d12',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.85)',
                '--theme-sidebar-active': '#fb923c',
                '--theme-sidebar-hover': 'rgba(251, 146, 60, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #f97316, #fb923c)',
                '--theme-accent': '#fcd34d'
            }
        },
        'vineyard': {
            name: 'Vineyard',
            icon: 'fa-wine-bottle',
            description: 'Rich purple and deep burgundy',
            isDark: false,
            colors: {
                '--phoenix-primary': '#7c3aed',
                '--phoenix-primary-rgb': '124, 58, 237',
                '--phoenix-secondary': '#64748b',
                '--phoenix-secondary-rgb': '100, 116, 139',
                '--phoenix-success': '#10b981',
                '--phoenix-success-rgb': '16, 185, 129',
                '--phoenix-info': '#06b6d4',
                '--phoenix-info-rgb': '6, 182, 212',
                '--phoenix-warning': '#f59e0b',
                '--phoenix-warning-rgb': '245, 158, 11',
                '--phoenix-danger': '#dc2626',
                '--phoenix-danger-rgb': '220, 38, 38',
                '--phoenix-light': '#faf5ff',
                '--phoenix-light-rgb': '250, 245, 255',
                '--phoenix-dark': '#4c1d95',
                '--phoenix-dark-rgb': '76, 29, 149',
                '--phoenix-body-bg': '#faf5ff',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#1e1b4b',
                '--phoenix-border-color': '#e9d5ff',
                '--theme-sidebar-bg': '#4c1d95',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.85)',
                '--theme-sidebar-active': '#a78bfa',
                '--theme-sidebar-hover': 'rgba(167, 139, 250, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #7c3aed, #a78bfa)',
                '--theme-accent': '#c4b5fd'
            }
        },
        'berry-patch': {
            name: 'Berry Patch',
            icon: 'fa-seedling',
            description: 'Sweet pink and vibrant red',
            isDark: false,
            colors: {
                '--phoenix-primary': '#ec4899',
                '--phoenix-primary-rgb': '236, 72, 153',
                '--phoenix-secondary': '#64748b',
                '--phoenix-secondary-rgb': '100, 116, 139',
                '--phoenix-success': '#10b981',
                '--phoenix-success-rgb': '16, 185, 129',
                '--phoenix-info': '#06b6d4',
                '--phoenix-info-rgb': '6, 182, 212',
                '--phoenix-warning': '#f59e0b',
                '--phoenix-warning-rgb': '245, 158, 11',
                '--phoenix-danger': '#dc2626',
                '--phoenix-danger-rgb': '220, 38, 38',
                '--phoenix-light': '#fdf2f8',
                '--phoenix-light-rgb': '253, 242, 248',
                '--phoenix-dark': '#9f1239',
                '--phoenix-dark-rgb': '159, 18, 57',
                '--phoenix-body-bg': '#fdf2f8',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#1f2937',
                '--phoenix-border-color': '#fbcfe8',
                '--theme-sidebar-bg': '#831843',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.85)',
                '--theme-sidebar-active': '#f472b6',
                '--theme-sidebar-hover': 'rgba(244, 114, 182, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #ec4899, #f472b6)',
                '--theme-accent': '#f9a8d4'
            }
        },
        'stone-fruit': {
            name: 'Stone Fruit',
            icon: 'fa-circle',
            description: 'Warm peach and soft apricot',
            isDark: false,
            colors: {
                '--phoenix-primary': '#fb7185',
                '--phoenix-primary-rgb': '251, 113, 133',
                '--phoenix-secondary': '#78716c',
                '--phoenix-secondary-rgb': '120, 113, 108',
                '--phoenix-success': '#22c55e',
                '--phoenix-success-rgb': '34, 197, 94',
                '--phoenix-info': '#0ea5e9',
                '--phoenix-info-rgb': '14, 165, 233',
                '--phoenix-warning': '#fbbf24',
                '--phoenix-warning-rgb': '251, 191, 36',
                '--phoenix-danger': '#ef4444',
                '--phoenix-danger-rgb': '239, 68, 68',
                '--phoenix-light': '#fff1f2',
                '--phoenix-light-rgb': '255, 241, 242',
                '--phoenix-dark': '#9f1239',
                '--phoenix-dark-rgb': '159, 18, 57',
                '--phoenix-body-bg': '#fff1f2',
                '--phoenix-card-bg': '#ffffff',
                '--phoenix-text-color': '#1f2937',
                '--phoenix-border-color': '#fecdd3',
                '--theme-sidebar-bg': '#be185d',
                '--theme-sidebar-text': 'rgba(255, 255, 255, 0.85)',
                '--theme-sidebar-active': '#fb7185',
                '--theme-sidebar-hover': 'rgba(251, 113, 133, 0.15)',
                '--theme-navbar-gradient': 'linear-gradient(135deg, #fb7185, #fda4af)',
                '--theme-accent': '#fecdd3'
            }
        }
    },

    // Default theme
    defaultTheme: 'irrigation-blue',

    // Storage key
    storageKey: 'fruitlive_theme',

    /**
     * Initialize the theme system
     */
    init: function() {
        // Load saved theme or use default
        const savedTheme = localStorage.getItem(this.storageKey) || this.defaultTheme;
        this.applyTheme(savedTheme, false);
        
        // Set up theme selector if it exists
        this.setupThemeSelector();
        
        console.log('🎨 ThemeManager initialized with theme:', savedTheme);
    },

    /**
     * Apply a theme by ID
     * @param {string} themeId - The theme ID to apply
     * @param {boolean} animate - Whether to animate the transition
     */
    applyTheme: function(themeId, animate = true) {
        const theme = this.themes[themeId];
        if (!theme) {
            console.warn('Theme not found:', themeId);
            return;
        }

        const root = document.documentElement;

        // Add transition class for smooth color changes
        if (animate) {
            root.classList.add('theme-transitioning');
        }

        // Apply all CSS variables
        Object.entries(theme.colors).forEach(([property, value]) => {
            root.style.setProperty(property, value);
        });

        // Set dark mode attribute
        if (theme.isDark) {
            document.body.setAttribute('data-bs-theme', 'dark');
            root.setAttribute('data-theme-mode', 'dark');
        } else {
            document.body.removeAttribute('data-bs-theme');
            root.setAttribute('data-theme-mode', 'light');
        }

        // Set current theme attribute
        root.setAttribute('data-theme', themeId);

        // Save to localStorage
        localStorage.setItem(this.storageKey, themeId);

        // Update theme selector UI
        this.updateThemeSelectorUI(themeId);

        // Remove transition class after animation
        if (animate) {
            setTimeout(() => {
                root.classList.remove('theme-transitioning');
            }, 300);
        }

        // Dispatch custom event for other components to react
        window.dispatchEvent(new CustomEvent('themechange', { 
            detail: { themeId, theme } 
        }));
    },

    /**
     * Get the current theme ID
     * @returns {string} Current theme ID
     */
    getCurrentTheme: function() {
        return localStorage.getItem(this.storageKey) || this.defaultTheme;
    },

    /**
     * Get theme configuration by ID
     * @param {string} themeId - Theme ID
     * @returns {object} Theme configuration
     */
    getTheme: function(themeId) {
        return this.themes[themeId];
    },

    /**
     * Get all available themes
     * @returns {object} All themes
     */
    getAllThemes: function() {
        return this.themes;
    },

    /**
     * Set up the theme selector dropdown
     */
    setupThemeSelector: function() {
        const selector = document.getElementById('themeSelector');
        if (!selector) return;

        // Build dropdown items
        const dropdownMenu = selector.querySelector('.dropdown-menu');
        if (!dropdownMenu) return;

        dropdownMenu.innerHTML = '';

        Object.entries(this.themes).forEach(([id, theme]) => {
            const item = document.createElement('li');
            item.innerHTML = `
                <a class="dropdown-item theme-option d-flex align-items-center" href="#" data-theme="${id}">
                    <i class="fas ${theme.icon} me-2" style="width: 20px;"></i>
                    <div class="flex-grow-1">
                        <div class="fw-medium">${theme.name}</div>
                        <small class="text-muted">${theme.description}</small>
                    </div>
                    <i class="fas fa-check ms-2 theme-check" style="display: none;"></i>
                </a>
            `;
            dropdownMenu.appendChild(item);
        });

        // Add click handlers
        dropdownMenu.querySelectorAll('.theme-option').forEach(option => {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                const themeId = option.getAttribute('data-theme');
                this.applyTheme(themeId);
            });
        });

        // Update initial state
        this.updateThemeSelectorUI(this.getCurrentTheme());
    },

    /**
     * Update the theme selector UI to reflect current theme
     * @param {string} themeId - Current theme ID
     */
    updateThemeSelectorUI: function(themeId) {
        const theme = this.themes[themeId];
        if (!theme) return;

        // Update the toggle button
        const toggleBtn = document.querySelector('#themeSelector .dropdown-toggle');
        if (toggleBtn) {
            const icon = toggleBtn.querySelector('i');
            if (icon) {
                icon.className = `fas ${theme.icon}`;
            }
        }

        // Update check marks
        document.querySelectorAll('.theme-option').forEach(option => {
            const check = option.querySelector('.theme-check');
            if (check) {
                check.style.display = option.getAttribute('data-theme') === themeId ? 'inline' : 'none';
            }
        });
    },

    /**
     * Toggle between light and dark themes
     */
    toggleDarkMode: function() {
        const currentTheme = this.getCurrentTheme();
        const theme = this.themes[currentTheme];
        
        if (theme.isDark) {
            // Switch to default light theme
            this.applyTheme('orchard-green');
        } else {
            // Switch to dark theme
            this.applyTheme('twilight-field');
        }
    },

    /**
     * Check if current theme is dark
     * @returns {boolean}
     */
    isDarkMode: function() {
        const currentTheme = this.getCurrentTheme();
        const theme = this.themes[currentTheme];
        return theme ? theme.isDark : false;
    }
};

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    ThemeManager.init();
});

// Export for global access
window.ThemeManager = ThemeManager;
