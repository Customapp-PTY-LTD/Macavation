/**
 * Authentication Service for FruitLive
 * Integrates with Lambda Proxy for Google OAuth and RBAC
 */

class AuthService {
    constructor() {
        this.proxyUrl = 'https://rzrx6ntfejvb6lxpmt4ywruvt40mjjuo.lambda-url.af-south-1.on.aws';
        this.token = localStorage.getItem('lambda_token');
        this.userInfo = this.getUserInfo();

        // If we have user info but no role_name, fetch complete info
        if (this.userInfo && !this.userInfo.role_name && this.userInfo.role_id) {
            this.fetchCompleteUserInfo();
        }
    }

    /**
     * Get user info from localStorage
     */
    getUserInfo() {
        try {
            const userInfo = localStorage.getItem('user_info');
            return userInfo ? JSON.parse(userInfo) : null;
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
     * Authenticates with Google via the Lambda proxy.
     * @param {string} idToken - Google JWT id_token from Google OAuth.
     * @returns {Promise<object>} - The authentication result from the Lambda proxy.
     */
    async authenticateWithGoogle(idToken) {
        try {
            const response = await fetch(`${this.proxyUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    provider: 'google',
                    id_token: idToken
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            if (result.token && result.user) {
                this.token = result.token;
                this.userInfo = result.user;
                localStorage.setItem('lambda_token', result.token);
                localStorage.setItem('user_info', JSON.stringify(result.user));

                // If we don't have role_name, fetch complete user info
                if (!this.userInfo.role_name && this.userInfo.role_id) {
                    await this.fetchCompleteUserInfo();
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
                    permissions: userData.permissions
                };
                localStorage.setItem('user_info', JSON.stringify(this.userInfo));
            }
        } catch (error) {
            console.error('Error fetching complete user info:', error);
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
        localStorage.setItem('lastActivePage', lastActivePage);
        
        // Get cc parameter from localStorage (stored as client_guid during sign-in)
        const ccParam = localStorage.getItem('client_guid');
        
        localStorage.removeItem('lambda_token');
        localStorage.removeItem('user_info');
        this.token = null;
        this.userInfo = null;
        
        // Preserve cc parameter in redirect
        const signinUrl = ccParam ? `signin.html?cc=${encodeURIComponent(ccParam)}` : 'signin.html';
        window.location.href = signinUrl;
    }

    /**
     * Make authenticated API call to Lambda proxy
     */
    async makeAuthenticatedRequest(endpoint, options = {}) {
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
     * Call a database function through the proxy
     */
    async callFunction(functionName, params = {}, token = null) {
        try {
            const response = await fetch(`${this.proxyUrl}/proxy/function`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token || this.token}`
                },
                body: JSON.stringify({
                    function: functionName,
                    params: params
                })
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
                localStorage.setItem('lambda_token', result.token);
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
