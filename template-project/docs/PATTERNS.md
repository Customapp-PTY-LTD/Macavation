# Design Patterns and Architecture

This document describes the key design patterns used in this architecture, based on proven patterns from FruitLive.

## Architecture Overview

This application follows a **module-based architecture** with clear separation of concerns:

```
┌─────────────────────────────────────┐
│         Presentation Layer          │
│    (HTML Templates + Bootstrap)     │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         Module Layer                │
│    (Module-specific JS + CSS)       │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         Routing Layer               │
│      (appRouter.js)                 │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         Data Layer                  │
│    (data-functions.js)              │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         API Layer                   │
│    (Lambda Proxy / Supabase)        │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         Database Layer              │
│    (PostgreSQL Functions)           │
└─────────────────────────────────────┘
```

## Core Patterns

### 1. Module-Based Routing Pattern

**Purpose**: Enable lazy-loading and code organization

**Pattern**:
- Each feature is a self-contained module
- Modules are loaded on-demand
- Routing configuration drives module loading

**Implementation**:
```javascript
// appRouteConfig.json
{
  "appRoutes": {
    "items-grid": {
      "path": "items",
      "html": "html/items_grid.html",
      "js": ["js/items_grid.js"],
      "css": ["css/items_grid.css"]
    }
  }
}

// Router loads module dynamically
_appRouter.loadContent({ routeName: 'items-grid' });
```

**Benefits**:
- Code splitting and lazy loading
- Better organization
- Easier maintenance
- Smaller initial bundle

### 2. Data Layer Abstraction Pattern

**Purpose**: Centralize data access and hide API complexity

**Pattern**:
- All API calls go through `data-functions.js`
- Frontend code doesn't know about API endpoints
- Consistent error handling and caching

**Implementation**:
```javascript
// data-functions.js
var _dataFunctions = {
    getItems: async function() {
        return await this.callFunction('get_items', {});
    },
    createItem: async function(itemData) {
        return await this.callFunction('create_item_simple', {
            p_name: itemData.name,
            p_description: itemData.description
        });
    }
};

// Module uses abstraction
const items = await dataFunctions.getItems();
```

**Benefits**:
- Single point of change for API URLs
- Consistent error handling
- Built-in caching
- Rate limiting
- Request/response logging

### 3. RBAC (Role-Based Access Control) Pattern

**Purpose**: Secure database functions based on user roles

**Pattern**:
- Permissions stored in `role_permissions` table
- Lambda proxy checks permissions before executing functions
- Frontend can check permissions for UI visibility

**Implementation**:
```sql
-- Database function with SECURITY DEFINER
CREATE FUNCTION get_items()
RETURNS TABLE (...)
SECURITY DEFINER
AS $$ ... $$;

-- Permission check in role_permissions
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
VALUES ('role-uuid', 'function', 'get_items', 'EXECUTE', true);
```

**Benefits**:
- Database-level security
- Fine-grained permissions
- Centralized permission management
- Audit trail capability

### 4. Function Naming Convention Pattern

**Purpose**: Consistent, discoverable database functions

**Pattern**:
- `get_[entity]s()` - List all records
- `get_[entity]_by_id(p_id)` - Get single record
- `create_[entity]_simple(p_*)` - Create new record
- `update_[entity]_simple(p_id, p_*)` - Update record
- `delete_[entity]_hard(p_id)` - Permanently delete

**Benefits**:
- Easy to find functions
- Predictable naming
- Clear intent
- Better documentation

### 5. Module Initialization Pattern

**Purpose**: Reliable module startup and dependency management

**Pattern**:
- Each module has `initialize[Module]Grid()` function
- Router calls initializer after loading scripts
- Initializer waits for dependencies before proceeding

**Implementation**:
```javascript
// Module JS
async function initializeItemsGrid() {
    // Wait for dependencies
    await waitForDataFunctions();
    
    // Initialize module
    setupEventListeners();
    await loadData();
}

// Router calls it
_appRouter.initializeModule('items-grid');
```

**Benefits**:
- Handles async dependencies
- Prevents timing issues
- Clear initialization flow
- Error handling at module level

### 6. Error Handling Pattern

**Purpose**: Consistent error handling across the application

**Pattern**:
- Try-catch blocks for async operations
- User-friendly error messages
- Console logging for debugging
- Error display using toast/alert

**Implementation**:
```javascript
async function loadData() {
    try {
        showLoading();
        const data = await dataFunctions.getItems();
        renderData(data);
        hideLoading();
    } catch (error) {
        console.error('Error:', error);
        showError('Failed to load data: ' + error.message);
        hideLoading();
    }
}
```

### 7. Cache Invalidation Pattern

**Purpose**: Keep UI in sync with data changes

**Pattern**:
- Cache API responses
- Invalidate cache after mutations
- Map mutations to cache keys

**Implementation**:
```javascript
// After mutation
dataFunctions.invalidateCache('create_item_simple');
// Reload data
await loadData();
```

### 8. Input Validation Pattern

**Purpose**: Prevent security vulnerabilities and data errors

**Pattern**:
- Validate on client side (UX)
- Sanitize before sending to server
- Validate on server side (security)

**Implementation**:
```javascript
// Client-side validation
if (!InputValidator.validateRequired(name)) {
    showError('Name is required');
    return;
}

// Sanitize before sending
const sanitized = InputValidator.sanitizeString(userInput);
await dataFunctions.createItem({ name: sanitized });
```

### 9. Loading State Pattern

**Purpose**: Provide feedback during async operations

**Pattern**:
- Show loading indicator before operation
- Hide after completion or error
- Consistent loading UI

**Implementation**:
```javascript
async function loadData() {
    showLoading(); // Show spinner/overlay
    try {
        const data = await dataFunctions.getItems();
        renderData(data);
    } finally {
        hideLoading(); // Always hide
    }
}
```

### 10. Form Handling Pattern

**Purpose**: Consistent form validation and submission

**Pattern**:
- HTML5 validation
- Bootstrap validation classes
- Form data extraction
- Clear form after submission

**Implementation**:
```javascript
function saveItem() {
    const form = document.getElementById('itemForm');
    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return;
    }
    
    const formData = {
        name: $('#name').val(),
        description: $('#description').val()
    };
    
    // Submit...
}
```

## Design Principles

### 1. Separation of Concerns
- **Presentation**: HTML templates, CSS styling
- **Logic**: JavaScript modules
- **Data**: data-functions.js abstraction
- **Routing**: appRouter.js

### 2. Single Responsibility
- Each module handles one feature
- Each function has one purpose
- Each file has a clear role

### 3. DRY (Don't Repeat Yourself)
- Common utilities in common.js
- Reusable data functions
- Shared UI components

### 4. Security First
- Input validation
- SQL injection prevention
- XSS prevention
- RBAC at database level

### 5. Performance Awareness
- Lazy loading modules
- Response caching
- Rate limiting
- Debounced inputs

### 6. Offline-First (PWA)
- Service worker caching
- Offline storage
- Sync when online
- Progressive enhancement

## Module Structure Pattern

Every module follows this structure:

```
modules/[module-name]/
├── html/
│   └── [module-name]_grid.html    # UI template
├── js/
│   └── [module-name]_grid.js      # Module logic
└── css/
    └── [module-name]_grid.css     # Module styles
```

**Module JS Pattern**:
```javascript
// Module state
let moduleData = [];
let editingItem = null;

// Initialize function (called by router)
async function initializeModuleGrid() {
    await waitForDataFunctions();
    setupEventListeners();
    await loadData();
}

// Event handlers
function setupEventListeners() { ... }

// Data operations
async function loadData() { ... }
async function saveItem() { ... }
async function deleteItem() { ... }

// UI rendering
function renderTable() { ... }

// Utility functions
function showLoading() { ... }
function showError() { ... }
```

## Anti-Patterns to Avoid

1. ❌ **Global State Pollution**: Don't use global variables
2. ❌ **Tight Coupling**: Don't hardcode dependencies
3. ❌ **No Error Handling**: Always handle errors
4. ❌ **Missing Validation**: Always validate input
5. ❌ **Hardcoded Values**: Use configuration
6. ❌ **No Loading States**: Always show loading
7. ❌ **No Cache Invalidation**: Invalidate after mutations
8. ❌ **Timing Issues**: Wait for dependencies
9. ❌ **Security Holes**: Validate and sanitize
10. ❌ **No Documentation**: Document functions and patterns

## Further Reading

- See `LESSONS_LEARNED.md` for common mistakes
- See `MODULE_GUIDE.md` for creating modules
- See `RBAC_GUIDE.md` for RBAC implementation
- See `DATABASE_GUIDE.md` for database patterns

