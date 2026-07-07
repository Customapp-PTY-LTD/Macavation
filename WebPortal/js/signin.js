/**
 * Sign-in Module
 * Handles email/password and Google sign-in, sign-up, and forgot password.
 * Pattern: same as kernel_production_grid.js (return object, arrow functions, const scope = _signin).
 */
var _signin = function () {
    'use strict';

    const cfg = (typeof window !== 'undefined' && window.MACAVATION_SUPABASE) ? window.MACAVATION_SUPABASE : null;
    if (!cfg) {
        // Never guess a database: signing in against the wrong environment
        // silently writes data to the wrong place.
        throw new Error('signin.js: macavation-supabase.js must be loaded before signin.js.');
    }
    const SUPABASE_URL = cfg.url;
    const SUPABASE_ANON_KEY = cfg.anonKey;
    cfg.assertMacavationSupabaseUrl(SUPABASE_URL);
    const DEFAULT_CLIENT_GUID = '9e1d961a-bfc2-469d-8526-8af75f536656';

    /** Direct PostgREST RPC call — auth goes straight to Supabase, no Lambda. */
    const supabaseRpc = async (fn, params) => {
        const response = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + encodeURIComponent(fn), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify(params || {})
        });
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-JSON body */ }
        if (!response.ok) {
            throw new Error((data && (data.message || data.error || data.hint)) || ('HTTP ' + response.status));
        }
        return data;
    };

    let sbClient = null;
    try {
        if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
            sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        }
    } catch (e) {
        console.warn('[Sign-in] Supabase client initialization failed:', e);
    }

    /** Get client GUID from URL query parameter cc, or default. */
    const getClientGUID = () => {
        const urlParams = new URLSearchParams(window.location.search);
        const ccParam = urlParams.get('cc');
        return ccParam || DEFAULT_CLIENT_GUID;
    };

    /**
     * Fetch full user record from backend after login (Lambda returns minimal user).
     * Returns full user object for user_info, or null on failure (caller can fall back to minimal user).
     */
    const fetchFullUserData = async (token, userId) => {
        if (!userId) return null;
        try {
            const data = await supabaseRpc('get_user_by_id', { p_id: userId });
            // TABLE-returning RPC comes back as an array of rows
            const userRow = Array.isArray(data) ? data[0] : data;
            if (userRow && (userRow.id || userRow.user_id)) {
                return userRow;
            }
            return null;
        } catch (e) {
            console.warn('[Sign-in] Fetch full user failed:', e);
            return null;
        }
    };

    return {
        init: () => {
            const scope = _signin;
            const token = typeof localStorage !== 'undefined' && Session.get('token');
            const userInfo = typeof localStorage !== 'undefined' && Session.get('user');
            const isAuthenticated = !!(token && userInfo);

            if (isAuthenticated) {
                window.location.href = 'index.html';
                return;
            }

            console.log('[Sign-in] Initializing...');
            scope.bindEvents();

            const urlParams = new URLSearchParams(window.location.search);
            if (!urlParams.get('cc')) {
                urlParams.set('cc', DEFAULT_CLIENT_GUID);
                const newUrl = window.location.pathname + '?' + urlParams.toString() + (window.location.hash || '');
                window.history.replaceState({}, '', newUrl);
            }

            if (typeof google !== 'undefined' && google.accounts && google.accounts.id) {
                try {
                    google.accounts.id.initialize({
                        client_id: '753420461338-f17hesq624p8ubcs67s1rp8hmnbp97ff.apps.googleusercontent.com',
                        callback: (response) => scope.handleGoogleResponse(response),
                        auto_select: false,
                        cancel_on_tap_outside: true,
                        itp_support: true,
                        use_fedcm_for_prompt: false
                    });
                } catch (err) {
                    console.error('[Sign-in] Google Sign-In initialization failed:', err);
                }
            }

            if (sbClient && sbClient.auth && typeof sbClient.auth.onAuthStateChange === 'function') {
                sbClient.auth.onAuthStateChange((event, session) => {
                    if (event === 'SIGNED_IN' && session) {
                        window.location.href = 'index.html';
                    }
                });
            }
        },

        bindEvents: () => {
            const scope = _signin;
            const signinForm = document.getElementById('signinForm');
            const signupForm = document.getElementById('signupForm');
            if (signinForm) {
                signinForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    scope.handleEmailSignIn(e);
                });
            }
            if (signupForm) {
                signupForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    scope.handleSignUp(e);
                });
            }
            const forgotBtn = document.getElementById('forgotPasswordBtn');
            if (forgotBtn) {
                forgotBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    scope.forgotPassword();
                });
            }
            const showSignUpBtn = document.getElementById('showSignUpBtn');
            if (showSignUpBtn) {
                showSignUpBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    scope.showSignUpModal();
                });
            }
        },

        handleEmailSignIn: async (e) => {
            const scope = _signin;
            e.preventDefault();

            const clientGUID = getClientGUID();
            const emailEl = document.getElementById('email');
            const passwordEl = document.getElementById('password');
            const email = (emailEl ? emailEl.value : '').trim().toLowerCase();
            if (emailEl) emailEl.value = email;
            const password = passwordEl ? passwordEl.value : '';

            scope.showLoading();

            try {
                const authResult = await supabaseRpc('auth_login_email', {
                    p_email: email,
                    p_password: password
                });

                if (!authResult || authResult.success !== true) {
                    throw new Error((authResult && authResult.message) || 'Invalid email or password.');
                }

                if (typeof localStorage !== 'undefined') {
                    Session.set('token', authResult.token);
                    Session.set('user', authResult.user);
                    Session.set('clientGuid', clientGUID);
                }
                // Enrich user with role_name before redirect so dashboard shows correct view (executive vs default) on first load
                const userId = authResult.user && (authResult.user.id || authResult.user.user_id);
                if (userId && !(authResult.user.role_name || authResult.user.role)) {
                    const fullUser = await fetchFullUserData(authResult.token, userId);
                    if (fullUser && (fullUser.role_name || fullUser.role)) {
                        Session.set('user', { ...authResult.user, ...fullUser });
                    }
                }

                scope.hideLoading();

                const user = Session.get('user');
                const userRole = (user && (user.role_name || user.role)) || '';
                if (userRole.toLowerCase().indexOf('driver') >= 0) {
                    window.location.href = 'driver-inspection.html';
                } else {
                    window.location.href = 'index.html';
                }
            } catch (error) {
                scope.hideLoading();
                var msg = error && error.message ? error.message : String(error);
                if (msg === 'Failed to fetch') {
                    msg = 'Cannot reach Supabase (network problem). Check your connection and try again.';
                }
                scope.showError('Sign in failed: ' + msg);
            }
        },

        handleGoogleResponse: (response) => {
            const scope = _signin;
            scope.showLoading();

            try {
                if (response && response.credential) {
                    const payload = JSON.parse(atob(response.credential.split('.')[1]));
                    if (!payload.email || !payload.sub) {
                        throw new Error('Invalid Google token: missing email or sub');
                    }
                    scope.authenticateWithGoogle(response.credential, getClientGUID());
                } else {
                    scope.hideLoading();
                    scope.showError('Invalid response from Google. Please try again.');
                }
            } catch (error) {
                scope.hideLoading();
                scope.showError('Failed to process Google login. Please try again.');
            }
        },

        authenticateWithGoogle: async (idToken, clientGUID) => {
            const scope = _signin;
            try {
                if (!idToken) {
                    throw new Error('No Google token provided');
                }

                // Google id_token verification needs a server-side check of
                // Google's signature — done in the Supabase Edge Function
                // auth-google (no AWS involved).
                const response = await fetch(SUPABASE_URL + '/functions/v1/auth-google', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + SUPABASE_ANON_KEY,
                        'apikey': SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({ id_token: idToken })
                });

                const authResult = await response.json().catch(() => null);
                if (!response.ok || !authResult || authResult.success !== true) {
                    throw new Error((authResult && authResult.message) || 'Google sign-in failed (HTTP ' + response.status + ').');
                }

                if (typeof localStorage !== 'undefined') {
                    Session.set('token', authResult.token);
                    Session.set('user', authResult.user);
                    Session.set('clientGuid', clientGUID);
                }
                // Enrich user with role_name before redirect so dashboard shows correct view on first load
                const userId = authResult.user && (authResult.user.id || authResult.user.user_id);
                if (userId && !(authResult.user.role_name || authResult.user.role)) {
                    const fullUser = await fetchFullUserData(authResult.token, userId);
                    if (fullUser && (fullUser.role_name || fullUser.role)) {
                        Session.set('user', { ...authResult.user, ...fullUser });
                    }
                }

                scope.hideLoading();

                const user = Session.get('user');
                const userRole = (user && (user.role_name || user.role)) || '';
                if (userRole.toLowerCase().indexOf('driver') >= 0) {
                    window.location.href = 'driver-inspection.html';
                } else {
                    window.location.href = 'index.html';
                }
            } catch (error) {
                scope.hideLoading();
                scope.showError('Google authentication failed: ' + error.message);
            }
        },

        forgotPassword: async () => {
            const scope = _signin;
            if (typeof Swal === 'undefined') {
                console.warn('[Sign-in] Swal not available for forgot password');
                return;
            }
            const { value: emailRaw } = await Swal.fire({
                title: 'Reset Password',
                text: 'Enter your email address to receive a password reset link',
                input: 'email',
                inputPlaceholder: 'Enter your email address',
                showCancelButton: true,
                confirmButtonText: 'Send Reset Link',
                cancelButtonText: 'Cancel',
                inputValidator: (value) => {
                    if (!value) return 'You need to enter an email address!';
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Please enter a valid email address!';
                }
            });

            const email = (emailRaw || '').trim().toLowerCase();
            if (!email) return;

            if (!sbClient) {
                scope.showError('Password reset is not available at this time.');
                return;
            }

            try {
                const { error } = await sbClient.auth.resetPasswordForEmail(email, {
                    redirectTo: window.location.origin + '/reset-password.html'
                });
                if (error) throw error;
                Swal.fire({
                    icon: 'success',
                    title: 'Email Sent!',
                    text: 'Password reset email sent! Check your inbox.'
                });
            } catch (error) {
                scope.showError('Failed to send reset email: ' + error.message);
            }
        },

        showSignUpModal: () => {
            const el = document.getElementById('signupModal');
            if (el && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
                const signupModal = new bootstrap.Modal(el);
                signupModal.show();
            }
        },

        handleSignUp: async (e) => {
            const scope = _signin;
            e.preventDefault();

            const clientGUID = getClientGUID();
            const signupEmailEl = document.getElementById('signupEmail');
            const email = ((signupEmailEl && signupEmailEl.value) || '').trim().toLowerCase();
            if (signupEmailEl) signupEmailEl.value = email;
            const password = (document.getElementById('signupPassword') || {}).value || '';
            const confirmPassword = (document.getElementById('signupConfirmPassword') || {}).value || '';
            const fullName = (document.getElementById('signupFullName') || {}).value || '';
            const firstName = (document.getElementById('signupFirstName') || {}).value || '';
            const lastName = (document.getElementById('signupLastName') || {}).value || '';

            if (password !== confirmPassword) {
                scope.showError('Passwords do not match.');
                return;
            }
            if (password.length < 8) {
                scope.showError('Password must be at least 8 characters long.');
                return;
            }

            scope.showLoading();

            try {
                // create_user_simple hashes the password in-database (bcrypt).
                // It accepts p_email / p_username / p_role_id / p_password only.
                const created = await supabaseRpc('create_user_simple', {
                    p_email: email,
                    p_username: (fullName || (firstName + ' ' + lastName)).trim() || email,
                    p_password: password
                });

                if (!created || created.success !== true) {
                    throw new Error((created && created.message) || 'Sign up failed.');
                }

                scope.hideLoading();

                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'success',
                        title: 'Account Created!',
                        text: 'Your account has been created successfully. Please sign in.'
                    }).then(() => {
                        const signupModalEl = document.getElementById('signupModal');
                        if (signupModalEl) {
                            const modalInstance = bootstrap.Modal.getInstance(signupModalEl);
                            if (modalInstance) modalInstance.hide();
                        }
                        const form = document.getElementById('signupForm');
                        if (form) form.reset();
                    });
                }
            } catch (error) {
                scope.hideLoading();
                scope.showError('Sign up failed: ' + error.message);
            }
        },

        showLoading: () => {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    title: 'Signing you in...',
                    text: 'Please wait while we authenticate you',
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    showConfirmButton: false,
                    didOpen: () => { Swal.showLoading(); }
                });
            }
        },

        hideLoading: () => {
            if (typeof Swal !== 'undefined') Swal.close();
        },

        showError: (message) => {
            if (typeof Swal !== 'undefined') {
                Swal.fire({ icon: 'error', title: 'Error', text: message });
            } else {
                console.error('[Sign-in]', message);
            }
        }
    };
}();

function initializeSignin() {
    if (typeof _signin === 'undefined') {
        console.error('[Sign-in] _signin not defined');
        return;
    }
    _signin.init();
}

// Expose globals for HTML onclick and Google One Tap data-callback
window.forgotPassword = function () { _signin.forgotPassword(); };
window.showSignUpModal = function () { _signin.showSignUpModal(); };
window.handleGoogleResponse = function (res) { _signin.handleGoogleResponse(res); };

document.addEventListener('DOMContentLoaded', function () {
    initializeSignin();
});
