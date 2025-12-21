/**
 * Data Functions Module
 * Handles all CRUD operations and data management functionality
 * Following WebPortals module pattern
 */

var _dataFunctions = function () {
    return {
        proxyUrl: 'https://rzrx6ntfejvb6lxpmt4ywruvt40mjjuo.lambda-url.af-south-1.on.aws/proxy/function',

        init: function () {
        },

        /**
         * Get current authentication token
         */
        getToken: function () {
            // First try to get from authService if available
            if (typeof authService !== 'undefined' && authService.token) {
                return authService.token;
            }
            // Fallback to localStorage
            return localStorage.getItem('lambda_token');
        },

        /**
         * Check if user is authenticated
         */
        isAuthenticated: function () {
            const token = this.getToken();
            return !!token;
        },

        /**
         * Get authentication status info
         */
        getAuthStatus: function () {
            const token = this.getToken();
            const userInfo = localStorage.getItem('user_info');

            return {
                hasToken: !!token,
                tokenLength: token ? token.length : 0,
                hasUserInfo: !!userInfo,
                userInfo: userInfo ? JSON.parse(userInfo) : null,
                authServiceAvailable: typeof authService !== 'undefined'
            };
        },

        /**
         * Check if current user has admin privileges
         */
        hasAdminRole: function () {
            const userInfo = localStorage.getItem('user_info');
            if (!userInfo) return false;

            const user = JSON.parse(userInfo);
            const roleName = user.role_name || user.role || '';

            return roleName.toLowerCase().includes('admin') ||
                roleName.toLowerCase().includes('super admin');
        },

        /**
         * Check if user can access user management features
         */
        canAccessUserManagement: function () {
            const userInfo = localStorage.getItem('user_info');
            if (!userInfo) return false;

            const user = JSON.parse(userInfo);
            const roleName = user.role_name || user.role || '';

            // If we have a role_id but no role_name, we might need to fetch complete user info
            if (user.role_id && !roleName) {
                // For now, allow access if user is authenticated and has a role_id
                return true;
            }

            // Temporary: Allow all authenticated users for testing
            // TODO: Restrict this once roles are properly configured
            if (userInfo) {
                return true;
            }

            // Allow access for admin roles, manager roles, and users (more permissive)
            return roleName.toLowerCase().includes('admin') ||
                roleName.toLowerCase().includes('manager') ||
                roleName.toLowerCase().includes('super admin') ||
                roleName.toLowerCase().includes('user') ||
                roleName.toLowerCase().includes('transport') ||
                roleName.toLowerCase().includes('fleet') ||
                roleName.toLowerCase().includes('customer service');
        },

        /**
         * Debug function to show current user info
         */
        debugUserInfo: function () {
            const authStatus = this.getAuthStatus();
            return authStatus;
        },

        /**
         * Generic function call to Lambda proxy
         */
        callFunction: async function (functionName, params = {}, token = null) {
            const authToken = token || this.getToken();

            if (!authToken) {
                throw new Error('No authentication token available. Please sign in again.');
            }

            try {
                const response = await fetch(this.proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`
                    },
                    body: JSON.stringify({
                        function: functionName,
                        params: params
                    })
                });

                if (!response.ok) {
                    let errorMessage = `HTTP error! status: ${response.status}`;
                    let errorData = null;
                    try {
                        const responseText = await response.text();
                        try {
                            errorData = JSON.parse(responseText);
                            errorMessage = errorData.message || errorData.error || errorMessage;
                        } catch (e) {
                            // If response isn't JSON, use the text
                            errorMessage = responseText || response.statusText || errorMessage;
                        }
                    } catch (e) {
                        // If response isn't JSON, use status text
                        errorMessage = response.statusText || errorMessage;
                    }
                    
                    // Handle 401 Unauthorized - token expired or invalid
                    if (response.status === 401) {
                        const finalMessage = errorMessage || 'Invalid or expired token';
                        throw new Error(finalMessage);
                    }
                    
                    throw new Error(errorMessage);
                }

                const responseText = await response.text();
                let data;
                try {
                    data = JSON.parse(responseText);
                } catch (e) {
                    throw new Error(`Invalid JSON response from server: ${responseText.substring(0, 200)}`);
                }
                return data;

            } catch (error) {
                throw error;
            }
        },

        // ===== USER MANAGEMENT FUNCTIONS =====

        /**
         * Get all users
         */
        getUsers: async function (token = null) {
            return await this.callFunction('get_users', {}, token);
        },

        /**
         * Get user by ID
         */
        getUserById: async function (userId, token = null) {
            return await this.callFunction('get_user_by_id', { p_id: userId }, token);
        },

        /**
         * Create user
         */
        createUser: async function (userData, token = null) {
            const params = {
                p_email: userData.email,
                p_username: userData.username || null,
                p_role_id: userData.role_id || null,
                p_password: userData.password || null
            };
            return await this.callFunction('create_user_simple', params, token);
        },

        /**
         * Update user
         */
        updateUser: async function (userId, userData, token = null) {
            const params = {
                p_user_id: userId,
                p_email: userData.email || null,
                p_username: userData.username || null,
                p_role_id: userData.role_id || null,
                p_is_active: userData.is_active !== undefined ? userData.is_active : null,
                p_password: userData.password || null
            };

            return await this.callFunction('update_user_simple', params, token);
        },

        /**
         * Delete user (hard delete)
         */
        deleteUser: async function (userId, token = null) {
            return await this.callFunction('delete_user_hard', { p_user_id: userId }, token);
        },

        /**
         * Deactivate user (soft delete)
         */
        deactivateUser: async function (userId, token = null) {
            return await this.callFunction('deactivate_user', { p_user_id: userId }, token);
        },

        // ===== ROLE MANAGEMENT FUNCTIONS =====

        /**
         * Get all roles
         */
        getRoles: async function (token = null) {
            return await this.callFunction('get_roles', {}, token);
        },

        /**
         * Get role by ID
         */
        getRoleById: async function (roleId, token = null) {
            return await this.callFunction('get_role_by_id', { p_id: roleId }, token);
        },

        /**
         * Create role
         */
        createRole: async function (roleData, token = null) {
            const params = {
                p_role_name: roleData.role_name,
                p_description: roleData.description || null,
                p_is_active: roleData.is_active !== undefined ? roleData.is_active : true
            };
            return await this.callFunction('create_role_simple', params, token);
        },

        /**
         * Update role
         */
        updateRole: async function (roleId, roleData, token = null) {
            const params = {
                p_role_id: roleId,
                p_role_name: roleData.role_name || null,
                p_description: roleData.description || null,
                p_is_active: roleData.is_active !== undefined ? roleData.is_active : null
            };
            return await this.callFunction('update_role_simple', params, token);
        },

        /**
         * Deactivate role (soft delete)
         */
        deactivateRole: async function (roleId, token = null) {
            return await this.callFunction('deactivate_role', { p_id: roleId }, token);
        },

        // ===== ROLE PERMISSIONS FUNCTIONS =====

        /**
         * Get all role permissions
         */
        getRolePermissions: async function (token = null) {
            return await this.callFunction('get_role_permissions', {}, token);
        },

        /**
         * Get role permissions with filtering
         */
        getRolePermissionsFiltered: async function (filters = {}, token = null) {
            const params = {
                p_search_term: filters.searchTerm || null,
                p_role_id: filters.roleId || null,
                p_object_type: filters.objectType || null,
                p_operation: filters.operation || null,
                p_is_active: filters.isActive !== undefined ? filters.isActive : null
            };
            const response = await this.callFunction('get_role_permissions_filtered', params, token);

            // Handle the wrapped response format
            if (response && response.get_role_permissions_filtered) {
                return response.get_role_permissions_filtered;
            }
            return response || [];
        },

        /**
         * Get role permission by ID
         */
        getRolePermissionById: async function (permissionId, token = null) {
            return await this.callFunction('get_role_permission_by_id', { p_id: permissionId }, token);
        },

        /**
         * Create role permission
         */
        createRolePermission: async function (permissionData, token = null) {
            const params = {
                p_role_id: permissionData.role_id,
                p_object_type: permissionData.object_type,
                p_object_name: permissionData.object_name,
                p_operation: permissionData.operation,
                p_allowed: permissionData.is_active !== undefined ? permissionData.is_active : true
            };
            return await this.callFunction('create_role_permission_simple', params, token);
        },

        /**
         * Update role permission
         */
        updateRolePermission: async function (permissionId, permissionData, token = null) {
            const params = {
                p_permission_id: permissionId,
                p_role_id: permissionData.role_id || null,
                p_object_type: permissionData.object_type || null,
                p_object_name: permissionData.object_name || null,
                p_operation: permissionData.operation || null,
                p_allowed: permissionData.is_active !== undefined ? permissionData.is_active : null
            };
            return await this.callFunction('update_role_permission_simple', params, token);
        },

        /**
         * Delete role permission (hard delete)
         */
        deleteRolePermission: async function (permissionId, token = null) {
            return await this.callFunction('delete_role_permission_simple', { p_permission_id: permissionId }, token);
        },

        // ===== DRIVER MANAGEMENT FUNCTIONS =====

        getDrivers: async function (token = null) {
            const response = await this.callFunction('get_drivers', {}, token);
            if (response && response.get_drivers) {
                return response.get_drivers;
            }
            return response || [];
        },

        createDriver: async function (driverData, token = null) {
            const params = {
                p_full_name: driverData.full_name,
                p_employee_id: driverData.employee_id,
                p_email: driverData.email || null,
                p_contact_number: driverData.contact_number || null,
                p_license_status: driverData.license_status,
                p_last_inspection: driverData.last_inspection,
                p_performance: driverData.performance,
                p_status: driverData.status,
                p_notes: driverData.notes || null
            };
            // Include vehicle_id if provided
            if (driverData.vehicle_id) {
                params.p_vehicle_id = driverData.vehicle_id;
            }
            return await this.callFunction('create_driver_simple', params, token);
        },

        updateDriver: async function (driverId, driverData, token = null) {
            const params = {
                p_driver_id: driverId,
                p_full_name: driverData.full_name,
                p_employee_id: driverData.employee_id,
                p_email: driverData.email || null,
                p_contact_number: driverData.contact_number || null,
                p_license_status: driverData.license_status,
                p_last_inspection: driverData.last_inspection,
                p_performance: driverData.performance,
                p_status: driverData.status,
                p_notes: driverData.notes || null
            };
            // Include vehicle_id if provided (can be null to unassign)
            params.p_vehicle_id = driverData.vehicle_id || null;
            return await this.callFunction('update_driver_simple', params, token);
        },

        deleteDriver: async function (driverId, token = null) {
            return await this.callFunction('delete_driver_simple', { p_driver_id: driverId }, token);
        },

        // ===== VEHICLE MANAGEMENT FUNCTIONS =====

        getVehicles: async function (token = null) {
            const response = await this.callFunction('get_vehicles', {}, token);
            if (response && response.get_vehicles) {
                return response.get_vehicles;
            }
            return response || [];
        },

        createVehicle: async function (vehicleData, token = null) {
            const params = {
                p_vehicle_code: vehicleData.vehicle_code,
                p_vehicle_type: vehicleData.vehicle_type,
                p_status: vehicleData.status,
                p_last_inspection: vehicleData.last_inspection,
                p_next_service: vehicleData.next_service,
                p_location: vehicleData.location || null,
                p_notes: vehicleData.notes || null,
                p_fleet_number: vehicleData.fleet_number || null
            };
            // Include photo if provided
            if (vehicleData.photo) {
                params.p_photo = vehicleData.photo;
            }
            // Include driver_id if provided
            if (vehicleData.driver_id) {
                params.p_driver_id = vehicleData.driver_id;
            }
            return await this.callFunction('create_vehicle_simple', params, token);
        },

        updateVehicle: async function (vehicleId, vehicleData, token = null) {
            const params = {
                p_vehicle_id: vehicleId,
                p_vehicle_code: vehicleData.vehicle_code,
                p_vehicle_type: vehicleData.vehicle_type,
                p_status: vehicleData.status,
                p_last_inspection: vehicleData.last_inspection,
                p_next_service: vehicleData.next_service,
                p_location: vehicleData.location || null,
                p_notes: vehicleData.notes || null,
                p_fleet_number: vehicleData.fleet_number || null
            };
            // Include photo if provided
            if (vehicleData.photo) {
                params.p_photo = vehicleData.photo;
            }
            // Include driver_id if provided (can be null to unassign)
            params.p_driver_id = vehicleData.driver_id || null;
            return await this.callFunction('update_vehicle_simple', params, token);
        },

        deleteVehicle: async function (vehicleId, token = null) {
            return await this.callFunction('delete_vehicle_simple', { p_vehicle_id: vehicleId }, token);
        },

        // ===== INSPECTION MANAGEMENT =====

        getInspections: async function (token = null) {
            // Use get_inspections which now returns data from new structure
            const response = await this.callFunction('get_inspections', {}, token);
            if (response && response.get_inspections) {
                return response.get_inspections;
            }
            if (Array.isArray(response)) {
                return response;
            }
            return response || [];
        },

        getDriverByUserId: async function (userId, token = null) {
            return await this.callFunction('get_driver_by_user_id', { p_user_id: userId }, token);
        },

        getInspectionTemplate: async function (token = null) {
            try {
                const response = await this.callFunction('get_inspection_template', {}, token);
                if (Array.isArray(response)) {
                    return response;
                }
                if (response && response.get_inspection_template) {
                    return response.get_inspection_template;
                }
                return response || [];
            } catch (e) {
                return [];
            }
        },

        createInspectionNew: async function (inspectionData, token = null) {
            const params = {
                p_driver_name: inspectionData.driver_name,
                p_inspection_date: inspectionData.inspection_date,
                p_driver_co_nr: inspectionData.driver_co_nr || null,
                p_driver_name_2: inspectionData.driver_name_2 || null,
                p_driver_co_nr_2: inspectionData.driver_co_nr_2 || null,
                p_fleet_number: inspectionData.fleet_number || null,
                p_vehicle_id: inspectionData.vehicle_id ? String(inspectionData.vehicle_id) : null,
                p_driver_id: inspectionData.driver_id ? String(inspectionData.driver_id) : null,
                p_driver_signature_name: inspectionData.driver_signature_name || null,
                p_driver_signature: inspectionData.driver_signature || null,
                p_trip_start_time: inspectionData.trip_start_time || null,
                p_trip_end_time: inspectionData.trip_end_time || null,
                p_supervisor_name: inspectionData.supervisor_name || null,
                p_supervisor_signature: inspectionData.supervisor_signature || null,
                p_supervisor_date: inspectionData.supervisor_date || null,
                p_created_by: inspectionData.created_by ? String(inspectionData.created_by) : null,
                p_updated_by: inspectionData.updated_by ? String(inspectionData.updated_by) : null
            };

            // Convert sections array to JSON string for database
            if (inspectionData.sections && Array.isArray(inspectionData.sections) && inspectionData.sections.length > 0) {
                params.p_sections = JSON.stringify(inspectionData.sections);
            } else {
                params.p_sections = null;
            }

            return await this.callFunction('create_inspection', params, token);
        },

        createInspection: async function (inspectionData, token = null) {
            return await this.callFunction('create_inspection_simple', {
                p_inspection_code: inspectionData.inspection_code,
                p_vehicle_code: inspectionData.vehicle_code,
                p_driver_name: inspectionData.driver_name,
                p_inspection_date: inspectionData.inspection_date,
                p_status: inspectionData.status,
                p_critical_issues: inspectionData.critical_issues || 0,
                p_notes: inspectionData.notes || null
            }, token);
        },

        updateInspection: async function (inspectionId, inspectionData, token = null) {
            return await this.callFunction('update_inspection_simple', {
                p_inspection_id: inspectionId,
                p_inspection_code: inspectionData.inspection_code,
                p_vehicle_code: inspectionData.vehicle_code,
                p_driver_name: inspectionData.driver_name,
                p_inspection_date: inspectionData.inspection_date,
                p_status: inspectionData.status,
                p_critical_issues: inspectionData.critical_issues,
                p_notes: inspectionData.notes || null
            }, token);
        },

        deleteInspection: async function (inspectionId, token = null) {
            return await this.callFunction('delete_inspection_simple', { p_inspection_id: inspectionId }, token);
        },

        // ===== FEATURES FUNCTIONS =====

        /**
         * Get all available features (for dropdowns)
         */
        getFeatures: async function (token = null) {
            return await this.callFunction('get_features', {}, token);
        },

        // ===== ROLE FEATURES FUNCTIONS =====

        /**
         * Get all role features
         */
        getRoleFeatures: async function (token = null) {
            return await this.callFunction('get_role_features', {}, token);
        },

        /**
         * Get role feature by ID
         */
        getRoleFeatureById: async function (featureId, token = null) {
            return await this.callFunction('get_role_feature_by_id', { p_id: featureId }, token);
        },

        /**
         * Create role feature
         */
        createRoleFeature: async function (featureData, token = null) {
            const params = {
                role_id: featureData.role_id,
                feature_id: featureData.feature_id,
                value: featureData.value
            };
            return await this.callFunction('create_role_feature_simple', params, token);
        },

        /**
         * Update role feature
         */
        updateRoleFeature: async function (featureId, featureData, token = null) {
            const params = {
                role_feature_id: featureId,
                role_id: featureData.role_id,
                feature_id: featureData.feature_id,
                value: featureData.value
            };
            return await this.callFunction('update_role_feature_simple', params, token);
        },

        /**
         * Delete role feature
         */
        deleteRoleFeature: async function (featureId, token = null) {
            return await this.callFunction('delete_role_feature_simple', { role_feature_id: featureId }, token);
        },

        // ===== COMPANY MANAGEMENT FUNCTIONS =====

        /**
         * Get all companies
         */
        getCompanies: async function (token = null) {
            return await this.callFunction('get_companies', {}, token);
        },

        /**
         * Get company by ID
         */
        getCompanyById: async function (companyId, token = null) {
            return await this.callFunction('get_company_by_id', { p_id: companyId }, token);
        },

        /**
         * Create company
         */
        createCompany: async function (companyData, token = null) {
            const params = {
                company_name: companyData.name,
                phone: companyData.phone_primary,
                email: companyData.email_primary,
                website_url: companyData.website
            };
            return await this.callFunction('create_company_simple', params, token);
        },

        /**
         * Update company
         */
        updateCompany: async function (companyId, companyData, token = null) {
            const params = {
                company_id: companyId,
                company_name: companyData.name,
                phone: companyData.phone_primary,
                email: companyData.email_primary,
                website_url: companyData.website
            };
            return await this.callFunction('update_company_simple', params, token);
        },

        /**
         * Delete company (hard delete)
         */
        deleteCompany: async function (companyId, token = null) {
            return await this.callFunction('delete_company', { p_id: companyId }, token);
        },

        // ===== FARM MANAGEMENT FUNCTIONS =====

        getFarms: async function (token = null) {
            return await this.callFunction('get_farms', {}, token);
        },

        getFarmById: async function (farmId, token = null) {
            return await this.callFunction('get_farm_by_id', { p_id: farmId }, token);
        },

        createFarm: async function (farmData, token = null) {
            const params = {
                p_name: farmData.name,
                p_location: farmData.location || null,
                p_region: farmData.region || null,
                p_hectares: farmData.hectares || null,
                p_crop_type: farmData.crop_type || null,
                p_manager_id: farmData.manager_id || null
            };
            return await this.callFunction('create_farm_simple', params, token);
        },

        updateFarm: async function (farmId, farmData, token = null) {
            const params = {
                p_farm_id: farmId,
                p_name: farmData.name || null,
                p_location: farmData.location || null,
                p_region: farmData.region || null,
                p_hectares: farmData.hectares || null,
                p_crop_type: farmData.crop_type || null,
                p_manager_id: farmData.manager_id || null,
                p_status: farmData.status || null,
                p_is_active: farmData.is_active !== undefined ? farmData.is_active : null
            };
            return await this.callFunction('update_farm_simple', params, token);
        },

        // ===== BLOCKS FUNCTIONS =====

        getBlocks: async function (token = null) {
            return await this.callFunction('get_blocks', {}, token);
        },

        createBlock: async function (blockData, token = null) {
            const params = {
                p_farm_id: blockData.farm_id,
                p_name: blockData.name,
                p_variety_id: blockData.variety_id || null,
                p_hectares: blockData.hectares || null,
                p_row_count: blockData.row_count || null,
                p_tree_count: blockData.tree_count || null,
                p_planting_date: blockData.planting_date || null
            };
            return await this.callFunction('create_block_simple', params, token);
        },

        // ===== CROP TYPES FUNCTIONS =====

        getCropTypes: async function (token = null) {
            return await this.callFunction('get_crop_types', {}, token);
        },

        // ===== VARIETIES FUNCTIONS =====

        getVarieties: async function (token = null) {
            return await this.callFunction('get_varieties', {}, token);
        },

        createVariety: async function (varietyData, token = null) {
            const params = {
                p_farm_id: varietyData.farm_id,
                p_name: varietyData.name,
                p_crop_type_id: varietyData.crop_type_id || null,
                p_hectares: varietyData.hectares || null,
                p_planting_year: varietyData.planting_year || null
            };
            return await this.callFunction('create_variety_simple', params, token);
        },

        // ===== LABOUR MANAGEMENT FUNCTIONS =====

        getWorkers: async function (filters = {}, token = null) {
            const params = {};
            // Validate UUID format before adding farmId
            if (filters.farmId && filters.farmId !== 'all') {
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (uuidRegex.test(filters.farmId)) {
                    params.p_farm_id = filters.farmId;
                } else {
                    console.warn('Invalid UUID format for farmId:', filters.farmId);
                }
            }
            if (filters.search) params.p_search_term = filters.search;
            if (filters.status) params.p_status = filters.status;
            if (filters.employmentType) params.p_employment_type = filters.employmentType;
            
            return await this.callFunction('get_workers', params, token);
        },

        createWorker: async function (workerData, token = null) {
            const params = {
                p_employee_number: workerData.employee_number,
                p_first_name: workerData.first_name,
                p_last_name: workerData.last_name,
                p_id_number: workerData.id_number || null,
                p_phone: workerData.phone || null,
                p_email: workerData.email || null,
                p_home_farm_id: workerData.home_farm_id || null,
                p_current_farm_id: workerData.current_farm_id || null,
                p_employment_type: workerData.employment_type || null,
                p_hire_date: workerData.hire_date || null,
                p_position: workerData.position || null,
                p_hourly_rate: workerData.hourly_rate || null
            };
            return await this.callFunction('create_worker_simple', params, token);
        },

        getWorkerAllocations: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_block_id: filters.blockId || null,
                p_worker_id: filters.workerId || null,
                p_task_type: filters.taskType || null,
                p_allocation_date: filters.allocationDate || null,
                p_status: filters.status || null
            };
            return await this.callFunction('get_worker_allocations', params, token);
        },

        createWorkerAllocation: async function (allocationData, token = null) {
            const params = {
                p_worker_id: allocationData.worker_id,
                p_farm_id: allocationData.farm_id,
                p_allocation_date: allocationData.allocation_date,
                p_block_id: allocationData.block_id || null,
                p_variety_id: allocationData.variety_id || null,
                p_task_type: allocationData.task_type || null,
                p_start_time: allocationData.start_time || null,
                p_end_time: allocationData.end_time || null,
                p_hours_worked: allocationData.hours_worked || null
            };
            return await this.callFunction('create_worker_allocation_simple', params, token);
        },

        updateWorker: async function (workerId, workerData, token = null) {
            const params = {
                p_worker_id: workerId,
                p_first_name: workerData.first_name || null,
                p_last_name: workerData.last_name || null,
                p_id_number: workerData.id_number || null,
                p_employee_number: workerData.employee_number || null,
                p_hourly_rate: workerData.hourly_rate !== undefined ? workerData.hourly_rate : null,
                p_phone: workerData.phone || null,
                p_email: workerData.email || null,
                p_home_farm_id: workerData.home_farm_id || null,
                p_current_farm_id: workerData.current_farm_id || null,
                p_employment_type: workerData.employment_type || null,
                p_hire_date: workerData.hire_date || null,
                p_position: workerData.position || null,
                p_is_active: workerData.is_active !== undefined ? workerData.is_active : null,
                p_bank_name: workerData.bank_name || null,
                p_bank_account_number: workerData.bank_account_number || null,
                p_bank_branch_code: workerData.bank_branch_code || null
            };
            return await this.callFunction('update_worker_simple', params, token);
        },

        deleteWorker: async function (workerId, token = null) {
            return await this.callFunction('deactivate_worker', { p_worker_id: workerId }, token);
        },

        updateWorkerAllocation: async function (allocationId, allocationData, token = null) {
            const params = {
                p_allocation_id: allocationId,
                p_worker_id: allocationData.worker_id || null,
                p_farm_id: allocationData.farm_id || null,
                p_block_id: allocationData.block_id || null,
                p_allocation_date: allocationData.allocation_date || null,
                p_task_type: allocationData.task_type || null,
                p_start_time: allocationData.start_time || null,
                p_end_time: allocationData.end_time || null,
                p_status: allocationData.status || null,
                p_quantity_completed: allocationData.quantity_completed !== undefined ? allocationData.quantity_completed : null,
                p_hours_worked: allocationData.hours_worked !== undefined ? allocationData.hours_worked : null
            };
            return await this.callFunction('update_worker_allocation_simple', params, token);
        },

        deleteWorkerAllocation: async function (allocationId, token = null) {
            return await this.callFunction('delete_worker_allocation_hard', { p_allocation_id: allocationId }, token);
        },

        // ===== LABOUR TRANSFER FUNCTIONS =====

        getLabourTransfers: async function (filters = {}, token = null) {
            // Use direct SQL query since there may not be a function for this
            // For now, identify shared workers by home_farm_id != current_farm_id
            const params = {};
            if (filters.farmId) params.p_farm_id = filters.farmId;
            if (filters.status) params.p_status = filters.status;
            // Note: This will need to be implemented as a database function
            // For now, we'll identify shared workers from worker data
            return [];
        },

        getSharedWorkers: async function (filters = {}, token = null) {
            // Get all workers and filter for shared workers (home_farm_id != current_farm_id)
            const allWorkers = await this.getWorkers(filters, token);
            if (!allWorkers || !Array.isArray(allWorkers)) {
                return [];
            }
            
            // Filter for shared workers
            const sharedWorkers = allWorkers.filter(worker => {
                const homeFarmId = worker.home_farm_id || worker.homeFarmId;
                const currentFarmId = worker.current_farm_id || worker.currentFarmId;
                return homeFarmId && currentFarmId && homeFarmId !== currentFarmId && worker.is_active !== false;
            });
            
            return sharedWorkers;
        },

        createLabourTransfer: async function (transferData, token = null) {
            const params = {
                p_origin_farm_id: transferData.origin_farm_id || transferData.originFarmId,
                p_destination_farm_id: transferData.destination_farm_id || transferData.destinationFarmId,
                p_start_date: transferData.start_date || transferData.startDate,
                p_end_date: transferData.end_date || transferData.endDate || null,
                p_notes: transferData.notes || null
            };
            // This would need a database function - for now, return placeholder
            // return await this.callFunction('create_labour_transfer', params, token);
            throw new Error('Labour transfer creation not yet implemented in database');
        },

        updateWorkerTransfer: async function (workerId, destinationFarmId, token = null) {
            // Update worker's current_farm_id to transfer them
            return await this.updateWorker(workerId, {
                current_farm_id: destinationFarmId
            }, token);
        },

        // ===== DASHBOARD FUNCTIONS =====

        getDashboardStats: async function (farmId = null, token = null) {
            const params = farmId ? { p_farm_id: farmId } : {};
            return await this.callFunction('get_dashboard_stats', params, token);
        },

        getDashboardAlerts: async function (farmId = null, token = null) {
            const params = farmId ? { p_farm_id: farmId } : {};
            return await this.callFunction('get_dashboard_alerts', params, token);
        },

        getRecentActivity: async function (farmId = null, limit = 10, token = null) {
            const params = {
                p_farm_id: farmId || null,
                p_limit: limit
            };
            return await this.callFunction('get_recent_activity', params, token);
        },

        // ===== CHEMICAL MANAGEMENT FUNCTIONS =====

        getChemicals: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_search_term: filters.search || null,
                p_active_ingredient: filters.activeIngredient || null
            };
            return await this.callFunction('get_chemicals', params, token);
        },

        createChemical: async function (chemicalData, token = null) {
            const params = {
                p_farm_id: chemicalData.farm_id,
                p_name: chemicalData.name,
                p_active_ingredient: chemicalData.active_ingredient || null,
                p_registration_number: chemicalData.registration_number || null,
                p_phi_days: chemicalData.phi_days || null,
                p_quantity_on_hand: chemicalData.quantity_on_hand || null,
                p_unit: chemicalData.unit || null,
                p_expiry_date: chemicalData.expiry_date || null
            };
            return await this.callFunction('create_chemical_simple', params, token);
        },

        updateChemical: async function (chemicalId, chemicalData, token = null) {
            const params = {
                p_chemical_id: chemicalId,
                p_farm_id: chemicalData.farm_id || null,
                p_name: chemicalData.name || null,
                p_active_ingredient: chemicalData.active_ingredient || null,
                p_registration_number: chemicalData.registration_number || null,
                p_phi_days: chemicalData.phi_days !== undefined ? chemicalData.phi_days : null,
                p_quantity_on_hand: chemicalData.quantity_on_hand !== undefined ? chemicalData.quantity_on_hand : null,
                p_unit: chemicalData.unit || null,
                p_expiry_date: chemicalData.expiry_date || null,
                p_is_active: chemicalData.is_active !== undefined ? chemicalData.is_active : null
            };
            return await this.callFunction('update_chemical_simple', params, token);
        },

        deleteChemical: async function (chemicalId, token = null) {
            return await this.callFunction('deactivate_chemical', { p_chemical_id: chemicalId }, token);
        },

        getSprayApplications: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_block_id: filters.blockId || null,
                p_chemical_id: filters.chemicalId || null,
                p_start_date: filters.startDate || null,
                p_end_date: filters.endDate || null
            };
            return await this.callFunction('get_spray_applications', params, token);
        },

        createSprayApplication: async function (applicationData, token = null) {
            const params = {
                p_farm_id: applicationData.farm_id,
                p_chemical_id: applicationData.chemical_id,
                p_application_date: applicationData.application_date,
                p_block_id: applicationData.block_id || null,
                p_variety_id: applicationData.variety_id || null,
                p_quantity_used: applicationData.quantity_used || null,
                p_area_treated: applicationData.area_treated || null,
                p_operator_id: applicationData.operator_id || null
            };
            return await this.callFunction('create_spray_application_simple', params, token);
        },

        updateSprayApplication: async function (applicationId, applicationData, token = null) {
            const params = {
                p_application_id: applicationId,
                p_farm_id: applicationData.farm_id || null,
                p_chemical_id: applicationData.chemical_id || null,
                p_application_date: applicationData.application_date || null,
                p_block_id: applicationData.block_id || null,
                p_variety_id: applicationData.variety_id || null,
                p_quantity_used: applicationData.quantity_used !== undefined ? applicationData.quantity_used : null,
                p_area_treated: applicationData.area_treated !== undefined ? applicationData.area_treated : null,
                p_operator_id: applicationData.operator_id || null
            };
            return await this.callFunction('update_spray_application_simple', params, token);
        },

        deleteSprayApplication: async function (applicationId, token = null) {
            return await this.callFunction('delete_spray_application_hard', { p_application_id: applicationId }, token);
        },

        // ===== CROP MONITORING FUNCTIONS =====

        getFruitMeasurements: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_block_id: filters.blockId || null,
                p_variety_id: filters.varietyId || null,
                p_start_date: filters.startDate || null,
                p_end_date: filters.endDate || null
            };
            return await this.callFunction('get_fruit_measurements', params, token);
        },

        createFruitMeasurement: async function (measurementData, token = null) {
            const params = {
                p_farm_id: measurementData.farm_id,
                p_measurement_date: measurementData.measurement_date,
                p_block_id: measurementData.block_id || null,
                p_variety_id: measurementData.variety_id || null,
                p_days_after_full_bloom: measurementData.days_after_full_bloom || null,
                p_sample_size: measurementData.sample_size || null,
                p_circumference_avg: measurementData.circumference_avg || null,
                p_weight_avg: measurementData.weight_avg || null
            };
            return await this.callFunction('create_fruit_measurement_simple', params, token);
        },

        updateFruitMeasurement: async function (measurementId, measurementData, token = null) {
            const params = {
                p_measurement_id: measurementId,
                p_farm_id: measurementData.farm_id || null,
                p_measurement_date: measurementData.measurement_date || null,
                p_block_id: measurementData.block_id || null,
                p_variety_id: measurementData.variety_id || null,
                p_days_after_full_bloom: measurementData.days_after_full_bloom !== undefined ? measurementData.days_after_full_bloom : null,
                p_sample_size: measurementData.sample_size !== undefined ? measurementData.sample_size : null,
                p_circumference_avg: measurementData.circumference_avg !== undefined ? measurementData.circumference_avg : null,
                p_weight_avg: measurementData.weight_avg !== undefined ? measurementData.weight_avg : null
            };
            return await this.callFunction('update_fruit_measurement_simple', params, token);
        },

        deleteFruitMeasurement: async function (measurementId, token = null) {
            return await this.callFunction('delete_fruit_measurement_hard', { p_measurement_id: measurementId }, token);
        },

        // ===== ASSET MANAGEMENT FUNCTIONS =====

        getVehicles: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_vehicle_type: filters.vehicleType || null,
                p_search_term: filters.search || null
            };
            return await this.callFunction('get_vehicles', params, token);
        },

        createVehicle: async function (vehicleData, token = null) {
            const params = {
                p_farm_id: vehicleData.farm_id,
                p_registration_number: vehicleData.registration_number,
                p_make: vehicleData.make || null,
                p_model: vehicleData.model || null,
                p_year: vehicleData.year || null,
                p_vehicle_type: vehicleData.vehicle_type || null,
                p_fuel_type: vehicleData.fuel_type || null,
                p_current_odometer: vehicleData.current_odometer || null
            };
            return await this.callFunction('create_vehicle_simple', params, token);
        },

        getFuelTransactions: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_vehicle_id: filters.vehicleId || null,
                p_start_date: filters.startDate || null,
                p_end_date: filters.endDate || null
            };
            return await this.callFunction('get_fuel_transactions', params, token);
        },

        createFuelTransaction: async function (transactionData, token = null) {
            const params = {
                p_vehicle_id: transactionData.vehicle_id,
                p_farm_id: transactionData.farm_id,
                p_transaction_date: transactionData.transaction_date,
                p_litres: transactionData.litres,
                p_cost: transactionData.cost || null,
                p_price_per_litre: transactionData.price_per_litre || null,
                p_odometer_reading: transactionData.odometer_reading || null
            };
            return await this.callFunction('create_fuel_transaction_simple', params, token);
        },

        updateFuelTransaction: async function (transactionId, transactionData, token = null) {
            const params = {
                p_transaction_id: transactionId,
                p_vehicle_id: transactionData.vehicle_id || null,
                p_farm_id: transactionData.farm_id || null,
                p_transaction_date: transactionData.transaction_date || null,
                p_litres: transactionData.litres !== undefined ? transactionData.litres : null,
                p_cost: transactionData.cost !== undefined ? transactionData.cost : null,
                p_price_per_litre: transactionData.price_per_litre !== undefined ? transactionData.price_per_litre : null,
                p_odometer_reading: transactionData.odometer_reading !== undefined ? transactionData.odometer_reading : null
            };
            return await this.callFunction('update_fuel_transaction_simple', params, token);
        },

        deleteFuelTransaction: async function (transactionId, token = null) {
            return await this.callFunction('delete_fuel_transaction_hard', { p_transaction_id: transactionId }, token);
        },

        // ===== WATER & IRRIGATION FUNCTIONS =====

        getPumpReadings: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_pump_location: filters.pumpLocation || null,
                p_start_date: filters.startDate || null,
                p_end_date: filters.endDate || null
            };
            return await this.callFunction('get_pump_readings', params, token);
        },

        createPumpReading: async function (readingData, token = null) {
            const params = {
                p_farm_id: readingData.farm_id,
                p_pump_location: readingData.pump_location,
                p_reading_date: readingData.reading_date,
                p_meter_reading: readingData.meter_reading,
                p_previous_reading: readingData.previous_reading || null,
                p_usage_m3: readingData.usage_m3 || null
            };
            return await this.callFunction('create_pump_reading_simple', params, token);
        },

        updatePumpReading: async function (readingId, readingData, token = null) {
            const params = {
                p_reading_id: readingId,
                p_farm_id: readingData.farm_id || null,
                p_pump_location: readingData.pump_location || null,
                p_reading_date: readingData.reading_date || null,
                p_meter_reading: readingData.meter_reading !== undefined ? readingData.meter_reading : null,
                p_previous_reading: readingData.previous_reading !== undefined ? readingData.previous_reading : null,
                p_usage_m3: readingData.usage_m3 !== undefined ? readingData.usage_m3 : null
            };
            return await this.callFunction('update_pump_reading_simple', params, token);
        },

        deletePumpReading: async function (readingId, token = null) {
            return await this.callFunction('delete_pump_reading_hard', { p_reading_id: readingId }, token);
        },

        getWaterLicenses: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_status: filters.status || null
            };
            return await this.callFunction('get_water_licenses', params, token);
        },

        createWaterLicense: async function (licenseData, token = null) {
            const params = {
                p_farm_id: licenseData.farm_id,
                p_license_number: licenseData.license_number,
                p_license_type: licenseData.license_type || null,
                p_issued_date: licenseData.issued_date || null,
                p_expiry_date: licenseData.expiry_date || null,
                p_annual_allocation_m3: licenseData.annual_allocation_m3 || null,
                p_issuing_authority: licenseData.issuing_authority || null,
                p_status: licenseData.status || 'active'
            };
            return await this.callFunction('create_water_license_simple', params, token);
        },

        updateWaterLicense: async function (licenseId, licenseData, token = null) {
            const params = {
                p_license_id: licenseId,
                p_farm_id: licenseData.farm_id || null,
                p_license_number: licenseData.license_number || null,
                p_license_type: licenseData.license_type || null,
                p_issued_date: licenseData.issued_date || null,
                p_expiry_date: licenseData.expiry_date || null,
                p_annual_allocation_m3: licenseData.annual_allocation_m3 !== undefined ? licenseData.annual_allocation_m3 : null,
                p_issuing_authority: licenseData.issuing_authority || null,
                p_status: licenseData.status || null
            };
            return await this.callFunction('update_water_license_simple', params, token);
        },

        deleteWaterLicense: async function (licenseId, token = null) {
            return await this.callFunction('deactivate_water_license', { p_license_id: licenseId }, token);
        },

        // ===== POST-HARVEST FUNCTIONS =====

        getConsignments: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_block_id: filters.blockId || null,
                p_variety_id: filters.varietyId || null,
                p_search_term: filters.search || null,
                p_start_date: filters.startDate || null,
                p_end_date: filters.endDate || null,
                p_market_destination: filters.marketDestination || null
            };
            return await this.callFunction('get_consignments', params, token);
        },

        createConsignment: async function (consignmentData, token = null) {
            const params = {
                p_farm_id: consignmentData.farm_id,
                p_consignment_number: consignmentData.consignment_number,
                p_harvest_date: consignmentData.harvest_date,
                p_block_id: consignmentData.block_id || null,
                p_variety_id: consignmentData.variety_id || null,
                p_pack_date: consignmentData.pack_date || null,
                p_total_pallets: consignmentData.total_pallets || null,
                p_total_cartons: consignmentData.total_cartons || null,
                p_market_destination: consignmentData.market_destination || null
            };
            return await this.callFunction('create_consignment_simple', params, token);
        },

        updateConsignment: async function (consignmentId, consignmentData, token = null) {
            const params = {
                p_consignment_id: consignmentId,
                p_farm_id: consignmentData.farm_id || null,
                p_consignment_number: consignmentData.consignment_number || null,
                p_harvest_date: consignmentData.harvest_date || null,
                p_block_id: consignmentData.block_id || null,
                p_variety_id: consignmentData.variety_id || null,
                p_pack_date: consignmentData.pack_date || null,
                p_total_pallets: consignmentData.total_pallets !== undefined ? consignmentData.total_pallets : null,
                p_total_cartons: consignmentData.total_cartons !== undefined ? consignmentData.total_cartons : null,
                p_market_destination: consignmentData.market_destination || null
            };
            return await this.callFunction('update_consignment_simple', params, token);
        },

        deleteConsignment: async function (consignmentId, token = null) {
            return await this.callFunction('delete_consignment_hard', { p_consignment_id: consignmentId }, token);
        },

        // ===== COMPLIANCE FUNCTIONS =====

        getComplianceDocuments: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_document_type: filters.documentType || null,
                p_category: filters.category || null,
                p_status: filters.status || null,
                p_search_term: filters.search || null
            };
            return await this.callFunction('get_compliance_documents', params, token);
        },

        createComplianceDocument: async function (documentData, token = null) {
            const params = {
                p_farm_id: documentData.farm_id,
                p_document_type: documentData.document_type,
                p_title: documentData.title,
                p_category: documentData.category || null,
                p_file_url: documentData.file_url || null,
                p_expiry_date: documentData.expiry_date || null,
                p_status: documentData.status || null
            };
            return await this.callFunction('create_compliance_document_simple', params, token);
        },

        updateComplianceDocument: async function (documentId, documentData, token = null) {
            const params = {
                p_document_id: documentId,
                p_farm_id: documentData.farm_id || null,
                p_document_type: documentData.document_type || null,
                p_title: documentData.title || null,
                p_category: documentData.category || null,
                p_file_url: documentData.file_url || null,
                p_expiry_date: documentData.expiry_date || null,
                p_status: documentData.status || null
            };
            return await this.callFunction('update_compliance_document_simple', params, token);
        },

        deleteComplianceDocument: async function (documentId, token = null) {
            return await this.callFunction('delete_compliance_document_hard', { p_document_id: documentId }, token);
        },

        getCertificates: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_certificate_type: filters.certificateType || null,
                p_status: filters.status || null,
                p_expiring_soon: filters.expiringSoon || null
            };
            return await this.callFunction('get_certificates', params, token);
        },

        createCertificate: async function (certificateData, token = null) {
            const params = {
                p_farm_id: certificateData.farm_id,
                p_certificate_type: certificateData.certificate_type,
                p_certificate_number: certificateData.certificate_number,
                p_issued_date: certificateData.issued_date || null,
                p_expiry_date: certificateData.expiry_date || null,
                p_issuing_authority: certificateData.issuing_authority || null,
                p_status: certificateData.status || null
            };
            return await this.callFunction('create_certificate_simple', params, token);
        },

        updateCertificate: async function (certificateId, certificateData, token = null) {
            const params = {
                p_certificate_id: certificateId,
                p_farm_id: certificateData.farm_id || null,
                p_certificate_type: certificateData.certificate_type || null,
                p_certificate_number: certificateData.certificate_number || null,
                p_issued_date: certificateData.issued_date || null,
                p_expiry_date: certificateData.expiry_date || null,
                p_issuing_authority: certificateData.issuing_authority || null,
                p_status: certificateData.status || null
            };
            return await this.callFunction('update_certificate_simple', params, token);
        },

        deleteCertificate: async function (certificateId, token = null) {
            return await this.callFunction('delete_certificate_hard', { p_certificate_id: certificateId }, token);
        },

        getAudits: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_audit_type: filters.auditType || null,
                p_status: filters.status || null,
                p_start_date: filters.startDate || null,
                p_end_date: filters.endDate || null
            };
            return await this.callFunction('get_audits', params, token);
        },

        createAudit: async function (auditData, token = null) {
            const params = {
                p_farm_id: auditData.farm_id,
                p_audit_type: auditData.audit_type,
                p_audit_date: auditData.audit_date,
                p_auditor_name: auditData.auditor_name || null,
                p_score: auditData.score !== undefined ? auditData.score : null,
                p_status: auditData.status || 'scheduled',
                p_findings: auditData.findings || null,
                p_recommendations: auditData.recommendations || null
            };
            return await this.callFunction('create_audit_simple', params, token);
        },

        updateAudit: async function (auditId, auditData, token = null) {
            const params = {
                p_audit_id: auditId,
                p_farm_id: auditData.farm_id || null,
                p_audit_type: auditData.audit_type || null,
                p_audit_date: auditData.audit_date || null,
                p_auditor_name: auditData.auditor_name || null,
                p_score: auditData.score !== undefined ? auditData.score : null,
                p_status: auditData.status || null,
                p_findings: auditData.findings || null,
                p_recommendations: auditData.recommendations || null
            };
            return await this.callFunction('update_audit_simple', params, token);
        },

        deleteAudit: async function (auditId, token = null) {
            return await this.callFunction('delete_audit_hard', { p_audit_id: auditId }, token);
        },

        // ===== POLICIES & PROCEDURES FUNCTIONS =====

        getPolicies: async function (filters = {}, token = null) {
            const params = {
                p_farm_id: filters.farmId || null,
                p_status: filters.status || null,
                p_category: filters.category || null,
                p_search_term: filters.search || null
            };
            return await this.callFunction('get_policies', params, token);
        },

        createPolicy: async function (policyData, token = null) {
            const params = {
                p_farm_id: policyData.farm_id,
                p_title: policyData.title,
                p_policy_number: policyData.policy_number || null,
                p_version: policyData.version || null,
                p_category: policyData.category || null,
                p_description: policyData.description || null,
                p_file_url: policyData.file_url || null,
                p_effective_date: policyData.effective_date || null,
                p_review_date: policyData.review_date || null,
                p_review_frequency_months: policyData.review_frequency_months || null,
                p_status: policyData.status || null
            };
            return await this.callFunction('create_policy_simple', params, token);
        },

        updatePolicy: async function (policyId, policyData, token = null) {
            const params = {
                p_policy_id: policyId,
                p_farm_id: policyData.farm_id || null,
                p_title: policyData.title || null,
                p_policy_number: policyData.policy_number || null,
                p_version: policyData.version || null,
                p_category: policyData.category || null,
                p_description: policyData.description || null,
                p_file_url: policyData.file_url || null,
                p_effective_date: policyData.effective_date || null,
                p_review_date: policyData.review_date || null,
                p_review_frequency_months: policyData.review_frequency_months !== undefined ? policyData.review_frequency_months : null,
                p_status: policyData.status || null,
                p_is_active: policyData.is_active !== undefined ? policyData.is_active : null
            };
            return await this.callFunction('update_policy_simple', params, token);
        },

        deletePolicy: async function (policyId, token = null) {
            return await this.callFunction('delete_policy_hard', { p_policy_id: policyId }, token);
        },

        // ===== ADMINISTRATION FUNCTIONS (Additional) =====

        updateBlock: async function (blockId, blockData, token = null) {
            const params = {
                p_block_id: blockId,
                p_farm_id: blockData.farm_id || null,
                p_name: blockData.name || null,
                p_area_hectares: blockData.area_hectares !== undefined ? blockData.area_hectares : null,
                p_crop_type: blockData.crop_type || null,
                p_is_active: blockData.is_active !== undefined ? blockData.is_active : null
            };
            return await this.callFunction('update_block_simple', params, token);
        },

        deleteBlock: async function (blockId, token = null) {
            return await this.callFunction('deactivate_block', { p_block_id: blockId }, token);
        },

        updateVariety: async function (varietyId, varietyData, token = null) {
            const params = {
                p_variety_id: varietyId,
                p_name: varietyData.name || null,
                p_crop_type: varietyData.crop_type || null,
                p_season: varietyData.season || null,
                p_description: varietyData.description || null,
                p_is_active: varietyData.is_active !== undefined ? varietyData.is_active : null
            };
            return await this.callFunction('update_variety_simple', params, token);
        },

        deleteVariety: async function (varietyId, token = null) {
            return await this.callFunction('deactivate_variety', { p_variety_id: varietyId }, token);
        },

        deleteFarm: async function (farmId, token = null) {
            return await this.callFunction('deactivate_farm', { p_farm_id: farmId }, token);
        }
    }
}();

// Create global instance
const dataFunctions = _dataFunctions;

// Make it available globally
window.dataFunctions = dataFunctions;

// Auto-initialize
$(document).ready(function () {
    _dataFunctions.init();
});