# Role-Based Access Update

## Overview

The role-based menu access system has been temporarily disabled to allow all authenticated users access to all features and menus.

## Changes Made

### 1. `js/role-menu-config.js`
- **`hasAccess()` function**: Now returns `true` for all authenticated users
- **`getAccessibleMenus()` function**: Now returns all menus for all authenticated users
- Original role-based logic is preserved in comments for future use

### 2. `js/menu-filter.js`
- **`filterMenus()` function**: Now calls `showAllMenus()` instead of filtering
- All menu items are visible to all users
- Original filtering logic is preserved in comments

### 3. `js/appRouter.js`
- Role-based route access check is disabled
- All authenticated users can access all routes
- Original access check logic is preserved in comments

## Current Behavior

**All authenticated users now have:**
- ✅ Access to all menu items in the sidebar
- ✅ Access to all routes/modules
- ✅ Visibility of admin sections
- ✅ No menu filtering based on role

## Re-enabling Role-Based Access

To restore role-based access restrictions in the future:

### Step 1: Update `js/role-menu-config.js`

Uncomment the original logic in `hasAccess()` and `getAccessibleMenus()` functions:

```javascript
hasAccess: function (route) {
    const roleName = this.getUserRole();
    if (!roleName) return false;

    const roleConfig = this.menuConfig[roleName];
    if (!roleConfig) return false;

    if (roleConfig.access === 'all') {
        return true;
    }

    if (roleConfig.access === 'specific') {
        return roleConfig.menus.includes(route);
    }

    return false;
}
```

### Step 2: Update `js/menu-filter.js`

Uncomment the filtering logic in `filterMenus()` function:

```javascript
// Hide all menu items first
this.hideAllMenus();

// Show accessible menus
accessibleMenus.forEach(route => {
    this.showMenu(route);
});

// Handle parent collapse menus
this.updateParentMenus();

// If PWA user, hide admin-only sections
if (isPWAUser) {
    this.hideAdminSections();
}
```

### Step 3: Update `js/appRouter.js`

Uncomment the route access check:

```javascript
if (typeof roleMenuConfig !== 'undefined') {
    const hasAccess = roleMenuConfig.hasAccess(routeName);
    if (!hasAccess) {
        // Show access denied message and redirect
    }
}
```

## Notes

- **PWA roles are still in the database** - They're just not being used for menu filtering
- **Role assignments remain intact** - Users still have their assigned roles
- **Backend permissions still apply** - Lambda proxy still checks role permissions for database functions
- **Easy to toggle** - All original code is preserved in comments for quick restoration

## Testing

To verify all users have access:
1. Log in as any user (regardless of role)
2. Verify all sidebar menu items are visible
3. Try navigating to different modules
4. Verify no access denied messages appear

## Security Considerations

⚠️ **Important**: While menu filtering is disabled, backend permissions are still enforced:
- Lambda proxy checks role permissions before executing database functions
- Users without proper permissions will still get 403 errors for restricted operations
- This change only affects **UI visibility**, not **actual data access**

**Ensuring all users can use the app:** To avoid 403 errors for any authenticated user, ensure **all roles** have EXECUTE on data functions. Apply the migration **`20260218000001_grant_all_data_functions_to_all_roles.sql`** (see `markdown files/RBAC_TROUBLESHOOTING.md`). That migration grants EXECUTE on all app data functions to every role in the `roles` table, so all users have access to data functions regardless of role.

To fully restrict access, you would also need to:
1. Review backend permissions in the Lambda proxy
2. Check role_permissions table settings
3. Re-enable frontend filtering (as described above)

