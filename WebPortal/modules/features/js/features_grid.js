/**
 * Features Grid Module
 * Manages the features table (app modules/routes).
 * Follows company module pattern: IIFE, arrow methods, scope = _featuresGrid.
 */

var _featuresGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    return {
        features: [],
        filteredFeatures: [],
        currentPage: 1,
        itemsPerPage: 10,
        searchDebounceToken: 0,

        init: async () => {
            const scope = _featuresGrid;
            await scope.waitForReady();
            var modalContainers = document.querySelectorAll('.modal[route-name]');
            var loadPromises = [];
            modalContainers.forEach(function (el) {
                var routeName = el.getAttribute('route-name');
                if (routeName && typeof _appRouter !== 'undefined' && _appRouter.loadContent) {
                    loadPromises.push(_appRouter.loadContent({ routeName: routeName, elementSelector: '#' + el.id }));
                }
            });
            if (loadPromises.length) await Promise.all(loadPromises);
            if (typeof _modal_feature !== 'undefined' && _modal_feature.init) _modal_feature.init();
            scope.setupEventListeners();
            await scope.loadFeatures();
        },

        waitForReady: () => {
            return new Promise(function (resolve) { $(document).ready(resolve); });
        },

        setupEventListeners: () => {
            const scope = _featuresGrid;

            $('#searchInput').on('input', function () {
                var token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) scope.filterFeatures();
                });
            });

            $('#filterStatus').on('change', function () { scope.filterFeatures(); });

            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                var page = parseInt($(this).data('page'), 10);
                if (page && page !== _featuresGrid.currentPage) {
                    _featuresGrid.currentPage = page;
                    _featuresGrid.renderFeatures();
                }
            });

            $('#addFeatureBtn').on('click', function () {
                if (typeof _modal_feature !== 'undefined' && _modal_feature.show) _modal_feature.show();
            });

            $('#exportFeaturesBtn').on('click', function () { _featuresGrid.exportFeatures(); });
            $('#refreshFeaturesBtn').on('click', function () { _featuresGrid.loadFeatures(); });
            $('#clearFiltersBtn').on('click', function () { _featuresGrid.clearFilters(); });

            $(document).on('click', '#featuresTableBody tr.js-feature-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                var featureId = $(this).data('feature-id');
                if (featureId) _featuresGrid.editFeature(featureId);
            });

            $(document).on('click', '.js-feature-edit', function (e) {
                e.preventDefault();
                var featureId = $(this).data('feature-id');
                if (featureId) _featuresGrid.editFeature(featureId);
            });

            $(document).on('click', '.js-feature-delete', function (e) {
                e.preventDefault();
                var featureId = $(this).data('feature-id');
                if (featureId) _featuresGrid.deleteFeature(featureId);
            });
        },

        loadFeatures: async () => {
            const scope = _featuresGrid;
            try {
                scope.showLoading();
                var features = await dataFunctions.getFeatures();
                scope.features = features || [];
                scope.filteredFeatures = scope.features;
                scope.renderFeatures();
                scope.hideLoading();
            } catch (error) {
                console.error('Error loading features:', error);
                scope.showError('Error loading features: ' + error.message);
                scope.hideLoading();
            }
        },

        filterFeatures: () => {
            const scope = _featuresGrid;
            var searchTerm = $('#searchInput').val().toLowerCase();
            var statusFilter = $('#filterStatus').val();
            scope.filteredFeatures = scope.features.filter(function (f) {
                var matchesSearch = !searchTerm ||
                    (f.name && f.name.toLowerCase().includes(searchTerm)) ||
                    (f.key && f.key.toLowerCase().includes(searchTerm)) ||
                    (f.description && f.description.toLowerCase().includes(searchTerm));
                var matchesStatus = !statusFilter || String(f.is_active) === statusFilter;
                return matchesSearch && matchesStatus;
            });
            scope.currentPage = 1;
            scope.renderFeatures();
        },

        renderFeatures: () => {
            const scope = _featuresGrid;
            var startIndex = (scope.currentPage - 1) * scope.itemsPerPage;
            var endIndex = startIndex + scope.itemsPerPage;
            var items = scope.filteredFeatures.slice(startIndex, endIndex);

            var html = '';
            if (items.length === 0) {
                var isEmpty = scope.filteredFeatures.length === 0;
                html = '<tr><td colspan="5" class="text-center text-muted py-4">' +
                    '<i class="fas fa-info-circle me-2"></i>' +
                    (isEmpty ? 'No features found.' : 'No features match your search.') +
                    '</td></tr>';
            } else {
                html = items.map(function (f) {
                    var fId = scope.escapeHtml(String(f.id));
                    var statusBadge = f.is_active !== false
                        ? '<span class="badge bg-success">Active</span>'
                        : '<span class="badge bg-secondary">Inactive</span>';
                    var actionsCell = MacTableActions.renderCell({
                        wrapLi: true,
                        items: [
                            { label: 'Edit', className: 'js-feature-edit', dataAttrs: { 'feature-id': f.id } },
                            { label: 'Delete', className: 'js-feature-delete', danger: true, dataAttrs: { 'feature-id': f.id } }
                        ]
                    });
                    return '<tr class="js-feature-row" data-feature-id="' + fId + '">' +
                        '<td>' + scope.escapeHtml(f.name || '') + '</td>' +
                        '<td><code>' + scope.escapeHtml(f.key || '') + '</code></td>' +
                        '<td class="text-truncate">' + scope.escapeHtml(f.description || '') + '</td>' +
                        '<td>' + statusBadge + '</td>' +
                        actionsCell + '</tr>';
                }).join('');
            }
            $('#featuresTableBody').html(html);
            MacTableActions.init(document.getElementById('featuresTable'));
            scope.renderPagination();
        },

        renderPagination: () => {
            const scope = _featuresGrid;
            var totalPages = Math.ceil(scope.filteredFeatures.length / scope.itemsPerPage);
            if (totalPages <= 1) { $('#pagination').empty(); return; }
            var h = '<nav><ul class="pagination justify-content-center">';
            if (scope.currentPage > 1) {
                h += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage - 1) + '">Previous</a></li>';
            }
            for (var i = 1; i <= totalPages; i++) {
                if (i === scope.currentPage) {
                    h += '<li class="page-item active"><span class="page-link">' + i + '</span></li>';
                } else {
                    h += '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
                }
            }
            if (scope.currentPage < totalPages) {
                h += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage + 1) + '">Next</a></li>';
            }
            h += '</ul></nav>';
            $('#pagination').html(h);
        },

        editFeature: (featureId) => {
            const scope = _featuresGrid;
            var feature = scope.features.find(function (f) { return String(f.id) === String(featureId); });
            if (!feature) { scope.showError('Feature not found'); return; }
            if (typeof _modal_feature !== 'undefined' && _modal_feature.show) _modal_feature.show(feature);
        },

        deleteFeature: (featureId) => {
            const scope = _featuresGrid;
            var feature = scope.features.find(function (f) { return String(f.id) === String(featureId); });
            if (!feature) return;
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete the feature "' + (feature.name || feature.key) + '"? This will also remove all role assignments for this feature.',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete!'
            }).then(async function (result) {
                if (result.isConfirmed) {
                    try {
                        await dataFunctions.deleteFeature(featureId);
                        _featuresGrid.showSuccess('Feature deleted successfully');
                        _featuresGrid.loadFeatures();
                    } catch (error) {
                        console.error('Error deleting feature:', error);
                        _featuresGrid.showError('Error deleting feature: ' + error.message);
                    }
                }
            });
        },

        clearFilters: () => {
            $('#searchInput').val('');
            $('#filterStatus').val('');
            _featuresGrid.filterFeatures();
        },

        showLoading: () => {
            $('#featuresTableBody').html('<tr><td colspan="5" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading features...</td></tr>');
        },

        hideLoading: () => {},

        showError: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(message, 'error');
            else alert(message);
        },

        showSuccess: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) _common.showToastMessage(message, 'success');
            else alert(message);
        },

        escapeHtml: (text) => {
            if (!text) return '';
            var div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        exportFeatures: () => {
            const scope = _featuresGrid;
            if (!scope.features || scope.features.length === 0) {
                if (typeof Swal !== 'undefined') Swal.fire('Info', 'No features to export', 'info');
                return;
            }
            var columns = [
                { key: 'key', label: 'Key' },
                { key: 'name', label: 'Name' },
                { key: 'description', label: 'Description' },
                { key: 'is_active', label: 'Active' }
            ];
            if (typeof exportUtils !== 'undefined' && exportUtils.exportToCSV) {
                exportUtils.exportToCSV(scope.features, 'features', columns);
            } else {
                if (typeof Swal !== 'undefined') Swal.fire('Error', 'Export utility not available', 'error');
            }
        }
    };
}();

function initializeFeaturesGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _featuresGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeFeaturesGrid();
});
