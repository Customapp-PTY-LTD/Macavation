# Google Authentication Implementation Guide

This guide explains how to implement Google Sign-In authentication in the AutoFlows Admin Portal.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Google Cloud Console Setup](#google-cloud-console-setup)
4. [Database Configuration](#database-configuration)
5. [Frontend Implementation](#frontend-implementation)
6. [Backend Integration](#backend-integration)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)

## Overview

Google Authentication uses Google Identity Services to allow users to sign in with their Google accounts. The implementation follows this flow:

1. User clicks "Sign in with Google" button
2. Google Identity Services displays the sign-in popup
3. User authenticates with Google
4. Google returns a JWT `id_token`
5. Frontend sends `id_token` to Lambda proxy endpoint
6. Lambda validates the token and creates/updates user in database
7. Lambda returns authentication token and user info
8. Frontend stores tokens and redirects to dashboard

## Prerequisites

- Google Cloud Console project with OAuth 2.0 credentials
- Lambda proxy endpoint configured for authentication
- Supabase database with proper tables and views
- Access to modify the sign-in page HTML

## Google Cloud Console Setup

### Step 1: Create OAuth 2.0 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project or create a new one
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **OAuth client ID**
5. Choose **Web application** as the application type
6. Configure authorized JavaScript origins:
   - Add your domain (e.g., `https://yourdomain.com`)
   - For local development: `http://localhost:8080`
7. Configure authorized redirect URIs:
   - Add your domain (e.g., `https://yourdomain.com`)
   - For local development: `http://localhost:8080`
8. Click **Create**
9. **Copy the Client ID** - you'll need this for the implementation

### Step 2: Enable Google Identity Services API

1. Navigate to **APIs & Services** → **Library**
2. Search for "Google Identity Services API"
3. Click **Enable** if not already enabled

## Database Configuration

### Step 1: Create Required Views

Supabase creates tables with PascalCase names, but Lambda functions expect lowercase. Create views to bridge this gap:

```sql
-- Create views for Lambda compatibility
CREATE VIEW IF NOT EXISTS identity_providers AS 
SELECT * FROM "IdentityProviders";

CREATE VIEW IF NOT EXISTS users AS 
SELECT * FROM "Users";
```

### Step 2: Configure Identity Provider

Insert Google OAuth configuration into the `IdentityProviders` table:

```sql
INSERT INTO "IdentityProviders" (provider_name, config_data, is_active, description)
VALUES (
    'google',
    '{"client_id": "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"}',
    true,
    'Google OAuth provider'
)
ON CONFLICT (provider_name) 
DO UPDATE SET 
    config_data = EXCLUDED.config_data,
    is_active = EXCLUDED.is_active;
```

**Important:** Replace `YOUR_GOOGLE_CLIENT_ID` with your actual Google Client ID.

### Step 3: Verify Database Schema

Ensure your `Users` table has the following columns:
- `id` (UUID, primary key)
- `email` (text, unique)
- `google_id` (text, nullable) - stores Google user ID
- `provider` (text) - should be 'google' for Google sign-ins
- `is_active` (boolean)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

## Frontend Implementation

### Step 1: Add Google Identity Services Script

Add the Google Identity Services script to your HTML file (before closing `</head>` or before closing `</body>`):

```html
<!-- Google Identity Services -->
<script src="https://accounts.google.com/gsi/client" async defer></script>
```

### Step 2: Add Google Sign-In Button HTML

Place the Google Sign-In button in your sign-in form:

```html
<!-- Google One Tap Container (optional, for One Tap prompt) -->
<div id="g_id_onload"
    data-client_id="YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"
    data-callback="handleGoogleResponse" 
    data-auto_prompt="false" 
    data-cancel_on_tap_outside="true"
    data-itp_support="true" 
    data-use_fedcm_for_prompt="false">
</div>

<!-- Google Sign-in Button -->
<div class="g_id_signin" 
    data-type="standard" 
    data-shape="rectangular" 
    data-theme="outline"
    data-text="continue_with" 
    data-size="large" 
    data-logo_alignment="left" 
    data-width="100%">
</div>
```

**Important:** Replace `YOUR_GOOGLE_CLIENT_ID` with your actual Google Client ID.

### Step 3: Implement JavaScript Functions

Add the following JavaScript code to handle Google authentication:

```javascript
// Configuration
const LAMBDA_PROXY_URL = 'https://your-lambda-url.lambda-url.region.on.aws';

// Get client GUID from URL query parameter
function getClientGUID() {
    const urlParams = new URLSearchParams(window.location.search);
    const ccParam = urlParams.get('cc');
    // Default GUID if not present
    if (!ccParam) {
        return 'your-default-client-guid';
    }
    return ccParam;
}

// Initialize Google One Tap
window.onload = function () {
    if (typeof google !== 'undefined' && google.accounts) {
        try {
            google.accounts.id.initialize({
                client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
                callback: handleGoogleResponse,
                auto_select: false,
                cancel_on_tap_outside: true,
                itp_support: true,
                use_fedcm_for_prompt: false
            });
        } catch (error) {
            console.error('Google Sign-In initialization failed:', error);
        }
    }
};

// Handle Google response
function handleGoogleResponse(response) {
    showLoading();

    try {
        if (response.credential) {
            // Validate token structure
            const payload = JSON.parse(atob(response.credential.split('.')[1]));

            if (!payload.email || !payload.sub) {
                throw new Error('Invalid Google token: missing email or sub');
            }

            const clientGUID = getClientGUID();
            authenticateWithGoogle(response.credential, clientGUID);

        } else {
            hideLoading();
            showError('Invalid response from Google. Please try again.');
        }
    } catch (error) {
        hideLoading();
        showError('Failed to process Google login. Please try again.');
    }
}

// Authenticate with Google via Lambda
async function authenticateWithGoogle(idToken, clientGUID) {
    try {
        if (!idToken) {
            throw new Error('No Google token provided');
        }

        const requestBody = {
            provider: 'google',
            id_token: idToken,  // This is the JWT id_token from Google
            client_unique_guid: clientGUID
        };

        const response = await fetch(`${LAMBDA_PROXY_URL}/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }

        const authResult = await response.json();

        // Store authentication data
        localStorage.setItem('lambda_token', authResult.token);
        localStorage.setItem('user_info', JSON.stringify(authResult.user));
        localStorage.setItem('client_guid', clientGUID);

        hideLoading();

        // Redirect to dashboard
        window.location.href = 'index.html';

    } catch (error) {
        hideLoading();
        showError('Google authentication failed: ' + error.message);
    }
}

// Utility functions
function showLoading() {
    Swal.fire({
        title: 'Signing you in...',
        text: 'Please wait while we authenticate you',
        allowOutsideClick: false,
        allowEscapeKey: false,
        showConfirmButton: false,
        didOpen: () => {
            Swal.showLoading();
        }
    });
}

function hideLoading() {
    Swal.close();
}

function showError(message) {
    Swal.fire({
        icon: 'error',
        title: 'Error',
        text: message
    });
}
```

### Step 4: Update Configuration Values

Replace the following placeholders in your code:

- `YOUR_GOOGLE_CLIENT_ID` - Your Google OAuth Client ID
- `your-lambda-url.lambda-url.region.on.aws` - Your Lambda proxy URL
- `your-default-client-guid` - Your default client GUID

## Backend Integration

### Lambda Function Requirements

Your Lambda function should handle the `/auth/login` endpoint with the following:

**Request Format:**
```json
{
    "provider": "google",
    "id_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6Ij...",
    "client_unique_guid": "9e1d961a-bfc2-469d-8526-8af75f536656"
}
```

**Response Format (Success):**
```json
{
    "token": "your-jwt-token",
    "user": {
        "id": "user-uuid",
        "email": "user@example.com",
        "username": "username",
        "role_id": "role-uuid",
        "role": "role_name",
        "is_active": true
    }
}
```

**Response Format (Error):**
```json
{
    "message": "Error message here",
    "error": "Error code or details"
}
```

### Lambda Function Steps

1. **Validate the id_token:**
   - Verify the JWT signature using Google's public keys
   - Check token expiration
   - Verify the `aud` (audience) matches your Google Client ID
   - Verify the `iss` (issuer) is from Google

2. **Extract user information:**
   - Get email from `payload.email`
   - Get Google user ID from `payload.sub`
   - Get name from `payload.name` (if available)

3. **Check/Create user in database:**
   - Query the `users` view for existing user by email or `google_id`
   - If user exists, update last login time
   - If user doesn't exist, create new user record
   - Set `provider` to 'google' and store `google_id`

4. **Generate authentication token:**
   - Create JWT token with user information
   - Include user ID, email, role, and permissions

5. **Return response:**
   - Return token and user information
   - Handle errors appropriately

## Testing

### Step 1: Test Google Sign-In Button

1. Open your sign-in page
2. Verify the Google Sign-In button appears
3. Click the button
4. Google popup should appear

### Step 2: Test Authentication Flow

1. Click "Sign in with Google"
2. Select a Google account
3. Grant permissions if prompted
4. Verify redirect to dashboard
5. Check localStorage for `lambda_token` and `user_info`

### Step 3: Test Error Handling

1. Test with invalid token (if possible)
2. Test with network errors
3. Verify error messages display correctly

## Troubleshooting

### Issue: "Invalid or expired id_token"

**Possible Causes:**
1. Google Client ID mismatch between frontend and database
2. Token validation failing in Lambda
3. Token expired (shouldn't happen with fresh tokens)

**Solutions:**
- Verify Google Client ID in `IdentityProviders` table matches the one in your HTML
- Check Lambda logs for detailed error messages
- Ensure token validation logic is correct

### Issue: Google Sign-In button doesn't appear

**Possible Causes:**
1. Google Identity Services script not loaded
2. Client ID incorrect
3. JavaScript errors preventing initialization

**Solutions:**
- Check browser console for errors
- Verify script tag is present and loads correctly
- Verify client ID is correct
- Check network tab for script loading

### Issue: "Network error" or request timeout

**Possible Causes:**
1. Lambda URL incorrect
2. CORS issues
3. Lambda function not responding

**Solutions:**
- Verify Lambda URL is correct
- Check Lambda function logs
- Ensure CORS is configured on Lambda
- Check network tab in browser dev tools

### Issue: User not found in database

**Possible Causes:**
1. User doesn't exist and auto-creation is disabled
2. Database query failing
3. Views not created correctly

**Solutions:**
- Check if auto-creation is enabled in Lambda
- Verify database views exist
- Check Lambda logs for database errors

### Issue: Authentication succeeds but redirect fails

**Possible Causes:**
1. localStorage not saving
2. Redirect URL incorrect
3. Authentication check on dashboard page failing

**Solutions:**
- Check browser console for localStorage errors
- Verify redirect URL is correct
- Check dashboard page authentication logic

## Security Considerations

1. **Token Validation:**
   - Always validate the Google id_token on the backend
   - Never trust client-side token validation alone
   - Verify token signature using Google's public keys

2. **HTTPS:**
   - Always use HTTPS in production
   - Google requires HTTPS for OAuth

3. **Client ID:**
   - Keep your Google Client ID secure
   - Don't expose sensitive credentials in client-side code
   - Use environment variables where possible

4. **Token Storage:**
   - Store tokens securely in localStorage or httpOnly cookies
   - Implement token refresh mechanism
   - Clear tokens on logout

5. **CORS:**
   - Configure CORS properly on Lambda
   - Only allow trusted origins

## Additional Resources

- [Google Identity Services Documentation](https://developers.google.com/identity/gsi/web)
- [Google OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [JWT Token Validation](https://jwt.io/introduction)

## Support

If you encounter issues not covered in this guide:

1. Check browser console for errors
2. Check Lambda function logs
3. Verify database configuration
4. Review Google Cloud Console for OAuth settings
5. Test with a fresh browser session (clear cache/cookies)

---

**Last Updated:** January 2026  
**Version:** 1.0.0
