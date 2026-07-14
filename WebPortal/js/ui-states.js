/*
 * Shared loading / empty states — one convention for every grid.
 *
 * Usage in a grid renderer:
 *   tbody.innerHTML = macLoadingRow(6);                          // while fetching
 *   tbody.innerHTML = macEmptyRow(6, 'No batches found.');       // no data
 *   container.innerHTML = macEmptyState('fa-inbox', 'No alerts', 'New alerts appear here.');
 */
(function (w) {
    'use strict';

    function esc(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function macLoadingRow(colspan, text) {
        return '<tr class="mac-state-row"><td colspan="' + (colspan || 1) + '" class="text-center py-4">'
            + '<span class="mac-state-loading"><i class="fas fa-spinner fa-spin me-2"></i>'
            + esc(text || 'Loading…') + '</span></td></tr>';
    }

    function macEmptyRow(colspan, text) {
        return '<tr class="mac-state-row"><td colspan="' + (colspan || 1) + '" class="text-center py-4">'
            + '<span class="mac-state-empty"><i class="fas fa-inbox me-2"></i>'
            + esc(text || 'Nothing here yet.') + '</span></td></tr>';
    }

    function macEmptyState(icon, title, hint) {
        return '<div class="mac-empty-state text-center py-4">'
            + '<i class="fas ' + esc(icon || 'fa-inbox') + ' mac-empty-icon mb-2"></i>'
            + '<div class="mac-empty-title">' + esc(title || 'Nothing here yet.') + '</div>'
            + (hint ? '<div class="mac-empty-hint">' + esc(hint) + '</div>' : '')
            + '</div>';
    }

    w.macLoadingRow = macLoadingRow;
    w.macEmptyRow = macEmptyRow;
    w.macEmptyState = macEmptyState;
})(typeof window !== 'undefined' ? window : this);
