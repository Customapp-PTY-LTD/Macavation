/**
 * MacTableActions — shared ellipsis dropdown for data-table row actions.
 * See WebPortal/css/table-actions.css and UI_DESIGN_INSTRUCTIONS.md §6.
 */
(function (global) {
    'use strict';

    var bodyAppendBound = false;

    function escapeAttr(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;');
    }

    function renderItem(item) {
        if (typeof item === 'string') return item;
        if (item && item.html) return item.html;

        var attrs = '';
        if (item.dataAttrs) {
            Object.keys(item.dataAttrs).forEach(function (key) {
                attrs += ' data-' + escapeAttr(key) + '="' + escapeAttr(item.dataAttrs[key]) + '"';
            });
        }
        if (item.attrs) {
            Object.keys(item.attrs).forEach(function (key) {
                attrs += ' ' + escapeAttr(key) + '="' + escapeAttr(item.attrs[key]) + '"';
            });
        }

        var className = 'dropdown-item';
        if (item.className) className += ' ' + item.className;
        if (item.danger) className += ' text-danger';
        if (item.disabled) className += ' text-muted';

        var icon = item.icon ? '<i class="' + item.icon + ' me-1"></i>' : '';
        var label = item.label != null ? String(item.label) : '';

        if (item.disabled) {
            return '<span class="' + className + '" role="button" tabindex="0"' + attrs + '>' + icon + label + '</span>';
        }

        return '<a class="' + className + '" href="' + (item.href || '#') + '"' + attrs + '>' + icon + label + '</a>';
    }

    function renderMenuItems(items, wrapLi) {
        return (items || []).map(function (item) {
            var html = renderItem(item);
            return wrapLi ? '<li>' + html + '</li>' : html;
        }).join('');
    }

    /**
     * @param {{ id?: string, items?: Array, wrapLi?: boolean }} opts
     * @returns {string} dropdown HTML (without <td> wrapper)
     */
    function render(opts) {
        opts = opts || {};
        var id = opts.id || ('macActions' + Math.random().toString(36).slice(2, 11));
        var menuHtml = renderMenuItems(opts.items, !!opts.wrapLi);

        return '<div class="dropdown mac-table-actions">' +
            '<button class="btn btn-sm btn-outline-secondary" type="button" id="' + escapeAttr(id) + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions">' +
            '<i class="fas fa-ellipsis"></i></button>' +
            '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="' + escapeAttr(id) + '">' + menuHtml + '</ul>' +
            '</div>';
    }

    /**
     * @param {{ id?: string, items?: Array, wrapLi?: boolean }} opts
     * @returns {string} full <td> with mac-table-actions-col
     */
    function renderCell(opts) {
        return '<td class="mac-table-actions-col">' + render(opts) + '</td>';
    }

    function getPopperConfig(cfg) {
        var config = Object.assign({}, cfg || {}, { strategy: 'fixed', placement: 'bottom-end' });
        var modifiers = Array.isArray(config.modifiers) ? config.modifiers.slice() : [];
        var hasFlip = false;

        for (var i = 0; i < modifiers.length; i++) {
            if (modifiers[i] && modifiers[i].name === 'flip') {
                modifiers[i] = Object.assign({}, modifiers[i], { enabled: false });
                hasFlip = true;
                break;
            }
        }
        if (!hasFlip) modifiers.push({ name: 'flip', enabled: false });
        config.modifiers = modifiers;
        return config;
    }

    function bindBodyAppend() {
        if (bodyAppendBound) return;
        bodyAppendBound = true;

        document.addEventListener('show.bs.dropdown', function (e) {
            var dropdown = e.target.closest('.mac-table-actions');
            if (!dropdown) return;
            var menu = dropdown.querySelector('.dropdown-menu');
            if (!menu || menu.classList.contains('mac-table-actions-menu')) return;
            dropdown._macMenu = menu;
            menu.classList.add('mac-table-actions-menu');
            document.body.appendChild(menu);
        }, true);

        document.addEventListener('hidden.bs.dropdown', function (e) {
            var dropdown = e.target.closest('.mac-table-actions');
            if (!dropdown || !dropdown._macMenu) return;
            var menu = dropdown._macMenu;
            menu.classList.remove('mac-table-actions-menu');
            dropdown.appendChild(menu);
            delete dropdown._macMenu;
        }, true);
    }

    /**
     * @param {Element|string} container - root element or selector
     * @param {{ selector?: string, bodyAppend?: boolean }} options
     */
    function init(container, options) {
        options = options || {};
        if (options.bodyAppend !== false) bindBodyAppend();

        if (typeof bootstrap === 'undefined' || !bootstrap.Dropdown) return;

        var root = typeof container === 'string'
            ? document.querySelector(container)
            : (container || document);

        if (!root || !root.querySelectorAll) return;

        var selector = options.selector || '.mac-table-actions [data-bs-toggle="dropdown"]';
        root.querySelectorAll(selector).forEach(function (trigger) {
            var existing = bootstrap.Dropdown.getInstance(trigger);
            if (existing) existing.dispose();
            new bootstrap.Dropdown(trigger, { popperConfig: getPopperConfig });
        });
    }

    global.MacTableActions = {
        render: render,
        renderCell: renderCell,
        renderItem: renderItem,
        init: init
    };
})(typeof window !== 'undefined' ? window : this);
