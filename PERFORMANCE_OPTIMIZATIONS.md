# Performance Optimizations

## Overview
This document outlines the performance optimizations implemented in the Macavation system to ensure fast, responsive user experience.

## Caching System

### Implementation
- **Location**: `js/data-functions.js`
- **Cache Storage**: In-memory Map with TTL (Time-To-Live)
- **Cache Types**:
  - **Static Data** (5 minutes): Users, roles, contacts list
  - **Dynamic Data** (1 minute): Production batches, stock items, quality tests
  - **Dashboard Data** (30 seconds): Alerts, KPIs

### Cache Features
1. **Automatic Caching**: All API calls are cached by default
2. **Request Deduplication**: Prevents duplicate simultaneous requests
3. **Cache Invalidation**: Automatic invalidation on create/update/delete operations
4. **Force Refresh**: Option to bypass cache when needed
5. **Expiration**: Automatic cleanup of expired cache entries

### Usage Examples

```javascript
// Normal call (uses cache)
const users = await dataFunctions.getUsers();

// Force refresh (bypasses cache)
const users = await dataFunctions.getUsers(null, true);

// Custom cache options
const data = await dataFunctions.callFunction('get_custom_data', {}, null, {
    cacheKey: 'custom_key',
    useCache: true,
    cacheTtl: 60000, // 1 minute
    forceRefresh: false
});
```

### Cache Invalidation
Cache is automatically invalidated when:
- Creating new records
- Updating existing records
- Deleting records

Pattern-based invalidation clears related cache entries:
```javascript
// Invalidates all user-related cache
dataFunctions.clearCachePattern('users');
```

## Performance Monitoring

### Performance Utilities
- **Location**: `js/performance-utils.js`
- **Features**:
  - API call tracking
  - Render time tracking
  - Cache hit/miss statistics
  - Performance statistics

### Usage
```javascript
// Get performance stats
const stats = performanceUtils.getStats();
console.log('Cache hit rate:', stats.cache.hitRate);
console.log('Average API time:', stats.apiCalls.averageTime);

// Debounce search input
const debouncedSearch = performanceUtils.debounce(searchFunction, 300);
$('#searchInput').on('input', debouncedSearch);

// Throttle scroll events
const throttledScroll = performanceUtils.throttle(scrollFunction, 100);
$(window).on('scroll', throttledScroll);
```

## Database Optimizations

### Indexes Added
Performance indexes have been added to optimize common queries:

1. **Contacts**:
   - `idx_contacts_company_lower` - Case-insensitive company name searches
   - `idx_contacts_email_lower` - Email lookups

2. **Production Batches**:
   - `idx_production_batches_status_date` - Filter by status and date
   - `idx_production_batches_step_status` - Filter by workflow step

3. **Stock Items**:
   - `idx_stock_items_product_status` - Product type and status filtering
   - `idx_stock_items_location` - Location-based queries

4. **Quality Tests**:
   - `idx_quality_tests_type_date` - Test type and date filtering
   - `idx_quality_tests_result_date` - Result-based queries

5. **Sample Submissions**:
   - `idx_sample_submissions_supplier_status` - Supplier and status filtering
   - `idx_sample_submissions_date_status` - Date-based queries

## Module Optimizations

### Debouncing
Search and filter operations use debouncing to reduce API calls:
- **Search Input**: 300ms debounce
- **Filter Changes**: 300ms debounce

### Parallel Loading
Dashboard modules load multiple data sources in parallel:
```javascript
const [batches, alerts] = await Promise.all([
    dataFunctions.getProductionBatches(),
    dataFunctions.getDashboardAlerts()
]);
```

### Performance Logging
All data loading operations log performance metrics:
```javascript
const startTime = performance.now();
const data = await dataFunctions.getContacts();
const loadTime = performance.now() - startTime;
console.log(`[Performance] Contacts loaded in ${loadTime.toFixed(2)}ms`);
```

## Best Practices

### 1. Use Cache for Static Data
Always use caching for data that doesn't change frequently:
- User lists
- Role lists
- Contact lists
- Reference data

### 2. Force Refresh When Needed
Use force refresh for:
- After creating/updating records
- When user explicitly clicks refresh
- Real-time critical data

### 3. Debounce User Input
Always debounce search and filter inputs:
```javascript
$('#searchInput').on('input', performanceUtils.debounce(searchFunction, 300));
```

### 4. Parallel Data Loading
Load independent data sources in parallel:
```javascript
const [data1, data2, data3] = await Promise.all([
    loadData1(),
    loadData2(),
    loadData3()
]);
```

### 5. Monitor Performance
Track performance metrics in development:
```javascript
const stats = performanceUtils.getStats();
console.log('Performance Stats:', stats);
```

## Cache Statistics

View cache statistics in browser console:
```javascript
// Get cache stats
const cacheStats = dataFunctions.getCacheStats();
console.log('Cache Stats:', cacheStats);
// Output: { total: 15, valid: 12, expired: 3, pendingRequests: 0 }
```

## Performance Targets

- **API Response Time**: < 200ms (cached), < 500ms (uncached)
- **Page Load Time**: < 1 second
- **Search Response**: < 100ms (debounced)
- **Cache Hit Rate**: > 70% for static data

## Troubleshooting

### Clear Cache
```javascript
// Clear specific cache
dataFunctions.clearCache('users_list');

// Clear all cache
dataFunctions.clearAllCache();

// Clear expired cache (automatic, runs every minute)
dataFunctions.clearExpiredCache();
```

### Debug Cache
```javascript
// Check if data is cached
const cached = dataFunctions.getCached('users_list');
console.log('Cached:', cached);

// View all cache keys
console.log('Cache keys:', Array.from(dataFunctions.cache.data.keys()));
```

## Future Enhancements

1. **Persistent Cache**: Store cache in localStorage for offline support
2. **Service Worker**: Implement service worker for offline functionality
3. **Lazy Loading**: Implement lazy loading for large datasets
4. **Virtual Scrolling**: Use virtual scrolling for large lists
5. **Image Optimization**: Optimize and lazy load images
6. **Bundle Optimization**: Code splitting and tree shaking

