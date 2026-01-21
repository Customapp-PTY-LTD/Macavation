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
         * Create offline indicator element
         */
        createIndicator: function () {
            // Check if already exists
            this.indicatorElement = document.getElementById('offline-indicator');
            
            if (!this.indicatorElement) {
                // Create indicator
                const indicator = document.createElement('div');
                indicator.id = 'offline-indicator';
                indicator.className = 'badge bg-danger';
                indicator.style.cssText = `
                    position: fixed;
                    top: 70px;
                    right: 20px;
                    z-index: 9999;
                    padding: 8px 16px;
                    border-radius: 20px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    display: none;
                    font-size: 14px;
                    font-weight: 600;
                `;
                indicator.innerHTML = '<i class="fas fa-wifi-slash me-2"></i>Offline';

                document.body.appendChild(indicator);
                this.indicatorElement = indicator;
            }
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

            // Show notification
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'warning',
                    title: 'Offline Mode',
                    html: `
                        <p>You are currently offline. Your data will be saved locally and synced when you're back online.</p>
                        <p class="text-muted small mt-2">You can continue working normally.</p>
                    `,
                    timer: 5000,
                    showConfirmButton: true,
                    confirmButtonText: 'OK'
                });
            }
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

