/**
 * Offline Detection and UI Indicator
 * Monitors online/offline status and updates UI accordingly
 */

var _offlineDetector = function () {
    return {
        isOnline: navigator.onLine,
        indicatorElement: null,

        /**
         * Initialize offline detection
         */
        init: function () {
            // Create offline indicator element
            this.createIndicator();

            // Listen for online/offline events
            window.addEventListener('online', () => {
                this.handleOnline();
            });

            window.addEventListener('offline', () => {
                this.handleOffline();
            });

            // Initial state
            if (this.isOnline) {
                this.hideIndicator();
            } else {
                this.showOfflineIndicator();
            }

            // Periodic connectivity check (every 10 seconds)
            setInterval(() => {
                this.checkConnectivity();
            }, 10000);
        },

        /**
         * Create offline indicator element (disabled – indicator removed from UI)
         */
        createIndicator: function () {
            this.indicatorElement = null;
        },

        /**
         * Handle online event
         */
        handleOnline: function () {
            console.log('[Offline Detector] Back online');
            this.isOnline = true;
            this.showOnlineIndicator();
            
            // Trigger sync
            if (typeof offlineSync !== 'undefined') {
                offlineSync.startSync();
            }

            // Hide indicator after a moment
            setTimeout(() => {
                this.hideIndicator();
            }, 3000);
        },

        /**
         * Handle offline event
         */
        handleOffline: function () {
            console.log('[Offline Detector] Gone offline');
            this.isOnline = false;
            this.showOfflineIndicator();
        },

        /**
         * Show offline indicator
         */
        showOfflineIndicator: function () {
            if (this.indicatorElement) {
                this.indicatorElement.innerHTML = '<i class="fas fa-wifi-slash me-2"></i>Offline';
                this.indicatorElement.className = 'badge bg-danger';
                this.indicatorElement.style.display = 'block';
            }
        },

        /**
         * Show online indicator
         */
        showOnlineIndicator: function () {
            if (this.indicatorElement) {
                this.indicatorElement.innerHTML = '<i class="fas fa-wifi me-2"></i>Back Online';
                this.indicatorElement.className = 'badge bg-success';
                this.indicatorElement.style.display = 'block';
            }
        },

        /**
         * Hide indicator
         */
        hideIndicator: function () {
            if (this.indicatorElement) {
                this.indicatorElement.style.display = 'none';
            }
        },

        /**
         * Check connectivity with a test request
         */
        checkConnectivity: async function () {
            try {
                // Try to fetch a small resource to verify connectivity
                const response = await fetch('/favicon.svg', {
                    method: 'HEAD',
                    cache: 'no-cache',
                    timeout: 5000
                });

                if (response.ok && !this.isOnline) {
                    // Actually online but browser thinks offline
                    this.handleOnline();
                } else if (!response.ok && this.isOnline) {
                    // Actually offline but browser thinks online
                    this.handleOffline();
                }
            } catch (error) {
                if (this.isOnline) {
                    // Network error - might be offline
                    this.handleOffline();
                }
            }
        },

        /**
         * Get current online status
         */
        getStatus: function () {
            return {
                isOnline: this.isOnline,
                indicatorVisible: this.indicatorElement ? 
                    this.indicatorElement.style.display !== 'none' : false
            };
        }
    };
}();

// Create global instance
const offlineDetector = _offlineDetector;
window.offlineDetector = offlineDetector;

