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

            // Initial state from browser
            if (this.isOnline) {
                this.hideIndicator();
            } else {
                this.showOfflineIndicator();
            }

            // Run one connectivity check soon to correct false "offline" (browser often wrong)
            setTimeout(() => this.checkConnectivity(), 1500);

            // Periodic connectivity check (every 30 seconds) - only to correct false offline
            setInterval(() => this.checkConnectivity(), 30000);
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
                indicator.innerHTML = '<i class="fas fa-wifi-slash me-2"></i>Offline <span class="ms-2 small">(click to recheck)</span>';
                indicator.style.cursor = 'pointer';
                indicator.title = 'Click to recheck connection';
                indicator.addEventListener('click', () => {
                    if (typeof offlineDetector !== 'undefined' && offlineDetector.forceOnlineCheck) {
                        offlineDetector.forceOnlineCheck();
                    }
                });

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
                this.indicatorElement.innerHTML = '<i class="fas fa-wifi-slash me-2"></i>Offline <span class="ms-2 small">(click to recheck)</span>';
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
         * Check connectivity with a test request.
         * Only corrects "browser says offline but we can reach the network".
         * Does NOT mark as offline when fetch fails (could be 404, CORS, server down, file:// origin).
         */
        checkConnectivity: async function () {
            // Don't run fetch from file:// or when browser already says we're offline (avoid false positives)
            if (typeof window === 'undefined' || !window.location || window.location.protocol === 'file:') {
                return;
            }
            try {
                const url = (window.location.origin || window.location.href.split('/').slice(0, 3).join('/')) + '/';
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);
                const response = await fetch(url, {
                    method: 'HEAD',
                    cache: 'no-cache',
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (response.ok && !this.isOnline) {
                    this.handleOnline();
                }
            } catch (error) {
                if (!this.isOnline) {
                    try {
                        const r = await fetch(window.location.href, { method: 'HEAD', cache: 'no-cache' });
                        if (r.ok) this.handleOnline();
                    } catch (_) { /* ignore */ }
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
        },

        /**
         * Force re-check and treat as online (user says they have connection)
         */
        forceOnlineCheck: function () {
            this.isOnline = true;
            this.hideIndicator();
            this.checkConnectivity();
            if (typeof offlineSync !== 'undefined') {
                offlineSync.startSync();
            }
        }
    };
}();

// Create global instance
const offlineDetector = _offlineDetector;
window.offlineDetector = offlineDetector;

