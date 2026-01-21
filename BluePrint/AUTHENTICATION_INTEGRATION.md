# Authentication Integration Guide

**Version: 1.0.0**  
**Last Updated: January 2026**

## Overview

This guide provides step-by-step instructions for integrating the `signin.html` and `signup.html` pages with the `auth-service.js` authentication service. This ensures consistent authentication handling across the application and follows the centralized authentication architecture pattern.

## Prerequisites

- `auth-service.js` file exists in `admin-portal/js/` directory
- Lambda proxy URL is configured in `auth-service.js`
- Signin and signup HTML pages are created
- SweetAlert2 is included for user notifications
- **Database functions exist** (see Database Function Verification section below)

## Architecture Pattern

The authentication flow follows this pattern:
1. **Frontend Pages** (`signin.html`, `signup.html`) → User interface and form handling
2. **Auth Service** (`auth-service.js`) → Centralized authentication logic and API calls
3. **Lambda Proxy** → Backend authentication and user management
4. **LocalStorage** → Token and user info storage

## Database Function Verification

**IMPORTANT:** Before implementing authentication, verify that the required database functions exist in your Supabase database. The authentication flow depends on these functions being available.

### AutoFlows Database Status (Verified January 2026)

**✅ `create_user_simple` Function:**
- **Status:** EXISTS and fully functional
- **Location:** AutoFlows Supabase database (project: `kmxgidccytohcvctnuxm`)
- **Parameters:** Matches `auth-service.js` expectations exactly
- **Password Hashing:** Uses pgcrypto (bcrypt) - working correctly
- **Permissions:** Configured for anon role (public signup enabled)
- **Testing:** Function tested successfully with all parameters

**✅ Database Schema Updates:**
- **Columns Added to `users` table:**
  - `password_hash` (TEXT) - Stores bcrypt-hashed passwords
  - `full_name` (TEXT) - User's full name
  - `first_name` (TEXT) - User's first name
  - `last_name` (TEXT) - User's last name
  - `provider` (TEXT) - Authentication provider (default: 'email')
- **Indexes Added:** Email and provider indexes for performance

**✅ `verify_password` Function:**
- **Status:** EXISTS and fully functional
- **Location:** AutoFlows Supabase database (project: `kmxgidccytohcvctnuxm`)
- **Purpose:** Required by Lambda proxy for password verification during sign-in
- **Parameters:** `p_email TEXT, p_password TEXT`
- **Returns:** JSON with `success`, `user_id`, `user` object, and `message`
- **Permissions:** Configured for anon role (public signin enabled)
- **Note:** The Lambda proxy calls this function at `/auth/login` endpoint to verify email/password credentials

### Verify `create_user_simple` Function

The signup process requires the `create_user_simple` function. Verify it exists with:

```sql
-- Check if function exists
SELECT 
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS parameters,
    pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'create_user_simple';
```

**Expected Function Signature:**
```sql
CREATE OR REPLACE FUNCTION create_user_simple(
    p_email TEXT,
    p_client_unique_guid TEXT DEFAULT NULL,
    p_first_name TEXT DEFAULT NULL,
    p_full_name TEXT DEFAULT NULL,
    p_last_name TEXT DEFAULT NULL,
    p_password TEXT DEFAULT NULL,
    p_provider TEXT DEFAULT 'email',
    p_phone TEXT DEFAULT NULL,
    p_role_id UUID DEFAULT NULL
) RETURNS JSON AS $$
-- Function implementation
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Actual Function Signature (AutoFlows Database - Verified January 2026):**
```sql
create_user_simple(
    p_email text,
    p_client_unique_guid text DEFAULT NULL,
    p_first_name text DEFAULT NULL,
    p_full_name text DEFAULT NULL,
    p_last_name text DEFAULT NULL,
    p_password text DEFAULT NULL,
    p_provider text DEFAULT 'email',
    p_phone text DEFAULT NULL,
    p_role_id uuid DEFAULT NULL
) RETURNS json
```

**Note:** The function has been verified and updated in the AutoFlows database. It includes password hashing using pgcrypto (bcrypt) and returns a JSON response with `success` and `user` object.

**Required Database Columns:**
The following columns were added to the `users` table to support this function:
- `password_hash` (TEXT) - Stores bcrypt-hashed passwords
- `full_name` (TEXT) - User's full name
- `first_name` (TEXT) - User's first name
- `last_name` (TEXT) - User's last name
- `provider` (TEXT) - Authentication provider (default: 'email')

**If the function doesn't exist**, you'll need to create it. Reference the Hope Diamond Transport project for a complete implementation example, or follow the pattern in `SUPABASE_BEST_PRACTICES.md`.

### Verify `verify_password` Function

**Status (AutoFlows Database - Verified January 2026):** The `verify_password` function **EXISTS** and is required for Lambda proxy authentication.

**Why This Function Is Required:**
- **CRITICAL:** The Lambda proxy uses this function to verify passwords during sign-in at the `/auth/login` endpoint
- The Lambda proxy calls this function when processing email/password authentication requests
- Without this function, sign-in will fail with "Function not found" errors
- This function must be in the `EXEMPTED_FUNCTIONS` list in your Lambda proxy configuration

**Actual Function Signature (AutoFlows Database - Verified January 2026):**
```sql
verify_password(
    p_email text,
    p_password text
) RETURNS json
```

**Function Implementation:**

Verify it exists with:
```sql
-- Check if function exists
SELECT 
    p.proname AS function_name,
    pg_get_function_arguments(p.oid) AS parameters,
    pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname = 'verify_password';
```

**Actual Function Implementation (AutoFlows Database):**
```sql
CREATE OR REPLACE FUNCTION public.verify_password(
    p_email TEXT,
    p_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_password_hash TEXT;
    v_is_valid BOOLEAN;
    v_full_name TEXT;
    v_first_name TEXT;
    v_last_name TEXT;
    v_role_id UUID;
    v_provider TEXT;
BEGIN
    -- Validate required fields
    IF p_email IS NULL OR p_email = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Email is required'
        );
    END IF;

    IF p_password IS NULL OR p_password = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Password is required'
        );
    END IF;

    -- Get user and password hash
    SELECT 
        id, 
        password_hash,
        full_name,
        first_name,
        last_name,
        role_id,
        provider
    INTO 
        v_user_id, 
        v_password_hash,
        v_full_name,
        v_first_name,
        v_last_name,
        v_role_id,
        v_provider
    FROM public.users
    WHERE email = p_email AND is_active = true;

    -- Check if user exists
    IF v_user_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid email or password'
        );
    END IF;

    -- Verify password using crypt (requires pgcrypto extension)
    IF v_password_hash IS NOT NULL THEN
        v_is_valid := (v_password_hash = crypt(p_password, v_password_hash));
    ELSE
        -- No password hash means user signed up with OAuth (no password)
        RETURN json_build_object(
            'success', false,
            'error', 'No password set for this account. Please use social login.'
        );
    END IF;

    -- Return result
    IF v_is_valid THEN
        RETURN json_build_object(
            'success', true,
            'user_id', v_user_id,
            'user', json_build_object(
                'id', v_user_id,
                'email', p_email,
                'full_name', v_full_name,
                'first_name', v_first_name,
                'last_name', v_last_name,
                'role_id', v_role_id,
                'provider', v_provider
            ),
            'message', 'Password verified'
        );
    ELSE
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid email or password'
        );
    END IF;

EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Error verifying password: ' || SQLERRM
        );
END;
$$;
```

**Note:** This function is **REQUIRED** for AutoFlows because the Lambda proxy calls it during email/password sign-in. The Lambda proxy uses this function to verify credentials before issuing authentication tokens.

### Verify Required Extensions

Ensure the `pgcrypto` extension is enabled for password hashing:

```sql
-- Check if extension exists
SELECT * FROM pg_extension WHERE extname = 'pgcrypto';

-- If not exists, create it
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Function Permissions

Verify that the functions have appropriate execute permissions:

```sql
-- Check permissions for create_user_simple
SELECT 
    p.proname AS function_name,
    r.rolname AS role_name,
    has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
CROSS JOIN pg_roles r
WHERE n.nspname = 'public' 
  AND p.proname IN ('create_user_simple', 'verify_password')
  AND r.rolname IN ('anon', 'authenticated', 'service_role');
```

**Required Permissions:**
- `create_user_simple`: Should be executable by `anon` role (for public signup) ✅ **Verified in AutoFlows**
- `verify_password`: Should be executable by `anon` role (for public signin) ✅ **Verified in AutoFlows - REQUIRED for Lambda proxy**

### Testing Database Functions

Test the functions directly in Supabase SQL Editor before implementing frontend integration:

```sql
-- Test create_user_simple (with unique email to avoid conflicts)
SELECT create_user_simple(
    'test_' || gen_random_uuid()::text || '@example.com',
    '9e1d961a-bfc2-469d-8526-8af75f536656',
    'Test',
    'Test User',
    'User',
    'TestPassword123!',
    'email',
    NULL,
    NULL
);

-- Test verify_password (REQUIRED for Lambda proxy)
SELECT verify_password('test@example.com', 'TestPassword123!');
```

**Expected Results:**
- `create_user_simple`: Should return `{"success": true, "user": {...}}` with user data including id, email, full_name, first_name, last_name, role_id, and provider
- `verify_password`: Should return `{"success": true, "user_id": "...", "user": {...}, "message": "Password verified"}` for valid credentials, or `{"success": false, "error": "..."}` for invalid credentials

**AutoFlows Database Status (Verified January 2026):**
- ✅ `create_user_simple` function exists and is working correctly
- ✅ Function accepts all expected parameters matching `auth-service.js` calls
- ✅ Password hashing using pgcrypto (bcrypt) is functional
- ✅ Function returns proper JSON response format
- ✅ Permissions configured correctly (anon role can execute)
- ✅ `verify_password` function exists and is working correctly
- ✅ `verify_password` is REQUIRED - Lambda proxy uses this function for password verification
- ✅ Function returns user data for Lambda to use in authentication response

### Troubleshooting Missing Functions

If functions are missing:

1. **Check Hope Diamond Transport Project**: Reference the project for complete function implementations
2. **Review SUPABASE_BEST_PRACTICES.md**: Contains patterns and examples for creating database functions
3. **Check Migration Files**: Functions may be defined in database migration scripts
4. **Contact Database Administrator**: If you don't have access to create functions, request them from your DBA

**Common Issues:**
- Function exists but with different parameter names → Update `auth-service.js` to match
- Function exists but returns different format → Update error handling in `auth-service.js`
- Function missing entirely → Create it following the patterns in `SUPABASE_BEST_PRACTICES.md`

## Lambda Proxy Configuration

**IMPORTANT:** Before implementing authentication, ensure your Lambda proxy is configured correctly to allow unauthenticated access to the signup function.

### Add `create_user_simple` and `verify_password` to EXEMPTED_FUNCTIONS

**CRITICAL:** Both `create_user_simple` and `verify_password` functions **MUST** be added to the `EXEMPTED_FUNCTIONS` list in your Lambda proxy configuration. 

**Why These Functions Must Be Exempted:**
- `create_user_simple`: User signup occurs **before** authentication (users don't have tokens yet)
- `verify_password`: Lambda proxy calls this function during sign-in **before** issuing authentication tokens
- Both functions are called by unauthenticated users, so they must be exempted from authentication requirements

**Lambda Configuration Example:**

```javascript
// In your Lambda proxy code
const EXEMPTED_FUNCTIONS = [
    'create_user_simple',  // Required for public user signup
    'verify_password',     // REQUIRED for public user signin - Lambda uses this function
    // ... other exempted functions
];
```

**IMPORTANT:** Both `create_user_simple` and `verify_password` **MUST** be in the `EXEMPTED_FUNCTIONS` list because:
- `create_user_simple`: Called during signup (before user has authentication token)
- `verify_password`: Called by Lambda proxy during sign-in (before user has authentication token)

**Why This Is Required:**
- User signup happens before authentication (users don't have tokens yet)
- The Lambda proxy typically requires authentication tokens for function calls
- `EXEMPTED_FUNCTIONS` allows specific functions to be called without authentication
- This enables the public signup flow to work correctly

**Verification Steps:**
1. Check your Lambda proxy source code for `EXEMPTED_FUNCTIONS` constant or configuration
2. Verify that `create_user_simple` is included in the list
3. **CRITICAL:** Verify that `verify_password` is included in the list (Lambda proxy REQUIRES this)
4. Test signup flow to ensure it works without authentication tokens
5. Test signin flow to ensure password verification works correctly

**If Not Configured:**
- Signup will fail with authentication errors (401 Unauthorized)
- Users will not be able to create accounts
- Error messages may indicate "Authentication required" or "Invalid token"

**Note:** Only functions that need to be publicly accessible (like signup and signin) should be in `EXEMPTED_FUNCTIONS`. All other functions should require authentication for security.

## Step 1: Add Authentication Methods to `auth-service.js`

Add the following methods to the `AuthService` class in `admin-portal/js/auth-service.js`:

### 1.1 Email/Password Sign In

```javascript
/**
 * Sign in with email and password via Lambda proxy
 * @param {string} email - User email address
 * @param {string} password - User password
 * @param {string} clientGUID - Optional client unique GUID (from URL parameter or default)
 * @returns {Promise<object>} - Authentication result with token and user info
 */
async signInWithEmailPassword(email, password, clientGUID = null) {
    try {
        // Get client GUID if not provided
        if (!clientGUID) {
            const urlParams = new URLSearchParams(window.location.search);
            clientGUID = urlParams.get('cc') || '9e1d961a-bfc2-469d-8526-8af75f536656'; // Default GUID
        }

        const response = await fetch(`${this.proxyUrl}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                provider: 'email',
                email: email,
                password: password,
                client_unique_guid: clientGUID
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
            localStorage.setItem('client_guid', clientGUID);

            // If we don't have role_name, fetch complete user info
            if (!this.userInfo.role_name && this.userInfo.role_id) {
                await this.fetchCompleteUserInfo();
            }
        }

        return result;
    } catch (error) {
        console.error('Error signing in with email/password:', error);
        throw error;
    }
}
```

### 1.2 User Sign Up

```javascript
/**
 * Sign up new user with email and password via Lambda proxy
 * @param {object} userData - User registration data
 * @param {string} userData.email - User email address
 * @param {string} userData.password - User password
 * @param {string} userData.fullName - User full name
 * @param {string} userData.firstName - User first name
 * @param {string} userData.lastName - User last name
 * @param {string} clientGUID - Optional client unique GUID
 * @returns {Promise<object>} - Registration result
 */
async signUpWithEmailPassword(userData, clientGUID = null) {
    try {
        // Get client GUID if not provided
        if (!clientGUID) {
            const urlParams = new URLSearchParams(window.location.search);
            clientGUID = urlParams.get('cc') || '9e1d961a-bfc2-469d-8526-8af75f536656'; // Default GUID
        }

        const response = await fetch(`${this.proxyUrl}/proxy/function`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                function: 'create_user_simple',
                params: {
                    p_email: userData.email,
                    p_password: userData.password,
                    p_full_name: userData.fullName,
                    p_first_name: userData.firstName,
                    p_last_name: userData.lastName,
                    p_client_unique_guid: clientGUID,
                    p_provider: 'email'
                }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        // Check if the API call was successful
        if (result.success === false) {
            throw new Error(result.error || 'Failed to create account');
        }

        return result;
    } catch (error) {
        console.error('Error signing up with email/password:', error);
        throw error;
    }
}
```

### 1.3 Forgot Password

```javascript
/**
 * Request password reset via Lambda proxy
 * @param {string} email - User email address
 * @returns {Promise<object>} - Password reset result
 */
async forgotPassword(email) {
    try {
        const response = await fetch(`${this.proxyUrl}/auth/forgot-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        // Always return success for security (don't reveal if email exists)
        return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
    } catch (error) {
        console.error('Error requesting password reset:', error);
        // Still return success message for security
        return { success: true, message: 'If an account exists with this email, you will receive a password reset link.' };
    }
}
```

### 1.4 Update Google Authentication Method

Update the existing `authenticateWithGoogle` method to include `client_unique_guid`:

```javascript
/**
 * Authenticates with Google via the Lambda proxy.
 * @param {string} idToken - Google JWT id_token from Google OAuth.
 * @param {string} clientGUID - Optional client unique GUID
 * @returns {Promise<object>} - The authentication result from the Lambda proxy.
 */
async authenticateWithGoogle(idToken, clientGUID = null) {
    try {
        // Get client GUID if not provided
        if (!clientGUID) {
            const urlParams = new URLSearchParams(window.location.search);
            clientGUID = urlParams.get('cc') || '9e1d961a-bfc2-469d-8526-8af75f536656'; // Default GUID
        }

        const response = await fetch(`${this.proxyUrl}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                provider: 'google',
                id_token: idToken,
                client_unique_guid: clientGUID
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
            localStorage.setItem('client_guid', clientGUID);

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
```

## Step 2: Include `auth-service.js` in Signin Page

Add the script tag to include `auth-service.js` in `signin.html` before the closing `</body>` tag:

```html
<!-- Auth Service -->
<script src="js/auth-service.js"></script>
```

**Important:** Place this script tag **before** your inline script that handles form submission, so `authService` is available when the page loads.

## Step 3: Update Signin Form Handler

Replace the inline signin form submission handler in `signin.html` with the following:

```javascript
// ============================================
// Sign In Form Submit
// ============================================
signinForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!validateForm()) {
        Swal.fire({
            icon: 'error',
            title: 'Validation Error',
            text: 'Please fill in all required fields correctly.',
            confirmButtonColor: '#667eea'
        });
        return;
    }

    // Authentication Bypass (Demo Mode) - Remove in production
    // For demo purposes, redirect directly to index page
    // Uncomment the code below for production authentication
    
    // DEMO MODE - Remove this block in production
    window.location.href = 'index.html';
    return;
    // END DEMO MODE

    /* PRODUCTION CODE - Uncomment when ready to use real authentication
    showLoading('Signing you in...');

    try {
        const email = emailInput.value.trim();
        const password = passwordInput.value;

        const result = await authService.signInWithEmailPassword(email, password);

        hideLoading();

        // Redirect based on user role
        const userRole = result.user?.role_name || result.user?.role || '';
        if (userRole.toLowerCase().includes('driver')) {
            window.location.href = 'driver-inspection.html';
        } else {
            window.location.href = 'index.html';
        }
    } catch (error) {
        hideLoading();
        Swal.fire({
            icon: 'error',
            title: 'Sign In Failed',
            text: error.message || 'An error occurred while signing in. Please try again.',
            confirmButtonColor: '#667eea'
        });
    }
    */
});
```

## Step 4: Update Forgot Password Handler

Replace the forgot password handler in `signin.html`:

```javascript
// ============================================
// Forgot Password
// ============================================
forgotPassword.addEventListener('click', async function (e) {
    e.preventDefault();

    const { value: email } = await Swal.fire({
        title: 'Reset Password',
        text: 'Enter your email address to receive a password reset link',
        input: 'email',
        inputPlaceholder: 'Enter your email address',
        showCancelButton: true,
        confirmButtonText: 'Send Reset Link',
        confirmButtonColor: '#667eea',
        inputValidator: (value) => {
            if (!value) {
                return 'Please enter your email address';
            }
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                return 'Please enter a valid email address';
            }
        }
    });

    if (email) {
        showLoading('Sending reset link...');

        try {
            const result = await authService.forgotPassword(email);
            hideLoading();

            Swal.fire({
                icon: 'success',
                title: 'Email Sent!',
                text: result.message || 'If an account exists with this email, you will receive a password reset link.',
                confirmButtonColor: '#667eea'
            });
        } catch (error) {
            hideLoading();
            // Still show success for security
            Swal.fire({
                icon: 'success',
                title: 'Email Sent!',
                text: 'If an account exists with this email, you will receive a password reset link.',
                confirmButtonColor: '#667eea'
            });
        }
    }
});
```

## Step 5: Update Google Sign In Handler

If Google sign-in is implemented, update it to use `auth-service.js`:

```javascript
// ============================================
// Google Sign In
// ============================================
document.getElementById('googleSignIn')?.addEventListener('click', async function () {
    // Authentication Bypass (Demo Mode) - Remove in production
    showLoading('Signing in with Google...');
    setTimeout(() => {
        hideLoading();
        window.location.href = 'index.html';
    }, 1000);
    return;
    // END DEMO MODE

    /* PRODUCTION CODE - Uncomment when ready to use real authentication
    try {
        // Initialize Google Sign-In if not already initialized
        if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.initialize({
                client_id: 'YOUR_GOOGLE_CLIENT_ID',
                callback: async function(response) {
                    if (response.credential) {
                        showLoading('Signing in with Google...');
                        try {
                            const result = await authService.authenticateWithGoogle(response.credential);
                            hideLoading();

                            // Redirect based on user role
                            const userRole = result.user?.role_name || result.user?.role || '';
                            if (userRole.toLowerCase().includes('driver')) {
                                window.location.href = 'driver-inspection.html';
                            } else {
                                window.location.href = 'index.html';
                            }
                        } catch (error) {
                            hideLoading();
                            Swal.fire({
                                icon: 'error',
                                title: 'Google Sign-In Failed',
                                text: error.message || 'An error occurred during Google sign-in.',
                                confirmButtonColor: '#667eea'
                            });
                        }
                    }
                }
            });
            google.accounts.id.prompt();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Google Sign-In Error',
                text: 'Google Sign-In is not available. Please try again later.',
                confirmButtonColor: '#667eea'
            });
        }
    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: 'Google Sign-In Error',
            text: error.message || 'An error occurred during Google sign-in.',
            confirmButtonColor: '#667eea'
        });
    }
    */
});
```

## Step 6: Include `auth-service.js` in Signup Page

Add the script tag to include `auth-service.js` in `signup.html` before the closing `</body>` tag:

```html
<!-- Auth Service -->
<script src="js/auth-service.js"></script>
```

## Step 7: Update Signup Form Handler

Replace the inline signup form submission handler in `signup.html`:

```javascript
// ============================================
// Sign Up Form Submit
// ============================================
signupForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    if (!validateForm()) {
        Swal.fire({
            icon: 'error',
            title: 'Validation Error',
            text: 'Please fill in all required fields correctly.',
            confirmButtonColor: '#667eea'
        });
        return;
    }

    // Authentication Bypass (Demo Mode) - Remove in production
    // For demo purposes, redirect directly to signin page
    // Uncomment the code below for production authentication
    
    // DEMO MODE - Remove this block in production
    showLoading('Creating your account...');
    setTimeout(() => {
        hideLoading();
        Swal.fire({
            icon: 'success',
            title: 'Account Created!',
            text: 'Your account has been created successfully. Redirecting to sign in...',
            confirmButtonColor: '#667eea',
            timer: 2000,
            showConfirmButton: false
        }).then(() => {
            window.location.href = 'signin.html';
        });
    }, 1500);
    return;
    // END DEMO MODE

    /* PRODUCTION CODE - Uncomment when ready to use real authentication
    showLoading('Creating your account...');

    try {
        const userData = {
            email: emailInput.value.trim(),
            password: passwordInput.value,
            fullName: `${firstNameInput.value.trim()} ${lastNameInput.value.trim()}`,
            firstName: firstNameInput.value.trim(),
            lastName: lastNameInput.value.trim()
        };

        await authService.signUpWithEmailPassword(userData);

        hideLoading();

        Swal.fire({
            icon: 'success',
            title: 'Account Created!',
            text: 'Your account has been created successfully. Please sign in.',
            confirmButtonColor: '#667eea'
        }).then(() => {
            window.location.href = 'signin.html';
        });
    } catch (error) {
        hideLoading();
        Swal.fire({
            icon: 'error',
            title: 'Sign Up Failed',
            text: error.message || 'An error occurred while creating your account. Please try again.',
            confirmButtonColor: '#667eea'
        });
    }
    */
});
```

## Step 8: Update Social Sign Up Handlers

Update Google and Facebook sign-up handlers in `signup.html`:

```javascript
// ============================================
// Google Sign Up
// ============================================
document.getElementById('googleSignUp')?.addEventListener('click', async function () {
    // Authentication Bypass (Demo Mode) - Remove in production
    showLoading('Signing up with Google...');
    setTimeout(() => {
        hideLoading();
        window.location.href = 'index.html';
    }, 1000);
    return;
    // END DEMO MODE

    /* PRODUCTION CODE - Uncomment when ready to use real authentication
    try {
        if (typeof google !== 'undefined' && google.accounts) {
            google.accounts.id.initialize({
                client_id: 'YOUR_GOOGLE_CLIENT_ID',
                callback: async function(response) {
                    if (response.credential) {
                        showLoading('Signing up with Google...');
                        try {
                            const result = await authService.authenticateWithGoogle(response.credential);
                            hideLoading();

                            // Redirect based on user role
                            const userRole = result.user?.role_name || result.user?.role || '';
                            if (userRole.toLowerCase().includes('driver')) {
                                window.location.href = 'driver-inspection.html';
                            } else {
                                window.location.href = 'index.html';
                            }
                        } catch (error) {
                            hideLoading();
                            Swal.fire({
                                icon: 'error',
                                title: 'Google Sign-Up Failed',
                                text: error.message || 'An error occurred during Google sign-up.',
                                confirmButtonColor: '#667eea'
                            });
                        }
                    }
                }
            });
            google.accounts.id.prompt();
        } else {
            Swal.fire({
                icon: 'error',
                title: 'Google Sign-In Error',
                text: 'Google Sign-In is not available. Please try again later.',
                confirmButtonColor: '#667eea'
            });
        }
    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: 'Google Sign-Up Error',
            text: error.message || 'An error occurred during Google sign-up.',
            confirmButtonColor: '#667eea'
        });
    }
    */
});

// ============================================
// Facebook Sign Up
// ============================================
document.getElementById('facebookSignUp')?.addEventListener('click', function () {
    // Authentication Bypass (Demo Mode) - Remove in production
    showLoading('Signing up with Facebook...');
    setTimeout(() => {
        hideLoading();
        window.location.href = 'index.html';
    }, 1000);
    return;
    // END DEMO MODE

    /* PRODUCTION CODE - Uncomment when ready to use real authentication
    Swal.fire({
        icon: 'info',
        title: 'Facebook Sign-Up',
        text: 'Facebook sign-up will be available soon.',
        confirmButtonColor: '#667eea'
    });
    */
});
```

## Step 9: Check Authentication State on Page Load

Add authentication state check to both `signin.html` and `signup.html` to redirect authenticated users:

```javascript
// ============================================
// Check Authentication State on Page Load
// ============================================
document.addEventListener('DOMContentLoaded', function () {
    // Wait for authService to be available
    if (typeof authService !== 'undefined' && authService.isAuthenticated()) {
        // User is already authenticated, redirect to main app
        const userRole = authService.getUserRole();
        if (userRole.toLowerCase().includes('driver')) {
            window.location.href = 'driver-inspection.html';
        } else {
            window.location.href = 'index.html';
        }
        return;
    }
});
```

## Step 10: Verify Lambda Proxy URL

Ensure the Lambda proxy URL in `auth-service.js` matches your backend configuration:

```javascript
constructor() {
    this.proxyUrl = 'https://YOUR-LAMBDA-PROXY-URL.lambda-url.af-south-1.on.aws';
    // ... rest of constructor
}
```

**Note:** The proxy URL may differ from the example files. Update it to match your actual Lambda proxy endpoint.

## Testing Checklist

After implementing the integration, test the following:

- [ ] Email/password sign-in works correctly
- [ ] Email/password sign-up creates new users
- [ ] Forgot password sends reset email
- [ ] Google sign-in works (if implemented)
- [ ] Google sign-up works (if implemented)
- [ ] Authenticated users are redirected from signin/signup pages
- [ ] Error messages display correctly for invalid credentials
- [ ] Loading states show during authentication
- [ ] User info and token are stored in localStorage
- [ ] Client GUID is properly handled from URL parameters

## Troubleshooting

### Issue: `authService is not defined`

**Solution:** Ensure `auth-service.js` is loaded before your inline scripts. Check the script tag order in your HTML.

### Issue: Token not being stored

**Solution:** Verify the Lambda proxy response includes `token` and `user` fields. Check browser console for errors.

### Issue: Client GUID not found

**Solution:** Ensure the `client_unique_guid` parameter is included in authentication requests. The service will use a default GUID if not provided.

### Issue: CORS errors

**Solution:** Verify your Lambda proxy has CORS headers configured correctly for your domain.

### Issue: Authentication works but user info is incomplete

**Solution:** The `fetchCompleteUserInfo()` method is called automatically if `role_name` is missing. Check that the `get_user_with_permissions` function exists in your database.

### Issue: Signup fails with "Function not found" or "Function does not exist"

**Solution:** 
1. Verify that `create_user_simple` function exists in your database (see Database Function Verification section above)
2. Check function permissions - it should be executable by the `anon` role
3. Verify function parameter names match what's being sent from `auth-service.js`
4. Reference the Hope Diamond Transport project for the correct function implementation

### Issue: Signup fails with "401 Unauthorized" or "Authentication required"

**Solution:**
1. **CRITICAL:** Verify that `create_user_simple` is added to `EXEMPTED_FUNCTIONS` in your Lambda proxy configuration (see Lambda Proxy Configuration section above)
2. Check Lambda proxy logs for authentication errors
3. Ensure the Lambda allows unauthenticated access to signup functions
4. Test the function directly through the Lambda proxy to verify configuration

### Issue: Signin fails with "Invalid credentials" even with correct password

**Solution:**
1. **CRITICAL:** Verify that `verify_password` function exists in your database (see Database Function Verification section above)
2. **CRITICAL:** Verify that `verify_password` is in `EXEMPTED_FUNCTIONS` in your Lambda proxy configuration
3. Check Lambda proxy logs for authentication errors - the Lambda calls `verify_password` function
4. Verify that the Lambda proxy is correctly calling the `verify_password` function
5. Ensure password hashing method (bcrypt) matches between signup (`create_user_simple`) and signin (`verify_password`)
6. Check that the `pgcrypto` extension is enabled (required for password hashing)
7. Test the `verify_password` function directly in Supabase SQL Editor to verify it works
8. Verify function permissions - `anon` role must be able to execute `verify_password`
9. Check database logs for detailed error messages
10. **Note:** AutoFlows Lambda proxy REQUIRES the `verify_password` function - it calls this function during sign-in

## Production Deployment

Before deploying to production:

1. **Remove Demo Mode Code:** Remove all authentication bypass code blocks
2. **Uncomment Production Code:** Uncomment all production authentication code
3. **Update Google Client ID:** Replace `YOUR_GOOGLE_CLIENT_ID` with your actual Google OAuth client ID
4. **Verify Lambda Proxy URL:** Ensure the proxy URL is correct for production
5. **Test All Flows:** Thoroughly test all authentication methods
6. **Enable Error Logging:** Ensure proper error logging is in place
7. **Security Review:** Review all authentication flows for security best practices

## Benefits of Using `auth-service.js`

✅ **Centralized Authentication:** All authentication logic in one place  
✅ **Consistent API Calls:** Standardized request/response handling  
✅ **Error Handling:** Unified error handling across the application  
✅ **Token Management:** Automatic token storage and retrieval  
✅ **User Info Management:** Centralized user information handling  
✅ **Maintainability:** Easier to update authentication logic  
✅ **Reusability:** Authentication methods can be used across modules  
✅ **Type Safety:** Consistent method signatures and return types  

## Related Documentation

- `admin_portal_complete_instructions.md` - Complete admin portal setup guide
- `RBAC_GUIDE.md` - Role-based access control implementation
- `SUPABASE_BEST_PRACTICES.md` - Supabase integration best practices

---

**Last Updated:** January 2026  
**Version:** 1.0.0
