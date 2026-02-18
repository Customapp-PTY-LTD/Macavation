/**
 * Offline Sync Service
 * Handles syncing queued requests when back online
 */

var _offlineSync = function () {
    return {
        isSyncing: false,
        syncInterval: null,

        /**
         * Initialize sync service
         */
        init: function () {
            // Initialize offline storage
            offlineStorage.init().catch(err => {
                console.error('[Offline Sync] Failed to initialize storage:', err);
            });

            // Listen for online/offline events
            window.addEventListener('online', () => {
                console.log('[Offline Sync] Back online, starting sync...');
                this.startSync();
            });

            window.addEventListener('offline', () => {
                console.log('[Offline Sync] Gone offline');
                this.stopSync();
            });

            // Start sync if online
            if (navigator.onLine) {
                this.startSync();
            }

            // Periodic sync check (every 30 seconds)
            this.syncInterval = setInterval(() => {
                if (navigator.onLine && !this.isSyncing) {
                    this.syncQueuedRequests();
                }
            }, 30000);
        },

        /**
         * Start automatic syncing
         */
        startSync: function () {
            if (!navigator.onLine) {
                return;
            }

            // Sync immediately
            this.syncQueuedRequests();

            // Register background sync if available
            if ('serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype) {
                navigator.serviceWorker.ready.then((registration) => {
                    return registration.sync.register('sync-queued-requests');
                }).catch((err) => {
                    console.log('[Offline Sync] Background sync not available:', err);
                });
            }
        },

        /**
         * Stop automatic syncing
         */
        stopSync: function () {
            if (this.syncInterval) {
                clearInterval(this.syncInterval);
            }
        },

        /**
         * Sync all queued requests
         */
        syncQueuedRequests: async function () {
            if (this.isSyncing || !navigator.onLine) {
                return;
            }

            this.isSyncing = true;

            try {
                const queuedRequests = await offlineStorage.getQueuedRequests('pending');
                
                if (queuedRequests.length === 0) {
                    this.isSyncing = false;
                    return;
                }

                console.log(`[Offline Sync] Syncing ${queuedRequests.length} queued requests...`);

                // Update UI to show syncing
                this.updateSyncStatus(queuedRequests.length);

                let successCount = 0;
                let errorCount = 0;

                for (const queuedRequest of queuedRequests) {
                    try {
                        // Get token
                        const token = dataFunctions.getToken();
                        if (!token) {
                            throw new Error('No authentication token');
                        }

                        // Execute the queued request
                        const result = await dataFunctions.callFunction(
                            queuedRequest.functionName,
                            queuedRequest.params,
                            token,
                            { useCache: false }
                        );

                        // Check if successful
                        if (result && result.success !== false && !result.offline) {
                            // Mark as synced
                            await offlineStorage.updateQueuedRequest(queuedRequest.id, {
                                status: 'synced',
                                syncedAt: Date.now()
                            });

                            // Delete after successful sync (optional - keep for audit)
                            // await offlineStorage.deleteQueuedRequest(queuedRequest.id);

                            successCount++;
                            console.log(`[Offline Sync] Synced request ${queuedRequest.id}:`, queuedRequest.functionName);
                        } else {
                            // Increment retry count
                            await offlineStorage.updateQueuedRequest(queuedRequest.id, {
                                retryCount: (queuedRequest.retryCount || 0) + 1,
                                lastError: result?.message || 'Unknown error',
                                status: queuedRequest.retryCount >= 5 ? 'failed' : 'pending'
                            });

                            errorCount++;
                            console.warn(`[Offline Sync] Failed to sync request ${queuedRequest.id}:`, result?.message);
                        }
                    } catch (error) {
                        // Increment retry count
                        await offlineStorage.updateQueuedRequest(queuedRequest.id, {
                            retryCount: (queuedRequest.retryCount || 0) + 1,
                            lastError: error.message,
                            status: queuedRequest.retryCount >= 5 ? 'failed' : 'pending'
                        });

                        errorCount++;
                        console.error(`[Offline Sync] Error syncing request ${queuedRequest.id}:`, error);
                    }

                    // Small delay between requests to avoid overwhelming the server
                    await new Promise(resolve => setTimeout(resolve, 100));
                }

                // Update UI
                this.updateSyncStatus(0, successCount, errorCount);

                // Show notification if there were errors
                if (errorCount > 0) {
                    this.showSyncNotification(successCount, errorCount);
                } else if (successCount > 0) {
                    this.showSyncSuccess(successCount);
                }

                console.log(`[Offline Sync] Sync complete: ${successCount} succeeded, ${errorCount} failed`);

            } catch (error) {
                console.error('[Offline Sync] Error during sync:', error);
            } finally {
                this.isSyncing = false;
            }
        },

        /**
         * Update sync status in UI
         */
        updateSyncStatus: function (pending, synced = 0, failed = 0) {
            // Update offline indicator if it exists
            const offlineIndicator = document.getElementById('offline-indicator');
            if (offlineIndicator) {
                if (pending > 0) {
                    offlineIndicator.innerHTML = `
                        <i class="fas fa-sync fa-spin me-2"></i>
                        Syncing ${pending} items...
                    `;
                    offlineIndicator.className = 'badge bg-warning text-dark';
                    offlineIndicator.style.display = 'inline-block';
                } else if (synced > 0 || failed > 0) {
                    offlineIndicator.innerHTML = `
                        <i class="fas fa-check-circle me-2"></i>
                        ${synced} synced${failed > 0 ? `, ${failed} failed` : ''}
                    `;
                    offlineIndicator.className = failed > 0 
                        ? 'badge bg-danger' 
                        : 'badge bg-success';
                    setTimeout(() => {
                        if (navigator.onLine) {
                            offlineIndicator.style.display = 'none';
                        }
                    }, 3000);
                }
            }
        },

        /**
         * Show sync notification
         */
        showSyncNotification: function (successCount, errorCount) {
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: errorCount > 0 ? 'warning' : 'success',
                    title: 'Sync Complete',
                    html: `
                        <p>${successCount} item(s) synced successfully</p>
                        ${errorCount > 0 ? `<p class="text-danger">${errorCount} item(s) failed to sync</p>` : ''}
                    `,
                    timer: 5000,
                    showConfirmButton: true
                });
            }
        },

        /**
         * Show sync success
         */
        showSyncSuccess: function (count) {
            // Use a subtle toast notification
            if (typeof Swal !== 'undefined') {
                Swal.fire({
                    icon: 'success',
                    title: 'Data Synced',
                    text: `${count} item(s) synced successfully`,
                    timer: 3000,
                    showConfirmButton: false,
                    toast: true,
                    position: 'top-end'
                });
            }
        },

        /**
         * Manually trigger sync
         */
        manualSync: async function () {
            if (!navigator.onLine) {
                if (typeof Swal !== 'undefined') {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Offline',
                        text: 'Cannot sync while offline'
                    });
                }
                return;
            }

            await this.syncQueuedRequests();
        },

        /**
         * Get sync status
         */
        getSyncStatus: async function () {
            const queuedRequests = await offlineStorage.getQueuedRequests('pending');
            const failedRequests = await offlineStorage.getQueuedRequests('failed');
            const stats = await offlineStorage.getStats();

            return {
                isOnline: navigator.onLine,
                isSyncing: this.isSyncing,
                pending: queuedRequests.length,
                failed: failedRequests.length,
                stats: stats
            };
        }
    };
}();

// Create global instance
const offlineSync = _offlineSync;
window.offlineSync = offlineSync;

