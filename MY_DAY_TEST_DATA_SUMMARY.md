# My Day Test Data Summary

## Roles with Test Data

Test data has been created for the following **4 roles**:

### 1. **admin** (25 total entries)
- ✅ **5 Workflow Tasks** - Review quality tests, approve batches, check stock, review transactions, update CRM
- ✅ **5 Due Items** - Monthly reports, stock reviews, quality audits, supplier contracts, capacity analysis
- ✅ **5 Watching Items** - Stock alerts, production efficiency, quality trends, grower intake volume, transaction volume
- ✅ **10 Recent Activity** - Various updates, creates, approvals, and completions

### 2. **PWA Production** (18 total entries)
- ✅ **5 Workflow Tasks** - Start batches, monitor drying, record cracking results, prepare oil production, complete documentation
- ✅ **5 Due Items** - Complete batches, equipment maintenance, update logs, oil extraction setup, safety inspections
- ✅ **3 Watching Items** - Batch completion time, equipment downtime, oil yield rate
- ✅ **5 Recent Activity** - Batch starts, step completions, results recording

### 3. **PWA Quality Assurance** (18 total entries)
- ✅ **5 Workflow Tasks** - Perform moisture tests, check oil quality, review results, update certificates, inspect samples
- ✅ **5 Due Items** - Complete test reports, calibrate equipment, review procedures, food safety checklist, update standards
- ✅ **3 Watching Items** - Test result accuracy, moisture content variance, failed test rate
- ✅ **5 Recent Activity** - Test performances, validations, certificate issuances

### 4. **PWA Grower Intake** (10 total entries)
- ✅ **5 Workflow Tasks** - Receive deliveries, weigh NIS, test moisture, update records, prepare samples
- ✅ **0 Due Items** - None created for this role
- ✅ **0 Watching Items** - None created for this role
- ✅ **5 Recent Activity** - Delivery receipts, sample weighing, moisture tests, record updates

## Current User Status

**⚠️ Important:** Currently, **NO users have test data** because:

- All existing users in the system have the **`super_user`** role
- Test data was created for: `admin`, `PWA Production`, `PWA Quality Assurance`, and `PWA Grower Intake`
- The PWA roles (`PWA Production`, `PWA Quality Assurance`, `PWA Grower Intake`) do not exist in the `roles` table yet

## To View Test Data

To see the My Day test data, you need to:

1. **Option 1: Assign a user to the `admin` role**
   - Update a user's `role_id` to `9c69485d-0116-4cf6-b7e6-2ff6c025478e` (admin role ID)
   - That user will see 25 My Day entries

2. **Option 2: Create PWA roles and assign users**
   - Create roles in the `roles` table:
     - `PWA Production`
     - `PWA Quality Assurance`
     - `PWA Grower Intake`
   - Assign users to these roles
   - Those users will see their respective My Day entries

3. **Option 3: Create test data for `super_user` role**
   - Run additional SQL to create test data for the `super_user` role
   - All existing users will then see My Day entries

## Test Data Details

### Workflow Tasks
All tasks are scheduled for **today** (`CURRENT_DATE`) with various times:
- Morning tasks: 07:30 - 09:00
- Mid-morning: 10:00 - 11:00
- Afternoon: 13:00 - 15:30
- Late afternoon: 16:00

### Due Items
Due dates range from **today** to **7 days from now**:
- Some items are due today (urgent)
- Others are due in 1-7 days (upcoming)

### Watching Items
All watching items are **active** and show:
- Trend indicators (positive, negative, or neutral)
- Trend periods (week, month, 2 weeks)
- Action URLs to navigate to related modules

### Recent Activity
Activities span the **last 9 hours**, with timestamps from:
- 10 minutes ago (most recent)
- Up to 9 hours ago (older activities)

## Summary Table

| Role | Workflow Tasks | Due Items | Watching Items | Recent Activity | **Total** |
|------|---------------|-----------|----------------|-----------------|-----------|
| **admin** | 5 | 5 | 5 | 10 | **25** |
| **PWA Production** | 5 | 5 | 3 | 5 | **18** |
| **PWA Quality Assurance** | 5 | 5 | 3 | 5 | **18** |
| **PWA Grower Intake** | 5 | 0 | 0 | 5 | **10** |
| **TOTAL** | **20** | **15** | **11** | **25** | **71** |

## Next Steps

1. **Create PWA roles** in the `roles` table if you want to test with PWA users
2. **Assign a user to admin role** to test admin My Day view
3. **Create test data for super_user** if you want all current users to see test data
4. **Create additional test users** with different roles for comprehensive testing

