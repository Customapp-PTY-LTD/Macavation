# Module Creation Guide

This guide walks you through creating a new module from scratch using the template.

## Overview

A module consists of:
- **HTML file**: UI template with forms and tables
- **JavaScript file**: Module logic and event handlers
- **CSS file**: Module-specific styles
- **Route configuration**: Added to appRouteConfig.json
- **Router initializer**: Added to appRouter.js
- **Navigation link**: Added to index.html (optional)
- **Database functions**: Created in Supabase
- **Data functions**: Added to data-functions.js
- **RBAC permissions**: Configured in database

## Step-by-Step Guide

### Step 1: Choose Module Name

Choose a clear, descriptive name (e.g., `items`, `products`, `orders`).

**Naming conventions**:
- Use lowercase with hyphens: `my-module-name`
- Keep it short but descriptive
- Use plural for collections: `items`, `products`

### Step 2: Create Module Structure

```bash
mkdir -p modules/your-module-name/{html,js,css}
```

### Step 3: Copy Template Files

```bash
# Copy templates
cp templates/module/module_html_template.html modules/your-module-name/html/your-module-name_grid.html
cp templates/module/module_js_template.js modules/your-module-name/js/your-module-name_grid.js
cp templates/module/module_css_template.css modules/your-module-name/css/your-module-name_grid.css
```

### Step 4: Update Template Files

Replace placeholders in all three files:
- `[MODULE_NAME]` → `your-module-name` (e.g., `items`)
- `[MODULE_NAME_DISPLAY]` → `Your Module Name` (e.g., `Item`)
- `[MODULE_NAME_UPPER]` → `YOUR_MODULE_NAME` (e.g., `ITEM`)

**Quick find-replace**:
1. Open all three files
2. Find: `[MODULE_NAME]` → Replace: `items` (your module name)
3. Find: `[MODULE_NAME_DISPLAY]` → Replace: `Item` (display name)
4. Find: `[MODULE_NAME_UPPER]` → Replace: `ITEM` (uppercase)

### Step 5: Create Database Functions

Create CRUD functions in Supabase SQL Editor:

```sql
-- 1. Get all items
CREATE OR REPLACE FUNCTION get_items()
RETURNS TABLE (
    id uuid,
    name text,
    description text,
    is_active boolean,
    created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT i.id, i.name, i.description, i.is_active, i.created_at
    FROM public.items i
    WHERE i.is_active = true
    ORDER BY i.created_at DESC;
END;
$$;

-- 2. Get item by ID
CREATE OR REPLACE FUNCTION get_item_by_id(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item json;
BEGIN
    SELECT json_build_object(
        'id', i.id,
        'name', i.name,
        'description', i.description,
        'is_active', i.is_active,
        'created_at', i.created_at
    ) INTO v_item
    FROM public.items i
    WHERE i.id = p_id;
    
    RETURN v_item;
END;
$$;

-- 3. Create item
CREATE OR REPLACE FUNCTION create_item_simple(
    p_name text,
    p_description text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_id uuid;
BEGIN
    INSERT INTO public.items (name, description)
    VALUES (p_name, p_description)
    RETURNING id INTO v_id;
    
    RETURN json_build_object(
        'success', true,
        'id', v_id,
        'message', 'Item created successfully'
    );
END;
$$;

-- 4. Update item
CREATE OR REPLACE FUNCTION update_item_simple(
    p_id uuid,
    p_name text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_is_active boolean DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.items
    SET 
        name = COALESCE(p_name, name),
        description = COALESCE(p_description, description),
        is_active = COALESCE(p_is_active, is_active),
        updated_at = now()
    WHERE id = p_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Item updated successfully'
    );
END;
$$;

-- 5. Delete item
CREATE OR REPLACE FUNCTION delete_item_hard(p_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    DELETE FROM public.items WHERE id = p_id;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Item deleted successfully'
    );
END;
$$;
```

### Step 6: Add RBAC Permissions

```sql
-- Add permissions for each role
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_items', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user')
ON CONFLICT DO NOTHING;

-- Repeat for each function
INSERT INTO role_permissions (role_id, object_type, object_name, operation, allowed)
SELECT r.id, 'function', 'get_item_by_id', 'EXECUTE', true
FROM roles r 
WHERE r.role_name IN ('super_user', 'admin', 'user')
ON CONFLICT DO NOTHING;

-- ... (repeat for create, update, delete functions)
```

### Step 7: Add Data Functions

Edit `js/data-functions.js`, add to `_dataFunctions` object:

```javascript
// Get all items
getItems: async function (token = null) {
    return await this.callFunction('get_items', {}, token);
},

// Get item by ID
getItemById: async function (itemId, token = null) {
    return await this.callFunction('get_item_by_id', { p_id: itemId }, token);
},

// Create item
createItem: async function (itemData, token = null) {
    const params = {
        p_name: itemData.name,
        p_description: itemData.description || null
    };
    return await this.callFunction('create_item_simple', params, token);
},

// Update item
updateItem: async function (itemId, itemData, token = null) {
    const params = {
        p_id: itemId,
        p_name: itemData.name || null,
        p_description: itemData.description || null,
        p_is_active: itemData.is_active !== undefined ? itemData.is_active : null
    };
    return await this.callFunction('update_item_simple', params, token);
},

// Delete item
deleteItem: async function (itemId, token = null) {
    return await this.callFunction('delete_item_hard', { p_id: itemId }, token);
},
```

### Step 8: Add Cache Invalidation

In `js/data-functions.js`, update `invalidateCache` method:

```javascript
invalidateCache: function (functionName) {
    const cacheInvalidationMap = {
        // ... existing mappings ...
        'create_item_simple': ['get_items'],
        'update_item_simple': ['get_items'],
        'delete_item_hard': ['get_items'],
    };
    // ... rest of the method ...
}
```

### Step 9: Add Route Configuration

Edit `js/appRouteConfig.json`:

```json
{
  "appRoutes": {
    "items-grid": {
      "description": "Items Management",
      "path": "items",
      "html": "html/items_grid.html",
      "js": [
        "js/items_grid.js"
      ],
      "css": [
        "css/items_grid.css"
      ]
    }
  }
}
```

### Step 10: Add Router Initializer

Edit `js/appRouter.js`, add to `moduleInitializers`:

```javascript
const moduleInitializers = {
    // ... existing initializers ...
    'items-grid': () => {
        if (typeof initializeItemsGrid === 'function') {
            initializeItemsGrid();
        }
    }
};
```

### Step 11: Add Navigation Link (Optional)

Edit `index.html`, add to navigation:

```html
<li class="nav-item">
    <a class="nav-link" href="#" route="items-grid">
        <i class="fas fa-box me-2"></i>Items
    </a>
</li>
```

### Step 12: Test Module

1. **Start development server**
2. **Navigate to module** via route or navigation
3. **Test CRUD operations**:
   - Create new item
   - Edit existing item
   - Delete item
   - Filter/search
4. **Check console** for errors
5. **Test with different user roles** (if RBAC configured)

## Module Template Customization

### Customizing HTML Template

- **Add more form fields**: Update form in modal
- **Custom table columns**: Update table header and rows
- **Additional filters**: Add filter controls
- **Custom actions**: Add action buttons

### Customizing JavaScript Template

- **Additional data loading**: Add more data sources
- **Complex validation**: Add custom validation logic
- **Business logic**: Add module-specific business rules
- **Integrations**: Add third-party integrations

### Customizing CSS Template

- **Theme colors**: Update color scheme
- **Layout**: Adjust spacing and layout
- **Responsive design**: Add mobile styles
- **Animations**: Add transitions and animations

## Common Customizations

### Adding Date Range Filter

```javascript
// In HTML
<div class="col-md-3">
    <label for="filterDateFrom" class="form-label">From Date</label>
    <input type="date" class="form-control" id="filterDateFrom">
</div>
<div class="col-md-3">
    <label for="filterDateTo" class="form-label">To Date</label>
    <input type="date" class="form-control" id="filterDateTo">
</div>

// In JS
function filterData() {
    const dateFrom = $('#filterDateFrom').val();
    const dateTo = $('#filterDateTo').val();
    // Filter logic...
}
```

### Adding Pagination

```javascript
let currentPage = 1;
const itemsPerPage = 10;

function renderTable() {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const itemsToShow = filteredData.slice(startIndex, endIndex);
    // Render itemsToShow...
}
```

### Adding Export Functionality

```javascript
function exportToCSV() {
    const csv = convertToCSV(filteredData);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'items.csv';
    a.click();
}
```

## Checklist

Before considering a module complete:

- [ ] Module folder structure created
- [ ] Template files copied and updated
- [ ] Database table created
- [ ] Database functions created (CRUD)
- [ ] RBAC permissions configured
- [ ] Data functions added to data-functions.js
- [ ] Cache invalidation configured
- [ ] Route added to appRouteConfig.json
- [ ] Initializer added to appRouter.js
- [ ] Navigation link added (if needed)
- [ ] Module tested (create, read, update, delete)
- [ ] Error handling implemented
- [ ] Loading states implemented
- [ ] Input validation added
- [ ] Mobile responsive
- [ ] Tested with different user roles

## Troubleshooting

**Module not loading?**
- Check route name in appRouteConfig.json matches route attribute
- Verify initializer function name matches router initializer
- Check console for script loading errors

**Data not loading?**
- Ensure dataFunctions is available (wait for it)
- Check function names in data-functions.js
- Verify database function names match
- Check RBAC permissions

**Form not submitting?**
- Check form validation
- Verify function names in module JS
- Check parameter names match database function parameters
- Look for errors in console

## Next Steps

- Review `PATTERNS.md` for design patterns
- Check `LESSONS_LEARNED.md` for common pitfalls
- See `RBAC_GUIDE.md` for security configuration
- Review `DATABASE_GUIDE.md` for database patterns

