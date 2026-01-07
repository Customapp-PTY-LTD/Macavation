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
            const params = {
                p_contact_type: contactData.contact_type,
                p_company_name: contactData.company_name,
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
                p_status: contactData.status || 'active',
                p_key_account: contactData.key_account || false,
                p_notes: contactData.notes || null,
                p_rate_crude_kernel: contactData.rate_crude_kernel || null,
                p_rate_food_kernel: contactData.rate_food_kernel || null,
                p_rate_kernel_dust: contactData.rate_kernel_dust || null,
                p_rate_cracker_dust: contactData.rate_cracker_dust || null,
                p_rate_crush: contactData.rate_crush || null
            };
            const result = await this.callFunction('create_contact_simple', params, token, { useCache: false });
            // Invalidate contacts cache
            this.clearCachePattern('contacts');
            return result;
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
        getProductionBatches: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_production_batches', {}, token, {
                cacheKey: 'production_batches_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
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