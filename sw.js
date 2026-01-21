/**
 * Service Worker for Macavation PWA
 * Handles offline functionality, caching, and background sync
 */

const CACHE_NAME = 'macavation-v2'; // Updated to force cache refresh after removing Phoenix CSS
const RUNTIME_CACHE = 'macavation-runtime-v2';
const OFFLINE_PAGE = '/index.html';

// Assets to cache on install
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/signin.html',
    '/css/main.css',
    '/css/mobile-first.css',
    '/js/app.js',
    '/js/appRouter.js',
    '/js/data-functions.js',
    '/js/auth-service.js',
    '/js/common.js',
    '/favicon.svg'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log('[Service Worker] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[Service Worker] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('[Service Worker] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((cacheName) => {
                        return cacheName !== CACHE_NAME && cacheName !== RUNTIME_CACHE;
                    })
                    .map((cacheName) => {
                        console.log('[Service Worker] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    })
            );
        })
            .then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip cross-origin requests (except our Lambda proxy)
    if (url.origin !== location.origin && !url.href.includes('lambda-url')) {
        return;
    }

    // Handle API calls (Lambda proxy)
    if (url.href.includes('lambda-url') || url.pathname.includes('/proxy/')) {
        event.respondWith(handleApiRequest(request));
        return;
    }

    // Handle static assets
    event.respondWith(
        caches.match(request)
            .then((response) => {
                if (response) {
                    return response;
                }
                return fetch(request)
                    .then((response) => {
                        // Don't cache if not a valid response
                        if (!response || response.status !== 200 || response.type !== 'basic') {
                            return response;
                        }

                        // Clone the response
                        const responseToCache = response.clone();

                        // Cache successful responses
                        caches.open(RUNTIME_CACHE).then((cache) => {
                            cache.put(request, responseToCache);
                        });

                        return response;
                    })
                    .catch(() => {
                        // If offline and request is for a page, return offline page
                        if (request.mode === 'navigate') {
                            return caches.match(OFFLINE_PAGE);
                        }
                    });
            })
    );
});

// Handle API requests with offline queue support
async function handleApiRequest(request) {
    try {
        // Try network first
        const response = await fetch(request);
        
        // Clone response for caching
        const responseClone = response.clone();
        
        // Cache successful GET requests
        if (response.ok && request.method === 'GET') {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, responseClone);
        }
        
        return response;
    } catch (error) {
        console.log('[Service Worker] Network error, checking cache:', error);
        
        // Try cache
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // If POST/PUT/DELETE and offline, queue for later
        if (request.method !== 'GET') {
            // Return a response indicating the request was queued
            return new Response(
                JSON.stringify({
                    success: false,
                    offline: true,
                    queued: true,
                    message: 'Request queued for sync when online'
                }),
                {
                    status: 202,
                    headers: { 'Content-Type': 'application/json' }
                }
            );
        }
        
        // For GET requests, return error
        return new Response(
            JSON.stringify({
                success: false,
                offline: true,
                message: 'No internet connection and no cached data available'
            }),
            {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

// Background sync for queued requests
self.addEventListener('sync', (event) => {
    console.log('[Service Worker] Background sync:', event.tag);
    
    if (event.tag === 'sync-queued-requests') {
        event.waitUntil(syncQueuedRequests());
    }
});

// Sync queued requests when back online
async function syncQueuedRequests() {
    // This will be handled by the offline sync service in the main app
    // The service worker just triggers the sync
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
        client.postMessage({
            type: 'SYNC_QUEUED_REQUESTS'
        });
    });
}

// Message handler for communication with main app
self.addEventListener('message', (event) => {
    console.log('[Service Worker] Message received:', event.data);
    
    // Always respond to messages to prevent "message channel closed" errors
    const respond = () => {
        if (event.ports && event.ports[0]) {
            try {
                event.ports[0].postMessage({ success: true });
            } catch (e) {
                // Ignore if port is already closed
            }
        }
    };
    
    try {
        if (event.data && event.data.type === 'SKIP_WAITING') {
            self.skipWaiting();
            respond();
        } else if (event.data && event.data.type === 'CACHE_URLS') {
            event.waitUntil(
                caches.open(RUNTIME_CACHE).then((cache) => {
                    return cache.addAll(event.data.urls);
                }).then(() => {
                    respond();
                }).catch((error) => {
                    console.error('[Service Worker] Error caching URLs:', error);
                    respond();
                })
            );
        } else {
            // Respond to unknown message types
            respond();
        }
    } catch (error) {
        console.error('[Service Worker] Error handling message:', error);
        respond();
    }
});

