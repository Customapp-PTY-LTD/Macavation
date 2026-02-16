# PWA Offline Capabilities Guide

This guide explains how to use the Progressive Web App (PWA) offline capabilities in the Macavation system.

## Overview

The PWA implementation provides:
- **Offline Data Capture**: Save data locally when offline
- **Automatic Sync**: Sync queued requests when back online
- **Data Validation**: Ensure accuracy of captured data
- **Form Drafts**: Auto-save form data to prevent data loss
- **Offline Indicators**: Visual feedback for connection status

## Architecture

### Core Components

1. **Service Worker** (`sw.js`)
   - Handles caching and offline requests
   - Manages background sync
   - Serves cached content when offline

2. **Offline Storage** (`js/offline-storage.js`)
   - IndexedDB storage for offline data
   - Queue management for pending requests
   - Form draft storage

3. **Offline Sync** (`js/offline-sync.js`)
   - Automatic sync when back online
   - Retry logic for failed requests
   - Status updates

4. **Offline Detector** (`js/offline-detector.js`)
   - Monitors online/offline status
   - Updates UI indicators
   - Connectivity checks

5. **Data Validation** (`js/data-validation.js`)
   - Field-level validation
   - Module-specific validation rules
   - Real-time validation feedback

6. **Offline Helpers** (`js/offline-helpers.js`)
   - Utility functions for modules
   - Form draft management
   - Simplified offline integration

## Usage in Modules

### Basic Integration

```javascript
// In your module's save function
async function saveGrowerIntake() {
    const formData = {
        grower_name: $('#growerName').val(),
        delivery_date: $('#deliveryDate').val(),
        wet_nut_in_shell_kg: parseFloat($('#wetNutWeight').val()),
        moisture_content_percentage: parseFloat($('#moistureContent').val())
    };

    // Validate data
    if (typeof dataValidation !== 'undefined') {
        const validation = dataValidation.validateGrowerIntake(formData);
        if (!validation.valid) {
            dataValidation.showValidationErrors(validation.errors);
            return;
        }
    }

    // Save with offline support
    const result = await dataFunctions.createSampleSubmission(formData);
    
    // Handle offline queuing
    if (result && result.queued) {
        // Data was queued for sync
        Swal.fire({
            icon: 'success',
            title: 'Saved Offline',
            text: 'Your data will be synced when you\'re back online.'
        });
    }
}
```

### Using Offline Helpers

```javascript
// Auto-save form drafts
const autoSave = offlineHelpers.autoSaveFormDraft('grower-intake', 'sample-form', formData);

// Attach to form inputs
$('#sampleForm input, #sampleForm select, #sampleForm textarea').on('input change', function() {
    const formData = getFormData();
    autoSave();
});

// Load draft when form opens
async function showAddSampleModal() {
    const draft = await offlineHelpers.loadFormDraft('grower-intake', 'sample-form', $('#sampleForm')[0]);
    if (draft) {
        // Draft loaded and form populated
    }
}

// Clear draft after successful save
await offlineHelpers.clearFormDraft('grower-intake', 'sample-form');
```

### Validation Rules

```javascript
// Define validation rules
const validationRules = {
    grower_name: {
        required: true,
        fieldName: 'Grower Name',
        minLength: 2,
        maxLength: 100
    },
    delivery_date: {
        required: true,
        type: 'date',
        fieldName: 'Delivery Date'
    },
    wet_nut_in_shell_kg: {
        required: true,
        type: 'weight',
        max: 100000,
        fieldName: 'Wet Nut Weight'
    },
    moisture_content_percentage: {
        required: false,
        type: 'percentage',
        fieldName: 'Moisture Content'
    }
};

// Validate before saving
const validation = offlineHelpers.validateFormData(formData, validationRules);
if (!validation.valid) {
    dataValidation.showValidationErrors(validation.errors);
    return;
}
```

## Data Functions Integration

The `data-functions.js` has been enhanced to automatically:
- Queue write operations (create/update/delete) when offline
- Return cached data for read operations when offline
- Detect module from function name for better organization

### Module Detection

Functions are automatically categorized by module:
- `*user*` → `users`
- `*contact*` → `crm`
- `*sample*`, `*grower*` → `grower-intake`
- `*production*`, `*batch*` → `kernel-production`
- `*quality*`, `*test*` → `quality-assurance`
- `*stock*`, `*item*` → `stock-management`
- etc.

You can override by passing `module` in options:
```javascript
await dataFunctions.callFunction('create_item', params, token, {
    module: 'stock-management'
});
```

## Offline Storage Structure

### Queued Requests
- Stores pending API requests
- Tracks retry count and errors
- Status: `pending`, `synced`, `failed`

### Offline Data
- Stores complete data records
- Tracks sync status
- Module-specific organization

### Form Drafts
- Auto-saved form data
- Prevents data loss
- Module and form ID based

## UI Indicators

### Offline Indicator
- Fixed position badge (top-right)
- Shows "Offline" when disconnected
- Shows "Back Online" when reconnected
- Auto-hides after 3 seconds when online

### Sync Status
- Shows pending sync count
- Displays sync progress
- Shows success/error status

## Best Practices

### 1. Always Validate Data
```javascript
// Use validation before saving
const validation = dataValidation.validateGrowerIntake(formData);
if (!validation.valid) {
    dataValidation.showValidationErrors(validation.errors);
    return;
}
```

### 2. Handle Offline Responses
```javascript
const result = await dataFunctions.createItem(formData);
if (result && result.queued) {
    // Show appropriate message
    Swal.fire({
        icon: 'info',
        title: 'Saved Offline',
        text: 'Your data will be synced when online.'
    });
}
```

### 3. Use Form Drafts
```javascript
// Auto-save drafts
const autoSave = offlineHelpers.autoSaveFormDraft(module, formId, formData);
$('form input, form select').on('input', autoSave);

// Load on form open
await offlineHelpers.loadFormDraft(module, formId, formElement);

// Clear on successful save
await offlineHelpers.clearFormDraft(module, formId);
```

### 4. Show Offline Warnings
```javascript
if (!navigator.onLine) {
    offlineHelpers.showOfflineWarning('content-area');
}
```

### 5. Check Sync Status
```javascript
const status = await offlineSync.getSyncStatus();
console.log('Pending:', status.pending);
console.log('Failed:', status.failed);
```

## Testing Offline Mode

### Chrome DevTools
1. Open DevTools (F12)
2. Go to Network tab
3. Select "Offline" from throttling dropdown
4. Test your module's save functionality

### Service Worker Testing
1. Open DevTools → Application tab
2. Go to Service Workers
3. Check "Offline" checkbox
4. Test offline functionality

## Troubleshooting

### Service Worker Not Registering
- Check browser console for errors
- Ensure `sw.js` is accessible at root
- Check HTTPS requirement (or localhost)

### Data Not Syncing
- Check `offlineSync.getSyncStatus()`
- Verify authentication token is valid
- Check network connectivity
- Review queued requests in IndexedDB

### Validation Not Working
- Ensure `data-validation.js` is loaded
- Check validation rules format
- Verify field names match form data

## API Reference

### offlineStorage
- `queueRequest(requestData)` - Queue a request
- `getQueuedRequests(status)` - Get queued requests
- `saveOfflineData(module, data, metadata)` - Save offline data
- `getOfflineData(module, synced)` - Get offline data
- `saveFormDraft(module, formId, formData)` - Save draft
- `getFormDraft(module, formId)` - Get draft
- `getStats()` - Get storage statistics

### offlineSync
- `syncQueuedRequests()` - Manually trigger sync
- `getSyncStatus()` - Get sync status
- `manualSync()` - Force sync

### offlineDetector
- `getStatus()` - Get online status
- `checkConnectivity()` - Test connectivity

### dataValidation
- `validateGrowerIntake(data)` - Validate grower intake
- `validateQualityTest(data)` - Validate quality test
- `validateStockItem(data)` - Validate stock item
- `validateField(field, value, rules)` - Validate field
- `showValidationErrors(errors, containerId)` - Show errors

### offlineHelpers
- `autoSaveFormDraft(module, formId, formData, debounceMs)` - Auto-save
- `loadFormDraft(module, formId, formElement)` - Load draft
- `clearFormDraft(module, formId)` - Clear draft
- `saveDataWithOfflineSupport(module, saveFunction, formData, rules)` - Save with validation
- `getOfflineDataCount(module)` - Get count
- `showSyncStatusBadge(containerId, status)` - Show badge

## Security Considerations

- Offline data is stored locally in IndexedDB
- Sensitive data should be encrypted if needed
- Authentication tokens are required for sync
- Failed syncs are retried with exponential backoff
- Old queued requests are cleaned up after successful sync

## Performance

- IndexedDB operations are asynchronous
- Form drafts use debouncing to reduce writes
- Sync runs in background to avoid blocking UI
- Cached data reduces network requests
- Service worker caches static assets

