# Lessons Learned - Common Mistakes and Solutions

This document captures critical lessons learned from building FruitLive. Use this to avoid common pitfalls and build more robust applications.

## 🔴 Critical Issues

### 1. Data Functions Timing Issues

**Problem**: Modules trying to use `dataFunctions` before it's available, causing undefined errors.

**Solution**:
- Always wait for `dataFunctions` in module initialization
- Use `waitForDataFunctions()` utility if available
- Implement fallback with setTimeout if utility not available

```javascript
// ✅ CORRECT
async function initializeMyModule() {
    // Wait for dataFunctions
    if (typeof waitForDataFunctions === 'function') {
        await waitForDataFunctions(50, 100);
    } else if (typeof dataFunctions === 'undefined') {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (typeof dataFunctions === 'undefined') {
            throw new Error('dataFunctions is not available');
        }
    }
    // Now safe to use dataFunctions
    const data = await dataFunctions.getItems();
}

// ❌ WRONG
async function initializeMyModule() {
    // This will fail if dataFunctions isn't loaded yet
    const data = await dataFunctions.getItems();
}
```

### 2. Authentication Flow Issues

**Problem**: Redirect loops, token not available after login, localStorage timing issues.

**Solution**:
- Check authentication at multiple points (index.html script, DOMContentLoaded, route loading)
- Use `sessionStorage` flag `just_logged_in` to handle post-login redirects
- Always check both `lambda_token` and `user_info` in localStorage
- Use `window.location.replace()` instead of `window.location.href` for auth redirects

```javascript
// ✅ CORRECT - Check auth before any content loads
(function() {
    const token = localStorage.getItem('lambda_token');
    const userInfo = localStorage.getItem('user_info');
    if (!token || !userInfo) {
        window.location.replace('signin.html');
    }
})();
```

### 3. Module Initialization Pattern

**Problem**: Modules not initializing, initialization functions not found.

**Solution**:
- Always export initialization function with naming pattern: `initialize[ModuleName]Grid()`
- Add module initializer to `appRouter.js` `moduleInitializers` object
- Use setTimeout delay after script loading to ensure scripts are executed

```javascript
// ✅ CORRECT - In appRouter.js
const moduleInitializers = {
    'my-module-grid': () => {
        if (typeof initializeMyModuleGrid === 'function') {
            initializeMyModuleGrid();
        }
    }
};

// In module JS file
async function initializeMyModuleGrid() {
    // Module initialization code
}
```

### 4. Cache Invalidation

**Problem**: Stale data shown after create/update/delete operations.

**Solution**:
- Always invalidate related cache keys after mutations
- Map mutation functions to cache keys in `invalidateCache()` method
- Reload data after successful mutations

```javascript
// ✅ CORRECT
async function saveItem(itemData) {
    const result = await dataFunctions.createItem(itemData);
    if (result.success) {
        // Invalidate cache
        dataFunctions.invalidateCache('create_item_simple');
        // Reload data
        await loadItems();
    }
}
```

### 5. Input Validation and Sanitization

**Problem**: SQL injection, XSS attacks, invalid data causing errors.

**Solution**:
- Always validate input on client side
- Sanitize all user input before sending to server
- Use `InputValidator` utility for validation
- Server-side validation is also critical

```javascript
// ✅ CORRECT
const formData = {
    name: InputValidator.sanitizeString($('#name').val()),
    description: InputValidator.sanitizeString($('#description').val())
};

// Validate before submission
if (!InputValidator.validateRequired(formData.name)) {
    showError('Name is required');
    return;
}
```

### 6. Error Handling

**Problem**: Silent failures, unclear error messages, no user feedback.

**Solution**:
- Always wrap async operations in try-catch
- Provide user-friendly error messages
- Log errors to console for debugging
- Use consistent error handling pattern

```javascript
// ✅ CORRECT
async function loadData() {
    try {
        showLoading();
        const data = await dataFunctions.getItems();
        renderTable(data);
        hideLoading();
    } catch (error) {
        console.error('Error loading data:', error);
        showError('Failed to load data: ' + error.message);
        hideLoading();
    }
}
```

### 7. Hardcoded Values

**Problem**: Hardcoded IDs, URLs, and configuration values making code inflexible.

**Solution**:
- Use configuration files for environment-specific values
- Store IDs in constants or configuration
- Use environment settings from `appRouteConfig.json`
- Never hardcode user IDs, role IDs, or client GUIDs

```javascript
// ❌ WRONG
const roleId = 'f8c7989a-cdf4-4804-952a-47565acd9c4c';

// ✅ CORRECT
const roleId = window.APP_CONFIG?.ADMIN_ROLE_ID || null;
```

### 8. RBAC Permission Issues

**Problem**: Functions created without RBAC permissions, unauthorized access.

**Solution**:
- Always add RBAC permissions when creating database functions
- Use role_permissions table to control access
- Test with different user roles
- Document permission requirements

```sql
-- ✅ CORRECT - Always add permissions
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'your_function_name', 'EXECUTE', true
FROM roles r 
WHERE r.role_name = 'admin';
```

### 9. Database Function Naming

**Problem**: Inconsistent naming making it hard to find and use functions.

**Solution**:
- Follow naming convention: `get_[entity]s`, `get_[entity]_by_id`, `create_[entity]_simple`, `update_[entity]_simple`, `delete_[entity]_hard`
- Use `p_` prefix for function parameters
- Document function purpose and parameters

```sql
-- ✅ CORRECT naming pattern
CREATE FUNCTION get_items() RETURNS TABLE (...)
CREATE FUNCTION get_item_by_id(p_id uuid) RETURNS json
CREATE FUNCTION create_item_simple(p_name text, p_description text) RETURNS json
CREATE FUNCTION update_item_simple(p_id uuid, p_name text, p_description text) RETURNS json
CREATE FUNCTION delete_item_hard(p_id uuid) RETURNS json
```

### 10. Response Format Inconsistency

**Problem**: API responses in different formats (array vs object), causing frontend errors.

**Solution**:
- Standardize response format in data-functions.js
- Handle both array and object responses
- Document expected response format

```javascript
// ✅ CORRECT - Handle different response formats
const result = await dataFunctions.getItems();
const items = Array.isArray(result) ? result : (result.data || result.items || []);
```

## 🟡 Important Patterns

### Script Loading Order

**Critical**: Load core scripts before modules:
1. jQuery
2. Bootstrap
3. Common utilities (common.js)
4. Data functions (data-functions.js)
5. Router (appRouter.js)
6. Module scripts (loaded dynamically)

### Module Structure

Each module should have:
- HTML file in `modules/[module]/html/`
- JS file in `modules/[module]/js/`
- CSS file in `modules/[module]/css/`
- Initialization function: `initialize[Module]Grid()`
- Route config entry in `appRouteConfig.json`
- Router initializer entry in `appRouter.js`

### State Management

- Use module-level variables for module state
- Avoid global state pollution
- Clear state when navigating away from module
- Use localStorage/sessionStorage sparingly for persistence

### Performance Best Practices

1. **Lazy Loading**: Load modules only when needed
2. **Caching**: Cache API responses appropriately
3. **Debouncing**: Debounce search/filter inputs
4. **Pagination**: Implement pagination for large datasets
5. **Loading States**: Always show loading indicators

## ✅ Checklist for New Modules

When creating a new module, ensure:

- [ ] Module folder structure created (html, js, css)
- [ ] Route added to `appRouteConfig.json`
- [ ] Initializer added to `appRouter.js`
- [ ] Navigation link added to `index.html`
- [ ] Database functions created with proper naming
- [ ] RBAC permissions added for database functions
- [ ] Data functions methods added to `data-functions.js`
- [ ] Module waits for `dataFunctions` before using it
- [ ] Error handling implemented
- [ ] Input validation and sanitization added
- [ ] Loading states implemented
- [ ] Cache invalidation configured
- [ ] Tested with different user roles

## 📚 Additional Resources

- See `PATTERNS.md` for design patterns
- See `RBAC_GUIDE.md` for RBAC implementation
- See `MODULE_GUIDE.md` for module creation guide
- See `DATABASE_GUIDE.md` for database patterns

