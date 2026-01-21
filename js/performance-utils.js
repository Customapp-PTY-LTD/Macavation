/**
 * Performance Utilities
 * Provides performance monitoring and optimization utilities
 */

var _performanceUtils = function () {
    return {
        // Performance metrics storage
        metrics: {
            apiCalls: [],
            renderTimes: [],
            cacheHits: 0,
            cacheMisses: 0
        },

        /**
         * Track API call performance
         */
        trackApiCall: function (functionName, duration, cached = false) {
            this.metrics.apiCalls.push({
                function: functionName,
                duration: duration,
                cached: cached,
                timestamp: Date.now()
            });

            // Keep only last 100 calls
            if (this.metrics.apiCalls.length > 100) {
                this.metrics.apiCalls.shift();
            }

            if (cached) {
                this.metrics.cacheHits++;
            } else {
                this.metrics.cacheMisses++;
            }
        },

        /**
         * Track render performance
         */
        trackRender: function (component, duration) {
            this.metrics.renderTimes.push({
                component: component,
                duration: duration,
                timestamp: Date.now()
            });

            // Keep only last 50 renders
            if (this.metrics.renderTimes.length > 50) {
                this.metrics.renderTimes.shift();
            }
        },

        /**
         * Get performance statistics
         */
        getStats: function () {
            const apiCalls = this.metrics.apiCalls;
            const renderTimes = this.metrics.renderTimes;

            const avgApiTime = apiCalls.length > 0
                ? apiCalls.reduce((sum, call) => sum + call.duration, 0) / apiCalls.length
                : 0;

            const avgRenderTime = renderTimes.length > 0
                ? renderTimes.reduce((sum, render) => sum + render.duration, 0) / renderTimes.length
                : 0;

            const cacheHitRate = (this.metrics.cacheHits + this.metrics.cacheMisses) > 0
                ? (this.metrics.cacheHits / (this.metrics.cacheHits + this.metrics.cacheMisses)) * 100
                : 0;

            return {
                apiCalls: {
                    total: apiCalls.length,
                    averageTime: avgApiTime.toFixed(2) + 'ms',
                    cached: this.metrics.cacheHits,
                    uncached: this.metrics.cacheMisses,
                    hitRate: cacheHitRate.toFixed(1) + '%'
                },
                renderTimes: {
                    total: renderTimes.length,
                    averageTime: avgRenderTime.toFixed(2) + 'ms'
                },
                cache: {
                    hits: this.metrics.cacheHits,
                    misses: this.metrics.cacheMisses,
                    hitRate: cacheHitRate.toFixed(1) + '%'
                }
            };
        },

        /**
         * Debounce function for search/filter operations
         */
        debounce: function (func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },

        /**
         * Throttle function for scroll/resize events
         */
        throttle: function (func, limit) {
            let inThrottle;
            return function executedFunction(...args) {
                if (!inThrottle) {
                    func.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        },

        /**
         * Clear all metrics
         */
        clearMetrics: function () {
            this.metrics.apiCalls = [];
            this.metrics.renderTimes = [];
            this.metrics.cacheHits = 0;
            this.metrics.cacheMisses = 0;
        }
    };
}();

// Create global instance
const performanceUtils = _performanceUtils;
window.performanceUtils = performanceUtils;

