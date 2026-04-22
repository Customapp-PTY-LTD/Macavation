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
         * Update production batch status/step (move batch along journey)
         */
        updateProductionBatch: async function (batchId, params, token = null) {
            var payload = { p_batch_id: batchId };
            if (params.status !== undefined) payload.p_status = params.status;
            if (params.current_step !== undefined) payload.p_current_step = params.current_step;
            if (params.stage !== undefined) payload.p_stage = params.stage;
            if (params.receiving_checklist_id !== undefined && params.receiving_checklist_id !== null) payload.p_receiving_checklist_id = params.receiving_checklist_id;
            if (params.sample_submission_id !== undefined && params.sample_submission_id !== null) payload.p_sample_submission_id = params.sample_submission_id;
            var result = await this.callFunction('update_production_batch', payload, token, { useCache: false });
            this.clearCachePattern('production_batches');
            return result;
        },

        /**
         * Set actual wet NIS weight (sum of bag weights from receiving checklist) and store difference (supplied - actual).
         * @param {string} batchId - production batch id
         * @param {number|null} actualWetNisKg - sum of all Weight (Kgs) from receiving checklist bags
         * @param {string|null} token - auth token (optional)
         */
        updateProductionBatchActualWeight: async function (batchId, actualWetNisKg, token = null) {
            var result = await this.callFunction('update_production_batch_actual_weight', { p_batch_id: batchId, p_actual_wet_nis_kg: actualWetNisKg != null ? actualWetNisKg : null }, token, { useCache: false });
            this.clearCachePattern('production_batches');
            return result;
        },

        /**
         * Get current authentication token
         */
        getToken: function () {
            // First try to get from authService if available
            if (typeof authService !== 'undefined' && authService.token) {
                return authService.token;
            }
            // Fallback to Session
            return Session.get('token');
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
            const userInfo = Session.get('user');

            return {
                hasToken: !!token,
                tokenLength: token ? token.length : 0,
                hasUserInfo: !!userInfo,
                userInfo: userInfo,
                authServiceAvailable: typeof authService !== 'undefined'
            };
        },

        /**
         * Current user UUID for audit fields (created_by, updated_by). Returns null if not signed in.
         * Used by oil modules (Supplier Intake create/update/release, Oil Production upsert) so the DB records who did what; later admin can join to users for "who did what, when".
         */
        getCurrentUserId: function () {
            try {
                var user = typeof Session !== 'undefined' && Session.get ? Session.get('user') : null;
                if (!user) return null;
                return user.id != null ? user.id : (user.user_id != null ? user.user_id : null);
            } catch (e) { return null; }
        },

        /**
         * Check if current user has admin privileges
         */
        hasAdminRole: function () {
            const user = Session.get('user');
            if (!user) return false;

            const roleName = user.role_name || user.role || '';

            return roleName.toLowerCase().includes('admin') ||
                roleName.toLowerCase().includes('super admin');
        },

        /**
         * Check if user can access user management features
         */
        canAccessUserManagement: function () {
            const user = Session.get('user');
            if (!user) return false;

            const roleName = user.role_name || user.role || '';

            // If we have a role_id but no role_name, we might need to fetch complete user info
            if (user.role_id && !roleName) {
                return true;
            }

            // Temporary: Allow all authenticated users for testing
            // TODO: Restrict this once roles are properly configured
            if (user) {
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
            const user = Session.get('user');
            if (!user) return false;

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

            // Check for pending request to prevent duplicate calls (skip when forceRefresh so we get fresh data)
            const requestKey = `${functionName}_${JSON.stringify(params)}`;
            if (!forceRefresh && this.cache.pendingRequests.has(requestKey)) {
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
                            Session.clear();
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

                    // Cache successful responses (do not cache empty array for get_kernel_batches so we retry next load)
                    if (useCache && data && !data.error) {
                        const isEmptyArray = Array.isArray(data) && data.length === 0;
                        const isKernelBatchesEmpty = functionName === 'get_kernel_batches' && isEmptyArray;
                        if (!isKernelBatchesEmpty) {
                            this.setCache(cacheKey, data, cacheTtl);
                            console.log(`[Cache Set] ${functionName} (TTL: ${cacheTtl}ms)`);
                        }
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
            if (functionName.includes('oil')) return 'oil-production';
            if (functionName.includes('production') || functionName.includes('batch')) return 'kernel-production';
            if (functionName.includes('quality') || functionName.includes('test')) return 'quality-assurance';
            if (functionName.includes('stock') || functionName.includes('item')) return 'stock-management';
            if (functionName.includes('sales') || functionName.includes('forecast')) return 'sales-forecasting';
            if (functionName.includes('financial') || functionName.includes('transaction')) return 'financial-management';
            if (functionName.includes('document')) return 'document-management';
            return 'unknown';
        },

        // ===== USER MANAGEMENT FUNCTIONS =====

        /**
         * Get all users (cached for 5 minutes).
         * Normalizes proxy response so callers always receive an array (with role_name from JOIN).
         */
        getUsers: async function (token = null, forceRefresh = false) {
            var raw = await this.callFunction('get_users', {}, token, {
                cacheKey: 'users_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && Array.isArray(raw.get_users)) return raw.get_users;
            if (raw && Array.isArray(raw.result)) return raw.result;
            if (raw && Array.isArray(raw.body)) return raw.body;
            return [];
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
         * Get all roles (cached for 5 minutes).
         * Normalizes proxy response so callers always receive an array.
         */
        getRoles: async function (token = null, forceRefresh = false) {
            var raw = await this.callFunction('get_roles', {}, token, {
                cacheKey: 'roles_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && Array.isArray(raw.get_roles)) return raw.get_roles;
            if (raw && Array.isArray(raw.result)) return raw.result;
            if (raw && Array.isArray(raw.body)) return raw.body;
            return [];
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

        /**
         * Get feature by ID
         */
        getFeatureById: async function (featureId, token = null) {
            return await this.callFunction('get_feature_by_id', { p_id: featureId }, token);
        },

        /**
         * Create a new feature
         */
        createFeature: async function (featureData, token = null) {
            return await this.callFunction('create_feature_simple', {
                p_key: featureData.key,
                p_name: featureData.name,
                p_description: featureData.description || null
            }, token);
        },

        /**
         * Update an existing feature
         */
        updateFeature: async function (featureId, featureData, token = null) {
            return await this.callFunction('update_feature_simple', {
                p_id: featureId,
                p_key: featureData.key,
                p_name: featureData.name,
                p_description: featureData.description || null,
                p_is_active: featureData.is_active !== false
            }, token);
        },

        /**
         * Delete a feature
         */
        deleteFeature: async function (featureId, token = null) {
            return await this.callFunction('delete_feature_simple', { p_id: featureId }, token);
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

        /**
         * Get enabled feature keys for a specific role (used by menu filter).
         * No cache so Role Features changes are reflected after refresh.
         */
        getFeaturesForRole: async function (roleId, token = null) {
            var raw = await this.callFunction('get_features_for_role', { p_role_id: roleId }, token, { useCache: false });
            var list = null;
            if (Array.isArray(raw)) list = raw;
            else if (raw && Array.isArray(raw.get_features_for_role)) list = raw.get_features_for_role;
            else if (raw && Array.isArray(raw.data)) list = raw.data;
            else if (raw && Array.isArray(raw.result)) list = raw.result;
            else if (raw && typeof raw === 'object' && Array.isArray(raw.body)) list = raw.body;
            if (!Array.isArray(list)) return [];
            // Normalise to array of objects with key (backend returns TABLE (key VARCHAR) -> [{ key: '...' }] or similar)
            return list.map(function (row) {
                if (row && typeof row === 'object') {
                    var k = row.key != null ? row.key : row.Key;
                    return typeof k === 'string' ? { key: k } : { key: '' };
                }
                return { key: typeof row === 'string' ? row : '' };
            });
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

        /**
         * Get dashboard kernel stats: batches in production, kg cracked today, kg cracked this week.
         * Used by default dashboard.
         */
        getDashboardKernelStats: async function (token = null) {
            var defaults = { batches_in_production: 0, kg_cracked_today: 0, kg_cracked_week: 0, kg_packed_today: 0, kg_packed_week: 0 };
            try {
                var raw = await this.callFunction('get_dashboard_kernel_stats', {}, token, { useCache: false });
                var row = null;
                if (Array.isArray(raw) && raw[0]) row = raw[0];
                else if (raw && Array.isArray(raw.get_dashboard_kernel_stats) && raw.get_dashboard_kernel_stats[0]) row = raw.get_dashboard_kernel_stats[0];
                else if (raw && raw.batches_in_production !== undefined) row = raw;
                if (!row) return defaults;
                return {
                    batches_in_production: Number(row.batches_in_production) || 0,
                    kg_cracked_today: Number(row.kg_cracked_today) || 0,
                    kg_cracked_week: Number(row.kg_cracked_week) || 0,
                    kg_packed_today: Number(row.kg_packed_today) || 0,
                    kg_packed_week: Number(row.kg_packed_week) || 0
                };
            } catch (e) {
                console.warn('[Dashboard] get_dashboard_kernel_stats failed. Apply migration 20260306000001_create_get_dashboard_kernel_stats.sql if needed.', e.message);
                return defaults;
            }
        },

        /**
         * Get production trends for chart: daily kg cracked, kg packed, kg dispatched (SA timezone).
         * @param {number} days - Number of days (default 30)
         * @returns {Promise<Array<{trend_date:string,kg_cracked:number,kg_packed:number,kg_dispatched:number}>>}
         */
        getProductionTrendsDaily: async function (days, token = null) {
            var pDays = Math.max(7, Math.min(90, parseInt(days, 10) || 30));
            try {
                var raw = await this.callFunction('get_production_trends_daily', { p_days: pDays }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_production_trends_daily)) return raw.get_production_trends_daily;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Dashboard] get_production_trends_daily failed. Apply migration 20260326000001_get_production_trends_daily.sql if needed.', e.message);
                return [];
            }
        },

        /**
         * Get daily minute tests for dashboard (07h00, 10h00, 13h00, Averages from cracking).
         * @param {string} [dateStr] - Optional date YYYY-MM-DD; omit for today (SA).
         * @returns {Promise<Array<{time_slot:string,wholes:string,uncracks:string,total:string}>>}
         */
        getDailyMinuteTests: async function (dateStr, token = null) {
            try {
                var params = {};
                if (dateStr && String(dateStr).trim() !== '') params.p_date = String(dateStr).trim();
                var raw = await this.callFunction('get_daily_minute_tests', params, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_daily_minute_tests)) return raw.get_daily_minute_tests;
                return [];
            } catch (e) {
                console.warn('[Dashboard] get_daily_minute_tests failed. Apply migration 20260330000001_get_daily_minute_tests.sql if needed.', e.message);
                return [];
            }
        },

        /**
         * Get dashboard production stats: kernel pipeline, oil, quality, dispatch, batch health.
         * Used by Executive dashboard.
         */
        getDashboardProductionStats: async function (token = null) {
            var defaults = {
                batches_awaiting_test: 0, batches_release_ready: 0, batches_completed_week: 0, batches_in_intake: 0,
                oil_litres_today: 0, oil_litres_week: 0, oil_sheets_week: 0,
                quality_pass_rate: 0, quality_tests_week: 0,
                dispatch_orders_week: 0, dispatch_pending: 0, batches_on_hold: 0
            };
            try {
                var raw = await this.callFunction('get_dashboard_production_stats', {}, token, { useCache: false });
                var row = null;
                if (Array.isArray(raw) && raw[0]) row = raw[0];
                else if (raw && Array.isArray(raw.get_dashboard_production_stats) && raw.get_dashboard_production_stats[0]) row = raw.get_dashboard_production_stats[0];
                else if (raw && raw.batches_awaiting_test !== undefined) row = raw;
                if (!row) return defaults;
                return {
                    batches_awaiting_test: Number(row.batches_awaiting_test) || 0,
                    batches_release_ready: Number(row.batches_release_ready) || 0,
                    batches_completed_week: Number(row.batches_completed_week) || 0,
                    batches_in_intake: Number(row.batches_in_intake) || 0,
                    oil_litres_today: Number(row.oil_litres_today) || 0,
                    oil_litres_week: Number(row.oil_litres_week) || 0,
                    oil_sheets_week: Number(row.oil_sheets_week) || 0,
                    quality_pass_rate: Number(row.quality_pass_rate) || 0,
                    quality_tests_week: Number(row.quality_tests_week) || 0,
                    dispatch_orders_week: Number(row.dispatch_orders_week) || 0,
                    dispatch_pending: Number(row.dispatch_pending) || 0,
                    batches_on_hold: Number(row.batches_on_hold) || 0
                };
            } catch (e) {
                console.warn('[Dashboard] get_dashboard_production_stats failed. Apply migration 20260307000001 if needed.', e.message);
                return defaults;
            }
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
            var raw = await this.callFunction('get_contacts', {}, token, {
                cacheKey: 'contacts_list',
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && Array.isArray(raw.get_contacts)) return raw.get_contacts;
            if (raw && Array.isArray(raw.result)) return raw.result;
            return [];
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
            const normalizeCreateContactResult = (result) => {
                if (!result) return { success: false, error: 'Failed to create contact' };
                if (result.success === false) return result;
                if (result.id || result.inserted_ids?.[0]) {
                    return {
                        ...result,
                        success: result.success !== false,
                        id: result.id || result.inserted_ids?.[0] || null
                    };
                }
                if (result.data && typeof result.data === 'object') {
                    return {
                        ...result.data,
                        success: result.data.success !== false,
                        id: result.data.id || null
                    };
                }
                return result;
            };

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

            try {
                console.log('[Data Functions] createContact - trying create_contact_simple first');
                const functionResult = await this.callFunction('create_contact_simple', params, token, { useCache: false });
                const normalizedFunctionResult = normalizeCreateContactResult(functionResult);
                console.log('[Data Functions] createContact RPC result:', normalizedFunctionResult);
                if (normalizedFunctionResult && normalizedFunctionResult.success !== false && normalizedFunctionResult.id) {
                    this.clearCachePattern('contacts');
                    return normalizedFunctionResult;
                }
                throw new Error(normalizedFunctionResult?.error || normalizedFunctionResult?.message || 'Failed to create contact');
            } catch (functionError) {
                console.warn('[Data Functions] create_contact_simple failed, trying importTableRows:', functionError);

                const contactRow = {
                    contact_type: contactData.contact_type || contactData.p_contact_type,
                    company_name: contactData.company_name || contactData.p_company_name,
                    trading_name: contactData.trading_name || contactData.p_trading_name || null,
                    primary_contact_name: contactData.primary_contact_name || contactData.p_primary_contact_name || null,
                    primary_contact_email: contactData.primary_contact_email || contactData.p_primary_contact_email || null,
                    primary_contact_phone: contactData.primary_contact_phone || contactData.p_primary_contact_phone || null,
                    primary_contact_mobile: contactData.primary_contact_mobile || contactData.p_primary_contact_mobile || null,
                    physical_city: contactData.physical_city || contactData.p_physical_city || null,
                    physical_province: contactData.physical_province || contactData.p_physical_province || null,
                    physical_postal_code: contactData.physical_postal_code || contactData.p_physical_postal_code || null,
                    account_manager_id: contactData.account_manager_id || contactData.p_account_manager_id || null,
                    status: contactData.status || contactData.p_status || 'active',
                    key_account: contactData.key_account !== undefined ? contactData.key_account : (contactData.p_key_account !== undefined ? contactData.p_key_account : false),
                    notes: contactData.notes || contactData.p_notes || null,
                    supplier_number: contactData.supplier_number !== undefined ? contactData.supplier_number : (contactData.p_supplier_number !== undefined ? contactData.p_supplier_number : null)
                };

                console.log('[Data Functions] importTableRows fallback with row:', contactRow);
                const importResult = await this.importTableRows('contacts', [contactRow], token);
                const normalizedImportResult = normalizeCreateContactResult(importResult);
                if (normalizedImportResult && normalizedImportResult.success !== false) {
                    this.clearCachePattern('contacts');
                    return normalizedImportResult;
                }
                throw new Error(normalizedImportResult?.error || normalizedImportResult?.message || functionError?.message || 'Failed to create contact');
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
         * Proxies may return jsonb style maps as JSON strings — parse so remaining/yield keys work in JS.
         */
        normalizeKernelJsonbStyleMap: function (val) {
            if (val == null) return {};
            if (typeof val === 'object' && !Array.isArray(val)) return val;
            if (typeof val === 'string') {
                const s = val.trim();
                if (s === '' || s === 'null') return {};
                try {
                    const p = JSON.parse(s);
                    return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
                } catch (e) {
                    return {};
                }
            }
            return {};
        },

        /**
         * Lambda / .NET proxies sometimes return PascalCase property names. Kernel stock UI needs stable id + jsonb keys.
         */
        normalizeKernelBatchRow: function (r) {
            if (!r || typeof r !== 'object') return r;
            const o = Object.assign({}, r);
            if (o.id == null && o.Id != null) o.id = o.Id;
            if (o.batch_id == null && o.BatchId != null) o.batch_id = o.BatchId;
            if (o.batch_number == null && o.BatchNumber != null) o.batch_number = o.BatchNumber;
            if (o.yield_by_style == null && o.YieldByStyle != null) o.yield_by_style = o.YieldByStyle;
            if (o.remaining_by_style == null && o.RemainingByStyle != null) o.remaining_by_style = o.RemainingByStyle;
            if (o.yield_by_style_cartons == null && o.YieldByStyleCartons != null) o.yield_by_style_cartons = o.YieldByStyleCartons;
            if (o.remaining_by_style_cartons == null && o.RemainingByStyleCartons != null) o.remaining_by_style_cartons = o.RemainingByStyleCartons;
            if (o.grower_name == null && o.GrowerName != null) o.grower_name = o.GrowerName;
            if (o.supplier_id == null && o.SupplierId != null) o.supplier_id = o.SupplierId;
            if (o.status == null && o.Status != null) o.status = o.Status;
            o.yield_by_style = this.normalizeKernelJsonbStyleMap(o.yield_by_style);
            o.remaining_by_style = this.normalizeKernelJsonbStyleMap(o.remaining_by_style);
            o.yield_by_style_cartons = this.normalizeKernelJsonbStyleMap(o.yield_by_style_cartons);
            o.remaining_by_style_cartons = this.normalizeKernelJsonbStyleMap(o.remaining_by_style_cartons);
            return o;
        },

        normalizeKernelBatchRows: function (rows) {
            if (!Array.isArray(rows)) return [];
            const scope = this;
            return rows.map(function (row) {
                return scope.normalizeKernelBatchRow(row);
            });
        },

        /**
         * Lambda / .NET proxies return get_kernel_batches rows under different keys or as JSON strings.
         */
        extractKernelBatchesRowsFromRaw: function (raw, depth) {
            const d = depth == null ? 0 : depth;
            if (d > 8 || raw == null) return [];
            if (Array.isArray(raw)) return raw;
            if (typeof raw === 'string') {
                const s = raw.trim();
                if (s === '' || s === 'null') return [];
                try {
                    return this.extractKernelBatchesRowsFromRaw(JSON.parse(s), d + 1);
                } catch (e) {
                    return [];
                }
            }
            if (typeof raw !== 'object') return [];
            const keys = [
                'data', 'Data',
                'get_kernel_batches', 'GetKernelBatches', 'getKernelBatches',
                'result', 'Result',
                'rows', 'Rows',
                'records', 'Records',
                'items', 'Items',
                'body', 'Body',
                'value', 'Value'
            ];
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (raw[k] == null) continue;
                const got = this.extractKernelBatchesRowsFromRaw(raw[k], d + 1);
                if (got.length > 0) return got;
            }
            if ((raw.id != null || raw.Id != null) && (raw.batch_number != null || raw.BatchNumber != null)) {
                return [raw];
            }
            return [];
        },

        getKernelBatches: async function (token = null, forceRefresh = false, options = {}) {
            const params = {
                p_status: options.status != null ? options.status : null,
                p_search: options.search != null ? options.search : null,
                p_limit: options.limit != null ? options.limit : 100,
                p_offset: options.offset != null ? options.offset : 0
            };
            const cacheKey = 'kernel_batches_list' + (params.p_status ? '_' + params.p_status : '');
            const raw = await this.callFunction('get_kernel_batches', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            let rows = this.extractKernelBatchesRowsFromRaw(raw, 0);
            if (rows.length === 0 && raw && (raw.error || raw.message || raw.Error || raw.Message)) {
                console.warn('[getKernelBatches] API returned error:', raw.error || raw.message || raw.Error, raw);
                throw new Error(raw.message || raw.Message || raw.error || raw.Error || 'Failed to load kernel batches');
            }
            return this.normalizeKernelBatchRows(rows);
        },

        extractKernelProductionForecastRowsFromRaw: function (raw, depth) {
            const d = depth == null ? 0 : depth;
            if (d > 8 || raw == null) return [];
            if (Array.isArray(raw)) return raw;
            if (typeof raw === 'string') {
                const s = raw.trim();
                if (s === '' || s === 'null') return [];
                try {
                    return this.extractKernelProductionForecastRowsFromRaw(JSON.parse(s), d + 1);
                } catch (e) {
                    return [];
                }
            }
            if (typeof raw !== 'object') return [];
            const keys = [
                'data', 'Data',
                'get_kernel_production_forecasts', 'GetKernelProductionForecasts',
                'result', 'Result',
                'rows', 'Rows',
                'records', 'Records',
                'items', 'Items'
            ];
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (raw[k] == null) continue;
                const got = this.extractKernelProductionForecastRowsFromRaw(raw[k], d + 1);
                if (got.length > 0) return got;
            }
            if (raw.id != null && raw.style_code != null) return [raw];
            return [];
        },

        normalizeKernelProductionForecastRow: function (r) {
            if (!r || typeof r !== 'object') return r;
            const o = Object.assign({}, r);
            if (o.id == null && o.Id != null) o.id = o.Id;
            if (o.customer_label == null && o.CustomerLabel != null) o.customer_label = o.CustomerLabel;
            if (o.order_summary == null && o.OrderSummary != null) o.order_summary = o.OrderSummary;
            if (o.style_code == null && o.StyleCode != null) o.style_code = o.StyleCode;
            if (o.quantity_cartons == null && o.QuantityCartons != null) o.quantity_cartons = o.QuantityCartons;
            if (o.status == null && o.Status != null) o.status = o.Status;
            if (o.due_date == null && o.DueDate != null) o.due_date = o.DueDate;
            if (o.notes == null && o.Notes != null) o.notes = o.Notes;
            if (o.sort_index == null && o.SortIndex != null) o.sort_index = o.SortIndex;
            if (o.created_at == null && o.CreatedAt != null) o.created_at = o.CreatedAt;
            if (o.updated_at == null && o.UpdatedAt != null) o.updated_at = o.UpdatedAt;
            if (o.quantity_cartons != null && typeof o.quantity_cartons !== 'number') {
                const q = parseFloat(o.quantity_cartons);
                o.quantity_cartons = isNaN(q) ? 0 : q;
            }
            return o;
        },

        normalizeKernelProductionForecastRows: function (rows) {
            if (!Array.isArray(rows)) return [];
            const scope = this;
            return rows.map(function (row) {
                return scope.normalizeKernelProductionForecastRow(row);
            });
        },

        getKernelProductionForecasts: async function (token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_kernel_production_forecasts', {}, token, {
                cacheKey: 'kernel_production_forecasts_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            return this.normalizeKernelProductionForecastRows(this.extractKernelProductionForecastRowsFromRaw(raw, 0));
        },

        parseUpsertKernelProductionForecastResult: function (raw) {
            const rows = this.extractKernelProductionForecastRowsFromRaw(raw, 0);
            if (rows.length > 0) return this.normalizeKernelProductionForecastRow(rows[0]);
            if (raw && raw.data && Array.isArray(raw.data) && raw.data[0]) {
                return this.normalizeKernelProductionForecastRow(raw.data[0]);
            }
            return null;
        },

        upsertKernelProductionForecast: async function (payload, token = null) {
            payload = payload || {};
            const params = {
                p_id: payload.id != null && payload.id !== '' ? payload.id : null,
                p_customer_label: payload.customer_label != null ? payload.customer_label : '',
                p_order_summary: payload.order_summary != null ? payload.order_summary : '',
                p_style_code: payload.style_code != null ? payload.style_code : '',
                p_quantity_cartons: payload.quantity_cartons != null ? payload.quantity_cartons : 0,
                p_status: payload.status != null ? payload.status : 'open',
                p_due_date: payload.due_date != null && payload.due_date !== '' ? payload.due_date : null,
                p_notes: payload.notes != null ? payload.notes : '',
                p_sort_index: payload.sort_index != null ? payload.sort_index : null
            };
            const result = await this.callFunction('upsert_kernel_production_forecast', params, token, { useCache: false });
            this.clearCachePattern('kernel_production_forecasts');
            return this.parseUpsertKernelProductionForecastResult(result);
        },

        deleteKernelProductionForecast: async function (forecastId, token = null) {
            await this.callFunction('delete_kernel_production_forecast', { p_id: forecastId }, token, { useCache: false });
            this.clearCachePattern('kernel_production_forecasts');
        },

        extractOilProductionForecastRowsFromRaw: function (raw, depth) {
            const d = depth == null ? 0 : depth;
            if (d > 8 || raw == null) return [];
            if (Array.isArray(raw)) return raw;
            if (typeof raw === 'string') {
                const s = raw.trim();
                if (s === '' || s === 'null') return [];
                try {
                    return this.extractOilProductionForecastRowsFromRaw(JSON.parse(s), d + 1);
                } catch (e) {
                    return [];
                }
            }
            if (typeof raw !== 'object') return [];
            const keys = [
                'data', 'Data',
                'get_oil_production_forecasts', 'GetOilProductionForecasts',
                'result', 'Result',
                'rows', 'Rows',
                'records', 'Records',
                'items', 'Items'
            ];
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (raw[k] == null) continue;
                const got = this.extractOilProductionForecastRowsFromRaw(raw[k], d + 1);
                if (got.length > 0) return got;
            }
            if (raw.id != null && raw.stream_code != null) return [raw];
            return [];
        },

        normalizeOilProductionForecastRow: function (r) {
            if (!r || typeof r !== 'object') return r;
            const o = Object.assign({}, r);
            if (o.id == null && o.Id != null) o.id = o.Id;
            if (o.customer_label == null && o.CustomerLabel != null) o.customer_label = o.CustomerLabel;
            if (o.order_summary == null && o.OrderSummary != null) o.order_summary = o.OrderSummary;
            if (o.stream_code == null && o.StreamCode != null) o.stream_code = o.StreamCode;
            if (o.quantity_kg == null && o.QuantityKg != null) o.quantity_kg = o.QuantityKg;
            if (o.status == null && o.Status != null) o.status = o.Status;
            if (o.due_date == null && o.DueDate != null) o.due_date = o.DueDate;
            if (o.notes == null && o.Notes != null) o.notes = o.Notes;
            if (o.sort_index == null && o.SortIndex != null) o.sort_index = o.SortIndex;
            if (o.created_at == null && o.CreatedAt != null) o.created_at = o.CreatedAt;
            if (o.updated_at == null && o.UpdatedAt != null) o.updated_at = o.UpdatedAt;
            if (o.quantity_kg != null && typeof o.quantity_kg !== 'number') {
                const q = parseFloat(o.quantity_kg);
                o.quantity_kg = isNaN(q) ? 0 : q;
            }
            return o;
        },

        normalizeOilProductionForecastRows: function (rows) {
            if (!Array.isArray(rows)) return [];
            const scope = this;
            return rows.map(function (row) {
                return scope.normalizeOilProductionForecastRow(row);
            });
        },

        getOilProductionForecasts: async function (token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_oil_production_forecasts', {}, token, {
                cacheKey: 'oil_production_forecasts_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            return this.normalizeOilProductionForecastRows(this.extractOilProductionForecastRowsFromRaw(raw, 0));
        },

        parseUpsertOilProductionForecastResult: function (raw) {
            const rows = this.extractOilProductionForecastRowsFromRaw(raw, 0);
            if (rows.length > 0) return this.normalizeOilProductionForecastRow(rows[0]);
            if (raw && raw.data && Array.isArray(raw.data) && raw.data[0]) {
                return this.normalizeOilProductionForecastRow(raw.data[0]);
            }
            return null;
        },

        upsertOilProductionForecast: async function (payload, token = null) {
            payload = payload || {};
            const params = {
                p_id: payload.id != null && payload.id !== '' ? payload.id : null,
                p_customer_label: payload.customer_label != null ? payload.customer_label : '',
                p_order_summary: payload.order_summary != null ? payload.order_summary : '',
                p_stream_code: payload.stream_code != null ? payload.stream_code : '',
                p_quantity_kg: payload.quantity_kg != null ? payload.quantity_kg : 0,
                p_status: payload.status != null ? payload.status : 'open',
                p_due_date: payload.due_date != null && payload.due_date !== '' ? payload.due_date : null,
                p_notes: payload.notes != null ? payload.notes : '',
                p_sort_index: payload.sort_index != null ? payload.sort_index : null
            };
            const result = await this.callFunction('upsert_oil_production_forecast', params, token, { useCache: false });
            this.clearCachePattern('oil_production_forecasts');
            return this.parseUpsertOilProductionForecastResult(result);
        },

        deleteOilProductionForecast: async function (forecastId, token = null) {
            await this.callFunction('delete_oil_production_forecast', { p_id: forecastId }, token, { useCache: false });
            this.clearCachePattern('oil_production_forecasts');
        },

        /**
         * getKernelBatchDetail — full kernel row for modals (stage arrays + job_card_data + qa_data).
         * Used by: all production/job-card/QA modals.
         */
        getKernelBatchDetail: async function (kernelId, token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_kernel_batch_detail', { p_kernel_id: kernelId }, token, {
                cacheKey: 'kernel_batch_detail_' + kernelId,
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            if (raw && raw.id) return raw;
            if (raw && Array.isArray(raw.data) && raw.data[0]) return raw.data[0];
            if (Array.isArray(raw) && raw[0]) return raw[0];
            if (raw && raw.get_kernel_batch_detail) {
                const d = raw.get_kernel_batch_detail;
                return Array.isArray(d) ? d[0] : d;
            }
            return null;
        },

        /**
         * upsertKernelProduction — save day stage data, finish production, or save job card.
         * Used by: modal_production_stages only.
         * options: { dayIndex, crackingData, washingData, sortingData, packingData, finishProduction, jobCardData }
         */
        upsertKernelProduction: async function (kernelId, options, token = null) {
            options = options || {};
            const params = {
                p_kernel_id: kernelId,
                p_day_index: options.dayIndex != null ? options.dayIndex : null,
                p_cracking_data: options.crackingData != null ? options.crackingData : null,
                p_washing_data: options.washingData != null ? options.washingData : null,
                p_sorting_data: options.sortingData != null ? options.sortingData : null,
                p_packing_data: options.packingData != null ? options.packingData : null,
                p_finish_production: options.finishProduction === true,
                p_job_card_data: options.jobCardData != null ? options.jobCardData : null
            };
            const result = await this.callFunction('upsert_kernel_production', params, token, { useCache: false });
            this.clearCachePattern('kernel_batch_detail_' + kernelId);
            this.clearCachePattern('kernel_batches');
            return result;
        },

        /**
         * upsertKernelJobCard — save / replace job card JSONB.
         * Used by: modal_kernel_job_card only.
         * options.approved: set true when user clicks "Jobcard approved" (sets jobcard_approved in DB; Job Card tick and Release to stock then apply).
         * options.finalizeWithoutProduction: migration 20260404150001 — marks production finished, status qa, seeds minimal qa_data if empty (release-ready shortcut).
         * If backend only has older signatures, retries without finalize then without approved.
         */
        upsertKernelJobCard: async function (kernelId, jobCardData, token = null, options = {}) {
            // Only send p_jobcard_approved when explicitly approving. Sending false would clear the flag on autosave.
            const paramsWithApproved = {
                p_kernel_id: kernelId,
                p_job_card_data: jobCardData
            };
            if (options.approved === true) {
                paramsWithApproved.p_jobcard_approved = true;
            }
            if (options.finalizeWithoutProduction === true) {
                paramsWithApproved.p_finalize_without_production = true;
            }
            const paramsApprovedNoFinalize = {
                p_kernel_id: kernelId,
                p_job_card_data: jobCardData
            };
            if (options.approved === true) {
                paramsApprovedNoFinalize.p_jobcard_approved = true;
            }
            const paramsTwoOnly = { p_kernel_id: kernelId, p_job_card_data: jobCardData };
            const clearCache = () => {
                this.clearCachePattern('kernel_batch_detail_' + kernelId);
                this.clearCachePattern('kernel_batches');
            };
            const tryCall = async (payload) => {
                const result = await this.callFunction('upsert_kernel_job_card', payload, token, { useCache: false });
                clearCache();
                return result;
            };
            try {
                return await tryCall(paramsWithApproved);
            } catch (e) {
                const msg = (e && e.message) ? String(e.message) : '';
                const rpcErr = /function.*not found|schema cache|could not find|unknown|argument|upsert_kernel_job_card/i.test(msg);
                if (rpcErr && options.finalizeWithoutProduction === true) {
                    try {
                        return await tryCall(paramsApprovedNoFinalize);
                    } catch (e2) {
                        const msg2 = (e2 && e2.message) ? String(e2.message) : '';
                        if ((/function.*not found|schema cache/i.test(msg2) || /upsert_kernel_job_card/i.test(msg2)) && options.approved === true) {
                            return await tryCall(paramsTwoOnly);
                        }
                        throw e2;
                    }
                }
                if (rpcErr && options.approved === true) {
                    return await tryCall(paramsTwoOnly);
                }
                throw e;
            }
        },

        /**
         * upsertKernelQa — save / replace QA (packing sample) JSONB.
         * Used by: modal_end_sample only.
         */
        upsertKernelQa: async function (kernelId, qaData, token = null) {
            const result = await this.callFunction('upsert_kernel_qa', {
                p_kernel_id: kernelId,
                p_qa_data: qaData
            }, token, { useCache: false });
            this.clearCachePattern('kernel_batch_detail_' + kernelId);
            this.clearCachePattern('kernel_batches');
            return result;
        },

        /**
         * getNextBatchNumber — returns next batch id in format "Bn SS YY NN" (supplier #, year, yearly seq).
         * NN is the first unused sequence for that calendar year across all kernel batches. Used as a suggestion; create may pass a custom batch_number.
         */
        getNextBatchNumber: async function (supplierId, year, token = null) {
            const y = year != null ? Number(year) % 100 : (new Date().getFullYear() % 100);
            const params = { p_supplier_id: supplierId || null, p_year: y };
            const result = await this.callFunction('get_next_batch_number', params, token, { useCache: false });
            if (result == null) return null;
            if (typeof result === 'string') return result;
            if (result.data != null && typeof result.data === 'string') return result.data;
            if (result.get_next_batch_number != null) return String(result.get_next_batch_number);
            if (result.GetNextBatchNumber != null) return String(result.GetNextBatchNumber);
            if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'string') return result[0];
            if (typeof result === 'object' && result.value != null) return String(result.value);
            return null;
        },

        /**
         * createKernelBatch — insert new batch into batches + kernel tables.
         * Batch number: pass null to auto-assign "Bn SS YY NN"; or pass a value to use it (must be unique).
         * Used by: kernel_production_batch_actions.saveNewBatch
         */
        createKernelBatch: async function (batchData, token = null) {
            const params = {
                p_batch_number:        (batchData.batch_number && String(batchData.batch_number).trim()) || null,
                p_received_date:       batchData.received_date        || null,
                p_wet_nis_received_kg: batchData.wet_nis_received_kg  != null ? batchData.wet_nis_received_kg : null,
                p_supplier_id:         batchData.supplier_id          || null,
                p_grower_name:         batchData.grower_name          || null
            };
            const result = await this.callFunction('create_kernel_batch', params, token, { useCache: false });
            this.clearCachePattern('kernel_batches');
            return result;
        },

        /**
         * completeKernelBatch — set kernel status to 'complete' (release to stock).
         * Used by: kernel_production_batch_actions.releaseBatchToStock
         */
        completeKernelBatch: async function (kernelId, token = null) {
            const result = await this.callFunction('complete_kernel_batch', { p_kernel_id: kernelId }, token, { useCache: false });
            this.clearCachePattern('kernel_batch_detail_' + kernelId);
            this.clearCachePattern('kernel_batches');
            return result;
        },

        /**
         * adjustKernelStockOnHand — manually add/subtract one kernel stock style.
         * Persists an adjustment row into packing_data. Stock UI uses cartons only (qtyDelta 0 from client).
         */
        adjustKernelStockOnHand: async function (kernelId, adjustment, token = null) {
            let qtyDelta = adjustment && adjustment.qtyDelta != null ? Number(adjustment.qtyDelta) : 0;
            let cartonsDelta = adjustment && adjustment.cartonsDelta != null ? Number(adjustment.cartonsDelta) : 0;
            if (!isFinite(qtyDelta)) qtyDelta = 0;
            if (!isFinite(cartonsDelta)) cartonsDelta = 0;
            const params = {
                p_kernel_id: kernelId,
                p_style: adjustment && adjustment.style != null && adjustment.style !== ''
                    ? String(adjustment.style)
                    : null,
                p_qty_delta: qtyDelta,
                p_cartons_delta: cartonsDelta,
                p_reason: adjustment && adjustment.reason != null ? adjustment.reason : null
            };
            let result = await this.callFunction('adjust_kernel_stock_on_hand', params, token, { useCache: false });
            if (result && result.offline && result.queued) {
                throw new Error('Cannot apply stock change while offline. Connect and try again.');
            }
            let r = result;
            for (let i = 0; i < 10 && r && typeof r === 'object' && !Array.isArray(r); i++) {
                if (r.adjust_kernel_stock_on_hand !== undefined) r = r.adjust_kernel_stock_on_hand;
                else if (r.AdjustKernelStockOnHand !== undefined) r = r.AdjustKernelStockOnHand;
                else if (r.data !== undefined) r = r.data;
                else if (r.Data !== undefined) r = r.Data;
                else if (r.result !== undefined) r = r.result;
                else if (r.Result !== undefined) r = r.Result;
                else if (r.body !== undefined) r = r.body;
                else if (r.Body !== undefined) r = r.Body;
                else break;
            }
            if (typeof r === 'string') {
                try {
                    r = JSON.parse(r);
                } catch (e) { /* keep */ }
            }
            result = r;
            if (result && typeof result === 'object') {
                if (result.success === undefined && result.Success !== undefined) result.success = result.Success;
                if (result.error === undefined && result.Error !== undefined) result.error = result.Error;
            }
            this.clearCachePattern('kernel_batch_detail_' + kernelId);
            this.clearCachePattern('kernel_batches');
            return result;
        },

        /**
         * deactivateKernelBatch — soft delete: set kernel.is_active = false. Batch is hidden from all lists.
         * Used by: Kernel Production and Grower Intake "Delete batch" actions.
         */
        deactivateKernelBatch: async function (kernelId, token = null) {
            const result = await this.callFunction('deactivate_kernel_batch', { p_kernel_id: kernelId }, token, { useCache: false });
            this.clearCachePattern('kernel_batch_detail_' + kernelId);
            this.clearCachePattern('kernel_batches');
            return result;
        },

        /**
         * deleteKernelBatchPermanent — hard delete kernel batch (batches + kernel row). Irreversible.
         * Cleans silo assignment and kernel_dispatch_orders lines referencing this kernel.
         */
        deleteKernelBatchPermanent: async function (kernelId, token = null) {
            let result = await this.callFunction('delete_kernel_batch_permanent', { p_kernel_id: kernelId }, token, { useCache: false });
            if (result && result.delete_kernel_batch_permanent !== undefined) {
                result = result.delete_kernel_batch_permanent;
            }
            if (result && result.data !== undefined) {
                result = result.data;
            }
            if (typeof result === 'string') {
                try {
                    result = JSON.parse(result);
                } catch (e) { /* keep */ }
            }
            if (result && typeof result === 'object') {
                if (result.success === undefined && result.Success !== undefined) result.success = result.Success;
                if (result.error === undefined && result.Error !== undefined) result.error = result.Error;
            }
            this.clearCachePattern('kernel_batch_detail_' + kernelId);
            this.clearCachePattern('kernel_batches');
            this.clearCachePattern('silos');
            this.clearCachePattern('production_batches');
            this.clearCachePattern('kernel_dispatch_orders_list');
            return result;
        },

        /**
         * importHistoricalKernelBatch — one-off import of a historical kernel batch (e.g. from Macadamia Kernel Statistics Excel).
         * Creates batch + kernel with status 'complete' and one packing_data entry (yield by style in kg).
         * @param {object} data - { batch_number, grower_name?, supplier_id?, received_date?, production_finished_at?, wet_nis_received_kg?, sk_sp_qty, sk_0_qty, sk_1_qty, sk_1s_qty, sk_4l_qty, sk_5_qty, sk_6_qty, bt_78_qty, bt_high_qty, bt_low_qty, best_before_date?, ffa? }
         * @param {string|null} token
         * @returns {Promise<object>} { success, id, batch_number } or { success: false, error }
         */
        importHistoricalKernelBatch: async function (data, token = null) {
            const params = {
                p_batch_number: data.batch_number,
                p_grower_name: data.grower_name || null,
                p_supplier_id: data.supplier_id || null,
                p_received_date: data.received_date || null,
                p_production_finished_at: data.production_finished_at || null,
                p_wet_nis_received_kg: data.wet_nis_received_kg != null ? data.wet_nis_received_kg : null,
                p_sk_sp_qty: data.sk_sp_qty != null ? data.sk_sp_qty : 0,
                p_sk_0_qty: data.sk_0_qty != null ? data.sk_0_qty : 0,
                p_sk_1_qty: data.sk_1_qty != null ? data.sk_1_qty : 0,
                p_sk_1s_qty: data.sk_1s_qty != null ? data.sk_1s_qty : 0,
                p_sk_4l_qty: data.sk_4l_qty != null ? data.sk_4l_qty : 0,
                p_sk_5_qty: data.sk_5_qty != null ? data.sk_5_qty : 0,
                p_sk_6_qty: data.sk_6_qty != null ? data.sk_6_qty : 0,
                p_bt_78_qty: data.bt_78_qty != null ? data.bt_78_qty : 0,
                p_bt_high_qty: data.bt_high_qty != null ? data.bt_high_qty : 0,
                p_bt_low_qty: data.bt_low_qty != null ? data.bt_low_qty : 0,
                p_best_before_date: data.best_before_date || null,
                p_ffa: data.ffa != null ? data.ffa : null
            };
            let result = await this.callFunction('import_historical_kernel_batch', params, token, { useCache: false });
            if (result && result.import_historical_kernel_batch !== undefined) {
                result = result.import_historical_kernel_batch;
            }
            if (result && result.data !== undefined) {
                result = result.data;
            }
            if (typeof result === 'string') {
                try {
                    result = JSON.parse(result);
                } catch (e) { /* keep */ }
            }
            if (result && typeof result === 'object') {
                if (result.success === undefined && result.Success !== undefined) result.success = result.Success;
                if (result.error === undefined && result.Error !== undefined) result.error = result.Error;
                if (result.id === undefined && result.Id !== undefined) result.id = result.Id;
                if (result.batch_number === undefined && result.BatchNumber !== undefined) result.batch_number = result.BatchNumber;
            }
            this.clearCachePattern('kernel_batches');
            return result;
        },

        /**
         * getKernelProductionHistory — history-specific read: intake, stage arrays, job card, QA.
         * Used by: modal_batch_history only.
         */
        getKernelProductionHistory: async function (kernelId, token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_kernel_production_history', { p_kernel_id: kernelId }, token, {
                cacheKey: 'kernel_production_history_' + kernelId,
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            if (raw && raw.id) return raw;
            if (raw && Array.isArray(raw.data) && raw.data[0]) return raw.data[0];
            if (Array.isArray(raw) && raw[0]) return raw[0];
            if (raw && raw.get_kernel_production_history) { const d = raw.get_kernel_production_history; return Array.isArray(d) ? d[0] : d; }
            return null;
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

        createSampleSubmissionForBatch: async function (payload, token = null) {
            const result = await this.callFunction('create_sample_submission_for_batch', payload, token, { useCache: false });
            this.clearCachePattern('production_batches');
            this.clearCachePattern('sample_submissions');
            return result;
        },

        /**
         * Get supplier intake batches (Oil & Protein). Uses Supabase oil table via get_oil_batches.
         * Returns rows with status 'awaiting_test' or 'release_ready', mapped to the shape expected by the Supplier Intake grid.
         * Batches are created via the Receiver checklist (multiple batches per submission); initial status is 'awaiting_test'.
         * @param {string} status - e.g. 'supplier_intake' to fetch all Supplier Intake stages (awaiting_test, release_ready)
         * @param {string|null} token - auth token (optional)
         * @param {boolean} forceRefresh - bypass cache
         * @returns {Promise<Array>} list of batch records { id, batch_number, product_type, date_received, ... }
         */
        getSupplierIntakeBatches: async function (status, token = null, forceRefresh = false) {
            // Supplier Intake: only 'awaiting_test' and 'release_ready' (no longer 'intake')
            var pStatus = (status === 'supplier_intake' || status === 'intake')
                ? 'awaiting_test,release_ready'
                : (status || null);
            var params = { p_status: pStatus || 'awaiting_test,release_ready', p_limit: 500, p_offset: 0 };
            var cacheKey = 'supplier_intake_batches_list_' + (pStatus || 'awaiting_test_release_ready');
            var raw = await this.callFunction('get_oil_batches', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
            var rows = [];
            if (Array.isArray(raw)) rows = raw;
            else if (raw && Array.isArray(raw.data)) rows = raw.data;
            else if (raw && raw.get_oil_batches && Array.isArray(raw.get_oil_batches)) rows = raw.get_oil_batches;
            else if (raw && typeof raw === 'object' && raw[Symbol.iterator]) rows = Array.from(raw);

            function mapOilRowToGrid(o) {
                var intakeRaw = o && o.intake_data;
                var intake = {};
                if (intakeRaw != null) {
                    if (typeof intakeRaw === 'string') {
                        var s = intakeRaw.trim();
                        if (s && s !== 'null') {
                            try {
                                intake = JSON.parse(s);
                            } catch (e) {
                                intake = {};
                            }
                        }
                    } else if (typeof intakeRaw === 'object') {
                        intake = intakeRaw;
                    }
                }
                if (!intake || typeof intake !== 'object') intake = {};
                var vc = (intake.vehicle_checks && typeof intake.vehicle_checks === 'object') ? intake.vehicle_checks : {};
                var adjFfa = intake.adjust_stock_ffa;
                if (adjFfa != null && adjFfa !== '' && typeof adjFfa !== 'number') {
                    var p = parseFloat(adjFfa);
                    adjFfa = isNaN(p) ? null : p;
                }
                var offFfa = intake.official_ffa != null ? intake.official_ffa : (intake.ffa != null ? intake.ffa : null);
                if (offFfa != null && offFfa !== '' && typeof offFfa !== 'number') {
                    var po = parseFloat(offFfa);
                    offFfa = isNaN(po) ? null : po;
                }
                var displayOfficialFfa = offFfa != null ? offFfa : (adjFfa != null ? adjFfa : null);
                return {
                    id: o.id,
                    batch_number: o.batch_id,
                    product_type: intake.product_type || (o.name_of_product && String(o.name_of_product).toLowerCase().replace(/\s+/g, '_')) || 'oil',
                    date_received: intake.date_received || o.production_date,
                    delivery_note_ref: intake.delivery_note_reference || intake.delivery_note_ref,
                    supplier_id: intake.supplier_id || null,
                    supplier_details: intake.supplier || intake.supplier_details,
                    quantity_kg: intake.quantity_kg != null ? intake.quantity_kg : (intake.items && intake.items[0] && intake.items[0].quantity_kg),
                    manufactured_date: intake.manufactured_date || (intake.items && intake.items[0] && intake.items[0].manufactured_date),
                    best_before_date: intake.best_before_date || (intake.items && intake.items[0] && intake.items[0].best_before_date),
                    status: o.status || 'awaiting_test',
                    reference: intake.reference,
                    description: intake.description,
                    carton_bulk_bags: intake.carton_bulk_bags,
                    vehicle_clean: vc.vehicle_clean != null ? vc.vehicle_clean : intake.vehicle_clean,
                    vehicle_enclosed: vc.vehicle_enclosed != null ? vc.vehicle_enclosed : intake.vehicle_enclosed,
                    hazard_substances: vc.hazard_substances != null ? vc.hazard_substances : intake.hazard_substances,
                    pest_infestations: vc.pest_infestations != null ? vc.pest_infestations : intake.pest_infestations,
                    pallets_condition: vc.pallets_condition != null ? vc.pallets_condition : intake.pallets_condition,
                    raw_materials_condition: vc.raw_materials_condition != null ? vc.raw_materials_condition : intake.raw_materials_condition,
                    receiving_comments: intake.receiving_comments,
                    official_ffa: displayOfficialFfa,
                    adjust_stock_ffa: adjFfa != null ? adjFfa : null,
                    supplier_intake_official_ffa_at: intake.supplier_intake_official_ffa_at || null,
                    created_by_name: o.created_by_name,
                    updated_by_name: o.updated_by_name
                };
            }

            return rows.map(mapOilRowToGrid);
        },

        /**
         * First Supplier Intake sample test only: writes official FFA to oil.intake_data and sets status release_ready.
         */
        completeSupplierIntakeFirstSampleFfa: async function (oilId, ffaPct, token = null) {
            if (!oilId || ffaPct == null || isNaN(Number(ffaPct))) {
                return { success: false, error: 'Oil id and FFA % are required' };
            }
            var payload = { p_oil_id: oilId, p_ffa_pct: Number(ffaPct) };
            var uid = this.getCurrentUserId();
            if (uid) payload.p_updated_by = uid;
            var result = await this.callFunction('complete_supplier_intake_first_sample_ffa', payload, token, { useCache: false });
            this.clearCachePattern('supplier_intake');
            this.clearCachePattern('oil_batches');
            this.clearCachePattern('oil_production');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * All supplier-intake oil rows (awaiting_test, release_ready, production) for weekly in/out by ingredient.
         * Stock out uses weight_before_production_kg and weight_before_production_recorded_at when present.
         */
        getSupplierIntakeWeeklyOilRows: async function (token = null, forceRefresh = false) {
            var params = { p_status: 'awaiting_test,release_ready,production', p_limit: 2000, p_offset: 0 };
            var raw = await this.callFunction('get_oil_batches', params, token, {
                cacheKey: 'supplier_intake_weekly_oil_rows',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
            var rows = [];
            if (Array.isArray(raw)) rows = raw;
            else if (raw && Array.isArray(raw.data)) rows = raw.data;
            else if (raw && raw.get_oil_batches && Array.isArray(raw.get_oil_batches)) rows = raw.get_oil_batches;
            else if (raw && typeof raw === 'object' && raw[Symbol.iterator]) rows = Array.from(raw);

            function mapWeekly(o) {
                var intake = (o && o.intake_data) || {};
                if (typeof intake === 'string') {
                    try { intake = JSON.parse(intake); } catch (e1) { intake = {}; }
                }
                var pt = intake.product_type || (o.name_of_product && String(o.name_of_product).toLowerCase().replace(/\s+/g, '_')) || 'oil';
                var qtyKg = intake.quantity_kg != null ? Number(intake.quantity_kg) : (intake.items && intake.items[0] && intake.items[0].quantity_kg != null ? Number(intake.items[0].quantity_kg) : NaN);
                var wCompare = intake.weight_at_intake_for_comparison_kg != null ? Number(intake.weight_at_intake_for_comparison_kg) : NaN;
                var receivingKg = !isNaN(wCompare) ? wCompare : (!isNaN(qtyKg) ? qtyKg : NaN);
                var wbp = intake.weight_before_production_kg != null ? Number(intake.weight_before_production_kg) : NaN;
                return {
                    id: o.id,
                    batch_number: o.batch_id,
                    product_type: pt,
                    status: (o.status || 'awaiting_test').toString().trim(),
                    date_received: intake.date_received || o.production_date,
                    quantity_kg: !isNaN(qtyKg) ? qtyKg : null,
                    receiving_kg: !isNaN(receivingKg) ? receivingKg : null,
                    weight_before_production_kg: !isNaN(wbp) ? wbp : null,
                    weight_before_production_recorded_at: intake.weight_before_production_recorded_at || null,
                    production_completed_at: o.production_completed_at || null,
                    created_at: o.created_at || null
                };
            }
            return rows.map(mapWeekly);
        },

        /**
         * Release a supplier intake batch to oil production. Updates the oil row status to 'production'.
         * Uses Supabase oil table via upsert_oil_batch.
         * @param {string} batchId - UUID id of the oil row (oil.id from the grid)
         * @param {object|null} batch - optional batch object { id, batch_number } for context
         * @param {string|null} token - auth token (optional)
         * @returns {Promise<object>} result from backend
         */
        releaseSupplierIntakeBatchToOilProduction: async function (batchId, batchOrToken, token = null) {
            var batch = null;
            if (batchOrToken && typeof batchOrToken === 'object' && !batchOrToken.substring) {
                batch = batchOrToken;
            } else if (batchOrToken && typeof batchOrToken === 'string') {
                token = batchOrToken;
            }
            var oilId = (batch && batch.id != null) ? batch.id : batchId;
            if (!oilId) {
                return { success: false, error: 'Batch id is required' };
            }
            var payload = {
                p_oil_id: oilId,
                p_status: 'production'
            };
            var uid = this.getCurrentUserId();
            if (uid) payload.p_updated_by = uid;
            var result = await this.callFunction('upsert_oil_batch', payload, token, { useCache: false });
            var resolved = result && (result.data !== undefined ? result.data : result);
            if (resolved && (resolved.success !== false && resolved.error == null)) {
                this.clearCachePattern('supplier_intake');
                this.clearCachePattern('oil_batches');
                this.clearCachePattern('oil_production');
                return result;
            }
            var errMsg = (resolved && (resolved.error || resolved.message)) ? (resolved.error || resolved.message) : 'Release failed';
            this.clearCachePattern('supplier_intake');
            this.clearCachePattern('oil_batches');
            this.clearCachePattern('oil_production');
            return result;
        },

        /**
         * Update only the status of an oil batch (without overwriting intake_data).
         * Used by Supplier Intake to move batches from awaiting_test -> release_ready after sample tests.
         */
        updateOilBatchStatus: async function (oilId, status, token = null) {
            if (!oilId || !status) return { success: false, error: 'Oil id and status are required' };
            var payload = { p_oil_id: oilId, p_status: status };
            var uid = this.getCurrentUserId();
            if (uid) payload.p_updated_by = uid;
            var result = await this.callFunction('upsert_oil_batch', payload, token, { useCache: false });
            this.clearCachePattern('supplier_intake');
            this.clearCachePattern('oil_batches');
            this.clearCachePattern('oil_production');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * Create a supplier intake batch (oil/protein). Uses Supabase oil table via upsert_oil_batch.
         * Stores intake fields in intake_data jsonb; status defaults to 'awaiting_test'.
         * Used by the Supplier Intake "Add new batch" modal.
         * @param {object} data - { product_type, date_received, delivery_note_ref, supplier_id, quantity_kg, ... }
         * @param {string|null} token - auth token (optional)
         * @returns {Promise<object>} result from upsert_oil_batch { success, id, batch_id }
         */
        createSupplierIntakeBatch: async function (data, token = null) {
            var bn = (data.batch_number != null && String(data.batch_number).trim()) ? String(data.batch_number).trim() : '';
            if (!bn) {
                return { success: false, error: 'Batch number is required for each new oil/protein ingredient batch.' };
            }
            var intakeData = {
                date_received: data.date_received || data.received_date || null,
                delivery_note_reference: data.delivery_note_ref || null,
                delivery_note_ref: data.delivery_note_ref || null,
                supplier_id: data.supplier_id || null,
                supplier: data.supplier_details || null,
                supplier_details: data.supplier_details || null,
                product_type: data.product_type || null,
                quantity_kg: data.quantity_kg != null ? data.quantity_kg : data.wet_nis_received_kg,
                manufactured_date: data.manufactured_date || null,
                best_before_date: data.best_before_date || null,
                reference: data.reference || null,
                description: data.description || null,
                carton_bulk_bags: data.carton_bulk_bags != null ? data.carton_bulk_bags : 1,
                receiving_comments: data.receiving_comments || null,
                vehicle_clean: data.vehicle_clean,
                vehicle_enclosed: data.vehicle_enclosed,
                hazard_substances: data.hazard_substances,
                pest_infestations: data.pest_infestations,
                pallets_condition: data.pallets_condition,
                raw_materials_condition: data.raw_materials_condition,
                vehicle_checks: {
                    vehicle_clean: data.vehicle_clean,
                    vehicle_enclosed: data.vehicle_enclosed,
                    hazard_substances: data.hazard_substances,
                    pest_infestations: data.pest_infestations,
                    pallets_condition: data.pallets_condition,
                    raw_materials_condition: data.raw_materials_condition
                },
                delivery_group_id: data.delivery_group_id || null
            };
            if (data.adjust_stock_ffa != null && String(data.adjust_stock_ffa).trim() !== '') {
                var adjF = parseFloat(data.adjust_stock_ffa);
                if (!isNaN(adjF)) intakeData.adjust_stock_ffa = adjF;
            }
            if (data.from_adjust_stock === true) {
                intakeData.from_adjust_stock = true;
                if (intakeData.adjust_stock_ffa != null && !isNaN(intakeData.adjust_stock_ffa)) {
                    intakeData.official_ffa = intakeData.adjust_stock_ffa;
                    intakeData.supplier_intake_official_ffa_at = new Date().toISOString();
                }
            }
            var payload = {
                p_oil_id: null,
                p_batch_id: bn,
                p_production_date: data.date_received || data.received_date || null,
                p_status: data.status || 'awaiting_test',
                p_total_oil_litre: null,
                p_intake_data: intakeData
            };
            var uid = this.getCurrentUserId();
            if (uid) { payload.p_created_by = uid; payload.p_updated_by = uid; }
            var result = await this.callFunction('upsert_oil_batch', payload, token, { useCache: false });
            this.clearCachePattern('supplier_intake');
            this.clearCachePattern('oil_batches');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * Update a supplier intake batch (oil table). Calls upsert_oil_batch with p_oil_id so the existing oil row is updated.
         * @param {string} oilId - UUID of the oil row (batch.id from the grid)
         * @param {object} data - same shape as createSupplierIntakeBatch (product_type, date_received, delivery_note_ref, ...)
         * @param {string|null} token - auth token (optional)
         * @returns {Promise<object>} result from upsert_oil_batch
         */
        updateSupplierIntakeBatch: async function (oilId, data, token = null) {
            var intakeData = {
                date_received: data.date_received || data.received_date || null,
                delivery_note_reference: data.delivery_note_ref || null,
                delivery_note_ref: data.delivery_note_ref || null,
                supplier_id: data.supplier_id || null,
                supplier: data.supplier_details || null,
                supplier_details: data.supplier_details || null,
                product_type: data.product_type || null,
                quantity_kg: data.quantity_kg != null ? data.quantity_kg : data.wet_nis_received_kg,
                manufactured_date: data.manufactured_date || null,
                best_before_date: data.best_before_date || null,
                reference: data.reference || null,
                description: data.description || null,
                carton_bulk_bags: data.carton_bulk_bags != null ? data.carton_bulk_bags : 1,
                receiving_comments: data.receiving_comments || null,
                vehicle_clean: data.vehicle_clean,
                vehicle_enclosed: data.vehicle_enclosed,
                hazard_substances: data.hazard_substances,
                pest_infestations: data.pest_infestations,
                pallets_condition: data.pallets_condition,
                raw_materials_condition: data.raw_materials_condition,
                vehicle_checks: {
                    vehicle_clean: data.vehicle_clean,
                    vehicle_enclosed: data.vehicle_enclosed,
                    hazard_substances: data.hazard_substances,
                    pest_infestations: data.pest_infestations,
                    pallets_condition: data.pallets_condition,
                    raw_materials_condition: data.raw_materials_condition
                }
            };
            if (data.official_ffa != null && data.official_ffa !== '') intakeData.official_ffa = Number(data.official_ffa);
            if (data.supplier_intake_official_ffa_at) intakeData.supplier_intake_official_ffa_at = data.supplier_intake_official_ffa_at;
            if (data.ffa != null && data.ffa !== '') intakeData.ffa = Number(data.ffa);
            var payload = {
                p_oil_id: oilId,
                p_batch_id: data.batch_number || null,
                p_production_date: data.date_received || data.received_date || null,
                p_status: data.status || 'awaiting_test',
                p_total_oil_litre: null,
                p_intake_data: intakeData
            };
            var uid = this.getCurrentUserId();
            if (uid) payload.p_updated_by = uid;
            var result = await this.callFunction('upsert_oil_batch', payload, token, { useCache: false });
            this.clearCachePattern('supplier_intake');
            this.clearCachePattern('oil_batches');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * Remove a supplier intake batch from lists (soft: oil.is_active = false). Only awaiting_test / release_ready / legacy intake.
         */
        deactivateSupplierIntakeOilBatch: async function (oilId, token = null) {
            if (!oilId) {
                return { success: false, error: 'Batch id is required' };
            }
            var result = await this.callFunction('deactivate_supplier_intake_oil_batch', { p_oil_id: oilId }, token, { useCache: false });
            this.clearCachePattern('supplier_intake');
            this.clearCachePattern('supplier_intake_weekly_oil_rows');
            this.clearCachePattern('oil_batches');
            var resolved = result && (result.data !== undefined ? result.data : result);
            return resolved;
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

            const raw = await this.callFunction('get_oil_stock_lots', params, token, {
                cacheKey: `oil_stock_lots_${params.p_location_code || 'all'}_${params.p_stock_category || 'all'}_${params.p_status || 'all'}_${params.p_search || ''}_${params.p_offset}_${params.p_limit}`,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            return this._unwrapOilStockLotsRpc(raw);
        },

        /**
         * Ingredients / shift segments for an oil stock batch (oil_bin_batch + oil.production_data).
         */
        getOilBatchIngredientsDetail: async function (batchNumber, token = null) {
            const bn = batchNumber != null ? String(batchNumber).trim() : '';
            if (!bn) {
                return { success: false, error: 'Batch number is required' };
            }
            const raw = await this.callFunction('get_oil_batch_ingredients_detail', { p_batch_number: bn }, token, {
                useCache: false
            });
            return this._unwrapOilBatchIngredientsDetailRpc(raw);
        },

        _unwrapOilBatchIngredientsDetailRpc: function (raw) {
            if (raw == null) return { success: false, error: 'No response' };
            if (typeof raw.success === 'boolean' && (raw.batch_number !== undefined || raw.error)) return raw;
            var d = raw.data !== undefined ? raw.data : raw;
            if (typeof d === 'string') {
                try { d = JSON.parse(d); } catch (e) { return { success: false, error: 'Invalid response' }; }
            }
            if (d && d.get_oil_batch_ingredients_detail !== undefined) {
                var inner = d.get_oil_batch_ingredients_detail;
                if (typeof inner === 'string') {
                    try { inner = JSON.parse(inner); } catch (e2) { return { success: false, error: 'Invalid JSON' }; }
                }
                return inner;
            }
            if (d && typeof d.success === 'boolean') return d;
            return raw;
        },

        /** Normalize Lambda / PostgREST shapes for get_oil_stock_lots (TABLE / jsonb wrappers). */
        _unwrapOilStockLotsRpc: function (raw) {
            if (raw == null) return [];
            if (Array.isArray(raw)) return raw;
            var d = raw.data !== undefined ? raw.data : raw;
            if (typeof d === 'string') {
                try { d = JSON.parse(d); } catch (e) { return []; }
            }
            if (Array.isArray(d)) return d;
            if (d && Array.isArray(d.get_oil_stock_lots)) return d.get_oil_stock_lots;
            if (d && Array.isArray(d.rows)) return d.rows;
            if (d && Array.isArray(d.result)) return d.result;
            if (raw && Array.isArray(raw.get_oil_stock_lots)) return raw.get_oil_stock_lots;
            return [];
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

        /**
         * Match selected oil_stock_lots to public.oil (supplier intake) by batch_number → batch_id; set status production.
         * Requires migration release_oil_stock_lots_to_oil_production (see docs/MCP_RUN_OIL_STOCK_REDESIGN.md).
         */
        releaseOilStockLotsToOilProduction: async function (lotIds, token = null) {
            if (!lotIds || !Array.isArray(lotIds) || lotIds.length === 0) {
                return { success: false, error: 'No lot ids' };
            }
            const raw = await this.callFunction('release_oil_stock_lots_to_oil_production', { p_lot_ids: lotIds }, token, { useCache: false });
            this.clearCachePattern('oil_stock_lots');
            let r = raw && raw.data !== undefined ? raw.data : raw;
            if (typeof r === 'string') {
                try { r = JSON.parse(r); } catch (e) { r = { success: false, error: 'Invalid response' }; }
            }
            if (r && r.release_oil_stock_lots_to_oil_production) r = r.release_oil_stock_lots_to_oil_production;
            return r;
        },

        // Dashboard Functions (cached for 30 seconds - near real-time)
        getDashboardAlerts: async function (token = null, forceRefresh = false) {
            var raw = await this.callFunction('get_dashboard_alerts', {}, token, {
                cacheKey: 'dashboard_alerts_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dashboard,
                forceRefresh: forceRefresh
            });
            var list = [];
            if (Array.isArray(raw)) list = raw;
            else if (raw && Array.isArray(raw.get_dashboard_alerts)) list = raw.get_dashboard_alerts;
            else if (raw && Array.isArray(raw.data)) list = raw.data;
            return list.map(function (a) {
                return Object.assign({}, a, {
                    title: a.title || a.alert_title,
                    message: a.message != null ? a.message : a.alert_message
                });
            });
        },

        /**
         * Create a dashboard alert row (e.g. oil intake weight drop before production).
         * Requires DB function create_dashboard_alert_simple (see migrations).
         */
        createDashboardAlert: async function (opts, token = null) {
            if (!opts || !opts.title) {
                return { success: false, error: 'title is required' };
            }
            var params = {
                p_alert_title: opts.title,
                p_alert_message: opts.message != null ? opts.message : null,
                p_batch_number: opts.batch_number || null,
                p_alert_type: opts.alert_type || 'stock_low',
                p_severity: opts.severity || 'warning'
            };
            var result = await this.callFunction('create_dashboard_alert_simple', params, token, { useCache: false });
            if (typeof this.clearCache === 'function') this.clearCache('dashboard_alerts_list');
            var resolved = result && (result.data !== undefined ? result.data : result);
            return resolved || result;
        },

        /**
         * Release supplier oil batch to production after recording weight before production (merged into intake_data).
         * If first_weight_kg - weight_before_production_kg > 50, creates a dashboard alert.
         */
        releaseSupplierIntakeToProductionWithWeights: async function (oilId, opts, token = null) {
            if (!oilId || !opts || opts.weight_before_production_kg == null || opts.weight_before_production_kg === '') {
                return { success: false, error: 'Oil id and weight before production are required' };
            }
            var w2 = Number(opts.weight_before_production_kg);
            if (isNaN(w2) || w2 < 0) {
                return { success: false, error: 'Weight before production must be a valid number (kg)' };
            }
            var row = await this.getOilBatchById(oilId, token);
            var intake = row && row.intake_data;
            if (typeof intake === 'string') {
                try { intake = JSON.parse(intake); } catch (e) { intake = {}; }
            }
            if (!intake || typeof intake !== 'object') intake = {};
            var firstKg = opts.first_weight_kg != null && !isNaN(Number(opts.first_weight_kg))
                ? Number(opts.first_weight_kg)
                : (intake.quantity_kg != null ? Number(intake.quantity_kg) : NaN);
            var receivingSnapshot = !isNaN(firstKg) ? firstKg : null;
            var merged = Object.assign({}, intake, {
                weight_before_production_kg: w2,
                weight_before_production_recorded_at: new Date().toISOString(),
                weight_at_intake_for_comparison_kg: receivingSnapshot != null
                    ? receivingSnapshot
                    : (intake.weight_at_intake_for_comparison_kg != null && !isNaN(Number(intake.weight_at_intake_for_comparison_kg))
                        ? Number(intake.weight_at_intake_for_comparison_kg)
                        : null),
                quantity_kg: w2
            });
            var uid = this.getCurrentUserId();
            var upsertParams = {
                p_oil_id: oilId,
                p_status: 'production',
                p_intake_data: merged
            };
            if (uid) upsertParams.p_updated_by = uid;
            var result = await this.callFunction('upsert_oil_batch', upsertParams, token, { useCache: false });
            var resolved = result && (result.data !== undefined ? result.data : result);
            if (!resolved || resolved.success === false) {
                this.clearCachePattern('supplier_intake');
                this.clearCachePattern('oil_batches');
                this.clearCachePattern('oil_production');
                return resolved || { success: false, error: 'Release failed' };
            }
            this.clearCachePattern('supplier_intake');
            this.clearCachePattern('supplier_intake_weekly_oil_rows');
            this.clearCachePattern('oil_batches');
            this.clearCachePattern('oil_production');
            if (receivingSnapshot != null && receivingSnapshot - w2 > 50) {
                var bn = opts.batch_number || (row && row.batch_id) || '';
                var msg = 'Weight before production (' + w2 + ' kg) is more than 50 kg below receiving weight (' + receivingSnapshot + ' kg) for batch ' + bn + '.';
                try {
                    await this.createDashboardAlert({
                        title: 'Oil intake: large weight loss before production',
                        message: msg,
                        batch_number: bn || null,
                        alert_type: 'stock_low',
                        severity: 'warning'
                    }, token);
                } catch (alertErr) {
                    console.warn('[releaseSupplierIntakeToProductionWithWeights] Dashboard alert failed:', alertErr);
                }
            }
            return result;
        },

        getExecutiveKPIs: async function (token = null, forceRefresh = false) {
            var raw = await this.callFunction('get_executive_kpis', {}, token, {
                cacheKey: 'executive_kpis',
                useCache: true,
                cacheTtl: this.cache.ttl.dashboard,
                forceRefresh: forceRefresh
            });
            var row = null;
            if (Array.isArray(raw) && raw[0]) row = raw[0];
            else if (raw && Array.isArray(raw.get_executive_kpis) && raw.get_executive_kpis[0]) row = raw.get_executive_kpis[0];
            else if (raw && raw.active_batches !== undefined) row = raw;
            var defaults = { total_production_kg: 0, active_batches: 0, total_sales: 0, quality_pass_rate: 0 };
            if (!row) return defaults;
            return {
                total_production_kg: Number(row.total_production_kg) || 0,
                active_batches: Number(row.active_batches) || 0,
                total_sales: Number(row.total_sales) || 0,
                quality_pass_rate: Number(row.quality_pass_rate) || 0
            };
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

        // ── Oil / Shift / Product / Oil Bin functions ────────────────────────

        /**
         * Upsert batch (batches table). Step 1 for oil: call this then upsertOilBatch with returned batch_id.
         * @param {object} data - { batch_id (optional), batch_type: 'oil'|'kernel', is_active (optional) }
         * @param {string|null} token - auth token (optional)
         * @returns {Promise<object>} { success, id, batch_id } or { success: false, error }
         */
        upsertBatch: async function (data, token = null) {
            var params = {
                p_batch_id:   data.batch_id   || null,
                p_batch_type: data.batch_type || 'oil',
                p_is_active:  data.is_active !== undefined ? data.is_active : true
            };
            const result = await this.callFunction('upsert_batch', params, token, { useCache: false });
            this.clearCachePattern('batches');
            this.clearCachePattern('oil_batches');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * Initialize a kernel row (status='intake') for a batch UUID.
         * Idempotent — safe to call if the kernel row already exists.
         * @param {object} data - { batch_uuid (required), supplier_id, grower_name, received_date, wet_nis_received_kg }
         * @param {string|null} token
         * @returns {Promise<object>} { success, id, batch_uuid, existing? }
         */
        initializeKernelForBatch: async function (data, token = null) {
            var params = {
                p_batch_uuid:          data.batch_uuid,
                p_supplier_id:         data.supplier_id          || null,
                p_grower_name:         data.grower_name          || null,
                p_received_date:       data.received_date        || null,
                p_wet_nis_received_kg: data.wet_nis_received_kg != null ? data.wet_nis_received_kg : null
            };
            const result = await this.callFunction('initialize_kernel_for_batch', params, token, { useCache: false });
            this.clearCachePattern('kernel_batches');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * Save a ziplock or 5kg sample into kernel.intake_data JSONB.
         * Writes to the kernel table directly — does NOT touch production_batches or sample_submissions.
         * @param {object} data - { kernel_id (required), sample_type ('ziplock'|'5kg'), ...fields }
         * @param {string|null} token
         * @returns {Promise<object>} { success, kernel_id, sample_type }
         */
        saveKernelIntakeSample: async function (data, token = null) {
            var params = {
                p_kernel_id:                  data.kernel_id,
                p_sample_type:                data.sample_type,
                p_moisture_required:          data.moisture_required          != null ? data.moisture_required          : null,
                p_moisture_result:            data.moisture_result            != null ? data.moisture_result            : null,
                p_peroxide_required:          data.peroxide_required          != null ? data.peroxide_required          : null,
                p_peroxide_result:            data.peroxide_result            != null ? data.peroxide_result            : null,
                p_ffa_required:               data.ffa_required               != null ? data.ffa_required               : null,
                p_ffa_result:                 data.ffa_result                 != null ? data.ffa_result                 : null,
                p_wet_nut_in_shell_kg:        data.wet_nut_in_shell_kg        != null ? data.wet_nut_in_shell_kg        : null,
                p_crack_out_sound_kernel_g:   data.crack_out_sound_kernel_g   != null ? data.crack_out_sound_kernel_g   : null,
                p_crack_out_unsound_kernel_g: data.crack_out_unsound_kernel_g != null ? data.crack_out_unsound_kernel_g : null,
                p_crack_out_shell_g:          data.crack_out_shell_g          != null ? data.crack_out_shell_g          : null,
                p_float_floating_g:           data.float_floating_g           != null ? data.float_floating_g           : null,
                p_float_sinking_g:            data.float_sinking_g            != null ? data.float_sinking_g            : null,
                p_unsound_germination_g:      data.unsound_germination_g      != null ? data.unsound_germination_g      : null,
                p_unsound_late_stinkbug_g:    data.unsound_late_stinkbug_g    != null ? data.unsound_late_stinkbug_g    : null,
                p_unsound_early_stinkbug_g:   data.unsound_early_stinkbug_g   != null ? data.unsound_early_stinkbug_g   : null,
                p_unsound_dark_centre_g:      data.unsound_dark_centre_g      != null ? data.unsound_dark_centre_g      : null,
                p_unsound_mould_g:            data.unsound_mould_g            != null ? data.unsound_mould_g            : null,
                p_unsound_rotten_g:           data.unsound_rotten_g           != null ? data.unsound_rotten_g           : null,
                p_unsound_immature_split_g:   data.unsound_immature_split_g   != null ? data.unsound_immature_split_g   : null,
                p_unsound_shrivelled_g:       data.unsound_shrivelled_g       != null ? data.unsound_shrivelled_g       : null,
                p_unsound_nut_borer_g:        data.unsound_nut_borer_g        != null ? data.unsound_nut_borer_g        : null
            };
            const result = await this.callFunction('save_kernel_intake_sample', params, token, { useCache: false });
            this.clearCachePattern('kernel_batches');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * Upsert receiving checklist into kernel.intake_data.receiving_checklist JSONB.
         * Also sets kernel.actual_wet_nis_kg from the sum of received_items.
         * @param {object} data - { kernel_id, date_received, delivery_note_ref, supplier_id,
         *   vehicle_clean, vehicle_enclosed, hazard_substances, pest_infestations,
         *   pallets_condition, raw_materials_condition, comments, received_items[] }
         * @param {string|null} token
         * @returns {Promise<object>} { success, kernel_id, total_kg }
         */
        upsertKernelChecklist: async function (data, token = null) {
            var params = {
                p_kernel_id:               data.kernel_id,
                p_date_received:           data.date_received           || null,
                p_delivery_note_ref:       data.delivery_note_ref       || null,
                p_supplier_id:             data.supplier_id             || null,
                p_vehicle_clean:           data.vehicle_clean           || null,
                p_vehicle_enclosed:        data.vehicle_enclosed        || null,
                p_hazard_substances:       data.hazard_substances       || null,
                p_pest_infestations:       data.pest_infestations       || null,
                p_pallets_condition:       data.pallets_condition       || null,
                p_raw_materials_condition: data.raw_materials_condition || null,
                p_comments:               data.comments                || null,
                p_received_items:         data.received_items          || [],
                p_removed_pre_sizer_kg:   data.removed_pre_sizer_kg    != null ? data.removed_pre_sizer_kg : null
            };
            const result = await this.callFunction('upsert_kernel_checklist', params, token, { useCache: false });
            this.clearCachePattern('kernel_batches');
            this.clearCachePattern('kernel_batch_detail');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * Release a kernel batch to production.
         * Validates both ziplock_sample and five_kg_sample are saved, then sets status = 'production'.
         * Optionally assigns silos when data.silos (integer[]) is provided.
         * @param {object} data - { kernel_id [, silos ] }
         * @returns {Promise<object>} { success, kernel_id } or { success: false, error }
         */
        releaseKernelToProduction: async function (data, token = null) {
            const params = { p_kernel_id: data.kernel_id };
            if (Array.isArray(data.silos) && data.silos.length > 0) {
                params.p_silos = data.silos;
            }
            const result = await this.callFunction('release_kernel_to_production', params, token, { useCache: false });
            this.clearCachePattern('kernel_batches');
            this.clearCachePattern('silos');
            return result && (result.data !== undefined ? result.data : result);
        },

        /** Get silo status for all 12 silos (kernel + oil). Used by Grower Intake silo picker and Kernel Production silo grid. */
        getSilos: async function (token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_silos', {}, token, {
                cacheKey: 'silos_list',
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && raw.get_silos) return Array.isArray(raw.get_silos) ? raw.get_silos : [raw.get_silos];
            return [];
        },

        /** Mark a silo (1-12) as empty. Used from Kernel Production silo grid. */
        setSiloEmpty: async function (siloNumber, token = null) {
            const result = await this.callFunction('set_silo_empty', { p_silo_number: siloNumber }, token, { useCache: false });
            this.clearCachePattern('silos');
            return result && (result.data !== undefined ? result.data : result);
        },

        /** Assign a kernel batch to one or more silos (1-12). Call after releaseKernelToProduction. */
        assignKernelToSilos: async function (kernelId, siloNumbers, token = null) {
            if (!Array.isArray(siloNumbers) || siloNumbers.length === 0) return { success: true, silos_assigned: 0 };
            const result = await this.callFunction('assign_kernel_to_silos', {
                p_kernel_id: kernelId,
                p_silo_numbers: siloNumbers
            }, token, { useCache: false });
            this.clearCachePattern('silos');
            this.clearCachePattern('kernel_batches');
            return result && (result.data !== undefined ? result.data : result);
        },

        getOilBatches: async function (options = {}, token = null, forceRefresh = false) {
            var params = {};
            if (options.status) params.p_status = options.status;
            if (options.search) params.p_search = options.search;
            if (options.limit)  params.p_limit  = options.limit;
            if (options.offset) params.p_offset = options.offset;
            return await this.callFunction('get_oil_batches', params, token, {
                cacheKey: 'oil_batches' + (options.status ? '_' + options.status : ''),
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },

        /**
         * Oil Production: mark a raw ingredient bag as emptied (status production → raw_empty).
         */
        markOilRawIngredientEmpty: async function (oilId, token = null) {
            if (!oilId) return { success: false, error: 'oilId required' };
            var params = { p_oil_id: oilId };
            var uid = this.getCurrentUserId();
            if (uid) params.p_updated_by = uid;
            const result = await this.callFunction('mark_oil_raw_ingredient_empty', params, token, { useCache: false });
            this.clearCachePattern('oil_batches');
            return result && (result.data !== undefined ? result.data : result);
        },

        getOilBatchById: async function (oilId, token = null) {
            if (!oilId) return null;
            var raw = await this.callFunction('get_oil_batch_by_id', { p_oil_id: oilId }, token, { useCache: false });
            if (raw && Array.isArray(raw) && raw.length > 0) return raw[0];
            if (raw && raw.get_oil_batch_by_id && Array.isArray(raw.get_oil_batch_by_id) && raw.get_oil_batch_by_id.length > 0) return raw.get_oil_batch_by_id[0];
            return null;
        },

        upsertOilBatch: async function (data, token = null) {
            var params = {
                p_oil_id:                   data.oil_id                   || null,
                p_batch_id:                 data.batch_id                  || null,
                p_production_date:          data.production_date           || null,
                p_status:                   data.status                    || null,
                p_total_oil_litre:          data.total_oil_litre           != null ? data.total_oil_litre : null,
                p_intake_data:              data.intake_data               || null,
                p_production_data:          data.production_data           || null,
                p_stock_data:               data.stock_data                || null,
                p_dispatch_data:            data.dispatch_data             || null,
                p_intake_completed_at:      data.intake_completed_at       || null,
                p_production_completed_at:  data.production_completed_at   || null,
                p_stock_completed_at:       data.stock_completed_at        || null,
                p_dispatch_completed_at:    data.dispatch_completed_at     || null
            };
            var uid = this.getCurrentUserId();
            if (uid) {
                params.p_updated_by = uid;
                if (!data.oil_id) params.p_created_by = uid;
            }
            const result = await this.callFunction('upsert_oil_batch', params, token, { useCache: false });
            this.clearCachePattern('oil_batches');
            this.clearCachePattern('oil_production_sheets');
            return result;
        },

        getShiftList: async function (options = {}, token = null, forceRefresh = false) {
            var params = {};
            if (options.date_from) params.p_date_from = options.date_from;
            if (options.date_to)   params.p_date_to   = options.date_to;
            if (options.search)    params.p_search    = options.search;
            if (options.limit)     params.p_limit     = options.limit;
            if (options.offset)    params.p_offset    = options.offset;
            return await this.callFunction('get_shift_list', params, token, {
                cacheKey: 'shift_list',
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
        },

        upsertShift: async function (data, token = null) {
            var params = {
                p_shift_id:       data.shift_id       || null,
                p_shift_date:     data.shift_date      || null,
                p_shift_name:     data.shift_name      || null,
                p_shift_supervisor: data.shift_supervisor || null,
                p_shift_tracking: data.shift_tracking  || null
            };
            const result = await this.callFunction('upsert_shift', params, token, { useCache: false });
            this.clearCachePattern('shift_list');
            return result;
        },

        /**
         * After saving person on duty: link shift + raw-ingredient snapshot to all oil_bin_batch rows in_production.
         */
        syncOilProductionDutyAudit: async function (shiftId, token = null) {
            if (!shiftId) return { success: false, error: 'shiftId required' };
            const result = await this.callFunction('sync_oil_production_duty_audit', { p_shift_id: shiftId }, token, { useCache: false });
            this.clearCachePattern('oil_bin_batches');
            this.clearCachePattern('oil_bin_batches_v2');
            this.clearCachePattern('oil_bin_batches_v3');
            this.clearCachePattern('oil_bin_batches_v4');
            return result && (result.data !== undefined ? result.data : result);
        },

        getProductList: async function (options = {}, token = null, forceRefresh = false) {
            var params = {};
            if (options.type)   params.p_type   = options.type;
            if (options.search) params.p_search = options.search;
            if (options.limit)  params.p_limit  = options.limit;
            if (options.offset) params.p_offset = options.offset;
            return await this.callFunction('get_product_list', params, token, {
                cacheKey: 'product_list' + (options.type ? '_' + options.type : ''),
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        upsertProduct: async function (data, token = null) {
            var params = {
                p_product_id:    data.product_id    || null,
                p_product_name:  data.product_name  || null,
                p_product_type:  data.product_type  || null,
                p_product_specs: data.product_specs || null
            };
            const result = await this.callFunction('upsert_product', params, token, { useCache: false });
            this.clearCachePattern('product_list');
            return result;
        },

        getOilBinList: async function (options = {}, token = null, forceRefresh = false) {
            var params = {};
            if (options.search) params.p_search = options.search;
            if (options.limit)  params.p_limit  = options.limit;
            if (options.offset) params.p_offset = options.offset;
            return await this.callFunction('get_oil_bin_list', params, token, {
                cacheKey: 'oil_bin_list',
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
        },

        upsertOilBin: async function (data, token = null) {
            var params = {
                p_bin_id:       data.bin_id       || null,
                p_bin_name:     data.bin_name      || null,
                p_start_oil_bn: data.start_oil_bn  || null,
                p_bin_data:     data.bin_data       || null
            };
            const result = await this.callFunction('upsert_oil_bin', params, token, { useCache: false });
            this.clearCachePattern('oil_bin_list');
            return result;
        },

        getOilBinBatches: async function (options = {}, token = null, forceRefresh = false) {
            var params = { p_limit: options.limit || 100, p_offset: options.offset || 0 };
            if (options.status !== undefined && options.status !== null && options.status !== '') {
                params.p_status = options.status;
            }
            var raw = await this.callFunction('get_oil_bin_batches', params, token, {
                cacheKey: 'oil_bin_batches_v4' + (options.status ? '_' + options.status : ''),
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            return this._unwrapOilBinBatchesRpc(raw);
        },

        /** Normalize Lambda / PostgREST shapes so the grid always sees an array or { get_oil_bin_batches } */
        _unwrapOilBinBatchesRpc: function (raw) {
            if (raw == null) return raw;
            if (Array.isArray(raw)) return raw;
            if (raw.get_oil_bin_batches && Array.isArray(raw.get_oil_bin_batches)) return raw;
            if (raw.data && raw.data.get_oil_bin_batches && Array.isArray(raw.data.get_oil_bin_batches)) {
                return { get_oil_bin_batches: raw.data.get_oil_bin_batches };
            }
            if (raw.data && Array.isArray(raw.data)) return raw.data;
            if (raw.result && Array.isArray(raw.result)) return { get_oil_bin_batches: raw.result };
            if (raw.rows && Array.isArray(raw.rows)) return { get_oil_bin_batches: raw.rows };
            return raw;
        },

        /**
         * Start a new oil bin batch.
         * @param {string|Date|null|object} first - Options: { batchNumber, startDate, oilStream } / { p_batch_number, p_start_date, p_stream } (aliases accepted). Legacy: date string as first arg.
         * @param {string|null} second - Auth token when first is options object or date
         */
        startOilBinBatch: async function (first, second) {
            var pStart = null;
            var pStream = null;
            var pBatchNumber = null;
            var token = null;
            if (first !== undefined && first !== null && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Date)) {
                token = second;
                if (first.p_start_date != null) pStart = first.p_start_date;
                if (first.startDate != null) pStart = first.startDate;
                if (first.p_stream != null) pStream = first.p_stream;
                if (first.p_oil_stream != null) pStream = first.p_oil_stream;
                if (first.oilStream != null) pStream = first.oilStream;
                if (first.p_batch_number != null) pBatchNumber = first.p_batch_number;
                if (first.batchNumber != null) pBatchNumber = first.batchNumber;
            } else {
                token = second;
                if (first !== undefined && first !== null && first !== '') {
                    pStart = first instanceof Date ? first.toISOString().split('T')[0] : first;
                }
            }
            var bn = pBatchNumber != null && String(pBatchNumber).trim() !== '' ? String(pBatchNumber).trim() : null;
            var params = { p_batch_number: bn, p_start_date: pStart, p_stream: pStream };
            const result = await this.callFunction('start_oil_bin_batch', params, token, { useCache: false });
            this.clearCachePattern('oil_bin_batches');
            this.clearCachePattern('oil_bin_batches_v2');
            this.clearCachePattern('oil_bin_batches_v3');
            this.clearCachePattern('oil_bin_batches_v4');
            return result;
        },

        sendOilBinBatchToStock: async function (oilBinBatchId, token = null) {
            const result = await this.callFunction('send_oil_bin_batch_to_stock', { p_oil_bin_batch_id: oilBinBatchId }, token, { useCache: false });
            var resolved = result && (result.data !== undefined ? result.data : result);
            if (typeof resolved === 'string') {
                try { resolved = JSON.parse(resolved); } catch (e) { resolved = result; }
            }
            if (resolved && resolved.send_oil_bin_batch_to_stock) {
                resolved = resolved.send_oil_bin_batch_to_stock;
            }
            if (resolved && resolved.success !== false && !resolved.error) {
                this.clearCachePattern('oil_bin_batches');
                this.clearCachePattern('oil_bin_batches_v2');
                this.clearCachePattern('oil_bin_batches_v3');
                this.clearCachePattern('oil_bin_batches_v4');
                this.clearCachePattern('oil_batches');
                this.clearCachePattern('oil_stock_lots');
                this.clearCachePattern('oil_stock_summary');
            }
            return resolved != null ? resolved : result;
        },

        deleteOilBinBatch: async function (oilBinBatchId, token = null) {
            const result = await this.callFunction('delete_oil_bin_batch', { p_oil_bin_batch_id: oilBinBatchId }, token, { useCache: false });
            var resolved = result && (result.data !== undefined ? result.data : result);
            if (typeof resolved === 'string') {
                try { resolved = JSON.parse(resolved); } catch (e) { resolved = result; }
            }
            if (resolved && resolved.delete_oil_bin_batch) {
                resolved = resolved.delete_oil_bin_batch;
            }
            if (resolved && resolved.success !== false && !resolved.error) {
                this.clearCachePattern('oil_bin_batches');
                this.clearCachePattern('oil_bin_batches_v2');
                this.clearCachePattern('oil_bin_batches_v3');
                this.clearCachePattern('oil_bin_batches_v4');
                this.clearCachePattern('oil_production');
            }
            return resolved != null ? resolved : result;
        },

        /**
         * Record FFA lab test on an in-production oil bin batch (updates ffa %, ffa_test_at, ffa_test_pass).
         */
        recordOilBinBatchFfaTest: async function (binId, ffaPct, pass, token = null) {
            var pPass = pass === true ? true : pass === false ? false : null;
            const result = await this.callFunction(
                'record_oil_bin_batch_ffa_test',
                { p_bin_id: binId, p_ffa_pct: ffaPct != null ? Number(ffaPct) : null, p_pass: pPass },
                token,
                { useCache: false }
            );
            if (result && result.success) {
                this.clearCachePattern('oil_bin_batches');
                this.clearCachePattern('oil_bin_batches_v2');
                this.clearCachePattern('oil_bin_batches_v3');
                this.clearCachePattern('oil_bin_batches_v4');
            }
            return result;
        },

        updateOilBinBatch: async function (data, token = null) {
            var params = {
                p_id: data.id,
                p_shifts: data.shifts ?? null,
                p_ingredients: data.ingredients ?? null,
                p_letrerage: data.letrerage != null ? data.letrerage : null,
                p_ffa: data.ffa != null ? data.ffa : null
            };
            var os = data.p_oil_stream != null ? data.p_oil_stream : data.oilStream;
            if (os !== undefined && os !== null && String(os).trim() !== '') {
                params.p_oil_stream = String(os).trim();
            }
            var seg = data.p_shift_segments != null ? data.p_shift_segments : data.shift_segments != null ? data.shift_segments : data.shiftSegments;
            if (seg !== undefined && seg !== null) {
                if (typeof seg === 'string') {
                    try {
                        params.p_shift_segments = JSON.parse(seg);
                    } catch (e) {
                        params.p_shift_segments = [];
                    }
                } else {
                    params.p_shift_segments = seg;
                }
            }
            const result = await this.callFunction('update_oil_bin_batch', params, token, { useCache: false });
            if (result && result.success) {
                this.clearCachePattern('oil_bin_batches');
                this.clearCachePattern('oil_bin_batches_v2');
                this.clearCachePattern('oil_bin_batches_v3');
                this.clearCachePattern('oil_bin_batches_v4');
            }
            return result;
        },

        /**
         * Link raw ingredient supplier batches (oil rows in production) to an oil bin for traceability.
         * Uses DB function set_oil_bin_batch_raw_ingredient_links (not update_oil_bin_batch) so PostgREST
         * does not require an extended update_oil_bin_batch signature on the server.
         */
        setOilBinBatchRawIngredientLinks: async function (oilBinBatchId, rawIngredientAudit, ingredientsText, token = null) {
            var params = {
                p_oil_bin_batch_id: oilBinBatchId,
                p_raw_ingredient_audit: rawIngredientAudit != null ? rawIngredientAudit : []
            };
            if (ingredientsText !== undefined) {
                params.p_ingredients = ingredientsText === null ? null : String(ingredientsText);
            }
            const result = await this.callFunction('set_oil_bin_batch_raw_ingredient_links', params, token, { useCache: false });
            if (result && result.success) {
                this.clearCachePattern('oil_bin_batches');
                this.clearCachePattern('oil_bin_batches_v2');
                this.clearCachePattern('oil_bin_batches_v3');
                this.clearCachePattern('oil_bin_batches_v4');
            }
            return result;
        },

        getProteinBinBatches: async function (options = {}, token = null, forceRefresh = false) {
            var params = { p_limit: options.limit || 100, p_offset: options.offset || 0 };
            if (options.status !== undefined && options.status !== null && options.status !== '') {
                params.p_status = options.status;
            }
            var raw = await this.callFunction('get_protein_bin_batches', params, token, {
                cacheKey: 'protein_bin_batches_v1' + (options.status ? '_' + options.status : ''),
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            return this._unwrapProteinBinBatchesRpc(raw);
        },
        _unwrapProteinBinBatchesRpc: function (raw) {
            if (raw == null) return raw;
            if (Array.isArray(raw)) return raw;
            if (raw.get_protein_bin_batches && Array.isArray(raw.get_protein_bin_batches)) return raw;
            if (raw.data && raw.data.get_protein_bin_batches && Array.isArray(raw.data.get_protein_bin_batches)) {
                return { get_protein_bin_batches: raw.data.get_protein_bin_batches };
            }
            if (raw.data && Array.isArray(raw.data)) return raw.data;
            if (raw.result && Array.isArray(raw.result)) return { get_protein_bin_batches: raw.result };
            if (raw.rows && Array.isArray(raw.rows)) return { get_protein_bin_batches: raw.rows };
            return raw;
        },
        /**
         * Start a protein bin batch. Pass { batchNumber, startDate } or { p_batch_number, p_start_date }.
         * Legacy: (startDate, token) without batch number is no longer supported — batch number is required.
         */
        startProteinBinBatch: async function (first, second) {
            var pStart = null;
            var pBatchNumber = null;
            var token = null;
            if (first !== undefined && first !== null && typeof first === 'object' && !Array.isArray(first) && !(first instanceof Date)) {
                token = second;
                if (first.p_batch_number != null) pBatchNumber = first.p_batch_number;
                if (first.batchNumber != null) pBatchNumber = first.batchNumber;
                if (first.p_start_date != null) pStart = first.p_start_date;
                if (first.startDate != null) pStart = first.startDate;
            } else {
                token = second;
                if (first !== undefined && first !== null && first !== '') {
                    pStart = first instanceof Date ? first.toISOString().split('T')[0] : first;
                }
            }
            var bn = pBatchNumber != null && String(pBatchNumber).trim() !== '' ? String(pBatchNumber).trim() : null;
            var params = { p_batch_number: bn };
            if (pStart != null && pStart !== '') {
                params.p_start_date = pStart instanceof Date ? pStart.toISOString().split('T')[0] : pStart;
            }
            const result = await this.callFunction('start_protein_bin_batch', params, token, { useCache: false });
            this.clearCachePattern('protein_bin_batches');
            return result;
        },
        updateProteinBinBatch: async function (data, token = null) {
            const result = await this.callFunction(
                'update_protein_bin_batch',
                {
                    p_id: data.id,
                    p_ingredients: data.ingredients !== undefined ? data.ingredients : null,
                    p_batch_weight_kg: data.batch_weight_kg != null ? Number(data.batch_weight_kg) : null
                },
                token,
                { useCache: false }
            );
            var resolved = result && (result.data !== undefined ? result.data : result);
            if (typeof resolved === 'string') {
                try { resolved = JSON.parse(resolved); } catch (e) { resolved = result; }
            }
            if (resolved && resolved.success !== false && !resolved.error) this.clearCachePattern('protein_bin_batches');
            return resolved != null ? resolved : result;
        },
        setProteinBinBatchRawIngredientLinks: async function (proteinBinBatchId, rawIngredientAudit, ingredientsText, token = null) {
            var params = {
                p_protein_bin_batch_id: proteinBinBatchId,
                p_raw_ingredient_audit: rawIngredientAudit != null ? rawIngredientAudit : []
            };
            if (ingredientsText !== undefined) {
                params.p_ingredients = ingredientsText === null ? null : String(ingredientsText);
            }
            const result = await this.callFunction('set_protein_bin_batch_raw_ingredient_links', params, token, { useCache: false });
            if (result && result.success) this.clearCachePattern('protein_bin_batches');
            return result;
        },
        sendProteinBinBatchToStock: async function (proteinBinBatchId, token = null) {
            const result = await this.callFunction('send_protein_bin_batch_to_stock', { p_protein_bin_batch_id: proteinBinBatchId }, token, { useCache: false });
            var resolved = result && (result.data !== undefined ? result.data : result);
            if (typeof resolved === 'string') {
                try { resolved = JSON.parse(resolved); } catch (e) { resolved = result; }
            }
            if (resolved && resolved.send_protein_bin_batch_to_stock) {
                resolved = resolved.send_protein_bin_batch_to_stock;
            }
            if (resolved && resolved.success !== false && !resolved.error) {
                this.clearCachePattern('protein_bin_batches');
                this.clearCachePattern('oil_stock_lots');
                this.clearCachePattern('oil_stock_summary');
            }
            return resolved != null ? resolved : result;
        },
        // ─────────────────────────────────────────────────────────────────────

        // Kernel Production Job Card Functions
        // DB create_kernel_job_card does not accept p_id or p_production_batch_id; PostgREST requires exact param match.
        createKernelJobCard: async function (jobCardData, token = null) {
            const allowedKeys = [
                'p_batch_number', 'p_received_date', 'p_total_weight_kg', 'p_supplier_id', 'p_supplier_name',
                'p_removed_pre_sizer_kg', 'p_balance_kg', 'p_receiving_moisture_percentage', 'p_packing_moisture_percentage', 'p_removed_moisture_percentage',
                'p_packing_start_date', 'p_packing_completion_date', 'p_best_before_date',
                'p_sound_kernel_styles', 'p_sound_kernel_total_cartons', 'p_sound_kernel_total_kg',
                'p_butter_grade_styles', 'p_butter_grade_total_cartons', 'p_butter_grade_total_kg',
                'p_waste_oil_kernel_kg', 'p_waste_shell_fines_kg', 'p_waste_compost_kg', 'p_waste_shell_kg',
                'p_mass_balance_in_kg', 'p_mass_balance_out_kg', 'p_mass_balance_percentage'
            ];
            const payload = {};
            if (jobCardData && typeof jobCardData === 'object') {
                allowedKeys.forEach(function (k) {
                    if (Object.prototype.hasOwnProperty.call(jobCardData, k)) payload[k] = jobCardData[k];
                });
            }
            const result = await this.callFunction('create_kernel_job_card', payload, token, { useCache: false });
            this.clearCachePattern('stock_items');
            this.clearCachePattern('kernel_job_card');
            this.clearCachePattern('kernel_production');
            return result;
        },

        getKernelJobCards: async function (token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_kernel_job_cards', {}, token, {
                cacheKey: 'kernel_job_cards',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && raw.get_kernel_job_cards) return Array.isArray(raw.get_kernel_job_cards) ? raw.get_kernel_job_cards : [];
            return [];
        },

        getKernelJobCard: async function (jobCardId, token = null) {
            const raw = await this.callFunction('get_kernel_job_card', { p_id: jobCardId }, token, { useCache: false });
            if (raw && (raw.batch_number || raw.id)) return raw;
            if (raw && raw.get_kernel_job_card) return raw.get_kernel_job_card;
            return raw;
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
            // Map frontend keys to DB function params (p_ prefix) so PostgREST finds the function
            const params = {
                p_kernel_production_day_id: payload.kernel_production_day_id,
                p_batch_number: payload.batch_number != null ? payload.batch_number : null,
                p_grower_name: payload.grower_name != null ? payload.grower_name : null,
                p_cracking_data: payload.cracking_data != null ? payload.cracking_data : {},
                p_washing_data: payload.washing_data != null ? payload.washing_data : {},
                p_sorting_data: payload.sorting_data != null ? payload.sorting_data : {},
                p_packing_data: payload.packing_data != null ? payload.packing_data : {},
                p_summary_data: payload.summary_data != null ? payload.summary_data : {}
            };
            const result = await this.callFunction('save_kernel_production_stages', params, token, { useCache: false });
            this.clearCachePattern('kernel_production');
            return result;
        },

        finishKernelBatchProduction: async function (batchId, token = null) {
            const result = await this.callFunction('finish_kernel_batch_production', { p_batch_id: batchId }, token, { useCache: false });
            this.clearCachePattern('kernel_production');
            this.clearCachePattern('production_batches');
            return result;
        },

        getKernelPackingSamples: async function (token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_kernel_packing_samples', {}, token, {
                cacheKey: 'kernel_packing_samples_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && Array.isArray(raw.get_kernel_packing_samples)) return raw.get_kernel_packing_samples;
            return [];
        },

        getKernelPackingSample: async function (packingSampleId, token = null) {
            if (!packingSampleId) return null;
            return await this.callFunction('get_kernel_packing_sample', { p_id: packingSampleId }, token, { useCache: false });
        },

        createKernelPackingSample: async function (data, token = null) {
            const result = await this.callFunction('create_kernel_packing_sample', data, token, { useCache: false });
            this.clearCachePattern('kernel_packing');
            this.clearCachePattern('kernel_production');
            this.clearCachePattern('production_batches');
            return result;
        },

        createKernelDispatchOrder: async function (payload, token = null) {
            const params = {
                p_buyer_name: payload.buyer_name || null,
                p_delivery_date: payload.delivery_date || null,
                p_best_before_date: payload.best_before_date || null,
                p_buyer_contact_id: payload.buyer_contact_id || null,
                p_lines: Array.isArray(payload.lines) ? payload.lines : []
            };
            const result = await this.callFunction('create_kernel_dispatch_order', params, token, { useCache: false });
            this.clearCachePattern('kernel_dispatch_orders_list');
            return result;
        },

        updateKernelDispatchOrderCartons: async function (orderId, lines, token = null) {
            const params = {
                p_order_id: orderId,
                p_lines: Array.isArray(lines) ? lines : []
            };
            const result = await this.callFunction('update_kernel_dispatch_order_cartons', params, token, { useCache: false });
            this.clearCachePattern('kernel_dispatch_orders_list');
            return result;
        },

        /** Update buyer, delivery/best-before dates, and line cartons (not allowed after dispatched). */
        updateKernelDispatchOrder: async function (payload, token = null) {
            const params = {
                p_order_id: payload.order_id || null,
                p_buyer_name: payload.buyer_name != null ? payload.buyer_name : null,
                p_delivery_date: payload.delivery_date || null,
                p_best_before_date: payload.best_before_date != null ? payload.best_before_date : null,
                p_lines: Array.isArray(payload.lines) ? payload.lines : []
            };
            const result = await this.callFunction('update_kernel_dispatch_order', params, token, { useCache: false });
            this.clearCachePattern('kernel_dispatch_orders_list');
            return result;
        },

        getKernelDispatchOrders: async function (token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_kernel_dispatch_orders', { p_limit: 100, p_offset: 0 }, token, {
                cacheKey: 'kernel_dispatch_orders_list',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            if (raw && raw.success !== false && Array.isArray(raw.data)) return raw.data;
            if (raw && raw.data) return raw.data;
            return [];
        },

        getKernelDispatchOrder: async function (orderId, token = null) {
            if (!orderId) return null;
            const raw = await this.callFunction('get_kernel_dispatch_order', { p_order_id: orderId }, token, { useCache: false });
            if (raw && raw.success !== false && raw.order) {
                const order = raw.order;
                let lines = order.lines;
                if (typeof lines === 'string') {
                    try {
                        lines = JSON.parse(lines);
                    } catch (e) {
                        lines = [];
                    }
                }
                return { order: order, lines: Array.isArray(lines) ? lines : [] };
            }
            return null;
        },

        saveKernelDispatchRecord: async function (payload, token = null) {
            const params = {
                p_dispatch_order_id: payload.dispatch_order_id || null,
                p_vehicle_clean_yn: payload.vehicle_clean_yn || null,
                p_vehicle_enclosed_yn: payload.vehicle_enclosed_yn || null,
                p_hazard_substances_yn: payload.hazard_substances_yn || null,
                p_pest_infestations_yn: payload.pest_infestations_yn || null,
                p_pallets_condition_yn: payload.pallets_condition_yn || null,
                p_truck_bin_locked_yn: payload.truck_bin_locked_yn || null,
                p_dispatch_person: payload.dispatch_person || null,
                p_transport_company: payload.transport_company || null,
                p_delivery_note_number: payload.delivery_note_number || null,
                p_date_dispatched: payload.date_dispatched || null,
                p_truck_registration: payload.truck_registration || null,
                p_driver_name: payload.driver_name || null,
                p_time_dispatched: payload.time_dispatched || null,
                p_dispatched_to: payload.dispatched_to || null,
                p_dispatch_signature: payload.dispatch_signature || null
            };
            const result = await this.callFunction('save_kernel_dispatch_record', params, token, { useCache: false });
            this.clearCachePattern('kernel_dispatch_orders_list');
            return result;
        },

        createOilDispatchOrder: async function (payload, token = null) {
            const params = {
                p_buyer_name: payload.buyer_name || null,
                p_delivery_date: payload.delivery_date || null,
                p_best_before_date: payload.best_before_date || null,
                p_buyer_contact_id: payload.buyer_contact_id || null,
                p_lines: Array.isArray(payload.lines) ? payload.lines : []
            };
            const result = await this.callFunction('create_oil_dispatch_order', params, token, { useCache: false });
            this.clearCachePattern('oil_dispatch_orders_list');
            this.clearCachePattern('oil_stock_lots');
            this.clearCachePattern('oil_stock_summary');
            return result;
        },

        updateOilDispatchOrderCartons: async function (orderId, lines, token = null) {
            const params = { p_order_id: orderId, p_lines: Array.isArray(lines) ? lines : [] };
            const result = await this.callFunction('update_oil_dispatch_order_cartons', params, token, { useCache: false });
            this.clearCachePattern('oil_dispatch_orders_list');
            return result;
        },

        getOilDispatchOrders: async function (token = null, forceRefresh = false, pLimit = 100) {
            const lim = typeof pLimit === 'number' && pLimit > 0 ? Math.min(pLimit, 1000) : 100;
            const raw = await this.callFunction('get_oil_dispatch_orders', { p_limit: lim, p_offset: 0 }, token, {
                cacheKey: 'oil_dispatch_orders_list_' + lim,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            if (raw && raw.success !== false && Array.isArray(raw.data)) return raw.data;
            if (raw && raw.data) return raw.data;
            return [];
        },

        getOilDispatchOrder: async function (orderId, token = null) {
            if (!orderId) return null;
            const raw = await this.callFunction('get_oil_dispatch_order', { p_order_id: orderId }, token, { useCache: false });
            if (raw && raw.success !== false && raw.order) {
                const order = raw.order;
                let lines = order.lines;
                if (lines == null && raw.lines != null) lines = raw.lines;
                if (typeof lines === 'string') {
                    try { lines = JSON.parse(lines); } catch (e) { lines = []; }
                }
                if (!Array.isArray(lines)) lines = [];
                return { order: order, lines: lines };
            }
            return null;
        },

        saveOilDispatchRecord: async function (payload, token = null) {
            const params = {
                p_dispatch_order_id: payload.dispatch_order_id || null,
                p_vehicle_clean_yn: payload.vehicle_clean_yn || null,
                p_vehicle_enclosed_yn: payload.vehicle_enclosed_yn || null,
                p_hazard_substances_yn: payload.hazard_substances_yn || null,
                p_pest_infestations_yn: payload.pest_infestations_yn || null,
                p_pallets_condition_yn: payload.pallets_condition_yn || null,
                p_truck_bin_locked_yn: payload.truck_bin_locked_yn || null,
                p_dispatch_person: payload.dispatch_person || null,
                p_transport_company: payload.transport_company || null,
                p_delivery_note_number: payload.delivery_note_number || null,
                p_date_dispatched: payload.date_dispatched || null,
                p_truck_registration: payload.truck_registration || null,
                p_driver_name: payload.driver_name || null,
                p_time_dispatched: payload.time_dispatched || null,
                p_dispatched_to: payload.dispatched_to || null,
                p_dispatch_signature: payload.dispatch_signature || null
            };
            const result = await this.callFunction('save_oil_dispatch_record', params, token, { useCache: false });
            this.clearCachePattern('oil_dispatch_orders_list');
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

        getReceivingChecklist: async function (checklistId, token = null) {
            if (!checklistId) return null;
            try {
                var result = await this.callFunction('get_receiving_checklist', { p_id: checklistId }, token);
                if (result) return result;
            } catch (e) { /* fallback below */ }
            var all = await this.getReceivingChecklists(token, true);
            var found = (all || []).filter(function (r) { return r.id === checklistId; })[0];
            return found ? { checklist: found, received_items: found.received_items || found.receivedItems || [] } : null;
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

        // Document Management Functions
        getDocumentCategories: async function (token = null) {
            const raw = await this.callFunction('get_document_categories', {}, token).catch(() => []);
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && raw.get_document_categories) return Array.isArray(raw.get_document_categories) ? raw.get_document_categories : [raw.get_document_categories];
            return [];
        },
        createDocumentCategory: async function (data, token = null) {
            const result = await this.callFunction('create_document_category_simple', {
                p_name: data.name,
                p_description: data.description || null
            }, token, { useCache: false });
            this.clearCachePattern('document_categories');
            return result;
        },
        deleteDocumentCategory: async function (categoryId, token = null) {
            const result = await this.callFunction('delete_document_category_simple', { p_id: categoryId }, token, { useCache: false });
            this.clearCachePattern('document_categories');
            return result;
        },
        getDocuments: async function (token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_documents', {}, token, {
                cacheKey: 'documents_list',
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            }).catch(() => []);
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (raw && raw.get_documents) return Array.isArray(raw.get_documents) ? raw.get_documents : [raw.get_documents];
            return [];
        },
        getDocumentById: async function (documentId, token = null) {
            return await this.callFunction('get_document_by_id', { p_id: documentId }, token);
        },
        createDocument: async function (data, token = null) {
            const result = await this.callFunction('create_document_simple', {
                p_document_name: data.document_name,
                p_file_name: data.file_name,
                p_category_id: data.category_id || null,
                p_file_id: data.file_id || null,
                p_file_link: data.file_link || null,
                p_uploaded_by: data.uploaded_by || null
            }, token, { useCache: false });
            this.clearCachePattern('documents');
            return result;
        },
        updateDocument: async function (documentId, data, token = null) {
            const result = await this.callFunction('update_document_simple', {
                p_id: documentId,
                p_document_name: data.document_name || null,
                p_category_id: data.category_id !== undefined ? data.category_id : null,
                p_is_active: data.is_active !== undefined ? data.is_active : null
            }, token, { useCache: false });
            this.clearCachePattern('documents');
            return result;
        },
        deleteDocument: async function (documentId, token = null) {
            const result = await this.callFunction('delete_document_hard', { p_id: documentId }, token, { useCache: false });
            this.clearCachePattern('documents');
            return result;
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