// Limey Dashboard — Service Worker
// Caches static assets for offline access

const CACHE_NAME = 'limey-dashboard-v1';

// Assets to cache immediately on install
const PRECACHE_ASSETS = [
  '/',
  '/login',
  '/dashboard',
  '/style.css',
  '/dashboard.js',
];

// Install: precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: serve from cache if offline, update cache from network when online
self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  // Don't cache API calls
  if (event.request.url.includes('/api/')) return;
  if (event.request.url.includes('/auth/')) return;
  if (event.request.url.includes('/health')) return;

  // For static assets, use cache-first strategy
  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        // Return cached response immediately (if available)
        if (cachedResponse) {
          // Also fetch and cache in background for next time
          fetch(event.request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.ok) {
                const clone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
              }
            })
            .catch(() => {
              // Offline — cached version is already being served
            });
          return cachedResponse;
        }

        // Not in cache — fetch from network
        return fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.ok) {
              const clone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
            return networkResponse;
          })
          .catch(() => {
            // Offline and not cached — return offline fallback for pages
            if (event.request.mode === 'navigate') {
              return caches.match('/');
            }
            return new Response('Offline', { status: 503 });
          });
      })
  );
});
