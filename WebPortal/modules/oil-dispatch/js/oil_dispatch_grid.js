/**
 * Oil & Protein Dispatch Grid Module
 * INV from OIL PROTEIN R YES → FEED+OIL+PROTEIN CUSTOMERS → DEBTORS.
 * Follows UI_DESIGN_INSTRUCTIONS.md; reference: kernel-production.
 */
var _oilDispatchGrid = function () {
    'use strict';

    return {
        dispatches: [],
        filteredDispatches: [],

        init: async () => {
            const scope = _oilDispatchGrid;
            await scope.waitForReady();
            scope.setupEventListeners();
            await scope.loadData();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _oilDispatchGrid;
            $('#clearDispatchFiltersBtn').off('click').on('click', function () {
                $('#searchDispatchInput').val('');
                $('#filterDispatchStatus').val('');
                scope.filterDispatches();
            });
            $('#searchDispatchInput').on('input', function () { scope.filterDispatches(); });
            $('#filterDispatchStatus').on('change', function () { scope.filterDispatches(); });
        },

        loadData: async () => {
            const scope = _oilDispatchGrid;
            // Data capture for oil & protein dispatch (INV to feed/oil/protein customers) - to be implemented
            scope.dispatches = [];
            scope.filteredDispatches = [];
            scope.renderTable();
        },

        filterDispatches: () => {
            const scope = _oilDispatchGrid;
            var searchTerm = ($('#searchDispatchInput').val() || '').toLowerCase();
            var statusFilter = $('#filterDispatchStatus').val();
            scope.filteredDispatches = scope.dispatches.filter(function (d) {
                var matchSearch = !searchTerm ||
                    (d.reference && d.reference.toLowerCase().indexOf(searchTerm) >= 0) ||
                    (d.customer && d.customer.toLowerCase().indexOf(searchTerm) >= 0);
                var matchStatus = !statusFilter || (d.status === statusFilter);
                return matchSearch && matchStatus;
            });
            scope.renderTable();
        },

        renderTable: () => {
            const scope = _oilDispatchGrid;
            var tbody = $('#oilDispatchTableBody');
            tbody.empty();
            var list = scope.filteredDispatches.length >= 0 ? scope.filteredDispatches : scope.dispatches;
            if (!list || list.length === 0) {
                var msg = scope.dispatches.length === 0
                    ? 'No oil & protein dispatches yet. Data capture will be implemented here.'
                    : 'No dispatches match your search.';
                tbody.html('<tr><td colspan="7" class="text-center text-muted py-4"><i class="fas fa-info-circle me-2"></i>' + scope.escapeHtml(msg) + '</td></tr>');
                return;
            }
            list.forEach(function (d) {
                var dateStr = scope.formatDate(d.dispatch_date);
                var did = scope.escapeHtml(String(d.id));
                var actionsCell = '<div class="dropdown">' +
                    '<button class="btn btn-sm btn-outline-secondary" type="button" id="dispatchActions' + did + '" data-bs-toggle="dropdown" aria-expanded="false" aria-label="Actions"><i class="fas fa-ellipsis"></i></button>' +
                    '<ul class="dropdown-menu dropdown-menu-end" aria-labelledby="dispatchActions' + did + '">' +
                    '<a class="dropdown-item js-dispatch-view" href="#" data-dispatch-id="' + did + '">View</a>' +
                    '<a class="dropdown-item js-dispatch-edit" href="#" data-dispatch-id="' + did + '">Edit</a>' +
                    '</ul></div>';
                var row = '<tr class="js-dispatch-row" data-dispatch-id="' + did + '">' +
                    '<td>' + scope.escapeHtml(d.reference || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(dateStr || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(d.customer || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(d.product || 'N/A') + '</td>' +
                    '<td>' + scope.escapeHtml(String(d.quantity != null ? d.quantity : '0')) + '</td>' +
                    '<td><span class="badge bg-info">' + scope.escapeHtml(d.status || 'draft') + '</span></td>' +
                    '<td>' + actionsCell + '</td></tr>';
                tbody.append(row);
            });
        },

        showError: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'error');
            } else if (typeof Swal !== 'undefined' && Swal.fire) {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                alert(message);
            }
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        formatDate: (value) => {
            if (!value) return '';
            var d = value instanceof Date ? value : new Date(value);
            if (isNaN(d.getTime())) return '';
            var day = String(d.getDate()).padStart(2, '0');
            var month = String(d.getMonth() + 1).padStart(2, '0');
            var year = d.getFullYear();
            return day + '/' + month + '/' + year;
        }
    };
}();

window.oilDispatchGrid = _oilDispatchGrid;

function initializeOilDispatchGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined' && dataFunctions) {
            _oilDispatchGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeOilDispatchGrid();
});
