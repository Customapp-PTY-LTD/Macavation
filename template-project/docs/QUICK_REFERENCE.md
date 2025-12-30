# Quick Reference Guide

Quick lookup for common tasks and patterns.

## Module Creation Checklist

1. ✅ Create folder: `modules/your-module-name/{html,js,css}`
2. ✅ Copy templates and replace `[MODULE_NAME]` placeholders
3. ✅ Create database table (see `templates/database/example_table.sql`)
4. ✅ Create database functions (see `templates/database/example_functions.sql`)
5. ✅ Add RBAC permissions (see `templates/database/rbac_setup.sql`)
6. ✅ Add data functions to `js/data-functions.js`
7. ✅ Add route to `js/appRouteConfig.json`
8. ✅ Add initializer to `js/appRouter.js`
9. ✅ Add navigation link to `index.html` (optional)

## Common Code Snippets

### Module Initialization

```javascript
async function initializeMyModuleGrid() {
    // Wait for dependencies
    if (typeof waitForDataFunctions === 'function') {
        await waitForDataFunctions(50, 100);
    }
    
    setupEventListeners();
    await loadData();
}
```

### Load Data

```javascript
async function loadData() {
    try {
        showLoading();
        const result = await dataFunctions.getItems();
        const items = Array.isArray(result) ? result : (result.data || []);
        renderTable(items);
        hideLoading();
    } catch (error) {
        console.error('Error:', error);
        showError('Failed to load data');
        hideLoading();
    }
}
```

### Save Data

```javascript
async function saveItem() {
    const formData = {
        name: $('#name').val(),
        description: $('#description').val()
    };
    
    try {
        showLoading();
        const result = await dataFunctions.createItem(formData);
        if (result.success !== false) {
            showSuccess('Saved successfully');
            await loadData(); // Reload
        }
        hideLoading();
    } catch (error) {
        showError('Failed to save');
        hideLoading();
    }
}
```

### Delete Data

```javascript
async function deleteItem(id) {
    try {
        showLoading();
        await dataFunctions.deleteItem(id);
        dataFunctions.invalidateCache('delete_item_hard');
        showSuccess('Deleted successfully');
        await loadData();
        hideLoading();
    } catch (error) {
        showError('Failed to delete');
        hideLoading();
    }
}
```

## Function Naming Patterns

| Pattern | Example | Purpose |
|---------|---------|---------|
| `get_[entity]s()` | `get_items()` | List all |
| `get_[entity]_by_id(p_id)` | `get_item_by_id(p_id)` | Get one |
| `create_[entity]_simple(p_*)` | `create_item_simple(p_name)` | Create |
| `update_[entity]_simple(p_id, p_*)` | `update_item_simple(p_id, p_name)` | Update |
| `delete_[entity]_hard(p_id)` | `delete_item_hard(p_id)` | Hard delete |
| `deactivate_[entity](p_id)` | `deactivate_item(p_id)` | Soft delete |

## Parameter Naming

- Function parameters: `p_name`, `p_id`, `p_user_id`
- Local variables: `v_id`, `v_count`, `v_result`
- Database columns: `name`, `id`, `user_id`

## Response Formats

### Success Response

```json
{
  "success": true,
  "id": "uuid-here",
  "message": "Operation successful"
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message here"
}
```

## Route Configuration

```json
{
  "items-grid": {
    "description": "Items Management",
    "path": "items",
    "html": "html/items_grid.html",
    "js": ["js/items_grid.js"],
    "css": ["css/items_grid.css"]
  }
}
```

## Router Initializer

```javascript
'items-grid': () => {
    if (typeof initializeItemsGrid === 'function') {
        initializeItemsGrid();
    }
}
```

## Data Functions Template

```javascript
getItems: async function (token = null) {
    return await this.callFunction('get_items', {}, token);
},
getItemById: async function (itemId, token = null) {
    return await this.callFunction('get_item_by_id', { p_id: itemId }, token);
},
createItem: async function (itemData, token = null) {
    return await this.callFunction('create_item_simple', {
        p_name: itemData.name,
        p_description: itemData.description || null
    }, token);
},
```

## Cache Invalidation

```javascript
invalidateCache: function (functionName) {
    const cacheInvalidationMap = {
        'create_item_simple': ['get_items'],
        'update_item_simple': ['get_items'],
        'delete_item_hard': ['get_items']
    };
    // ... implementation
}
```

## RBAC Permission Pattern

```sql
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_items', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user')
ON CONFLICT DO NOTHING;
```

## Common Errors and Solutions

| Error | Solution |
|-------|----------|
| `dataFunctions is not defined` | Wait for dataFunctions in initialization |
| `403 Forbidden` | Check RBAC permissions in database |
| `Module not loading` | Check route config and initializer |
| `Form not submitting` | Check function names and parameters |
| `Cache not updating` | Call invalidateCache after mutations |

## File Locations

| File Type | Location |
|-----------|----------|
| Module HTML | `modules/[module]/html/[module]_grid.html` |
| Module JS | `modules/[module]/js/[module]_grid.js` |
| Module CSS | `modules/[module]/css/[module]_grid.css` |
| Route Config | `js/appRouteConfig.json` |
| Router | `js/appRouter.js` |
| Data Functions | `js/data-functions.js` |
| Database Functions | Supabase SQL Editor |

## Common Tasks

### Add New Field to Form

1. Add to HTML form
2. Add to populateForm()
3. Add to formData extraction
4. Update database function parameters
5. Update data function call

### Add Filter

1. Add filter control to HTML
2. Add event listener in setupEventListeners()
3. Update filter function
4. Update render function to use filtered data

### Add Validation

1. Add HTML5 validation attributes
2. Add custom validation in save function
3. Update error messages
4. Test edge cases

## Testing Checklist

- [ ] Create new record
- [ ] Edit existing record
- [ ] Delete record
- [ ] Filter/search
- [ ] Pagination (if applicable)
- [ ] Error handling
- [ ] Loading states
- [ ] Validation
- [ ] Different user roles
- [ ] Mobile responsive

## Documentation Files

- `SETUP.md` - Initial setup instructions
- `PATTERNS.md` - Design patterns
- `LESSONS_LEARNED.md` - Common mistakes
- `MODULE_GUIDE.md` - Module creation guide
- `RBAC_GUIDE.md` - Security setup
- `DATABASE_GUIDE.md` - Database patterns
- `QUICK_REFERENCE.md` - This file

