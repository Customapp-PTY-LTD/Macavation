# Hope Diamond Transport - Best Practices Guide

**Version: 1.1.0**  
**Last Updated: January 2026**  
**Based on improvements since admin_portal_complete_instructions.mdc**  
**Includes: Penetration Testing (Pentest) Considerations**

## Table of Contents

1. [API Response Validation](#api-response-validation)
2. [Error Handling Patterns](#error-handling-patterns)
3. [Data Function Patterns](#data-function-patterns)
4. [Form Validation & User Input](#form-validation--user-input)
5. [Module Architecture](#module-architecture)
6. [Database Integration](#database-integration)
7. [Security Practices](#security-practices)
8. [Penetration Testing (Pentest) Considerations](#penetration-testing-pentest-considerations)
9. [Code Organization](#code-organization)
10. [UI/UX Consistency](#uiux-consistency)
11. [Performance Optimization](#performance-optimization)

---

## API Response Validation

### Critical: Always Check `success` Field

**Problem:** APIs can return HTTP 200 with `{success: false, error: "..."}`. Only checking HTTP status leads to false success messages.

**Solution:** Always validate the `success` field in API responses.

#### ❌ Bad Example
```javascript
const response = await fetch('/api/endpoint', options);
if (!response.ok) {
    throw new Error('Request failed');
}
const result = await response.json();
// Shows success even if result.success === false
Swal.fire('Success', 'Operation completed!', 'success');
```

#### ✅ Good Example
```javascript
const response = await fetch('/api/endpoint', options);
if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || errorData.error || `HTTP error! status: ${response.status}`);
}

const result = await response.json();

// CRITICAL: Check success field
if (result.success === false) {
    throw new Error(result.error || 'Operation failed');
}

// Only show success if truly successful
Swal.fire('Success', 'Operation completed!', 'success');
```

### Response Parsing Best Practices

```javascript
// Always handle non-JSON responses gracefully
const responseText = await response.text();
let data;
try {
    data = JSON.parse(responseText);
} catch (e) {
    throw new Error(`Invalid JSON response from server: ${responseText.substring(0, 200)}`);
}

// Check for wrapped responses (common in Lambda functions)
if (data && data.function_name) {
    data = data.function_name; // Unwrap if needed
}
```

### Error Message Extraction

```javascript
// Extract error messages from various response formats
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

throw new Error(errorMessage);
```

---

## Error Handling Patterns

### Consistent Error Handling Structure

#### 1. Try-Catch with User Feedback

```javascript
async function saveData() {
    try {
        // Show loading state
        window.showLoading();
        
        // Perform operation
        const result = await dataFunctions.createItem(data, token);
        
        // Validate response
        if (result.success === false) {
            throw new Error(result.error || 'Operation failed');
        }
        
        // Hide loading
        window.hideLoading();
        
        // Show success
        Swal.fire('Success', 'Item created successfully.', 'success');
        
        // Refresh data
        loadData();
        
    } catch (error) {
        window.hideLoading();
        Swal.fire('Error', error.message || 'Unable to save item.', 'error');
    }
}
```

#### 2. Graceful Degradation

```javascript
// Always provide fallbacks
function getAuthToken() {
    if (typeof authService !== 'undefined' && authService.token) {
        return authService.token;
    }
    const lambdaToken = localStorage.getItem('lambda_token');
    if (lambdaToken) {
        return lambdaToken;
    }
    return null; // Explicit null, not undefined
}
```

#### 3. Error Logging

```javascript
catch (error) {
    // Log for debugging
    console.error('Operation failed:', {
        error: error.message,
        stack: error.stack,
        context: 'saveData',
        data: data
    });
    
    // User-friendly message
    Swal.fire('Error', error.message || 'Operation failed.', 'error');
}
```

### Loading States

```javascript
// Always show loading during async operations
function setTableLoading() {
    $('#tableBody').html(`
        <tr>
            <td colspan="5" class="text-center py-5">
                <div class="empty-state">
                    <i class="fas fa-circle-notch fa-spin mb-3"></i>
                    <p class="mb-0">Loading data...</p>
                </div>
            </td>
        </tr>
    `);
}

function setTableError(message) {
    $('#tableBody').html(`
        <tr>
            <td colspan="5" class="text-center py-5">
                <div class="empty-state text-danger">
                    <i class="fas fa-triangle-exclamation mb-3"></i>
                    <p class="mb-0">${message}</p>
                </div>
            </td>
        </tr>
    `);
}
```

---

## Data Function Patterns

### Parameter Handling

#### Always Use Null Coalescing

```javascript
// ❌ Bad: undefined values can cause issues
const params = {
    p_name: driverData.name,
    p_email: driverData.email,
    p_phone: driverData.phone
};

// ✅ Good: Explicit null handling
const params = {
    p_name: driverData.name,
    p_email: driverData.email || null,
    p_phone: driverData.phone || null,
    p_optional_field: driverData.optional_field || null
};
```

#### Special Handling for Date Fields

```javascript
// Handle empty strings and undefined for dates
let pdpExpiryDate = null;
if (driverData.pdp_expiry_date !== undefined && 
    driverData.pdp_expiry_date !== null && 
    driverData.pdp_expiry_date !== '') {
    pdpExpiryDate = driverData.pdp_expiry_date;
}

const params = {
    // ... other params
    p_pdp_expiry_date: pdpExpiryDate, // Always include, even if null
};
```

### Function Response Handling

```javascript
// Handle wrapped responses
getDrivers: async function (token = null) {
    const response = await this.callFunction('get_drivers', {}, token);
    
    // Unwrap if response is wrapped
    if (response && response.get_drivers) {
        return response.get_drivers;
    }
    
    // Return array or empty array
    return Array.isArray(response) ? response : [];
}
```

### Consistent Parameter Naming

```javascript
// Use consistent prefixes
// p_ for parameters
// v_ for variables (in SQL)
// Use snake_case for database parameters
// Use camelCase for JavaScript variables

// Frontend (camelCase)
const driverData = {
    fullName: 'John Doe',
    email: 'john@example.com',
    pdpExpiryDate: '2024-12-31'
};

// Backend parameters (snake_case with p_ prefix)
const params = {
    p_full_name: driverData.fullName,
    p_email: driverData.email,
    p_pdp_expiry_date: driverData.pdpExpiryDate
};
```

---

## Form Validation & User Input

### Client-Side Validation

```javascript
// Validate before submission
function validateForm() {
    const errors = [];
    
    if (!driverData.full_name || !driverData.full_name.trim()) {
        errors.push('Full name is required');
    }
    
    if (!driverData.employee_id || !driverData.employee_id.trim()) {
        errors.push('Employee ID is required');
    }
    
    if (errors.length > 0) {
        Swal.fire('Validation Error', errors.join('<br>'), 'warning');
        return false;
    }
    
    return true;
}
```

### Form Population

```javascript
// Always handle missing or null values
function populateForm(driver) {
    $('#driverName').val(driver.full_name || '');
    $('#driverEmail').val(driver.email || '');
    
    // Handle dates with substring for date inputs
    $('#driverLicenseExpiryDate').val(
        driver.license_expiry_date 
            ? driver.license_expiry_date.substring(0, 10) 
            : ''
    );
    
    // Handle optional fields
    $('#driverNotes').val(driver.notes || '');
}
```

### Input Sanitization

```javascript
// Always trim user input
const driverData = {
    full_name: $('#driverName').val().trim(),
    email: $('#driverEmail').val().trim() || null,
    notes: $('#driverNotes').val().trim() || null
};

// Validate email format
if (driverData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(driverData.email)) {
    Swal.fire('Invalid Email', 'Please enter a valid email address.', 'warning');
    return;
}
```

---

## Module Architecture

### Module Structure Pattern

```javascript
var _moduleName = (function () {
    // Private variables
    let items = [];
    let filteredItems = [];
    let editingItem = null;
    let modal;
    
    // Initialization
    function init() {
        unbindEvents(); // Prevent duplicate handlers
        cacheDom();
        bindEvents();
        loadData();
    }
    
    // Event cleanup
    function unbindEvents() {
        $('#addBtn').off('click');
        $('#form').off('submit');
        // ... unbind all events
    }
    
    // Cache DOM elements
    function cacheDom() {
        modal = new bootstrap.Modal(document.getElementById('modal'));
    }
    
    // Bind events
    function bindEvents() {
        $('#addBtn').on('click', handleAdd);
        $('#form').on('submit', handleSubmit);
        // ... bind all events
    }
    
    // Public API
    return {
        init: init
    };
})();

// Auto-initialize
function initializeModule() {
    if (typeof dataFunctions !== 'undefined') {
        _moduleName.init();
    } else {
        setTimeout(initializeModule, 100);
    }
}

$(document).ready(function () {
    initializeModule();
});
```

### Module Loading Best Practices

```javascript
// Always check dependencies before initialization
function initializeModule() {
    if (typeof dataFunctions !== 'undefined' && 
        typeof authService !== 'undefined') {
        _moduleName.init();
    } else {
        // Retry with exponential backoff
        setTimeout(initializeModule, 100);
    }
}
```

### Event Handler Management

```javascript
// Always unbind before binding to prevent duplicates
function unbindEvents() {
    $('#button').off('click');
    $('#form').off('submit');
    $(document).off('click', '.dynamic-button');
}

function bindEvents() {
    $('#button').on('click', handleClick);
    $('#form').on('submit', handleSubmit);
    $(document).on('click', '.dynamic-button', handleDynamicClick);
}
```

---

## Database Integration

### Function Parameter Mapping

```javascript
// Map frontend field names to database parameter names
// Document the mapping clearly

// Frontend fields (camelCase)
const companyData = {
    name: 'Acme Corp',
    email: 'contact@acme.com',
    phone: '123-456-7890',
    website: 'https://acme.com'
};

// Database parameters (snake_case with p_ prefix)
const params = {
    p_company_name: companyData.name,        // Note: name → company_name
    p_email: companyData.email,              // Note: email → email_primary in DB
    p_phone: companyData.phone,              // Note: phone → phone_primary in DB
    p_website_url: companyData.website       // Note: website → website_url
};
```

### Response Field Mapping

```javascript
// Handle different field name conventions
function populateForm(company) {
    // Backend might return: name, email_primary, phone_primary, website
    // Frontend expects: name, email, phone, website
    
    $('#companyName').val(company.name || company.company_name || '');
    $('#companyEmail').val(company.email_primary || company.email || '');
    $('#companyPhone').val(company.phone_primary || company.phone || '');
    $('#companyWebsite').val(company.website || company.website_url || '');
}
```

### Database Function Error Handling

```javascript
// Always check function response structure
const response = await dataFunctions.createItem(data, token);

// Handle different response formats
if (response && response.success === false) {
    throw new Error(response.error || 'Failed to create item');
}

// Handle wrapped responses
if (response && response.create_item) {
    return response.create_item;
}

// Return response as-is if already in correct format
return response;
```

---

## Security Practices

### Authentication Token Management

```javascript
// Centralized token retrieval
function getAuthToken() {
    // Try authService first
    if (typeof authService !== 'undefined' && authService.token) {
        return authService.token;
    }
    
    // Fallback to localStorage
    const lambdaToken = localStorage.getItem('lambda_token');
    if (lambdaToken) {
        return lambdaToken;
    }
    
    return null;
}

// Always validate token before API calls
async function makeApiCall() {
    const token = getAuthToken();
    if (!token) {
        throw new Error('Missing authentication token. Please sign in again.');
    }
    
    // Proceed with API call
}
```

### Input Validation

```javascript
// Never trust user input
function sanitizeInput(input) {
    if (typeof input !== 'string') {
        return '';
    }
    
    // Trim whitespace
    input = input.trim();
    
    // Remove potentially dangerous characters (adjust based on needs)
    // input = input.replace(/[<>]/g, ''); // Remove HTML tags
    
    return input;
}

// Validate required fields
function validateRequired(field, fieldName) {
    if (!field || !field.trim()) {
        throw new Error(`${fieldName} is required`);
    }
}
```

### SQL Injection Prevention

```javascript
// Always use parameterized queries (handled by database functions)
// Never concatenate user input into SQL strings

// ❌ Bad (if writing raw SQL - which we don't)
// const query = `SELECT * FROM users WHERE email = '${userEmail}'`;

// ✅ Good (using database functions with parameters)
const params = {
    p_email: userEmail  // Database function handles parameterization
};
await dataFunctions.getUserByEmail(params, token);
```

---

## Penetration Testing (Pentest) Considerations

### Overview

This section covers security practices specifically important for penetration testing and security audits. All code should be reviewed with these considerations in mind.

### 1. Cross-Site Scripting (XSS) Prevention

#### Output Encoding

```javascript
// ❌ Bad: Directly inserting user input into HTML
$('#content').html(userInput); // Vulnerable to XSS

// ✅ Good: Escape HTML entities
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

$('#content').text(userInput); // jQuery .text() auto-escapes
// OR
$('#content').html(escapeHtml(userInput));
```

#### Content Security Policy (CSP)

```html
<!-- Add to HTML head -->
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; 
               script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://accounts.google.com; 
               style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; 
               img-src 'self' data: https:; 
               connect-src 'self' https://*.supabase.co https://*.lambda-url.*.on.aws;">
```

#### Safe DOM Manipulation

```javascript
// ❌ Bad: Using innerHTML with user input
element.innerHTML = userInput;

// ✅ Good: Use textContent or jQuery .text()
element.textContent = userInput;
// OR
$(element).text(userInput);

// ✅ Good: If HTML is needed, sanitize first
const sanitized = DOMPurify.sanitize(userInput);
element.innerHTML = sanitized;
```

### 2. Cross-Site Request Forgery (CSRF) Protection

#### Token-Based CSRF Protection

```javascript
// Generate CSRF token on page load
function generateCSRFToken() {
    const token = crypto.randomUUID() || Math.random().toString(36).substring(2, 15);
    sessionStorage.setItem('csrf_token', token);
    return token;
}

// Include CSRF token in all state-changing requests
async function makeAuthenticatedRequest(endpoint, options = {}) {
    const csrfToken = sessionStorage.getItem('csrf_token');
    
    const defaultOptions = {
        headers: {
            'Authorization': `Bearer ${getAuthToken()}`,
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken // Include CSRF token
        }
    };
    
    // Merge options
    const requestOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };
    
    return await fetch(endpoint, requestOptions);
}
```

#### SameSite Cookie Attributes

```javascript
// Backend should set cookies with SameSite attribute
// Set-Cookie: session=xxx; SameSite=Strict; Secure; HttpOnly
```

### 3. Authentication & Authorization Security

#### Token Storage Security

```javascript
// ⚠️ Current: localStorage (accessible to XSS)
// Better: httpOnly cookies (set by backend)
// Best: httpOnly cookies + CSRF tokens

// For localStorage tokens (current implementation):
// - Always validate token expiration
// - Implement token refresh mechanism
// - Clear tokens on logout
// - Never expose tokens in URLs or logs

function clearAuthData() {
    localStorage.removeItem('lambda_token');
    localStorage.removeItem('user_info');
    sessionStorage.removeItem('csrf_token');
    // Clear all auth-related data
}
```

#### Token Validation

```javascript
// Always validate token before use
function validateToken(token) {
    if (!token || typeof token !== 'string') {
        return false;
    }
    
    // Check token format (JWT should have 3 parts)
    if (token.split('.').length !== 3) {
        return false;
    }
    
    // Check expiration (if JWT)
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp < Date.now() / 1000) {
            return false; // Token expired
        }
    } catch (e) {
        return false; // Invalid token format
    }
    
    return true;
}
```

#### Role-Based Access Control (RBAC)

```javascript
// Always verify permissions on both client and server
async function checkPermission(operation, resource) {
    const userInfo = JSON.parse(localStorage.getItem('user_info') || '{}');
    const userRole = userInfo.role_name || userInfo.role;
    
    // Client-side check (UI only - server must also validate)
    if (!hasPermission(userRole, operation, resource)) {
        Swal.fire('Access Denied', 'You do not have permission to perform this action.', 'error');
        return false;
    }
    
    // Server will also validate - never trust client-side checks alone
    return true;
}
```

### 4. Input Validation & Sanitization

#### Comprehensive Input Validation

```javascript
// Validate all input types
function validateInput(input, type, options = {}) {
    if (input === null || input === undefined) {
        return options.required ? null : '';
    }
    
    // Convert to string and trim
    let value = String(input).trim();
    
    // Type-specific validation
    switch (type) {
        case 'email':
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(value)) {
                throw new Error('Invalid email format');
            }
            // Additional: Check for email injection attempts
            if (/[\r\n]/.test(value)) {
                throw new Error('Invalid email format');
            }
            break;
            
        case 'phone':
            // Remove non-digit characters for validation
            const digits = value.replace(/\D/g, '');
            if (digits.length < 10 || digits.length > 15) {
                throw new Error('Invalid phone number format');
            }
            break;
            
        case 'id_number':
            // South African ID validation
            if (!/^\d{13}$/.test(value)) {
                throw new Error('Invalid ID number format');
            }
            break;
            
        case 'url':
            try {
                new URL(value);
            } catch (e) {
                throw new Error('Invalid URL format');
            }
            break;
            
        case 'text':
            // Limit length
            if (options.maxLength && value.length > options.maxLength) {
                throw new Error(`Text must be less than ${options.maxLength} characters`);
            }
            // Check for script tags
            if (/<script/i.test(value)) {
                throw new Error('Invalid characters detected');
            }
            break;
    }
    
    return value;
}
```

#### File Upload Security

```javascript
// Validate file uploads
function validateFileUpload(file, options = {}) {
    const maxSize = options.maxSize || 5 * 1024 * 1024; // 5MB default
    const allowedTypes = options.allowedTypes || ['image/jpeg', 'image/png', 'image/gif'];
    
    // Check file size
    if (file.size > maxSize) {
        throw new Error(`File size exceeds ${maxSize / 1024 / 1024}MB limit`);
    }
    
    // Check file type
    if (!allowedTypes.includes(file.type)) {
        throw new Error('File type not allowed');
    }
    
    // Check file extension (don't trust MIME type alone)
    const allowedExtensions = options.allowedExtensions || ['.jpg', '.jpeg', '.png', '.gif'];
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
        throw new Error('File extension not allowed');
    }
    
    // Check for malicious filenames
    if (/[<>:"|?*]/.test(file.name)) {
        throw new Error('Invalid filename');
    }
    
    return true;
}
```

### 5. Error Handling & Information Disclosure

#### Secure Error Messages

```javascript
// ❌ Bad: Expose internal details
catch (error) {
    Swal.fire('Error', `Database error: ${error.message}`, 'error');
    console.error('SQL Error:', error.sql); // Exposes SQL
}

// ✅ Good: Generic user message, detailed server logs
catch (error) {
    // Log detailed error server-side (not exposed to user)
    console.error('Operation failed:', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
        user: getCurrentUserId()
    });
    
    // Generic user-friendly message
    Swal.fire('Error', 'An error occurred. Please try again or contact support.', 'error');
}

// ✅ Good: Different messages for different error types
catch (error) {
    if (error.message.includes('permission') || error.message.includes('unauthorized')) {
        Swal.fire('Access Denied', 'You do not have permission to perform this action.', 'error');
    } else if (error.message.includes('not found')) {
        Swal.fire('Not Found', 'The requested resource was not found.', 'error');
    } else {
        Swal.fire('Error', 'An unexpected error occurred. Please try again.', 'error');
    }
    
    // Always log detailed error server-side
    logError(error);
}
```

#### Stack Trace Protection

```javascript
// Never expose stack traces in production
if (process.env.NODE_ENV === 'production') {
    // Suppress detailed error messages
    error.stack = undefined;
}
```

### 6. API Security

#### Rate Limiting Considerations

```javascript
// Implement client-side rate limiting (server must also enforce)
let requestCount = 0;
let requestWindow = Date.now();

function checkRateLimit() {
    const now = Date.now();
    if (now - requestWindow > 60000) { // 1 minute window
        requestCount = 0;
        requestWindow = now;
    }
    
    if (requestCount >= 60) { // 60 requests per minute
        throw new Error('Too many requests. Please wait a moment.');
    }
    
    requestCount++;
}
```

#### Request Headers Security

```javascript
// Always include security headers
const secureHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'X-Requested-With': 'XMLHttpRequest', // Helps identify AJAX requests
    'X-CSRF-Token': csrfToken
    // Never include: 'X-Forwarded-For' (server should set this)
};
```

#### HTTPS Enforcement

```javascript
// Enforce HTTPS in production
if (window.location.protocol !== 'https:' && 
    window.location.hostname !== 'localhost' &&
    window.location.hostname !== '127.0.0.1') {
    window.location.href = window.location.href.replace('http:', 'https:');
}
```

### 7. Session Management

#### Session Timeout

```javascript
// Implement session timeout
let lastActivity = Date.now();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

function updateActivity() {
    lastActivity = Date.now();
}

function checkSessionTimeout() {
    if (Date.now() - lastActivity > SESSION_TIMEOUT) {
        Swal.fire({
            title: 'Session Expired',
            text: 'Your session has expired. Please sign in again.',
            icon: 'warning',
            confirmButtonText: 'Sign In'
        }).then(() => {
            clearAuthData();
            window.location.href = 'signin.html';
        });
    }
}

// Track user activity
document.addEventListener('mousedown', updateActivity);
document.addEventListener('keypress', updateActivity);
document.addEventListener('scroll', updateActivity);

// Check session every minute
setInterval(checkSessionTimeout, 60000);
```

#### Secure Logout

```javascript
// Clear all session data on logout
async function logout() {
    try {
        // Call logout endpoint to invalidate server-side session
        await authService.signOut();
    } catch (error) {
        console.error('Logout error:', error);
    } finally {
        // Always clear client-side data, even if server call fails
        clearAuthData();
        
        // Clear any cached data
        sessionStorage.clear();
        
        // Redirect to signin
        window.location.href = 'signin.html';
    }
}
```

### 8. Data Protection

#### Sensitive Data Handling

```javascript
// Never log sensitive data
function logOperation(operation, data) {
    // Remove sensitive fields before logging
    const sanitizedData = { ...data };
    delete sanitizedData.password;
    delete sanitizedData.token;
    delete sanitizedData.creditCard;
    delete sanitizedData.ssn;
    
    console.log('Operation:', operation, sanitizedData);
}

// Mask sensitive data in UI
function maskEmail(email) {
    const [local, domain] = email.split('@');
    const maskedLocal = local.substring(0, 2) + '***' + local.substring(local.length - 1);
    return `${maskedLocal}@${domain}`;
}

function maskPhone(phone) {
    return phone.replace(/\d(?=\d{4})/g, '*');
}
```

#### Password Security

```javascript
// Password validation
function validatePassword(password) {
    const errors = [];
    
    if (password.length < 8) {
        errors.push('Password must be at least 8 characters');
    }
    
    if (!/[A-Z]/.test(password)) {
        errors.push('Password must contain at least one uppercase letter');
    }
    
    if (!/[a-z]/.test(password)) {
        errors.push('Password must contain at least one lowercase letter');
    }
    
    if (!/\d/.test(password)) {
        errors.push('Password must contain at least one number');
    }
    
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
        errors.push('Password must contain at least one special character');
    }
    
    // Check for common passwords
    const commonPasswords = ['password', '12345678', 'qwerty', 'admin'];
    if (commonPasswords.includes(password.toLowerCase())) {
        errors.push('Password is too common');
    }
    
    return errors;
}

// Never store passwords in plain text (handled by backend)
// Never send passwords in URLs or logs
```

### 9. Security Headers (Server-Side)

#### Required HTTP Headers

```javascript
// These should be set by the server/web server
// Example for Express.js or Lambda response:

const securityHeaders = {
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'"
};
```

### 10. Logging & Monitoring

#### Security Event Logging

```javascript
// Log security-relevant events
function logSecurityEvent(eventType, details) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        event: eventType,
        user: getCurrentUserId(),
        ip: null, // Server should log this
        userAgent: navigator.userAgent,
        details: details
    };
    
    // Send to logging service (server-side)
    // Never log sensitive data
    console.log('Security Event:', logEntry);
}

// Log failed login attempts
function logFailedLogin(email, reason) {
    logSecurityEvent('failed_login', {
        email: email, // Consider masking
        reason: reason
    });
}

// Log permission denials
function logPermissionDenied(userId, resource, operation) {
    logSecurityEvent('permission_denied', {
        resource: resource,
        operation: operation
    });
}
```

### 11. Dependency Security

#### Regular Security Audits

```javascript
// Regularly audit dependencies for vulnerabilities
// Use tools like:
// - npm audit
// - Snyk
// - OWASP Dependency-Check

// Keep dependencies updated
// Review changelogs for security patches
// Remove unused dependencies
```

### 12. Pentest Checklist

Before any penetration test, ensure:

- [ ] All user input is validated and sanitized
- [ ] XSS protection is implemented (output encoding)
- [ ] CSRF tokens are used for state-changing operations
- [ ] Authentication tokens are securely stored and validated
- [ ] Error messages don't expose sensitive information
- [ ] SQL injection is prevented (parameterized queries)
- [ ] File uploads are validated (type, size, content)
- [ ] HTTPS is enforced in production
- [ ] Security headers are properly configured
- [ ] Session management includes timeout
- [ ] Passwords meet complexity requirements
- [ ] Rate limiting is implemented
- [ ] Sensitive data is not logged
- [ ] RBAC is enforced on both client and server
- [ ] Content Security Policy is configured
- [ ] Dependencies are up-to-date and audited
- [ ] No sensitive data in URLs or client-side code
- [ ] API endpoints require authentication
- [ ] CORS is properly configured
- [ ] Input length limits are enforced

### 13. Common Vulnerabilities to Test

#### OWASP Top 10 Considerations

1. **Injection**: Use parameterized queries, validate all input
2. **Broken Authentication**: Implement proper session management, token validation
3. **Sensitive Data Exposure**: Encrypt sensitive data, use HTTPS
4. **XML External Entities (XXE)**: Not applicable (using JSON)
5. **Broken Access Control**: Implement RBAC, verify permissions
6. **Security Misconfiguration**: Configure security headers, remove default credentials
7. **XSS**: Encode output, use CSP, sanitize input
8. **Insecure Deserialization**: Validate JSON structure, don't trust client data
9. **Using Components with Known Vulnerabilities**: Keep dependencies updated
10. **Insufficient Logging & Monitoring**: Log security events, monitor for anomalies

---

## Code Organization

### File Structure

```
modules/
├── module-name/
│   ├── html/
│   │   └── module-name_grid.html
│   ├── js/
│   │   └── module-name_grid.js
│   └── css/
│       └── module-name_grid.css
```

### Naming Conventions

```javascript
// Files: snake_case
// modules/drivers/js/drivers_grid.js

// JavaScript variables: camelCase
let drivers = [];
let editingDriver = null;

// Database parameters: snake_case with p_ prefix
const params = {
    p_full_name: 'John Doe',
    p_employee_id: 'EMP001'
};

// Database functions: snake_case
create_driver_simple()
update_driver_simple()
get_drivers()
```

### Separation of Concerns

```javascript
// auth-service.js: Authentication only
class AuthService {
    login() { }
    logout() { }
    getToken() { }
}

// data-functions.js: Data operations only
var _dataFunctions = {
    getDrivers() { },
    createDriver() { },
    updateDriver() { }
};

// module-name_grid.js: UI logic only
var _moduleName = {
    renderGrid() { },
    handleEdit() { },
    handleDelete() { }
};
```

---

## UI/UX Consistency

### Loading States

```javascript
// Consistent loading state pattern
function setLoadingState() {
    $('#content').html(`
        <div class="empty-state text-center py-5">
            <i class="fas fa-circle-notch fa-spin mb-3"></i>
            <p class="mb-0">Loading...</p>
        </div>
    `);
}
```

### Empty States

```javascript
// Consistent empty state pattern
function setEmptyState(message = 'No items found.') {
    $('#content').html(`
        <div class="empty-state text-center py-5">
            <i class="fas fa-inbox mb-3"></i>
            <p class="mb-0">${message}</p>
        </div>
    `);
}
```

### Error States

```javascript
// Consistent error state pattern
function setErrorState(message) {
    $('#content').html(`
        <div class="empty-state text-center py-5 text-danger">
            <i class="fas fa-triangle-exclamation mb-3"></i>
            <p class="mb-0">${message}</p>
        </div>
    `);
}
```

### Success Messages

```javascript
// Use SweetAlert2 consistently
Swal.fire({
    icon: 'success',
    title: 'Success',
    text: 'Operation completed successfully.',
    confirmButtonColor: '#0d6efd'
});
```

### Confirmation Dialogs

```javascript
// Consistent confirmation pattern
Swal.fire({
    title: 'Confirm Action',
    text: 'Are you sure you want to proceed?',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#6c757d',
    confirmButtonText: 'Yes, proceed',
    cancelButtonText: 'Cancel'
}).then((result) => {
    if (result.isConfirmed) {
        performAction();
    }
});
```

---

## Performance Optimization

### Debouncing Search

```javascript
// Debounce search input to reduce API calls
let searchTimeout;
$('#searchInput').on('input', function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        performSearch($(this).val());
    }, 300); // Wait 300ms after user stops typing
});
```

### Lazy Loading

```javascript
// Load data only when needed
function loadData() {
    if (items.length === 0) {
        fetchData();
    }
}
```

### Caching

```javascript
// Cache frequently accessed data
let cachedRoles = null;

async function getRoles() {
    if (cachedRoles) {
        return cachedRoles;
    }
    
    cachedRoles = await dataFunctions.getRoles(token);
    return cachedRoles;
}
```

### Batch Operations

```javascript
// Load related data in parallel
async function loadDriverData() {
    const [drivers, inspections, vehicles] = await Promise.all([
        dataFunctions.getDrivers(token),
        dataFunctions.getInspections(token),
        dataFunctions.getVehicles(token)
    ]);
    
    // Process data
}
```

---

## Common Pitfalls to Avoid

### 1. Not Checking `success` Field
```javascript
// ❌ Bad
const result = await apiCall();
Swal.fire('Success', 'Done!', 'success');

// ✅ Good
const result = await apiCall();
if (result.success === false) {
    throw new Error(result.error);
}
Swal.fire('Success', 'Done!', 'success');
```

### 2. Not Handling Null/Undefined
```javascript
// ❌ Bad
const params = {
    p_email: driverData.email
};

// ✅ Good
const params = {
    p_email: driverData.email || null
};
```

### 3. Not Unbinding Events
```javascript
// ❌ Bad: Causes duplicate handlers
function bindEvents() {
    $('#button').on('click', handleClick);
}

// ✅ Good: Unbind first
function bindEvents() {
    $('#button').off('click');
    $('#button').on('click', handleClick);
}
```

### 4. Not Validating Required Fields
```javascript
// ❌ Bad
async function save() {
    const data = {
        name: $('#name').val()
    };
    await apiCall(data);
}

// ✅ Good
async function save() {
    const name = $('#name').val().trim();
    if (!name) {
        Swal.fire('Error', 'Name is required', 'warning');
        return;
    }
    
    const data = { name };
    await apiCall(data);
}
```

### 5. Not Handling Wrapped Responses
```javascript
// ❌ Bad
const drivers = await dataFunctions.getDrivers(token);
drivers.forEach(...); // Might fail if wrapped

// ✅ Good
let drivers = await dataFunctions.getDrivers(token);
if (drivers && drivers.get_drivers) {
    drivers = drivers.get_drivers;
}
drivers = Array.isArray(drivers) ? drivers : [];
drivers.forEach(...);
```

---

## Testing Checklist

Before deploying any feature, verify:

- [ ] API responses are validated (check `success` field)
- [ ] Error handling is comprehensive
- [ ] Loading states are shown during async operations
- [ ] Empty states are handled gracefully
- [ ] Form validation prevents invalid submissions
- [ ] Required fields are validated
- [ ] Null/undefined values are handled
- [ ] Event handlers are properly unbound/rebound
- [ ] Authentication tokens are validated
- [ ] User feedback is clear and helpful
- [ ] Mobile responsiveness is maintained
- [ ] Code follows naming conventions
- [ ] Database parameter mapping is correct
- [ ] Response field mapping handles different formats

---

## Summary

Key improvements since the initial setup:

1. **API Response Validation**: Always check `success` field, not just HTTP status
2. **Error Handling**: Comprehensive try-catch with user-friendly messages
3. **Parameter Handling**: Explicit null handling for optional fields
4. **Event Management**: Always unbind before binding to prevent duplicates
5. **Form Validation**: Validate before submission, handle all edge cases
6. **Field Mapping**: Document and handle differences between frontend and backend
7. **Loading States**: Always show loading during async operations
8. **Response Unwrapping**: Handle wrapped responses from Lambda functions
9. **Token Management**: Centralized token retrieval with fallbacks
10. **Code Organization**: Clear separation of concerns, consistent patterns
11. **Security Hardening**: XSS prevention, CSRF protection, input validation, secure error handling
12. **Pentest Readiness**: Comprehensive security checklist and OWASP Top 10 considerations

These practices ensure maintainable, reliable, secure, and user-friendly code that is ready for security audits and penetration testing.
