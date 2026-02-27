/**
 * KanbanHelper — Renders data as kanban columns.
 *
 * Usage:
 *   KanbanHelper.render('myBoardId', columns, items, getColumnKey, cardRenderer);
 *
 * @param {string}   containerId  - DOM id of the kanban container
 * @param {Array}    columns      - [{ key: string, label: string }]
 * @param {Array}    items        - Raw data array
 * @param {Function} getColumnKey - (item) => column key string
 * @param {Function} cardRenderer - (item) => HTML string for one kanban card
 */
var KanbanHelper = {

    render: function (containerId, columns, items, getColumnKey, cardRenderer) {
        var container = document.getElementById(containerId);
        if (!container) return;

        // Group items by column key
        var grouped = {};
        columns.forEach(function (col) { grouped[col.key] = []; });

        (items || []).forEach(function (item) {
            var key = getColumnKey(item);
            if (grouped[key]) {
                grouped[key].push(item);
            }
        });

        // Build HTML
        var html = '';
        columns.forEach(function (col) {
            var cards = grouped[col.key] || [];
            html += '<div class="kanban-column">';
            html += '<div class="kanban-column-header">';
            html += '<span>' + KanbanHelper._esc(col.label) + '</span>';
            html += '<span class="kanban-column-count">' + cards.length + '</span>';
            html += '</div>';
            html += '<div class="kanban-column-body">';

            if (cards.length === 0) {
                html += '<div class="kanban-column-empty">No items</div>';
            } else {
                cards.forEach(function (item) {
                    html += cardRenderer(item);
                });
            }

            html += '</div></div>';
        });

        container.innerHTML = html;
    },

    /** Minimal HTML escape helper */
    _esc: function (str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.appendChild(document.createTextNode(str));
        return div.innerHTML;
    }
};

window.KanbanHelper = KanbanHelper;
