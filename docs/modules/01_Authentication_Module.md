# Authentication & User Management Module

## Overview
Manages user authentication, authorization, role-based access control, and user profile management for the Macavation digital transformation system.

---

## Database Entities

### 1. users
Primary user accounts table
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    role_id UUID REFERENCES roles(id),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id),
    updated_by UUID REFERENCES users(id)
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role_id);
CREATE INDEX idx_users_active ON users(is_active);
```

### 2. roles
User roles definition
```sql
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_name VARCHAR(100) UNIQUE NOT NULL,
    role_description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed data for Macavation roles
INSERT INTO roles (role_name, role_description) VALUES
    ('General Manager', 'Full system access - Paul'),
    ('Production Manager', 'Production and maintenance oversight - Mark Payne'),
    ('Sales Executive', 'Sales, forecasting, CRM - Peter Symons'),
    ('QA Supervisor', 'Quality assurance and food safety - Simone Naidu'),
    ('Office Administrator', 'Intake, invoicing, stock management - Josslyn Pillay'),
    ('Oil Plant Manager', 'Oil production management - Brandon Morrison'),
    ('Production Staff', 'Limited production workflow access'),
    ('Read Only', 'View-only access for external auditors/consultants');
```

### 3. permissions
System permissions
```sql
CREATE TABLE permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    permission_name VARCHAR(100) UNIQUE NOT NULL,
    permission_description TEXT,
    module_name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed permission data
INSERT INTO permissions (permission_name, permission_description, module_name) VALUES
    ('crm.view', 'View CRM records', 'CRM'),
    ('crm.create', 'Create CRM records', 'CRM'),
    ('crm.update', 'Update CRM records', 'CRM'),
    ('crm.delete', 'Delete CRM records', 'CRM'),
    ('production.view', 'View production workflows', 'Production'),
    ('production.create', 'Create production records', 'Production'),
    ('production.update', 'Update production records', 'Production'),
    ('quality.view', 'View quality records', 'Quality Assurance'),
    ('quality.create', 'Create quality records', 'Quality Assurance'),
    ('quality.approve', 'Approve quality releases', 'Quality Assurance'),
    ('finance.view', 'View financial records', 'Finance'),
    ('finance.create', 'Create financial records', 'Finance'),
    ('finance.approve', 'Approve payments/invoices', 'Finance'),
    ('stock.view', 'View stock records', 'Stock Management'),
    ('stock.update', 'Update stock records', 'Stock Management'),
    ('reports.view', 'View reports', 'Reporting'),
    ('reports.create', 'Create custom reports', 'Reporting'),
    ('admin.users', 'Manage users', 'Administration'),
    ('admin.system', 'System configuration', 'Administration');
```

### 4. role_permissions
Many-to-many relationship between roles and permissions
```sql
CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(role_id, permission_id)
);

CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission ON role_permissions(permission_id);
```

### 5. user_sessions
Track active user sessions
```sql
CREATE TABLE user_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_user_sessions_expires ON user_sessions(expires_at);
```

### 6. audit_log
System audit trail
```sql
CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100),
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
```

---

## Frontend Implementation

### HTML Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Macavation - Login</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #4A4A4A 0%, #2a2a2a 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .login-container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.3);
            width: 100%;
            max-width: 400px;
            padding: 40px;
        }

        .logo {
            text-align: center;
            margin-bottom: 30px;
        }

        .logo h1 {
            color: #5CBDB4;
            font-size: 2em;
            margin-bottom: 5px;
        }

        .logo p {
            color: #4A4A4A;
            font-size: 0.9em;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-group label {
            display: block;
            color: #4A4A4A;
            font-weight: 500;
            margin-bottom: 8px;
        }

        .form-group input {
            width: 100%;
            padding: 12px;
            border: 2px solid #e0e0e0;
            border-radius: 6px;
            font-size: 1em;
            transition: border-color 0.3s;
        }

        .form-group input:focus {
            outline: none;
            border-color: #5CBDB4;
        }

        .btn-login {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #5CBDB4 0%, #4A9A93 100%);
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 1em;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.2s;
        }

        .btn-login:hover {
            transform: translateY(-2px);
        }

        .btn-login:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .error-message {
            background: #FFCDD2;
            color: #C62828;
            padding: 10px;
            border-radius: 6px;
            margin-bottom: 20px;
            display: none;
        }

        .forgot-password {
            text-align: center;
            margin-top: 15px;
        }

        .forgot-password a {
            color: #5CBDB4;
            text-decoration: none;
            font-size: 0.9em;
        }

        .forgot-password a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <h1>Macavation</h1>
            <p>Digital Management System</p>
        </div>

        <div id="errorMessage" class="error-message"></div>

        <form id="loginForm">
            <div class="form-group">
                <label for="email">Email Address</label>
                <input type="email" id="email" name="email" required autocomplete="email">
            </div>

            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" name="password" required autocomplete="current-password">
            </div>

            <button type="submit" id="loginButton" class="btn-login">Login</button>
        </form>

        <div class="forgot-password">
            <a href="#" id="forgotPasswordLink">Forgot Password?</a>
        </div>
    </div>

    <script src="auth.js"></script>
</body>
</html>
```

### JavaScript Implementation (auth.js)

```javascript
// Supabase configuration
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Authentication class
class AuthManager {
    constructor() {
        this.currentUser = null;
        this.permissions = [];
        this.init();
    }

    init() {
        // Check for existing session
        this.checkSession();
        
        // Set up event listeners
        document.getElementById('loginForm').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('forgotPasswordLink').addEventListener('click', (e) => this.handleForgotPassword(e));
    }

    async checkSession() {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session) {
            // User is already logged in
            await this.loadUserProfile(session.user.id);
            this.redirectToDashboard();
        }
    }

    async handleLogin(event) {
        event.preventDefault();
        
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;
        const loginButton = document.getElementById('loginButton');
        const errorMessage = document.getElementById('errorMessage');

        // Disable button and show loading state
        loginButton.disabled = true;
        loginButton.textContent = 'Logging in...';
        errorMessage.style.display = 'none';

        try {
            // Sign in with Supabase Auth
            const { data, error } = await supabase.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error) throw error;

            // Load user profile and permissions
            await this.loadUserProfile(data.user.id);

            // Update last login timestamp
            await this.updateLastLogin(data.user.id);

            // Create audit log entry
            await this.createAuditLog(data.user.id, 'login', null, null);

            // Redirect to dashboard
            this.redirectToDashboard();

        } catch (error) {
            console.error('Login error:', error);
            errorMessage.textContent = this.getErrorMessage(error);
            errorMessage.style.display = 'block';
            
            loginButton.disabled = false;
            loginButton.textContent = 'Login';
        }
    }

    async loadUserProfile(userId) {
        try {
            // Get user profile with role and permissions
            const { data: userData, error: userError } = await supabase
                .from('users')
                .select(`
                    *,
                    roles (
                        id,
                        role_name,
                        role_description,
                        role_permissions (
                            permissions (
                                id,
                                permission_name,
                                permission_description,
                                module_name
                            )
                        )
                    )
                `)
                .eq('id', userId)
                .eq('is_active', true)
                .single();

            if (userError) throw userError;

            if (!userData) {
                throw new Error('User account is inactive or not found');
            }

            this.currentUser = userData;
            
            // Extract permissions
            if (userData.roles && userData.roles.role_permissions) {
                this.permissions = userData.roles.role_permissions.map(rp => rp.permissions.permission_name);
            }

            // Store user data in session storage
            sessionStorage.setItem('currentUser', JSON.stringify(userData));
            sessionStorage.setItem('permissions', JSON.stringify(this.permissions));

        } catch (error) {
            console.error('Error loading user profile:', error);
            throw error;
        }
    }

    async updateLastLogin(userId) {
        const { error } = await supabase
            .from('users')
            .update({ last_login: new Date().toISOString() })
            .eq('id', userId);

        if (error) console.error('Error updating last login:', error);
    }

    async createAuditLog(userId, action, entityType, entityId, oldValues = null, newValues = null) {
        const { error } = await supabase
            .from('audit_log')
            .insert({
                user_id: userId,
                action: action,
                entity_type: entityType,
                entity_id: entityId,
                old_values: oldValues,
                new_values: newValues,
                ip_address: await this.getClientIP()
            });

        if (error) console.error('Error creating audit log:', error);
    }

    async getClientIP() {
        // In production, get from server-side
        return 'client-ip';
    }

    getErrorMessage(error) {
        const errorMessages = {
            'Invalid login credentials': 'Invalid email or password. Please try again.',
            'Email not confirmed': 'Please confirm your email address before logging in.',
            'User account is inactive': 'Your account has been deactivated. Please contact support.',
        };

        return errorMessages[error.message] || 'An error occurred during login. Please try again.';
    }

    redirectToDashboard() {
        // Redirect based on user role
        const role = this.currentUser?.roles?.role_name;
        
        const dashboardUrls = {
            'General Manager': '/dashboard/executive.html',
            'Production Manager': '/dashboard/production.html',
            'Sales Executive': '/dashboard/sales.html',
            'QA Supervisor': '/dashboard/quality.html',
            'Office Administrator': '/dashboard/admin.html',
            'Oil Plant Manager': '/dashboard/oil-production.html'
        };

        window.location.href = dashboardUrls[role] || '/dashboard/index.html';
    }

    async handleForgotPassword(event) {
        event.preventDefault();
        
        const email = prompt('Please enter your email address:');
        
        if (email) {
            try {
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                    redirectTo: `${window.location.origin}/reset-password.html`
                });

                if (error) throw error;

                alert('Password reset email sent. Please check your inbox.');
            } catch (error) {
                alert('Error sending password reset email: ' + error.message);
            }
        }
    }

    async logout() {
        try {
            // Create logout audit log
            if (this.currentUser) {
                await this.createAuditLog(this.currentUser.id, 'logout', null, null);
            }

            // Sign out from Supabase
            const { error } = await supabase.auth.signOut();
            if (error) throw error;

            // Clear session storage
            sessionStorage.clear();

            // Redirect to login page
            window.location.href = '/login.html';
        } catch (error) {
            console.error('Logout error:', error);
        }
    }

    hasPermission(permissionName) {
        return this.permissions.includes(permissionName);
    }

    hasAnyPermission(permissionNames) {
        return permissionNames.some(permission => this.permissions.includes(permission));
    }

    hasAllPermissions(permissionNames) {
        return permissionNames.every(permission => this.permissions.includes(permission));
    }
}

// Initialize auth manager
const authManager = new AuthManager();

// Export for use in other modules
window.authManager = authManager;
```

---

## Business Rules

### Authentication Rules

1. **Password Requirements**
   - Minimum 8 characters
   - Must contain at least one uppercase letter
   - Must contain at least one lowercase letter
   - Must contain at least one number
   - Must contain at least one special character

2. **Account Lockout**
   - After 5 failed login attempts, account is locked for 30 minutes
   - Account lockout notification sent to user email
   - Admin can manually unlock accounts

3. **Session Management**
   - Sessions expire after 8 hours of inactivity
   - Users can only have 3 active sessions simultaneously
   - Session tokens must be regenerated on privilege escalation

4. **Password Reset**
   - Password reset links expire after 1 hour
   - Users cannot reuse last 5 passwords
   - Password must be changed every 90 days

### Authorization Rules

1. **Role-Based Access Control (RBAC)**
   - Users are assigned exactly one role
   - Roles define collections of permissions
   - Permissions are granular and module-specific

2. **Permission Hierarchy**
   - General Manager: Full system access
   - Department Managers: Full access to their department modules + read access to related modules
   - Staff: Limited access based on job function
   - Read Only: View-only access across all modules

3. **Data Access Rules**
   - Users can only access data relevant to their role
   - Batch/production records: Accessible only to assigned users or supervisors
   - Financial data: Restricted to Office Administrator, General Manager, and Sales Executive
   - Quality records: Full access to QA Supervisor, read access to Production Managers

### Audit Rules

1. **Audit Logging Requirements**
   - All authentication events (login, logout, failed attempts)
   - All data modifications (create, update, delete)
   - All permission changes
   - All financial transactions
   - All quality approvals/rejections

2. **Audit Log Retention**
   - Audit logs retained for 7 years
   - Logs are immutable (cannot be modified or deleted)
   - Regular backup of audit logs to external storage

3. **Audit Review**
   - General Manager can review all audit logs
   - Department managers can review logs for their department
   - Monthly audit log review for security purposes

### User Management Rules

1. **User Creation**
   - Only General Manager and Office Administrator can create users
   - Email verification required before first login
   - Default password must be changed on first login

2. **User Deactivation**
   - Users can be deactivated but not deleted (for audit trail)
   - Deactivated users cannot login
   - All active sessions terminated on deactivation

3. **User Profile Updates**
   - Users can update own profile (name, phone, email)
   - Email changes require verification
   - Role changes require General Manager approval

---

## API Endpoints

### Authentication Endpoints

```javascript
// POST /auth/login
async function login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
    });
    return { data, error };
}

// POST /auth/logout
async function logout() {
    const { error } = await supabase.auth.signOut();
    return { error };
}

// POST /auth/forgot-password
async function forgotPassword(email) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error };
}

// POST /auth/reset-password
async function resetPassword(newPassword) {
    const { error } = await supabase.auth.updateUser({
        password: newPassword
    });
    return { error };
}

// GET /auth/session
async function getSession() {
    const { data: { session } } = await supabase.auth.getSession();
    return session;
}
```

### User Management Endpoints

```javascript
// GET /users
async function getUsers(filters = {}) {
    let query = supabase
        .from('users')
        .select('*, roles(role_name)');
    
    if (filters.is_active !== undefined) {
        query = query.eq('is_active', filters.is_active);
    }
    
    if (filters.role_id) {
        query = query.eq('role_id', filters.role_id);
    }
    
    const { data, error } = await query;
    return { data, error };
}

// GET /users/:id
async function getUserById(userId) {
    const { data, error } = await supabase
        .from('users')
        .select(`
            *,
            roles (
                id,
                role_name,
                role_permissions (
                    permissions (*)
                )
            )
        `)
        .eq('id', userId)
        .single();
    
    return { data, error };
}

// POST /users
async function createUser(userData) {
    const { data, error } = await supabase
        .from('users')
        .insert(userData)
        .select()
        .single();
    
    return { data, error };
}

// PATCH /users/:id
async function updateUser(userId, updates) {
    const { data, error } = await supabase
        .from('users')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();
    
    return { data, error };
}

// POST /users/:id/deactivate
async function deactivateUser(userId) {
    const { data, error } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('id', userId)
        .select()
        .single();
    
    return { data, error };
}
```

### Permission Check Functions

```javascript
// Check if user has specific permission
async function checkPermission(userId, permissionName) {
    const { data, error } = await supabase
        .rpc('check_user_permission', {
            p_user_id: userId,
            p_permission_name: permissionName
        });
    
    return { hasPermission: data, error };
}

// Get all user permissions
async function getUserPermissions(userId) {
    const { data, error } = await supabase
        .from('users')
        .select(`
            roles (
                role_permissions (
                    permissions (permission_name)
                )
            )
        `)
        .eq('id', userId)
        .single();
    
    if (data?.roles?.role_permissions) {
        const permissions = data.roles.role_permissions.map(
            rp => rp.permissions.permission_name
        );
        return { permissions, error: null };
    }
    
    return { permissions: [], error };
}
```

---

## Security Considerations

1. **Password Storage**
   - Passwords hashed using bcrypt with salt rounds ≥ 12
   - Never store or transmit passwords in plain text
   - Use Supabase Auth for secure password management

2. **SQL Injection Prevention**
   - Use Supabase parameterized queries
   - Never concatenate user input into SQL queries
   - Validate and sanitize all inputs

3. **XSS Prevention**
   - Escape all user-generated content before rendering
   - Use Content Security Policy headers
   - Validate input on both client and server

4. **CSRF Protection**
   - Use Supabase session tokens
   - Implement proper CORS configuration
   - Validate origin headers

5. **Session Security**
   - Use secure, httpOnly cookies for session tokens
   - Implement proper session timeout
   - Regenerate session tokens on privilege changes

---

## Testing Checklist

- [ ] User can login with valid credentials
- [ ] User cannot login with invalid credentials
- [ ] Account locks after 5 failed attempts
- [ ] Password reset email is sent correctly
- [ ] Password reset link expires after 1 hour
- [ ] User session expires after 8 hours of inactivity
- [ ] User is redirected to appropriate dashboard based on role
- [ ] Permissions are correctly enforced
- [ ] Audit logs are created for all authentication events
- [ ] User can logout successfully
- [ ] Deactivated users cannot login
- [ ] Role changes are reflected immediately
- [ ] Multiple concurrent sessions work correctly
- [ ] Session tokens are secure and cannot be guessed

---

## Future Enhancements

1. **Multi-Factor Authentication (MFA)**
   - SMS-based OTP
   - Email-based OTP
   - Authenticator app support

2. **Single Sign-On (SSO)**
   - Integration with Azure AD
   - SAML 2.0 support
   - OAuth 2.0 providers

3. **Biometric Authentication**
   - Fingerprint support
   - Face recognition
   - Mobile device integration

4. **Advanced Security Features**
   - IP whitelisting
   - Geolocation-based access control
   - Device fingerprinting
   - Suspicious activity detection
