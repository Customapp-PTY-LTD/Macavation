/**
 * KanbanHelper — Renders data as kanban columns with optional drag-and-drop.
 *
 * Usage:
 *   KanbanHelper.render('myBoardId', columns, items, getColumnKey, cardRenderer);
 *   KanbanHelper.enableDragDrop('myBoardId', function(itemId, fromKey, toKey) { ... });
 *
 * @param {string}   containerId  - DOM id of the kanban container
 * @param {Array}    columns      - [{ key: string, label: string }]
 * @param {Array}    items        - Raw data array
 * @param {Function} getColumnKey - (item) => column key string
 * @param {Function} cardRenderer - (item) => HTML string for one kanban card
 */
var KanbanHelper = {

    /** Active Sortable instances keyed by containerId */
    _sortables: {},

    render: function (containerId, columns, items, getColumnKey, cardRenderer) {
        var container = document.getElementById(containerId);
        if (!container) return;

        // Destroy any existing sortable instances before re-rendering
        this.destroyDragDrop(containerId);

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
            html += '<div class="kanban-column-body" data-column-key="' + KanbanHelper._esc(col.key) + '">';

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

    /**
     * Enable drag-and-drop on kanban columns.
     * Cards must have data-kanban-id attribute set by the card renderer.
     *
     * @param {string}   containerId - Same container used in render()
     * @param {Function} onDrop      - (itemId, fromColumnKey, toColumnKey) callback
     */
    enableDragDrop: function (containerId, onDrop) {
        if (typeof Sortable === 'undefined') return;

        var container = document.getElementById(containerId);
        if (!container) return;

        // Destroy any previous instances for this container
        this.destroyDragDrop(containerId);

        var instances = [];
        var columnBodies = container.querySelectorAll('.kanban-column-body');

        columnBodies.forEach(function (el) {
            var instance = Sortable.create(el, {
                group: containerId,
                animation: 150,
                ghostClass: 'kanban-card--ghost',
                chosenClass: 'kanban-card--chosen',
                dragClass: 'kanban-card--drag',
                filter: '.kanban-column-empty',
                onEnd: function (evt) {
                    var item = evt.item;
                    var fromEl = evt.from;
                    var toEl = evt.to;

                    var itemId = item.getAttribute('data-kanban-id') ||
                                 item.getAttribute('data-batch-id') ||
                                 item.getAttribute('data-order-id') || '';
                    var fromKey = fromEl.getAttribute('data-column-key') || '';
                    var toKey = toEl.getAttribute('data-column-key') || '';

                    // Always revert the DOM move — actual data update happens
                    // when the modal saves and data reloads
                    if (fromEl !== toEl) {
                        fromEl.insertBefore(item, fromEl.children[evt.oldIndex] || null);
                    }

                    // No-op if dropped in same column
                    if (fromKey === toKey) return;

                    if (typeof onDrop === 'function') {
                        onDrop(itemId, fromKey, toKey);
                    }
                }
            });
            instances.push(instance);
        });

        this._sortables[containerId] = instances;
    },

    /**
     * Destroy drag-drop instances for a container to prevent memory leaks.
     */
    destroyDragDrop: function (containerId) {
        var instances = this._sortables[containerId];
        if (instances) {
            instances.forEach(function (s) {
                if (s && s.destroy) s.destroy();
            });
            delete this._sortables[containerId];
        }
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
