# Digitization Features - Troubleshooting Guide

## Features Implemented

1. **Kernel Production Job Card** - Digital form matching PDF structure
2. **Oil Production Mix Tracking** - Track raw material usage per mix
3. **Stock Take Module** - Physical stock counting with variance analysis
4. **Weekly Summary Report** - Database function for oil production summaries

## Common Issues and Fixes

### Issue 1: Modals Not Opening

**Symptoms:** Clicking buttons does nothing or shows error

**Fixes:**
1. Check browser console (F12) for JavaScript errors
2. Verify Bootstrap is loaded: `typeof bootstrap !== 'undefined'`
3. Check if jQuery is loaded: `typeof $ !== 'undefined'`
4. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
5. Clear browser cache

**Debug Commands (in browser console):**
```javascript
// Check if modal exists
document.getElementById('kernelJobCardModal')
document.getElementById('stockTakeModal')

// Check if functions are defined
typeof kernelProductionGrid
typeof stockManagementGrid

// Check if Bootstrap is loaded
typeof bootstrap
```

### Issue 2: Save Functions Not Working

**Symptoms:** Form saves but nothing happens, or error messages

**Fixes:**
1. Check browser console for errors
2. Verify database functions exist (already checked - they do)
3. Check network tab for API call failures
4. Verify authentication token is valid

**Debug Commands:**
```javascript
// Check if data functions are available
typeof dataFunctions
typeof dataFunctions.createKernelJobCard
typeof dataFunctions.createStockTake

// Test a simple call
dataFunctions.getContacts().then(console.log)
```

### Issue 3: Forms Not Loading Data

**Symptoms:** Dropdowns are empty, dates don't populate

**Fixes:**
1. Check if API calls are returning data (Network tab)
2. Verify suppliers/contacts exist in database
3. Check console for errors during data loading

### Issue 4: Calculations Not Updating

**Symptoms:** Totals don't calculate, variance doesn't show

**Fixes:**
1. Ensure input events are bound correctly
2. Check for JavaScript errors preventing event handlers
3. Verify form elements exist with correct IDs

## Quick Verification Checklist

- [ ] Open browser console (F12)
- [ ] Check for JavaScript errors (red text)
- [ ] Click "Kernel Production Job Card" button
- [ ] Click "Stock Take" button
- [ ] Verify modals open (if not, check console errors)
- [ ] Try filling out a form and saving
- [ ] Check Network tab for failed API calls

## Database Functions Status

✅ `create_kernel_job_card` - EXISTS
✅ `create_stock_take` - EXISTS  
✅ `get_oil_production_weekly_summary` - EXISTS

## File Locations

- **Kernel Job Card:** 
  - HTML: `modules/kernel-production/html/kernel_production_grid.html`
  - JS: `modules/kernel-production/js/kernel_production_grid.js`
  - Button: "Kernel Production Job Card" in Kernel Production module

- **Stock Take:**
  - HTML: `modules/stock-management/html/stock_management_grid.html`
  - JS: `modules/stock-management/js/stock_management_grid.js`
  - Button: "Stock Take" in Stock Management module

- **Oil Production Mix Tracking:**
  - HTML: `modules/oil-production/html/oil_production_grid.html`
  - JS: `modules/oil-production/js/oil_production_grid.js`
  - Section: "Mix Tracking" in Oil Production form

## Next Steps if Still Not Working

1. **Check Browser Console:** Most issues will show errors here
2. **Check Network Tab:** Verify API calls are being made
3. **Verify Initialization:** Ensure modules are being initialized
4. **Test in Incognito:** Rules out browser extension conflicts
5. **Check Server Logs:** If using Lambda, check CloudWatch logs

## Reporting Issues

When reporting issues, please include:
1. Browser console errors (F12 → Console tab)
2. Network tab showing failed requests
3. Steps to reproduce
4. What happens vs what should happen
