/**
 * Role Features Grid Module
 * Handles role features management functionality with Supabase integration
 */

var _roleFeaturesGrid = function () {
    return {
        features: [],
        filteredFeatures: [],
        currentPage: 1,
        itemsPerPage: 10,
        editingFeature: null,
        searchTimeout: null,

        init: function () {
            this.setupEventListeners();
            this.loadFeatures();
            this.loadRolesForDropdown();
            this.loadFeaturesForDropdown();
        },

        setupEventListeners: function () {
            const scope = this;

            // Search functionality
            $('#searchInput').on('input', function () {
                clearTimeout(scope.searchTimeout);
                scope.searchTimeout = setTimeout(() => {
                    scope.filterFeatures();
                }, 300);
            });

            // Filter functionality
            $('#filterRole').on('change', function () {
                scope.filterFeatures();
            });

            $('#filterFeature').on('change', function () {
                scope.filterFeatures();
            });

            $('#filterValue').on('change', function () {
                scope.filterFeatures();
            });

            // Pagination
            $(document).on('click', '.pagination .page-link', function (e) {
                e.preventDefault();
                const page = parseInt($(this).data('page'));
                if (page && page !== scope.currentPage) {
                    scope.currentPage = page;
                    scope.renderFeatures();
                }
            });

            // Add feature button
            $('#addFeatureBtn').on('click', function () {
                scope.showAddFeatureModal();
            });

            // Edit feature (click on feature name)
            $(document).on('click', '.feature-name-link', function (e) {
                e.preventDefault();
                console.log('Feature name link clicked');
                const featureId = $(this).data('feature-id');
                console.log('Feature ID:', featureId);
                if (!featureId) {
                    console.error('No feature ID found');
                    return;
                }
                scope.editFeature(featureId);
            });

            // Delete feature
            $(document).on('click', '.delete-feature-btn', function () {
                const featureId = $(this).data('feature-id');
                scope.deleteFeature(featureId);
            });

            // Save feature form
            $('#saveFeatureBtn').on('click', function () {
                scope.saveFeature();
            });

            // Modal events
            $('#featureModal').on('hidden.bs.modal', function () {
                scope.clearForm();
            });
        },

        loadFeatures: async function () {
            try {
                this.showLoading();
                const features = await dataFunctions.getRoleFeatures();
                this.features = features;
                this.filteredFeatures = features;
                this.renderFeatures();
                this.hideLoading();
            } catch (error) {
                console.error('Error loading features:', error);
                this.showError('Error loading features: ' + error.message);
                this.hideLoading();
            }
        },

        loadRolesForDropdown_NEW: async function () {
            console.log('🔥 NEW FUNCTION CALLED - loadRolesForDropdown_NEW');
            try {
                console.log('=== loadRolesForDropdown START ===');

                const response = await dataFunctions.getRoles();
                console.log('API Response received:', response);

                // Direct approach - use the response as-is since we know it's an array
                let roles = response;
                console.log('Using direct response as roles:', roles);
                console.log('Number of roles:', roles ? roles.length : 'undefined');

                if (!roles || !Array.isArray(roles) || roles.length === 0) {
                    console.error('No valid roles data!');
                    return;
                }

                console.log('First role sample:', roles[0]);

                // Populate dropdowns directly
                const roleSelects = ['cboRole', 'filterRole'];
                roleSelects.forEach(selectId => {
                    const select = document.getElementById(selectId);
                    if (select) {
                        let html = '<option value="">Select Role</option>';
                        if (selectId === 'filterRole') {
                            html = '<option value="">All Roles</option>';
                        }
                        roles.forEach(role => {
                            html += `<option value="${role.id}">${role.role_name}</option>`;
                        });
                        select.innerHTML = html;
                        console.log(`✅ Populated ${selectId} with ${roles.length} roles`);
                    }
                });

                console.log('=== loadRolesForDropdown COMPLETE ===');
            } catch (error) {
                console.error('❌ Error in loadRolesForDropdown:', error);
            }
        },

        loadFeaturesForDropdown: async function () {
            try {
                const response = await dataFunctions.getFeatures();
                console.log('Raw response from getFeatures:', response);

                // Handle flat array response structure from database
                let features = [];
                if (response && Array.isArray(response)) {
                    features = response;
                } else if (response && Array.isArray(response) && response.length > 0) {
                    // Check if it's nested structure
                    const firstResult = response[0];
                    if (firstResult && firstResult.get_features) {
                        features = firstResult.get_features;
                    } else {
                        features = response;
                    }
                }

                console.log('Extracted features for dropdown:', features);

                const featureSelects = ['cboFeature', 'filterFeature'];
                featureSelects.forEach(selectId => {
                    const select = document.getElementById(selectId);
                    if (select) {
                        let html = '<option value="">Select Feature</option>';
                        if (selectId === 'filterFeature') {
                            html = '<option value="">All Features</option>';
                        }
                        features.forEach(feature => {
                            html += `<option value="${feature.id}">${feature.feature_name}</option>`;
                        });
                        select.innerHTML = html;
                        console.log(`Populated ${selectId} dropdown with ${features.length} features`);
                    }
                });
            } catch (error) {
                console.error('Error loading features:', error);
                // Fallback to mock data
                this.loadMockFeatures();
            }
        },

        loadMockRoles: function () {
            const mockRoles = [
                { id: 'd57c236a-a9c1-4a2b-bc81-eff6af913560', role_name: 'Super Admin' },
                { id: 'd9976e2f-9095-4a4b-b407-626ca9b7e08e', role_name: 'Transport Manager' },
                { id: 'b300e442-8963-4777-a4f9-a28bfe2c0115', role_name: 'Fleet Supervisor' },
                { id: '623d54ee-e827-42ee-bf2e-0fcd7e7a506c', role_name: 'Driver' },
                { id: '61738554-d8f1-4561-a7cc-5ffb71dd0e07', role_name: 'Customer Service' },
                { id: '9176d35d-f256-4b4c-bdf1-104a0a5359bc', role_name: 'User' }
            ];

            const roleSelects = ['cboRole', 'filterRole'];
            roleSelects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    let html = '<option value="">Select Role</option>';
                    if (selectId === 'filterRole') {
                        html = '<option value="">All Roles</option>';
                    }
                    mockRoles.forEach(role => {
                        html += `<option value="${role.id}">${role.role_name}</option>`;
                    });
                    select.innerHTML = html;
                }
            });
        },

        loadMockFeatures: function () {
            const mockFeatures = [
                { id: '1', feature_name: 'User Management', name: 'User Management' },
                { id: '2', feature_name: 'Role Management', name: 'Role Management' },
                { id: '3', feature_name: 'Company Management', name: 'Company Management' },
                { id: '4', feature_name: 'Fleet Management', name: 'Fleet Management' },
                { id: '5', feature_name: 'Trip Management', name: 'Trip Management' },
                { id: '6', feature_name: 'Reports', name: 'Reports' },
                { id: '7', feature_name: 'Settings', name: 'Settings' },
                { id: '8', feature_name: 'Dashboard', name: 'Dashboard' }
            ];

            const featureSelects = ['cboFeature', 'filterFeature'];
            featureSelects.forEach(selectId => {
                const select = document.getElementById(selectId);
                if (select) {
                    let html = '<option value="">Select Feature</option>';
                    if (selectId === 'filterFeature') {
                        html = '<option value="">All Features</option>';
                    }
                    mockFeatures.forEach(feature => {
                        html += `<option value="${feature.id}">${feature.feature_name}</option>`;
                    });
                    select.innerHTML = html;
                }
            });
        },

        filterFeatures: function () {
            const searchTerm = $('#searchInput').val().toLowerCase();
            const roleFilter = $('#filterRole').val();
            const featureFilter = $('#filterFeature').val();
            const valueFilter = $('#filterValue').val();

            this.filteredFeatures = this.features.filter(feature => {
                const matchesSearch = !searchTerm ||
                    (feature.feature_name && feature.feature_name.toLowerCase().includes(searchTerm));

                const matchesRole = !roleFilter || feature.role_id === roleFilter;
                const matchesFeature = !featureFilter || feature.feature_name === featureFilter;
                const matchesValue = !valueFilter || feature.feature_value === valueFilter;

                return matchesSearch && matchesRole && matchesFeature && matchesValue;
            });

            this.currentPage = 1;
            this.renderFeatures();
        },

        renderFeatures: function () {
            const startIndex = (this.currentPage - 1) * this.itemsPerPage;
            const endIndex = startIndex + this.itemsPerPage;
            const featuresToShow = this.filteredFeatures.slice(startIndex, endIndex);

            const featuresHtml = featuresToShow.map(feature => `
                <tr>
                    <td>
                        <a href="#" class="feature-name-link text-decoration-none" data-feature-id="${feature.id}">
                            ${this.escapeHtml(feature.feature_name)}
                        </a>
                    </td>
                    <td>${this.escapeHtml(feature.role_name || 'No Role')}</td>
                    <td>${this.escapeHtml(feature.value || '')}</td>
                    <td>${this.escapeHtml(feature.feature_description || '')}</td>
                    <td>${this.formatDate(feature.created_at, 'datetime')}</td>
                    <td>
                        <button class="btn btn-sm btn-outline-danger delete-feature-btn" data-feature-id="${feature.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `).join('');

            $('#featuresTableBody').html(featuresHtml);
            this.renderPagination();
        },

        renderPagination: function () {
            const totalPages = Math.ceil(this.filteredFeatures.length / this.itemsPerPage);

            if (totalPages <= 1) {
                $('#pagination').empty();
                return;
            }

            let paginationHtml = '<nav><ul class="pagination justify-content-center">';

            // Previous button
            if (this.currentPage > 1) {
                paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage - 1}">Previous</a></li>`;
            }

            // Page numbers
            for (let i = 1; i <= totalPages; i++) {
                if (i === this.currentPage) {
                    paginationHtml += `<li class="page-item active"><span class="page-link">${i}</span></li>`;
                } else {
                    paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
                }
            }

            // Next button
            if (this.currentPage < totalPages) {
                paginationHtml += `<li class="page-item"><a class="page-link" href="#" data-page="${this.currentPage + 1}">Next</a></li>`;
            }

            paginationHtml += '</ul></nav>';
            $('#pagination').html(paginationHtml);
        },

        showAddFeatureModal: async function () {
            this.editingFeature = null;
            this.clearForm();

            // Reload dropdowns from database when adding
            console.log('Reloading dropdowns from database for add...');
            await this.loadRolesForDropdown_NEW();
            await this.loadFeaturesForDropdown();

            $('#featureModalLabel').text('Add Role Feature');
            $('#featureModal').modal('show');
        },

        editFeature: async function (featureId) {
            try {
                console.log('=== editFeature called with ID:', featureId);
                const feature = this.features.find(f => f.id === featureId);
                console.log('Found feature:', feature);
                if (!feature) {
                    this.showError('Feature not found');
                    return;
                }

                this.editingFeature = feature;

                // Reload dropdowns from database when editing
                console.log('Reloading dropdowns from database for edit...');
                console.log('About to call loadRolesForDropdown_NEW...');
                await this.loadRolesForDropdown_NEW();
                console.log('loadRolesForDropdown_NEW completed, calling loadFeaturesForDropdown...');
                await this.loadFeaturesForDropdown();
                console.log('loadFeaturesForDropdown completed');

                // Add a small delay to ensure dropdowns are fully populated before setting values
                setTimeout(() => {
                    this.populateForm(feature);
                }, 100);

                $('#featureModalLabel').text('Edit Role Feature');
                $('#featureModal').modal('show');
            } catch (error) {
                console.error('Error editing feature:', error);
                this.showError('Error loading feature details: ' + error.message);
            }
        },

        deleteFeature: function (featureId) {
            const feature = this.features.find(f => f.id === featureId);
            if (!feature) return;

            Swal.fire({
                title: 'Are you sure?',
                text: `Do you want to delete "${feature.feature_name}" feature?`,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#d33',
                cancelButtonColor: '#3085d6',
                confirmButtonText: 'Yes, delete it!'
            }).then(async (result) => {
                if (result.isConfirmed) {
                    try {
                        await dataFunctions.deleteRoleFeature(featureId);
                        this.showSuccess('Feature deleted successfully');
                        this.loadFeatures();
                    } catch (error) {
                        console.error('Error deleting feature:', error);
                        this.showError('Error deleting feature: ' + error.message);
                    }
                }
            });
        },

        saveFeature: async function () {
            try {
                const formData = {
                    role_id: $('#cboRole').val(),
                    feature_id: $('#cboFeature').val(),
                    value: $('#cboValue').val(),
                    description: $('#txtDescription').val() || ''
                };

                // Validation
                if (!formData.role_id) {
                    this.showError('Role is required');
                    return;
                }

                if (!formData.feature_id) {
                    this.showError('Feature is required');
                    return;
                }

                if (!formData.value) {
                    this.showError('Value is required');
                    return;
                }

                // Map form data to backend parameters
                const backendData = {
                    role_id: formData.role_id,
                    feature_id: formData.feature_id,
                    value: formData.value === 'true' ? true : formData.value === 'false' ? false : formData.value,
                    description: formData.description
                };

                if (this.editingFeature) {
                    // Update existing feature
                    await dataFunctions.updateRoleFeature(this.editingFeature.id, backendData);
                    this.showSuccess('Feature updated successfully');
                } else {
                    // Create new feature
                    await dataFunctions.createRoleFeature(backendData);
                    this.showSuccess('Feature created successfully');
                }

                $('#featureModal').modal('hide');
                this.loadFeatures();
            } catch (error) {
                console.error('Error saving feature:', error);
                this.showError('Error saving feature: ' + error.message);
            }
        },

        populateForm: function (feature) {
            console.log('populateForm called with feature:', feature);
            console.log('Available feature fields:', Object.keys(feature));

            // Use the correct field names from the database response
            const roleId = feature.role_id || '';
            const featureId = feature.feature_id || '';
            const featureValue = feature.value || '';

            console.log('Setting role ID to:', roleId);
            console.log('Available role options:', $('#cboRole option').map(function () { return this.value; }).get());
            $('#cboRole').val(roleId);
            console.log('Role dropdown value after setting:', $('#cboRole').val());

            console.log('Setting feature ID to:', featureId);
            console.log('Available feature options:', $('#cboFeature option').map(function () { return this.value; }).get());
            $('#cboFeature').val(featureId);
            console.log('Feature dropdown value after setting:', $('#cboFeature').val());

            console.log('Setting feature value to:', featureValue);
            $('#cboValue').val(featureValue);
            console.log('Value dropdown value after setting:', $('#cboValue').val());

            console.log('Form population complete');
        },

        clearForm: function () {
            $('#featureForm')[0].reset();
            this.editingFeature = null;
        },

        showLoading: function () {
            $('#featuresTableBody').html('<tr><td colspan="5" class="text-center"><i class="fas fa-spinner fa-spin"></i> Loading...</td></tr>');
        },

        hideLoading: function () {
            // Loading will be replaced by renderFeatures
        },

        showError: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'error');
            } else {
                alert(message);
            }
        },

        showSuccess: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'success');
            } else {
                alert(message);
            }
        },

        escapeHtml: function (text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },

        formatDate: function (dateString, type = 'short') {
            if (!dateString) return '';

            const date = new Date(dateString);
            if (isNaN(date)) return 'Invalid Date';

            if (type === 'short') {
                return date.toLocaleDateString();
            } else if (type === 'datetime') {
                return date.toLocaleString();
            }

            return date.toLocaleString();
        },

        exportFeatures: function () {
            // Implementation for exporting features
            console.log('Export features functionality');
            this.showSuccess('Export functionality will be implemented');
        },

        refreshFeatures: function () {
            this.loadFeatures();
        },

        search: function () {
            this.filterFeatures();
        },

        applyFilters: function () {
            this.filterFeatures();
        },

        clearFilters: function () {
            $('#searchInput').val('');
            $('#filterRole').val('');
            $('#filterFeature').val('');
            $('#filterValue').val('');
            this.filterFeatures();
        },

        // Add missing functions that are called from HTML
        confirmDelete: function () {
            // This should handle delete confirmation
            // For now, show a message that this needs to be implemented
            this.showInfo('Delete confirmation functionality needs to be implemented');
        },

        showInfo: function (message) {
            if (typeof _common !== 'undefined' && _common.showToastMessage) {
                _common.showToastMessage(message, 'info');
            } else {
                alert(message);
            }
        },

        loadRolesForDropdown: async function () {
            try {
                const roles = await dataFunctions.getRoles();
                const roleSelects = ['roleId', 'filterRole'];
                roleSelects.forEach(selectId => {
                    const select = document.getElementById(selectId);
                    if (select) {
                        let html = '<option value="">Select Role</option>';
                        if (selectId === 'filterRole') {
                            html = '<option value="">All Roles</option>';
                        }
                        roles.forEach(role => {
                            html += `<option value="${role.id}">${role.role_name}</option>`;
                        });
                        select.innerHTML = html;
                    }
                });
            } catch (error) {
                console.error('Error loading roles:', error);
            }
        }
    }
}();

// Initialize role features grid when module is loaded
function initializeRoleFeaturesGrid() {
    if (typeof dataFunctions !== 'undefined') {
        _roleFeaturesGrid.init();
    } else {
        // Wait for dataFunctions to be available
        setTimeout(initializeRoleFeaturesGrid, 100);
    }
}

// Create global reference for HTML onclick handlers
var roleFeaturesGrid = _roleFeaturesGrid;

// Auto-initialize if DOM is ready
$(document).ready(function () {
    initializeRoleFeaturesGrid();
});