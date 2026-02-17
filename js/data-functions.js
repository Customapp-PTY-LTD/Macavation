/**
 * Data Functions Module
 * Handles all CRUD operations and data management functionality
 * Following WebPortals module pattern
 */

var _dataFunctions = function () {
    return {
        proxyUrl: 'https://rzrx6ntfejvb6lxpmt4ywruvt40mjjuo.lambda-url.af-south-1.on.aws/proxy/function',

        // Cache configuration
        cache: {
            // Cache storage
            data: new Map(),
            // Cache TTL in milliseconds (default: 5 minutes for static data, 1 minute for dynamic)
            ttl: {
                static: 5 * 60 * 1000,      // 5 minutes - users, roles, contacts list
                dynamic: 1 * 60 * 1000,    // 1 minute - batches, stock, alerts
                dashboard: 30 * 1000       // 30 seconds - dashboard data
            },
            // Pending requests to prevent duplicate calls
            pendingRequests: new Map()
        },

        init: function () {
            // Clear expired cache entries periodically
            setInterval(() => {
                this.clearExpiredCache();
            }, 60000); // Check every minute
        },

        /**
         * Get cached data if valid, otherwise return null
         */
        getCached: function (key) {
            const cached = this.cache.data.get(key);
            if (!cached) return null;

            const now = Date.now();
            if (now > cached.expiresAt) {
                this.cache.data.delete(key);
                return null;
            }

            return cached.data;
        },

        /**
         * Set cache with TTL
         */
        setCache: function (key, data, ttl = null) {
            const defaultTtl = ttl || this.cache.ttl.dynamic;
            const expiresAt = Date.now() + defaultTtl;

            this.cache.data.set(key, {
                data: data,
                expiresAt: expiresAt,
                cachedAt: Date.now()
            });
        },

        /**
         * Clear specific cache entry
         */
        clearCache: function (key) {
            this.cache.data.delete(key);
        },

        /**
         * Clear all cache entries matching a pattern
         */
        clearCachePattern: function (pattern) {
            for (const key of this.cache.data.keys()) {
                if (key.includes(pattern)) {
                    this.cache.data.delete(key);
                }
            }
        },

        /**
         * Clear all expired cache entries
         */
        clearExpiredCache: function () {
            const now = Date.now();
            for (const [key, cached] of this.cache.data.entries()) {
                if (now > cached.expiresAt) {
                    this.cache.data.delete(key);
                }
            }
        },

        /**
         * Clear all cache
         */
        clearAllCache: function () {
            this.cache.data.clear();
        },

        /**
         * Get cache statistics
         */
        getCacheStats: function () {
            const now = Date.now();
            let valid = 0;
            let expired = 0;

            for (const cached of this.cache.data.values()) {
                if (now > cached.expiresAt) {
                    expired++;
                } else {
                    valid++;
                }
            }

            return {
                total: this.cache.data.size,
                valid: valid,
                expired: expired,
                pendingRequests: this.cache.pendingRequests.size
            };
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
         * Check if user can access test management (test scenarios and test data)
         * Only Super Admin should have access
         */
        canAccessTestManagement: function () {
            const userInfo = localStorage.getItem('user_info');
            if (!userInfo) return false;

            const user = JSON.parse(userInfo);
            const roleName = user.role_name || user.role || '';

            // Only Super Admin has access to test management
            return roleName.toLowerCase() === 'super admin' ||
                roleName.toLowerCase() === 'super_user' ||
                roleName.toLowerCase().includes('super admin');
        },

        /**
         * Debug function to show current user info
         */
        debugUserInfo: function () {
            const authStatus = this.getAuthStatus();
            return authStatus;
        },

        /**
         * Generic function call to Lambda proxy with caching, request deduplication, and offline support
         */
        callFunction: async function (functionName, params = {}, token = null, options = {}) {
            const authToken = token || this.getToken();

            if (!authToken) {
                throw new Error('No authentication token available. Please sign in again.');
            }

            // Check if caching is enabled and if we have cached data
            const cacheKey = options.cacheKey || `${functionName}_${JSON.stringify(params)}`;
            const useCache = options.useCache !== false; // Default to true
            const cacheTtl = options.cacheTtl || this.cache.ttl.dynamic;
            const forceRefresh = options.forceRefresh === true;
            const isOfflineOperation = options.offlineOperation !== false; // Default to true - allow offline queuing

            // Check if we're offline
            const isOffline = !navigator.onLine;

            // Return cached data if available and not forcing refresh (for GET operations)
            if (useCache && !forceRefresh && !isOffline) {
                const cached = this.getCached(cacheKey);
                if (cached !== null) {
                    console.log(`[Cache Hit] ${functionName}`);
                    return cached;
                }
            }

            // If offline and this is a write operation (create/update/delete), queue it
            if (isOffline && isOfflineOperation) {
                const isWriteOperation = functionName.includes('create') || 
                                       functionName.includes('update') || 
                                       functionName.includes('delete') ||
                                       functionName.includes('deactivate');

                if (isWriteOperation) {
                    console.log(`[Offline] Queuing request: ${functionName}`);
                    
                    // Queue the request for later sync
                    if (typeof offlineStorage !== 'undefined') {
                        try {
                            await offlineStorage.queueRequest({
                                functionName: functionName,
                                params: params,
                                module: options.module || this.detectModuleFromFunction(functionName)
                            });

                            // Return success response indicating it was queued
                            return {
                                success: true,
                                offline: true,
                                queued: true,
                                message: 'Request queued for sync when online'
                            };
                        } catch (error) {
                            console.error('[Offline] Failed to queue request:', error);
                            // Fall through to try network anyway
                        }
                    } else {
                        // Offline storage not available, return queued response
                        return {
                            success: true,
                            offline: true,
                            queued: true,
                            message: 'Request queued for sync when online'
                        };
                    }
                } else {
                    // For read operations when offline, try to return cached data
                    const cached = this.getCached(cacheKey);
                    if (cached !== null) {
                        console.log(`[Offline Cache Hit] ${functionName}`);
                        return {
                            ...cached,
                            offline: true,
                            cached: true
                        };
                    }
                    
                    // No cached data available
                    throw new Error('No internet connection and no cached data available');
                }
            }

            // Check for pending request to prevent duplicate calls
            const requestKey = `${functionName}_${JSON.stringify(params)}`;
            if (this.cache.pendingRequests.has(requestKey)) {
                console.log(`[Dedupe] Waiting for pending request: ${functionName}`);
                return await this.cache.pendingRequests.get(requestKey);
            }

            // Create promise for this request
            const requestPromise = (async () => {
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
                                errorMessage = responseText || response.statusText || errorMessage;
                            }
                        } catch (e) {
                            errorMessage = response.statusText || errorMessage;
                        }
                        
                        if (response.status === 401) {
                            const finalMessage = errorMessage || 'Invalid or expired token';
                            // Clear authentication data
                            localStorage.removeItem('lambda_token');
                            localStorage.removeItem('user_info');
                            localStorage.removeItem('client_guid');
                            // Redirect to login page after a short delay to show message
                            setTimeout(() => {
                                window.location.href = 'signin.html';
                            }, 1000);
                            // Don't throw for 401 - let caller handle gracefully
                            const error = new Error(finalMessage);
                            error.status = 401;
                            throw error;
                        }
                        
                        // Create error with status code for proper error handling
                        const error = new Error(errorMessage);
                        error.status = response.status;
                        throw error;
                    }

                    const responseText = await response.text();
                    let data;
                    try {
                        data = JSON.parse(responseText);
                    } catch (e) {
                        throw new Error(`Invalid JSON response from server: ${responseText.substring(0, 200)}`);
                    }

                    // Cache successful responses
                    if (useCache && data && !data.error) {
                        this.setCache(cacheKey, data, cacheTtl);
                        console.log(`[Cache Set] ${functionName} (TTL: ${cacheTtl}ms)`);
                    }

                    return data;
                } catch (error) {
                    // If network error and offline, try to queue if it's a write operation
                    if (isOffline && isOfflineOperation && error.message.includes('Failed to fetch')) {
                        const isWriteOperation = functionName.includes('create') || 
                                               functionName.includes('update') || 
                                               functionName.includes('delete') ||
                                               functionName.includes('deactivate');

                        if (isWriteOperation && typeof offlineStorage !== 'undefined') {
                            try {
                                await offlineStorage.queueRequest({
                                    functionName: functionName,
                                    params: params,
                                    module: options.module || this.detectModuleFromFunction(functionName)
                                });

                                return {
                                    success: true,
                                    offline: true,
                                    queued: true,
                                    message: 'Request queued for sync when online'
                                };
                            } catch (queueError) {
                                console.error('[Offline] Failed to queue request:', queueError);
                            }
                        }
                    }
                    throw error;
                } finally {
                    // Remove from pending requests
                    this.cache.pendingRequests.delete(requestKey);
                }
            })();

            // Store pending request
            this.cache.pendingRequests.set(requestKey, requestPromise);
            return requestPromise;
        },

        /**
         * Detect module name from function name
         */
        detectModuleFromFunction: function (functionName) {
            if (functionName.includes('user')) return 'users';
            if (functionName.includes('role')) return 'roles';
            if (functionName.includes('contact')) return 'crm';
            if (functionName.includes('sample') || functionName.includes('grower')) return 'grower-intake';
            if (functionName.includes('production') || functionName.includes('batch')) return 'kernel-production';
            if (functionName.includes('quality') || functionName.includes('test')) return 'quality-assurance';
            if (functionName.includes('stock') || functionName.includes('item')) return 'stock-management';
            if (functionName.includes('oil')) return 'oil-production';
            if (functionName.includes('sales') || functionName.includes('forecast')) return 'sales-forecasting';
            if (functionName.includes('financial') || functionName.includes('transaction')) return 'financial-management';
            if (functionName.includes('document')) return 'document-management';
            return 'unknown';
        },

        // ===== USER MANAGEMENT FUNCTIONS =====

        /**
         * Get all users (cached for 5 minutes)
         */
        getUsers: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_users', {}, token, {
                cacheKey: 'users_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get user by ID (cached for 5 minutes)
         */
        getUserById: async function (userId, token = null, forceRefresh = false) {
            return await this.callFunction('get_user_by_id', { p_id: userId }, token, {
                cacheKey: `user_${userId}`,
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Create user (invalidates users cache)
         */
        createUser: async function (userData, token = null) {
            const params = {
                p_email: userData.email,
                p_username: userData.username || null,
                p_role_id: userData.role_id || null,
                p_password: userData.password || null
            };
            const result = await this.callFunction('create_user_simple', params, token, { useCache: false });
            // Invalidate users cache
            this.clearCachePattern('users');
            return result;
        },

        /**
         * Update user (invalidates user cache)
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

            const result = await this.callFunction('update_user_simple', params, token, { useCache: false });
            // Invalidate user caches
            this.clearCache(`user_${userId}`);
            this.clearCachePattern('users');
            return result;
        },

        /**
         * Delete user (hard delete, invalidates cache)
         */
        deleteUser: async function (userId, token = null) {
            const result = await this.callFunction('delete_user_hard', { p_user_id: userId }, token, { useCache: false });
            this.clearCache(`user_${userId}`);
            this.clearCachePattern('users');
            return result;
        },

        /**
         * Deactivate user (soft delete, invalidates cache)
         */
        deactivateUser: async function (userId, token = null) {
            const result = await this.callFunction('deactivate_user', { p_user_id: userId }, token, { useCache: false });
            this.clearCache(`user_${userId}`);
            this.clearCachePattern('users');
            return result;
        },

        // ===== ROLE MANAGEMENT FUNCTIONS =====

        /**
         * Get all roles (cached for 5 minutes)
         */
        getRoles: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_roles', {}, token, {
                cacheKey: 'roles_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get role by ID
         */
        getRoleById: async function (roleId, token = null) {
            return await this.callFunction('get_role_by_id', { p_id: roleId }, token);
        },

        /**
         * Create role (invalidates roles cache)
         */
        createRole: async function (roleData, token = null) {
            const params = {
                p_role_name: roleData.role_name,
                p_description: roleData.description || null,
                p_is_active: roleData.is_active !== undefined ? roleData.is_active : true
            };
            const result = await this.callFunction('create_role_simple', params, token, { useCache: false });
            this.clearCachePattern('roles');
            return result;
        },

        /**
         * Update role (invalidates roles cache)
         */
        updateRole: async function (roleId, roleData, token = null) {
            const params = {
                p_role_id: roleId,
                p_role_name: roleData.role_name || null,
                p_description: roleData.description || null,
                p_is_active: roleData.is_active !== undefined ? roleData.is_active : null
            };
            const result = await this.callFunction('update_role_simple', params, token, { useCache: false });
            this.clearCachePattern('roles');
            return result;
        },

        /**
         * Deactivate role (soft delete, invalidates cache)
         */
        deactivateRole: async function (roleId, token = null) {
            const result = await this.callFunction('deactivate_role', { p_id: roleId }, token, { useCache: false });
            this.clearCachePattern('roles');
            return result;
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

        // ===== FARM MANAGEMENT FUNCTIONS REMOVED =====
        // All farm management functionality has been removed as it's not part of Macadamia Management System

        // ===== WORKER/LABOUR MANAGEMENT FUNCTIONS REMOVED =====
        // All worker and labour management functionality has been removed as it's not part of Macadamia Management System

        // ===== LABOUR TRANSFER FUNCTIONS REMOVED =====
        // All labour/worker management functionality has been removed as it's not part of Macadamia Management System

        // ===== DASHBOARD FUNCTIONS =====

        getDashboardStats: async function (token = null) {
            return await this.callFunction('get_dashboard_stats', {}, token);
        },

        getDashboardAlerts: async function (token = null) {
            return await this.callFunction('get_dashboard_alerts', {}, token);
        },

        getRecentActivity: async function (limit = 10, token = null) {
            const params = {
                p_limit: limit
            };
            return await this.callFunction('get_recent_activity', params, token);
        },

        // ===== CHEMICAL MANAGEMENT FUNCTIONS REMOVED =====
        // All chemical management functionality has been removed as it's not part of Macadamia Management System

        // ===== FARM MANAGEMENT FUNCTIONS REMOVED =====
        // All farm management functionality (chemicals, crops, assets, water, post-harvest, compliance, policies, blocks, varieties)
        // has been removed as it's not part of Macadamia Management System

        // CRM Functions
        getContacts: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_contacts', {}, token, {
                cacheKey: 'contacts_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        getContactById: async function (contactId, token = null, forceRefresh = false) {
            return await this.callFunction('get_contact_by_id', { p_id: contactId }, token, {
                cacheKey: `contact_${contactId}`,
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        createContact: async function (contactData, token = null) {
            // Try using importTableRows as a workaround since the function signature doesn't match
            // This bypasses the Lambda proxy's schema cache issue
            console.log('[Data Functions] createContact - attempting direct table insert via importTableRows');
            
            try {
                // Map contactData to table row format
                const contactRow = {
                    contact_type: contactData.contact_type || contactData.p_contact_type,
                    company_name: contactData.company_name || contactData.p_company_name,
                    trading_name: contactData.trading_name || contactData.p_trading_name || null,
                    primary_contact_name: contactData.primary_contact_name || contactData.p_primary_contact_name || null,
                    primary_contact_email: contactData.primary_contact_email || contactData.p_primary_contact_email || null,
                    primary_contact_phone: contactData.primary_contact_phone || contactData.p_primary_contact_phone || null,
                    primary_contact_mobile: contactData.primary_contact_mobile || contactData.p_primary_contact_mobile || null,
                    secondary_contact_name: contactData.secondary_contact_name || contactData.p_secondary_contact_name || null,
                    secondary_contact_phone: contactData.secondary_contact_phone || contactData.p_secondary_contact_phone || null,
                    secondary_contact_mobile: contactData.secondary_contact_mobile || contactData.p_secondary_contact_mobile || null,
                    secondary_contact_email: contactData.secondary_contact_email || contactData.p_secondary_contact_email || null,
                    preferred_styles: contactData.preferred_styles || contactData.p_preferred_styles || null,
                    physical_area: contactData.physical_area || contactData.p_physical_area || null,
                    physical_city: contactData.physical_city || contactData.p_physical_city || null,
                    physical_province: contactData.physical_province || contactData.p_physical_province || null,
                    physical_postal_code: contactData.physical_postal_code || contactData.p_physical_postal_code || null,
                    account_manager_id: contactData.account_manager_id || contactData.p_account_manager_id || null,
                    status: contactData.status || contactData.p_status || 'active',
                    key_account: contactData.key_account !== undefined ? contactData.key_account : (contactData.p_key_account !== undefined ? contactData.p_key_account : false),
                    notes: contactData.notes || contactData.p_notes || null,
                    rate_crude_kernel: contactData.rate_crude_kernel !== undefined ? contactData.rate_crude_kernel : (contactData.p_rate_crude_kernel !== undefined ? contactData.p_rate_crude_kernel : null),
                    rate_food_kernel: contactData.rate_food_kernel !== undefined ? contactData.rate_food_kernel : (contactData.p_rate_food_kernel !== undefined ? contactData.p_rate_food_kernel : null),
                    rate_kernel_dust: contactData.rate_kernel_dust !== undefined ? contactData.rate_kernel_dust : (contactData.p_rate_kernel_dust !== undefined ? contactData.p_rate_kernel_dust : null),
                    rate_cracker_dust: contactData.rate_cracker_dust !== undefined ? contactData.rate_cracker_dust : (contactData.p_rate_cracker_dust !== undefined ? contactData.p_rate_cracker_dust : null),
                    rate_crush: contactData.rate_crush !== undefined ? contactData.rate_crush : (contactData.p_rate_crush !== undefined ? contactData.p_rate_crush : null)
                };
                
                console.log('[Data Functions] Using importTableRows workaround with row:', contactRow);
                
                const result = await this.importTableRows('contacts', [contactRow], token);
                
                if (result && result.success !== false) {
                    console.log('[Data Functions] createContact via importTableRows - SUCCESS:', result);
                    // Invalidate contacts cache
                    this.clearCachePattern('contacts');
                    return {
                        success: true,
                        id: result.id || result.inserted_ids?.[0] || null,
                        message: 'Contact created successfully'
                    };
                } else {
                    throw new Error(result?.error || result?.message || 'Failed to create contact');
                }
            } catch (importError) {
                console.warn('[Data Functions] importTableRows failed, trying function call:', importError);
                
                // Fallback to function call with all parameters
                const params = {
                    p_company_name: contactData.company_name || contactData.p_company_name || '',
                    p_contact_type: contactData.contact_type || contactData.p_contact_type || '',
                    p_account_manager_id: contactData.account_manager_id || contactData.p_account_manager_id || null,
                    p_key_account: contactData.key_account !== undefined ? contactData.key_account : (contactData.p_key_account !== undefined ? contactData.p_key_account : false),
                    p_notes: contactData.notes || contactData.p_notes || null,
                    p_physical_area: contactData.physical_area || contactData.p_physical_area || null,
                    p_physical_city: contactData.physical_city || contactData.p_physical_city || null,
                    p_physical_postal_code: contactData.physical_postal_code || contactData.p_physical_postal_code || null,
                    p_physical_province: contactData.physical_province || contactData.p_physical_province || null,
                    p_preferred_styles: contactData.preferred_styles || contactData.p_preferred_styles || null,
                    p_primary_contact_email: contactData.primary_contact_email || contactData.p_primary_contact_email || null,
                    p_primary_contact_mobile: contactData.primary_contact_mobile || contactData.p_primary_contact_mobile || null,
                    p_primary_contact_name: contactData.primary_contact_name || contactData.p_primary_contact_name || null,
                    p_primary_contact_phone: contactData.primary_contact_phone || contactData.p_primary_contact_phone || null,
                    p_rate_cracker_dust: contactData.rate_cracker_dust !== undefined ? contactData.rate_cracker_dust : (contactData.p_rate_cracker_dust !== undefined ? contactData.p_rate_cracker_dust : null),
                    p_rate_crude_kernel: contactData.rate_crude_kernel !== undefined ? contactData.rate_crude_kernel : (contactData.p_rate_crude_kernel !== undefined ? contactData.p_rate_crude_kernel : null),
                    p_rate_crush: contactData.rate_crush !== undefined ? contactData.rate_crush : (contactData.p_rate_crush !== undefined ? contactData.p_rate_crush : null),
                    p_rate_food_kernel: contactData.rate_food_kernel !== undefined ? contactData.rate_food_kernel : (contactData.p_rate_food_kernel !== undefined ? contactData.p_rate_food_kernel : null),
                    p_rate_kernel_dust: contactData.rate_kernel_dust !== undefined ? contactData.rate_kernel_dust : (contactData.p_rate_kernel_dust !== undefined ? contactData.p_rate_kernel_dust : null),
                    p_secondary_contact_email: contactData.secondary_contact_email || contactData.p_secondary_contact_email || null,
                    p_secondary_contact_mobile: contactData.secondary_contact_mobile || contactData.p_secondary_contact_mobile || null,
                    p_secondary_contact_name: contactData.secondary_contact_name || contactData.p_secondary_contact_name || null,
                    p_secondary_contact_phone: contactData.secondary_contact_phone || contactData.p_secondary_contact_phone || null,
                    p_status: contactData.status || contactData.p_status || 'active',
                    p_trading_name: contactData.trading_name || contactData.p_trading_name || null
                };
                
                console.log('[Data Functions] Fallback: trying function call with params:', JSON.stringify(params, null, 2));
                const result = await this.callFunction('create_contact_simple', params, token, { useCache: false });
                console.log('[Data Functions] createContact result:', result);
                // Invalidate contacts cache
                this.clearCachePattern('contacts');
                return result;
            }
        },

        updateContact: async function (contactId, contactData, token = null) {
            const params = {
                p_contact_id: contactId,
                p_contact_type: contactData.contact_type || null,
                p_company_name: contactData.company_name || null,
                p_trading_name: contactData.trading_name || null,
                p_primary_contact_name: contactData.primary_contact_name || null,
                p_primary_contact_email: contactData.primary_contact_email || null,
                p_primary_contact_phone: contactData.primary_contact_phone || null,
                p_primary_contact_mobile: contactData.primary_contact_mobile || null,
                p_secondary_contact_name: contactData.secondary_contact_name || null,
                p_secondary_contact_mobile: contactData.secondary_contact_mobile || null,
                p_secondary_contact_email: contactData.secondary_contact_email || null,
                p_physical_area: contactData.physical_area || null,
                p_physical_city: contactData.physical_city || null,
                p_physical_province: contactData.physical_province || null,
                p_physical_postal_code: contactData.physical_postal_code || null,
                p_account_manager_id: contactData.account_manager_id || null,
                p_status: contactData.status || null,
                p_key_account: contactData.key_account !== undefined ? contactData.key_account : null,
                p_notes: contactData.notes || null,
                p_rate_crude_kernel: contactData.rate_crude_kernel !== undefined ? contactData.rate_crude_kernel : null,
                p_rate_food_kernel: contactData.rate_food_kernel !== undefined ? contactData.rate_food_kernel : null,
                p_rate_kernel_dust: contactData.rate_kernel_dust !== undefined ? contactData.rate_kernel_dust : null,
                p_rate_cracker_dust: contactData.rate_cracker_dust !== undefined ? contactData.rate_cracker_dust : null,
                p_rate_crush: contactData.rate_crush !== undefined ? contactData.rate_crush : null
            };
            const result = await this.callFunction('update_contact_simple', params, token, { useCache: false });
            // Invalidate contact caches
            this.clearCache(`contact_${contactId}`);
            this.clearCachePattern('contacts');
            return result;
        },

        deleteContact: async function (contactId, token = null) {
            const result = await this.callFunction('deactivate_contact', { p_contact_id: contactId }, token, { useCache: false });
            this.clearCache(`contact_${contactId}`);
            this.clearCachePattern('contacts');
            return result;
        },

        // Production Functions (cached for 1 minute - dynamic data)
        // Pass explicit params for the parameterized overload to avoid Postgres ambiguity with get_production_batches() vs get_production_batches(p_batch_type, p_status, p_limit, p_offset)
        getProductionBatches: async function (token = null, forceRefresh = false, options = {}) {
            const params = {
                p_batch_type: options.batch_type != null ? options.batch_type : null,
                p_status: options.status != null ? options.status : null,
                p_limit: options.limit != null ? options.limit : null,
                p_offset: options.offset != null ? options.offset : null
            };
            const cacheKey = 'production_batches_list' + (params.p_batch_type ? '_' + params.p_batch_type : '');
            const raw = await this.callFunction('get_production_batches', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            // Normalize: Lambda/Postgres may return array or { data: [] } or { get_production_batches: [] }
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && Array.isArray(raw.get_production_batches)) return raw.get_production_batches;
            return [];
        },
        
        /**
         * Create production batch (invalidates batches cache)
         */
        createProductionBatch: async function (batchData, token = null) {
            const result = await this.callFunction('create_production_batch_simple', batchData, token, { useCache: false });
            // Invalidate production batches cache
            this.clearCachePattern('production_batches');
            return result;
        },

        getSampleSubmissions: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_sample_submissions', {}, token, {
                cacheKey: 'sample_submissions_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },

        // Quality Assurance Functions (cached for 1 minute)
        getQualityTests: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_quality_tests', {}, token, {
                cacheKey: 'quality_tests_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },
        
        /**
         * Get quality test by ID
         */
        getQualityTestById: async function (testId, token = null) {
            return await this.callFunction('get_quality_test_by_id', { p_id: testId }, token);
        },
        
        /**
         * Create quality test (invalidates quality tests cache)
         */
        createQualityTest: async function (testData, token = null) {
            const result = await this.callFunction('create_quality_test_simple', testData, token, { useCache: false });
            // Invalidate quality tests cache
            this.clearCachePattern('quality_tests');
            return result;
        },
        
        /**
         * Update quality test (invalidates quality tests cache)
         */
        updateQualityTest: async function (testId, testData, token = null) {
            const result = await this.callFunction('update_quality_test_simple', {
                p_test_id: testId,
                ...testData
            }, token, { useCache: false });
            // Invalidate quality tests cache
            this.clearCachePattern('quality_tests');
            return result;
        },

        // Stock Management Functions (cached for 1 minute)
        getStockItems: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_stock_items', {}, token, {
                cacheKey: 'stock_items_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Oil Stock Lots / Ledger (cached for 1 minute)
         */
        getOilStockLots: async function (filters = {}, token = null, forceRefresh = false) {
            const params = {
                p_location_code: filters.location_code || null,
                p_stock_category: filters.stock_category || null,
                p_status: filters.status || null,
                p_search: filters.search || null,
                p_offset: filters.offset || 0,
                p_limit: filters.limit || 200
            };

            return await this.callFunction('get_oil_stock_lots', params, token, {
                cacheKey: `oil_stock_lots_${params.p_location_code || 'all'}_${params.p_stock_category || 'all'}_${params.p_status || 'all'}_${params.p_search || ''}_${params.p_offset}_${params.p_limit}`,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },

        getOilStockSummary: async function (filters = {}, token = null, forceRefresh = false) {
            const params = {
                p_location_code: filters.location_code || null,
                p_stock_category: filters.stock_category || null,
                p_status: filters.status !== undefined ? filters.status : 'on_hand'
            };

            return await this.callFunction('get_oil_stock_summary', params, token, {
                cacheKey: `oil_stock_summary_${params.p_location_code || 'all'}_${params.p_stock_category || 'all'}_${params.p_status || 'all'}`,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },

        createOilStockLot: async function (lotData, token = null) {
            const result = await this.callFunction('create_oil_stock_lot_simple', lotData, token, { useCache: false });
            this.clearCachePattern('oil_stock_lots');
            this.clearCachePattern('oil_stock_summary');
            return result;
        },

        updateOilStockLot: async function (lotId, lotData, token = null) {
            const params = { p_id: lotId, ...lotData };
            const result = await this.callFunction('update_oil_stock_lot_simple', params, token, { useCache: false });
            this.clearCachePattern('oil_stock_lots');
            this.clearCachePattern('oil_stock_summary');
            return result;
        },

        deactivateOilStockLot: async function (lotId, token = null) {
            const result = await this.callFunction('deactivate_oil_stock_lot', { p_id: lotId }, token, { useCache: false });
            this.clearCachePattern('oil_stock_lots');
            this.clearCachePattern('oil_stock_summary');
            return result;
        },

        // Dashboard Functions (cached for 30 seconds - near real-time)
        getDashboardAlerts: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_dashboard_alerts', {}, token, {
                cacheKey: 'dashboard_alerts_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dashboard,
                forceRefresh: forceRefresh
            });
        },

        getExecutiveKPIs: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_executive_kpis', {}, token, {
                cacheKey: 'executive_kpis',
                useCache: true,
                cacheTtl: this.cache.ttl.dashboard,
                forceRefresh: forceRefresh
            });
        },

        // Sales Forecasting Functions (placeholder)
        getSalesForecasts: async function (token = null) {
            return await this.callFunction('get_sales_forecasts', {}, token).catch(() => []);
        },

        // Oil Production Functions (cached for 1 minute)
        getOilProductionSheets: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_oil_production_sheets', {}, token, {
                cacheKey: 'oil_production_sheets_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },
        
        // Legacy function name for backward compatibility
        getOilProductionBatches: async function (token = null) {
            return await this.getOilProductionSheets(token);
        },
        
        // Kernel Production Job Card Functions
        createKernelJobCard: async function (jobCardData, token = null) {
            const result = await this.callFunction('create_kernel_job_card', jobCardData, token, { useCache: false });
            // Invalidate stock cache
            this.clearCachePattern('stock_items');
            return result;
        },

        createKernelProductionDay: async function (batchId, token = null) {
            const result = await this.callFunction('create_kernel_production_day', { p_batch_id: batchId }, token, { useCache: false });
            this.clearCachePattern('kernel_production');
            return result;
        },

        getKernelProductionDays: async function (batchId, token = null) {
            const raw = await this.callFunction('get_kernel_production_days', { p_batch_id: batchId }, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && Array.isArray(raw.get_kernel_production_days)) return raw.get_kernel_production_days;
            return [];
        },

        getKernelProductionDaysList: async function (token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_kernel_production_days_list', {}, token, {
                cacheKey: 'kernel_production_days_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && Array.isArray(raw.get_kernel_production_days_list)) return raw.get_kernel_production_days_list;
            return [];
        },

        getKernelProductionStages: async function (stagesId, token = null) {
            return await this.callFunction('get_kernel_production_stages', { p_id: stagesId }, token, { useCache: false });
        },

        getKernelProductionStagesByDay: async function (dayId, token = null) {
            return await this.callFunction('get_kernel_production_stages_by_day', { p_day_id: dayId }, token, { useCache: false });
        },

        saveKernelProductionStages: async function (payload, token = null) {
            const result = await this.callFunction('save_kernel_production_stages', payload, token, { useCache: false });
            this.clearCachePattern('kernel_production');
            return result;
        },

        finishKernelBatchProduction: async function (batchId, token = null) {
            const result = await this.callFunction('finish_kernel_batch_production', { p_batch_id: batchId }, token, { useCache: false });
            this.clearCachePattern('kernel_production');
            this.clearCachePattern('production_batches');
            return result;
        },
        
        // Stock Take Functions
        createStockTake: async function (stockTakeData, token = null) {
            return await this.callFunction('create_stock_take', stockTakeData, token, { useCache: false });
        },
        
        getStockTakes: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_stock_takes', {}, token, {
                cacheKey: 'stock_takes_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },
        
        // Oil Production Weekly Summary
        getOilProductionWeeklySummary: async function (startDate, endDate, token = null) {
            return await this.callFunction('get_oil_production_weekly_summary', {
                p_start_date: startDate,
                p_end_date: endDate
            }, token, { useCache: false });
        },
        
        // Receiving Checklist Functions (cached for 1 minute)
        getReceivingChecklists: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_receiving_checklists', {}, token, {
                cacheKey: 'receiving_checklists_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },
        
        // Raw Material Issued Functions (cached for 1 minute)
        getRawMaterialIssued: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_raw_material_issued', {}, token, {
                cacheKey: 'raw_material_issued_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },

        // Financial Management Functions (placeholder)
        getFinancialTransactions: async function (token = null) {
            return await this.callFunction('get_financial_transactions', {}, token).catch(() => []);
        },

        // Document Management Functions (placeholder)
        getDocuments: async function (token = null) {
            return await this.callFunction('get_documents', {}, token).catch(() => []);
        },

        // Palladium Integration Functions (placeholder)
        getPalladiumSyncStatus: async function (token = null) {
            return await this.callFunction('get_palladium_sync_status', {}, token).catch(() => []);
        },

        syncPalladium: async function (token = null) {
            return await this.callFunction('sync_palladium', {}, token).catch(() => ({ success: false }));
        },

        syncPalladiumEntity: async function (entityType, token = null) {
            return await this.callFunction('sync_palladium_entity', { p_entity_type: entityType }, token).catch(() => ({ success: false }));
        },

        // ===== TEST SCENARIOS FUNCTIONS =====

        /**
         * Get all test scenarios (cached for 5 minutes)
         */
        getTestScenarios: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_test_scenarios', {}, token, {
                cacheKey: 'test_scenarios_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get test scenario by ID
         */
        getTestScenarioById: async function (scenarioId, token = null) {
            return await this.callFunction('get_test_scenario_by_id', { p_id: scenarioId }, token);
        },

        /**
         * Get test scenarios filtered by module, severity, etc.
         */
        getTestScenariosFiltered: async function (filters = {}, token = null) {
            const params = {
                p_module_name: filters.module_name || null,
                p_severity_level: filters.severity_level || null,
                p_test_type: filters.test_type || null,
                p_is_automated: filters.is_automated !== undefined ? filters.is_automated : null,
                p_search_term: filters.search_term || null
            };
            return await this.callFunction('get_test_scenarios_filtered', params, token);
        },

        // ===== TEST DATA SETS FUNCTIONS =====

        /**
         * Get all E2E test data sets (cached for 5 minutes)
         */
        getTestDataSets: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_e2e_test_data_sets', {}, token, {
                cacheKey: 'test_data_sets_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get all E2E test data records (cached for 5 minutes)
         */
        getTestDataRecords: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_e2e_test_data_records', {}, token, {
                cacheKey: 'test_data_records_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get test data records by set ID
         */
        getTestDataRecordsBySetId: async function (setId, token = null) {
            return await this.callFunction('get_e2e_test_data_records_by_set', { p_set_id: setId }, token);
        },

        // ===== TEST INSTANCES AND RUN BATCHES FUNCTIONS =====

        /**
         * Get test run batches (cached for 1 minute - dynamic data)
         */
        getTestRunBatches: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_test_run_batches', {}, token, {
                cacheKey: 'test_run_batches_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get test instances for a specific batch
         */
        getTestInstancesByBatchId: async function (batchId, token = null) {
            return await this.callFunction('get_test_instances_by_batch', { p_batch_id: batchId }, token);
        },

        /**
         * Get test instances for a specific scenario
         */
        getTestInstancesByScenarioId: async function (scenarioId, token = null) {
            return await this.callFunction('get_test_instances_by_scenario', { p_scenario_id: scenarioId }, token);
        },

        // ===== TEST SCENARIOS FUNCTIONS =====

        /**
         * Get all test scenarios (cached for 5 minutes - static data)
         */
        getTestScenarios: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_test_scenarios', {}, token, {
                cacheKey: 'test_scenarios_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get test scenario by ID
         */
        getTestScenarioById: async function (scenarioId, token = null) {
            return await this.callFunction('get_test_scenario_by_id', { p_id: scenarioId }, token);
        },

        /**
         * Create test scenario
         */
        createTestScenario: async function (scenarioData, token = null) {
            const params = {
                p_scenario_code: scenarioData.scenario_code,
                p_scenario_name: scenarioData.scenario_name,
                p_module_name: scenarioData.module_name,
                p_expected_result: scenarioData.expected_result,
                p_description: scenarioData.description || null,
                p_feature_name: scenarioData.feature_name || null,
                p_test_type: scenarioData.test_type || 'functional',
                p_role_id: scenarioData.role_id || null,
                p_feature_id: scenarioData.feature_id || null,
                p_preconditions: scenarioData.preconditions || null,
                p_test_steps: scenarioData.test_steps ? (typeof scenarioData.test_steps === 'string' ? scenarioData.test_steps : JSON.stringify(scenarioData.test_steps)) : '[]',
                p_test_data: scenarioData.test_data ? (typeof scenarioData.test_data === 'string' ? scenarioData.test_data : JSON.stringify(scenarioData.test_data)) : '{}',
                p_test_data_description: scenarioData.test_data_description || null,
                p_severity_level: scenarioData.severity_level || 'medium',
                p_severity_description: scenarioData.severity_description || null,
                p_tags: scenarioData.tags ? JSON.stringify(scenarioData.tags) : '[]',
                p_depends_on: scenarioData.depends_on || null,
                p_is_automated: scenarioData.is_automated !== undefined ? scenarioData.is_automated : false,
                p_automation_script_path: scenarioData.automation_script_path || null,
                p_created_by: scenarioData.created_by || null
            };
            const result = await this.callFunction('create_test_scenario_simple', params, token, { useCache: false });
            this.clearCachePattern('test_scenarios');
            return result;
        },

        /**
         * Update test scenario
         */
        updateTestScenario: async function (scenarioId, scenarioData, token = null) {
            const params = {
                p_scenario_id: scenarioId,
                p_scenario_code: scenarioData.scenario_code || null,
                p_scenario_name: scenarioData.scenario_name || null,
                p_description: scenarioData.description || null,
                p_module_name: scenarioData.module_name || null,
                p_feature_name: scenarioData.feature_name || null,
                p_test_type: scenarioData.test_type || null,
                p_role_id: scenarioData.role_id || null,
                p_feature_id: scenarioData.feature_id || null,
                p_preconditions: scenarioData.preconditions || null,
                p_test_steps: scenarioData.test_steps ? (typeof scenarioData.test_steps === 'string' ? scenarioData.test_steps : JSON.stringify(scenarioData.test_steps)) : null,
                p_expected_result: scenarioData.expected_result || null,
                p_test_data: scenarioData.test_data ? (typeof scenarioData.test_data === 'string' ? scenarioData.test_data : JSON.stringify(scenarioData.test_data)) : null,
                p_test_data_description: scenarioData.test_data_description || null,
                p_severity_level: scenarioData.severity_level || null,
                p_severity_description: scenarioData.severity_description || null,
                p_tags: scenarioData.tags ? (typeof scenarioData.tags === 'string' ? scenarioData.tags : JSON.stringify(scenarioData.tags)) : null,
                p_depends_on: scenarioData.depends_on || null,
                p_is_automated: scenarioData.is_automated !== undefined ? scenarioData.is_automated : null,
                p_automation_script_path: scenarioData.automation_script_path || null,
                p_is_active: scenarioData.is_active !== undefined ? scenarioData.is_active : null,
                p_is_deprecated: scenarioData.is_deprecated !== undefined ? scenarioData.is_deprecated : null,
                p_deprecated_reason: scenarioData.deprecated_reason || null,
                p_updated_by: scenarioData.updated_by || null
            };
            const result = await this.callFunction('update_test_scenario_simple', params, token, { useCache: false });
            this.clearCachePattern('test_scenarios');
            return result;
        },

        /**
         * Delete test scenario (hard delete)
         */
        deleteTestScenario: async function (scenarioId, token = null) {
            const result = await this.callFunction('delete_test_scenario_hard', { p_scenario_id: scenarioId }, token, { useCache: false });
            this.clearCachePattern('test_scenarios');
            return result;
        },

        /**
         * Deactivate test scenario (soft delete)
         */
        deactivateTestScenario: async function (scenarioId, updatedBy = null, token = null) {
            const result = await this.callFunction('deactivate_test_scenario', { 
                p_scenario_id: scenarioId,
                p_updated_by: updatedBy 
            }, token, { useCache: false });
            this.clearCachePattern('test_scenarios');
            return result;
        },

        /**
         * Search test scenarios with filters
         */
        searchTestScenarios: async function (filters = {}, token = null) {
            const params = {
                p_search_term: filters.searchTerm || null,
                p_module_name: filters.module_name || null,
                p_test_type: filters.test_type || null,
                p_severity_level: filters.severity_level || null,
                p_is_automated: filters.is_automated !== undefined ? filters.is_automated : null,
                p_role_id: filters.role_id || null
            };
            return await this.callFunction('search_test_scenarios', params, token, {
                cacheKey: `test_scenarios_search_${JSON.stringify(filters)}`,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic
            });
        },

        // ===== TEST DATA SETS FUNCTIONS =====

        /**
         * Get all test data sets (cached for 5 minutes - static data)
         */
        getTestDataSets: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_test_data_sets', {}, token, {
                cacheKey: 'test_data_sets_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get test data set by ID
         */
        getTestDataSetById: async function (setId, token = null) {
            return await this.callFunction('get_test_data_set_by_id', { p_id: setId }, token);
        },

        /**
         * Create test data set
         */
        createTestDataSet: async function (setData, token = null) {
            const params = {
                p_set_name: setData.set_name,
                p_module: setData.module,
                p_description: setData.description || null,
                p_test_scenario_ids: setData.test_scenario_ids || null,
                p_is_active: setData.is_active !== undefined ? setData.is_active : true
            };
            const result = await this.callFunction('create_test_data_set_simple', params, token, { useCache: false });
            this.clearCachePattern('test_data_sets');
            return result;
        },

        /**
         * Update test data set
         */
        updateTestDataSet: async function (setId, setData, token = null) {
            const params = {
                p_set_id: setId,
                p_set_name: setData.set_name || null,
                p_module: setData.module || null,
                p_description: setData.description || null,
                p_test_scenario_ids: setData.test_scenario_ids || null,
                p_is_active: setData.is_active !== undefined ? setData.is_active : null
            };
            const result = await this.callFunction('update_test_data_set_simple', params, token, { useCache: false });
            this.clearCachePattern('test_data_sets');
            return result;
        },

        /**
         * Delete test data set (hard delete)
         */
        deleteTestDataSet: async function (setId, token = null) {
            const result = await this.callFunction('delete_test_data_set_hard', { p_set_id: setId }, token, { useCache: false });
            this.clearCachePattern('test_data_sets');
            return result;
        },

        /**
         * Search test data sets with filters
         */
        searchTestDataSets: async function (filters = {}, token = null) {
            const params = {
                p_search_term: filters.searchTerm || null,
                p_module: filters.module || null,
                p_scenario_id: filters.scenario_id || null
            };
            return await this.callFunction('search_test_data_sets', params, token, {
                cacheKey: `test_data_sets_search_${JSON.stringify(filters)}`,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic
            });
        },

        // ===== TEST DATA RECORDS FUNCTIONS =====

        /**
         * Get test data records by set ID
         */
        getTestDataRecordsBySet: async function (setId, token = null) {
            return await this.callFunction('get_test_data_records_by_set', { p_set_id: setId }, token);
        },

        /**
         * Get test data record by ID
         */
        getTestDataRecordById: async function (recordId, token = null) {
            return await this.callFunction('get_test_data_record_by_id', { p_id: recordId }, token);
        },

        /**
         * Create test data record
         */
        createTestDataRecord: async function (recordData, token = null) {
            const params = {
                p_data_set_id: recordData.data_set_id,
                p_entity_type: recordData.entity_type,
                p_data_key: recordData.data_key,
                p_data_value: recordData.data_value ? (typeof recordData.data_value === 'string' ? recordData.data_value : JSON.stringify(recordData.data_value)) : '{}',
                p_entity_id: recordData.entity_id || null,
                p_purpose: recordData.purpose || null,
                p_cleanup_required: recordData.cleanup_required !== undefined ? recordData.cleanup_required : true
            };
            const result = await this.callFunction('create_test_data_record_simple', params, token, { useCache: false });
            this.clearCachePattern('test_data_records');
            return result;
        },

        /**
         * Update test data record
         */
        updateTestDataRecord: async function (recordId, recordData, token = null) {
            const params = {
                p_record_id: recordId,
                p_data_set_id: recordData.data_set_id || null,
                p_entity_type: recordData.entity_type || null,
                p_entity_id: recordData.entity_id || null,
                p_data_key: recordData.data_key || null,
                p_data_value: recordData.data_value ? (typeof recordData.data_value === 'string' ? recordData.data_value : JSON.stringify(recordData.data_value)) : null,
                p_purpose: recordData.purpose || null,
                p_cleanup_required: recordData.cleanup_required !== undefined ? recordData.cleanup_required : null
            };
            const result = await this.callFunction('update_test_data_record_simple', params, token, { useCache: false });
            this.clearCachePattern('test_data_records');
            return result;
        },

        /**
         * Delete test data record (hard delete)
         */
        deleteTestDataRecord: async function (recordId, token = null) {
            const result = await this.callFunction('delete_test_data_record_hard', { p_record_id: recordId }, token, { useCache: false });
            this.clearCachePattern('test_data_records');
            return result;
        },

        /**
         * Search test data records with filters
         */
        searchTestDataRecords: async function (filters = {}, token = null) {
            const params = {
                p_search_term: filters.searchTerm || null,
                p_data_set_id: filters.data_set_id || null,
                p_entity_type: filters.entity_type || null,
                p_purpose: filters.purpose || null
            };
            return await this.callFunction('search_test_data_records', params, token, {
                cacheKey: `test_data_records_search_${JSON.stringify(filters)}`,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic
            });
        },

        // ===== PROJECT DOCUMENTATION FUNCTIONS =====

        /**
         * Get all project documentation (cached for 5 minutes - static data)
         */
        getProjectDocumentation: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_project_documentation', {}, token, {
                cacheKey: 'project_documentation_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Get project documentation by ID
         */
        getProjectDocumentationById: async function (docId, token = null) {
            return await this.callFunction('get_project_documentation_by_id', { p_id: docId }, token);
        },

        /**
         * Create project documentation
         */
        createProjectDocumentation: async function (docData, token = null) {
            const params = {
                p_project_name: docData.project_name,
                p_document_type: docData.document_type,
                p_document_title: docData.document_title,
                p_document_slug: docData.document_slug,
                p_content: docData.content,
                p_version: docData.version || '1.0.0',
                p_tags: docData.tags ? (typeof docData.tags === 'string' ? docData.tags : JSON.stringify(docData.tags)) : '[]',
                p_metadata: docData.metadata ? (typeof docData.metadata === 'string' ? docData.metadata : JSON.stringify(docData.metadata)) : '{}',
                p_created_by: docData.created_by || null
            };
            const result = await this.callFunction('create_project_documentation', params, token, { useCache: false });
            this.clearCachePattern('project_documentation');
            return result;
        },

        /**
         * Update project documentation
         */
        updateProjectDocumentation: async function (docId, docData, token = null) {
            const params = {
                p_id: docId,
                p_project_name: docData.project_name || null,
                p_document_type: docData.document_type || null,
                p_document_title: docData.document_title || null,
                p_document_slug: docData.document_slug || null,
                p_content: docData.content || null,
                p_version: docData.version || null,
                p_tags: docData.tags ? (typeof docData.tags === 'string' ? docData.tags : JSON.stringify(docData.tags)) : null,
                p_metadata: docData.metadata ? (typeof docData.metadata === 'string' ? docData.metadata : JSON.stringify(docData.metadata)) : null,
                p_is_active: docData.is_active !== undefined ? docData.is_active : null,
                p_updated_by: docData.updated_by || null
            };
            const result = await this.callFunction('update_project_documentation', params, token, { useCache: false });
            this.clearCachePattern('project_documentation');
            return result;
        },

        /**
         * Delete project documentation (soft delete)
         */
        deleteProjectDocumentation: async function (docId, token = null) {
            const result = await this.callFunction('delete_project_documentation', { p_id: docId }, token, { useCache: false });
            this.clearCachePattern('project_documentation');
            return result;
        }
    }
}();

// Create global instance
const dataFunctions = _dataFunctions;

// Make it available globally
window.dataFunctions = dataFunctions;

// Extend dataFunctions with Data Import helpers (after initialization)
dataFunctions.getTableColumns = async function (tableName, token = null) {
    try {
        return await this.callFunction('get_table_columns', { p_table_name: tableName }, token);
    } catch (e) {
        console.error('[Data Import] getTableColumns error:', e);
        return [];
    }
};

dataFunctions.importTableRows = async function (tableName, rows, token = null) {
    try {
        const params = {
            p_table_name: tableName,
            p_rows: JSON.stringify(rows)
        };
        return await this.callFunction('import_table_rows', params, token, { useCache: false });
    } catch (e) {
        console.error('[Data Import] importTableRows error:', e);
        return { success: false, message: e.message };
    }
};

// Auto-initialize
$(document).ready(function () {
    _dataFunctions.init();
});