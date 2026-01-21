# User Management - My Day Test Data Assignment Guide

## Overview

The User Management module is now fully functional and supports assigning users to roles that have My Day test data. This guide explains how to use it.

## Available Roles with My Day Test Data

The following roles have been created and have test data available:

| Role | My Day Entries | Description |
|------|---------------|-------------|
| **admin** | 25 entries | Administrator with elevated privileges |
| **PWA Production** | 18 entries | Kernel and oil production workflows |
| **PWA Quality Assurance** | 18 entries | Quality testing and food safety |
| **PWA Grower Intake** | 10 entries | Receiving and processing grower deliveries |

## How to Assign Users to Roles

### Method 1: Edit Existing User

1. Navigate to **User Management → Users** in the sidebar
2. Find the user you want to assign a role to
3. Click on the user's name (it's a clickable link)
4. The user edit modal will open
5. Select the desired role from the **Role** dropdown:
   - `admin` - For admin users (25 My Day entries)
   - `PWA Production` - For production staff (18 My Day entries)
   - `PWA Quality Assurance` - For QA staff (18 My Day entries)
   - `PWA Grower Intake` - For intake staff (10 My Day entries)
6. **Password is optional** when editing - leave blank to keep current password
7. Click **Save User**
8. The user will now see My Day entries when they log in and navigate to "My Day"

### Method 2: Create New User

1. Navigate to **User Management → Users**
2. Click **Add User** button
3. Fill in the required fields:
   - **Username** (required)
   - **Email** (required)
   - **First Name** (optional)
   - **Last Name** (optional)
   - **Role** (required) - Select from dropdown
   - **Password** (required for new users)
   - **Confirm Password** (required for new users)
   - **Active User** (checkbox, checked by default)
4. Click **Save User**
5. The new user will see My Day entries based on their assigned role

## Features

### ✅ Role Assignment
- All roles are loaded from the database
- Role dropdown includes all available roles (admin, super_user, PWA roles)
- Role is required when creating or updating users
- Role changes take effect immediately

### ✅ Password Management
- **New Users**: Password is required
- **Editing Users**: Password is optional (leave blank to keep current password)
- Password confirmation validation
- Passwords must match when provided

### ✅ User Filtering
- Filter users by role using the filter dropdown
- Search users by name, email, username
- View all users or filter by specific role

### ✅ User Display
- Users table shows:
  - User avatar (initials)
  - User name (clickable to edit)
  - Email address
  - Role name
  - Actions (delete button)

## Testing My Day with Assigned Roles

### Step 1: Assign a User to a Role with Test Data

1. Edit a user and assign them to one of these roles:
   - `admin` (25 entries)
   - `PWA Production` (18 entries)
   - `PWA Quality Assurance` (18 entries)
   - `PWA Grower Intake` (10 entries)

### Step 2: Log in as That User

1. Log out of the current session
2. Log in with the user's credentials
3. Navigate to **My Day** from the sidebar

### Step 3: View My Day Entries

The user will see:
- **Today's Workflow** - Tasks scheduled for today
- **Due This Period** - Items due soon
- **Watching** - Proactive intelligence items
- **Recent Activity** - Recent system activities

### Step 4: Test Management Actions

Users can:
- ✅ Mark tasks as complete (checkbox)
- ⏰ Snooze tasks/items (clock icon)
- ❌ Dismiss tasks/items (X icon)
- 👁️ View related modules (action buttons)

## Current User Status

**All existing users** currently have the `super_user` role, which does **not** have My Day test data.

To see My Day test data, you need to:
1. Assign a user to one of the roles listed above, OR
2. Create test data for the `super_user` role

## Role IDs Reference

For reference, here are the role IDs:

- `admin`: `9c69485d-0116-4cf6-b7e6-2ff6c025478e`
- `PWA Production`: `b015384b-7a2f-400f-9220-bf75df4fe505`
- `PWA Quality Assurance`: `d7e0fb2d-b360-4f63-b882-3fa86618c8b9`
- `PWA Grower Intake`: `7eb965cd-7af2-4725-b12a-e7798da41180`

## Troubleshooting

### Issue: Role dropdown is empty
**Solution**: The roles are loaded from the database. If the dropdown is empty, check:
- Database connection is working
- `get_roles` function has proper RBAC permissions
- Roles exist in the database

### Issue: Can't save user with role
**Solution**: Ensure:
- Role is selected from dropdown (required field)
- User has permission to create/update users
- Database function `create_user_simple` or `update_user_simple` has proper RBAC permissions

### Issue: User doesn't see My Day entries after role assignment
**Solution**: 
- User must log out and log back in for role changes to take effect
- Verify the role has test data (check `MY_DAY_TEST_DATA_SUMMARY.md`)
- Check that the user's role_name is correctly set in localStorage

### Issue: Password validation errors
**Solution**:
- For new users: Password is required and must match confirmation
- For editing users: Password is optional - leave blank to keep current password
- If changing password: Both password fields must match

## Best Practices

1. **Test with Different Roles**: Assign different users to different roles to test all My Day scenarios
2. **Use Realistic Data**: Create test users with realistic names and emails for better testing
3. **Document Role Assignments**: Keep track of which users are assigned to which roles for testing
4. **Test Role Changes**: Verify that role changes take effect immediately after saving
5. **Test My Day Management**: After assigning roles, test all My Day management actions (complete, snooze, dismiss)

