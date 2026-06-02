var CACHE_NAME = 'memescope-v2.5.128';
// On localhost the service worker is disabled entirely so development always
// sees fresh files (no stale-cache confusion). Production keeps full caching.
var IS_DEV = (self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1');
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
  '/img/worldwide.svg',
  '/img/phantom_logo.png',
  '/img/metamask_logo.svg',
  '/img/coinbase_logo.webp',
  '/img/trust_logo.png',
  '/img/okx_logo.png',
  '/img/chain_solana.png',
  '/img/chain_eth.png',
  '/img/chain_bsc.png'
];

// Install — cache static assets (skipped in dev)
self.addEventListener('install', function(e) {
  self.skipWaiting();
  if (IS_DEV) return;
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// Activate — clean old caches; in dev, wipe everything and remove the SW itself
self.addEventListener('activate', function(e) {
  if (IS_DEV) {
    e.waitUntil(
      caches.keys().then(function(names) {
        return Promise.all(names.map(function(n) { return caches.delete(n); }));
      }).then(function() { return self.registration.unregister(); })
        .then(function() { return self.clients.matchAll(); })
        .then(function(clients) { clients.forEach(function(c) { try { c.navigate(c.url); } catch(err) {} }); })
    );
    return;
  }
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
  if (IS_DEV) return;  // dev: always go to network, never serve from cache
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
