var CACHE_NAME = 'memescope-v2.5.72';
var STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/embed.js',
  '/wallet.js',
  '/boost.js',
  '/extras.js',
  '/multichart.js',
  '/ens.js',
  '/manifest.json',
  '/favicon.png',
  '/icon-192.png',
  '/img/globe-chains.svg',
  '/img/leaf.svg',
  '/img/phantom_logo.png',
  '/img/metamask_logo.svg',
  '/img/coinbase_logo.webp',
  '/img/trust_logo.png',
  '/img/okx_logo.png'
];

// Install — cache static assets
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(
        names.filter(function(n) { return n !== CACHE_NAME; })
            .map(function(n) { return caches.delete(n); })
      );
    })
  );
  self.clients.claim();
});

// Fetch — stale-while-revalidate for static assets, network-first for API
self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // API calls — always network, no cache
  if (url.pathname.startsWith('/api/') ||
      url.hostname.includes('memescope-scraper') ||
      url.hostname.includes('dexscreener') ||
      url.hostname.includes('geckoterminal')) {
    return;
  }

  // External resources (fonts, analytics) — let browser handle
  if (url.origin !== self.location.origin) {
    return;
  }

  // Static assets — stale-while-revalidate
  e.respondWith(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.match(e.request).then(function(cached) {
        var fetchPromise = fetch(e.request).then(function(response) {
          if (response.ok) {
            cache.put(e.request, response.clone());
          }
          return response;
        }).catch(function() {
          return cached;
        });
        return cached || fetchPromise;
      });
    })
  );
});
