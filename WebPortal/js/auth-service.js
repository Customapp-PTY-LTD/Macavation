/**
 * Authentication Service for Macavation
 * Direct Supabase only — no AWS Lambda proxy.
 */

function resolveSupabaseAuthConfig() {
    const cfg = (typeof window !== 'undefined' && window.MACAVATION_SUPABASE) ? window.MACAVATION_SUPABASE : null;
    if (!cfg || !cfg.url || !cfg.anonKey) {
        // Never guess a database: fail loudly instead of authenticating
        // against the wrong environment.
        throw new Error('auth-service.js: macavation-supabase.js must be loaded first.');
    }
    return cfg;
}

class AuthService {
    constructor() {
        this.supabaseCfg = resolveSupabaseAuthConfig();
        this.token = Session.get('token');
        this.userInfo = this.getUserInfo();
        this._featuresFetchPromise = null;

        // If we have user info but no role_name, fetch complete info
        if (this.userInfo && !this.userInfo.role_name && this.userInfo.role_id) {
            this.fetchCompleteUserInfo();
        }

        // Load or refresh role features for menu visibility (Role Features Access checkboxes)
        var roleId = this.userInfo && (this.userInfo.role_id || (this.userInfo.role && this.userInfo.role.id));
        if (roleId) {
            this.fetchAndCacheFeatures(roleId);
        }
    }

    /**
     * Returns normalized user identity fields for override matching.
     */
    getNormalizedUserIdentity() {
        const user = Session.get('user') || this.userInfo || {};
        const normalized = function (value) {
            return (value || '').toString().trim().toLowerCase();
        };
        return {
            email: normalized(user.email || user.user_email || user.email_address),
            username: normalized(user.username || user.user_name || user.login),
            firstName: normalized(user.first_name),
            lastName: normalized(user.last_name),
            fullName: normalized(user.full_name || user.name || ((user.first_name || '') + ' ' + (user.last_name || ''))),
            displayName: normalized(user.display_name || user.name)
        };
    }

    /**
     * Returns feature keys that should always be enabled for selected users.
     */
    getFeatureKeyOverridesForUser() {
        const identity = this.getNormalizedUserIdentity();
        const overrideEmails = new Set([
            'pete@macavation.co.za',
            'peter.symons@macavation.co.za',
            'mark@macavation.co.za',
            'mark.payne@macavation.co.za'
        ]);
        const overrideUsernames = new Set(['pete', 'mark', 'peter.symons', 'mark.payne']);
        const overrideFullNames = new Set(['pete', 'mark', 'peter symons', 'mark payne']);

        const isOverrideUser =
            overrideEmails.has(identity.email) ||
            overrideUsernames.has(identity.username) ||
            overrideFullNames.has(identity.firstName) ||
            overrideFullNames.has(identity.fullName) ||
            overrideFullNames.has(identity.displayName);

        if (!isOverrideUser) return [];

        return [
            'crm-grid',
            'supplier-intake-grid',
            'oil-production-grid',
            'oil-production-forecast-grid',
            'stock-management-oil',
            'oil-dispatch-grid'
        ];
    }

    /**
     * Get user info from localStorage
     */
    getUserInfo() {
        try {
            return Session.get('user');
        } catch (error) {
            console.error('Error parsing user info:', error);
            return null;
        }
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!this.token && !!this.userInfo;
    }

    /**
     * Get current user's role
     */
    getUserRole() {
        // If we have role_name, use it
        if (this.userInfo?.role_name) {
            return this.userInfo.role_name;
        }

        // If we only have role_id, return a default
        return this.userInfo?.role_id ? 'Unknown Role' : 'Viewer';
    }

    /**
     * Check if user has specific role
     */
    hasRole(roleName) {
        return this.getUserRole() === roleName;
    }

    /**
     * Check if user has admin privileges
     */
    isAdmin() {
        return this.hasRole('Super Admin') || this.hasRole('Admin');
    }

    /**
     * Check if user has user privileges
     */
    isUser() {
        return this.hasRole('User') || this.hasRole('Transport Manager') || this.hasRole('Fleet Supervisor') || this.isAdmin();
    }

    /**
     * Check if user has viewer privileges
     */
    isViewer() {
        return this.hasRole('Viewer') || this.hasRole('Driver') || this.hasRole('Customer Service') || this.hasRole('Warehouse Staff') || this.isUser();
    }

    /**
     * Authenticates with Google. The id_token signature check happens in the
     * Supabase Edge Function auth-google (no AWS involved).
     * @param {string} idToken - Google JWT id_token from Google OAuth.
     * @returns {Promise<object>} - {success, token, user}.
     */
    async authenticateWithGoogle(idToken) {
        try {
            const response = await fetch(`${this.supabaseCfg.url}/functions/v1/auth-google`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.supabaseCfg.anonKey}`,
                    'apikey': this.supabaseCfg.anonKey
                },
                body: JSON.stringify({ id_token: idToken })
            });

            const result = await response.json().catch(() => null);
            if (!response.ok || !result || result.success !== true) {
                throw new Error((result && result.message) || `Google sign-in failed (HTTP ${response.status}).`);
            }
            if (result.token && result.user) {
                this.token = result.token;
                this.userInfo = result.user;
                Session.set('token', result.token);
                Session.set('user', result.user);

                // If we don't have role_name, fetch complete user info
                if (!this.userInfo.role_name && this.userInfo.role_id) {
                    await this.fetchCompleteUserInfo();
                }

                // Cache role features for menu filtering
                if (this.userInfo.role_id) {
                    this.fetchAndCacheFeatures(this.userInfo.role_id);
                }
            }
            return result;
        } catch (error) {
            console.error('Error authenticating with Google:', error);
            throw error;
        }
    }

    /**
     * Fetch complete user info with role name
     */
    async fetchCompleteUserInfo() {
        try {
            const result = await this.callFunction('get_user_with_permissions', {
                p_user_id: this.userInfo.user_id || this.userInfo.id
            });

            if (result && result.length > 0) {
                const userData = result[0];
                this.userInfo = {
                    ...this.userInfo,
                    role_name: userData.role_name,
                    role_id: userData.role_id != null ? userData.role_id : this.userInfo.role_id,
                    permissions: userData.permissions
                };
                Session.set('user', this.userInfo);
                if (this.userInfo.role_id && typeof this.fetchAndCacheFeatures === 'function') {
                    this.fetchAndCacheFeatures(this.userInfo.role_id);
                }
            }
        } catch (error) {
            console.error('Error fetching complete user info:', error);
        }
    }

    /**
     * Fetch enabled feature keys for the user's role and cache in localStorage.
     * Called after login and when role_id is confirmed.
     */
    async fetchAndCacheFeatures(roleId) {
        if (this._featuresFetchPromise) {
            return this._featuresFetchPromise;
        }
        this._featuresFetchPromise = this._fetchAndCacheFeaturesImpl(roleId)
            .finally(() => {
                this._featuresFetchPromise = null;
            });
        return this._featuresFetchPromise;
    }

    async _fetchAndCacheFeaturesImpl(roleId) {
        try {
            const overrideKeys = this.getFeatureKeyOverridesForUser();
            if (typeof dataFunctions === 'undefined' || !dataFunctions.getFeaturesForRole) {
                Session.set('featureKeys', Array.isArray(overrideKeys) ? overrideKeys : []);
                return;
            }
            // If role_id is missing, look it up from role_name via cached roles list
            if (!roleId) {
                var currentUser = Session.get('user') || this.userInfo;
                var currentRoleName = currentUser && (currentUser.role_name || currentUser.role);
                if (currentRoleName) {
                    var roles = await dataFunctions.getRoles();
                    if (Array.isArray(roles)) {
                        var lowerRoleName = (typeof currentRoleName === 'string' ? currentRoleName : (currentRoleName && currentRoleName.name) || '').toLowerCase();
                        var match = roles.find(function (r) {
                            return (r.role_name || '').toLowerCase() === lowerRoleName;
                        });
                        if (match) roleId = match.id;
                    }
                }
            }
            var roleIdStr = roleId != null ? String(roleId) : null;
            var keys = [];
            if (roleIdStr) {
                var list = await dataFunctions.getFeaturesForRole(roleIdStr);
                keys = (Array.isArray(list) ? list : []).map(function (row) {
                    return (row && typeof row === 'object' && row.key != null) ? row.key : (typeof row === 'string' ? row : '');
                }).filter(Boolean);
            }
            if (Array.isArray(overrideKeys) && overrideKeys.length > 0) {
                overrideKeys.forEach(function (key) {
                    if (keys.indexOf(key) === -1) keys.push(key);
                });
            }
            Session.set('featureKeys', keys);
            try {
                if (typeof window.dispatchEvent === 'function') {
                    window.dispatchEvent(new CustomEvent('featureKeysUpdated', { detail: { keys: keys } }));
                }
            } catch (e) {}
            if (typeof menuFilter !== 'undefined' && menuFilter.refresh) {
                menuFilter.refresh();
            }
            // Cache action keys (button/action-level permissions) alongside features.
            if (roleIdStr && typeof dataFunctions.getActionsForRole === 'function') {
                try {
                    var actionList = await dataFunctions.getActionsForRole(roleIdStr);
                    var actionKeys = (Array.isArray(actionList) ? actionList : []).map(function (row) {
                        return (row && typeof row === 'object' && row.key != null) ? row.key : (typeof row === 'string' ? row : '');
                    }).filter(Boolean);
                    Session.set('actionKeys', actionKeys);
                    try {
                        if (typeof window.dispatchEvent === 'function') {
                            window.dispatchEvent(new CustomEvent('actionKeysUpdated', { detail: { keys: actionKeys } }));
                        }
                    } catch (e2) {}
                } catch (actionErr) {
                    console.warn('[AuthService] Could not load role actions:', actionErr.message);
                }
            }
        } catch (error) {
            console.warn('[AuthService] Could not load role features:', error.message);
        }
    }

    /**
     * Sign out user
     */
    signOut() {
        // Store last active page before logout
        const lastActivePage = sessionStorage.getItem('lastActivePage') || 
                             (typeof _appRouter !== 'undefined' && _appRouter.currentRoute) || 
                             'dashboard';
        // Get cc parameter before clearing session
        const ccParam = Session.get('clientGuid');

        Session.clear();
        // Restore lastActivePage so appRouter can redirect back after next login
        Session.set('lastActivePage', lastActivePage);
        this.token = null;
        this.userInfo = null;
        
        // Preserve cc parameter in redirect
        const signinUrl = ccParam ? `signin.html?cc=${encodeURIComponent(ccParam)}` : 'signin.html';
        window.location.href = signinUrl;
    }

    /**
     * RETIRED: the AWS Lambda proxy is gone; use dataFunctions.callFunction.
     */
    async makeAuthenticatedRequest(endpoint, options = {}) {
        throw new Error('makeAuthenticatedRequest is retired — the Lambda proxy no longer exists. Use dataFunctions.callFunction.');
        /* eslint-disable no-unreachable */
        if (!this.token) {
            throw new Error('No authentication token available');
        }

        const defaultOptions = {
            headers: {
                'Authorization': `Bearer ${this.token}`,
                'Content-Type': 'application/json'
            }
        };

        const requestOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        };

        try {
            const response = await fetch(`${this.proxyUrl}${endpoint}`, requestOptions);

            if (!response.ok) {
                if (response.status === 401) {
                    // Token expired or invalid
                    this.signOut();
                    throw new Error('Authentication expired. Please sign in again.');
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('API request failed:', error);
            throw error;
        }
    }

    /**
     * Call a database function directly via Supabase PostgREST.
     */
    async callFunction(functionName, params = {}, token = null) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.supabaseCfg.anonKey}`,
                'apikey': this.supabaseCfg.anonKey
            };
            const auditUserId = this.userInfo && (this.userInfo.id || this.userInfo.user_id);
            if (auditUserId) {
                headers['X-User-Id'] = auditUserId;
            }
            const response = await fetch(`${this.supabaseCfg.url}/rest/v1/rpc/${encodeURIComponent(functionName)}`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(params || {})
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();

            if (result.error) {
                throw new Error(result.error);
            }

            return result;
        } catch (error) {
            console.error(`Error calling ${functionName}:`, error);
            throw error;
        }
    }


    /**
     * Get user profile
     */
    async getUserProfile() {
        return await this.callFunction('get_user_profile', {
            p_user_id: this.userInfo?.user_id
        });
    }

    /**
     * Update user profile
     */
    async updateUserProfile(profileData) {
        return await this.callFunction('update_user_profile', {
            p_user_id: this.userInfo?.user_id,
            ...profileData
        });
    }

    /**
     * Refresh user session
     */
    async refreshSession() {
        try {
            const result = await this.makeAuthenticatedRequest('/auth/refresh');
            if (result.token) {
                this.token = result.token;
                Session.set('token', result.token);
            }
            return result;
        } catch (error) {
            console.error('Session refresh failed:', error);
            this.signOut();
            throw error;
        }
    }

    /**
     * Check if user can access specific resource
     */
    canAccess(resource, operation = 'SELECT') {
        // This would typically check against role_permissions table
        // For now, we'll use role-based access
        switch (resource) {
            case 'users':
                return operation === 'SELECT' ? this.isUser() : this.isAdmin();
            case 'roles':
                return operation === 'SELECT' ? this.isUser() : this.isAdmin();
            case 'role_permissions':
                return this.isAdmin();
            default:
                return this.isViewer();
        }
    }

}

// Create global instance
window.authService = new AuthService();

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthService;
}
