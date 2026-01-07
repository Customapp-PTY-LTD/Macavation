# Testing Digitization Features

## Quick Test Script

Copy and paste this into your browser console (F12) after navigating to each module:

### Test 1: Kernel Production Job Card

**Navigate to:** Kernel Production module

**Paste in console:**
```javascript
// Test button exists
console.log('Button exists:', !!document.getElementById('addJobCardBtn'));
console.log('Modal exists:', !!document.getElementById('kernelJobCardModal'));
console.log('Grid object:', typeof kernelProductionGrid);
console.log('Show modal function:', typeof kernelProductionGrid?.showJobCardModal);

// Try clicking manually
const btn = document.getElementById('addJobCardBtn');
if (btn) {
    btn.click();
} else {
    console.error('Button not found!');
}

// Check if event listener is attached
if (btn) {
    const listeners = getEventListeners(btn); // Chrome DevTools
    console.log('Event listeners:', listeners);
}
```

### Test 2: Stock Take

**Navigate to:** Stock Management module

**Paste in console:**
```javascript
// Test button exists
console.log('Button exists:', !!document.getElementById('stockTakeBtn'));
console.log('Modal exists:', !!document.getElementById('stockTakeModal'));
console.log('Grid object:', typeof stockManagementGrid);
console.log('Show modal function:', typeof stockManagementGrid?.showStockTakeModal);

// Try clicking manually
const btn = document.getElementById('stockTakeBtn');
if (btn) {
    btn.click();
} else {
    console.error('Button not found!');
}
```

### Test 3: Manual Modal Opening

If buttons don't work, try opening modals directly:

```javascript
// Kernel Job Card Modal
const modalElement = document.getElementById('kernelJobCardModal');
if (modalElement) {
    if (typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(modalElement);
        modal.show();
        console.log('Modal opened via Bootstrap');
    } else if (typeof $ !== 'undefined') {
        $('#kernelJobCardModal').modal('show');
        console.log('Modal opened via jQuery');
    } else {
        console.error('Neither Bootstrap nor jQuery available');
    }
} else {
    console.error('Modal element not found');
}

// Stock Take Modal
const stockTakeModal = document.getElementById('stockTakeModal');
if (stockTakeModal) {
    if (typeof bootstrap !== 'undefined') {
        const modal = new bootstrap.Modal(stockTakeModal);
        modal.show();
        console.log('Stock Take modal opened via Bootstrap');
    }
}
```

## Common Issues

### Issue: Buttons not found
**Fix:** Navigate to the correct module first, then wait 2-3 seconds for initialization

### Issue: Modals don't open
**Fix:** Check if Bootstrap is loaded: `typeof bootstrap`

### Issue: Functions not defined
**Fix:** Hard refresh (Ctrl+Shift+R) and check console for JavaScript errors

### Issue: Event listeners not attached
**Fix:** Module might not be initialized. Check: `typeof kernelProductionGrid`

## Expected Behavior

✅ Button click should log: `[Kernel Production] Job Card button clicked`
✅ Modal should appear on screen
✅ Form fields should be visible
✅ Dropdowns should populate (suppliers, etc.)

## Report Results

After testing, report:
1. Which buttons were clicked
2. What console messages appeared
3. What happened (modal opened, error, nothing)
4. Any JavaScript errors in console
