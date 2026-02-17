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
        editingFeature: null,
        searchDebounceToken: 0,

        init: async () => {
            const scope = _roleFeaturesGrid;
            await scope.waitForReady();
            scope.setupEventListeners();
            await scope.loadFeatures();
            await scope.loadRolesForDropdown();
            await scope.loadFeaturesForDropdown();
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
                scope.showAddFeatureModal();
            });

            $(document).on('click', '.feature-name-link', function (e) {
                e.preventDefault();
                const scope = _roleFeaturesGrid;
                var featureId = $(this).data('feature-id');
                if (!featureId) return;
                scope.editFeature(featureId);
            });

            $(document).on('click', '.delete-feature-btn', function () {
                const scope = _roleFeaturesGrid;
                var featureId = $(this).data('feature-id');
                scope.deleteFeature(featureId);
            });

            $('#saveFeatureBtn').on('click', function () {
                scope.saveFeature();
            });

            $('#featureModal').on('hidden.bs.modal', function () {
                scope.clearForm();
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
                var roleSelects = ['cboRole', 'filterRole'];
                roleSelects.forEach(function (selectId) {
                    var select = document.getElementById(selectId);
                    if (select) {
                        var html = selectId === 'filterRole' ? '<option value="">All Roles</option>' : '<option value="">Select Role</option>';
                        roles.forEach(function (role) {
                            html += '<option value="' + role.id + '">' + scope.escapeHtml(role.role_name) + '</option>';
                        });
                        select.innerHTML = html;
                    }
                });
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
                var featureSelects = ['cboFeature', 'filterFeature'];
                featureSelects.forEach(function (selectId) {
                    var select = document.getElementById(selectId);
                    if (select) {
                        var html = selectId === 'filterFeature' ? '<option value="">All Features</option>' : '<option value="">Select Feature</option>';
                        features.forEach(function (feature) {
                            html += '<option value="' + (feature.id || '') + '">' + scope.escapeHtml(feature.feature_name || feature.name || '') + '</option>';
                        });
                        select.innerHTML = html;
                    }
                });
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
            var featureSelects = ['cboFeature', 'filterFeature'];
            featureSelects.forEach(function (selectId) {
                var select = document.getElementById(selectId);
                if (select) {
                    var html = selectId === 'filterFeature' ? '<option value="">All Features</option>' : '<option value="">Select Feature</option>';
                    mockFeatures.forEach(function (feature) {
                        html += '<option value="' + feature.id + '">' + scope.escapeHtml(feature.feature_name) + '</option>';
                    });
                    select.innerHTML = html;
                }
            });
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

            if (featuresToShow.length === 0) {
                var emptyMessage = scope.filteredFeatures.length === 0 && scope.features.length === 0
                    ? '<tr><td colspan="6" class="text-center py-4"><div class="text-muted"><i class="fas fa-info-circle me-2"></i>No role features found. Role features functionality is not yet implemented. Please use role_permissions for access control.</div></td></tr>'
                    : '<tr><td colspan="6" class="text-center py-4"><div class="text-muted">No features match your search criteria.</div></td></tr>';
                $('#featuresTableBody').html(emptyMessage);
                $('#pagination').empty();
                return;
            }

            var featuresHtml = featuresToShow.map(function (feature) {
                var dateStr = scope.formatDate(feature.created_at, 'datetime');
                return '<tr><td><a href="#" class="feature-name-link text-decoration-none" data-feature-id="' + scope.escapeHtml(feature.id) + '">' + scope.escapeHtml(feature.feature_name) + '</a></td><td>' + scope.escapeHtml(feature.role_name || 'No Role') + '</td><td>' + scope.escapeHtml(feature.value || feature.feature_value || '') + '</td><td>' + scope.escapeHtml(feature.feature_description || '') + '</td><td>' + scope.escapeHtml(dateStr) + '</td><td><button class="btn btn-sm btn-outline-danger delete-feature-btn" data-feature-id="' + scope.escapeHtml(feature.id) + '"><i class="fas fa-trash"></i></button></td></tr>';
            }).join('');
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
            var paginationHtml = '<nav><ul class="pagination justify-content-center">';
            if (scope.currentPage > 1) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage - 1) + '">Previous</a></li>';
            }
            for (var i = 1; i <= totalPages; i++) {
                if (i === scope.currentPage) {
                    paginationHtml += '<li class="page-item active"><span class="page-link">' + i + '</span></li>';
                } else {
                    paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + i + '">' + i + '</a></li>';
                }
            }
            if (scope.currentPage < totalPages) {
                paginationHtml += '<li class="page-item"><a class="page-link" href="#" data-page="' + (scope.currentPage + 1) + '">Next</a></li>';
            }
            paginationHtml += '</ul></nav>';
            $('#pagination').html(paginationHtml);
        },

        showAddFeatureModal: async () => {
            const scope = _roleFeaturesGrid;
            scope.editingFeature = null;
            scope.clearForm();
            await scope.loadRolesForDropdown();
            await scope.loadFeaturesForDropdown();
            $('#featureModalLabel').text('Add Role Feature');
            $('#featureModal').modal('show');
        },

        editFeature: async (featureId) => {
            const scope = _roleFeaturesGrid;
            try {
                var feature = scope.features.find(function (f) { return f.id === featureId; });
                if (!feature) {
                    scope.showError('Feature not found');
                    return;
                }
                scope.editingFeature = feature;
                await scope.loadRolesForDropdown();
                await scope.loadFeaturesForDropdown();
                await delay(100);
                scope.populateForm(feature);
                $('#featureModalLabel').text('Edit Role Feature');
                $('#featureModal').modal('show');
            } catch (error) {
                console.error('Error editing feature:', error);
                scope.showError('Error loading feature details: ' + error.message);
            }
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

        saveFeature: async () => {
            const scope = _roleFeaturesGrid;
            try {
                var formData = {
                    role_id: $('#cboRole').val(),
                    feature_id: $('#cboFeature').val(),
                    value: $('#cboValue').val(),
                    description: $('#txtDescription').val() || ''
                };
                if (!formData.role_id) {
                    scope.showError('Role is required');
                    return;
                }
                if (!formData.feature_id) {
                    scope.showError('Feature is required');
                    return;
                }
                if (!formData.value) {
                    scope.showError('Value is required');
                    return;
                }
                var backendData = {
                    role_id: formData.role_id,
                    feature_id: formData.feature_id,
                    value: formData.value === 'true' ? true : (formData.value === 'false' ? false : formData.value),
                    description: formData.description
                };
                if (scope.editingFeature) {
                    await dataFunctions.updateRoleFeature(scope.editingFeature.id, backendData);
                    scope.showSuccess('Feature updated successfully');
                } else {
                    await dataFunctions.createRoleFeature(backendData);
                    scope.showSuccess('Feature created successfully');
                }
                $('#featureModal').modal('hide');
                scope.loadFeatures();
            } catch (error) {
                console.error('Error saving feature:', error);
                scope.showError('Error saving feature: ' + error.message);
            }
        },

        populateForm: (feature) => {
            var roleId = feature.role_id || '';
            var featureId = feature.feature_id || '';
            var featureValue = feature.value || feature.feature_value || '';
            $('#cboRole').val(roleId);
            $('#cboFeature').val(featureId);
            $('#cboValue').val(featureValue);
            $('#txtDescription').val(feature.description || feature.feature_description || '');
        },

        clearForm: () => {
            const scope = _roleFeaturesGrid;
            $('#featureForm')[0].reset();
            scope.editingFeature = null;
        },

        showLoading: () => {
            $('#featuresTableBody').html('<tr><td colspan="6" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>');
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
