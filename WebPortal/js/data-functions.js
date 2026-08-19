/**
 * Data Functions Module
 * Handles all CRUD operations and data management functionality
 * Following WebPortals module pattern
 */

var _dataFunctions = function () {
    return {
        // Placeholder only — ensureConfigured() overrides these from appRouter before any DB call.
        // proxyUrl is retained for legacy callers but nothing fetches through it anymore.
        proxyUrl: '',
        supabaseUrl: '',
        supabaseAnonKey: '',

        /** RPCs that may fall back to PostgREST when Lambda RBAC blocks EXECUTE (DB grants still apply). */
        kernelRpcSupabaseFallback: new Set([
            'get_kernel_batches',
            'get_kernel_production_history',
            'return_kernel_from_stock_to_production',
            'upsert_kernel_job_card',
            'get_kernel_jobcard_approval_map',
            'complete_kernel_batch',
            'adjust_kernel_stock_on_hand',
            'update_kernel_stock_batch_info',
            'import_historical_kernel_batch',
            'get_kernel_batch_archive',
            'restore_kernel_batch_from_archive',
            // Document Management — DB grants apply; Lambda RBAC may deny with 403
            'get_documents',
            'get_document_by_id',
            'create_document_simple',
            'update_document_simple',
            'delete_document_hard',
            'get_document_categories',
            'create_document_category_simple',
            'delete_document_category_simple',
            'get_or_create_document_category',
            'delete_document_folder_recursive',
            // Notifications inbox — DB grants apply; Lambda RBAC may deny with 403
            'get_unread_notification_count',
            'get_my_notifications',
            'mark_notification_read',
            'mark_all_notifications_read',
            // Stock on hand edit history — read-only; DB grants apply
            'get_stock_edit_history'
        ]),

        /** Prefer PostgREST (anon) first — Lambda RBAC often denies these before DB grants apply. */
        kernelRpcDirectFirst: new Set([
            'get_kernel_batches',
            'get_kernel_production_history',
            'return_kernel_from_stock_to_production',
            'get_kernel_jobcard_approval_map',
            'import_historical_kernel_batch',
            'get_kernel_batch_archive',
            'restore_kernel_batch_from_archive',
            // Document Management reads
            'get_documents',
            'get_document_categories',
            'get_document_by_id',
            // Notifications reads
            'get_unread_notification_count',
            'get_my_notifications',
            // Stock on hand edit history
            'get_stock_edit_history'
        ]),

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

        /** Functions whose actor-carrying overload is known to be absent on this database. */
        _actorOverloadMissing: {},

        /**
         * Call a stock-mutating RPC, stamping the signed-in user so stock_soh_history records WHO
         * made the change (migrations 20260816090000 / 20260816090100).
         *
         * Sending p_actor_user_id selects the actor-carrying overload, because PostgREST picks
         * between the original RPC and the overload by argument NAME and the overload's
         * p_actor_user_id has no default. Omitting the key routes to the original untouched.
         *
         * WHY THE FALLBACK: the portal auto-deploys on merge but migrations are applied by hand,
         * so there is always a window where this JS is live against a database that has no
         * overload yet. There, PostgREST answers PGRST202 "Could not find the function ... in the
         * schema cache" and the user's dispatch or adjustment fails outright — losing the actual
         * stock operation to a logging feature. So a PGRST202 is treated as "not migrated yet":
         * retry once without the actor, and remember per function so later calls skip straight to
         * the original. The change still succeeds; only its attribution is lost until the
         * migrations are applied. Any other error propagates untouched.
         *
         * Retrying a MUTATION is safe here specifically because PGRST202 is raised during function
         * resolution, before PostgREST executes anything — there is no partial write to duplicate.
         * That is why the retry is gated on this one error code and nothing broader: a timeout or
         * a 5xx could mean the write landed, so those must never be retried.
         */
        _callWithActor: async function (fnName, params, token = null, options = undefined) {
            var actorId = this.getCurrentUserId();
            if (!actorId || this._actorOverloadMissing[fnName]) {
                return await this.callFunction(fnName, params, token, options);
            }
            try {
                return await this.callFunction(
                    fnName, Object.assign({}, params, { p_actor_user_id: actorId }), token, options);
            } catch (err) {
                var msg = err && err.message ? String(err.message) : '';
                if (!/PGRST202|schema cache|Could not find the function/i.test(msg)) throw err;
                this._actorOverloadMissing[fnName] = true;
                console.warn('[Stock history] ' + fnName + ' has no actor overload on this database — '
                    + 'the change will be recorded without a user. Apply migration '
                    + '20260816090100_stock_soh_history_actor_wrappers.sql to attribute it.');
                return await this.callFunction(fnName, params, token, options);
            }
        },

        /**
         * getStockEditHistory — who changed stock on hand, when, and by how much.
         * Covers stock in, dispatches out and adjustments across kernel, oil & protein and shell.
         * Returns { rows: [...], total: <n> }; every row repeats total_count, so one call pages.
         */
        getStockEditHistory: async function (filters, token = null) {
            var f = filters || {};
            var params = {
                p_stream: f.stream || null,
                p_event_type: f.eventType || null,
                p_search: f.search || null,
                p_date_from: f.dateFrom || null,
                p_date_to: f.dateTo || null,
                p_user_id: f.userId || null,
                p_limit: parseInt(f.limit, 10) || 50,
                p_offset: parseInt(f.offset, 10) || 0
            };
            var raw = await this.callFunction('get_stock_edit_history', params, token, { useCache: false });
            var rows = raw;
            if (rows && !Array.isArray(rows) && Array.isArray(rows.get_stock_edit_history)) rows = rows.get_stock_edit_history;
            if (rows && !Array.isArray(rows) && Array.isArray(rows.data)) rows = rows.data;
            if (!Array.isArray(rows)) rows = [];
            var total = rows.length > 0 && rows[0].total_count != null ? Number(rows[0].total_count) : rows.length;
            return { rows: rows, total: isFinite(total) ? total : rows.length };
        },

        _applySuperUserVisibility: function (type, data) {
            if (typeof superUserVisibility === 'undefined') return data;
            if (type === 'users') return superUserVisibility.filterUsers(data);
            if (type === 'roles') return superUserVisibility.filterRoles(data);
            if (type === 'roleAssignments') return superUserVisibility.filterRoleAssignments(data);
            return data;
        },

        _assertCanManageUserRecord: async function (userRecord, token) {
            if (typeof superUserVisibility === 'undefined') return;
            var user = userRecord;
            if (typeof userRecord === 'string') {
                user = await this.callFunction('get_user_by_id', { p_id: userRecord }, token || null, { useCache: false });
            }
            if (!user) return;
            if (!superUserVisibility.canManageUser(user)) {
                throw new Error('You do not have permission to manage this user.');
            }
        },

        _assertCanManageRoleRecord: async function (roleRecord, token) {
            if (typeof superUserVisibility === 'undefined') return;
            var role = roleRecord;
            if (typeof roleRecord === 'string') {
                role = await this.callFunction('get_role_by_id', { p_id: roleRecord }, token || null);
            }
            if (!role) return;
            if (!superUserVisibility.canManageRole(role)) {
                throw new Error('You do not have permission to manage the super_user role.');
            }
        },

        _assertCanAssignRoleId: async function (roleId, token) {
            if (typeof superUserVisibility === 'undefined' || !roleId) return;
            if (superUserVisibility.isCurrentUserSuperUser()) return;
            var role = await this.getRoleById(roleId, token || null);
            var roleName = role && (role.role_name || role.name || role.role);
            if (superUserVisibility.isSuperUserRole(roleName)) {
                throw new Error('Only super users may assign the super_user role.');
            }
        },

        _normalizeListResponse: function (raw, key) {
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            if (key && raw && Array.isArray(raw[key])) return raw[key];
            if (raw && Array.isArray(raw.result)) return raw.result;
            if (raw && Array.isArray(raw.body)) return raw.body;
            return [];
        },

        /** PostgREST TABLE RPCs return an array; callers need a single row. */
        _normalizeUserRow: function (raw) {
            if (!raw) return null;
            if (Array.isArray(raw)) return raw.length ? raw[0] : null;
            if (raw && Array.isArray(raw.data)) return raw.data.length ? raw.data[0] : null;
            if (typeof raw === 'object') return raw;
            return null;
        },

        /**
         * Check if current user has admin privileges
         */
        hasAdminRole: function () {
            const user = Session.get('user');
            if (!user) return false;

            const roleName = (user.role_name || user.role || '').toLowerCase();

            return roleName.includes('admin') ||
                roleName === 'super_user' ||
                roleName.includes('super admin');
        },

        /**
         * Check if user can access user management features
         */
        canAccessUserManagement: function () {
            const user = Session.get('user');
            if (!user) return false;

            const roleName = (user.role_name || user.role || '').toLowerCase();

            // Granular gate: the admin.users.manage action grants access. Admin/
            // super_user roles always pass via hasAction's role fallback.
            if (typeof window.hasAction === 'function') {
                return window.hasAction('admin.users.manage');
            }

            // Fallback when action-access is unavailable: admin/manager roles only.
            return roleName.includes('admin') ||
                roleName.includes('super admin') ||
                roleName.includes('manager');
        },

        /**
         * Debug function to show current user info
         */
        debugUserInfo: function () {
            const authStatus = this.getAuthStatus();
            return authStatus;
        },

        isRbacDeniedError: function (err) {
            const msg = (err && err.message) ? String(err.message) : String(err || '');
            return (err && err.status === 403) ||
                msg.indexOf('EXECUTE is not allowed') >= 0 ||
                msg.indexOf('Access denied') >= 0 ||
                msg.indexOf('RBAC') >= 0 ||
                msg.indexOf('status: 403') >= 0;
        },

        shouldUseSupabaseRpcFallback: function (functionName, responseStatus, errorMessage) {
            if (!this.kernelRpcSupabaseFallback.has(functionName)) return false;
            return responseStatus === 403 || this.isRbacDeniedError({ message: errorMessage, status: responseStatus });
        },

        extractProxyErrorMessage: function (data, depth) {
            const d = depth == null ? 0 : depth;
            if (d > 8 || data == null) return '';
            if (typeof data === 'string') return data;
            if (typeof data !== 'object') return '';
            const direct = data.message || data.error || data.Error || data.Message;
            if (direct && typeof direct === 'string') return direct;
            const keys = ['data', 'Data', 'body', 'Body', 'result', 'Result'];
            for (let i = 0; i < keys.length; i++) {
                const nested = this.extractProxyErrorMessage(data[keys[i]], d + 1);
                if (nested) return nested;
            }
            return '';
        },

        parseKernelJsonbField: function (val) {
            if (val == null) return val;
            if (typeof val === 'string') {
                const s = val.trim();
                if (s === '' || s === 'null') return null;
                try {
                    return JSON.parse(s);
                } catch (e) {
                    return val;
                }
            }
            return val;
        },

        /**
         * Macavation sign-in uses a custom Lambda JWT, not a Supabase Auth access token.
         * PostgREST rejects that JWT (PGRST301 / "No suitable key or wrong key type").
         */
        isSupabaseAuthJwt: function (token) {
            if (!token || typeof token !== 'string') return false;
            const parts = token.split('.');
            if (parts.length < 2) return false;
            try {
                const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const payload = JSON.parse(atob(b64));
                const iss = (payload.iss || '').toString();
                return iss.indexOf('supabase.co') >= 0;
            } catch (e) {
                return false;
            }
        },

        isPostgrestJwtKeyError: function (err) {
            const msg = (err && err.message) ? String(err.message) : String(err || '');
            return msg.indexOf('suitable key') >= 0 ||
                msg.indexOf('wrong key type') >= 0 ||
                msg.indexOf('PGRST301') >= 0;
        },

        // preserveEmptyStrings: '' is otherwise stripped, which makes it impossible to clear a
        // text column through an RPC that COALESCEs NULL onto the old value, and makes a
        // no-DEFAULT text param vanish from the body entirely. Callers that pass no options
        // (tryKernelRpcSupabaseFallback, returnKernelFromStockToProduction) keep the exact
        // previous behaviour: null, undefined and '' are all stripped.
        buildPostgrestRpcBody: function (params, options) {
            const out = {};
            if (!params || typeof params !== 'object') return out;
            const preserveNulls = !!(options && options.preserveNulls);
            const preserveEmptyStrings = !!(options && options.preserveEmptyStrings);
            Object.keys(params).forEach(function (key) {
                const val = params[key];
                if (preserveNulls && val === null) {
                    out[key] = null;
                    return;
                }
                if (preserveEmptyStrings && val === '') {
                    out[key] = '';
                    return;
                }
                if (val !== null && val !== undefined && val !== '') {
                    out[key] = val;
                }
            });
            return out;
        },

        tryKernelRpcSupabaseFallback: async function (functionName, params, token) {
            if (!this.kernelRpcSupabaseFallback.has(functionName)) {
                return null;
            }
            try {
                return await this.callSupabaseRpc(
                    functionName,
                    this.buildPostgrestRpcBody(params),
                    token,
                    { useAnonAuth: true }
                );
            } catch (fallbackErr) {
                console.warn('[tryKernelRpcSupabaseFallback]', functionName, fallbackErr);
                return null;
            }
        },

        /**
         * Resolve which database to use before any DB call. appRouter is the
         * preferred source; pages that do not load appRouter (e.g. sign-in)
         * fall back to the host-aware MACAVATION_SUPABASE bootstrap, which is
         * generated from the same supabase/projects.json — the two can never
         * disagree. If neither is present we fail loudly rather than guess.
         */
        ensureConfigured: async function () {
            if (typeof _appRouter !== 'undefined' && _appRouter && typeof _appRouter.ensureConfigured === 'function') {
                await _appRouter.ensureConfigured();
                this.supabaseUrl = _appRouter.SupabaseUrl;
                this.supabaseAnonKey = _appRouter.SupabaseAnonKey;
                return;
            }
            const bootstrapCfg = (typeof window !== 'undefined' && window.MACAVATION_SUPABASE) ? window.MACAVATION_SUPABASE : null;
            if (bootstrapCfg && bootstrapCfg.url && bootstrapCfg.anonKey) {
                this.supabaseUrl = bootstrapCfg.url;
                this.supabaseAnonKey = bootstrapCfg.anonKey;
                return;
            }
            throw new Error('dataFunctions: no database configuration available (appRouter and macavation-supabase.js are both missing).');
        },

        getSupabaseRestConfig: function () {
            const scope = this;
            // After ensureConfigured() these are populated from appRouter (single source of truth).
            let url = scope.supabaseUrl || (typeof _appRouter !== 'undefined' && _appRouter ? _appRouter.SupabaseUrl : '') || '';
            let anonKey = scope.supabaseAnonKey || (typeof _appRouter !== 'undefined' && _appRouter ? _appRouter.SupabaseAnonKey : '') || '';
            url = String(url || '').replace(/\/$/, '');
            if (url && typeof window !== 'undefined' && window.MACAVATION_SUPABASE) {
                window.MACAVATION_SUPABASE.assertMacavationSupabaseUrl(url);
            }
            return {
                url: url,
                anonKey: anonKey
            };
        },

        /**
         * Call Supabase PostgREST RPC directly (bypasses Lambda RBAC).
         * Kernel fallbacks use anon key only — portal login JWT is not a Supabase Auth token.
         */
        callSupabaseRpc: async function (functionName, params, token, options) {
            const scope = this;
            options = options || {};
            await scope.ensureConfigured();
            const cfg = scope.getSupabaseRestConfig();
            const userToken = token || this.getToken();
            if (!cfg.url || !cfg.anonKey || cfg.anonKey === 'your-anon-key-here') {
                throw new Error('Supabase RPC fallback is not configured (missing URL or anon key).');
            }
            const useAnonAuth = options.useAnonAuth === true ||
                !this.isSupabaseAuthJwt(userToken);
            const bearer = useAnonAuth ? cfg.anonKey : userToken;
            if (!bearer) {
                throw new Error('No authentication token available. Please sign in again.');
            }
            const rpcHeaders = {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + bearer,
                'apikey': cfg.anonKey
            };
            // Identity for DB-side audit: triggers stamp created_by/updated_by
            // and audit.audit_log from this header (see audit.current_actor).
            const auditUserId = this.getCurrentUserId();
            if (auditUserId) {
                rpcHeaders['X-User-Id'] = auditUserId;
            }
            const response = await fetch(cfg.url + '/rest/v1/rpc/' + encodeURIComponent(functionName), {
                method: 'POST',
                headers: rpcHeaders,
                body: JSON.stringify(scope.buildPostgrestRpcBody(params, {
                    preserveNulls: options.preserveNullParams === true,
                    preserveEmptyStrings: options.preserveEmptyParams === true
                }))
            });
            const responseText = await response.text();
            if (!response.ok) {
                let errorMessage = 'HTTP error! status: ' + response.status;
                try {
                    const errorData = JSON.parse(responseText);
                    errorMessage = errorData.message || errorData.error || errorData.hint || errorMessage;
                } catch (e) {
                    if (responseText) {
                        errorMessage = responseText;
                    }
                }
                const error = new Error(errorMessage);
                error.status = response.status;
                throw error;
            }
            if (!responseText || responseText.trim() === '') {
                return null;
            }
            try {
                return JSON.parse(responseText);
            } catch (e) {
                return responseText;
            }
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

            const scope = this;

            // Create promise for this request
            const requestPromise = (async () => {
                try {
                    // appRouter is the single source of truth for the Supabase config.
                    await scope.ensureConfigured();

                    // Direct-only transport: every RPC goes straight to Supabase
                    // PostgREST with the anon key. The AWS Lambda proxy is retired.
                    //
                    // preserveNullParams matters for functions whose arguments have no DEFAULTs:
                    // PostgREST resolves an overload from the exact set of parameter NAMES in the
                    // body, so a stripped null makes it report "Could not find the function ... in
                    // the schema cache" rather than passing NULL. Pass the option through for callers
                    // that need it instead of stripping unconditionally. preserveEmptyParams is the
                    // same idea for '': a no-DEFAULT text param would otherwise vanish from the body,
                    // and a COALESCE-onto-old-value param could never be cleared to ''.
                    // Pass RAW params: callSupabaseRpc builds the body itself. Pre-building here as
                    // well meant the body was processed twice, and the second pass used
                    // callSupabaseRpc's own options — where preserveNullParams was absent — so
                    // deliberately-preserved nulls were stripped straight back out.
                    const data = await scope.callSupabaseRpc(
                        functionName,
                        params,
                        authToken,
                        {
                            useAnonAuth: true,
                            preserveNullParams: options.preserveNullParams === true,
                            preserveEmptyParams: options.preserveEmptyParams === true
                        }
                    );

                    // Cache successful responses (do not cache empty array for get_kernel_batches so we retry next load)
                    if (useCache && data && !data.error) {
                        const isEmptyArray = Array.isArray(data) && data.length === 0;
                        const isKernelBatchesEmpty = functionName === 'get_kernel_batches' && isEmptyArray;
                        if (!isKernelBatchesEmpty) {
                            scope.setCache(cacheKey, data, cacheTtl);
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
            return this._applySuperUserVisibility('users', this._normalizeListResponse(raw, 'get_users'));
        },

        /**
         * Get user by ID (cached for 5 minutes)
         */
        getUserById: async function (userId, token = null, forceRefresh = false) {
            var raw = await this.callFunction('get_user_by_id', { p_id: userId }, token, {
                cacheKey: `user_${userId}`,
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
            var user = this._normalizeUserRow(raw);
            if (user && typeof superUserVisibility !== 'undefined' && !superUserVisibility.canSeeUser(user)) {
                return null;
            }
            return user;
        },

        /**
         * Create user (invalidates users cache)
         */
        createUser: async function (userData, token = null) {
            await this._assertCanAssignRoleId(userData.role_id, token);
            if (typeof superUserVisibility !== 'undefined' &&
                superUserVisibility.isCustomAppEmail(userData.email) &&
                !superUserVisibility.isCurrentUserSuperUser()) {
                throw new Error('Only super users may create @customapp.co.za accounts.');
            }
            const params = {
                p_email: userData.email,
                p_first_name: userData.first_name || null,
                p_last_name: userData.last_name || null,
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
            await this._assertCanManageUserRecord(userId, token);
            await this._assertCanAssignRoleId(userData.role_id, token);
            if (typeof superUserVisibility !== 'undefined' &&
                superUserVisibility.isCustomAppEmail(userData.email) &&
                !superUserVisibility.isCurrentUserSuperUser()) {
                throw new Error('Only super users may change @customapp.co.za accounts.');
            }
            const params = {
                p_user_id: userId,
                p_email: userData.email || null,
                p_first_name: userData.first_name || null,
                p_last_name: userData.last_name || null,
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
         * Change the signed-in user's own password. Requires the current
         * password (verified in-DB), so it is safe over the anon RPC.
         */
        changePassword: async function (email, currentPassword, newPassword, token = null) {
            return await this.callFunction('change_password', {
                p_email: email,
                p_current_password: currentPassword,
                p_new_password: newPassword
            }, token, { useCache: false });
        },

        /**
         * Complete a forgot-password reset using the token from the email link.
         */
        confirmPasswordReset: async function (resetToken, newPassword) {
            return await this.callFunction('confirm_password_reset', {
                p_token: resetToken,
                p_new_password: newPassword
            }, null, { useCache: false });
        },

        /**
         * Delete user (hard delete, invalidates cache)
         */
        deleteUser: async function (userId, token = null) {
            await this._assertCanManageUserRecord(userId, token);
            const result = await this.callFunction('delete_user_hard', { p_user_id: userId }, token, { useCache: false });
            this.clearCache(`user_${userId}`);
            this.clearCachePattern('users');
            return result;
        },

        /**
         * Deactivate user (soft delete, invalidates cache)
         */
        deactivateUser: async function (userId, token = null) {
            await this._assertCanManageUserRecord(userId, token);
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
            var roles = this._normalizeListResponse(raw, 'get_roles');
            if (typeof superUserVisibility !== 'undefined' &&
                superUserVisibility.rememberSuperUserRoleIdFromRoles) {
                superUserVisibility.rememberSuperUserRoleIdFromRoles(roles);
            }
            return roles;
        },

        /**
         * Roles for dropdowns / assignment (hides super_user from non-super_user actors).
         */
        getRolesForAssignment: async function (token = null, forceRefresh = false) {
            return this._applySuperUserVisibility('roles', await this.getRoles(token, forceRefresh));
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
            await this._assertCanManageRoleRecord(roleId, token);
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
            await this._assertCanManageRoleRecord(roleId, token);
            const result = await this.callFunction('deactivate_role', { p_id: roleId }, token, { useCache: false });
            this.clearCachePattern('roles');
            return result;
        },

        // ===== ROLE PERMISSIONS FUNCTIONS =====

        /**
         * Get all role permissions
         */
        getRolePermissions: async function (token = null) {
            var raw = await this.callFunction('get_role_permissions', {}, token);
            return this._applySuperUserVisibility('roleAssignments', this._normalizeListResponse(raw, 'get_role_permissions'));
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
            var list = (response && response.get_role_permissions_filtered)
                ? response.get_role_permissions_filtered
                : this._normalizeListResponse(response, 'get_role_permissions_filtered');
            return this._applySuperUserVisibility('roleAssignments', list);
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
            await this._assertCanManageRoleRecord(permissionData.role_id, token);
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
            await this._assertCanManageRoleRecord(permissionData.role_id, token);
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
        getRoleFeatures: async function (token = null, forceRefresh = false) {
            var raw = await this.callFunction('get_role_features', {}, token, {
                cacheKey: 'get_role_features',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            return this._applySuperUserVisibility('roleAssignments', this._normalizeListResponse(raw, 'get_role_features'));
        },

        /**
         * Role-feature assignments for one role (server-filtered; preferred for Customize).
         */
        getRoleFeaturesForRole: async function (roleId, token = null, forceRefresh = false) {
            if (!roleId) return [];
            var raw = await this.callFunction('get_role_features_for_role', { p_role_id: roleId }, token, {
                cacheKey: 'get_role_features_for_role_' + String(roleId),
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            return this._applySuperUserVisibility('roleAssignments', this._normalizeListResponse(raw, 'get_role_features_for_role'));
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
            await this._assertCanManageRoleRecord(featureData.role_id, token);
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
            await this._assertCanManageRoleRecord(featureData.role_id, token);
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
         * Delete role feature by role + feature (safe for Customize — no stale row PK).
         */
        deleteRoleFeatureForRole: async function (roleId, featureId, token = null) {
            await this._assertCanManageRoleRecord(roleId, token);
            return await this.callFunction('delete_role_feature_for_role', {
                p_role_id: roleId,
                p_feature_id: featureId
            }, token, { useCache: false });
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

        // ===== ACTION PERMISSIONS (buttons/actions inside modules) =====

        /** List all active actions (for admin-grid Customize button actions). */
        getActions: async function (token = null) {
            var raw = await this.callFunction('get_actions', {}, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.get_actions)) return raw.get_actions;
            if (raw && Array.isArray(raw.data)) return raw.data;
            return [];
        },

        /** List all role/action assignments (joined) for the admin grid. */
        getRoleActions: async function (token = null) {
            var raw = await this.callFunction('get_role_actions', {}, token, { useCache: false });
            return this._applySuperUserVisibility('roleAssignments', this._normalizeListResponse(raw, 'get_role_actions'));
        },

        /**
         * Enabled action keys for a role. Cached at login alongside featureKeys.
         * No cache so admin changes reflect after refresh.
         */
        getActionsForRole: async function (roleId, token = null) {
            var raw = await this.callFunction('get_actions_for_role', { p_role_id: roleId }, token, { useCache: false });
            var list = null;
            if (Array.isArray(raw)) list = raw;
            else if (raw && Array.isArray(raw.get_actions_for_role)) list = raw.get_actions_for_role;
            else if (raw && Array.isArray(raw.data)) list = raw.data;
            else if (raw && Array.isArray(raw.result)) list = raw.result;
            if (!Array.isArray(list)) return [];
            return list.map(function (row) {
                if (row && typeof row === 'object') {
                    var k = row.key != null ? row.key : row.Key;
                    return typeof k === 'string' ? { key: k } : { key: '' };
                }
                return { key: typeof row === 'string' ? row : '' };
            });
        },

        /** Grant a role/action (ON CONFLICT updates value). */
        createRoleAction: async function (data, token = null) {
            await this._assertCanManageRoleRecord(data.role_id, token);
            return await this.callFunction('create_role_action_simple', {
                role_id: data.role_id,
                action_id: data.action_id,
                value: data.value != null ? data.value : 'true'
            }, token);
        },

        /** Revoke a role/action assignment by its id. */
        deleteRoleAction: async function (roleActionId, token = null) {
            return await this.callFunction('delete_role_action_simple', { role_action_id: roleActionId }, token);
        },

        /** Revoke by role + action (safe for Customize — no stale row PK). */
        deleteRoleActionForRole: async function (roleId, actionId, token = null) {
            await this._assertCanManageRoleRecord(roleId, token);
            return await this.callFunction('delete_role_action_for_role', {
                p_role_id: roleId,
                p_action_id: actionId
            }, token, { useCache: false });
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
         * Sprint 0A live data audit: raw source counts behind dashboard stats.
         * Returns rows of { metric, source, value, detail } for cross-checking against grids.
         */
        getDashboardDataAudit: async function (token = null) {
            try {
                var raw = await this.callFunction('get_dashboard_data_audit', {}, token, { useCache: false });
                var list = [];
                if (Array.isArray(raw)) list = raw;
                else if (raw && Array.isArray(raw.get_dashboard_data_audit)) list = raw.get_dashboard_data_audit;
                else if (raw && Array.isArray(raw.data)) list = raw.data;
                return list.map(function (r) {
                    return {
                        metric: r.metric,
                        source: r.source,
                        value: Number(r.value) || 0,
                        detail: r.detail || null
                    };
                });
            } catch (e) {
                console.warn('[Dashboard] get_dashboard_data_audit failed. Apply migration 20260602090000_dashboard_data_audit.sql if needed.', e.message);
                return [];
            }
        },

        /**
         * Sprint 1C: configurable dashboard targets.
         * Returns a map { metric_key: { value, period_type, division, ... } } plus the raw rows.
         */
        getDashboardTargets: async function (token = null) {
            try {
                var raw = await this.callFunction('get_dashboard_targets', {}, token, {
                    cacheKey: 'dashboard_targets_list',
                    useCache: true,
                    cacheTtl: this.cache.ttl.static
                });
                var list = [];
                if (Array.isArray(raw)) list = raw;
                else if (raw && Array.isArray(raw.get_dashboard_targets)) list = raw.get_dashboard_targets;
                else if (raw && Array.isArray(raw.data)) list = raw.data;
                var map = {};
                list.forEach(function (t) {
                    map[t.metric_key] = {
                        id: t.id,
                        value: Number(t.target_value) || 0,
                        period_type: t.period_type,
                        division: t.division,
                        effective_from: t.effective_from,
                        notes: t.notes
                    };
                });
                return { rows: list, map: map };
            } catch (e) {
                console.warn('[Dashboard] get_dashboard_targets failed. Apply migration 20260602110000_dashboard_targets.sql if needed.', e.message);
                return { rows: [], map: {} };
            }
        },

        /** Create/update a dashboard target. */
        upsertDashboardTarget: async function (target, token = null) {
            // preserveNullParams is required, not optional: upsert_dashboard_target declares seven
            // arguments and NO defaults, and PostgREST picks an overload from the exact set of
            // parameter names in the request body. Without it, a null p_id (every new target) or a
            // null p_effective_from is stripped, the name set no longer matches any overload, and the
            // call fails with "Could not find the function public.upsert_dashboard_target(...) in the
            // schema cache" — which is why creating a target has never worked.
            var result = await this.callFunction('upsert_dashboard_target', {
                p_id: target.id != null ? target.id : null,
                p_metric_key: target.metric_key,
                p_target_value: target.target_value,
                p_period_type: target.period_type || 'monthly',
                p_division: target.division || 'all',
                p_effective_from: target.effective_from || null,
                p_notes: target.notes || null
            }, token, { preserveNullParams: true });
            this.clearCachePattern('dashboard_targets');
            return result;
        },

        /** Delete a dashboard target by id. */
        deleteDashboardTarget: async function (targetId, token = null) {
            var result = await this.callFunction('delete_dashboard_target', { p_id: targetId }, token);
            this.clearCachePattern('dashboard_targets');
            return result;
        },

        // ===== SPRINT 2: DASHBOARD FORECAST CHARTS =====

        /** Open kernel FG demand (cartons) grouped by week. */
        getKernelForecastByWeek: async function (weeks, token = null) {
            try {
                var raw = await this.callFunction('get_kernel_production_forecast_by_week', { p_weeks: parseInt(weeks, 10) || 12 }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_kernel_production_forecast_by_week)) return raw.get_kernel_production_forecast_by_week;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Dashboard] get_kernel_production_forecast_by_week failed. Apply migration 20260602120000_dashboard_forecast_aggregates.sql.', e.message);
                return [];
            }
        },

        /** Scheduled grower intake (kg) grouped by week. */
        getProcurementForecastByWeek: async function (weeks, token = null) {
            try {
                var raw = await this.callFunction('get_procurement_forecast_by_week', { p_weeks: parseInt(weeks, 10) || 12 }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_procurement_forecast_by_week)) return raw.get_procurement_forecast_by_week;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Dashboard] get_procurement_forecast_by_week failed. Apply migration 20260602120000_dashboard_forecast_aggregates.sql.', e.message);
                return [];
            }
        },

        // ===== SPRINT 2: STOCK ALERT RULES + ACCURACY =====

        /** List configurable stock red-flag rules. */
        getStockAlertRules: async function (token = null) {
            var raw = await this.callFunction('get_stock_alert_rules', {}, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.get_stock_alert_rules)) return raw.get_stock_alert_rules;
            if (raw && Array.isArray(raw.data)) return raw.data;
            return [];
        },

        /** Create/update a stock alert rule. */
        upsertStockAlertRule: async function (rule, token = null) {
            return await this.callFunction('upsert_stock_alert_rule', {
                p_id: rule.id != null ? rule.id : null,
                p_product_type: rule.product_type,
                p_style: rule.style || '*',
                p_min_qty: rule.min_qty,
                p_unit: rule.unit || 'kg',
                p_alert_type: rule.alert_type || 'stock_low',
                p_severity: rule.severity || 'warning',
                p_is_active: rule.is_active !== false
            }, token);
        },

        /** Delete a stock alert rule by id. */
        deleteStockAlertRule: async function (ruleId, token = null) {
            return await this.callFunction('delete_stock_alert_rule', { p_id: ruleId }, token);
        },

        /**
         * Evaluate observed SOH against rules, raising dashboard alerts on breaches.
         * @param {Array<{product_type:string,style:string,qty:number}>} observations
         */
        evaluateStockAlerts: async function (observations, token = null) {
            return await this.callFunction('evaluate_stock_alerts', { p_observations: observations || [] }, token);
        },

        /** Capture a monthly stock accuracy snapshot. */
        captureStockAccuracySnapshot: async function (snap, token = null) {
            return await this.callFunction('capture_stock_accuracy_snapshot', {
                p_month: snap.month || null,
                p_product_type: snap.product_type || 'all',
                p_total_soh: snap.total_soh || 0,
                p_adjusted_qty: snap.adjusted_qty || 0,
                p_adjustment_events: snap.adjustment_events || 0
            }, token);
        },

        /** Get recent stock accuracy snapshots. */
        getStockAccuracy: async function (months, token = null) {
            try {
                var raw = await this.callFunction('get_stock_accuracy', { p_months: parseInt(months, 10) || 6 }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_stock_accuracy)) return raw.get_stock_accuracy;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Dashboard] get_stock_accuracy failed. Apply migration 20260602130000_stock_alerts_and_accuracy.sql.', e.message);
                return [];
            }
        },

        // ===== SPRINT 3: OIL CONSOLIDATED BATCHES + SEARCH =====

        /** Search/filter oil production sheets. */
        searchOilBatches: async function (filters, token = null) {
            filters = filters || {};
            var raw = await this.callFunction('search_oil_batches', {
                p_search: filters.search || null,
                p_from: filters.from || null,
                p_to: filters.to || null,
                p_status: filters.status || null
            }, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.search_oil_batches)) return raw.search_oil_batches;
            if (raw && Array.isArray(raw.data)) return raw.data;
            return [];
        },

        /** List oil consolidated batches with member counts. */
        getOilConsolidatedBatches: async function (token = null) {
            var raw = await this.callFunction('get_oil_consolidated_batches', {}, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.get_oil_consolidated_batches)) return raw.get_oil_consolidated_batches;
            if (raw && Array.isArray(raw.data)) return raw.data;
            return [];
        },

        /** Create/update a consolidated oil batch (lab ref/notes, status). */
        upsertOilConsolidatedBatch: async function (batch, token = null) {
            return await this.callFunction('upsert_oil_consolidated_batch', {
                p_id: batch.id || null,
                p_consolidated_number: batch.consolidated_number,
                p_grade: batch.grade || null,
                p_lab_test_doc_ref: batch.lab_test_doc_ref || null,
                p_lab_test_notes: batch.lab_test_notes || null,
                p_status: batch.status || 'open'
            }, token);
        },

        /** Add an oil sheet to a consolidated batch. */
        addOilConsolidatedMember: async function (consolidatedId, oilId, token = null) {
            return await this.callFunction('add_oil_consolidated_member', { p_consolidated_id: consolidatedId, p_oil_id: oilId }, token);
        },

        /** Remove an oil sheet from a consolidated batch. */
        removeOilConsolidatedMember: async function (consolidatedId, oilId, token = null) {
            return await this.callFunction('remove_oil_consolidated_member', { p_consolidated_id: consolidatedId, p_oil_id: oilId }, token);
        },

        /** Delete a consolidated oil batch. */
        deleteOilConsolidatedBatch: async function (id, token = null) {
            return await this.callFunction('delete_oil_consolidated_batch', { p_id: id }, token);
        },

        // ===== SPRINT 3: SHELL WASTE STOCK + MASS BALANCE =====

        /** List shell waste stock lots. */
        getShellStockLots: async function (token = null) {
            var raw = await this.callFunction('get_shell_stock_lots', {}, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.get_shell_stock_lots)) return raw.get_shell_stock_lots;
            if (raw && Array.isArray(raw.data)) return raw.data;
            return [];
        },

        /** Create/update a shell stock lot. */
        upsertShellStockLot: async function (lot, token = null) {
            return await this._callWithActor('upsert_shell_stock_lot', {
                p_id: lot.id || null,
                p_lot_number: lot.lot_number || '',
                p_source_batch_number: lot.source_batch_number || null,
                p_quantity_kg: lot.quantity_kg || 0,
                p_status: lot.status || 'in_stock',
                p_notes: lot.notes || null
            }, token);
        },

        /** Delete a shell stock lot. */
        deleteShellStockLot: async function (id, token = null) {
            return await this._callWithActor('delete_shell_stock_lot', { p_id: id }, token);
        },

        /** Kernel mass-balance report (cracked vs packed, balance %). */
        getKernelMassBalance: async function (from, to, token = null) {
            try {
                var raw = await this.callFunction('get_kernel_mass_balance', { p_from: from || null, p_to: to || null }, token, { useCache: false });
                var row = Array.isArray(raw) ? raw[0] : (raw && raw.get_kernel_mass_balance ? raw.get_kernel_mass_balance[0] : raw);
                if (!row) return { cracked_kg: 0, packed_kg: 0, balance_kg: 0, balance_pct: 0 };
                return {
                    nis_in_kg: Number(row.nis_in_kg) || 0,
                    cracked_kg: Number(row.cracked_kg) || 0,
                    packed_kg: Number(row.packed_kg) || 0,
                    balance_kg: Number(row.balance_kg) || 0,
                    balance_pct: Number(row.balance_pct) || 0,
                    procurement_scheduled_kg: Number(row.procurement_scheduled_kg) || 0,
                    procurement_received_kg: Number(row.procurement_received_kg) || 0,
                    procurement_variance_kg: Number(row.procurement_variance_kg) || 0
                };
            } catch (e) {
                console.warn('[Mass balance] get_kernel_mass_balance failed. Apply migration 20260602140000_oil_consolidated_shell_massbalance.sql.', e.message);
                return { cracked_kg: 0, packed_kg: 0, balance_kg: 0, balance_pct: 0 };
            }
        },

        // ===== SPRINT 4: NOTIFICATIONS INBOX =====

        /** Notifications for the current user (direct + role-targeted + broadcast). */
        getMyNotifications: async function (userId, roleId, limit, token = null) {
            try {
                var raw = await this.callFunction('get_my_notifications', {
                    p_user_id: userId, p_role_id: roleId || null, p_limit: parseInt(limit, 10) || 50
                }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_my_notifications)) return raw.get_my_notifications;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Notifications] get_my_notifications failed. Apply migration 20260602150000_notifications.sql.', e.message);
                return [];
            }
        },

        /** Unread notification count for the badge. */
        getUnreadNotificationCount: async function (userId, roleId, token = null) {
            try {
                var raw = await this.callFunction('get_unread_notification_count', { p_user_id: userId, p_role_id: roleId || null }, token, { useCache: false });
                if (typeof raw === 'number') return raw;
                if (Array.isArray(raw) && raw[0] != null) return Number(raw[0].get_unread_notification_count != null ? raw[0].get_unread_notification_count : raw[0]) || 0;
                if (raw && raw.get_unread_notification_count != null) return Number(raw.get_unread_notification_count) || 0;
                return 0;
            } catch (e) {
                return 0;
            }
        },

        /** Mark one notification read. */
        markNotificationRead: async function (notificationId, userId, token = null) {
            return await this.callFunction('mark_notification_read', { p_notification_id: notificationId, p_user_id: userId }, token);
        },

        /** Mark all notifications read for the user. */
        markAllNotificationsRead: async function (userId, roleId, token = null) {
            return await this.callFunction('mark_all_notifications_read', { p_user_id: userId, p_role_id: roleId || null }, token);
        },

        /** Create a notification (targeted to a user/role or broadcast). Requires messaging.broadcast for broadcasts. */
        createNotification: async function (n, token = null) {
            return await this.callFunction('create_notification', {
                p_title: n.title,
                p_body: n.body || null,
                p_type: n.type || 'info',
                p_severity: n.severity || 'info',
                p_link_route: n.link_route || null,
                p_link_params: n.link_params || null,
                p_target_user_id: n.target_user_id || n.user_id || null,
                p_target_role_id: n.target_role_id || n.role_id || null,
                p_created_by: n.created_by || null
            }, token);
        },

        // ===== SPRINT 4: SCHEDULED REPORTS =====

        getScheduledReports: async function (token = null) {
            var raw = await this.callFunction('get_scheduled_reports', {}, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.get_scheduled_reports)) return raw.get_scheduled_reports;
            if (raw && Array.isArray(raw.data)) return raw.data;
            return [];
        },

        upsertScheduledReport: async function (report, token = null) {
            return await this.callFunction('upsert_scheduled_report', {
                p_id: report.id || null,
                p_user_id: report.user_id || null,
                p_email: report.email || null,
                p_report_type: report.report_type || 'daily_digest',
                p_channel: report.channel || 'email',
                p_is_active: report.is_active !== false,
                p_phone: report.phone || null
            }, token);
        },

        resolveDashboardAlert: async function (alertId, note, token = null) {
            return await this.callFunction('resolve_dashboard_alert', {
                p_alert_id: alertId,
                p_note: note || null
            }, token);
        },

        getPhase2ExtendedKpis: async function (token = null) {
            var raw = await this.callFunction('get_phase2_extended_kpis', {}, token, { useCache: false });
            if (raw && raw.get_phase2_extended_kpis) return raw.get_phase2_extended_kpis;
            return raw || {};
        },

        getOilForecastByWeek: async function (weeks, token = null) {
            var raw = await this.callFunction('get_oil_forecast_by_week', { p_weeks: parseInt(weeks, 10) || 12 }, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.get_oil_forecast_by_week)) return raw.get_oil_forecast_by_week;
            return [];
        },

        getConsolidatedBatchDashboardSummary: async function (token = null) {
            var raw = await this.callFunction('get_consolidated_batch_dashboard_summary', {}, token, { useCache: false });
            if (raw && raw.get_consolidated_batch_dashboard_summary) return raw.get_consolidated_batch_dashboard_summary;
            return raw || {};
        },

        getProcurementWeekSummary: async function (token = null) {
            var raw = await this.callFunction('get_procurement_week_summary', {}, token, { useCache: false });
            if (raw && raw.get_procurement_week_summary) return raw.get_procurement_week_summary;
            return raw || {};
        },

        autoCreateShellLotFromProduction: async function (batchNumber, shellKg, notes, token = null) {
            return await this.callFunction('auto_create_shell_lot_from_production', {
                p_batch_number: batchNumber,
                p_shell_kg: shellKg,
                p_notes: notes || null
            }, token);
        },

        dispatchShellStockLot: async function (lotId, customerRef, notes, token = null) {
            return await this._callWithActor('dispatch_shell_stock_lot', {
                p_lot_id: lotId,
                p_customer_ref: customerRef || null,
                p_notes: notes || null
            }, token);
        },

        getShellStockMovements: async function (lotId, token = null) {
            var raw = await this.callFunction('get_shell_stock_movements', { p_lot_id: lotId }, token, { useCache: false });
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.get_shell_stock_movements)) return raw.get_shell_stock_movements;
            return [];
        },

        importHistoricalOilStockLot: async function (data, token = null) {
            return await this.callFunction('import_historical_oil_stock_lot', {
                p_lot_number: data.lot_number,
                p_product_type: data.product_type || 'oil',
                p_quantity: data.quantity || 0,
                p_as_at_date: data.as_at_date || null,
                p_location: data.location || null,
                p_batch_number: data.batch_number || null
            }, token);
        },

        importKernelIntakeProcurementRow: async function (data, token = null) {
            return await this.callFunction('import_kernel_intake_procurement_row', {
                p_scheduled_date: data.scheduled_date,
                p_grower_name: data.grower_name,
                p_predicted_weight_kg: data.predicted_weight_kg || 0,
                p_supplier_id: data.supplier_id || null
            }, token);
        },

        /** Daily digest JSON for preview and edge function. */
        getDailyDigest: async function (token = null) {
            var raw = await this.callFunction('get_daily_digest', {}, token, { useCache: false });
            if (raw && raw.get_daily_digest) return raw.get_daily_digest;
            return raw || {};
        },

        /** Notify all users with a role by role_name. */
        notifyRole: async function (n, token = null) {
            return await this.callFunction('notify_role', {
                p_role_name: n.role_name || n.roleName,
                p_title: n.title,
                p_body: n.body || null,
                p_type: n.type || 'info',
                p_severity: n.severity || 'info',
                p_link_route: n.link_route || null
            }, token);
        },

        /** Daily oil litres and protein kg for executive dashboard chart. */
        getOilProductionTrendsDaily: async function (days, token = null) {
            try {
                var raw = await this.callFunction('get_oil_production_trends_daily', { p_days: parseInt(days, 10) || 365 }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_oil_production_trends_daily)) return raw.get_oil_production_trends_daily;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Dashboard] get_oil_production_trends_daily failed. Apply migration 20260629120000_phase2_portal_features.sql.', e.message);
                return [];
            }
        },

        /** Kernel SOH vs forecast demand runway summary. */
        getKernelRunwaySummary: async function (token = null) {
            try {
                var raw = await this.callFunction('get_kernel_runway_summary', {}, token, { useCache: false });
                if (raw && raw.get_kernel_runway_summary) return raw.get_kernel_runway_summary;
                if (Array.isArray(raw) && raw[0]) return raw[0];
                return raw || {};
            } catch (e) {
                console.warn('[Dashboard] get_kernel_runway_summary failed.', e.message);
                return {};
            }
        },

        /**
         * Get production trends for chart: daily kg cracked, kg packed, kg dispatched (SA timezone).
         * @param {number} days - Number of days (default 30)
         * @returns {Promise<Array<{trend_date:string,kg_cracked:number,kg_packed:number,kg_dispatched:number}>>}
         */
        getProductionTrendsDaily: async function (days, token = null) {
            // Clamp to 1000 — the PostgREST row cap, NOT an RPC limit. The RPC back-fills one row per
            // calendar day, so asking for more days than the cap silently truncates the response
            // (Content-Range: 0-999/*). This card previously asked for 1825 and received
            // 2021-08-16..2024-05-11 — every real production day discarded, so the chart showed an
            // empty window whichever range was pressed. For spans longer than 1000 days use
            // getProductionTrendsMonthly, which aggregates server-side and stays far below the cap.
            var pDays = Math.max(7, Math.min(1000, parseInt(days, 10) || 30));
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
         * Month-aggregated production trends, for ranges too long to fit in daily rows.
         *
         * A daily response is capped at 1000 rows by PostgREST, so 3Y/5Y/All cannot be served from
         * get_production_trends_daily. This aggregates server-side: 120 months is 120 rows.
         * @param {number} months - Number of months (1–240)
         * @returns {Promise<Array<{trend_month:string,kg_cracked:number,kg_packed:number,kg_dispatched:number}>>}
         */
        getProductionTrendsMonthly: async function (months, token = null) {
            var pMonths = Math.max(1, Math.min(240, parseInt(months, 10) || 60));
            try {
                var raw = await this.callFunction('get_production_trends_monthly', { p_months: pMonths }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_production_trends_monthly)) return raw.get_production_trends_monthly;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Dashboard] get_production_trends_monthly failed. Apply migration 20260818090400_production_trends_monthly_and_desc_order.sql if needed.', e.message);
                return [];
            }
        },

        /**
         * Daily stock-on-hand history per style/stream for dashboard line chart.
         * @param {string} productType - 'kernel' or 'oil'
         * @param {number} days - Number of days (7–1826)
         * @returns {Promise<Array<{d:string,series:string,qty_kg:number}>>}
         */
        getStockSohHistory: async function (productType, days, token = null) {
            var pType = String(productType || 'kernel').toLowerCase() === 'oil' ? 'oil' : 'kernel';
            var pDays = Math.max(7, Math.min(1826, parseInt(days, 10) || 365));
            try {
                var raw = await this.callFunction('get_stock_soh_history', {
                    p_product_type: pType,
                    p_days: pDays
                }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_stock_soh_history)) return raw.get_stock_soh_history;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Dashboard] get_stock_soh_history failed. Apply migration 20260713160000_get_stock_soh_history.sql if needed.', e.message);
                return [];
            }
        },

        /**
         * Raw-material runway: daily kg of nut-in-shell not yet put into production, actual history
         * plus a projection to the predicted run-out date.
         *
         * Depletion rate is kg per CALENDAR day, resolved server-side: explicit option here, then a
         * dashboard_targets override, then a chosen basis month. There is no automatic average — when
         * nothing is configured meta.kg_per_day is 0 and no forecast points are returned, which the
         * chart renders as "pick a basis month" rather than a made-up run-out date.
         *
         * @param {{historyDays?:number, kgPerDay?:number, basisMonth?:number, maxForecastDays?:number,
         *          includeProcurement?:boolean}} [opts] - basisMonth is YYYYMM, e.g. 202605.
         * @returns {Promise<{meta:Object, points:Array<{d:string,qty_kg:number,is_forecast:boolean,
         *          intake_kg:number,cracked_kg:number,reconciled_kg:number}>}>}
         */
        getNisRunwayForecast: async function (opts, token = null) {
            var o = opts || {};
            var params = {
                p_history_days: Math.max(7, Math.min(1826, parseInt(o.historyDays, 10) || 365)),
                p_kg_per_day: null,
                p_rate_basis_month: null,
                p_max_forecast_days: Math.max(7, Math.min(1826, parseInt(o.maxForecastDays, 10) || 730)),
                p_include_procurement: o.includeProcurement !== false
            };
            // Only send a rate hint when one was actually asked for: null lets the DB resolve from
            // the saved override, which is the normal path.
            var kg = parseFloat(o.kgPerDay);
            if (isFinite(kg) && kg > 0) params.p_kg_per_day = kg;
            var bm = parseInt(o.basisMonth, 10);
            if (isFinite(bm) && bm >= 200001 && bm <= 299912) params.p_rate_basis_month = bm;

            try {
                var raw = await this.callFunction('get_nis_runway_forecast', params, token, { useCache: false });
                var payload = (raw && raw.get_nis_runway_forecast) ? raw.get_nis_runway_forecast
                    : (raw && raw.data && raw.data.points) ? raw.data
                        : raw;
                if (payload && Array.isArray(payload.points)) {
                    return { meta: payload.meta || {}, points: payload.points };
                }
                return { meta: {}, points: [] };
            } catch (e) {
                // Must never throw: the dashboard deploys before migrations are applied, so PGRST202
                // ("Could not find function in schema cache") is an expected first-load state and has
                // to degrade to the card's empty state, not an error cascade.
                console.warn('[Dashboard] get_nis_runway_forecast failed. Apply migration 20260813100000_get_nis_runway_forecast.sql if needed.', e.message);
                return { meta: {}, points: [] };
            }
        },

        /**
         * Read the two raw-material runway assumptions out of dashboard_targets.
         * Reuses getDashboardTargets() rather than adding an RPC.
         * @returns {Promise<{kgPerDay:number|null, basisMonth:number|null, rows:Array}>}
         */
        getNisRunwaySettings: async function (token = null) {
            var out = { kgPerDay: null, basisMonth: null, rows: [] };
            try {
                var res = await this.getDashboardTargets(token);
                var rows = (res && res.rows) || [];
                out.rows = rows.filter(function (r) {
                    return r.metric_key === 'nis_crack_rate_kg_per_day' || r.metric_key === 'nis_rate_basis_month';
                });
                out.rows.forEach(function (r) {
                    var v = Number(r.target_value);
                    if (!isFinite(v) || v <= 0) return;
                    if (r.metric_key === 'nis_crack_rate_kg_per_day') out.kgPerDay = v;
                    if (r.metric_key === 'nis_rate_basis_month') out.basisMonth = Math.round(v);
                });
            } catch (e) {
                console.warn('[Dashboard] getNisRunwaySettings failed.', e.message);
            }
            return out;
        },

        /**
         * Persist one runway assumption. Shared by all users.
         * Writes via the existing upsert_dashboard_target RPC, whose RBAC already limits writes to
         * super_user / admin / General Manager / Production Manager / Oil Plant Manager — which is why
         * the button is not client-gated.
         * @param {'nis_crack_rate_kg_per_day'|'nis_rate_basis_month'} metricKey
         * @param {number} value - Pass 0 to clear the assumption.
         * @param {string} [note]
         */
        saveNisRunwaySetting: async function (metricKey, value, note, token = null) {
            var result = await this.upsertDashboardTarget({
                metric_key: metricKey,
                target_value: Number(value) || 0,
                period_type: 'daily',
                division: 'kernel',
                notes: note || null
            }, token);
            return result;
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
            var raw = await this.callFunction('get_contact_by_id', { p_id: contactId }, token, {
                cacheKey: `contact_${contactId}`,
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: forceRefresh
            });
            if (Array.isArray(raw) && raw.length) return raw[0];
            if (raw && Array.isArray(raw.get_contact_by_id)) return raw.get_contact_by_id[0];
            if (raw && Array.isArray(raw.data)) return raw.data[0];
            return raw;
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
                p_trading_name: contactData.trading_name || contactData.p_trading_name || null,
                p_supplier_number: (function () {
                    var sn = contactData.supplier_number !== undefined ? contactData.supplier_number : contactData.p_supplier_number;
                    if (sn === undefined || sn === null || sn === '') return null;
                    var n = typeof sn === 'number' ? sn : parseInt(String(sn), 10);
                    return isNaN(n) ? null : n;
                })()
            };

            try {
                console.log('[Data Functions] createContact - trying create_contact_simple first');
                const functionResult = await this.callFunction('create_contact_simple', params, token, { useCache: false });
                const normalizedFunctionResult = normalizeCreateContactResult(functionResult);
                console.log('[Data Functions] createContact RPC result:', normalizedFunctionResult);
                if (normalizedFunctionResult && normalizedFunctionResult.success !== false && normalizedFunctionResult.id) {
                    if (params.p_supplier_number != null) {
                        try {
                            await this.callFunction(
                                'update_contact_simple',
                                { p_contact_id: normalizedFunctionResult.id, p_supplier_number: params.p_supplier_number },
                                token,
                                { useCache: false }
                            );
                        } catch (e) {
                            console.warn('[Data Functions] createContact post-create supplier_number update skipped:', e);
                        }
                    }
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
                // Report the create_contact_simple failure first: it is the real cause, and the
                // fallback's own message (e.g. a p_rows complaint) only hides why the RPC failed.
                throw new Error(functionError?.message || normalizedImportResult?.error || normalizedImportResult?.message || 'Failed to create contact');
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
            if (contactData.supplier_number !== undefined) {
                var snu = contactData.supplier_number;
                params.p_supplier_number = (snu === null || snu === '')
                    ? null
                    : (typeof snu === 'number' ? snu : parseInt(String(snu), 10));
                if (isNaN(params.p_supplier_number)) params.p_supplier_number = null;
            }
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
         * Coerce API/Lambda booleans (true, 1, "true", PascalCase fields) for kernel flags.
         */
        coerceKernelBool: function (v) {
            if (v === true || v === 1 || v === '1' || v === 'true' || v === 'True') return true;
            if (v === false || v === 0 || v === '0' || v === 'false' || v === 'False') return false;
            return !!v;
        },

        isKernelJobcardApproved: function (row) {
            if (!row || typeof row !== 'object') return false;
            if (row.has_jobcard_approved === true || row.HasJobcardApproved === true ||
                row.jobcard_approved === true || row.JobcardApproved === true) {
                return true;
            }
            return this.coerceKernelBool(row.has_jobcard_approved) ||
                this.coerceKernelBool(row.HasJobcardApproved) ||
                this.coerceKernelBool(row.jobcard_approved) ||
                this.coerceKernelBool(row.JobcardApproved);
        },

        unwrapKernelRpcJson: function (raw, functionName) {
            let r = raw;
            if (r == null) return null;
            if (r.data !== undefined && r.data !== null) r = r.data;
            if (functionName && r[functionName] !== undefined) r = r[functionName];
            if (typeof r === 'string') {
                try {
                    r = JSON.parse(r);
                } catch (e) {
                    return raw;
                }
            }
            if (Array.isArray(r) && r.length === 1 && r[0] && typeof r[0] === 'object') {
                r = r[0];
            }
            return r;
        },

        /**
         * Lambda / .NET proxies sometimes return PascalCase property names. Kernel stock UI needs stable id + jsonb keys.
         */
        normalizeKernelBatchRow: function (r) {
            if (!r || typeof r !== 'object') return r;
            const o = Object.assign({}, r);
            if (o.kernel_id == null && o.KernelId != null) o.kernel_id = o.KernelId;
            if (o.batch_id == null && o.BatchId != null) o.batch_id = o.BatchId;
            if (o.id == null && o.Id != null) o.id = o.Id;
            if (o.kernel_id != null) {
                o.id = o.kernel_id;
            } else if (o.KernelId != null) {
                o.id = o.KernelId;
            }
            if (o.id != null && o.batch_id != null && String(o.id) === String(o.batch_id) && o.kernel_id == null) {
                o._id_is_batches_pk = true;
            }
            if (o.batch_number == null && o.BatchNumber != null) o.batch_number = o.BatchNumber;
            if (o.yield_by_style == null && o.YieldByStyle != null) o.yield_by_style = o.YieldByStyle;
            if (o.remaining_by_style == null && o.RemainingByStyle != null) o.remaining_by_style = o.RemainingByStyle;
            if (o.yield_by_style_cartons == null && o.YieldByStyleCartons != null) o.yield_by_style_cartons = o.YieldByStyleCartons;
            if (o.remaining_by_style_cartons == null && o.RemainingByStyleCartons != null) o.remaining_by_style_cartons = o.RemainingByStyleCartons;
            if (o.grower_name == null && o.GrowerName != null) o.grower_name = o.GrowerName;
            if (o.supplier_id == null && o.SupplierId != null) o.supplier_id = o.SupplierId;
            if (o.wet_nis_received_kg == null && o.WetNisReceivedKg != null) o.wet_nis_received_kg = o.WetNisReceivedKg;
            if (o.actual_wet_nis_kg == null && o.ActualWetNisKg != null) o.actual_wet_nis_kg = o.ActualWetNisKg;
            if (o.weight_difference_kg == null && o.WeightDifferenceKg != null) o.weight_difference_kg = o.WeightDifferenceKg;
            if (o.status == null && o.Status != null) o.status = o.Status;
            if (o.production_finished_at == null && o.ProductionFinishedAt != null) {
                o.production_finished_at = o.ProductionFinishedAt;
            }
            o.has_jobcard_approved = this.coerceKernelBool(
                o.has_jobcard_approved != null ? o.has_jobcard_approved : o.HasJobcardApproved
            );
            o.has_job_card = this.coerceKernelBool(
                o.has_job_card != null ? o.has_job_card : o.HasJobCard
            );
            o.has_qa = this.coerceKernelBool(o.has_qa != null ? o.has_qa : o.HasQa);
            o.has_receiving_checklist = this.coerceKernelBool(
                o.has_receiving_checklist != null ? o.has_receiving_checklist : o.HasReceivingChecklist
            );
            o.has_ziplock_sample = this.coerceKernelBool(
                o.has_ziplock_sample != null ? o.has_ziplock_sample : o.HasZiplockSample
            );
            o.has_5kg_sample = this.coerceKernelBool(
                o.has_5kg_sample != null ? o.has_5kg_sample : o.Has5kgSample
            );
            o.has_dispatch = this.coerceKernelBool(
                o.has_dispatch != null ? o.has_dispatch : o.HasDispatch
            );
            o.jobcard_approved = this.coerceKernelBool(
                o.jobcard_approved != null ? o.jobcard_approved : o.JobcardApproved
            );
            if (o.jobcard_approved) o.has_jobcard_approved = true;
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
            // Lambda / proxies sometimes nest the SETOF rows under an undocumented key — pick the first array of kernel-shaped rows
            const rk = Object.keys(raw);
            for (let ki = 0; ki < rk.length; ki++) {
                const v = raw[rk[ki]];
                if (!Array.isArray(v) || v.length === 0) continue;
                const first = v[0];
                if (
                    first &&
                    typeof first === 'object' &&
                    (first.batch_number != null ||
                        first.BatchNumber != null ||
                        first.batch_id != null ||
                        first.BatchId != null)
                ) {
                    return v;
                }
            }
            return [];
        },

        /** When the API proxy ignores p_status, still honour the status filter the UI requested. */
        filterKernelBatchesByStatus: function (rows, pStatus) {
            if (!pStatus || !rows || !rows.length) {
                return rows || [];
            }
            const allowed = String(pStatus).split(',').map(function (s) {
                return s.trim();
            }).filter(Boolean);
            if (!allowed.length) {
                return rows;
            }
            return rows.filter(function (r) {
                if (!r) {
                    return false;
                }
                const st = r.status != null ? String(r.status).trim() : '';
                return allowed.indexOf(st) >= 0;
            });
        },

        getKernelBatches: async function (token = null, forceRefresh = false, options = {}) {
            if (forceRefresh) {
                this.clearCachePattern('kernel_batches');
            }
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
            const enriched = await this.enrichKernelBatchesWithApprovalMap(rows, token);
            return this.filterKernelBatchesByStatus(enriched, params.p_status);
        },

        /**
         * When the API proxy omits has_jobcard_approved on get_kernel_batches rows, merge from kernel.jobcard_approved.
         */
        getKernelJobcardApprovalMap: async function (kernelIds, token = null) {
            const ids = (kernelIds || []).filter(Boolean);
            const params = { p_kernel_ids: ids.length > 0 ? ids : null };
            const raw = await this.callFunction('get_kernel_jobcard_approval_map', params, token, {
                useCache: false
            });
            let map = raw;
            if (raw && raw.get_kernel_jobcard_approval_map != null) {
                map = raw.get_kernel_jobcard_approval_map;
            }
            if (typeof map === 'string') {
                try {
                    map = JSON.parse(map);
                } catch (e) {
                    map = {};
                }
            }
            if (!map || typeof map !== 'object' || Array.isArray(map)) {
                return {};
            }
            return map;
        },

        enrichKernelBatchesWithApprovalMap: async function (rows, token = null) {
            const scope = this;
            const normalized = scope.normalizeKernelBatchRows(rows);
            if (!normalized.length) {
                return normalized;
            }
            try {
                const ids = normalized.map(function (r) { return r.id; }).filter(Boolean);
                const map = await scope.getKernelJobcardApprovalMap(ids, token);
                return normalized.map(function (r) {
                    if (!r || !r.id) {
                        return r;
                    }
                    const key = String(r.id);
                    if (!(key in map)) {
                        return r;
                    }
                    const approved = scope.coerceKernelBool(map[key]);
                    return Object.assign({}, r, {
                        has_jobcard_approved: approved,
                        jobcard_approved: approved
                    });
                });
            } catch (e) {
                console.warn('[getKernelBatches] Could not merge jobcard approval flags:', e);
                return normalized;
            }
        },

        normalizeKernelBatchDetailRow: function (r) {
            const o = this.normalizeKernelBatchRow(r);
            if (!o || typeof o !== 'object') return o;
            if (o.jobcard_approved == null && o.HasJobcardApproved != null) {
                o.jobcard_approved = this.coerceKernelBool(o.HasJobcardApproved);
            }
            o.job_card_data = this.parseKernelJsonbField(o.job_card_data);
            o.packing_data = this.parseKernelJsonbField(o.packing_data);
            o.qa_data = this.parseKernelJsonbField(o.qa_data);
            o.intake_data = this.parseKernelJsonbField(o.intake_data);
            return o;
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

        // -----------------------------------------------------------------
        // Kernel Intake Procurement calendar
        // -----------------------------------------------------------------

        extractKernelIntakeProcurementRowsFromRaw: function (raw, depth) {
            const d = depth == null ? 0 : depth;
            if (d > 8 || raw == null) return [];
            if (Array.isArray(raw)) return raw;
            if (typeof raw === 'string') {
                const s = raw.trim();
                if (s === '' || s === 'null') return [];
                try {
                    return this.extractKernelIntakeProcurementRowsFromRaw(JSON.parse(s), d + 1);
                } catch (e) {
                    return [];
                }
            }
            if (typeof raw !== 'object') return [];
            const keys = [
                'data', 'Data',
                'get_kernel_intake_procurements', 'GetKernelIntakeProcurements',
                'result', 'Result',
                'rows', 'Rows',
                'records', 'Records',
                'items', 'Items'
            ];
            for (let i = 0; i < keys.length; i++) {
                const k = keys[i];
                if (raw[k] == null) continue;
                const got = this.extractKernelIntakeProcurementRowsFromRaw(raw[k], d + 1);
                if (got.length > 0) return got;
            }
            if (raw.id != null && raw.scheduled_date != null) return [raw];
            return [];
        },

        normalizeKernelIntakeProcurementRow: function (r) {
            if (!r || typeof r !== 'object') return r;
            const o = Object.assign({}, r);
            if (o.id == null && o.Id != null) o.id = o.Id;
            if (o.scheduled_date == null && o.ScheduledDate != null) o.scheduled_date = o.ScheduledDate;
            if (o.supplier_id == null && o.SupplierId != null) o.supplier_id = o.SupplierId;
            if (o.grower_name == null && o.GrowerName != null) o.grower_name = o.GrowerName;
            if (o.predicted_weight_kg == null && o.PredictedWeightKg != null) o.predicted_weight_kg = o.PredictedWeightKg;
            if (o.status == null && o.Status != null) o.status = o.Status;
            if (o.batch_id == null && o.BatchId != null) o.batch_id = o.BatchId;
            if (o.sort_index == null && o.SortIndex != null) o.sort_index = o.SortIndex;
            if (o.predicted_weight_kg != null && typeof o.predicted_weight_kg !== 'number') {
                const w = parseFloat(o.predicted_weight_kg);
                o.predicted_weight_kg = isNaN(w) ? null : w;
            }
            return o;
        },

        normalizeKernelIntakeProcurementRows: function (rows) {
            if (!Array.isArray(rows)) return [];
            const scope = this;
            return rows.map(function (row) { return scope.normalizeKernelIntakeProcurementRow(row); });
        },

        getKernelIntakeProcurements: async function (fromDate, toDate, forceRefresh, token = null) {
            const cacheKey = 'kernel_intake_procurements_' + (fromDate || '') + '_' + (toDate || '');
            const raw = await this.callFunction(
                'get_kernel_intake_procurements',
                { p_from: fromDate || null, p_to: toDate || null },
                token,
                { cacheKey, useCache: true, cacheTtl: this.cache.ttl.dynamic, forceRefresh: !!forceRefresh }
            );
            return this.normalizeKernelIntakeProcurementRows(
                this.extractKernelIntakeProcurementRowsFromRaw(raw, 0)
            );
        },

        upsertKernelIntakeProcurement: async function (payload, token = null) {
            payload = payload || {};
            const params = {
                p_id:                  payload.id != null && payload.id !== '' ? payload.id : null,
                p_scheduled_date:      payload.scheduled_date || null,
                p_supplier_id:         payload.supplier_id != null && payload.supplier_id !== '' ? payload.supplier_id : null,
                p_grower_name:         payload.grower_name != null && String(payload.grower_name).trim() !== '' ? String(payload.grower_name).trim() : null,
                p_predicted_weight_kg: payload.predicted_weight_kg != null ? payload.predicted_weight_kg : null,
                p_sort_index:          payload.sort_index != null ? payload.sort_index : null
            };
            await this.ensureConfigured();
            const authToken = token || this.getToken();
            const result = await this.callSupabaseRpc(
                'upsert_kernel_intake_procurement',
                params,
                authToken,
                { useAnonAuth: true, preserveNullParams: true }
            );
            this.clearCachePattern('kernel_intake_procurements');
            const rows = this.extractKernelIntakeProcurementRowsFromRaw(result, 0);
            return rows.length > 0 ? this.normalizeKernelIntakeProcurementRow(rows[0]) : null;
        },

        convertKernelIntakeProcurement: async function (procurementId, batchId, token = null) {
            const result = await this.callFunction(
                'convert_kernel_intake_procurement',
                { p_id: procurementId, p_batch_id: batchId },
                token,
                { useCache: false }
            );
            this.clearCachePattern('kernel_intake_procurements');
            return result;
        },

        deleteKernelIntakeProcurement: async function (procurementId, token = null) {
            const result = await this.callFunction(
                'delete_kernel_intake_procurement',
                { p_id: procurementId },
                token,
                { useCache: false }
            );
            this.clearCachePattern('kernel_intake_procurements');
            return result;
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
            const scope = this;
            const pick = function (row) {
                return row ? scope.normalizeKernelBatchDetailRow(row) : null;
            };
            if (raw && raw.id) return pick(raw);
            if (raw && Array.isArray(raw.data) && raw.data[0]) return pick(raw.data[0]);
            if (Array.isArray(raw) && raw[0]) return pick(raw[0]);
            if (raw && raw.get_kernel_batch_detail) {
                const d = raw.get_kernel_batch_detail;
                return pick(Array.isArray(d) ? d[0] : d);
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
         * upsertKernelJobCard — save job card JSONB. Stock (packing_data) syncs only on approve or when batch is already jobcard_approved.
         * Used by: modal_kernel_job_card only.
         * options.approved: true when user clicks "Jobcard approved".
         * options.draft: autosave / draft save — job_card_data only until first approval; after approval, server still syncs stock on save.
         */
        upsertKernelJobCard: async function (kernelId, jobCardData, token = null, options = {}) {
            const scope = this;
            const clearCache = () => {
                scope.clearCachePattern('kernel_batch_detail_' + kernelId);
                scope.clearCachePattern('kernel_batches');
            };
            const isRbacDenied = function (err) {
                const msg = (err && err.message) ? String(err.message) : String(err || '');
                return msg.indexOf('EXECUTE is not allowed') >= 0 ||
                    msg.indexOf('Access denied') >= 0 ||
                    msg.indexOf('RBAC') >= 0;
            };
            let cardData = jobCardData;
            if (options.approved === true && cardData && typeof cardData === 'object') {
                cardData = Object.assign({}, cardData, {
                    jobcard_approved: true,
                    submit_action: 'approve'
                });
            }
            // Always pass all four RPC params so PostgREST picks the 4-arg overload unambiguously.
            const buildPayload = function (jobcardApproved, finalizeWithoutProduction) {
                return {
                    p_kernel_id: kernelId,
                    p_job_card_data: cardData,
                    p_jobcard_approved: jobcardApproved === true ? true : null,
                    p_finalize_without_production: finalizeWithoutProduction === true
                };
            };
            const payloads = [];
            if (options.approved === true) {
                payloads.push(buildPayload(false, true));
                payloads.push(buildPayload(true, false));
            } else {
                payloads.push(buildPayload(false, false));
            }

            let inner = null;
            let lastErr = null;
            for (let i = 0; i < payloads.length; i++) {
                try {
                    const raw = await scope.callFunction('upsert_kernel_job_card', payloads[i], token, {
                        useCache: false
                    });
                    clearCache();
                    inner = scope.unwrapKernelRpcJson(raw, 'upsert_kernel_job_card') || raw;
                    if (inner && inner.success === false) {
                        lastErr = new Error(inner.error || inner.Error || 'Failed to save job card');
                        continue;
                    }
                    lastErr = null;
                    if (options.approved === true && !scope.isKernelJobcardApproved(inner) && i < payloads.length - 1) {
                        continue;
                    }
                    break;
                } catch (e) {
                    lastErr = e;
                    if (!isRbacDenied(e)) {
                        throw e;
                    }
                }
            }
            if (lastErr) {
                throw lastErr;
            }
            if (options.approved === true) {
                if (!scope.isKernelJobcardApproved(inner)) {
                    try {
                        const detail = await scope.getKernelBatchDetail(kernelId, null, true);
                        if (scope.isKernelJobcardApproved(detail)) {
                            inner = Object.assign({}, inner || {}, detail || {}, {
                                jobcard_approved: true,
                                has_jobcard_approved: true
                            });
                        }
                    } catch (verifyErr) {
                        console.warn('[upsertKernelJobCard] approval verify via detail failed:', verifyErr);
                    }
                }
                if (inner && inner.success !== false) {
                    inner = Object.assign({}, inner || {}, {
                        jobcard_approved: true,
                        has_jobcard_approved: true
                    });
                }
            }
            return inner;
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
         * updateOilBatchHeader — edit an oil batch's header details from Find a batch.
         * Oil counterpart to updateKernelStockBatchInfo. Header fields only: batch number,
         * production date, total oil litres. NULL means leave unchanged (20260816100000).
         */
        updateOilBatchHeader: async function (oilId, payload, token = null) {
            const params = {
                p_oil_id: oilId,
                p_batch_id: payload && payload.batch_id != null ? String(payload.batch_id).trim() : null,
                p_production_date: payload && payload.production_date ? payload.production_date : null,
                p_total_oil_litre: payload && payload.total_oil_litre != null && payload.total_oil_litre !== ''
                    ? Number(payload.total_oil_litre)
                    : null
            };
            const raw = await this.callFunction('update_oil_batch_header', params, token, { useCache: false });
            this.clearCachePattern('oil_batches');
            let r = raw;
            if (r && typeof r === 'object' && r.update_oil_batch_header !== undefined) r = r.update_oil_batch_header;
            if (typeof r === 'string') {
                try { r = JSON.parse(r); } catch (e) { /* keep */ }
            }
            return r;
        },

        /**
         * completeKernelBatch — set kernel status to 'complete' (release to stock).
         * Used by: kernel_production_batch_actions.releaseBatchToStock
         */
        completeKernelBatch: async function (kernelId, token = null) {
            const raw = await this._callWithActor('complete_kernel_batch', { p_kernel_id: kernelId }, token, { useCache: false });
            this.clearCachePattern('kernel_batch_detail_' + kernelId);
            this.clearCachePattern('kernel_batches');
            return this.unwrapKernelRpcJson(raw, 'complete_kernel_batch') || raw;
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
            let result = await this._callWithActor('adjust_kernel_stock_on_hand', params, token, { useCache: false });
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
         * updateKernelStockBatchInfo — edit batch number, supplier, grower, received date, wet NIS, FFA, best before.
         * Used by the shared batch edit dialog (KernelBatchEdit) from both Kernel Production and Stock Management.
         * @param {string} kernelId
         * @param {object} payload - { batch_number, supplier_id?, grower_name, received_date, wet_nis_received_kg, ffa?, best_before_date? }
         *   supplier_id omitted/null leaves the batch's supplier unchanged.
         */
        updateKernelStockBatchInfo: async function (kernelId, payload, token = null) {
            const params = {
                p_kernel_id: kernelId,
                p_batch_number: payload && payload.batch_number != null ? String(payload.batch_number).trim() : null,
                p_grower_name: payload && payload.grower_name != null ? payload.grower_name : null,
                p_received_date: payload && payload.received_date ? payload.received_date : null,
                p_wet_nis_received_kg: payload && payload.wet_nis_received_kg != null && payload.wet_nis_received_kg !== ''
                    ? Number(payload.wet_nis_received_kg)
                    : null,
                p_best_before_date: payload && payload.best_before_date ? payload.best_before_date : null,
                p_ffa: payload && payload.ffa != null && payload.ffa !== '' ? Number(payload.ffa) : null,
                // NULL means LEAVE UNCHANGED (20260815140000) — this path cannot clear a supplier.
                // Sent unconditionally: the dialog's "Keep current supplier" option yields null,
                // which is exactly the leave-unchanged signal the RPC expects.
                p_supplier_id: payload && payload.supplier_id ? payload.supplier_id : null
            };
            let result = await this.callFunction('update_kernel_stock_batch_info', params, token, { useCache: false });
            if (result && result.offline && result.queued) {
                throw new Error('Cannot save while offline. Connect and try again.');
            }
            let r = result;
            for (let i = 0; i < 10 && r && typeof r === 'object' && !Array.isArray(r); i++) {
                if (r.update_kernel_stock_batch_info !== undefined) r = r.update_kernel_stock_batch_info;
                else if (r.UpdateKernelStockBatchInfo !== undefined) r = r.UpdateKernelStockBatchInfo;
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
         * deactivateKernelBatch — archive (soft delete): writes kernel_batch_archive, hides batch from active lists.
         * Used by: Stock, Grower Intake, and Kernel Production "Archive batch" actions.
         */
        deactivateKernelBatch: async function (kernelId, token = null) {
            const result = await this.callFunction('deactivate_kernel_batch', { p_kernel_id: kernelId }, token, { useCache: false });
            this.clearCachePattern('kernel_batch_detail_' + kernelId);
            this.clearCachePattern('kernel_batches');
            this.clearCachePattern('kernel_batch_archive');
            return result;
        },

        /**
         * getKernelBatchArchive — list archived kernel batches (who archived, restore eligibility).
         */
        getKernelBatchArchive: async function (search, token = null, options) {
            const opts = options || {};
            const params = {
                p_search: search != null && String(search).trim() !== '' ? String(search).trim() : null,
                p_limit: opts.limit != null ? opts.limit : 200,
                p_offset: opts.offset != null ? opts.offset : 0
            };
            let raw = await this.callFunction('get_kernel_batch_archive', params, token, { useCache: false });
            if (raw && raw.get_kernel_batch_archive !== undefined) raw = raw.get_kernel_batch_archive;
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.data)) return raw.data;
            return [];
        },

        /**
         * restoreKernelBatchFromArchive — reactivate a soft-archived batch; pass batchNumber when original is taken.
         */
        restoreKernelBatchFromArchive: async function (archiveId, batchNumber, token = null) {
            const params = {
                p_archive_id: archiveId,
                p_batch_number: batchNumber != null && String(batchNumber).trim() !== '' ? String(batchNumber).trim() : null
            };
            let result = await this.callFunction('restore_kernel_batch_from_archive', params, token, { useCache: false });
            result = this.unwrapKernelRpcJson(result, 'restore_kernel_batch_from_archive') || result;
            if (result && typeof result === 'object') {
                if (result.success === undefined && result.Success !== undefined) result.success = result.Success;
                if (result.error === undefined && result.Error !== undefined) result.error = result.Error;
                if (result.needs_new_number === undefined && result.NeedsNewNumber !== undefined) {
                    result.needs_new_number = result.NeedsNewNumber;
                }
            }
            this.clearCachePattern('kernel_batches');
            this.clearCachePattern('kernel_batch_archive');
            return result;
        },

        /**
         * deleteKernelBatchPermanent — hard delete kernel batch (batches + kernel row). Irreversible.
         * Cleans kernel_dispatch_orders lines referencing this kernel.
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
            let result = await this._callWithActor('import_historical_kernel_batch', params, token, { useCache: false });
            result = this.unwrapKernelRpcJson(result, 'import_historical_kernel_batch') || result;
            if (result && typeof result === 'object') {
                if (result.success === undefined && result.Success !== undefined) result.success = result.Success;
                if (result.error === undefined && result.Error !== undefined) result.error = result.Error;
                const kernelId = result.id != null ? result.id : result.Id;
                if (kernelId != null) {
                    result.id = kernelId;
                    result.kernel_id = result.kernel_id != null ? result.kernel_id : kernelId;
                }
                if (result.batch_number === undefined && result.BatchNumber !== undefined) {
                    result.batch_number = result.BatchNumber;
                }
            }
            this.clearCachePattern('kernel_batches');
            return result;
        },

        /**
         * Normalize get_kernel_production_history row (lambda / .NET proxies may use PascalCase).
         */
        normalizeKernelProductionHistoryDetail: function (d) {
            if (!d || typeof d !== 'object') return d;
            const o = Object.assign({}, d);
            if (o.dispatch_orders == null && o.DispatchOrders != null) {
                o.dispatch_orders = o.DispatchOrders;
            }
            // Some proxies return jsonb as a JSON string (or double-encoded); modal expects an array/object.
            if (typeof o.dispatch_orders === 'string') {
                try {
                    let parsed = JSON.parse(o.dispatch_orders);
                    if (typeof parsed === 'string') {
                        try {
                            parsed = JSON.parse(parsed);
                        } catch (e2) {
                            /* keep inner string */
                        }
                    }
                    o.dispatch_orders = parsed;
                } catch (e) {
                    /* leave string; parseDispatchOrdersFromDetail may still parse */
                }
            }
            return o;
        },

        /**
         * getKernelProductionHistory — history-specific read: intake, stage arrays, job card, QA, dispatch_orders.
         * Used by: modal_batch_history only.
         */
        getKernelProductionHistory: async function (kernelId, token = null, forceRefresh = false) {
            const raw = await this.callFunction('get_kernel_production_history', { p_kernel_id: kernelId }, token, {
                cacheKey: 'kernel_production_history_' + kernelId,
                useCache: !forceRefresh,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: forceRefresh
            });
            let detail = null;
            if (raw && typeof raw === 'object') {
                if (raw.id != null || raw.Id != null) detail = raw;
                else if (Array.isArray(raw.data) && raw.data[0]) detail = raw.data[0];
                else if (Array.isArray(raw) && raw[0]) detail = raw[0];
                else if (raw.get_kernel_production_history != null) {
                    const d = raw.get_kernel_production_history;
                    detail = Array.isArray(d) ? d[0] : d;
                } else if (raw.GetKernelProductionHistory != null) {
                    const d2 = raw.GetKernelProductionHistory;
                    detail = Array.isArray(d2) ? d2[0] : d2;
                }
            }
            if (!detail) return null;
            return this.normalizeKernelProductionHistoryDetail(detail);
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
            const result = await this._callWithActor('create_oil_stock_lot_simple', lotData, token, { useCache: false });
            this.clearCachePattern('oil_stock_lots');
            this.clearCachePattern('oil_stock_summary');
            return result;
        },

        updateOilStockLot: async function (lotId, lotData, token = null) {
            const params = { p_id: lotId, ...lotData };
            const result = await this._callWithActor('update_oil_stock_lot_simple', params, token, { useCache: false });
            this.clearCachePattern('oil_stock_lots');
            this.clearCachePattern('oil_stock_summary');
            return result;
        },

        deactivateOilStockLot: async function (lotId, token = null) {
            const result = await this._callWithActor('deactivate_oil_stock_lot', { p_id: lotId }, token, { useCache: false });
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
         * @param {object} data - { kernel_id }
         * @returns {Promise<object>} { success, kernel_id } or { success: false, error }
         */
        releaseKernelToProduction: async function (data, token = null) {
            const params = { p_kernel_id: data.kernel_id };
            const result = await this.callFunction('release_kernel_to_production', params, token, { useCache: false });
            this.clearCachePattern('kernel_batches');
            return result && (result.data !== undefined ? result.data : result);
        },

        /**
         * Stock (Kernel) → Kernel Production. Uses batch_number from the grid (reliable) + optional kernel id.
         */
        returnKernelFromStockToProduction: async function (kernelId, token = null, options) {
            const scope = this;
            options = options || {};
            const row = options.gridRow ? scope.normalizeKernelBatchRow(options.gridRow) : null;
            let batchNumber = (options.batchNumber != null ? String(options.batchNumber) : '').trim();
            let kid = (kernelId != null ? String(kernelId) : '').trim();
            if (row) {
                if (!batchNumber && row.batch_number) batchNumber = String(row.batch_number).trim();
                if (!kid && row.id) kid = String(row.id).trim();
            }
            const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            const params = scope.buildPostgrestRpcBody({
                p_batch_number: batchNumber || null,
                p_kernel_id: uuidRe.test(kid) ? kid : null
            });
            if (!params.p_batch_number && !params.p_kernel_id) {
                throw new Error('Batch reference missing. Refresh Stock (Kernel) and try again.');
            }
            const raw = await scope.callFunction(
                'return_kernel_from_stock_to_production',
                params,
                token,
                { useCache: false }
            );
            let inner = scope.unwrapKernelRpcJson(raw, 'return_kernel_from_stock_to_production') || raw;
            if (Array.isArray(inner) && inner.length) {
                inner = inner[0];
            }
            if (!inner || inner.success === false) {
                const label = batchNumber || kid || '?';
                throw new Error(
                    (inner && inner.error) ? String(inner.error) :
                        'Batch "' + label + '" is not in the database. Use Adjust Stock → Add Batch and wait for ' +
                        '"Batch created", then Ctrl+F5 before sending back to production.'
                );
            }
            if (inner.Success !== undefined && inner.success === undefined) {
                inner.success = inner.Success;
            }
            scope.clearCachePattern('kernel_batches');
            const resolvedId = inner.kernel_id || inner.kernelId || kid;
            if (resolvedId) {
                scope.clearCachePattern('kernel_batch_detail_' + resolvedId);
            }
            return inner;
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
            const result = await this._callWithActor('create_kernel_dispatch_order', params, token, { useCache: false });
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

        /**
         * @param {string|null} token
         * @param {boolean} forceRefresh
         * @param {{ batchSearch?: string, supplierReceivedDate?: string }|null} filters Optional: batchSearch matches buyer name or any line batch (substring + separator-insensitive on server); supplierReceivedDate is YYYY-MM-DD (kernel.received_date).
         */
        getKernelDispatchOrders: async function (token = null, forceRefresh = false, filters = null) {
            const f = filters && typeof filters === 'object' ? filters : null;
            const batchPart = f && f.batchSearch != null ? String(f.batchSearch).trim() : '';
            const datePart = f && f.supplierReceivedDate != null ? String(f.supplierReceivedDate).trim() : '';
            const hasFilter = !!(batchPart || datePart);
            // Only pass search args when filtering. DBs that still have the 2-arg RPC fail if extra keys are sent.
            const params = { p_limit: 100, p_offset: 0 };
            if (hasFilter) {
                params.p_batch_search = batchPart || null;
                params.p_supplier_received_date = datePart || null;
            }
            const cacheKey = hasFilter
                ? 'kernel_dispatch_orders_list|b=' + encodeURIComponent(batchPart) + '|d=' + encodeURIComponent(datePart)
                : 'kernel_dispatch_orders_list';
            const raw = await this.callFunction('get_kernel_dispatch_orders', params, token, {
                cacheKey: cacheKey,
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
                if (order.record != null && typeof order.record === 'string') {
                    try {
                        order.record = JSON.parse(order.record);
                    } catch (e) {
                        order.record = null;
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

        /** Move a dispatched basket back to awaiting dispatch; clears saved dispatch paperwork. */
        revertKernelDispatchOrder: async function (orderId, token = null) {
            const params = { p_order_id: orderId || null };
            const result = await this.callFunction('revert_kernel_dispatch_order', params, token, { useCache: false });
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
            const result = await this._callWithActor('create_oil_dispatch_order', params, token, { useCache: false });
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
                if (order.record != null && typeof order.record === 'string') {
                    try {
                        order.record = JSON.parse(order.record);
                    } catch (e) {
                        order.record = null;
                    }
                }
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

        // Financial Management Functions (placeholder — get_financial_transactions
        // does not exist in any database yet; skip the call until the feature is built)
        getFinancialTransactions: async function (token = null) {
            return [];
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
                p_description: data.description || null,
                p_parent_id: data.parent_id || null
            }, token, { useCache: false });
            this.clearCachePattern('document_categories');
            return result;
        },
        getOrCreateDocumentCategory: async function (name, parentId, token = null) {
            const result = await this.callFunction('get_or_create_document_category', {
                p_name: name,
                p_parent_id: parentId || null
            }, token, { useCache: false });
            this.clearCachePattern('document_categories');
            return result;
        },
        deleteDocumentCategory: async function (categoryId, token = null) {
            const result = await this.callFunction('delete_document_category_simple', { p_id: categoryId }, token, { useCache: false });
            this.clearCachePattern('document_categories');
            return result;
        },
        deleteDocumentFolderRecursive: async function (folderId, token = null) {
            const result = await this.callFunction('delete_document_folder_recursive', { p_id: folderId }, token, { useCache: false });
            this.clearCachePattern('document_categories');
            this.clearCachePattern('documents');
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
        },

        // --- Feedback & Issues register (admin / super_user) ---

        getIssues: async function (filters = {}, token = null) {
            const params = {
                p_type: filters.type || null,
                p_severity: filters.severity || null,
                p_status_group: filters.status_group || null
            };
            return await this.callFunction('get_issues', params, token, {
                useCache: false,
                cacheKey: 'issues_list'
            });
        },

        getIssueById: async function (issueId, token = null) {
            return await this.callFunction('get_issue_by_id', { p_id: issueId }, token, { useCache: false });
        },

        createIssue: async function (issueData, token = null) {
            const params = {
                p_title: issueData.title,
                p_type: issueData.type,
                p_severity: issueData.severity,
                p_description: issueData.description || null,
                p_area: issueData.area || null,
                p_steps_to_reproduce: issueData.steps_to_reproduce || null,
                p_business_benefit: issueData.business_benefit || null,
                p_route: issueData.route || null,
                p_reported_by: issueData.reported_by || null,
                p_reported_by_name: issueData.reported_by_name || null
            };
            const result = await this.callFunction('create_issue_simple', params, token, { useCache: false });
            this.clearCachePattern('issues');
            return result;
        },

        updateIssue: async function (issueId, issueData, token = null) {
            const params = {
                p_issue_id: issueId,
                p_title: issueData.title || null,
                p_description: issueData.description !== undefined ? issueData.description : null,
                p_type: issueData.type || null,
                p_area: issueData.area || null,
                p_severity: issueData.severity || null,
                p_status: issueData.status || null,
                p_steps_to_reproduce: issueData.steps_to_reproduce !== undefined ? issueData.steps_to_reproduce : null,
                p_business_benefit: issueData.business_benefit !== undefined ? issueData.business_benefit : null
            };
            const result = await this.callFunction('update_issue_simple', params, token, { useCache: false });
            this.clearCachePattern('issues');
            return result;
        },

        resolveIssue: async function (issueId, resolutionNotes, token = null) {
            const result = await this.callFunction('resolve_issue_simple', {
                p_issue_id: issueId,
                p_resolution_notes: resolutionNotes
            }, token, { useCache: false });
            this.clearCachePattern('issues');
            return result;
        },

        deleteIssue: async function (issueId, token = null) {
            const result = await this.callFunction('delete_issue_hard', { p_issue_id: issueId }, token, { useCache: false });
            this.clearCachePattern('issues');
            return result;
        },

        /** WhatsApp & Internal Chat functions */
        chatStartInternalConversation: async function (userId, otherUserId, token = null) {
            try {
                const raw = await this.callFunction('chat_start_internal_conversation', {
                    p_user_id: userId, p_other_user_id: otherUserId
                }, token, { useCache: false });
                const result = Array.isArray(raw) ? raw[0] : raw;
                return result || { success: 0, error: 'Empty response' };
            } catch (e) {
                return { success: 0, error: e.message || String(e) };
            }
        },

        chatStartContactConversation: async function (contactId, createdBy, token = null) {
            try {
                const raw = await this.callFunction('chat_start_contact_conversation', {
                    p_contact_id: contactId, p_created_by: createdBy
                }, token, { useCache: false });
                const result = Array.isArray(raw) ? raw[0] : raw;
                return result || { success: 0, error: 'Empty response' };
            } catch (e) {
                return { success: 0, error: e.message || String(e) };
            }
        },

        chatSendMessage: async function (conversationId, senderUserId, body, direction = 'internal', sendStatus = 'sent', externalMessageId = null, sendError = null, token = null) {
            try {
                const raw = await this.callFunction('chat_send_message', {
                    p_conversation_id: conversationId,
                    p_sender_user_id: senderUserId,
                    p_body: body,
                    p_direction: direction,
                    p_send_status: sendStatus,
                    p_external_message_id: externalMessageId,
                    p_send_error: sendError
                }, token, { useCache: false });
                const result = Array.isArray(raw) ? raw[0] : raw;
                return result || { success: 0, error: 'Empty response' };
            } catch (e) {
                return { success: 0, error: e.message || String(e) };
            }
        },

        chatUpdateMessageSendResult: async function (messageId, sendStatus, externalMessageId = null, sendError = null, token = null) {
            try {
                const raw = await this.callFunction('chat_update_message_send_result', {
                    p_message_id: messageId,
                    p_send_status: sendStatus,
                    p_external_message_id: externalMessageId,
                    p_send_error: sendError
                }, token, { useCache: false });
                const result = Array.isArray(raw) ? raw[0] : raw;
                return result || { success: 0, error: 'Empty response' };
            } catch (e) {
                return { success: 0, error: e.message || String(e) };
            }
        },

        chatListConversations: async function (userId, conversationType = null, token = null) {
            try {
                const raw = await this.callFunction('chat_list_conversations', {
                    p_user_id: userId, p_conversation_type: conversationType
                }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.chat_list_conversations)) return raw.chat_list_conversations;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Chat] chat_list_conversations failed:', e.message);
                return [];
            }
        },

        chatListMessages: async function (conversationId, requestingUserId, limit = 200, token = null) {
            try {
                const raw = await this.callFunction('chat_list_messages', {
                    p_conversation_id: conversationId,
                    p_requesting_user_id: requestingUserId,
                    p_limit: parseInt(limit, 10) || 200
                }, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.chat_list_messages)) return raw.chat_list_messages;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Chat] chat_list_messages failed:', e.message);
                return [];
            }
        },

        chatMarkConversationRead: async function (conversationId, userId, token = null) {
            try {
                const raw = await this.callFunction('chat_mark_conversation_read', {
                    p_conversation_id: conversationId, p_user_id: userId
                }, token, { useCache: false });
                const result = Array.isArray(raw) ? raw[0] : raw;
                return result || { success: 0, error: 'Empty response' };
            } catch (e) {
                return { success: 0, error: e.message || String(e) };
            }
        },

        chatGetUnreadCount: async function (userId, token = null) {
            try {
                const raw = await this.callFunction('chat_get_unread_count', {
                    p_user_id: userId
                }, token, { useCache: false });
                // RPC returns integer directly
                return typeof raw === 'number' ? raw : (parseInt(raw, 10) || 0);
            } catch (e) {
                console.warn('[Chat] chat_get_unread_count failed:', e.message);
                return 0;
            }
        },

        getContactsForMessaging: async function (token = null) {
            try {
                const raw = await this.callFunction('get_contacts_for_messaging', {}, token, { useCache: false });
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.get_contacts_for_messaging)) return raw.get_contacts_for_messaging;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                console.warn('[Chat] get_contacts_for_messaging failed:', e.message);
                return [];
            }
        },

        /**
         * Shared WhatsApp inbox (migration 20260813090000_whatsapp_inbound_shared_inbox).
         *
         * These back the WhatsApp tab instead of the participant-gated chat_list_*
         * RPCs, because an inbound message from an unrecognised number has no
         * chat_participants rows and must still be visible to the team.
         *
         * FEATURE-DETECTED. Return-value contract, which callers rely on:
         *   null  -> the RPC does not exist on this database (migration not applied);
         *            the caller must fall back to the old contact-only behaviour.
         *   []    -> the RPC exists; no rows (or a transient failure already logged).
         * Anything else is data. Do not collapse null and [] — they mean different
         * things, and conflating them makes the tab silently show an empty inbox on a
         * database that simply has not been migrated yet.
         */
        _whatsappInboxAvailable: null, // null = not probed yet, true/false once known

        /** True when an RPC failure means "function not present" rather than "call failed". */
        isMissingFunctionError: function (e) {
            const msg = ((e && e.message) ? e.message : String(e || '')).toLowerCase();
            return msg.includes('pgrst202') ||
                   msg.includes('could not find the function') ||
                   msg.includes('does not exist');
        },

        chatListWhatsappConversations: async function (userId, token = null) {
            if (this._whatsappInboxAvailable === false) return null;
            try {
                const raw = await this.callFunction('chat_list_whatsapp_conversations', {
                    p_user_id: userId
                }, token, { useCache: false });
                this._whatsappInboxAvailable = true;
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.chat_list_whatsapp_conversations)) return raw.chat_list_whatsapp_conversations;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                if (this.isMissingFunctionError(e)) {
                    this._whatsappInboxAvailable = false;
                    console.warn('[Chat] Shared WhatsApp inbox not available on this database — falling back to contact-only conversations.');
                    return null;
                }
                console.warn('[Chat] chat_list_whatsapp_conversations failed:', e.message);
                return [];
            }
        },

        chatListWhatsappMessages: async function (conversationId, requestingUserId, limit = 200, token = null) {
            if (this._whatsappInboxAvailable === false) return null;
            try {
                const raw = await this.callFunction('chat_list_whatsapp_messages', {
                    p_conversation_id: conversationId,
                    p_requesting_user_id: requestingUserId,
                    p_limit: parseInt(limit, 10) || 200
                }, token, { useCache: false });
                this._whatsappInboxAvailable = true;
                if (Array.isArray(raw)) return raw;
                if (raw && Array.isArray(raw.chat_list_whatsapp_messages)) return raw.chat_list_whatsapp_messages;
                if (raw && Array.isArray(raw.data)) return raw.data;
                return [];
            } catch (e) {
                if (this.isMissingFunctionError(e)) {
                    this._whatsappInboxAvailable = false;
                    return null;
                }
                console.warn('[Chat] chat_list_whatsapp_messages failed:', e.message);
                return [];
            }
        },

        chatMarkWhatsappRead: async function (conversationId, userId, token = null) {
            if (this._whatsappInboxAvailable === false) return null;
            try {
                const raw = await this.callFunction('chat_mark_whatsapp_read', {
                    p_conversation_id: conversationId, p_user_id: userId
                }, token, { useCache: false });
                const result = Array.isArray(raw) ? raw[0] : raw;
                return result || { success: 0, error: 'Empty response' };
            } catch (e) {
                if (this.isMissingFunctionError(e)) {
                    this._whatsappInboxAvailable = false;
                    return null;
                }
                return { success: 0, error: e.message || String(e) };
            }
        },

        /**
         * Join a shared-inbox conversation as a participant. Needed before replying to a
         * conversation created by an inbound message, because chat_send_message refuses
         * non-participants and inbound-created conversations start with none.
         */
        chatJoinWhatsappConversation: async function (conversationId, userId, token = null) {
            if (this._whatsappInboxAvailable === false) return null;
            try {
                const raw = await this.callFunction('chat_join_whatsapp_conversation', {
                    p_conversation_id: conversationId, p_user_id: userId
                }, token, { useCache: false });
                const result = Array.isArray(raw) ? raw[0] : raw;
                return result || { success: 0, error: 'Empty response' };
            } catch (e) {
                if (this.isMissingFunctionError(e)) {
                    this._whatsappInboxAvailable = false;
                    return null;
                }
                return { success: 0, error: e.message || String(e) };
            }
        },

        chatGetWhatsappUnreadCount: async function (userId, token = null) {
            if (this._whatsappInboxAvailable === false) return null;
            try {
                const raw = await this.callFunction('chat_get_whatsapp_unread_count', {
                    p_user_id: userId
                }, token, { useCache: false });
                // RPC returns integer directly
                return typeof raw === 'number' ? raw : (parseInt(raw, 10) || 0);
            } catch (e) {
                if (this.isMissingFunctionError(e)) {
                    this._whatsappInboxAvailable = false;
                    return null;
                }
                console.warn('[Chat] chat_get_whatsapp_unread_count failed:', e.message);
                return null;
            }
        },

        /** Send WhatsApp message via edge function (not PostgREST RPC). */
        sendWhatsappMessageNow: async function (to, body, token = null) {
            try {
                const supabaseConfig = window.MACAVATION_SUPABASE || {};
                const url = (supabaseConfig.url || '').replace(/\/$/, '') + '/functions/v1/send-whatsapp-message';
                const anonKey = supabaseConfig.anonKey || '';
                const authToken = token || this.getToken();

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + anonKey,
                        'apikey': anonKey,
                        'X-Portal-Session': authToken || ''
                    },
                    body: JSON.stringify({ to, body })
                });

                const data = await res.json();

                if (!res.ok) {
                    return {
                        success: false,
                        error: data.error || 'HTTP ' + res.status
                    };
                }

                return data;
            } catch (e) {
                return {
                    success: false,
                    error: e.message || String(e)
                };
            }
        },

        /**
         * One-way ClickUp sync via sync_issue_to_clickup (backend only).
         * Does not roll back the saved issue on failure; errors stay in console.
         */
        syncIssueToClickUp: async function (issueId, force = false, token = null) {
            try {
                const data = await this.callFunction('sync_issue_to_clickup', {
                    p_issue_id: issueId,
                    p_force: !!force
                }, token, { useCache: false });
                const result = Array.isArray(data) ? data[0] : data;
                return result || { success: false, error: 'Empty sync response' };
            } catch (e) {
                return { success: false, error: e.message || String(e) };
            }
        },

        // ------------------------------------------------------------------
        // Report builder RPC wrappers. These call pre-existing
        // SECURITY DEFINER functions from migrations/20260817090000 and
        // migrations/20260817100000; whether either migration has been
        // applied to any database cannot be verified from this checkout.
        // None of these swallows an RPC error into a fake success/empty
        // value — a missing migration must surface as a thrown error, not
        // look like "no reports yet".
        // ------------------------------------------------------------------

        getReportTemplates: async function (periodType = null, token = null, forceRefresh = false) {
            const params = { p_period_type: periodType || null };
            const cacheKey = 'report_list_templates_' + (params.p_period_type || 'all');
            return await this.callFunction('get_report_templates', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        getReportCurrentPeriod: async function (periodType, token = null, forceRefresh = false) {
            const pt = (periodType != null ? String(periodType) : '').trim();
            if (!pt) throw new Error('getReportCurrentPeriod: periodType is required.');
            const params = { p_period_type: pt };
            const cacheKey = 'report_list_current_period_' + params.p_period_type;
            return await this.callFunction('get_report_current_period', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        listReportInstances: async function (filters = {}, token = null, forceRefresh = false) {
            const params = {
                p_period_type: filters.period_type || null,
                p_status: filters.status || null,
                p_limit: filters.limit || 50,
                p_offset: filters.offset || 0
            };
            const cacheKey = 'report_list_' + (params.p_period_type || 'all') + '_' +
                (params.p_status || 'all') + '_' + params.p_limit + '_' + params.p_offset;
            return await this.callFunction('list_report_instances', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        createReportInstance: async function (templateId, periodDate, token = null) {
            const tid = (templateId != null ? String(templateId) : '').trim();
            const pdate = (periodDate != null ? String(periodDate) : '').trim();
            if (!tid) throw new Error('createReportInstance: templateId is required.');
            if (!pdate) throw new Error('createReportInstance: periodDate is required.');
            const params = {
                p_template_id: tid,
                p_period_date: pdate,
                p_actor_user_id: this.getCurrentUserId() || undefined
            };
            // functionName contains "create": callFunction queues this while offline and
            // returns { success: true, offline: true, queued: true } instead of calling the RPC.
            const result = await this.callFunction('create_report_instance', params, token, { useCache: false });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        getReportInstance: async function (reportInstanceId, token = null, forceRefresh = false) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            if (!id) throw new Error('getReportInstance: reportInstanceId is required.');
            const params = { p_report_instance_id: id };
            const cacheKey = 'report_instance_' + params.p_report_instance_id;
            return await this.callFunction('get_report_instance', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        overrideReportMetricValue: async function (reportInstanceId, metricKey, enteredValue, reason, token = null) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            const key = (metricKey != null ? String(metricKey) : '').trim();
            const reasonText = (reason != null ? String(reason) : '').trim();
            if (!id) throw new Error('overrideReportMetricValue: reportInstanceId is required.');
            if (!key) throw new Error('overrideReportMetricValue: metricKey is required.');
            if (!Number.isFinite(Number(enteredValue))) throw new Error('overrideReportMetricValue: enteredValue must be a number.');
            if (!reasonText) throw new Error('overrideReportMetricValue: reason is required.');
            const params = {
                p_report_instance_id: id,
                p_metric_key: key,
                p_entered_value: Number(enteredValue),
                p_reason: reasonText,
                p_actor_user_id: this.getCurrentUserId() || undefined
            };
            const result = await this.callFunction('override_report_metric_value', params, token, { useCache: false });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        clearReportMetricOverride: async function (reportInstanceId, metricKey, token = null) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            const key = (metricKey != null ? String(metricKey) : '').trim();
            if (!id) throw new Error('clearReportMetricOverride: reportInstanceId is required.');
            if (!key) throw new Error('clearReportMetricOverride: metricKey is required.');
            const params = { p_report_instance_id: id, p_metric_key: key };
            const result = await this.callFunction('clear_report_metric_override', params, token, { useCache: false });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        setReportSectionState: async function (reportInstanceId, sectionKey, changes = {}, token = null) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            const key = (sectionKey != null ? String(sectionKey) : '').trim();
            if (!id) throw new Error('setReportSectionState: reportInstanceId is required.');
            if (!key) throw new Error('setReportSectionState: sectionKey is required.');
            const hasEnabled = changes.is_enabled === true || changes.is_enabled === false;
            const hasCommentary = typeof changes.commentary === 'string';
            if (!hasEnabled && !hasCommentary) throw new Error('setReportSectionState: nothing to change.');
            // undefined (never null) leaves the server-side COALESCE on the untouched field alone.
            // preserveEmptyParams is per-call, which is why id and key are validated above.
            const params = {
                p_report_instance_id: id,
                p_section_key: key,
                p_is_enabled: hasEnabled ? changes.is_enabled : undefined,
                p_commentary: hasCommentary ? changes.commentary : undefined
            };
            const result = await this.callFunction('set_report_section_state', params, token, {
                useCache: false,
                preserveEmptyParams: true
            });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        setReportExecutiveSummary: async function (reportInstanceId, summary, token = null) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            if (!id) throw new Error('setReportExecutiveSummary: reportInstanceId is required.');
            // p_summary has NO DEFAULT: it must be in the body every time, '' included.
            const params = {
                p_report_instance_id: id,
                p_summary: (summary == null) ? '' : String(summary)
            };
            const result = await this.callFunction('set_report_executive_summary', params, token, {
                useCache: false,
                preserveEmptyParams: true
            });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        refreshReportInstance: async function (reportInstanceId, token = null) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            if (!id) throw new Error('refreshReportInstance: reportInstanceId is required.');
            const params = { p_report_instance_id: id };
            const result = await this.callFunction('refresh_report_instance', params, token, { useCache: false });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        deleteReportInstance: async function (reportInstanceId, token = null) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            if (!id) throw new Error('deleteReportInstance: reportInstanceId is required.');
            const params = { p_report_instance_id: id };
            // functionName contains "delete": callFunction queues this while offline and
            // returns { success: true, offline: true, queued: true } instead of calling the RPC.
            const result = await this.callFunction('delete_report_instance', params, token, { useCache: false });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        publishReportInstance: async function (reportInstanceId, token = null) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            if (!id) throw new Error('publishReportInstance: reportInstanceId is required.');
            const params = {
                p_report_instance_id: id,
                p_actor_user_id: this.getCurrentUserId() || undefined
                // p_pdf_storage_bucket / p_pdf_storage_path / p_pdf_sha256 all DEFAULT NULL and are
                // omitted entirely here — storage arrives in a later plan.
            };
            const result = await this.callFunction('publish_report_instance', params, token, { useCache: false });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        supersedeReportInstance: async function (reportInstanceId, reason, token = null) {
            const id = (reportInstanceId != null ? String(reportInstanceId) : '').trim();
            const reasonText = (reason != null ? String(reason) : '').trim();
            if (!id) throw new Error('supersedeReportInstance: reportInstanceId is required.');
            if (!reasonText) throw new Error('supersedeReportInstance: reason is required.');
            const params = {
                p_report_instance_id: id,
                p_reason: reasonText,
                p_actor_user_id: this.getCurrentUserId() || undefined
            };
            const result = await this.callFunction('supersede_report_instance', params, token, { useCache: false });
            this.clearCachePattern('report_instance_');
            this.clearCachePattern('report_list_');
            return result;
        },

        // ------------------------------------------------------------------
        // Report period targets / manual baselines (migrations/20260817090000 get_report_metrics;
        // migrations/20260817100000 the other five). Whether either migration has been applied to
        // any database cannot be verified from this checkout — every write clears both the
        // report_targets_ and report_instance_ cache prefixes, because a changed target changes
        // what a draft report shows after its next refresh.
        // ------------------------------------------------------------------

        getReportMetrics: async function (sectionKey = null, periodType = null, token = null, forceRefresh = false) {
            const sk = sectionKey || null;
            const pt = periodType || null;
            const params = { p_section_key: sk, p_period_type: pt };
            const cacheKey = 'report_targets_metrics_' + (sk || 'all') + '_' + (pt || 'all');
            return await this.callFunction('get_report_metrics', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        getReportPeriodTargets: async function (periodType, periodStart, token = null, forceRefresh = false) {
            const pt = (periodType != null ? String(periodType) : '').trim();
            const ps = (periodStart != null ? String(periodStart) : '').trim();
            if (!pt) throw new Error('getReportPeriodTargets: periodType is required.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ps)) throw new Error('getReportPeriodTargets: periodStart must be yyyy-mm-dd.');
            const params = { p_period_type: pt, p_period_start: ps };
            const cacheKey = 'report_targets_period_' + pt + '_' + ps;
            return await this.callFunction('get_report_period_targets', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        upsertReportPeriodTarget: async function (metricKey, periodType, periodDate, targetValue, notes = null, token = null) {
            const key = (metricKey != null ? String(metricKey) : '').trim();
            const pt = (periodType != null ? String(periodType) : '').trim();
            const pd = (periodDate != null ? String(periodDate) : '').trim();
            if (!key) throw new Error('upsertReportPeriodTarget: metricKey is required.');
            if (!pt) throw new Error('upsertReportPeriodTarget: periodType is required.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(pd)) throw new Error('upsertReportPeriodTarget: periodDate must be yyyy-mm-dd.');
            if (!Number.isFinite(Number(targetValue))) throw new Error('upsertReportPeriodTarget: targetValue must be a number.');
            const params = {
                p_metric_key: key,
                p_period_type: pt,
                p_period_date: pd,
                p_target_value: Number(targetValue),
                p_notes: notes || null,
                p_actor_user_id: this.getCurrentUserId() || undefined
            };
            const result = await this.callFunction('upsert_report_period_target', params, token, { useCache: false });
            this.clearCachePattern('report_targets_');
            this.clearCachePattern('report_instance_');
            return result;
        },

        copyReportPeriodTargets: async function (periodType, fromPeriod, toPeriod, token = null) {
            const pt = (periodType != null ? String(periodType) : '').trim();
            const fp = (fromPeriod != null ? String(fromPeriod) : '').trim();
            const tp = (toPeriod != null ? String(toPeriod) : '').trim();
            if (!pt) throw new Error('copyReportPeriodTargets: periodType is required.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(fp)) throw new Error('copyReportPeriodTargets: fromPeriod must be yyyy-mm-dd.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(tp)) throw new Error('copyReportPeriodTargets: toPeriod must be yyyy-mm-dd.');
            const params = {
                p_period_type: pt,
                p_from_period: fp,
                p_to_period: tp,
                p_actor_user_id: this.getCurrentUserId() || undefined
            };
            const result = await this.callFunction('copy_report_period_targets', params, token, { useCache: false });
            this.clearCachePattern('report_targets_');
            this.clearCachePattern('report_instance_');
            return result;
        },

        getReportManualBaselines: async function (periodType, fy, token = null, forceRefresh = false) {
            const pt = (periodType != null ? String(periodType) : '').trim();
            if (!pt) throw new Error('getReportManualBaselines: periodType is required.');
            if (!Number.isFinite(Number(fy))) throw new Error('getReportManualBaselines: fy must be a number.');
            const params = { p_period_type: pt, p_fy: Number(fy) };
            const cacheKey = 'report_targets_baselines_' + pt + '_' + Number(fy);
            return await this.callFunction('get_report_manual_baselines', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        upsertReportManualBaseline: async function (metricKey, periodType, periodDate, achievedValue, notes = null, token = null) {
            const key = (metricKey != null ? String(metricKey) : '').trim();
            const pt = (periodType != null ? String(periodType) : '').trim();
            const pd = (periodDate != null ? String(periodDate) : '').trim();
            if (!key) throw new Error('upsertReportManualBaseline: metricKey is required.');
            if (!pt) throw new Error('upsertReportManualBaseline: periodType is required.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(pd)) throw new Error('upsertReportManualBaseline: periodDate must be yyyy-mm-dd.');
            if (!Number.isFinite(Number(achievedValue))) throw new Error('upsertReportManualBaseline: achievedValue must be a number.');
            const params = {
                p_metric_key: key,
                p_period_type: pt,
                p_period_date: pd,
                p_achieved_value: Number(achievedValue),
                p_notes: notes || null,
                p_actor_user_id: this.getCurrentUserId() || undefined
            };
            const result = await this.callFunction('upsert_report_manual_baseline', params, token, { useCache: false });
            this.clearCachePattern('report_targets_');
            this.clearCachePattern('report_instance_');
            return result;
        },

        // ------------------------------------------------------------------
        // Report WhatsApp distribution — transport only. sendReportWhatsapp calls the edge
        // function that is meant to deliver a report PDF over WhatsApp; supabase/functions/ does
        // not contain a send-report-whatsapp function in this checkout, so this wrapper returns a
        // handled { success: false, error } object rather than throwing when the call 404s or the
        // fetch itself fails — the same "never look like success" rule as the report-builder
        // wrappers above, just expressed as a returned failure instead of a thrown one, because an
        // edge-function call (unlike a PostgREST RPC) is expected to report its own transport
        // failures back to the caller.
        //
        // As of this commit, no migration under migrations/ defines list_report_recipients,
        // upsert_report_recipient, set_report_recipient_active or list_report_deliveries (checked
        // by grep immediately before writing this block), so those four PostgREST wrappers are not
        // implemented here — adding them against a guessed signature would silently call a
        // function this repo does not define. They are deferred until a later plan commits the SQL
        // that defines them.
        //
        // Whether any migration referenced anywhere in this file, or the edge function above, has
        // actually been deployed to any given database or project cannot be verified from this
        // checkout — the same caveat every neighbouring block in this file carries.
        // ------------------------------------------------------------------

        /** Send a report PDF via WhatsApp through the send-report-whatsapp edge function. */
        sendReportWhatsapp: async function (payload, token = null) {
            const reportInstanceId = (payload && payload.reportInstanceId != null) ? String(payload.reportInstanceId).trim() : '';
            const pdfBase64 = (payload && payload.pdfBase64 != null) ? String(payload.pdfBase64) : '';
            const filename = (payload && payload.filename != null) ? String(payload.filename).trim() : '';
            const recipients = (payload && Array.isArray(payload.recipients)) ? payload.recipients : null;

            if (!reportInstanceId) throw new Error('sendReportWhatsapp: reportInstanceId is required.');
            if (!pdfBase64.trim()) throw new Error('sendReportWhatsapp: pdfBase64 is required.');
            if (!filename || !/\.pdf$/i.test(filename)) throw new Error('sendReportWhatsapp: filename is required and must end in .pdf.');
            if (!recipients || recipients.length === 0) throw new Error('sendReportWhatsapp: recipients must be a non-empty array.');
            for (const r of recipients) {
                if (!r || !r.phone || !String(r.phone).trim()) {
                    throw new Error('sendReportWhatsapp: every recipient must have a non-empty phone.');
                }
            }

            // Never post a confidential report PDF bearing only the public anon key — require a
            // real portal session token before issuing the fetch at all.
            const authToken = token || this.getToken();
            if (!authToken) {
                return { success: false, error: 'sendReportWhatsapp: no portal session; not sending.' };
            }

            try {
                const supabaseConfig = window.MACAVATION_SUPABASE || {};
                const url = (supabaseConfig.url || '').replace(/\/$/, '') + '/functions/v1/send-report-whatsapp';
                const anonKey = supabaseConfig.anonKey || '';

                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + anonKey,
                        'apikey': anonKey,
                        'X-Portal-Session': authToken
                    },
                    body: JSON.stringify({
                        report_instance_id: reportInstanceId,
                        pdf_base64: pdfBase64,
                        filename: filename,
                        recipients: recipients
                    })
                });

                const data = await res.json();

                if (!res.ok) {
                    return {
                        success: false,
                        error: data.error || 'HTTP ' + res.status
                    };
                }

                // Response shape is authored by the send-report-whatsapp edge function itself
                // (not present in this checkout) — returned unchanged, not reshaped or assumed.
                return data;
            } catch (e) {
                // Never log pdfBase64 — it is the full contents of a confidential report.
                console.warn('[Report] sendReportWhatsapp failed:', e.message);
                return {
                    success: false,
                    error: e.message || String(e)
                };
            } finally {
                // No wrapper in this file yet writes the 'report_deliveries_' or
                // 'report_recipients_' cache prefixes (see block comment above), so both calls are
                // harmless no-ops today — clearCachePattern only deletes matching keys it finds.
                // They stay here so a later plan that adds those wrappers does not also have to
                // remember to add the cache invalidation here.
                this.clearCachePattern('report_deliveries_');
                this.clearCachePattern('report_recipients_');
            }
        },

        // ------------------------------------------------------------------
        // Sales & Production Data page (migrations/20260819090000_data_page_production_daily.sql).
        // Whether that migration has been applied to any given database cannot be verified from
        // this checkout — every wrapper here throws a clean local error for a bad argument (so a
        // no-DEFAULT param is never silently stripped into a "function not found"), but a missing
        // RPC itself still surfaces as a thrown error for the caller to catch, exactly like the
        // report-builder wrappers above.
        // ------------------------------------------------------------------

        getDataDatasets: async function (token = null, forceRefresh = false) {
            return await this.callFunction('get_data_datasets', {}, token, {
                cacheKey: 'sales_data_datasets',
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        // report_normalise_period_start(p_period_type, p_date) has no parameter DEFAULTs — never
        // call it with a null/blank date, or PostgREST strips the param and reports the function
        // missing (indistinguishable from an unapplied migration).
        getReportPeriodStart: async function (periodType, isoDate, token = null, forceRefresh = false) {
            const pt = (periodType != null ? String(periodType) : '').trim();
            const iso = (isoDate != null ? String(isoDate) : '').trim();
            if (!pt) throw new Error('getReportPeriodStart: periodType is required.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('getReportPeriodStart: isoDate must be yyyy-mm-dd.');
            const params = { p_period_type: pt, p_date: iso };
            return await this.callFunction('report_normalise_period_start', params, token, {
                cacheKey: 'sales_data_period_start_' + pt + '_' + iso,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        // report_period_end(p_period_type, p_period_start) — same no-DEFAULT caveat as above.
        getReportPeriodEnd: async function (periodType, isoPeriodStart, token = null, forceRefresh = false) {
            const pt = (periodType != null ? String(periodType) : '').trim();
            const iso = (isoPeriodStart != null ? String(isoPeriodStart) : '').trim();
            if (!pt) throw new Error('getReportPeriodEnd: periodType is required.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('getReportPeriodEnd: isoPeriodStart must be yyyy-mm-dd.');
            const params = { p_period_type: pt, p_period_start: iso };
            return await this.callFunction('report_period_end', params, token, {
                cacheKey: 'sales_data_period_end_' + pt + '_' + iso,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        getDataProductionDaily: async function (dateFrom, dateTo, limit = 100, offset = 0, token = null, forceRefresh = false) {
            const params = {
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_limit: limit || 100,
                p_offset: offset || 0
            };
            const cacheKey = 'sales_data_production_daily_' + (params.p_date_from || 'x') + '_' +
                (params.p_date_to || 'x') + '_' + params.p_limit + '_' + params.p_offset;
            return await this.callFunction('get_data_production_daily', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        upsertDataProductionDailyRows: async function (rows, token = null) {
            // Pass the array itself, NOT JSON.stringify(rows) — PostgREST serialises the whole
            // body to JSON, so a pre-stringified array arrives as a jsonb *string* and the RPC
            // rejects it with "p_rows must be a JSON array"
            // (migrations/20260819090000_data_page_production_daily.sql:368-373).
            const params = {
                p_rows: Array.isArray(rows) ? rows : [rows],
                p_actor_user_id: this.getCurrentUserId() || null
            };
            const result = await this.callFunction('upsert_data_production_daily_rows', params, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        deleteDataProductionDailyRow: async function (productionDate, token = null) {
            const iso = (productionDate != null ? String(productionDate) : '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('deleteDataProductionDailyRow: productionDate must be yyyy-mm-dd.');
            const params = { p_production_date: iso };
            // functionName contains "delete": callFunction queues this while offline and
            // returns { success: true, offline: true, queued: true } instead of calling the RPC.
            const result = await this.callFunction('delete_data_production_daily_row', params, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        reseedDataProductionDaily: async function (dateFrom, dateTo, token = null) {
            const params = {
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_actor_user_id: this.getCurrentUserId() || null
            };
            const result = await this.callFunction('reseed_data_production_daily', params, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        getDataProductionDailyDrift: async function (dateFrom, dateTo, limit = 200, offset = 0, token = null, forceRefresh = false) {
            const params = {
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_limit: limit || 200,
                p_offset: offset || 0
            };
            const cacheKey = 'sales_data_production_daily_drift_' + (params.p_date_from || 'x') + '_' +
                (params.p_date_to || 'x') + '_' + params.p_limit + '_' + params.p_offset;
            return await this.callFunction('get_data_production_daily_drift', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        // ------------------------------------------------------------------
        // Kernel sales ledger (migrations/20260819100000_data_page_sales.sql).
        // ------------------------------------------------------------------

        // p_limit is capped at 500 server-side, so 500 is the largest page worth asking for.
        getDataKernelSalesLines: async function (dateFrom, dateTo, limit = 500, offset = 0, token = null, forceRefresh = false) {
            const params = {
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_limit: limit || 500,
                p_offset: offset || 0
            };
            const cacheKey = 'sales_data_kernel_sales_' + (params.p_date_from || 'x') + '_' +
                (params.p_date_to || 'x') + '_' + params.p_limit + '_' + params.p_offset;
            return await this.callFunction('get_data_kernel_sales_lines', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        // The RPC is a WHOLE-ROW upsert: customer_id, invoice_number, item_code, style_code,
        // description, cartons, price_per_kg and notes are assigned with no COALESCE back to the
        // stored value, so any column left out of a row is nulled in the database. Always send the
        // complete row (collectRowPayload does) — never a partial patch.
        upsertDataKernelSalesLines: async function (rows, token = null) {
            // Pass the array itself, NOT JSON.stringify(rows) — PostgREST serialises the body, so a
            // pre-stringified array arrives as a jsonb string and the RPC rejects it.
            const params = {
                p_rows: Array.isArray(rows) ? rows : [rows],
                p_actor_user_id: this.getCurrentUserId() || null
            };
            const result = await this.callFunction('upsert_data_kernel_sales_lines', params, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        deleteDataKernelSalesLine: async function (id, token = null) {
            const key = (id != null ? String(id) : '').trim();
            if (!key) throw new Error('deleteDataKernelSalesLine: id is required.');
            const result = await this.callFunction('delete_data_kernel_sales_line', { p_id: key }, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        // ------------------------------------------------------------------
        // Oil & protein sales ledger. Same contract as the kernel sales trio above, including the
        // whole-row upsert caveat — product_line, customer_id, invoice_number, item_code and the
        // rest are assigned with no COALESCE back to the stored value, so a partial row nulls
        // whatever it leaves out.
        // ------------------------------------------------------------------

        getDataOilSalesLines: async function (dateFrom, dateTo, limit = 500, offset = 0, token = null, forceRefresh = false) {
            const params = {
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_limit: limit || 500,
                p_offset: offset || 0
            };
            const cacheKey = 'sales_data_oil_sales_' + (params.p_date_from || 'x') + '_' +
                (params.p_date_to || 'x') + '_' + params.p_limit + '_' + params.p_offset;
            return await this.callFunction('get_data_oil_sales_lines', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        upsertDataOilSalesLines: async function (rows, token = null) {
            // Pass the array itself, NOT JSON.stringify(rows).
            const params = {
                p_rows: Array.isArray(rows) ? rows : [rows],
                p_actor_user_id: this.getCurrentUserId() || null
            };
            const result = await this.callFunction('upsert_data_oil_sales_lines', params, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        deleteDataOilSalesLine: async function (id, token = null) {
            const key = (id != null ? String(id) : '').trim();
            if (!key) throw new Error('deleteDataOilSalesLine: id is required.');
            const result = await this.callFunction('delete_data_oil_sales_line', { p_id: key }, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        // ------------------------------------------------------------------
        // Oil export register. Same whole-row upsert caveat as the two sales ledgers, and the same
        // "an insert with no date is silently skipped" guard — here the date column is export_date.
        // ------------------------------------------------------------------

        getDataOilExportRegister: async function (dateFrom, dateTo, limit = 500, offset = 0, token = null, forceRefresh = false) {
            const params = {
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_limit: limit || 500,
                p_offset: offset || 0
            };
            const cacheKey = 'sales_data_oil_export_' + (params.p_date_from || 'x') + '_' +
                (params.p_date_to || 'x') + '_' + params.p_limit + '_' + params.p_offset;
            return await this.callFunction('get_data_oil_export_register', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        upsertDataOilExportRegister: async function (rows, token = null) {
            // Pass the array itself, NOT JSON.stringify(rows).
            const params = {
                p_rows: Array.isArray(rows) ? rows : [rows],
                p_actor_user_id: this.getCurrentUserId() || null
            };
            const result = await this.callFunction('upsert_data_oil_export_register', params, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        // The RPC name ends in _row, not _line, unlike the two sales-line deletes above.
        deleteDataOilExportRegisterRow: async function (id, token = null) {
            const key = (id != null ? String(id) : '').trim();
            if (!key) throw new Error('deleteDataOilExportRegisterRow: id is required.');
            const result = await this.callFunction('delete_data_oil_export_register_row', { p_id: key }, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        // ------------------------------------------------------------------
        // Nut-in-shell intake (migrations/20260819130000_data_page_nis_intake.sql). The only ledger
        // with a factory mirror: moisture/PV/FFA carry *_system twins that reseed_data_nis_intake
        // refreshes. Same whole-row upsert caveat as the other ledgers. Note received_date is
        // NULLABLE and the insert has no date guard, unlike the sales ledgers.
        // ------------------------------------------------------------------

        getDataNisIntake: async function (dateFrom, dateTo, limit = 500, offset = 0, token = null, forceRefresh = false) {
            const params = {
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_limit: limit || 500,
                p_offset: offset || 0
            };
            const cacheKey = 'sales_data_nis_intake_' + (params.p_date_from || 'x') + '_' +
                (params.p_date_to || 'x') + '_' + params.p_limit + '_' + params.p_offset;
            return await this.callFunction('get_data_nis_intake', params, token, {
                cacheKey: cacheKey,
                useCache: true,
                cacheTtl: this.cache.ttl.dynamic,
                forceRefresh: !!forceRefresh
            });
        },

        upsertDataNisIntakeRows: async function (rows, token = null) {
            // Pass the array itself, NOT JSON.stringify(rows).
            const params = {
                p_rows: Array.isArray(rows) ? rows : [rows],
                p_actor_user_id: this.getCurrentUserId() || null
            };
            const result = await this.callFunction('upsert_data_nis_intake_rows', params, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        deleteDataNisIntakeRow: async function (id, token = null) {
            const key = (id != null ? String(id) : '').trim();
            if (!key) throw new Error('deleteDataNisIntakeRow: id is required.');
            const result = await this.callFunction('delete_data_nis_intake_row', { p_id: key }, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        // Writes the *_system mirror columns only — never the effective figures Pete has entered.
        reseedDataNisIntake: async function (dateFrom, dateTo, token = null) {
            const params = {
                p_date_from: dateFrom || null,
                p_date_to: dateTo || null,
                p_actor_user_id: this.getCurrentUserId() || null
            };
            const result = await this.callFunction('reseed_data_nis_intake', params, token, { useCache: false });
            this.clearCachePattern('sales_data_');
            return result;
        },

        // Reference data for the Style dropdown. Static TTL like getContacts — the registry holds
        // 11 rows and changes rarely.
        getKernelStyles: async function (includeInactive = false, token = null, forceRefresh = false) {
            const params = { p_include_inactive: !!includeInactive };
            return await this.callFunction('get_kernel_styles', params, token, {
                cacheKey: 'kernel_styles_' + (includeInactive ? 'all' : 'active'),
                useCache: true,
                cacheTtl: this.cache.ttl.static,
                forceRefresh: !!forceRefresh
            });
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
        // Pass the array itself, NOT JSON.stringify(rows). PostgREST serialises the whole
        // body to JSON, so a pre-stringified array arrives as a jsonb *string* and
        // import_table_rows rejects it with "p_rows must be a JSON array".
        const params = {
            p_table_name: tableName,
            p_rows: Array.isArray(rows) ? rows : [rows]
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