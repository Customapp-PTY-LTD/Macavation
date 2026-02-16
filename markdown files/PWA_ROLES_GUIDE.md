# PWA Roles and Menu Access Guide

## Overview

PWA-specific roles have been created to provide departmental access control. When a PWA user logs in, they will only see menu options appropriate to their role.

## Created PWA Roles

The following roles have been created in the database:

1. **PWA Grower Intake**
   - Access: Dashboard, Grower Intake, My Day
   - Purpose: For users who record and view grower intake data

2. **PWA Production**
   - Access: Dashboard, Grower Intake, Kernel Production, Oil Production, My Day
   - Purpose: For users who work in production operations

3. **PWA Quality Assurance**
   - Access: Dashboard, Quality Assurance, Stock Management, Grower Intake (view), My Day
   - Purpose: For quality assurance staff who need to view intake data for quality checks

4. **PWA Stock Management**
   - Access: Dashboard, Stock Management, Quality Assurance (view), My Day
   - Purpose: For warehouse and stock management staff

5. **PWA Sales**
   - Access: Dashboard, Sales Forecasting, CRM, Executive Dashboard, My Day
   - Purpose: For sales team members

6. **PWA Finance**
   - Access: Dashboard, Financial Management, Executive Dashboard, My Day
   - Purpose: For finance department staff

7. **PWA Document Management**
   - Access: Dashboard, Document Management, My Day
   - Purpose: For document management staff

8. **PWA Field Operations**
   - Access: Dashboard, Grower Intake, Kernel Production, Quality Assurance, My Day
   - Purpose: For field operations staff who need access to multiple production modules

## Role Configuration

Roles are configured in `js/role-menu-config.js`. Each role has:
- `access`: Either `'all'` (for admin/super_user) or `'specific'` (for PWA roles)
- `menus`: Array of route names the role can access

## Menu Filtering

The menu filtering system (`js/menu-filter.js`) automatically:
1. Hides all menu items on page load
2. Shows only menus accessible to the current user's role
3. Hides parent collapse menus if no children are visible
4. Hides admin-only sections for PWA users

## Assigning Roles to Users

### Via User Management Interface

1. Navigate to **User Management → Users**
2. Find the user you want to assign a role to
3. Click edit on the user
4. Select the appropriate PWA role from the role dropdown
5. Save the changes

### Via Database (Direct)

```sql
-- Update user's role
UPDATE public.users 
SET role_id = (
    SELECT id FROM public.roles 
    WHERE role_name = 'PWA Grower Intake'
)
WHERE email = 'user@example.com';
```

## Menu Access Matrix

| Role | Dashboard | My Day | Grower Intake | Kernel Production | Oil Production | Quality Assurance | Stock Management | Sales Forecasting | Financial Management | CRM | Document Management | Executive Dashboard | User Management | Admin |
|------|-----------|--------|---------------|-------------------|---------------|-------------------|------------------|-------------------|---------------------|-----|---------------------|---------------------|-----------------|-------|
| **PWA Grower Intake** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **PWA Production** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **PWA Quality Assurance** | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **PWA Stock Management** | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **PWA Sales** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **PWA Finance** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ |
| **PWA Document Management** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| **PWA Field Operations** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **super_user** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Adding New Roles

To add a new PWA role:

1. **Create the role in the database:**
```sql
INSERT INTO public.roles (role_name, description, is_active) 
VALUES (
    'PWA New Role',
    'Description of the new role',
    true
);
```

2. **Add role configuration in `js/role-menu-config.js`:**
```javascript
'PWA New Role': {
    access: 'specific',
    menus: [
        'dashboard',
        'my-day',
        'route-name-here'
    ]
}
```

3. **Test the role assignment:**
   - Assign the role to a test user
   - Log in as that user
   - Verify only appropriate menus are visible

## Customizing Menu Access

### Adding a Menu to a Role

Edit `js/role-menu-config.js` and add the route to the role's `menus` array:

```javascript
'PWA Grower Intake': {
    access: 'specific',
    menus: [
        'dashboard',
        'grower-intake-grid',
        'my-day',
        'new-route-here'  // Add new route
    ]
}
```

### Removing a Menu from a Role

Remove the route from the role's `menus` array in `js/role-menu-config.js`.

### Creating a New Menu Category

1. Add the menu item to the sidebar in `index.html`
2. Add the route to `menuStructure` in `js/role-menu-config.js`
3. Assign access to appropriate roles

## Testing Role-Based Access

### Test Steps

1. **Create a test user:**
   - Go to User Management → Users
   - Create a new user
   - Assign a PWA role (e.g., "PWA Grower Intake")

2. **Log in as the test user:**
   - Sign out of admin account
   - Sign in with test user credentials

3. **Verify menu visibility:**
   - Check that only appropriate menus are visible
   - Verify admin sections are hidden
   - Test navigation to each visible menu

4. **Test access control:**
   - Try to access a route directly via URL (e.g., `?route=admin-grid`)
   - Verify access is denied and user is redirected to dashboard

## Troubleshooting

### Menus Not Filtering

1. **Check user role:**
   ```javascript
   console.log(roleMenuConfig.getUserRole());
   ```

2. **Check accessible menus:**
   ```javascript
   console.log(roleMenuConfig.getAccessibleMenus());
   ```

3. **Verify menu filter initialization:**
   - Check browser console for errors
   - Ensure `menuFilter.init()` is called after user info is loaded

### User Can See All Menus

1. **Verify role assignment:**
   - Check user's role in database
   - Verify role_name in localStorage user_info

2. **Check role configuration:**
   - Verify role exists in `role-menu-config.js`
   - Check role has `access: 'specific'` (not `'all'`)

### Menu Filter Not Working After Login

1. **Refresh menu filter:**
   ```javascript
   menuFilter.refresh();
   ```

2. **Check timing:**
   - Menu filter should initialize after user info is loaded
   - May need to add delay if user info loads asynchronously

## Security Notes

- **Frontend filtering is for UX only** - Always verify permissions on the backend
- The Lambda proxy checks role permissions before executing database functions
- Direct URL access attempts are blocked by the router
- Admin sections are hidden but backend still enforces permissions

## Best Practices

1. **Principle of Least Privilege**: Give users only the access they need
2. **Regular Audits**: Periodically review role assignments
3. **Role Naming**: Use clear, descriptive role names
4. **Documentation**: Document any custom role configurations
5. **Testing**: Always test role assignments before deploying

## Support

For issues or questions:
1. Check browser console for errors
2. Verify role exists in database
3. Check role configuration in `role-menu-config.js`
4. Test with different roles to isolate the issue

