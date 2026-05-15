// Service Worker for Stockify Inventory – offline-first caching
const CACHE_NAME = 'stockify-v1.0.0';
const PRE_CACHE_URLS = [
  // App shell
  './',
  './index.html',
  './manifest.json',
  './config.js',

  // CSS
  './assets/css/main.css',
  './assets/css/print.css',

  // JS modules (including activation)
  './assets/js/activation.js',
  './assets/js/db.js',
  './assets/js/router.js',
  './assets/js/auth.js',
  './assets/js/ui.js',
  './assets/js/utils.js',
  './assets/js/dashboard.js',
  './assets/js/products.js',
  './assets/js/stock.js',
  './assets/js/sales.js',
  './assets/js/categories.js',
  './assets/js/suppliers.js',
  './assets/js/notifications.js',
  './assets/js/reports.js',
  './assets/js/users.js',
  './assets/js/settings.js',
  './assets/js/audit.js',

  // Images
  './assets/images/logo-placeholder.png',
  './assets/images/empty-state.svg',
  './assets/images/favicon.ico',
  './assets/images/icon-192.png',
  './assets/images/icon-512.png',

  // External CDN resources (opaque caching – will work offline if cached)
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/dexie/3.2.6/dexie.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.7/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.3/jspdf.plugin.autotable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
  'https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Pre-caching app shell');
        // Use addAll for app-shell; for CDN we add individually to catch failures
        return cache.addAll(PRE_CACHE_URLS.filter(url => url.startsWith('./') || url.startsWith('/')))
          .then(() => {
            // Also add CDN resources with opaque mode to avoid CORS issues
            const cdnAdds = PRE_CACHE_URLS
              .filter(url => !url.startsWith('./') && !url.startsWith('/'))
              .map(url => cache.add(new Request(url, { mode: 'no-cors' })).catch(err => console.warn('Failed to cache CDN resource:', url, err)));
            return Promise.all(cdnAdds);
          });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Return cached response if found, else fetch from network and cache it
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        // Only cache same-origin or opaque responses
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'error') {
          return networkResponse;
        }

        // Clone the response to cache and return original
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });

        return networkResponse;
      }).catch(() => {
        // Offline fallback – could return a custom offline page if needed
        return new Response('Offline – app shell not available', { status: 503 });
      });
    })
  );
});
