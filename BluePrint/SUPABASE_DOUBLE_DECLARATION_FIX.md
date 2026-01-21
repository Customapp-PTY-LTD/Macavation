# Supabase Double Declaration Fix

## Overview

This document describes the fix for the "Uncaught SyntaxError: Identifier 'supabase' has already been declared" error that occurred when the `supabase-client.js` script was loaded multiple times in the application.

## Problem

### Error Message

```
Uncaught SyntaxError: Identifier 'supabase' has already been declared
```

### Root Cause

The `supabase-client.js` file was being loaded multiple times (either intentionally or due to navigation/routing issues), causing JavaScript to attempt to redeclare the `supabase` constant variable. In JavaScript, `const` and `let` declarations cannot be redeclared in the same scope, leading to a syntax error.

### Common Scenarios

1. **Multiple Script Tags**: The script was included multiple times in the HTML
2. **Dynamic Loading**: The script was loaded dynamically on page navigation without proper cleanup
3. **Module Reloading**: Hot reloading or module re-initialization attempted to redeclare variables
4. **Router Navigation**: Single-page application routing caused the script to execute multiple times

## Solution

### Implementation

The fix implements a **singleton pattern** using the `window` object to ensure the Supabase client is only initialized once, regardless of how many times the script is executed.

### Key Changes

#### 1. Window Object Storage

Instead of declaring a local `const supabase`, the client is stored on the `window` object:

```javascript
// Store client on window object (persists across script reloads)
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

#### 2. Initialization Guard

Check if the client already exists before initializing:

```javascript
// Initialize Supabase Client (only if not already declared)
// Use window object to avoid redeclaration errors if script is loaded multiple times
if (typeof window.supabaseClient === 'undefined') {
    // Initialize client...
}
```

#### 3. Local Variable Declaration

Use `var` instead of `const` for the local reference to allow redeclaration:

```javascript
// Create local reference for backward compatibility (use var to allow redeclaration)
var supabase = window.supabaseClient;
```

**Why `var`?** Unlike `const` and `let`, `var` allows redeclaration in the same scope, so if the script runs multiple times, it won't throw an error.

### Complete Implementation

```javascript
/**
 * Supabase Client Configuration
 * CustomApp Admin Portal
 */

// Supabase Configuration
const SUPABASE_URL = 'https://kmxgidccytohcvctnuxm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

// Initialize Supabase Client (only if not already declared)
// Use window object to avoid redeclaration errors if script is loaded multiple times
if (typeof window.supabaseClient === 'undefined') {
    // Validate URL before creating client
    if (SUPABASE_URL && SUPABASE_URL !== 'YOUR_SUPABASE_URL' && 
        SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY') {
        if (window.supabase) {
            try {
                window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
            } catch (error) {
                console.error('Error initializing Supabase client:', error);
                window.supabaseClient = null;
            }
        } else {
            console.warn('Supabase library not loaded');
            window.supabaseClient = null;
        }
    } else {
        console.warn('Supabase credentials not configured');
        window.supabaseClient = null;
    }
}

// Create local reference for backward compatibility (use var to allow redeclaration)
var supabase = window.supabaseClient;

// ... rest of SupabaseService implementation ...

// Export for use in other modules
window.SupabaseService = SupabaseService;
window.supabaseClient = supabase;
```

## How It Works

### Initial Load

1. Script executes for the first time
2. Checks `typeof window.supabaseClient === 'undefined'` → **true**
3. Validates Supabase library is loaded (`window.supabase` exists)
4. Creates client: `window.supabaseClient = window.supabase.createClient(...)`
5. Creates local reference: `var supabase = window.supabaseClient`
6. Exports to window: `window.SupabaseService` and `window.supabaseClient`

### Subsequent Loads

1. Script executes again (e.g., on navigation)
2. Checks `typeof window.supabaseClient === 'undefined'` → **false** (already exists)
3. Skips initialization block
4. Reassigns local reference: `var supabase = window.supabaseClient` (no error with `var`)
5. Re-exports to window (overwrites, but same values)

### Benefits

✅ **No Redeclaration Errors**: `var` allows redeclaration  
✅ **Single Instance**: Client is only created once  
✅ **Persistent**: Client persists across script reloads  
✅ **Backward Compatible**: Local `supabase` variable still available  
✅ **Global Access**: Available via `window.supabaseClient` and `window.SupabaseService`

## Usage

### Accessing the Client

#### Method 1: Local Variable (Backward Compatible)

```javascript
// Works if script has been loaded
// Uses the local 'supabase' variable
const { data, error } = await supabase.from('table').select('*');
```

#### Method 2: Window Object (Recommended)

```javascript
// Always works, even if script reloads
const client = window.supabaseClient;
if (client) {
    const { data, error } = await client.from('table').select('*');
}
```

#### Method 3: SupabaseService (Recommended)

```javascript
// Use the service wrapper
const session = await window.SupabaseService.auth.getSession();
const { data } = await window.SupabaseService.db.select('workflows');
```

### Checking if Client is Available

```javascript
if (window.supabaseClient) {
    // Client is initialized and ready
    const { data } = await window.supabaseClient.from('table').select('*');
} else {
    console.warn('Supabase client not initialized');
}
```

## Validation and Error Handling

### Credential Validation

The fix includes validation to ensure credentials are properly configured:

```javascript
if (SUPABASE_URL && SUPABASE_URL !== 'YOUR_SUPABASE_URL' && 
    SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY') {
    // Valid credentials, proceed with initialization
} else {
    console.warn('Supabase credentials not configured');
    window.supabaseClient = null;
}
```

### Library Availability Check

Checks if the Supabase library is loaded before creating the client:

```javascript
if (window.supabase) {
    // Library is loaded, create client
    window.supabaseClient = window.supabase.createClient(...);
} else {
    console.warn('Supabase library not loaded');
    window.supabaseClient = null;
}
```

### Error Handling

Wraps client creation in try-catch to handle initialization errors gracefully:

```javascript
try {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (error) {
    console.error('Error initializing Supabase client:', error);
    window.supabaseClient = null;
}
```

## Testing

### Test Case 1: Multiple Script Loads

```javascript
// Simulate script loading twice
// First load
<script src="assets/js/supabase-client.js"></script>
// Should initialize successfully

// Second load (simulated)
<script src="assets/js/supabase-client.js"></script>
// Should NOT throw error, should reuse existing client
```

**Expected Result**: No errors, same client instance used.

### Test Case 2: Navigation

```javascript
// Navigate to page that includes supabase-client.js
// Navigate away
// Navigate back
// Should reuse existing client, not create new one
```

**Expected Result**: Client persists, no re-initialization.

### Test Case 3: Missing Library

```javascript
// Load script before Supabase library is loaded
// Should set window.supabaseClient = null
// Should log warning
```

**Expected Result**: Graceful failure, no errors.

## Best Practices

### 1. Always Check for Client Availability

```javascript
if (!window.supabaseClient) {
    console.error('Supabase client not initialized');
    return;
}
```

### 2. Use SupabaseService When Possible

The service wrapper provides better error handling and a consistent API:

```javascript
// Good
await window.SupabaseService.db.select('table');

// Less ideal (direct client access)
await window.supabaseClient.from('table').select('*');
```

### 3. Avoid Direct Const Declarations

If you need to create a local reference, use `var` or check first:

```javascript
// Good
var supabase = window.supabaseClient;

// Also good
const supabase = window.supabaseClient || null;

// Avoid (if script might reload)
const supabase = window.supabase.createClient(...);
```

### 4. Script Loading Order

Ensure Supabase library loads before the client script:

```html
<!-- Correct order -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="assets/js/supabase-client.js"></script>
```

## Related Files

- **Implementation**: `/admin-portal/assets/js/supabase-client.js`
- **HTML Include**: `/admin-portal/index.html` (line 431)

## Migration Guide

If you have existing code that directly declares Supabase clients:

### Before (Problematic)

```javascript
// ❌ This will cause errors on reload
const supabase = window.supabase.createClient(URL, KEY);
```

### After (Fixed)

```javascript
// ✅ Use the global client
const supabase = window.supabaseClient;

// Or check and create if needed
if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(URL, KEY);
}
const supabase = window.supabaseClient;
```

## Troubleshooting

### Issue: Client is null

**Symptoms**: `window.supabaseClient` is `null`

**Possible Causes**:
1. Supabase library not loaded
2. Invalid credentials
3. Initialization error

**Solution**: Check browser console for warnings/errors, verify script loading order.

### Issue: Client not persisting

**Symptoms**: Client is recreated on each navigation

**Possible Causes**: Script is being removed/re-added to DOM

**Solution**: Ensure script tag is in the main HTML file, not dynamically added/removed.

### Issue: Still getting redeclaration errors

**Symptoms**: Error persists after fix

**Possible Causes**: 
1. Old cached version of script
2. Multiple script files declaring Supabase
3. Using `const`/`let` instead of `var`

**Solution**: Clear browser cache, check all script files for Supabase declarations.

## Summary

The fix ensures that:

1. ✅ Supabase client is only initialized once
2. ✅ Script can be loaded multiple times without errors
3. ✅ Client persists across page navigations
4. ✅ Backward compatibility is maintained
5. ✅ Graceful error handling for missing library/credentials

**Key Takeaway**: Use `window` object for singleton patterns and `var` for variables that may be redeclared.

---

**Last Updated**: January 2025  
**Version**: 1.0.0  
**File**: `/admin-portal/assets/js/supabase-client.js`
