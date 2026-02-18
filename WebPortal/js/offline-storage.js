/**
 * Offline Storage Service
 * Handles IndexedDB storage for offline data capture and sync queue
 */

var _offlineStorage = function () {
    return {
        dbName: 'MacavationDB',
        dbVersion: 1,
        db: null,

        /**
         * Initialize IndexedDB
         */
        init: async function () {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(this.dbName, this.dbVersion);

                request.onerror = () => {
                    console.error('[Offline Storage] Failed to open database');
                    reject(request.error);
                };

                request.onsuccess = () => {
                    this.db = request.result;
                    console.log('[Offline Storage] Database opened successfully');
                    resolve(this.db);
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Object store for queued requests
                    if (!db.objectStoreNames.contains('queuedRequests')) {
                        const queuedStore = db.createObjectStore('queuedRequests', {
                            keyPath: 'id',
                            autoIncrement: true
                        });
                        queuedStore.createIndex('timestamp', 'timestamp', { unique: false });
                        queuedStore.createIndex('status', 'status', { unique: false });
                        queuedStore.createIndex('module', 'module', { unique: false });
                    }

                    // Object store for offline data
                    if (!db.objectStoreNames.contains('offlineData')) {
                        const dataStore = db.createObjectStore('offlineData', {
                            keyPath: 'id',
                            autoIncrement: true
                        });
                        dataStore.createIndex('module', 'module', { unique: false });
                        dataStore.createIndex('timestamp', 'timestamp', { unique: false });
                        dataStore.createIndex('synced', 'synced', { unique: false });
                    }

                    // Object store for form drafts
                    if (!db.objectStoreNames.contains('formDrafts')) {
                        const draftsStore = db.createObjectStore('formDrafts', {
                            keyPath: 'id',
                            autoIncrement: true
                        });
                        draftsStore.createIndex('module', 'module', { unique: false });
                        draftsStore.createIndex('timestamp', 'timestamp', { unique: false });
                    }

                    console.log('[Offline Storage] Database schema created');
                };
            });
        },

        /**
         * Queue a request for later sync
         */
        queueRequest: async function (requestData) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['queuedRequests'], 'readwrite');
                const store = transaction.objectStore('queuedRequests');

                const queuedRequest = {
                    functionName: requestData.functionName,
                    params: requestData.params,
                    module: requestData.module || 'unknown',
                    timestamp: Date.now(),
                    status: 'pending',
                    retryCount: 0,
                    lastError: null
                };

                const request = store.add(queuedRequest);

                request.onsuccess = () => {
                    console.log('[Offline Storage] Request queued:', queuedRequest);
                    resolve(request.result);
                };

                request.onerror = () => {
                    console.error('[Offline Storage] Failed to queue request:', request.error);
                    reject(request.error);
                };
            });
        },

        /**
         * Get all queued requests
         */
        getQueuedRequests: async function (status = 'pending') {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['queuedRequests'], 'readonly');
                const store = transaction.objectStore('queuedRequests');
                const index = store.index('status');
                const request = index.getAll(status);

                request.onsuccess = () => {
                    resolve(request.result || []);
                };

                request.onerror = () => {
                    reject(request.error);
                };
            });
        },

        /**
         * Update queued request status
         */
        updateQueuedRequest: async function (id, updates) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['queuedRequests'], 'readwrite');
                const store = transaction.objectStore('queuedRequests');
                const getRequest = store.get(id);

                getRequest.onsuccess = () => {
                    const request = getRequest.result;
                    if (request) {
                        Object.assign(request, updates);
                        const updateRequest = store.put(request);

                        updateRequest.onsuccess = () => resolve(request);
                        updateRequest.onerror = () => reject(updateRequest.error);
                    } else {
                        reject(new Error('Request not found'));
                    }
                };

                getRequest.onerror = () => reject(getRequest.error);
            });
        },

        /**
         * Delete queued request
         */
        deleteQueuedRequest: async function (id) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['queuedRequests'], 'readwrite');
                const store = transaction.objectStore('queuedRequests');
                const request = store.delete(id);

                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        },

        /**
         * Save offline data
         */
        saveOfflineData: async function (module, data, metadata = {}) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['offlineData'], 'readwrite');
                const store = transaction.objectStore('offlineData');

                const offlineRecord = {
                    module: module,
                    data: data,
                    metadata: metadata,
                    timestamp: Date.now(),
                    synced: false
                };

                const request = store.add(offlineRecord);

                request.onsuccess = () => {
                    console.log('[Offline Storage] Data saved offline:', module);
                    resolve(request.result);
                };

                request.onerror = () => {
                    reject(request.error);
                };
            });
        },

        /**
         * Get offline data for a module
         */
        getOfflineData: async function (module, synced = false) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['offlineData'], 'readonly');
                const store = transaction.objectStore('offlineData');
                const index = store.index('module');
                const request = index.getAll(module);

                request.onsuccess = () => {
                    const allData = request.result || [];
                    const filtered = synced === null 
                        ? allData 
                        : allData.filter(item => item.synced === synced);
                    resolve(filtered);
                };

                request.onerror = () => {
                    reject(request.error);
                };
            });
        },

        /**
         * Mark data as synced
         */
        markDataAsSynced: async function (id) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['offlineData'], 'readwrite');
                const store = transaction.objectStore('offlineData');
                const getRequest = store.get(id);

                getRequest.onsuccess = () => {
                    const record = getRequest.result;
                    if (record) {
                        record.synced = true;
                        const updateRequest = store.put(record);

                        updateRequest.onsuccess = () => resolve(record);
                        updateRequest.onerror = () => reject(updateRequest.error);
                    } else {
                        reject(new Error('Record not found'));
                    }
                };

                getRequest.onerror = () => reject(getRequest.error);
            });
        },

        /**
         * Save form draft
         */
        saveFormDraft: async function (module, formId, formData) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['formDrafts'], 'readwrite');
                const store = transaction.objectStore('formDrafts');
                const index = store.index('module');
                const getRequest = index.getAll(module);

                getRequest.onsuccess = () => {
                    // Check if draft exists for this form
                    const existing = getRequest.result.find(d => d.formId === formId);
                    
                    const draft = {
                        module: module,
                        formId: formId,
                        formData: formData,
                        timestamp: Date.now()
                    };

                    const request = existing 
                        ? store.put({ ...existing, ...draft })
                        : store.add(draft);

                    request.onsuccess = () => {
                        console.log('[Offline Storage] Form draft saved:', module, formId);
                        resolve(request.result);
                    };

                    request.onerror = () => reject(request.error);
                };

                getRequest.onerror = () => reject(getRequest.error);
            });
        },

        /**
         * Get form draft
         */
        getFormDraft: async function (module, formId) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['formDrafts'], 'readonly');
                const store = transaction.objectStore('formDrafts');
                const index = store.index('module');
                const request = index.getAll(module);

                request.onsuccess = () => {
                    const draft = request.result.find(d => d.formId === formId);
                    resolve(draft || null);
                };

                request.onerror = () => reject(request.error);
            });
        },

        /**
         * Delete form draft
         */
        deleteFormDraft: async function (module, formId) {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(['formDrafts'], 'readwrite');
                const store = transaction.objectStore('formDrafts');
                const index = store.index('module');
                const request = index.getAll(module);

                request.onsuccess = () => {
                    const draft = request.result.find(d => d.formId === formId);
                    if (draft) {
                        const deleteRequest = store.delete(draft.id);
                        deleteRequest.onsuccess = () => resolve();
                        deleteRequest.onerror = () => reject(deleteRequest.error);
                    } else {
                        resolve();
                    }
                };

                request.onerror = () => reject(request.error);
            });
        },

        /**
         * Get storage statistics
         */
        getStats: async function () {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const stats = {
                    queuedRequests: 0,
                    offlineData: 0,
                    formDrafts: 0
                };

                const transaction = this.db.transaction(
                    ['queuedRequests', 'offlineData', 'formDrafts'],
                    'readonly'
                );

                const queuedCount = transaction.objectStore('queuedRequests').count();
                const dataCount = transaction.objectStore('offlineData').count();
                const draftsCount = transaction.objectStore('formDrafts').count();

                Promise.all([
                    new Promise(r => { queuedCount.onsuccess = () => { stats.queuedRequests = queuedCount.result; r(); }; }),
                    new Promise(r => { dataCount.onsuccess = () => { stats.offlineData = dataCount.result; r(); }; }),
                    new Promise(r => { draftsCount.onsuccess = () => { stats.formDrafts = draftsCount.result; r(); }; })
                ]).then(() => resolve(stats))
                  .catch(reject);
            });
        },

        /**
         * Clear all offline data (use with caution)
         */
        clearAll: async function () {
            if (!this.db) {
                await this.init();
            }

            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction(
                    ['queuedRequests', 'offlineData', 'formDrafts'],
                    'readwrite'
                );

                Promise.all([
                    new Promise(r => {
                        transaction.objectStore('queuedRequests').clear().onsuccess = r;
                    }),
                    new Promise(r => {
                        transaction.objectStore('offlineData').clear().onsuccess = r;
                    }),
                    new Promise(r => {
                        transaction.objectStore('formDrafts').clear().onsuccess = r;
                    })
                ]).then(() => {
                    console.log('[Offline Storage] All data cleared');
                    resolve();
                }).catch(reject);
            });
        }
    };
}();

// Create global instance
const offlineStorage = _offlineStorage;
window.offlineStorage = offlineStorage;

