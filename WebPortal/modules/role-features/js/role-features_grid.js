/**
 * Role Features Grid Module
 * Handles role features management functionality with Supabase integration.
 * Follows company module pattern: IIFE, arrow methods, scope = _roleFeaturesGrid for same-module calls.
 */

var _roleFeaturesGrid = function () {
    'use strict';

    function delay(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    return {
        features: [],
        filteredFeatures: [],
        currentPage: 1,
        itemsPerPage: 10,
        searchDebounceToken: 0,

        init: async () => {
            const scope = _roleFeaturesGrid;
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
            if (typeof _modal_role_feature !== 'undefined' && _modal_role_feature.init) _modal_role_feature.init();
            scope.setupEventListeners();
            await scope.loadRolesForDropdown();
            await scope.loadFeaturesForDropdown();
            await scope.loadFeatures();
        },

        waitForReady: () => {
            return new Promise(function (resolve) {
                $(document).ready(resolve);
            });
        },

        setupEventListeners: () => {
            const scope = _roleFeaturesGrid;

            $('#searchInput').on('input', function () {
                var token = ++scope.searchDebounceToken;
                delay(300).then(function () {
                    if (token === scope.searchDebounceToken) scope.filterFeatures();
                });
            });

            $('#filterRole, #filterFeature, #filterValue').on('change', function () {
                scope.filterFeatures();
            });

            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const scope = _roleFeaturesGrid;
                var page = parseInt($(this).data('page'), 10);
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderFeatures();
                }
            });

            $('#addFeatureBtn').on('click', function () {
                if (typeof _modal_role_feature !== 'undefined' && _modal_role_feature.show) _modal_role_feature.show();
            });

            $('#exportFeaturesBtn').on('click', function () { _roleFeaturesGrid.exportFeatures(); });
            $('#refreshFeaturesBtn').on('click', function () { _roleFeaturesGrid.refreshFeatures(); });
            $('#clearFiltersBtn').on('click', function () { _roleFeaturesGrid.clearFilters(); });

            $(document).on('click', '#featuresTableBody tr.js-feature-row', function (e) {
                if ($(e.target).closest('.dropdown').length || $(e.target).closest('button, .btn').length) return;
                var featureId = $(this).data('feature-id');
                if (featureId) _roleFeaturesGrid.editFeature(featureId);
            });

            $(document).on('click', '.js-feature-edit', function (e) {
                e.preventDefault();
                var featureId = $(this).data('feature-id');
                if (featureId) _roleFeaturesGrid.editFeature(featureId);
            });

            $(document).on('click', '.js-feature-delete', function (e) {
                e.preventDefault();
                var featureId = $(this).data('feature-id');
                if (featureId) _roleFeaturesGrid.deleteFeature(featureId);
            });
        },

        loadFeatures: async () => {
            const scope = _roleFeaturesGrid;
            try {
                scope.showLoading();
                var features = await dataFunctions.getRoleFeatures();
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

        loadRolesForDropdown: async () => {
            const scope = _roleFeaturesGrid;
            try {
                var roles = await dataFunctions.getRoles();
                if (!roles || !Array.isArray(roles) || roles.length === 0) return;
                var select = document.getElementById('filterRole');
                if (select) {
                    var html = '<option value="">All Roles</option>';
                    roles.forEach(function (role) {
                        html += '<option value="' + role.id + '">' + scope.escapeHtml(role.role_name) + '</option>';
                    });
                    select.innerHTML = html;
                }
            } catch (error) {
                console.error('Error loading roles:', error);
            }
        },

        loadFeaturesForDropdown: async () => {
            const scope = _roleFeaturesGrid;
            try {
                var response = await dataFunctions.getFeatures();
                var features = [];
                if (response && Array.isArray(response)) {
                    features = response;
                } else if (response && response.get_features && Array.isArray(response.get_features)) {
                    features = response.get_features;
                }
                if (features.length === 0) {
                    scope.loadMockFeatures();
                    return;
                }
                var select = document.getElementById('filterFeature');
                if (select) {
                    var html = '<option value="">All Features</option>';
                    features.forEach(function (feature) {
                        html += '<option value="' + (feature.id || '') + '">' + scope.escapeHtml(feature.feature_name || feature.name || '') + '</option>';
                    });
                    select.innerHTML = html;
                }
            } catch (error) {
                console.error('Error loading features:', error);
                scope.loadMockFeatures();
            }
        },

        loadMockFeatures: () => {
            const scope = _roleFeaturesGrid;
            var mockFeatures = [
                { id: '1', feature_name: 'User Management' },
                { id: '2', feature_name: 'Role Management' },
                { id: '3', feature_name: 'Company Management' },
                { id: '4', feature_name: 'Fleet Management' },
                { id: '5', feature_name: 'Trip Management' },
                { id: '6', feature_name: 'Reports' },
                { id: '7', feature_name: 'Settings' },
                { id: '8', feature_name: 'Dashboard' }
            ];
            var select = document.getElementById('filterFeature');
            if (select) {
                var html = '<option value="">All Features</option>';
                mockFeatures.forEach(function (feature) {
                    html += '<option value="' + feature.id + '">' + scope.escapeHtml(feature.feature_name) + '</option>';
                });
                select.innerHTML = html;
            }
        },

        filterFeatures: () => {
            const scope = _roleFeaturesGrid;
            var searchTerm = $('#searchInput').val().toLowerCase();
            var roleFilter = $('#filterRole').val();
            var featureFilter = $('#filterFeature').val();
            var valueFilter = $('#filterValue').val();
            scope.filteredFeatures = scope.features.filter(function (feature) {
                var matchesSearch = !searchTerm ||
                    (feature.feature_name && feature.feature_name.toLowerCase().includes(searchTerm));
                var matchesRole = !roleFilter || feature.role_id === roleFilter;
                var matchesFeature = !featureFilter || feature.feature_name === featureFilter;
                var matchesValue = !valueFilter || feature.feature_value === valueFilter;
                return matchesSearch && matchesRole && matchesFeature && matchesValue;
            });
            scope.currentPage = 1;
            scope.renderFeatures();
        },

        renderFeatures: () => {
            const scope = _roleFeaturesGrid;
            var startIndex = (scope.currentPage - 1) * scope.itemsPerPage;
            var endIndex = startIndex + scope.itemsPerPage;
            var featuresToShow = scope.filteredFeatures.slice(startIndex, endIndex);

            var featuresHtml = '';
            if (featuresToShow.length === 0) {
                var isEmpty = scope.filteredFeatures.length === 0;
                featuresHtml = '<tr><td colspan="6" class="text-center text-muted py-4">' +
                    '<i class="fas fa-info-circle me-2"></i>' +
                    (isEmpty ? 'No role features found.' : 'No features match your search.') +
                    '</td></tr>';
            } else {
                featuresHtml = featuresToShow.map(function (feature) {
                    var featureId = scope.escapeHtml(feature.id);
                    var dateStr = scope.formatDate(feature.created_at, 'datetime');
                    var actionsCell = '<td>' +
                        '<div class="dropdown">' +
                        '<button class="btn btn-sm btn-outline-secondary dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">' +
                        '<i class="fas fa-ellipsis"></i></button>' +
                        '<ul class="dropdown-menu dropdown-menu-end">' +
                        '<li><a class="dropdown-item js-feature-edit" href="#" data-feature-id="' + featureId + '">Edit</a></li>' +
                        '<li><a class="dropdown-item js-feature-delete text-danger" href="#" data-feature-id="' + featureId + '">Delete</a></li>' +
                        '</ul></div></td>';
                    return '<tr class="js-feature-row" data-feature-id="' + featureId + '">' +
                        '<td>' + scope.escapeHtml(feature.feature_name || '') + '</td>' +
                        '<td>' + scope.escapeHtml(feature.role_name || 'No Role') + '</td>' +
                        '<td>' + scope.escapeHtml(feature.value || feature.feature_value || '') + '</td>' +
                        '<td>' + scope.escapeHtml(feature.feature_description || '') + '</td>' +
                        '<td>' + scope.escapeHtml(dateStr) + '</td>' +
                        actionsCell + '</tr>';
                }).join('');
            }
            $('#featuresTableBody').html(featuresHtml);
            scope.renderPagination();
        },

        renderPagination: () => {
            const scope = _roleFeaturesGrid;
            var totalPages = Math.ceil(scope.filteredFeatures.length / scope.itemsPerPage);
            if (totalPages <= 1) {
                $('#pagination').empty();
                return;
            }
            var current = scope.currentPage;
            var paginationHtml = '';
            paginationHtml += '<li class="page-item' + (current <= 1 ? ' disabled' : '') + '">';
            paginationHtml += current <= 1 ? '<span class="page-link">Previous</span>' : '<a class="page-link" href="#" data-page="' + (current - 1) + '">Previous</a>';
            paginationHtml += '</li>';
            var delta = 2;
            var left = Math.max(1, current - delta);
            var right = Math.min(totalPages, current + delta);
            if (left > 1) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="1">1</a></li>';
                if (left > 2) paginationHtml += '<li class="page-item disabled"><span class="page-link">…</span></li>';
            }
            for (var i = left; i <= right; i++) {
                if (i === current) {
                    paginationHtml += '<li class="page-item active"><span class="page-link">' + i + '</span></li>';
                } else {
                    paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
                }
            }
            if (right < totalPages) {
                if (right < totalPages - 1) paginationHtml += '<li class="page-item disabled"><span class="page-link">…</span></li>';
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + totalPages + '">' + totalPages + '</a></li>';
            }
            paginationHtml += '<li class="page-item' + (current >= totalPages ? ' disabled' : '') + '">';
            paginationHtml += current >= totalPages ? '<span class="page-link">Next</span>' : '<a class="page-link" href="#" data-page="' + (current + 1) + '">Next</a>';
            paginationHtml += '</li>';
            $('#pagination').html(paginationHtml);
        },

        editFeature: (featureId) => {
            const scope = _roleFeaturesGrid;
            var feature = scope.features.find(function (f) { return f.id === featureId; });
            if (!feature) {
                scope.showError('Feature not found');
                return;
            }
            if (typeof _modal_role_feature !== 'undefined' && _modal_role_feature.show) _modal_role_feature.show(feature);
        },

        deleteFeature: (featureId) => {
            const scope = _roleFeaturesGrid;
            var feature = scope.features.find(function (f) { return f.id === featureId; });
            if (!feature) return;
            Swal.fire({
                title: 'Are you sure?',
                text: 'Do you want to delete "' + (feature.feature_name || '') + '" feature?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete it!'
            }).then(async function (result) {
                if (result.isConfirmed) {
                    const scope = _roleFeaturesGrid;
                    try {
                        await dataFunctions.deleteRoleFeature(featureId);
                        scope.showSuccess('Feature deleted successfully');
                        scope.loadFeatures();
                    } catch (error) {
                        console.error('Error deleting feature:', error);
                        scope.showError('Error deleting feature: ' + error.message);
                    }
                }
            });
        },

        showLoading: () => {
            $('#featuresTableBody').html('<tr><td colspan="6" class="text-center text-muted py-4"><i class="fas fa-spinner fa-spin me-2"></i>Loading features...</td></tr>');
        },

        hideLoading: () => {},

        showError: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'error');
            } else {
                alert(message);
            }
        },

        showSuccess: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'success');
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

        formatDate: (dateString, type) => {
            if (!dateString) return '';
            var date = new Date(dateString);
            if (isNaN(date.getTime())) return '';
            type = type || 'short';
            if (type === 'short') return date.toLocaleDateString();
            if (type === 'datetime') return date.toLocaleString();
            return date.toLocaleString();
        },

        exportFeatures: () => {
            _roleFeaturesGrid.showSuccess('Export functionality will be implemented');
        },

        refreshFeatures: () => {
            _roleFeaturesGrid.loadFeatures();
        },

        search: () => {
            _roleFeaturesGrid.filterFeatures();
        },

        applyFilters: () => {
            _roleFeaturesGrid.filterFeatures();
        },

        clearFilters: () => {
            const scope = _roleFeaturesGrid;
            $('#searchInput').val('');
            $('#filterRole').val('');
            $('#filterFeature').val('');
            $('#filterValue').val('');
            scope.filterFeatures();
        },

        confirmDelete: () => {
            _roleFeaturesGrid.showInfo('Delete confirmation functionality needs to be implemented');
        },

        showInfo: (message) => {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'info');
            } else {
                alert(message);
            }
        }
    };
}();

window.roleFeaturesGrid = _roleFeaturesGrid;

function initializeRoleFeaturesGrid() {
    var maxWait = 5000;
    var start = Date.now();
    function tryInit() {
        if (typeof dataFunctions !== 'undefined') {
            _roleFeaturesGrid.init();
            return;
        }
        if (Date.now() - start < maxWait) {
            setTimeout(tryInit, 50);
        }
    }
    tryInit();
}

$(document).ready(function () {
    initializeRoleFeaturesGrid();
});
